# S-53 Tenant Vetting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every company BIS takes on has a recorded trade. Held and turned-away trades cannot be created. A CRM-only trade (restaurant, child care) is created, but Sofía and the web chat cannot be switched on. The database refuses any trade that may not be created.

**Architecture:** Migration 0101 adds `accounts.trade` / `accounts.trade_other`. Its CHECK lists only the creatable keys. One pure module, `apps/web/src/lib/vetting/trades.ts`, holds all 30 trades with their en/es labels, verdicts and reasons. A unit test parses 0101's CHECK list and compares it with the module. The rules are enforced in the server actions:
- Add company and Add as a company refuse a missing, held or turned-away trade before any Clerk call.
- A new Settings action sets the trade. It refuses a change to `crm_only` while Sofía is answering or the web chat is on.
- One server guard (`sofiaSwitchOnRefusal`) runs in every action that switches Sofía or the web chat on.

The UI shows the same reasons: a grouped Trade picker, a Trade card on Settings, disabled switches with the reason beside them, and a Setup notice. On a CRM-only trade, Setup also drops the Sofía steps.

**Tech Stack:** Next.js App Router server actions, Supabase Postgres (migration + `@bis/db` accessors on `serviceDb()`), Radix Select (shadcn), vitest (web unit + db `withRollback` on a local PG18 replica), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-27-tenant-vetting-design.md`. The owner approved decisions V1–V4. The spec is binding. Section "Spec gaps resolved in this plan" at the end lists every place this plan had to decide something the spec did not say.

## Global Constraints

- V1 (verbatim): "**Enforced.** Add company requires a trade; turned-away and held trades cannot be created; CRM-only trades are created but Sofía and the web chat cannot be switched on."
- V2: "**Other, with a required one-line description**, kept on the company." The description is at most 120 characters (spec §5.1).
- V3: "**None.**" (no in-app override). "A verdict changes only by a dated decision plus a code change and migration."
- V4: "a `trade` on each company; verdicts in one code module; the database accepts only creatable trades."
- Creatable trades = every `allowed` and `crm_only` key, including `other`. That is exactly 21 keys. The other 9 keys are held (7) or turned away (2).
- Spec §5.3: "Anything already on stays on; turning off is never blocked."
- Spec §5.2: "Clients never see the trade or any vetting text." Every new surface is agency-only.
- Migrations: ASCII only, no backslash. Header sections WHY / WHAT / WHO WRITES / GRANTS / LOCKS (+ `lock_timeout` do-block) / APPLY ORDER / ROLLBACK, as in 0099/0100. Apply order: bis-ci (`ci-project-setup.yml` push-dry-run, then push) → production (MCP `apply_migration`, once) → parity → merge.
- DESIGN.md: tokens only (no hard-coded colours, radii or shadows). One primary button per view (rule 8): the Trade card's Save is its card's one primary, and the Add company dialog keeps its one Add. Loaded, empty and error states are required (rule 5). Group headers use the mono Label role (`font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground`). A new variant needs a `/styleguide` entry. The grouped Select is the first use of `SelectGroup`/`SelectLabel` in the app, so it is a new variant.
- Bilingual DoD (spec §7): new copy has `.es` twins in the usted register. New agency UI renders en/es and the pseudo-locale (`?locale=es|pseudo`, QA only) and sets `lang`. Never cite roadmap labels (S-53, F-173) in UI copy (`messages.test.ts` "cites no internal roadmap label").
- A Radix Select inside a form submits through `useFormSubmit`, never the `action` prop (`apps/web/src/lib/forms/use-form-submit.ts:1-36`).
- e2e mutates only per-run companies (`E2E Co <13-digit stamp>`, swept by `FIXTURE_CO_ACCOUNT_RE`) and the per-run fixture account (`E2E Client Co …`). Never `Test Client One` or a live account.
- Git: NEVER `git stash`, `git commit --amend`, `git checkout --` or `git reset`. Commit only the task's own files.
- Tests: run only the affected tests listed per task, plus `pnpm --filter web lint` and `pnpm --filter web typecheck` (or `pnpm -w typecheck`). Do not run the db suite against bis-ci. Run `withRollback` db tests on a local PG18 replica (Task 1, Step 2). CI is the full gate.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0101_account_trade.sql` | create | The two columns and three CHECKs (Task 1) |
| `packages/db/src/test/account-trade-schema.test.ts` | create | DB proof: shape, CHECKs, no client/agency UPDATE, live constraint == file (Task 1) |
| `apps/web/src/lib/vetting/trades.ts` | create | THE trade list and verdicts; pure helpers (Task 2) |
| `apps/web/src/lib/vetting/copy.ts` | create | Resolved picker options and refusal/gate sentences, en/es/pseudo (Task 2) |
| `apps/web/src/lib/vetting/trades.test.ts`, `copy.test.ts` | create | Module tests + migration parity (Task 2) |
| `apps/web/src/lib/messages.ts` | modify | `vetting.*` + `palette.settings.trade` keys with `.es` twins (Task 2) |
| `packages/db/src/accounts.ts`, `packages/db/src/index.ts` | modify | `createAccount` takes a trade; `getAccountTrade`, `setAccountTrade` (Task 3) |
| `packages/db/src/ci-seed/seed.ts`, `packages/db/src/demo/seed.ts`, `apps/web/e2e/auth.setup.ts` | modify | Seeded and fixture companies are born `hvac` (Task 3) |
| `apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts` | modify | Add company + Add as a company validate the trade before Clerk (Task 4) |
| `apps/web/src/lib/vetting/sofia-guard.ts`, `sofia-state.ts` (+ tests) | create | Server switch-on guard; "is Sofía on" predicate (Task 5) |
| `.../accounts/[accountId]/voice/actions.ts`, `.../setup/actions.ts` | modify | Guard every switch-on (Task 5) |
| `.../accounts/[accountId]/settings/trade-actions.ts` (+ test) | create | `setTradeAction` (Task 6) |
| `apps/web/src/components/vetting/trade-picker.tsx`, `trade-fields.tsx` (+ test) | create | Grouped Select + Other description (Task 7) |
| `.../accounts/page.tsx`, `create-account-dialog.tsx`, `adopt-org-dialog.tsx` | modify | Trade fields, inline refusal, locale (Task 7) |
| `.../styleguide/trade-picker-demo.tsx`, `.../styleguide/page.tsx` | create/modify | Styleguide entry for the grouped Select (Task 7) |
| `.../settings/trade-card.tsx`, `.../settings/page.tsx`, `apps/web/src/lib/palette/registry.ts` | create/modify | Trade card on Settings + palette entry (Task 8) |
| `.../voice/page.tsx`, `.../voice/voice-settings.tsx` | modify | Disabled switches with the reason (Task 9) |
| `apps/web/src/lib/setup/setup-inputs.ts`, `setup-status.ts`, `.../setup/page.tsx` | modify | Setup notice; CRM-only trade drops the Sofía steps (Task 9) |
| `apps/web/e2e/vetting.spec.ts`, `apps/web/e2e/blueprints.spec.ts` | create/modify | e2e (Task 10) |
| `docs/crm-features.md` | modify | S-53 / F-173 rows, §5.14 sentence (Task 11) |

Tasks and tiers: 1 HIGH, 2 HIGH, 3 HIGH, 4 HIGH, 5 HIGH, 6 HIGH, 7 LOW, 8 LOW, 9 LOW, 10 LOW, 11 LOW.

Dependency order: 1 → 2 → 3 → (4, 5, 6 in any order) → 7 → 8 → 9 → 10 → 11. Task 3 must land before 5: once the guards exist, the e2e fixture needs a trade.

---

## Task 1 (HIGH): Migration 0101 and its database proof

**Files:**
- Create: `packages/db/supabase/migrations/0101_account_trade.sql`
- Create: `packages/db/src/test/account-trade-schema.test.ts`
- Unchanged, but must stay green: `packages/db/src/test/client-branding-grants.test.ts` (exact UPDATE set), `packages/db/src/test/schema-grants-guard.test.ts` (`EXPECTED_WRITES`, `"authenticated accounts"` at :66-69), `packages/db/src/test/proposals-drop.test.ts:91-101` (digest `52|b66203ca5d355155540b520af510d120`), `packages/db/src/test/weekly-report-grants.test.ts`, `alert-phone-grants.test.ts`, `call-handoff-grants.test.ts` (accounts UPDATE sets), `definer-search-path.test.ts` (no function added)

**Interfaces:**
- Produces: columns `public.accounts.trade text` and `public.accounts.trade_other text`; constraints `accounts_trade_check`, `accounts_trade_other_check`, `accounts_trade_other_only_check`. Later tasks write the columns only through `serviceDb()`.

**How client sessions write `accounts` today:**

Read from the migrations and confirmed READ-ONLY on bis-ci (2026-10-27):
- 0013 (`0013_client_branding.sql:46-49`) revoked table-level UPDATE from `authenticated` and granted UPDATE on seven branding columns. 0014 and 0048 added `reply_to_email` and `mailing_address`. bis-ci's `authenticated` UPDATE columns are exactly `brand_color, brand_corners, brand_logo_path, brand_mode, brand_name, brand_neutral, brand_type, mailing_address, reply_to_email`.
- Table-level grants: `authenticated` holds INSERT, DELETE and SELECT. `anon` holds SELECT.
- Policies:
  - `accounts_agency_all` (ALL, `app.is_agency()`)
  - `accounts_member_read` (SELECT)
  - `accounts_member_update` (UPDATE, own org and access on)
  - three RESTRICTIVE technician policies (`accounts_technician_insert` / `_update` / `_delete`)

A new column receives no column grant, so neither a client nor an agency session can UPDATE `trade` or `trade_other`. Only an agency session can INSERT, through `accounts_agency_all`. There it may set a creatable trade, never a held one, because the CHECK refuses it.

None of the pinned grant sets change:
- `client-branding-grants` exact set: unchanged.
- `EXPECTED_WRITES`: unchanged. `"authenticated accounts"` stays `insertDeleteAndUpdate([...9 cols])`, because table-level INSERT shows as `INSERT`, not per column.
- The digest: unchanged. It counts table-level privileges only.

These claims were verified on a PG18 replica (pre and post 0101: `52|b66203ca5d355155540b520af510d120` on both; `has_column_privilege('authenticated','public.accounts','trade','UPDATE') = false`).

- [ ] **Step 1: Write the failing DB test** `packages/db/src/test/account-trade-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";

/**
 * 0101_account_trade.sql (S-53): accounts.trade, accounts.trade_other and their three CHECKs.
 * RED BEFORE APPLY: every case names a column or constraint 0101 adds.
 * The creatable list below is read FROM THE MIGRATION FILE, and the live constraint must list the same keys:
 * apps/web/src/lib/vetting/trades.test.ts proves the file equals the code module, this proves the database
 * equals the file, so the code list and the database cannot drift.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const MIGRATION = path.join(__dirname, "..", "..", "supabase", "migrations", "0101_account_trade.sql");

function fileCreatableKeys(): string[] {
  const sql = fs.readFileSync(MIGRATION, "utf8");
  const list = /constraint accounts_trade_check check \(trade is null or trade in \(([^)]*)\)\)/.exec(sql);
  if (!list) throw new Error("accounts_trade_check's list not found in 0101");
  return [...list[1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
}

async function seed(c: Client, label: string): Promise<{ accountId: string; orgId: string }> {
  await actAsOwner(c);
  const orgId = `org_trade_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Vet') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Vetting', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}

const setTrade = (c: Client, id: string, trade: string | null, other: string | null) =>
  c.query("update public.accounts set trade = $2, trade_other = $3 where id = $1", [id, trade, other]);

describe("0101 accounts.trade / accounts.trade_other", () => {
  it("both are text, nullable, no default (mutation: default 'other' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable, column_default from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts' and column_name in ('trade', 'trade_other')
          order by column_name`);
      expect(rows).toEqual([
        { column_name: "trade", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "trade_other", data_type: "text", is_nullable: "YES", column_default: null },
      ]);
    }));

  it("the file lists exactly 21 creatable keys, and the live constraint lists the same ones (mutation: add 'law' to the live CHECK -> FAILS)", () =>
    withRollback(async (c) => {
      const keys = fileCreatableKeys();
      expect(keys).toHaveLength(21);
      const { rows: [def] } = await c.query<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'accounts_trade_check' and conrelid = 'public.accounts'::regclass");
      const live = [...def!.d.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]!);
      expect([...live].sort()).toEqual([...keys].sort());
    }));

  it("a new company has no trade, and every creatable key is accepted", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "each");
      const read = async () => (await c.query("select trade, trade_other from public.accounts where id = $1", [accountId])).rows;
      expect(await read()).toEqual([{ trade: null, trade_other: null }]);
      for (const key of fileCreatableKeys()) {
        await setTrade(c, accountId, key, key === "other" ? "Marketing and AI receptionist agency" : null);
        expect(await read()).toEqual([{ trade: key, trade_other: key === "other" ? "Marketing and AI receptionist agency" : null }]);
      }
    }));

  it.each(["law", "tax", "medical", "dental", "therapy", "chiropractic", "other_health", "adult_day_care", "home_health", "HVAC", "hvac ", ""])(
    "refuses %j by accounts_trade_check (mutation: drop the CHECK -> FAILS)", (bad) =>
      withRollback(async (c) => {
        const { accountId } = await seed(c, "held");
        await expect(setTrade(c, accountId, bad, null))
          .rejects.toMatchObject({ code: "23514", constraint: "accounts_trade_check" });
      }));

  it.each([null, "", "   ", "x".repeat(121)])(
    "refuses 'other' with description %j by accounts_trade_other_check (mutation: write it as length(btrim(trade_other)) between 1 and 120 -> the null case FAILS)", (desc) =>
      withRollback(async (c) => {
        const { accountId } = await seed(c, "other");
        await expect(setTrade(c, accountId, "other", desc))
          .rejects.toMatchObject({ code: "23514", constraint: "accounts_trade_other_check" });
      }));

  it("accepts 'other' with a 120-character description", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "other120");
      await setTrade(c, accountId, "other", "x".repeat(120));
    }));

  it.each([["hvac", "Something"], [null, "Something"]])(
    "refuses a description beside trade %j by accounts_trade_other_only_check (mutation: write it as trade = 'other' -> the null-trade case FAILS)", (trade, desc) =>
      withRollback(async (c) => {
        const { accountId } = await seed(c, "only");
        await expect(setTrade(c, accountId, trade, desc))
          .rejects.toMatchObject({ code: "23514", constraint: "accounts_trade_other_only_check" });
      }));

  it("a client member cannot write trade or trade_other on their own account (mutation: grant update (trade) to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { accountId, orgId } = await seed(c, "member");
      await actAsMember(c, accountId, orgId, "owner");
      await expect(c.query("update public.accounts set trade = 'hvac' where id = $1", [accountId]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("an agency session cannot UPDATE trade either, and its INSERT of a held trade is refused by the CHECK", () =>
    withRollback(async (c) => {
      const { accountId } = await seed(c, "agency");
      const { rows: [agency] } = await c.query<{ id: string }>("select agency_id as id from public.accounts where id = $1", [accountId]);
      await actAs(c, { app_role: "agency_admin", sub: `user_agency_${RUN}` });
      await expect(c.query("update public.accounts set trade_other = 'x' where id = $1", [accountId]))
        .rejects.toMatchObject({ code: "42501" });
      await c.query("savepoint s");
      await expect(c.query(
        "insert into public.accounts (agency_id, clerk_org_id, name, trade) values ($1, $2, 'Held', 'tax')",
        [agency!.id, `org_trade_ins_${RUN}`])).rejects.toMatchObject({ code: "23514", constraint: "accounts_trade_check" });
      await c.query("rollback to savepoint s");
    }));
});
```

- [ ] **Step 2: Build the local replica (pre = 0001–0100) and run the test red on `pre`**

Memory `bis-local-db-replica` describes the recipe. A ready script is in the planner's scratchpad. Copy it to your own scratch directory and pick your own port. Its `WT=` already points at this worktree, and it skips `*0101_*` when building `pre`:

```bash
S=<your scratch dir>/rv101
cp "C:/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/e9fdee89-45e2-4860-bb68-fc110da20d8b/scratchpad/s53/replica.sh" "$S.sh"
bash "$S.sh" 55481 "$S" C:/Users/danlo/bis-platform/.claude/worktrees/s53/packages/db/supabase/migrations/0101_account_trade.sql
```

Do this step after writing the file in Step 3; the script needs the file to build `post`. Then run the test on `pre`:

```bash
cd C:/Users/danlo/bis-platform/.claude/worktrees/s53/packages/db
SUPABASE_DB_URL=postgresql://postgres@localhost:55481/pre pnpm exec vitest run src/test/account-trade-schema.test.ts
```
Expected: FAIL. Every case names a missing column or constraint. Only the ENOENT-free parse of the file can pass.

- [ ] **Step 3: Write the migration** `packages/db/supabase/migrations/0101_account_trade.sql`.

Use the text below exactly. It is the text the planner applied and probed on a PG18 replica:
- 0 non-ASCII bytes and 0 backslashes.
- The rollback lines, run on a copy of `post`, give a `pg_dump -s` identical to `pre`; only the `\restrict` token differs.
- The spec's literal CHECK forms admitted both `('other', NULL)` and `(NULL, 'desc')` on the replica. The forms below refuse both.

```sql
-- 0101_account_trade.sql - every company's trade, and the only trades the database accepts
-- (S-53 tenant vetting; docs/superpowers/specs/2026-10-27-tenant-vetting-design.md sections 3-4;
--  docs/superpowers/plans/2026-10-27-s53-tenant-vetting.md, Task 1)
--
-- WHY. The plan's holds (adult day care and home health turned away; HIPAA verticals, law firms and tax
-- preparers held; restaurants and child care CRM-only) lived only in prose: Add company recorded no trade.
-- The verdicts live in ONE code module (apps/web/src/lib/vetting/trades.ts); this file records each
-- company's trade and makes the database itself refuse every trade that may not be created (owner
-- decision V4, 2026-10-27).
--
-- WHAT THIS FILE ADDS:
--   public.accounts.trade        the company's trade, a key from trades.ts. NULL = not recorded yet (every
--                                company that exists before this file, until the agency sets it).
--   public.accounts.trade_other  what the business does, one line, only for trade 'other' (owner decision V2).
--   accounts_trade_check             trade is NULL or one of the 21 CREATABLE keys (every 'allowed' and
--                                    'crm_only' entry in trades.ts, 'other' included). A held or turned-away
--                                    key is refused here, whatever the app does. trades.test.ts (apps/web)
--                                    parses this list and requires it to equal creatableTradeKeys();
--                                    account-trade-schema.test.ts (packages/db) requires the live
--                                    constraint to equal this file.
--   accounts_trade_other_check       trade 'other' needs a description that is not blank and at most 120
--                                    characters. Written with an explicit "is not null": a CHECK passes when
--                                    it evaluates to NULL, so "length(btrim(trade_other)) between 1 and 120"
--                                    alone would admit 'other' with no description at all.
--   accounts_trade_other_only_check  a description only beside 'other'. "is not distinct from", not "=",
--                                    for the same reason: with trade NULL, "trade = 'other'" is NULL and
--                                    the CHECK would pass a description on a company with no trade.
--
-- WHO WRITES. Only service_role: createAccount (Add company and Add as a company, behind requireAgency) and
-- setAccountTrade (the agency's Settings Trade card, behind requireAgencyOnlyAccountAccess), each after the
-- module's own validation.
--
-- GRANTS AND POLICIES. No grant changes. 0013 revoked table-level UPDATE on accounts from authenticated and
-- re-granted nine columns; a new column gets no column grant, so no client session and no agency session
-- can UPDATE trade or trade_other (client-branding-grants.test.ts's exact UPDATE set and EXPECTED_WRITES in
-- schema-grants-guard.test.ts are unchanged and keep pinning that). authenticated keeps the table-level
-- INSERT it has had since 0001, which RLS admits only for the agency (accounts_agency_all): an agency
-- session writing through the data API could insert a creatable trade, never a held one (the CHECK). No
-- client role can insert an account. The client-write digest (proposals-drop.test.ts) counts table-level
-- privileges only, so it stays 52|b66203ca5d355155540b520af510d120. SELECT stays table-level: a company's
-- own members can read trade through the data API; the app never shows it to them (spec 5.2).
--
-- SEARCH PATHS (0096 rule). This file creates no function. EXPECTED_DEFINERS is unchanged (23).
--
-- TEARDOWN. Two columns on accounts; nothing new to delete, ACCOUNT_OWNED_TABLES is unchanged.
--
-- LOCKS. ACCESS EXCLUSIVE on accounts for the length of this file. The two columns are nullable with no
-- default (no rewrite); each CHECK is validated by one scan of accounts (a handful of rows, every one with
-- trade NULL, so all three pass). Every in-account page reads accounts, so a lock queued behind a long
-- transaction would stall them: lock_timeout 5s is the protection.
--
-- APPLY ORDER: after 0100 everywhere. CI project (ci-project-setup.yml: push-dry-run, then push), then
-- production (MCP apply_migration, once), then the parity check, then merge.
-- LOAD-BEARING: the build after this file selects accounts.trade on the accounts, Setup, Settings and Voice
-- pages and in every Sofia and web-chat on-switch, and inserts it on Add company. PostgREST refuses a column
-- it does not know, so production gets this file BEFORE the merge deploy.
-- SAFE UNDER THE RUNNING BUILD: additive. The running build names neither column, and every row it inserts
-- has trade NULL, which all three CHECKs admit.
--
-- CHANGING A VERDICT (owner decision V3). Moving a key into or out of the creatable list is a dated owner
-- decision, a change to trades.ts and a NEW migration that drops and re-adds accounts_trade_check (deciding
-- first what happens to companies that hold a key leaving the list). Never edit this file once applied.
--
-- ROLLBACK (roll the app back first; loses every recorded trade):
--   alter table public.accounts drop constraint accounts_trade_other_only_check,
--     drop constraint accounts_trade_other_check, drop constraint accounts_trade_check,
--     drop column trade_other, drop column trade;
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

alter table public.accounts
  add column trade text,
  add column trade_other text;

alter table public.accounts
  add constraint accounts_trade_check check (trade is null or trade in (
    'hvac', 'plumbing', 'electrical', 'roofing', 'landscaping', 'pool', 'pest_control', 'cleaning',
    'painting', 'remodeling', 'woodworking', 'handyman', 'auto', 'beauty', 'fitness', 'insurance',
    'real_estate', 'events', 'restaurant', 'child_care', 'other')),
  add constraint accounts_trade_other_check check (
    trade is distinct from 'other'
    or (trade_other is not null and btrim(trade_other) <> '' and length(trade_other) <= 120)),
  add constraint accounts_trade_other_only_check check (
    trade_other is null or trade is not distinct from 'other');

comment on column public.accounts.trade is
  'S-53: the company''s trade, a key from apps/web/src/lib/vetting/trades.ts. Only creatable keys (accounts_trade_check); NULL = not recorded yet. Decides whether Sofia and the web chat may be switched on. Written only by service_role (createAccount, setAccountTrade); never shown to the company''s own users.';
comment on column public.accounts.trade_other is
  'S-53: what the business does, one line of at most 120 characters, present only when trade = ''other'' (accounts_trade_other_check, accounts_trade_other_only_check).';

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Run green on `post`, plus the unchanged grant suites on both `pre` and `post`**

```bash
cd C:/Users/danlo/bis-platform/.claude/worktrees/s53/packages/db
for DB in pre post; do SUPABASE_DB_URL=postgresql://postgres@localhost:55481/$DB pnpm exec vitest run \
  src/test/client-branding-grants.test.ts src/test/schema-grants-guard.test.ts src/test/proposals-drop.test.ts \
  src/test/weekly-report-grants.test.ts src/test/alert-phone-grants.test.ts src/test/call-handoff-grants.test.ts \
  src/test/definer-search-path.test.ts; done
SUPABASE_DB_URL=postgresql://postgres@localhost:55481/post pnpm exec vitest run src/test/account-trade-schema.test.ts
```
Expected:
- The seven grant suites PASS on both databases.
- `account-trade-schema.test.ts` PASSES on `post`: all cases, including the 12 + 4 + 2 `it.each` rows.

Then run these mutation probes on `post` (apply each with `psql -d post`, then rebuild `post` with `create database post template pre` plus 0101 between probes). Each must turn its named case red:
- `grant update (trade) on public.accounts to authenticated;` → the member case and `client-branding-grants`.
- Drop `accounts_trade_other_check` and re-add it as `check (trade is distinct from 'other' or length(btrim(trade_other)) between 1 and 120)` → the `null` row of the other-description case.
- Drop `accounts_trade_other_only_check` and re-add it as `check (trade_other is null or trade = 'other')` → the `[null, "Something"]` row.
- `alter table public.accounts drop constraint accounts_trade_check;` → the `it.each` refusals and the live-equals-file case.

Byte check on the file. A positive control must report non-ASCII bytes for `apps/web/src/lib/messages.ts`:
```bash
node -e "for (const f of process.argv.slice(1)) { const b=require('fs').readFileSync(f); let n=0,bs=0; for (const x of b){ if(x>127)n++; if(x===92)bs++; } console.log(f,'non-ascii',n,'backslash',bs); }" packages/db/supabase/migrations/0101_account_trade.sql apps/web/src/lib/messages.ts
```
Expected: `0101 … non-ascii 0 backslash 0`; `messages.ts … non-ascii <many>`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/supabase/migrations/0101_account_trade.sql packages/db/src/test/account-trade-schema.test.ts
git commit -m "S-53: migration 0101 records every company's trade; the database accepts only creatable trades"
```

---

## Task 2 (HIGH): The trade module, its copy and the migration parity test

**Files:**
- Create: `apps/web/src/lib/vetting/trades.ts`, `apps/web/src/lib/vetting/copy.ts`
- Create: `apps/web/src/lib/vetting/trades.test.ts`, `apps/web/src/lib/vetting/copy.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (new block just before `} as const;` at the end of the file)
- Modify: `apps/web/src/lib/messages.test.ts` (one new describe)
- Affected tests: `src/lib/messages.test.ts`, `src/lib/consent/copy.test.ts` (its count regexes at :42 and :112 do not match `vetting.`; run it to prove that), `src/lib/i18n/ratchet.test.ts` (catalogue parity: every new key has its `.es` twin)

**Interfaces:**
- Consumes: `0101_account_trade.sql` (read by the parity test).
- Produces (later tasks rely on these exact names):
  - `trades.ts`:
    - `type TradeVerdict`, `type TradeEntry`, `type TradeGroupKey`, `type Bilingual`, `TRADE_OTHER_MAX = 120`
    - `TRADE_GROUPS`, `TRADES`, `TRADE_ENTRIES: readonly TradeEntry[]`
    - `tradeEntry(key) => TradeEntry | null`, `tradeVerdict(key)`, `isCreatableVerdict(v)`, `creatableTradeKeys(): string[]`, `tradeLabel(key, locale)`
    - `type TradeChoice = { trade: string; tradeOther: string | null }`, `type TradeChoiceCheck`, `checkTradeChoice(rawTrade: unknown, rawOther: unknown): TradeChoiceCheck`
    - `type SofiaGate`, `sofiaGate(trade: string | null | undefined): SofiaGate`, `canUseSofia(trade): boolean`
  - `copy.ts`:
    - `type TradeOption = { value: string; label: string }`, `type TradeOptionGroup = { key: string; label: string; options: TradeOption[] }`
    - `tradeOptionGroups(locale, pseudo?) => TradeOptionGroup[]`
    - `tradeChoiceRefusal(check, locale) => string`
    - `sofiaGateText(gate, locale, pseudo?) => string`
  - `messages.ts` keys (each with `.es`): `vetting.trade.label`, `vetting.trade.placeholder`, `vetting.trade.hint`, `vetting.other.label`, `vetting.other.hint`, `vetting.error.missing`, `vetting.error.otherDescription`, `vetting.crmOnlyCreated`, `vetting.sofia.crmOnly`, `vetting.sofia.noTrade`, `vetting.sofia.noTradeLink`, `vetting.turnOffFirst`, `vetting.readFailed`, `vetting.saveFailed`, `vetting.saved`, `vetting.card.description`, `vetting.card.empty`, `palette.settings.trade`

- [ ] **Step 1: Write the failing tests** `apps/web/src/lib/vetting/trades.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  TRADES, TRADE_ENTRIES, TRADE_GROUPS, TRADE_OTHER_MAX, tradeEntry, tradeVerdict, creatableTradeKeys,
  checkTradeChoice, sofiaGate, canUseSofia,
} from "./trades";

/** The spec's section 3 table, key and verdict, in its order. A changed verdict must change this list
 *  (a dated owner decision, V3) - the module cannot drift from the spec silently. */
const SPEC: [string, string][] = [
  ["hvac", "allowed"], ["plumbing", "allowed"], ["electrical", "allowed"], ["roofing", "allowed"],
  ["landscaping", "allowed"], ["pool", "allowed"], ["pest_control", "allowed"], ["cleaning", "allowed"],
  ["painting", "allowed"], ["remodeling", "allowed"], ["woodworking", "allowed"], ["handyman", "allowed"],
  ["auto", "allowed"], ["beauty", "allowed"], ["fitness", "allowed"], ["insurance", "allowed"],
  ["real_estate", "allowed"], ["events", "allowed"], ["law", "held"], ["tax", "held"],
  ["restaurant", "crm_only"], ["child_care", "crm_only"], ["medical", "held"], ["dental", "held"],
  ["therapy", "held"], ["chiropractic", "held"], ["other_health", "held"], ["adult_day_care", "turned_away"],
  ["home_health", "turned_away"], ["other", "allowed"],
];

describe("the trade list (spec section 3)", () => {
  it("is the spec's 30 keys with the spec's verdicts, in its order (mutation: make 'law' allowed -> FAILS)", () => {
    expect(TRADES.map((e) => [e.key, e.verdict])).toEqual(SPEC);
  });

  it("every entry has an English and a Spanish label, and a group that exists", () => {
    const groups = new Set(TRADE_GROUPS.map((g) => g.key));
    for (const e of TRADE_ENTRIES) {
      expect(e.label.en.trim(), e.key).not.toBe("");
      expect(e.label.es.trim(), e.key).not.toBe("");
      expect(groups.has(e.group), e.key).toBe(true);
    }
    for (const g of TRADE_GROUPS) expect(TRADE_ENTRIES.some((e) => e.group === g.key), g.key).toBe(true);
  });

  it("held and turned-away entries carry an en/es reason; creatable ones carry none (mutation: drop dental's reason -> FAILS)", () => {
    for (const e of TRADE_ENTRIES) {
      if (e.verdict === "held" || e.verdict === "turned_away") {
        expect(e.reason?.en.trim(), e.key).toBeTruthy();
        expect(e.reason?.es.trim(), e.key).toBeTruthy();
      } else {
        expect(e.reason, e.key).toBeUndefined();
      }
    }
  });

  it("the Spanish reasons are in usted (mutation: 'puedes' for 'podemos'-style tu forms -> FAILS)", () => {
    for (const e of TRADE_ENTRIES) {
      if (e.reason) expect(e.reason.es, e.key).not.toMatch(/\b(puedes|tienes|quieres|elige|escribe)\b/i);
    }
  });

  it("the creatable keys are every allowed and crm_only key, other included - 21 of them", () => {
    expect(creatableTradeKeys()).toEqual(SPEC.filter(([, v]) => v === "allowed" || v === "crm_only").map(([k]) => k));
    expect(creatableTradeKeys()).toHaveLength(21);
  });
});

describe("migration 0101 and the module cannot drift (spec section 4)", () => {
  it("accounts_trade_check lists exactly creatableTradeKeys() (mutation: add 'law' to the migration's list, or make 'tax' allowed here -> FAILS)", () => {
    const file = path.resolve(__dirname, "../../../../../packages/db/supabase/migrations/0101_account_trade.sql");
    const sql = fs.readFileSync(file, "utf8");
    const list = /constraint accounts_trade_check check \(trade is null or trade in \(([^)]*)\)\)/.exec(sql);
    expect(list, "accounts_trade_check's list not found").not.toBeNull();
    const keys = [...list![1]!.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!);
    expect([...keys].sort()).toEqual([...creatableTradeKeys()].sort());
  });
});

describe("tradeEntry / tradeVerdict", () => {
  it("finds a key, and answers null for a missing or unknown one", () => {
    expect(tradeEntry("hvac")?.label.en).toBe("Heating and air conditioning");
    expect(tradeVerdict("adult_day_care")).toBe("turned_away");
    for (const k of [null, undefined, "", "HVAC", "unknown"]) expect(tradeEntry(k)).toBeNull();
  });
});

describe("checkTradeChoice (the server's validation, spec 5.1)", () => {
  it("accepts an allowed trade and drops any description sent with it", () => {
    expect(checkTradeChoice("plumbing", "ignored")).toEqual({ ok: true, choice: { trade: "plumbing", tradeOther: null }, verdict: "allowed" });
  });
  it("accepts a crm_only trade, saying so", () => {
    expect(checkTradeChoice(" restaurant ", null)).toEqual({ ok: true, choice: { trade: "restaurant", tradeOther: null }, verdict: "crm_only" });
  });
  it.each([null, undefined, "", "  ", "HVAC", "nope", 5])("refuses %j as missing", (raw) => {
    expect(checkTradeChoice(raw, null)).toEqual({ ok: false, problem: "missing" });
  });
  it.each(["law", "tax", "medical", "dental", "therapy", "chiropractic", "other_health", "adult_day_care", "home_health"])(
    "refuses %s as not creatable, carrying its entry (mutation: let held through -> FAILS)", (key) => {
      const r = checkTradeChoice(key, null);
      expect(r).toMatchObject({ ok: false, problem: "not_creatable" });
      expect(r.ok === false && r.problem === "not_creatable" ? r.entry.key : null).toBe(key);
    });
  it.each([null, "", "   ", "x".repeat(TRADE_OTHER_MAX + 1)])("refuses other with description %j", (desc) => {
    expect(checkTradeChoice("other", desc)).toEqual({ ok: false, problem: "other_description" });
  });
  it("accepts other with a description, trimmed and on one line, up to 120 characters", () => {
    expect(checkTradeChoice("other", "  Marketing   and\nAI agency ")).toEqual({
      ok: true, choice: { trade: "other", tradeOther: "Marketing and AI agency" }, verdict: "allowed",
    });
    expect(checkTradeChoice("other", "x".repeat(TRADE_OTHER_MAX))).toMatchObject({ ok: true });
  });
});

describe("sofiaGate (spec 5.3)", () => {
  it("opens for an allowed trade, other included", () => {
    expect(sofiaGate("hvac")).toEqual({ ok: true });
    expect(sofiaGate("other")).toEqual({ ok: true });
    expect(canUseSofia("events")).toBe(true);
  });
  it("closes for a crm_only trade, naming it (mutation: treat crm_only as allowed -> FAILS)", () => {
    expect(sofiaGate("restaurant")).toEqual({ ok: false, reason: "crm_only", trade: "restaurant" });
    expect(sofiaGate("child_care")).toEqual({ ok: false, reason: "crm_only", trade: "child_care" });
  });
  it.each([null, undefined, "", "unknown", "law"])("closes as no_trade for %j", (t) => {
    expect(sofiaGate(t)).toEqual({ ok: false, reason: "no_trade" });
    expect(canUseSofia(t)).toBe(false);
  });
});
```

`apps/web/src/lib/vetting/copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { checkTradeChoice, tradeEntry, sofiaGate } from "./trades";
import { tradeOptionGroups, tradeChoiceRefusal, sofiaGateText } from "./copy";

describe("tradeOptionGroups", () => {
  it("lists every trade once, grouped, in the asked language", () => {
    const en = tradeOptionGroups("en");
    const es = tradeOptionGroups("es");
    expect(en.flatMap((g) => g.options)).toHaveLength(30);
    expect(en[0]).toMatchObject({ key: "home_services", label: "Home services" });
    expect(en[0]!.options[0]).toEqual({ value: "hvac", label: "Heating and air conditioning" });
    expect(es[0]!.options[0]).toEqual({ value: "hvac", label: "Aire acondicionado y calefacción" });
  });
  it("wraps labels for the pseudo-locale but never the values", () => {
    const p = tradeOptionGroups("en", true);
    expect(p[0]!.label).toBe(pseudoLocale("Home services"));
    expect(p[0]!.options[0]!.value).toBe("hvac");
  });
});

describe("tradeChoiceRefusal", () => {
  it("a held trade is refused with its own reason, in both languages", () => {
    const r = checkTradeChoice("law", null);
    if (r.ok) throw new Error("expected a refusal");
    expect(tradeChoiceRefusal(r, "en")).toBe(tradeEntry("law")!.reason!.en);
    expect(tradeChoiceRefusal(r, "es")).toBe(tradeEntry("law")!.reason!.es);
  });
  it("missing and other-description refusals read the catalogue", () => {
    const missing = checkTradeChoice("", null);
    const other = checkTradeChoice("other", "");
    if (missing.ok || other.ok) throw new Error("expected refusals");
    expect(tradeChoiceRefusal(missing, "es")).toBe(m["vetting.error.missing.es"]);
    expect(tradeChoiceRefusal(other, "en")).toBe(m["vetting.error.otherDescription"]);
  });
});

describe("sofiaGateText", () => {
  it("names a CRM-only trade in lower case, in both languages", () => {
    const g = sofiaGate("child_care");
    if (g.ok) throw new Error("expected closed");
    expect(sofiaGateText(g, "en")).toBe("Sofía and the web chat aren't available for child care businesses yet.");
    expect(sofiaGateText(g, "es")).toBe("Sofía y el chat del sitio web aún no están disponibles para el giro guardería.");
  });
  it("asks for the trade when there is none", () => {
    const g = sofiaGate(null);
    if (g.ok) throw new Error("expected closed");
    expect(sofiaGateText(g, "en")).toBe(m["vetting.sofia.noTrade"]);
    expect(sofiaGateText(g, "en", true)).toBe(pseudoLocale(m["vetting.sofia.noTrade"]));
  });
});
```

Append to `apps/web/src/lib/messages.test.ts`:

```ts
describe("tenant vetting copy (S-53)", () => {
  it("is the plan's wording in both languages (mutation: any word changed, or a tu form such as 'Elige' -> FAILS)", () => {
    expect([m["vetting.trade.label"], m["vetting.trade.label.es"]]).toEqual(["Trade", "Giro"]);
    expect([m["vetting.sofia.noTrade"], m["vetting.sofia.noTrade.es"]])
      .toEqual(["Set this company's trade first.", "Primero indique el giro de esta empresa."]);
    expect([m["vetting.turnOffFirst"], m["vetting.turnOffFirst.es"]])
      .toEqual(["Turn off Sofía and the web chat first.", "Primero apague a Sofía y el chat del sitio web."]);
    expect([m["vetting.crmOnlyCreated"], m["vetting.crmOnlyCreated.es"]])
      .toEqual(["Sofía and the web chat aren't available for this trade yet.", "Sofía y el chat del sitio web aún no están disponibles para este giro."]);
    for (const [k, v] of Object.entries(m)) {
      if (k.startsWith("vetting.") && k.endsWith(".es")) expect(v, k).not.toMatch(/\b(elige|indica|apaga|escribe|di)\b/i);
    }
  });
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter web exec vitest run src/lib/vetting src/lib/messages.test.ts`
Expected: FAIL. `./trades` and `./copy` do not exist, and the `vetting.*` keys are undefined.

- [ ] **Step 3: Write `apps/web/src/lib/vetting/trades.ts`**

```ts
/**
 * S-53 tenant vetting: THE list of trades and what BIS may sell each one
 * (docs/superpowers/specs/2026-10-27-tenant-vetting-design.md section 3; owner decisions V1-V4).
 *
 * The single source. Migration 0101's accounts_trade_check lists exactly creatableTradeKeys()
 * (trades.test.ts parses the file), so a key that leaves this list's creatable verdicts without a new
 * migration fails the build, and a key the database admits that this list does not know fails it too.
 * A verdict changes only by a dated owner decision plus a change here AND a new migration (V3). There is
 * no in-app override.
 *
 * Pure: no database, no React. Labels and reasons are data here (en/es) because they belong to the
 * entry; the sentences around them live in lib/messages.ts under vetting.* (copy.ts joins the two).
 */
import type { Locale } from "@/lib/i18n/locale";

/** allowed: created, every product available (subject to plan and billing as today).
 *  crm_only: created; Sofía and the web chat cannot be switched on.
 *  held: not created; the reason says what must happen first.
 *  turned_away: not created; a polite sentence the agency can pass on. */
export type TradeVerdict = "allowed" | "crm_only" | "held" | "turned_away";
export type Bilingual = { readonly en: string; readonly es: string };
export type TradeGroupKey =
  | "home_services" | "auto" | "personal_care" | "professional" | "food_and_care" | "health"
  | "care_at_home" | "other";

export type TradeEntry = {
  readonly key: string;
  readonly group: TradeGroupKey;
  readonly label: Bilingual;
  readonly verdict: TradeVerdict;
  /** Present exactly on held and turned_away entries (trades.test.ts). */
  readonly reason?: Bilingual;
};

/** Other's description: one line, at most this many characters (spec 5.1; 0101 accounts_trade_other_check). */
export const TRADE_OTHER_MAX = 120;

export const TRADE_GROUPS: readonly { readonly key: TradeGroupKey; readonly label: Bilingual }[] = [
  { key: "home_services", label: { en: "Home services", es: "Servicios para el hogar" } },
  { key: "auto", label: { en: "Auto", es: "Automotriz" } },
  { key: "personal_care", label: { en: "Personal care", es: "Cuidado personal" } },
  { key: "professional", label: { en: "Professional", es: "Servicios profesionales" } },
  { key: "food_and_care", label: { en: "Food and care", es: "Comida y cuidado" } },
  { key: "health", label: { en: "Health", es: "Salud" } },
  { key: "care_at_home", label: { en: "Care at home", es: "Cuidado en casa" } },
  { key: "other", label: { en: "Something else", es: "Otra cosa" } },
];

const HEALTH_HELD: Bilingual = {
  en: "Health-care businesses aren't open yet: they need protections for patient information that BIS doesn't have today.",
  es: "Aún no aceptamos negocios de salud: necesitan protecciones para la información de los pacientes que BIS no tiene hoy.",
};

const CARE_AT_HOME_TURNED_AWAY: Bilingual = {
  en: "BIS doesn't serve adult day care or home health, so we can't take this business on.",
  es: "BIS no atiende guarderías para adultos ni salud en el hogar, así que no podemos aceptar este negocio.",
};

/** The spec's section 3 table, in its order. */
export const TRADES = [
  { key: "hvac", group: "home_services", label: { en: "Heating and air conditioning", es: "Aire acondicionado y calefacción" }, verdict: "allowed" },
  { key: "plumbing", group: "home_services", label: { en: "Plumbing", es: "Plomería" }, verdict: "allowed" },
  { key: "electrical", group: "home_services", label: { en: "Electrical", es: "Electricidad" }, verdict: "allowed" },
  { key: "roofing", group: "home_services", label: { en: "Roofing", es: "Techos" }, verdict: "allowed" },
  { key: "landscaping", group: "home_services", label: { en: "Landscaping and lawn care", es: "Jardinería y paisajismo" }, verdict: "allowed" },
  { key: "pool", group: "home_services", label: { en: "Pools and spas", es: "Albercas y spas" }, verdict: "allowed" },
  { key: "pest_control", group: "home_services", label: { en: "Pest control", es: "Control de plagas" }, verdict: "allowed" },
  { key: "cleaning", group: "home_services", label: { en: "Cleaning", es: "Limpieza" }, verdict: "allowed" },
  { key: "painting", group: "home_services", label: { en: "Painting", es: "Pintura" }, verdict: "allowed" },
  { key: "remodeling", group: "home_services", label: { en: "Construction and remodeling", es: "Construcción y remodelación" }, verdict: "allowed" },
  { key: "woodworking", group: "home_services", label: { en: "Woodworking and cabinets", es: "Carpintería y muebles" }, verdict: "allowed" },
  { key: "handyman", group: "home_services", label: { en: "Handyman and repairs", es: "Reparaciones generales" }, verdict: "allowed" },
  { key: "auto", group: "auto", label: { en: "Auto repair and detailing", es: "Taller mecánico y detallado" }, verdict: "allowed" },
  { key: "beauty", group: "personal_care", label: { en: "Salons, barbers and spas", es: "Salones, barberías y spas" }, verdict: "allowed" },
  { key: "fitness", group: "personal_care", label: { en: "Gyms and trainers", es: "Gimnasios y entrenadores" }, verdict: "allowed" },
  { key: "insurance", group: "professional", label: { en: "Insurance", es: "Seguros" }, verdict: "allowed" },
  { key: "real_estate", group: "professional", label: { en: "Real estate", es: "Bienes raíces" }, verdict: "allowed" },
  { key: "events", group: "professional", label: { en: "Events and venues", es: "Eventos y salones de fiestas" }, verdict: "allowed" },
  {
    key: "law", group: "professional", label: { en: "Law firm", es: "Despacho de abogados" }, verdict: "held",
    reason: {
      en: "Law firms open once our Texas cloud-storage sheet for lawyers (Opinions 680 and 705) is ready.",
      es: "Los despachos de abogados se abrirán cuando esté lista nuestra hoja para abogados sobre el almacenamiento en la nube en Texas (Opiniones 680 y 705).",
    },
  },
  {
    key: "tax", group: "professional", label: { en: "Tax preparation", es: "Preparación de impuestos" }, verdict: "held",
    reason: {
      en: "Tax preparers aren't open yet; planned for the 2028 tax season.",
      es: "Aún no aceptamos preparadores de impuestos; está previsto para la temporada de impuestos de 2028.",
    },
  },
  { key: "restaurant", group: "food_and_care", label: { en: "Restaurant", es: "Restaurante" }, verdict: "crm_only" },
  { key: "child_care", group: "food_and_care", label: { en: "Child care", es: "Guardería" }, verdict: "crm_only" },
  { key: "medical", group: "health", label: { en: "Medical clinic", es: "Clínica médica" }, verdict: "held", reason: HEALTH_HELD },
  { key: "dental", group: "health", label: { en: "Dental", es: "Dental" }, verdict: "held", reason: HEALTH_HELD },
  { key: "therapy", group: "health", label: { en: "Therapy and mental health", es: "Terapia y salud mental" }, verdict: "held", reason: HEALTH_HELD },
  { key: "chiropractic", group: "health", label: { en: "Chiropractic and physical therapy", es: "Quiropráctica y fisioterapia" }, verdict: "held", reason: HEALTH_HELD },
  { key: "other_health", group: "health", label: { en: "Other health care", es: "Otros servicios de salud" }, verdict: "held", reason: HEALTH_HELD },
  { key: "adult_day_care", group: "care_at_home", label: { en: "Adult day care", es: "Guardería para adultos" }, verdict: "turned_away", reason: CARE_AT_HOME_TURNED_AWAY },
  { key: "home_health", group: "care_at_home", label: { en: "Home health", es: "Salud en el hogar" }, verdict: "turned_away", reason: CARE_AT_HOME_TURNED_AWAY },
  { key: "other", group: "other", label: { en: "Other (describe it)", es: "Otro (descríbalo)" }, verdict: "allowed" },
] as const satisfies readonly TradeEntry[];

export type TradeKey = (typeof TRADES)[number]["key"];

/** The same list, widened so `.reason` reads on every entry. */
export const TRADE_ENTRIES: readonly TradeEntry[] = TRADES;

const BY_KEY: ReadonlyMap<string, TradeEntry> = new Map(TRADE_ENTRIES.map((e) => [e.key, e]));

export function tradeEntry(key: string | null | undefined): TradeEntry | null {
  return key ? BY_KEY.get(key) ?? null : null;
}

export function tradeVerdict(key: string | null | undefined): TradeVerdict | null {
  return tradeEntry(key)?.verdict ?? null;
}

export function isCreatableVerdict(v: TradeVerdict): v is "allowed" | "crm_only" {
  return v === "allowed" || v === "crm_only";
}

/** Every key a company may be created with, in the list's order. 0101's CHECK lists exactly these. */
export function creatableTradeKeys(): string[] {
  return TRADE_ENTRIES.filter((e) => isCreatableVerdict(e.verdict)).map((e) => e.key);
}

export function tradeLabel(key: string | null | undefined, locale: Locale): string | null {
  return tradeEntry(key)?.label[locale] ?? null;
}

export type TradeChoice = { trade: string; tradeOther: string | null };

export type TradeChoiceCheck =
  | { ok: true; choice: TradeChoice; verdict: "allowed" | "crm_only" }
  | { ok: false; problem: "missing" | "other_description" }
  | { ok: false; problem: "not_creatable"; entry: TradeEntry };

/**
 * The ONE validation every server action that records a trade runs (Add company, Add as a company,
 * the Settings Trade card). Values come from the browser, so nothing is trusted: an unknown key is
 * "missing" (the picker never offers one), a held or turned-away key is refused with its entry (its
 * reason is the refusal), and Other needs one line of 1-120 characters. Whitespace collapses to single
 * spaces, so what is stored is one trimmed line - the shape 0101's CHECKs admit.
 */
export function checkTradeChoice(rawTrade: unknown, rawOther: unknown): TradeChoiceCheck {
  const key = typeof rawTrade === "string" ? rawTrade.trim() : "";
  const entry = tradeEntry(key);
  if (!entry) return { ok: false, problem: "missing" };
  if (!isCreatableVerdict(entry.verdict)) return { ok: false, problem: "not_creatable", entry };
  if (entry.key !== "other") return { ok: true, choice: { trade: entry.key, tradeOther: null }, verdict: entry.verdict };
  const other = typeof rawOther === "string" ? rawOther.replace(/\s+/g, " ").trim() : "";
  if (other === "" || other.length > TRADE_OTHER_MAX) return { ok: false, problem: "other_description" };
  return { ok: true, choice: { trade: "other", tradeOther: other }, verdict: entry.verdict };
}

export type SofiaGate =
  | { ok: true }
  | { ok: false; reason: "crm_only"; trade: string }
  | { ok: false; reason: "no_trade" };

/**
 * Whether Sofía and the web chat may be SWITCHED ON for a company with this stored trade (spec 5.3).
 * Only an allowed trade opens the gate. A crm_only trade closes it, naming the trade. No trade - and any
 * stored key this module does not know or no longer calls creatable - closes it as "set the trade first".
 * Never consulted to switch anything OFF.
 */
export function sofiaGate(trade: string | null | undefined): SofiaGate {
  const entry = tradeEntry(trade);
  if (entry?.verdict === "allowed") return { ok: true };
  if (entry?.verdict === "crm_only") return { ok: false, reason: "crm_only", trade: entry.key };
  return { ok: false, reason: "no_trade" };
}

export function canUseSofia(trade: string | null | undefined): boolean {
  return sofiaGate(trade).ok;
}
```

- [ ] **Step 4: Write `apps/web/src/lib/vetting/copy.ts`**

```ts
/**
 * The vetting sentences, resolved for one language (and the QA pseudo-locale). trades.ts holds the
 * entries' own words (labels, reasons); lib/messages.ts holds the sentences around them; this joins the
 * two so every caller - the picker, the server actions, the Voice and Setup pages - says the same thing.
 */
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import type { Locale } from "@/lib/i18n/locale";
import { TRADE_ENTRIES, TRADE_GROUPS, tradeLabel, type SofiaGate, type TradeChoiceCheck } from "./trades";

export type TradeOption = { value: string; label: string };
export type TradeOptionGroup = { key: string; label: string; options: TradeOption[] };

/** Every trade, grouped as in the spec's table, labelled in `locale`. Held and turned-away trades are
 *  listed too: the agency picks what the business does, and the server answers with the reason. */
export function tradeOptionGroups(locale: Locale, pseudo = false): TradeOptionGroup[] {
  const w = (s: string) => (pseudo ? pseudoLocale(s) : s);
  return TRADE_GROUPS.map((g) => ({
    key: g.key,
    label: w(g.label[locale]),
    options: TRADE_ENTRIES.filter((e) => e.group === g.key).map((e) => ({ value: e.key, label: w(e.label[locale]) })),
  }));
}

/** Why a trade choice was refused, in `locale`: a held or turned-away trade's own reason, else the
 *  catalogue's "choose a trade" / "describe the business" sentence. */
export function tradeChoiceRefusal(check: Extract<TradeChoiceCheck, { ok: false }>, locale: Locale): string {
  if (check.problem === "not_creatable") return check.entry.reason?.[locale] ?? t(m, "vetting.error.missing", locale);
  return t(m, check.problem === "missing" ? "vetting.error.missing" : "vetting.error.otherDescription", locale);
}

/** Why Sofía and the web chat cannot be switched on, in `locale`. A CRM-only trade is named in lower
 *  case inside the sentence ("for restaurant businesses", "para el giro restaurante"). */
export function sofiaGateText(gate: Extract<SofiaGate, { ok: false }>, locale: Locale, pseudo = false): string {
  const s = gate.reason === "crm_only"
    ? t(m, "vetting.sofia.crmOnly", locale, {
      trade: (tradeLabel(gate.trade, locale) ?? gate.trade).toLocaleLowerCase(locale),
    })
    : t(m, "vetting.sofia.noTrade", locale);
  return pseudo ? pseudoLocale(s) : s;
}
```

- [ ] **Step 5: Add the catalogue keys.** Insert this block in `apps/web/src/lib/messages.ts` immediately before the final `} as const;`:

```ts
  // S-53 tenant vetting (docs/superpowers/specs/2026-10-27-tenant-vetting-design.md). Agency-only
  // surfaces (Add company, Add as a company, Settings' Trade card, the Voice page's locked switches,
  // Setup's notice); bilingual because the spec's DoD asks it. The trades' own labels and reasons live
  // in lib/vetting/trades.ts. Never shown to a client (spec 5.2).
  "vetting.trade.label": "Trade",
  "vetting.trade.label.es": "Giro",
  "vetting.trade.placeholder": "Choose the business's trade",
  "vetting.trade.placeholder.es": "Elija el giro del negocio",
  "vetting.trade.hint": "Decides whether BIS can take this business on, and whether Sofía and the web chat can be switched on.",
  "vetting.trade.hint.es": "Decide si BIS puede aceptar este negocio y si se pueden activar Sofía y el chat del sitio web.",
  "vetting.other.label": "What does the business do?",
  "vetting.other.label.es": "¿A qué se dedica el negocio?",
  "vetting.other.hint": "One line, up to 120 characters.",
  "vetting.other.hint.es": "Una línea, hasta 120 caracteres.",
  "vetting.error.missing": "Choose the business's trade.",
  "vetting.error.missing.es": "Elija el giro del negocio.",
  "vetting.error.otherDescription": "Say what the business does, in one line of up to 120 characters.",
  "vetting.error.otherDescription.es": "Diga a qué se dedica el negocio, en una línea de hasta 120 caracteres.",
  "vetting.crmOnlyCreated": "Sofía and the web chat aren't available for this trade yet.",
  "vetting.crmOnlyCreated.es": "Sofía y el chat del sitio web aún no están disponibles para este giro.",
  "vetting.sofia.crmOnly": "Sofía and the web chat aren't available for {trade} businesses yet.",
  "vetting.sofia.crmOnly.es": "Sofía y el chat del sitio web aún no están disponibles para el giro {trade}.",
  "vetting.sofia.noTrade": "Set this company's trade first.",
  "vetting.sofia.noTrade.es": "Primero indique el giro de esta empresa.",
  "vetting.sofia.noTradeLink": "Set the trade",
  "vetting.sofia.noTradeLink.es": "Indicar el giro",
  "vetting.turnOffFirst": "Turn off Sofía and the web chat first.",
  "vetting.turnOffFirst.es": "Primero apague a Sofía y el chat del sitio web.",
  "vetting.readFailed": "We couldn't check this company's trade. Try again.",
  "vetting.readFailed.es": "No pudimos revisar el giro de esta empresa. Inténtelo de nuevo.",
  "vetting.saveFailed": "The trade wasn't saved. Try again.",
  "vetting.saveFailed.es": "No se guardó el giro. Inténtelo de nuevo.",
  "vetting.saved": "Trade saved.",
  "vetting.saved.es": "Giro guardado.",
  "vetting.card.description": "What this business does. It decides whether Sofía and the web chat can be switched on. The company never sees it.",
  "vetting.card.description.es": "A qué se dedica este negocio. Decide si se pueden activar Sofía y el chat del sitio web. La empresa nunca lo ve.",
  "vetting.card.empty": "No trade yet. Sofía and the web chat can't be switched on until you set one.",
  "vetting.card.empty.es": "Aún no tiene giro. Sofía y el chat del sitio web no se pueden activar hasta que indique uno.",
  "palette.settings.trade": "Trade",
  "palette.settings.trade.es": "Giro",
```

- [ ] **Step 6: Run the tests to make sure they pass**

Run: `pnpm --filter web exec vitest run src/lib/vetting src/lib/messages.test.ts src/lib/consent/copy.test.ts src/lib/i18n/ratchet.test.ts`
Expected: PASS. Do not regenerate `catalogue-baseline.json`: every new key has a twin, so the parity test passes without a regeneration.

Mutation probes (revert each):
- Make `law` `allowed` in `TRADES` → the spec-list case and the migration parity case both FAIL.
- Return `{ ok: true }` for `crm_only` in `sofiaGate` → the crm_only case FAILS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/vetting apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts
git commit -m "S-53: one module holds every trade and its verdict, bound to migration 0101's list"
```

---

## Task 3 (HIGH): `@bis/db` accessors, and every seeded company is born with a trade

**Files:**
- Modify: `packages/db/src/accounts.ts:5-54` (`createAccount` input and insert); append `getAccountTrade`, `setAccountTrade` after `setAccountLanguage` (`:146-154`)
- Modify: `packages/db/src/index.ts:12` (export line)
- Modify: `packages/db/src/test/accounts.test.ts` (new describe; runs on CI: `withTestAccount` uses PostgREST)
- Modify: `packages/db/src/ci-seed/seed.ts:198` and `packages/db/src/demo/seed.ts:278-281` (born `hvac`)
- Modify: `apps/web/e2e/auth.setup.ts:198-202` (the per-run fixture is born `hvac`)
- Affected tests: `packages/db/src/__tests__/*.test.ts` (source scans, no DB: `create-account-callers.test.ts` still finds exactly ONE caller file, `accounts/actions.ts`; `cascade-export-boundary`, `demo-fiction`, `outbound-suppressed`), `packages/db/src/ci-seed/*.test.ts`

**Interfaces:**
- Consumes: 0101's columns.
- Produces:
  - `createAccount(db, { …, trade?: string; tradeOther?: string | null })`
  - `type AccountTrade = { trade: string | null; tradeOther: string | null }`
  - `getAccountTrade(db, accountId): Promise<AccountTrade>`: throws on a failed read or a missing account
  - `setAccountTrade(db, accountId, { trade: string; tradeOther: string | null }, actorId): Promise<void>`: emits `account.trade_set` with `{ trade, tradeOther }`, and throws on a zero-row update

Why this task comes before the guards: once Task 5's guards exist, the e2e fixture account must already have an `allowed` trade. Otherwise every fixture spec that switches Sofía or the web chat on would be refused: concierge, setup, forward-calls, trade-modules, ai-disclosure, structured-facts, calls.

- [ ] **Step 1: Write the failing test.** Append to `packages/db/src/test/accounts.test.ts`, and add `getAccountTrade, setAccountTrade` to its import from `"../accounts"`:

```ts
describe("account trade (S-53, 0101)", () => {
  it("createAccount stores the trade it is given; a company created without one has none (mutation: drop the spread from the insert -> FAILS)", async () => {
    const db = serviceDb();
    const orgId = `org_test_${suffix()}`;
    const { id } = await createAccount(db, { clerkOrgId: orgId, name: "Trade Co", actorId: "user_test", trade: "other", tradeOther: "Sign painting" });
    try {
      expect(await getAccountTrade(db, id)).toEqual({ trade: "other", tradeOther: "Sign painting" });
    } finally {
      await db.from("events").delete().eq("account_id", id);
      await db.from("accounts").delete().eq("id", id);
    }
  });

  it("getAccountTrade reads null on a fresh account; setAccountTrade writes, emits account.trade_set, and the database refuses a held trade", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getAccountTrade(db, accountId)).toEqual({ trade: null, tradeOther: null });
      await setAccountTrade(db, accountId, { trade: "restaurant", tradeOther: null }, "user_test");
      expect(await getAccountTrade(db, accountId)).toEqual({ trade: "restaurant", tradeOther: null });
      const { data: ev } = await db.from("events").select("type, actor_type, actor_id, payload")
        .eq("account_id", accountId).eq("type", "account.trade_set").single();
      expect(ev).toMatchObject({ actor_type: "user", actor_id: "user_test", payload: { trade: "restaurant", tradeOther: null } });
      await expect(setAccountTrade(db, accountId, { trade: "tax", tradeOther: null }, "user_test"))
        .rejects.toThrow(/setAccountTrade failed: .*accounts_trade_check/);
    });
  });

  it("both throw for an account that does not exist, and setAccountTrade emits nothing", async () => {
    const db = serviceDb();
    const ghost = randomUUID();
    await expect(getAccountTrade(db, ghost)).rejects.toThrow(/no account/);
    await expect(setAccountTrade(db, ghost, { trade: "hvac", tradeOther: null }, "user_test")).rejects.toThrow(/no account/);
    const { data } = await db.from("events").select("id").eq("account_id", ghost).eq("type", "account.trade_set");
    expect(data ?? []).toEqual([]);
  });
});
```

- [ ] **Step 2: Typecheck to see it fail**

Run: `pnpm --filter @bis/db exec tsc --noEmit`
Expected: FAIL. `getAccountTrade`, `setAccountTrade` and the `trade` input do not exist. The DB run of this file is CI's job (PostgREST); do not run it against bis-ci.

- [ ] **Step 3: Implement in `packages/db/src/accounts.ts`**

In `createAccount`'s input type, after `outboundSuppressed?: boolean;`:

```ts
    /**
     * S-53 (0101): the company's trade and, for 'other', its one-line description. Add company and
     * Add as a company always pass one (apps/web lib/vetting/trades.ts validates it first); absent
     * means no trade recorded (NULL), which only fixtures that never switch Sofía on rely on. The
     * database refuses a held or turned-away key whatever the caller sends (accounts_trade_check).
     */
    trade?: string;
    tradeOther?: string | null;
```

In the insert object, after the `outboundSuppressed` spread:

```ts
      ...(input.trade !== undefined ? { trade: input.trade, trade_other: input.tradeOther ?? null } : {}),
```

After `setAccountLanguage`:

```ts
/** S-53 (0101): the company's trade. Both NULL until the agency records one. */
export type AccountTrade = { trade: string | null; tradeOther: string | null };

/**
 * Reads `accounts.trade` / `trade_other`. Throws on a failed read AND on a missing account: every caller
 * gates a switch-on on this answer, and "no row" must never read as "no trade" silently.
 */
export async function getAccountTrade(db: SupabaseClient, accountId: string): Promise<AccountTrade> {
  const { data, error } = await db.from("accounts").select("trade, trade_other").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getAccountTrade failed: ${error.message}`);
  if (!data) throw new Error(`getAccountTrade: no account ${accountId}`);
  const row = data as { trade: string | null; trade_other: string | null };
  return { trade: row.trade ?? null, tradeOther: row.trade_other ?? null };
}

/**
 * Sets the company's trade (the agency's Settings Trade card). SERVER ONLY: 0101 grants `authenticated`
 * no UPDATE on either column, so the only writer is `serviceDb()` behind requireAgencyOnlyAccountAccess.
 * Shaped after setAccountLanguage: `.select("id")` so a zero-row update is a failure, and an `account.*`
 * event because accounts has no updated_at. The database refuses a held key (accounts_trade_check).
 */
export async function setAccountTrade(
  db: SupabaseClient, accountId: string, input: { trade: string; tradeOther: string | null }, actorId: string,
): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({ trade: input.trade, trade_other: input.tradeOther }).eq("id", accountId).select("id");
  if (error) throw new Error(`setAccountTrade failed: ${error.message}`);
  if (!data?.length) throw new Error(`setAccountTrade: no account ${accountId}`);
  await emit(db, accountId, "account.trade_set", actorId, { trade: input.trade, tradeOther: input.tradeOther });
}
```

In `packages/db/src/index.ts`, change line 12 to:

```ts
export { getAccountLanguage, setAccountLanguage, type Locale as DbLocale } from "./accounts";
export { getAccountTrade, setAccountTrade, type AccountTrade } from "./accounts";
```

- [ ] **Step 4: Born with a trade**

`packages/db/src/ci-seed/seed.ts:198`:

```ts
    accountId = (await createAccount(db, { clerkOrgId: spec.clerkOrgId, name: spec.name, actorId: CI_SEED_ACTOR, trade: "hvac" })).id;
```

`packages/db/src/demo/seed.ts:278-281`. The demo is the fictional "Resaca Air Conditioning & Heating":

```ts
  const { id: accountId } = await createAccount(db, {
    clerkOrgId: orgId, name: DEMO_ACCOUNT_NAME, timezone: DEMO_TIMEZONE, actorId: ACTOR,
    outboundSuppressed: true, trade: "hvac",
  });
```

`apps/web/e2e/auth.setup.ts:198-202`:

```ts
  const { id: accountId } = await createAccount(db, {
    clerkOrgId: org.id,
    name: companyName,
    actorId: user.id,
    // S-53: an allowed trade, so every fixture spec that switches Sofía or the web chat on keeps working.
    trade: "hvac",
  });
```

- [ ] **Step 5: Verify**

Run:
```bash
pnpm --filter @bis/db exec tsc --noEmit
pnpm --filter @bis/db exec vitest run src/__tests__ src/ci-seed
pnpm --filter web exec tsc --noEmit
```
Expected: PASS. In particular, `create-account-callers.test.ts` must still find exactly one caller file. Note on mutation: removing the `trade` spread fails the first new case, which runs on CI.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/accounts.ts packages/db/src/index.ts packages/db/src/test/accounts.test.ts packages/db/src/ci-seed/seed.ts packages/db/src/demo/seed.ts apps/web/e2e/auth.setup.ts
git commit -m "S-53: createAccount records a trade; getAccountTrade/setAccountTrade; seeded and fixture companies are born hvac"
```

---

## Task 4 (HIGH): Add company and Add as a company refuse before anything is created

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts:21-130` (`createClientAccount`), `:152-199` (`adoptOrphanOrgAction`)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/actions.test.ts`
- Affected tests: `accounts/actions.test.ts`, `accounts/create-account-feedback.test.ts` (unchanged; run it), `packages/db/src/__tests__/create-account-callers.test.ts`

**Interfaces:**
- Consumes: `checkTradeChoice`, `tradeChoiceRefusal` (Task 2), `createAccount(…, { trade, tradeOther })` (Task 3).
- Produces: both actions read form fields `trade`, `tradeOther` and `locale` (`"es"` or anything else = English). Task 7's dialogs post these three names.

**Decision: Add as a company (adopt-orphan) needs a trade too.** An adopted organisation becomes a company BIS serves, exactly like Add company. Without a trade there, a held or turned-away business could be taken on through the orphan path with full CRM. That would bypass V1. The check runs before Clerk is read. Nothing is created on refusal, and the organisation is never deleted, because this action did not create it (`actions.ts:147-150`).

- [ ] **Step 1: Write the failing tests.** In `accounts/actions.test.ts`, add `f.set("trade", "hvac");` to the `form()` helper (after `blueprintId`) so every existing case stays valid. Then append:

```ts
describe("S-53 vetting: the trade is checked before Clerk is touched", () => {
  it.each([
    [{ trade: "" }, m["vetting.error.missing"]],
    [{ trade: "law" }, "Law firms open once our Texas cloud-storage sheet for lawyers (Opinions 680 and 705) is ready."],
    [{ trade: "adult_day_care" }, "BIS doesn't serve adult day care or home health, so we can't take this business on."],
    [{ trade: "other", tradeOther: "   " }, m["vetting.error.otherDescription"]],
  ])("createClientAccount refuses %j with its reason, and creates no Clerk org and no row (mutation: move the check after createOrganization -> FAILS)", async (over, error) => {
    const r = await createClientAccount(form(over as Record<string, string>));
    expect(r).toEqual({ ok: false, error });
    expect(clerkMocks.createOrg).not.toHaveBeenCalled();
    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });

  it("refuses in Spanish when the form says es", async () => {
    const r = await createClientAccount(form({ trade: "tax", locale: "es" }));
    expect(r).toEqual({ ok: false, error: "Aún no aceptamos preparadores de impuestos; está previsto para la temporada de impuestos de 2028." });
  });

  it("creates a crm_only trade and records it, and a trimmed Other description (mutation: drop trade from createAccount's input -> FAILS)", async () => {
    await createClientAccount(form({ trade: "restaurant" }));
    expect(dbMocks.createAccount).toHaveBeenLastCalledWith({}, expect.objectContaining({ trade: "restaurant", tradeOther: null }));
    await createClientAccount(form({ trade: "other", tradeOther: "  Sign painting " }));
    expect(dbMocks.createAccount).toHaveBeenLastCalledWith({}, expect.objectContaining({ trade: "other", tradeOther: "Sign painting" }));
  });

  it("adoptOrphanOrgAction refuses a held trade before Clerk is read, and never deletes the org (mutation: drop the adopt check -> FAILS)", async () => {
    const f = new FormData();
    f.set("timezone", "America/Chicago");
    f.set("trade", "dental");
    const r = await adoptOrphanOrgAction(CLERK_ORG_ID, f);
    expect(r).toMatchObject({ ok: false });
    expect(clerkMocks.getOrg).not.toHaveBeenCalled();
    expect(clerkMocks.deleteOrg).not.toHaveBeenCalled();
    expect(dbMocks.createAccount).not.toHaveBeenCalled();
  });

  it("adoptOrphanOrgAction records the trade it is given", async () => {
    const f = new FormData();
    f.set("timezone", "America/Chicago");
    f.set("trade", "plumbing");
    await adoptOrphanOrgAction(CLERK_ORG_ID, f);
    expect(dbMocks.createAccount).toHaveBeenLastCalledWith({}, expect.objectContaining({ trade: "plumbing", tradeOther: null }));
  });
});
```

Existing adopt tests that build their own `FormData` without `trade` must add `f.set("trade", "hvac")`. Read the file's adopt describe and add it wherever a case expects success or a later refusal.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/actions.test.ts"`
Expected: the new cases FAIL. Clerk is called, and the trade is not passed.

- [ ] **Step 3: Implement**

In `accounts/actions.ts`, add imports:

```ts
import { checkTradeChoice } from "@/lib/vetting/trades";
import { tradeChoiceRefusal } from "@/lib/vetting/copy";
```

In `createClientAccount`, after the `assertUsableZone` try/catch (`:49-53`) and before `const clerk = await clerkClient();`:

```ts
  // S-53 (spec 5.1, V1): the trade, checked BEFORE the Clerk org for the same reason as the zone above -
  // a held or turned-away business must not create and destroy a tenant in an external system. The
  // refusal is the entry's own reason (or "choose a trade"), in the dialog's language, shown in the form.
  const locale = formData.get("locale") === "es" ? "es" : "en";
  const tradeCheck = checkTradeChoice(formData.get("trade"), formData.get("tradeOther"));
  if (!tradeCheck.ok) return { ok: false, error: tradeChoiceRefusal(tradeCheck, locale) };
```

Change the `createAccount` call (`:89`) to:

```ts
    ({ id } = await createAccount(serviceDb(), {
      clerkOrgId: org.id, name, brandName, timezone, actorId: userId,
      trade: tradeCheck.choice.trade, tradeOther: tradeCheck.choice.tradeOther,
    }));
```

In `adoptOrphanOrgAction`, after its zone try/catch (`:158-162`) and before the Clerk read:

```ts
  // S-53: an adopted organisation becomes a company BIS serves, so it is vetted exactly like Add company -
  // otherwise a held or turned-away business could enter through this door. Checked before Clerk is read;
  // nothing is created on a refusal and the organisation is left alone (this action never deletes it).
  const locale = formData.get("locale") === "es" ? "es" : "en";
  const tradeCheck = checkTradeChoice(formData.get("trade"), formData.get("tradeOther"));
  if (!tradeCheck.ok) return { ok: false, error: tradeChoiceRefusal(tradeCheck, locale) };
```

Change its `createAccount` call (`:188`) to:

```ts
    ({ id } = await createAccount(serviceDb(), {
      clerkOrgId: org.id, name: org.name.trim(), timezone, actorId: userId,
      trade: tradeCheck.choice.trade, tradeOther: tradeCheck.choice.tradeOther,
    }));
```

The CRM-only success note (spec 5.1) is not a return value, because success redirects to Setup. Setup shows it from the stored trade (Task 9).

- [ ] **Step 4: Run to see them pass**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts" && pnpm --filter @bis/db exec vitest run src/__tests__/create-account-callers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/actions.test.ts"
git commit -m "S-53: Add company and Add as a company refuse a missing, held or turned-away trade before Clerk"
```

---

## Task 5 (HIGH): Every switch that turns Sofía or the web chat on is guarded on the server

**Files:**
- Create: `apps/web/src/lib/vetting/sofia-guard.ts`, `apps/web/src/lib/vetting/sofia-guard.test.ts`
- Create: `apps/web/src/lib/vetting/sofia-state.ts`, `apps/web/src/lib/vetting/sofia-state.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.ts` (`saveVoiceProfileAction` :70-187, `setNumberStatusAction` :378-420, `enableConciergeAction` :523-559)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.ts` (`goLiveAction` :120-176)
- Modify tests: `.../voice/actions.test.ts` (dbMocks :9-24 gains `getAccountTrade`; beforeEach :75-91 sets its default), `.../setup/actions.test.ts` (dbMocks gains `getAccountTrade`, default `hvac`)
- Affected tests: both action test files, `src/lib/vetting/*`, `src/app/api/voice/texml/route.test.ts` (unchanged: no call-path gate; run it)

**Interfaces:**
- Consumes: `sofiaGate` (Task 2), `sofiaGateText` (Task 2), `getAccountTrade` (Task 3), `callAnswerable` (`apps/web/src/lib/voice/accept-gate.ts:26-32`).
- Produces:
  - `sofiaSwitchOnRefusal(accountId: string, locale?: Locale): Promise<string | null>`: `null` means it may switch on; a string is the refusal. A failed read fails closed with `vetting.readFailed`.
  - `sofiaIsOn(profile: { enabled: boolean; concierge_enabled: boolean } | null, numbers: readonly { status: PhoneNumberStatus }[]): { answering: boolean; chat: boolean }` (used by Task 6).

**Every path that makes Sofía answer or turns the web chat on.**

Sofía answers a call when the number is `testing` or `live`, a profile exists, and (`testing`, or `live` with `profile.enabled`). Sources: `api/voice/texml/route.ts:237-272` and `accept-gate.ts:26-32`. The web chat answers when `voice_profiles.concierge_enabled` is set.

| Path (file:line) | Turns on? | Guard |
|---|---|---|
| `voice/actions.ts` `setNumberStatusAction` → `testing`/`live` (:378-420); also Setup's "Enable test calls" (`setup/page.tsx:174` binds it) | yes, when the number is not already testing/live | `sofiaSwitchOnRefusal` unless this number is already testing/live ("anything already on stays on") |
| `setup/actions.ts` `goLiveAction` → `goLive` RPC (enables the profile and sets the number live, :120-176) | yes | `sofiaSwitchOnRefusal`, first, after the agency check |
| `voice/actions.ts` `saveVoiceProfileAction` with `enabled=on` (:155) | yes, when the stored profile is not enabled | `sofiaSwitchOnRefusal` only on off→on |
| `voice/actions.ts` `enableConciergeAction` (:523) | yes (web chat) | `sofiaSwitchOnRefusal` |
| `voice/actions.ts` `assignNumberAction` (:272): inserts `provisioned` (`packages/db/src/voice.ts:137`) | no (a provisioned number never answers) | none |
| `voice/actions.ts` `moveNumberAction` (:342) and `numbers/actions.ts` `moveNumberToAccountAction` (:56): `reassignPhoneNumber` resets to `provisioned` (`voice.ts:1140`) | no | none |
| `numbers/actions.ts` `releaseNumberAction`, `repairNumberRoutingAction`; `disableConciergeAction`; `setNumberStatusAction` → `provisioned`/`released`; profile `enabled` on→off | turning off / no change | none (never blocked) |
| `voice/actions.ts` `setForwardCallsAction(false)` (:597) | resumes an answering line; it cannot make a provisioned number answer | none (see gaps) |
| `blueprints/actions.ts` `applyBlueprintAction`, `captureBlueprintAction` | no (grep: no `voice_profiles`/`phone_numbers` write in blueprints) | none |
| Business status / the one switch (`packages/db/src/business-status.ts`) | no (it reads voice hours only) | none |
| API routes (`app/api/**`) | no writer of `phone_numbers.status`, `voice_profiles.enabled` or `concierge_enabled` (grep) | none |
| Seeds (`packages/db/src/demo/seed.ts:399-416`, `ci-seed/seed.ts:236`) | demo/CI only, `org_demo_`/`org_test_` | born `hvac` (Task 3) |

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/vetting/sofia-state.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sofiaIsOn } from "./sofia-state";

const P = (enabled: boolean, concierge = false) => ({ enabled, concierge_enabled: concierge });

describe("sofiaIsOn (callAnswerable over every active number)", () => {
  it("a testing number answers whether or not the profile is enabled", () => {
    expect(sofiaIsOn(P(false), [{ status: "testing" }]).answering).toBe(true);
  });
  it("a live number answers only with an enabled profile", () => {
    expect(sofiaIsOn(P(true), [{ status: "live" }]).answering).toBe(true);
    expect(sofiaIsOn(P(false), [{ status: "live" }]).answering).toBe(false);
  });
  it("no profile, or only provisioned/released numbers, means not answering", () => {
    expect(sofiaIsOn(null, [{ status: "testing" }]).answering).toBe(false);
    expect(sofiaIsOn(P(true), [{ status: "provisioned" }, { status: "released" }]).answering).toBe(false);
  });
  it("the web chat is on exactly when concierge_enabled is", () => {
    expect(sofiaIsOn(P(false, true), []).chat).toBe(true);
    expect(sofiaIsOn(null, []).chat).toBe(false);
  });
});
```

`apps/web/src/lib/vetting/sofia-guard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ getAccountTrade: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}) }));

import { m } from "@/lib/messages";
import { sofiaSwitchOnRefusal } from "./sofia-guard";

beforeEach(() => dbMocks.getAccountTrade.mockReset());

describe("sofiaSwitchOnRefusal", () => {
  it("lets an allowed trade switch on", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "hvac", tradeOther: null });
    expect(await sofiaSwitchOnRefusal("a1")).toBeNull();
  });
  it("refuses a crm_only trade, naming it", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "restaurant", tradeOther: null });
    expect(await sofiaSwitchOnRefusal("a1")).toBe("Sofía and the web chat aren't available for restaurant businesses yet.");
    expect(await sofiaSwitchOnRefusal("a1", "es")).toBe("Sofía y el chat del sitio web aún no están disponibles para el giro restaurante.");
  });
  it("refuses no trade", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: null, tradeOther: null });
    expect(await sofiaSwitchOnRefusal("a1")).toBe(m["vetting.sofia.noTrade"]);
  });
  it("fails CLOSED when the trade cannot be read (mutation: return null in the catch -> FAILS)", async () => {
    dbMocks.getAccountTrade.mockRejectedValue(new Error("db down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sofiaSwitchOnRefusal("a1")).toBe(m["vetting.readFailed"]);
    errSpy.mockRestore();
  });
});
```

In `voice/actions.test.ts`:
- Add `getAccountTrade: vi.fn(),` to `dbMocks` (:9-24).
- In `beforeEach`, after the resets, add `dbMocks.getAccountTrade.mockResolvedValue({ trade: "hvac", tradeOther: null });`.
- Append:

```ts
describe("S-53 vetting: switching Sofía or the web chat on (spec 5.3)", () => {
  const CRM = "Sofía and the web chat aren't available for restaurant businesses yet.";
  const row = (id: string, status: string) => ({ id, account_id: "a1", e164: `+1956555${id.length}`, telnyx_id: null, status });

  it("enableConciergeAction refuses a crm_only trade and no trade, writing nothing (mutation: delete the guard -> FAILS)", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "restaurant", tradeOther: null });
    expect(await enableConciergeAction("a1", "form1")).toEqual({ ok: false, error: CRM });
    dbMocks.getAccountTrade.mockResolvedValue({ trade: null, tradeOther: null });
    expect(await enableConciergeAction("a1", "form1")).toEqual({ ok: false, error: m["vetting.sofia.noTrade"] });
    expect(dbMocks.enableConcierge).not.toHaveBeenCalled();
  });

  it("disableConciergeAction is never gated", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "restaurant", tradeOther: null });
    dbMocks.disableConcierge.mockResolvedValue(undefined);
    expect(await disableConciergeAction("a1")).toEqual({ ok: true });
    expect(dbMocks.getAccountTrade).not.toHaveBeenCalled();
  });

  it.each(["testing", "live"])("setNumberStatusAction refuses provisioned -> %s on a crm_only trade (mutation: delete the guard -> FAILS)", async (status) => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "restaurant", tradeOther: null });
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([row("pn1", "provisioned")]);
    expect(await setNumberStatusAction("a1", "pn1", status)).toEqual({ ok: false, error: CRM });
    expect(dbMocks.setPhoneNumberStatus).not.toHaveBeenCalled();
  });

  it("setNumberStatusAction lets an already-answering number move testing -> live with no trade (anything on stays on; mutation: drop the wasAnswering exemption -> FAILS)", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: null, tradeOther: null });
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([row("pn1", "testing")]);
    dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
    expect(await setNumberStatusAction("a1", "pn1", "live")).toEqual({ ok: true });
  });

  it.each(["provisioned", "released"])("setNumberStatusAction -> %s is never gated", async (status) => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "restaurant", tradeOther: null });
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([row("pn1", "live")]);
    dbMocks.setPhoneNumberStatus.mockResolvedValue(undefined);
    expect(await setNumberStatusAction("a1", "pn1", status)).toEqual({ ok: true });
    expect(dbMocks.getAccountTrade).not.toHaveBeenCalled();
  });

  it("saveVoiceProfileAction refuses Receptionist enabled off -> on on a crm_only trade, saving nothing (mutation: delete the guard -> FAILS)", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "restaurant", tradeOther: null });
    dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "stuff", enabled: false });
    const r = await saveVoiceProfileAction("a1", fd({ persona_name: "Sofía", languages: "both", enabled: "on" }));
    expect(r).toEqual({ ok: false, error: CRM });
    expect(dbMocks.upsertVoiceProfile).not.toHaveBeenCalled();
    expect(dbMocks.saveVoiceKnowledge).not.toHaveBeenCalled();
  });

  it("saveVoiceProfileAction keeps an already-enabled profile saving with no trade, and turning it off is never gated", async () => {
    dbMocks.upsertVoiceProfile.mockResolvedValue({});
    dbMocks.getAccountTrade.mockResolvedValue({ trade: null, tradeOther: null });
    dbMocks.getVoiceProfile.mockResolvedValue({ greeting_en: "Hi", facts: "stuff", enabled: true });
    expect(await saveVoiceProfileAction("a1", fd({ persona_name: "Sofía", languages: "both", enabled: "on" }))).toEqual({ ok: true });
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "restaurant", tradeOther: null });
    expect(await saveVoiceProfileAction("a1", fd({ persona_name: "Sofía", languages: "both" }))).toEqual({ ok: true });
    expect(dbMocks.getAccountTrade).toHaveBeenCalledTimes(0);
  });
});
```

In `setup/actions.test.ts`:
- Add `getAccountTrade: vi.fn(),` to `dbMocks`.
- In its `beforeEach`, add `dbMocks.getAccountTrade.mockReset().mockResolvedValue({ trade: "hvac", tradeOther: null });`. If `beforeEach` resets all mocks generically, set it after the reset.
- Append inside the `goLiveAction` area:

```ts
describe("goLiveAction - S-53 vetting", () => {
  it("refuses a crm_only trade before any read or write (mutation: delete the guard -> FAILS)", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: "child_care", tradeOther: null });
    const r = await goLiveAction("acct_1");
    expect(r).toEqual({ ok: false, error: "Sofía and the web chat aren't available for child care businesses yet." });
    expect(setupInputsMocks.gatherSetupInputs).not.toHaveBeenCalled();
    expect(dbMocks.goLive).not.toHaveBeenCalled();
  });
  it("refuses no trade", async () => {
    dbMocks.getAccountTrade.mockResolvedValue({ trade: null, tradeOther: null });
    expect(await goLiveAction("acct_1")).toEqual({ ok: false, error: m["vetting.sofia.noTrade"] });
    expect(dbMocks.goLive).not.toHaveBeenCalled();
  });
});
```

(Use whatever account id the file's other goLive cases use. Make sure `m` is imported there; it is already imported if the file refers to `m["setup.goLive.denied"]`.)

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter web exec vitest run src/lib/vetting "src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.test.ts"`
Expected: FAIL. The modules are missing, and the guard cases succeed when they should not.

- [ ] **Step 3: Write the two modules**

`apps/web/src/lib/vetting/sofia-state.ts`:

```ts
import type { PhoneNumberStatus } from "@bis/db";
import { callAnswerable } from "@/lib/voice/accept-gate";

/**
 * Whether Sofía is answering, and whether the web chat is on, for one company - the state the Settings
 * Trade card must find OFF before a CRM-only trade is saved (spec 5.2). "Answering" is the call path's own
 * rule (callAnswerable: a testing number answers whatever profile.enabled says, a live one only when
 * enabled), over every number that can take a call. Pure.
 */
export function sofiaIsOn(
  profile: { enabled: boolean; concierge_enabled: boolean } | null,
  numbers: readonly { status: PhoneNumberStatus }[],
): { answering: boolean; chat: boolean } {
  const answering = numbers.some((n) =>
    (n.status === "testing" || n.status === "live") && callAnswerable({ status: n.status, profile }).answerable);
  return { answering, chat: profile?.concierge_enabled === true };
}
```

`apps/web/src/lib/vetting/sofia-guard.ts`:

```ts
import { serviceDb, getAccountTrade } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { sofiaGate } from "./trades";
import { sofiaGateText } from "./copy";

/**
 * The ONE server check every action that SWITCHES Sofía or the web chat ON calls (spec 5.3): go-live, a
 * number to testing/live, Receptionist enabled off->on, the web chat's on switch. Returns null when the
 * company's trade allows it, else the sentence to refuse with. Fails CLOSED: an unreadable trade refuses
 * (the operator presses again). Never called on a path that turns anything off.
 */
export async function sofiaSwitchOnRefusal(accountId: string, locale: Locale = "en"): Promise<string | null> {
  let trade: string | null;
  try {
    ({ trade } = await getAccountTrade(serviceDb(), accountId));
  } catch (e) {
    console.error(`sofiaSwitchOnRefusal: trade read failed for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
    return t(m, "vetting.readFailed", locale);
  }
  const gate = sofiaGate(trade);
  return gate.ok ? null : sofiaGateText(gate, locale);
}
```

- [ ] **Step 4: Guard the actions**

`voice/actions.ts`: add `import { sofiaSwitchOnRefusal } from "@/lib/vetting/sofia-guard";`.

`saveVoiceProfileAction`:
- Widen `current`'s type at :123 to `Pick<VoiceProfileRow, "facts" | "services" | "textback_body_es" | "textback_body_es_basis" | "enabled"> | null`.
- After the branding/profile try/catch (:124-132) and before `nextSpanishBox`, insert:

```ts
  // S-53 (spec 5.3): "Receptionist enabled" going from off to on is switching Sofía on. A profile already
  // enabled keeps saving (anything already on stays on); turning it off is never gated. Before any write.
  if (formData.get("enabled") === "on" && current?.enabled !== true) {
    const refusal = await sofiaSwitchOnRefusal(accountId);
    if (refusal) return { ok: false, error: refusal };
  }
```

`setNumberStatusAction`: replace the D-042 block (:391-400) with a version that reads the rows once and adds the vetting check:

```ts
  // D-042: bringing a released number back must not make it the account's
  // SECOND active one. Releasing is never gated — it is how an account that
  // already has two gets back to one, and an off switch must not depend on a
  // read that can be down.
  let rows: Awaited<ReturnType<typeof listPhoneNumbersForAccount>> = [];
  if (validStatus !== "released") {
    try {
      rows = await listPhoneNumbersForAccount(serviceDb(), accountId);
    } catch (e) {
      console.error(`setNumberStatusAction: active-number check failed for account ${accountId}: ${String(e)}`);
      return { ok: false, error: m["voice.numbers.statusUpdateFailed"] };
    }
    if (rows.some((n) => n.id !== phoneNumberId && n.status !== "released")) {
      return { ok: false, error: m["voice.numbers.anotherActive"] };
    }
  }

  // S-53 (spec 5.3): testing and live make Sofía answer. A number that already answers keeps moving
  // between the two (anything already on stays on); a number coming from provisioned or released is
  // switching Sofía on, and needs a trade that allows her.
  if (validStatus === "testing" || validStatus === "live") {
    const wasAnswering = rows.some((n) => n.id === phoneNumberId && (n.status === "testing" || n.status === "live"));
    if (!wasAnswering) {
      const refusal = await sofiaSwitchOnRefusal(accountId);
      if (refusal) return { ok: false, error: refusal };
    }
  }
```

`hasOtherActiveNumber` stays; `assignNumberAction` still uses it.

`enableConciergeAction`: after `if (!isAgency) …` (:527), insert:

```ts
  // S-53 (spec 5.3): the web chat's on switch needs a trade that allows it. The off switch never asks.
  const refusal = await sofiaSwitchOnRefusal(accountId);
  if (refusal) return { ok: false, error: refusal };
```

`setup/actions.ts` `goLiveAction`: add the import, and after `if (!isAgency) return …` (:122), insert:

```ts
  // S-53 (spec 5.3): going live switches Sofía on, so the trade is checked first, before any read.
  const refusal = await sofiaSwitchOnRefusal(accountId);
  if (refusal) return { ok: false, error: refusal };
```

- [ ] **Step 5: Run to see them pass, and run the mutation probes**

Run the Step 2 command, then `pnpm --filter web exec vitest run src/app/api/voice/texml/route.test.ts`.
Expected: PASS, including every pre-existing D-042 and concierge case.

Probes (each must turn its named case red; revert after):
1. Delete each of the four guard calls in turn.
2. In `setNumberStatusAction`, replace `if (!wasAnswering)` with `if (true)`.
3. In `saveVoiceProfileAction`, drop `&& current?.enabled !== true`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/vetting/sofia-guard.ts apps/web/src/lib/vetting/sofia-guard.test.ts apps/web/src/lib/vetting/sofia-state.ts apps/web/src/lib/vetting/sofia-state.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.test.ts"
git commit -m "S-53: going live, test calls, Receptionist enabled and the web chat's switch refuse a CRM-only or missing trade"
```

---

## Task 6 (HIGH): The Settings action that sets a company's trade

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/trade-actions.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/trade-actions.test.ts`

**Interfaces:**
- Consumes: `checkTradeChoice`, `tradeChoiceRefusal` (Task 2), `sofiaIsOn` (Task 5), `setAccountTrade`, `getVoiceProfile`, `listPhoneNumbersForAccount` (`@bis/db`).
- Produces: `setTradeAction(accountId: string, formData: FormData): Promise<{ ok: true } | { ok: false; error: string }>`. Form fields: `trade`, `tradeOther`, `locale`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const dbMocks = vi.hoisted(() => ({ setAccountTrade: vi.fn(), getVoiceProfile: vi.fn(), listPhoneNumbersForAccount: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({}) }));
const guard = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => { guard.calls += 1; return { userId: "user_agency", isAgency: true }; },
}));

import { m } from "@/lib/messages";
import { setTradeAction } from "./trade-actions";

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

beforeEach(() => {
  Object.values(dbMocks).forEach((x) => x.mockReset());
  dbMocks.setAccountTrade.mockResolvedValue(undefined);
  dbMocks.getVoiceProfile.mockResolvedValue(null);
  dbMocks.listPhoneNumbersForAccount.mockResolvedValue([]);
  guard.calls = 0;
});

describe("setTradeAction (spec 5.2)", () => {
  it("runs the agency-only guard first", async () => {
    await setTradeAction("a1", fd({ trade: "hvac" }));
    expect(guard.calls).toBe(1);
  });
  it("saves an allowed trade without reading Sofía's state", async () => {
    expect(await setTradeAction("a1", fd({ trade: "roofing" }))).toEqual({ ok: true });
    expect(dbMocks.setAccountTrade).toHaveBeenCalledWith({}, "a1", { trade: "roofing", tradeOther: null }, "user_agency");
    expect(dbMocks.getVoiceProfile).not.toHaveBeenCalled();
  });
  it.each([["law"], ["home_health"], [""]])("refuses %j with the same words as Add company, writing nothing", async (trade) => {
    const r = await setTradeAction("a1", fd({ trade }));
    expect(r).toMatchObject({ ok: false });
    expect(dbMocks.setAccountTrade).not.toHaveBeenCalled();
  });
  it("refuses a CRM-only trade while Sofía is answering (mutation: drop the answering check -> FAILS)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: false, concierge_enabled: false });
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ status: "testing" }]);
    expect(await setTradeAction("a1", fd({ trade: "restaurant" }))).toEqual({ ok: false, error: m["vetting.turnOffFirst"] });
    expect(dbMocks.setAccountTrade).not.toHaveBeenCalled();
  });
  it("refuses a CRM-only trade while the web chat is on, in Spanish when asked", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: false, concierge_enabled: true });
    expect(await setTradeAction("a1", fd({ trade: "child_care", locale: "es" }))).toEqual({ ok: false, error: m["vetting.turnOffFirst.es"] });
  });
  it("saves a CRM-only trade when Sofía is off (a live number with a disabled profile does not answer)", async () => {
    dbMocks.getVoiceProfile.mockResolvedValue({ enabled: false, concierge_enabled: false });
    dbMocks.listPhoneNumbersForAccount.mockResolvedValue([{ status: "live" }]);
    expect(await setTradeAction("a1", fd({ trade: "restaurant" }))).toEqual({ ok: true });
  });
  it("fails closed when Sofía's state cannot be read", async () => {
    dbMocks.listPhoneNumbersForAccount.mockRejectedValue(new Error("down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setTradeAction("a1", fd({ trade: "restaurant" }))).toEqual({ ok: false, error: m["vetting.saveFailed"] });
    errSpy.mockRestore();
    expect(dbMocks.setAccountTrade).not.toHaveBeenCalled();
  });
  it("reports a failed write in words", async () => {
    dbMocks.setAccountTrade.mockRejectedValue(new Error("setAccountTrade failed: boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await setTradeAction("a1", fd({ trade: "hvac" }))).toEqual({ ok: false, error: m["vetting.saveFailed"] });
    errSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/trade-actions.test.ts"`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `trade-actions.ts`**

```ts
"use server";

/**
 * The agency's Trade card on Settings (S-53, spec 5.2). Agency only: requireAgencyOnlyAccountAccess
 * redirects anyone else, and the write goes through serviceDb() because 0101 grants authenticated no
 * UPDATE on accounts.trade. Same validation as Add company (checkTradeChoice). Moving to a CRM-only
 * trade is refused while Sofía is answering or the web chat is on: the switch-on guards stop new
 * switch-ons, so only this path could otherwise leave a CRM-only company with Sofía live.
 */
import { revalidatePath } from "next/cache";
import { serviceDb, setAccountTrade, getVoiceProfile, listPhoneNumbersForAccount } from "@bis/db";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { checkTradeChoice } from "@/lib/vetting/trades";
import { tradeChoiceRefusal } from "@/lib/vetting/copy";
import { sofiaIsOn } from "@/lib/vetting/sofia-state";

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function setTradeAction(accountId: string, formData: FormData): Promise<ActionResult> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const locale = formData.get("locale") === "es" ? "es" : "en";

  const check = checkTradeChoice(formData.get("trade"), formData.get("tradeOther"));
  if (!check.ok) return { ok: false, error: tradeChoiceRefusal(check, locale) };

  if (check.verdict === "crm_only") {
    let on: { answering: boolean; chat: boolean };
    try {
      const db = serviceDb();
      const [profile, numbers] = await Promise.all([getVoiceProfile(db, accountId), listPhoneNumbersForAccount(db, accountId)]);
      on = sofiaIsOn(profile, numbers);
    } catch (e) {
      console.error(`setTradeAction: Sofía state read failed for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
      return { ok: false, error: t(m, "vetting.saveFailed", locale) };
    }
    if (on.answering || on.chat) return { ok: false, error: t(m, "vetting.turnOffFirst", locale) };
  }

  try {
    await setAccountTrade(serviceDb(), accountId, check.choice, userId);
  } catch (e) {
    console.error(`setTradeAction: save failed for account ${accountId}: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: t(m, "vetting.saveFailed", locale) };
  }
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}
```

- [ ] **Step 4: Run to see it pass.** Probe: delete `on.answering ||` and the answering case must FAIL. Delete the `crm_only` block and both refusal cases must FAIL.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/trade-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/trade-actions.test.ts"
git commit -m "S-53: the agency sets a company's trade; CRM-only is refused while Sofía or the web chat is on"
```

---

## Task 7 (LOW): The Trade picker in Add company and Add as a company, and its styleguide entry

**Files:**
- Create: `apps/web/src/components/vetting/trade-picker.tsx`, `apps/web/src/components/vetting/trade-fields.tsx`, `apps/web/src/components/vetting/trade-fields.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/page.tsx`, `create-account-dialog.tsx`, `adopt-org-dialog.tsx`
- Modify tests: `accounts/page.test.ts`, `accounts/page.zone.test.ts` (add the `@/lib/preferences/person-prefs` mock below)
- Create: `apps/web/src/app/(dashboard)/dashboard/styleguide/trade-picker-demo.tsx`; modify `styleguide/page.tsx` (one `Section`)
- Affected tests: the three above; `src/lib/i18n/ratchet.test.ts` (new `.tsx` files must count 0 un-catalogued strings; `accounts/page.tsx` is allow-listed, the dialogs are not); `src/lib/i18n/request-locale-callers.test.ts` (the new call passes `userLanguage`); `accounts/create-account-feedback.test.ts`

**Interfaces:**
- Consumes: `tradeOptionGroups`, `TradeOptionGroup` (Task 2); `TRADE_OTHER_MAX` (Task 2); actions reading `trade` / `tradeOther` / `locale` (Task 4).
- Produces:
  - `TradePicker({ id, name, groups, value, onValueChange, placeholder })`
  - `TradeFields({ idPrefix, groups, copy, locale, defaultTrade?, defaultOther? })`
  - `type TradeFieldsCopy = { label; placeholder; hint; otherLabel; otherHint }`
  - `type TradeSetup = { groups: TradeOptionGroup[]; copy: TradeFieldsCopy; locale: Locale }`
  - `CreateAccountDialog` and `AdoptOrgDialog` each take a `trade: TradeSetup` prop.
  - Task 8 reuses `TradeFields`.

- [ ] **Step 1: Write the failing render test** `apps/web/src/components/vetting/trade-fields.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tradeOptionGroups } from "@/lib/vetting/copy";
import { TradeFields, type TradeFieldsCopy } from "./trade-fields";

const COPY: TradeFieldsCopy = { label: "Giro", placeholder: "Elija el giro del negocio", hint: "Pista", otherLabel: "¿A qué se dedica el negocio?", otherHint: "Una línea" };
const render = (defaultTrade = "", locale: "en" | "es" = "es") => renderToStaticMarkup(
  createElement(TradeFields, { idPrefix: "t", groups: tradeOptionGroups(locale), copy: COPY, locale, defaultTrade }));

describe("TradeFields", () => {
  it("labels the picker, sets lang, and posts it as `trade`", () => {
    const html = render();
    expect(html).toContain('lang="es"');
    expect(html).toContain(">Giro</label>");
    expect(html).toContain("Elija el giro del negocio");
    expect(html).toContain('name="trade"');
  });
  it("asks for the description only when Other is chosen, capped at 120 (mutation: always render it -> FAILS)", () => {
    expect(render()).not.toContain('name="tradeOther"');
    const other = render("other");
    expect(other).toContain('name="tradeOther"');
    expect(other).toContain('maxLength="120"');
  });
});
```

(Radix renders a hidden native `<select name="trade">` only when a `name` is given. If the static markup shows the name on a different element, assert on that element; the point is that `trade` posts.)

- [ ] **Step 2: Run to see it fail.** Run: `pnpm --filter web exec vitest run src/components/vetting`. Expected: FAIL (module not found).

- [ ] **Step 3: Write the components**

`apps/web/src/components/vetting/trade-picker.tsx`:

```tsx
"use client";

import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { TradeOptionGroup } from "@/lib/vetting/copy";

/** DESIGN.md's Label role: group headers are mono, 10px, +0.14em, uppercase. */
const GROUP_LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

/**
 * The grouped trade Select (S-53; the first SelectGroup/SelectLabel use in the app - styleguide entry
 * "Trade picker"). Controlled, so the Other description can appear beside it; posted as `name` through
 * Radix's hidden native select. Every form that holds it submits via useFormSubmit, never `action`
 * (lib/forms/use-form-submit.ts: React's post-action reset drives a Radix Select backwards).
 */
export function TradePicker({
  id, name, groups, value, onValueChange, placeholder,
}: {
  id: string;
  name: string;
  groups: TradeOptionGroup[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <Select name={name} value={value} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {groups.map((g) => (
          <SelectGroup key={g.key}>
            <SelectLabel className={GROUP_LABEL}>{g.label}</SelectLabel>
            {g.options.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  );
}
```

`apps/web/src/components/vetting/trade-fields.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/lib/i18n/locale";
import type { TradeOptionGroup } from "@/lib/vetting/copy";
import { TRADE_OTHER_MAX } from "@/lib/vetting/trades";
import { TradePicker } from "./trade-picker";

export type TradeFieldsCopy = { label: string; placeholder: string; hint: string; otherLabel: string; otherHint: string };
/** What a server page resolves once and hands to a dialog or card that records a trade. */
export type TradeSetup = { groups: TradeOptionGroup[]; copy: TradeFieldsCopy; locale: Locale };

/**
 * The Trade field and, for Other, the required one-line description (spec 5.1, V2). Shared by Add
 * company, Add as a company and the Settings Trade card. `lang` is set because these surfaces render in
 * the operator's language while the page around them may not (DoD: sets lang correctly).
 */
export function TradeFields({
  idPrefix, groups, copy, locale, defaultTrade = "", defaultOther = "",
}: TradeSetup & { idPrefix: string; defaultTrade?: string; defaultOther?: string }) {
  const [trade, setTrade] = useState(defaultTrade);
  const pickerId = `${idPrefix}-trade`;
  const otherId = `${idPrefix}-trade-other`;
  return (
    <div lang={locale} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor={pickerId}>{copy.label}</Label>
        <TradePicker id={pickerId} name="trade" groups={groups} value={trade} onValueChange={setTrade} placeholder={copy.placeholder} />
        <p className="text-xs text-muted-foreground">{copy.hint}</p>
      </div>
      {trade === "other" ? (
        <div className="space-y-1.5">
          <Label htmlFor={otherId}>{copy.otherLabel}</Label>
          <Input id={otherId} name="tradeOther" required maxLength={TRADE_OTHER_MAX} defaultValue={defaultOther} />
          <p className="text-xs text-muted-foreground">{copy.otherHint}</p>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire the dialogs**

`create-account-dialog.tsx`:
- Add `import { Notice } from "@/components/ui/notice";` and `import { TradeFields, type TradeSetup } from "@/components/vetting/trade-fields";`.
- Add the prop `trade: TradeSetup` to the props type and destructuring.
- Replace the `useFormSubmit` block (:141-146) with:

```tsx
  // S-53 (spec 5.1): a refusal is a FORM message, not a toast - the agency reads it and passes it on
  // (a held or turned-away trade's reason). Every refusal shows here now, so one place answers.
  const [formError, setFormError] = useState<string | null>(null);
  const { pending, onSubmit } = useFormSubmit((formData) => {
    setFormError(null);
    return settleCreateAccount(() => action(formData), {
      close: () => setOpen(false),
      error: (message) => setFormError(message),
    });
  });
```

- Change `<Dialog open={open} onOpenChange={setOpen}>` to `<Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setFormError(null); }}>`.
- Inside the `<form>`, after `<AccountNameFields />`:

```tsx
          <TradeFields idPrefix="acct" {...trade} />
          <input type="hidden" name="locale" value={trade.locale} />
```

- Before `<DialogFooter>`:

```tsx
          {formError ? <Notice tone="crit" className="text-foreground">{formError}</Notice> : null}
```

- Remove the now-unused `toast` import.

`adopt-org-dialog.tsx`: the same changes. Use `TradeFields idPrefix="adopt"` after the timezone field, the same hidden `locale` input, the `formError` state with `Notice`, and the `trade: TradeSetup` prop. Remove `toast` if it becomes unused.

`accounts/page.tsx`:
- Accept `{ searchParams }: { searchParams?: Promise<{ locale?: string }> }`.
- Add imports:

```tsx
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { makeTr } from "@/lib/record/copy";
import { tradeOptionGroups } from "@/lib/vetting/copy";
import type { TradeSetup } from "@/components/vetting/trade-fields";
```

- Add `getPersonPrefs()` as a fourth `Promise.all` element (`[accounts, blueprints, clerkOrgs, prefs]`), then:

```tsx
  // S-53: the trade field reads in the operator's own language (decision 1: their users.language wins;
  // operators default to English); ?locale= is the QA override only.
  const { locale: localeParam } = (await searchParams) ?? {};
  const locale = requestLocale({ account: null, isOperator: true, userLanguage: prefs.language }, { locale: localeParam });
  const pseudo = requestPseudoMode({ locale: localeParam });
  const tr = makeTr(locale, pseudo);
  const trade: TradeSetup = {
    groups: tradeOptionGroups(locale, pseudo),
    copy: {
      label: tr.text("vetting.trade.label"), placeholder: tr.text("vetting.trade.placeholder"),
      hint: tr.text("vetting.trade.hint"), otherLabel: tr.text("vetting.other.label"), otherHint: tr.text("vetting.other.hint"),
    },
    locale,
  };
```

- Pass `trade={trade}` to `<CreateAccountDialog …>` (:63) and `<AdoptOrgDialog …>` (:134).

In `accounts/page.test.ts` and `accounts/page.zone.test.ts`, add:

```ts
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));
```

- [ ] **Step 5: Styleguide entry**

`styleguide/trade-picker-demo.tsx`:

```tsx
"use client";

import { TradeFields } from "@/components/vetting/trade-fields";
import { tradeOptionGroups } from "@/lib/vetting/copy";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

/** The grouped trade Select (S-53), in English and Spanish, and with Other's description open. */
export function TradePickerDemo() {
  const copy = (locale: "en" | "es") => ({
    label: t(m, "vetting.trade.label", locale), placeholder: t(m, "vetting.trade.placeholder", locale),
    hint: t(m, "vetting.trade.hint", locale), otherLabel: t(m, "vetting.other.label", locale), otherHint: t(m, "vetting.other.hint", locale),
  });
  return (
    <div className="grid w-full gap-6 sm:grid-cols-2" data-testid="styleguide-trade-picker">
      <TradeFields idPrefix="sg-en" groups={tradeOptionGroups("en")} copy={copy("en")} locale="en" />
      <TradeFields idPrefix="sg-es" groups={tradeOptionGroups("es")} copy={copy("es")} locale="es" defaultTrade="other" />
    </div>
  );
}
```

In `styleguide/page.tsx`, import it and add after the Choice tiles section:

```tsx
        <Section title={t(m, "vetting.trade.label", "en")} file="components/vetting/{trade-picker,trade-fields}.tsx">
          <TradePickerDemo />
        </Section>
```

- [ ] **Step 6: Verify**

Run:
```bash
pnpm --filter web exec vitest run src/components/vetting "src/app/(dashboard)/dashboard/accounts" src/lib/i18n
pnpm --filter web lint
pnpm --filter web exec tsc --noEmit
```
Expected: PASS. If `ratchet.test.ts` reports a NEW file above 0, the file has a raw JSX string: route it through the copy props. Do not regenerate the baseline to admit it.

Manual DoD check:
- `pnpm --filter web dev`, then `/dashboard/accounts` and `/dashboard/accounts?locale=es` with `BIS_I18N_QA=1`.
- Open Add company and pick a held trade: the inline refusal appears.
- Check dark and light (`.dark`), `?locale=pseudo` (labels wrap, no clipping), and the keyboard (Tab to the picker, arrows, Esc closes).
- The group headers render in the mono label role.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/vetting "apps/web/src/app/(dashboard)/dashboard/accounts/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/create-account-dialog.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/adopt-org-dialog.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/page.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/page.zone.test.ts" "apps/web/src/app/(dashboard)/dashboard/styleguide/trade-picker-demo.tsx" "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx"
git commit -m "S-53: Add company and Add as a company ask for the trade; refusals read in the form, English or Spanish"
```

---

## Task 8 (LOW): The Trade card on the agency's Settings, and its palette entry

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/trade-card.tsx`
- Modify: `.../settings/page.tsx` (:62-72 signature, :73 Promise.all, :89 the accounts select, render before the Language card at :174)
- Modify: `.../settings/page.test.ts` (mock `./trade-actions` and `@/lib/preferences/person-prefs`; the request-db row gains `trade: null, trade_other: null`; one new case)
- Modify: `apps/web/src/lib/palette/registry.ts:36-53` (`SETTINGS_SECTIONS`), `apps/web/src/lib/palette/registry.test.ts` (one case)
- Affected tests: `settings/page.test.ts`, `settings/sections.test.ts`, `src/lib/palette/registry.test.ts`, `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/request-locale-callers.test.ts`

**Interfaces:**
- Consumes: `TradeFields`, `TradeSetup` (Task 7), `setTradeAction` (Task 6), `tradeOptionGroups`, `sofiaGate` (Task 2).
- Produces: a Card with `id="trade"` (palette anchor `settings:trade`).

- [ ] **Step 1: Write the failing tests.** In `registry.test.ts`:

```ts
  it("registers the trade settings section, agency only, found by 'giro' (mutation: remove the SETTINGS_SECTIONS entry -> FAILS)", () => {
    const settings = buildPaletteEntries(BASE, true, false).filter((e) => e.group === "settings");
    const entry = settings.find((e) => e.id === "settings:trade");
    expect((entry as { href: string } | undefined)?.href).toBe(`${BASE}/settings#trade`);
    expect(buildPaletteEntries(BASE, false, false).some((e) => e.id === "settings:trade")).toBe(false);
  });
```

In `settings/page.test.ts`:
- Add `vi.mock("./trade-actions", () => ({ setTradeAction: noop }));` and `vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));` beside the other action mocks.
- Add `trade: null, trade_other: null` to `fx.requestDb`'s row.
- Add a case:

```ts
  it("mounts the Trade card with the stored trade and the empty-state line when there is none (S-53)", async () => {
    const tree = await SettingsPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve({}) });
    const card = findElement(tree, (el) => el.type === TradeCard);
    expect(card?.props.current).toEqual({ trade: null, tradeOther: null });
    expect(card?.props.copy.status).toBe(m["vetting.card.empty"]);
  });
```

Use the file's own element-walking helper (it already finds `ApplyBlueprintDialog`, `RequiredDocumentsCard` and others by type). Import `TradeCard` the way those are imported (`const { TradeCard } = await import("./trade-card");`).

- [ ] **Step 2: Run to see them fail.** Run: `pnpm --filter web exec vitest run src/lib/palette "src/app/(dashboard)/dashboard/accounts/[accountId]/settings"`. Expected: FAIL.

- [ ] **Step 3: Write `trade-card.tsx`**

```tsx
"use client";

import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TradeFields, type TradeSetup } from "@/components/vetting/trade-fields";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { SubmitButton } from "../../submit-button";
import type { ActionResult } from "./trade-actions";

export type TradeCardCopy = TradeSetup["copy"] & {
  title: string; description: string; status: string | null; save: string; saved: string; crashed: string;
};

/**
 * The company's trade (S-53, spec 5.2). Agency only (Settings is requireAgencyOnlyAccountAccess). Its own
 * card, its own action, its own toast: its Save is this card's one primary (DESIGN rule 8, the settings
 * card amendment). `status` is the empty state (no trade yet) or the CRM-only line; null when allowed.
 * useFormSubmit, not `action`: the form holds a Radix Select.
 */
export function TradeCard({
  setup, copy, current, action,
}: {
  setup: TradeSetup;
  copy: TradeCardCopy;
  current: { trade: string | null; tradeOther: string | null };
  action: (formData: FormData) => Promise<ActionResult>;
}) {
  const { pending, onSubmit } = useFormSubmit((formData) =>
    notifyActionResult(() => action(formData), { success: (s) => toast.success(s), error: (s) => toast.error(s) },
      { success: copy.saved, crashed: copy.crashed }));
  return (
    <Card id="trade" className="scroll-mt-24" lang={setup.locale}>
      <CardHeader>
        <CardTitle>{copy.title}</CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <input type="hidden" name="locale" value={setup.locale} />
          {copy.status ? <p className="text-sm text-muted-foreground" data-testid="trade-status">{copy.status}</p> : null}
          <TradeFields
            idPrefix="settings" {...setup}
            defaultTrade={current.trade ?? ""} defaultOther={current.tradeOther ?? ""}
          />
          <SubmitButton pending={pending}>{copy.save}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Mount it on `settings/page.tsx`**

- `searchParams: Promise<{ from?: string; locale?: string }>`, and `const { from, locale: localeParam } = await searchParams;`.
- Imports:

```tsx
import { getPersonPrefs } from "@/lib/preferences/person-prefs";
import { requestLocale, requestPseudoMode } from "@/lib/i18n/request-locale";
import { makeTr } from "@/lib/record/copy";
import { tradeOptionGroups } from "@/lib/vetting/copy";
import { sofiaGate } from "@/lib/vetting/trades";
import { TradeCard } from "./trade-card";
import { setTradeAction } from "./trade-actions";
```

- Add `getPersonPrefs()` as the last `Promise.all` element (`…, neverLog, prefs] = await Promise.all([…, getPersonPrefs()])`).
- Change the accounts select at :89 to `"client_access_enabled, report_emails, alert_phone, language, required_document_categories, trade, trade_other"`.
- After the bound actions:

```tsx
  // S-53: the Trade card reads in the operator's own language; the rest of Settings stays as it is.
  const locale = requestLocale({ account: null, isOperator: true, userLanguage: prefs.language }, { locale: localeParam });
  const pseudo = requestPseudoMode({ locale: localeParam });
  const tr = makeTr(locale, pseudo);
  const currentTrade = { trade: account.trade ?? null, tradeOther: account.trade_other ?? null };
  const tradeGate = sofiaGate(currentTrade.trade);
  const tradeStatus = currentTrade.trade === null ? tr.text("vetting.card.empty")
    : !tradeGate.ok ? tr.text("vetting.crmOnlyCreated") : null;
  const boundSetTrade = setTradeAction.bind(null, accountId);
```

- As the first child of `<div className="space-y-6 p-6">`, before the Language card:

```tsx
        <TradeCard
          setup={{
            groups: tradeOptionGroups(locale, pseudo), locale,
            copy: {
              label: tr.text("vetting.trade.label"), placeholder: tr.text("vetting.trade.placeholder"),
              hint: tr.text("vetting.trade.hint"), otherLabel: tr.text("vetting.other.label"), otherHint: tr.text("vetting.other.hint"),
            },
          }}
          copy={{
            label: tr.text("vetting.trade.label"), placeholder: tr.text("vetting.trade.placeholder"),
            hint: tr.text("vetting.trade.hint"), otherLabel: tr.text("vetting.other.label"), otherHint: tr.text("vetting.other.hint"),
            title: tr.text("vetting.trade.label"), description: tr.text("vetting.card.description"), status: tradeStatus,
            save: tr.text("common.save"), saved: tr.text("vetting.saved"), crashed: tr.text("common.actionCrashed"),
          }}
          current={currentTrade}
          action={boundSetTrade}
        />
```

(The account read is the page's existing request-scoped read. If it fails, the page fails as it does today: one read, one error state. Loaded state: the stored trade. Empty state: the `vetting.card.empty` line. Error after Save: the toast.)

- `registry.ts` `SETTINGS_SECTIONS`, after the `ai` entry:

```ts
  // S-53: the company's trade (settings/trade-card.tsx, #trade).
  { anchor: "trade", label: m["palette.settings.trade"], keywords: ["trade", "industry", "business type", "vetting", "giro", "restaurant", "sofia", "web chat"] },
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter web exec vitest run src/lib/palette src/lib/i18n "src/app/(dashboard)/dashboard/accounts/[accountId]/settings"`, then `pnpm --filter web lint` and `pnpm --filter web exec tsc --noEmit`.
Expected: PASS.

Manual check on the dev server:
- The card renders in dark and light.
- A CRM-only trade with the web chat on refuses with "Turn off Sofía and the web chat first."
- `?locale=es` reads Spanish, and the palette finds "giro".

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/trade-card.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.test.ts" apps/web/src/lib/palette/registry.ts apps/web/src/lib/palette/registry.test.ts
git commit -m "S-53: the agency's Settings has a Trade card, found from the palette"
```

---

## Task 9 (LOW): The switches say why they are off; Setup says it too

**Files:**
- Modify: `.../voice/page.tsx` (imports :3-7; `Promise.all` :82-98 gains `getAccountTrade`; VoiceSettings gets `vettingLock`)
- Modify: `.../voice/voice-settings.tsx`:
  - `VoiceProfileForm` (:83-100 props; the `enabled` checkbox at :308-311)
  - `ConciergeCard` (:665-675 props; `showEmptyState`/`reasonText`/`toggleDisabled` at :746-776)
  - `NumberStatusSelect` and `PhoneNumbersPanel` (:1017-1110)
  - `VoiceSettings` (:1114-1204)
- Modify: `apps/web/src/lib/setup/setup-status.ts` (`SetupInputs` :26-81 gains `trade?`; the filter at :211-219)
- Modify: `apps/web/src/lib/setup/setup-inputs.ts` (:104-109 select and type; :191 inputs)
- Modify: `.../setup/page.tsx` (:65 the name read becomes `name, trade`; a Notice above `SetupPanel`)
- Modify tests: `.../voice/page.test.ts` (its full-replace `@bis/db` mock at :41 MUST gain `getAccountTrade`, or the page throws on import use), `apps/web/src/lib/setup/setup-status.test.ts`, `apps/web/src/lib/setup/setup-inputs.test.ts`
- Affected tests: `voice/page.test.ts`, `voice/voice-settings.test.ts`, `src/lib/setup/*`, `.../accounts/[accountId]/shell-actions` tests if any (the sidebar meter reads `deriveSetupStatus`), `src/lib/i18n/ratchet.test.ts`

**Interfaces:**
- Consumes: `getAccountTrade` (Task 3); `sofiaGate`, `sofiaGateText` (Task 2).
- Produces:
  - `VoiceSettings`, `VoiceProfileForm`, `ConciergeCard` and `PhoneNumbersPanel` take an optional `vettingLock?: string | null` (a resolved sentence, or null).
  - `SetupInputs.trade?: string | null`.

- [ ] **Step 1: Write the failing tests**

`setup-status.test.ts`:

```ts
describe("S-53: a CRM-only trade drops the Sofía steps, like a CRM-only plan", () => {
  const base = /* reuse the file's own minimal SetupInputs fixture builder */ makeInputs();
  it("restaurant drops voice_profile, number, forwarding, test_call, go_live and website_assistant (mutation: ignore trade -> FAILS)", () => {
    const keys = deriveSetupStatus({ ...base, trade: "restaurant" }).map((s) => s.key);
    for (const k of ["voice_profile", "number", "forwarding", "test_call", "go_live", "website_assistant"]) expect(keys).not.toContain(k);
    expect(keys).toEqual(["account", "branding", "hours", "email"]);
  });
  it("an allowed trade and no trade keep every step", () => {
    expect(deriveSetupStatus({ ...base, trade: "hvac" })).toHaveLength(10);
    expect(deriveSetupStatus({ ...base, trade: null })).toHaveLength(10);
    expect(deriveSetupStatus({ ...base })).toHaveLength(10);
  });
});
```

(Use the file's existing fixture helper for a full `SetupInputs`. If it is named differently, use that name; the assertion lists are the contract.)

`setup-inputs.test.ts`. Add `trade` to its `AccountRow` type and add a case:

```ts
  it("the account's trade reaches SetupInputs (S-53; mutation: hardcode trade: null -> FAILS)", async () => {
    // same fake as the permissions case above, with trade: "restaurant"
    const { inputs } = await gatherSetupInputs(fakeDb({ brand_name: "Acme", from_email: null, permissions: {}, trade: "restaurant" }), "acct_1");
    expect(inputs.trade).toBe("restaurant");
  });
```

(Mirror the file's existing permissions case for the fake's construction.)

`voice/page.test.ts`:
- Add `getAccountTrade: vi.fn(),` to `serviceDbMock` and `getAccountTrade: (...a: unknown[]) => serviceDbMock.getAccountTrade(...a),` to the `@bis/db` factory, alongside the other accessors it re-exports.
- Default it in `beforeEach` to `{ trade: "hvac", tradeOther: null }`.
- Add:

```ts
  it("passes no lock for an allowed trade, the CRM-only sentence for a restaurant, and fails closed on a failed read (S-53)", async () => {
    await renderPage();
    expect(captured.props.vettingLock).toBeNull();
    serviceDbMock.getAccountTrade.mockResolvedValue({ trade: "restaurant", tradeOther: null });
    await renderPage();
    expect(captured.props.vettingLock).toBe("Sofía and the web chat aren't available for restaurant businesses yet.");
    serviceDbMock.getAccountTrade.mockRejectedValue(new Error("down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await renderPage();
    errSpy.mockRestore();
    expect(captured.props.vettingLock).toBe(m["vetting.readFailed"]);
  });
```

(Use the file's own page-invocation helper in place of `renderPage`.)

`voice/voice-settings.test.ts`. Render with `renderToStaticMarkup`, as that file already does:

```ts
describe("S-53: the on-switches are locked with the reason", () => {
  const LOCK = "Sofía and the web chat aren't available for restaurant businesses yet.";
  it("ConciergeCard: an off toggle is disabled and described by the lock, even with no profile (mutation: ignore vettingLock -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(ConciergeCard, {
      accountId: "a1", profile: null, publishedForms: [], origin: "https://x", enableAction: async () => ({ ok: true, publicId: "p" }),
      disableAction: async () => ({ ok: true }), vettingLock: LOCK,
    }));
    expect(html).toContain(`id="concierge-toggle-reason"`);
    expect(html).toContain(LOCK);
    expect(html).toMatch(/id="concierge_enabled"[^>]*disabled=""/);
  });
});
```

(The `disabled=""` attribute order in Radix's checkbox markup may differ. If the regex misses, assert on the button element by locating `id="concierge_enabled"` and checking `disabled` in that tag.)

- [ ] **Step 2: Run to see them fail.** Run: `pnpm --filter web exec vitest run src/lib/setup "src/app/(dashboard)/dashboard/accounts/[accountId]/voice"`. Expected: FAIL.

- [ ] **Step 3: Implement**

`setup-status.ts`. In `SetupInputs`, after `permissions`:

```ts
  /**
   * S-53: the company's stored trade (accounts.trade, read on the same row as permissions). A CRM-only
   * trade drops the same steps a CRM-only plan does: Sofía and the web chat cannot be switched on, so a
   * Setup that kept them could never complete (docs/crm-features.md:883's defect). No trade (null) keeps
   * every step; their actions refuse with "Set this company's trade first", and Setup's notice says so.
   * Optional so every SetupInputs literal written before this field still compiles.
   */
  trade?: string | null;
```

Then add the import (`import { sofiaGate } from "@/lib/vetting/trades";`) and, in `deriveSetupStatus`, replace the two `const …Off` lines (:211-212) with:

```ts
  const tradeGate = sofiaGate(inputs.trade ?? null);
  const tradeCrmOnly = !tradeGate.ok && tradeGate.reason === "crm_only";
  const voiceReceptionistOff = permissions?.voice_receptionist === false || tradeCrmOnly;
  const webConciergeOff = permissions?.web_concierge === false || tradeCrmOnly;
```

`setup-inputs.ts`:
- Change the select to `"brand_name, from_email, permissions, trade"`.
- Add `trade: string | null;` to the row type.
- Add `trade: account?.trade ?? null,` to the `inputs` literal after `permissions`.

`setup/page.tsx`:
- Read `select("name, trade")`.
- Keep `accountTrade` beside `accountName`: `accountTrade = (data as { trade: string | null } | null)?.trade ?? null;`.
- Import `Link` from `next/link` and `sofiaGate` from `@/lib/vetting/trades`.
- Above `<SetupPanel …>`:

```tsx
        {/* S-53 (spec 5.1/5.3): why Sofía's steps are missing (a CRM-only trade) or will refuse (no trade). */}
        {(() => {
          const gate = sofiaGate(accountTrade);
          if (gate.ok) return null;
          return gate.reason === "crm_only" ? (
            <Notice tone="warn" className="text-foreground" data-testid="setup-vetting">{m["vetting.crmOnlyCreated"]}</Notice>
          ) : (
            <Notice tone="warn" className="text-foreground" data-testid="setup-vetting">
              {m["vetting.sofia.noTrade"]}{" "}
              <Link className="underline" href={`/dashboard/accounts/${accountId}/settings?from=setup#trade`}>{m["vetting.sofia.noTradeLink"]}</Link>
            </Notice>
          );
        })()}
```

(Setup stays English: it renders through `m`, like the rest of the page, decision 2. A failed name/trade read leaves `accountTrade` null and shows the "set the trade" notice. That fails safe: the actions decide for themselves.)

`voice/page.tsx`:
- Import `getAccountTrade` from `@bis/db`, `sofiaGate` from `@/lib/vetting/trades` and `sofiaGateText` from `@/lib/vetting/copy`.
- Add `getAccountTrade(db, accountId).then((r) => r.trade, (e: unknown) => { console.error(`voice: trade read failed for account ${accountId}: ${String(e)}`); return undefined; })` as the last `Promise.all` element, destructured as `storedTrade`.
- After `const tr = makeTr(locale, pseudo);`:

```tsx
  // S-53 (spec 5.3): the on-switches below are locked, with this sentence beside them, unless the trade
  // allows Sofía. A failed read locks too (the actions fail closed the same way); switches already on
  // stay usable as off switches.
  const tradeGate = storedTrade === undefined ? null : sofiaGate(storedTrade);
  const vettingLock = storedTrade === undefined ? tr.text("vetting.readFailed")
    : tradeGate && !tradeGate.ok ? sofiaGateText(tradeGate, locale, pseudo) : null;
```

- Pass `vettingLock={vettingLock}` to `<VoiceSettings …>`.

`voice-settings.tsx`:
- `VoiceSettings`: add `vettingLock = null` to the destructuring and `vettingLock?: string | null;` to the props type. Pass `vettingLock={vettingLock}` to `VoiceProfileForm`, `ConciergeCard` and `PhoneNumbersPanel`.
- `VoiceProfileForm`: add `vettingLock = null` and `vettingLock?: string | null;`. Replace the `enabled` checkbox block (:308-311) with:

```tsx
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              {/* S-53: locked OFF only - an enabled receptionist keeps its checkbox, which is its off switch. */}
              <Checkbox
                id="enabled" name="enabled" defaultChecked={p.enabled}
                disabled={vettingLock !== null && !p.enabled}
                aria-describedby={vettingLock !== null && !p.enabled ? "sofia-enabled-reason" : undefined}
              />
              <Label htmlFor="enabled">{m["voice.profile.enabled"]}</Label>
            </div>
            {vettingLock !== null && !p.enabled ? (
              <p id="sofia-enabled-reason" className="text-xs text-muted-foreground">{vettingLock}</p>
            ) : null}
          </div>
```

- `ConciergeCard`: add `vettingLock = null` / `vettingLock?: string | null;`.
  - Wrap `showEmptyState`: `const showEmptyState = vettingLock === null && shouldShowConciergeEmptyState(enabled, lockReason);`. The empty state sells "publish a form", which is no use when the trade forbids the chat.
  - Make `reasonText`'s OFF branch `(vettingLock ?? conciergeOffReason(lockReason, selectedFormId, formUnpublished))`.
  - Make `toggleDisabled` `pending || (!enabled && vettingLock !== null) || conciergeToggleLocked(enabled, lockReason, selectedFormId, formUnpublished)`.
  - In `turnOn`, add `if (vettingLock !== null) return;` as its first line.
- `NumberStatusSelect`: add a prop `vettingLock: string | null`. Inside it, `const answering = phoneNumber.status === "testing" || phoneNumber.status === "live";` and change each item to:

```tsx
          <SelectItem key={v} value={v}
            disabled={vettingLock !== null && !answering && (v === "testing" || v === "live")}>
            {NUMBER_STATUS_LABEL[v]}
          </SelectItem>
```

- `PhoneNumbersPanel`: take `vettingLock`, pass it to each `NumberStatusSelect`. After the list, render `{vettingLock !== null ? <p id="number-vetting-reason" className="text-xs text-muted-foreground">{vettingLock}</p> : null}`.

- [ ] **Step 4: Verify.** Run the Step 2 command plus `pnpm --filter web exec vitest run src/lib/i18n "src/app/(dashboard)/dashboard/accounts/[accountId]"`, then lint and tsc. Expected: PASS. Manual check (dev server): a restaurant company's Voice page in dark and light, with the reasons visible; Setup's notice; the keyboard reaches each locked control and its reason is announced (`aria-describedby`).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/voice" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/setup/page.tsx" apps/web/src/lib/setup
git commit -m "S-53: Sofía's and the web chat's switches say why they are off; Setup drops Sofía's steps for a CRM-only trade"
```

---

## Task 10 (LOW): e2e — Add company refuses a held trade; a CRM-only company's switches are off

**Files:**
- Create: `apps/web/e2e/vetting.spec.ts`
- Modify: `apps/web/e2e/blueprints.spec.ts:97-106` (pick a trade before Add)
- Affected tests: `apps/web/e2e/fixtures/fixture-names.test.ts` (vitest; it must find `vetting.spec.ts: E2E Co ${stamp}` and admit it through `FIXTURE_CO_ACCOUNT_RE`), `apps/web/e2e/fixtures/*.test.ts`

**Interfaces:**
- Consumes: everything above. Field labels come from `m` (`vetting.trade.label`), refusal text from `tradeEntry(…).reason.en`, ids `#enabled`, `#sofia-enabled-reason`, `#concierge_enabled`, `#concierge-toggle-reason`, `[data-testid=setup-vetting]`.
- Produces: nothing downstream.

The specs mutate only companies they create, named `E2E Co <Date.now()>`. That name matches `FIXTURE_CO_ACCOUNT_RE` (`e2e/fixtures/stale.ts:39`), so a killed run is swept, and `finally` deletes the Clerk org and the account. Never `Test Client One`.

- [ ] **Step 1: Update `blueprints.spec.ts`.** After the brand-name assertion (:103) and before the blueprint combobox (:104), insert:

```ts
    // S-53: Add company requires a trade.
    await page.getByRole("combobox", { name: "Trade" }).click();
    await page.getByRole("option", { name: "Heating and air conditioning", exact: true }).click();
```

- [ ] **Step 2: Write `apps/web/e2e/vetting.spec.ts`**

```ts
import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { clerkClient } from "@clerk/nextjs/server";
import { deleteAccountCascade, emptySweepReport } from "./fixtures/sweep";
import { m } from "../src/lib/messages";
import { tradeEntry } from "../src/lib/vetting/trades";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-53 tenant vetting (spec section 7). Each test creates - or must fail to create - its OWN company,
 * named `E2E Co <13-digit stamp>` (FIXTURE_CO_ACCOUNT_RE, e2e/fixtures/stale.ts), so a killed run is
 * swept; `finally` removes the Clerk org and the account. Never Test Client One or any live account.
 * The CRM-only test creates a company rather than re-trading the per-run fixture, because the fixture's
 * hvac trade is what concierge, setup and forward-calls specs rely on while running in parallel.
 */
test.describe.configure({ timeout: 90_000 });

async function cleanup(name: string) {
  const db = serviceDb();
  const { data } = await db.from("accounts").select("id, clerk_org_id").eq("name", name);
  for (const acct of data ?? []) {
    if (acct.clerk_org_id) {
      try { await (await clerkClient()).organizations.deleteOrganization(acct.clerk_org_id); }
      catch (e) { console.error(`vetting.spec cleanup: Clerk org ${acct.clerk_org_id}: ${String(e)}`); }
    }
    const report = emptySweepReport();
    await deleteAccountCascade(db, acct.id, report);
    if (report.errors.length) console.error(`vetting.spec cleanup: ${report.errors.join("; ")}`);
  }
}

async function openAddCompany(page: Page, name: string, query = "") {
  await page.goto(`/dashboard/accounts${query}`);
  await page.getByRole("button", { name: /add company/i }).click();
  await page.getByLabel("Business name").fill(name);
}

async function pickTrade(page: Page, label: string, field = m["vetting.trade.label"]) {
  await page.getByRole("combobox", { name: field }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test("Add company refuses a held trade with its reason, and creates nothing", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Co ${stamp}`;
  try {
    await openAddCompany(page, name);
    await pickTrade(page, "Law firm");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(tradeEntry("law")!.reason!.en)).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/dashboard\/accounts$/);
    const { data } = await serviceDb().from("accounts").select("id").eq("name", name);
    expect(data ?? [], "a held trade must create no account").toEqual([]);
  } finally {
    await cleanup(name);
  }
});

test("a CRM-only company is created, and its Sofía and web-chat switches are off with the reason", async ({ page }) => {
  const stamp = Date.now();
  const name = `E2E Co ${stamp}`;
  try {
    await openAddCompany(page, name);
    await pickTrade(page, "Restaurant");
    await page.getByRole("button", { name: "Add", exact: true }).click();
    await expect(page).toHaveURL(/\/setup$/, { timeout: 30_000 });
    await expect(page.getByTestId("setup-vetting")).toHaveText(m["vetting.crmOnlyCreated"]);
    const accountId = new URL(page.url()).pathname.split("/")[3];

    await page.goto(`/dashboard/accounts/${accountId}/voice`);
    const reason = m["vetting.sofia.crmOnly"].replace("{trade}", "restaurant");
    await expect(page.locator("#enabled")).toBeDisabled();
    await expect(page.locator("#sofia-enabled-reason")).toHaveText(reason);
    await expect(page.locator("#concierge_enabled")).toBeDisabled();
    await expect(page.locator("#concierge-toggle-reason")).toHaveText(reason);
  } finally {
    await cleanup(name);
  }
});

test("the trade field reads in Spanish and sets lang (bilingual DoD)", async ({ page }) => {
  await page.goto("/dashboard/accounts?locale=es");
  await page.getByRole("button", { name: /add company/i }).click();
  const field = page.getByRole("combobox", { name: m["vetting.trade.label.es"] });
  await expect(field).toBeVisible();
  await expect(page.locator('[lang="es"]').getByRole("combobox", { name: m["vetting.trade.label.es"] })).toBeVisible();
  await field.click();
  await expect(page.getByRole("option", { name: "Plomería", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});
```

- [ ] **Step 3: Run**

Run: `pnpm --filter web exec vitest run e2e/fixtures`. Expected: PASS. It now lists `vetting.spec.ts: E2E Co ${stamp}` and admits it.

Then, with no `screenshots.yml` run in progress (CLAUDE.md):

```bash
pnpm --filter web exec playwright test e2e/vetting.spec.ts e2e/blueprints.spec.ts
```
Expected: PASS. The full e2e suite is CI's job. If a local run cannot start, say so in the report. CI's `e2e` job is the authority.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/vetting.spec.ts apps/web/e2e/blueprints.spec.ts
git commit -m "S-53 e2e: Add company refuses a held trade; a CRM-only company's Sofía and web-chat switches are off"
```

---

## Task 11 (LOW): Docs, and the rollout

**Files:**
- Modify: `docs/crm-features.md` lines 1346, 1347, 2364, 2425-2426, 3712, 3804

- [ ] **Step 1: Edit `docs/crm-features.md`.** After the PR is open, get its number with `gh pr view --json number -q .number` and use it for `#<n>`:
  - :1346, S-53 row, Feature cell: `Tenant vetting — **shipped** (#<n>, migration 0101)`.
  - :1347: `the vetting slice (it is S-53, re-costed) — shipped with S-53 (#<n>)`.
  - :2364, F-173 row, "What the owner or customer gets" cell: append ` The vetting slice shipped as S-53 (#<n>): a trade on every company, held and turned-away trades refused, CRM-only trades kept off Sofía and the web chat. Pack picking and licence checks remain.`
  - :2425-2426: replace `Voice is agency-only and only the agency adds companies today, so these holds need no code until S-53's vetting enforces them.` with `S-53's vetting enforces these holds (#<n>, migration 0101): Add company requires a trade, refuses held and turned-away trades with their reason, and a CRM-only trade cannot switch Sofía or the web chat on. The verdicts live in apps/web/src/lib/vetting/trades.ts, and one changes only by a dated owner decision plus a code change and a migration.` Keep the rest of the paragraph ("A centre keeps the child's file …") unchanged.
  - :3712, F-173 row, last cell: `Parallel work (S-53, shipped #<n>); split: pack picking Later`.
  - :3804, S-53 row, the "No (§11.3 step 1; …)" cell: append ` Shipped #<n>.`

- [ ] **Step 2: Commit** `git add docs/crm-features.md && git commit -m "docs: S-53 tenant vetting shipped; §5.14's holds are enforced"`

- [ ] **Step 3: Rollout.** The orchestrator does this, in this order. Each migration step happens once.
  1. Final review (opus) of the whole PR. Design review: the dialog and the Settings card change visible layout.
  2. **bis-ci first:**
     - `gh workflow run ci-project-setup.yml --ref feat/s53-tenant-vetting -f step=push-dry-run`. Read the artifact: it must list exactly `0101_account_trade.sql`.
     - Then `-f step=push`.
     - Then `-f step=migration-history`: 0101 is present.
     - The PR's `e2e` job enforces this (`ci-migrations-applied.sh`).
  3. **Production:** Supabase MCP `apply_migration` on `tlbkbmlrfafquucsmsmm`, name `0101_account_trade`, body = the file, once. Never re-apply. Then read back with `execute_sql` (read-only):
     - `select conname from pg_constraint where conrelid='public.accounts'::regclass and conname like 'accounts_trade%'` → 3 rows.
     - The digest query from `proposals-drop.test.ts:94-98` → `52|b66203ca5d355155540b520af510d120`.
  4. **Parity** (`docs/runbooks/ci-supabase-project.md` §5): fingerprint on both projects, diffed. Only the allowed differences.
  5. Merge on green: read the check runs for the HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`), squash. Confirm the production deploy.
  6. **The three production companies (spec 5.4)**, with the owner's explicit OK, through the app's Settings → Trade card, signed in as the agency:
     - Bespoke Intelligent Solutions → Other, "Marketing and AI receptionist agency".
     - 956 Woodworks → Woodworking and cabinets.
     - Resaca Air Conditioning & Heating → Heating and air conditioning.

     Verify read-only: `select name, trade, trade_other from accounts order by name`.

     Until this step, these companies' already-on Sofía and web chat keep working (nothing is gated at call time). Only new switch-ons are refused.
  7. Optional, bis-ci: set `Test Client One`'s trade to `hvac` through Vercel Preview's Settings, so Preview's Voice page shows no lock. CI's own stacks seed it with `hvac` already (Task 3).
  8. Update the execution ledger (`.superpowers/sdd/progress.md`), the roadmap tracker's S-53 / F-173 rows (memory `bis-roadmap-tracker`) and memory `bis-next-work`.

---

## Self-review

**Spec coverage:**

| Spec | Where it is covered |
|---|---|
| §2 V1 | Tasks 4, 5, 9 |
| §2 V2 | Task 2 `checkTradeChoice`, 0101 CHECKs, Task 7 fields |
| §2 V3 | No override anywhere; the 0101 header and the trades.ts header say how a verdict changes |
| §2 V4 | Tasks 1 and 2 |
| §3 table (30 entries, labels, verdicts, reasons, creatable = 21) | Task 2; trades.test.ts pins it |
| §4 migration, grants pinned, parity test | Task 1 + Task 2's parity test |
| §5.1 Add company (required, grouped, Other ≤120, refusal before Clerk/row, crm_only note, form message not toast) | Tasks 4, 7, 9 (the note on Setup) |
| §5.2 Settings field, same validation, crm_only refused while on, clients never see | Tasks 6, 8. Settings is agency-only (`requireAgencyOnlyAccountAccess`) |
| §5.3 server enforcement, `<trade>` and no-trade sentences, already-on stays on, off never blocked, UI disabled with reason | Tasks 5, 9 |
| §5.4 existing companies | Task 11 Step 3.6 |
| §6 out of scope | Nothing implements licence checks, pack picking, client display, self-serve or regulated mode |
| §7 testing (module, DB, actions with mutation probes, e2e, bilingual) | Tasks 1, 2, 4, 5, 6, 10 |
| §8 tiers | Every task heading |

**Placeholder scan:** The only deferred value is the PR number in Task 11. It has the exact command that produces it. Two test helpers are referenced by their role ("the file's own fixture builder / page-invocation helper"). Their contracts (assertions) are given in full, and their names vary per file. The implementer reads the file once.

**Type consistency:** These names are used identically across tasks:
- `checkTradeChoice` → `TradeChoiceCheck` (`ok`/`problem`/`entry`/`choice`/`verdict`)
- `sofiaGate` → `SofiaGate` (`reason: "crm_only" | "no_trade"`, `trade`)
- `sofiaGateText(gate, locale, pseudo?)`
- `sofiaSwitchOnRefusal(accountId, locale?)`
- `sofiaIsOn(profile, numbers)`
- `getAccountTrade` → `{ trade, tradeOther }`
- `setAccountTrade(db, id, { trade, tradeOther }, actorId)`
- `createAccount({ trade, tradeOther })`
- `TradeSetup` / `TradeFieldsCopy` / `TradeFields` / `TradePicker`
- `vettingLock?: string | null`
- `SetupInputs.trade?`
- Form fields `trade` / `tradeOther` / `locale`

## Spec gaps resolved in this plan (recommendations; flag any you disagree with)

1. **The spec's two CHECK expressions admit NULL. Fixed in 0101.** In §4, `check (trade is distinct from 'other' or length(btrim(trade_other)) between 1 and 120)` passes `('other', NULL)`, and `check (trade_other is null or trade = 'other')` passes `(NULL, 'desc')`, because a CHECK that evaluates to NULL passes. Both leaks were reproduced on the replica ("2 rows admitted"). 0101 uses `trade_other is not null and …` and `is not distinct from`. Recommendation: accept; the intent is unchanged.
2. **Add as a company (adopt-orphan) also requires a trade.** The spec names only Add company. Without the check, a held or turned-away business could be taken on through the orphan path. Recommendation: accept, as Task 4 does.
3. **"Switching Sofía on" is defined as the call path defines answering.** The guarded paths are: a number to testing/live (unless it already answers), Receptionist enabled off→on, go-live, and the web chat's on switch. Assigning or moving a number is not guarded, because both leave it `provisioned`, which never answers. Turning call-forwarding off is not guarded, because it only resumes a line already answering. No call-time gate is added, because the spec says "anything already on stays on" and the three production companies have no trade until Task 11. Recommendation: accept. Revisit a call-time gate (TeXML, beside billing's `voiceBlock`) only if the owner wants a CRM-only trade to also silence an already-live line.
4. **Setup drops Sofía's steps for a CRM-only trade**, exactly as it does for a CRM-only plan. Otherwise a restaurant's Setup could never complete (`docs/crm-features.md:883`'s defect). The spec only says "the UI disables the switch". Recommendation: accept.
5. **The CRM-only sentence names the trade in lower case with a noun:** "aren't available for restaurant businesses yet" / "para el giro restaurante". The spec's "for <trade>" would read "for Restaurant yet". Recommendation: accept the wording; the owner may reword it in review.
6. **Clients can READ `accounts.trade` through the data API.** `accounts` SELECT is table-level for an account's own members. The app never shows it (spec 5.2 is met in the UI), and a trade is not secret. Hiding it would mean moving `accounts` to column-level SELECT grants, a larger change. Recommendation: accept, and note it.
7. **An agency session could INSERT an account with a creatable trade straight through the data API.** This uses the table-level INSERT it has had since 0001. The CHECK still refuses held keys. Recommendation: accept; the agency is the vetter.
8. **Refusals on the Add company and Add as a company dialogs all move from toast to the inline form message,** not only the trade ones, so a dialog has one place for its answer. Recommendation: accept.
