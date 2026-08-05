# M2 Client Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client company's users sign in and work inside their own account — the same CRM the agency uses, permanently scoped to one account — while the agency admin keeps full visibility and control over every account.

**Architecture:** The account boundary is enforced twice. A role-aware guard (`requireAccountAccess`) replaces `requireAgency` on the in-account surface, and client-facing database access moves from the RLS-bypassing `serviceDb()` to a new `userDb()` that carries the caller's Clerk token so Postgres policies apply. A per-account `client_access_enabled` switch is enforced inside `app.current_account_id()`, so every existing policy inherits it from one function change.

**Tech Stack:** Next.js 16 App Router (server components + server actions), Clerk (organizations, session-token custom claims), Supabase Postgres with RLS via PostgREST, `@bis/db` workspace package, Vitest, Playwright, Tailwind v4 semantic tokens. No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-08-02-m2-client-access-design.md` — read it before Task 1.

## Global Constraints

- **The account is the only boundary.** Everything inside a client's account is theirs, except Settings and the activation checklist (spec §6.1). No field- or record-level visibility rules.
- **Absent `app_role` claim means client, not agency.** `app_role` is only ever set deliberately on an agency user's `public_metadata`. Never write code that treats a missing claim as privileged.
- **`serviceDb()` bypasses RLS.** It stays ONLY on agency-only surfaces (accounts list, Blueprints, account creation) and anonymous paths (`/f/[publicId]`, `/api/webhooks/resend`). Everything under `[accountId]/` moves to `userDb()`.
- **`accountId` on any server action is bound server-side** via `.bind(null, accountId)`, never a hidden input. M1c shipped 12 latent IDORs from exactly that mistake.
- **A `"use server"` file may export only async functions.** Sync helpers go in a sibling module.
- **Query-level faults fail loud:** check `.error` and throw an error naming which query failed. Never `?? []` on a failed query.
- **All user-visible strings from the `m` catalog** (`apps/web/src/lib/messages.ts`); semantic Tailwind tokens only, no raw colors. Design quality is first-class on this project.
- **No new npm dependencies.**
- **Five gates green before every commit**, each run as its own unpiped command. The root `package.json` has no `build`/`test:e2e` scripts, so those two run filtered:
  `pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm --filter web build` · `pnpm --filter web test:e2e`
  Piping through `grep` swallows the exit code — never do it.

### Testing notes specific to this codebase

- `withTestAccount` isolates tests by **account**. Agency-scoped state (`blueprints`) is NOT cleaned up by it — scope any such assertion by name or id. This already turned the suite red once.
- E2E timeouts scattered across *unrelated* specs usually mean a stale multi-day `node`/`next` process holding port 3000, not a real regression. Check before diagnosing.
- Do not run ad-hoc browser walkthroughs against the shared dev database. Playwright through its normal setup is fine.

---

## File Structure

**`packages/db`**
- Create `src/user-client.ts` — `userDb(token)`. Separate from `service.ts` because the two clients have opposite trust models and must never be confused at a glance.
- Create `supabase/migrations/0008_client_access.sql` — the column and the amended `app.current_account_id()`.
- Modify `src/index.ts` — export `userDb`.
- Modify `src/accounts.ts` — `setClientAccess`, `getAccountByOrgId`.
- Modify `src/test/rls.test.ts` — client identity coverage.

**`apps/web`**
- Modify `src/lib/auth.ts` — add `requireAccountAccess`, `resolveClientAccount`; keep `requireAgency` for agency-only surfaces.
- Create `src/lib/db.ts` — `dbForRequest()`, the single place a request gets its Supabase client.
- Modify `src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx` — the guard choke point.
- Modify the 7 action files under `[accountId]/`.
- Modify every page under `[accountId]/` — `serviceDb()` → `dbForRequest()`.
- Modify `src/components/app-sidebar.tsx` — role branching.
- Modify `src/app/(dashboard)/page.tsx` — route clients instead of denying them.
- Create `src/app/(dashboard)/dashboard/accounts/[accountId]/settings/client-access-panel.tsx` — switch + invites.
- Create `e2e/client-access.spec.ts`.
- Modify `src/lib/messages.ts`.

---

## Task 1: Prove the Clerk↔Supabase JWT integration

This task exists to fail fast. Nothing else in the plan works if a Clerk token cannot authenticate to Supabase with the claims our policies read. Build the smallest thing that proves it end to end, against the live database.

**Files:**
- Create: `packages/db/src/user-client.ts`
- Create: `packages/db/src/test/user-client.integration.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `userDb(accessToken: string): SupabaseClient` — a Supabase client that sends the caller's Clerk token as the `Authorization` bearer, so PostgREST populates `request.jwt.claims` and RLS applies.

**Background you need:** `app.jwt()` (`packages/db/supabase/migrations/0001_tenancy.sql:4-7`) reads `current_setting('request.jwt.claims')`. `app.is_agency()` reads `app_role` from it. `app.current_account_id()` reads `org_id`. Those two claims are already configured as Clerk session-token custom claims. `packages/db/src/test/db.ts` proves the policies work by forging exactly those claims via `set_config`.

- [ ] **Step 1: Determine how this Supabase project accepts Clerk tokens**

Supabase supports Clerk as a third-party auth provider. Determine whether it is already configured for project `tlbkbmlrfafquucsmsmm`, and if not, configure it to trust the Clerk instance's JWKS at `https://topical-redfish-40.clerk.accounts.dev/.well-known/jwks.json`.

You may use the Supabase management API or MCP tools. **If this step requires dashboard access you do not have, STOP and report NEEDS_CONTEXT with the exact steps the owner must perform.** Do not fake it, and do not fall back to embedding a service key.

Record in your report which mechanism this project uses.

- [ ] **Step 2: Write the failing integration test**

This is an integration test against the live dev database, not a unit test. It needs a real Clerk token. Mint one with the Clerk Backend API (`sk` is in `packages/db/.env`) for the existing dev user, whose org is `Test Client One`.

Create `packages/db/src/test/user-client.integration.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { userDb } from "../user-client";

/** Mints a real Clerk session token for the dev user. */
async function mintToken(): Promise<string> {
  const sk = process.env.CLERK_SECRET_KEY;
  if (!sk) throw new Error("CLERK_SECRET_KEY missing");
  // Look up the dev user, create a session, then mint a token for it.
  // Clerk Backend API: POST /v1/sessions  then  POST /v1/sessions/{id}/tokens
  // Implement against the live API; do not stub.
  throw new Error("not implemented");
}

describe("userDb", () => {
  it("reads only the caller's own account", async () => {
    const token = await mintToken();
    const db = userDb(token);
    const { data, error } = await db.from("accounts").select("id, name");
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].name).toBe("Test Client One");
  });
});
```

If minting a session token for an existing user proves impractical against Clerk's API, an acceptable substitute is to drive a real sign-in through Playwright and extract the token — but say so in your report rather than weakening the assertion.

- [ ] **Step 3: Run it and watch it fail**

Run: `pnpm --filter @bis/db test -- src/test/user-client.integration.test.ts`
Expected: FAIL — `userDb` does not exist yet.

- [ ] **Step 4: Implement `userDb`**

Create `packages/db/src/user-client.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client authenticated as the CALLING USER. RLS applies.
 *
 * Contrast with serviceDb(), which bypasses RLS entirely. Use this for any
 * surface a client user can reach — the database is the backstop that turns a
 * missed account scope into zero rows instead of another tenant's data.
 */
export function userDb(accessToken: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error("Supabase url/anon env vars missing");
  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
```

If `NEXT_PUBLIC_SUPABASE_ANON_KEY` is not present in `packages/db/.env` or `apps/web/.env.local`, add it — it is a publishable key, not a secret.

- [ ] **Step 5: Export it**

In `packages/db/src/index.ts`, beneath the existing `serviceDb` export:

```ts
export { userDb } from "./user-client";
```

- [ ] **Step 6: Run the test and watch it pass**

Run: `pnpm --filter @bis/db test -- src/test/user-client.integration.test.ts`
Expected: PASS — one account row, `Test Client One`.

**This passing is the milestone's go/no-go.** If it cannot pass, report BLOCKED with what you observed rather than proceeding.

- [ ] **Step 7: Gates and commit**

Run each on its own: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

```bash
git add packages/db/src/user-client.ts packages/db/src/index.ts packages/db/src/test/user-client.integration.test.ts
git commit -m "feat(db): userDb — RLS-enforcing Supabase client carrying the caller's Clerk token"
```

---

## Task 2: Migration 0008 — the client access switch, enforced in Postgres

**Files:**
- Create: `packages/db/supabase/migrations/0008_client_access.sql`
- Modify: `packages/db/src/accounts.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/test/rls.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - `setClientAccess(db: SupabaseClient, accountId: string, enabled: boolean, actorId: string): Promise<void>`
  - `getAccountByOrgId(db: SupabaseClient, clerkOrgId: string): Promise<{ id: string; name: string; client_access_enabled: boolean } | null>`

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0008_client_access.sql`:

```sql
-- Client access is off for every existing account, so shipping M2 changes
-- nothing for the agency on day one.
alter table public.accounts
  add column client_access_enabled boolean not null default false;

-- The switch is enforced in Postgres, not only in the UI. Every tenant policy
-- reads through this function, so all of them inherit the flag from this one
-- change, and a policy added later inherits it without anyone remembering to.
--
-- Agency access is unaffected: policies are
--   app.is_agency() or account_id = app.current_account_id()
-- and is_agency() short-circuits before this branch is evaluated.
create or replace function app.current_account_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.accounts
  where clerk_org_id = app.jwt()->>'org_id'
    and client_access_enabled
$$;
```

- [ ] **Step 2: Apply it to the dev database**

Apply via the same mechanism migrations 0001–0007 were applied with. Confirm by querying `information_schema.columns` for `accounts.client_access_enabled`.

- [ ] **Step 3: Write the failing RLS tests**

Append to `packages/db/src/test/rls.test.ts`, following the file's existing `withRollback`/`actAs` conventions:

```ts
it("a client sees its own account only when client access is enabled", async () => {
  await withRollback(async (c) => {
    await actAsOwner(c);
    const { rows: [agency] } = await c.query(
      "insert into public.agencies (name) values ('T') returning id",
    );
    const { rows: [mine] } = await c.query(
      `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
       values ($1, 'org_mine', 'Mine', true) returning id`, [agency.id],
    );
    const { rows: [theirs] } = await c.query(
      `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
       values ($1, 'org_theirs', 'Theirs', true) returning id`, [agency.id],
    );
    await c.query(
      `insert into public.contacts (account_id, first_name) values ($1,'A'), ($2,'B')`,
      [mine.id, theirs.id],
    );

    await actAs(c, { org_id: "org_mine" });
    const { rows } = await c.query("select account_id from public.contacts");
    expect(rows).toHaveLength(1);
    expect(rows[0].account_id).toBe(mine.id);
    expect(rows.map((r) => r.account_id)).not.toContain(theirs.id);
  });
});

it("a client sees nothing when client access is disabled", async () => {
  await withRollback(async (c) => {
    await actAsOwner(c);
    const { rows: [agency] } = await c.query(
      "insert into public.agencies (name) values ('T') returning id",
    );
    const { rows: [acct] } = await c.query(
      `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
       values ($1, 'org_off', 'Off', false) returning id`, [agency.id],
    );
    await c.query("insert into public.contacts (account_id, first_name) values ($1,'A')", [acct.id]);

    await actAs(c, { org_id: "org_off" });
    const { rows } = await c.query("select id from public.contacts");
    expect(rows).toHaveLength(0);
  });
});

it("the agency still sees every account regardless of the flag", async () => {
  await withRollback(async (c) => {
    await actAsOwner(c);
    const { rows: [agency] } = await c.query(
      "insert into public.agencies (name) values ('T') returning id",
    );
    const { rows: [acct] } = await c.query(
      `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
       values ($1, 'org_off2', 'Off', false) returning id`, [agency.id],
    );
    await c.query("insert into public.contacts (account_id, first_name) values ($1,'A')", [acct.id]);

    await actAs(c, { app_role: "agency_admin" });
    const { rows } = await c.query("select account_id from public.contacts");
    expect(rows.map((r) => r.account_id)).toContain(acct.id);
  });
});
```

The second test is the one that matters most: it is what proves the switch is real in the database rather than cosmetic.

- [ ] **Step 4: Run them and watch the second fail**

Run: `pnpm --filter @bis/db test -- src/test/rls.test.ts`
Expected before the migration is applied: the "disabled" test FAILS (rows are visible). After Step 2, all three PASS. If the disabled test passes *before* the migration, your migration did not apply — investigate rather than proceeding.

- [ ] **Step 5: Add the two service functions**

In `packages/db/src/accounts.ts`:

```ts
export async function setClientAccess(
  db: SupabaseClient, accountId: string, enabled: boolean, actorId: string,
): Promise<void> {
  const { error } = await db.from("accounts")
    .update({ client_access_enabled: enabled }).eq("id", accountId);
  if (error) throw new Error(`setClientAccess failed: ${error.message}`);
  await emit(db, accountId, enabled ? "account.client_access_enabled" : "account.client_access_disabled", actorId, {});
}

export async function getAccountByOrgId(
  db: SupabaseClient, clerkOrgId: string,
): Promise<{ id: string; name: string; client_access_enabled: boolean } | null> {
  const { data, error } = await db.from("accounts")
    .select("id, name, client_access_enabled").eq("clerk_org_id", clerkOrgId).maybeSingle();
  if (error) throw new Error(`getAccountByOrgId failed: ${error.message}`);
  return data ?? null;
}
```

Export both from `packages/db/src/index.ts` by extending the existing `./accounts` export line.

- [ ] **Step 6: Gates and commit**

Run each on its own: `pnpm typecheck`, `pnpm lint`, `pnpm test`.

```bash
git add packages/db
git commit -m "feat(db): per-account client access switch, enforced inside current_account_id()"
```

---

## Task 3: The guard, request-scoped client selection, and Clerk settings

**Files:**
- Modify: `apps/web/src/lib/auth.ts`
- Create: `apps/web/src/lib/db.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx`
- Modify: `apps/web/src/app/(dashboard)/page.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `getAccountByOrgId`, `userDb` (Tasks 1–2).
- Produces:
  - `requireAccountAccess(accountId: string): Promise<{ userId: string; isAgency: boolean }>`
  - `resolveClientAccount(): Promise<{ id: string; name: string } | null>`
  - `dbForRequest(): Promise<SupabaseClient>` — returns a `userDb` bound to the caller's Clerk token.

- [ ] **Step 1: Add the message strings**

In `apps/web/src/lib/messages.ts`:

```ts
"clientAccess.off.title": "Access has been turned off",
"clientAccess.off.body": "Your access to this account has been turned off. Contact your account manager if you think this is a mistake.",
"clientAccess.none.title": "No account linked",
"clientAccess.none.body": "Your sign-in isn't linked to a company account yet. Contact your account manager.",
```

- [ ] **Step 2: Add `dbForRequest`**

Create `apps/web/src/lib/db.ts`:

```ts
import { auth } from "@clerk/nextjs/server";
import { userDb } from "@bis/db";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Supabase client for anything a signed-in human can reach.
 *
 * RLS applies. Do NOT reach for serviceDb() on the in-account surface — the
 * database backstop is what turns a missed account scope into zero rows
 * instead of another tenant's data.
 */
export async function dbForRequest(): Promise<SupabaseClient> {
  const { getToken } = await auth();
  const token = await getToken();
  if (!token) throw new Error("dbForRequest: no Clerk token on this request");
  return userDb(token);
}
```

- [ ] **Step 3: Add the guard**

In `apps/web/src/lib/auth.ts`, keeping `requireAgency` as-is:

```ts
import { serviceDb, getAccountByOrgId } from "@bis/db";

/**
 * Allows the agency admin into any account, and a client into exactly one —
 * their own, and only while its client access is on.
 *
 * Uses serviceDb deliberately: this runs BEFORE we trust the caller, so it
 * must be able to see the account row in order to judge it.
 */
export async function requireAccountAccess(
  accountId: string,
): Promise<{ userId: string; isAgency: boolean }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");
  const claims = sessionClaims as AppClaims;

  if (claims.app_role === "agency_admin") return { userId, isAgency: true };

  if (!claims.org_id) redirect("/no-access?reason=none");
  const account = await getAccountByOrgId(serviceDb(), claims.org_id);
  if (!account) redirect("/no-access?reason=none");
  if (!account.client_access_enabled) redirect("/no-access?reason=off");
  // A client asking for someone else's account is sent to their own, not 403'd
  // — a 403 confirms the account exists.
  if (account.id !== accountId) redirect(`/dashboard/accounts/${account.id}/dashboard`);

  return { userId, isAgency: false };
}

/** The client's own account, or null for the agency admin / an unlinked user. */
export async function resolveClientAccount(): Promise<{ id: string; name: string } | null> {
  const { sessionClaims } = await auth();
  const claims = sessionClaims as AppClaims;
  if (claims?.app_role === "agency_admin" || !claims?.org_id) return null;
  const account = await getAccountByOrgId(serviceDb(), claims.org_id);
  if (!account || !account.client_access_enabled) return null;
  return { id: account.id, name: account.name };
}
```

- [ ] **Step 4: Create the no-access page**

Create `apps/web/src/app/no-access/page.tsx`:

```tsx
import { SignOutButton } from "@clerk/nextjs";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { m } from "@/lib/messages";

export default async function NoAccess({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const off = reason === "off";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="flex w-full max-w-sm flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-8">
        <ShieldAlert className="size-8 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">
          {off ? m["clientAccess.off.title"] : m["clientAccess.none.title"]}
        </p>
        <p className="text-sm text-muted-foreground">
          {off ? m["clientAccess.off.body"] : m["clientAccess.none.body"]}
        </p>
        <SignOutButton>
          <Button variant="outline">{m["landing.signOut"]}</Button>
        </SignOutButton>
      </div>
    </main>
  );
}
```

`m["landing.signOut"]` already exists — reuse it rather than adding a duplicate string.

**Why this page matters:** without it, a client whose access was revoked hits RLS returning zero rows and sees an empty but fully functional CRM — every page loads, everything blank. That reads as "our data was deleted."

- [ ] **Step 5: Swap the guard at the choke point**

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx` currently calls `requireAgency()` and reads the account with `serviceDb()`. Replace:

```tsx
import { notFound } from "next/navigation";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";

export default async function AccountWorkspaceLayout({
  children, params,
}: { children: React.ReactNode; params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const { data: account, error } = await db
    .from("accounts").select("id, name").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`account lookup failed: ${error.message}`);
  if (!account) notFound();
  return <>{children}</>;
}
```

Note the ordering change: `params` is awaited first, because the guard needs `accountId`.

- [ ] **Step 6: Route clients from the dashboard root**

In `apps/web/src/app/(dashboard)/page.tsx`, the current `hasAccess` check denies anyone who is not `agency_admin`. Before rendering, resolve a client account and redirect:

```tsx
const clientAccount = await resolveClientAccount();
if (clientAccount) redirect(`/dashboard/accounts/${clientAccount.id}/dashboard`);
```

Keep the existing no-access block for a signed-in user who is neither agency nor a linked client.

- [ ] **Step 7: Apply the four Clerk instance settings**

These are doable via the Clerk Backend API with the `sk` in `packages/db/.env` — `PATCH https://api.clerk.com/v1/instance/organization_settings`. Set:

- `force_organization_selection` → `false`
- `organization_creation_defaults.enabled` → `false`
- `admin_delete_enabled` → `false`

Leave `max_allowed_memberships` at `5`.

Verify by re-reading `GET /v1/instance/organization_settings` and record the before/after in your report. **Do not change anything else on the instance.**

`auth.setup.ts` currently clicks through the org-selection screen; once `force_organization_selection` is false that branch should become dead. Leave the code in place — it is harmless and guards against the setting being re-enabled — but note in your report whether the branch still fires.

- [ ] **Step 8: Gates and commit**

Run each on its own: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter web build`.

```bash
git add apps/web/src/lib apps/web/src/app
git commit -m "feat(web): role-aware account guard, request-scoped RLS client, no-access page"
```

---

## Task 4: Move the in-account pages onto `userDb`

**Files:**
- Modify: every page under `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/` that calls `serviceDb()`.

**Interfaces:**
- Consumes: `dbForRequest()` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Enumerate the pages**

Run: `grep -rln "serviceDb" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]"`

Work through every `page.tsx` in that list. Leave the 7 action files for Task 5.

- [ ] **Step 2: Convert each page**

Mechanical: replace `serviceDb()` with `await dbForRequest()` and its import. The queries themselves do not change — RLS applies underneath, and `is_agency()` passes the agency through the same policies, so the agency's own experience is unchanged.

**Where a page reads across accounts** (if any do), that read must stay on `serviceDb()` — but flag it in your report, because on the in-account surface a cross-account read is a design smell worth the owner seeing.

- [ ] **Step 3: Verify the agency path still works**

Run: `pnpm --filter web build`, then `pnpm --filter web test:e2e`.

The existing agency E2E is the regression signal here: it exercises these exact pages as the agency admin. It must pass unchanged.

- [ ] **Step 4: Gates and commit**

Run each on its own: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter web build`, `pnpm --filter web test:e2e`.

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]"
git commit -m "refactor(web): in-account pages read through the RLS-enforcing client"
```

---

## Task 5: Move the 21 in-account server actions onto `userDb` and the new guard

**Files:**
- Modify: `checklist/actions.ts`, `contacts/actions.ts`, `contacts/[contactId]/actions.ts`, `conversations/actions.ts`, `forms/actions.ts`, `pipeline/actions.ts`, `settings/actions.ts` — all under `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`.

**Interfaces:**
- Consumes: `requireAccountAccess`, `dbForRequest` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Convert each action**

For every exported action in those 7 files:

1. Replace `await requireAgency()` with `await requireAccountAccess(accountId)`. Every one of these actions already receives `accountId` as its server-bound first parameter — confirm that before changing it, and if any action does not, STOP and report it, because that is an IDOR.
2. Replace `serviceDb()` with `await dbForRequest()`.

Writes now pass through RLS `with check`, so an action that tries to write outside the caller's account fails at the database rather than succeeding silently.

- [ ] **Step 2: Confirm no action takes `accountId` from the client**

Run: `grep -rn "formData.get(\"accountId\")\|formData.get('accountId')" apps/web/src`
Expected: no matches. If there are any, that is a live IDOR — report it rather than quietly fixing it, so the owner sees it.

- [ ] **Step 3: Verify writes still work as the agency**

Run: `pnpm --filter web test:e2e`. The existing specs create contacts, drag opportunities, and send email — all through these actions, as the agency. All must pass unchanged.

- [ ] **Step 4: Gates and commit**

Run each on its own: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter web build`, `pnpm --filter web test:e2e`.

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]"
git commit -m "refactor(web): in-account actions guard by account access and write through RLS"
```

---

## Task 6: Role-branched UI

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/layout.tsx` — this is where `AppSidebar` is rendered, so this is where `isAgency` must be resolved and passed down. (Not `(dashboard)/layout.tsx`, which is the root layout holding `ClerkProvider`.)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx`
- Modify: any topbar component rendering the account switcher

**Interfaces:**
- Consumes: `requireAccountAccess`'s `isAgency`, `resolveClientAccount` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Branch the sidebar**

`app-sidebar.tsx` currently derives its nav from whether the path is inside an account (`base` truthy). It needs a second input: whether the viewer is the agency. Thread an `isAgency: boolean` prop from the layout.

For a client (`isAgency === false`), inside an account:
- Keep the six items: Dashboard, Contacts, Opportunities, Conversations, Forms, Calendar.
- Drop the `backToAgency` item entirely.
- Drop the Settings footer item — replace with nothing, since a client has no agency scope to return to.

The agency's rendering must be byte-identical to today.

- [ ] **Step 2: Hide the account switcher for clients**

Find the topbar account switcher (`grep -rln "switcher\|Switcher" apps/web/src/components`) and render it only when `isAgency`.

- [ ] **Step 3: Hide the activation checklist panel for clients**

In `[accountId]/dashboard/page.tsx`, the checklist panel currently renders whenever `checklistRemaining > 0`, plus a completed-state link. Both are agency-only — the checklist is the agency's onboarding worklist, and its copy explicitly says its items are performed elsewhere. Gate both on `isAgency`.

- [ ] **Step 4: Verify the agency UI is unchanged**

Run: `pnpm --filter web test:e2e`. `shell.spec.ts` asserts sidebar behavior and the account switcher; it must pass unchanged.

- [ ] **Step 5: Gates and commit**

Run each on its own: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter web build`, `pnpm --filter web test:e2e`.

```bash
git add apps/web/src/components "apps/web/src/app/(dashboard)"
git commit -m "feat(web): client-scoped navigation with no agency chrome"
```

---

## Task 7: The client access switch and invites

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/client-access-panel.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `setClientAccess` (Task 2), `requireAccountAccess` (Task 3).
- Produces: nothing later tasks rely on.

- [ ] **Step 1: Add the message strings**

```ts
"clientAccess.title": "Client access",
"clientAccess.body": "When on, invited users at this company can sign in and see this account only.",
"clientAccess.enable": "Turn on",
"clientAccess.disable": "Turn off",
"clientAccess.members": "Members",
"clientAccess.invite": "Invite",
"clientAccess.inviteEmail": "Email address",
"clientAccess.inviteSent": "Invitation sent",
"clientAccess.inviteFailed": "Could not send the invitation",
"clientAccess.disabledHint": "Turn client access on before inviting anyone.",
```

- [ ] **Step 2: Add the server actions**

In `settings/actions.ts` — both async, both taking `accountId` server-bound first:

```ts
export async function setClientAccessAction(accountId: string, formData: FormData) {
  const { userId } = await requireAccountAccess(accountId);
  const enabled = formData.get("enabled") === "true";
  await setClientAccess(serviceDb(), accountId, enabled, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}
```

`setClientAccessAction` uses `serviceDb()` deliberately: it writes the very flag that `app.current_account_id()` reads, so an RLS-scoped client would be unable to turn access back *on*. Guard it so only the agency may call it — check the `isAgency` flag `requireAccountAccess` returns and throw if false.

And the invite action, in the same file:

```ts
export async function inviteClientAdminAction(
  accountId: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) throw new Error("only the agency may invite client users");

  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { ok: false, error: m["clientAccess.inviteFailed"] };

  const db = serviceDb();
  const { data: account, error } = await db.from("accounts")
    .select("clerk_org_id, client_access_enabled").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`invite: account lookup failed: ${error.message}`);
  if (!account) throw new Error("invite: account not found");
  if (!account.client_access_enabled) {
    return { ok: false, error: m["clientAccess.disabledHint"] };
  }

  const res = await fetch(
    `https://api.clerk.com/v1/organizations/${account.clerk_org_id}/invitations`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: email,
        role: "org:admin",
        inviter_user_id: userId,
      }),
    },
  );
  if (!res.ok) {
    // Expected failures (already invited, already a member, seat limit) are
    // rendered, not thrown — the dialog shows them and stays open.
    console.error("clerk invite failed", res.status, await res.text());
    return { ok: false, error: m["clientAccess.inviteFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}
```

Note `max_allowed_memberships: 5` on the Clerk instance — a sixth invite will fail here, and the rendered error is how the agency finds out.

- [ ] **Step 3: Build the panel**

`client-access-panel.tsx` — the switch, its explanatory body copy, a member list, and an invite control disabled with `clientAccess.disabledHint` while access is off. Semantic tokens only, all strings from `m`. Match the visual structure of the existing settings panels in that directory.

Mount it in `settings/page.tsx`, binding `accountId` server-side via `.bind(null, accountId)`.

- [ ] **Step 4: Gates and commit**

Run each on its own: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter web build`, `pnpm --filter web test:e2e`.

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings" apps/web/src/lib/messages.ts
git commit -m "feat(web): per-account client access switch and client admin invites"
```

---

## Task 8: End-to-end coverage and the final gate

**Files:**
- Create: `apps/web/e2e/client-access.spec.ts`
- Modify: `apps/web/e2e/auth.setup.ts` (a second storage state)

**Interfaces:**
- Consumes: everything above.
- Produces: the milestone's evidence.

- [ ] **Step 1: Seed a client identity**

The suite currently authenticates one agency user. Add a second storage state for a client user: a Clerk user with **no** `app_role` in `public_metadata`, a member of a second seeded account's org, with that account's `client_access_enabled` set true.

Creating this fixture is the bulk of this task. Follow `auth.setup.ts`'s existing pattern and keep both states isolated.

- [ ] **Step 2: Write the spec**

`client-access.spec.ts` must assert, as the client:

1. Signing in lands on their own account's dashboard — not the accounts list.
2. The sidebar shows exactly the six items, and **no** "Back to agency", Blueprints, Settings, or account switcher.
3. Navigating to *another* account's URL redirects to their own account, and the other account's data never renders.
4. The activation checklist panel does not appear on their dashboard.
5. With `client_access_enabled` flipped false, they get the no-access page — **not** an empty CRM.

Assertion 5 is the one that proves §3.3 and §8 of the spec. Make it fail if the flag stops being enforced.

Clean up in a `finally`: delete seeded rows **and** the Clerk org, and make a cleanup failure unable to mask a real assertion failure. An earlier milestone leaked orgs into the shared Clerk instance on every run.

- [ ] **Step 3: Prove each assertion can fail**

For assertions 3 and 5 especially, temporarily break the production code and confirm the assertion goes red, then revert. Report what you did. An assertion that cannot fail is worse than none — this suite is the only automated proof that one client cannot read another's data.

- [ ] **Step 4: Run all five gates**

Each as its own unpiped command:
`pnpm typecheck` · `pnpm lint` · `pnpm test` · `pnpm --filter web build` · `pnpm --filter web test:e2e`

Capture the real output of each. If a gate is red, diagnose the cause — do not weaken a test to make it pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e
git commit -m "test(e2e): a client sees only their account, and nothing when access is off"
```

---

## Self-Review

**Spec coverage.** §2 roles → Tasks 3, 8. §3.1 column → Task 2. §3.2 guard → Task 3. §3.3 Postgres-enforced switch → Task 2 (migration) + Task 2 Step 3 (the test that proves it). §3.4 sign-in routing → Task 3 Step 6. §4 Clerk settings → Task 3 Step 7. §5.1 the userDb/serviceDb line → Tasks 4, 5. §5.2 userDb → Task 1. §6 UI → Task 6. §6.1 Settings and checklist agency-only → Task 6 Steps 1, 3. §7 invites → Task 7. §8 failure modes → Task 3 Step 4 (no-access page), Task 8 assertion 5. §9 sequencing → Task 1 stands alone. §10 testing → Tasks 2, 8. §11 rollout → default `false` in Task 2.

**Type consistency, checked:** `requireAccountAccess` returns `{ userId, isAgency }` and is destructured that way in Tasks 6 and 7. `resolveClientAccount` returns `{ id, name } | null`; Task 3 Step 6 reads `.id`. `getAccountByOrgId` returns `{ id, name, client_access_enabled } | null`; both callers in Task 3 read those exact fields. `dbForRequest()` returns a promise and is always awaited. `setClientAccess(db, accountId, enabled, actorId)` matches its Task 7 call site. `userDb(accessToken)` matches `userDb(token)`.

**Known gaps, deliberately left — each is a place the implementer must think rather than transcribe:**
- **Task 1 Step 1** may require Supabase dashboard access the implementer does not have. It is instructed to STOP and report rather than improvise. This is the milestone's principal unknown, and is why it is Task 1 and why it stands alone.
- **Task 1 Step 2's `mintToken`** is deliberately left as `throw new Error("not implemented")`. The right Clerk Backend API path for minting a session token for an existing user is not settled, and guessing it here would send the implementer down a wrong path with false confidence. The step names the two candidate endpoints and an acceptable Playwright fallback.
- **Task 7 Step 3's panel** and **Task 8 Steps 1–2's client fixture** are specified by behavior and constraints rather than by code. The fixture in particular depends on what Task 1 establishes about tokens, and the panel should match sibling settings panels the implementer can read. Both are called out as the bulk of their task.
- The `memberships` table stays unused (spec §7). No task touches it.
- Agency-only surfaces stay on `serviceDb()` with no database backstop (spec §5.1). That is the deliberate line, not a staging post.
