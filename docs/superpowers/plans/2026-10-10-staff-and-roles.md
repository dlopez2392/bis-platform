# Staff and roles: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: `docs/superpowers/specs/2026-10-10-staff-and-roles-design.md` (owner decisions R1 to R5 are settled; do not re-open them).

**Goal:** A client company has Owner and Staff logins that the database and the app both enforce, and its Owner runs their own team from a Team screen.

**Architecture:** BIS's database owns the role (`memberships.role` = `owner` | `staff`, `users.language`). Clerk owns who belongs to which organisation. Three paths keep the two in step: a Svix-verified Clerk webhook, a per-request fallback inside `requireAccountAccess`, and a one-time backfill that emits SQL. Owner-only capabilities are refused in Postgres by RESTRICTIVE policies that call `app.is_account_owner()`, and in the app by `requireAccountOwner()`. Team writes go through `serviceDb()` and two service-role-only SQL functions that hold the last-Owner guard under a row lock.

**Tech Stack:** Next 16 App Router (server actions, `proxy.ts`), Clerk (`@clerk/nextjs` 7, Backend API), Supabase Postgres (RLS, PostgREST), `svix` 1.x (already a dependency of `apps/web`), vitest 4, Playwright.

## Global Constraints

- Tokens only: no hard-coded colours, radii or shadows (DESIGN.md).
- DESIGN.md rules 3 (role is dot + word), 5 (loaded, empty and error states), 6 (reversible actions run at once with an undo toast, no typed confirm), 7 (skeletons, no spinners), 8 (one primary button per card), 10 (Team sits in the pinned sidebar footer), and the ⌘K rule: every new destination and settings section is registered in `apps/web/src/lib/palette/registry.ts`.
- Migrations are applied by the orchestrator only, in this order: CI project (`ci-project-setup.yml`), then production via MCP, then the parity check. Never by an implementer, and never re-applied.
- Role helpers coalesce to false. `app.is_agency()` is NULL for a client token, and a NULL inside plpgsql `IF NOT (...)` fails OPEN. No membership means no role, never Owner.
- Agents run only the affected tests, by path. CI runs the full suite. `pnpm check`, the build and `test:e2e` belong to the orchestrator and run one at a time.
- Every test must be able to fail. Each test below names the mutation that must turn it red. Run that mutation, see the test fail BY NAME, then revert.
- Never parse `.env` values with code that can throw. Read `process.env.X` for presence only, and never echo a value.
- Never point mutating e2e at Test Client One. Use only the per-run `E2E Client Co <stamp>` fixture.
- Migration number: "next free migration number at implementation time" (the folder ends at `0064_call_card.sql` today; the Spanish-runtime lane adds one too). Below it is written `NNNN_staff_and_roles.sql`.
- Copy: every new string goes in `apps/web/src/lib/messages.ts` under the `team.*` namespace with a `.es` twin (the `"key"` / `"key.es"` convention, e.g. `todo.consent.*`). If the runtime lane's catalogue helper has merged first, route the strings through it instead.

## Where the plan departs from the spec's wording (the source decided)

1. **Helper parameter name.** The spec writes `app.account_role(account_id uuid)`. In a SQL-language function a column name outranks a parameter of the same name, so `m.account_id = account_id` would compare the column with itself and match every row. The parameter is therefore `p_account_id`. The signature type `(uuid)` is unchanged.
2. **Billing is not read through `serviceDb()`.** The spec assumed the Billing page reads through `serviceDb()`. In fact `billing/page.tsx` reads `account_billing` through `readAccountBilling` (`dbForRequest`) and `usage_events` through `sumUsageSince(dbForRequest())`. Only `plans` goes through `serviceDb()`. The owner check therefore lands on those two tables' SELECT. The client-selectable billing tables are exactly `account_billing` and `usage_events`: `plans` is agency-read only (0051), and `billing_links` and `stripe_webhook_events` carry no grant (0051, 0052). The reviewer verifies this list against live grants (Task 1, step 9).
3. **Where the backfill lives.** The spec says `packages/db/scripts/`, which does not exist. The precedent is `packages/db/src/backfill/*-run.ts` plus a `backfill:*` script, which connects to no database and emits SQL that the orchestrator runs through MCP. The backfill follows that precedent, so no local machine ever holds a production database credential.
4. **The RLS harness is `withRollback` + `actAs`.** Role tests use those raw-SQL helpers (`packages/db/src/test/db.ts`), as `rls.test.ts` does. `withTestAccount` (a supabase-js service client) is used only where a test has to commit rows across connections.
5. **The topbar already hides `OrganizationSwitcher` from clients.** `components/topbar.tsx` renders it only for `isAgency`. Spec §6's requirement is already true, so Task 8 pins it with a regression test instead of changing code.
6. **Agency users are excluded from team sync.** `createClientAccount` passes `createdBy`, which makes the agency admin an `org:admin` member of every client org it creates (`lib/auth/sole-organization.ts`). Under the fallback rule that person would become Owner of every account. The webhook, the backfill and the reconcile function therefore skip any user whose `public_metadata.app_role` is `agency_admin`.
7. **The webhook re-reads Clerk.** For a membership event, the handler does not apply the payload. It re-reads the current (user, org) membership from Clerk and makes BIS match it. A replayed `created` that arrives after a `deleted` therefore converges to "absent" instead of resurrecting the row.

---

## Task order and parallelism

| # | Task | Owner | Runs |
|---|---|---|---|
| 1 | Migration, role helpers, policies, team SQL functions, grants guard | bis-db-schema | first, alone |
| 2 | `@bis/db` team data layer, role rule and reconcile | bis-db-schema | after 1 |
| 3 | Auth: role on `requireAccountAccess`, per-request fallback, `requireAccountOwner`, Clerk adapter | bis-platform | after 2, parallel with 4 and 5 |
| 4 | Clerk webhook `POST /api/webhooks/clerk` | bis-platform | after 2, parallel with 3 and 5 |
| 5 | Backfill planner and SQL emitter | bis-db-schema | after 2, parallel with 3 and 4 |
| 6 | Contacts: delete and export are Owner-only | bis-crm | after 3, parallel with 7, 8 and 9 |
| 7 | Calendar settings are Owner-only | bis-booking | after 3, parallel with 6, 8 and 9 |
| 8 | Billing guard, nav (Billing hidden for Staff, Team footer link), palette, topbar pin | bis-platform | after 3, parallel with 6, 7 and 9 |
| 9 | Team server actions and the pure team view | bis-platform | after 3, parallel with 6, 7 and 8 |
| 10 | Team card UI, Team page, Settings card swap, copy | bis-frontend | after 8 and 9 |
| 11 | e2e: Staff login fixture and role specs | bis-e2e-qa | after 10 |
| 12 | Rollout checklist (orchestrator, not code) | orchestrator | after merge prep |

Shared hot files: `messages.ts` (Tasks 8 and 10, additive, `team.*` / `nav.team*` keys only), `packages/db/src/index.ts` (Tasks 2 and 5, additive), `nav-groups.ts` and `palette/registry.ts` (Task 8 only).

---

## Task 1: Migration, role helpers, policies, team SQL functions, grants guard

**Owner:** bis-db-schema. **Sequential:** first.

**Files**
- Create: `packages/db/supabase/migrations/NNNN_staff_and_roles.sql`
- Create: `packages/db/src/test/staff-roles.test.ts`
- Create: `packages/db/src/test/team-functions.test.ts`
- Modify: `packages/db/src/test/schema-grants-guard.test.ts` (remove the `"authenticated memberships": IUD` and `"authenticated users": IUD` lines)
- Modify (positive client cases now act as an Owner, and each gains a Staff twin): `packages/db/src/test/billing-schema.test.ts` (around lines 158, 166), `packages/db/src/test/server-only-writes-grants.test.ts` (around lines 237, 254), plus any other file that `vitest run` turns red in step 7

**Interfaces**
- Produces (SQL):
  - `app.account_role(p_account_id uuid) returns text`: stable, security definer, `search_path = ''`. Returns `'owner'`, `'staff'` or NULL.
  - `app.is_account_owner(p_account_id uuid) returns boolean`: never NULL.
  - `public.set_account_member_role(p_account_id uuid, p_user_id uuid, p_role text) returns text`: returns `'ok'`, `'last_owner'` or `'not_found'`. Executable by `service_role` only.
  - `public.remove_account_member(p_account_id uuid, p_user_id uuid) returns text`: same return values, `service_role` only.
  - Constraint `memberships_account_user_key unique (account_id, user_id)`, which is the upsert target for PostgREST.
  - Column `users.language text null check (language in ('en','es'))`.
- Consumes: `app.jwt()`, `app.is_agency()`, `app.current_account_id()` (0001, 0008).

- [ ] **Step 1: Verify the facts the migration relies on (read-only, local replica or bis-ci through MCP `execute_sql`, orchestrator-run if you lack access).**

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.memberships'::regclass;
select role, count(*) from public.memberships group by role;   -- spec §5: expected zero rows
```

Expected: constraint names `memberships_role_check`, `memberships_account_id_fkey`, `memberships_user_id_fkey` and `memberships_check`, and no membership rows. If a name differs, use the real name in step 4 and say so in the report.

- [ ] **Step 2: Write the failing role-matrix test** `packages/db/src/test/staff-roles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Staff and roles (spec §5, §7, §11). Owner-only capabilities are refused in
 * Postgres by RESTRICTIVE policies calling app.is_account_owner(). A refused
 * DELETE/UPDATE under RLS is not an error: the row is simply not matched, so
 * every refusal is asserted as rowCount 0 AND the row read back as the owner.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_roles_${RUN}`;
const SUB = {
  owner: `user_roles_owner_${RUN}`, staff: `user_roles_staff_${RUN}`,
  none: `user_roles_none_${RUN}`, removed: `user_roles_removed_${RUN}`,
} as const;
type Actor = keyof typeof SUB | "agency";
const claimsFor = (a: Actor) => (a === "agency" ? { app_role: "agency_admin", sub: `user_roles_agency_${RUN}` } : { org_id: ORG, sub: SUB[a] });

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Roles Co',true) returning id",
    [agency!.id, ORG])).rows[0]!.id;
  const user = async (sub: string) => (await c.query<{ id: string }>(
    "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [sub])).rows[0]!.id;
  const [owner, staff, removed] = [await user(SUB.owner), await user(SUB.staff), await user(SUB.removed)];
  await user(SUB.none);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role)
     values ($1,'account',$4,'owner'), ($2,'account',$4,'staff'), ($3,'account',$4,'owner')`, [owner, staff, removed, acct]);
  await c.query("delete from memberships where user_id = $1", [removed]); // removal deletes the row (spec §5)
  const contact = (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name) values ($1,'Del') returning id", [acct])).rows[0]!.id;
  const calendar = (await c.query<{ id: string }>(
    "insert into calendars (account_id, public_id) values ($1,$2) returning id", [acct, `roles-${RUN}`])).rows[0]!.id;
  const plan = (await c.query<{ id: string }>(
    `insert into plans (agency_id, name, monthly_price_cents, features, allowances, overage_cents, stripe_product_id, stripe_price_ids)
     values ($1, $2, 4900, '{}', '{"voice_minutes":1,"sms":1,"ai_chats":1}', '{"voice_minutes":1,"sms":1,"ai_chats":1}', 'prod_roles',
             '{"base":"price_b","voice_minutes":"price_v","sms":"price_s","ai_chats":"price_a"}') returning id`,
    [agency!.id, `Roles ${RUN}`])).rows[0]!.id;
  await c.query("insert into account_billing (account_id, plan_id) values ($1,$2)", [acct, plan]);
  await c.query("insert into usage_events (account_id, meter, quantity, occurred_at, source_ref) values ($1,'sms',1,now(),$2)",
    [acct, `message:roles-${RUN}`]);
  return { acct, contact, calendar };
}

const ALLOWED: Record<Actor, boolean> = { owner: true, staff: false, none: false, removed: false, agency: true };

describe("owner-only capabilities, by actor (mutation: drop any one restrictive policy -> the staff row for that surface FAILS)", () => {
  for (const actor of Object.keys(ALLOWED) as Actor[]) {
    const n = ALLOWED[actor] ? 1 : 0;
    it(`${actor}: contact delete matches ${n}`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor(actor));
      expect((await c.query("delete from contacts where id = $1", [s.contact])).rowCount).toBe(n);
    }));
    it(`${actor}: calendar settings update matches ${n}`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor(actor));
      expect((await c.query("update calendars set buffer_minutes = 15, updated_at = now() where id = $1", [s.calendar])).rowCount).toBe(n);
    }));
    it(`${actor}: account_billing and usage_events read ${n} row(s) each`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor(actor));
      expect((await c.query("select 1 from account_billing where account_id = $1", [s.acct])).rowCount).toBe(n);
      expect((await c.query("select 1 from usage_events where account_id = $1", [s.acct])).rowCount).toBe(n);
    }));
  }
});

describe("Staff keeps the working surfaces (mutation: make a restrictive policy FOR ALL -> FAILS)", () => {
  it("staff still reads and updates contacts and reads the calendar", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("staff"));
    expect((await c.query("update contacts set first_name = 'Kept' where id = $1", [s.contact])).rowCount).toBe(1);
    expect((await c.query("select 1 from calendars where id = $1", [s.calendar])).rowCount).toBe(1);
  }));
});

describe("the NULL guard (memory: plpgsql NULL guard)", () => {
  it("is_account_owner is FALSE, never NULL, for a client token with no membership (mutation: drop either coalesce -> FAILS with null)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("none"));
      const { rows: [r] } = await c.query("select app.is_account_owner($1) as o, app.account_role($1) as r", [s.acct]);
      expect(r).toEqual({ o: false, r: null });
    }));
  it("a token with an org claim but no sub at all is refused", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, { org_id: ORG });
    expect((await c.query("delete from contacts where id = $1", [s.contact])).rowCount).toBe(0);
  }));
  it("a member of ANOTHER account is not an owner here (mutation: drop the account_id predicate in account_role -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const other = (await c.query<{ id: string }>(
        "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Other',true) returning id",
        [agency!.id, `${ORG}_b`])).rows[0]!.id;
      await actAs(c, claimsFor("owner"));
      const { rows: [r] } = await c.query("select app.is_account_owner($1) as here, app.is_account_owner($2) as there", [s.acct, other]);
      expect(r).toEqual({ here: true, there: false });
    }));
});

describe("team visibility (spec §5 grants)", () => {
  it("a client reads its own company's memberships and users, nothing else, and cannot write either", () =>
    withRollback(async (c) => {
      await seed(c);
      await actAs(c, claimsFor("staff"));
      const { rows } = await c.query<{ clerk_user_id: string }>("select clerk_user_id from users order by 1");
      expect(rows.map((r) => r.clerk_user_id).sort()).toEqual([SUB.owner, SUB.staff].sort());
      await expect(c.query("update memberships set role = 'owner'")).rejects.toMatchObject({ code: "42501" });
      await expect(c.query("insert into users (clerk_user_id, email) values ('x','x@example.com')")).rejects.toMatchObject({ code: "42501" });
    }));
  it("users.language accepts en, es and NULL only (mutation: drop the check -> FAILS)", () => withRollback(async (c) => {
    await c.query("insert into users (clerk_user_id, email, language) values ($1, 'l@example.com', 'es')", [`user_lang_${RUN}`]);
    await expect(c.query("insert into users (clerk_user_id, email, language) values ($1, 'f@example.com', 'fr')", [`user_lang_fr_${RUN}`]))
      .rejects.toMatchObject({ code: "23514" });
  }));
  it("memberships.role is owner|staff only (mutation: keep 'admin' in the check -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const u = (await c.query<{ id: string }>("insert into users (clerk_user_id, email) values ($1,'a@example.com') returning id", [`user_admin_${RUN}`])).rows[0]!.id;
    await expect(c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'admin')", [u, s.acct]))
      .rejects.toMatchObject({ code: "23514" });
  }));
});
```

- [ ] **Step 3: Run it red.**

Run: `pnpm --filter @bis/db exec vitest run src/test/staff-roles.test.ts`
Expected: fails on the first seed, `new row for relation "memberships" violates check constraint "memberships_role_check"` (the value `'owner'` is not allowed yet). Paste that line. Judge by vitest's summary block (rule 4), not by the exit code.

- [ ] **Step 4: Write the migration** `packages/db/supabase/migrations/NNNN_staff_and_roles.sql`:

```sql
-- NNNN_staff_and_roles.sql — Staff and roles (docs/superpowers/specs/2026-10-10-staff-and-roles-design.md §5, §7)
--
-- BIS owns the role; Clerk owns who belongs to which organisation. Roles: owner | staff.
-- Owner-only, refused HERE for a client token (the browser holds the token and the public key):
--   contacts DELETE, calendars UPDATE (the settings columns), account_billing SELECT, usage_events SELECT.
-- Each is a RESTRICTIVE policy calling app.is_account_owner(), ANDed with the existing permissive
-- tenant policy, so nothing that policy refused becomes allowed.
--
-- Membership and user rows are written by server code only (serviceDb(): the webhook, the
-- request fallback, the Team actions). `authenticated` keeps SELECT on its own company's rows.
-- The last-Owner guard lives in two service_role-only functions that serialise on the account row.
--
-- APPLY ORDER: CI project, then production, then parity. On production apply it, then the
-- backfill SQL (Task 5), then merge: between this file and the backfill an existing client login
-- has no membership and so cannot delete contacts, change calendar settings or read billing.
--
-- ROLLBACK (section by section):
--   6  drop function public.remove_account_member(uuid, uuid); drop function public.set_account_member_role(uuid, uuid, text);
--   5  grant insert, update, delete on public.users, public.memberships to authenticated; recreate
--      users_agency_all / memberships_agency_all as FOR ALL (0001); drop policy users_member_read on public.users;
--   4  drop policy contacts_owner_delete on public.contacts; drop policy calendars_owner_update on public.calendars;
--      drop policy account_billing_owner_read on public.account_billing; drop policy usage_events_owner_read on public.usage_events;
--   3  drop function app.is_account_owner(uuid); drop function app.account_role(uuid);
--   2  alter table public.users drop column language;
--   1  restore memberships_role_check to ('admin','member') after mapping owner->admin, staff->member;
--      drop constraint memberships_account_user_key; restore both FKs without on delete cascade.

set local lock_timeout = '5s';

-- 1. memberships: roles, the upsert key, and cascades (a membership is derived from Clerk;
--    deleting the account or the user carries it away, so account-teardown.ts needs no entry).
update public.memberships set role = 'owner' where role = 'admin';
update public.memberships set role = 'staff' where role = 'member';
alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in ('owner', 'staff'));
alter table public.memberships add constraint memberships_account_user_key unique (account_id, user_id);
alter table public.memberships
  drop constraint memberships_account_id_fkey,
  add constraint memberships_account_id_fkey foreign key (account_id) references public.accounts(id) on delete cascade,
  drop constraint memberships_user_id_fkey,
  add constraint memberships_user_id_fkey foreign key (user_id) references public.users(id) on delete cascade;

-- 2. A language per person. NULL = follow the account's language (the Spanish runtime reads user -> account -> default).
alter table public.users add column language text constraint users_language_check check (language in ('en', 'es'));
comment on column public.users.language is
  'The person''s own language, en or es. NULL = follow the account''s language. Written by the Team actions and the invitation''s bis_language; the person''s own control arrives with F-096.';

-- 3. Role helpers. p_account_id, not account_id: in a SQL function a column outranks a same-named parameter.
create function app.account_role(p_account_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role
    from public.memberships m
    join public.users u on u.id = m.user_id
   where m.scope = 'account'
     and m.account_id = p_account_id
     and u.clerk_user_id = nullif(app.jwt() ->> 'sub', '')
$$;

-- Both coalesces are load-bearing: app.is_agency() is NULL for a client token, and account_role is NULL with no membership.
create function app.is_account_owner(p_account_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_agency(), false) or coalesce(app.account_role(p_account_id) = 'owner', false)
$$;

revoke all on function app.account_role(uuid) from public, anon;
revoke all on function app.is_account_owner(uuid) from public, anon;
grant execute on function app.account_role(uuid) to authenticated, service_role;
grant execute on function app.is_account_owner(uuid) to authenticated, service_role;

-- 4. Owner-only, as RESTRICTIVE policies (ANDed with each table's existing permissive policy).
create policy contacts_owner_delete on public.contacts as restrictive for delete to authenticated
  using (app.is_account_owner(account_id));
create policy calendars_owner_update on public.calendars as restrictive for update to authenticated
  using (app.is_account_owner(account_id)) with check (app.is_account_owner(account_id));
create policy account_billing_owner_read on public.account_billing as restrictive for select to authenticated
  using (app.is_account_owner(account_id));
create policy usage_events_owner_read on public.usage_events as restrictive for select to authenticated
  using (app.is_account_owner(account_id));

-- 5. Team rows: SELECT for the client role (own company), writes server-only.
revoke insert, update, delete on public.users, public.memberships from authenticated;
drop policy users_agency_all on public.users;
create policy users_agency_read on public.users for select to authenticated using (app.is_agency());
create policy users_member_read on public.users for select to authenticated
  using (exists (select 1 from public.memberships m
                  where m.user_id = users.id and m.scope = 'account' and m.account_id = app.current_account_id()));
drop policy memberships_agency_all on public.memberships;
create policy memberships_agency_read on public.memberships for select to authenticated using (app.is_agency());
-- memberships_member_read (0001) stays as is.

-- 6. Role change and removal with the last-Owner guard. Serialised on the account row, so two
--    Owners demoting each other at once cannot leave none. service_role only (the Team actions).
create function public.set_account_member_role(p_account_id uuid, p_user_id uuid, p_role text)
returns text language plpgsql set search_path = '' as $$
declare v_current text; v_owners int;
begin
  if p_role is null or p_role not in ('owner', 'staff') then
    raise exception 'set_account_member_role: role must be owner or staff' using errcode = '22023';
  end if;
  perform 1 from public.accounts where id = p_account_id for update;
  if not found then return 'not_found'; end if;
  select role into v_current from public.memberships
   where scope = 'account' and account_id = p_account_id and user_id = p_user_id;
  if v_current is null then return 'not_found'; end if;
  if v_current = p_role then return 'ok'; end if;
  if v_current = 'owner' then
    select count(*) into v_owners from public.memberships
     where scope = 'account' and account_id = p_account_id and role = 'owner';
    if v_owners <= 1 then return 'last_owner'; end if;
  end if;
  update public.memberships set role = p_role
   where scope = 'account' and account_id = p_account_id and user_id = p_user_id;
  return 'ok';
end $$;

create function public.remove_account_member(p_account_id uuid, p_user_id uuid)
returns text language plpgsql set search_path = '' as $$
declare v_current text; v_owners int;
begin
  perform 1 from public.accounts where id = p_account_id for update;
  if not found then return 'not_found'; end if;
  select role into v_current from public.memberships
   where scope = 'account' and account_id = p_account_id and user_id = p_user_id;
  if v_current is null then return 'not_found'; end if;
  if v_current = 'owner' then
    select count(*) into v_owners from public.memberships
     where scope = 'account' and account_id = p_account_id and role = 'owner';
    if v_owners <= 1 then return 'last_owner'; end if;
  end if;
  delete from public.memberships where scope = 'account' and account_id = p_account_id and user_id = p_user_id;
  return 'ok';
end $$;

revoke all on function public.set_account_member_role(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.remove_account_member(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_account_member_role(uuid, uuid, text) to service_role;
grant execute on function public.remove_account_member(uuid, uuid) to service_role;
```

- [ ] **Step 5: Write the team-function test** `packages/db/src/test/team-functions.test.ts`. It commits rows, because the concurrency case needs two connections:

```ts
import { describe, it, expect } from "vitest";
import { Client } from "pg";
import "dotenv/config";
import { withRollback } from "./db";

const RUN = Math.random().toString(36).slice(2, 10);
const connect = async () => { const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, connectionTimeoutMillis: 10_000 }); await c.connect(); return c; };

/** Committed: an account with two Owners. Cleaned in finally (account delete cascades memberships; users by sub). */
async function withTwoOwners(fn: (ids: { acct: string; a: string; b: string }) => Promise<void>) {
  const c = await connect();
  const subs = [`user_tf_a_${RUN}`, `user_tf_b_${RUN}`];
  let acct = "";
  try {
    const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
    acct = (await c.query<{ id: string }>(
      "insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'TF Co') returning id", [agency!.id, `org_test_tf_${RUN}`])).rows[0]!.id;
    const ids: string[] = [];
    for (const s of subs) ids.push((await c.query<{ id: string }>("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [s])).rows[0]!.id);
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$3,'owner'),($2,'account',$3,'owner')", [ids[0], ids[1], acct]);
    await fn({ acct, a: ids[0]!, b: ids[1]! });
  } finally {
    if (acct) await c.query("delete from accounts where id = $1", [acct]);
    await c.query("delete from users where clerk_user_id = any($1)", [subs]);
    await c.end();
  }
}

describe("last-Owner guard", () => {
  it("refuses demoting or removing the only Owner", () => withRollback(async (c) => {
    const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
    const acct = (await c.query<{ id: string }>("insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'Solo') returning id", [agency!.id, `org_solo_${RUN}`])).rows[0]!.id;
    const u = (await c.query<{ id: string }>("insert into users (clerk_user_id, email) values ($1,'s@example.com') returning id", [`user_solo_${RUN}`])).rows[0]!.id;
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'owner')", [u, acct]);
    const one = async (sql: string, p: unknown[]) => (await c.query<{ r: string }>(sql, p)).rows[0]!.r;
    expect(await one("select public.set_account_member_role($1,$2,'staff') as r", [acct, u])).toBe("last_owner");
    expect(await one("select public.remove_account_member($1,$2) as r", [acct, u])).toBe("last_owner");
    expect(await one("select public.set_account_member_role($1, gen_random_uuid(), 'staff') as r", [acct])).toBe("not_found");
  }));

  it("two Owners demoting each other at once leave exactly one Owner (mutation: drop `for update` on accounts -> both return ok, FAILS)", () =>
    withTwoOwners(async ({ acct, a, b }) => {
      const c1 = await connect(); const c2 = await connect();
      try {
        await c1.query("begin"); await c2.query("begin");
        const r1 = (await c1.query<{ r: string }>("select public.set_account_member_role($1,$2,'staff') as r", [acct, a])).rows[0]!.r;
        const p2 = c2.query<{ r: string }>("select public.set_account_member_role($1,$2,'staff') as r", [acct, b]);
        await new Promise((res) => setTimeout(res, 300)); // c2 is now blocked on the account row
        await c1.query("commit");
        const r2 = (await p2).rows[0]!.r;
        await c2.query("commit");
        expect([r1, r2]).toEqual(["ok", "last_owner"]);
        const { rows } = await c1.query("select 1 from memberships where account_id = $1 and role = 'owner'", [acct]);
        expect(rows).toHaveLength(1);
      } finally { await c1.end(); await c2.end(); }
    }));

  it("only service_role may execute either function (mutation: grant execute to authenticated -> FAILS)", () => withRollback(async (c) => {
    const { rows } = await c.query(
      `select r.role, p.fn, has_function_privilege(r.role, p.fn, 'execute') as can
         from (values ('anon'),('authenticated'),('service_role')) r(role),
              (values ('public.set_account_member_role(uuid,uuid,text)'),('public.remove_account_member(uuid,uuid)')) p(fn)
        order by 1, 2`);
    expect(rows.filter((x: { can: boolean }) => x.can).map((x: { role: string }) => x.role)).toEqual(["service_role", "service_role"]);
  }));

  it("deleting the account carries its memberships away (mutation: keep the FK without cascade -> the delete FAILS 23503)", () =>
    withRollback(async (c) => {
      const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
      const acct = (await c.query<{ id: string }>("insert into accounts (agency_id, clerk_org_id, name) values ($1,$2,'Gone') returning id", [agency!.id, `org_gone_${RUN}`])).rows[0]!.id;
      const u = (await c.query<{ id: string }>("insert into users (clerk_user_id, email) values ($1,'g@example.com') returning id", [`user_gone_${RUN}`])).rows[0]!.id;
      await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'staff')", [u, acct]);
      await c.query("delete from accounts where id = $1", [acct]);
      expect((await c.query("select 1 from memberships where user_id = $1", [u])).rowCount).toBe(0);
    }));
});
```

- [ ] **Step 6: Edit `schema-grants-guard.test.ts`:** delete the two lines `"authenticated memberships": IUD,` and `"authenticated users": IUD,`. Before applying the migration locally the guard test now fails ("expected … to equal"), which is the red for spec §11's "Grants guard" line.

- [ ] **Step 7: Apply the migration to the LOCAL replica only** (memory "Local DB replica": PG18 on danlo's machine plus the migrations). Run green:

```
pnpm --filter @bis/db exec vitest run src/test/staff-roles.test.ts src/test/team-functions.test.ts src/test/schema-grants-guard.test.ts src/test/billing-schema.test.ts src/test/billing-checkout-schema.test.ts src/test/server-only-writes-grants.test.ts src/test/consent-ledger-schema.test.ts src/test/rls.test.ts
```

Expected before the fixes in step 8: the positive client cases in `billing-schema.test.ts` (client reads its own `account_billing` and `usage_events`) and `server-only-writes-grants.test.ts` (client updates calendars, client deletes a contact) fail with rowCount 0. Those failures are the policies working.

- [ ] **Step 8: Update those positive cases.** Each actor in them gets a `sub` with an Owner membership (seed a `users` row and an `owner` membership, then call `actAs(c, { org_id, sub })`). Add a Staff twin beside each, asserting rowCount 0. Never weaken an assertion to make it pass. Re-run step 7's command. Expected: every file green. Paste the summary line.

- [ ] **Step 9: Mutation probes (paste each failing test's name).** (a) Comment out `contacts_owner_delete` and the `staff: contact delete matches 0` test fails. (b) Replace `is_account_owner`'s body with `select app.is_agency() or app.account_role(p_account_id) = 'owner'` and the NULL-guard test fails with `null`. (c) Delete `for update` from `set_account_member_role` and the concurrency test fails. (d) Re-add `grant insert on public.memberships to authenticated` and the schema guard fails. Revert each one. Then, for the reviewer: list every client-selectable billing table from the live catalogue:

```sql
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and has_table_privilege('authenticated', c.oid, 'select')
   and c.relname in ('plans','account_billing','usage_events','billing_links','stripe_webhook_events');
```

Expected: `plans`, `account_billing`, `usage_events`. `plans` already carries `plans_agency_read` (agency only), so no owner check is needed there.

- [ ] **Step 10: Commit.** `git add` the migration and the test files by explicit path. Message: `feat(db): owner and staff roles, owner-only policies, server-only team writes (staff and roles)`. Do NOT apply the migration anywhere except the local replica.

---

## Task 2: `@bis/db` team data layer, role rule and reconcile

**Owner:** bis-db-schema. **Sequential:** after Task 1.

**Files**
- Create: `packages/db/src/team.ts`, `packages/db/src/test/team.test.ts`
- Modify: `packages/db/src/index.ts` (additive: the exports listed below)

**Interfaces (Produces)**

```ts
export type AccountRole = "owner" | "staff";
export type PersonLanguage = "en" | "es";
export type TeamMember = { userId: string; clerkUserId: string; email: string; name: string | null; role: AccountRole; language: PersonLanguage | null };

/** The rule from spec §6, as one pure function: invitation bis_role, else org:admin -> owner, else staff. */
export function roleFromClerk(input: { clerkRole: string; membershipMeta?: unknown; invitationMeta?: unknown }): AccountRole;
export function languageFromClerk(...metas: unknown[]): PersonLanguage | null;
export function isAgencyMetadata(publicMetadata: unknown): boolean;   // app_role === "agency_admin"

export async function readAccountRole(db: SupabaseClient, accountId: string, clerkUserId: string): Promise<AccountRole | null>;
export async function upsertUserFromClerk(db: SupabaseClient, u: { clerkUserId: string; email: string; name: string | null; language?: PersonLanguage | null }): Promise<string>; // users.id
export async function addAccountMember(db: SupabaseClient, m: { accountId: string; userId: string; role: AccountRole }): Promise<"created" | "existed">;
export async function deleteAccountMembership(db: SupabaseClient, accountId: string, userId: string): Promise<void>; // the webhook's "Clerk says gone" path: no last-Owner guard
export async function setAccountMemberRole(db: SupabaseClient, accountId: string, userId: string, role: AccountRole): Promise<"ok" | "last_owner" | "not_found">;
export async function removeAccountMember(db: SupabaseClient, accountId: string, userId: string): Promise<"ok" | "last_owner" | "not_found">;
export async function setMemberLanguage(db: SupabaseClient, accountId: string, userId: string, language: PersonLanguage | null): Promise<"ok" | "not_found">;
export async function listAccountTeam(db: SupabaseClient, accountId: string): Promise<TeamMember[]>;

/** What reconcile needs from Clerk. The web app supplies a clerkClient adapter; tests supply a fake. */
export interface ClerkTeamPort {
  getUser(clerkUserId: string): Promise<{ email: string | null; name: string | null; publicMetadata: unknown } | null>;
  getMembership(clerkUserId: string, clerkOrgId: string): Promise<{ role: string; publicMetadata: unknown } | null>;
  acceptedInvitationMeta(clerkOrgId: string, email: string): Promise<unknown | null>;
}
export type ReconcileOutcome =
  | { outcome: "no_account" } | { outcome: "agency_user" } | { outcome: "no_email" }
  | { outcome: "created" | "exists"; role: AccountRole } | { outcome: "removed" | "absent" };
/** Makes BIS match Clerk's CURRENT state for (user, org): re-read, never trust an event payload. */
export async function reconcileMembership(db: SupabaseClient, clerk: ClerkTeamPort,
  input: { clerkUserId: string; clerkOrgId: string; mode: "webhook" | "fallback" }): Promise<ReconcileOutcome>;
```

- [ ] **Step 1: Write failing tests** `packages/db/src/test/team.test.ts`. Pure-function cases plus real-database cases on `withTestAccount` (service client, committed, torn down; delete the test `users` rows by `clerk_user_id` in `finally`):

```ts
import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { roleFromClerk, languageFromClerk, reconcileMembership, readAccountRole, setAccountMemberRole,
         listAccountTeam, type ClerkTeamPort } from "../team";

const RUN = Math.random().toString(36).slice(2, 10);

describe("roleFromClerk: the three sources, in order (spec §6)", () => {
  it("invitation bis_role on the membership wins over the Clerk role (mutation: check clerkRole first -> FAILS)", () =>
    expect(roleFromClerk({ clerkRole: "org:admin", membershipMeta: { bis_role: "staff" } })).toBe("staff"));
  it("then the accepted invitation's metadata", () =>
    expect(roleFromClerk({ clerkRole: "org:member", invitationMeta: { bis_role: "owner" } })).toBe("owner"));
  it("org:admin with no metadata is owner (every existing client login)", () =>
    expect(roleFromClerk({ clerkRole: "org:admin" })).toBe("owner"));
  it("anything else is staff, including a garbage bis_role (mutation: default to owner -> FAILS)", () => {
    expect(roleFromClerk({ clerkRole: "org:member" })).toBe("staff");
    expect(roleFromClerk({ clerkRole: "org:member", membershipMeta: { bis_role: "admin" } })).toBe("staff");
  });
  it("languageFromClerk takes the first valid en|es and ignores others", () =>
    expect(languageFromClerk({ bis_language: "fr" }, { bis_language: "es" })).toBe("es"));
});

function fakePort(over: Partial<{ user: Awaited<ReturnType<ClerkTeamPort["getUser"]>>; membership: Awaited<ReturnType<ClerkTeamPort["getMembership"]>>; invite: unknown }>): ClerkTeamPort {
  return {
    getUser: async () => over.user === undefined ? { email: `p-${RUN}@example.com`, name: "Pat", publicMetadata: {} } : over.user,
    getMembership: async () => over.membership === undefined ? { role: "org:member", publicMetadata: {} } : over.membership,
    acceptedInvitationMeta: async () => over.invite ?? null,
  };
}

describe("reconcileMembership against the real database", () => {
  it("creates the user and membership with the rule's role, and a replay converges (mutation: upsert membership with update -> role reset, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { data } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).single();
      const sub = `user_rc_${RUN}`;
      try {
        const port = fakePort({ membership: { role: "org:member", publicMetadata: { bis_role: "owner", bis_language: "es" } } });
        expect(await reconcileMembership(db, port, { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
          .toEqual({ outcome: "created", role: "owner" });
        const team = await listAccountTeam(db, accountId);
        expect(team).toMatchObject([{ clerkUserId: sub, role: "owner", language: "es" }]);
        // The only Owner cannot be demoted (the guard); and a later BIS role change must survive a replayed created event.
        expect(await setAccountMemberRole(db, accountId, team[0]!.userId, "staff")).toBe("last_owner");
        await db.from("memberships").update({ role: "staff" }).eq("account_id", accountId).eq("user_id", team[0]!.userId);
        expect(await reconcileMembership(db, port, { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
          .toEqual({ outcome: "exists", role: "staff" });
      } finally { await serviceDb().from("users").delete().eq("clerk_user_id", sub); }
    }));
  it("a membership Clerk no longer has is removed on a webhook replay, never resurrected (mutation: apply the payload instead of re-reading -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { data } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).single();
      const sub = `user_rm_${RUN}`;
      try {
        await reconcileMembership(db, fakePort({}), { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" });
        expect(await reconcileMembership(db, fakePort({ membership: null }), { clerkUserId: sub, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
          .toEqual({ outcome: "removed" });
        expect(await readAccountRole(db, accountId, sub)).toBeNull();
      } finally { await serviceDb().from("users").delete().eq("clerk_user_id", sub); }
    }));
  it("an org with no accounts row is ignored and writes nothing", () =>
    withTestAccount(async (db) => {
      expect(await reconcileMembership(db, fakePort({}), { clerkUserId: `user_x_${RUN}`, clerkOrgId: `org_nobody_${RUN}`, mode: "webhook" }))
        .toEqual({ outcome: "no_account" });
      expect((await db.from("users").select("id").eq("clerk_user_id", `user_x_${RUN}`)).data).toEqual([]);
    }));
  it("an agency user is never made a member (mutation: drop the isAgencyMetadata check -> FAILS with created/owner)", () =>
    withTestAccount(async (db, accountId) => {
      const { data } = await db.from("accounts").select("clerk_org_id").eq("id", accountId).single();
      const port = fakePort({ user: { email: "a@example.com", name: null, publicMetadata: { app_role: "agency_admin" } }, membership: { role: "org:admin", publicMetadata: {} } });
      expect(await reconcileMembership(db, port, { clerkUserId: `user_ag_${RUN}`, clerkOrgId: data!.clerk_org_id, mode: "webhook" }))
        .toEqual({ outcome: "agency_user" });
    }));
});
```

- [ ] **Step 2: Run red.** `pnpm --filter @bis/db exec vitest run src/test/team.test.ts`. Expected: `Failed to resolve import "../team"`. Paste that line.

- [ ] **Step 3: Implement `packages/db/src/team.ts`.** The key pieces:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type AccountRole = "owner" | "staff";
export type PersonLanguage = "en" | "es";
const ROLES: readonly string[] = ["owner", "staff"];
const LANGS: readonly string[] = ["en", "es"];
const field = (meta: unknown, k: string): unknown =>
  typeof meta === "object" && meta !== null ? (meta as Record<string, unknown>)[k] : undefined;

export function roleFromClerk(input: { clerkRole: string; membershipMeta?: unknown; invitationMeta?: unknown }): AccountRole {
  for (const meta of [input.membershipMeta, input.invitationMeta]) {
    const r = field(meta, "bis_role");
    if (typeof r === "string" && ROLES.includes(r)) return r as AccountRole;
  }
  return input.clerkRole === "org:admin" ? "owner" : "staff";
}
export function languageFromClerk(...metas: unknown[]): PersonLanguage | null {
  for (const meta of metas) { const l = field(meta, "bis_language"); if (typeof l === "string" && LANGS.includes(l)) return l as PersonLanguage; }
  return null;
}
export const isAgencyMetadata = (m: unknown): boolean => field(m, "app_role") === "agency_admin";

export async function readAccountRole(db: SupabaseClient, accountId: string, clerkUserId: string): Promise<AccountRole | null> {
  const { data, error } = await db.from("memberships").select("role, users!inner(clerk_user_id)")
    .eq("scope", "account").eq("account_id", accountId).eq("users.clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`readAccountRole failed: ${error.message}`);
  return (data?.role as AccountRole | undefined) ?? null;
}

export async function upsertUserFromClerk(db: SupabaseClient, u: { clerkUserId: string; email: string; name: string | null; language?: PersonLanguage | null }): Promise<string> {
  // email and name follow Clerk; language is only ever SET here when the row has none (an invitation's choice), never overwritten.
  const { data, error } = await db.from("users").upsert({ clerk_user_id: u.clerkUserId, email: u.email, name: u.name },
    { onConflict: "clerk_user_id" }).select("id, language").single();
  if (error) throw new Error(`upsertUserFromClerk failed: ${error.message}`);
  if (u.language && data.language === null) {
    const { error: e2 } = await db.from("users").update({ language: u.language }).eq("id", data.id).is("language", null);
    if (e2) throw new Error(`upsertUserFromClerk language failed: ${e2.message}`);
  }
  return data.id as string;
}

export async function addAccountMember(db: SupabaseClient, m: { accountId: string; userId: string; role: AccountRole }): Promise<"created" | "existed"> {
  const { data, error } = await db.from("memberships")
    .upsert({ scope: "account", account_id: m.accountId, user_id: m.userId, role: m.role },
            { onConflict: "account_id,user_id", ignoreDuplicates: true }).select("id");
  if (error) throw new Error(`addAccountMember failed: ${error.message}`);
  return (data ?? []).length > 0 ? "created" : "existed";
}

export async function setAccountMemberRole(db: SupabaseClient, accountId: string, userId: string, role: AccountRole) {
  const { data, error } = await db.rpc("set_account_member_role", { p_account_id: accountId, p_user_id: userId, p_role: role });
  if (error) throw new Error(`setAccountMemberRole failed: ${error.message}`);
  return data as "ok" | "last_owner" | "not_found";
}
// removeAccountMember: the same shape over rpc("remove_account_member", { p_account_id, p_user_id }).
// setMemberLanguage: first confirm a membership (account_id, user_id) exists ("not_found" otherwise), then update users.language by id.
// listAccountTeam: memberships (scope account, account_id) joined to users(id, clerk_user_id, email, name, language), ordered by users.email.
// deleteAccountMembership: delete from memberships where account_id and user_id; throws on error.

export async function reconcileMembership(db: SupabaseClient, clerk: ClerkTeamPort,
  input: { clerkUserId: string; clerkOrgId: string; mode: "webhook" | "fallback" }): Promise<ReconcileOutcome> {
  const { data: account, error } = await db.from("accounts").select("id").eq("clerk_org_id", input.clerkOrgId).maybeSingle();
  if (error) throw new Error(`reconcileMembership account lookup failed: ${error.message}`);
  if (!account) return { outcome: "no_account" };
  const membership = await clerk.getMembership(input.clerkUserId, input.clerkOrgId);
  if (!membership) {
    if (input.mode === "fallback") return { outcome: "absent" };      // the fallback never removes anyone
    const { data: u } = await db.from("users").select("id").eq("clerk_user_id", input.clerkUserId).maybeSingle();
    if (u) await deleteAccountMembership(db, account.id, u.id);
    return { outcome: "removed" };
  }
  const user = await clerk.getUser(input.clerkUserId);
  if (user && isAgencyMetadata(user.publicMetadata)) return { outcome: "agency_user" };
  if (!user?.email) return { outcome: "no_email" };
  const existing = await readAccountRole(db, account.id, input.clerkUserId);
  if (existing) return { outcome: "exists", role: existing };
  const invitationMeta = await clerk.acceptedInvitationMeta(input.clerkOrgId, user.email);
  const role = roleFromClerk({ clerkRole: membership.role, membershipMeta: membership.publicMetadata, invitationMeta });
  const userId = await upsertUserFromClerk(db, { clerkUserId: input.clerkUserId, email: user.email, name: user.name,
    language: languageFromClerk(membership.publicMetadata, invitationMeta) });
  const r = await addAccountMember(db, { accountId: account.id, userId, role });
  return r === "created" ? { outcome: "created", role } : { outcome: "exists", role: (await readAccountRole(db, account.id, input.clerkUserId)) ?? role };
}
```

ASSUMPTION: an organisation invitation's `public_metadata` is copied to the membership on acceptance. Verify it against Clerk's docs, or have the orchestrator make a dev-instance call, before relying on it. `acceptedInvitationMeta` is the second source in case it is not copied, and both are always consulted. Whichever way it goes, record the answer in the report.

- [ ] **Step 4: Add the exports to `packages/db/src/index.ts`** (additive, one block, your own symbols only).
- [ ] **Step 5: Run green** with the same command. Paste the summary line.
- [ ] **Step 6: Mutation probes:** the ones named in the test titles. Paste each failing name, then revert.
- [ ] **Step 7: Commit.** `feat(db): team data layer, Clerk role rule and reconcile (staff and roles)`.

---

## Task 3: Auth: role on `requireAccountAccess`, per-request fallback, `requireAccountOwner`, Clerk adapter

**Owner:** bis-platform. **Parallel with Tasks 4 and 5**, after Task 2.

**Files**
- Modify: `apps/web/src/lib/auth.ts`
- Create: `apps/web/src/lib/team/clerk-team.ts` (the `ClerkTeamPort` adapter plus the Team's Clerk calls), `apps/web/src/lib/team/ensure-role.ts`, `apps/web/src/lib/team/ensure-role.test.ts`, `apps/web/src/lib/auth.test.ts`

**Interfaces**
- Consumes: `reconcileMembership`, `readAccountRole`, `ClerkTeamPort`, `AccountRole` (Task 2), `loggableError` (`@/lib/loggable-error`).
- Produces:

```ts
// lib/auth.ts — additive fields; every existing destructuring caller keeps working
export async function requireAccountAccess(accountId: string):
  Promise<{ userId: string; isAgency: boolean; role: AccountRole | null; canManage: boolean }>;
export async function requireAccountOwner(accountId: string): Promise<{ userId: string; isAgency: boolean }>;
// lib/team/ensure-role.ts — React cache()d per request, keyed on (accountId, clerkOrgId, clerkUserId)
export const ensureAccountRole: (accountId: string, clerkOrgId: string, clerkUserId: string) => Promise<AccountRole | null>;
export async function ensureAccountRoleWith(db: SupabaseClient, port: ClerkTeamPort,
  accountId: string, clerkOrgId: string, clerkUserId: string): Promise<AccountRole | null>; // the testable core
// lib/team/clerk-team.ts
export function liveClerkTeamPort(): ClerkTeamPort;
```

- [ ] **Step 1: Failing tests** `apps/web/src/lib/team/ensure-role.test.ts`, written against a fake port and a mocked `@bis/db`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const readRole = vi.fn(); const reconcile = vi.fn();
vi.mock("@bis/db", () => ({ readAccountRole: (...a: unknown[]) => readRole(...a), reconcileMembership: (...a: unknown[]) => reconcile(...a) }));
import { ensureAccountRoleWith } from "./ensure-role";
const db = {} as never; const port = {} as never;
beforeEach(() => { readRole.mockReset(); reconcile.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("the per-request fallback (spec §6, §9)", () => {
  it("returns the stored role without calling Clerk (mutation: always reconcile -> FAILS)", async () => {
    readRole.mockResolvedValue("staff");
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBe("staff");
    expect(reconcile).not.toHaveBeenCalled();
  });
  it.each([["owner"], ["staff"]] as const)("creates the missing row and returns its role (%s)", async (role) => {
    readRole.mockResolvedValue(null); reconcile.mockResolvedValue({ outcome: "created", role });
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBe(role);
    expect(reconcile).toHaveBeenCalledWith(db, port, { clerkUserId: "u", clerkOrgId: "org", mode: "fallback" });
  });
  it("Clerk down: no role, no throw, logged without the error's raw text (mutation: rethrow -> FAILS; return 'owner' -> FAILS)", async () => {
    readRole.mockResolvedValue(null); reconcile.mockRejectedValue(new Error("clerk 503 for pat@example.com"));
    expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBeNull();
    expect(String(vi.mocked(console.error).mock.calls[0])).not.toContain("pat@example.com");
  });
  it("agency_user / absent / no_email yield no role", async () => {
    readRole.mockResolvedValue(null);
    for (const outcome of ["agency_user", "absent", "no_email"]) {
      reconcile.mockResolvedValueOnce({ outcome });
      expect(await ensureAccountRoleWith(db, port, "a", "org", "u")).toBeNull();
    }
  });
});
```

`apps/web/src/lib/auth.test.ts` mocks `@clerk/nextjs/server` (`auth`), `next/navigation` (`redirect` throws `new Error("REDIRECT:" + url)`), `@bis/db` (`getAccountByOrgId`, `serviceDb`) and `./team/ensure-role`. Cases:
- agency: `{ isAgency: true, role: null, canManage: true }`.
- client Owner: `canManage: true`.
- client Staff: `canManage: false`.
- `requireAccountOwner` for Staff rejects with `REDIRECT:/dashboard/accounts/<id>/dashboard`. Mutation: return instead of redirect, and the test fails.
- `requireAccountOwner` for a client whose role is null (Clerk was down) redirects the same way. Mutation: `role !== "staff"` instead of `role === "owner"`, and the test fails.
- A client asking for another account is still redirected to their own, before any role read (`ensureAccountRole` not called).

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/team/ensure-role.test.ts src/lib/auth.test.ts`. Expected: `Failed to resolve import "./ensure-role"`.

- [ ] **Step 3: Implement.**

```ts
// lib/team/ensure-role.ts
import { cache } from "react";
import { readAccountRole, reconcileMembership, serviceDb, type AccountRole, type ClerkTeamPort, type SupabaseClient } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";
import { liveClerkTeamPort } from "./clerk-team";

/** serviceDb, deliberately: this runs inside requireAccountAccess, BEFORE the caller's role is known (auth.ts's own rule). */
export async function ensureAccountRoleWith(db: SupabaseClient, port: ClerkTeamPort,
  accountId: string, clerkOrgId: string, clerkUserId: string): Promise<AccountRole | null> {
  const stored = await readAccountRole(db, accountId, clerkUserId);
  if (stored) return stored;
  try {
    const r = await reconcileMembership(db, port, { clerkUserId, clerkOrgId, mode: "fallback" });
    return r.outcome === "created" || r.outcome === "exists" ? r.role : null;
  } catch (e) {
    // Fail closed (spec §9): no membership, no role; owner-only actions and policies refuse until a later request succeeds.
    console.error(`ensureAccountRole: could not settle the role for account ${accountId}: ${loggableError(e)}`);
    return null;
  }
}
export const ensureAccountRole = cache((accountId: string, clerkOrgId: string, clerkUserId: string) =>
  ensureAccountRoleWith(serviceDb(), liveClerkTeamPort(), accountId, clerkOrgId, clerkUserId));
```

```ts
// lib/auth.ts — the client branch of requireAccountAccess, after the existing redirect to the caller's own account
  const role = await ensureAccountRole(account.id, claims.org_id, userId);
  return { userId, isAgency: false, role, canManage: role === "owner" };
// agency branch: return { userId, isAgency: true, role: null, canManage: true };

/**
 * Owner-only surfaces inside an account: Billing, calendar settings, contact export and delete, Team.
 * Admits the agency and a client Owner. Staff (and a client whose role could not be settled) are sent
 * to their own dashboard, never 403'd, for requireAccountAccess's reason. The database refuses the same
 * writes on its own (NNNN_staff_and_roles.sql); this is the app's half.
 */
export async function requireAccountOwner(accountId: string): Promise<{ userId: string; isAgency: boolean }> {
  const { userId, isAgency, canManage } = await requireAccountAccess(accountId);
  if (!canManage) redirect(`/dashboard/accounts/${accountId}/dashboard`);
  return { userId, isAgency };
}
```

`lib/team/clerk-team.ts` builds the port on `clerkClient()`. Before writing each call, verify its method name, parameters and response field names against Clerk's docs for the installed `@clerk/nextjs` 7.x (or have the orchestrator make a dev-instance call) before relying on it. Implementers make no Clerk calls themselves (rule 7). The calls:
- `getUser`: `users.getUser`. Map `primaryEmailAddress?.emailAddress`, `fullName` and `publicMetadata`. A 404 returns null.
- `getMembership`: `users.getOrganizationMembershipList({ userId })`, find the entry whose `organization.id === orgId`, return `{ role, publicMetadata }` or null.
- `acceptedInvitationMeta`: `organizations.getOrganizationInvitationList({ organizationId, status: ["accepted"] })`, match `emailAddress` case-insensitively, return `publicMetadata` or null.

The same file also exports the Team's calls, all with `loggableError` logging only: `listPendingInvitations(orgId)`, `teamCapacity(orgId)`, `createTeamInvitation(...)`, `revokeTeamInvitation(...)`, `removeFromOrganization(orgId, clerkUserId)` and `restoreToOrganization(orgId, clerkUserId)` (`createOrganizationMembership` with `role: "org:member"`). Task 9 consumes them.

- [ ] **Step 4: Run green** with the same command. Paste the summary.
- [ ] **Step 5: Mutation probes** as named. Then grep the account subtree for any other caller of `apiAccountAccess` that deletes contacts, exports, or touches billing or calendar settings (`grep -rn apiAccountAccess apps/web/src/app`). List each one in the report: none is expected, and any found gets the owner check in the task that owns its surface.
- [ ] **Step 6: Commit.** `feat(auth): roles on requireAccountAccess, per-request membership fallback, requireAccountOwner`.

---

## Task 4: Clerk webhook `POST /api/webhooks/clerk`

**Owner:** bis-platform. **Parallel with Tasks 3 and 5.**

**Files**
- Create: `apps/web/src/app/api/webhooks/clerk/route.ts`, `apps/web/src/app/api/webhooks/clerk/route.test.ts`
- Modify: `.env.example` (add `CLERK_WEBHOOK_SIGNING_SECRET=` under the Clerk block, with the comment `# Svix signing secret of the production Clerk instance's webhook endpoint. Production only: Preview, CI and local runs leave it unset (the route answers 503 and the per-request fallback keeps memberships in step). Sensitive.`)
- Ruling (coordinator, 2026-10-10): there is NO webhook endpoint for Preview. CI and e2e must never need this secret.

**Interfaces**
- Consumes: `reconcileMembership`, `upsertUserFromClerk`, `isAgencyMetadata`, `serviceDb` (Task 2), `liveClerkTeamPort` (Task 3; if Task 3 has not landed, Task 4 creates `clerk-team.ts`'s port and Task 3 extends it. The two tasks agree on that file's port signature from Task 2).
- Produces: `POST(request: Request): Promise<Response>`.
  - Bad or missing signature: 400, nothing read or written.
  - Secret unset: 503 `not configured`. This is the normal state on Preview, CI and local runs, so it is not an outage.
  - Unknown type: 200 `ignored`.
  - Unknown org: 200 (reconcile returns `no_account`).
  - Any database or Clerk failure: 500, so Svix retries.

- [ ] **Step 1: Failing test.** Sign with REAL svix (no `vi.mock("svix")`; that mock is why the resend test cannot catch a wrong header name):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Webhook } from "svix";
const reconcile = vi.fn(); const upsertUser = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  reconcileMembership: (...a: unknown[]) => reconcile(...a),
  upsertUserFromClerk: (...a: unknown[]) => upsertUser(...a),
  isAgencyMetadata: (m: { app_role?: string }) => m?.app_role === "agency_admin",
}));
vi.mock("@/lib/team/clerk-team", () => ({ liveClerkTeamPort: () => ({}) }));
import { POST } from "./route";

const SECRET = "whsec_" + Buffer.from("staff-and-roles-test-secret-32b!").toString("base64");
function signed(body: unknown, secret = SECRET) {
  const payload = JSON.stringify(body); const id = "msg_1"; const ts = new Date();
  const sig = new Webhook(secret).sign(id, ts, payload);
  return new Request("http://localhost/api/webhooks/clerk", { method: "POST", body: payload,
    headers: { "svix-id": id, "svix-timestamp": String(Math.floor(ts.getTime() / 1000)), "svix-signature": sig } });
}
const membership = (type: string) => ({ type, data: { organization: { id: "org_1" }, public_user_data: { user_id: "user_1" } } });
beforeEach(() => { reconcile.mockReset().mockResolvedValue({ outcome: "created", role: "staff" }); upsertUser.mockReset(); process.env.CLERK_WEBHOOK_SIGNING_SECRET = SECRET; });

describe("clerk webhook", () => {
  it("a bad signature is 400 and nothing is written (mutation: skip verify -> FAILS)", async () => {
    const res = await POST(signed(membership("organizationMembership.created"), "whsec_" + Buffer.from("another-secret-of-32-bytes-long!").toString("base64")));
    expect(res.status).toBe(400); expect(reconcile).not.toHaveBeenCalled();
  });
  it.each(["organizationMembership.created", "organizationMembership.deleted"])("%s reconciles (user, org) in webhook mode", async (t) => {
    expect((await POST(signed(membership(t)))).status).toBe(200);
    expect(reconcile).toHaveBeenCalledWith({}, {}, { clerkUserId: "user_1", clerkOrgId: "org_1", mode: "webhook" });
  });
  it("a replay of the same event is accepted and reconciled again (idempotence lives in reconcile)", async () => {
    await POST(signed(membership("organizationMembership.created"))); await POST(signed(membership("organizationMembership.created")));
    expect(reconcile).toHaveBeenCalledTimes(2);
  });
  it("user.updated upserts email and name; an agency user is skipped (mutation: drop the agency skip -> FAILS)", async () => {
    const user = (meta: object) => ({ type: "user.updated", data: { id: "user_1", first_name: "Pat", last_name: "Lee",
      primary_email_address_id: "e1", email_addresses: [{ id: "e1", email_address: "pat@example.com" }], public_metadata: meta } });
    await POST(signed(user({})));
    expect(upsertUser).toHaveBeenCalledWith({}, { clerkUserId: "user_1", email: "pat@example.com", name: "Pat Lee" });
    upsertUser.mockReset(); await POST(signed(user({ app_role: "agency_admin" })));
    expect(upsertUser).not.toHaveBeenCalled();
  });
  it("an unknown event type is 200 and ignored", async () => {
    expect((await POST(signed({ type: "session.created", data: {} }))).status).toBe(200); expect(reconcile).not.toHaveBeenCalled();
  });
  it("a database failure is 500 so Svix retries (mutation: catch and 200 -> FAILS)", async () => {
    reconcile.mockRejectedValue(new Error("db down"));
    expect((await POST(signed(membership("organizationMembership.created")))).status).toBe(500);
  });
  it("an unset secret is 503 'not configured', writes nothing and is not a silent accept (mutation: 200 or 500 -> FAILS)", async () => {
    delete process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    const res = await POST(signed(membership("organizationMembership.created")));
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("not configured");
    expect(reconcile).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/app/api/webhooks/clerk/route.test.ts`. Expected: `Failed to resolve import "./route"`.

- [ ] **Step 3: Implement** on the resend route's shape:

```ts
import { Webhook } from "svix";
import { serviceDb, reconcileMembership, upsertUserFromClerk, isAgencyMetadata } from "@bis/db";
import { liveClerkTeamPort } from "@/lib/team/clerk-team";
import { loggableError } from "@/lib/loggable-error";

type ClerkEvent = { type?: string; data?: {
  id?: string; first_name?: string | null; last_name?: string | null; primary_email_address_id?: string | null;
  email_addresses?: { id: string; email_address: string }[]; public_metadata?: unknown;
  organization?: { id?: string }; public_user_data?: { user_id?: string } } };

/** Public route: authenticated by its Svix signature, never by Clerk's session (proxy.ts protects /dashboard only). */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
  // Unset everywhere but Production (no Preview endpoint, by ruling): 503, quietly. The request fallback covers those environments.
  if (!secret) return new Response("not configured", { status: 503 });
  const payload = await request.text();
  let event: ClerkEvent;
  try {
    event = new Webhook(secret).verify(payload, {
      "svix-id": request.headers.get("svix-id") ?? "", "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
      "svix-signature": request.headers.get("svix-signature") ?? "" }) as ClerkEvent;
  } catch { return new Response("invalid signature", { status: 400 }); }   // never read an unverified payload
  const d = event.data ?? {};
  try {
    switch (event.type) {
      case "organizationMembership.created":
      case "organizationMembership.deleted": {
        const clerkUserId = d.public_user_data?.user_id; const clerkOrgId = d.organization?.id;
        if (!clerkUserId || !clerkOrgId) return new Response("ignored", { status: 200 });
        await reconcileMembership(serviceDb(), liveClerkTeamPort(), { clerkUserId, clerkOrgId, mode: "webhook" });
        return new Response("ok", { status: 200 });
      }
      case "user.created":
      case "user.updated": {
        if (!d.id || isAgencyMetadata(d.public_metadata)) return new Response("ignored", { status: 200 });
        const email = d.email_addresses?.find((e) => e.id === d.primary_email_address_id)?.email_address;
        if (!email) return new Response("ignored", { status: 200 });
        const name = [d.first_name, d.last_name].filter(Boolean).join(" ") || null;
        await upsertUserFromClerk(serviceDb(), { clerkUserId: d.id, email, name });
        return new Response("ok", { status: 200 });
      }
      default: return new Response("ignored", { status: 200 });
    }
  } catch (e) {
    console.error(`clerk webhook: ${event.type} failed: ${loggableError(e)}`);
    return new Response("retry", { status: 500 });
  }
}
```

Note: `user.created` writes a `users` row for a person who has no membership yet. That is harmless (RLS shows a client only users who share their company) and it gives the Team list a name early.

- [ ] **Step 4: Run green.** Paste the summary.
- [ ] **Step 5: Mutation probes** as named. Then commit: `feat(auth): Clerk webhook keeps users and memberships in step (staff and roles)`.

---

## Task 5: Backfill planner and SQL emitter

**Owner:** bis-db-schema. **Parallel with Tasks 3 and 4.**

**Files**
- Create: `packages/db/src/backfill/members.ts`, `packages/db/src/backfill/members.test.ts`, `packages/db/src/backfill/members-run.ts`
- Modify: `packages/db/package.json` (script `"backfill:members": "tsx src/backfill/members-run.ts"`)

**Interfaces (Produces)**

```ts
export type BackfillAccount = { id: string; clerk_org_id: string };          // the JSON execute_sql returns for: select id, clerk_org_id from accounts
export type ClerkOrgMember = { clerkUserId: string; email: string | null; name: string | null; clerkRole: string;
  membershipMeta: unknown; userMeta: unknown };
export type BackfillRow = { accountId: string; clerkUserId: string; email: string; name: string | null; role: AccountRole; language: PersonLanguage | null };
export function planMemberBackfill(accounts: BackfillAccount[], membersByOrg: Record<string, ClerkOrgMember[]>):
  { rows: BackfillRow[]; skippedAgency: number; skippedNoEmail: number };
export function memberBackfillSql(rows: BackfillRow[]): string;   // idempotent; inserts only, never changes an existing role
```

- [ ] **Step 1: Failing tests** `members.test.ts`:
  - `org:admin` with no metadata maps to owner, `org:member` maps to staff, and `bis_role` on the membership wins (all via `roleFromClerk`). Mutation: default to owner, and the staff case fails.
  - An agency user (`userMeta.app_role === "agency_admin"`) is skipped and counted. Mutation: drop the skip, and the test fails.
  - A member with no email is skipped and counted.
  - The SQL quotes `O'Brien` safely: the emitted text contains `'O''Brien'`. Mutation: drop the quote doubling, and the test fails.
  - The SQL is idempotent: it contains `on conflict (clerk_user_id) do update set email = excluded.email` for users (language never touched), and `on conflict (account_id, user_id) do nothing` for memberships. Run the emitted SQL TWICE inside `withRollback` against the local database, assert one membership row with role owner, then set it to staff in SQL and run the SQL again: still staff. Mutation: `do update set role` in place of `do nothing`, and the test fails.
- [ ] **Step 2: Run red.** `pnpm --filter @bis/db exec vitest run src/backfill/members.test.ts`. Expected: import failure.
- [ ] **Step 3: Implement.** `memberBackfillSql` emits one statement per row:

```sql
with u as (
  insert into public.users (clerk_user_id, email, name, language) values ('<sub>', '<email>', <name|null>, <lang|null>)
  on conflict (clerk_user_id) do update set email = excluded.email
  returning id)
insert into public.memberships (user_id, scope, account_id, role)
select id, 'account', '<account uuid>'::uuid, '<role>' from u
on conflict (account_id, user_id) do nothing;
```

Every literal goes through one `sqlString()` helper that doubles `'` and refuses any value containing a NUL. The UUID is validated against the UUID regex before emission.

`members-run.ts`, following `telnyx-optouts-run.ts`:
- Usage: `backfill:members <accounts.json> --emit-sql <out.sql>`.
- Reads `process.env.CLERK_SECRET_KEY` for presence only (`if (!process.env.CLERK_SECRET_KEY) throw new Error("CLERK_SECRET_KEY is not set")`). It never prints the key and never parses an env file.
- Fetches `GET https://api.clerk.com/v1/organizations/{org}/memberships?limit=100&offset=N`. Each membership's `public_user_data.user_id` gives the user; then fetches `GET /v1/users?user_id=...` in batches of 100 for email, name and `public_metadata`.
- Prints counts only: accounts, rows per role, skipped agency, skipped no-email.
- Catches every error and prints only its message (the I1 precedent).
- Connects to no database.
- [ ] **Step 4: Run green, run the mutation probes, then commit.** `feat(db): member backfill emits idempotent SQL from Clerk memberships (staff and roles)`. The implementer does NOT run `members-run.ts` (rule 7: no real provider calls). The orchestrator runs it in Task 12.

---

## Task 6: Contacts: delete and export are Owner-only

**Owner:** bis-crm. **Parallel with Tasks 7, 8 and 9**, after Task 3.

**Files**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts` (`bulkDeleteContactsAction`), `.../contacts/export/route.ts` (`GET`), `.../contacts/page.tsx` (Export link), `.../contacts/bulk-action-bar.tsx` and `contacts-table.tsx` (the Delete control, through a `canDelete: boolean` prop threaded from the page)
- Tests: `.../contacts/actions.test.ts`, `.../contacts/export/route.get.test.ts`, `.../contacts/bulk-action-bar.test.ts`, `.../contacts/page.test.ts`

**Interfaces**
- Consumes: `requireAccountOwner(accountId)` and `requireAccountAccess(accountId)` returning `canManage` (Task 3).
- Produces: `BulkActionBar` prop `canDelete: boolean`. `ContactsTable` passes it through. `ContactsPage` renders the Export link only when `canManage`.

- [ ] **Step 1: Failing tests.**
  - `actions.test.ts`: with `@/lib/auth` mocked so `requireAccountOwner` throws `REDIRECT:…`, `bulkDeleteContactsAction` rejects with that redirect, and `deleteContacts` is never called. Mutation: keep `requireAccountAccess` there, and the test fails.
  - `route.get.test.ts`: a Staff caller (owner guard throws a redirect) never reaches `listContacts`.
  - `bulk-action-bar.test.ts`: with `canDelete={false}` no Delete button is rendered, and Tag and Untag still render. Mutation: ignore the prop, and the test fails.
  - `page.test.ts`: with `canManage: false` the Export link is absent.
- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/route.get.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/bulk-action-bar.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.test.ts"`
- [ ] **Step 3: Implement.**
  - `bulkDeleteContactsAction`: first line becomes `await requireAccountOwner(accountId);`.
  - Export `GET`: `await requireAccountOwner(accountId);` replaces `requireAccountAccess` (keep its comment, adding that Staff are redirected).
  - Page: `const { canManage } = await requireAccountAccess(accountId);`, render the Export `<Link>` only when `canManage`, and pass `canDelete={canManage}` to the table.
  - The Staff bulk bar keeps tag actions, so rule 4 (no checkboxes without bulk actions) still holds.
- [ ] **Step 4: Run green, run the mutation probes, then commit.** `feat(contacts): delete and export are Owner-only (staff and roles)`.

---

## Task 7: Calendar settings are Owner-only

**Owner:** bis-booking. **Parallel with Tasks 6, 8 and 9.**

**Files**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.ts` (`updateCalendarSettingsAction` only; the booking actions stay on `requireAccountAccess`), `.../calendar/page.tsx` (render `<CalendarSettings>` only when `canManage`)
- Tests: `.../calendar/actions.test.ts`; a page-level test if `calendar/` has one, otherwise a new `calendar/page.test.ts` following `contacts/page.test.ts`'s mocking shape

**Interfaces:** consumes `requireAccountOwner` and `canManage` (Task 3).

- [ ] **Step 1: Failing tests.**
  - Staff calling `updateCalendarSettingsAction` is redirected and `updateCalendarSettings` is never called. Mutation: keep `requireAccountAccess`, and the test fails.
  - `setBookingStatusAction` and `cancelBookingAction` still admit Staff (a positive control; mutation: switch them to the owner guard, and the test fails).
  - The page with `canManage: false` renders the bookings list and no settings form.
- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/page.test.ts"`
- [ ] **Step 3: Implement.** `updateCalendarSettingsAction`: `const { userId } = await requireAccountOwner(accountId);`. Page: `const { userId, isAgency, canManage } = await requireAccountAccess(accountId);` and `{canManage ? <CalendarSettings … /> : null}`. `EmbedSnippet` stays visible to everyone: it is the public link, not a setting.
- [ ] **Step 4: Run green, run the mutation probes, then commit.** `feat(booking): calendar settings are Owner-only (staff and roles)`.

---

## Task 8: Billing guard, nav, palette, topbar pin

**Owner:** bis-platform. **Parallel with Tasks 6, 7 and 9.**

**Files**
- Modify:
  - `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/billing/page.tsx` and `billing/actions.ts` (`openBillingPortalAction`)
  - `apps/web/src/lib/nav-groups.ts`
  - `apps/web/src/components/app-sidebar.tsx`
  - `apps/web/src/app/(dashboard)/dashboard/layout.tsx` (computes the client's role and passes `isOwner`)
  - `apps/web/src/lib/palette/registry.ts` and the `CommandPalette` component that calls `buildPaletteEntries` (pass `isOwner`)
  - `apps/web/src/lib/messages.ts` (additive: `nav.team`, `nav.team.es`, `palette.settings.team`, `palette.settings.team.es`)
- Tests: `apps/web/src/lib/nav-groups.test.ts`, `apps/web/src/lib/palette/registry.test.ts`, `apps/web/src/components/app-sidebar.test.ts`, `apps/web/src/components/topbar.test.ts`, the billing page and actions tests, and `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.test.ts` (the Staff banner case, step 3)

**Interfaces**
- `buildNavGroups(base: string | null, isAgency: boolean, isOwner: boolean): NavGroupSpec[]`. The third parameter is REQUIRED, so the compiler finds every caller. Billing is shown to a client only when `isOwner`.
- `buildPaletteEntries(base: string | null, isAgency: boolean, isOwner: boolean): PaletteEntry[]`. It emits `nav:team` (href `${base}/team`, keywords `["team", "staff", "people", "invite", "users", "logins", "employees"]`) for a client Owner in an account, and the settings section `{ anchor: "team", label: m["palette.settings.team"], keywords: ["team", "staff", "invite", "logins", "people"] }` for the agency.
- `AppSidebar` prop `isOwner: boolean`. Footer: the agency in an account gets Settings (unchanged); a client Owner in an account gets `{ href: `${base}/team`, label: m["nav.team"], icon: Users }`; Staff get none.
- Layout: for a client in `status: "ok"`, `isOwner = (await ensureAccountRole(clientState.id, orgId, userId)) === "owner"` (the same cached call `requireAccountAccess` makes later in the request).

- [ ] **Step 1: Failing tests.**
  - `nav-groups.test.ts`: a client Staff (`false, false`) has no `/billing`; a client Owner (`false, true`) has it; the agency has neither Billing nor Team in the groups. Mutation: ignore `isOwner`, and the Staff case fails.
  - `registry.test.ts`: a client Owner gets `nav:team`; Staff do not; the agency gets `settings:team`; the existing nav/palette parity assertion runs in all three roles.
  - `app-sidebar.test.ts`: the Owner footer is Team, the Staff footer is absent, and the agency footer is Settings.
  - `topbar.test.ts`: `Topbar({ isAgency: false })` renders no `OrganizationSwitcher` (spec §6 pin; mutation: render it unconditionally, and the test fails).
  - Billing page and portal action: Staff are redirected via `requireAccountOwner` (mutation: keep `requireAccountAccess`, and the test fails).
- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/nav-groups.test.ts src/lib/palette/registry.test.ts src/components/app-sidebar.test.ts src/components/topbar.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/billing" "src/app/(dashboard)/dashboard/accounts/[accountId]/layout.test.ts"`. The layout Staff case may already pass, because the code is already correct. If it does, run its two mutations to prove it can fail, and say so in the report.
- [ ] **Step 3: Implement.**
  - In `nav-groups.ts`, the Billing spread becomes `...(isAgency || !isOwner ? [] : [billing])`, with a comment that Staff do not see Billing (spec §4) and that hiding is convenience, the guard and policy being the boundary.
  - Billing page and action: `await requireAccountOwner(accountId)`.
  - **The payment-failed banner (`[accountId]/layout.tsx:44`).** The layout reads `account_billing` through the user token on every page. Under `account_billing_owner_read` a Staff session reads NO row, and RLS filtering is not an error. From the source: `getAccountBilling` uses `.maybeSingle()`, so no row returns `null` and nothing is thrown; `showsPaymentFailedBanner(null)` returns `false` (`billing !== null && …`). So for Staff there is no banner, no throw, and the layout's `catch` with its `console.error` never runs. Confirm that by test rather than by reading. In `[accountId]/layout.test.ts`, the Staff case mocks `requireAccountAccess` as a client Staff session and `getAccountBilling` resolving `null` (what the policy produces). Assert three things: no `BillingBanner` is rendered, `console.error` is never called, and children still render. Mutations: make `getAccountBilling` throw on no row (`.single()`), and the console assertion fails; make `showsPaymentFailedBanner` return `true` for null, and the banner assertion fails. Add a sentence to the layout comment saying Staff never see this banner.
- [ ] **Step 4: Run green, run the mutation probes, then commit.** `feat(auth): Staff see no Billing; Team link and palette entries for Owners (staff and roles)`.

---

## Task 9: Team server actions and the pure team view

**Owner:** bis-platform. **Parallel with Tasks 6, 7 and 8.**

**Files**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/team/actions.ts`, `.../team/actions.test.ts`, `apps/web/src/lib/team/team-view.ts`, `apps/web/src/lib/team/team-view.test.ts`
- Modify: `apps/web/src/lib/team/clerk-team.ts` (Task 3's file; add the Team calls if Task 3 left them as signatures only)

**Interfaces (Produces)**

```ts
// team/actions.ts — every action: first statement `await requireAccountOwner(accountId)`; accountId bound server-side, never a form field
export type TeamResult = { ok: true } | { ok: false; error: string };
export async function inviteTeamMemberAction(accountId: string, formData: FormData): Promise<TeamResult>;   // email, role (default staff), language
export async function setTeamRoleAction(accountId: string, userId: string, role: AccountRole): Promise<TeamResult & { previous?: AccountRole }>;
export async function setTeamLanguageAction(accountId: string, userId: string, language: PersonLanguage | null): Promise<TeamResult & { previous?: PersonLanguage | null }>;
export async function removeTeamMemberAction(accountId: string, userId: string): Promise<TeamResult & { undo?: { clerkUserId: string; role: AccountRole } }>;
export async function undoRemoveTeamMemberAction(accountId: string, clerkUserId: string, role: AccountRole): Promise<TeamResult>;
export async function revokeTeamInvitationAction(accountId: string, invitationId: string): Promise<TeamResult & { undo?: { email: string; role: AccountRole; language: PersonLanguage } }>;
export async function undoRevokeTeamInvitationAction(accountId: string, email: string, role: AccountRole, language: PersonLanguage): Promise<TeamResult>;

// lib/team/team-view.ts — pure
export type PendingInvite = { id: string; email: string; role: AccountRole; language: PersonLanguage };
export function roomLeft(cap: { maxAllowed: number | null; members: number; pending: number }): number | null; // null = no cap known
export function inviteDefaultLanguage(accountLanguage: unknown): PersonLanguage;   // "es" only when the account says es; else "en"
export function clerkInviteError(code: string | undefined): "already_invited" | "already_member" | "full" | "failed";
export function ownerCount(team: readonly { role: AccountRole }[]): number;
```

Behaviour:
- **Invite.** Account must have `client_access_enabled` (read on `serviceDb()`, as today). A known `roomLeft === 0` refuses with `team.full` before calling Clerk. Clerk invitation `role: "org:member"`, `public_metadata: { bis_role, bis_language }`, `inviter_user_id: userId`. Expected Clerk failures map through `clerkInviteError` to `team.invite.alreadyInvited`, `team.invite.alreadyMember`, `team.full` or `team.invite.failed`. The dialog keeps them and stays open.
  - ASSUMPTION: the error codes are `duplicate_record`, `already_a_member_in_organization` and `organization_membership_quota_exceeded`. Verify them against Clerk's docs or a dev-instance call before relying on them. Unknown codes map to `failed`.
  - ASSUMPTION: `teamCapacity` reads the organisation's `maxAllowedMemberships`, the member count and the pending-invitation count from `organizations.getOrganization`. Verify the field names against Clerk's docs or a dev-instance call before relying on them. If the counts are not returned there, count the membership list and the pending-invitation list instead.
- **Role change.** `setAccountMemberRole` on `serviceDb()`. `last_owner` gives `team.lastOwner`; `not_found` gives `team.changed`. Returns `previous` for the undo toast. Undo calls the same action with `previous`.
- **Language.** `setMemberLanguage`, with the same shape.
- **Remove.** `removeAccountMember` first (the guard), then `removeFromOrganization(orgId, clerkUserId)`. If Clerk fails, re-add the BIS row with `addAccountMember` at the same role and return `team.remove.failed`.
- **Undo remove.** `restoreToOrganization` (Clerk, `org:member`), then `addAccountMember` with the same role. The person's `users.language` was never deleted, so language is the same.
- **Revoke and undo revoke.** Revoke returns the invitation's email, role and language; undo re-invites with them. The new invitation sends a fresh email, so say so in the toast copy (Task 10).
- **Everything.** `revalidatePath` of `/dashboard/accounts/${accountId}/team` and `/settings`.

- [ ] **Step 1: Failing tests.**
  - `team-view.test.ts`: `roomLeft({ maxAllowed: 5, members: 3, pending: 1 }) === 1`; it never goes below 0; `maxAllowed: null` gives null. Mutation: forget `pending`, and the test fails. `inviteDefaultLanguage("es") === "es"`, and `undefined` or `"fr"` give `"en"`. `clerkInviteError` covers each code.
  - `actions.test.ts`, mocking `@/lib/auth`, `@bis/db` and `@/lib/team/clerk-team`:
    - **Staff calling an Owner action is redirected.** For each of the seven actions, `requireAccountOwner` throwing a redirect means no `@bis/db` or Clerk mock is called. Mutation: delete the guard from any one action, and that action's case fails by name.
    - **Last Owner.** `setAccountMemberRole` resolving `"last_owner"` returns `{ ok: false, error: m["team.lastOwner"] }`, and Clerk is never touched. For remove, `last_owner` means `removeFromOrganization` is not called. Mutation: call Clerk first, and the test fails. The concurrency half of the guard is proven in the database (Task 1, step 5).
    - **Cap reached.** `teamCapacity` returning `{ maxAllowed: 2, members: 2, pending: 0 }` gives `team.full`, and `createTeamInvitation` is not called. Clerk's quota error also maps to `team.full`.
    - **Remove rollback.** Clerk failing after the database delete calls `addAccountMember` with the original role.
    - **Invite payload.** The invite sends `role: "org:member"` and `public_metadata: { bis_role: "staff", bis_language: "en" }` by default. Mutation: `org:admin`, and the test fails.
- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/team/team-view.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/team/actions.test.ts"`
- [ ] **Step 3: Implement** the actions as specified. Keep each action's first statement `await requireAccountOwner(accountId)`, and validate `userId` and `invitationId` shapes before use (UUID for `userId`; `/^orginv_[A-Za-z0-9]+$/` for `invitationId`). The `orginv_` prefix is an ASSUMPTION: verify it against Clerk's docs or a dev-instance call before relying on it, and pin it in a test.
- [ ] **Step 4: Run green, run the mutation probes, then commit.** `feat(auth): Team actions with the last-Owner guard, cap and undo (staff and roles)`.

---

## Task 10: Team card UI, Team page, Settings card swap, copy

**Owner:** bis-frontend. **Sequential:** after Tasks 8 and 9.

**Files**
- Create:
  - `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/team/page.tsx`
  - `.../team/loading.tsx`
  - `apps/web/src/components/team/team-section.tsx` (server: loads data)
  - `apps/web/src/components/team/team-card.tsx` (client)
  - `apps/web/src/components/team/team-card.test.ts`
  - `apps/web/src/components/team/team-section.test.ts`
- Modify:
  - `.../settings/client-access-section.tsx`: keeps `ClientAccessSwitch`, renders `<TeamSection>` under it, and drops the live Clerk member list
  - `.../settings/client-access-panel.tsx`: the invite form leaves, the switch stays
  - `.../settings/actions.ts`: delete `inviteClientAdminAction`, which `inviteTeamMemberAction` replaces
  - `.../settings/page.tsx`: card `id="team"` beside `id="client-access"`
  - their tests (`client-access-panel.test.ts`, `sections.test.ts`)
  - `apps/web/src/lib/messages.ts`: additive `team.*` keys, each with a `.es` twin

**Interfaces**
- Consumes: Task 9's actions, `listAccountTeam` (Task 2) on `dbForRequest()` (the RLS read path), `listPendingInvitations` and `teamCapacity` (Task 3/9 adapter), and `requireAccountOwner` (Task 3).
- Produces:
  - `TeamSection({ accountId, clerkOrgId }: { accountId: string; clerkOrgId: string | null })`
  - `TeamCard(props: { members: TeamMember[]; pending: PendingInvite[]; room: number | null; clerkUnavailable: boolean; defaultLanguage: PersonLanguage; actions: BoundTeamActions })`
  - `TeamSkeleton()`

Content and states (spec §8):
- **Rows:** name (or email), email, role as dot + word (`DotPill`, rule 3), status Invited / Active (dot + word), language word ("English" / "Español").
- **Owner-only help text:** "Staff can see every contact so they can do their work. Exporting and deleting contacts is for Owners only." This is the honest limit from spec §4, in 7 AM words.
- **Invite:** a dialog with email, role (default Staff) and language (default `inviteDefaultLanguage(account.language)`: the account is read with `select("*")` so the column is picked up when the runtime lane has added it, without naming a column that may not exist). One primary button per card (rule 8). Esc closes the dialog.
- **Role and language:** inline `Select`s, saved at once, with an undo toast (rule 6).
- **Remove and revoke:** done at once with an undo toast. No typed confirm.
- **Room:** "Room for {count} more people" / "Room for 1 more person"; at 0, "Your team is full. Ask BIS to make room.", with the invite button disabled.
- **Empty:** "Just you so far. Invite the people who answer your phones and run your jobs."
- **Clerk unreachable:** "We couldn't reach the sign-in service, so invitations aren't shown. Your team list is below." The stored list still renders.
- **Loading:** skeleton rows (rule 7). `loading.tsx` and the Suspense fallback share `TeamSkeleton`.
- **Copy:** every string above goes in `messages.ts` as `team.<key>` plus `team.<key>.es`. Spanish twins are written by the implementer and reviewed in the 7 AM read in both languages.

- [ ] **Step 1: Failing tests.**
  - `team-card.test.ts`: renders role as dot + word (both the `data-status` dot and the word present; mutation: drop the word, and the test fails); exactly one primary button in the card (count elements with the primary variant; mutation: make Remove primary, and the test fails); empty state copy; full state disables invite; `clerkUnavailable` shows the note AND the stored rows.
  - `team-section.test.ts`: Clerk rejecting gives `clerkUnavailable: true` and members still come from `listAccountTeam` (mutation: return early on Clerk error, and the test fails).
  - Settings `sections.test.ts`: the Team card is rendered for the agency, and `inviteClientAdminAction` no longer exists (an import test).
  - Team page: `requireAccountOwner` is its first call.
- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/components/team "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/sections.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/client-access-panel.test.ts"`
- [ ] **Step 3: Implement.** Tokens only. Rows use `--surface-2` and hover `--surface-3`; there are no checkboxes, so there is no bulk bar. Focus ring visible; row nav by Tab through each row's controls.
- [ ] **Step 4: Run green and the mutation probes.** Then the UI definition of done:
  - dark and light (`.dark` toggle)
  - the blur fallback
  - `pnpm --filter web exec vitest run src/lib/branding/theme.test.ts`
  - keyboard
  - the 7 AM read in English and Spanish
  - `/styleguide` untouched unless a new variant appeared (none is planned)
- [ ] **Step 5: Commit.** `feat(design): the Team screen for Owners and the agency (staff and roles)`.

---

## Task 11: e2e: Staff login fixture and role specs

**Owner:** bis-e2e-qa. **Sequential:** last. Playwright is run by the orchestrator, one gate at a time.

**Files**
- Modify:
  - `apps/web/e2e/auth.setup.ts`: a new setup test "authenticate as staff user" AFTER the client one. It reads `client-fixture.json`, creates `e2e-staff-<stamp>@example.com`, calls `clerk_.organizations.createOrganizationMembership({ organizationId: fixture.clerkOrgId, userId, role: "org:member" })`, signs in by ticket, calls `setActiveOrganization`, goes to `/` and waits for the account dashboard URL, saves `e2e/.auth/staff-state.json`, and writes `staffClerkUserId` into `client-fixture.json`.
  - `apps/web/e2e/auth.teardown.ts`: deletes the staff Clerk user.
  - `apps/web/e2e/fixtures/stale.ts`: `FIXTURE_EMAIL_RE` becomes `/^e2e-(?:client|agency|staff)-(\d{13})@example\.com$/`, with a test in `fixtures/stale.test.ts` that matches a staff email (mutation: the old regex, and the test fails).
- Create: `apps/web/e2e/staff-roles.spec.ts`

Specs, all on the per-run `E2E Client Co <stamp>` account (never Test Client One):
1. **The fallback made the existing client an Owner.** After `auth.setup`, read with `serviceDb()`: the client fixture user has a membership with role `owner`, and the staff user has role `staff`. This proves the fallback end to end against the real Clerk development instance, because CI's ephemeral stack has no public URL for the webhook.
2. **Staff sees no Billing, Team, Delete or Export.** With `storageState: "e2e/.auth/staff-state.json"`:
   - the sidebar has no Billing link and no Team link;
   - the contacts page has no Export link;
   - ticking a row shows the bulk bar with no Delete;
   - visiting `/billing`, `/team` and `/contacts/export` directly lands on `/dashboard/accounts/<id>/dashboard`.
3. **A direct delete through Staff's own token is refused.** `mintClientToken(staffClerkUserId)` (`e2e/support.ts`), seed a contact with `serviceDb()`, then `DELETE ${SUPABASE_URL}/rest/v1/contacts?id=eq.<id>` with the anon key and bearer token. Expect 200 with `[]`, and a soft read-back that the row still exists (the `server-only-writes.spec.ts` shape). Clean up in `finally`.
4. **Owner manages the team.** With the client (Owner) state on `/team`:
   - invite `e2e-invite-<stamp>+clerk_test@example.com` as Staff and see it listed as Invited (ASSUMPTION: `+clerk_test` addresses on a development instance send no email. Verify against Clerk's docs or a dev-instance call before relying on it; if it is false, the address stays on reserved `example.com`, which never delivers);
   - change the Staff person's role to Owner, press Undo, and see Staff again; read back with `serviceDb()`: role `staff`;
   - remove the invitation with Undo and see it listed again;
   - remove the Staff person, Undo, and confirm the membership exists again (read back).
   - The org's 5-seat cap: Owner, staff user and one invitation is 3. The agency setup user is NOT a member of the fixture org.
5. **Last Owner.** On `/team` as the client Owner, demoting yourself while you are the only Owner shows `team.lastOwner` and the role stays Owner.

- [ ] **Step 1:** Write the fixture changes and the spec.
- [ ] **Step 2:** `pnpm --filter web exec vitest run e2e/fixtures/stale.test.ts` red, then green.
- [ ] **Step 3:** The orchestrator runs `pnpm --filter web test:e2e staff-roles.spec.ts client-access.spec.ts server-only-writes.spec.ts contacts.spec.ts billing.spec.ts calendar-meeting-settings.spec.ts` alone on the machine, after checking no `screenshots.yml` run is in progress.
- [ ] **Step 4: Commit.** `test(e2e): a Staff login cannot see or reach Owner work; Owner runs the team (staff and roles)`.

---

## Task 12: Rollout checklist (orchestrator; not a coding task)

**The sequence below is authoritative and SUPERSEDES spec §10's order** (coordinator ruling, 2026-10-10): migration on the CI project, backfill SQL on the CI project, migration on production, backfill SQL on production IMMEDIATELY, parity, then merge and deploy. The reason: the migration's restrictive policies take Delete, calendar settings and Billing from every existing client login until that login has an Owner membership. The backfill is pure SQL that needs only the migration, so running it straight after leaves no window.

- [ ] **Merge prep.** Fetch, merge `main` into the branch, re-run the gates on the combined tree, and confirm the migration number is still the next free one. If the Spanish lane took it, renumber before anything is applied.
- [ ] **1a. CI project.** Apply `NNNN_staff_and_roles.sql` through `ci-project-setup.yml`. Before applying, verify `select role, count(*) from public.memberships group by role` (expected: no rows; if any, record them).
- [ ] **1b. Backfill, CI.** With the DEVELOPMENT instance's `CLERK_SECRET_KEY` in the shell environment for that one command only (PowerShell `$env:`, never a file):
  1. Export accounts: `select id, clerk_org_id from accounts` via MCP `execute_sql` on bis-ci, saved to a scratchpad JSON.
  2. Run `pnpm --filter @bis/db backfill:members <accounts.json> --emit-sql <out.sql>`.
  3. Read the printed counts.
  4. Run `out.sql` via MCP on bis-ci.
- [ ] **1c. Production.** Apply the migration via MCP, then IMMEDIATELY repeat 1b with the PRODUCTION instance's key and production's accounts. Run each exactly once. Do not leave a gap between the two.
- [ ] **1d. Parity.** Run `docs/runbooks/ci-supabase-project.md`'s parity check between bis-ci and production.
- [ ] **2. Exactly ONE Clerk webhook endpoint, on the production instance** (coordinator ruling: no Preview endpoint; the per-request fallback covers Preview and CI).
  - Endpoint `https://app.bis-rgv.com/api/webhooks/clerk`.
  - Events `user.created`, `user.updated`, `organizationMembership.created`, `organizationMembership.deleted`.
  - Its Svix signing secret goes in Vercel **Production only** as `CLERK_WEBHOOK_SIGNING_SECRET` (Sensitive). Use Remove-then-Add if the name already exists, then REDEPLOY.
  - Preview, CI and local runs get no secret: the route answers 503 `not configured` there (Task 4 tests that case).
  - This is an owner step in the Clerk dashboard. Whether Clerk's Backend API can create webhook endpoints is an assumption: verify it against Clerk's docs before relying on it, and use the dashboard otherwise.
  - `.env.example` already carries the name (Task 4).
- [ ] **3. Merge and deploy.** Read the check runs for the head SHA via REST, merge by REST PUT with `sha` pinned, then verify the deploy:
  - READY with the merge SHA, aliased to `app.bis-rgv.com`;
  - `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404;
  - `POST /api/webhooks/clerk` with no signature returns 400 on production (the route shipped and the secret is set: a missing secret would be 503);
  - a served-HTML grep for the Team link marker on a client Owner page.
- [ ] **4. Webhook delivery.** In Clerk's dashboard, send a test event to the production endpoint and see 200 (an unknown org is acknowledged and ignored).
- [ ] **5. Verify.** On production: `select a.name, u.email, m.role from memberships m join users u on u.id = m.user_id join accounts a on a.id = m.account_id order by 1, 2`. Every live client login has role `owner`, and no agency user appears.
- [ ] **6. Runbooks.** Add the webhook endpoint and secret to `docs/runbooks/clerk-setup.md`, and the migration plus backfill order to the run log in `docs/runbooks/ci-supabase-project.md`.
- [ ] **7. Roadmap tracker.** Update S-01's row.

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| §2 R2 Owner and Staff | Task 1 role check; Task 2 `AccountRole` |
| §2 R3 Owner and agency manage the team | Task 9 `requireAccountOwner` admits both; Task 10 Settings card for the agency |
| §2 R4 owner-only list, forms open to Staff | Tasks 6, 7, 8; forms untouched |
| §2 R5 role in BIS | Task 1; invites as `org:member` (Task 9) |
| §4 capability table, existing logins become Owner | Tasks 6 to 10; fallback, backfill and the e2e assertion (Task 11 spec 1) |
| §4 honest limit in the Team help text | Task 10 |
| §5 role check, language, no `removed_at`, indexes, grants | Task 1 (the unique key leads with `account_id`, so it serves the account lookups) |
| §5.1 helpers, coalesced | Task 1, with the NULL-guard tests |
| §6 invitations, webhook, fallback, removal, backfill, Clerk team screen | Tasks 9, 4, 3, 9, 5, 8 |
| §7 contact delete, calendar settings, billing (with the table list), app guards, nav and buttons, last Owner | Tasks 1, 6, 7, 8, 3, 9 |
| §8 Team screen: where, list, invite, inline change, remove and revoke, cap, states, copy, definition of done | Tasks 8 and 10 |
| §9 errors: webhook 400/200/500, plus 503 when the secret is unset (ruling); fallback fails closed and logs; dialog errors | Tasks 4, 3, 9 |
| §10 rollout | Task 12 |
| §11 testing: database matrix, grants guard, webhook, fallback, Team actions, e2e | Tasks 1, 1, 4, 3, 9, 11 |

## Findings for the ledger (outside this plan's scope)

1. **Follow-up: retire the `org:admin` → Owner fallback rule.** Coordinator ruling: this is not an escalation, because only Owners are Clerk `org:admin` and they can already make Owners from the Team screen. After the production backfill, demote every client `org:admin` to `org:member` in Clerk, so that spec §6's "`org:admin` → Owner" branch of the fallback rule can be removed. First verify against Clerk's docs or a dev-instance call that an organisation may have no client `org:admin`, its only admin being the agency.
2. **Who receives the payment-failed banner.** After this change, Staff no longer see it (they cannot read `account_billing`). That matches R4, but the agency should know who gets that message.
