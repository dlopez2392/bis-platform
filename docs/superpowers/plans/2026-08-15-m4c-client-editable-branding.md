# M4c Client-Editable Branding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client signed into their own workspace can change their brand name, logo, colour and four theme controls, without the agency doing it for them.

**Architecture:** A new client-visible `/branding` route renders the *same* `BrandingPanel` and calls the *same* server action the agency's Settings page uses. The action's guard widens from agency-only to "member of this account", and its `accounts` write moves off the service-role client onto the RLS-enforced one, backed by a new member-update policy plus **column-level grants** so a client can reach the seven branding columns and nothing else.

**Tech Stack:** Next.js 16 App Router, Clerk (session claims → Supabase third-party auth), Supabase Postgres + PostgREST, RLS, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-15-m4c-client-editable-branding-design.md`

## Global Constraints

- Migration number is **0013**; the last applied is `0012_tenant_theme.sql`.
- There is exactly ONE Supabase project (`bis-platform-dev` / `tlbkbmlrfafquucsmsmm`) and Vercel production points at it. Applying 0013 changes production. Apply it **once**, and never re-apply.
- The client's write path must use `dbForRequest()`. `serviceDb()` stays on exactly two things inside the action: the Storage upload and the previous-logo read. Do not "tidy" either onto the user client — Storage has no RLS policies for this bucket.
- `getBranding` on the **public form** (`app/f/[publicId]/page.tsx`) keeps `serviceDb()`. That reader serves anonymous visitors with no session.
- Never assert a CSS custom property as evidence in a browser test. Assert a painted value.
- Every new test must be seen RED before it is seen green. A green assertion that was never red proves nothing.

---

### Task 1: Migration 0013 — row policy and column grants

**Files:**
- Create: `packages/db/supabase/migrations/0013_client_branding.sql`
- Create: `packages/db/src/test/client-branding-grants.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: policy `accounts_member_update` and a column-privilege set on `public.accounts` for role `authenticated`. Task 2's action depends on both existing.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/test/client-branding-grants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withRollback } from "./db";

/**
 * The column grant is invisible in application code: nothing in TypeScript
 * says a client cannot write `client_access_enabled`. This is the assertion
 * that says it, and it is deliberately an EXACT SET rather than a
 * "contains" — adding a branding column later without adding it here means
 * that field silently fails to save for clients while working for the
 * agency, and adding a NON-branding column here would be an escalation.
 */
const BRANDING_COLUMNS = [
  "brand_color",
  "brand_corners",
  "brand_logo_path",
  "brand_mode",
  "brand_name",
  "brand_neutral",
  "brand_type",
].sort();

// `withRollback` is the only connection helper packages/db exposes (with
// `actAs` and `actAsOwner`). It takes `(c: Client) => Promise<void>` and
// returns nothing, so every assertion happens INSIDE the callback rather
// than on a returned value. These are pure `select`s, so the rollback it
// wraps them in costs nothing.
describe("accounts column privileges for authenticated", () => {
  it("grants UPDATE on exactly the seven branding columns", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name
           from information_schema.column_privileges
          where grantee = 'authenticated'
            and table_schema = 'public'
            and table_name = 'accounts'
            and privilege_type = 'UPDATE'
          order by column_name`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(BRANDING_COLUMNS);
    });
  });

  it("does not grant UPDATE on client_access_enabled, the escalation this prevents", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name
           from information_schema.column_privileges
          where grantee = 'authenticated'
            and table_schema = 'public'
            and table_name = 'accounts'
            and privilege_type = 'UPDATE'
            and column_name in ('client_access_enabled', 'name', 'clerk_org_id', 'agency_id')`,
      );
      expect(rows).toEqual([]);
    });
  });

  it("has the accounts_member_update policy, scoped by org AND the access flag", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ qual: string; with_check: string }>(
        `select qual, with_check from pg_policies
          where schemaname = 'public'
            and tablename = 'accounts'
            and policyname = 'accounts_member_update'`,
      );
      expect(rows).toHaveLength(1);
      // Both halves matter: `qual` decides which rows the update can see,
      // `with_check` decides what the row is allowed to BECOME. Without the
      // second, a client could move their own row to another org.
      for (const clause of [rows[0]!.qual, rows[0]!.with_check]) {
        expect(clause).toContain("client_access_enabled");
        expect(clause).toContain("org_id");
      }
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @bis/db test client-branding-grants`
Expected: FAIL — the grant set comes back empty or as the full column list, and `accounts_member_update` returns 0 rows.

- [ ] **Step 3: Write the migration**

Create `packages/db/supabase/migrations/0013_client_branding.sql`:

```sql
-- M4c: a client edits their own branding.
--
-- Until now the branding write ran as SERVICE ROLE behind an agency-only
-- guard, so that guard was the only thing between a caller and any account's
-- branding. That was fine while only the agency could reach it. M4c lets
-- clients in, which makes the guard load-bearing against untrusted callers --
-- the exact shape of M1a's finding, where a client-controlled accountId fed a
-- service-role client (twelve latent IDORs, harmless only because no
-- non-agency role existed yet).

-- ROW SCOPE. A client may update their own account's row, and only while
-- their access is switched on.
--
-- `using` decides which rows the update can see; `with check` decides what the
-- row is allowed to BECOME. Both are required: without the second, a client
-- could move their own row to another org.
create policy accounts_member_update on public.accounts
  for update to authenticated
  using      (clerk_org_id = app.jwt()->>'org_id' and client_access_enabled)
  with check (clerk_org_id = app.jwt()->>'org_id' and client_access_enabled);

-- COLUMN SCOPE. An UPDATE policy is ROW-scoped, not column-scoped: the policy
-- above on its own lets a client rewrite EVERY column on their own row --
-- including client_access_enabled, which would let them re-enable access the
-- agency had just switched off, and `name`, the agency's private label for
-- them. Postgres column privileges are the right tool and cost nothing.
--
-- Safe for the agency: createAccount, setClientAccess and the previous-logo
-- read all run as service_role, which is not subject to column grants or RLS.
-- Verified by reading every accounts write in packages/db/src, not assumed.
--
-- ⚠️ ADDING A BRANDING COLUMN LATER MEANS ADDING IT HERE. Otherwise it saves
-- for the agency and silently fails for clients.
revoke update on public.accounts from authenticated;
grant update (brand_name, brand_logo_path, brand_color,
              brand_neutral, brand_corners, brand_type, brand_mode)
  on public.accounts to authenticated;
```

- [ ] **Step 4: Apply it to the database, once**

This project has one Supabase project and production reads it. Apply with the Supabase MCP `apply_migration` (project `tlbkbmlrfafquucsmsmm`, name `0013_client_branding`) or by running the file's contents through the SQL editor.

Then read it back before believing it:

```sql
select column_name from information_schema.column_privileges
 where grantee='authenticated' and table_name='accounts' and privilege_type='UPDATE'
 order by column_name;
```

Expected: exactly the seven `brand_*` columns.

- [ ] **Step 5: Run the test and watch it pass**

Run: `pnpm --filter @bis/db test client-branding-grants`
Expected: 3 passed.

- [ ] **Step 6: Mutation-check the grant**

Run `grant update (client_access_enabled) on public.accounts to authenticated;` by hand, re-run the test, and confirm tests 1 and 2 go **RED**. Then `revoke update (client_access_enabled) on public.accounts from authenticated;` and confirm green again. A grant assertion that has never been red is decoration.

- [ ] **Step 7: Commit**

```bash
git add packages/db/supabase/migrations/0013_client_branding.sql packages/db/src/test/client-branding-grants.test.ts
git commit -m "feat(db): let a client update their own branding columns, and only those

An UPDATE policy is row-scoped, not column-scoped, so the member policy alone
would let a client rewrite client_access_enabled and re-enable access the
agency had just turned off. Column privileges close that; the test asserts the
exact set so a future column cannot be added to it carelessly."
```

---

### Task 2: Move the branding action, widen its guard, take it off service role

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts` (delete `setBrandingAction` and any imports it alone used)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx:7` (import `setBrandingAction` from the new module)

**Interfaces:**
- Consumes: Task 1's policy and grants.
- Produces: `setBrandingAction(accountId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }>` — same signature as today, so `bind(null, accountId)` call sites are unchanged.

A cross-route action import is the established pattern here: `settings/page.tsx` already imports `captureBlueprintAction` from `../../../blueprints/actions`.

- [ ] **Step 1: Move the action verbatim, then change exactly three things**

Create `branding/actions.ts` by moving `setBrandingAction` out of `settings/actions.ts` unchanged, then make these three edits and no others:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { getBranding, removeBrandLogo, serviceDb, setBranding, uploadBrandLogo } from "@bis/db";
import { parseHexColor } from "@/lib/branding/color";
import { parseAllowlisted, NEUTRAL_NAMES, CORNER_NAMES, TYPE_NAMES, MODE_NAMES } from "@/lib/branding/theme";
import { MAX_LOGO_BYTES, sniffImageType } from "@/lib/branding/validate-logo";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
```

**Edit 1 — the guard.** Was `requireAgencyOnlyAccountAccess(accountId)`:

```ts
  // Widened from agency-only. requireAccountAccess already redirects a client
  // asking for someone else's account to their own rather than 403ing, and it
  // refuses a client whose access is switched off.
  const { userId } = await requireAccountAccess(accountId);
```

**Edit 2 — the row write moves off service role.** Was `setBranding(serviceDb(), …)`:

```ts
  try {
    await setBranding(
      // The RLS-enforced client, NOT serviceDb(). accounts_agency_all covers
      // the agency and accounts_member_update covers the client, so one call
      // serves both and a guard mistake yields zero rows instead of another
      // company's branding. setBranding already `.select("id")`s and throws
      // when it matches nothing, so "RLS filtered it" surfaces as a failure
      // rather than a silent success.
      await dbForRequest(), accountId,
      brandLogoPath
        ? { brandName, brandLogoPath, brandColor, brandNeutral, brandCorners, brandType, brandMode }
        : { brandName, brandColor, brandNeutral, brandCorners, brandType, brandMode },
      userId,
    );
  } catch (e) {
    console.error(`setBranding: write failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["branding.saveFailed"] };
  }
```

**Edit 3 — revalidate both surfaces.** Was one path:

```ts
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/branding`);
```

Everything else — the size checks, the byte sniff, `uploadBrandLogo(serviceDb(), …)`, the previous-logo read, the orphan sweep — is moved **unchanged**. The Storage calls stay on `serviceDb()` deliberately (spec §5.3).

- [ ] **Step 2: Update the settings page's import**

In `settings/page.tsx` line 7, drop `setBrandingAction` from the `./actions` import and add:

```ts
import { setBrandingAction } from "../branding/actions";
```

- [ ] **Step 3: Verify the move, and that the row write really left service role**

Run: `grep -rn "setBrandingAction" apps/web/src`
Expected: exactly three hits — the definition in `branding/actions.ts`, the import in `settings/page.tsx`, and (after Task 4) the import in `branding/page.tsx`. No hit inside `settings/actions.ts`.

Then, the assertion that matters — spec §7 asks for it because the whole boundary rests on it:

Run: `grep -n "serviceDb()" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts"`
Expected: exactly **two** hits, and both on Storage/read lines — `getBranding(serviceDb(), …)` fetching the previous logo path, and `uploadBrandLogo(serviceDb(), …)`, plus `removeBrandLogo(serviceDb(), …)` if the sweep is on its own line (three in that case). **Zero hits on the `setBranding(` call.** If `setBranding(serviceDb()` appears, the migration's policies are dead weight and a client could write any account's branding.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter web typecheck`
Expected: no output (success). A red here usually means `settings/actions.ts` kept an import only `setBrandingAction` used.

- [ ] **Step 5: Prove the agency path still works, before any client can reach it**

Run: `pnpm --filter web test:e2e client-access`
Expected: the existing client-access spec passes — it exercises the public form's branding, which reads what this action writes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/accounts/\[accountId\]/branding/actions.ts apps/web/src/app/\(dashboard\)/dashboard/accounts/\[accountId\]/settings/actions.ts apps/web/src/app/\(dashboard\)/dashboard/accounts/\[accountId\]/settings/page.tsx
git commit -m "refactor(branding): one action, RLS-enforced, reachable by the account's own members

The write moves off the service-role client onto dbForRequest so the database
is a second boundary rather than the app guard being the only one. Storage
stays on service role deliberately — that bucket has no RLS policies."
```

---

### Task 3: Make the panel shared

**Files:**
- Create: `apps/web/src/components/branding-panel.tsx` (moved)
- Delete: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/branding-panel.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx:10` (import path)

**Interfaces:**
- Consumes: Task 2's `setBrandingAction`.
- Produces: `BrandingPanel` at `@/components/branding-panel` with its props unchanged: `{ brandName, brandColor, brandNeutral, brandCorners, brandType, brandMode, logoUrl, action }`.

Two surfaces rendering two copies of this form is how M1c's duplicated form logic drifted, twice. One component, imported by both.

- [ ] **Step 1: Move the file**

```bash
git mv "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/branding-panel.tsx" apps/web/src/components/branding-panel.tsx
```

- [ ] **Step 2: Fix the one import that breaks**

`branding-panel.tsx` imports `SubmitButton` by relative path, which no longer resolves:

```ts
// was: import { SubmitButton } from "../../submit-button";
import { SubmitButton } from "@/app/(dashboard)/dashboard/accounts/submit-button";
```

Every other import in the file is already `@/`-absolute and needs no change.

- [ ] **Step 3: Update the settings page import**

```ts
// was: import { BrandingPanel } from "./branding-panel";
import { BrandingPanel } from "@/components/branding-panel";
```

- [ ] **Step 4: Typecheck and run the web unit suite**

Run: `pnpm --filter web typecheck && pnpm --filter web test`
Expected: typecheck silent; the unit suite passes with the same count as before this task (no test targets this component directly).

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src
git commit -m "refactor(branding): move BrandingPanel to components, so two surfaces share one form"
```

---

### Task 4: The client's Branding page and nav item

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/page.tsx`
- Modify: `apps/web/src/lib/messages.ts` (add three keys)
- Modify: `apps/web/src/components/app-sidebar.tsx:78-99`

**Interfaces:**
- Consumes: `BrandingPanel` from `@/components/branding-panel`, `setBrandingAction` from `./actions`.
- Produces: the route `/dashboard/accounts/<accountId>/branding`.

- [ ] **Step 1: Add the copy**

In `apps/web/src/lib/messages.ts`, beside the existing `nav.*` keys:

```ts
  "nav.branding": "Branding",
```

and beside the existing `branding.*` keys:

```ts
  "branding.clientTitle": "Your branding",
  "branding.clientBody": "What your team sees in this workspace, and what your customers see on your lead forms.",
```

The existing `branding.body` is written for the agency ("Shown to this company's users…") and stays as it is — the agency's Settings card keeps using it.

- [ ] **Step 2: Give BrandingPanel optional heading copy**

The panel's Card currently hardcodes `m["branding.title"]` / `m["branding.body"]`, and that body is written for the agency ("Shown to **this company's** users…"). Showing it to the company itself reads wrong. Add two optional props rather than forking the component — defaults keep the Settings page byte-identical:

```tsx
export function BrandingPanel({
  title = m["branding.title"],
  description = m["branding.body"],
  brandName,
  // …the rest unchanged
}: {
  title?: string;
  description?: string;
  brandName: string | null;
  // …the rest unchanged
}) {
```

and in its `CardHeader`, replace the two hardcoded lookups with `{title}` and `{description}`.

- [ ] **Step 3: Write the page**

Create `branding/page.tsx`:

```tsx
import { getBranding, brandLogoUrl, serviceDb } from "@bis/db";
import { BrandingPanel } from "@/components/branding-panel";
import { PageHeader } from "@/components/page-header";
import { requireAccountAccess } from "@/lib/auth";
import { m } from "@/lib/messages";
import { setBrandingAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * The client's own door onto their branding. Deliberately NOT the Settings
 * page: that one also carries custom-field definitions, blueprints and the
 * client-access switch, so opening it to clients would make every panel and
 * every query on it conditional — and one missed condition leaks agency data.
 * That is the shape of the M2 near-miss, where dashboard/layout.tsx held the
 * only guard on three agency-wide serviceDb() reads.
 *
 * This page fetches branding and nothing else. That is a property of what it
 * reads, not of a conditional, which is what makes it safe to expose.
 */
export default async function BrandingPage({
  params,
}: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  // Redirects a client asking for another account to their own, and refuses a
  // client whose access is switched off. The agency passes straight through.
  await requireAccountAccess(accountId);

  // serviceDb for the READ is intentional and matches every other in-account
  // read of this row: accounts_member_read returns the whole row to the
  // account's own users anyway, so this changes no boundary.
  const branding = await getBranding(serviceDb(), accountId);

  return (
    <div className="space-y-6">
      {/* PageHeader takes `title` and nothing resembling a description — the
          descriptive copy belongs to the panel's own Card, which is why the
          panel gained optional heading props in Step 2. */}
      <PageHeader title={m["branding.clientTitle"]} />
      <BrandingPanel
        title={m["branding.clientTitle"]}
        description={m["branding.clientBody"]}
        // Same reason as the Settings page: remount on ACCOUNT change so one
        // account's unsaved radio selections cannot be carried into another's
        // form by a client-side navigation and saved over its real values.
        key={accountId}
        brandName={branding.brandName}
        brandColor={branding.brandColor}
        brandNeutral={branding.brandNeutral}
        brandCorners={branding.brandCorners}
        brandType={branding.brandType}
        brandMode={branding.brandMode}
        logoUrl={branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
        action={setBrandingAction.bind(null, accountId)}
      />
    </div>
  );
}
```

⚠️ Check `PageHeader`'s actual prop names in `apps/web/src/components/page-header.tsx` before writing this — if it takes `heading`/`sub` rather than `title`/`description`, use its real names.

- [ ] **Step 4: Add the nav item, for clients only**

In `app-sidebar.tsx`, the in-account list (currently lines 79-86) becomes:

```tsx
    ? [
        { href: `${base}/dashboard`, label: m["nav.dashboard"], icon: LayoutDashboard },
        { href: `${base}/contacts`, label: m["nav.contacts"], icon: Users },
        { href: `${base}/pipeline`, label: m["nav.opportunities"], icon: KanbanSquare },
        { href: `${base}/conversations`, label: m["nav.conversations"], icon: MessagesSquare },
        { href: `${base}/forms`, label: m["nav.forms"], icon: FileText },
        { href: `${base}/calendar`, label: m["nav.calendar"], icon: Calendar },
        // Clients only. The agency reaches the same panel from Settings, beside
        // the things only they can do; giving them both would be two doors to
        // one form in the same sidebar.
        ...(isAgency
          ? []
          : [{ href: `${base}/branding`, label: m["nav.branding"], icon: Palette }]),
      ]
```

Add `Palette` to the existing `lucide-react` import at the top of the file.

- [ ] **Step 5: Typecheck and build**

Run: `pnpm --filter web typecheck && pnpm --filter web build`
Expected: typecheck silent; build lists `/dashboard/accounts/[accountId]/branding` among its routes.

- [ ] **Step 6: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(branding): a client edits their own branding from their own page

Loads branding and nothing else — no blueprints, no custom fields, no member
list — so the page is safe to expose by what it fetches rather than by a
conditional."
```

---

### Task 5: Prove it — at the database, and in a browser

**Files:**
- Create: `apps/web/e2e/client-branding.spec.ts`

**Interfaces:**
- Consumes: everything above, plus the client fixture `auth.setup.ts` already creates (`e2e/.auth/client-fixture.json`: `accountId`, `clerkUserId`, `formPublicId`, …) and `e2e/.auth/client-state.json`.
- Produces: nothing.

**Why the DB-level half exists.** M2's client spec was five absence-based assertions and all five passed while the client's entire CRM was a 404. Absence proves nothing on its own. The strongest evidence that milestone produced was a real Clerk token driven straight at PostgREST, and that is what proves the boundary here.

- [ ] **Step 1: Write the failing spec**

Create `apps/web/e2e/client-branding.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setBranding, getBranding } from "@bis/db";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

type ClientFixture = { accountId: string; clerkUserId: string };
const fixture = () =>
  JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

/**
 * A real Clerk session token for the fixture's CLIENT user — the same
 * two-call Backend API dance packages/db's user-client integration test uses.
 * Not stubbed: the whole boundary is Clerk's claims meeting Supabase's
 * policies, so a fake token would prove nothing about either.
 */
async function mintClientToken(userId: string): Promise<string> {
  const sk = process.env.CLERK_SECRET_KEY!;
  const headers = { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" };
  const session = await fetch("https://api.clerk.com/v1/sessions", {
    method: "POST", headers, body: JSON.stringify({ user_id: userId }),
  }).then((r) => r.json()) as { id: string };
  const token = await fetch(`https://api.clerk.com/v1/sessions/${session.id}/tokens`, {
    method: "POST", headers,
  }).then((r) => r.json()) as { jwt: string };
  return token.jwt;
}

/** PostgREST, called directly with the client's own token. */
async function patchAccount(
  token: string, accountId: string, body: Record<string, unknown>,
): Promise<{ status: number; rows: unknown[] }> {
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/accounts?id=eq.${accountId}&select=id`,
    {
      method: "PATCH",
      headers: {
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(body),
    },
  );
  const rows = res.status === 200 ? ((await res.json()) as unknown[]) : [];
  return { status: res.status, rows };
}

test.describe("a client's branding boundary, at the database", () => {
  test("can write its own branding columns, and nothing else", async () => {
    const { accountId, clerkUserId } = fixture();
    const token = await mintClientToken(clerkUserId);
    const before = await getBranding(serviceDb(), accountId);

    try {
      // 1. The positive case. Without this, every assertion below passes
      //    trivially if the client can write nothing at all — which is
      //    exactly how M2's spec passed against a CRM that was entirely 404.
      const own = await patchAccount(token, accountId, { brand_color: "#123456" });
      expect(own.rows).toHaveLength(1);
      expect((await getBranding(serviceDb(), accountId)).brandColor).toBe("#123456");

      // 2. Another account's branding: RLS FILTERS, it does not throw, so the
      //    tell is zero rows and a 200 — not an error status.
      const other = await patchAccount(token, "45240784-a70e-43a0-8a0c-0027c7073f98",
        { brand_color: "#654321" });
      expect(other.rows).toHaveLength(0);

      // 3. The escalation the column grant exists to stop: re-enabling access
      //    the agency switched off. Refused by privilege, so this is a 4xx.
      const escalate = await patchAccount(token, accountId, { client_access_enabled: true });
      expect(escalate.status).toBeGreaterThanOrEqual(400);

      // 4. The agency's private label for this company is not the client's.
      const rename = await patchAccount(token, accountId, { name: "renamed by client" });
      expect(rename.status).toBeGreaterThanOrEqual(400);
    } finally {
      // Restore, whatever happened above. auth.teardown deletes this fixture
      // outright, but only when the suite COMPLETES.
      await setBranding(serviceDb(), accountId, { brandColor: before.brandColor }, clerkUserId);
    }
  });
});

test.describe("a client edits their branding in the browser", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("changes the colour and sees it applied", async ({ page }) => {
    const { accountId, clerkUserId } = fixture();
    const before = await getBranding(serviceDb(), accountId);
    try {
      await page.goto(`/dashboard/accounts/${accountId}/branding`);
      await page.getByRole("link", { name: "Branding" }).first().waitFor();

      const colour = page.getByLabel(/brand colou?r/i);
      await colour.fill("#0f766e");
      await page.getByRole("button", { name: /save|update/i }).first().click();

      await expect(page.getByText("Branding updated")).toBeVisible();
      expect((await getBranding(serviceDb(), accountId)).brandColor).toBe("#0f766e");
    } finally {
      await setBranding(serviceDb(), accountId, { brandColor: before.brandColor }, clerkUserId);
    }
  });
});
```

⚠️ The colour field's accessible name and the save button's label come from `messages.ts` — read the real strings and use them rather than the regexes above if they do not match.

- [ ] **Step 2: Run it and watch it fail for the right reason**

Run: `pnpm --filter web test:e2e client-branding`
Expected before Tasks 1-4 exist: the DB test fails at assertion 1 (zero rows — no member-update policy), and the browser test fails on a 404 for `/branding`. Both are the *intended* failures; a failure minting the token means `CLERK_SECRET_KEY` is missing from `apps/web/.env.local`, which is an environment problem, not a code one.

- [ ] **Step 3: Run the full suite**

Run: `pnpm --filter web test:e2e`
Expected: every spec passes. If two or three specs fail with navigation timeouts and a different set each run, that is the dev-server compile flakiness — see PR #15; re-run before investigating.

- [ ] **Step 4: Mutation-check the boundary**

Comment out the `revoke`/`grant` pair from 0013, re-apply, and confirm assertions 3 and 4 go **RED**. Restore, re-apply, confirm green. This is the assertion the whole milestone rests on; it must be seen red once.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/client-branding.spec.ts
git commit -m "test(branding): prove a client can write its own branding and nothing else

Positive first: without it, every negative below passes trivially against a
client that can write nothing — which is how M2's spec passed while the whole
CRM was a 404."
```

---

## Verification before opening the PR

- [ ] `pnpm --filter web typecheck`
- [ ] `pnpm --filter web lint`
- [ ] `pnpm --filter web test` and `pnpm --filter @bis/db test`
- [ ] `pnpm --filter web build`
- [ ] `pnpm --filter web test:e2e` (full suite)
- [ ] Confirm 0013 is applied **once** and read back from `information_schema.column_privileges`
- [ ] Confirm the agency can still edit branding from Settings — the path that existed before this milestone
