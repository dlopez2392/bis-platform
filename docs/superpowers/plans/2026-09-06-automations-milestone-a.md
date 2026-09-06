# Automations Milestone A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the automations spine — the `automations` config table, a cron harness that runs a registry of passes, the two live passes migrated onto it unchanged — and prove it with one recipe end to end: the review request after a completed job.

**Architecture:** Config is generic (one `automations` table keyed `(account_id, recipe_key)`), due-ness is domain-specific (a stamp on `bookings.review_requested_at`, so a cancelled booking just stops matching). The cron route becomes a thin caller of `runPasses(PASSES, ctx)`, where each pass is `{ key, run(ctx) → counters }` and owns its own query, gate, send and stamp; the harness only isolates errors, builds the context, and reports counters. Nothing new sends: email via the existing provider factory and template shell, SMS via `resolveSmsSender` then the existing provider, both handed to passes on `ctx`.

**Tech Stack:** Next.js 15 App Router (apps/web), Supabase Postgres + PostgREST via `@supabase/supabase-js` (packages/db), Clerk, vitest, Playwright, Vercel cron every 15 minutes.

**Spec:** `docs/superpowers/specs/2026-09-06-automations-design.md` — read Sections 2–5 before starting. This plan covers **Milestone A only**.

## Global Constraints

- **Branch:** all work on `feat/automations-a`, branched from `main` (which is 2 doc commits ahead of `origin/main`, deliberately unpushed). **Never merge to main yourself** — the final task requests review. Push to `main` deploys production.
- **Parallel sessions move this working tree.** Every command that writes or commits verifies the branch IN THE SAME COMMAND: `B="$(git branch --show-current)"; [ "$B" = "feat/automations-a" ] && git commit ... || echo "BRANCH MOVED TO $B"`. A branch verified five tool calls ago is not verified.
- **Migration 0025 is applied ONCE, by the orchestrating session, via the Supabase MCP `apply_migration` tool on project `tlbkbmlrfafquucsmsmm`** (the precedent for 0015–0024), after a pre-flight read. The e2e suite and `packages/db` tests share that ONE project with production. **Never re-apply. Never `db:push`.**
- **Off by default:** every `automations` row is `enabled=false`; nothing changes for any client on deploy.
- **Grants:** `authenticated` gets SELECT only on `automations` (the `voice_profiles` shape, `0019_voice_core.sql:38-42` + `0020`); every write goes through `serviceDb()` behind an `isAgency` check.
- **The brand-name leak:** `PassContext` and `DueReviewRequest` carry `brandName` and never `accountName`. `accounts.name` is the agency's internal label ("Rio Roofing — trial"); it has reached customers three times.
- **Caps** are fixed constants, recipe passes only: `AUTOMATION_TICK_CAP = 10` per pass per tick, `AUTOMATION_DAILY_CAP = 25` per pass per account per rolling 24h counted from the pass's own stamp column. **The reminder and follow-up passes stay uncapped.**
- **The harness commit (Task 5) may not edit `apps/web/src/app/api/cron/reminders/route.test.ts`.** Its 30 tests, unchanged, are the proof the migration preserved behaviour. The recipe commit (Task 8) extends that file only to add the new response key and the new mocks.
- **Send-then-stamp** on `review_requested_at` through `stampWithRetry` (`apps/web/src/lib/booking/stamp-retry.ts`). At 15-minute ticks an unstamped send is up to twelve duplicates.
- **Staleness cap** `REVIEW_REQUEST_MAX_AGE_MS = 61h` (= `FOLLOWUP_MAX_AGE_MS` 37h + 24h), defined ONCE in `packages/db` and imported by the web gate.
- **Zone tests:** one instant, two zones, opposite verdicts. `America/Chicago` (the dev machine) only ever as one half of a pair. Every instant computed with `Intl.DateTimeFormat` before the assertion is written (the plan gives the node one-liner each time).
- **Every test names its mutation.** A test whose mutation leaves it green is not finished.
- **Copy:** plain language a business owner reads at 7 AM; no `{{template_syntax}}` on client-facing surfaces (the `{name}` placeholder in `messages.ts` is filled at runtime by code, never by an operator — the text-back precedent). UI uses the existing components exactly as `voice-settings.tsx` does; no hard-coded colours.
- **`pnpm check` = typecheck + lint + db tests + web tests.** Baseline at `main` `ec21c9e`: db 183 · web 1160 · e2e 67/67. Run gates with `cmd > out.txt 2>&1; echo "exit=$?"` — pipes mask exit codes.
- **Never run the e2e suite while a live voice/video test is in progress** — it wipes Test Client One's calendar by design.

---

## File Structure

**packages/db**
- `supabase/migrations/0025_automations.sql` — CREATE. Table, RLS, grants, `bookings.review_requested_at`, partial index.
- `src/automations.ts` — CREATE. `RecipeKey`, `AutomationRow`, `ReviewRequestConfig`, `parseReviewRequestConfig`, `getAutomation`, `upsertAutomation`, `REVIEW_REQUEST_MAX_AGE_MS`, `DueReviewRequest`, `listDueReviewRequests`, `stampReviewRequested`, `countReviewRequestsSince`.
- `src/booking.ts` — MODIFY. Export `REMINDER_WINDOW_START_MS`, `REMINDER_WINDOW_END_MS`, `FOLLOWUP_QUERY_WINDOW_MS`; add `review_requested_at` to `BookingRow`/`BOOKING_COLS`; extract `loadAccountBrandInfo` (the per-account `accounts` read the three due-lists share).
- `src/branding.ts` — MODIFY. `brandDisplayName` moves here (one definition, reachable from the data layer).
- `src/index.ts` — MODIFY. Exports.
- `src/test/fixtures.ts` — MODIFY. `automations` joins the cleanup loop.
- `src/test/automations-grants.test.ts` — CREATE. Grants + RLS, real DB, rolled back.
- `src/test/automations.test.ts` — CREATE. Accessors, real DB.
- `src/test/branding.test.ts` — MODIFY. `brandDisplayName` cases.

**apps/web**
- `src/lib/booking/followup-timing.ts` — MODIFY. Export `isInMorningBand`, `isStrictlyEarlierLocalDay`; re-express `shouldSendFollowupNow` on them. Its test file is NOT edited.
- `src/lib/booking/followup-timing.helpers.test.ts` — CREATE.
- `src/lib/email/templates/shell.ts` — MODIFY. Re-export `brandDisplayName`; add `emailBrandNamed`.
- `src/lib/email/templates/shell.test.ts` — MODIFY. One case for `emailBrandNamed`.
- `src/lib/email/templates/review-request.ts` + `.test.ts` — CREATE.
- `src/lib/automations/context.ts` — CREATE. `PassContext`, `Pass`, `PassCounters`.
- `src/lib/automations/harness.ts` — CREATE. `buildPassContext`, `runPasses`. The ONLY automations file allowed to import the provider factories.
- `src/lib/automations/registry.ts` — CREATE. `PASSES`.
- `src/lib/automations/caps.ts` — CREATE.
- `src/lib/automations/passes/reminders.ts`, `passes/followups.ts` — CREATE. The two live loops, moved.
- `src/lib/automations/passes/review-request.ts` + `.test.ts` — CREATE.
- `src/lib/automations/review-request-gate.ts` + `.test.ts` — CREATE.
- `src/lib/automations/review-request-copy.ts` + `.test.ts` — CREATE. `defaultReviewRequestBody`, `composeReviewRequestSms`.
- `src/lib/automations/harness.test.ts`, `imports.test.ts`, `cron-coupling.test.ts`, `sentinel.test.ts` — CREATE.
- `src/app/api/cron/reminders/route.ts` — MODIFY. Thin caller.
- `src/app/api/cron/reminders/route.test.ts` — MODIFY in Task 8 ONLY.
- `src/app/(dashboard)/dashboard/accounts/[accountId]/automations/{page.tsx,page.test.ts,actions.ts,actions.test.ts,automations-settings.tsx}` — CREATE.
- `src/lib/messages.ts`, `src/lib/nav-groups.ts`, `src/lib/nav-groups.test.ts`, `src/components/app-sidebar.tsx`, `src/lib/palette/registry.ts` — MODIFY.
- `e2e/support.ts` — MODIFY (`mintClientToken` moves here). `e2e/client-branding.spec.ts` — MODIFY (imports it). `e2e/fixtures/sweep.ts` — MODIFY (`automations` in the cascade). `e2e/automations.spec.ts` — CREATE.

---

### Task 1: Migration 0025, proven by grants tests written and watched failing first

**Files:**
- Create: `packages/db/supabase/migrations/0025_automations.sql`
- Create: `packages/db/src/test/automations-grants.test.ts`
- Create: `apps/web/e2e/automations.spec.ts`
- Modify: `apps/web/e2e/support.ts` (append `mintClientToken`)
- Modify: `apps/web/e2e/client-branding.spec.ts:20-42` (delete the local `mintClientToken`, import it)
- Modify: `apps/web/e2e/fixtures/sweep.ts:76-78`
- Modify: `packages/db/src/test/fixtures.ts:26-30`

**Interfaces:**
- Produces: table `public.automations(id, account_id, recipe_key, enabled, body, config, created_at, updated_at)` unique `(account_id, recipe_key)`, check `recipe_key in ('review_request')`; column `public.bookings.review_requested_at timestamptz`; e2e helper `mintClientToken(userId: string): Promise<string>` in `e2e/support.ts`.

- [ ] **Step 1: Create the branch, verifying the tree is clean and on main in the same command**

```bash
cd /c/Users/danlo/bis-platform && [ -z "$(git status --porcelain)" ] && [ "$(git branch --show-current)" = "main" ] && git checkout -b feat/automations-a && echo "NOW ON: $(git branch --show-current)" || { echo "NOT CLEAN OR NOT ON MAIN"; git status --porcelain; git branch --show-current; }
```
Expected: `Switched to a new branch 'feat/automations-a'` then `NOW ON: feat/automations-a`.

- [ ] **Step 2: Write the migration**

`packages/db/supabase/migrations/0025_automations.sql`:

```sql
-- 0025: automations — the generic config spine for built-in recipes.
--
-- Config is GENERIC (one row per account per recipe: a toggle, a body, a jsonb
-- config), due-ness is DOMAIN-SPECIFIC (a stamp on the domain row, here
-- bookings.review_requested_at), so a booking that is cancelled or
-- un-completed simply stops matching the due query — no void step.
--
-- Grants copy voice_profiles (0019 + 0020), NOT calendars (0022): every
-- recipe here spends the client's money and messages their customers, so v1
-- is agency-configured. `authenticated` reads its own row under RLS; every
-- write goes through serviceDb() behind an isAgency check. Supabase default
-- privileges auto-grant ALL on a new table (the 0020 lesson), so the revoke
-- is in THIS migration rather than a follow-up.
--
-- OFF BY DEFAULT: enabled=false. Nothing changes for any client on deploy.
--
-- recipe_key is CHECK-constrained to the catalogue: this platform ships fixed
-- recipes, not a rule builder, and the database is where that is enforced.
-- Milestone B extends the list in its own migration.

create table public.automations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict,
  recipe_key text not null check (recipe_key in ('review_request')),
  enabled boolean not null default false,
  body text not null default '',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, recipe_key)
);
alter table public.automations enable row level security;
create policy automations_tenant on public.automations for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
grant select on public.automations to authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.automations from authenticated;
revoke all on public.automations from anon;

-- The review request's dedupe stamp. Send-then-stamp, like reminder_sent_at
-- and followup_sent_at: it marks a confirmed send, never an attempt.
alter table public.bookings add column review_requested_at timestamptz;
create index bookings_review_due
  on public.bookings (ends_at) where status = 'completed' and review_requested_at is null;
```

- [ ] **Step 3: Write the db-level grants + RLS test**

`packages/db/src/test/automations-grants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

/**
 * The boundary 0025 draws, pinned in both directions and at the level that
 * can actually see it. Unit tests that mock the db are blind to grants (four
 * shipped defects in this repo); these run real SQL inside a transaction
 * that is rolled back.
 */
describe("0025 automations privileges", () => {
  it("grants authenticated SELECT and nothing else; anon gets nothing", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
        `select grantee, privilege_type from information_schema.role_table_grants
          where table_schema = 'public' and table_name = 'automations'
            and grantee in ('authenticated', 'anon')
          order by grantee, privilege_type`,
      );
      expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
    });
  });

  it("never grants a client UPDATE on bookings.review_requested_at (or any bookings column)", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'bookings' and privilege_type = 'UPDATE'`,
      );
      expect(rows).toEqual([]);
    });
  });
});

async function seedTwoAccounts(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [a] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,'org_AUTO_A','Alpha',true) returning id", [agency.id]);
  const { rows: [b] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,'org_AUTO_B','Bravo',true) returning id", [agency.id]);
  await c.query(
    "insert into automations (account_id, recipe_key) values ($1,'review_request'),($2,'review_request')",
    [a.id, b.id]);
  return { a: a.id as string, b: b.id as string };
}

describe("0025 automations RLS", () => {
  it("a client reads only its own row", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_AUTO_A" });
      const { rows } = await c.query("select account_id from automations");
      expect(rows.map((r: any) => r.account_id)).toEqual([a]);
    }));

  it("a client cannot insert or update, and the refusal is insufficient_privilege (42501)", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await actAs(c, { org_id: "org_AUTO_A" });
      // 42501, not an RLS violation and not a constraint: the grant is
      // checked before either. A misspelled column would be 42703.
      await expect(
        c.query("update automations set enabled = true where account_id = $1", [a]),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        c.query("insert into automations (account_id, recipe_key) values ($1, 'review_request')", [a]),
      ).rejects.toMatchObject({ code: "42501" });
    }));

  it("the agency reads every row", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoAccounts(c);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select account_id from automations where account_id in ($1,$2) order by account_id", [a, b]);
      expect(rows.map((r: any) => r.account_id).sort()).toEqual([a, b].sort());
    }));
});
```

- [ ] **Step 4: Run it and watch it fail for the RIGHT reason (table absent)**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations-grants.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/gate-grants-pre.txt 2>&1; echo "exit=$?"; grep -E "42P01|does not exist|✓|✗|×|passed|failed" /c/Users/danlo/AppData/Local/Temp/claude/gate-grants-pre.txt | head -20
```
Expected: `exit=1`. The privileges test fails because `rows` is `[]` (no such table, so no grants); the RLS tests reject with `relation "automations" does not exist` (`42P01`). If instead they PASS, the table already exists — STOP and report; 0025 may have been applied by another session.

- [ ] **Step 5: Move `mintClientToken` into `e2e/support.ts`**

Append to `apps/web/e2e/support.ts` (the file already imports `existsSync, readFileSync` from `node:fs`):

```ts
/**
 * A real Clerk session token for a fixture's CLIENT user, minted the same
 * two-call way packages/db's user-client integration test does.
 *
 * Not stubbed. The boundary under test is Clerk's claims meeting Supabase's
 * policies, so a hand-made JWT would prove nothing about either — it would
 * only prove that a token the test invented is accepted or rejected. Shared
 * by client-branding.spec.ts and automations.spec.ts.
 */
export async function mintClientToken(userId: string): Promise<string> {
  const sk = process.env.CLERK_SECRET_KEY;
  if (!sk) throw new Error("CLERK_SECRET_KEY missing — this spec cannot run hermetically");
  const headers = { Authorization: `Bearer ${sk}`, "Content-Type": "application/json" };

  const session = (await (await fetch("https://api.clerk.com/v1/sessions", {
    method: "POST", headers, body: JSON.stringify({ user_id: userId }),
  })).json()) as { id?: string };
  if (!session.id) throw new Error(`could not create a Clerk session for ${userId}`);

  const token = (await (await fetch(
    `https://api.clerk.com/v1/sessions/${session.id}/tokens`, { method: "POST", headers },
  )).json()) as { jwt?: string };
  if (!token.jwt) throw new Error("Clerk returned no jwt");
  return token.jwt;
}
```

In `apps/web/e2e/client-branding.spec.ts`: delete the local `async function mintClientToken(...)` (lines 20–42, the doc comment included) and add `import { mintClientToken } from "./support";` after the `@bis/db` import. Nothing else in that file changes.

- [ ] **Step 6: Write the e2e grants spec**

`apps/web/e2e/automations.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess } from "@bis/db";
import { mintClientToken } from "./support";

// Same two paths, same reason, as auth.setup.ts: this file calls serviceDb()
// and the Clerk API from the Playwright runner process, not through a Next
// request, so nothing auto-loads the env for it.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

type ClientFixture = { accountId: string; clerkUserId: string };
const fixture = (): ClientFixture =>
  JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

/**
 * PostgREST, called directly with the client's own token — the branding
 * spec's `patchAccount`, generalised to a verb. Returns the raw body as well
 * as the status: a bare `status >= 400` passes for ANY refusal, including a
 * typo'd column, so the assertions below read the REASON.
 */
async function rest(
  token: string, method: "GET" | "POST" | "PATCH", query: string, body?: Record<string, unknown>,
): Promise<{ status: number; rows: unknown[]; body: string }> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/automations?${query}`, {
    method,
    headers: {
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const rows = res.ok ? (JSON.parse(text) as unknown[]) : [];
  return { status: res.status, rows, body: text };
}

// client-access.spec.ts switches the fixture's access OFF and does not restore
// it (auth.teardown deletes the fixture). Establish the precondition here, as
// client-branding.spec.ts does, so filename order cannot decide the result.
test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

/**
 * The M2 lesson governs this file: the POSITIVE case comes first, because
 * every negative below would pass just as happily against a client that can
 * read nothing at all.
 *
 * Cross-tenant READ isolation is proven in packages/db's
 * automations-grants.test.ts (two seeded accounts, rolled back). It is not
 * repeated here because the only other account this runner can see is the
 * agency's live seeded one, and CLAUDE.md forbids mutating specs on it.
 */
test.describe("a client's automations boundary, at the database", () => {
  test("reads its own row, and is refused BY PRIVILEGE on every write", async () => {
    const { accountId, clerkUserId } = fixture();
    const db = serviceDb();
    // A raw insert, not the accessor: this spec is written before the
    // accessor exists (Task 1) and keeps proving the grant whatever the
    // accessor later does.
    const { data: seeded, error: seedErr } = await db.from("automations")
      .insert({ account_id: accountId, recipe_key: "review_request" })
      .select("id").single();
    if (seedErr || !seeded) throw new Error(`could not seed the automations row: ${seedErr?.message}`);
    const token = await mintClientToken(clerkUserId);

    try {
      // 1. THE POSITIVE CASE.
      const own = await rest(token, "GET", `account_id=eq.${accountId}&select=id,recipe_key,enabled`);
      expect(own.status, own.body).toBe(200);
      expect(own.rows).toEqual([{ id: seeded.id, recipe_key: "review_request", enabled: false }]);

      // 2. INSERT. `42501` is insufficient_privilege; a misspelled column
      //    would be PGRST204 and an RLS refusal 42501-free — this discriminates.
      const insert = await rest(token, "POST", "select=id",
        { account_id: accountId, recipe_key: "review_request" });
      expect(insert.status).toBeGreaterThanOrEqual(400);
      expect(insert.body, "insert must be refused by privilege").toContain("42501");

      // 3. UPDATE — the escalation the grant exists to stop: a client
      //    switching their own automation on.
      const update = await rest(token, "PATCH", `id=eq.${seeded.id}&select=id`, { enabled: true });
      expect(update.status).toBeGreaterThanOrEqual(400);
      expect(update.body, "update must be refused by privilege").toContain("42501");
      const { data: after } = await db.from("automations").select("enabled").eq("id", seeded.id).single();
      expect((after as { enabled: boolean } | null)?.enabled).toBe(false);
    } finally {
      await db.from("automations").delete().eq("id", seeded.id);
    }
  });
});
```

- [ ] **Step 7: Add `automations` to both cleanup cascades**

`apps/web/e2e/fixtures/sweep.ts:76-78` — the table list becomes:
```ts
  for (const table of ["calls", "bookings", "messages", "conversations", "calendars",
                       "checklist_items", "form_submissions",
                       "forms", "contacts", "events", "voice_profiles", "phone_numbers",
                       "automations"]) {
```

`packages/db/src/test/fixtures.ts` — in the `withTestAccount` loop, add `"automations"` after `"phone_numbers"`:
```ts
                         "voice_profiles", "phone_numbers", "automations"]) {
```
Both are `on delete restrict` upstream of `accounts`; without this the account delete fails and the next run's unique constraints fail somewhere else entirely.

- [ ] **Step 8: Run the e2e spec and watch it fail for the right reason**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx playwright test automations.spec.ts > /c/Users/danlo/AppData/Local/Temp/claude/gate-e2e-auto-pre.txt 2>&1; echo "exit=$?"; grep -E "PGRST205|42P01|could not seed|passed|failed" /c/Users/danlo/AppData/Local/Temp/claude/gate-e2e-auto-pre.txt | head
```
Expected: `exit=1` and the failure is `could not seed the automations row: Could not find the table 'public.automations' in the schema cache` (PostgREST reports a missing table as `PGRST205`; the raw Postgres code `42P01` appears only at the pg level, as in Step 4). That is the proof the spec cannot pass by accident. (This run builds the app first: ~2–3 minutes.)

- [ ] **Step 9: Pre-flight read, then apply 0025 — orchestrating session only, via the Supabase MCP**

Pre-flight (`execute_sql` on project `tlbkbmlrfafquucsmsmm`):
```sql
select to_regclass('public.automations') as automations_table,
       (select count(*) from information_schema.columns
         where table_name = 'bookings' and column_name = 'review_requested_at') as review_col,
       (select version from supabase_migrations.schema_migrations order by version desc limit 1) as latest;
```
Expected: `automations_table` null · `review_col` 0 · `latest` is the 0024 entry. **If any differs, STOP and report — do not apply.**

Apply: `apply_migration` with `name: "0025_automations"` and the exact SQL of the file from Step 2.

Post-verify (`execute_sql`):
```sql
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'automations' and grantee in ('authenticated','anon')
 order by 1, 2;
```
Expected: exactly one row, `authenticated · SELECT`. Record in the ledger: **MIGRATION 0025 APPLIED — NEVER RE-APPLY.**

- [ ] **Step 10: Run both proofs and see them pass**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations-grants.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/gate-grants.txt 2>&1; echo "exit=$?"; tail -8 /c/Users/danlo/AppData/Local/Temp/claude/gate-grants.txt
cd /c/Users/danlo/bis-platform/apps/web && npx playwright test automations.spec.ts client-branding.spec.ts > /c/Users/danlo/AppData/Local/Temp/claude/gate-e2e-auto.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/gate-e2e-auto.txt
```
Expected: both `exit=0`; 5 db tests passed; 3 e2e tests passed (client-branding still runs with the moved helper).

- [ ] **Step 11: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-a" ] && git add packages/db/supabase/migrations/0025_automations.sql packages/db/src/test/automations-grants.test.ts packages/db/src/test/fixtures.ts apps/web/e2e/automations.spec.ts apps/web/e2e/support.ts apps/web/e2e/client-branding.spec.ts apps/web/e2e/fixtures/sweep.ts && git commit -q -m "feat(db): 0025 automations table + review stamp, grants pinned at db and PostgREST" && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```


---

### Task 2: `brandDisplayName` in the db package (with a parity test) and `emailBrandNamed`

The review-request due-list resolves the customer-facing name in the DATA layer so the row never carries `accounts.name`. The resolver is a one-liner (`branding.brandName ?? accountName`) that lives in `shell.ts` and cannot be imported by `packages/db`. It also cannot simply MOVE: `shell.ts` is exercised by many web tests that mock `@bis/db` with a factory (`route.test.ts`, `finish-call.test.ts`, the booking action tests), and vitest throws on any export a factory omits — an import of `brandDisplayName` from `@bis/db` inside `shell.ts` would break every one of them. So the db package gets its own copy, and a parity test pins the two against each other over the whole input space that matters. Two copies with a test beats one copy that breaks thirty tests, and the test is what turns "two copies" into "one rule".

**Files:**
- Modify: `packages/db/src/branding.ts` (append)
- Modify: `packages/db/src/index.ts:47-48`
- Modify: `packages/db/src/test/branding.test.ts` (append)
- Modify: `apps/web/src/lib/email/templates/shell.ts:15-43`
- Create: `apps/web/src/lib/email/templates/brand-name-parity.test.ts`

**Interfaces:**
- Produces: `brandDisplayName(branding: Branding, accountName: string): string` exported from `@bis/db` (the web copy in `shell.ts` is unchanged); `emailBrandNamed(branding: Branding, name: string): EmailBrand` from `shell.ts`; `emailBrand` now delegates to it.

- [ ] **Step 1: Write the failing db test**

Append to `packages/db/src/test/branding.test.ts` (add `brandDisplayName` to its existing `../branding` import, or add the import if the file has none):

```ts
describe("brandDisplayName — the db copy of the ONE customer-facing name rule", () => {
  const base = {
    brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  } as const;

  it("prefers brand_name over the agency's internal accounts.name label", () => {
    expect(brandDisplayName({ ...base, brandName: "Rio Roofing" }, "Rio Roofing — trial"))
      .toBe("Rio Roofing");
  });

  it("falls back to accounts.name only when brand_name is null", () => {
    expect(brandDisplayName({ ...base, brandName: null }, "Rio Roofing — trial"))
      .toBe("Rio Roofing — trial");
  });

  it("does not treat an empty-string brand_name as unset (identical to the web copy)", () => {
    expect(brandDisplayName({ ...base, brandName: "" }, "Fallback")).toBe("");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/branding.test.ts 2>&1 | grep -E "brandDisplayName|is not a function|does not provide|passed|failed" | head -4
```
Expected: FAIL — `brandDisplayName` is not exported from `../branding`.

- [ ] **Step 3: Add the db copy**

Append to `packages/db/src/branding.ts`:

```ts
/**
 * The company name a CUSTOMER may be shown — `brand_name`, falling back to
 * the agency's internal `accounts.name` label ("Rio Roofing — trial") only
 * when no brand name is set.
 *
 * DELIBERATELY A SECOND COPY of `brandDisplayName` in
 * `apps/web/src/lib/email/templates/shell.ts`, and the only one allowed:
 * the data layer cannot import from the web app, and the web copy cannot
 * import from here without breaking every web test that mocks `@bis/db`
 * with a factory (vitest throws on an export the factory omits). The two are
 * pinned against each other in
 * `apps/web/src/lib/email/templates/brand-name-parity.test.ts`; change one,
 * and that test says so. Used by the automations due-lists so a due-row
 * carries the resolved `brandName` and never the internal label.
 */
export function brandDisplayName(branding: Branding, accountName: string): string {
  return branding.brandName ?? accountName;
}
```

In `packages/db/src/index.ts` change the branding export line to:
```ts
export { uploadBrandLogo, removeBrandLogo, brandLogoUrl, setBranding, getBranding, brandDisplayName,
         type Branding } from "./branding";
```

- [ ] **Step 4: `emailBrandNamed` in `shell.ts`, and the cross-reference on the web copy**

In `apps/web/src/lib/email/templates/shell.ts`, add this paragraph to the END of `brandDisplayName`'s existing doc comment (the function itself is untouched):

```ts
 *
 * `packages/db/src/branding.ts` carries a deliberate second copy for the
 * automations due-lists (the data layer cannot import this module, and this
 * module cannot import that one without breaking every factory mock of
 * `@bis/db` in the web tests). brand-name-parity.test.ts pins them equal.
```

Then replace `emailBrand` with:

```ts
/**
 * `emailBrand` for a caller that has ALREADY resolved the customer-facing
 * name — the automations passes, whose due-rows carry `brandName` and never
 * `accounts.name`. `emailBrand` below is the same thing for callers that
 * still hold both.
 */
export function emailBrandNamed(branding: Branding, name: string): EmailBrand {
  return {
    name,
    logoUrl: branding.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null,
    // `false`, not `true`: an email card sits on white, which is exactly what
    // this resolver lifts against. It returns the brand colour raised until it
    // can carry a legible label, plus that label's colour. Using the raw hex
    // here would reintroduce the two AA defects M4b found live in production.
    accent: publicFormTheme(branding, false).formAccent,
  };
}

export function emailBrand(branding: Branding, accountName: string): EmailBrand {
  return emailBrandNamed(branding, brandDisplayName(branding, accountName));
}
```

- [ ] **Step 5: The parity test (its own file, so no existing mock is disturbed)**

`apps/web/src/lib/email/templates/brand-name-parity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { brandDisplayName as dbBrandDisplayName, type Branding } from "@bis/db";
import { brandDisplayName, emailBrand, emailBrandNamed } from "./shell";

const base: Omit<Branding, "brandName"> = {
  brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};

describe("brandDisplayName — the web copy and the @bis/db copy are ONE rule", () => {
  it("answer identically across the input space that matters", () => {
    const cases: [string | null, string][] = [
      ["Rio Roofing", "Rio Roofing — trial"],
      [null, "Rio Roofing — trial"],
      ["", "Fallback"],
      ["  ", "Fallback"],
      [null, ""],
    ];
    for (const [brandName, accountName] of cases) {
      const b = { ...base, brandName };
      expect(brandDisplayName(b, accountName), JSON.stringify([brandName, accountName]))
        .toBe(dbBrandDisplayName(b, accountName));
    }
  });
});

describe("emailBrandNamed", () => {
  it("is emailBrand with the name already chosen — identical output for the same inputs", () => {
    const b = { ...base, brandName: "Rio Roofing", brandColor: "#1e3a8a" };
    expect(emailBrandNamed(b, "Rio Roofing")).toEqual(emailBrand(b, "Rio Roofing — trial"));
    expect(emailBrandNamed(b, "Rio Roofing").name).toBe("Rio Roofing");
  });
});
```

- [ ] **Step 6: Run both packages' affected tests and the typecheck**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/branding.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/t2a.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/t2a.txt
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/email src/app/api/cron src/lib/voice > /c/Users/danlo/AppData/Local/Temp/claude/t2b.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/t2b.txt
cd /c/Users/danlo/bis-platform && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t2c.txt 2>&1; echo "exit=$?"
```
Expected: all `exit=0`. The cron route tests (which mock `@bis/db` with a factory) must still pass — that is the whole reason for the two-copy shape.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-a" ] && git add packages/db/src/branding.ts packages/db/src/index.ts packages/db/src/test/branding.test.ts apps/web/src/lib/email/templates/shell.ts apps/web/src/lib/email/templates/brand-name-parity.test.ts && git commit -q -m "feat(brand): brandDisplayName in @bis/db for the data layer, parity-tested against the web copy; emailBrandNamed" && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 3: The data layer — `automations.ts`, window constants, the shared account read

**Files:**
- Modify: `packages/db/src/booking.ts` (types at 19-25 and 82-84; constants; `listDueReminders` 411-476; `listDueFollowups` 548-620)
- Create: `packages/db/src/automations.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/test/automations.test.ts`

**Interfaces:**
- Consumes: `brandDisplayName` (Task 2), `emit` (`events.ts`), `Branding` (`branding.ts`).
- Produces (all exported from `@bis/db`):
  - `REMINDER_WINDOW_START_MS = 23h`, `REMINDER_WINDOW_END_MS = 24h15m`, `FOLLOWUP_QUERY_WINDOW_MS = 37h`, `REVIEW_REQUEST_MAX_AGE_MS = 61h`
  - `type RecipeKey = "review_request"`; `type ReviewRequestChannel = "email" | "sms"`; `type ReviewRequestConfig = { channel: ReviewRequestChannel; reviewUrl: string }`
  - `parseReviewRequestConfig(raw: unknown): ReviewRequestConfig | null`
  - `type AutomationRow = { id; account_id; recipe_key: RecipeKey; enabled: boolean; body: string; config: unknown; created_at; updated_at }`
  - `getAutomation(db, accountId, recipeKey): Promise<AutomationRow | null>`
  - `upsertAutomation(db, accountId, recipeKey, patch: { enabled: boolean; body: string; config: Record<string, unknown> }, actorId, actorType?): Promise<AutomationRow>`
  - `type DueReviewRequest = { bookingId; accountId; endsAt; followupSentAt: string | null; contactId; contactEmail: string | null; contactPhone: string | null; brandName: string; branding: Branding; accountTimezone: string; fromEmail: string | null; replyToEmail: string | null; body: string; config: ReviewRequestConfig | null }`
  - `listDueReviewRequests(db, nowIso): Promise<DueReviewRequest[]>`
  - `stampReviewRequested(db, bookingId): Promise<void>`
  - `countReviewRequestsSince(db, accountId, sinceIso): Promise<number>`
  - `BookingRow.review_requested_at: string | null`

- [ ] **Step 1: Write the failing tests**

`packages/db/src/test/automations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { setBranding } from "../branding";
import {
  getOrCreateCalendar, createBooking, setBookingStatus, cancelBookingByToken,
  stampFollowupSent,
} from "../booking";
import {
  parseReviewRequestConfig, getAutomation, upsertAutomation,
  listDueReviewRequests, stampReviewRequested, countReviewRequestsSince,
  REVIEW_REQUEST_MAX_AGE_MS,
} from "../automations";

const HOUR = 60 * 60 * 1000;

describe("parseReviewRequestConfig — jsonb is untrusted on read AND write", () => {
  it("accepts exactly a channel and an http(s) url", () => {
    expect(parseReviewRequestConfig({ channel: "sms", reviewUrl: "https://g.page/r/abc/review" }))
      .toEqual({ channel: "sms", reviewUrl: "https://g.page/r/abc/review" });
    expect(parseReviewRequestConfig({ channel: "email", reviewUrl: " http://example.com/review " }))
      .toEqual({ channel: "email", reviewUrl: "http://example.com/review" });
  });

  it("returns null for every shape the pass must treat as missing", () => {
    for (const bad of [
      null, undefined, "str", 42, [],
      {}, { channel: "sms" }, { reviewUrl: "https://x.example" },
      { channel: "fax", reviewUrl: "https://x.example" },
      { channel: "sms", reviewUrl: "" }, { channel: "sms", reviewUrl: "   " },
      { channel: "sms", reviewUrl: 7 }, { channel: "sms", reviewUrl: "not a url" },
      { channel: "sms", reviewUrl: "javascript:alert(1)" },
      { channel: "sms", reviewUrl: "ftp://x.example/review" },
      { channel: "sms", reviewUrl: `https://x.example/${"a".repeat(2100)}` },
    ]) {
      expect(parseReviewRequestConfig(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("automations accessors", () => {
  it("getAutomation is null until the first save; upsert is insert-then-update on ONE row", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getAutomation(db, accountId, "review_request")).toBeNull();
      const first = await upsertAutomation(db, accountId, "review_request",
        { enabled: false, body: "", config: { channel: "email", reviewUrl: "" } }, "user_test");
      expect(first.enabled).toBe(false);
      const second = await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "Please review us", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
        "user_test");
      expect(second.id).toBe(first.id);
      expect(second.enabled).toBe(true);
      expect(second.body).toBe("Please review us");
      expect(second.config).toEqual({ channel: "sms", reviewUrl: "https://g.page/r/x/review" });
      const { data: ev } = await db.from("events").select("type, payload")
        .eq("account_id", accountId).eq("type", "automation.updated");
      expect(ev).toHaveLength(2);
    });
  });

  it("listDueReviewRequests: enabled account, completed booking inside 61h → due, with brandName never accounts.name", async () => {
    await withTestAccount(async (db, accountId) => {
      // The fixture account is named "Fixture Co"; the customer-facing name is
      // the brand name, and the due row must carry ONLY that.
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "Loved working with you?", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
        "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Rev", email: "rev@example.com", phone: "(956) 555-0101" }, "user_test");

      const now = new Date("2027-03-10T12:00:00Z");
      const mk = (endsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(endsAt.getTime() - 30 * 60 * 1000), endsAt },
        "user_test");

      const due = await mk(new Date("2027-03-10T10:00:00Z"));          // ended 2h ago
      await setBookingStatus(db, accountId, due.id, "completed", "user_test");
      const stillBooked = await mk(new Date("2027-03-10T09:00:00Z"));  // completed status never set
      const stamped = await mk(new Date("2027-03-10T08:00:00Z"));
      await setBookingStatus(db, accountId, stamped.id, "completed", "user_test");
      await stampReviewRequested(db, stamped.id);
      const tooOld = await mk(new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS - HOUR));   // 62h ago
      await setBookingStatus(db, accountId, tooOld.id, "completed", "user_test");
      const oldButInside = await mk(new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS + HOUR)); // 60h ago
      await setBookingStatus(db, accountId, oldButInside.id, "completed", "user_test");
      await stampFollowupSent(db, oldButInside.id);
      const cancelled = await mk(new Date("2027-03-10T07:00:00Z"));
      await cancelBookingByToken(db, cancelled.cancelToken);

      const list = await listDueReviewRequests(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(due.id);
      expect(ids).toContain(oldButInside.id);
      expect(ids).not.toContain(stillBooked.id);
      expect(ids).not.toContain(stamped.id);
      expect(ids).not.toContain(tooOld.id);
      expect(ids).not.toContain(cancelled.id);

      const row = list.find((r) => r.bookingId === due.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row.contactEmail).toBe("rev@example.com");
      expect(row.contactPhone).toBe("(956) 555-0101");   // raw; the pass normalises
      expect(row.contactId).toBe(contactId);
      expect(new Date(row.endsAt).getTime()).toBe(new Date("2027-03-10T10:00:00Z").getTime());
      expect(row.followupSentAt).toBeNull();
      expect(row.body).toBe("Loved working with you?");
      expect(row.config).toEqual({ channel: "sms", reviewUrl: "https://g.page/r/x/review" });
      expect(typeof row.accountTimezone).toBe("string");
      expect(row.fromEmail).toBeNull();
      expect(row.replyToEmail).toBeNull();

      const deferred = list.find((r) => r.bookingId === oldButInside.id)!;
      expect(deferred.followupSentAt).not.toBeNull();     // the collision input, carried through
    });
  });

  it("listDueReviewRequests: a disabled row yields nothing; an invalid stored config yields the row with config null", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Rev" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-10T09:30:00Z"), endsAt: new Date("2027-03-10T10:00:00Z") },
        "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      const now = "2027-03-10T12:00:00Z";

      await upsertAutomation(db, accountId, "review_request",
        { enabled: false, body: "", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      expect((await listDueReviewRequests(db, now)).map((r) => r.bookingId)).not.toContain(b.id);

      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "sms", reviewUrl: "javascript:alert(1)" } }, "user_test");
      const rows = await listDueReviewRequests(db, now);
      const row = rows.find((r) => r.bookingId === b.id)!;
      expect(row.config).toBeNull();
      expect(row.contactEmail).toBeNull();
      expect(row.contactPhone).toBeNull();
    });
  });

  it("stampReviewRequested is idempotent, and countReviewRequestsSince counts only stamps after the floor", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Rev" }, "user_test");
      const mk = (h: number) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(`2027-03-10T${String(h).padStart(2, "0")}:00:00Z`),
          endsAt: new Date(`2027-03-10T${String(h).padStart(2, "0")}:30:00Z`) }, "user_test");
      const a = await mk(8); const b = await mk(9); const c = await mk(10);
      const before = new Date();
      await stampReviewRequested(db, a.id);
      await stampReviewRequested(db, a.id);
      await stampReviewRequested(db, b.id);
      void c;
      expect(await countReviewRequestsSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(2);
      expect(await countReviewRequestsSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations.test.ts 2>&1 | grep -E "Cannot find module|Failed to resolve|passed|failed" | head -3
```
Expected: FAIL — `../automations` cannot be resolved.

- [ ] **Step 3: Constants, the shared account read, and `review_requested_at` in `booking.ts`**

In `packages/db/src/booking.ts`:

(a) `BookingRow` — add after `followup_sent_at: string | null;`:
```ts
  review_requested_at: string | null;
```
(b) `BOOKING_COLS` — append `, review_requested_at` inside the string:
```ts
const BOOKING_COLS =
  "id, account_id, calendar_id, contact_id, starts_at, ends_at, status, note, " +
  "cancel_token, booker_timezone, reminder_sent_at, meeting_url, followup_sent_at, review_requested_at";
```
(c) Directly below `ACCOUNT_BRAND_COLS` (line 347) add:

```ts
/**
 * The cron windows, exported so they can be asserted against the schedule in
 * `apps/web/vercel.json` (cron-coupling.test.ts) instead of only described in
 * comments. The three are COUPLED — see the route's doc comment. The
 * follow-up window MUST equal `FOLLOWUP_MAX_AGE_MS` in
 * `apps/web/src/lib/booking/followup-timing.ts`; the same test pins that.
 */
export const REMINDER_WINDOW_START_MS = 23 * 60 * 60 * 1000;
export const REMINDER_WINDOW_END_MS = (24 * 60 + 15) * 60 * 1000;
export const FOLLOWUP_QUERY_WINDOW_MS = 37 * 60 * 60 * 1000;

export type AccountBrandInfo = {
  accountName: string; accountTimezone: string; branding: Branding;
  fromEmail: string | null; replyToEmail: string | null;
};

/**
 * One `accounts` read per distinct account id — the per-tick cache the due
 * lists share. Throws on a missing account: a due row whose account cannot
 * be read is a data problem, not a row to skip silently. Not batched into a
 * single `.in()`: this runs on a 15-minute cron, and one account is the real
 * shape today.
 */
export async function loadAccountBrandInfo(
  db: SupabaseClient, accountIds: readonly string[], caller: string,
): Promise<Map<string, AccountBrandInfo>> {
  const out = new Map<string, AccountBrandInfo>();
  for (const accountId of accountIds) {
    const { data, error } = await db.from("accounts")
      .select(ACCOUNT_BRAND_COLS).eq("id", accountId).single();
    if (error || !data) {
      throw new Error(`${caller}: account lookup failed for ${accountId}: ${error?.message}`);
    }
    const acct = data as unknown as {
      name: string; timezone: string;
      brand_name: string | null; brand_logo_path: string | null; brand_color: string | null;
      brand_neutral: Branding["brandNeutral"]; brand_corners: Branding["brandCorners"];
      brand_type: Branding["brandType"]; brand_mode: Branding["brandMode"];
      reply_to_email: string | null; from_email: string | null;
    };
    out.set(accountId, {
      accountName: acct.name,
      accountTimezone: acct.timezone,
      branding: {
        brandName: acct.brand_name ?? null,
        brandLogoPath: acct.brand_logo_path ?? null,
        brandColor: acct.brand_color ?? null,
        brandNeutral: acct.brand_neutral ?? null,
        brandCorners: acct.brand_corners ?? null,
        brandType: acct.brand_type ?? null,
        brandMode: acct.brand_mode ?? null,
        replyToEmail: acct.reply_to_email ?? null,
      },
      fromEmail: acct.from_email ?? null,
      replyToEmail: acct.reply_to_email ?? null,
    });
  }
  return out;
}
```

(d) In `listDueReminders`, replace the two window lines with:
```ts
  const windowStart = new Date(now + REMINDER_WINDOW_START_MS).toISOString();
  const windowEnd = new Date(now + REMINDER_WINDOW_END_MS).toISOString();
```
and replace the whole `accountIds` / `accountInfo` block (from `const accountIds = [...new Set(` through the closing `}` of the `for` loop) with:
```ts
  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueReminders");
```
The `rows.map(...)` return below it is unchanged (`info.replyToEmail` is simply unused there).

(e) In `listDueFollowups`, replace the window line with:
```ts
  const windowStart = new Date(now - FOLLOWUP_QUERY_WINDOW_MS).toISOString();
```
and replace its `accountIds` / `accountInfo` block the same way:
```ts
  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueFollowups");
```
Delete the now-unused comment about "Same one-query-per-account cache" if it no longer describes anything. The `rows.map(...)` return is unchanged.

- [ ] **Step 4: Create `automations.ts`**

`packages/db/src/automations.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { brandDisplayName, type Branding } from "./branding";
import { loadAccountBrandInfo } from "./booking";

/**
 * The automations spine. Config is GENERIC — one row per (account, recipe)
 * holding a toggle, a prose body and a jsonb config — and due-ness is
 * DOMAIN-SPECIFIC: each recipe's due-list reads its own domain rows and its
 * own stamp column, so a booking that is cancelled or un-completed just stops
 * matching. There is no void step and nothing to forget.
 *
 * The catalogue is fixed (a CHECK constraint in 0025 mirrors `RecipeKey`).
 * Milestone B adds keys in its own migration.
 */
export type RecipeKey = "review_request";
export const RECIPE_KEYS: readonly RecipeKey[] = ["review_request"];

export type AutomationRow = {
  id: string; account_id: string; recipe_key: RecipeKey;
  enabled: boolean; body: string;
  /** Raw jsonb. NEVER trusted: parse it with the recipe's own parser on every
   *  read, and validate it on every write. */
  config: unknown;
  created_at: string; updated_at: string;
};

const AUTOMATION_COLS = "id, account_id, recipe_key, enabled, body, config, created_at, updated_at";

export async function getAutomation(
  db: SupabaseClient, accountId: string, recipeKey: RecipeKey,
): Promise<AutomationRow | null> {
  const { data, error } = await db.from("automations")
    .select(AUTOMATION_COLS).eq("account_id", accountId).eq("recipe_key", recipeKey).maybeSingle();
  if (error) throw new Error(`getAutomation failed: ${error.message}`);
  return (data as AutomationRow | null) ?? null;
}

/**
 * serviceDb()-only by grant (0025: `authenticated` holds SELECT and nothing
 * else). Every caller is an agency-gated server action; nothing in the
 * database stands behind that except this grant, so callers MUST check
 * `isAgency` themselves. One row per (account, recipe): the unique constraint
 * is what `onConflict` targets.
 */
export async function upsertAutomation(
  db: SupabaseClient, accountId: string, recipeKey: RecipeKey,
  patch: { enabled: boolean; body: string; config: Record<string, unknown> },
  actorId: string, actorType: ActorType = "user",
): Promise<AutomationRow> {
  const { data, error } = await db.from("automations")
    .upsert({
      account_id: accountId, recipe_key: recipeKey,
      enabled: patch.enabled, body: patch.body, config: patch.config,
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_id,recipe_key" })
    .select(AUTOMATION_COLS).single();
  if (error || !data) throw new Error(`upsertAutomation failed: ${error?.message}`);
  await emit(db, accountId, "automation.updated", actorId,
    { recipeKey, enabled: patch.enabled }, actorType);
  return data as unknown as AutomationRow;
}

// ---------------------------------------------------------------------------
// Recipe: review request after a completed job
// ---------------------------------------------------------------------------

export type ReviewRequestChannel = "email" | "sms";
export type ReviewRequestConfig = { channel: ReviewRequestChannel; reviewUrl: string };

const MAX_REVIEW_URL_LENGTH = 2048;

/**
 * jsonb is untyped, so the stored config is validated on READ (here, by the
 * due-list) and on WRITE (the settings action), never trusted. `null` means
 * "treat as missing" — the pass counts it and sends nothing. Only http(s):
 * a `javascript:` URL in an email button is the obvious reason; a URL of any
 * other scheme is not something a review page lives at.
 */
export function parseReviewRequestConfig(raw: unknown): ReviewRequestConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { channel, reviewUrl } = raw as Record<string, unknown>;
  if (channel !== "email" && channel !== "sms") return null;
  if (typeof reviewUrl !== "string") return null;
  const url = reviewUrl.trim();
  if (url.length === 0 || url.length > MAX_REVIEW_URL_LENGTH) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return { channel, reviewUrl: url };
}

/**
 * The oldest a completed meeting may be and still earn a review request, and
 * the figure the due-query window is sized to. DERIVED, not picked:
 *
 *   37h  the follow-up's own worst case (FOLLOWUP_MAX_AGE_MS in
 *        apps/web/src/lib/booking/followup-timing.ts): a meeting ending at
 *        00:00 local on a 26-hour day (Antarctica/Troll's fall-back) waits
 *        until 11:00 local on D+1, the close of the follow-up's morning band.
 *  +24h  the review request defers to the follow-up: it sends only on a
 *        strictly LATER local day than `followup_sent_at`, so when the
 *        follow-up went out at the very close of D+1's band, the review
 *        request's last qualifying tick is 11:00 on D+2.
 *  = 61h
 *
 * Pinned against real zones in review-request-gate.test.ts. The web gate
 * imports THIS constant rather than restating it — the follow-up's 37h is
 * duplicated across the package boundary and prose-linked; this one is not.
 *
 * Bounded catch-up, stated honestly: if the follow-up itself was late (sent
 * on D+2 by its own catch-up), the review request lands on D+3 and this cap
 * drops it — a missing nicety, never a mistimed one. The safe direction.
 */
export const REVIEW_REQUEST_MAX_AGE_MS = 61 * 60 * 60 * 1000;

/**
 * What the review-request pass is handed per due booking.
 *
 * `brandName` and NEVER `accountName`: `accounts.name` is the agency's
 * internal label ("Rio Roofing — trial") and has reached customers three
 * times. It is resolved here, in the data layer, by `brandDisplayName`, and
 * the row simply has no field for the raw label. A recipe author cannot
 * reach it.
 *
 * `contactPhone` is RAW (`contacts.phone` is only trimmed on write) — the
 * pass runs it through `toE164` and treats a null result as "no deliverable
 * address", exactly as `sendSmsAction` does.
 */
export type DueReviewRequest = {
  bookingId: string; accountId: string;
  /** `ends_at` — "the morning after" is measured from when it ENDED. */
  endsAt: string;
  /** THE COLLISION INPUT. The calendar's follow-up email already fires the
   *  morning after a completed meeting; the gate defers the review request
   *  to a strictly later local day than this stamp. Null when no follow-up
   *  was sent (feature off, no email, send failed) — then nothing to defer to. */
  followupSentAt: string | null;
  contactId: string; contactEmail: string | null; contactPhone: string | null;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  /** The operator's prose, "" meaning "use the default at send time". */
  body: string;
  /** Parsed and validated; null when the stored jsonb fails validation. */
  config: ReviewRequestConfig | null;
};

/**
 * Candidates, not decisions: everything returned here still goes through
 * `shouldSendReviewRequestNow` in the pass, which decides the MOMENT. The
 * query only says "enabled, completed, unstamped, inside 61h".
 *
 * `automations` first, then `bookings`: an idle tick on a platform where no
 * account has this recipe on costs ONE narrow indexed read and zero booking
 * reads. There is no FK from bookings to automations, so PostgREST cannot
 * embed the join; two queries is the honest shape.
 */
export async function listDueReviewRequests(
  db: SupabaseClient, nowIso: string,
): Promise<DueReviewRequest[]> {
  const { data: autoData, error: autoErr } = await db.from("automations")
    .select("account_id, body, config")
    .eq("recipe_key", "review_request").eq("enabled", true);
  if (autoErr) throw new Error(`listDueReviewRequests automations read failed: ${autoErr.message}`);
  const enabled = (autoData ?? []) as { account_id: string; body: string; config: unknown }[];
  if (enabled.length === 0) return [];
  const byAccount = new Map(enabled.map((a) => [a.account_id, a] as const));

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - REVIEW_REQUEST_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, ends_at, followup_sent_at, contacts(email, phone)")
    .in("account_id", [...byAccount.keys()])
    .eq("status", "completed").is("review_requested_at", null)
    .gte("ends_at", windowStart).lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueReviewRequests failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueReviewRequests");

  return rows.map((r) => {
    const info = accountInfo.get(r.account_id as string)!;
    const auto = byAccount.get(r.account_id as string)!;
    return {
      bookingId: r.id,
      accountId: r.account_id,
      endsAt: r.ends_at,
      followupSentAt: r.followup_sent_at ?? null,
      contactId: r.contact_id,
      contactEmail: r.contacts?.email ?? null,
      contactPhone: r.contacts?.phone ?? null,
      brandName: brandDisplayName(info.branding, info.accountName),
      branding: info.branding,
      accountTimezone: info.accountTimezone,
      fromEmail: info.fromEmail,
      replyToEmail: info.replyToEmail,
      body: auto.body ?? "",
      config: parseReviewRequestConfig(auto.config),
    };
  });
}

/** Send-then-stamp, same reasoning as stampReminderSent: only after a confirmed send. */
export async function stampReviewRequested(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ review_requested_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReviewRequested failed: ${error.message}`);
}

/**
 * The daily cap's input: how many review requests this account has sent
 * since `sinceIso`, read off the stamp column itself. Counting stamps (not a
 * separate ledger) is what lets the cap need no new table and no timezone —
 * "a day" is a rolling 24 hours from the tick.
 */
export async function countReviewRequestsSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("review_requested_at", sinceIso);
  if (error) throw new Error(`countReviewRequestsSince failed: ${error.message}`);
  return count ?? 0;
}
```

- [ ] **Step 5: Export from `index.ts`**

Change the booking export block to include the constants and add the automations block:

```ts
export { getOrCreateCalendar, getCalendarForAccount, getCalendarByPublicId, updateCalendarSettings,
         listBookedRanges, createBooking, cancelBookingByToken, setBookingStatus,
         listUpcomingBookings, countRecentBookings, listDueReminders, stampReminderSent,
         listDueFollowups, stampFollowupSent, listBookingCreationsBetween,
         newCancelToken, SlotTakenError,
         REMINDER_WINDOW_START_MS, REMINDER_WINDOW_END_MS, FOLLOWUP_QUERY_WINDOW_MS,
         type CalendarRow, type BookingRow, type BookingStatus, type CalendarSettingsPatch,
         type CreateBookingInput, type DueReminder, type DueFollowup } from "./booking";
export { getAutomation, upsertAutomation, parseReviewRequestConfig,
         listDueReviewRequests, stampReviewRequested, countReviewRequestsSince,
         REVIEW_REQUEST_MAX_AGE_MS, RECIPE_KEYS,
         type RecipeKey, type AutomationRow, type ReviewRequestChannel,
         type ReviewRequestConfig, type DueReviewRequest } from "./automations";
```

- [ ] **Step 6: Run the new tests, then the whole db suite (the two refactored due-lists are covered by booking.test.ts)**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/t3a.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/t3a.txt
cd /c/Users/danlo/bis-platform/packages/db && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t3b.txt 2>&1; echo "exit=$?"; npx vitest run > /c/Users/danlo/AppData/Local/Temp/claude/t3c.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/t3c.txt
```
Expected: all `exit=0`; automations 6 passed; db suite = 183 + 5 (Task 1) + 3 (Task 2) + 6 = 197 passed. Run the db suite ALONE (no parallel web run) — its heaviest tests measure ~10s uncontended.

- [ ] **Step 7: Mutation check (record the result in the commit message)**

Temporarily change `.eq("enabled", true)` to `.eq("enabled", false)` in `listDueReviewRequests` → the "disabled row yields nothing" test must fail. Revert. Temporarily drop `followup_sent_at` from the bookings select → the `deferred.followupSentAt` assertion must fail. Revert.

- [ ] **Step 8: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-a" ] && git add packages/db/src/automations.ts packages/db/src/booking.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts && git commit -q -m "feat(db): automations accessors, review-request due list, 61h cap, exported cron windows

Mutation-checked: enabled filter and followup_sent_at projection each fail exactly one test when broken." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 4: Export the band and local-day predicates from `followup-timing.ts`

The review gate needs "inside the morning band" and "on a strictly earlier local day" separately (it applies the second one twice: to the meeting end AND to `followup_sent_at`). Both are module-private today. Export them and re-express `shouldSendFollowupNow` on top; **`followup-timing.test.ts` is not edited** — its 20 tests passing unchanged is the proof the re-expression preserved behaviour.

**Files:**
- Modify: `apps/web/src/lib/booking/followup-timing.ts:139-206`
- Create: `apps/web/src/lib/booking/followup-timing.helpers.test.ts`

**Interfaces:**
- Produces: `isInMorningBand(now: Date, zone: string): boolean`, `isStrictlyEarlierLocalDay(instant: Date, now: Date, zone: string): boolean`. Both resolve `zone` through `resolveAccountZone` themselves and FAIL CLOSED (`false`) on junk zones and invalid dates — they never throw.

- [ ] **Step 1: Confirm the fixture instants with Intl before writing a single assertion**

```bash
node -e 'const f=(d,z)=>new Intl.DateTimeFormat("en-US",{timeZone:z,weekday:"short",hour:"2-digit",hourCycle:"h23",month:"2-digit",day:"2-digit"}).format(new Date(d));for(const [d,z] of [["2026-09-09T14:00:00Z","America/New_York"],["2026-09-09T14:00:00Z","America/Los_Angeles"],["2026-09-09T14:00:00Z","UTC"],["2026-09-09T04:30:00Z","America/New_York"],["2026-09-09T04:30:00Z","America/Chicago"]])console.log(d,z,f(d,z))'
```
Expected:
```
2026-09-09T14:00:00Z America/New_York Wed, 09/09, 10
2026-09-09T14:00:00Z America/Los_Angeles Wed, 09/09, 07
2026-09-09T14:00:00Z UTC Wed, 09/09, 14
2026-09-09T04:30:00Z America/New_York Wed, 09/09, 00
2026-09-09T04:30:00Z America/Chicago Tue, 09/08, 23
```

- [ ] **Step 2: Write the failing helper tests**

`apps/web/src/lib/booking/followup-timing.helpers.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isInMorningBand, isStrictlyEarlierLocalDay } from "./followup-timing";

/**
 * Same discipline as followup-timing.test.ts: ONE instant, TWO zones,
 * OPPOSITE verdicts, and America/Chicago (this machine's zone) only ever as
 * one half of a pair. Every instant below was checked with Intl first.
 */
const NY = "America/New_York";
const LA = "America/Los_Angeles";
const CHI = "America/Chicago";
const JUNK = ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"];

describe("isInMorningBand", () => {
  const NOW = new Date("2026-09-09T14:00:00Z");   // NY 10:00 · LA 07:00 · UTC 14:00

  it("reads the band in the zone it is handed: mid-morning in New York, dawn in Los Angeles", () => {
    expect(isInMorningBand(NOW, NY)).toBe(true);
    expect(isInMorningBand(NOW, LA)).toBe(false);
  });

  it("guards the fixture: the same instant is outside the band in UTC", () => {
    expect(isInMorningBand(NOW, "UTC")).toBe(false);
  });

  it("fails closed on a junk zone and on an invalid instant, never throwing", () => {
    for (const z of JUNK) expect(isInMorningBand(NOW, z)).toBe(false);
    expect(isInMorningBand(new Date("not a date"), NY)).toBe(false);
  });
});

describe("isStrictlyEarlierLocalDay", () => {
  const NOW = new Date("2026-09-09T14:00:00Z");      // NY Wed 10:00 · CHI Wed 09:00
  const INSTANT = new Date("2026-09-09T04:30:00Z");  // NY Wed 00:30 · CHI Tue 23:30

  it("one hour of zone difference moves the instant across local midnight", () => {
    expect(isStrictlyEarlierLocalDay(INSTANT, NOW, CHI)).toBe(true);
    expect(isStrictlyEarlierLocalDay(INSTANT, NOW, NY)).toBe(false);
  });

  it("the same local day is not strictly earlier, and a later instant never is", () => {
    expect(isStrictlyEarlierLocalDay(new Date("2026-09-09T13:00:00Z"), NOW, NY)).toBe(false);
    expect(isStrictlyEarlierLocalDay(new Date("2026-09-10T13:00:00Z"), NOW, NY)).toBe(false);
  });

  it("fails closed on a junk zone and on invalid dates on either side", () => {
    for (const z of JUNK) expect(isStrictlyEarlierLocalDay(INSTANT, NOW, z)).toBe(false);
    expect(isStrictlyEarlierLocalDay(new Date("nope"), NOW, NY)).toBe(false);
    expect(isStrictlyEarlierLocalDay(INSTANT, new Date("nope"), NY)).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/booking/followup-timing.helpers.test.ts 2>&1 | grep -E "does not provide an export|is not a function|passed|failed" | head -3
```
Expected: FAIL — the exports do not exist.

- [ ] **Step 4: Export the helpers and re-express the gate**

In `apps/web/src/lib/booking/followup-timing.ts`, keep `localDayNumber` and `localParts` as they are, and replace `shouldSendFollowupNow` (its doc comment stays exactly as it is — only the function body changes) with the three functions below. Insert the two helpers ABOVE the `shouldSendFollowupNow` doc comment:

```ts
/**
 * Whether `now` falls inside the morning band, read in `zone`. Resolves the
 * zone itself (a helper must be safe to call from anywhere) and FAILS CLOSED:
 * a zone Intl cannot resolve or an invalid instant is `false`, never a throw
 * — this runs inside a cron tick with no one watching.
 */
export function isInMorningBand(now: Date, zone: string): boolean {
  const resolved = resolveAccountZone(zone);
  if (resolved === null || !Number.isFinite(now.getTime())) return false;
  const hour = Number(localParts(now, resolved).find((p) => p.type === "hour")?.value ?? NaN);
  if (!Number.isFinite(hour)) return false;
  return hour >= FOLLOWUP_MORNING_START_HOUR && hour < FOLLOWUP_MORNING_END_HOUR;
}

/**
 * Whether `instant` fell on a strictly EARLIER local calendar day than `now`,
 * both rendered in `zone`. Comparing local calendar dates (not "at least N
 * hours ago") is what makes a 09:00 and a 23:00 appointment both wait for
 * the next morning. Same fail-closed contract as `isInMorningBand`. The
 * review-request gate applies this twice: to the meeting end, and to the
 * follow-up's own stamp.
 */
export function isStrictlyEarlierLocalDay(instant: Date, now: Date, zone: string): boolean {
  const resolved = resolveAccountZone(zone);
  if (resolved === null) return false;
  if (!Number.isFinite(instant.getTime()) || !Number.isFinite(now.getTime())) return false;
  return localDayNumber(localParts(now, resolved)) > localDayNumber(localParts(instant, resolved));
}
```

and the new body of `shouldSendFollowupNow` (signature and doc comment unchanged):

```ts
export function shouldSendFollowupNow(now: Date, meetingEnd: Date, timezone: string): boolean {
  // Epoch milliseconds, never lexicographic ISO comparison: the strings in
  // play come from Postgres (`+00:00`) and from JS (`.000Z`) and do not sort
  // against each other reliably. NaN from an unparseable date must read as
  // "not now" rather than throwing inside the cron.
  const elapsedMs = now.getTime() - meetingEnd.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < 0) return false;                    // the meeting has not ended
  if (elapsedMs > FOLLOWUP_MAX_AGE_MS) return false;  // too stale to be welcome

  // Rule 0. Everything below is a statement about LOCAL time and means
  // nothing without a zone we can resolve.
  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;

  // Rules 1 and 2, as the two exported predicates — the review-request gate
  // composes the same two, so they cannot drift apart.
  if (!isInMorningBand(now, zone)) return false;
  return isStrictlyEarlierLocalDay(meetingEnd, now, zone);
}
```

- [ ] **Step 5: Run the helper tests AND the untouched original file**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/booking/followup-timing > /c/Users/danlo/AppData/Local/Temp/claude/t4.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/t4.txt; cd /c/Users/danlo/bis-platform && git diff --stat -- apps/web/src/lib/booking/followup-timing.test.ts
```
Expected: `exit=0`, 2 files, 26 tests passed (20 original + 6 new); the `git diff --stat` line for the original test file is EMPTY.

- [ ] **Step 6: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-a" ] && git add apps/web/src/lib/booking/followup-timing.ts apps/web/src/lib/booking/followup-timing.helpers.test.ts && git commit -q -m "refactor(followup-timing): export the band and local-day predicates; gate re-expressed on them, its tests untouched" && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 5: The harness, with the two live passes migrated onto it — `route.test.ts` untouched

**Files:**
- Create: `apps/web/src/lib/automations/context.ts`
- Create: `apps/web/src/lib/automations/harness.ts`
- Create: `apps/web/src/lib/automations/passes/reminders.ts`
- Create: `apps/web/src/lib/automations/passes/followups.ts`
- Create: `apps/web/src/lib/automations/registry.ts`
- Modify: `apps/web/src/app/api/cron/reminders/route.ts` (everything from `const db = serviceDb();` to the end of `GET` is replaced)
- Create: `apps/web/src/lib/automations/harness.test.ts`
- Create: `apps/web/src/lib/automations/imports.test.ts`
- Create: `apps/web/src/lib/automations/cron-coupling.test.ts`
- **Do NOT touch:** `apps/web/src/app/api/cron/reminders/route.test.ts`

**Interfaces:**
- Consumes: `listDueReminders`, `stampReminderSent`, `listDueFollowups`, `stampFollowupSent`, the four window constants (Task 3); `getEmailProvider` (`@/lib/email`), `getSmsProvider` (`@/lib/sms`).
- Produces:
  - `type PassContext = { db: SupabaseClient; now: Date; origin: string; email: EmailProvider; sms: () => SmsProvider }` — NO `accountName`.
  - `type PassCounters = Record<string, number>`; `type Pass = { readonly key: string; run(ctx: PassContext): Promise<PassCounters> }`
  - `buildPassContext(input: { db; now; origin }): PassContext`; `runPasses(passes: readonly Pass[], ctx): Promise<Record<string, PassCounters>>`
  - `remindersPass` (key `"reminders"`, counters `{ sent, failed, unstamped }`), `followupsPass` (key `"followups"`, counters `{ sent, failed, unstamped, skippedNoEmail, waitingForMorning, unresolvableTimezone }`), `PASSES: readonly Pass[]`.

- [ ] **Step 1: Write the harness tests (they fail: modules missing)**

`apps/web/src/lib/automations/harness.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const smsFactory = vi.hoisted(() => ({ getSmsProvider: vi.fn() }));
vi.mock("@/lib/sms", () => ({ getSmsProvider: () => smsFactory.getSmsProvider() }));
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ isFake: true, send: async () => ({ providerMessageId: "e" }) }),
}));

import { buildPassContext, runPasses } from "./harness";
import type { Pass, PassContext } from "./context";

function ctx(): PassContext {
  return buildPassContext({
    db: {} as never, now: new Date("2026-09-09T14:00:00Z"), origin: "https://app.example.com",
  });
}

beforeEach(() => {
  smsFactory.getSmsProvider.mockReset();
});

describe("runPasses — independent error isolation, the finishCall-legs pattern", () => {
  it("a pass that rejects OUTRIGHT is reported under its own key as errored, and the next pass still runs", async () => {
    // Not a send inside a pass (each pass catches those itself) — the pass's
    // own `run` blowing up, e.g. its due-query throwing. Mutation: remove the
    // try/catch around `pass.run(ctx)` in harness.ts and this must fail.
    const ran: string[] = [];
    const boom: Pass = { key: "boom", run: async () => { throw new Error("db exploded"); } };
    const fine: Pass = { key: "fine", run: async () => { ran.push("fine"); return { sent: 2 }; } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const results = await runPasses([boom, fine], ctx());

    expect(results).toEqual({ boom: { errored: 1 }, fine: { sent: 2 } });
    expect(ran).toEqual(["fine"]);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("boom"));
    spy.mockRestore();
  });

  it("runs passes in registry order, each handed the SAME context", async () => {
    const seen: PassContext[] = [];
    const order: string[] = [];
    const mk = (key: string): Pass => ({
      key, run: async (c) => { seen.push(c); order.push(key); return {}; },
    });
    const c = ctx();
    await runPasses([mk("a"), mk("b"), mk("c")], c);
    expect(order).toEqual(["a", "b", "c"]);
    expect(seen.every((s) => s === c)).toBe(true);
  });
});

describe("buildPassContext — the SMS provider is LAZY", () => {
  it("does not construct the SMS provider until a pass asks, so a throwing factory cannot fail the tick", async () => {
    // getSmsProvider() throws in production when TELNYX_API_KEY is unset —
    // and it IS unset today, by design. An eager construction would 500 every
    // tick, reminders included. Mutation: make `sms` eager in
    // buildPassContext and this must fail.
    smsFactory.getSmsProvider.mockImplementation(() => {
      throw new Error("TELNYX_API_KEY is required in production");
    });
    const c = ctx();
    expect(smsFactory.getSmsProvider).not.toHaveBeenCalled();
    expect(() => c.sms()).toThrow(/TELNYX_API_KEY/);
    const results = await runPasses([{ key: "emailOnly", run: async () => ({ sent: 0 }) }], c);
    expect(results).toEqual({ emailOnly: { sent: 0 } });
  });

  it("memoises the SMS provider after the first successful construction", () => {
    const provider = { isFake: true, send: async () => ({ providerMessageId: "s" }) };
    smsFactory.getSmsProvider.mockReturnValue(provider);
    const c = ctx();
    expect(c.sms()).toBe(provider);
    expect(c.sms()).toBe(provider);
    expect(smsFactory.getSmsProvider).toHaveBeenCalledTimes(1);
  });
});

describe("PassContext — structurally cannot carry the agency's internal label", () => {
  it("has no accountName (pnpm typecheck fails here if someone adds one)", () => {
    const c = ctx();
    // @ts-expect-error accountName is deliberately absent from PassContext.
    // If it is ever added, this directive becomes unused and `tsc` refuses it.
    expect(c.accountName).toBeUndefined();
  });
});
```

`apps/web/src/lib/automations/imports.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * "Nothing new sends" made structural. A pass receives its providers on
 * `ctx`; it never imports a provider or a provider factory. The harness is
 * the ONLY module allowed to, and the production guard (VERCEL_ENV AND
 * NODE_ENV, in the two factories) is therefore the only thing any automation
 * send ever goes through. Test files are exempt: they mock those modules.
 *
 * Mutation: add `import { getSmsProvider } from "@/lib/sms"` to any pass file.
 */
const ROOT = fileURLToPath(new URL(".", import.meta.url));
const FORBIDDEN: readonly RegExp[] = [
  /from\s+["']@\/lib\/email["']/,          // the email factory
  /from\s+["']@\/lib\/sms["']/,            // the sms factory
  /from\s+["'][^"']*\/resend["']/,         // the real email provider
  /from\s+["'][^"']*\/telnyx["']/,         // the real sms provider
];
const ALLOWED = new Set(["harness.ts"]);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith(".ts") && !full.endsWith(".test.ts") ? [full] : [];
  });
}
const rel = (file: string) => file.slice(ROOT.length).replace(/\\/g, "/");

describe("automations — providers come from ctx, never from imports", () => {
  it("no module under lib/automations except the harness imports a provider or a factory", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      if (ALLOWED.has(rel(file))) continue;
      const src = readFileSync(file, "utf-8");
      for (const rule of FORBIDDEN) if (rule.test(src)) offenders.push(`${rel(file)}: ${rule}`);
    }
    expect(offenders).toEqual([]);
  });

  it("the scan actually reaches the pass files (guards the fixture)", () => {
    expect(walk(ROOT).map(rel)).toEqual(expect.arrayContaining(
      ["harness.ts", "context.ts", "registry.ts", "passes/reminders.ts", "passes/followups.ts"],
    ));
  });
});
```

`apps/web/src/lib/automations/cron-coupling.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  REMINDER_WINDOW_START_MS, REMINDER_WINDOW_END_MS, FOLLOWUP_QUERY_WINDOW_MS,
  REVIEW_REQUEST_MAX_AGE_MS,
} from "@bis/db";
import { FOLLOWUP_MAX_AGE_MS } from "@/lib/booking/followup-timing";

/**
 * The three-way coupling (schedule ↔ reminder window ↔ follow-up window) was
 * enforced by comments only, and the ledger carried that as an open concern
 * since the Pro cadence change. This is the enforcement. The schedule is
 * READ from vercel.json rather than restated here — restating it would just
 * be a fourth copy.
 */
const MINUTE = 60 * 1000;
const vercel = JSON.parse(
  readFileSync(new URL("../../../vercel.json", import.meta.url), "utf-8"),
) as { crons: { path: string; schedule: string }[] };

function tickIntervalMs(schedule: string): number {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(schedule);
  if (!m) throw new Error(`schedule is not of the form "*/N * * * *": ${schedule}`);
  return Number(m[1]) * MINUTE;
}

describe("the cron schedule and the query windows are coupled — enforced, not described", () => {
  const entry = vercel.crons.find((c) => c.path === "/api/cron/reminders");

  it("vercel.json has exactly one cron entry, and it is the reminders route", () => {
    expect(vercel.crons).toHaveLength(1);
    expect(entry).toBeDefined();
  });

  it("the reminder window is wider than one tick, so no booking can fall between two ticks", () => {
    const tick = tickIntervalMs(entry!.schedule);
    expect(tick).toBe(15 * MINUTE);
    expect(REMINDER_WINDOW_END_MS - REMINDER_WINDOW_START_MS).toBeGreaterThan(tick);
  });

  it("the follow-up query window equals the web-side staleness cap", () => {
    expect(FOLLOWUP_QUERY_WINDOW_MS).toBe(FOLLOWUP_MAX_AGE_MS);
  });

  it("the review-request cap is the follow-up cap plus one local day", () => {
    expect(REVIEW_REQUEST_MAX_AGE_MS).toBe(FOLLOWUP_MAX_AGE_MS + 24 * 60 * MINUTE);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations 2>&1 | grep -E "Failed to resolve|Cannot find|passed|failed" | head -4
```
Expected: FAIL — `./harness` / `./context` cannot be resolved (cron-coupling may already pass; that is fine).

- [ ] **Step 3: `context.ts` and `harness.ts`**

`apps/web/src/lib/automations/context.ts`:

```ts
import type { SupabaseClient } from "@bis/db";
import type { EmailProvider } from "@/lib/email/types";
import type { SmsProvider } from "@/lib/sms/types";

/**
 * What every pass is handed for one cron tick.
 *
 * DELIBERATELY ABSENT: `accountName`. `accounts.name` is the agency's internal
 * label for a company ("Rio Roofing — trial") and it has reached customers
 * three times (the P5 copy, the email From line, the text-back body). A
 * recipe author cannot leak what they cannot reach: due-rows carry
 * `brandName` (resolved in the data layer) and this context carries no name
 * at all. harness.test.ts pins the absence with a `@ts-expect-error`.
 */
export type PassContext = {
  db: SupabaseClient;
  /** The tick instant. Passes read this, never `new Date()`, so one tick has
   *  ONE "now" — the reminder query and the follow-up gate cannot disagree
   *  about what time it is. */
  now: Date;
  /** APP_ORIGIN when set, else the request's own origin — for links in
   *  customer mail. See origin.ts for why APP_ORIGIN must win. */
  origin: string;
  /** Constructed once per tick by the harness. In production this THROWS at
   *  construction when RESEND_API_KEY/EMAIL_FROM are unset — loudly, before
   *  any query, which is the designed failure. */
  email: EmailProvider;
  /** LAZY, unlike `email`. `getSmsProvider()` throws in production when
   *  TELNYX_API_KEY is unset, and it IS unset today by design (no A2P-approved
   *  client yet). Constructing it eagerly would fail every tick, reminders
   *  included. A pass calls this only on the SMS branch of a send it has
   *  already decided to make, inside that send's own try/catch. Memoised on
   *  success. */
  sms: () => SmsProvider;
};

/** Per-pass counters, reported verbatim in the cron's JSON under the pass key. */
export type PassCounters = Record<string, number>;

/**
 * A pass is a HARNESS ENTRY, not an implementation of a shared algorithm.
 * The two live passes are genuinely different (reminders have no morning
 * gate and count a missing email as `failed`; follow-ups have the gate and
 * count it `skippedNoEmail`), so there is no listDue/send/stamp interface —
 * each pass owns its own query, gate, send and stamp. What the registry
 * buys is error isolation, uniform counter reporting, and one place to add
 * a recipe.
 */
export type Pass = {
  readonly key: string;
  run(ctx: PassContext): Promise<PassCounters>;
};
```

`apps/web/src/lib/automations/harness.ts`:

```ts
import type { SupabaseClient } from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { getSmsProvider } from "@/lib/sms";
import type { SmsProvider } from "@/lib/sms/types";
import type { Pass, PassContext, PassCounters } from "./context";

/**
 * THE ONLY automations module allowed to import the provider factories —
 * imports.test.ts scans every other file under lib/automations for exactly
 * these imports. Everything a pass sends goes through the two factories'
 * production guard (VERCEL_ENV AND NODE_ENV), because there is no other way
 * for a pass to obtain a provider.
 */
export function buildPassContext(
  input: { db: SupabaseClient; now: Date; origin: string },
): PassContext {
  let sms: SmsProvider | null = null;
  return {
    ...input,
    email: getEmailProvider(),
    sms: () => (sms ??= getSmsProvider()),
  };
}

/**
 * Runs every pass in order, each inside its own try/catch — the `finishCall`
 * legs pattern. A pass whose `run` rejects OUTRIGHT (its due-query throwing,
 * say) is reported under its own key as `{ errored: 1 }` and the tick goes on
 * to the next pass; a send failing INSIDE a pass is that pass's business and
 * shows up in its own counters. Sequential, not parallel, on purpose: the
 * follow-up pass stamps `followup_sent_at` and the review-request pass reads
 * it in the same tick, so order is part of the contract (see registry.ts).
 */
export async function runPasses(
  passes: readonly Pass[], ctx: PassContext,
): Promise<Record<string, PassCounters>> {
  const results: Record<string, PassCounters> = {};
  for (const pass of passes) {
    try {
      results[pass.key] = await pass.run(ctx);
    } catch (e) {
      results[pass.key] = { errored: 1 };
      console.error(`automation pass ${pass.key} failed outright: ${String(e)}`);
    }
  }
  return results;
}
```

- [ ] **Step 4: Move the reminder loop into `passes/reminders.ts`**

`apps/web/src/lib/automations/passes/reminders.ts` (the loop body is the route's, moved; `provider` → `ctx.email`, `db` → `ctx.db`, `origin` → `ctx.origin`, `new Date()` → `ctx.now`; every log string is byte-identical):

```ts
import { listDueReminders, stampReminderSent } from "@bis/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingReminderEmail } from "@/lib/email/templates/booking";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import type { Pass } from "../context";

/**
 * Booking reminders, ~a day before `starts_at`. Moved verbatim from
 * api/cron/reminders/route.ts onto the harness (2026-09-06); the route's 30
 * tests run unchanged against this pass through the route.
 *
 * UNCAPPED, by design. The automation caps (caps.ts) guard RECIPE passes
 * against bursts; a reminder is one-to-one with a booking the customer made,
 * and a daily cap on a busy client would drop reminders — the row leaves its
 * 75-minute window before a rolling day clears — turning a burst guard into
 * no-shows. This pass has run uncapped in production and keeps doing so.
 *
 * Counted the way the route always counted: a reminder with no contact email
 * is a `failed` send (contrast the follow-up pass, which counts it
 * `skippedNoEmail`). That difference is the reason the registry is a harness
 * and not a shared listDue/send/stamp algorithm.
 */
export const remindersPass: Pass = {
  key: "reminders",
  async run(ctx) {
    const reminders = await listDueReminders(ctx.db, ctx.now.toISOString());

    let sent = 0;
    let failed = 0;
    let unstamped = 0;

    for (const reminder of reminders) {
      // SEND-THEN-STAMP, never the reverse: `reminder_sent_at` is a dedupe
      // marker, not a record of an attempt. A send failure is counted in
      // `failed` and logged, and the row stays unstamped so
      // `listDueReminders` returns it again next tick.
      try {
        if (!reminder.contactEmail) {
          throw new Error("no contact email on file");
        }

        const brand = emailBrand(reminder.branding, reminder.accountName);
        const bookerZone = safeZone(reminder.bookerTimezone ?? undefined, reminder.accountTimezone);
        const whenBookerZone = formatWhen(new Date(reminder.startsAt), bookerZone);
        const cancelUrl = `${ctx.origin}/b/${reminder.calendarPublicId}/cancel/${reminder.cancelToken}`;

        const { html, text } = bookingReminderEmail({
          brand, whenBookerZone, cancelUrl, meetingUrl: reminder.meetingUrl ?? undefined,
        });

        // fromAddress carries the account's sending address: a reminder is
        // customer-facing outbound, same shape as the booking confirmation.
        await ctx.email.send({
          to: reminder.contactEmail,
          fromName: brand.name,
          fromAddress: reminder.fromEmail ?? undefined,
          replyTo: normalizeReplyTo(reminder.branding.replyToEmail),
          subject: "Reminder: your upcoming booking",
          body: text,
          html,
        });

        // A send that already left the building counts as `sent` no matter
        // what happens next. The stamp is retried (stampWithRetry) because at
        // 96 ticks a day an unstamped row is 5-6 identical reminders, and it
        // is still reported when every attempt fails — the retry shrinks the
        // duplicate window, it does not close it.
        const stamp = await stampWithRetry(() => stampReminderSent(ctx.db, reminder.bookingId));
        if (!stamp.stamped) {
          unstamped++;
          console.error(
            `reminder sent but NOT stamped for booking ${reminder.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 5 more copies over the next 75 `
            + `minutes: ${String(stamp.lastError)}`,
          );
        }

        sent++;
      } catch (e) {
        failed++;
        console.error(`reminder send failed for booking ${reminder.bookingId}: ${String(e)}`);
      }
    }

    return { sent, failed, unstamped };
  },
};
```

- [ ] **Step 5: Move the follow-up loop into `passes/followups.ts`**

`apps/web/src/lib/automations/passes/followups.ts`:

```ts
import { listDueFollowups, stampFollowupSent } from "@bis/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingFollowupEmail } from "@/lib/email/templates/followup";
import { shouldSendFollowupNow, resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import type { Pass } from "../context";

/**
 * Follow-up emails the morning after a booking's meeting ENDS. Moved
 * verbatim from api/cron/reminders/route.ts onto the harness (2026-09-06).
 * UNCAPPED, for the same reason as the reminder pass (see its doc comment).
 *
 * `listDueFollowups` is only a CANDIDATE list — anything that ended in the
 * last 37h — so the gate below can always fire. The pass, not the query,
 * decides the moment. Runs BEFORE the review-request pass in the registry:
 * it stamps `followup_sent_at`, and the review gate defers to that stamp.
 */
export const followupsPass: Pass = {
  key: "followups",
  async run(ctx) {
    const followups = await listDueFollowups(ctx.db, ctx.now.toISOString());

    let sent = 0;
    let failed = 0;
    let unstamped = 0;
    let skippedNoEmail = 0;
    let waitingForMorning = 0;
    let unresolvableTimezone = 0;

    for (const followup of followups) {
      // RULE 0, before the gate itself: an account whose `accounts.timezone`
      // cannot be resolved gets NO follow-up. The old `safeZone(tz, "UTC")`
      // substitution turned an unreadable zone into a send inside the
      // 08:00-11:00 UTC band — 03:00-06:00 in the Rio Grande Valley. Counted
      // under its OWN name so a misconfiguration stays visible in triage.
      const accountZone = resolveAccountZone(followup.accountTimezone);
      if (accountZone === null) {
        unresolvableTimezone++;
        console.error(
          `follow-up HELD for booking ${followup.bookingId}: account ${followup.accountId}'s `
          + `timezone ${JSON.stringify(followup.accountTimezone)} is not a zone we can resolve, `
          + `so there is no hour we can safely send at — fix the account's timezone; `
          + `this booking will age out unsent`,
        );
        continue;
      }

      // THE SEND-TIME GATE, before the no-email check so a contact with no
      // email is not logged 96 times a day for something that was never
      // going to send this tick. The dominant branch by a wide margin.
      if (!shouldSendFollowupNow(ctx.now, new Date(followup.endsAt), followup.accountTimezone)) {
        waitingForMorning++;
        continue;
      }

      if (!followup.contactEmail) {
        skippedNoEmail++;
        console.error(
          `follow-up skipped, no contact email on file for booking ${followup.bookingId}`,
        );
        continue;
      }

      // SEND-THEN-STAMP, same discipline as the reminder pass.
      try {
        const brand = emailBrand(followup.branding, followup.accountName);
        const { subject, html, text } = bookingFollowupEmail({
          brand, body: followup.followupBody,
        });

        // replyTo reads DueFollowup's OWN top-level `replyToEmail`, not
        // `followup.branding.replyToEmail` — that's the whole reason
        // `listDueFollowups` duplicates it there.
        await ctx.email.send({
          to: followup.contactEmail,
          fromName: brand.name,
          fromAddress: followup.fromEmail ?? undefined,
          replyTo: normalizeReplyTo(followup.replyToEmail),
          subject,
          body: text,
          html,
        });

        // The WORSE of the two migrated paths: the morning band is ~12 ticks
        // wide, so an unstamped row is ~12 identical emails. Its own retry
        // budget, deliberately not shared with the reminder pass.
        const stamp = await stampWithRetry(() => stampFollowupSent(ctx.db, followup.bookingId));
        if (!stamp.stamped) {
          unstamped++;
          console.error(
            `follow-up sent but NOT stamped for booking ${followup.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 11 more copies before the `
            + `morning band closes: ${String(stamp.lastError)}`,
          );
        }

        sent++;
      } catch (e) {
        failed++;
        console.error(`follow-up send failed for booking ${followup.bookingId}: ${String(e)}`);
      }
    }

    return { sent, failed, unstamped, skippedNoEmail, waitingForMorning, unresolvableTimezone };
  },
};
```

- [ ] **Step 6: `registry.ts` and the thin route**

`apps/web/src/lib/automations/registry.ts`:

```ts
import type { Pass } from "./context";
import { remindersPass } from "./passes/reminders";
import { followupsPass } from "./passes/followups";

/**
 * Every pass the cron tick runs, IN ORDER. Order is part of the contract:
 * the follow-up pass stamps `followup_sent_at` and the review-request pass
 * (Task 8) reads it in the same tick, which is what guarantees "how did it
 * go?" on day one and "would you leave a review?" on day two even when both
 * become eligible on the same morning.
 *
 * Adding a recipe = one line here plus its pass file. Nothing else.
 */
export const PASSES: readonly Pass[] = [remindersPass, followupsPass];
```

`apps/web/src/app/api/cron/reminders/route.ts` — replace the imports and everything from `const db = serviceDb();` to the end of `GET`. The auth block (503 / constant-time 401) and its comments stay exactly as they are. Result:

```ts
import { timingSafeEqual } from "node:crypto";
import { serviceDb } from "@bis/db";
import { configuredOrigin } from "@/lib/email/origin";
import { buildPassContext, runPasses } from "@/lib/automations/harness";
import { PASSES } from "@/lib/automations/registry";

export const dynamic = "force-dynamic";

/**
 * The platform's scheduled job: Vercel hits this every 15 minutes
 * (`vercel.json`'s `crons` entry — the literal cron string is deliberately
 * NOT quoted in a block comment in this repo, because its leading `*` + `/`
 * closes the comment). It runs every registered automation pass
 * (`lib/automations/registry.ts`) in order, each isolated from the others.
 *
 * The schedule, `listDueReminders`' forward window and `listDueFollowups`'
 * backward window are COUPLED; `lib/automations/cron-coupling.test.ts` now
 * enforces that against this file's own vercel.json.
 *
 * Cost when nothing is due: one narrow indexed select per pass, each
 * returning [] and short-circuiting before any per-account lookup.
 * `getEmailProvider()` only reads env vars — it opens no connection.
 *
 * AUTH is two separate failure modes, not one:
 *  - `CRON_SECRET` unset → 503, zero queries. An unguarded cron route must
 *    refuse to exist rather than run open.
 *  - a request whose `authorization` header doesn't match → 401, zero
 *    queries. Vercel attaches `Bearer ${CRON_SECRET}` automatically.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return new Response(null, { status: 503 });

  // Constant-time compare, mirroring guards.ts's verifyRenderToken: a
  // straight `!==` leaks how many leading bytes matched via response timing.
  // Length is checked first — timingSafeEqual throws on mismatched lengths.
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return new Response(null, { status: 401 });
  }

  // APP_ORIGIN wins when set (the custom domain); req.url's origin is only
  // the FALLBACK, and that fallback IS the deployment's vercel.app URL — the
  // exact link/sender mismatch Gmail silently discarded mail over.
  const origin = configuredOrigin() ?? new URL(req.url).origin;

  const ctx = buildPassContext({ db: serviceDb(), now: new Date(), origin });
  const { reminders, ...rest } = await runPasses(PASSES, ctx);

  // The reminder pass's counters stay TOP-LEVEL and every other pass nests
  // under its key — byte-identical to what this route returned before the
  // harness existed, which is what lets route.test.ts stand unchanged as the
  // migration's proof. New passes appear as new keys beside `followups`.
  return Response.json({ ...reminders, ...rest });
}
```

- [ ] **Step 7: Run the untouched route tests, the new automations tests, then typecheck + lint**

```bash
cd /c/Users/danlo/bis-platform && git diff --stat -- apps/web/src/app/api/cron/reminders/route.test.ts
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/app/api/cron src/lib/automations src/lib/booking > /c/Users/danlo/AppData/Local/Temp/claude/t5.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/t5.txt
cd /c/Users/danlo/bis-platform && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t5b.txt 2>&1; echo "exit=$?"; pnpm lint > /c/Users/danlo/AppData/Local/Temp/claude/t5c.txt 2>&1; echo "exit=$?"
```
Expected: the `git diff --stat` line is EMPTY; `exit=0` with route 30 passed + harness 5 + imports 2 + cron-coupling 4 + booking suites; typecheck and lint `exit=0`.

- [ ] **Step 8: Mutation check (record in the commit message)**

(a) In `harness.ts`, remove the try/catch around `await pass.run(ctx)` → `harness.test.ts` "rejects OUTRIGHT" must fail. Revert. (b) In `buildPassContext`, change `sms: () => (sms ??= getSmsProvider())` to `sms: (() => { const p = getSmsProvider(); return () => p; })()` → the "LAZY" test must fail. Revert. (c) In `passes/reminders.ts`, swap the order so `stampReminderSent` runs before `ctx.email.send` → route.test's "send-then-stamp" test must fail. Revert.

- [ ] **Step 9: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-a" ] && git add apps/web/src/lib/automations/context.ts apps/web/src/lib/automations/harness.ts apps/web/src/lib/automations/registry.ts apps/web/src/lib/automations/passes/reminders.ts apps/web/src/lib/automations/passes/followups.ts apps/web/src/lib/automations/harness.test.ts apps/web/src/lib/automations/imports.test.ts apps/web/src/lib/automations/cron-coupling.test.ts apps/web/src/app/api/cron/reminders/route.ts && git commit -q -m "refactor(cron): a harness of isolated passes; reminders + follow-ups migrated, route tests untouched

route.test.ts is byte-identical to main and green: the proof the two live passes kept their
behaviour and JSON shape. SMS provider is lazy on ctx (TELNYX_API_KEY is unset in prod by
design). Mutation-checked: harness try/catch, lazy sms, send-then-stamp order." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 6: The review-request gate — pure, zone-discriminating, cap pinned against real zones

**Files:**
- Create: `apps/web/src/lib/automations/review-request-gate.ts`
- Create: `apps/web/src/lib/automations/review-request-gate.test.ts`

**Interfaces:**
- Consumes: `REVIEW_REQUEST_MAX_AGE_MS` (`@bis/db`, Task 3); `resolveAccountZone`, `isInMorningBand`, `isStrictlyEarlierLocalDay` (Task 4).
- Produces: `shouldSendReviewRequestNow(now: Date, meetingEnd: Date, followupSentAt: Date | null, timezone: string): boolean`.

- [ ] **Step 1: Confirm every fixture instant with Intl first**

```bash
node -e 'const f=(d,z)=>new Intl.DateTimeFormat("en-US",{timeZone:z,weekday:"short",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(d));for(const [d,z] of [["2026-09-09T14:00:00Z","America/New_York"],["2026-09-09T14:00:00Z","America/Los_Angeles"],["2026-09-09T14:00:00Z","America/Chicago"],["2026-09-08T22:00:00Z","America/New_York"],["2026-09-08T22:00:00Z","America/Chicago"],["2026-09-09T04:30:00Z","America/New_York"],["2026-09-09T04:30:00Z","America/Chicago"],["2026-10-24T22:00:00Z","Antarctica/Troll"],["2026-10-26T10:59:00Z","Antarctica/Troll"],["2026-10-27T08:00:00Z","Antarctica/Troll"],["2026-10-27T11:00:00Z","Antarctica/Troll"],["2026-11-01T04:00:00Z","America/New_York"],["2026-11-02T13:30:00Z","America/New_York"],["2026-11-03T13:00:00Z","America/New_York"]])console.log(d.padEnd(22),z.padEnd(20),f(d,z))'
```
Expected:
```
2026-09-09T14:00:00Z   America/New_York     Wed, 09/09, 10:00
2026-09-09T14:00:00Z   America/Los_Angeles  Wed, 09/09, 07:00
2026-09-09T14:00:00Z   America/Chicago      Wed, 09/09, 09:00
2026-09-08T22:00:00Z   America/New_York     Tue, 09/08, 18:00
2026-09-08T22:00:00Z   America/Chicago      Tue, 09/08, 17:00
2026-09-09T04:30:00Z   America/New_York     Wed, 09/09, 00:30
2026-09-09T04:30:00Z   America/Chicago      Tue, 09/08, 23:30
2026-10-24T22:00:00Z   Antarctica/Troll     Sun, 10/25, 00:00
2026-10-26T10:59:00Z   Antarctica/Troll     Mon, 10/26, 10:59
2026-10-27T08:00:00Z   Antarctica/Troll     Tue, 10/27, 08:00
2026-10-27T11:00:00Z   Antarctica/Troll     Tue, 10/27, 11:00
2026-11-01T04:00:00Z   America/New_York     Sun, 11/01, 00:00
2026-11-02T13:30:00Z   America/New_York     Mon, 11/02, 08:30
2026-11-03T13:00:00Z   America/New_York     Tue, 11/03, 08:00
```
If any line differs, the fixture is wrong — fix the fixture, never the assertion.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/automations/review-request-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { REVIEW_REQUEST_MAX_AGE_MS } from "@bis/db";
import { FOLLOWUP_MAX_AGE_MS } from "@/lib/booking/followup-timing";
import { shouldSendReviewRequestNow } from "./review-request-gate";

/**
 * Same rules as followup-timing.test.ts: every instant computed with Intl
 * before the assertion was written; every zone-dependent test pins ONE
 * instant against TWO zones with OPPOSITE verdicts; America/Chicago (this
 * machine's zone) appears only as one half of a pair.
 */
const NY = "America/New_York";
const LA = "America/Los_Angeles";
const CHI = "America/Chicago";
const HOUR = 60 * 60 * 1000;

describe("shouldSendReviewRequestNow — the morning band, in the account's zone", () => {
  const NOW = new Date("2026-09-09T14:00:00Z");     // NY 10:00 · LA 07:00
  const ENDED = new Date("2026-09-08T22:00:00Z");   // NY Tue 18:00 · LA Tue 15:00

  it("sends where it is mid-morning, holds where it is still dawn — with no follow-up to defer to", () => {
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, NY)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, LA)).toBe(false);
  });

  it("never sends for a meeting that has not ended, and never on the same local day", () => {
    expect(shouldSendReviewRequestNow(NOW, new Date("2026-09-09T18:00:00Z"), null, NY)).toBe(false);
    expect(shouldSendReviewRequestNow(NOW, new Date("2026-09-09T13:00:00Z"), null, NY)).toBe(false); // ended 09:00 today
  });

  it("fails closed on an unresolvable zone, an explicit UTC account still works", () => {
    const utcMorning = new Date("2026-09-09T09:30:00Z");
    expect(shouldSendReviewRequestNow(utcMorning, ENDED, null, "UTC")).toBe(true);
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(shouldSendReviewRequestNow(utcMorning, ENDED, null, junk)).toBe(false);
    }
  });
});

describe("shouldSendReviewRequestNow — THE COLLISION: defers to the calendar follow-up", () => {
  /**
   * The follow-up email already fires the morning after a completed meeting.
   * The review request may go out only on a strictly LATER local day than
   * `followup_sent_at`, so the two never land the same morning. ONE stamp
   * instant, two zones an hour apart, and that hour moves the stamp across
   * local midnight:
   *   Chicago  : stamped 23:30 YESTERDAY → earlier local day → send
   *   New_York : stamped 00:30 TODAY     → same local day    → hold
   * Both are mid-morning (09:00 and 10:00) with a meeting that ended the
   * previous evening, so ONLY the stamp's local day separates the verdicts.
   * Mutation: compare instants (`followupSentAt < now`) instead of local
   * days and both halves answer true.
   */
  const NOW = new Date("2026-09-09T14:00:00Z");           // NY Wed 10:00 · CHI Wed 09:00
  const ENDED = new Date("2026-09-08T22:00:00Z");         // NY Tue 18:00 · CHI Tue 17:00
  const STAMPED = new Date("2026-09-09T04:30:00Z");       // NY Wed 00:30 · CHI Tue 23:30

  it("sends where the follow-up went out yesterday, holds where it went out today", () => {
    expect(shouldSendReviewRequestNow(NOW, ENDED, STAMPED, CHI)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, ENDED, STAMPED, NY)).toBe(false);
  });

  it("a null stamp (no follow-up ever sent) does not defer", () => {
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, CHI)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, NY)).toBe(true);
  });

  it("an unparseable stamp fails closed rather than sending", () => {
    expect(shouldSendReviewRequestNow(NOW, ENDED, new Date("nope"), NY)).toBe(false);
  });
});

describe("shouldSendReviewRequestNow — the 61h staleness cap, pinned against real zones", () => {
  it("is exactly the follow-up cap plus one local day", () => {
    expect(REVIEW_REQUEST_MAX_AGE_MS).toBe(61 * HOUR);
    expect(REVIEW_REQUEST_MAX_AGE_MS).toBe(FOLLOWUP_MAX_AGE_MS + 24 * HOUR);
  });

  it("treats the boundary as still-sendable, one millisecond past it as stale", () => {
    // UTC keeps the arithmetic honest: 09:30 UTC is inside the band and both
    // meeting ends land on strictly earlier UTC days.
    const now = new Date("2026-09-09T09:30:00Z");
    const exactlyAtCap = new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS);
    const oneMsPastCap = new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS - 1);
    expect(shouldSendReviewRequestNow(now, exactlyAtCap, null, "UTC")).toBe(true);
    expect(shouldSendReviewRequestNow(now, oneMsPastCap, null, "UTC")).toBe(false);
  });

  /**
   * THE DERIVATION, as a test. Antarctica/Troll falls back TWO hours on
   * 2026-10-25, making that local day 26 hours long. A meeting ending at
   * 00:00 local that day is the worst case; the follow-up goes out at the
   * very close of Monday's band (10:59); the review request's own band is
   * Tuesday 08:00-11:00, and its last qualifying instant is 61h after the
   * meeting ended. Mutation: 60h and the `bandOpens` assertion still passes
   * but `justInsideTheBand` fails.
   */
  it("covers the true worst case: a 26-hour local day, then a follow-up at the close of D+1", () => {
    const endedAtLocalMidnight = new Date("2026-10-24T22:00:00Z");  // Troll 00:00 Sun Oct 25
    const followupAtBandClose = new Date("2026-10-26T10:59:00Z");   // Troll 10:59 Mon Oct 26
    const bandOpens = new Date("2026-10-27T08:00:00Z");             // Troll 08:00 Tue Oct 27
    const bandCloses = new Date("2026-10-27T11:00:00Z");            // Troll 11:00 Tue Oct 27
    const Z = "Antarctica/Troll";

    expect(bandCloses.getTime() - endedAtLocalMidnight.getTime()).toBe(REVIEW_REQUEST_MAX_AGE_MS);
    expect(shouldSendReviewRequestNow(bandOpens, endedAtLocalMidnight, followupAtBandClose, Z)).toBe(true);
    // The band's own exclusive upper edge stops it, not the cap.
    expect(shouldSendReviewRequestNow(bandCloses, endedAtLocalMidnight, followupAtBandClose, Z)).toBe(false);
    const justInsideTheBand = new Date(bandCloses.getTime() - 60 * 1000);
    expect(shouldSendReviewRequestNow(justInsideTheBand, endedAtLocalMidnight, followupAtBandClose, Z)).toBe(true);
    // And on Monday itself — the follow-up's morning — it holds.
    expect(shouldSendReviewRequestNow(new Date("2026-10-26T09:00:00Z"), endedAtLocalMidnight, followupAtBandClose, Z)).toBe(false);
  });

  it("covers the ordinary US fall-back case comfortably, at 57 hours", () => {
    const endedAtLocalMidnight = new Date("2026-11-01T04:00:00Z");  // NY 00:00 EDT Sun Nov 1
    const followupNextMorning = new Date("2026-11-02T13:30:00Z");   // NY 08:30 EST Mon Nov 2
    const reviewMorning = new Date("2026-11-03T13:00:00Z");         // NY 08:00 EST Tue Nov 3
    expect(reviewMorning.getTime() - endedAtLocalMidnight.getTime()).toBe(57 * HOUR);
    expect(shouldSendReviewRequestNow(reviewMorning, endedAtLocalMidnight, followupNextMorning, NY)).toBe(true);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/review-request-gate.test.ts 2>&1 | grep -E "Failed to resolve|passed|failed" | head -3
```
Expected: FAIL — `./review-request-gate` cannot be resolved.

- [ ] **Step 4: Write the gate**

`apps/web/src/lib/automations/review-request-gate.ts`:

```ts
import { REVIEW_REQUEST_MAX_AGE_MS } from "@bis/db";
import {
  resolveAccountZone, isInMorningBand, isStrictlyEarlierLocalDay,
} from "@/lib/booking/followup-timing";

/**
 * WHEN a review request may be sent — the pure, unit-testable half of the
 * review-request pass. Composes the follow-up gate's own predicates rather
 * than copying them, so the two gates cannot drift; it cannot simply CALL
 * `shouldSendFollowupNow` because that carries the 37h cap and this one
 * carries 61h (`REVIEW_REQUEST_MAX_AGE_MS`, derived in packages/db).
 *
 * Rules, all of which must hold:
 *  0. A zone we can resolve — else FAIL CLOSED (no hour is defensible).
 *  1. Not stale: the meeting ended within 61h.
 *  2. Morning band, 08:00-11:00 in the account's zone.
 *  3. The meeting ended on a strictly EARLIER local day.
 *  4. THE COLLISION: the calendar's follow-up email already fires the morning
 *     after a completed meeting. If `followup_sent_at` is set, it must be on
 *     a strictly earlier local day than today — day one "how did it go?", day
 *     two "would you leave a review?" — never both the same morning. Null
 *     means no follow-up was sent (feature off, no email, send failed) and
 *     there is nothing to defer to.
 *
 * `review_requested_at` still does all the deduping; this gate has no memory.
 */
export function shouldSendReviewRequestNow(
  now: Date, meetingEnd: Date, followupSentAt: Date | null, timezone: string,
): boolean {
  const elapsedMs = now.getTime() - meetingEnd.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < 0) return false;                          // has not ended
  if (elapsedMs > REVIEW_REQUEST_MAX_AGE_MS) return false;  // too stale to be welcome

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;

  if (!isInMorningBand(now, zone)) return false;
  if (!isStrictlyEarlierLocalDay(meetingEnd, now, zone)) return false;

  if (followupSentAt !== null) {
    // An unparseable stamp is a data problem; the safe direction is to hold.
    if (!Number.isFinite(followupSentAt.getTime())) return false;
    if (!isStrictlyEarlierLocalDay(followupSentAt, now, zone)) return false;
  }
  return true;
}
```

- [ ] **Step 5: Run, mutate, commit**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/review-request-gate.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/t6.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/t6.txt
```
Expected: `exit=0`, 10 passed. Mutations to run and revert: (a) replace the `isStrictlyEarlierLocalDay(followupSentAt, now, zone)` check with `followupSentAt.getTime() < now.getTime()` → the collision pair must fail on its New_York half; (b) in packages/db change the cap to `60 * 60 * 60 * 1000` → three cap tests must fail (including cron-coupling's).

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-a" ] && git add apps/web/src/lib/automations/review-request-gate.ts apps/web/src/lib/automations/review-request-gate.test.ts && git commit -q -m "feat(automations): review-request gate — morning band, strictly-later day, defers to the follow-up, 61h cap pinned on Troll and NY

Mutation-checked: instant-compare instead of local-day compare fails the New_York half; a 60h cap fails three tests." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 7: The copy — default body, the ONE SMS composer, the email template

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (two keys)
- Create: `apps/web/src/lib/automations/review-request-copy.ts` + `.test.ts`
- Create: `apps/web/src/lib/email/templates/review-request.ts` + `.test.ts`

**Interfaces:**
- Consumes: `m` (`@/lib/messages`), `segmentsFor` (`@/lib/sms/segments`), `shell`, `button`, `escapeHtml`, `EmailBrand` (`./shell`).
- Produces:
  - `defaultReviewRequestBody(brandName: string): string`
  - `composeReviewRequestSms(body: string, reviewUrl: string): string` — the ONE function that appends the link; the settings counter and the sender both call it.
  - `reviewRequestEmail(input: { brand: EmailBrand; body: string; reviewUrl: string }): { subject: string; html: string; text: string }`

- [ ] **Step 1: Add the two copy keys**

In `apps/web/src/lib/messages.ts`, directly after the `"voice.numbers.*"` block (anywhere inside `m` is valid — the object is flat and keys are unique), add:

```ts
  // The review request's default body. `{name}` is the house placeholder,
  // filled at send time with the customer-facing brand name (never
  // accounts.name); the NoName variant drops the identifying clause rather
  // than inventing one. Both stay inside GSM-7 on purpose — a curly quote
  // or an accented vowel would flip every SMS to UCS-2 at 70 chars/segment.
  // The trailing colon is where the review link is appended
  // (composeReviewRequestSms); the email template renders it as a button.
  "automations.review.defaultBody": "Thanks for choosing {name}! If you have a minute, we'd love a quick review:",
  "automations.review.defaultBodyNoName": "Thanks for choosing us! If you have a minute, we'd love a quick review:",
```

- [ ] **Step 2: Write the failing copy tests**

`apps/web/src/lib/automations/review-request-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { defaultReviewRequestBody, composeReviewRequestSms } from "./review-request-copy";

const URL = "https://g.page/r/CXyZ123abc/review";

describe("composeReviewRequestSms — the ONE place the link is appended", () => {
  it("is the trimmed body, one space, the trimmed url", () => {
    expect(composeReviewRequestSms("  Please review us:  ", ` ${URL} `)).toBe(`Please review us: ${URL}`);
  });

  it("with no url yet, is just the body — what the settings counter shows before the link is typed", () => {
    expect(composeReviewRequestSms("Please review us:", "")).toBe("Please review us:");
    expect(composeReviewRequestSms("", URL)).toBe(URL);
  });
});

describe("defaultReviewRequestBody", () => {
  it("names the company, so a text from an unknown number does not read as spam", () => {
    expect(defaultReviewRequestBody("Rio Roofing"))
      .toBe("Thanks for choosing Rio Roofing! If you have a minute, we'd love a quick review:");
  });

  it("drops the identifying clause for a blank name instead of inventing one", () => {
    expect(defaultReviewRequestBody("   ")).toBe("Thanks for choosing us! If you have a minute, we'd love a quick review:");
  });

  it("inserts a name containing $ patterns literally", () => {
    expect(defaultReviewRequestBody("A$&B")).toContain("choosing A$&B!");
  });

  it("MEASURED: the default plus a real Google review link is ONE GSM-7 segment for a GSM-7 name", () => {
    // Measured, not assumed — this is the number the settings counter shows
    // and the number the client is billed for. Mutation: count the body alone
    // and this still passes, which is why the next test exists too.
    const s = segmentsFor(composeReviewRequestSms(defaultReviewRequestBody("Rio Roofing"), URL));
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
    expect(s.chars).toBe(115);
  });

  it("MEASURED: an accented company name flips the whole message to UCS-2 and costs TWO segments", () => {
    // Rio Grande Valley client names are heavily Hispanic; "García" is the
    // common case, not an edge case. The counter has to show this.
    const s = segmentsFor(composeReviewRequestSms(defaultReviewRequestBody("García Roofing"), URL));
    expect(s.encoding).toBe("ucs2");
    expect(s.segments).toBe(2);
  });
});
```

- [ ] **Step 3: Write the failing template test**

`apps/web/src/lib/email/templates/review-request.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { reviewRequestEmail } from "./review-request";
import type { EmailBrand } from "./shell";

const brand: EmailBrand = {
  name: "Rio Roofing", logoUrl: null,
  accent: { accent: "#1e3a8a", accentForeground: "#ffffff" } as EmailBrand["accent"],
};
const URL = "https://g.page/r/CXyZ123abc/review";

describe("reviewRequestEmail", () => {
  it("asks in the subject, in the brand's name, never the internal label", () => {
    expect(reviewRequestEmail({ brand, body: "Thanks!", reviewUrl: URL }).subject)
      .toBe("Would you leave Rio Roofing a review?");
  });

  it("renders the body as paragraphs, then the review link as the ONE button, in both parts", () => {
    const { html, text } = reviewRequestEmail({ brand, body: "Thanks for choosing us!\n\nWe'd love a review:", reviewUrl: URL });
    expect(html).toContain('<p style="margin:0 0 12px;">Thanks for choosing us!</p>');
    // escapeHtml leaves apostrophes alone (it escapes & < > " only).
    expect(html).toContain('<p style="margin:0 0 12px;">We\'d love a review:</p>');
    expect(html).toContain(`href="${URL}"`);
    expect(html).toContain(">Leave a review</a>");
    expect(text).toBe(`Thanks for choosing us!\n\nWe'd love a review:\n\n${URL}`);
  });

  it("escapes markup the operator typed, and escapes the url in the href", () => {
    const { html } = reviewRequestEmail({ brand, body: "<b>hi</b>", reviewUrl: "https://x.example/?a=1&b=2" });
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).toContain('href="https://x.example/?a=1&amp;b=2"');
    expect(html).not.toContain("<b>hi</b>");
  });
});
```

- [ ] **Step 4: Run to verify they fail**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/review-request-copy.test.ts src/lib/email/templates/review-request.test.ts 2>&1 | grep -E "Failed to resolve|passed|failed" | head -3
```
Expected: FAIL — both modules missing.

- [ ] **Step 5: Write the copy module and the template**

`apps/web/src/lib/automations/review-request-copy.ts`:

```ts
import { m } from "@/lib/messages";

/**
 * What a customer receives when the operator has not written their own
 * review request. `brandName` is the CUSTOMER-FACING name (brandDisplayName
 * in @bis/db) — the due-row carries only that, so this function cannot be
 * handed the agency's internal label. Blank name: the identifying clause is
 * dropped, never replaced with an invented noun (the text-back precedent).
 *
 * Function replacement, not a plain string: a company name containing `$&`
 * or `$'` would otherwise be re-interpreted by String.replace.
 */
export function defaultReviewRequestBody(brandName: string): string {
  if (!brandName.trim()) return m["automations.review.defaultBodyNoName"];
  return m["automations.review.defaultBody"].replace("{name}", () => brandName);
}

/**
 * THE ONE PLACE the review link is appended to an SMS body. The settings
 * page's segment counter and the review-request pass both call this with the
 * same inputs, so the count the operator approves is the count that sends —
 * the preview-vs-send drift fixed twice on 2026-09-06 cannot recur by
 * construction. No template tokens: the operator writes prose, the link goes
 * on the end, always.
 *
 * An empty url yields the body alone — what the counter shows before the
 * link is typed, and what a send would never do (the pass refuses a missing
 * url before it gets here).
 */
export function composeReviewRequestSms(body: string, reviewUrl: string): string {
  return [body.trim(), reviewUrl.trim()].filter(Boolean).join(" ");
}
```

`apps/web/src/lib/email/templates/review-request.ts`:

```ts
import { shell, escapeHtml, button, type EmailBrand } from "./shell";

export type ReviewRequestEmailInput = {
  brand: EmailBrand;
  /** Already defaulted by the caller (the pass) — this template renders
   *  what it is given. Blank lines are paragraph breaks, as in the
   *  follow-up template. */
  body: string;
  /** Validated http(s) by parseReviewRequestConfig before it reaches here. */
  reviewUrl: string;
};

/**
 * The review request, ~two mornings after a completed job (the morning after
 * the follow-up). The follow-up's restraint — a small branded header and the
 * operator's own paragraphs — plus the ONE thing a follow-up does not have:
 * a single call to action, the review link as a button, and the same link in
 * plain text for text-only clients.
 */
export function reviewRequestEmail(input: ReviewRequestEmailInput):
  { subject: string; html: string; text: string } {
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = shell(
    input.brand,
    paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join("")
    + `<p style="margin:16px 0 0;">${button(input.brand, input.reviewUrl, "Leave a review")}</p>`,
  );

  // Composed from the same paragraph list, never by stripping tags.
  const text = `${paragraphs.join("\n\n")}\n\n${input.reviewUrl}`;

  return { subject: `Would you leave ${input.brand.name} a review?`, html, text };
}
```

- [ ] **Step 6: Run, then commit**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/review-request-copy.test.ts src/lib/email/templates/review-request.test.ts src/lib/messages > /c/Users/danlo/AppData/Local/Temp/claude/t7.txt 2>&1; echo "exit=$?"; tail -4 /c/Users/danlo/AppData/Local/Temp/claude/t7.txt
```
Expected: `exit=0`, 10 passed. If the MEASURED test reports `chars` other than 115, the copy in `messages.ts` differs from the plan's — fix the copy to match, do not move the number. (The `'` in "we'd" must be a straight apostrophe; a curly one is outside GSM-7 and the encoding assertion will say so.)

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-a" ] && git add apps/web/src/lib/messages.ts apps/web/src/lib/automations/review-request-copy.ts apps/web/src/lib/automations/review-request-copy.test.ts apps/web/src/lib/email/templates/review-request.ts apps/web/src/lib/email/templates/review-request.test.ts && git commit -q -m "feat(automations): review-request copy — default body, the one SMS composer, the email template; segments measured" && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 8: The review-request pass — registered, capped, fail-closed, and the sentinel

**Files:**
- Create: `apps/web/src/lib/automations/caps.ts`
- Create: `apps/web/src/lib/automations/passes/review-request.ts`
- Create: `apps/web/src/lib/automations/passes/review-request.test.ts`
- Create: `apps/web/src/lib/automations/sentinel.test.ts`
- Modify: `apps/web/src/lib/automations/registry.ts`
- Modify: `apps/web/src/lib/automations/imports.test.ts` (one filename in the fixture guard)
- Modify: `apps/web/src/app/api/cron/reminders/route.test.ts` — ONLY: the `@bis/db` mock factory, a new `EMPTY_REVIEW_REQUESTS` const, and `reviewRequests: EMPTY_REVIEW_REQUESTS` on the strict-equality bodies.

**Interfaces:**
- Consumes: `listDueReviewRequests`, `stampReviewRequested`, `countReviewRequestsSince`, `ensureConversation`, `createMessage`, `updateMessageStatus`, `DueReviewRequest`, `ReviewRequestConfig` (`@bis/db`); `emailBrandNamed` (Task 2); `reviewRequestEmail` (Task 7); `resolveSmsSender`, `SmsGate` (`@/lib/sms/sender`); `toE164` (`@/lib/voice/phone-number`); `resolveAccountZone` (Task 4); `stampWithRetry`; `shouldSendReviewRequestNow` (Task 6); `composeReviewRequestSms`, `defaultReviewRequestBody` (Task 7).
- Produces: `AUTOMATION_TICK_CAP = 10`, `AUTOMATION_DAILY_CAP = 25`, `DAILY_CAP_WINDOW_MS = 24h`; `reviewRequestPass` (key `"reviewRequests"`, counters `{ sent, failed, unstamped, skippedInvalidConfig, skippedNoAddress, skippedSmsGate, skippedCap, waitingForMorning, unresolvableTimezone }`); `PASSES = [remindersPass, followupsPass, reviewRequestPass]`.

- [ ] **Step 1: `caps.ts`**

```ts
/**
 * FIXED platform constants (danlo, 2026-09-06), and they apply to RECIPE
 * passes only — the reminder and follow-up passes are uncapped (see their doc
 * comments: a reminder is one-to-one with a booking the customer made, and a
 * daily cap would drop reminders for a busy client).
 *
 * The cap's job is a burst guard against a bug or a bulk status change, not
 * a plan feature: the morning band is twelve ticks wide, so an uncapped pass
 * on a busy client is a burst. No storage, no UI, no grant question. Skipped
 * rows are counted as `skippedCap` and left unstamped, so they are simply
 * due again next tick or next morning — and the counter is what tells us if
 * a real client ever hits this, at which point per-client configuration is a
 * decision with evidence behind it.
 */
export const AUTOMATION_TICK_CAP = 10;
export const AUTOMATION_DAILY_CAP = 25;
/** "A day" is a rolling 24h from the tick, counted from the pass's own stamp
 *  column — no ledger table, no timezone. */
export const DAILY_CAP_WINDOW_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 2: Write the failing pass tests**

`apps/web/src/lib/automations/passes/review-request.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueReviewRequest } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueReviewRequests: vi.fn(), stampReviewRequested: vi.fn(), countReviewRequestsSince: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
  listDueReminders: vi.fn(), stampReminderSent: vi.fn(),
}));
// importOriginal keeps REVIEW_REQUEST_MAX_AGE_MS and the types real.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));

import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP } from "../caps";
import type { PassContext } from "../context";
import { reviewRequestPass } from "./review-request";
import { remindersPass } from "./reminders";

const STAMP_ATTEMPTS = STAMP_RETRY_DELAYS_MS.length + 1;
const TICK = new Date("2026-09-09T14:00:00Z");   // NY 10:00 Wed · CHI 09:00 Wed
const URL = "https://g.page/r/x/review";

/** Distinctive, complete fixture: every field the pass reads gets a value a
 *  passing test could not fake by coincidence. NO accountName — the type
 *  does not have one. */
function row(overrides: Partial<DueReviewRequest> = {}): DueReviewRequest {
  return {
    bookingId: "bk_r1", accountId: "acct_1",
    endsAt: "2026-09-08T22:00:00.000Z",           // NY Tue 18:00 — the previous local day
    followupSentAt: null,
    contactId: "ct_1", contactEmail: "booker@example.com", contactPhone: "(956) 555-0101",
    brandName: "Rio Roofing",
    branding: {
      brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null,
      replyToEmail: "wrong-should-not-be-used@rioroofing.com",
    },
    accountTimezone: "America/New_York",
    fromEmail: "hello@rioroofing.com", replyToEmail: "owner@rioroofing.com",
    body: "", config: { channel: "email", reviewUrl: URL },
    ...overrides,
  };
}

const emailSend = vi.fn();
const smsSend = vi.fn();
function ctx(): PassContext {
  return {
    db: {} as never, now: TICK, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }),
  };
}
const EMPTY = {
  sent: 0, failed: 0, unstamped: 0, skippedInvalidConfig: 0, skippedNoAddress: 0,
  skippedSmsGate: 0, skippedCap: 0, waitingForMorning: 0, unresolvableTimezone: 0,
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueReviewRequests.mockResolvedValue([]);
  dbMocks.stampReviewRequested.mockResolvedValue(undefined);
  dbMocks.countReviewRequestsSince.mockResolvedValue(0);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  dbMocks.listDueReminders.mockResolvedValue([]);
  dbMocks.stampReminderSent.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("review-request pass — email channel", () => {
  it("sends with the brand name and the company's from/reply-to, appends the link, then stamps", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    const c = await reviewRequestPass.run(ctx());
    expect(c).toEqual({ ...EMPTY, sent: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    const sent = emailSend.mock.calls[0]![0] as Record<string, string>;
    expect(sent.to).toBe("booker@example.com");
    expect(sent.fromName).toBe("Rio Roofing");
    expect(sent.fromAddress).toBe("hello@rioroofing.com");
    expect(sent.replyTo).toBe("owner@rioroofing.com");          // top-level, not branding.replyToEmail
    expect(sent.subject).toBe("Would you leave Rio Roofing a review?");
    expect(sent.body).toContain("Thanks for choosing Rio Roofing!"); // the default body
    expect(sent.body).toContain(URL);
    expect(sent.html).toContain(`href="${URL}"`);
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(dbMocks.createMessage).not.toHaveBeenCalled();         // email writes no messages row (follow-up precedent)
  });

  it("uses the operator's own body when one is stored", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ body: "It was a pleasure!" })]);
    await reviewRequestPass.run(ctx());
    expect((emailSend.mock.calls[0]![0] as { body: string }).body).toMatch(/^It was a pleasure!/);
  });

  it("send-then-stamp: a send that throws is counted failed and NOT stamped", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    emailSend.mockRejectedValueOnce(new Error("provider down"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("retries a transient stamp failure; gives up after the budget and counts unstamped while still sent", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    dbMocks.stampReviewRequested.mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(undefined);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(2);
    expect(emailSend).toHaveBeenCalledTimes(1);                  // the retry never re-sends

    dbMocks.stampReviewRequested.mockReset().mockRejectedValue(new Error("db unavailable"));
    emailSend.mockClear();
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, unstamped: 1 });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
  });
});

describe("review-request pass — SMS channel, the sendSmsAction discipline", () => {
  const sms = () => row({ config: { channel: "sms", reviewUrl: URL } });

  it("gate → write the message row → send → STAMP → mark sent, with the composed body everywhere", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const composed = `Thanks for choosing Rio Roofing! If you have a minute, we'd love a quick review: ${URL}`;
    expect(senderMock.resolveSmsSender).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(expect.anything(), "acct_1", "ct_1", "automation", "system");
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: composed }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: composed });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("when the sender gate refuses, skips and counts it — and does NOT fall back to email", async () => {
    // Mutation: add `else await sendEmail(...)` on the gate's refusal branch.
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedSmsGate: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("consults the gate ONCE per account per tick", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms(), { ...sms(), bookingId: "bk_r2", contactId: "ct_2" }]);
    await reviewRequestPass.run(ctx());
    expect(senderMock.resolveSmsSender).toHaveBeenCalledTimes(1);
  });

  it("a phone that cannot be normalised is no deliverable address: skipped, gate not even consulted", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([{ ...sms(), contactPhone: "12" }]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
    expect(senderMock.resolveSmsSender).not.toHaveBeenCalled();
  });

  it("a provider send failure marks the message row failed, counts failed, stamps nothing", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier timeout" }, "automation", "system");
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("stamps BEFORE marking the row sent, and a failing status update cannot un-stamp or un-send", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("status write failed"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(1);
  });
});

describe("review-request pass — fail closed, each case its own counter", () => {
  it("an invalid stored config sends nothing and is counted", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ config: null })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedInvalidConfig: 1 });
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("no email on the contact for the email channel is skippedNoAddress", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ contactEmail: null })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
  });

  it("an unresolvable account timezone is held and counted under its own name", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
  });

  it("THE COLLISION through the pass: a follow-up stamped today (NY) holds, the same stamp yesterday (CHI) sends", async () => {
    const stamped = "2026-09-09T04:30:00.000Z";   // NY Wed 00:30 · CHI Tue 23:30
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ followupSentAt: stamped, accountTimezone: "America/New_York" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, waitingForMorning: 1 });
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ followupSentAt: stamped, accountTimezone: "America/Chicago" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });
});

describe("caps — recipe passes only", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row({ bookingId: `bk_${i}`, contactId: `ct_${i}` }));

  it("per tick: N+1 eligible rows send N and skip one, which is NOT stamped", async () => {
    // Mutation: AUTOMATION_TICK_CAP = Infinity.
    dbMocks.listDueReviewRequests.mockResolvedValue(many(AUTOMATION_TICK_CAP + 1));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: AUTOMATION_TICK_CAP, skippedCap: 1 });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(AUTOMATION_TICK_CAP);
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalledWith(expect.anything(), `bk_${AUTOMATION_TICK_CAP}`);
  });

  it("per account per day: 24 already sent in the last 24h leaves room for exactly one", async () => {
    // Mutation: AUTOMATION_DAILY_CAP = Infinity.
    dbMocks.countReviewRequestsSince.mockResolvedValue(AUTOMATION_DAILY_CAP - 1);
    dbMocks.listDueReviewRequests.mockResolvedValue(many(3));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedCap: 2 });
    expect(dbMocks.countReviewRequestsSince).toHaveBeenCalledTimes(1);   // once per account per tick
    expect(dbMocks.countReviewRequestsSince).toHaveBeenCalledWith(expect.anything(), "acct_1",
      new Date(TICK.getTime() - 24 * 60 * 60 * 1000).toISOString());
  });

  it("rows that are merely waiting for their morning do not count against the caps", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([
      ...many(2).map((r) => ({ ...r, followupSentAt: "2026-09-09T04:30:00.000Z" })),  // held in NY
      row({ bookingId: "bk_go", contactId: "ct_go" }),
    ]);
    dbMocks.countReviewRequestsSince.mockResolvedValue(AUTOMATION_DAILY_CAP - 1);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, waitingForMorning: 2 });
  });

  it("the migrated reminder pass is NOT capped: 30 due reminders send 30", async () => {
    // Mutation: apply AUTOMATION_TICK_CAP inside passes/reminders.ts.
    dbMocks.listDueReminders.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({
      bookingId: `bk_rem_${i}`, accountId: "acct_1", startsAt: "2026-09-10T14:00:00.000Z",
      bookerTimezone: null, cancelToken: "tok", calendarPublicId: "cal",
      contactEmail: `b${i}@example.com`, contactName: "B", accountName: "Acme Co",
      accountTimezone: "America/New_York",
      branding: { brandName: "Acme", brandLogoPath: null, brandColor: null, brandNeutral: null,
        brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
      fromEmail: null, meetingUrl: null,
    })));
    expect(await remindersPass.run(ctx())).toEqual({ sent: 30, failed: 0, unstamped: 0 });
  });
});
```

`apps/web/src/lib/automations/sentinel.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * THE SENTINEL. `accounts.name` is the agency's internal label for a company
 * ("Rio Roofing — trial") and it has reached customers three times. Every
 * registered pass is run here with due rows that carry that label wherever
 * the row TYPE still allows it (the two migrated passes' rows do; the
 * review-request row cannot), and every argument of every send — email and
 * SMS, plus the SMS message row — is scanned for it.
 *
 * Mutation: in passes/reminders.ts pass `reminder.accountName` as `fromName`.
 */
const dbMocks = vi.hoisted(() => ({
  listDueReminders: vi.fn(), stampReminderSent: vi.fn(),
  listDueFollowups: vi.fn(), stampFollowupSent: vi.fn(),
  listDueReviewRequests: vi.fn(), stampReviewRequested: vi.fn(), countReviewRequestsSince: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: async () => ({ ok: true, from: "+19565550000" }) }));

import { runPasses } from "./harness";
import { PASSES } from "./registry";
import type { PassContext } from "./context";

const INTERNAL_LABEL = "Rio Roofing — trial";
const BRAND = "Rio Roofing";
const TICK = new Date("2026-09-09T14:00:00Z");   // NY 10:00, inside the morning band
const branding = {
  brandName: BRAND, brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset().mockResolvedValue(undefined);
  dbMocks.listDueReminders.mockResolvedValue([{
    bookingId: "bk_rem", accountId: "acct_1", startsAt: "2026-09-10T14:00:00.000Z", bookerTimezone: null,
    cancelToken: "tok", calendarPublicId: "cal", contactEmail: "a@example.com", contactName: "A",
    accountName: INTERNAL_LABEL, accountTimezone: "America/New_York", branding, fromEmail: null, meetingUrl: null,
  }]);
  dbMocks.listDueFollowups.mockResolvedValue([{
    bookingId: "bk_fu", accountId: "acct_1", startsAt: "2026-09-08T21:00:00.000Z", endsAt: "2026-09-08T22:00:00.000Z",
    contactEmail: "b@example.com", contactName: "B", accountName: INTERNAL_LABEL,
    accountTimezone: "America/New_York", branding, fromEmail: null, replyToEmail: null, followupBody: "",
  }]);
  const review = {
    accountId: "acct_1", endsAt: "2026-09-08T22:00:00.000Z", followupSentAt: null, brandName: BRAND, branding,
    accountTimezone: "America/New_York", fromEmail: null, replyToEmail: null, body: "",
  };
  dbMocks.listDueReviewRequests.mockResolvedValue([
    { ...review, bookingId: "bk_rv_email", contactId: "ct_1", contactEmail: "c@example.com", contactPhone: null,
      config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } },
    { ...review, bookingId: "bk_rv_sms", contactId: "ct_2", contactEmail: null, contactPhone: "9565550101",
      config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
  ]);
  dbMocks.countReviewRequestsSince.mockResolvedValue(0);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
});

describe("the sentinel: the internal label never reaches a customer, through ANY registered pass", () => {
  it("every argument of every email send, SMS send and SMS message row is free of the label", async () => {
    const emailSend = vi.fn(async () => ({ providerMessageId: "e" }));
    const smsSend = vi.fn(async () => ({ providerMessageId: "s" }));
    const ctx: PassContext = {
      db: {} as never, now: TICK, origin: "https://app.example.com",
      email: { isFake: true, send: emailSend }, sms: () => ({ isFake: true, send: smsSend }),
    };

    const results = await runPasses(PASSES, ctx);

    // Guard the fixture: every pass actually sent, so the scan has teeth.
    expect(results.reminders?.sent).toBe(1);
    expect(results.followups?.sent).toBe(1);
    expect(results.reviewRequests?.sent).toBe(2);

    const everything = [...emailSend.mock.calls, ...smsSend.mock.calls, ...dbMocks.createMessage.mock.calls]
      .map((args) => JSON.stringify(args)).join("\n");
    expect(everything).not.toContain("— trial");
    expect(everything).not.toContain(INTERNAL_LABEL);
    expect(everything).toContain(BRAND);   // and the brand name DID go out, in its place
  });

  it("the registry runs reminders, then follow-ups, then review requests — the collision depends on it", () => {
    expect(PASSES.map((p) => p.key)).toEqual(["reminders", "followups", "reviewRequests"]);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/passes/review-request.test.ts src/lib/automations/sentinel.test.ts 2>&1 | grep -E "Failed to resolve|passed|failed" | head -3
```
Expected: FAIL — `./review-request` cannot be resolved; the sentinel's registry assertion fails (two keys, not three).

- [ ] **Step 4: Write the pass**

`apps/web/src/lib/automations/passes/review-request.ts`:

```ts
import {
  listDueReviewRequests, stampReviewRequested, countReviewRequestsSince,
  ensureConversation, createMessage, updateMessageStatus,
  type DueReviewRequest, type ReviewRequestConfig,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { reviewRequestEmail } from "@/lib/email/templates/review-request";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { shouldSendReviewRequestNow } from "../review-request-gate";
import { composeReviewRequestSms, defaultReviewRequestBody } from "../review-request-copy";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import type { Pass, PassContext } from "../context";

// The messages rows this pass writes are the platform's, not a person's —
// the same actor shape the voice text-back uses ("voice"/"ai").
const ACTOR_ID = "automation";
const ACTOR_TYPE = "system" as const;

type Target =
  | { channel: "sms"; to: string; from: string }
  | { channel: "email"; to: string };

/**
 * Review request after a completed job — the first RECIPE on the harness.
 *
 * Trigger is a human: the operator's "Mark completed". Everything here is
 * then decided per row, in this order, each refusal counted under its own
 * name so triage can tell them apart:
 *   invalid config → unresolvable zone → not this morning (the gate, which
 *   also defers to the calendar follow-up) → no deliverable address → SMS
 *   gate refused (NO fallback to email) → caps → send → STAMP → (sms) mark
 *   the message row sent.
 *
 * Nothing new sends: `ctx.email` and `ctx.sms()` come from the harness.
 * The SMS path is `sendSmsAction`'s exactly — write the message row, then
 * send, mark failed on a provider error — so a review text shows up in the
 * customer's conversation like any other outbound text, and a reply lands
 * in the operator's inbox.
 */
export const reviewRequestPass: Pass = {
  key: "reviewRequests",
  async run(ctx) {
    const c = {
      sent: 0, failed: 0, unstamped: 0,
      skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedCap: 0,
      waitingForMorning: 0, unresolvableTimezone: 0,
    };
    const due = await listDueReviewRequests(ctx.db, ctx.now.toISOString());

    // Per-account memos for one tick: the sender gate and the daily count
    // are answered once per account, not once per row.
    const smsGates = new Map<string, SmsGate>();
    const sentToday = new Map<string, number>();
    let attemptsThisTick = 0;

    for (const row of due) {
      const config = row.config;
      if (config === null) {
        c.skippedInvalidConfig++;
        console.error(
          `review request skipped for booking ${row.bookingId}: account ${row.accountId}'s `
          + `review_request config is missing or invalid — set the review link in Automations`,
        );
        continue;
      }

      // RULE 0, before the gate, same as the follow-up pass: no resolvable
      // zone means no defensible hour. Counted separately so a
      // misconfiguration stays visible rather than hiding in waitingForMorning.
      if (resolveAccountZone(row.accountTimezone) === null) {
        c.unresolvableTimezone++;
        console.error(
          `review request HELD for booking ${row.bookingId}: account ${row.accountId}'s timezone `
          + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve — fix the account's timezone`,
        );
        continue;
      }

      const followupSentAt = row.followupSentAt ? new Date(row.followupSentAt) : null;
      if (!shouldSendReviewRequestNow(ctx.now, new Date(row.endsAt), followupSentAt, row.accountTimezone)) {
        c.waitingForMorning++;
        continue;
      }

      // The deliverable address for the CHOSEN channel. SMS: contacts.phone
      // is free-form and toE164 is what every number leaving this app goes
      // through (null = nothing we can text). Email: the address or nothing.
      let target: Target;
      if (config.channel === "sms") {
        const to = toE164(row.contactPhone);
        if (!to) {
          c.skippedNoAddress++;
          console.error(`review request skipped, no textable phone on file for booking ${row.bookingId}`);
          continue;
        }
        // THE gate, and the only one — never re-derived. Refusal means skip
        // and count, NOT "send it by email instead": a silent channel switch
        // is how an operator stops trusting what the settings page says.
        let gate = smsGates.get(row.accountId);
        if (!gate) {
          gate = await resolveSmsSender(ctx.db, row.accountId);
          smsGates.set(row.accountId, gate);
        }
        if (!gate.ok) {
          c.skippedSmsGate++;
          console.error(
            `review request skipped for booking ${row.bookingId}: account ${row.accountId} cannot text `
            + `(${gate.reason}) — not falling back to email`,
          );
          continue;
        }
        target = { channel: "sms", to, from: gate.from };
      } else {
        if (!row.contactEmail) {
          c.skippedNoAddress++;
          console.error(`review request skipped, no contact email on file for booking ${row.bookingId}`);
          continue;
        }
        target = { channel: "email", to: row.contactEmail };
      }

      // CAPS, recipe passes only (caps.ts). Checked AFTER the gate and the
      // address, so only rows that would actually send count against them;
      // a skipped row is left unstamped and is simply due again.
      if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
        c.skippedCap++;
        continue;
      }
      let today = sentToday.get(row.accountId);
      if (today === undefined) {
        today = await countReviewRequestsSince(
          ctx.db, row.accountId, new Date(ctx.now.getTime() - DAILY_CAP_WINDOW_MS).toISOString(),
        );
        sentToday.set(row.accountId, today);
      }
      if (today >= AUTOMATION_DAILY_CAP) {
        c.skippedCap++;
        continue;
      }
      attemptsThisTick++;
      sentToday.set(row.accountId, today + 1);

      const body = row.body.trim() || defaultReviewRequestBody(row.brandName);

      let smsRow: { messageId: string; providerMessageId: string } | null = null;
      try {
        if (target.channel === "sms") {
          smsRow = await sendSms(ctx, row, target.to, target.from, composeReviewRequestSms(body, config.reviewUrl));
        } else {
          await sendEmail(ctx, row, config, target.to, body);
        }
      } catch (e) {
        c.failed++;
        console.error(`review request send failed for booking ${row.bookingId}: ${String(e)}`);
        continue;
      }

      // SEND-THEN-STAMP. The stamp comes BEFORE the SMS row's status update:
      // the stamp is what stops ~12 duplicates over the morning band; the
      // status is what the inbox shows. Same residual as the other passes
      // when every attempt fails — counted, logged, and the repeats are live.
      const stamp = await stampWithRetry(() => stampReviewRequested(ctx.db, row.bookingId));
      if (!stamp.stamped) {
        c.unstamped++;
        console.error(
          `review request sent but NOT stamped for booking ${row.bookingId} after `
          + `${stamp.attempts} attempts — expect up to 11 more copies before the morning band `
          + `closes: ${String(stamp.lastError)}`,
        );
      }
      c.sent++;

      if (smsRow) {
        // Best effort: the text is gone and stamped. A failure here must not
        // re-label a delivered text "failed" (that invites a duplicate send).
        try {
          await updateMessageStatus(ctx.db, row.accountId, smsRow.messageId, "sent",
            { providerMessageId: smsRow.providerMessageId }, ACTOR_ID, ACTOR_TYPE);
        } catch (e) {
          console.error(`review request: text sent but message ${smsRow.messageId} not marked sent: ${String(e)}`);
        }
      }
    }

    return c;
  },
};

async function sendEmail(
  ctx: PassContext, row: DueReviewRequest, config: ReviewRequestConfig, to: string, body: string,
): Promise<void> {
  // emailBrandNamed, because the row carries the resolved brand name and
  // nothing else — there is no accountName here to get wrong.
  const brand = emailBrandNamed(row.branding, row.brandName);
  const { subject, html, text } = reviewRequestEmail({ brand, body, reviewUrl: config.reviewUrl });
  await ctx.email.send({
    to,
    fromName: brand.name,
    fromAddress: row.fromEmail ?? undefined,
    // The row's OWN top-level replyToEmail, never branding.replyToEmail —
    // the DueFollowup precedent.
    replyTo: normalizeReplyTo(row.replyToEmail),
    subject,
    body: text,
    html,
  });
}

/**
 * WRITE THEN SEND — sendSmsAction's discipline: the messages row exists
 * before anything leaves the building, so a provider failure is a visible
 * failed text in the conversation, not a silent gap. Returns the ids the
 * caller needs to mark it sent AFTER the stamp. Throws on a provider failure
 * after marking the row failed (best effort).
 */
async function sendSms(
  ctx: PassContext, row: DueReviewRequest, to: string, from: string, body: string,
): Promise<{ messageId: string; providerMessageId: string }> {
  const convo = await ensureConversation(ctx.db, row.accountId, row.contactId, ACTOR_ID, ACTOR_TYPE);
  const { id: messageId } = await createMessage(ctx.db, row.accountId, {
    conversationId: convo.id, channel: "sms", direction: "outbound", body,
  }, ACTOR_ID, ACTOR_TYPE);
  try {
    const { providerMessageId } = await ctx.sms().send({ to, from, body });
    return { messageId, providerMessageId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    try {
      await updateMessageStatus(ctx.db, row.accountId, messageId, "failed", { error: message }, ACTOR_ID, ACTOR_TYPE);
    } catch (statusErr) {
      console.error(`review request: could not mark message ${messageId} failed: ${String(statusErr)}`);
    }
    throw e;
  }
}
```

- [ ] **Step 5: Register it, extend the fixture guard, extend `route.test.ts`**

`registry.ts` — import and append `reviewRequestPass`:
```ts
import { reviewRequestPass } from "./passes/review-request";
// ...
export const PASSES: readonly Pass[] = [remindersPass, followupsPass, reviewRequestPass];
```

`imports.test.ts` — add `"passes/review-request.ts"` to the `arrayContaining` list in the fixture-guard test.

`route.test.ts` — three edits and nothing else:

(a) Inside the `vi.mock("@bis/db", () => ({ ... }))` factory, after `stampFollowupSent`, add:
```ts
  // The review-request pass runs on the same harness; with nothing due it
  // makes exactly one query. Enumerated because a factory mock THROWS on any
  // export it does not define — including the constant the gate module reads
  // at import time.
  listDueReviewRequests: async () => [],
  stampReviewRequested: async () => undefined,
  countReviewRequestsSince: async () => 0,
  ensureConversation: async () => ({ id: "convo", created: false }),
  createMessage: async () => ({ id: "msg" }),
  updateMessageStatus: async () => undefined,
  REVIEW_REQUEST_MAX_AGE_MS: 61 * 60 * 60 * 1000,
```
(b) After `EMPTY_FOLLOWUPS`, add:
```ts
const EMPTY_REVIEW_REQUESTS = {
  sent: 0, failed: 0, unstamped: 0, skippedInvalidConfig: 0, skippedNoAddress: 0,
  skippedSmsGate: 0, skippedCap: 0, waitingForMorning: 0, unresolvableTimezone: 0,
};
```
(c) The strict-equality bodies:
```bash
cd /c/Users/danlo/bis-platform/apps/web && sed -i 's/followups: EMPTY_FOLLOWUPS })/followups: EMPTY_FOLLOWUPS, reviewRequests: EMPTY_REVIEW_REQUESTS })/' src/app/api/cron/reminders/route.test.ts && grep -c "reviewRequests: EMPTY_REVIEW_REQUESTS" src/app/api/cron/reminders/route.test.ts
```
Expected: `5`. Then run the file; if any OTHER `toEqual` on the whole body still fails listing an unexpected `reviewRequests` key, add `reviewRequests: EMPTY_REVIEW_REQUESTS` to that expectation by hand. Verify the edit is nothing but additions:
```bash
cd /c/Users/danlo/bis-platform && git diff -- apps/web/src/app/api/cron/reminders/route.test.ts | grep -E "^-[^-]" ; echo "removed-lines-above (expect none)"
```

- [ ] **Step 6: Run everything in the automations tree, the route tests, typecheck, lint**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations src/app/api/cron > /c/Users/danlo/AppData/Local/Temp/claude/t8.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/t8.txt
cd /c/Users/danlo/bis-platform && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t8b.txt 2>&1; echo "exit=$?"; pnpm lint > /c/Users/danlo/AppData/Local/Temp/claude/t8c.txt 2>&1; echo "exit=$?"
```
Expected: `exit=0` throughout; review-request 17 passed, sentinel 2, harness 5, imports 2, cron-coupling 4, gate 10, copy 7, route 30.

- [ ] **Step 7: Mutation pass (record in the commit message)**

Run each, see exactly the named test fail, revert: (a) on the gate's refusal branch call `sendEmail` instead of `continue` → "does NOT fall back to email"; (b) `AUTOMATION_TICK_CAP = Infinity` → "per tick"; (c) `AUTOMATION_DAILY_CAP = Infinity` → "per account per day"; (d) in `passes/reminders.ts` use `reminder.accountName` as `fromName` → the sentinel; (e) swap `stampWithRetry` below the `updateMessageStatus("sent")` call → "stamps BEFORE marking the row sent".

- [ ] **Step 8: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-a" ] && git add apps/web/src/lib/automations/caps.ts apps/web/src/lib/automations/passes/review-request.ts apps/web/src/lib/automations/passes/review-request.test.ts apps/web/src/lib/automations/sentinel.test.ts apps/web/src/lib/automations/registry.ts apps/web/src/lib/automations/imports.test.ts apps/web/src/app/api/cron/reminders/route.test.ts && git commit -q -m "feat(automations): review-request pass — gate, no email fallback, caps (recipe passes only), send-then-stamp, sentinel

route.test.ts gains only the new response key and the new mocks. Mutation-checked: email
fallback, both caps, the sentinel, stamp-before-status." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 9: The Automations page — agency-only, preview counts body PLUS link, nav + palette

**Files:**
- Modify: `apps/web/src/lib/messages.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.ts`
- Create: `.../automations/actions.test.ts`
- Create: `.../automations/automations-settings.tsx`
- Create: `.../automations/page.tsx`
- Create: `.../automations/page.test.ts`
- Modify: `apps/web/src/lib/nav-groups.ts` (`NavIconKey`, the GROWTH group)
- Modify: `apps/web/src/lib/nav-groups.test.ts:28-36` (the growth expectation) + one new test
- Modify: `apps/web/src/components/app-sidebar.tsx` (lucide import, `NAV_ICONS`)
- Modify: `apps/web/src/lib/palette/registry.ts` (`NAV_KEYWORDS`)
- Modify: `apps/web/e2e/automations.spec.ts` (append two page tests)

**Interfaces:**
- Consumes: `getAutomation`, `upsertAutomation`, `parseReviewRequestConfig`, `AutomationRow`, `ReviewRequestChannel` (`@bis/db`); `requireAccountAccess`, `requireAgencyOnlyAccountAccess` (`@/lib/auth`); `brandDisplayName` (`@/lib/email/templates/shell`); `resolveSmsSender`, `SmsGate` (`@/lib/sms/sender`); `composeReviewRequestSms`, `defaultReviewRequestBody` (Task 7); `segmentsFor`; `useFormSubmit`, `notifyActionResult`; `SubmitButton`; `PageHeader`.
- Produces: `saveReviewRequestAction(accountId: string, formData: FormData): Promise<ActionResult>` reading form fields `enabled` ("on"), `channel` ("email"|"sms"), `review_url`, `body`; `AutomationsSettings` props `{ automation: AutomationRow | null; brandName: string; smsGate: SmsGate; saveAction: (fd: FormData) => Promise<ActionResult> }`; nav item `nav.automations` (agency only) under GROWTH; icon key `"automations"`.

- [ ] **Step 1: Copy keys**

In `apps/web/src/lib/messages.ts`: after `"nav.voice": "Voice",` add `"nav.automations": "Automations",`. Then, next to the two `automations.review.defaultBody*` keys from Task 7, add:

```ts
  // Automations page — agency-only, like Voice. Plain admin language; the
  // recipe names are the things a business owner would call them.
  "automations.title": "Automations",
  "automations.agencyOnly": "Only the agency may manage automations.",
  "automations.review.title": "Review requests",
  "automations.review.body": "The morning after a job is marked completed, ask the customer for a review. If the follow-up email is on, this waits one more morning so the two never land together. Off until you turn it on.",
  "automations.review.enabled": "Send review requests",
  "automations.review.channel": "Send by",
  "automations.review.channel.email": "Email",
  "automations.review.channel.sms": "Text message",
  "automations.review.url": "Review link",
  "automations.review.urlHint": "Where the customer leaves the review, for example your Google Business review link. It is added to the end of the message.",
  "automations.review.message": "Message",
  "automations.review.messageHint": "Leave blank to send our default message.",
  "automations.review.save": "Save review requests",
  "automations.review.saved": "Review requests saved",
  "automations.review.saveFailed": "Could not save review requests.",
  "automations.review.urlRequired": "Add the review link before turning this on.",
  "automations.review.urlInvalid": "The review link needs to be a full web address starting with https://",
```

- [ ] **Step 2: Write the failing action tests**

`.../automations/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ upsertAutomation: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}),
}));
// voice/actions.test.ts's switchable guard: requireAccountAccess resolves for
// any legitimate caller; the ACTION turns isAgency:false into {ok:false}.
const guardFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: guardFixture.isAgency }),
}));

import { m } from "@/lib/messages";
import { saveReviewRequestAction } from "./actions";

const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const URL = "https://g.page/r/x/review";

beforeEach(() => {
  guardFixture.isAgency = true;
  dbMocks.upsertAutomation.mockReset().mockResolvedValue({});
});

describe("saveReviewRequestAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + channel + link + body through serviceDb, validated with the pass's own parser", async () => {
    expect(await saveReviewRequestAction("acct_1",
      fd({ enabled: "on", channel: "sms", review_url: ` ${URL} `, body: "Thanks!" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      { enabled: true, body: "Thanks!", config: { channel: "sms", reviewUrl: URL } }, "user_1");
  });

  it("turning it on without a link is refused, with copy that says what to do", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: "" })))
      .toEqual({ ok: false, error: m["automations.review.urlRequired"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("a junk link is refused even while the recipe is OFF — a javascript: url must never be stored", async () => {
    // Mutation: validate only when `enabled`.
    for (const bad of ["javascript:alert(1)", "not a url", "ftp://x.example/r"]) {
      expect(await saveReviewRequestAction("acct_1", fd({ channel: "email", review_url: bad })), bad)
        .toEqual({ ok: false, error: m["automations.review.urlInvalid"] });
    }
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves an OFF row with an empty link, so the operator can fill it in later", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ channel: "email", review_url: "", body: "" }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "review_request",
      { enabled: false, body: "", config: { channel: "email", reviewUrl: "" } }, "user_1");
  });

  it("an unknown channel and a database failure both come back as a toastable failure", async () => {
    expect(await saveReviewRequestAction("acct_1", fd({ channel: "fax", review_url: URL })))
      .toEqual({ ok: false, error: m["automations.review.saveFailed"] });
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveReviewRequestAction("acct_1", fd({ enabled: "on", channel: "email", review_url: URL })))
      .toEqual({ ok: false, error: m["automations.review.saveFailed"] });
  });
});
```

- [ ] **Step 3: Write the failing page test**

`.../automations/page.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";

/**
 * The voice page test's one question, asked again here: which company name
 * does this page hand the preview? It must be the customer-facing brand
 * name, because the preview's default body and the sent default body are
 * built from the same string — an internal-label preview would show the
 * operator one message while a different one went out.
 */
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => ({ userId: "user_1" }),
}));
const dbFixture = vi.hoisted(() => ({ name: "Rio Roofing — trial", brandName: null as string | null }));
const dbMock = vi.hoisted(() => ({ getAutomation: vi.fn(), getBranding: vi.fn() }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { name: dbFixture.name }, error: null }) }),
      }),
    }),
  }),
  getAutomation: (...a: unknown[]) => dbMock.getAutomation(...a),
  getBranding: (...a: unknown[]) => dbMock.getBranding(...a),
}));
vi.mock("@/lib/sms/sender", () => ({
  resolveSmsSender: async () => ({ ok: false, reason: "a2p_not_approved" }),
}));
vi.mock("./actions", () => ({ saveReviewRequestAction: async () => ({ ok: true }) }));

const captured = vi.hoisted(() => ({ props: null as Record<string, unknown> | null }));
vi.mock("./automations-settings", () => ({
  AutomationsSettings: (props: Record<string, unknown>) => { captured.props = props; return null; },
}));

const { default: AutomationsPage } = await import("./page");

const ROW: AutomationRow = {
  id: "au1", account_id: "a1", recipe_key: "review_request", enabled: true, body: "Hi",
  config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" },
  created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z",
};

async function render() {
  captured.props = null;
  renderToStaticMarkup(await AutomationsPage({ params: Promise.resolve({ accountId: "a1" }) }));
  return captured.props!;
}

beforeEach(() => {
  dbFixture.name = "Rio Roofing — trial";
  dbFixture.brandName = null;
  dbMock.getAutomation.mockReset().mockResolvedValue(ROW);
  dbMock.getBranding.mockReset().mockImplementation(async () => ({
    brandName: dbFixture.brandName, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  }));
});

describe("automations page", () => {
  it("previews with the BRAND name, not the agency's internal accounts.name label", async () => {
    dbFixture.brandName = "Rio Roofing";
    expect((await render()).brandName).toBe("Rio Roofing");
  });

  it("falls back to the account name when the company has set no brand name", async () => {
    dbFixture.name = "Rio Roofing";
    expect((await render()).brandName).toBe("Rio Roofing");
  });

  it("hands the stored row and the SMS gate to the form", async () => {
    const props = await render();
    expect(props.automation).toEqual(ROW);
    expect(props.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });
});
```

- [ ] **Step 4: Run to verify they fail**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/automations" 2>&1 | grep -E "Failed to resolve|passed|failed" | head -3
```
Expected: FAIL — `./actions` and `./page` do not exist.

- [ ] **Step 5: The action**

`.../automations/actions.ts`:

```ts
"use server";

/**
 * Agency-only writes to `automations` (0025). The table grants
 * `authenticated` SELECT and nothing else, so `serviceDb()` is the ONLY
 * thing standing behind this write — which is why the `isAgency` check
 * below is not optional. Same guard shape as voice/actions.ts, returned
 * (Result-typed) rather than thrown.
 */

import { revalidatePath } from "next/cache";
import {
  serviceDb, upsertAutomation, parseReviewRequestConfig, type ReviewRequestChannel,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { m } from "@/lib/messages";

export type ActionResult = { ok: true } | { ok: false; error: string };

const CHANNELS: readonly ReviewRequestChannel[] = ["email", "sms"];

export async function saveReviewRequestAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const rawChannel = String(formData.get("channel") ?? "email");
  const channel = (CHANNELS as readonly string[]).includes(rawChannel)
    ? (rawChannel as ReviewRequestChannel) : null;
  if (!channel) return { ok: false, error: m["automations.review.saveFailed"] };
  const reviewUrl = String(formData.get("review_url") ?? "").trim();
  const enabled = formData.get("enabled") === "on";
  const body = String(formData.get("body") ?? "");

  // Validated on WRITE with the same parser the pass applies on READ. A junk
  // link is refused even while the recipe is off (a javascript: URL must never
  // be stored), and turning the recipe on requires a link.
  const parsed = parseReviewRequestConfig({ channel, reviewUrl });
  if (reviewUrl && !parsed) return { ok: false, error: m["automations.review.urlInvalid"] };
  if (enabled && !parsed) return { ok: false, error: m["automations.review.urlRequired"] };

  try {
    await upsertAutomation(serviceDb(), accountId, "review_request",
      { enabled, body, config: { channel, reviewUrl } }, userId);
  } catch (e) {
    console.error(`saveReviewRequestAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.review.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}
```

- [ ] **Step 6: The form**

`.../automations/automations-settings.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AutomationRow, ReviewRequestChannel } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { composeReviewRequestSms, defaultReviewRequestBody } from "@/lib/automations/review-request-copy";
import type { ActionResult } from "./actions";

type StoredForm = { enabled: boolean; channel: ReviewRequestChannel; reviewUrl: string; body: string };

/**
 * What the form shows for a stored row. Reads the RAW jsonb leniently on
 * purpose: an invalid stored link must be SHOWN so the operator can fix it,
 * not hidden by the parser the pass (correctly) refuses it with.
 */
function formDefaults(row: AutomationRow | null): StoredForm {
  const cfg = row?.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>) : {};
  return {
    enabled: row?.enabled ?? false,
    channel: cfg.channel === "sms" ? "sms" : "email",
    reviewUrl: typeof cfg.reviewUrl === "string" ? cfg.reviewUrl : "",
    body: row?.body ?? "",
  };
}

const TEXTAREA =
  "w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs outline-none "
  + "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function AutomationsSettings({
  automation, brandName, smsGate, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx) — what
   *  the default body previews here is the string that sends. */
  brandName: string;
  smsGate: SmsGate;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const stored = formDefaults(automation);
  // Controlled, so the counter recomputes on every keystroke — the
  // message-composer / voice-settings precedent. The Select stays
  // uncontrolled (defaultValue + onValueChange) for the reason in
  // lib/forms/use-form-submit.ts; this state only redraws the preview.
  const [channel, setChannel] = useState<ReviewRequestChannel>(stored.channel);
  const [reviewUrl, setReviewUrl] = useState(stored.reviewUrl);
  const [body, setBody] = useState(stored.body);

  // THE COUNTER COUNTS BODY PLUS LINK, through the ONE function the sender
  // uses, so what the operator approves is what is billed. An empty body
  // previews the live default (empty-means-default, as the column contract
  // says), and an empty link previews the body alone.
  const previewBody = body || defaultReviewRequestBody(brandName);
  const preview = segmentsFor(composeReviewRequestSms(previewBody, reviewUrl));

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.review.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["automations.review.title"]}</CardTitle>
        <CardDescription>{m["automations.review.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="enabled" name="enabled" defaultChecked={stored.enabled} />
            <Label htmlFor="enabled">{m["automations.review.enabled"]}</Label>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="channel">{m["automations.review.channel"]}</Label>
            <Select
              name="channel" defaultValue={stored.channel}
              onValueChange={(v) => setChannel(v === "sms" ? "sms" : "email")}
            >
              <SelectTrigger id="channel" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{m["automations.review.channel.email"]}</SelectItem>
                <SelectItem value="sms">{m["automations.review.channel.sms"]}</SelectItem>
              </SelectContent>
            </Select>
            {channel === "sms" && !smsGate.ok ? (
              // The composer's own copy for the same two refusals — the pass
              // will skip and count, never fall back to email, so say so here.
              <p className="text-xs text-muted-foreground">
                {smsGate.reason === "a2p_not_approved"
                  ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="review_url">{m["automations.review.url"]}</Label>
            <Input
              id="review_url" name="review_url" type="url" inputMode="url"
              value={reviewUrl} onChange={(e) => setReviewUrl(e.target.value)}
              placeholder="https://g.page/r/.../review"
            />
            <p className="text-xs text-muted-foreground">{m["automations.review.urlHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="body">{m["automations.review.message"]}</Label>
            <textarea
              id="body" name="body" rows={3} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultReviewRequestBody(brandName)}
              className={TEXTAREA}
            />
            <p className="text-xs text-muted-foreground">{m["automations.review.messageHint"]}</p>
            {channel === "sms" ? (
              <p className="text-xs text-muted-foreground" data-testid="review-sms-count">
                {m["compose.smsSegments"]
                  .replace("{chars}", String(preview.chars))
                  .replace("{segments}", String(preview.segments))}
              </p>
            ) : null}
          </div>

          <SubmitButton pending={pending}>{m["automations.review.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: The page**

`.../automations/page.tsx`:

```tsx
import { serviceDb, getAutomation, getBranding } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { resolveSmsSender } from "@/lib/sms/sender";
import { m } from "@/lib/messages";
import { AutomationsSettings } from "./automations-settings";
import { saveReviewRequestAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Agency-only throughout, the Voice page's shape: `requireAgencyOnlyAccountAccess`
 * gates the page, every write in ./actions.ts re-checks `isAgency`, and the
 * nav item is hidden from clients — hiding a link is not authorization.
 * Reads go through serviceDb() like the writes; the whole page is one
 * audience, so a second db client buys nothing.
 */
export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  await requireAgencyOnlyAccountAccess(accountId);

  const db = serviceDb();
  const [automation, brandName, smsGate] = await Promise.all([
    getAutomation(db, accountId, "review_request"),
    // The default body names the company. Resolved through brandDisplayName
    // exactly as the pass's due-row is (packages/db), never off
    // `accounts.name` alone — a preview that does not match what sends is
    // worse than no preview. Cosmetic, so a failed read degrades to "".
    (async () => {
      try {
        const [branding, { data, error }] = await Promise.all([
          getBranding(db, accountId),
          db.from("accounts").select("name").eq("id", accountId).maybeSingle(),
        ]);
        if (error) throw new Error(error.message);
        return brandDisplayName(branding, (data as { name: string } | null)?.name ?? "");
      } catch (e) {
        console.error(`automations: brand name lookup failed for account ${accountId}: ${String(e)}`);
        return "";
      }
    })(),
    // The same gate the pass consults, so the page can say up front why an
    // SMS review request would be skipped.
    resolveSmsSender(db, accountId),
  ]);

  const boundSave = saveReviewRequestAction.bind(null, accountId);

  return (
    <>
      <PageHeader title={m["automations.title"]} />
      <div className="max-w-2xl space-y-6 p-6">
        <AutomationsSettings
          automation={automation}
          brandName={brandName}
          smsGate={smsGate}
          saveAction={boundSave}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 8: Nav, icon, palette, and the nav test**

`apps/web/src/lib/nav-groups.ts`: add `| "automations"` to `NavIconKey` (after `"voice"`), and in the GROWTH group append after the calendar item:

```ts
        // Agency only, like Voice: every recipe here spends the client's
        // money and messages their customers, so v1 is agency-configured
        // (spec Section 2). The route is gated independently by
        // requireAgencyOnlyAccountAccess and every action re-checks isAgency.
        ...(isAgency
          ? ([{ href: `${base}/automations`, labelKey: "nav.automations", iconKey: "automations" }] satisfies NavItemSpec[])
          : []),
```

`apps/web/src/lib/nav-groups.test.ts`: in the "places Dashboard, ..." test change the growth line to
```ts
    expect(growth!.items.map((i) => i.labelKey)).toEqual(["nav.forms", "nav.calendar", "nav.automations"]);
```
and add after the Voice test:
```ts
  it("shows Automations to the agency and hides it from a client", () => {
    const agencyGrowth = buildNavGroups(BASE, true)[3]!;
    const clientGrowth = buildNavGroups(BASE, false)[3]!;
    expect(agencyGrowth.items.map((i) => i.labelKey)).toContain("nav.automations");
    expect(clientGrowth.items.map((i) => i.labelKey)).not.toContain("nav.automations");
  });
```

`apps/web/src/components/app-sidebar.tsx`: add `Zap` to the `lucide-react` import list, and `automations: Zap,` to `NAV_ICONS` after `voice: Phone,`.

`apps/web/src/lib/palette/registry.ts`: in `NAV_KEYWORDS` add
```ts
  "/automations": ["review", "google review", "recipes", "follow up", "text"],
```
(The palette entry itself is derived from the nav by construction; `registry.test.ts`'s parity test proves it.)

- [ ] **Step 9: Append the page tests to the e2e spec**

Append to `apps/web/e2e/automations.spec.ts`:

```ts
test.describe("the Automations page", () => {
  test("the agency reaches it from the nav and sees the review-request card", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
    await page.getByRole("link", { name: "Automations" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/automations$`));
    await expect(page.getByText("Review requests")).toBeVisible();
    await expect(page.getByLabel("Review link")).toBeVisible();
  });
});

test.describe("a client cannot reach the Automations page", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("is sent to their own dashboard, and the nav never offered it", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/dashboard$`));
    await expect(page.getByRole("link", { name: "Automations" })).toHaveCount(0);
  });
});
```

- [ ] **Step 10: Run the unit tests, typecheck, lint, then the e2e spec**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/automations" src/lib/nav-groups.test.ts src/lib/palette src/lib/messages > /c/Users/danlo/AppData/Local/Temp/claude/t9.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/t9.txt
cd /c/Users/danlo/bis-platform && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t9b.txt 2>&1; echo "exit=$?"; pnpm lint > /c/Users/danlo/AppData/Local/Temp/claude/t9c.txt 2>&1; echo "exit=$?"
cd /c/Users/danlo/bis-platform/apps/web && npx playwright test automations.spec.ts > /c/Users/danlo/AppData/Local/Temp/claude/t9d.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/t9d.txt
```
Expected: all `exit=0`; actions 6, page 3, nav-groups +1, palette parity still green; e2e 3 passed. If `page.getByText("Review requests")` matches twice (the card title and the checkbox label "Send review requests"), use `page.getByText("Review requests", { exact: true })`.

- [ ] **Step 11: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-a" ] && git add apps/web/src/lib/messages.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations" apps/web/src/lib/nav-groups.ts apps/web/src/lib/nav-groups.test.ts apps/web/src/components/app-sidebar.tsx apps/web/src/lib/palette/registry.ts apps/web/e2e/automations.spec.ts && git commit -q -m "feat(automations): agency-only Automations page — review requests; counter counts body plus link; nav + palette" && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 10: Gates on the whole tree, the ledger, and the review request — no merge

**Files:**
- Modify: `.superpowers/sdd/progress.md` (gitignored ledger — append)
- No source changes unless a gate fails.

- [ ] **Step 1: The three gates, uncontended, exit codes read from `$?`**

Nothing else may be running against this repo (a parallel `next dev`, another vitest run) — contended suites go red on wall clock, not behaviour.

```bash
cd /c/Users/danlo/bis-platform && pnpm check > /c/Users/danlo/AppData/Local/Temp/claude/gate-check.txt 2>&1; echo "check exit=$?"; grep -E "Tests +[0-9]+ passed|Test Files" /c/Users/danlo/AppData/Local/Temp/claude/gate-check.txt
cd /c/Users/danlo/bis-platform && pnpm --filter web build > /c/Users/danlo/AppData/Local/Temp/claude/gate-build.txt 2>&1; echo "build exit=$?"
cd /c/Users/danlo/bis-platform && pnpm --filter web test:e2e > /c/Users/danlo/AppData/Local/Temp/claude/gate-e2e.txt 2>&1; echo "e2e exit=$?"; tail -8 /c/Users/danlo/AppData/Local/Temp/claude/gate-e2e.txt
```
Expected: all three `exit=0`. Unit counts at least: db 183 + 5 + 3 + 6 = **197**; web 1160 + 1 (parity) + 1 (emailBrandNamed) + 6 (helpers) + 11 (harness/imports/coupling) + 10 (gate) + 7 (copy) + 3 (template) + 17 (pass) + 2 (sentinel) + 6 (actions) + 3 (page) + 1 (nav) = **1228**. e2e **70/70** (67 + 3). Any red: re-run that spec ALONE first and judge by wall clock before believing it.

- [ ] **Step 2: The one thing tests cannot see — say so in the ledger, and eyeball what can be eyeballed**

Start the built app locally (`pnpm --filter web start` after the build above) and open the Automations page for a test account in a browser: switch the channel to Text message and confirm the counter line changes as the link is typed, and that the A2P reason shows for an unapproved account. Record what was seen. This is the spec's stated residual; it is not covered by any gate.

- [ ] **Step 3: Ledger entry**

Append to `.superpowers/sdd/progress.md`:

```
## === AUTOMATIONS MILESTONE A on branch feat/automations-a, base <main sha> ===
MIGRATION 0025 APPLIED TO PROD (tlbkbmlrfafquucsmsmm) <date> -- NEVER RE-APPLY.
  Pre-flight: 0024 latest, automations absent, review_requested_at absent. Post-verified:
  authenticated SELECT only on automations, anon nothing.
Tasks 1-9 committed (<first sha>..<last sha>). route.test.ts untouched through Task 5; Task 8
added only the reviewRequests key + mocks (verified: no removed lines in its diff).
GATES on the branch: check <exit> (db <n> . web <n>) . build <exit> . e2e <n>/<n>.
MUTATION PASS: <list each mutation and the test that failed>.
EYEBALLED: <what the browser showed for the counter and the A2P reason>.
INERT ON DEPLOY: automations has zero rows; every row defaults enabled=false; the
review-request pass's idle tick is ONE automations read.
▶ NEXT: review -> danlo merges -> verify the deploy (build log names the commit) -> watch one
real Pro tick's JSON carry `reviewRequests` with the two migrated shapes unchanged.
```

- [ ] **Step 4: Request review — do NOT merge**

Invoke `superpowers:requesting-code-review` against the branch's full diff (`git diff main...feat/automations-a`). Highest-consequence claims for the reviewer to verify independently: that the two migrated passes' JSON is byte-identical (the untouched test file is the evidence), that no pass can construct a provider (imports.test.ts), that `PassContext`/`DueReviewRequest` have no `accountName`, that the caps do NOT apply to reminders/follow-ups, and that the SMS branch never falls back to email. Fix waves are re-reviewed; fixes introduce defects.

Then hand danlo the branch, the gate numbers, and the deploy note: the migration is already live and inert; the code deploys when he pushes `main`.

---

## Plan self-review (done at authoring time, 2026-09-06)

**Spec coverage.** Section 2: table + grants → Task 1; review URL in config, validated both ways → Tasks 3, 9; stamps on the domain row → Tasks 1, 3; harness as a registry of isolated passes → Task 5; nothing new sends, providers on ctx → Tasks 5, 8 (`imports.test.ts`); file layout → Global File Structure. Section 3: due query → Task 3; timing via the exported predicates → Tasks 4, 6; the collision → Tasks 6, 8; channel with no fallback → Task 8; no template tokens, sender appends the link → Task 7; preview counts body plus link → Tasks 7, 9; 61h derived and pinned → Tasks 3, 6; idempotency via `stampWithRetry` → Task 8. Section 4: brand-name leak prevented structurally → Tasks 2, 3, 5 (`@ts-expect-error`), 8 (sentinel); fixed caps, recipe passes only → Task 8; isolation → Task 5; fail closed and counted → Task 8; off by default → Task 1; grants at the layer that sees them → Task 1. Section 5: every listed test has a task, including the cron coupling (Task 5), the due-query projection (Task 3, on the real database), watched-failing-first (Task 1), `mintClientToken` moved (Task 1), gates and the mutation record (every task, Task 10), and the residual (Task 10, Step 2).

**Placeholders.** None: every step carries its code, every command its expected output. The one deliberately deferred decision (whether a stale-tab save toasts) is inherited unchanged from `notifyActionResult`.

**Type consistency.** `PassContext.sms` is a function everywhere it is used (`ctx.sms().send`); `Pass.run` returns `PassCounters`, and every pass returns a plain numeric record; `DueReviewRequest.config` is `ReviewRequestConfig | null` and the pass narrows it before use; `upsertAutomation`'s patch shape is identical in Task 3, the action, and both test files; `resolveSmsSender` returns `SmsGate` and the pass memoises that type; `reviewRequestEmail` takes `{ brand, body, reviewUrl }` in Tasks 7 and 8; `isStrictlyEarlierLocalDay(instant, now, zone)` argument order is the same in Tasks 4 and 6.

**Two departures from the spec, both explained where they happen.** (1) `brandDisplayName` is copied into `@bis/db` with a parity test rather than moved, because moving it would break every web test that mocks `@bis/db` with a factory (Task 2). (2) "Watched failing first" for the e2e grants spec fails on PostgREST's `PGRST205` (table absent from the schema cache), not the raw `42P01` the spec named; the db-level test in the same task fails on `42P01`. The spec is corrected alongside this plan.
