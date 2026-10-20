# Sofía's live acts, visible and reversible, PR 8c (F-022, first release item 8, migration 0091): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **Ceremony is tiered PER TASK** (owner, 2026-10-19, binding): read each task's tier before dispatching it.

**Goal:** every act Sofía or the web chat takes live gets one `ai_acts` row. On the customer's record timeline that row reads "Sofía · AI", says what she did, from which call or chat, and when. It carries a ghost Undo while undoing is still safe, a reason line once it is not, and "Undone by …" once undone. Contacts get a created-by mark (`contacts.author_kind`/`author_id`), backfilled. Every booking change Sofía makes reaches the business. Decision 19's wording gains its dated amendment (D1).

**Architecture:**
- Migration 0091 holds:
  - the table, its RLS and its immutability trigger;
  - the contact author columns, their guard and their backfill;
  - three SQL functions, so that each still-safe check and its write run in ONE transaction: the booking undo, the contact-created check, and the contact-created delete.
- `@bis/db` holds:
  - the pure act model, in `@bis/db/ai-act-rules`;
  - the reads and writes, in `ai-acts.ts`;
  - the timeline source `ai_acts`.
- Web holds:
  - a never-throwing `recordAct` at every live call site;
  - an act-kind registry (describe, still-safe from one batched fact read, undo), mirroring 8b's suggestion kinds;
  - one server action;
  - the timeline row with its Undo controls.

**Spec:** `docs/superpowers/specs/2026-10-19-ai-acts-reversible-design.md` at `53fc2dec`. D1–D5 are owner-approved and not reopened. Call-site lines below were read at `48c5ba33`; they are unchanged on the 8b-2 branch (`git diff --stat 48c5ba33 feat/item8b2-work-tray` touches none of them). Record-page lines were read on `feat/item8b2-work-tray` at `bb568105`. **Task 0 re-reads every file:line after merging `main`.**

**Base:** `feat/item8c-ai-acts` at `53fc2dec` (from `48c5ba33`). It **depends on 8b-2** (`feat/item8b2-work-tray`, migrations 0089 and 0090, merging after 2026-10-20T05:35:46Z): the record timeline's `sources` counting, the `suggestion` timeline kind and the flat-row kit are 8b-2's.
- `<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s15-8c` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s15-8c`).
- `<SCRATCH>` = the orchestrator's session scratchpad. Each brief carries it literally.
- `<KIT8B1>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/8a8a7081-d1c5-4710-8a6f-a94d0f61efd1/scratchpad/s15c-kit` (`replica.sh`, `pgrst.sh`; read 2026-10-19).

Path abbreviations:
- `…/[contactId]/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/`
- `…/contacts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`
- `…/calendar/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/`
- `…/styleguide/` = `apps/web/src/app/(dashboard)/dashboard/styleguide/`

---

## Tiers (binding, per task)

| Task | What | Tier | Owner | Review |
|---|---|---|---|---|
| 0 | Merge `main` after 8b-2, install, re-read, read-only project reads (orchestrator) | — | orchestrator | — |
| 1 | Migration 0091 and its proof, `contactAuthor` and its parity test | **HIGH** | bis-db-schema (opus) | opus review with mutation probes on the replica, re-review on any change; orchestrator applies once |
| 2 | Every new key, English and Spanish | LOW | bis-crm | none |
| 3 | `@bis/db`: the act model, the reads and writes, the timeline source, contact authors on every writer, the fill report | MEDIUM | bis-crm | one review (sonnet) |
| 4 | Every live call site records its act; §7's notice check | MEDIUM | bis-voice | one review (sonnet) |
| 5 | The act-kind registry, the facts read, the views, the undo action (bookings, fields, **contact deletion**), the customer notice, loaders and timeline rows | **HIGH** | bis-crm (opus) | opus review with mutation probes, re-review on change |
| 6 | The UI: the timeline row and its three Undo controls, the "Added by" fact, styleguide, i18n baselines | LOW | bis-frontend | none |
| 7 | The e2e spec | LOW | bis-e2e-qa | none |
| 8 | Decision 19's dated wording amendment in `docs/crm-features.md` | LOW | bis-crm | none |
| 9 | Whole-branch final review, design review, ONE fix agent | — | bis-reviewer (opus), bis-design-reviewer (opus), one fixer | checkpoint |
| 10 | Rollout | — | orchestrator | — |

Why Task 4 is MEDIUM, not HIGH: `recordAct` never throws and is awaited inside the site's existing best-effort shape, so the live call path's failure behaviour does not change. Task 4's reviewer must PROVE that, site by site (a throwing `recordAct` leaves every tool result and every `finishCall` leg byte-identical). If the review finds a site where it does not hold, the orchestrator re-tiers that fix HIGH.

**Order:**
- **Wave A** (in parallel): Tasks 1, 2 and 8. They share no file.
- **Wave B:** Task 3, after Tasks 1 and 2. It needs 0091 on its replica and `timeline.what.aiActs` in the catalogue.
- **Wave C** (in parallel, after Task 3): Tasks 4 and 5. They share no file.
  - Task 4: `lib/voice/*`, `lib/forms/enrich.ts`, `lib/concierge/lead.ts`, `api/voice/texml/handoff-result/route.ts`, `lib/ai-acts/record.ts`.
  - Task 5: `lib/ai-acts/{kinds,facts,view,actions,notify,undo-handlers}*`, `lib/record/*`, `lib/consent/classes.ts`.
- **Wave D:** Task 6 after Task 5, then Task 7.
- **Then:** Task 9, then Task 10.
- The orchestrator pushes after Task 1's review, so CI `verify` applies 0091 on PostgreSQL 17 early. It applies 0091 to bis-ci then (Task 10 step 1), so the PR's `e2e` migration check can go green.

---

## File map

| File | Task | Change |
|---|---|---|
| `packages/db/supabase/migrations/0091_ai_acts.sql` | 1 | new |
| `packages/db/src/test/ai-acts-schema.test.ts` | 1 | new: RLS, grants, trigger, pairs, cascades, the three functions |
| `packages/db/src/test/contact-authors.test.ts` | 1 | new: the columns, the guard, the backfill buckets |
| `packages/db/src/provenance.ts` (+ `test/provenance-parity.test.ts`) | 1 | `contactAuthor`, and its parity with `app.contact_author` |
| `packages/db/src/account-teardown.ts` (`ACCOUNT_OWNED_TABLES`), `test/technician-scope.test.ts` (`PER_CONTACT`), `test/server-only-writes-grants.test.ts`, `test/schema-grants-guard.test.ts` if it lists tables | 1 | `ai_acts` added beside `proposals` |
| `apps/web/src/lib/messages.ts` (+ one `describe` in `messages.test.ts`) | 2 | new keys |
| `packages/db/src/ai-act-rules.ts` (new; `package.json` `exports` gains `"./ai-act-rules"`) | 3 | the pure model |
| `packages/db/src/ai-acts.ts` (new), `packages/db/src/index.ts` | 3 | reads, writes and RPC wrappers |
| `packages/db/src/contacts.ts` | 3 | `COLS` (`:63-64`) gains `author_kind, author_id`; `CreateContactInput.author?`; `createContact` (`:415-484`) writes the author; `fillContactBlanksReport` (`:584-648`) returns `prior` and `written`; new `restoreContactFieldIf`; new `lastFieldEditor` |
| `packages/db/src/contact-import.ts:176`, `packages/db/src/demo/seed.ts:437-440`, `packages/db/src/ci-seed/seed.ts:213-215` | 3 | the import passes `author: import`; the two seeds are mapped by `contactAuthor` (no edit needed unless Task 0's answer differs; see owner question Q1) |
| `packages/db/src/record.ts` (8b-2: `:274`, `:277`, `:322-348`, `:424-511`, `:514-520`) | 3 | source `ai_acts`, entry kind `aiAct`, `opts.aiActs` |
| `packages/db/src/test/ai-acts.test.ts` (new), `test/contacts*.test.ts` touched cases, the `listTimelinePage` test file | 3 | cases |
| exhaustive maps over `TimelineEntry`: `apps/web/src/lib/record/author-mark.ts:26-77`, `timeline-rows.ts:51` (`SOURCE_KEY`) and `:111` (`phrase`), `recent-rows.ts:58`, `apps/web/src/lib/contacts/drawer-summary.ts:57`, `…/contacts/contact-drawer.tsx:69`, `…/groups/[groupId]/group-timeline.tsx:215`, `…/[contactId]/activity-timeline.tsx:283` | 3 | type-only cases (the activity timeline gets a plain row; Task 6 gives it its Undo) |
| `apps/web/src/lib/ai-acts/record.ts` (+ test) | 4 | new: `recordAct` |
| `apps/web/src/lib/voice/tools/registry.ts`, `finish-call.ts`, `textback.ts`, `apps/web/src/lib/forms/enrich.ts`, `apps/web/src/lib/concierge/lead.ts`, `apps/web/src/app/api/voice/texml/handoff-result/route.ts`, and their tests | 4 | call sites; §7 |
| `apps/web/src/lib/ai-acts/kinds/*.ts`, `facts.ts`, `view.ts`, `actions.ts`, `notify.ts`, `undo-handlers.ts` (+ tests, + `actions.live.test.ts`) | 5 | new |
| `apps/web/src/lib/proposals/kinds/contact-field.ts:20-43` | 5 | export `storedForm`, `isBlankOn`, `stillAsWritten` (no behaviour change) |
| `apps/web/src/lib/consent/classes.ts:81-110` (+ `classes.test.ts`, and every exhaustive switch over `EmailClass`) | 5 | the class `transactional` and its one kind `booking.undo_notice` (owner answer Q2) |
| `apps/web/src/lib/record/loaders.ts` (8b-2 `:51-98`), `timeline-rows.ts`, `author-mark.ts` | 5 | `aiActs: true`, the facts read, the undoers' names, the row's view |
| `apps/web/src/components/ai-acts/act-undo.tsx` (new, `"use client"`), `act-row.tsx` (new) | 6 | the controls |
| `…/[contactId]/activity-timeline.tsx`, `…/[contactId]/page.tsx`, `apps/web/src/lib/record/record-facts.ts` (`factsView`) | 6 | the row, the "Added by" fact |
| `…/styleguide/page.tsx`, `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` | 6 | |
| `apps/web/e2e/ai-acts.spec.ts` | 7 | new |
| `docs/crm-features.md` (`:142`, `:842`, `:942`, `:3028`, `:3080-3112`) | 8 | the dated amendment |

**Not touched:**
- The contact drawer's reads and the group page's reads (spec §3 Out). Neither passes `aiActs`. `route.reads.test.ts:72` (`MEASURED = 31`) must pass **unchanged**. Their kind maps change by type-only entries only.
- `undoOperatorCancel` (`packages/db/src/booking.ts:463-512`) is NOT loosened (spec §6). An AI cancel's restore is `undo_ai_booking_act`.
- `deleteContacts` (`contacts.ts:1086-1141`) is unchanged; see ambiguity B.

---

## The model (every task reads this; names are binding)

### `ai_acts` (0091)

| Column | Type and rule |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `account_id` | `uuid not null references public.accounts(id) on delete cascade`, as `0088_proposals.sql:85` |
| `actor` | `text not null check (actor in ('voice','webchat'))` |
| `call_id` | `uuid`, FK `(account_id, call_id)` → `calls(account_id, id)` on delete cascade |
| `chat_id` | `uuid`, FK `(account_id, chat_id)` → `concierge_conversations(account_id, id)` on delete cascade; 0091 adds `concierge_conversations_account_id_id_key unique (account_id, id)` (the `0082_inbound_email.sql:55` precedent) |
| `contact_id` | `uuid not null`, FK `(account_id, contact_id)` → `contacts(account_id, id)` on delete cascade |
| `kind` | `text not null check (kind in ('booking_created','booking_rescheduled','booking_cancelled','contact_created','contact_field_filled'))` |
| `target`, `before`, `after` | `jsonb`; `target not null` |
| `undone_at`, `undone_by` | `timestamptz`, `text`; `ai_acts_undone_pair check ((undone_at is null) = (undone_by is null))` |
| `undo_notified` | `boolean not null default false`; `ai_acts_notified_when_undone check (not undo_notified or undone_at is not null)` |
| `created_at` | `timestamptz not null default now()` |

Further rules:
- `ai_acts_source check ((actor = 'voice') = (call_id is not null) and (actor = 'webchat') = (chat_id is not null))`.
- Trigger `ai_acts_act_is_fixed` (the `0088_proposals.sql:125-141` shape): every column except `undone_at`, `undone_by` and `undo_notified` is immutable.
- Index `ai_acts_contact_timeline (account_id, contact_id, created_at desc, id desc)`. No `target` index: every still-safe read goes by the act's id or by booking id (the spec's "as the plan needs" needs none).
- RLS: the two policies of `0088_proposals.sql:181-187`, renamed `ai_acts_member_read` and `ai_acts_technician_scope`. `revoke all … from anon, authenticated`; `grant select … to authenticated`; `grant select, insert, update, delete … to service_role`.

### The act data (in `@bis/db/ai-act-rules`, the `proposal-rules` shape)

```ts
export const AI_ACT_KINDS = ["booking_created", "booking_rescheduled", "booking_cancelled", "contact_created", "contact_field_filled"] as const;
export type AiActKind = (typeof AI_ACT_KINDS)[number];
export type AiActActor = "voice" | "webchat";
type Slot = { startsAt: string; endsAt: string };
export type AiActData =
  | { kind: "booking_created"; target: { bookingId: string }; before: null; after: Slot }
  | { kind: "booking_rescheduled"; target: { bookingId: string; fromBookingId: string }; before: Slot & { version: string }; after: Slot }
  | { kind: "booking_cancelled"; target: { bookingId: string }; before: Slot; after: { version: string } }
  | { kind: "contact_created"; target: { messageId?: string; submissionId?: string }; before: null; after: null }
  | { kind: "contact_field_filled"; target: { field: ContactFieldName }; before: { value: string | null }; after: { value: string } };
export type NewAiAct = AiActData & { actor: AiActActor; callId: string | null; chatId: string | null; contactId: string };
export type AiAct = NewAiAct & { id: string; accountId: string; createdAt: string; undoneAt: string | null; undoneBy: string | null; undoNotified: boolean };
export function parseAiAct(row: unknown): AiAct | null; // kind by kind; null when any part does not parse
```

- `version` is `setBookingStatus`'s returned `updatedAt` (`booking.ts:383-434`), i.e. the cancel's own `updated_at`. It is the compare-and-swap key, as `undoOperatorCancel`'s `version` is.
- `target.messageId` and `target.submissionId` are set only for a web-chat contact:
  - `messageId` is the thread message `enrich` writes (`enrich.ts:179-182`), the one non-AI-authored message the delete may treat as hers;
  - `submissionId` is the submission `enrich` was called with (its third argument), the one submission that is hers.
  - Storing the submission id means `ai_contact_held_by` never reads `concierge_conversations`, which `authenticated` cannot SELECT (review I-1).
- `ContactFieldName` comes from `@bis/db/proposal-rules`.

### The three SQL functions (0091; every one `set search_path = ''`, every name schema-qualified)

1. **`public.undo_ai_booking_act(p_account_id uuid, p_act_id uuid, p_by text, p_now timestamptz) returns text`**
   - `security invoker`; execute for `service_role` only.
   - It locks the act row `for update`. It answers `gone` (no row in the account) or `already_undone`, and raises `22023` on a non-booking kind.
   - Then, per kind, a compare-and-swap:
     - **`booking_created`**: `update bookings set status = 'cancelled', updated_at = p_now where account_id, id = target.bookingId, status = 'booked', starts_at > p_now`. On zero rows it reads the booking: `gone`, `already_cancelled` (not booked) or `already_happened`.
     - **`booking_cancelled`**: inside `begin … exception when exclusion_violation then return 'time_taken'; end`: `update … set status = 'booked', updated_at = p_now where … status = 'cancelled' and updated_at = (after ->> 'version')::timestamptz and starts_at > p_now and not exists (select 1 from bookings r where r.account_id = p_account_id and r.rescheduled_from_id = <id>)`. On zero rows: `rebooked` (status booked), `time_passed`, or `changed`.
       - If the customer has booked another time separately since, the restore would leave them with two bookings. The DISPLAY shows `aiActs.reason.otherBooking` instead of an Undo (Task 5). The function does not refuse it, because a person may want both and the display has already said so (review minor).
     - **`booking_rescheduled`**: one inner block.
       1. It **deletes** the NEW booking: `delete from bookings where account_id, id = target.bookingId, status = 'booked', starts_at > p_now and not exists (… rescheduled_from_id = <new id>)`. Zero rows: `raise exception using errcode = 'ZA001'` (new booking changed).
       2. It restores the OLD one (`status = 'cancelled'`, `updated_at = before.version`, `starts_at > p_now`). Zero rows: `raise exception using errcode = 'ZA002'` (old booking changed).
       3. The handler maps by SQLSTATE, never by message text: `when exclusion_violation` → `old_time_taken`; `when sqlstate 'ZA001'` → `changed`; `when sqlstate 'ZA002'` → `changed`. Class `ZA` is unused by PostgreSQL. The exception rolls the inner block back, so the new booking is never gone without the old one restored.
       - **Why delete, not cancel** (review I-4; `booking.ts:676-683` names this hazard): a cancelled new row would still carry `rescheduled_from_id` = the old booking. `bookingWasMoved(old)` would then read true, and `undoOperatorCancel` would refuse a later Undo on the old booking as `rescheduled` (`booking.ts:466-469`). Nulling the link instead would make the row count as a separate booking made, because the bookings counts filter on `rescheduled_from_id is null` with no status filter (`booking.ts:969`, `:996`). Deleting is `moveBooking`'s own take-back (`:678-681`). `calls.booking_id` on the rescheduling call goes null by its FK (`0019_voice_core.sql:50`, on delete set null); the call's outcome word is unchanged.
       - **Assumption A6 (check in Task 1 case 8 and Task 5's notice test):** the restored old booking's `.ics` reuses the chain's UID with a SEQUENCE (`lib/booking/ics.ts:16-28`). After the undo, the customer's calendar app may hold the new time at a higher SEQUENCE than the email we send for the old time. The notice must build its `.ics` with a SEQUENCE greater than the deleted row's, or say plainly that the restored time is not offered as a calendar file. Task 5 reads how `calendarFileUrl` computes SEQUENCE and picks one; it STOPS if neither is possible.
   - Then `update ai_acts set undone_at = p_now, undone_by = p_by where id = p_act_id`, and it answers `undone`.
   - Events stay the TypeScript wrapper's (Task 3).
2. **`public.ai_contact_held_by(p_account_id uuid, p_act_id uuid) returns text[]`**
   - `stable security invoker`; execute for `authenticated` and `service_role`.
   - It answers the names of the tables holding anything that is NOT Sofía's own call or chat for that act's contact. Empty means the contact is safe to delete. An act that is not `contact_created`, or is missing, raises `22023`.
   - **Table by table**, against every FK that references `public.contacts` (read off the migrations 2026-10-19 after 0090; Task 1 re-reads `pg_constraint`):

     | Table (FK) | Counts as hers | Otherwise |
     |---|---|---|
     | `calls` (set null) | `id = act.call_id` | `'calls'` |
     | `tasks` (cascade) | `call_id = act.call_id` AND `completed_at is null` AND `assigned_to is null` AND no `task.*` event with `actor_type = 'user'` names its id (`payload ->> 'taskId'`; the events `activities.ts:114`, `:141`, `:201`, `:216` and `assignment.ts:277` carry only `{taskId}`). A callback To-do a person completed, reopened or assigned is theirs, not hers (review I-2) | `'tasks'` |
     | `conversations` (no action) and their `messages` | a message with `author_kind = 'ai'`, or `id::text = act.target ->> 'messageId'` | `'messages'` |
     | `inbound_emails` on those conversations | never | `'inbound_emails'` |
     | `form_submissions` (set null) | `id::text = act.target ->> 'submissionId'` (no read of `concierge_conversations`, which `authenticated` cannot SELECT; review I-1) | `'form_submissions'` |
     | `automation_log` (set null) | `source = 'textback' and subject_key = 'call:' \|\| act.call_id and status in ('sent', 'skipped', 'failed')`. A `held` text-back (`textback.ts:249-251`, released by `:440-470` with the payload's `contactId`) is NOT hers: it blocks until it resolves (review I-3) | `'automation_log'` |
     | `ai_acts` (cascade) | same `call_id` or same `chat_id` as the act | `'ai_acts'` |
     | `proposals` (cascade) | `call_id = act.call_id` AND `status in ('pending', 'expired')`. One a person accepted, edited or dismissed is theirs (review I-2) | `'proposals'` |
     | `bookings` (restrict) | never. **Owner Q4: a contact with any booking stays**, and the reason is its own (`'bookings'` → `aiActs.reason.hasBooking`) | `'bookings'` |
     | `opportunities` (restrict), `notes`, `contact_tags`, `documents` (no action), `document_requests`, `document_requirement_skips`, `places`, `contact_relationships` (either column), `client_group_members`, `consent_events` (set null) | never | the table's name |
     | `contact_duplicate_flags`, `record_summaries` (cascade) | always (a duplicate pair and a generated summary are not activity) | — |
     | `public.events`, not an FK | an event whose `actor_type <> 'user'` | `'edits'`: any `payload ->> 'contactId' = <contact>` event with `actor_type = 'user'` (a person edited, assigned, tagged or re-languaged it) |

     **Why held text-backs block rather than get skipped inside the delete (I-3):** marking a queued customer text `skipped` from inside a deletion silently cancels a message. Blocking keeps the deletion's one job, deleting. The block lifts on its own once the release pass sends or skips the text, at most by the next 08:00. A deletion that went through would instead leave the release throwing on a missing contact every tick.

     **The `edits` rule is a backstop, not the safety net (review minor):**
     - Some person-made events name the contact under another key (bulk events carry `contactIds`), and some carry no contact at all.
     - The safety net is the table-by-table list: every write a person makes ON the record lands in one of those tables, and each blocks.
     - `edits` catches the field-only writes (a name changed, the language set) that leave no row elsewhere.
     - **Accepted in writing:** the milliseconds between a person's write and its `emit`. A field edit whose event has not landed when statement 2 runs is not seen as an edit. The contact row is locked from statement 1, so the edit itself either committed before the lock (and its event follows within that request) or waits behind the delete and then fails.
3. **`public.undo_ai_contact_created(p_account_id uuid, p_act_id uuid) returns text`**
   - `security invoker`; execute for `service_role` only. It answers `deleted`, `has_activity`, `has_booking` or `gone`.
   - **Statement 1** locks: `perform 1 from contacts where account_id = p_account_id and id = <contact> for update`, then the same for that contact's `conversations`. A concurrent FK insert holds `FOR KEY SHARE`, so it waits or is waited on. This is `0083_inbound_never_log.sql:92-96`'s lock-then-fresh-snapshot shape.
   - **Statement 2**, a fresh snapshot: `public.ai_contact_held_by(...)`. Non-empty answers `has_activity`.
   - **Statement 3** deletes that contact's messages, then its conversations, then the contact. Its tasks, proposals, acts (this one included), duplicate flags and summaries cascade. Every task and proposal left at this point is an untouched one of hers, by statement 2. `calls.contact_id`, `calls.conversation_id` and `form_submissions.contact_id` go null by their own FKs. **The call stays in Calls, unlinked (D4).**
   - It answers `has_booking` instead of `has_activity` when `'bookings'` is among the tables (owner Q4), so the reason names it.
   - **An inbound text during the lock (review minor):** the SMS webhook's `createContact` (`api/sms/inbound/route.ts:175-177`) dedupes on the phone and finds the contact being deleted. Its `ensureConversation` insert then waits on statement 1's lock and fails its FK once the delete commits. That throw is not caught at `:175-177`. **Task 5's reviewer reads the handler's top-level catch and confirms it answers 5xx**, so Telnyx retries (`:162-165`). The retry finds no contact, creates a fresh one and files the text. If the handler answers 200 instead, the text is lost: that is a finding, and the fix (catch the FK error and answer 503) goes to the fix round.

### Contact authors (0091)

- `contacts.author_kind text` with `contacts_author_kind_check (author_kind in ('person','ai','automation','customer','import'))`.
- `contacts.author_id text` with `contacts_author_id_person (author_id is null or coalesce(author_kind = 'person', false))`.
- Both are nullable (the 0073 shape). The build running before this PR's deploy inserts without them; a later file sets NOT NULL (Task 10 step 9).
- `app.contact_author(p_actor_type text, p_actor_id text) returns text`, the twin of `contactAuthor`:
  - `ai` → `ai`;
  - `btrim(actor_id)` in `('system_demo_seed','system_ci_seed')` → `import`;
  - `user` → `person`;
  - any other (`system`: the public form `form`, the booking page `public`, an inbound text `sms-inbound`) → `customer`.
- Trigger `contacts_author_guard`, before insert or update, plain (the `0073_record_provenance.sql:116-130` shape):
  - an `authenticated` INSERT keeps only `person` (with `author_id` := the JWT `sub`) or `import` (with `author_id` := null), and turns anything else into `person`;
  - an `authenticated` UPDATE keeps the old pair. The column UPDATE grant (`0053_server_only_writes.sql:137-140`) already excludes them; this is the belt.
- `app.backfill_contact_authors() returns table (bucket text, row_count bigint)` (the `0073:152-245` shape): from each contact's first `contact.created` event. A `system`/`form` contact whose earliest linked `form_submissions` row has `author_kind = 'ai'` is `ai` (a web-chat lead). It is idempotent, touches only `author_kind is null`, and is run once at the end of the file with `raise notice` per bucket.

---

## Assumptions (each with its check)

- **A1** `setBookingStatus`'s returned `updatedAt` equals the stored `updated_at` exactly when compared as `timestamptz` (it is a JS ISO string, millisecond precision). Check: Task 1 case 7 inserts with a JS ISO string and compares in SQL.
- **A2** `ctx.callRowId` (`registry.ts:57`) and `meta.callRowId` can be null ("startCallRow failed open"). An act then has no source, so it is NOT recorded, and the skip is logged (ambiguity E). Check: Task 4's tests.
- **A3** `fillContactBlanksReport` is the one fill on the voice path. `fillContactBlanks` (`contacts.ts:571-578`) only reads `.fields` off it. Check: Task 3 greps the callers.
- **A4** No other lane has claimed 0091. Check: Task 0, `git log --all --oneline -- 'packages/db/supabase/migrations/0091*'` prints nothing.
- **A5** The bis-ci and production backfill buckets equal Task 0's counts (below). Check: Task 10 reads the NOTICEs (MCP returns them) against them.
- **A6** After a reschedule undo, the restored booking's calendar file can supersede the moved one in the customer's calendar app (UID/SEQUENCE, `lib/booking/ics.ts:16-28`). Check: Task 5 reads how `calendarFileUrl` derives SEQUENCE for a chain whose newest row was deleted, and pins it in the notice test. See "The model", function 1.
- **A7** The inbound SMS webhook answers 5xx (so Telnyx retries) when a contact it matched is deleted under it. Check: Task 5's reviewer, see "The model", function 3.

---

## Global constraints (short form; the 8b-1 plan's "Global Constraints", `…pr8b1.md:144-271`, binds where this is silent)

- **Git:**
  - Never `git stash`, `git reset`, `git restore`, `git checkout`, `--amend` or `rm -rf` under `<WT>`.
  - Commit with `git commit -m "…" -- <every path>`.
  - Never push.
  - Commits end with the two trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Databases:**
  - Until Task 10 step 1 has applied 0091 to bis-ci, no `@bis/db` vitest and no live web test runs against bis-ci. Each runs on your own PG18 replica.
  - `packages/db/.env` and `apps/web/.env.local` do not exist in `<WT>`; never create either.
  - **0091 is applied only by the orchestrator**, only through `supabase db push` (`ci-project-setup.yml`) and MCP `apply_migration`. Never by bare `psql` or a SQL editor (ledger 8b-2). Its self-checks sit inside the `do` blocks that make them.
- **The replica kit:** build `<SCRATCH>/s15e-kit/` from `<KIT8B1>` with `sed` and show the `diff`. Only these lines may differ:
  - `replica.sh:6`: `WT=` becomes `<WT>`.
  - `replica.sh:31`: skips `*0091_*`.
  - `replica.sh:36-41`: apply `0091_ai_acts.sql` with `psql -1` (`ON_ERROR_STOP` is already in `P`), and echo `post = pre + 0091`.
  - `pgrst.sh:6`: `SECRET=` becomes `s15e-local-postgrest-jwt-secret-not-used-anywhere-real-0000`.
  - `pre` = every migration through 0090.
- **Ports:** this lane uses **55690-55699** only.

  | Who | Postgres | PostgREST | gateway |
  |---|---|---|---|
  | Task 1 implementer (PostgREST for cases 8 and 9's `withTestAccount` variants) | 55690 | 55698 | 55699 |
  | Task 1 reviewer (Wave B has not started, so Task 3's reviewer ports are free) | 55691 | 55696 | 55697 |
  | Task 3 implementer, then Task 5 implementer (Task 3 stops its kit first) | 55692 | 55693 | 55694 |
  | Task 3 reviewer, then Task 5 reviewer | 55695 | 55696 | 55697 |
  | Task 9 reviewer (after Task 1's implementer and reviewer have stopped their kits) | 55691 | 55698 | 55699 |

  Stop your own kit only, as `…pr8b1.md` "The replica kit" says.
- **Faithfulness:** the client-write digest on `pre` must equal bis-ci's (Task 0 reads it after 0090). 0091 must leave it UNCHANGED on `post`: no client write grant is added.
- **SQL byte rules for 0091:**
  - ASCII only and no backslash: `LC_ALL=C tr -d '\000-\177' < f | wc -c` prints `0`, and `grep -nF '\' f` prints nothing. These are the Git Bash forms (ledger 8b-2).
  - `$` only in `$$` pairs.
  - No `cascade` keyword in any DROP.
  - No `begin;`/`commit;` wrapper.
  - `set local lock_timeout = '5s'` inside the first `do` block, by `set_config`, as 0088.
- **Tests must be able to fail:**
  - The implementer runs each named mutation, pastes the failing assertion line, and reverts by hand (`cmp` against `git show HEAD:<path>`).
  - Every account-scoped read has a second-account case in which the OTHER account holds matching rows.
  - The "Vacuous test shapes" memory applies.
- **`@bis/db` mocks:**
  - Web imports pure values ONLY from `@bis/db/ai-act-rules` and `@bis/db/proposal-rules`.
  - No import-time `@bis/db` value read under `lib/ai-acts/` or `components/ai-acts/`.
  - Tasks 5 and 6 each run `grep -rln 'vi.mock("@bis/db", () => ({' apps/web/src | xargs grep -lE "from ['\"]\./(page|activity-timeline)['\"]"` and add, to each bare factory listed, every `@bis/db` value the new graph CALLS. These are bare factories that `await import("./page")` (ledger).
- **Never call a function exported from a `"use client"` module on the server** (8b-2 final review I-1). Pure view builders live in `lib/ai-acts/view.ts`, never in `components/ai-acts/*`.
- **Timeline `Row` switches stay exhaustive** with the `never` default (`activity-timeline.tsx:291-302`, `group-timeline.tsx`). A new kind is a type error, never an empty row.
- **"All failed" counting** is 8b-2's: `page.failed.length > 0 && page.failed.length >= page.sources.length` (`loaders.ts:75`). `ai_acts` joins `sources` only when read, so the drawer and the group page are unaffected.
- **Copy:**
  - Every string goes through `tr.text(key, params)` with its `.es` twin. Spanish is **usted**.
  - No JSX literal copy.
  - No plumbing words ("act", "AI act", "registry", "RPC", "payload", "server").
  - The persona is `{persona}`, never a typed "Sofía" (the AI mark's own key `provenance.ai` carries the name).
  - `messages.ts` is **Task 2's only**. A later task that finds a key missing STOPS and reports.
- **Logs:** ids and codes only. Never a name, an email, a phone, a field value or a time a customer chose.
- **Running tests:**
  - Only the affected files, by path. Both typechecks green at every commit, and eslint on touched files.
  - Never the gates, never Playwright beyond `--list`.
  - Never pass a folder holding a live test to vitest (`decide.live.test.ts`, `weekly-metrics.live.test.ts`, `f/[publicId]/actions.returning-lead.test.ts`, and this PR's `lib/ai-acts/actions.live.test.ts`).
- **e2e:**
  - On every route with a `loading.tsx` (the record page), page-level locators are inside `page.getByRole("main")`.
  - Role names are exact (`{ name: "Undo", exact: true }`).
  - A React boolean `data-*` attribute renders `"true"` (ledger 8b-2).
  - Fixture account only, every row deleted in `afterAll`.

---

## Task 0: Base, install, pre-reads (orchestrator)

- [ ] **Gate:** bis-ci is at **0089** today (2026-10-19); 0090 waits for 8b-2's own rollout. Task 0 does not start until `max(version)` reads 0090's apply on BOTH projects; read 1 below checks it.
- [ ] **After 8b-2 merges** (≥ 2026-10-20T05:35:46Z, with 0089 and 0090 on both projects): `git -C <WT> fetch origin && git -C <WT> merge origin/main`. The merge conflicts in nothing; this branch holds only the spec and this plan. Run `pnpm install`. Check A4.
- [ ] Re-read every file:line this plan cites, on the merged tree:
  - the call sites (`registry.ts:434-436`, `:451-453`, `:481-486`, `:592-601`, `:683`; `finish-call.ts:296-357`; `textback.ts:157-174`, `:228`; `enrich.ts:97-106`, `:150`, `:179-182`, `:266-310`; `lead.ts:155-179`; `handoff-result/route.ts:352-365`);
  - the 8b-2 record files.

  Correct this plan in place for any line that moved (a docs commit) before dispatching Wave A.
- [ ] Read-only MCP `execute_sql` on **both** `tlbkbmlrfafquucsmsmm` and `odnobiodsftffphuuosz`.
  - **Already read, 2026-10-19:**
    - contacts with no `contact.created` event: **0** on production (51 contacts) and **0** on bis-ci (41).
    - Production's `contact.created` actors: `ai:voice` 4; `system:form` 2; `user:system_demo_seed` 40 (the demo tenant's daily seed, #272); two real Clerk users, 3 + 2.

    **No STOP on the no-event count.**
  - **To read now:**
    1. `select max(version) from supabase_migrations.schema_migrations` (it must be 0090's apply).
    2. The Faithfulness digest (`…pr8b1.md:301-311`).
    3. `select count(*) from public.events where type = 'contact.imported'`.
    4. The bis-ci actor list (`select actor_type, actor_id, count(*) from public.events where type = 'contact.created' group by 1, 2`).
    5. How many `system:form` contacts are web-chat leads: their earliest `form_submissions` row by `contact_id` has `author_kind = 'ai'`.
- [ ] **STOP rule:** if read 3 is non-zero on **production**, STOP before Task 1 and ask the owner. A CSV import's `contact.imported` event carries counts, not ids (`…/contacts/import/actions.ts:61`), so those contacts would backfill as `person` (the importer), not `import`. On bis-ci a non-zero count is test data and is recorded only.
- [ ] Ledger line `8c T0: …` with every value. Put the digest and the expected backfill buckets into Task 1's brief.

---

## Task 1 (HIGH): Migration 0091, its proof, and `contactAuthor` (bis-db-schema)

**Files:**
- Create `packages/db/supabase/migrations/0091_ai_acts.sql`, `packages/db/src/test/ai-acts-schema.test.ts` and `packages/db/src/test/contact-authors.test.ts`.
- Modify `packages/db/src/provenance.ts` (+ `test/provenance-parity.test.ts`), `account-teardown.ts`, `test/technician-scope.test.ts`, `test/server-only-writes-grants.test.ts`, and `test/schema-grants-guard.test.ts` if it enumerates tables.

**The file**, in this order:
1. A `do` block taking `lock_timeout`.
2. `concierge_conversations_account_id_id_key`.
3. `ai_acts` with its constraints, trigger, index, RLS and grants.
4. The contact columns, `app.contact_author`, the guard trigger, and `app.backfill_contact_authors` with its run.
5. The three functions with their `revoke all … from public, anon, authenticated, service_role` and their grants.

Exact shapes are in "The model" above.

The header carries:
- the apply order (bis-ci, then production, then parity, then merge; **before the code**);
- that 0091 is additive and safe under the running build (nullable columns; the guard only fills what the old build never sends);
- the rollback, in reverse order: drop the three functions, the guard trigger and its function, the backfill and mapping functions, the table, and the unique key; dropping the two contact columns only on an owner decision, since it drops recorded authors.

**`provenance.ts`:** add `contactAuthor(actorType, actorId): RowAuthor` with exactly the SQL mapping above, plus `SEED_ACTORS = ["system_demo_seed", "system_ci_seed"] as const`. Parity cases go in `provenance-parity.test.ts`: every `(actor_type, actor_id)` pair from Task 0's actor lists, plus `("user","   ")`, against `app.contact_author` on `post`.

**Steps:**
- [ ] Build the kit (Global constraints). `pre` digest = Task 0's value.
- [ ] Write the tests first, on `post` (`withRollback`; `withTestAccount` where a JWT role is needed). Each runs its mutation:
  1. **RLS:**
     - account B's Owner reads none of A's acts while B holds its own;
     - a Technician reads an act only for an assigned customer;
     - `anon` reads nothing.
     - **Mutation:** drop `ai_acts_technician_scope` → **FAILS**.
  2. **Grants:** `authenticated` INSERT, UPDATE and DELETE are each `42501`; `service_role` may do all four. **Mutation:** `grant insert … to authenticated` → **FAILS**; the digest case catches it too.
  3. **Immutability:** an update to `kind`, `target`, `before`, `after`, `contact_id`, `call_id` or `created_at` raises `ai_acts_act_is_fixed`; an update to `undone_at`/`undone_by`/`undo_notified` passes. **Mutation:** drop `target` from the trigger's list → **FAILS**.
  4. **Pairs:**
     - `undone_at` without `undone_by` raises `23514`;
     - `undo_notified` true while not undone raises `23514`;
     - `actor 'voice'` with `chat_id` set and `call_id` null raises `23514`.
     - **Mutation:** drop the source check → **FAILS**.
  5. **Cascades:**
     - deleting the contact deletes its acts;
     - deleting the call deletes its acts;
     - a cross-account `call_id` is refused `23503` (the composite FK).
  6. **`undo_ai_booking_act`, `booking_created`:**
     - a future booked booking → `undone`, the booking is `cancelled`, and the act is stamped with `p_by`;
     - a second call → `already_undone`;
     - a booking already cancelled → `already_cancelled`;
     - a started one → `already_happened`;
     - another account's id → `gone`.
     - **Mutation:** drop `starts_at > p_now` → the started case **FAILS**.
  7. **`booking_cancelled`:**
     - the version CAS: a matching `version` → `undone` (booked again);
     - a later `updated_at` → `changed`;
     - another booked booking overlapping the slot → `time_taken`, with nothing written (the act is not stamped);
     - a replacement (`rescheduled_from_id`) → `changed`;
     - the start passed → `time_passed`.
     - A1: the version is written by a JS ISO string and read back equal.
     - **Mutation:** drop `updated_at = version` → the later-update case **FAILS**.
  8. **`booking_rescheduled`:**
     - both untouched → old `booked`, the new row **gone**, act stamped;
     - then `bookingWasMoved(old)` (`booking.ts:857`) is false;
     - then a person's cancel of the old booking (`setBookingStatus` as `user`) followed by `undoOperatorCancel` with that cancel's version succeeds, not `rescheduled` (I-4). This runs as a `withTestAccount` case on the replica's PostgREST (ports in Global constraints);
     - the old slot taken by a third booking → `old_time_taken`, and the NEW booking is still `booked` (rolled back);
     - the new booking cancelled meanwhile → `changed` (SQLSTATE `ZA001`);
     - the old booking's version moved → `changed` (`ZA002`).
     - **Mutation:** move the old restore OUTSIDE the inner block → the taken case leaves the new row deleted and **FAILS**.
     - **Mutation:** cancel the new row instead of deleting it → the `bookingWasMoved` case **FAILS**.
  9. **`ai_contact_held_by`, table by table:**
     - a contact with only her call, her summary message (`author_kind 'ai'`), her callback task, her textback log row, her proposal and a duplicate flag answers `{}`;
     - then, for EACH table in the table-by-table list's "otherwise" column, one case inserting one non-hers row answers exactly `{<that name>}`;
     - a `contact.updated` event with `actor_type 'user'` answers `{edits}`;
     - a web-chat act: its own submission (`target.submissionId`) and its `messageId` message answer `{}`, and a second submission answers `{form_submissions}`;
     - **I-2:** her callback task once completed → `{tasks}`; once assigned → `{tasks}`; untouched but named by a `user` `task.reopened` event → `{tasks}`; her proposal once `accepted` → `{proposals}`, while `expired` → `{}`;
     - **I-3:** her text-back log row with `status 'held'` → `{automation_log}`, and the same row `sent` → `{}`;
     - **I-1:** the clean case and the notes case again, called through PostgREST as an **authenticated Owner JWT** (`withTestAccount`), with the same answers and no `42501`. **Mutation:** put back a `concierge_conversations` read → this case **FAILS** with `42501`.
     - **Guard case:** `select conrelid::regclass from pg_constraint where confrelid = 'public.contacts'::regclass and contype = 'f'` equals the test's typed list of 20 tables. A future FK fails here by name.
     - **Mutation:** drop the `notes` clause → the notes case **FAILS**.
  10. **`undo_ai_contact_created`:**
      - the clean contact → `deleted`; the contact, its conversation, her message, her task and the act are gone; the call row remains with `contact_id` null;
      - with a note → `has_activity`, and nothing is deleted;
      - with a booking (even cancelled) → `has_booking`, and nothing is deleted (owner Q4);
      - a second call → `gone`.
      - **Mutation:** skip statement 2's check → the note case **FAILS** (and the note is gone, which the test asserts).
  11. **Function grants:**
      - `has_function_privilege`: `undo_ai_booking_act` and `undo_ai_contact_created` are false for `anon`/`authenticated` and true for `service_role`;
      - `ai_contact_held_by` is true for `authenticated`;
      - all three have `proconfig = {search_path=""}` and `prosecdef = false`.
      - **Mutation:** `grant execute on undo_ai_contact_created … to authenticated` → **FAILS**.
  12. **Contact authors** (`contact-authors.test.ts`):
      - the CHECKs refuse a sixth kind and an `author_id` without `person`;
      - an `authenticated` insert sending `author_kind 'ai'` stores `person` with the JWT `sub`;
      - one sending `import` stores `import` with a null id;
      - an `authenticated` update of either column keeps the old pair;
      - the backfill sets each bucket on seeded contacts (`ai:voice` → ai; `system:form` → customer; `system:form` with an earliest `ai` submission → ai; `user:<clerk>` → person + id; `user:system_demo_seed` → import; `system:system_ci_seed` → import), and a second run changes nothing.
      - **Mutation:** map `system_demo_seed` to `person` → **FAILS**.
- [ ] Run, on `post`: the two new files, `provenance-parity`, `technician-scope`, `server-only-writes-grants`, `schema-grants-guard`, `record-provenance-schema` and `proposals-schema`. All green. The digest on `post` is UNCHANGED.
- [ ] Byte check (Global constraints). Record `md5sum`. Commit `db: ai_acts with its read fence and fixed acts, contacts' created-by mark and its backfill, and the undo functions for Sofía's bookings and contacts (item 8c, migration 0091)`.

**Acceptance:** every case green on `post`; every mutation fails by name; the digest is unchanged; the md5 is in the report.

**Review (HIGH):** opus bis-reviewer on 55691/55696/55697.
- It re-runs four probes, one each in cases 8, 9 and 10, and one of its own choosing.
- It applies 0091 to a fresh `pre` copy through `psql -1` only. There is no bare-`psql` autocommit step (review I-6): 0091 is a multi-statement additive file, and its only routes, `supabase db push` and MCP `apply_migration`, each run it as one transaction.
- It checks the bytes.
- It reads `pg_constraint` itself against the typed list.

A re-review follows any change. The md5 that reaches bis-ci is the reviewed one.

---

## Task 2 (LOW): Every new key (bis-crm)

**Files:** `apps/web/src/lib/messages.ts`. One `describe` appended to `messages.test.ts` asserts each key, its `.es` twin, and the params named.

| Key | English | Spanish (usted) |
|---|---|---|
| `timeline.what.aiActs` | the assistant's actions | las acciones de la asistente |
| `aiActs.verb.booked` | booked {when} | reservó {when} |
| `aiActs.verb.rescheduled` | moved a booking to {when} | movió una cita al {when} |
| `aiActs.detail.movedFrom` | From {when} | Antes: {when} |
| `aiActs.verb.cancelled` | cancelled the booking on {when} | canceló la cita del {when} |
| `aiActs.verb.contactCreated` | added this customer | agregó a este cliente |
| `aiActs.verb.fieldFilled` | filled in the {field}: {value} | completó {field}: {value} |
| `aiActs.field.firstName` / `.lastName` / `.email` / `.phone` | first name / last name / email / phone number | el nombre / el apellido / el correo / el teléfono |
| `aiActs.source.call` | From the call on {date} | De la llamada del {date} |
| `aiActs.source.webchat` | From the website chat | Del chat del sitio web |
| `aiActs.reason.alreadyCancelled` | Already cancelled | Ya se canceló |
| `aiActs.reason.alreadyHappened` | Already happened | Ya pasó |
| `aiActs.reason.rebooked` | Already re-booked | Ya se volvió a reservar |
| `aiActs.reason.timePassed` | The time has passed | La hora ya pasó |
| `aiActs.reason.timeTaken` | That time is taken now | Esa hora ya está ocupada |
| `aiActs.reason.oldTimeTaken` | The old time is taken | La hora anterior ya está ocupada |
| `aiActs.reason.changed` | Changed since | Cambió desde entonces |
| `aiActs.reason.changedBy` | Changed since by {name} | {name} lo cambió después |
| `aiActs.reason.hasActivity` | Has other activity since | Tiene otra actividad desde entonces |
| `aiActs.reason.hasBooking` | Has a booking, so it stays. Delete it the usual way if it has to go. | Tiene una cita, así que se queda. Si debe quitarse, bórrelo de la forma habitual. |
| `aiActs.reason.otherBooking` | They booked another time since | Reservó otra hora desde entonces |
| `aiActs.reason.ownerOnly` | Only an Owner can remove a customer | Solo el Dueño puede quitar a un cliente |
| `aiActs.undoneBy` | Undone by {name} · {date} | Deshecho por {name} · {date} |
| `aiActs.notify.label` | Let {name} know by email | Avisarle a {name} por correo |
| `aiActs.notify.noEmail` | {name} has no email on file, so they won't be told. Call them if they need to know. | {name} no tiene correo registrado, así que no se le avisará. Llámele si necesita saberlo. |
| `aiActs.toast.fieldUndone` | Put back the {field}. | Se restauró {field}. |
| `aiActs.toast.fieldRedone` | {persona}'s value is back. | Volvió el valor que puso {persona}. |
| `aiActs.toast.bookingUndone` | Booking undone. | Se deshizo la cita. |
| `aiActs.toast.bookingUndoneTold` | Booking undone. {name} was emailed. | Se deshizo la cita. Se le envió un correo a {name}. |
| `aiActs.toast.bookingUndoneNotTold` | Booking undone. The email to {name} didn't go out. | Se deshizo la cita. El correo a {name} no se envió. |
| `aiActs.toast.contactRemoved` | Customer removed. The call stays in Calls. | Se quitó al cliente. La llamada sigue en Llamadas. |
| `aiActs.toast.notAvailable` | This can't be undone any more: {reason} | Ya no se puede deshacer: {reason} |
| `aiActs.toast.failed` | That didn't work. Reload the page, then try again. | No funcionó. Recargue la página e inténtelo otra vez. |
| `aiActs.contactDialog.title` | Remove {name}? | ¿Quitar a {name}? |
| `aiActs.contactDialog.body` | {persona} added this customer, and nothing else has happened since. Removing them can't be undone; the call stays in Calls. Type {name} to confirm. | {persona} agregó a este cliente y no ha pasado nada más desde entonces. Quitarlo no se puede deshacer; la llamada sigue en Llamadas. Escriba {name} para confirmar. |
| `aiActs.contactDialog.confirm` | Remove customer | Quitar cliente |
| `record.facts.addedBy` | Added by {who} | Agregado por {who} |

- Reuse `common.undo`, `common.cancel` and `provenance.ai`.
- The customer notice adds no key: its subjects and bodies are the booking templates' own (`bookingCancelledSubject`, `bookingConfirmationSubject`, `bookingRescheduledSubject`, `lib/email/templates/booking.ts`).
- [ ] `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n/` and typecheck. Commit `copy: Sofía's actions on the timeline, their Undo, the reasons, the notice and the created-by fact, English and Spanish (item 8c)`.

---

## Task 3 (MEDIUM): `@bis/db` (bis-crm)

**After:** Tasks 1 and 2. **Kit:** 55692/55693/55694.

**What:**
1. **`ai-act-rules.ts`**: the model above, plus `parseAiAct`. Add `"./ai-act-rules": "./src/ai-act-rules.ts"` to `package.json` `exports` (`:5-17`).
2. **`ai-acts.ts`:**
   - `insertAiActs(db, accountId, acts: readonly NewAiAct[]): Promise<void>`: ONE multi-row insert (service client; throws). Task 4 calls it once per site.
   - `getAiAct(db, accountId, id): Promise<AiAct | null>` (request client; RLS decides).
   - `listContactAiActs(db, accountId, who, page): Promise<AiAct[]>`, via `withTimelinePage(…, "created_at", page)` (`timeline-cursor.ts:75`). An unparseable row is dropped and logged by id.
   - `undoAiBookingAct(db, accountId, actId, by, now): Promise<AiBookingUndoOutcome>`. It wraps the RPC. On `undone` it emits `booking.status_changed` for each booking it moved, actor `by`/`user`, best-effort, as `setBookingStatus` does (`booking.ts:432`). `AiBookingUndoOutcome = "undone" | "already_undone" | "gone" | "already_cancelled" | "already_happened" | "rebooked" | "time_passed" | "time_taken" | "old_time_taken" | "changed"`.
   - `aiContactHeldBy(db, accountId, actId): Promise<string[]>` and `undoAiContactCreated(db, accountId, actId): Promise<"deleted" | "has_activity" | "has_booking" | "gone">`. After a reschedule undo, the wrapper emits `booking.status_changed` (booked) for the restored old booking only; the deleted new row emits nothing, and its act row (stamped undone) is its record.
   - `stampAiActUndone(db, accountId, actId, by, at): Promise<boolean>` (CAS `undone_at is null`). `clearAiActUndone(db, accountId, actId, by, at): Promise<boolean>` (CAS `undone_by = by and undone_at = at`; the field redo). `markAiActNotified(db, accountId, actId): Promise<void>`.
3. **`contacts.ts`:**
   - `COLS` gains `author_kind, author_id`. It must stay ONE string literal (`:58-62`'s reason).
   - `CreateContactInput.author?: RowAuthor`. `createContact` inserts `author_kind`/`author_id` from `input.author ?? contactAuthor(actorType, actorId)`, and never through `toRow`.
   - `fillContactBlanksReport` also returns `prior: Partial<Record<ContactFieldName, string | null>>` (the column as read before the write) and `written: Partial<Record<ContactFieldName, string>>` (the stored form written; a phone is its `phoneFields(...).phone`). It is keyed by the camel field name, and only for fields actually written.
   - `restoreContactFieldIf(db, accountId, contactId, field, expected, restore, actorId): Promise<"restored" | "changed">`. It is one UPDATE `.eq(<column>, expected)` with `.select("id")`; zero rows means `changed`. A phone restore writes `phoneFields(restore)`, and an email restore of null writes null. It emits `contact.updated` (the actor's) on `restored`. It runs on the REQUEST client (contacts' column UPDATE grant, P14).
   - `lastFieldEditor(db, accountId, contactId, field, since): Promise<string | null>` (soft; RLS: a Technician reads no events, so null): the newest `contact.updated` event by a `user` naming the field after `since`.
4. **The import:** `contact-import.ts:176` passes `{ ...row.input, author: { authorKind: "import", authorId: null } }`. The two seeds need no edit: `contactAuthor` maps their actor ids (Q1).
5. **`record.ts`:**
   - `TimelineSource` and `TIMELINE_SOURCES` gain `"ai_acts"`.
   - `TimelineEntry` gains `{ kind: "aiAct"; id: string; at: string; contactId: string; act: AiAct }`.
   - `listTimelinePage` and `listContactTimelinePage` take `opts.aiActs?: boolean`. The source is read only when it is `true` (the 8b-2 `suggestions` spread, `:498-503`), so `sources` names it only then.
6. **`index.ts`** exports the new functions and types.
7. **Web, type-only, so typecheck stays green:**
   - `authorOf` case `"aiAct"` → `{ kind: "ai", personId: null }`;
   - `SOURCE_KEY.ai_acts = "timeline.what.aiActs"`;
   - `phrase` case `"aiAct"` → `{ verb: "", status: null, detail: null }`, with a `// Task 5 replaces` note;
   - the drawer maps (`drawer-summary.ts:57` `aiAct: true`; `contact-drawer.tsx:69` `aiAct: Bot` from lucide);
   - `recent-rows.ts` `case "aiAct": return null`;
   - `group-timeline.tsx` and `activity-timeline.tsx` `case "aiAct"`: a plain `<TimelineItem {...head} icon={Bot} />`.

**Tests (each with its mutation, run):**
- `ai-acts.test.ts`, on the replica:
  - `insertAiActs` then `getAiAct` round-trips every kind;
  - account B's id with A's act answers null while B holds one (**mutation:** drop `.eq("account_id")` → **FAILS**);
  - `listContactAiActs` pages across a cursor boundary, newest first;
  - `undoAiBookingAct` emits one `booking.status_changed` per moved booking with the undoer as actor (**mutation:** emit before checking the outcome → the `changed` case **FAILS**);
  - `parseAiAct` drops a `contact_field_filled` row whose `field` is `"company"`.
- Contacts:
  - `createContact` from a `user` stores `person` + id;
  - `ai` stores `ai`;
  - `form`/`system` stores `customer`;
  - `author: import` wins over the actor (**mutation:** ignore `input.author` → **FAILS**);
  - an existing (dedupe) hit writes nothing;
  - `fillContactBlanksReport` on a `Caller` contact reports `prior.firstName = "Caller"`, `written.firstName = "Ana"`;
  - `restoreContactFieldIf` answers `changed` when the column moved and writes nothing (**mutation:** drop the `.eq(column, expected)` → **FAILS**).
- Timeline:
  - the source is absent unless `opts.aiActs`;
  - `sources` names it when read;
  - a failed `ai_acts` read is named in `failed` while the other sources render;
  - an empty contact set still returns `sources: []`.
- [ ] Run the touched `@bis/db` files on the replica, the web tests by path, both typechecks and eslint. Commit `db: Sofía's acts as records and as timeline rows, contacts carry who made them, and a fill reports what it replaced (item 8c)`.

**Review (MEDIUM):** sonnet bis-reviewer on 55695-55697. It runs the cases, one second-account probe and one probe of its choosing.

---

## Task 4 (MEDIUM): Every live call site records its act; the notice check (bis-voice)

**After:** Task 3. **No replica** (the tests mock `@bis/db`).

**`apps/web/src/lib/ai-acts/record.ts`:**
- `recordActs(db, accountId, acts: readonly NewAiAct[]): Promise<void>`, with `recordAct(db, accountId, act)` = `recordActs(db, accountId, [act])`.
- **One insert per site** (review I-5): a site that produces several acts (a contact plus its fills) collects them and calls `recordActs` ONCE, through Task 3's `insertAiActs`.
- **Bounded:** `export const ACT_RECORD_TIMEOUT_MS = 1000`. It races the insert against that timer.
  - On timeout it logs `ai act not recorded: timed out after 1000 ms kind=<k> account=<id> source=<call|chat>:<id>` and returns.
  - The insert may still land later; its rows then simply appear. It is never awaited again.
  - A live call waits at most one second per tool call for bookkeeping, never on a hung database.
- On any throw it logs `ai act not recorded: kind=<k> account=<id> source=<call|chat>:<id> contact=<id>: <error code or name>`.
- It never throws and never rethrows.
- It skips (and logs `ai act not recorded: no source`) when `actor = "voice"` and `callId` is null, or `actor = "webchat"` and `chatId` is null (A2).

**The sites** (read at `48c5ba33`; Task 0 re-checked them). Each `recordAct` is awaited AFTER its write succeeded and BEFORE the code that already follows. A failed record changes nothing else.

| Act | Site | What is recorded |
|---|---|---|
| `contact_created` | `registry.ts:434-436` (`book_appointment`) | only when `!created.existing`; `callId: ctx.callRowId` |
| `contact_field_filled` | `registry.ts:451-453` | switch to `fillContactBlanksReport`; one act per key of `written`, `before: { value: prior[field] ?? null }`, `after: { value: written[field] }` |
| `booking_created` | `registry.ts:481-486` | `target { bookingId }`, `after { startsAt, endsAt }` from `slot` |
| `booking_rescheduled` | `registry.ts:592-596` + `:601` | ONE act, recorded after `:601` succeeds (the new booking is not also a `booking_created`); capture `:601`'s `{ updatedAt }`; `target { bookingId: newId, fromBookingId: bookingId }`, `before { startsAt: old.starts_at, endsAt: old.ends_at, version: updatedAt }`, `after` from `slot` |
| `booking_cancelled` | `registry.ts:683` | capture `{ updatedAt }`; `target { bookingId }`, `before { startsAt: row.starts_at, endsAt: row.ends_at }`, `after { version: updatedAt }` |
| `contact_created` / `contact_field_filled` | `finish-call.ts:302-310`, `:322-327`, `:337-342`, `:344-348` | `resolveContactId(state, ctx)` (`:296`) gains a third parameter `callId: string \| null`. Both callers pass it: `finishCall` (`:420`, `meta.callRowId`) and the text-back resolver (`:604`). The fills switch to `fillContactBlanksReport`, one act per written field. `:344-348`'s phone fill is a no-op on a caller-ID match, so it records nothing unless `written` is non-empty |
| `contact_created` / `contact_field_filled` | `textback.ts:157-174` (`contactForCallerId`) | gains a `callId: string \| null` parameter, passed by `:228` as `r.callId`; `handoff-result/route.ts:352-365` already passes `callId` into `prepareTextback` |
| web chat: `contact_created` / `contact_field_filled` | `enrich.ts:97-106`, `:150` (`fillBlanks`, `:266-310`), `:179-182` | see below |

**The web chat proviso: how `enrich` tells the chat from the public form.** **It does not today.**
- `enrich(db, form, submissionId, answers, attribution, origin, locale, consentWithheld)` (`enrich.ts:35-48`) has no parameter that says who called it. Both callers pass the same `"form"`/`"system"` actor: the public form (`app/f/[publicId]/actions.ts:213-217`) and the chat's `fileLead` (`lead.ts:170-179`).
- The only chat marks are upstream:
  - `createSubmission(..., { authorKind: "ai" })` (`lead.ts:155-158`, 0073);
  - and `lead.ts:173-179`'s unconditional `consentWithheld: true`, which the public form can also pass, so it is NOT a discriminator.
- **The change:**
  - `enrich` gains a ninth, optional parameter `webchat?: { chatId: string }`. Only `lead.ts:170` passes it, `{ chatId: ctx.conversationId }` (a `concierge_conversations` id, `lead.ts:65`). The public form passes nothing, so it records nothing and its contacts stay `customer`.
  - With `webchat` set:
    - `createContact` gets `author: { authorKind: "ai", authorId: null }`;
    - a new contact (`!created.existing`) records `contact_created` AFTER `createMessage` (`:179-182`) succeeded, with `target { messageId: <that message's id>, submissionId }` (`submissionId` is `enrich`'s own third argument; review I-1). `createMessage` returns its row; the call site captures it.
    - `fillBlanks` returns, beside its business error, `filled: { field: ContactFieldName; before: string | null; after: string }[]` for the four columns only (from `current` at `:276` and the patch). Each is recorded as `contact_field_filled`.
  - Custom fields, the business and the attribution are not acts (ambiguity D).

**§7, the notice: every booking change by Sofía reaches the business.** Read 2026-10-19:

| Path | Business notice today | Failure logged | Gap |
|---|---|---|---|
| Book (`book_appointment`) | the end-of-call alert: `outcome = "booked"` is meaningful (`call-state.ts:127`, `finish-call.ts:154-158`); email to `calendar.notify_emails` (`incoming/route.ts:1157` → `finish-call.ts:459-500`), plus its SMS twin; the thread's voice summary + unread (`:420-431`) | per recipient (`:493-495`), setup (`:497-503`) | none |
| Reschedule | `alertStaffOfPhoneChange` (`registry.ts:190-227`) + the thread line (`:229-247`), during the call; the end-of-call alert also fires (the new booking makes it `booked`) | yes (`:220-226`) | **G1:** with no notify address it returns at `:192` silently; only the thread line remains |
| Cancel | the same two legs (`registry.ts:707-711`) | yes | **G1** as above. A cancel-only call is `abandoned` (`call-state.ts:144`), so no end-of-call alert fires, and the cancel's own legs are its only notice |
| An Undo by staff | not needed: staff did it | — | — |

- **Fill G1** with one log line and no new channel: `voice <tool> <bookingId>: no staff address on the calendar; thread line only`.
- **Pin each row with a test**, if it is not already pinned (grep `registry.test.ts`/`finish-call*.test.ts` first, and cite the existing test when one exists):
  - the book path's alert names `booked`;
  - reschedule and cancel each send to every notify address;
  - a failed send logs and the tool still answers `ok: true`.

**Tests (each with its mutation, run):**
- `record.test.ts`:
  - a throwing `insertAiActs` resolves and logs ids only;
  - the log carries no name or email (**mutation:** log the act's `after` → **FAILS**);
  - a null source skips;
  - **a hanging `insertAiActs`** (a promise that never settles), under fake timers: `recordActs` resolves at `ACT_RECORD_TIMEOUT_MS` and logs the timeout (**mutation:** await the insert without the race → **FAILS**, the test times out);
  - two acts at one site make ONE `insertAiActs` call with both.
- **I-5, the tool path:** `runTool("book_appointment", …)` with a hanging `insertAiActs` answers its result within `ACT_RECORD_TIMEOUT_MS + 50 ms` of fake time, and that result is `toEqual` the no-act run. The same holds for `reschedule_appointment` and `cancel_appointment`.
- Per voice site: with `recordAct` mocked to throw (or `insertAiActs` mocked to throw under the real `recordAct`), the tool's `result` and returned `state` are `toEqual` the no-act run. **Mutation:** remove the `try` in `recordAct` → each site's case **FAILS**.
- One act per filled field, none for an existing contact's `contact_created`. **Mutation:** record on `created.existing` → **FAILS**.
- `booking_rescheduled` carries the cancel's `updatedAt` as `before.version`. **Mutation:** record `new Date().toISOString()` → **FAILS** (assert the exact value the `setBookingStatus` mock returned).
- `enrich`: the public form call records nothing and stores `customer`; the chat call records `contact_created` with the message id and stores `ai`. **Mutation:** pass `webchat` from `f/[publicId]/actions.ts` → **FAILS**.
- §7: G1's log line with an empty `notify_emails`.
- [ ] Typecheck, eslint, the touched tests by path. Commit `voice and chat: every live act Sofía takes is recorded beside it, never at the call's cost, and a booking change with no staff address says so (item 8c)`.

**Review (MEDIUM):** sonnet bis-reviewer (source and tests). **Hunt:**
- a `recordAct` that is not awaited;
- one placed before its write;
- one inside a try whose catch changes a result;
- a log carrying words;
- the public form reaching the chat path.

It runs the failure-isolation cases.

---

## Task 5 (HIGH): The kinds, the facts, the views, the undo, the notice, the loaders (bis-crm, opus)

**After:** Task 3 (in parallel with Task 4). **Kit:** 55692-55694, after Task 3's implementer stops it.

**Files:**
- `apps/web/src/lib/ai-acts/kinds/{types,booking-created,booking-rescheduled,booking-cancelled,contact-created,contact-field-filled,index}.ts`;
- `facts.ts`, `view.ts`, `actions.ts` (`"use server"`), `notify.ts`, `undo-handlers.ts`, each with a test;
- `actions.live.test.ts`;
- `apps/web/src/lib/proposals/kinds/contact-field.ts` (exports only);
- `apps/web/src/lib/consent/classes.ts`;
- `apps/web/src/lib/record/{loaders,timeline-rows,author-mark}.ts` and their tests.

**1. The registry** (`kinds/types.ts`):

```ts
export type ActFacts = {
  now: Date;
  bookings: Readonly<Record<string, { status: BookingStatus; startsAt: string; endsAt: string; updatedAt: string; replacedBy: string | null; slotTaken: boolean }>>;
  contact: Record<string, unknown> | null;       // the record's own row (getContact)
  heldBy: Readonly<Record<string, readonly string[]>>; // act id -> ai_contact_held_by, Owners only
  editors: Readonly<Record<string, string | null>>;   // act id -> lastFieldEditor
  canDelete: boolean;                             // requireAccountAccess().canManage
};
export type StillSafe = { ok: true } | { ok: false; reason: ActReason };
export type ActReason = "alreadyCancelled" | "alreadyHappened" | "rebooked" | "timePassed" | "timeTaken" | "oldTimeTaken" | "changed" | "changedBy" | "hasActivity" | "hasBooking" | "otherBooking" | "ownerOnly";
export type ActKindDef<K extends AiActKind> = {
  kind: K;
  describe(act: AiAct & { kind: K }, ctx: { tr: Tr; zone: string }): { verb: string; detail: string | null };
  stillSafe(act: AiAct & { kind: K }, facts: ActFacts): StillSafe;   // pure: the display
  control: "field" | "booking" | "contact";
};
```

Each kind's `stillSafe` mirrors its SQL twin exactly. The RPC or CAS is authoritative; this is the display (ambiguity I). Per kind:
- **booking_created:** not `booked` → `alreadyCancelled`; started → `alreadyHappened`.
- **booking_rescheduled:**
  - the new booking not `booked` or replaced → `changed`;
  - the old booking's `updatedAt` ≠ `before.version` → `changed`;
  - the old start passed → `timePassed`;
  - `slotTaken` on the old booking → `oldTimeTaken`.
- **booking_cancelled:** `booked` → `rebooked`; passed → `timePassed`; the version differs or it was replaced → `changed`; `slotTaken` → `timeTaken`.
- **contact_created:** `!canDelete` → `ownerOnly`; `heldBy` containing `bookings` → `hasBooking`; any other non-empty `heldBy` → `hasActivity`.
- **booking_cancelled, extra (review minor):** the contact has another `booked` booking starting in the future that is not this one → `otherBooking`. `facts.ts` adds ONE read for it, only when a `booking_cancelled` act is on the page: the contact's future booked bookings (`.eq("contact_id").eq("status", "booked").gt("starts_at", now)`).
- **contact_field_filled:** `!stillAsWritten(field, contact[col], after.value)` → `changedBy` when an editor is named, else `changed`.

**2. `facts.ts`:** `readActFacts(db, accountId, contactId, acts, access): Promise<ActFacts>`, on the request client. It costs at most four reads plus one per booking act that needs an overlap answer, bounded by the timeline page (≤ 30 rows):
- ONE `bookings.select(id, status, starts_at, ends_at, updated_at).in("id", ids)` read;
- ONE replacement read `.in("rescheduled_from_id", ids)`;
- per `booking_cancelled`/`booking_rescheduled`: one overlap read (`status = 'booked'`, same calendar, `starts_at < ends`, `ends_at > starts`, `id` not this one and not the act's own new booking, `limit 1`);
- `ai_contact_held_by` per `contact_created` act, only when `canDelete`;
- `lastFieldEditor` per field act whose value moved.

Under RLS a Technician may not see an overlapping booking. The display may then offer an Undo that the RPC refuses as `time_taken`, and the toast says so.

**3. `view.ts`:** `buildActView(act, facts, ctx: { tr; zone; personaName; names; viewerId; accountId }): AiActView`, where

```ts
type AiActView = {
  id: string; kind: AiActKind; verb: string; detail: string | null;
  source: { label: string; href: string | null };
  undo:
    | { state: "available"; control: "field" | "booking" | "contact"; notify: { name: string } | { none: string } | null; contactName: string }
    | { state: "blocked"; line: string }
    | { state: "undone"; line: string }
    | { state: "unknown" };
};
```

- The verbs use `formatWhen` in the account zone and the reader's language.
- **source:**
  - `aiActs.source.call` with the call's local day, linking to `/dashboard/accounts/{id}/calls/{callId}`;
  - `aiActs.source.webchat`, with no link.
- **`notify`:** booking controls only. `{ name }` when the contact has an email, else `{ none: aiActs.notify.noEmail }`.
- **`undone`:** `aiActs.undoneBy` with `authorLabel("person", undoneBy, …)`, so the viewer reads "You" and an unnamed person reads "Someone on the team".
- **`unknown`:** the facts read failed. The row shows, without an Undo.

**4. `actions.ts`:** `undoAiActAction(accountId, actId, input: { notify?: boolean; typedName?: string }): Promise<UndoResult>` and `redoAiFieldFillAction(accountId, actId)`.
- `requireAccountAccess` → `getAiAct(await dbForRequest(), …)` (RLS + the Technician fence: the proof). A null act → `notAvailable`.
- **booking kinds:**
  1. Prove every target booking with `callerCanSee("bookings", …)` (`lib/auth/visible.ts:14`), the `proveBooking` pattern (`…/calendar/actions.ts:186-196`).
  2. Call `undoAiBookingAct(serviceDb(), …, userId, new Date())`.
  3. On `undone` with `notify` true and an email on file, call `sendBookingUndoNotice`. Its success calls `markAiActNotified`.
  4. Answer `{ ok: true, told: "yes" | "no" | "notAsked" }`. Any other outcome answers `{ ok: false, reason }` (mapped to `ActReason`).
- **contact_field_filled:** `restoreContactFieldIf(await dbForRequest(), …, after.value, before.value, userId)`, then `stampAiActUndone(serviceDb(), …)`. `changed` → `{ ok: false, reason: "changed" }`. `redoAiFieldFillAction` restores `after` over `before` with the same CAS, then `clearAiActUndone`.
- **contact_created:**
  1. `requireAccountOwner(accountId)`.
  2. `typedName` must equal the contact's display name under `purgeNameKey` (`lib/documents/rules.ts:78`); otherwise `{ ok: false, reason: "typedName" }`.
  3. Call `undoAiContactCreated(serviceDb(), …)`. `deleted` → `{ ok: true, removed: true }`, and the caller navigates to the contacts list. `has_activity` → `{ ok: false, reason: "hasActivity" }`; `has_booking` → `{ ok: false, reason: "hasBooking" }`.
- Every path: `revalidatePath` the record page (and the contacts list on a removal). Log ids only.

**5. `notify.ts`:** `sendBookingUndoNotice({ accountId, act, contact, origin })`, on the service client.
- **The language:** `recipientLanguage(contact.language, account.language)` (`@bis/db` `spanish-box.ts:20-24`, S-09's precedence).
- **The brand and the sender:** `loadAccountBrandInfo` (`booking.ts:1171`) and `emailBrand`.
- **The usual messages** (`lib/email/templates/booking.ts`, the same builders the voice tools use, `registry.ts:19-22`):
  - **`booking_created` undone** → `bookingCancelledEmail`/`bookingCancelledSubject` for `after.startsAt`;
  - **`booking_cancelled` undone** → `bookingConfirmationEmail`/`bookingConfirmationSubject`, with the booking's own `cancel_token`, `meeting_url`, `calendarFileUrl` and cancel URL (read by id on the service client), built as `registry.ts:509-522` builds them;
  - **`booking_rescheduled` undone** → `bookingRescheduledEmail` for the restored old booking's time and token, with `bookingMoveUrl`, as `registry.ts:620-636`.
- `sendEmailOrThrow` with `kind: "booking.undo_notice"`, `contactId`, `language`, `origin`.
- **The channel** is email: the one the voice path's own confirmation used (Q3).

**6. `classes.ts`: the owner's answer to Q2 is TRANSACTIONAL.**
- No class of that name exists. The five classes are listed at `:81`. `customer_initiated` cannot carry it: scan 4 (`scans.test.ts:805-814`) pins that class to "only where the customer acted", and a staff Undo is not that.
- So add a sixth member, `"transactional"`, to `EmailClass`, with exactly one kind: `"booking.undo_notice": { class: "transactional", hours: "any", footer: "unsubscribe" }`. It is a correction about the customer's own appointment:
  - an unsubscribe does not stop it (the gate reads the unsubscribe ledger for `informational` and `marketing` only, decision 7, which is unchanged);
  - it may go at any hour;
  - it carries the unsubscribe footer, as every customer email that is not a person's own words does;
  - stops, hard bounces and suppressions block it as they block every class.
- Every exhaustive switch over `EmailClass` gains the case (grep `EmailClass` and `.class ===`).
- `classes.test.ts` pins the class to that one kind (**mutation:** classify `automation.reminder` as `transactional` → **FAILS**).
- Scan 4 is unchanged.
- **This is the plan's reading of the owner's word.** If the orchestrator reads "transactional" as an existing class instead, Task 5 STOPS here.

**7. Loaders and rows:**
- `loadTimeline` (8b-2 `loaders.ts:61-98`) passes `aiActs: true`. After the page it runs:
  - `readActFacts` as a fifth soft read (a failure means every act is `unknown`, logged);
  - names for `personIdsOf(page.items)` PLUS every act's `undoneBy`, in the ONE `listPeopleNames` read.
- `TimelineLoad` gains `actFacts: ActFacts | null`.
- `loadRecent` and the group loader do not pass `aiActs`.
- `timelineRows` ctx gains `actFacts?: ActFacts | null`. `phrase`'s `aiAct` case returns `buildActView`'s verb and detail, and the row gains `act?: AiActView`.
- `authorOf` stays `ai` (Task 3).

**8. `undo-handlers.ts`:** pure, with `toast`, `refresh`, `navigate` and `schedule` injected (the `cancel-booking.ts` shape; no jsdom).
- `runFieldUndo` runs at once; on success it toasts `aiActs.toast.fieldUndone` with a 10-second `common.undo` action that calls `redoAiFieldFillAction`.
- `runBookingUndo(notify)` toasts told, not told or plain.
- `runContactUndo(typedName)` toasts `aiActs.toast.contactRemoved` and navigates to the list.
- A refusal toasts `aiActs.toast.notAvailable` with the reason words. A throw toasts `aiActs.toast.failed` with a reload action (8b-2's follow-up 1).

**Tests (each with its mutation, run):**
- **Kinds:**
  - `describe` in en, es and pseudo, with the dates typed out (never `formatWhen` in the assertion);
  - `stillSafe` true and false for every row of spec §4.2, each with its reason words, with a fixture zone far from the machine's.
  - **Mutation:** compare `startsAt <= now` with `<` → the boundary case **FAILS**.
- **Facts:**
  - one bookings read for three booking acts (assert the call count and its `.in` ids);
  - `heldBy` is not read when `canDelete` is false;
  - a thrown read rejects (the loader turns it soft).
- **Views:** the undone line names "You" for the viewer and "Someone on the team" unnamed; a web-chat act has no link. **Mutation:** link the chat source → **FAILS**.
- **`actions.live.test.ts`** (replica, `env-run.sh`):
  - a booking undo through the action cancels the booking, stamps the act, and with `notify: false` sends nothing (the fake email provider records no send) (**mutation:** ignore `notify` → **FAILS**);
  - with `notify: true` for a Spanish contact on an English account, the send is Spanish (subject typed out);
  - account B's action with A's act id answers `notAvailable` and writes nothing;
  - a Technician on an unassigned customer's act answers `notAvailable`;
  - the field undo when a person changed the value meanwhile answers `changed` and leaves their value;
  - the redo after an undo puts Sofía's value back, and a second redo answers `changed`;
  - the contact undo: a Staff member is redirected (Owner only); the wrong typed name writes nothing; the clean contact is removed and its call remains with `contact_id` null; a contact with a note answers `hasActivity`.
- **Loaders:**
  - `loadTimeline` passes `aiActs: true` and `loadRecent` does not (**mutation:** pass it in `loadRecent` → **FAILS**; `route.reads.test.ts` stays at `MEASURED = 31`);
  - a failed facts read leaves the rows with `unknown`;
  - `undoneBy` ids reach the names read.
- **Handlers:** the field toast's Undo calls the redo (**mutation:** drop the action → **FAILS**); a throw toasts the reload sentence.
- [ ] Typecheck, eslint, the touched tests by path, and the bare-factory grep with its additions. Commit `web: what Sofía did reads as a sentence with its source, each act says whether it can still be undone, and Undo puts bookings, fields and an untouched customer back, telling the customer in their language when asked (item 8c)`.

**Review (HIGH):** opus bis-reviewer on 55695-55697.
- It re-runs the live cases.
- It runs four probes of its own, one each:
  - a second-account act id;
  - a Technician;
  - a typed-name near miss;
  - a race: change the field between the facts read and the action.
- **Hunt:**
  - a `serviceDb` write without a request-client proof before it;
  - an undo that can run twice;
  - a booking undo bypassing the RPC;
  - a notice in the wrong language;
  - a log carrying words;
  - the drawer reading acts.

A re-review follows any change.

---

## Task 6 (LOW): The UI, the "Added by" fact, styleguide and baselines (bis-frontend)

**After:** Task 5. No per-task review (Task 9 covers it).

- **`components/ai-acts/act-row.tsx`** (server-safe): `aiAct` rows render through the existing `TimelineItem` with the AI mark (from `row.mark`), the verb and detail, the source line (a ghost text link to the call, or plain text for the chat), and on the right:
  - `available` → `<ActUndo/>`;
  - `blocked` → its line as muted text;
  - `undone` → its line;
  - `unknown` → nothing.

  Flat, inside the timeline's own card: no glass card, and **no primary** (DESIGN.md rule 8 as amended 2026-10-19).
- **`components/ai-acts/act-undo.tsx`** (`"use client"`), with three controls:
  - **field:** a ghost `common.undo` button that calls `runFieldUndo` at once (rule 6).
  - **booking:** a ghost `common.undo` that opens a Popover (radius `--radius-card`, overlay blur per DESIGN.md). Inside: the row's sentence; then either the checkbox `aiActs.notify.label` (pre-ticked; a real `<input type="checkbox">` with its label) or the `notify.none` line; then ONE primary `common.undo` (the popover is its own view) and a ghost `common.cancel`. Esc closes it, and focus returns to the trigger.
  - **contact:** a ghost `common.undo` that opens a Dialog. Title `aiActs.contactDialog.title`, body `aiActs.contactDialog.body`, an input whose value must match `purgeNameKey` (the `DocumentPurgeForm` shape, `…/contacts/document-purge-dialog.tsx:20-57`), primary `aiActs.contactDialog.confirm`, disabled until it matches, and ghost `common.cancel`.
  - Controls are `min-h-11 md:min-h-8` and focus-visible.
- **`activity-timeline.tsx`**: `case "aiAct"` renders `<ActRow/>`, replacing Task 3's plain row. `group-timeline.tsx` keeps Task 3's plain row: the group page never reads acts.
- **The "Added by" fact:** `factsView` (`lib/record/record-facts.ts:45-83`) takes `author: { kind: AuthorKind; label: string } | null` and pushes `record.facts.addedBy` after `record.facts.since`. `…/[contactId]/page.tsx` builds the label with `authorLabel(contact.author_kind, contact.author_id, …)`, and adds `author_id` to the ONE names read. A null `author_kind` (a row written before the deploy) omits the fact (omitted, never wrong; Task 10 step 9).
- **States:** the timeline card's own loaded, empty and error states are unchanged. A failed `ai_acts` source is named in the card's "Couldn't load …" line through `timeline.what.aiActs`.
- **Styleguide:** one specimen per control state (available field, booking with email, booking without email, contact, blocked, undone, unknown) in English, Spanish and pseudo. Pure specimens live in `lib/ai-acts/` or a non-client file, never called from a `"use client"` module on the server.
- **Baselines:** regenerate the i18n baselines (the command in `ratchet.test.ts`'s header). The diff adds only Task 2's keys; read it line by line.
- **Tests** (`renderToStaticMarkup`):
  - the row renders zero primary buttons and one ghost Undo;
  - the popover renders exactly one primary;
  - the checkbox renders checked;
  - the dialog's confirm is disabled until the typed name matches (`canPurge`);
  - `lang` is on the row;
  - the blocked line renders the reason words in both languages;
  - the "Added by" fact renders "Added by Sofía · AI" and "Agregado por Sofía · AI", and is absent for a null author.
  - **Mutation:** make the row's Undo `variant="default"` → **FAILS**.
- [ ] The bare-factory grep (Global constraints) and its additions. Typecheck, eslint, the touched tests and `src/lib/i18n/`. Commit `ui: Sofía's actions on the record's timeline with Undo, the notice choice and the typed-name removal, and who added each customer (item 8c)`.

---

## Task 7 (LOW): The e2e spec (bis-e2e-qa)

**Files:** create `apps/web/e2e/ai-acts.spec.ts`.

**Rules:**
- Fixture account only (`readClientFixture()`, `support.ts:103`); skip with a reason when null.
- Serial mode.
- Use the Owner session the contact-delete specs use (grep `bulk-action-bar`/`contacts` specs for it).
- Locators inside `page.getByRole("main")`, with exact role names.
- `afterAll` deletes every seeded act, booking, call, contact and conversation, checks each `error`, and re-reads.

**Seed** (service client): one contact C with a call K, and on C:
1. a future booked booking B1 with a `booking_created` act (`voice`, `call_id` K);
2. a filled-email act (C's email equals the act's `after.value`, `before` null);
3. a booking B2 already cancelled, with a `booking_created` act (overtaken).

Plus a second contact D, holding only call K2, its `ai` summary message and a `contact_created` act.

**Tests:**
1. **Booking undo, "Let them know" unticked:** on C's record, Undo on B1's row → the popover → untick → Undo → toast "Booking undone." → B1 reads `cancelled`, and the act has `undone_at` set with `undo_notified` false. The row reads "Undone by You · …".
2. **Field undo:** Undo on the email row → toast "Put back the email." → C's email is null. The toast's Undo → the email is back.
3. **Overtaken:** B2's row shows "Already cancelled" and no Undo button.
4. **Contact removal:** on D's record, Undo → the dialog → type D's name → Remove customer → the contacts list; D is gone; K2's `contact_id` is null.
5. **Spanish:** C's record with `?locale=es` shows "Deshacer" and the reason "Ya se canceló".
6. **360 px, `?locale=pseudo`:** no element in an act row or the popover overflows (`overflow-check.ts`, skipping `.sr-only`).

- [ ] `pnpm --filter web exec playwright test --list e2e/ai-acts.spec.ts`, typecheck, eslint. Commit `e2e: Sofía's booking undone without telling the customer, a filled email undone and put back, an overtaken act's reason, an untouched customer removed, Spanish and 360 px (item 8c)`.

---

## Task 8 (LOW): Decision 19's dated wording amendment (bis-crm)

**Files:** `docs/crm-features.md` only.

- **Decision 19** (`:3080-3112`): after the "Decided 2026-10-05" bullet, add a bullet:

  > **Amended 2026-10-19 (owner, item 8c, D1):** a caller stating their own name, email or number, written into the BLANK fields of the record matched to their own phone number, is "leaving their own name and number" under (a). It stays live, is stamped "Sofía · AI" on the record's timeline, and is undoable. Anything Sofía infers beyond what the caller said stays a tray suggestion (8b's `contact_field` kind). The web chat's fill of a returning visitor's blank fields is recorded the same way.

  Leave the 2026-10-05 text as written.
- **§3.2 rule 4** (`:942`): replace "Until decision 19 is dated, Sofía's filling of blank fields on an existing contact becomes a proposal of the existing `contact_field` kind" with "Sofía's filling of blank fields with what the caller said, on the record matched to their own number, runs live, stamped and undoable (decision 19, amended 2026-10-19); what she infers beyond that becomes a proposal of the existing `contact_field` kind". Nothing else in the cell changes.
- **`:842`'s defect row:** mark it resolved by the amendment, citing `registry.ts:451-453`, the new act recording and "item 8c".
- **`:142` and `:3028`:** align the one clause each that says blank-fills become proposals, citing the amendment.
- [ ] Read the diff: only these five places change. Commit `docs: decision 19's wording amended 2026-10-19 — a caller's own name and number into their own record's blank fields stays live, stamped and undoable (item 8c, D1)`.

---

## Task 9: Final review, design review, one fix agent (checkpoint)

- [ ] **bis-reviewer, opus, fresh context, on `git diff <Task 0 merge>...HEAD`** (replica 55691/55698/55699).
  - Read spec §§3-10 and this plan.
  - Run every touched test file by path, both typechecks, the db suites Tasks 1 and 3 named on `post`, and `actions.live.test.ts`.
  - Run three probes of its own: one in `ai_contact_held_by`'s table list, one second-account probe, one primary-count probe on the row.
  - Re-check 0091's md5.
  - **Hunt:**
    - the drawer or group page reading acts;
    - a `Row` switch without its `never` default;
    - a voice site whose failure behaviour changed;
    - an act recorded on a dedupe hit;
    - the public form recording chat acts;
    - a booking undo that can double-book;
    - a contact deletion that can lose a person's note;
    - a log carrying words;
    - an e2e locator outside `main`;
    - a vacuous test.
- [ ] **bis-design-reviewer, opus**, on Task 6's diff, with a running build if the orchestrator provides one (source audit otherwise). Check:
  - the DESIGN.md definition of done, and rule 6 (field at once with Undo; booking popover; typed name for the removal);
  - rule 8 (no primary on the row; one in the popover; one in the dialog);
  - provenance (every act row carries the AI mark; "Undone by" names a person or "Someone on the team");
  - both themes and the blur fallback on the popover;
  - 360 px pseudo;
  - the 7 AM read of every reason line in both languages.
- [ ] **ONE fix agent** takes both reports' Critical, Important and agreed Minor items, then one sonnet fix-review. **0091 goes to production only with its reviewed md5 UNCHANGED.** 0091 reached bis-ci at Task 10 step 1 and is never re-applied there, so any SQL change found after that is a new migration (0092), reviewed HIGH, never an edit of 0091.

---

## Task 10: Rollout (orchestrator)

Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **1. bis-ci 0091** (after Task 1's review approves it):
  - `gh workflow run ci-project-setup.yml --ref feat/item8c-ai-acts -f step=push-dry-run`. Its log lists exactly `0091_ai_acts.sql`. Then `-f step=push`. Its NOTICEs (the backfill buckets) equal Task 0's bis-ci counts (A5).
  - Read-only post-checks:
    - `to_regclass('public.ai_acts')`;
    - the three functions' `prosecdef`, `proconfig` and `proacl`;
    - `select count(*) from public.contacts where author_kind is null` (0);
    - the digest UNCHANGED.
  - Ledger: `0091 APPLIED to bis-ci … NEVER RE-APPLY`.
- [ ] **2. Push and CI.** Read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). `ai-acts.spec.ts` must have run. Then the local gates, one at a time, after checking that no `screenshots.yml` run is in progress.
- [ ] **3. Preview by hand** (bis-ci, a test account, never Test Client One):
  - the timeline rows in both themes, English and Spanish, at 360 px;
  - the popover and the dialog;
  - a Technician sees acts only for an assigned customer and gets no contact Undo.
- [ ] **4. Production 0091** (MCP `apply_migration`, `tlbkbmlrfafquucsmsmm`, name `ai_acts`, the exact reviewed text, ONCE). It goes BEFORE the merge.
  - Pre-flight: `max(version)` = Task 0's.
  - Post:
    - the same reads as step 1;
    - the NOTICE buckets equal production's Task 0 counts (`ai` 4, `customer` 2 minus the chat leads, `ai` plus the chat leads, `import` 40, `person` 5);
    - `author_kind is null` = 0.
  - Ledger: `0091 APPLIED … NEVER RE-APPLY`.
- [ ] **5. Parity.** Runbook §5 (`docs/runbooks/ci-supabase-project.md:184-206`): `-f step=fingerprint` on bis-ci, and `packages/db/supabase/parity/fingerprint.sql` on production. Equal on `ai_acts`, the two contact columns and their checks, the guard trigger, and the five functions' `prosrc` md5s and ACLs.
- [ ] **6. PR and merge.** The PR body names:
  - D1–D5 (owner-approved);
  - the owner answers to Q1–Q4;
  - the ambiguities resolved below;
  - §7's findings and G1's fix;
  - both apply lines;
  - "No env var changes; nothing added to Preview".

  Merge with the head SHA's `verify` and `e2e` green: `gh pr merge <n> --squash --match-head-commit <sha>`.
- [ ] **7. After the deploy:**
  - The deployment is READY on the merge SHA and aliased to `app.bis-rgv.com`.
  - Smokes: `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404.
- [ ] **8. Owner smoke** on BIS's own account (memory "Smoke identities"):
  1. One real call to the BIS line that books a time. Read-only: `select kind, actor, call_id is not null, undone_at from ai_acts where account_id = '<bis>' order by created_at desc limit 5` shows `booking_created` (and `contact_created` when the caller was new).
  2. On the caller's record, the row reads "Sofía · AI booked …" with "From the call on …".
  3. Undo → untick "Let … know by email" → Undo. The toast reads "Booking undone." The booking is cancelled on the Calendar, no email reaches the caller, and the row reads "Undone by You · …".
  4. Read-only: `undo_notified = false`, and `undone_by` is the owner's id.
- [ ] **9. Null authors.**
  - Read-only, the day after the deploy: `select count(*) from public.contacts where author_kind is null` on both projects (contacts the old build inserted between the apply and the deploy).
  - A non-zero count is the follow-up `0092_contacts_author_not_null.sql`: re-run `app.backfill_contact_authors()`, then `set not null` (0074's shape). It is named in the ledger and in `bis-next-work`, not in this PR. Until then the header omits the fact for those rows.
- [ ] **10. Tracker** (memory "Roadmap tracker"):
  - item rows: **F-022 → `done`** (evidence: the PR, 0091);
  - subprojects: **ITEM8 → `done`** (8a #270/#271, 8b-1 #273, 8b-2 #…, 8c #…);
  - decision 19's row: note the 2026-10-19 amendment;
  - confirm **S-14** reads `done` (8b-2 set it) and correct it if not;
  - bump `meta/plan` asOf and mainSha.
  - Ledger `8c DONE`.

---

## Owner decisions (2026-10-19, answering the plan's Q1–Q4; Q5 stays conditional)

- **Q1 → `import`. YES.** The demo and CI seeds' contacts read "Import".
- **Q2 → TRANSACTIONAL**, not `staff_typed`. The plan's reading is in Task 5 item 6: a new class `transactional` holding the one kind `booking.undo_notice`. An unsubscribe does not stop it, it may go at any hour, and it carries the unsubscribe footer.
- **Q3 → email only.** With no email on file, the panel says to call them (`aiActs.notify.noEmail`). No text message.
- **Q4 → a contact Sofía created who also has a booking STAYS.** The contact undo is refused with its own reason (`aiActs.reason.hasBooking`, "Has a booking, so it stays. Delete it the usual way if it has to go."). The SQL answers `has_booking`.
  - **Note for the owner's wording:** the usual delete (`deleteContacts`, `contacts.ts:1101-1107`) also skips a contact holding any booking, cancelled or not (`skippedBlocked`). "The usual way" therefore means after the booking itself is dealt with elsewhere; the copy stays as decided.
  - **Most web-chat leads are never removable by Undo either** (review minor): `enrich`'s instant reply writes an automation-authored outbound text into the thread (`sendInstantReply`, `enrich.ts:234` → `automations/send-sms.ts:135`). A lead with a business name gets a `client_group_members` row (`enrich.ts:136`). Both count as other activity. The Undo then shows its reason; this is D4 working as decided.
- **Q5 (conditional):** if Task 0 read 3 is non-zero on production, Task 0 STOPS for the owner.

## The questions as they were put (kept for the record)

- **Q1. The demo tenant's 40 seeded contacts** (`user:system_demo_seed`, #272), and bis-ci's `system_ci_seed`: mapped to **`import`** ("Import" on the record), in the backfill and for every future seed run, through `contactAuthor`'s `SEED_ACTORS`. Without this they would read as an unnameable person ("Someone on the team"). Recommendation: `import`, as the coordinator advised. The alternative is `automation`.
  - The seed writes contacts through `createContact` (`demo/seed.ts:437-440`, actor `ACTOR` = `"system_demo_seed"` at `:33`, default actor type `user`; CI seed `ci-seed/seed.ts:213-215`, `CI_SEED_ACTOR` with type `system`). So the new columns are set going forward with no seed edit.
- **Q2. The undo notice's email class.** `staff.booking_undo_notice` = `staff_typed`, any hours, no unsubscribe footer: the precedent of the Calendar's `staff.booking_cancel_notice` (`classes.ts:99-103`), which an unsubscribe also never stops. But this notice's TEXT is ours, not a person's typed words, and `staff.document_request_email` (`:104-105`) took `informational` for exactly that reason. The default is `staff_typed`, because a person decides it in the moment about the customer's own appointment. Owner: confirm, or choose `informational` (automated hours, unsubscribe footer).
- **Q3. "Let {name} know by {text|email}": email only.** The app has no booking cancellation or confirmation TEXT to reuse: the only booking SMS is the 48-hour confirmation ask (`automations/passes/appointment-confirm.ts`). The voice path confirms by email (`registry.ts:509-534`), so email IS "the channel the booking already uses". A customer with no email is not offered a notice; the popover says to call them. Adding a text would need a new SMS message kind under the send gate and A2P: a later item.
- **Q4. A customer Sofía created AND booked in the same call can never be removed by Undo.** `bookings` is `on delete restrict` (`0050_same_account_fks.sql:102`), and a cancelled booking is history. So even after the booking's own Undo, the contact undo reads "Has other activity since". Default: as written (strict D4). The alternative is to treat a booking whose own act is undone as hers and delete it with the contact: a destructive widening this plan does not take on its own.
- **(Conditional) Q5.** If Task 0 read 3 (`contact.imported` events on production) is non-zero, those contacts backfill as `person`. Task 0 STOPS for the owner.

## Spec ambiguities resolved here (not owner-level)

- **A. How `enrich` tells chat from form:** it does not today (`enrich.ts:35-48`; both callers pass `"form"`/`"system"`; `lead.ts:155-158`'s `authorKind: "ai"` lives on the submission, not on `enrich`). A ninth optional parameter, passed only by `lead.ts:170`, is the discriminator (Task 4).
- **B. "Through the existing contact-delete path"** (spec §4.2, §5.2): `deleteContacts` (`contacts.ts:1086-1141`) refuses any contact with a non-empty conversation (`:1125-1130`). Sofía's own call summary is always in one (`finish-call.ts:420-431`), so that path can never delete her contact. 8c therefore keeps the path's **rules**:
  - Owner only (`requireAccountOwner`, 0066);
  - ids proven on the request client;
  - documents block (no file purge is ever needed).

  It adds one SQL function that checks and deletes in one transaction, with the lock-then-fresh-snapshot shape of `delete_empty_conversations`. The confirmation is a **typed name** (spec, DESIGN.md rule 6), not the bulk dialog's typed count (`bulk-action-bar.tsx:114-116`).
- **C. "The timeline's creation row":** no contact-creation timeline row exists (8b-2 `record.ts:274-348`). The created-by mark appears in the record's facts line ("Added by …"). For Sofía's contacts, the `contact_created` act row on the timeline is the creation row.
- **D. Which fields are acts:** the four columns of 8b's `contact_field` kind (first name, last name, email, phone), one act row per field written. The chat's custom fields, business and attribution fills are not acts (they are form data, not Sofía's judgement).
- **E. A voice act with no call row** (`callRowId` null, "startCallRow failed open") is not recorded: the source CHECK needs a call. The skip is logged. The booking or contact still carries its AI author.
- **F. The field Undo's own Undo** (spec §5.2's 10-second toast that "puts Sofía's value back") is a compare-and-swap redo that clears the stamp. Spec §3's "no undo of an undo" binds the booking and contact acts only.
- **G. Contact undo is Owner-only** (deletion is, `requireAccountOwner` and 0066). Others see "Only an Owner can remove a customer" instead of an Undo.
- **H. Still-safe is computed twice:** a pure display check from one batched facts read (the timeline's), and the authoritative check inside the SQL function or the CAS. This refines spec §4.2's `stillSafe(db, act)` into `readActFacts` + a pure `stillSafe`. A display that is wrong (a Technician who cannot see an overlapping booking) is refused by the write, never acted on.
- **I. Reasons beyond §4.2's table:** "That time is taken now" (a cancelled booking's slot taken since; §10), "Changed since" (a version moved), "Only an Owner can remove a customer".
- **J. A removed contact leaves no "Undone by" row:** its acts cascade with it, and the record page is gone. The toast and the list say what happened.
- **K. `undo_notified`** is set by a second write, after the email gate accepted the send. A failed send leaves it false, and the toast says the email did not go out.
- **L. The source name is `ai_acts`** and the entry kind is `aiAct` (TypeScript's camel case beside the spec's source name).

## Spec coverage

| Spec | Where |
|---|---|
| §1, D2 undoable until overtaken, the reason line | Tasks 1 (functions), 5 (kinds, views), 6, 7 test 3 |
| D1 blank-fills live and stamped; the decision 19 amendment | Task 4 (field acts), Task 8 |
| D3 "Let {name} know?", pre-ticked, the customer's language | Task 5 (`notify.ts`, live test), Task 6, Task 7 test 1; Q2, Q3 |
| D4 contact deletion only while untouched; the call stays unlinked | Task 1 cases 9-10, Task 5, Task 7 test 4; ambiguity B, Q4 |
| D5 `ai_acts` + the kind registry | Tasks 1, 3, 5 |
| §4.1 the table, its RLS, immutability, indexes | Task 1 |
| §4.3 `recordAct` best-effort, every call site | Task 4 |
| §5.1 the record-page source, flat rows, ghost only, "all failed" | Tasks 3, 5, 6 |
| §5.2 the three Undo interactions, who may undo | Tasks 5, 6; ambiguities F, G |
| §5.3 `contacts.author_kind`/`author_id`, the backfill, the header | Tasks 0, 1, 3, 6, 10 steps 4 and 9; Q1 |
| §6 the inventory | Task 4's table (current lines) |
| §7 every booking change reaches the business | Task 4 §7 (G1) |
| §8 tests | Tasks 1, 3, 4, 5, 6, 7 |
| §9 rollout and the owner smoke | Task 10 |
