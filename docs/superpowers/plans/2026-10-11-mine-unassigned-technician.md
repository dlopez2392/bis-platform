# Mine, Unassigned and the Technician: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: `docs/superpowers/specs/2026-10-11-mine-unassigned-technician-design.md` (owner decisions M1 to M5 and rulings A1 to A3 and §13.1 to §13.4 are settled; do not re-open them).

**Goal:** Customers and tasks get an assignee; Owners and Staff filter to Mine or Unassigned; a Technician sees and works only the customers assigned to them, enforced by Postgres for their own session token.

**Architecture:** Migration 0068 adds the `technician` role, four `app.*` helpers and RESTRICTIVE policies on every table that carries customer data, all keyed on `app.sees_all_customers(...)` (agency, Owner, Staff) so an unknown role sees nothing. The role check is an uncorrelated scalar subquery (InitPlan, once per statement); only a Technician's statement builds the hashed subplan of `app.my_contact_ids()`. In the app, `requireNotTechnician` refuses the non-working surfaces, every service-key write proves its target through the request client first, consent DISPLAY reads move to the service client after the contact is proven, and a guard test pins every `serviceDb` importer. The UI adds an inline assignee field, a task picker, an "All · Mine · Unassigned" filter (server-side, in `?who=`), a bulk "Assign to…" and a Technician choice on the Team screen.

**Tech Stack:** Next 16 App Router (server actions), Clerk (`@clerk/nextjs` 7), Supabase Postgres (RLS, PostgREST), supabase-js, vitest 4, Playwright.

## Global Constraints

- Tokens only: no hard-coded colours, radii or shadows (DESIGN.md). Rules 3 (role is dot + word), 4 (checkboxes only with bulk actions), 5 (loaded, empty, error states), 6 (reversible actions run at once with an Undo toast), 7 (skeletons, no spinners), Paged lists (one pager, `?before=`, a real total from the server), Record views (inline edit, Undo toast).
- Migrations are applied by the orchestrator only: CI project (`ci-project-setup.yml`), then production via MCP `apply_migration`, then the parity check, all before merge, each exactly once. An implementer applies 0068 to the LOCAL PG18 replica only (memory "Local DB replica").
- Every helper is `stable security definer set search_path = ''` and coalesced: `app.is_agency()` is NULL for a client token, and NULL must never read as "sees everything" (memory "plpgsql NULL guard").
- A login with no membership row sees NO customers (A1, §13.1).
- Agents run only the affected tests, by path. `pnpm check`, `pnpm --filter web build` and `pnpm --filter web test:e2e` belong to the orchestrator, one at a time.
- A task that adds a NEW named import from `@bis/db` to an existing module must update every `vi.mock("@bis/db", ...)` factory in that module's tests (150 test files mock it). Find them with `grep -rln 'vi.mock("@bis/db"' apps/web/src apps/web/e2e | xargs grep -ln "<module file name without extension>"`; a missing export on a factory mock throws `[vitest] No "<name>" export is defined on the mock` at call time.
- Every test must be able to fail. Each task names one mutation probe; run it, see the test fail BY NAME, revert. A `-t` filter that matches nothing silently passes: check the run count.
- Judge `@bis/db` runs by vitest's summary block: `pnpm --filter @bis/db exec vitest run …` prints a trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` after the real results (rule 4).
- Never mutate Test Client One or any live account. e2e runs on the per-run `E2E Client Co <stamp>` fixture only.
- Copy: every new string goes in `apps/web/src/lib/messages.ts` with a `.es` twin (`"key"` / `"key.es"`), read through `m[...]` or `t()` (`lib/i18n/t.ts:32`); the ratchet (`lib/i18n/ratchet.test.ts`) stays green. Spanish uses `usted` and the masculine role nouns already in use ("Dueño", "Empleado", so "Técnico").
- A name shown to a customer is never `accounts.name`. Assignee labels show a member's `name`, else their email.
- Commits: `git add <explicit paths>` then `git commit -- <paths>`; never `-A`, never `git stash`, never push.

## Where the plan departs from the spec's wording (the source decided)

1. **Branding is refused to Technicians too.** Spec §7.1's list omits it, but `branding/page.tsx:56` and all three `branding/actions.ts` actions admit any client through `requireAccountAccess`, and `nav-groups.ts` shows Branding to every client. Branding is settings (M1, M4), so it joins the refused list.
2. **`accountHome` replaces two redirects, not four.** `auth.ts:71` and `:96` know the role and use `accountHome`. `auth.ts:53` runs before the role is read and the landing `(dashboard)/page.tsx:22` has no role at all; both keep sending a client to `/dashboard`, whose `requireNotTechnician` forwards a Technician to `/tasks` in one more hop. There is no loop, because `/tasks` never refuses a Technician (a test pins that).
3. **A task's default assignee.** Spec §8 says both "a task a person adds by hand is assigned to that person" (M3) and "a task defaults to its customer's assignee, or to its author when it has no customer" (M2). They disagree only when an Owner or Staff adds a task on someone else's customer. The plan follows M2's rule, because a Technician must see the task on their own customer as Mine: `taskAssigneeFor` returns the customer's assignee when there is one, else the author. For a Technician both rules give the same answer.
4. **A1 re-seats every existing client actor in the db suite.** Twenty-seven test files impersonate a client with `actAs(c, { org_id })` and no membership. After 0068 such a caller sees no customers, so each positive customer-table case must act as a real member. Task 1 adds `actAsMember` to `packages/db/src/test/db.ts` and converts them. No assertion is weakened.
5. **Duplicate check for a Technician (§13.3).** `createContact`'s duplicate lookup runs under RLS and cannot see someone else's customer, and its own flag insert would be refused by 0068 (`contact_duplicate_flags` is closed to Technicians). `createContact` gains a `flagDb` parameter, and a new `flagMatchesOf` runs on the service client after a Technician's insert, writing the pair with reason `hidden_match`. The Technician is told nothing.
6. **The e2e Technician gets its role from BIS, not Clerk metadata.** Whether `createOrganizationMembership` accepts `publicMetadata` is unverified. The setup seeds the BIS `users` row and a `technician` membership through `serviceDb()` before the first page load, so the fallback reads the stored role and never asks Clerk.
7. **No round-trip from the agency to "Mine".** The agency has no `users` row in the client's company (A5), so `readPersonId` returns null for it, the filter shows All and Unassigned, and an agency-added customer lands Unassigned.

---

## Task order and parallelism

| # | Task | Owner | Review | Runs |
|---|---|---|---|---|
| 1 | Migration 0068 + RLS proof (`technician-scope.test.ts`), re-seated client actors, cost EXPLAIN | bis-db-schema | **opus** | first, alone |
| 2 | `@bis/db` roles and assignment core (`team.ts`, `assignment.ts`, reconcile release) | bis-db-schema | **opus** | after 1, alone |
| 3 | `@bis/db` list filters and writer parameters (contacts, conversations, work queue, tasks, consent ledger) | bis-crm | sonnet | after 2; parallel with 4 |
| 4 | Auth and route guards, nav, palette, shell, Team role (server side + two `team.*` keys) | bis-platform | **opus** | after 2; parallel with 3 |
| 5a | Calendar service-write guards (`callerCanSee`) | bis-booking | **opus** | after 3 and 4; parallel with 5b |
| 5b | Conversation guard, consent display reads on the ledger client, `serviceDb` guard test | bis-comms | **opus** | after 3 and 4; parallel with 5a |
| 6 | Assignment server actions, `?who=` parsing and list wiring | bis-crm | **opus** | after 5a and 5b |
| 7 | Assignment UI: assignee field, task picker, filter row, bulk bar, Team picker, copy | bis-frontend | sonnet | after 6 |
| 8 | e2e: Technician login fixture and `assign.spec.ts` | bis-e2e-qa | sonnet | after 7 |
| 9 | Rollout (orchestrator, not code) | orchestrator | n/a | before merge |

Shared hot files: `packages/db/src/index.ts` (Task 2 only, additive), `apps/web/src/lib/messages.ts` (Task 4 then Task 7, never in parallel), `nav-groups.ts` and `palette/registry.ts` (Task 4 only), `tasks/actions.ts` (5b then 6), `contacts/[contactId]/page.tsx` (5b, 6, 7 in that order). Tasks 3 and 4 touch disjoint trees (`packages/db` vs `apps/web`). Tasks 5a and 5b touch disjoint files.

---

## Task 1: Migration 0068, the RLS proof, re-seated client actors, cost

**Owner:** bis-db-schema. **Review:** opus. **Sequential:** first.

**Files**
- Create: `packages/db/supabase/migrations/0068_mine_unassigned_technician.sql`
- Create: `packages/db/src/test/technician-scope.test.ts`
- Modify: `packages/db/src/test/db.ts` (add `actAsMember`)
- Modify (re-seat positive client cases; step 7 decides which turn red): `packages/db/src/test/rls.test.ts`, `server-only-writes-grants.test.ts`, `call-proposals-grants.test.ts`, `record-event.test.ts`, `automation-log-grants.test.ts`, `automations-grants.test.ts`, `consent-ledger-schema.test.ts`, `forms.test.ts`, `bookings-rescheduled-from-schema.test.ts`, `call-handoff-grants.test.ts`, `call-card-schema.test.ts`, `sites-grants.test.ts`, `billing-schema.test.ts`, `billing-checkout-schema.test.ts`, `staff-roles.test.ts`, and any other file step 7 turns red

**Interfaces**
- Consumes: `app.jwt()`, `app.is_agency()`, `app.current_account_id()` (0001, 0008), `app.account_role(uuid)` (0066:52).
- Produces (SQL):
  - `memberships_role_check`: `role in ('owner','staff','technician')`; `public.set_account_member_role` accepts `technician`.
  - `app.current_user_id() returns uuid`; `app.is_technician(p_account_id uuid) returns boolean`; `app.sees_all_customers(p_account_id uuid) returns boolean` (never NULL); `app.my_contact_ids() returns setof uuid`.
  - `public.release_member_assignments(p_account_id uuid, p_user_id uuid) returns jsonb` = `{"contacts": [uuid...], "tasks": [uuid...]}`, service_role only, empty arrays while the person is still a member.
  - Trigger `tasks_assignee_guard` (BEFORE UPDATE OF `assigned_to` on `public.tasks`), SQLSTATE `42501`.
  - Indexes `contacts_account_assigned`, `tasks_account_assigned_open`.
- Produces (TS, test helper): `export async function actAsMember(c: Client, accountId: string, orgId: string, role?: "owner" | "staff" | "technician"): Promise<string>` returning the seeded `sub`.

- [ ] **Step 1: Verify the facts the migration relies on** (local replica, read-only):

```sql
select max(version) from supabase_migrations.schema_migrations;                 -- expected 0067
select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.memberships'::regclass and conname = 'memberships_role_check';
select tablename, policyname, permissive, cmd from pg_policies
 where schemaname = 'public' and tablename in ('contacts','contact_tags','notes','tasks','opportunities','conversations','messages',
   'calls','call_proposals','bookings','form_submissions','automation_log','consent_events','contact_duplicate_flags','events',
   'accounts','forms','pipelines','pipeline_stages','custom_fields','custom_values','checklist_items','tags')
 order by 1, 2;
```

Expected: 0067; the check reads `('owner','staff')`; every listed table has a permissive tenant policy. If a table has none (or the version is not 0067), stop and report.

- [ ] **Step 2: Add `actAsMember` to `packages/db/src/test/db.ts`** (below `actAs`):

```ts
/**
 * A client caller WITH a membership (0068, spec A1): a client token with no
 * membership sees no customers, so a positive client case must act as a real
 * member. Seeds a users row and a membership (as the table owner, before the
 * role switch) and returns the seeded sub.
 */
export async function actAsMember(
  c: Client, accountId: string, orgId: string, role: "owner" | "staff" | "technician" = "owner",
): Promise<string> {
  const sub = `user_member_${role}_${Math.random().toString(36).slice(2, 10)}`;
  const { rows: [u] } = await c.query<{ id: string }>(
    "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [sub]);
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, $3)", [u!.id, accountId, role]);
  await actAs(c, { org_id: orgId, sub });
  return sub;
}
```

- [ ] **Step 3: Write the failing test** `packages/db/src/test/technician-scope.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsOwner } from "./db";

/**
 * Mine, Unassigned and the Technician (spec §5). Every customer-data table is
 * fenced by a RESTRICTIVE policy keyed on app.sees_all_customers(): agency,
 * Owner and Staff see everything their tenant policy allows; a Technician
 * sees only rows that reach a contact assigned to them; anyone else sees
 * nothing. A refused SELECT/UPDATE/DELETE under RLS is not an error (rowCount
 * 0); a refused INSERT or WITH CHECK raises 42501.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_tech_${RUN}`;
const DIGITS = () => Math.floor(Math.random() * 1e7).toString().padStart(7, "0");
const SUB = {
  owner: `user_t_owner_${RUN}`, staff: `user_t_staff_${RUN}`, tech: `user_t_tech_${RUN}`,
  tech2: `user_t_tech2_${RUN}`, none: `user_t_none_${RUN}`,
} as const;
type Person = keyof typeof SUB;
type Actor = Person | "agency";
const claimsFor = (a: Actor) =>
  a === "agency" ? { app_role: "agency_admin", sub: `user_t_agency_${RUN}` } : { org_id: ORG, sub: SUB[a] };

/** Tables whose rows reach exactly one contact: the key column to select by. */
const PER_CONTACT = {
  contact_tags: "contact_id", notes: "id", tasks: "id", opportunities: "id", conversations: "id",
  messages: "id", calls: "id", call_proposals: "id", bookings: "id", form_submissions: "id",
  automation_log: "id", consent_events: "id",
} as const;
type Table = keyof typeof PER_CONTACT;

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'Tech Co',true) returning id",
    [agency!.id, ORG]);
  const users = {} as Record<Person, string>;
  for (const k of Object.keys(SUB) as Person[]) {
    users[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  }
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$5,'owner'), ($2,'account',$5,'staff'), ($3,'account',$5,'technician'), ($4,'account',$5,'technician')`,
    [users.owner, users.staff, users.tech, users.tech2, acct]);
  const contact = (assignee: string | null, name: string) =>
    one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [acct, name, assignee]);
  const mine = await contact(users.tech, "Mine");
  const theirs = await contact(users.tech2, "Theirs");
  const open = await contact(null, "Open");

  const tag = await one("insert into tags (account_id, name) values ($1,$2) returning id", [acct, `vip-${RUN}`]);
  const pipeline = await one("insert into pipelines (account_id, name) values ($1,'Sales') returning id", [acct]);
  const stage = await one("insert into pipeline_stages (account_id, pipeline_id, name, position) values ($1,$2,'New',0) returning id", [acct, pipeline]);
  const phone = await one("insert into phone_numbers (account_id, e164) values ($1,$2) returning id", [acct, `+1999${DIGITS()}`]);
  const calendar = await one("insert into calendars (account_id, public_id) values ($1,$2) returning id", [acct, `tech-${RUN}`]);
  const form = await one("insert into forms (account_id, public_id, name) values ($1,$2,'Quote') returning id", [acct, `pub_t_${RUN}`]);

  let hour = 0;
  const rowsFor = async (cid: string | null, assignee: string | null): Promise<Record<Table, string>> => {
    hour += 2;
    const starts = new Date(Date.UTC(2030, 0, 1, hour));
    const conv = cid ? await one("insert into conversations (account_id, contact_id) values ($1,$2) returning id", [acct, cid]) : "";
    const call = await one("insert into calls (account_id, phone_number_id, contact_id, caller_e164) values ($1,$2,$3,'+19565550142') returning id", [acct, phone, cid]);
    if (cid) await c.query("insert into contact_tags (contact_id, tag_id, account_id) values ($1,$2,$3)", [cid, tag, acct]);
    return {
      contact_tags: cid ?? "",
      notes: cid ? await one("insert into notes (account_id, contact_id, body) values ($1,$2,'n') returning id", [acct, cid]) : "",
      tasks: await one("insert into tasks (account_id, contact_id, title, assigned_to) values ($1,$2,'t',$3) returning id", [acct, cid, assignee]),
      opportunities: cid ? await one("insert into opportunities (account_id, contact_id, pipeline_id, stage_id, name) values ($1,$2,$3,$4,'Roof') returning id", [acct, cid, pipeline, stage]) : "",
      conversations: conv,
      messages: cid ? await one("insert into messages (account_id, conversation_id, channel, direction, body) values ($1,$2,'sms','inbound','hola') returning id", [acct, conv]) : "",
      calls: call,
      call_proposals: await one("insert into call_proposals (account_id, call_id, contact_id, kind, payload, evidence) values ($1,$2,$3,'task','{}','they asked') returning id", [acct, call, cid]),
      bookings: cid ? await one(
        "insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token) values ($1,$2,$3,$4,$5,$6) returning id",
        [acct, calendar, cid, starts.toISOString(), new Date(starts.getTime() + 1_800_000).toISOString(), `tok_${RUN}_${hour}`]) : "",
      form_submissions: await one("insert into form_submissions (account_id, form_id, contact_id) values ($1,$2,$3) returning id", [acct, form, cid]),
      automation_log: await one(
        "insert into automation_log (account_id, source, channel, contact_id, subject_key, status) values ($1,'sms_reminder','sms',$2,$3,'sent') returning id",
        [acct, cid, `booking:${RUN}-${hour}`]),
      consent_events: await one(
        "insert into consent_events (account_id, channel, address, action, method, contact_id) values ($1,'sms',$2,'revoked','keyword',$3) returning id",
        [acct, `+1956${DIGITS()}`, cid]),
    };
  };
  const rows = { mine: await rowsFor(mine, users.tech), theirs: await rowsFor(theirs, users.tech2), none: await rowsFor(null, null) };
  const looseTaskMine = await one("insert into tasks (account_id, title, assigned_to) values ($1,'loose',$2) returning id", [acct, users.tech]);
  const looseTaskTheirs = await one("insert into tasks (account_id, title, assigned_to) values ($1,'loose',$2) returning id", [acct, users.tech2]);
  const ownerTaskOnMine = await one("insert into tasks (account_id, contact_id, title, assigned_to) values ($1,$2,'owner''s',$3) returning id", [acct, mine, users.owner]);
  const event = (await c.query<{ id: string }>(
    "insert into events (account_id, type, actor_type, payload) values ($1,'contact.created','system',$2) returning id::text as id",
    [acct, JSON.stringify({ contactId: mine })])).rows[0]!.id;
  const [a, b] = [mine, open].sort();
  await c.query("insert into contact_duplicate_flags (account_id, contact_a, contact_b, reason) values ($1,$2,$3,'test')", [acct, a, b]);
  return { acct, users, mine, theirs, open, rows, looseTaskMine, looseTaskTheirs, ownerTaskOnMine, event };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

const visible = async (c: Client, table: Table, ids: string[]) => {
  const key = PER_CONTACT[table];
  const { rows } = await c.query<{ k: string }>(`select ${key}::text as k from ${table} where ${key} = any($1::uuid[])`, [ids.filter(Boolean)]);
  return rows.map((r) => r.k).sort();
};

describe("a Technician reads only their own customers, table by table (mutation: drop any one table's restrictive policy -> that table's case FAILS)", () => {
  for (const table of Object.keys(PER_CONTACT) as Table[]) {
    it(`${table}: own rows only`, () => withRollback(async (c) => {
      const s: Seeded = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect(await visible(c, table, [s.rows.mine[table], s.rows.theirs[table], s.rows.none[table]]))
        .toEqual([s.rows.mine[table]].filter(Boolean).sort());
    }));
  }
  it("contacts: only the one assigned to them", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    const { rows } = await c.query<{ id: string }>("select id from contacts where account_id = $1", [s.acct]);
    expect(rows.map((r) => r.id)).toEqual([s.mine]);
  }));
  it("tasks: a task with no customer is theirs only when assigned to them (mutation: drop the contact_id-is-null branch -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      const { rows } = await c.query<{ id: string }>("select id from tasks where id = any($1::uuid[])", [[s.looseTaskMine, s.looseTaskTheirs]]);
      expect(rows.map((r) => r.id)).toEqual([s.looseTaskMine]);
    }));
  it("events and duplicate flags: none at all", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    expect((await c.query("select 1 from events where account_id = $1", [s.acct])).rowCount).toBe(0);
    expect((await c.query("select 1 from contact_duplicate_flags where account_id = $1", [s.acct])).rowCount).toBe(0);
  }));
});

describe("Owner, Staff and the agency are unchanged (mutation: key the policy on is_account_owner -> the staff case FAILS)", () => {
  for (const actor of ["owner", "staff", "agency"] as const) {
    it(`${actor}: sees every row of every table`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor(actor));
      for (const table of Object.keys(PER_CONTACT) as Table[]) {
        const ids = [s.rows.mine[table], s.rows.theirs[table], s.rows.none[table]].filter(Boolean);
        expect(await visible(c, table, ids), table).toEqual([...new Set(ids)].sort());
      }
      expect((await c.query("select 1 from events where account_id = $1", [s.acct])).rowCount).toBeGreaterThan(0);
      expect((await c.query("select 1 from contact_duplicate_flags where account_id = $1", [s.acct])).rowCount).toBe(1);
    }));
  }
});

describe("the NULL guard (A1; memory: plpgsql NULL guard)", () => {
  it("a client with no membership sees no customers (mutation: write the policy as `not coalesce(app.is_technician(...), false)` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("none"));
      expect((await c.query("select 1 from contacts where account_id = $1", [s.acct])).rowCount).toBe(0);
      expect((await c.query("select 1 from calls where account_id = $1", [s.acct])).rowCount).toBe(0);
    }));
  it("sees_all_customers is FALSE, never NULL, for a client token with no membership (mutation: drop either coalesce -> FAILS with null)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("none"));
      const { rows: [r] } = await c.query("select app.sees_all_customers($1) as sees_all, app.is_technician($1) as tech, app.current_user_id() is not null as known", [s.acct]);
      expect(r).toEqual({ sees_all: false, tech: false, known: true });
    }));
});

describe("Technician writes (spec §5.3)", () => {
  it("updates their own customer, never someone else's", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    expect((await c.query("update contacts set first_name = 'Edited' where id = $1", [s.mine])).rowCount).toBe(1);
    expect((await c.query("update contacts set first_name = 'Edited' where id = $1", [s.theirs])).rowCount).toBe(0);
  }));
  it.each([["to another person", "tech2"], ["back to Unassigned", null]] as const)(
    "cannot reassign their customer %s (mutation: drop the WITH CHECK -> FAILS)", (_label, to) => withRollback(async (c) => {
      const s = await seed(c);
      const target = to === null ? null : s.users[to];
      await actAs(c, claimsFor("tech"));
      await expect(c.query("update contacts set assigned_to = $2 where id = $1", [s.mine, target])).rejects.toMatchObject({ code: "42501" });
    }));
  it("a customer they add must be assigned to them", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    await expect(c.query("insert into contacts (account_id, first_name) values ($1,'Walk-in')", [s.acct])).rejects.toMatchObject({ code: "42501" });
    expect((await c.query("insert into contacts (account_id, first_name, assigned_to) values ($1,'Walk-in',$2)", [s.acct, s.users.tech])).rowCount).toBe(1);
  }));
  it("finishes a task on their customer that the Owner holds, but cannot reassign it (mutation: drop the trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect((await c.query("update tasks set completed_at = now() where id = $1", [s.ownerTaskOnMine])).rowCount).toBe(1);
      await expect(c.query("update tasks set assigned_to = $2 where id = $1", [s.ownerTaskOnMine, s.users.tech])).rejects.toMatchObject({ code: "42501" });
    }));
  it("a task they add is theirs; one aimed at someone else is refused", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    expect((await c.query("insert into tasks (account_id, contact_id, title, assigned_to) values ($1,$2,'call back',$3)", [s.acct, s.mine, s.users.tech])).rowCount).toBe(1);
    await expect(c.query("insert into tasks (account_id, contact_id, title, assigned_to) values ($1,$2,'x',$3)", [s.acct, s.mine, s.users.tech2])).rejects.toMatchObject({ code: "42501" });
    await expect(c.query("insert into notes (account_id, contact_id, body) values ($1,$2,'x')", [s.acct, s.theirs])).rejects.toMatchObject({ code: "42501" });
  }));
  it("account configuration is read-only to them; tags may still be created (mutation: drop forms_technician_update -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect((await c.query("update forms set name = 'Hacked' where account_id = $1", [s.acct])).rowCount).toBe(0);
      await expect(c.query("insert into pipelines (account_id, name) values ($1,'Mine')", [s.acct])).rejects.toMatchObject({ code: "42501" });
      expect((await c.query("update accounts set brand_name = 'X' where id = $1", [s.acct])).rowCount).toBe(0);
      expect((await c.query("insert into tags (account_id, name) values ($1,$2)", [s.acct, `new-${RUN}`])).rowCount).toBe(1);
      expect((await c.query("delete from tags where account_id = $1", [s.acct])).rowCount).toBe(0);
    }));
  it("Staff can still reassign anything (mutation: apply the trigger to every authenticated caller -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("staff"));
    expect((await c.query("update contacts set assigned_to = null where id = $1", [s.mine])).rowCount).toBe(1);
    expect((await c.query("update tasks set assigned_to = $2 where id = $1", [s.ownerTaskOnMine, s.users.staff])).rowCount).toBe(1);
  }));
});

describe("roles and release (spec §5.1, §8)", () => {
  it("memberships.role takes technician and nothing new (mutation: leave the check at owner|staff -> seed FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$2,'tech')", [s.users.none, s.acct]))
      .rejects.toMatchObject({ code: "23514" });
    expect((await c.query("select public.set_account_member_role($1,$2,'technician') as r", [s.acct, s.users.staff])).rows[0]).toEqual({ r: "ok" });
  }));
  it("release_member_assignments clears a departed person's customers and open tasks, and returns them", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("delete from memberships where user_id = $1", [s.users.tech]);
    const { rows: [r] } = await c.query<{ j: { contacts: string[]; tasks: string[] } }>("select public.release_member_assignments($1,$2) as j", [s.acct, s.users.tech]);
    expect(r!.j.contacts).toEqual([s.mine]);
    expect(r!.j.tasks.sort()).toEqual([s.rows.mine.tasks, s.looseTaskMine].sort());
    expect((await c.query("select assigned_to from contacts where id = $1", [s.mine])).rows[0]).toEqual({ assigned_to: null });
  }));
  it("release_member_assignments does nothing while the person is still a member (mutation: drop the membership check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const { rows: [r] } = await c.query("select public.release_member_assignments($1,$2) as j", [s.acct, s.users.tech]);
      expect(r).toEqual({ j: { contacts: [], tasks: [] } });
    }));
  it("release_member_assignments is service_role only", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("owner"));
    await expect(c.query("select public.release_member_assignments($1,$2)", [s.acct, s.users.tech])).rejects.toMatchObject({ code: "42501" });
    await actAsOwner(c);
  }));
});
```

- [ ] **Step 4: Run it red.**

Run: `pnpm --filter @bis/db exec vitest run src/test/technician-scope.test.ts`
Expected: every case fails in `seed`, `new row for relation "memberships" violates check constraint "memberships_role_check"`. Paste that line and the summary block.

- [ ] **Step 5: Write the migration** `packages/db/supabase/migrations/0068_mine_unassigned_technician.sql`:

```sql
-- 0068_mine_unassigned_technician.sql — Mine, Unassigned and the Technician
-- (docs/superpowers/specs/2026-10-11-mine-unassigned-technician-design.md §5)
--
-- A third role, technician, sees only the customers assigned to them (contacts.assigned_to) and
-- every row that reaches those customers. Every table carrying customer data gets a RESTRICTIVE
-- policy ANDed with its permissive tenant policy:
--   (select app.sees_all_customers(app.current_account_id())) or <row reaches one of my contacts>
-- sees_all_customers is TRUE for the agency, an Owner and Staff, and FALSE (never NULL) for a
-- Technician and for a client with NO membership (owner ruling A1): an unknown role sees nothing.
-- The left operand is an uncorrelated scalar subquery (an InitPlan, once per statement); when it is
-- true the OR never builds the hashed subplan on the right, so Owner/Staff/agency pay ~nothing.
--
-- APPLY ORDER: CI project (ci-project-setup.yml), then production (MCP apply_migration), then the
-- parity check, then merge. Before production: every live client login must already hold a
-- membership (0066 rollout step 4), or that login sees no customers until its next page load
-- creates the row through the per-request fallback.
--
-- ROLLBACK (revert the app first: it offers the role), section by section:
--   7  drop function public.release_member_assignments(uuid, uuid);
--   6  drop index public.contacts_account_assigned; drop index public.tasks_account_assigned_open;
--   5  drop trigger tasks_assignee_guard on public.tasks; drop function app.tasks_assignee_guard();
--   4  drop every policy named *_technician_* below (the loops name them);
--   3  drop function app.my_contact_ids(); drop function app.sees_all_customers(uuid);
--      drop function app.is_technician(uuid); drop function app.current_user_id();
--   2  restore 0066's public.set_account_member_role body (owner|staff);
--   1  update public.memberships set role = 'staff' where role = 'technician'; restore the check to ('owner','staff').

set local lock_timeout = '5s';

-- 1. The role.
alter table public.memberships drop constraint memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in ('owner', 'staff', 'technician'));

-- 2. Role changes accept technician. Same body as 0066 otherwise; demoting an Owner to technician
--    goes through the same last-Owner guard.
create or replace function public.set_account_member_role(p_account_id uuid, p_user_id uuid, p_role text)
returns text language plpgsql set search_path = '' as $$
declare v_current text; v_owners int;
begin
  if p_role is null or p_role not in ('owner', 'staff', 'technician') then
    raise exception 'set_account_member_role: role must be owner, staff or technician' using errcode = '22023';
  end if;
  perform 1 from public.accounts where id = p_account_id for no key update;
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
revoke all on function public.set_account_member_role(uuid, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.set_account_member_role(uuid, uuid, text) to service_role;

-- 3. Helpers. p_account_id, not account_id (0066 §3's reason). Every boolean is coalesced.
create function app.current_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from public.users u where u.clerk_user_id = nullif(app.jwt() ->> 'sub', '')
$$;

create function app.is_technician(p_account_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.account_role(p_account_id) = 'technician', false)
$$;

create function app.sees_all_customers(p_account_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.is_agency(), false) or coalesce(app.account_role(p_account_id) in ('owner', 'staff'), false)
$$;

-- SECURITY DEFINER, so a policy on another table that calls it never re-enters contacts' own policy.
create function app.my_contact_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.contacts c
   where c.account_id = app.current_account_id() and c.assigned_to = app.current_user_id()
$$;

revoke all on function app.current_user_id() from public, anon;
revoke all on function app.is_technician(uuid) from public, anon;
revoke all on function app.sees_all_customers(uuid) from public, anon;
revoke all on function app.my_contact_ids() from public, anon;
grant execute on function app.current_user_id() to authenticated, service_role;
grant execute on function app.is_technician(uuid) to authenticated, service_role;
grant execute on function app.sees_all_customers(uuid) to authenticated, service_role;
grant execute on function app.my_contact_ids() to authenticated, service_role;

-- 4. Restrictive policies.
-- 4a. contacts: a with-check, not a trigger. "Me" is the only legal assigned_to before AND after a
--     Technician's update, so they cannot reassign (to anyone, or to NULL), and an insert must carry it.
create policy contacts_technician_scope on public.contacts as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or assigned_to = (select app.current_user_id()))
  with check ((select app.sees_all_customers(app.current_account_id())) or assigned_to = (select app.current_user_id()));

-- 4b. Tables whose row names its contact directly.
do $$
declare t text;
begin
  foreach t in array array['contact_tags','notes','opportunities','conversations','calls','bookings',
                           'form_submissions','automation_log','consent_events'] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()))
         with check ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()))',
      t || '_technician_scope', t);
  end loop;
end $$;

-- 4c. Rows that reach a contact through a parent.
create policy messages_technician_scope on public.messages as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or conversation_id in (select v.id from public.conversations v where v.contact_id in (select app.my_contact_ids())));
create policy call_proposals_technician_scope on public.call_proposals as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or call_id in (select k.id from public.calls k where k.contact_id in (select app.my_contact_ids())));

-- 4d. tasks: visible when the customer is theirs, or there is no customer and it is assigned to them.
--     UPDATE re-checks the same expression (no WITH CHECK given), so finishing an Owner-held task on
--     their own customer passes; the assignee itself is guarded by the trigger in section 5.
create policy tasks_technician_scope on public.tasks as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or (contact_id is null and assigned_to = (select app.current_user_id())));
create policy tasks_technician_insert on public.tasks as restrictive for insert to authenticated
  with check ((select app.sees_all_customers(app.current_account_id())) or assigned_to = (select app.current_user_id()));

-- 4e. Nothing at all for a Technician: the account-wide ledger and the merge queue.
create policy events_technician_none on public.events as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id())));
create policy contact_duplicate_flags_technician_none on public.contact_duplicate_flags as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id())))
  with check ((select app.sees_all_customers(app.current_account_id())));

-- 4f. Account configuration is read-only to a Technician (M4). tags keeps INSERT: tagging their own
--     customer with a new word creates the tag (addTagToContact).
do $$
declare t text; cmd text;
begin
  foreach t in array array['accounts','forms','pipelines','pipeline_stages','custom_fields','custom_values','checklist_items','tags'] loop
    foreach cmd in array array['insert','update','delete'] loop
      continue when t = 'tags' and cmd = 'insert';
      if cmd = 'insert' then
        execute format('create policy %I on public.%I as restrictive for insert to authenticated
                          with check ((select app.sees_all_customers(app.current_account_id())))', t || '_technician_' || cmd, t);
      else
        execute format('create policy %I on public.%I as restrictive for %s to authenticated
                          using ((select app.sees_all_customers(app.current_account_id())))', t || '_technician_' || cmd, t, cmd);
      end if;
    end loop;
  end loop;
end $$;

-- 5. A Technician never changes a task's assignee. A trigger, not a with-check: the legal value after
--    their update is "whatever it was", not "me" (an Owner-held task on their customer). Plain, NOT
--    security definer, so current_user is the caller; keyed on 'authenticated' so the service role passes.
create function app.tasks_assignee_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.assigned_to is distinct from old.assigned_to
     and current_user = 'authenticated'
     and not coalesce(app.sees_all_customers(new.account_id), false) then
    raise exception 'tasks: a technician cannot change a task''s assignee' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger tasks_assignee_guard before update of assigned_to on public.tasks
  for each row execute function app.tasks_assignee_guard();

-- 6. Indexes for my_contact_ids() / Mine, and To do's Mine.
create index contacts_account_assigned on public.contacts (account_id, assigned_to);
create index tasks_account_assigned_open on public.tasks (account_id, assigned_to) where completed_at is null;

-- 7. A departed member's customers and open tasks go back to Unassigned (owner ruling A3). users
--    rows survive a removal, so no FK action can do this. Does nothing while the person is still a
--    member, so a late retry can never strip an active person. service_role only.
create function public.release_member_assignments(p_account_id uuid, p_user_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare v_contacts uuid[]; v_tasks uuid[];
begin
  if exists (select 1 from public.memberships
              where scope = 'account' and account_id = p_account_id and user_id = p_user_id) then
    return jsonb_build_object('contacts', '[]'::jsonb, 'tasks', '[]'::jsonb);
  end if;
  with c as (update public.contacts set assigned_to = null, updated_at = now()
              where account_id = p_account_id and assigned_to = p_user_id returning id)
  select coalesce(array_agg(id order by id), '{}') into v_contacts from c;
  with t as (update public.tasks set assigned_to = null
              where account_id = p_account_id and assigned_to = p_user_id and completed_at is null returning id)
  select coalesce(array_agg(id order by id), '{}') into v_tasks from t;
  return jsonb_build_object('contacts', to_jsonb(v_contacts), 'tasks', to_jsonb(v_tasks));
end $$;
revoke all on function public.release_member_assignments(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.release_member_assignments(uuid, uuid) to service_role;
```

- [ ] **Step 6: Apply 0068 to the LOCAL replica only and run the new test green.**

Run: `pnpm --filter @bis/db exec vitest run src/test/technician-scope.test.ts`
Expected: all green. Paste the summary line.

- [ ] **Step 7: Find the client actors A1 turned red.**

Run:
```
pnpm --filter @bis/db exec vitest run src/test/rls.test.ts src/test/server-only-writes-grants.test.ts src/test/call-proposals-grants.test.ts src/test/record-event.test.ts src/test/automation-log-grants.test.ts src/test/automations-grants.test.ts src/test/consent-ledger-schema.test.ts src/test/forms.test.ts src/test/bookings-rescheduled-from-schema.test.ts src/test/call-handoff-grants.test.ts src/test/call-card-schema.test.ts src/test/sites-grants.test.ts src/test/billing-schema.test.ts src/test/billing-checkout-schema.test.ts src/test/staff-roles.test.ts src/test/voice-web-sessions-grants.test.ts src/test/concierge-grants.test.ts src/test/screened-calls-grants.test.ts src/test/forwarded-calls.test.ts src/test/voice-forward-grants.test.ts src/test/ops-heartbeats-grants.test.ts src/test/go-live-grants.test.ts src/test/alert-phone-consume-grants.test.ts src/test/person-preferences-schema.test.ts src/test/messaging-profile-schema.test.ts src/test/alert-phone-verification-grants.test.ts src/test/alert-phone-grants.test.ts src/test/schema-grants-guard.test.ts src/test/team-functions.test.ts
```

Expected: red only where a client acting as `{ org_id }` with no membership expected to read or write customer rows (for example `rls.test.ts` "CRM tables are tenant-isolated", which expects to read Alice). List every red test by name in the report. `schema-grants-guard.test.ts` stays green (0068 adds no table grant).

- [ ] **Step 8: Re-seat those actors.** In each red case replace `await actAs(c, { org_id: X })` with `await actAsMember(c, <that org's account id>, X)` (an Owner), importing `actAsMember` from `./db`. Keep a bare `actAs` where the case is ABOUT a caller with no account (`org_NOPE`) or with client access off. Never change an expected value. Re-run step 7's command: every file green. Paste the summary line.

- [ ] **Step 9: Cost on the local replica** (spec §10 "Cost"; the 0066 method). As the table owner, seed one account with 5,000 contacts and 20,000 messages (`generate_series`), an Owner and a Technician holding 200 of the contacts, then for each actor:

```sql
begin;
select set_config('request.jwt.claims', '{"org_id":"<org>","sub":"<owner or tech sub>"}', true);
set local role authenticated;
explain (analyze, buffers) select id, first_name from public.contacts where account_id = '<acct>';
explain (analyze, buffers) select id from public.messages where account_id = '<acct>' order by created_at desc limit 50;
rollback;
```

Record in the report: the plan shows `InitPlan` for `sees_all_customers` and, for the Technician only, `hashed SubPlan` for `my_contact_ids`; Owner timings with 0068 vs with the five `contacts`/`messages` restrictive policies dropped (budget: within 10%); Technician timings. If the Owner exceeds the budget, stop and report: do not restructure the policies without review.

- [ ] **Step 10: Mutation probes** (paste each failing test name, then revert): (a) drop `calls_technician_scope` and `calls: own rows only` fails; (b) rewrite `sees_all_customers` without its two `coalesce`s and the NULL-guard case fails with `null`; (c) drop trigger `tasks_assignee_guard` and "finishes a task … cannot reassign it" fails; (d) remove the membership check in `release_member_assignments` and its "does nothing while the person is still a member" case fails.

- [ ] **Step 11: Commit.**

```bash
git add packages/db/supabase/migrations/0068_mine_unassigned_technician.sql packages/db/src/test/technician-scope.test.ts packages/db/src/test/db.ts <each re-seated test file>
git commit -m "feat(db): technician role, assignee-scoped RLS on customer data, release on removal (migration 0068)" -- packages/db/supabase/migrations/0068_mine_unassigned_technician.sql packages/db/src/test/technician-scope.test.ts packages/db/src/test/db.ts <each re-seated test file>
```

Do NOT apply 0068 anywhere but the local replica.

---

## Task 2: `@bis/db` roles and assignment core

**Owner:** bis-db-schema. **Review:** opus. **Sequential:** after Task 1.

**Files**
- Modify: `packages/db/src/team.ts` (`AccountRole`, `ROLES`, `roleFromClerk`, the `removed` branch of `reconcileMembership`)
- Create: `packages/db/src/assignment.ts`, `packages/db/src/test/assignment.test.ts`
- Modify: `packages/db/src/test/team.test.ts` (ordering cases, release on webhook removal)
- Modify: `packages/db/src/index.ts` (additive: one export block for `assignment.ts`)

**Interfaces**
- Consumes: `release_member_assignments` (Task 1), `emit` (`./events`). `assignment.ts` must NOT import `./team` (team.ts imports `releaseMemberAssignments` from it; a cycle would be a load-order hazard), so its membership check queries `memberships` itself.
- Produces:

```ts
// team.ts
export type AccountRole = "owner" | "staff" | "technician";
export function roleFromClerk(input: { clerkRole: string; membershipMeta?: unknown; invitationMeta?: unknown }): AccountRole; // least privileged answer
// assignment.ts
export type AssigneeFilter = { who: "mine"; userId: string } | { who: "unassigned" };
export type ReleasedAssignments = { contacts: string[]; tasks: string[] };
export type PreviousAssignee = { contactId: string; assignee: string | null };
export async function readPersonId(db: SupabaseClient, clerkUserId: string): Promise<string | null>;
export async function taskAssigneeFor(db: SupabaseClient, accountId: string, contactId: string | null, authorUserId: string | null): Promise<string | null>;
export async function assignContacts(db: SupabaseClient, accountId: string, contactIds: readonly string[], assignee: string | null, actorId: string): Promise<PreviousAssignee[]>;
export async function setTaskAssignee(db: SupabaseClient, accountId: string, taskId: string, assignee: string | null, actorId: string): Promise<{ previous: string | null } | "not_found">;
export async function releaseMemberAssignments(db: SupabaseClient, accountId: string, userId: string): Promise<ReleasedAssignments>;
export async function reassignReleased(db: SupabaseClient, accountId: string, userId: string, released: ReleasedAssignments): Promise<void>;
```

- [ ] **Step 1: Failing tests.** In `packages/db/src/test/team.test.ts`, add:

```ts
describe("roleFromClerk: a technician bis_role is honoured and can only lower (spec §6)", () => {
  it("org:member + bis_role technician -> technician (mutation: drop 'technician' from ROLES -> FAILS with staff)", () => {
    expect(roleFromClerk({ clerkRole: "org:member", membershipMeta: { bis_role: "technician" } })).toBe("technician");
  });
  it("org:admin + an invitation that said technician -> technician, never owner or staff (mutation: answers.every(owner) ? owner : staff -> FAILS)", () => {
    expect(roleFromClerk({ clerkRole: "org:admin", invitationMeta: { bis_role: "technician" } })).toBe("technician");
  });
  it("staff metadata beside technician metadata -> technician", () => {
    expect(roleFromClerk({ clerkRole: "org:member", membershipMeta: { bis_role: "staff" }, invitationMeta: { bis_role: "technician" } })).toBe("technician");
  });
  it("no metadata keeps the old rule", () => {
    expect(roleFromClerk({ clerkRole: "org:admin" })).toBe("owner");
    expect(roleFromClerk({ clerkRole: "org:member" })).toBe("staff");
  });
});
```

and, beside the existing webhook-removal reconcile case, one that seeds a contact assigned to the removed user (service client), runs `reconcileMembership(db, fakePort, { mode: "webhook", … })` with a port whose `getMembership` returns null, and asserts the outcome `removed` AND `contacts.assigned_to` is now null (mutation: skip the release call -> FAILS).

Create `packages/db/src/test/assignment.test.ts` (committed rows, `withTestAccount`, service client):

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import {
  readPersonId, taskAssigneeFor, assignContacts, setTaskAssignee, releaseMemberAssignments, reassignReleased,
} from "../assignment";
import type { SupabaseClient } from "@supabase/supabase-js";

const RUN = Math.random().toString(36).slice(2, 10);
async function person(db: SupabaseClient, accountId: string, tag: string, role: "owner" | "staff" | "technician") {
  const clerk = `user_assign_${tag}_${RUN}`;
  const { data: u, error } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com` }).select("id").single();
  if (error) throw error;
  const { error: mErr } = await db.from("memberships").insert({ scope: "account", account_id: accountId, user_id: u!.id, role });
  if (mErr) throw mErr;
  return { id: u!.id as string, clerk };
}
const contact = async (db: SupabaseClient, accountId: string, assignee: string | null) =>
  (await db.from("contacts").insert({ account_id: accountId, first_name: "C", assigned_to: assignee }).select("id").single()).data!.id as string;
const cleanup = (db: SupabaseClient) => db.from("users").delete().like("clerk_user_id", `user_assign_%_${RUN}`);

describe("assignment core (spec §8)", () => {
  it("readPersonId: the users row for a Clerk id, else null", () => withTestAccount(async (db, accountId) => {
    try {
      const a = await person(db, accountId, "p", "staff");
      expect(await readPersonId(db, a.clerk)).toBe(a.id);
      expect(await readPersonId(db, `user_nobody_${RUN}`)).toBeNull();
    } finally { await cleanup(db); }
  }));
  it("taskAssigneeFor: the customer's assignee, else the author (mutation: always return the author -> FAILS)", () => withTestAccount(async (db, accountId) => {
    try {
      const tech = await person(db, accountId, "t1", "technician");
      const owner = await person(db, accountId, "o1", "owner");
      const assigned = await contact(db, accountId, tech.id);
      const open = await contact(db, accountId, null);
      expect(await taskAssigneeFor(db, accountId, assigned, owner.id)).toBe(tech.id);
      expect(await taskAssigneeFor(db, accountId, open, owner.id)).toBe(owner.id);
      expect(await taskAssigneeFor(db, accountId, null, owner.id)).toBe(owner.id);
      expect(await taskAssigneeFor(db, accountId, null, null)).toBeNull();
    } finally { await cleanup(db); }
  }));
  it("assignContacts moves the old assignee's open tasks with the customer and returns the previous assignees (A4; mutation: skip the task move -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      try {
        const a = await person(db, accountId, "a", "technician");
        const b = await person(db, accountId, "b", "technician");
        const owner = await person(db, accountId, "o2", "owner");
        const c1 = await contact(db, accountId, a.id);
        const { data: t1 } = await db.from("tasks").insert({ account_id: accountId, contact_id: c1, title: "x", assigned_to: a.id }).select("id").single();
        const { data: tOwner } = await db.from("tasks").insert({ account_id: accountId, contact_id: c1, title: "y", assigned_to: owner.id }).select("id").single();
        const previous = await assignContacts(db, accountId, [c1], b.id, owner.clerk);
        expect(previous).toEqual([{ contactId: c1, assignee: a.id }]);
        const { data: rows } = await db.from("tasks").select("id, assigned_to").in("id", [t1!.id, tOwner!.id]);
        const by = Object.fromEntries((rows ?? []).map((r) => [r.id, r.assigned_to]));
        expect(by[t1!.id]).toBe(b.id);
        expect(by[tOwner!.id]).toBe(owner.id);
      } finally { await cleanup(db); }
    }));
  it("assignContacts refuses a target who is not a member of this account", () => withTestAccount(async (db, accountId) => {
    try {
      const c1 = await contact(db, accountId, null);
      const { data: stranger } = await db.from("users").insert({ clerk_user_id: `user_assign_x_${RUN}`, email: `x_${RUN}@example.com` }).select("id").single();
      await expect(assignContacts(db, accountId, [c1], stranger!.id, "user_test")).rejects.toThrow(/not a member/);
    } finally { await cleanup(db); }
  }));
  it("setTaskAssignee returns the previous assignee, or not_found", () => withTestAccount(async (db, accountId) => {
    try {
      const a = await person(db, accountId, "s", "staff");
      const { data: t } = await db.from("tasks").insert({ account_id: accountId, title: "z" }).select("id").single();
      expect(await setTaskAssignee(db, accountId, t!.id, a.id, a.clerk)).toEqual({ previous: null });
      expect(await setTaskAssignee(db, accountId, "00000000-0000-4000-8000-000000000000", a.id, a.clerk)).toBe("not_found");
    } finally { await cleanup(db); }
  }));
  it("releaseMemberAssignments then reassignReleased restores only what is still Unassigned", () => withTestAccount(async (db, accountId) => {
    try {
      const a = await person(db, accountId, "r", "technician");
      const other = await person(db, accountId, "r2", "staff");
      const c1 = await contact(db, accountId, a.id);
      const c2 = await contact(db, accountId, a.id);
      await db.from("memberships").delete().eq("user_id", a.id);
      const released = await releaseMemberAssignments(db, accountId, a.id);
      expect(released.contacts.sort()).toEqual([c1, c2].sort());
      await db.from("contacts").update({ assigned_to: other.id }).eq("id", c2);   // picked up meanwhile
      await reassignReleased(db, accountId, a.id, released);
      const { data } = await db.from("contacts").select("id, assigned_to").in("id", [c1, c2]);
      const by = Object.fromEntries((data ?? []).map((r) => [r.id, r.assigned_to]));
      expect(by[c1]).toBe(a.id);
      expect(by[c2]).toBe(other.id);      // mutation: drop the .is("assigned_to", null) guard -> FAILS
    } finally { await cleanup(db); }
  }));
});
```

- [ ] **Step 2: Run red.** `pnpm --filter @bis/db exec vitest run src/test/assignment.test.ts src/test/team.test.ts`. Expected: `Failed to resolve import "../assignment"` and the technician `roleFromClerk` cases failing with `staff`. Paste both.

- [ ] **Step 3: Implement `team.ts` changes.**

```ts
export type AccountRole = "owner" | "staff" | "technician";
const ROLES: readonly string[] = ["owner", "staff", "technician"];
/** Higher is more access. roleFromClerk answers the LOWEST rank any source gives (spec §6). */
const RANK: Record<AccountRole, number> = { technician: 0, staff: 1, owner: 2 };

export function roleFromClerk(input: { clerkRole: string; membershipMeta?: unknown; invitationMeta?: unknown }): AccountRole {
  const answers: AccountRole[] = [input.clerkRole === "org:admin" ? "owner" : "staff"];
  for (const meta of [input.membershipMeta, input.invitationMeta]) {
    const r = field(meta, "bis_role");
    if (typeof r === "string" && ROLES.includes(r)) answers.push(r as AccountRole);
  }
  return answers.reduce((low, a) => (RANK[a] < RANK[low] ? a : low));
}
```

Update the doc comment above it: "the LEAST privileged answer of all sources; stale metadata can only ever demote." In `reconcileMembership`'s `removed` branch (team.ts:217-220), after `deleteAccountMembership`:

```ts
    if (u) {
      await deleteAccountMembership(db, account.id, u.id);
      // Owner ruling A3: what they held goes back to Unassigned. The Team removal records the ids
      // for its Undo; a removal made in Clerk's own screens has no Undo, so nothing is recorded here.
      await releaseMemberAssignments(db, account.id, u.id);
    }
```

(import `releaseMemberAssignments` from `./assignment`).

- [ ] **Step 4: Create `packages/db/src/assignment.ts`.**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";

/**
 * Mine, Unassigned and the Technician (spec §8). Who a customer or a task
 * belongs to. Reads and writes run on whichever client the caller passes:
 * the request client for a person's own action (RLS + 0068 bound it), the
 * service client only for release and its undo (service_role-only RPC).
 */
export type AssigneeFilter = { who: "mine"; userId: string } | { who: "unassigned" };
export type ReleasedAssignments = { contacts: string[]; tasks: string[] };
export type PreviousAssignee = { contactId: string; assignee: string | null };

/** The caller's own users.id. Null for a person with no users row (the agency, A5). */
export async function readPersonId(db: SupabaseClient, clerkUserId: string): Promise<string | null> {
  const { data, error } = await db.from("users").select("id").eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`readPersonId failed: ${error.message}`);
  return (data?.id as string | undefined) ?? null;
}

/** A new task's default assignee: the customer's, else its author (plan deviation 3). */
export async function taskAssigneeFor(
  db: SupabaseClient, accountId: string, contactId: string | null, authorUserId: string | null,
): Promise<string | null> {
  if (contactId) {
    const { data, error } = await db.from("contacts").select("assigned_to").eq("account_id", accountId).eq("id", contactId).maybeSingle();
    if (error) throw new Error(`taskAssigneeFor failed: ${error.message}`);
    const owner = (data?.assigned_to as string | null | undefined) ?? null;
    if (owner) return owner;
  }
  return authorUserId;
}

/** A5: only a member of THIS company can hold a customer or a task. */
async function assertMember(db: SupabaseClient, accountId: string, userId: string): Promise<void> {
  const { data, error } = await db.from("memberships").select("id")
    .eq("scope", "account").eq("account_id", accountId).eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`assignment: membership check failed: ${error.message}`);
  if (!data) throw new Error("assignment: the assignee is not a member of this account");
}

/**
 * Sets each contact's assignee and moves that contact's OPEN tasks that were
 * the previous assignee's along with it (A4). Returns what each contact had,
 * which is exactly what an Undo passes back (one call per previous assignee).
 */
export async function assignContacts(
  db: SupabaseClient, accountId: string, contactIds: readonly string[], assignee: string | null, actorId: string,
): Promise<PreviousAssignee[]> {
  if (contactIds.length === 0) return [];
  if (assignee !== null) await assertMember(db, accountId, assignee);
  const { data, error } = await db.from("contacts").select("id, assigned_to").eq("account_id", accountId).in("id", [...contactIds]);
  if (error) throw new Error(`assignContacts read failed: ${error.message}`);
  const previous = ((data ?? []) as { id: string; assigned_to: string | null }[])
    .map((r) => ({ contactId: r.id, assignee: r.assigned_to }));
  const changing = previous.filter((p) => p.assignee !== assignee);
  if (changing.length === 0) return previous;
  const { error: upErr } = await db.from("contacts")
    .update({ assigned_to: assignee, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).in("id", changing.map((p) => p.contactId));
  if (upErr) throw new Error(`assignContacts failed: ${upErr.message}`);
  for (const p of changing) {
    let q = db.from("tasks").update({ assigned_to: assignee })
      .eq("account_id", accountId).eq("contact_id", p.contactId).is("completed_at", null);
    q = p.assignee === null ? q.is("assigned_to", null) : q.eq("assigned_to", p.assignee);
    const { error: tErr } = await q;
    if (tErr) throw new Error(`assignContacts task move failed: ${tErr.message}`);
    await emit(db, accountId, "contact.assigned", actorId, { contactId: p.contactId, from: p.assignee, to: assignee });
  }
  return previous;
}

export async function setTaskAssignee(
  db: SupabaseClient, accountId: string, taskId: string, assignee: string | null, actorId: string,
): Promise<{ previous: string | null } | "not_found"> {
  const { data, error } = await db.from("tasks").select("assigned_to").eq("account_id", accountId).eq("id", taskId).maybeSingle();
  if (error) throw new Error(`setTaskAssignee read failed: ${error.message}`);
  if (!data) return "not_found";
  if (assignee !== null) await assertMember(db, accountId, assignee);
  const { error: upErr } = await db.from("tasks").update({ assigned_to: assignee }).eq("account_id", accountId).eq("id", taskId);
  if (upErr) throw new Error(`setTaskAssignee failed: ${upErr.message}`);
  await emit(db, accountId, "task.assigned", actorId, { taskId, from: data.assigned_to ?? null, to: assignee });
  return { previous: (data.assigned_to as string | null) ?? null };
}

/** 0068's service_role-only release. Pass serviceDb(). */
export async function releaseMemberAssignments(db: SupabaseClient, accountId: string, userId: string): Promise<ReleasedAssignments> {
  const { data, error } = await db.rpc("release_member_assignments", { p_account_id: accountId, p_user_id: userId });
  if (error) throw new Error(`releaseMemberAssignments failed: ${error.message}`);
  const j = (data ?? {}) as { contacts?: unknown; tasks?: unknown };
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { contacts: ids(j.contacts), tasks: ids(j.tasks) };
}

/** The removal's Undo: gives back only what nobody has picked up since. Pass serviceDb(). */
export async function reassignReleased(db: SupabaseClient, accountId: string, userId: string, released: ReleasedAssignments): Promise<void> {
  if (released.contacts.length > 0) {
    const { error } = await db.from("contacts").update({ assigned_to: userId })
      .eq("account_id", accountId).in("id", released.contacts).is("assigned_to", null);
    if (error) throw new Error(`reassignReleased contacts failed: ${error.message}`);
  }
  if (released.tasks.length > 0) {
    const { error } = await db.from("tasks").update({ assigned_to: userId })
      .eq("account_id", accountId).in("id", released.tasks).is("assigned_to", null).is("completed_at", null);
    if (error) throw new Error(`reassignReleased tasks failed: ${error.message}`);
  }
}
```

Read `emit`'s real signature in `packages/db/src/events.ts` before calling it (rule 1); the call above passes `(db, accountId, type, actorId, payload)` with the default actor type.

- [ ] **Step 5: Exports** in `packages/db/src/index.ts`, one additive block:

```ts
export {
  readPersonId, taskAssigneeFor, assignContacts, setTaskAssignee, releaseMemberAssignments, reassignReleased,
  type AssigneeFilter, type ReleasedAssignments, type PreviousAssignee,
} from "./assignment";
```

- [ ] **Step 6: Run green** with Step 2's command. Paste the summary line. Then run `pnpm --filter web typecheck` and list every error the wider `AccountRole` causes in `apps/web` (expected: `ROLE_PILL` in `components/team/team-copy.ts` is missing `technician`, and any exhaustive `Record<AccountRole, …>`). Do NOT fix them here: Task 4 owns them. Paste the list into the report so Task 4's implementer starts from it.

- [ ] **Step 7: Mutation probes** as named in the test titles. Paste each failing name, revert.

- [ ] **Step 8: Commit.** `feat(db): technician role ordering, assignment core, release on Clerk-side removal (mine/unassigned)`, explicit paths only.

---

## Task 3: `@bis/db` list filters and writer parameters

**Owner:** bis-crm. **Review:** sonnet. **Parallel with Task 4**, after Task 2.

**Files**
- Modify: `packages/db/src/contacts.ts` (`listContacts`, `countContacts`, `ContactInput`/`toRow`, `createContact`'s `flagDb`, new `flagMatchesOf`)
- Modify: `packages/db/src/messaging.ts` (`listConversations`)
- Modify: `packages/db/src/work-queue.ts` (`listAccountWork` and its three readers)
- Modify: `packages/db/src/activities.ts` (`addTask` `assignedTo`; `completeTask` and `holdOpenTaskIds` gain `ledger`)
- Modify: `packages/db/src/index.ts` only if `flagMatchesOf` is not exported through an existing `contacts` export line (add it to that line)
- Test: `packages/db/src/test/assignee-filters.test.ts` (create)

**Interfaces**
- Consumes: `AssigneeFilter` (Task 2).
- Produces:

```ts
export async function listContacts(db, accountId, opts?: { search?: string; limit?: number; before?: ContactCursor; sort?: ContactSort; assignee?: AssigneeFilter });
export async function countContacts(db, accountId, opts?: { search?: string; assignee?: AssigneeFilter }): Promise<number>;
export async function listConversations(db, accountId, opts?: { limit?: number; before?: ConversationCursor; assignee?: AssigneeFilter }): Promise<ConversationSummary[]>;
export async function listAccountWork(db: SupabaseClient, accountId: string, opts?: { assignee?: AssigneeFilter }): Promise<WorkRow[]>;
export type ContactInput = { …existing; assignedTo?: string | null };
export async function createContact(db, accountId, input: ContactInput, actorId: string, actorType?: ActorType, flagDb?: SupabaseClient): Promise<{ id: string; existing: boolean; flagged: boolean }>;
export async function flagMatchesOf(db: SupabaseClient, accountId: string, contactId: string): Promise<number>; // pairs written, reason "hidden_match"
export async function addTask(db, accountId, input: { contactId?: string; title: string; dueAt?: string; assignedTo?: string | null }, actorId: string, actorType?: ActorType): Promise<{ id: string }>;
export async function completeTask(db, accountId, taskId, actorId, actorType?: ActorType, ledger?: SupabaseClient): Promise<void>;
export async function holdOpenTaskIds(db, accountId, tasks, ledger?: SupabaseClient): Promise<string[]>;
```

- [ ] **Step 1: Failing test** `packages/db/src/test/assignee-filters.test.ts` (`withTestAccount`, service client; seed `users` rows with a `RUN` suffix and delete them in `finally` the way `assignment.test.ts` does):
  - `listContacts`/`countContacts` with `{ who: "mine", userId: a }` return only A's contacts; `{ who: "unassigned" }` only NULL ones; no `assignee` returns all three; a `before` cursor with `who` set pages within the filtered set (two pages of `limit: 1`, union equals the filtered set). Mutation: drop the filter in `countContacts` only, and the total case fails.
  - `listConversations` with `mine` returns only conversations whose contact is A's (mutation: `contacts(...)` instead of `contacts!inner(...)` returns every row with a null embed -> FAILS).
  - `listAccountWork` with `mine` returns A's open tasks (by the TASK's assignee, even on someone else's customer), and the conversation and booking rows of A's customers; with `unassigned`, tasks with no assignee and rows of Unassigned customers.
  - `createContact(..., { firstName: "W", assignedTo: a }, "user_test")` stores `assigned_to = a`.
  - `flagMatchesOf`: a contact whose phone equals another contact's writes one `contact_duplicate_flags` row with reason `hidden_match`; a second call writes none (23505 is the designed no-op) and returns 0.
  - `addTask` with `assignedTo` stores it.

- [ ] **Step 2: Run red.** `pnpm --filter @bis/db exec vitest run src/test/assignee-filters.test.ts`. Expected: type errors surface as runtime failures, e.g. `expected 3 to be 1` on the first `mine` count. Paste it.

- [ ] **Step 3: Implement.**

```ts
// contacts.ts — one helper both list and count use, so they can never disagree.
function withAssignee<T>(q: T, assignee: AssigneeFilter | undefined): T {
  if (!assignee) return q;
  const f = q as unknown as { eq: (c: string, v: string) => T; is: (c: string, v: null) => T };
  return assignee.who === "mine" ? f.eq("assigned_to", assignee.userId) : f.is("assigned_to", null);
}
// listContacts: after `q = withSearch(q, opts.search);` add `q = withAssignee(q, opts.assignee);`
// countContacts: after `q = withSearch(q, opts.search);` add `q = withAssignee(q, opts.assignee);`
// toRow(input): add `...(input.assignedTo !== undefined ? { assigned_to: input.assignedTo } : {})`
// createContact: new trailing parameter `flagDb: SupabaseClient = db`; BOTH flag inserts (the
// email_phone_conflict insert and both flagDuplicatePair calls) use flagDb instead of db.

/**
 * After a Technician adds a customer (owner ruling §13.3): pairs it with any
 * OTHER contact in the account sharing its email_key or phone_key, reason
 * "hidden_match", so the Owner's duplicates queue sees what the Technician's
 * RLS-bound lookup could not. Pass serviceDb(). Returns the pairs written.
 */
export async function flagMatchesOf(db: SupabaseClient, accountId: string, contactId: string): Promise<number> {
  const { data: me, error } = await db.from("contacts").select("email_key, phone_key").eq("account_id", accountId).eq("id", contactId).maybeSingle();
  if (error) throw new Error(`flagMatchesOf read failed: ${error.message}`);
  if (!me) return 0;
  const ors = [me.email_key ? `email_key.eq.${quoteFilterValue(String(me.email_key))}` : null,
               me.phone_key ? `phone_key.eq.${quoteFilterValue(String(me.phone_key))}` : null].filter(Boolean);
  if (ors.length === 0) return 0;
  const { data: hits, error: hErr } = await db.from("contacts").select("id").eq("account_id", accountId).neq("id", contactId).or(ors.join(",")).limit(20);
  if (hErr) throw new Error(`flagMatchesOf lookup failed: ${hErr.message}`);
  let written = 0;
  for (const h of (hits ?? []) as { id: string }[]) {
    const [a, b] = [contactId, h.id].sort();
    const { error: fErr } = await db.from("contact_duplicate_flags").insert({ account_id: accountId, contact_a: a, contact_b: b, reason: "hidden_match" });
    if (!fErr) written += 1;
    else if (fErr.code !== "23505") console.error(`contact duplicate flag (hidden_match) for account ${accountId} not recorded: code ${fErr.code ?? "none"}`);
  }
  return written;
}
```

`quoteFilterValue` already exists in `contacts.ts` (used by `listContacts`); read it before use. `email_key`/`phone_key` are 0033's stored columns.

```ts
// messaging.ts — listConversations: the embed becomes inner only when filtering, so the unfiltered
// inbox is byte-for-byte today's query.
  const embed = opts.assignee ? "contacts!inner(first_name, last_name, assigned_to)" : "contacts(first_name, last_name)";
  let q = db.from("conversations")
    .select(`id, contact_id, last_message_at, unread_count, ${embed}`)
    .eq("account_id", accountId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (opts.assignee?.who === "mine") q = q.eq("contacts.assigned_to", opts.assignee.userId);
  if (opts.assignee?.who === "unassigned") q = q.is("contacts.assigned_to", null);
```

```ts
// work-queue.ts
export async function listAccountWork(db: SupabaseClient, accountId: string, opts: { assignee?: AssigneeFilter } = {}): Promise<WorkRow[]> {
  const [tasks, convos, bookings] = await Promise.all([
    openTasks(db, accountId, opts.assignee),
    unansweredConversations(db, accountId, opts.assignee),
    staleBookings(db, accountId, opts.assignee),
  ]);
  // …unchanged suppression and return
}
// openTasks: after `.is("completed_at", null)` apply the TASK's own assignee:
//   a?.who === "mine" ? q.eq("assigned_to", a.userId) : a?.who === "unassigned" ? q.is("assigned_to", null) : q
// unansweredConversations and staleBookings: when `a` is set, select with `contacts!inner(assigned_to)`
// and filter `contacts.assigned_to` exactly as listConversations does; unfiltered, today's select.
```

```ts
// activities.ts
//   addTask: insert gains `assigned_to: input.assignedTo ?? null`.
//   completeTask: new trailing `ledger: SupabaseClient = db`; `holdStillOpen(ledger, accountId, eventId)`.
//   holdOpenTaskIds: new trailing `ledger: SupabaseClient = db`, passed to its consent reads.
//   Every existing caller keeps today's behaviour, because the default is `db`.
```

- [ ] **Step 4: Run green**, plus the neighbours that exercise the changed functions:

```
pnpm --filter @bis/db exec vitest run src/test/assignee-filters.test.ts src/test/contacts.test.ts src/test/contact-dedupe-keys.test.ts src/test/messaging.test.ts src/test/work-queue.test.ts src/test/activities.test.ts src/test/consent-tasks-live.test.ts
```

Paste the summary line. (If a named file does not exist, drop it from the command and say so.)

- [ ] **Step 5: Mutation probes** as named in Step 1. Paste each failing name, revert.

- [ ] **Step 6: Commit.** `feat(crm): Mine/Unassigned filters on contacts, conversations and To do; task assignee; hidden-match flags`, explicit paths only.

---

## Task 4: Auth and route guards, nav, palette, shell, Team role

**Owner:** bis-platform. **Review:** opus. **Parallel with Task 3**, after Task 2.

**Files**
- Modify: `apps/web/src/lib/auth.ts` (`requireNotTechnician`, `accountHome`, the two redirects)
- Modify: `apps/web/src/lib/nav-groups.ts`, `apps/web/src/lib/palette/registry.ts`, `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/components/command-palette.tsx`, `apps/web/src/app/(dashboard)/dashboard/layout.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/shell-actions.ts`, `apps/web/src/components/topbar-presence.tsx`
- Modify (first line `await requireNotTechnician(accountId)`): pages `dashboard/page.tsx`, `activity/page.tsx`, `pipeline/page.tsx`, `website/page.tsx`, `forms/page.tsx`, `forms/[formId]/page.tsx`, `contacts/import/page.tsx`, `branding/page.tsx`; actions `pipeline/actions.ts` (3), `forms/actions.ts` (3), `contacts/import/actions.ts` (1), `branding/actions.ts` (3) — all under `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`
- Modify: `calls/page.tsx` (hide the daily-limit line for a Technician)
- Modify: `apps/web/src/lib/team/team-view.ts` (`isAccountRole`), `apps/web/src/components/team/team-copy.ts` (`ROLE_PILL.technician`), `apps/web/src/components/team/team-card.tsx` (role selects list three roles), `team/actions.ts` (demotion branch, removal release and undo), `apps/web/src/lib/team/removal-log.ts` (`released`)
- Modify: `apps/web/src/lib/messages.ts` (two keys, below)
- Tests: `apps/web/src/lib/auth.test.ts`, `apps/web/src/lib/nav-groups.test.ts`, `apps/web/src/lib/palette/registry.test.ts`, `shell-actions.test.ts`, `team/actions.test.ts`, `apps/web/src/lib/team/removal-log.test.ts` (create if absent), `apps/web/src/components/team/team-card.test.ts`, plus `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/technician-guards.test.ts` (create)

**Interfaces**
- Consumes: `AccountRole` incl. `"technician"`, `releaseMemberAssignments`, `reassignReleased`, `ReleasedAssignments` (Task 2).
- Produces:

```ts
// lib/auth.ts
export function accountHome(accountId: string, role: AccountRole | null): string; // …/tasks for a technician, …/dashboard otherwise
export async function requireNotTechnician(accountId: string): Promise<{ userId: string; isAgency: boolean; role: AccountRole | null; canManage: boolean }>;
// lib/nav-groups.ts / lib/palette/registry.ts — a 4th parameter, default false
export function buildNavGroups(base: string | null, isAgency: boolean, isOwner: boolean, isTechnician?: boolean): NavGroupSpec[];
export function buildPaletteEntries(base: string | null, isAgency: boolean, isOwner: boolean, isTechnician?: boolean): PaletteEntry[];
// shell-actions.ts
export type ShellSnapshot = { …; presence: (VoicePresence & { personaName: string; showCount: boolean }) | null };
// lib/team/removal-log.ts
export type RemovalRecord = { userId: string; clerkUserId: string; role: AccountRole; language: PersonLanguage | null; released?: ReleasedAssignments };
```

- [ ] **Step 1: Failing tests.**
  - `lib/auth.test.ts` (existing mocks of `@clerk/nextjs/server`, `next/navigation` with `redirect` throwing `REDIRECT:<url>`, `@bis/db`, `./team/ensure-role`): a client whose `ensureAccountRole` resolves `"technician"`: `requireNotTechnician("a1")` rejects with `REDIRECT:/dashboard/accounts/a1/tasks` (mutation: redirect to `/dashboard` -> FAILS); Owner and Staff and the agency pass through with the same object `requireAccountAccess` returns; `requireAccountOwner` for a Technician rejects with `REDIRECT:/dashboard/accounts/a1/tasks`; `requireAgencyOnlyAccountAccess` likewise; `accountHome("a1", "technician")` is `/dashboard/accounts/a1/tasks` and `accountHome("a1", "staff")` and `(…, null)` are `…/dashboard`.
  - `technician-guards.test.ts`: a source scan, the house pattern for guard tests. For each of the eight pages and ten actions listed in Files, read the file and assert its default export (page) or each named action's body calls `requireNotTechnician(accountId)` before the first `dbForRequest(`/`serviceDb(`/`await ` of anything else; and assert `tasks/page.tsx`, `contacts/page.tsx`, `conversations/page.tsx`, `calendar/page.tsx`, `calls/page.tsx` do NOT call it (so a Technician's home can never refuse them: the loop guard). Mutation: remove the call from `branding/actions.ts`'s `removeBrandLogoAction` -> FAILS naming it.
  - `nav-groups.test.ts`: `buildNavGroups(base, false, false, true)` hrefs equal exactly `[tasks, contacts, conversations, calls, calendar]` in the groups' existing order (no dashboard, website, pipeline, activity, forms, branding, billing). Owner and Staff output is unchanged from today (snapshot of the hrefs taken BEFORE the change, pasted into the test). Mutation: leave `website` in for a Technician -> FAILS.
  - `palette/registry.test.ts`: `buildPaletteEntries(base, false, false, true)` contains no `nav:` entry for a refused route and no Team entry; it still contains `nav:preferences`.
  - `shell-actions.test.ts`: for a Technician, `sumUnreadCount` is called with the request client (mock `@/lib/db`'s `dbForRequest` returning a sentinel and assert the first argument is that sentinel) and `presence.showCount` is false; for Staff, `showCount` is true and the service client is used as today.
  - `team/actions.test.ts`: `setTeamRoleAction(acct, user, "technician")` from an Owner takes the demotion path (Clerk `setOrganizationRole(…, "technician")` FIRST, then `setAccountMemberRole(…, "technician")`) (mutation: `if (role === "staff")` left as is -> the promotion path runs and the order assertion FAILS); `removeTeamMemberAction` calls `releaseMemberAssignments(serviceDb, acct, user)` AFTER `removeAccountMember` returns `ok` and records `released` in the removal; `undoRemoveTeamMemberAction` calls `reassignReleased` with the recorded ids after the membership is back; a release that throws is logged and the removal still returns `ok: true`.
  - `removal-log.test.ts`: `latestRemoval` parses `released` when it is `{ contacts: string[]; tasks: string[] }` and returns `released: { contacts: [], tasks: [] }` for an old record without it.
  - `team-card.test.ts`: the invite role select and each member's role select list `technician` with `m["team.role.technician"]`; selecting it shows the help line `m["team.roleHelp.technician"]`.

- [ ] **Step 2: Run red.**

```
pnpm --filter web exec vitest run src/lib/auth.test.ts src/lib/nav-groups.test.ts src/lib/palette/registry.test.ts src/lib/team/removal-log.test.ts src/components/team/team-card.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/technician-guards.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/shell-actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/team/actions.test.ts"
```

Expected: `requireNotTechnician is not a function` (auth), and the scan naming the first unguarded file. Paste both.

- [ ] **Step 3: Implement `lib/auth.ts`.**

```ts
/** Where a person lands inside an account: To do for a Technician (spec §9), the dashboard otherwise. */
export function accountHome(accountId: string, role: AccountRole | null): string {
  return `/dashboard/accounts/${accountId}/${role === "technician" ? "tasks" : "dashboard"}`;
}

/**
 * The surfaces a Technician does not work on (spec §7.1, plan deviation 1):
 * Dashboard, Activity, Pipeline, Website, Forms, Import and Branding, and
 * every action they post. Sends a Technician to their home, never a 403
 * (requireAccountAccess's reason). The database already refuses their reads
 * of other people's customers (0068); this keeps them out of screens whose
 * totals and settings are not theirs.
 */
export async function requireNotTechnician(accountId: string) {
  const access = await requireAccountAccess(accountId);
  if (access.role === "technician") redirect(accountHome(accountId, access.role));
  return access;
}
```

and in `requireAccountOwner` / `requireAgencyOnlyAccountAccess`, destructure `role` and `redirect(accountHome(accountId, role))` instead of the literal `/dashboard` URL. `auth.ts:53` is unchanged (plan deviation 2).

- [ ] **Step 4: Implement nav, palette, layout, sidebar.**
  - `buildNavGroups(base, isAgency, isOwner, isTechnician = false)`: when `isTechnician` (and `base !== null`), return exactly:

```ts
    return [
      { label: "nav.group.overview", items: [{ href: `${base}/tasks`, labelKey: "nav.tasks", iconKey: "tasks" }] },
      { label: "nav.group.crm", items: [{ href: `${base}/contacts`, labelKey: "nav.contacts", iconKey: "contacts" }] },
      { label: "nav.group.communications", items: [
        { href: `${base}/conversations`, labelKey: "nav.conversations", iconKey: "conversations" },
        { href: `${base}/calls`, labelKey: "nav.calls", iconKey: "calls" },
      ] },
      { label: "nav.group.growth", items: [{ href: `${base}/calendar`, labelKey: "nav.calendar", iconKey: "calendar" }] },
    ];
```

    placed before today's `return [...]`, with a comment pointing at spec §9 and saying hiding is convenience; `requireNotTechnician` is the boundary.
  - `buildPaletteEntries(base, isAgency, isOwner, isTechnician = false)` passes it to `buildNavGroups`, and the Team entry stays `isOwner`-only (a Technician is never an Owner).
  - `(dashboard)/dashboard/layout.tsx:159`: keep the role instead of collapsing it: `.then((role) => role)`; derive `const isOwner = role === "owner"; const isTechnician = role === "technician";` and pass `isTechnician` to `AppSidebar` and `CommandPalette` beside `isOwner`.
  - `AppSidebar` and `CommandPalette` gain `isTechnician: boolean` props and forward them. The sidebar footer renders nothing role-specific for a Technician (no Team link: that is `isOwner`; no setup meter: that is the agency's).

- [ ] **Step 5: Implement the shell snapshot.**

```ts
export async function getShellSnapshot(accountId: string): Promise<ShellSnapshot> {
  const { isAgency, role } = await requireAccountAccess(accountId);
  const db = serviceDb();
  const technician = role === "technician";
  // Spec §7.2: the unread badge counts a Technician's OWN conversations, which only RLS knows.
  const unreadDb = technician ? await dbForRequest() : db;
  const [unreadTotal, setup, presence] = await Promise.all([
    readUnreadTotal(unreadDb, accountId),
    readSetupProgress(db, accountId, isAgency),
    readPresence(db, accountId),
  ]);
  return { unreadTotal, setup, presence: presence ? { ...presence, showCount: !technician } : null };
}
```

`readUnreadTotal`'s parameter type widens to `SupabaseClient`. `topbar-presence.tsx`: when `!presence.showCount && !presence.onCall`, render nothing; the on-a-call pulse is unchanged.

- [ ] **Step 6: Implement the refused routes.** Each of the eight pages and ten actions in Files gets `await requireNotTechnician(accountId)` as its first statement, replacing an existing `requireAccountAccess(accountId)` call where there is one and keeping the destructured names it used (`requireNotTechnician` returns the same object). `calls/page.tsx`: destructure `role`, and when it is `"technician"` skip `countCallsSince` and do not render the daily-limit line.

- [ ] **Step 7: Implement the Team role.**
  - `team-view.ts:61`: `export const isAccountRole = (v: unknown): v is AccountRole => v === "owner" || v === "staff" || v === "technician";`
  - `team-copy.ts`: `technician: { label: m["team.role.technician"], dot: "bg-muted-foreground/30", chip: "border-border bg-transparent text-foreground" },` (tokens only; dot + word, rule 3).
  - `team-card.tsx:148` and `:256`: the arrays become `(["owner", "staff", "technician"] as const)` and `(["staff", "technician", "owner"] as const)`; when the chosen value is `technician`, render `<p className="text-muted-foreground text-xs">{m["team.roleHelp.technician"]}</p>` under the select.
  - `team/actions.ts:149`: `if (role === "staff")` becomes `if (role !== "owner")`, and every literal `"staff"` inside that branch becomes `role` (Clerk then BIS, then the repeat Clerk write). Read `setOrganizationRole` (`lib/team/clerk-team.ts:248`) first: it maps through `clerkRoleFor` (any non-Owner role is `org:member`) AND writes `bis_role` metadata (`:235`), which `roleFromClerk` reads if the BIS row is ever lost. So the promotion branch's set-back at `:204` must not write a role more privileged than BIS holds: it becomes `setOrganizationRole(account.orgId, member.clerkUserId, now === "staff" || now === "technician" ? now : "technician")` (a removed or unreadable person gets the least privileged metadata; less access is the safe error). The demotion branch's `putClerkBack` keeps `previous`.
  - `removeTeamMemberAction`: after `removeAccountMember` returns `ok` and the Clerk removal succeeded, `let released: ReleasedAssignments | undefined; try { released = await releaseMemberAssignments(db, accountId, userId); } catch (e) { console.error(\`team: assignments not released (${ids}): ${loggableError(e)}\`); }` and pass `released` into `recordRemoval`. After the post-removal sweep, if `released` is undefined, try the release once more (idempotent; logged on failure).
  - `undoRemoveTeamMemberAction`: after the BIS membership and language are restored, `if (removed.released) await reassignReleased(db, accountId, userId, removed.released);` inside the same try.
  - `removal-log.ts`: `recordRemoval` writes `released: r.released ?? { contacts: [], tasks: [] }` into the payload; `latestRemoval` returns `released` when both members are string arrays (every element a UUID-shaped string), else `{ contacts: [], tasks: [] }`.

- [ ] **Step 8: Copy** in `apps/web/src/lib/messages.ts`, beside the other `team.role.*` keys:

```ts
  "team.role.technician": "Technician",
  "team.role.technician.es": "Técnico",
  "team.roleHelp.technician": "Sees only the customers you assign to them.",
  "team.roleHelp.technician.es": "Solo ve los clientes que usted le asigne.",
```

- [ ] **Step 9: Run green** with Step 2's command, plus `pnpm --filter web typecheck` (the Task 2 list of `AccountRole` errors must now be empty). Every module that gained a new `@bis/db` import (`team/actions.ts`: `releaseMemberAssignments`, `reassignReleased`) needs its factory mocks updated: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "team/actions"`. Paste the summary lines.

- [ ] **Step 10: Mutation probes** as named. Paste each failing name, revert.

- [ ] **Step 11: Commit.** `feat(auth): Technician routes, nav and shell; Technician on the Team screen; removal releases assignments`, explicit paths only.

---

## Task 5a: Calendar service-write guards

**Owner:** bis-booking. **Review:** opus. **Parallel with Task 5b**, after Tasks 3 and 4.

**Files**
- Create: `apps/web/src/lib/auth/visible.ts`, `apps/web/src/lib/auth/visible.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.ts` (`setBookingStatusAction`, `cancelNoticeOptionAction`, `cancelBookingAction`, `undoCancelBookingAction`)
- Test: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.test.ts`

**Interfaces**
- Produces:

```ts
// lib/auth/visible.ts
export type ProvableTable = "bookings" | "conversations";
/** True when the CALLER's own client (RLS + 0068) can see this row in this account. */
export async function callerCanSee(table: ProvableTable, accountId: string, id: string): Promise<boolean>;
```

- [ ] **Step 1: Failing tests.**
  - `visible.test.ts` (mock `@/lib/db`'s `dbForRequest` with a chainable fake): returns true when the `select("id").eq("account_id", a).eq("id", id).maybeSingle()` read returns a row, false on `null`, and throws on a read error (fail closed: a caller cannot write on "could not tell"). Mutation: return true on error -> FAILS.
  - `calendar/actions.test.ts`: for each of the four actions, when `callerCanSee("bookings", acct, bookingId)` resolves false (mock `@/lib/auth/visible`), the action returns `{ ok: false, error: m["calendar.bookings.statusUpdateFailed"] }` and `setBookingStatus`, `undoOperatorCancel`, `queueCancelNotice` and `cancelNoticeAvailability` are NOT called; when true, today's behaviour. Mutation: put the check after `setBookingStatus` in `cancelBookingAction` -> the "not called" assertion FAILS.

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/auth/visible.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.test.ts"`. Expected: `Failed to resolve import "@/lib/auth/visible"`. Paste it.

- [ ] **Step 3: Implement.**

```ts
// lib/auth/visible.ts
import { dbForRequest } from "@/lib/db";

/**
 * Spec §7.3: "prove the target through the request client, then write through
 * the service client". RLS does not bind serviceDb(), so a server action that
 * writes with it must first see the row with the caller's own token. Under
 * 0068 a Technician cannot see another person's booking or conversation, so
 * the proof fails with no role branching. Throws on a read error: "could not
 * tell" is never "allowed".
 */
export type ProvableTable = "bookings" | "conversations";
export async function callerCanSee(table: ProvableTable, accountId: string, id: string): Promise<boolean> {
  const db = await dbForRequest();
  const { data, error } = await db.from(table).select("id").eq("account_id", accountId).eq("id", id).maybeSingle();
  if (error) throw new Error(`callerCanSee(${table}) failed: ${error.message}`);
  return data !== null;
}
```

In each of the four calendar actions, directly after its `requireAccountAccess(accountId)` line:

```ts
  try {
    if (!(await callerCanSee("bookings", accountId, bookingId))) return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  } catch (e) {
    console.error(`<actionName>: booking ${bookingId} could not be proven (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };
  }
```

(with the action's real name in the log line). The notice reads at `calendar/actions.ts:342` and `:359` act on a message of the proven booking, so they are covered by `undoCancelBookingAction`'s proof. `tasks/actions.ts`'s `closeOutBooking` delegates to `setBookingStatusAction` and inherits it.

- [ ] **Step 4: Run green** with Step 2's command; then the neighbours that call these actions: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar"`. Paste both summaries.

- [ ] **Step 5: Mutation probe** as named. **Step 6: Commit.** `feat(booking): calendar actions prove the booking through the caller's own client before a service write`.

---

## Task 5b: Conversation guard, consent display reads, the `serviceDb` guard test

**Owner:** bis-comms. **Review:** opus. **Parallel with Task 5a**, after Tasks 3 and 4.

**Files**
- Create: `apps/web/src/lib/consent/ledger-db.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts` (`markConversationReadAction`)
- Modify (ledger client for consent DISPLAY reads): `contacts/[contactId]/page.tsx` (lines 49, 53, 66, 77, 90), `calls/[callId]/page.tsx:118`, `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.ts:27`, `…/email/route.ts:26`, `apps/web/src/lib/consent/staff-actions.ts:57`, `apps/web/src/lib/consent/email-staff-actions.ts:38`, `tasks/actions.ts` (line 202 and `completeWorkTask`)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts`
- Tests: `conversations/actions.test.ts`, `contacts/[contactId]/page.test.ts`, `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.test.ts`, `…/email/route.test.ts`, `tasks/actions.test.ts`

**Interfaces**
- Consumes: `callerCanSee` (Task 5a's file; if 5a has not landed, import path `@/lib/auth/visible` is the contract and 5b stubs it in tests), `completeTask(..., ledger)` and `holdOpenTaskIds(..., ledger)` (Task 3).
- Produces:

```ts
// lib/consent/ledger-db.ts
/** The client consent DISPLAY reads use, AFTER the contact was proven through RLS (spec §7.3). */
export function ledgerDb(): SupabaseClient;
```

- [ ] **Step 1: Failing tests.**
  - `conversations/actions.test.ts`: `markConversationReadAction(acct, conv)` with `callerCanSee("conversations", …)` false does not call `clearUnreadCount` (mutation: drop the check -> FAILS).
  - `contacts/[contactId]/page.test.ts`: `smsRecipientState`, `emailRecipientState`, `readTextsView`, `readEmailView` and `holdOpenTaskIds`' fourth argument receive the `ledgerDb()` sentinel, not the request client, and only AFTER `getContact` returned a row; when `getContact` returns null, none of them is called and the page calls `notFound()` (mutation: pass `db` to `readTextsView` -> FAILS).
  - texts and email routes: same, the view read receives the ledger client after `getContact` succeeds; a null contact still answers 404 and reads nothing.
  - `tasks/actions.test.ts`: `completeWorkTask` passes the ledger client as `completeTask`'s sixth argument; the hold check at line 202 reads `readConsentHistory(ctx.writer, …)`.
  - `in-account-service-reads.test.ts` (below) fails on purpose first by asserting against an empty allowlist; write the real allowlist in Step 3.

- [ ] **Step 2: Run red.**

```
pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts" "src/app/api/accounts/[accountId]/contacts/[contactId]/texts/route.test.ts" "src/app/api/accounts/[accountId]/contacts/[contactId]/email/route.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"
```

Expected: `Failed to resolve import "@/lib/consent/ledger-db"`. Paste it.

- [ ] **Step 3: Implement.**

```ts
// lib/consent/ledger-db.ts
import { serviceDb, type SupabaseClient } from "@bis/db";

/**
 * Consent is keyed by ADDRESS, and a STOP can arrive with no contact_id
 * (spec §7.3). Under 0068 a Technician's own token sees only ledger rows
 * whose contact_id is theirs, so a display read on the request client could
 * show "can text" for a number the gate refuses (the gates read through the
 * service client already: conversations/actions.ts passes `writer`).
 *
 * Use ONLY after the contact was read through the caller's own client
 * (getContact on dbForRequest): that read is the authorisation; this client
 * then reads the ledger for that contact's own address. Same answer for
 * Owner and Staff, so every role uses it.
 */
export function ledgerDb(): SupabaseClient {
  return serviceDb();
}
```

- `markConversationReadAction`: after `requireAccountAccess`, `if (!(await callerCanSee("conversations", accountId, conversationId))) return;` (a stale or foreign id is a silent no-op, as today's account-scoped update already is for another account's id).
- `contacts/[contactId]/page.tsx`: `const ledger = ledgerDb();` declared after the `getContact` null check, and passed as the first argument of the four reads and as `holdOpenTaskIds(db, accountId, tasks, ledger)`. Same shape in `calls/[callId]/page.tsx:118` (after its contact read), the texts and email routes (after `getContact`), `staff-actions.ts:57` and `email-staff-actions.ts:38` (`ctx.writer` instead of `ctx.db`), `tasks/actions.ts:202` (`ctx.writer`), and `completeWorkTask` (`completeTask(await dbForRequest(), accountId, taskId, userId, "user", ledgerDb())`).
- `in-account-service-reads.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Spec §7.2's guard: every file in the in-account route trees and lib/ that
 * imports serviceDb is listed here WITH its reason. A new importer fails by
 * name until someone decides which reason it has, so a service-key read of
 * customer data cannot slip past the Technician's RLS unnoticed.
 */
type Reason = "agency-only" | "owner-only" | "configuration" | "proven-target" | "technician-filtered" | "before-trust" | "public-or-cron";
const SRC = join(__dirname, "../../../../..");   // apps/web/src
const ROOTS = ["app/(dashboard)/dashboard/accounts/[accountId]", "app/api/accounts", "lib"];
const IMPORT = /import\s*\{[^}]*\bserviceDb\b[^}]*\}\s*from\s*"(?:@bis\/db|@\/lib\/db)"/s;

const ALLOWED: Record<string, Reason> = {
  "app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/automations/page.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/billing/page.tsx": "owner-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts": "configuration",
  "app/(dashboard)/dashboard/accounts/[accountId]/branding/page.tsx": "configuration",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/cancel-notice.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/calendar/page.tsx": "configuration",
  "app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/checklist/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts": "proven-target",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-section.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/setup/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/shell-actions.ts": "technician-filtered",
  "app/(dashboard)/dashboard/accounts/[accountId]/team/actions.ts": "owner-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/voice/actions.ts": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/voice/page.tsx": "agency-only",
  "app/(dashboard)/dashboard/accounts/[accountId]/website/actions.ts": "agency-only",
  "lib/auth.ts": "before-trust",
  "lib/booking/availability.ts": "public-or-cron",
  "lib/branding/tenant-theme-reader.ts": "configuration",
  "lib/consent/email-context.ts": "proven-target",
  "lib/consent/email-gate.ts": "proven-target",
  "lib/consent/ledger-db.ts": "proven-target",
  "lib/consent/texts-context.ts": "proven-target",
  "lib/preferences/person-prefs.ts": "before-trust",
  "lib/proposals/generate.ts": "public-or-cron",
  "lib/setup/setup-inputs.ts": "agency-only",
  "lib/team/ensure-role.ts": "before-trust",
  "lib/voice/presence.ts": "technician-filtered",
  "lib/voice/tools/registry.ts": "public-or-cron",
  "lib/zone.ts": "configuration",
};

function importers(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) && IMPORT.test(readFileSync(p, "utf8"))) {
        out.push(relative(SRC, p).split(sep).join("/"));
      }
    }
  };
  for (const r of ROOTS) walk(join(SRC, r));
  return out.sort();
}

describe("every serviceDb importer on the in-account surface has a stated reason (spec §7.2)", () => {
  it("no unlisted importer (mutation: import serviceDb into contacts/page.tsx -> FAILS naming it)", () => {
    expect(importers().filter((f) => !(f in ALLOWED))).toEqual([]);
  });
  it("no stale entry (a file that stopped importing it leaves the list)", () => {
    const now = new Set(importers());
    expect(Object.keys(ALLOWED).filter((f) => !now.has(f))).toEqual([]);
  });
});
```

Before trusting the list, re-run the importer scan (it is the test's own `importers()`); the list above was taken on 6ec36839 plus `lib/consent/ledger-db.ts`. Fix any path the scan disagrees with, and justify each reason in one line in the report.

- [ ] **Step 4: Run green** with Step 2's command, plus `pnpm --filter web exec vitest run src/lib/consent "src/app/(dashboard)/dashboard/accounts/[accountId]/calls"`. Update `vi.mock("@bis/db")` factories for any module that newly imports `serviceDb` (only `ledger-db.ts` is new, and the page/route tests should mock `@/lib/consent/ledger-db` instead). Paste the summaries.

- [ ] **Step 5: Mutation probes** as named. **Step 6: Commit.** `feat(sms): consent display reads the ledger after the contact is proven; conversation read guard; serviceDb importer guard`.

---

## Task 6: Assignment server actions, `?who=` parsing, list wiring

**Owner:** bis-crm. **Review:** opus. **Sequential:** after 5a and 5b.

**Files**
- Create: `apps/web/src/lib/assign/who.ts`, `apps/web/src/lib/assign/who.test.ts`
- Modify: `contacts/actions.ts` (`createContactAction`; new `assignContactsAction`, `undoAssignContactsAction`)
- Modify: `contacts/[contactId]/actions.ts` (`addTaskAction` assignee)
- Modify: `tasks/actions.ts` (new `setTaskAssigneeAction`)
- Modify: `calls/[callId]/actions.ts` (an accepted `task` proposal gets `taskAssigneeFor`)
- Modify: `contacts/page.tsx`, `tasks/page.tsx`, `conversations/page.tsx` (read `?who=`, pass the filter, carry it on every pager/sort/export-free link; pass `members`, `canAssign`, `personId` to the components Task 7 renders)
- Tests: `contacts/actions.test.ts`, `contacts/[contactId]/actions.test.ts`, `tasks/actions.test.ts`, `contacts/page.test.ts`, `conversations/page.pagination.test.ts`, `tasks/page.test.ts` (create if absent)

**Interfaces**
- Consumes: `readPersonId`, `assignContacts`, `setTaskAssignee`, `taskAssigneeFor`, `listAccountTeam`, `AssigneeFilter`, `PreviousAssignee` (Task 2); `listContacts`/`countContacts`/`listConversations`/`listAccountWork` `assignee`, `createContact` `flagDb`, `flagMatchesOf`, `addTask` `assignedTo` (Task 3); `accountHome`, role on `requireAccountAccess` (Task 4).
- Produces:

```ts
// lib/assign/who.ts
export type Who = "all" | "mine" | "unassigned";
export function parseWho(raw: string | undefined): Who;                          // anything else -> "all"
export function assigneeFilterFor(who: Who, personId: string | null): AssigneeFilter | undefined; // "mine" with no personId -> undefined (All)
export function withWho(params: Record<string, string>, who: Who): Record<string, string>; // adds who unless "all"
// contacts/actions.ts
export type AssignError = "assign.refused" | "assign.failed" | "assign.customerFirst";
export type AssignResult = { ok: true; previous: PreviousAssignee[] } | { ok: false; error: AssignError };
export async function assignContactsAction(accountId: string, contactIds: string[], assignee: string | null): Promise<AssignResult>;
export async function undoAssignContactsAction(accountId: string, previous: PreviousAssignee[]): Promise<{ ok: true } | { ok: false; error: AssignError }>;
// tasks/actions.ts
export async function setTaskAssigneeAction(accountId: string, taskId: string, assignee: string | null):
  Promise<{ ok: true; previous: string | null } | { ok: false; error: AssignError }>;
```

- [ ] **Step 1: Failing tests.**
  - `who.test.ts`: `parseWho("mine")`, `("unassigned")`, `(undefined)`, `("MINE")`, `("x")` -> `mine`, `unassigned`, `all`, `all`, `all`; `assigneeFilterFor("mine", null)` is undefined (mutation: return `{ who: "mine", userId: "" }` -> FAILS); `withWho({ q: "a" }, "all")` has no `who` key.
  - `contacts/actions.test.ts`:
    - `assignContactsAction` from a Technician returns `{ ok: false, error: "assign.refused" }` and never calls `assignContacts` (mutation: drop the role check -> FAILS);
    - from Staff, calls `assignContacts(requestDb, acct, ids, target, clerkUserId)` and returns its previous list; more than 500 ids -> `assign.failed` without a call; a non-UUID id -> `assign.failed`;
    - an RLS/trigger refusal (`assignContacts` rejects with an error whose message contains `row-level security` or code `42501`) maps to `assign.refused`, anything else to `assign.failed`, logged with `loggableError`;
    - `undoAssignContactsAction` groups `previous` by assignee and calls `assignContacts` once per group;
    - `createContactAction` passes `assignedTo: personId` (the caller's `readPersonId`), and for a Technician passes `serviceDb()` as `flagDb` and then calls `flagMatchesOf(serviceDb(), acct, newId)` (only when `existing` is false); a `flagMatchesOf` failure is logged and the action still returns `created`. For Staff, `flagDb` is the request client and `flagMatchesOf` is not called.
  - `contacts/[contactId]/actions.test.ts`: `addTaskAction` passes `assignedTo: await taskAssigneeFor(db, acct, contactId, personId)`.
  - `tasks/actions.test.ts`: `setTaskAssigneeAction` from a Technician -> `assign.refused`; from Staff, handing a task whose contact is NOT assigned to the target to a member whose role is `technician` -> `assign.customerFirst` with no write (mutation: skip the check -> FAILS); handing a contact-less task to a Technician is allowed; success returns `previous`.
  - Page tests: `contacts/page.tsx` with `searchParams: { who: "mine" }` calls `listContacts` AND `countContacts` with `assignee: { who: "mine", userId: personId }` (both, so the header total stays true); `buildOlderHref`/`buildNewerHref`/`sortHref` outputs carry `who=mine`; for a Technician the filter is NOT passed (their list is already theirs) and `canAssign` is false. Same `who` assertions for `conversations/page.tsx`'s `listConversations` and Older link, and `tasks/page.tsx`'s `listAccountWork`.

- [ ] **Step 2: Run red.**

```
pnpm --filter web exec vitest run src/lib/assign/who.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/page.pagination.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/page.test.ts"
```

Expected: `Failed to resolve import "@/lib/assign/who"`. Paste it.

- [ ] **Step 3: Implement `lib/assign/who.ts`.**

```ts
import type { AssigneeFilter } from "@bis/db";

/** The list filter in the URL (spec §9): `?who=mine|unassigned`, absent = All. */
export type Who = "all" | "mine" | "unassigned";
export function parseWho(raw: string | undefined): Who {
  return raw === "mine" || raw === "unassigned" ? raw : "all";
}
/** "Mine" needs a users row; the agency has none in a client's company (A5), so it reads as All. */
export function assigneeFilterFor(who: Who, personId: string | null): AssigneeFilter | undefined {
  if (who === "unassigned") return { who: "unassigned" };
  if (who === "mine" && personId) return { who: "mine", userId: personId };
  return undefined;
}
export function withWho(params: Record<string, string>, who: Who): Record<string, string> {
  return who === "all" ? params : { ...params, who };
}
```

- [ ] **Step 4: Implement the actions.**

```ts
// contacts/actions.ts
const MAX_ASSIGN = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRefusal = (e: unknown) => /row-level security|42501/.test(String((e as { message?: string; code?: string })?.code ?? "") + " " + String((e as Error)?.message ?? ""));

/** Owner, Staff and the agency assign (spec §8, A2); a Technician never does (M4). The DB refuses them too (0068). */
export async function assignContactsAction(accountId: string, contactIds: string[], assignee: string | null): Promise<AssignResult> {
  const { userId, role } = await requireAccountAccess(accountId);
  if (role === "technician") return { ok: false, error: "assign.refused" };
  if (!Array.isArray(contactIds) || contactIds.length === 0 || contactIds.length > MAX_ASSIGN
      || !contactIds.every((id) => typeof id === "string" && UUID.test(id))
      || !(assignee === null || (typeof assignee === "string" && UUID.test(assignee)))) {
    return { ok: false, error: "assign.failed" };
  }
  try {
    const previous = await assignContacts(await dbForRequest(), accountId, contactIds, assignee, userId);
    revalidatePath(contactsPath(accountId));
    return { ok: true, previous };
  } catch (e) {
    console.error(`assignContactsAction: account ${accountId}: ${loggableError(e)}`);
    return { ok: false, error: isRefusal(e) ? "assign.refused" : "assign.failed" };
  }
}

export async function undoAssignContactsAction(accountId: string, previous: PreviousAssignee[]) {
  const groups = new Map<string | null, string[]>();
  for (const p of Array.isArray(previous) ? previous : []) groups.set(p.assignee, [...(groups.get(p.assignee) ?? []), p.contactId]);
  for (const [assignee, ids] of groups) {
    const r = await assignContactsAction(accountId, ids, assignee);
    if (!r.ok) return { ok: false as const, error: r.error };
  }
  return { ok: true as const };
}
```

`createContactAction`: `const { userId, role } = await requireAccountAccess(accountId); const db = await dbForRequest(); const personId = await readPersonId(db, userId); const technician = role === "technician";` then `createContact(db, accountId, { …, assignedTo: personId }, userId, "user", technician ? serviceDb() : db)` and, when `technician && !result.existing`, `try { await flagMatchesOf(serviceDb(), accountId, result.id); } catch (e) { console.error(\`createContactAction: hidden-match flags not written (account ${accountId}): ${loggableError(e)}\`); }`. This file now imports `serviceDb` (Task 5b's guard test): add `"app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts": "proven-target"` to `ALLOWED` in the same commit, with the reason "flags written by the service client for a row the caller just created".

`setTaskAssigneeAction` (tasks/actions.ts): refuse a Technician; validate UUIDs; when `assignee` is not null, read the team (`listAccountTeam(db, accountId)`), and if the target's role is `technician`, read the task's `contact_id` and that contact's `assigned_to` through the request client; when the task has a contact not assigned to the target, return `assign.customerFirst`. Then `setTaskAssignee(db, accountId, taskId, assignee, userId)`; `"not_found"` -> `assign.failed`; refusal mapping as above; `revalidatePath(tasksPath(accountId))`.

`addTaskAction` and the `task` branch of `acceptProposal`: `assignedTo: await taskAssigneeFor(db, accountId, contactId ?? null, await readPersonId(db, userId))`.

- [ ] **Step 5: Wire the three pages.** Each reads `who` from `searchParams`, resolves `const personId = role === "technician" ? null : await readPersonId(db, userId)`, and passes `assignee: role === "technician" ? undefined : assigneeFilterFor(parseWho(who), personId)` to its list (and, for contacts, to `countContacts` too). `buildNewerHref`, `buildOlderHref` and `sortHref` gain a trailing `who: Who = "all"` and spread `withWho(...)` into their `URLSearchParams`; the conversations Older link does the same. `buildExportHref` is unchanged (export is Owner-only and exports the search, not the filter). Each page loads `members = role === "technician" ? [] : (await listAccountTeam(db, accountId)).map((t) => ({ userId: t.userId, label: t.name ?? t.email, role: t.role }))` and computes `canAssign = role !== "technician"` and `showMine = personId !== null` for Task 7.

- [ ] **Step 6: Run green** with Step 2's command; update `vi.mock("@bis/db")` factories in every test of `contacts/actions.ts`, `contacts/[contactId]/actions.ts`, `tasks/actions.ts`, `calls/[callId]/actions.ts` and the three pages for the new imports (`readPersonId`, `assignContacts`, `setTaskAssignee`, `taskAssigneeFor`, `flagMatchesOf`, `listAccountTeam`): `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -lnE "contacts/actions|tasks/actions|calls/\[callId\]/actions|contacts/page|tasks/page|conversations/page"`. Then run `in-account-service-reads.test.ts` again. Paste the summaries.

- [ ] **Step 7: Mutation probes** as named. **Step 8: Commit.** `feat(contacts): assign customers and tasks, Mine/Unassigned in the URL, hand-added work belongs to its author`.

---

## Task 7: Assignment UI and copy

**Owner:** bis-frontend. **Review:** sonnet. **Sequential:** after Task 6.

**Files**
- Create: `apps/web/src/components/assign/assignee-field.tsx`, `apps/web/src/components/assign/who-filter.tsx`, `apps/web/src/components/assign/assign.test.ts`
- Modify: `contacts/contact-drawer.tsx`, `contacts/[contactId]/page.tsx` + `contacts/[contactId]/contact-fields-panel.tsx` (assignee line), `contacts/bulk-action-bar.tsx` ("Assign to…"), `contacts/contacts-table.tsx` (props through), `contacts/page.tsx`, `tasks/page.tsx` + the To do row component (`dashboard/work-row.tsx` is the dashboard's; find the To do list's row in `tasks/`), `conversations/page.tsx` (render `WhoFilter`; empty states)
- Modify: `apps/web/src/lib/messages.ts` (the `assign.*` keys below)
- Tests: `assign.test.ts`, `contacts/bulk-action-bar.test.ts`, `contacts/contact-drawer.wiring.test.ts`, `contacts/page.test.ts`

**Interfaces**
- Consumes: `assignContactsAction`, `undoAssignContactsAction`, `setTaskAssigneeAction`, `AssignError`, `Who`, `withWho`, page props `members`, `canAssign`, `showMine` (Task 6); `fill` from `components/team/team-copy.ts`.
- Produces:

```tsx
export type AssigneeOption = { userId: string; label: string };
export function AssigneeField(props: {
  label: string; value: string | null; options: AssigneeOption[]; readOnly: boolean;
  save: (next: string | null) => Promise<{ ok: true; previous: string | null } | { ok: false; error: AssignError }>;
}): JSX.Element;
export function WhoFilter(props: { base: string; current: Who; showMine: boolean; params: Record<string, string> }): JSX.Element;
```

- [ ] **Step 1: Copy first** (`messages.ts`, one block under an `assign.*` comment; the ratchet must see the `.es` twins):

```ts
  "assign.filter.label": "Show", "assign.filter.label.es": "Mostrar",
  "assign.filter.all": "All", "assign.filter.all.es": "Todo",
  "assign.filter.mine": "Mine", "assign.filter.mine.es": "A mi cargo",
  "assign.unassigned": "Unassigned", "assign.unassigned.es": "Sin asignar",
  "assign.field.label": "Assigned to", "assign.field.label.es": "Responsable",
  "assign.done": "Assigned to {name}.", "assign.done.es": "Asignado a {name}.",
  "assign.doneUnassigned": "Now unassigned.", "assign.doneUnassigned.es": "Ahora sin asignar.",
  "assign.undo": "Undo", "assign.undo.es": "Deshacer",
  "assign.bulk": "Assign to…", "assign.bulk.es": "Asignar a…",
  "assign.bulkDone": "{count} customers assigned to {name}.", "assign.bulkDone.es": "{count} clientes asignados a {name}.",
  "assign.bulkDoneOne": "1 customer assigned to {name}.", "assign.bulkDoneOne.es": "1 cliente asignado a {name}.",
  "assign.refused": "You can't change that customer.", "assign.refused.es": "No puede cambiar ese cliente.",
  "assign.failed": "That didn't save. Try again in a minute.", "assign.failed.es": "No se guardó. Intente de nuevo en un minuto.",
  "assign.customerFirst": "Assign the customer to them first.", "assign.customerFirst.es": "Primero asígnele el cliente.",
  "assign.empty.mine": "Nothing assigned to you yet.", "assign.empty.mine.es": "Todavía no tiene nada asignado.",
  "assign.empty.unassigned": "Every customer has someone. New leads from calls, forms and chat land here first.",
  "assign.empty.unassigned.es": "Cada cliente tiene a alguien. Los clientes nuevos de llamadas, formularios y chat llegan aquí primero.",
  "assign.empty.technician": "No customers yet. When your team gives you a customer, they show up here.",
  "assign.empty.technician.es": "Todavía no tiene clientes. Cuando su equipo le asigne uno, aparecerá aquí.",
```

(Write each pair on its own lines if the file's formatter requires one key per line; read neighbouring keys first.)

- [ ] **Step 2: Failing tests** `components/assign/assign.test.ts` (render with `react-dom/server` and the repo's existing client-component test harness used in `team-card.test.ts`):
  - `AssigneeField` read-only renders the member's label (or `m["assign.unassigned"]`) as text with no combobox (mutation: ignore `readOnly` -> FAILS); editable renders a select whose options are `Unassigned` then each member label; choosing one calls `save(userId)`, then shows `fill(m["assign.done"], { name })` with an Undo action that calls `save(previous)`; a failed save shows `m[error]` and keeps the old value.
  - `WhoFilter` renders three links (`All`, `Mine`, `Unassigned`) with `aria-current="page"` on the current one, hrefs built with `withWho` (All has no `who`), inside `<nav aria-label={m["assign.filter.label"]}>`; with `showMine` false, no Mine link.
  - `bulk-action-bar.test.ts`: with `canAssign` the bar shows `m["assign.bulk"]`, whose menu lists members and Unassigned; choosing a member calls `assignContactsAction(acct, selectedIds, userId)`, calls `onDone`, and toasts `assign.bulkDoneOne` for one id and `assign.bulkDone` for several, each with Undo calling `undoAssignContactsAction(acct, previous)`; without `canAssign`, no Assign control (mutation: render it unconditionally -> FAILS).
  - `contact-drawer.wiring.test.ts`: the drawer renders `AssigneeField` with `readOnly` equal to `!canAssign`, wired to `assignContactsAction(acct, [contactId], next)`.
  - `contacts/page.test.ts`: the page renders `WhoFilter` for Owner/Staff/agency and not for a Technician; a zero-row page one with `who=mine` shows `m["assign.empty.mine"]`, with `who=unassigned` `m["assign.empty.unassigned"]`, and a Technician's zero-row page one shows `m["assign.empty.technician"]`.

- [ ] **Step 3: Run red.** `pnpm --filter web exec vitest run src/components/assign "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/bulk-action-bar.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.test.ts"`. Expected: `Failed to resolve import "./assignee-field"`. Paste it.

- [ ] **Step 4: Implement the components.**

```tsx
// components/assign/assignee-field.tsx
"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { m } from "@/lib/messages";
import { fill } from "@/components/team/team-copy";
import type { AssignError } from "@/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions";

export type AssigneeOption = { userId: string; label: string };
const NONE = "__unassigned__";

/** Inline assignee (DESIGN.md Record views + rule 6): pick, saved at once, Undo toast. Read-only for a Technician (M4). */
export function AssigneeField({ label, value, options, readOnly, save }: {
  label: string; value: string | null; options: AssigneeOption[]; readOnly: boolean;
  save: (next: string | null) => Promise<{ ok: true; previous: string | null } | { ok: false; error: AssignError }>;
}) {
  const [current, setCurrent] = useState<string | null>(value);
  const [pending, start] = useTransition();
  const nameOf = (id: string | null) => (id === null ? m["assign.unassigned"] : options.find((o) => o.userId === id)?.label ?? m["assign.unassigned"]);
  if (readOnly) return <span className="text-sm">{nameOf(current)}</span>;
  const apply = (next: string | null) => start(async () => {
    const r = await save(next);
    if (!r.ok) { toast.error(m[r.error]); return; }
    setCurrent(next);
    toast.success(next === null ? m["assign.doneUnassigned"] : fill(m["assign.done"], { name: nameOf(next) }), {
      action: { label: m["assign.undo"], onClick: () => { void save(r.previous).then((u) => { if (u.ok) setCurrent(r.previous); else toast.error(m[u.error]); }); } },
    });
  });
  return (
    <Select value={current ?? NONE} onValueChange={(v) => apply(v === NONE ? null : v)} disabled={pending}>
      <SelectTrigger aria-label={label} size="sm"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{m["assign.unassigned"]}</SelectItem>
        {options.map((o) => <SelectItem key={o.userId} value={o.userId}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
```

`SelectTrigger` takes `size?: "sm" | "default"` (`components/ui/select.tsx:33`). The Undo label is `assign.undo`, not `common.undo`, because `common.undo` has no `.es` twin (`messages.ts:294`).

```tsx
// components/assign/who-filter.tsx
import Link from "next/link";
import { m } from "@/lib/messages";
import { withWho, type Who } from "@/lib/assign/who";
import { cn } from "@/lib/utils";

/** "All · Mine · Unassigned" (spec §9). Plain links: the filter runs on the server, so paging and the total stay true. */
export function WhoFilter({ base, current, showMine, params }: { base: string; current: Who; showMine: boolean; params: Record<string, string> }) {
  const items: { who: Who; label: string }[] = [
    { who: "all", label: m["assign.filter.all"] },
    ...(showMine ? [{ who: "mine" as const, label: m["assign.filter.mine"] }] : []),
    { who: "unassigned", label: m["assign.unassigned"] },
  ];
  return (
    <nav aria-label={m["assign.filter.label"]} className="flex items-center gap-1">
      {items.map((i) => {
        const qs = new URLSearchParams(withWho(params, i.who)).toString();
        return (
          <Link key={i.who} href={qs ? `${base}?${qs}` : base} aria-current={current === i.who ? "page" : undefined}
            className={cn("rounded-full px-3 py-1 text-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current === i.who ? "bg-[var(--accent-dim)] text-foreground" : "text-muted-foreground hover:bg-[var(--surface-3)]")}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
```

`params` excludes `before` (a filter change returns to page one) and keeps `q`, `sort` and `dir`. Check `@/lib/utils` exports `cn` (the contacts page imports it).

- [ ] **Step 5: Wire them in.**
  - Contact drawer and record page: an "Assigned to" row (`m["assign.field.label"]`) in the same `grid-cols-[92px_minmax(0,1fr)]` shape `SourceField` uses, rendering `AssigneeField` with `save={async (next) => { const r = await assignContactsAction(accountId, [contactId], next); return r.ok ? { ok: true, previous: r.previous[0]?.assignee ?? null } : r; }}`.
  - Task rows (contact record's task list and the To do list): `AssigneeField` with `setTaskAssigneeAction(accountId, taskId, next)`; read-only for a Technician.
  - Bulk bar: an "Assign to…" `DropdownMenu` (`components/ui/dropdown-menu.tsx`) beside the tag controls, shown when `canAssign`; ghost button (rule 8: the bar has no primary).
  - Contacts, To do and Conversations pages: `WhoFilter` above the list when `canAssign`; empty states per Step 2; a Technician's empty Contacts uses `assign.empty.technician`.
  - Record page deals: if a deal row links to `/pipeline`, render it as plain text for a Technician (the route refuses them).

- [ ] **Step 6: Run green** with Step 3's command, plus `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n`. Paste the summaries.

- [ ] **Step 7: The UI definition of done** (report each line): both themes via the `.dark` toggle; the blur fallback; keyboard (Tab reaches the filter links with a visible ring, the select opens with Enter and Esc closes it, the bulk menu closes with Esc); the 7 AM read in English and Spanish; the pseudo-locale's +35% does not overflow the filter row at 360px width (`e2e/i18n-overflow.spec.ts` is the orchestrator's); `/styleguide` gains `AssigneeField` and `WhoFilter` examples only if the reviewer judges them new variants.

- [ ] **Step 8: Mutation probes** as named. **Step 9: Commit.** `feat(design): assignee field, task picker, All/Mine/Unassigned filter and bulk Assign to`.

---

## Task 8: e2e: a Technician login and `assign.spec.ts`

**Owner:** bis-e2e-qa. **Review:** sonnet. **Sequential:** after Task 7. Playwright is the orchestrator's to run.

**Files**
- Modify: `apps/web/e2e/auth.setup.ts` (a new setup test "authenticate as technician user" AFTER "authenticate as staff user")
- Modify: `apps/web/e2e/auth.teardown.ts` (delete the technician Clerk user)
- Modify: `apps/web/e2e/fixtures/stale.ts` (`FIXTURE_EMAIL_RE` gains `technician`), `apps/web/e2e/fixtures/stale.test.ts`
- Create: `apps/web/e2e/assign.spec.ts`

- [ ] **Step 1: The setup test.** Same shape as the staff block (`auth.setup.ts:310-357`): create `e2e-technician-<stamp>@example.com` with `firstName: "E2E", lastName: "Technician"`; record `technicianClerkUserId` into `client-fixture.json` before anything can fail; `createOrganizationMembership({ organizationId: fixture.clerkOrgId, userId, role: "org:member" })`; THEN, before the first page load, seed the BIS role through `serviceDb()` (plan deviation 6):

```ts
  const db = serviceDb();
  const { data: u, error: uErr } = await db.from("users")
    .upsert({ clerk_user_id: techUser.id, email: techEmail, name: "E2E Technician" }, { onConflict: "clerk_user_id" })
    .select("id").single();
  if (uErr) throw new Error(`technician setup: users row not written: ${uErr.message}`);
  const { error: mErr } = await db.from("memberships")
    .insert({ scope: "account", account_id: fixture.accountId, user_id: u.id, role: "technician" });
  if (mErr) throw new Error(`technician setup: membership not written: ${mErr.message}`);
  writeFileSync(CLIENT_FIXTURE_FILE, JSON.stringify({ ...readFixture(), technicianUserId: u.id }));
```

then `signInWithTicket`, `setActiveOrganization`, `page.goto("/")`, and `await page.waitForURL(/\/dashboard\/accounts\/[^/]+\/tasks$/)` (the landing forwards through `/dashboard`, whose guard sends a Technician home), and `saveSignedInState(page.context(), "e2e/.auth/technician-state.json")`. The org's seat count: Owner, Staff and Technician is 3 of Clerk's 5 (the agency setup user is not a member).

- [ ] **Step 2: `stale.ts`.** `FIXTURE_EMAIL_RE` becomes `/^e2e-(?:client|agency|staff|technician)-(\d{13})@example\.com$/`; add a case to `stale.test.ts` matching a technician email. Run `pnpm --filter web exec vitest run e2e/fixtures/stale.test.ts` red (old regex), then green.

- [ ] **Step 3: `assign.spec.ts`**, all on the per-run fixture account (never Test Client One). Seed two contacts through `serviceDb()` with a `<stamp>` in their names (`Assign Mine <stamp>`, `Assign Other <stamp>`), both Unassigned; delete them in `afterAll`.
  1. **The Owner assigns.** With the client (Owner) state, open Contacts with `?who=unassigned`, see both rows; open `Assign Mine <stamp>`'s drawer, set "Assigned to" to "E2E Technician", see the toast `Assigned to E2E Technician.`, press Undo, read back with `serviceDb()` that `assigned_to` is null; assign again (no Undo) and read back the technician's `users.id`.
  2. **The Technician sees exactly that customer.** With `technician-state.json`: landing is `/tasks`; the sidebar holds exactly To do, Contacts, Conversations, Calls and Calendar; Contacts lists `Assign Mine <stamp>` and not `Assign Other <stamp>`, with no filter row; ⌘K search for `Assign` offers only the first.
  3. **The Technician is refused the totals.** Visiting `/dashboard/accounts/<id>/dashboard`, `/pipeline`, `/website`, `/forms` and `/branding` each lands on `/dashboard/accounts/<id>/tasks`.
  4. **The database refuses their token directly.** `mintClientToken(technicianClerkUserId)` (`e2e/support.ts:137`), then with the anon key and bearer: `GET ${SUPABASE_URL}/rest/v1/contacts?id=eq.<other id>` returns `[]`; `PATCH …/contacts?id=eq.<mine id>` with `{"assigned_to": null}` answers 403 or a 4xx carrying code `42501`, and a `serviceDb()` read-back shows it still assigned (the `server-only-writes.spec.ts` shape).

- [ ] **Step 4: The orchestrator runs** `pnpm --filter web test:e2e assign.spec.ts staff-roles.spec.ts client-access.spec.ts contacts.spec.ts contacts-drawer.spec.ts messaging.spec.ts palette.spec.ts shell.spec.ts server-only-writes.spec.ts booking.spec.ts` alone on the machine, after checking no `screenshots.yml` run is in progress (it shares bis-ci's seeded account).

- [ ] **Step 5: Commit.** `test(e2e): an Owner assigns a customer; the Technician sees only it and is refused the totals`.

---

## Task 9: Rollout (orchestrator; not a coding task)

- [ ] **Merge prep.** Fetch, merge `main` into the branch, re-run `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` one at a time on the combined tree. Confirm `0068` is still the next free number; if a migration landed with `main`, renumber before anything is applied, and check whether it is already applied before touching any database.
- [ ] **1. CI project.** Dispatch `ci-project-setup.yml` with `0068_mine_unassigned_technician.sql`. Read its run for success. The PR's `e2e` job fails until this is done (`.github/scripts/ci-migrations-applied.sh`).
- [ ] **2. Production pre-check** (read-only, MCP `execute_sql`): every account with client access on has at least one membership per signed-in client login; at minimum `select a.name, count(m.*) from accounts a left join memberships m on m.account_id = a.id and m.scope = 'account' where a.client_access_enabled group by 1 order by 1`. An account with client access on and zero memberships means its logins see NO customers after 0068 until their next page load (A1): note them, and tell danlo before applying.
- [ ] **3. Production.** Warn danlo in chat first (memory "Supabase MCP prompts": the Accept/Decline shows only in the CLI terminal). Apply 0068 via MCP `apply_migration`, exactly once; never re-apply.
- [ ] **4. Parity.** Run `docs/runbooks/ci-supabase-project.md`'s parity digest between bis-ci and production; they must match. Record both digests in the ledger.
- [ ] **5. Merge and deploy.** Read the check runs for the head SHA via `gh api repos/{owner}/{repo}/commits/{sha}/check-runs`; merge by REST PUT with `sha` pinned; read the PR state before any retry. Verify the deploy: READY with the merge SHA in its meta, aliased to `app.bis-rgv.com`; `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404; and the served-HTML marker: as a client Owner, the Contacts page HTML contains `aria-label="Show"` on the filter `nav` and a link with `?who=unassigned`.
- [ ] **6. Verify on production** (read-only): `select role, count(*) from memberships group by role` (no `technician` rows yet is expected); `select count(*) from pg_policies where policyname like '%technician%'` equals bis-ci's.
- [ ] **7. Runbooks and tracker.** Add 0068 to the run log in `docs/runbooks/ci-supabase-project.md`; update F-085's row in the roadmap tracker (memory "Roadmap tracker").

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| §2 M1 Technician sees only their customers, DB-enforced | Task 1 (every §5.2 table), Task 4 (routes), Task 8 spec 2 and 4 |
| §2 M2 contacts and tasks get assignees; Mine/Unassigned on three lists | Tasks 2, 3, 6, 7 |
| §2 M3 leads Unassigned, hand-added work belongs to its author | Task 6 (`createContactAction`, `addTaskAction`, proposals); leads untouched (they write NULL today) |
| §2 M4 Technician writes and refusals | Task 1 (with-check, trigger, config policies), Task 4 (refused routes and actions), Task 6 (assign actions refuse) |
| §2 M5 restrictive RLS, InitPlan, coalesced helpers | Task 1 migration, NULL-guard tests, Step 9 cost |
| A1 unknown role sees nothing | Task 1 NULL-guard case; re-seated actors; Task 9 step 2 |
| A2 bulk Assign to | Task 7 bulk bar; Task 6 actions |
| A3 removal returns to Unassigned, Undo restores | Task 1 `release_member_assignments`; Task 2 webhook path + `reassignReleased`; Task 4 Team actions |
| A4 open tasks move with the customer | Task 2 `assignContacts` |
| A5 members only; agency not assignable | Task 2 `assertMember`; Task 6 `assigneeFilterFor` (null person) |
| §5.1 helpers | Task 1 |
| §5.2 table enumeration | Task 1 (12 per-contact tables + contacts + tasks + events + flags), tests per table |
| §5.3 writes, config read-only, tags insert, indexes | Task 1 |
| §5.3 honest limit | no code (config stays readable by design); Team help text in Task 4 says only what is true |
| §6 Clerk: ordering, `org:member`, invitations | Task 2 `roleFromClerk`; Task 4 (`isAccountRole`, demotion branch maps through `clerkRoleFor`) |
| §7.1 refused routes, redirect loops | Task 4 (plus Branding, deviation 1; two redirects, deviation 2) |
| §7.2 service-key readers, guard test, calls cap | Task 4 (shell, calls page), Task 5b (guard test) |
| §7.3 proof-first writes, consent display | Task 5a (calendar), Task 5b (conversations, ledger) |
| §8 assignment actions, customer-first rule, duplicates (§13.3), lists | Tasks 2, 3, 6 |
| §9 screens, copy with `.es`, definition of done | Tasks 4 (Team), 7 |
| §10 testing (RLS, cost, unit, e2e) | Tasks 1, 2–7, 8 |
| §11 rollout and deploy order | Task 9 |

Type and name consistency checked across tasks: `AssigneeFilter`, `PreviousAssignee`, `ReleasedAssignments`, `readPersonId`, `assignContacts`, `setTaskAssignee`, `taskAssigneeFor`, `releaseMemberAssignments`, `reassignReleased`, `flagMatchesOf`, `callerCanSee`, `ledgerDb`, `requireNotTechnician`, `accountHome`, `Who`/`parseWho`/`assigneeFilterFor`/`withWho`, `AssignError`, `AssigneeField`, `WhoFilter`.

## Findings for the ledger (outside this plan's scope)

1. **Spec gap, fixed here:** spec §7.1 omits Branding, which every client (Staff included) can open and edit today. Plan deviation 1 refuses it to Technicians; the spec should say so.
2. **Spec ambiguity, resolved here:** M2 vs M3 on a task's default assignee (plan deviation 3). Worth one line in the spec.
3. **New event types `contact.assigned` and `task.assigned`.** The account Activity feed (`dashboard/activity-card.tsx`) maps event types to words; unmapped types are not shown. Whether assignment belongs in the feed is a later copy decision, not this plan's.
4. **`apiAccountAccess` settles no role.** An API route reached before any page load in a session (the ⌘K search) runs before the per-request fallback has created a membership; under A1 that caller sees no rows until a page loads. Every real session loads a page first; noted, not changed.
