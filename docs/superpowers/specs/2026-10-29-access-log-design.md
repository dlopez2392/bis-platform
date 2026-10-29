# See when BIS looked: a reason to enter, and an access log the Owner can read (F-118 part 1)

**Status:** reviewed; the owner ruled on every §10 question on 2026-10-29 (recorded in §10), and the
corrections found while planning are in §11. Plan: `docs/superpowers/plans/2026-10-29-access-log.md`.
Nothing here is built.
**Branch:** `feat/access-log`, off `main` at `ab4aee71`. **Migration:** `0105_access_log.sql` (0104 is the newest).
**Author:** bis-platform.
**Sources:** `docs/crm-features.md` F-118 (:2222, "A log the owner can read of each time BIS staff opened
their data, and why"; :1578, the client-facing panel row; :3660, "Before release; split: client panel
Later"); :948 rule 9 ("one agency-scoping design for F-118, F-137 and F-138"); S-48 (:3802) and S-55 (:1616),
which this stands under. DESIGN.md: rules 5, 6, 7, 8; the module contract; the 7 AM voice; Label role.
**Owner rulings of 2026-10-29** (binding, numbered R1–R4 below): R1 log each record a BIS person opens,
shown as visits; R2 a reason before entry, no reason no data; R3 Owners (and the agency) read it, Staff and
Technicians do not; R4 append-only in the database, kept for the life of the account.

Paths shorten `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/` to `ACCT/` and
`apps/web/src/app/api/accounts/[accountId]/` to `API/`. Every `path:line` is at `ab4aee71`.

## 0. What the code says (verified 2026-10-29)

| Lead | What the source says |
|---|---|
| Who is "BIS staff" | A session whose Clerk claims carry `app_role = 'agency_admin'` (`lib/auth.ts:16`, `:63`, `:174`, `:205`); in SQL `app.is_agency()` reads the same claim (`0001_tenancy.sql:9-12`). It is set by hand in Clerk `public_metadata`. Agency people are never synced into `users` by the Clerk webhook (`app/api/webhooks/clerk/route.ts:70-72`); one gets a `users` row only by saving a preference (`dashboard/preferences/actions.ts:20-23`, `:41-50`). |
| The entry flow | There is no "open this account" step. The accounts list links straight to `…/<id>/contacts` (`dashboard/accounts/page.tsx:185`), so does the switcher (`components/account-switcher.tsx:94`), and so do the palette, deep links and emails. Every in-account page and action calls `requireAccountAccess` (or a guard built on it, `lib/auth.ts:91-153`), and the agency branch returns at once, before the client-access switch is read (`lib/auth.ts:63`). |
| API routes | The drawer and the record cards load through `apiAccountAccess` (`lib/auth.ts:199-211`), a separate copy of the checks with its own agency branch (`:205`). 14 route files call it (`API/contacts/[contactId]/{summary,ai-summary,documents,document-requests,document-requirements,email,texts,places,groups,relationships}`, `API/groups/[groupId]/{documents,document-requests,places}`, `API/search`). |
| The layout is not a gate | `ACCT/layout.tsx:23` calls `requireAccountAccess`, but every page calls it again; a layout check alone does not stop a page's own reads (ASSUMPTION about Next's rendering: layouts and pages render in parallel and a layout is not re-rendered on client navigation; the code already treats it this way, `dashboard/layout.tsx:85-94`). |
| Record surfaces an agency person can open | Contact page (`ACCT/contacts/[contactId]/page.tsx:94-97`); contact drawer (`API/contacts/[contactId]/summary/route.ts:39-44`, plus the sub-routes above); call page (`ACCT/calls/[callId]/page.tsx:88-106`); household or business page (`ACCT/groups/[groupId]/page.tsx:76-81`); a conversation, opened as `?c=` on the inbox (`ACCT/conversations/page.tsx:109`, `:276-283`); a file view or download (`ACCT/contacts/documents-actions.ts:228-258`, the only app caller of the one read-URL mint, `signedDocumentReadUrl`, pinned by `lib/documents/read-gate.test.ts`); a form's answers (`ACCT/forms/[formId]/page.tsx:21-24`, `:39-40`, `listSubmissions`); the customer list download (`ACCT/contacts/export/route.ts:93`). |
| Not records | Lists (contacts, calls, conversations list pane, calendar, tasks, documents page, pipeline, activity, dashboard); settings surfaces; `ACCT/voice/knowledge/[version]` (the business's own facts; its `?call=` read only checks the call's version, `:84-96`). |
| Agency reads outside any account | `/dashboard/work` reads "every account's open tasks, unanswered conversations and un-closed-out bookings in one pass" (`dashboard/work/page.tsx:3-9`, `:37-39`); `/dashboard/screened` and `/dashboard/numbers` read across tenants with `serviceDb()` (`screened/page.tsx:3-6`, `numbers/page.tsx:14-16`). None passes through `requireAccountAccess`. |
| Background reads | Crons authenticate by secret (`app/api/cron/reminders/route.ts:48`), webhooks by signature, the job runner and Sofía with the service role; `lib/db.ts:4-20` and `ACCT/in-account-service-reads.test.ts` (reason `public-or-cron`) pin that split. None of them has a Clerk session, so none can reach `requireAccountAccess`. |
| Where an Owner's own settings live | A client Owner's sidebar footer item is **Team** (`components/app-sidebar.tsx:209-221`), Owner-only through `requireAccountOwner` (`ACCT/team/page.tsx:28`), which also admits the agency. The palette registers it as `nav:team` (`lib/palette/registry.ts:143-152`); the closest precedent for an Owner's section on a page is `nav:required-documents` → `documents#required-documents` (`registry.ts:157-164`). |
| Owner-read policy shape | `0066_staff_and_roles.sql:95-98`: `coalesce(app.is_agency(), false) or (account_id = app.current_account_id() and app.is_account_owner(app.current_account_id()))`. `is_account_owner` coalesces both halves (`0066:63-66`). |
| Append-only precedent | `0054_consent_ledger.sql:11-17`, `:107-111`: append-only BY GRANTS (no role, service_role included, holds UPDATE or DELETE); rows still leave with their account through `on delete cascade`, "because a referential action runs as the table's OWNER". `consent_events` is deliberately NOT on `ACCOUNT_OWNED_TABLES` (`packages/db/src/account-teardown.ts:20-46` and its comment block). |
| Teardown | `deleteAccountCascade` deletes every listed table by `account_id` with the service client, then the account (`account-teardown.ts:145-182`). A table with no DELETE grant on that list would make teardown throw. |
| Function rules | 0096: a function that sets a search_path writes `set search_path = pg_catalog, pg_temp` (`0096_definer_search_path.sql:37-42`); a new SECURITY DEFINER must join `EXPECTED_DEFINERS`. 0104 grants EXECUTE by revoking from `public, anon, authenticated, service_role` and granting back (`0104_calendar_feeds.sql:32-34`, `:87-88`). |
| Impersonation | No impersonation path exists in the app (no `act` claim is read anywhere in `apps/web/src`). |
| The trust claim | The trust pack draft (kept private, outside this repo) says today that BIS's access is not logged and that a log is planned, not built. §7 says what changes. |

## 1. Scope

**In:** a reason chooser every agency person passes before an account's pages show anything; the visit it
starts; one log row per record opened per visit; the "BIS access" section on the Team page, Owner and
agency only; migration 0105 (two tables, four functions, grants, RLS); the guard test that forces every new
record route through the logger.

**Not in (part 1):** telling the Owner by email or text when BIS enters (ruling 8); logging list
pages (ruling 2); gating or logging the agency-wide surfaces (§2.3, ruling 3, disclosed in words); a log
export; changing the reason mid-visit; F-137 partner seats (the actor model leaves room, §5.1).

## 2. Who is looking, and what is not a person looking

### 2.1 BIS staff

Exactly the sessions `requireAccountAccess` already treats as the agency: `app_role === 'agency_admin'`
(`lib/auth.ts:63`). Nothing new decides it. Every visit row stores the actor's Clerk user id and a
`actor_kind` that is `'agency'` for now; F-137's partner seats would add `'partner'` by migration, which is
the "one agency-scoping design" of `crm-features.md:948` (the log is where the three features meet).

The actor's display name is a snapshot taken when the visit starts: the `users` row's `name` (or email)
when one exists, otherwise Clerk's `currentUser()` full name or primary email, the shape
`preferences/actions.ts:41-50` already uses, otherwise "Someone at BIS" / "Alguien de BIS". ASSUMPTION:
`currentUser()` is one Clerk Backend API call; it runs once per visit start, never per page.

### 2.2 Background reads are not logged, by construction

Crons, webhooks, the job runner, Sofía's calls and chats, AI summaries generated in the background, the
weekly report and every other service-role read never hold a Clerk session, so they cannot call
`requireAccountAccess` or `apiAccountAccess` (§0, "Background reads"). The logger takes the access result
those two return (§4.2), so nothing without a signed-in person can write an entry. They are the product
doing its job, not a person looking, and logging them as a person would make the log false in the other
direction. The section says this in one line (§6.3).

A PERSON's request that happens to trigger AI (the drawer's `API/contacts/[contactId]/ai-summary`) is a
person looking, and is logged as that contact (§4.1).

### 2.3 Agency surfaces outside an account (open question 3)

`/dashboard/work`, `/dashboard/screened` and `/dashboard/numbers` show slices of client data across every
account without entering one (§0). Asking for a reason per account on a cross-account list is not
possible, and logging every account the list touches would fill each Owner's log with an entry per page
load. **Decided (ruling 3, 2026-10-29):** part 1 leaves them ungated and unlogged, says so in words on
the Owner's BIS access section (English and Spanish) and in the trust pack text, and every click from them
INTO a record goes through the gate and the log like any other entry. Deciding one of Sofía's suggestions
from the work list is part of that page, so it is not gated either (§11, C11); the section's note says so.

### 2.4 Impersonation (open question 5)

The app has no impersonation path today. Clerk's dashboard can sign a staff member in AS a client user
(ASSUMPTION: Clerk marks such a session with an `act` claim). That session would look like the client to
`requireAccountAccess` and be logged nowhere. **Decided (ruling 5):** `requireAccountAccess` and
`apiAccountAccess` refuse a session carrying `act` (to `/no-access?reason=none`, and `null` for the API
variant), so the only way for BIS into an account is the agency path, with a reason. Clerk's `auth()`
exposes the claim as `actor`.

## 3. The visit: a reason before any data

### 3.1 Where the gate sits

Inside the two functions every in-account surface already calls, in their agency branch only:

- `requireAccountAccess` (`lib/auth.ts:63`): an agency caller with no live visit for this account is
  redirected to `/dashboard/enter/<accountId>?to=<path>`. With a live visit it returns as today.
  `requireAccountOwner`, `requireNotTechnician` and `requireAgencyOnlyAccountAccess` build on it and
  inherit the gate (`:94`, `:122`, `:149`).
- `apiAccountAccess` (`:205`): no live visit → `null`, so the route answers its usual 404.

Clients pay nothing: their branch never reaches the new code. The gate is independent of the client-access
switch, which governs clients only and is read after the agency branch (`:72`); a visit to an account
whose access is off is still logged, and the Owner reads it when access returns.

The links (accounts list, switcher, palette, emails) do not change. Any route into an account meets the
gate, which is the point: a link cannot forget it. Settings and the checklist are behind it too (they
read client data, and "Setup" is one of the reasons).

Two agency writes sit in the account tree but are NOT behind the visit. They guard with
`requireAgency()` alone and touch configuration, never a customer record (review m11):
`captureBlueprintAction` (`dashboard/blueprints/actions.ts:8-19`, which copies an account's setup into a
blueprint) and every action in `ACCT/settings/billing-actions.ts` (`:91-249`: billing links, complimentary
status, the pause and the plan). The route walk's action map pins both as configuration (plan Task 11).

The live-visit read is one RPC, wrapped in React `cache()` per `(accountId)` so the layout, the page and
the shell share it within a request. A failed read throws (fail closed); the page's error boundary shows.

### 3.2 The chooser

`app/(dashboard)/dashboard/enter/[accountId]/page.tsx`, outside `ACCT/` on purpose: under `ACCT/` its own
layout would call the gate and loop, and `ACCOUNT_ROUTE_RE` (`lib/account-route.ts:12`) would make the
shell fetch the account's counts. Guarded by `requireAgency()` first. It reads the account's `name` (the
agency's own label, agency-facing only) on the request client.

- Heading: "Why are you opening Rio Roofing?" / "¿Por qué abre Rio Roofing?"
- Four equal tiles, one tap each, none primary (rule 8: a choice of four, no default):
  **Setup** / **Configuración** · **Support request** / **Solicitud de ayuda** · **Fixing a problem** /
  **Arreglar un problema** · **Billing** / **Facturación**.
- Line under them: "The business's Owners can see each visit, its reason and everything you open." /
  "Los dueños del negocio pueden ver cada visita, su motivo y todo lo que abra."
- Ghost link: "Back to accounts" / "Volver a las cuentas".
- After a visit ends (§3.3), the heading's lead line: "Your last visit here ended after 2 hours." /
  "Su última visita aquí terminó al cabo de 2 horas." (shown when a visit by this person and session ended
  within the last 12 hours; "a las 2 horas" read as a clock time, §11 C9).

The tile posts `startVisitAction(accountId, reason, to)`: `requireAgency()`; `reason` from the closed list
or refuse; `accountId` a UUID of an existing account; `start_agency_visit` (§5.3) returns the live visit
if one exists (a double tap or a second tab makes no second visit) or a new one; then `redirect(to)`.

**`to`** is accepted only when it matches `^/dashboard/accounts/<the same accountId>(/|\?|$)` and contains
no `//` or `\`; anything else goes to the account's home (`accountHome`, `lib/auth.ts:128-130`). The
gate learns the path from a request header the proxy sets: `proxy.ts:5-7` adds `x-bis-path`
(pathname + search) for `/dashboard/accounts/*` requests. ASSUMPTION: a request header set by returning
`NextResponse.next({ request: { headers } })` from `clerkMiddleware`'s handler reaches `headers()` in
server code; the e2e deep-link case (test 15) proves it, and without the header the visit lands on the
account's home, which is still correct.

### 3.3 How long a visit lasts, and what ends it (ruling 1)

**Decided (ruling 1): two hours from the reason, fixed, per person, per sign-in session, per account.**

- It starts when the reason is chosen, at the DATABASE's `now()`.
- It is live while `started_at > now() - interval '2 hours'` and the Clerk session id is the one that
  started it. Signing out and in again is a new session (ASSUMPTION: Clerk's `sessionId` from `auth()`
  is stable for a sign-in and new after the next one), so it needs a new reason.
- Activity does not extend it. A sliding window needs a write on every request, and an append-only log
  cannot hold a moving end time.
- Entering another account does not end it; visits to two accounts can be live at once. (A
  one-account-at-a-time rule would force a reason on every switch back and forth, and would break every
  e2e spec that moves between the per-run fixture and Test Client One.)
- When it ends mid-work, the next page or action meets the gate and shows the chooser. A server action
  that hits the gate redirects; this includes the shell's background snapshot (`ACCT/shell-actions.ts:149-151`),
  so an expired visit moves the person to the chooser on its next poll. That is the gate working.
- An open drawer whose visit has ended gets a 404 and shows its existing error state; the next navigation
  shows the chooser.

What the Owner sees as the visit's span: from `started_at` to the last item's `first_opened_at` (§6.2).

## 4. The record log

### 4.1 What is logged (R1)

One row per record per visit, the first time it is opened in that visit:

| Kind | Opened by | Logged in |
|---|---|---|
| `contact` | the contact page; the drawer and every record card it loads | `ACCT/contacts/[contactId]/page.tsx` after `getContact` (:96-97); each `API/contacts/[contactId]/*` route after its own contact proof |
| `group` | the household or business page and its cards | `ACCT/groups/[groupId]/page.tsx` after `readGroup` (:80-81); each `API/groups/[groupId]/*` route |
| `call` | the call page | `ACCT/calls/[callId]/page.tsx` after `getCall` (:106) |
| `conversation` | the inbox with `?c=` resolving to a thread | `ACCT/conversations/page.tsx`, once the selected thread is resolved (:276-283) |
| `document_view`, `document_download` | opening or downloading a file (record id = the document, not the version) | `getDocumentUrlAction` (`ACCT/contacts/documents-actions.ts:228-258`): AFTER `signedDocumentReadUrl` answered `ok` and BEFORE the URL is returned. A pending or removed file opens nothing and logs nothing. A failed write discards the minted URL, so it never leaves the server (review m6) |
| `document_share` | making a share link for a file (record id = the document) | `createDocumentShareAction` (`ACCT/contacts/document-shares-actions.ts:49-77`), after the request-client proof and the clean-version pick, BEFORE the token is made. A `/s/<token>` link opens the file with no sign-in, so without this row the agency could read any file through a link of its own and leave nothing (review I1) |
| `form_answers` | a form's page, which lists its answers (record id = the form) | `ACCT/forms/[formId]/page.tsx` after `getForm` (:23-24) |
| `customer_list_export` | downloading the customer list (no record id; `item_count` = the rows matching the export's filters when it starts, from `countContacts`) | `ACCT/contacts/export/route.ts` after `requireAccountOwner` and the count, BEFORE the stream starts (the route streams, so "rows sent" is known only after the data has left, §11 C1). Every export is its own row. The route uses `noteOpenedApi`. An agency person with no live visit gets a 409 plain-text answer before any guard can redirect, so a download link never saves the chooser's HTML as the file (review m5) |

Not logged: lists, settings, the palette search (`API/search`, which returns names like a list; opening a
result opens the record, which is logged), the knowledge snapshot. Open question 2 covers lists.

A 404 is never logged: the logger runs only after the record is proven to exist in this account, so a
mistyped or foreign id leaves nothing.

### 4.2 One choke point, and how a new record route is forced through it

`lib/access-log/note.ts` exports `noteOpened(access, accountId, ref)`:

- `access` is the value `requireAccountAccess` or `apiAccountAccess` returned. For a client
  (`isAgency === false`) it returns at once and writes nothing: Owners, Staff and Technicians opening their
  own records are not "BIS looking".
- For the agency it reads `userId` and `sessionId` from `auth()` and calls `note_agency_open` (§5.3), which
  re-checks that a live visit exists (so a visit that ended between the gate and the note takes nothing)
  and inserts `on conflict do nothing`. `no_visit` → `redirect` to the chooser (pages and actions) or
  `null` (the API variant, `noteOpenedApi`, whose caller answers 404).
- **Fail closed (open question 4).** A failed write throws in a page (error boundary), answers 500 in a
  route, and returns `documents.error.open` in the file action: no log, no look. A failure here is a
  database failure, which would fail the page's own reads too.
- It runs in the page's `Promise.all` beside the other reads where the page has one, so its round trip is
  not added in series.

**The guard:** `ACCT/access-log-routes.test.ts` (new), the house's source-scan shape
(`ACCT/technician-guards.test.ts`, `lib/documents/read-gate.test.ts`'s AST walker, not a regex):

1. It WALKS `ACCT/` and `app/api/accounts/` for every `page.tsx` and `route.ts`, and classifies each from
   one pinned map: `record` (must call `noteOpened` or `noteOpenedApi` in real code, not a comment) or
   `not-a-record` with its reason in words. A new file in neither fails BY NAME ("unclassified route:
   …"), so a new record page cannot ship without someone deciding.
2. It asserts three orders within function bodies (AST): `getDocumentUrlAction` calls
   `signedDocumentReadUrl`, then `noteOpened`, then returns the URL; `createDocumentShareAction` calls
   `noteOpened` before `newShareToken`. It also asserts that `lib/document-shares/public-share.ts` is the
   only other app caller of the mint (a customer's share link, not BIS).
4. It enumerates every exported server action in the account-scoped "use server" files, with the same
   enumeration as `lib/billing/read-only.test.ts:131-245`. It pins each action as a record read (which must
   log) or not a record, with its reason. It also requires a reason for every other file under `app/` that
   calls a guard (review I2). Entry files are matched by `^(page|route|layout|template|default)\.[jt]sx?$`.
5. It requires each logger call to be unfakeable (review I3). `noteOpened` must be directly awaited, or be
   an element of an array literal passed straight to an awaited `Promise.all`. It is never the receiver of
   `.catch`/`.then` and never behind `void`. `noteOpenedApi` appears only as
   `if (!(await noteOpenedApi(…))) return …`.
3. It asserts that the importers of `lib/access-log/note` are exactly the record files, the file action
   and the share action (an allowlist), and that nothing under the public, cron, webhook and voice trees
   (`app/api/{cron,webhooks,voice,sms,concierge,d,s,unsubscribe,ops}`, `app/{b,c,f,u,d,s,cal}`,
   `lib/automations`, `lib/voice`) imports any `lib/access-log` module (§2.2's rule, pinned). There is
   no `lib/jobs`; the job runner lives in `lib/automations/jobs` (§11 C7).

### 4.3 Write cost

- Clients: zero queries added.
- Agency: one `agency_visit_live` RPC per request (cached), plus one `note_agency_open` per record route
  hit. A drawer open is the summary route plus up to nine card routes, so up to ten small idempotent RPCs,
  run in parallel with each route's own reads; only the first writes a row. ASSUMPTION: an indexed
  `insert … on conflict do nothing` on a two-row-per-visit-key unique index costs a few milliseconds on
  Supabase; nobody measured it. Today one person carries the agency role.
- Rows: about 100 bytes each, one per record per visit. A busy support day of 40 records is 4 KB.

## 5. Database (migration 0105)

### 5.1 Tables

```
agency_visits
  id uuid primary key default gen_random_uuid()
  account_id uuid not null references accounts(id) on delete cascade
  actor_kind text not null default 'agency' check (actor_kind in ('agency'))
  actor_clerk_user_id text not null check (actor_clerk_user_id <> '')
  actor_name text check (actor_name is null or char_length(btrim(actor_name)) between 1 and 200)
                                             -- NULL = no name found; the reader says "Someone at BIS" (§11 C6)
  clerk_session_id text not null check (clerk_session_id <> '')
  reason text not null check (reason in ('setup', 'support', 'fix', 'billing'))
  started_at timestamptz not null default now()
  unique (id, account_id)                                   -- target of the items' composite FK
  index agency_visits_page   on (account_id, started_at desc, id desc)          -- the reader's cursor
  index agency_visits_live   on (actor_clerk_user_id, clerk_session_id, account_id, started_at desc)

agency_visit_items
  id uuid primary key default gen_random_uuid()
  visit_id uuid not null
  account_id uuid not null              -- tied to the account THROUGH the visit (§11 C5)
  foreign key (visit_id, account_id) references agency_visits (id, account_id) on delete cascade
  kind text not null check (kind in ('contact', 'group', 'call', 'conversation', 'document_view',
                                     'document_download', 'document_share', 'form_answers',
                                     'customer_list_export'))
  record_id uuid                       -- NO foreign key: the log outlives the record (§6.2)
  item_count integer check (item_count >= 0)
  first_opened_at timestamptz not null default now()
  check ((kind = 'customer_list_export') = (record_id is null))
  check ((kind = 'customer_list_export') = (item_count is not null))
  unique index agency_visit_items_once on (visit_id, kind, record_id) where record_id is not null
  index agency_visit_items_visit on (visit_id, first_opened_at desc)
```

No customer data is stored: ids only, resolved to names when an Owner reads (§6.2). A customer deleted
later (F-122's "delete me") leaves an id and no name, and `contacts`' foreign-key list stays at 23
(`packages/db/src/test/ai-acts-schema.test.ts`'s `FK_PAIRS` pin must not change).

### 5.2 Append-only, by grants (R4)

0054's shape, `0054_consent_ledger.sql:107-111`:

```
revoke all on public.agency_visits, public.agency_visit_items from anon, authenticated, service_role;
grant select (id, account_id, actor_kind, actor_name, reason, started_at) on agency_visits to authenticated;
                                     -- RLS decides which rows. The column list keeps BIS staff's Clerk user
                                     -- and session ids out of an Owner's reach (review m3).
grant select on agency_visit_items to authenticated;
grant select on both to service_role;
grant insert (account_id, actor_clerk_user_id, actor_name, clerk_session_id, reason) on agency_visits to service_role;
grant insert (visit_id, account_id, kind, record_id, item_count) on agency_visit_items to service_role;
```

No role holds UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER. Column-level INSERT keeps `started_at`
and `first_opened_at` on the database's clock: no caller can backdate an entry. The rows leave only with
their account, by `on delete cascade`, which runs as the table owner (0054:12-15).

RLS on, one permissive SELECT policy per table, `to authenticated`, 0066:95-98's expression exactly:
the agency, or this account's Owner while client access is on. Staff, Technicians and every other
account read zero rows (R3).

### 5.3 Functions

All four `security invoker`, `set search_path = pg_catalog, pg_temp` (0096's rule), names
schema-qualified, EXECUTE revoked from `public, anon, authenticated, service_role` and granted back as
listed (0104's shape). No SECURITY DEFINER, so `EXPECTED_DEFINERS` does not change. The window lives in
one place, `app.agency_visit_window()` (`select interval '2 hours'`, immutable).

| Function | Granted to | Does |
|---|---|---|
| `start_agency_visit(p_account_id, p_actor, p_actor_name, p_session, p_reason) returns uuid` | service_role | Returns the live visit for (actor, session, account) if one exists, else inserts one. Takes `pg_advisory_xact_lock(hashtextextended(p_actor || '|' || p_session || '|' || p_account_id::text, 0))` first (the separators keep two different triples from hashing one string), so two taps make one visit. |
| `agency_visit_live(p_account_id, p_actor, p_session) returns uuid` | service_role | The newest visit for the triple with `started_at > now() - app.agency_visit_window()`, or NULL. |
| `note_agency_open(p_account_id, p_actor, p_session, p_kind, p_record_id, p_item_count) returns text` | service_role | Finds the live visit for the triple (NOT a caller-supplied visit id, so no visit of another account or person can be named), inserts the item `on conflict do nothing` (or always, for an export), answers `ok` or `no_visit`. |
| `access_log_page(p_account_id, p_before_started, p_before_id, p_limit) returns jsonb` | authenticated | Invoker, so RLS bounds it. `p_limit` 1–50 or it raises. Up to `p_limit + 1` visits older than the cursor, each with `ended_at` (its last item's time), counts per kind (files counted once per document across view and download) and its first 100 items, newest first. |

### 5.4 Teardown and retention

Kept for the life of the account (R4). Both tables are deliberately NOT on `ACCOUNT_OWNED_TABLES`, for
`consent_events`' reason: the service role holds no DELETE, so `deleteAccountCascade`'s loop would throw
on them, and the account's own delete carries them away. `account-teardown.ts`'s comment block gains a
paragraph naming both (as it names `consent_events`). Contact deletion, the trash, and a file's permanent
purge touch nothing in the log.

### 5.5 Rollback

`drop function` ×4 and `app.agency_visit_window`; `drop table public.agency_visit_items, public.agency_visits`.
It destroys the log; say so in the file. The app build that ships with 0105 cannot run without it.

## 6. What the Owner sees (R3)

### 6.1 Where

One section, **"BIS access" / "Acceso de BIS"**, at the bottom of the Team page (`ACCT/team/page.tsx`),
`id="bis-access"`, in its own Suspense and error boundary below `TeamSection`. Team is the Owner's own
footer destination and already admits exactly the Owner and the agency (`:28`), and "who can get into my
account" belongs there. Palette: `nav:bis-access`, label "BIS access" / "Acceso de BIS", keywords
`bis, access, log, visits, who looked, acceso, registro, visitas`, href `${base}/team#bis-access`, for an
Owner and for the agency (`registry.ts:157-164`'s shape). The anchor renders in every state, so the
anchor-parity check (`registry.test.ts`, D-080) holds. No new nav item and no new top-level surface. The
reads go through `dbForRequest()` only.

### 6.2 A visit row, and what it expands to

```
DAN LOPEZ · SUPPORT REQUEST                                   (Label role: mono, uppercase)
Oct 29, 2:10–2:25 PM
Opened 4 customers, 1 call and 1 file.          [Show what was opened]   (ghost, aria-expanded)
```

- Times in the account's zone (`accounts.timezone`, `0001_tenancy.sql:26`), the date once, the span as
  start–end; a visit with no items shows its start only. When the zone's offset changes inside the span
  (the autumn hour that repeats), each clock carries its zone name ("1:30 AM CDT–1:20 AM CST"). An end
  then never reads as earlier than its start (review m8).
- The summary counts in this order: customers, households or businesses, calls, conversations, files, form
  answers, customer list downloads. Words, never icons alone; singular and plural in both languages.
  Nothing opened: "Didn't open any customer, call, conversation or file." / "No abrió ningún cliente,
  llamada, conversación ni archivo."
- Expanded, one row per item, newest first, each a link to the record while it exists: "Customer · Maria
  Lopez", "Business · Rio Roofing", "Call · Maria Lopez · Oct 28, 3:04 PM", "Conversation · Maria Lopez",
  "File · Insurance card · viewed" / "downloaded" / "shared", "Form answers · Contact us", "Downloaded your customer
  list (212 customers)". More than 100: "and 37 more" / "y 37 más", no link.
- **Names are resolved when the Owner reads, through the Owner's own RLS** (contacts, client_groups,
  calls with their contact, conversations with their contact, documents including trashed ones, forms).
  An Owner sees every record, Owners-only files included, so nothing BIS opened is hidden from them, and
  nothing leaks that they could not open themselves. What no longer resolves:
  - archived customer: the name, then "(archived)" / "(archivado)";
  - file in the trash: the title, then "(in the trash)" / "(en la papelera)";
  - deleted customer: "A customer who was later deleted" / "Un cliente que se eliminó después";
  - deleted household or business: "A household or business that was later deleted" / "Un hogar o negocio
    que se eliminó después";
  - purged file: "A file that was later deleted for good" / "Un archivo que se eliminó para siempre
    después";
  - any other gone record: "A record that was later deleted" / "Un registro que se eliminó después".

### 6.3 States (rule 5, rule 7)

| State | What it shows |
|---|---|
| Intro (always) | "Each time someone at BIS opens your account, they must choose why first. Every customer, call, conversation and file they open is listed here. These entries can't be changed or deleted from BIS or from your account." / "Cada vez que alguien de BIS abre su cuenta, primero tiene que elegir por qué. Aquí aparece cada cliente, llamada, conversación y archivo que abre. Estas entradas no se pueden cambiar ni borrar desde BIS ni desde su cuenta." (Narrowed from "Nobody … can change or delete this list": the grants bind every API role, but the table's owner role, which the Supabase dashboard's SQL editor uses, is not bound by them; §11 C8.) |
| Loading | A skeleton of three visit rows (label line, date line, sentence line). |
| Empty | "BIS hasn't opened your account yet. When someone does, you'll see who, when, why and what they opened." / "BIS todavía no ha abierto su cuenta. Cuando alguien lo haga, verá quién, cuándo, por qué y qué abrió." No button: nothing the Owner does causes an entry. |
| Loaded | Visits newest first, 20 a page, a real total in the header ("12 visits"/"12 visitas"; a NULL head count throws, never shows 0), exactly one pager, "Older" / "Anteriores" and "Newer" / "Recientes" with `?accessBefore=` (named so it cannot collide with another card's `?before=`). |
| Error | "We couldn't load BIS's visits. Try again." / "No pudimos cargar las visitas de BIS. Inténtelo de nuevo." Ghost **Try again** / **Reintentar**. The Team card above stands (its own boundary). |
| Note (always, small) | "This list shows people at BIS. Automatic work, like Sofía answering a call or a reminder going out, isn't a person looking and isn't listed." / "Esta lista muestra a personas de BIS. El trabajo automático, como Sofía al contestar una llamada o el envío de un recordatorio, no es una persona mirando y no aparece aquí." Plus the lists line (orchestrator decision, review I5, consistent with ruling 2): "Lists inside your account, like your customers, inbox and calls, are part of the visit and aren't listed one by one." / "Las listas dentro de su cuenta, como sus clientes, la bandeja de entrada y las llamadas, forman parte de la visita y no aparecen una por una." Plus the agency-lists line (ruling 3, required): "BIS also has a few lists that show every business at once: open work, screened calls and phone numbers. Looking at those lists, or deciding one of Sofía's suggestions from the work list, doesn't open your account, so it isn't listed here. Opening a customer, call or conversation from them is." / "BIS también tiene algunas listas que muestran todos los negocios a la vez: el trabajo pendiente, las llamadas filtradas y los números de teléfono. Ver esas listas, o decidir una sugerencia de Sofía desde la lista de trabajo, no abre su cuenta, así que no aparece aquí. Abrir desde ellas un cliente, una llamada o una conversación sí aparece." |

No primary button anywhere in the section (rule 8 allows none). No status colours: a reason is not a
status. Usted throughout (the app UI's register, as in `2026-10-28-calendar-feed-design.md` §5.2). Every string goes in `messages.ts` under
`accessLog.*` with an `.es` twin, under the `INTERNAL_MILESTONE` guard; no `F-118`, no `{{`, no arrows.

## 7. Making the trust claim true

The trust pack draft (private, outside this repo) says BIS's access is not logged yet. After this ships
to production, and only then, its sentences change from "planned, not built" to what is built: a reason
before entry, a log the firm's Owners read on the Team page, append-only in the database, kept for the
life of the account. Three limits must be stated with it (rulings 2, 3 and 6). First, lists inside the
account (the customer list, the inbox, the calls and the rest) are part of a visit and are not listed one
by one (review I5). Then the other two: BIS's three cross-account lists
(the work list, including deciding a suggestion from it, the screened-calls list and the numbers page;
§2.3), and maintenance access straight to the database (the Supabase dashboard or SQL with the service key
or the owner role), which bypasses the app, is not in this log, and is not bound by its grants (§11 C8).
The exact replacement text goes to the owner with the final report, not into this public repo.

## 8. Tests and mutation probes

Each probe must make the named test fail BY NAME (working rule 2). Rules from the lane lessons that bind
here: every account-scoped read is tested with a SECOND account holding matching rows; on this branch no
`@bis/db` vitest runs locally until 0105 is on bis-ci (the globalSetup sweep names the new tables), so db
tests are proven by CI verify or on a local PG18 replica with its own port; any file that mocks
`@bis/db` with a bare factory and renders a record page gains the new exports.

| # | Test (file) | It proves | Mutation that must fail it |
|---|---|---|---|
| 1 | Grants (`packages/db/src/test/access-log-schema.test.ts`, new; `schema-grants-guard.test.ts`) | `anon` holds nothing; `authenticated` SELECT only, and on `agency_visits` only the six columns that are not BIS staff's Clerk ids (review m3); `service_role` SELECT and column INSERT only; no role holds UPDATE, DELETE or TRUNCATE (read from `information_schema.role_table_grants` and `column_privileges`, 0054's test shape). | Drop `service_role` from the `revoke all` line (the default ACL hands it DELETE back). |
| 2 | Append-only, live (same file) | As service_role: `update agency_visits set reason = …` and `delete from agency_visit_items …` both raise `42501`. Inserting with an explicit `started_at` raises `42501`. | `grant update (reason) on agency_visits to service_role`. |
| 3 | Cascade and teardown (same file; `withTestAccount`'s own teardown is `deleteAccountCascade`, `packages/db/src/test/fixtures.ts:147`) | `deleteAccountCascade` on an account with a visit and items succeeds and leaves no row in either table; a SECOND account's visit survives. | Add `agency_visits` to `ACCOUNT_OWNED_TABLES` (teardown throws `42501`). |
| 4 | Read policy (same file, JWT-claims GUC) | Owner of A reads A's visits; Staff of A, Technician of A, Owner of B read zero of A's rows; the agency reads both; A's Owner with client access off reads zero. | Policy `account_id = app.current_account_id()` with the owner clause dropped (Staff test fails); drop the account clause (B's Owner test fails). |
| 5 | The window (same file) | A visit started at `now() - 2h + 1 min` is live; at `now() - 2h - 1 min` it is not; a different `clerk_session_id` is not live; a different account is not live. Rows inserted as the test's own superuser to set `started_at`. | `>=` → a 3-hour window in `app.agency_visit_window()`; drop the session filter. |
| 6 | One row per record per visit (same file) | `note_agency_open` twice for one contact → one row; two contacts → two rows; a second export → two rows. A new visit → the same contact again. | Drop `agency_visit_items_once`. |
| 7 | No visit, no item (same file) | `note_agency_open` with no live visit answers `no_visit` and writes nothing; with a live visit on account A, a note for account B answers `no_visit`. | Look the visit up by actor and session only (no account). |
| 8 | `start_agency_visit` is idempotent (same file) | Two calls inside the window return the same id; after the window, a new id. | Remove the "return the live one" branch. |
| 9 | The gate (`lib/auth.test.ts` or `lib/access-log/gate.test.ts`, mocking `auth()` and the RPC) | Agency with no live visit → redirect to `/dashboard/enter/<id>?to=<x-bis-path>`; with one → returns as today; a client never calls the RPC; `apiAccountAccess` agency with no visit → null; an RPC error throws. | Return early for the agency before the visit check (the no-visit page and api cases fail); call the RPC for clients (spy count fails). |
| 10 | `noteOpened` (`lib/access-log/note.test.ts`) | Client access → no RPC; agency `ok` → resolves; `no_visit` → redirect (page) / null (api); RPC error → throws. | Swallow the error and return (fail-open test fails). |
| 11 | Route guard (`ACCT/access-log-routes.test.ts`, new) | §4.2's five assertions (entries, the file and share orders and the mint's callers, the importer allowlist, every server action and guarded file classified, every logger call unskippable). Fixture self-tests: an unclassified `page.tsx` or `layout.tsx` fails; a `record` file whose only `noteOpened` is in a comment fails; `void`, `.catch`, `.then`, unawaited and un-negated logger calls fail. | Delete `noteOpened` from `ACCT/calls/[callId]/page.tsx` (fails naming that file); move the file action's note above the mint; `void` the call page's note; export a new action from `contacts/[contactId]/actions.ts`. |
| 12 | `to` validation (`dashboard/enter/actions.test.ts`) | Accepts `/dashboard/accounts/<id>/contacts/<c>?x=1`; refuses `//evil.example`, `/dashboard/accounts/<other id>/…`, `/dashboard/accounts/<id>\\evil`, `https://…`; refuses an unknown reason before any RPC. | Drop the same-account check. |
| 13 | Reader view (`lib/access-log/view.test.ts`) | Counts and plurals in both languages ("1 customer", "4 customers", "1 cliente", "4 clientes"); the order of kinds; view+download of one file counts as 1 file; each "later deleted", archived and trash wording; a visit's span in `Pacific/Honolulu` for an instant that is a different calendar day in Chicago (the machine's zone). | Always plural; render in the machine's zone. |
| 14 | Copy guards (`messages.test.ts`) | EN/ES parity for `accessLog.*`, `INTERNAL_MILESTONE`, no `{{`, no arrows. | Put "F-118" in a string. |
| 15 | e2e (`apps/web/e2e/access-log.spec.ts`, new; bis-e2e-qa runs it) | On the PER-RUN FIXTURE ACCOUNT: a deep link to a fixture contact as the agency shows the chooser and NOT the contact's name; choose "Support request" → lands on that contact (proves `x-bis-path`); open the contacts list and hover rows (no item written by a prefetch, ASSUMPTION about Next's prefetch, pinned here); open one contact's drawer; as the fixture Owner, Team → BIS access shows "Support request" and that one customer; as the fixture Staff, `/team` redirects away. | — |

## 9. Tasks and apply order

**Superseded by the plan** (`docs/superpowers/plans/2026-10-29-access-log.md`, 13 tasks), which splits
these by owner and adds the copy, the components and the guard as their own tasks. Kept for the record.

Tiers per the speed process; high = security or schema.

| # | Wave | Tier | Owner | Files (disjoint within a wave) | What |
|---|---|---|---|---|---|
| T1 | 1 | high | bis-db-schema | `packages/db/supabase/migrations/0105_access_log.sql`; `packages/db/src/test/access-log-schema.test.ts` (new); `packages/db/src/test/schema-grants-guard.test.ts`; `packages/db/src/account-teardown.ts` (comment only); `packages/db/src/access-log.ts` (new, typed wrappers); `packages/db/src/index.ts` (additive) | §5 and tests 1–8, on the local PG18 replica pre and post. |
| T2 | 2 | high | bis-platform | `apps/web/src/lib/auth.ts`; `apps/web/src/lib/access-log/{gate,note}.ts` + tests (new); `apps/web/src/proxy.ts` + `proxy.test.ts`; `app/(dashboard)/dashboard/enter/[accountId]/{page,actions}.tsx` + tests (new) | §3, §4.2's logger; tests 9, 10, 12; §2.4 if the owner accepts it. |
| T3 | 3 | medium | bis-crm | contact page and drawer routes, group page and routes, `documents-actions.ts`, `forms/[formId]/page.tsx`, `contacts/export/route.ts`, their tests' mocks | `noteOpened` calls (§4.1). |
| T4 | 3 | medium | bis-voice / bis-comms | `ACCT/calls/[callId]/page.tsx`; `ACCT/conversations/page.tsx`; their page tests' mocks (the seven `conversations/page.*.test.ts` files) | `noteOpened` calls. |
| T5 | 4 | medium | bis-platform | `ACCT/access-log-routes.test.ts` (new) | Test 11, after T3 and T4 so it starts green and its probes are real. |
| T6 | 3 | medium | bis-frontend | `ACCT/team/page.tsx`; `components/access-log/*` (new); `lib/access-log/view.ts` + test (new); `lib/messages.ts` (`accessLog.*`, additive); `lib/palette/registry.ts` (one entry) | §6; tests 13, 14. |
| T7 | 5 | medium | bis-e2e-qa | `apps/web/e2e/access-log.spec.ts` (new); an agency-visit setup step for every agency spec that enters an account; `e2e/fixtures/entry-guards.test.ts` (it counts setup tests); the screenshot capture's agency flow | Test 15. Every existing agency e2e spec now meets the chooser; the setup step chooses "Setup" for the fixture account and Test Client One. |

**Apply order.** 0105 is additive, but the build that ships with it calls its functions on every agency
request, so: final review passes the migration → bis-ci (`ci-project-setup.yml`; CI's e2e check needs it,
and Vercel Preview of this branch runs on bis-ci) → production BEFORE the merge deploy → parity check →
merge. The old build ignores the new tables, so applying early is safe.

**Findings for the ledger (not fixed here).** Every local e2e run and screenshot capture on bis-ci will
write visits into Test Client One's log that can never be deleted, only carried away with the account;
the rows hold ids only. CI's own stacks are thrown away, so CI adds nothing.

## 10. The owner's rulings (2026-10-29, binding)

Each question below was put to the owner with the recommendation shown in the spec's review draft. Every
one is now DECIDED; the plan implements them as written here.

| # | Question | Decided |
|---|---|---|
| 1 | How long a visit lasts. | **Two hours, fixed, from the moment the reason is chosen** (the database's clock). A new sign-in session needs a new reason. Activity does not extend it (§3.3). |
| 2 | Log list pages (contacts list, calendar, documents page) too? | **No, not in part 1** (accepted). The visit records that BIS entered and why; one more kind can be added later. |
| 3 | The agency-wide work list, refused-calls list and numbers page. | **Not gated and not logged in part 1.** This MUST be disclosed in words on the Owner's BIS access section, in English and Spanish (§6.3's agency-lists line), and in the trust pack text (§7). Everything opened from them is gated and logged; deciding a suggestion from the work list is part of the page and is not (§2.3, §11 C11). |
| 4 | If the log cannot be written, does the record open? | **No: fail closed** for the agency person. Clients are never affected (their branch never reaches the logger, §4.2). |
| 5 | Clerk impersonation. | **Refuse any session carrying Clerk's `act` claim** (accepted, §2.4). |
| 6 | Direct database access for maintenance is not in this log. | **Disclosed as not logged** (accepted), in the trust pack beside the new claim (§7). |
| 7 | The chooser is a page of its own (`/dashboard/enter/<id>`). | **An entry step like `/no-access`** (accepted): agency-only, no nav item, no DESIGN.md amendment. |
| 8 | Tell the Owner when BIS enters (an email or a text)? | **No owner email or notification in part 1.** The log is the record. |
| 9 | The section's place. | **A section at the bottom of the Team page, plus ⌘K `nav:bis-access`** (accepted, §6.1). |

## 11. Corrections made while planning (2026-10-29)

Each was found by reading the source at `13079bec`; the plan's "Deviations from the spec" section carries
the evidence line for each.

- **C1** The customer-list export STREAMS (`contacts/export/route.ts:106-171`), so "rows sent" is known only
  after the data has left. The item is written before the stream starts, with `item_count` from
  `countContacts` on the export's own filters (§4.1 updated).
- **C2** The Export button is a `next/link` to a route handler (`contacts/page.tsx:281-287`). A Link
  prefetches, and on click the router first fetches the URL as RSC and only then falls back to a full
  load, so the handler can run twice per click and once per prefetch, each a logged export. The button
  becomes a plain `<a download>`, and the route answers 204, reading and logging nothing, to any request
  carrying `rsc` or `next-router-prefetch`.
- **C3** Record PAGES are safe to log at render: Next 16.3.6 renders a prefetch only down to the first
  `loading.tsx` and short-circuits a tree with none (`walk-tree-with-flight-router-state.js:62-80`), and
  `next.config.ts` enables no PPR. `conversations/mark-read.tsx:17-20`'s note predates that. The e2e spec
  still pins it.
- **C4** `schema-grants-guard.test.ts` is not edited: its allow-list is the client WRITE surface, and
  `authenticated` gets SELECT only.
- **C5** `agency_visit_items` has no direct `account_id` foreign key: the composite key to
  `agency_visits (id, account_id)` already ties it to the account, and the direct key's cascade had no
  index leading with `account_id` (a sequential scan on PG17, which has no skip scan).
- **C6** `actor_name` is nullable. With no name found, NULL is stored and the reader shows "Someone at
  BIS" / "Alguien de BIS" in the READER's language, instead of English text frozen into the row.
- **C7** There is no `lib/jobs`; §4.2's import guard is an allowlist plus every public, cron, webhook and
  voice tree.
- **C8** "Nobody, at BIS or here, can change or delete this list" overstated the grants: the table's owner
  role is not bound by them. The intro now says what the grants prove, and §7 names the owner role.
- **C9** The Spanish "ended" line reads "al cabo de 2 horas".
- **C10** Creating a company (`createClientAccount`) or adopting an orphan organisation
  (`adoptOrphanOrgAction`) starts a Setup visit for the person doing it, since that is the only possible
  reason and both redirect straight into the new account. A failed start is logged and the redirect then
  meets the chooser, so this never opens anything without a visit.
- **C11** The four suggestion actions (`lib/proposals/actions.ts`, `run()` at `:41`) are bound on
  `/dashboard/work` for every account (`work/agency-work-list.tsx:223-234`). Ruling 3 leaves that page
  ungated, so `run()` passes `requireAccountAccess(accountId, { agencyVisit: "not-required" })`. That is
  pinned as the ONLY use of the option, and disclosed in the agency-lists line.
- **C12** For the agency, `requireAccountAccess` answers `notFound()` and `apiAccountAccess` answers `null`
  for an account id that is not a UUID, before the visit read. Without that, the uuid-typed function
  call would turn a mistyped URL into a 500 where `ACCT/layout.tsx:37` gives a 404 today.
- **C13** The reader's sentence keeps downloads apart: "Opened 4 customers and 1 call. Downloaded your
  customer list." Without that it would read "Opened 1 customer list download".
- **C14** The header's total comes from `access_log_page`'s own `total` (a count under the reader's RLS),
  not a PostgREST head count, so the `count ?? 0` trap has no path in.
- **C15** The chooser's "last visit ended" hint reads the newest visit's start on the service client and
  compares it with the app's clock. It is a hint line, and seconds of skew do not matter, so there is no
  fifth function.
- **C16** The e2e setup project gains a fifth setup test that gives a reason for the fixture account and
  Test Client One. `e2e/fixtures/entry-guards.test.ts` pins the names of the setup tests. The access-log
  spec signs the agency in AGAIN, which makes a new session with no visit, to see the chooser.
- **C17** `x-bis-path` drops Next's internal `_rsc` query parameter.
- **C18** The route walk classifies 41 entry files: 40 pages and routes, plus the account layout. 19 are
  records and 22 are not, counted from the tree at `13079bec`. It also pins every server action (C21).
- **C19** The window's edge is testable exactly: `now()` is fixed inside a transaction, so a visit started
  exactly two hours earlier is NOT live (strict `>`).
- **C20 (review I1)** A share link reads a file with no sign-in, so making one is a file open. It gets
  a new kind, `document_share`, logged before the token is made (§4.1).
- **C21 (review I2, I3)** The route walk also pins every server action, every guarded file under `app/`,
  and every `layout`, `template` and `default` file. It refuses any logger call a caller could quietly skip
  (§4.2 items 4 and 5).
- **C22 (review I5)** The Owner's note and the trust pack say that lists inside the account are part of
  the visit and are not listed one by one (§6.3, §7).
- **C23 (review m3)** `authenticated` reads six columns of `agency_visits`, never the Clerk user or
  session id (§5.2).
- **C24 (review m5)** The export answers 409 in plain text to an agency person with no live visit (§4.1).
- **C25 (review m6)** A file is logged only once the mint answered ready, and before the URL leaves (§4.1).
- **C26 (review m8)** A span across the repeated autumn hour names both zones (§6.2).
- **C27 (review m11)** Two agency actions in the tree are configuration-only and not gated (§3.1).
