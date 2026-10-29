# Duplicates found the Valley way, and a merge that keeps everything (F-006 part 1, with S-12): design

Date: 2026-10-29. Author: bis-crm. Base: `1f565f60` (branch `feat/dedupe-merge`).
Status: design for review. Nothing here is built yet. Migration number: **0106** (0105 is reserved by the
F-118 access-log lane; it is not used here).

Every claim about current code cites `path:line` at `1f565f60`. Paths below shorten
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/` to `ACCT/` and `packages/db/supabase/migrations/`
to `MIG/`. A claim about a system outside this repo is labelled **ASSUMPTION** and names how the plan verifies it.

Scope, from `docs/crm-features.md:1406`: "the merge UI and phone-key surfacing, with S-12; the nickname scorer
waits for F-092 part 2". The row's one-line promise (`:1900`): "Duplicates found across two surnames, accents
and Mexican numbers, merged without losing history". S-12 is "Merge with history" (`:1405`, `:3766`).

---

## 1. The problem, as the code has it

- **The duplicates are already found, and go nowhere.** `contact_duplicate_flags` (`MIG/0033_contact_dedupe_keys.sql:48-66`)
  was created as "the work queue a merge tool will consume on the day it is built". Seven writers fill it:
  `createContact` (`packages/db/src/contacts.ts:464-483`, reason `email_phone_conflict`; `:488-490` and `:513-516`,
  `phone_country_twin` and `phone_shared_new_person`), `flagDuplicatesAfterWrite` (`:411-440`, `email_match_on_edit`,
  `phone_match_on_edit`), `flagMatchesOf` (`:526-559`, `hidden_match`) and `setContactPhoneCountry` (`:1405-1410`,
  `phone_country_pick`). No code reads it: `grep contact_duplicate_flags` outside tests finds only `contacts.ts`
  and `account-teardown.ts`. `docs/crm-features.md:335` and `:345-346` say so: "conflicts are flagged but no
  screen lists or merges them".
- **Names are not compared at all.** There is no accent folding anywhere in the schema (`grep unaccent|translate(`
  over `MIG/` finds nothing). `sort_name` is `lower(trim(first || ' ' || last))` (`MIG/0030_contacts_sort_name.sql:19-22`),
  so "María García López" and "Maria Garcia" share nothing a query can match.
- **Mexican numbers are mostly solved at write time, not in stored keys.** F-009's `normalisePhone`
  (`packages/db/src/phone.ts:13-36`, `:93-125`) stores E.164 and drops the retired mobile `1` (`:63-66`) and the
  `01`/`044`/`045` trunk prefixes (`:112-113`). But `phone_key` is digits only with a NANP `1` folded
  (`MIG/0033:21-30`; twin `phoneDigits`, `contacts.ts:188-191`), so a row stored before F-009 as `+52 1 899…`
  keys `5218999221234` while the same number stored today keys `528999221234`. `findDuplicate` patches this
  with a legacy-key read (`contacts.ts:338-365`) and the voice lookup with a key superset (`phoneKeysOf`,
  `packages/db/src/voice.ts:749-752`). Neither is a stored key a pair finder can join on.
- **A merge has nowhere safe to put most of a contact's history.** Twenty-three foreign keys on 21 tables point
  at `contacts`, pinned in `packages/db/src/test/ai-acts-schema.test.ts:849-879`. Three of those tables refuse
  any change to `contact_id` from every role: `ai_acts` (`MIG/0091_ai_acts.sql:93-107`), `proposals`
  (`MIG/0088_proposals.sql:128-142`) and `consent_events` ("no role holds UPDATE or DELETE",
  `MIG/0054_consent_ledger.sql:92-93`). A merge that deletes the losing row would cascade away Sofía's acts
  (`0091:84-85`, `on delete cascade`) and null the consent ledger's link (`0054:84-89`). So the losing row
  cannot be deleted. Section 4 builds on that fact.

---

## 2. Decisions, each with a recommendation

Each decision marked **OWNER** needs the owner's ruling. The rest are recommended by this spec and can be
changed in review. Section 13 lists the OWNER ones again, with their questions.

| # | Decision | Recommendation | Who |
|---|---|---|---|
| D1 | What counts as a likely duplicate in part 1 | Same phone (any +1 / +52 / legacy Mexican form of the same ten digits), same email key, or same name (accents and case folded, first name + first surname). Sections 3.1-3.3 | review |
| D2 | Ship same-name-only suggestions in part 1? | **Yes**, labelled "Same name" and listed after phone and email pairs, with a strict key (a last name is required) | **OWNER** |
| D3 | Where suggestions show | A line under the record header, a "Possible duplicates" view of the contact list, one count row in To do. No new top-level surface. Section 6 | review |
| D4 | Which record survives | The older record by default, with "Keep this one instead". Section 5.1 | **OWNER** |
| D5 | Field choices | Rules for most fields, and a choice only where both records hold different values. Section 5.2 | review |
| D6 | Reversible or destructive | **Reversible.** It runs at once with Undo (rule 6), because the losing record stays as a hidden pointer and every moved row is logged. Section 4 | review |
| D7 | How long Undo lasts | The toast, then "Undo merge" on the timeline row for **30 days** | **OWNER** |
| D8 | A number or email the merge did not keep | It still reaches the kept record: a call or text from it lands there | **OWNER** |
| D9 | Who may merge | Owners, Staff and the agency. Technicians may not | **OWNER** |
| D10 | Ship before S-04 (`record_changes`)? | **Yes.** The merge's own log holds every value it overwrote. When S-04 lands, the merge also writes S-04's rows | **OWNER** |
| D11 | "Not the same person" | Stored on the pair and never suggested again, with Undo | review |

---

## 3. What counts as a likely duplicate (D1, D2)

### 3.1 Same phone, the Valley way

Two new generated columns hold the comparison key, each with a TypeScript twin and a parity test (the 0033/0034
house pattern: `MIG/0033:15-20`, `MIG/0034:19-26`).

`phone_national text` is the ten national digits of any +1 or +52 shape, or `phone_key` for anything else. A
generated column cannot read another generated column (Postgres rule), so it is computed from `phone` with
`phone_key`'s own expression inlined:

| Stored digits (after the NANP `1` fold) | `phone_national` |
|---|---|
| ten digits (`+1…`, a bare ten, `1` + ten) | the ten |
| `52` + ten (`+52…`, today's form) | the ten |
| `521` + ten (legacy `+52 1…`) | the ten |
| `044` / `045` + ten, `01` + ten (legacy trunk forms typed before F-009) | the ten |
| anything else | the digits, as `phone_key` |

Written with `[0-9]{10}` classes, never `\d`: the migration is ASCII-only with no backslash (the 0098 rule,
`MIG/0098_shared_number_holding.sql:57`). TS twin: `phoneNational(phone)` in `contacts.ts`, beside `phoneDigits`.

A pair with equal `phone_national` gets one of two reasons:

- `same_phone`: the same country family on both sides, +1 (or bare ten digits, which `phone_key` cannot tell
  from +1) or +52 in any of its forms (`52`, `521`, `044`, `045`, `01`). So a legacy `+52 1 899…` row and today's
  `+52 899…` row are the same phone, though their `phone_key`s differ. The family is read from the same digits
  in the same function, so it needs no column of its own.
- `same_digits`: the same ten digits, one in the +1 family and one in the +52 family. This is today's
  `phone_country_twin` (`contacts.ts:227-232`): "not the same person for sure". The compare screen shows both
  numbers, each with its country, and the person decides.

**Never a phone pair:**
- either side is a shared number's holding record (`holds_shared_number`, `MIG/0098:9-17`). Every existing reader
  already excludes it (`contacts.ts:292`, `:358`, `:430`, `:538`);
- the two are in the same household (`client_group_members`, kind `household`). A shared house phone is expected
  (S-47e). Checked when the list is read, not when the pair is written, because household membership changes later;
- the two are linked by a `contact_relationships` row. Staff already said they are two people.

### 3.2 Same email

Equal `email_key` (`MIG/0034:39-45`, twin `emailKey`, `contacts.ts:220-225`). Unchanged: Gmail's dot-folding stays
off (`contacts.ts:213-215`). Reason `same_email`. A relationship row suppresses it too. A household does not: two
people rarely share one inbox, and when they do, staff dismiss the pair once.

### 3.3 Same name: accents, case and two surnames

`name_key text` is generated from `first_name` and `last_name` by an immutable SQL function
`app.contact_name_key(first text, last text)`, written like `app.group_name_key` (`MIG/0069_client_groups.sql:31-38`):
`set search_path = ''`, `parallel safe`, and 0034's explicit whitespace class spelled with `chr()` (`app.group_ws()`,
`0069:31-34`).

1. **Fold.** Trim with `app.group_ws()`. Map the accented letters of Spanish and Portuguese names, both cases,
   with one `translate()` whose two strings are built from `chr()` codes (Á À Â Ä Ã É È Ê Ë Í Ì Î Ï Ó Ò Ô Ö Õ Ú Ù Û Ü
   Ñ Ç, upper and lower, to A…C and a…c). Then `lower()`. Folding happens BEFORE `lower()`, so the answer does
   not depend on the database's ctype for non-ASCII letters (**ASSUMPTION** that hosted Supabase's `lower()` folds
   `Á` correctly is therefore never relied on). `ñ` folds to `n`, because "Munoz" is how an English keyboard types
   "Muñoz". `-`, `.`, `,` and `'` become spaces, and runs of spaces collapse to one.
2. **First name.** The whole folded first name. "Juan Carlos" and "Juan" are different names in the Valley.
3. **First surname.** From the folded last name, skip leading particles (`de`, `del`, `la`, `las`, `los`, `y`,
   `san`, `santa`), keep them attached, and take the next word. So "García López" gives `garcia`,
   "García-López" gives `garcia`, "García y López" gives `garcia`, "de la Garza Treviño" gives `de la garza`, and
   "San Miguel" gives `san miguel`.
4. **Key.** `first || '|' || first_surname`. NULL when either part is empty, so **a contact with no last name
   never name-matches**. NULL also when the folded first name is a placeholder: `caller`, `unknown`,
   `desconocido`, `cliente`, `customer`, `n/a`, `na`, `none`, `sin nombre`. A closed list in the function. The
   "Caller" records Sofía makes (`apps/web/src/lib/voice/finish-call.ts:423`, `:435`: `firstName || "Caller"`)
   and the "Unknown Caller" pair from the archive spec (`docs/superpowers/specs/2026-10-28-contact-archive-design.md:519-523`)
   must never all suggest each other.

So "María García López" and "Maria Garcia" share `maria|garcia`. "José García" and "José García" also share it,
and in the Valley they are often two people (father and son). That is why name-only pairs are labelled
"Same name", listed after phone and email pairs, and dismissable for good (D11). The other choice for D2 is
"phone and email only in part 1", which drops the "two surnames" half of the feature's promise.

TS twin: `nameKey(first, last)` in a new `packages/db/src/name-key.ts`, with the same explicit map (never
`.normalize("NFD")`, which folds a superset, the 0034 lesson). It is import-free, so `apps/web` can use it too.

### 3.4 Explicitly LATER (F-092 part 2 and beyond)

- Nicknames and short forms: "Lupe" for Guadalupe, "Beto" for Roberto, "Chuy" for Jesús, "Ma." for María.
  `phone_shared_new_person` (`contacts.ts:510-514`) already queues the Beto-beside-Roberto case when the number is
  shared, so part 1 surfaces those pairs by phone.
- Fuzzy scoring (typos, edit distance, sound-alike) and one score across signals. F-092 part 2 (`docs/crm-features.md:1555`).
- A full name typed into `first_name` alone (a CSV with one name column), and the maternal surname alone ("María
  López" for "María García López").
- Gmail dot-folding.
- Merging three records at once. Part 1 merges a pair; a third merges into the result (section 4.4 flattens the chain).

### 3.5 How pairs are found: one queue, written by the database

**Recommendation: keep `contact_duplicate_flags` as the one queue, and have the database fill it.**

- New trigger `app.contacts_flag_pairs()`: SECURITY DEFINER, `AFTER INSERT OR UPDATE OF phone, email, first_name, last_name`
  on contacts. For the written row it runs up to three indexed lookups (`phone_national`, `email_key`,
  `name_key`, each `account_id`-first) and inserts each pair with its reason, `on conflict (account_id, contact_a, contact_b) do nothing`.
  It is a definer for the same reason `flagMatchesOf` exists (`contacts.ts:520-525`): a Technician's own client
  cannot see contacts outside their assignment (`MIG/0068_mine_unassigned_technician.sql:146-148`), and a pair it
  cannot see must still be queued.
- `on conflict do nothing` is what makes a dismissal stick: a dismissed pair's row already exists (D11), so a later
  edit cannot bring it back.
- It skips holding records and merged-away records (section 4) on both sides.
- 0106 backfills existing pairs with one `insert … select` per key, then the trigger keeps up.
- The seven TypeScript writers stay as they are. They are idempotent on the same unique index
  (`MIG/0033:65-66`); the first reason written for a pair stands. Removing them is a later cleanup.

Why not compute pairs live on every read: the list needs a real total and cursor paging (DESIGN.md, Paged lists),
which a self-join recomputed per page cannot give cheaply, and the To do count would be a join per page load.
A stored row also carries the dismissal.

---

## 4. The data model that makes a merge reversible (D6, D7, D8): migration 0106

Written to 0098's and 0103's conventions: a header with WHY / WHAT / GRANTS / SEARCH PATHS / LOCKS / LOAD-BEARING /
ROLLBACK, ASCII only, `lock_timeout` 5s in a `do` block (`MIG/0098:60-64`), and every definer with
`set search_path = pg_catalog, pg_temp` (the 0096 rule).

### 4.1 The losing record stays, hidden, as a pointer

```sql
alter table public.contacts
  add column merged_into uuid,          -- null = a live record
  add column merged_at timestamptz;
alter table public.contacts
  add constraint contacts_merged_pair check ((merged_into is null) = (merged_at is null)),
  add constraint contacts_not_merged_into_self check (merged_into is distinct from id),
  add constraint contacts_merged_into_fkey foreign key (account_id, merged_into)
    references public.contacts (account_id, id);          -- NO ACTION: a kept record with merges cannot vanish under them
create index contacts_account_merged_into on public.contacts (account_id, merged_into) where merged_into is not null;
```

A merged-away record (a **tombstone**):
- leaves every list, total, search and picker. `withArchived` (`contacts.ts:897-901`) gains `.is("merged_into", null)`
  in BOTH branches, so a tombstone is in neither the list nor the Archived view, and rows and total still share
  one helper;
- keeps its own `phone` and `email`. That is D8: a number or address the merge did not keep still resolves, through
  the pointer, to the kept record (section 7);
- keeps the three fixed-history tables' rows (`ai_acts`, `proposals`, `consent_events`, section 5.3), which the
  kept record's timeline reads through the id set (section 6.4);
- is never archived, restored, deleted, edited or merged on its own. The stamp trigger refuses any signed-in
  write to a row whose `merged_into` is set (42501), in the same way `app.contacts_holding_server_only` refuses a
  holding record (`MIG/0098:86-106`).

`merged_into` and `merged_at` get no client grant. The client column grants on contacts stay exactly as they are,
so `EXPECTED_WRITES` in `packages/db/src/test/schema-grants-guard.test.ts` does not change for contacts.

### 4.2 The merge log

```sql
create table public.contact_merges (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  keep_id uuid not null,
  other_id uuid not null,
  merged_by text not null,                    -- Clerk user id (the record_event actor expression, MIG/0053)
  merged_at timestamptz not null default now(),
  undo_until timestamptz not null,            -- merged_at + 30 days (D7)
  keep_before jsonb not null,                 -- every contacts column the merge wrote on keep_id, as it was
  keep_after jsonb not null,                  -- the same columns, as the merge left them
  choices jsonb not null,                     -- which side each conflicting field came from (5.2)
  moved jsonb not null,                       -- { table: [row keys] } moved from other to keep
  removed jsonb not null,                     -- { table: [row snapshots] } removed as duplicates (5.3)
  unread_handed integer not null default 0,   -- unread texts handed to keep's thread (0098's rule)
  undone_at timestamptz,
  undone_by text,
  constraint contact_merges_undone_pair check ((undone_at is null) = (undone_by is null)),
  constraint contact_merges_two check (keep_id <> other_id),
  constraint contact_merges_keep_fkey foreign key (account_id, keep_id) references public.contacts (account_id, id),
  constraint contact_merges_other_fkey foreign key (account_id, other_id) references public.contacts (account_id, id)
);
create index contact_merges_keep on public.contact_merges (account_id, keep_id, merged_at desc, id desc);
create index contact_merges_other on public.contact_merges (account_id, other_id);
```

- Row keys are text: most tables key on a uuid `id`, but `contact_tags` keys on `(contact_id, tag_id)`
  (`MIG/0003_crm_core.sql:34`), so its key is the `tag_id`.
- A merge of a contact with 10,000 texts records 10,000 message ids in `moved`. That is the same shape as
  `move_holding_thread`'s event payload (`MIG/0098:110-230`), and is fine at this scale. The plan measures one
  10,000-message merge on the replica and states the time in 0106's LOCKS AND COST.
- RLS on; one SELECT policy for `authenticated`: the account's members or the agency, and for a Technician only
  when they can read `keep_id` (the 0103 log's shape, `docs/superpowers/specs/2026-10-28-contact-archive-design.md:103-107`).
  No client INSERT, UPDATE or DELETE (the 0053 rule). `revoke all … from anon, authenticated; grant select … to authenticated;
  grant select, insert, update, delete … to service_role` (the 0091 pattern, `MIG/0091:117-119`).
- Listed in `ACCOUNT_OWNED_TABLES` (`packages/db/src/account-teardown.ts:20`) before `contacts`.

### 4.3 The pair queue gains a decision

```sql
alter table public.contact_duplicate_flags
  add column dismissed_at timestamptz,
  add column dismissed_by text,
  add column merge_id bigint references public.contact_merges (id),
  add constraint contact_duplicate_flags_dismissed_pair check ((dismissed_at is null) = (dismissed_by is null));
create index contact_duplicate_flags_open on public.contact_duplicate_flags (account_id, created_at desc, id desc)
  where dismissed_at is null and merge_id is null;
create index contact_duplicate_flags_b on public.contact_duplicate_flags (contact_b);
```

`contact_duplicate_flags_pair` (`MIG/0033:65-66`) already leads on `contact_a`. The second index closes the gap
the archive spec reported for its own fix (`docs/superpowers/specs/2026-10-28-contact-archive-design.md:237-238`).
`tasks(contact_id)` gets its index here too, because the merge updates tasks by contact.

The client keeps `for all` on this table (`MIG/0033:78-81`). That is wider than the 0053 rule now asks for, so
0106 narrows it: `select` for members, and writes only through the two definers in 4.5. The guard tests change
by exactly that; the plan reads the current digest from `packages/db/src/test/proposals-drop.test.ts` before
changing it.

### 4.4 `public.merge_contacts(p_account_id uuid, p_keep uuid, p_other uuid, p_choices jsonb, p_seen jsonb) returns jsonb`

SECURITY DEFINER. EXECUTE to `authenticated` and `service_role`.

1. **Who.** `if not coalesce(<test>, false)`, the 0103 shape with both coalesces (`MIG/0103_contact_archive.sql:305-320`):
   a `service_role` JWT, or the agency, or `coalesce(p_account_id = app.current_account_id(), false) and
   coalesce(app.sees_all_customers(p_account_id), false)` (`MIG/0068:75-78`, Owner or Staff). A Technician is
   refused (42501). The NULL path is load-bearing, as it was in 0103: `current_account_id()` is NULL when client
   access is off.
2. **Lock.** Both contacts `for update` in id order, then their conversations `for update` in id order (0103's
   lock-then-fresh-snapshot order, so two merges cannot deadlock).
3. **Refuse** with a status, never an exception the screen cannot word: `same` (one id twice), `not_found`
   (either is not in this account), `holding` (either holds a shared number), `merged` (either is already a
   tombstone), `stale` (either row's `updated_at` differs from `p_seen`: the screen showed old values, so it
   reloads instead of merging on them).
4. **Fields.** Apply section 5.2 on `p_keep`. `p_choices` names only a side (`keep` or `other`) per conflicting
   field; **values are read from the locked rows, never from the client** (the import's rule: the server
   re-validates rather than trusting the browser). An unknown field name or side is 22023.
5. **Rows.** Move, combine or remove per the section 5.3 table, recording each key in `moved` or each snapshot in
   `removed`.
6. **Tombstone.** `merged_into = p_keep, merged_at = now()` on `p_other`. Then flatten: every row with
   `merged_into = p_other` now points at `p_keep`, and those ids are recorded, so a lookup never follows more
   than one hop.
7. **Resolve the pair.** The flag row for `(p_keep, p_other)` gets `merge_id`. If there is none (a merge started
   from search, not from a suggestion), one is inserted with reason `merged_by_hand`.
8. **Log.** Insert `contact_merges`, and emit `contact.merged` (actor `user`, the caller's Clerk id). Return
   `{ status: 'merged', mergeId, moved: { table: count } }`.

### 4.5 `public.undo_contact_merge(p_account_id uuid, p_merge_id bigint) returns jsonb`

Same role test as 4.4. Refuses with a status: `not_found`; `undone` (already undone); `expired` (`now() > undo_until`);
`later_merge` (the kept record has itself been merged away since, or another merge into it came AFTER this one and
moved rows this one recorded; only the newest merge into a record can be undone, so undos unwind in order).

Order matters, and a test pins it (section 9):

1. Lock both contacts and both conversations, as 4.4.
2. **Clear the tombstone first** (`merged_into`, `merged_at` to null). The redirect trigger (section 7.2) would
   otherwise send every row moved back straight to the kept record again.
3. Re-create the other record's conversation from its snapshot (same id) if the merge removed it, then move back
   exactly the recorded message, call and inbound-email ids that still sit on the kept thread. Hand back
   `unread_handed`, at most what the kept thread still has unread (`move_holding_thread`'s rule, `MIG/0098:199-211`).
4. Move back every recorded row key still pointing at the kept record. Re-insert every removed snapshot
   `on conflict do nothing`.
5. Restore each field on the kept record **only where its value still equals `keep_after`** (compare and restore,
   as `restoreContactFieldIf` does, `contacts.ts:726`). A field someone edited since keeps the edit, and the answer
   names it.
6. Undo the chain flattening for the ids it recorded.
7. Clear the pair's `merge_id`, so the suggestion comes back. Stamp `undone_at` and `undone_by`, emit
   `contact.merge_undone`, and return `{ status: 'undone', keptNew: n, keptEdits: [field] }`. `keptNew` counts rows
   that reached the kept record AFTER the merge (a call, a text). They stay there, because nothing says whose they were.

**Why 30 days (D7).** The toast covers the slip of a finger. The mistake a merge really makes ("those were two
different José Garcías") is found later, when the wrong person's appointment reminder goes out. After 30 days,
enough new rows have landed on the kept record that putting history back in two piles misleads more than it
helps. After the window the merge stays, and the timeline row stays without its Undo. The log is never pruned:
it is the record's history (D10).

### 4.6 The generated columns and indexes

```sql
alter table public.contacts
  add column phone_national text generated always as (app.phone_national(phone)) stored,
  add column name_key text generated always as (app.contact_name_key(first_name, last_name)) stored;
create index contacts_account_phone_national on public.contacts (account_id, phone_national) where phone_national is not null;
create index contacts_account_name_key on public.contacts (account_id, name_key) where name_key is not null;
```

Both functions are `immutable parallel safe set search_path = ''`, owned by the migration's role, with
`revoke all … from public, anon` (`app.group_name_key`'s shape, `MIG/0069:35-38`, and its revoke loop, `0069:498`).

**LOCKS.** Adding a STORED generated column rewrites `contacts` under ACCESS EXCLUSIVE, which blocks every
contact read and write for the rewrite. Both columns go in ONE `alter table`, so the table is rewritten once.
The plan's T1 times it on the replica at 10,000 and 100,000 contacts. The orchestrator reads production's
contacts count at apply time, and applies off-peak above 50,000. **ASSUMPTION:** production's count today is in
the hundreds. The orchestrator verifies it with a read-only count before applying.

### 4.7 Definers and guards

New definers, added by name to `EXPECTED_DEFINERS` in `packages/db/src/test/definer-search-path.test.ts`:
`app.contacts_flag_pairs`, `app.follow_merge` (section 7.2), `public.merge_contacts`, `public.undo_contact_merge`,
and `public.dismiss_duplicate_pair` / `public.undismiss_duplicate_pair` (D11). The count is whatever 0105 leaves
it at, plus 6.

`public.contact_delete_blockers` (0103 step 7) is replaced with one more reason, `merges`: a record that absorbed
another, or a tombstone, is archive-only. A merged record's history is the customer's, and deleting the kept
record would orphan the tombstone's pointer. `DELETE_BLOCK_REASONS` (`contacts.ts:1339`) gains `merges`.

New FKs into contacts: `contacts_merged_into_fkey`, `contact_merges_keep_fkey`, `contact_merges_other_fkey`.
`FK_PAIRS` in `ai-acts-schema.test.ts:860-872` goes from 23 to 26, and `FK_TABLES` from 21 to 23. That test exists
because `public.ai_contact_held_by` must read every table that can hold a contact (`:846-848`). So
`ai_contact_held_by` gains a `merges` clause: Sofía's "contact created" act cannot be undone (the contact
deleted) once that contact is part of a merge, either side. That function belongs to the ai-acts owner (section 10).

### 4.8 ROLLBACK (roll the app back first)

Undo every live merge first: `undo_contact_merge` for each row with `undone_at is null`, newest first. A merge
past its window cannot be undone by the function; the orchestrator lists those and the owner decides before any
rollback. Then drop the two functions, the redirect triggers and their function, the flag trigger and its
function, the dismissal functions, the new flag columns and indexes, `contact_merges`, the generated columns and
their indexes and functions, and the `merged_*` columns and constraints. Restore 0103's
`contact_delete_blockers` body and the 0033 flag policy.

---

## 5. The merge itself

### 5.1 Which record survives (D4)

**The older record** (`created_at`, then `id`) is preselected as the one to keep. It usually carries the most
history and the first-touch attribution (`attribution`, `source`). The compare screen offers "Keep this one
instead", which swaps the sides; nothing else changes. Every row moves either way, so this choice only decides
which id survives, and with it the deep links already sent (a shared document link, a calendar invite) that name it.

### 5.2 Fields: rules, and a choice only where both hold a value

The compare screen shows the two records side by side. **Only a field where both records hold different
non-blank values is a choice**, and the kept record's value is preselected. Every other field follows a rule,
and the screen lists what the rules will do in one line ("Also keeps: the email from María G.").

| Field | Rule |
|---|---|
| `first_name`, `last_name` | Choice when both differ; a blank is filled from the other |
| `email` | Choice when both differ; blank filled. The other address stays on the tombstone, so mail from it still files on the kept record (D8) |
| `phone` (+ `phone_country_unconfirmed`, which travels with the chosen number) | Choice when both differ, each shown with its country; blank filled. The other number stays on the tombstone, so calls and texts from it still reach the kept record (D8) |
| `company_name` | Not chosen. It is read-only, synced from the business group (`MIG/0072_company_name_read_only.sql`); the group memberships merge (5.3) and the sync trigger (`MIG/0069:224`) recomputes it |
| `custom` (jsonb) | Key by key: a key on one side only is kept; a key on both with different values is a choice row |
| `assigned_to` | Choice when both are assigned to different people; otherwise whoever holds it |
| `language`, `language_source`, `language_set_at` (`MIG/0076_customer_language.sql:57-59`) | One fact (DESIGN.md, A customer's language). If one side is blank, take the other's fact with its source and time. If both differ: a staff-set language beats a customer's sign; else the EARLIER sign stands ("never overwritten by a later sign"). It is shown as a choice anyway, with the rule's answer preselected |
| `marketing_email_opted_out_at` (`MIG/0049`) | The earliest non-null value. An opt-out on either record holds |
| `dnd` (jsonb) | Each channel set on either side stays set. The more careful answer wins |
| `reactivation_sent_at` (`MIG/0047`) | The later value, so the reactivation pass does not ask twice |
| `archived_at`, `archived_by` | Archived only if BOTH were. If the kept record was archived and the other was not, the merge restores it, and writes a `restored` row to `contact_archive_log` with the merging person as author |
| `source`, `attribution`, `author_kind`, `author_id`, `created_at` | The kept record's. The other's values live on the tombstone and in `keep_before`'s companion snapshot |

Consent is NOT a field. The ledger is keyed by address, not by contact (`MIG/0054:92-93`), so each number and
address keeps exactly the state it had. A STOP sent from the other number still stops that number.

### 5.3 Every table that references a contact, and what happens to it

The 21 tables of `FK_PAIRS` (`ai-acts-schema.test.ts:860-872`), plus the three that hang off `conversations`.
"Move" means `contact_id := keep`, with the key recorded in `moved`. "Remove" means delete, with the snapshot
recorded in `removed`.

| Table (FK) | Treatment | Why, and the conflict rule |
|---|---|---|
| `ai_acts` (`0091:84-85`) | **Stays** on the tombstone | `contact_id` is fixed from every role (`0091:93-107`). The kept record's timeline reads it through the id set (6.4). Undoing a stale act is section 7.3 |
| `automation_log` (`0046:40`) | Move | The unique key is `(account_id, source, subject_key)` (`0046:53`), with no contact in it, so a move cannot collide. "Already sent" stays true for the kept record |
| `bookings` (`0050:102`) | Move | Reminders then go to the kept record's chosen phone and email |
| `calls` (`0019:48`; `conversation_id` `0019:49`) | Move; `conversation_id` follows the thread (below) | A call is a fact of the line; it stays countable |
| `client_group_members` (`0069:63-74`) | Move; if the kept record is already in the same group, remove the other's membership | `unique (client_group_id, contact_id)` (`0069:74`). The kept membership takes `is_billing` OR'd and `is_primary_contact` if either had it (`0075:51-53`, one per group). `is_primary` is unique per contact (`0069:79`): if both had a primary group, the moved membership loses `is_primary` (snapshot kept) |
| `consent_events` (`0054:84-89`) | **Stays** | No role holds UPDATE (`0054:92-93`). State is per address, so nothing is lost. The timeline reads it through the id set |
| `contact_archive_log` (0103) | **Stays** | The other record's own archive history. Shown in the kept timeline as the other record's rows (6.4) |
| `contact_duplicate_flags` a / b (`0033:55-56`) | The merged pair is resolved (`merge_id`). Every other pair naming the other record is re-pointed to keep and re-sorted (`contact_a < contact_b`, `0033:62`); a pair that becomes a self-pair or repeats an existing pair is removed | So "María C." still shows as a possible duplicate of the merged María |
| `contact_relationships` contact / related (`0070:35-50`) | Move both columns. A relationship between the two merged records becomes a self-row and is removed; a move that repeats a relationship the kept record already has is removed | The two unique indexes (`0070:71-79`) |
| `contact_tags` (`0003:31-34`) | Move; a tag both had is removed from the other | PK `(contact_id, tag_id)` |
| `conversations` (`0005:10-25`) | **Combine.** If the kept record has no thread, the other's thread is simply re-pointed (one row, recorded). If both have one: every `messages` row, every `calls.conversation_id` and every `inbound_emails` row moves to the kept thread (ids recorded); unread is summed and recorded as `unread_handed`; `last_message_at` is the later; `assigned_to` is the kept thread's unless blank; then the emptied thread is removed (snapshot) | One thread per contact (`conversations_account_contact_unique`, `0005:24-25`). `inbound_emails` CASCADEs on its thread (`0082:93-94`), so it must move BEFORE the thread is removed. 0103's `contact_archived` and `inbox_visible` re-derive on the write (archive spec 3.1 step 10). Mechanics are `move_holding_thread`'s (`0098:110-230`) |
| `document_requests` (`0080:75-101`) | Move | |
| `document_requirement_skips` (`0081:69-81`) | Move; a skip the kept record already has for the same category is removed | `document_requirement_skips_active` (`0081:81`) |
| `documents` (`0077:56-76`) | Move | NO ACTION FK. **ASSUMPTION:** a file's storage path does not need to name its contact, so moving the row is enough. The plan reads `packages/db/src/documents.ts`'s path builder before T3 and, if the path names the contact, records that reads go by the row's stored path |
| `form_submissions` (`0006:42`) | Move | |
| `notes` (`0003:98`) | Move | Author marks are on the note and unchanged |
| `opportunities` (`0050:110`) | Move | The dashboard's value metric is per deal, unchanged |
| `places` (`0071:39-54`) | Move | `places_owner_guard` (`0071:154-165`) only limits a signed-in Technician; the definer passes it |
| `proposals` (`0088:88`) | **Stays** | Fixed (`0088:128-142`). A pending suggestion still names the tombstone; Accept follows the pointer and writes to the kept record (7.3) |
| `record_summaries` (`0087:36-52`) | Removed (not snapshotted) | A cache, one per language. The kept record's summary is out of date anyway and regenerates. Undo regenerates too |
| `tasks` (`0003:109`) | Move | |
| `messages`, `inbound_emails`, `calls.conversation_id` | Follow the thread, as above | `messages.conversation_id` is NO ACTION (`0005:33`), so a missed one would make the thread delete fail and roll the whole merge back. It fails closed |

References that are not foreign keys stay as written. `events.payload` is append-only history, read through the
id set. Queued jobs (`MIG/0102_jobs.sql`) that name the other record resolve through the pointer when they run
(7.1); the plan greps `packages/db/src/jobs.ts` and each job handler for a contact id before T5.

---

## 6. Where it shows up (D3), under the module contract

DESIGN.md's module contract allows a card on the record, one entry in an existing list, work routed to the work
queue, and news to the record's timeline. Nothing here is a new top-level surface. The compare screen is a
sub-route of Contacts, as `contacts/import` already is.

### 6.1 Under the record header: one line, only when there is something to say

Below `RecordHeader` (`ACCT/contacts/[contactId]/page.tsx`, the `space-y-2` block that already holds the archived
banner): "May be the same person as **María García** · same phone number · Compare". It shows the strongest open
pair (phone, then email, then name); with more than one pair it adds "and 2 more". There is no card for this.
A card would be empty on almost every record, and rule 5's empty state would sell nothing. The drawer shows the
same line in its header section. It is hidden for a Technician (they cannot read the queue, `0068:146-148`).

### 6.2 The contact list: a "Possible duplicates" view

`?view=duplicates` beside `?view=archived` (`apps/web/src/lib/contacts/view.ts:4`, `ContactsView`). One row per
open pair: both names, the reason in words, and when it was found. The whole row is the click target and opens
the compare screen (DESIGN.md rule 4; a row is not a link). Cursor paging on `(created_at desc, id desc)`
through `contact_duplicate_flags_open` (4.3), with exactly one pager, and the header states the real total of
open pairs. Ordered by strength of reason, then newest: `same_phone`, `same_email`, `email_phone_conflict`,
`same_digits` and `phone_country_twin`, `phone_shared_new_person`, `hidden_match`, edits, `same_name`. The
strength rank is stored as a small integer column on the flag, so the cursor stays a column cursor.
Empty state: "No possible duplicates. When two records look like the same customer (same phone, email or
name), they show up here." No checkboxes, so no bulk bar (rule 4).

"Not the same person" sits on each row as a ghost action. It runs at once with Undo.

The list reads exclude a pair when either side is a tombstone or a holding record, or (phone reasons only) the
two share a household, or the two have a relationship row (3.1). These are read-time filters, so the total
comes from the same query as the rows (one helper, `withArchived`'s pattern).

### 6.3 The work queue: one count row

To do (`ACCT/tasks/page.tsx`) gains one row when the account has open pairs: "3 possible duplicate customers to
check", linking to the view. It is shaped like the held-email count already read there (`ACCT/tasks/page.tsx:81`,
`countHeldInboundEmails`, `packages/db/src/inbound-email.ts:315-318`). A head count that comes back `null` throws
instead of reading 0 (the head-count-null lesson). The agency-wide work page is unchanged in part 1.

### 6.4 The compare screen and the timeline

`ACCT/contacts/merge?keep=<id>&other=<id>`: two columns on a desk, one column each on a phone (the kept record
first). It is server-rendered from both rows. It shows the conflicting fields as choices (5.2), what the rules
will keep, and what will move ("12 texts, 3 calls, 1 booking, 2 files move to María García"). Counts are read
when the screen opens (rule 7: skeletons while loading). **One primary button: Merge.** Cancel is ghost. Both
rows' `updated_at` travel as `p_seen`, so a stale screen reloads (4.4 step 3). There is no typed confirm (D6).

After a merge, the toast reads "Merged into María García · Undo", and the page goes to the kept record.

**Timeline.** A new source `merge` in `listTimelinePage` (`packages/db/src/record.ts:463-466`), read from
`contact_merges` by `keep_id`. The row reads "Merged with María G.: 12 texts, 3 calls and 1 booking moved here",
with the person's author mark (DESIGN.md, Provenance) and "Undo merge" while `undo_until` is in the future. After
an Undo, "Merge undone" with the person's mark.

The kept record's page passes `[keep, ...tombstones]` as `contactIds`. The function already reads a set, for a
household (`record.ts:450-469`, "each entry naming its member"), so the rows that stay on a tombstone (Sofía's
acts, consent rows, its archive history) appear on the kept timeline, each labelled with the tombstone's own name
as a household member's row is.

A deep link to a tombstone redirects to the kept record, exactly where the page already redirects a holding
record (`ACCT/contacts/[contactId]/page.tsx:100-102`). A `?peek=` link to one opens the kept record's drawer.

---

## 7. Concurrency, and Sofía after a merge (D8)

### 7.1 Every lookup that finds a contact by phone or email resolves the pointer

A tombstone keeps its phone and email (4.1). So every read that finds a contact by key selects `merged_into` and
answers `coalesce(merged_into, id)`, de-duplicated:

| Read | Where | Why it matters |
|---|---|---|
| `findDuplicate` | `contacts.ts:272-369` (both reads, and the legacy read at `:357-358`) | `createContact` must land a new lead on the kept record, never a third record |
| `listContactsOnNumber` | `packages/db/src/voice.ts:760-772` | **The caller-identity choke point.** `readCandidates` (`apps/web/src/lib/voice/identity/candidates.ts:19-20`) and `isShared` (`:15`) count people on a number. Unresolved, a kept record and its own tombstone would read as two people, and the SMS route would file a text on the number's holding record (`apps/web/src/app/api/sms/inbound/route.ts:207-213`) instead of the customer |
| inbound email match | `packages/db/src/inbound-email.ts:329-341` | Mail from the address the merge did not keep files on the kept record |
| `flagMatchesOf`, `flagDuplicatesAfterWrite` | `contacts.ts:526-559`, `:411-440` | A tombstone is never paired again |
| `getContact` | `contacts.ts:969` | Returns `merged_into` so the page and the drawer can redirect (6.4) |
| CSV import match | `packages/db/src/contact-import.ts` (its match index) | A re-imported export row for the merged-away record updates the kept one |

A tombstone is never a candidate on its own. The redirect is one hop, because 4.4 step 6 flattens chains.

### 7.2 The backstop: a write that names a tombstone lands on the kept record

A call can last ten minutes. `finishCall` resolves its contact when the call starts and writes the call, the
To-do, the summary and the act when it ends. If a merge happens in between, those writes name the tombstone.

Trigger `app.follow_merge()`: SECURITY DEFINER, `BEFORE INSERT OR UPDATE OF <contact column>` on every table in
`FK_PAIRS` except `contact_merges` and the pointer itself. It reads the named contact by primary key, and when
that row is a tombstone it rewrites the column to `merged_into`. The column name is passed as a trigger argument
(`TG_ARGV[0]`) and applied with `jsonb_populate_record`. On `ai_acts`, `proposals` and `consent_events` it fires
on INSERT only: their fixed-column triggers already refuse updates, and a new row is not history yet.
It costs one primary-key read per write.

`ensureConversation` (`packages/db/src/messaging.ts:121-150`) looks up by `contact_id` and then inserts. Called
with a tombstone id, its lookup would miss, its insert would be redirected onto the kept record's existing thread,
and the 23505 fallback would look up the tombstone again and miss. So it resolves the id first (7.1). The trigger
is the backstop, not the fix.

### 7.3 A merge racing an inbound text, call or booking for the other record

- **A text** whose route resolved the other record just before the merge. Its message insert takes a key-share
  lock on the other thread, which the merge holds `for update` (4.4 step 2), so the insert waits. If the merge
  removed that thread, the insert then fails its foreign key. On a first filing that is `FilingFailed`, a 503
  (`route.ts:180-192`, `:200-213`). Telnyx retries, and the retry resolves to the kept record. **ASSUMPTION:**
  Telnyx retries a 503 at least once. The route already relies on this (`route.ts:180-182`); the plan does not
  re-verify it.
- **A booking or form** on the public pages resolves the contact through `findDuplicate` at submit (7.1). A stale
  id reaching an insert is redirected (7.2).
- **A call in progress**: as 7.2.
- **Two merges of one record**: the second waits on the row lock, then sees `merged` and refuses.
- **A merge and an archive**: both lock the contact row. Archive on a tombstone is refused (4.1).
- **An Undo racing a new text** on the kept thread: Undo moves back only recorded ids, so the new text stays on
  the kept record and is counted in `keptNew`.
- **Sofía's or the tray's late writes**: an AI act's Undo (`contact_field_filled`, `contact_created`) and a pending
  suggestion's Accept read the contact from a fixed row that names the tombstone. Both resolve the pointer before
  they write. `contact_created`'s Undo, which deletes the contact, refuses once the contact is part of a merge
  (`ai_contact_held_by` answers `merges`, 4.7).

---

## 8. Who, audit, and dismissals (D9, D11)

- **Merge and Undo:** Owners, Staff and the agency. Not Technicians: they see only their assigned customers
  (`0068`), cannot read the queue (`0068:146-148`), and a merge moves rows they cannot see. Enforced in the app
  (`seesWholeAccount`, the archive's check) and in both definers (4.4 step 1).
- **Dismiss ("Not the same person"):** the same people. `dismiss_duplicate_pair(account, flag_id)` stamps
  `dismissed_at` / `dismissed_by` and returns the flag id for the Undo toast; `undismiss_duplicate_pair` clears
  them. A dismissed pair is never suggested again, because the trigger's `on conflict do nothing` keeps the row
  (3.5). There is no screen of dismissed pairs in part 1.
- **Audit:** `contact_merges` holds who, when, every value overwritten, every row moved or removed, and the
  Undo. The `contact.merged` and `contact.merge_undone` events carry an explicit `user` actor. The timeline row has
  the person mark. D10: when S-04's `record_changes` lands, `merge_contacts` also writes one change row per field
  it overwrote. Until then `keep_before` / `keep_after` are that record.

---

## 9. F-118 (note only, not designed here)

F-118's lane (migration 0105) logs agency views of contacts. Three touch points for that lane to decide:
the compare screen reads two contacts at once (two views or one); a deep link to a tombstone redirects to the
kept record (log the record actually shown, which is the kept one); and the kept timeline reads tombstone rows
through the id set. A merge is a write, logged in `contact_merges`, not a view.

---

## 10. Copy (English, Spanish usted)

New keys go under `contacts.duplicates.*`, `contacts.merge.*` and `timeline.merge*` in
`apps/web/src/lib/messages.ts`. A count has a One twin picked by `plural()`. No arrows, no milestone codes, no
`{{template}}`. A name shown is the contact's display name. The kept record is never called "survivor" and the
tombstone never "loser" on screen.

| Key | English | Spanish |
|---|---|---|
| `contacts.duplicates.banner` | May be the same person as {name} · {reason} · Compare | Puede ser la misma persona que {name} · {reason} · Comparar |
| `contacts.duplicates.bannerMore` / `One` | and {count} more / and 1 more | y {count} más / y 1 más |
| `contacts.duplicates.reason.samePhone` | same phone number | mismo número de teléfono |
| `contacts.duplicates.reason.sameDigits` | same phone digits, saved as a US and a Mexican number | mismos dígitos, guardados como número de EE. UU. y de México |
| `contacts.duplicates.reason.sameEmail` | same email | mismo correo |
| `contacts.duplicates.reason.sameName` | same name | mismo nombre |
| `contacts.duplicates.reason.other` | found when a record was saved | se detectó al guardar un registro |
| `contacts.view.duplicates` | Possible duplicates | Posibles duplicados |
| `contacts.duplicates.count` / `One` | {count} possible duplicates / 1 possible duplicate | {count} posibles duplicados / 1 posible duplicado |
| `contacts.duplicates.emptyTitle` | No possible duplicates | No hay posibles duplicados |
| `contacts.duplicates.emptyBody` | When two records look like the same customer (same phone, email or name), they show up here so you can merge them. | Cuando dos registros parecen ser el mismo cliente (mismo teléfono, correo o nombre), aparecen aquí para que los una. |
| `contacts.duplicates.notSame` | Not the same person | No es la misma persona |
| `contacts.duplicates.dismissed` | Got it. We won't suggest these two again · Undo | Entendido. No volveremos a sugerir estos dos · Deshacer |
| `work.duplicates` / `One` | {count} possible duplicate customers to check / 1 possible duplicate customer to check | {count} posibles clientes duplicados por revisar / 1 posible cliente duplicado por revisar |
| `contacts.merge.title` | Merge two records | Unir dos registros |
| `contacts.merge.keep` | Keep this one | Conservar este |
| `contacts.merge.swap` | Keep this one instead | Mejor conservar este |
| `contacts.merge.pick` | Both records have a different {field}. Which one is right? | Los dos registros tienen {field} distinto. ¿Cuál es el correcto? |
| `contacts.merge.alsoKeeps` | Also keeps: {list} | También conserva: {list} |
| `contacts.merge.otherNumber` | Calls and texts from {phone} will still reach {name}. | Las llamadas y los mensajes de {phone} seguirán llegando a {name}. |
| `contacts.merge.moves` | Moves to {name}: {list} | Pasan a {name}: {list} |
| `contacts.merge.action` | Merge | Unir |
| `contacts.merge.done` | Merged into {name} · Undo | Se unió con {name} · Deshacer |
| `contacts.merge.stale` | One of these records changed while you were looking. Here it is again with the new details. | Uno de estos registros cambió mientras lo revisaba. Aquí está de nuevo con los datos nuevos. |
| `contacts.merge.failed` | Couldn't merge. Nothing changed. Try again. | No se pudo unir. No cambió nada. Intente de nuevo. |
| `contacts.merge.undone` | Merge undone. {name} is back as their own record. | Se deshizo la unión. {name} volvió a tener su propio registro. |
| `contacts.merge.undoneKept` / `One` | {count} things that arrived after the merge stay with {name}. / 1 thing that arrived after the merge stays with {name}. | {count} cosas que llegaron después de la unión se quedan con {name}. / 1 cosa que llegó después de la unión se queda con {name}. |
| `contacts.merge.undoExpired` | This merge is more than 30 days old and can't be undone. | Esta unión tiene más de 30 días y ya no se puede deshacer. |
| `timeline.merged` | Merged with {name}: {list} moved here | Se unió con {name}: {list} pasaron aquí |
| `timeline.mergeUndone` | Merge with {name} undone | Se deshizo la unión con {name} |
| `timeline.undoMerge` | Undo merge | Deshacer unión |
| `contacts.delete.reason.merges` (folded into "a history with you", archive spec 6.3) | none of its own | |

`{list}` is built from counted phrases ("12 texts, 3 calls and 1 booking"), each with its One twin, joined by
the locale's own list format.

---

## 11. Tests, each with the mutation that must turn it red

Rule 2 of the working rules applies: run each mutation, confirm the named test fails, and paste the line. A
`-t` filter that matches no test name proves nothing. Read `bis-test-vacuity`: every "found by name" test must
use two contacts that share NOTHING else, or a phone or email match satisfies the assertion (the
adjacent-satisfaction shape).

**Keys and parity (`packages/db/src/test/contact-name-key.test.ts`, `contact-dedupe-keys.test.ts`, real local stack):**

| Test | Mutation that must fail it |
|---|---|
| `name_key` equals `nameKey()` for each of ~30 real shapes inserted as contacts (accents in both cases, Ñ, hyphen, "y", "de la", "San", NBSP, tab, an apostrophe, an empty last name, each placeholder) | drop `Ñ` from the SQL map only (TS keeps it) |
| "María García López" / "Maria Garcia" (different phones, no email) are paired `same_name` | remove the first-surname step |
| "Muñoz" / "Munoz" are paired | drop ñ from both maps |
| "Juan Carlos García" / "Juan García" are NOT paired | key on the first word of the first name |
| "Caller" / "Caller" and "Unknown Caller" / "Unknown Caller" are never paired | delete the placeholder list |
| a contact with no last name gets a NULL `name_key` | coalesce the last name to '' |
| `phone_national` equals `phoneNational()` for `+19562921696`, `(956) 292-1696`, `+528999221234`, `+5218999221234`, `044 899 922 1234`, `01 899 922 1234`, `+44…`, typed text | drop the `521` branch in SQL only |
| a legacy `+5218999221234` row and a new `+528999221234` row are paired `same_phone`… | remove the `521` branch |
| …and `+18999221234` / `+528999221234` are paired `same_digits`, not `same_phone` | classify by `phone_national` alone, with no family test |

**Pair queue (`contact-duplicates.test.ts`):**

| Test | Mutation |
|---|---|
| a Technician's insert queues a pair with a contact outside their assignment | make the trigger SECURITY INVOKER |
| a dismissed pair stays dismissed after both records are edited again | `on conflict do update` |
| a holding record is never paired | drop the holding filter in the trigger |
| two household members on one phone are not in the list; the same pair by email is | drop the household filter / apply it to every reason |
| a relationship row hides the pair | drop the relationship filter |
| the list's total equals its rows across a page boundary | apply a filter to rows only |
| the list orders `same_phone` before `same_name` | drop the strength column from the order |

**Merge (`contact-merge-schema.test.ts`, real local stack, one test per 5.3 row):**
- For each moved table: a row on the other record is on the kept record afterwards, and its key is in `moved`
  (mutation: drop that table's update). For each table with a conflict rule: the duplicate is gone, its snapshot
  is in `removed`, and the kept row has the OR'd flags (mutation: drop the conflict step, and the merge must fail
  on the unique index, so the test asserts the merge succeeds).
- `ai_acts`, `proposals`, `consent_events` rows stay on the tombstone, and the kept timeline lists them
  (mutation: read the timeline with `[keep]` only).
- Combined threads: every message, call and inbound email ends on the kept thread, unread is the sum, and the
  emptied thread is gone (mutation: skip `inbound_emails`; then the cascade deletes it and the count drops).
- The values written come from the rows, not the client: a `p_choices` naming `other` for `phone` writes the
  other row's phone (mutation: read the value from `p_choices`).
- `stale`: change the other's `updated_at` between read and merge (mutation: drop the check).
- A Technician is refused; an Owner with client access off is refused through the NULL path (mutation: drop both
  coalesces, as the 0103 probe does); Staff succeeds.
- Merging into a holding record, a tombstone, or across accounts is refused, each by status.
- A chain (A into B, then B into C) leaves A pointing at C (mutation: drop the flattening).

**Undo:**
- An Undo puts every recorded row back, re-creates the removed thread with its id, and the counts match the
  merge's (mutation: skip `removed` re-inserts).
- **Order:** with the redirect trigger installed, Undo puts rows back on the other record (mutation: clear the
  tombstone AFTER moving rows; then the trigger sends them to the kept record and the test fails). This is the
  test that proves 4.5 step 2.
- A field edited after the merge keeps its edit and is named in `keptEdits` (mutation: unconditional restore).
- A text that arrived after the merge stays on the kept record and is counted in `keptNew` (mutation: move every
  message on the thread instead of recorded ids).
- `expired`: set `undo_until` in the past through the service client (mutation: drop the window check).
- `later_merge` (mutation: drop the check; then the second Undo corrupts the first).

**Redirect and lookups:**
- A task inserted with a tombstone's id lands on the kept record (mutation: drop the trigger on `tasks`).
- Guard: every table in `FK_PAIRS` except the two named exclusions has `follow_merge` (mutation: drop one; the
  test reads `pg_trigger`, not a hand list).
- `listContactsOnNumber` returns the kept record once for a number held by it and its tombstone (mutation: drop
  the resolve). Plus the identity test above it, `readCandidates`, answers "not shared" (mutation: the same).
- `createContact` with the tombstone's email returns the kept id with `existing: true` (mutation: drop the resolve
  in `findDuplicate`).
- `ensureConversation` with a tombstone id returns the kept thread (mutation: drop its resolve; the trigger alone
  then fails it with 23505 and a missed lookup).
- The SMS route, given a contact that is merged between its read and its message insert (two clients, the
  merge holding the lock), answers 503 on the first filing (mutation: catch the FK error as filed).

**Web (`ACCT/contacts/merge/*.test.ts`, `view.test.ts`, record page and drawer tests, `messages.test.ts`):** the
compare screen offers a choice only for fields both hold differently (mutation: list every field); Merge is
the one primary (rule 8); the toast's Undo calls `undo_contact_merge` with the merge id the action returned
(mutation: pass the pair); the record page redirects a tombstone (mutation: drop the redirect); the banner hides
for a Technician. `messages.test.ts` pins every new string in both languages, under the existing
`INTERNAL_MILESTONE` and accent guards.

**e2e: one spec, warranted.** `apps/web/e2e/contacts-merge.spec.ts`: two seeded contacts with one phone on the
**per-run fixture account**, never `Test Client One` → the record shows the banner → Compare → pick a name →
Merge → the list total drops by one and the timeline shows the merge row → Undo → both records are back. No unit
test spans the action, the redirect, the list total and the toast together.

---

## 12. Tasks and apply order

Tiers follow the speed process. Within a wave, no two tasks touch the same file.

**Wave 1**
- **T1, high, bis-db-schema:** migration 0106 (section 4, the backfill, the triggers, the definers, the
  `contact_delete_blockers` reason) and its schema tests (section 11, Keys, Pair queue, Merge, Undo, Redirect).
  Files: `MIG/0106_contact_merge.sql`, `packages/db/src/test/contact-merge-schema.test.ts` (new),
  `contact-name-key.test.ts` (new), `contact-dedupe-keys.test.ts`, `ai-acts-schema.test.ts` (FK list 23 to 26),
  `definer-search-path.test.ts`, `schema-grants-guard.test.ts`, `proposals-drop.test.ts`.
- **T2, low, bis-crm:** every string in section 10. Files: `apps/web/src/lib/messages.ts`, `messages.test.ts`.

**Wave 2** (0106 on the local replica)
- **T3, high, bis-crm:** the query layer. `name-key.ts` (new), `phoneNational`, `withArchived`'s tombstone filter,
  the resolve in `findDuplicate`, `flagMatchesOf`, `flagDuplicatesAfterWrite`, `getContact` and the import match,
  `listDuplicatePairs` / `countDuplicatePairs`, `mergeContacts` / `undoContactMerge` / `dismissPair` wrappers,
  the `merge` timeline source, the barrel. Files: `packages/db/src/contacts.ts`, `contact-import.ts`,
  `record.ts`, `name-key.ts`, `index.ts`, and their tests.
- **T4, medium, bis-voice:** `listContactsOnNumber`'s resolve (`voice.ts:760-772`), `ensureConversation`'s
  resolve (`messaging.ts:121`; bis-comms co-review), the AI act Undo and the suggestion Accept following the
  pointer, and `ai_contact_held_by`'s `merges` clause (a SQL change, carried in 0106 by T1 with this lane's review).

**Wave 3** (T3 merged)
- **T5, medium, bis-crm:** the compare route, the actions, the duplicates view, the To do row, the inbound-email
  resolve (bis-comms co-review). Files: `ACCT/contacts/merge/*` (new), `ACCT/contacts/page.tsx`,
  `apps/web/src/lib/contacts/view.ts`, `ACCT/contacts/actions.ts`, `ACCT/tasks/page.tsx`,
  `packages/db/src/inbound-email.ts`.
- **T6, medium, bis-frontend:** the header line and its drawer twin, the tombstone redirect, the timeline row
  with Undo merge. Files: `ACCT/contacts/[contactId]/page.tsx`, `ACCT/contacts/contact-drawer.tsx`,
  `activity-timeline.tsx` (+ `activity-timeline.merge.test.ts`, new).

**Wave 4**
- **T7, medium, bis-e2e-qa:** `apps/web/e2e/contacts-merge.spec.ts` on the per-run fixture account.

**Apply order.** 0106 is LOAD-BEARING: from T3 on, the app names `merged_into`, `phone_national` and `name_key`
in its reads. (1) The local replica, with the guard tests before and after. (2) bis-ci, **only after 0105 is
there**, through `ci-project-setup.yml` (numeric order; the `e2e` job's
`.github/scripts/ci-migrations-applied.sh` check). (3) Production, after a read-only contacts count (4.6),
off-peak if it is above 50,000. (4) The parity check (`docs/runbooks/ci-supabase-project.md`). (5) Only then
merge the app PR. If 0105 slips, 0106 waits for it. Renumbering is the other option, and the orchestrator decides.

---

## 13. Decisions for the owner

1. **D2: Show "same name" pairs in part 1?** Recommendation: yes, labelled "Same name", listed after phone and
   email pairs, keyed on first name + first surname, with a last name required and placeholder names excluded.
   The other choice is phone and email only, which drops the two-surname half of F-006's promise until later.
2. **D4: Which record is kept by default?** Recommendation: the older one, with "Keep this one instead" on the
   compare screen.
3. **D7: How long can a merge be undone?** Recommendation: 30 days, from the toast and then from the timeline row.
   After that the merge stays, with its full log.
4. **D8: The phone or email the merge did not keep.** Recommendation: it still reaches the kept record (calls,
   texts and mail from it file there), because the merged-away record stays as a hidden pointer. The other
   choice, forgetting it, would turn the next call from that number into a brand-new "Caller".
5. **D9: Who may merge?** Recommendation: Owners, Staff and the agency, as for archive. Not Technicians.
6. **D10: Ship before S-04's change log?** Recommendation: yes. The merge's own log records every overwritten
   value and every moved row; when S-04 lands, the merge writes S-04's rows too. This changes the roadmap's
   stated order (`docs/crm-features.md:1404-1406`: S-04 before S-12), so it is the owner's call.
