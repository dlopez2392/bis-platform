# Properties and equipment on the customer record: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: `docs/superpowers/specs/2026-10-11-places-and-equipment-design.md` (owner decisions P1 to P6, choices C1 to C8 and rulings O1 to O9 are settled; do not re-open them).

**Goal:** A customer's record shows their properties (a lenient address, a landmark, "Cómo llegar", "Open map") and the equipment at each one, with replaced units kept as history, on one working "Properties" card on today's contact drawer and contact page, in English and Spanish, fenced for the Technician by the database.

**Architecture:** Migration 0071 adds `places` (one owner: a contact OR a client group) and `equipment` (a replacement is a new row whose `replaces_id` names the old unit at the same place), composite same-account keys, client writes under RLS with column grants, 0068-style RESTRICTIVE Technician fences, a restrictive "delete only an empty place" policy, and two plain triggers (stamp `created_by`; refuse an owner change by a Technician). `@bis/db` gains `places.ts`. `apps/web` gains a generic fourth validation arm, a multi-line and a date mode and a `locale` on `InlineField`, pure input and view helpers, server actions on the request client only, a read route that also answers the account's `today`, and one `PlacesCard` mounted on both surfaces.

**Tech Stack:** Next 16 App Router (server actions, route handlers), Supabase Postgres (RLS, PostgREST), supabase-js, vitest 4 (no DOM renderer: `renderToStaticMarkup` and the call-the-component idiom), Playwright, local PostgreSQL 18 replica.

## Global Constraints

- Tokens only: no hard-coded colours, radii or shadows (DESIGN.md). Rule 3 (warranty is a dot plus a word), rule 5 per card (loaded, empty, error), rule 6 (reversible actions run at once with an Undo toast; no confirm dialogs anywhere in this feature), rule 7 (skeletons, no spinners), rule 8 (one primary button per dialog), rule 11 (the card names no hero), Record views (inline edits, save on blur, Undo toast), the module contract (no new top-level page; P1).
- The word is "Property" / "Propiedad" (O1); "Equipment" / "Equipo"; "How to get there" / "Cómo llegar"; "Landmark" / "Referencia". Spanish uses usted. Never "Company" for a group.
- A Technician sees a place only through their own customer or that customer's group (P3), may add, edit, remove and put back anything they can see (O2), and never changes who a property belongs to (§5.3). The database enforces all three; the app pre-checks only to choose the copy.
- **Process rules for every task brief (orchestrator, 2026-10-11):**
  - **No `@bis/db` vitest against bis-ci until 0071 is on bis-ci.** Prove db tests on a local PG18 replica on ports **55480–55489** (table below), or through CI `verify` (an in-runner stack that applies every migration in the branch) after the orchestrator pushes. Never point a run that needs 0071 at bis-ci or production.
  - **Never run the three live web tests:** `src/app/f/[publicId]/actions.returning-lead.test.ts`, `src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.test.ts`, `weekly-metrics.live.test.ts`. Run web tests BY FILE PATH or by a folder that contains none of them (every folder named in this plan was checked: none does).
  - **Never `git stash`.**
  - **Scratch only in the session scratchpad, under a per-task subdirectory:** `s02c-t<N>-impl/` for the implementer, `s02c-t<N>-review/` for the reviewer. Write `<SCRATCH>` and `<WORKTREE>` as literal absolute paths (shell state does not survive between bash calls).
- **Replica ports (one per agent):** Task 1 implementer `55480`, Task 1 reviewer `55481`; Task 2 implementer Postgres `55482`, PostgREST `55483`, gateway `55484`; Task 2 reviewer `55485`/`55486`/`55487`; spare `55488`, `55489`. Never `5432`.
- Migrations are applied by the orchestrator only (Task 8): CI project, then production, then parity, each exactly once, all before merge. An implementer applies 0071 to its OWN replica only.
- Agents run only the affected tests, by path. `pnpm check`, `pnpm --filter web build` and `pnpm --filter web test:e2e` belong to the orchestrator, one at a time. Playwright is never an implementer's to run.
- Judge `@bis/db` runs by vitest's summary block: `pnpm --filter @bis/db exec vitest run …` prints a trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` after the real results. When an exit code matters, write it to a file with nothing after the command.
- **The `vi.mock("@bis/db")` factory check:** a task that adds a NEW named import from `@bis/db` to an EXISTING module adds that name to every `vi.mock("@bis/db", () => …)` factory reaching the module (`grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module file name without extension>"`); a missing export throws `[vitest] No "<name>" export is defined on the mock` at call time.
- **Every test must be able to fail.** Each task names its mutation probes: apply, run, see the named test fail BY NAME, revert. A `-t` filter that matches nothing passes silently: check the run count. Prefer a behaviour test to a source-text pin; this plan uses a source pin nowhere.
- Copy: every new string goes in `apps/web/src/lib/messages.ts` as `"key"` plus `"key.es"`, read through `t()` (`lib/i18n/t.ts:36`) with the reader's locale (`useLocale()`, `components/locale-provider.tsx:17`). New `.tsx` files carry NO JSX literal copy (the ratchet, `lib/i18n/ratchet.test.ts`, counts it). `messages.ts` is edited by Task 3, then Task 5, then Task 6, never in parallel.
- Never mutate Test Client One or any live account. e2e runs on the per-run `E2E Client Co <stamp>` fixture only.
- Migration files: ASCII only, no backslash anywhere (0050:86; memory "MCP SQL escapes").
- Commits: `git add <explicit paths>` then `git commit -m "…" -- <same paths>`; never `-A` or `.`; if `.git/index.lock` exists, wait and retry, never delete it; never push.

## Where the plan departs from the spec's wording (the source decided)

1. **`InlineField`'s fourth arm is a generic, serializable `rule`, not one "keyed to `place-input.ts`".** Spec §8 asks for an arm keyed to the places input module. A component in `components/` importing a places module would invert the layering, so the arm takes data (`{ kind: "text", max, required }` or `{ kind: "date", required, notAfter? }`) validated by a plain module, `lib/inline-rule.ts`, the precedent `lib/enum-value.ts` set for the `options` arm ("a server action importing from a `use client` file gets a client REFERENCE", `enum-value.ts:10-15`). `place-input.ts` builds its rules from it, so the browser and the server run one check.
2. **Inline edits toast "{label} saved" / "Guardado: {label}"**, `InlineField`'s existing message (`messages.ts:333`), not spec §7's "Saved.". Task 3 gives it, `inline.edit`, `inline.empty`, `inline.crashed` and `common.undo` their `.es` twins (the relationships plan recorded `common.undo` as missing one, its gap 5).
3. **The future-date message is `inline.rule.future`**, shared by the inline date field and the dialogs, so spec §8's `equipment.futureDate` is not a separate key.
4. **`today` comes from `dayKeyInZone`** (`lib/booking/availability.ts:89`), the booking engine's own zone path, fed `renderZone`'s answer (the `email` route's shape).
5. **`removePlace` counts the place's units before it chooses.** RLS binds only the request client; the service role bypasses `places_delete_empty`, so a delete-first design would cascade a unit away under the service client (the db suite's client). The count chooses archive for a place with units; the policy still refuses the request client's delete if a unit appears between the count and the delete (0 rows), and then it archives.
6. **"Refused" is a zero-row write.** RLS does not raise on an UPDATE or DELETE its USING filters out (the relationships plan's deviation 4). Writers read first: found but not written means refused.
7. **The e2e Spanish check flips the Owner's own `users.language`**, not `?locale=es` (the relationships plan's deviation 5: the account layout calls `requestLocale` without `searchParams`).
8. **Owner choices travel as `contact:<uuid>` / `group:<uuid>`**, so "Belongs to" is `InlineField`'s existing `options` arm, and its default Undo (re-save the prior option) is the right Undo with no new code.

---

## Task order and parallelism

| # | Task | Owner | Review | Depends on |
|---|---|---|---|---|
| 0 | Merge `main` after the relationships PR lands; confirm 0070 is present | orchestrator | n/a | the relationships merge |
| 1 | Migration 0071 + schema and RLS proof on the replica | bis-db-schema | **opus** | 0 |
| 2 | `@bis/db` `places.ts`, barrel, teardown list | bis-crm | **opus** | 1 |
| 3 | `InlineField`: multi-line, date, the `rule` arm, `locale`; `lib/inline-rule.ts`; `.es` twins for its chrome | bis-frontend | sonnet | 0 (parallel with 1 and 2) |
| 4 | Pure helpers: `place-input.ts`, `place-view.ts` | bis-crm | sonnet | 2, 3 |
| 5 | Server actions, the read route, error copy | bis-crm | **opus** | 2, 4 |
| 6 | The Properties card, its dialogs and copy, mounted on drawer and page | bis-frontend | sonnet | 3, 5 |
| 7 | e2e `places.spec.ts` (written by the agent, run by the orchestrator) | bis-e2e-qa | sonnet | 6 |
| 8 | Rollout: CI project, production, parity, before merge | orchestrator | n/a | 7 |

Parallel group A = {1, 3} then {2, 3}: Task 3 touches only `components/inline-field.tsx`, its tests, `lib/inline-rule.ts`, `lib/contacts/inline-save.ts`, its test, and `messages.ts`; Tasks 1 and 2 touch only `packages/db`. Everything else is sequential.

### Files this plan shares with other lanes (conflict points when `main` moves)

| Shared file | This plan's edit | Task | Merges with |
|---|---|---|---|
| `packages/db/src/account-teardown.ts` | `"equipment", "places",` inserted right after `"tags",` (before `"contact_relationships"`) | 2 | 0070's line (already merged by Task 0) |
| `packages/db/src/index.ts` | one export block after the relationships blocks (`index.ts:244-252` on the relationships branch) | 2 | any lane appending a block |
| `packages/db/src/test/schema-grants-guard.test.ts` | two `EXPECTED_WRITES` entries, alphabetical: `"authenticated equipment"` after `"authenticated custom_values"`, `"authenticated places"` after `"authenticated pipelines"` | 1 | any lane adding a client-written table |
| `apps/web/src/lib/messages.ts` | Task 3: `.es` twins beside `common.undo` (`:294`) and the `inline.*` block (`:333-341`) plus `inline.rule.*`; Tasks 5 and 6: one block each just before `} as const;` (`:3429` today) | 3, 5, 6 | every lane |
| `contacts/contact-drawer.tsx` | one import and one `<PlacesCard … />` element directly after `<GroupsCard … />` | 6 | groups and relationships cards |
| `contacts/contact-drawer.wiring.test.ts` | one `vi.mock("./places-card")` recorder beside the `groups-card` stub, one describe | 6 | same |
| `contacts/[contactId]/page.tsx` | one import and one `<aside>` between the Groups aside and the Deals aside | 6 | same |
| `contacts/[contactId]/page.test.ts` | one `vi.mock("../places-card")` recorder, one describe | 6 | same |
| `components/inline-field.tsx`, `inline-field.test.ts`, `lib/contacts/inline-save.ts` | additive arm, modes and `locale` | 3 | bis-frontend's other work |
| `apps/web/e2e/fixtures/fixture-names.test.ts` | entries for the spec's stamped literals, if it reports any | 7 | every e2e lane |
| `docs/runbooks/ci-supabase-project.md` | run-log line for 0071 (landed by bis-platform) | 8 | every migration |

---

## Task 0: Merge `main` after the relationships PR (orchestrator)

- [ ] **Step 1.** When the relationships PR (`feat/s02-relationships`, migration 0070) has merged, merge `origin/main` into the implementation branch (cut from `spec/s02-places`). Resolve nothing by hand in this plan's files: none exist yet.
- [ ] **Step 2.** Confirm: `ls packages/db/supabase/migrations | tail -3` ends `0069_client_groups.sql`, `0070_contact_relationships.sql`; `grep -n '"contact_relationships"' packages/db/src/account-teardown.ts` hits; `grep -n "RelationshipsCard" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx"` hits. If any is missing, stop: every later task's anchors assume it.

---

## Task 1: Migration 0071 and its proof

**Owner:** bis-db-schema. **Review:** opus. **Runs:** first, alone (parallel with Task 3). **Scratch:** `s02c-t1-impl/`, replica port `55480` (reviewer `s02c-t1-review/`, `55481`).

**Files**
- Create: `packages/db/supabase/migrations/0071_places_and_equipment.sql`
- Create: `packages/db/src/test/places-schema.test.ts`
- Create: `packages/db/src/test/places-rls.test.ts`
- Modify: `packages/db/src/test/schema-grants-guard.test.ts` (`EXPECTED_WRITES`, two entries)

**Interfaces**
- Consumes (SQL): `app.is_agency()`, `app.current_account_id()`, `app.sees_all_customers(uuid)`, `app.my_contact_ids()`, `app.current_user_id()` (0068:65-88); `app.my_client_group_ids()` (0069:94-98); `contacts_account_id_id_key` (0050:93-94); `client_groups_account_id_id_key` (0069:56).
- Produces (SQL), every later task relies on these exact names:
  - Tables `public.places (id, account_id, contact_id, client_group_id, label, address, landmark, directions, city, region, postal_code, country, archived_at, created_by, created_at, updated_at)` and `public.equipment (id, account_id, place_id, name, make, model, serial, notes, installed_on, warranty_until, replaces_id, created_by, created_at, updated_at)`.
  - Constraints `places_contact_fkey`, `places_group_fkey`, `places_one_owner`, `places_findable`, `places_country_check`, `places_<col>_check` for each text column, `places_account_id_id_key`; `equipment_place_fkey`, `equipment_place_id_id_key`, `equipment_replaces_fkey`, `equipment_not_self`, `equipment_replacement_dated`, `equipment_warranty_order`, `equipment_<col>_check`.
  - Indexes `places_by_contact`, `places_by_group`, `equipment_by_place`, `equipment_one_successor` (unique).
  - Policies `places_member_all`, `places_technician_scope`, `places_delete_empty`, `equipment_member_all`, `equipment_technician_scope`.
  - Functions `app.tidy_text(text, int) returns boolean`, `app.my_place_ids() returns setof uuid`, `app.stamp_created_by() returns trigger`, `app.places_owner_guard() returns trigger`; triggers `places_stamp_created_by`, `equipment_stamp_created_by`, `places_owner_guard`.

- [ ] **Step 1: Build your replica.** Write the env file (absolute paths, written out literally):

```bash
mkdir -p "<SCRATCH>/s02c-t1-impl"
cat > "<SCRATCH>/s02c-t1-impl/env.sh" <<'EOF'
S="<SCRATCH>/s02c-t1-impl"
PGBIN="/c/Program Files/PostgreSQL/18/bin"
P() { "$PGBIN/psql" -h localhost -p 55480 -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
EOF
```

Then from `<WORKTREE>` in Git Bash:

```bash
source "<SCRATCH>/s02c-t1-impl/env.sh"
"$PGBIN/initdb" -U postgres -A trust -D "$S/pgdata" > "$S/initdb.log" 2>&1
"$PGBIN/pg_ctl" -D "$S/pgdata" -o "-p 55480" -l "$S/pg.log" start </dev/null >/dev/null 2>&1
P -c "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls; grant anon, authenticated, service_role to postgres;"
P -c "create database pre"
P -d pre -c "alter database pre set timezone to 'UTC'"
P -d pre -c "create schema if not exists app; create schema if not exists extensions;"
sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql | P -d pre
for f in packages/db/supabase/migrations/0*.sql; do
  case "$f" in *0071_*) continue;; esac
  P -d pre -1 -f "$f" || { echo "FAILED at $f"; break; }
done
```

Expected: no `FAILED at` line.

- [ ] **Step 2: Verify the facts 0071 relies on** (read-only, on `pre`):

```bash
source "<SCRATCH>/s02c-t1-impl/env.sh"
P -d pre -At -c "select proname from pg_proc where pronamespace = 'app'::regnamespace and proname in ('sees_all_customers','my_contact_ids','my_client_group_ids','current_user_id','is_agency','current_account_id') order by 1"
P -d pre -At -c "select conname from pg_constraint where conname in ('contacts_account_id_id_key','client_groups_account_id_id_key') order by 1"
P -d pre -At -c "select to_regclass('public.places'), to_regclass('public.equipment'), to_regclass('public.contact_relationships')"
ls packages/db/supabase/migrations | tail -2
```

Expected: the six function names; both constraint names; `||contact_relationships` (places and equipment absent, 0070 present); the last two files `0069_client_groups.sql`, `0070_contact_relationships.sql`. Anything else: stop and report (Task 0 did not run, or the numbering moved).

- [ ] **Step 3: Write the failing schema test** `packages/db/src/test/places-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * Properties and equipment (spec §5, migration 0071). As the table owner inside a rolled-back
 * transaction unless a case switches role with actAs. A failed constraint, a column without a grant
 * or a refused INSERT raises; a refused UPDATE or DELETE affects 0 rows and raises nothing.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_pl_${RUN}`;
const ORG_B = `org_plb_${RUN}`;
const OWNER_SUB = `user_pl_owner_${RUN}`;
const STAFF_SUB = `user_pl_staff_${RUN}`;

/** Runs one statement under a savepoint: a refusal otherwise aborts the whole transaction (25P02). */
async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint attempt");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint attempt");
    throw e;
  }
}
async function insert(c: Client, table: "places" | "equipment", row: Record<string, unknown>) {
  const keys = Object.keys(row);
  const r = await attempt(c,
    `insert into ${table} (${keys.join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) returning *`,
    Object.values(row));
  return r.rows[0] as Record<string, unknown> & { id: string };
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const account = (org: string, name: string) => one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, org, name]);
  const acct = await account(ORG, "Places Co");
  const acctB = await account(ORG_B, "Places B Co");
  const user = (sub: string) => one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [sub]);
  const owner = await user(OWNER_SUB);
  const staff = await user(STAFF_SUB);
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1,'account',$3,'owner'), ($2,'account',$3,'staff')",
    [owner, staff, acct]);
  const contact = (a: string, first: string) => one("insert into contacts (account_id, first_name) values ($1,$2) returning id", [a, first]);
  const group = (a: string, name: string) => one("insert into client_groups (account_id, kind, name) values ($1,'household',$2) returning id", [a, name]);
  return {
    acct, acctB, owner, staff,
    ana: await contact(acct, "Ana"), bea: await contact(acctB, "Bea"),
    home: await group(acct, "Garcia"), homeB: await group(acctB, "Other"),
  };
}
const ADDR = "1204 Nolana Ave";

describe("places: owners and keys (spec §5.1)", () => {
  it("refuses a place owned by another account's contact (mutation: make places_contact_fkey single-column -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(insert(c, "places", { account_id: s.acct, contact_id: s.bea, address: ADDR }))
        .rejects.toMatchObject({ code: "23503", constraint: "places_contact_fkey" });
    }));
  it("refuses a place owned by another account's group", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(insert(c, "places", { account_id: s.acct, client_group_id: s.homeB, address: ADDR }))
      .rejects.toMatchObject({ code: "23503", constraint: "places_group_fkey" });
  }));
  it("needs exactly one owner (mutation: drop places_one_owner -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    for (const owner of [{ contact_id: s.ana, client_group_id: s.home }, {}]) {
      await expect(insert(c, "places", { account_id: s.acct, address: ADDR, ...owner }))
        .rejects.toMatchObject({ code: "23514", constraint: "places_one_owner" });
    }
  }));
  it("needs an address, a landmark or directions, and any one of them is enough (mutation: drop places_findable -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(insert(c, "places", { account_id: s.acct, contact_id: s.ana, label: "Casa" }))
        .rejects.toMatchObject({ code: "23514", constraint: "places_findable" });
      expect((await insert(c, "places", { account_id: s.acct, contact_id: s.ana, landmark: "the blue house past the canal" })).id).toBeTruthy();
      expect((await insert(c, "places", { account_id: s.acct, contact_id: s.ana, directions: "Past the Valero, second gate" })).id).toBeTruthy();
    }));
  it("stores text trimmed and never blank; a newline inside directions is kept (mutation: drop the regex from app.tidy_text -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      for (const bad of [` ${ADDR}`, `${ADDR} `, "   ", `\u00a0${ADDR}`, `${ADDR}\t`, "x".repeat(301)]) {
        await expect(insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: bad }), JSON.stringify(bad))
          .rejects.toMatchObject({ code: "23514", constraint: "places_address_check" });
      }
      const kept = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, directions: "Past the canal\nsecond gate" });
      expect(kept.directions).toBe("Past the canal\nsecond gate");
      const { rows } = await c.query<{ ok: boolean }>(
        "select app.tidy_text(v, 3) as ok from unnest($1::text[]) with ordinality as t(v, n) order by n", [[null, "abc", "abcd", "", " a", "a b"]]);
      expect(rows.map((r) => r.ok)).toEqual([true, true, false, false, false, true]);
    }));
  it("country is US, MX or nothing", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR, country: "CA" }))
      .rejects.toMatchObject({ code: "23514", constraint: "places_country_check" });
  }));
});

describe("equipment: the replacement chain (spec §5.1, C3)", () => {
  const unit = (c: Client, acct: string, place: string, extra: Record<string, unknown> = {}) =>
    insert(c, "equipment", { account_id: acct, place_id: place, name: "AC upstairs", ...extra });

  it("a unit belongs to a place of its own account", () => withRollback(async (c) => {
    const s = await seed(c);
    const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
    await expect(unit(c, s.acctB, p.id)).rejects.toMatchObject({ code: "23503", constraint: "equipment_place_fkey" });
  }));
  it("a replacement must be at the same place (mutation: make equipment_replaces_fkey single-column on replaces_id -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p1 = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const p2 = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: "300 S 10th St" });
      const u1 = await unit(c, s.acct, p1.id);
      await expect(unit(c, s.acct, p2.id, { replaces_id: u1.id, installed_on: "2026-10-01" }))
        .rejects.toMatchObject({ code: "23503", constraint: "equipment_replaces_fkey" });
    }));
  it("no unit is replaced twice (mutation: drop index equipment_one_successor -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
    const u1 = await unit(c, s.acct, p.id);
    await unit(c, s.acct, p.id, { replaces_id: u1.id, installed_on: "2026-10-01" });
    await expect(unit(c, s.acct, p.id, { replaces_id: u1.id, installed_on: "2026-10-02" })).rejects.toMatchObject({ code: "23505" });
  }));
  it("a replacement carries its date, and a warranty never ends before install", () => withRollback(async (c) => {
    const s = await seed(c);
    const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
    const u1 = await unit(c, s.acct, p.id);
    await expect(unit(c, s.acct, p.id, { replaces_id: u1.id }))
      .rejects.toMatchObject({ code: "23514", constraint: "equipment_replacement_dated" });
    await expect(unit(c, s.acct, p.id, { installed_on: "2026-10-01", warranty_until: "2026-09-30" }))
      .rejects.toMatchObject({ code: "23514", constraint: "equipment_warranty_order" });
  }));
  it("a unit something replaced cannot be deleted; its replacement can, and then it can (mutation: equipment_replaces_fkey on delete cascade -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const u1 = await unit(c, s.acct, p.id);
      const u2 = await unit(c, s.acct, p.id, { replaces_id: u1.id, installed_on: "2026-10-01" });
      await expect(attempt(c, "delete from equipment where id = $1", [u1.id]))
        .rejects.toMatchObject({ code: "23503", constraint: "equipment_replaces_fkey" });
      expect((await attempt(c, "delete from equipment where id = $1", [u2.id])).rowCount).toBe(1);
      expect((await attempt(c, "delete from equipment where id = $1", [u1.id])).rowCount).toBe(1);
    }));
});

describe("cascades (spec §5.1, O3)", () => {
  it("an Owner deleting a customer removes the places only they own and every unit, chain included, though places_delete_empty would refuse that delete directly; a group's place stays (mutation: places_contact_fkey on delete no action -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const mine = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const shared = await insert(c, "places", { account_id: s.acct, client_group_id: s.home, address: "300 S 10th St" });
      const u1 = await insert(c, "equipment", { account_id: s.acct, place_id: mine.id, name: "Old AC" });
      await insert(c, "equipment", { account_id: s.acct, place_id: mine.id, name: "New AC", replaces_id: u1.id, installed_on: "2026-10-01" });
      await insert(c, "equipment", { account_id: s.acct, place_id: shared.id, name: "Water heater" });
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      expect((await attempt(c, "delete from contacts where id = $1", [s.ana])).rowCount).toBe(1);
      await c.query("reset role");
      expect((await c.query("select id from places where account_id = $1", [s.acct])).rows).toEqual([{ id: shared.id }]);
      expect((await c.query("select name from equipment where account_id = $1", [s.acct])).rows).toEqual([{ name: "Water heater" }]);
    }));
  it("a group delete takes its places; an account delete takes everything", () => withRollback(async (c) => {
    const s = await seed(c);
    const shared = await insert(c, "places", { account_id: s.acct, client_group_id: s.home, address: ADDR });
    await insert(c, "equipment", { account_id: s.acct, place_id: shared.id, name: "Water heater" });
    await c.query("delete from client_groups where id = $1", [s.home]);
    expect((await c.query("select 1 from places where id = $1", [shared.id])).rowCount).toBe(0);
    // A GROUP's place, so the contact delete below cannot be what removes it (contacts refuse an
    // account delete, so they go first; the place and its unit must survive that and go with the account).
    const { rows: [g2] } = await c.query<{ id: string }>("insert into client_groups (account_id, kind, name) values ($1,'household','Reyes') returning id", [s.acct]);
    const p = await insert(c, "places", { account_id: s.acct, client_group_id: g2!.id, address: ADDR });
    const u = await insert(c, "equipment", { account_id: s.acct, place_id: p.id, name: "Pump" });
    await c.query("delete from contacts where account_id = $1", [s.acct]);
    expect((await c.query("select 1 from places where id = $1", [p.id])).rowCount).toBe(1); // control: still there
    await c.query("delete from memberships where account_id = $1", [s.acct]);
    await c.query("delete from accounts where id = $1", [s.acct]);
    expect((await c.query("select 1 from places where id = $1", [p.id])).rowCount).toBe(0);
    expect((await c.query("select 1 from equipment where id = $1", [u.id])).rowCount).toBe(0);
  }));
});

describe("grants, triggers and policies (spec §5.2, §5.3)", () => {
  it("an Owner's insert stamps created_by with the caller, whatever the client sent (mutation: drop trigger places_stamp_created_by -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      const p = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR, created_by: s.staff });
      expect(p.created_by).toBe(s.owner);
      const u = await insert(c, "equipment", { account_id: s.acct, place_id: p.id, name: "AC", created_by: s.staff });
      expect(u.created_by).toBe(s.owner);
    }));
  it("the service role keeps the created_by it sends", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("set local role service_role");
    expect((await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR, created_by: s.staff })).created_by).toBe(s.staff);
  }));
  it("the client role updates only the granted columns (mutation: grant update (place_id) on public.equipment to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const p1 = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const p2 = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: "300 S 10th St" });
      const u = await insert(c, "equipment", { account_id: s.acct, place_id: p1.id, name: "AC" });
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      expect((await attempt(c, "update places set landmark = 'past the canal' where id = $1", [p1.id])).rowCount).toBe(1); // positive control
      for (const [sql, args] of [
        ["update equipment set place_id = $1 where id = $2", [p2.id, u.id]],
        ["update equipment set replaces_id = $1 where id = $1", [u.id]],
        ["update places set created_by = null where id = $1", [p1.id]],
        ["update places set account_id = account_id where id = $1", [p1.id]],
      ] as const) {
        await expect(attempt(c, sql, [...args]), sql).rejects.toMatchObject({ code: "42501" });
      }
    }));
  it("deleting a place with units affects no row; an empty place is deleted (mutation: drop policy places_delete_empty -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const full = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: ADDR });
      const empty = await insert(c, "places", { account_id: s.acct, contact_id: s.ana, address: "300 S 10th St" });
      await insert(c, "equipment", { account_id: s.acct, place_id: full.id, name: "AC" });
      await actAs(c, { org_id: ORG, sub: OWNER_SUB });
      expect((await attempt(c, "delete from places where id = $1", [full.id])).rowCount).toBe(0);
      expect((await attempt(c, "delete from places where id = $1", [empty.id])).rowCount).toBe(1);
    }));
  it("has exactly these five policies (mutation: drop policy equipment_technician_scope -> FAILS)", () => withRollback(async (c) => {
    const { rows } = await c.query(
      `select tablename, policyname, permissive, cmd, roles::text as roles from pg_policies
        where schemaname = 'public' and tablename in ('places','equipment')
        order by tablename collate "C", policyname collate "C"`);
    const row = (t: string, p: string, permissive: string, cmd: string) => ({ tablename: t, policyname: p, permissive, cmd, roles: "{authenticated}" });
    expect(rows).toEqual([
      row("equipment", "equipment_member_all", "PERMISSIVE", "ALL"),
      row("equipment", "equipment_technician_scope", "RESTRICTIVE", "ALL"),
      row("places", "places_delete_empty", "RESTRICTIVE", "DELETE"),
      row("places", "places_member_all", "PERMISSIVE", "ALL"),
      row("places", "places_technician_scope", "RESTRICTIVE", "ALL"),
    ]);
  }));
  it("its four functions are executable by authenticated and service_role, never anon (mutation: revoke execute on app.tidy_text from authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      for (const f of ["app.tidy_text(text,integer)", "app.my_place_ids()", "app.stamp_created_by()", "app.places_owner_guard()"]) {
        const { rows: [r] } = await c.query(
          `select has_function_privilege('authenticated', $1, 'execute') as auth,
                  has_function_privilege('service_role', $1, 'execute') as svc,
                  has_function_privilege('anon', $1, 'execute') as anon`, [f]);
        expect(r, f).toEqual({ auth: true, svc: true, anon: false });
      }
    }));
});
```

`app.tidy_text` must stay executable by `authenticated`: a CHECK calls it with the inserting role's privileges, so revoking it would refuse every client insert (that is what the last case pins).

- [ ] **Step 4: Write the failing RLS test** `packages/db/src/test/places-rls.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";

/**
 * P3 and O2: a Technician sees, and writes, a place only through a customer assigned to them or
 * that customer's group, and never moves a place between owners. Owner, Staff and the agency see
 * the whole account; another account, a login with no membership and a departed Technician see
 * nothing. Its own seed (as the groups plan needed): a household shared by the Technician's
 * customer and someone else's.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_plr_${RUN}`;
const ORG_B = `org_plrb_${RUN}`;
const SUB = {
  owner: `u_pl_owner_${RUN}`, staff: `u_pl_staff_${RUN}`, tech: `u_pl_tech_${RUN}`,
  tech2: `u_pl_tech2_${RUN}`, none: `u_pl_none_${RUN}`, ownerB: `u_pl_ownerb_${RUN}`,
} as const;
type Person = keyof typeof SUB;
const claims = (p: Person | "agency") =>
  p === "agency" ? { app_role: "agency_admin", sub: `u_pl_agency_${RUN}` } : { org_id: p === "ownerB" ? ORG_B : ORG, sub: SUB[p] };

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try { const r = await c.query(sql, args); await c.query("release savepoint attempt"); return r; }
  catch (e) { await c.query("rollback to savepoint attempt"); throw e; }
}

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const acct = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'PL Co',true) returning id", [agency!.id, ORG]);
  const acctB = await one("insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,'PL B',true) returning id", [agency!.id, ORG_B]);
  const u = {} as Record<Person, string>;
  for (const k of Object.keys(SUB) as Person[]) u[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'), ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [u.owner, u.staff, u.tech, u.tech2, u.ownerB, acct, acctB]);
  const ct = (who: string | null, name: string) => one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [acct, name, who]);
  const mine = await ct(u.tech, "Mine");
  const theirs = await ct(u.tech2, "Theirs");
  const g = (kind: string, name: string) => one("insert into client_groups (account_id, kind, name) values ($1,$2,$3) returning id", [acct, kind, name]);
  const garcia = await g("household", "Garcia");
  const beta = await g("business", "Beta Pools");
  const member = (grp: string, contact: string) =>
    c.query("insert into client_group_members (account_id, client_group_id, contact_id, is_primary) values ($1,$2,$3,true)", [acct, grp, contact]);
  await member(garcia, mine);
  await member(garcia, theirs);
  await c.query("insert into client_group_members (account_id, client_group_id, contact_id) values ($1,$2,$3)", [acct, beta, theirs]);
  const place = (owner: { contact_id?: string; client_group_id?: string }, address: string) =>
    one(`insert into places (account_id, contact_id, client_group_id, address) values ($1,$2,$3,$4) returning id`,
      [acct, owner.contact_id ?? null, owner.client_group_id ?? null, address]);
  const pMine = await place({ contact_id: mine }, "1 Mine St");
  const pTheirs = await place({ contact_id: theirs }, "2 Theirs St");
  const pShared = await place({ client_group_id: garcia }, "3 Garcia St");
  const pBeta = await place({ client_group_id: beta }, "4 Beta St");
  const unit = (p: string, name: string) => one("insert into equipment (account_id, place_id, name) values ($1,$2,$3) returning id", [acct, p, name]);
  return {
    acct, acctB, u, mine, theirs, garcia, beta, pMine, pTheirs, pShared, pBeta,
    uMine: await unit(pMine, "AC"), uTheirs: await unit(pTheirs, "AC"), uShared: await unit(pShared, "Water heater"), uBeta: await unit(pBeta, "Pump"),
  };
}
const ids = async (c: Client, table: string, acct: string) =>
  (await c.query<{ id: string }>(`select id from ${table} where account_id = $1 order by id`, [acct])).rows.map((r) => r.id);

describe("P3: the Technician reads only through their own customer", () => {
  it("reads their customer's place and their customer's household's place, never another customer's or a group with none of theirs (mutation: drop policy places_technician_scope -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("tech"));
      expect(await ids(c, "places", s.acct)).toEqual([s.pMine, s.pShared].sort());
    }));
  it("equipment follows its place (mutation: drop policy equipment_technician_scope -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claims("tech"));
    expect(await ids(c, "equipment", s.acct)).toEqual([s.uMine, s.uShared].sort());
  }));
});

describe("O2: the Technician writes on what they can see, and nowhere else", () => {
  it("edits their customer's place and the shared household's, and adds a unit there (mutation: key places_technician_scope on contact_id only -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims("tech"));
      expect((await attempt(c, "update places set landmark = 'past the canal' where id = $1", [s.pShared])).rowCount).toBe(1);
      expect((await attempt(c, "update places set landmark = 'blue house' where id = $1", [s.pMine])).rowCount).toBe(1);
      expect((await attempt(c, "insert into equipment (account_id, place_id, name) values ($1,$2,'Thermostat')", [s.acct, s.pShared])).rowCount).toBe(1);
    }));
  it("may remove an empty shared place and put a shared place in Removed properties", () => withRollback(async (c) => {
    const s = await seed(c);
    const { rows: [e] } = await c.query<{ id: string }>(
      "insert into places (account_id, client_group_id, address) values ($1,$2,'9 Empty St') returning id", [s.acct, s.garcia]);
    await actAs(c, claims("tech"));
    expect((await attempt(c, "delete from places where id = $1", [e!.id])).rowCount).toBe(1);
    expect((await attempt(c, "update places set archived_at = now() where id = $1", [s.pShared])).rowCount).toBe(1);
  }));
  it("on another customer's place: an insert raises 42501, an update or a delete touches no row", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claims("tech"));
    await expect(attempt(c, "insert into places (account_id, contact_id, address) values ($1,$2,'5 New St')", [s.acct, s.theirs]))
      .rejects.toMatchObject({ code: "42501" });
    await expect(attempt(c, "insert into equipment (account_id, place_id, name) values ($1,$2,'AC')", [s.acct, s.pTheirs]))
      .rejects.toMatchObject({ code: "42501" });
    expect((await attempt(c, "update places set landmark = 'x' where id = $1", [s.pTheirs])).rowCount).toBe(0);
    expect((await attempt(c, "update equipment set name = 'x' where id = $1", [s.uBeta])).rowCount).toBe(0);
  }));
  it("cannot move a place between a person and a group even inside their reach, while an Owner can (mutation: drop trigger places_owner_guard -> FAILS)", () =>
    withRollback(async (c) => {
      // Mine is a member of Garcia, so the with-check alone would ALLOW this move: only the trigger refuses it.
      const s = await seed(c);
      const move = "update places set contact_id = null, client_group_id = $1 where id = $2";
      await actAs(c, claims("tech"));
      await expect(attempt(c, move, [s.garcia, s.pMine])).rejects.toMatchObject({ code: "42501" });
      await c.query("reset role");
      await actAs(c, claims("owner"));
      expect((await attempt(c, move, [s.garcia, s.pMine])).rowCount).toBe(1);
    }));
});

describe("everyone else", () => {
  for (const p of ["owner", "staff", "agency"] as const) {
    it(`${p}: every place and unit of the account`, () => withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claims(p));
      expect(await ids(c, "places", s.acct)).toEqual([s.pMine, s.pTheirs, s.pShared, s.pBeta].sort());
      expect(await ids(c, "equipment", s.acct)).toEqual([s.uMine, s.uTheirs, s.uShared, s.uBeta].sort());
    }));
  }
  it("another account's Owner, a login with no membership and a departed Technician see nothing", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("delete from memberships where user_id = $1", [s.u.tech2]); // departed; Theirs is still assigned to them
    for (const p of ["ownerB", "none", "tech2"] as const) {
      await c.query("reset role");
      await actAs(c, claims(p));
      expect(await ids(c, "places", s.acct), p).toEqual([]);
      expect(await ids(c, "equipment", s.acct), p).toEqual([]);
    }
  }));
});
```

- [ ] **Step 5: Run both red on `pre`.**

```bash
source "<SCRATCH>/s02c-t1-impl/env.sh" && cd <WORKTREE>/packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55480/pre NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= BIS_CI_SUPABASE_REF= pnpm exec vitest run src/test/places-schema.test.ts src/test/places-rls.test.ts > "$S/t1-red.txt" 2>&1; echo $? > "$S/t1-red.exit"
```

Expected: every case fails with `relation "places" does not exist` (or `function app.tidy_text… does not exist`). The blank `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` make the global setup skip its sweep (`src/test/global-setup.ts:31-34`), so nothing reaches bis-ci. Paste one failing line and the summary line.

- [ ] **Step 6: Write the migration** `packages/db/supabase/migrations/0071_places_and_equipment.sql`:

```sql
-- 0071_places_and_equipment.sql - properties and equipment on the customer record
-- (docs/superpowers/specs/2026-10-11-places-and-equipment-design.md section 5)
--
-- A property ("place") belongs to ONE owner, a contact or a client group (0069), so a household's
-- house shows on every member's record. Equipment sits at a place; a replacement is a NEW row whose
-- replaces_id names the old unit at the SAME place, so "replaced" and "when" (the new unit's
-- installed_on) are read, never stored twice. Client-written under RLS (operator-entered state,
-- like notes and contact_relationships), with 0068-style restrictive fences: a Technician reads and
-- writes a place only through their own customer or that customer's group, and a trigger stops
-- them moving a place between owners. A place with equipment cannot be deleted by a client token
-- (places_delete_empty); the app archives it instead. Composite same-account keys (0050's shape).
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration), then the parity check, then merge. 0070 reaches each project first.
--
-- ROLLBACK (revert the app first; this drops what people typed, so only on an owner decision,
-- after an export):
--   drop table public.equipment; drop table public.places;
--   drop function app.places_owner_guard(), app.stamp_created_by(), app.my_place_ids(), app.tidy_text(text, int);
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

-- 1. A stored text value is trimmed and never blank. 0070's POSIX class (measured 2026-10-11 under
--    ICU en_US.UTF-8: 09-0D, 1C-1F, 20, 85, A0, 1680, 2000-200A, 2028, 2029, 202F, 205F, 3000); the
--    app strips a superset first (apps/web lib/inline-rule.ts). PG's "." matches a newline.
--    Executable by authenticated: a CHECK runs with the inserting role's privileges.
create function app.tidy_text(p_value text, p_max int) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select p_value is null
      or (char_length(p_value) between 1 and p_max and p_value ~ '^[^[:space:]](.*[^[:space:]])?$')
$$;

-- 2. Tables.
create table public.places (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid,
  client_group_id uuid,
  label text constraint places_label_check check (app.tidy_text(label, 80)),
  address text constraint places_address_check check (app.tidy_text(address, 300)),
  landmark text constraint places_landmark_check check (app.tidy_text(landmark, 200)),
  directions text constraint places_directions_check check (app.tidy_text(directions, 1000)),
  city text constraint places_city_check check (app.tidy_text(city, 80)),
  region text constraint places_region_check check (app.tidy_text(region, 80)),
  postal_code text constraint places_postal_code_check check (app.tidy_text(postal_code, 12)),
  country text constraint places_country_check check (country is null or country in ('US', 'MX')),
  archived_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint places_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade,
  constraint places_group_fkey foreign key (account_id, client_group_id)
    references public.client_groups (account_id, id) on delete cascade,
  constraint places_one_owner check (num_nonnulls(contact_id, client_group_id) = 1),
  constraint places_findable check (num_nonnulls(address, landmark, directions) >= 1),
  constraint places_account_id_id_key unique (account_id, id)
);

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  place_id uuid not null,
  name text not null constraint equipment_name_check check (app.tidy_text(name, 80)),
  make text constraint equipment_make_check check (app.tidy_text(make, 60)),
  model text constraint equipment_model_check check (app.tidy_text(model, 60)),
  serial text constraint equipment_serial_check check (app.tidy_text(serial, 60)),
  notes text constraint equipment_notes_check check (app.tidy_text(notes, 1000)),
  installed_on date,
  warranty_until date,
  replaces_id uuid,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint equipment_place_fkey foreign key (account_id, place_id)
    references public.places (account_id, id) on delete cascade,
  constraint equipment_place_id_id_key unique (place_id, id),
  constraint equipment_not_self check (replaces_id is null or replaces_id <> id),
  constraint equipment_replacement_dated check (replaces_id is null or installed_on is not null),
  constraint equipment_warranty_order check (warranty_until is null or installed_on is null or warranty_until >= installed_on)
);
-- Same place, so the same account. NO ACTION: a unit something replaced cannot be deleted on its
-- own; a place's cascade removes the whole chain in one statement.
alter table public.equipment add constraint equipment_replaces_fkey foreign key (place_id, replaces_id)
  references public.equipment (place_id, id);

create index places_by_contact on public.places (account_id, contact_id) where contact_id is not null;
create index places_by_group on public.places (account_id, client_group_id) where client_group_id is not null;
create index equipment_by_place on public.equipment (account_id, place_id);
create unique index equipment_one_successor on public.equipment (replaces_id) where replaces_id is not null;

-- 3. Grants. Identity columns stay out of UPDATE, as 0070 kept them out.
alter table public.places enable row level security;
alter table public.equipment enable row level security;
revoke all on public.places, public.equipment from anon, authenticated;
grant select, insert, delete on public.places, public.equipment to authenticated;
grant update (label, address, landmark, directions, city, region, postal_code, country,
              contact_id, client_group_id, archived_at, updated_at) on public.places to authenticated;
grant update (name, make, model, serial, notes, installed_on, warranty_until, updated_at)
  on public.equipment to authenticated;
grant select, insert, update, delete on public.places, public.equipment to service_role;

-- 4. The tenant policies, 0070's shape.
create policy places_member_all on public.places for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());
create policy equipment_member_all on public.equipment for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- 5. The Technician (P3, O2). SECURITY DEFINER, so the equipment policy never re-enters places'.
create function app.my_place_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select p.id from public.places p
   where p.account_id = app.current_account_id()
     and (p.contact_id in (select app.my_contact_ids()) or p.client_group_id in (select app.my_client_group_ids()))
$$;
create policy places_technician_scope on public.places as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or client_group_id in (select app.my_client_group_ids()))
  with check ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or client_group_id in (select app.my_client_group_ids()));
create policy equipment_technician_scope on public.equipment as restrictive for all to authenticated
  using ((select app.sees_all_customers(app.current_account_id())) or place_id in (select app.my_place_ids()))
  with check ((select app.sees_all_customers(app.current_account_id())) or place_id in (select app.my_place_ids()));

-- 6. A client token deletes only an EMPTY place (C5). Referential cascades bypass row security.
create policy places_delete_empty on public.places as restrictive for delete to authenticated
  using (not exists (select 1 from public.equipment e where e.place_id = places.id));

-- 7. Triggers. Plain, not definer, so current_user is the caller (0068's tasks_assignee_guard).
create function app.stamp_created_by() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.created_by := app.current_user_id();
  end if;
  return new;
end $$;
create trigger places_stamp_created_by before insert on public.places
  for each row execute function app.stamp_created_by();
create trigger equipment_stamp_created_by before insert on public.equipment
  for each row execute function app.stamp_created_by();

create function app.places_owner_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.contact_id is distinct from old.contact_id or new.client_group_id is distinct from old.client_group_id)
     and current_user = 'authenticated'
     and not coalesce(app.sees_all_customers(new.account_id), false) then
    raise exception 'places: only an Owner or Staff can change who a property belongs to' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger places_owner_guard before update of contact_id, client_group_id on public.places
  for each row execute function app.places_owner_guard();

revoke all on function app.tidy_text(text, int) from public, anon;
revoke all on function app.my_place_ids() from public, anon;
revoke all on function app.stamp_created_by() from public, anon;
revoke all on function app.places_owner_guard() from public, anon;
grant execute on function app.tidy_text(text, int) to authenticated, service_role;
grant execute on function app.my_place_ids() to authenticated, service_role;
grant execute on function app.stamp_created_by() to authenticated, service_role;
grant execute on function app.places_owner_guard() to authenticated, service_role;
```

- [ ] **Step 7: Check the file, build `post`, run green.**

```bash
source "<SCRATCH>/s02c-t1-impl/env.sh" && cd <WORKTREE>
grep -c '\\' packages/db/supabase/migrations/0071_places_and_equipment.sql        # expected: 0
LC_ALL=C grep -c '[^ -~]' packages/db/supabase/migrations/0071_places_and_equipment.sql  # expected: 0
P -c "create database post template pre"
P -d post -1 -f packages/db/supabase/migrations/0071_places_and_equipment.sql
cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55480/post NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= BIS_CI_SUPABASE_REF= pnpm exec vitest run src/test/places-schema.test.ts src/test/places-rls.test.ts > "$S/t1-green.txt" 2>&1; echo $? > "$S/t1-green.exit"
```

Expected: `0`, `0`, a clean apply, and `Tests  29 passed (29)` (19 schema, 10 RLS; count the `it`s if you changed any and report the exact line). If the cascade case fails with `23503` on `equipment_replaces_fkey`, stop and report: do not change the FK's action without review (it is spec C6's refusal).

- [ ] **Step 8: The schema guard, red then green.** Run `src/test/schema-grants-guard.test.ts` on `post` with the same env prefix. Expected red: `gives anon nothing and authenticated exactly the allow-listed writes`, naming the two new keys. Add to `EXPECTED_WRITES`, after `"authenticated custom_values": IUD,`:

```ts
  "authenticated equipment": insertDeleteAndUpdate([
    "installed_on", "make", "model", "name", "notes", "serial", "updated_at", "warranty_until",
  ]),
```

and after `"authenticated pipelines": IUD,`:

```ts
  "authenticated places": insertDeleteAndUpdate([
    "address", "archived_at", "city", "client_group_id", "contact_id", "country", "directions", "label",
    "landmark", "postal_code", "region", "updated_at",
  ]),
```

Re-run green. Then the neighbours on `post`, to prove nothing else moved: `src/test/technician-scope.test.ts src/test/client-groups-rls.test.ts src/test/contact-relationships-schema.test.ts src/test/rls.test.ts src/test/server-only-writes-grants.test.ts`. Paste the summary lines.

- [ ] **Step 9: Mutation probes** on `post`. Apply each with `P -d post -c "…"`, run the named file, paste the failing test's NAME, then rebuild `post` (`P -c "drop database post" && P -c "create database post template pre" && P -d post -1 -f …0071…`):
  (a) `drop policy places_technician_scope on public.places;` → "reads their customer's place and their customer's household's place…" fails;
  (b) `drop policy places_technician_scope on public.places; create policy places_technician_scope on public.places as restrictive for all to authenticated using ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids())) with check ((select app.sees_all_customers(app.current_account_id())) or contact_id in (select app.my_contact_ids()));` → "edits their customer's place and the shared household's…" fails;
  (c) `drop policy places_delete_empty on public.places;` → "deleting a place with units affects no row…" fails;
  (d) `drop trigger places_owner_guard on public.places;` → "cannot move a place between a person and a group even inside their reach…" fails;
  (e) `alter table public.equipment drop constraint equipment_replaces_fkey; alter table public.equipment add constraint equipment_replaces_fkey foreign key (replaces_id) references public.equipment (id);` → "a replacement must be at the same place…" fails;
  (f) `drop trigger places_stamp_created_by on public.places;` → "an Owner's insert stamps created_by…" fails.

- [ ] **Step 10: Stop the replica and commit.**

```bash
"$PGBIN/pg_ctl" -D "$S/pgdata" stop
git add packages/db/supabase/migrations/0071_places_and_equipment.sql packages/db/src/test/places-schema.test.ts packages/db/src/test/places-rls.test.ts packages/db/src/test/schema-grants-guard.test.ts
git commit -m "feat(db): places and equipment, one owner per place, replaced units kept, Technician fences (migration 0071)" -- packages/db/supabase/migrations/0071_places_and_equipment.sql packages/db/src/test/places-schema.test.ts packages/db/src/test/places-rls.test.ts packages/db/src/test/schema-grants-guard.test.ts
```

Do NOT apply 0071 anywhere but your replica.

**Reviewer (opus):** rebuild your own replica on `55481` in `s02c-t1-review/`, re-run steps 5, 7 and 8, run probe (d) and one probe of your own that the implementer did not run, and read the migration line by line against spec §5.

---

## Task 2: `@bis/db` `places.ts`, the barrel and the teardown list

**Owner:** bis-crm. **Review:** opus. **Runs:** after Task 1 (parallel with Task 3). **Scratch:** `s02c-t2-impl/`, Postgres `55482`, PostgREST `55483`, gateway `55484` (reviewer `s02c-t2-review/`, `55485`–`55487`).

**Files**
- Create: `packages/db/src/places.ts`
- Create: `packages/db/src/test/places.test.ts`
- Modify: `packages/db/src/index.ts` (one export block after the relationships blocks)
- Modify: `packages/db/src/account-teardown.ts` (`ACCOUNT_OWNED_TABLES`: `"equipment", "places",` right after `"tags",`)

**Interfaces**
- Consumes: Task 1's tables; `emit(db, accountId, type, actorId, payload, actorType?)` (`events.ts:16`); `isUserClient` (`user-client.ts:30`); `type GroupKind` (`client-groups.ts:17`); in tests `createContact` (`contacts.ts`), `createGroupWithMember` (`client-groups.ts`), `withTestAccount` (`test/fixtures.ts:140`).
- Produces (exported from `@bis/db`):

```ts
export class PlaceDbError extends Error { readonly code: string | undefined }
export const MAX_PLACES_READ = 100;
export const MAX_EQUIPMENT_READ = 500;
export type PlaceRow = { id: string; account_id: string; contact_id: string | null; client_group_id: string | null; label: string | null; address: string | null; landmark: string | null; directions: string | null; city: string | null; region: string | null; postal_code: string | null; country: "US" | "MX" | null; archived_at: string | null; created_by: string | null; created_at: string; updated_at: string };
export type EquipmentRow = { id: string; account_id: string; place_id: string; name: string; make: string | null; model: string | null; serial: string | null; notes: string | null; installed_on: string | null; warranty_until: string | null; replaces_id: string | null; created_by: string | null; created_at: string; updated_at: string };
export type PlaceOwner = { contactId: string; groupId: null } | { contactId: null; groupId: string };
export type PlaceFields = Pick<PlaceRow, "label" | "address" | "landmark" | "directions" | "city" | "region" | "postal_code" | "country">;
export type PlacePatch = Partial<PlaceFields>;
export type EquipmentFields = Pick<EquipmentRow, "name" | "make" | "model" | "serial" | "notes" | "installed_on" | "warranty_until">;
export type EquipmentPatch = Partial<EquipmentFields>;
export type ContactPlaceGroup = { id: string; kind: GroupKind; name: string; isPrimary: boolean };
export type ContactPlaces = { groups: ContactPlaceGroup[]; places: PlaceRow[]; placeCount: number; equipment: EquipmentRow[]; equipmentCount: number };
/** subjectId: the record the action was taken from, carried in every event payload. */
export type PlaceCtx = { subjectId: string; actorId: string; actorType?: ActorType };
export async function listContactPlaces(db: SupabaseClient, accountId: string, contactId: string): Promise<ContactPlaces>;
export async function getPlace(db: SupabaseClient, accountId: string, placeId: string): Promise<PlaceRow | null>;
export async function getEquipment(db: SupabaseClient, accountId: string, equipmentId: string): Promise<EquipmentRow | null>;
export async function addPlace(db: SupabaseClient, accountId: string, owner: PlaceOwner, fields: PlaceFields, ctx: PlaceCtx): Promise<PlaceRow>;
export async function updatePlace(db: SupabaseClient, accountId: string, placeId: string, patch: PlacePatch, ctx: PlaceCtx): Promise<{ previous: PlacePatch; row: PlaceRow } | "not_found" | "refused">;
export async function setPlaceOwner(db: SupabaseClient, accountId: string, placeId: string, owner: PlaceOwner, ctx: PlaceCtx): Promise<{ previous: PlaceOwner; row: PlaceRow } | "not_found" | "refused">;
export async function removePlace(db: SupabaseClient, accountId: string, placeId: string, ctx: PlaceCtx): Promise<{ mode: "deleted"; snapshot: PlaceRow } | { mode: "archived"; row: PlaceRow } | "not_found" | "refused">;
export async function setPlaceArchived(db: SupabaseClient, accountId: string, placeId: string, archived: boolean, ctx: PlaceCtx): Promise<PlaceRow | "not_found" | "refused">;
export async function restorePlace(db: SupabaseClient, accountId: string, snapshot: PlaceRow, ctx: PlaceCtx): Promise<PlaceRow>;
export async function addEquipment(db: SupabaseClient, accountId: string, placeId: string, fields: EquipmentFields, ctx: PlaceCtx): Promise<EquipmentRow>;
export async function replaceEquipment(db: SupabaseClient, accountId: string, equipmentId: string, fields: EquipmentFields, ctx: PlaceCtx): Promise<EquipmentRow | "not_found">;
export async function updateEquipment(db: SupabaseClient, accountId: string, equipmentId: string, patch: EquipmentPatch, ctx: PlaceCtx): Promise<{ previous: EquipmentPatch; row: EquipmentRow } | "not_found" | "refused">;
export async function removeEquipment(db: SupabaseClient, accountId: string, equipmentId: string, ctx: PlaceCtx): Promise<EquipmentRow | "not_found" | "refused">;
export async function restoreEquipment(db: SupabaseClient, accountId: string, snapshot: EquipmentRow, ctx: PlaceCtx): Promise<EquipmentRow>;
```

Events (spec §6): `place.added`, `place.updated` (`fields`), `place.owner_changed`, `place.removed` (`mode`), `place.restored`, `equipment.added`, `equipment.replaced` (`replacedId`), `equipment.updated` (`fields`), `equipment.removed`, `equipment.restored`. Payload `{ contactId: ctx.subjectId, placeId, equipmentId? , … }`: ids and field names only, never typed text.

- [ ] **Step 1: Stand up your local API.** Build the replica exactly as Task 1 steps 1 and 7 on port `55482` (database `post`, Task 1's committed 0071 applied). Then copy the relationships plan's Task 2 step 1 harness (`gateway.mjs`, `pgrst.conf`, `run.sh`; `git show origin/main:docs/superpowers/plans/2026-10-11-contact-relationships.md`, its "Stand up your local API" step) into `s02c-t2-impl/`, changing only: ports `55472`/`55473`/`55474` → `55482`/`55483`/`55484`, the scratch path to `s02c-t2-impl`, and the local-only secret string to `local-replica-only-secret-s02c-not-a-real-key-0071` (in both `gateway.mjs` and `pgrst.conf`). Fingerprint: `run.sh fp.txt src/test/contacts.test.ts` is green. **If the local API is not up in 20 minutes, stop and report**; the orchestrator then proves this task through CI `verify`. Never run it against bis-ci.

- [ ] **Step 2: Write the failing test** `packages/db/src/test/places.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { createGroupWithMember } from "../client-groups";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import {
  listContactPlaces, addPlace, removePlace, setPlaceArchived, restorePlace, addEquipment, replaceEquipment,
  updatePlace, removeEquipment, restoreEquipment, PlaceDbError, type PlaceFields, type EquipmentFields,
} from "../places";

const ACTOR = "user_test";
const fields = (over: Partial<PlaceFields> = {}): PlaceFields => ({
  label: null, address: "1204 Nolana Ave", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null, ...over,
});
const unit = (over: Partial<EquipmentFields> = {}): EquipmentFields => ({
  name: "AC upstairs", make: "Trane", model: "XR14", serial: null, notes: null, installed_on: "2019-03-03", warranty_until: null, ...over,
});

describe("listContactPlaces (spec §6)", () => {
  it("returns the person's own places and their groups' places with the units there and real counts, never another person's", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const luis = (await createContact(db, accountId, { firstName: "Luis" }, ACTOR)).id;
      const home = await createGroupWithMember(db, accountId, ana, "household", "Garcia", null, ACTOR);
      if (home.status !== "ok") throw new Error("group");
      const ctx = { subjectId: ana, actorId: ACTOR };
      const own = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const shared = await addPlace(db, accountId, { contactId: null, groupId: home.groupId }, fields({ address: null, landmark: "past the canal" }), ctx);
      await addPlace(db, accountId, { contactId: luis, groupId: null }, fields({ address: "9 Other St" }), { subjectId: luis, actorId: ACTOR });
      await addEquipment(db, accountId, own.id, unit(), ctx);
      await addEquipment(db, accountId, shared.id, unit({ name: "Water heater" }), ctx);
      const r = await listContactPlaces(db, accountId, ana.toUpperCase());
      expect(r.places.map((p) => p.id).sort()).toEqual([own.id, shared.id].sort());
      expect(r.placeCount).toBe(2);
      expect(r.equipment.map((e) => e.name).sort()).toEqual(["AC upstairs", "Water heater"]);
      expect(r.equipmentCount).toBe(2);
      expect(r.groups).toEqual([{ id: home.groupId, kind: "household", name: "Garcia", isPrimary: true }]);
    }));
});

describe("removing and restoring a place (C5)", () => {
  it("deletes an empty place and archives one with units (mutation: skip the unit count -> the service client's delete cascades the unit and FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const empty = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const full = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields({ address: "9 Full St" }), ctx);
      await addEquipment(db, accountId, full.id, unit(), ctx);
      const a = await removePlace(db, accountId, empty.id, ctx);
      expect(a).toMatchObject({ mode: "deleted", snapshot: { id: empty.id, address: "1204 Nolana Ave" } });
      const b = await removePlace(db, accountId, full.id, ctx);
      expect(b).toMatchObject({ mode: "archived", row: { id: full.id } });
      expect((b as { row: { archived_at: string | null } }).row.archived_at).not.toBeNull();
      const { count } = await db.from("equipment").select("id", { count: "exact", head: true }).eq("place_id", full.id);
      expect(count).toBe(1);
    }));
  it("restorePlace brings back the same id; setPlaceArchived(false) puts an archived place back", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields({ landmark: "blue house" }), ctx);
      const gone = await removePlace(db, accountId, p.id, ctx);
      if (typeof gone === "string" || gone.mode !== "deleted") throw new Error("expected a delete");
      const back = await restorePlace(db, accountId, gone.snapshot, ctx);
      expect(back).toMatchObject({ id: p.id, address: "1204 Nolana Ave", landmark: "blue house" });
      await addEquipment(db, accountId, p.id, unit(), ctx);
      await removePlace(db, accountId, p.id, ctx);
      expect(await setPlaceArchived(db, accountId, p.id, false, ctx)).toMatchObject({ id: p.id, archived_at: null });
    }));
  it("updatePlace answers the previous values for Undo", () => withTestAccount(async (db, accountId) => {
    const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
    const ctx = { subjectId: ana, actorId: ACTOR };
    const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
    expect(await updatePlace(db, accountId, p.id, { landmark: "past the canal" }, ctx))
      .toMatchObject({ previous: { landmark: null }, row: { landmark: "past the canal" } });
  }));
});

describe("equipment: replace, remove, restore (C3, C6)", () => {
  it("a replacement is linked to the old unit at its place; replacing it again answers 23505", () => withTestAccount(async (db, accountId) => {
    const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
    const ctx = { subjectId: ana, actorId: ACTOR };
    const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
    const old = await addEquipment(db, accountId, p.id, unit(), ctx);
    const next = await replaceEquipment(db, accountId, old.id, unit({ make: "Carrier", installed_on: "2026-10-11" }), ctx);
    expect(next).toMatchObject({ place_id: p.id, replaces_id: old.id, make: "Carrier" });
    await expect(replaceEquipment(db, accountId, old.id, unit({ installed_on: "2026-10-11" }), ctx))
      .rejects.toSatisfy((e: unknown) => e instanceof PlaceDbError && e.code === "23505");
  }));
  it("a replaced unit cannot be removed (23503); a current one can, and restoreEquipment brings back the same id and link (mutation: restore without the id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const old = await addEquipment(db, accountId, p.id, unit(), ctx);
      const next = await replaceEquipment(db, accountId, old.id, unit({ installed_on: "2026-10-11" }), ctx);
      if (typeof next === "string") throw new Error("replace");
      await expect(removeEquipment(db, accountId, old.id, ctx))
        .rejects.toSatisfy((e: unknown) => e instanceof PlaceDbError && e.code === "23503");
      const snap = await removeEquipment(db, accountId, next.id, ctx);
      if (typeof snap === "string") throw new Error("remove");
      expect(await restoreEquipment(db, accountId, snap, ctx)).toMatchObject({ id: next.id, replaces_id: old.id });
    }));
});

describe("events (spec §6)", () => {
  it("each write appends its event, with the subject and ids and never typed text (mutation: drop the emit in replaceEquipment -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
      const ctx = { subjectId: ana, actorId: ACTOR };
      const p = await addPlace(db, accountId, { contactId: ana, groupId: null }, fields(), ctx);
      const old = await addEquipment(db, accountId, p.id, unit(), ctx);
      await replaceEquipment(db, accountId, old.id, unit({ installed_on: "2026-10-11" }), ctx);
      await updatePlace(db, accountId, p.id, { landmark: "past the canal" }, ctx);
      const { data } = await db.from("events").select("type, actor_id, payload").eq("account_id", accountId)
        .in("type", ["place.added", "equipment.added", "equipment.replaced", "place.updated"]).order("created_at");
      expect((data ?? []).map((e) => e.type)).toEqual(["place.added", "equipment.added", "equipment.replaced", "place.updated"]);
      for (const e of data ?? []) {
        expect(e.actor_id).toBe(ACTOR);
        expect((e.payload as { contactId: string }).contactId).toBe(ana);
        expect(JSON.stringify(e.payload)).not.toMatch(/Nolana|canal|Trane/);
      }
      expect(data![2]!.payload).toMatchObject({ replacedId: old.id });
      expect(data![3]!.payload).toMatchObject({ fields: ["landmark"] });
    }));
});

describe("account teardown (spec §5.3)", () => {
  it("lists equipment, then places, ahead of the client groups and contacts they reference (mutation: drop either name -> FAILS)", () => {
    const at = (t: string) => ACCOUNT_OWNED_TABLES.indexOf(t as (typeof ACCOUNT_OWNED_TABLES)[number]);
    expect(at("equipment")).toBeGreaterThanOrEqual(0);
    expect(at("equipment")).toBeLessThan(at("places"));
    expect(at("places")).toBeLessThan(at("client_group_members"));
    expect(at("places")).toBeLessThan(at("contacts"));
  });
});
```

Read `createContact`'s and `createGroupWithMember`'s exact signatures from the source before running (rule 1); if either differs from the calls above, follow the source and note it.

- [ ] **Step 3: Run red.** `run.sh t2-red.txt src/test/places.test.ts`. Expected: `Failed to resolve import "../places"`. Paste the line.

- [ ] **Step 4: Write `packages/db/src/places.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { isUserClient } from "./user-client";
import type { GroupKind } from "./client-groups";

/**
 * Properties and equipment (spec §6, migration 0071). Every function runs on whichever client the
 * caller passes: the request client for a person's own action, so 0071's RLS and Technician fences
 * bind it. "Refused" is a zero-row write: RLS raises nothing on an UPDATE or DELETE its USING
 * filters out, so writers read first, and found-but-not-written is the refusal.
 */
export class PlaceDbError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) { super(message); this.name = "PlaceDbError"; this.code = code || undefined; }
}
const dbError = (what: string, e: { message: string; code?: string }) => new PlaceDbError(`${what}: ${e.message}`, e.code);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(v: string, what: string): void { if (!UUID.test(v)) throw new PlaceDbError(`${what}: not a uuid`, "22P02"); }
function assertActorAllowed(db: SupabaseClient, actorType: ActorType): void {
  if (isUserClient(db) && actorType !== "user") throw new PlaceDbError(`a signed-in user's client cannot record a '${actorType}' actor on a place`, undefined);
}

export const MAX_PLACES_READ = 100;
export const MAX_EQUIPMENT_READ = 500;
const PLACE_COLUMNS = "id, account_id, contact_id, client_group_id, label, address, landmark, directions, city, region, postal_code, country, archived_at, created_by, created_at, updated_at";
const EQUIPMENT_COLUMNS = "id, account_id, place_id, name, make, model, serial, notes, installed_on, warranty_until, replaces_id, created_by, created_at, updated_at";
// … the exported types exactly as this task's Interfaces list them …

const now = () => new Date().toISOString();
async function event(db: SupabaseClient, accountId: string, type: string, ctx: PlaceCtx, ids: Record<string, unknown>) {
  await emit(db, accountId, type, ctx.actorId, { contactId: ctx.subjectId, ...ids }, ctx.actorType ?? "user");
}

export async function listContactPlaces(db: SupabaseClient, accountId: string, contactId: string): Promise<ContactPlaces> {
  assertUuid(contactId, "listContactPlaces");
  const id = contactId.toLowerCase(); // PostgREST echoes ids lowercase; the or= filter is built from it
  const { data: mem, error: mErr } = await db.from("client_group_members").select("client_group_id, is_primary")
    .eq("account_id", accountId).eq("contact_id", id);
  if (mErr) throw dbError("listContactPlaces memberships read failed", mErr);
  const memberships = (mem ?? []) as { client_group_id: string; is_primary: boolean }[];
  const groupIds = memberships.map((m) => m.client_group_id);
  const base = db.from("places").select(PLACE_COLUMNS, { count: "exact" }).eq("account_id", accountId);
  const owned = groupIds.length > 0 ? base.or(`contact_id.eq.${id},client_group_id.in.(${groupIds.join(",")})`) : base.eq("contact_id", id);
  const { data: pData, count: placeCount, error: pErr } = await owned
    .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(MAX_PLACES_READ);
  if (pErr) throw dbError("listContactPlaces places read failed", pErr);
  const places = (pData ?? []) as unknown as PlaceRow[];
  let equipment: EquipmentRow[] = [];
  let equipmentCount = 0;
  if (places.length > 0) {
    const { data, count, error } = await db.from("equipment").select(EQUIPMENT_COLUMNS, { count: "exact" })
      .eq("account_id", accountId).in("place_id", places.map((p) => p.id))
      .order("created_at", { ascending: true }).order("id", { ascending: true }).limit(MAX_EQUIPMENT_READ);
    if (error) throw dbError("listContactPlaces equipment read failed", error);
    equipment = (data ?? []) as unknown as EquipmentRow[];
    equipmentCount = count ?? equipment.length;
  }
  let groups: ContactPlaceGroup[] = [];
  if (groupIds.length > 0) {
    const { data, error } = await db.from("client_groups").select("id, kind, name").eq("account_id", accountId).in("id", groupIds);
    if (error) throw dbError("listContactPlaces groups read failed", error);
    groups = ((data ?? []) as { id: string; kind: GroupKind; name: string }[])
      .map((g) => ({ ...g, isPrimary: memberships.some((m) => m.client_group_id === g.id && m.is_primary) }));
  }
  return { groups, places, placeCount: placeCount ?? places.length, equipment, equipmentCount };
}

export async function removePlace(db: SupabaseClient, accountId: string, placeId: string, ctx: PlaceCtx) {
  assertActorAllowed(db, ctx.actorType ?? "user");
  const current = await getPlace(db, accountId, placeId);
  if (!current) return "not_found" as const;
  // Count first (plan deviation 5): the service role bypasses places_delete_empty.
  const { count, error: cErr } = await db.from("equipment").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).eq("place_id", placeId);
  if (cErr) throw dbError("removePlace unit count failed", cErr);
  if ((count ?? 0) === 0) {
    const { data, error } = await db.from("places").delete().eq("account_id", accountId).eq("id", placeId).select("id");
    if (error) throw dbError("removePlace delete failed", error);
    if ((data ?? []).length === 1) {
      await event(db, accountId, "place.removed", ctx, { placeId, mode: "deleted" });
      return { mode: "deleted" as const, snapshot: current };
    }
    // 0 rows: a unit arrived since the count (places_delete_empty refused). Keep it: archive.
  }
  const row = await writeArchived(db, accountId, placeId, true);
  if (!row) return "refused" as const;
  await event(db, accountId, "place.removed", ctx, { placeId, mode: "archived" });
  return { mode: "archived" as const, row };
}
```

Write the rest to the Interfaces: `getPlace`/`getEquipment` (`maybeSingle`, `assertUuid`); `addPlace` (insert owner + fields, `.select(PLACE_COLUMNS).single()`, emit `place.added`); `updatePlace`/`updateEquipment` (refuse an empty patch or a key outside the field set with `22023`; read first → `not_found`; update `{ ...patch, updated_at: now() }` `.select()`; no row → `refused`; `previous` = the current row's values for the patched keys; emit `*.updated` with `fields: Object.keys(patch)`); `setPlaceOwner` (read first; update `contact_id`/`client_group_id`; a `42501` from 0071's trigger is THROWN as `PlaceDbError`, never turned into `refused`; emit `place.owner_changed`); `setPlaceArchived` (via `writeArchived`, emitting `place.removed` `{ mode: "archived" }` or `place.restored`); `restorePlace` (insert every column but `created_by`, `created_at`, `updated_at`, with the snapshot's `id`; emit `place.restored`); `addEquipment` (emit `equipment.added`); `replaceEquipment` (read the old unit → `not_found`; insert `{ place_id: old.place_id, replaces_id: old.id, ...fields }`; emit `equipment.replaced` with `replacedId`); `removeEquipment` (read first; delete `.select()`; a `23503` is thrown; no row → `refused`; emit `equipment.removed`); `restoreEquipment` (same id and `replaces_id`; emit `equipment.restored`). Every function calls `assertActorAllowed` before any read.

- [ ] **Step 5: Barrel and teardown.** In `packages/db/src/index.ts`, after the `./relationship-keys` export block, add:

```ts
// Properties and equipment (0071). See ./places.ts.
export {
  listContactPlaces, getPlace, getEquipment, addPlace, updatePlace, setPlaceOwner, removePlace, setPlaceArchived,
  restorePlace, addEquipment, replaceEquipment, updateEquipment, removeEquipment, restoreEquipment,
  PlaceDbError, MAX_PLACES_READ, MAX_EQUIPMENT_READ,
  type PlaceRow, type EquipmentRow, type PlaceOwner, type PlaceFields, type PlacePatch, type EquipmentFields,
  type EquipmentPatch, type ContactPlaceGroup, type ContactPlaces, type PlaceCtx,
} from "./places";
```

In `account-teardown.ts`, change `"custom_values", "tags", "contact_relationships",` to `"custom_values", "tags", "equipment", "places", "contact_relationships",` (read the line first; Task 0's merge decides its exact text).

- [ ] **Step 6: Run green.** `run.sh t2-green.txt src/test/places.test.ts src/test/contacts.test.ts src/test/demo-seed.test.ts`, then `pnpm --filter @bis/db exec tsc --noEmit > "$S/tsc.txt" 2>&1; echo $? > "$S/tsc.exit"` and `pnpm --filter web typecheck > "$S/web-tsc.txt" 2>&1; echo $? > "$S/web-tsc.exit"`. Paste every summary line and both exit codes.

- [ ] **Step 7: Mutation probes:** (a) in `removePlace` delete the unit count block (go straight to the delete) → "deletes an empty place and archives one with units…" fails (the service client's delete cascades the unit); (b) delete the `event(…)` call in `replaceEquipment` → "each write appends its event…" fails; (c) in `restoreEquipment` omit `id` from the insert → "a replaced unit cannot be removed… same id and link" fails; (d) remove `"places"` from `ACCOUNT_OWNED_TABLES` → "lists equipment, then places…" fails. Paste each failing name, revert.

- [ ] **Step 8: Stop PostgREST, the gateway and the replica; commit.**

```bash
git add packages/db/src/places.ts packages/db/src/test/places.test.ts packages/db/src/index.ts packages/db/src/account-teardown.ts
git commit -m "feat(db): places.ts queries for properties and equipment, exported, in the account teardown" -- packages/db/src/places.ts packages/db/src/test/places.test.ts packages/db/src/index.ts packages/db/src/account-teardown.ts
```

**Reviewer (opus):** stand up your own API on `55485`–`55487`; re-run step 6; run probe (a) and one of your own.

---

## Task 3: `InlineField`: multi-line, date, a `rule` arm and `locale`

**Owner:** bis-frontend. **Review:** sonnet. **Runs:** after Task 0, parallel with Tasks 1 and 2 (disjoint files). **Scratch:** `s02c-t3-impl/`. No database. The only `messages.ts` writer while it runs.

**Files**
- Create: `apps/web/src/lib/inline-rule.ts`, `apps/web/src/lib/inline-rule.test.ts`
- Create: `apps/web/src/components/inline-field.editing.test.ts`
- Modify: `apps/web/src/components/inline-field.tsx` (additive), `apps/web/src/components/inline-field.test.ts` (new cases only)
- Modify: `apps/web/src/lib/contacts/inline-save.ts` (`inlineSavedView` takes a `locale`, default `"en"`), `apps/web/src/lib/contacts/inline-save.test.ts` (one case)
- Modify: `apps/web/src/lib/messages.ts` (`.es` twins for `common.undo`, `inline.saved`, `inline.edit`, `inline.empty`, `inline.crashed`; the `inline.rule.*` keys)
- Possibly modify: `apps/web/src/lib/i18n/catalogue-baseline.json`, `ratchet-baseline.json` (only through the regeneration command)

**Interfaces**
- Produces:

```ts
// lib/inline-rule.ts (plain module: the server re-runs the same check, enum-value.ts's precedent)
export type InlineRule =
  | { kind: "text"; max: number; required: boolean }
  | { kind: "date"; required: boolean; notAfter?: string }; // notAfter: "YYYY-MM-DD", the account's today
export function cleanEdgeSpace(v: string): string; // strips a superset of 0070/0071's measured [:space:] at both edges
export function codePoints(v: string): number;
export function validateInlineRule(rule: InlineRule, raw: string, locale?: Locale): { ok: true; value: string } | { ok: false; error: string };
// components/inline-field.tsx: a fourth arm and three props, every existing call site unchanged
//   | { rule: InlineRule; field?: undefined; required?: undefined; options?: undefined }
//   inputType?: "text" | "email" | "tel" | "date" | "multiline"
//   display?: "date"           // at rest, a YYYY-MM-DD value prints with formatDateUTC in the locale
//   locale?: Locale            // default "en": its own chrome (Undo, Edit, Add…, saved, crashed) follows it
// lib/contacts/inline-save.ts
export function inlineSavedView(typed: string, label: string, result: { shown?: string; undoPayload?: unknown }, locale?: Locale): { shown: string; kind: "saved" | "already"; message: string };
```

- [ ] **Step 1: Copy first.** In `messages.ts`, add a twin under each key (read the lines first; today `common.undo` is `:294`, the `inline.*` block `:333-341`):

```ts
  "common.undo.es": "Deshacer",
  "inline.saved.es": "Guardado: {label}",
  "inline.edit.es": "Editar {label}",
  "inline.empty.es": "Agregar…",
  "inline.crashed.es": "No se guardó; puede que la página esté desactualizada. Vuelva a cargarla e intente de nuevo.",
  "inline.rule.required": "This can't be empty.",
  "inline.rule.required.es": "Esto no puede quedar vacío.",
  "inline.rule.tooLong": "Keep it to {max} characters.",
  "inline.rule.tooLong.es": "Use {max} caracteres como máximo.",
  "inline.rule.badDate": "Pick a real date.",
  "inline.rule.badDate.es": "Elija una fecha válida.",
  "inline.rule.future": "Pick a date that isn't in the future.",
  "inline.rule.future.es": "Elija una fecha que no sea futura.",
```

(the four `inline.rule.*` pairs go directly after `"inline.invalidOption.es"`). A frozen key that gains its twin passes the parity check (`ratchet.test.ts:166`); then run `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts` and keep whatever it rewrites (never hand-edit either baseline).

- [ ] **Step 2: Write the failing tests.**

`apps/web/src/lib/inline-rule.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validateInlineRule, cleanEdgeSpace, codePoints } from "./inline-rule";
import { m } from "@/lib/messages";

/** 0070's measurement of PG's [:space:] (0070 migration header; 0071 reuses the class). */
const MEASURED = [
  ...Array.from({ length: 5 }, (_, i) => 0x09 + i), ...Array.from({ length: 4 }, (_, i) => 0x1c + i), 0x20, 0x85, 0xa0, 0x1680,
  ...Array.from({ length: 11 }, (_, i) => 0x2000 + i), 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
].map((cp) => String.fromCodePoint(cp));

describe("cleanEdgeSpace", () => {
  it("strips every code point of the database's measured class at both edges, and keeps it inside (mutation: drop 0x85 from EXTRA -> FAILS)", () => {
    for (const ch of MEASURED) {
      expect(cleanEdgeSpace(`${ch}Ana${ch}`), `U+${ch.codePointAt(0)!.toString(16)}`).toBe("Ana");
      expect(cleanEdgeSpace(`A${ch}B`)).toBe(`A${ch}B`);
    }
    expect(cleanEdgeSpace(String.fromCodePoint(0x200b, 0xfeff) + "Ana")).toBe("Ana"); // zero-width space and BOM: stripped too (a superset is safe)
  });
});

describe("validateInlineRule: text", () => {
  const rule = { kind: "text" as const, max: 5, required: false };
  it("counts code points as char_length does, and refuses one past the limit in the reader's language", () => {
    expect(codePoints("🏠🏠🏠")).toBe(3);
    expect(validateInlineRule(rule, " 🏠abcd ")).toEqual({ ok: true, value: "🏠abcd" });
    expect(validateInlineRule(rule, "abcdef")).toEqual({ ok: false, error: m["inline.rule.tooLong"].replace("{max}", "5") });
    expect(validateInlineRule(rule, "abcdef", "es")).toEqual({ ok: false, error: m["inline.rule.tooLong.es"].replace("{max}", "5") });
  });
  it("blank clears an optional field and is refused for a required one (mutation: ignore required -> FAILS)", () => {
    expect(validateInlineRule(rule, "   ")).toEqual({ ok: true, value: "" });
    expect(validateInlineRule({ ...rule, required: true }, "   ")).toEqual({ ok: false, error: m["inline.rule.required"] });
  });
});

describe("validateInlineRule: date", () => {
  it("takes a real YYYY-MM-DD, refuses 2026-02-30 and a date after notAfter, the boundary day allowed (mutation: compare with >= -> FAILS)", () => {
    const rule = { kind: "date" as const, required: false, notAfter: "2026-10-11" };
    expect(validateInlineRule(rule, "2026-10-11")).toEqual({ ok: true, value: "2026-10-11" });
    expect(validateInlineRule(rule, "2026-02-30")).toEqual({ ok: false, error: m["inline.rule.badDate"] });
    expect(validateInlineRule(rule, "2026-10-12")).toEqual({ ok: false, error: m["inline.rule.future"] });
    expect(validateInlineRule(rule, "")).toEqual({ ok: true, value: "" });
    expect(validateInlineRule({ ...rule, required: true }, "")).toEqual({ ok: false, error: m["inline.rule.required"] });
  });
});
```

Append to `apps/web/src/components/inline-field.test.ts` (new describes only; nothing existing changes):

```ts
import { formatDateUTC } from "@/lib/format";

describe("InlineField's rule arm, date display and locale (places spec §8)", () => {
  const html = (props: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(InlineField, { label: "Dirección", value: null, save, rule: { kind: "text", max: 300, required: false }, ...props } as never));

  it("at rest a date field prints the date in the reader's language, never the stored YYYY-MM-DD (mutation: ignore display -> FAILS)", () => {
    const en = html({ label: "Installed", value: "2019-03-03", rule: { kind: "date", required: false }, inputType: "date", display: "date" });
    expect(en).toContain(`>${formatDateUTC("2019-03-03", "en")}</button>`);
    expect(en).not.toContain(">2019-03-03<");
    const es = html({ label: "Instalado", value: "2019-03-03", rule: { kind: "date", required: false }, inputType: "date", display: "date", locale: "es" });
    expect(es).toContain(`>${formatDateUTC("2019-03-03", "es")}</button>`);
  });
  it("locale es: the accessible name and the empty text are Spanish (mutation: read m[...] without the locale -> FAILS)", () => {
    const out = html({ locale: "es" });
    expect(out).toContain(`>${m["inline.empty.es"]}</button>`);
    expect(out).toContain(`aria-label="${m["inline.edit.es"].replace("{label}", "Dirección")}: ${m["inline.empty.es"]}"`);
  });
  it("no locale is English, as every existing caller expects", () => {
    expect(html({})).toContain('aria-label="Edit Dirección: Add…"');
  });
});
```

(Add `import { m } from "@/lib/messages";` at the top if the file lacks it.)

`apps/web/src/components/inline-field.editing.test.ts` (the call-the-component idiom of `groups-card.wiring.test.ts:15-28`: `useState` captured so the field starts in its EDITING branch):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isValidElement, type ReactElement } from "react";

/**
 * The editing branch has no DOM harness in apps/web, so InlineField is CALLED with React's hooks
 * captured: the first boolean state (editing) starts true, and the element it returns is read.
 */
// Reset before every render (beforeEach): a once-per-file flag would leave every case after the
// first rendering at rest, and the editing assertions would then read the wrong element.
const h = vi.hoisted(() => ({ firstBoolean: true, sets: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useRef: (v: unknown) => ({ current: v }),
    useState: (init: unknown) => {
      const set = vi.fn();
      h.sets.push(set);
      if (init === false && h.firstBoolean) { h.firstBoolean = false; return [true, set]; }
      return [init, set];
    },
  };
});
const sets = h.sets;
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));
const { InlineField } = await import("./inline-field");
const { Textarea } = await import("@/components/ui/textarea");
const { Input } = await import("@/components/ui/input");

const save = async () => ({ ok: true as const });
function editor(props: Record<string, unknown>) {
  const el = InlineField({ label: "How to get there", value: "Past the canal", save, rule: { kind: "text", max: 1000, required: false }, ...props } as never);
  if (!isValidElement(el)) throw new Error("no element");
  return el as ReactElement<Record<string, unknown>>;
}
beforeEach(() => { sets.length = 0; h.firstBoolean = true; });

describe("InlineField editing modes", () => {
  it("multiline edits in a Textarea where Enter is a new line, not a save (mutation: blur on Enter in the multiline arm -> FAILS)", () => {
    const el = editor({ inputType: "multiline" });
    expect(el.type).toBe(Textarea);
    const blur = vi.fn();
    (el.props.onKeyDown as (e: unknown) => void)({ key: "Enter", currentTarget: { blur } });
    expect(blur).not.toHaveBeenCalled();
  });
  it("Esc cancels a multiline edit without saving", () => {
    const el = editor({ inputType: "multiline" });
    const blur = vi.fn();
    (el.props.onKeyDown as (e: unknown) => void)({ key: "Escape", currentTarget: { blur } });
    expect(sets.some((s) => s.mock.calls.some(([v]) => v === false))).toBe(true); // editing set back to false
  });
  it("a single-line field still saves on Enter (the existing behaviour)", () => {
    const el = editor({});
    expect(el.type).toBe(Input);
    const blur = vi.fn();
    (el.props.onKeyDown as (e: unknown) => void)({ key: "Enter", currentTarget: { blur } });
    expect(blur).toHaveBeenCalledTimes(1);
  });
  it("a date field is a native date input", () => {
    const el = editor({ inputType: "date", value: "2019-03-03", rule: { kind: "date", required: false } });
    expect(el.type).toBe(Input);
    expect(el.props.type).toBe("date");
  });
});
```

(The `useState` mock relies on `editing` being the first `false`-initialised state in `InlineField`, `inline-field.tsx:107`; read it before running. If the order differs, key the mock on the call index instead and say so.)

Add to `inline-save.test.ts`: `it("the saved message follows the locale (mutation: ignore locale -> FAILS)", () => expect(inlineSavedView("x", "Dirección", {}, "es").message).toBe(m["inline.saved.es"].replace("{label}", "Dirección")))`.

- [ ] **Step 3: Run red.** `pnpm --filter web exec vitest run src/lib/inline-rule.test.ts src/components/inline-field.test.ts src/components/inline-field.editing.test.ts src/lib/contacts/inline-save.test.ts`. Expected: `Failed to resolve import "./inline-rule"`, and the new `inline-field`/`inline-save` cases failing. Paste one line per file.

- [ ] **Step 4: Write `lib/inline-rule.ts`:**

```ts
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/**
 * The fourth InlineField arm's rule, as DATA (serializable across the RSC boundary, like `field`
 * and `required`), checked here so the server action behind the field runs the identical check
 * (lib/enum-value.ts's reasoning). The edge class strips a SUPERSET of PG's [:space:] as 0070
 * measured it, plus the zero-width space and BOM, so a value cleaned here never 23514s on
 * app.tidy_text (0071).
 */
export type InlineRule = { kind: "text"; max: number; required: boolean } | { kind: "date"; required: boolean; notAfter?: string };
// The class as code points (U+001C-001F, U+0085, U+200B, U+FEFF beside \s), built with
// String.fromCodePoint so no invisible character sits in the source.
const EXTRA = String.fromCodePoint(0x1c, 0x1d, 0x1e, 0x1f, 0x85, 0x200b, 0xfeff);
const EDGE = new RegExp(`^[\\s${EXTRA}]+|[\\s${EXTRA}]+$`, "g");
export const cleanEdgeSpace = (v: string): string => v.replace(EDGE, "");
export const codePoints = (v: string): number => [...v].length;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
function realDate(v: string): boolean {
  const p = DATE.exec(v);
  if (!p) return false;
  const d = new Date(Date.UTC(+p[1]!, +p[2]! - 1, +p[3]!));
  return d.getUTCFullYear() === +p[1]! && d.getUTCMonth() === +p[2]! - 1 && d.getUTCDate() === +p[3]!;
}
export function validateInlineRule(rule: InlineRule, raw: string, locale: Locale = "en"):
  { ok: true; value: string } | { ok: false; error: string } {
  const value = cleanEdgeSpace(raw);
  if (value === "") return rule.required ? { ok: false, error: t(m, "inline.rule.required", locale) } : { ok: true, value: "" };
  if (rule.kind === "text") {
    return codePoints(value) <= rule.max ? { ok: true, value } : { ok: false, error: t(m, "inline.rule.tooLong", locale, { max: rule.max }) };
  }
  if (!realDate(value)) return { ok: false, error: t(m, "inline.rule.badDate", locale) };
  if (rule.notAfter && value > rule.notAfter) return { ok: false, error: t(m, "inline.rule.future", locale) };
  return { ok: true, value };
}
```

(`\s` already covers U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028, U+2029, U+202F, U+205F, U+3000 and U+FEFF in JS; the class adds what it misses. This is an `apps/web` module, not a migration: the no-backslash rule does not apply. Check `Locale`'s import path in `lib/i18n/locale.ts` before writing.)

- [ ] **Step 5: `InlineField`.** In `components/inline-field.tsx`: add the fourth union arm `| { field?: undefined; required?: undefined; options?: undefined; rule: InlineRule }` (and `rule?: undefined` on the other three); widen `inputType` to `"text" | "email" | "tel" | "date" | "multiline"`; add `display?: "date"` and `locale?: Locale` (default `"en"`). `normalize` gains `rule ? validateInlineRule(rule, raw, locale)` as its first branch. Every chrome string becomes `t(m, "<key>", locale)` (`common.undo`, `inline.edit` with `{label}` replaced as today, `inline.empty`, `inline.crashed`), and `inlineSavedView(…, locale)`. At rest, `display === "date" && shown` prints `formatDateUTC(shown, locale)` (the button's text and its aria-label). In the editing branch, `inputType === "multiline"` returns `<Textarea autoFocus defaultValue={shown} aria-label={label} placeholder={placeholder} rows={3} onBlur={…same as Input…} onKeyDown={(e) => { if (e.key === "Escape") { cancelled.current = true; setShown(committed.current); setEditing(false); } }} />` (no Enter branch); `"date"` passes `type="date"` to the existing `Input`. Update the doc comment above `InlineField` to name the fourth arm. In `inline-save.ts`, `inlineSavedView` takes `locale: Locale = "en"` and uses `t(m, "inline.saved", locale, { label })` (keep the `alreadyAs` branch as it is).

- [ ] **Step 6: Run green, and every existing caller.** Step 3's command, then every test of a file that renders `InlineField` (`grep -rln "InlineField" apps/web/src --include=*.tsx`, each file's sibling tests), at least: `pnpm --filter web exec vitest run src/components src/lib/contacts src/lib/i18n "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" "src/app/(dashboard)/dashboard/accounts/[accountId]/setup"`; then `pnpm --filter web typecheck` (exit code to a file). Paste every summary line. No existing test may change.

- [ ] **Step 7: Mutation probes:** (a) delete `0x85` from `EXTRA` (JS's `\s` lacks U+0085, so the measured class then fails on it) → "strips every code point of the database's measured class…" fails; (b) in the multiline `onKeyDown`, add `if (e.key === "Enter") e.currentTarget.blur();` → "multiline edits in a Textarea where Enter is a new line…" fails; (c) in the at-rest branch, ignore `display` → "at rest a date field prints the date…" fails; (d) use `m["inline.edit"]` without the locale → "locale es: the accessible name…" fails. Paste each failing name, revert.

- [ ] **Step 8: Definition of done, by hand:** focus ring on the textarea and date input; Esc closes the edit; tokens only (the `Textarea` and `Input` are the UI kit's). `/styleguide`: add one row showing a multi-line and a date `InlineField` if the page lists `InlineField` variants (check it; report either way).

- [ ] **Step 9: Commit.** `git add` the files above (and the baselines if the regeneration changed them), then `git commit -m "feat(design): InlineField takes a multi-line or date edit, a data rule and the reader's language" -- <the same paths>`.

---

## Task 4: Pure helpers: `place-input.ts` and `place-view.ts`

**Owner:** bis-crm. **Review:** sonnet. **Runs:** after Tasks 2 and 3. **Scratch:** `s02c-t4-impl/`. No database, no `messages.ts` edit.

**Files**
- Create: `apps/web/src/lib/contacts/place-input.ts`, `place-input.test.ts`
- Create: `apps/web/src/lib/contacts/place-view.ts`, `place-view.test.ts`

**Interfaces**
- Consumes: `InlineRule`, `validateInlineRule`, `cleanEdgeSpace` (Task 3); `type PlaceRow`, `type EquipmentRow`, `type PlaceFields`, `type EquipmentFields`, `type PlaceOwner`, `type ContactPlaceGroup` (Task 2, type-only imports from `@bis/db`); `isUuid` (`lib/assign/action-guards.ts:11`); `t`, `m`.
- Produces:

```ts
// place-input.ts
export const PLACE_LIMITS = { label: 80, address: 300, landmark: 200, directions: 1000, city: 80, region: 80, postal_code: 12 } as const;
export const EQUIPMENT_LIMITS = { name: 80, make: 60, model: 60, serial: 60, notes: 1000 } as const;
export type PlaceTextField = keyof typeof PLACE_LIMITS;
export type EquipmentTextField = keyof typeof EQUIPMENT_LIMITS;
export type EquipmentDateField = "installed_on" | "warranty_until";
export function placeRule(field: PlaceTextField): InlineRule;                        // text, optional
export function equipmentRule(field: EquipmentTextField | EquipmentDateField, today: string, unit?: Pick<EquipmentRow, "replaces_id">): InlineRule;
//   name: required; installed_on: required when unit.replaces_id (0071's equipment_replacement_dated), notAfter today; warranty_until: optional, no notAfter
export type InputError = { key: string; params?: Record<string, string | number> };  // a messages.ts key
export function parseOwner(v: unknown): PlaceOwner | null;                            // "contact:<uuid>" | "group:<uuid>"
export function ownerValue(o: Pick<PlaceRow, "contact_id" | "client_group_id">): string;
export function parsePlaceFields(raw: unknown, locale?: Locale): { ok: true; fields: PlaceFields } | { ok: false; error: InputError };
//   every text field through placeRule; country "US" | "MX" | "" (→ null); at least one of address, landmark, directions ("places.needOne")
export function parsePlacePatch(field: unknown, value: unknown, current: Pick<PlaceRow, "address" | "landmark" | "directions">, locale?: Locale): { ok: true; patch: PlacePatch } | { ok: false; error: InputError };
//   one known field; clearing the last of address/landmark/directions is "places.needOne"
export function parseEquipmentFields(raw: unknown, today: string, opts: { replacement: boolean }, locale?: Locale): { ok: true; fields: EquipmentFields } | { ok: false; error: InputError };
//   warranty before install: "equipment.warrantyBeforeInstall"
export function parseEquipmentPatch(field: unknown, value: unknown, today: string, current: Pick<EquipmentRow, "installed_on" | "warranty_until" | "replaces_id">, locale?: Locale): { ok: true; patch: EquipmentPatch } | { ok: false; error: InputError };
export function parsePlaceSnapshot(v: unknown, accountId: string): PlaceRow | null;    // the Undo payload, re-checked
export function parseEquipmentSnapshot(v: unknown, accountId: string): EquipmentRow | null;
// place-view.ts
export function placeTitle(p: Pick<PlaceRow, "label" | "address" | "landmark">, locale: Locale): string;
export function cityLine(p: Pick<PlaceRow, "city" | "region" | "postal_code">): string | null; // "McAllen, TX 78501"
export function mapUrl(p: Pick<PlaceRow, "address" | "city" | "region" | "postal_code">): string | null;
export type WarrantyStatus = { kind: "under" | "ended"; until: string } | null;
export function warrantyStatus(warrantyUntil: string | null, today: string): WarrantyStatus;
export type UnitView = { unit: EquipmentRow; history: { unit: EquipmentRow; replacedOn: string }[] };
export function equipmentByPlace(units: readonly EquipmentRow[]): Map<string, UnitView[]>;
export function placesInOrder(places: readonly PlaceRow[], subjectId: string, groups: readonly ContactPlaceGroup[]): { active: PlaceRow[]; removed: PlaceRow[] };
export function ownerOptions(subject: { id: string; name: string }, groups: readonly ContactPlaceGroup[], locale: Locale): { value: string; label: string }[];
export function sharedWith(p: Pick<PlaceRow, "client_group_id">, groups: readonly ContactPlaceGroup[]): ContactPlaceGroup | null;
```

`equipment.warrantyBeforeInstall` ("The warranty can't end before the install date." / "La garantía no puede terminar antes de la fecha de instalación.") is added by Task 5 with the other error keys; this task's tests compare the KEY, not the text.

- [ ] **Step 1: Write the failing tests** (`place-input.test.ts`, `place-view.test.ts`). The required cases, each by name:
  - `parsePlaceFields`: "keeps a lenient place: a landmark alone is enough, structured parts optional, nothing parsed out of the address"; "refuses a place with no address, landmark or directions (places.needOne) (mutation: drop the at-least-one check -> FAILS)"; "trims every field with the edge class and refuses one past its limit, naming the limit"; "country is US, MX or empty, never CA".
  - `parsePlacePatch`: "clearing the last of address, landmark and directions is refused; clearing one of two is allowed (mutation: check the patch alone, not the row after it -> FAILS)"; "an unknown field is refused".
  - `equipmentRule` / `parseEquipmentFields` / `parseEquipmentPatch`: "a replacement needs its date and a date after today is refused (mutation: drop notAfter -> FAILS)"; "a successor's install date cannot be cleared inline (0071 equipment_replacement_dated)"; "a warranty ending before install is refused (equipment.warrantyBeforeInstall)"; "a warranty date in the future is fine".
  - `parseOwner` / `ownerValue`: "round-trips contact:<id> and group:<id>; anything else is null".
  - `parsePlaceSnapshot`: "refuses another account's snapshot, a missing id, and a row with two owners (mutation: drop the account check -> FAILS)".
  - `placeTitle`: "label, else the address's first line, else the landmark, else 'Property' / 'Propiedad' in the reader's language (mutation: skip the first-line split -> FAILS)".
  - `mapUrl`: "is Google Maps' search URL with the address, city, region and ZIP encoded, and null without an address (mutation: build it from the landmark -> FAILS)": expect `mapUrl({ address: "1204 Nolana Ave #3", city: "McAllen", region: "TX", postal_code: "78501" })` to equal `"https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent("1204 Nolana Ave #3, McAllen, TX 78501")`, and `mapUrl({ address: null, … })` to be `null`.
  - `warrantyStatus`: "under warranty through the last day itself, ended the day after (mutation: compare with > -> FAILS)": `("2026-10-11", "2026-10-11")` → `{ kind: "under", until: "2026-10-11" }`; `("2026-10-10", "2026-10-11")` → `ended`; `(null, …)` → `null`.
  - `equipmentByPlace`: "a chain A → B → C shows C current, with B replaced on C's install date and A on B's (mutation: use the unit's own installed_on as replacedOn -> FAILS)"; "two independent units at one place are both current".
  - `placesInOrder`: "the person's own first, then the main group's, then other groups', each oldest first; removed ones apart".
  - `ownerOptions`: "'{name} only' then 'Shared with {group}', values contact:/group:, in Spanish 'Solo de {name}'".

  Write each case as concrete inputs and an exact expected value (the shapes above), with the probe in the name where it is listed.

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/contacts/place-input.test.ts src/lib/contacts/place-view.test.ts`. Expected: two `Failed to resolve import` lines.

- [ ] **Step 3: Write both modules** to the Interfaces. `place-input.ts` builds every text check from `validateInlineRule(placeRule(f) | equipmentRule(f, …))`, so the inline field (Task 6 passes the same rule to `InlineField`) and the server agree by construction. The at-least-one rule reads the row AFTER the patch. `place-view.ts`: `mapUrl` joins the non-empty parts of `address`, then `city`, then `region` and `postal_code` (`"TX 78501"`) with `", "`; `equipmentByPlace` indexes units by `replaces_id`, takes as current every unit no other unit replaces, and walks each current unit's `replaces_id` back; `placesInOrder` sorts by (owner rank: own 0, main group 1, other group 2), then `created_at`, then `id`.

- [ ] **Step 4: Run green**; paste the summary line. Then `pnpm --filter web typecheck` (exit code to a file).

- [ ] **Step 5: Mutation probes:** (a) in `parsePlacePatch`, check only the patched field for emptiness → "clearing the last of address, landmark and directions is refused…" fails; (b) in `warrantyStatus` use `>` → "under warranty through the last day itself…" fails; (c) in `equipmentByPlace` set `replacedOn` to the old unit's own `installed_on` → "a chain A → B → C…" fails. Paste each failing name, revert.

- [ ] **Step 6: Commit.** `git commit -m "feat(contacts): pure input and view helpers for properties and equipment" -- apps/web/src/lib/contacts/place-input.ts apps/web/src/lib/contacts/place-input.test.ts apps/web/src/lib/contacts/place-view.ts apps/web/src/lib/contacts/place-view.test.ts` (after `git add` of the same four paths).

---

## Task 5: Server actions, the read route and the error copy

**Owner:** bis-crm. **Review:** opus. **Runs:** after Tasks 2 and 4 (and after Task 3's `messages.ts` edit). **Scratch:** `s02c-t5-impl/`.

**Files**
- Create: `apps/web/src/lib/contacts/place-errors.ts`, `place-errors.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/places-actions.ts`, `places-actions.test.ts`
- Create: `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/places/route.ts`, `route.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (one `places.error.*` block before `} as const;`)

**Interfaces**
- Consumes: Task 2's `@bis/db` functions and types; Task 4's parsers; `requireAccountAccess` (`lib/auth.ts:36`), `apiAccountAccess` (`:178`), `dbForRequest` (`lib/db.ts:21`), `seesWholeAccount` (`lib/auth-role.ts:15`), `getContact` (`@bis/db`), `renderZone` (`lib/zone.ts`), `dayKeyInZone` (`lib/booking/availability.ts:89`), `loggableError`.
- Produces:

```ts
// place-errors.ts
export type PlaceErrorKey = "places.refused" | "places.moveRefused" | "equipment.alreadyReplaced" | "places.error.undoFailed" | "places.error.invalid" | "places.error.failed";
export function placeErrorFor(e: unknown): PlaceErrorKey;  // 42501 refused; 23505 alreadyReplaced; 23503 undoFailed; 23514 invalid; else failed
// places-actions.ts ("use server"; every action: requireAccountAccess, ids checked with isUuid, dbForRequest() ONLY)
export type PlaceActionError = { ok: false; error: string; params?: Record<string, string | number> };  // a messages.ts KEY; the card translates it
export async function addPlaceAction(accountId: string, subjectId: string, raw: unknown): Promise<{ ok: true; place: PlaceRow } | PlaceActionError>;
export async function updatePlaceFieldAction(accountId: string, subjectId: string, placeId: string, field: string, value: string): Promise<{ ok: true } | PlaceActionError>;
export async function setPlaceOwnerAction(accountId: string, subjectId: string, placeId: string, owner: string): Promise<{ ok: true } | PlaceActionError>;
export async function removePlaceAction(accountId: string, subjectId: string, placeId: string): Promise<{ ok: true; undo: PlaceRemovalUndo } | PlaceActionError>;
export type PlaceRemovalUndo = { mode: "deleted"; snapshot: PlaceRow } | { mode: "archived"; placeId: string };
export async function undoRemovePlaceAction(accountId: string, subjectId: string, undo: unknown): Promise<{ ok: true } | PlaceActionError>;
export async function setPlaceArchivedAction(accountId: string, subjectId: string, placeId: string, archived: boolean): Promise<{ ok: true } | PlaceActionError>;
export async function addEquipmentAction(accountId: string, subjectId: string, placeId: string, raw: unknown): Promise<{ ok: true; unit: EquipmentRow } | PlaceActionError>;
export async function replaceEquipmentAction(accountId: string, subjectId: string, equipmentId: string, raw: unknown): Promise<{ ok: true; unit: EquipmentRow } | PlaceActionError>;
export async function updateEquipmentFieldAction(accountId: string, subjectId: string, equipmentId: string, field: string, value: string): Promise<{ ok: true } | PlaceActionError>;
export async function removeEquipmentAction(accountId: string, subjectId: string, equipmentId: string): Promise<{ ok: true; snapshot: EquipmentRow } | PlaceActionError>;
export async function undoRemoveEquipmentAction(accountId: string, subjectId: string, snapshot: unknown): Promise<{ ok: true } | PlaceActionError>;
// route.ts
export type PlacesResponse = {
  subject: { id: string; firstName: string | null; lastName: string | null };
  today: string;                       // YYYY-MM-DD in the account's zone
  groups: ContactPlaceGroup[];
  places: Omit<PlaceRow, "created_by">[]; placeCount: number;
  equipment: Omit<EquipmentRow, "created_by">[]; equipmentCount: number;
};
```

Every action answers a copy KEY (and params), never translated text, as the relationships actions do (`relationship-actions.ts` returns `RelationshipError` keys; `relationship-errors.ts` maps SQLSTATEs to them); the card translates with `t()` in the reader's locale, and wraps each action for `InlineField`'s `save`, whose `error` is shown as text. Proof before any write: `getContact(db, accountId, subjectId)` (null → `places.refused`), and for a place- or unit-level action the target read through the same request client (null → `places.refused`). `addPlaceAction` and `setPlaceOwnerAction` also check the chosen owner is the subject or one of the subject's groups (read `client_group_members` on the request client). `setPlaceOwnerAction` pre-checks `seesWholeAccount(access)` and answers `places.moveRefused` before any write (the database's trigger refuses again). Undo of an add (place or unit) is the client calling the remove action on the new id; Undo of a replace removes the new unit; Undo of an inline edit re-saves the prior value (InlineField's default).

- [ ] **Step 1: Error copy.** Append before `} as const;`:

```ts
  // Properties and equipment (S-02 part B2): errors
  "places.refused": "You can't change that property.",
  "places.refused.es": "No puede cambiar esa propiedad.",
  "places.moveRefused": "Only an Owner or Staff can change who a property belongs to.",
  "places.moveRefused.es": "Solo el Dueño o un Empleado puede cambiar de quién es una propiedad.",
  "places.needOne": "Add an address, a landmark or how to get there.",
  "places.needOne.es": "Agregue una dirección, una referencia o cómo llegar.",
  "equipment.alreadyReplaced": "That unit was already replaced.",
  "equipment.alreadyReplaced.es": "Ese equipo ya se reemplazó.",
  "equipment.warrantyBeforeInstall": "The warranty can't end before the install date.",
  "equipment.warrantyBeforeInstall.es": "La garantía no puede terminar antes de la fecha de instalación.",
  "places.error.undoFailed": "Couldn't put it back.",
  "places.error.undoFailed.es": "No se pudo deshacer.",
  "places.error.invalid": "Check the details and try again.",
  "places.error.invalid.es": "Revise los datos e intente de nuevo.",
  "places.error.failed": "Couldn't save that. Try again.",
  "places.error.failed.es": "No se pudo guardar. Intente de nuevo.",
```

- [ ] **Step 2: Write the failing tests.** `places-actions.test.ts` mocks `@/lib/auth` (`requireAccountAccess` per test: Owner, Technician), `@/lib/db` (`dbForRequest` returns a sentinel `REQUEST`), `@bis/db` (every Task 2 function as a `vi.fn`, `getContact`, and `serviceDb: vi.fn(() => { throw new Error("serviceDb must never be called here"); })`), `next/cache`. Required cases, by name:
  - "every action proves the record through the request client first and writes nothing when it is hidden (mutation: delete the getContact proof in removePlaceAction -> FAILS)": for each action, `getContact` → `null` gives `{ ok: false, error: "places.refused" }` and no Task 2 writer was called.
  - "a target the request client cannot read is refused before any write" (`getPlace`/`getEquipment` → `null`).
  - "addPlaceAction refuses an owner that is neither the record nor one of its groups, and adds with the record's own owner (mutation: skip the owner check -> FAILS)".
  - "a Technician changing who a property belongs to is refused with the Owner-or-Staff copy, before any write (mutation: drop the seesWholeAccount pre-check -> FAILS)".
  - "removePlaceAction hands back the Undo for each mode, and undoRemovePlaceAction restores a deleted place or clears an archive".
  - "undoRemovePlaceAction refuses another account's snapshot before any write (mutation: skip parsePlaceSnapshot's account check -> FAILS)".
  - "a database refusal, a duplicate replacement and a vanished target become their copy keys (mutation: map every code to places.error.failed -> FAILS)": `PlaceDbError` codes `42501`, `23505`, `23503` → `places.refused`, `equipment.alreadyReplaced`, `places.error.undoFailed`; each key has an `.es` twin in `m` (asserted in the same case).
  - "updatePlaceFieldAction refuses clearing the last way to find the place (places.needOne) without a write".
  - "no action ever calls serviceDb" (runs every action once with the Owner, valid inputs).
  - "every write passes the record as subjectId and the caller as actor".

  `route.test.ts` mocks `@/lib/auth` (`apiAccountAccess`), `@/lib/db`, `@bis/db` (`getContact`, `listContactPlaces`, `serviceDb` throwing), `@/lib/zone` (`renderZone: async (z) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" })`). Required cases:
  - "404s with no access, and 404s a contact the request client cannot see without reading its places (mutation: drop the getContact check -> FAILS)".
  - "answers today in the ACCOUNT's zone (mutation: compute it in UTC -> FAILS)": `vi.setSystemTime(new Date("2026-10-12T03:30:00Z"))`, the account row's `timezone` `America/Chicago` → `today: "2026-10-11"`.
  - "never sends created_by to the browser".
  - "an unreadable places read is a 500 the card shows as its error, logged".

  `place-errors.test.ts`: one case per code, plus "an unknown code is places.error.failed".

- [ ] **Step 3: Run red.** `pnpm --filter web exec vitest run src/lib/contacts/place-errors.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/places-actions.test.ts" "src/app/api/accounts/[accountId]/contacts/[contactId]/places/route.test.ts"`. Expected: three `Failed to resolve import` lines.

- [ ] **Step 4: Write `place-errors.ts`, `places-actions.ts` and `route.ts`** to the Interfaces. The route is the `email` route's shape (`api/accounts/[accountId]/contacts/[contactId]/email/route.ts`): `apiAccountAccess` → 404; `dbForRequest()`; `getContact` → 404; then in one `try`: `listContactPlaces` and the account's `timezone` read in parallel, `renderZone`, `today = dayKeyInZone(new Date(), zone.zone)`; strip `created_by` from every row; `catch` → logged 500. Never `serviceDb`. The actions call `revalidatePath` for nothing: the card re-reads its own route.

- [ ] **Step 5: Run green.** Step 3's command plus `src/lib/i18n/ratchet.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`, then `pnpm --filter web typecheck` (exit to a file). Paste every summary line. `in-account-service-reads.test.ts` stays green UNCHANGED: these files import no `serviceDb` (C4).

- [ ] **Step 6: The `vi.mock("@bis/db")` factory check.** This task adds `@bis/db` imports only to NEW modules; confirm with `git diff --stat` that no existing module gained one.

- [ ] **Step 7: Mutation probes:** (a) delete the `getContact` proof in `removePlaceAction` → "every action proves the record…" fails; (b) drop the `seesWholeAccount` pre-check in `setPlaceOwnerAction` → "a Technician changing who a property belongs to…" fails; (c) in the route use `"UTC"` for `dayKeyInZone` → "answers today in the ACCOUNT's zone" fails; (d) in `undoRemovePlaceAction` call `restorePlace` with the raw payload instead of `parsePlaceSnapshot`'s result → "refuses another account's snapshot…" fails. Paste each failing name, revert.

- [ ] **Step 8: Commit** the seven files: `feat(contacts): property and equipment actions on the request client only, and the card's read route`.

---

## Task 6: The Properties card, its dialogs and copy, on the drawer and the contact page

**Owner:** bis-frontend. **Review:** sonnet. **Runs:** after Tasks 3 and 5. **Scratch:** `s02c-t6-impl/`. Edits `messages.ts`, `contact-drawer.tsx` and the contact page.

**Files**
- Create: `apps/web/src/lib/contacts/places-load.ts`, `places-load.test.ts`
- Create: `contacts/places-card.tsx`, `contacts/places-card.test.ts`, `contacts/places-card.handlers.test.ts`
- Create: `contacts/place-dialog.tsx` (add a property), `contacts/equipment-dialog.tsx` (add or replace a unit)
- Modify: `contacts/contact-drawer.tsx`, `contacts/contact-drawer.wiring.test.ts`
- Modify: `contacts/[contactId]/page.tsx`, `contacts/[contactId]/page.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (the `places.*` and `equipment.*` UI block before `} as const;`)

(`contacts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`.)

**Interfaces**
- Consumes: Task 5's actions and `PlacesResponse`; Task 4's view and input helpers; `InlineField` with `rule`, `inputType`, `display`, `locale`, `options` (Task 3); `useLocale`, `t`, `m`; `Skeleton`, `Notice`, `Button`, `Dialog*`, `Textarea`, `Input` (`components/ui`); `toast` (`sonner`).
- Produces:

```ts
export type PlacesLoad = { status: "loading" } | { status: "error" } | { status: "ready"; data: PlacesResponse };
export async function placesLoadFrom(res: Response): Promise<PlacesLoad>;   // anything malformed is "error"
export function PlacesCard(props: { accountId: string; contactId: string; canMovePlace: boolean }): JSX.Element;
export function PlacesCardView(props: { accountId: string; contactId: string; canMovePlace: boolean; load: PlacesLoad; onRetry: () => void; handlers: PlaceHandlers }): JSX.Element; // pure
export type PlaceHandlers = { removePlace(id: string): void; putBack(id: string): void; removeUnit(id: string): void; changed(): void };
export function placeHandlers(a: { accountId: string; contactId: string; locale: Locale; reload: () => void }): PlaceHandlers; // toasts with Undo
```

- [ ] **Step 1: UI copy.** Append before `} as const;` every key of spec §8's table not already added by Task 5 (`places.title`, `.add`, `.untitled`, `.empty`, `.label` and `.labelHint`, `.address`, `.moreAddress`, `.landmark` and `.landmarkHint`, `.directions` and `.directionsHint`, `.openMap`, `.belongsTo`, `.onlyPerson`, `.sharedWith`, `.removedList`, `.putBack`, `.loadFailed`, `.retry`, `.country`; `equipment.title`, `.add`, `.empty`, `.name` and `.nameHint`, `.make`, `.model`, `.serial`, `.notes`, `.installedOn`, `.warrantyUntil`, `.underWarranty`, `.warrantyEnded`, `.replace`, `.replaceDate`, `.replacedOn`, `.history`) and §7's toasts (`places.added` "Added {place}.", `places.ownerChanged` "{place} now belongs to {owner}.", `places.removed` "Removed {place}.", `places.archived` "Moved {place} to Removed properties.", `places.putBackDone` "Put back {place}.", `equipment.added` "Added {name}.", `equipment.replaced` "Replaced. The old unit is kept in its history.", `equipment.removed` "Removed {name}.", plus `places.dialog.add` (the primary "Add" / "Agregar")), each with the spec's or a usted `.es` twin: "Agregó {place}." → use "Se agregó {place}.", "{place} ahora es de {owner}.", "Se quitó {place}.", "Se movió {place} a Propiedades quitadas.", "Se recuperó {place}.", "Se agregó {name}.", "Reemplazado. El equipo anterior queda en su historial.", "Se quitó {name}.".

- [ ] **Step 2: Write the failing tests.**
  - `places-load.test.ts`: "a 200 with the response shape is ready"; "anything else is the card's error state (mutation: trust any 200 body -> FAILS)" (500, a body without `today`, a place without `id`, non-JSON).
  - `places-card.test.ts` (`renderToStaticMarkup` inside `LocaleProvider`, actions mocked, the relationships card test's idiom). Required cases, by name:
    - "loading is two skeleton rows shaped like a property, never a spinner (rule 7)" (`data-places-skeleton` twice; no `animate-spin`).
    - "empty sells the feature with its action, in the reader's language, with lang set (mutation: hard-code English -> FAILS)".
    - "error offers Try again inside the card".
    - "a property reads its title, address and city line, landmark, how to get there and an Open map link that opens a new tab safely (mutation: drop rel -> FAILS)": `href` equals `mapUrl(…)`, `target="_blank"`, `rel="noopener noreferrer"`.
    - "no address, no Open map".
    - "a group's property says who it is shared with".
    - "warranty is a dot plus a word against the account's today, never colour alone (rule 3; mutation: render the dot without the word -> FAILS)": `data-mark="warranty"` element contains `t("equipment.underWarranty")` text.
    - "a replaced unit sits under Earlier units with its replaced date, and has no Remove (C6)".
    - "removed properties are listed apart, each with Put back".
    - "a Technician has no Belongs to control; an Owner has it (mutation: ignore canMovePlace -> FAILS)".
    - "the card renders the same in Spanish: Propiedades, Cómo llegar, Equipo".
  - `places-card.handlers.test.ts` (call the handlers with `toast` mocked): "removing a place offers Undo that restores a deleted place or clears an archive, by the mode the action answered (mutation: always undo as archived -> FAILS)"; "removing a unit offers Undo that restores the snapshot"; "a failed Undo says Couldn't put it back".
  - In `contact-drawer.wiring.test.ts`: beside `vi.mock("./groups-card", …)`, add `const placesCardProps: unknown[] = []; vi.mock("./places-card", () => ({ PlacesCard: (p: unknown) => { placesCardProps.push(p); return null; } }));` and a describe, using the file's own drawer-CALL walk (its Groups block): "the drawer mounts the Properties card after the Groups card, with canMovePlace from canAssign (mutation: drop the card line -> FAILS)", asserting the found element's props `toMatchObject({ accountId: "a1", contactId: "c1", canMovePlace: true })` and that its index in the walk is greater than the `GroupsCard` element's.
  - In `[contactId]/page.test.ts`: `const placesCardProps: unknown[] = []; vi.mock("../places-card", …)` and "renders the Properties card with the page's accountId, contactId and canMovePlace (mutation: drop the card line -> FAILS)".

- [ ] **Step 3: Run red.** `pnpm --filter web exec vitest run src/lib/contacts/places-load.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/places-card.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/places-card.handlers.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts"`. Expected: three `Failed to resolve import` lines and the two wiring cases failing on an empty recorder.

- [ ] **Step 4: Write `places-load.ts`, `places-card.tsx`, `place-dialog.tsx`, `equipment-dialog.tsx`.** The card: `"use client"`; `useLocale()`; its own `fetch` of `/api/accounts/${accountId}/contacts/${contactId}/places` in an effect with a cleanup flag (the relationships card's shape), `placesLoadFrom`, Retry re-runs it; root `<section data-places-card lang={locale} aria-labelledby=…>` with the title as the card's heading; rows split by `border-t border-[var(--row-line)]` (the contact page's list idiom, `[contactId]/page.tsx`'s Deals list), never a box in a box. Every text field is `InlineField` with `rule={placeRule(f)}` (directions `inputType="multiline"`), saving through `updatePlaceFieldAction` and translating the result; equipment dates `inputType="date" display="date" rule={equipmentRule(f, today, unit)}`; "Belongs to" is `InlineField options={ownerOptions(…)}` saving through `setPlaceOwnerAction`, rendered only when `canMovePlace`. Warranty: `<span data-mark="warranty"><span aria-hidden className="… rounded-full bg-…token…" />{word}</span>`. Earlier units: a `<button aria-expanded>` disclosure. Remove: ghost icon buttons with `aria-label={t("…remove", { name })}` (add `places.removeAria` / `equipment.removeAria` keys with twins in Step 1). Dialogs: Radix `Dialog` (Esc closes, focus returns to the trigger), one primary "Add" (`places.dialog.add`), fields validated with Task 4's parsers before the action, the action's error shown in a polite live region inside the dialog. The replace dialog carries the old unit's `name` and defaults "When was it replaced?" to `today`.

- [ ] **Step 5: Mount it.** In `contact-drawer.tsx`, import `PlacesCard` from `./places-card` and add, directly after the `<GroupsCard … />` element (outside the summary's ready branch, as the Groups card is): `<PlacesCard key={\`${row.id}:places\`} accountId={accountId} contactId={row.id} canMovePlace={canAssign} />`. In `[contactId]/page.tsx`, import it from `../places-card` and add between the Groups `<aside>` and the Deals `<aside>`: `<aside className="rounded-xl border border-border bg-card glass px-4 pt-3.5 pb-3"><PlacesCard accountId={accountId} contactId={contactId} canMovePlace={assign.canAssign} /></aside>` (the Groups aside's own classes, read from the file).

- [ ] **Step 6: Run green** with Step 3's command plus `src/lib/i18n/ratchet.test.ts src/lib/contacts`; then `pnpm --filter web typecheck` and `pnpm --filter web exec eslint "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/lib/contacts` (exit codes to files). Paste every summary line. The new `.tsx` files carry no JSX literal copy.

- [ ] **Step 7: The `vi.mock("@bis/db")` factory check.** The card and dialogs import only TYPES from `@bis/db`; confirm with `git diff` that `contact-drawer.tsx` and `page.tsx` gained no `@bis/db` import.

- [ ] **Step 8: Mutation probes:** (a) render the warranty dot without its word → "warranty is a dot plus a word…" fails; (b) ignore `canMovePlace` (always render Belongs to) → "a Technician has no Belongs to control…" fails; (c) in `placeHandlers.removePlace`, always undo with `setPlaceArchivedAction` → "removing a place offers Undo… by the mode…" fails; (d) delete the drawer's `<PlacesCard …/>` line → the drawer wiring case fails. Paste each failing name, revert.

- [ ] **Step 9: Definition of done, by hand** (a line each in the report): tokens only (grep the new `.tsx` files for `#`, `rgb(`, `px]` outside `var(`, and `shadow-`); dark and light (`.dark` toggle); the blur fallback unaffected (no `backdrop-filter` on the card); Esc closes both dialogs; focus ring on every link, button and inline field; English and Spanish; the pseudo-locale's +35% wraps a long label rather than clipping it (check in a scratch copy, not the repo); one primary button per dialog; no hero (rule 11). `/styleguide`: no new shared component (the card is feature-local); say so.

- [ ] **Step 10: Commit** every file above: `feat(contacts): the Properties card, with equipment and its history, on the drawer and the contact page`.

---

## Task 7: e2e `places.spec.ts`

**Owner:** bis-e2e-qa (writes it). **Review:** sonnet. **Runs:** after Task 6. **Scratch:** `s02c-t7-impl/`. **The orchestrator runs it**; the agent never runs Playwright.

**Files**
- Create: `apps/web/e2e/places.spec.ts`
- Possibly modify: `apps/web/e2e/fixtures/fixture-names.test.ts`

- [ ] **Step 1: Verify the facts the spec relies on** and record them: the fixture file `e2e/.auth/client-fixture.json` carries `accountId`, `clerkUserId`, `technicianUserId` (read `relationships.spec.ts`'s `fixture()` on `main`); storage states `e2e/.auth/client-state.json` (the fixture Owner) and `e2e/.auth/technician-state.json`; `users.language` takes `'en' | 'es' | null` (0067); the drawer opens from the contact list by clicking a row (`data-contact-row`), and the full page is `/dashboard/accounts/<id>/contacts/<contactId>`.

- [ ] **Step 2: Write the spec**, shaped like `relationships.spec.ts` (run-time `fixture()`, `describe.serial`, stamped names, everything seeded with `serviceDb()` deleted in `afterAll` by stamped last name with the error checked and a re-read proving none is left; places and equipment go by cascade, which `afterAll` checks for the ids it holds). Steps:
  1. **Owner, contact page:** "Add a property" with ONLY a landmark and "Cómo llegar" text; the card shows both and no "Open map". Edit the address inline (blur saves, the "saved" toast appears); "Open map" now appears with an `href` starting `https://www.google.com/maps/search/?api=1&query=`.
  2. **Equipment:** add "AC upstairs" (Trane, installed 2019-03-03, warranty until a future date): "Under warranty until …" with its dot. Replace it with "Carrier": the old unit appears under "Earlier units (1)" with "Replaced {today}"; press Undo on the toast: Earlier units is gone and Trane is current again.
  3. **Removal:** remove the unit with nothing replacing it, Undo, it is back. Remove an EMPTY second property: gone; Undo: back. Remove the property WITH equipment: it moves under "Removed properties (1)"; Put back: active again.
  4. **Shared:** seed a household with the record's contact and a second contact; add a property belonging to the household ("Belongs to": "Shared with …"); open the second contact's drawer from the list: the property is there with "Shared with …".
  5. **Spanish:** set the fixture Owner's `users.language` to `es` (checked), reload the contact page: "Propiedades", "Cómo llegar", "Equipo"; restore it in a `finally` (checked).
  6. **Technician** (`technician-state.json`): seed two contacts, one assigned to `technicianUserId` with a property, one not with a property. The Technician's contact page shows their customer's property, adds a unit there successfully, and shows no "Belongs to" control; the other customer's property id and address appear neither in `GET /api/accounts/<id>/contacts/<theirContactId>/places` (404) nor anywhere on the Technician's page.

- [ ] **Step 3: Fixture names.** Run `pnpm --filter web exec vitest run e2e/fixtures/fixture-names.test.ts`; for each literal it reports, add a not-swept entry in the file's existing style naming the per-run fixture account and the cascade. Re-run green.

- [ ] **Step 4: Typecheck the spec.** `pnpm --filter web typecheck` (exit to a file).

- [ ] **Step 5: Mutation probe (static, no Playwright):** state which assertion fails if `places_technician_scope` were dropped (step 6's absence check, after its positive control that the Technician sees their own customer's property), and if the card ignored `canMovePlace` (step 6's "no Belongs to"). The orchestrator's run is the real red/green.

- [ ] **Step 6: The orchestrator runs** `pnpm --filter web test:e2e places.spec.ts relationships.spec.ts groups.spec.ts assign.spec.ts contacts.spec.ts contacts-drawer.spec.ts contact-detail.spec.ts` alone on the machine, after checking that no `screenshots.yml` run is in progress. (`forms.spec.ts` has a recorded flake on the unread badge count; it is not in this set.)

- [ ] **Step 7: Commit.** `git add apps/web/e2e/places.spec.ts apps/web/e2e/fixtures/fixture-names.test.ts` then `git commit -m "test(e2e): an Owner adds a property with a landmark, replaces a unit and undoes it; the Technician sees only their customer's" -- apps/web/e2e/places.spec.ts apps/web/e2e/fixtures/fixture-names.test.ts`.

---

## Task 8: Rollout (orchestrator; not a coding task)

- [ ] **0. Numbering.** 0070 (relationships) merged first and is on bis-ci and production (Task 0 confirmed it in the tree; confirm its version is in bis-ci's history with the e2e job's script or the workflow's dry run). 0071 is the only pending version. `db:push:ci` refuses a version below the project's newest, so 0071 never goes before 0070.
- [ ] **1. Merge prep.** Merge `main` into the branch again if it moved; run `pnpm check`, then `pnpm --filter web build`, then `pnpm --filter web test:e2e`, one at a time on the combined tree.
- [ ] **2. CI project, dry run.** `gh workflow run ci-project-setup.yml --ref <branch> -f step=push-dry-run`. Read the run: it lists exactly `0071_places_and_equipment.sql`.
- [ ] **3. CI project, push.** `gh workflow run ci-project-setup.yml --ref <branch> -f step=push`. Read the run for success. The PR's `e2e` job fails until this is done (`.github/scripts/ci-migrations-applied.sh`).
- [ ] **4. Production.** Warn danlo in chat first (memory "Supabase MCP prompts": the Accept/Decline shows only in the CLI terminal). Check the file has no backslash and no non-ASCII character (Task 1 step 7's two greps). Apply via MCP `apply_migration` named `places_and_equipment`, exactly once; never re-apply.
- [ ] **5. Parity.** Run `docs/runbooks/ci-supabase-project.md`'s parity digest between bis-ci and production; they must match. Read-only spot checks on production: `select tablename, count(*) from pg_policies where tablename in ('places','equipment') group by 1 order by 1` → `equipment 2`, `places 3`; `select count(*) from pg_trigger where tgname in ('places_stamp_created_by','equipment_stamp_created_by','places_owner_guard')` → `3`.
- [ ] **6. PR, merge, deploy.** Open the PR only now. Read the check runs for the HEAD SHA (`gh api repos/{owner}/{repo}/commits/{sha}/check-runs`); merge with the SHA pinned. Verify the deploy is READY with the merge SHA; `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404; served-HTML marker: a contact page's HTML contains `data-places-card`.
- [ ] **7. Runbook and tracker.** Propose the 0071 run-log line for `docs/runbooks/ci-supabase-project.md` to bis-platform; update S-02's row in the roadmap tracker (memory "Roadmap tracker").

Hazards (spec §11): migration before app is safe (two empty tables, fences in the same file); app before migration is data-safe but the card shows its error state, and a teardown or demo re-seed throws on the missing table, so the migration goes first. Rollback: revert the app and leave the tables.

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| §1 goal | Tasks 1–7 |
| P1 / O9 one working card on drawer and page, no new page | Task 6 (`PlacesCard`, mounted twice; wiring tests) |
| P2 replaced history, no reminders | Task 1 (`replaces_id`, `equipment_one_successor`, CHECKs); Task 4 `equipmentByPlace`; Task 6 Earlier units; no reminder code anywhere |
| P3 / O2 Technician through own customer or their group; writes on what they see; no owner change | Task 1 fences, trigger and RLS tests; Task 5 pre-check; Task 6 no "Belongs to"; Task 7 step 6 |
| P4 / O1 bilingual, Property / Propiedad, Cómo llegar | Task 3 (chrome twins, `locale`); Tasks 5, 6 copy with `.es`; Task 6 Spanish render test; Task 7 step 5 |
| P5 / C2 one owner, person or group | Task 1 `places_one_owner`, both FKs; Task 4 `parseOwner`, `ownerOptions` |
| P6 / O8 lenient address, Open map, no geocoding | Task 1 `places_findable`; Task 4 `parsePlaceFields`, `mapUrl`; Task 6 link test |
| C3 derived status, one-insert replacement | Task 1; Task 2 `replaceEquipment` |
| C4 client writes under RLS, never serviceDb | Task 1 grants and guard; Task 5 "no action ever calls serviceDb"; `in-account-service-reads.test.ts` unchanged |
| C5 remove = delete if empty, else archive | Task 1 `places_delete_empty`; Task 2 `removePlace` (deviation 5); Task 6 handlers |
| C6 a replaced unit cannot be removed | Task 1 FK test; Task 2 `removeEquipment` 23503; Task 6 no Remove on history |
| C8 `created_by` stamped | Task 1 trigger tests; Task 5 route strips it |
| O3 customer delete cascades | Task 1 cascade test (the RI-bypasses-RLS pin) |
| O4–O7 no tenants, no CSV, no address search, Remove for a unit taken out | nothing built for them; Task 6 Remove |
| §5.3 teardown and guards | Task 2 `ACCOUNT_OWNED_TABLES`; Task 1 `EXPECTED_WRITES`, policy pin |
| §6 queries, events without typed text, route with `today` | Task 2 events test; Task 5 route tests |
| §7 Undo per action | Task 5 Undo payloads; Task 6 handlers; Task 3 InlineField's default Undo (deviation 8) |
| §8 states, keyboard, copy, InlineField needs | Tasks 3 and 6 |
| §10 tests | Tasks 1–7, each with its probes |
| §11 deploy order and rollback | Task 8 |

Type and name consistency checked across tasks: `PlaceRow`, `EquipmentRow`, `PlaceOwner`, `PlaceFields`, `PlacePatch`, `EquipmentFields`, `EquipmentPatch`, `ContactPlaceGroup`, `ContactPlaces`, `PlaceCtx`, `PlaceDbError`, `listContactPlaces`, `getPlace`, `getEquipment`, `addPlace`, `updatePlace`, `setPlaceOwner`, `removePlace`, `setPlaceArchived`, `restorePlace`, `addEquipment`, `replaceEquipment`, `updateEquipment`, `removeEquipment`, `restoreEquipment`, `InlineRule`, `validateInlineRule`, `cleanEdgeSpace`, `placeRule`, `equipmentRule`, `parsePlaceFields`, `parsePlacePatch`, `parseEquipmentFields`, `parseEquipmentPatch`, `parseOwner`, `ownerValue`, `parsePlaceSnapshot`, `parseEquipmentSnapshot`, `placeTitle`, `cityLine`, `mapUrl`, `warrantyStatus`, `equipmentByPlace`, `placesInOrder`, `ownerOptions`, `sharedWith`, `placeErrorFor`, `PlacesResponse`, `PlacesLoad`, `placesLoadFrom`, `PlacesCard`, `PlacesCardView`, `placeHandlers`.

## Spec gaps found while planning (for the ledger)

1. **`InlineField`'s fourth arm is generic data, not keyed to `place-input.ts`** (deviation 1). The spec's §8 line should say "a serializable rule" when it is next edited.
2. **Inline edits toast "{label} saved"**, not "Saved." (deviation 2); spec §7's table names the generic word.
3. **`equipment.futureDate` became `inline.rule.future`** (deviation 3), and the error copy gained `equipment.warrantyBeforeInstall`, which spec §8's table does not list.
4. **`common.undo`, `inline.saved`, `inline.edit`, `inline.empty`, `inline.crashed` gain Spanish twins** here (Task 3), closing the relationships plan's gap 5 for the common Undo.
5. **The service role bypasses `places_delete_empty`**, so `removePlace` counts units first (deviation 5); spec §5.2 describes only the request client's path.
