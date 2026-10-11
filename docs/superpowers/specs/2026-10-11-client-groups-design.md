# Client groups and the business name — design (first release, item 2, part 1 of 3)

Date: 2026-10-11. Owner decisions from this session (§2). Plan: `docs/crm-features.md` §4.3 item 2
(S-02, row at `:1260`). Source design: `docs/research/2026-09-25-crm-feature-research.md` §3.2
(`:206-283`). Lane A. Lane B writes relationships, then properties and equipment, as their own specs.

## 1. Goal

A customer can belong to a **household** or a **business customer**, with a role in it ("Madre",
"Dueño"), one group marked as their main one, and a flag for who pays. Today's free-text
`contacts.company_name` becomes a real business group: every existing name is backfilled into one,
and from now on the contact's Business name, CSV import and export, and the forms' business
question read and write the group. The old column stays, as a copy the database maintains: written
by the app for nothing after this release, and read-only to clients from the follow-up on (G9).

## 2. Decisions (owner, 2026-10-11)

| # | Question | Decision |
|---|---|---|
| G1 | How S-02 is split | Three specs in two lanes: this one (groups and the `company_name` backfill); Lane B does relationships, then properties and equipment |
| G2 | Where it shows | Each part ships a WORKING card on today's contact drawer and contact page. No new top-level page. Item 3 (the record page) later moves the cards into its card registry |
| G3 | Suggested groups (shared email domain, phone, surname and address) | DEFERRED to item 8 (the review tray). Not here |
| G4 | Kinds in the first cut | `household` and `business` only. Labels per reader language: "Household" / "Familia", "Business customer" / "Cliente comercial". NEVER "Company": that word names the BIS client in the UI. Facility and referrer wait for their packs |
| G5 | `company_name` | Backfill one business group per distinct name per account (trimmed, case-insensitive). From then on the Business name field, CSV import and export, and the forms `core.company_name` answer read and write the group. The old column is kept in sync for ONE release (dual-write), then **kept as a database-maintained, read-only copy** rather than dropped (amended by G9) |
| G6 | Memberships | A person can be in several groups. Exactly one membership is primary (shown first). Each has a free-text role label and an `is_billing` flag |
| G7 | Notes, tasks and deals on a group | DEFERRED to item 3 (relaxing NOT NULLs touches ~25 readers of `opportunities`) |
| G8 | Technician (0068) | Sees a group and its memberships only through customers assigned to them: the group a customer of theirs is in, and THAT member, never other members unless also theirs. Groups have no assignee |
| G9 | After the dual-write release (ruled on §13.1, 2026-10-11) | KEEP `contacts.company_name` as a read-only copy the database maintains, for server-side sort and paging. Not dropped |
| G10 | Business names (ruled on §13.2) | YES: one business customer per name per client company, case- and space-insensitive (A3). Households are not unique |
| G11 | A Technician types a business that already exists (ruled on §13.3, by the orchestrator, following the Technician spec's ruling 13.3) | YES: it links to the existing group |

Choices this spec makes; **(owner, 2026-10-11)** marks the ones ruled in §13:

| # | Choice |
|---|---|
| A1 | **Server-only writes (0053's pattern), not the contacts table's client writes.** `authenticated` gets SELECT only on both tables. Every write is a server action that proves the contact (or membership, or group) through the request client, then writes through the service client: the house rule of the Technician spec §7.3. Reasons: find-or-create by name, the primary swap and removal-with-promotion are multi-statement and need one transaction, which a PostgREST client call cannot give; a Technician must be able to link their customer to a business they cannot see (§13.3); and the column sync stays in one place |
| A2 | **The column is kept in sync by a database trigger, not by each writer.** `contacts.company_name` = the name of the contact's business group, primary first, then oldest. No app path writes `company_name` after this release; `ContactInput` loses `companyName`, so every old writer is a compile error, not a line to remember |
| A3 | **(owner, 2026-10-11, G10)** Business names are unique per account by their trimmed, lowercased key (a partial unique index); household names are not ("Garcia" is many families). This makes find-or-create race-safe (`on conflict do nothing`) |
| A4 | The backfill is an idempotent function, `public.reconcile_business_groups()`, called at the end of 0069 and ONCE more by the orchestrator after the new app is live, to fold in names the old build wrote between the migration and the deploy (§11) |
| A5 | The contact field's label becomes "Business name" / "Nombre del negocio" (`contact.company`, `messages.ts:637`, says "Company" today; the list column already says "Business name", `:565`). The forms editor's kind label follows (`:1222`) |
| A6 | Renaming a group and its billing address: Owner, Staff and the agency only. A group can hold customers a Technician does not serve. Deleting a group is not in this release (§3) |

## 3. Non-goals

Suggested groups (G3); notes, tasks and deals on a group (G7); facility and referrer kinds (G4);
relationships, properties and equipment (Lane B); a group page or a Groups list (G2; F-002); group
custom fields (`custom` exists but `custom_fields.model` is not widened); deleting or merging groups;
searching contacts or ⌘K by group name; collapsing inner spaces in a name ("Acme  Roofing" and "Acme
Roofing" stay two keys, per G5's "trimmed"); the follow-up that makes `company_name` read-only (§11).

## 4. Roles

| Capability | Owner | Staff | Technician | Agency |
|---|---|---|---|---|
| See a group | all | all | only through their own customers (G8) | all |
| See a group's members | all | all | only their own customers | all |
| Add a customer to a group, create a group, set role, main, pays | yes | yes | own customers only | yes |
| Set a customer's Business name | yes | yes | own customers only | yes |
| Rename a group, edit its billing address | yes | yes | **no** (A6) | yes |
| Remove a membership (with Undo) | yes | yes | own customers only | yes |

## 5. Data: migration 0069

Next after `0068_mine_unassigned_technician.sql`, by bis-db-schema. ASCII only, no backslash
(0050:86's rule; the MCP apply has mangled `\u` escapes before). `set local lock_timeout = '5s'`.

### 5.1 Tables

```
client_groups: id uuid pk; account_id -> accounts(id) on delete cascade;
  kind text check (kind in ('household','business')); name text check (char_length(btrim(name, WS)) between 1 and 120);
  name_key text generated always as (lower(btrim(name, WS))) stored;
  billing_address text null check (null, or 1..300 after btrim); custom jsonb default '{}'; created_at, updated_at;
  unique (account_id, id)   -- the FK target, as contacts_account_id_id_key (0050:93)
client_group_members: id uuid pk; account_id -> accounts(id) on delete cascade; client_group_id, contact_id not null;
  role text null check (1..60); is_primary, is_billing boolean not null default false; created_at;
  (account_id, client_group_id) -> client_groups(account_id, id) on delete cascade;
  (account_id, contact_id) -> contacts(account_id, id) on delete cascade; unique (client_group_id, contact_id)
```

`WS` = `' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(160)`, 0034's explicit
whitespace class without a backslash. **Assumption, verify on the PG18 replica first:** Postgres
accepts it in a generated column (`chr`, `btrim`, `lower` are immutable). No TypeScript twin of
`name_key`: matching happens only in SQL, so 0033/0034's twin drift cannot happen.

**Composite FKs** (0050) make a crossed row unwritable. **Cascades:** a deleted contact or group
takes its memberships; a deleted account takes both. The account cascade is deliberate: an old
build's teardown (which does not list the new tables) still succeeds during the rollout, and
`contacts` and `bookings` still refuse an account delete on their own. A group whose last member
leaves is kept (it may carry a billing address).

**Indexes:** `client_groups_business_key unique (account_id, name_key) where kind = 'business'` (A3);
`client_groups_account_key (account_id, name_key)`; `client_group_members_one_primary unique
(contact_id) where is_primary` (G6's "at most one"; "at least one when any exist" is kept by §5.3's
functions and tested); `client_group_members_contact (account_id, contact_id)`.

### 5.2 RLS, grants and the Technician

- `enable row level security` on both. Tenant read, as 0053:108-125:
  `client_groups_member_read` and `client_group_members_member_read`, `for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id())`. No write policy.
- Grants: `revoke all … from anon`; `revoke insert, update, delete, truncate, references, trigger,
  maintain … from authenticated` (a new table gets the default ALL again, `schema-grants-guard.test.ts:12`).
  `EXPECTED_WRITES` (`:62-92`) is UNCHANGED: the guard proves the revoke and names a forgotten one.
- `app.my_client_group_ids() returns setof uuid`: the groups of `app.my_contact_ids()`'s contacts.
  `stable security definer set search_path = ''`, `authenticated, service_role` only, like
  `my_contact_ids` (0068:83-97), so it never re-enters the members policy.
- Restrictive, 0068 §4's shape (an InitPlan on the left, so Owner, Staff and agency pay ~nothing):
  `client_group_members_technician_scope … as restrictive for select to authenticated using ((select
  app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()))`
  and `client_groups_technician_scope … using ((select app.sees_all_customers(app.current_account_id()))
  or id in (select app.my_client_group_ids()))`. A client login with no membership sees none (0068 A1).

### 5.3 Write functions and the sync trigger

All `language plpgsql set search_path = ''`, not definer (the service role bypasses RLS); `revoke
all … from public, anon, authenticated, service_role; grant execute … to service_role` (0043's
lesson, as 0068:208-209). Each checks every row it touches belongs to `p_account_id` and returns
`not_found` otherwise; inputs are trimmed with `WS`.

| Function | Does |
|---|---|
| `create_group_with_member(p_account_id, p_contact_id, p_kind, p_name, p_role)` | household: insert. business: find-or-create by key (`on conflict do nothing`, re-select). Then links the contact. Returns group id, member id, and `existed` |
| `add_contact_to_group(p_account_id, p_contact_id, p_group_id, p_role)` | links; `on conflict (client_group_id, contact_id)` returns the existing row |
| `set_contacts_business(p_account_id, p_contact_ids uuid[], p_names text[])` | The Business name write, one row or an import batch. Per contact: blank name removes the business membership the column shows; same key as now: nothing; new key: find-or-create the group and REPLACE that membership, carrying `is_primary` (role and pays reset). Returns, per contact, the removed snapshot and the added id, for Undo |
| `set_primary_group_membership(p_account_id, p_member_id)` | clears the contact's other primary, then sets this one, in one transaction |
| `remove_group_membership(p_account_id, p_member_id)` | deletes; if it was primary, the oldest remaining becomes primary. Returns the full snapshot |
| `restore_group_membership(p_account_id, p_snapshot jsonb)` | Undo: re-inserts with the same id, role, pays and main (demoting whoever was promoted). `not_found` if the group or contact has since gone |
| `undo_set_business(p_account_id, p_contact_id, p_added, p_removed jsonb)` | The Business name's Undo: removes the membership the edit added and restores the one it replaced. It restores BUSINESS memberships only: a snapshot (it comes back from the browser) naming a household, or a group outside `p_account_id`, answers `not_found` and changes nothing (final review I-B) |

A contact's first membership is primary. Role, pays, name and billing address are single-row
service updates scoped by `account_id`; a rename onto another business's key raises `23505`,
shown as "There's already a business customer with that name." (`groups.nameTaken` dropped the
`{name}`; accepted in the final review).

**The sync (A2).** `app.sync_company_name()` (security definer: it writes a column the request role
may not, and runs inside cascades) fires `after insert or delete or update of is_primary,
client_group_id, contact_id on client_group_members for each row` and `after update of name, kind
on client_groups for each row`. It recomputes only on an insert, a delete, or an update of one of
those three columns: a role or "Pays the bills" edit never fires it (final review I-A: it once fired
on any update, so such an edit on a business membership erased an old build's direct write, which
the reconcile then could not recover). For each affected contact it sets `company_name` to the
name of its business membership ordered by `is_primary desc, created_at, id`, or NULL. It does not
touch `updated_at` and emits nothing. A household never changes the column.

### 5.4 The backfill: `public.reconcile_business_groups(p_account_id uuid default null) returns jsonb`

Service-role only. Set-based, scoped to one account or all. The last statement of 0069 calls it.

1. **Source:** contacts whose `btrim(company_name, WS)` is not empty. NULL, `''`, spaces, tabs or
   NBSP alone are skipped: no group, no membership, and the column is left as it is.
2. **Groups:** one `business` group per `(account_id, lower(btrim(company_name, WS)))`, named with
   the trimmed spelling of the OLDEST contact holding that key (`created_at, id`), `on conflict do
   nothing`. The same name in two accounts makes two groups.
3. **Memberships:** a contact with no business membership on that key gets one, primary when it has
   no other membership (always, the first time: the table is new). If the contact's shown business
   membership has a DIFFERENT key, or the column is blank while one exists (only an old build's
   direct write can cause either, §11), that membership is replaced or removed, the column being
   the truth for that one slot.
4. **Effect on existing rows:** the sync rewrites `company_name` to the group's spelling, so
   " acme roofing" becomes "Acme Roofing" when an older contact spelled it so. Nothing else changes.
   A stored name longer than 120 characters after trimming cannot become a group: the contact is
   skipped and its column left exactly as written, even when it already has a business membership.
   Returns `{groups_created, members_added, members_replaced, members_removed, skipped_too_long,
   respelled}`; a second run returns zeros except `skipped_too_long`, which counts the over-long
   names still there rather than work done, so it never reaches zero while one exists (the
   idempotence test). `respelled` counts only the final same-business spelling repair, not the
   spellings the sync rewrote while linking. Each contact is locked and re-read before it is
   reconciled, so a direct write in flight is waited for and folded in, never overwritten.

**Rollback.** Revert the app first (the old build reads `company_name`, still filled). Then drop
`client_group_members`, `client_groups`, the functions, the trigger function and
`app.my_client_group_ids`. The column keeps the canonical spellings. Lost: households, roles,
flags and billing addresses created since; the orchestrator exports them first if any client used
the card.

**Teardown.** `ACCOUNT_OWNED_TABLES` (`account-teardown.ts:19-28`) gains `"client_group_members",
"client_groups"` just before `"contacts"`, so the demo leftovers check (`demo-seed.test.ts:256-268`)
and the e2e sweep cover them; its comment notes the account cascade.

## 6. Every reader and writer of `company_name`, and its treatment

Found by `grep -rn "company_name\|companyName"` over `apps` and `packages`, then following each
function to its callers. The study said twelve; production code has **twenty places in seventeen
files** (tests and e2e fixtures are counted separately below).

| # | Place | Kind | Treatment |
|---|---|---|---|
| 1 | `packages/db/src/contacts.ts:9` `ContactInput.companyName` | writer type | Removed. Every caller below fails to compile until moved |
| 2 | `contacts.ts:142` `toRow` | writer (`createContact`, `updateContact`) | Line removed; neither function can write the column |
| 3 | `contacts/actions.ts:199` `updateContactFieldAction` via `field-input.ts:5,13` | writer (drawer and page inline edit) | `company_name` leaves `FIELD_TO_INPUT_KEY` (stays in `EDITABLE_FIELDS` for trimming). The field gets its own `BusinessField` (like `SourceField`) and `setContactBusinessAction`, which proves the contact through `dbForRequest()`, calls `set_contacts_business` through the service client, and returns a server-built Undo (the phone field's precedent, `inline-field.tsx:69-80`) |
| 4 | `contacts/[contactId]/actions.ts:122` `updateContactAction` | writer, **dead** | No input named `companyName` exists in any `.tsx`; the line is deleted |
| 5 | `lib/contacts/csv.ts:12,24-26` input keys | writer (import mapping) | `company_name` is routed to `row.company`, carried BESIDE the patch like `tags`; blank cells are still dropped first (`:129`) |
| 6 | `csv.ts:43-45` header synonyms | mapping | Unchanged: Company, Organization, Business still map to the `company_name` column key |
| 7 | `csv.ts:87-88` `IMPORT_FIELDS` | contract | Unchanged (pinned to the export by `csv.test.ts`) |
| 8 | `packages/db/src/contact-import.ts:154,159,165` `applyImportBatch` | writer (via `ContactInput`) | Gains a `groupWriter` client (the `flagDb` precedent, `contacts.ts:417`) and calls `set_contacts_business` ONCE per batch for rows with a business, after their contacts are written. Its `{created, updated, flagged}` result is unchanged; it adds `businessLinkFailed` (the batch's group write failed after its contacts committed) and `businessTooLong` (rows whose name was over 120 characters), and `import/actions.ts` carries both to the wizard's done screen, summed across batches ("N business names were too long to save (120 characters max)." / "Business names didn't save for some rows — import again to retry.", each with its `.es` twin; final review I-C) |
| 9 | `contacts/import/actions.ts:44` | caller | Passes `serviceDb()` as `groupWriter`; Owner and Staff only already (`requireNotTechnician`, `:25`) |
| 10 | `lib/forms/enrich.ts:104` (new lead) | writer | After `createContact`, a non-blank answer calls `set_contacts_business` (service client, actor `system`) |
| 11 | `enrich.ts:243` `fillBlanks` | reader and writer | The "held" check keeps reading `company_name` (now derived); a returning lead with no business gets one. A lead never replaces an existing business, as today |
| 12 | `packages/db/src/demo/seed.ts:438` | writer | `companyName` moves to a `set_contacts_business` call after the person is created |
| 13 | `contacts.ts:52` `COLS` | reader | Unchanged: the column is now the group's name, maintained by §5.3's trigger |
| 14 | `contacts.ts:640-647`, `:775-796` sort and cursor | reader | Unchanged: Business name sort still pages on the server, on the derived column. Not lowercased today; not changed here |
| 15 | `contacts/page.tsx:53-58,89` `cursorValue` | reader | Unchanged |
| 16 | `contacts/export/route.ts:11,64-66` | reader (CSV header, cursor) | Unchanged header `company_name`; the value is the group's name through the column, so export, re-import, export is identical |
| 17 | `contacts-table.tsx:32,44,293` | reader (list cell) | Unchanged |
| 18 | `contact-drawer.tsx:66` `FIELDS`, used by `contact-fields-panel.tsx:24,91` | reader and editor | Removed from `FIELDS`; both surfaces render `BusinessField` in its place |
| 19 | `packages/db/src/forms.ts:6`, `form-editor.tsx:26` | config | Unchanged kind `core.company_name` |
| 20 | `messages.ts:637` `contact.company`; `:1222` `forms.kind.core.company_name` | copy | "Business name" / "Nombre del negocio" (A5). Existing forms keep their stored labels |

`lib/cursor.ts:21` names it in a comment only. **Verified not readers:** contact search
(`contacts.ts:744-753`: name, email, phone), the dedupe keys (0033/0034), the display name
(`lib/format.ts:119-123`), the summary route, ⌘K search, Sofía and the voice tools, the concierge,
proposals and blueprints (configuration only). The grant `0053:138` and the guard's `:77` stay this
release (§11). Eighteen test and e2e files name the column (the `companyName` hits in e2e setup are
the tenant's name, not this); those on a changed path move with their code, and
`contacts-data.spec.ts:25`'s header is unchanged.

## 7. App

- `packages/db/src/client-groups.ts` (exported from `index.ts`, additively): `listContactGroups`
  (request client; memberships, groups and co-members' names, RLS alone trimming a Technician's, so
  no role branch), `searchGroups` (`sanitizeSearchTerm`, `name ilike`, 8 rows), wrappers over §5.3.
- `contacts/groups-actions.ts`: `requireAccountAccess`, proof through `dbForRequest()` (the contact;
  the membership; for rename and billing address the group plus `seesWholeAccount`), the service
  write, then `emit` as `user`: `client_group.created`, `.member_added`, `.member_updated`,
  `.member_removed`, `.renamed`. Each `serviceDb()` joins `in-account-service-reads.test.ts`'s
  allowlist as "write after a proven target". `GET …/contacts/[contactId]/groups` feeds the
  drawer's card (the `texts`/`email` route precedent), so it loads and fails on its own.

## 8. Screens

**The Groups card**, on the drawer (below the Texts and Email rows) and on the contact page (the
right column, above Deals, where the study's "what they have" goes). Tokens only, no new surface.

- **Loaded:** one row per group, main first: name, kind as a word ("Household", "Business
  customer"), the role as an inline field (placeholder "Role, like Madre or Dueño"), and two
  dot-and-word marks (rule 3): "Main group" and "Pays the bills". Owner and Staff also see the
  other members' names, each opening that contact's drawer. "Make main" and "Pays the bills"
  toggle at once with an Undo toast (rule 6); so does the Business name field.
- **Add:** "Add to a group" opens a search box (Esc closes) listing matches with their kind; the
  last row is "Create household “{name}”" and "Create business customer “{name}”". A business that
  already existed says "Added to {name}, which was already on your list."
- **Remove:** a ghost action; runs at once, "Removed from {name}." with Undo restoring the same row.
- **Owner and Staff** rename a group and edit its billing address inline. **Technicians** get every
  other action on their own customer (A6), and never see other members or a count of them (G8).
- **Empty** (rule 5): "Households and businesses this person belongs to show up here." with "Add
  to a group". **Loading:** two skeleton rows. **Error:** "Couldn't load groups." with Retry, inside
  the card only. A refusal shows "You can't change that group.", logged with `loggableError`.

**Copy** goes in `messages.ts` under `groups.*`, every key with its `.es` twin (the ratchet freezes
keys without one): Household / Familia; Business customer / Cliente comercial; Main group / Grupo
principal; Pays the bills / Paga las cuentas; Billing address / Dirección de cobro; Add to a group /
Agregar a un grupo; the empty line / "Las familias y negocios a los que pertenece esta persona
aparecen aquí."; "Ya hay un cliente comercial con ese nombre." (`groups.nameTaken` dropped `{name}`;
accepted in the final review). The drawer and the contact page read
`m["…"]` (`contact-drawer.tsx:213`, `[contactId]/page.tsx:166`), not `t()`, so the twins are written
but not shown there yet, the limit the Technician spec recorded for Contacts; moving them to `t()`
is item 3's. Twinning `contact.company` means regenerating the catalogue baseline in the same change.

## 9. Testing (each test can fail on wrong code; each gets a mutation probe in review)

- **Schema** (`client-groups-schema.test.ts`, `withRollback`): a crossed membership is refused
  (`23503`); a second membership of the same pair and a second main per contact are refused
  (`23505`); a blank or whitespace-only name, and a third kind, are refused; two businesses with one
  key are refused, two households are not; contact, group and account deletes cascade; exact
  `pg_policies` rows for both tables (the `server-only-writes-grants.test.ts:106-111` shape);
  `authenticated` insert refused `42501`; each function executable by `service_role` only.
  Probe: drop `lower()` from `name_key`, and the case-insensitive case fails by name.
- **RLS** (`client-groups-rls.test.ts`, its own file: `technician-scope.test.ts`'s seed builds one
  row per contact and cannot express a household shared by the Technician's customer and someone
  else's; plan deviation 1): a Technician sees their customer's group and membership, not a co-member assigned to someone else,
  not a group with none of their customers; Owner, Staff and agency see all; another account's token
  and a login with no membership see zero. Probe: drop either restrictive policy.
- **Sync and functions:** the column follows insert, main-then-age order, rename and removal; a
  household never changes it, and a household change (add, edit, remove, rename) never recomputes a
  directly written column, nor does a role or "Pays the bills" edit on a business membership, while a
  main swap between two businesses still does; replace keeps main, remove promotes the oldest, restore is exact; make
  main and remove re-read the membership after the contact lock (two-session tests).
- **Backfill:** a second run returns zeros except `skipped_too_long`; an over-long column is left
  alone even with a business membership; `"Acme Roofing"`, `" acme roofing "`, `"ACME
  ROOFING<tab>"` make one group named by the oldest; NULL, `''`, spaces and NBSP alone make nothing;
  two accounts make two; a direct write is relinked, a cleared one unlinked; `updated_at` untouched.
- **App:** an action on a contact or membership the request client cannot see never reaches the
  service client; Technician rename refused; `mapRows` carries the business beside the patch; one
  `set_contacts_business` per batch; export, import, export is byte-identical; `fillBlanks` never replaces.
- **e2e** (`groups.spec.ts`, per-run fixture account, never Test Client One; two seeded contacts,
  deleted in `afterAll` with the error checked): Owner creates a household, adds the second contact
  by search, sets a role, main and pays, removes and Undoes, edits Business name and sees it in the
  list. The `assign.spec.ts` Technician sees their customer's group, not the other member.

## 10. Effort

About 2–2.5 engineer-weeks of S-02's 5–6, mostly §5.3, §6 and the tests.

## 11. Rollout and deploy order

0069 on the CI project (`ci-project-setup.yml`), then production, then parity, all **before
merge** (e2e fails while bis-ci lacks it). Merge, deploy, verify (served-HTML marker: the Groups
card on a contact page). Then the orchestrator runs `select public.reconcile_business_groups();`
once on production and once on bis-ci, and files the returned counts in the ledger. Proposed
runbook line for `docs/runbooks/ci-supabase-project.md`, landed by bis-platform.

**Old app with 0069 (the hours between the production apply and the deploy):** safe. The old
build reads `company_name`, which the backfill filled. Its direct writes (inline edits, imports,
form leads) change the column and no group; the trigger fires only on group changes, which the
old build never makes, so nothing it writes is overwritten. Nor does the new app overwrite such a
write by a household change, nor by a role or "Pays the bills" edit: the sync recomputes the column
only when a BUSINESS membership of that contact is added, removed, made or unmade main, or moved,
or one of its business groups is renamed or changes kind (a membership removed by a group delete
recomputes too, since the deleted group's kind can no longer be read). The post-deploy reconcile folds those writes in
(§5.4 step 3), locking each contact so a write in flight is waited for, not lost; the one change
it makes to a column that still names the same business is the spelling repair, and an over-long
column is never touched. Run it only AFTER the old deployment has stopped serving: a write an old
build makes after the reconcile has passed that contact waits for the next one. "Stopped serving"
includes Vercel Skew Protection: a tab opened before the deploy keeps posting to the OLD deployment
until it reloads or the skew window's maximum age runs out (assumption, not verified against this
project's setting: old tabs reach the old deployment for that maximum age; see
`docs/runbooks/production-isolation.md`, "Old tabs keep the old build"). So the reconcile waits
until that maximum age has passed after the deploy, not merely until the deploy is READY. Its teardown still
works (account cascade, §5.1).

**New app before 0069:** data-safe (no role or policy is loosened, nothing is destroyed) but
broken: the card errors in its own boundary, Business name edits say "Save failed", a form lead is
created with its business answer left on the submission and `setSubmissionProcessingError`
stamped, and an import writes its contacts then reports failure (a re-run is harmless). The order
is fixed anyway.

**The follow-up release (G9):** revoke `UPDATE (company_name)` from `authenticated` and drop it from
the guard (`:77`); a `before insert or update` trigger on `contacts` resets a direct write to the
derived value, so only the sync sets it; drop the reconcile function. The column is NOT dropped.

## 12. Open risks

- An app path missed in §6 that writes `company_name` directly would disagree with the group until
  that contact's next group change. Mitigated by the compile break, the reconcile run and review
  against §6; closed by the follow-up's revoke.
- `searchGroups` is an unindexed `ilike` per account; fine at today's sizes (production held 53
  contacts on 2026-09-24, 0050:58), revisit with a trigram index when a client passes ~5,000 groups.
- Assumption, not verified: the generated `name_key` with `chr()` applies on hosted Postgres as on
  the PG18 replica; check on the replica and the CI project before production.

## 13. Owner rulings (2026-10-11, after reading this spec)

1. **Keep `company_name` after the dual-write release as a read-only copy the database maintains?**
   DECIDED yes (danlo; G9). PostgREST cannot order contacts by a to-many embed and cursor paging
   needs one value per row, so without the column "sort by business" would be a lie past the first
   page (DESIGN.md, Paged lists). The follow-up revokes client writes so only the sync sets it.
2. **One business customer per name per client?** DECIDED yes, case- and space-insensitive;
   households not unique (danlo; G10, A3). Without it an import or a form cannot know which Acme
   to link, and races make duplicates; two real businesses can be told apart by name.
3. **A Technician who types a business that already exists: link it?** DECIDED yes (orchestrator;
   G11), following the Technician spec's ruling 13.3: refusing would reveal a customer they cannot
   see. They then see that group's name and billing address, which are not a person's private data.
