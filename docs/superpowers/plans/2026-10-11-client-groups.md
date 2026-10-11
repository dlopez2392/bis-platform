# Client groups and the business name: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: `docs/superpowers/specs/2026-10-11-client-groups-design.md` (owner decisions G1 to G11 and rulings §13.1 to §13.3 are settled; do not re-open them).

**Goal:** A customer can belong to households and business customers, with a role, one main group and a "pays the bills" flag; `contacts.company_name` becomes a business group, backfilled, and from now on every writer of it writes the group while the database keeps the column as a derived copy.

**Architecture:** Migration 0069 adds `client_groups` and `client_group_members` (composite same-account FKs, SELECT-only for the client role, tenant read plus 0068-style restrictive Technician policies), service-role-only plpgsql write functions, a SECURITY DEFINER trigger that keeps `contacts.company_name` equal to the contact's business group name, and an idempotent `reconcile_business_groups()` backfill that the migration calls. `@bis/db` gets one module, `client-groups.ts`. Every app write proves its target through the request client, then writes through the service client. The UI is one Groups card on the drawer and the contact page, and the Business name field becomes a group write with a server-built Undo.

**Tech Stack:** Next 16 App Router (server actions, route handlers), Clerk, Supabase Postgres (RLS, PostgREST, plpgsql), supabase-js, vitest 4, Playwright.

## Global Constraints

- Tokens only: no hard-coded colours, radii or shadows (DESIGN.md). Rule 3 (status is dot + word: "Main group", "Pays the bills"), rule 5 (loaded, empty, error states, per card), rule 6 (reversible actions run at once with an Undo toast), rule 7 (skeletons, no spinners), Record views (inline edit, save on blur, Undo toast), the module contract (no new top-level page; G2).
- Kind labels: "Household" / "Familia", "Business customer" / "Cliente comercial". NEVER the word "Company" for a group or for the contact's business field (G4). The field's label is "Business name" / "Nombre del negocio" (A5).
- Kinds in this release: `household` and `business` only (G4). Business names are unique per account by the key `lower(btrim(name, WS))`; household names are not (G10).
- `WS` is 0034's explicit whitespace class spelled without a backslash: `' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(160)`. The migration file contains NO backslash at all (0050:86; memory "MCP SQL escapes"). There is no TypeScript twin of the key.
- `authenticated` gets SELECT only on both new tables; `schema-grants-guard.test.ts`'s `EXPECTED_WRITES` does NOT change (spec §5.2). Every write function is `revoke all … from public, anon, authenticated, service_role; grant execute … to service_role`.
- A Technician sees a group and its memberships only through their own customers (G8); they never rename a group or edit its billing address (A6); a business they type that already exists is linked (G11).
- `contacts.company_name` is KEPT (G9). After this release no app code writes it; only the sync trigger and `reconcile_business_groups()` do. `ContactInput` loses `companyName`.
- Migrations are applied by the orchestrator only: CI project (`ci-project-setup.yml`), then production via MCP `apply_migration`, then the parity check, all before merge, each exactly once. An implementer applies 0069 to its OWN local PG18 replica only, on the port its task names (memory "Local DB replica").
- Every implementer and every reviewer works in its OWN scratch subdirectory of the session scratchpad (`$SCRATCH/s02a-t<N>/`, `$SCRATCH/s02a-t<N>-review/`) and never touches another's. NEVER `git stash` (it has eaten another agent's work in this worktree). Reviewers read committed code with `git show <sha>:<path>`.
- Agents run only the affected tests, by path. `pnpm check`, `pnpm --filter web build` and `pnpm --filter web test:e2e` belong to the orchestrator, one at a time.
- Judge `@bis/db` runs by vitest's own summary block: `pnpm --filter @bis/db exec vitest run …` prints a trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` after the real results.
- `@bis/db` tests built on `withTestAccount`/`serviceDb` need PostgREST with 0069 applied. Run them against a local PostgREST if you have one (memory "Local DB replica", 2026-10-08 addition 3); otherwise say so in the report, and the orchestrator pushes the branch so CI `verify` (an in-runner stack that applies every migration in the branch) runs them. Never apply 0069 to bis-ci to run tests.
- A task that adds a NEW named import from `@bis/db` to an existing module must add that name to every `vi.mock("@bis/db", ...)` factory reaching the module. Find them with `grep -rln 'vi.mock("@bis/db"' apps/web/src apps/web/e2e | xargs grep -ln "<module file name without extension>"`; a missing export throws `[vitest] No "<name>" export is defined on the mock` at call time.
- Every test must be able to fail. Each task names ONE required mutation probe: apply it, see the test fail BY NAME, revert. A `-t` filter that matches nothing silently passes; check the run count.
- Copy: every new string goes in `apps/web/src/lib/messages.ts` with a `.es` twin. The drawer and the contact page read `m["…"]` (English) today; the twins are written anyway (spec §8). Edits to `messages.ts` run sequentially (Task 3c, then Task 6). Spanish uses `usted`.
- Never mutate Test Client One or any live account. e2e runs on the per-run `E2E Client Co <stamp>` fixture only.
- Commits: `git add <explicit paths>` then `git commit -- <paths>`; never `-A`, never `.`, never push. If `.git/index.lock` exists, wait and retry; never delete it.

## Where the plan departs from the spec's wording (the source decided)

1. **Technician RLS cases get their own file, not new rows in `technician-scope.test.ts`.** Spec §9 says that file "gains both tables". Its seed builds one row per contact (`technician-scope.test.ts:177-203`) and cannot express G8's interesting case, a household shared by the Technician's customer and someone else's. `client-groups-rls.test.ts` seeds that shape with the same actor conventions.
2. **`reconcile_business_groups()` returns two more counts than spec §5.4 lists:** `skipped_too_long` (a stored `company_name` longer than 120 characters after trimming cannot become a group, whose name check is 1 to 120; the migration must not fail on it, so the contact is skipped and its column left as it is) and `respelled` (a column whose key still matches its group but whose spelling an old build changed directly; step 3 puts the group's spelling back). Spec §12 says nothing about over-long names; production's maximum is read in Task 8 step 2 before the apply.
3. **`set_contacts_business` does not hand back a pre-existing membership as `added`.** When the contact was already a member of the target business (as a non-shown membership), the function keeps that row and returns `added: null`, so an Undo never deletes a membership that existed before the edit.
4. **Undo of a Business name edit needs one additive prop on `InlineField`** (`components/inline-field.tsx`, bis-frontend's): `undoWith`, the phone field's precedent generalised. Sanctioned here as an additive edit by Task 3c's owner.
5. **The role label edits through `InlineField field="source"`**: `source`'s rule (trim, free text, no shape) is exactly the role's rule, and the 60-character cap is the database's (`client_group_members_role_check`), surfaced as an error toast.
6. **Other members open in the contact list's drawer** (`/dashboard/accounts/<id>/contacts?peek=<contactId>`, `lib/contacts/use-peek.ts:5`), not a nested drawer.
7. **`client_group_members.created_at` defaults to `clock_timestamp()`, not `now()`.** "Oldest" decides the main-group fallback and which business the copy shows (spec §5.3); `now()` is identical for every row one transaction writes, so the backfill, an import batch and every rolled-back test would order their ties by random uuid.
8. **The `company_name` grant stays this release.** Spec §11's follow-up revokes it; this plan does not touch `0053:138` or `schema-grants-guard.test.ts:77`.

---

## Task order and parallelism

| # | Task | Owner | Review | Parallel group |
|---|---|---|---|---|
| 1 | Migration 0069 + schema, RLS, functions and backfill proof on the local replica (port 55461) | bis-db-schema | **opus** | A: first, alone |
| 2 | `@bis/db` `client-groups.ts`, teardown list, barrel | bis-crm | sonnet | B: after 1, alone |
| 3a | CSV import: business beside the patch, one batch call | bis-crm | sonnet | C: after 2, parallel with 3b, 3c, 4 |
| 3b | Forms lead and demo seed write the group | bis-crm | sonnet | C |
| 3c | Business name field: action, server-built Undo, `InlineField.undoWith`, labels | bis-crm | **opus** | C (the only `messages.ts` writer in C) |
| 4 | Groups card server side: actions with proofs, the card's GET route, service-read allowlist | bis-crm | **opus** | C |
| 5 | Close the old writer: `ContactInput.companyName`, `toRow`, `FIELD_TO_INPUT_KEY`, csv type, the import's allowlist line | bis-crm | sonnet | D: after 3a, 3b, 3c and 4 |
| 6 | Groups card UI and copy, on the drawer and the contact page | bis-frontend | sonnet | D: after 3c and 4 (parallel with 5: disjoint files) |
| 7 | e2e `groups.spec.ts` on the per-run fixture account | bis-e2e-qa | sonnet | E: after 5 and 6 |
| 8 | Rollout (orchestrator, not code) | orchestrator | n/a | before merge |

Disjoint files in group C: 3a owns `lib/contacts/csv.ts`, `csv.test.ts`, `packages/db/src/contact-import.ts`, `contact-import.test.ts`, `contacts/import/actions.ts`, `import/actions.test.ts`. 3b owns `lib/forms/enrich.ts`, `app/f/[publicId]/actions*.test.ts`, the other enrich-importing tests' mock factories, `packages/db/src/demo/seed.ts`. 3c owns `contacts/actions.ts`, `contacts/actions.test.ts`, `contacts/[contactId]/actions.ts`, `contacts/business-field.tsx`, `contacts/contact-drawer.tsx`, `contacts/[contactId]/contact-fields-panel.tsx`, `components/inline-field.tsx`, `messages.ts`, the two i18n baselines. 4 owns `contacts/groups-actions.ts`, `groups-actions.test.ts`, `app/api/accounts/[accountId]/contacts/[contactId]/groups/route.ts`, its test, `in-account-service-reads.test.ts`. Group D: 5 owns `packages/db/src/contacts.ts`, `contacts.test.ts`, `lib/contacts/field-input.ts`, `field-input.test.ts`, one type line of `csv.ts` and one line of `in-account-service-reads.test.ts`; 6 owns `contacts/groups-card.tsx`, its test, one block of `contact-drawer.tsx`, `contacts/[contactId]/page.tsx` and `messages.ts`. Task 5 and Task 6 share no file.

Hot shared files: `packages/db/src/index.ts` (Task 2 only, additive), `messages.ts` (3c then 6), `contact-drawer.tsx` (3c then 6).

---

## Task 1: Migration 0069 and its proof

**Owner:** bis-db-schema. **Review:** opus. **Runs:** first, alone. **Replica:** port **55461**, data in `$SCRATCH/s02a-t1/`.

**Files**
- Create: `packages/db/supabase/migrations/0069_client_groups.sql`
- Create: `packages/db/src/test/client-groups-schema.test.ts`
- Create: `packages/db/src/test/client-groups-functions.test.ts`
- Create: `packages/db/src/test/client-groups-rls.test.ts`

**Interfaces**
- Consumes: `app.is_agency()`, `app.current_account_id()` (0001, 0008); `app.sees_all_customers(uuid)`, `app.my_contact_ids()` (0068:75-88); `contacts_account_id_id_key` (0050:93).
- Produces (SQL), every later task relies on these exact names:
  - Tables `public.client_groups (id, account_id, kind, name, name_key, billing_address, custom, created_at, updated_at)` and `public.client_group_members (id, account_id, client_group_id, contact_id, role, is_primary, is_billing, created_at)`.
  - `public.create_group_with_member(p_account_id uuid, p_contact_id uuid, p_kind text, p_name text, p_role text default null) returns jsonb` = `{"status":"ok","group_id","member_id","existed","name"}` | `{"status":"not_found"}` | `{"status":"invalid_name"}`.
  - `public.add_contact_to_group(p_account_id uuid, p_contact_id uuid, p_group_id uuid, p_role text default null) returns jsonb` = `{"status":"ok","member_id"}` | `{"status":"not_found"}`.
  - `public.set_contacts_business(p_account_id uuid, p_contact_ids uuid[], p_names text[]) returns jsonb` = array of `{"contact_id","status":"ok"|"unchanged"|"not_found"|"too_long","removed": <member row as jsonb> | null,"added": uuid | null}`.
  - `public.undo_set_business(p_account_id uuid, p_contact_id uuid, p_added uuid, p_removed jsonb) returns text` (`ok` | `not_found`).
  - `public.set_primary_group_membership(p_account_id uuid, p_member_id uuid) returns jsonb` = `{"status":"ok","previous": uuid | null}` | `{"status":"not_found"}`.
  - `public.remove_group_membership(p_account_id uuid, p_member_id uuid) returns jsonb` = `{"status":"ok","removed": <member row>}` | `{"status":"not_found"}`.
  - `public.restore_group_membership(p_account_id uuid, p_snapshot jsonb) returns text` (`ok` | `not_found`).
  - `public.reconcile_business_groups(p_account_id uuid default null) returns jsonb` = `{"groups_created","members_added","members_replaced","members_removed","skipped_too_long","respelled"}` (integers).
  - `app.my_client_group_ids() returns setof uuid`; the trigger `client_group_members_sync_company_name` and `client_groups_sync_company_name`.

- [ ] **Step 1: Build the replica and check the facts 0069 relies on.** In bash (never in another task's directory):

```bash
SCRATCH="<the session scratchpad your brief names>"; S="$SCRATCH/s02a-t1"; PORT=55461
PGBIN="/c/Program Files/PostgreSQL/18/bin"; W=/c/Users/danlo/bis-platform/.claude/worktrees/s02-groups
mkdir -p "$S" && "$PGBIN/initdb" -D "$S/data" -U postgres -A trust >/dev/null
"$PGBIN/pg_ctl" -D "$S/data" -o "-p $PORT" -l "$S/pg.log" start </dev/null >/dev/null 2>&1
P() { "$PGBIN/psql" -h localhost -p $PORT -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
P -c "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls; grant anon, authenticated, service_role to postgres;"
P -c "create database pre"
P -d pre -c "alter database pre set timezone to 'UTC'; create schema if not exists extensions; create schema if not exists app;"
sed -n '58,63p;72,73p' "$W/packages/db/supabase/bootstrap/ci-project.sql" | P -d pre
for f in $(ls "$W"/packages/db/supabase/migrations/00*.sql | sort); do case "$f" in *0069_*) continue;; esac; P -d pre -1 -f "$f"; done
P -d pre -At -c "select max(version) from supabase_migrations.schema_migrations" 2>/dev/null || true
P -d pre -At -c "select conname from pg_constraint where conname = 'contacts_account_id_id_key'"
P -d pre -At -c "select proname, provolatile from pg_proc where proname in ('chr','btrim','lower') and pronamespace = 'pg_catalog'::regnamespace order by 1"
P -d pre -At -c "select proname from pg_proc where pronamespace = 'app'::regnamespace and proname in ('sees_all_customers','my_contact_ids','is_agency','current_account_id') order by 1"
```

Expected: `contacts_account_id_id_key`; `btrim|i`, `chr|i`, `lower|i` (every row immutable); the four `app` functions. (`schema_migrations` does not exist on a hand-built replica; that line may print nothing.) If a migration before 0069 fails to apply, follow memory "Local DB replica" and report; do not edit an applied migration.

- [ ] **Step 2: Write the failing schema test** `packages/db/src/test/client-groups-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Client groups (spec §5.1-§5.3). As the table owner inside a rolled-back
 * transaction: constraints, cascades, grants, policies and the company_name
 * sync. A refused statement under a check or FK raises; we assert the code.
 */
const RUN = Math.random().toString(36).slice(2, 10);

// Local to this file on purpose: importing one test file from another would register its tests twice.
async function seedAccount(c: Client, org: string) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Groups Co',true) returning id",
    [agency!.id, org]);
  return a!.id;
}
const contact = async (c: Client, acct: string, first: string, company: string | null = null) =>
  (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name, company_name) values ($1,$2,$3) returning id", [acct, first, company])).rows[0]!.id;
const group = async (c: Client, acct: string, kind: string, name: string) =>
  (await c.query<{ id: string }>(
    "insert into client_groups (account_id, kind, name) values ($1,$2,$3) returning id", [acct, kind, name])).rows[0]!.id;
const member = async (c: Client, acct: string, g: string, ct: string, primary = false) =>
  (await c.query<{ id: string }>(
    "insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,$4) returning id",
    [acct, g, ct, primary])).rows[0]!.id;
const companyOf = async (c: Client, ct: string) =>
  (await c.query<{ company_name: string | null }>("select company_name from contacts where id = $1", [ct])).rows[0]!.company_name;

describe("client_groups and client_group_members: constraints", () => {
  it("refuses a membership pointing at another account's contact (mutation: make the contact FK single-column -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_a_${RUN}`);
      const b = await seedAccount(c, `org_g_b_${RUN}`);
      const g = await group(c, a, "household", "Garcia");
      const theirs = await contact(c, b, "Bea");
      await expect(member(c, a, g, theirs)).rejects.toMatchObject({ code: "23503" });
    }));
  it("refuses the same person twice in one group, and a second main group", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_g_${RUN}`);
    const ct = await contact(c, a, "Ana");
    const g1 = await group(c, a, "household", "Garcia");
    const g2 = await group(c, a, "household", "Reyes");
    await member(c, a, g1, ct, true);
    await expect(member(c, a, g1, ct)).rejects.toMatchObject({ code: "23505" });
    await expect(member(c, a, g2, ct, true)).rejects.toMatchObject({ code: "23505" });
  }));
  it("refuses a blank or whitespace-only name, an untrimmed name and a third kind", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_g_${RUN}`);
    for (const bad of ["", "   ", "\t", " "]) {
      await expect(group(c, a, "household", bad)).rejects.toMatchObject({ code: "23514" });
    }
    await expect(group(c, a, "household", " Garcia")).rejects.toMatchObject({ code: "23514" });
    await expect(group(c, a, "facility", "Sunny Days")).rejects.toMatchObject({ code: "23514" });
  }));
  it("one business per key per account; households may share a name (mutation: drop client_groups_business_key -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_${RUN}`);
      await group(c, a, "business", "Acme Roofing");
      await expect(group(c, a, "business", "ACME ROOFING")).rejects.toMatchObject({ code: "23505" });
      await group(c, a, "household", "Garcia");
      await group(c, a, "household", "Garcia");
      const b = await seedAccount(c, `org_g_b_${RUN}`);
      await group(c, b, "business", "Acme Roofing");
    }));
  it("name_key lowercases and trims the explicit whitespace class (mutation: drop lower() from app.group_name_key -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        "select app.group_name_key(x) as k from unnest($1::text[]) as x", [["Acme Roofing", " acme roofing ", "ACME ROOFING\t", " Acme Roofing\n"]]);
      expect(new Set(rows.map((r) => r.k))).toEqual(new Set(["acme roofing"]));
    }));
});

describe("cascades (spec §5.1)", () => {
  it("a deleted contact takes its memberships; a deleted group takes its memberships; a deleted account takes its groups", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_${RUN}`);
      const ct = await contact(c, a, "Ana");
      const g = await group(c, a, "household", "Garcia");
      const m1 = await member(c, a, g, ct, true);
      await c.query("delete from contacts where id = $1", [ct]);
      expect((await c.query("select 1 from client_group_members where id = $1", [m1])).rowCount).toBe(0);
      const ct2 = await contact(c, a, "Luis");
      const m2 = await member(c, a, g, ct2, true);
      await c.query("delete from client_groups where id = $1", [g]);
      expect((await c.query("select 1 from client_group_members where id = $1", [m2])).rowCount).toBe(0);
      const g2 = await group(c, a, "household", "Reyes");
      await c.query("delete from contacts where account_id = $1", [a]);
      await c.query("delete from accounts where id = $1", [a]);
      expect((await c.query("select 1 from client_groups where id = $1", [g2])).rowCount).toBe(0);
    }));
});

describe("grants and policies (spec §5.2)", () => {
  it("the client role can read but never write either table (mutation: drop the revoke of insert from authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_${RUN}`);
      await group(c, a, "household", "Garcia");
      await actAs(c, { app_role: "agency_admin", sub: `user_g_agency_${RUN}` });
      expect((await c.query("select 1 from client_groups where account_id = $1", [a])).rowCount).toBe(1); // positive control
      await expect(c.query("insert into client_groups (account_id, kind, name) values ($1,'household','X')", [a]))
        .rejects.toMatchObject({ code: "42501" });
    }));
  it("the client role cannot update a membership either", () => withRollback(async (c) => {
    await actAs(c, { app_role: "agency_admin", sub: `user_g_agency_${RUN}` });
    await expect(c.query("update client_group_members set is_billing = true")).rejects.toMatchObject({ code: "42501" });
  }));
  it("has exactly the four policies (mutation: drop client_groups_technician_scope -> FAILS)", () => withRollback(async (c) => {
    const { rows } = await c.query(
      `select tablename, policyname, permissive, cmd, roles::text as roles from pg_policies
        where schemaname = 'public' and tablename in ('client_groups','client_group_members')
        order by tablename collate "C", policyname collate "C"`);
    const row = (t: string, p: string, permissive: string) => ({ tablename: t, policyname: p, permissive, cmd: "SELECT", roles: "{authenticated}" });
    expect(rows).toEqual([
      row("client_group_members", "client_group_members_member_read", "PERMISSIVE"),
      row("client_group_members", "client_group_members_technician_scope", "RESTRICTIVE"),
      row("client_groups", "client_groups_member_read", "PERMISSIVE"),
      row("client_groups", "client_groups_technician_scope", "RESTRICTIVE"),
    ]);
  }));
  it("every write function is executable by service_role only (mutation: grant execute on set_contacts_business to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const fns = [
        "public.create_group_with_member(uuid,uuid,text,text,text)", "public.add_contact_to_group(uuid,uuid,uuid,text)",
        "public.set_contacts_business(uuid,uuid[],text[])", "public.undo_set_business(uuid,uuid,uuid,jsonb)",
        "public.set_primary_group_membership(uuid,uuid)", "public.remove_group_membership(uuid,uuid)",
        "public.restore_group_membership(uuid,jsonb)", "public.reconcile_business_groups(uuid)",
        "app.company_name_for(uuid)", "app.lock_contact(uuid,uuid)", "app.promote_primary(uuid)",
        "app.link_member(uuid,uuid,uuid,text,boolean)", "app.find_or_create_business(uuid,text)", "app.restore_member(uuid,jsonb)",
      ];
      for (const f of fns) {
        const { rows: [r] } = await c.query(
          `select has_function_privilege('service_role', $1, 'execute') as svc,
                  has_function_privilege('authenticated', $1, 'execute') as auth,
                  has_function_privilege('anon', $1, 'execute') as anon`, [f]);
        expect(r, f).toEqual({ svc: true, auth: false, anon: false });
      }
      const { rows: [mine] } = await c.query(
        "select has_function_privilege('authenticated', 'app.my_client_group_ids()', 'execute') as auth, has_function_privilege('anon', 'app.my_client_group_ids()', 'execute') as anon");
      expect(mine).toEqual({ auth: true, anon: false });
    }));
});

describe("the company_name sync (spec §5.3, A2)", () => {
  it("follows insert, main-then-age order, rename and removal; a household never sets it (mutation: drop trigger client_groups_sync_company_name -> the rename case FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_g_${RUN}`);
      const ct = await contact(c, a, "Ana");
      const home = await group(c, a, "household", "Garcia");
      await member(c, a, home, ct, true);
      expect(await companyOf(c, ct)).toBeNull();
      const acme = await group(c, a, "business", "Acme Roofing");
      const mAcme = await member(c, a, acme, ct);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
      const beta = await group(c, a, "business", "Beta Pools");
      const mBeta = await member(c, a, beta, ct);
      expect(await companyOf(c, ct)).toBe("Acme Roofing"); // oldest business wins while neither is main
      await c.query("update client_group_members set is_primary = false where contact_id = $1", [ct]);
      await c.query("update client_group_members set is_primary = true where id = $1", [mBeta]);
      expect(await companyOf(c, ct)).toBe("Beta Pools"); // the main one wins
      await c.query("update client_groups set name = 'Beta Pools & Spas' where id = $1", [beta]);
      expect(await companyOf(c, ct)).toBe("Beta Pools & Spas");
      await c.query("delete from client_group_members where id = $1", [mBeta]);
      expect(await companyOf(c, ct)).toBe("Acme Roofing");
      await c.query("delete from client_group_members where id = $1", [mAcme]);
      expect(await companyOf(c, ct)).toBeNull();
    }));
  it("never touches updated_at", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_g_${RUN}`);
    const ct = await contact(c, a, "Ana");
    await c.query("update contacts set updated_at = '2026-01-01T00:00:00Z' where id = $1", [ct]);
    await member(c, a, await group(c, a, "business", "Acme"), ct, true);
    const { rows: [r] } = await c.query<{ u: string }>("select updated_at::text as u from contacts where id = $1", [ct]);
    expect(r!.u).toBe("2026-01-01 00:00:00+00");
  }));
});
```

- [ ] **Step 3: Write the failing functions and backfill test** `packages/db/src/test/client-groups-functions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback } from "./db";

const RUN = Math.random().toString(36).slice(2, 10);
async function seedAccount(c: Client, org: string) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const { rows: [a] } = await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Groups Co',true) returning id",
    [agency!.id, org]);
  return a!.id;
}
const contact = async (c: Client, acct: string, first: string, company: string | null = null, createdAt = "2026-01-01T00:00:00Z") =>
  (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name, company_name, created_at) values ($1,$2,$3,$4) returning id",
    [acct, first, company, createdAt])).rows[0]!.id;
const call = async (c: Client, sql: string, args: unknown[]) => (await c.query<{ r: unknown }>(`select ${sql} as r`, args)).rows[0]!.r;
const members = async (c: Client, ct: string) =>
  (await c.query<{ name: string; is_primary: boolean; role: string | null; is_billing: boolean }>(
    `select g.name, m.is_primary, m.role, m.is_billing from client_group_members m join client_groups g on g.id = m.client_group_id
      where m.contact_id = $1 order by m.created_at, m.id`, [ct])).rows;
const companyOf = async (c: Client, ct: string) =>
  (await c.query<{ company_name: string | null }>("select company_name from contacts where id = $1", [ct])).rows[0]!.company_name;

describe("create_group_with_member and add_contact_to_group", () => {
  it("a business that already exists is linked, not duplicated; the first membership is main", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_${RUN}`);
    const ana = await contact(c, a, "Ana");
    const luis = await contact(c, a, "Luis");
    const first = await call(c, "public.create_group_with_member($1,$2,'business',$3,'Dueña')", [a, ana, " Acme Roofing "]) as Record<string, unknown>;
    expect(first).toMatchObject({ status: "ok", existed: false, name: "Acme Roofing" });
    const second = await call(c, "public.create_group_with_member($1,$2,'business',$3)", [a, luis, "acme roofing"]) as Record<string, unknown>;
    expect(second).toMatchObject({ status: "ok", existed: true, group_id: first.group_id, name: "Acme Roofing" });
    expect(await members(c, ana)).toEqual([{ name: "Acme Roofing", is_primary: true, role: "Dueña", is_billing: false }]);
  }));
  it("refuses a contact or group from another account", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_a_${RUN}`);
    const b = await seedAccount(c, `org_f_b_${RUN}`);
    const theirs = await contact(c, b, "Bea");
    expect(await call(c, "public.create_group_with_member($1,$2,'household','Garcia')", [a, theirs])).toEqual({ status: "not_found" });
    const g = (await call(c, "public.create_group_with_member($1,$2,'household','Reyes')", [b, theirs]) as { group_id: string }).group_id;
    const mine = await contact(c, a, "Ana");
    expect(await call(c, "public.add_contact_to_group($1,$2,$3)", [a, mine, g])).toEqual({ status: "not_found" });
  }));
});

describe("set_contacts_business, undo, main, remove, restore", () => {
  it("replace keeps main, blank removes and promotes, same key is unchanged (mutation: link the new business with p_primary false -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_f_${RUN}`);
      const ana = await contact(c, a, "Ana");
      await call(c, "public.create_group_with_member($1,$2,'household','Garcia')", [a, ana]); // main
      const r1 = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["Acme Roofing"]]) as Array<Record<string, unknown>>;
      expect(r1[0]).toMatchObject({ status: "ok", removed: null });
      expect(await companyOf(c, ana)).toBe("Acme Roofing");
      // Two statements: a non-deferrable unique index is checked row by row, so one UPDATE that moves
      // the main flag between two rows can trip client_group_members_one_primary mid-statement.
      await c.query("update client_group_members set is_primary = false where contact_id = $1", [ana]);
      await c.query(
        "update client_group_members set is_primary = true where contact_id = $1 and client_group_id = (select id from client_groups where account_id = $2 and name = 'Acme Roofing')",
        [ana, a]);
      const r2 = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["Beta Pools"]]) as Array<Record<string, unknown>>;
      expect(r2[0]).toMatchObject({ status: "ok" });
      expect((r2[0]!.removed as { is_primary: boolean }).is_primary).toBe(true);
      expect(await members(c, ana)).toEqual([
        { name: "Garcia", is_primary: false, role: null, is_billing: false },
        { name: "Beta Pools", is_primary: true, role: null, is_billing: false },
      ]);
      const r3 = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["BETA POOLS "]]) as Array<Record<string, unknown>>;
      expect(r3[0]).toMatchObject({ status: "unchanged", removed: null, added: null });
      const r4 = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["   "]]) as Array<Record<string, unknown>>;
      expect(r4[0]).toMatchObject({ status: "ok", added: null });
      expect(await members(c, ana)).toEqual([{ name: "Garcia", is_primary: true, role: null, is_billing: false }]);
      expect(await companyOf(c, ana)).toBeNull();
    }));
  it("too long, another account's contact and mismatched arrays", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_a_${RUN}`);
    const b = await seedAccount(c, `org_f_b_${RUN}`);
    const ana = await contact(c, a, "Ana");
    const bea = await contact(c, b, "Bea");
    const r = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana, bea], ["x".repeat(121), "Acme"]]) as Array<Record<string, unknown>>;
    expect(r.map((x) => x.status)).toEqual(["too_long", "not_found"]);
    await expect(call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], []])).rejects.toMatchObject({ code: "22023" });
  }));
  it("undo puts back exactly the membership the edit replaced", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_${RUN}`);
    const ana = await contact(c, a, "Ana");
    await call(c, "public.create_group_with_member($1,$2,'business','Acme Roofing','Dueña')", [a, ana]);
    await c.query("update client_group_members set is_billing = true where contact_id = $1", [ana]);
    const [r] = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["Beta Pools"]]) as Array<{ added: string; removed: unknown }>;
    expect(await call(c, "public.undo_set_business($1,$2,$3,$4)", [a, ana, r!.added, JSON.stringify(r!.removed)])).toBe("ok");
    expect(await members(c, ana)).toEqual([{ name: "Acme Roofing", is_primary: true, role: "Dueña", is_billing: true }]);
    expect(await companyOf(c, ana)).toBe("Acme Roofing");
  }));
  it("a business the contact already belonged to is kept, and never handed back as added", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_${RUN}`);
    const ana = await contact(c, a, "Ana");
    await call(c, "public.create_group_with_member($1,$2,'business','Acme Roofing')", [a, ana]);
    await call(c, "public.create_group_with_member($1,$2,'business','Beta Pools')", [a, ana]);
    const [r] = await call(c, "public.set_contacts_business($1,$2::uuid[],$3::text[])", [a, [ana], ["Beta Pools"]]) as Array<{ added: string | null }>;
    expect(r!.added).toBeNull();
    expect(await members(c, ana)).toEqual([{ name: "Beta Pools", is_primary: true, role: null, is_billing: false }]);
  }));
  it("make main returns the previous main; remove promotes the oldest; restore is exact", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_f_${RUN}`);
    const ana = await contact(c, a, "Ana");
    const g1 = await call(c, "public.create_group_with_member($1,$2,'household','Garcia','Madre')", [a, ana]) as { member_id: string };
    const g2 = await call(c, "public.create_group_with_member($1,$2,'household','Reyes')", [a, ana]) as { member_id: string };
    expect(await call(c, "public.set_primary_group_membership($1,$2)", [a, g2.member_id])).toEqual({ status: "ok", previous: g1.member_id });
    const removed = await call(c, "public.remove_group_membership($1,$2)", [a, g2.member_id]) as { removed: unknown };
    expect(await members(c, ana)).toEqual([{ name: "Garcia", is_primary: true, role: "Madre", is_billing: false }]);
    expect(await call(c, "public.restore_group_membership($1,$2)", [a, JSON.stringify(removed.removed)])).toBe("ok");
    expect(await members(c, ana)).toEqual([
      { name: "Garcia", is_primary: false, role: "Madre", is_billing: false },
      { name: "Reyes", is_primary: true, role: null, is_billing: false },
    ]);
    const { rows: [same] } = await c.query("select count(*)::int as n from client_group_members where id = $1", [g2.member_id]);
    expect(same).toEqual({ n: 1 });
  }));
});

describe("reconcile_business_groups (spec §5.4)", () => {
  it("one group per key, named by the oldest; blanks make nothing; two accounts make two; a second run returns zeros (mutation: order the distinct-on by c.created_at desc -> the naming case FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_r_a_${RUN}`);
      const b = await seedAccount(c, `org_r_b_${RUN}`);
      const late = await contact(c, a, "Late", " acme roofing ", "2026-03-01T00:00:00Z");
      const old = await contact(c, a, "Old", "Acme Roofing", "2026-01-01T00:00:00Z");
      const tab = await contact(c, a, "Tab", "ACME ROOFING\t", "2026-02-01T00:00:00Z");
      const blanks = [await contact(c, a, "N", null), await contact(c, a, "E", ""), await contact(c, a, "S", "   "), await contact(c, a, "B", " ")];
      const other = await contact(c, b, "Bea", "Acme Roofing");
      // Scoped per account: a NULL scope would sweep every row the shared test database holds.
      const first = await call(c, "public.reconcile_business_groups($1)", [a]) as Record<string, number>;
      await call(c, "public.reconcile_business_groups($1)", [b]);
      const { rows: groups } = await c.query<{ account_id: string; name: string }>(
        "select account_id, name from client_groups where account_id = any($1::uuid[]) order by account_id", [[a, b]]);
      expect(groups.filter((g) => g.account_id === a)).toEqual([{ account_id: a, name: "Acme Roofing" }]);
      expect(groups.filter((g) => g.account_id === b)).toHaveLength(1);
      for (const ct of [late, old, tab]) expect(await companyOf(c, ct)).toBe("Acme Roofing");
      for (const ct of blanks) expect(await members(c, ct)).toEqual([]);
      expect(await companyOf(c, blanks[2]!)).toBe("   "); // left as it is
      expect(await members(c, other)).toHaveLength(1);
      expect(first).toMatchObject({ groups_created: 1, members_added: 3, respelled: 0 });
      const second = await call(c, "public.reconcile_business_groups($1)", [a]) as Record<string, number>;
      expect(second).toEqual({
        groups_created: 0, members_added: 0, members_replaced: 0, members_removed: 0, skipped_too_long: 0, respelled: 0 });
    }));
  it("repairs what an old build wrote directly: relinks a changed name, unlinks a cleared one, restores a respelling", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, `org_r_${RUN}`);
      const ana = await contact(c, a, "Ana", "Acme Roofing");
      const luis = await contact(c, a, "Luis", "Acme Roofing");
      const eva = await contact(c, a, "Eva", "Acme Roofing");
      await call(c, "public.reconcile_business_groups($1)", [a]);
      await c.query("update contacts set company_name = 'Beta Pools' where id = $1", [ana]);
      await c.query("update contacts set company_name = null where id = $1", [luis]);
      await c.query("update contacts set company_name = 'ACME roofing' where id = $1", [eva]);
      const r = await call(c, "public.reconcile_business_groups($1)", [a]) as Record<string, number>;
      expect(r).toMatchObject({ members_replaced: 1, members_removed: 1, respelled: 1 });
      expect(await members(c, ana)).toEqual([{ name: "Beta Pools", is_primary: true, role: null, is_billing: false }]);
      expect(await members(c, luis)).toEqual([]);
      expect(await companyOf(c, eva)).toBe("Acme Roofing");
    }));
  it("skips a name too long to be a group and leaves its column alone", () => withRollback(async (c) => {
    const a = await seedAccount(c, `org_r_${RUN}`);
    const long = "L".repeat(130);
    const ct = await contact(c, a, "Lo", long);
    const r = await call(c, "public.reconcile_business_groups($1)", [a]) as Record<string, number>;
    expect(r.skipped_too_long).toBe(1);
    expect(await companyOf(c, ct)).toBe(long);
  }));
});
```

- [ ] **Step 4: Write the failing RLS test** `packages/db/src/test/client-groups-rls.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * G8: a Technician sees a group only through a customer assigned to them,
 * and only THAT member. Owner, Staff and the agency see everything their
 * tenant policy allows; a login with no membership and another account see
 * nothing.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_grls_${RUN}`;
const ORG_B = `org_grls_b_${RUN}`;
const SUB = { owner: `u_g_owner_${RUN}`, staff: `u_g_staff_${RUN}`, tech: `u_g_tech_${RUN}`, tech2: `u_g_tech2_${RUN}`, none: `u_g_none_${RUN}`, ownerB: `u_g_ownerb_${RUN}` } as const;
type Person = keyof typeof SUB;
const claims = (p: Person | "agency") =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_g_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'G Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'G B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<Person, string>;
  for (const k of Object.keys(SUB) as Person[]) u[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (who: string | null, name: string, a = acct) => one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [a, name, who]);
  const mine = await ct(u.tech, "Mine");
  const theirs = await ct(u.tech2, "Theirs");
  const g = (kind: string, name: string, a = acct) => one("insert into client_groups (account_id, kind, name) values ($1,$2,$3) returning id", [a, kind, name]);
  const shared = await g("household", "Garcia");
  const onlyTheirs = await g("business", "Beta Pools");
  const m = (grp: string, contact: string, primary: boolean, a = acct) =>
    one("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,$4) returning id", [a, grp, contact, primary]);
  const mineInShared = await m(shared, mine, true);
  const theirsInShared = await m(shared, theirs, true);
  const theirsInBeta = await m(onlyTheirs, theirs, false);
  const bContact = await ct(null, "B person", acctB);
  const bGroup = await g("household", "Other Co household", acctB);
  await m(bGroup, bContact, true, acctB);
  return { acct, shared, onlyTheirs, mineInShared, theirsInShared, theirsInBeta, bGroup };
}
const ids = async (c: Client, table: string, acct: string) =>
  (await c.query<{ id: string }>(`select id from ${table} where account_id = $1 order by id`, [acct])).rows.map((r) => r.id);

describe("G8: the Technician sees a group only through their own customer (mutation: drop client_group_members_technician_scope -> FAILS)", () => {
  it("sees the shared household and THEIR membership only, never the co-member or a group with none of theirs", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("tech"));
      expect(await ids(c, "client_groups", s.acct)).toEqual([s.shared]);
      expect(await ids(c, "client_group_members", s.acct)).toEqual([s.mineInShared]);
    }));
});

describe("Owner, Staff and the agency see the whole account", () => {
  for (const p of ["owner", "staff", "agency"] as const) {
    it(`${p}: every group and membership`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims(p));
      expect(await ids(c, "client_groups", s.acct)).toEqual([s.shared, s.onlyTheirs].sort());
      expect(await ids(c, "client_group_members", s.acct)).toEqual([s.mineInShared, s.theirsInShared, s.theirsInBeta].sort());
    }));
  }
});

describe("tenant isolation and the NULL guard", () => {
  it("another account's Owner and a login with no membership see none of it", () => withRollback(async (c) => {
    const s = await seed(c);
    for (const p of ["ownerB", "none"] as const) {
      await c.query("reset role");
      await actAs(c, claims(p));
      expect(await ids(c, "client_groups", s.acct), p).toEqual([]);
      expect(await ids(c, "client_group_members", s.acct), p).toEqual([]);
    }
  }));
});
```

- [ ] **Step 5: Run the three tests against `pre` and see them fail.**

Run: `cd /c/Users/danlo/bis-platform/.claude/worktrees/s02-groups/packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55461/pre pnpm exec vitest run src/test/client-groups-schema.test.ts src/test/client-groups-functions.test.ts src/test/client-groups-rls.test.ts`
Expected: every case FAILS with `relation "client_groups" does not exist` or `function app.group_name_key(text) does not exist`. Paste one failing line and the summary line.

- [ ] **Step 6: Write the migration** `packages/db/supabase/migrations/0069_client_groups.sql`:

```sql
-- 0069_client_groups.sql -- Client groups and the business name
-- (docs/superpowers/specs/2026-10-11-client-groups-design.md, section 5)
--
-- A customer can belong to households and business customers. Two tables, written by server code only
-- (0053's pattern): the client role reads them under the tenant policy plus 0068's restrictive Technician
-- policy, and writes nothing. contacts.company_name becomes a COPY the database keeps: the trigger in
-- section 6 sets it to the contact's business group name (main first, then oldest), and
-- reconcile_business_groups() (section 8) backfills a business group per distinct name per account.
-- ASCII only, no backslash anywhere (0050's rule; the MCP apply has mangled escapes before).
--
-- APPLY ORDER: CI project (ci-project-setup.yml push-dry-run, then push), then production (MCP
-- apply_migration), then the parity check, then merge. After the new app is live the orchestrator runs
-- select public.reconcile_business_groups(); once on each project (spec section 11).
--
-- ROLLBACK (revert the app first; the old build reads company_name, which stays filled):
--   drop table public.client_group_members; drop table public.client_groups;
--   drop function public.create_group_with_member(uuid,uuid,text,text,text), public.add_contact_to_group(uuid,uuid,uuid,text),
--     public.set_contacts_business(uuid,uuid[],text[]), public.undo_set_business(uuid,uuid,uuid,jsonb),
--     public.set_primary_group_membership(uuid,uuid), public.remove_group_membership(uuid,uuid),
--     public.restore_group_membership(uuid,jsonb), public.reconcile_business_groups(uuid);
--   drop function app.sync_company_name(), app.company_name_for(uuid), app.lock_contact(uuid,uuid), app.promote_primary(uuid),
--     app.link_member(uuid,uuid,uuid,text,boolean), app.find_or_create_business(uuid,text), app.restore_member(uuid,jsonb),
--     app.my_client_group_ids(), app.group_name_key(text), app.group_ws();
--   Lost: households, roles, main and pays flags and billing addresses made since. Export them first.

set local lock_timeout = '5s';

-- 1. The name key. 0034's explicit whitespace class, spelled with chr() so this file holds no backslash.
create function app.group_ws() returns text
language sql immutable parallel safe set search_path = '' as $$
  select ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(160)
$$;
create function app.group_name_key(p_name text) returns text
language sql immutable parallel safe set search_path = '' as $$
  select lower(btrim(coalesce(p_name, ''), app.group_ws()))
$$;

-- 2. Tables. Composite FKs (0050) make a crossed row unwritable. account_id cascades so an old build's
--    teardown, which does not list these tables, still succeeds; contacts still refuse an account delete.
create table public.client_groups (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  kind text not null constraint client_groups_kind_check check (kind in ('household', 'business')),
  name text not null
    constraint client_groups_name_check check (char_length(btrim(name, app.group_ws())) between 1 and 120)
    constraint client_groups_name_trimmed check (name = btrim(name, app.group_ws())),
  name_key text generated always as (app.group_name_key(name)) stored,
  billing_address text constraint client_groups_billing_address_check
    check (billing_address is null or char_length(btrim(billing_address, app.group_ws())) between 1 and 300),
  custom jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_groups_account_id_id_key unique (account_id, id)
);

create table public.client_group_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  client_group_id uuid not null,
  contact_id uuid not null,
  role text constraint client_group_members_role_check check (role is null or char_length(role) between 1 and 60),
  is_primary boolean not null default false,
  is_billing boolean not null default false,
  -- clock_timestamp(), not now(): "oldest" orders the main-group fallback and the company_name copy, and
  -- now() is the same for every row one transaction writes (the backfill, an import batch, a test).
  created_at timestamptz not null default clock_timestamp(),
  constraint client_group_members_group_fkey foreign key (account_id, client_group_id)
    references public.client_groups(account_id, id) on delete cascade,
  constraint client_group_members_contact_fkey foreign key (account_id, contact_id)
    references public.contacts(account_id, id) on delete cascade,
  constraint client_group_members_group_contact_key unique (client_group_id, contact_id)
);

create unique index client_groups_business_key on public.client_groups (account_id, name_key) where kind = 'business';
create index client_groups_account_key on public.client_groups (account_id, name_key);
create unique index client_group_members_one_primary on public.client_group_members (contact_id) where is_primary;
create index client_group_members_contact on public.client_group_members (account_id, contact_id);

-- 3. Read-only for the client role. A new table gets Supabase's default ALL again.
alter table public.client_groups enable row level security;
alter table public.client_group_members enable row level security;
revoke all on public.client_groups, public.client_group_members from anon;
revoke insert, update, delete, truncate, references, trigger, maintain
  on public.client_groups, public.client_group_members from authenticated;
create policy client_groups_member_read on public.client_groups for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy client_group_members_member_read on public.client_group_members for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

-- 4. The Technician (G8): a group only through a customer assigned to them, and only that member.
create function app.my_client_group_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.client_group_id from public.client_group_members m
   where m.account_id = app.current_account_id() and m.contact_id in (select app.my_contact_ids())
$$;
create policy client_group_members_technician_scope on public.client_group_members as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()));
create policy client_groups_technician_scope on public.client_groups as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or id in (select app.my_client_group_ids()));

-- 5. Private helpers for the write functions.
create function app.company_name_for(p_contact_id uuid) returns text
language sql stable set search_path = '' as $$
  select g.name from public.client_group_members m
    join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
   where m.contact_id = p_contact_id and g.kind = 'business'
   order by m.is_primary desc, m.created_at, m.id
   limit 1
$$;

create function app.lock_contact(p_account_id uuid, p_contact_id uuid) returns boolean
language plpgsql set search_path = '' as $$
begin
  perform 1 from public.contacts where id = p_contact_id and account_id = p_account_id for no key update;
  return found;
end $$;

create function app.promote_primary(p_contact_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.client_group_members where contact_id = p_contact_id and is_primary) then
    update public.client_group_members set is_primary = true
     where id = (select id from public.client_group_members where contact_id = p_contact_id order by created_at, id limit 1);
  end if;
end $$;

create function app.link_member(p_account_id uuid, p_group_id uuid, p_contact_id uuid, p_role text, p_primary boolean)
returns uuid language plpgsql set search_path = '' as $$
declare v_member uuid;
begin
  if coalesce(p_primary, false) then
    update public.client_group_members set is_primary = false where contact_id = p_contact_id and is_primary;
  end if;
  insert into public.client_group_members (account_id, client_group_id, contact_id, role, is_primary)
  values (p_account_id, p_group_id, p_contact_id, nullif(btrim(coalesce(p_role, ''), app.group_ws()), ''),
          coalesce(p_primary, false)
          or not exists (select 1 from public.client_group_members x where x.contact_id = p_contact_id))
  on conflict (client_group_id, contact_id) do nothing
  returning id into v_member;
  if v_member is null then
    select id into v_member from public.client_group_members where client_group_id = p_group_id and contact_id = p_contact_id;
    if coalesce(p_primary, false) then
      update public.client_group_members set is_primary = true where id = v_member;
    end if;
  end if;
  return v_member;
end $$;

create function app.find_or_create_business(p_account_id uuid, p_name text, out group_id uuid, out existed boolean)
language plpgsql set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''), app.group_ws());
begin
  select g.id into group_id from public.client_groups g
   where g.account_id = p_account_id and g.kind = 'business' and g.name_key = app.group_name_key(v_name);
  if group_id is not null then existed := true; return; end if;
  insert into public.client_groups (account_id, kind, name) values (p_account_id, 'business', v_name)
  on conflict (account_id, name_key) where kind = 'business' do nothing
  returning id into group_id;
  existed := group_id is null;
  if group_id is null then
    select g.id into group_id from public.client_groups g
     where g.account_id = p_account_id and g.kind = 'business' and g.name_key = app.group_name_key(v_name);
  end if;
end $$;

create function app.restore_member(p_account_id uuid, p_snapshot jsonb) returns text
language plpgsql set search_path = '' as $$
declare
  v_contact uuid := (p_snapshot ->> 'contact_id')::uuid;
  v_group uuid := (p_snapshot ->> 'client_group_id')::uuid;
  v_primary boolean := coalesce((p_snapshot ->> 'is_primary')::boolean, false);
begin
  perform 1 from public.client_groups where id = v_group and account_id = p_account_id;
  if not found then return 'not_found'; end if;
  perform 1 from public.contacts where id = v_contact and account_id = p_account_id;
  if not found then return 'not_found'; end if;
  if exists (select 1 from public.client_group_members where client_group_id = v_group and contact_id = v_contact) then
    return 'ok';
  end if;
  if v_primary then
    update public.client_group_members set is_primary = false where contact_id = v_contact and is_primary;
  end if;
  insert into public.client_group_members (id, account_id, client_group_id, contact_id, role, is_primary, is_billing, created_at)
  values ((p_snapshot ->> 'id')::uuid, p_account_id, v_group, v_contact, p_snapshot ->> 'role', v_primary,
          coalesce((p_snapshot ->> 'is_billing')::boolean, false),
          coalesce((p_snapshot ->> 'created_at')::timestamptz, now()));
  return 'ok';
end $$;

-- 6. The company_name sync (spec A2). SECURITY DEFINER: it writes a column the request role may not, and
--    it fires inside cascades. It never touches updated_at and emits nothing. A household never sets it.
create function app.sync_company_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'client_groups' then
    update public.contacts c set company_name = app.company_name_for(c.id)
     where c.id in (select m.contact_id from public.client_group_members m where m.client_group_id = new.id)
       and c.company_name is distinct from app.company_name_for(c.id);
    return null;
  end if;
  if tg_op <> 'INSERT' then
    update public.contacts c set company_name = app.company_name_for(c.id)
     where c.id = old.contact_id and c.company_name is distinct from app.company_name_for(c.id);
  end if;
  if tg_op <> 'DELETE' then
    update public.contacts c set company_name = app.company_name_for(c.id)
     where c.id = new.contact_id and c.company_name is distinct from app.company_name_for(c.id);
  end if;
  return null;
end $$;
create trigger client_group_members_sync_company_name
  after insert or update or delete on public.client_group_members
  for each row execute function app.sync_company_name();
create trigger client_groups_sync_company_name
  after update of name, kind on public.client_groups
  for each row when (old.name is distinct from new.name or old.kind is distinct from new.kind)
  execute function app.sync_company_name();

-- 7. Write functions, service_role only. Each one checks every row belongs to p_account_id and serialises
--    on the contact row, so "at least one main group when any exist" holds under concurrent edits.
create function public.create_group_with_member(p_account_id uuid, p_contact_id uuid, p_kind text, p_name text, p_role text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare v_name text := btrim(coalesce(p_name, ''), app.group_ws()); v_group uuid; v_existed boolean := false;
begin
  if p_kind is null or p_kind not in ('household', 'business') then
    raise exception 'create_group_with_member: kind must be household or business' using errcode = '22023';
  end if;
  if char_length(v_name) not between 1 and 120 then return jsonb_build_object('status', 'invalid_name'); end if;
  if not app.lock_contact(p_account_id, p_contact_id) then return jsonb_build_object('status', 'not_found'); end if;
  if p_kind = 'business' then
    select f.group_id, f.existed into v_group, v_existed from app.find_or_create_business(p_account_id, v_name) f;
  else
    insert into public.client_groups (account_id, kind, name) values (p_account_id, 'household', v_name) returning id into v_group;
  end if;
  return jsonb_build_object('status', 'ok', 'group_id', v_group, 'existed', v_existed,
    'member_id', app.link_member(p_account_id, v_group, p_contact_id, p_role, false),
    'name', (select g.name from public.client_groups g where g.id = v_group));
end $$;

create function public.add_contact_to_group(p_account_id uuid, p_contact_id uuid, p_group_id uuid, p_role text default null)
returns jsonb language plpgsql set search_path = '' as $$
begin
  if not app.lock_contact(p_account_id, p_contact_id) then return jsonb_build_object('status', 'not_found'); end if;
  perform 1 from public.client_groups where id = p_group_id and account_id = p_account_id;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  return jsonb_build_object('status', 'ok', 'member_id', app.link_member(p_account_id, p_group_id, p_contact_id, p_role, false));
end $$;

create function public.set_contacts_business(p_account_id uuid, p_contact_ids uuid[], p_names text[])
returns jsonb language plpgsql set search_path = '' as $$
declare
  i int; v_name text; v_key text; v_shown public.client_group_members; v_shown_key text;
  v_group uuid; v_existed boolean; v_added uuid; v_removed jsonb; v_status text; v_out jsonb := '[]'::jsonb;
begin
  if coalesce(array_length(p_contact_ids, 1), 0) <> coalesce(array_length(p_names, 1), 0) then
    raise exception 'set_contacts_business: ids and names differ in length' using errcode = '22023';
  end if;
  for i in 1 .. coalesce(array_length(p_contact_ids, 1), 0) loop
    v_added := null; v_removed := null; v_shown := null; v_shown_key := null;
    v_name := btrim(coalesce(p_names[i], ''), app.group_ws());
    v_key := app.group_name_key(v_name);
    if char_length(v_name) > 120 then
      v_status := 'too_long';
    elsif not app.lock_contact(p_account_id, p_contact_ids[i]) then
      v_status := 'not_found';
    else
      select m.* into v_shown from public.client_group_members m
        join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
       where m.contact_id = p_contact_ids[i] and g.kind = 'business'
       order by m.is_primary desc, m.created_at, m.id limit 1;
      if v_shown.id is not null then
        select g.name_key into v_shown_key from public.client_groups g where g.id = v_shown.client_group_id;
      end if;
      if v_key = '' and v_shown.id is null then
        v_status := 'unchanged';
      elsif v_key = '' then
        delete from public.client_group_members where id = v_shown.id;
        perform app.promote_primary(p_contact_ids[i]);
        v_removed := to_jsonb(v_shown); v_status := 'ok';
      elsif v_shown_key = v_key then
        v_status := 'unchanged';
      else
        select f.group_id, f.existed into v_group, v_existed from app.find_or_create_business(p_account_id, v_name) f;
        if v_shown.id is not null then
          delete from public.client_group_members where id = v_shown.id;
          v_removed := to_jsonb(v_shown);
        end if;
        if exists (select 1 from public.client_group_members where client_group_id = v_group and contact_id = p_contact_ids[i]) then
          if coalesce(v_shown.is_primary, false) then
            update public.client_group_members set is_primary = true
             where client_group_id = v_group and contact_id = p_contact_ids[i];
          end if;
        else
          v_added := app.link_member(p_account_id, v_group, p_contact_ids[i], null, coalesce(v_shown.is_primary, false));
        end if;
        perform app.promote_primary(p_contact_ids[i]);
        v_status := 'ok';
      end if;
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'contact_id', p_contact_ids[i], 'status', v_status, 'removed', v_removed, 'added', v_added));
  end loop;
  return v_out;
end $$;

create function public.undo_set_business(p_account_id uuid, p_contact_id uuid, p_added uuid, p_removed jsonb)
returns text language plpgsql set search_path = '' as $$
begin
  if not app.lock_contact(p_account_id, p_contact_id) then return 'not_found'; end if;
  if p_removed is not null and (p_removed ->> 'contact_id')::uuid is distinct from p_contact_id then
    raise exception 'undo_set_business: the snapshot is for another contact' using errcode = '22023';
  end if;
  if p_added is not null then
    delete from public.client_group_members where id = p_added and contact_id = p_contact_id;
  end if;
  if p_removed is not null then
    perform app.restore_member(p_account_id, p_removed);
  end if;
  perform app.promote_primary(p_contact_id);
  return 'ok';
end $$;

create function public.set_primary_group_membership(p_account_id uuid, p_member_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_contact uuid; v_previous uuid;
begin
  select contact_id into v_contact from public.client_group_members where id = p_member_id and account_id = p_account_id;
  if v_contact is null then return jsonb_build_object('status', 'not_found'); end if;
  perform app.lock_contact(p_account_id, v_contact);
  select id into v_previous from public.client_group_members where contact_id = v_contact and is_primary;
  if v_previous is distinct from p_member_id then
    update public.client_group_members set is_primary = false where contact_id = v_contact and is_primary;
    update public.client_group_members set is_primary = true where id = p_member_id;
  end if;
  return jsonb_build_object('status', 'ok', 'previous', v_previous);
end $$;

create function public.remove_group_membership(p_account_id uuid, p_member_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_row public.client_group_members;
begin
  select * into v_row from public.client_group_members where id = p_member_id and account_id = p_account_id;
  if v_row.id is null then return jsonb_build_object('status', 'not_found'); end if;
  perform app.lock_contact(p_account_id, v_row.contact_id);
  delete from public.client_group_members where id = p_member_id;
  perform app.promote_primary(v_row.contact_id);
  return jsonb_build_object('status', 'ok', 'removed', to_jsonb(v_row));
end $$;

create function public.restore_group_membership(p_account_id uuid, p_snapshot jsonb)
returns text language plpgsql set search_path = '' as $$
declare v_contact uuid := (p_snapshot ->> 'contact_id')::uuid; v_status text;
begin
  if v_contact is null or not app.lock_contact(p_account_id, v_contact) then return 'not_found'; end if;
  v_status := app.restore_member(p_account_id, p_snapshot);
  perform app.promote_primary(v_contact);
  return v_status;
end $$;

-- 8. The backfill (spec section 5.4), idempotent. Called below, and once more by the orchestrator after
--    the new app is live, to fold in what the old build wrote straight to company_name in between.
create function public.reconcile_business_groups(p_account_id uuid default null)
returns jsonb language plpgsql set search_path = '' as $$
declare
  r record; v_shown public.client_group_members; v_shown_key text; v_group uuid;
  v_groups int := 0; v_added int := 0; v_replaced int := 0; v_removed int := 0; v_skipped int := 0; v_respelled int := 0;
begin
  insert into public.client_groups (account_id, kind, name)
  select distinct on (c.account_id, app.group_name_key(c.company_name))
         c.account_id, 'business', btrim(c.company_name, app.group_ws())
    from public.contacts c
   where (p_account_id is null or c.account_id = p_account_id)
     and char_length(btrim(coalesce(c.company_name, ''), app.group_ws())) between 1 and 120
   order by c.account_id, app.group_name_key(c.company_name), c.created_at, c.id
  on conflict (account_id, name_key) where kind = 'business' do nothing;
  get diagnostics v_groups = row_count;

  for r in
    select c.id, c.account_id, btrim(coalesce(c.company_name, ''), app.group_ws()) as name
      from public.contacts c
     where (p_account_id is null or c.account_id = p_account_id)
       and (btrim(coalesce(c.company_name, ''), app.group_ws()) <> ''
            or exists (select 1 from public.client_group_members m
                         join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
                        where m.contact_id = c.id and g.kind = 'business'))
     order by c.created_at, c.id
  loop
    if char_length(r.name) > 120 then v_skipped := v_skipped + 1; continue; end if;
    v_shown := null; v_shown_key := null;
    select m.* into v_shown from public.client_group_members m
      join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
     where m.contact_id = r.id and g.kind = 'business'
     order by m.is_primary desc, m.created_at, m.id limit 1;
    if v_shown.id is not null then
      select g.name_key into v_shown_key from public.client_groups g where g.id = v_shown.client_group_id;
    end if;
    if r.name = '' then
      delete from public.client_group_members where id = v_shown.id;
      perform app.promote_primary(r.id);
      v_removed := v_removed + 1;
    elsif v_shown.id is null then
      select f.group_id into v_group from app.find_or_create_business(r.account_id, r.name) f;
      perform app.link_member(r.account_id, v_group, r.id, null, false);
      v_added := v_added + 1;
    elsif v_shown_key <> app.group_name_key(r.name) then
      select f.group_id into v_group from app.find_or_create_business(r.account_id, r.name) f;
      delete from public.client_group_members where id = v_shown.id;
      if exists (select 1 from public.client_group_members where client_group_id = v_group and contact_id = r.id) then
        if v_shown.is_primary then
          update public.client_group_members set is_primary = true where client_group_id = v_group and contact_id = r.id;
        end if;
      else
        perform app.link_member(r.account_id, v_group, r.id, null, v_shown.is_primary);
      end if;
      perform app.promote_primary(r.id);
      v_replaced := v_replaced + 1;
    end if;
  end loop;

  update public.contacts c set company_name = app.company_name_for(c.id)
   where (p_account_id is null or c.account_id = p_account_id)
     and exists (select 1 from public.client_group_members m
                   join public.client_groups g on g.account_id = m.account_id and g.id = m.client_group_id
                  where m.contact_id = c.id and g.kind = 'business')
     and c.company_name is distinct from app.company_name_for(c.id);
  get diagnostics v_respelled = row_count;

  return jsonb_build_object('groups_created', v_groups, 'members_added', v_added, 'members_replaced', v_replaced,
                            'members_removed', v_removed, 'skipped_too_long', v_skipped, 'respelled', v_respelled);
end $$;

-- 9. Grants. Default privileges hand EXECUTE to anon, authenticated and service_role BY NAME (0043).
do $$
declare f text;
begin
  foreach f in array array[
    'public.create_group_with_member(uuid,uuid,text,text,text)', 'public.add_contact_to_group(uuid,uuid,uuid,text)',
    'public.set_contacts_business(uuid,uuid[],text[])', 'public.undo_set_business(uuid,uuid,uuid,jsonb)',
    'public.set_primary_group_membership(uuid,uuid)', 'public.remove_group_membership(uuid,uuid)',
    'public.restore_group_membership(uuid,jsonb)', 'public.reconcile_business_groups(uuid)',
    'app.company_name_for(uuid)', 'app.lock_contact(uuid,uuid)', 'app.promote_primary(uuid)',
    'app.link_member(uuid,uuid,uuid,text,boolean)', 'app.find_or_create_business(uuid,text)', 'app.restore_member(uuid,jsonb)',
    'app.sync_company_name()', 'app.group_ws()', 'app.group_name_key(text)'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
revoke all on function app.my_client_group_ids() from public, anon;
grant execute on function app.my_client_group_ids() to authenticated, service_role;

-- 10. The backfill, once, now.
select public.reconcile_business_groups();
```

- [ ] **Step 7: Check the file holds no backslash, then apply it to `post` only.**

```bash
grep -c '\\' "$W/packages/db/supabase/migrations/0069_client_groups.sql"   # expected: 0
P -c "create database post template pre"
P -d post -1 -f "$W/packages/db/supabase/migrations/0069_client_groups.sql"
```

Expected: `0`, then a clean apply printing one `reconcile_business_groups` row. If the generated column refuses `app.group_name_key` (an "immutable" error), stop and report: do not switch to an inline expression without review (spec §12's open assumption).

- [ ] **Step 8: Run green on `post`, plus the guards 0069 must not move.**

Run: `cd $W/packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55461/post pnpm exec vitest run src/test/client-groups-schema.test.ts src/test/client-groups-functions.test.ts src/test/client-groups-rls.test.ts src/test/schema-grants-guard.test.ts src/test/technician-scope.test.ts src/test/same-account-fk-schema.test.ts src/test/rls.test.ts`
Expected: all green; `schema-grants-guard.test.ts` green with `EXPECTED_WRITES` untouched (the proof of the revokes). Paste the summary line.

- [ ] **Step 9: Mutation probe (required).** On `post`: `drop policy client_group_members_technician_scope on public.client_group_members;` then re-run `client-groups-rls.test.ts`. Expected: `G8: … sees the shared household and THEIR membership only…` FAILS by name. Then reset: `P -c "drop database post"`, re-create from `pre` and re-apply 0069 (step 7). Paste the failing name.

- [ ] **Step 10: Stop the replica and commit.**

```bash
"$PGBIN/pg_ctl" -D "$S/data" stop </dev/null >/dev/null 2>&1
cd $W && git add packages/db/supabase/migrations/0069_client_groups.sql packages/db/src/test/client-groups-schema.test.ts packages/db/src/test/client-groups-functions.test.ts packages/db/src/test/client-groups-rls.test.ts
git commit -m "feat(db): client groups, a database-kept company_name and its backfill (migration 0069)" -- packages/db/supabase/migrations/0069_client_groups.sql packages/db/src/test/client-groups-schema.test.ts packages/db/src/test/client-groups-functions.test.ts packages/db/src/test/client-groups-rls.test.ts
```

Do NOT apply 0069 anywhere but your own replica.

---

## Task 2: `@bis/db` `client-groups.ts`, the teardown list and the barrel

**Owner:** bis-crm. **Review:** sonnet. **Runs:** after Task 1, alone. **Replica (optional, with a local PostgREST):** port **55462**, `$SCRATCH/s02a-t2/`.

**Files**
- Create: `packages/db/src/client-groups.ts`
- Create: `packages/db/src/test/client-groups.test.ts`
- Modify: `packages/db/src/account-teardown.ts:19-28` and its doc comment
- Modify: `packages/db/src/index.ts` (additive: one export block)

**Interfaces**
- Consumes: Task 1's functions and tables; `emit(db, accountId, type, actorId, payload, actorType)` (`events.ts:16-19`); `sanitizeSearchTerm` (`search-term.ts:79`).
- Produces (TS, exported from `@bis/db`):

```ts
export const GROUP_NAME_MAX = 120; export const GROUP_ROLE_MAX = 60; export const BILLING_ADDRESS_MAX = 300;
export type GroupKind = "household" | "business";
export type GroupMemberSnapshot = { id: string; account_id: string; client_group_id: string; contact_id: string; role: string | null; is_primary: boolean; is_billing: boolean; created_at: string };
export type ContactGroupMember = { contactId: string; firstName: string | null; lastName: string | null };
export type ContactGroup = { memberId: string; groupId: string; kind: GroupKind; name: string; billingAddress: string | null; role: string | null; isPrimary: boolean; isBilling: boolean; others: ContactGroupMember[] };
export type GroupSearchHit = { id: string; kind: GroupKind; name: string };
export type BusinessResult = { contactId: string; status: "ok" | "unchanged" | "not_found" | "too_long"; removed: GroupMemberSnapshot | null; added: string | null };
export async function listContactGroups(db: SupabaseClient, accountId: string, contactId: string): Promise<ContactGroup[]>;
export async function searchGroups(db: SupabaseClient, accountId: string, term: string): Promise<GroupSearchHit[]>;
export async function readMembership(db: SupabaseClient, accountId: string, memberId: string): Promise<{ contactId: string; groupId: string } | null>;
export async function readGroup(db: SupabaseClient, accountId: string, groupId: string): Promise<{ id: string; kind: GroupKind; name: string; billingAddress: string | null } | null>;
export async function createGroupWithMember(db: SupabaseClient, accountId: string, contactId: string, kind: GroupKind, name: string, role: string | null, actorId: string, actorType?: ActorType): Promise<{ status: "ok"; groupId: string; memberId: string; existed: boolean; name: string } | { status: "not_found" | "invalid_name" }>;
export async function addContactToGroup(db: SupabaseClient, accountId: string, contactId: string, groupId: string, role: string | null, actorId: string, actorType?: ActorType): Promise<{ status: "ok"; memberId: string } | { status: "not_found" }>;
export async function setContactsBusiness(db: SupabaseClient, accountId: string, rows: readonly { contactId: string; name: string }[], actorId: string, actorType?: ActorType): Promise<BusinessResult[]>;
export async function undoSetBusiness(db: SupabaseClient, accountId: string, contactId: string, added: string | null, removed: GroupMemberSnapshot | null): Promise<"ok" | "not_found">;
export async function setPrimaryMembership(db: SupabaseClient, accountId: string, memberId: string, actorId: string): Promise<{ status: "ok"; previous: string | null } | { status: "not_found" }>;
export async function removeMembership(db: SupabaseClient, accountId: string, memberId: string, actorId: string): Promise<{ status: "ok"; removed: GroupMemberSnapshot } | { status: "not_found" }>;
export async function restoreMembership(db: SupabaseClient, accountId: string, snapshot: GroupMemberSnapshot, actorId: string): Promise<"ok" | "not_found">;
export async function updateMembership(db: SupabaseClient, accountId: string, memberId: string, patch: { role?: string | null; isBilling?: boolean }, actorId: string): Promise<{ status: "ok"; previous: { role: string | null; isBilling: boolean } } | { status: "not_found" }>;
export async function updateGroup(db: SupabaseClient, accountId: string, groupId: string, patch: { name?: string; billingAddress?: string | null }, actorId: string): Promise<{ status: "ok"; previous: { name: string; billingAddress: string | null } } | { status: "not_found" | "name_taken" }>;
```

Every write takes the SERVICE client (the caller has already proven the target); the reads take whatever client the caller passes (the request client in the app).

- [ ] **Step 1: Write the failing test** `packages/db/src/test/client-groups.test.ts`:

```ts
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact, getContact } from "../contacts";
import { serviceDb } from "../service";
import {
  listContactGroups, searchGroups, createGroupWithMember, addContactToGroup, setContactsBusiness, undoSetBusiness,
  setPrimaryMembership, removeMembership, restoreMembership, updateMembership, updateGroup, readMembership,
} from "../client-groups";

const A = "user_test";

describe("client-groups.ts over PostgREST", () => {
  it("lists a contact's groups main first, with the other members", () => withTestAccount(async (db, accountId) => {
    const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.g@example.com" }, A)).id;
    const luis = (await createContact(db, accountId, { firstName: "Luis", email: "luis.g@example.com" }, A)).id;
    const home = await createGroupWithMember(db, accountId, ana, "household", "Garcia", "Madre", A);
    if (home.status !== "ok") throw new Error(home.status);
    await addContactToGroup(db, accountId, luis, home.groupId, "Hijo", A);
    const biz = await createGroupWithMember(db, accountId, ana, "business", "Acme Roofing", null, A);
    if (biz.status !== "ok") throw new Error(biz.status);
    await setPrimaryMembership(db, accountId, biz.memberId, A);
    const groups = await listContactGroups(db, accountId, ana);
    expect(groups.map((g) => [g.name, g.kind, g.isPrimary])).toEqual([["Acme Roofing", "business", true], ["Garcia", "household", false]]);
    expect(groups[1]!.others).toEqual([{ contactId: luis, firstName: "Luis", lastName: null }]);
    expect(groups[1]!.role).toBe("Madre");
  }));

  it("search finds by part of a name and treats % as a letter (mutation: drop sanitizeSearchTerm -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.s@example.com" }, A)).id;
      await createGroupWithMember(db, accountId, ana, "business", "Acme Roofing", null, A);
      await createGroupWithMember(db, accountId, ana, "household", "Garcia", null, A);
      expect((await searchGroups(db, accountId, "roof")).map((h) => h.name)).toEqual(["Acme Roofing"]);
      expect(await searchGroups(db, accountId, "%")).toEqual([]);
      expect(await searchGroups(db, accountId, "  ")).toEqual([]);
    }));

  it("the business name write keeps the column in step, and its undo restores it", () => withTestAccount(async (db, accountId) => {
    const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.b@example.com" }, A)).id;
    const [first] = await setContactsBusiness(db, accountId, [{ contactId: ana, name: "Acme Roofing" }], A);
    expect(first!.status).toBe("ok");
    expect((await getContact(db, accountId, ana))!.company_name).toBe("Acme Roofing");
    const [second] = await setContactsBusiness(db, accountId, [{ contactId: ana, name: "Beta Pools" }], A);
    expect(await undoSetBusiness(db, accountId, ana, second!.added, second!.removed)).toBe("ok");
    expect((await getContact(db, accountId, ana))!.company_name).toBe("Acme Roofing");
  }));

  it("remove then restore gives back the same membership; role and pays update; a rename onto another business is name_taken", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.r@example.com" }, A)).id;
      const acme = await createGroupWithMember(db, accountId, ana, "business", "Acme Roofing", null, A);
      const beta = await createGroupWithMember(db, accountId, ana, "business", "Beta Pools", null, A);
      if (acme.status !== "ok" || beta.status !== "ok") throw new Error("seed");
      expect(await updateMembership(db, accountId, acme.memberId, { role: "Dueña", isBilling: true }, A))
        .toEqual({ status: "ok", previous: { role: null, isBilling: false } });
      const removed = await removeMembership(db, accountId, acme.memberId, A);
      if (removed.status !== "ok") throw new Error("remove");
      expect(await readMembership(db, accountId, acme.memberId)).toBeNull();
      expect(await restoreMembership(db, accountId, removed.removed, A)).toBe("ok");
      expect(await readMembership(db, accountId, acme.memberId)).toEqual({ contactId: ana, groupId: acme.groupId });
      expect(await updateGroup(db, accountId, beta.groupId, { name: " acme ROOFING" }, A)).toEqual({ status: "name_taken" });
    }));

  it("account teardown leaves no group behind (mutation: take client_groups off ACCOUNT_OWNED_TABLES and make its account FK restrict -> FAILS)", async () => {
    let seen = "";
    await withTestAccount(async (db, accountId) => {
      seen = accountId;
      const ana = (await createContact(db, accountId, { firstName: "Ana", email: "ana.t@example.com" }, A)).id;
      await createGroupWithMember(db, accountId, ana, "household", "Garcia", null, A);
    });
    const { count } = await serviceDb().from("client_groups").select("id", { count: "exact", head: true }).eq("account_id", seen);
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter @bis/db exec vitest run src/test/client-groups.test.ts` (against a PostgREST with 0069; see Global Constraints). Expected: `Failed to resolve import "../client-groups"`. Paste it.

- [ ] **Step 3: Write `packages/db/src/client-groups.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { sanitizeSearchTerm } from "./search-term";

/**
 * Client groups (S-02 part 1, migration 0069): households and business
 * customers. The tables are SELECT-only for the client role; every write here
 * goes through a service-role plpgsql function or a service-client update,
 * so the CALLER must already have proven the contact, membership or group
 * through the request client (spec A1, the Technician spec's §7.3 rule).
 * contacts.company_name is kept by a trigger, never written here.
 */
export const GROUP_NAME_MAX = 120;
export const GROUP_ROLE_MAX = 60;
export const BILLING_ADDRESS_MAX = 300;

export type GroupKind = "household" | "business";
export type GroupMemberSnapshot = {
  id: string; account_id: string; client_group_id: string; contact_id: string;
  role: string | null; is_primary: boolean; is_billing: boolean; created_at: string;
};
export type ContactGroupMember = { contactId: string; firstName: string | null; lastName: string | null };
export type ContactGroup = {
  memberId: string; groupId: string; kind: GroupKind; name: string; billingAddress: string | null;
  role: string | null; isPrimary: boolean; isBilling: boolean; others: ContactGroupMember[];
};
export type GroupSearchHit = { id: string; kind: GroupKind; name: string };
export type BusinessResult = {
  contactId: string; status: "ok" | "unchanged" | "not_found" | "too_long";
  removed: GroupMemberSnapshot | null; added: string | null;
};

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn} failed: ${error.message}`);
  return data as T;
}

type MemberRow = {
  id: string; role: string | null; is_primary: boolean; is_billing: boolean; created_at: string;
  client_groups: { id: string; kind: GroupKind; name: string; billing_address: string | null } | null;
};
type OtherRow = { client_group_id: string; contact_id: string; contacts: { first_name: string | null; last_name: string | null } | null };

/** The card's read. RLS alone decides what a Technician gets (G8): no role branch here. */
export async function listContactGroups(db: SupabaseClient, accountId: string, contactId: string): Promise<ContactGroup[]> {
  const { data, error } = await db.from("client_group_members")
    .select("id, role, is_primary, is_billing, created_at, client_groups(id, kind, name, billing_address)")
    .eq("account_id", accountId).eq("contact_id", contactId);
  if (error) throw new Error(`listContactGroups failed: ${error.message}`);
  const rows = ((data ?? []) as unknown as MemberRow[])
    .filter((r) => r.client_groups !== null)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)
      || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const others = new Map<string, ContactGroupMember[]>();
  const groupIds = rows.map((r) => r.client_groups!.id);
  if (groupIds.length > 0) {
    const { data: o, error: oErr } = await db.from("client_group_members")
      .select("client_group_id, contact_id, contacts(first_name, last_name)")
      .eq("account_id", accountId).in("client_group_id", groupIds).neq("contact_id", contactId)
      .order("created_at", { ascending: true });
    if (oErr) throw new Error(`listContactGroups members failed: ${oErr.message}`);
    for (const r of (o ?? []) as unknown as OtherRow[]) {
      const list = others.get(r.client_group_id) ?? [];
      list.push({ contactId: r.contact_id, firstName: r.contacts?.first_name ?? null, lastName: r.contacts?.last_name ?? null });
      others.set(r.client_group_id, list);
    }
  }
  return rows.map((r) => ({
    memberId: r.id, groupId: r.client_groups!.id, kind: r.client_groups!.kind, name: r.client_groups!.name,
    billingAddress: r.client_groups!.billing_address, role: r.role, isPrimary: r.is_primary, isBilling: r.is_billing,
    others: others.get(r.client_groups!.id) ?? [],
  }));
}

export async function searchGroups(db: SupabaseClient, accountId: string, term: string): Promise<GroupSearchHit[]> {
  const trimmed = term.trim();
  if (!trimmed) return [];
  const s = sanitizeSearchTerm(trimmed);
  const { data, error } = await db.from("client_groups").select("id, kind, name")
    .eq("account_id", accountId).ilike("name", `%${s}%`).order("name_key", { ascending: true }).limit(8);
  if (error) throw new Error(`searchGroups failed: ${error.message}`);
  return (data ?? []) as GroupSearchHit[];
}

export async function readMembership(db: SupabaseClient, accountId: string, memberId: string) {
  const { data, error } = await db.from("client_group_members").select("contact_id, client_group_id")
    .eq("account_id", accountId).eq("id", memberId).maybeSingle();
  if (error) throw new Error(`readMembership failed: ${error.message}`);
  const row = data as { contact_id: string; client_group_id: string } | null;
  return row ? { contactId: row.contact_id, groupId: row.client_group_id } : null;
}

export async function readGroup(db: SupabaseClient, accountId: string, groupId: string) {
  const { data, error } = await db.from("client_groups").select("id, kind, name, billing_address")
    .eq("account_id", accountId).eq("id", groupId).maybeSingle();
  if (error) throw new Error(`readGroup failed: ${error.message}`);
  const row = data as { id: string; kind: GroupKind; name: string; billing_address: string | null } | null;
  return row ? { id: row.id, kind: row.kind, name: row.name, billingAddress: row.billing_address } : null;
}

export async function createGroupWithMember(
  db: SupabaseClient, accountId: string, contactId: string, kind: GroupKind, name: string, role: string | null,
  actorId: string, actorType: ActorType = "user",
): Promise<{ status: "ok"; groupId: string; memberId: string; existed: boolean; name: string } | { status: "not_found" | "invalid_name" }> {
  const r = await rpc<{ status: string; group_id?: string; member_id?: string; existed?: boolean; name?: string }>(
    db, "create_group_with_member", { p_account_id: accountId, p_contact_id: contactId, p_kind: kind, p_name: name, p_role: role });
  if (r.status !== "ok") return { status: r.status === "invalid_name" ? "invalid_name" : "not_found" };
  await emit(db, accountId, r.existed ? "client_group.member_added" : "client_group.created", actorId,
    { contactId, groupId: r.group_id, memberId: r.member_id, kind }, actorType);
  return { status: "ok", groupId: r.group_id!, memberId: r.member_id!, existed: r.existed === true, name: r.name! };
}

export async function addContactToGroup(
  db: SupabaseClient, accountId: string, contactId: string, groupId: string, role: string | null,
  actorId: string, actorType: ActorType = "user",
): Promise<{ status: "ok"; memberId: string } | { status: "not_found" }> {
  const r = await rpc<{ status: string; member_id?: string }>(
    db, "add_contact_to_group", { p_account_id: accountId, p_contact_id: contactId, p_group_id: groupId, p_role: role });
  if (r.status !== "ok") return { status: "not_found" };
  await emit(db, accountId, "client_group.member_added", actorId, { contactId, groupId, memberId: r.member_id }, actorType);
  return { status: "ok", memberId: r.member_id! };
}

/** The Business name write: the field, the CSV import (one call per batch) and the forms lead. */
export async function setContactsBusiness(
  db: SupabaseClient, accountId: string, rows: readonly { contactId: string; name: string }[],
  actorId: string, actorType: ActorType = "user",
): Promise<BusinessResult[]> {
  if (rows.length === 0) return [];
  const out = await rpc<{ contact_id: string; status: BusinessResult["status"]; removed: GroupMemberSnapshot | null; added: string | null }[]>(
    db, "set_contacts_business",
    { p_account_id: accountId, p_contact_ids: rows.map((r) => r.contactId), p_names: rows.map((r) => r.name) });
  const results = out.map((r) => ({ contactId: r.contact_id, status: r.status, removed: r.removed, added: r.added }));
  const changed = results.filter((r) => r.status === "ok").map((r) => r.contactId);
  if (changed.length > 0) {
    await emit(db, accountId, "client_group.business_set", actorId, { contactIds: changed }, actorType);
  }
  return results;
}

export async function undoSetBusiness(
  db: SupabaseClient, accountId: string, contactId: string, added: string | null, removed: GroupMemberSnapshot | null,
): Promise<"ok" | "not_found"> {
  return rpc<"ok" | "not_found">(db, "undo_set_business",
    { p_account_id: accountId, p_contact_id: contactId, p_added: added, p_removed: removed });
}

export async function setPrimaryMembership(db: SupabaseClient, accountId: string, memberId: string, actorId: string) {
  const r = await rpc<{ status: string; previous?: string | null }>(
    db, "set_primary_group_membership", { p_account_id: accountId, p_member_id: memberId });
  if (r.status !== "ok") return { status: "not_found" as const };
  await emit(db, accountId, "client_group.member_updated", actorId, { memberId, fields: ["is_primary"] });
  return { status: "ok" as const, previous: r.previous ?? null };
}

export async function removeMembership(db: SupabaseClient, accountId: string, memberId: string, actorId: string) {
  const r = await rpc<{ status: string; removed?: GroupMemberSnapshot }>(
    db, "remove_group_membership", { p_account_id: accountId, p_member_id: memberId });
  if (r.status !== "ok" || !r.removed) return { status: "not_found" as const };
  await emit(db, accountId, "client_group.member_removed", actorId,
    { memberId, contactId: r.removed.contact_id, groupId: r.removed.client_group_id });
  return { status: "ok" as const, removed: r.removed };
}

export async function restoreMembership(db: SupabaseClient, accountId: string, snapshot: GroupMemberSnapshot, actorId: string) {
  const r = await rpc<"ok" | "not_found">(db, "restore_group_membership", { p_account_id: accountId, p_snapshot: snapshot });
  if (r === "ok") {
    await emit(db, accountId, "client_group.member_added", actorId,
      { memberId: snapshot.id, contactId: snapshot.contact_id, groupId: snapshot.client_group_id, undo: true });
  }
  return r;
}

export async function updateMembership(
  db: SupabaseClient, accountId: string, memberId: string, patch: { role?: string | null; isBilling?: boolean }, actorId: string,
): Promise<{ status: "ok"; previous: { role: string | null; isBilling: boolean } } | { status: "not_found" }> {
  const { data: cur, error: readErr } = await db.from("client_group_members").select("role, is_billing")
    .eq("account_id", accountId).eq("id", memberId).maybeSingle();
  if (readErr) throw new Error(`updateMembership read failed: ${readErr.message}`);
  if (!cur) return { status: "not_found" };
  const row: Record<string, unknown> = {};
  if (patch.role !== undefined) row.role = patch.role === null || patch.role.trim() === "" ? null : patch.role.trim();
  if (patch.isBilling !== undefined) row.is_billing = patch.isBilling;
  const { error } = await db.from("client_group_members").update(row).eq("account_id", accountId).eq("id", memberId);
  if (error) throw new Error(`updateMembership failed: ${error.message}`);
  await emit(db, accountId, "client_group.member_updated", actorId, { memberId, fields: Object.keys(row) });
  const c = cur as { role: string | null; is_billing: boolean };
  return { status: "ok", previous: { role: c.role, isBilling: c.is_billing } };
}

export async function updateGroup(
  db: SupabaseClient, accountId: string, groupId: string, patch: { name?: string; billingAddress?: string | null }, actorId: string,
): Promise<{ status: "ok"; previous: { name: string; billingAddress: string | null } } | { status: "not_found" | "name_taken" }> {
  const cur = await readGroup(db, accountId, groupId);
  if (!cur) return { status: "not_found" };
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.billingAddress !== undefined) {
    row.billing_address = patch.billingAddress === null || patch.billingAddress.trim() === "" ? null : patch.billingAddress.trim();
  }
  const { error } = await db.from("client_groups").update(row).eq("account_id", accountId).eq("id", groupId);
  if (error?.code === "23505") return { status: "name_taken" };
  if (error) throw new Error(`updateGroup failed: ${error.message}`);
  await emit(db, accountId, "client_group.renamed", actorId, { groupId, fields: Object.keys(row).filter((k) => k !== "updated_at") });
  return { status: "ok", previous: { name: cur.name, billingAddress: cur.billingAddress } };
}
```

(`.trim()` in TS only shapes the value sent; the database's `client_groups_name_trimmed` check and `WS` class are authoritative. A name the check refuses throws `updateGroup failed`, which the action reports as a failed save.)

- [ ] **Step 4: The teardown list.** In `packages/db/src/account-teardown.ts`, change the last line of the array from `"custom_values", "tags", "contacts",` to `"custom_values", "tags", "client_group_members", "client_groups", "contacts",` and add to the doc comment, after the `consent_events` paragraph:

```ts
 * `client_group_members` and `client_groups` (0069) are ON the list, just
 * before `contacts`, so the demo re-seed's leftovers check covers them; both
 * ALSO carry `account_id … on delete cascade`, so an older build's teardown
 * that does not list them still succeeds while 0069 rolls out.
```

- [ ] **Step 5: The barrel.** Append to `packages/db/src/index.ts`, after the assignment block (`index.ts:227-232`):

```ts
// Client groups (S-02 part 1, 0069): households and business customers. See ./client-groups.ts.
export {
  GROUP_NAME_MAX, GROUP_ROLE_MAX, BILLING_ADDRESS_MAX,
  listContactGroups, searchGroups, readMembership, readGroup,
  createGroupWithMember, addContactToGroup, setContactsBusiness, undoSetBusiness,
  setPrimaryMembership, removeMembership, restoreMembership, updateMembership, updateGroup,
  type GroupKind, type GroupMemberSnapshot, type ContactGroup, type ContactGroupMember,
  type GroupSearchHit, type BusinessResult,
} from "./client-groups";
```

- [ ] **Step 6: Run green.** `pnpm --filter @bis/db exec vitest run src/test/client-groups.test.ts src/test/demo-seed.test.ts src/test/fixtures.test.ts src/__tests__/cascade-export-boundary.test.ts` and `pnpm --filter web typecheck`. Expected: green (or "pending CI verify" for the PostgREST files, stated). Paste the summary line.

- [ ] **Step 7: Mutation probe (required).** In `searchGroups`, replace `sanitizeSearchTerm(trimmed)` with `trimmed`. Expected: `search finds by part of a name and treats % as a letter` FAILS by name. Revert.

- [ ] **Step 8: Commit.**

```bash
git add packages/db/src/client-groups.ts packages/db/src/test/client-groups.test.ts packages/db/src/account-teardown.ts packages/db/src/index.ts
git commit -m "feat(db): client groups module over the 0069 functions, and teardown covers it" -- packages/db/src/client-groups.ts packages/db/src/test/client-groups.test.ts packages/db/src/account-teardown.ts packages/db/src/index.ts
```

---

## Task 3a: CSV import writes the business as a group

**Owner:** bis-crm. **Review:** sonnet. **Runs:** after Task 2; parallel with 3b, 3c, 4.

**Files**
- Modify: `apps/web/src/lib/contacts/csv.ts:7` (`MappedRow`), `:111-148` (`mapRows`)
- Modify: `apps/web/src/lib/contacts/csv.test.ts` (`describe("mapRows")`)
- Modify: `packages/db/src/contact-import.ts:48` (`ImportRow`), `:121-195` (`applyImportBatch`)
- Modify: `packages/db/src/test/contact-import.test.ts:13-27`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/actions.ts:41-47`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/actions.test.ts` (factory gains `serviceDb`)

**Interfaces**
- Consumes: `setContactsBusiness(db, accountId, rows, actorId)` (Task 2).
- Produces: `MappedRow = { line: number; input: ContactInput; tags: string[]; company?: string }`; `ImportRow = { input: ContactInput; tags: string[]; company?: string }`; `applyImportBatch(db, accountId, rows, index, actorId, opts: { createTags: boolean; groupWriter?: SupabaseClient })`, return shape unchanged.

- [ ] **Step 1: Failing tests.** Append to `describe("mapRows")` in `csv.test.ts`:

```ts
  it("carries the business BESIDE the patch, never inside it (S-02 §6 row 5; mutation: drop the company_name branch -> FAILS)", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { Email: "a@b.co", Business: "  Acme Roofing " } }], { Email: "email", Business: "company_name" });
    expect(mapped[0]!.company).toBe("Acme Roofing");
    expect("companyName" in mapped[0]!.input).toBe(false);
  });

  it("a blank business cell carries nothing, so a re-import can never unlink a business", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { Email: "a@b.co", Business: "" } }], { Email: "email", Business: "company_name" });
    expect("company" in mapped[0]!).toBe(false);
  });
```

Replace the first case of `contact-import.test.ts` (`:13-27`) with:

```ts
  it("creates a new contact and updates a matching one in the same batch; the business is a group", () =>
    withTestAccount(async (db, accountId) => {
      const existing = await createContact(db, accountId,
        { email: "ada@example.com", firstName: "Ada" }, "user_test");
      const index = await buildMatchIndex(db, accountId);
      const r = await applyImportBatch(db, accountId, [
        { input: { email: "ada@example.com" }, tags: [], company: "Analytical Engines" },
        { input: { email: "grace@example.com", firstName: "Grace" }, tags: [] },
      ], index, "user_test", { createTags: false });

      expect(r).toEqual({ created: 1, updated: 1, flagged: 0 });
      const ada = await getContact(db, accountId, existing.id);
      expect(ada!.company_name).toBe("Analytical Engines");
      expect(ada!.first_name).toBe("Ada"); // untouched: the CSV had no first name
      const { data: groups } = await db.from("client_groups").select("name, kind").eq("account_id", accountId);
      expect(groups).toEqual([{ name: "Analytical Engines", kind: "business" }]);
    }));
```

And in `import/actions.test.ts`, add `serviceDb: vi.fn(() => ({ service: true })),` to `dbMocks`, plus a case:

```ts
describe("importContactsBatchAction business writer", () => {
  it("hands applyImportBatch the service client as groupWriter and carries the business (mutation: drop groupWriter -> FAILS)", async () => {
    await importContactsBatchAction("acct_9",
      [{ line: 2, values: { email: "a@b.com", company: "Acme" } }],
      { mapping: { email: "email", company: "company_name" }, createTags: false });
    const [, , rows, , , opts] = dbMocks.applyImportBatch.mock.calls[0]!;
    expect(rows).toEqual([{ input: { email: "a@b.com" }, tags: [], company: "Acme" }]);
    expect(opts).toEqual({ createTags: false, groupWriter: { service: true } });
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/contacts/csv.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/actions.test.ts"`. Expected: the two `mapRows` cases and the writer case fail (`company` undefined; `groupWriter` absent). Paste one line.

- [ ] **Step 3: `csv.ts`.** Change `MappedRow`:

```ts
export type MappedRow = { line: number; input: ContactInput; tags: string[]; company?: string };
```

In `mapRows`, declare `let company: string | undefined;` beside `let tags: string[] = [];`, and directly after `if (field === "tags") { tags = splitTags(value); continue; }` add:

```ts
      // S-02 §6 row 5: the business is a GROUP now, carried beside the patch
      // like tags, and written by applyImportBatch through set_contacts_business.
      if (field === "company_name") { company = value; continue; }
```

and replace `mapped.push({ line: row.line, input, tags });` with `mapped.push({ line: row.line, input, tags, ...(company ? { company } : {}) });`.

- [ ] **Step 4: `contact-import.ts`.** Change `ImportRow` to `export type ImportRow = { input: ContactInput; tags: string[]; company?: string };`, add `import { setContactsBusiness } from "./client-groups";`, change the options type to `opts: { createTags: boolean; groupWriter?: SupabaseClient }`, declare `const businesses: { contactId: string; name: string }[] = [];` beside `tagPlan`, push `if (row.company) businesses.push({ contactId, name: row.company });` right after the `let contactId` branch resolves (before the tags loop), and after the tag loop add:

```ts
  // One call per batch (S-02 §6 row 8). The client groups are server-written
  // (0069), so this runs on the service client the caller hands over, and only
  // for contacts this batch itself just wrote through `db`.
  if (businesses.length > 0) {
    await setContactsBusiness(opts.groupWriter ?? db, accountId, businesses, actorId);
  }
```

- [ ] **Step 5: `import/actions.ts`.** Import `serviceDb` from `@bis/db` (the service-read guard, `in-account-service-reads.test.ts`, names this file until Task 5 adds its allowlist line; that is expected, and the reason this task does not run that guard) and change the call to:

```ts
    const { created, updated, flagged } = await applyImportBatch(
      db, accountId,
      mapped.map((row) => ({ input: row.input, tags: row.tags, ...(row.company ? { company: row.company } : {}) })),
      index, userId, { createTags: opts.createTags, groupWriter: serviceDb() },
    );
```

- [ ] **Step 6: Run green.** `pnpm --filter web exec vitest run src/lib/contacts/csv.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/actions.test.ts"` and `pnpm --filter @bis/db exec vitest run src/test/contact-import.test.ts` (PostgREST; see Global Constraints). Paste the summary lines.

- [ ] **Step 7: Mutation probe (required).** Remove the `if (field === "company_name") …` line from `mapRows`. Expected: `carries the business BESIDE the patch…` FAILS by name. Revert.

- [ ] **Step 8: Commit.** `git add` the six files above, then `git commit -m "feat(contacts): CSV import writes the business as a group, one call per batch" -- <the six paths>`.

---

## Task 3b: The forms lead and the demo seed write the group

**Owner:** bis-crm. **Review:** sonnet. **Runs:** after Task 2; parallel with 3a, 3c, 4.

**Files**
- Modify: `apps/web/src/lib/forms/enrich.ts:2-6` (imports), `:96-109` (new lead), `:225-257` (`fillBlanks`)
- Modify: `apps/web/src/app/f/[publicId]/actions.test.ts` (factory and two cases)
- Modify: every other `vi.mock("@bis/db")` factory reaching `enrich.ts`: run `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "enrich\|f/\[publicId\]/actions\|b/\[publicId\]/actions\|concierge/lead"` (today: `app/b/[publicId]/actions.test.ts`, `app/api/concierge/[publicId]/turn/route.test.ts`, `lib/concierge/lead.test.ts` if they mock `@bis/db`), adding `setContactsBusiness: vi.fn(async () => [])`
- Modify: `packages/db/src/demo/seed.ts:430-445`

**Interfaces**
- Consumes: `setContactsBusiness` (Task 2).
- Produces: nothing new. `enrich` no longer passes `companyName` to `createContact`/`updateContact`.

- [ ] **Step 1: Failing tests** in `app/f/[publicId]/actions.test.ts`. Hoist a spy beside the file's others (`:5-15`): `const setContactsBusinessMock = vi.fn();`. Add to the `@bis/db` factory (`:95-115`): `setContactsBusiness: (...a: unknown[]) => setContactsBusinessMock(...a),`. Add to `beforeEach` (`:157-172`): `setContactsBusinessMock.mockReset().mockResolvedValue([]);`. Then append:

```ts
describe("submitFormAction — the business answer becomes a group (S-02 §6 rows 10-11)", () => {
  const fields = [
    { key: "email", kind: "core.email", label: "Email", required: false },
    { key: "company_name", kind: "core.company_name", label: "Business name", required: false },
  ];
  const submit = () => submitFormAction(PUBLIC_ID, IDLE, fd({
    [RENDER_TOKEN_FIELD]: signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID), locale: "en",
    email: "lead@example.com", company_name: "Acme Roofing",
  }));
  beforeEach(() => { getPublishedFormByPublicIdMock.mockResolvedValue(formRow({ fields })); });

  it("a new lead: never a contact column, one group write (mutation: pass companyName to createContact again -> FAILS)", async () => {
    expect((await submit()).status).toBe("success");
    expect(createContactMock.mock.calls[0]![2]).not.toHaveProperty("companyName");
    expect(setContactsBusinessMock).toHaveBeenCalledWith(expect.anything(), "acct_1",
      [{ contactId: "contact_1", name: "Acme Roofing" }], "form", "system");
  });
  it("a returning lead with no business gets one", async () => {
    createContactMock.mockResolvedValue({ id: "contact_1", existing: true });
    vi.mocked(getContact).mockResolvedValue({ id: "contact_1", company_name: null, custom: {} } as never);
    await submit();
    expect(setContactsBusinessMock).toHaveBeenCalledTimes(1);
  });
  it("a returning lead who already has a business keeps it (mutation: drop `&& !current.company_name` -> FAILS)", async () => {
    createContactMock.mockResolvedValue({ id: "contact_1", existing: true });
    vi.mocked(getContact).mockResolvedValue({ id: "contact_1", company_name: "Beta Pools", custom: {} } as never);
    await submit();
    expect(setContactsBusinessMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/f/[publicId]/actions.test.ts"`. Expected: the new cases fail (`companyName` present; `setContactsBusiness` not called). Paste one line.

- [ ] **Step 3: `enrich.ts`, new lead.** Add `setContactsBusiness` to the `@bis/db` import. In the `createContact` call delete the line `companyName: byKind.get("core.company_name") || undefined,`. After `contactId = created.id;` add:

```ts
    // S-02 §6 row 10: the business answer is a group (0069). A returning lead
    // goes through fillBlanks below, which never replaces a business it has.
    const business = byKind.get("core.company_name") || "";
    if (!created.existing && business) {
      await setContactsBusiness(db, accountId, [{ contactId, name: business }], "form", "system");
    }
```

- [ ] **Step 4: `enrich.ts`, `fillBlanks`.** Delete the pair `["companyName", "company_name", byKind.get("core.company_name") ?? ""],`. After the `updateContact` block and before `setAttribution`, add:

```ts
  // The "held" check still reads company_name: the database keeps it equal
  // to the contact's business group (0069), so blank means "no business yet".
  const business = byKind.get("core.company_name") ?? "";
  if (business && !current.company_name) {
    await setContactsBusiness(db, accountId, [{ contactId, name: business }], "form", "system");
  }
```

- [ ] **Step 5: `demo/seed.ts`.** Import `setContactsBusiness` from `../client-groups`. Delete `companyName: person.company,` from the `createContact` call and, after the `if (existing) throw …` line, add:

```ts
    if (person.company) {
      await setContactsBusiness(db, accountId, [{ contactId: id, name: person.company }], ACTOR, "system");
    }
```

- [ ] **Step 6: Run green.** `pnpm --filter web exec vitest run "src/app/f/[publicId]/actions.test.ts" "src/app/b/[publicId]/actions.test.ts" "src/app/api/concierge/[publicId]/turn/route.test.ts" src/lib/concierge/lead.test.ts src/lib/consent/scans.test.ts` and `pnpm --filter @bis/db exec vitest run src/test/demo-seed.test.ts` (PostgREST). Paste the summary lines.

- [ ] **Step 7: Mutation probe (required).** In `fillBlanks`, drop `&& !current.company_name`. Expected: `a returning lead who already has a business keeps it` FAILS by name. Revert.

- [ ] **Step 8: Commit** the files above: `feat(forms): a lead's business answer becomes a business group; the demo seed too`.

---

## Task 3c: The Business name field

**Owner:** bis-crm (with one additive edit to bis-frontend's `components/inline-field.tsx`, sanctioned by plan deviation 4). **Review:** opus. **Runs:** after Task 2; parallel with 3a, 3b, 4. The only `messages.ts` writer in its group.

**Files**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts` (new actions; `updateContactFieldAction:177-199` early branch)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts:62-66` and new cases; its `@bis/db` factory
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/actions.ts:122` (delete the dead `companyName`)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/business-field.tsx`
- Modify: `contacts/contact-drawer.tsx:61-67` (`FIELDS`) and the `<dl>` at `:204-238`
- Modify: `contacts/[contactId]/contact-fields-panel.tsx:90-106`
- Modify: `apps/web/src/components/inline-field.tsx:61-160` (additive `undoWith`)
- Modify: `apps/web/src/lib/messages.ts:637`, `:1222`, new keys; `apps/web/src/lib/i18n/catalogue-baseline.json`, `ratchet-baseline.json` (regenerated)

**Interfaces**
- Consumes: `setContactsBusiness`, `undoSetBusiness`, `getContact`, `serviceDb`, `GROUP_NAME_MAX`, `type GroupMemberSnapshot` (Task 2, `contacts.ts`).
- Produces:
  - `export type BusinessUndo = { added: string | null; removed: GroupMemberSnapshot | null }`
  - `export async function setContactBusinessAction(accountId: string, contactId: string, value: string): Promise<{ ok: true; undoPayload?: BusinessUndo } | { ok: false; error: string }>`
  - `export async function undoContactBusinessAction(accountId: string, contactId: string, undo: BusinessUndo): Promise<{ ok: true } | { ok: false; error: string }>`
  - `BusinessInlineField({ accountId, contactId, value })` (client component).
  - `InlineField` prop `undoWith?: (payload: unknown) => Promise<{ ok: true } | { ok: false; error: string }>`; `save` may return `undoPayload?: unknown`.
  - `FIELDS` no longer contains `company_name`; its type becomes `{ field: Exclude<EditableField, "source" | "company_name">; … }[]`.

- [ ] **Step 1: Failing tests** in `contacts/actions.test.ts`. Add to its `dbMocks` (`:20-32`): `setContactsBusiness: vi.fn(), undoSetBusiness: vi.fn(), GROUP_NAME_MAX: 120,` (`getContact`, `serviceDb` and `SERVICE` already exist there). Add `setContactBusinessAction, undoContactBusinessAction` to the destructured `await import("./actions")` (`:39-44`). The existing case "maps snake_case field to the ContactInput camel key, empty clears" (`:59-67`) uses `company_name`; change its field to `"first_name"` and its expected patch to `{ firstName: "" }` (its subject is the camel mapping, which first_name still has), and add beside it:

```ts
  it("the Business name goes to the group, never to updateContact (S-02 §6 row 3; mutation: fall through to updateContact -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1" });
    dbMocks.setContactsBusiness.mockResolvedValue([{ contactId: "c1", status: "ok", added: "m2", removed: null }]);
    const r = await updateContactFieldAction("a1", "c1", "company_name", "  Acme  ");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateContact).not.toHaveBeenCalled();
    expect(dbMocks.setContactsBusiness).toHaveBeenCalledWith(SERVICE, "a1", [{ contactId: "c1", name: "Acme" }], "user_1");
  });
```

and a new block:

```ts
describe("setContactBusinessAction", () => {
  it("refuses a contact the request client cannot see, before any service write (mutation: drop the getContact proof -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue(null);
    const r = await setContactBusinessAction("a1", "c9", "Acme");
    expect(r.ok).toBe(false);
    expect(dbMocks.setContactsBusiness).not.toHaveBeenCalled();
  });
  it("returns the server's own undo payload; an unchanged name returns none", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1" });
    const removed = { id: "m1", account_id: "a1", client_group_id: "g1", contact_id: "c1", role: null, is_primary: true, is_billing: false, created_at: "2026-01-01" };
    dbMocks.setContactsBusiness.mockResolvedValueOnce([{ contactId: "c1", status: "ok", added: "m2", removed }]);
    expect(await setContactBusinessAction("a1", "c1", "Beta")).toEqual({ ok: true, undoPayload: { added: "m2", removed } });
    dbMocks.setContactsBusiness.mockResolvedValueOnce([{ contactId: "c1", status: "unchanged", added: null, removed: null }]);
    expect(await setContactBusinessAction("a1", "c1", "beta")).toEqual({ ok: true });
  });
  it("refuses a name over 120 characters with plain words", async () => {
    const r = await setContactBusinessAction("a1", "c1", "x".repeat(121));
    expect(r).toEqual({ ok: false, error: m["contact.business.tooLong"] });
  });
  it("undo refuses a snapshot for another contact before any write", async () => {
    dbMocks.getContact.mockResolvedValue({ id: "c1" });
    const bad = { added: null, removed: { contact_id: "c2" } } as never;
    expect((await undoContactBusinessAction("a1", "c1", bad)).ok).toBe(false);
    expect(dbMocks.undoSetBusiness).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts"`. Expected: the new cases fail (`setContactBusinessAction` is not a function). Paste one line.

- [ ] **Step 3: The actions** in `contacts/actions.ts`. Add `setContactsBusiness, undoSetBusiness, GROUP_NAME_MAX, type GroupMemberSnapshot` to the `@bis/db` import (`isUuid`, `isUuidOrNull` are already imported from `@/lib/assign/action-guards`). Add:

```ts
/** What the Business name's Undo hands back: the server's own record (the phone field's precedent). */
export type BusinessUndo = { added: string | null; removed: GroupMemberSnapshot | null };

/**
 * The contact's Business name is a business GROUP (S-02 §6 row 3, 0069). The
 * request client proves the contact first (a Technician cannot see someone
 * else's customer), then the service client writes, because the group tables
 * are server-written. The column the list shows is kept by the database.
 */
export async function setContactBusinessAction(
  accountId: string, contactId: string, value: string,
): Promise<{ ok: true; undoPayload?: BusinessUndo } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  const name = value.trim();
  if (name.length > GROUP_NAME_MAX) return { ok: false, error: m["contact.business.tooLong"] };
  try {
    const db = await dbForRequest();
    if (!(await getContact(db, accountId, contactId))) return { ok: false, error: "Save failed — please try again." };
    const [r] = await setContactsBusiness(serviceDb(), accountId, [{ contactId, name }], userId);
    if (!r || r.status === "not_found") return { ok: false, error: "Save failed — please try again." };
    if (r.status === "too_long") return { ok: false, error: m["contact.business.tooLong"] };
    revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
    return r.status === "unchanged" ? { ok: true } : { ok: true, undoPayload: { added: r.added, removed: r.removed } };
  } catch (e) {
    console.error(`setContactBusinessAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: "Save failed — please try again." };
  }
}

export async function undoContactBusinessAction(
  accountId: string, contactId: string, undo: BusinessUndo,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAccountAccess(accountId);
  const removed = undo?.removed ?? null;
  if (!isUuidOrNull(undo?.added ?? null) || (removed !== null && removed.contact_id !== contactId)) {
    return { ok: false, error: "Undo failed — please try again." };
  }
  try {
    const db = await dbForRequest();
    if (!(await getContact(db, accountId, contactId))) return { ok: false, error: "Undo failed — please try again." };
    const r = await undoSetBusiness(serviceDb(), accountId, contactId, undo.added, removed);
    if (r !== "ok") return { ok: false, error: "Undo failed — please try again." };
    revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
    return { ok: true };
  } catch (e) {
    console.error(`undoContactBusinessAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, error: "Undo failed — please try again." };
  }
}
```

In `updateContactFieldAction`, directly after `if (!EDITABLE_FIELDS.includes(field)) return { ok: false, error: "Unknown field." };` add:

```ts
  if (field === "company_name") {
    const r = await setContactBusinessAction(accountId, contactId, value);
    return r.ok ? { ok: true } : r;
  }
```

In `contacts/[contactId]/actions.ts:122` change `email: val("email"), phone: val("phone"), companyName: val("companyName"),` to `email: val("email"), phone: val("phone"),` (no input named `companyName` exists in any `.tsx`; spec §6 row 4).

- [ ] **Step 4: `InlineField.undoWith`** (`components/inline-field.tsx`). Widen the `save` prop's result to `{ ok: true; undo?: PhoneInlineUndo; undoPayload?: unknown } | { ok: false; error: string }`, add the prop:

```ts
    /** A field whose save hands back its own server-built undo (the Business
     *  name, S-02 §6 row 3): Undo calls this with exactly that payload instead
     *  of re-saving the prior text. Absent: the default `save(prior)` undo. */
    undoWith?: (payload: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
```

destructure `undoWith` beside `undoPhone`, widen `let result:` to the same union, and replace the `undoable` line and the `onClick` body with:

```ts
    const ownUndo = undoWith ? result.undoPayload : undefined;
    const undoable = field === "phone" ? phoneUndo !== undefined
      : undoWith ? ownUndo !== undefined
      : normalize(prior).ok;
```

```ts
            onClick: () => {
              const run = undoWith && ownUndo !== undefined
                ? undoWith(ownUndo)
                : commitInlineUndo(field, prior, phoneUndo, save, undoPhone);
              void run.then((r) => {
                if (r.ok) { committed.current = prior; setShown(prior); }
                else toast.error(r.error);
              });
            },
```

- [ ] **Step 5: `business-field.tsx`:**

```tsx
"use client";

import { InlineField } from "@/components/inline-field";
import { m } from "@/lib/messages";
import { setContactBusinessAction, undoContactBusinessAction, type BusinessUndo } from "./actions";

/**
 * The contact's Business name (S-02 §6 rows 3 and 18): its value is the
 * contact's business group, as the database copies it into company_name; a
 * save links, replaces or unlinks that group, and Undo hands the server back
 * its own record of what it replaced. Each surface wraps this in its own row.
 */
export function BusinessInlineField({ accountId, contactId, value }: { accountId: string; contactId: string; value: string | null }) {
  return (
    <InlineField
      label={m["contact.company"]}
      field="company_name"
      value={value}
      save={(v) => setContactBusinessAction(accountId, contactId, v)}
      undoWith={(payload) => undoContactBusinessAction(accountId, contactId, payload as BusinessUndo)}
    />
  );
}
```

- [ ] **Step 6: Wire both surfaces.** In `contact-drawer.tsx`, delete the `company_name` entry from `FIELDS`, change its type to `Exclude<EditableField, "source" | "company_name">`, import `BusinessInlineField` from `./business-field`, and add after the `FIELDS.map(...)` inside the same `<dl>`:

```tsx
                <div key={`${row.id}:company_name`} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
                  <dt className="text-muted-foreground text-xs">{m["contact.company"]}</dt>
                  <dd><BusinessInlineField accountId={accountId} contactId={row.id} value={row.company_name ?? null} /></dd>
                </div>
```

In `contact-fields-panel.tsx`, import `BusinessInlineField` from `../business-field` and add after its `FIELDS.map(...)`, before `<SourceField`:

```tsx
            <div className="space-y-0.5">
              <dt className="text-muted-foreground text-xs">{m["contact.company"]}</dt>
              <dd><BusinessInlineField accountId={accountId} contactId={contactId} value={contact.company_name ?? null} /></dd>
            </div>
```

- [ ] **Step 7: Copy.** In `messages.ts`: change `"contact.company": "Company",` to `"contact.company": "Business name",` and add `"contact.company.es": "Nombre del negocio",` under it; change `"forms.kind.core.company_name": "Company",` to `"Business name"` and add `"forms.kind.core.company_name.es": "Nombre del negocio",`; add

```ts
  "contact.business.tooLong": "Business names can be up to 120 characters.",
  "contact.business.tooLong.es": "El nombre del negocio puede tener hasta 120 caracteres.",
```

Then regenerate the baselines and keep the result as its own reviewable part of this commit: `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`.

- [ ] **Step 8: Run green.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/components src/lib/i18n src/lib/contacts` and `pnpm --filter web typecheck`. Paste the summary lines. Every `vi.mock("@bis/db")` factory reaching `contacts/actions.ts` (`grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "contacts/actions\|from \"./actions\""`) must carry the three new names.

- [ ] **Step 9: Mutation probe (required).** In `setContactBusinessAction`, delete the `getContact` proof line. Expected: `refuses a contact the request client cannot see, before any service write` FAILS by name. Revert.

- [ ] **Step 10: Commit** the files above: `feat(contacts): the Business name field writes the business group, with a server-built Undo`.

---

## Task 4: The Groups card's server side

**Owner:** bis-crm. **Review:** opus. **Runs:** after Task 2; parallel with 3a, 3b, 3c.

**Files**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-actions.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-actions.test.ts`
- Create: `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/groups/route.ts`
- Create: `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/groups/route.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts:63-81` (one allowlist line)

**Interfaces**
- Consumes: Task 2's functions; `requireAccountAccess` (`lib/auth.ts:36`); `seesWholeAccount` (`lib/auth-role.ts:15`); `apiAccountAccess` (`lib/auth.ts:178`); `isUuid` (`lib/assign/action-guards.ts:11`).
- Produces (all `"use server"`, every result `{ ok: false; error: string }` on refusal; `error` values are catalogue strings Task 6 adds, so this task returns KEYS, see below):

```ts
export type GroupActionError = "groups.refused" | "groups.failed" | "groups.nameTaken" | "groups.tooLong";
export type GroupResult<T = object> = ({ ok: true } & T) | { ok: false; error: GroupActionError };
export async function searchGroupsAction(accountId: string, term: string): Promise<GroupSearchHit[]>;
export async function createGroupAction(accountId: string, contactId: string, kind: GroupKind, name: string): Promise<GroupResult<{ memberId: string; name: string; existed: boolean }>>;
export async function addToGroupAction(accountId: string, contactId: string, groupId: string): Promise<GroupResult<{ memberId: string }>>;
export async function setRoleAction(accountId: string, memberId: string, role: string): Promise<GroupResult<{ previous: string | null }>>;
export async function setBillingAction(accountId: string, memberId: string, isBilling: boolean): Promise<GroupResult<{ previous: boolean }>>;
export async function makePrimaryAction(accountId: string, memberId: string): Promise<GroupResult<{ previous: string | null }>>;
export async function removeMembershipAction(accountId: string, memberId: string): Promise<GroupResult<{ removed: GroupMemberSnapshot }>>;
export async function restoreMembershipAction(accountId: string, snapshot: GroupMemberSnapshot): Promise<GroupResult>;
export async function renameGroupAction(accountId: string, groupId: string, name: string): Promise<GroupResult<{ previous: string }>>;
export async function setBillingAddressAction(accountId: string, groupId: string, address: string): Promise<GroupResult<{ previous: string | null }>>;
// route: GET -> 200 { groups: ContactGroup[] } | 404 {}
export type GroupsResponse = { groups: ContactGroup[] };
```

- [ ] **Step 1: Failing tests** `groups-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const access = { userId: "user_1", isAgency: false, role: "technician" as string | null, canManage: false };
vi.mock("@/lib/auth", () => ({ requireAccountAccess: vi.fn(async () => access) }));
const REQUEST = { request: true };
const SERVICE = { service: true };
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => REQUEST) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const db = {
  serviceDb: vi.fn(() => SERVICE),
  getContact: vi.fn(), readMembership: vi.fn(), readGroup: vi.fn(),
  searchGroups: vi.fn(async () => []), createGroupWithMember: vi.fn(), addContactToGroup: vi.fn(),
  updateMembership: vi.fn(), setPrimaryMembership: vi.fn(), removeMembership: vi.fn(), restoreMembership: vi.fn(),
  updateGroup: vi.fn(), GROUP_NAME_MAX: 120, GROUP_ROLE_MAX: 60, BILLING_ADDRESS_MAX: 300,
};
vi.mock("@bis/db", () => db);

const A = await import("./groups-actions");
const C = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const G = "33333333-3333-4333-8333-333333333333";

beforeEach(() => { vi.clearAllMocks(); access.role = "technician"; access.isAgency = false; });

describe("every write proves its target through the request client first (mutation: skip the proof in any action -> its case FAILS)", () => {
  it("create: an unseen contact never reaches the service write", async () => {
    db.getContact.mockResolvedValue(null);
    expect(await A.createGroupAction("a1", C, "household", "Garcia")).toEqual({ ok: false, error: "groups.refused" });
    expect(db.getContact).toHaveBeenCalledWith(REQUEST, "a1", C);
    expect(db.createGroupWithMember).not.toHaveBeenCalled();
  });
  it("add, role, pays, main, remove: an unseen membership or contact never reaches the service write", async () => {
    db.getContact.mockResolvedValue(null);
    db.readMembership.mockResolvedValue(null);
    expect((await A.addToGroupAction("a1", C, G)).ok).toBe(false);
    expect((await A.setRoleAction("a1", M, "Madre")).ok).toBe(false);
    expect((await A.setBillingAction("a1", M, true)).ok).toBe(false);
    expect((await A.makePrimaryAction("a1", M)).ok).toBe(false);
    expect((await A.removeMembershipAction("a1", M)).ok).toBe(false);
    for (const f of [db.addContactToGroup, db.updateMembership, db.setPrimaryMembership, db.removeMembership]) expect(f).not.toHaveBeenCalled();
  });
  it("restore: the snapshot's contact must be one the caller can see", async () => {
    db.getContact.mockResolvedValue(null);
    const snap = { id: M, account_id: "a1", client_group_id: G, contact_id: C, role: null, is_primary: false, is_billing: false, created_at: "x" };
    expect((await A.restoreMembershipAction("a1", snap)).ok).toBe(false);
    expect(db.restoreMembership).not.toHaveBeenCalled();
  });
  it("a proven write goes through the SERVICE client", async () => {
    db.readMembership.mockResolvedValue({ contactId: C, groupId: G });
    db.setPrimaryMembership.mockResolvedValue({ status: "ok", previous: null });
    expect(await A.makePrimaryAction("a1", M)).toEqual({ ok: true, previous: null });
    expect(db.setPrimaryMembership).toHaveBeenCalledWith(SERVICE, "a1", M, "user_1");
  });
});

describe("A6: rename and billing address are Owner, Staff and agency only", () => {
  it("a Technician is refused even for a group they can see", async () => {
    db.readGroup.mockResolvedValue({ id: G, kind: "household", name: "Garcia", billingAddress: null });
    expect(await A.renameGroupAction("a1", G, "García")).toEqual({ ok: false, error: "groups.refused" });
    expect(await A.setBillingAddressAction("a1", G, "1 Main St")).toEqual({ ok: false, error: "groups.refused" });
    expect(db.updateGroup).not.toHaveBeenCalled();
  });
  it("Staff renames; a taken business name reads as nameTaken", async () => {
    access.role = "staff";
    db.readGroup.mockResolvedValue({ id: G, kind: "business", name: "Acme", billingAddress: null });
    db.updateGroup.mockResolvedValue({ status: "name_taken" });
    expect(await A.renameGroupAction("a1", G, "Beta")).toEqual({ ok: false, error: "groups.nameTaken" });
  });
});

describe("input shape", () => {
  it("refuses a non-uuid id and an over-long name or role without touching the database", async () => {
    expect((await A.makePrimaryAction("a1", "nope")).ok).toBe(false);
    expect(await A.createGroupAction("a1", C, "household", "x".repeat(121))).toEqual({ ok: false, error: "groups.tooLong" });
    expect(await A.setRoleAction("a1", M, "x".repeat(61))).toEqual({ ok: false, error: "groups.tooLong" });
    expect(db.readMembership).not.toHaveBeenCalled();
  });
});
```

and `route.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ apiAccountAccess: vi.fn(async () => ({ userId: "u", isAgency: false })) }));
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => ({ request: true })) }));
const db = { getContact: vi.fn(), listContactGroups: vi.fn(async () => [{ memberId: "m" }]) };
vi.mock("@bis/db", () => db);
const { GET } = await import("./route");
const call = () => GET(new Request("http://x"), { params: Promise.resolve({ accountId: "a1", contactId: "c1" }) });

describe("GET groups", () => {
  it("404s a contact the request client cannot see, reading nothing else (mutation: drop the getContact check -> FAILS)", async () => {
    db.getContact.mockResolvedValueOnce(null);
    expect((await call()).status).toBe(404);
    expect(db.listContactGroups).not.toHaveBeenCalled();
  });
  it("returns the contact's groups", async () => {
    db.getContact.mockResolvedValueOnce({ id: "c1" });
    expect(await (await call()).json()).toEqual({ groups: [{ memberId: "m" }] });
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-actions.test.ts" "src/app/api/accounts/[accountId]/contacts/[contactId]/groups/route.test.ts"`. Expected: `Failed to resolve import "./groups-actions"` / `"./route"`. Paste one line.

- [ ] **Step 3: `groups-actions.ts`:**

```ts
"use server";

import { revalidatePath } from "next/cache";
import {
  serviceDb, getContact, readMembership, readGroup, searchGroups, createGroupWithMember, addContactToGroup,
  updateMembership, setPrimaryMembership, removeMembership, restoreMembership, updateGroup,
  GROUP_NAME_MAX, GROUP_ROLE_MAX, BILLING_ADDRESS_MAX,
  type GroupKind, type GroupMemberSnapshot, type GroupSearchHit,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { seesWholeAccount } from "@/lib/auth-role";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";

/**
 * The Groups card's writes (S-02 §7). The group tables are server-written
 * (0069), so each action PROVES its target through the request client (RLS:
 * a Technician sees only their own customers and their memberships, G8),
 * then writes through the service client. Errors are catalogue KEYS; the
 * card renders them with m[...] (Task 6 adds the strings).
 */
export type GroupActionError = "groups.refused" | "groups.failed" | "groups.nameTaken" | "groups.tooLong";
export type GroupResult<T = object> = ({ ok: true } & T) | { ok: false; error: GroupActionError };
const refused = { ok: false, error: "groups.refused" } as const;
const failed = { ok: false, error: "groups.failed" } as const;
const tooLong = { ok: false, error: "groups.tooLong" } as const;
const contactsPath = (accountId: string) => `/dashboard/accounts/${accountId}/contacts`;

async function guarded<T>(label: string, accountId: string, run: () => Promise<GroupResult<T>>): Promise<GroupResult<T>> {
  try { return await run(); } catch (e) {
    console.error(`${label}: account ${accountId}: ${loggableError(e)}`);
    return failed;
  }
}

async function provenMembership(accountId: string, memberId: string) {
  if (!isUuid(memberId)) return null;
  return readMembership(await dbForRequest(), accountId, memberId);
}

export async function searchGroupsAction(accountId: string, term: string): Promise<GroupSearchHit[]> {
  await requireAccountAccess(accountId);
  if (typeof term !== "string" || term.length > GROUP_NAME_MAX) return [];
  return searchGroups(await dbForRequest(), accountId, term);
}

export async function createGroupAction(accountId: string, contactId: string, kind: GroupKind, name: string) {
  const { userId } = await requireAccountAccess(accountId);
  if (!isUuid(contactId) || (kind !== "household" && kind !== "business")) return refused;
  if (typeof name !== "string" || name.trim().length === 0) return failed;
  if (name.trim().length > GROUP_NAME_MAX) return tooLong;
  return guarded<{ memberId: string; name: string; existed: boolean }>("createGroupAction", accountId, async () => {
    if (!(await getContact(await dbForRequest(), accountId, contactId))) return refused;
    const r = await createGroupWithMember(serviceDb(), accountId, contactId, kind, name, null, userId);
    if (r.status !== "ok") return r.status === "invalid_name" ? failed : refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true, memberId: r.memberId, name: r.name, existed: r.existed };
  });
}

export async function addToGroupAction(accountId: string, contactId: string, groupId: string) {
  const { userId } = await requireAccountAccess(accountId);
  if (!isUuid(contactId) || !isUuid(groupId)) return refused;
  return guarded<{ memberId: string }>("addToGroupAction", accountId, async () => {
    const db = await dbForRequest();
    // Both proofs on the request client: the contact, and a group the caller can see (search showed it).
    if (!(await getContact(db, accountId, contactId)) || !(await readGroup(db, accountId, groupId))) return refused;
    const r = await addContactToGroup(serviceDb(), accountId, contactId, groupId, null, userId);
    return r.status === "ok" ? { ok: true, memberId: r.memberId } : refused;
  });
}

export async function setRoleAction(accountId: string, memberId: string, role: string) {
  const { userId } = await requireAccountAccess(accountId);
  if (typeof role !== "string") return failed;
  if (role.trim().length > GROUP_ROLE_MAX) return tooLong;
  return guarded<{ previous: string | null }>("setRoleAction", accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refused;
    const r = await updateMembership(serviceDb(), accountId, memberId, { role }, userId);
    return r.status === "ok" ? { ok: true, previous: r.previous.role } : refused;
  });
}

export async function setBillingAction(accountId: string, memberId: string, isBilling: boolean) {
  const { userId } = await requireAccountAccess(accountId);
  if (typeof isBilling !== "boolean") return failed;
  return guarded<{ previous: boolean }>("setBillingAction", accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refused;
    const r = await updateMembership(serviceDb(), accountId, memberId, { isBilling }, userId);
    return r.status === "ok" ? { ok: true, previous: r.previous.isBilling } : refused;
  });
}

export async function makePrimaryAction(accountId: string, memberId: string) {
  const { userId } = await requireAccountAccess(accountId);
  return guarded<{ previous: string | null }>("makePrimaryAction", accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refused;
    const r = await setPrimaryMembership(serviceDb(), accountId, memberId, userId);
    if (r.status !== "ok") return refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true, previous: r.previous };
  });
}

export async function removeMembershipAction(accountId: string, memberId: string) {
  const { userId } = await requireAccountAccess(accountId);
  return guarded<{ removed: GroupMemberSnapshot }>("removeMembershipAction", accountId, async () => {
    if (!(await provenMembership(accountId, memberId))) return refused;
    const r = await removeMembership(serviceDb(), accountId, memberId, userId);
    if (r.status !== "ok") return refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true, removed: r.removed };
  });
}

export async function restoreMembershipAction(accountId: string, snapshot: GroupMemberSnapshot) {
  const { userId } = await requireAccountAccess(accountId);
  if (!snapshot || !isUuid(snapshot.contact_id) || !isUuid(snapshot.client_group_id) || !isUuid(snapshot.id)) return refused;
  return guarded("restoreMembershipAction", accountId, async () => {
    if (!(await getContact(await dbForRequest(), accountId, snapshot.contact_id))) return refused;
    const r = await restoreMembership(serviceDb(), accountId, snapshot, userId);
    if (r !== "ok") return refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true };
  });
}

async function provenGroupForManager(accountId: string, groupId: string) {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !isUuid(groupId)) return null; // A6
  const group = await readGroup(await dbForRequest(), accountId, groupId);
  return group ? { userId: access.userId, group } : null;
}

export async function renameGroupAction(accountId: string, groupId: string, name: string) {
  if (typeof name !== "string" || name.trim().length === 0) return failed;
  if (name.trim().length > GROUP_NAME_MAX) return tooLong;
  return guarded<{ previous: string }>("renameGroupAction", accountId, async () => {
    const proven = await provenGroupForManager(accountId, groupId);
    if (!proven) return refused;
    const r = await updateGroup(serviceDb(), accountId, groupId, { name }, proven.userId);
    if (r.status === "name_taken") return { ok: false, error: "groups.nameTaken" };
    if (r.status !== "ok") return refused;
    revalidatePath(contactsPath(accountId));
    return { ok: true, previous: r.previous.name };
  });
}

export async function setBillingAddressAction(accountId: string, groupId: string, address: string) {
  if (typeof address !== "string") return failed;
  if (address.trim().length > BILLING_ADDRESS_MAX) return tooLong;
  return guarded<{ previous: string | null }>("setBillingAddressAction", accountId, async () => {
    const proven = await provenGroupForManager(accountId, groupId);
    if (!proven) return refused;
    const r = await updateGroup(serviceDb(), accountId, groupId, { billingAddress: address }, proven.userId);
    return r.status === "ok" ? { ok: true, previous: r.previous.billingAddress } : refused;
  });
}
```

- [ ] **Step 4: `route.ts`:**

```ts
import { NextResponse } from "next/server";
import { getContact, listContactGroups, type ContactGroup } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { loggableError } from "@/lib/loggable-error";

export const dynamic = "force-dynamic";

/** The Groups card reads this on its own, so it loads and fails on its own (spec §7; record page v2). */
export type GroupsResponse = { groups: ContactGroup[] };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access) return NextResponse.json({}, { status: 404 });
  // RLS-scoped: the contact read IS the authorisation (the texts route's rule).
  const db = await dbForRequest();
  try {
    if (!(await getContact(db, accountId, contactId))) return NextResponse.json({}, { status: 404 });
    const body: GroupsResponse = { groups: await listContactGroups(db, accountId, contactId) };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`groups route: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
```

- [ ] **Step 5: The service-read guard.** Add to `ALLOWED` in `in-account-service-reads.test.ts`, beside the `contacts/actions.ts` line (`:81`):

```ts
  "app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-actions.ts": "proven-target",
```

(Only this line. The guard also fails on a STALE entry (`in-account-service-reads.test.ts:136`), so Task 3a's `import/actions.ts` line cannot land here before 3a does; Task 5, which runs after both, adds it.)

- [ ] **Step 6: Run green.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-actions.test.ts" "src/app/api/accounts/[accountId]/contacts/[contactId]/groups/route.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` and `pnpm --filter web typecheck`. Paste the summary lines.

- [ ] **Step 7: Mutation probe (required).** In `removeMembershipAction`, replace `if (!(await provenMembership(accountId, memberId))) return refused;` with nothing. Expected: `add, role, pays, main, remove: an unseen membership…` FAILS by name. Revert.

- [ ] **Step 8: Commit** the five files: `feat(contacts): Groups card actions prove every target before the service write`.

---

## Task 5: Close the old writer

**Owner:** bis-crm. **Review:** sonnet. **Runs:** after 3a, 3b, 3c (every caller has stopped passing `companyName`) and 4 (its allowlist line comes first); parallel with Task 6.

**Files**
- Modify: `packages/db/src/contacts.ts:7-10` (`ContactInput`), `:142` (`toRow`)
- Modify: `packages/db/src/test/contacts.test.ts` (one new case; any case passing `companyName`)
- Modify: `apps/web/src/lib/contacts/field-input.ts:9-14`
- Modify: `apps/web/src/lib/contacts/field-input.test.ts`
- Modify: `apps/web/src/lib/contacts/csv.ts:12` (`InputKey`)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts` (one allowlist line, after Task 4's)

**Interfaces**
- Produces: `ContactInput = { firstName?; lastName?; email?; phone?; source?; custom? }`; `FIELD_TO_INPUT_KEY: Record<Exclude<EditableField, "company_name">, "firstName" | "lastName" | "email" | "phone" | "source">`.

- [ ] **Step 1: Failing test.** Add to `packages/db/src/test/contacts.test.ts`:

```ts
  it("updateContact can no longer write company_name; only the group sync sets it (S-02 A2; mutation: restore toRow's company_name line -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id } = await createContact(db, accountId, { firstName: "Ana", email: "ana.cn@example.com" }, "user_test");
      await updateContact(db, accountId, id, { companyName: "Acme" } as never, "user_test");
      expect((await getContact(db, accountId, id))!.company_name).toBeNull();
    }));
```

and to `field-input.test.ts`:

```ts
  it("company_name stays editable (trimmed) but has no ContactInput key: it is a group now", () => {
    expect(EDITABLE_FIELDS).toContain("company_name");
    expect("company_name" in FIELD_TO_INPUT_KEY).toBe(false);
  });
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/contacts/field-input.test.ts` (the second case fails); `pnpm --filter @bis/db exec vitest run src/test/contacts.test.ts` (PostgREST; the first case fails with `Acme`). Paste one line.

- [ ] **Step 3: Remove.** In `contacts.ts`, `ContactInput` becomes:

```ts
export type ContactInput = {
  firstName?: string; lastName?: string; email?: string; phone?: string;
  source?: string; custom?: Record<string, unknown>;
};
```

and delete `if (input.companyName !== undefined) row.company_name = input.companyName;` from `toRow`. In `field-input.ts`:

```ts
/** Maps the snake_case column to updateContact's ContactInput key. `company_name`
 *  has none: the Business name is a group (S-02 §6), written by setContactBusinessAction. */
export const FIELD_TO_INPUT_KEY:
  Record<Exclude<EditableField, "company_name">, "firstName" | "lastName" | "email" | "phone" | "source"> = {
  first_name: "firstName", last_name: "lastName", email: "email",
  phone: "phone", source: "source",
};
```

In `csv.ts`, `type InputKey = "firstName" | "lastName" | "email" | "phone" | "source";`. In `in-account-service-reads.test.ts`'s `ALLOWED`, beside Task 4's `groups-actions.ts` line, add `"app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/actions.ts": "proven-target",` (Task 3a's group write runs only for contacts its batch just wrote through the request client). Fix every compile error `pnpm --filter web typecheck` and `pnpm --filter @bis/db exec tsc --noEmit -p .` report by moving the caller to `setContactsBusiness` the way Tasks 3a to 3c did; there should be none outside test files (a test passing `companyName` is rewritten to assert through `client_groups`, never deleted).

- [ ] **Step 4: Run green.** `pnpm --filter web exec vitest run src/lib/contacts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, `pnpm --filter web typecheck`, and `pnpm --filter @bis/db exec vitest run src/test/contacts.test.ts src/test/contact-import.test.ts` (PostgREST). Paste the summary lines.

- [ ] **Step 5: Mutation probe (required).** Put the `toRow` line back. Expected: `updateContact can no longer write company_name…` FAILS by name. Revert.

- [ ] **Step 6: Commit** the five files: `refactor(contacts): no app path writes company_name; the database keeps it from the group`.

---

## Task 6: The Groups card UI and its copy

**Owner:** bis-frontend. **Review:** sonnet. **Runs:** after 3c (messages.ts, the drawer) and 4 (the actions and route); parallel with Task 5.

**Files**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-card.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-card.test.ts`
- Modify: `contacts/contact-drawer.tsx` (one block after `<EmailRow … />`, `:251`)
- Modify: `contacts/[contactId]/page.tsx:150-171` (the right column)
- Modify: `apps/web/src/lib/messages.ts` (the `groups.*` keys)

**Interfaces**
- Consumes: Task 4's actions, `GroupActionError` and `GroupsResponse`; `ContactGroup` (Task 2); `InlineField` (with `required`, `field="source"`), `Notice`, `Skeleton`, `Button`, `Popover`, `Command*` (`components/ui`); `contactDisplayName` (`lib/format.ts:119`); `toast` from `sonner`.
- Produces: `GroupsCard({ accountId, contactId, canManageGroups }: { accountId: string; contactId: string; canManageGroups: boolean })` and the pure `GroupsCardView(props & { load: GroupsLoad; onRetry: () => void; onChanged: () => void })`, `type GroupsLoad = { status: "loading" } | { status: "error" } | { status: "ready"; groups: ContactGroup[] }`.

- [ ] **Step 1: Copy first** (keys the test reads). Add to `messages.ts` under a `// Client groups (S-02 part 1)` comment:

```ts
  "groups.title": "Groups",
  "groups.title.es": "Grupos",
  "groups.kind.household": "Household",
  "groups.kind.household.es": "Familia",
  "groups.kind.business": "Business customer",
  "groups.kind.business.es": "Cliente comercial",
  "groups.primary": "Main group",
  "groups.primary.es": "Grupo principal",
  "groups.makePrimary": "Make main",
  "groups.makePrimary.es": "Hacer principal",
  "groups.billing": "Pays the bills",
  "groups.billing.es": "Paga las cuentas",
  "groups.role": "Role",
  "groups.role.es": "Papel",
  "groups.rolePlaceholder": "Role, like Madre or Dueño",
  "groups.rolePlaceholder.es": "Papel, como Madre o Dueño",
  "groups.name": "Group name",
  "groups.name.es": "Nombre del grupo",
  "groups.billingAddress": "Billing address",
  "groups.billingAddress.es": "Dirección de cobro",
  "groups.add": "Add to a group",
  "groups.add.es": "Agregar a un grupo",
  "groups.searchPlaceholder": "Search households and businesses",
  "groups.searchPlaceholder.es": "Buscar familias y negocios",
  "groups.createHousehold": "Create household “{name}”",
  "groups.createHousehold.es": "Crear familia “{name}”",
  "groups.createBusiness": "Create business customer “{name}”",
  "groups.createBusiness.es": "Crear cliente comercial “{name}”",
  "groups.added": "Added to {name}.",
  "groups.added.es": "Se agregó a {name}.",
  "groups.addedExisting": "Added to {name}, which was already on your list.",
  "groups.addedExisting.es": "Se agregó a {name}, que ya estaba en su lista.",
  "groups.remove": "Remove from this group",
  "groups.remove.es": "Quitar de este grupo",
  "groups.removed": "Removed from {name}.",
  "groups.removed.es": "Se quitó de {name}.",
  "groups.saved": "Saved.",
  "groups.saved.es": "Guardado.",
  "groups.empty": "Households and businesses this person belongs to show up here.",
  "groups.empty.es": "Las familias y negocios a los que pertenece esta persona aparecen aquí.",
  "groups.loadFailed": "Couldn't load groups.",
  "groups.loadFailed.es": "No se pudieron cargar los grupos.",
  "groups.retry": "Try again",
  "groups.retry.es": "Intentar de nuevo",
  "groups.refused": "You can't change that group.",
  "groups.refused.es": "No puede cambiar ese grupo.",
  "groups.failed": "That didn't save. Try again.",
  "groups.failed.es": "No se guardó. Intente de nuevo.",
  "groups.nameTaken": "There's already a business customer with that name.",
  "groups.nameTaken.es": "Ya hay un cliente comercial con ese nombre.",
  "groups.tooLong": "That's too long.",
  "groups.tooLong.es": "Es demasiado largo.",
  "groups.others": "Also in this group",
  "groups.others.es": "También en este grupo",
```

- [ ] **Step 2: Failing test** `groups-card.test.ts` (no DOM renderer in apps/web; static markup, the `texts-row.test.ts` idiom):

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";

vi.mock("./groups-actions", () => ({
  searchGroupsAction: vi.fn(), createGroupAction: vi.fn(), addToGroupAction: vi.fn(), setRoleAction: vi.fn(),
  setBillingAction: vi.fn(), makePrimaryAction: vi.fn(), removeMembershipAction: vi.fn(), restoreMembershipAction: vi.fn(),
  renameGroupAction: vi.fn(), setBillingAddressAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
const { GroupsCardView } = await import("./groups-card");

const group = (over: Partial<Record<string, unknown>> = {}) => ({
  memberId: "m1", groupId: "g1", kind: "household", name: "Garcia", billingAddress: null, role: "Madre",
  isPrimary: true, isBilling: true, others: [{ contactId: "c2", firstName: "Luis", lastName: null }], ...over,
});
const view = (load: unknown, canManageGroups = true) => renderToStaticMarkup(createElement(GroupsCardView, {
  accountId: "a1", contactId: "c1", canManageGroups, load: load as never, onRetry: () => {}, onChanged: () => {},
}));

describe("GroupsCardView", () => {
  it("loading is skeleton rows, never a spinner", () => {
    const html = view({ status: "loading" });
    expect(html).toContain('data-testid="groups-skeleton"');
    expect(html).not.toMatch(/spinner|animate-spin/);
  });
  it("error offers Retry inside the card", () => {
    const html = view({ status: "error" });
    expect(html).toContain(m["groups.loadFailed"]);
    expect(html).toContain(m["groups.retry"]);
  });
  it("empty sells the feature with its action (rule 5)", () => {
    const html = view({ status: "ready", groups: [] });
    expect(html).toContain(m["groups.empty"]);
    expect(html).toContain(m["groups.add"]);
  });
  it("loaded: kind as a word, main and pays as dot + word, the other members (rule 3; mutation: render the main mark as a coloured dot alone -> FAILS)", () => {
    const html = view({ status: "ready", groups: [group(), group({ memberId: "m2", groupId: "g2", kind: "business", name: "Acme Roofing", isPrimary: false, isBilling: false, others: [] })] });
    expect(html).toContain(m["groups.kind.household"]);
    expect(html).toContain(m["groups.kind.business"]);
    expect(html).toMatch(new RegExp(`data-mark="primary"[^>]*>.*?${m["groups.primary"]}`));
    expect(html).toMatch(new RegExp(`data-mark="billing"[^>]*>.*?${m["groups.billing"]}`));
    expect(html).toContain(m["groups.makePrimary"]);
    expect(html).toContain("Luis");
    expect(html).toContain("/dashboard/accounts/a1/contacts?peek=c2");
    expect(html).not.toMatch(/\bCompany\b/);
  });
  it("a Technician gets no rename or billing address editor (A6)", () => {
    const html = view({ status: "ready", groups: [group()] }, false);
    expect(html).not.toContain(`${m["inline.edit"].replace("{label}", m["groups.name"])}`);
    expect(html).not.toContain(m["groups.billingAddress"]);
    expect(html).toContain("Garcia");
  });
});
```

- [ ] **Step 3: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/groups-card.test.ts"`. Expected: `Failed to resolve import "./groups-card"`. Paste it.

- [ ] **Step 4: `groups-card.tsx`:**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import type { ContactGroup, GroupKind } from "@bis/db";
import { InlineField } from "@/components/inline-field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { contactDisplayName } from "@/lib/format";
import { m } from "@/lib/messages";
import type { GroupsResponse } from "@/app/api/accounts/[accountId]/contacts/[contactId]/groups/route";
import {
  searchGroupsAction, createGroupAction, addToGroupAction, setRoleAction, setBillingAction, makePrimaryAction,
  removeMembershipAction, restoreMembershipAction, renameGroupAction, setBillingAddressAction, type GroupActionError,
} from "./groups-actions";

/**
 * The Groups card (S-02 §8): households and business customers this person
 * belongs to. It loads, empties and fails on its own (record page v2), on the
 * drawer and on the contact page. Every change runs at once with an Undo
 * toast (rule 6). What a Technician sees is trimmed by the database (G8);
 * `canManageGroups` only hides the two editors they may not use (A6).
 */
export type GroupsLoad = { status: "loading" } | { status: "error" } | { status: "ready"; groups: ContactGroup[] };
type ViewProps = { accountId: string; contactId: string; canManageGroups: boolean };

const kindLabel = (k: GroupKind) => m[k === "household" ? "groups.kind.household" : "groups.kind.business"];
const errorText = (e: GroupActionError) => m[e];

export function GroupsCard(props: ViewProps) {
  const [nonce, setNonce] = useState(0);
  const [load, setLoad] = useState<GroupsLoad>({ status: "loading" });
  useEffect(() => {
    let stale = false;
    setLoad({ status: "loading" });
    fetch(`/api/accounts/${props.accountId}/contacts/${props.contactId}/groups`)
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as GroupsResponse;
        if (!stale) setLoad({ status: "ready", groups: Array.isArray(body.groups) ? body.groups : [] });
      })
      .catch(() => { if (!stale) setLoad({ status: "error" }); });
    return () => { stale = true; };
  }, [props.accountId, props.contactId, nonce]);
  const refresh = () => setNonce((n) => n + 1);
  return <GroupsCardView {...props} load={load} onRetry={refresh} onChanged={refresh} />;
}

export function GroupsCardView({ accountId, contactId, canManageGroups, load, onRetry, onChanged }:
  ViewProps & { load: GroupsLoad; onRetry: () => void; onChanged: () => void }) {
  return (
    <section aria-labelledby={`groups-${contactId}`} className="space-y-2" data-groups-card>
      <div className="flex items-center justify-between gap-2">
        <h3 id={`groups-${contactId}`} className="text-[13.5px] font-semibold text-card-foreground">{m["groups.title"]}</h3>
        {load.status === "ready" && load.groups.length > 0 ? (
          <AddToGroup accountId={accountId} contactId={contactId} onChanged={onChanged} />
        ) : null}
      </div>
      {load.status === "loading" ? (
        <div className="space-y-2" data-testid="groups-skeleton">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-full" />
        </div>
      ) : load.status === "error" ? (
        <Notice tone="crit" className="p-3">
          <p className="text-muted-foreground">{m["groups.loadFailed"]}</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>{m["groups.retry"]}</Button>
        </Notice>
      ) : load.groups.length === 0 ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{m["groups.empty"]}</p>
          <AddToGroup accountId={accountId} contactId={contactId} onChanged={onChanged} />
        </div>
      ) : (
        <ul className="flex flex-col text-sm">
          {load.groups.map((g) => (
            <GroupRow key={g.memberId} accountId={accountId} group={g} canManageGroups={canManageGroups} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Mark({ kind, label }: { kind: "primary" | "billing"; label: string }) {
  // Rule 3: never colour alone, always dot + word.
  return (
    <span data-mark={kind} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-[var(--accent)]" />{label}
    </span>
  );
}

function GroupRow({ accountId, group, canManageGroups, onChanged }:
  { accountId: string; group: ContactGroup; canManageGroups: boolean; onChanged: () => void }) {
  const run = async <T,>(p: Promise<({ ok: true } & T) | { ok: false; error: GroupActionError }>, undo?: (r: T) => Promise<unknown>) => {
    const r = await p;
    if (!r.ok) { toast.error(errorText(r.error)); return; }
    onChanged();
    toast.success(m["groups.saved"], undo ? { action: { label: m["common.undo"], onClick: () => { void undo(r as T).then(onChanged); } } } : undefined);
  };
  return (
    <li className="space-y-1 border-t border-[var(--row-line)] py-2 first:border-t-0" data-group-row={group.groupId}>
      <div className="flex flex-wrap items-center gap-2">
        {canManageGroups ? (
          <div className="min-w-0 flex-1">
            <InlineField label={m["groups.name"]} required value={group.name}
              save={async (v) => { const r = await renameGroupAction(accountId, group.groupId, v);
                if (r.ok) onChanged(); return r.ok ? { ok: true } : { ok: false, error: errorText(r.error) }; }} />
          </div>
        ) : <span className="min-w-0 flex-1 truncate font-medium">{group.name}</span>}
        <span className="text-xs text-muted-foreground">{kindLabel(group.kind)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {group.isPrimary ? <Mark kind="primary" label={m["groups.primary"]} /> : (
          <Button size="sm" variant="ghost" onClick={() => void run(makePrimaryAction(accountId, group.memberId),
            (r: { previous: string | null }) => r.previous ? makePrimaryAction(accountId, r.previous) : Promise.resolve())}>
            {m["groups.makePrimary"]}
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-pressed={group.isBilling}
          onClick={() => void run(setBillingAction(accountId, group.memberId, !group.isBilling),
            (r: { previous: boolean }) => setBillingAction(accountId, group.memberId, r.previous))}>
          {group.isBilling ? <Mark kind="billing" label={m["groups.billing"]} /> : m["groups.billing"]}
        </Button>
        <Button size="sm" variant="ghost" className="ml-auto" aria-label={`${m["groups.remove"]}: ${group.name}`}
          onClick={() => void (async () => {
            const r = await removeMembershipAction(accountId, group.memberId);
            if (!r.ok) { toast.error(errorText(r.error)); return; }
            onChanged();
            toast.success(m["groups.removed"].replace("{name}", group.name), {
              action: { label: m["common.undo"], onClick: () => { void restoreMembershipAction(accountId, r.removed).then(onChanged); } },
            });
          })()}>
          {m["groups.remove"]}
        </Button>
      </div>
      <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
        <span className="text-xs text-muted-foreground">{m["groups.role"]}</span>
        {/* `source`'s rule is the role's rule: trim, free text (plan deviation 5). */}
        <InlineField label={m["groups.role"]} field="source" value={group.role}
          save={async (v) => { const r = await setRoleAction(accountId, group.memberId, v);
            return r.ok ? { ok: true } : { ok: false, error: errorText(r.error) }; }} />
      </div>
      {canManageGroups ? (
        <div className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
          <span className="text-xs text-muted-foreground">{m["groups.billingAddress"]}</span>
          <InlineField label={m["groups.billingAddress"]} field="source" value={group.billingAddress}
            save={async (v) => { const r = await setBillingAddressAction(accountId, group.groupId, v);
              return r.ok ? { ok: true } : { ok: false, error: errorText(r.error) }; }} />
        </div>
      ) : null}
      {group.others.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {m["groups.others"]}:{" "}
          {group.others.map((o, i) => (
            <span key={o.contactId}>
              {i > 0 ? ", " : null}
              <Link className="underline" href={`/dashboard/accounts/${accountId}/contacts?peek=${o.contactId}`}>
                {contactDisplayName({ first_name: o.firstName, last_name: o.lastName })}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </li>
  );
}

function AddToGroup({ accountId, contactId, onChanged }: { accountId: string; contactId: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<{ id: string; kind: GroupKind; name: string }[]>([]);
  useEffect(() => {
    if (!open || term.trim() === "") { setHits([]); return; }
    let stale = false;
    const t = setTimeout(() => { void searchGroupsAction(accountId, term).then((h) => { if (!stale) setHits(h); }); }, 200);
    return () => { stale = true; clearTimeout(t); };
  }, [accountId, term, open]);
  const done = (name: string, existed: boolean) => {
    setOpen(false); setTerm(""); onChanged();
    toast.success(m[existed ? "groups.addedExisting" : "groups.added"].replace("{name}", name));
  };
  const name = term.trim();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="sm" variant="ghost">{m["groups.add"]}</Button></PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput placeholder={m["groups.searchPlaceholder"]} value={term} onValueChange={setTerm} />
          <CommandList>
            <CommandEmpty className="hidden" />
            <CommandGroup>
              {hits.map((h) => (
                <CommandItem key={h.id} value={h.id} onSelect={() => void addToGroupAction(accountId, contactId, h.id).then((r) => {
                  if (r.ok) done(h.name, false); else toast.error(errorText(r.error)); })}>
                  <span className="flex-1 truncate">{h.name}</span>
                  <span className="text-xs text-muted-foreground">{kindLabel(h.kind)}</span>
                </CommandItem>
              ))}
              {name ? (["household", "business"] as const).map((kind) => (
                <CommandItem key={kind} value={`create-${kind}`} onSelect={() => void createGroupAction(accountId, contactId, kind, name).then((r) => {
                  if (r.ok) done(r.name, r.existed); else toast.error(errorText(r.error)); })}>
                  {m[kind === "household" ? "groups.createHousehold" : "groups.createBusiness"].replace("{name}", name)}
                </CommandItem>
              )) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
```

`<Notice tone="crit" className="p-3">` is the drawer's own error shape (`contact-drawer.tsx:264`). `CommandInput` passes `value`/`onValueChange` through to cmdk. `--row-line` and `--accent` are existing tokens (`[contactId]/page.tsx:159` uses `--row-line`). `common.undo` exists (`inline-field.tsx` uses it).

- [ ] **Step 5: Mount it.** In `contact-drawer.tsx`, import `GroupsCard` from `./groups-card` and add directly after the `<EmailRow … />` element:

```tsx
              <GroupsCard key={`${row.id}:groups`} accountId={accountId} contactId={row.id} canManageGroups={canAssign} />
```

(`canAssign` is the drawer's existing "Owner, Staff or agency" prop, `contact-drawer.tsx:71-73`: the same people A6 lets rename.) In `[contactId]/page.tsx`, wrap the existing right-column `<aside …>` in `<div className="space-y-4">` and put first inside it:

```tsx
          <aside className="rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3">
            <GroupsCard accountId={accountId} contactId={contactId} canManageGroups={assign.canAssign} />
          </aside>
```

- [ ] **Step 6: Run green.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/lib/i18n` and `pnpm --filter web typecheck`. The ratchet stays green (every key has a twin). Paste the summary lines.

- [ ] **Step 7: Mutation probe (required).** In `Mark`, delete `{label}`. Expected: `loaded: kind as a word, main and pays as dot + word…` FAILS by name. Revert.

- [ ] **Step 8: Definition of done, by hand** (report each): both themes (`.dark` toggle), the blur fallback, Esc closes the add popover, focus ring on every button, the pseudo-locale's +35% does not break the row (`/styleguide` is unchanged: no new shared component). Commit the files: `feat(contacts): the Groups card on the drawer and the contact page`.

---

## Task 7: e2e `groups.spec.ts`

**Owner:** bis-e2e-qa. **Review:** sonnet. **Runs:** after Tasks 5 and 6. Playwright is the orchestrator's to run.

**Files**
- Create: `apps/web/e2e/groups.spec.ts`

- [ ] **Step 1: Write the spec**, on the per-run fixture account only (never Test Client One), shaped like `assign.spec.ts:36-110` (run-time fixture read, `describe.serial`, seeded rows deleted in `afterAll` with the error checked):

```ts
import { test, expect } from "./fixtures/test";
import { existsSync, readFileSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, createContact } from "@bis/db";
import { m } from "../src/lib/messages";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * S-02 part 1 (spec §9 e2e): an Owner builds a household on the per-run
 * fixture account, sets a role, main and pays, removes and Undoes; the
 * Business name edit reaches the list; and the Technician sees their own
 * customer's household but not the other member (G8). Never Test Client One.
 */
test.describe.configure({ timeout: 60_000 });
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
type Fixture = { accountId: string; clerkUserId: string; technicianUserId: string };
function fixture(): Fixture {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE}: run the full suite.`);
  const f = JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as Partial<Fixture>;
  if (!f.accountId || !f.clerkUserId || !f.technicianUserId) throw new Error(`${FIXTURE_FILE} lacks the technician: run the full suite.`);
  return f as Fixture;
}

const stamp = Date.now();
const HOUSEHOLD = `Familia ${stamp}`;
const BUSINESS = `Groups Biz ${stamp}`;
let accountId = "";
let anaId = "";
let luisId = "";

test.beforeAll(async () => {
  const f = fixture();
  accountId = f.accountId;
  const db = serviceDb();
  await setClientAccess(db, accountId, true, f.clerkUserId);
  anaId = (await createContact(db, accountId, { firstName: "Groups", lastName: `Ana ${stamp}`, assignedTo: f.technicianUserId }, "e2e-groups")).id;
  luisId = (await createContact(db, accountId, { firstName: "Groups", lastName: `Luis ${stamp}` }, "e2e-groups")).id;
});

test.afterAll(async () => {
  if (!accountId) return;
  const db = serviceDb();
  for (const id of [anaId, luisId]) {
    if (!id) continue;
    const { error } = await db.from("contacts").delete().eq("id", id);
    expect(error, `deleting ${id}`).toBeNull();
  }
  const { error } = await db.from("client_groups").delete().eq("account_id", accountId).in("name", [HOUSEHOLD, BUSINESS]);
  expect(error, "deleting the probe groups").toBeNull();
});

test.describe.serial("S-02: households and the business name", () => {
  test.describe("the Owner", () => {
    test.use({ storageState: "e2e/.auth/client-state.json" });

    test("builds a household, sets role, main and pays, removes and Undoes", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${anaId}`);
      const card = page.locator("[data-groups-card]");
      await expect(card.getByText(m["groups.empty"])).toBeVisible();
      await card.getByRole("button", { name: m["groups.add"] }).click();
      await page.getByPlaceholder(m["groups.searchPlaceholder"]).fill(HOUSEHOLD);
      await page.getByRole("option", { name: m["groups.createHousehold"].replace("{name}", HOUSEHOLD) }).click();
      await expect(page.getByText(m["groups.added"].replace("{name}", HOUSEHOLD))).toBeVisible();
      await expect(card.getByText(m["groups.kind.household"])).toBeVisible();
      await expect(card.locator('[data-mark="primary"]')).toContainText(m["groups.primary"]);

      await card.getByRole("button", { name: new RegExp(`^${m["inline.edit"].replace("{label}", m["groups.role"])}`) }).click();
      await page.getByRole("textbox", { name: m["groups.role"] }).fill("Madre");
      await page.keyboard.press("Enter");
      await card.getByRole("button", { name: m["groups.billing"] }).click();
      await expect(card.locator('[data-mark="billing"]')).toContainText(m["groups.billing"]);

      const db = serviceDb();
      const row = await db.from("client_group_members").select("id, role, is_primary, is_billing").eq("contact_id", anaId).single();
      expect(row.error, row.error?.message).toBeNull();
      expect(row.data).toMatchObject({ role: "Madre", is_primary: true, is_billing: true });

      await card.getByRole("button", { name: `${m["groups.remove"]}: ${HOUSEHOLD}` }).click();
      const removedText = m["groups.removed"].replace("{name}", HOUSEHOLD);
      await expect(page.getByText(removedText)).toBeVisible();
      // Scoped to THIS toast: the role and pays saves left Undo toasts of their own on screen.
      await page.locator("[data-sonner-toast]").filter({ hasText: removedText })
        .getByRole("button", { name: m["common.undo"] }).click();
      await expect(card.getByText(HOUSEHOLD)).toBeVisible();
      const back = await db.from("client_group_members").select("id, role, is_billing").eq("contact_id", anaId).single();
      expect(back.data).toEqual({ id: row.data!.id, role: "Madre", is_billing: true });
    });

    test("adds the second person through search", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${luisId}`);
      const card = page.locator("[data-groups-card]");
      await card.getByRole("button", { name: m["groups.add"] }).click();
      await page.getByPlaceholder(m["groups.searchPlaceholder"]).fill(`Familia ${stamp}`.slice(0, 12));
      await page.getByRole("option", { name: new RegExp(HOUSEHOLD) }).first().click();
      await expect(card.getByText(`Ana ${stamp}`)).toBeVisible();
    });

    test("the Business name edit reaches the list column", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${luisId}`);
      await page.getByRole("button", { name: new RegExp(`^${m["inline.edit"].replace("{label}", m["contact.company"])}`) }).click();
      await page.getByRole("textbox", { name: m["contact.company"] }).fill(BUSINESS);
      await page.keyboard.press("Enter");
      await expect(page.getByText(m["inline.saved"].replace("{label}", m["contact.company"]))).toBeVisible();
      await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${encodeURIComponent(`Luis ${stamp}`)}`);
      await expect(page.locator("[data-contact-row]").filter({ hasText: `Luis ${stamp}` })).toContainText(BUSINESS);
    });
  });

  test.describe("the Technician", () => {
    test.use({ storageState: "e2e/.auth/technician-state.json" });

    test("sees their customer's household but not the other member (G8)", async ({ page }) => {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${anaId}`);
      const card = page.locator("[data-groups-card]");
      await expect(card.getByText(HOUSEHOLD)).toBeVisible();     // positive control first
      await expect(card.getByText(`Luis ${stamp}`)).toHaveCount(0);
      await expect(card.getByText(m["groups.billingAddress"])).toHaveCount(0); // A6
    });
  });
});
```

- [ ] **Step 2: Typecheck the spec.** `pnpm --filter web exec tsc --noEmit -p e2e` if the repo has an e2e tsconfig, else `pnpm --filter web typecheck`. Paste the result.

- [ ] **Step 3: Mutation probe (required, by reasoning, since Playwright is not yours to run):** state which assertion fails if `client_group_members_technician_scope` were dropped (`toHaveCount(0)` on `Luis <stamp>`), and confirm the positive control precedes it.

- [ ] **Step 4: The orchestrator runs** `pnpm --filter web test:e2e groups.spec.ts assign.spec.ts contacts.spec.ts contacts-drawer.spec.ts contact-detail.spec.ts contacts-data.spec.ts forms.spec.ts` alone on the machine, after checking no `screenshots.yml` run is in progress.

- [ ] **Step 5: Commit.** `test(e2e): an Owner builds a household and edits the business name; the Technician sees only their member`.

---

## Task 8: Rollout (orchestrator; not a coding task)

- [ ] **0. Settle the number with Lane B.** Lane B's relationships migration is `0070` and is written in parallel. Before ANY apply, fetch `main` and both branches: the lane whose migration reaches the CI project first keeps the lower free number; if Lane B applies first, renumber this file (and its references in this plan, the spec and the commit) before step 1. `supabase db push` refuses an out-of-order version, so never push 0070 before 0069 or the reverse without renumbering.
- [ ] **1. Merge prep.** Merge `main` into the branch, re-run `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` one at a time on the combined tree.
- [ ] **2. Production pre-check** (read-only, MCP `execute_sql`): `select count(*) filter (where char_length(btrim(company_name)) > 120) as too_long, count(*) filter (where btrim(coalesce(company_name,'')) <> '') as named, count(distinct (account_id, lower(btrim(company_name)))) as keys from contacts;`. Record the three numbers: `keys` is the expected `groups_created`, `named` the expected `members_added`, `too_long` the expected `skipped_too_long`.
- [ ] **3. CI project.** Dispatch `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref spec/s02-groups` and read the run: it must list exactly `0069_client_groups.sql`. Then `-f step=push`; read it for success. The PR's `e2e` job fails until this is done (`.github/scripts/ci-migrations-applied.sh`).
- [ ] **4. Production.** Warn danlo in chat first (memory "Supabase MCP prompts": Accept/Decline shows only in the CLI terminal). Check once more that the file holds no backslash (`grep -c '\\' packages/db/supabase/migrations/0069_client_groups.sql` = 0). Apply 0069 via MCP `apply_migration` exactly once; never re-apply. Compare the stored body's md5 with the file's (memory "MCP SQL escapes").
- [ ] **5. Parity.** Run `docs/runbooks/ci-supabase-project.md`'s parity digest between bis-ci and production; they must match. Read `select count(*) from client_groups` and `select count(*) from client_group_members` on production against step 2's numbers.
- [ ] **6. Merge and deploy.** Read the check runs for the head SHA via `gh api repos/{owner}/{repo}/commits/{sha}/check-runs`; merge with the SHA pinned. Verify the deploy (READY with the merge SHA, aliased to `app.bis-rgv.com`; `/` 200, `/sign-in` 200, `/b/bogus` 404) and the served-HTML marker: a contact page's HTML contains `data-groups-card`.
- [ ] **7. The second reconcile (spec A4, §11).** Once the new build is live: run `select public.reconcile_business_groups();` once on production (MCP, warning danlo first) and once on bis-ci, and file both returned objects in the ledger. Non-zero `members_replaced`, `members_removed` or `respelled` are the old build's direct writes between step 4 and step 6, now folded in.
- [ ] **8. Runbooks and tracker.** Add 0069 to the run log in `docs/runbooks/ci-supabase-project.md` (bis-platform lands the line, including the post-deploy reconcile); update S-02's row in the roadmap tracker (memory "Roadmap tracker").

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| §1 goal: households and business customers, role, main, pays; backfill; writers write the group | Tasks 1, 2, 3a, 3b, 3c, 6 |
| §2 G1–G3 split, card not page, no suggested groups | scope of this plan; Task 6 mounts on existing surfaces |
| G4 two kinds, labels, never "Company" | Task 1 kind check; Task 3c relabels `contact.company` and the forms kind; Task 6 copy and the `not.toMatch(/\bCompany\b/)` assertion |
| G5, G9 backfill, dual-write, column kept as a DB copy | Task 1 trigger and `reconcile_business_groups`; Tasks 3a–3c write the group; Task 5 removes the last app writer; Task 8 step 7 |
| G6 several groups, one main, role, pays | Task 1 (`one_primary`, `promote_primary`, role check), Task 6 |
| G7 notes/tasks/deals on a group deferred | not built |
| G8, G11 Technician scope, existing business links | Task 1 RLS test; `find_or_create_business` runs as service; Task 7 Technician case |
| G10, A3 one business per key | Task 1 `client_groups_business_key` and its test |
| A1 server-only writes, proof first | Task 1 grants; Tasks 3c and 4 proofs and their mutation probes; Task 4 allowlist |
| A2 trigger sync, `ContactInput` loses `companyName` | Task 1 sync tests; Task 5 |
| A4 reconcile twice | Task 1 (in the migration), Task 8 step 7 |
| A5 labels | Task 3c |
| A6 rename and billing address managers only | Task 4 `provenGroupForManager` test; Task 6 hidden editors test |
| §5.1 tables, cascades, indexes | Task 1 |
| §5.2 RLS, grants, guard unchanged | Task 1 steps 2, 8 |
| §5.3 functions, sync | Task 1 |
| §5.4 backfill, normalisation, blanks, effect, rollback | Task 1 functions test; the migration header |
| Teardown | Task 2 step 4 and its test |
| §6 the twenty places | rows 1–2: Task 5; 3, 4, 18, 20: Task 3c; 5–9: Task 3a; 10–12: Task 3b; 13–17, 19: unchanged by design (the column is derived) |
| §7 app: module, actions, route | Tasks 2 and 4 |
| §8 screens and copy | Tasks 3c and 6 |
| §9 testing | each task's tests; Task 7 |
| §11 rollout, both hazards | Task 8 |
| §12 risks | the `chr()` assumption: Task 1 steps 1 and 7; a missed writer: Task 5's compile break |

Type and name consistency checked across tasks: `GroupMemberSnapshot`, `BusinessResult`, `ContactGroup`, `GroupKind`, `GroupSearchHit`, `setContactsBusiness`, `undoSetBusiness`, `readMembership`, `readGroup`, `BusinessUndo`, `setContactBusinessAction`, `undoContactBusinessAction`, `BusinessInlineField`, `undoWith`/`undoPayload`, `GroupActionError`, `GroupResult`, `GroupsResponse`, `GroupsCard`, `GroupsCardView`, `GroupsLoad`; SQL names match the Task 1 Produces block.

## Findings for the ledger (outside this plan's scope)

1. **Spec gap, handled here:** spec §5.4 and §12 do not say what happens to a stored `company_name` longer than 120 characters; the migration would have failed on it. Plan deviation 2 skips and counts it; Task 8 step 2 measures production first. Worth a line in the spec.
2. **Spec gap, handled here:** the spec's Undo for a Business name edit could delete a membership that existed before the edit (the contact already belonged to the target business). Plan deviation 3.
3. **New event types** `client_group.created`, `.member_added`, `.member_updated`, `.member_removed`, `.renamed`, `.business_set`. The account Activity feed shows only mapped types; whether group changes belong there is a later copy decision.
4. **`InlineField.undoWith`** generalises the phone field's server-built undo; the phone path could move onto it later (bis-frontend).
