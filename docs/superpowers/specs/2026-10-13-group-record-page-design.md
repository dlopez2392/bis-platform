# The household and business record page — design (first release, item 3, S-03 part 2)

Date: 2026-10-13. Owner decisions D1–D13 (danlo, 2026-10-13, by choice tiles; §2). Model and parent:
`docs/superpowers/specs/2026-10-12-record-page-design.md` (part 1: the kit, the registry, the header, facts, Next
up, the timeline; cited below as "part 1 §n"). Data: `docs/superpowers/specs/2026-10-11-client-groups-design.md`
(S-02 part 1, migration 0069; cited as "groups spec"), the places spec (0071), F-085 part 1 (0068). Plan:
`docs/crm-features.md` §4.3 item 3 (`:1264-1267`); F-002 stays later (`:1474`: "the record page carries groups
first"). Design contract: DESIGN.md rules 3, 5, 6, 7, 8, 11, "Record page, documents and provenance (v2)", the
module contract, the definition of done.

**Delivery (D12, amended by owner rulings R1–R3 of 2026-10-13, §16): two PRs.** **2a** = the route, the header,
People (the Members card), Details, Properties, Deals, migration 0075 (the call-first flag, R1), part 1's contact
header line moved to S-02's kind words (R3) and the `contact.noName` Spanish twin. **2a's page is reachable by URL
only** (R2). **2b** = the summary facts, Next up, the merged timeline, AND the two entry links (the contact header's
group link and the Groups card's "Open", R2), so no one reaches the page from the product until it is whole. A
section or row marked **[2b]** is 2b's; everything else is 2a's. 2b changes no database.

**What is verified and what is not.** Every function name, line and policy below was read off the worktree at
`d729b373`. Anything not read is labelled **Assumption**.

## 1. Goal

A household or a business customer gets one page, on part 1's kit, that answers at 7 AM: who is in it and who do
I call, what is happening with any of them, and what they share (the house, the job sites, the open deals). It is
a **record** reached from its members' pages, not a new top-level surface: no nav item, no Groups list (F-002).
Every timeline row names the member it is about as well as who made it, so "Ana García · Sofía · AI · answered a
call" is never left to be guessed. Every card loads, empties and fails on its own.

## 2. Decisions

Owner (danlo, 2026-10-13), given in the brief:

| # | Question | Decision |
|---|---|---|
| D1 | Route and kit | `/dashboard/accounts/[accountId]/groups/[groupId]` on part 1's kit (`RecordLayout`, `RecordHeader`, `RecordCard`) with its own card list in `apps/web/src/lib/record/record-cards.ts`. Not a top-level nav surface; no Groups list (F-002 is later) |
| D2 | Entry points | The household/business name in the contact page header becomes a link (part 1 C7 promised it, `2026-10-12-record-page-design.md:72`); the contact page's Groups card gets an "Open" link. **Both ship with 2b (R2)** |
| D3 | Timeline | EVERY member's activity merged (part 1's `listContactTimelinePage` generalised to a set of contact ids), each row naming its member beside the author mark; 30 a page, the same cursor, the same failed and empty states |
| D4 | Header | Group name and the kind word. Call (`tel:`, the ONE primary), Text, Email go to the PRIMARY member, the label naming them ("Call Ana"); Text and Email open that member's record at its composer. Directions: the group's first addressed property, else the primary's. No primary: all hidden and People shows "Choose who we call first" with Make primary. **Ruled R1 (§16): a new column, `is_primary_contact`; the column the brief named, `is_primary`, does not mean this** |
| D5 | Composer | None on the group page |
| D6 | Cards | Middle: summary facts (members, booked N times on D-035's definition, last talked), Next up (part 1 C9's rules), the merged timeline. Right: Properties and equipment (group-owned places), open Deals across members. Left: People (name, role, Primary and Billing badges, a link each; Make primary, edit role, remove with Undo) and Details (name, kind, billing address inline) |
| D7 | Scale | Timeline, facts and Next up read at most 50 members (primary first, then most recently active, defined in C5); beyond that one plain line, "Showing activity for 50 of 73 people. Open a person to see theirs." People pages its own list 30 at a time (cursor) |
| D8 | Technician | Reads go through RLS (`dbForRequest`). Say exactly what a Technician sees (§4); counts say "you can see" only when the reader is a Technician and something may be hidden, without leaking the hidden count (C4). An RLS gap is a finding with a migration numbered after 0074 (none found, §4.2) |
| D9 | States | Every card loads, empties and fails on its own; the empty-group copy (§9); the timeline's empty state points to opening a member; a missing or other-account group is a 404 before any read |
| D10 | Language | English and Spanish from day one (usted, trades Spanish) |
| D11 | DESIGN.md | One sentence in "Record page" (§15) |
| D12 | Delivery | 2a and 2b; no migration expected. **Amended by R1 (0075 lands with 2a) and R2 (the entry links move to 2b)**; see the Delivery note |
| D13 | Testing | Merge across members with the member named on every row; the 50 cap and its notice; primary-or-hidden actions; Technician scope; 404 before any read; e2e on the per-run fixture account, never Test Client One |

Choices this spec makes:

| # | Choice | PR |
|---|---|---|
| C1 | **"Primary" is a new per-group flag, `client_group_members.is_primary_contact`, not `is_primary`.** `is_primary` is the CONTACT's main group: "at most one per contact" (`client_group_members_one_primary unique (contact_id) where is_primary`, `0069_client_groups.sql:79`), so in a household of three every member can hold it at once, and `set_primary_group_membership` (`0069:349-365`, wrapped by `setPrimaryMembership`, `client-groups.ts:226-232`) changes which group is that PERSON's main one, and re-sorts their header line (`[contactId]/page.tsx:161`) and their Business name copy (`app.company_name_for`, `0069:105-112`). It cannot say who the household's phone belongs to. Migration 0075 (§5) adds the flag, at most one per group. **Ruled R1, 2026-10-13** | 2a |
| C2 | **Choosing the primary contact is Owner, Staff and the agency only** (`seesWholeAccount`, `lib/auth-role.ts:15-17`), groups spec A6's reason: it decides who the whole group's Call reaches, and a group can hold customers a Technician does not serve. A Technician never sees the "Choose who we call first" prompt (they could not act on it, and its absence tells them nothing, C4) | 2a |
| C3 | **People reuses the Groups card's member actions as they are**: role (`setRoleAction`), Pays the bills (`setBillingAction`), remove and Undo (`removeMembershipAction`, `restoreMembershipAction`), all keyed by membership id and proven on the request client (`groups-actions.ts:123-227`). **Remove is offered to Owner, Staff and the agency only on this page**: a Technician removing their last visible member here would make the group invisible to them (`app.my_client_group_ids`, `0069:94-98`) and the refreshed page a 404 under their own Undo toast. They remove their customer from a group on that customer's page, as today (groups spec §4) | 2a |
| C4 | **"You can see" is shown to EVERY narrow reader, never only when something is hidden.** A narrow reader is `!seesWholeAccount(access)` (a Technician, or a client whose role could not be settled, which fails closed, `lib/auth-role.ts:3-9`). Whether a row is hidden cannot be known on the request client, and asking the service client would tell the page the hidden count; showing the qualifier unconditionally leaks nothing, because it reads the same with zero or twenty hidden. It qualifies the people fact and the cap line (§8.6, §9); every other count reads "these people", which is true for both readers | 2a, 2b |
| C5 | **Which 50, precisely** [2b]. The primary contact first (when visible), then the rest by `conversations.last_message_at desc nulls last`, then the membership's `created_at desc`, then `contact_id desc`. `last_message_at` is the one per-customer activity time that exists: one conversation per customer (`conversations_account_contact_unique`, `0005_messaging.sql:22-25`), touched by every `createMessage` (`messaging.ts:161-171`), which writes the inbox's copy of a text, an email, a form submission (`lib/forms/enrich.ts:164`), a booking change (`b/[publicId]/actions.ts:400`) and a call that left a summary (`lib/voice/finish-call.ts:415-424`). It misses a call with no inbox copy, a note, a To-do and a deal; that only decides who is cut past 50, and the cut is announced (D7). Ranked among at most `GROUP_ACTIVITY_SCAN = 500` visible memberships read newest-joined first (§6) | 2b |
| C6 | **One timeline function for one or many people** [2b]: `listTimelinePage(db, accountId, contactIds: readonly string[], before?, opts)` in `packages/db/src/record.ts`; `listContactTimelinePage(db, accountId, contactId, …)` becomes `listTimelinePage(db, accountId, [contactId], …)`, so the contact page and the drawer's `/summary` route are unchanged. Each source function takes `contactId: string \| readonly string[]` (`.eq` for one, `.in` for many) and returns `contact_id` on its rows; each `TimelineEntry` gains `contactId` | 2b |
| C7 | **The group timeline is read-only** [2b]: no composer (D5), no add-To-do row, no Done, no task picker, no hold hint (the hint stands in for Done, `activity-timeline.tsx:44-45`; with no Done there is nothing to stand in for, so the ledger read part 1 makes for it is not made here). A call row keeps "Open call"; every row's member name links to that member's record | 2b |
| C8 | **The member comes first on the row**: `{member} · {mark} · {verb} · {status} · {when}`. The mark is never dropped, even when it is the member themself ("Ana García · Customer · texted"): DESIGN.md Provenance makes a row without a mark a defect, and the member's name answers "about whom", not "who did it" | 2b |
| C9 | **"Last talked" names the member** [2b]: "Last talked 4 days ago with Ana (text)". Across a household the useful fact is who | 2b |
| C10 | **People pages by the order they joined**, `(client_group_members.created_at asc, id asc)`, 30 a page, its own `?people=` cursor (`lib/cursor.ts`'s `RowCursor`/`encodeCursor`, `:32-47`), one pager at the card's foot. The primary contact is pinned above the rows on the first page and left out of the paged rows, so it is never shown twice. The timeline keeps `?before=`; the two lists never share a pager | 2a |
| C11 | **The kind word is G4's**: "Household"/"Familia", "Business customer"/"Cliente comercial" (`groups.kind.*`, `lib/messages.ts:3546-3549`; groups spec G4, which also forbids "Company"). **Ruled R3, 2026-10-13: these words everywhere**, so part 1's contact header line, which says "Hogar" and "Business" today (`record.group.household`/`.business`, `messages.ts:3762-3765`), changes to match in 2a (§9.1) | 2a |
| C12 | **Properties shows the GROUP's own places only**, through a group subject on today's `PlacesCard`. The card is keyed by a contact today: its route is per contact (`api/accounts/[accountId]/contacts/[contactId]/places/route.ts`), its read is `listContactPlaces` (`places.ts:113-161`), and every action proves a contact subject (`places-actions.ts:74-105`). It gains `subject: { kind: 'contact' \| 'group'; id }`, a group route and `listGroupPlaces`; on the group page there is no "Move to" (`canMovePlace` false), which stays on member pages | 2a |
| C13 | **Deals: open deals of the same ≤50 people** (C5's set; in 2a, before C5 exists, the first 50 by C10's order), newest first, at most 30 rows, an exact count for "Showing 30 of 41 open deals." Each row names its person | 2a |
| C14 | **Text uses part 1's gate for the primary contact**: `canTextFrom` (`lib/record/header-actions.ts:22-24`) with the account's `softSmsGate` and the primary's `composerStateLine(smsRecipientState(ledger, …))`, the ledger client built only after `getContact(db, accountId, primaryId)` on the request client proved them (`[contactId]/page.tsx:85-89`'s rule). Email: the primary has an email. So Text and Email appear exactly when the composer they land on would open | 2a |
| C15 | **The two entry points show for every reader who sees the group**, a Technician included: the group a customer of theirs is in is visible to them (§4) | 2b (R2) |
| C16 | **404 before any read**: `isUuid(groupId)` (`lib/assign/action-guards.ts:11`), then `readGroup(db, accountId, groupId)` (`client-groups.ts:150-156`) on the request client; null is `notFound()`. A malformed id is a 404, not a 500 from the uuid cast (the groups route's rule, `api/.../groups/route.ts:19-20`) | 2a |
| C17 | **Loading is the route's**, as part 1 §9: `groups/[groupId]/loading.tsx` draws `RecordLayout` with a skeleton header and every card of the group list in `state="loading"`, in phone order | 2a |

## 3. Non-goals

A Groups list or any nav entry (D1, F-002). A composer on the group page (D5). Adding a person to a group from
the group page (D9's empty copy sends you to the person's page; the search-and-add lives on the Groups card).
Changing a group's kind (no function does it, and a kind change rewrites Business names through the sync,
`0069:202-229`). Deleting or merging groups (groups spec §3). Notes, To-dos or deals OF a group (groups spec G7).
Moving a place between owners from the group page (C12). A household's own custom fields. Part 3 (the drawer on
the kit). The documents vault and AI summary prose (part 1 D1). Ranking "active" by anything that needs a new
column or a SQL function (C5).

## 4. Roles

### 4.1 What each reader sees and does

| What | Owner | Staff | Technician | Agency |
|---|---|---|---|---|
| Open the group page | any group | any group | only a group with at least one customer assigned to them; otherwise 404 (§4.2) | any |
| The group's name, kind, billing address | yes | yes | yes, read-only (groups spec ruling 13.3: not a person's private data; A6: no rename) | yes |
| People rows | every member | every member | **only their own customers** | every member |
| Edit role, Pays the bills | yes | yes | on their own customers' rows | yes |
| Remove from the group (Undo) | yes | yes | **no, on this page** (C3) | yes |
| Make primary contact / the prompt | yes | yes | **no** (C2) | yes |
| Rename, billing address | yes | yes | no (A6, `provenGroupForManager`, `groups-actions.ts:229-232`) | yes |
| Properties of the group | all | all | all of the GROUP's places (`places_technician_scope`, `0071:120-126`) | all |
| Facts, Next up, timeline, Deals | every member's | every member's | their own customers' only | every member's |
| Header actions | to the primary contact | same | only when the primary contact is their customer | same |

### 4.2 The Technician, verified against 0068, 0069, 0070 and 0071

- **The group row.** `client_groups_technician_scope` (`0069:101-102`, restrictive, `for select`) passes when
  `sees_all_customers` or `id in (select app.my_client_group_ids())`; that function returns the groups of the
  memberships whose `contact_id in (select app.my_contact_ids())` (`0069:94-98`), and `my_contact_ids` is the
  account's contacts with `assigned_to = current_user_id()` while the caller is a Technician here
  (`0068:83-89`). So **a group is visible exactly when at least one of its members is assigned to them**, with
  all its columns (`name`, `kind`, `billing_address`, `custom`, `0069:43-57`). Otherwise `readGroup` returns null
  and the page is a 404, identical to a group that does not exist: existence does not leak.
- **Member rows.** `client_group_members_technician_scope` (`0069:99-100`) passes only `contact_id in (select
  app.my_contact_ids())`: **they see their own customers' memberships and no other row** — not the others' names,
  roles, flags or join dates. A head count of the group's memberships on their client counts only those
  (`client-groups-rls.test.ts:49-57` pins "the shared household and THEIR membership only, never the
  co-member").
- **Contacts embedded in a member row** are fenced again by `contacts_technician_scope` (`0068:103-107`).
- **Everything the timeline, facts, Next up and Deals read**: `notes`, `opportunities`, `conversations`, `calls`,
  `bookings`, `form_submissions` by `contact_id` (`0068:109-121`), `messages` through the conversation
  (`0068:124-126`), `tasks` by contact (`0068:134-138`). Each source also receives only the ids the member read
  returned; RLS would drop another id's rows anyway.
- **Places.** `places_technician_scope` (`0071:120-126`) passes a place owned by one of their contacts or by
  `client_group_id in (select app.my_client_group_ids())`: **every place of a visible group**, by the places
  spec's design (a household's house shows on every member's record). Equipment follows (`0071:127-129`).
- **`contact_relationships`** (0070) are not read by this page; their fences (`0070:101-123`) are unaffected.
- **What their counts reveal:** the people count is the members they can see; nothing on the page is computed
  on the service client; the qualifier is unconditional (C4). **No hidden count leaks.**

**RLS gap check: none found.** Every table this page reads has a restrictive Technician policy keyed to their own
customers (or, for places and the group row, to a group one of their customers is in, by design). `app.*`
helpers are not reachable as RPCs (`supabase/config.toml:13` exposes `public` and `graphql_public` only;
**Assumption** that the hosted projects match the local config). No migration is proposed for RLS.

## 5. Data: migration 0075 (ruled 2026-10-13, R1; lands with 2a)

The only database change in either PR. By bis-db-schema. Next after `0074_record_provenance_not_null.sql`. ASCII
only, no backslash; `set local lock_timeout = '5s'`.

```
alter table public.client_group_members add column is_primary_contact boolean not null default false;
create unique index client_group_members_one_primary_contact
  on public.client_group_members (client_group_id) where is_primary_contact;
```

"At most one per group" is the partial unique index. "Exactly one" is NOT kept: a group may have none (no
backfill, a removed holder), and then the People card asks (§8.2).

**Who may write it: server code only, through 0069's member-write path (verified).** 0069 declares its two tables
"written by server code only (0053's pattern)" (`0069_client_groups.sql:4-6`). 0053 names two server-only shapes:
"the service role, or a SECURITY DEFINER function that decides for itself what it writes"
(`0053_server_only_writes.sql:3-6`). 0069's member writes take the FIRST: plain plpgsql functions, `set
search_path = ''`, not definer, executable by `service_role` only, each checking every row it touches belongs to
`p_account_id` (`set_primary_group_membership`, `0069:349-365`; the revoke-then-grant loop, `0069:486-500`, there because default privileges hand EXECUTE to anon and authenticated by name, 0043), called by a server
action that first proved the target on the request client (`makePrimaryAction`, `groups-actions.ts:151-164`).
0075 follows that path, not a client-callable definer function:

- **Grants: unchanged and sufficient.** `authenticated` already holds SELECT only on `client_group_members`
  (`revoke insert, update, delete, truncate, references, trigger, maintain … from authenticated`, `0069:85-87`;
  the table-level revoke covers a column added later), so the client role can read the flag and never write it.
  `schema-grants-guard.test.ts`'s `EXPECTED_WRITES` names no column of this table and does not move.
- **`public.set_group_primary_contact(p_account_id uuid, p_group_id uuid, p_member_id uuid) returns jsonb`**:
  plpgsql, `set search_path = ''`, not definer; `revoke all … from public, anon, authenticated, service_role;
  grant execute … to service_role` (0069's loop), and the same pair re-stated for the replaced `app.restore_member`. Locks the group row `for no key update` (two managers choosing at
  once queue rather than race the partial index; deliberately not `for update`, which would also queue every
  member insert behind a choice through the group FK's `for key share`; corrected 2026-10-13 (final review),
  as plan departure 2 and 0075 already do), checks the group is in `p_account_id`, and, when `p_member_id`
  is not null, that the membership is in that group and that account (`not_found` otherwise); clears the group's
  current holder and sets the new one in the same call; `p_member_id` null clears. Returns `{status, previous}`,
  `previous` the member id that held it before, or null.
- **No policy change.** RLS on `client_group_members` is row-level, so the flag is exactly as visible as the row
  it sits on (§4.2).

**What happens, case by case:**

| Event | Result |
|---|---|
| A group is created, or the migration runs | No primary contact (no backfill, ruled R1): People asks "Choose who we call first." (Owner, Staff, agency); the header shows no Call, Text or Email |
| Owner/Staff/agency press "Make primary contact" on a row | `setGroupPrimaryContactAction` → the function sets this member and clears the previous holder; toast "{name} is now the primary contact." with **Undo** |
| **Undo of "Make primary contact"** | Calls the same action with the returned `previous` (null when there was none, which clears). If `previous` names a membership that has since gone, the function answers `not_found`, the current choice stays, and the toast says "That didn't save. Try again." (`groups.failed`) |
| **The holder is removed from the group** (People's Remove, or the Groups card on their own page) | The flag goes with the row (it is a column of the deleted membership): the group has **none**; no one is promoted, because silently calling someone else would be worse than asking. Header actions hide; the prompt returns |
| Undo of that removal | `remove_group_membership` already returns `to_jsonb(v_row)` (`0069:367-380`), so the snapshot carries the flag. 0075 replaces `app.restore_member` (`0069:169-191`) to re-set it when no other member holds it now, else to restore the membership without it. A narrow reader's snapshot is a claim from the browser: the flag is restored only when the removal event's payload records `wasPrimaryContact` (§10) |
| **The holder's contact is deleted** | Their memberships cascade (`client_group_members_contact_fkey … on delete cascade`, `0069:72-73`), the flag with them: the group has **none**, as above |
| The group is deleted (no UI does this, §3) or the account is | Cascades (`0069:61`, `:71`); nothing is left to hold |
| The holder's contact is reassigned away from a Technician | The flag is untouched; that Technician simply stops seeing the row that carries it (below) |

**What a Technician sees of it.** `client_group_members_technician_scope` (`0069:99-100`) shows them only their own
customers' membership rows, so they read `is_primary_contact` on those rows and nowhere else. When the holder is
their customer: the "Primary contact" mark on that row, and the header's Call, Text and Email to them. When the
holder is someone else's customer, or there is none: no mark, no header actions and no prompt (C2), and the page
reads identically in both cases, so it does not reveal that a holder exists.

- **The sync trigger does not fire** on the new column: it fires on `update of is_primary, client_group_id,
  contact_id` only (`0069:223-225`), so choosing a primary contact never touches anyone's Business name.
- **Rollback:** revert the app first; then `drop function public.set_group_primary_contact(uuid, uuid, uuid)`, put
  0069's `app.restore_member` back, `drop index client_group_members_one_primary_contact`, `alter table … drop
  column is_primary_contact`. Lost: the choices made since.
- **Rollout:** with 2a, before it merges: bis-ci (`ci-project-setup.yml`), then production, then the parity check
  (§12).
- **Its tests** (§11.1): `group-primary-contact-schema.test.ts` (the partial unique index, the function, the
  restore, the sync not firing), the grants cases in the same file, and the RLS cases in `client-groups-rls.test.ts`.

**Indexes for 2b's reads: none needed** (checked for `account_id = $1 and contact_id in (… ≤50 …)`):
`notes_contact (contact_id, created_at desc)` (`0003_crm_core.sql:104`); `opps_contact (contact_id)` (`0003:93`);
`form_submissions_contact (account_id, contact_id, created_at desc)` (`0006_forms.sql:70-71`);
`conversations_account_contact_unique (account_id, contact_id)` (`0005:24-25`) then `messages_thread (account_id,
conversation_id, created_at)` (`0005:47`); `bookings_account_contact`, `tasks_account_contact`,
`calls_account_contact` (`0073_record_provenance.sql:135-137`). A group's members: the unique key
`client_group_members_group_contact_key (client_group_id, contact_id)` (`0069:74`) leads on the group. A group's
places: `places_by_group` (`0071:90`). **Assumption:** with an IN list of 50 ids the planner reads every row of
those 50 customers that passes the cursor and top-N sorts, rather than walking one index in order; bounded by 50
customers' history, which is small at today's sizes (production held 53 contacts on 2026-09-24,
`0050_same_account_fks.sql:58-59`; part 1 §7 cites the same figure).

## 6. Queries

All on the request client (`dbForRequest`), so RLS decides; no role branch in any read (groups spec §7's rule).
Every head count fails closed on `count === null` (the `contactFacts` rule, `record.ts:20-27`).

**2a** (`packages/db/src/client-groups.ts` unless named):

- **`listGroupMembers(db, accountId, groupId, opts: { after?: RowCursor; limit?: number } = {})`** — new; none
  exists (grep for `listGroupMembers` over `apps` and `packages`: no hit). One read of `client_group_members`
  where `client_group_id = groupId`, embedding `contacts(first_name, last_name, phone, email)` (the composite FK
  embed `listContactGroups` already uses, `client-groups.ts:108-109`), ordered `(created_at asc, id asc)`, past
  `after`, `limit + 1` (default 30). On the first page (no `after`) a second one-row read returns the
  `is_primary_contact` holder, which the paged read then excludes (`.eq("is_primary_contact", false)`). Returns
  `{ primary: GroupMember | null; members: GroupMember[]; next: RowCursor | null }`, `GroupMember = { memberId;
  contactId; firstName; lastName; phone; email; role; isBilling; isPrimaryContact; joinedAt }`. THROWS.
- **`countGroupMembers(db, accountId, groupId)`** — exact head count of visible memberships; THROWS on error or a
  null count.
- **`setGroupPrimaryContact(db, accountId, groupId, memberId | null, actorId)`** — wraps §5's function, emits
  `client_group.member_updated` with `fields: ["is_primary_contact"]` (the event `setPrimaryMembership` emits,
  `client-groups.ts:230`), returns `{status, previous}`. `GroupMemberSnapshot` (`:18-21`) gains
  `is_primary_contact: boolean`.
- **`listGroupPlaces(db, accountId, groupId)`** in `places.ts` — the group's own places (`client_group_id =
  groupId`), active first, capped at `MAX_PLACES_READ` (`places.ts:44`) with an exact count, plus their equipment
  at `MAX_EQUIPMENT_READ` (`:45`): `listContactPlaces`'s second and third reads (`:127-148`) with the owner filter
  swapped.
- **Deals:** `listOpenDealsFor(db, accountId, contactIds, limit = 30)` in `opportunities.ts` — `status = 'open'`,
  `contact_id in (…)`, newest first, `limit`, exact count, with `contact_id` on each row.
- **Header:** `readGroup` (the authorisation, C16), `listGroupMembers` first page (the primary contact and their
  phone and email), `listGroupPlaces` (soft: a failure drops Directions, never the header), and for Text
  `getContact(primary)` then the ledger reads of C14 (soft, failing closed to Text hidden, as part 1 §7).

**2b** (`packages/db/src/record.ts` unless named):

- **`groupActivityMembers(db, accountId, groupId, cap = 50)`** — C5's set. One read of at most
  `GROUP_ACTIVITY_SCAN = 500` memberships ordered `(created_at desc, id desc)` embedding
  `contacts(first_name, last_name, conversations(last_message_at))` (`conversations.contact_id` has one foreign
  key to `contacts`, `0005:14`; 0050 adds none to `conversations`, so the embed has one path), sorted in code by
  C5's key, cut to `cap`, plus `countGroupMembers` for the true total. Returns `{ people: { contactId; name }[];
  total: number }`. PostgREST cannot order a parent by a to-many embed (groups spec ruling 13.1), hence the sort in
  code and the scan bound; past 500 visible members only the 500 newest-joined are ranked, and the cap line still
  states the true total.
- **Facts, `groupFacts(db, accountId, contactIds, opts)`**, `Fact<T>` as part 1: **people** = `total` above;
  **booked** = `countBookingsMadeFor(db, accountId, contactIds)` in `booking.ts`, the set form of
  `countContactBookingsMade` (`booking.ts:945-960`: `rescheduled_from_id is null`, D-035, part 1 C8 and D14);
  **last talked** = the newest `email`/`sms` message not `failed`/`bounced` across the set's conversations (part
  1's `newestConversationMessage`, `record.ts:48-60`, over `conversations.contact_id in (…)` then
  `messages.conversation_id in (…)`) against the newest non-spam call (`listContactCalls`'s `excludeSpam`,
  `voice.ts:953-964`, over the set), returning `{ at, channel, contactId }`.
- **Next up, `groupNextUp(db, accountId, contactIds, nowIso)`**: `contactNextUp` (`record.ts:109-126`) over the
  set — bookings booked and ahead (`listContactUpcomingBookings`'s set form, `booking.ts:969-980`, returning
  `contact_id`), dated open To-dos limit 3, the head count of undated open To-dos — each row carrying
  `contactId`.
- **Timeline, `listTimelinePage`** (C6): the seven sources of `listContactTimelinePage` (`record.ts:180-217`) with
  the set: `listNotes` (`activities.ts:20-27`), `listContactTasks` (`:46-65`), `listContactOpportunities`
  (`opportunities.ts:156-168`), `listContactSubmissions` (`forms.ts:519-530`), `listContactMessages`
  (`messaging.ts:742-763`; conversations `in`, then messages `in` the conversation ids, `contact_id` mapped back
  from the conversation), `listContactBookings` (`booking.ts:996-1017`), `listContactCalls` (`voice.ts:953-964`).
  Each reads `limit + 1` (31) past the cursor with `withTimelinePage` (`timeline-cursor.ts:62-66`); the merge,
  `compareTimelineEntries` (`record.ts:161-168`), `older` and `failed` are unchanged. Names for person marks:
  `listPeopleNames` (`record.ts:225-236`), unchanged.

## 7. The kit and the registry

**Registry** (`lib/record/record-cards.ts`, bis-crm's per part 1 §8). Today it holds one list, `RECORD_CARDS`,
typed by the `RecordCardId` union, and `cardsInPhoneOrder()` and `columnRuns()` read it directly
(`record-cards.ts:4-39`). It becomes generic: `RecordCardDef<Id extends string>`, `cardsInPhoneOrder(cards)`,
`columnRuns(cards)`; the contact page passes `RECORD_CARDS`, unchanged in content. New `GROUP_RECORD_CARDS`,
typed by `GroupRecordCardId`, so the group page's `slots` is `Record<GroupRecordCardId, Slot>` and a card with
no body is a compile error (part 1 §8's rule):

| id | Column | Desk | Phone | Closed on phone | Title | Skeleton | PR |
|---|---|---|---|---|---|---|---|
| `summary` | happening | 1 | 1 | no | `record.card.summary` | 1 | 2b |
| `next-up` | happening | 2 | 2 | no | `record.card.nextUp` | 3 | 2b |
| `timeline` | happening | 3 | 3 | no | `record.card.activity` | 5 | 2b |
| `properties` | have | 1 | 4 | yes | `places.title` | 2 | 2a |
| `deals` | have | 2 | 5 | yes | `record.card.deals` | 2 | 2a |
| `people` | who | 1 | 6 | no | `groupPage.card.people` | 3 | 2a |
| `details` | who | 2 | 7 | no | `groupPage.card.details` | 3 | 2a |

The phone order is DESIGN.md's (header with Call first, summary and what is next, the timeline, what they have
closed, then who they are; `DESIGN.md`, Record page). **In 2a the happening column is empty**, which is why 2a's
page is URL-only and the entry links wait for 2b (R2).

**Kit changes, bis-frontend's** (`components/record/*`, ruled part 1 §15):

- **`RecordHeader`** [2b, R2]: `subtitle` is `string | null` today (`record-header.tsx:14-16`, rendered as a `<p>`,
  `:25`). It gains `subtitleHref?: string`; with it the group words are a `Link` (UI 400, underline on hover,
  visible focus ring), else today's `<p>`. Used by the contact page (D2) only; the group page's subtitle is the
  kind word, plain.
- **`TimelineItem`** [2b]: a `subject?: { label: string; href: string }` drawn before the mark as a link
  (`data-timeline-subject`), then `Sep` (`timeline-item.tsx:26`); without it, today's row exactly.
- `/styleguide`: `RecordHeader` with a linked subtitle; `TimelineItem` with a subject.

## 8. Screens

No hero (rule 11). Tokens only; both themes; the blur fallback; nothing animates on scroll. Page root `lang` from
`requestLocale({ account, isOperator, userLanguage })` (`lib/i18n/request-locale.ts:35`; the page joins
`request-locale-callers.test.ts`'s scan as part 1 did). All new copy through `tr` (`lib/record/copy.ts`).

### 8.1 Header (2a)

`← Contacts` (`record.back`) above. The group name as the `<h1>` (Display 600, 22px; truncates with `title`).
Under it, muted, the kind word (C11). Then the actions, in this order on every width:

| Action | Shown when | Label | Target |
|---|---|---|---|
| Call (primary) | a primary contact is visible and `telHref(phone)` (`header-actions.ts:10-16`) resolves | "Call {first name}" (the display name when there is no first name) | `tel:` |
| Text | C14's gate passes for the primary contact | "Text {first name}" | `/dashboard/accounts/{a}/contacts/{primary}#compose-sms` |
| Email | the primary contact has an email | "Email {first name}" | `…/contacts/{primary}#compose-email` |
| Directions | the group's first active place with a `mapUrl` (`lib/contacts/place-view.ts:31`), else the primary contact's own first (D4, part 1 D13's order) | `record.action.directions` | the map, new tab |

No primary contact visible: Call, Text and Email are hidden (D4; "an action with nothing behind it is hidden",
part 1 D3); Directions still shows from the group's places. Each action at least 44px tall; they wrap, never clip.
A cold load of `#compose-sms` opens the member's text tab (part 1 §12.1's e2e pins it).

### 8.2 People (`people`, 2a)

**Loaded:** the primary contact first (pinned, C10), then the members in joined order. Each row: the name as a link
to `/dashboard/accounts/{a}/contacts/{contactId}` (the whole name, not the row: the row holds inline fields, so it
is not a row-click table, rule 4 does not apply); the role as an inline field (`InlineField`, placeholder
`groups.rolePlaceholder`, Undo toast, rule 6); a dot-and-word "Primary contact" (rule 3) on the primary; "Pays the
bills" as today's toggle (`groups-card.tsx:300-307`'s pattern); for Owner, Staff and the agency, "Make primary
contact" (ghost) on every other row and "Remove from this group" (ghost, Undo toast naming the person). A
Technician's rows show role and Pays the bills only (C2, C3). **The prompt:** with members but no primary contact,
for Owner, Staff and the agency only, one line above the rows: "Choose who we call first." — each row's "Make
primary contact" is the action. **Pager:** "More people" when there is a 31st row, "Back to the start" when
`?people=` is set; one pager at the card's foot. **Empty** (a group with no members, reachable by an Owner or Staff
URL or after removing the last one): "No one in this household yet. Add someone from their own page." / "No one at
this business yet. Add someone from their own page." (D9). A Technician never sees an empty group (it is a 404 to
them, §4.2). **Loading:** three skeleton rows. **Error:** `record.card.failed` with the card title, and Try again.

### 8.3 Details (`details`, 2a)

Group name (inline, Owner, Staff and agency: `renameGroupAction`, `groups-actions.ts:234-254`, Undo; "There's
already a business customer with that name." on a clash), Type (the kind word, read-only, §3), Billing address
(inline, same readers: `setBillingAddressAction`, `:256-269`). A Technician reads all three as text. **Error:**
cannot happen on its own: the group row is the page's authorisation; if it fails the page 404s or errors.

### 8.4 Properties (`properties`, 2a)

Today's `PlacesCard` with a group subject (C12): the group's own homes and job sites, equipment under each,
"Open map" on each, add and edit as on a member's page, no "Move to". **Empty:** "Homes this household shares
show up here, with how to get there and the equipment on site." / business: "Job sites of this business show up
here, with how to get there and the equipment on site." Loading and error as today's card.

### 8.5 Deals (`deals`, 2a)

Today's `DealsBody` rows (`deals-card.tsx:13-38`: name, amount, dot-and-word status) with the person's name under
each. Open deals only (D6). Past 30: "Showing 30 of {count} open deals." **Empty:** "No open deals with these
people. Deals added on a person's page show here." **Error:** `record.card.failed`.

### 8.6 Summary (`summary`, 2b)

One line of facts, each present only when known and non-zero, joined by " · ": "{n} people" (narrow reader: "{n}
people you can see", C4); "Booked {n} times" / "Booked once"; "Last talked {when} with {first name} ({text|email|
call})" (part 1's calendar-day words in the account's zone). A failed fact is left out and named: "Couldn't count
{what}." with Try again (part 1 §9.2). **The cap line**, under the facts, only when `total > 50`: "Showing
activity for 50 of {total} people. Open a person to see theirs." (narrow reader: "…of the {total} people you can
see…"). It sits once, at the top of the middle column, and governs the summary, Next up and the timeline below it
on every width. **Error** (all facts failed): `record.summary.failed`.

### 8.7 Next up (`next-up`, 2b)

Part 1 §9.3's rows, each followed by " · {first name}"; part 1 C9 unchanged (undated To-dos counted, never
listed). Read-only, and **no "Add a To-do"** (no composer, D5). **Empty:** "Nothing coming up for these people.
Bookings ahead and To-dos with a due date show here." **Error:** `record.nextUp.failed`.

### 8.8 Timeline (`timeline`, 2b)

Rows newest first under day separators in the account's zone, each `{member} · {mark} · {verb} · {status} ·
{when}` (C8) on `TimelineItem`, the body as part 1 §9.4 (typed text `lang=""`, part 1 C11). One pager ("Older"
`?before=`, "Newer" to the head; no Older on a page where a source failed, `timeline-pager.ts:9-30`). **Empty**
(first page, nothing failed): "Texts, calls, bookings, notes and To-dos with these people show up here. Open a
person to start one." **Some failed:** `timeline.someFailed`. **All failed:** `record.activity.failed`.
**Loading:** five skeleton rows.

### 8.9 The two entry points (2b, R2)

- **Contact header:** the main-group line (`[contactId]/page.tsx:161-164`) passes `subtitleHref` to
  `/dashboard/accounts/{a}/groups/{mainGroup.id}`; the words are unchanged.
- **Groups card:** each group row gains a ghost "Open" link (`aria-label` "Open {group}") beside the kind word
  (`groups-card.tsx:282-293`), to the same URL. Its copy is read with `m[…]` like the rest of the card (English,
  groups spec §8), so it gets an `.es` twin that shows when the card moves to `t()`.

### 8.10 Keyboard, phone, language

Tab order is DOM order (part 1 C6) with the skip link; every link and control has a visible `:focus-visible` ring;
no overlay, so Esc closes nothing new. On a phone: one column in the registry's phone order; Properties and Deals
are closed disclosures whose body is not mounted until opened. Names truncate with `title`. The pseudo-locale's
+35% wraps "Mandar texto a {name}" and the fact line, never clips them (the page joins `i18n-overflow.spec.ts`).

## 9. Copy (usted; trades Spanish; every key with its `.es` twin, the ratchet freezes any without)

New keys live under `groupPage.*` (part 1 already uses `record.group.*` for the contact header's group line,
`messages.ts:3762-3765`). Reused unchanged: `record.back`, `record.action.directions`, `record.card.summary`,
`.nextUp`, `.activity`, `.deals`, `.retry`, `.failed`, `record.facts.booked`, `.bookedOne`, `.channel.*`,
`.couldntCount`, `.what.bookings`, `.what.talked`, `record.summary.failed`, `record.nextUp.*` (but `.empty` and
`.addTodo`), `record.activity.failed`, `timeline.*` (but `.empty`), `provenance.*`, `assign.someone`,
`places.title`, `groups.kind.*`, `groups.name`, `groups.nameEmpty`, `groups.nameTaken`, `groups.billingAddress`,
`groups.role`, `groups.rolePlaceholder`, `groups.billing`, `groups.remove`, `groups.saved`, `groups.refused`,
`groups.failed`, `groups.tooLong`, `common.undo`.

### 9.1 2a

| Key | English | Español |
|---|---|---|
| `groupPage.action.call` · `.text` · `.email` | Call {name} · Text {name} · Email {name} | Llamar a {name} · Mandar texto a {name} · Mandar correo a {name} |
| `groupPage.card.people` · `.details` | People · Details | Personas · Datos |
| `groupPage.details.type` | Type | Tipo |
| `groupPage.people.primaryContact` | Primary contact | Contacto principal |
| `groupPage.people.makePrimaryContact` | Make primary contact | Hacer contacto principal |
| `groupPage.people.primaryContactSet` | {name} is now the primary contact. | {name} ahora es el contacto principal. |
| `groupPage.people.choosePrimary` | Choose who we call first. | Elija a quién llamamos primero. |
| `groupPage.people.removed` | Removed {name} from this group. | Se quitó a {name} de este grupo. |
| `groupPage.people.emptyHousehold` | No one in this household yet. Add someone from their own page. | Todavía no hay nadie en esta familia. Agregue a alguien desde su propia página. |
| `groupPage.people.emptyBusiness` | No one at this business yet. Add someone from their own page. | Todavía no hay nadie en este negocio. Agregue a alguien desde su propia página. |
| `groupPage.people.more` · `.first` · `.pages` | More people · Back to the start · People pages | Más personas · Volver al inicio · Páginas de personas |
| `groupPage.places.emptyHousehold` | Homes this household shares show up here, with how to get there and the equipment on site. | Aquí aparecen las casas que comparte esta familia, con cómo llegar y el equipo que hay. |
| `groupPage.places.emptyBusiness` | Job sites of this business show up here, with how to get there and the equipment on site. | Aquí aparecen los lugares de trabajo de este negocio, con cómo llegar y el equipo que hay. |
| `groupPage.deals.empty` | No open deals with these people. Deals added on a person's page show here. | No hay oportunidades abiertas con estas personas. Aquí aparecen las que se agregan en la página de una persona. |
| `groupPage.deals.more` | Showing {shown} of {count} open deals. | Se muestran {shown} de {count} oportunidades abiertas. |
| `contact.noName.es` (twin only, `messages.ts:721` has none today) | — | (sin nombre) |

**Changed in 2a (R3), part 1's contact header line** (`messages.ts:3762-3765`), so one customer is never called two
things:

| Key | English (was → now) | Español (was → now) |
|---|---|---|
| `record.group.household` | {group} · Household (unchanged) | {group} · Hogar → {group} · Familia |
| `record.group.business` | {group} · Business → {group} · Business customer | {group} · Negocio → {group} · Cliente comercial |

The tests that pin this line assert the household's English only (`[contactId]/page.test.ts:798`,
`record-header.test.ts:6`, both "· Household", unchanged); 2a adds a business and a Spanish case to the page test
(probe: leave "Negocio" in place → FAILS).

### 9.2 2b

| Key | English | Español |
|---|---|---|
| `groupPage.facts.people` · `.peopleOne` | {count} people · 1 person | {count} personas · 1 persona |
| `groupPage.facts.peopleVisible` · `.peopleVisibleOne` | {count} people you can see · 1 person you can see | {count} personas que usted puede ver · 1 persona que usted puede ver |
| `groupPage.facts.lastTalked` | Last talked {when} with {name} ({channel}) | Última conversación {when} con {name} ({channel}) |
| `groupPage.facts.what.people` | the people in this group | las personas de este grupo |
| `groupPage.capped` | Showing activity for {shown} of {total} people. Open a person to see theirs. | Se muestra la actividad de {shown} de {total} personas. Abra a una persona para ver la suya. |
| `groupPage.cappedVisible` | Showing activity for {shown} of the {total} people you can see. Open a person to see theirs. | Se muestra la actividad de {shown} de las {total} personas que usted puede ver. Abra a una persona para ver la suya. |
| `groupPage.nextUp.empty` | Nothing coming up for these people. Bookings ahead and To-dos with a due date show here. | No hay nada próximo para estas personas. Aquí aparecen las citas que vienen y los pendientes con fecha. |
| `groupPage.timeline.empty` | Texts, calls, bookings, notes and To-dos with these people show up here. Open a person to start one. | Aquí aparecen los textos, llamadas, citas, notas y pendientes con estas personas. Abra a una persona para empezar uno. |
| `groups.open` · `groups.openAria` (R2: with the entry links) | Open · Open {name} | Abrir · Abrir {name} |

`INTERNAL_MILESTONE` and the accents guard run over every key above. A person's name and typed text show as
typed, never translated.

## 10. Errors

The page calls `notFound()` before any other read when `groupId` is not a uuid or `readGroup` returns null (C16);
`readGroup` throwing is the route's error page, as `getContact` throwing is part 1's. Every card loader returns a
load and never throws (part 1 C5); each card sits in its `RecordCardBoundary`. A `?people=` or `?before=` that
does not parse is a cold start (`lib/cursor.ts`, total parsers). **New write:** `setGroupPrimaryContactAction(
accountId, groupId, memberId | null)` in `groups-actions.ts`: `requireAccountAccess` outside `guarded`
(`groups-actions.ts:23-24`'s rule), refused unless `seesWholeAccount` and both the group (`readGroup`) and, when
given, the membership (`readMembership`, `client-groups.ts:142-148`) are visible on the request client, then the
service write; errors are `groups.refused` / `groups.failed`, logged with `loggableError` naming ids only
(`refuse`, `groups-actions.ts:51-55`). It joins `in-account-service-reads.test.ts`'s allowlist as
`proven-target` (the file is already listed, `:86`). **Undo of a removal by a narrow reader** keeps today's
check (`removedByCaller`, `groups-actions.ts:195-203`) and, new, restores `is_primary_contact` only when the
removal event's payload says the member held it: `removeMembership` adds `wasPrimaryContact` to its
`client_group.member_removed` payload (`client-groups.ts:238-239`), so a snapshot edited in the browser cannot make
a Technician's customer the group's primary contact. The group page itself makes no service-client read; it
mentions `ledgerDb` only for C14 and joins the allowlist as `proven-target`, as the contact page is (`:79`).
**Status code (accepted, as part 1 §11):** with the route's `loading.tsx` the `notFound()` reaches the browser as
HTTP 200 carrying the not-found page; no group data is exposed either way.

## 11. Testing (every test can fail on wrong code; each names its probe)

### 11.1 2a

- **Schema** `packages/db/src/test/group-primary-contact-schema.test.ts` (`withRollback`, the local PG18 replica
  first): a second primary contact in one group is refused 23505 (probe: drop the partial index → FAILS); two
  groups each with their own primary contact pass; `set_group_primary_contact` swaps holders in one call, clears
  with null, answers `not_found` for a member of another group or account (probe: drop the group check → a
  crossed member is set → FAILS); executable by `service_role` only (`authenticated` 42501); setting it does not
  change any `company_name` (probe: add the column to the sync trigger's list → a business member's copy is
  recomputed → FAILS by name); remove then restore puts the flag back, and restore while another member now
  holds it restores the membership without it (probe: restore unconditionally → 23505 → FAILS); a deleted
  holder's contact leaves the group with no holder and no error (probe: `on delete restrict` on the contact FK →
  FAILS). **Grants**, same file, the `client-groups-schema.test.ts:157-208` shapes: the client role's UPDATE of
  `is_primary_contact` and an INSERT carrying it are refused 42501 (probe: `grant update (is_primary_contact)` to
  `authenticated` → FAILS); `set_group_primary_contact` and the replaced `app.restore_member` are executable by
  `service_role` only, `anon` and `authenticated` 42501 (probe: drop the revoke → FAILS, the 0043 default-privilege
  trap); `schema-grants-guard.test.ts` passes unchanged, and the "exactly the four policies" case
  (`client-groups-schema.test.ts:174`) still counts four (probe: add a write policy for the flag → FAILS).
- **Queries** `packages/db/src/test/group-members.test.ts` (`withTestAccount`, live): `listGroupMembers` pins the
  primary contact first and never repeats it in the rows; 31 members page as 30 then 1 with `next` exact and no
  row lost or repeated at a `created_at` tie (probe: compare `created_at` only → FAILS); `countGroupMembers`
  fails closed on a null count (probe: `count ?? 0` → FAILS); `listGroupPlaces` returns the group's places and
  not a member's own (probe: reuse `listContactPlaces`'s `or` filter → a member's own place appears → FAILS);
  `listOpenDealsFor` returns open deals only, with `contact_id`.
- **RLS** `client-groups-rls.test.ts` (extended): a Technician with one of three members assigned reads the group
  row, ONE `listGroupMembers` row, `countGroupMembers` = 1, every group place, and a 404-equivalent `readGroup`
  null for a group with none of theirs (probe: drop `client_group_members_technician_scope` → 3 rows → FAILS);
  Owner, Staff and the agency read 3. **The flag under RLS:** with the holder assigned to the Technician they read
  `is_primary_contact = true` on that row; with the holder assigned to someone else, no row they can read carries
  it, and the Owner's client reads the holder (probe: drop the restrictive policy → the Technician reads the
  other's holder row → FAILS).
- **Web, pure:** `group-header.test.ts` (Call, Text and Email go to the primary contact and name them; with no
  visible primary all three are absent while Directions stays, probe: fall back to the first member → FAILS;
  Call is the only primary, probe: make Text primary → FAILS; Directions takes the group's first addressed
  place before the primary's own, probe: swap → FAILS); `record-cards.test.ts` (extended: `GROUP_RECORD_CARDS`
  ids unique, phone order exactly §7's sequence, probe: swap people and timeline → FAILS; `columnRuns(RECORD_CARDS)`
  unchanged, probe: break the generic → the contact list's runs change → FAILS).
- **The page** `groups/[groupId]/page.test.ts`: **404 before any read** — for a malformed id and for a null
  `readGroup`, none of `listGroupMembers`, `countGroupMembers`, `listGroupPlaces`, `listOpenDealsFor`,
  `getContact`, `softSmsGate`, `getPersonPrefs`, `ledgerDb` ran (probe: start them before `readGroup` → FAILS);
  each card failing alone (People, Properties' route, Deals) leaves the others' content (probe: one
  `Promise.all` without per-card loads → the render rejects → FAILS); a narrow reader gets no "Make primary
  contact", no "Remove from this group" and no prompt (probe: gate on `canAssign` from a team read that failed
  open → FAILS); `ledgerDb` is built only after `getContact(primary)` returned a contact (probe: build it first →
  FAILS). `loading.test.ts`: one loading card per `GROUP_RECORD_CARDS` entry in phone order.
- **Actions** `groups-actions.test.ts` (extended): `setGroupPrimaryContactAction` refuses a Technician before any
  service write (probe: drop the `seesWholeAccount` check → the service mock is called → FAILS) and a membership
  of another group; a narrow reader's Undo with `is_primary_contact: true` in a snapshot whose removal event lacks
  `wasPrimaryContact` restores the membership without the flag (probe: pass the snapshot through → FAILS).
- **e2e** `group-page.spec.ts` (bis-e2e-qa runs it; per-run fixture account, never Test Client One; names in
  `e2e/fixtures/fixture-names.test.ts`; rows removed in `afterAll`, each error checked, bookings before contacts
  because `bookings.contact_id` is `on delete restrict`, part 1 §12.1): a household of three seeded with random
  phones, opened BY URL (2a has no entry link, R2); the People card asks "Choose who we call first." and the header
  shows no Call until "Make primary contact" on Ana, then "Call Ana" as the only primary; Undo puts the prompt back;
  no Text (the fixture account has no approved A2P registration, `record-page.spec.ts:190`); the three people are
  listed and each name opens that person; at 390px Properties and Deals are closed under People.

### 11.2 2b

- **Queries** `record.test.ts` (extended): `listTimelinePage` over three members merges a call of one, a booking
  of another and a note of the third in `(at, id)` order, each entry carrying its `contactId` (probe: drop
  `contact_id` from one source's select → that entry's id is undefined → FAILS); with `[contactId]` it equals
  today's `listContactTimelinePage` page for the same contact (probe: change the one-id path to `.in` with a
  second id → FAILS); a Technician's client passed all three ids returns only their member's rows (probe: drop
  `notes_technician_scope` → FAILS); `groupActivityMembers` puts the primary contact first, then by
  `last_message_at` with nulls last, and cuts at the cap while `total` stays exact (probe: sort nulls first →
  FAILS; take `total` from the cut list → FAILS); `groupFacts` counts bookings made, not reschedules, across the
  set (probe: drop `rescheduled_from_id is null` → FAILS) and names the member of the newest conversation (probe:
  take the oldest → FAILS); `groupNextUp`'s rows carry `contactId`.
- **Web, pure:** `timeline-rows.test.ts` (extended: with a subject map every row has a `subject` and keeps its
  mark, probe: drop the mark when `kind = 'customer'` → FAILS; without one, rows are today's, probe: add a subject
  on the contact page → FAILS); `group-facts.test.ts` (the narrow reader's "people you can see" is used whenever
  the reader is narrow, for a narrow reader with every member visible as much as for one with some hidden; the
  view takes only `{ total, narrow }`, so it has no hidden count to branch on, probe: give it a `hiddenCount` and
  show the qualifier only when it is above zero → the all-visible case FAILS; the cap line only past 50, probe:
  `>= 50` → FAILS at exactly 50).
- **The page test** (extended): the summary, Next up and timeline each fail alone; the timeline's sources receive
  exactly the ids `groupActivityMembers` returned (probe: pass the first People page's ids → FAILS when the two
  differ); no composer, no add-To-do and no Done render (probe: reuse `ActivityTimeline` → FAILS).
- **Entry points** (R2): the contact page test asserts `subtitleHref` is the main group's URL (probe: the first
  group instead of the main one → FAILS); `groups-card.test.ts` asserts each row's Open href (probe: link the first
  group for every row → FAILS).
- **e2e** `group-page.spec.ts` (extended): from Ana's page the header's household words open the group page, and
  so does the Groups card's Open; the household's seeded receptionist call (Ana), booking-page booking
  (Luis) and note (Maria, seeded with the e2e user's Clerk id as `author_id`, which the service role's insert
  keeps: `app.notes_author_guard` rewrites only an `authenticated` insert, `0073_record_provenance.sql:118-122`) all appear on the group timeline, each row with its member's name AND an author mark
  ("Ana García · Sofía · AI", "Luis García · Customer", "Maria García · You"); the summary reads "3 people"; Next up
  names the booking's person; under `?locale=es` a row reads "Cliente" and the fact "3 personas". The 50-cap is a
  query and page test, not an e2e (seeding 51 contacts per run costs more than it proves).

## 12. Rollout, deploy order and rollback

**2a, with 0075 (R1).** 0075 on bis-ci (`ci-project-setup.yml`: push-dry-run, then push), then production (MCP
`apply_migration`), then the parity check (`docs/runbooks/ci-supabase-project.md`), all **before 2a merges** (the e2e job's migration check enforces the first, `.github/scripts/ci-migrations-applied.sh`).
~~Safe under the running build: a defaulted column and an unused function.~~ **Not fully safe under the running
build (corrected 2026-10-13 (final review)).** 0075 replaces `app.restore_member`, which then honours a
snapshot's `is_primary_contact` when no other member holds it, and `main`'s `restoreMembershipAction` passes a
narrow caller's browser snapshot through unstripped. Between 0075's apply and 2a's deploy, a Technician could
resend a removal snapshot with `is_primary_contact: true` and make their customer a group's call-first member.
The exposure is nil while no account has a technician membership, so the production apply is preceded, at that
moment, by a read-only count of technician memberships (plan Task 10); a non-zero count stops the apply until
2a can deploy right behind it. **2a's app before 0075:** the People
read selecting `is_primary_contact` fails, so People shows its error state and the header shows no Call, Text or
Email; data-safe, but the order is fixed anyway. It also breaks the contact page's Business-name Undo
(corrected 2026-10-13 (final review)): `undoSetBusiness` reads the added membership's `is_primary_contact`
before the Undo runs, that read fails without the column, and the Undo answers "Undo failed" (nothing is
deleted). The fixed order (0075 first) prevents both. **Rollback:** revert the app; 0075 is harmless to the old build;
drop it (§5) only on an owner decision. Served-HTML marker: the "People" card title on a group page, opened by URL
(2a ships no link to it, R2); a contact page in Spanish reading "· Familia". Never shown to customers. **Before merge, read-only, by the orchestrator:** the largest group's member
count on production and bis-ci (**Assumption:** none is near 50 today; this measures it rather than assumes it).

**2b: an ordinary merge.** No migration. It also turns on the way in: the contact header's group link and the
Groups card's Open (R2). Rollback: revert (the page goes back to URL-only). Served-HTML marker: a
`data-timeline-subject` on a group timeline row, and an `href` to `/groups/` on a contact page's header.

## 13. Effort and open risks

Inside item 3's 6–9 engineer-weeks (`crm-features.md:1264-1267`); the total is unchanged by R1–R3, about 2–3:
**2a about 1–1.5** (0075 with its schema, grants and RLS tests about 0.25–0.5, the generic registry, People with
the call-first choice, Details, the group places subject about 0.75, the part 1 copy change and `contact.noName`
twin about a day, page tests and e2e the rest). **2b about 1–1.5** (the set form of seven sources across four
domains about 0.5, the facts, Next up and ranking about 0.25, the timeline rows with subjects, the two entry links
and `RecordHeader.subtitleHref` moved here from 2a (about a day), tests and e2e the rest). Net: about a day moves
from 2a to 2b; R1 adds the grants and RLS cases to 2a's 0075 work.

- **"Most recently active" is a proxy** (C5): a customer who only calls without leaving a message, or who has only
  notes, ranks by when they joined. It decides only who is cut past 50, and the cut is said.
- **Past 500 visible members** the ranking sees only the newest-joined 500 (§6). The total stays exact.
- **IN-list plans** are an assumption (§5); measured on the replica in the plan, not here.
- **The two "primary" words.** The Groups card's "Main group" / "Make main" (`groups.primary`,
  `groups.makePrimary`, `messages.ts:3550-3553`) is the person's main group; the group page's "Primary contact" is
  the household's. The page never shows "Main group", so the two never meet on one screen.
- **A primary contact who is not the reader's** leaves a Technician with no Call on the group page; they call
  their own customer from that customer's page.
- **Names with no name** read "(no name)" in a Spanish page until `contactDisplayName` (`lib/format.ts:119-124`,
  which reads `m[…]`) takes a locale; the twin lands in 2a, threading the locale is a follow-up (§16.2).

## 14. Needs from other agents (through the orchestrator)

- **bis-db-schema** (2a): migration 0075 (§5), its schema, grants and RLS tests (§11.1), and its apply on bis-ci,
  production and the parity check before 2a merges.
- **bis-frontend** (2b): `RecordHeader.subtitleHref` (moved from 2a by R2), `TimelineItem.subject`, their
  `/styleguide` entries (§7).
- **bis-comms** (2b): `listContactMessages` taking a set, mapping `contact_id` from the conversation
  (`messaging.ts:742-763`).
- **bis-booking** (2b): `countBookingsMadeFor`, the set form of `listContactUpcomingBookings` with `contact_id`,
  `listContactBookings` taking a set and returning `contact_id` (`booking.ts:945-1017`).
- **bis-voice** (2b): `listContactCalls` taking a set and returning `contact_id` (`voice.ts:953-964`).
- **bis-e2e-qa** (2a, 2b): `group-page.spec.ts` (§11) and the page added to `i18n-overflow.spec.ts`.
- **Orchestrator:** the read-only group-size measurement (§12); land the DESIGN.md sentence (§15) in 2b; file the
  `contactDisplayName` locale follow-up (§16.2) in the ledger.

## 15. DESIGN.md amendment this ships (D11, in 2b)

**Record page, appended after "…then who they are.":** "A household or a business has its own record page on the
same kit (decided 2026-10-13): it is a record, reached from its members' pages, not a new top-level surface." It lands with 2b, because "reached from its members' pages" is true only once the entry links ship (R2).

## 16. Owner rulings (2026-10-13) and follow-ups

### 16.1 Rulings on this spec's three open points (danlo, 2026-10-13, by choice tiles)

| # | Question | Ruled 2026-10-13 (owner) | PR |
|---|---|---|---|
| R1 | "Primary member" has no column: `client_group_members.is_primary` is the PERSON's main group, at most one per person (`0069:79`), so a household of three can hold it three times, and `setPrimaryMembership` changes that person's main group and Business name order, not who the household's Call reaches | **A new field via migration 0075, `client_group_members.is_primary_contact`**: at most one per group (partial unique index), written by server code only through 0069's member-write path (a service-role plpgsql function behind a server action that proved the target; no client grant), set by Owner, Staff and the agency from the People card, **no backfill**: every group starts with none and People asks "Choose who we call first." Header Call, Text and Email read it; none → hidden. The cases (a removed holder, a deleted contact, a Technician, the Undo), the rollout and the tests are §5, §12 and §11.1. The recommended option; the "Pays the bills" alternative was not taken | 2a |
| R2 | 2a would show a page with an empty middle column | **The two entry links (the contact header's group link and the Groups card's "Open") ship WITH 2b**; 2a's page is reachable by URL only | 2a, 2b |
| R3 | The kind word: D4's "Household/Business", S-02's G4 ("Household"/"Familia", "Business customer"/"Cliente comercial"), part 1's header ("Hogar", "Business") | **S-02's ruling everywhere**: the group page uses `groups.kind.*` (C11), and part 1's contact header line changes to match in 2a (§9.1) | 2a |

### 16.2 Folded-in findings and follow-ups

- **`contact.noName` Spanish twin: in 2a** (§9.1). `messages.ts:721` has no `.es` line today, so a nameless
  customer reads "(no name)" on a Spanish page.
- **Follow-up, out of scope:** `contactDisplayName` reads `m[…]` (`lib/format.ts:119-124`), the English
  catalogue, so the twin shows only where a caller passes the locale. Threading a locale through it touches every
  caller in the app; it is a follow-up for the ledger, not part of S-03 part 2.
- **Fixed:** part 1's spec cited `countContactBookingsMade` at `booking.ts:915-930`
  (`2026-10-12-record-page-design.md:73`, C8); it is at `:945-960` and the cite is corrected in that file in the
  same commit as these rulings.
