# BIS Platform M0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed multi-tenant foundation: pnpm monorepo, Clerk auth, Supabase Postgres with RLS-enforced two-level tenancy (agencies → accounts), an append-only events log, and an agency dashboard where danlo can create and switch between client accounts.

**Architecture:** Single Next.js App Router app on Vercel; all DB access server-side via `@bis/db`; tenancy enforced by Postgres RLS reading JWT claims (`org_id`, `app_role`) with an automated cross-tenant isolation test suite; Clerk Organizations = client accounts, mapped to `accounts.clerk_org_id`.

**Tech Stack:** Next.js (App Router, latest), TypeScript strict, Tailwind, @clerk/nextjs v6+, @supabase/supabase-js v2, Supabase CLI (cloud db push — no Docker needed), vitest, pg.

**Plan program note:** This is Plan 1 of 4 for M0+M1. Plans for M1a (CRM core), M1b (messaging/inbox), M1c (forms+blueprints+wizard) are written after this plan executes, so they can reference real code.

## Global Constraints

- TypeScript `strict: true`; gate = `pnpm check` (tsc --noEmit + vitest run) green before every commit that completes a task.
- Licenses: MIT/BSD/Apache dependencies only. No AGPL, SSPL, or "sustainable use" licenses (spec §2).
- Every tenant-owned table carries `account_id uuid` and has RLS enabled (spec §3). `events` is append-only (no UPDATE/DELETE for app roles) (spec §4).
- `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL` are server-only — never `NEXT_PUBLIC_*`, never imported into client components (spec §10).
- pnpm only (no npm/yarn). Node ≥ 22. Dev box is Windows — commands below run in Git Bash.
- Line endings: `.gitattributes` forces `eol=lf` (CareCompanion CRLF lesson).
- Clean room: no GoHighLevel code, branding, UI assets, or copied doc text (spec §13).
- Working name is `bis-platform`; no domains/handles purchased in this plan.
- Commits: conventional prefixes (`feat:`/`chore:`/`test:`/`docs:`), review-gate with danlo before push to `main`'s remote.

## USER SETUP (danlo, before Task 3/4/9 — ~15 min of console clicks)

1. **Clerk** (before Task 3): create application "BIS Platform (dev)" at dashboard.clerk.com → enable Email + Google sign-in → **enable Organizations** → copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY`. Then Sessions → **Customize session token** → add claims: `{ "org_id": "{{org.id}}", "app_role": "{{user.public_metadata.app_role}}" }`. Finally, on your own Clerk user (after first sign-in in Task 3), set `public_metadata = { "app_role": "agency_admin" }` in the Clerk dashboard.
2. **Supabase** (before Task 4): create project "bis-platform-dev" at supabase.com → copy `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and the **direct connection string** (Settings → Database → Connection string → URI) as `SUPABASE_DB_URL`. Also connect Clerk as third-party auth provider: Supabase Dashboard → Authentication → Sign In / Up → Third Party Auth → add Clerk (paste your Clerk domain) — needed from M1 on, harmless now.
3. **Vercel** (before Task 9): `vercel link` in the repo (new project "bis-platform"), add the env vars from `.env.example` (service-role + db-url as plain env vars, NOT NEXT_PUBLIC).

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.gitattributes`, `.env.example`, `README.md`

**Interfaces:**
- Produces: workspace layout `apps/*`, `packages/*`; root scripts `check`, `test`, `typecheck` used by every later task.

- [x] **Step 1: Author root files**

`package.json`:
```json
{
  "name": "bis-platform",
  "private": true,
  "engines": { "node": ">=22" },
  "packageManager": "pnpm@10.13.1",
  "scripts": {
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "pnpm -r --if-present test",
    "check": "pnpm typecheck && pnpm test"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  }
}
```

`.gitattributes`:
```
* text=auto eol=lf
```

`.gitignore`:
```
node_modules/
.next/
.env
.env.local
.env*.local
.vercel/
*.tsbuildinfo
```

`.env.example`:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_DB_URL=
```

`README.md`:
```markdown
# bis-platform

Multi-tenant client platform (BIS). Spec: docs/superpowers/specs/2026-07-25-bis-platform-design.md

## Dev
pnpm install
cp .env.example apps/web/.env.local   # fill from Clerk + Supabase dashboards
pnpm --filter web dev

## Gates
pnpm check   # tsc + vitest, must be green before commit
```

- [x] **Step 2: Verify**

Run: `pnpm install && pnpm check`
Expected: install succeeds; `check` passes trivially (no packages yet print "No projects matched the filters" — that is OK/green).

- [x] **Step 3: Commit**

```bash
git add -A && git commit -m "chore: monorepo scaffold (pnpm workspace, strict TS base, env template)"
```

---

### Task 2: Next.js app

**Files:**
- Create: `apps/web/*` (via create-next-app) — keep generated structure
- Modify: `apps/web/package.json` (name `web`, add `typecheck` script), `apps/web/tsconfig.json` (extend base)

**Interfaces:**
- Produces: app `web`; `pnpm --filter web dev|build`; route group `src/app/`.

- [x] **Step 1: Scaffold**

Run (repo root):
```bash
pnpm dlx create-next-app@latest apps/web --ts --tailwind --eslint --app --src-dir --use-pnpm --no-import-alias
```

- [x] **Step 2: Wire into workspace**

In `apps/web/package.json` set `"name": "web"` and add to scripts:
```json
"typecheck": "tsc --noEmit"
```
In `apps/web/tsconfig.json` add at top level:
```json
"extends": "../../tsconfig.base.json",
```
(keep the generated `compilerOptions`; base only tightens strictness).

- [x] **Step 3: Verify**

Run: `pnpm install && pnpm --filter web build && pnpm check`
Expected: build succeeds; typecheck green.

- [x] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: Next.js app scaffold (apps/web)"
```

---

### Task 3: Clerk auth (sign-in + protected dashboard + agency guard)

**Files:**
- Create: `apps/web/src/middleware.ts`, `apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`, `apps/web/src/app/dashboard/layout.tsx`, `apps/web/src/app/dashboard/page.tsx`, `apps/web/src/lib/auth.ts`
- Modify: `apps/web/src/app/layout.tsx`
- Requires: USER SETUP #1 done; keys in `apps/web/.env.local`

**Interfaces:**
- Produces: `requireAgency(): Promise<{ userId: string }>` (throws redirect if `app_role !== 'agency_admin'`); `sessionClaims` shape `{ org_id?: string; app_role?: string }` — Tasks 6–8 rely on these names.

- [x] **Step 1: Install + provider**

```bash
pnpm --filter web add @clerk/nextjs
```

`apps/web/src/app/layout.tsx` — wrap existing body content:
```tsx
import { ClerkProvider } from "@clerk/nextjs";
// inside RootLayout return:
// <ClerkProvider>{/* existing <html>...<body>{children}</body> */}</ClerkProvider>
```
(Wrap the entire `<html>` element in `<ClerkProvider>` per Clerk App Router docs.)

- [x] **Step 2: Middleware + sign-in page**

`apps/web/src/middleware.ts`:
```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtected = createRouteMatcher(["/dashboard(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtected(req)) await auth.protect();
});

export const config = {
  matcher: ["/((?!_next|.*\\..*).*)", "/(api|trpc)(.*)"],
};
```

`apps/web/src/app/sign-in/[[...sign-in]]/page.tsx`:
```tsx
import { SignIn } from "@clerk/nextjs";
export default function Page() {
  return <div className="flex min-h-screen items-center justify-center"><SignIn /></div>;
}
```

- [x] **Step 3: Agency guard + dashboard stub**

`apps/web/src/lib/auth.ts`:
```ts
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

export type AppClaims = { org_id?: string; app_role?: string };

export async function requireAgency(): Promise<{ userId: string }> {
  const { userId, sessionClaims } = await auth();
  if (!userId) redirect("/sign-in");
  const claims = sessionClaims as AppClaims;
  if (claims.app_role !== "agency_admin") redirect("/");
  return { userId };
}
```

`apps/web/src/app/dashboard/layout.tsx`:
```tsx
import { requireAgency } from "@/lib/auth";
export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAgency();
  return <div className="mx-auto max-w-5xl p-6">{children}</div>;
}
```

`apps/web/src/app/dashboard/page.tsx`:
```tsx
export default function DashboardPage() {
  return <h1 className="text-2xl font-semibold">BIS Agency Dashboard</h1>;
}
```

- [ ] **Step 4: Verify manually**

Run: `pnpm --filter web dev` → visit `http://localhost:3000/dashboard`
Expected: redirected to sign-in; after signing in WITHOUT `app_role` metadata → bounced to `/`; after danlo sets `public_metadata.app_role = "agency_admin"` (USER SETUP #1) and re-signs-in → dashboard renders. Then `pnpm check` green.

Headless half DONE: `/` 200, `/sign-in` 200, `/dashboard` unauthenticated → 307 to Clerk sign-in; `pnpm check` green. Signed-in half (no-`app_role` bounce → `/`, then `agency_admin` → dashboard renders) still needs danlo in a real browser after the Clerk session-claims + `public_metadata` setup.

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: Clerk auth, protected dashboard, agency_admin guard"
```

---

### Task 4: Database schema — tenancy + events + RLS (packages/db)

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/supabase/config.toml` (via CLI init), `packages/db/supabase/migrations/0001_tenancy.sql`
- Requires: USER SETUP #2 done; `SUPABASE_DB_URL` available in shell

**Interfaces:**
- Produces: tables `agencies`, `accounts`, `users`, `memberships`, `events`; SQL helpers `app.jwt()`, `app.is_agency()`, `app.current_account_id()`. Tasks 5–8 and all M1 plans build on these exact names.

- [x] **Step 1: Package scaffold**

`packages/db/package.json`:
```json
{
  "name": "@bis/db",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "db:push": "supabase db push --db-url \"$SUPABASE_DB_URL\""
  },
  "devDependencies": { "supabase": "^2.0.0", "typescript": "^5.6.0" }
}
```
`packages/db/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```
Run: `pnpm install && cd packages/db && pnpm exec supabase init` (accept defaults; no local stack needed — we push to the cloud dev project).

- [x] **Step 2: Migration 0001**

`packages/db/supabase/migrations/0001_tenancy.sql`:
```sql
create schema if not exists app;

-- JWT helpers (work on Supabase and in bare-pg tests via request.jwt.claims GUC)
create or replace function app.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

create or replace function app.is_agency() returns boolean
language sql stable as $$
  select app.jwt()->>'app_role' = 'agency_admin'
$$;

-- Tenancy spine (spec §3)
create table public.agencies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  clerk_org_id text not null unique,
  name text not null,
  timezone text not null default 'America/Chicago',
  status text not null default 'active' check (status in ('active','paused','archived')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  email text not null,
  name text,
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  scope text not null check (scope in ('agency','account')),
  agency_id uuid references public.agencies(id),
  account_id uuid references public.accounts(id),
  role text not null check (role in ('admin','member')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (
    (scope = 'agency' and agency_id is not null and account_id is null) or
    (scope = 'account' and account_id is not null and agency_id is null)
  )
);
create unique index memberships_unique
  on public.memberships (user_id, scope, coalesce(agency_id, '00000000-0000-0000-0000-000000000000'), coalesce(account_id, '00000000-0000-0000-0000-000000000000'));

-- Events log: keystone primitive (spec §4). Append-only.
create table public.events (
  id bigint generated always as identity primary key,
  account_id uuid references public.accounts(id),
  type text not null,
  actor_type text not null check (actor_type in ('user','system','ai')),
  actor_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index events_account_created on public.events (account_id, created_at desc);
create index events_type on public.events (type);

-- Maps the caller's Clerk org claim to an account id (used by every tenant table's policies)
create or replace function app.current_account_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.accounts where clerk_org_id = app.jwt()->>'org_id'
$$;

-- RLS
alter table public.agencies enable row level security;
alter table public.accounts enable row level security;
alter table public.users enable row level security;
alter table public.memberships enable row level security;
alter table public.events enable row level security;

create policy agencies_agency_all on public.agencies
  for all to authenticated using (app.is_agency()) with check (app.is_agency());

create policy accounts_agency_all on public.accounts
  for all to authenticated using (app.is_agency()) with check (app.is_agency());
create policy accounts_member_read on public.accounts
  for select to authenticated using (clerk_org_id = app.jwt()->>'org_id');

create policy users_agency_all on public.users
  for all to authenticated using (app.is_agency()) with check (app.is_agency());

create policy memberships_agency_all on public.memberships
  for all to authenticated using (app.is_agency()) with check (app.is_agency());
create policy memberships_member_read on public.memberships
  for select to authenticated using (account_id = app.current_account_id());

create policy events_read on public.events
  for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy events_insert on public.events
  for insert to authenticated
  with check (app.is_agency() or account_id = app.current_account_id());
-- append-only: no update/delete policies, and belt-and-suspenders:
revoke update, delete on public.events from authenticated;

-- Seed the agency layer: BIS is row #1 (spec §3)
insert into public.agencies (name) values ('BIS');
```

- [x] **Step 3: Apply + verify**

Run (Git Bash, repo root; `SUPABASE_DB_URL` exported):
```bash
cd packages/db && pnpm db:push
```
Expected: `Applying migration 0001_tenancy.sql... Finished`. Spot-check in Supabase Studio: five tables exist, `agencies` has one row `BIS`, RLS shows "enabled" on all five.

Applied 2026-07-26. Verified by query: all five tables `rowsecurity=true`, 8 policies, `agencies` = 1 row `BIS`, `authenticated` has no UPDATE/DELETE on `events`. Notes: (a) pnpm runs scripts through cmd.exe on Windows so `"$SUPABASE_DB_URL"` did not expand — added root `.npmrc` with `shell-emulator=true`; (b) `SUPABASE_DB_URL` in `apps/web/.env.local` pointed at `aws-1-us-east-1.pooler.supabase.com` (Supavisor: "tenant/user not found") — corrected to `aws-0-us-east-1`; (c) a Docker warning about caching the migrations catalog is emitted after the migration applies and is harmless.

- [x] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(db): tenancy spine, events log, RLS policies + BIS seed"
```

---

### Task 5: RLS cross-tenant isolation test suite

**Files:**
- Create: `packages/db/src/test/rls.test.ts`, `packages/db/src/test/db.ts`, `packages/db/vitest.config.ts`
- Modify: `packages/db/package.json` (add test script + deps)

**Interfaces:**
- Consumes: schema + helpers from Task 4 (`app.jwt()` claims `org_id`/`app_role`).
- Produces: `withRollback(fn)` and `actAs(client, claims)` test utilities reused by every future package's DB tests.

- [x] **Step 1: Deps + config**

```bash
pnpm --filter @bis/db add -D vitest pg @types/pg dotenv
```
Add to `packages/db/package.json` scripts: `"test": "vitest run"`.

`packages/db/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"], testTimeout: 20000 } });
```

- [x] **Step 2: Test utilities**

(`dotenv/config` resolves from cwd, so the suite reads `packages/db/.env` — a git-ignored copy of the `SUPABASE_DB_URL` line from `apps/web/.env.local`.)

`packages/db/src/test/db.ts`:
```ts
import { Client } from "pg";
import "dotenv/config";

export async function withRollback(fn: (c: Client) => Promise<void>) {
  const c = new Client({ connectionString: process.env.SUPABASE_DB_URL });
  await c.connect();
  try {
    await c.query("begin");
    await fn(c);
  } finally {
    await c.query("rollback");
    await c.end();
  }
}

/** Simulate an RLS caller. Claims mirror Clerk session-token custom claims. */
export async function actAs(c: Client, claims: { org_id?: string; app_role?: string }) {
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
  await c.query("set local role authenticated");
}

export async function actAsOwner(c: Client) {
  await c.query("reset role");
}
```

- [x] **Step 3: Write the failing-then-passing isolation tests**

`packages/db/src/test/rls.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { withRollback, actAs, actAsOwner } from "./db";

async function seedTwoAccounts(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [a] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1,'org_A','Alpha') returning id", [agency.id]);
  const { rows: [b] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1,'org_B','Bravo') returning id", [agency.id]);
  await c.query(
    "insert into events (account_id, type, actor_type, payload) values ($1,'account.created','system','{}'),($2,'account.created','system','{}')",
    [a.id, b.id]);
  return { a: a.id as string, b: b.id as string };
}

describe("RLS tenant isolation", () => {
  it("account member sees only their own account", () =>
    withRollback(async (c) => {
      await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_A" });
      const { rows } = await c.query("select clerk_org_id from accounts");
      expect(rows.map((r: any) => r.clerk_org_id)).toEqual(["org_A"]);
    }));

  it("account member sees only their own events; cannot insert into other tenant", () =>
    withRollback(async (c) => {
      const { b } = await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_A" });
      const { rows } = await c.query("select account_id from events");
      expect(new Set(rows.map((r: any) => r.account_id)).size).toBe(1);
      await expect(
        c.query("insert into events (account_id, type, actor_type) values ($1,'x','user')", [b])
      ).rejects.toThrow(/row-level security/);
    }));

  it("forged/absent claims see nothing and cannot write", () =>
    withRollback(async (c) => {
      await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_NOPE" });
      const { rows } = await c.query("select * from accounts");
      expect(rows).toHaveLength(0);
      await expect(
        c.query("insert into accounts (agency_id, clerk_org_id, name) values (gen_random_uuid(),'x','x')")
      ).rejects.toThrow();
    }));

  it("agency_admin sees all accounts and all events", () =>
    withRollback(async (c) => {
      await seedTwoAccounts(c);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select clerk_org_id from accounts order by clerk_org_id");
      expect(rows.map((r: any) => r.clerk_org_id)).toEqual(["org_A", "org_B"]);
    }));

  it("events are append-only even for agency", () =>
    withRollback(async (c) => {
      const ids = await seedTwoAccounts(c);
      await actAs(c, { app_role: "agency_admin" });
      await expect(c.query("update events set type='hacked'")).rejects.toThrow();
      await expect(c.query("delete from events")).rejects.toThrow();
      void ids; void actAsOwner;
    }));
});
```

- [x] **Step 4: Run**

Run: `pnpm --filter @bis/db test`
Expected: 5 passing. If `role "authenticated" does not exist` — you are pointed at a non-Supabase DB; fix `SUPABASE_DB_URL`. If the append-only test fails on UPDATE succeeding, the `revoke` in migration 0001 didn't apply — re-run `pnpm db:push`.

Result: 5/5 passing. First run failed 4/5 with `permission denied for schema app` — migration 0001 never granted `usage on schema app` to the app roles, so every policy that calls an `app.*` helper errored instead of evaluating. Fixed forward with `packages/db/supabase/migrations/0002_app_schema_grants.sql` (usage + execute for `authenticated`, `anon`, `service_role`), pushed, then green.

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "test(db): RLS cross-tenant isolation suite (forged claims, append-only events)"
```

---

### Task 6: Accounts service (`@bis/db` client + createAccount/listAccounts + event emit)

**Files:**
- Create: `packages/db/src/index.ts`, `packages/db/src/service.ts`, `packages/db/src/accounts.ts`, `packages/db/src/test/accounts.test.ts`

**Interfaces:**
- Consumes: Task 4 schema.
- Produces (exact — Tasks 7–8 import these):
  - `serviceDb(): SupabaseClient` (service-role, server-only)
  - `createAccount(db, input: { clerkOrgId: string; name: string; timezone?: string; actorId: string }): Promise<{ id: string }>`
  - `listAccounts(db): Promise<Array<{ id: string; name: string; clerk_org_id: string; status: string; timezone: string; created_at: string }>>`

- [x] **Step 1: Deps + service client**

```bash
pnpm --filter @bis/db add @supabase/supabase-js
```

`packages/db/src/service.ts`:
```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/** Service-role client. SERVER ONLY — bypasses RLS; tenancy is the caller's responsibility. */
export function serviceDb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase service env vars missing");
  return createClient(url, key, { auth: { persistSession: false } });
}
```

- [x] **Step 2: Write failing tests**

`packages/db/src/test/accounts.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";
import { createAccount, listAccounts } from "../accounts";

const suffix = () => Math.random().toString(36).slice(2, 10);

describe("accounts service", () => {
  it("createAccount inserts row + emits account.created event", async () => {
    const db = serviceDb();
    const orgId = `org_test_${suffix()}`;
    const { id } = await createAccount(db, { clerkOrgId: orgId, name: "Test Co", actorId: "user_test" });
    try {
      const { data: ev } = await db.from("events").select("type, actor_type, actor_id")
        .eq("account_id", id).eq("type", "account.created").single();
      expect(ev).toMatchObject({ type: "account.created", actor_type: "user", actor_id: "user_test" });
      const all = await listAccounts(db);
      expect(all.some(a => a.id === id)).toBe(true);
    } finally {
      await db.from("events").delete().eq("account_id", id);
      await db.from("accounts").delete().eq("id", id);
    }
  });
});
```

Run: `pnpm --filter @bis/db test` → Expected: FAIL (`accounts.ts` missing).

Fail-first confirmed: `Error: Cannot find module '../accounts' imported from .../src/test/accounts.test.ts` (1 suite failed, RLS suite still 5 passed).

- [x] **Step 3: Implement**

`packages/db/src/accounts.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export async function createAccount(
  db: SupabaseClient,
  input: { clerkOrgId: string; name: string; timezone?: string; actorId: string },
): Promise<{ id: string }> {
  const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
  if (agErr || !agency) throw new Error(`agency row missing: ${agErr?.message}`);

  const { data: account, error } = await db
    .from("accounts")
    .insert({ agency_id: agency.id, clerk_org_id: input.clerkOrgId, name: input.name, timezone: input.timezone ?? "America/Chicago" })
    .select("id")
    .single();
  if (error || !account) throw new Error(`createAccount failed: ${error?.message}`);

  const { error: evErr } = await db.from("events").insert({
    account_id: account.id, type: "account.created",
    actor_type: "user", actor_id: input.actorId,
    payload: { name: input.name },
  });
  if (evErr) throw new Error(`event emit failed: ${evErr.message}`);
  return { id: account.id };
}

export async function listAccounts(db: SupabaseClient) {
  const { data, error } = await db
    .from("accounts")
    .select("id, name, clerk_org_id, status, timezone, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}
```

`packages/db/src/index.ts`:
```ts
export { serviceDb } from "./service";
export { createAccount, listAccounts } from "./accounts";
```

- [x] **Step 4: Run tests**

Run: `pnpm --filter @bis/db test` → Expected: all pass (RLS suite + accounts suite).

Result: 2 files / 6 tests passing (5 RLS + 1 accounts); `pnpm check` green. Two environment notes: (a) `packages/db/.env` needed `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` added (copied from `apps/web/.env.local`; file stays git-ignored); (b) vitest isolates each test file, so `dotenv/config` loaded via `src/test/db.ts` does NOT reach `accounts.test.ts` — first run failed with "Supabase service env vars missing". Fixed by adding `import "dotenv/config";` to `accounts.test.ts` (same pattern as `db.ts`). Test rows are inserted and deleted for real via service role; post-run DB check confirmed 0 leftover `org_test_%` accounts and 0 events.

- [x] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(db): serviceDb + accounts service with account.created event"
```

---

### Task 7: Create-account server action (Clerk org ↔ db row, compensating rollback)

**Files:**
- Create: `apps/web/src/app/dashboard/accounts/actions.ts`
- Modify: `apps/web/package.json` (add `"@bis/db": "workspace:*"`)

**Interfaces:**
- Consumes: `requireAgency` (Task 3), `serviceDb`/`createAccount` (Task 6), Clerk backend `clerkClient`.
- Produces: server action `createClientAccount(formData: FormData): Promise<void>` — used by Task 8's form. Field names: `name` (required), `timezone` (optional).

- [x] **Step 1: Wire workspace dep**

```bash
pnpm --filter web add "@bis/db@workspace:*"
```

Plan gap patched here (authorized): `@bis/db` has no build step and `packages/db/package.json` declared no entry point, so `import { serviceDb } from "@bis/db"` resolved to nothing. Added `"exports": { ".": "./src/index.ts" }` to `packages/db/package.json` and `transpilePackages: ["@bis/db"]` to `apps/web/next.config.ts` so both `tsc` and Next compile the TS source directly.

- [x] **Step 2: Implement the action**

`apps/web/src/app/dashboard/accounts/actions.ts`:
```ts
"use server";

import { clerkClient } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import { serviceDb, createAccount } from "@bis/db";

export async function createClientAccount(formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const name = String(formData.get("name") ?? "").trim();
  const timezone = String(formData.get("timezone") ?? "America/Chicago");
  if (!name) throw new Error("Account name is required");

  const clerk = await clerkClient();
  const org = await clerk.organizations.createOrganization({ name, createdBy: userId });
  try {
    await createAccount(serviceDb(), { clerkOrgId: org.id, name, timezone, actorId: userId });
  } catch (err) {
    // compensating rollback: never leave a Clerk org without a tenant row
    await clerk.organizations.deleteOrganization(org.id).catch(() => {});
    throw err;
  }
  revalidatePath("/dashboard/accounts");
}
```

- [x] **Step 3: Verify**

Run: `pnpm check`
Expected: typecheck green (behavioral verification happens in Task 8's manual pass — the action needs the form UI).

Result: green — both workspace projects typecheck clean, 2 files / 6 tests passing.

- [x] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: createClientAccount server action (Clerk org + tenant row, rollback on failure)"
```

---

### Task 8: Agency dashboard — accounts list, create form, account switcher

**Files:**
- Create: `apps/web/src/app/dashboard/accounts/page.tsx`
- Modify: `apps/web/src/app/dashboard/layout.tsx` (nav + switcher), `apps/web/src/app/dashboard/page.tsx` (link to accounts)

**Interfaces:**
- Consumes: `listAccounts`/`serviceDb` (Task 6), `createClientAccount` (Task 7), Clerk `<OrganizationSwitcher />`.

- [ ] **Step 1: Accounts page**

`apps/web/src/app/dashboard/accounts/page.tsx`:
```tsx
import { serviceDb, listAccounts } from "@bis/db";
import { createClientAccount } from "./actions";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const accounts = await listAccounts(serviceDb());
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Client Accounts</h1>
      <form action={createClientAccount} className="flex gap-2">
        <input name="name" placeholder="Business name" required
          className="rounded border px-3 py-2" />
        <input name="timezone" defaultValue="America/Chicago"
          className="rounded border px-3 py-2" />
        <button type="submit" className="rounded bg-black px-4 py-2 text-white">
          Create account
        </button>
      </form>
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b">
          <th className="py-2">Name</th><th>Status</th><th>Timezone</th><th>Created</th>
        </tr></thead>
        <tbody>
          {accounts.map(a => (
            <tr key={a.id} className="border-b">
              <td className="py-2">{a.name}</td>
              <td>{a.status}</td>
              <td>{a.timezone}</td>
              <td>{new Date(a.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
          {accounts.length === 0 && (
            <tr><td colSpan={4} className="py-6 text-gray-500">No client accounts yet.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Nav + switcher in dashboard layout**

Replace `apps/web/src/app/dashboard/layout.tsx` body:
```tsx
import Link from "next/link";
import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { requireAgency } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  await requireAgency();
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-8 flex items-center justify-between border-b pb-4">
        <nav className="flex items-center gap-6">
          <Link href="/dashboard" className="font-semibold">BIS Platform</Link>
          <Link href="/dashboard/accounts">Accounts</Link>
        </nav>
        <div className="flex items-center gap-4">
          <OrganizationSwitcher hidePersonal />
          <UserButton />
        </div>
      </header>
      {children}
    </div>
  );
}
```
In `apps/web/src/app/dashboard/page.tsx`, add under the `<h1>`:
```tsx
<p className="mt-4"><a className="underline" href="/dashboard/accounts">Manage client accounts →</a></p>
```

- [ ] **Step 3: End-to-end manual verification (the M0 acceptance test)**

Run: `pnpm --filter web dev`, then:
1. `/dashboard/accounts` → create "Test Client One".
2. Expected: row appears; Clerk dashboard shows the new Organization; Supabase `accounts` has the row with matching `clerk_org_id`; `events` has `account.created` with your user id as actor.
3. The OrganizationSwitcher lists "Test Client One" and switching works.
4. `pnpm check` green.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: agency dashboard — accounts list, create form, org switcher"
```

---

### Task 9: Deploy to Vercel + M0 close-out

**Files:**
- Modify: `README.md` (deploy section)
- Requires: USER SETUP #3 done

- [ ] **Step 1: Deploy config**

Vercel project root directory = `apps/web` (monorepo setting), install command `pnpm install`, build `pnpm --filter web build` (or Vercel's auto-detected equivalents). Env vars from `.env.example` set in Vercel (Production + Preview).

Append to `README.md`:
```markdown
## Deploy
Vercel project "bis-platform", root apps/web, push to main = deploy.
Env vars: see .env.example (service-role + db-url are server-only).
```

- [ ] **Step 2: Verify production**

Run: `git push` (after danlo's review-gate) → visit the Vercel URL `/dashboard` → sign in → create + see an account.
Expected: same behavior as local; no service keys exposed in client bundle (check page source for `SUPABASE_SERVICE_ROLE_KEY` — must be absent).

- [ ] **Step 3: Commit + tag**

```bash
git add README.md && git commit -m "docs: deploy notes" && git tag m0-foundation
```

---

## Self-Review (spec coverage for M0)

- Spec §3 tenancy tables + RLS ceilings → Tasks 4–5 (permission-bag *enforcement* logic lands with plans/features in M7; the columns exist now). ✔
- Spec §4 events keystone → Tasks 4–6 (emit on account.created; append-only proven in tests). ✔
- Spec §9 repo/conventions → Tasks 1–2, 9. ✔
- Spec §10 security/testing → Task 5 (isolation suite), service-key hygiene in Global Constraints + Task 9 check. ✔
- Deliberately NOT in M0 (per spec §8): contacts/pipelines (M1a plan), messaging (M1b), forms/blueprints/wizard (M1c), client-user subdomain login (arrives with M1 when clients have something to see).
