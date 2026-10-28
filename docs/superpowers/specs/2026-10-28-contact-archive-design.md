# Contact archive, internal-only delete, and no "Unknown" names: design

Date: 2026-10-28. Author: bis-crm. Base: `a932a2dd` (branch `feat/contacts-archive`).
Status: design for review. Nothing here is built yet. Migration number: **0103** (another lane holds 0102).

Every claim about current code cites `path:line` at `a932a2dd`. The brief gave `contacts.ts:1024-1055` and
`actions.ts:468` for the delete; at this base they are `packages/db/src/contacts.ts:1218-1268` and
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts:476-524`. This spec uses
the source's numbers.

Paths below shorten `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/` to `ACCT/`.

---

## 1. The problem, as the code has it

The owner bulk-deletes a junk contact and gets "Deleted 0 · skipped 1 linked to bookings, deals, or
conversations".

- `deleteContacts` (`packages/db/src/contacts.ts:1218-1268`) blocks any contact with an opportunity or a
  booking (`:1228-1235`) or with any conversation left after empty ones are cleared (`:1246-1259`).
  An empty conversation is one with no message and no inbound email (`:1170-1172`, migration 0083 §3).
- The three "Caller" contacts each have a conversation holding our missed-call text, so they are blocked
  for good. That is correct: the text is carrier and consent evidence. What is missing is any way to put
  them out of sight.
- The toast is `bulk.deletedSkipped` / `bulk.deletedSkipped.es` (`apps/web/src/lib/messages.ts:696-699`),
  fired by `announceDeleteResult` (`ACCT/contacts/bulk-action-bar.tsx:155-170`). It names a cause and
  offers no next step.
- 114fb9ad's first name is "Unknown". Section 7 traces how that happened.

There is a precedent for "a contact that exists but is not on the list": `holds_shared_number`
(migration 0098, `packages/db/supabase/migrations/0098_shared_number_holding.sql:67-68`). Its call
sites are a ready-made inventory of the reads that hide a contact: `listContacts`
(`contacts.ts:915`), `countContacts` (`:1022`), dedupe (`:290`, `:356`, `:428`), the agency dashboard
(`apps/web/src/app/(dashboard)/dashboard/page.tsx:20`), `createOpportunity`
(`packages/db/src/opportunities.ts:22-24`) and the inbox reads (`packages/db/src/messaging.ts:63-68`).
Archive follows the same pattern, with one deliberate difference: **dedupe still matches an archived
contact** (§3.3).

---

## 2. The owner's rulings, restated as rules

1. **Archive** is the everyday action. It is in the contacts bulk bar, the record page header and the
   drawer header. It runs at once with an Undo toast (DESIGN.md rule 6). An archived contact leaves the
   list, its total and search. An **Archived** view lists archived contacts and can restore them.
   Nothing is erased: conversations, texts, calls, bookings, deals and files stay on the record.
2. **Delete for good** is allowed ONLY for a contact whose record holds nothing but internal work (§5.1).
   It needs a typed-name confirm (rule 6). Every other contact is archive-only, and the screen says why
   in plain words (§6).
3. Sofía never stores a placeholder ("Unknown", "Desconocido", "N/A" and the like) as a name (§7).
4. The "skipped" toast reads plainly in both languages and offers Archive (§6.3).

---

## 3. Data model: migration 0103

### 3.1 `0103_contact_archive.sql`

Written to 0098's conventions (`0098_shared_number_holding.sql:1-58`): a header with WHY / WHAT /
GRANTS / SEARCH PATHS / LOCKS / LOAD-BEARING / ROLLBACK, ASCII only, `lock_timeout` 5s in a `do`
block, and every definer with `set search_path = pg_catalog, pg_temp` (the 0096 rule).

**1. Columns on `public.contacts`.**

```sql
alter table public.contacts
  add column archived_at timestamptz,          -- null = on the list
  add column archived_by text;                 -- Clerk user id of who archived; null when on the list
alter table public.contacts
  add constraint contacts_archived_by_needs_at check (archived_by is null or archived_at is not null);
```

Both columns are nullable with no default, so the ADD COLUMN only touches the catalogue. It still takes
ACCESS EXCLUSIVE briefly, which the 5s `lock_timeout` bounds.

**2. The history: `public.contact_archive_log`** (append-only). The timeline needs who did what and when
(DESIGN.md, Provenance). Two columns on `contacts` hold only the latest state, and an automatic restore
(§4) needs its own row.

```sql
create table public.contact_archive_log (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  contact_id uuid not null,
  action text not null check (action in ('archived', 'restored')),
  author_kind text not null check (author_kind in ('person', 'customer')),
  author_id text,                                -- Clerk id when author_kind = 'person'
  sign text check (sign in ('text', 'email', 'call', 'booking', 'form', 'chat')),
  created_at timestamptz not null default now(),
  constraint contact_archive_log_sign_shape check ((author_kind = 'customer') = (sign is not null)),
  constraint contact_archive_log_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade
);
create index contact_archive_log_contact on public.contact_archive_log (account_id, contact_id, created_at desc, id desc);
```

`on delete cascade`: the log is about the record, not evidence of anything sent, so it goes with a
contact that is deleted for good.

**3. RLS and grants.**

- `contact_archive_log`: RLS on. One SELECT policy for `authenticated`:
  `exists (select 1 from public.contacts c where c.account_id = contact_archive_log.account_id and c.id = contact_archive_log.contact_id)`.
  The subquery runs under the contacts policies, so a Technician sees only the log rows of contacts
  assigned to them (`0068_mine_unassigned_technician.sql:103-107`). No INSERT, UPDATE or DELETE grant
  for `authenticated` (the 0053 rule).
- `grant update (archived_at) on public.contacts to authenticated;` is the only new column grant.
  `archived_by` is never client-writable; the trigger in step 4 sets it.
- The guard tests change by exactly this grant: `EXPECTED_WRITES` for contacts in
  `packages/db/src/test/schema-grants-guard.test.ts:86-89` gains `archived_at`. The client-write digest
  in `packages/db/src/test/proposals-drop.test.ts:100` (`52|b66203ca...`) does NOT change: it counts
  table-level privileges only (`has_table_privilege`, `:94-98`; column grants "do not count here",
  `:91-92`), and the new table gets no client write. (Corrected 2026-10-28 while planning.)
- `contact_archive_log` takes Supabase's default privileges on create, so the migration says
  `revoke all on public.contact_archive_log from anon, authenticated; grant select ... to authenticated;
  grant select, insert, update, delete ... to service_role`, the 0091 pattern (`0091_ai_acts.sql:116-119`).

**4. Stamp trigger `app.contacts_archive_stamp()`.** A plain trigger (not a definer), `BEFORE UPDATE OF
archived_at`, with the same shape as `app.contacts_holding_server_only` (`0098:86-106`). For
`current_user = 'authenticated'`, when `archived_at` changes:

- archiving (the new value is not null): `new.archived_at := now()`, so a client can never back-date an
  archive, and `new.archived_by := nullif(app.jwt() ->> 'sub', '')` (the same actor expression as
  `record_event`, `0053_server_only_writes.sql:71`);
- restoring (the new value is null): `new.archived_by := null`;
- refuses (42501) when `old.holds_shared_number`. A holding record is never on the list, so archiving it
  means nothing;
- refuses (42501) when `app.is_technician(new.account_id)` (owner ruling Q3, 2026-10-28: Technicians may not archive).

For any other role (service_role, or a definer's owner) it changes nothing.

**5. Log trigger `app.contacts_archive_log()`.** SECURITY DEFINER (so it can insert into a table
`authenticated` cannot write), `AFTER UPDATE OF archived_at`,
`when (old.archived_at is distinct from new.archived_at and current_user = 'authenticated')`. It inserts
one row: `action`, `author_kind 'person'`, and `author_id` = `new.archived_by`, or on restore
`nullif(app.jwt() ->> 'sub', '')`. **The role test must be in the trigger's WHEN clause, not the
function body.** WHEN is evaluated in the caller's context. Inside a SECURITY DEFINER body,
`current_user` is the function's owner, so a test there would never be true and staff archives would
never be logged. Server-side restores (step 6, itself a definer, so its UPDATE's `current_user` is not
`authenticated`) write their own row, so nothing is logged twice.

**6. `public.restore_contact_on_sign(p_account_id uuid, p_contact_id uuid, p_sign text) returns boolean`.**
SECURITY DEFINER, EXECUTE to `service_role` only. It runs
`update contacts set archived_at = null, archived_by = null where account_id = p_account_id and id = p_contact_id and archived_at is not null returning id`.
If a row changed, it inserts one log row (`'restored'`, `'customer'`, `p_sign`) and returns true. An
active contact returns false and writes nothing.

**7. `public.contact_delete_blockers(p_account_id uuid, p_contact_ids uuid[]) returns table (contact_id uuid, reasons text[])`.**
SECURITY DEFINER, EXECUTE to `service_role` only, `stable`. It refuses more than 500 ids (22023). It
returns ONE row per blocked contact, with every §5.1 reason it has in `reasons`. Each reason is an
`exists (...)`, so it reads no rows, and the answer is at most 500 rows, under PostgREST's `max_rows`
cap of 1000. (Corrected 2026-10-28 while planning: one row per contact and reason could reach 4,000 rows
for 500 ids, past the cap, and the truncated answer would read as "no blocker". That is fail-open.) That cap was the CRITICAL in
`contacts.ts:1177-1183`. It is a definer on purpose: a plain function would read `consent_events` and
`automation_log` under the caller's RLS, and a row the caller cannot see would read as "no blocker". A
blocker check must never fail open (see the `plpgsql NULL guard` lesson). The app proves the ids
against the request client first, as `deleteContacts` does today (`contacts.ts:1236-1242`).

**8. `public.delete_internal_contacts(p_account_id uuid, p_contact_ids uuid[]) returns uuid[]`.**
SECURITY DEFINER, executable by `authenticated` and `service_role`. It keeps the DATABASE's Owner check
(review I9, 2026-10-28), written as `if not coalesce(<the whole test>, false)`. The outer coalesce is
load-bearing (re-review Critical): `app.current_account_id()` is NULL when client access is off
(`0008_client_access.sql:13-18`), while `is_account_owner` stays true (`0066:52-66`). Without it the test is
NULL, and `IF NULL` never raises. It refuses (42501) unless the caller is an Owner of this account
(`app.is_account_owner(p_account_id)`, `0066_staff_and_roles.sql:63-66`, the agency included, with the 0066
policy's own `p_account_id = app.current_account_id()` term), or server code with a `service_role` JWT.
PostgREST verifies the token before it sets `request.jwt.claims`, so a client cannot claim that role. The
e2e cleanup (`shared-number.spec.ts:136`) and the live suites call it so. The app calls it on the request
client. It locks the contacts `for update` in id order, then their
conversations in id order, then re-runs the step 7 checks inside the lock: each statement gets a fresh
snapshot under READ COMMITTED, the same lock-then-fresh-snapshot approach `delete_empty_conversations`
uses (0083 §3; read it before writing this). For each contact still unblocked, inside its own
`begin ... exception` block:

1. delete that contact's `messages` with `channel = 'note'`;
2. delete its conversations, which are now empty;
3. delete the contact. Every cascade in §5.2 follows.

A `documents_contact_fkey` violation (`0077_document_vault.sql:76`, NO ACTION) means a file survived the
purge. That contact alone is kept, not the whole batch. The function returns the ids it deleted.

**9. Index.** `create index contacts_account_archived_created on public.contacts (account_id, created_at desc, id desc) where archived_at is not null;`
It is keyed on the Archived view's DEFAULT order (`created_at desc, id desc`, `SORT_COLUMN` at
`contacts.ts:790-794`), so it serves that view's first page and its count (review M4: an index on
`archived_at` serves no order the list uses). The name and company sorts use the existing sort indexes
with the filter; measure before adding more. The main list gets no new index: its
queries already use `contacts_account_created` (`0003_crm_core.sql:19`) and `contacts_account_sort_name`
(`0030_contacts_sort_name.sql:26`), and `archived_at is null` is a cheap heap filter while archived rows
are a minority. Measure with `explain` on the replica before adding a partial index for the main list.

**10. The inbox column (owner decision 2026-10-28, review I8).**
`conversations.contact_archived boolean not null default false` follows the contact:
- an AFTER UPDATE OF `archived_at` trigger on contacts (definer) sets it on that contact's conversation;
- a BEFORE INSERT OR UPDATE trigger on conversations (definer) re-derives it from the contact on EVERY
  write, so a value left stale by a concurrent archive heals at the conversation's next touch.

Adding the STORED generated column rewrites `conversations` under ACCESS EXCLUSIVE, which briefly blocks
inbound filing. The plan's T1 measures the rewrite on the replica. The orchestrator reads production's row
count at apply time and applies off-peak above 100,000 rows.

`conversations.inbox_visible boolean generated always as (not contact_archived or unread_count > 0) stored`
is the one column the inbox and search filter on. A PostgREST `or` cannot span a conversation column and an
embedded contact column, and `listConversations` already spends its one `or` on the cursor. Authenticated
gets no grant on either column.

**11. Definers.** Six new definers are added by name to `EXPECTED_DEFINERS` in
`packages/db/src/test/definer-search-path.test.ts:27`: the log trigger (step 5), the two inbox triggers
(step 10), and steps 6, 7 and 8. The count is 23 at this base (`:68`); add 6 to whatever 0102 leaves it
at. Two more tests pin contacts' column grants exactly and gain `archived_at`:
`contacts-marketing-optout-schema.test.ts:69-72` and `server-only-writes-grants.test.ts:130-133`
(review I2).

`contact_archive_log` has no account FK; it cascades with its contact. It is listed in
`ACCOUNT_OWNED_TABLES` (`packages/db/src/account-teardown.ts:20-37`) before `contacts` anyway, as
`record_summaries` is, so the list stays the account's whole set of tables (review M9).

**12. ROLLBACK** (roll the app back first): drop the inbox triggers, their functions and the two
conversations columns; drop the four functions and two archive triggers, the index, the log table and the
constraint; `revoke update (archived_at)`; then drop both contacts columns. Archived contacts then read as
ordinary contacts again.

### 3.2 Order of landing

0103 is LOAD-BEARING in the same way as 0098 (`0098:44-46`). The app after it names `archived_at` in
`COLS` and in every list read, so the app merges only after 0103 is on production. Apply 0103 to bis-ci
only after 0102 is there (numeric order; the `e2e` migration check, `.github/scripts/ci-migrations-applied.sh`),
then production, then the parity check (`docs/runbooks/ci-supabase-project.md`).

### 3.3 Dedupe still matches archived contacts

`findDuplicate` (`contacts.ts:280-292` and the legacy-key read at `:356`) keeps matching archived
contacts, and so does the import's match index (`packages/db/src/contact-import.ts:41-49`). A returning
customer must land on their own record, with their history and the conversation that already holds our
texts. Skipping archived contacts here would create a duplicate person and split their thread in two.
What a match does is decided per caller (§4).

---

## 4. Reads that hide archived contacts, and what happens when one comes back

### 4.1 The reads

| Read | Where | Change |
|---|---|---|
| Contact list | `listContacts`, `contacts.ts:906-953` | New option `archived?: "exclude" \| "only"`, default `"exclude"`: `.is("archived_at", null)` or `.not("archived_at", "is", null)`. Same sorts, same cursor. |
| Its real total | `countContacts`, `contacts.ts:1017-1029` | The same option, applied by one shared `withArchived` helper used by both, as `withAssignee` is (`:888-890`), so rows and total can never disagree. |
| Contact columns | `COLS`, `contacts.ts:78-79` | Add `archived_at, archived_by` inside the single literal (the comment at `:62-70` explains why it must stay one literal). |
| Contacts page | `ACCT/contacts/page.tsx:182-185` | `?view=archived` passes `archived: "only"` to both calls. The header states the archived total. |
| Command palette / search | `apps/web/src/app/api/accounts/[accountId]/search/route.ts:95` | Covered by the `listContacts` default; no code change. Add a test. Calls and conversations hits are §4.3. |
| Pickers | deal picker `ACCT/pipeline/page.tsx:26`, household picker `ACCT/contacts/relationship-actions.ts:238` | Covered by the default. |
| CSV export | `ACCT/contacts/export/route.ts:128` | Exports the view it was opened from (`view=archived` passes `"only"`). The default export leaves archived contacts out, matching the screen. |
| Account dashboard total | `ACCT/dashboard/page.tsx:148` (`countContacts`) | Covered by the default. |
| Agency dashboard total | `apps/web/src/app/(dashboard)/dashboard/page.tsx:20` | **Deferred** (coordinator, 2026-10-28). Until it lands, that agency-only tile counts archived contacts. |
| To do, per account and agency-wide | `ACCT/tasks/page.tsx:166-175`, `apps/web/src/app/(dashboard)/dashboard/work/page.tsx:157-165` | **Not hidden.** Select `archived_at`; the contact's name gains the word "Archived" (§6). Hiding a To-do would hide work silently. Staff close it or restore the contact. |
| Inbox and search | `listConversations` (`messaging.ts:646`), `searchConversations` (`:913`) | **Owner decision, 2026-10-28 (review I8): an archived contact's thread leaves the inbox and search ONLY while nothing in it is unread.** A customer's words are never hidden. A junk caller's thread holds only our outbound text-back (unread 0), so it disappears. Both filter `inbox_visible` (§3.1 step 10). Search filters in its messages read, BEFORE its five-thread cap (review M2). |
| Unread badge | `sumUnreadCount` (`:629`) | **Unchanged.** Every thread with unread messages is visible by the rule above, so the badge already counts exactly what the inbox shows. |
| Record page and drawer | `getContact`, `contacts.ts:955-960` | **Unchanged.** A deep link still opens an archived contact, which shows the archived banner (§6). |
| Weekly report and dashboard metrics | `weeklyMetrics`, `apps/web/src/lib/reports/weekly-metrics.ts:165-191` | **Unchanged.** They count events (answered calls, lead instants, bookings, visitors), not people. A report already sent must not change after the fact, and archiving a hang-up does not un-answer the call. |
| Calls log and calls search | `searchCalls`, the calls page | **Unchanged.** A call is a fact of the phone line, and the calls log must reconcile with "Calls answered". |

### 4.2 An archived contact comes back: restore automatically

**Recommendation: restore automatically on the customer's own sign, and record the new activity on the
restored record.** A timeline row says why ("Came back: sent you a text").

Why: the two possible failures are not equal. If the contact stayed archived, a returning customer's new
lead, booking or text would land on a record that is in no list, no search and no inbox (dedupe sends it
there, §3.3), and that is a lost customer nobody can see. If it restores, the worst case is a junk
caller who reappears, and one click archives them again. The first failure is silent and costs revenue;
the second is visible and costs a click.

**Signs that restore** (owner ruling Q1, 2026-10-28). Each is the customer's own act, recorded through
`restore_contact_on_sign` on the service client:

| Sign | Site | `p_sign` |
|---|---|---|
| A call Sofía answered that ended booked, lead or message (`isMeaningful`, `apps/web/src/lib/voice/finish-call.ts:166-170`), on the contact `resolveContactId` returns (`:350`; used at `:599`) | finish-call | `call` |
| A booking Sofía made (`book_appointment`, `apps/web/src/lib/voice/tools/registry.ts:453`, contact at `:569`/`:590`) | registry | `booking` |
| A booking on the public page (`apps/web/src/app/b/[publicId]/actions.ts:305`) | booking page | `booking` |
| An inbound text, unless `classifyInbound` (`apps/web/src/app/api/sms/inbound/route.ts:333`) marks it as a consent change (`CHANGES_CONSENT`, `:49`: STOP, START, HELP, a stop phrase) or Telnyx's own autoresponse, **and unless it reads as a phone's auto-reply** (`looksAutomaticText`: a CLOSED English and Spanish phrase list matched on word boundaries, such as "I'm driving", "this number cannot receive texts", "estoy manejando" or "respuesta automática"; review I7, owner decision). A robocaller's number that answers our text-back automatically stays archived. | SMS inbound route, INSIDE the filing try, BEFORE the message is written (re-review). There a failure files nothing and answers 503, and Telnyx's retry files the whole text, its unread included. After the write, the retry would skip the unread bump. It runs on every delivery, idempotently. | `text` |
| An inbound email filed by the pipeline as the customer's (not a teammate's forward, not a stop, not a duplicate) | `apps/web/src/lib/email/inbound/pipeline.ts` (`resumeExisting`), **never** `file.ts`: `fileHeldEmailAction` (`conversations/inbound-actions.ts:149`) also calls `fileInboundEmail`, and a teammate's manual File is a staff act, not the customer's (review I6). Automatic mail never gets this far: `classifyAutomatic` drops it before filing (`pipeline.ts:200-211`). | `email` |
| A form submission linked to the contact | `apps/web/src/lib/forms/enrich.ts:108` | `form` |
| A web chat lead | `apps/web/src/app/api/concierge/[publicId]/turn/route.ts` (its `createContact`) | `chat` |

**Never restores:**

- a hang-up or spam call (outcome `abandoned` or `spam`, `0019_voice_core.sql:53-54`), which is still
  recorded on the archived record;
- a STOP reply, which is recorded in the consent ledger while the contact stays archived;
- anything staff do: a note, a manual text, a deal (`createOpportunity`), a booking made from the
  record page;
- a CSV import. A matched archived row fills blanks and stays archived: the import never writes
  `archived_at`. (Planning, 2026-10-28: a separate "N of these were archived" summary line is deferred.
  It would touch the import's three-step UI for a number nobody has asked for.)

**Not gated by archive:** the missed-call text-back (`prepareTextback`) is a reply in the moment, and
"a reply in the moment follows the moment" (DESIGN.md, A customer's language). It still sends.
Archiving does not touch consent.

**Add contact by hand** (`apps/web/src/lib/contacts/add-contact-by-hand.ts`): **deferred** (coordinator,
2026-10-28). Today a dedupe hit on an archived contact answers `{ kind: "existing" }`, and the dialog links
to it. The record then shows the archived banner with Restore. It never restores on its own.

### 4.3 Calls and conversations in the palette

The palette's calls half stays (as above). Its conversations half follows the inbox (§4.1) and leaves
out archived contacts' threads. The search route needs no change, because `searchConversations` does
the filtering.

---

## 5. Delete for good: internal-only contacts

### 5.1 What "only internal" means, settled against the schema

A contact may be deleted for good when it has **none** of these. Each is one `reason` from
`contact_delete_blockers`:

| reason | Blocks when | Why it blocks | FK today |
|---|---|---|---|
| `messages` | any `messages` row on any of its conversations with `channel <> 'note'` (sms, email, webchat, voice, form; either direction) | a text, email or chat we sent is carrier and consent evidence, and one they sent is their own words | `messages.conversation_id` NO ACTION; channels `0005_messaging.sql:34-35`, `0006_forms.sql:92` |
| `inbound_email` | any `inbound_emails` row on its conversations | their own words; a cascade would destroy a held email silently | ON DELETE CASCADE, `0082_inbound_email.sql:93-94` |
| `calls` | any call with `contact_id` = the contact, OR on the contact's conversation with no `contact_id` (`calls.conversation_id`, `0019_voice_core.sql:49`, review M3) | carrier record, recording, transcript | **SET NULL** (`0019:48-49`): today a delete would orphan the call rather than block, so this check must be explicit |
| `forms` | any `form_submissions.contact_id` row | their own words, with consent | SET NULL (`0006_forms.sql:42`) |
| `consent` | any `consent_events` row | consent evidence | SET NULL (`0054_consent_ledger.sql:88-89`) |
| `automations` | any `automation_log` row with `status = 'sent'` | we sent them something | SET NULL (`0046_automation_log.sql:40`; status at `:43-44`) |
| `bookings` | any `bookings` row | confirmations were sent, and it is a reported number | RESTRICT (`0050_same_account_fks.sql:102`); blocks today (`contacts.ts:1229`) |
| `deals` | any `opportunities` row | feeds the dashboard's opportunity metric (`listOpportunityValuesCreatedBetween`) | NO ACTION (`0050:110`); blocks today (`contacts.ts:1229`) |

Two of these change behaviour on purpose. **Calls, forms, consent and sent automations block for the
first time.** Today they never block, because their FKs are SET NULL. So the Owner can delete a caller
today and orphan the call. Under this spec that contact is archive-only.

### 5.2 What goes with an internal-only contact

When deleted, these go with it: `contact_tags` (`0003_crm_core.sql:31`), `notes` (`:98`), `tasks`
(`:109`), `contact_duplicate_flags` (`0033_contact_dedupe_keys.sql:55-56`), `client_group_members`
(`0069_client_groups.sql:72-73`), `contact_relationships` (`0070_contact_relationships.sql:47-50`),
`places` (`0071_places_and_equipment.sql:53-54`), `document_requests` (`0080_document_requests.sql:100`),
`document_requirement_skips` (`0081_document_requirements.sql:78`), `record_summaries`
(`0087_record_summaries.sql:50`), `proposals` (`0088_proposals.sql:119`), `ai_acts`
(`0091_ai_acts.sql:84`), `contact_archive_log` (§3.1). Also its note-only messages and then its
now-empty conversations (step 8 of §3.1).

### 5.3 The vault purge

Documents never block, as today. The owner's ruling of 2026-10-13 says a customer's files go with them
(`contacts.ts:1164-1168`). Order of operations in the new `deleteContacts`:

1. Prove the ids on the request client (`contacts.ts:1236-1242`, unchanged).
2. Call `contact_delete_blockers` on the service client. Blocked ids are kept and reported by reason.
3. `beforeDelete` runs the vault purge (`purgeContactDocuments`, `actions.ts:505`) on the remaining
   ids only. This is irreversible, and it runs only after every knowable blocker has been read.
4. Call `delete_internal_contacts` on the REQUEST client, so its Owner check decides (§3.1 step 8). It
   re-checks under lock and deletes.

A document request sent by text or email leaves a `messages` row, so that contact is blocked at step 2.
A request whose link staff copied by hand (`channel = 'link'`, `0080_document_requests.sql:81`) leaves no
message. A file the customer uploaded through it IS purged with the contact (corrected 2026-10-28; the
earlier sentence here claimed no request-delivered file could ever be purged). The owner's ruling of
2026-10-13 stands: a customer's files go with them, and the typed-name dialog counts them first. The accepted residual is the one
`contacts.ts:1196-1206` already accepts. A contact that becomes blocked between steps 2 and 4 (a text
arrives) is kept by step 4, and its files are already gone. The existing `contacts.delete.filesGoneKept`
line (`actions.ts:512-519`) says exactly that.

`delete_empty_conversations` (0083) is no longer called by `deleteContacts`. It is left in place; a
later migration drops it once nothing calls it.

### 5.4 Who and how

- Delete stays Owner-only, twice: in the app (`requireAccountOwner`, `actions.ts:489`) and in the database.
  `delete_internal_contacts` refuses anyone but an Owner of the account, the agency, or a `service_role` JWT
  (§3.1 step 8, review I9). It does the deleting, so the `contacts_owner_delete` policy
  (`0066_staff_and_roles.sql:84-86`) no longer sees these deletes, and the function's own check is the
  backstop.
- **One contact** (record page, drawer): the confirm is typing the contact's display name. A contact
  with no name types its phone's last four digits, and the dialog says which.
- **Bulk** (bulk bar): the confirm stays typing the count, as today (`bulk-action-bar.tsx:117-120`).
  The count is now the number that WILL be deleted. Blockers are read when the dialog opens (rule 7: a
  skeleton while loading, like `DeleteFilesLine`, `:102-115`), and the dialog says how many will be kept
  and why before anything happens. When the selection has no deletable contacts, the dialog says so and
  offers **Archive** in place of Delete.

---

## 6. Copy (English, Spanish)

New keys go under the existing `bulk.*` and `contacts.*` namespaces in `apps/web/src/lib/messages.ts`.
Spanish is usted, as everywhere in the catalogue (`messages.ts:411`). A count has a One twin picked by
`plural()` (house convention, `messages.ts:680-685`). No milestone codes, no `{{template}}`, no arrows.

### 6.1 Bulk bar and list

| Key | English | Spanish |
|---|---|---|
| `bulk.archive` | Archive | Archivar |
| `bulk.archived` / `One` | Archived {count} contacts · Undo / Archived 1 contact | Se archivaron {count} contactos / Se archivó 1 contacto |
| `bulk.restore` | Restore | Restaurar |
| `bulk.restored` / `One` | Moved {count} contacts back to your list / Moved 1 contact back to your list | Se devolvieron {count} contactos a su lista / Se devolvió 1 contacto a su lista |
| `contacts.view.archived` | Archived | Archivados |
| `contacts.archived.count` / `One` | {count} archived / 1 archived | {count} archivados / 1 archivado |
| `contacts.archived.emptyTitle` | Nothing archived | No hay contactos archivados |
| `contacts.archived.emptyBody` | Contacts you archive wait here, off your list, with every call and text kept. Archive one from your list when you no longer need to see it. | Aquí quedan los contactos que archive: fuera de su lista y con todas sus llamadas y mensajes guardados. Archive uno desde su lista cuando ya no necesite verlo. |
| `contacts.archived.emptyAction` | Back to contacts | Volver a contactos |
| `contacts.archive.failed` | Couldn't archive. Nothing changed. Try again. | No se pudo archivar. No cambió nada. Intente de nuevo. |
| `contacts.restore.failed` | Couldn't restore. Nothing changed. Try again. | No se pudo restaurar. No cambió nada. Intente de nuevo. |
| `contacts.archived.mark` (To do and lists, beside a name) | Archived | Archivado |
| `contacts.archive.keepsAppointment` (second line of the Archive toast, ruling Q2) | They still have an appointment on {date}. Its reminders still go. | Todavía tiene una cita el {date}. Sus recordatorios se siguen enviando. |

No link on the list is named exactly "Contacts": `phone-width.spec.ts:376` and `staff-roles.spec.ts:115`
find the sidebar's link with an UNSCOPED `getByRole("link", { name: "Contacts", exact: true })`, so a
second one is a strict-mode failure. The list links to the Archived view with "Archived"; the Archived
view links back with "Back to contacts". The Archived view's error state is the list's own, the
`(dashboard)/dashboard/error.tsx` boundary, so it needs no key of its own. (Both corrected 2026-10-28.)

### 6.2 Record header, drawer and timeline

| Key | English | Spanish |
|---|---|---|
| `record.archive` | Archive | Archivar |
| `record.archivedBanner` | Archived {date} by {name}. Their calls and texts are kept. | Archivado el {date} por {name}. Sus llamadas y mensajes se conservan. |
| `record.restore` | Restore | Restaurar |
| `record.archivedToast` | {name} archived · Undo | {name} se archivó · Deshacer |
| `record.restoredToast` | {name} is back on your list | {name} volvió a su lista |
| `timeline.archived` | Archived | Archivado |
| `timeline.restored` | Moved back to the list | Devuelto a la lista |
| `timeline.cameBack.text` | Came back: sent you a text | Volvió: le envió un mensaje |
| `timeline.cameBack.email` | Came back: sent you an email | Volvió: le envió un correo |
| `timeline.cameBack.call` | Came back: called and talked with Sofía | Volvió: llamó y habló con Sofía |
| `timeline.cameBack.booking` | Came back: booked an appointment | Volvió: hizo una cita |
| `timeline.cameBack.form` | Came back: filled out your form | Volvió: llenó su formulario |
| `timeline.cameBack.chat` | Came back: wrote in your website chat | Volvió: escribió en el chat de su sitio web |

The banner's `{name}` follows the provenance rule: someone the reader cannot name reads "Someone on the
team" / "Alguien del equipo". Timeline rows carry the author mark: the person for archive and restore,
the customer for "Came back".

### 6.3 Delete and the "skipped" toast (ruling 4)

Replaces `bulk.deletedSkipped` / `.es` (`messages.ts:696-699`). The toast gains an action that archives
exactly the kept ids. This needs `skippedIds` returned by the action.

| Key | English | Spanish |
|---|---|---|
| `bulk.deletedSkipped` | Deleted {count} · kept {skipped} that have a history with you. You can archive those instead. | Contactos borrados: {count} · conservados porque tienen un historial con usted: {skipped}. Puede archivarlos. |
| `bulk.archiveKept` (toast action) | Archive them | Archivarlos |
| `contacts.delete.archiveOnly` (single contact) | {name} can't be deleted because they have a history with you, and we keep it. Archive them instead: they leave your list and nothing is lost. | No se puede borrar a {name} porque tiene un historial con usted, y lo conservamos. Mejor archive este contacto: sale de su lista y no se pierde nada. |
| `contacts.delete.someKept` (bulk dialog line) | {kept} of these have a history with you and will be kept. | {kept} de estos tienen un historial con usted y se conservarán. |
| `contacts.delete.noneDeletable` | None of these can be deleted: they all have a history with you. Archive them instead. | Ninguno se puede borrar porque todos tienen un historial con usted. Mejor archívelos. |

The delete copy says "a history with you" rather than listing reasons (review M8). A list of record types
reads like a form at 7 AM, and it goes stale the day §5.1 gains a reason.
| `contacts.delete.oneTitle` | Delete {name} for good? | ¿Borrar a {name} para siempre? |
| `contacts.delete.oneBody` | This removes them with their notes, tasks and files. It can't be undone. Type {name} to confirm. | Esto borra el contacto con sus notas, tareas y archivos. No se puede deshacer. Escriba {name} para confirmar. |
| `contacts.delete.oneBodyNoName` | This contact has no name. Type the last four digits of their phone, {digits}, to confirm. | Este contacto no tiene nombre. Escriba los últimos cuatro dígitos de su teléfono, {digits}, para confirmar. |

`bulk.deletedSkipped.es` keeps the colon-before-count form its comment requires (`messages.ts:697-698`).

### 6.4 Rule 8 placement

The record header's one primary is Call (DESIGN.md rule 8, amended 2026-10-12). `RecordHeader`'s
actions are links (`apps/web/src/components/record/record-header.tsx:7`, `:55`). Archive is a ghost
client button in its `trailing` slot (`:17`). Delete sits beside it as a ghost "Delete…" for Owners only.
On an archived record the banner replaces Archive with a ghost Restore. The drawer uses the same
component (`ACCT/contacts/contact-drawer.tsx:208`).

---

## 7. Sofía never saves "Unknown" as a name (ruling 2)

**Moved out of this plan (coordinator, 2026-10-28):** it ships as its own small PR on its own branch. The
analysis below stands as that PR's spec.

### 7.1 How the lead's name reaches `createContact`

- `capture_lead` → `capturePhoneLead` (`apps/web/src/lib/voice/tools/registry.ts:397`;
  `apps/web/src/lib/voice/tools/placeholders.ts:185-196`) → `sanitizeLeadFields` drops a placeholder
  name (`placeholders.ts:149`, using `isPlaceholderName`, `:46-49`, whose sets are at `:26-33`). This
  guard shipped in `044b1ab2` (2026-10-22, S-47b v3). "unknown" and "desconocido" are in it (`:31`).
- `finishCall` → `resolveContactId` (`finish-call.ts:350`): `splitFullName(fields.fullName)` (`:386`),
  then `createContact({ firstName: firstName || "Caller", ... })` at `:412-413` and `:424-425`, and the
  blank fills at `:401-402` and `:447-448`. The "Caller" placeholder applies only when the first name
  is empty.
- `take_message` → `messageName` (`apps/web/src/lib/voice/identity/flow.ts:95-98`) has **no**
  placeholder check. Its name feeds `namesSaid` (`finish-call.ts:306-313`) and, on a shared number,
  `splitFullName(name!)` → `createContact` (`:466-471`).

### 7.2 Where "Unknown" got through

I did not query production. Three ways remain open:

- **(a)** 114fb9ad may predate `044b1ab2`. The owner can check its `created_at` against 2026-10-22; if
  it is earlier, (b) and (c) are still real gaps but not the cause.
- **(b)** `take_message`'s name has no guard (`flow.ts:95-98`). A "Unknown" name there also makes
  `namesAgree` fail against a real lead name, and the call then files on no customer (`finish-call.ts:355`).
- **(c)** Multi-word stand-ins are not in the sets: "Unknown caller", "No name", "Not provided",
  "Anonymous", "Sin nombre", "No proporcionado", "No dio su nombre", "Anónimo". `norm` matches the
  whole value (`placeholders.ts:19-22`). So "Unknown Caller" survives, and `splitFullName` stores
  first "Unknown", last "Caller".

### 7.3 Fix

1. Add the multi-word stand-ins in (c) to `UNKNOWN` / `NAME_STANDINS` (`placeholders.ts:31-33`). Keep
   the file's "narrow on purpose" rule (`:3-6`): a whole-value match only, so "Anonymous Plumbing LLC"
   survives.
2. `messageName` returns null for `isPlaceholderName(n)` (`flow.ts:95-98`). `placeholders.ts` is
   import-free (`:11-13`), so `flow.ts` can import it.
3. Defence at the choke point: one `spokenName(raw)` helper in `finish-call.ts` (`isPlaceholderName(raw)
   ? "" : raw`), used by `namesSaid` (`:308-309`) and before `splitFullName` at `:386` and `:469`. Any
   future tool path that forgets the guard still yields "Caller".
4. Existing "Unknown" contacts are not renamed by a migration. The owner archives them (§2), which is
   the point of this spec.

---

## 8. Automations (scheduled sends)

**Rule: archived means we stop starting conversations, and we keep promises already made.**

| Pass (`apps/web/src/lib/automations/registry.ts:79`) | Archived contact | Due-list |
|---|---|---|
| reminders (email) | **sends**: an appointment exists | `listDueReminders`, `packages/db/src/booking.ts:1457` |
| SMS reminder, appointment confirm, cancel notices | **send**: same reason | `automations.ts:628`, `:778`; cancel-notices pass |
| follow-up ("how did it go?") | skips | `listDueFollowups`, `booking.ts:1590` |
| review request | skips | `automations.ts:295` (+ `getDueReviewRequestById` `:329`) |
| referral ask | skips | `:1132` (+ `:1175`) |
| no-show nudge | skips | `:481` (+ `:511`) |
| reactivation | skips | `:1481` (+ `:1716`) |
| quote follow-up | skips | `:2038` (+ `:2162`) |
| instant reply (form) | n/a: the submission restores the contact first (§4.2) | |
| weekly client and agency reports | unchanged: they count events (§4.1) | |
| documents expiry To-dos | unchanged: internal work, shown with "Archived" (§4.1) | |

The filter goes **in each due-list's query**, never in memory after the page. Every due-list is a
bounded page (`REACTIVATION_CANDIDATE_PAGES`, `automations.ts:1302`), and an in-memory drop would let
archived rows fill the page every tick and starve everyone else. That is the same failure
`automations.ts:1510-1527` fixed for unsendable accounts. Change each `contacts(...)` embed to
`contacts!inner(...)` and add `.is("contacts.archived_at", null)`. Keep `account_id` inside the embed,
because `ownAccountContactOnly` (`:257-259`) fails closed without it. Each by-id release read
(`getDue*ById`) answers its pass's "skipped" for an archived contact, so a held row leaves the release
queue with a log reason `archived`.

These files belong to bis-automations (`automations.ts`, `booking.ts`) and bis-comms (`messaging.ts`),
not bis-crm. See the task list.

---

## 9. Tests, each with the mutation that must turn it red

Rule 2 of the working rules applies: run each mutation, confirm the named test fails, and paste the
line. A `-t` filter that matches no test name proves nothing.

**Schema (`packages/db/src/test/contact-archive-schema.test.ts`, real local stack):**

| Test | Mutation that must fail it |
|---|---|
| a signed-in archive stamps `archived_by` with the caller's id and `archived_at` with now, whatever the client sent | drop `new.archived_by := ...` / drop `new.archived_at := now()` |
| a signed-in client cannot write `archived_by` | add `archived_by` to the column grant |
| archiving a holding record is refused 42501 | delete the holding check |
| a Technician's archive is refused (ruling Q3) | delete the technician check |
| a signed-in archive writes exactly one `person` log row; a signed-in restore writes one | drop the log trigger's insert / move the role test from WHEN into the definer body (then nothing is logged) |
| a `restore_contact_on_sign` restore writes exactly one row, the `customer` one | drop `current_user = 'authenticated'` from WHEN (then it logs twice) |
| `restore_contact_on_sign` on an archived contact writes one `customer` row with its sign; on an active contact it writes nothing and answers false | remove `and archived_at is not null` |
| `authenticated` cannot execute `restore_contact_on_sign` or `contact_delete_blockers` | grant execute to authenticated |
| a Staff member's `delete_internal_contacts` call is refused; an Owner's succeeds (review I9) | drop the Owner check |
| one test per §5.1 reason: a contact with ONLY that row is blocked with that reason | delete that reason's `exists` |
| a contact with notes, tasks, tags, a place, a household, a document request skip and a note-channel message has no blockers | treat `channel = 'note'` as a blocker |
| `delete_internal_contacts` keeps a contact that gained an outbound text after the blockers read | remove the re-check inside the lock |
| a file left behind keeps that one contact and deletes the rest of the batch | remove the per-contact exception block |

**Queries (`packages/db/src/test/contacts.test.ts`, `contact-archive.test.ts`, `contact-import.test.ts`):**
`listContacts` leaves an archived contact out (mutation: drop `withArchived`). `countContacts` agrees
with `listContacts` for `exclude` and `only` (mutation: apply `withArchived` to only one of them). The
Archived view lists only archived contacts, in each sort, across a page boundary (mutation: flip the
filter). Dedupe still matches an archived contact by phone and by email (mutation: add the archived
filter to `findDuplicate`). Import fills blanks on an archived match, keeps it archived, and counts it
(mutation: restore on import).

**Automations (`packages/db/src/test/automations*.test.ts`):** for each skipping pass, "an archived
contact's row is not due" (mutation: drop that list's filter). For each sending pass, "an archived
contact's reminder is still due" (mutation: add the filter there). That second set is what proves where
the line is drawn. Plus one starvation test: a page full of archived rows still reaches the active row
behind them.

**Inbox:** an archived contact's thread is not listed and its unread does not count in the badge
(mutation: drop the filter from one of the two). This pins that the two agree.

**Voice (`placeholders.test.ts`, `flow.test.ts`, `finish-call.test.ts`):** each new stand-in is a
placeholder name and "Anonymous Plumbing" is not. `messageName("Unknown")` is null.
`resolveContactId` with a lead whose `fields.fullName` is "Desconocido" creates "Caller" (mutation:
remove `spokenName`). **Vacuity trap:** this finish-call test must build `CallState` directly with the
placeholder in `fields.fullName`. If it goes through `capture_lead`, the upstream guard drops the name
first and the mutation cannot fail. Restore-on-sign: a meaningful call on an archived contact calls
`restoreContactOnSign(..., "call")`; an abandoned one does not (mutation: drop the `isMeaningful` gate).

**Sign sites (behaviour tests in each site's existing test file, not a source grep: a grep is satisfied
by a comment):** SMS inbound restores on a plain text and NOT on STOP (mutation: drop the consent-class
check). The booking page, form enrich, concierge and inbound email each restore (mutation: delete the
call in that file).

**Web (`bulk-action-bar.test.ts`, `actions.test.ts`, `page.test.ts`, record and drawer tests,
`messages.test.ts`):** Archive's Undo restores exactly the ids this archive changed, not ones already
archived (mutation: pass the whole selection, the D-007 shape, `contacts.ts:1045-1050`). The skipped
toast's "Archive them" archives exactly `skippedIds` (mutation: pass the selection). The bulk dialog's
kept line and the Delete control stay off until blockers load (mutation: enable on loading). A single
contact's delete enables only on the exact name (mutation: case-insensitive compare). `messages.test.ts`
pins every new string in both languages, and the existing `INTERNAL_MILESTONE` and accents guards run on
them.

**e2e: one spec, warranted.** `apps/web/e2e/contacts-archive.spec.ts` covers archive from the bulk bar →
the row and the header total drop by one → Undo puts it back → archive again → the Archived view shows
it with the right total → Restore. No unit test spans the server action, the page's `view` parameter,
the total and the toast together. Run it on the **per-run fixture account**, never `Test Client One`.
Delete-for-good is left out of e2e: it is irreversible and fully covered by the schema tests.

---

## 10. Tasks

Superseded by the plan's task list (`docs/superpowers/plans/2026-10-28-contact-archive.md`), which splits
T5 by owner (bis-automations, bis-comms) and renumbers. Kept here as the design-time sketch.

Tiers follow the speed process (tier each task). Within a wave, no two tasks touch the same file.

**Wave 1** (no dependencies)

- **T1, high, bis-db-schema**: migration 0103 and its schema tests (§3.1, §9 Schema). Files:
  `packages/db/supabase/migrations/0103_contact_archive.sql`,
  `packages/db/src/test/contact-archive-schema.test.ts` (new),
  `packages/db/src/test/schema-grants-guard.test.ts`, `packages/db/src/test/definer-search-path.test.ts`.
- **T2, low, bis-voice**: placeholder names (§7.3). Files: `apps/web/src/lib/voice/tools/placeholders.ts`,
  `apps/web/src/lib/voice/tools/placeholders.test.ts`, `apps/web/src/lib/voice/identity/flow.ts`,
  `apps/web/src/lib/voice/identity/flow.test.ts`, `apps/web/src/lib/voice/finish-call.ts`,
  `apps/web/src/lib/voice/finish-call.test.ts`.
- **T3, low, bis-crm**: every new and changed catalogue string (§6). Files: `apps/web/src/lib/messages.ts`,
  `apps/web/src/lib/messages.test.ts`, `apps/web/src/lib/i18n/catalogue-baseline.json` (if the ratchet
  requires it).

**Wave 2** (T1 applied to the local replica)

- **T4, high, bis-crm**: contact queries: `withArchived`, `archiveContacts`/`restoreContacts` (returning
  the ids actually changed), `restoreContactOnSign`, `contactDeleteBlockers`, the new `deleteContacts`
  (§5.3), the import (§4.2), the barrel. Files: `packages/db/src/contacts.ts`,
  `packages/db/src/contact-import.ts`, `packages/db/src/index.ts`, `packages/db/src/test/contacts.test.ts`,
  `packages/db/src/test/contact-archive.test.ts` (new), `packages/db/src/test/contact-import.test.ts`.
- **T5, medium, bis-crm (files owned by bis-automations and bis-comms; orchestrator to reassign or
  co-review)**: due-list filters and inbox filters (§8, §4.1). Files: `packages/db/src/automations.ts`,
  `packages/db/src/booking.ts` (`listDueFollowups` only), `packages/db/src/messaging.ts`, and their tests
  under `packages/db/src/test/`.

**Wave 3** (T4 merged)

- **T6, medium, bis-voice**: restore on sign for voice (§4.2 rows 1-2). Files:
  `apps/web/src/lib/voice/finish-call.ts`, `apps/web/src/lib/voice/finish-call.test.ts`,
  `apps/web/src/lib/voice/tools/registry.ts`, `apps/web/src/lib/voice/tools/registry.test.ts`.
- **T7, medium, bis-crm**: restore on sign for every other site (§4.2 rows 3-7). Files:
  `apps/web/src/app/api/sms/inbound/route.ts` (+ `route.test.ts`), `apps/web/src/app/b/[publicId]/actions.ts`
  (+ test), `apps/web/src/lib/forms/enrich.ts` (+ test), `apps/web/src/app/api/concierge/[publicId]/turn/route.ts`
  (+ test), `apps/web/src/lib/email/inbound/file.ts` (+ test).
- **T8, medium, bis-crm**: list, bulk bar and actions (§4.1, §5.4, §6.1, §6.3). Files: `ACCT/contacts/actions.ts`
  (+ `actions.test.ts`), `ACCT/contacts/bulk-action-bar.tsx` (+ test), `ACCT/contacts/page.tsx` (+ `page.test.ts`),
  `ACCT/contacts/contacts-table.tsx` (+ test), `ACCT/contacts/add-contact-dialog.tsx` (+ test),
  `apps/web/src/lib/contacts/add-contact-by-hand.ts`, `ACCT/contacts/export/route.ts`.
- **T9, medium, bis-frontend**: record header, drawer, banner, single-contact delete dialog and timeline
  rows (§5.4, §6.2, §6.4). It builds against T8's action signatures, pinned here:
  `archiveContactsAction(accountId, ids) → { ok: true; changedIds } | { ok: false; errorKey }`,
  `restoreContactsAction(accountId, ids)` (same shape), and
  `contactDeleteBlockersAction(accountId, ids) → { ok: true; blocked: Record<id, reason[]> } | { ok: false }`.
  Files: `ACCT/contacts/archive-controls.tsx` (new, + test), `ACCT/contacts/[contactId]/page.tsx`
  (+ `page.test.ts`), `ACCT/contacts/contact-drawer.tsx` (+ `contact-drawer.wiring.test.ts`),
  `packages/db/src/record.ts` (the `archive` timeline source), `ACCT/contacts/[contactId]/activity-timeline.tsx`,
  `ACCT/contacts/[contactId]/activity-timeline.archive.test.ts` (new).
- **T10, low, bis-crm**: the remaining reads (§4.1). Files: `apps/web/src/app/(dashboard)/dashboard/page.tsx`
  (+ test), `ACCT/tasks/page.tsx` (+ test), `apps/web/src/app/(dashboard)/dashboard/work/page.tsx` (+ test),
  `apps/web/src/app/api/accounts/[accountId]/search/route.test.ts`.

**Wave 4**

- **T11, medium, bis-e2e-qa**: `apps/web/e2e/contacts-archive.spec.ts` on the per-run fixture account.

---

## 11. Owner rulings (decided 2026-10-28; were the open questions)

The owner took all three recommendations. Each ruling is binding on the plan
(`docs/superpowers/plans/2026-10-28-contact-archive.md`).


1. **Which of the customer's own acts bring an archived contact back to the list?**
   Recommendation: a text or email they send (not STOP, START, HELP or an auto-reply), a call Sofía
   answers that ends in a booking, a lead or a message, a booking, a form, or a website chat lead. A
   hang-up or spam call is recorded but leaves them archived, so the junk "Caller" records stay out of
   sight when the same robocaller rings again.
   **Ruling: as recommended.** Only real contact brings an archived contact back: a text or email they
   send (not STOP, START, HELP or an auto-reply), an answered call with a booked, lead or message
   outcome, a booking, a form, or a website chat lead. Hang-ups and spam calls are recorded and leave
   the contact archived.
2. **Can a contact with an upcoming appointment be archived?**
   Recommendation: yes. The appointment stays, and its reminders and confirmation still go, because
   that promise was made. Every message that starts a new conversation stops (follow-up, review,
   referral, no-show nudge, reactivation, quote follow-up). The Archive toast adds "They still have an
   appointment on {date}." The alternative is refusing the archive, which would block a real use: a
   customer who asked to be left alone after booking.
   **Ruling: yes, as recommended.** The appointment and its reminders and confirmation stay; every
   other automatic message stops. The Archive toast names the date (`contacts.archive.keepsAppointment`,
   section 6.1).
3. **Who may archive?**
   Recommendation: Owners, Staff and the agency. It is reversible with Undo (rule 6), so it does not
   need the Owner-only gate that delete has. Technicians may not: their list is only their assigned
   customers, and archiving one would take it off the Owner's list without the Owner seeing it.
   Delete for good stays Owner-only.
   **Ruling: as recommended.** Owners, Staff and the agency may archive; Technicians may not. Permanent
   delete stays Owner-only.
