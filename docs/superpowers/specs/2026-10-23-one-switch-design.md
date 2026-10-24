# S-47 part d: the one switch (open, closed today, running late, storm) and planned closed days (F-084, migration 0097)

Status: owner decisions D1–D7 fixed in conversation 2026-10-23, and the design of sections 4 and 5 (the data,
the status reader, the slot engine and the prompt) approved the same day. This draft fills in the rest. The
choices it makes that the decisions did not dictate are listed as S1–S22 in section 2. The owner answered the
first draft's four questions the same day (D8–D11); there are no open questions (section 10). The plan review
(2026-10-23) added owner ruling D12 (Closed today's window ends at midnight), the orchestrator's S22 (the
dashboard card lists every covered appointment up to 14 days), and four fixes folded in below: the Staff
26-hour bound (4.1), the two-day trigger slack (4), Keep read per subject (5.5.2) and the plain-insert
cross-account probe (7). Part d of S-47 (parallel work, `docs/crm-features.md` §4.3, row "↳ F-084",
2 ew: "the switch, closures in the slot engine, the prompt line, the owner grant"). Parts a (F-034, #279), b
(F-174 part, #280–#283) and c (F-037 part 1, #284) have shipped; e (identity checks, F-116 part) follows in
its own spec.

## 1. Why

Today nothing in the product knows that a business is closed for the day, running behind, or shut by a
storm, and nothing knows about a holiday:

- **The booking page keeps selling.** Slots come only from the calendar's weekly `open_hours`
  (`apps/web/src/lib/booking/slots.ts`, `SlotConfig`); there is no dated exception anywhere. The only
  off-switch is `calendars.enabled`, which 404s the whole page (`app/b/[publicId]/data.ts`,
  `isCalendarLive`).
- **Sofía says "we're open".** S-47c gave her structured weekly hours and a "Right now" line
  (`lib/voice/knowledge/hours.ts`, `openNow`), but a closure exists only as free text in Facts (the
  BUSINESS HOURS heading defers to "a closure written above for a specific date").
- **The reminders still go out.** Closing hides nothing that is already booked: tomorrow's reminder, the
  confirmation ask and the follow-up all send on their own timers
  (`lib/automations/passes/*.ts`, through `holdOrSend`).

The plan's row: "One tap tells Sofía, the booking page and the chat that the business is closed, late or shut
by a storm" (`crm-features.md` row F-084). Binding decisions this spec obeys: **decision 28**, the middle
option (owners edit status and closures now; facts stay agency-only until F-037 part 2; guardrails never),
which D1 settles for F-084; **decision 21** ("a caller who asks for a person is still transferred", the storm
wording), which S-47c's C14 and C19 already implement and section 5.4.2 reuses unchanged; and the
**bilingual sequencing rule** (`crm-features.md` §4.1: "F-084's switch and its owner grant ship … with their
English and Spanish strings written out").

## 2. Owner decisions

Fixed by the owner (2026-10-23):

- **D1 Who flips it.** A client's Owners and the agency. Staff and Technicians see the status but cannot
  change it (D8 later carves out Running late for Staff). This settles decision 28 as the middle option for F-084: owners edit status and closures now;
  facts stay agency-only until F-037 part 2; guardrails never.
- **D2 Existing appointments inside a closure are kept.** Nothing is cancelled or sent automatically.
  Flipping to Closed today or Storm files ONE To-do, "Contact today's customers", listing each affected
  booking with a link. (Widened by the orchestrator ruling of 2026-10-23, S7: it files whenever the closure
  covers an appointment in the card's 14-day window, titled "Contact customers affected by the closure".) The owner uses the existing per-booking cancel and its notice (F-048,
  `calendar/actions.ts`, `cancelBookingAction`).
- **D3 Each state reverts on its own.** Closed today ends at the next opening: the business hours
  (S-47c `voice_profiles.business_hours`) if set, else the calendar's `open_hours`, else midnight in the
  account's zone. Running late ends at the end of today, or when someone taps Open. Storm lasts until someone
  taps Open; an optional "back on" date reopens it that morning, at the first opening of that date. Expiry
  is computed on read: `until` is stored and compared with now. No cron is needed for the state itself.
  (Closed today's end is amended by D12: its window ends at midnight; the next opening is what is said.)
- **D4 Running late.** The owner picks about 15, 30 or 60 minutes, or "over an hour". Sofía (phone and chat)
  tells callers asking about today's visits "running about N minutes behind". Booking stays open, but
  today's slots that start within the delay are hidden. No texts go out on their own.
- **D5 Closed days.** Planned whole-day closures: a date or a date range, plus an optional reason from a
  fixed list (holiday, vacation, other; no free text, because it reaches the prompt). Special shorter hours
  on a date are out of scope (later). The booking page offers no slots on those days, Sofía and the chat say
  so, and the open-now line counts them.
- **D6 Reminders are held.** While a closure covers an appointment (Closed today, Storm, or a closed day),
  its automatic reminders, confirmations and follow-ups are HELD, not sent, and listed in that To-do. They
  go out on the next run if the closure ends or the owner keeps the appointment.
- **D7 Where it lives: existing surfaces only.** The topbar Sofía indicator shows the status to everyone, as
  dot + word ("● Closed today · opens 8 AM"); for Owners and the agency it opens a menu: Open; Closed
  today; Running late (15 / 30 / 60 / over an hour); Storm (optional back-on date). One tap applies the
  change, with an Undo toast. The account dashboard shows a status card under the greeting with the state,
  when it ends, and today's affected appointments. The Calendar page gets a "Closed days" card beside the
  hours the booking page uses; Owners and the agency edit it, Staff view it. All copy is in English and
  Spanish (usted) from the start.

The owner's answers to the first draft's questions (2026-10-23):

- **D8 Staff may set Running late** (Q1), and may go back to Open from Running late only. Closures (Closed
  today, Storm, closed days) stay with Owners and the agency, and a Staff member cannot reopen from one.
  Enforced twice: the update policy's Staff branch (4.1) and the action's guard (5.2), which match. Staff get
  a two-item menu (5.6.1). Technicians still change nothing.
- **D9 The Spanish topbar drafts are approved as written** (Q2, section 6). The plan pins them as literal
  fixtures, as C18 did for the price sentences.
- **D10 A storm does not stop the website chat's lead capture** (Q3). The chat keeps capturing leads in every
  state; the TODAY line makes her say the business is closed.
- **D11 "Over an hour" hides the next 2 hours of today's slots** (Q4): stored as `late_minutes` 120 (S2).
- **D12 "Closed today" blocks bookings and holds reminders only until midnight tonight** (owner ruling on the
  plan review, 2026-10-23), in the account's zone. The closure WINDOW that the slot engine and the hold use is
  `[set_at, end of today)`, and `until` stores that midnight. The status line, the topbar and Sofía's TODAY line
  still say when the business next opens: the reopening phrase from the hours chain (S1, computed on read from
  `until`). This closes the gap where two hours sources disagree (business hours Monday to Friday, the calendar
  open on Saturday): a Saturday customer is never silently held or refused because a Friday closure was
  computed from the other hours. A closed day's window is the closed dates themselves, the same principle.

Spec choices the decisions left open (made in this draft; each is pinned where it is specified):

- **S1 "Closed today" says it reopens at the first opening on a LATER day**, never later the same day (D3's
  "next opening" read literally would reopen a business closed at 7 AM at its own 8 AM). Amended by D12: the
  switch stores `until` = midnight at the end of today, which is where the closure WINDOW ends; the reopening
  that is said and shown is computed on read as the first opening at or after that midnight, skipping closed
  days (5.1). After midnight the row has expired and reads as open (D3: expiry on read).
- **S2 "Over an hour" is stored as 120 minutes**: it hides the next two hours of today's slots, and Sofía
  says "more than an hour" (the window confirmed by the owner, D11).
- **S3 A storm's back-on date** is tomorrow at the earliest and 92 days ahead at the latest.
- **S4 A closed-day range** is at most 92 days long and must END within 12 months; it may not start in the
  past or overlap another range (the action refuses an overlap; the database does not).
- **S5 The write path** follows the calendars precedent: the server creates the account's one
  `business_status` row; a signed-in Owner or the agency (or Staff, within D8) UPDATEs three columns of it
  under RLS; `closed_days`
  takes a signed-in INSERT of four columns and a DELETE. Who and when are stamped by triggers from the token,
  never sent by the browser (4.1).
- **S6 `calls.business_status` is one code** from a closed set (`open`, `closed_today`, `running_late_15`,
  `running_late_30`, `running_late_60`, `running_late_120`, `storm`, `closed_day`); NULL means unknown (a call
  before this build, or a failed read).
- **S7 The To-do links to its list.** A To-do row has a title and one link and no body
  (`tasks`, 0003; `work-list.tsx`), so it cannot itself carry several links. It links to the dashboard status
  card, which lists each affected booking with its own link (5.5.1, 5.6.2). It is filed whenever the closure in
  force covers at least one booked, not-kept appointment in the card's window (S22: now through the closure
  window's end, at most 14 days ahead), not only when today has one (orchestrator ruling, 2026-10-23,
  implementing D2 beside S22: a dated storm with nobody booked today but customers later in the week still
  owes those calls). At most once per account per day, and Undo of the flip removes it while it is open. Its
  title is "Contact customers affected by the closure" / "Comuníquese con los clientes afectados por el
  cierre", since the customers need not be today's.
- **S8 Adding a closed day that covers booked appointments files one To-do too** ("Contact customers booked
  on {dates}"), linking to the Closed days card, where that range's appointments are listed (5.5.1).
- **S9 Keep is a per-booking mark** (`bookings.closure_kept_at`), set from the dashboard card's list of
  covered appointments (S22) or the Closed days card's per-range list on the Calendar page, by whoever may
  cancel a booking there today (Owners, Staff, the agency; not Technicians), with Undo. The main Calendar
  bookings list gains only each row's `booking-{id}` anchor, which "Cancel on the calendar" links to.
- **S10 The hold** covers every recipe whose subject is a booking (reminders, the text reminder, the
  confirmation ask, the follow-up, the no-show nudge, the review request, the referral ask). It holds until
  the end of the closure window (D12: midnight for Closed today; the end of the last closed date; a storm's
  `until`) or the subject's own deadline, whichever is first; every switch change, Keep and closed-day
  removal makes the account's held rows due on the next tick (`bumpHeldForAccount`, which exists and has no
  caller today); a failed closure read holds for 15 minutes rather than sending (5.5.2).
- **S11 Precedence:** Storm, then a closed day, then Closed today, then Running late, then Open. On a closed
  day the menu's Open item is replaced by "Change closed days", a link to the card.
- **S12 The Right now line counts closures** (D5 asks it for closed days; a closure set by the switch is the
  same fact), and a reopening more than seven days away is said with its date.
- **S13 An open-ended storm drops the AFTER HOURS line's booking clause.** `bookingMode` and the tool list do
  not change: the slot engine returning no times is the guarantee, and the prompt stops inviting a booking.
- **S14 Upcoming closed days are a CLOSED DAYS block in the prompt** (from the snapshot payload, at most 20,
  soonest first), so she can answer "are you open on the 24th?".
- **S15 The topbar.** Open: the indicator is unchanged (on-call pulse or the week's count) and, for Owners
  and the agency, and for Staff (D8), is the menu's trigger; an account with no enabled voice profile shows
  them "● Open" as the trigger and shows Technicians nothing, as today. Not open: the status replaces the idle
  count for everyone. After a change the topbar shows the action's answer at once; otherwise it refreshes on
  navigation, never by polling (the shell's rule, `components/shell-data.tsx`).
- **S16 The dashboard card while open** is one compact line, plus the next closed day when one is within 14
  days.
- **S17 Failure modes.** The prompt fails open on a status read failure (no TODAY line, the call unstamped);
  the slot engine fails like a failed bookings read (the caller's existing error path, never a slot during an
  unknown closure); the topbar and the card fall back to their own error states.
- **S18 The booking page notice** has three variants (closed today or a closed day; a storm with no date; a
  storm with a date). Running late shows no notice. A closed day in the picker says "Closed this day."
- **S19 The call page's "Status at the start" line** shows to everyone who can see the call, not only the
  agency: it explains to an owner why Sofía said "closed".
- **S20 The chat reads the status on every turn** (the approved design: "the chat recomputes it on each
  turn"); its closed days come
  from its stamped snapshot, as all its knowledge does (S-47c C4).
- **S21 Events.** `business_status.changed`, `closed_day.added`, `closed_day.removed` and
  `booking.closure_kept`, each through `record_event` on the signed-in client (0053), so the actor is the
  token's.
- **S22 The dashboard card lists every covered appointment** (orchestrator ruling on the plan review,
  2026-10-23, implementing D2): each booked appointment the closure in force covers, from now through the
  closure window's end but at most 14 days ahead (a dated storm, a multi-day closed-day range; an open-ended
  storm shows 14 days), each with its own Keep. When the cover runs past those 14 days, one line says more
  appointments after that date are on the calendar. The To-do still links to this card (S7), and is filed
  from the same window (S7, widened the same day), so the To-do and the card never disagree about who is
  affected.

## 3. Scope

**In:** migration 0097 (two tables, four columns, two trigger functions, the re-created To-do link guard);
the pure status reader; closures in the slot engine for every caller; the TODAY line, the CLOSED DAYS block
and the Right now change in the prompt, on all three surfaces; `calls.business_status`; the To-do and the
reminder hold; the topbar menu, the dashboard status card, the Closed days card, the booking page notice and
the call-page line; copy keys in English and Spanish; unit, route, db and e2e tests.

**Out (and where it goes):** special shorter hours on a date (later; see finding F3 in section 10's preamble
and `crm-features.md` row 2, "F-084 owns the special-hours record"); cancelling or texting customers
automatically (D2); Google profile hours (F-161, decision 32); per-staff calendars; owners editing facts
(F-037 part 2); hiding the website chat's lead capture during a storm (not done, D10); any trade-module change (the
modules are paused, S-47c C12).

## 4. Data (migration 0097, tier HIGH)

**Numbering.** 0096 is taken by the concurrent follow-ups PR that hardens `SECURITY DEFINER` search paths.
0097 must reach bis-ci AFTER 0096 (the CLI applies in order, and the e2e job's
`ci-migrations-applied.sh` names any file missing from bis-ci's history), and production after 0096 too.

**Search paths (0096's rule, binding on this file).** 0096 (`fix/s47c-followups`, merging before 0097) sets
`search_path = pg_catalog, pg_temp` on every function in `public` and `app` that has a search_path setting,
because `''` still searches the session's `pg_temp` first; and it adds
`packages/db/src/test/definer-search-path.test.ts`, which pins the 22 `SECURITY DEFINER` functions by name
(`EXPECTED_DEFINERS`) and asserts that every function with a `search_path` lists `pg_temp` last. Therefore
every function 0097 creates or re-creates (`app.business_status_stamp()`, `app.closed_days_stamp()` and the
re-created `app.keep_task_links()`) writes `set search_path = pg_catalog, pg_temp`, NEVER `set search_path =
''` (a `create or replace` replaces the whole SET clause, so copying 0084's text with `''` would undo 0096 for
that function and fail the guard). Bodies schema-qualify every name, as they already must. `keep_task_links`
is re-created from its definition as it stands after 0096 (plan Task 0 reads it off main once 0096 has
merged), plus the two new lines per branch. 0097 adds no `SECURITY DEFINER` function, so `EXPECTED_DEFINERS`
does not change; were the plan ever to add one, it would be added to that list by name in the same commit.

```
business_status                       one row per account; absent = open
  account_id   uuid pk references accounts(id) on delete cascade
  state        text not null default 'open'
               check (state in ('open','closed_today','running_late','storm'))
  late_minutes integer null  check (late_minutes in (15, 30, 60, 120))     120 = "over an hour" (D11, S2)
  until        timestamptz null
  set_by       text not null default 'system'   stamped by trigger: the token's sub, else 'system'
  set_at       timestamptz not null default now()   stamped by trigger
  business_status_shape_check:
    open          late_minutes null, until null
    closed_today  late_minutes null, until not null
    running_late  late_minutes not null, until not null
    storm         late_minutes null, until null (until further notice) or not null (a back-on date)
  business_status_until_check: until is null or (until > set_at and until <= set_at + interval '100 days')

closed_days
  id          uuid pk default gen_random_uuid()
  account_id  uuid not null references accounts(id) on delete cascade
  starts_on   date not null
  ends_on     date not null
  reason      text null  check (reason is null or reason in ('holiday','vacation','other'))
  created_by  text not null   stamped by trigger
  created_at  timestamptz not null default now()   stamped by trigger
  closed_days_range_check: ends_on >= starts_on and ends_on - starts_on <= 91      (at most 92 days, S4)
  index closed_days_account_ends (account_id, ends_on)

calls.business_status   text null  check (business_status in ('open','closed_today','running_late_15',
                          'running_late_30','running_late_60','running_late_120','storm','closed_day'))  (S6)

tasks.closure_kind      text null  check (closure_kind in ('status','closed_day'))
tasks.closure_on        date null
  tasks_closure_coherent: (closure_kind is null) = (closure_on is null)
  unique index tasks_closure_once on tasks (account_id, closure_kind, closure_on) where closure_kind is not null

bookings.closure_kept_at  timestamptz null   the owner kept this appointment through a closure (S9)
```

- **Triggers** (plain `plpgsql`, not definer, `set search_path = pg_catalog, pg_temp`).
  `app.business_status_stamp()` BEFORE INSERT OR UPDATE on `business_status`: `set_at :=
  now()`, `set_by := coalesce(nullif(app.jwt() ->> 'sub', ''), 'system')`, whatever was sent.
  `app.closed_days_stamp()` BEFORE INSERT on `closed_days`: stamps `created_at` and `created_by` the same way,
  and refuses (errcode `23514`) a row with `starts_on < current_date - 2` or `ends_on > current_date + 367`
  (the 12-month window of S4, with slack for the account's zone; the action enforces the exact window in the
  zone first, so the operator gets a sentence). The slack is two days at the start because `current_date` is
  the UTC date: at 7:30 PM in Chicago it is already tomorrow in UTC, and an Undo that re-adds a range which
  started yesterday locally must still pass (plan review, 2026-10-23). The window is a trigger, not a CHECK,
  because a CHECK must not read the clock.
- **`app.keep_task_links()`** re-created (its post-0096 text, `search_path = pg_catalog, pg_temp`, plus two
  lines on each branch): a signed-in INSERT
  stores NULL in `closure_kind` and `closure_on`, a signed-in UPDATE keeps them. Only server code links a
  To-do to a closure, as with every other To-do link (0064, 0080, 0084).
- **No reach into the past.** `business_status` keeps only the current row; its history is the
  `business_status.changed` events (S21) and, per call, `calls.business_status`.
- **Comments** on every new table and column in 0095's style: who writes it, through what, and what NULL
  means. The header follows 0095: WHY, WHAT THIS FILE ADDS, WHO WRITES, GRANTS AND POLICIES, TEARDOWN (neither
  table goes in `ACCOUNT_OWNED_TABLES`; the account delete cascades, and service_role holds no DELETE on
  `business_status`), LOCKS (`lock_timeout` 5s in a `do` block; the ALTERs take ACCESS EXCLUSIVE on `calls`,
  `tasks` and `bookings` for the file's length), APPLY ORDER, LOAD-BEARING, SAFE UNDER THE RUNNING BUILD,
  ROLLBACK, and "ASCII only, no backslash anywhere".
- **Rollback** (roll the app back first), in this order: re-create the previous `app.keep_task_links()`
  exactly as 0096 left it, `search_path = pg_catalog, pg_temp` included (FIRST: it names the two task
  columns); drop index `tasks_closure_once`; `alter table tasks drop
  constraint tasks_closure_coherent, drop column closure_on, drop column closure_kind` (lost: each closure
  To-do's link; the To-dos stay as plain To-dos); `alter table bookings drop column closure_kept_at` (lost:
  which appointments were kept; their held messages then follow the closure alone); `alter table calls drop
  column business_status` only on an owner decision (it drops what each call was told); `drop table
  closed_days`, `drop table business_status` (their triggers go too); drop the two stamp functions. Dropping
  the two tables loses every planned closed day and the current switch, so it is an owner decision too.

### 4.1 Grants, policies and the client-write digest

This is the first client-role write in this area (S-47c's tables have none), so both grant tests move, in the
same commit as the migration.

- `business_status`: `revoke all … from public, anon, authenticated, service_role`; `grant select to
  authenticated, service_role`; `grant update (state, late_minutes, until) to authenticated`; `grant insert
  to service_role` (the server creates the row, `ensureBusinessStatusRow`, `insert … on conflict do nothing`,
  as `getOrCreateCalendar` does for calendars and for the same reason: the client role holds no INSERT).
  RLS on. Policies: `business_status_member_read` for select to authenticated using `(app.is_agency() or
  account_id = app.current_account_id())` (0077's shape: every member, Technicians included, D7);
  `business_status_update` for update to authenticated, with an Owner branch (0066's shape) and a Staff
  branch (D8), every helper coalesced (the plpgsql-NULL lesson), each call in a scalar subquery (one call
  per statement, 0066's measurement):
  ```
  using (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and ((select app.is_account_owner(app.current_account_id()))
             or ((select coalesce(app.account_role(app.current_account_id()) = 'staff', false))
                 and (state in ('open', 'running_late')
                      or (until is not null and until <= now()))))))
  with check (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and ((select app.is_account_owner(app.current_account_id()))
             or ((select coalesce(app.account_role(app.current_account_id()) = 'staff', false))
                 and state in ('open', 'running_late')
                 and (state = 'open' or until <= now() + interval '26 hours')))))
  ```
  The last clause bounds a Staff Running late to the end of today (the app always writes the next midnight in
  the zone, at most 25 hours away on a fall-back day): without it a Staff member could store `running_late`
  with an `until` up to the 100-day CHECK and keep the business "late" for months (plan review, proven on a
  replica, 2026-10-23).
  `using` reads the row as it is (the OLD state), `with check` the row as written (the NEW state), so a Staff
  member can move only between Open and Running late, never to a closure and never out of one. The one
  widening on the old row is an EXPIRED closure (`until` passed; an open-ended storm has `until` null and never
  qualifies): it already reads as Open everywhere (D3, expiry on read), so a Staff member can set Running late
  the morning after a Closed today, when the stored row still says `closed_today`. Technicians: no branch,
  the update matches no row.
- `closed_days`: `revoke all …`; `grant select to authenticated, service_role`; `grant insert (account_id,
  starts_on, ends_on, reason), delete to authenticated`; `grant insert, delete to service_role` (fixtures and
  the local sweep, runbook section 9). RLS on. `closed_days_member_read` (select, the tenant expression);
  `closed_days_owner_insert` (insert, with check: the owner expression above); `closed_days_owner_delete`
  (delete, using: the owner expression). No UPDATE for anyone: a change is a remove and an add.
- **`schema-grants-guard.test.ts` `EXPECTED_WRITES` gains exactly two entries:**
  ```
  "authenticated business_status": update(["late_minutes", "state", "until"]).sort(),
  "authenticated closed_days": ["DELETE", "INSERT(account_id)", "INSERT(ends_on)", "INSERT(reason)", "INSERT(starts_on)"],
  ```
  (rows of anon: none). `calls`, `tasks` and `bookings` keep their entries exactly: `tasks` already holds a
  table-wide INSERT/UPDATE/DELETE (`IUD`), which now covers the two new columns too and is why
  `keep_task_links` is re-created; `calls` and `bookings` have no client write and gain none.
- **`proposals-drop.test.ts`'s digest moves from `51|0dd3e2d7e19f3f3649a893cfd9967d94` to
  `52|b66203ca5d355155540b520af510d120`.** The digest counts TABLE-level INSERT, UPDATE and DELETE only
  (`has_table_privilege`), so the column-level grants above do not move it; the one new table-level write is
  `authenticated closed_days DELETE`. The new value was computed from `EXPECTED_WRITES` (the reconstruction
  reproduces today's `51|0dd3e2d7…` exactly, under both C and en_US collation); the plan confirms it by
  reading it off bis-ci after 0097 and updates the literal and its comment in the same commit as
  `EXPECTED_WRITES`, as that test's comment requires.

### 4.2 The knowledge payload, schema 2 (closed days are knowledge)

Closed days are something Sofía is told, so they enter the S-47c snapshot payload
(`lib/voice/knowledge/payload.ts`):

```
{ "schema": 2,
  "facts": …, "services_text": …, "timezone": …, "business_hours": …, "hours_lines": …, "services": [ … ],
  "closed_days": [ { "starts_on": "2026-12-24", "ends_on": "2026-12-25", "reason": "holiday",
                     "line": "- Thursday, December 24 to Friday, December 25, 2026 (holiday)" } ],
  "renderer_version": 2 }
```

- `closed_days`: the account's ranges with `ends_on` on or after the account's today at build time, soonest
  first, at most 20, each with its rendered line (5.4.1); `[]` when there are none. `buildKnowledgePayload`
  gains `closedDays` and `today` inputs, so it stays deterministic. Key order fixed, `closed_days` before
  `renderer_version`.
- `KNOWLEDGE_RENDERER_VERSION` goes from 1 to 2 (a new template, the closed-day line). `parseKnowledgePayload`
  reads schema 1 (no `closed_days`: read as `[]`) and schema 2, so every stored snapshot and every chat
  stamped before this build still reads.
- `knowledgeFromLive` gains `closedDays: ClosedDayRow[] | null`; `null` (a FAILED read) makes the payload not
  recordable and gives no CLOSED DAYS block, the C20 rule for the price list applied to the closed days (a
  snapshot must never claim "no closed days" when they were unknown).
- **Consequence, accepted (S-47c C15).** Every account's payload changes (schema 2, `closed_days`, renderer
  version 2), so every account's next call or chat records one automatic snapshot (`created_by` system,
  "Recorded automatically") through `ensure_knowledge_snapshot`. After that a new automatic snapshot is
  recorded at the next call whenever a closed day is added or removed, and when one passes (it leaves the
  list). The Voice page's knowledge saves build the payload the same way (they gain the closed-days read), so
  a save does not record one payload and the next call another.

### 4.3 LOAD-BEARING on 0097 being on production

PostgREST refuses a request naming a column or table it does not know, so the merge waits for 0097 on
production. The sites: every slot computation (`availability.ts` reads both tables: the booking page, its
move flow, Sofía's three booking tools); every in-account navigation (the shell snapshot reads
`business_status`); every call start (`startCallRow` names `business_status`; the route reads both tables);
every chat turn; the browser voice demo; every call page (`CALL_DETAIL_COLS`); every To do page and the
dashboard's work count (`openTasks` selects `closure_kind`, `closure_on`); every cron tick (the closure
loader reads both tables and `bookings.closure_kept_at`); the Calendar page; every Voice page knowledge save.
**Safe under the running build:** additive; the running build names none of these objects; the new columns
are nullable with no default (except the two new tables' own), and the re-created `keep_task_links` nulls
columns that build never sends.

## 5. Behaviour

### 5.1 The status reader (pure, `apps/web/src/lib/business-status/`, tier MEDIUM)

One module every consumer reads: the slot engine, the prompt, the topbar, the dashboard card, the booking
page, the hold gate and the actions. Pure, relative imports only (the prompt loads it under tsx), all
arithmetic in the account's zone through `partsInZone` and `zonedTimeToUtc` (`slots.ts`), so DST is the
zone's, never the server's.

- **Inputs.** `row` (the `business_status` row, or null = open), `closedDays` (ranges), `hours` (the hours
  chain: `voice_profiles.business_hours` if it has an open day, else the calendar's `open_hours` if it has
  one, else null), `timezone`, `now`.
- **`effectiveStatus(input)`** returns one of:
  ```
  { state: "open", nextClosedDay: ClosedDay | null }            nextClosedDay within 14 days (S16)
  { state: "running_late", lateMinutes: 15|30|60|120, endsAt }  endsAt = row.until (the end of today)
  { state: "closed_today", reopensAt, reopensTimeKnown }
  { state: "storm", reopensAt: Date | null, reopensTimeKnown }  null = until further notice
  { state: "closed_day", reason, startsOn, endsOn, reopensAt, reopensTimeKnown }
  ```
  The row is in force while `row.state !== 'open'` and (`until` is null or `now < until`); otherwise it
  reads as open (D3: expiry on read). A closed day is in force when the account-zone date of `now` falls in
  `[starts_on, ends_on]`. When both apply, the precedence is S11's.
- **`reopeningFrom(from, hours, timezone, closedDays)`**: the first opening at or after `from` that is not on a
  closed day: the first span start at or after `from` on its own day, else the first span of each following
  day, skipping days with no hours and closed days, up to 400 days; with `hours` null, the first start of a
  day (00:00) at or after `from` whose day is not closed (plan SD3: "at or after", so a `from` that IS a
  midnight counts). `reopensTimeKnown` is false in the midnight case (the sentences then say the day only). A
  wall time inside a DST gap resolves to the first minute after the gap; in a zone whose midnight is the
  gap (Havana, Santiago, Beirut), the start of the day is 01:00 local.
  For Closed today and a dated Storm the reader passes `row.until` as `from` (for Closed today that is the
  midnight ending the closure window, D12, so the reopening said is the first opening on a later day, S1), so
  a closed day straight after the closure is skipped in what is said; for a closed day it passes the day after
  `ends_on` at 00:00.
- **`untilFor(change, hours, timezone, now)`**, used only when the switch is SET (5.2): Closed today → the
  start of tomorrow in the zone (D12: the window ends at midnight); Running late → the start of tomorrow (the
  end of today); Storm with a back-on date `D` → `reopeningFrom(start of D, hours, timezone, [])`; Storm
  without → null; Open → null. (No `closedDays` parameter: none of the changes reads them, plan SD13.)
- **`slotClosures(input)`**, for the slot engine: `{ closedDayKeys, blockedBefore, blockAll, lateBefore }`
  from the row in force and the ranges (5.3). For Closed today `blockedBefore` is the stored `until`, so only
  the rest of today's times are refused (D12).
- **`coversAppointment(input, startsAt)`**, for the hold gate, against each closure's WINDOW (D12): Closed today
  or a dated Storm in force, `startsAt` in `[row.set_at, row.until)`; an open-ended Storm, `startsAt >=
  row.set_at`; a closed day, `startsAt` on one of its dates. Running late covers nothing (D4: booking stays
  open, nothing is held). Returns the instant the window ends: `row.until` (Closed today's midnight; a dated
  storm's first opening), the start of the day after the range's last date, or null for an open-ended storm.
  A cover whose window has already ended at `now` holds nothing (plan SD6).
- **`statusCode(effective)`**: S6's code for `calls.business_status`.

### 5.2 Setting the status (server actions, tier MEDIUM)

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/business-status-actions.ts`, called by the one
menu component wherever it is mounted (the topbar and the dashboard card):

- **`setBusinessStatusAction(accountId, change)`**, `change` one of `{ state: "open" }`, `{ state:
  "closed_today" }`, `{ state: "running_late", lateMinutes }`, `{ state: "storm", backOn: "YYYY-MM-DD" | null
  }`. `requireAccountAccess`, then the guard `mayChangeStatus({ isAgency, role }, current, change)`, a pure
  function in `lib/business-status/` that is the policy of 4.1 written in TypeScript: `"all"` for the agency
  and an Owner (D1); for Staff (D8), allowed only when the stored row reads Open or Running late, or is a
  closure whose `until` has passed, AND the change is to Open or Running late; refused for a Technician and
  for a client whose role is unsettled. Refusals, each a sentence: "Only an Owner can close the business or
  reopen it." (Staff asking for a closure, or for anything while a closure is in force); "Only an Owner can
  change this." (Technicians and an unsettled role). RLS refuses again on its own (the document-requirements
  precedent, `settings/document-requirements-actions.ts`, then the policy). The same guard and the same
  sentences serve the Undo below, so a Staff member's Undo works only within Open and Running late. Reads
  the zone, the hours chain and the closed days; validates (`backOn` from tomorrow to 92 days ahead in the
  zone, S3); `ensureBusinessStatusRow` (serviceDb); reads the current row; computes `until` (5.1); updates
  through `dbForRequest()` and reads back `set_at`; records `business_status.changed` (`{from, to,
  late_minutes, until}`); files the To-do when the new state is Closed today or Storm (5.5.1); makes the
  account's held rows due on the next tick (`bumpHeldForAccount`, serviceDb; harmless for rows still covered,
  which `holdOrSend` re-holds); returns `{ ok, effective, undo: { expectedSetAt, before: {state,
  late_minutes, until}, todoId } }`.
- **`undoBusinessStatusAction(accountId, undo)`**: the same guard; compare-and-set: updates to `before` only
  where `set_at = expectedSetAt` (nobody changed it since; the required-documents Undo's shape,
  `documents/required-documents-handlers.ts`), else refuses with "Someone changed this since, so nothing was
  undone."; `before` is the EFFECTIVE status the change replaced, so a row whose `until` had already passed
  is restored as Open (never an expired `until`, which `business_status_until_check` would refuse); deletes the To-do it filed if it is still open and still a status To-do; records the event;
  bumps the held rows; returns the new effective status.
- A refused or failed change keeps the old status on screen and says why; nothing is half-applied (the
  update is one statement; the To-do and the bump are after it and their failure is logged, not shown, since
  the switch itself held).

### 5.3 The slot engine (`lib/booking/`, tier MEDIUM)

- `SlotConfig` gains an optional `closures?: SlotClosures` (`{ closedDayKeys: ReadonlySet<string>,
  blockedBefore: Date | null, blockAll: boolean, lateBefore: Date | null }`); absent changes nothing, so every
  existing slots test is untouched.
- **The rule**, one predicate `closedOut(start, closures, timezone)` used by BOTH `computeSlots` (the slot is
  dropped) and `bookableRange` (null), so `computeMoveSlots` and `movableRange` inherit it and the
  "every offered slot passes the submit check" invariant (`slots.test.ts`) still holds:
  - a closed day: the start's account-zone date key is in `closedDayKeys`;
  - Closed today, or a Storm with a date: `start < blockedBefore` (the row's `until`: for Closed today the
    midnight that ends today, D12, so tomorrow's first slot is offered whatever hours source a reopening
    would be computed from; a Saturday the calendar opens stays bookable after a Friday closure);
  - a Storm with no date: `blockAll`, every slot;
  - Running late: `start < lateBefore`, where `lateBefore = min(now + late_minutes, until)`, so only TODAY's
    slots within the delay go (D4); at 11 PM with 120 minutes, tomorrow's 00:30 stays.
- **Every caller is covered without a call-site change**: `availability.ts`'s four functions
  (`computeAllSlots`, `bookableSlot`, `moveSlots`, `movableSlot`) read the account's closures
  (`readSlotClosures(db, accountId, timezone, now)`: the `business_status` row and the closed days ending on
  or after today, one round trip each, in parallel with `bookedInHorizon`) and pass them in `slotConfigFrom`.
  Their callers today are exactly the booking page (`b/[publicId]/actions.ts`, picker and submit), its move
  flow (`move/[token]/actions.ts`, picker and submit) and Sofía's `check_availability`, `book_appointment`
  and `reschedule_appointment` (`lib/voice/tools/registry.ts`). The web chat has no booking path; the
  operator Calendar does not compute slots; the AI-act Undo of a Sofía cancel restores a booking without a
  slot check, which is right (it restores an existing appointment).
- **A failed closures read throws**, exactly as a failed `listBookedRanges` does today, so each caller's
  existing error path answers (S17): never a slot offered during a closure nobody could read.
- **The booking page notice** (D5, S18), read by the page from the same reader (`data.ts`, serviceDb), above
  the picker in the page's branded card (`booking-page.tsx`, beside today's `notice` slot):
  Closed today or a closed day today → "Closed today. Please pick another day." / "Cerrado hoy. Por favor,
  elija otro día."; Storm, no date → "We're closed for now. Please check back soon." / "Estamos cerrados por
  ahora. Por favor, vuelva a consultar pronto."; Storm with a date → "Closed until {date}. Please pick a day
  from then on." / "Cerrado hasta el {date}. Por favor, elija un día a partir de esa fecha.". Running late:
  no notice. In the picker, a closed day's empty list says "Closed this day." / "Cerrado este día." instead
  of "No times available this day." (`public-strings.ts`; the closed day keys come with the page's data). The
  strings live in `lib/booking/public-strings.ts` (the public page's own bilingual module, not the dashboard
  catalogue).

### 5.4 The prompt (`system-prompt.ts`, tier MEDIUM)

`VoicePromptInput` gains two optional fields: `businessStatus?: EffectiveStatus | null` (read LIVE at call
start, at each chat turn, at demo start) and `closedDays?: ClosedDayLine[] | null` (from the payload). Absent,
null, `[]`, and an `open` status with no closed day today add nothing: the prompt is **byte-identical**
(5.4.4).

Inside `WHAT YOU KNOW ABOUT …`, the order becomes: Facts; the `Services:` line; the BUSINESS HOURS block
(S-47c); **the TODAY line** (only when the status is not open); **the CLOSED DAYS block** (only when the
payload has upcoming closed days); SERVICES AND PRICES (S-47c). Each new piece is its own paragraph (a blank
line before it), as the S-47c blocks are.

#### 5.4.1 The fixed sentences (model input, pinned word for word; English only, as S-47c's lines are)

`{reopening}` is: "tomorrow at 8:00 AM" (the next day); "on Monday at 8:00 AM" (two to six days away); "on
Monday, January 4 at 8:00 AM" (seven or more); without a known time (`reopensTimeKnown` false), the same
without " at {time}". Times use S-47c's `clockTime`.

| state | TODAY line |
|---|---|
| closed_today | `TODAY: The business is closed today. It opens again {reopening}.` |
| storm, no date | `TODAY: The business is closed because of a storm, until further notice.` |
| storm, a date | `TODAY: The business is closed because of a storm. It opens again {reopening}.` |
| running_late 15 / 30 | `TODAY: The team is running about {N} minutes behind today. If someone asks about a visit or appointment today, tell them it may start about {N} minutes late.` |
| running_late 60 | `TODAY: The team is running about an hour behind today. If someone asks about a visit or appointment today, tell them it may start about an hour late.` |
| running_late 120 | `TODAY: The team is running more than an hour behind today. If someone asks about a visit or appointment today, tell them it may start more than an hour late.` |
| closed_day | `TODAY: The business is closed all day today{ for a holiday / for vacation / ""}. It opens again {reopening}.` |

The closed-day reason phrases: `holiday` → " for a holiday", `vacation` → " for vacation", `other` and none →
nothing (S-47c's no-guessing rule: no reason is invented).

The CLOSED DAYS block:

```
CLOSED DAYS (the business is closed all day on these dates, and no time on them can be booked):
- Thursday, December 24, 2026 (holiday)
- Monday, December 28, 2026 to Friday, January 1, 2027 (vacation)
```

A one-day range is its date; a range is "{first} to {last}", the year said once at the end when both dates
share it, else on each; the reason in parentheses when set. The line is rendered into the payload (4.2), so
a snapshot holds exactly the words she read.

#### 5.4.2 Closed now: the S-47c branches, extended, not duplicated

Let `closure` be true when the effective state is Closed today, Storm or a closed day.

- **The Right now line counts closures (D5, S12).** `openNow` gains an optional `closures` argument; when
  `closure` holds it returns "Right now: closed; opens {when} at {time}." from the reader's reopening
  ("opens today/tomorrow/{Weekday}/next {Weekday}" as today, and "opens on {Weekday}, {Month} {d} at {time}."
  beyond seven days), or "Right now: closed." for an open-ended storm; and an open-now answer whose next
  opening falls on a closed day skips it. Running late does not change it. Absent `closures`, the output is
  today's, byte for byte (S-47c's tests stay green unchanged).
- **`closedNow`** (S-47c 5.2.1) becomes: the PHONE, under "Follow business hours, then take a message", and
  either the hours say closed (today's rule, now counting closures) or `closure` holds with no structured
  hours. So every closed state sets `closedNow` on the phone, and C14 behaves as built: the four offers of a
  person read "offer to take a message", the closed TOOLS line replaces the transfer line,
  `transfer_to_human` stays on the session for a caller who asks (decision 21's storm wording: "a caller who
  asks for a person is still transferred"), and the URGENT path still offers. Under "Always take a message"
  `closedNow` stays false (C19) and its MESSAGES ONLY line is unchanged. **Running late never sets
  `closedNow`.**
- **The AFTER HOURS lines** take the same branches S-47c gave "hours say closed", now also taken when
  `closure` holds without hours: the phone line (`afterHoursClosedPhoneLine`), the web line and the demo line.
  Their "(see Right now above)" reads "(see TODAY above)" when there is no hours block (a new `see`
  parameter; the S-47c strings are unchanged when it is "Right now"). For an open-ended storm the phone line
  is built with `canBook: false`, so it does not invite a booking no slot can satisfy (S13).
- `bookingMode`, `toolSchemas` and every trade-module context stay as they are.

#### 5.4.3 Where each surface reads it

- **Phone** (`api/voice/incoming/route.ts`): reads the `business_status` row and the closed days in parallel
  with `listVoiceServices` (one more round trip each, fail-open as the services read is); the closed days go
  into `knowledgeFromLive` (4.2); `effectiveStatus` at the call's `now` gives the TODAY line; `startCallRow`
  stamps `business_status` with `statusCode(effective)` (S6), beside `trade_module` and
  `knowledge_version`; a failed status read gives no TODAY line and a NULL stamp (S17). The plan's Task 0
  measures the added reads beside S-47c's.
- **Web chat** (`api/concierge/[publicId]/turn/route.ts`): the status row is read on EVERY turn and
  `effectiveStatus` computed at the turn's time (S20); the closed days come from the stamped snapshot
  (`closed_days`), or, for an unstamped chat, from the live read. Nothing is stamped on the conversation.
  `capture_lead` stays on the chat in every state, a storm included (D10): no state removes or rewords it.
- **Browser voice demo** (`api/voice/web/session`): live reads, no stamp.

#### 5.4.4 Byte identity

Before `system-prompt.ts` or `hours.ts` is touched, record **`PRE_S47D_DIGEST`** at main `5e9c07a7`: sha256
over every S-47c base combination (`everyS47cBaseInput()`, 5184) × hours {absent, `OPEN_H`, `CLOSED_H`} ×
price list {absent, `LIST`} (31,104 prompts, with a literal length assertion and a 60 s timeout). Assert it
with the new fields absent, null, `[]`, and `businessStatus: { state: "open", nextClosedDay: null }`; keep
`PRE_S47C_DIGEST` and `PRE_S47B_DIGEST` green. `pin.ts`'s module hashes are unchanged (no module text moves).

### 5.5 The To-do and the reminder hold (tier HIGH for the hold, MEDIUM for the To-do)

#### 5.5.1 The To-do (D2, S7, S8)

- **When.** `setBusinessStatusAction` to Closed today or Storm, when at least one `booked` appointment, not
  kept, is covered by the new closure within the card's window (S22: from now through the closure window's
  end, at most 14 days ahead; for Closed today that is the rest of today, D12): one To-do, `closure_kind
  'status'`, `closure_on` today's date in the zone (the once-per-day key, whatever date the appointments are
  on). `addClosedDayAction` when at least one such appointment falls on the
  new range: one To-do, `closure_kind 'closed_day'`, `closure_on` the range's `starts_on`.
- **Once.** `tasks_closure_once` makes a second filing for the same account, kind and date a 23505, which
  the action treats as "already filed" (0080's and 0084's dedupe). Flipping Closed today, then Open, then
  Storm on one day leaves the first To-do, whose list is live.
- **What.** Inserted by the server (serviceDb, because `keep_task_links` nulls the link columns for the
  client role): `title` in the account's language (`accounts.language`, English when unset), `due_at` now,
  `contact_id` and `assigned_to` null, `created_by` the acting person's Clerk id (the provenance mark of a
  person, DESIGN.md), the two closure columns. Titles: "Contact customers affected by the closure" /
  "Comuníquese con los clientes afectados por el cierre"; "Contact customers booked on {dates}" / "Comuníquese con los clientes con cita el
  {dates}".
- **The link.** `openTasks` (`packages/db/src/work-queue.ts`) selects the two columns; `WorkRow` gains
  `closureFocus?: { kind, on }`; `workRowHref` (`lib/documents/card-focus.ts`) returns, for `status`, the
  dashboard with `#business-status`, and for `closed_day`, the Calendar page with `?closedDay={on}#closed-days`
  (the card opens that range's appointment list). A contact-less To-do with a closure link is a link, not the
  plain row.
- **The list it points to** (5.6.2, 5.6.3; S22): each appointment the closure covers, through the
  closure window's end but at most 14 days ahead, with its time, the customer's name
  linked to their record, the number of messages waiting for it, and two actions: Keep (S9) and "Cancel on the
  calendar", a link to that booking on the Calendar page (`#booking-{id}`; `bookings-list.tsx` rows gain the
  id), where the existing cancel and its notice run (D2).
- **Done.** The To-do is ticked off by hand like any other; the switch reopening does not close it (the owner
  may still owe calls). Undo of the flip deletes it while it is open (5.2).

#### 5.5.2 The hold (D6, S10)

The send gate is `holdOrSend` (`lib/automations/hold-or-send.ts`): every automated customer send passes
through it, writes `held` rows with a `held_until`, and the first pass of every tick, `releaseHeldPass`
(`passes/release-held.ts`), hands each row whose `held_until` has passed back to its own releaser, which
re-reads the subject and calls `holdOrSend` again. The closure hold is one more check there, before the
sending-hours check:

- `HoldSubject` gains `appointmentAt?: Date`. The seven booking recipes set it from the due row's
  `starts_at` (their subject key is already `booking:{id}`): `reminders`, `sms_reminder`,
  `appointment_confirm`, `followups`, `no_show_nudge`, `review_request`, `referral_ask`. No other recipe sets
  it, so nothing else changes. `HoldSubject` also gains `kept?: boolean`, set by the same seven from the due
  row's own `closure_kept_at` (each of the seven due-row selects, and the by-id re-reads the releasers use,
  gain `closure_kept_at`). Keep therefore holds however old the appointment is: the review request runs up to
  61 hours after the appointment ends and the referral ask up to 85 (`REVIEW_REQUEST_MAX_AGE_MS`,
  `REFERRAL_ASK_MAX_AGE_MS`, `packages/db/src/automations.ts`), longer than any window a loader could guess
  (plan review, 2026-10-23).
- `PassContext` gains `closures(accountId)`, a per-tick memoised loader (built in `buildPassContext`,
  serviceDb): the status row, the closed days ending on or after yesterday, the hours chain and the zone of
  THAT account (the subject's own `accountId`). One read per account per tick, whatever the number of subjects.
- **The check.** With `appointmentAt` set, the booking not kept, and `coversAppointment` true with a window
  that has not ended at `now`:
  - if the subject's `deadline` has passed: skipped, "Not sent: the business was closed for this
    appointment" (the reminder after the appointment is worse than none, choice 21's reasoning);
  - otherwise held, `held_until` = the earlier of the closure window's end (D12) and the subject's
    `deadline`; for an open-ended storm with no deadline, now + 24 hours (a daily second look, so the row
    never sits with a past `held_until` and starves the queue, the reason `REASONS.smsCooldown` exists).
    Reasons (client-readable on the Activity page, catalogue keys with Spanish twins, stored in English as
    the others are): "Held: the business is closed today", "Held: closed for a storm", "Held: the business
    is closed that day".
- **Release.** Naturally, at the first tick after the window ends (or the deadline, which then skips). Early,
  on the next tick, whenever the switch changes, an appointment is kept, or a closed day is removed: each of
  those actions calls `bumpHeldForAccount` (serviceDb), which sets every held row of the account due now;
  `holdOrSend` re-holds what is still covered or still inside sending hours. "The next run" (D6) is therefore
  at most one 15-minute tick.
- **Fail held.** A failed closures read holds the row for `LEDGER_RETRY_MS` (15 minutes) with the reason
  "Held: couldn't check whether the business is open", the consent ledger's precedent: never a send while a
  closure might be in force.
- **Keep** (S9): `keepAppointmentAction(accountId, bookingId)` and its Undo: `requireAccountAccess`, refused
  for a Technician and for a client whose role is unsettled (`seesWholeAccount`), then serviceDb sets
  `closure_kept_at = now()` (Undo: NULL) on a `booked` booking of that account, records
  `booking.closure_kept`, and bumps. A moved booking is a new row (0061 `rescheduled_from_id`), so a keep
  does not follow it; a kept booking stays kept through later closures, which is the owner's word that it is
  happening.

### 5.6 The UI (D7; tier LOW)

Existing components only (`DropdownMenu` with `DropdownMenuSub` and `DropdownMenuRadioGroup`, `Dialog`,
`Card`, `Input type="date"`, `Select`, `Button` ghost, `Notice`, `Badge`, `sonner` toasts), tokens only, so
no styleguide change. Status dots: Open `--good`, Running late `--warn`, every closed state `--crit`; each
always beside its word (rule 3). Every change applies at once with an Undo toast for `UNDO_WINDOW_MS`
(10 s, `calendar/undo-window.ts`); none asks "Are you sure?" (rule 6). Every string in English and Spanish
(usted), through the catalogue, with `lang` set (DESIGN.md's bilingual DoD item applies in full: this surface
carries bilingual copy from its first day).

#### 5.6.1 The topbar indicator (S15)

- `ShellSnapshot` (`accounts/[accountId]/shell-actions.ts`) gains `businessStatus: ShellBusinessStatus |
  null`, its own fault-isolated leg (a failed read folds to null and logs, as the other three legs do), not
  folded into `presence`, which is null for an account with no enabled voice profile. It carries the
  effective state, the reopening or end, the late minutes, and `canChange: "all" | "late_only" | null`
  (`"all"` for the agency and an Owner; `"late_only"` for Staff while the state reads Open or Running late,
  D8; `null` for Staff during a closure, for Technicians and for an unsettled role), computed on the server by
  the same `mayChangeStatus` the action runs (5.2).
- **Not open**, for everyone: the status replaces the idle count. Full form at `sm` and up, short form
  below, both in the DOM and CSS picking one (F-107's pattern): "● Closed today · opens 8 AM" (reopening the
  next day), "● Closed today · opens Mon 8 AM" (two to six days), "● Closed today · opens Dec 28" (later),
  "● Closed today · opens tomorrow" (no known time); a closed day reads the same as Closed today; "● Running
  about 30 min late" ("about an hour", "over an hour"); "● Closed for a storm" / "● Closed for a storm · opens
  Thu 8 AM". Short forms: "● Closed today", "● 30 min late" / "● 1 hr late" / "● 1+ hr late", "● Storm".
  During a call the on-call pulse stays and the status follows it at `sm` and up.
- **Open**: unchanged (pulse or count). An account with no enabled voice profile shows "● Open" to whoever
  has a `canChange` (as the menu's trigger) and nothing to anyone else, as today.
- **With `canChange` "all"** (Owners and the agency) the indicator is a button (`aria-haspopup="menu"`, the visible focus ring)
  that opens the menu: a radio group with Open; Closed today; Running late ▸ (About 15 minutes, About 30
  minutes, About an hour, More than an hour); Storm ▸ (Until further notice; Back on a date…, which opens a
  small Dialog with one date field and one primary "Close until then"). The current state is checked. On a
  closed day, Open is replaced by "Change closed days" (a link to the Calendar card, S11). Esc closes; arrow
  keys move (Radix).
- **With `canChange` "late_only"** (Staff, D8) the same button opens a two-item menu: Open; Running late ▸
  (the same four delays). Nothing else is listed, not even disabled. During a closure Staff get no button
  (`canChange` null), so a Staff member is never offered a change the policy would refuse.
- **After a change** the indicator shows the action's answer at once (a local value that the next snapshot
  for the account replaces) and the page refreshes (`router.refresh()`), so the dashboard card agrees. The
  toast says what changed and what it means ("Closed for today. Your booking page now says so."), adds
  "Sofía says so too." when the account has a voice profile (an account without one still has the switch, so
  the persona is never assumed; plan SD19), adds "A To-do lists the 3 affected appointments." when one was filed,
  and carries Undo. A refused change: an error
  toast with the reason, the old status kept.
- Technicians, and Staff during a closure: the same words, no button. A stale tab shows the status as of its last navigation
  (never polled, S15); the expiry is evaluated on the server at each fetch.

#### 5.6.2 The dashboard status card (`id="business-status"`)

Under the greeting (`dashboard/page.tsx`, between `PageHeader` and `ZoneNote`), for everyone who sees the
dashboard (the page already refuses Technicians). Its own error boundary (a failed read is its own error
state, never the page's).

- **Not open:** the state as dot + word, when it ends in words ("Opens again tomorrow at 8:00 AM", "Until you
  reopen", "Ends at midnight"), the reason on a closed day, and the "Change" button for whoever has a
  `canChange` (the same menu, two items for Staff during Running late; no button for Staff during a closure).
  Then **Affected appointments** (S22): each booked appointment the closure covers, from now through the
  closure window's end but at most 14 days ahead (today only for Closed today, D12; a dated storm to its
  `until`; a multi-day closed day to its last date; an open-ended storm 14 days), with its date and time, the
  customer's name linked to the record, "{n} messages waiting" when any are held, Keep (ghost; once kept,
  "Kept" with Undo in the toast) and "Cancel on the calendar" (a link). When the cover runs past those 14 days:
  "More appointments after {date} are on the calendar." linking to the Calendar page. Running late shows only
  the state, the end, and "Booking stays open; times in the next {N} minutes are hidden."
- **Empty (open):** one compact line, "● Open today", with Change for Owners, the agency and Staff (their
  two-item menu, D8); plus "Next closed
  day: Thursday, December 24 (holiday)" when one is within 14 days (S16).
- **No affected appointments:** "No appointments are affected."
- **Error:** "Couldn't load today's status." with a Retry link (a reload), and the rest of the dashboard
  renders.
- **Loading:** a skeleton shaped like the compact line (rule 7).

#### 5.6.3 The Closed days card (`id="closed-days"`, Calendar page)

Beside the hours the booking page uses: in the Calendar page's main column, after `CalendarSettings` for
Owners and the agency, and on its own for Staff and Technicians (who never see the settings form today, so
this is the first read-only settings card they see there; it holds no setting they could misuse).

- **Loaded:** the upcoming ranges, soonest first, each as "Thursday, December 24 · Holiday" or "Dec 28 – Jan
  1 · Vacation", with "{n} appointments" when any booked appointment falls on it (a toggle that opens that
  range's list, as in 5.6.2) and, for Owners and the agency, Remove (ghost; immediate, Undo re-adds it).
- **Add** (Owners and the agency): From (date), To (date, optional: one day when empty), Reason (Select: None,
  Holiday, Vacation, Other), and the card's one primary button, "Add closed days". Validation in the zone,
  each with its sentence: the start not in the past; the end on or after the start; at most 92 days; ending
  within 12 months; not overlapping "{range}" already listed. After adding: a toast with Undo, and, when
  appointments fall on it, "{n} appointments are on these days. A To-do lists them." (S8).
- **Empty:** "No closed days planned. Add a holiday or a vacation, and your booking page and Sofía will know
  you're closed." with the add form for Owners and the agency; Staff see the sentence only.
- **Error:** "Couldn't load closed days." in the card; the rest of the page renders.
- `?closedDay={date}` (from a To-do) opens that range's appointment list and scrolls the card into view.
- The command palette's Calendar entry gains the keywords closed days, holiday, vacation, días cerrados,
  feriado, vacaciones.

#### 5.6.4 The call page and the knowledge page

- The call details gain one `<dt>`/`<dd>` pair when the call is stamped: "Status at the start" / "Estado al
  empezar", value the state in words ("Closed today", "Running about 30 minutes late", "Closed for a storm",
  "Closed (closed day)", "Open"), for everyone who can see the call (S19).
- "What Sofía knew" (S-47c 5.8) gains a Closed days section listing the snapshot's lines; a schema-1
  snapshot shows "No closed days were recorded in this version.".

## 6. Copy

New keys, English and Spanish (usted), through the catalogue (`lib/messages.ts`, `.es` twins; the i18n
baseline regenerated): the menu (Open / Abierto; Closed today / Cerrado hoy; Running late / Con retraso,
with About 15 minutes / Unos 15 minutos, About 30 minutes / Unos 30 minutos, About an hour / Como una hora,
More than an hour / Más de una hora; Storm / Tormenta, with Until further notice / Hasta nuevo aviso and Back
on a date… / Reabrimos el…; Change closed days / Cambiar días cerrados); every topbar form in 5.6.1 (Spanish
drafts: "● Cerrado hoy · abre a las 8 AM", "● Cerrado hoy · abre el lun. a las 8 AM", "● Cerrado hoy · abre
el 28 de dic.", "● Con unos 30 min de retraso", "● Con más de una hora de retraso", "● Cerrado por tormenta",
"● Cerrado por tormenta · abre el jue. a las 8 AM"; short: "● Cerrado hoy", "● 30 min tarde", "● 1+ h
tarde", "● Tormenta"); the toasts (each state, "A To-do lists the {n} affected appointments." / "Una tarea en
Pendientes lista las {n} citas afectadas.", the Undo confirmations, "Someone changed this since, so nothing was
undone." / "Alguien lo cambió mientras tanto, así que no se deshizo nada.", "Only an Owner can change this."
/ "Solo un propietario puede cambiar esto.", "Only an Owner can close the business or reopen it." / "Solo un
propietario puede cerrar el negocio o volver a abrirlo." (D8)); the dashboard card's states, list, counts and errors; the
Closed days card's labels, reasons (Holiday / Día festivo, Vacation / Vacaciones, Other / Otro), validation
sentences, empty and error states; Keep / Mantener, Kept / Se mantiene, "Cancel on the calendar" / "Cancelar
en el calendario"; the four hold reasons and the closed skip reason; the two To-do titles; the call-page
label and values; the knowledge page's Closed days heading. The booking page's notices and "Closed this
day." go in `lib/booking/public-strings.ts`. The TODAY sentences and the CLOSED DAYS lines are model input,
not catalogue copy, and are pinned by tests instead (S-47c section 6's rule).

The Spanish topbar forms above are approved as written (D9); the plan pins every English and Spanish topbar
form, full and short, as literal test fixtures.

## 7. Tests

- **Status reader:** every state in force and expired (`until` passed reads open); precedence (S11) for each
  pair; Closed today set at 7 AM before an 8 AM opening stores `until` = tonight's midnight and SAYS it
  reopens TOMORROW (S1, D12); `reopeningFrom` with business hours, with only calendar hours, with none
  (midnight, `reopensTimeKnown` false), across a weekend, skipping a closed range; the Saturdays before
  spring-forward and fall-back in `America/Chicago` (the stored `until` is midnight starting the Sunday; the
  reopening said is 8:00 AM wall time on the Sunday or Monday); zones whose MIDNIGHT is the DST gap (Havana
  2027-03-14, Santiago 2026-09-06, Beirut 2027-03-28: the start of the day is 01:00 local) and Santiago's
  fall-back day (2027-04-04), each through the start of a day, Running late's `until`, Closed today's window
  end and the no-hours reopening; D12's two-hours-sources case (business hours Monday to Friday, the calendar
  open Saturday: a Friday Closed today blocks no Saturday slot and holds no Saturday reminder); Running late at
  11 PM with 120 minutes leaves tomorrow's 00:30; `coversAppointment` for each state, the `[set_at, until)`
  edges, Running late covering nothing.
- **Slot engine:** each closure drops exactly its slots and `bookableRange` refuses exactly those starts
  (mutation: apply the rule in `computeSlots` only → the "every offered slot is bookable" test still passes
  but the submit test FAILS); `closures` absent leaves every existing test's output unchanged; the move flow
  cannot move into a closed day and can move out of one; a failed closures read throws through each of the
  four `availability.ts` functions.
- **Prompt:** every TODAY sentence in 5.4.1 as a literal; the CLOSED DAYS block's one-day, range, cross-year
  and no-reason lines; placement (after the hours block or the Services line, before SERVICES AND PRICES);
  `closedNow` true for each closed state on the phone under "Follow business hours" with and without
  structured hours, false under "Always take a message" (C19) and for Running late; with a transfer number,
  the four offer sites, the closed TOOLS line, `transfer_to_human` still in `toolSchemas`, the module block
  byte-identical to the open one; "(see TODAY above)" only without hours; the open-ended storm's phone line
  without the booking clause; the Right now line counting closures and the dated form beyond seven days;
  `PRE_S47D_DIGEST`, `PRE_S47C_DIGEST`, `PRE_S47B_DIGEST` (5.4.4). Guards on the specific sentences, never
  on a heading (a test a comment could satisfy is vacuous).
- **Payload:** schema 2 build and round-trip; schema-1 snapshots still parse (closed days `[]`); a failed
  closed-days read is not recordable; `renderer_version` 2; deterministic order.
- **The hold (HIGH):** for each of the seven recipes, a covered appointment is held with the closure reason
  and `held_until` = min(window end, deadline); a kept one sends, including an appointment that ended 3 days
  ago under a multi-day closure (Keep read from the subject's own row, not a loader window); a past deadline
  skips with the closed reason; an open-ended storm holds 24 h; a failed loader holds 15 min; a subject of
  account B sends while only account A is closed (the loader is asked for the subject's own account; mutation:
  a hard-coded or other account id → FAILS); a recipe without `appointmentAt`
  (instant reply, text-back, reactivation, quote follow-up, document request) is untouched; release: the
  switch to Open plus one tick sends what is due; Keep plus one tick sends; removing a closed day plus one
  tick sends; the loader reads once per account per tick (mutation: no memo → the read count FAILS).
- **To-do:** filed on Closed today and Storm only with an affected appointment in the card's window; a dated
  storm with nobody booked today but one booking on Wednesday files exactly one To-do, and a second change the
  same day files none (mutation: today-only filing → the storm case FAILS); once per account and day
  (23505 → "already filed"); its link (`workRowHref`) for both kinds; Undo deletes it only while open; a
  signed-in insert or update cannot set or change the closure columns (`keep_task_links`).
- **Actions:** `mayChangeStatus` over every (role × stored state × change) cell, as a table: the agency and
  an Owner may make every change; Staff may go Open → Running late, Running late → Running late (another
  delay), Running late → Open, and an expired closure → Running late or Open, and nothing else; a Technician
  and an unsettled role nothing. Staff refused, with "Only an Owner can close the business or reopen it.",
  when they ask for Closed today or Storm (from Open and from Running late), and when they ask for Open or
  Running late while Closed today, a dated Storm, an open-ended Storm or a closed day is in force; each of
  those refusals checked twice, by the action and separately by RLS with the action's guard bypassed (the
  update matches no row). Staff Undo works within Open and Running late and is refused for anything else. A
  Technician refused with "Only an Owner can change this.", by both. Undo compare-and-set refuses after a
  second change; `until` computed per 5.1; the bump called on every change; closed-day validation
  sentences, and Staff refused on add and remove (D1, unchanged by D8).
- **db (HIGH):** 0097's shape; each CHECK clause by a mutation probe (`business_status_shape_check` per
  state, `late_minutes` values, the `until` bounds, the range length, the reason list, `calls.business_status`
  codes, `tasks_closure_coherent`); the stamp triggers ignore a sent `set_by`, `set_at`, `created_by`; the
  `closed_days` window trigger (two days before the UTC date accepted, three refused); grants: an Owner
  updates `business_status` and inserts and deletes `closed_days`; an Owner of ANOTHER account cannot insert
  into this one, probed as a plain insert with no `returning` (a `returning` insert is refused by the READ
  policy whatever the insert policy says; mutation: drop the `account_id` clause from
  `closed_days_owner_insert` → that case FAILS); the Staff branch of `business_status_update` (D8), one probe
  per cell: Staff update Open → Running late, Running late → Open and an expired `closed_today` → Running late
  (one row each); Staff Open → Running late with an `until` 99 days out is refused (the 26-hour bound,
  mutation: drop it → FAILS); Open → Closed today, Open → Storm, Running late → Closed today and Running late
  → Storm are refused with 42501 (WITH CHECK raises; plan SD1), and Closed today (in force) → Open, Storm
  (dated, in force) → Open, Storm (open-ended) → Open and → Running late update zero rows (USING matches no
  row) (mutation: drop the `with check` state clause → the "to a closure" probes FAIL; drop the `using` state
  clause → the "out of a closure" probes FAIL; drop the expiry carve-out → the expired-closure probe FAILS);
  Staff insert and delete no `closed_days`; a Technician updates and inserts nothing (zero rows / refused);
  every member reads,
  anon nothing, a client cannot UPDATE `set_by` or `set_at` (column grant) nor INSERT into `business_status`;
  account delete cascades; `EXPECTED_WRITES` and the digest at their new values (4.1); 0096's
  `definer-search-path.test.ts` green with 0097 applied (its three functions end their search_path with
  `pg_temp`; `EXPECTED_DEFINERS` unchanged).
- **Routes:** the incoming route stamps the code `effectiveStatus` gave and builds the TODAY line from the
  same object; a failed status read leaves the call answered, unstamped, without the line; the chat reads
  the status on each turn and its closed days from the snapshot.
- **UI (LOW):** the topbar forms per state and width, English and Spanish, as literal fixtures (D9); the
  button only for a `canChange`; the full menu for "all", exactly the two items for "late_only", no button for
  Staff during a closure; the card's states, and its list running to the closure window's end but at most 14
  days (a three-day dated storm lists all three days' appointments, each with Keep; S22); the Closed days card
  for an Owner and read-only for Staff; the
  booking page notices in both languages.
- **e2e (LOW, the per-run fixture account only; never Test Client One):** an Owner sets Closed today from the
  topbar, sees "Closed today" on the topbar and the card, presses Undo, sees it open again; adds a closed day
  next week on the Calendar page, opens the booking page for that day and sees "Closed this day.", removes it.
  Check for an in-progress `screenshots.yml` run first (CLAUDE.md).

## 8. Rollout

1. 0096 first: its PR (`fix/s47c-followups`) merged and 0096 on bis-ci and on production before 0097 goes
   anywhere. Before 0097 is pushed, the plan checks that the file's three functions say `set search_path =
   pg_catalog, pg_temp` (never `''`) and that `keep_task_links` was re-created from its post-0096 text, and
   runs `definer-search-path.test.ts` locally with 0097 applied (section 4). Then 0097 → bis-ci (`ci-project-setup.yml`, push-dry-run then push) →
   green `verify` and `e2e` on the head SHA (read the check runs for that SHA) → production via MCP
   `apply_migration` once (name `one_switch`, the exact file text; after 0096 is on production) → md5 compare
   of the stored text → parity check (`docs/runbooks/ci-supabase-project.md`).
2. PR; merge only after 0097 is on production (4.3).
3. Deploy READY → smokes on a fixture account: set Closed today and check the topbar, the card, the booking
   page and the browser voice demo's answer; Undo; a closed day on the booking page. Tracker: F-084 done.
4. Merging changes no prompt by itself, except that every account's next call or chat records one automatic
   snapshot (4.2, accepted under C15). An account's prompt changes only when its switch is not Open or it has
   closed days.

## 9. Tiers (per task, binding rule 2026-10-19)

- **HIGH:** migration 0097 and its db tests; the reminder hold (`holdOrSend`, the loader, the seven recipes'
  `appointmentAt`, release by bump).
- **MEDIUM:** the status reader; the slot engine; the prompt, the payload schema 2 and the digests; the
  To-do; the server actions.
- **LOW:** the topbar menu, the dashboard card, the Closed days card, the booking page notice, the call-page
  line and the knowledge page section; copy keys and baseline; the palette keywords; the e2e spec.
- One end-of-PR review (final + design), then one fix round.

## 10. Open questions

No open questions. The first draft's Q1–Q4 were answered by the owner on 2026-10-23 and are decisions D8–D11
(section 2): Staff may set Running late and reopen from it only (D8); the Spanish topbar drafts stand (D9); a
storm does not stop the chat's lead capture (D10); "over an hour" hides two hours (D11).

Code findings that bore on the approved design, all RESOLVED (kept so a reviewer can see why the spec reads as
it does):

- **F1 (resolved by S7)** A To-do has a title and one link and no body, so it cannot itself list several
  bookings with links (D2). The To-do links to the dashboard card, which lists them.
- **F2 (resolved by S15)** The topbar indicator renders nothing for an account with no enabled voice profile,
  and the shell is never polled. The status is its own snapshot field, and the action's answer updates the
  topbar at once.
- **F3 (resolved by scope)** The plan says "F-084 owns the special-hours record" (`crm-features.md` row 2) and
  decision 32 has F-161 read "special hours from F-084's record"; D5 puts shorter hours out of scope, so
  `closed_days` is the first half of that record. A later shorter-hours slice adds open spans to it rather
  than a second table.
- **F4 (resolved by S1)** D3's "next opening" read literally can be later the same day; S1 makes it a later
  day.
- **F5 (resolved by S10)** `bumpHeldForAccount` exists with no caller (its quiet-hours save is gone); S10
  reuses it as the "next run" lever.
- **F6 (resolved by 5.6.2)** A held row records its cause only as reason text, so the card counts every held
  message of an affected booking ("{n} messages waiting"), whatever held it.
- **F7 (resolved by D12)** Closed today's end was computed from the hours chain, which prefers business hours
  over the calendar's: with business hours Monday to Friday and a calendar open on Saturday, a Friday closure
  silently refused Saturday's slots and held Saturday's reminders until Monday. D12 ends the window at midnight
  and keeps the hours chain only for what is said.
- **F8 (resolved in 5.5.2)** A loader that read kept bookings starting within the last two days missed the
  review request (61 hours after the end) and the referral ask (85 hours): Keep is now read from each due row.
