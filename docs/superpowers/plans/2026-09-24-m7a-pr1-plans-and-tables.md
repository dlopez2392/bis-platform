# M7a PR-1: Billing Tables + Agency Plans Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship rollout step (1) of M7a client billing: the four billing tables (`plans`, `account_billing`, `usage_events`, `stripe_webhook_events`) with RLS and explicit grants, plus an agency-only Plans page whose Save creates the plan's Stripe product, its monthly price and three graduated metered prices on Stripe Billing Meters. It has no effect on any account.

**Architecture:** One migration (`0051_billing_core.sql`) holds the four tables. The database refuses a malformed plan (jsonb shape CHECKs), a client write (grants) and a cross-account read (RLS). `packages/db/src/billing.ts` is the only code that touches `plans`. In `apps/web`, Stripe sits behind a small `BillingGateway` interface (`lib/billing/stripe-gateway.ts`). The real adapter wraps the `stripe` SDK, and unit tests use an in-memory `FakeGateway`. A pure-ish `syncPlanToStripe` (`lib/billing/stripe-catalog.ts`) decides which Stripe objects a save needs. The server actions call Stripe FIRST and then make ONE database write, so a failed Stripe call leaves the database untouched and a plan row can never exist without its Stripe objects.

**Tech Stack:** Next.js 16.3.6 (App Router, server actions), Supabase Postgres 17 (RLS), `@supabase/supabase-js`, `pg` (db tests), vitest 4, Playwright, `stripe@^22.6.2` (API version `2026-08-26.dahlia`), Radix UI, Tailwind 4 with the repo's tokens.

**Spec:** `docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md` (PR #139, branch `docs/m7a-client-billing-spec`). This plan covers only rollout step (1), spec §4.

## Global Constraints

- Tier: **HIGH (money)**. Every new assertion names the mutation that turns it red (in the test title or the comment beside it). The reviewer applies those probes.
- Money is integer cents, **USD only** (`currency = 'usd'`). No floats anywhere on the path from the form to Stripe.
- New tables are RLS-enabled with EXPLICIT grants: `revoke all ... from anon, authenticated` first, then grant back only what is needed. An enumerated revoke leaves PG17's MAINTAIN behind (0046's comment).
- `plans`: agency read only (`app.is_agency()`); **nobody but `service_role` writes** (the agency writes through `serviceDb()` after `requireAgency()`). `account_billing` and `usage_events`: the agency reads all rows, a client reads its own rows, and only `service_role` writes. `stripe_webhook_events`: `service_role` only.
- An account with no `account_billing` row is "unbilled". This PR creates no `account_billing` rows and changes nothing for any account.
- Test vs live: CI, the CI Supabase project, previews and local runs use Stripe **test-mode** keys. Only Vercel production holds a live key. The CI target guard refuses a live Stripe key (`sk_live_`/`rk_live_`). The app refuses a live key unless `VERCEL_ENV=production`.
- **Implementers never apply migrations.** A new migration goes to the CI project first (`ci-project-setup.yml`, runbook `docs/runbooks/ci-supabase-project.md` §6), and production gets it later through the orchestrator's MCP apply. The migration file is ASCII only and contains **no backslash** (the MCP escape trap).
- UI follows DESIGN.md: tokens only (no hard-coded colours, radii or shadows), dark AND light through the `.dark` class, loaded/empty/error states, one primary per view (rule 8), status as dot + word (rule 3), reversible actions immediate with an undo toast (rule 6), skeletons and no spinners (rule 7), and the destination registered in ⌘K.
- Copy is plain language and lives in `apps/web/src/lib/messages.ts`. No milestone codes (the M7a label stays out of every string).
- The e2e suite shares the CI project. Nothing here mutates `Test Client One`. Plan rows are agency-scoped, so every test-created plan name is stamped with a per-run id and deleted by the test that made it.
- A Stripe-dependent e2e test **skips loudly** when `STRIPE_SECRET_KEY` is absent: `test.skip` with the reason plus a `::warning` line. It never passes silently.
- Gates before merge: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`. CI runs them all (`verify`, `e2e`). Read the check runs FOR THE HEAD SHA.

## Prerequisites (danlo / orchestrator, before Task 10 can prove anything)

1. Repository secret `CI_STRIPE_SECRET_KEY` = the Stripe **test** secret key (`sk_test_...`). Until it exists, `plans.spec.ts`'s Stripe test skips with a `::warning`, and everything else stays green.
2. Local runs: put the same test key in `apps/web/.env.local` as `STRIPE_SECRET_KEY` (never a live key; the app refuses one outside production).
3. Production (not needed to merge this PR): the live key in Vercel **Production** only, and a test key in Vercel **Preview**. Until then, production's Plans page shows "Stripe isn't connected" and saves nothing.

## Stripe facts: verified vs assumed

Verified on 2026-09-24 by installing `stripe` into a scratch directory and typechecking every call this plan makes (`tsc --strict`):
- `npm view stripe version` → **22.6.2**. Its pinned `ApiVersion` → **`2026-08-26.dahlia`**.
- `stripe.billing.meters.create({ display_name, event_name, default_aggregation: { formula: "sum" }, customer_mapping: { type: "by_id", event_payload_key }, value_settings: { event_payload_key } }, { idempotencyKey })`
- `stripe.billing.meters.list({ status: "active", limit })` returns `data[].event_name` and `has_more`. `stripe.billing.meters.retrieve(id)`.
- `stripe.products.create({ name, metadata }, { idempotencyKey })`, `stripe.products.update(id, { name | active })`, `stripe.products.retrieve(id).metadata`.
- `stripe.prices.create({ product, currency, unit_amount, billing_scheme: "tiered", tiers_mode: "graduated", tiers: [{ up_to: number | "inf", unit_amount }], recurring: { interval: "month", usage_type: "licensed" | "metered", meter } }, { idempotencyKey })`.
- `stripe.prices.retrieve(id, { expand: ["tiers"] })` → `tiers[].up_to: number | null`, `recurring.meter`, `billing_scheme`, `tiers_mode`.

**Assumptions (not verified; Task 10's e2e run against Stripe test mode is the proof for the first four):**
- A1. Stripe accepts a graduated metered price whose tiers are `[{up_to: N, unit_amount: 0}, {up_to: "inf", unit_amount: X}]` and bills it as "the first N units free". It rejects `up_to: 0`, which is why a zero allowance uses a plain per-unit price.
- A2. `expand: ["tiers"]` is required to read a price's tiers back.
- A3. The Radix `Checkbox` given a `name` inside a `<form>` submits `"on"` when it is checked.
- A4. Stripe's idempotency replay returns the first response for a key and rejects the same key sent with different parameters (400). Keys expire after about 24 hours.
- A5. A meter's `event_name` is unique per Stripe account, so a second `createMeter` with the same name fails rather than duplicating. A meter someone deactivated in the dashboard is then not "active", its name may still be taken, and the save fails with the Stripe-failure message.
- A6. Prices that are superseded but left active keep billing existing subscriptions (spec §2: "existing subscriptions keep theirs until moved"). This PR deactivates nothing.
- A7. `console.warn("::warning ...")` from inside a Playwright test reaches the job log where GitHub turns it into an annotation. If it does not, the `test.skip` reason in the report still shows the skip.
- A8. The 50-cent monthly minimum matches Stripe's USD minimum charge.

## Spec gaps resolved here (the reviewer should confirm or overrule)

- G1. **Where the Plans page lives.** The spec says "Agency › Settings › Plans", but the repo has no agency-level Settings page (Settings is per account). This plan puts it at `/dashboard/plans`, an agency top-level nav entry beside Phone numbers. That registers it in ⌘K by construction (`buildPaletteEntries` derives from `buildNavGroups`), with "billing"/"pricing" keywords.
- G2. **Meter key spelling.** The spec's `usage_events.meter` uses `ai_chat`, while its allowances, overage and price-id keys use `ai_chats`. This plan uses `ai_chats` everywhere, so one TypeScript union (`MeterKey`) covers all four places. The DB test pins `ai_chat` as refused.
- G3. **`subscription_status` values.** The spec lists six. Stripe has eight (`incomplete_expired` and `paused` too). The CHECK allows all eight, so PR-3's webhook mirror can never be refused by the database for a real Stripe status.
- G4. **Account deletion.** Not specified. `account_billing` and `usage_events` use `on delete cascade` (0046's precedent for derived state), and a live test proves it. `plans` is `on delete restrict` from `account_billing`, so a plan with billed accounts cannot be deleted.
- G5. **Clients reading plans.** The spec says plans are agency-only, and this plan keeps that. PR-3's client Billing page will need the plan's name. It can read it via `serviceDb()` after `requireAccountAccess`, or get a policy then.
- G6. **Sub-cent overage.** Integer cents make 1¢ per unit the smallest overage (no $0.0075 per text).
- G7. **Archive is BIS-only.** Archiving hides a plan from future assignment and does not deactivate anything at Stripe. A price change adds new prices and leaves the old ones active (A6).
- G8. **No half-made plans.** `stripe_product_id` and all four price ids are NOT NULL, so a plan row cannot exist without its Stripe objects. The list therefore needs only the spec's two statuses (Active/Archived).
- G9. **Meter event names are permanent from this PR:** `bis_voice_minutes`, `bis_sms_segments`, `bis_ai_chats`. PR-2's usage reporter must send exactly these.
- G10. **Bounds** (the DB and the form agree): monthly price $0.50 to $10,000.00, allowances 0 to 1,000,000 whole units, overage 0 to $100.00 per unit, name 1 to 60 characters with no surrounding spaces.

## File Structure

21 files created, 14 modified (35 total).

**packages/db**
- Create `packages/db/supabase/migrations/0051_billing_core.sql`: the four tables, CHECKs, indexes, RLS, grants.
- Create `packages/db/src/billing.ts`: plan types plus `listPlans`, `getPlan`, `insertPlan`, `updatePlan`, `setPlanArchived`, `countBilledAccountsByPlan`.
- Modify `packages/db/src/index.ts`: export the above.
- Create `packages/db/src/test/billing-schema.test.ts`: existence, grants, RLS, constraints, cascade (45 tests).
- Create `packages/db/src/test/billing.test.ts`: the module, live through `serviceDb()` (8 tests).

**CI and env contract**
- Modify `.github/scripts/ci-target-guard.sh`: check 6, a Stripe key (optional) must be test-mode.
- Modify `apps/web/ci/ci-target-guard.test.ts`: +5 tests and +2 leak cases.
- Modify `.github/workflows/ci.yml`: the e2e job gets `STRIPE_SECRET_KEY: ${{ secrets.CI_STRIPE_SECRET_KEY }}`.
- Modify `apps/web/ci/ci-workflow.test.ts`: allowlist `CI_STRIPE_SECRET_KEY`, +1 test.
- Modify `.env.example`: `STRIPE_SECRET_KEY`.

**apps/web: billing library**
- Modify `apps/web/package.json` and `pnpm-lock.yaml`: add `stripe@^22.6.2`.
- Create `apps/web/src/lib/billing/stripe-gateway.ts`: the `BillingGateway` interface, `priceCreateParams`, the `stripeGateway` adapter, `stripeKeyVerdict`, `billingGatewayFromEnv`.
- Create `apps/web/src/lib/billing/fake-gateway.ts`: the in-memory `FakeGateway` for unit tests.
- Create `apps/web/src/lib/billing/stripe-gateway.test.ts` (20 tests).
- Create `apps/web/src/lib/billing/stripe-catalog.ts`: `METERS`, `ensureMeters`, `syncPlanToStripe`.
- Create `apps/web/src/lib/billing/stripe-catalog.test.ts` (12 tests).
- Create `apps/web/src/lib/billing/plan-form.ts`: money parsing and formatting, `PLAN_LIMITS`, `parsePlanForm`.
- Create `apps/web/src/lib/billing/plan-form.test.ts` (26 tests).
- Create `apps/web/src/lib/billing/plan-rows.ts`: the list's view model and status treatments.
- Create `apps/web/src/lib/billing/plan-rows.test.ts` (4 tests).
- Modify `apps/web/src/lib/messages.ts`: every `plans.*` string and `nav.plans`.

**apps/web: the page**
- Create `apps/web/src/app/(dashboard)/dashboard/plans/actions.ts`: create, update, archive and restore.
- Create `apps/web/src/app/(dashboard)/dashboard/plans/actions.test.ts` (16 tests).
- Create `apps/web/src/app/(dashboard)/dashboard/plans/page.tsx`
- Create `apps/web/src/app/(dashboard)/dashboard/plans/loading.tsx`
- Create `apps/web/src/app/(dashboard)/dashboard/plans/plans-list.tsx`
- Create `apps/web/src/app/(dashboard)/dashboard/plans/plan-dialog.tsx`
- Create `apps/web/src/app/(dashboard)/dashboard/plans/plans-list.test.ts` (4 tests).
- Modify `apps/web/src/lib/nav-groups.ts` and `apps/web/src/lib/nav-groups.test.ts` (+1 test, 1 edited).
- Modify `apps/web/src/lib/palette/registry.ts` and `apps/web/src/lib/palette/registry.test.ts` (+1 test, 1 edited).
- Modify `apps/web/src/components/app-sidebar.tsx`: the `plans` icon.
- Create `apps/web/e2e/plans.spec.ts` (2 tests).

**New test count: 147** = billing-schema 45 + billing 8 + guard 7 (5 tests + 2 leak cases) + workflow 1 + stripe-gateway 20 + stripe-catalog 12 + plan-form 26 + actions 16 + plan-rows 4 + plans-list 4 + nav-groups 1 + registry 1 + e2e 2. `it.each` rows count one each.

## Task order and checkpoints

11 tasks and 1 orchestrator checkpoint:

1. Migration + schema/grants/RLS tests
2. `billing.ts` db module
**Checkpoint A (orchestrator only):** push 0051 to the CI project and run Tasks 1–2 green.
3. CI guard + workflow + env contract
4. Stripe dependency + gateway
5. Stripe catalog (`syncPlanToStripe`)
6. Copy + plan form parsing
7. Server actions
8. Nav, palette, sidebar, row view model
9. The page UI
10. e2e
11. Gates and handoff

Tasks 3–9 need no database and can run while Checkpoint A is pending. Task 10 needs Checkpoint A and the `CI_STRIPE_SECRET_KEY` secret.

Commands in this plan run from the repo root `C:\Users\danlo\bis-platform` (Git Bash).

---

### Task 1: Migration 0051 and its schema/grants/RLS proof

**Files:**
- Create: `packages/db/src/test/billing-schema.test.ts`
- Create: `packages/db/supabase/migrations/0051_billing_core.sql`

**Interfaces:**
- Consumes: `withRollback`, `actAs` (`packages/db/src/test/db.ts`); `withTestAccount` (`packages/db/src/test/fixtures.ts`); `serviceDb` (`packages/db/src/service.ts`); `app.is_agency()`, `app.current_account_id()` (0001/0008).
- Produces (the SQL contract later tasks rely on):
  - `public.plans(id uuid pk, agency_id uuid, name text, monthly_price_cents int, currency text, features jsonb {voice_receptionist:bool, web_concierge:bool}, allowances jsonb {voice_minutes, sms, ai_chats: int}, overage_cents jsonb {same keys}, stripe_product_id text not null, stripe_price_ids jsonb {base, voice_minutes, sms, ai_chats: 'price_...'} not null, archived_at, created_at, updated_at)`, with unique key `plans_agency_name_key (agency_id, name)` and primary key `plans_pkey`.
  - `public.account_billing(account_id pk/fk cascade, plan_id fk restrict, complimentary, stripe_customer_id, stripe_subscription_id, subscription_status, current_period_end, past_due_since, billing_paused_at, created_at, updated_at)`.
  - `public.usage_events(id, account_id fk cascade, meter in ('voice_minutes','sms','ai_chats'), quantity > 0, occurred_at, source_ref, reported_at, created_at, updated_at, unique (meter, source_ref))`.
  - `public.stripe_webhook_events(event_id pk 'evt_...', type, received_at, processed_at)`.

- [ ] **Step 1: Write the failing test file**

Create `packages/db/src/test/billing-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";

/**
 * 0051 (M7a billing, rollout step 1) at the level that can see it: real SQL
 * inside a rolled-back transaction for grants, RLS and constraints, and
 * serviceDb() under withTestAccount for the one behaviour a rollback cannot
 * show (the account-delete cascade). A unit test that mocks the db is blind
 * to every assertion in this file.
 *
 * Money tier: every test names the mutation that turns it red.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_BILL_${label}_${RUN}`;

const TABLES = ["plans", "account_billing", "usage_events", "stripe_webhook_events"] as const;
const CLIENT_SELECTABLE = ["plans", "account_billing", "usage_events"] as const;

const FEATURES = { voice_receptionist: true, web_concierge: false };
const ALLOWANCES = { voice_minutes: 500, sms: 1000, ai_chats: 200 };
const OVERAGE = { voice_minutes: 12, sms: 3, ai_chats: 25 };
const PRICE_IDS = { base: "price_t_base", voice_minutes: "price_t_vm", sms: "price_t_sms", ai_chats: "price_t_ai" };

const SERVICE_ROLE_ALL = ["DELETE", "INSERT", "REFERENCES", "SELECT", "TRIGGER", "TRUNCATE", "UPDATE"]
  .map((privilege_type) => ({ grantee: "service_role", privilege_type }));

type Seeded = { agencyId: string; a: string; b: string; off: string; plan: string };

/** Three accounts (A and B with client access on, OFF with it off), one
 *  plan, a billing row and a usage row for EACH account, one webhook event.
 *  Every RLS assertion below therefore has a foreign row present to leak. */
async function seed(c: Client): Promise<Seeded> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const mk = async (label: string, access: boolean) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,$4) returning id",
    [agency!.id, orgId(label), `Billing ${label}`, access])).rows[0]!.id;
  const a = await mk("A", true);
  const b = await mk("B", true);
  const off = await mk("OFF", false);
  const plan = (await c.query<{ id: string }>(
    `insert into plans (agency_id, name, monthly_price_cents, features, allowances, overage_cents,
                        stripe_product_id, stripe_price_ids)
       values ($1, $2, 4900, $3, $4, $5, 'prod_t_1', $6) returning id`,
    [agency!.id, `Growth ${RUN}`, JSON.stringify(FEATURES), JSON.stringify(ALLOWANCES),
      JSON.stringify(OVERAGE), JSON.stringify(PRICE_IDS)])).rows[0]!.id;
  for (const acct of [a, b, off]) {
    await c.query("insert into account_billing (account_id, plan_id) values ($1,$2)", [acct, plan]);
    await c.query(
      "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'sms',2,now(),$2)",
      [acct, `message:${acct}`]);
  }
  await c.query("insert into stripe_webhook_events (event_id, type) values ($1,'invoice.paid')", [`evt_t_${RUN}`]);
  return { agencyId: agency!.id, a, b, off, plan };
}

const PLAN_SQL = `insert into plans (agency_id, name, monthly_price_cents, currency, features, allowances,
                                     overage_cents, stripe_product_id, stripe_price_ids)
                  values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

type PlanOverrides = Partial<{
  name: string; cents: number; currency: string; features: unknown; allowances: unknown;
  overage: unknown; product: string; prices: unknown;
}>;

function planParams(agencyId: string, name: string, over: PlanOverrides = {}): unknown[] {
  return [agencyId, over.name ?? name, over.cents ?? 4900, over.currency ?? "usd",
    JSON.stringify(over.features ?? FEATURES), JSON.stringify(over.allowances ?? ALLOWANCES),
    JSON.stringify(over.overage ?? OVERAGE), over.product ?? "prod_t_2", JSON.stringify(over.prices ?? PRICE_IDS)];
}

/** Each statement in its own savepoint, so one refusal cannot hide the next. */
async function verdicts(c: Client, cases: Record<string, [string, unknown[]]>): Promise<Record<string, string | undefined>> {
  const out: Record<string, string | undefined> = {};
  for (const [label, [sql, params]] of Object.entries(cases)) {
    await c.query("savepoint v");
    try { await c.query(sql, params); out[label] = undefined; }
    catch (e) { out[label] = (e as { code?: string }).code; }
    await c.query("rollback to savepoint v");
  }
  return out;
}

describe("0051 tables exist (guards every assertion below from vacuity)", () => {
  for (const table of TABLES) {
    it(`${table} exists`, () => withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(`select to_regclass('public.${table}')::text as oid`);
      expect(rows[0]!.oid?.replace(/^public\./, "")).toBe(table);
    }));
  }
});

describe("0051 grants", () => {
  for (const table of CLIENT_SELECTABLE) {
    // EXACT set, not containment: the default ACL hands TRUNCATE to
    // authenticated on every new table (call-proposals-grants.test.ts).
    it(`${table}: authenticated holds EXACTLY select (mutation: grant insert on ${table} to authenticated → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select grantee, privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' order by privilege_type`, [table]);
        expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
      }));
  }

  it("stripe_webhook_events: authenticated holds nothing (mutation: grant select on it to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select privilege_type from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'stripe_webhook_events' and grantee = 'authenticated'`);
      expect(rows).toEqual([]);
    }));

  for (const table of TABLES) {
    it(`${table}: anon holds nothing (mutation: drop the revoke from anon → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'anon'`, [table]);
        expect(rows).toEqual([]);
      }));

    // role_table_grants does not report MAINTAIN at all; has_table_privilege
    // reads the real ACL. The only assertion here that can see PG17's `m` bit.
    it(`${table}: neither authenticated nor anon holds MAINTAIN (mutation: enumerate the revoke like 0025 → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ auth: boolean; anon: boolean }>(
          `select has_table_privilege('authenticated', 'public.${table}', 'MAINTAIN') as auth,
                  has_table_privilege('anon', 'public.${table}', 'MAINTAIN') as anon`);
        expect(rows[0]).toEqual({ auth: false, anon: false });
      }));

    it(`${table}: the whole grant set across every role but postgres (mutation: grant select on ${table} to public → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select grantee, privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee <> 'postgres' order by grantee, privilege_type`, [table]);
        const authenticated = table === "stripe_webhook_events" ? [] : [{ grantee: "authenticated", privilege_type: "SELECT" }];
        expect(rows).toEqual([...authenticated, ...SERVICE_ROLE_ALL]);
      }));

    it(`${table}: row level security is on (mutation: drop its enable row level security → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ relrowsecurity: boolean }>(
          `select relrowsecurity from pg_class where oid = 'public.${table}'::regclass`);
        expect(rows[0]!.relrowsecurity).toBe(true);
      }));
  }
});

describe("0051 RLS reads: a foreign row is PRESENT in every case", () => {
  it("a client reads only its own account_billing row (mutation: account_billing_tenant USING (true) → FAILS, sees B and OFF)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query<{ account_id: string }>("select account_id from account_billing");
      expect(rows.map((r) => r.account_id)).toEqual([s.a]);
    }));

  it("a client reads only its own usage rows (mutation: usage_events_tenant USING (true) → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query("select account_id, quantity from usage_events");
      expect(rows).toEqual([{ account_id: s.a, quantity: 2 }]);
    }));

  it("a client reads no plans at all (mutation: plans_agency_read USING (true) → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: asOwner } = await c.query("select id from plans where id = $1", [s.plan]);
      expect(asOwner).toHaveLength(1); // the plan IS there to leak
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query("select id from plans");
      expect(rows).toEqual([]);
    }));

  it("a client whose access is switched off reads neither billing nor usage (mutation: policy matches org_id directly instead of app.current_account_id() → FAILS)", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, { org_id: orgId("OFF") });
      const billing = await c.query("select account_id from account_billing");
      const usage = await c.query("select account_id from usage_events");
      expect([billing.rows, usage.rows]).toEqual([[], []]);
    }));

  it("the agency reads every account's billing and usage rows, and the plan (mutation: drop app.is_agency() from a policy → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { app_role: "agency_admin" });
      const ids = [s.a, s.b, s.off];
      const billing = await c.query("select account_id from account_billing where account_id = any($1::uuid[])", [ids]);
      const usage = await c.query("select account_id from usage_events where account_id = any($1::uuid[])", [ids]);
      const plan = await c.query("select id from plans where id = $1", [s.plan]);
      expect([billing.rows.length, usage.rows.length, plan.rows.length]).toEqual([3, 3, 1]);
    }));

  // ONE refused statement per withRollback: the abort would hide the reason of any later one.
  it("a client cannot SELECT stripe_webhook_events: 42501 (mutation: grant select on it to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("select event_id from stripe_webhook_events")).rejects.toMatchObject({ code: "42501" });
    }));

  it("the agency cannot SELECT stripe_webhook_events either (service role only): 42501", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, { app_role: "agency_admin" });
      await expect(c.query("select event_id from stripe_webhook_events")).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0051 writes: only service_role writes (42501, the GRANT refusing, never 'an error')", () => {
  it("a client cannot INSERT a plan (mutation: grant insert on plans to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query(PLAN_SQL, planParams(s.agencyId, `Client ${RUN}`))).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot UPDATE a plan's price (mutation: grant update on plans to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("update plans set monthly_price_cents = 100 where id = $1", [s.plan]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("even the agency's own JWT cannot INSERT a plan directly: writes go through serviceDb() after requireAgency() (mutation: grant insert on plans to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { app_role: "agency_admin" });
      await expect(c.query(PLAN_SQL, planParams(s.agencyId, `Agency ${RUN}`))).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot mark its own account complimentary (mutation: grant update on account_billing to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("update account_billing set complimentary = true where account_id = $1", [s.a]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot INSERT usage for its own account (mutation: grant insert on usage_events to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query(
        "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'sms',1,now(),'message:forged')", [s.a],
      )).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot DELETE its own usage (erasing its bill) (mutation: grant delete on usage_events to authenticated → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("delete from usage_events where account_id = $1", [s.a]))
        .rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0051 constraints (23514 check, 23505 unique, 23503 foreign key)", () => {
  it("plans: every malformed field is refused, and the valid control row is not (mutation: delete any one CHECK → its rows turn undefined, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const cases: Record<string, PlanOverrides> = {
        "the valid control row": {},
        "a currency other than usd": { currency: "eur" },
        "a monthly price under 50 cents": { cents: 49 },
        "a monthly price over $10,000": { cents: 1000001 },
        "a name with surrounding spaces": { name: " Padded " },
        "an empty name": { name: "" },
        "features missing web_concierge": { features: { voice_receptionist: true } },
        "features with an extra key": { features: { ...FEATURES, sms: true } },
        "a feature that is not a boolean": { features: { voice_receptionist: "yes", web_concierge: false } },
        "features that are an array": { features: [true, false] },
        "a negative allowance": { allowances: { ...ALLOWANCES, sms: -1 } },
        "a fractional allowance": { allowances: { ...ALLOWANCES, sms: 1.5 } },
        "an allowance written as a string": { allowances: { ...ALLOWANCES, sms: "5" } },
        "an allowance over a million": { allowances: { ...ALLOWANCES, voice_minutes: 1000001 } },
        "allowances missing ai_chats": { allowances: { voice_minutes: 1, sms: 1 } },
        "allowances with an unknown meter": { allowances: { ...ALLOWANCES, email: 1 } },
        "an overage over $100 a unit": { overage: { ...OVERAGE, sms: 10001 } },
        "a negative overage": { overage: { ...OVERAGE, ai_chats: -1 } },
        "price ids missing ai_chats": { prices: { base: "price_a", voice_minutes: "price_b", sms: "price_c" } },
        "a price id that is not a Stripe price": { prices: { ...PRICE_IDS, base: "prod_x" } },
        "a product id that is not a Stripe product": { product: "price_x" },
      };
      // Built imperatively: a .map() returning [label, [sql, params]] infers
      // an array, not a tuple, and would not typecheck as the verdicts input.
      const statements: Record<string, [string, unknown[]]> = {};
      Object.entries(cases).forEach(([label, over], i) => {
        statements[label] = [PLAN_SQL, planParams(s.agencyId, `V${i} ${RUN}`, over)];
      });
      const result = await verdicts(c, statements);
      expect(result).toEqual(Object.fromEntries(Object.keys(cases).map((label) =>
        [label, label === "the valid control row" ? undefined : "23514"])));
    }));

  it("account_billing: complimentary is never paused or subscribed; status and subscription travel together; ids are Stripe-shaped (mutation: delete any one CHECK → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const on = (set: string): [string, unknown[]] => [`update account_billing set ${set} where account_id = $1`, [s.a]];
      const result = await verdicts(c, {
        "the valid control: an active subscription": on("stripe_customer_id = 'cus_t', stripe_subscription_id = 'sub_t', subscription_status = 'active'"),
        "the valid control: complimentary with no subscription": on("complimentary = true"),
        "complimentary with a Stripe subscription": on("complimentary = true, stripe_subscription_id = 'sub_t2', subscription_status = 'active'"),
        "complimentary and paused": on("complimentary = true, billing_paused_at = now()"),
        "a status Stripe does not have": on("stripe_subscription_id = 'sub_t3', subscription_status = 'paid'"),
        "a status without a subscription": on("subscription_status = 'active'"),
        "a subscription without a status": on("stripe_subscription_id = 'sub_t4'"),
        "a customer id that is not a Stripe customer": on("stripe_customer_id = 'sub_x'"),
        "a subscription id that is not a Stripe subscription": on("stripe_subscription_id = 'cus_x', subscription_status = 'active'"),
      });
      expect(result).toEqual({
        "the valid control: an active subscription": undefined,
        "the valid control: complimentary with no subscription": undefined,
        "complimentary with a Stripe subscription": "23514",
        "complimentary and paused": "23514",
        "a status Stripe does not have": "23514",
        "a status without a subscription": "23514",
        "a subscription without a status": "23514",
        "a customer id that is not a Stripe customer": "23514",
        "a subscription id that is not a Stripe subscription": "23514",
      });
    }));

  it("usage_events: quantity is positive, the meter is one of three (ai_chats, not ai_chat), source_ref is not empty (mutation: delete any one CHECK → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const ins = (meter: string, qty: number, ref: string): [string, unknown[]] => [
        "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,$2,$3,now(),$4)",
        [s.a, meter, qty, ref]];
      const result = await verdicts(c, {
        "the valid control": ins("voice_minutes", 3, "call:ctl"),
        "a zero quantity": ins("voice_minutes", 0, "call:zero"),
        "a negative quantity": ins("voice_minutes", -3, "call:neg"),
        "an unmetered channel": ins("email", 1, "email:1"),
        "the singular spelling ai_chat": ins("ai_chat", 1, "conversation:1"),
        "an empty source_ref": ins("sms", 1, ""),
      });
      expect(result).toEqual({
        "the valid control": undefined, "a zero quantity": "23514", "a negative quantity": "23514",
        "an unmetered channel": "23514", "the singular spelling ai_chat": "23514", "an empty source_ref": "23514",
      });
    }));

  it("usage_events: one source counts once per meter, even from another account: 23505 (mutation: add account_id to the unique key → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'sms',1,now(),$2)",
        [s.b, `message:${s.a}`],
      )).rejects.toMatchObject({ code: "23505" });
    }));

  it("usage_events: the same source on a DIFFERENT meter is allowed (mutation: unique on source_ref alone → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'voice_minutes',1,now(),$2)",
        [s.a, `message:${s.a}`],
      )).resolves.toMatchObject({ rowCount: 1 });
    }));

  it("a plan with billed accounts cannot be deleted: 23503 (mutation: on delete cascade → FAILS, and would silently unbill three accounts)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query("delete from plans where id = $1", [s.plan])).rejects.toMatchObject({ code: "23503" });
    }));

  it("a plan name is unique per agency: 23505 (mutation: drop plans_agency_name_key → FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(PLAN_SQL, planParams(s.agencyId, `Growth ${RUN}`)))
        .rejects.toMatchObject({ code: "23505" });
    }));
});

describe("0051 cascade, live (serviceDb under withTestAccount)", () => {
  it("deleting an account deletes its billing row and its usage rows (mutation: on delete restrict on either → teardown throws, FAILS)", async () => {
    const db = serviceDb();
    const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
    expect(agErr).toBeNull();
    const { data: plan, error: planErr } = await db.from("plans").insert({
      agency_id: (agency as { id: string }).id, name: `Cascade ${RUN}`, monthly_price_cents: 4900,
      features: FEATURES, allowances: ALLOWANCES, overage_cents: OVERAGE,
      stripe_product_id: "prod_t_cascade", stripe_price_ids: PRICE_IDS,
    }).select("id").single();
    expect(planErr).toBeNull();
    const planId = (plan as { id: string }).id;
    let accountId = "";
    try {
      await withTestAccount(async (tdb, id) => {
        accountId = id;
        expect((await tdb.from("account_billing").insert({ account_id: id, plan_id: planId })).error).toBeNull();
        expect((await tdb.from("usage_events").insert({
          account_id: id, meter: "sms", quantity: 1, occurred_at: new Date().toISOString(), source_ref: `message:cascade:${RUN}`,
        })).error).toBeNull();
      });
      expect(accountId).not.toBe("");
      for (const table of ["account_billing", "usage_events"]) {
        const { data, error } = await db.from(table).select("account_id").eq("account_id", accountId);
        expect(error).toBeNull();
        expect(data).toEqual([]);
      }
    } finally {
      await db.from("plans").delete().eq("id", planId);
    }
  });
});
```

Count: exists 4, grants 3 + 1 + 4×4 = 20, RLS reads 7, writes 6, constraints 7, cascade 1 = **45 tests**.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bis/db exec vitest run src/test/billing-schema.test.ts`
Expected: FAIL. The "exists" tests fail with `expected undefined to be 'plans'` (and the same for the other three tables). Every other test fails with `relation "plans" does not exist` (42P01) or similar. `packages/db/.env` must point at the CI project, and the suite refuses production by itself (`refuse-production.ts`).

- [ ] **Step 3: Write the migration**

Create `packages/db/supabase/migrations/0051_billing_core.sql` (ASCII only, no backslash anywhere):

```sql
-- 0051_billing_core.sql
-- Client billing, rollout step 1 of 4
-- (docs/superpowers/specs/2026-09-24-m7a-client-billing-design.md, sections 2 and 4).
--
-- Four tables. Nothing reads them yet except the agency Plans page
-- (/dashboard/plans), which writes `plans`. No account is billed, paused or
-- gated by this file: an account with NO account_billing row is "unbilled"
-- (spec section 2), and every account starts that way. This PR writes no
-- account_billing, usage_events or stripe_webhook_events row; steps 2-4 do.
--
-- WHO WRITES WHAT. Only service_role writes any of the four. The agency's
-- writes go through serviceDb() after requireAgency() (0046's
-- automation_settings pattern), so `authenticated` holds SELECT and nothing
-- else, and on stripe_webhook_events not even that. Reads:
--   plans                  the agency only (app.is_agency()).
--   account_billing        the agency, and a client its OWN row.
--   usage_events           the agency, and a client its OWN rows.
--   stripe_webhook_events  service_role only (no policy, no grant).
-- A client's "own" is app.current_account_id(), which is NULL while the
-- account's client access is switched off (0008), so a switched-off client
-- reads nothing here, as everywhere else.
--
-- GRANTS copy 0046: `revoke all`, then grant select. Supabase's default ACL
-- hands ALL (arwdDxtm on PG17, the m being MAINTAIN, which
-- information_schema.role_table_grants does not report) to every role on a
-- new table; an enumerated revoke leaves MAINTAIN behind.
--
-- MONEY is integer cents, USD only. Meter keys are ONE vocabulary across
-- allowances, overage_cents, stripe_price_ids and usage_events.meter:
-- voice_minutes, sms, ai_chats. (The spec's usage_events line spells the
-- last one ai_chat; every other line of it says ai_chats, and one spelling
-- is the point, so ai_chat is refused.)
--
-- DELETE BEHAVIOUR. account_billing and usage_events cascade with their
-- account (derived state about the account, 0046's reasoning), so they are
-- NOT on ACCOUNT_OWNED_TABLES; billing-schema.test.ts proves the cascade
-- live. A plan referenced by any account_billing row cannot be deleted
-- (restrict): plans are archived, never deleted, and a delete that silently
-- unbilled accounts would be the worst possible failure here.
--
-- ROLLBACK (nothing reads these outside the Plans page; Stripe objects the
-- page created stay in Stripe):
--   drop table public.stripe_webhook_events;
--   drop table public.usage_events;
--   drop table public.account_billing;
--   drop table public.plans;


-- plans: what a client pays each month, what it includes, what extra use
-- costs, and the Stripe objects that bill it. A row cannot exist without its
-- Stripe product and all four prices (NOT NULL + the shape CHECK): the Plans
-- page calls Stripe FIRST and writes the row once, so there is no half-made
-- plan for step 3 to assign. A price change adds new Stripe prices and
-- rewrites stripe_price_ids; subscriptions already on the old prices keep
-- them until they are moved (spec section 2).
--
-- The jsonb CHECKs are nested CASEs on purpose: CASE evaluates in order,
-- AND does not, so the ::numeric casts only ever see a jsonb number and a
-- bad value is a 23514, never a 22P02 cast error.
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id),
  name text not null
    constraint plans_name_check check (name = btrim(name) and char_length(name) between 1 and 60),
  monthly_price_cents integer not null
    constraint plans_monthly_price_cents_check check (monthly_price_cents between 50 and 1000000),
  currency text not null default 'usd'
    constraint plans_currency_check check (currency = 'usd'),
  features jsonb not null
    constraint plans_features_check check (
      case
        when jsonb_typeof(features) <> 'object' then false
        when not (features ?& array['voice_receptionist', 'web_concierge']) then false
        when (features - 'voice_receptionist' - 'web_concierge') <> '{}'::jsonb then false
        else jsonb_typeof(features -> 'voice_receptionist') = 'boolean'
         and jsonb_typeof(features -> 'web_concierge') = 'boolean'
      end),
  allowances jsonb not null
    constraint plans_allowances_check check (
      case
        when jsonb_typeof(allowances) <> 'object' then false
        when not (allowances ?& array['voice_minutes', 'sms', 'ai_chats']) then false
        when (allowances - 'voice_minutes' - 'sms' - 'ai_chats') <> '{}'::jsonb then false
        when jsonb_typeof(allowances -> 'voice_minutes') <> 'number'
          or jsonb_typeof(allowances -> 'sms') <> 'number'
          or jsonb_typeof(allowances -> 'ai_chats') <> 'number' then false
        else (allowances ->> 'voice_minutes')::numeric between 0 and 1000000
         and (allowances ->> 'sms')::numeric between 0 and 1000000
         and (allowances ->> 'ai_chats')::numeric between 0 and 1000000
         and (allowances ->> 'voice_minutes')::numeric % 1 = 0
         and (allowances ->> 'sms')::numeric % 1 = 0
         and (allowances ->> 'ai_chats')::numeric % 1 = 0
      end),
  overage_cents jsonb not null
    constraint plans_overage_cents_check check (
      case
        when jsonb_typeof(overage_cents) <> 'object' then false
        when not (overage_cents ?& array['voice_minutes', 'sms', 'ai_chats']) then false
        when (overage_cents - 'voice_minutes' - 'sms' - 'ai_chats') <> '{}'::jsonb then false
        when jsonb_typeof(overage_cents -> 'voice_minutes') <> 'number'
          or jsonb_typeof(overage_cents -> 'sms') <> 'number'
          or jsonb_typeof(overage_cents -> 'ai_chats') <> 'number' then false
        else (overage_cents ->> 'voice_minutes')::numeric between 0 and 10000
         and (overage_cents ->> 'sms')::numeric between 0 and 10000
         and (overage_cents ->> 'ai_chats')::numeric between 0 and 10000
         and (overage_cents ->> 'voice_minutes')::numeric % 1 = 0
         and (overage_cents ->> 'sms')::numeric % 1 = 0
         and (overage_cents ->> 'ai_chats')::numeric % 1 = 0
      end),
  stripe_product_id text not null
    constraint plans_stripe_product_id_check check (left(stripe_product_id, 5) = 'prod_'),
  stripe_price_ids jsonb not null
    constraint plans_stripe_price_ids_check check (
      case
        when jsonb_typeof(stripe_price_ids) <> 'object' then false
        when not (stripe_price_ids ?& array['base', 'voice_minutes', 'sms', 'ai_chats']) then false
        when (stripe_price_ids - 'base' - 'voice_minutes' - 'sms' - 'ai_chats') <> '{}'::jsonb then false
        when jsonb_typeof(stripe_price_ids -> 'base') <> 'string'
          or jsonb_typeof(stripe_price_ids -> 'voice_minutes') <> 'string'
          or jsonb_typeof(stripe_price_ids -> 'sms') <> 'string'
          or jsonb_typeof(stripe_price_ids -> 'ai_chats') <> 'string' then false
        else left(stripe_price_ids ->> 'base', 6) = 'price_'
         and left(stripe_price_ids ->> 'voice_minutes', 6) = 'price_'
         and left(stripe_price_ids ->> 'sms', 6) = 'price_'
         and left(stripe_price_ids ->> 'ai_chats', 6) = 'price_'
      end),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_agency_name_key unique (agency_id, name)
);

comment on table public.plans is
  'Client billing plans (agency-scoped). Every row carries its Stripe product and four prices (base + voice_minutes/sms/ai_chats metered, graduated: allowance free, then overage_cents per unit). Written only by service_role from the agency Plans page; read by the agency only. Archived, never deleted.';

alter table public.plans enable row level security;
create policy plans_agency_read on public.plans for select to authenticated
  using (app.is_agency());
revoke all on public.plans from anon, authenticated;
grant select on public.plans to authenticated;


-- account_billing: one row per BILLED account. No row = unbilled (never
-- paused, features unchanged). complimentary = on a plan with no Stripe
-- subscription, and never paused: the CHECK makes that a fact of the
-- schema, not a promise of the pause pass (spec section 6). The status list
-- is Stripe's full set, not the spec's six, so the webhook mirror (step 3)
-- can never be refused for a status Stripe really sends. The billing pause
-- (billing_paused_at) is separate from accounts.status = 'paused', so
-- lifting one never undoes the other (spec section 2).
create table public.account_billing (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  complimentary boolean not null default false,
  stripe_customer_id text unique
    constraint account_billing_customer_check check (stripe_customer_id is null or left(stripe_customer_id, 4) = 'cus_'),
  stripe_subscription_id text unique
    constraint account_billing_subscription_check check (stripe_subscription_id is null or left(stripe_subscription_id, 4) = 'sub_'),
  subscription_status text
    constraint account_billing_status_check check (subscription_status in (
      'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'unpaid', 'canceled', 'paused')),
  current_period_end timestamptz,
  past_due_since timestamptz,
  billing_paused_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_billing_complimentary_check
    check (not complimentary or (stripe_subscription_id is null and billing_paused_at is null)),
  constraint account_billing_status_needs_subscription_check
    check ((subscription_status is null) = (stripe_subscription_id is null))
);

comment on table public.account_billing is
  'One row per billed account (no row = unbilled). Mirrors the Stripe subscription (status, period end) and holds the non-payment pause, separate from accounts.status. Complimentary rows have no subscription and are never paused (CHECK). Agency reads all, a client its own; only service_role writes.';

-- The plan list's client count, and the restrict check on a plan delete.
create index account_billing_plan_idx on public.account_billing (plan_id);

alter table public.account_billing enable row level security;
create policy account_billing_tenant on public.account_billing for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
revoke all on public.account_billing from anon, authenticated;
grant select on public.account_billing to authenticated;


-- usage_events: BIS's own usage ledger (step 2 fills it). One source counts
-- once: unique (meter, source_ref), where source_ref is the call, message or
-- conversation id, all globally unique, so the key needs no account_id. A
-- voice call and a text may share nothing, but one call may be metered
-- only once as minutes.
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  meter text not null
    constraint usage_events_meter_check check (meter in ('voice_minutes', 'sms', 'ai_chats')),
  quantity integer not null
    constraint usage_events_quantity_check check (quantity > 0),
  occurred_at timestamptz not null,
  source_ref text not null
    constraint usage_events_source_ref_check check (char_length(source_ref) between 1 and 200),
  reported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_events_meter_source_ref_key unique (meter, source_ref)
);

comment on table public.usage_events is
  'Billable usage ledger: one row per billable fact (voice_minutes, sms segments, ai_chats), unique per (meter, source_ref). reported_at is set once Stripe has the meter event. Agency reads all, a client its own; only service_role writes.';

-- Month-to-date totals per account; the report pass's queue.
create index usage_events_account_occurred_idx on public.usage_events (account_id, occurred_at desc);
create index usage_events_unreported_idx on public.usage_events (created_at) where reported_at is null;

alter table public.usage_events enable row level security;
create policy usage_events_tenant on public.usage_events for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
revoke all on public.usage_events from anon, authenticated;
grant select on public.usage_events to authenticated;


-- stripe_webhook_events: each Stripe event id recorded once (step 3's
-- webhook). RLS on with NO policy, and no grant to anon or authenticated:
-- service_role only.
create table public.stripe_webhook_events (
  event_id text primary key
    constraint stripe_webhook_events_event_id_check check (left(event_id, 4) = 'evt_'),
  type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

comment on table public.stripe_webhook_events is
  'Stripe webhook events seen, one row per event id, so each is processed once. service_role only.';

alter table public.stripe_webhook_events enable row level security;
revoke all on public.stripe_webhook_events from anon, authenticated;
```

- [ ] **Step 4: Scan the file for the two transit traps**

Run: `LC_ALL=C grep -n '[^[:print:][:space:]]' packages/db/supabase/migrations/0051_billing_core.sql; grep -nF '\' packages/db/supabase/migrations/0051_billing_core.sql; echo scanned`
Expected: only `scanned`, meaning no non-ASCII byte and no backslash. (`grep -P` refuses to run under this machine's Git Bash locale, so it is not used.) The SQL block in this plan was scanned the same way when the plan was written: 0 hits.

- [ ] **Step 5: Do NOT apply. Commit.**

The test stays red until Checkpoint A pushes 0051 to the CI project. Implementers never apply.

```bash
git add packages/db/supabase/migrations/0051_billing_core.sql packages/db/src/test/billing-schema.test.ts
git commit -m "feat(db): 0051 billing tables (plans, account_billing, usage_events, stripe_webhook_events) with RLS and grants"
```

---

### Task 2: `billing.ts`, the only code that touches `plans`

**Files:**
- Create: `packages/db/src/billing.ts`
- Modify: `packages/db/src/index.ts` (append one export block at the end)
- Test: `packages/db/src/test/billing.test.ts`

**Interfaces:**
- Consumes: the 0051 tables (Task 1).
- Produces (used by Tasks 5, 7, 8, 9):
  - `METER_KEYS: readonly ["voice_minutes", "sms", "ai_chats"]`
  - `type MeterKey = "voice_minutes" | "sms" | "ai_chats"`
  - `type MeterAmounts = Record<MeterKey, number>`
  - `type PlanFeatures = { voice_receptionist: boolean; web_concierge: boolean }`
  - `type PlanPriceKey = "base" | MeterKey`
  - `type StripePriceIds = Record<PlanPriceKey, string>`
  - `type PlanTerms = { name: string; monthlyPriceCents: number; features: PlanFeatures; allowances: MeterAmounts; overageCents: MeterAmounts }`
  - `type Plan = PlanTerms & { id: string; agencyId: string; currency: "usd"; stripeProductId: string; stripePriceIds: StripePriceIds; archivedAt: string | null; createdAt: string; updatedAt: string }`
  - `type PlanWrite = { terms: PlanTerms; stripeProductId: string; stripePriceIds: StripePriceIds }`
  - `listPlans(db: SupabaseClient): Promise<Plan[]>`: active plans first, each group by name.
  - `getPlan(db, id: string): Promise<Plan | null>`
  - `insertPlan(db, input: { id: string } & PlanWrite): Promise<{ ok: true; plan: Plan } | { ok: false; reason: "name_taken" | "id_taken" }>`
  - `updatePlan(db, id: string, expectedUpdatedAt: string, input: PlanWrite): Promise<{ ok: true; plan: Plan } | { ok: false; reason: "stale" | "name_taken" }>`
  - `setPlanArchived(db, id: string, archived: boolean): Promise<boolean>`: true when a row changed.
  - `countBilledAccountsByPlan(db): Promise<Record<string, number>>`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/test/billing.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import {
  listPlans, getPlan, insertPlan, updatePlan, setPlanArchived, countBilledAccountsByPlan, type PlanWrite,
} from "../billing";

/**
 * billing.ts, live through serviceDb(). `plans` is AGENCY-scoped, so
 * withTestAccount gives these rows no isolation: every name is stamped with
 * this run's id (fixtures.ts's testBlueprintName reasoning) and every test
 * deletes the plans it made, in `finally`.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const planName = (label: string) => `${label} ${RUN}`;

function write(name: string, over: Partial<PlanWrite["terms"]> = {}): PlanWrite {
  return {
    terms: {
      name, monthlyPriceCents: 4900,
      features: { voice_receptionist: true, web_concierge: false },
      allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
      overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
      ...over,
    },
    stripeProductId: "prod_t_mod",
    stripePriceIds: { base: "price_t_b", voice_minutes: "price_t_v", sms: "price_t_s", ai_chats: "price_t_a" },
  };
}

async function withPlans(fn: (made: string[]) => Promise<void>): Promise<void> {
  const made: string[] = [];
  try { await fn(made); } finally {
    if (made.length) await serviceDb().from("plans").delete().in("id", made);
  }
}

async function mustInsert(made: string[], w: PlanWrite): Promise<string> {
  const id = randomUUID();
  const r = await insertPlan(serviceDb(), { id, ...w });
  if (!r.ok) throw new Error(`fixture insert refused: ${r.reason}`);
  made.push(id);
  return id;
}

describe("billing.ts plans, live", () => {
  it("insertPlan round-trips every field, each under its own name (mutation: map overageCents from allowances in toPlan → FAILS)", () =>
    withPlans(async (made) => {
      const w = write(planName("Roundtrip"), {
        monthlyPriceCents: 12345,
        features: { voice_receptionist: false, web_concierge: true },
        allowances: { voice_minutes: 1, sms: 2, ai_chats: 3 },
        overageCents: { voice_minutes: 4, sms: 5, ai_chats: 6 },
      });
      const id = await mustInsert(made, w);
      expect(await getPlan(serviceDb(), id)).toMatchObject({
        id, currency: "usd", archivedAt: null, ...w.terms,
        stripeProductId: w.stripeProductId, stripePriceIds: w.stripePriceIds,
      });
    }));

  it("insertPlan reports a taken name as name_taken, not a throw (mutation: drop the plans_agency_name_key branch → throws, FAILS)", () =>
    withPlans(async (made) => {
      await mustInsert(made, write(planName("Taken")));
      const r = await insertPlan(serviceDb(), { id: randomUUID(), ...write(planName("Taken")) });
      expect(r).toEqual({ ok: false, reason: "name_taken" });
    }));

  it("insertPlan reports a reused id as id_taken, the double-submit case (mutation: drop the plans_pkey branch → throws, FAILS)", () =>
    withPlans(async (made) => {
      const id = await mustInsert(made, write(planName("Once")));
      const r = await insertPlan(serviceDb(), { id, ...write(planName("Twice")) });
      expect(r).toEqual({ ok: false, reason: "id_taken" });
    }));

  it("updatePlan writes when updatedAt matches, then refuses that same stale updatedAt (mutation: drop .eq('updated_at') → second write lands, FAILS)", () =>
    withPlans(async (made) => {
      const id = await mustInsert(made, write(planName("Versioned")));
      const before = (await getPlan(serviceDb(), id))!;
      const first = await updatePlan(serviceDb(), id, before.updatedAt, write(planName("Versioned"), { monthlyPriceCents: 5900 }));
      expect(first.ok && first.plan.monthlyPriceCents).toBe(5900);
      const second = await updatePlan(serviceDb(), id, before.updatedAt, write(planName("Versioned"), { monthlyPriceCents: 6900 }));
      expect(second).toEqual({ ok: false, reason: "stale" });
      expect((await getPlan(serviceDb(), id))!.monthlyPriceCents).toBe(5900);
    }));

  it("updatePlan refuses an archived plan as stale (mutation: drop .is('archived_at', null) → FAILS)", () =>
    withPlans(async (made) => {
      const id = await mustInsert(made, write(planName("Shelved")));
      await setPlanArchived(serviceDb(), id, true);
      const current = (await getPlan(serviceDb(), id))!;
      const r = await updatePlan(serviceDb(), id, current.updatedAt, write(planName("Shelved"), { monthlyPriceCents: 9900 }));
      expect(r).toEqual({ ok: false, reason: "stale" });
    }));

  it("updatePlan reports a name another plan holds as name_taken (mutation: drop the unique-violation branch → throws, FAILS)", () =>
    withPlans(async (made) => {
      await mustInsert(made, write(planName("Holder")));
      const id = await mustInsert(made, write(planName("Mover")));
      const current = (await getPlan(serviceDb(), id))!;
      const r = await updatePlan(serviceDb(), id, current.updatedAt, write(planName("Holder")));
      expect(r).toEqual({ ok: false, reason: "name_taken" });
    }));

  it("setPlanArchived archives once then reports false; listPlans puts it after the active plans; restore clears it (mutation: drop the is-null filter → second archive returns true, FAILS)", () =>
    withPlans(async (made) => {
      const aId = await mustInsert(made, write(planName("A-archived")));
      const bId = await mustInsert(made, write(planName("B-active")));
      expect(await setPlanArchived(serviceDb(), aId, true)).toBe(true);
      expect(await setPlanArchived(serviceDb(), aId, true)).toBe(false);
      const ours = (await listPlans(serviceDb())).filter((p) => p.id === aId || p.id === bId);
      expect(ours.map((p) => [p.id, p.archivedAt === null])).toEqual([[bId, true], [aId, false]]);
      expect(await setPlanArchived(serviceDb(), aId, false)).toBe(true);
      expect((await getPlan(serviceDb(), aId))!.archivedAt).toBeNull();
    }));

  it("countBilledAccountsByPlan counts billing rows per plan (mutation: count 1 per plan instead of per row → FAILS)", () =>
    withPlans(async (made) => {
      const planId = await mustInsert(made, write(planName("Counted")));
      await withTestAccount(async (db, a) => {
        await withTestAccount(async (_db, b) => {
          for (const acct of [a, b]) {
            expect((await db.from("account_billing").insert({ account_id: acct, plan_id: planId })).error).toBeNull();
          }
          expect((await countBilledAccountsByPlan(serviceDb()))[planId]).toBe(2);
        });
      });
    }));
});
```

Count: **8 tests**.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bis/db exec vitest run src/test/billing.test.ts`
Expected: FAIL at import: `Failed to resolve import "../billing"` (the module does not exist yet).

- [ ] **Step 3: Write `billing.ts`**

Create `packages/db/src/billing.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Client billing plans (0051). The ONLY module that touches `plans`.
 *
 * Writes here need serviceDb(): 0051 grants `authenticated` SELECT on plans
 * and nothing more, so the caller is responsible for requireAgency() first
 * (the Plans page's actions do it on their first line).
 */

/** One vocabulary for every meter: allowances, overage, price ids and
 *  usage_events.meter (0051's CHECKs hold the database to it). */
export const METER_KEYS = ["voice_minutes", "sms", "ai_chats"] as const;
export type MeterKey = (typeof METER_KEYS)[number];
export type MeterAmounts = Record<MeterKey, number>;
export type PlanFeatures = { voice_receptionist: boolean; web_concierge: boolean };
export type PlanPriceKey = "base" | MeterKey;
export type StripePriceIds = Record<PlanPriceKey, string>;

/** What the agency types. Money in integer cents. */
export type PlanTerms = {
  name: string;
  monthlyPriceCents: number;
  features: PlanFeatures;
  allowances: MeterAmounts;
  overageCents: MeterAmounts;
};

export type Plan = PlanTerms & {
  id: string;
  agencyId: string;
  currency: "usd";
  stripeProductId: string;
  stripePriceIds: StripePriceIds;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Everything a save writes: the terms and the Stripe objects built for them. */
export type PlanWrite = { terms: PlanTerms; stripeProductId: string; stripePriceIds: StripePriceIds };

type PlanDbRow = {
  id: string; agency_id: string; name: string; monthly_price_cents: number; currency: "usd";
  features: PlanFeatures; allowances: MeterAmounts; overage_cents: MeterAmounts;
  stripe_product_id: string; stripe_price_ids: StripePriceIds;
  archived_at: string | null; created_at: string; updated_at: string;
};

const PLAN_COLUMNS =
  "id, agency_id, name, monthly_price_cents, currency, features, allowances, overage_cents, stripe_product_id, stripe_price_ids, archived_at, created_at, updated_at";

function toPlan(r: PlanDbRow): Plan {
  return {
    id: r.id, agencyId: r.agency_id, name: r.name, monthlyPriceCents: r.monthly_price_cents,
    currency: r.currency, features: r.features, allowances: r.allowances, overageCents: r.overage_cents,
    stripeProductId: r.stripe_product_id, stripePriceIds: r.stripe_price_ids,
    archivedAt: r.archived_at, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

function toColumns(w: PlanWrite) {
  return {
    name: w.terms.name, monthly_price_cents: w.terms.monthlyPriceCents, features: w.terms.features,
    allowances: w.terms.allowances, overage_cents: w.terms.overageCents,
    stripe_product_id: w.stripeProductId, stripe_price_ids: w.stripePriceIds,
  };
}

/** A 23505 on the name key vs on the primary key; anything else is not ours to name. */
function uniqueViolation(error: { code?: string; message: string }): "name_taken" | "id_taken" | null {
  if (error.code !== "23505") return null;
  if (error.message.includes("plans_agency_name_key")) return "name_taken";
  if (error.message.includes("plans_pkey")) return "id_taken";
  return null;
}

/** Every plan: active ones first, each group by name. */
export async function listPlans(db: SupabaseClient): Promise<Plan[]> {
  const { data, error } = await db.from("plans").select(PLAN_COLUMNS)
    .order("archived_at", { ascending: true, nullsFirst: true })
    .order("name", { ascending: true });
  if (error) throw new Error(`listPlans failed: ${error.message}`);
  return ((data ?? []) as PlanDbRow[]).map(toPlan);
}

export async function getPlan(db: SupabaseClient, id: string): Promise<Plan | null> {
  const { data, error } = await db.from("plans").select(PLAN_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`getPlan failed: ${error.message}`);
  return data ? toPlan(data as PlanDbRow) : null;
}

/**
 * Inserts under a CALLER-CHOSEN id (the dialog's draft id), so a retried
 * Save lands on the same row: a second insert of that id is `id_taken`,
 * which the action reports as success. The agency is BIS, row #1, exactly
 * as createAccount and captureBlueprint resolve it.
 */
export async function insertPlan(
  db: SupabaseClient, input: { id: string } & PlanWrite,
): Promise<{ ok: true; plan: Plan } | { ok: false; reason: "name_taken" | "id_taken" }> {
  const { data: agency, error: agErr } = await db.from("agencies").select("id").limit(1).single();
  if (agErr || !agency) throw new Error(`insertPlan: no agency row: ${agErr?.message ?? "none"}`);
  const { data, error } = await db.from("plans")
    .insert({ id: input.id, agency_id: (agency as { id: string }).id, ...toColumns(input) })
    .select(PLAN_COLUMNS).single();
  if (error) {
    const reason = uniqueViolation(error);
    if (reason) return { ok: false, reason };
    throw new Error(`insertPlan failed: ${error.message}`);
  }
  return { ok: true, plan: toPlan(data as PlanDbRow) };
}

/**
 * Optimistic: writes only while `updated_at` is still what the caller read
 * AND the plan is not archived. Anything else is `stale`: another tab saved,
 * archived, or restored it in between. The action checks this BEFORE calling
 * Stripe too; this is the check that closes the race after it.
 */
export async function updatePlan(
  db: SupabaseClient, id: string, expectedUpdatedAt: string, input: PlanWrite,
): Promise<{ ok: true; plan: Plan } | { ok: false; reason: "stale" | "name_taken" }> {
  const { data, error } = await db.from("plans")
    .update({ ...toColumns(input), updated_at: new Date().toISOString() })
    .eq("id", id).eq("updated_at", expectedUpdatedAt).is("archived_at", null)
    .select(PLAN_COLUMNS).maybeSingle();
  if (error) {
    if (uniqueViolation(error) === "name_taken") return { ok: false, reason: "name_taken" };
    throw new Error(`updatePlan failed: ${error.message}`);
  }
  if (!data) return { ok: false, reason: "stale" };
  return { ok: true, plan: toPlan(data as PlanDbRow) };
}

/** Archive (true) or restore (false). Returns whether a row actually changed,
 *  so a double archive or a restore of an active plan reports false. Bumps
 *  updated_at: an edit dialog opened before the archive is now stale. */
export async function setPlanArchived(db: SupabaseClient, id: string, archived: boolean): Promise<boolean> {
  const now = new Date().toISOString();
  const q = db.from("plans").update({ archived_at: archived ? now : null, updated_at: now }).eq("id", id);
  const { data, error } = await (archived ? q.is("archived_at", null) : q.not("archived_at", "is", null)).select("id");
  if (error) throw new Error(`setPlanArchived failed: ${error.message}`);
  return (data ?? []).length === 1;
}

/** Billed accounts per plan id (the Plans list's "N clients"). A plan with
 *  none is absent from the record. */
export async function countBilledAccountsByPlan(db: SupabaseClient): Promise<Record<string, number>> {
  const { data, error } = await db.from("account_billing").select("plan_id");
  if (error) throw new Error(`countBilledAccountsByPlan failed: ${error.message}`);
  const out: Record<string, number> = {};
  for (const r of (data ?? []) as { plan_id: string }[]) out[r.plan_id] = (out[r.plan_id] ?? 0) + 1;
  return out;
}
```

- [ ] **Step 4: Export it**

Append to the end of `packages/db/src/index.ts`:

```ts

// Client billing plans (0051) — the agency Plans page. See ./billing.ts.
export { METER_KEYS, listPlans, getPlan, insertPlan, updatePlan, setPlanArchived, countBilledAccountsByPlan,
         type MeterKey, type MeterAmounts, type PlanFeatures, type PlanPriceKey, type StripePriceIds,
         type PlanTerms, type Plan, type PlanWrite } from "./billing";
```

- [ ] **Step 5: Typecheck and confirm the tests are now red on the TABLE, not the import**

Run: `pnpm --filter @bis/db typecheck`
Expected: exit 0.

Run: `pnpm --filter @bis/db exec vitest run src/test/billing.test.ts`
Expected: FAIL with `relation "public.plans" does not exist` (or PostgREST `PGRST205 Could not find the table 'public.plans'`) until Checkpoint A.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/billing.ts packages/db/src/index.ts packages/db/src/test/billing.test.ts
git commit -m "feat(db): billing.ts plan accessors (insert under draft id, optimistic update, archive, counts)"
```

---

### Checkpoint A (ORCHESTRATOR ONLY, not an implementer step)

Runbook `docs/runbooks/ci-supabase-project.md` §6, steps 2–3, on this branch (`<branch>` = this PR's branch). 0051 only ADDS tables and changes no existing grant, so pushing it early turns no other branch's grant-pinning test red. Confirm that before pushing (`grep -rl "account_billing\|usage_events\|stripe_webhook_events\|public.plans" packages/db/src/test` on `main` should find nothing).

1. `gh workflow run ci-project-setup.yml --ref <branch> -f step=push-dry-run` → the run log lists exactly `0051_billing_core.sql`.
2. `gh workflow run ci-project-setup.yml --ref <branch> -f step=push`
3. Post-apply read (`ci:sql`, read-only file): the four tables exist, and `select relname, relacl from pg_class where relname in ('plans','account_billing','usage_events','stripe_webhook_events')` shows no `anon`, and `authenticated=r` only on the first three.
4. Locally, against the CI project: `pnpm --filter @bis/db exec vitest run src/test/billing-schema.test.ts src/test/billing.test.ts` → **53 passed**.
5. Reviewer mutation probes for the DB tests: DDL is transactional, so a probe is a TEMPORARY local edit that runs the mutation as the first statement inside the test's own `withRollback`. For example, `await c.query("drop policy account_billing_tenant on account_billing; create policy account_billing_tenant on account_billing for select to authenticated using (true)")` before `seed(c)`, or `grant insert on plans to authenticated`. Run the test, see it red, then revert the edit. The rollback leaves the CI project unchanged. Never commit a probe, and never run one outside `withRollback`.
6. Ledger line: `0051 APPLIED — CI odnobiodsftffphuuosz (db push) <date> — PROD pending (MCP, before merge) — NEVER RE-APPLY`.

---

### Task 3: CI target guard refuses a live Stripe key; the e2e job gets the test key

**Files:**
- Modify: `.github/scripts/ci-target-guard.sh` (header comment, and a new check 6 before the `if [ "$failed" -ne 0 ]` block)
- Modify: `apps/web/ci/ci-target-guard.test.ts` (`GUARD_VARS`, `VALID`, `secretsGiven`, a new describe block, the leak table)
- Modify: `.github/workflows/ci.yml` (the e2e job's `env:`)
- Modify: `apps/web/ci/ci-workflow.test.ts` (allowlist, a `jobEnv` helper, +1 test)
- Modify: `.env.example` (append a Stripe section)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: env var `STRIPE_SECRET_KEY` (read by Task 4's `billingGatewayFromEnv` and by Task 10's spec). The CI secret is named `CI_STRIPE_SECRET_KEY`.

- [ ] **Step 1: Write the failing guard tests**

In `apps/web/ci/ci-target-guard.test.ts`:

(a) After `const CLERK_PUBLISHABLE = "pk_test_UNIT_TEST_CLERK_PK_81aa";` add:

```ts
const STRIPE_TEST = "sk_test_UNIT_TEST_STRIPE_SECRET_5e6f";
const STRIPE_LIVE = "sk_live_UNIT_TEST_STRIPE_LIVE_77c1";
```

(b) Do **NOT** add the Stripe key to `GUARD_VARS`: two existing `it.each(GUARD_VARS)` tests ("refuses to run when %s is empty/unset") assert that every listed variable is REQUIRED, and the Stripe key is optional. Add a second list after the `type GuardVar` line instead:

```ts
/** Read by the guard but optional: absent is fine, present must be valid. */
const OPTIONAL_VARS = ["STRIPE_SECRET_KEY"] as const;
type OptionalVar = (typeof OPTIONAL_VARS)[number];
type AnyVar = GuardVar | OptionalVar;
```

(c) After the `VALID` object, add:

```ts
const VALID_OPTIONAL: Record<OptionalVar, string> = { STRIPE_SECRET_KEY: STRIPE_TEST };
```

(d) Widen `runGuard` and `secretsGiven` to both lists:
- In `secretsGiven`, change the parameter type to `merged: Partial<Record<AnyVar, string | undefined>>` and the returned array to:

```ts
  return [merged.SUPABASE_SERVICE_ROLE_KEY, merged.CLERK_SECRET_KEY, merged.STRIPE_SECRET_KEY, db, password].filter(
```

- In `runGuard`, change the first parameter to `overrides: Partial<Record<AnyVar, string | undefined>> = {},` and replace

```ts
  for (const name of GUARD_VARS) delete env[name];
  const merged = { ...VALID, ...overrides };
  for (const name of GUARD_VARS) {
```

with

```ts
  // Optional variables are stripped too, so an ambient Stripe key (a
  // developer's .env, CI's e2e job) can never leak into a case.
  for (const name of [...GUARD_VARS, ...OPTIONAL_VARS]) delete env[name];
  const merged: Partial<Record<AnyVar, string | undefined>> = { ...VALID, ...VALID_OPTIONAL, ...overrides };
  for (const name of [...GUARD_VARS, ...OPTIONAL_VARS]) {
```

- In the leak table's `it.each<[string, Partial<Record<GuardVar, string>>, ...]>` type, change `GuardVar` to `AnyVar`.

(e) Insert this describe block immediately before `describe("the guard reports, it does not stop at the first problem", () => {`:

```ts
describe("check 6: a Stripe key, when present, is a TEST-mode key", () => {
  it("passes with no Stripe key at all: only the e2e job carries one (mutation: add STRIPE_SECRET_KEY to check 1's presence loop → FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: undefined });
    expect(r.status).toBe(0);
  });

  it("passes with a restricted test key (rk_test_) (mutation: accept only sk_test_ → FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: "rk_test_UNIT_TEST_RESTRICTED_19ab" });
    expect(r.status).toBe(0);
  });

  it("refuses an sk_live_ key by name, as live, and never probes (mutation: delete check 6 → exit 0, FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: STRIPE_LIVE });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*STRIPE_SECRET_KEY.*live-mode/);
    expect(r.output).toContain("CI_STRIPE_SECRET_KEY");
    expect(r.curlCalled).toBe(false);
  });

  it("refuses an rk_live_ restricted live key (mutation: match only sk_live_ → falls to the generic refusal, loses 'live-mode', FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: "rk_live_UNIT_TEST_RESTRICTED_LIVE_3d" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*STRIPE_SECRET_KEY.*live-mode/);
  });

  it("refuses a value that is not a Stripe secret key (a publishable key in the wrong box) (mutation: drop the catch-all arm → exit 0, FAILS)", () => {
    const r = runGuard({ STRIPE_SECRET_KEY: "pk_test_UNIT_TEST_WRONG_BOX" });
    expect(r.status).toBe(1);
    expect(r.output).toMatch(/::error::.*STRIPE_SECRET_KEY.*not a Stripe test-mode secret key/);
  });
});
```

(f) In `describe("the guard never prints a secret value", ...)`: add `STRIPE_TEST, STRIPE_LIVE` to the `secrets` array, and add two rows to the `it.each` table after the `["sk_live_", ...]` row:

```ts
    ["stripe live key", { STRIPE_SECRET_KEY: STRIPE_LIVE }, {}],
    ["stripe wrong box", { STRIPE_SECRET_KEY: "pk_test_UNIT_TEST_WRONG_BOX" }, {}],
```

Result: 5 new tests + 2 new `it.each` cases.

- [ ] **Step 2: Run the guard tests to verify they fail**

Run: `pnpm --filter web exec vitest run ci/ci-target-guard.test.ts`
Expected: FAIL. The three refusal tests fail on `expected 0 to be 1` (and the Stripe-key leak rows pass vacuously until the check exists). The two passing tests already pass.

- [ ] **Step 3: Add check 6 to the guard**

In `.github/scripts/ci-target-guard.sh`:

(a) In the header's `# Reads` list, after the `CLERK_SECRET_KEY` line, add:

```bash
#   STRIPE_SECRET_KEY                  from secret CI_STRIPE_SECRET_KEY (e2e job only; OPTIONAL)
```

(b) In the header's `# Checks` list, after item 5, add:

```bash
#   6. STRIPE_SECRET_KEY, when set, is a Stripe TEST-mode secret key
#      (sk_test_ or rk_test_), never a live one. It is optional: only the e2e
#      job carries it, and the one spec that needs it skips itself loudly
#      without it. The guard never sends it anywhere.
```

(c) After `clerk_sk="${CLERK_SECRET_KEY:-}"` add:

```bash
stripe_key="${STRIPE_SECRET_KEY:-}"
```

(d) Immediately before `if [ "$failed" -ne 0 ]; then`, add:

```bash
# --- 6. Stripe test mode (optional) --------------------------------------------
# CI creates Stripe products and prices (e2e/plans.spec.ts). A live key would
# create them in the LIVE Stripe account, beside real customers' billing.
if [ -n "$stripe_key" ]; then
  case "$stripe_key" in
    sk_live_* | rk_live_*)
      fail "STRIPE_SECRET_KEY is a live-mode Stripe key. CI creates products and prices and must use a test-mode key (sk_test_). Put the Stripe TEST secret key in the repository secret CI_STRIPE_SECRET_KEY."
      ;;
    sk_test_* | rk_test_*) ;;
    *)
      fail "STRIPE_SECRET_KEY is not a Stripe test-mode secret key (sk_test_ or rk_test_). Put the Stripe TEST secret key in the repository secret CI_STRIPE_SECRET_KEY."
      ;;
  esac
fi
```

- [ ] **Step 4: Run the guard tests to verify they pass**

Run: `pnpm --filter web exec vitest run ci/ci-target-guard.test.ts`
Expected: PASS, every case including the leak table.

- [ ] **Step 5: Write the failing workflow test**

In `apps/web/ci/ci-workflow.test.ts`:

(a) After the `jobKeys` function, add:

```ts
/** `NAME: value` pairs in a job's OWN `env:` block (six columns in). */
function jobEnv(jobLines: string[]): Record<string, string> {
  const at = jobLines.findIndex((line) => /^ {4}env:\s*$/.test(line));
  if (at < 0) return {};
  const out: Record<string, string> = {};
  for (const line of jobLines.slice(at + 1)) {
    if (line.trim() !== "" && !/^ {6}/.test(line)) break;
    const m = /^ {6}([A-Za-z0-9_-]+): (.+)$/.exec(line);
    if (m?.[1] && m[2]) out[m[1]] = m[2].trim();
  }
  return out;
}
```

(b) In `it("reads secrets only by name, and only the five it needs", ...)`: rename it to `"reads secrets only by name, and only the six it needs"` and add `"CI_STRIPE_SECRET_KEY"` to the `allowed` set.

(c) After the `"maps the CI project's secrets onto the names the code reads"` test, add:

```ts
  it("hands the Stripe TEST key to the e2e job only, as STRIPE_SECRET_KEY (mutation: move it to the top-level env, or drop it → FAILS)", () => {
    expect(jobEnv(job("e2e")).STRIPE_SECRET_KEY).toBe("${{ secrets.CI_STRIPE_SECRET_KEY }}");
    expect(jobEnv(job("verify")).STRIPE_SECRET_KEY).toBeUndefined();
    expect(ciEnv.STRIPE_SECRET_KEY).toBeUndefined();
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run ci/ci-workflow.test.ts`
Expected: FAIL: `expected undefined to be '${{ secrets.CI_STRIPE_SECRET_KEY }}'`.

- [ ] **Step 7: Add the key to the e2e job**

In `.github/workflows/ci.yml`, in the `e2e` job, replace

```yaml
    env:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

with

```yaml
    env:
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
      # Stripe TEST mode only. e2e/plans.spec.ts creates a product and four
      # prices with it, and skips itself with a ::warning when it is unset.
      # The target guard (check 6) refuses a live key before any step runs.
      # Scoped to this job for the same reason as OPENAI_API_KEY above.
      STRIPE_SECRET_KEY: ${{ secrets.CI_STRIPE_SECRET_KEY }}
```

- [ ] **Step 8: Document the variable**

Append to `.env.example`:

```bash

# Stripe (client billing). The agency Plans page (/dashboard/plans) creates
# each plan's Stripe product and prices when it is saved. Use a TEST-mode key
# (sk_test_) everywhere except Vercel PRODUCTION, which alone holds the live
# key. The app refuses a live key unless VERCEL_ENV=production
# (apps/web/src/lib/billing/stripe-gateway.ts), and CI's target guard refuses
# one outright. Unset: the Plans page says Stripe isn't connected and saves
# nothing. CI reads it from the repository secret CI_STRIPE_SECRET_KEY (the
# e2e job only).
STRIPE_SECRET_KEY=
```

- [ ] **Step 9: Run both CI test files to verify they pass**

Run: `pnpm --filter web exec vitest run ci/`
Expected: PASS (both files).

- [ ] **Step 10: Commit**

```bash
git add .github/scripts/ci-target-guard.sh apps/web/ci/ci-target-guard.test.ts .github/workflows/ci.yml apps/web/ci/ci-workflow.test.ts .env.example
git commit -m "ci: guard refuses a live Stripe key; e2e job gets the Stripe test key (CI_STRIPE_SECRET_KEY)"
```

---

### Task 4: Stripe dependency and the `BillingGateway` seam

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml` (via pnpm)
- Create: `apps/web/src/lib/billing/stripe-gateway.ts`
- Create: `apps/web/src/lib/billing/fake-gateway.ts`
- Test: `apps/web/src/lib/billing/stripe-gateway.test.ts`

**Interfaces:**
- Consumes: `MeterKey` from `@bis/db` (Task 2).
- Produces (used by Tasks 5, 7, 9):
  - `STRIPE_API_VERSION = "2026-08-26.dahlia"`
  - `type StripeMeter = { id: string; eventName: string }`
  - `type BasePriceSpec = { kind: "base"; planId: string; productId: string; unitAmountCents: number }`
  - `type MeteredPriceSpec = { kind: "metered"; planId: string; productId: string; meter: MeterKey; meterId: string; allowance: number; overageCents: number }`
  - `type PriceSpec = BasePriceSpec | MeteredPriceSpec`
  - `interface BillingGateway { listActiveMeters(): Promise<StripeMeter[]>; createMeter(input: { eventName: string; displayName: string }, idempotencyKey: string): Promise<StripeMeter>; createProduct(input: { planId: string; name: string }, idempotencyKey: string): Promise<{ id: string }>; renameProduct(productId: string, name: string): Promise<void>; createPrice(spec: PriceSpec, idempotencyKey: string): Promise<{ id: string }> }`
  - `priceCreateParams(spec: PriceSpec): Stripe.PriceCreateParams`
  - `stripeGateway(stripe: Stripe): BillingGateway`
  - `type StripeKeyVerdict = { ok: true; key: string } | { ok: false; reason: "missing" | "live_key_outside_production" | "not_a_secret_key" }`
  - `stripeKeyVerdict(env: { STRIPE_SECRET_KEY?: string; VERCEL_ENV?: string }): StripeKeyVerdict`
  - `billingGatewayFromEnv(env?): { ok: true; gateway: BillingGateway } | { ok: false; reason: ... }`
  - `class FakeGateway implements BillingGateway` with public `meters: StripeMeter[]`, `calls: {op, key?, input?}[]`, `created: {op, input, id}[]`, `failOn: { op: GatewayOp; after?: number } | null`, and `type GatewayOp`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter web add stripe@^22.6.2`
Expected: `apps/web/package.json` gains `"stripe": "^22.6.2"` under `dependencies`, and `pnpm-lock.yaml` updates.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/billing/stripe-gateway.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import {
  billingGatewayFromEnv, priceCreateParams, stripeGateway, stripeKeyVerdict,
} from "./stripe-gateway";

/**
 * The seam between BIS and Stripe. The mapping to Stripe's parameters is
 * the money logic, so it is asserted as exact objects. The adapter is
 * driven through a stub Stripe client that records calls, so these tests
 * never touch the network. e2e/plans.spec.ts is the proof against real
 * Stripe test mode.
 */

function stubStripe(overrides: { hasMore?: boolean } = {}) {
  return {
    billing: {
      meters: {
        list: vi.fn(async () => ({
          data: [{ id: "mtr_sms", event_name: "bis_sms_segments" }], has_more: overrides.hasMore ?? false,
        })),
        create: vi.fn(async (p: { event_name: string }) => ({ id: "mtr_new", event_name: p.event_name })),
      },
    },
    products: {
      create: vi.fn(async () => ({ id: "prod_new" })),
      update: vi.fn(async () => ({ id: "prod_1" })),
    },
    prices: { create: vi.fn(async () => ({ id: "price_new" })) },
  };
}

const metered = (allowance: number) => ({
  kind: "metered" as const, planId: "plan_1", productId: "prod_1", meter: "sms" as const,
  meterId: "mtr_sms", allowance, overageCents: 3,
});

describe("priceCreateParams (the money mapping)", () => {
  it("base: a licensed monthly price in USD cents (mutation: usage_type 'metered' on the base → FAILS)", () => {
    expect(priceCreateParams({ kind: "base", planId: "plan_1", productId: "prod_1", unitAmountCents: 4900 })).toEqual({
      product: "prod_1", currency: "usd", unit_amount: 4900,
      recurring: { interval: "month", usage_type: "licensed" },
      metadata: { bis_plan_id: "plan_1", bis_price: "base" },
    });
  });

  it("metered with an allowance: GRADUATED tiers, the allowance free, then the overage per unit (mutation: tiers_mode 'volume' → FAILS; volume would bill every unit once past the allowance)", () => {
    expect(priceCreateParams(metered(1000))).toEqual({
      product: "prod_1", currency: "usd", billing_scheme: "tiered", tiers_mode: "graduated",
      tiers: [{ up_to: 1000, unit_amount: 0 }, { up_to: "inf", unit_amount: 3 }],
      recurring: { interval: "month", usage_type: "metered", meter: "mtr_sms" },
      metadata: { bis_plan_id: "plan_1", bis_price: "sms" },
    });
  });

  it("metered with a ZERO allowance: a plain per-unit price, no tiers (mutation: emit tiers with up_to 0 → FAILS; Stripe refuses a 0 tier, assumption A1)", () => {
    expect(priceCreateParams(metered(0))).toEqual({
      product: "prod_1", currency: "usd", unit_amount: 3,
      recurring: { interval: "month", usage_type: "metered", meter: "mtr_sms" },
      metadata: { bis_plan_id: "plan_1", bis_price: "sms" },
    });
  });
});

describe("stripeGateway (the adapter)", () => {
  it("createPrice sends the mapped params AND the idempotency key (mutation: drop the options argument → FAILS)", async () => {
    const s = stubStripe();
    const r = await stripeGateway(s as unknown as Stripe).createPrice(metered(1000), "key-price");
    expect(r).toEqual({ id: "price_new" });
    expect(s.prices.create).toHaveBeenCalledWith(priceCreateParams(metered(1000)), { idempotencyKey: "key-price" });
  });

  it("createProduct names the product and tags it with the plan id, under the idempotency key (mutation: drop metadata → FAILS)", async () => {
    const s = stubStripe();
    await stripeGateway(s as unknown as Stripe).createProduct({ planId: "plan_1", name: "Growth" }, "key-prod");
    expect(s.products.create).toHaveBeenCalledWith({ name: "Growth", metadata: { bis_plan_id: "plan_1" } }, { idempotencyKey: "key-prod" });
  });

  it("createMeter SUMS a value, maps customers by stripe_customer_id (mutation: formula 'count' → FAILS; count bills per event, not per minute)", async () => {
    const s = stubStripe();
    const m = await stripeGateway(s as unknown as Stripe).createMeter({ eventName: "bis_voice_minutes", displayName: "Voice minutes" }, "key-meter");
    expect(m).toEqual({ id: "mtr_new", eventName: "bis_voice_minutes" });
    expect(s.billing.meters.create).toHaveBeenCalledWith({
      display_name: "Voice minutes", event_name: "bis_voice_minutes",
      default_aggregation: { formula: "sum" },
      customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
      value_settings: { event_payload_key: "value" },
    }, { idempotencyKey: "key-meter" });
  });

  it("listActiveMeters asks for ACTIVE meters and maps event names (mutation: drop status → FAILS)", async () => {
    const s = stubStripe();
    expect(await stripeGateway(s as unknown as Stripe).listActiveMeters()).toEqual([{ id: "mtr_sms", eventName: "bis_sms_segments" }]);
    expect(s.billing.meters.list).toHaveBeenCalledWith({ status: "active", limit: 100 });
  });

  it("listActiveMeters refuses to guess past one page (mutation: ignore has_more → resolves, FAILS)", async () => {
    await expect(stripeGateway(stubStripe({ hasMore: true }) as unknown as Stripe).listActiveMeters())
      .rejects.toThrow(/more than 100 active meters/);
  });

  it("renameProduct changes the name and nothing else (mutation: send active:false too → FAILS)", async () => {
    const s = stubStripe();
    await stripeGateway(s as unknown as Stripe).renameProduct("prod_1", "Growth Plus");
    expect(s.products.update).toHaveBeenCalledWith("prod_1", { name: "Growth Plus" });
  });
});

describe("stripeKeyVerdict (a live key never runs outside production)", () => {
  it.each<[string, { STRIPE_SECRET_KEY?: string; VERCEL_ENV?: string }, ReturnType<typeof stripeKeyVerdict>]>([
    ["no key", {}, { ok: false, reason: "missing" }],
    ["a blank key", { STRIPE_SECRET_KEY: "   " }, { ok: false, reason: "missing" }],
    ["a test key on a preview", { STRIPE_SECRET_KEY: "sk_test_a", VERCEL_ENV: "preview" }, { ok: true, key: "sk_test_a" }],
    ["a restricted test key locally", { STRIPE_SECRET_KEY: "rk_test_b" }, { ok: true, key: "rk_test_b" }],
    ["a live key in production", { STRIPE_SECRET_KEY: "sk_live_c", VERCEL_ENV: "production" }, { ok: true, key: "sk_live_c" }],
    ["a live key on a preview", { STRIPE_SECRET_KEY: "sk_live_d", VERCEL_ENV: "preview" }, { ok: false, reason: "live_key_outside_production" }],
    ["a restricted live key locally", { STRIPE_SECRET_KEY: "rk_live_e" }, { ok: false, reason: "live_key_outside_production" }],
    ["a publishable key", { STRIPE_SECRET_KEY: "pk_test_f" }, { ok: false, reason: "not_a_secret_key" }],
    ["a webhook secret", { STRIPE_SECRET_KEY: "whsec_g" }, { ok: false, reason: "not_a_secret_key" }],
  ])("%s (mutation: drop the VERCEL_ENV comparison → the live-key rows FAIL)", (_label, env, expected) => {
    expect(stripeKeyVerdict(env)).toEqual(expected);
  });
});

describe("billingGatewayFromEnv", () => {
  it("reports why there is no gateway instead of constructing one (mutation: construct with an empty key → FAILS)", () => {
    expect(billingGatewayFromEnv({})).toEqual({ ok: false, reason: "missing" });
  });

  it("builds a working gateway from a test key, without any network call", () => {
    const g = billingGatewayFromEnv({ STRIPE_SECRET_KEY: "sk_test_UNIT" });
    expect(g.ok).toBe(true);
    expect(g.ok && typeof g.gateway.createPrice).toBe("function");
  });
});
```

Count: 3 + 6 + 9 (`it.each` rows) + 2 = **20 tests**.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/billing/stripe-gateway.test.ts`
Expected: FAIL: `Failed to resolve import "./stripe-gateway"`.

- [ ] **Step 4: Write the gateway**

Create `apps/web/src/lib/billing/stripe-gateway.ts`:

```ts
import Stripe from "stripe";
import type { MeterKey } from "@bis/db";

/**
 * Everything BIS asks of Stripe on the Plans page, behind one interface:
 * `stripeGateway()` in production code, `FakeGateway` (./fake-gateway.ts)
 * in unit tests. Nothing else in the app imports the `stripe` SDK.
 */

/** The API version stripe@22.6.2 is typed against. Pinned so a dashboard
 *  upgrade of the account's default version cannot change what these calls
 *  mean under us. Upgrade it together with the package, never alone. */
export const STRIPE_API_VERSION = "2026-08-26.dahlia";

export type StripeMeter = { id: string; eventName: string };

export type BasePriceSpec = { kind: "base"; planId: string; productId: string; unitAmountCents: number };
export type MeteredPriceSpec = {
  kind: "metered"; planId: string; productId: string; meter: MeterKey; meterId: string;
  allowance: number; overageCents: number;
};
export type PriceSpec = BasePriceSpec | MeteredPriceSpec;

export interface BillingGateway {
  listActiveMeters(): Promise<StripeMeter[]>;
  createMeter(input: { eventName: string; displayName: string }, idempotencyKey: string): Promise<StripeMeter>;
  createProduct(input: { planId: string; name: string }, idempotencyKey: string): Promise<{ id: string }>;
  renameProduct(productId: string, name: string): Promise<void>;
  createPrice(spec: PriceSpec, idempotencyKey: string): Promise<{ id: string }>;
}

/**
 * The money mapping. Base: a licensed monthly price. Metered: a monthly
 * price on the meter, GRADUATED so units up to the allowance cost 0 and every
 * unit after costs the overage (spec section 3.1). A zero allowance is a
 * plain per-unit price, because a tier cannot end at 0 (assumption A1).
 */
export function priceCreateParams(spec: PriceSpec): Stripe.PriceCreateParams {
  if (spec.kind === "base") {
    return {
      product: spec.productId, currency: "usd", unit_amount: spec.unitAmountCents,
      recurring: { interval: "month", usage_type: "licensed" },
      metadata: { bis_plan_id: spec.planId, bis_price: "base" },
    };
  }
  const recurring: Stripe.PriceCreateParams.Recurring = { interval: "month", usage_type: "metered", meter: spec.meterId };
  const metadata = { bis_plan_id: spec.planId, bis_price: spec.meter };
  if (spec.allowance === 0) {
    return { product: spec.productId, currency: "usd", unit_amount: spec.overageCents, recurring, metadata };
  }
  return {
    product: spec.productId, currency: "usd", billing_scheme: "tiered", tiers_mode: "graduated",
    tiers: [{ up_to: spec.allowance, unit_amount: 0 }, { up_to: "inf", unit_amount: spec.overageCents }],
    recurring, metadata,
  };
}

export function stripeGateway(stripe: Stripe): BillingGateway {
  return {
    async listActiveMeters() {
      const page = await stripe.billing.meters.list({ status: "active", limit: 100 });
      if (page.has_more) throw new Error("listActiveMeters: more than 100 active meters; refusing to guess which are ours");
      return page.data.map((m) => ({ id: m.id, eventName: m.event_name }));
    },
    async createMeter({ eventName, displayName }, idempotencyKey) {
      const m = await stripe.billing.meters.create({
        display_name: displayName, event_name: eventName,
        default_aggregation: { formula: "sum" },
        customer_mapping: { type: "by_id", event_payload_key: "stripe_customer_id" },
        value_settings: { event_payload_key: "value" },
      }, { idempotencyKey });
      return { id: m.id, eventName: m.event_name };
    },
    async createProduct({ planId, name }, idempotencyKey) {
      const p = await stripe.products.create({ name, metadata: { bis_plan_id: planId } }, { idempotencyKey });
      return { id: p.id };
    },
    async renameProduct(productId, name) {
      await stripe.products.update(productId, { name });
    },
    async createPrice(spec, idempotencyKey) {
      const p = await stripe.prices.create(priceCreateParams(spec), { idempotencyKey });
      return { id: p.id };
    },
  };
}

export type StripeKeyVerdict =
  | { ok: true; key: string }
  | { ok: false; reason: "missing" | "live_key_outside_production" | "not_a_secret_key" };

/**
 * A live key runs ONLY where VERCEL_ENV=production. Previews, local runs
 * and CI get test mode or nothing, the app-side twin of the CI guard's
 * check 6. A key that is not a secret key at all is named, not guessed at.
 */
export function stripeKeyVerdict(env: { STRIPE_SECRET_KEY?: string; VERCEL_ENV?: string }): StripeKeyVerdict {
  const key = (env.STRIPE_SECRET_KEY ?? "").trim();
  if (!key) return { ok: false, reason: "missing" };
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  const test = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  if (!live && !test) return { ok: false, reason: "not_a_secret_key" };
  if (live && env.VERCEL_ENV !== "production") return { ok: false, reason: "live_key_outside_production" };
  return { ok: true, key };
}

export function billingGatewayFromEnv(
  env: { STRIPE_SECRET_KEY?: string; VERCEL_ENV?: string } = process.env,
): { ok: true; gateway: BillingGateway } | Extract<StripeKeyVerdict, { ok: false }> {
  const verdict = stripeKeyVerdict(env);
  if (!verdict.ok) return verdict;
  const stripe = new Stripe(verdict.key, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 2, timeout: 20_000 });
  return { ok: true, gateway: stripeGateway(stripe) };
}
```

- [ ] **Step 5: Write the fake (used by Tasks 5 and 7)**

Create `apps/web/src/lib/billing/fake-gateway.ts`:

```ts
import type { BillingGateway, PriceSpec, StripeMeter } from "./stripe-gateway";

export type GatewayOp = "listActiveMeters" | "createMeter" | "createProduct" | "renameProduct" | "createPrice";

/**
 * In-memory Stripe for unit tests. It mirrors the ONE Stripe behaviour the
 * catalog depends on (assumption A4): a create sent with an idempotency key
 * seen before returns the FIRST result and creates nothing new.
 *
 *   calls    every call, replays included, in order
 *   created  only calls that made something new (id minted)
 *   failOn   throw on the (after + 1)th call of `op`, and every one after
 */
export class FakeGateway implements BillingGateway {
  meters: StripeMeter[] = [];
  readonly calls: Array<{ op: GatewayOp; key?: string; input?: unknown }> = [];
  readonly created: Array<{ op: GatewayOp; input: unknown; id: string }> = [];
  failOn: { op: GatewayOp; after?: number } | null = null;
  private seq = 0;
  private readonly replay = new Map<string, unknown>();
  private readonly counts = new Map<GatewayOp, number>();

  private step(op: GatewayOp, input?: unknown, key?: string): void {
    this.calls.push({ op, key, input });
    const n = (this.counts.get(op) ?? 0) + 1;
    this.counts.set(op, n);
    if (this.failOn && this.failOn.op === op && n > (this.failOn.after ?? 0)) {
      throw new Error(`fake Stripe refused ${op}`);
    }
  }

  private once<T extends { id: string }>(op: GatewayOp, key: string, input: unknown, make: (id: string) => T): T {
    const seen = this.replay.get(key);
    if (seen) return seen as T;
    const prefix = op === "createMeter" ? "mtr" : op === "createProduct" ? "prod" : "price";
    const value = make(`${prefix}_${++this.seq}`);
    this.replay.set(key, value);
    this.created.push({ op, input, id: value.id });
    return value;
  }

  async listActiveMeters(): Promise<StripeMeter[]> {
    this.step("listActiveMeters");
    return [...this.meters];
  }

  async createMeter(input: { eventName: string; displayName: string }, key: string): Promise<StripeMeter> {
    this.step("createMeter", input, key);
    return this.once("createMeter", key, input, (id) => {
      const m = { id, eventName: input.eventName };
      this.meters.push(m);
      return m;
    });
  }

  async createProduct(input: { planId: string; name: string }, key: string): Promise<{ id: string }> {
    this.step("createProduct", input, key);
    return this.once("createProduct", key, input, (id) => ({ id }));
  }

  async renameProduct(productId: string, name: string): Promise<void> {
    this.step("renameProduct", { productId, name });
  }

  async createPrice(spec: PriceSpec, key: string): Promise<{ id: string }> {
    this.step("createPrice", spec, key);
    return this.once("createPrice", key, spec, (id) => ({ id }));
  }
}
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `pnpm --filter web exec vitest run src/lib/billing/stripe-gateway.test.ts`
Expected: PASS (20).

Run: `pnpm --filter web typecheck`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/billing/stripe-gateway.ts apps/web/src/lib/billing/fake-gateway.ts apps/web/src/lib/billing/stripe-gateway.test.ts
git commit -m "feat(web): stripe@22.6.2 behind a BillingGateway seam; live key refused outside production"
```

---

### Task 5: `syncPlanToStripe`, which decides which Stripe objects a save needs

**Files:**
- Create: `apps/web/src/lib/billing/stripe-catalog.ts`
- Test: `apps/web/src/lib/billing/stripe-catalog.test.ts`

**Interfaces:**
- Consumes: `BillingGateway` (Task 4), `FakeGateway` (Task 4, tests), `METER_KEYS`, `MeterKey`, `PlanTerms`, `StripePriceIds` (Task 2).
- Produces (used by Task 7):
  - `METERS: Record<MeterKey, { eventName: string; displayName: string }>` with event names `bis_voice_minutes`, `bis_sms_segments` and `bis_ai_chats` (permanent, G9).
  - `ensureMeters(gateway: BillingGateway): Promise<Record<MeterKey, string>>`
  - `type StripeState = { terms: PlanTerms; productId: string; priceIds: StripePriceIds } | null`
  - `syncPlanToStripe(gateway: BillingGateway, planId: string, terms: PlanTerms, current: StripeState): Promise<{ productId: string; priceIds: StripePriceIds }>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/billing/stripe-catalog.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PlanTerms } from "@bis/db";
import { FakeGateway } from "./fake-gateway";
import { METERS, ensureMeters, syncPlanToStripe, type StripeState } from "./stripe-catalog";

const PLAN = "11111111-1111-4111-8111-111111111111";
const TERMS: PlanTerms = {
  name: "Growth", monthlyPriceCents: 4900,
  features: { voice_receptionist: true, web_concierge: false },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
};
const EXISTING_METERS = [
  { id: "mtr_vm", eventName: "bis_voice_minutes" },
  { id: "mtr_sms", eventName: "bis_sms_segments" },
  { id: "mtr_ai", eventName: "bis_ai_chats" },
];
const CURRENT: StripeState = {
  terms: TERMS, productId: "prod_existing",
  priceIds: { base: "price_base_old", voice_minutes: "price_vm_old", sms: "price_sms_old", ai_chats: "price_ai_old" },
};

function fake(withMeters = true): FakeGateway {
  const g = new FakeGateway();
  if (withMeters) g.meters = EXISTING_METERS.map((m) => ({ ...m }));
  return g;
}

const createdOps = (g: FakeGateway) => g.created.map((c) => c.op);

describe("ensureMeters", () => {
  it("creates the three meters under their permanent event names when Stripe has none (mutation: rename bis_sms_segments → FAILS; step 2 reports to these names)", async () => {
    const g = fake(false);
    const ids = await ensureMeters(g);
    expect(g.created.map((c) => (c.input as { eventName: string }).eventName))
      .toEqual(["bis_voice_minutes", "bis_sms_segments", "bis_ai_chats"]);
    expect(Object.keys(ids)).toEqual(["voice_minutes", "sms", "ai_chats"]);
    expect(METERS.sms.eventName).toBe("bis_sms_segments");
  });

  it("reuses active meters and creates none (mutation: always create → FAILS)", async () => {
    const g = fake();
    expect(await ensureMeters(g)).toEqual({ voice_minutes: "mtr_vm", sms: "mtr_sms", ai_chats: "mtr_ai" });
    expect(g.created).toEqual([]);
  });
});

describe("syncPlanToStripe", () => {
  it("a new plan: one product, one monthly price, three metered prices, each on its OWN meter (mutation: swap the sms and ai_chats meter ids → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, TERMS, null);
    expect(createdOps(g)).toEqual(["createProduct", "createPrice", "createPrice", "createPrice", "createPrice"]);
    const specs = g.created.filter((c) => c.op === "createPrice").map((c) => c.input);
    expect(specs).toEqual([
      { kind: "base", planId: PLAN, productId: r.productId, unitAmountCents: 4900 },
      { kind: "metered", planId: PLAN, productId: r.productId, meter: "voice_minutes", meterId: "mtr_vm", allowance: 500, overageCents: 12 },
      { kind: "metered", planId: PLAN, productId: r.productId, meter: "sms", meterId: "mtr_sms", allowance: 1000, overageCents: 3 },
      { kind: "metered", planId: PLAN, productId: r.productId, meter: "ai_chats", meterId: "mtr_ai", allowance: 200, overageCents: 25 },
    ]);
    expect(Object.keys(r.priceIds).sort()).toEqual(["ai_chats", "base", "sms", "voice_minutes"]);
  });

  it("a new plan's idempotency keys are the plan id plus exactly the terms each object is built from (mutation: drop the overage from the metered key → FAILS)", async () => {
    const g = fake();
    await syncPlanToStripe(g, PLAN, TERMS, null);
    expect(g.calls.filter((c) => c.key).map((c) => c.key)).toEqual([
      `bis-plan-${PLAN}-product`,
      `bis-plan-${PLAN}-base-4900`,
      `bis-plan-${PLAN}-voice_minutes-500-12`,
      `bis-plan-${PLAN}-sms-1000-3`,
      `bis-plan-${PLAN}-ai_chats-200-25`,
    ]);
  });

  it("re-saving unchanged terms creates nothing and keeps every id (mutation: drop the unchanged check → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, TERMS, CURRENT);
    expect(g.created).toEqual([]);
    expect(g.calls.some((c) => c.op === "renameProduct")).toBe(false);
    expect(r).toEqual({ productId: "prod_existing", priceIds: CURRENT!.priceIds });
  });

  it("a monthly price change creates exactly one new base price and keeps the three metered ones (mutation: compare allowances for the base → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, { ...TERMS, monthlyPriceCents: 5900 }, CURRENT);
    expect(createdOps(g)).toEqual(["createPrice"]);
    expect(r.priceIds).toEqual({ ...CURRENT!.priceIds, base: g.created[0]!.id });
  });

  it("an overage change on one meter creates exactly that meter's price (mutation: key the unchanged check on allowance only → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, { ...TERMS, overageCents: { ...TERMS.overageCents, sms: 4 } }, CURRENT);
    expect(createdOps(g)).toEqual(["createPrice"]);
    expect(r.priceIds).toEqual({ ...CURRENT!.priceIds, sms: g.created[0]!.id });
  });

  it("an allowance change on one meter creates exactly that meter's price (mutation: key the unchanged check on overage only → FAILS)", async () => {
    const g = fake();
    const r = await syncPlanToStripe(g, PLAN, { ...TERMS, allowances: { ...TERMS.allowances, voice_minutes: 800 } }, CURRENT);
    expect(createdOps(g)).toEqual(["createPrice"]);
    expect(r.priceIds).toEqual({ ...CURRENT!.priceIds, voice_minutes: g.created[0]!.id });
  });

  it("a rename renames the product and creates no price (mutation: skip the rename → FAILS; the invoice would show the old name)", async () => {
    const g = fake();
    await syncPlanToStripe(g, PLAN, { ...TERMS, name: "Growth Plus" }, CURRENT);
    expect(g.calls.filter((c) => c.op === "renameProduct").map((c) => c.input))
      .toEqual([{ productId: "prod_existing", name: "Growth Plus" }]);
    expect(g.created).toEqual([]);
  });

  it("a retried new plan with DIFFERENT terms never reuses an old price, while unchanged parts replay (mutation: drop the allowance from the metered key → FAILS)", async () => {
    const g = fake();
    const first = await syncPlanToStripe(g, PLAN, TERMS, null);
    const second = await syncPlanToStripe(g, PLAN, { ...TERMS, allowances: { ...TERMS.allowances, sms: 2000 } }, null);
    expect(second.productId).toBe(first.productId);
    expect(second.priceIds.base).toBe(first.priceIds.base);
    expect(second.priceIds.sms).not.toBe(first.priceIds.sms);
  });

  it("a Stripe failure part-way REJECTS, so the caller writes nothing (mutation: catch and return partial ids → resolves, FAILS)", async () => {
    const g = fake();
    g.failOn = { op: "createPrice", after: 2 };
    await expect(syncPlanToStripe(g, PLAN, TERMS, null)).rejects.toThrow(/fake Stripe refused createPrice/);
  });

  it("meters are ensured BEFORE any product or price exists (mutation: create the product first → a meter failure leaves a product, FAILS)", async () => {
    const g = fake(false);
    g.failOn = { op: "createMeter" };
    await expect(syncPlanToStripe(g, PLAN, TERMS, null)).rejects.toThrow(/createMeter/);
    expect(g.created).toEqual([]);
  });
});
```

Count: 2 + 10 = **12 tests**.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/billing/stripe-catalog.test.ts`
Expected: FAIL: `Failed to resolve import "./stripe-catalog"`.

- [ ] **Step 3: Write the catalog**

Create `apps/web/src/lib/billing/stripe-catalog.ts`:

```ts
import { METER_KEYS, type MeterKey, type PlanTerms, type StripePriceIds } from "@bis/db";
import type { BillingGateway } from "./stripe-gateway";

/**
 * The three Stripe Billing Meters every plan's metered prices hang off. ONE
 * set for the whole Stripe account, found by event name, never one set per
 * plan: usage is reported per CUSTOMER, and the customer's subscription
 * decides which price (and so which allowance) it lands on. The event
 * names are PERMANENT: step 2's usage reporter sends exactly these.
 */
export const METERS: Record<MeterKey, { eventName: string; displayName: string }> = {
  voice_minutes: { eventName: "bis_voice_minutes", displayName: "Voice minutes" },
  sms: { eventName: "bis_sms_segments", displayName: "Text message segments" },
  ai_chats: { eventName: "bis_ai_chats", displayName: "Website chat conversations" },
};

/** Every meter's id, creating any that is missing. The idempotency key is
 *  the event name, so two saves racing on a fresh account make one meter. */
export async function ensureMeters(gateway: BillingGateway): Promise<Record<MeterKey, string>> {
  const active = await gateway.listActiveMeters();
  const out = {} as Record<MeterKey, string>;
  for (const key of METER_KEYS) {
    const { eventName, displayName } = METERS[key];
    const found = active.find((m) => m.eventName === eventName);
    out[key] = found
      ? found.id
      : (await gateway.createMeter({ eventName, displayName }, `bis-meter-${eventName}`)).id;
  }
  return out;
}

/** What the plan's Stripe objects were built FROM: the stored row, or null for a new plan. */
export type StripeState = { terms: PlanTerms; productId: string; priceIds: StripePriceIds } | null;

/**
 * Makes Stripe match `terms` and returns the ids to store. Creates only
 * what changed:
 *   - the product once (new plan), renamed when the name changes;
 *   - a new base price when the monthly price changes;
 *   - a new metered price for a meter whose allowance OR overage changes.
 * Old prices are left as they are: subscriptions on them keep them until
 * moved (spec section 2; assumption A6).
 *
 * Idempotency keys are the plan id plus exactly the terms the object is
 * built from. A retry of the same save (a lost response, a double click)
 * therefore replays the objects already made instead of duplicating them,
 * and a retry with DIFFERENT terms can never be handed an old price.
 *
 * Throws on any Stripe failure. The caller writes the database only after
 * this resolves, so a failure leaves the database exactly as it was.
 */
export async function syncPlanToStripe(
  gateway: BillingGateway, planId: string, terms: PlanTerms, current: StripeState,
): Promise<{ productId: string; priceIds: StripePriceIds }> {
  const meterIds = await ensureMeters(gateway);

  const productId = current
    ? current.productId
    : (await gateway.createProduct({ planId, name: terms.name }, `bis-plan-${planId}-product`)).id;
  if (current && current.terms.name !== terms.name) await gateway.renameProduct(productId, terms.name);

  const base = current && current.terms.monthlyPriceCents === terms.monthlyPriceCents
    ? current.priceIds.base
    : (await gateway.createPrice(
        { kind: "base", planId, productId, unitAmountCents: terms.monthlyPriceCents },
        `bis-plan-${planId}-base-${terms.monthlyPriceCents}`,
      )).id;

  const priceIds: StripePriceIds = { base, voice_minutes: "", sms: "", ai_chats: "" };
  for (const meter of METER_KEYS) {
    const allowance = terms.allowances[meter];
    const overageCents = terms.overageCents[meter];
    const unchanged = current !== null
      && current.terms.allowances[meter] === allowance
      && current.terms.overageCents[meter] === overageCents;
    priceIds[meter] = unchanged
      ? current.priceIds[meter]
      : (await gateway.createPrice(
          { kind: "metered", planId, productId, meter, meterId: meterIds[meter], allowance, overageCents },
          `bis-plan-${planId}-${meter}-${allowance}-${overageCents}`,
        )).id;
  }
  return { productId, priceIds };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/billing/stripe-catalog.test.ts`
Expected: PASS (12).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/billing/stripe-catalog.ts apps/web/src/lib/billing/stripe-catalog.test.ts
git commit -m "feat(web): syncPlanToStripe creates only what a save changed, idempotently"
```

---

### Task 6: Plans copy and the plan form parser (dollars to integer cents)

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (insert the block below immediately before the closing `} as const;`)
- Create: `apps/web/src/lib/billing/plan-form.ts`
- Test: `apps/web/src/lib/billing/plan-form.test.ts`

**Interfaces:**
- Consumes: `METER_KEYS`, `MeterAmounts`, `PlanTerms` (Task 2).
- Produces (used by Tasks 7, 8, 9):
  - Message keys: every `plans.*` key below.
  - `PLAN_LIMITS = { nameMax: 60, monthlyMinCents: 50, monthlyMaxCents: 1_000_000, allowanceMax: 1_000_000, overageMaxCents: 10_000 }`
  - `parseDollarsToCents(raw: string): number | null`
  - `parseWholeNumber(raw: string): number | null`
  - `centsToDollars(cents: number): string` (`4900 → "49.00"`)
  - `formatCents(cents: number): string` (`104900 → "$1,049.00"`)
  - `parsePlanForm(form: FormData): { ok: true; terms: PlanTerms } | { ok: false; error: string }`
  - Form field names: `name`, `monthlyPrice`, `allowance.<meter>`, `overage.<meter>`, `feature.voice_receptionist`, `feature.web_concierge`.

- [ ] **Step 1: Add the copy**

In `apps/web/src/lib/messages.ts`, insert immediately before the final `} as const;`:

```ts
  // Agency Plans page (/dashboard/plans), client billing rollout step 1.
  // Agency-only screen (requireAgency); the env-var names in the
  // plans.stripe.* lines are for the operator who has to set them, the same
  // way numbers.routing.missingConfig names its own.
  "plans.title": "Plans",
  "plans.subtitle": "What clients pay each month, what's included, and what extra use costs.",
  "plans.new": "New plan",
  "plans.empty.title": "No plans yet",
  "plans.empty.body": "Create your first plan to start billing clients.",
  "plans.status.active": "Active",
  "plans.status.archived": "Archived",
  "plans.perMonth": "{price}/month",
  "plans.allowances": "{voice} minutes · {sms} texts · {chats} chats included",
  "plans.overage": "Extra: {voice}/minute · {sms}/text · {chats}/chat",
  "plans.feature.voice_receptionist": "Phone receptionist",
  "plans.feature.web_concierge": "Website chat assistant",
  "plans.features.none": "No phone or chat assistant",
  "plans.clients.none": "No clients on it yet",
  "plans.clients.one": "1 client",
  "plans.clients.many": "{count} clients",
  "plans.edit": "Edit",
  "plans.archive": "Archive",
  "plans.restore": "Restore",
  "plans.editLabel": "Edit {name}",
  "plans.archiveLabel": "Archive {name}",
  "plans.restoreLabel": "Restore {name}",
  "plans.dialog.createTitle": "New plan",
  "plans.dialog.editTitle": "Edit {name}",
  "plans.dialog.body": "Saving sets up this plan's prices in Stripe. Clients already on a plan keep their current prices until you move them.",
  "plans.field.name": "Plan name",
  "plans.field.monthlyPrice": "Monthly price (USD)",
  "plans.field.meters": "Included each month, and the price of each extra one",
  "plans.field.allowance.voice_minutes": "Phone minutes included",
  "plans.field.allowance.sms": "Texts included",
  "plans.field.allowance.ai_chats": "Website chats included",
  "plans.field.overage.voice_minutes": "Each extra phone minute (USD)",
  "plans.field.overage.sms": "Each extra text (USD)",
  "plans.field.overage.ai_chats": "Each extra website chat (USD)",
  "plans.field.features": "Premium features",
  "plans.save": "Save plan",
  "plans.saved": "Plan saved",
  "plans.archived.toast": "{name} archived — new clients can't be put on it",
  "plans.restored.toast": "{name} restored",
  "plans.error.nameRequired": "Give the plan a name.",
  "plans.error.nameTooLong": "Keep the name to 60 characters or fewer.",
  "plans.error.nameTaken": "Another plan already has that name.",
  "plans.error.monthlyPrice": "Enter a monthly price between $0.50 and $10,000.00.",
  "plans.error.allowance.voice_minutes": "Enter a whole number of phone minutes, up to 1,000,000.",
  "plans.error.allowance.sms": "Enter a whole number of texts, up to 1,000,000.",
  "plans.error.allowance.ai_chats": "Enter a whole number of website chats, up to 1,000,000.",
  "plans.error.overage.voice_minutes": "Enter a price for each extra phone minute, up to $100.00.",
  "plans.error.overage.sms": "Enter a price for each extra text, up to $100.00.",
  "plans.error.overage.ai_chats": "Enter a price for each extra website chat, up to $100.00.",
  "plans.error.stripeNotConnected": "Stripe isn't connected, so plans can't be saved yet.",
  "plans.error.stripeFailed": "Stripe didn't accept this plan, so nothing was saved. Try again in a minute.",
  "plans.error.saveFailed": "The plan couldn't be saved. Try again.",
  "plans.error.stale": "This plan was changed somewhere else. Reload the page and make your edit again.",
  "plans.error.archived": "This plan is archived. Restore it before editing.",
  "plans.error.notFound": "We couldn't find that plan — this page may be out of date.",
  "plans.error.reload": "This page is out of date. Reload it and try again.",
  "plans.stripe.missing": "Stripe isn't connected. Add STRIPE_SECRET_KEY to this deployment to create plans.",
  "plans.stripe.live_key_outside_production": "This deployment holds a live Stripe key but isn't production, so plans are switched off here. Use a test key (sk_test_).",
  "plans.stripe.not_a_secret_key": "STRIPE_SECRET_KEY isn't a Stripe secret key. It should start with sk_test_ (or sk_live_ in production).",
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/billing/plan-form.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import {
  centsToDollars, formatCents, parseDollarsToCents, parsePlanForm, parseWholeNumber,
} from "./plan-form";

function form(over: Record<string, string | null> = {}): FormData {
  const base: Record<string, string | null> = {
    name: "Growth", monthlyPrice: "49.00",
    "allowance.voice_minutes": "500", "overage.voice_minutes": "0.12",
    "allowance.sms": "1,000", "overage.sms": "0.03",
    "allowance.ai_chats": "200", "overage.ai_chats": "0.25",
    "feature.voice_receptionist": "on", "feature.web_concierge": null,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) fd.set(k, v);
  return fd;
}

describe("parseDollarsToCents (integer arithmetic, never floats)", () => {
  it.each<[string, number]>([
    ["49", 4900], ["49.5", 4950], ["49.50", 4950],
    // The float trap: 0.29 * 100 === 28.999999999999996.
    ["0.29", 29],
    ["$1,049.00", 104900], [" 12 ", 1200], ["0.03", 3],
  ])("%s → %i cents (mutation: Math.round(parseFloat(s) * 100) is fine here but Math.floor is not → the 0.29 row FAILS)", (raw, cents) => {
    expect(parseDollarsToCents(raw)).toBe(cents);
  });

  it.each(["", "abc", "-5", "1.234", "1e3", "12.", "12345678"])(
    "refuses %j (mutation: accept any Number(s) → FAILS)", (raw) => {
      expect(parseDollarsToCents(raw)).toBeNull();
    });
});

describe("parseWholeNumber", () => {
  it("accepts whole numbers with thousands commas and spaces", () => {
    expect([parseWholeNumber("0"), parseWholeNumber("1,000"), parseWholeNumber(" 500 ")]).toEqual([0, 1000, 500]);
  });

  it("refuses fractions, negatives, blanks and words (mutation: parseInt → '1.5' becomes 1, FAILS)", () => {
    expect([parseWholeNumber("1.5"), parseWholeNumber("-1"), parseWholeNumber(""), parseWholeNumber("abc")])
      .toEqual([null, null, null, null]);
  });
});

describe("centsToDollars / formatCents", () => {
  it("centsToDollars is the form's input value (mutation: drop the padStart → 3 cents reads 0.3, FAILS)", () => {
    expect([centsToDollars(4900), centsToDollars(3), centsToDollars(105)]).toEqual(["49.00", "0.03", "1.05"]);
  });

  it("formatCents is the display value with a dollar sign and thousands commas", () => {
    expect([formatCents(4900), formatCents(3), formatCents(104900)]).toEqual(["$49.00", "$0.03", "$1,049.00"]);
  });
});

describe("parsePlanForm", () => {
  it("parses a whole form into exact terms (mutation: swap allowance and overage for a meter → FAILS)", () => {
    expect(parsePlanForm(form())).toEqual({
      ok: true,
      terms: {
        name: "Growth", monthlyPriceCents: 4900,
        features: { voice_receptionist: true, web_concierge: false },
        allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
        overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
      },
    });
  });

  it("reads each feature box on its own (mutation: read the voice box for both → FAILS)", () => {
    const r = parsePlanForm(form({ "feature.voice_receptionist": null, "feature.web_concierge": "on" }));
    expect(r.ok && r.terms.features).toEqual({ voice_receptionist: false, web_concierge: true });
  });

  it("holds the same bounds the database does (mutation: < instead of <= on any bound → FAILS)", () => {
    const ok = (over: Record<string, string>) => parsePlanForm(form(over)).ok;
    expect([
      ok({ monthlyPrice: "0.50" }), ok({ monthlyPrice: "0.49" }),
      ok({ monthlyPrice: "10000.00" }), ok({ monthlyPrice: "10000.01" }),
      ok({ "overage.sms": "100.00" }), ok({ "overage.sms": "100.01" }),
      ok({ "allowance.sms": "1000000" }), ok({ "allowance.sms": "1000001" }),
      ok({ "allowance.sms": "0" }),
    ]).toEqual([true, false, true, false, true, false, true, false, true]);
  });

  it.each<[string, Record<string, string>, string]>([
    ["a blank name", { name: "   " }, m["plans.error.nameRequired"]],
    ["a 61-character name", { name: "x".repeat(61) }, m["plans.error.nameTooLong"]],
    ["a monthly price in words", { monthlyPrice: "forty" }, m["plans.error.monthlyPrice"]],
    ["a fractional text allowance", { "allowance.sms": "1.5" }, m["plans.error.allowance.sms"]],
    ["a chat overage over $100", { "overage.ai_chats": "150" }, m["plans.error.overage.ai_chats"]],
  ])("%s returns its own message (mutation: one generic message → FAILS)", (_label, over, error) => {
    expect(parsePlanForm(form(over))).toEqual({ ok: false, error });
  });
});
```

Count: 7 + 7 + 2 + 2 + 3 + 5 = **26 tests**.

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/billing/plan-form.test.ts`
Expected: FAIL: `Failed to resolve import "./plan-form"`.

- [ ] **Step 4: Write the parser**

Create `apps/web/src/lib/billing/plan-form.ts`:

```ts
import { METER_KEYS, type MeterAmounts, type PlanTerms } from "@bis/db";
import { m } from "@/lib/messages";

/**
 * The Plans dialog's form, parsed into integer cents. The bounds are
 * 0051's CHECKs, repeated so the operator gets a sentence instead of a
 * 23514; the database stays the authority.
 */
export const PLAN_LIMITS = {
  nameMax: 60,
  monthlyMinCents: 50,
  monthlyMaxCents: 1_000_000,
  allowanceMax: 1_000_000,
  overageMaxCents: 10_000,
} as const;

const DOLLARS = /^\d{1,7}(\.\d{1,2})?$/;
const WHOLE = /^\d{1,7}$/;

/** "49", "49.5", "$1,049.00" → cents, by integer arithmetic: parseFloat
 *  would turn "0.29" into 28.999... cents. */
export function parseDollarsToCents(raw: string): number | null {
  const s = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!DOLLARS.test(s)) return null;
  const [whole = "0", frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export function parseWholeNumber(raw: string): number | null {
  const s = raw.trim().replace(/,/g, "");
  return WHOLE.test(s) ? Number(s) : null;
}

/** The value an input shows: 4900 → "49.00", 3 → "0.03". */
export function centsToDollars(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

/** The value a reader sees: 104900 → "$1,049.00". */
export function formatCents(cents: number): string {
  return `$${Math.floor(cents / 100).toLocaleString("en-US")}.${String(cents % 100).padStart(2, "0")}`;
}

export type PlanFormResult = { ok: true; terms: PlanTerms } | { ok: false; error: string };

const fail = (error: string): PlanFormResult => ({ ok: false, error });
const text = (form: FormData, key: string) => String(form.get(key) ?? "");

export function parsePlanForm(form: FormData): PlanFormResult {
  const name = text(form, "name").trim();
  if (!name) return fail(m["plans.error.nameRequired"]);
  // Code points, as Postgres's char_length counts them, not UTF-16 units.
  if ([...name].length > PLAN_LIMITS.nameMax) return fail(m["plans.error.nameTooLong"]);

  const monthly = parseDollarsToCents(text(form, "monthlyPrice"));
  if (monthly === null || monthly < PLAN_LIMITS.monthlyMinCents || monthly > PLAN_LIMITS.monthlyMaxCents) {
    return fail(m["plans.error.monthlyPrice"]);
  }

  const allowances = {} as MeterAmounts;
  const overageCents = {} as MeterAmounts;
  for (const key of METER_KEYS) {
    const allowance = parseWholeNumber(text(form, `allowance.${key}`));
    if (allowance === null || allowance > PLAN_LIMITS.allowanceMax) return fail(m[`plans.error.allowance.${key}`]);
    const overage = parseDollarsToCents(text(form, `overage.${key}`));
    if (overage === null || overage > PLAN_LIMITS.overageMaxCents) return fail(m[`plans.error.overage.${key}`]);
    allowances[key] = allowance;
    overageCents[key] = overage;
  }

  return {
    ok: true,
    terms: {
      name, monthlyPriceCents: monthly,
      features: {
        voice_receptionist: form.get("feature.voice_receptionist") === "on",
        web_concierge: form.get("feature.web_concierge") === "on",
      },
      allowances, overageCents,
    },
  };
}
```

- [ ] **Step 5: Run the tests (and the catalogue's own guard)**

Run: `pnpm --filter web exec vitest run src/lib/billing/plan-form.test.ts src/lib/messages.test.ts`
Expected: PASS (26 + messages' existing tests, where no `plans.*` string names a milestone).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/src/lib/billing/plan-form.ts apps/web/src/lib/billing/plan-form.test.ts
git commit -m "feat(web): plans copy and form parser (dollars to integer cents, DB-matching bounds)"
```

---

### Task 7: Server actions (Stripe first, then one database write)

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/plans/actions.ts`
- Test: `apps/web/src/app/(dashboard)/dashboard/plans/actions.test.ts`

**Interfaces:**
- Consumes: `requireAgency` (`@/lib/auth`), `serviceDb`, `listPlans`, `getPlan`, `insertPlan`, `updatePlan`, `setPlanArchived`, `Plan` (Task 2), `billingGatewayFromEnv` (Task 4), `syncPlanToStripe` (Task 5), `parsePlanForm` (Task 6), `FakeGateway` (Task 4, tests).
- Produces (used by Task 9):
  - `type PlanActionResult = { ok: true } | { ok: false; error: string }`
  - `createPlanAction(draftId: string, formData: FormData): Promise<PlanActionResult>`
  - `updatePlanAction(planId: string, expectedUpdatedAt: string, formData: FormData): Promise<PlanActionResult>`
  - `archivePlanAction(planId: string): Promise<PlanActionResult>`
  - `restorePlanAction(planId: string): Promise<PlanActionResult>`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(dashboard)/dashboard/plans/actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Plan } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listPlans: vi.fn(),
  getPlan: vi.fn(),
  insertPlan: vi.fn(),
  updatePlan: vi.fn(),
  setPlanArchived: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({ tag: "service" }),
}));

/** requireAgency REDIRECTS (throws in Next) for a client, so the fixture
 *  throws too: that is what makes "the guard runs before anything" testable. */
const guard = vi.hoisted(() => ({ agency: true }));
vi.mock("@/lib/auth", () => ({
  requireAgency: async () => {
    if (!guard.agency) throw new Error("NEXT_REDIRECT");
    return { userId: "user_agency" };
  },
}));

const stripeState = vi.hoisted(() => ({ value: null as unknown }));
vi.mock("@/lib/billing/stripe-gateway", () => ({ billingGatewayFromEnv: () => stripeState.value }));

import { m } from "@/lib/messages";
import { FakeGateway } from "@/lib/billing/fake-gateway";
import { archivePlanAction, createPlanAction, restorePlanAction, updatePlanAction } from "./actions";

const DRAFT = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const VERSION = "2026-09-24T10:00:00.000+00:00";
const TERMS = {
  name: "Growth", monthlyPriceCents: 4900,
  features: { voice_receptionist: true, web_concierge: false },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
};
const OLD_IDS = { base: "price_base_old", voice_minutes: "price_vm_old", sms: "price_sms_old", ai_chats: "price_ai_old" };

const planRow = (over: Partial<Plan> = {}): Plan => ({
  id: PLAN_ID, agencyId: "agency_1", currency: "usd", ...TERMS,
  stripeProductId: "prod_existing", stripePriceIds: OLD_IDS,
  archivedAt: null, createdAt: VERSION, updatedAt: VERSION, ...over,
});

function form(over: Record<string, string | null> = {}): FormData {
  const base: Record<string, string | null> = {
    name: "Growth", monthlyPrice: "49.00",
    "allowance.voice_minutes": "500", "overage.voice_minutes": "0.12",
    "allowance.sms": "1000", "overage.sms": "0.03",
    "allowance.ai_chats": "200", "overage.ai_chats": "0.25",
    "feature.voice_receptionist": "on", "feature.web_concierge": null,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) fd.set(k, v);
  return fd;
}

let fake: FakeGateway;

beforeEach(() => {
  Object.values(dbMocks).forEach((fn) => fn.mockReset());
  guard.agency = true;
  fake = new FakeGateway();
  fake.meters = [
    { id: "mtr_vm", eventName: "bis_voice_minutes" },
    { id: "mtr_sms", eventName: "bis_sms_segments" },
    { id: "mtr_ai", eventName: "bis_ai_chats" },
  ];
  stripeState.value = { ok: true, gateway: fake };
  dbMocks.listPlans.mockResolvedValue([]);
  dbMocks.getPlan.mockResolvedValue(planRow());
  dbMocks.insertPlan.mockImplementation(async (_db, input) => ({ ok: true, plan: { ...planRow(), id: input.id } }));
  dbMocks.updatePlan.mockImplementation(async () => ({ ok: true, plan: planRow() }));
  dbMocks.setPlanArchived.mockResolvedValue(true);
});

const nothingTouched = () => {
  expect(fake.calls).toEqual([]);
  expect(dbMocks.listPlans).not.toHaveBeenCalled();
  expect(dbMocks.insertPlan).not.toHaveBeenCalled();
};

describe("createPlanAction", () => {
  it("a client is redirected before any read or Stripe call (mutation: move requireAgency below listPlans → FAILS)", async () => {
    guard.agency = false;
    await expect(createPlanAction(DRAFT, form())).rejects.toThrow("NEXT_REDIRECT");
    nothingTouched();
  });

  it("saves the plan under the draft id with the four Stripe prices Stripe returned (mutation: insert the old/empty ids → FAILS)", async () => {
    expect(await createPlanAction(DRAFT, form())).toEqual({ ok: true });
    const prices = fake.created.filter((c) => c.op === "createPrice").map((c) => c.id);
    const product = fake.created.find((c) => c.op === "createProduct")!.id;
    expect(dbMocks.insertPlan).toHaveBeenCalledWith({ tag: "service" }, {
      id: DRAFT, terms: TERMS, stripeProductId: product,
      stripePriceIds: { base: prices[0], voice_minutes: prices[1], sms: prices[2], ai_chats: prices[3] },
    });
  });

  it("a form error returns its message and touches neither Stripe nor the database (mutation: sync before parsing → FAILS)", async () => {
    expect(await createPlanAction(DRAFT, form({ monthlyPrice: "free" }))).toEqual({ ok: false, error: m["plans.error.monthlyPrice"] });
    nothingTouched();
  });

  it("Stripe not connected: says so and writes nothing (mutation: fall through with no gateway → throws, FAILS)", async () => {
    stripeState.value = { ok: false, reason: "missing" };
    expect(await createPlanAction(DRAFT, form())).toEqual({ ok: false, error: m["plans.error.stripeNotConnected"] });
    expect(dbMocks.insertPlan).not.toHaveBeenCalled();
  });

  it("a name another plan holds is refused BEFORE Stripe is called (mutation: drop the pre-check → Stripe objects are made, FAILS)", async () => {
    dbMocks.listPlans.mockResolvedValue([planRow({ id: PLAN_ID, name: "Growth" })]);
    expect(await createPlanAction(DRAFT, form())).toEqual({ ok: false, error: m["plans.error.nameTaken"] });
    expect(fake.calls).toEqual([]);
  });

  it("Stripe failing part-way returns the Stripe message and inserts nothing (mutation: insert before syncing → FAILS)", async () => {
    fake.failOn = { op: "createPrice", after: 1 };
    expect(await createPlanAction(DRAFT, form())).toEqual({ ok: false, error: m["plans.error.stripeFailed"] });
    expect(dbMocks.insertPlan).not.toHaveBeenCalled();
  });

  it("a double-submitted draft (id_taken) is reported as saved, not as an error (mutation: map id_taken to an error → FAILS)", async () => {
    dbMocks.insertPlan.mockResolvedValue({ ok: false, reason: "id_taken" });
    expect(await createPlanAction(DRAFT, form())).toEqual({ ok: true });
  });

  it("a draft id that is not a uuid is refused before anything runs (mutation: drop the UUID test → FAILS)", async () => {
    expect(await createPlanAction("not-a-uuid", form())).toEqual({ ok: false, error: m["plans.error.reload"] });
    nothingTouched();
  });
});

describe("updatePlanAction", () => {
  it("a client is redirected before any read (mutation: move requireAgency below getPlan → FAILS)", async () => {
    guard.agency = false;
    await expect(updatePlanAction(PLAN_ID, VERSION, form())).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.getPlan).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([]);
  });

  it("a stale version is refused BEFORE Stripe is called (mutation: drop the version pre-check → a new price is made, FAILS)", async () => {
    dbMocks.getPlan.mockResolvedValue(planRow({ updatedAt: "2026-09-24T11:00:00.000+00:00" }));
    expect(await updatePlanAction(PLAN_ID, VERSION, form({ monthlyPrice: "59" }))).toEqual({ ok: false, error: m["plans.error.stale"] });
    expect(fake.calls).toEqual([]);
    expect(dbMocks.updatePlan).not.toHaveBeenCalled();
  });

  it("an archived plan cannot be edited (mutation: drop the archived check → FAILS)", async () => {
    dbMocks.getPlan.mockResolvedValue(planRow({ archivedAt: VERSION }));
    expect(await updatePlanAction(PLAN_ID, VERSION, form())).toEqual({ ok: false, error: m["plans.error.archived"] });
    expect(fake.calls).toEqual([]);
  });

  it("a price change writes ONE new base price, keeps the three metered prices, and passes the version it checked (mutation: pass a fresh version → FAILS)", async () => {
    expect(await updatePlanAction(PLAN_ID, VERSION, form({ monthlyPrice: "59" }))).toEqual({ ok: true });
    const created = fake.created.filter((c) => c.op === "createPrice");
    expect(created).toHaveLength(1);
    expect(dbMocks.updatePlan).toHaveBeenCalledWith({ tag: "service" }, PLAN_ID, VERSION, {
      terms: { ...TERMS, monthlyPriceCents: 5900 }, stripeProductId: "prod_existing",
      stripePriceIds: { ...OLD_IDS, base: created[0]!.id },
    });
  });

  it("the database's own stale verdict (a race after the check) is reported (mutation: ignore updatePlan's result → FAILS)", async () => {
    dbMocks.updatePlan.mockResolvedValue({ ok: false, reason: "stale" });
    expect(await updatePlanAction(PLAN_ID, VERSION, form({ monthlyPrice: "59" }))).toEqual({ ok: false, error: m["plans.error.stale"] });
  });
});

describe("archivePlanAction / restorePlanAction", () => {
  it("archive sets archived and restore clears it (mutation: restore passes true → FAILS)", async () => {
    expect(await archivePlanAction(PLAN_ID)).toEqual({ ok: true });
    expect(await restorePlanAction(PLAN_ID)).toEqual({ ok: true });
    expect(dbMocks.setPlanArchived.mock.calls.map((c) => [c[1], c[2]])).toEqual([[PLAN_ID, true], [PLAN_ID, false]]);
  });

  it("a plan that was not there to change is reported, not claimed (mutation: ignore the boolean → FAILS)", async () => {
    dbMocks.setPlanArchived.mockResolvedValue(false);
    expect(await archivePlanAction(PLAN_ID)).toEqual({ ok: false, error: m["plans.error.notFound"] });
  });

  it("a client is redirected and nothing is written (mutation: drop requireAgency from archive → FAILS)", async () => {
    guard.agency = false;
    await expect(archivePlanAction(PLAN_ID)).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.setPlanArchived).not.toHaveBeenCalled();
  });
});
```

Count: 8 + 5 + 3 = **16 tests**.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/plans/actions.test.ts"`
Expected: FAIL: `Failed to resolve import "./actions"`.

- [ ] **Step 3: Write the actions**

Create `apps/web/src/app/(dashboard)/dashboard/plans/actions.ts`:

```ts
"use server";

/**
 * Writes from the agency Plans page (/dashboard/plans).
 *
 * Agency-only: `requireAgency()` is the FIRST line of every action, before
 * any parse, read or Stripe call. It redirects a client, which is the right
 * shape: there is no account in scope to soften the answer with.
 *
 * Writes go through serviceDb(): 0051 grants `authenticated` SELECT on
 * plans and nothing more, so an RLS-scoped write would fail for everyone,
 * agency included.
 *
 * ORDER, and why. Stripe FIRST, then ONE database write. If Stripe fails,
 * nothing is written and the row still describes the Stripe objects that
 * exist. If the database write fails after Stripe succeeded, the objects are
 * orphans in Stripe, and a retry replays them (syncPlanToStripe's
 * idempotency keys) rather than duplicating them. The reverse order would
 * leave a plan row pointing at prices that do not exist, which step 3 would
 * then try to subscribe a client to.
 *
 * No revalidatePath: the page is force-dynamic, and the islands call
 * router.refresh() (the numbers inventory's reasoning).
 */

import { serviceDb, listPlans, getPlan, insertPlan, updatePlan, setPlanArchived, type Plan } from "@bis/db";
import { requireAgency } from "@/lib/auth";
import { billingGatewayFromEnv } from "@/lib/billing/stripe-gateway";
import { syncPlanToStripe } from "@/lib/billing/stripe-catalog";
import { parsePlanForm } from "@/lib/billing/plan-form";
import { m } from "@/lib/messages";

export type PlanActionResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const fail = (error: string): PlanActionResult => ({ ok: false, error });

/**
 * `draftId` is minted by the dialog once per new plan and reused by every
 * retry of that dialog's Save. It becomes the row's id AND the prefix of
 * every Stripe idempotency key, so a double click or a retried request
 * lands on one plan, not two.
 */
export async function createPlanAction(draftId: string, formData: FormData): Promise<PlanActionResult> {
  await requireAgency();
  if (!UUID.test(draftId)) return fail(m["plans.error.reload"]);
  const parsed = parsePlanForm(formData);
  if (!parsed.ok) return fail(parsed.error);
  const stripe = billingGatewayFromEnv();
  if (!stripe.ok) {
    console.error(`createPlanAction: Stripe not usable (${stripe.reason})`);
    return fail(m["plans.error.stripeNotConnected"]);
  }

  const db = serviceDb();
  try {
    const plans = await listPlans(db);
    // Checked before Stripe, so a clash makes no Stripe objects. The draft's
    // own row (a retry after a save that did land) is not a clash.
    if (plans.some((p) => p.name === parsed.terms.name && p.id !== draftId)) return fail(m["plans.error.nameTaken"]);
  } catch (e) {
    console.error(`createPlanAction: plan read failed: ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }

  let synced;
  try {
    synced = await syncPlanToStripe(stripe.gateway, draftId, parsed.terms, null);
  } catch (e) {
    console.error(`createPlanAction: Stripe refused plan ${draftId}: ${String(e)}`);
    return fail(m["plans.error.stripeFailed"]);
  }

  try {
    const r = await insertPlan(db, {
      id: draftId, terms: parsed.terms, stripeProductId: synced.productId, stripePriceIds: synced.priceIds,
    });
    // id_taken: this draft was already saved by an earlier submit. That IS success.
    if (!r.ok && r.reason === "name_taken") return fail(m["plans.error.nameTaken"]);
  } catch (e) {
    console.error(`createPlanAction: insert failed for ${draftId} (Stripe objects exist, a retry replays them): ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }
  return { ok: true };
}

/**
 * `expectedUpdatedAt` is the version the dialog was opened on. It is checked
 * BEFORE Stripe (so a stale edit makes no prices) and again in the write
 * (updatePlan's optimistic filter closes the race after the check).
 */
export async function updatePlanAction(
  planId: string, expectedUpdatedAt: string, formData: FormData,
): Promise<PlanActionResult> {
  await requireAgency();
  if (!UUID.test(planId) || !expectedUpdatedAt) return fail(m["plans.error.reload"]);
  const parsed = parsePlanForm(formData);
  if (!parsed.ok) return fail(parsed.error);
  const stripe = billingGatewayFromEnv();
  if (!stripe.ok) {
    console.error(`updatePlanAction: Stripe not usable (${stripe.reason})`);
    return fail(m["plans.error.stripeNotConnected"]);
  }

  const db = serviceDb();
  let current: Plan | null;
  let plans: Plan[];
  try {
    [current, plans] = await Promise.all([getPlan(db, planId), listPlans(db)]);
  } catch (e) {
    console.error(`updatePlanAction: plan read failed for ${planId}: ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }
  if (!current) return fail(m["plans.error.notFound"]);
  if (current.archivedAt) return fail(m["plans.error.archived"]);
  if (current.updatedAt !== expectedUpdatedAt) return fail(m["plans.error.stale"]);
  if (plans.some((p) => p.id !== planId && p.name === parsed.terms.name)) return fail(m["plans.error.nameTaken"]);

  let synced;
  try {
    synced = await syncPlanToStripe(stripe.gateway, planId, parsed.terms, {
      terms: current, productId: current.stripeProductId, priceIds: current.stripePriceIds,
    });
  } catch (e) {
    console.error(`updatePlanAction: Stripe refused plan ${planId}: ${String(e)}`);
    return fail(m["plans.error.stripeFailed"]);
  }

  try {
    const r = await updatePlan(db, planId, expectedUpdatedAt, {
      terms: parsed.terms, stripeProductId: synced.productId, stripePriceIds: synced.priceIds,
    });
    if (!r.ok) return fail(r.reason === "stale" ? m["plans.error.stale"] : m["plans.error.nameTaken"]);
  } catch (e) {
    console.error(`updatePlanAction: update failed for ${planId}: ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }
  return { ok: true };
}

export async function archivePlanAction(planId: string): Promise<PlanActionResult> {
  await requireAgency();
  return setArchived(planId, true);
}

export async function restorePlanAction(planId: string): Promise<PlanActionResult> {
  await requireAgency();
  return setArchived(planId, false);
}

/** Archive is BIS-only (G7): it hides the plan from new assignments and
 *  touches nothing at Stripe, so it is reversible and runs immediately with
 *  an undo toast (DESIGN.md rule 6). */
async function setArchived(planId: string, archived: boolean): Promise<PlanActionResult> {
  if (!UUID.test(planId)) return fail(m["plans.error.reload"]);
  try {
    return (await setPlanArchived(serviceDb(), planId, archived)) ? { ok: true } : fail(m["plans.error.notFound"]);
  } catch (e) {
    console.error(`setArchived(${archived}) failed for ${planId}: ${String(e)}`);
    return fail(m["plans.error.saveFailed"]);
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/plans/actions.test.ts"`
Expected: PASS (16).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/plans/actions.ts" "apps/web/src/app/(dashboard)/dashboard/plans/actions.test.ts"
git commit -m "feat(web): plan actions — agency-gated, Stripe first then one write, draft-id idempotent"
```

---

### Task 8: Nav entry, ⌘K registration, sidebar icon, and the row view model

**Files:**
- Modify: `apps/web/src/lib/nav-groups.ts` (`NavIconKey` union; the agency top-level item list)
- Modify: `apps/web/src/lib/nav-groups.test.ts` (the exact-list test; +1 test)
- Modify: `apps/web/src/lib/palette/registry.ts` (`NAV_KEYWORDS`)
- Modify: `apps/web/src/lib/palette/registry.test.ts` (the "outside an account" test; +1 test)
- Modify: `apps/web/src/components/app-sidebar.tsx` (import `CreditCard`; `NAV_ICONS.plans`)
- Modify: `apps/web/src/lib/messages.ts` (`nav.plans`)
- Create: `apps/web/src/lib/billing/plan-rows.ts`
- Test: `apps/web/src/lib/billing/plan-rows.test.ts`

**Interfaces:**
- Consumes: `Plan` (Task 2), `formatCents` (Task 6), the `plans.*` messages (Task 6).
- Produces (used by Task 9):
  - `type PlanStatus = "active" | "archived"`
  - `type PlanRowView = { id: string; status: PlanStatus; price: string; allowances: string; overage: string; features: string; clients: string; plan: Plan }`
  - `planRowView(plan: Plan, clientCount: number): PlanRowView`
  - `PLAN_STATUS_TREATMENTS: Record<PlanStatus, { label: string; dot: string; chip: string }>`
  - Nav href `/dashboard/plans`, label key `nav.plans`, icon key `plans`.

- [ ] **Step 1: Write the failing tests**

(a) In `apps/web/src/lib/nav-groups.test.ts`, in `"returns one flat, unlabeled group at the agency top level (no base)"`, change the expected list to:

```ts
    expect(hrefs(groups)).toEqual([
      "/dashboard/accounts", "/dashboard/blueprints", "/dashboard/work", "/dashboard/numbers",
      "/dashboard/screened", "/dashboard/plans",
    ]);
```

and add after the `"offers the numbers inventory at the top level and nowhere inside an account"` test:

```ts
  it("offers Plans at the top level and nowhere inside an account (mutation: add it to an in-account group → FAILS)", () => {
    // Plans are agency-wide (0051: agency-scoped, agency-only RLS). A copy
    // inside one company's nav would say something false about its scope.
    expect(hrefs(buildNavGroups(null, true))).toContain("/dashboard/plans");
    for (const isAgency of [true, false]) {
      expect(hrefs(buildNavGroups(BASE, isAgency))).not.toContain("/dashboard/plans");
    }
  });
```

(b) In `apps/web/src/lib/palette/registry.test.ts`, in `"outside an account offers only the top-level destinations"`, add after the `/dashboard/numbers` line:

```ts
    expect(hrefs).toContain("/dashboard/plans");
```

and add a new test inside the same `describe`:

```ts
  it("finds Plans by the words an operator types for it (mutation: drop its NAV_KEYWORDS entry → FAILS)", () => {
    const entries = buildPaletteEntries(null, true);
    for (const word of ["billing", "pricing", "stripe"]) {
      expect(filterEntries(entries, word).map((e) => e.id)).toContain("nav:/dashboard/plans");
    }
  });
```

If `filterEntries` is not yet imported in that file, extend its existing import from `./registry` to include it.

(c) Create `apps/web/src/lib/billing/plan-rows.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Plan } from "@bis/db";
import { m } from "@/lib/messages";
import { PLAN_STATUS_TREATMENTS, planRowView } from "./plan-rows";

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: "plan_1", agencyId: "agency_1", currency: "usd", name: "Growth", monthlyPriceCents: 104900,
  features: { voice_receptionist: true, web_concierge: true },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
  stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt: null, createdAt: "2026-09-24T10:00:00Z", updatedAt: "2026-09-24T10:00:00Z", ...over,
});

describe("planRowView", () => {
  it("renders an active plan's price, allowances, overage and features as plain text (mutation: show sms overage in the voice slot → FAILS)", () => {
    const v = planRowView(plan(), 3);
    expect(v).toEqual({
      id: "plan_1", status: "active",
      price: "$1,049.00/month",
      allowances: "500 minutes · 1,000 texts · 200 chats included",
      overage: "Extra: $0.12/minute · $0.03/text · $0.25/chat",
      features: "Phone receptionist · Website chat assistant",
      clients: "3 clients",
      plan: plan(),
    });
  });

  it("an archived plan reads as archived, with its own dot and word (mutation: status from name → FAILS)", () => {
    const v = planRowView(plan({ archivedAt: "2026-09-24T11:00:00Z" }), 0);
    expect(v.status).toBe("archived");
    expect(PLAN_STATUS_TREATMENTS[v.status].label).toBe(m["plans.status.archived"]);
    expect(PLAN_STATUS_TREATMENTS.active.dot).not.toBe(PLAN_STATUS_TREATMENTS.archived.dot);
  });

  it("client counts read as words: none, one, many (mutation: '1 clients' → FAILS)", () => {
    expect([0, 1, 12].map((n) => planRowView(plan(), n).clients))
      .toEqual([m["plans.clients.none"], "1 client", "12 clients"]);
  });

  it("a plan with neither premium feature says so rather than showing a blank (mutation: join an empty list → FAILS)", () => {
    const v = planRowView(plan({ features: { voice_receptionist: false, web_concierge: false } }), 0);
    expect(v.features).toBe(m["plans.features.none"]);
  });
});
```

Count: plan-rows **4 tests**, plus nav +1 and palette +1.

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter web exec vitest run src/lib/nav-groups.test.ts src/lib/palette/registry.test.ts src/lib/billing/plan-rows.test.ts`
Expected: FAIL. The nav list mismatches (`/dashboard/plans` is missing), the palette `toContain("/dashboard/plans")` fails, and plan-rows cannot resolve `./plan-rows`.

- [ ] **Step 3: Implement**

(a) `apps/web/src/lib/messages.ts`: after `"nav.blueprints": "Blueprints",` add:

```ts
  "nav.plans": "Plans",
```

(b) `apps/web/src/lib/nav-groups.ts`: add `| "plans"` as the last member of `NavIconKey`. In the `base === null` branch, append after the `/dashboard/screened` item:

```ts
          // Client billing plans — /dashboard/plans, agency-only by
          // construction (requireAgency, first line of the page and of every
          // action) and unreadable by a client at the RLS level besides
          // (0051: plans_agency_read). Appended: "add a line, never reorder".
          { href: "/dashboard/plans", labelKey: "nav.plans", iconKey: "plans" },
```

(c) `apps/web/src/lib/palette/registry.ts`: in `NAV_KEYWORDS`, after the `/dashboard/screened` line add:

```ts
  "/dashboard/plans": ["billing", "pricing", "stripe", "subscription", "tier", "allowance", "overage"],
```

(d) `apps/web/src/components/app-sidebar.tsx`: add `CreditCard,` to the `lucide-react` import list, and in `NAV_ICONS` after `screened: ShieldAlert,` add:

```ts
  // `CreditCard`: the screen is what clients are charged, not a report.
  plans: CreditCard,
```

(e) Create `apps/web/src/lib/billing/plan-rows.ts`:

```ts
import type { Plan } from "@bis/db";
import { m } from "@/lib/messages";
import { formatCents } from "./plan-form";

export type PlanStatus = "active" | "archived";

export type PlanRowView = {
  id: string;
  status: PlanStatus;
  price: string;
  allowances: string;
  overage: string;
  features: string;
  clients: string;
  /** The row as stored, for the edit dialog's defaults and its version. */
  plan: Plan;
};

/** Dot + word (DESIGN.md rule 3). The same token classes the automation
 *  history's sent/skipped pills use (lib/automations/log-titles.ts). */
export const PLAN_STATUS_TREATMENTS: Record<PlanStatus, { label: string; dot: string; chip: string }> = {
  active: { label: m["plans.status.active"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  archived: { label: m["plans.status.archived"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
};

const count = (n: number) => n.toLocaleString("en-US");

/** One plan as the list shows it. Every number carries its unit (DESIGN.md
 *  rule 1): "$49.00/month", "500 minutes", "3 clients". */
export function planRowView(plan: Plan, clientCount: number): PlanRowView {
  const features = [
    plan.features.voice_receptionist ? m["plans.feature.voice_receptionist"] : null,
    plan.features.web_concierge ? m["plans.feature.web_concierge"] : null,
  ].filter((f): f is string => f !== null);
  return {
    id: plan.id,
    status: plan.archivedAt ? "archived" : "active",
    price: m["plans.perMonth"].replace("{price}", formatCents(plan.monthlyPriceCents)),
    allowances: m["plans.allowances"]
      .replace("{voice}", count(plan.allowances.voice_minutes))
      .replace("{sms}", count(plan.allowances.sms))
      .replace("{chats}", count(plan.allowances.ai_chats)),
    overage: m["plans.overage"]
      .replace("{voice}", formatCents(plan.overageCents.voice_minutes))
      .replace("{sms}", formatCents(plan.overageCents.sms))
      .replace("{chats}", formatCents(plan.overageCents.ai_chats)),
    features: features.length > 0 ? features.join(" · ") : m["plans.features.none"],
    clients: clientCount === 0 ? m["plans.clients.none"]
      : clientCount === 1 ? m["plans.clients.one"]
      : m["plans.clients.many"].replace("{count}", count(clientCount)),
    plan,
  };
}
```

- [ ] **Step 4: Run them to verify they pass**

Run: `pnpm --filter web exec vitest run src/lib/nav-groups.test.ts src/lib/palette/registry.test.ts src/lib/billing/plan-rows.test.ts`
Expected: PASS.

Run: `pnpm --filter web typecheck`
Expected: exit 0. `NAV_ICONS` is `Record<NavIconKey, LucideIcon>`, so a missing `plans` icon would be a type error, and that is the point.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/src/lib/nav-groups.ts apps/web/src/lib/nav-groups.test.ts apps/web/src/lib/palette/registry.ts apps/web/src/lib/palette/registry.test.ts apps/web/src/components/app-sidebar.tsx apps/web/src/lib/billing/plan-rows.ts apps/web/src/lib/billing/plan-rows.test.ts
git commit -m "feat(web): Plans in the agency nav and ⌘K; plan row view model"
```

---

### Task 9: The Plans page (loaded, empty, error, loading, and Stripe-not-connected)

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/plans/page.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/plans/loading.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/plans/plan-dialog.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/plans/plans-list.tsx`
- Test: `apps/web/src/app/(dashboard)/dashboard/plans/plans-list.test.ts`

**Interfaces:**
- Consumes: the actions and `PlanActionResult` (Task 7), `planRowView`, `PlanRowView`, `PLAN_STATUS_TREATMENTS` (Task 8), `centsToDollars` (Task 6), `stripeKeyVerdict` (Task 4), `listPlans`, `countBilledAccountsByPlan`, `METER_KEYS`, `Plan` (Task 2), existing `PageHeader`, `EmptyState`, `Notice`, `DotPill`, `ListPanel`/`LIST_ROW`, `Button`, `Dialog*`, `Input`, `Label`, `Checkbox`, `Skeleton`, `SubmitButton` (`../accounts/submit-button`), `useFormSubmit`.
- Produces: the page at `/dashboard/plans`. DOM hooks the e2e relies on: `[data-plan-row="<id>"]` per row; buttons named `m["plans.new"]`, `m["plans.editLabel"]`, `m["plans.archiveLabel"]` and `m["plans.restoreLabel"]` (with `{name}`), and `m["plans.save"]`; inputs labelled with the `plans.field.*` strings; checkboxes labelled with the `plans.feature.*` strings.

States (DESIGN.md rule 5, rule 7):
- **Loading:** `loading.tsx` shows skeletons shaped like the header and three rows.
- **Empty:** `EmptyState` with "Create your first plan to start billing clients." plus the New plan button as its action. The header then carries NO button, so the view keeps exactly one primary (rule 8).
- **Loaded:** header New plan (primary) plus the list. Row actions are ghost buttons. The dialog's Save is the dialog's one primary, and Cancel is ghost.
- **Error:** the reads are not swallowed. A failed `listPlans` reaches the existing `dashboard/error.tsx` boundary, the same decision the numbers inventory made for the reads that ARE the page.
- **Stripe not connected** (`stripeKeyVerdict` not ok): a `Notice tone="warn"` naming the fix. New plan and Edit are disabled. Archive and Restore still work because they never touch Stripe.

- [ ] **Step 1: Write the failing render test**

Create `apps/web/src/app/(dashboard)/dashboard/plans/plans-list.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Plan } from "@bis/db";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { m } from "@/lib/messages";
import { planRowView } from "@/lib/billing/plan-rows";
import { PlansList } from "./plans-list";

const plan = (id: string, name: string, archivedAt: string | null): Plan => ({
  id, agencyId: "agency_1", currency: "usd", name, monthlyPriceCents: 4900,
  features: { voice_receptionist: true, web_concierge: false },
  allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
  overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
  stripeProductId: "prod_1",
  stripePriceIds: { base: "price_b", voice_minutes: "price_v", sms: "price_s", ai_chats: "price_a" },
  archivedAt, createdAt: "2026-09-24T10:00:00Z", updatedAt: "2026-09-24T10:00:00Z",
});

const noop = async () => ({ ok: true as const });

function render(rows: Plan[], canEdit = true): string {
  return renderToStaticMarkup(createElement(PlansList, {
    rows: rows.map((p) => planRowView(p, 0)), canEdit, update: noop, archive: noop, restore: noop,
  }));
}

/** The markup of the <li> for one plan id. */
function rowHtml(html: string, id: string): string {
  const match = html.match(new RegExp(`<li[^>]*data-plan-row="${id}"[\\s\\S]*?</li>`));
  if (!match) throw new Error(`no row for ${id} in: ${html}`);
  return match[0];
}

describe("PlansList", () => {
  it("an active row shows its name, dot + word Active, price, and Edit and Archive (mutation: drop the DotPill → FAILS)", () => {
    const row = rowHtml(render([plan("p1", "Growth", null)]), "p1");
    expect(row).toContain("Growth");
    expect(row).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>Active/);
    expect(row).toContain("$49.00/month");
    expect(row).toContain(`aria-label="${m["plans.editLabel"].replace("{name}", "Growth")}"`);
    expect(row).toContain(`aria-label="${m["plans.archiveLabel"].replace("{name}", "Growth")}"`);
  });

  it("an archived row shows Archived and Restore, and NO Edit (mutation: render Edit for archived rows → FAILS)", () => {
    const row = rowHtml(render([plan("p2", "Legacy", "2026-09-24T11:00:00Z")]), "p2");
    expect(row).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>Archived/);
    expect(row).toContain(`aria-label="${m["plans.restoreLabel"].replace("{name}", "Legacy")}"`);
    expect(row).not.toContain(`aria-label="${m["plans.editLabel"].replace("{name}", "Legacy")}"`);
  });

  it("with Stripe not connected there is no Edit on any row, but Archive stays (mutation: ignore canEdit → FAILS)", () => {
    const row = rowHtml(render([plan("p3", "Starter", null)], false), "p3");
    expect(row).not.toContain(`aria-label="${m["plans.editLabel"].replace("{name}", "Starter")}"`);
    expect(row).toContain(`aria-label="${m["plans.archiveLabel"].replace("{name}", "Starter")}"`);
  });

  it("every row carries data-plan-row with its own id, the e2e's only handle (mutation: key rows by name → FAILS)", () => {
    const html = render([plan("p4", "A", null), plan("p5", "B", null)]);
    expect([...html.matchAll(/data-plan-row="([^"]+)"/g)].map((x) => x[1])).toEqual(["p4", "p5"]);
  });
});
```

Count: **4 tests**.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/plans/plans-list.test.ts"`
Expected: FAIL: `Failed to resolve import "./plans-list"`.

- [ ] **Step 3: Write the dialog**

Create `apps/web/src/app/(dashboard)/dashboard/plans/plan-dialog.tsx`:

```tsx
"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { METER_KEYS, type Plan } from "@bis/db";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../accounts/submit-button";
import { centsToDollars } from "@/lib/billing/plan-form";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import type { PlanActionResult } from "./actions";

const FEATURES = ["voice_receptionist", "web_concierge"] as const;

/**
 * The one form for a plan, new or edited. An overlay is its own view, so its
 * Save is that view's ONE primary (DESIGN.md rule 8) and Cancel is ghost.
 * onSubmit, never the `action` prop: a failed save must not reset what the
 * operator typed (useFormSubmit's own comment). It closes and refreshes only
 * on success.
 */
export function PlanDialog({
  title, trigger, plan, onSave,
}: {
  title: string;
  trigger: React.ReactNode;
  /** The stored plan when editing; omitted for a new one. */
  plan?: Plan;
  onSave: (formData: FormData) => Promise<PlanActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const id = useId();
  const field = (name: string) => `${id}-${name}`;

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    let result: PlanActionResult;
    try {
      result = await onSave(formData);
    } catch {
      toast.error(m["common.actionCrashed"]);
      return;
    }
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(m["plans.saved"]);
    setOpen(false);
    router.refresh();
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{m["plans.dialog.body"]}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor={field("name")}>{m["plans.field.name"]}</Label>
            <Input id={field("name")} name="name" required maxLength={60} defaultValue={plan?.name ?? ""} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={field("monthlyPrice")}>{m["plans.field.monthlyPrice"]}</Label>
            <Input
              id={field("monthlyPrice")} name="monthlyPrice" inputMode="decimal" className="tabular-nums"
              placeholder="49.00" defaultValue={plan ? centsToDollars(plan.monthlyPriceCents) : ""}
            />
          </div>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-sm font-medium text-card-foreground">{m["plans.field.meters"]}</legend>
            {METER_KEYS.map((key) => (
              <div key={key} className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={field(`allowance.${key}`)}>{m[`plans.field.allowance.${key}`]}</Label>
                  <Input
                    id={field(`allowance.${key}`)} name={`allowance.${key}`} inputMode="numeric" className="tabular-nums"
                    defaultValue={plan ? String(plan.allowances[key]) : "0"}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor={field(`overage.${key}`)}>{m[`plans.field.overage.${key}`]}</Label>
                  <Input
                    id={field(`overage.${key}`)} name={`overage.${key}`} inputMode="decimal" className="tabular-nums"
                    placeholder="0.10" defaultValue={plan ? centsToDollars(plan.overageCents[key]) : ""}
                  />
                </div>
              </div>
            ))}
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium text-card-foreground">{m["plans.field.features"]}</legend>
            {FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2">
                <Checkbox id={field(`feature.${f}`)} name={`feature.${f}`} defaultChecked={plan?.features[f] ?? false} />
                <Label htmlFor={field(`feature.${f}`)}>{m[`plans.feature.${f}`]}</Label>
              </div>
            ))}
          </fieldset>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="ghost">{m["common.cancel"]}</Button>
            </DialogClose>
            <SubmitButton pending={pending}>{m["plans.save"]}</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The page's ONE primary. It mints a draft id on the first Save of a new
 * plan and keeps it across failed retries, so every retry of this dialog's
 * Save lands on the same plan (the action's idempotency). The id is cleared
 * only after a success. It is minted in the event handler, not during render,
 * so the React Compiler purity lint has nothing to flag and SSR/hydration
 * never sees it.
 */
export function NewPlanButton({
  create, disabled,
}: {
  create: (draftId: string, formData: FormData) => Promise<PlanActionResult>;
  disabled: boolean;
}) {
  const draftId = useRef<string | null>(null);
  return (
    <PlanDialog
      title={m["plans.dialog.createTitle"]}
      trigger={<Button disabled={disabled}>{m["plans.new"]}</Button>}
      onSave={async (formData) => {
        draftId.current ??= crypto.randomUUID();
        const result = await create(draftId.current, formData);
        if (result.ok) draftId.current = null;
        return result;
      }}
    />
  );
}
```

- [ ] **Step 4: Write the list**

Create `apps/web/src/app/(dashboard)/dashboard/plans/plans-list.tsx`:

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DotPill } from "@/components/dot-pill";
import { Button } from "@/components/ui/button";
import { ListPanel, LIST_ROW } from "@/components/ui/list-panel";
import { PLAN_STATUS_TREATMENTS, type PlanRowView } from "@/lib/billing/plan-rows";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import type { PlanActionResult } from "./actions";
import { PlanDialog } from "./plan-dialog";

type Props = {
  rows: PlanRowView[];
  /** False while Stripe is not connected: an edit could not be saved. */
  canEdit: boolean;
  update: (planId: string, expectedUpdatedAt: string, formData: FormData) => Promise<PlanActionResult>;
  archive: (planId: string) => Promise<PlanActionResult>;
  restore: (planId: string) => Promise<PlanActionResult>;
};

export function PlansList({ rows, ...actions }: Props) {
  return (
    <ListPanel as="ul" aria-label={m["plans.title"]}>
      {rows.map((row) => <PlanRow key={row.id} row={row} {...actions} />)}
    </ListPanel>
  );
}

function PlanRow({ row, canEdit, update, archive, restore }: Omit<Props, "rows"> & { row: PlanRowView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const treatment = PLAN_STATUS_TREATMENTS[row.status];
  const name = row.plan.name;

  /** Reversible → immediate + undo toast (DESIGN.md rule 6). The undo runs
   *  inside the same transition, so the row's buttons stay disabled for it. */
  function run(first: (id: string) => Promise<PlanActionResult>, undo: (id: string) => Promise<PlanActionResult>, message: string) {
    startTransition(async () => {
      const result = await first(row.id);
      if (!result.ok) { toast.error(result.error); return; }
      router.refresh();
      toast.success(message, {
        action: {
          label: m["common.undo"],
          onClick: () => startTransition(async () => {
            const back = await undo(row.id);
            if (!back.ok) toast.error(back.error);
            else router.refresh();
          }),
        },
      });
    });
  }

  return (
    <li data-plan-row={row.id} className={cn("flex flex-wrap items-start gap-x-6 gap-y-3 px-4 py-3", LIST_ROW)}>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-card-foreground">{name}</span>
          <DotPill label={treatment.label} chip={treatment.chip} dot={treatment.dot} dense data-status={row.status} />
        </div>
        <p className="text-sm tabular-nums text-card-foreground">{row.price}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{row.allowances}</p>
        <p className="text-xs tabular-nums text-muted-foreground">{row.overage}</p>
        <p className="text-xs text-muted-foreground">{row.features} · {row.clients}</p>
      </div>
      <div className="flex items-center gap-1">
        {row.status === "active" && canEdit ? (
          <PlanDialog
            title={m["plans.dialog.editTitle"].replace("{name}", name)}
            plan={row.plan}
            trigger={
              <Button variant="ghost" size="sm" aria-label={m["plans.editLabel"].replace("{name}", name)}>
                {m["plans.edit"]}
              </Button>
            }
            onSave={(formData) => update(row.id, row.plan.updatedAt, formData)}
          />
        ) : null}
        {row.status === "active" ? (
          <Button
            variant="ghost" size="sm" disabled={pending}
            aria-label={m["plans.archiveLabel"].replace("{name}", name)}
            onClick={() => run(archive, restore, m["plans.archived.toast"].replace("{name}", name))}
          >
            {m["plans.archive"]}
          </Button>
        ) : (
          <Button
            variant="ghost" size="sm" disabled={pending}
            aria-label={m["plans.restoreLabel"].replace("{name}", name)}
            onClick={() => run(restore, archive, m["plans.restored.toast"].replace("{name}", name))}
          >
            {m["plans.restore"]}
          </Button>
        )}
      </div>
    </li>
  );
}
```

- [ ] **Step 5: Write the page and its skeleton**

Create `apps/web/src/app/(dashboard)/dashboard/plans/page.tsx`:

```tsx
// apps/web/src/app/(dashboard)/dashboard/plans/page.tsx
//
// The agency Plans page: what clients pay, what's included, what extra use
// costs. Client billing, rollout step 1. It has no effect on any account:
// nothing is assigned a plan until step 3.
//
// requireAgency() is the literal first line, before any read: the reads
// below are through serviceDb(), and such a read must never be ISSUED on a
// client's behalf. RLS would refuse a client anyway (0051: plans_agency_read).
import { CreditCard } from "lucide-react";
import { countBilledAccountsByPlan, listPlans, serviceDb } from "@bis/db";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Notice } from "@/components/ui/notice";
import { requireAgency } from "@/lib/auth";
import { planRowView } from "@/lib/billing/plan-rows";
import { stripeKeyVerdict } from "@/lib/billing/stripe-gateway";
import { m } from "@/lib/messages";
import { archivePlanAction, createPlanAction, restorePlanAction, updatePlanAction } from "./actions";
import { NewPlanButton } from "./plan-dialog";
import { PlansList } from "./plans-list";

export const dynamic = "force-dynamic";

export default async function PlansPage() {
  await requireAgency();

  const db = serviceDb();
  // Not swallowed: these two reads ARE the page. A failure reaches the
  // dashboard error boundary rather than rendering a list that is quietly
  // missing plans.
  const [plans, counts] = await Promise.all([listPlans(db), countBilledAccountsByPlan(db)]);
  const rows = plans.map((p) => planRowView(p, counts[p.id] ?? 0));

  // Only the key's SHAPE is read here, never Stripe itself: a Stripe outage
  // must not take the list down. A save still fails with its own message.
  const stripe = stripeKeyVerdict(process.env);
  const newPlan = <NewPlanButton create={createPlanAction} disabled={!stripe.ok} />;

  return (
    <>
      {/* One primary per view (rule 8): the header carries New plan only when
          the list does; when empty, the empty state carries it instead. */}
      <PageHeader title={m["plans.title"]} subtitle={m["plans.subtitle"]} actions={rows.length > 0 ? newPlan : undefined} />
      <div className="space-y-4 p-6">
        {!stripe.ok ? (
          <Notice tone="warn" className="text-foreground">{m[`plans.stripe.${stripe.reason}`]}</Notice>
        ) : null}
        {rows.length === 0 ? (
          <EmptyState icon={CreditCard} title={m["plans.empty.title"]} body={m["plans.empty.body"]} action={newPlan} />
        ) : (
          <PlansList
            rows={rows} canEdit={stripe.ok}
            update={updatePlanAction} archive={archivePlanAction} restore={restorePlanAction}
          />
        )}
      </div>
    </>
  );
}
```

Create `apps/web/src/app/(dashboard)/dashboard/plans/loading.tsx`:

```tsx
import { Skeleton } from "@/components/ui/skeleton";

/** Shaped like the real page (DESIGN.md rule 7, no spinners): the header,
 *  then plan rows, the same idiom as numbers/loading.tsx. */
export default function Loading() {
  return (
    <div className="p-6">
      <Skeleton className="mb-6 h-[76px] rounded-lg" />
      <div className="overflow-hidden rounded-xl border border-border" aria-busy="true" aria-label="Loading">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[108px] rounded-none" />)}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run the test, typecheck, lint**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/plans/plans-list.test.ts"`
Expected: PASS (4).

Run: `pnpm --filter web typecheck && pnpm --filter web lint`
Expected: exit 0 for both.

- [ ] **Step 7: Token audit (DESIGN.md DoD)**

Run: `grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|shadow-\[|rounded-\[[0-9]" "apps/web/src/app/(dashboard)/dashboard/plans/"*.tsx || echo CLEAN`
Expected: `CLEAN`.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/plans/"
git commit -m "feat(web): agency Plans page — list, new/edit dialog, archive with undo, Stripe-not-connected state"
```

---

### Task 10: e2e: the boundary, and a real Stripe test-mode round trip

**Files:**
- Create: `apps/web/e2e/plans.spec.ts`

**Interfaces:**
- Consumes: the page (Task 9), `serviceDb` from `@bis/db`, `m`, `stripe`, `STRIPE_SECRET_KEY`, and `e2e/.auth/client-state.json` plus `e2e/.auth/client-fixture.json` (written by `auth.setup.ts`).
- Produces: 2 tests. The second is the proof of assumptions A1–A3.

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/plans.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import Stripe from "stripe";
import { serviceDb } from "@bis/db";
import { m } from "../src/lib/messages";

// This file reads and writes `plans` directly from the Playwright runner
// (never through a Next.js request), with the same two dotenv lines
// numbers.spec.ts uses.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

// The agency Plans page (/dashboard/plans), client billing rollout step 1.
//
// A boundary test first, then the one thing only a real Stripe can prove:
// that Save leaves a product, a licensed monthly price and three GRADUATED
// metered prices on the right meters in Stripe TEST mode, and that an edit
// adds only the price that changed.
//
// `plans` is AGENCY-scoped: withTestAccount-style isolation does not exist
// for it. Every plan here carries this run's stamp and is deleted by the
// test that made it (its Stripe product is deactivated, since Stripe
// refuses to delete a product that has prices).
//
// STRIPE TEST MODE ONLY. CI's target guard refuses a live key before any
// step runs, and this file re-checks the prefix before its first call.
const STRIPE_KEY = (process.env.STRIPE_SECRET_KEY ?? "").trim();
const NO_STRIPE =
  "STRIPE_SECRET_KEY is not set, so the Stripe half of the Plans page was NOT tested. Add the Stripe TEST secret key (sk_test_) as the repository secret CI_STRIPE_SECRET_KEY, or to apps/web/.env.local locally.";
const RUN = Math.random().toString(36).slice(2, 8);
const PLAN_NAME = `E2E Plan ${RUN}`;

type PriceIds = Record<"base" | "voice_minutes" | "sms" | "ai_chats", string>;

test.describe("a client cannot reach the Plans page", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client lands on its own dashboard, and a plan's name never reaches its browser", async ({ page }) => {
    const fixture = JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as { accountId: string };
    // A canary plan written straight to the table (no Stripe needed: the
    // database checks only the ids' shape), so the leak check has something
    // to leak.
    const db = serviceDb();
    const { data: agency } = await db.from("agencies").select("id").limit(1).single();
    const canary = `E2E Canary ${RUN}`;
    const { data: row, error } = await db.from("plans").insert({
      agency_id: (agency as { id: string }).id, name: canary, monthly_price_cents: 4900,
      features: { voice_receptionist: false, web_concierge: false },
      allowances: { voice_minutes: 0, sms: 0, ai_chats: 0 },
      overage_cents: { voice_minutes: 0, sms: 0, ai_chats: 0 },
      stripe_product_id: "prod_e2e_canary",
      stripe_price_ids: { base: "price_e2e_b", voice_minutes: "price_e2e_v", sms: "price_e2e_s", ai_chats: "price_e2e_a" },
    }).select("id").single();
    expect(error).toBeNull();
    try {
      await page.goto("/dashboard/plans");
      await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${fixture.accountId}/dashboard(?:[/?]|$)`));
      await expect(page.getByText(canary)).toHaveCount(0);
    } finally {
      await db.from("plans").delete().eq("id", (row as { id: string }).id);
    }
  });
});

test.describe("the agency's plan becomes Stripe prices", () => {
  let planId: string | null = null;
  let productId: string | null = null;

  test.afterAll(async () => {
    if (planId) await serviceDb().from("plans").delete().eq("id", planId);
    if (productId && /^(sk|rk)_test_/.test(STRIPE_KEY)) {
      await new Stripe(STRIPE_KEY).products.update(productId, { active: false });
    }
  });

  test("Save makes a product, a monthly price and three graduated metered prices; an edit adds only the new price; archive undoes", async ({ page }) => {
    if (!STRIPE_KEY) console.warn(`::warning title=plans.spec.ts skipped::${NO_STRIPE}`);
    test.skip(!STRIPE_KEY, NO_STRIPE);
    expect(/^(sk|rk)_test_/.test(STRIPE_KEY), "plans.spec.ts runs on a Stripe TEST key only").toBe(true);
    test.setTimeout(120_000);
    const stripe = new Stripe(STRIPE_KEY);

    // --- Create through the UI --------------------------------------------
    await page.goto("/dashboard/plans");
    await page.getByRole("button", { name: m["plans.new"], exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(m["plans.field.name"]).fill(PLAN_NAME);
    await dialog.getByLabel(m["plans.field.monthlyPrice"]).fill("49");
    await dialog.getByLabel(m["plans.field.allowance.voice_minutes"]).fill("300");
    await dialog.getByLabel(m["plans.field.overage.voice_minutes"]).fill("0.12");
    await dialog.getByLabel(m["plans.field.allowance.sms"]).fill("1000");
    await dialog.getByLabel(m["plans.field.overage.sms"]).fill("0.03");
    await dialog.getByLabel(m["plans.field.allowance.ai_chats"]).fill("0");
    await dialog.getByLabel(m["plans.field.overage.ai_chats"]).fill("0.25");
    await dialog.getByLabel(m["plans.feature.voice_receptionist"]).check();
    await dialog.getByRole("button", { name: m["plans.save"] }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const row = page.locator("[data-plan-row]").filter({ hasText: PLAN_NAME });
    await expect(row).toContainText(m["plans.status.active"]);
    await expect(row).toContainText("$49.00/month");
    await expect(row).toContainText(m["plans.feature.voice_receptionist"]); // assumption A3
    await expect(row).not.toContainText(m["plans.feature.web_concierge"]);

    // --- The row, read back ------------------------------------------------
    const { data, error } = await serviceDb().from("plans")
      .select("id, monthly_price_cents, features, allowances, overage_cents, stripe_product_id, stripe_price_ids")
      .eq("name", PLAN_NAME).single();
    expect(error).toBeNull();
    planId = (data as { id: string }).id;
    productId = (data as { stripe_product_id: string }).stripe_product_id;
    expect(data).toMatchObject({
      monthly_price_cents: 4900,
      features: { voice_receptionist: true, web_concierge: false },
      allowances: { voice_minutes: 300, sms: 1000, ai_chats: 0 },
      overage_cents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
    });
    const ids = (data as { stripe_price_ids: PriceIds }).stripe_price_ids;

    // --- Stripe, read back -------------------------------------------------
    expect((await stripe.products.retrieve(productId)).metadata.bis_plan_id).toBe(planId);
    const base = await stripe.prices.retrieve(ids.base);
    expect([base.product, base.unit_amount, base.currency, base.recurring?.interval, base.recurring?.usage_type])
      .toEqual([productId, 4900, "usd", "month", "licensed"]);

    for (const [key, allowance, overage, eventName] of [
      ["voice_minutes", 300, 12, "bis_voice_minutes"],
      ["sms", 1000, 3, "bis_sms_segments"],
    ] as const) {
      const price = await stripe.prices.retrieve(ids[key], { expand: ["tiers"] }); // assumption A2
      expect([price.billing_scheme, price.tiers_mode, price.recurring?.usage_type]).toEqual(["tiered", "graduated", "metered"]);
      expect(price.tiers?.map((t) => [t.up_to, t.unit_amount])).toEqual([[allowance, 0], [null, overage]]); // assumption A1
      expect((await stripe.billing.meters.retrieve(price.recurring!.meter!)).event_name).toBe(eventName);
    }
    const chats = await stripe.prices.retrieve(ids.ai_chats);
    expect([chats.billing_scheme, chats.unit_amount, chats.recurring?.usage_type]).toEqual(["per_unit", 25, "metered"]);
    expect((await stripe.billing.meters.retrieve(chats.recurring!.meter!)).event_name).toBe("bis_ai_chats");

    // --- Edit the monthly price only ---------------------------------------
    await row.getByRole("button", { name: m["plans.editLabel"].replace("{name}", PLAN_NAME) }).click();
    const edit = page.getByRole("dialog");
    await edit.getByLabel(m["plans.field.monthlyPrice"]).fill("59");
    await edit.getByRole("button", { name: m["plans.save"] }).click();
    await expect(edit).toBeHidden({ timeout: 30_000 });
    await expect(row).toContainText("$59.00/month");
    const { data: after } = await serviceDb().from("plans").select("stripe_product_id, stripe_price_ids").eq("id", planId).single();
    const afterIds = (after as { stripe_price_ids: PriceIds }).stripe_price_ids;
    expect((after as { stripe_product_id: string }).stripe_product_id).toBe(productId);
    expect(afterIds.base).not.toBe(ids.base);
    expect([afterIds.voice_minutes, afterIds.sms, afterIds.ai_chats]).toEqual([ids.voice_minutes, ids.sms, ids.ai_chats]);
    expect((await stripe.prices.retrieve(afterIds.base)).unit_amount).toBe(5900);

    // --- Archive, then Undo (DESIGN.md rule 6) -----------------------------
    await row.getByRole("button", { name: m["plans.archiveLabel"].replace("{name}", PLAN_NAME) }).click();
    await expect(row).toContainText(m["plans.status.archived"]);
    await page.getByRole("button", { name: m["common.undo"] }).click();
    await expect(row).toContainText(m["plans.status.active"]);
  });
});
```

Count: **2 tests**.

- [ ] **Step 2: Run the spec**

Precondition: Checkpoint A is done (0051 is on the CI project), and `apps/web/.env.local` names the CI project and holds a Stripe TEST key. Only one gate process may run at a time: no other `playwright`/`next build` may be running, because the e2e gate needs about 2.5 GB.

Run: `pnpm --filter web exec playwright test e2e/plans.spec.ts`
Expected: `2 passed` (plus the setup/teardown projects). Without a Stripe key: `1 passed, 1 skipped`, with the `NO_STRIPE` reason printed. That is visible, not green-by-omission.

- [ ] **Step 3: Mutation probes (must go red, then revert)**

1. In `page.tsx`, delete `await requireAgency();` → test 1 FAILS (the client sees the page and the canary).
2. In `stripe-gateway.ts`, change `tiers_mode: "graduated"` to `"volume"` → test 2 FAILS on `["tiered", "volume", "metered"]`.
3. In `stripe-catalog.ts`, make `unchanged` always `false` → test 2 FAILS on the metered ids after the edit.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/plans.spec.ts
git commit -m "test(e2e): Plans page boundary and a Stripe test-mode round trip"
```

---

### Task 11: Gates, counts, handoff

**Files:** none new.

- [ ] **Step 1: Confirm the new-test count**

Expected new tests: billing-schema 45, billing 8, guard 5 + 2 leak cases, workflow 1, stripe-gateway 20, stripe-catalog 12, plan-form 26, actions 16, plan-rows 4, plans-list 4, nav-groups 1, registry 1, e2e 2 = **147**. The reviewer re-counts from vitest's own output, never from this plan (brief-discipline rule):

Run: `pnpm --filter @bis/db exec vitest run src/test/billing-schema.test.ts src/test/billing.test.ts`
Expected: `Tests  53 passed (53)`.

Run: `pnpm --filter web exec vitest run src/lib/billing "src/app/(dashboard)/dashboard/plans"`
Expected: `Tests  82 passed (82)` (20 + 12 + 26 + 4 + 16 + 4).

The guard (+7), workflow (+1), nav-groups (+1) and registry (+1) deltas: compare each file's vitest count against `main`'s for the same file.

- [ ] **Step 2: `pnpm check`**

Run: `pnpm check`
Expected: exit 0 (typecheck + lint + db suite + web suite). The db suite includes Tasks 1–2 and needs Checkpoint A.

- [ ] **Step 3: Production build**

Run: `pnpm --filter web build`
Expected: exit 0. `/dashboard/plans` is listed as a dynamic route (ƒ).

- [ ] **Step 4: e2e (alone, nothing else running)**

Run: `pnpm --filter web test:e2e`
Expected: all green, with `plans.spec.ts` 2 passed (or 1 skipped with the `NO_STRIPE` warning if the key is absent locally).

- [ ] **Step 5: Manual DESIGN.md DoD pass (`bis-design-reviewer` on a running build)**

- `/dashboard/plans` in dark AND light (the `.dark` toggle): the empty state, a loaded list, the dialog, the warn Notice (unset `STRIPE_SECRET_KEY` to see it).
- The blur fallback: the dialog renders with `@supports not (backdrop-filter)`.
- Keyboard: Tab reaches New plan, Edit, Archive; Esc closes the dialog; the focus ring is visible.
- 375px width: no horizontal scroll, and the meter fields stack.
- ⌘K: typing "billing" offers Plans.

- [ ] **Step 6: Handoff to the orchestrator (implementers stop here)**

- Push the branch and open the PR. The body lists: the spec gaps G1–G10, assumptions A1–A8 (A1–A3 now proven by the e2e run), the prerequisites, and "no effect on any account".
- Orchestrator: read the check runs for the head SHA (`verify`, `e2e`), then apply 0051 to production through MCP per runbook §6 step 5 (pre-flight read by name, `apply_migration`, post-apply verification; the file is ASCII with no backslash, so no md5 escape compare is needed), then parity, then the ledger line `0051 APPLIED — CI odnobiodsftffphuuosz (db push) <date> — PROD tlbkbmlrfafquucsmsmm (MCP) <date> — NEVER RE-APPLY`, then merge.
- Production shows "Stripe isn't connected" until danlo adds the live key to Vercel Production. That is expected, not a defect.

---

## Self-review (done while writing; recorded for the reviewer)

- **Spec coverage (step 1 only):** `plans` / `account_billing` / `usage_events` / `stripe_webhook_events` with RLS and grants (Task 1). Agency-only plan writes (Tasks 1, 7). A client reads only its own billing (Task 1). Complimentary is never paused (Task 1 CHECK). The usage ledger's one-source-once rule (Task 1). Plans page create/edit/archive (Tasks 7, 9). Stripe product plus a flat base price plus three graduated metered prices on Billing Meters on save (Tasks 4, 5, 10). A price change creates new prices (Task 5). ⌘K registration (Task 8). Dot + word Active/Archived (Tasks 8, 9). Empty copy verbatim from spec §5 (Task 6). One primary Save (Task 9). The test/live key split and the guard refusing `sk_live_` (Tasks 3, 4). Not in this PR by design: Billing card, client Billing page, banners, usage recording, webhooks, pause (steps 2–4).
- **Placeholders:** none. Every code step carries complete code.
- **Type consistency:** `MeterKey`/`METER_KEYS`, `PlanTerms`, `Plan`, `PlanWrite`, `StripePriceIds` (Task 2) are used unchanged in Tasks 4–10. `PlanActionResult` is defined once (actions.ts) and imported as a type by the dialog and the list. `BillingGateway` has the same five methods in the adapter, the fake and the catalog. The form field names in `parsePlanForm` (Task 6) match the dialog's `name` attributes (Task 9) and the e2e's labels (Task 10).
- **Counts re-derived from the code blocks:** 45 / 8 / 7 / 1 / 20 / 12 / 26 / 16 / 4 / 4 / 1 / 1 / 2 = 147 new tests. 21 files created, 14 modified. 11 tasks and 1 orchestrator checkpoint.
- **Existing tests this plan must not break:** `ci-target-guard.test.ts`'s two `it.each(GUARD_VARS)` "required variable" tests, which is why the Stripe key is a separate `OPTIONAL_VARS` list; `nav-groups.test.ts`'s exact top-level list (updated in Task 8); `messages.test.ts`'s milestone guard (no `plans.*` string names one).

## Next plans

1. **PR-2: usage recording.** `usage_events` rows at the three billable facts (answered call minutes, outbound SMS segments, concierge conversation start), and the cron pass reporting unreported rows to Stripe meter events (row id as the identifier) with the >24 h alert.
2. **PR-3: Checkout, webhooks, Billing card and client Billing page.** Send billing link (Checkout), `POST /api/webhooks/stripe` with `stripe_webhook_events`, `account_billing` mirroring, features written to `accounts.permissions`, the Customer Portal, and the payment-failed banner.
3. **PR-4: the non-payment pause, behind its own switch.** The 7-day pass, read-only dashboard, automations and SMS stop, voice forward/message routing, the lift by hand, and nightly reconciliation.
