# Mine, Unassigned and the Technician — design (first release, item 1, last part)

Date: 2026-10-11. Owner decisions from this session's brainstorm (§2). Plan: `docs/crm-features.md`
§4.3 item 1, row F-085 (part). Sequel to `docs/superpowers/specs/2026-10-10-staff-and-roles-design.md`
(0066), whose R2 held the Technician back until assignment existed.

## 1. Goal

A customer and a task can belong to a person. Owners and Staff filter lists to **Mine** or
**Unassigned**. A third role, **Technician**, sees only the customers assigned to them and
everything on them, enforced by the database, so their own session token reads no one else's.

## 2. Decisions (owner, 2026-10-11)

| # | Question | Decision |
|---|---|---|
| M1 | What a Technician sees | ONLY contacts assigned to them, plus everything on those customers (calls, texts, conversations, messages, bookings, tasks, notes, deals, form submissions, tags, timeline). Enforced by the DATABASE (RLS), not just the app. No pipeline board, website, forms builder, reports or dashboard totals, settings, team |
| M2 | What gets an assignee | Customers (`contacts.assigned_to`) and tasks (`tasks.assigned_to`). The customer's assignee owns their texts, calls and bookings for "Mine". A task has its own assignee, defaulting to the customer's. Mine / Unassigned on Contacts, To do and Conversations. `conversations.assigned_to` and `opportunities.assigned_to` stay unused (F-068, pipeline later) |
| M3 | New customers | Leads from Sofía, forms, web chat and imports land Unassigned. A customer or task a person adds by hand is assigned to that person. No round-robin (decision 4) |
| M4 | Technician writes | Work their own customers: text and call, notes, add and finish tasks, edit contact details, book and move appointments, add a new customer (it becomes theirs). Cannot reassign (not even to Unassigned), delete, export, build forms or touch settings. The database refuses writes to anyone else's customer |
| M5 | Enforcement | RESTRICTIVE RLS policies keyed on role, chosen over a separate read path or a denormalised visible-to column. SECURITY DEFINER, stable, `search_path ''` helpers, coalesced so NULL never fails open. The role check is an uncorrelated scalar subquery (an InitPlan, once per statement), so Owner, Staff and the agency pay almost nothing; only Technician queries do a per-row check |

Choices this spec makes; **(owner, 2026-10-11)** marks the ones danlo confirmed after review (§13):

| # | Choice |
|---|---|
| A1 | **(owner, 2026-10-11)** The policies ask "does this caller see every customer?" (agency, Owner, Staff), not "is this caller a Technician?". A client login with NO membership row then sees no customers, not all of them (§5.1, §13.1) |
| A2 | **(owner, 2026-10-11)** "Assign to…" in the contact list's bulk-action bar, Owner and Staff only |
| A3 | **(owner, 2026-10-11)** When a member leaves, their customers and open tasks go back to Unassigned. Undo puts back the ones nobody has picked up since (§8, §13.2) |
| A4 | When a customer changes hands, their open tasks that were the old assignee's go with them, or they would sit with someone who can no longer see the customer. **Corrected after the final review (2026-10-11):** the same holds when a PERSON changes role. Someone made a Technician loses sight of every task on a customer that is not theirs, so the Team's role change releases those open tasks to Unassigned once the BIS role has landed (`releaseTasksOffCustomers`, service client; a task with no customer stays theirs). An Undo of that role change does not give them back |
| A5 | Only company members can be assignees. The agency has no membership (`users_member_read`, 0066:108), so it is not offered as one |

## 3. Non-goals

Assignment notifications (F-081), round-robin, conversation and deal assignees, role-tuned homes,
per-technician calendars (S-23), field-level restriction (F-004). Operator booking and moving are
not built: the dashboard calendar only sets status, cancels or undoes a cancel
(`calendar/actions.ts:160-323`), and `moveBooking` (`booking.ts:687`) serves only the customer's
`/b/…/move` link. M4's "book and move" applies when operators get it, under §7.3's guard.

## 4. Roles

| Capability | Owner | Staff | Technician | Agency |
|---|---|---|---|---|
| Customers seen | all | all | **assigned to them** | all |
| Work a customer (text, notes, tasks, edit, booking status) | yes | yes | own only | yes |
| Add a customer | yes, theirs | yes, theirs | yes, theirs | yes, Unassigned (A5) |
| Assign or reassign customers and tasks | yes | yes | **no** | yes |
| Dashboard, Activity, Pipeline, Website, Forms, Import | yes | yes | **no** | yes |
| Delete, export, calendar settings, Billing, Team | yes | no (0066) | no | yes |

## 5. Data: migration 0068

Next after `0067_person_preferences.sql`, by bis-db-schema; CI project, production, parity, once each.

### 5.1 Role and helpers

- `memberships_role_check` becomes `('owner','staff','technician')`, and the guard in
  `public.set_account_member_role` (0066:121) accepts `technician`.
- `app.current_user_id()`: `users.id` for `nullif(app.jwt()->>'sub','')`. `app.is_technician(p_account_id)`
  = `coalesce(app.account_role(p_account_id) = 'technician', false)`, for app reads and tests.
- `app.sees_all_customers(p_account_id)` =
  `coalesce(app.is_agency(), false) or coalesce(app.account_role(p_account_id) in ('owner','staff'), false)`.
- `app.my_contact_ids() returns setof uuid`: the caller's account's contacts assigned to
  `app.current_user_id()`; being SECURITY DEFINER, it never re-enters the contacts policy. All
  four are `stable security definer set search_path = ''`, for `authenticated, service_role` only.

**Why `sees_all_customers`, not `not is_technician` (A1).** In the brief's shape a NULL role reads
as "not a Technician" and sees everything, so a Technician whose membership row is missing (Clerk
down during the fallback, a lost webhook) would read every customer: the open failure the "plpgsql
NULL guard" note warns about. Keyed this way, an unknown role sees none. The fallback creates the
row in `requireAccountAccess` (`lib/auth.ts:55`) before any page reads, so a normal login never
meets that. It narrows 0066 §9, where a login without a role reads what `org_id` policies allow.

### 5.2 The tables, and how each row reaches a customer

Every policy is RESTRICTIVE, ANDed with the table's permissive tenant policy, so nothing that
policy refused becomes allowed. Shape:
`using ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()))`.
The left operand is an InitPlan; when true, OR stops before the right's hashed subplan is built.

| Table | Row reaches a customer through | Technician sees | Technician may write |
|---|---|---|---|
| `contacts` | the row; `assigned_to` | `assigned_to = (select app.current_user_id())` | insert and update only as their own (§5.3); delete is Owner-only (0066:84) |
| `contact_tags` | `contact_id` | own | add and remove on own |
| `notes` | `contact_id` | own | on own |
| `tasks` | `contact_id` (nullable); own `assigned_to` | contact is theirs, **or** no contact and assigned to them | same rule; an insert is assigned to them; no assignee change (§5.3) |
| `opportunities` | `contact_id` | own | DB: own only. The app shows deals read-only to them |
| `conversations` | `contact_id` (one per contact, 0005:24) | own | none (server-written, 0053) |
| `messages` | `conversation_id` → `conversations.contact_id` | its conversation's contact is theirs | none (0053) |
| `calls` | `contact_id` (nullable) | own; no contact is hidden | none (select-only, 0019:69) |
| `call_proposals` | `call_id` → `calls.contact_id` | when its call is visible | none (0053) |
| `bookings` | `contact_id` (not null) | own | none (0053) |
| `form_submissions` | `contact_id` (nullable) | own; no contact is hidden | none (0053) |
| `automation_log` | `contact_id` (nullable) | own; no contact is hidden | none (select-only, 0046:79) |
| `consent_events` | `contact_id` (nullable), `address` | `contact_id` own only (display reads: §7.3) | none (service-written, 0054:111) |
| `contact_duplicate_flags` | `contact_a`, `contact_b` | **none** (the merge queue is Owner and Staff work) | none |
| `events` | `payload` jsonb (`contactId` only on some types) | **none**. The record timeline is built from the tables above (`contacts/[contactId]/page.tsx:31-40`). The account feed (`listRecentEvents`, `events.ts:58`) sits behind refused routes | `record_event` only (0053), always as themselves |

Unchanged, since no client token reads them: `screened_calls` (0039:105), `forwarded_calls`
(0059), `voice_web_sessions` (0041:65), `concierge_conversations` (0042:114); `account_billing`
and `usage_events` are Owner-only (0066:95-102).

### 5.3 Technician writes

- **Contacts use a with-check, not a trigger.** `using` and `with check` are both
  `sees_all or assigned_to = me`. A Technician can update only a row that is theirs, and it must
  still be theirs afterwards. "Me" is the only legal value before and after, so `assigned_to`
  cannot change, and an insert must carry `assigned_to = me`. The column stays in the client
  grant (0053:138), because Owners and Staff assign through it.
- **Tasks also need a trigger:** a Technician must finish a task on their customer that the Owner
  assigned to themselves, so "still mine afterwards" is wrong. `tasks_assignee_guard` (BEFORE
  UPDATE OF `assigned_to`) raises `42501` on a change when `current_user = 'authenticated'` and
  `not coalesce(app.sees_all_customers(new.account_id), false)`; keyed on `current_user`, it never
  refuses the service role. The insert with-check adds `sees_all or assigned_to = me`.
- **Account configuration.** Client tokens can write `accounts` (brand), `forms`, `pipelines`,
  `pipeline_stages`, `custom_fields`, `custom_values`, `checklist_items`
  (`schema-grants-guard.test.ts:62-92`); restrictive write policies close them to Technicians.
  `tags` keeps insert (tagging their customer with a new word creates one, `addTagToContact`).
- **Indexes:** `contacts (account_id, assigned_to)` for `my_contact_ids()` and Mine;
  `tasks (account_id, assigned_to) where completed_at is null` for To do's Mine.

**Honest limit.** A Technician's token still reads configuration with no customer data in it: the
account row, `forms`, `calendars`, pipelines and stages, `tags`, `custom_fields`, `custom_values`,
`voice_profiles`, `phone_numbers`, `automations`, `automation_settings`, `sites` and its visitor
totals (the one "report" left readable), and coworkers' names and emails (`memberships`, `users`).

**Rollback.** Revert the app first. Then drop the policies, trigger, helpers and indexes, and
restore the two-value check and 0066's `set_account_member_role`. **Corrected after the final
review (2026-10-11):** do NOT "map `technician` to `staff`". Staff sees the whole account, so that
mapping would hand every Technician every customer the moment the policies go. Before the check is
narrowed, either remove the Technician memberships (in Clerk and in BIS, so the webhook or the
per-request fallback cannot recreate them) or get an explicit owner decision, per account, to make
each one Staff.

## 6. Keeping in step with Clerk

- `roleFromClerk` (`packages/db/src/team.ts:31`) ignores a `bis_role` outside `["owner","staff"]`
  and answers Staff, so a Technician whose row was lost would come back as **Staff**. It becomes an
  ordering, owner > staff > technician, answering the LEAST privileged. `AccountRole` gains it.
- A Technician is a Clerk `org:member`. `clerkRoleFor` (`lib/team/team-view.ts:49`) already maps
  anything but Owner there, and the webhook's re-assert (`api/webhooks/clerk/route.ts`) follows it.
  A test pins both directions. Invitations carry `bis_role: "technician"`.
- **Corrected after the final review (2026-10-11): stale metadata does not "only demote" for a
  Technician.** Technician and Staff are both `org:member`, so only `bis_role` says Technician; a
  membership with no `bis_role`, or a stale one of staff or owner, reads as Staff. Two places act on
  that. `setOrganizationRole` treats a failed `bis_role` write as a FAILURE when the role is
  Technician (for Owner and Staff it is still logged and left, because there the Clerk role alone is
  never more privileged than BIS). The Team's Undo of a removal re-creates the Clerk membership with
  `createOrganizationMembership`, which takes no metadata (@clerk/backend 3.13.1,
  `OrganizationApi.d.ts:140-147`), and that membership is newer than the removal record, so
  reconcile would settle it as Staff whenever the BIS row is missing. `restoreToOrganization` now
  writes `bis_role` straight after the membership exists, BEFORE the BIS write; a Technician whose
  `bis_role` cannot be written is taken out of Clerk again and the Undo fails. If the BIS write then
  fails, the Undo takes the Clerk membership (and any half-written BIS row) away again rather than
  leave a bare `org:member` for the webhook to settle while the card says the Undo failed.

## 7. Enforcement in the app

### 7.1 Routes Technicians cannot enter

`requireAccountAccess` (`lib/auth.ts:33`) already returns `role`. A new `requireNotTechnician`
sends a Technician home. It guards the Dashboard, Activity, Pipeline, Website, Forms,
`forms/[formId]` and `contacts/import` pages (Pipeline and Forms have no page guard today), and
is the first line of every action they post. Agency-only and Owner-only routes already refuse. **Redirect
loops:** `auth.ts:53`, `:71`, `:96` and the landing `(dashboard)/page.tsx:22` send a client to
`/dashboard`; they go through a new `accountHome(accountId, role)` instead (`…/tasks` for a
Technician). **Amended after the final review (2026-10-11), accepted as shipped:** the guards that
refuse (`requireAccountOwner`, `requireAgencyOnlyAccountAccess`) use `accountHome`, but the
landing `(dashboard)/page.tsx:22` and `requireAccountAccess`'s wrong-account redirect
(`auth.ts:56`) still send a client to the account's `/dashboard`, whose `requireNotTechnician`
sends a Technician on to To do. A Technician therefore lands in two hops, not one; no loop, and
`auth.setup.ts` waits for the second.

### 7.2 Service-key readers on the in-account surface

Found by grepping `serviceDb` under `app/(dashboard)/dashboard/accounts/[accountId]` and
`app/api/accounts`, plus the `lib/` modules those files call:

| Reader | Reads | Treatment |
|---|---|---|
| `shell-actions.ts:112` → `sumUnreadCount` | unread total, every conversation | Technician: via `dbForRequest()`, so the badge counts their own |
| same → `readPresence` (`lib/voice/presence.ts`) | on a call; calls this week (account total) | Technician: pulse only, no count. `readSetupProgress`: agency only |
| `calendar/actions.ts:180, 211, 249, 263, 276, 323, 342, 359`; `cancel-notice.ts:164` | a booking by id, its contact's email, the notice | guarded (§7.3) |
| `conversations/actions.ts:265` `clearUnreadCount` | a conversation by id | guarded (§7.3) |
| `conversations/actions.ts:59, 177`; `lib/consent/texts-context.ts:24`, `email-context.ts:23`; `calls/[callId]/actions.ts:140, 347` | writes after `getContact` / `getProposal` on the request client | already guarded, scoped by §5.2 |
| `calendar/page.tsx:54`, `lib/zone.ts:71`, `lib/branding/tenant-theme-reader.ts` | calendar settings, zone, branding | allowed (configuration) |
| `billing/page.tsx:60`, `team/actions.ts`; automations, branding, voice, settings, checklist, setup, website | Owner-only; agency-only | already refused |

Corrections to the brief: the Dashboard (`dashboard/page.tsx:68`), ⌘K search
(`api/accounts/[accountId]/search/route.ts:87`) and Setup (`setup/page.tsx:40-56`) use
`dbForRequest()`, not the service key: search is scoped by §5.2 unchanged, the Dashboard is
refused, Setup is agency-only. `calls/page.tsx:54` (today's calls against the account's daily
limit) would mislead under RLS and is hidden from Technicians.

**Guard test.** `in-account-service-reads.test.ts` scans both trees for `serviceDb` and fails,
naming the file, when it is missing from an allowlist recording its reason (agency-only,
Owner-only, configuration, write after a proven target, Technician-filtered). Probe: an unlisted
`serviceDb()` read in a page must fail it by name.

### 7.3 Service-key writes and consent reads

RLS does not bind `serviceDb()`, which 0053 made the writer of conversations, messages, bookings,
submissions, proposals and events. The house rule in `conversations/actions.ts:55-58` becomes
universal: **prove the target through the request client, then write through the service
client.** A Technician cannot see someone else's booking or conversation, so the proof fails with
no role branching. Missing today in `setBookingStatusAction` (which To do's `closeOutBooking`
calls), `cancelNoticeOptionAction`, `cancelBookingAction`, `undoCancelBookingAction`, the notice
reads (`calendar/actions.ts:342, 359`) and `markConversationReadAction`.

Consent is keyed by address, and a STOP can arrive with no `contact_id`. The send gates read
through the service client (`conversations/actions.ts:188` passes `writer`) and are safe. The
**display** reads (`recipient-state.ts`, `texts-view.ts`, `email-view.ts`, both staff-action
histories, `tasks/actions.ts:202`) use the request client, so a Technician would see "can text"
for a number the gate refuses. They move to the service client, by address, after the contact is
proven through RLS, for every role (the answer is the same for Owner and Staff).

## 8. Assignment

- Customers and tasks added by hand belong to whoever adds them: `createContactAction` and
  `addTaskAction` pass `assignedTo`. Sofía, forms, web chat and imports keep writing NULL. A task
  defaults to its customer's assignee, or to its author when it has no customer.
- `assignContactsAction(accountId, contactIds, userId | null)` runs on `dbForRequest()`.
  Technicians are refused, the target must hold a membership in this account, and the previous
  assignees are returned for Undo. The customer's open tasks move with them (A4).
- `setTaskAssigneeAction` refuses to give a Technician a task on a customer who is not theirs:
  "Assign the customer to them first."
- When a Technician adds a customer whose phone or email already belongs to someone else's
  customer, `findDuplicate` (`contacts.ts:393`) misses the match under RLS and a second row is
  created; `createContact`'s own flag insert (`contacts.ts:411`) would be refused (§5.2). Decided in §13.3: create it as theirs and flag the pair, service-written.
- Lists: `listContacts` and `countContacts` gain `who: "mine" | "unassigned"`; `listConversations`
  (`messaging.ts:593`) filters through `contacts!inner(assigned_to)`; `listAccountWork`
  (`work-queue.ts:137`) filters tasks by their own assignee and derived rows by the customer's.

**Removal (A3).** A removal deletes only the membership (0066); the `users` row survives, so
`on delete set null` would never fire. A new service-role
`public.release_member_assignments(p_account_id, p_user_id) returns jsonb` clears the person's contacts and open tasks and returns the ids. The Team removal
(after `remove_account_member` returns `ok`) and the webhook's removal (`deleteAccountMembership`,
`team.ts:119`) call it. The ids ride in the `team.member_removed` event (`lib/team/removal-log.ts`)
and Undo re-assigns those still Unassigned. It is idempotent, so the removal's second sweep
retries it; until then the person who left reads nothing (A1).

## 9. Screens

- **Technician sidebar:** To do (their landing), Contacts, Conversations, Calendar, Calls
  (`buildNavGroups`, `lib/nav-groups.ts:57`, gains the role); no Settings, Team or setup meter;
  Preferences stays; the ⌘K index leaves out routes they cannot enter.
- **Assignee:** "Assigned to" on the contact drawer (`contact-drawer.tsx`), the record page and
  task rows, as an inline edit: pick a member by name or Unassigned, saved at once, Undo toast
  "Assigned to Ana." (rule 6, Record views). Read-only for Technicians.
- **Filter:** "All · Mine · Unassigned" above Contacts, To do and Conversations, in
  `?who=mine|unassigned`, run on the server so `?before=` paging and the stated total stay true
  (Paged lists). The agency sees All and Unassigned; Technicians see no filter.
- **Bulk (A2):** "Assign to…" in `bulk-action-bar.tsx`. Technicians keep bulk tagging (RLS bounds
  it) and so the checkboxes (rule 4). **Team:** the role picker adds Technician, with help text
  "Sees only the customers you assign to them."
- **States:** skeleton rows while loading. Empty Mine: "Nothing assigned to you yet." Empty
  Unassigned: "Every customer has someone. New leads from calls, forms and chat land here first."
  A database refusal (`42501`) shows "You can't change that customer.", never the raw error, and
  is logged with `loggableError`.

Copy goes in `messages.ts` with `.es` twins, read through `t()` (`lib/i18n/t.ts:32`), so the
ratchet stays green. **Corrected after the final review (2026-10-11):** the Contacts, To do and
Conversations screens read their copy as `m["…"]`, the English key, not through `t()`, so the
new `.es` twins are written but not shown there: those screens are English-only for client logins,
Technicians included. Spanish on them is a follow-up (the screens move to `t()` with the
account's or the person's locale), not part of this release. Key pairs: "All · Mine · Unassigned" / "Todo · A mi cargo · Sin asignar";
"Assigned to {name}." / "Asignado a {name}."; "Technician" / "Técnico" (like "Dueño" and
"Empleado", `messages.ts:3185-3187`); the help / "Solo ve los clientes que usted le asigne.";
"Assign the customer to them first." / "Primero asígnele el cliente."; a Technician's empty
Contacts, "No customers yet. When your team gives you a customer, they show up here." /
"Todavía no tiene clientes. Cuando su equipo le asigne uno, aparecerá aquí." The definition of done
is unchanged (both themes, blur fallback, Esc closes the picker, the 7 AM read in both languages,
the pseudo-locale's +35%).

## 10. Testing (every test can fail on wrong code; each gets a mutation probe in review)

- **RLS** (`packages/db/src/test/technician-scope.test.ts`, `withTestAccount`, after
  `staff-roles.test.ts`), a real Technician token, each §5.2 table: zero rows of another person's
  customer, own rows visible; refused: updating someone else's customer, setting `assigned_to` to
  another person or NULL, inserting unassigned, changing a task's assignee. Owner, Staff and agency
  counts unchanged; a client token with no membership sees zero. Probe: drop one table's policy,
  and its case fails by name.
- **Cost** on the local PG18 replica, as 0066 did: `EXPLAIN ANALYZE` shows an InitPlan and a hashed
  SubPlan; an Owner reading 5,000 contacts and 20,000 messages stays within 10% of today; time a
  Technician with 200 customers.
- **Unit:** `roleFromClerk`'s ordering, `clerkRoleFor("technician")`, the §7.3 guards (someone
  else's booking or conversation gets no service write), `accountHome`, `requireNotTechnician` on
  every §7.1 route, the §7.2 guard test. `schema-grants-guard.test.ts` is unchanged: no grant is added.
- **e2e** (`assign.spec.ts`, per-run fixture account only, never Test Client One; a Technician
  login added in `auth.setup.ts` the way `staffClerkUserId` is). The Owner assigns one customer to
  the Technician, with Undo. The Technician sees exactly that customer in Contacts and ⌘K, lands
  on To do, and is turned away from `/dashboard`.

## 11. Rollout and deploy order

Migration 0068 on the CI project (`ci-project-setup.yml`), then production, then parity, all
**before merge** (e2e fails while bis-ci lacks it). Then merge, deploy and verify per the runbook;
the served-HTML marker is the filter row on Contacts.

Hazards. **Migration before app:** no Technician exists and Owners and Staff pass
`sees_all_customers`, so reads are unchanged, except (A1) a client login with no membership row,
which sees no customers until its next page load creates the row. Check every live client login
has a membership first (0066 rollout step 4). **App before migration is NOT data-safe (corrected
after the final review, 2026-10-11; the earlier "neither order exposes data" was wrong).** The new
app lets an Owner invite a Technician, and an invitation is a Clerk write with nothing written to
the database. When it is accepted, the webhook and the per-request fallback both try
`addAccountMember(role technician)`, which the pre-0068 `memberships_role_check` refuses
(`23514`). That leaves a Clerk member with no BIS row, and before 0068 there is no Technician scope
at all, so that login reads the whole account (the final review measured it on the local replica: 2 rows before 0068,
0 after). Therefore the order is fixed: 0068 on the CI project, then on PRODUCTION, then parity, all
BEFORE the merge, with auto-merge off on this PR until production and parity are confirmed.

## 12. Effort and open risks

- Effort: an estimated 2–3 engineer-weeks, mostly §5.2's tests and §7.3. The plan's 0 for
  F-085's part predates the Technician.
- `messages`, the largest table, nests two subqueries for a Technician; the cost run decides
  whether `my_contact_ids()` needs a conversation-id twin.
- A request-client read of `events` on a Technician route would come back empty. None exists: the
  booking undo (`calendar/actions.ts:323`) and removal lookup (`team.ts:53`) use the service client.
- §7.3 touches compliance display code; the gates do not move.
- Assumption, not verified: a Clerk `org:member` cannot invite (0066 relies on it for Staff).

## 13. Owner rulings (danlo, 2026-10-11, after reading this spec)

1. **A login with no role yet sees no customers, not all of them.** DECIDED yes: it is the only
   safe failure for a Technician, and Owners and Staff meet it only if Clerk is down on a first visit.
2. **When someone leaves, their customers and open tasks go back to Unassigned; Undo restores
   them.** DECIDED yes.
3. **A Technician adds a customer who already exists under someone else.** DECIDED: create it as
   theirs and flag the pair for the Owner's duplicates queue (service-written), telling the
   Technician nothing. Refusing ("already on your list") reveals a customer they cannot see.
4. **"Assign to…" in the bulk-action bar** (A2), Owner and Staff only. DECIDED yes.
