# The calendar agenda and staff-made bookings (F-046 part 1): design

Date: 2026-10-30. Author: bis-booking. Base: `c7bb8c0d` (branch `feat/calendar-agenda`).
Status: design. The owner ruled on eleven decisions on 2026-10-29/30 (section 2, binding). Nothing here is built.
Migration number: **0107** (0106, contact merge, is the newest and is on production).

Every claim about current code cites `path:line` at `c7bb8c0d`. Short forms: `ACCT/` =
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`, `CAL/` = `ACCT/calendar/`, `MIG/` =
`packages/db/supabase/migrations/`, `DB/` = `packages/db/src/`, `WEB/` = `apps/web/src/`. A claim about a system
outside this repo is labelled **ASSUMPTION** and names how the plan verifies it. Where the brief and the source
disagree, the source wins, and section 15 records each disagreement.

Scope, from `docs/crm-features.md:1420`: "the agenda and staff-made bookings", 3 to 4 engineer-weeks, because
"Staff cannot put a phoned-in job on the calendar today". The promise (`docs/crm-features.md:2031`): "A day and week
agenda where staff book phoned-in jobs". The job card is part 2 (`:1511`). Services, job questions and the F-015
address component are F-047 (`:1512`).

---

## 1. The problem, as the code has it

- **Nothing on the dashboard writes a booking.** Bookings are written in exactly three places: the public page
  (`WEB/app/b/[publicId]/actions.ts:334`), Sofía's `book_appointment` (`WEB/lib/voice/tools/registry.ts:642`) and
  the demo seed (`DB/demo/seed.ts:770`). `createBooking` (`DB/booking.ts:278-295`) takes no address, no meeting type
  and no job description beyond `note` (`DB/booking.ts:63-73`).
- **The calendar page is a list, not a schedule.** `CAL/page.tsx:194-238` stacks settings (Owners only, `:196`),
  closed days, then `BookingsList` (`:214`), with the embed and the feed card in the side column (`:227-236`).
  `listCalendarBookings` reads every booking from now on with no end (`DB/booking.ts:1105-1131`). The list formats
  in `en-US` only (`CAL/bookings-list.tsx:45-67`), so it is English-only.
- **The database refuses every overlap.** `bookings_no_overlap` excludes any two `booked` rows on one calendar
  (`MIG/0016_booking.sql:60-64`), and a flip back to `booked` re-enters it (`DB/booking.ts:380-382`). A phoned-in job
  that runs over a booked slot cannot be written today.
- **The slot engine is enforced by its callers only.** `bookableSlot` (`WEB/lib/booking/availability.ts:84-89`) is
  run by the public submit (`WEB/app/b/[publicId]/actions.ts:276-279`) and by Sofía (`registry.ts:528`). The
  database knows nothing of open hours, notice or closures. That is correct for staff, who may break those rules
  (ruling 3), and it is why a staff path must simply not call `bookableSlot`.
- **Booking writes are server-only.** `authenticated` holds no INSERT, UPDATE or DELETE on `bookings`
  (`MIG/0053_server_only_writes.sql:104-105`, `:119-121`); every write goes through the service client after
  `proveBooking` (`CAL/actions.ts:189-198`).

---

## 2. Owner rulings (binding, 2026-10-29/30) and the decisions this spec adds

The eleven rulings are restated here only by number and the section that builds each:

| # | Ruling | Built in |
|---|---|---|
| R1 | Staff-made jobs may overlap other bookings, side by side, marked "overlaps", with a plain warning in the form | 3.2, 5.2, 5.4 |
| R2 | A staff-made job blocks that time for customers (the public page and Sofía never offer it) | 3.2, 4 |
| R3 | Staff may book outside open hours, inside minimum notice, or on a closed day, each with a confirm-in-place warning. The public page and Sofía keep every rule | 5.4, 6.1 |
| R4 | Confirmation email default ON with an opt-out tick; reminders as today, in the customer's language; email only until A2P | 6.1, 6.5 |
| R5 | Owners, Staff and the agency add, move and cancel; Technicians view only their own customers' jobs, never "busy" blocks | 8 |
| R6 | The agenda is first on the Calendar page (Day / Week, Back / Today / Next, Add job the one primary) and replaces BookingsList | 5.1-5.3 |
| R7 | A job holds customer, date and start, length, a one-line "what", an optional saved address, a meeting type | 3.1, 5.4 |
| R8 | A quick-add phone that already belongs to someone offers "Use Ana / Add as new" | 5.4, 6.1 |
| R9 | Add job is reversible with Undo; the confirmation goes only after the toast closes; a backstop if the browser closes | 3.1, 6.1-6.5 |
| R10 | A job opens a right-side drawer: details, Move (same form, "moved" email, untickable), Cancel with Undo, Done / No-show once started, Open record; Esc closes; a deep link opens it | 5.5, 6.3 |
| R11 | `bookings_no_overlap` narrowed to customer-made rows; a check refuses a customer-made row overlapping any live booking; every booking write locks its calendar row; staff-made = `author_kind = 'person'` | 3.2 |

Decisions this spec makes (recommended, changeable in review):

| # | Decision | Recommendation |
|---|---|---|
| D1 | "What the job is" | Reuse `bookings.note` (3.1) |
| D2 | Meeting type on a booking | New nullable `bookings.meeting_type`; NULL means the calendar's type (3.1) |
| D3 | The confirmation backstop | `after()` plus a dedicated 15-minute cron pass, NOT an F-196 job (6.5; F-196 jobs do not drain while `CRON_FANOUT` is off) |
| D4 | Email kinds | Two new kinds, `staff.booking_confirmation` and `staff.booking_moved`, class `transactional` (6.6) |
| D5 | Undo of Add | DELETE the row while its hold is unsettled, never cancel it (6.2) |
| D6 | Move | Runs at once with Undo (rule 6); same time and length = an in-place edit, no new row, no email (6.3) |
| D7 | Cancel inside the hold | Is the Undo of the add: no cancel notice for a job the customer never heard of (6.4) |
| D8 | `booking.created` for a staff add (and a staff move's two events, §17) | Written when the hold settles, not at insert, so an undone add leaves no "New booking" in the activity card (6.5) |
| D9 | The access log | The agenda is a list (part of the visit); opening a job's drawer logs `contact` for the job's customer (8.2) |
| D10 | Week | Starts on Sunday, the slot engine's own weekday order (`WEB/lib/booking/slots.ts:8`) |
| D11 | Cancelled rows | Day view shows them muted, out of the lanes; a row a move replaced is hidden; Week view omits them (5.2) |
| D12 | Counts | A staff-made job is a booking in every count (dashboard, weekly report): `listBookingCreationsBetween` is "the ONE read behind every bookings count" (`DB/booking.ts:1151-1162`) |

---

## 3. Data model: migration 0107

Written to 0100's and 0106's conventions: a header with WHY / WHAT / WHO WRITES / GRANTS / SEARCH PATHS / LOCKS /
APPLY ORDER / LOAD-BEARING / ROLLBACK, ASCII only, no backslash, `lock_timeout` 5 s in a `do` block
(`MIG/0100_cancel_notice_pending.sql:70-72`), every definer with `set search_path = pg_catalog, pg_temp` (the 0096
rule).

### 3.1 New columns on `bookings`

```sql
alter table public.bookings
  add column place_id uuid,
  add column meeting_type text,
  add column hold_until timestamptz,          -- staff add or move: the Undo window's end, plus grace
  add column hold_settled_at timestamptz,     -- the claim: whoever settles the hold (after() or the pass)
  add column notice_wanted text,              -- the email the settle sends: 'confirmation' | 'moved' | null
  add column notice_sent_at timestamptz,      -- stamped after a SENT answer from the email gate
  add constraint bookings_meeting_type_check
    check (meeting_type is null or meeting_type in ('in_person', 'phone', 'video')),
  add constraint bookings_place_fkey foreign key (account_id, place_id)
    references public.places (account_id, id),                 -- NO ACTION: a job's address cannot vanish
  add constraint bookings_hold_staff_only check (hold_until is null or author_kind = 'person'),
  add constraint bookings_hold_settled_pair check (hold_settled_at is null or hold_until is not null),
  add constraint bookings_notice_wanted_check
    check (notice_wanted is null or (notice_wanted in ('confirmation', 'moved') and hold_until is not null)),
  add constraint bookings_notice_sent_after check (notice_sent_at is null or hold_settled_at is not null);
create index bookings_place on public.bookings (place_id) where place_id is not null;
create index bookings_hold_due on public.bookings (hold_until)
  where hold_until is not null and hold_settled_at is null;
```

- **`place_id`.** The same-account composite key 0050 and 0071 use; `places_account_id_id_key` exists
  (`MIG/0071_places_and_equipment.sql:59`). NO ACTION, because bookings are leads (`MIG/0017_booking_fk_and_policy_scope.sql:18-24`).
  `removePlace` deletes an empty place (`DB/places.ts:307-339`); it must count bookings as it counts equipment and
  archive instead (section 12, T6). That the place is the customer's or their household's is checked by the action
  through the caller's own client (6.1), not by a trigger: the FK keeps it in the account, and a later household
  change does not make a past job's address wrong.
- **`meeting_type`.** NULL means "the calendar's type", which is what every existing row means today (the type is
  calendar-level, `MIG/0022_meetings_followups.sql:2-4`). So 0107 backfills nothing and the running build writes
  nothing new. Readers use `coalesce(bookings.meeting_type, calendars.meeting_type)`. The staff path always writes it.
- **D1, `note` is "what the job is".** Every reader already shows it where it belongs: the record timeline renders
  it with `lang` chosen by `author_kind` (`ACCT/contacts/[contactId]/activity-timeline.tsx:253`), the old list showed
  it (`CAL/bookings-list.tsx:269-272`), the staff alert email carries it (`WEB/lib/email/templates/booking.ts:74-77`),
  and the customer's confirmation never does (its input has no note, `booking.ts` template `:112-140`). The feed
  never prints it (`WEB/lib/booking/feed-content.ts:8`). A second column would need every one of those readers
  taught again. The staff form bounds it to 200 characters; the public page's 2,000 stays
  (`WEB/app/b/[publicId]/actions.ts:71-73`).
- **The hold columns (R9).** `hold_until` and `hold_settled_at` are the Undo window and its one claim, the
  `claimCancelNotice` shape (`DB/booking.ts:520-530`) moved onto the row: the settle claims with a conditional
  UPDATE `where hold_settled_at is null`, the Undo deletes `where hold_settled_at is null`, and Postgres serializes
  the two on the row, so exactly one wins. `notice_wanted` is set at insert only when the tick is on. `notice_sent_at`
  is send-then-stamp (`DB/booking.ts:1644-1656`'s reasoning) so the drawer can say "Confirmation emailed" truthfully.
  A dedicated table like 0100's is not needed: the cancel notice keeps a composed email because the owner typed a
  message into it (`MIG/0100_cancel_notice_pending.sql:24-25`); a confirmation is composed from the row at send time.

No grant changes: `authenticated` holds table-level SELECT on bookings (`MIG/0061_bookings_rescheduled_from.sql:41-44`),
so it reads the new columns, and writes nothing. `EXPECTED_WRITES` (`DB/test/schema-grants-guard.test.ts`) is
unchanged; `booking-grants.test.ts:44-51` still passes.

### 3.2 The overlap rule (R1, R2, R11)

```sql
alter table public.bookings drop constraint bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (calendar_id with =, tstzrange(starts_at, ends_at) with &&)
  where (status = 'booked' and author_kind <> 'person');
create index bookings_staff_live on public.bookings
  using gist (calendar_id, tstzrange(starts_at, ends_at))
  where status = 'booked' and author_kind = 'person';

create function app.bookings_slot_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  if new.status <> 'booked' then
    return new;
  end if;
  -- R11: every live-booking write on this calendar waits here, so the check below
  -- always sees a staff job that committed first.
  perform 1 from public.calendars c where c.id = new.calendar_id for no key update;
  if new.author_kind <> 'person' and exists (
       select 1 from public.bookings b
        where b.calendar_id = new.calendar_id and b.status = 'booked' and b.id <> new.id
          and b.author_kind = 'person'
          and tstzrange(b.starts_at, b.ends_at) && tstzrange(new.starts_at, new.ends_at)) then
    raise exception 'bookings_no_overlap: overlaps a job staff booked' using errcode = 'exclusion_violation';
  end if;
  return new;
end $$;
create trigger bookings_slot_guard
  before insert or update of status, starts_at, ends_at, calendar_id, author_kind on public.bookings
  for each row execute function app.bookings_slot_guard();
revoke all on function app.bookings_slot_guard() from public, anon, authenticated;
```

- **The constraint keeps its name**, so `isOverlapError`'s message fallback still matches
  (`DB/booking.ts:299-301`), and customer-versus-customer races stay the exclusion constraint's own, which waits on
  a conflicting uncommitted row by itself.
- **The trigger checks customer rows against staff rows only.** "Any live booking" (R11) is the union of the two:
  the exclusion constraint covers customer rows, the trigger covers staff rows. `[)` bounds, as 0016's, so a
  customer booking that starts when a staff job ends is legal.
- **The errcode is load-bearing.** `exclusion_violation` (23P01) is what `createBooking`, `setBookingStatus` and
  `moveBooking` map to `SlotTakenError` (`DB/booking.ts:288`, `:414`, `:970`), and what `undo_ai_booking_act` catches
  as `time_taken` (`MIG/0091_ai_acts.sql:292-301`). A plain `raise` (P0001) would surface as a generic failure on
  every one of those paths.
- **The lock.** `for no key update` on the one calendar row (`MIG/0016_booking.sql:11`, one per account) does not
  conflict with the `for key share` every FK check into `calendars` takes, so it serializes booking writes only
  (and a settings save, for one statement). Each PostgREST call is its own transaction, so the lock lasts one
  statement. The function is a READ COMMITTED plpgsql function, so its `exists` runs on a fresh snapshot taken
  after the lock is granted, and sees the row the lock waited for. The race test in section 10 proves it.
- **SECURITY DEFINER** although only `service_role` writes bookings today: a check that runs under a caller's RLS
  fails OPEN for any future client writer whose policy hides a staff job (the plpgsql-null-guard lesson). It joins
  `EXPECTED_DEFINERS` (`DB/test/definer-search-path.test.ts:30`).
- **Who becomes "staff-made" beyond the agenda.** `bookingAuthor` maps actor `user` to `person`
  (`DB/provenance.ts:31-35`). So the demo seed's bookings (`DB/demo/seed.ts:770`, actor `ACTOR`, type defaulted to
  `user`) and every test fixture that calls `createBooking` without an actor type become staff-made. That is harmless
  for the seed (its slots never overlap, `seed.ts:690-697`), and it changes five existing tests (section 10.1).
  A row a person MOVES becomes person-made too (`moveBooking` writes the mover's author, `DB/booking.ts:965`): a
  customer booking staff move may then overlap, which is R3's own rule for staff. A staff job a customer moves by
  link (actor `system`, `WEB/app/b/[publicId]/move/[token]/actions.ts:50-51`, `:145-146`) or Sofía moves (actor
  `ai`) becomes customer-made and keeps every rule.

### 3.3 `public.undo_staff_move(p_account_id uuid, p_new_id uuid, p_old_id uuid, p_cancelled_at timestamptz, p_now timestamptz) returns text`

SECURITY INVOKER, EXECUTE to `service_role` only (0091's shape for `undo_ai_booking_act`, and, per §17, locking the calendar row FIRST
`MIG/0091_ai_acts.sql:233-245`), so it adds no definer. It is 0091's reschedule branch (`:319` on) for a staff
move: in one inner block, DELETE the new row `where status = 'booked' and hold_settled_at is null` and no row names
it in `rescheduled_from_id`, then restore the old row `set status = 'booked' where status = 'cancelled' and
updated_at = p_cancelled_at` (`cancelledAt` is the move's own stamp, `DB/booking.ts:923-926`). Answers `undone`,
`gone`, `too_late` (the hold settled: the moved email went or is going), `time_taken` (the restore raised
`exclusion_violation`: a customer row cannot return over a staff job that took its time), `changed`. Two
PostgREST calls could leave neither row live; one function cannot.

### 3.4 LOCKS, APPLY ORDER, ROLLBACK

- **LOCKS.** Dropping and re-adding the exclusion constraint takes ACCESS EXCLUSIVE on `bookings` while the gist
  index builds; the FK to `places` takes SHARE ROW EXCLUSIVE on `places`. **ASSUMPTION:** production holds a few
  hundred bookings at most (33 in 0061's note, `MIG/0061:59`); the orchestrator reads the count before applying.
- **LOAD-BEARING.** From the agenda's first build on, the app names every new column. Production gets 0107 before
  the merge deploy. **SAFE UNDER THE RUNNING BUILD:** the running build writes no staff rows; its customer rows meet
  the same exclusion constraint as before, plus a trigger that finds no staff rows to collide with.
- **ROLLBACK** (roll the app back first). The old constraint cannot be re-added while two live person rows overlap.
  The orchestrator lists them first (`select` pairs of live `person` rows whose ranges overlap) and the owner decides
  each: cancel one, or keep 0107. Then drop the trigger and its function, `undo_staff_move`, the two indexes, the
  constraints and the six columns, and re-add 0016's constraint (`MIG/0016_booking.sql:60-64`).

---

## 4. What every reader does with a staff-made job (verified, each one)

| Reader | Behaviour | Change |
|---|---|---|
| Slot engine (public page, Sofía, the move page) | `listBookedRanges` reads every `booked` row of the calendar (`DB/booking.ts:248-262`), whoever made it; the buffer is two-sided around it (`WEB/lib/booking/slots.ts` `conflictScan`) | None. R2 holds today |
| The race past the engine | Public submit maps `SlotTakenError` to "just taken" (`WEB/app/b/[publicId]/actions.ts:338-343`); Sofía to `slotTaken` (`registry.ts:651`); the customer's move and Sofía's reschedule through `moveBooking` (`DB/booking.ts:970`); the AI undo to `time_taken` (`MIG/0091:299-301`) | None, given the 23P01 errcode (3.2) |
| Email reminder (day-before and late) | `listDueReminders` (`DB/booking.ts:1585-1627`) | Skip a staff row until its hold is SETTLED: `hold_until is null or hold_settled_at is not null` (6.5, §17) |
| Text reminder, appointment confirm | `listDueSmsReminders`, `listDueAppointmentConfirms` (`DB/automations.ts:642-668`, `:792-818`) and their by-id twins | The same hold filter (bis-automations) |
| Closures | A job on a closed day has its reminders held or skipped unless `closure_kept_at` is set (`WEB/lib/automations/closures.ts:188-213`) | The add stamps `closure_kept_at` when the "closed that day" warning was accepted (6.1) |
| Follow-up, review request, no-show nudge, referral | Post-appointment reads by status (`DB/booking.ts:1722-1755`; `DB/automations.ts:299`, `:491`, `:1148`) | None |
| Record timeline | `listContactBookings` (`DB/booking.ts:1262-1286`) with the person mark (`WEB/lib/record/author-mark.ts:107`) | None |
| What is next | `listContactUpcomingBookings` (`DB/booking.ts:1229-1243`, called at `DB/record.ts:182`) | None |
| Work queue (Done / No-show) | `staleBookings` (`DB/work-queue.ts:153-170`) | None |
| Owner's calendar feed | `listFeedBookings` (`DB/booking.ts:817-861`), first name only, one meeting kind per feed (`:820`, `:860`) | Per-row kind: `coalesce(meeting_type, calendar's)`; the `openIn` link (`feed-content.ts:35`) points at `?job=` |
| Counts | `listBookingCreationsBetween` (`DB/booking.ts:1163-1173`) | None (D12) |
| Dashboard activity card | Renders `booking.created` events (`ACCT/dashboard/activity-card.tsx:106`) | Event deferred to the settle (D8) |
| Staff alert email and text | The public path sends both (`actions.ts:488-517`, `:551-570`) | None for a staff add: the staff made it |
| Consent grant, language sign, archive restore, inbox message | The public path records each as the customer's act (`actions.ts:369`, `:374-382`, `:387-391`, `:412-427`) | None for a staff add: none is the customer's act |

---

## 5. UI

DESIGN.md binds: tokens only, the four surfaces, rules 1 to 11, the record and drawer patterns, the definition of
done including English and Spanish and the pseudo-locale's +35%. The Calendar page names **no hero** (rule 11).
Nothing here is a new top-level surface: the agenda is the existing Calendar page's first card (module contract).

### 5.1 The Calendar page

`CAL/page.tsx` renders, top to bottom: the **Agenda card** (full width); then today's two-column grid with
`CalendarSettings` (Owners and the agency, unchanged, `:196`) and `ClosedDaysCard` on the left, `EmbedSnippet` and
`FeedCard` on the right. `BookingsList` and `listCalendarBookings` leave the page; the list's three duties move:
outcome buttons to the drawer (5.5), the cancel dialog to the drawer, and appointments from earlier days that still
need Done or No-show to To do, which already lists them (`DB/work-queue.ts:153-170`), with one line on the agenda
linking there.

**Add job sits in the Agenda card's own header, not in `PageHeader`.** Rule 8 forbids "a page-level primary sitting
above cards that each have their own", and the feed card carries its own primary buttons (`CAL/feed-card.tsx:72`,
`:82`, `:122`). So the card is the view and Add job is its one primary.

The card header: title, `Day | Week` tabs, `Back · Today · Next`, the date it shows, Add job (Owners, Staff, agency
only). All of it is links: `?view=day|week&day=YYYY-MM-DD` (and `&job=<id>` for the drawer). The page is
server-rendered from the URL, so Back and the browser's own back agree, and a link can name any day.

### 5.2 Day

A time-ordered list with the time on the left, on `--surface-2` rows inside the `--surface-1` card. Each row: start
and end, the customer's name, the "what" line, the address's label or first line, the meeting type as a word, the
status as dot and word (rule 3), the confirmation answer when there is one (`CAL/confirm-reply.ts`), and who made it
("Added by Dan", "Booked online", "Booked by Sofía"; the author mark, `WEB/lib/record/author-mark.ts:7-8`, names
from `listPeopleNames`, `DB/record.ts:649`). The whole row is the button that opens the drawer (rule 4); hover is
`--surface-3`; `id="booking-<id>"` stays on it.

- **Overlaps** (R1). Rows whose live ranges overlap form one item with up to two lanes side by side; three or more
  stack in that item. Every overlapping row carries "Overlaps" as dot and word (`--warn`). A pure
  `agendaLanes(rows)` assigns lanes; `[)` bounds, so back-to-back is not an overlap.
- **Hours.** The open interval(s) of that weekday from `calendars.open_hours` (the hours the booking rule uses,
  `availability.ts:37-46`). Inside them, every whole hour with no live job renders a thin free row, "10:00 · Add job",
  that opens the sheet prefilled (R6), for those who may add. Outside them nothing is drawn but the jobs, each tagged
  "Outside open hours" in words.
- **Closed.** A closed-day range or a closure in force that covers the day (`coversAppointment`,
  `WEB/lib/business-status/status.ts:295-311`) heads the day with "Closed · {reason}" as dot and word (`--crit`, the
  business status's own recipe). Jobs still list under it.
- **Cancelled** (D11). Muted, out of the lanes, "Cancelled" as dot and word. A cancelled row that a move replaced is
  hidden (one extra read of `rescheduled_from_id` for the window's cancelled ids), because its replacement is the
  appointment. The old list showed cancelled rows on purpose (`DB/booking.ts:1089-1093`); hiding all of them would
  lose a customer's own cancellation.
- **Earlier days.** "3 past jobs still need Done or No-show · To do", only when there are any (a head count that
  throws on `null`, the head-count-null lesson).
- **DST.** On a day whose UTC offset changes, every time carries the zone's short name, so a fall-back day's two
  "1:30" rows read "1:30 AM CDT" and "1:30 AM CST", and a `01:00 → 01:00` job reads as two different instants.

### 5.3 Week, and the phone

On a desk: seven columns (Sunday first, D10) on a desk-width card, each a compact Day list without free rows, the
day's date and "Closed" in its head; clicking a day's head opens that Day. On a phone (below the `md` breakpoint):
one day at a time under a strip of seven day buttons, which is the Day list for the chosen day. At 375 px the card
header wraps to two lines (tabs and Add job; Back · Today · Next and the date), and no label truncates in Spanish or
under the pseudo-locale. The bottom bar's "Agenda" tab (`docs/crm-features.md:2604`) is F-107 part 2's; this page is
what it will open.

### 5.4 The Add job sheet (and Move, which is the same form)

A right-side sheet (full height on a phone), one primary: **Add job** (**Save new time** when moving).

1. **Customer.** A search box over the account's customers (name or phone), served by a GET route beside the page
   on the request client, so RLS decides what is found (the palette route's reasoning for a GET over an action,
   `WEB/app/api/accounts/[accountId]/search/route.ts:42-53`). "New customer" swaps in two fields, name and phone.
2. **Date and start**, prefilled from the free row tapped or the next whole hour. Five-minute steps.
3. **How long**, default `slot_duration_minutes`, 5 to 720 minutes in 5-minute steps.
4. **What's the job?** One line, 200 characters (D1).
5. **Address.** "No address", each of the customer's and their households' active places
   (`listContactPlaces`, `DB/places.ts:115-173`, through its existing route), or "New address", which opens the
   places card's own fields and saves a place on the customer first (R7).
6. **How you'll meet.** In person / Phone / Video, defaulting to the calendar's type.
7. **Send {first} a confirmation**, ticked (R4). Disabled with its reason when the customer has no email or the
   address cannot receive mail (the cancel notice's own availability check, `CAL/cancel-notice.ts:69-77`). On Move:
   **Email {first} the new time**, ticked when the customer has an email and either made the booking themselves or
   was emailed a confirmation for it (`notice_sent_at` on its chain); unticked otherwise.

**Confirm in place** (R3, R8). Save asks the server. When the server finds something the person has not yet seen,
it writes nothing and answers what it found; the sheet shows it above the button, and the button becomes "Add it
anyway" (or the phone offer's two buttons):

- "Outside your open hours"; "Sooner than your usual notice"; "You're closed that day"; "Overlaps a job at 10:00"
  ("Overlaps 3 jobs" past one); "That time has already passed. Pick a time from now on." (refused, not warned).
- "Ana García already has this number. Use Ana?" with **Use Ana** and **Add as new** (R8).
- "Video calls aren't set up, so this job won't have a link." when `getMeetingProvider()` is null
  (`WEB/lib/meetings/provider.ts:18-22`). A notice, not a refusal.

The second press sends the warnings it showed; the server recomputes, and saves only if nothing new appeared (a job
someone else added in between is shown, not silently accepted).

### 5.5 The job drawer

A right-side sheet over the agenda (Esc closes, focus returns to the row), opened by a row or by `?job=<id>`. A
deep link with no `day` opens the job's own day. It shows: customer (name, phone as a `tel:` link), when, length,
what, address, meeting type and its Join link, status, who made it and when, the confirmation answer, and the email
state ("Confirmation emailed 9:42 AM", "We'll email the confirmation in a few seconds", "Couldn't email the
confirmation"). Actions:

- **Move** (ghost) swaps the drawer's body for the 5.4 form, prefilled.
- **Cancel** (ghost) is today's cancel with its notice dialog and Undo (`CAL/actions.ts:302-370`); inside the hold
  it is the add's Undo instead (D7).
- **Mark completed / No-show** (ghost) once the job has started (D-030, `CAL/actions.ts:226-239`).
- **Open record** (ghost) links to the customer's page.

The drawer has no primary (section 14, item 2). Technicians see the drawer read-only (section 8).

### 5.6 States, keyboard, tokens

- **Loading:** the card streams behind its own Suspense boundary with a skeleton of five rows shaped like Day rows
  (rule 7); the rest of the page does not wait for it.
- **Empty day:** "Nothing booked {day}." then "Jobs you add and bookings customers make show here. Add the first
  one." with Add job (rule 5). A Technician's empty day: "None of your customers have a job {day}."
- **Error:** the card's own. A failed read logs and renders "Couldn't load your schedule." with a Try again link
  to the same URL, the closed-days card's pattern (`CAL/page.tsx:112-166`); the other cards render normally.
- **Keyboard:** rows are buttons in time order; Up and Down move between rows; Enter opens the drawer; Esc closes
  the drawer and the sheet; every control has a visible `:focus-visible` ring.
- **Tokens only.** `--warn` and `--crit` only for the overlap and closed states, each as dot and word. Renders in
  dark and light, with the blur fallback, at 375 px, in English, Spanish and the pseudo-locale. `/styleguide` gains
  the Day row, the Week column, the sheet and the drawer.
- **Palette:** `/calendar`'s terms (`WEB/lib/palette/registry.ts:76`) gain "agenda", "schedule", "add job",
  "trabajo", "agregar trabajo".

---

## 6. Server actions and side effects

All in `CAL/agenda-actions.ts` (new), on the existing `requireAccountAccess` and `proveBooking`
(`CAL/actions.ts:189-198`). Writes on `serviceDb()` after the checks; reads that decide what the person may see on
`dbForRequest()`. Pure rules in `WEB/lib/booking/job-warnings.ts`, `agenda-window.ts` and `agenda-lanes.ts` (new).

### 6.1 `addJobAction(accountId, draft, seen)`

1. `requireAccountAccess`; refuse unless `seesWholeAccount` (`WEB/lib/auth-role.ts:15-17`). A paused account's
   client is refused by the guard itself (`WEB/lib/auth.ts:91-92`).
2. Validate: a start on a whole minute at or after now (refused otherwise), length 5 to 720, start within 366 days,
   what at most 200 characters, a meeting type of the three.
3. **The customer.** An id is proven with `callerCanSee("contacts", …)`. A quick-add phone is read with
   `listContactsOnNumber` (`DB/voice.ts:777`), holding records left out; a match the person has not answered
   returns `{ needs: { phoneOwner } }` and writes nothing. "Use Ana" sends Ana's id. "Add as new" calls
   `createContact` with `matchBy: "email_only"` (`DB/contacts.ts:43-47`), which makes the second person and files
   the pair for the merge queue (`phone_shared_new_person`, `:519-520`); without it, `createContact` would land the
   job on Ana silently (`:465`, `:497`).
4. **The place.** Must be one `listContactPlaces` returns for that customer on the caller's client, active.
5. **Warnings.** `jobWarnings({ config, closures, liveRanges, now, range, excludeId })` over the same reads the slot
   engine uses (`availability.ts:27-46`): outside open hours (the engine's own fit, `endsByClose`), inside
   `min_notice_hours`, closed (`closedOut`, `slots.ts:249-259`), and each live booking it overlaps (no buffer:
   the buffer is a customer rule). Any warning not in `seen` returns `{ needs: { warnings } }` and writes nothing.
6. **Video.** When the type is video and a provider exists, mint a room first
   (`createMeetingRoom({ bookingId: calendar.public_id, endsAt })`, the public page's call,
   `WEB/app/b/[publicId]/actions.ts:293-303`). A room an Undo leaves behind expires an hour after the job's end
   (`WEB/lib/meetings/daily.ts:25`).
7. **Write.** `createStaffJob` (new, `DB/booking.ts`): `insertBookingRow` with author `person`, the caller's id,
   `note`, `place_id`, `meeting_type`, `meeting_url`, `booker_timezone` null (reminders then speak the account's
   zone), `hold_until = now + UNDO_WINDOW_MS + NOTICE_GRACE_MS` (10 s + 5 s, `CAL/undo-window.ts:14-15`),
   `notice_wanted = 'confirmation'` when ticked, and `closure_kept_at = now` when "You're closed that day" was
   accepted (otherwise the closure would hold its reminders, section 4). No event yet (D8).
8. **Schedule the settle** with `after()` (6.5) and answer `{ ok, bookingId, notice: "scheduled" | "none" |
   "no_email" | "address_blocked" }`. The toast reads accordingly and carries Undo for `UNDO_WINDOW_MS`.

A contact made by quick-add stays if the job is undone: staff typed a real person's details, and an Undo of a job
deleting a customer would surprise.

### 6.2 `undoAddJobAction(accountId, bookingId)` (D5)

`proveBooking`, then one conditional DELETE through PostgREST: this account, this id, `author_kind = 'person'`,
`author_id` = the caller, `status = 'booked'`, `rescheduled_from_id is null` (never a move's row, §17), `hold_settled_at is null`. A row a move has replaced cannot be
deleted (the `rescheduled_from_id` FK, NO ACTION, `MIG/0061:81-85`) and answers "moved since". Zero rows is read
once: settled means "Too late to undo: the confirmation already went to {first}. Cancel the job instead." A delete,
not a cancel, for 0091's reason: a cancelled row would still count as a booking made (`DB/booking.ts:1151-1162`)
and sit on the timeline (`MIG/0091:237-239`). Emits `booking.add_undone`.

### 6.3 `moveJobAction(accountId, bookingId, draft, seen)` and its Undo (D6)

Same checks and warnings as 6.1, the overlap read excluding the job itself.

- **Same start and length:** an in-place edit of `note`, `place_id`, `meeting_type` (a room minted when it becomes
  video). One compare-and-set UPDATE on the values the form opened with; Undo writes them back the same way. No
  email, no new row.
- **A new time:** `moveBooking` (`DB/booking.ts:928-1033`), extended so the new row carries `place_id`,
  `meeting_type` and the hold columns (today it carries contact, calendar, note and zone, `:944-949`). A video job
  gets a new room (the old one expires at the old end). The new row's `notice_wanted` is `'moved'` when the tick is (superseded by §17: decided after the cancel, from a re-read of the old row)
  on; but when the old row's own hold was unsettled and wanted a confirmation, it is `'confirmation'`: the customer
  never heard of the old time. Answers `{ newId, cancelledAt }`; the toast's Undo calls
  `undoMoveJobAction(accountId, newId, oldId, cancelledAt)`, which proves both rows and calls `undo_staff_move`
  (3.3). Its answers map to words (section 9).

The emails are `staff.booking_moved` with `bookingRescheduledEmail` (`WEB/lib/email/templates/booking.ts:233-275`)
and `staff.booking_confirmation` with `bookingConfirmationEmail` (`:112-150`), both gaining one optional line, the
address (6.6).

### 6.4 Cancel, Done, No-show

Unchanged actions (`CAL/actions.ts:214`, `:262`, `:302`, `:442`). One change: the drawer's Cancel on a row whose
hold is unsettled calls `undoAddJobAction` instead (D7). Without it, a cancel inside the hold would send a
"cancelled by the business" notice (`CAL/actions.ts:340-362`) about a job the customer never heard of.

### 6.5 Settling the hold: `after()`, then a pass (R9, D3, D8)

`settleJobHold(db, accountId, bookingId)` in `CAL/job-hold.ts` (new), run by both:

1. **Claim:** `update … set hold_settled_at = now() where id = … and status = 'booked' (§17) and hold_until <= now() and hold_settled_at is null
   returning status, notice_wanted, …`. No row: the Undo or the other settler won; stop.
2. **Status not `booked`** (moved or cancelled inside the hold): settled, nothing else.
3. **Emit** `booking.created` (actor `user`, the author) for an add; a move's events are `moveBooking`'s own.
4. **Email**, when `notice_wanted` is set and the job has not started and the hold is under 24 hours old: compose
   from the row in the customer's language (`recipientLanguage(contact.language, account.language)`, as
   `DB/booking.ts:1580`), send through `sendEmailOrThrow` with the kind and `contactId`, then stamp
   `notice_sent_at` with `stamp-retry` (`WEB/lib/booking/stamp-retry.ts`). Links: cancel (works on a disabled
   calendar, `WEB/app/b/[publicId]/cancel/[token]/actions.ts:126-128`), add-to-calendar, and move only when the
   calendar is enabled (the move page answers "offline" otherwise, `move/[token]/data.ts:92`). Claim-then-send: a
   failed send is logged and the drawer says "Couldn't email the confirmation"; it is never retried, because a
   retry after an unclear send emails twice (the cancel notice's rule, `CAL/cancel-notice.ts:20-52`).

`after()` waits `UNDO_WINDOW_MS + NOTICE_GRACE_MS` inside the action's own invocation, as the cancel notice does
(`CAL/actions.ts:356-361`), under the page's explicit `maxDuration = 60` (`CAL/page.tsx:31-38`).

**The backstop is a cron pass, `jobHolds`, not an F-196 job.** F-196's queue is drained only by the `jobsDrain`
node of the fan-out plan (`WEB/lib/automations/fanout.ts:79`); `jobsDrain` is not in `PASSES`
(`WEB/lib/automations/registry.ts:73`), and with `CRON_FANOUT` off (`fanout.ts:88`) the tick runs `PASSES` alone. A
job enqueued today would never run in production. The pass is `cancelNotices`' twin
(`WEB/lib/automations/passes/cancel-notices.ts:50-58`): rows with `hold_until` two minutes past and
`hold_settled_at` null (index `bookings_hold_due`), oldest first, 25 a tick, a 10 s budget, abandoned after 48 hours.
It runs right after `cancelNotices` and before `reminders`, so a confirmation always precedes a reminder in one tick.
It is bis-automations', and `cron-coupling.test.ts` counts its budget.

**Reminders wait for the hold.** The day-before email window has no minimum age (`DB/booking.ts:1592-1596`), so
"same time tomorrow", the commonest phoned-in job, sits inside it on a tick that falls in the 15-second hold about
one tick in sixty. The four forward-looking due-list reads skip a staff row until its hold is settled (`hold_until is null or hold_settled_at is not null`, §17); their by-id twins do not filter (plan correction 3). The
cost, accepted: a job whose start sits at the trailing edge of the 45-minute text-reminder window
(`DB/automations.ts:594-595`) and whose hold covers that tick misses that text; the email reminders' wider windows
catch it next tick.

### 6.6 Email kinds (D4)

`booking.confirmation` cannot be used: it is `customer_initiated` (`WEB/lib/consent/classes.ts:96`), and scan 4
allows that class only where the customer acted, never in a cron pass (`WEB/lib/consent/scans.test.ts:807-825`).
Two new kinds, `transactional`, any hour, unsubscribe footer: `staff.booking_confirmation` and
`staff.booking_moved`. `transactional` is the class for news about the customer's own appointment that an
unsubscribe must not stop, in our words, so carrying the footer (`classes.ts:81-89`, `:133`). Not `staff_typed`:
the words are the template's, not a person's (`:116`). bis-comms owns `classes.ts`, its test that the class "holds
exactly the one kind" (`classes.test.ts:111-113`) and the kind count in `classes.ts:61-66`.

The two templates speak `tú` in Spanish ("Tu cita quedó agendada", `templates/booking.ts:26`). This spec adds one
line to each ("Where" / "Dónde", the place's label and address) and leaves their voice as it is (section 13).

---

## 7. Races

- **A customer books the minute staff add a job there.** Both writes wait on the calendar row (3.2). Staff first:
  the customer's insert raises 23P01 and the page or Sofía offers fresh times. Customer first: the staff job saves;
  its warning showed the overlap only if the customer's row existed when the server checked, and a second press
  re-checks (5.4).
- **The settle and the Undo.** Both are conditional writes on the same row; exactly one wins (3.1).
- **`after()` and the pass.** Both claim; one wins; the pass reads two minutes after the hold, so a live `after()`
  normally settles first.
- **A move inside the hold.** The old row is cancelled by the move, so its settle sends nothing; the new row's
  notice is the confirmation (6.3).
- **A customer moves or cancels a staff job by link.** The ordinary customer paths: their move obeys every rule
  (a customer row, 3.2), their cancel is `cancelBookingByToken` (`DB/booking.ts:338-350`).
- **A staff Undo of a cancelled customer booking into a staff job's time.** The flip to `booked` re-enters the
  trigger and answers today's "Someone else booked that time" (`CAL/actions.ts:464-466`).
- **Two staff adds at one time.** Both save, side by side: R1.

---

## 8. Who may do what, and the access log

### 8.1 Roles

| | Owner, Staff, agency | Technician |
|---|---|---|
| See the agenda | Every job | Only jobs of customers assigned to them (`bookings_technician_scope`, `MIG/0068_mine_unassigned_technician.sql:113-120`): RLS on the request client, so no "busy" block of anyone else's job exists to draw (R5) |
| Free rows, Add job, Move, Cancel | Yes | No (hidden, and each action refuses without `seesWholeAccount`) |
| Mark completed / No-show | Yes | **Open question 1**: today they can, on their own customers' jobs (`CAL/actions.ts:214-219` checks only `proveBooking`) |

Every write is proven through the caller's own client first (`proveBooking`), as every booking action is today.

### 8.2 The access log (F-118)

The access-log design lists the calendar among lists, which are part of a visit and not logged
(`docs/superpowers/specs/2026-10-29-access-log-design.md:28`). The drawer shows a customer's name, phone and
address, which is what the contact drawer shows, and that is logged. So opening a job's drawer calls
`noteOpened(access, accountId, { kind: "contact", recordId: booking.contact_id })` (the call page's shape,
`ACCT/calls/[callId]/page.tsx:114`). No new kind, so 0105's kind check is untouched; a client is never logged
(`noteOpened` returns at once for one). Adding, moving and cancelling are writes, not views.

---

## 9. Copy (English; Spanish, usted)

New keys under `calendar.agenda.*` and `calendar.job.*` in `WEB/lib/messages.ts`, each with its `.es` twin
(`messages.ts:2677-2678`'s shape) and a `One` twin for counts. The drawer reuses `calendar.bookings.*` keys and
adds the `.es` twins they lack (`markCompleted`, `markNoShow`, `cancel`, `join`, `messages.ts:1825-1828`). No
milestone codes, no arrows, no `{{template}}`. A name shown is the customer's; "job" on the agenda, "appointment"
in what the customer reads.

| Key | English | Spanish |
|---|---|---|
| `calendar.agenda.title` | Schedule | Agenda |
| `calendar.agenda.day` / `week` | Day / Week | Día / Semana |
| `calendar.agenda.back` / `today` / `next` | Back / Today / Next | Anterior / Hoy / Siguiente |
| `calendar.agenda.addJob` | Add job | Agregar trabajo |
| `calendar.agenda.addAt` | Add job at {time} | Agregar trabajo a las {time} |
| `calendar.agenda.emptyTitle` | Nothing booked {day}. | No hay nada agendado {day}. |
| `calendar.agenda.emptyBody` | Jobs you add and bookings customers make show here. Add the first one. | Aquí aparecen los trabajos que usted agrega y las citas que hacen sus clientes. Agregue el primero. |
| `calendar.agenda.emptyTechnician` | None of your customers have a job {day}. | Ninguno de sus clientes tiene trabajo {day}. |
| `calendar.agenda.error` | Couldn't load your schedule. | No se pudo cargar su agenda. |
| `calendar.agenda.retry` | Try again | Intentar de nuevo |
| `calendar.agenda.closed` | Closed · {reason} | Cerrado · {reason} |
| `calendar.agenda.outsideHours` | Outside open hours | Fuera del horario |
| `calendar.agenda.overlaps` | Overlaps | Se empalma |
| `calendar.agenda.cancelled` | Cancelled | Cancelada |
| `calendar.agenda.addedBy` | Added by {name} | Agregado por {name} |
| `calendar.agenda.bookedOnline` | Booked online | Reservada en línea |
| `calendar.agenda.bookedBy` | Booked by {persona} | Agendada por {persona} |
| `calendar.agenda.pastOpen` / `One` | {count} past jobs still need Completed or No-show · To do / 1 past job still needs Completed or No-show · To do | {count} trabajos pasados aún necesitan Terminado o No llegó · Pendientes / 1 trabajo pasado aún necesita Terminado o No llegó · Pendientes |
| `calendar.job.titleAdd` / `titleMove` | Add a job / Move this job | Agregar un trabajo / Cambiar el horario de este trabajo |
| `calendar.job.customer` | Customer | Cliente |
| `calendar.job.search` | Search by name or phone | Busque por nombre o teléfono |
| `calendar.job.newCustomer` | New customer | Cliente nuevo |
| `calendar.job.name` / `phone` | Name / Phone | Nombre / Teléfono |
| `calendar.job.phoneOwner` | {name} already has this number. Use {first}? | {name} ya tiene este número. ¿Usar a {first}? |
| `calendar.job.useExisting` | Use {first} | Usar a {first} |
| `calendar.job.addAsNew` | Add as new | Agregar como nuevo |
| `calendar.job.date` / `start` | Date / Starts | Fecha / Empieza |
| `calendar.job.length` | How long | Duración |
| `calendar.job.minutes` | {count} min | {count} min |
| `calendar.job.what` | What's the job? | ¿Qué trabajo es? |
| `calendar.job.whatHint` | Fix a leaking water heater | Arreglar un calentador que gotea |
| `calendar.job.address` | Address | Dirección |
| `calendar.job.noAddress` | No address | Sin dirección |
| `calendar.job.newAddress` | New address | Dirección nueva |
| `calendar.job.meet` | How you'll meet | Cómo se verán |
| `calendar.job.inPerson` / `byPhone` / `byVideo` | In person / Phone / Video | En persona / Por teléfono / Por video |
| `calendar.job.sendConfirmation` | Send {first} a confirmation | Enviarle una confirmación a {first} |
| `calendar.job.sendMoved` | Email {first} the new time | Enviarle a {first} el nuevo horario por correo |
| `calendar.job.noEmail` | {first} has no email on file, so we can't send one. | {first} no tiene correo registrado, así que no podemos enviarle uno. |
| `calendar.job.emailBlocked` | {first}'s email can't receive our emails. | El correo de {first} no puede recibir nuestros mensajes. |
| `calendar.job.checkFirst` | Check before you save: | Revise antes de guardar: |
| `calendar.job.warn.outsideHours` | Outside your open hours | Fuera de su horario |
| `calendar.job.warn.notice` | Sooner than your usual notice | Antes de su aviso habitual |
| `calendar.job.warn.closed` | You're closed that day | Ese día está cerrado |
| `calendar.job.warn.overlaps` / `One` | Overlaps {count} jobs / Overlaps a job at {time} | Se empalma con {count} trabajos / Se empalma con un trabajo a las {time} |
| `calendar.job.warn.noVideo` | Video calls aren't set up, so this job won't have a link. | Las videollamadas no están configuradas, así que este trabajo no tendrá enlace. |
| `calendar.job.past` | That time has already passed. Pick a time from now on. | Esa hora ya pasó. Elija una hora de ahora en adelante. |
| `calendar.job.changed` | Something changed while you were looking. Check the notes and save again. | Algo cambió mientras revisaba. Revise los avisos y guarde de nuevo. |
| `calendar.job.save` / `saveMove` | Add job / Save new time | Agregar trabajo / Guardar nuevo horario |
| `calendar.job.saveAnyway` / `moveAnyway` | Add it anyway / Move it anyway | Agregarlo de todos modos / Cambiarlo de todos modos |
| `calendar.job.saveFailed` | Couldn't save this job. Nothing changed. Try again. | No se pudo guardar este trabajo. No cambió nada. Intente de nuevo. |
| `calendar.job.added` | Job added for {first}, {when}. We'll email the confirmation when this closes. | Trabajo agregado para {first}, {when}. Le enviaremos la confirmación cuando se cierre este aviso. |
| `calendar.job.addedQuiet` | Job added for {first}, {when}. | Trabajo agregado para {first}, {when}. |
| `calendar.job.undo` | Undo | Deshacer |
| `calendar.job.undone` | Job removed. {first} wasn't told. | Trabajo eliminado. No se le avisó a {first}. |
| `calendar.job.undoTooLate` | Too late to undo: the confirmation already went to {first}. Cancel the job instead. | Ya es tarde para deshacer: la confirmación ya le llegó a {first}. Mejor cancele el trabajo. |
| `calendar.job.undoMovedSince` | This job was moved since, so it can't be undone from here. | Este trabajo se cambió de horario después, así que no se puede deshacer desde aquí. |
| `calendar.job.moved` | Moved to {when}. We'll email {first} when this closes. | Se cambió a {when}. Le enviaremos un correo a {first} cuando se cierre este aviso. |
| `calendar.job.movedQuiet` | Moved to {when}. | Se cambió a {when}. |
| `calendar.job.edited` | Job updated. | Trabajo actualizado. |
| `calendar.job.moveUndone` | Back at {when}. | De vuelta a las {when}. |
| `calendar.job.moveUndoTaken` | Another job took the old time, so it can't go back. | Otro trabajo ocupó el horario anterior, así que no puede regresar. |
| `calendar.job.emailSent` | Confirmation emailed {time} | Confirmación enviada {time} |
| `calendar.job.emailPending` | We'll email the confirmation in a few seconds | Enviaremos la confirmación en unos segundos |
| `calendar.job.emailFailed` | Couldn't email the confirmation | No se pudo enviar la confirmación |
| `calendar.job.openRecord` | Open record | Abrir ficha |
| customer email line `where` | Where | Dónde |

---

## 10. Tests, each with the mutation that must turn it red

Working rule 2 binds: run each mutation, confirm the named test fails, paste the line. A `-t` filter matching no
name proves nothing.

### 10.1 Schema (`DB/test/calendar-agenda-schema.test.ts`, new; the local replica)

| Test | Mutation that must fail it |
|---|---|
| Two overlapping `person` rows both insert | drop `and author_kind <> 'person'` from the constraint |
| A customer (`system`) row overlapping a live `person` row is `SlotTakenError`, code 23P01, message naming `bookings_no_overlap` | drop the trigger's `exists`; then `errcode` to `P0001` |
| Two overlapping customer rows: still `SlotTakenError` | constraint predicate `author_kind = 'person'` |
| A customer row starting exactly at a staff job's end saves | `tstzrange(..., '[]')` in the trigger |
| A cancelled customer row flipped back to `booked` over a staff job is `SlotTakenError` (UPDATE path) | trigger `before insert` only |
| `undo_ai_booking_act`'s `booking_cancelled` answers `time_taken` when a staff job took the time | `errcode` to `P0001` |
| **Race, staff first:** connection 1 inserts a staff row and holds its transaction; connection 2's overlapping customer insert waits (seen in `pg_locks`), and fails 23P01 when 1 commits | remove `for no key update` (2 no longer waits and succeeds) |
| **Race, customer first:** the reverse order: the staff insert waits, then saves | make the trigger check staff rows too (the staff insert is refused) |
| A place of another account is refused (23503) | single-column FK |
| `bookings_hold_staff_only`, `bookings_notice_wanted_check`, `bookings_notice_sent_after` each refuse | drop each |
| `undo_staff_move`: undone restores the old row and deletes the new; `too_late` after a settle; `time_taken` when a staff job took the old time | drop each branch |
| `app.bookings_slot_guard` is in `EXPECTED_DEFINERS` | (the guard test itself) |

The race tests commit, so they run only on this machine, with `access-log-concurrency.test.ts`'s `onThisMachine`
guard (`DB/test/access-log-concurrency.test.ts:17-33`).

**Existing tests this changes.** Five tests write their colliding rows through `createBooking` with the default
`user` actor, so after 0107 those rows no longer collide: `booking.test.ts:66` ("refuses an overlapping booking"),
`:390` (D-036 un-cancel), `:1533` (move into a live range), and `ai-acts-schema.test.ts:459` and `:518`. Each is
rewritten so the row it collides with is customer-made (`"system"`), keeping its assertion, and `booking.test.ts`
gains the person-person test above beside it. The plan reads each fixture before editing it.

### 10.2 Query layer (`DB/test/booking.test.ts`)

- `listDueReminders` skips a row with `hold_until` in the future and lists it once past (mutation: drop the filter).
- `moveBooking` carries `place_id` and `meeting_type` (mutation: omit them from the input).
- The settle's claim and the Undo's delete: one wins in either order (mutation: drop `hold_settled_at is null` from
  the delete).
- `listAgendaBookings` returns rows overlapping the window, not only starting in it (a job from 23:00 to 01:00 is on
  both days; mutation: filter on `starts_at` only); a Technician's client sees only their customers' rows (mutation:
  read on the service client).

### 10.3 Pure (`WEB/lib/booking/*.test.ts`)

- `jobWarnings`: each warning alone, with two jobs that share nothing else (the adjacent-satisfaction shape); the
  notice boundary exactly at `now + min_notice_hours` is not a warning (mutation: `<=`); a closed day by range and
  by a storm; an overlap names the earliest overlapping start in the account's zone; back-to-back is no overlap.
- `agendaWindow`: day and week windows on America/Chicago 2026-03-08 and 2026-11-01, America/Havana (midnight is
  the gap, `startOfDay` answers 01:00, `status.ts:108-111`), Pacific/Kiritimati (UTC+14) and 2028-02-29, each
  pinned to exact ISO instants (mutation: `+ 24h` for the next day).
- `agendaLanes`: two overlapping make two lanes, back-to-back one, a cancelled row none (mutation: `<=` in the
  overlap test).
- The fall-back day's two "1:30" rows carry different zone names (mutation: drop the offset-change check).

### 10.4 Actions and UI

`agenda-actions.test.ts`: a Technician is refused before any read; a warning not in `seen` writes nothing; a
second press with the same warnings writes; a new warning between the presses writes nothing; "Add as new" passes
`matchBy: "email_only"`; `closure_kept_at` is stamped only when the closed warning was accepted; `after()` is
scheduled; Cancel inside the hold calls the add's Undo. `job-hold.test.ts`: a lost claim sends nothing; a started
job is settled without email; a failed send is not retried. Page tests: the agenda renders before the settings card,
Add job is in the card and not in `PageHeader`, the error state leaves the other cards. `messages.test.ts` pins
every key in both languages under the `INTERNAL_MILESTONE` guard. `classes.test.ts` and `scans.test.ts` change by
the two kinds (bis-comms).

### 10.5 e2e (bis-e2e-qa runs it)

`apps/web/e2e/calendar-agenda.spec.ts`, **on the per-run fixture account only, never `Test Client One`**: tap a
free hour, add a job for a seeded customer, see it on the Day; Undo, see it gone; add one outside open hours, see
the warning and "Add it anyway", then the row tagged; open the public page for that day and see that time not
offered; open the drawer from the row, Esc closes it; open `?job=<id>` and see the drawer. No unit test spans the
action, the database, the public picker and the drawer together.

---

## 11. Rollout

1. 0107 on the local replica, guard tests before and after.
2. bis-ci through `ci-project-setup.yml` (the `e2e` job refuses the branch until it is there).
3. Production (MCP `apply_migration`, once), after the read-only bookings count (3.4).
4. The parity check (`docs/runbooks/ci-supabase-project.md`).
5. Merge. The `jobHolds` pass ships in the same PR as the agenda, so no hold exists without its backstop.

---

## 12. Tasks (tiers per the speed process)

| Task | Tier | Owner | Files |
|---|---|---|---|
| T1 0107 and its schema tests; the five existing tests (10.1) | **HIGH** | bis-db-schema | `MIG/0107_calendar_agenda.sql`, `DB/test/calendar-agenda-schema.test.ts`, `booking.test.ts`, `ai-acts-schema.test.ts`, `definer-search-path.test.ts` |
| T2 Query layer: `createStaffJob`, `moveBooking`'s carry, `listAgendaBookings`, the hold claim and Undo, the reminder hold filter, per-row feed kind | **HIGH** | bis-booking | `DB/booking.ts`, `DB/index.ts` (additive), tests |
| T3 Sending: the two kinds, the templates' address line, `settleJobHold` | **HIGH** (sends to customers) | bis-booking, bis-comms co-review | `CAL/job-hold.ts`, `WEB/lib/email/templates/booking.ts`, `WEB/lib/consent/classes.ts` (bis-comms) |
| T4 The `jobHolds` pass; the hold filter in the text reminder and appointment confirm | **HIGH** (sends) | bis-automations | `passes/job-holds.ts`, `registry.ts`, `fanout.ts`, `DB/automations.ts`, `cron-coupling.test.ts` |
| T5 Pure rules | medium | bis-booking | `WEB/lib/booking/job-warnings.ts`, `agenda-window.ts`, `agenda-lanes.ts` |
| T6 `removePlace` archives a place a job names | low | bis-crm | `DB/places.ts` |
| T7 The agenda, sheet, drawer, actions, page order | medium | bis-booking with bis-frontend review | `CAL/*` |
| T8 Strings | low | bis-booking | `WEB/lib/messages.ts` |
| T9 Links into the page: `affected-appointment-row.tsx:72`'s `#booking-` anchor becomes `?job=`; the setup hours link (`ACCT/setup/steps/step-shared.tsx:74`) scrolls to the settings card; palette terms | low | bis-booking | those files |
| T10 Sofía's reschedule mints a room by the booking's own type, not the calendar's (`registry.ts:744`) | low | bis-voice | `registry.ts` |
| T11 e2e | medium | bis-e2e-qa | `apps/web/e2e/calendar-agenda.spec.ts` |

Waves: T1, T5, T8 first; T2 and T6 on 0107; T3, T4, T7, T9, T10 on T2; T11 last.

---

## 13. Deferred

- The job card, visit statuses and photos (F-046 part 2, `docs/crm-features.md:1511`).
- Services with their own lengths, job questions, the F-015 address component (F-047).
- Drag-and-drop, a month view, per-staff calendars and assignment on a job (S-23), resources (decision 22).
- Text confirmations and moved texts (A2P).
- A customer's Spanish emails in `usted`: today's confirmation and moved templates speak `tú`
  (`templates/booking.ts:26-33`). One voice per customer across their emails matters more than this spec's new
  line; bis-comms decides it for every customer template at once.
- Editing a quick-added customer from the sheet; it is edited on their record.

---

## 14. Where the rulings meet DESIGN.md (flagged, not silently changed)

1. **Rule 8 and Add job.** R6 says Add job is "the one primary". It is, inside the Agenda card; in `PageHeader` it
   would be a page-level primary above cards with their own, which rule 8 forbids (5.1).
2. **Rule 8 and the drawer.** Move, Cancel, Completed and No-show write the same row, so they are one view and may
   carry at most one primary. None is the drawer's obvious decision, and Move only opens a form whose own Save is
   that form's primary. The F-118 amendment exempts "a chooser of mutually exclusive single-step actions" from a
   primary; Move is not single-step. **Recommendation:** the drawer carries no primary, by that amendment's reasoning,
   and DESIGN.md gains one line saying so. Needs a ruling.
3. **Record views: "deep link opens full page".** R10 says a deep link opens the drawer. There is no job page until
   the job card (part 2), so `?job=` opens the agenda on the job's day with the drawer open; when part 2 lands, the
   deep link moves to the job card.
4. **Rule 6 and Move.** R10 does not say Move has Undo; rule 6 requires it of a reversible action, so 6.3 gives it one.
5. **Definition of done, English and Spanish.** The list this replaces is English-only (`CAL/bookings-list.tsx:45-67`);
   the agenda is bilingual from day one, which adds Spanish twins to keys the drawer reuses.
6. **Module contract.** Satisfied: the agenda is the Calendar page's first card, not a new surface.

---

## 15. Corrections (the source against the brief)

1. **"Calendar page … Technician home screen."** A Technician's home is To do, not the calendar
   (`WEB/lib/auth.ts:141-142`); the calendar is in their nav (`WEB/lib/nav-groups.ts:98-117`).
2. **"Background jobs table + enqueue() … CRON_FANOUT off" as a backstop.** With the switch off nothing drains the
   queue: `jobsDrain` is a fan-out node only (`fanout.ts:79`), absent from `PASSES` (`registry.ts:73`). The backstop
   is a pass (6.5).
3. **"Confirmation email to the customer" as the public page's.** `booking.confirmation` is `customer_initiated`
   and scan 4 forbids it outside the customer's own request (`scans.test.ts:807-825`). Two new kinds (6.6).
4. **"A follow-up action the client fires when the toast closes."** The house pattern is server-side: `after()` in
   the action plus a durable copy and a sweep (`CAL/actions.ts:340-362`). A browser-fired settle is not needed and
   would not run when the tab closes, which is the case the backstop exists for.
5. **"Reminders follow the account's settings as today."** Unchanged, except they must wait out the hold: the
   day-before window has no minimum age (`DB/booking.ts:1592-1596`), so a reminder could reach a customer for a job
   that is then undone (6.5).
6. **"Staff may book … on a closed day."** Allowed, but without `closure_kept_at` the closure would hold or skip that
   job's reminders (`closures.ts:196-213`); the add stamps it (6.1).
7. **R11's "staff-made = author_kind 'person'"** also covers the demo seed and every `createBooking` call that omits
   its actor type (`DB/provenance.ts:31-35`), so five existing tests lose their collision (10.1).
8. **F-046 part 1's roadmap row depends on F-107 part 2** (`docs/crm-features.md:1420`), the bottom-tab shell, which
   is not built. This design works in today's shell at 375 px and does not wait; the orchestrator updates the row.
9. **`listCalendarBookings` "the operator's list".** It is also the source of the close-out of past jobs on this
   page (`DB/booking.ts:1095-1101`); that duty moves to To do and the agenda's one line (5.1), not lost.
10. Verified as the brief stated: `createBooking :278`, `listBookedRanges :248`, `listFeedBookings :817`,
    `moveBooking :928`, `listCalendarBookings :1105`, `listDueReminders :1585`, `computeSlots :288`, the public
    submit `:178`, the four staff actions' lines, `calendars_one_per_account` (`0016:11`), `bookings_no_overlap`
    (`0016:60`), the author kinds (`0073:59-64`), no assignee and no meeting type on bookings, no client UPDATE on
    bookings.

---

## 16. Owner decisions on the open questions (2026-10-30, all as recommended)

1. **Technicians keep Completed / No-show** on their own customers' jobs (`CAL/actions.ts:214-219`); "view only"
   means no add, move or cancel.
2. **The job drawer carries no primary** (14.2): Move, Cancel, Done and No-show are equal ghost buttons, and
   DESIGN.md gains one line saying so (the same reasoning as the 2026-10-29 one-shot action tiles amendment).
3. **Both new email kinds use the `transactional` class** (6.6); bis-comms updates `classes.test.ts:111-113`'s pin
   in the same commit.
4. **The customer's email shows the job address** on one line; the "what the job is" line never reaches the
   customer.
5. **A staff-made job counts as a booking everywhere** (D12): the dashboard and the weekly report, one definition.

---

## 17. Plan review corrections (2026-10-30; the plan's "Plan review fixes" carries the detail and the replica proofs)

1. **Lock order.** Every unit that writes more than one booking takes the account's calendar row (`for no key update`)
   before its first booking write. `undo_staff_move` does so first; 0107 replaces 0091's `undo_ai_booking_act` with
   that one statement added after its `ai_acts` lock. Without it, its reschedule undo deadlocked with a customer
   insert over the booking being taken back (reproduced on a PG17.6 replica).
2. **Holds are claimed on booked rows only** (`claimJobHold`, the pass's read). A staff move's new row is written with
   no `notice_wanted`; the action decides it after the cancel, from a re-read of the old row: unclaimed and wanting a
   confirmation → `'confirmation'`; otherwise `'moved'` when ticked. The Undo of a move re-arms the restored row with
   one `after()` settle, waiting out what is left of its own hold.
3. **The add's Undo never deletes a move's row** (`rescheduled_from_id is null`). The drawer's Cancel on a held move runs
   the ordinary cancel flow.
4. **Reminders wait for the claim, not the clock:** `hold_until is null or hold_settled_at is not null`.
5. **D8 covers moves:** a staff move's `booking.created` and the old row's `booking.status_changed` are written by the
   settle of the new row; `moveBooking` writes none for a staff move, so an undone move leaves no event.
6. **A new address for a new customer:** the action makes the contact, then the place, then the job.
