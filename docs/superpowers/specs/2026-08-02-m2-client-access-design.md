# M2 Client Access — Design

**Goal:** A client company's users sign in and work in their own account — the same CRM the agency uses, permanently scoped to one account. The agency admin keeps full visibility and control over every account.

**Status:** Approved 2026-08-02. Supersedes nothing; extends the M0 tenancy spine.

---

## 1. Why this is different from every milestone before it

M0 through M1d shipped an agency-only application. Every signed-in user was the agency admin, so the tenancy model was never load-bearing at runtime: all 29 database-touching files use `serviceDb()`, the service-role client, which bypasses RLS by design.

M2 admits a second audience. From the moment a client can sign in, the account boundary stops being tidiness and becomes a security boundary — the thing standing between one client company's data and another's. M1c shipped 12 latent IDORs from client-supplied ids reaching a service-role client. This milestone is where that class of mistake becomes a cross-tenant leak rather than a bug.

That is the reasoning behind every decision below: **the boundary is enforced twice, in the guard and in the database, so that a coding mistake yields zero rows rather than someone else's company.**

## 2. Roles

| | `agency_admin` | client user |
|---|---|---|
| Claim | `app_role = "agency_admin"` from `user.public_metadata` | claim absent |
| Sees | every account | one account |
| Scoped by | nothing — `app.is_agency()` short-circuits | active Clerk org → `accounts.clerk_org_id` |

**Absent claim means client.** `app_role` is only ever set deliberately on an agency user's public metadata, so an invited or mis-provisioned user is a client by default. The model fails closed.

## 3. The access boundary

### 3.1 New column

```sql
alter table public.accounts
  add column client_access_enabled boolean not null default false;
```

Off for every existing account, so shipping M2 changes nothing for the agency on day one.

### 3.2 The guard

`requireAgency()` is replaced by `requireAccountAccess(accountId)` at its **8 call sites under `[accountId]/`**:

- `layout.tsx` — the shared layout, which guards *every* page in the subtree at one choke point. Individual pages do not guard themselves.
- 7 action files: `checklist/`, `contacts/`, `contacts/[contactId]/`, `conversations/`, `forms/`, `pipeline/`, `settings/`.

The rule it enforces:

```
agency_admin → allow
client       → allow only if accounts.clerk_org_id = claims.org_id
                        and accounts.client_access_enabled
otherwise    → redirect
```

`requireAgency()` itself survives for agency-only surfaces (accounts list, Blueprints, account creation).

### 3.3 The switch is enforced in Postgres, not only in the UI

`app.current_account_id()` is amended to resolve an account **only when its client access is enabled**:

```sql
create or replace function app.current_account_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.accounts
  where clerk_org_id = app.jwt()->>'org_id'
    and client_access_enabled
$$;
```

Every tenant policy reads through this function, with one exception: `accounts_member_read` (0001_tenancy.sql) matched on the org claim directly --

```sql
create policy accounts_member_read on public.accounts
  for select to authenticated using (clerk_org_id = app.jwt()->>'org_id');
```

-- rather than through `app.current_account_id()`, so it did not inherit the switch from the change above. Migration `0009_accounts_member_read_client_access.sql` brings it into line by adding the same gate directly to that policy:

```sql
create policy accounts_member_read on public.accounts
  for select to authenticated
  using (clerk_org_id = app.jwt()->>'org_id' and client_access_enabled);
```

With that fix, every tenant policy -- either through `app.current_account_id()` or, for this one exception, an explicit `client_access_enabled` check -- inherits the switch. Flipping a client off cuts their database access, rather than merely hiding a page.

Agency access is unaffected: policies are `app.is_agency() or account_id = app.current_account_id()`, and `is_agency()` short-circuits before the second branch is evaluated.

**Why the flag lives here rather than in each policy:** one function is one place to get right, and a policy added later inherits the behavior without anyone remembering to add it.

### 3.4 Sign-in routing

The dashboard root resolves by role: `agency_admin` → `/dashboard/accounts` (unchanged); client → `/dashboard/accounts/<their account>/dashboard`.

## 4. Clerk instance changes

Read from instance `ins_3H2OiMYht2PN87C3GnBytXfUAoY` on 2026-08-02.

| Setting | Now | Change to | Why |
|---|---|---|---|
| `force_organization_selection` | `true` | `false` | Instance-wide and **cannot be made role-conditional** — Clerk has no notion of `app_role`. It currently interrupts the agency admin, who should never be scoped to one org. The app sets a client's active organization itself; a client normally belongs to exactly one, so there is nothing to ask. |
| `organization_creation_defaults.enabled` | `true` | `false` | A client user could otherwise create their own organization, producing a Clerk org with no matching `accounts` row — an orphan outside agency control. |
| `admin_delete_enabled` | `true` | `false` | A client admin should not be able to delete their own company. |
| `max_allowed_memberships` | `5` | unchanged | A plan limit, not a design choice. Raise when a client outgrows it. |

This is a **development** instance (`environment_type: "development"`), and the deployed site at `bis-platform-six.vercel.app` serves a `pk_test` key for this same instance. There is no separate production Clerk instance yet. These settings must be reapplied when production credentials are stood up at launch.

## 5. Data access

### 5.1 Two clients, one mechanical rule

| Surface | Client | Rationale |
|---|---|---|
| Every page under `[accountId]/`, and the 21 server actions across its 7 action files | **`userDb()`** — carries the caller's Clerk token, RLS applies | Both audiences reach these. `is_agency()` passes the agency through the same policies. |
| Agency-only: accounts list, Blueprints, account creation | `serviceDb()` | No client can reach them; account creation writes before any org exists. |
| Anonymous: `/f/[publicId]`, `/api/webhooks/resend` | `serviceDb()` | No user token exists to carry. |

The rule: **if a signed-in human can reach it and a client might be that human, RLS enforces it.**

This is deliberately mechanical. "Which client goes here?" as a judgment call is precisely what produced M1c's 12 IDORs.

### 5.2 `userDb()`

A Supabase client constructed with the caller's Clerk session token, relying on Supabase's third-party auth integration with Clerk. Postgres receives the token's claims at `request.jwt.claims`, which is what `app.jwt()` already reads.

**The RLS half is already built.** The policies exist, `app.jwt()` reads `request.jwt.claims`, and the claims the policies expect (`org_id`, `app_role`) are already the Clerk session-token custom claims configured in M0. `rls.test.ts` proves the policies work by forging exactly those claims. The only missing piece is configuring Supabase to trust Clerk's JWKS and creating a client that sends the token.

**This is the milestone's principal unknown** and is sequenced first (§9).

## 6. UI

One rendering of every page — no client-specific copies, so a client's Contacts screen cannot drift from the agency's.

- **Sidebar** branches on role. A client sees the six in-account items: Dashboard, Contacts, Opportunities, Conversations, Forms, Calendar. No "Back to agency", no Blueprints, no account switcher in the topbar.
- **`(dashboard)/page.tsx`** currently denies anyone who is not `agency_admin`; it routes clients to their account instead.

### 6.1 Agency-only within an account

Two surfaces sit inside an account but are agency work *about* the client rather than client data:

- **Settings** — holds "Save as blueprint", custom-field configuration, and the client-access switch itself. A client toggling their own access off would lock themselves out.
- **The activation checklist** — the agency's onboarding worklist, whose copy explicitly states its items are performed elsewhere. It renders as a panel on the account dashboard, so it is the one agency-only thing a client would otherwise encounter on a page they are entitled to. The panel is hidden for clients.

## 7. Invites and membership

- The agency invites a client admin from the account's page: a Clerk org invitation with role `org:admin`.
- That admin invites colleagues as `org:member`.
- Invites are refused while `client_access_enabled` is off.
- Subject to `max_allowed_memberships: 5` (§4).

**No Clerk→Postgres member sync.** RLS depends only on the `org_id` claim in the token, so nothing needs mirroring. The `memberships` table stays unused; a webhook that exists only to maintain a copy of something no policy reads is not worth its failure modes.

## 8. Failure modes

| Situation | Behavior | Why |
|---|---|---|
| Client access flipped off mid-session | Guard shows an explicit "access has been turned off" page | **Without this, RLS returns zero rows and the client sees an empty but fully functional CRM** — every page loads, everything blank. That reads as "our data was deleted," which is worse than an error. |
| Client requests another account's URL | Redirect to their own account | A 403 confirms the account exists. |
| Client's org maps to no account | Explicit no-access page | Distinguishes a provisioning gap from a data problem. |
| Query written without account scoping | Zero rows | RLS is the backstop; the mistake degrades to empty, never to a leak. |

## 9. Sequencing

**Task 1 stands alone: prove the Clerk↔Supabase JWT integration end to end.** Configure Supabase to trust Clerk's JWKS, build `userDb()`, and demonstrate a real client token reading its own account's rows and failing to read another's — against the live database, not a forged-claims test.

If third-party auth does not behave as expected with these claims, that must surface on day one, not after 21 server actions have been converted.

Everything else follows: the migration and guard, the `userDb()` conversion, UI role-branching, invites, then tests and rollout.

## 10. Testing

- **`rls.test.ts`** gains a client identity: reads its own account across every tenant table, cannot read another's, and — the new assertion — **cannot read anything when `client_access_enabled` is false**. That last one is what proves §3.3 is real rather than cosmetic.
- **E2E**: a client signs in, sees six nav items and no agency chrome, and is bounced when typing another account's URL. Requires a second seeded account and a client user — genuine fixture work, not a line of setup.
- **The existing agency E2E must pass unchanged.** It is the regression signal that converting 21 actions to `userDb()` did not break the agency's own use of the same pages.

## 11. Rollout

Ships with `client_access_enabled` false on every account — day one changes nothing for the agency. Then one pilot client, with the switch as the way back if anything looks wrong.

## 12. Out of scope

- Field- or record-level visibility. The account is the only boundary; everything inside a client's account is theirs (except §6.1).
- Client-facing billing, branding, or a custom domain.
- Migrating agency-only surfaces off `serviceDb()`. The line in §5.1 is deliberate, not a staging post.
- Raising `max_allowed_memberships`, which is a plan change rather than a code change.
