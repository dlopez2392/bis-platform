# Staff and roles — design (first release, item 1, lane A)

Date: 2026-10-10. Owner decisions taken in this session's brainstorm, all recorded below.
Plan: `docs/crm-features.md` §4.3 item 1 (S-01, with F-085 and F-096 parts later).
Parallel lane: the Spanish runtime (F-013 part 1, F-012, F-014), specced separately in
`docs/superpowers/specs/2026-10-10-spanish-runtime-design.md`.

## 1. Goal

A client company gets real users with roles that the server enforces, and its owner runs
their own team. Today there are two tiers (agency admin, client user); every client user is
invited as a Clerk `org:admin`, can export every contact, and every hire and departure goes
through the agency in Clerk's own screens (`docs/crm-features.md` §2.2.1).

## 2. Decisions (owner, 2026-10-10)

| # | Question | Decision |
|---|---|---|
| R1 | How item 1 runs | Two lanes: this spec (staff and roles) and the Spanish runtime in parallel; Mine/Unassigned (F-085 part) and Mis preferencias (F-096 part) follow as small specs once both land |
| R2 | Roles in the first cut | **Owner** and **Staff**. A narrower Technician role waits for assignment (F-085 part), because "only their own jobs" needs assignment to mean anything |
| R3 | Who manages a team | The client's Owner **and** the agency |
| R4 | Owner-only, beyond export and team | Billing, deleting contacts, calendar settings. Staff **may** build and publish forms |
| R5 | Where a role lives | **BIS's database** owns the role; Clerk owns only who belongs to which company |

Decision 33's first group (ratified 2026-10-05) already permits populating users and
memberships ("no member sync" reversed) and raising Clerk's five-membership cap by hand.

## 3. Non-goals

- Field-level restriction, masked values, "View as customer" (F-004, later).
- Assignment, Mine and Unassigned (F-085 part, next spec in this item).
- Mis preferencias UI (F-096 part, after both lanes). This spec stores a language per
  person; the person's own control for it comes later.
- Notifications and mentions (F-081, later). Alert recipients stay where they are today.
- Pricing logins into plans (F-117's later part).
- Bilingual Clerk emails and widgets (F-117 part, later).

## 4. Roles

| Capability | Owner | Staff | Agency |
|---|---|---|---|
| Contacts, pipeline, conversations, calls, activity, tasks, website, forms (build and publish included), calendar (working bookings) | yes | yes | yes |
| Delete contacts (single or bulk) | yes | **no** | yes |
| Export contacts (CSV) | yes | **no** | yes |
| Calendar settings (hours, buffers, notice, horizon, services) | yes | **no** | yes |
| Billing page | yes | **no** | n/a (agency sees Plans) |
| Team: invite, change role or language, remove, revoke invitation | yes | **no** | yes |
| Agency-only surfaces (Settings, Voice, Automations, Branding, Checklist) | no | no | yes |

Existing client logins become **Owner**, so nobody loses a capability on the day it ships.

**Honest limit.** Staff can read every contact; they must, to work. Blocking export is a
friction control in the app, not a data wall: a Staff person holding their own session token
could read rows from the database directly. The real read wall is F-004. Say so in the
Team screen's help text for the Owner, not only here.

## 5. Data

One migration (number assigned at implementation; the next free one), written by
bis-db-schema and applied CI project → production → parity, exactly once each.

- `memberships.role`: values become `owner` | `staff` (check constraint replaced; `admin`
  maps to `owner`, `member` to `staff` for any existing row; today there are none expected,
  verify before applying). Agency-scope memberships are not created by this work; agency
  access stays the `app_role` claim.
- `users.language text null check (language in ('en','es'))`. NULL means "follow the
  account's language". This is the seam the Spanish runtime reads (user → account → default).
- `memberships.removed_at timestamptz null` is **not** added: removal deletes the row; Undo
  re-creates it. History of team changes belongs to the change log (S-04, next).
- Indexes: `memberships (account_id)` and the existing unique index cover the lookups.
- Grants: `authenticated` gets **select** on its own company's memberships and on the users
  in them (Team list, and later assignment pickers). No insert, update or delete for
  `authenticated`: every membership write goes through server actions on `serviceDb()`,
  behind the guards in §7 (the 0053 server-only-writes pattern), and
  `schema-grants-guard.test.ts` pins that.

### 5.1 The role helper

`app.account_role(account_id uuid) returns text`, `security definer`, `stable`,
`set search_path = ''`: the role of the caller (`app.jwt()->>'sub'` → `users.clerk_user_id`)
in that account, or NULL.

`app.is_account_owner(account_id uuid) returns boolean` =
`coalesce(app.is_agency(), false) or coalesce(app.account_role(account_id) = 'owner', false)`.

Both are `coalesce`d to false on purpose: `app.is_agency()` is NULL for a client token, and a
policy that reads it raw inside `IF NOT (...)` fails **open** (memory note "plpgsql NULL
guard"). No membership means no role, never Owner.

## 6. Keeping in step with Clerk

Clerk decides who belongs to which company; BIS decides the role.

- **Invitations from BIS** are created in Clerk as `org:member` with
  `public_metadata: { bis_role, bis_language }`. On acceptance the membership webhook applies
  them.
- **Webhook** `POST /api/webhooks/clerk`, verified with the Svix signature (secret
  `CLERK_WEBHOOK_SIGNING_SECRET`), handling `user.created`, `user.updated`,
  `organizationMembership.created`, `organizationMembership.deleted`. Upserts are idempotent
  (keyed on `clerk_user_id`, and on user + account), so a replayed or out-of-order event
  converges. An event for an organisation with no `accounts` row (the agency's own org, a
  test org) is acknowledged and ignored.
- **Fallback on each request.** `requireAccountAccess` ensures the caller has a `users` row
  and a membership for the account they are entering, creating any that is missing, so a
  dropped webhook never locks anyone out. The role it creates: the invitation's `bis_role`
  when present; else **Owner** if Clerk lists the person as `org:admin` (every existing client
  login), else **Staff**. A person added in Clerk's own dashboard therefore lands as Staff
  unless made an org admin there, which only the agency can do.
- **Removal.** Removing someone deletes the Clerk membership (their token loses the org at
  the next refresh) and the BIS membership row (the role helper returns NULL at once, so the
  database refuses their writes even before the token refreshes).
- **Backfill.** A one-time script (`packages/db/scripts/`, run locally against each
  project after the migration) lists every account's Clerk memberships and upserts users and
  memberships with the fallback's rule. The fallback makes it non-critical; it exists so the
  Team screen is complete before anyone signs in.
- **Clerk's own team screen is closed to clients.** The topbar's `OrganizationSwitcher`
  (`components/topbar.tsx:104`) lets any Clerk org admin open "Manage organization" and
  invite people around BIS. For client logins it is not rendered: they have one company and
  sign-in already activates it (`lib/auth/sole-organization.ts`). The agency keeps it.

## 7. Enforcement

**The database is the boundary** for anything a client token can do directly, because the
browser holds the Clerk session token and the Supabase URL and public key are public.

- **Contact delete**: the `contacts` delete policy additionally requires
  `app.is_account_owner(account_id)`. Bulk delete goes through the same path
  (`contacts/actions.ts:165`, `deleteContacts` on `dbForRequest()`).
- **Calendar settings**: the update path behind `updateCalendarSettings` (on `dbForRequest()`,
  pinned by `booking-grants.test.ts`) gets the same owner check on its policy. Working
  bookings is unchanged for Staff.
- **Billing**: the Billing page reads plans and usage through `serviceDb()`, so its page
  guard is the gate there; any billing row a client token can select directly gets the owner
  check. The implementer lists every such table in the plan and the reviewer verifies the
  list against the live grants.
- **App guards** on top: a `requireAccountOwner(accountId)` helper built on
  `requireAccountAccess` (returns for agency or Owner; redirects Staff to their dashboard,
  never 403, same reasoning as today). Used by the Billing page, the calendar settings page
  and action, the export route, the contact delete actions and every Team action.
- **Navigation and buttons**: Billing, Team, Delete and Export are not rendered for Staff.
  Hiding is convenience; the guards and policies are the boundary.
- **Last Owner**: removing or demoting the last Owner of a company is refused in the action
  (checked inside one transaction or with a guarded `serviceDb()` write, so two Owners
  demoting each other at once cannot leave none).

## 8. The Team screen

- **Where**: for a client Owner, a **Team** link in the sidebar's pinned footer (DESIGN.md
  rule 10's footer cluster, where Settings sits for the agency). The route is
  `/dashboard/accounts/[accountId]/team`, and it becomes the client's Ajustes page when
  F-096's part lands. For the agency, the client-access card in the account's Settings
  becomes the same Team card (the invite action moves to the shared one). Registered in the
  ⌘K palette. Shown only while client access is on.
- **List**: name, email, role (dot + word, rule 3), status (Invited / Active), language;
  pending invitations listed with the role and language they will get.
- **Invite**: email, role (default Staff), language (default the account's language once the
  runtime lane adds one; English until then). One primary button for the card (rule 8).
- **Change role or language**: inline, saved at once, undo toast (rule 6).
- **Remove** and **revoke invitation**: done at once with an undo toast. Undo re-adds the
  membership through Clerk's API with the same role and language. Reversible, so no typed
  confirm (rule 6).
- **The login cap**: "Room for N more people", read from the Clerk organisation's
  `max_allowed_memberships` minus memberships and pending invitations. At zero: "Your team
  is full. Ask BIS to make room." The agency raises the cap by hand (decision 33).
- **States**: skeleton rows while loading (rule 7); empty: "Just you so far. Invite the
  people who answer your phones and run your jobs."; Clerk unreachable: the card says so and
  shows the stored list from `users`/`memberships`.
- **Copy**: English now, every string through the runtime lane's catalogue if it has merged
  first, otherwise with `.es` twins in `messages.ts` (the O-1 precedent) so the ratchet gate
  accepts it.
- **Definition of done**: both themes, the blur fallback, keyboard (row nav, Esc closes the
  invite dialog), the 7 AM read, `/styleguide` only if a new component or variant appears.

## 9. Errors

- Webhook: bad signature → 400, nothing written; unknown event type → 200, ignored; a DB
  failure → 500 so Svix retries.
- Fallback: a Clerk API failure while deciding the role creates **no** membership and lets the
  request continue with no role. Fail closed: the person can still read and work the
  company's data as today's `org_id` policies allow, but every owner-only action and policy
  refuses them until a later request creates the membership. Logged with `loggable-error`
  (no tokens or keys).
- Team actions: expected Clerk failures (already invited, already a member, cap reached)
  render in the dialog and keep it open, as the current invite does.

## 10. Rollout

1. Migration on the CI project (`ci-project-setup.yml`), then production via MCP, then the
   parity check. Never re-applied.
2. Clerk webhook endpoint on **both** instances (development for Preview and CI, production
   for production), each with its own signing secret; `CLERK_WEBHOOK_SIGNING_SECRET` in
   Vercel production (production instance's secret) and Preview (development instance's),
   and in `.env.example`. Owner step, or done through Clerk's API if it exposes webhook
   endpoints (assumption, unverified).
3. Deploy (the fallback makes order with the backfill irrelevant).
4. Backfill script against the CI project, then production.
5. Verify: each live client login has a membership with role `owner`.

## 11. Testing

Every test below must be able to fail on wrong code; each gets a mutation probe in review.

- **Database (packages/db RLS/grants suites, `withTestAccount`)**: Owner, Staff, no
  membership, a removed member and the agency, each against contact delete, calendar
  settings update and every owner-only billing read. Probe: drop the owner check from one
  policy and the Staff case must fail. A NULL-guard case: a client token with no membership
  must be refused, not allowed.
- **Grants guard**: `authenticated` has select only on memberships and users.
- **Webhook**: valid signature upserts; bad signature writes nothing; a replayed event
  converges; an unknown org is ignored.
- **Fallback**: missing rows created with the right role for each of the three sources
  (invitation metadata, `org:admin`, otherwise); Clerk down creates nothing.
- **Team actions**: last-Owner guard (including two concurrent demotions), cap reached,
  Staff calling an Owner action is redirected.
- **e2e** (per-run fixture account only, never Test Client One): a seeded Staff login sees no
  Billing, Team, Delete or Export, and a direct delete through its own token is refused; an
  Owner invites, changes a role with Undo, and removes with Undo.

## 12. Effort

About 4–6 engineer-weeks against the plan's 6–9 for S-01, because field restriction,
notifications and mentions stay later.

## 13. Open questions

None blocking. The Clerk webhook-endpoint API (§10 step 2) is an assumption to check at
implementation; if it does not exist, it is a five-minute dashboard step for the owner.
