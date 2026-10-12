# The contact record page — design (first release, item 3, S-03 part 1)

Date: 2026-10-12. Owner rulings (§2, D1–D7). Plan: `docs/crm-features.md` §4.3 item 3 (S-03, F-001 part, F-101,
`:1264-1267`), §5.1 F-001 (`:1894`), §6.3 "Surface 3. The record page and the vault" (`:2618-2664`, the desk
sketch at `:2650-2664`), the record-kit enabler (`:2819`), amendments 6, 11 and 20 (`:2853`, `:2858`, `:2867`).
Design contract: DESIGN.md rules 3, 5, 7, 8, 11, "Record page, documents and provenance (v2)", the module
contract, and the definition of done. Builds on S-02 parts 1–3 (0069, 0070, 0071, merged) and F-085 part 1
(0068). Siblings to come: part 2 (a record page for a household or business group), part 3 (the list drawer
rebuilt on the kit).

## 1. Goal

One page per customer that a business owner reads at 7 AM and a technician reads in a truck. On a desk it is
three columns: **who they are**, **what is happening**, **what they have**. On a phone it is one column in the
order a person acts in: who they are and a Call button, the checked facts and what is coming up, the timeline,
then what they have, then the rest of who they are. Every timeline row says who did what and when, with an
author mark from one closed set — a named person, "Sofía · AI", an automation, the customer, an import — so
no row leaves its author to be guessed. Every card loads, empties and fails on its own. Built on a small
**record kit** (layout, header, card chrome, boundary) and a **card registry**, so parts 2 and 3 and later
modules add cards rather than pages.

## 2. Decisions

Owner (danlo, 2026-10-12), given in the brief:

| # | Question | Decision |
|---|---|---|
| D1 | The split | Part 1 = the contact record page (this spec). Part 2 = a record page for a household or business group. Part 3 = the list drawer rebuilt on the kit. The documents vault (first-release item 6) and the AI-written summary prose (item 8) are neither here, and **no visible slot is reserved** for them |
| D2 | Approach | A record kit plus a card registry. Kit: `RecordLayout` (the three-column desk), `RecordHeader`, `RecordCard` (one glass chrome, a title, its own skeleton, empty and error; today's two chromes unified). Registry `apps/web/src/lib/record/record-cards.ts` lists the core cards with column and phone order; packs come later. A card renders server-side or reads its own route client-side (Groups, Properties, Related people, as shipped); each sits behind its own boundary and skeleton. Existing cards move in unchanged inside. **The drawer is untouched in part 1** |
| D3 | Header | Name; their household or business; actions **Call** (`tel:`, the ONE primary, first on a phone), **Text** and **Email** (scroll to the composer on that channel), **Directions** (only when one of their properties has an address; reuses `mapUrl`). An action with nothing behind it is **hidden**, not disabled. **No status chip** (contacts have no status column), **no language chip** (a contact's language arrives with item 5, S-09) |
| D4 | Summary | A checked-facts line counted from data, then "Next up": the next three upcoming bookings or open To-dos. A fact we cannot measure is omitted, never zeroed; dates in the account's zone. Empty and error states written |
| D5 | Timeline | Bookings and calls become their own row kinds. Every row reads who · did what · when, with a mark from the closed set. Where author data is missing, a migration (0073) adds the minimum, says who writes it, and gives historical rows a written default so none is blank |
| D6 | Phone | One column: header (Call first) → summary and Next up → timeline → what they have (collapsed, tap to open) → who they are |
| D7 | Testing | Unit tests (fact counting, Next up, author-mark mapping, registry order), each card failing alone, e2e (desk and phone order, header actions shown and hidden, a booking row and a call row with marks, English and Spanish) |

Choices this spec makes (each is open to the owner; §16 lists the ones put as questions):

| # | Choice |
|---|---|
| C1 | **Two author shapes, chosen by who may write the table.** Rows a signed-in person writes directly (`notes`, `tasks`, `opportunities`, client-writable under 0053) get their author **stamped by the database** from the JWT `sub`, 0071 C8's convention. Rows only server code writes (`messages`, `bookings`, `form_submissions`, server-only since 0053, `0053_server_only_writes.sql:3-20`) get an explicit `author_kind` written by that server code from the actor it already passes (`createMessage`/`createBooking`'s `actorId, actorType`). `calls` needs nothing: every `calls` row is a call the receptionist took (§6) |
| C2 | **One closed type for the mark**, `AuthorKind = 'person' \| 'ai' \| 'automation' \| 'customer' \| 'import'`, the same five values as a SQL CHECK and a TypeScript union. A person is named from `users` under the reader's own RLS; one who cannot be named reads **"Someone on the team"** (the existing `assign.someone`, `messages.ts:3340-3341`), which is still the person mark, never a sixth class |
| C3 | **The timeline pages on the server**, merged across seven sources, with the contact list's cursor (`lib/cursor.ts`: `RowCursor {v, id}`, `encodeCursor`, `:32-47`): `v` = the row's time, `id` = its uuid, ordered `(at desc, id desc)`. One pager, "Older" carrying `?before=`, "Newer" back to the head (`contacts/page.tsx:73`'s `buildNewerHref` idiom). 30 rows a page |
| C4 | **The timeline shows conversation messages only** (`channel in ('email','sms')`). The `form` and `voice` channel rows are the inbox's copies of a submission, a booking change or a call (`lib/forms/enrich.ts:164-167`, `b/[publicId]/actions.ts:400-403`, `lib/voice/finish-call.ts:421-424`, `lib/voice/tools/registry.ts:239-241`), which now have rows of their own. Today a form submission shows twice on the timeline (its submission row and its `form` message row, `activity-timeline.tsx:149-170`); this fixes that |
| C5 | **Every card's loader returns a load, never throws** (`{status: "ready", …} \| {status: "error"}`, the `TextsLoad`/`EmailLoad` shape, `[contactId]/page.tsx:96-113`), and a client error boundary wraps each card as the backstop for a render-time throw. The kit does not rely on a streamed RSC error reaching a client boundary as its only guard (an assumption about Next's runtime this spec does not lean on) |
| C6 | **DOM order is the phone order.** On a desk `RecordLayout` places the cards into three columns with CSS grid areas; keyboard and screen-reader order follow the page's priority (summary, Next up, timeline, what they have, who they are) on every width. A visual-order/DOM-order mismatch on the desk is accepted for the left column; a skip link "Skip to details" (`record.skipToDetails`) goes straight to it |
| C7 | **The household or business in the header is plain text in part 1** ("García family · Household"). There is no group page until part 2, and a same-page anchor to the Groups card would change meaning when part 2 lands. Part 2 turns it into the link |
| C8 | **Facts count with the dashboard's definitions.** "Booked {n} times" counts bookings made, not reschedules (D-035, `packages/db/src/booking.ts:915-930`, "the ONE read behind every bookings count"), so the record and the Monday report agree |
| C9 | **Undated open To-dos are not in Next up.** The three are bookings still ahead and To-dos with a due date, overdue first; under them one plain line counts the rest, "{n} more To-dos have no date." Undated To-dos stay on the timeline. A To-do with no date has no "next" to sort by, and a count is honest where a guessed position is not |
| C10 | **Status is a dot and a word** on every row that has one (booking, deal, outbound message, call outcome), rule 3; today's message status is a bare word (`activity-timeline.tsx:386`) |
| C11 | **Customer-typed text carries `lang=""`** (HTML's "language unknown") until S-09 gives contacts a language; a caller's own words carry `lang={calls.language}` (`0019_voice_core.sql:52`). The row chrome carries the page's `lang` |

## 3. Non-goals

The documents vault, the AI-written summary prose and its "Generated by AI · Regenerate" (D1; no placeholder,
no empty slot). The group record page (part 2) and the drawer on the kit (part 3); the drawer and its
`/summary` route (`api/.../summary/route.ts`) are unchanged. A status chip and a language chip (D3). Opening a
deal from the record (F-055's money card, `crm-features.md:2624`). Who cancelled or completed a booking, and who
finished a To-do (part 1 marks who MADE a row; state changes keep their current state on the row). Properties,
relationships and group changes on the timeline. ⌘K, the peek stack, `RoleChip` and `CompletenessMeter`
(`crm-features.md:2819` names them; no part 1 surface needs them). Translating the "who they are" fields panel
(D2 moves it unchanged; §16 Q5). Filters on the timeline.

## 4. Roles

| What | Owner | Staff | Technician | Agency |
|---|---|---|---|---|
| Open a customer's page | any | any | only their own customer: `getContact` returns null under 0068's `contacts_technician_scope` (`0068_mine_unassigned_technician.sql:103-107`) and the page 404s (`[contactId]/page.tsx:47-48`) | any |
| See every timeline row of that customer | yes | yes | yes: notes, opportunities, calls, bookings and submissions are fenced by `contact_id` (`0068:110-120`), messages through the conversation (`:122-124`), tasks by contact (`:134-138`); all of one visible customer's rows pass | yes |
| Names on person marks | team members (`users_member_read`, `0066_staff_and_roles.sql:108-109`) | same | same: a Technician already reads the team's `users` rows, so naming who wrote a note adds no exposure | everyone (`users_agency_read`, `0066:107`) |
| Header actions | all that apply | all that apply | all that apply to their customer (the same gates the composer uses) | all that apply |
| Pickers ("Assigned to", task holder) | yes | yes | no (`canAssign` false, `lib/assign/view.ts:52-55`), as today | yes |

A Technician cannot read `events` (`0068:143-145`), which is why provenance has to live on the rows (0071 C8's
reasoning) rather than be joined from the ledger at render time.

## 5. Data: migration 0073

`0073_record_provenance.sql`, by bis-db-schema. **Numbering:** 0072 is G9's on another branch; this is 0073 and
reaches bis-ci before merge (`.github/scripts/ci-migrations-applied.sh`). ASCII only, no backslash.
`set local lock_timeout = '5s'`. Depends on 0071 (`app.stamp_created_by()`, `0071_places_and_equipment.sql:139-148`).

### 5.1 Columns

```
tasks:            created_by text null      -- the author's Clerk subject (0071 C8)
opportunities:    created_by text null      -- same
messages:         author_kind text null, author_id text null
bookings:         author_kind text null, author_id text null
form_submissions: author_kind text not null default 'customer'
-- each author_kind: check (author_kind in ('person','ai','automation','customer','import'))
-- messages and bookings: check (author_id is null or author_kind = 'person')
-- form_submissions: check (author_kind in ('customer','ai'))
```

`notes.author_id` (`0003_crm_core.sql:99`) already exists and stays the notes author. `messages` and `bookings`
are created nullable and become NOT NULL in a follow-up after the app deploys (§13), because the build before
this one inserts without them. `form_submissions` takes a default: every submission is the customer's except a
web-chat one, which the backfill and the app mark `ai`. No index: nothing filters by author this release.

### 5.2 Who writes them

- **tasks, opportunities:** `before insert` triggers `tasks_stamp_created_by` and `opportunities_stamp_created_by`
  executing 0071's `app.stamp_created_by()` unchanged (a signed-in insert stores its JWT `sub`, a client value
  is discarded, the service role stores NULL). Every person path that makes a To-do or a deal goes through the
  request client: `contacts/[contactId]/actions.ts:156`, `tasks/actions.ts:121`, `calls/[callId]/actions.ts:135`
  (an accepted call proposal: the person who accepted it is the author), `pipeline/actions.ts:18`.
  `tasks` holds a table-wide UPDATE grant for `authenticated` (`schema-grants-guard.test.ts:102`, IUD), so a
  `before update` trigger `app.keep_created_by()` sets `new.created_by := old.created_by` on tasks; opportunities
  need none (0053 made its UPDATE a column list and a new column is not in it, `0053:28-29`, `:142-143`).
- **notes:** `notes` is also IUD (`schema-grants-guard.test.ts:90`) and `author_id` is sent by the client today
  (`activities.ts:9-10`). `app.notes_author_guard()`, `before insert or update`: on insert by `authenticated`,
  `new.author_id := nullif(btrim(app.jwt() ->> 'sub'), '')`; on update, `new.author_id := old.author_id`. The
  service role's value is kept on insert (no service path writes notes today; `addNote` has one caller,
  `[contactId]/actions.ts:147`). Plain functions, not definer, `current_user` the caller (0068 section 5's shape).
- **messages:** `createMessage` (`packages/db/src/messaging.ts:129-145`) writes `author_kind`/`author_id` from
  `messageAuthor(actorType, actorId, direction)`, a pure function in a new `packages/db/src/provenance.ts`:
  `ai` → `ai`; else `inbound` → `customer`; else `user` → `person` with `actorId`; else `automation`. Checked
  against all thirteen callers: staff sends pass the signed-in user's id with the default `user`
  (`conversations/actions.ts:82-85`, `:197-199`; `calendar/cancel-notice.ts:128-130`), recipes pass
  `"automation"`/`system` (`lib/automations/send-sms.ts:19-20`, `:135-137`), stop replies `system`
  (`lib/consent/replies.ts:90`, `:125-127`), the missed-call text-back `voice`/`ai` (`lib/voice/textback.ts:44-45`,
  `:279-281`), an inbound text `system` (`api/sms/inbound/route.ts:54-55`, `:181`). The function is the only place
  the mapping lives; the backfill's CASE (§5.3) is pinned to it by a parity test (§12).
- **bookings:** `createBooking` and `moveBooking` (`booking.ts:253-270`, `:687`) write
  `bookingAuthor(actorType, actorId)`: `ai` → `ai`; `system` → `customer`; `user` → `person`. The three makers
  today: the public booking page (`"public"`/`system`, `b/[publicId]/actions.ts:48-49`, `:333-336`), its move page
  (same actor, `b/[publicId]/move/[token]/actions.ts:50-51`, `:145-146`), and the receptionist's book and
  reschedule tools (`"voice"`/`ai`, `lib/voice/tools/registry.ts:480-485`, `:579-583`). **No staff path makes a
  booking today**; `person` is in the set for when one does.
- **form_submissions:** the web chat's intake (`lib/concierge/lead.ts:151-154`) passes `author_kind: 'ai'` to
  `createSubmission`; every other path takes the default.

Grants are unchanged: the three server-only tables stay server-only, and the guard's `EXPECTED_WRITES` does not
move. The two new functions (`app.keep_created_by`, `app.notes_author_guard`) `revoke all … from public, anon`, as 0068 granted its own.

### 5.3 Backfill, and the honest default per kind

In the same file, after the columns, one idempotent statement per table (re-run by the follow-up, §13):

| Row kind | Evidence used | Default when there is none, and why it is honest |
|---|---|---|
| Note | `notes.author_id` as stored | none needed: only a signed-in person has ever written a note (one caller). NULL (the demo seed only) reads "Someone on the team": a person wrote it; we cannot say who |
| To-do | `tasks.call_id` → `ai` (`voice.ts:575-600`, the callback To-do); `consent_event_id` → `automation` (`activities.ts:121-142`, the stop-hold To-do); else `created_by` from the `task.created` event's `actor_id` where `actor_type = 'user'` (`activities.ts:35-36` emits `{taskId}`) | derived at read time (§6), not stored. A To-do with neither link and no author is a person's: no other path makes one. "Someone on the team" |
| Deal | `created_by` from `opportunity.created` (`opportunities.ts:27-28`, `{opportunityId}`) where `actor_type = 'user'` | person, unnamed: the pipeline is the only maker besides the two seeds (`demo/seed.ts:798`, `ci-seed/seed.ts:229`) |
| Submission | `'ai'` where `id in (select submission_id from concierge_conversations)` (the chat claims its one submission, `concierge.ts:323-335`, and deletes a loser, `lead.ts:156-163`) | `customer`: a person filled the form |
| Message | `inbound` → `customer`, unless the `message.created` event (`messaging.ts:150-151`, `{messageId}`) says `ai`; `outbound` → the event mapped through the same CASE as `messageAuthor` | an outbound message with no event (an emit that failed after its insert) gets `person`, unnamed. **Owner question Q2.** Expected count: zero or near it, measured before apply (§13) |
| Booking | the `booking.created` event (`booking.ts:267-268`, `{bookingId}`) through `bookingAuthor`'s CASE | no event: `ip_hash is not null` → `customer` (only the two public paths pass one, `b/[publicId]/actions.ts:335`, `move/[token]/actions.ts:146`); else `ai` (the receptionist passes none, `registry.ts:480-485`; so does the demo seed, whose account is fiction) |
| Call | none needed | `ai`: every `calls` row is a call the receptionist took. A call forwarded to a person and a call the platform refused are deliberately NOT `calls` rows (`0059_forwarded_calls.sql:85`, `0039_screened_calls.sql:76`) |

The backfill raises a NOTICE with the count in each bucket; the plan's apply step reads them on bis-ci and on
production before merge.

## 6. Provenance, row kind by row kind

`authorMark(row, ctx)` in `apps/web/src/lib/record/author-mark.ts` (pure) returns
`{ kind: AuthorKind; label: string }` for every row; its return type admits only the five kinds, so a sixth is a
compile error. `ctx` holds the viewer's Clerk id, the `users` names read for this page, the persona name, the
locale.

| Kind | Mark | Row reads (EN) |
|---|---|---|
| Note | person (`author_id`) | **Dan López** · added a note · Oct 9, 4:12 PM |
| To-do | `call_id` → AI; `consent_event_id` → automation; else person (`created_by`) | **Sofía · AI** · left a callback To-do · … |
| Deal | person (`created_by`; unnamed when NULL) | **Dan López** · added a deal: Deck build · $2,400 · ● Open |
| Submission | `author_kind` | **Customer** · sent the Quote request form · … / **Sofía · AI** · took a request in the website chat |
| Message (email, sms) | `author_kind` | **Customer** · texted · … / **Dan López** · emailed · ● Delivered / **Automation** · texted / **Sofía · AI** · texted (the missed-call text-back) |
| Booking | `author_kind` | **Customer** · booked Thu, Oct 16, 10:00 AM · Estimates · ● Booked; a reschedule adds "Moved from Tue, Oct 14, 9:00 AM" (`rescheduled_from_id`, 0061) |
| Call | AI | **Sofía · AI** · answered a call · ● Booked · 3 min, then the call's reason or summary, and "Open call" to the call page |

**Names.** One read per page: `users (clerk_user_id, name, email)` for the distinct person ids on the page, on the
**request client**, so RLS decides who may be named (§4). A name is `name ?? email` (the picker's rule,
`lib/assign/view.ts:68`); the viewer's own rows read **"You"**; an id with no readable row (a departed member, the
agency read by a client, a seed) reads **"Someone on the team"**. No service-role read is added to name anyone.
**The persona** is `voice_profiles.persona_name` (readable to members, `0019_voice_core.sql:39-42`), through
`aiAuthorMark` (`lib/voice/provenance.ts:12-15`), "Sofía" when there is none.

**The mark element.** `AuthorMark` (kit) generalises `AiAuthorMark` (`calls/ai-author-mark.tsx`): the same chip
tokens (`--chip-line`, `--chip-bg`, `--chip-text`), 999px pill, Label size, `data-author-mark={kind}`. The kind
is never colour alone: each label is a word.

## 7. Queries and performance

Each domain keeps its own `listContact<Thing>` and the record composes them (owner rule of this repo). Today the
page reads every note, To-do, deal, submission and message of the customer with no limit
(`activities.ts:17-24`, `:41-53`; `opportunities.ts:155-164`; `forms.ts:512-523`; `messaging.ts:735-754`). Part 1:

- **Timeline sources** gain an additive options argument `{ before?: RowCursor; limit?: number }`, ordering
  `(at desc, id desc)` and filtering `at <= before.v`; the composer drops rows at `before.v` whose id is not
  below `before.id`. With no options a function behaves exactly as today, so the drawer's `/summary` route
  (`summary/route.ts:60-74`) is unchanged. New: `listContactBookings` (booking.ts, with the calendar's name) and
  `listContactCalls` widened to the row's columns (`voice.ts:937-946` reads three). `listContactMessages` takes
  `channels: ['email','sms']`. Each source reads `limit + 1` (31); the merge keeps 30 and knows if there is an
  older page.
- **`listContactTimelinePage(db, accountId, contactId, before?)`** in `packages/db/src/record.ts` runs the seven
  in parallel, each wrapped so a failed source is reported (`failed: ['calls']`), never thrown, and returns
  `{ items, older: RowCursor | null, failed }`.
- **Facts** (`contactFacts`): exact head counts and one-row reads, never a list: bookings made
  (`rescheduled_from_id is null`), the newest `email`/`sms` message not `failed`/`bounced`, the newest call not
  `spam`, open deals (`count` plus `sum` over at most 100 open rows; past 100 the amount is left out rather than
  understated). Each fact is `number | null`, `null` meaning the read failed.
- **Next up** (`contactNextUp`): bookings `status = 'booked' and starts_at >= now()` ascending, limit 3; open
  To-dos with `due_at` ascending, limit 3; a head count of open To-dos with no `due_at`.
- **Header:** `getContact` (the authorisation), `listContactGroups` (`client-groups.ts:94-99`) for the main
  group, and `listContactPlaces` (`places.ts:113`) for Directions. Both header reads are soft: a failure logs and
  drops that line or that button, never the header.

Production held 53 contacts on 2026-09-24 (0050:58); no customer is near these caps, and the caps are what keep
the page's cost flat as one grows.

## 8. The kit and the registry

Kit files under `apps/web/src/components/record/` (owner: §15):

- **`RecordLayout`** — a container-query grid. Below 1024px of container width: one column in DOM order.
  From 1024px: three named areas, `who | happening | have`, `320px minmax(0,1fr) 280px` (today's tracks,
  `[contactId]/page.tsx:132`). The header spans all three.
- **`RecordHeader`** — §9.1.
- **`RecordCard`** — the one chrome: `rounded-xl border border-border bg-card glass`, title in UI 600 at
  13.5px (today's aside style, `[contactId]/page.tsx:178-187`), rows split by `--row-line` rules, never a box in
  a glass card. It replaces both `Card` (`components/ui/card.tsx`, `py-6 gap-6 px-6`) and the hand-written
  asides. Props: `id`, `title`, `collapsibleOnPhone`, `state` (`loading | ready | empty | error`), `onRetry`.
  On a phone a collapsible card is a disclosure button (`aria-expanded`, `aria-controls`) showing only the title,
  and its body is **not mounted until opened**, so a closed card fetches nothing and promises no count.
- **`RecordCardBoundary`** — a client error boundary per card; its fallback is that card's error state.
- **`AuthorMark`** and **`TimelineItem`** — the row grammar: mark · verb phrase · time, then the body.

**Registry** `apps/web/src/lib/record/record-cards.ts`: `RecordCardDef = { id; column: 'who' | 'happening' |
'have'; deskOrder; phoneOrder; collapsibleOnPhone; titleKey; Skeleton; render }`. Core cards:

| id | Column | Desk order | Phone order | Collapsed on phone | Source |
|---|---|---|---|---|---|
| `summary` | happening | 1 | 1 | no | new, server |
| `next-up` | happening | 2 | 2 | no | new, server |
| `timeline` | happening | 3 | 3 | no | rewritten `activity-timeline.tsx`, server, composer inside |
| `groups` | have | 1 | 4 | yes | `GroupsCard`, its own route |
| `properties` | have | 2 | 5 | yes | `PlacesCard`, its own route |
| `deals` | have | 3 | 6 | yes | today's Opportunities aside (`[contactId]/page.tsx:185-206`), server |
| `details` | who | 1 | 7 | no | `ContactFieldsPanel`'s first card |
| `tags` | who | 2 | 8 | no | `ContactFieldsPanel`'s second card |
| `related-people` | who | 3 | 9 | no | `RelationshipsCard`, its own route |

**Moving in unchanged.** `ContactFieldsPanel` loses its two `Card` wrappers (`contact-fields-panel.tsx:86-90`,
`:217-221`) and exports its two bodies; nothing inside changes. Groups, Properties and Related people render
their own headings today (`places-card.tsx:293`, `relationships-card.tsx:109`); each gains an additive
`headingHidden` prop that keeps the heading for `aria-labelledby` but makes it `sr-only`, so `RecordCard`'s
title is the one seen. Their reads, states, handlers and tests are untouched.

## 9. Screens

No hero (rule 11, a record page). Tokens only; both themes; the blur fallback; no hard-coded colour, radius or
shadow; nothing animates on scroll.

### 9.1 Header

Name as the page's `<h1>` (Display 600, 22px). Under it, muted, the main group: "{group} · Household" or
"{group} · Business", plain text (C7); none when they have no group. Then the actions, in this order on every
width: **Call** (primary, `href="tel:{e164 or digits}"`, `aria-label` "Call {name}"), **Text**, **Email**,
**Directions** (ghost). A "← Contacts" link back to the list sits above the name.

| Action | Shown when | Else |
|---|---|---|
| Call | `contact.phone` has digits | hidden |
| Text | `e164Of(contact.phone)` resolves **and** `smsGate.ok` **and** `composerStateLine(...)` is null (`lib/consent/composer-state.ts:43`): exactly when the composer's text form would open | hidden: the Texts row in "who they are" already says why |
| Email | `contact.email` is set (the email composer stays usable when the customer stopped email, `composer-state.ts:65-80`) | hidden |
| Directions | the first property in the card's order (`placesInOrder`) with a non-null `mapUrl` (`lib/contacts/place-view.ts:31`) | hidden |

Text and Email are links to `#compose-sms` and `#compose-email`. The composer opens on that channel and focuses
its body (it opens on Note today, `message-composer.tsx:53`; §15). Without JavaScript the link still scrolls to
the composer. On a phone the actions wrap to a row under the name with Call first, each at least 44px tall.

### 9.2 Summary (`summary`)

**Loaded:** one line of facts, each present only when known and non-zero, joined by " · ", in this order:

1. "On your list since {Mon YYYY}" — `contacts.created_at` in the account's zone. Always present.
2. "Booked {n} times" / "Booked once" (C8).
3. "Last talked {when} ({channel})" — the newest of a conversation message and a call; `{when}` counts calendar
   days in the account's zone ("today", "yesterday", "4 days ago", then the date past 30 days); `{channel}` is
   text, email or call.
4. "{n} open deals · {amount}" / "1 open deal · {amount}"; the amount left out when it is zero or past the cap.

A zero is left out (the line says what is true, not what is absent); a failed read is left out **and** the card
says so under the line: "Couldn't count {what}." naming each missing fact, with "Try again". So a missing fact
never reads as a zero (DESIGN.md, the weekly report: omitted, never zeroed). **Loading:** one skeleton line at
the fact line's height. **Empty:** cannot happen (fact 1 always holds). **Error** (the contact read itself is the
page's, so this is the counts failing together): "Couldn't load the summary." with "Try again".

### 9.3 Next up (`next-up`)

**Loaded:** up to three rows, soonest first, overdue To-dos first: a booking as "{Thu, Oct 16} · {10:00 AM} ·
{calendar}"; a To-do as its title and "Due {date}", or "● Overdue · was due {date}" (rule 3, `--warn`), or
"Due today". Under them, when there are undated open To-dos, "{n} more To-dos have no date." (C9). Rows are
read-only; Done stays on the timeline row. **Empty:** "Nothing coming up. Bookings ahead and To-dos with a due
date show here." with a ghost "Add a To-do" that focuses the timeline's To-do field. **Loading:** three
skeleton rows. **Error:** "Couldn't load what's next." with "Try again".

### 9.4 Timeline (`timeline`)

Top to bottom: the composer (moved from the card's foot, `activity-timeline.tsx:248-260`, so Text and Email land
on it), the add-To-do row, then the rows, newest first, under day separators in the account's zone (as today,
`:211-218`), then the pager. Each row: icon, `AuthorMark`, verb phrase, time (`formatDateTimeInZone`), then the
body (§6). Typed text keeps `lang=""` (C11). A call row links to its call page. Today's per-kind behaviour moves
over intact: the task holder picker and the hold hint (`:319-353`), the failure reason (`:388-393`).

**Pager:** "Older" when the merge found a 31st row, "Newer" back to the head when `?before=` is set; one pager,
at the foot. **Empty** (first page, no rows): "Texts, calls, bookings, notes and To-dos with this customer show
up here." The composer above it is the action. **Loading:** five skeleton rows shaped like a row (mark chip,
line, time). **Some sources failed:** the rows that loaded, and above them "Couldn't load {calls and bookings}.
Try again." **All failed:** "Couldn't load the activity." with "Try again".

### 9.5 What they have, and who they are

Groups, Properties and Deals in the right column; Details, Tags and Related people in the left, each in its
`RecordCard`, each with the states it already has. Deals keeps its rows and gains a dot on the status word
(C10) and a Spanish twin for its copy. **Phone:** the three "have" cards are closed disclosures under the
timeline; "who they are" follows, open.

### 9.6 Keyboard, language, themes

Tab order is DOM order (C6), with a skip link. Every control has a visible `:focus-visible` ring; disclosures
answer Enter and Space; Esc closes nothing new (no overlay here). The page resolves its locale with
`requestLocale({ account, isOperator, userLanguage })` (`lib/i18n/request-locale.ts:35`; added to
`request-locale-callers.test.ts`) and sets `lang` on the page root; client cards keep `useLocale()`. Every new
string goes through `t()` (`lib/i18n/t.ts:36`) with an `.es` twin. Names truncate with the full text in
`title`; the pseudo-locale's +35% wraps the header actions and the fact line, never clips them.

## 10. Copy (usted; trades Spanish; the ratchet freezes any key without a twin)

| Key | English | Español |
|---|---|---|
| `record.back` · `record.skipToDetails` | Contacts · Skip to details | Contactos · Ir a los datos |
| `record.group.household` · `.business` | {group} · Household · {group} · Business | {group} · Hogar · {group} · Negocio |
| `record.action.call` · `.callAria` | Call · Call {name} | Llamar · Llamar a {name} |
| `record.action.text` · `.email` · `.directions` | Text · Email · Directions | Mandar texto · Mandar correo · Cómo llegar |
| `record.card.summary` · `.nextUp` · `.activity` · `.deals` | Summary · Next up · Activity · Deals | Resumen · Lo que sigue · Actividad · Oportunidades |
| `record.card.retry` · `record.card.show` | Try again · Show {title} | Intentar de nuevo · Mostrar {title} |
| `record.facts.since` | On your list since {month} | En su lista desde {month} |
| `record.facts.booked` · `.bookedOne` | Booked {count} times · Booked once | Agendó {count} veces · Agendó una vez |
| `record.facts.lastTalked` | Last talked {when} ({channel}) | Última conversación {when} ({channel}) |
| `record.facts.channel.text` · `.email` · `.call` | text · email · call | texto · correo · llamada |
| `record.facts.openDeals` · `.openDealsOne` | {count} open deals · {amount} · 1 open deal · {amount} | {count} oportunidades abiertas · {amount} · 1 oportunidad abierta · {amount} |
| `record.facts.couldntCount` | Couldn't count {what}. | No se pudo contar: {what}. |
| `record.facts.what.bookings` · `.talked` · `.deals` | bookings · the last conversation · open deals | las citas · la última conversación · las oportunidades abiertas |
| `record.summary.failed` | Couldn't load the summary. | No se pudo cargar el resumen. |
| `record.nextUp.due` · `.dueToday` · `.overdue` | Due {date} · Due today · Overdue · was due {date} | Vence el {date} · Vence hoy · Atrasado · vencía el {date} |
| `record.nextUp.undated` · `.undatedOne` | {count} more To-dos have no date. · 1 more To-do has no date. | {count} pendientes más no tienen fecha. · 1 pendiente más no tiene fecha. |
| `record.nextUp.empty` · `.addTodo` | Nothing coming up. Bookings ahead and To-dos with a due date show here. · Add a To-do | No hay nada próximo. Aquí aparecen las citas que vienen y los pendientes con fecha. · Agregar un pendiente |
| `record.nextUp.failed` | Couldn't load what's next. | No se pudo cargar lo que sigue. |
| `timeline.note` · `.todo` · `.callbackTodo` | added a note · added a To-do · left a callback To-do | agregó una nota · agregó un pendiente · dejó un pendiente para devolver la llamada |
| `timeline.deal` | added a deal: {name} | agregó una oportunidad: {name} |
| `timeline.form` · `.chat` | sent the {form} form · took a request in the website chat | envió el formulario {form} · tomó una solicitud en el chat del sitio web |
| `timeline.texted` · `.emailed` | texted · emailed | mandó un texto · mandó un correo |
| `timeline.booked` · `.movedFrom` | booked {when} · Moved from {when} | agendó una cita para {when} · Se movió del {when} |
| `timeline.answeredCall` · `.openCall` · `.minutes` | answered a call · Open call · {count} min | contestó una llamada · Ver llamada · {count} min |
| `timeline.empty` | Texts, calls, bookings, notes and To-dos with this customer show up here. | Aquí aparecen los textos, llamadas, citas, notas y pendientes con este cliente. |
| `timeline.someFailed` · `.failed` | Couldn't load {what}. · Couldn't load the activity. | No se pudo cargar: {what}. · No se pudo cargar la actividad. |
| `timeline.what.calls` · `.bookings` · `.messages` · `.notes` · `.todos` · `.deals` · `.forms` | calls · bookings · texts and emails · notes · To-dos · deals · forms | llamadas · citas · textos y correos · notas · pendientes · oportunidades · formularios |
| `timeline.older` · `.newer` | Older · Newer | Anteriores · Más recientes |
| `provenance.customer` · `.automation` · `.import` · `.you` | Customer · Automation · Import · You | Cliente · Automatización · Importación · Usted |
| `booking.status.booked` · `.completed` · `.cancelled` · `.no_show` | Booked · Done · Cancelled · No-show | Agendada · Terminada · Cancelada · No llegó |

Reused with their twins: `provenance.ai` (`messages.ts:2401-2402`), `assign.someone` (`:3340-3341`). Existing keys
the Spanish page needs twins for, under their owners' namespaces (§15): `calls.outcome.*`
(`messages.ts:2314-2323`; Agendó, Cliente potencial, Mensaje, Colgó, Spam, Transferida), `conversations.status.*`
(via `MESSAGE_STATUS_LABEL`, `lib/labels.ts:21-28`; En cola, Enviado, Entregado, Abierto, Rebotó, No se envió),
`pipeline.status.*` (`messages.ts:645-647`; Abierta, Ganada, Perdida — mine), `contact.opportunities`,
`contact.noOpportunities` (mine). Typed text (a note, a text, a form answer) shows as typed, never translated.

## 11. Errors

No new write action: the header's actions write nothing, and every existing action keeps its own errors and
Undo. A failed card read logs with `loggableError` naming the card and the account, never the customer's data.
A `?before=` that does not parse is a cold start (`lib/cursor.ts`, total parsers). A person id with no readable
`users` row is "Someone on the team", never an error. The page 404s exactly as today when the contact is not the
caller's to see, before any other read, and the consent display reads still use the ledger client only after
`getContact` proved the contact (`[contactId]/page.tsx:49-56`, pinned by `page.test.ts:372-419`).

## 12. Testing (every test can fail on wrong code; each names its probe)

- **Schema** `packages/db/src/test/record-provenance-schema.test.ts` (`withRollback`, the local PG18 replica
  first): a signed-in To-do and deal store the caller's `sub`, a client-sent `created_by` is discarded, the service
  role stores NULL (probe: drop each trigger); a signed-in UPDATE of `tasks.created_by` keeps the old value
  (probe: drop `keep_created_by`); a note's sent `author_id` is replaced by the `sub` and an update cannot change
  it (probe: drop the guard → the forged id persists → FAILS); `author_kind = 'robot'` 23514 on each table;
  `author_id` with `author_kind = 'ai'` 23514; a submission `author_kind = 'automation'` 23514. **Backfill:**
  seeded rows and events in every bucket of §5.3's table land in the stated kind, a second run changes nothing
  (probe: map an outbound `system` event to `customer` → FAILS).
- **Parity** `packages/db/src/test/provenance-parity.test.ts`: for every `(actor_type, actor_id class,
  direction)` combination the SQL CASE and `messageAuthor`/`bookingAuthor` give the same kind (the dedupe-keys
  parity pattern, 0033/0034).
- **Queries** `packages/db/src/test/record.test.ts` (`withTestAccount`, live): the merged page orders across
  sources by `(at, id)`; two rows at the same instant on a page boundary are neither lost nor repeated (probe:
  compare `at` only → FAILS); `form` and `voice` messages are absent (probe: drop the channel filter); a source
  that errors is reported in `failed` and the rest return; facts count bookings made, not reschedules (probe:
  drop the `rescheduled_from_id` filter); open deals over the cap omit the amount; Next up's three, its overdue
  order and its undated count; a Technician's client reads their customer's whole page and 0 rows of another's.
- **Web, pure:** `record-facts.test.ts` (a zero omitted; a `null` omitted AND named in "Couldn't count"; "since"
  in the account's zone on Dec 31 at 11:30 PM Chicago, probe: format in UTC → January → FAILS; "yesterday" by
  calendar day, probe: 24-hour arithmetic → FAILS); `next-up.test.ts` (overdue first, cap three, undated counted
  never listed, today in the zone); `author-mark.test.ts` (each row kind × each source; every output's `kind`
  is one of the five, probe: return "system" for a seed → FAILS by type and by the enumeration; "You" only for
  the viewer; an unreadable id is "Someone on the team"); `record-cards.test.ts` (ids unique; phone order is
  exactly D6's sequence, probe: swap timeline and summary → FAILS; every card has a skeleton and a title key);
  `header-actions.test.ts` (each action's shown/hidden row of §9.1; Call is the only primary, probe: make Text
  primary → FAILS).
- **Each card failing alone** `[contactId]/page.test.ts` (extended): for each server card, a loader that fails
  renders that card's error copy while every other card's content is present (probe: let the summary loader
  throw instead of returning `error` → the page render rejects → FAILS); a render throw inside one card is caught
  by its `RecordCardBoundary` (probe: remove the boundary → FAILS). The existing ledger-client and Assigned-to pins
  carry over unchanged.
- **Kit:** `record-card.test.ts` (a closed phone card mounts no body and fetches nothing; `aria-expanded`
  toggles). The ratchet, the accents guard and `INTERNAL_MILESTONE` over the new keys.
- **e2e** `record-page.spec.ts` (bis-e2e-qa runs it; per-run fixture account, never Test Client One; names in
  `e2e/fixtures/fixture-names.test.ts`; rows removed in `afterAll`): at 1280px the three columns hold their
  cards; at 390px the order is header, summary, Next up, timeline, then the closed "have" cards, then details;
  Call is present and the only primary; a customer with no email has no Email; with no property address no
  Directions; a seeded booking made by the booking page reads "Customer · booked …" and a seeded receptionist
  call reads "Sofía · AI · answered a call"; Text lands on the text composer; with `users.language` Spanish
  (reset after) the page reads "Llamar", "Lo que sigue", "Cliente". `contact-detail.spec.ts` stays read-only on
  Test Client One and is updated for the moved composer. The record page is added to `i18n-overflow.spec.ts`.

## 13. Rollout, deploy order and rollback

1. **Measure first** (read-only, bis-ci then production): per table, how many rows each §5.3 bucket would take,
   the outbound-message residue (Q2) above all.
2. **0073** on bis-ci (`ci-project-setup.yml`), production, parity, **before merge**: columns nullable, triggers,
   backfill. Safe under the running build: the triggers only fill columns it never sends, and nullable columns
   accept its inserts.
3. **Merge and deploy** the app, which writes `author_kind` on every message and booking.
4. **Follow-up, 0073's second file** (`0074_record_provenance_not_null.sql`, or the next free number then):
   re-run the idempotent backfill for rows the old build wrote in the window, then `set not null` on
   `messages.author_kind` and `bookings.author_kind`. Same order: bis-ci, production, parity.

**App before migration:** `createMessage` writing a missing column fails every send (assumed PGRST204): the order
is not optional, and the e2e job's migration check enforces it on bis-ci. **Rollback:** revert the app; 0073's
columns and triggers are harmless to the old build. After step 4, roll back by `alter column … drop not null`
first, then revert. Served-HTML marker: the "Next up" card title on a contact page. On for every account; never
shown to customers.

## 14. Effort and open risks

Effort: about 3–4 engineer-weeks, inside item 3's 6–9 (`crm-features.md:1264-1267`): the kit and registry about
1, the timeline rewrite with provenance and paging about 1.5, facts, Next up and the header about 0.5–1, tests
and e2e the rest.

- **Two primaries on the page.** Call is the header's primary and the composer's Send is its card's
  (`message-composer.tsx:184-189`, `variant="default"`). Rule 8's 2026-09-23 text forbids "a page-level primary
  sitting above cards that each have their own". This spec reads the header as its own view (one decision:
  reach them; it writes nothing, so it cannot write what Send writes, the rule's own test), but the sentence is
  literal. **Q1.**
- **Historical marks are only as good as the events.** Messages and bookings before 0073 take their author from
  `events`; a row whose event failed takes §5.3's default. The counts are measured in §13 step 1, not assumed.
- **"Someone on the team" for a client reading an agency person's note.** RLS hides the agency's `users` row from
  client roles (`0066:108-109`); the mark is honest but anonymous. **Q4.**
- **A departed member.** A departed member's notes read "Someone on the team" once their membership goes,
  because naming rides on `users_member_read`. Accepted: what a past member wrote stays, unnamed.
- **The fields panel stays English** inside a Spanish page until it is translated (**Q5**); the ratchet keeps its
  count from growing.
- **The cursor across seven tables** relies on `(at, id)` being a total order; uuids from different tables could
  collide only by astronomically small chance. Pinned by the boundary test.
- **The drawer and the page now differ**: the drawer's recent list still includes `form` and `voice` copies and
  has no marks until part 3.

## 15. Needs from other agents (through the orchestrator)

- **bis-db-schema:** migration 0073 and its follow-up (§5, §13); the schema and parity tests.
- **bis-comms:** `createMessage` writing `author_kind`/`author_id` via `messageAuthor` (`messaging.ts:129-145`);
  `listContactMessages` taking `channels` and the cursor options (`:735-754`); `MessageComposer` opening on the
  channel named by `#compose-sms`/`#compose-email` and focusing its body (`message-composer.tsx:53`); `.es`
  twins for `conversations.status.*`.
- **bis-booking:** `createBooking`/`moveBooking` writing `author_kind` via `bookingAuthor`; `listContactBookings`;
  `booking.status.*` copy if it belongs in `calendar.bookings.status.*` instead (`messages.ts:1587` has the
  English `no_show`).
- **bis-voice:** `listContactCalls` widened with the cursor options (`voice.ts:937-946`); `.es` twins for
  `calls.outcome.*`; `AiAuthorMark` folded into the kit's `AuthorMark` (or kept and wrapped).
- **bis-automations:** the web chat's `createSubmission` call passing `author_kind: 'ai'` (`lead.ts:151-154`).
- **bis-frontend:** ownership of `components/record/*` (the kit) or a ruling that bis-crm owns it; the
  `/styleguide` entries (`app/(dashboard)/dashboard/styleguide/page.tsx`): `RecordLayout` at both widths,
  `RecordHeader` with all and with no actions, `RecordCard` in loading, ready, empty, error and closed-on-phone,
  `AuthorMark` in all five kinds, `TimelineItem`.
- **Orchestrator:** `crm-features.md:801` and `:805` still list the timeline's zone and status defects as open;
  both are fixed (D-010 in `9bf19e0b`, `activity-timeline.tsx:211-218` and `contacts-table.tsx:294`; D-014 in
  `752c070f`, `activity-timeline.tsx:376-386`). Mark them shipped. `:2623`'s "draws dates in the server's zone"
  and "prints raw statuses" are stale for the same reason.

## 16. Owner questions (each with a recommendation)

1. **Rule 8: may the header's Call be primary while the composer's Send is primary in its card?** Recommend
   **yes**, and add to rule 8: "A record page's header is its own view: its one primary (Call) writes nothing,
   so the cards below keep their own." The alternative, a ghost Send, weakens the only button that texts a
   customer.
2. **An outbound message whose author left no trace** (§5.3). Recommend **"Someone on the team"**: a person of
   the business is accountable for what left its number, and an "Automation" mark would send the owner looking
   for a rule that may not exist. Moot if §13 step 1 measures zero.
3. **"Someone on the team" as the person mark when we cannot name them** (departed members, seeds, the agency
   read by a client). Recommend **yes**, and add to DESIGN.md's Provenance: "a person we cannot name reads
   'Someone on the team'; it is still the person mark".
4. **Should a client see the agency person's name** on what the agency wrote? Recommend **not in part 1**: no
   service-role read to name people past RLS. Revisit with F-136 (the agency's own top level).
5. **Translate the "who they are" fields panel** in part 1, against D2's "unchanged"? Recommend **no**: translate
   it in part 3, which rebuilds the drawer that shares it, so one pass covers both.
6. **Directions with several addressed properties.** Recommend **the first in the Properties card's order**
   (theirs first, then their main group's); each property's own "Open map" covers the rest.
7. **"Booked 3 times" counts a booking later cancelled**, as the dashboard and the Monday report do (D-035).
   Recommend **yes**, for one meaning of "bookings" everywhere; the timeline shows each one's state.
8. **Dropping the inbox copies from the timeline** loses the separate "Booking cancelled" line a customer's
   cancel link writes (`b/[publicId]/cancel/[token]/actions.ts:119-122`); the booking row still reads
   "● Cancelled". Recommend **yes**; who cancelled becomes a booking column when a staff booking path arrives.
9. **DESIGN.md and the phone order.** No amendment is needed: the Record page section fixes the desk's three
   columns only, and amendment 6 (`crm-features.md:2853`, still proposed) is about the drawer, which part 1
   does not touch. Recommend recording D6 as one sentence in the Record page section when this ships: "On a
   phone it is one column: the header with Call first, the summary and what is next, the timeline, what they
   have (closed), then who they are."
