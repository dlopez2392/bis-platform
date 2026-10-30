# The calendar agenda and staff-made bookings (F-046 part 1): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff put a phoned-in job on the Calendar page's new Day/Week agenda (customer, time, length, what, address, how they meet), may overlap other jobs or break the customer rules with a warning, undo it for ten seconds before the customer is emailed, and open, move, cancel or close out any job from a drawer; customers and Sofía never get offered a time a staff job holds.

**Architecture:** Migration 0107 adds six columns to `bookings` (address, meeting type, the Undo hold and its email), narrows `bookings_no_overlap` to customer-made rows and adds a SECURITY DEFINER trigger that locks the calendar row and refuses a customer-made row over a live staff job with 23P01, plus `undo_staff_move`. The query layer (`packages/db/src/booking.ts`) writes staff jobs, reads the agenda window, claims and settles holds. A pure rules layer (`apps/web/src/lib/booking/`) computes warnings, windows and lanes. The settle (`CAL/job-hold.ts`) sends two new `transactional` email kinds after the Undo window, from `after()` with a 15-minute cron pass as its backstop. The Calendar page's first card becomes the agenda; a sheet adds and moves jobs; a URL-driven drawer (`?job=`) opens one.

**Tech Stack:** Postgres 17 (Supabase) plpgsql migrations, supabase-js/PostgREST, Next.js App Router server components, server actions and `after()`, React client components, vitest, Playwright (bis-e2e-qa only).

**Spec:** `docs/superpowers/specs/2026-10-30-calendar-agenda-design.md` (owner rulings §2, owner decisions §16, corrections §15, DESIGN.md meeting points §14, task sketch §12). Every count and line below was read off the files at `5688e983` (code identical to `c7bb8c0d`: `git diff --stat c7bb8c0d HEAD` touches only the spec) on 2026-10-30.

## Global Constraints

- Migration number **0107** (`packages/db/supabase/migrations/0107_calendar_agenda.sql`). 0106 (contact_merge) is the newest file and is on production: never edit it, never re-apply it.
- **No agent applies 0107 to any Supabase project.** Schema proof is on a local **PostgreSQL 17.6** replica only: binaries `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\88d51cd6-6c5b-4497-af8a-63647f233ba6\scratchpad\ca-t1\pg17\pgsql\bin\` (`postgres.exe --version` answers `postgres (PostgreSQL) 17.6`, checked 2026-10-30). Recipe to copy: `C:\Users\danlo\AppData\Local\Temp\claude\C--Users-danlo-bis-platform\6aad36e9-1c5f-4846-8e5b-164fe1f316ea\scratchpad\rp\pg17-rp.sh` (verbs `init`, `post`, `stop`). Each agent copies it into its OWN scratchpad, with its own data dir and its own port (T1: 55971; a reviewer: 55972 and up). `SUPABASE_DB_URL` is passed only on the command line of the one vitest run, never exported, never written to a file.
- **No `@bis/db` vitest runs against any Supabase project locally.** This worktree has no `packages/db/.env` and no `apps/web/.env.local`: never create one. Local db runs are exactly two kinds: `withRollback` files against the replica, and pure fake-client files (`packages/db/src/*.test.ts`). Every `withTestAccount` case (all of `packages/db/src/test/booking.test.ts`, `places.test.ts`, `head-count-null.test.ts`) is proven by CI `verify` only, and is proven ONLY after the orchestrator reads that HEAD SHA's verify run (three live tests shipped never-green on F-006). A live test that seeds a second contact on an existing phone inserts it directly (`createContact` dedupes by phone); a `voice` ai_act needs a real call row.
- One `pnpm install --frozen-lockfile --prefer-offline` in the worktree, by the orchestrator, before the first test run. Agents never reinstall.
- **No `git stash` of any kind** in this shared worktree (an agent's stash swept another agent's files on F-006). Commits: `git add <explicit paths>` then `git commit -m "<type(scope): what and why>" -- <paths>`. Never `-A`, `.`, amend, reset, rebase, checkout or push. If `.git/index.lock` exists, wait and retry; never delete it.
- Judge every vitest run by its own summary block (`Test Files … | Tests …`), never the exit code. For `@bis/db` the trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL "Command vitest not found"` follows the real results and lies.
- A `-t` filter that matches no name skips silently: every filtered run's report pastes the summary line showing the expected count of tests run.
- Every UI task's green step runs `pnpm --filter web lint` (0 errors) as well as vitest and `pnpm --filter web typecheck`. CI's verify once failed on React's purity rule (`Date.now()` during render) that no agent ran: no component body or hook calls `Date.now()` or `new Date()` without an argument. The page computes `now` once (`CAL/page.tsx:75`'s existing `const nowIso = new Date().toISOString()`) and passes it down.
- Consent scans (`apps/web/src/lib/consent/scans.test.ts`) bind: each email kind is named in exactly the files its `SITES` row lists (`:762-793`); no file names a retired column (`marketing_email_opted_out_at`, scan 5 PR-3 `:829-841`); a contact write gets the phone as typed, never a normaliser's E.164 (`:579-675`).
- e2e runs only on the per-run fixture account, never `Test Client One`. Locators are scoped to `getByRole("main")` or a `data-*` scope, never a page-wide `getByText` (Next streaming briefly duplicates Suspense content outside `main`). Only bis-e2e-qa writes Playwright; only the orchestrator runs it, one gate at a time.
- DESIGN.md binds every UI task: tokens only (no hard-coded colour, radius or shadow); cards `rounded-xl border border-border bg-card glass` (`components/record/record-card.tsx`'s shape); the four surfaces; status and overlap and closed states as dot AND word (rule 3); whole row is the target with `:focus-visible` ring and `--surface-3` hover (rule 4); loaded, empty, error (rule 5); Undo toasts, no "Are you sure?" (rule 6); skeletons, no spinners (rule 7); **rule 8: the Agenda card's header carries the one primary, Add job; the job drawer carries NO primary** (T13 lands the DESIGN.md line); no hero (rule 11); English, usted Spanish and the pseudo-locale's +35%; `/styleguide` entries for every new component; fits 375 px (`e2e/phone-width.spec.ts` walks `/styleguide`).
- F-118 access log: every new page and server action is classified in `ACCT/access-log-routes.test.ts` (spec §8.2): the calendar page becomes a RECORD (T12), each agenda action a NOT_A_RECORD action (T10).
- Copy: the "landscaper at 7 AM" read in English and usted Spanish; every English key has its `.es` twin on the very next line; a `{count}` key has its `One` twin; no milestone codes, no arrows, no `{{template}}`; a name shown is the customer's. `messages.ts` has exactly ONE writer in this plan (T2).
- Gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) are the orchestrator's, one at a time.

---

## Corrections to the spec made while planning (the source wins)

1. **Only two existing tests lose their collision, not five** (spec §10.1). `booking.test.ts:66` and `:390` do. `:1533` stays green: its colliding write is a MOVE by actor `system` (`booking.test.ts:1539`), so the new row is customer-made and the trigger refuses it against the person-made row at `at("07")`. `ai-acts-schema.test.ts:459` and `:518` insert their rows with `author_kind 'ai'` (`ai-acts-schema.test.ts:118-119`), so both stay customer-made and untouched. And in `:390` the row that must change is the RESTORED one (`b`, created at `:416`), not the colliding one: only a customer-made row is ever refused.
2. **`bookings_rescheduled_from_fkey` is `on delete set null (rescheduled_from_id)`** (`0061_bookings_rescheduled_from.sql:81-85`), not NO ACTION (spec §6.2). Deleting a replaced row would silently null its successor's link. The Undo of an add is still safe because its DELETE requires `status = 'booked'` and a replaced row is cancelled; `undo_staff_move`'s `not exists` guard is therefore load-bearing, not belt and braces.
3. **The by-id twins get NO hold filter** (spec §4, §6.5 said "and their by-id twins"). `getDueReminderById` answering `gone` makes the release skip and drop the held row for good (`passes/reminders.ts:177-183`), and a by-id read can never meet an unsettled hold: a held subject is only ever made from a due-list row, which the hold filter already excludes, and `hold_until` is written only at insert (a move makes a new row id). Only the four forward-looking due-list reads filter: `listDueReminders`' two reads (`booking.ts:1592-1596`, `:1604-1610`), `listDueSmsReminders` (`automations.ts:652-657`), `listDueAppointmentConfirms` (`automations.ts:802-807`).
4. **The backstop pass needs room in the in-process tick.** `cron-coupling.test.ts:368` says "The next budget added must come out of a neighbour or raise LEGACY_TICK_CEILING_S". T9 raises `LEGACY_TICK_CEILING_S` 300 → 310 (`fanout.ts:27`): the route's live `maxDuration` is 800 s (`app/api/cron/reminders/route.ts:17`), so 310 still fits with room, and no neighbour's budget shrinks. Under fan-out `jobHolds` runs after `billingPause` only, because `fanout.test.ts` test 4 pins every released recipe's `after` to exactly `["releaseHeld"]`; "a confirmation precedes a reminder in one tick" (spec §6.5) holds for the in-process tick, which is production today (`CRON_FANOUT` off).
5. **`proveBooking` moves out of the "use server" file.** It is a private async function of `CAL/actions.ts:189-198`; exporting it from there would make it a callable server action. T10 moves it, unchanged, to `CAL/prove-booking.ts` (no directive) and both action files import it.
6. **No new GET route for the customer search.** The sheet reads the palette's own route, `GET /api/accounts/[accountId]/search?q=` (request client, RLS, `search/route.ts:54-98`), and uses its `contacts` half; the places list is the record's existing route (`api/accounts/[accountId]/contacts/[contactId]/places/route.ts`), which logs a `contact` open for the agency (`:51`). Nothing new to classify.
7. **The drawer opens by URL only.** A row's click and Enter push `?…&job=<id>`; the page reads that one job on the request client and calls `noteOpened(access, accountId, { kind: "contact", recordId })` itself, because the route walk requires the logger's first argument to be the guard's own result in the same function (`access-log-routes.test.ts:561-568`). So `CAL/page.tsx` moves from NOT_A_RECORD (`:54`, LIST) to RECORD (T12). A client-only drawer would have needed a record action instead.
8. **"You're closed that day" ignores running late.** `closedOut` also blocks starts inside today's delay (`slots.ts:253`); a staff warning calling a 30-minute delay "closed" would be wrong. `jobWarnings` passes `{ ...closures, lateBefore: null }`.
9. **The customer's own move page mints rooms by the calendar's type too** (`app/b/[publicId]/move/[token]/actions.ts:133`), not only Sofía's reschedule (`registry.ts:744`). T7 fixes the move page (bis-booking's), T8 Sofía's (bis-voice's).
10. **`listBookedRanges` gains `id`** (`booking.ts:248-262` selects only the range): a warning names the jobs it overlaps, and a second press must be refused when a NEW job appeared, so a warning's identity carries the ids.
11. **`EMAIL_STOPS_WHILE_PAUSED` is a `Record<EmailKind, boolean>`** (`classes.test.ts:182-212`), so it gains both new kinds too, beside the pins the spec named (`classes.test.ts:106-113`); `scans.test.ts`'s `SITES` (`:762`) and its "40 distinct" count (`:266-269`, becomes 42) move as well.
12. **Copy.** `calendar.agenda.cancelled` is dropped: `calendar.bookings.status.cancelled` and its `.es` exist (`messages.ts:1892-1893`). Added: `calendar.agenda.closedPlain`, `calendar.agenda.addedByYou`, `calendar.agenda.viewLabel`, `calendar.agenda.daysLabel`, `calendar.job.gone`, `calendar.job.noSuchTime`, `calendar.job.customerFallback`, and the moved-email trio (`calendar.job.movedEmailSent`/`Pending`/`Failed`). The drawer and its Cancel flow reuse twelve `calendar.bookings.*` keys with no `.es` twin, not four (spec §9): `cancel`, `join`, `markCompleted`, `markNoShow`, `cancelledToast`, `restored`, `restoreSlotTaken`, `restoreRescheduled`, `restoreNotOurs`, `statusUpdated`, `confirmed`, `confirmDeclined`. Closed heads reuse `business.state.closedToday`, `business.state.storm` and `business.reason.*` (all twinned).
13. **The settle and the in-place edit never write `updated_at`.** On a booking it is a cancel's version, written only by a status write (`booking.ts:384-387`); `claimCancelNotice` and `undoOperatorCancel` compare it.
14. **`listCalendarBookings` stays** (no caller after T12; its three live tests at `booking.test.ts:508`, `:638`, `:683` keep pinning `BOOKING_COLS`). Removal is deferred.
15. **`e2e/booking.spec.ts:370-390` reads the old list** (`getByText(noteText)`, `page.locator("li").filter(…)`, the row's Cancel button), which leaves the page. T14 rewrites those lines against the drawer; nothing else in `e2e/` reads `BookingsList` (grepped: `one-switch.spec.ts`'s `li` locators are scoped to `#closed-days`).
16. **Settling needs an origin.** The `after()` job takes `originFrom(await headers())` from the action's own request (the cancel's shape, `CAL/actions.ts:342`); the pass uses `ctx.origin`.
17. **ASSUMPTIONS, each with how it is verified:** (a) PostgREST surfaces a plpgsql `raise … using errcode = 'exclusion_violation'` as `error.code === "23P01"` exactly as it does a constraint's (verified only by T4's live round trip on CI: `createBooking` of a customer row over a staff job throws `SlotTakenError`); (b) a second FK from `bookings` (to `places`) does not make PostgREST see a many-to-many between `contacts` and `places` through `bookings` (bookings' primary key is `id` alone; verified by T4's live embed probe and by `same-account-fk-schema.test.ts`'s existing probes on CI); (c) Next's `after()` keeps the function alive for the 15 s wait under `maxDuration = 60` (the repo already relies on it, `CAL/actions.ts:356-361`, `CAL/page.tsx:31-38`; the cron pass is the backstop if not); (d) production holds a few hundred bookings (read by the orchestrator before applying, checklist step 7); (e) `Intl` short zone names differ between the two halves of a fall-back day in `es-US` (T3 asserts inequality, and exact strings only for `en-US`); (f) MCP `apply_migration` runs the file as ONE transaction. The constraint swap no longer depends on it (its drop and re-add are one `ALTER TABLE` statement, plan review), and checklist step 7 confirms the whole file landed. Assumptions (a) and (b) gate production: checklist step 6.

### Plan review fixes (2026-10-30; opus review of `68de6d5e`, re-verified on a scratch PG17.6 replica)

- **I1, a deadlock.** `undo_ai_booking_act`'s reschedule branch deletes the new booking and then restores the old one; the restore fires 0107's trigger, which locks the calendar row. A customer insert overlapping the new booking takes that lock first and then waits on the uncommitted delete: `deadlock detected … while locking tuple (0,1) in relation "calendars"` (reproduced by the planner on the replica). 0107 now `create or replace`s `undo_ai_booking_act` with ONE added statement, the calendar lock right after its `ai_acts` lock (invoker, `search_path`, volatility, grants and comment unchanged; `prosrc` diff is exactly those three lines), and `undo_staff_move` takes the same lock FIRST. "The lock rule" in Shared facts states it for any later multi-write unit. T1 gains two race cases and mutations (9) and (10). After the fix: the undo answers `undone` and the customer insert saves.
- **I2, a confirmation that never went, or went twice.** Claims (`claimJobHold`, `listDueJobHolds`) take BOOKED rows only, so an add's hold that falls due while a move has it cancelled stays unclaimed; the move's new row is written with `notice_wanted` NULL and `setJobNotice` decides it from a RE-READ of the old row after the cancel (unclaimed and wanting a confirmation → `"confirmation"`; claimed → `"moved"` when ticked); the Undo of a move RE-ARMS the restored row with one `after()` settle waiting out what is left of its own hold. T4 (h), T10's three cases.
- **I3, the drawer's Cancel deleted a moved job.** The delete requires `rescheduled_from_id is null` and answers `is_move`; a held move's Cancel runs the ordinary cancel flow (why: Cancel means the job is off; undoing the move would bring back a time nobody asked for, and the cancelled new row is never claimed, so no "moved" email goes). T4 (i), T10, T11.
- **I4, reminders gated on the clock.** Every forward due-list read now filters `hold_until.is.null,hold_settled_at.not.is.null`: a staff job is reminded only after its hold is claimed (T4, T9; T4 (d) flipped).
- **I5, a mutation pointed at the wrong cases.** Mutation (6) fails only "two overlapping staff-made rows"; the C9 and customer-first race names now cite mutation (1).
- **Minors.** A new address for a new customer: the action makes the contact, then the place, then the job (`JobDraft.newPlace`). T14's 10:00 control seeds a 60-minute slot and no buffer. A staff move's two events are written by the settle of its new row, never by `moveBooking`, so an undone move leaves none (D8 extended). The agenda shows `calendar.agenda.truncated` at the 400-row cap. T10 adds two `each(…)` lines; the palette terms are `registry.ts:76-77`. The constraint swap is one `ALTER TABLE` statement, and ASSUMPTION 17f names the one-transaction apply; checklist step 6 gates production on CI proving 17a and 17b.

---

## Shared facts every task relies on

`ACCT/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `CAL/` = `ACCT/calendar/`. `MIG/` = `packages/db/supabase/migrations/`. `DB/` = `packages/db/src/`. `WEB/` = `apps/web/src/`.

### SQL interfaces (T1)

```text
bookings.place_id uuid null          -> places (account_id, id) via bookings_place_fkey, NO ACTION
bookings.meeting_type text null      -- 'in_person' | 'phone' | 'video'; NULL = the calendar's type
bookings.hold_until timestamptz null -- staff add or move only (bookings_hold_staff_only)
bookings.hold_settled_at timestamptz null
bookings.notice_wanted text null     -- 'confirmation' | 'moved'; only with hold_until
bookings.notice_sent_at timestamptz null -- only after hold_settled_at
bookings_no_overlap  EXCLUDE gist (calendar_id =, tstzrange(starts_at, ends_at) &&) WHERE status = 'booked' AND author_kind <> 'person'
app.bookings_slot_guard()  SECURITY DEFINER trigger: BEFORE INSERT OR UPDATE OF status, starts_at, ends_at, calendar_id, author_kind;
                           locks the calendar row FOR NO KEY UPDATE; a customer-made live row over a live person row -> 23P01,
                           message 'bookings_no_overlap: overlaps a job staff booked'
public.undo_staff_move(p_account_id uuid, p_new_id uuid, p_old_id uuid, p_cancelled_at timestamptz, p_now timestamptz)
  returns text: 'undone' | 'gone' | 'too_late' | 'time_taken' | 'changed'     SECURITY INVOKER, EXECUTE service_role only
  -- locks the account's calendar row FIRST, before its delete (plan review item 1)
public.undo_ai_booking_act(...)   0091's, replaced with ONE added statement: the calendar lock right after its
                                  ai_acts lock; invoker, search_path, volatility and grants unchanged
```

**The lock rule (plan review item 1).** Every function or transaction that writes more than one booking takes the calendar row (`select … from public.calendars where account_id = … for no key update`) BEFORE its first booking write. The trigger takes it at each live write; a multi-write unit that waits for the trigger to take it deadlocks with a customer insert that took it first and then waits on the unit's uncommitted delete. A single PostgREST call writes one row, so the app's own multi-call sequences (`moveBooking`) are exempt: each call commits before the next.

### TypeScript interfaces

`DB/booking.ts` (T4; exported from `DB/index.ts`):

```ts
export type BookingMeetingType = "in_person" | "phone" | "video";
export type NoticeWanted = "confirmation" | "moved";
// BookingRow gains: meeting_type?: BookingMeetingType | null;   (optional: every existing fixture stays valid)
listBookedRanges(db, calendarId, fromIso, toIso, excludeBookingId?): Promise<{ id: string; starts_at: string; ends_at: string }[]>
export type StaffJobInput = {
  calendarId: string; contactId: string; startsAt: Date; endsAt: Date;
  note: string | null; placeId: string | null; meetingType: BookingMeetingType; meetingUrl: string | null;
  holdUntil: Date; noticeWanted: NoticeWanted | null; closureKept: boolean;
};
createStaffJob(db, accountId, input: StaffJobInput, actorId: string): Promise<{ id: string; cancelToken: string }>   // no event (D8)
export type StaffMoveJob = { note: string | null; placeId: string | null; meetingType: BookingMeetingType;
  holdUntil: Date; closureKept: boolean };
moveBooking(db, accountId, bookingId, to: { startsAt; endsAt; meetingUrl?; ipHash?; job?: StaffMoveJob }, actorId, actorType?)
  // without `job`: the new row carries the old row's place_id and meeting_type, and no hold; events as today
  // with `job`: the new row is held with notice_wanted NULL (setJobNotice decides it after the cancel), and moveBooking
  // writes NO events: the settle of the new row writes them (D8 extended, plan review minor), so an undone move leaves none
setJobNotice(db, accountId, bookingId, notice: NoticeWanted | null): Promise<boolean>   // only while the hold is unsettled
export const AGENDA_ROW_CAP = 400;
export type AgendaBookingRow = {
  id: string; contact_id: string; starts_at: string; ends_at: string; status: BookingStatus; note: string | null;
  author_kind: AuthorKind; author_id: string | null; meeting_type: BookingMeetingType | null; meeting_url: string | null;
  place_id: string | null; confirm_reply: "yes" | "no" | null; hold_until: string | null; hold_settled_at: string | null;
  notice_wanted: NoticeWanted | null; notice_sent_at: string | null; rescheduled_from_id: string | null; created_at: string;
  contact: { first_name: string | null; last_name: string | null; phone: string | null; email: string | null } | null;
  place: { label: string | null; address: string | null } | null;
  replaced: boolean;            // cancelled AND a row of this account names it in rescheduled_from_id
};
listAgendaBookings(db, accountId, fromIso, toIso): Promise<{ rows: AgendaBookingRow[]; truncated: boolean }>  // overlapping [from, to)
readAgendaJob(db, accountId, bookingId): Promise<AgendaBookingRow | null>
jobWasTold(db, accountId, bookingId): Promise<boolean>        // chain root customer/ai-made, or any row in the chain notice_sent_at
countAwaitingOutcomeBefore(db, accountId, beforeIso): Promise<number>   // booked, ends_at < before; THROWS on a null count
export type JobHoldClaim = { id: string; status: BookingStatus; notice_wanted: NoticeWanted | null; starts_at: string; ends_at: string;
  contact_id: string; calendar_id: string; place_id: string | null; meeting_url: string | null; cancel_token: string;
  rescheduled_from_id: string | null; author_id: string | null; hold_until: string; created_at: string };
claimJobHold(db, accountId, bookingId, nowIso): Promise<JobHoldClaim | null>   // status = 'booked' only (plan review item 2)
stampJobNoticeSent(db, accountId, bookingId): Promise<void>
listDueJobHolds(db, beforeIso, limit): Promise<{ accountId: string; bookingId: string; holdUntil: string }[]>   // booked only
export type UndoAddOutcome = "deleted" | "settled" | "moved" | "is_move" | "not_yours" | "gone";
deleteUnsettledStaffJob(db, accountId, bookingId, actorId): Promise<UndoAddOutcome>
export type UndoStaffMoveOutcome = "undone" | "gone" | "too_late" | "time_taken" | "changed";
undoStaffMove(db, accountId, newId, oldId, cancelledAt: string, now: Date): Promise<UndoStaffMoveOutcome>
export type JobDetails = { note: string | null; placeId: string | null; meetingType: BookingMeetingType | null; meetingUrl: string | null };
editJobDetails(db, accountId, bookingId, from: JobDetails, to: JobDetails): Promise<boolean>   // compare-and-set; never updated_at
// FeedBookingRow gains: meeting_type: BookingMeetingType | null
```

`WEB/lib/booking/` (T3):

```ts
// slots.ts
export function fitsOpenHours(openHours: OpenHours, start: Date, end: Date, timeZone: string): boolean;
// availability.ts
export function slotConfigFrom(calendar: CalendarRow, timezone: string): SlotConfig;   // was private
// job-warnings.ts
export type LiveRange = { id: string; startsAt: Date; endsAt: Date };
export type JobWarning = { kind: "outside_hours" } | { kind: "notice" } | { kind: "closed" }
  | { kind: "overlaps"; ids: string[]; firstStart: Date };
export type JobCheck = { refused: "past" | "invalid" | null; warnings: JobWarning[] };
export function jobWarnings(i: { config: SlotConfig; liveRanges: readonly LiveRange[]; now: Date;
  range: { startsAt: Date; endsAt: Date }; excludeId?: string | null }): JobCheck;
export function warningKey(w: JobWarning): string;          // "outside_hours" | "notice" | "closed" | "overlaps:<ids sorted, comma-joined>"
export function unseenWarnings(warnings: readonly JobWarning[], seen: readonly string[]): JobWarning[];
// agenda-window.ts
export type AgendaView = "day" | "week";
export type AgendaDay = { key: string; start: Date; end: Date; zoneShift: boolean };
export function parseAgendaParams(raw: { view?: string; day?: string }, today: string): { view: AgendaView; day: string };
export function weekStartKey(dayKey: string): string;                     // the Sunday on or before (D10)
export function shiftKey(view: AgendaView, dayKey: string, dir: -1 | 1): string;
export function agendaWindow(view: AgendaView, dayKey: string, timezone: string): { from: Date; to: Date; days: AgendaDay[] };
export function dayHasZoneShift(start: Date, end: Date, timezone: string): boolean;
export function agendaTime(instant: Date, timezone: string, locale: "en" | "es", withZone: boolean): string;
export function freeHours(i: { dayKey: string; timezone: string; openHours: OpenHours;
  live: readonly { startsAt: Date; endsAt: Date }[]; now: Date }): Date[];
export function wallToInstant(dayKey: string, hhmm: string, timezone: string): Date | null;   // null inside a DST gap
// agenda-lanes.ts
export type LaneInput = { id: string; startsAt: Date; endsAt: Date; live: boolean };
export type LaneItem = { kind: "single"; id: string } | { kind: "side"; lanes: [string[], string[]] } | { kind: "stack"; ids: string[] };
export function agendaLanes(rows: readonly LaneInput[]): { items: LaneItem[]; overlapping: ReadonlySet<string> };
```

`CAL/job-hold.ts` (T6):

```ts
export const JOB_NOTICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export type JobHoldOutcome = "lost" | "quiet" | "sent" | "failed" | "too_late";
export type SettleDeps = { db: SupabaseClient; origin: string | null; now?: () => Date;
  send?: (req: EmailRequest) => Promise<SendEmailResult> };
export async function settleJobHold(accountId: string, bookingId: string, deps: SettleDeps): Promise<JobHoldOutcome>;  // never throws
export async function settleAfterWindow(accountId: string, bookingId: string, origin: string | null,
  deps?: { db?: SupabaseClient; sleep?: (ms: number) => Promise<void>; waitMs?: number }): Promise<JobHoldOutcome>;  // sleeps waitMs ?? UNDO_WINDOW_MS + NOTICE_GRACE_MS
export async function jobNoticeAvailability(readDb: SupabaseClient, writer: SupabaseClient,
  accountId: string, contactId: string): Promise<NoticeAvailability>;
```

Server actions (T10, `CAL/agenda-actions.ts`; T11 and T12 consume them):

```ts
export type JobCustomer = { kind: "existing"; id: string } | { kind: "new"; name: string; phone: string; addAsNew: boolean };
export type JobFields = { date: string; start: string; minutes: number; what: string; placeId: string | null;
  meetingType: BookingMeetingType; notify: boolean };
export type JobDraft = JobFields & { customer: JobCustomer;
  /** A new address typed in the sheet: the raw fields `parsePlaceFields` (WEB/lib/contacts/place-input.ts:116) reads. The
   *  ACTION saves it on the customer, after the customer exists (a quick-add makes them first) and before the job;
   *  `placeId` is then ignored. Plan review minor: a place needs its contact first. */
  newPlace?: unknown };
export type JobWarningView = { key: string; kind: "outside_hours" | "notice" | "closed" | "overlaps" | "no_video";
  count?: number; at?: string };     // at: ISO of the earliest overlapped start
export type JobErrorKey = "calendar.job.past" | "calendar.job.noSuchTime" | "calendar.job.changed" | "calendar.job.saveFailed";
export type AddJobResult =
  | { ok: true; bookingId: string; startsAt: string; first: string; notice: "scheduled" | "none" | "no_email" | "address_blocked" }
  | { ok: false; needs: { phoneOwner: { id: string; name: string; first: string } } | { warnings: JobWarningView[] } }
  | { ok: false; errorKey: JobErrorKey };
export async function addJobAction(accountId: string, draft: JobDraft, seen: string[]): Promise<AddJobResult>;
export type UndoAddResult = { ok: true } | { ok: false; errorKey: "calendar.job.undoTooLate" | "calendar.job.undoMovedSince" | "calendar.bookings.statusUpdateFailed";
  /** The Undo cannot delete this row: its hold already settled, or it is a MOVE's new row ("is_move"). The drawer's
   *  Cancel then runs the ordinary cancel flow instead (plan review item 3). */
  fallback?: true };
export async function undoAddJobAction(accountId: string, bookingId: string): Promise<UndoAddResult>;
export type JobOpened = { startsAt: string; endsAt: string; note: string | null; placeId: string | null;
  meetingType: BookingMeetingType | null; meetingUrl: string | null };
export type MoveJobResult =
  | { ok: true; mode: "edited"; from: JobOpened; to: JobOpened }
  | { ok: true; mode: "moved"; newId: string; oldId: string; cancelledAt: string; startsAt: string; first: string; notice: "scheduled" | "none" }
  | { ok: false; needs: { warnings: JobWarningView[] } }
  | { ok: false; errorKey: JobErrorKey };
export async function moveJobAction(accountId: string, bookingId: string, draft: JobFields & { opened: JobOpened }, seen: string[]): Promise<MoveJobResult>;
export async function undoEditJobAction(accountId: string, bookingId: string, from: JobOpened, to: JobOpened): Promise<{ ok: true } | { ok: false; errorKey: "calendar.job.changed" }>;
export async function undoMoveJobAction(accountId: string, newId: string, oldId: string, cancelledAt: string):
  Promise<{ ok: true; startsAt: string } | { ok: false; errorKey: "calendar.job.moveUndoTaken" | "calendar.job.undoTooLate" | "calendar.job.changed" | "calendar.bookings.statusUpdateFailed" }>;
export async function jobNoticeOptionAction(accountId: string, contactId: string): Promise<{ ok: true; notice: NoticeAvailability } | { ok: false }>;
```

The URL: `CAL?view=day|week&day=YYYY-MM-DD[&job=<uuid>]`. `view` defaults to `day`, `day` to today in the account's zone; a `job` with no `day` opens the job's own day.

The hold: `hold_until = now + UNDO_WINDOW_MS + NOTICE_GRACE_MS` (10 s + 5 s, `CAL/undo-window.ts:14-15`); the toast's Undo lives `UNDO_WINDOW_MS`.

### Pinned lists this plan moves (grep was run for each before naming tasks)

| Pinned list | File:line | Moves | Task |
|---|---|---|---|
| `EXPECTED_DEFINERS`, its comment and two counts | `DB/test/definer-search-path.test.ts:25-28,30-68,79,84,93` | 36 → 37 (`app.bookings_slot_guard()`) | T1 |
| The overlap fixtures | `DB/test/booking.test.ts:66-87`, `:390-429` | collide through customer-made rows | T1 |
| `undo_ai_booking_act`'s booking seed helper | `DB/test/ai-acts-schema.test.ts:115-122` | gains `author?` (default `'ai'`) | T1 |
| `BOOKING` insert / `listBookedRanges` select | `DB/booking.ts:248-262,306-328` | + `id`; + extra columns | T4 |
| Reminder due-list reads | `DB/booking.ts:1592-1596,1604-1610` | + hold filter | T4 |
| SMS reminder / confirm due-list reads | `DB/automations.ts:652-657,802-807` | + hold filter | T9 |
| `EMAIL_KINDS` (+ comments) | `WEB/lib/consent/classes.ts:61-66,81-89,133` | 29 → 31 kinds; transactional 1 → 3 | T6 |
| `EMAIL_TABLE`, count, transactional pin, pause table | `WEB/lib/consent/classes.test.ts:102,106-108,111-113,211` | + two rows each | T6 |
| `SITES`, "40 distinct" | `WEB/lib/consent/scans.test.ts:266-269,792` | + two sites (`CAL/job-hold.ts`); 40 → 42 | T6 |
| `ALLOWED` (service client importers) | `ACCT/in-account-service-reads.test.ts:75-85` | + `calendar/job-hold.ts` (T6), + `calendar/agenda-actions.ts` (T10), both `proven-target` | T6, T10 |
| `PASSES` | `WEB/lib/automations/registry.ts:73` | + `jobHoldsPass` after `cancelNoticesPass` | T9 |
| Fan-out `HEAD` | `WEB/lib/automations/fanout.ts:69` | + `n("jobHolds", ["billingPause"])` after cancelNotices | T9 |
| `LEGACY_TICK_CEILING_S` | `WEB/lib/automations/fanout.ts:27` | 300 → 310 | T9 |
| Budget sum, `BUDGETS_MS`, `SENDS_PER_ROW`, test names | `WEB/lib/automations/cron-coupling.test.ts:16-29,336-375,393-404,431-438` | + `JOB_HOLD_BUDGET_MS` (six → seven) | T9 |
| `NOT_AFTER_RELEASE`, `PLAN` length, case 7 list, case 9d count | `WEB/lib/automations/fanout.test.ts:35-38,46,191-192,283-285` | + `jobHolds`; 21 → 22; 18 → 19 | T9 |
| `dbMocks`, results pin, `PASSES` keys | `WEB/lib/automations/sentinel.test.ts:57,240,295,305` | + `listDueJobHolds`, + `jobHolds` | T9 |
| Cron route bare mock and seven bodies | `WEB/app/api/cron/reminders/route.test.ts:212,328,451,474,497,513,606,623,667` | + `listDueJobHolds`, `EMPTY_JOB_HOLDS`, `jobHolds:` in each body | T9 |
| `RECORD` / `NOT_A_RECORD` (pages) | `ACCT/access-log-routes.test.ts:35-74` (`:54` LIST) | `calendar/page.tsx` LIST → RECORD | T12 |
| `NOT_A_RECORD_ACTIONS` | `ACCT/access-log-routes.test.ts:84-88` | + the seven agenda actions | T10 |
| Palette `/calendar` terms | `WEB/lib/palette/registry.ts:76-77` | + "agenda", "schedule", "add job", "trabajo", "agregar trabajo" | T7 |
| `READ_ONLY_ALLOWED` (billing pause) | `WEB/lib/billing/read-only.test.ts:149-176` | **none**: every agenda action is refused while paused, the notice-option read included (the add it serves is refused) | — |
| `technician-guards.test.ts` `PAGES` | `ACCT/technician-guards.test.ts:20-26` | **none**: a Technician reads the agenda; each write refuses on `seesWholeAccount` itself | — |
| `EXPECTED_WRITES`, client-write digest | `DB/test/schema-grants-guard.test.ts`, `DB/test/proposals-drop.test.ts` | **none**: no grant changes | — |
| `same-account-fk-schema.test.ts` `EXPECTED` | `:71-84` | **none**: it pins FKs per column (`contact_id`, `calendar_id`); `place_id` is a new column | — |

### Bare `@bis/db` mock factories a task must extend

| Test file (mock line) | Kind | Why | Task |
|---|---|---|---|
| `WEB/app/api/cron/reminders/route.test.ts:15` | bare | the jobHolds pass dereferences `listDueJobHolds` inside `run()` | T9 |
| `WEB/lib/automations/sentinel.test.ts:57-59` | partial (`importOriginal`) | the same, as a spy | T9 |
| `CAL/page.test.ts:79-87` | partial | the agenda reads `listAgendaBookings`, `readAgendaJob`, `countAwaitingOutcomeBefore`, `listPeopleNames`, `getBusinessStatusRow` | T12 |
| `CAL/actions.test.ts` (`vi.mock("@/lib/auth/visible")`) | module | `proveBooking` now lives in `prove-booking.ts` and still calls the mocked `callerCanSee` | T10 |
| `WEB/lib/voice/tools/registry.test.ts` (getBookingById answers) | bare | the reschedule reads `meeting_type` off the row | T8 |
| `WEB/app/b/[publicId]/move/[token]/actions.test.ts` | bare | the move reads `ctx.row.meeting_type` | T7 |

### File map

| File | Task |
|---|---|
| `MIG/0107_calendar_agenda.sql` (new); `DB/test/calendar-agenda-schema.test.ts` (new); `DB/test/definer-search-path.test.ts`; `DB/test/ai-acts-schema.test.ts`; `DB/test/booking.test.ts` (`:66-87`, `:390-429`) | T1 |
| `WEB/lib/messages.ts`, `WEB/lib/messages.test.ts` | T2 |
| `WEB/lib/booking/{job-warnings,agenda-window,agenda-lanes}.ts` + `.test.ts` (new); `WEB/lib/booking/slots.ts`, `slots.test.ts`; `WEB/lib/booking/availability.ts` | T3 |
| `DB/booking.ts`, `DB/index.ts`, `DB/booking-agenda.test.ts` (new), `DB/test/booking.test.ts` (new live blocks at its end) | T4 |
| `DB/places.ts`, `DB/places-bookings.test.ts` (new), `DB/test/places.test.ts`, `DB/test/head-count-null.test.ts` | T5 |
| `CAL/job-hold.ts`, `CAL/job-hold.test.ts` (new); `WEB/lib/email/templates/booking.ts`, `booking.test.ts`; `WEB/lib/consent/classes.ts`, `classes.test.ts`, `scans.test.ts`; `ACCT/in-account-service-reads.test.ts` | T6 |
| `WEB/lib/booking/feed-content.ts`, `feed-content.test.ts`; `ACCT/dashboard/affected-appointment-row.tsx` (+ its test); `ACCT/setup/steps/step-shared.tsx`, `step-shared.test.ts` (new: nothing pins `STEP_PATH` today); `CAL/calendar-settings.tsx`; `WEB/lib/palette/registry.ts`, `registry.test.ts`; `WEB/app/b/[publicId]/move/[token]/actions.ts`, `actions.test.ts`, `data.ts`; `WEB/app/b/[publicId]/cancel/[token]/data.ts` | T7 |
| `DB/voice.ts` (`getBookingById`), `WEB/lib/voice/tools/registry.ts`, `registry.test.ts` | T8 |
| `WEB/lib/automations/passes/job-holds.ts`, `job-holds.test.ts` (new); `registry.ts`; `fanout.ts`; `fanout.test.ts`; `cron-coupling.test.ts`; `sentinel.test.ts`; `WEB/app/api/cron/reminders/route.test.ts`; `DB/automations.ts`; `DB/automations-hold.test.ts` (new) | T9 |
| `CAL/agenda-actions.ts`, `agenda-actions.test.ts` (new); `CAL/prove-booking.ts` (new); `CAL/actions.ts`; `ACCT/in-account-service-reads.test.ts`; `ACCT/access-log-routes.test.ts` | T10 |
| `CAL/job-sheet.tsx`, `CAL/job-sheet-handlers.ts`, `job-sheet-handlers.test.ts`, `CAL/job-drawer.tsx`, `CAL/job-drawer-handlers.ts`, `job-drawer-handlers.test.ts` (all new); `apps/web/src/app/(dashboard)/dashboard/styleguide/job-demo.tsx`, `job-demo.test.ts` (new) | T11 |
| `CAL/agenda-card.tsx`, `CAL/agenda-view.ts`, `agenda-view.test.ts`, `CAL/agenda-day.tsx`, `CAL/agenda-week.tsx`, `CAL/agenda-skeleton.tsx` (all new); `CAL/page.tsx`, `CAL/page.test.ts`; `CAL/bookings-list.tsx`, `bookings-list.test.ts` (deleted); `ACCT/access-log-routes.test.ts`; `…/styleguide/agenda-demo.tsx`, `agenda-demo.test.ts` (new), `…/styleguide/page.tsx` | T12 |
| `DESIGN.md`, `docs/crm-features.md` | T13 |
| `apps/web/e2e/calendar-agenda.spec.ts` (new), `apps/web/e2e/booking.spec.ts` | T14 |

---

## Task list

| # | Title | Owner | Tier | Wave |
|---|---|---|---|---|
| T1 | 0107: columns, the narrowed overlap rule and its trigger, `undo_staff_move`; schema and race tests; the two fixtures | bis-db-schema | high | 1 |
| T2 | Every new string, English and usted Spanish, and the twelve missing `.es` twins | bis-booking | low | 1 |
| T3 | Pure rules: warnings, the window, lanes, zone-labelled times, free hours | bis-booking | medium | 1 |
| T4 | Query layer: staff jobs, the agenda read, the hold claim and Undo, the move's carry, the reminder hold filter, the feed's per-row kind | bis-booking | high | 2 |
| T5 | `removePlace` archives a place a job names | bis-crm | low | 2 |
| T6 | The settle and its two emails: `job-hold.ts`, the two `transactional` kinds, the address line | bis-booking (bis-comms co-review) | high | 3 |
| T7 | Links and the per-row meeting type: feed, the customer's move page, the dashboard and setup links, palette terms | bis-booking | low | 3 |
| T8 | Sofía's reschedule mints a room by the booking's own type | bis-voice | low | 3 |
| T9 | The `jobHolds` cron pass, and the hold filter in the text reminder and the appointment confirm | bis-automations | high | 4 |
| T10 | The agenda's server actions | bis-booking | medium | 4 |
| T11 | The Add job sheet (Move is the same form) and the job drawer | bis-booking (bis-frontend review) | medium | 5 |
| T12 | The Agenda card (Day, Week, phone), page order, states, the access-log record, styleguide | bis-booking (bis-frontend review) | medium | 5, after T11 commits |
| T13 | Docs: DESIGN.md's rule-8 line and the roadmap row | orchestrator | low | 1 (any time) |
| T14 | e2e: `calendar-agenda.spec.ts`, and `booking.spec.ts`'s calendar steps against the drawer | bis-e2e-qa | medium | 6 |

Spec §12 → this plan: spec T1 → T1; T2 → T4; T3 → T6; T4 → T9; T5 → T3; T6 → T5; T7 → T10, T11, T12; T8 → T2; T9 → T7; T10 → T8; T11 → T14; the docs are T13.

**Tiers** follow `bis-speed-process` (binding 2026-10-19): the migration (T1), the query layer that writes bookings and decides what the customer is told (T4), and the two send paths (T6, T9) are high: brief review, opus review with mutation probes, re-review. Server logic and UI are medium: implementer plus one review. Copy, links, the place rule and docs are low: no per-task review; the end-of-PR review covers them.

**Waves.** Wave 2 starts once T1 is green on the replica and committed (T4 and T5 need the columns). Wave 3 needs T2, T3 and T4 committed. Wave 4 needs T6 (T9 and T10 call `settleJobHold`). Wave 5 needs T10. T12 imports from T11's files, so T12 runs `pnpm --filter web typecheck` and commits only AFTER T11 has committed; neither stages the other's files. Wave 6 runs after everything has landed and 0107 is on bis-ci (checklist step 5). Two tasks in one wave never share a file; the file lists below are the complete set each task may touch.

---

### Task 1: 0107, its schema tests and the two fixtures

**Tier:** high · **Owner:** bis-db-schema · **Wave:** 1

**Files:**
- Create: `packages/db/supabase/migrations/0107_calendar_agenda.sql`
- Create: `packages/db/src/test/calendar-agenda-schema.test.ts`
- Modify: `packages/db/src/test/definer-search-path.test.ts:25-28,30-68,79,84,93`
- Modify: `packages/db/src/test/ai-acts-schema.test.ts:115-122` (helper) and add two cases at the end of the `booking_cancelled` describe (`:432-493`) and the `booking_rescheduled` describe (`:495-…`)
- Modify: `packages/db/src/test/booking.test.ts:66-87` and `:390-429` (CI-only proof)
- Scratch (not committed): `<your scratchpad>/ca-t1/pg17-ca.sh`

**Interfaces:** Produces every SQL object in "SQL interfaces". Consumes nothing.

- [ ] **Step 1: The replica.** Copy the recipe to `<your scratchpad>/ca-t1/pg17-ca.sh` and change exactly: `D` = that directory; port `55961` → `55971` (all three places); `W=/c/Users/danlo/bis-platform/.claude/worktrees/agenda`; `pre` skips `0107_*` instead of `0106_*`; `post` applies `$M/0107_calendar_agenda.sql` into `0107.apply.txt` and echoes `0107 apply exit`. Run `sh pg17-ca.sh init`. Expected last line: `pre = 106 files applied, last 0106_contact_merge.sql, on 17.6`. Confirm `psql -h localhost -p 55971 -U postgres -d pre -tAc "select count(*) from public.contact_merges"` answers `0`.

- [ ] **Step 2: The schema test, red first.** Create `packages/db/src/test/calendar-agenda-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { Client, type DatabaseError } from "pg";
import "dotenv/config";
import { withRollback } from "./db";

/**
 * 0107 (F-046 part 1, spec sections 3 and 7): staff-made jobs (author_kind = 'person') may overlap; a
 * customer-made live row (the public page, the customer's move, Sofia) may overlap nothing live, staff
 * jobs included; every live-booking write waits on its calendar row; undo_staff_move takes a staff move
 * back in one transaction.
 *
 * RED BEFORE 0107, legitimately: the catalogue, the two "staff may overlap" cases, the new columns' rules,
 * undo_staff_move and the customer-first race (0016's constraint refuses every overlap; the columns, the
 * trigger and the function do not exist). GREEN BEFORE 0107 TOO, and said so: the cases that pin what
 * customers KEEP (refused over a staff job, by insert and by un-cancel; back-to-back legal; a cancelled or
 * another calendar's job blocks nothing; the staff-first race), because 0016 already refused all of them.
 * Their red is each case's named mutation of 0107, run after apply (Step 4b). The undo_ai_booking_act lock
 * race is green before 0107 too (no trigger yet, so nothing deadlocks); its red is dropping 0107's added lock,
 * which turns it into 40P01. The race cases COMMIT, so they run only against a database on this machine
 * (access-log-concurrency.test.ts's onThisMachine).
 *
 * ONE REFUSED STATEMENT PER SAVEPOINT (`attempt`): a refusal otherwise aborts the transaction (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const T0 = Date.UTC(2031, 5, 2, 15);                              // 15:00 UTC, a Monday far ahead
const at = (h: number) => new Date(T0 + h * 3_600_000).toISOString();
let tok = 0;

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint s");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint s");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint s");
    throw e;
  }
}
const one = async (c: Client, sql: string, args: unknown[] = []) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;

type Seed = { agency: string; acct: string; acctB: string; cal: string; calB: string; ana: string; beto: string; anaB: string; place: string; placeB: string };
async function seed(c: Client, tag = "s"): Promise<Seed> {
  const agency = await one(c, "insert into public.agencies (name) values ('T0107') returning id");
  const acct = await one(c, "insert into public.accounts (agency_id, clerk_org_id, name) values ($1, $2, 'T0107 A') returning id", [agency, `org_test_0107a_${tag}_${RUN}`]);
  const acctB = await one(c, "insert into public.accounts (agency_id, clerk_org_id, name) values ($1, $2, 'T0107 B') returning id", [agency, `org_test_0107b_${tag}_${RUN}`]);
  const cal = await one(c, "insert into public.calendars (account_id, public_id) values ($1, $2) returning id", [acct, `t0107a${tag}${RUN}`]);
  const calB = await one(c, "insert into public.calendars (account_id, public_id) values ($1, $2) returning id", [acctB, `t0107b${tag}${RUN}`]);
  const ana = await one(c, "insert into public.contacts (account_id, first_name) values ($1, 'Ana') returning id", [acct]);
  const beto = await one(c, "insert into public.contacts (account_id, first_name) values ($1, 'Beto') returning id", [acct]);
  const anaB = await one(c, "insert into public.contacts (account_id, first_name) values ($1, 'Ana B') returning id", [acctB]);
  const place = await one(c, "insert into public.places (account_id, contact_id, address) values ($1, $2, '1 Main St') returning id", [acct, ana]);
  const placeB = await one(c, "insert into public.places (account_id, contact_id, address) values ($1, $2, '2 Elm St') returning id", [acctB, anaB]);
  return { agency, acct, acctB, cal, calB, ana, beto, anaB, place, placeB };
}

type Row = { kind?: "person" | "customer" | "ai"; status?: string; acct?: string; cal?: string; contact?: string;
  from?: number; to?: number; place?: string; meeting?: string; hold?: string; settled?: string; notice?: string;
  sent?: string; rescheduledFrom?: string; updatedAt?: string };
/** Inserts a booking naming ONLY the columns given, so the cases that use no 0107 column run (and fail by
 *  assertion) before 0107 too. Default: A's calendar, Ana, 15:00-16:00, booked, person-made. */
function booking(c: Client, s: Seed, r: Row = {}) {
  tok += 1;
  const cols: Record<string, unknown> = {
    account_id: r.acct ?? s.acct, calendar_id: r.cal ?? s.cal, contact_id: r.contact ?? s.ana,
    starts_at: at(r.from ?? 0), ends_at: at(r.to ?? 1), status: r.status ?? "booked",
    cancel_token: `tok_0107_${RUN}_${tok}`, author_kind: r.kind ?? "person",
    author_id: (r.kind ?? "person") === "person" ? "user_0107" : null,
    place_id: r.place, meeting_type: r.meeting, hold_until: r.hold, hold_settled_at: r.settled,
    notice_wanted: r.notice, notice_sent_at: r.sent, rescheduled_from_id: r.rescheduledFrom, updated_at: r.updatedAt,
  };
  const names = Object.keys(cols).filter((k) => cols[k] !== undefined);
  return attempt(c, `insert into public.bookings (${names.join(", ")}) values (${names.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
    names.map((k) => cols[k])).then((res) => res.rows[0]!.id as string);
}
const refusal = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { const d = e as DatabaseError; return { code: d.code, constraint: d.constraint ?? null, message: d.message }; }
  return null;
};
const statusOf = async (c: Client, id: string) =>
  (await c.query<{ status: string; updated_at: Date }>("select status, updated_at from public.bookings where id = $1", [id])).rows[0];

describe("0107: the catalogue", () => {
  it("adds the six columns, nullable, with no default", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'bookings'
            and column_name in ('place_id','meeting_type','hold_until','hold_settled_at','notice_wanted','notice_sent_at')
          order by column_name`);
      expect(rows).toEqual([
        { column_name: "hold_settled_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "hold_until", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "meeting_type", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "notice_sent_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "notice_wanted", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "place_id", data_type: "uuid", is_nullable: "YES", column_default: null },
      ]);
    }));

  it("bookings_no_overlap keeps its name and binds live customer-made rows only (mutation: re-add it without the author_kind term -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.bookings'::regclass and conname = 'bookings_no_overlap'");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.def).toContain("EXCLUDE USING gist");
      expect(rows[0]!.def).toContain("status = 'booked'");
      expect(rows[0]!.def).toContain("author_kind <> 'person'");
    }));

  it("the guard fires before insert and before an update of status, starts_at, ends_at, calendar_id or author_kind (mutation: before insert only -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ def: string }>(
        "select pg_get_triggerdef(oid) as def from pg_trigger where tgrelid = 'public.bookings'::regclass and tgname = 'bookings_slot_guard'");
      expect(rows.map((r) => r.def)).toEqual([
        "CREATE TRIGGER bookings_slot_guard BEFORE INSERT OR UPDATE OF status, starts_at, ends_at, calendar_id, author_kind ON public.bookings FOR EACH ROW EXECUTE FUNCTION app.bookings_slot_guard()",
      ]);
    }));

  it("app.bookings_slot_guard is a definer with pg_temp last; undo_staff_move an invoker only service_role may run (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select p.proname, p.prosecdef, p.proconfig,
                has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
                has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
                has_function_privilege('service_role', p.oid, 'EXECUTE') as svc
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where (n.nspname, p.proname) in (('app', 'bookings_slot_guard'), ('public', 'undo_staff_move'))
          order by p.proname`);
      expect(rows).toEqual([
        { proname: "bookings_slot_guard", prosecdef: true, proconfig: ["search_path=pg_catalog, pg_temp"], auth: false, anon: false, svc: true },
        { proname: "undo_staff_move", prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"], auth: false, anon: false, svc: true },
      ]);
    }));

  it("the three indexes exist with their predicates (mutation: drop bookings_staff_live -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string }>(
        "select indexname from pg_indexes where schemaname = 'public' and tablename = 'bookings' and indexname in ('bookings_place','bookings_hold_due','bookings_staff_live') order by 1");
      expect(rows.map((r) => r.indexname)).toEqual(["bookings_hold_due", "bookings_place", "bookings_staff_live"]);
    }));
});

describe("0107: who may overlap (R1, R2, R11)", () => {
  it("two overlapping staff-made rows both save, side by side (R1; mutation: drop `and author_kind <> 'person'` from the constraint -> 23P01, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 0, to: 1 });
      expect(await refusal(booking(c, s, { from: 0.5, to: 1.5, contact: s.beto }))).toBeNull();
    }));

  it("a customer-made row over a live staff job is refused 23P01 naming bookings_no_overlap (R2; mutations: drop the trigger's exists -> saves, FAILS; errcode P0001 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 0, to: 1 });
      const r = await refusal(booking(c, s, { kind: "customer", from: 0.5, to: 1.5, contact: s.beto }));
      expect(r?.code).toBe("23P01");
      expect(r?.message).toContain("bookings_no_overlap");
    }));

  it("Sofia's row (ai) is customer-made too and is refused over a staff job (mutation: the trigger tests author_kind = 'customer' -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 0, to: 1 });
      expect((await refusal(booking(c, s, { kind: "ai", from: 0.25, to: 0.75 })))?.code).toBe("23P01");
    }));

  it("two overlapping customer-made rows: still the constraint's own 23P01 (mutation: predicate author_kind = 'person' -> saves, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { kind: "customer", from: 0, to: 1 });
      const r = await refusal(booking(c, s, { kind: "customer", from: 0.5, to: 1.5, contact: s.beto }));
      expect(r).toMatchObject({ code: "23P01", constraint: "bookings_no_overlap" });
    }));

  it("a customer row starting exactly at a staff job's end, or ending exactly at its start, saves ([) bounds; mutation: tstzrange(..., '[]') in the trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 1, to: 2 });
      expect(await refusal(booking(c, s, { kind: "customer", from: 2, to: 3 }))).toBeNull();
      expect(await refusal(booking(c, s, { kind: "customer", from: 0, to: 1, contact: s.beto }))).toBeNull();
    }));

  it("a cancelled staff job blocks nothing (mutation: drop b.status = 'booked' from the exists -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { from: 0, to: 1, status: "cancelled" });
      expect(await refusal(booking(c, s, { kind: "customer", from: 0, to: 1 }))).toBeNull();
    }));

  it("a staff job on account B's calendar does not block account A (mutation: drop b.calendar_id = new.calendar_id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { acct: s.acctB, cal: s.calB, contact: s.anaB, from: 0, to: 1 });
      expect(await refusal(booking(c, s, { kind: "customer", from: 0, to: 1 }))).toBeNull();
    }));

  it("a cancelled customer row flipped back to booked over a staff job is refused (the UPDATE path; mutation: before insert only -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const old = await booking(c, s, { kind: "customer", status: "cancelled", from: 0, to: 1 });
      await booking(c, s, { from: 0, to: 1, contact: s.beto });
      const r = await refusal(attempt(c, "update public.bookings set status = 'booked' where id = $1", [old]));
      expect(r?.code).toBe("23P01");
      expect((await statusOf(c, old))!.status).toBe("cancelled");
    }));

  it("a staff job flipped back to booked over a customer row saves (R1; mutation: the constraint without its author_kind term -> 23P01, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const job = await booking(c, s, { status: "cancelled", from: 0, to: 1 });
      await booking(c, s, { kind: "customer", from: 0, to: 1, contact: s.beto });
      expect(await refusal(attempt(c, "update public.bookings set status = 'booked' where id = $1", [job]))).toBeNull();
    }));
});

describe("0107: the new columns' rules", () => {
  it("a place of another account is refused 23503 by bookings_place_fkey (mutation: a single-column FK onto places(id) -> saves, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusal(booking(c, s, { place: s.placeB }))).toMatchObject({ code: "23503", constraint: "bookings_place_fkey" });
      expect(await refusal(booking(c, s, { place: s.place, contact: s.beto, from: 3, to: 4 }))).toBeNull();
    }));

  it("a place a job names cannot be deleted (NO ACTION; mutation: on delete set null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await booking(c, s, { place: s.place });
      expect(await refusal(attempt(c, "delete from public.places where id = $1", [s.place])))
        .toMatchObject({ code: "23503", constraint: "bookings_place_fkey" });
    }));

  it.each([
    ["bookings_meeting_type_check", { meeting: "zoom" }],
    ["bookings_hold_staff_only", { kind: "customer" as const, hold: at(-1) }],
    ["bookings_hold_settled_pair", { settled: at(-1) }],
    ["bookings_notice_wanted_check", { notice: "confirmation" }],
    ["bookings_notice_wanted_check", { hold: at(-1), notice: "reminder" }],
    ["bookings_notice_sent_after", { hold: at(-1), notice: "confirmation", sent: at(-1) }],
  ])("%s refuses %j (mutation: drop that constraint -> FAILS)", (name, row) =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusal(booking(c, s, row))).toMatchObject({ code: "23514", constraint: name });
    }));

  it("a fully settled staff job with every column saves (the positive control for the table above)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await refusal(booking(c, s, {
        place: s.place, meeting: "video", hold: at(-1), settled: at(-1), notice: "moved", sent: at(-1),
      }))).toBeNull();
    }));
});

describe("0107: undo_staff_move (spec 3.3)", () => {
  const V = new Date(T0 - 60_000).toISOString();
  const NOW = new Date(T0 - 30_000).toISOString();
  const undo = async (c: Client, acct: string, neu: string, old: string, version = V) => {
    await c.query("set local role service_role");
    try {
      return (await attempt(c, "select public.undo_staff_move($1, $2, $3, $4, $5) as r", [acct, neu, old, version, NOW])).rows[0]!.r as string;
    } finally {
      await c.query("reset role");
    }
  };
  /** A staff move as moveBooking leaves it: the old row cancelled at V, the new person row naming it, its hold open. */
  async function moved(c: Client, s: Seed, o: { oldKind?: "person" | "customer"; settled?: boolean } = {}) {
    const old = await booking(c, s, { kind: o.oldKind ?? "person", status: "cancelled", updatedAt: V, from: 0, to: 1 });
    const neu = await booking(c, s, { from: 5, to: 6, rescheduledFrom: old, hold: at(-0.01), settled: o.settled ? at(-0.005) : undefined });
    return { old, neu };
  }

  it("undone: the new row is GONE and the old one booked again at p_now (mutation: cancel the new row instead of deleting it -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      expect(await undo(c, s.acct, m.neu, m.old)).toBe("undone");
      expect((await c.query("select 1 from public.bookings where id = $1", [m.neu])).rowCount).toBe(0);
      expect(await statusOf(c, m.old)).toEqual({ status: "booked", updated_at: new Date(NOW) });
    }));

  it("too_late: the new row's hold has settled (its email went or is going); nothing changes (mutation: drop hold_settled_at is null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s, { settled: true });
      expect(await undo(c, s.acct, m.neu, m.old)).toBe("too_late");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
      expect((await statusOf(c, m.old))!.status).toBe("cancelled");
    }));

  it("time_taken: a customer booking cannot come back over a staff job that took its time, and the new row stays (mutation: move the restore outside the inner block -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s, { oldKind: "customer" });
      await booking(c, s, { from: 0, to: 1, contact: s.beto });
      expect(await undo(c, s.acct, m.neu, m.old)).toBe("time_taken");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
      expect((await statusOf(c, m.old))!.status).toBe("cancelled");
    }));

  it("changed: the old row no longer carries the move's version (mutation: drop updated_at = p_cancelled_at -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      expect(await undo(c, s.acct, m.neu, m.old, new Date(T0 - 59_000).toISOString())).toBe("changed");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
    }));

  it("changed: a row names the new one in rescheduled_from_id (mutation: drop the not-exists -> the delete lands, the FK's SET NULL silently unlinks that row, and it answers undone, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      // The new row stays BOOKED here on purpose: a real second move would cancel it, and then the status
      // term alone would refuse the delete, so the not-exists guard could not be seen to matter.
      await booking(c, s, { from: 8, to: 9, rescheduledFrom: m.neu });
      expect(await undo(c, s.acct, m.neu, m.old)).toBe("changed");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
    }));

  it("gone: an unknown new id, and another account's id, touch nothing (mutation: drop b.account_id = p_account_id from the delete -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      expect(await undo(c, s.acct, "00000000-0000-0000-0000-000000000000", m.old)).toBe("gone");
      expect(await undo(c, s.acctB, m.neu, m.old)).toBe("gone");
      expect((await statusOf(c, m.neu))!.status).toBe("booked");
    }));

  it("the client role cannot call it (42501)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const m = await moved(c, s);
      await c.query("set local role authenticated");
      expect((await refusal(attempt(c, "select public.undo_staff_move($1, $2, $3, $4, $5)", [s.acct, m.neu, m.old, V, NOW])))?.code).toBe("42501");
      await c.query("reset role");
    }));
});

/* ---------- the races: two committed connections, this machine only ---------- */

function onThisMachine(raw: string | undefined): boolean {
  if (!raw || raw.includes("?")) return false;
  try {
    const host = new URL(raw).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}
const connect = async () => {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL!, connectionTimeoutMillis: 10_000 });
  await c.connect();
  return c;
};
async function waitsOnLock(admin: Client, pid: number): Promise<boolean> {
  for (let i = 0; i < 50; i++) {
    const { rowCount } = await admin.query("select 1 from pg_stat_activity where pid = $1 and wait_event_type = 'Lock'", [pid]);
    if (rowCount) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}
async function raceSeed(admin: Client, tag: string): Promise<Seed> {
  await admin.query("begin");
  const s = await seed(admin, tag);
  await admin.query("commit");
  return s;
}
async function raceTeardown(admin: Client, s: Seed | null) {
  if (!s) return;
  await admin.query("delete from public.bookings where account_id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.places where account_id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.calendars where account_id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.contacts where account_id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.accounts where id = any($1::uuid[])", [[s.acct, s.acctB]]);
  await admin.query("delete from public.agencies where id = $1", [s.agency]);
}
const ins = (kind: "person" | "customer", s: Seed, n: number) =>
  `insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, author_kind, author_id)
   values ('${s.acct}', '${s.cal}', '${s.ana}', '${at(0)}', '${at(1)}', 'tok_0107_race_${RUN}_${n}', '${kind}', ${kind === "person" ? "'user_0107'" : "null"})`;

describe("0107: the calendar lock (spec 7), this machine only", () => {
  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("staff first: a customer insert WAITS on the uncommitted staff job, then is refused 23P01 (mutation: drop `for no key update` -> it does not wait and saves, FAILS)", async () => {
    const admin = await connect(); const c1 = await connect(); const c2 = await connect();
    let s: Seed | null = null;
    try {
      s = await raceSeed(admin, "r1");
      const { rows: [p] } = await c2.query<{ pid: number }>("select pg_backend_pid() as pid");
      await c1.query("begin");
      await c1.query(ins("person", s, 1));
      const second = c2.query(ins("customer", s, 2)).then(() => "saved", (e: DatabaseError) => e.code);
      expect(await waitsOnLock(admin, p!.pid)).toBe(true);
      await c1.query("commit");
      expect(await second).toBe("23P01");
    } finally {
      await c1.query("rollback").catch(() => {});
      await raceTeardown(admin, s);
      await Promise.all([admin.end(), c1.end(), c2.end()]);
    }
  });

  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("customer first: the staff insert waits, then saves beside it (R1; mutation: the constraint without its author_kind term -> the constraint waits, then refuses 23P01, FAILS)", async () => {
    const admin = await connect(); const c1 = await connect(); const c2 = await connect();
    let s: Seed | null = null;
    try {
      s = await raceSeed(admin, "r2");
      const { rows: [p] } = await c2.query<{ pid: number }>("select pg_backend_pid() as pid");
      await c1.query("begin");
      await c1.query(ins("customer", s, 3));
      const second = c2.query(ins("person", s, 4)).then(() => "saved", (e: DatabaseError) => e.code);
      expect(await waitsOnLock(admin, p!.pid)).toBe(true);
      await c1.query("commit");
      expect(await second).toBe("saved");
    } finally {
      await c1.query("rollback").catch(() => {});
      await raceTeardown(admin, s);
      await Promise.all([admin.end(), c1.end(), c2.end()]);
    }
  });
});

/* ---------- the undo functions take the calendar lock FIRST (plan review item 1), this machine only ----------
 * Both undos delete one booking and then restore another. The restore fires bookings_slot_guard, which locks the
 * calendar row; taken only there, a customer insert that took the lock first and then waits on the uncommitted
 * delete (its exclusion check) deadlocks with the undo. Reproduced before the fix on the planner's replica:
 * `deadlock detected … while locking tuple (0,1) in relation "calendars"` from undo_ai_booking_act. */
async function moveSeed(admin: Client, tag: string) {
  await admin.query("begin");
  const s = await seed(admin, tag);
  const q1 = async (sql: string, args: unknown[]) => (await admin.query<{ id: string }>(sql, args)).rows[0]!.id;
  const phone = await q1("insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [s.acct, `+1956${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`]);
  const call = await q1("insert into public.calls (account_id, phone_number_id, contact_id) values ($1, $2, $3) returning id", [s.acct, phone, s.ana]);
  const ins = (cols: string, vals: unknown[]) =>
    q1(`insert into public.bookings (account_id, calendar_id, contact_id, ${cols}) values ($1, $2, $3, ${vals.map((_, i) => `$${i + 4}`).join(", ")}) returning id`,
      [s.acct, s.cal, s.ana, ...vals]);
  // A staff move as moveBooking leaves it, and Sofia's reschedule as 0091's act names it.
  const staffOld = await ins("starts_at, ends_at, cancel_token, author_kind, status, updated_at", [at(0), at(1), `so_${tag}_${RUN}`, "customer", "cancelled", "2031-01-01T00:00:00.123456Z"]);
  const staffNew = await ins("starts_at, ends_at, cancel_token, author_kind, author_id, rescheduled_from_id, hold_until", [at(24), at(25), `sn_${tag}_${RUN}`, "person", "user_0107", staffOld, at(-1)]);
  const aiOld = await ins("starts_at, ends_at, cancel_token, author_kind, status, updated_at", [at(48), at(49), `ao_${tag}_${RUN}`, "ai", "cancelled", "2031-01-01T00:00:00.123Z"]);
  const aiNew = await ins("starts_at, ends_at, cancel_token, author_kind, rescheduled_from_id", [at(72), at(73), `an_${tag}_${RUN}`, "ai", aiOld]);
  const act = await q1(`insert into public.ai_acts (account_id, actor, call_id, contact_id, kind, target, before, after)
                        values ($1, 'voice', $2, $3, 'booking_rescheduled', $4, $5, '{}') returning id`,
    [s.acct, call, s.ana, JSON.stringify({ bookingId: aiNew, fromBookingId: aiOld }), JSON.stringify({ version: "2031-01-01T00:00:00.123Z" })]);
  await admin.query("commit");
  return { s, staffOld, staffNew, aiOld, aiNew, act };
}
async function moveTeardown(admin: Client, s: Seed | null) {
  if (!s) return;
  await admin.query("delete from public.ai_acts where account_id = $1", [s.acct]);
  await admin.query("delete from public.calls where account_id = $1", [s.acct]);
  await admin.query("delete from public.phone_numbers where account_id = $1", [s.acct]);
  await raceTeardown(admin, s);
}

describe("0107: both undos lock the calendar before they delete (plan review item 1), this machine only", () => {
  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("undo_ai_booking_act: a customer insert overlapping the booking being taken back neither deadlocks nor is lost (mutation: drop 0107's added `perform … for no key update` -> 40P01 deadlock detected, FAILS)", async () => {
    const admin = await connect(); const c1 = await connect(); const c2 = await connect(); const c3 = await connect();
    let m: Awaited<ReturnType<typeof moveSeed>> | null = null;
    try {
      m = await moveSeed(admin, "d1");
      const { rows: [p1] } = await c1.query<{ pid: number }>("select pg_backend_pid() as pid");
      // c3 holds the OLD row, so the undo stops between its delete and its restore.
      await c3.query("begin");
      await c3.query("select id from public.bookings where id = $1 for update", [m.aiOld]);
      await c1.query("set role service_role");
      const undo = c1.query<{ r: string }>("select public.undo_ai_booking_act($1, $2, 'race', now()) as r", [m.s.acct, m.act])
        .then((r) => r.rows[0]!.r, (e: DatabaseError) => e.code);
      expect(await waitsOnLock(admin, p1!.pid)).toBe(true);
      // A customer books over the NEW booking's time while the undo is parked.
      const insert = c2.query(
        `insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, author_kind)
         values ($1, $2, $3, $4, $5, $6, 'customer')`, [m.s.acct, m.s.cal, m.s.ana, at(72.5), at(73.5), `cx_d1_${RUN}`])
        .then(() => "saved", (e: DatabaseError) => e.code);
      await new Promise((r) => setTimeout(r, 500));
      await c3.query("commit");
      expect(await undo).toBe("undone");
      expect(await insert).toBe("saved");
    } finally {
      await c3.query("rollback").catch(() => {});
      await moveTeardown(admin, m?.s ?? null);
      await Promise.all([admin.end(), c1.end(), c2.end(), c3.end()]);
    }
  });

  it.skipIf(!onThisMachine(process.env.SUPABASE_DB_URL))("undo_staff_move: while another write holds the calendar row, the undo waits BEFORE deleting, so the new row is not yet locked (mutation: drop its first `perform … for no key update` -> the row is locked, 55P03, FAILS)", async () => {
    const admin = await connect(); const c1 = await connect(); const c2 = await connect();
    let m: Awaited<ReturnType<typeof moveSeed>> | null = null;
    try {
      m = await moveSeed(admin, "d2");
      const { rows: [p1] } = await c1.query<{ pid: number }>("select pg_backend_pid() as pid");
      await c2.query("begin");
      await c2.query(`insert into public.bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token, author_kind)
                      values ($1, $2, $3, $4, $5, $6, 'customer')`, [m.s.acct, m.s.cal, m.s.ana, at(200), at(201), `cx_d2_${RUN}`]);
      await c1.query("set role service_role");
      const undo = c1.query<{ r: string }>("select public.undo_staff_move($1, $2, $3, $4, now()) as r",
        [m.s.acct, m.staffNew, m.staffOld, "2031-01-01T00:00:00.123456Z"]).then((r) => r.rows[0]!.r, (e: DatabaseError) => e.code);
      expect(await waitsOnLock(admin, p1!.pid)).toBe(true);
      await admin.query("begin");
      const probe = await admin.query("select id from public.bookings where id = $1 for update nowait", [m.staffNew])
        .then(() => "not locked", (e: DatabaseError) => e.code);
      await admin.query("rollback");
      expect(probe).toBe("not locked");
      await c2.query("commit");
      expect(await undo).toBe("undone");
    } finally {
      await c2.query("rollback").catch(() => {});
      await moveTeardown(admin, m?.s ?? null);
      await Promise.all([admin.end(), c1.end(), c2.end()]);
    }
  });
});
```

Run it against `pre`: `SUPABASE_DB_URL=postgresql://postgres@localhost:55971/pre pnpm --filter @bis/db exec vitest run src/test/calendar-agenda-schema.test.ts`. Expected: the cases the header names as red fail, the "customers keep" cases pass. Paste the failing assertion line of "two overlapping staff-made rows both save" (`expected { code: '23P01', … } to be null`) and of "the customer-first race" (`expected '23P01' to be 'saved'`), and the summary line.

- [ ] **Step 3: The migration.** Create `packages/db/supabase/migrations/0107_calendar_agenda.sql`:

```sql
-- 0107_calendar_agenda.sql - staff put phoned-in jobs on the calendar (F-046 part 1)
-- (docs/superpowers/specs/2026-10-30-calendar-agenda-design.md sections 3, 4 and 7;
--  docs/superpowers/plans/2026-10-30-calendar-agenda.md Task 1)
--
-- WHY. Nothing on the dashboard writes a booking, and the database refuses every overlap: 0016's
-- bookings_no_overlap binds every live row. The owner's rulings (spec section 2): a job staff book may
-- overlap other bookings (R1) and still blocks that time for customers (R2); the overlap rule narrows
-- to customer-made rows, a check refuses a customer-made row over any live booking, and every booking
-- write locks its calendar row (R11). Staff-made is author_kind = 'person' (0073).
--
-- WHAT THIS FILE ADDS:
--   bookings.place_id         the job's address, one of the account's places (composite FK onto
--                             places (account_id, id), NO ACTION: a job's address cannot vanish).
--   bookings.meeting_type     in_person | phone | video. NULL means the calendar's own type, which is
--                             what every earlier row means; readers coalesce with calendars.meeting_type.
--   bookings.hold_until       a staff add or move: the end of its Undo window plus the grace.
--   bookings.hold_settled_at  the one claim on that hold (the after() job or the jobHolds cron pass).
--   bookings.notice_wanted    'confirmation' | 'moved' | NULL: the email the settle sends.
--   bookings.notice_sent_at   stamped after the email gate answered SENT.
--   Five CHECKs and one FK on them; indexes bookings_place, bookings_hold_due, bookings_staff_live.
--   bookings_no_overlap, re-added under the same name: live customer-made rows only.
--   app.bookings_slot_guard() and its trigger: every live-booking write waits on its calendar row, and a
--     customer-made live row overlapping a live staff job is refused 23P01 (exclusion_violation), which
--     createBooking, setBookingStatus, moveBooking and undo_ai_booking_act already map.
--   public.undo_staff_move(...): the Undo of a staff move in one transaction, calendar row locked FIRST.
--   public.undo_ai_booking_act, replaced with one added statement: it locks the calendar row right after
--     its ai_acts lock. Its reschedule branch deletes one booking and then restores another; taking the
--     calendar lock only at the restore (the trigger) deadlocks with a customer insert that took it first
--     and then waits on the uncommitted delete (plan review 2026-10-30, item 1). Body, search_path,
--     SECURITY INVOKER and grants are otherwise exactly 0091's as 0096 left them.
--
-- WHO WRITES. Only service_role, as since 0053: the Calendar page's agenda actions, their after() job
-- and the cron pass write the new columns after their own checks.
--
-- GRANTS. No table grant changes: authenticated keeps its table-level SELECT on bookings and so reads
-- the new columns; it writes nothing. EXPECTED_WRITES (schema-grants-guard.test.ts) and the client-write
-- digest (proposals-drop.test.ts) are unchanged. undo_staff_move: EXECUTE to service_role only.
--
-- SEARCH PATHS (0096 rule). Both functions set search_path = pg_catalog, pg_temp. app.bookings_slot_guard
-- is SECURITY DEFINER (a check run under a caller's RLS fails OPEN for a future client writer whose policy
-- hides a staff job) and joins EXPECTED_DEFINERS (definer-search-path.test.ts, 36 -> 37).
-- undo_staff_move is SECURITY INVOKER, 0091's undo_ai_booking_act shape.
--
-- LOCKS. Dropping and re-adding the exclusion constraint and building bookings_staff_live take ACCESS
-- EXCLUSIVE on bookings for two small gist builds; the FK takes SHARE ROW EXCLUSIVE on places.
-- lock_timeout 5s. ASSUMPTION: production holds a few hundred bookings at most (33 on 2026-10-08, 0061's
-- note); the orchestrator reads the count before applying.
--
-- APPLY ORDER: after 0106 everywhere. CI project (ci-project-setup.yml: push-dry-run, then push), then
-- production (MCP apply_migration, name calendar_agenda), then the parity check, then merge.
-- LOAD-BEARING: from the agenda's first build on, the app names every new column and calls
-- undo_staff_move, so production gets this file BEFORE the merge deploy.
-- ONE TRANSACTION. ASSUMPTION: MCP apply_migration runs the file as one transaction (the replica runs it with
-- psql -1). The constraint swap does not rely on it: its drop and re-add are ONE ALTER TABLE statement, so no
-- moment exists without an overlap rule. A partial apply would leave columns without their trigger or functions,
-- which the running build never names; the orchestrator confirms the whole file applied (checklist step 7).
-- SAFE UNDER THE RUNNING BUILD: its customer rows meet the same exclusion constraint as before plus a
-- trigger that finds no live staff job to collide with; its person-made rows (the demo seed, whose slots
-- never overlap) gain only the freedom to overlap.
--
-- ROLLBACK (roll the app back first). 0016's constraint cannot be re-added while two live rows overlap.
-- List them first:
--   select a.id, b.id from public.bookings a join public.bookings b
--     on a.calendar_id = b.calendar_id and a.id < b.id
--    where a.status = 'booked' and b.status = 'booked'
--      and tstzrange(a.starts_at, a.ends_at) && tstzrange(b.starts_at, b.ends_at);
-- and the owner decides each pair (cancel one, or keep 0107). Then:
--   drop trigger bookings_slot_guard on public.bookings;
--   drop function app.bookings_slot_guard();
--   drop function public.undo_staff_move(uuid, uuid, uuid, timestamptz, timestamptz);
--   (undo_ai_booking_act keeps its added calendar lock: harmless without the trigger.)
--   drop index public.bookings_staff_live, public.bookings_place, public.bookings_hold_due;
--   alter table public.bookings drop constraint bookings_no_overlap;
--   alter table public.bookings drop column place_id, drop column meeting_type, drop column hold_until,
--     drop column hold_settled_at, drop column notice_wanted, drop column notice_sent_at;
--   alter table public.bookings add constraint bookings_no_overlap
--     exclude using gist (calendar_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'booked');
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The columns and their rules.
alter table public.bookings
  add column place_id uuid,
  add column meeting_type text,
  add column hold_until timestamptz,
  add column hold_settled_at timestamptz,
  add column notice_wanted text,
  add column notice_sent_at timestamptz,
  add constraint bookings_meeting_type_check
    check (meeting_type is null or meeting_type in ('in_person', 'phone', 'video')),
  add constraint bookings_place_fkey foreign key (account_id, place_id)
    references public.places (account_id, id),
  add constraint bookings_hold_staff_only check (hold_until is null or author_kind = 'person'),
  add constraint bookings_hold_settled_pair check (hold_settled_at is null or hold_until is not null),
  add constraint bookings_notice_wanted_check
    check (notice_wanted is null or (notice_wanted in ('confirmation', 'moved') and hold_until is not null)),
  add constraint bookings_notice_sent_after check (notice_sent_at is null or hold_settled_at is not null);

create index bookings_place on public.bookings (place_id) where place_id is not null;
create index bookings_hold_due on public.bookings (hold_until)
  where hold_until is not null and hold_settled_at is null;

comment on column public.bookings.place_id is
  'F-046: the job address, one of this account''s places. NULL = none. NO ACTION: a place a job names is archived, never deleted (removePlace).';
comment on column public.bookings.meeting_type is
  'F-046: in_person, phone or video for this booking. NULL = the calendar''s meeting_type; readers coalesce.';
comment on column public.bookings.hold_until is
  'F-046: a staff add or move, the end of its Undo window plus grace. Due-lists skip a row whose hold is still open.';
comment on column public.bookings.hold_settled_at is
  'F-046: the one claim on the hold (claimJobHold): the after() job or the jobHolds pass. The Undo deletes only while this is NULL.';

-- 2. The overlap rule: the constraint for customer-made rows, the trigger for customer against staff.
-- ONE statement: the drop and the re-add are atomic even if the apply were not one transaction.
alter table public.bookings
  drop constraint bookings_no_overlap,
  add constraint bookings_no_overlap
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
  -- R11: every live-booking write on this calendar waits here, so the check below always sees a staff
  -- job that committed first. FOR NO KEY UPDATE does not conflict with the FOR KEY SHARE an FK check
  -- into calendars takes. The exists below is a new statement, so it reads a snapshot taken after the
  -- lock was granted (READ COMMITTED).
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
comment on function app.bookings_slot_guard() is
  'F-046 (0107): locks the calendar row for every live-booking write, and refuses (23P01) a customer-made live row overlapping a live staff job.';
create trigger bookings_slot_guard
  before insert or update of status, starts_at, ends_at, calendar_id, author_kind on public.bookings
  for each row execute function app.bookings_slot_guard();
revoke all on function app.bookings_slot_guard() from public, anon, authenticated;

-- 3. The Undo of a staff move (0091's reschedule branch for a staff move). Answers undone, gone,
--    too_late (the hold settled: the moved email went or is going), time_taken (the old row could not
--    come back over a staff job), changed.
create function public.undo_staff_move(
  p_account_id uuid, p_new_id uuid, p_old_id uuid, p_cancelled_at timestamptz, p_now timestamptz)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_n integer;
  v_settled timestamptz;
begin
  -- The calendar row FIRST, before the delete: the restore below fires bookings_slot_guard, which takes
  -- this lock; taken only there, it deadlocks with a customer insert holding it and waiting on our delete.
  perform 1 from public.calendars c where c.account_id = p_account_id for no key update;
  begin
    delete from public.bookings b
     where b.account_id = p_account_id and b.id = p_new_id and b.status = 'booked'
       and b.rescheduled_from_id = p_old_id and b.author_kind = 'person'
       and b.hold_until is not null and b.hold_settled_at is null
       and not exists (select 1 from public.bookings r
                        where r.account_id = p_account_id and r.rescheduled_from_id = p_new_id);
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'undo_staff_move: the new booking cannot be taken back' using errcode = 'ZA003';
    end if;
    update public.bookings b set status = 'booked', updated_at = p_now
     where b.account_id = p_account_id and b.id = p_old_id and b.status = 'cancelled'
       and b.updated_at = p_cancelled_at;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      raise exception 'undo_staff_move: the old booking changed' using errcode = 'ZA004';
    end if;
  exception
    when exclusion_violation then
      return 'time_taken';
    when sqlstate 'ZA004' then
      return 'changed';
    when sqlstate 'ZA003' then
      select b.hold_settled_at into v_settled
        from public.bookings b where b.account_id = p_account_id and b.id = p_new_id;
      if not found then
        return 'gone';
      end if;
      if v_settled is not null then
        return 'too_late';
      end if;
      return 'changed';
  end;
  return 'undone';
end;
$$;
comment on function public.undo_staff_move(uuid, uuid, uuid, timestamptz, timestamptz) is
  'F-046 (0107): the Undo of a staff move. Deletes the new row while its hold is unsettled and restores the old row by the move''s own version, in one transaction. Service role only.';
revoke all on function public.undo_staff_move(uuid, uuid, uuid, timestamptz, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.undo_staff_move(uuid, uuid, uuid, timestamptz, timestamptz) to service_role;

-- 4. undo_ai_booking_act (0091, search_path as 0096 left it): the same body with ONE added statement, the
--    calendar lock right after the act lock and before any booking write (item 1 of the plan review).
--    SECURITY INVOKER, volatile, EXECUTE service_role only: create or replace keeps the grants and comment.
create or replace function public.undo_ai_booking_act(p_account_id uuid, p_act_id uuid, p_by text, p_now timestamptz)
returns text
language plpgsql
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_kind text;
  v_undone timestamptz;
  v_target jsonb;
  v_before jsonb;
  v_after jsonb;
  v_id uuid;
  v_from uuid;
  v_status text;
  v_starts timestamptz;
  v_n integer;
begin
  select a.kind, a.undone_at, a.target, a.before, a.after
    into v_kind, v_undone, v_target, v_before, v_after
    from public.ai_acts a
   where a.account_id = p_account_id and a.id = p_act_id
   for update;
  if not found then
    return 'gone';
  end if;
  if v_kind not in ('booking_created', 'booking_rescheduled', 'booking_cancelled') then
    raise exception 'undo_ai_booking_act: not a booking act: %', p_act_id using errcode = '22023';
  end if;
  if v_undone is not null then
    return 'already_undone';
  end if;
  -- 0107: the calendar row before any booking write (bookings_slot_guard takes it on the restore below;
  -- taken only there, the reschedule branch deadlocks with a customer insert waiting on its delete).
  perform 1 from public.calendars c where c.account_id = p_account_id for no key update;
  v_id := (v_target ->> 'bookingId')::uuid;

  if v_kind = 'booking_created' then
    update public.bookings b set status = 'cancelled', updated_at = p_now
     where b.account_id = p_account_id and b.id = v_id and b.status = 'booked' and b.starts_at > p_now;
    get diagnostics v_n = row_count;
    if v_n = 0 then
      select b.status, b.starts_at into v_status, v_starts
        from public.bookings b where b.account_id = p_account_id and b.id = v_id;
      if not found then
        return 'gone';
      end if;
      if v_status <> 'booked' then
        return 'already_cancelled';
      end if;
      return 'already_happened';
    end if;

  elsif v_kind = 'booking_cancelled' then
    begin
      update public.bookings b set status = 'booked', updated_at = p_now
       where b.account_id = p_account_id and b.id = v_id and b.status = 'cancelled'
         and b.updated_at = (v_after ->> 'version')::timestamptz
         and b.starts_at > p_now
         and not exists (select 1 from public.bookings r
                          where r.account_id = p_account_id and r.rescheduled_from_id = v_id);
      get diagnostics v_n = row_count;
    exception when exclusion_violation then
      return 'time_taken';
    end;
    if v_n = 0 then
      select b.status, b.starts_at into v_status, v_starts
        from public.bookings b where b.account_id = p_account_id and b.id = v_id;
      if not found then
        return 'gone';
      end if;
      if v_status = 'booked' then
        return 'rebooked';
      end if;
      if v_starts <= p_now then
        return 'time_passed';
      end if;
      return 'changed';
    end if;

  else
    v_from := (v_target ->> 'fromBookingId')::uuid;
    begin
      delete from public.bookings b
       where b.account_id = p_account_id and b.id = v_id and b.status = 'booked' and b.starts_at > p_now
         and not exists (select 1 from public.bookings r
                          where r.account_id = p_account_id and r.rescheduled_from_id = v_id);
      get diagnostics v_n = row_count;
      if v_n = 0 then
        raise exception 'undo_ai_booking_act: the new booking changed' using errcode = 'ZA001';
      end if;
      update public.bookings b set status = 'booked', updated_at = p_now
       where b.account_id = p_account_id and b.id = v_from and b.status = 'cancelled'
         and b.updated_at = (v_before ->> 'version')::timestamptz
         and b.starts_at > p_now;
      get diagnostics v_n = row_count;
      if v_n = 0 then
        raise exception 'undo_ai_booking_act: the old booking changed' using errcode = 'ZA002';
      end if;
    exception
      when exclusion_violation then
        return 'old_time_taken';
      when sqlstate 'ZA001' then
        return 'changed';
      when sqlstate 'ZA002' then
        return 'changed';
    end;
  end if;

  update public.ai_acts a set undone_at = p_now, undone_by = p_by
   where a.account_id = p_account_id and a.id = p_act_id;
  return 'undone';
end;
$$;
```

Check the text before applying: `grep -nP '[^\x00-\x7F]' 0107_calendar_agenda.sql` and `grep -n '\\' 0107_calendar_agenda.sql` both print nothing; `grep -o '\$\$' 0107_calendar_agenda.sql | wc -l` is 8 (the do block and three functions). Section 4's body is 0091's `undo_ai_booking_act` exactly as `pg_get_functiondef` prints it on a replica of 0001–0106, plus the three marked lines: build it by copying that output (between `AS $function$` and `$function$`) and adding them, then confirm with `diff` of `prosrc` before and after apply that ONLY those three lines differ (the planner's run of this: `27a28,30`, the comment pair and the `perform`).

- [ ] **Step 4: Apply and go green.** `sh pg17-ca.sh post` (expected `0107 apply exit 0`). Then run Step 2's file against `post`. Expected: `Tests  34 passed` (5 catalogue, 9 overlap, 9 column-rule, 7 undo, 2 race, 2 undo-lock; none skipped, the race cases run because the URL is localhost). Paste the summary line.
- [ ] **Step 4b: The mutations of 0107**, each in a scratch copy of the file applied to a fresh `post` (`sh pg17-ca.sh post` re-creates it from `pre`), each failing the named case BY NAME, then restored: (1) the constraint without `and author_kind <> 'person'` → "two overlapping staff-made rows", "a staff job flipped back to booked over a customer row saves" and the customer-first race; (2) the trigger's `if … and exists (…)` removed → "a customer-made row over a live staff job"; (3) `errcode = 'P0001'` → the same case's code assertion; (4) `before insert` only → "flipped back to booked over a staff job"; (5) `for no key update` removed → "staff first" race; (6) the trigger checking every author (drop `new.author_kind <> 'person' and`) → "two overlapping staff-made rows" only (a staff row then meets the other staff row; C9 and the customer-first race meet a CUSTOMER row, which the trigger never checks, so they stay green and are guarded by (1)); (7) `tstzrange(…, '[]')` in the trigger → the back-to-back case; (8) the restore moved after the inner block → "time_taken"; (9) drop the `perform … for no key update` 0107 adds to undo_ai_booking_act → its lock race FAILS with 40P01; (10) drop undo_staff_move's first `perform` → its lock-order case FAILS with 55P03. Paste each failing line.

- [ ] **Step 5: The definer pin.** In `definer-search-path.test.ts`: add `"app.bookings_slot_guard()": PG_CATALOG_PG_TEMP,` after `"app.account_role(uuid)"` (`:31`); `:25-28`'s comment becomes "The 37 SECURITY DEFINER functions in public and app at 0107 (0106's 36, 0107 adds app.bookings_slot_guard), …"; `:79` "exactly these 36" → 37; `:84` `toHaveLength(36)` → 37; `:93` floor 36 → 37. Run it on `pre` (red: `expected [ …36 items ] to have a length of 37`… paste it) and on `post` (green). Mutation: drop `security definer` from the trigger function in a scratch copy of 0107, rebuild `post`: the count case FAILS by name. Restore.

- [ ] **Step 6: The two 0091 interactions.** In `ai-acts-schema.test.ts:115-122`, `booking()` gains `author?: string` in its options and writes `o.author ?? 'ai'` in place of the literal `'ai'` (one more `$10` parameter). Add to the `booking_cancelled` describe: "a staff job that took the time answers time_taken (0107's trigger raises exclusion_violation, not P0001)" — the cancelled ai booking `b` at 24, `await booking(c, s, 24.5, { contact: s.theirs, author: "person" })`, `undoBooking` → `"time_taken"`, `b` still cancelled. Add to the `booking_rescheduled` describe: "the old slot taken by a staff job answers old_time_taken, the new booking still booked" (`pair`, then `booking(c, s, 24.5, { contact: s.theirs, author: "person" })`). Both are green BEFORE 0107 too (0016's constraint binds a person row as well) and say so in their names: they are the mutation guards for the trigger's errcode. Run on `post` with `-t "undo_ai_booking_act|function grants and settings"`: the summary must show every case of the three `undo_ai_booking_act` describes AND of "0091: function grants and settings" (`:1031-1066`, which pins the replaced function's invoker status, `search_path`, volatility and EXECUTE grants, so `create or replace` must leave them exactly) run and pass UNCHANGED (paste it). Mutation: `errcode = 'P0001'` in a scratch 0107 → both new cases FAIL by name. Restore.

- [ ] **Step 7: The two live fixtures (CI proves them).** `booking.test.ts:66-87`: both `createBooking` calls at `:73` and `:75-77` pass `"public", "system"` (the customer's actor), and the comment above `:66` says why: "0107: only a customer-made row is refused; a person-made row may overlap (R1)". Directly after that test add `it("F-046 (0107): two overlapping staff-made bookings both save (R1)", …)`: two `createBooking(…, "user_test")` rows at 15:00-16:00 and 15:30-16:30 on 2027-03-03, both resolve. `booking.test.ts:390-429` (D-036): `b` (`:416`) is created with `"public", "system"`, so its un-cancel re-enters the rule; the in-between row (`:418`) stays `"public", "system"`; after `:421` add: a person-made row `c2` at `range("04")`, cancelled, a customer row booked into `range("04")`, then `setBookingStatus(…, c2.id, "booked", "user_test", "user", { onlyFrom: "cancelled" })` RESOLVES (R1: a staff job may come back beside it). These run only on CI verify; record "not run locally" in the report.

- [ ] **Step 8: Commit.**

```bash
git add packages/db/supabase/migrations/0107_calendar_agenda.sql packages/db/src/test/calendar-agenda-schema.test.ts packages/db/src/test/definer-search-path.test.ts packages/db/src/test/ai-acts-schema.test.ts packages/db/src/test/booking.test.ts
git commit -m "feat(db): 0107 lets staff jobs overlap while customers keep every rule, locks the calendar row per booking write, and takes a staff move back in one call" -- packages/db/supabase/migrations/0107_calendar_agenda.sql packages/db/src/test/calendar-agenda-schema.test.ts packages/db/src/test/definer-search-path.test.ts packages/db/src/test/ai-acts-schema.test.ts packages/db/src/test/booking.test.ts
```

Leave the replica running for the reviewer (port 55971, `pre` and `post`), and put both database names in the report.

---

### Task 2: Every new string, English and usted Spanish

**Tier:** low · **Owner:** bis-booking · **Wave:** 1

**Files:** Modify `apps/web/src/lib/messages.ts` (the new block directly after `calendar.bookings.status.no_show.es` at `:1897`; the twelve `.es` twins each on the line after its English key: `:1825-1829`, `:1836-1840`, `:3087-3088`) and `apps/web/src/lib/messages.test.ts` (a new `describe` after the merge block that starts at `:2467`).

**Interfaces:** Produces these keys. Each English key is followed by its `.es` twin on the very next line. A `{count}` key has a `One` twin picked by `plural()` (`WEB/lib/i18n/t.ts:54`).

| Key | English | Spanish |
|---|---|---|
| `calendar.agenda.title` | Schedule | Agenda |
| `calendar.agenda.day` / `week` | Day / Week | Día / Semana |
| `calendar.agenda.viewLabel` | Schedule view | Vista de la agenda |
| `calendar.agenda.back` / `today` / `next` | Back / Today / Next | Anterior / Hoy / Siguiente |
| `calendar.agenda.daysLabel` | Days of this week | Días de esta semana |
| `calendar.agenda.addJob` | Add job | Agregar trabajo |
| `calendar.agenda.addAt` | Add job at {time} | Agregar trabajo a las {time} |
| `calendar.agenda.emptyTitle` | Nothing booked {day}. | No hay nada agendado {day}. |
| `calendar.agenda.emptyBody` | Jobs you add and bookings customers make show here. Add the first one. | Aquí aparecen los trabajos que usted agrega y las citas que hacen sus clientes. Agregue el primero. |
| `calendar.agenda.emptyTechnician` | None of your customers have a job {day}. | Ninguno de sus clientes tiene trabajo {day}. |
| `calendar.agenda.error` | Couldn't load your schedule. | No se pudo cargar su agenda. |
| `calendar.agenda.retry` | Try again | Intentar de nuevo |
| `calendar.agenda.closed` | Closed · {reason} | Cerrado · {reason} |
| `calendar.agenda.closedPlain` | Closed | Cerrado |
| `calendar.agenda.outsideHours` | Outside open hours | Fuera del horario |
| `calendar.agenda.overlaps` | Overlaps | Se empalma |
| `calendar.agenda.addedBy` | Added by {name} | Agregado por {name} |
| `calendar.agenda.addedByYou` | Added by you | Agregado por usted |
| `calendar.agenda.bookedOnline` | Booked online | Reservada en línea |
| `calendar.agenda.bookedBy` | Booked by {persona} | Agendada por {persona} |
| `calendar.agenda.pastOpen` / `pastOpenOne` | {count} past jobs still need Completed or No-show · To do / 1 past job still needs Completed or No-show · To do | {count} trabajos pasados aún necesitan Terminado o No llegó · Pendientes / 1 trabajo pasado aún necesita Terminado o No llegó · Pendientes |
| `calendar.agenda.truncated` | Only the first {cap} jobs are shown here. Open a single day to see them all. | Aquí solo se muestran los primeros {cap} trabajos. Abra un solo día para verlos todos. |
| `calendar.job.titleAdd` / `titleMove` | Add a job / Move this job | Agregar un trabajo / Cambiar el horario de este trabajo |
| `calendar.job.customer` | Customer | Cliente |
| `calendar.job.search` | Search by name or phone | Busque por nombre o teléfono |
| `calendar.job.newCustomer` | New customer | Cliente nuevo |
| `calendar.job.name` / `phone` | Name / Phone | Nombre / Teléfono |
| `calendar.job.phoneOwner` | {name} already has this number. Use {first}? | {name} ya tiene este número. ¿Usar a {first}? |
| `calendar.job.useExisting` | Use {first} | Usar a {first} |
| `calendar.job.addAsNew` | Add as new | Agregar como nuevo |
| `calendar.job.customerFallback` | the customer | el cliente |
| `calendar.job.date` / `start` | Date / Starts | Fecha / Empieza |
| `calendar.job.length` | How long | Duración |
| `calendar.job.minutes` | {minutes} min | {minutes} min |
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
| `calendar.job.warn.overlaps` / `overlapsOne` | Overlaps {count} jobs / Overlaps a job at {time} | Se empalma con {count} trabajos / Se empalma con un trabajo a las {time} |
| `calendar.job.warn.noVideo` | Video calls aren't set up, so this job won't have a link. | Las videollamadas no están configuradas, así que este trabajo no tendrá enlace. |
| `calendar.job.past` | That time has already passed. Pick a time from now on. | Esa hora ya pasó. Elija una hora de ahora en adelante. |
| `calendar.job.noSuchTime` | That time doesn't exist that day because the clocks change. Pick another. | Esa hora no existe ese día porque cambia el horario. Elija otra. |
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
| `calendar.job.movedEmailSent` | New time emailed {time} | Nuevo horario enviado {time} |
| `calendar.job.movedEmailPending` | We'll email the new time in a few seconds | Enviaremos el nuevo horario en unos segundos |
| `calendar.job.movedEmailFailed` | Couldn't email the new time | No se pudo enviar el nuevo horario |
| `calendar.job.openRecord` | Open record | Abrir ficha |
| `calendar.job.gone` | This job isn't on the calendar any more. | Este trabajo ya no está en la agenda. |

The twelve `.es` twins added to existing keys (English unchanged, read off `messages.ts`):

| Key (line) | Spanish |
|---|---|
| `calendar.bookings.join` (`:1825`) | Unirse |
| `calendar.bookings.cancel` (`:1826`) | Cancelar |
| `calendar.bookings.markCompleted` (`:1827`) | Marcar como terminado |
| `calendar.bookings.markNoShow` (`:1828`) | No llegó |
| `calendar.bookings.statusUpdated` (`:1829`) | Cita actualizada |
| `calendar.bookings.cancelledToast` (`:1836`) | Cita cancelada. No le avisamos al cliente, así que avísele usted. |
| `calendar.bookings.restored` (`:1837`) | La cita sigue en pie. |
| `calendar.bookings.restoreSlotTaken` (`:1838`) | Alguien más agendó ese horario después de que la canceló, así que esta cita no se puede restaurar. |
| `calendar.bookings.restoreRescheduled` (`:1839`) | Esta cita se cambió a otro horario, así que la anterior no se puede restaurar. |
| `calendar.bookings.restoreNotOurs` (`:1840`) | El cliente la canceló, por enlace o en una llamada, así que no se puede restaurar desde aquí. |
| `calendar.bookings.confirmed` (`:3087`) | Confirmó por mensaje |
| `calendar.bookings.confirmDeclined` (`:3088`) | Pidió otro horario |

The email line ("Where" / "Dónde") lives in the template's own copy object (T6), not here: the customer templates do not read `m`.

- [ ] **Step 1: Failing test.** Add `describe("F-046 part 1: the agenda and job copy, English and Spanish (plan Task 2)")` in the shape of the merge block (`messages.test.ts:2467-2665`): a `WANT` record holding every row of both tables (both languages, both `One` twins), "has every key with exactly this text", "every English key has its .es twin on the very next line" (for the twelve, the line after the existing key), and the usted check that block carries. Add: no `WANT` value contains "→", "{{", "survivor", "tú", " tu " or "Sofía" (a persona is always a placeholder).
- [ ] **Step 2: Run red:** `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n`. Expected `calendar.agenda.title: expected undefined to be 'Schedule'`. Paste it.
- [ ] **Step 3: Add the keys**, each English key followed by its `.es` line.
- [ ] **Step 4: Run green**, `src/lib/i18n` included (the accents guard, the ratchet and catalogue parity pass with NO baseline change: adding twins to frozen keys passes, `ratchet.test.ts:166`). Paste the summary line.
- [ ] **Step 5: Mutations:** move `calendar.job.save.es` one line down → "the .es twin on the very next line" FAILS naming it; write "Agrega trabajo" into `calendar.agenda.addJob.es` → "exactly this text" FAILS naming it. Restore.
- [ ] **Step 6: Commit:** `git commit -m "feat(booking): the agenda and job copy in English and usted Spanish, and Spanish for the booking words the drawer reuses" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`

---

### Task 3: The pure rules

**Tier:** medium · **Owner:** bis-booking · **Wave:** 1

**Files:**
- Create: `apps/web/src/lib/booking/job-warnings.ts`, `job-warnings.test.ts`, `agenda-window.ts`, `agenda-window.test.ts`, `agenda-lanes.ts`, `agenda-lanes.test.ts`
- Modify: `apps/web/src/lib/booking/slots.ts` (one new export after `endsByClose`, `:235-241`), `slots.test.ts` (one describe)
- Modify: `apps/web/src/lib/booking/availability.ts:37` (`function slotConfigFrom` → `export function slotConfigFrom`)

**Interfaces:** Produces the `WEB/lib/booking/` block in "Shared facts". Consumes `partsInZone`, `zonedTimeToUtc`, `normalizeOpenHours`, `closedOut` (`slots.ts`), `dayKey`, `addDays`, `startOfDay`, `isDateKey` (`WEB/lib/business-status/status.ts:54,77,83,109`).

- [ ] **Step 1: `fitsOpenHours`, red then green.** Test first (in `slots.test.ts`, a new describe): America/Chicago, Monday 09:00–17:00: 09:00 for 60 min fits; 16:30 for 60 min does not; 08:55 does not; a Sunday with no hours does not; `"22:00-24:00"` with 22:00 for 120 min fits; on 2026-03-08 (spring forward) `"00:00-03:00"` with 01:00 for 120 min does NOT (the gap eats an hour: it ends at 04:00 wall — the engine's own `endsByClose` reason); an invalid zone answers false. Mutation: drop the `endsByClose` call → the spring-forward row FAILS. Code:

```ts
/** F-046: whether [start, end) sits inside one open interval of start's own account-zone day, on the wall
 *  clock AND in real time (`endsByClose`), as the engine fits a slot. For the staff warning only: it never
 *  decides what a customer is offered. Fails CLOSED (false), so a doubt shows the warning. */
export function fitsOpenHours(openHours: OpenHours, start: Date, end: Date, timeZone: string): boolean {
  try {
    const s = start.getTime();
    const e = end.getTime();
    if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return false;
    const p = partsInZone(start, timeZone);
    const cal = { y: p.y, m: p.m, d: p.d };
    const from = p.hh * 60 + p.mi;
    const lengthMinutes = Math.round((e - s) / 60_000);
    const weekday = WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]!;
    for (const [f, t] of normalizeOpenHours(openHours)[weekday] ?? []) {
      const fm = minutesOf(f);
      const tm = minutesOf(t);
      if (from < fm || from + lengthMinutes > tm) continue;
      if (endsByClose(end, cal, tm, timeZone)) return true;
    }
    return false;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}
```

- [ ] **Step 2: `jobWarnings`, red then green.** `job-warnings.test.ts` (config: Chicago, Mon–Fri 09:00–17:00, notice 12 h, closures empty; `now` = Monday 2027-03-01 08:00 CST):
  - each warning alone, with the other three satisfied (the adjacent-satisfaction shape: a job that is ONLY outside hours, ONLY inside notice, ONLY on a closed day, ONLY overlapping);
  - the notice boundary: a start at exactly `now + 12 h` gives no `notice` (mutation: `<=` → FAILS); one minute earlier gives it;
  - closed by a closed-day key, by a storm (`blockAll`), and NOT by running late (`lateBefore` set; mutation: pass `closures` unmodified → FAILS);
  - overlaps: two live ranges overlapping are ONE warning with both ids sorted and `firstStart` the earlier (mutation: take the last → FAILS); back-to-back is no overlap (mutation: `<=` → FAILS); `excludeId` leaves the moving job out;
  - refused: a start before `now` is `refused: "past"` with no warnings; an `endsAt <= startsAt` is `"invalid"`;
  - `warningKey` for overlaps is `overlaps:<a>,<b>` in id order whatever the input order; `unseenWarnings` drops exactly the keys in `seen` and keeps a NEW overlap key (`overlaps:a,b,c` against seen `overlaps:a,b`).
  Code:

```ts
import { closedOut, fitsOpenHours, type SlotConfig } from "./slots";

/** F-046 (spec 5.4, 6.1): what a staff job breaks. Staff may break every rule but the past (R3); the page
 *  shows each warning once and saves only when nothing new appeared. No buffer: the buffer is a customer rule. */
export type LiveRange = { id: string; startsAt: Date; endsAt: Date };
export type JobWarning =
  | { kind: "outside_hours" } | { kind: "notice" } | { kind: "closed" }
  | { kind: "overlaps"; ids: string[]; firstStart: Date };
export type JobCheck = { refused: "past" | "invalid" | null; warnings: JobWarning[] };

export function jobWarnings(i: {
  config: SlotConfig; liveRanges: readonly LiveRange[]; now: Date;
  range: { startsAt: Date; endsAt: Date }; excludeId?: string | null;
}): JobCheck {
  const s = i.range.startsAt.getTime();
  const e = i.range.endsAt.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return { refused: "invalid", warnings: [] };
  if (s < i.now.getTime()) return { refused: "past", warnings: [] };
  const warnings: JobWarning[] = [];
  if (!fitsOpenHours(i.config.openHours, i.range.startsAt, i.range.endsAt, i.config.timezone)) warnings.push({ kind: "outside_hours" });
  // Fails closed: a NaN notice reads as "inside notice".
  if (!(s >= i.now.getTime() + i.config.minNoticeHours * 3_600_000)) warnings.push({ kind: "notice" });
  // Running late is not "closed" (plan correction 8).
  if (i.config.closures && closedOut(i.range.startsAt, { ...i.config.closures, lateBefore: null }, i.config.timezone)) {
    warnings.push({ kind: "closed" });
  }
  const hits = i.liveRanges
    .filter((r) => r.id !== i.excludeId)
    .filter((r) => {
      const rs = r.startsAt.getTime();
      const re = r.endsAt.getTime();
      return !Number.isFinite(rs) || !Number.isFinite(re) || (rs < e && s < re);
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  if (hits.length > 0) warnings.push({ kind: "overlaps", ids: hits.map((h) => h.id).sort(), firstStart: hits[0]!.startsAt });
  return { refused: null, warnings };
}

export function warningKey(w: JobWarning): string {
  return w.kind === "overlaps" ? `overlaps:${[...w.ids].sort().join(",")}` : w.kind;
}

export function unseenWarnings(warnings: readonly JobWarning[], seen: readonly string[]): JobWarning[] {
  const known = new Set(seen);
  return warnings.filter((w) => !known.has(warningKey(w)));
}
```

- [ ] **Step 3: `agenda-window.ts`, red then green.** Tests pin exact ISO instants:
  - `agendaWindow("day", "2026-03-08", "America/Chicago")` = `{ from: "2026-03-08T06:00:00.000Z", to: "2026-03-09T05:00:00.000Z" }`, one day, `zoneShift: true`; `"2026-11-01"` = `05:00Z → 06:00Z` next day, `zoneShift: true` (mutation: `to = from + 24 h` → FAILS both);
  - America/Havana on 2026-03-08 (Cuba moves its clocks at midnight, so midnight is the gap): `from` = `2026-03-08T05:00:00.000Z` (that day's 01:00, `startOfDay`, `status.ts:108-111`) and `to` = `2026-03-09T04:00:00.000Z`;
  - Pacific/Kiritimati (UTC+14) `"2028-02-29"` = `2028-02-28T10:00:00.000Z → 2028-02-29T10:00:00.000Z`;
  - week: `agendaWindow("week", "2026-10-30", "America/Chicago")` starts Sunday 2026-10-25 and holds seven days whose keys run 25…31; the week of 2026-11-01 (a Sunday) starts that day;
  - `shiftKey("day", "2028-02-28", 1)` = `"2028-02-29"`; `shiftKey("week", "2026-12-30", 1)` = `"2027-01-06"`;
  - `parseAgendaParams({ view: "month", day: "2026-13-01" }, "2026-10-30")` = `{ view: "day", day: "2026-10-30" }`;
  - `agendaTime`: on 2026-11-01 Chicago, 06:30Z and 07:30Z read `"1:30 AM CDT"` and `"1:30 AM CST"` in English with `withZone` (mutation: drop `timeZoneName` → equal strings, FAILS), and the two Spanish strings differ;
  - `freeHours` for Monday 09:00–12:00 with a job 10:00–10:30 and `now` 08:00 = the instants of 09:00 and 11:00 (mutation: test the job against the hour with `<=` → 11:00 drops or 10:00 stays, FAILS); hours before `now` are left out;
  - `wallToInstant("2026-03-08", "02:30", "America/Chicago")` is `null`; `"03:00"` is `08:00Z`.
  Code (the helpers each test names):

```ts
import { addDays, startOfDay, isDateKey } from "@/lib/business-status/status";
import { partsInZone, zonedTimeToUtc, normalizeOpenHours, type OpenHours } from "./slots";

export type AgendaView = "day" | "week";
export type AgendaDay = { key: string; start: Date; end: Date; zoneShift: boolean };
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const weekdayOf = (key: string) => {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

export function parseAgendaParams(raw: { view?: string; day?: string }, today: string): { view: AgendaView; day: string } {
  return { view: raw.view === "week" ? "week" : "day", day: raw.day && isDateKey(raw.day) ? raw.day : today };
}
/** D10: the slot engine's own weekday order, Sunday first (slots.ts:8). */
export function weekStartKey(key: string): string { return addDays(key, -weekdayOf(key)); }
export function shiftKey(view: AgendaView, key: string, dir: -1 | 1): string { return addDays(key, dir * (view === "week" ? 7 : 1)); }

const offsetMinutes = (t: Date, tz: string) => {
  const p = partsInZone(t, tz);
  return (Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mi) - Math.floor(t.getTime() / 60_000) * 60_000) / 60_000;
};
export function dayHasZoneShift(start: Date, end: Date, tz: string): boolean {
  return offsetMinutes(start, tz) !== offsetMinutes(new Date(end.getTime() - 60_000), tz);
}
function day(key: string, tz: string): AgendaDay {
  const start = startOfDay(key, tz);
  const end = startOfDay(addDays(key, 1), tz);
  return { key, start, end, zoneShift: dayHasZoneShift(start, end, tz) };
}
export function agendaWindow(view: AgendaView, key: string, tz: string): { from: Date; to: Date; days: AgendaDay[] } {
  const first = view === "week" ? weekStartKey(key) : key;
  const days = Array.from({ length: view === "week" ? 7 : 1 }, (_, i) => day(addDays(first, i), tz));
  return { from: days[0]!.start, to: days[days.length - 1]!.end, days };
}
export function agendaTime(instant: Date, tz: string, locale: "en" | "es", withZone: boolean): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", {
    timeZone: tz, hour: "numeric", minute: "2-digit", ...(withZone ? { timeZoneName: "short" as const } : {}),
  }).format(instant);
}
export function wallToInstant(key: string, hhmm: string, tz: string): Date | null {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const [hh, mi] = hhmm.split(":").map(Number) as [number, number];
  return zonedTimeToUtc(y, m, d, hh, mi, tz);
}
export function freeHours(i: { dayKey: string; timezone: string; openHours: OpenHours;
  live: readonly { startsAt: Date; endsAt: Date }[]; now: Date }): Date[] {
  const out: Date[] = [];
  const hours = normalizeOpenHours(i.openHours)[WEEKDAYS[weekdayOf(i.dayKey)]] ?? [];
  for (const [f, t] of hours) {
    const [fh, fm] = f.split(":").map(Number) as [number, number];
    const [th] = t.split(":").map(Number) as [number];
    for (let h = fm === 0 ? fh : fh + 1; h + 1 <= th; h++) {
      const at = wallToInstant(i.dayKey, `${String(h).padStart(2, "0")}:00`, i.timezone);
      if (!at || at.getTime() < i.now.getTime()) continue;
      const end = at.getTime() + 3_600_000;
      if (i.live.some((r) => r.startsAt.getTime() < end && at.getTime() < r.endsAt.getTime())) continue;
      out.push(at);
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime());
}
```

- [ ] **Step 4: `agenda-lanes.ts`, red then green.** Tests: two overlapping live rows → one `side` item `[[a],[b]]` and both in `overlapping`; back-to-back → two `single` items, `overlapping` empty (mutation: `<=` in the overlap test → FAILS); a cancelled row overlapping a live one is neither in an item nor in `overlapping` (mutation: include `live: false` rows → FAILS); a chain a–b, b–c with a and c apart → `side` `[[a, c], [b]]`; three mutually overlapping → `stack` `[a, b, c]`; items keep start order. Code:

```ts
/** F-046 (spec 5.2, R1): live rows whose ranges overlap ([) bounds, as bookings_no_overlap) form one item:
 *  two lanes side by side when two lanes hold them, else a stack. Cancelled rows never join a lane. */
export type LaneInput = { id: string; startsAt: Date; endsAt: Date; live: boolean };
export type LaneItem = { kind: "single"; id: string } | { kind: "side"; lanes: [string[], string[]] } | { kind: "stack"; ids: string[] };

export function agendaLanes(rows: readonly LaneInput[]): { items: LaneItem[]; overlapping: ReadonlySet<string> } {
  const live = rows.filter((r) => r.live).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  const clusters: LaneInput[][] = [];
  let reach = -Infinity;                       // the latest end in the CURRENT cluster
  for (const r of live) {
    const current = clusters[clusters.length - 1];
    if (current && r.startsAt.getTime() < reach) {
      current.push(r);
      reach = Math.max(reach, r.endsAt.getTime());
    } else {
      clusters.push([r]);
      reach = r.endsAt.getTime();
    }
  }
  const overlapping = new Set<string>();
  const items: LaneItem[] = clusters.map((c) => {
    if (c.length === 1) return { kind: "single", id: c[0]!.id };
    c.forEach((r) => overlapping.add(r.id));
    const lanes: [LaneInput[], LaneInput[]] = [[], []];
    for (const r of c) {
      const lane = lanes.find((l) => l.length === 0 || l[l.length - 1]!.endsAt.getTime() <= r.startsAt.getTime());
      if (!lane) return { kind: "stack", ids: c.map((x) => x.id) };
      lane.push(r);
    }
    return { kind: "side", lanes: [lanes[0].map((x) => x.id), lanes[1].map((x) => x.id)] };
  });
  return { items, overlapping };
}
```

The chain test (a–b, b–c, a and c apart) pins `reach` as the running maximum of the current cluster: a mutation that resets it to each row's own end splits the chain into two items and FAILS.

- [ ] **Step 5: Run green:** `pnpm --filter web exec vitest run src/lib/booking` and `pnpm --filter web typecheck`. Paste both. Every existing `src/lib/booking` test passes UNCHANGED (the `slotConfigFrom` export changes no behaviour).
- [ ] **Step 6: Mutations** as named in Steps 1–4, each red by name.
- [ ] **Step 7: Commit** every listed path: `feat(booking): the pure rules behind the agenda: what a staff job breaks, the day and week windows across clock changes, and side-by-side lanes`.

---

### Task 4: The query layer

**Tier:** high · **Owner:** bis-booking · **Wave:** 2 (after T1's commit)

**Files:**
- Modify: `packages/db/src/booking.ts` (`:10-46` types, `:248-262`, `:306-328`, `:928-1033`, `:797-861`, `:1585-1627`; new functions after `bookingWasMoved`, `:1083`)
- Modify: `packages/db/src/index.ts` (one new line after `:127`; `:116`'s `listBookedRanges` export is unchanged)
- Create: `packages/db/src/booking-agenda.test.ts` (fake client, runs locally)
- Modify: `packages/db/src/test/booking.test.ts` (one new `describe` at the end; CI only)

**Interfaces:** Produces the `DB/booking.ts` block in "Shared facts". Consumes T1's columns and `undo_staff_move`.

- [ ] **Step 1: Failing fake-client tests.** Create `packages/db/src/booking-agenda.test.ts` with a SCRIPTED fake (each `from()`/`rpc()` consumes the next answer from a queue and records its calls; the shape of `booking-cancel-notices.test.ts:14-33`, plus `rpc`, `gt`, `lt`, `in`, `is`, `not`, `or`, `neq`, `single`, `head` options recorded). Cases, each with its mutation:
  - `createStaffJob` inserts exactly `{ …, author_kind: "person", author_id: "user_1", booker_timezone: null, place_id, meeting_type, meeting_url, hold_until, notice_wanted, closure_kept_at }` with `closure_kept_at` an ISO string only when `closureKept` (mutation: always stamp → FAILS), and writes NO `events` row (mutation: emit → a second `from("events")` FAILS); a 23P01 answer throws `SlotTakenError`.
  - `createBooking`'s insert is exactly the object it writes today, no new key (mutation: give `insertBookingRow`'s `extra` a default of `{ place_id: null }` → the pin FAILS).
  - `moveBooking` without `job` copies the old row's `place_id` and `meeting_type` into the new insert (mutation: omit them → FAILS); with `job` it writes `note`, `place_id`, `meeting_type`, `hold_until` and `closure_kept_at` from `job`, `notice_wanted` NULL (mutation: ignore `job.note` → FAILS), and records NO `events` insert (mutation: emit as today → the two `from("events")` calls FAIL the pin); without `job` its two events are written exactly as today.
  - `listBookedRanges` selects `id, starts_at, ends_at`.
  - `listDueReminders` adds `.or("hold_until.is.null,hold_settled_at.not.is.null")` to BOTH reads: a staff job is reminded only once its hold is SETTLED (claimed), never on the clock alone, so a reminder can neither precede the confirmation nor go for a job undone after `hold_until` but before the claim (plan review item 4; mutation: `hold_until.lte.<now>` → FAILS; only the day-before read → the late-read assertion FAILS); `getDueReminderById` adds nothing (plan correction 3; the test asserts its call list is unchanged).
  - `listAgendaBookings` filters `lt("starts_at", to)` AND `gt("ends_at", from)` (a job from 23:00 to 01:00 is on both days; mutation: filter on `starts_at` only → FAILS), orders by `starts_at` then `id`, limits `AGENDA_ROW_CAP + 1`, answers `truncated` when the read returned 401 rows, and reads `rescheduled_from_id in (<the cancelled ids>)` once, marking those `replaced` (mutation: mark every cancelled row → FAILS; no cancelled rows → no second read).
  - `claimJobHold` updates only `hold_settled_at` with `.eq(account).eq(id).eq("status","booked").lte("hold_until", now).is("hold_settled_at", null)` (mutations: drop the `is` → FAILS; drop the status term → FAILS; and the update object has no `updated_at`, plan correction 13); `listDueJobHolds` carries the same `eq("status","booked")` (mutation: drop it → FAILS). `setJobNotice` updates only `notice_wanted` with `.not("hold_until","is",null).is("hold_settled_at", null)`.
  - `deleteUnsettledStaffJob`: the delete carries `.eq("author_kind","person").eq("author_id", actor).eq("status","booked").is("hold_settled_at", null).not("hold_until","is",null)` and `.is("rescheduled_from_id", null)` (mutations: drop `is("hold_settled_at")` → FAILS; drop the `rescheduled_from_id` term → the moved-row case deletes, FAILS); zero rows then a read answering `{ status: "booked", rescheduled_from_id: "old" }` → `"is_move"`, `{ hold_settled_at: "x" }` → `"settled"`, `{ author_id: "other" }` → `"not_yours"`, `{ status: "cancelled" }` with `bookingWasMoved` true → `"moved"`, no row → `"gone"`.
  - `undoStaffMove` calls `rpc("undo_staff_move", { p_account_id, p_new_id, p_old_id, p_cancelled_at, p_now })` and passes each of the five answers through; an unknown answer or an error THROWS.
  - `editJobDetails` writes the four columns, `.eq("status","booked")`, and for each `from` value `.eq(col, v)` or `.is(col, null)` when null (mutation: `.eq(col, null)` → FAILS); never `updated_at`.
  - `countAwaitingOutcomeBefore` THROWS on `{ count: null, error: null }` (the head-count-null lesson; mutation: `count ?? 0` → FAILS).
  - `jobWasTold` walks the chain: a root with `author_kind: "customer"` → true; a person root with `notice_sent_at` on the middle row → true; a person chain with none → false.
  - `listFeedBookings` selects `meeting_type` and returns it per row.

Run: `pnpm --filter @bis/db exec vitest run src/booking-agenda.test.ts`. Expected red: `createStaffJob is not a function` (or the import's resolve error). Paste it.

- [ ] **Step 2: The code.** In `booking.ts`:

```ts
export type BookingMeetingType = "in_person" | "phone" | "video";
export type NoticeWanted = "confirmation" | "moved";
// BookingRow (:26-46) gains, last:  meeting_type?: BookingMeetingType | null;

type BookingExtraColumns = Partial<{
  place_id: string | null; meeting_type: BookingMeetingType | null; hold_until: string | null;
  notice_wanted: NoticeWanted | null; closure_kept_at: string | null;
}>;
// insertBookingRow (:306) gains a sixth parameter `extra: BookingExtraColumns = {}`, spread LAST into the insert.
// listBookedRanges (:248-262): select "id, starts_at, ends_at"; return type { id: string; starts_at: string; ends_at: string }[].

export type StaffJobInput = {
  calendarId: string; contactId: string; startsAt: Date; endsAt: Date;
  note: string | null; placeId: string | null; meetingType: BookingMeetingType; meetingUrl: string | null;
  holdUntil: Date; noticeWanted: NoticeWanted | null; closureKept: boolean;
};

/**
 * F-046 (spec 6.1): a job a person on the dashboard books. Person-made (R11: it may overlap, 0107), in the
 * account's zone (no booker zone), held for the Undo window. NO event: `booking.created` is written when
 * the hold settles (D8), so an undone add leaves no "New booking" behind. THROWS on any write error.
 */
export async function createStaffJob(
  db: SupabaseClient, accountId: string, input: StaffJobInput, actorId: string,
): Promise<{ id: string; cancelToken: string }> {
  const cancelToken = newCancelToken();
  const { data, error } = await insertBookingRow(db, accountId, {
    calendarId: input.calendarId, contactId: input.contactId, startsAt: input.startsAt, endsAt: input.endsAt,
    note: input.note ?? undefined, meetingUrl: input.meetingUrl ?? undefined,
  }, cancelToken, bookingAuthor("user", actorId), {
    place_id: input.placeId, meeting_type: input.meetingType, hold_until: input.holdUntil.toISOString(),
    notice_wanted: input.noticeWanted, closure_kept_at: input.closureKept ? new Date().toISOString() : null,
  });
  if (error || !data) {
    if (isOverlapError(error)) throw new SlotTakenError();
    throw new Error(`createStaffJob failed: ${error?.message}`);
  }
  return { id: data.id, cancelToken };
}
```

`moveBooking` (`:928`): the read selects `id, calendar_id, contact_id, note, booker_timezone, status, place_id, meeting_type`; `to` gains `job?: StaffMoveJob`; the insert's `input.note` is `to.job ? to.job.note ?? undefined : old.note ?? undefined`; `insertBookingRow` gets `extra = to.job ? { place_id: to.job.placeId, meeting_type: to.job.meetingType, hold_until: to.job.holdUntil.toISOString(), closure_kept_at: to.job.closureKept ? new Date().toISOString() : null } : { place_id: old.place_id ?? null, meeting_type: old.meeting_type ?? null }`. Step 4 of the function (the two `emitLogged` calls, `:1027-1031`) runs only when `!to.job`: a staff move's events are written by the settle of its new row (T6), so a move undone inside its hold leaves no `booking.created` for a deleted row (plan review minor; D8 extended to moves). Nothing else in the function changes; its doc comment gains one paragraph saying what is carried and why a staff move writes no event here.

`listDueReminders`: both reads gain `.or("hold_until.is.null,hold_settled_at.not.is.null")` after `.is("reminder_sent_at", null)`, with one comment: "F-046: a staff job is reminded only once its Undo hold is SETTLED, so the confirmation (the settle sends it) always comes first, and a job undone before its claim never gets a reminder. Gated on the claim, never on hold_until: the clock passing proves nothing was settled (plan review item 4). By-id twins deliberately do not filter (plan correction 3)."

The rest (new, after `bookingWasMoved`):

```ts
export const AGENDA_ROW_CAP = 400;
const AGENDA_COLS = "id, contact_id, starts_at, ends_at, status, note, author_kind, author_id, meeting_type, meeting_url, place_id, "
  + "confirm_reply, hold_until, hold_settled_at, notice_wanted, notice_sent_at, rescheduled_from_id, created_at, "
  + "contact:contacts!bookings_contact_id_fkey(first_name, last_name, phone, email), place:places!bookings_place_fkey(label, address)";
export type AgendaBookingRow = {
  id: string; contact_id: string; starts_at: string; ends_at: string; status: BookingStatus; note: string | null;
  author_kind: AuthorKind; author_id: string | null; meeting_type: BookingMeetingType | null; meeting_url: string | null;
  place_id: string | null; confirm_reply: "yes" | "no" | null; hold_until: string | null; hold_settled_at: string | null;
  notice_wanted: NoticeWanted | null; notice_sent_at: string | null; rescheduled_from_id: string | null; created_at: string;
  contact: { first_name: string | null; last_name: string | null; phone: string | null; email: string | null } | null;
  place: { label: string | null; address: string | null } | null;
  replaced: boolean;
};

/** F-046 (spec 5.2): every booking overlapping [fromIso, toIso), any status, soonest first, at most
 *  AGENDA_ROW_CAP. On the CALLER's client: RLS (0068) decides what a Technician sees, so no "busy" block of
 *  anyone else's job can exist to draw (R5). A cancelled row a move replaced is marked `replaced`, ONE extra
 *  read for the window. THROWS on a read error. */
export async function listAgendaBookings(db: SupabaseClient, accountId: string, fromIso: string, toIso: string):
  Promise<{ rows: AgendaBookingRow[]; truncated: boolean }> {
  const { data, error } = await db.from("bookings").select(AGENDA_COLS)
    .eq("account_id", accountId).lt("starts_at", toIso).gt("ends_at", fromIso)
    .order("starts_at", { ascending: true }).order("id", { ascending: true }).limit(AGENDA_ROW_CAP + 1);
  if (error) throw new Error(`listAgendaBookings failed: ${error.message}`);
  const raw = ((data ?? []) as unknown as Omit<AgendaBookingRow, "replaced">[]);
  const rows = raw.slice(0, AGENDA_ROW_CAP);
  const cancelled = rows.filter((r) => r.status === "cancelled").map((r) => r.id);
  const replaced = new Set<string>();
  if (cancelled.length > 0) {
    const { data: links, error: lErr } = await db.from("bookings").select("rescheduled_from_id")
      .eq("account_id", accountId).in("rescheduled_from_id", cancelled);
    if (lErr) throw new Error(`listAgendaBookings (replaced) failed: ${lErr.message}`);
    for (const l of (links ?? []) as { rescheduled_from_id: string }[]) replaced.add(l.rescheduled_from_id);
  }
  return { rows: rows.map((r) => ({ ...r, replaced: replaced.has(r.id) })), truncated: raw.length > AGENDA_ROW_CAP };
}

/** One job for the drawer and `?job=` (spec 5.5), on the caller's client. null = not this caller's to see. */
export async function readAgendaJob(db: SupabaseClient, accountId: string, bookingId: string): Promise<AgendaBookingRow | null> {
  const { data, error } = await db.from("bookings").select(AGENDA_COLS)
    .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
  if (error) throw new Error(`readAgendaJob failed: ${error.message}`);
  if (!data) return null;
  return { ...(data as unknown as Omit<AgendaBookingRow, "replaced">), replaced: false };
}

/** Spec 5.4 (Move's tick): the customer knows this appointment when its chain's first row is theirs or
 *  Sofia's, or any row of the chain had its email sent. Walks rescheduleChain's way, account-scoped. */
export async function jobWasTold(db: SupabaseClient, accountId: string, bookingId: string): Promise<boolean> {
  let id: string | null = bookingId;
  for (let hop = 0; id && hop <= RESCHEDULE_CHAIN_MAX; hop++) {
    const { data, error } = await db.from("bookings").select("author_kind, notice_sent_at, rescheduled_from_id")
      .eq("account_id", accountId).eq("id", id).maybeSingle();
    if (error) throw new Error(`jobWasTold failed: ${error.message}`);
    const r = data as { author_kind: AuthorKind; notice_sent_at: string | null; rescheduled_from_id: string | null } | null;
    if (!r) return false;
    if (r.notice_sent_at) return true;
    if (!r.rescheduled_from_id) return r.author_kind === "customer" || r.author_kind === "ai";
    id = r.rescheduled_from_id;
  }
  return false;
}

/** Spec 5.2 "Earlier days": started-before-`beforeIso`, still booked (work-queue.ts:153-170's predicate).
 *  An exact head count; THROWS on a count-less answer (head-count-null). */
export async function countAwaitingOutcomeBefore(db: SupabaseClient, accountId: string, beforeIso: string): Promise<number> {
  const { count, error } = await db.from("bookings").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("status", "booked").lt("ends_at", beforeIso);
  if (error) throw new Error(`countAwaitingOutcomeBefore failed: ${error.message}`);
  if (count === null) throw new Error("countAwaitingOutcomeBefore failed: no count returned");
  return count;
}

const CLAIM_COLS = "id, status, notice_wanted, starts_at, ends_at, contact_id, calendar_id, place_id, meeting_url, "
  + "cancel_token, rescheduled_from_id, author_id, hold_until, created_at";
export type JobHoldClaim = {
  id: string; status: BookingStatus; notice_wanted: NoticeWanted | null; starts_at: string; ends_at: string;
  contact_id: string; calendar_id: string; place_id: string | null; meeting_url: string | null; cancel_token: string;
  rescheduled_from_id: string | null; author_id: string | null; hold_until: string; created_at: string;
};

/** F-046 (spec 6.5): the hold's one claim. Conditional on the hold being due and unclaimed, so the after()
 *  job, the pass and the Undo's delete serialise on the row and exactly one wins. Never touches updated_at
 *  (a cancel's version). Only a BOOKED row is claimed (plan review item 2): a hold that falls due while its row
 *  is cancelled by a move stays unclaimed, so an Undo of that move brings back a row whose confirmation can still
 *  go. null = someone else won, the row is not booked, or nothing is due. THROWS on a write error. */
export async function claimJobHold(db: SupabaseClient, accountId: string, bookingId: string, nowIso: string): Promise<JobHoldClaim | null> {
  const { data, error } = await db.from("bookings").update({ hold_settled_at: nowIso })
    .eq("account_id", accountId).eq("id", bookingId).eq("status", "booked")
    .lte("hold_until", nowIso).is("hold_settled_at", null)
    .select(CLAIM_COLS);
  if (error) throw new Error(`claimJobHold failed: ${error.message}`);
  return ((data ?? []) as unknown as JobHoldClaim[])[0] ?? null;
}

/** Send-then-stamp (stampReminderSent's reasoning): only after the gate said SENT. */
export async function stampJobNoticeSent(db: SupabaseClient, accountId: string, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings").update({ notice_sent_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", bookingId);
  if (error) throw new Error(`stampJobNoticeSent failed: ${error.message}`);
}

/** F-046 (plan review item 2): a staff move's email, decided AFTER moveBooking's cancel of the old row (the action
 *  re-reads that row: see T10). Only while the new row's hold is unsettled, so the settle reads one settled value.
 *  true = written. THROWS on a write error. */
export async function setJobNotice(db: SupabaseClient, accountId: string, bookingId: string, notice: NoticeWanted | null): Promise<boolean> {
  const { data, error } = await db.from("bookings").update({ notice_wanted: notice })
    .eq("account_id", accountId).eq("id", bookingId).not("hold_until", "is", null).is("hold_settled_at", null).select("id");
  if (error) throw new Error(`setJobNotice failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** The jobHolds pass's read, every account (service role): holds due by `beforeIso`, oldest first. */
export async function listDueJobHolds(db: SupabaseClient, beforeIso: string, limit: number):
  Promise<{ accountId: string; bookingId: string; holdUntil: string }[]> {
  const { data, error } = await db.from("bookings").select("id, account_id, hold_until")
    .eq("status", "booked").lte("hold_until", beforeIso).is("hold_settled_at", null)
    .order("hold_until", { ascending: true }).limit(limit);
  if (error) throw new Error(`listDueJobHolds failed: ${error.message}`);
  return ((data ?? []) as { id: string; account_id: string; hold_until: string }[])
    .map((r) => ({ accountId: r.account_id, bookingId: r.id, holdUntil: r.hold_until }));
}

export type UndoAddOutcome = "deleted" | "settled" | "moved" | "is_move" | "not_yours" | "gone";
/** F-046 (D5): the Undo of an add DELETES the row while its hold is unsettled (0091's reason: a cancelled
  *  row would still count as a booking made and sit on the timeline). Only the person who added it, and only an ADD:
 *  a held row a move made (rescheduled_from_id set) is never deleted here, or its old row would stay cancelled and
 *  the customer would have no appointment at all (plan review item 3); it answers "is_move". */
export async function deleteUnsettledStaffJob(db: SupabaseClient, accountId: string, bookingId: string, actorId: string): Promise<UndoAddOutcome> {
  const { data, error } = await db.from("bookings").delete()
    .eq("account_id", accountId).eq("id", bookingId).eq("author_kind", "person").eq("author_id", actorId)
    .eq("status", "booked").is("rescheduled_from_id", null).is("hold_settled_at", null).not("hold_until", "is", null).select("id");
  if (error) throw new Error(`deleteUnsettledStaffJob failed: ${error.message}`);
  if ((data?.length ?? 0) > 0) return "deleted";
  const { data: row, error: rErr } = await db.from("bookings").select("status, author_id, hold_settled_at, rescheduled_from_id")
    .eq("account_id", accountId).eq("id", bookingId).maybeSingle();
  if (rErr) throw new Error(`deleteUnsettledStaffJob re-read failed: ${rErr.message}`);
  const r = row as { status: BookingStatus; author_id: string | null; hold_settled_at: string | null; rescheduled_from_id: string | null } | null;
  if (!r) return "gone";
  if (r.status === "booked" && r.rescheduled_from_id) return "is_move";
  if (r.status === "cancelled" && await bookingWasMoved(db, accountId, bookingId)) return "moved";
  if (r.hold_settled_at) return "settled";
  if (r.author_id !== actorId) return "not_yours";
  return "gone";
}

export type UndoStaffMoveOutcome = "undone" | "gone" | "too_late" | "time_taken" | "changed";
const UNDO_MOVE_ANSWERS: readonly UndoStaffMoveOutcome[] = ["undone", "gone", "too_late", "time_taken", "changed"];
export async function undoStaffMove(db: SupabaseClient, accountId: string, newId: string, oldId: string,
  cancelledAt: string, now: Date): Promise<UndoStaffMoveOutcome> {
  const { data, error } = await db.rpc("undo_staff_move", {
    p_account_id: accountId, p_new_id: newId, p_old_id: oldId, p_cancelled_at: cancelledAt, p_now: now.toISOString(),
  });
  if (error) throw new Error(`undoStaffMove failed: ${error.message}`);
  if (!UNDO_MOVE_ANSWERS.includes(data as UndoStaffMoveOutcome)) throw new Error(`undoStaffMove: unexpected answer ${String(data)}`);
  return data as UndoStaffMoveOutcome;
}

export type JobDetails = { note: string | null; placeId: string | null; meetingType: BookingMeetingType | null; meetingUrl: string | null };
/** F-046 (D6): a Move that keeps the time is an in-place edit, compare-and-set on what the form opened with.
 *  Never updated_at (a cancel's version). true = written. */
export async function editJobDetails(db: SupabaseClient, accountId: string, bookingId: string, from: JobDetails, to: JobDetails): Promise<boolean> {
  let q = db.from("bookings").update({ note: to.note, place_id: to.placeId, meeting_type: to.meetingType, meeting_url: to.meetingUrl })
    .eq("account_id", accountId).eq("id", bookingId).eq("status", "booked");
  const pairs: [string, string | null][] = [["note", from.note], ["place_id", from.placeId], ["meeting_type", from.meetingType], ["meeting_url", from.meetingUrl]];
  for (const [col, v] of pairs) q = v === null ? q.is(col, null) : q.eq(col, v);
  const { data, error } = await q.select("id");
  if (error) throw new Error(`editJobDetails failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}
```

`listFeedBookings` (`:817-861`): `cols` gains `meeting_type`, `FeedRaw` and `FeedBookingRow` gain `meeting_type: BookingMeetingType | null`, and the mapped row carries it.

`index.ts`, one line after `:127`: `export { createStaffJob, listAgendaBookings, readAgendaJob, jobWasTold, countAwaitingOutcomeBefore, claimJobHold, stampJobNoticeSent, setJobNotice, listDueJobHolds, deleteUnsettledStaffJob, undoStaffMove, editJobDetails, AGENDA_ROW_CAP, type BookingMeetingType, type NoticeWanted, type StaffJobInput, type StaffMoveJob, type AgendaBookingRow, type JobHoldClaim, type UndoAddOutcome, type UndoStaffMoveOutcome, type JobDetails } from "./booking";`

- [ ] **Step 3: Run green:** `pnpm --filter @bis/db exec vitest run src/booking-agenda.test.ts src/booking-cancel-notices.test.ts` and `pnpm --filter @bis/db typecheck` and `pnpm --filter web typecheck` (web consumes `listBookedRanges`; the new `id` field breaks nothing). Paste all three.
- [ ] **Step 4: The live round trips (CI proves them).** Add `describe("F-046 part 1: staff jobs, the agenda read and the hold (0107)")` at the end of `test/booking.test.ts`, with `withTestAccount` cases: (a) `createStaffJob` then read the row back: `author_kind "person"`, `place_id`, `meeting_type`, `hold_until`, `notice_wanted`; (b) a customer `createBooking(…, "public", "system")` over that staff job throws `SlotTakenError` (ASSUMPTION 17a, proven here); (c) `listAgendaBookings` over 2027-04-01 returns a job from 23:00 to 01:00 on both the 1st's and the 2nd's windows, with `place.label`/`address` embedded (ASSUMPTION 17b, proven here); (d) `listDueReminders` at a `now` 23.5 h before the job's start does NOT list it while its hold is unsettled, EVEN with `hold_until` already past (the clock is not the gate), and lists it once `claimJobHold` has settled it (plan review item 4); (e) `moveBooking` of a staff job without `job` carries `place_id` and `meeting_type`; (f) the claim and the Undo: `claimJobHold` then `deleteUnsettledStaffJob` → `"settled"`, the row still there; reversed order → `"deleted"`, the claim answers `null`; (g) `undoStaffMove` round trip answers `"undone"`; (h) the move-and-undo race (plan review item 2): a staff add with a confirmation, moved with `job` (its new row's `notice_wanted` NULL, no `events` row for either id), then `claimJobHold` on the OLD row after its `hold_until` answers `null` (cancelled), `undoStaffMove` answers `"undone"`, and `claimJobHold` on the old row now returns it with `notice_wanted: "confirmation"`; (i) `deleteUnsettledStaffJob` on the held NEW row of a move answers `"is_move"` and both rows are unchanged (plan review item 3). Seed the place with `addPlace` (DB/places.ts) on the same contact. Record "CI only" in the report.
- [ ] **Step 5: Mutations** as named in Step 1, each red by name (the fake file; the live file's are proven on CI).
- [ ] **Step 6: Commit** every listed path: `feat(db): staff jobs, the agenda's window read, the Undo hold's claim, a move that keeps its address and meeting type, and reminders that wait out the hold`.

---

### Task 5: `removePlace` archives a place a job names

**Tier:** low · **Owner:** bis-crm · **Wave:** 2

**Files:** Modify `packages/db/src/places.ts:303-339`; create `packages/db/src/places-bookings.test.ts` (fake client); modify `packages/db/src/test/places.test.ts` and `test/head-count-null.test.ts` (CI only).

**Interfaces:** `removePlace`'s signature and answers are unchanged.

- [ ] **Step 1: Failing fake test.** A scripted fake: `getPlace` answers an active place, the equipment count `0`, the bookings count `1` → the function writes `archived_at` (the `writeArchived` update) and never calls `delete` (mutation: skip the bookings count → the delete call is recorded, FAILS); bookings count `null` → THROWS `removePlace booking count failed: no count returned` (mutation: `?? 0`). And: a delete that answers `{ code: "23503", message: "…bookings_place_fkey…" }` (a booking landed between the count and the delete) falls through to the archive (mutation: rethrow → FAILS).
- [ ] **Step 2: Run red:** `pnpm --filter @bis/db exec vitest run src/places-bookings.test.ts`. Paste the line.
- [ ] **Step 3: Implement.** After the unit count (`:310-313`), count `bookings` with `.eq("account_id", accountId).eq("place_id", placeId)` (head, exact), THROW on error and on `null`; delete only when both counts are 0; a delete error whose `code === "23503"` and message names `bookings_place_fkey` is not thrown: the function goes on to archive, as the 0-row case already does. The doc comment gains: "F-046: a place a job names (bookings.place_id, 0107, NO ACTION) is archived too: a job's address cannot vanish."
- [ ] **Step 4: Live cases (CI).** `places.test.ts`: a place a staff job names is archived, not deleted, and the job still names it. `head-count-null.test.ts`: the booking count's null throws (the `noCount(sdb, "bookings")` shape at `:220-231`).
- [ ] **Step 5: Run green** (the fake file) and commit: `fix(contacts): removing a place a job names archives it, so the job keeps its address`.

---

### Task 6: The settle and its two emails

**Tier:** high · **Owner:** bis-booking, bis-comms co-review (its review is this task's opus review: the two kinds, their class and their single send site are bis-comms's rules; the edits to its three files are exactly the lines below) · **Wave:** 3

**Files:**
- Create: `CAL/job-hold.ts`, `CAL/job-hold.test.ts`
- Modify: `apps/web/src/lib/email/templates/booking.ts` (`CONFIRMATION_COPY` `:13-33`, `BookingConfirmationInput` `:112-140`, `bookingConfirmationEmail`, `RESCHEDULED_COPY`, `BookingRescheduledInput` `:233-260`, `bookingRescheduledEmail`), `apps/web/src/lib/email/templates/booking.test.ts`
- Modify: `apps/web/src/lib/consent/classes.ts:61-66,81-89,133`; `classes.test.ts:102,106-108,111-113,211`; `scans.test.ts:266-269,792`
- Modify: `ACCT/in-account-service-reads.test.ts` (one `ALLOWED` line after `:76`)

**Interfaces:** Produces the `CAL/job-hold.ts` block in "Shared facts". Consumes T4's `claimJobHold`, `stampJobNoticeSent`; `getContact`, `getCalendarForAccount`, `getPlace`, `loadAccountBrandInfo`, `recipientLanguage`, `emit`, `isAccountOutboundSuppressed`, `readEmailSuppression` (`@bis/db`); `emailLedgerAddress` (`@bis/db/email-address`); `sendEmailOrThrow` (`WEB/lib/consent/email-gate.ts:406`); `emailBrand`, `normalizeReplyTo`, `formatWhen`, `bookingCancelUrl`, `bookingMoveUrl`, `calendarFileUrl`, `stampWithRetry`; `UNDO_WINDOW_MS`, `NOTICE_GRACE_MS` (`CAL/undo-window.ts`).

- [ ] **Step 1: The kinds, red first.** `classes.test.ts`: `EMAIL_TABLE` gains `"staff.booking_confirmation": ["transactional", "any", "unsubscribe"]` and `"staff.booking_moved": [same]` after `:102`; `:106`'s name says "thirty-one … and F-046's staff confirmation and moved email", `:108` `toHaveLength(31)`; `:113` `toEqual(["booking.undo_notice", "staff.booking_confirmation", "staff.booking_moved"])` and `:111`'s name "holds exactly three kinds: the undo notice and F-046's two"; `EMAIL_STOPS_WHILE_PAUSED` gains both as `false` after `:211`. `scans.test.ts`: `SITES` gains both after `:792`, each `[\`${DASH}/calendar/job-hold.ts\`]`; `:266`'s name "thirty-one email kinds, 42 distinct" and `:269` `toHaveLength(42)`. Run `pnpm --filter web exec vitest run src/lib/consent/classes.test.ts src/lib/consent/scans.test.ts`. Expected red: `expected [ …29 items ] to have a length of 31`, and the SITES rows naming `job-hold.ts` fail (`expected [] to deeply equal [ …/calendar/job-hold.ts ]`). Paste both.
- [ ] **Step 2: Register them.** `classes.ts` after `:133`:

```ts
  // F-046 part 1 (spec 6.6, owner decision 3): a person put a job on the calendar (or moved one) and chose
  // to tell the customer, sent once the Undo window has closed (CAL/job-hold.ts). News about their own
  // appointment in our words: an unsubscribe does not stop it, any hour, the unsubscribe footer.
  "staff.booking_confirmation": { class: "transactional", hours: "any", footer: "unsubscribe" },
  "staff.booking_moved": { class: "transactional", hours: "any", footer: "unsubscribe" },
```

`:61-66`'s count becomes "thirty-one kinds now, with … and F-046's staff confirmation and moved email"; `:81-89` "holds exactly one kind: the customer's notice when staff undo one of Sofía's booking changes" becomes "holds three kinds: the customer's notice when staff undo one of Sofía's booking changes (item 8c), and the confirmation and the moved email for a job staff put on the calendar (F-046)", the rest of that paragraph unchanged.

- [ ] **Step 3: The address line, red then green.** `templates/booking.test.ts`: `bookingConfirmationEmail({ …, where: "Home · 1 Main St" })` renders a "Where" row (English) and "Dónde" (Spanish) in both `html` (escaped) and `text`; absent or `""` renders no row (mutation: always render → FAILS); the same two cases for `bookingRescheduledEmail`. Implement: `CONFIRMATION_COPY.en.where = "Where"`, `.es.where = "Dónde"`, `RESCHEDULED_COPY` reuses them as it reuses `move` (`:225-226`); both inputs gain `where?: string`; the row uses `ROW_LABEL_STYLE`/`ROW_VALUE_STYLE` (`:40-42`) under the time. The templates' `tú` voice is unchanged (spec §13).
- [ ] **Step 4: The settle, red first.** `CAL/job-hold.test.ts`, every dependency injected (`deps.db` a scripted fake for `claimJobHold`/`stampJobNoticeSent`/reads via `vi.mock("@bis/db")` partial, `deps.send` a spy, `deps.now` fixed). Cases:
  - a lost claim (`claimJobHold` → `null`) sends nothing and emits nothing: `"lost"` (mutation: skip the claim → FAILS);
  - a row moved or cancelled inside its hold is never claimed (`claimJobHold` answers `null`, T4): `"lost"`, no send, no event;
  - an add (`rescheduled_from_id` null) emits `booking.created` with actor `author_id`, type `"user"`, payload `{ bookingId, calendarId, contactId }`; a staff move's new row emits that AND `booking.status_changed` `{ bookingId: rescheduled_from_id, status: "cancelled" }`, the two events `moveBooking` no longer writes for a staff move (T4; mutation: skip the second → FAILS);
  - `notice_wanted` null: `"quiet"` after the event; a started job (`starts_at <= now`) or a hold more than `JOB_NOTICE_MAX_AGE_MS` old: `"too_late"`, no send (mutation: drop the start check → FAILS);
  - `confirmation`: one send with `kind: "staff.booking_confirmation"`, `contactId`, the contact's language (`recipientLanguage(contact.language, account.language)`; a Spanish contact gets Spanish subject AND body AND `language: "es"`), `to` the contact's email, `where` built from the place (`label · address`, either alone when one is null), the cancel and calendar-file links, and the move link ONLY when the calendar is enabled (mutation: always add it → FAILS); then `stampJobNoticeSent` once: `"sent"`;
  - `moved`: `kind: "staff.booking_moved"` with `bookingRescheduledEmail`;
  - a send that throws: `"failed"`, logged by booking id (never the address), `stampJobNoticeSent` never called, and the send is NOT retried (one call; mutation: retry once → FAILS);
  - `settleJobHold` never throws: a read that throws answers `"failed"`;
  - `settleAfterWindow` sleeps exactly `UNDO_WINDOW_MS + NOTICE_GRACE_MS` before the claim (the `sleep` spy), or `waitMs` when given;
  - `jobNoticeAvailability`: no email → `"no_email"`; suppressed account → `"suppressed_account"`; a blocked address → `"address_blocked"`; else `"available"` (the contact read on `readDb`, the two facts on `writer`).
  Run `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/job-hold.test.ts"`. Paste the red line.
- [ ] **Step 5: The settle.** `CAL/job-hold.ts`:

```ts
import {
  claimJobHold, stampJobNoticeSent, getContact, getCalendarForAccount, getPlace, loadAccountBrandInfo, recipientLanguage,
  emit, isAccountOutboundSuppressed, readEmailSuppression, serviceDb, type SupabaseClient,
} from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";
import { sendEmailOrThrow, type EmailRequest } from "@/lib/consent/email-gate";
import type { SendEmailResult } from "@/lib/email/types";
import { emailBrand } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import {
  bookingConfirmationEmail, bookingConfirmationSubject, bookingRescheduledEmail, bookingRescheduledSubject,
} from "@/lib/email/templates/booking";
import { formatWhen } from "@/lib/booking/time";
import { bookingCancelUrl, bookingMoveUrl } from "@/lib/booking/links";
import { calendarFileUrl } from "@/lib/booking/calendar-file";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { UNDO_WINDOW_MS, NOTICE_GRACE_MS } from "./undo-window";
import type { NoticeAvailability } from "./cancel-flow";

/**
 * F-046 part 1 (spec 6.5): a staff add or move is held for its Undo window; whoever settles the hold first
 * (this module's after() job, or the jobHolds cron pass) CLAIMS it (claimJobHold, booked rows only), then writes the hold's
 * events (D8: booking.created, and for a move the old row's cancel) and sends the email the person ticked, through the email gate, in the customer's
 * own language. Claim-then-send: a failed send is logged and the drawer says so; it is NEVER retried,
 * because a retry after an unclear send emails twice (cancel-notice.ts's rule). Never throws.
 */
export const JOB_NOTICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export type JobHoldOutcome = "lost" | "quiet" | "sent" | "failed" | "too_late";
export type SettleDeps = {
  db: SupabaseClient; origin: string | null; now?: () => Date;
  /** The cron tick's own gate (`ctx.email.send`); absent = sendEmailOrThrow on `db`. The same gate. */
  send?: (req: EmailRequest) => Promise<SendEmailResult>;
};

export async function settleJobHold(accountId: string, bookingId: string, deps: SettleDeps): Promise<JobHoldOutcome> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const tag = `job hold for booking ${bookingId} (account ${accountId})`;
  try {
    const claim = await claimJobHold(db, accountId, bookingId, now.toISOString());
    if (!claim) return "lost";
    if (claim.status !== "booked") return "quiet";      // defensive: claimJobHold claims booked rows only
    // D8, extended to moves (plan review): the hold's events are written here, once it is settled, never at
    // insert, so an add or a move undone inside its hold leaves none. A move's are moveBooking's own two.
    const actor = claim.author_id ?? "system";
    try {
      await emit(db, accountId, "booking.created", actor,
        { bookingId: claim.id, calendarId: claim.calendar_id, contactId: claim.contact_id }, "user");
      if (claim.rescheduled_from_id !== null) {
        await emit(db, accountId, "booking.status_changed", actor,
          { bookingId: claim.rescheduled_from_id, status: "cancelled" }, "user");
      }
    } catch (e) {
      console.error(`${tag}: the hold's events not recorded: ${String(e)}`);
    }
    if (!claim.notice_wanted) return "quiet";
    if (!(Date.parse(claim.starts_at) > now.getTime())
      || !(Date.parse(claim.hold_until) > now.getTime() - JOB_NOTICE_MAX_AGE_MS)) return "too_late";

    const [contact, calendar, place, info] = await Promise.all([
      getContact(db, accountId, claim.contact_id),
      getCalendarForAccount(db, accountId),
      claim.place_id ? getPlace(db, accountId, claim.place_id) : Promise.resolve(null),
      loadAccountBrandInfo(db, [accountId], "settleJobHold").then((m) => m.get(accountId)!),
    ]);
    const to = (contact?.email as string | null | undefined)?.trim();
    if (!contact || !to || !calendar) {
      console.error(`${tag}: nothing to send to (no contact email or no calendar)`);
      return "failed";
    }
    const locale = recipientLanguage(contact.language as string | null, info.accountLanguage);
    const brand = emailBrand(info.branding);
    const when = formatWhen(new Date(claim.starts_at), info.accountTimezone, locale);
    const where = [place?.label, place?.address].filter((x): x is string => !!x && x.trim() !== "").join(" · ");
    const links = {
      cancelUrl: bookingCancelUrl(deps.origin, calendar.public_id, claim.cancel_token, locale),
      calendarUrl: calendarFileUrl(deps.origin, calendar.public_id, claim.cancel_token, locale),
      // The move page answers "offline" on a disabled calendar (move/[token]/data.ts:92): no link then.
      moveUrl: calendar.enabled ? bookingMoveUrl(deps.origin, calendar.public_id, claim.cancel_token, locale) : "",
    };
    const common = { brand, locale, whenBookerZone: when, whenCompanyZone: when, meetingUrl: claim.meeting_url ?? undefined, where, ...links };
    const confirmation = claim.notice_wanted === "confirmation";
    const { html, text } = confirmation ? bookingConfirmationEmail(common) : bookingRescheduledEmail(common);
    const send = deps.send ?? ((req: EmailRequest) => sendEmailOrThrow(req, { db }));
    try {
      await send({
        accountId, kind: confirmation ? "staff.booking_confirmation" : "staff.booking_moved",
        contactId: claim.contact_id, language: locale, origin: deps.origin, to,
        fromName: brand.name, fromAddress: info.fromEmail ?? undefined, replyTo: normalizeReplyTo(info.replyToEmail),
        subject: confirmation ? bookingConfirmationSubject(locale) : bookingRescheduledSubject(locale), body: text, html,
      });
    } catch (e) {
      console.error(`${tag}: the ${claim.notice_wanted} email was not sent: ${String(e)}`);
      return "failed";
    }
    const stamped = await stampWithRetry(() => stampJobNoticeSent(db, accountId, bookingId));
    if (!stamped.stamped) console.error(`${tag}: sent, but notice_sent_at was not stamped: ${String(stamped.lastError)}`);
    return "sent";
  } catch (e) {
    console.error(`${tag} failed: ${String(e)}`);
    return "failed";
  }
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The after() job: waits out the Undo window and its grace, then settles. Never throws. */
export async function settleAfterWindow(accountId: string, bookingId: string, origin: string | null,
  deps: { db?: SupabaseClient; sleep?: (ms: number) => Promise<void>; waitMs?: number } = {}): Promise<JobHoldOutcome> {
  // waitMs: the Undo of a move re-arms its restored row with the time left on that row's own hold (T10).
  await (deps.sleep ?? realSleep)(deps.waitMs ?? UNDO_WINDOW_MS + NOTICE_GRACE_MS);
  return settleJobHold(accountId, bookingId, { db: deps.db ?? serviceDb(), origin });
}

/** Spec 5.4: whether a confirmation can go to this customer at all (cancelNoticeAvailability's checks, by
 *  contact). THROWS on a read error; callers fail open to "none". */
export async function jobNoticeAvailability(readDb: SupabaseClient, writer: SupabaseClient,
  accountId: string, contactId: string): Promise<NoticeAvailability> {
  const contact = await getContact(readDb, accountId, contactId);
  const to = emailLedgerAddress((contact?.email as string | null | undefined) ?? null);
  if (!to) return "no_email";
  if (await isAccountOutboundSuppressed(writer, accountId)) return "suppressed_account";
  if (await readEmailSuppression(writer, accountId, to)) return "address_blocked";
  return "available";
}
```

`StampOutcome` is `{ stamped: true; attempts } | { stamped: false; attempts; lastError }` (`stamp-retry.ts:54-56`); `stampWithRetry` never throws. The `ALLOWED` line in `in-account-service-reads.test.ts`, after `:76`: `"app/(dashboard)/dashboard/accounts/[accountId]/calendar/job-hold.ts": "proven-target",` with the comment "F-046: the after() settle of a hold the agenda action proved (callerCanSee on the job's own add)".

- [ ] **Step 6: Run green:** `pnpm --filter web exec vitest run src/lib/consent src/lib/email/templates "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts" src/lib/automations/imports.test.ts` and `pnpm --filter web typecheck`. Paste both.
- [ ] **Step 7: Mutations** as named in Steps 1, 3 and 4, plus: classify `staff.booking_moved` as `customer_initiated` → scan 4 (`scans.test.ts:807-827`) FAILS naming `job-hold.ts`. Each red by name.
- [ ] **Step 8: Commit** every listed path: `feat(booking): a job's confirmation or new-time email, with its address, goes once the Undo window closes, as two transactional kinds sent from one place`.

---

### Task 7: Links and the per-row meeting type

**Tier:** low · **Owner:** bis-booking · **Wave:** 3

**Files:** `apps/web/src/lib/booking/feed-content.ts` (`:10-45`), `feed-content.test.ts`; `ACCT/dashboard/affected-appointment-row.tsx:72` (+ its test); `ACCT/setup/steps/step-shared.tsx:74`, `step-shared.test.ts` (new: nothing pins `STEP_PATH` today); `CAL/calendar-settings.tsx` (one `id`), `calendar-settings.test.ts`; `apps/web/src/lib/palette/registry.ts:76-77`, `registry.test.ts`; `apps/web/src/app/b/[publicId]/move/[token]/actions.ts:133`, `actions.test.ts`, `data.ts:28-30`; `apps/web/src/app/b/[publicId]/cancel/[token]/data.ts:5-7`.

**Interfaces:** Consumes `FeedBookingRow.meeting_type` (T4).

- [ ] **Step 1: Failing tests.** `feed-content.test.ts`: a row with `meeting_type: "video"` on a phone calendar reads the video kind (mutation: use `o.meetingType` only → FAILS); a row with `null` reads the calendar's; each event's description link is `…/calendar?job=<row.id>` (mutation: the old page link → FAILS). The move action test: a booking row with `meeting_type: "video"` on an `in_person` calendar mints a room (mutation: read `ctx.calendar.meeting_type` → FAILS); `null` on a video calendar still mints. The dashboard row links `…/calendar?job=<id>`. The setup step's hours link is `/calendar?from=setup#booking-settings`. The palette's `/calendar` terms include the five new ones.
- [ ] **Step 2: Run red** (each file by path) and paste the lines.
- [ ] **Step 3: Implement.** `FeedContentRow` gains `meeting_type: MeetingKind | null`; `feedEvents` reads `s[\`kind_${row.meeting_type ?? o.meetingType}\`]` per row and builds the description per row with `?job=${row.id}`. `cancel/[token]/data.ts`'s `BOOKING_COLS` gains `, meeting_type` (0107 is load-bearing for this read; it is on every project before the merge deploy, checklist steps 5 and 7); `MoveContext.row`'s `Pick` gains `"meeting_type"`; the move action's test reads `(ctx.row.meeting_type ?? ctx.calendar.meeting_type) === "video"`. `affected-appointment-row.tsx:72`: `` `/dashboard/accounts/${accountId}/calendar?job=${a.id}` ``. `CalendarSettings`' outer card gets `id="booking-settings"`; `step-shared.tsx:74` becomes `"/calendar?from=setup#booking-settings"`. Palette `:76-77`: append `"agenda", "schedule", "add job", "trabajo", "agregar trabajo"` with a comment line "F-046 part 1: the agenda card".
- [ ] **Step 4: Run green:** `pnpm --filter web exec vitest run src/lib/booking "src/app/b/[publicId]" src/lib/palette "src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard" "src/app/(dashboard)/dashboard/accounts/[accountId]/setup" "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/calendar-settings.test.ts"`, `pnpm --filter web typecheck` and `pnpm --filter web lint`. Paste all three.
- [ ] **Step 5: Commit** every listed path: `feat(booking): a job's own meeting type reaches the owner's feed and the customer's move, and every link to a booking opens its drawer`.

---

### Task 8: Sofía's reschedule mints a room by the booking's own type

**Tier:** low · **Owner:** bis-voice · **Wave:** 3

**Files:** `packages/db/src/voice.ts:1286-1294` (`getBookingById`); `apps/web/src/lib/voice/tools/registry.ts:744`; `apps/web/src/lib/voice/tools/registry.test.ts`.

- [ ] **Step 1: Failing test.** `registry.test.ts`'s reschedule: `getBookingById` answers a row with `meeting_type: "video"` on an `in_person` calendar → `createMeetingRoom` is called (mutation: keep `ctx.calendar.meeting_type` → FAILS); `meeting_type: "phone"` on a video calendar → no room. Run red by path; paste.
- [ ] **Step 2: Implement.** `getBookingById` selects and returns `meeting_type` (type `string | null`); `registry.ts:744` reads `(old.meeting_type ?? ctx.calendar.meeting_type) === "video"`. `moveBooking` (T4) already carries the type to the new row.
- [ ] **Step 3: Run green:** `pnpm --filter web exec vitest run src/lib/voice/tools/registry.test.ts`, `pnpm --filter web typecheck`. Paste both. Commit: `fix(voice): Sofía's reschedule opens a video room when the booking itself is a video job`.

---

### Task 9: The `jobHolds` pass and the text-side hold filter

**Tier:** high · **Owner:** bis-automations · **Wave:** 4 (after T6)

**Files:**
- Create: `apps/web/src/lib/automations/passes/job-holds.ts`, `job-holds.test.ts`
- Modify: `registry.ts:4,73` (import, `PASSES`), the registry comment (`:44-48` gains one sentence); `fanout.ts:27,69`; `fanout.test.ts:35-38,46,191-192,283-285`; `cron-coupling.test.ts:16-29,336-375,393-404,431-438`; `sentinel.test.ts:57,240,295,305`; `apps/web/src/app/api/cron/reminders/route.test.ts:212,328` and the seven bodies (`:451,474,497,513,606,623,667`)
- Modify: `packages/db/src/automations.ts:652-657,802-807`; create `packages/db/src/automations-hold.test.ts` (fake client)

**Interfaces:** Consumes `listDueJobHolds` (T4), `settleJobHold` (T6). Produces `jobHoldsPass` (key `"jobHolds"`), `JOB_HOLD_BUDGET_MS = 10_000`, `JOB_HOLD_SWEEP_SLACK_MS = 120_000`, `JOB_HOLD_SWEEP_BATCH = 25`.

- [ ] **Step 1: The text-side filter, red then green.** `automations-hold.test.ts` (scripted fake): `listDueSmsReminders` and `listDueAppointmentConfirms` each add `.or("hold_until.is.null,hold_settled_at.not.is.null")` to their bookings read: gated on the hold's claim, never on the clock (plan review item 4; mutations: drop one → FAILS naming it; `hold_until.lte.<now>` → FAILS); their by-id twins add nothing (plan correction 3). Implement in `automations.ts` after each `.is(…_sent_at / confirm_asked_at, null)`, with T4's comment. Run by path.
- [ ] **Step 2: The pass, red first.** `job-holds.test.ts` (mock `@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/job-hold` and `@bis/db`): it reads `listDueJobHolds(ctx.db, now − 2 min, 25)` (mutation: no slack → FAILS); settles each row with `{ db: ctx.db, origin: ctx.origin, send }` where `send` calls `ctx.email.send` (mutation: omit `send` → the after() path's gate is used, FAILS on the spy); counts `sent`, `failed`, `quiet`, `tooLate`, `lost`; stops starting rows once `JOB_HOLD_BUDGET_MS` of wall clock is spent and counts the rest in `deferred` (a fake clock); never dereferences a `@bis/db` export at module scope.
- [ ] **Step 3: The pass.**

```ts
import { listDueJobHolds } from "@bis/db";
import type { Pass } from "../context";
import { settleJobHold, type JobHoldOutcome } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/job-hold";

/**
 * F-046 part 1 (spec 6.5, D3): the backstop for a staff job's Undo hold. The agenda action settles its own
 * hold from after() once the window closes; when that process dies in the wait, the row's hold_until is
 * still unclaimed and this pass settles it on the next tick, through the same settleJobHold and this
 * tick's own email gate. cancelNotices' twin: rows due JOB_HOLD_SWEEP_SLACK_MS ago or more (a live after()
 * settles first; when both run, the claim lets exactly one through), oldest first, JOB_HOLD_SWEEP_BATCH a
 * tick, JOB_HOLD_BUDGET_MS of wall clock. Too old or already started: settled with no email (the settle's
 * own rule). Not an F-196 job: those drain only under CRON_FANOUT, which is off (plan correction 4).
 * Runs right after cancelNotices and before reminders, so in one in-process tick a confirmation precedes
 * a reminder. Every @bis/db export is dereferenced inside run().
 */
export const JOB_HOLD_SWEEP_SLACK_MS = 2 * 60 * 1000;
export const JOB_HOLD_SWEEP_BATCH = 25;
export const JOB_HOLD_BUDGET_MS = 10_000;
const COUNTER: Record<JobHoldOutcome, "sent" | "failed" | "quiet" | "tooLate" | "lost"> = {
  sent: "sent", failed: "failed", quiet: "quiet", too_late: "tooLate", lost: "lost",
};

export const jobHoldsPass: Pass = {
  key: "jobHolds",
  async run(ctx) {
    const c = { sent: 0, failed: 0, quiet: 0, tooLate: 0, lost: 0, deferred: 0 };
    const due = await listDueJobHolds(ctx.db, new Date(ctx.now.getTime() - JOB_HOLD_SWEEP_SLACK_MS).toISOString(), JOB_HOLD_SWEEP_BATCH);
    const startedAt = Date.now();
    for (const [i, row] of due.entries()) {
      if (Date.now() - startedAt >= JOB_HOLD_BUDGET_MS) {
        c.deferred = due.length - i;
        console.error(`job holds: budget spent, ${c.deferred} row(s) left for the next tick`);
        break;
      }
      const outcome = await settleJobHold(row.accountId, row.bookingId, {
        db: ctx.db, origin: ctx.origin, now: () => ctx.now, send: (req) => ctx.email.send(req),
      });
      c[COUNTER[outcome]]++;
    }
    return c;
  },
};
```

- [ ] **Step 4: Registry and plan.** `PASSES` gains `jobHoldsPass` directly after `cancelNoticesPass`; the registry comment's cancel-notice paragraph gains "The job-hold backstop (F-046) follows it for the same reason: a customer waiting to hear about a job staff just booked." `fanout.ts`: `LEGACY_TICK_CEILING_S = 310` with a comment "300 until F-046's job-hold pass took the seventh budget (cron-coupling.test.ts's rule: raise this or take it from a neighbour); the route's live maxDuration is 800"; `HEAD` gains `n("jobHolds", ["billingPause"])` after `cancelNotices`.
- [ ] **Step 5: The pins.** `cron-coupling.test.ts`: import `JOB_HOLD_BUDGET_MS`; the sum test (`:336-375`) gains `+ JOB_HOLD_BUDGET_MS`, its name "seven", its comment the 310 arithmetic (60+60+60+45+15+10+10 = 260, + 50 headroom = 310), `MIN_HEADROOM_MS` stays 50 000; `BUDGETS_MS` gains it, test 1's name "seven" and `toHaveLength(7)`; `SENDS_PER_ROW` gains `JOB_HOLD_BUDGET_MS: 1` (one send per row). `fanout.test.ts`: `NOT_AFTER_RELEASE` gains `"jobHolds"`; `toHaveLength(22)`; case 7's list gains `"jobHolds"`; case 9d "19 nodes never start" and `toHaveLength(19)`. `sentinel.test.ts`: `dbMocks.listDueJobHolds = vi.fn()`, `mockResolvedValue([])` beside `:240`, the results pin gains `jobHolds: { sent: 0, failed: 0, quiet: 0, tooLate: 0, lost: 0, deferred: 0 }`, the `PASSES` keys list gains `"jobHolds"` after `"cancelNotices"`. Cron `route.test.ts`: `listDueJobHolds: async () => [],` after `:212`; `const EMPTY_JOB_HOLDS = { sent: 0, failed: 0, quiet: 0, tooLate: 0, lost: 0, deferred: 0 };` after `:328`; each of the seven bodies gains `jobHolds: EMPTY_JOB_HOLDS,` after `cancelNotices: EMPTY_CANCEL_NOTICES,`.
- [ ] **Step 6: Run green:** `pnpm --filter web exec vitest run src/lib/automations src/app/api/cron` and `pnpm --filter @bis/db exec vitest run src/automations-hold.test.ts` and `pnpm --filter web typecheck`. Paste all three. `cron-coupling.test.ts` must show the longest path still 760 (case 3, unchanged: `jobHolds` hangs off `billingPause`).
- [ ] **Step 7: Mutations:** `JOB_HOLD_BUDGET_MS = 95_000` → coupling test 1 FAILS; `LEGACY_TICK_CEILING_S = 300` → the sum test FAILS; remove `jobHoldsPass` from `PASSES` → `fanout.test.ts` case 1 FAILS; Step 1's and Step 2's as named. Each red by name.
- [ ] **Step 8: Commit** every listed path: `feat(automations): a cron backstop settles a staff job's Undo hold whose own process died, and text reminders and confirmation asks wait out the hold`. The report names the window change for the ledger (rule: a window or schedule change names bis-automations), though no `vercel.json` schedule moves.

---

### Task 10: The agenda's server actions

**Tier:** medium · **Owner:** bis-booking · **Wave:** 4 (after T6)

**Files:**
- Create: `CAL/agenda-actions.ts`, `CAL/agenda-actions.test.ts`, `CAL/prove-booking.ts`
- Modify: `CAL/actions.ts` (delete `proveBooking`, `:179-198`, and import it from `./prove-booking`)
- Modify: `ACCT/in-account-service-reads.test.ts` (one `ALLOWED` line, `proven-target`); `ACCT/access-log-routes.test.ts` (two `each(…)` lines after `:88`)

**Interfaces:** Produces the server actions in "Shared facts". Consumes T3's rules, T4's writes, T6's `settleAfterWindow` and `jobNoticeAvailability`, `getMeetingProvider()` (`WEB/lib/meetings/provider.ts:18`), `readSlotClosures` and `slotConfigFrom` (`availability.ts`), `listContactsOnNumber` (`DB/voice.ts:777`), `normalisePhone` (`@bis/db/phone`), `createContact` (`matchBy: "email_only"`, `DB/contacts.ts:42-48`), `getContact`, `listContactPlaces`, `listBookedRanges`, `getCalendarForAccount`.

- [ ] **Step 1: Move `proveBooking`.** `CAL/prove-booking.ts` holds the function exactly as `actions.ts:189-198` has it (doc comment included), exported, no directive. `actions.ts` imports it. Run `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.test.ts"`: green UNCHANGED (paste).
- [ ] **Step 2: Failing tests.** `agenda-actions.test.ts`, in `actions.test.ts`'s mock pattern (read it: `@/lib/auth`, `@/lib/db`, `@/lib/auth/visible`, `@bis/db`, `next/headers`, `next/server`'s `after` captured, `@/lib/meetings/provider`). Cases, each with its mutation:
  - every action refuses a Technician (`seesWholeAccount` false) BEFORE any db call (mutation: drop the role check → a recorded call FAILS);
  - `addJobAction` validates: `date` a date key, `start` `HH:MM` on a five-minute step, `minutes` an integer 5–720 on a five-minute step, `what` at most 200 characters after trimming, `meetingType` one of three, `placeId` null or a uuid; anything else → `calendar.job.saveFailed` and no write (mutation: accept 721 → FAILS);
  - a wall time in the spring-forward gap → `calendar.job.noSuchTime`; a past start → `calendar.job.past`; a start more than 366 days out → `calendar.job.saveFailed`;
  - an existing customer is proven with `getContact` on the request client, and refused when missing, archived, merged (`merged_into`) or holding a shared number (mutation: skip the archived check → FAILS);
  - a quick-add phone already on a contact (`listContactsOnNumber` with the E.164, holding rows left out) answers `{ needs: { phoneOwner } }` and writes NOTHING (mutation: write first → FAILS); `addAsNew: true` calls `createContact` with `matchBy: "email_only"` and the phone AS TYPED (mutation: pass the E.164 → FAILS; the F-009 scan also catches it); the name splits on the first space into first and last;
  - the place must be one `listContactPlaces` returns for that customer, active (mutation: skip → a place of another customer saves, FAILS);
  - a `newPlace` (plan review minor): its fields are parsed with `parsePlaceFields` BEFORE any write (an invalid one → `calendar.job.saveFailed`, nothing written, not even a quick-add contact); then the customer is made when new (`createContact`), then the place is saved on that customer with `addPlace` on the request client (`{ contactId, groupId: null }`, the places card's own writer), then the job names it; the recorded call order is contact, place, booking (mutation: place first → no contact id yet, FAILS); a place write that fails leaves the contact and answers `calendar.job.saveFailed` (the quick-add contact stays, spec 6.1);
  - a warning not in `seen` answers `{ needs: { warnings } }` and writes nothing; a second press sending exactly those keys writes; a NEW overlap appearing between the presses (a third id) writes nothing again (mutation: compare kinds, not keys → FAILS);
  - video with no provider adds the `no_video` warning; with a provider, a room is minted with `{ bookingId: calendar.public_id, endsAt }` before the write; a provider that throws costs no job;
  - `createStaffJob` receives `holdUntil = now + 15 000 ms`, `noticeWanted: "confirmation"` only when `notify` AND availability is `"available"`, and `closureKept: true` only when the `closed` warning was among the accepted ones (mutation: always true → FAILS);
  - `after()` is scheduled with `settleAfterWindow(accountId, bookingId, origin)` (mutation: no after() → FAILS); the answer carries `notice` (`"scheduled"`, `"none"`, `"no_email"`, `"address_blocked"`), `startsAt` and the customer's first name;
  - `undoAddJobAction`: `deleted` → ok and emits `booking.add_undone`; `settled` → `calendar.job.undoTooLate` with `fallback: true`; `is_move` → `calendar.bookings.statusUpdateFailed` with `fallback: true` and NOTHING deleted (plan review item 3; mutation: map it to ok → FAILS); `moved` → `calendar.job.undoMovedSince`; others → `calendar.bookings.statusUpdateFailed`; `proveBooking` first;
  - `moveJobAction`: same validation and warnings with `excludeId` the job itself; same time and length → `editJobDetails(from = opened, to = draft)`, no new row, no email, answers `mode: "edited"` with both sets; a new time → `moveBooking(…, { job: { note, placeId, meetingType, holdUntil, closureKept } })` (the new row held, its `notice_wanted` NULL), THEN a re-read of the OLD row (`readAgendaJob` on the service client, after `moveBooking` has cancelled it, so no settler can claim it any more: claims take booked rows only), THEN `setJobNotice(newId, n)` with `n` = `"confirmation"` when the old row's `notice_wanted` was `"confirmation"` and its `hold_settled_at` is NULL (the customer never heard of the old time, whatever the tick says), else `"moved"` when `notify`, else null (plan review item 2). Both races are tested: old hold unclaimed at the re-read → `"confirmation"` (mutation: decide before the move from the drawer's data → the claimed-during-move case sends two confirmations, FAILS); old hold claimed before the cancel → `"moved"` (mutation: always `"confirmation"` while the old row wanted one → FAILS). A `setJobNotice` that answers false or throws is logged and the answer's `notice` is `"none"`; `after()` settles the NEW id; `BookingNotMovableError` → `calendar.job.changed`;
  - `undoMoveJobAction` proves BOTH ids (mutation: prove only the new → FAILS), calls `undoStaffMove` with the move's `cancelledAt`, maps `undone` (it writes NO event: the move wrote none, T4, and the restored row's own settle writes `booking.created` if it never settled; and it RE-ARMS the restored row: `after(() => settleAfterWindow(accountId, oldId, origin, { waitMs: max(0, hold_until − now) + NOTICE_GRACE_MS }))`, because the old row's own `after()` may already have run and lost its claim while the row was cancelled; exactly one settler wins, and an old row that settled before the move is never claimed again; plan review item 2; mutation: no re-arm → FAILS), `time_taken` → `moveUndoTaken`, `too_late` → `undoTooLate`, the rest → `changed`;
  - `undoEditJobAction` writes `editJobDetails(from = to, to = from)`;
  - no action names `serviceDb` except for the bookings writes and the two suppression reads (the file is `proven-target`), and none passes `duringPause`.
- [ ] **Step 3: Run red.** Paste.
- [ ] **Step 4: Implement** `agenda-actions.ts` ("use server"): `requireAccountAccess(accountId)` then `seesWholeAccount(access)` (Technicians refused with `calendar.job.saveFailed`); reads on `dbForRequest()` (the calendar, the customer, the places, the live ranges via `listBookedRanges(db, calendar.id, startIso, endIso)` (status booked, overlapping the job) mapped to `LiveRange`, the closures via `readSlotClosures(db, …)`); writes on `serviceDb()` after the proofs; `now` read once per action; the toast's words are the client's (T11), the action answers data. `revalidatePath(\`/dashboard/accounts/${accountId}/calendar\`)` after every write. The ALLOWED line: `"app/(dashboard)/dashboard/accounts/[accountId]/calendar/agenda-actions.ts": "proven-target",`. The route walk: `...each(\`${A}/calendar/agenda-actions.ts\`, ["addJobAction", "undoAddJobAction", "moveJobAction", "undoMoveJobAction", "undoEditJobAction"], W),` and `...each(\`${A}/calendar/agenda-actions.ts\`, ["jobNoticeOptionAction"], "the Add job sheet's notice check, from the calendar (a list, owner ruling 2)"),`.
- [ ] **Step 5: Run green:** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/access-log-routes.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/technician-guards.test.ts" src/lib/billing/read-only.test.ts src/lib/consent/scans.test.ts`, `pnpm --filter web typecheck`, `pnpm --filter web lint`. The last three test files pass UNCHANGED. Paste all.
- [ ] **Step 6: Mutations** as named in Step 2, each red by name.
- [ ] **Step 7: Commit** every listed path: `feat(booking): staff add, move and undo jobs, with each broken rule shown once and the customer told only after Undo closes`.

---

### Task 11: The Add job sheet and the job drawer

**Tier:** medium · **Owner:** bis-booking, bis-frontend review · **Wave:** 5

**Files:** create `CAL/job-sheet.tsx`, `CAL/job-sheet-handlers.ts`, `job-sheet-handlers.test.ts`, `CAL/job-drawer.tsx`, `CAL/job-drawer-handlers.ts`, `job-drawer-handlers.test.ts`, `apps/web/src/app/(dashboard)/dashboard/styleguide/job-demo.tsx`, `job-demo.test.ts`.

**Interfaces:**

```ts
// job-sheet.tsx ("use client")
export type JobSheetProps = {
  accountId: string; timezone: string; locale: "en" | "es"; mode: "add" | "move";
  open: boolean; onOpenChange: (open: boolean) => void;
  prefill: { date: string; start: string; minutes: number; customer?: { id: string; name: string; first: string };
    what?: string; placeId?: string | null; meetingType: BookingMeetingType; notify?: boolean };
  job?: { id: string; opened: JobOpened };                   // move only
  calendarMeetingType: BookingMeetingType; defaultMinutes: number;
};
export function JobSheet(props: JobSheetProps): JSX.Element;
// job-drawer.tsx ("use client")
export type JobDrawerView = {
  id: string; customer: { id: string; name: string; first: string; phone: string | null };
  when: string; lengthMinutes: number; what: string | null; address: string | null;
  meetingType: BookingMeetingType; meetingUrl: string | null; status: BookingStatus; statusWord: string;
  madeBy: string; madeAt: string; confirmReply: "yes" | "no" | null;
  email: { state: "sent" | "pending" | "failed" | "none"; kind: NoticeWanted | null; at: string | null };
  holdOpen: boolean; isMove: boolean; started: boolean; canWrite: boolean; canCloseOut: boolean;   // isMove: rescheduled_from_id set
  opened: JobOpened; told: boolean; recordHref: string;
};
export function JobDrawer(props: { accountId: string; view: JobDrawerView; closeHref: string; timezone: string;
  locale: "en" | "es"; calendarMeetingType: BookingMeetingType; defaultMinutes: number }): JSX.Element;
```

- [ ] **Step 1: Failing handler tests.** `job-sheet-handlers.ts` exports pure handlers (the `archive-controls.test.ts` style: React-free functions the component calls): `submitJob({ action, draft, seen, toast, schedule })`:
  - `needs.warnings` → returns `{ show: warnings, button: "saveAnyway" | "moveAnyway" }` and sends `seen` = those keys on the next press (mutation: send no `seen` → FAILS); a `needs.phoneOwner` → the two-button offer;
  - `ok` → a success toast whose words follow `notice` (`calendar.job.added` only for `"scheduled"`, `addedQuiet` otherwise, plus `noEmail`/`emailBlocked` lines), formatted with `formatWhen(startsAt, timezone, locale)`, carrying `calendar.job.undo` for EXACTLY `UNDO_WINDOW_MS` and dismissed then even if hovered (`cancel-booking.ts`'s rule; mutation: `duration: 4000` → FAILS);
  - Undo calls `undoAddJobAction(accountId, bookingId)` and toasts `calendar.job.undone` or the error key;
  - move: `mode: "edited"` → `calendar.job.edited` with Undo calling `undoEditJobAction(accountId, id, from, to)`; `mode: "moved"` → `moved`/`movedQuiet` with Undo calling `undoMoveJobAction(accountId, newId, oldId, cancelledAt)` (mutation: pass the old id first → FAILS).
  `job-drawer-handlers.ts`: `cancelFromDrawer({ view, … })` calls `undoAddJobAction` only when `view.holdOpen && !view.isMove` (an ADD inside its hold, D7), and falls back to the ordinary cancel flow (`cancel-flow.ts`/`cancel-booking.ts`'s `runCancelButton`) when that answers `fallback: true` (mutation: always the ordinary cancel → a job the customer never heard of gets a notice dialog, FAILS); a held MOVE (`isMove`) goes straight to the ordinary cancel flow, never to the add's Undo and never to an Undo of the move: Cancel means "this job is off", and undoing the move would bring back the old time the person did not ask for; the cancelled new row is never claimed (claims take booked rows only), so its "moved" email never goes (plan review item 3; mutation: route a held move to `undoAddJobAction` → the server answers `is_move` and the test asserts the ordinary flow ran, FAILS if it did not); otherwise the ordinary flow directly; `closeOut(status)` calls `setBookingStatusAction`. Both files under `"use client"`-free modules so they test without React.
- [ ] **Step 2: Run red.** Paste.
- [ ] **Step 3: Implement the two components.**
  - The sheet: `components/ui/sheet.tsx`'s `Sheet`/`SheetContent side="right"` (full height on a phone); fields in spec 5.4's order; the customer search fetches `GET /api/accounts/${accountId}/search?q=` (debounced 250 ms, minimum two characters as the route itself requires) and lists its `contacts` hits; "New customer" swaps in Name and Phone; once a customer is chosen, the address list fetches `/api/accounts/${accountId}/contacts/${id}/places` and shows active places ("No address" first, "New address" last, which opens `place-dialog.tsx`'s fields and sends them as the draft's `newPlace`; the ACTION saves the place after the customer exists, so New address works for a new customer too (plan review minor: a place needs its contact first; the sheet never calls `addPlaceAction` itself). For a new customer the list shows "No address" and "New address" only); the notify tick asks `jobNoticeOptionAction` and is disabled with `noEmail`/`emailBlocked` as its description; the warnings block (`calendar.job.checkFirst` and one line per warning, `warn.overlaps`/`overlapsOne` through `plural()` with `agendaTime(at, timezone, locale, false)`) sits above the button; ONE primary, the save button; Cancel is ghost. Five-minute `step={300}` on the time input; length a select of 5-minute steps 5–720 defaulting to `defaultMinutes`.
  - The drawer: a right sheet with flat sections (a mono label and row rules, never a glass card inside the glass sheet, the record drawer's rule); customer name and `tel:` phone; when, length, what, address, meeting type word and Join link (`calendar.bookings.join`), status as `DotPill` dot and word (`calendar.bookings.status.*`), who made it and when, the confirm reply (`CONFIRM_REPLY_TREATMENTS`, `CAL/confirm-reply.ts`), and the email state (`emailSent`/`emailPending`/`emailFailed` or the moved trio by `email.kind`). Actions, ALL `variant="ghost"`: Move (swaps the body for `<JobSheet mode="move">` inline), Cancel (when `canWrite` and booked), Mark completed and No-show (when `canCloseOut` and `started`), Open record (a link). NO `variant="default"` button anywhere in the drawer (owner decision 2). Esc and the close button `router.replace(closeHref, { scroll: false })` and return focus to `#booking-<id>`.
  - Every string through `t(m, key, locale)` / `plural`; tokens only; `:focus-visible` rings; `prefers-reduced-motion` respected by the sheet primitive.
- [ ] **Step 4: Styleguide.** `job-demo.tsx` renders the sheet (open, with a warnings block and the phone-owner offer) and the drawer (a booked staff job with a pending email; a cancelled customer booking), in both themes, from fixed specimens, no actions wired (handlers are no-ops). `job-demo.test.ts` (`renderToStaticMarkup`): the drawer markup has no `data-variant="default"` (or the button component's primary marker — read `components/ui/button.tsx`), the sheet has exactly one; every visible string is a catalogue value.
- [ ] **Step 5: Run green:** the two handler tests, `job-demo.test.ts`, `src/lib/i18n` (the ratchet: no raw JSX copy in the new files), `pnpm --filter web typecheck`, `pnpm --filter web lint`. Paste all.
- [ ] **Step 6: Mutations** as named, each red by name.
- [ ] **Step 7: Commit** every listed path: `feat(booking): the Add job sheet, which Move reuses, and a job drawer with no primary button`.

---

### Task 12: The Agenda card, page order, states, the record log, styleguide

**Tier:** medium · **Owner:** bis-booking, bis-frontend review · **Wave:** 5 (typecheck and commit AFTER T11 has committed)

**Files:** create `CAL/agenda-card.tsx`, `CAL/agenda-view.ts`, `agenda-view.test.ts`, `CAL/agenda-day.tsx`, `CAL/agenda-week.tsx`, `CAL/agenda-skeleton.tsx`; modify `CAL/page.tsx`, `CAL/page.test.ts`; delete `CAL/bookings-list.tsx`, `CAL/bookings-list.test.ts`; modify `ACCT/access-log-routes.test.ts` (`:35-54`); create `…/styleguide/agenda-demo.tsx`, `agenda-demo.test.ts`; modify `…/styleguide/page.tsx` (register `AgendaDemo` and T11's `JobDemo`).

**Interfaces:** Consumes everything above. `agenda-view.ts` (pure):

```ts
export type AgendaRowView = {
  id: string; href: string; startLabel: string; endLabel: string; customer: string; what: string | null; address: string | null;
  meetingWord: string; statusWord: string; status: BookingStatus; live: boolean; overlaps: boolean; outsideHours: boolean;
  madeBy: string; confirmReply: "yes" | "no" | null;
};
export type AgendaDayView = { key: string; heading: string; closed: string | null; rows: AgendaRowView[];
  lanes: LaneItem[]; cancelled: AgendaRowView[]; free: { at: string; label: string; href: string }[] };
export function buildAgendaView(i: {
  rows: readonly AgendaBookingRow[]; window: { days: AgendaDay[] }; now: Date; timezone: string; locale: "en" | "es";
  openHours: OpenHours; status: StatusInput; names: Readonly<Record<string, string>>; viewerId: string;
  persona: string | null; calendarMeetingType: BookingMeetingType; canAdd: boolean; baseHref: string; view: AgendaView;
}): AgendaDayView[];
```

- [ ] **Step 1: Failing view-model tests** (`agenda-view.test.ts`), each with its mutation:
  - a row overlapping two days appears on both (mutation: bucket by start only → FAILS);
  - `madeBy`: person = the viewer → `calendar.agenda.addedByYou`; another person named → `addedBy` with the name; unnamed → `addedBy` with `assign.someone`; customer → `bookedOnline`; ai → `bookedBy` with the persona, "Sofía" when none (the author-mark precedent, `WEB/lib/record/author-mark.ts:103`);
  - `outsideHours` uses `fitsOpenHours`; `overlaps` comes from `agendaLanes`; a cancelled row is in `cancelled`, never in `lanes`; a `replaced` row is in neither (D11; mutation: show replaced rows → FAILS);
  - Week view: no free rows (mutation → FAILS); Day view: free rows only when `canAdd` (a Technician gets none);
  - the fall-back day's two "1:30" rows carry different labels (zone names; mutation: drop the `zoneShift` pass-through → FAILS);
  - `closed`: a closed-day range with a reason → `calendar.agenda.closed` with `business.reason.<reason>`; without → `closedPlain`; a storm in force → `business.state.storm`; Closed today → `business.state.closedToday`; running late → `null` (mutation: treat late as closed → FAILS); probed at `max(day start, now)` so today's 9 AM Closed today shows on today's head;
  - every `href` keeps `view` and `day` and adds `job` (mutation: drop `day` → FAILS).
  - `truncated` (the 400-row cap, `AGENDA_ROW_CAP`, plan review minor): the card renders `calendar.agenda.truncated` with `{cap}` = 400 above the rows, and never claims the view is complete (mutation: ignore `truncated` → FAILS);
- [ ] **Step 2: Failing page tests** (`page.test.ts`; the `@bis/db` mock gains the new reads, `@/lib/access-log/note` is mocked with a `noteOpened` spy, `./agenda-card` and `./job-drawer` are spy stubs like `calendarSettingsMock` at `:11`):
  - the agenda renders BEFORE the settings card in the markup (mutation: old order → FAILS);
  - `PageHeader` carries no button; Add job is inside the agenda card (the card's props carry `canAdd`) (mutation: an action in `PageHeader` → FAILS);
  - `?job=<id>`: `readAgendaJob` runs on the REQUEST client (the `dbForRequest` mock's object, mutation: `serviceDb()` → FAILS), `noteOpened` is called with `{ kind: "contact", recordId: job.contact_id }` BEFORE the drawer is rendered, and the drawer stub receives the view; a job the caller cannot see → no drawer, no `noteOpened`, the `calendar.job.gone` line; no `day` → the window is the job's own day;
  - a Technician: `canAdd` false, `canWrite` false, `canCloseOut` true (owner decision 1);
  - a thrown agenda read renders `calendar.agenda.error` with a Try again link to the same URL, and the Closed days, embed and feed cards still render (mutation: let it throw → FAILS);
  - the second-account test (`renderForAccount`, `:104`) still passes: every read is keyed by the route's account.
- [ ] **Step 3: Run red.** Paste.
- [ ] **Step 4: Implement.**
  - `page.tsx`: parse `view`, `day`, `job` (uuid or ignored); `today = dayKey(new Date(nowIso), account.timezone)`; when `job` is present, `readAgendaJob(db, accountId, job)` (request client), then `await noteOpened(access, accountId, { kind: "contact", recordId: row.contact_id })` in the page function itself (correction 7), then build the drawer view; the rest of the page as today minus `listCalendarBookings` and `BookingsList`; the Agenda card first and full width inside `<Suspense fallback={<AgendaSkeleton />}>`, then the existing two-column grid (`:194-238`) without `BookingsList`. `export const maxDuration = 60` stays (the after() settle runs inside the actions this page hosts).
  - `agenda-card.tsx` (async server component): reads `listAgendaBookings` for the window, `countAwaitingOutcomeBefore(db, accountId, startOfDay(today, timezone).toISOString())`, `listPeopleNames` for the person author ids, `getVoiceProfile` persona (best effort), `getBusinessStatusRow` and `listClosedDaysFrom` (best effort: a failed closure read renders no closed heads, logged); catches its own failure (error state); renders `calendar.agenda.truncated` when the read answered `truncated`, then renders the header (title, `Day | Week` as links with `aria-current`, Back · Today · Next links, the date, **Add job** — the card's ONE primary, `canAdd` only), the "earlier days" line (`pastOpen`/`pastOpenOne`, linking `../tasks`, only when the count is above 0), then `AgendaDay` or `AgendaWeek`, and the empty state (`emptyTitle` + `emptyBody` + Add job; `emptyTechnician` for a Technician).
  - `agenda-day.tsx` ("use client"): rows are `<button id="booking-<id>">` in time order on `--surface-2` inside the `--surface-1` card, hover `--surface-3`, `:focus-visible` ring; ArrowUp/ArrowDown move focus between rows; click and Enter `router.push(row.href, { scroll: false })`; a `side` item is two columns, a `stack` stacks; "Overlaps" and "Outside open hours" and "Closed" as `DotPill` dot and word (`--warn`, `--crit`); free rows "10:00 · Add job" open `JobSheet` prefilled.
  - `agenda-week.tsx` ("use client"): seven columns at `md` and up (each day head a link to that Day), one day at a time under a strip of seven day links below `md` (`aria-label` `calendar.agenda.daysLabel`).
  - `agenda-skeleton.tsx`: five rows shaped like Day rows (`components/ui/skeleton.tsx`), no spinner.
  - At 375 px the header wraps to two lines (tabs and Add job; Back · Today · Next and the date), nothing truncates in Spanish or under the pseudo-locale.
  - Route walk: `calendar/page.tsx` leaves `NOT_A_RECORD` (`:54`) and joins `RECORD` as `"noteOpened"` with the comment "F-046 part 1 (spec 8.2): the agenda is a list; opening a job's drawer (`?job=`) shows its customer's name, phone and address, so the page notes that customer, after the job is read on the caller's own client".
  - Styleguide: `agenda-demo.tsx` shows a Day with a side-by-side overlap, an outside-hours row, a closed head, a cancelled row and two free rows, a Week, and the skeleton; registered with T11's `JobDemo` in `styleguide/page.tsx`. `agenda-demo.test.ts`: the card header has exactly one primary button.
  - Delete `bookings-list.tsx` and `bookings-list.test.ts` (`git rm`, explicit paths).
- [ ] **Step 5: Run green:** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar" "src/app/(dashboard)/dashboard/accounts/[accountId]/access-log-routes.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts" "src/app/(dashboard)/dashboard/styleguide" src/lib/i18n src/lib/booking`, `pnpm --filter web typecheck`, `pnpm --filter web lint`. Paste all.
- [ ] **Step 6: Mutations** as named in Steps 1–2, plus: give the drawer a `variant="default"` button → `job-demo.test.ts` FAILS; call `noteOpened` from `agenda-card.tsx` instead of the page → the route walk's argument check FAILS naming the line. Each red by name.
- [ ] **Step 7: Commit** every listed path (the two deletions included): `feat(booking): the Calendar page opens on a day and week agenda where staff add, move and open jobs, in English and Spanish`.

---

### Task 13: Docs

**Tier:** low · **Owner:** orchestrator (DESIGN.md and the roadmap are not an implementer's to land) · **Wave:** 1 (any time before the PR)

- [ ] **Step 1: DESIGN.md**, after `:148` (the end of rule 8's 2026-10-29 amendment), insert:

```markdown
   **Amended 2026-10-30 (F-046 part 1, owner decision 2):** the calendar's
   job drawer carries no primary. Move, Cancel, Mark completed and No-show
   write the same booking, so they are one view, and none is its obvious
   decision; Move only opens a form whose own Save is that form's one
   primary (the chooser amendment's reasoning). The Agenda card is its own
   view and Add job is its one primary, inside the card, never in
   `PageHeader` above cards that carry their own.
```

- [ ] **Step 2: The roadmap row**, `docs/crm-features.md:1420`: the last cell `F-107 (part 2), F-084` becomes `F-084`, and the fourth cell gains "; works in today's shell at 375 px, so it does not wait for F-107 part 2 (spec 2026-10-30 §15.8)".
- [ ] **Step 3: Commit:** `git commit -m "docs(design): the calendar's job drawer carries no primary, and F-046 part 1 no longer waits for the bottom-tab shell" -- DESIGN.md docs/crm-features.md`

---

### Task 14: e2e

**Tier:** medium · **Owner:** bis-e2e-qa · **Wave:** 6 (after 0107 is on bis-ci, checklist step 5; CI's own e2e job runs it on its local stack earlier)

**Files:** create `apps/web/e2e/calendar-agenda.spec.ts`; modify `apps/web/e2e/booking.spec.ts:370-390`.

- [ ] **Step 1: `booking.spec.ts`'s calendar steps.** `:370-372` and `:380-390` read the old list. Rewrite them against the drawer, asserting the same things: open `/dashboard/accounts/${accountId}/calendar?job=<id>` (read the booking id with the service client by its cancel token, which step 2 already holds as `cancelHref`), scope every locator to `page.getByRole("dialog")` or `getByRole("main")`, see the booker's name and the note text in the drawer, press its Cancel (`m["calendar.bookings.cancel"]`), then the existing dialog steps unchanged. Nothing else in the spec moves.
- [ ] **Step 2: The new spec**, on the per-run fixture account only (copy `fullFixture()`, `CLIENT_FIXTURE_FILE` and the timeout header from `contacts-archive.spec.ts`, and `one-switch.spec.ts`'s `beforeAll`/`afterAll` calendar seed-and-restore: Mon–Fri 09:00–17:00 through `updateCalendarSettings`, restored after). Seed one contact with an email by direct insert. The seed also fixes `slotDurationMinutes: 60`, `bufferMinutes: 0`, `minNoticeHours: 1` and `maxAdvanceDays: 30` (restored after), so step 6's 10:00 control is a real slot: with a buffer the 10:00 slot would be blocked by the 11:00 job and the control could never pass (plan review minor). As the fixture Owner:
  1. open the Calendar on a weekday at least two days out (`?view=day&day=…`): the agenda is in `main` before the Booking settings card;
  2. click the free row "10:00 · Add job" (`m["calendar.agenda.addAt"]` with the time), choose the seeded contact, type a what, save: the toast reads `m["calendar.job.added"]`'s opening words; the row is on the Day;
  3. press the toast's Undo within the window: `m["calendar.job.undone"]`; after a reload the 10:00 row is gone and the free row is back;
  4. add a job at 11:00 the same way and let its toast close (kept);
  5. add one at 18:00 (outside hours): the sheet shows `m["calendar.job.warn.outsideHours"]` and the button reads `m["calendar.job.saveAnyway"]`; press it; the row shows `m["calendar.agenda.outsideHours"]`;
  6. open the public booking page on that day (`goToDay` from `booking.spec.ts`): the 11:00 slot is NOT offered (R2) and the 10:00 slot IS (the positive control: the undone job freed it). The 18:00 job proves nothing here (the grid ends at close), so it is not asserted on the public page;
  7. back on the agenda, click the 11:00 row: the drawer opens (the URL has `job=`); Esc closes it and focus is on that row;
  8. open `?job=<id>` with no `day`: the drawer is open on that job's own day.
  `afterAll`: cancel the staff jobs with the service client (`setBookingStatus(…, "cancelled")`) so the fixture calendar is clean for later specs; the per-run account is torn down whole (`auth.teardown.ts`).
- [ ] **Step 3:** The orchestrator runs the suite (one gate at a time; no `screenshots.yml` run in progress). Paste the spec's lines.
- [ ] **Step 4: Commit** the two paths: `test(e2e): add a job from a free hour, undo it, add one outside hours, see customers not offered its time, and open its drawer by row and by link`.

**Mutation probe:** in a scratch copy, make `addJobAction` skip the warnings (always write): step 5 FAILS by name. Revert.

---

## Orchestrator and owner checklist (in order)

1. **Install once:** `pnpm install --frozen-lockfile --prefer-offline` in `C:\Users\danlo\bis-platform\.claude\worktrees\agenda`, before wave 1.
2. **Wave gates.** Wave 2 only after T1's replica proof (Steps 4–6 lines) is in its report and its commit is on the branch; wave 3 after T2, T3, T4; wave 4 after T6; wave 5 after T10; T12 commits after T11.
3. **Push after wave 2 and after wave 5.** CI `verify` builds its own stack from the branch's migrations and runs every `withTestAccount` case (T1 Step 7, T4 Step 4, T5 Step 4). Read the check runs FOR THE HEAD SHA (`gh api repos/:owner/:repo/commits/<sha>/check-runs`); a live test counts as proven only from that read. The `e2e` job's migration check fails naming 0107 until step 5; that red is expected.
4. **T13** (docs) lands any time before the PR.
5. **0107 to bis-ci:** `ci-project-setup.yml` from `feat/calendar-agenda`, push-dry-run, then push.
6. **Gate before production (ASSUMPTIONS 17a and 17b).** Read the CI `verify` run FOR THE HEAD SHA that carries T4 (`gh api repos/:owner/:repo/commits/<sha>/check-runs`, then that run's db-suite log) and find, by name, T4 Step 4's case (b) passing (a customer `createBooking` over a staff job throws `SlotTakenError`: the trigger's 23P01 reaches the client as a code through PostgREST) and case (c) passing (the `places!bookings_place_fkey` embed resolves, no PGRST201), and `same-account-fk-schema.test.ts`'s embed probes green. Either one missing or red: stop before production.
7. **Production.** Read-only first: `select count(*) from public.bookings;` (ASSUMPTION 17d: expect a few hundred at most; far more means an off-peak apply). Then apply with MCP `apply_migration`, name `calendar_agenda`, the file's exact text (ASCII only, no backslash: the `\u` trap does not apply). Then confirm the WHOLE file landed (ASSUMPTION 17f): `bookings_slot_guard` and `undo_staff_move` exist, and `select prosrc like '%for no key update%' from pg_proc where proname = 'undo_ai_booking_act'` is true.
8. **Parity** (`docs/runbooks/ci-supabase-project.md`): the six columns, `pg_get_constraintdef` of `bookings_no_overlap` and the five new constraints, `pg_get_triggerdef` of `bookings_slot_guard`, md5 of `pg_get_functiondef` for `app.bookings_slot_guard()`, `public.undo_staff_move(…)` and the replaced `public.undo_ai_booking_act(…)`, and the three functions' EXECUTE grants, equal between bis-ci and production.
9. **Local e2e** (T14): no `screenshots.yml` run in progress; one gate at a time.
10. **PR** from `feat/calendar-agenda`; squash-merge only after `verify` and `e2e` are green FOR THE HEAD SHA.
11. **Owner smoke, after deploy** (the owner, never an agent; no live client account): on BIS's own account, add a job for yourself (your own Gmail customer) with the confirmation ticked, press Undo inside ten seconds and see no email arrive; add it again and receive the confirmation with its address line; move it and receive the moved email; open it from the email's link on the agenda.
12. **Roadmap tracker:** F-046 part 1's row.
13. **Ledger:** the seventeen planning corrections and the plan review fixes above; T9's window note (bis-automations); the deferred items below.

## Deferred (named, not built)

- **Removing `listCalendarBookings`** and its three live tests once nothing reads it (correction 14).
- **The call page's "View booking" link** (`ACCT/calls/[callId]/page.tsx:271-277`) could open `?job=<booking_id>`; bis-voice's file, not this plan's.
- **One Spanish voice per customer:** today's confirmation and moved templates speak `tú` (`templates/booking.ts:26-33`); bis-comms decides for every customer template at once (spec §13).
- **The job card, visit statuses, services, F-015's address component, drag and drop, month view, per-staff calendars, text confirmations** (spec §13).

## Self-review (done while writing, 2026-10-30)

- **The migration was run while planning.** T1 Step 3's exact text was extracted from this file and applied to a scratch PostgreSQL 17.6 replica of 0001–0106 (port 55975, since stopped): apply exit 0; ASCII only, no backslash, six `$$`; `pg_get_triggerdef` is exactly the string T1's catalogue case pins; `pg_get_constraintdef(bookings_no_overlap)` reads `EXCLUDE USING gist (calendar_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (((status = 'booked'::text) AND (author_kind <> 'person'::text)))` (the case uses `toContain` on the two terms); 37 definers; `undo_staff_move` EXECUTE for service_role only. Behaviour read back: two overlapping person rows save; a customer row over a staff job fails `23P01 bookings_no_overlap: overlaps a job staff booked`; a back-to-back customer row saves; `undo_staff_move` answers `time_taken` (new row kept), `changed` on a wrong version, `undone` (old row booked), then `gone`; deleting a place a job names fails `23503` on `bookings_place_fkey`. The TypeScript test file itself was not run (no `node_modules` in this worktree while planning); T1 runs it.
- **Re-verified after the plan review (same replica, the final text of Step 3).** Apply exit 0; ASCII only, no backslash, eight `$$`; 37 definers; `undo_ai_booking_act` still invoker, `search_path=pg_catalog, pg_temp`, volatile, EXECUTE service_role only, comment kept, `prosrc` differing from 0106's only by the three added lines. I1: with 0107 as first written, three sessions (one holding the old ai booking's row, the undo, a customer insert over the new booking) ended `ERROR: deadlock detected … while locking tuple (0,1) in relation "calendars"`; with the fix the undo answered `undone` and the insert `INSERT 0 1`. `undo_staff_move`'s lock order: while another transaction held the calendar row, the new booking was lockable `for update nowait` (`not locked`) with the fix and `could not obtain lock on row in relation "bookings"` without it. I2: an add's row cancelled by a move, past its `hold_until`: the booked-only claim updated 0 rows; `undo_staff_move` answered `undone`; the restored row read `booked | unsettled | confirmation` and the re-armed claim returned it with `confirmation`. The reverse race: the old hold claimed while booked (1 row), then cancelled; the re-read showed it claimed, and `setJobNotice`'s update set the new row to `moved` (1 row). The overlap rules re-read the same as before (two staff rows save; a customer row over a staff job `bookings_no_overlap: overlaps a job staff booked`; back-to-back saves).

- **Spec coverage.** §1 → T4, T10, T12. §2 R1/R2/R11 → T1; R3 → T3, T10; R4 → T6, T10; R5 → T10, T12 (RLS reads, `seesWholeAccount`); R6 → T12; R7 → T10, T11; R8 → T10, T11; R9 → T1, T4, T6, T9, T10; R10 → T11, T12. D1–D12 → T4 (D1, D2, D5, D12 unchanged count), T6 (D3, D4, D8), T10 (D6, D7), T12 (D9, D10, D11). §3 → T1, T4. §4's readers: slot engine and races unchanged (T1 proves the errcode), reminders T4, texts and confirms T9, closures T10 (`closureKept`), feed T7, activity card T6 (D8). §5 → T11, T12. §6 → T6, T9, T10. §7 → T1 (races), T4 (claim vs Undo). §8 → T10, T12. §9 → T2. §10 → each task's tests. §11 → the checklist. §14 → T13. §16 → T10/T12 (decision 1), T11/T13 (2), T6 (3, 4), T4 (5).
- **Placeholders.** None of "TBD" or "similar to". T11's and T12's component bodies are specified by their props, their handler tests and DESIGN.md's rules rather than written out, as the model plan did for its UI tasks; every behaviour a reviewer could reject has a named test and mutation.
- **Type and name consistency.** `BookingMeetingType`, `NoticeWanted`, `JobOpened`, `JobWarningView`, `settleJobHold`/`settleAfterWindow`, `claimJobHold`, `listDueJobHolds`, `deleteUnsettledStaffJob`, `undoStaffMove`, `editJobDetails`, `jobHoldsPass`/`"jobHolds"`, `JOB_HOLD_BUDGET_MS`, the kinds `staff.booking_confirmation`/`staff.booking_moved` and the URL's `view`/`day`/`job` are spelled the same in every task that names them.
- **Probes that cannot fail as first written:** T1 Step 6's two `undo_ai_booking_act` cases are green before 0107 too (a person row collides under 0016's rule as well); they say so in their names and are kept as the guards of the trigger's errcode, whose mutation (P0001) does turn them red.
