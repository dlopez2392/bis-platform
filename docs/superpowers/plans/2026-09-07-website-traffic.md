# Website Traffic in the CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Website" section in every client's CRM showing visitors, pages, sources, places and devices from the site BIS built for them, fed by nightly snapshots of Vercel Web Analytics stored in BIS, linked through one agency-only settings card, dogfooded on the BIS website.

**Architecture:** A `sites` row links an account to its Vercel project. A `siteTraffic` pass in the existing cron harness pulls yesterday's aggregates per site once a day (backfilling up to 30 days) into `site_traffic_daily` and `site_traffic_breakdown`. The page reads only those tables through a pure view-model module that also builds the plain-language sentence; the chart and panels are token-only components. The Vercel client is constructed lazily inside the pass.

**Tech Stack:** as PR #32 (Next.js 16 app router, Supabase/PostgREST, vitest, Playwright, lucide-react, shadcn/ui). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-07-website-traffic-design.md`. Locked mockup: `docs/design/website-section.html`. Everything below was read from source on 2026-09-07 at `525893d`; re-read a line before editing it if `main` has moved.

## Global Constraints

- **Branch `feat/website-traffic` (already exists off `main` 525893d with the spec commit `ade39f8`).** PR-only repo: never push `main`; merge only when CI `verify` + `e2e` are green on the PR's CURRENT head and danlo says so. Verify the branch in the same command that commits: `B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit … || echo "BRANCH MOVED TO $B"`.
- **Every shell command starts with `cd /c/Users/danlo/bis-platform &&`** (the cwd persists; it slipped four times in one session). Relative paths in `git add`; never `sed -i`/`cp` a path with `[brackets]` — Read/Edit only for those.
- **Migration 0029 is applied ONCE via the Supabase MCP `apply_migration` on `tlbkbmlrfafquucsmsmm` after a pre-flight read; 0012–0028 are applied — never touch.** The db suite and e2e share that project with production.
- **Every new test names its mutation** and the executor greps the mutated text count before trusting a mutation run. vitest: a filter with `[brackets]` matches nothing — use a bracket-free substring; run the db suite ALONE (`pnpm --filter @bis/db test`); `cd apps/web && npx playwright test <file>` for one spec.
- **Tokens only in UI** (DESIGN.md): no hard-coded colours/radii/shadows; radii 8/11/999px only; every metric with context (`StatTile` throws without it); skeletons, not spinners; nothing animates on scroll; `prefers-reduced-motion` respected; renders in dark AND light.
- **Copy is plain language a business owner reads at 7 AM**; never "Vercel", "API", "sync", "dimension" in client-facing text. New strings live in `apps/web/src/lib/messages.ts` under a `website.` prefix.
- **`accounts.name` never reaches a customer-facing string** (the sentinel); nothing here sends to customers, but the page and the sentence read `brand_name` if a name is ever needed — they never need one.
- **Env (server only):** `VERCEL_API_TOKEN` (team-scoped), `VERCEL_TEAM_ID` = `team_8zjV46sJxQDsVzikNQa1JaO2`. The Vercel client is constructed lazily inside the pass and the action; nothing reads these at module scope.
- **Cap:** 10 sites per tick (`AUTOMATION_TICK_CAP`); 30 days max backfill; 20 rows per dimension per day; sync hour 03:00 in the account's timezone.
- **Baseline at 525893d:** db 221 · web 1413 · e2e 72 — record the real numbers from the first `pnpm check`.

## File Structure

- `packages/db/supabase/migrations/0029_sites_traffic.sql` — CREATE: three tables, RLS, grants.
- `packages/db/src/sites.ts` — CREATE: `SiteRow`, `TrafficDay`, `TrafficBreakdownRow`, `getSiteForAccount`, `upsertSite`, `listSitesToSync`, `writeTrafficDay`, `stampSiteSynced`, `listTrafficDays`, `listTrafficBreakdown`. `packages/db/src/index.ts` — MODIFY: export them.
- `packages/db/src/test/sites-grants.test.ts` — CREATE. `packages/db/src/test/sites.test.ts` — CREATE. `packages/db/src/test/fixtures.ts:29-33` — MODIFY: three tables join the cleanup list. `apps/web/e2e/fixtures/sweep.ts:64-67` — MODIFY: same three.
- `apps/web/src/lib/vercel/web-analytics.ts` — CREATE: `VercelAnalytics` (lazy), `fetchDayTraffic`, parsers. Test beside it.
- `apps/web/src/lib/website/channel.ts` — CREATE: `channelOf`. `apps/web/src/lib/website/sync-window.ts` — CREATE: `isPastSyncHour`, `daysToSync`. `apps/web/src/lib/website/view-model.ts` — CREATE: `buildWebsiteView`. `apps/web/src/lib/website/sentence.ts` — CREATE: `websiteSentence`. Tests beside each.
- `apps/web/src/lib/automations/passes/site-traffic.ts` — CREATE: the pass. `registry.ts` — MODIFY (last entry). `imports.test.ts:51-54` — MODIFY (the pass file joins the enumerated list). Test beside the pass.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/page.tsx`, `website-section.tsx`, `daily-chart.tsx`, `breakdown-panel.tsx`, `device-strip.tsx`, `loading.tsx`, `actions.ts`, `actions.test.ts`, `link-site-card.tsx` — CREATE.
- `apps/web/src/lib/nav-groups.ts:64-67` — MODIFY (Website under OVERVIEW, both roles); `nav-groups.test.ts:28-37` — MODIFY; `apps/web/src/components/app-sidebar.tsx:43-58` — MODIFY (`website: Globe`); `apps/web/src/lib/messages.ts` — MODIFY (`nav.website`, `website.*` keys).
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx` — MODIFY: render `LinkSiteCard`. `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` — MODIFY: one section for the chart + strip.
- `docs/runbooks/website-setup.md` — CREATE. `apps/web/e2e/website.spec.ts` — CREATE.

---

### Task 1: Pre-flight — the two open checks, analytics enabled on the dogfood project, env in place

**Files:**
- Create: `docs/runbooks/website-setup.md` (the checks' findings section only; the rest in Task 9)
- Modify: `apps/web/.env.local` (local only, never committed)

**Interfaces:**
- Produces: the decision for spec Open check 2 (city dimension → `PLACE_DIMENSION` in Task 4 is `"city"` or the fallback), recorded in the runbook.

- [ ] **Step 1: Enable Web Analytics on the BIS website project** (the dogfood; danlo approved it in the spec).

Run:
```bash
cd /c/Users/danlo/bis-platform && vercel project web-analytics bis-website --scope danlopez508-8452s-projects --format json
```
Expected: JSON with `"enabled": true` (or a line saying it is already enabled). If the command asks for confirmation interactively, add `--yes`.

- [ ] **Step 2: Probe the API for the place dimension.** Use the Vercel MCP tool `get_web_analytics` with `projectId: "bis-website"`, `teamId: "team_8zjV46sJxQDsVzikNQa1JaO2"`, `mode: "aggregate"`, `by: ["city"]`, `since: <today-7d>`, `until: <today>`. Then repeat with `by: ["region"]`, then `by: ["country"]`.

Expected: either rows/an empty `data` array (dimension exists) or a 400 naming an invalid dimension. Record the result verbatim in the runbook under "Findings", and write the decision: `PLACE_DIMENSION = "city"` if city is accepted, else `"region"` if accepted, else the fallback (the third panel becomes Devices & browsers; Task 4's `PLACE_DIMENSION` is set to `"country"` and Task 7 hides the Places panel when it is `"country"`).

- [ ] **Step 3: Pin plan allowance and retention.** Read `https://vercel.com/docs/analytics/limits-and-pricing` (WebFetch). Record in the runbook: included events per month for the team's plan, overage price, and data retention. The pull uses 5 aggregate queries per site per day; note the resulting API-call count for 10 sites (50/day).

- [ ] **Step 4: The token — STOP and ask danlo.** The pass and the link card need `VERCEL_API_TOKEN`. Ask danlo to create one at vercel.com → Account → Tokens, scope = the team, expiry = 1 year, and to add it to the bis-platform Vercel project env (Production + Preview) together with `VERCEL_TEAM_ID=team_8zjV46sJxQDsVzikNQa1JaO2`. For local runs add both to `apps/web/.env.local`. Do not proceed to Task 5's live check or Task 9 without it; Tasks 2–8 need no token (all mocked).

- [ ] **Step 5: Write the runbook's Findings section.**

```markdown
# Website traffic — build checklist and setup runbook

Audience: danlo, once per BIS-built site (and once for the platform env).

## Findings (2026-09-07, Task 1 of the plan)

- Web Analytics enabled on `bis-website` via `vercel project web-analytics` on <date>.
- Place dimension: <city | region | country-only fallback> — API said: <verbatim>.
- Plan allowance: <n> events/month included, <price> per <n> over; retention <n> days.
- Platform env: `VERCEL_API_TOKEN` (team-scoped, expires <date>), `VERCEL_TEAM_ID`.
```

- [ ] **Step 6: Commit the runbook stub.**

```bash
cd /c/Users/danlo/bis-platform && git add docs/runbooks/website-setup.md && B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit -m "docs(website): runbook stub with the pre-flight findings — analytics enabled on bis-website, place dimension decided, plan limits pinned" || echo "BRANCH MOVED TO $B"
```

---

### Task 2: Migration 0029 — `sites`, `site_traffic_daily`, `site_traffic_breakdown`, pinned grants

**Files:**
- Create: `packages/db/supabase/migrations/0029_sites_traffic.sql`
- Create: `packages/db/src/test/sites-grants.test.ts`
- Modify: `packages/db/src/test/fixtures.ts:29-33` (cleanup list)
- Modify: `apps/web/e2e/fixtures/sweep.ts:64-67` (cascade list)

**Interfaces:**
- Produces: the three tables exactly as below; Task 3's column strings must match them.

- [ ] **Step 1: Write the grants test FIRST (watch it fail before the migration).**

`packages/db/src/test/sites-grants.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

/**
 * The boundary 0029 draws, pinned in both directions at the level that can
 * see it (unit tests that mock the db are blind to grants). The three tables
 * are read-only for `authenticated` under the member policy; every write is
 * the cron's, through the service role.
 *
 * Mutation: drop the `revoke insert, update, delete …` line for `sites` in
 * 0029 — the first test's row list grows past SELECT.
 */
const TABLES = ["sites", "site_traffic_daily", "site_traffic_breakdown"] as const;

describe("0029 sites/traffic privileges", () => {
  for (const table of TABLES) {
    it(`${table}: authenticated has SELECT and nothing else; anon has nothing`, async () => {
      await withRollback(async (c) => {
        const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
          `select grantee, privilege_type from information_schema.role_table_grants
            where table_schema = 'public' and table_name = $1
              and grantee in ('authenticated', 'anon')
            order by grantee, privilege_type`,
          [table],
        );
        expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
      });
    });
  }
});

async function seedTwoSites(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const { rows: [a] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, brand_name, client_access_enabled) values ($1,'org_SITE_A','Alpha','Alpha',true) returning id", [agency.id]);
  const { rows: [b] } = await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, brand_name, client_access_enabled) values ($1,'org_SITE_B','Bravo','Bravo',true) returning id", [agency.id]);
  const { rows: [sa] } = await c.query(
    "insert into sites (account_id, vercel_project_id, domain) values ($1,'prj_A','alpha.example') returning id", [a.id]);
  const { rows: [sb] } = await c.query(
    "insert into sites (account_id, vercel_project_id, domain) values ($1,'prj_B','bravo.example') returning id", [b.id]);
  await c.query(
    "insert into site_traffic_daily (site_id, account_id, day, visitors, pageviews) values ($1,$2,'2026-09-01',10,20),($3,$4,'2026-09-01',30,40)",
    [sa.id, a.id, sb.id, b.id]);
  await c.query(
    "insert into site_traffic_breakdown (site_id, account_id, day, dimension, value, visitors, pageviews) values ($1,$2,'2026-09-01','page','/',10,20),($3,$4,'2026-09-01','page','/',30,40)",
    [sa.id, a.id, sb.id, b.id]);
  return { a: a.id as string, b: b.id as string, sa: sa.id as string };
}

describe("0029 sites/traffic RLS", () => {
  it("a client reads only its own site, daily rows and breakdown rows", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoSites(c);
      await actAs(c, { org_id: "org_SITE_A" });
      const sites = await c.query("select account_id from sites");
      expect(sites.rows.map((r: any) => r.account_id)).toEqual([a]);
      const daily = await c.query("select account_id from site_traffic_daily");
      expect(daily.rows.map((r: any) => r.account_id)).toEqual([a]);
      const bd = await c.query("select account_id from site_traffic_breakdown");
      expect(bd.rows.map((r: any) => r.account_id)).toEqual([a]);
    }));

  // One refused statement per transaction (a refusal aborts it; the next
  // statement reports 25P02, not its own reason).
  it("a client cannot INSERT a site, and the refusal is insufficient_privilege (42501)", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoSites(c);
      await actAs(c, { org_id: "org_SITE_A" });
      await expect(
        c.query("insert into sites (account_id, vercel_project_id, domain) values ($1,'prj_X','x.example')", [a]),
      ).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot UPDATE a daily row, and the refusal is 42501", () =>
    withRollback(async (c) => {
      const { sa } = await seedTwoSites(c);
      await actAs(c, { org_id: "org_SITE_A" });
      await expect(
        c.query("update site_traffic_daily set visitors = 999 where site_id = $1", [sa]),
      ).rejects.toMatchObject({ code: "42501" });
    }));

  it("the agency reads every row", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoSites(c);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select account_id from sites order by vercel_project_id");
      expect(rows.map((r: any) => r.account_id)).toEqual([a, b]);
    }));
});
```

- [ ] **Step 2: Run it, watch it fail on the missing tables.**

Run: `cd /c/Users/danlo/bis-platform && pnpm --filter @bis/db test -- sites-grants`
Expected: FAIL — `relation "sites" does not exist` (42P01) in every test. Read the failing NAMES; a run that passes here means the filter matched nothing.

- [ ] **Step 3: Write the migration.**

`packages/db/supabase/migrations/0029_sites_traffic.sql`:
```sql
-- 0029: website traffic in the CRM (docs/superpowers/specs/2026-09-07-
-- website-traffic-design.md). Three tables:
--
-- 1. sites — one row per client website, linking the account to its Vercel
--    project. One per account for now (unique account_id); a table rather
--    than columns on accounts so a second site is a row, not a migration.
-- 2. site_traffic_daily — visitors/pageviews per site per LOCAL day (the
--    account's timezone). The chart and the tiles.
-- 3. site_traffic_breakdown — top-20 per dimension per day (page, source,
--    place, device), visitors + pageviews each.
--
-- account_id is carried on the two traffic tables as well as on sites so the
-- member policy is one indexed predicate per table, not a join through
-- sites on every read; the pass writes it from the site row it holds.
--
-- Grants copy 0025 (automations): `authenticated` SELECT under RLS and
-- nothing else; every write is the cron's through serviceDb(). Supabase
-- default privileges auto-grant ALL on a new table (the 0020 lesson), so the
-- revokes are here. Aggregates only — no IP, no visitor id, ever.
--
-- FKs are `on delete restrict` like every account_id FK since 0017: a
-- linked site with history is never dropped by accident; unlinking is an
-- explicit delete of the traffic rows first (the fixture cleanup order).

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete restrict unique,
  vercel_project_id text not null unique,
  domain text not null,
  analytics_enabled_at timestamptz,
  last_synced_day date,
  created_at timestamptz not null default now()
);
alter table public.sites enable row level security;
create policy sites_tenant on public.sites for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
grant select on public.sites to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.sites from authenticated;
revoke all on public.sites from anon;

create table public.site_traffic_daily (
  site_id uuid not null references public.sites(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  day date not null,
  visitors integer not null check (visitors >= 0),
  pageviews integer not null check (pageviews >= 0),
  primary key (site_id, day)
);
create index site_traffic_daily_account_day on public.site_traffic_daily (account_id, day desc);
alter table public.site_traffic_daily enable row level security;
create policy site_traffic_daily_tenant on public.site_traffic_daily for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
grant select on public.site_traffic_daily to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.site_traffic_daily from authenticated;
revoke all on public.site_traffic_daily from anon;

create table public.site_traffic_breakdown (
  site_id uuid not null references public.sites(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  day date not null,
  dimension text not null check (dimension in ('page', 'source', 'place', 'device')),
  value text not null,
  visitors integer not null check (visitors >= 0),
  pageviews integer not null check (pageviews >= 0),
  primary key (site_id, day, dimension, value)
);
create index site_traffic_breakdown_account_day on public.site_traffic_breakdown (account_id, day desc, dimension);
alter table public.site_traffic_breakdown enable row level security;
create policy site_traffic_breakdown_tenant on public.site_traffic_breakdown for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
grant select on public.site_traffic_breakdown to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.site_traffic_breakdown from authenticated;
revoke all on public.site_traffic_breakdown from anon;
```

- [ ] **Step 4: Pre-flight read, then apply ONCE.** Supabase MCP `execute_sql` (read-only):
```sql
select table_name from information_schema.tables where table_schema='public' and table_name in ('sites','site_traffic_daily','site_traffic_breakdown');
select version from supabase_migrations.schema_migrations order by version desc limit 1;
```
Expected: no rows for the tables; latest version `0028…`. Then Supabase MCP `apply_migration` with `name: "0029_sites_traffic"` and the SQL above. Record "0029 APPLIED <time> — NEVER RE-APPLY" in the ledger the moment it returns.

- [ ] **Step 5: Run the grants test — green.**

Run: `cd /c/Users/danlo/bis-platform && pnpm --filter @bis/db test -- sites-grants`
Expected: PASS, 7 tests (3 privilege + 4 RLS).

- [ ] **Step 6: Cleanup lists.** In `packages/db/src/test/fixtures.ts` the cleanup array (line 29) becomes — the three new tables FIRST, since `sites` restricts on `accounts` and the traffic tables restrict on `sites`:
```ts
    for (const table of ["site_traffic_breakdown", "site_traffic_daily", "sites",
                         "calls", "bookings", "calendars", "events", "form_submissions", "forms",
                         "messages", "conversations",
                         "checklist_items", "contact_tags", "notes", "tasks",
                         "opportunities", "pipeline_stages", "pipelines", "custom_fields",
                         "custom_values", "tags", "contacts",
                         "voice_profiles", "phone_numbers", "automations"]) {
```
In `apps/web/e2e/fixtures/sweep.ts` the `for (const table of [...])` list at line 64 gains the same three names at the FRONT, in that order, with a one-line comment: `// 0029: traffic restricts on sites, sites on accounts — these three first.`

- [ ] **Step 7: Run the db suite alone, then commit.**

Run: `cd /c/Users/danlo/bis-platform && pnpm --filter @bis/db test`
Expected: all green; count = baseline + 7.

```bash
cd /c/Users/danlo/bis-platform && git add packages/db/supabase/migrations/0029_sites_traffic.sql packages/db/src/test/sites-grants.test.ts packages/db/src/test/fixtures.ts apps/web/e2e/fixtures/sweep.ts && B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit -m "feat(db): 0029 sites + site_traffic_daily + site_traffic_breakdown (applied) — member read policy, service-role writes, grants pinned" || echo "BRANCH MOVED TO $B"
```

---
### Task 3: The data layer — `packages/db/src/sites.ts`

**Files:**
- Create: `packages/db/src/sites.ts`
- Create: `packages/db/src/test/sites.test.ts`
- Modify: `packages/db/src/index.ts` (append one export block after the `./automations` block)

**Interfaces:**
- Produces (exact):
  - `type SiteRow = { id: string; accountId: string; vercelProjectId: string; domain: string; analyticsEnabledAt: string | null; lastSyncedDay: string | null }`
  - `type TrafficDay = { day: string; visitors: number; pageviews: number }`
  - `type TrafficDimension = "page" | "source" | "place" | "device"`
  - `type TrafficBreakdownRow = { day: string; dimension: TrafficDimension; value: string; visitors: number; pageviews: number }`
  - `getSiteForAccount(db, accountId): Promise<SiteRow | null>`
  - `upsertSite(db, accountId, input: { vercelProjectId: string; domain: string; analyticsEnabledAt?: string | null }): Promise<SiteRow>`
  - `listSitesToSync(db): Promise<(SiteRow & { accountTimezone: string })[]>` — every site whose account exists, with the timezone
  - `writeTrafficDay(db, site: { id: string; accountId: string }, day: string, totals: { visitors: number; pageviews: number }, breakdown: Omit<TrafficBreakdownRow, "day">[]): Promise<void>` — upsert daily, delete+insert breakdown for that day
  - `stampSiteSynced(db, siteId: string, day: string): Promise<void>`
  - `listTrafficDays(db, accountId, fromDay: string, toDay: string): Promise<TrafficDay[]>` — ascending by day, inclusive
  - `listTrafficBreakdown(db, accountId, fromDay: string, toDay: string): Promise<TrafficBreakdownRow[]>`

- [ ] **Step 1: Write the failing real-db test.**

`packages/db/src/test/sites.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import {
  getSiteForAccount, upsertSite, listSitesToSync, writeTrafficDay, stampSiteSynced,
  listTrafficDays, listTrafficBreakdown,
} from "../sites";

/** Real database, rolled up by withTestAccount's cleanup (the three new
 *  tables were added to its list in Task 2). Mutation for the round trip:
 *  make writeTrafficDay skip the breakdown delete — the second write's
 *  breakdown count doubles. */
describe("sites data layer", () => {
  it("links a site once per account, and upsert updates in place", () =>
    withTestAccount(async (db, accountId) => {
      expect(await getSiteForAccount(db, accountId)).toBeNull();
      const created = await upsertSite(db, accountId, { vercelProjectId: `prj_t_${accountId.slice(0, 8)}`, domain: "one.example" });
      expect(created.accountId).toBe(accountId);
      expect(created.lastSyncedDay).toBeNull();
      const updated = await upsertSite(db, accountId, { vercelProjectId: `prj_t_${accountId.slice(0, 8)}`, domain: "two.example", analyticsEnabledAt: "2026-09-07T00:00:00.000Z" });
      expect(updated.id).toBe(created.id);
      expect(updated.domain).toBe("two.example");
      expect(updated.analyticsEnabledAt).not.toBeNull();
      const due = await listSitesToSync(db);
      const mine = due.find((s) => s.id === created.id);
      expect(mine?.accountTimezone).toBe("America/Chicago");
    }));

  it("writes a day (totals + breakdown), replaces it on rewrite, stamps, and reads back in order", () =>
    withTestAccount(async (db, accountId) => {
      const site = await upsertSite(db, accountId, { vercelProjectId: `prj_t_${accountId.slice(0, 8)}`, domain: "one.example" });
      await writeTrafficDay(db, site, "2026-09-02", { visitors: 5, pageviews: 9 }, [
        { dimension: "page", value: "/", visitors: 5, pageviews: 7 },
        { dimension: "source", value: "google.com", visitors: 3, pageviews: 5 },
      ]);
      await writeTrafficDay(db, site, "2026-09-01", { visitors: 2, pageviews: 3 }, [
        { dimension: "page", value: "/", visitors: 2, pageviews: 3 },
      ]);
      // A rewrite of the same day REPLACES its breakdown rather than adding to it.
      await writeTrafficDay(db, site, "2026-09-02", { visitors: 6, pageviews: 10 }, [
        { dimension: "page", value: "/services", visitors: 6, pageviews: 8 },
      ]);
      await stampSiteSynced(db, site.id, "2026-09-02");

      const days = await listTrafficDays(db, accountId, "2026-09-01", "2026-09-02");
      expect(days).toEqual([
        { day: "2026-09-01", visitors: 2, pageviews: 3 },
        { day: "2026-09-02", visitors: 6, pageviews: 10 },
      ]);
      const rows = await listTrafficBreakdown(db, accountId, "2026-09-02", "2026-09-02");
      expect(rows).toEqual([{ day: "2026-09-02", dimension: "page", value: "/services", visitors: 6, pageviews: 8 }]);
      expect((await getSiteForAccount(db, accountId))?.lastSyncedDay).toBe("2026-09-02");
    }));
});
```

- [ ] **Step 2: Run it — fails on the missing module.**

Run: `cd /c/Users/danlo/bis-platform && pnpm --filter @bis/db test -- sites.test`
Expected: FAIL, `Cannot find module '../sites'`.

- [ ] **Step 3: Implement.**

`packages/db/src/sites.ts`:
```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A client's website: the link between their account and the Vercel project
 * BIS built and hosts (spec 2026-09-07-website-traffic-design). One per
 * account for now. Every write here is the cron's or the agency's through
 * serviceDb(); `authenticated` holds SELECT only (0029).
 */
export type SiteRow = {
  id: string; accountId: string; vercelProjectId: string; domain: string;
  analyticsEnabledAt: string | null; lastSyncedDay: string | null;
};
export type TrafficDay = { day: string; visitors: number; pageviews: number };
export type TrafficDimension = "page" | "source" | "place" | "device";
export type TrafficBreakdownRow = {
  day: string; dimension: TrafficDimension; value: string; visitors: number; pageviews: number;
};

const SITE_COLS = "id, account_id, vercel_project_id, domain, analytics_enabled_at, last_synced_day";

type SiteDbRow = {
  id: string; account_id: string; vercel_project_id: string; domain: string;
  analytics_enabled_at: string | null; last_synced_day: string | null;
};

function toSite(r: SiteDbRow): SiteRow {
  return {
    id: r.id, accountId: r.account_id, vercelProjectId: r.vercel_project_id, domain: r.domain,
    analyticsEnabledAt: r.analytics_enabled_at, lastSyncedDay: r.last_synced_day,
  };
}

export async function getSiteForAccount(db: SupabaseClient, accountId: string): Promise<SiteRow | null> {
  const { data, error } = await db.from("sites").select(SITE_COLS).eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`getSiteForAccount failed: ${error.message}`);
  return data ? toSite(data as SiteDbRow) : null;
}

export async function upsertSite(
  db: SupabaseClient, accountId: string,
  input: { vercelProjectId: string; domain: string; analyticsEnabledAt?: string | null },
): Promise<SiteRow> {
  const row: Record<string, unknown> = {
    account_id: accountId, vercel_project_id: input.vercelProjectId, domain: input.domain,
  };
  if (input.analyticsEnabledAt !== undefined) row.analytics_enabled_at = input.analyticsEnabledAt;
  const { data, error } = await db.from("sites")
    .upsert(row, { onConflict: "account_id" }).select(SITE_COLS).single();
  if (error || !data) throw new Error(`upsertSite failed: ${error?.message}`);
  return toSite(data as SiteDbRow);
}

/** Every linked site with its account's timezone — the pass decides per
 *  site whether "yesterday" has ended there. */
export async function listSitesToSync(db: SupabaseClient): Promise<(SiteRow & { accountTimezone: string })[]> {
  const { data, error } = await db.from("sites")
    .select(`${SITE_COLS}, accounts!inner(timezone)`).order("created_at", { ascending: true });
  if (error) throw new Error(`listSitesToSync failed: ${error.message}`);
  return ((data ?? []) as unknown as (SiteDbRow & { accounts: { timezone: string } })[]).map((r) => ({
    ...toSite(r), accountTimezone: r.accounts.timezone,
  }));
}

/**
 * One local day for one site: totals upserted, the day's breakdown replaced
 * (delete then insert) so a re-pull never doubles a row. Not a transaction —
 * PostgREST has none — so the order is totals LAST: a failure between the
 * breakdown delete and its insert leaves a day with totals missing, which
 * the pass re-pulls because the site was not stamped.
 */
export async function writeTrafficDay(
  db: SupabaseClient, site: { id: string; accountId: string }, day: string,
  totals: { visitors: number; pageviews: number },
  breakdown: Omit<TrafficBreakdownRow, "day">[],
): Promise<void> {
  const del = await db.from("site_traffic_breakdown").delete().eq("site_id", site.id).eq("day", day);
  if (del.error) throw new Error(`writeTrafficDay breakdown delete failed: ${del.error.message}`);
  if (breakdown.length > 0) {
    const ins = await db.from("site_traffic_breakdown").insert(breakdown.map((b) => ({
      site_id: site.id, account_id: site.accountId, day,
      dimension: b.dimension, value: b.value, visitors: b.visitors, pageviews: b.pageviews,
    })));
    if (ins.error) throw new Error(`writeTrafficDay breakdown insert failed: ${ins.error.message}`);
  }
  const up = await db.from("site_traffic_daily").upsert({
    site_id: site.id, account_id: site.accountId, day, visitors: totals.visitors, pageviews: totals.pageviews,
  }, { onConflict: "site_id,day" });
  if (up.error) throw new Error(`writeTrafficDay totals failed: ${up.error.message}`);
}

export async function stampSiteSynced(db: SupabaseClient, siteId: string, day: string): Promise<void> {
  const { error } = await db.from("sites").update({ last_synced_day: day }).eq("id", siteId);
  if (error) throw new Error(`stampSiteSynced failed: ${error.message}`);
}

export async function listTrafficDays(
  db: SupabaseClient, accountId: string, fromDay: string, toDay: string,
): Promise<TrafficDay[]> {
  const { data, error } = await db.from("site_traffic_daily")
    .select("day, visitors, pageviews").eq("account_id", accountId)
    .gte("day", fromDay).lte("day", toDay).order("day", { ascending: true });
  if (error) throw new Error(`listTrafficDays failed: ${error.message}`);
  return (data ?? []) as TrafficDay[];
}

export async function listTrafficBreakdown(
  db: SupabaseClient, accountId: string, fromDay: string, toDay: string,
): Promise<TrafficBreakdownRow[]> {
  const { data, error } = await db.from("site_traffic_breakdown")
    .select("day, dimension, value, visitors, pageviews").eq("account_id", accountId)
    .gte("day", fromDay).lte("day", toDay).order("day", { ascending: true });
  if (error) throw new Error(`listTrafficBreakdown failed: ${error.message}`);
  return (data ?? []) as TrafficBreakdownRow[];
}
```

Append to `packages/db/src/index.ts` after the `./automations` export block:
```ts
export { getSiteForAccount, upsertSite, listSitesToSync, writeTrafficDay, stampSiteSynced,
         listTrafficDays, listTrafficBreakdown,
         type SiteRow, type TrafficDay, type TrafficDimension, type TrafficBreakdownRow } from "./sites";
```

- [ ] **Step 4: Run — green; typecheck.**

Run: `cd /c/Users/danlo/bis-platform && pnpm --filter @bis/db test -- sites.test && pnpm --filter @bis/db typecheck`
Expected: 2 passed; tsc clean. Then the mutation: comment out the `del` statement in `writeTrafficDay`, run `-- sites.test` → the rewrite test fails (`toEqual` sees two rows); restore; green.

- [ ] **Step 5: Commit.**

```bash
cd /c/Users/danlo/bis-platform && git add packages/db/src/sites.ts packages/db/src/test/sites.test.ts packages/db/src/index.ts && B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit -m "feat(db): sites data layer — link, list-to-sync, write a day (replace breakdown), stamp, read a range" || echo "BRANCH MOVED TO $B"
```

---

### Task 4: Pure modules — the Vercel client and parsers, `channelOf`, the sync window

**Files:**
- Create: `apps/web/src/lib/vercel/web-analytics.ts` + `web-analytics.test.ts`
- Create: `apps/web/src/lib/website/channel.ts` + `channel.test.ts`
- Create: `apps/web/src/lib/website/sync-window.ts` + `sync-window.test.ts`

**Interfaces:**
- Produces (exact):
  - `PLACE_DIMENSION: "city" | "region" | "country"` (set from Task 1's finding; default `"city"`)
  - `type DayTraffic = { visitors: number; pageviews: number; pages: DimRow[]; sources: DimRow[]; places: DimRow[]; devices: DimRow[] }` with `type DimRow = { value: string; visitors: number; pageviews: number }`
  - `class VercelAnalytics { constructor(opts: { token: string; teamId: string; fetchImpl?: typeof fetch }); countVisits(projectId, sinceIso, untilIso): Promise<{ visitors: number; pageviews: number }>; aggregate(projectId, sinceIso, untilIso, by: string, limit: number): Promise<DimRow[]>; fetchDayTraffic(projectId, sinceIso, untilIso): Promise<DayTraffic> }`
  - `vercelAnalyticsFromEnv(): VercelAnalytics` — throws `Error("VERCEL_API_TOKEN/VERCEL_TEAM_ID unset")` when either is missing
  - `class VercelApiError extends Error { status: number; code: string | null }`
  - `parseCount(json: unknown): { visitors: number; pageviews: number }`, `parseAggregate(json: unknown, by: string): DimRow[]`
  - `channelOf(referrerHostname: string): "Direct" | "Google" | "Bing" | "DuckDuckGo" | "Yahoo" | "Social" | "Other websites"`
  - `SYNC_HOUR = 3`, `MAX_BACKFILL_DAYS = 30`
  - `isPastSyncHour(now: Date, timezone: string): boolean`
  - `daysToSync(input: { now: Date; timezone: string; lastSyncedDay: string | null }): string[]` — local `YYYY-MM-DD` keys, oldest first, ending at yesterday (local), at most 30; `[]` when `lastSyncedDay` is yesterday or later

- [ ] **Step 1: Failing tests for the parsers and the client.**

`apps/web/src/lib/vercel/web-analytics.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { VercelAnalytics, VercelApiError, parseCount, parseAggregate, vercelAnalyticsFromEnv } from "./web-analytics";

/** Recorded shapes from Vercel's Web Analytics API docs (count and aggregate).
 *  Mutation: in parseAggregate, read `pageviews` only (drop the `count`
 *  fallback) — the events-shaped fixture case fails. */
const COUNT_JSON = { version: 1, query: {}, data: { pageviews: 1250, visitors: 980 } };
const AGG_JSON = { version: 1, query: { groupBy: ["requestPath"] }, data: [
  { requestPath: "/", pageviews: 400, visitors: 300 },
  { requestPath: "/services", count: 120, visitors: 90 },
] };

describe("parsers", () => {
  it("parseCount reads visitors and pageviews, refusing anything else", () => {
    expect(parseCount(COUNT_JSON)).toEqual({ visitors: 980, pageviews: 1250 });
    expect(() => parseCount({ data: {} })).toThrow(/count/);
    expect(() => parseCount(null)).toThrow(/count/);
  });
  it("parseAggregate reads the grouped key by name and accepts count as pageviews", () => {
    expect(parseAggregate(AGG_JSON, "requestPath")).toEqual([
      { value: "/", visitors: 300, pageviews: 400 },
      { value: "/services", visitors: 90, pageviews: 120 },
    ]);
    expect(parseAggregate({ data: [] }, "requestPath")).toEqual([]);
    expect(() => parseAggregate({ data: [{ nope: 1 }] }, "requestPath")).toThrow(/requestPath/);
  });
});

describe("VercelAnalytics", () => {
  function fetchStub(status: number, body: unknown) {
    return vi.fn(async () => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }));
  }

  it("builds the count URL with projectId, teamId, since, until and the bearer header", async () => {
    const f = fetchStub(200, COUNT_JSON);
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    await api.countVisits("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
    const [url, init] = f.mock.calls[0]! as unknown as [string, { headers: Record<string, string> }];
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://api.vercel.com/v1/query/web-analytics/visits/count");
    expect(u.searchParams.get("projectId")).toBe("prj_1");
    expect(u.searchParams.get("teamId")).toBe("team_1");
    expect(u.searchParams.get("since")).toBe("2026-09-01T05:00:00.000Z");
    expect(init.headers.Authorization).toBe("Bearer tok");
  });

  it("aggregate passes by and limit, and fetchDayTraffic makes exactly five calls", async () => {
    const f = vi.fn(async (url: string) => {
      const body = url.includes("/visits/count") ? COUNT_JSON : AGG_JSON;
      return { ok: true, status: 200, json: async () => body, text: async () => "" };
    });
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    const day = await api.fetchDayTraffic("prj_1", "2026-09-01T05:00:00.000Z", "2026-09-02T05:00:00.000Z");
    expect(f).toHaveBeenCalledTimes(5);
    const bys = f.mock.calls.map(([u]) => new URL(u as string).searchParams.get("by")).filter(Boolean);
    expect(bys).toEqual(["requestPath", "referrerHostname", expect.any(String), "deviceType"]);
    expect(new URL(f.mock.calls[1]![0] as string).searchParams.get("limit")).toBe("20");
    expect(day.visitors).toBe(980);
    expect(day.pages).toHaveLength(2);
  });

  it("a non-2xx becomes VercelApiError carrying the status and Vercel's error code", async () => {
    const f = fetchStub(400, { error: { code: "web_analytics_not_enabled", message: "Web Analytics is not enabled for this project" } });
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    await expect(api.countVisits("prj_1", "a", "b")).rejects.toMatchObject({ status: 400, code: "web_analytics_not_enabled" });
    await expect(api.countVisits("prj_1", "a", "b")).rejects.toBeInstanceOf(VercelApiError);
  });

  it("vercelAnalyticsFromEnv throws while either env var is unset — the lazy-construction contract", () => {
    vi.stubEnv("VERCEL_API_TOKEN", "");
    vi.stubEnv("VERCEL_TEAM_ID", "team_1");
    expect(() => vercelAnalyticsFromEnv()).toThrow(/VERCEL_API_TOKEN/);
    vi.unstubAllEnvs();
  });
});
```

`apps/web/src/lib/website/channel.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { channelOf } from "./channel";

/** Mutation: remove the `l.facebook.com` case — the Social row fails. */
describe("channelOf", () => {
  it.each([
    ["", "Direct"], ["google.com", "Google"], ["www.google.com.mx", "Google"], ["bing.com", "Bing"],
    ["duckduckgo.com", "DuckDuckGo"], ["search.yahoo.com", "Yahoo"],
    ["facebook.com", "Social"], ["l.facebook.com", "Social"], ["m.facebook.com", "Social"], ["instagram.com", "Social"],
    ["t.co", "Social"], ["linkedin.com", "Social"], ["youtube.com", "Social"], ["tiktok.com", "Social"],
    ["nextdoor.com", "Other websites"], ["yelp.com", "Other websites"],
  ])("%s → %s", (host, channel) => {
    expect(channelOf(host)).toBe(channel);
  });
});
```

`apps/web/src/lib/website/sync-window.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isPastSyncHour, daysToSync, MAX_BACKFILL_DAYS, SYNC_HOUR } from "./sync-window";

// ONE instant, TWO zones, opposite verdicts — the house rule for zone tests.
// 2026-09-07T08:30Z is 03:30 in Chicago (past the hour) and 01:30 in Los
// Angeles (not yet).
const T = new Date("2026-09-07T08:30:00.000Z");

describe("isPastSyncHour", () => {
  it("is true in Chicago and false in Los Angeles for the same instant", () => {
    expect(SYNC_HOUR).toBe(3);
    expect(isPastSyncHour(T, "America/Chicago")).toBe(true);
    expect(isPastSyncHour(T, "America/Los_Angeles")).toBe(false);
  });
});

describe("daysToSync", () => {
  // Mutation: change `-1` (yesterday) to `0` (today) in daysToSync — the
  // first expectation includes 2026-09-07.
  it("with no history, lists the last 30 local days ending yesterday, oldest first", () => {
    const days = daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: null });
    expect(days).toHaveLength(MAX_BACKFILL_DAYS);
    expect(days[0]).toBe("2026-08-08");
    expect(days[days.length - 1]).toBe("2026-09-06");
  });
  it("continues from the day after the last synced day", () => {
    expect(daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: "2026-09-04" }))
      .toEqual(["2026-09-05", "2026-09-06"]);
  });
  it("is empty when yesterday is already synced, and never returns today", () => {
    expect(daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: "2026-09-06" })).toEqual([]);
    expect(daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: "2026-09-07" })).toEqual([]);
  });
  it("caps a long gap at 30 days, keeping the most recent 30", () => {
    const days = daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: "2026-01-01" });
    expect(days).toHaveLength(30);
    expect(days[days.length - 1]).toBe("2026-09-06");
  });
  it("uses the account's zone for 'yesterday': in Los Angeles at 01:30 local, yesterday is the 6th too", () => {
    expect(daysToSync({ now: T, timezone: "America/Los_Angeles", lastSyncedDay: "2026-09-05" })).toEqual(["2026-09-06"]);
  });
});
```

- [ ] **Step 2: Run all three — fail on missing modules.**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run web-analytics channel sync-window`
Expected: 3 files FAIL to import.

- [ ] **Step 3: Implement.**

`apps/web/src/lib/vercel/web-analytics.ts`:
```ts
// Vercel Web Analytics, read-only. Docs: https://vercel.com/docs/analytics/web-analytics-api
// GET /v1/query/web-analytics/visits/count      ?projectId&teamId&since&until[&filter]
// GET /v1/query/web-analytics/visits/aggregate  ?projectId&teamId&since&until&by&limit
//
// Constructed LAZILY by callers (the pass, the link action) — never at module
// scope — so a missing token fails one tick or one click loudly and nothing
// else. Aggregates only: nothing here ever sees a visitor.

export type DimRow = { value: string; visitors: number; pageviews: number };
export type DayTraffic = {
  visitors: number; pageviews: number;
  pages: DimRow[]; sources: DimRow[]; places: DimRow[]; devices: DimRow[];
};

/** Task 1's finding. "city" when the API accepts it, else "region", else
 *  "country" (and Task 7 hides the Places panel). */
export const PLACE_DIMENSION: "city" | "region" | "country" = "country";
export const BREAKDOWN_LIMIT = 20;

const BASE = "https://api.vercel.com/v1/query/web-analytics";

export class VercelApiError extends Error {
  constructor(readonly status: number, readonly code: string | null, message: string) {
    super(message);
    this.name = "VercelApiError";
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

export function parseCount(json: unknown): { visitors: number; pageviews: number } {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  const visitors = num(data?.visitors);
  const pageviews = num(data?.pageviews);
  if (visitors === null || pageviews === null) throw new Error("count response: visitors/pageviews missing");
  return { visitors, pageviews };
}

export function parseAggregate(json: unknown, by: string): DimRow[] {
  const data = (json as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data)) throw new Error(`aggregate response for ${by}: data is not an array`);
  return data.map((raw) => {
    const row = raw as Record<string, unknown>;
    const value = row[by];
    const visitors = num(row.visitors);
    const pageviews = num(row.pageviews) ?? num(row.count);
    if (typeof value !== "string" || visitors === null || pageviews === null) {
      throw new Error(`aggregate response for ${by}: row missing ${by}/visitors/pageviews`);
    }
    return { value, visitors, pageviews };
  });
}

export class VercelAnalytics {
  readonly #token: string;
  readonly #teamId: string;
  readonly #fetch: typeof fetch;

  constructor(opts: { token: string; teamId: string; fetchImpl?: typeof fetch }) {
    this.#token = opts.token;
    this.#teamId = opts.teamId;
    this.#fetch = opts.fetchImpl ?? fetch;
  }

  async #get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${BASE}/${path}`);
    url.searchParams.set("teamId", this.#teamId);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.#fetch(url.toString(), { headers: { Authorization: `Bearer ${this.#token}` } });
    if (!res.ok) {
      let code: string | null = null;
      let message = `vercel ${path} ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? null;
        if (body.error?.message) message = body.error.message;
      } catch { /* body was not JSON; keep the status message */ }
      throw new VercelApiError(res.status, code, message);
    }
    return res.json();
  }

  async countVisits(projectId: string, sinceIso: string, untilIso: string) {
    return parseCount(await this.#get("visits/count", { projectId, since: sinceIso, until: untilIso }));
  }

  async aggregate(projectId: string, sinceIso: string, untilIso: string, by: string, limit: number): Promise<DimRow[]> {
    return parseAggregate(
      await this.#get("visits/aggregate", { projectId, since: sinceIso, until: untilIso, by, limit: String(limit) }),
      by,
    );
  }

  /** The five queries for one local day, in a fixed order (the test pins it). */
  async fetchDayTraffic(projectId: string, sinceIso: string, untilIso: string): Promise<DayTraffic> {
    const totals = await this.countVisits(projectId, sinceIso, untilIso);
    const pages = await this.aggregate(projectId, sinceIso, untilIso, "requestPath", BREAKDOWN_LIMIT);
    const sources = await this.aggregate(projectId, sinceIso, untilIso, "referrerHostname", BREAKDOWN_LIMIT);
    const places = await this.aggregate(projectId, sinceIso, untilIso, PLACE_DIMENSION, BREAKDOWN_LIMIT);
    const devices = await this.aggregate(projectId, sinceIso, untilIso, "deviceType", BREAKDOWN_LIMIT);
    return { ...totals, pages, sources, places, devices };
  }
}

export function vercelAnalyticsFromEnv(): VercelAnalytics {
  const token = process.env.VERCEL_API_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  if (!token || !teamId) throw new Error("VERCEL_API_TOKEN/VERCEL_TEAM_ID unset");
  return new VercelAnalytics({ token, teamId });
}
```

`apps/web/src/lib/website/channel.ts`:
```ts
export type Channel = "Direct" | "Google" | "Bing" | "DuckDuckGo" | "Yahoo" | "Social" | "Other websites";

const SEARCH: [RegExp, Channel][] = [
  [/(^|\.)google\./, "Google"], [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"], [/(^|\.)yahoo\.com$/, "Yahoo"],
];
const SOCIAL = /(^|\.)(facebook\.com|instagram\.com|t\.co|twitter\.com|x\.com|linkedin\.com|youtube\.com|tiktok\.com)$/;

/** The words a business owner reads for a referrer hostname. Shared by the
 *  Website section and, later, the leads report, so "Google" means one thing. */
export function channelOf(referrerHostname: string): Channel {
  const host = referrerHostname.trim().toLowerCase();
  if (host === "") return "Direct";
  for (const [re, channel] of SEARCH) if (re.test(host)) return channel;
  if (SOCIAL.test(host)) return "Social";
  return "Other websites";
}
```

`apps/web/src/lib/website/sync-window.ts`:
```ts
import { dayKeyInZone } from "@/lib/booking/availability";
import { partsInZone } from "@/lib/booking/slots";

export const SYNC_HOUR = 3;
export const MAX_BACKFILL_DAYS = 30;

/** Past 03:00 local: the day that just ended is complete on Vercel's side. */
export function isPastSyncHour(now: Date, timezone: string): boolean {
  return partsInZone(now, timezone).hh >= SYNC_HOUR;
}

function shiftDayKey(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta, 12, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** Local day keys still to pull, oldest first, ending at LOCAL yesterday,
 *  at most MAX_BACKFILL_DAYS (the most recent ones win when the gap is longer). */
export function daysToSync(input: { now: Date; timezone: string; lastSyncedDay: string | null }): string[] {
  const yesterday = shiftDayKey(dayKeyInZone(input.now, input.timezone), -1);
  const days: string[] = [];
  for (let i = MAX_BACKFILL_DAYS - 1; i >= 0; i--) {
    const day = shiftDayKey(yesterday, -i);
    if (input.lastSyncedDay !== null && day <= input.lastSyncedDay) continue;
    days.push(day);
  }
  return days;
}
```

Check `partsInZone` returns `{ hh, mi, weekday, … }` (metrics.ts uses `parts.hh`/`parts.mi`/`parts.weekday`); if its signature differs from `(instant: Date, timezone: string)`, read `apps/web/src/lib/booking/slots.ts` and adapt the call — the test pins the behaviour, not the helper.

- [ ] **Step 4: Run — green; then the three named mutations, each reverted.**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run web-analytics channel sync-window`
Expected: 3 files, all green. Mutations: (a) drop the `?? num(row.count)` fallback → parser test fails; (b) remove the `l.facebook.com` handling by changing `SOCIAL` to require `^facebook\.com$` → channel test fails on `l.facebook.com`; (c) change `-1` to `0` in `daysToSync`'s `yesterday` → the first daysToSync test fails. Restore each; green; `git diff` clean apart from the new files.

- [ ] **Step 5: Commit.**

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/lib/vercel apps/web/src/lib/website/channel.ts apps/web/src/lib/website/channel.test.ts apps/web/src/lib/website/sync-window.ts apps/web/src/lib/website/sync-window.test.ts && B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit -m "feat(website): Vercel Web Analytics client + parsers, channelOf, and the local-day sync window — all pure, all table-tested" || echo "BRANCH MOVED TO $B"
```

---
### Task 5: The `siteTraffic` pass — once a day per site, backfill, lazy client, per-site isolation

**Files:**
- Modify: `apps/web/src/lib/website/sync-window.ts` (add `localDayBounds`) + its test
- Create: `apps/web/src/lib/automations/passes/site-traffic.ts` + `site-traffic.test.ts`
- Modify: `apps/web/src/lib/automations/registry.ts:19` (append the pass, last)
- Modify: `apps/web/src/lib/automations/imports.test.ts:52-54` (add `"passes/site-traffic.ts"` to the enumerated list)

**Interfaces:**
- Consumes: `listSitesToSync`, `writeTrafficDay`, `stampSiteSynced` (Task 3); `vercelAnalyticsFromEnv`, `VercelAnalytics#fetchDayTraffic`, `DayTraffic` (Task 4); `isPastSyncHour`, `daysToSync` (Task 4); `resolveAccountZone` (`@/lib/booking/followup-timing`); `AUTOMATION_TICK_CAP` (`../caps`).
- Produces: `siteTrafficPass: Pass` with key `"siteTraffic"` and counters `{ synced, daysSynced, failed, skippedNotYet, skippedUpToDate, skippedCap, unresolvableTimezone }`; `localDayBounds(dayKey: string, timezone: string): { sinceIso: string; untilIso: string }`.

- [ ] **Step 1: Add the day-bounds helper test to `sync-window.test.ts`.**

```ts
import { localDayBounds } from "./sync-window";

describe("localDayBounds", () => {
  // Chicago is UTC-5 in September: local midnight = 05:00Z.
  it("returns local midnight to the next local midnight, as UTC instants", () => {
    expect(localDayBounds("2026-09-06", "America/Chicago")).toEqual({
      sinceIso: "2026-09-06T05:00:00.000Z", untilIso: "2026-09-07T05:00:00.000Z",
    });
    expect(localDayBounds("2026-09-06", "America/Los_Angeles").sinceIso).toBe("2026-09-06T07:00:00.000Z");
  });
});
```
Implementation, appended to `sync-window.ts`:
```ts
import { zonedTimeToUtc } from "@/lib/booking/slots";

function localMidnight(dayKey: string, timezone: string): Date {
  const [y, m, d] = dayKey.split("-").map(Number);
  for (let bump = 0; bump < 4; bump++) {
    const resolved = zonedTimeToUtc(y!, m!, d!, bump, 0, timezone);
    if (resolved) return resolved;
  }
  throw new Error(`could not resolve local midnight for ${dayKey} in ${timezone}`);
}

/** [local midnight of dayKey, local midnight of the next day) as ISO instants —
 *  the since/until Vercel's API takes. */
export function localDayBounds(dayKey: string, timezone: string): { sinceIso: string; untilIso: string } {
  return {
    sinceIso: localMidnight(dayKey, timezone).toISOString(),
    untilIso: localMidnight(shiftDayKey(dayKey, 1), timezone).toISOString(),
  };
}
```
Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run sync-window` → the new test fails first (missing export), then passes.

- [ ] **Step 2: Write the failing pass test.**

`apps/web/src/lib/automations/passes/site-traffic.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SiteRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listSitesToSync: vi.fn(), writeTrafficDay: vi.fn(), stampSiteSynced: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

const vercelMocks = vi.hoisted(() => ({ fromEnv: vi.fn(), fetchDayTraffic: vi.fn() }));
vi.mock("@/lib/vercel/web-analytics", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  vercelAnalyticsFromEnv: () => vercelMocks.fromEnv(),
}));

import { AUTOMATION_TICK_CAP } from "../caps";
import type { PassContext } from "../context";
import { siteTrafficPass } from "./site-traffic";

// 2026-09-07T09:30Z: 04:30 in Chicago (past 03:00), 02:30 in Los Angeles (not yet).
const TICK = new Date("2026-09-07T09:30:00.000Z");

function site(overrides: Partial<SiteRow & { accountTimezone: string }> = {}): SiteRow & { accountTimezone: string } {
  return {
    id: "site_1", accountId: "acct_1", vercelProjectId: "prj_1", domain: "rio.example",
    analyticsEnabledAt: "2026-08-01T00:00:00.000Z", lastSyncedDay: "2026-09-04",
    accountTimezone: "America/Chicago", ...overrides,
  };
}
const DAY = { visitors: 10, pageviews: 20, pages: [{ value: "/", visitors: 10, pageviews: 20 }],
  sources: [{ value: "google.com", visitors: 6, pageviews: 12 }], places: [{ value: "McAllen", visitors: 9, pageviews: 18 }],
  devices: [{ value: "mobile", visitors: 7, pageviews: 14 }] };
const ctx = (): PassContext => ({
  db: {} as never, now: TICK, origin: "https://app.example.com",
  email: { isFake: true, send: vi.fn() }, sms: () => ({ isFake: true, send: vi.fn() }),
});
const EMPTY = { synced: 0, daysSynced: 0, failed: 0, skippedNotYet: 0, skippedUpToDate: 0, skippedCap: 0, unresolvableTimezone: 0 };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  vercelMocks.fromEnv.mockReset();
  vercelMocks.fetchDayTraffic.mockReset();
  vercelMocks.fromEnv.mockReturnValue({ fetchDayTraffic: (...a: unknown[]) => vercelMocks.fetchDayTraffic(...a) });
  vercelMocks.fetchDayTraffic.mockResolvedValue(DAY);
  dbMocks.writeTrafficDay.mockResolvedValue(undefined);
  dbMocks.stampSiteSynced.mockResolvedValue(undefined);
  dbMocks.listSitesToSync.mockResolvedValue([]);
});

describe("siteTrafficPass", () => {
  it("has the key the cron reports under, and does nothing with no sites", async () => {
    expect(siteTrafficPass.key).toBe("siteTraffic");
    expect(await siteTrafficPass.run(ctx())).toEqual(EMPTY);
    expect(vercelMocks.fromEnv).not.toHaveBeenCalled();
  });

  // Mutation: drop the isPastSyncHour check — this site is pulled at 02:30 local.
  it("waits until 03:00 in the account's zone — Los Angeles is not there yet", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site({ accountTimezone: "America/Los_Angeles" })]);
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, skippedNotYet: 1 });
    expect(vercelMocks.fetchDayTraffic).not.toHaveBeenCalled();
  });

  it("skips a site whose yesterday is already stored, without constructing the client", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site({ lastSyncedDay: "2026-09-06" })]);
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, skippedUpToDate: 1 });
    expect(vercelMocks.fromEnv).not.toHaveBeenCalled();
  });

  // Mutation: stamp BEFORE write in the pass — the stamp order assertion
  // (write then stamp per day) fails.
  it("pulls the missing days oldest-first with local-day bounds, writes, then stamps each day", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site()]);   // last synced 09-04 → 09-05, 09-06 due
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, synced: 1, daysSynced: 2 });
    expect(vercelMocks.fetchDayTraffic.mock.calls).toEqual([
      ["prj_1", "2026-09-05T05:00:00.000Z", "2026-09-06T05:00:00.000Z"],
      ["prj_1", "2026-09-06T05:00:00.000Z", "2026-09-07T05:00:00.000Z"],
    ]);
    expect(dbMocks.writeTrafficDay.mock.calls[0]![2]).toBe("2026-09-05");
    expect(dbMocks.writeTrafficDay.mock.calls[0]![3]).toEqual({ visitors: 10, pageviews: 20 });
    expect(dbMocks.writeTrafficDay.mock.calls[0]![4]).toEqual([
      { dimension: "page", value: "/", visitors: 10, pageviews: 20 },
      { dimension: "source", value: "google.com", visitors: 6, pageviews: 12 },
      { dimension: "place", value: "McAllen", visitors: 9, pageviews: 18 },
      { dimension: "device", value: "mobile", visitors: 7, pageviews: 14 },
    ]);
    expect(dbMocks.stampSiteSynced.mock.calls.map((c) => c[2])).toEqual(["2026-09-05", "2026-09-06"]);
    // write-then-stamp, per day
    const order = [...dbMocks.writeTrafficDay.mock.invocationCallOrder, ...dbMocks.stampSiteSynced.mock.invocationCallOrder].sort((a, b) => a - b);
    expect(order[0]).toBe(dbMocks.writeTrafficDay.mock.invocationCallOrder[0]);
    expect(order[1]).toBe(dbMocks.stampSiteSynced.mock.invocationCallOrder[0]);
  });

  // Mutation: remove the `break` after a failed day — the second day is
  // written after the first failed, leaving a hole behind a success.
  it("stops at the first failed day so no hole is left behind a success; the site counts failed", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site()]);
    vercelMocks.fetchDayTraffic.mockRejectedValueOnce(new Error("429 rate limited"));
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(vercelMocks.fetchDayTraffic).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampSiteSynced).not.toHaveBeenCalled();
  });

  it("one site's failure never touches the next site", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site(), site({ id: "site_2", accountId: "acct_2", vercelProjectId: "prj_2", lastSyncedDay: "2026-09-05" })]);
    vercelMocks.fetchDayTraffic.mockRejectedValueOnce(new Error("boom"));
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, failed: 1, synced: 1, daysSynced: 1 });
    expect(dbMocks.stampSiteSynced.mock.calls.map((c) => [c[1], c[2]])).toEqual([["site_2", "2026-09-06"]]);
  });

  // Mutation: construct the client at the top of run() — this test's
  // fromEnv throw becomes an outright pass error instead of one failed site.
  it("a missing token fails only the sites that needed a pull, loudly, and never throws outright", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site({ lastSyncedDay: "2026-09-06" }), site({ id: "site_2", accountId: "acct_2" })]);
    vercelMocks.fromEnv.mockImplementation(() => { throw new Error("VERCEL_API_TOKEN/VERCEL_TEAM_ID unset"); });
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, skippedUpToDate: 1, failed: 1 });
  });

  it("caps the sites pulled per tick at AUTOMATION_TICK_CAP; the rest are simply due next tick", async () => {
    const many = Array.from({ length: AUTOMATION_TICK_CAP + 2 }, (_, i) => site({ id: `site_${i}`, accountId: `acct_${i}`, vercelProjectId: `prj_${i}` }));
    dbMocks.listSitesToSync.mockResolvedValue(many);
    const c = await siteTrafficPass.run(ctx());
    expect(c.synced).toBe(AUTOMATION_TICK_CAP);
    expect(c.skippedCap).toBe(2);
  });

  it("holds a site whose account timezone cannot be resolved, and says so", async () => {
    dbMocks.listSitesToSync.mockResolvedValue([site({ accountTimezone: "Mars/Olympus" })]);
    expect(await siteTrafficPass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
  });
});
```

- [ ] **Step 3: Run — fails on the missing module.**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run site-traffic`
Expected: FAIL, cannot find `./site-traffic`.

- [ ] **Step 4: Implement the pass.**

`apps/web/src/lib/automations/passes/site-traffic.ts`:
```ts
import { listSitesToSync, writeTrafficDay, stampSiteSynced, type TrafficBreakdownRow } from "@bis/db";
import { vercelAnalyticsFromEnv, type VercelAnalytics, type DayTraffic } from "@/lib/vercel/web-analytics";
import { isPastSyncHour, daysToSync, localDayBounds } from "@/lib/website/sync-window";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { AUTOMATION_TICK_CAP } from "../caps";
import type { Pass } from "../context";

/**
 * Website traffic: one pull per site per local day, into BIS's own tables
 * (spec 2026-09-07-website-traffic-design). Not a recipe — it sends nothing
 * — but it lives in the harness for the same reasons the recipes do: one
 * "now" per tick, per-site isolation, uniform counters in the cron log.
 *
 * Per site, in order, each refusal under its own name:
 *   unresolvable zone → before 03:00 local (yesterday not complete yet) →
 *   nothing due → tick cap → pull each due day OLDEST FIRST, write, stamp;
 *   stop at the first failed day so a hole is never left behind a success.
 *
 * The Vercel client is constructed LAZILY on the first site that needs a
 * pull — `vercelAnalyticsFromEnv()` throws while the token is unset, and
 * that throw is one site's failure, never the pass's. A 429/5xx from Vercel
 * is the same: counted, logged, retried next tick, never looped here.
 */
export const siteTrafficPass: Pass = {
  key: "siteTraffic",
  async run(ctx) {
    const c = { synced: 0, daysSynced: 0, failed: 0, skippedNotYet: 0, skippedUpToDate: 0, skippedCap: 0, unresolvableTimezone: 0 };
    const sites = await listSitesToSync(ctx.db);
    let api: VercelAnalytics | null = null;
    let attempts = 0;

    for (const site of sites) {
      const zone = resolveAccountZone(site.accountTimezone);
      if (zone === null) {
        c.unresolvableTimezone++;
        console.error(`site traffic HELD for site ${site.id}: account ${site.accountId}'s timezone ${JSON.stringify(site.accountTimezone)} is not a zone we can resolve`);
        continue;
      }
      if (!isPastSyncHour(ctx.now, zone)) { c.skippedNotYet++; continue; }
      const days = daysToSync({ now: ctx.now, timezone: zone, lastSyncedDay: site.lastSyncedDay });
      if (days.length === 0) { c.skippedUpToDate++; continue; }
      if (attempts >= AUTOMATION_TICK_CAP) { c.skippedCap++; continue; }
      attempts++;

      let pulled = 0;
      try {
        api ??= vercelAnalyticsFromEnv();
        for (const day of days) {
          const { sinceIso, untilIso } = localDayBounds(day, zone);
          const traffic = await api.fetchDayTraffic(site.vercelProjectId, sinceIso, untilIso);
          await writeTrafficDay(ctx.db, site, day, { visitors: traffic.visitors, pageviews: traffic.pageviews }, toBreakdown(traffic));
          await stampSiteSynced(ctx.db, site.id, day);
          pulled++;
        }
        c.synced++;
      } catch (e) {
        c.failed++;
        console.error(`site traffic pull failed for site ${site.id} (${site.vercelProjectId}) after ${pulled} of ${days.length} days: ${String(e)}`);
      }
      c.daysSynced += pulled;
    }
    return c;
  },
};

function toBreakdown(t: DayTraffic): Omit<TrafficBreakdownRow, "day">[] {
  const rows = (dimension: TrafficBreakdownRow["dimension"], list: DayTraffic["pages"]) =>
    list.map((r) => ({ dimension, value: r.value, visitors: r.visitors, pageviews: r.pageviews }));
  return [...rows("page", t.pages), ...rows("source", t.sources), ...rows("place", t.places), ...rows("device", t.devices)];
}
```

Note the "one site's failure" test expects `daysSynced: 1` for the second site and `0` for the failed first — `c.daysSynced += pulled` runs after the try/catch for both, which is what the fixture asserts (the failed site pulled 0).

`registry.ts` — the array becomes:
```ts
import { siteTrafficPass } from "./passes/site-traffic";
// …
export const PASSES: readonly Pass[] = [remindersPass, followupsPass, reviewRequestPass, noShowNudgePass, smsReminderPass, siteTrafficPass];
```
Extend the registry doc comment with one line: `siteTraffic runs last: it reads no booking state and sends nothing.`

`imports.test.ts:52-54` — add `"passes/site-traffic.ts"` to the `arrayContaining` list.

- [ ] **Step 5: Run the pass, registry, imports, cron-coupling and cron route tests — green.**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run site-traffic imports cron-coupling "api/cron"`
Expected: all green. `route.test.ts` for the cron still passes: its `runPasses` mock or real registry reports `siteTraffic` as a new nested key beside `followups` (if the test pins the exact key set, add `siteTraffic: expect.any(Object)` to that expectation — read the failing NAME before editing). Then the three named mutations from the test comments (drop the hour check; stamp before write; remove the stop-at-first-failure `break`, i.e. wrap each day in its own try) — each fails its test by name; restore; green.

- [ ] **Step 6: Commit.**

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/lib/website/sync-window.ts apps/web/src/lib/website/sync-window.test.ts apps/web/src/lib/automations/passes/site-traffic.ts apps/web/src/lib/automations/passes/site-traffic.test.ts apps/web/src/lib/automations/registry.ts apps/web/src/lib/automations/imports.test.ts && B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit -m "feat(website): the siteTraffic cron pass — once per local day per site, oldest-first backfill, write-then-stamp, lazy Vercel client, per-site isolation" || echo "BRANCH MOVED TO $B"
```

---

### Task 6: The view model and the sentence — pure, table-tested

**Files:**
- Create: `apps/web/src/lib/website/view-model.ts` + `view-model.test.ts`
- Create: `apps/web/src/lib/website/sentence.ts` + `sentence.test.ts`

**Interfaces:**
- Consumes: `TrafficDay`, `TrafficBreakdownRow` (Task 3); `channelOf`, `Channel` (Task 4); `deltaVsPrior` (`@/lib/dashboard/metrics`); `dayKeyInZone` (`@/lib/booking/availability`).
- Produces (exact):
  - `type Period = 7 | 14 | 30`; `parsePeriod(raw: string | undefined): Period` (default 14)
  - `type Ranked = { name: string; visitors: number; share: number }` (share 0–1 of the window's visitors)
  - `type WebsiteView = { period: Period; fromDay: string; toDay: string; days: { day: string; visitors: number; pageviews: number; isWeekend: boolean }[]; totals: { visitors: number; pageviews: number }; prior: { visitors: number; pageviews: number }; visitorsDelta: StatTileDelta; pageviewsDelta: StatTileDelta; fromGoogle: { share: number; priorShare: number }; topPage: Ranked | null; pages: Ranked[]; sources: Ranked[]; places: Ranked[]; devices: Ranked[]; sentence: SentenceSegment[]; lastSyncedDay: string | null; stale: boolean }`
  - `windowDayKeys(now: Date, timezone: string, period: Period): { current: string[]; prior: string[] }` — both windows end at local YESTERDAY; `prior` is the same length immediately before
  - `buildWebsiteView(input: { now: Date; timezone: string; period: Period; daily: TrafficDay[]; breakdown: TrafficBreakdownRow[]; lastSyncedDay: string | null }): WebsiteView`
  - `pageTitle(path: string): string` — `"/"` → `"Home"`, `"/free-estimate"` → `"Free estimate"`
  - `type SentenceSegment = { text: string; strong?: true }`; `websiteSentence(input: { period: Period; visitors: number; priorVisitors: number; topSource: Ranked | null; runnerUpSourceShare: number; topPage: Ranked | null; runnerUpPageShare: number; topDevice: Ranked | null }): SentenceSegment[]`
  - `STALE_AFTER_DAYS = 2`

- [ ] **Step 1: Failing tests.**

`apps/web/src/lib/website/sentence.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { websiteSentence, type SentenceSegment } from "./sentence";

const text = (s: SentenceSegment[]) => s.map((x) => x.text).join("");
const strong = (s: SentenceSegment[]) => s.filter((x) => x.strong).map((x) => x.text);

const base = {
  period: 14 as const, visitors: 1284, priorVisitors: 1088,
  topSource: { name: "Google", visitors: 783, share: 0.61 }, runnerUpSourceShare: 0.22,
  topPage: { name: "Services", visitors: 412, share: 0.32 }, runnerUpPageShare: 0.30,
  topDevice: { name: "mobile", visitors: 911, share: 0.71 },
};

describe("websiteSentence", () => {
  it("the full sentence, with the bold fragments the mockup shows", () => {
    const s = websiteSentence(base);
    expect(text(s)).toBe("1,284 people visited your website, 18% more than the two weeks before. Most of them found you on Google, the page they read most was Services, and seven in ten were on a phone.");
    expect(strong(s)).toEqual(["1,284 people", "18% more", "Google", "Services"]);
  });
  // Mutation: change the 0.05 threshold to 0.5 — this case reads "about the same".
  it("under 5% change reads 'about the same as'", () => {
    expect(text(websiteSentence({ ...base, visitors: 1100, priorVisitors: 1088 })))
      .toMatch(/^1,100 people visited your website, about the same as the two weeks before\./);
  });
  it("fewer is fewer, and the period words follow the period", () => {
    expect(text(websiteSentence({ ...base, period: 7, visitors: 500, priorVisitors: 1000 }))).toContain("50% fewer than the week before");
    expect(text(websiteSentence({ ...base, period: 30 }))).toContain("than the month before");
  });
  // Mutation: change the 10-point margin to 0 — the page clause appears here.
  it("names the top page only with a 10-point lead over the runner-up; the top source likewise", () => {
    expect(text(websiteSentence({ ...base, runnerUpPageShare: 0.30 }))).not.toContain("the page they read most");
    expect(text(websiteSentence({ ...base, runnerUpPageShare: 0.20 }))).toContain("the page they read most was Services");
    expect(text(websiteSentence({ ...base, runnerUpSourceShare: 0.55 }))).not.toContain("found you on");
  });
  it("names a device only at 60% share, in tenths, and 'a computer' for desktop", () => {
    expect(text(websiteSentence({ ...base, topDevice: { name: "desktop", visitors: 1, share: 0.64 } }))).toContain("six in ten were on a computer");
    expect(text(websiteSentence({ ...base, topDevice: { name: "mobile", visitors: 1, share: 0.55 } }))).not.toContain("in ten");
    expect(text(websiteSentence({ ...base, topDevice: { name: "mobile", visitors: 1, share: 0.97 } }))).toContain("nearly all of them were on a phone");
  });
  // Mutation: change `< 20` to `< 2` — the 14-visitor case grows a percentage.
  it("under 20 visitors: the plain count and nothing else, so a tiny site never reads '200% more'", () => {
    expect(text(websiteSentence({ ...base, visitors: 14, priorVisitors: 3 }))).toBe("14 people visited your website in the last two weeks.");
    expect(text(websiteSentence({ ...base, visitors: 1, priorVisitors: 0 }))).toBe("1 person visited your website in the last two weeks.");
    expect(text(websiteSentence({ ...base, visitors: 0, priorVisitors: 0 }))).toBe("No one has visited your website in the last two weeks yet.");
  });
  it("a zero prior period never divides: it reads as a plain count too", () => {
    expect(text(websiteSentence({ ...base, visitors: 40, priorVisitors: 0 }))).toMatch(/^40 people visited your website in the last two weeks\./);
  });
});
```

`apps/web/src/lib/website/view-model.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { TrafficDay, TrafficBreakdownRow } from "@bis/db";
import { buildWebsiteView, windowDayKeys, pageTitle, parsePeriod, STALE_AFTER_DAYS } from "./view-model";

// 2026-09-07T15:00Z = 10:00 in Chicago. Yesterday there is 09-06.
const NOW = new Date("2026-09-07T15:00:00.000Z");
const TZ = "America/Chicago";

function day(d: string, visitors: number, pageviews = visitors * 2): TrafficDay { return { day: d, visitors, pageviews }; }
function bd(d: string, dimension: TrafficBreakdownRow["dimension"], value: string, visitors: number): TrafficBreakdownRow {
  return { day: d, dimension, value, visitors, pageviews: visitors * 2 };
}

describe("windowDayKeys", () => {
  // Mutation: end the window at today instead of yesterday — current[6] becomes 09-07.
  it("both windows end at local yesterday and the prior window abuts the current one", () => {
    const { current, prior } = windowDayKeys(NOW, TZ, 7);
    expect(current).toEqual(["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05", "2026-09-06"]);
    expect(prior).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"]);
  });
});

describe("parsePeriod / pageTitle", () => {
  it("accepts 7, 14, 30 and defaults everything else to 14", () => {
    expect(parsePeriod("7")).toBe(7); expect(parsePeriod("30")).toBe(30);
    expect(parsePeriod("90")).toBe(14); expect(parsePeriod(undefined)).toBe(14); expect(parsePeriod("abc")).toBe(14);
  });
  it("turns a path into a title a business owner recognises", () => {
    expect(pageTitle("/")).toBe("Home");
    expect(pageTitle("/services")).toBe("Services");
    expect(pageTitle("/free-estimate/")).toBe("Free estimate");
    expect(pageTitle("/blog/how-to-fix-a-leak")).toBe("How to fix a leak");
  });
});

describe("buildWebsiteView", () => {
  const daily = [
    ...["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"].map((d) => day(d, 10)),
    day("2026-08-31", 20), day("2026-09-01", 20), day("2026-09-02", 20), day("2026-09-03", 20), day("2026-09-04", 20),
    // 09-05 (Sat) missing on purpose → zero-filled; 09-06 (Sun) present
    day("2026-09-06", 20),
  ];
  const breakdown = [
    bd("2026-09-01", "page", "/", 50), bd("2026-09-02", "page", "/services", 60),
    bd("2026-09-01", "source", "google.com", 60), bd("2026-09-02", "source", "www.google.com", 10), bd("2026-09-02", "source", "", 30),
    bd("2026-08-25", "source", "google.com", 5), bd("2026-08-25", "source", "", 15),   // prior window: 25% google
    bd("2026-09-03", "place", "McAllen", 70), bd("2026-09-03", "device", "mobile", 80), bd("2026-09-03", "device", "desktop", 20),
  ];
  const view = buildWebsiteView({ now: NOW, timezone: TZ, period: 7, daily, breakdown, lastSyncedDay: "2026-09-06" });

  it("zero-fills missing days, flags weekends, and sums the window", () => {
    expect(view.days.map((d) => d.visitors)).toEqual([20, 20, 20, 20, 20, 0, 20]);
    expect(view.days.map((d) => d.isWeekend)).toEqual([false, false, false, false, false, true, true]);
    expect(view.totals).toEqual({ visitors: 120, pageviews: 240 });
    expect(view.prior).toEqual({ visitors: 70, pageviews: 140 });
    expect(view.visitorsDelta).toEqual({ direction: "up", label: "71%" });
  });
  // Mutation: group sources by raw hostname instead of channelOf — Google splits into two rows.
  it("groups sources by channel, ranks by visitors, computes shares of the window's visitors", () => {
    expect(view.sources.map((s) => [s.name, s.visitors])).toEqual([["Google", 70], ["Direct", 30]]);
    expect(view.sources[0]!.share).toBeCloseTo(70 / 120);
    expect(view.fromGoogle.share).toBeCloseTo(70 / 120);
    expect(view.fromGoogle.priorShare).toBeCloseTo(5 / 70);
  });
  it("titles pages and picks the top one", () => {
    expect(view.pages.map((p) => p.name)).toEqual(["Services", "Home"]);
    expect(view.topPage).toEqual({ name: "Services", visitors: 60, share: 0.5 });
  });
  it("flags stale when the last synced day is more than STALE_AFTER_DAYS behind local today", () => {
    expect(STALE_AFTER_DAYS).toBe(2);
    expect(view.stale).toBe(false);
    expect(buildWebsiteView({ now: NOW, timezone: TZ, period: 7, daily, breakdown, lastSyncedDay: "2026-09-04" }).stale).toBe(true);
    expect(buildWebsiteView({ now: NOW, timezone: TZ, period: 7, daily, breakdown, lastSyncedDay: null }).stale).toBe(true);
  });
  it("hands the sentence the same numbers the tiles show", () => {
    expect(view.sentence.map((s) => s.text).join("")).toMatch(/^120 people visited your website, 71% more than the week before\./);
  });
});
```

- [ ] **Step 2: Run — both fail on missing modules.** `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run sentence view-model`

- [ ] **Step 3: Implement.**

`apps/web/src/lib/website/sentence.ts`:
```ts
import type { Period } from "./view-model";

export type SentenceSegment = { text: string; strong?: true };
type Ranked = { name: string; visitors: number; share: number };

const LEAD_MARGIN = 0.10;        // top vs runner-up, in share points
const SAME_THRESHOLD = 0.05;     // under this the change reads "about the same"
const PLAIN_COUNT_BELOW = 20;    // no percentages for a tiny site
const DEVICE_SHARE = 0.60;
const TENTHS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];

function periodWords(period: Period): string {
  return period === 7 ? "the week" : period === 14 ? "the two weeks" : "the month";
}
function deviceWords(name: string): string {
  const n = name.toLowerCase();
  return n === "mobile" ? "a phone" : n === "desktop" ? "a computer" : n === "tablet" ? "a tablet" : `a ${n}`;
}
const fmt = (n: number) => n.toLocaleString("en-US");

/**
 * The sentence panel. Built from the same numbers as the tiles, so it can
 * never disagree with them. Four restraint rules, each pinned by a test: a
 * tiny site gets a plain count and no percentages; under 5% reads "about the
 * same"; a top source or page is named only with a 10-point lead; a device
 * is named only at 60% share.
 */
export function websiteSentence(input: {
  period: Period; visitors: number; priorVisitors: number;
  topSource: Ranked | null; runnerUpSourceShare: number;
  topPage: Ranked | null; runnerUpPageShare: number;
  topDevice: Ranked | null;
}): SentenceSegment[] {
  const p = periodWords(input.period);
  if (input.visitors === 0) return [{ text: `No one has visited your website in the last ${p.replace("the ", "")} yet.` }];
  if (input.visitors < PLAIN_COUNT_BELOW || input.priorVisitors === 0) {
    const noun = input.visitors === 1 ? "person" : "people";
    return [{ text: `${fmt(input.visitors)} ${noun}`, strong: true }, { text: ` visited your website in the last ${p.replace("the ", "")}.` }];
  }

  const out: SentenceSegment[] = [{ text: `${fmt(input.visitors)} people`, strong: true }, { text: " visited your website, " }];
  const change = (input.visitors - input.priorVisitors) / input.priorVisitors;
  if (Math.abs(change) < SAME_THRESHOLD) {
    out.push({ text: `about the same as ${p} before.` });
  } else {
    const pct = Math.round(Math.abs(change) * 100);
    out.push({ text: `${pct}% ${change > 0 ? "more" : "fewer"}`, strong: true }, { text: ` than ${p} before.` });
  }

  const clauses: SentenceSegment[][] = [];
  if (input.topSource && input.topSource.share - input.runnerUpSourceShare >= LEAD_MARGIN && input.topSource.name !== "Direct") {
    clauses.push([{ text: "Most of them found you on " }, { text: input.topSource.name, strong: true }]);
  }
  if (input.topPage && input.topPage.share - input.runnerUpPageShare >= LEAD_MARGIN) {
    clauses.push([{ text: "the page they read most was " }, { text: input.topPage.name, strong: true }]);
  }
  if (input.topDevice && input.topDevice.share >= DEVICE_SHARE) {
    const tenths = Math.round(input.topDevice.share * 10);
    clauses.push([{ text: tenths >= 10 ? `nearly all of them were on ${deviceWords(input.topDevice.name)}` : `${TENTHS[tenths]} in ten were on ${deviceWords(input.topDevice.name)}` }]);
  }
  if (clauses.length === 0) return out;

  out.push({ text: " " });
  clauses.forEach((clause, i) => {
    if (i > 0) out.push({ text: i === clauses.length - 1 ? ", and " : ", " });
    const first = clause[0]!;
    // Sentence case only for the first clause; the others continue the sentence.
    out.push(i === 0 ? first : { ...first, text: first.text.charAt(0).toLowerCase() + first.text.slice(1) });
    out.push(...clause.slice(1));
  });
  out.push({ text: "." });
  return out;
}
```

`apps/web/src/lib/website/view-model.ts`:
```ts
import type { TrafficDay, TrafficBreakdownRow } from "@bis/db";
import type { StatTileDelta } from "@/components/stat-tile";
import { deltaVsPrior } from "@/lib/dashboard/metrics";
import { dayKeyInZone } from "@/lib/booking/availability";
import { channelOf } from "./channel";
import { websiteSentence, type SentenceSegment } from "./sentence";

export type Period = 7 | 14 | 30;
export type Ranked = { name: string; visitors: number; share: number };
export type WebsiteView = {
  period: Period; fromDay: string; toDay: string;
  days: { day: string; visitors: number; pageviews: number; isWeekend: boolean }[];
  totals: { visitors: number; pageviews: number };
  prior: { visitors: number; pageviews: number };
  visitorsDelta: StatTileDelta; pageviewsDelta: StatTileDelta;
  fromGoogle: { share: number; priorShare: number };
  topPage: Ranked | null;
  pages: Ranked[]; sources: Ranked[]; places: Ranked[]; devices: Ranked[];
  sentence: SentenceSegment[];
  lastSyncedDay: string | null; stale: boolean;
};

export const STALE_AFTER_DAYS = 2;
const PANEL_ROWS = 5;

export function parsePeriod(raw: string | undefined): Period {
  return raw === "7" ? 7 : raw === "30" ? 30 : 14;
}

function shift(dayKey: string, delta: number): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! + delta, 12, 0));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}
function isWeekend(dayKey: string): boolean {
  const [y, m, d] = dayKey.split("-").map(Number);
  const wd = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return wd === 0 || wd === 6;
}
function daysBetween(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number); const [yb, mb, db] = b.split("-").map(Number);
  return Math.round((Date.UTC(yb!, mb! - 1, db!) - Date.UTC(ya!, ma! - 1, da!)) / 86_400_000);
}

/** Both windows end at LOCAL yesterday — the last complete day the pass can
 *  have stored — and the prior window is the same length immediately before. */
export function windowDayKeys(now: Date, timezone: string, period: Period): { current: string[]; prior: string[] } {
  const yesterday = shift(dayKeyInZone(now, timezone), -1);
  const current = Array.from({ length: period }, (_, i) => shift(yesterday, -(period - 1 - i)));
  const prior = Array.from({ length: period }, (_, i) => shift(current[0]!, -(period - i)));
  return { current, prior };
}

export function pageTitle(path: string): string {
  const last = path.split("/").filter(Boolean).pop();
  if (!last) return "Home";
  const words = decodeURIComponent(last).replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function rank(rows: TrafficBreakdownRow[], name: (value: string) => string, total: number): Ranked[] {
  const sum = new Map<string, number>();
  for (const r of rows) sum.set(name(r.value), (sum.get(name(r.value)) ?? 0) + r.visitors);
  return [...sum.entries()]
    .map(([n, visitors]) => ({ name: n, visitors, share: total > 0 ? visitors / total : 0 }))
    .sort((a, b) => b.visitors - a.visitors);
}

export function buildWebsiteView(input: {
  now: Date; timezone: string; period: Period;
  daily: TrafficDay[]; breakdown: TrafficBreakdownRow[]; lastSyncedDay: string | null;
}): WebsiteView {
  const { current, prior } = windowDayKeys(input.now, input.timezone, input.period);
  const byDay = new Map(input.daily.map((d) => [d.day, d]));
  const days = current.map((day) => {
    const d = byDay.get(day);
    return { day, visitors: d?.visitors ?? 0, pageviews: d?.pageviews ?? 0, isWeekend: isWeekend(day) };
  });
  const sumOver = (keys: string[]) => keys.reduce((acc, k) => {
    const d = byDay.get(k); return { visitors: acc.visitors + (d?.visitors ?? 0), pageviews: acc.pageviews + (d?.pageviews ?? 0) };
  }, { visitors: 0, pageviews: 0 });
  const totals = sumOver(current);
  const priorTotals = sumOver(prior);

  const inCurrent = new Set(current); const inPrior = new Set(prior);
  const cur = input.breakdown.filter((r) => inCurrent.has(r.day));
  const pri = input.breakdown.filter((r) => inPrior.has(r.day));
  const dim = (rows: TrafficBreakdownRow[], d: TrafficBreakdownRow["dimension"]) => rows.filter((r) => r.dimension === d);

  const pages = rank(dim(cur, "page"), pageTitle, totals.visitors);
  const sources = rank(dim(cur, "source"), channelOf, totals.visitors);
  const places = rank(dim(cur, "place"), (v) => v, totals.visitors);
  const devices = rank(dim(cur, "device"), (v) => v, totals.visitors);
  const priorSources = rank(dim(pri, "source"), channelOf, priorTotals.visitors);
  const google = (list: Ranked[]) => list.find((s) => s.name === "Google")?.share ?? 0;

  const topPage = pages[0] ?? null;
  const sentence = websiteSentence({
    period: input.period, visitors: totals.visitors, priorVisitors: priorTotals.visitors,
    topSource: sources[0] ?? null, runnerUpSourceShare: sources[1]?.share ?? 0,
    topPage, runnerUpPageShare: pages[1]?.share ?? 0,
    topDevice: devices[0] ?? null,
  });

  const today = dayKeyInZone(input.now, input.timezone);
  const stale = input.lastSyncedDay === null || daysBetween(input.lastSyncedDay, today) > STALE_AFTER_DAYS;

  return {
    period: input.period, fromDay: current[0]!, toDay: current[current.length - 1]!, days,
    totals, prior: priorTotals,
    visitorsDelta: deltaVsPrior(totals.visitors, priorTotals.visitors),
    pageviewsDelta: deltaVsPrior(totals.pageviews, priorTotals.pageviews),
    fromGoogle: { share: google(sources), priorShare: google(priorSources) },
    topPage, pages: pages.slice(0, PANEL_ROWS), sources: sources.slice(0, PANEL_ROWS),
    places: places.slice(0, PANEL_ROWS), devices: devices.slice(0, PANEL_ROWS),
    sentence, lastSyncedDay: input.lastSyncedDay, stale,
  };
}
```

- [ ] **Step 4: Run — green; the four named mutations from the test comments; revert each.**

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run sentence view-model channel`

- [ ] **Step 5: Commit.**

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/lib/website/view-model.ts apps/web/src/lib/website/view-model.test.ts apps/web/src/lib/website/sentence.ts apps/web/src/lib/website/sentence.test.ts && B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit -m "feat(website): the view model (windows ending yesterday, zero-filled days, channel-grouped sources, shares, stale flag) and the plain-words sentence with its four restraint rules" || echo "BRANCH MOVED TO $B"
```

---
### Task 7: The Website page — loader, sentence panel, tiles, chart, device strip, three panels, four states, nav

**Files:**
- Create: `apps/web/src/lib/website/load.ts` + `load.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/page.tsx`, `website-section.tsx`, `daily-chart.tsx`, `breakdown-panel.tsx`, `device-strip.tsx`, `loading.tsx`
- Modify: `apps/web/src/lib/messages.ts` (new keys), `apps/web/src/lib/nav-groups.ts:64-67`, `apps/web/src/lib/nav-groups.test.ts:28-37` and the client case, `apps/web/src/components/app-sidebar.tsx` (icon map + import `Globe`), `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` (one section)

**Interfaces:**
- Consumes: `getSiteForAccount`, `listTrafficDays`, `listTrafficBreakdown` (Task 3); `buildWebsiteView`, `windowDayKeys`, `parsePeriod`, `Period`, `WebsiteView` (Task 6); `PLACE_DIMENSION` (Task 4); `StatTile`, `Sparkline`, `EmptyState`, `Skeleton`, `PageHeader`, `Card*`; `requireAccountAccess`, `dbForRequest`.
- Produces: `type WebsiteState = { state: "unlinked" } | { state: "waiting"; domain: string } | { state: "ready"; domain: string; view: WebsiteView }`; `loadWebsiteState(db, accountId, period, now): Promise<WebsiteState>`.

- [ ] **Step 1: Messages.** Add to `apps/web/src/lib/messages.ts` beside the other `nav.` keys and in a new `// ── Website ──` block (copy verbatim; plain language, no "Vercel"/"sync"):
```ts
  "nav.website": "Website",

  // ── Website (the traffic section; spec 2026-09-07-website-traffic-design) ──
  "website.title": "Website",
  "website.period.7": "7D",
  "website.period.14": "14D",
  "website.period.30": "30D",
  "website.periodLabel.7": "The last 7 days",
  "website.periodLabel.14": "The last 14 days",
  "website.periodLabel.30": "The last 30 days",
  "website.updated": "Updated this morning",
  "website.updatedOn": "Last updated {date}",
  "website.stale": "We haven't been able to update these numbers since {date}. They're still right up to then.",
  "website.tile.visitors": "Visitors",
  "website.tile.pageviews": "Pageviews",
  "website.tile.fromGoogle": "From Google",
  "website.tile.topPage": "Top page",
  "website.tile.topPageDetail": "{visitors} visitors · {share} of all",
  "website.tile.noTopPage": "No page stood out yet",
  "website.chart.title": "Visitors by day",
  "website.chart.tooltip": "{visitors} visitors · {pageviews} pageviews",
  "website.devices.phone": "Phone",
  "website.devices.desktop": "Desktop",
  "website.devices.tablet": "Tablet",
  "website.panel.pages": "Pages people read",
  "website.panel.sources": "Where visitors came from",
  "website.panel.places": "Where they were",
  "website.panel.devices": "Devices",
  "website.panel.empty": "Nothing here yet",
  "website.empty.title": "See who visits your website",
  "website.empty.body": "Where they come from, what they read, and how many there are, every morning.",
  "website.empty.askAgency": "Ask BIS about a website",
  "website.empty.askSubject": "A website for my business",
  "website.empty.link": "Link a site",
  "website.waiting.title": "Your first numbers arrive tomorrow morning",
  "website.waiting.body": "{domain} is connected. We collect a full day before showing anything, so nothing here is a guess.",
```

- [ ] **Step 2: Nav.** In `nav-groups.ts`, `NavIconKey` gains `| "website"`; the OVERVIEW group's items become:
```ts
        { href: `${base}/dashboard`, labelKey: "nav.dashboard", iconKey: "dashboard" },
        // Both audiences: the section exists for the client even before a site
        // is linked (it sells the feature, spec §The screen); the agency sees
        // the same page inside any account.
        { href: `${base}/website`, labelKey: "nav.website", iconKey: "website" },
        ...(isAgency
          ? ([{ href: `${base}/checklist`, labelKey: "nav.checklist", iconKey: "checklist" }] satisfies NavItemSpec[])
          : []),
```
(keep the existing checklist comment above its spread). In `nav-groups.test.ts`, the agency overview expectation becomes `["nav.dashboard", "nav.website", "nav.checklist"]`, and add:
```ts
  it("shows Website to both audiences, directly below Dashboard", () => {
    // Mutation: gate the item on isAgency — the client case fails.
    for (const isAgency of [true, false]) {
      const [overview] = buildNavGroups(BASE, isAgency);
      expect(overview!.items.slice(0, 2).map((i) => i.labelKey)).toEqual(["nav.dashboard", "nav.website"]);
    }
  });
```
In `app-sidebar.tsx`: import `Globe` from `lucide-react` and add `website: Globe,` to `NAV_ICONS` after `dashboard`.

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run nav-groups` → green (after the edits; the new test fails first if you write it first — do).

- [ ] **Step 3: The loader test (failing first).**

`apps/web/src/lib/website/load.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ getSiteForAccount: vi.fn(), listTrafficDays: vi.fn(), listTrafficBreakdown: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { loadWebsiteState } from "./load";

const NOW = new Date("2026-09-07T15:00:00.000Z");   // 10:00 Chicago
/** Projection-filtered accounts stub: yields only the columns the loader's
 *  own select asks for, so a test can only pass if it asked for timezone. */
function db(row: Record<string, unknown> = { timezone: "America/Chicago", name: "Rio — trial" }) {
  return {
    from: (table: string) => ({
      select: (cols: string) => ({
        eq: () => ({
          maybeSingle: async () => {
            if (table !== "accounts") throw new Error(`unexpected table ${table}`);
            const wanted = cols.split(",").map((c) => c.trim());
            return { data: Object.fromEntries(Object.entries(row).filter(([k]) => wanted.includes(k))), error: null };
          },
        }),
      }),
    }),
  } as never;
}
const SITE = { id: "site_1", accountId: "acct_1", vercelProjectId: "prj_1", domain: "rio.example", analyticsEnabledAt: null, lastSyncedDay: "2026-09-06" };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listTrafficDays.mockResolvedValue([]);
  dbMocks.listTrafficBreakdown.mockResolvedValue([]);
});

describe("loadWebsiteState", () => {
  it("unlinked when the account has no site, without reading traffic", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue(null);
    expect(await loadWebsiteState(db(), "acct_1", 14, NOW)).toEqual({ state: "unlinked" });
    expect(dbMocks.listTrafficDays).not.toHaveBeenCalled();
  });
  it("waiting when a site is linked but has never synced", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue({ ...SITE, lastSyncedDay: null });
    expect(await loadWebsiteState(db(), "acct_1", 14, NOW)).toEqual({ state: "waiting", domain: "rio.example" });
  });
  // Mutation: request only the current window (period days) — the range
  // assertion fails because the prior window is what the deltas need.
  it("ready: reads BOTH windows (2 × period, ending local yesterday) in the account's zone and builds the view", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue(SITE);
    dbMocks.listTrafficDays.mockResolvedValue([{ day: "2026-09-06", visitors: 25, pageviews: 40 }]);
    const r = await loadWebsiteState(db(), "acct_1", 7, NOW);
    expect(r.state).toBe("ready");
    expect(dbMocks.listTrafficDays).toHaveBeenCalledWith(expect.anything(), "acct_1", "2026-08-24", "2026-09-06");
    expect(dbMocks.listTrafficBreakdown).toHaveBeenCalledWith(expect.anything(), "acct_1", "2026-08-24", "2026-09-06");
    if (r.state === "ready") expect(r.view.totals.visitors).toBe(25);
  });
});
```

- [ ] **Step 4: The loader.**

`apps/web/src/lib/website/load.ts`:
```ts
import type { SupabaseClient } from "@bis/db";
import { getSiteForAccount, listTrafficDays, listTrafficBreakdown } from "@bis/db";
import { safeZone } from "@/lib/booking/time";
import { buildWebsiteView, windowDayKeys, type Period, type WebsiteView } from "./view-model";

export type WebsiteState =
  | { state: "unlinked" }
  | { state: "waiting"; domain: string }
  | { state: "ready"; domain: string; view: WebsiteView };

/**
 * Everything the Website page needs, from BIS's own tables only — never
 * Vercel. Reads the account's timezone itself (the [accountId] layout
 * confirms the account exists but does not pass it down): the windows are
 * local days, and "yesterday" is the account's yesterday.
 */
export async function loadWebsiteState(
  db: SupabaseClient, accountId: string, period: Period, now: Date,
): Promise<WebsiteState> {
  const site = await getSiteForAccount(db, accountId);
  if (!site) return { state: "unlinked" };
  if (!site.lastSyncedDay) return { state: "waiting", domain: site.domain };

  const { data, error } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`website: account timezone read failed: ${error.message}`);
  const timezone = safeZone((data as { timezone?: string } | null)?.timezone, "America/Chicago");

  const { current, prior } = windowDayKeys(now, timezone, period);
  const fromDay = prior[0]!;
  const toDay = current[current.length - 1]!;
  const [daily, breakdown] = await Promise.all([
    listTrafficDays(db, accountId, fromDay, toDay),
    listTrafficBreakdown(db, accountId, fromDay, toDay),
  ]);
  return {
    state: "ready", domain: site.domain,
    view: buildWebsiteView({ now, timezone, period, daily, breakdown, lastSyncedDay: site.lastSyncedDay }),
  };
}
```
Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "website/load"` → green; mutation per the comment; revert.

- [ ] **Step 5: The page and its components.** Server component; the period is a search param so the switch is three links and the page never becomes a client component. Only the chart's tooltip and the period pills' active state need the client.

`…/[accountId]/website/page.tsx`:
```tsx
import Link from "next/link";
import { Globe } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { loadWebsiteState } from "@/lib/website/load";
import { parsePeriod, type Period } from "@/lib/website/view-model";
import { m } from "@/lib/messages";
import { WebsiteSection } from "./website-section";
import { WebsiteSkeleton } from "./loading";

export const dynamic = "force-dynamic";

const PERIODS: Period[] = [7, 14, 30];

function PeriodSwitch({ base, period }: { base: string; period: Period }) {
  return (
    <nav aria-label="Period" className="flex gap-1">
      {PERIODS.map((p) => (
        <Link
          key={p}
          href={`${base}/website?period=${p}`}
          aria-current={p === period ? "true" : undefined}
          className={
            p === period
              ? "rounded-full bg-primary/15 px-3 py-1 font-mono text-[11px] font-medium tracking-[0.06em] text-primary"
              : "rounded-full border border-border px-3 py-1 font-mono text-[11px] font-medium tracking-[0.06em] text-muted-foreground hover:bg-accent"
          }
        >
          {m[`website.period.${p}`]}
        </Link>
      ))}
    </nav>
  );
}

export default async function WebsitePage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ period?: string }>;
}) {
  const { accountId } = await params;
  const { period: rawPeriod } = await searchParams;
  const { isAgency } = await requireAccountAccess(accountId);
  const db = await dbForRequest();
  const period = parsePeriod(rawPeriod);
  const base = `/dashboard/accounts/${accountId}`;
  const result = await loadWebsiteState(db, accountId, period, new Date());

  if (result.state === "unlinked") {
    return (
      <>
        <PageHeader title={m["website.title"]} />
        <div className="p-6">
          <EmptyState
            icon={Globe}
            title={m["website.empty.title"]}
            body={m["website.empty.body"]}
            action={isAgency ? (
              <Button asChild><Link href={`${base}/settings#website`}>{m["website.empty.link"]}</Link></Button>
            ) : (
              <Button asChild>
                <a href={`mailto:${process.env.AGENCY_SUPPORT_EMAIL ?? "hello@bis-rgv.com"}?subject=${encodeURIComponent(m["website.empty.askSubject"])}`}>
                  {m["website.empty.askAgency"]}
                </a>
              </Button>
            )}
          />
        </div>
      </>
    );
  }

  if (result.state === "waiting") {
    return (
      <>
        <PageHeader title={m["website.title"]} actions={<PeriodSwitch base={base} period={period} />} />
        <div className="space-y-3 p-6">
          <div className="rounded-lg border border-border bg-card p-5">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{m[`website.periodLabel.${period}`]}</p>
            <p className="mt-2 font-display text-lg font-[650] text-card-foreground">{m["website.waiting.title"]}</p>
            <p className="mt-1 text-sm text-muted-foreground">{m["website.waiting.body"].replace("{domain}", result.domain)}</p>
          </div>
          <WebsiteSkeleton />
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={m["website.title"]} actions={<PeriodSwitch base={base} period={period} />} />
      <WebsiteSection view={result.view} />
    </>
  );
}
```

`…/website/loading.tsx` (Next's route-level loading UI AND the waiting state's body — one skeleton, shaped like the real layout):
```tsx
import { Skeleton } from "@/components/ui/skeleton";

export function WebsiteSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      <div className="grid gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px] rounded-lg" />)}
      </div>
      <Skeleton className="h-[220px] rounded-lg" />
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[228px] rounded-lg" />)}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-4 h-[76px] rounded-lg" />
      <WebsiteSkeleton />
    </div>
  );
}
```

`…/website/website-section.tsx`:
```tsx
import { StatTile } from "@/components/stat-tile";
import { formatDate } from "@/lib/format";
import { m } from "@/lib/messages";
import { PLACE_DIMENSION } from "@/lib/vercel/web-analytics";
import type { WebsiteView } from "@/lib/website/view-model";
import { DailyChart } from "./daily-chart";
import { BreakdownPanel } from "./breakdown-panel";
import { DeviceStrip } from "./device-strip";

const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
const pct = (share: number) => `${Math.round(share * 100)}%`;
const fmt = (n: number) => n.toLocaleString("en-US");

export function WebsiteSection({ view }: { view: WebsiteView }) {
  const googlePts = Math.round((view.fromGoogle.share - view.fromGoogle.priorShare) * 100);
  const showPlaces = PLACE_DIMENSION !== "country";
  return (
    <div className="space-y-3 p-6">
      <div className="flex items-center justify-between">
        <p className={LABEL}>{m[`website.periodLabel.${view.period}`]}</p>
        {view.stale && view.lastSyncedDay ? (
          <p className="text-xs text-muted-foreground" role="status">{m["website.stale"].replace("{date}", formatDate(view.lastSyncedDay))}</p>
        ) : (
          <p className={LABEL}>{view.lastSyncedDay ? m["website.updatedOn"].replace("{date}", formatDate(view.lastSyncedDay)) : m["website.updated"]}</p>
        )}
      </div>

      <section className="rounded-lg border border-border bg-card p-5" aria-label="Summary">
        <p className="max-w-[62ch] text-[17px] leading-[1.5] text-card-foreground">
          {view.sentence.map((s, i) => s.strong
            ? <strong key={i} className="font-semibold text-primary">{s.text}</strong>
            : <span key={i}>{s.text}</span>)}
        </p>
      </section>

      <div className="grid gap-3 md:grid-cols-4">
        <StatTile label={m["website.tile.visitors"]} value={fmt(view.totals.visitors)} delta={view.visitorsDelta} spark={view.days.map((d) => d.visitors)} />
        <StatTile label={m["website.tile.pageviews"]} value={fmt(view.totals.pageviews)} delta={view.pageviewsDelta} spark={view.days.map((d) => d.pageviews)} />
        <StatTile
          label={m["website.tile.fromGoogle"]} value={pct(view.fromGoogle.share)}
          delta={{ direction: googlePts > 0 ? "up" : googlePts < 0 ? "down" : "flat", label: `${Math.abs(googlePts)} pts` }}
          period={m[`website.periodLabel.${view.period}`]}
        />
        <StatTile
          label={m["website.tile.topPage"]}
          value={view.topPage?.name ?? "—"}
          period={view.topPage
            ? m["website.tile.topPageDetail"].replace("{visitors}", fmt(view.topPage.visitors)).replace("{share}", pct(view.topPage.share))
            : m["website.tile.noTopPage"]}
        />
      </div>

      <section className="rounded-lg border border-border bg-card p-5" aria-label={m["website.chart.title"]}>
        <p className={LABEL}>{m["website.chart.title"]}</p>
        <DailyChart days={view.days} />
        {/* Spec Open check 2's fallback: with no city/region dimension the
            third panel becomes Devices and the strip under the chart goes,
            so devices are shown once, not twice. */}
        {showPlaces ? <DeviceStrip devices={view.devices} /> : null}
      </section>

      <div className="grid gap-3 md:grid-cols-3">
        <BreakdownPanel title={m["website.panel.pages"]} rows={view.pages} />
        <BreakdownPanel title={m["website.panel.sources"]} rows={view.sources} />
        {showPlaces
          ? <BreakdownPanel title={m["website.panel.places"]} rows={view.places} asShare />
          : <BreakdownPanel title={m["website.panel.devices"]} rows={view.devices} asShare />}
      </div>
    </div>
  );
}
```

`…/website/breakdown-panel.tsx`:
```tsx
import { m } from "@/lib/messages";
import type { Ranked } from "@/lib/website/view-model";

const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

/** A ranked list: name, proportional bar, value. Bars are relative to the
 *  top row so the leader is always full width — the mockup's treatment. */
export function BreakdownPanel({ title, rows, asShare = false }: { title: string; rows: Ranked[]; asShare?: boolean }) {
  const max = rows[0]?.visitors ?? 0;
  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-label={title}>
      <p className={LABEL}>{title}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{m["website.panel.empty"]}</p>
      ) : (
        <ul className="mt-2">
          {rows.map((r) => (
            <li key={r.name} className="flex items-center gap-3 py-1.5">
              <span className="flex-1 truncate text-sm text-card-foreground">{r.name}</span>
              <span className="h-1.5 w-24 overflow-hidden rounded-full bg-accent" aria-hidden>
                <span className="block h-full rounded-full bg-primary" style={{ width: `${max > 0 ? Math.round((r.visitors / max) * 100) : 0}%` }} />
              </span>
              <span className="min-w-9 text-right font-mono text-xs font-medium tabular-nums text-muted-foreground">
                {asShare ? `${Math.round(r.share * 100)}%` : r.visitors.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

`…/website/device-strip.tsx`:
```tsx
import { m } from "@/lib/messages";
import type { Ranked } from "@/lib/website/view-model";

const NAMES: Record<string, string> = { mobile: m["website.devices.phone"], desktop: m["website.devices.desktop"], tablet: m["website.devices.tablet"] };
const FILLS = ["bg-primary", "bg-primary/40", "bg-border"];

/** One segmented bar under the chart. Single hue in three strengths, never
 *  status colours — devices are not statuses (DESIGN.md, charts). */
export function DeviceStrip({ devices }: { devices: Ranked[] }) {
  const top = devices.slice(0, 3);
  if (top.length === 0) return null;
  return (
    <div className="mt-3 flex items-center gap-4">
      <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-accent" role="img" aria-label={top.map((d) => `${NAMES[d.name] ?? d.name} ${Math.round(d.share * 100)}%`).join(", ")}>
        {top.map((d, i) => <span key={d.name} className={`block h-full ${FILLS[i]}`} style={{ width: `${Math.round(d.share * 100)}%` }} />)}
      </div>
      <ul className="flex gap-3" aria-hidden>
        {top.map((d, i) => (
          <li key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`inline-block size-2 rounded-[2px] ${FILLS[i]}`} />
            {NAMES[d.name] ?? d.name}
            <span className="font-mono text-[11px] text-muted-foreground/70">{Math.round(d.share * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

`…/website/daily-chart.tsx` (the one client component; hover/focus tooltip, keyboard reachable):
```tsx
"use client";

import { useState } from "react";
import { m } from "@/lib/messages";
import { formatDate } from "@/lib/format";

type Day = { day: string; visitors: number; pageviews: number; isWeekend: boolean };

/**
 * Thin accent bars with 4px rounded tops, weekend bars muted (`bg-accent`
 * = --surface-3), mono axis labels, a tooltip on hover AND focus (each bar
 * is a button so a keyboard reaches it). Bars are DIVs, not SVG rects, so
 * every colour is a token class — no hard-coded hex anywhere.
 */
export function DailyChart({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const labelAt = (i: number) => i === 0 || i === days.length - 1 || i === Math.floor(days.length / 2);
  return (
    <div className="relative mt-3">
      {active !== null ? (
        <div role="tooltip" className="pointer-events-none absolute -top-1 rounded-lg border border-border bg-accent px-2.5 py-1.5 text-xs shadow-card"
             style={{ left: `${((active + 0.5) / days.length) * 100}%`, transform: "translateX(-50%)" }}>
          <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{formatDate(days[active]!.day)}</span>
          <span className="font-semibold text-card-foreground">
            {m["website.chart.tooltip"].replace("{visitors}", days[active]!.visitors.toLocaleString("en-US")).replace("{pageviews}", days[active]!.pageviews.toLocaleString("en-US"))}
          </span>
        </div>
      ) : null}
      <div className="flex h-[120px] items-end gap-[6px]" onMouseLeave={() => setActive(null)}>
        {days.map((d, i) => (
          <button
            key={d.day}
            type="button"
            aria-label={`${formatDate(d.day)}: ${d.visitors} visitors, ${d.pageviews} pageviews`}
            onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
            className={`flex-1 rounded-t-[4px] outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${d.isWeekend ? "bg-accent" : "bg-primary"} ${active !== null && active !== i ? "opacity-70" : ""}`}
            style={{ height: `${Math.max(2, (d.visitors / max) * 100)}%` }}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between" aria-hidden>
        {days.map((d, i) => (
          <span key={d.day} className="flex-1 font-mono text-[10px] uppercase tracking-[0.04em] text-muted-foreground">
            {labelAt(i) ? formatDate(d.day).replace(/,.*$/, "") : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
```
Check `formatDate(iso)` in `lib/format.ts` accepts a `YYYY-MM-DD` string and renders e.g. "Sep 6, 2026" (read lines 17-25); if it parses with `new Date(str)` (UTC midnight → previous day in the Americas, the recorded bug class), use `formatDateUTC` instead — a `YYYY-MM-DD` key IS a calendar date and `formatDateUTC` is the anchor that renders it unchanged. `shadow-card` exists as a token utility only if globals define it; if not, drop the class (no invented tokens).

- [ ] **Step 6: Styleguide.** In `styleguide/page.tsx` add one section after "Loading skeletons":
```tsx
        <Section title="Website chart + device strip" file="…/website/{daily-chart,device-strip}.tsx">
          <DailyChart days={[
            { day: "2026-08-31", visitors: 42, pageviews: 90, isWeekend: false }, { day: "2026-09-01", visitors: 55, pageviews: 120, isWeekend: false },
            { day: "2026-09-02", visitors: 48, pageviews: 101, isWeekend: false }, { day: "2026-09-03", visitors: 61, pageviews: 133, isWeekend: false },
            { day: "2026-09-04", visitors: 80, pageviews: 170, isWeekend: false }, { day: "2026-09-05", visitors: 30, pageviews: 61, isWeekend: true },
            { day: "2026-09-06", visitors: 26, pageviews: 50, isWeekend: true },
          ]} />
          <DeviceStrip devices={[{ name: "mobile", visitors: 71, share: 0.71 }, { name: "desktop", visitors: 26, share: 0.26 }, { name: "tablet", visitors: 3, share: 0.03 }]} />
        </Section>
```
with the two imports at the top of the file.

- [ ] **Step 7: Typecheck, lint, targeted tests, then eyeball both themes.**

Run: `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck && pnpm --filter web lint && cd apps/web && npx vitest run website nav-groups`
Expected: clean, green. Then `cd /c/Users/danlo/bis-platform/apps/web && pnpm build && pnpm start` in the background, open `/dashboard/styleguide` in dark and light and `/dashboard/accounts/<any account>/website` (the unlinked state) — the bars, strip and empty state render with tokens only; nothing moves on scroll. Stop the server (kill only the PID whose command line is YOUR `next start`).

- [ ] **Step 8: Commit.**

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/lib/messages.ts apps/web/src/lib/nav-groups.ts apps/web/src/lib/nav-groups.test.ts apps/web/src/components/app-sidebar.tsx apps/web/src/lib/website/load.ts apps/web/src/lib/website/load.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website" "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx" && B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit -m "feat(website): the Website section — sentence panel, four tiles, daily chart with tooltip, device strip, three panels, four states, nav entry for both audiences" || echo "BRANCH MOVED TO $B"
```

---

### Task 8: Linking a site — the agency-only settings card, two actions, tests

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/actions.ts` + `actions.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website/link-site-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx` (render the card; load the project list)
- Modify: `apps/web/src/lib/vercel/web-analytics.ts` (add `listProjects`) + its test; `apps/web/src/lib/messages.ts` (keys)

**Interfaces:**
- Consumes: `upsertSite`, `getSiteForAccount` (Task 3); `vercelAnalyticsFromEnv`, `VercelApiError` (Task 4); `requireAccountAccess`, `serviceDb`, `revalidatePath`.
- Produces: `VercelAnalytics#listProjects(): Promise<{ id: string; name: string; domain: string | null }[]>`; `saveSiteAction(accountId, formData): Promise<{ ok: true } | { ok: false; error: string }>`; `testSiteConnectionAction(accountId, formData): Promise<{ ok: true; visitors: number; pageviews: number } | { ok: false; error: string }>`.

- [ ] **Step 1: Messages.**
```ts
  "website.link.title": "Website",
  "website.link.body": "Connect the site BIS built for this client so their traffic shows up here every morning.",
  "website.link.project": "Vercel project",
  "website.link.domain": "Website address",
  "website.link.test": "Test connection",
  "website.link.testOk": "Connected — {visitors} visitors and {pageviews} pageviews in the last 7 days.",
  "website.link.testNotEnabled": "Analytics isn't switched on for that project yet. Run step 2 of the website setup runbook, then test again.",
  "website.link.testFailed": "Couldn't reach that project just now. Check the token in the platform settings and try again.",
  "website.link.projectRequired": "Pick the project this site is deployed from.",
  "website.link.domainRequired": "Enter the address customers use, like rioroofing.com.",
  "website.link.saved": "Site linked — the first numbers arrive tomorrow morning.",
  "website.link.linked": "Linked to {domain}",
  "website.link.noToken": "The platform's Vercel token isn't set, so projects can't be listed yet (runbook step 1).",
```

- [ ] **Step 2: `listProjects` on the client (test first).** Add to `web-analytics.test.ts`:
```ts
  it("listProjects reads /v9/projects for the team and returns id, name and the production domain when present", async () => {
    const f = fetchStub(200, { projects: [
      { id: "prj_1", name: "bis-website", targets: { production: { alias: ["bis-rgv.com", "bis-website.vercel.app"] } } },
      { id: "prj_2", name: "new-site" },
    ] });
    const api = new VercelAnalytics({ token: "tok", teamId: "team_1", fetchImpl: f as unknown as typeof fetch });
    expect(await api.listProjects()).toEqual([
      { id: "prj_1", name: "bis-website", domain: "bis-rgv.com" },
      { id: "prj_2", name: "new-site", domain: null },
    ]);
    expect(new URL(f.mock.calls[0]![0] as string).pathname).toBe("/v9/projects");
  });
```
Implementation in `web-analytics.ts` (the `#get` helper takes an absolute path when it starts with `https://`; simplest: a second private method):
```ts
  async listProjects(): Promise<{ id: string; name: string; domain: string | null }[]> {
    const url = new URL("https://api.vercel.com/v9/projects");
    url.searchParams.set("teamId", this.#teamId);
    url.searchParams.set("limit", "100");
    const res = await this.#fetch(url.toString(), { headers: { Authorization: `Bearer ${this.#token}` } });
    if (!res.ok) throw new VercelApiError(res.status, null, `vercel projects ${res.status}`);
    const body = (await res.json()) as { projects?: { id: string; name: string; targets?: { production?: { alias?: string[] } } }[] };
    return (body.projects ?? []).map((p) => {
      const aliases = p.targets?.production?.alias ?? [];
      const domain = aliases.find((a) => !a.endsWith(".vercel.app")) ?? aliases[0] ?? null;
      return { id: p.id, name: p.name, domain };
    });
  }
```
Run `npx vitest run web-analytics` → green.

- [ ] **Step 3: The actions' test (failing first), modelled on `branding/actions.test.ts`.**

`…/website/actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ upsertSite: vi.fn(), getSiteForAccount: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}) }));
const authMock = vi.hoisted(() => ({ requireAccountAccess: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (...a: unknown[]) => authMock.requireAccountAccess(...a) }));
const vercelMocks = vi.hoisted(() => ({ fromEnv: vi.fn(), countVisits: vi.fn() }));
vi.mock("@/lib/vercel/web-analytics", async (importOriginal) => ({
  ...(await importOriginal<object>()), vercelAnalyticsFromEnv: () => vercelMocks.fromEnv(),
}));

import { VercelApiError } from "@/lib/vercel/web-analytics";
import { m } from "@/lib/messages";
import { saveSiteAction, testSiteConnectionAction } from "./actions";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  authMock.requireAccountAccess.mockReset().mockResolvedValue({ userId: "user_agency", isAgency: true });
  vercelMocks.fromEnv.mockReset().mockReturnValue({ countVisits: (...a: unknown[]) => vercelMocks.countVisits(...a) });
  vercelMocks.countVisits.mockReset().mockResolvedValue({ visitors: 12, pageviews: 30 });
  dbMocks.upsertSite.mockResolvedValue({ id: "site_1" });
});

describe("saveSiteAction", () => {
  // Mutation: drop the isAgency check — the client case saves.
  it("refuses a non-agency caller before touching the database", async () => {
    authMock.requireAccountAccess.mockResolvedValue({ userId: "user_client", isAgency: false });
    await expect(saveSiteAction("acct_1", fd({ vercelProjectId: "prj_1", domain: "rio.example" }))).rejects.toThrow(/agency/);
    expect(dbMocks.upsertSite).not.toHaveBeenCalled();
  });
  it("refuses a missing project or domain with the named message, without writing", async () => {
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "", domain: "rio.example" }))).toEqual({ ok: false, error: m["website.link.projectRequired"] });
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "prj_1", domain: "  " }))).toEqual({ ok: false, error: m["website.link.domainRequired"] });
    expect(dbMocks.upsertSite).not.toHaveBeenCalled();
  });
  it("saves a trimmed, lower-cased domain without scheme or path", async () => {
    expect(await saveSiteAction("acct_1", fd({ vercelProjectId: "prj_1", domain: " https://Rio.Example/path " }))).toEqual({ ok: true });
    expect(dbMocks.upsertSite).toHaveBeenCalledWith(expect.anything(), "acct_1", { vercelProjectId: "prj_1", domain: "rio.example" });
  });
});

describe("testSiteConnectionAction", () => {
  it("returns the 7-day count on success and stamps analytics_enabled_at when the site is already linked", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue({ id: "site_1", vercelProjectId: "prj_1", domain: "rio.example" });
    expect(await testSiteConnectionAction("acct_1", fd({ vercelProjectId: "prj_1" }))).toEqual({ ok: true, visitors: 12, pageviews: 30 });
    expect(dbMocks.upsertSite).toHaveBeenCalledWith(expect.anything(), "acct_1", expect.objectContaining({ analyticsEnabledAt: expect.any(String) }));
  });
  // Mutation: map every VercelApiError to testFailed — the not-enabled case
  // loses its specific, actionable message.
  it("names 'analytics not enabled' specifically, and everything else generically, never leaking the raw error", async () => {
    dbMocks.getSiteForAccount.mockResolvedValue(null);
    vercelMocks.countVisits.mockRejectedValueOnce(new VercelApiError(400, "web_analytics_not_enabled", "Web Analytics is not enabled for this project"));
    expect(await testSiteConnectionAction("acct_1", fd({ vercelProjectId: "prj_1" }))).toEqual({ ok: false, error: m["website.link.testNotEnabled"] });
    vercelMocks.countVisits.mockRejectedValueOnce(new Error("secret-bearing message"));
    const r = await testSiteConnectionAction("acct_1", fd({ vercelProjectId: "prj_1" }));
    expect(r).toEqual({ ok: false, error: m["website.link.testFailed"] });
  });
  it("a missing token is the generic failure too, and the client is constructed only inside the action", async () => {
    vercelMocks.fromEnv.mockImplementation(() => { throw new Error("VERCEL_API_TOKEN/VERCEL_TEAM_ID unset"); });
    expect(await testSiteConnectionAction("acct_1", fd({ vercelProjectId: "prj_1" }))).toEqual({ ok: false, error: m["website.link.testFailed"] });
  });
});
```

- [ ] **Step 4: The actions.**

`…/website/actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { serviceDb, upsertSite, getSiteForAccount } from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { vercelAnalyticsFromEnv, VercelApiError } from "@/lib/vercel/web-analytics";
import { m } from "@/lib/messages";

/** Agency-only, re-checked here (hiding the card is not authorization) — the
 *  voice/automations precedent. Writes through serviceDb(): `sites` has no
 *  client write grant by design (0029). */
async function requireAgency(accountId: string): Promise<void> {
  const { isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) throw new Error("only the agency may link a website");
}

function normalizeDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

export async function saveSiteAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAgency(accountId);
  const vercelProjectId = String(formData.get("vercelProjectId") ?? "").trim();
  if (!vercelProjectId) return { ok: false, error: m["website.link.projectRequired"] };
  const domain = normalizeDomain(String(formData.get("domain") ?? ""));
  if (!domain) return { ok: false, error: m["website.link.domainRequired"] };
  await upsertSite(serviceDb(), accountId, { vercelProjectId, domain });
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  revalidatePath(`/dashboard/accounts/${accountId}/website`);
  return { ok: true };
}

/** One count query for the last 7 days. The raw error never reaches the
 *  operator: a Vercel message can name projects and teams that are not
 *  this client's business, and a token error can carry the token's name. */
export async function testSiteConnectionAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true; visitors: number; pageviews: number } | { ok: false; error: string }> {
  await requireAgency(accountId);
  const vercelProjectId = String(formData.get("vercelProjectId") ?? "").trim();
  if (!vercelProjectId) return { ok: false, error: m["website.link.projectRequired"] };
  const until = new Date();
  const since = new Date(until.getTime() - 7 * 24 * 60 * 60 * 1000);
  try {
    const api = vercelAnalyticsFromEnv();
    const counts = await api.countVisits(vercelProjectId, since.toISOString(), until.toISOString());
    const db = serviceDb();
    const site = await getSiteForAccount(db, accountId);
    if (site && site.vercelProjectId === vercelProjectId) {
      await upsertSite(db, accountId, { vercelProjectId, domain: site.domain, analyticsEnabledAt: until.toISOString() });
    }
    return { ok: true, ...counts };
  } catch (e) {
    if (e instanceof VercelApiError && e.code === "web_analytics_not_enabled") {
      return { ok: false, error: m["website.link.testNotEnabled"] };
    }
    console.error(`website: test connection failed for account ${accountId}, project ${vercelProjectId}: ${String(e)}`);
    return { ok: false, error: m["website.link.testFailed"] };
  }
}
```
Run: `cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "website/actions"` → green; the two named mutations; revert.

- [ ] **Step 5: The card (client component) and its place on Settings.**

`…/website/link-site-card.tsx`:
```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SubmitButton } from "../../submit-button";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";

export type VercelProjectOption = { id: string; name: string; domain: string | null };

export function LinkSiteCard({
  projects, projectsUnavailable, linked, saveAction, testAction,
}: {
  projects: VercelProjectOption[];
  projectsUnavailable: boolean;
  linked: { vercelProjectId: string; domain: string } | null;
  saveAction: (formData: FormData) => Promise<{ ok: true } | { ok: false; error: string }>;
  testAction: (formData: FormData) => Promise<{ ok: true; visitors: number; pageviews: number } | { ok: false; error: string }>;
}) {
  const [projectId, setProjectId] = useState(linked?.vercelProjectId ?? "");
  const [domain, setDomain] = useState(linked?.domain ?? "");
  const [testing, setTesting] = useState(false);

  // onSubmit + useTransition, NOT the `action` prop: React resets an
  // action-prop form even when the action FAILED, and Radix Select drives
  // state backwards on that reset (the recorded lesson).
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    const r = await saveAction(formData);
    if (r.ok) toast.success(m["website.link.saved"]); else toast.error(r.error);
  });

  async function test() {
    setTesting(true);
    try {
      const f = new FormData(); f.set("vercelProjectId", projectId);
      const r = await testAction(f);
      if (r.ok) toast.success(m["website.link.testOk"].replace("{visitors}", String(r.visitors)).replace("{pageviews}", String(r.pageviews)));
      else toast.error(r.error);
    } finally { setTesting(false); }
  }

  return (
    <Card id="website" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["website.link.title"]}</CardTitle>
        <CardDescription>{linked ? m["website.link.linked"].replace("{domain}", linked.domain) : m["website.link.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        {projectsUnavailable ? <p className="mb-4 text-sm text-muted-foreground">{m["website.link.noToken"]}</p> : null}
        <form onSubmit={onSubmit} className="space-y-3">
          <input type="hidden" name="vercelProjectId" value={projectId} />
          <div className="space-y-1.5">
            <Label htmlFor="site-project">{m["website.link.project"]}</Label>
            <Select value={projectId} onValueChange={(v) => { setProjectId(v); const p = projects.find((x) => x.id === v); if (p?.domain && !domain) setDomain(p.domain); }}>
              <SelectTrigger id="site-project"><SelectValue /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.domain ? ` — ${p.domain}` : ""}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="site-domain">{m["website.link.domain"]}</Label>
            <Input id="site-domain" name="domain" value={domain} onChange={(e) => setDomain(e.target.value)} required />
          </div>
          <div className="flex gap-2">
            <SubmitButton pending={pending}>{m["common.save"]}</SubmitButton>
            <Button type="button" variant="outline" disabled={!projectId || testing} onClick={test}>{testing ? m["common.saving"] : m["website.link.test"]}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
```

In `settings/page.tsx`: import `LinkSiteCard`, `saveSiteAction`, `testSiteConnectionAction`, `getSiteForAccount`, `vercelAnalyticsFromEnv`; in the page's data loading add
```ts
  const site = await getSiteForAccount(db, accountId);
  // Listing projects needs the token; without it the card still renders (so
  // the domain can be typed) and says why the list is empty.
  const projects = await (async () => {
    try { return { list: await vercelAnalyticsFromEnv().listProjects(), unavailable: false }; }
    catch (e) { console.error(`settings: vercel projects unavailable: ${String(e)}`); return { list: [] as VercelProjectOption[], unavailable: true }; }
  })();
```
and render, after the `SendingAddressCard`:
```tsx
        <LinkSiteCard
          projects={projects.list}
          projectsUnavailable={projects.unavailable}
          linked={site ? { vercelProjectId: site.vercelProjectId, domain: site.domain } : null}
          saveAction={saveSiteAction.bind(null, accountId)}
          testAction={testSiteConnectionAction.bind(null, accountId)}
        />
```
(`db` here is the page's existing `serviceDb()`; read the page to see which client it already holds — the page is agency-only, so serviceDb is right, and `getSiteForAccount` works with either.)

- [ ] **Step 6: Typecheck, lint, tests; commit.**

Run: `cd /c/Users/danlo/bis-platform && pnpm --filter web typecheck && pnpm --filter web lint && cd apps/web && npx vitest run website web-analytics settings`
```bash
cd /c/Users/danlo/bis-platform && git add apps/web/src/lib/messages.ts apps/web/src/lib/vercel "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/website" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx" && B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit -m "feat(website): link a site from Settings — project picker, domain, test connection; agency-only actions that never leak a raw provider error" || echo "BRANCH MOVED TO $B"
```

---
### Task 9: The e2e, the runbook, and the dogfood on the BIS website

**Files:**
- Create: `apps/web/e2e/website.spec.ts`
- Modify: `docs/runbooks/website-setup.md` (complete it)
- Outside this repo: the BIS-Website repo gains the analytics tag (its own tiny PR)

**Interfaces:**
- Consumes: `upsertSite`, `createAccount` (`@bis/db`); the fixture files auth.setup writes (`e2e/.auth/client-fixture.json`, `client-state.json`).

- [ ] **Step 1: The e2e spec — the two states a fresh account passes through, for both audiences.**

`apps/web/e2e/website.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, upsertSite } from "@bis/db";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

type ClientFixture = { accountId: string; clerkUserId: string };
const fixture = (): ClientFixture => JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

// client-access.spec.ts switches the fixture's access OFF and does not
// restore it (auth.teardown deletes the fixture); establish the precondition
// here so filename order cannot decide the result (the automations precedent).
test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

test.describe("the Website section, as the agency", () => {
  test("unlinked: sells the feature and offers Link a site; linked-but-unsynced: says the numbers arrive tomorrow", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/website`);
    await expect(page.getByRole("heading", { name: "Website" })).toBeVisible();
    await expect(page.getByText("See who visits your website")).toBeVisible();
    await expect(page.getByRole("link", { name: "Link a site" })).toHaveAttribute("href", `/dashboard/accounts/${accountId}/settings#website`);

    // Link a site directly (the card's action is unit-tested; the e2e proves
    // the page's state machine on real rows). The three new tables are in
    // auth.teardown's cascade (Task 2), so this leaves nothing behind.
    await upsertSite(serviceDb(), accountId, { vercelProjectId: `prj_e2e_${accountId.slice(0, 8)}`, domain: "fixture.example" });
    await page.reload();
    await expect(page.getByText("Your first numbers arrive tomorrow morning")).toBeVisible();
    await expect(page.getByText("fixture.example is connected")).toBeVisible();
    // Skeletons, not spinners, and no numbers invented.
    await expect(page.locator('[data-slot="skeleton"]').first()).toBeVisible();
    await expect(page.getByText("Visitors", { exact: true })).toHaveCount(0);
  });
});

test.describe("the Website section, as the client", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });
  test("appears in their nav under Dashboard and shows the same waiting state, never a Link a site button", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
    const nav = page.locator("aside nav");
    const links = await nav.getByRole("link").allTextContents();
    expect(links.indexOf("Website")).toBe(links.indexOf("Dashboard") + 1);
    await nav.getByRole("link", { name: "Website" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/website$`));
    await expect(page.getByText("Your first numbers arrive tomorrow morning")).toBeVisible();
    await expect(page.getByRole("link", { name: "Link a site" })).toHaveCount(0);
  });
});
```
Ordering note: Playwright runs files alphabetically within the project; `website.spec.ts` runs after `client-access.spec.ts`, and the agency test above links the site before the client test reads it — both tests in this file run in file order with one worker (the config's `workers`; confirm it is 1 for the chromium project, else make the client test link the site itself).

Run: `cd /c/Users/danlo/bis-platform/apps/web && npx playwright test website.spec.ts` (builds + starts its own server). Expected: 2 passed plus setup/teardown. Mutation: gate the nav item on `isAgency` in nav-groups.ts → the client test fails on the nav order; revert.

- [ ] **Step 2: Complete the runbook.** Replace the stub with:

```markdown
# Website traffic — build checklist and setup runbook

Audience: danlo. Part A once per environment; Part B once per BIS-built site.
Spec: docs/superpowers/specs/2026-09-07-website-traffic-design.md.

## Findings (Task 1)
<keep the section written in Task 1 verbatim>

## Part A — platform setup (once)

1. Vercel → Account → Tokens → create `bis-platform-analytics`, scope = the
   team, expiry 1 year. Copy it once.
2. Vercel → bis-platform project → Settings → Environment Variables:
   `VERCEL_API_TOKEN` = the token, `VERCEL_TEAM_ID` = `team_8zjV46sJxQDsVzikNQa1JaO2`
   (Production + Preview). Redeploy is not needed: the next cron tick reads env.
3. Local: the same two lines in `apps/web/.env.local`.
4. Verify: the next `/api/cron/reminders` tick's JSON carries a `siteTraffic`
   key. With no sites linked it reads `{ synced: 0, … }`; a `failed` there
   with "VERCEL_API_TOKEN/VERCEL_TEAM_ID unset" in the log means step 2 missed.

## Part B — every BIS-built site (five steps)

1. Create the Vercel project on the team from the site template.
2. `vercel project web-analytics <project> --scope danlopez508-8452s-projects`
3. Keep the analytics tag the template carries. Plain HTML sites:
   `<script>window.va=window.va||function(){(window.vaq=window.vaq||[]).push(arguments)};</script>`
   `<script defer src="/_vercel/insights/script.js"></script>`
   Next.js sites: `npm i @vercel/analytics` and `<Analytics />` from
   `@vercel/analytics/next` in the root layout.
4. BIS → the client's account → Settings → Website: pick the project, confirm
   the address, **Test connection** (expect "Connected — N visitors…"; "isn't
   switched on" means step 2), Save.
5. Next morning after 03:00 in the client's timezone: the Website section
   shows real numbers. Before that it says "Your first numbers arrive
   tomorrow morning" — that is correct, not a fault.

Nothing in Part B involves the client.

## The dogfood — BIS's own website

An internal account exists for it: name `BIS (internal — never invoice)`,
client access OFF, timezone America/Chicago, `clerk_org_id = org_internal_bis`
(no Clerk org; nobody signs in as it). Linked to project `bis-website`
(`prj_TDD9bT1z3Ow0fjLFaXxfxqIeH6w0`), domain `bis-rgv.com`. Its Website
section is the prospect demo until the prospect audit piece exists.

## When something is wrong

- Section says "We haven't been able to update these numbers since <date>":
  read the cron log for `site traffic pull failed for site …`. A 429 clears
  itself next tick; `web_analytics_not_enabled` means Part B step 2 was
  undone; anything mentioning the token means Part A step 2.
- A site needs unlinking: delete `site_traffic_breakdown`, then
  `site_traffic_daily`, then the `sites` row (FKs are RESTRICT on purpose).
```

- [ ] **Step 3: The dogfood account and link (needs Part A done — the token from Task 1 Step 4).**

Pre-flight read (Supabase MCP `execute_sql`): `select id from accounts where clerk_org_id = 'org_internal_bis';` → expect no rows. Then, from the repo with the platform env loaded:
```bash
cd /c/Users/danlo/bis-platform/apps/web && npx tsx -e "
import { serviceDb, createAccount, upsertSite } from '@bis/db';
const db = serviceDb();
const { id } = await createAccount(db, { clerkOrgId: 'org_internal_bis', name: 'BIS (internal — never invoice)', timezone: 'America/Chicago', actorId: 'user_danlo' });
await upsertSite(db, id, { vercelProjectId: 'prj_TDD9bT1z3Ow0fjLFaXxfxqIeH6w0', domain: 'bis-rgv.com' });
console.log('internal account', id);
"
```
(`createAccount` seeds `brand_name` from the name and leaves `client_access_enabled` at its default false — confirm with a read: `select name, brand_name, client_access_enabled from accounts where clerk_org_id='org_internal_bis'`.) Then in the app: Settings → Website → Test connection on that account → expect the not-enabled message if step 1 of Task 1 did not stick, else "Connected".

- [ ] **Step 4: The tag in the BIS-Website repo.** Find the repo path in `~/.claude/projects/C--Users-danlo/memory/project_bis_website.md`. In that repo, on a branch: `npm i @vercel/analytics`, add `import { Analytics } from "@vercel/analytics/next"` and `<Analytics />` inside the root layout's body; run its own tests; PR; danlo merges; confirm the deploy. Then load `https://bis-rgv.com` once and check the browser's network tab shows `/_vercel/insights/view` returning 2xx.

- [ ] **Step 5: First-pull verification (the next morning).** After 03:00 Chicago: read the cron tick's JSON (Vercel runtime logs for `/api/cron/reminders`): `siteTraffic: { synced: 1, daysSynced: ≥1 }`. Then open the internal account's Website section: real visitors, pages and sources; both themes; screenshots into `docs/design/` are NOT committed (they carry real numbers) — keep them in the scratchpad for the PR body.

- [ ] **Step 6: Commit the spec and runbook.**

```bash
cd /c/Users/danlo/bis-platform && git add apps/web/e2e/website.spec.ts docs/runbooks/website-setup.md && B="$(git branch --show-current)"; [ "$B" = "feat/website-traffic" ] && git commit -m "test(website): e2e for the unlinked and waiting states, both audiences; runbook completed with the five-step build checklist and the dogfood record" || echo "BRANCH MOVED TO $B"
```

---

### Task 10: Gates, ledger, whole-branch review, PR — no merge

- [ ] `cd /c/Users/danlo/bis-platform && git fetch origin && git merge origin/main` if `main` moved (re-run every gate on the combined tree). Then `pnpm check` · `pnpm --filter web build` · full e2e (uncontended, port 3000 free, nothing else running). Record real counts.
- [ ] Ledger (`.superpowers/sdd/progress.md`): 0029 APPLIED time; the dogfood account id; gates; every mutation that bit; the place-dimension decision.
- [ ] `superpowers:requesting-code-review` with these claims: (1) no client write path to `sites`/`site_traffic_*` — grants test + RLS policies, and every write in the pass and the actions goes through `serviceDb()`; (2) the Vercel client is constructed lazily inside the pass and the action, and the pass never rejects outright — one site's failure is one counter; (3) both windows end at LOCAL yesterday and the prior window is the same length; the pass's day bounds are local midnight to local midnight; (4) the four sentence rules hold (10-point lead, 5% "about the same", <20 plain count, 60% device); (5) no hard-coded colour, radius or shadow in the new components — `grep -rnE "#[0-9a-f]{3,6}\b|rgb\(|box-shadow" apps/web/src/app/\(dashboard\)/dashboard/accounts/\[accountId\]/website` is empty; (6) a raw Vercel error message never reaches the browser (actions map to `website.link.*`); (7) Website is in the nav for both audiences directly under Dashboard and the route is reachable by a client for their own account only; (8) the three new tables are in both cleanup lists (fixtures.ts, sweep.ts) ahead of `accounts`.
- [ ] Fix wave for any Critical/Important, re-review, then push, `gh pr create` (REST fallback), CI green ON THE HEAD, danlo merges, verify the deployment names the merge commit, smoke / 200 · cron 401 · /b/bogus 404, and read the first post-deploy cron tick's JSON for the `siteTraffic` key.

## Self-review (2026-09-07)

Spec coverage: Architecture → Tasks 3–5; Data model → Tasks 2–3; `channelOf` → Task 4; The screen (layout, sentence rules, four states, placement, period switch, stamp/stale) → Tasks 6–7; Linking a site → Task 8; Build checklist + dogfood → Task 9; Security → Tasks 2, 5, 8; Tests → every task carries its own with a named mutation; Open checks → Task 1 (city fallback wired through `PLACE_DIMENSION` in Tasks 4 and 7). Out of scope stays out (one site per account is a `unique`; no live reads; no custom events).
Placeholders: none — every step carries the code or the exact command; the two human-only steps (the token, the BIS-Website repo change) are marked as stops, not TBDs.
Type consistency: `SiteRow`/`TrafficDay`/`TrafficBreakdownRow` (Task 3) are what Tasks 5–7 import; `DayTraffic`/`DimRow`/`PLACE_DIMENSION` (Task 4) are what Task 5 and Task 7 read; `Period`/`WebsiteView`/`Ranked`/`SentenceSegment` (Task 6) are what Tasks 7 and 8 render; `siteTrafficPass.key === "siteTraffic"` is the cron JSON key named in the runbook.
