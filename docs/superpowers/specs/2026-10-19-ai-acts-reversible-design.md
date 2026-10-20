# Item 8c: Sofía's live acts, visible and reversible (F-022) — design

Date: 2026-10-19. Status: design approved in brainstorm (owner tiles 2026-10-19, listed in §2); this
file awaits the owner's review before the plan is written.
Plan line: `docs/crm-features.md` first-release item 8, F-022 ("author columns, AI writes stamped as
AI, visible and undoable acts, and a notice whenever Sofía changes a booking"); decision 19 (decided
2026-10-05, option (a), the narrow reading); binding constraint 5.
Builds on: 8a (gateway, #270/#271), 8b-1 (#273, migration 0088: `proposals`, the kind registry
shape, decide/Undo), 8b-2 (branch `feat/item8b2-work-tray`, migrations 0089/0090: the record's timeline
`suggestions` source, the flat-row kit, focus fallback). **8c starts after 8b-2 merges** and takes the
next migration number, **0091**.

## 1. What the owner gets

Every act Sofía (the phone receptionist) or the web chat takes live, with no person approving, shows
on that customer's record timeline as a row marked **"Sofía · AI"** that says what she did, from
which call or chat, and when. Each row carries an **Undo** for as long as undoing it is still safe;
once something has overtaken the act, the row says why in plain words instead. A contact Sofía made
carries "created by Sofía · AI". The business is told whenever Sofía changes a booking.

Nothing about what Sofía may do changes, apart from it now being recorded and reversible.

## 2. Decisions (owner, 2026-10-19, brainstorm tiles)

| # | Decision |
|---|---|
| D1 | **Blank-fills stay live.** A caller stating their own name, email or number, written to blank fields of the record matched to their own phone number, is "leaving their own name and number" under decision 19 (a). It stays live, is stamped "Sofía · AI" on the timeline, and is undoable. Anything Sofía infers beyond what the caller said stays a tray suggestion (8b's `contact_field` kind), as today. This is a **dated amendment to decision 19's wording** (`crm-features.md` §decision 19 and §3.2 rule 4), made on this branch. |
| D2 | **Undo window: until overtaken.** No clock. An act stays undoable while its still-safe check holds (§4.2); after that the row states why. |
| D3 | **Telling the customer.** Undoing a booking act asks "Let {name} know?" — pre-ticked — and sends the usual cancellation or confirmation message in the customer's language (S-09) when ticked. Staff untick it when they have already called. |
| D4 | **Undoing a contact Sofía created** deletes it only while it holds nothing but her own call or chat; the call stays in Calls, unlinked. Merging duplicates waits for S-12. |
| D5 | **Approach:** a dedicated `ai_acts` record (one row per live act, with what was there before) and an act-kind registry (describe / still-safe / undo), the shape 8b proved. Not the suggestions table, not the event log. |

## 3. Scope

### In
- The acts in the inventory (§6), on both the voice path and the web chat's lead filing.
- `ai_acts` (migration 0091), the act-kind registry, the record timeline source and its rows, Undo
  actions with their still-safe checks, the customer message on booking undos.
- `contacts.author_kind` / `author_id` (who created the contact), backfilled (§5.3).
- A check that every booking change by Sofía reaches the business (§7), filling any hole.
- The amendment to decision 19's wording (D1).

### Out (later, named)
- The contact drawer and household/business timelines (same reasoning as 8b-2's owner decision: the
  drawer's read fence stays as measured). The record page only.
- Undo of the callback to-do (staff can already complete or delete it) and of call summaries, call
  cards and call-to-contact links (labelled summaries for staff, not AI writes under §3.2 rule 4).
- Merging a duplicate contact (S-12). Author columns on tables not written by Sofía.
- Undo of an undo (re-doing an act): the undo itself is recorded on the row; a person who wants the act
  back does it the normal way.

## 4. The model

### 4.1 `ai_acts` (migration 0091)
One row per live act, written by the server only (service role), read through RLS like `proposals`:
members of the account (or the agency); a Technician only for a customer they can read; never a row
with no customer.

| Column | Meaning |
|---|---|
| `id`, `account_id`, `created_at` | as usual |
| `actor` | `voice` or `webchat` (which assistant acted) |
| `call_id` / `chat_id` (the web chat conversation) | the source; exactly one set, by `actor` (nullable FKs, cascade with their source) |
| `contact_id` | the customer the act touched (FK, cascade) |
| `kind` | `booking_created`, `booking_rescheduled`, `booking_cancelled`, `contact_created`, `contact_field_filled` |
| `target` jsonb | what was touched: booking id(s), field name |
| `before` jsonb / `after` jsonb | what was there before and what Sofía wrote (for a fill: `null` → value; for a reschedule: old and new booking ids and times) |
| `undone_at`, `undone_by` | set by a successful Undo (pair constraint) |
| `undo_notified` | whether the customer was told (D3) |

What was acted on never changes after insert (a trigger, as 0088's `proposals_proposed_is_fixed`); only
the undo columns move. Indexes: `(account_id, contact_id, created_at desc)` for the timeline;
`(target)` lookups as the plan needs for the still-safe checks.

### 4.2 The act-kind registry
Each kind is one module with three members, mirroring 8b's suggestion kinds:

- **`describe(act, ctx)`** → the timeline sentence and detail, bilingual (usted), e.g. "Sofía booked
  Tue, Oct 21 · 3:00 PM", "Sofía filled in the email: ana@…".
- **`stillSafe(db, act)`** → `{ ok: true }` or `{ ok: false, reason }`, read on the request client:

  | Kind | Still safe while… | Reason words when not |
  |---|---|---|
  | `booking_created` | the booking is still booked and has not started | "Already cancelled", "Already happened" |
  | `booking_rescheduled` | the new booking is untouched and the old slot is still free and in the future | "Changed since", "The old time is taken" |
  | `booking_cancelled` | the booking is still cancelled, its slot is free and in the future | "Already re-booked", "The time has passed" |
  | `contact_created` | the contact holds nothing but Sofía's own call or chat (no note, task, booking, message, document, opportunity, form or other call) | "Has other activity since" |
  | `contact_field_filled` | the field still holds exactly Sofía's value | "Changed since by {name}" |

- **`undo(deps, act, { notify })`** → the inverse, on the request client, compare-and-swap so a race
  can never undo twice or clobber a later edit; then the `undone_*` stamp. Booking undos send the
  customer message when `notify` is true (D3). A contact undo deletes through the existing contact
  delete path (§5.2).

The registry runs on the server only; the client gets a built view, as 8b's `SuggestionView`.

### 4.3 Writing the act row
Each live write records its act right after the write, in the same request, through one `recordAct`
helper. **Best-effort, never fatal on the call or chat path:** if the act row fails, the write stands,
the failure is logged with ids only, and the timeline simply lacks an Undo for it. (A live call must
never fail because bookkeeping did.) The plan names every call site from §6.

## 5. Surfaces

### 5.1 The record timeline
A new timeline source `ai_acts` on the customer's record page (not the drawer or group pages, §3):
each row is the AI author mark ("Sofía · AI", persona name from the account), the sentence, the
source ("from the call on Tue, Oct 21" linking to the call; "from the web chat"), the time, and on the
right a ghost **Undo** while still safe, or the reason line when not, or "Undone by Ana · Oct 22" once
undone. Flat rows, ghost actions only (DESIGN.md rule 8 amendment of 2026-10-19: a flat row inside a
record card has no primary). The timeline's "all failed" counting includes the new source the way
8b-2 fixed it.

### 5.2 The Undo interaction
- **Field fill:** runs at once (rule 6: reversible), with the usual 10-second Undo toast that puts
  Sofía's value back.
- **Booking acts:** a small popover with the sentence, the checkbox "Let {name} know by
  {text|email}" (pre-ticked; the channel the booking already uses), and one primary "Undo" (the
  popover is its own view). Result toast; no redo toast (§3).
- **Contact created:** deleting a contact is destructive, so it uses the existing contact-delete
  confirmation (typed name, rule 6), reached from this row; the copy says the call stays in Calls.

Who may undo: anyone who may edit that customer (members; a Technician only on an assigned customer),
the same check the actions it reverses use.

### 5.3 "Created by" on contacts
`contacts.author_kind` (the closed set: person, ai, automation, customer, import) and `author_id`,
set by every contact writer from now on. Existing rows are backfilled from their `contact.created`
event (`ai` → ai; `user` → person with the actor id; `form` system actor → customer; import → import).
The plan reports how many rows have no event; if any, it stops and the owner decides their mark
(DESIGN.md: a row with no mark is a defect). The record header and the timeline's creation row show it.

## 6. Live writes covered (inventory 2026-10-19, `origin/main` 48c5ba33)

| Act | Call sites |
|---|---|
| booking_created | `apps/web/src/lib/voice/tools/registry.ts:479-485` (`createBooking`, actor ai) |
| booking_rescheduled | `registry.ts:572-580` (new booking + cancel old) |
| booking_cancelled | `registry.ts:655` (`setBookingStatus … "voice","ai"`) |
| contact_created | `registry.ts:439-442`; `voice/finish-call.ts:302-310`, `:337-342`; `voice/textback.ts:118-120`; web chat `lib/concierge/lead.ts:148-153` → `lib/forms/enrich.ts:94-104` (only when reached from the chat's `fileLead`, not the public form) |
| contact_field_filled | `registry.ts:450-454`; `finish-call.ts:322-327`, `:344-348`; `textback.ts:118-120`; web chat `enrich.ts:276-287` (same proviso) |

Today `undoOperatorCancel` refuses an AI cancel (`packages/db/src/booking.ts:478-480`); 8c adds the
AI-cancel restore as `booking_cancelled`'s undo rather than loosening that function.

## 7. The notice when Sofía changes a booking
Today: a booking reaches the business in the call alert (`finish-call.ts:478-494`); a reschedule or
cancel sends a staff email (`registry.ts:190-221`). The plan verifies every path (voice book,
reschedule, cancel; a failed alert is logged, not silent) and fills any gap; no new channel.

## 8. Tests (the plan expands)
- Schema: RLS (member, other account, Technician fence, no-customer row), service-role-only writes,
  the immutability trigger, the undo pair, cascades.
- Each kind: describe in en/es/pseudo; still-safe true/false per row of §4.2 with the reason words;
  undo writes the inverse and stamps; a second undo is refused; a race (a later edit) is not
  clobbered; booking undo with notify on/off sends/doesn't send, in the customer's language.
- `recordAct` failure never fails the call path (voice tool tests).
- Timeline: rows with the AI mark, the reason line, "Undone by"; the source's failure is isolated.
- e2e on the fixture account: a seeded Sofía booking undone with "Let them know" unticked; a filled
  email undone; an untouched Sofía contact deleted; an overtaken act shows its reason.

## 9. Rollout
One PR. Migration 0091 is additive (a new table + two nullable contact columns and their backfill):
bis-ci first, production before the code, parity, merge. Owner smoke on BIS's own account: a real call
that books, then Undo with "Let them know" unticked; the timeline row reads "Undone by …".

## 10. Risks
- A live act whose `recordAct` failed has no Undo: logged; acceptable (the act itself is still marked
  AI on the booking/contact).
- Restoring a cancelled booking into a slot taken meanwhile is refused by the still-safe check, never
  double-booked.
- Deleting a contact is irreversible: hence the typed confirmation and the strict "holds nothing but
  her call" check.
