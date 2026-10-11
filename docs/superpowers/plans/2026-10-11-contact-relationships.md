# Relationships between customers: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: `docs/superpowers/specs/2026-10-11-contact-relationships-design.md` (owner decisions R1 to R6, choices C1 to C7, rulings §11.1 and §11.2 are settled; do not re-open them).

**Goal:** A relationship between two customers is typed once and reads correctly on both records in English and Spanish (padrinos and compadres included), with per-person pickup and emergency flags, on a working card in today's contact drawer and contact detail page.

**Architecture:** Migration 0070 adds `contact_relationships`, stored once per pair with composite same-account keys to `contacts`, an order-free unique index, client writes under RLS and 0068-style RESTRICTIVE Technician fences. `@bis/db` gains a dependency-free `relationship-keys` module (shared with client code through a new package subpath) and the queries. `apps/web` gains a typed bilingual label registry, pure view and input helpers, server actions (with the hand-add path extracted from `createContactAction`), a read route that never sends a hidden person's id, and one `RelationshipsCard` component mounted on both surfaces.

**Tech Stack:** Next 16 App Router (server actions, route handlers), Supabase Postgres (RLS, PostgREST), supabase-js, vitest 4 (no DOM renderer; `renderToStaticMarkup`), Playwright, local PostgreSQL 18 replica.

## Global Constraints

- Tokens only: no hard-coded colours, radii or shadows (DESIGN.md). Rule 3 (a flag is a dot plus a word), rule 5 per card (loaded, empty, error), rule 6 (reversible actions run at once with an Undo toast; no confirm dialogs), rule 7 (skeletons, no spinners), rule 8 (one primary button per view: the dialog's "Add"), rule 11 (the card names no hero), Record views (inline edits).
- Migrations are applied by the orchestrator only (Task 7): CI project, then production, then parity, each exactly once, all before merge. An implementer applies 0070 to their OWN local PG18 replica only.
- **Local replica ports, one per agent, in its own scratch subdirectory:** Task 1 implementer `55470`, Task 1 reviewer `55471`; Task 2 implementer Postgres `55472`, PostgREST `55473`, gateway `55474`; Task 2 reviewer `55475`/`55476`/`55477`; spare `55478`, `55479`. Never `5432` (a Windows service holds it). Never point a run at bis-ci or production for a test that needs 0070.
- **Scratch:** every implementer and reviewer works in its own subdirectory of the session scratchpad, named `s02b-t<task>-<impl|review>/` (for example `s02b-t1-impl/`). Nothing is written anywhere else outside the worktree.
- **Never `git stash`.** Commits: `git add <explicit paths>` then `git commit -m "…" -- <same paths>`; never `-A` or `.`; if `.git/index.lock` exists, wait and retry; never push.
- Agents run only the affected tests, by path. `pnpm check`, `pnpm --filter web build` and `pnpm --filter web test:e2e` belong to the orchestrator, one at a time. Playwright is never an implementer's to run.
- Judge `@bis/db` runs by vitest's summary block: `pnpm --filter @bis/db exec vitest run …` prints a trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` after the real results. When an exit code matters, write it to a file with nothing after the command.
- **The `vi.mock("@bis/db")` factory check:** a task that adds a NEW named import from `@bis/db` to an EXISTING module must add that name to every `vi.mock("@bis/db", () => …)` factory in the tests that load the module. Find them with `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module file name without extension>"`. A missing export throws `[vitest] No "<name>" export is defined on the mock` at call time. `vi.mock("@bis/db")` does NOT mock the subpath `@bis/db/relationship-keys`, which is a separate module.
- Every test must be able to fail. Each task names its mutation probe(s): apply, run, see the named test fail, revert. A `-t` filter that matches nothing passes silently: check the run count.
- Never mutate Test Client One or any live account. e2e runs on the per-run `E2E Client Co <stamp>` fixture account only.
- Copy: every new string goes in `apps/web/src/lib/messages.ts` as `"key"` plus `"key.es"`, read through `t()` (`lib/i18n/t.ts:36`) with the reader's locale. Spanish uses usted. Neutral Spanish words use the "X o Y" form ("Madre o padre"), never "Madre/padre" (C7). Relationship words live in the typed registry (Task 3), not in `messages.ts`, and carry their own completeness test.
- A Technician's chip for a person not on their list reads "Mother: someone not on your list" / "Madre: alguien que no está en su lista", is not a link, has no controls, and the hidden person's id never reaches the browser (C5).
- The `has_custody` and `no_contact` flags and any restricted label are out of scope (R5, F-004).
- Migration files: ASCII only, no backslash anywhere (0050:86; memory "MCP SQL escapes").

## Where the plan departs from the spec's wording (the source decided)

1. **Words, not `{name}` templates.** Spec §4.2 describes side templates with `{name}`. The dialog's word-form choices need the bare word ("Mother · Father · Parent"), so each side stores bare words plus a `shape` (`colon`: "Mother: Ana Ramírez"; `phrase`: "Emergency contact for Ana Ramírez"). The rendered chip text is exactly the spec's table.
2. **A dependency-free `@bis/db/relationship-keys` subpath.** The client card and the dialog need `RELATIONSHIP_KEYS` and the row types. Importing values from `@bis/db`'s index would pull supabase-js into the client bundle, so a new subpath export joins `./phone` and `./search-term` (`packages/db/package.json:5-11`).
3. **The read route also returns the record's own name** (`subject`). On a `?peek=` deep link the drawer's row is an all-null stub (`summary/route.ts`, the `phone` field's comment), and the dialog asks "Who is {name} to {customer}?".
4. **"Refused" is a zero-row write.** RLS does not raise on an UPDATE or DELETE that its USING filters out (`technician-scope.test.ts:186-191`). `setRelationshipSides` and `removeRelationship` read the row first; found but not written means refused.
5. **The e2e Spanish check flips the Owner's own language, not `?locale=es`.** Spec §9 names the QA override, but the account layout calls `requestLocale` without `searchParams` (`accounts/[accountId]/layout.tsx:65`), so the override never reaches `LocaleProvider` and the card. Task 6 sets the fixture Owner's `users.language` to `es` for one test and restores it (Playwright runs `workers: 1`, `playwright.config.ts:128`).
6. **A dialog phrase exists only for an offered side.** The four support labels offer only the helper side (spec §7), so their other side carries words but no `pick`.
7. **On a chip, the word-form control edits whichever person's form changes THAT chip.** That is the named person, except Spanish `referred` side a, which agrees with the record's own customer (spec §4.2's `agreesWith`).

---

## Task order and parallelism

| # | Task | Owner | Review | Runs |
|---|---|---|---|---|
| 1 | Migration 0070, `relationship-keys.ts`, RLS and grants proof on the replica | bis-db-schema | **opus** | first, alone |
| 2 | `@bis/db` queries (`relationships.ts`), index exports, account teardown | bis-crm | **opus** | after 1; parallel with 3 |
| 3 | Label registry, view and input helpers (pure, `apps/web/src/lib/contacts`) | bis-crm | sonnet | after 1; parallel with 2 |
| 4 | Server actions, shared hand-add helper, read route, error copy | bis-crm | **opus** | after 2 and 3 |
| 5 | `RelationshipsCard` and the add dialog, mounted on drawer and detail page, UI copy | bis-frontend | sonnet | after 4 |
| 6 | e2e `relationships.spec.ts` on the per-run fixture account | bis-e2e-qa | sonnet | after 5 |
| 7 | Rollout (orchestrator, not code) | orchestrator | n/a | before merge |

Parallel group A = {2, 3}: disjoint trees (`packages/db/src/relationships.ts`, `index.ts`, `account-teardown.ts`, `packages/db/src/test/relationships.test.ts` vs `apps/web/src/lib/contacts/relationship-*.ts`). `apps/web/src/lib/messages.ts` is edited by Task 4 then Task 5, never in parallel, and never in parallel with Lane A's edit (below).

### Files this plan shares with Lane A (client groups, 0069)

The orchestrator sequences these. This lane's card lives in its own files (`relationships-card.tsx`, `add-relationship-dialog.tsx`), so a "Groups card" never edits them.

| Shared file | This plan's edit | Task |
|---|---|---|
| `apps/web/src/lib/messages.ts` | appends `relationships.error.*` (Task 4), then `relationships.*` (Task 5), each as one block just before `} as const;` | 4, 5 |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx` | one import and one `<RelationshipsCard … />` line between "Assigned to" and Recent | 5 |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts` | one `vi.mock("./relationships-card")` and one test | 5 |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx` | one import and one `<RelationshipsCard … />` line under `ContactFieldsPanel` | 5 |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts` | one `vi.mock("../relationships-card")` and one test | 5 |
| `packages/db/src/index.ts` | one additive export block | 2 |
| `packages/db/src/account-teardown.ts` | `"contact_relationships"` inserted before `"contacts"` | 2 |
| `packages/db/src/test/schema-grants-guard.test.ts` | one `EXPECTED_WRITES` entry | 1 |
| `packages/db/package.json` | one `exports` line | 1 |
| `apps/web/e2e/fixtures/fixture-names.test.ts` | one or two entries in the not-swept list | 6 |
| `docs/runbooks/ci-supabase-project.md` | run-log line for 0070 | 7 |
| migration numbering | 0069 is Lane A's, 0070 is this lane's, settled before ANY CI-project apply; if Lane A lands second the files swap numbers and every reference in this plan's paths follows | 7 |

---

## Task 1: Migration 0070, `relationship-keys.ts`, the RLS and grants proof

**Owner:** bis-db-schema. **Review:** opus. **Sequential:** first. **Scratch:** `s02b-t1-impl/`, replica port `55470` (reviewer `s02b-t1-review/`, `55471`).

**Files**
- Create: `packages/db/supabase/migrations/0070_contact_relationships.sql`
- Create: `packages/db/src/relationship-keys.ts`
- Create: `packages/db/src/test/contact-relationships-schema.test.ts`
- Modify: `packages/db/package.json` (`exports`: add `"./relationship-keys": "./src/relationship-keys.ts"`)
- Modify: `packages/db/src/test/schema-grants-guard.test.ts` (`EXPECTED_WRITES`, after `"authenticated contact_duplicate_flags"`)

**Interfaces**
- Consumes (SQL, from 0068): `app.sees_all_customers(uuid)`, `app.my_contact_ids()`, `app.is_agency()`, `app.current_account_id()`; `contacts_account_id_id_key` (0050:93-94).
- Produces (SQL): table `public.contact_relationships`; constraints `contact_relationships_contact_fkey`, `contact_relationships_related_fkey`, `contact_relationships_label_key`, `contact_relationships_forms`, `contact_relationships_not_self`, `contact_relationships_custom`, `contact_relationships_custom_trimmed`, `contact_relationships_emergency`, `contact_relationships_pickup`; indexes `contact_relationships_pair` (unique, family and symmetric labels, order-free), `contact_relationships_directed` (unique, support labels, per direction; R7), `contact_relationships_by_contact`, `contact_relationships_by_related` (corrected by the final review: the list predated R7 and the edge-space CHECK); policies `contact_relationships_member_all`, `contact_relationships_technician_read|insert|update|delete`.
- Produces (TS, `@bis/db/relationship-keys`):

```ts
export const RELATIONSHIP_KEYS: readonly ["parent","spouse","sibling","godparent","compadre","emergency_contact","authorized_pickup","responsible_party","caregiver","landlord","referred","other"];
export type RelationshipKey = (typeof RELATIONSHIP_KEYS)[number];
export type WordForm = "f" | "m";
export function isRelationshipKey(v: unknown): v is RelationshipKey;
export type RelationshipRow = { id: string; account_id: string; contact_id: string; related_contact_id: string; label_key: RelationshipKey; custom_label: string | null; contact_form: WordForm | null; related_form: WordForm | null; contact_can_pick_up: boolean; contact_is_emergency: boolean; related_can_pick_up: boolean; related_is_emergency: boolean; created_at: string; updated_at: string };
export const RELATIONSHIP_COLUMNS: string;
export type RelatedPerson = { id: string; first_name: string | null; last_name: string | null };
export const SIDE_COLUMNS: readonly ["contact_form","related_form","contact_can_pick_up","contact_is_emergency","related_can_pick_up","related_is_emergency"];
export type SideColumn = (typeof SIDE_COLUMNS)[number];
export type RelationshipSidesPatch = Partial<Pick<RelationshipRow, SideColumn>>;
```

- [ ] **Step 1: Build your replica** (memory "Local DB replica"; your scratch dir, port 55470). Shell state does not survive between your bash calls, so first write an env file with ABSOLUTE paths (replace `<SCRATCH>` with your session scratchpad's absolute path, written out literally), and start every later command block with `source <SCRATCH>/s02b-t1-impl/env.sh && cd <WORKTREE>`:

```bash
mkdir -p "<SCRATCH>/s02b-t1-impl"
cat > "<SCRATCH>/s02b-t1-impl/env.sh" <<'EOF'
S="<SCRATCH>/s02b-t1-impl"
PGBIN="/c/Program Files/PostgreSQL/18/bin"
P() { "$PGBIN/psql" -h localhost -p 55470 -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
EOF
```

Then, from the worktree root, in Git Bash:

```bash
source "<SCRATCH>/s02b-t1-impl/env.sh"
"$PGBIN/initdb" -U postgres -A trust -D "$S/pgdata" > "$S/initdb.log" 2>&1
"$PGBIN/pg_ctl" -D "$S/pgdata" -o "-p 55470" -l "$S/pg.log" start </dev/null >/dev/null 2>&1
P -c "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls; grant anon, authenticated, service_role to postgres;"
P -c "create database pre"
P -d pre -c "alter database pre set timezone to 'UTC'"
P -d pre -c "create schema if not exists app; create schema if not exists extensions;"
sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql | P -d pre
for f in packages/db/supabase/migrations/0*.sql; do
  case "$f" in *0070_*) continue;; esac
  P -d pre -1 -f "$f" || { echo "FAILED at $f"; break; }
done
```

Expected: no `FAILED at` line.

- [ ] **Step 2: Verify the facts the migration relies on** (read-only, on `pre`):

```bash
source "<SCRATCH>/s02b-t1-impl/env.sh"
P -d pre -At -c "select proname from pg_proc where proname in ('sees_all_customers','my_contact_ids','is_agency','current_account_id') order by 1"
P -d pre -At -c "select conname from pg_constraint where conname = 'contacts_account_id_id_key'"
P -d pre -At -c "select to_regclass('public.contact_relationships')"
ls packages/db/supabase/migrations | tail -3
```

Expected: the four function names; `contacts_account_id_id_key`; an empty `to_regclass`; the newest migration file before yours is `0068_mine_unassigned_technician.sql` or Lane A's `0069_*`. If a later number exists on your branch that is not Lane A's 0069, stop and report: the numbering must be settled (Task 7).

- [ ] **Step 3: Create `packages/db/src/relationship-keys.ts`:**

```ts
/**
 * Relationships between customers (spec §4.1, migration 0070): the fixed list of label keys and
 * the row shape. Dependency-free on purpose: apps/web's client components import it through
 * "@bis/db/relationship-keys" without pulling supabase-js into the browser bundle. 0070's
 * contact_relationships_label_key CHECK lists exactly these keys, and
 * contact-relationships-schema.test.ts compares the two.
 */
export const RELATIONSHIP_KEYS = [
  "parent", "spouse", "sibling", "godparent", "compadre", "emergency_contact",
  "authorized_pickup", "responsible_party", "caregiver", "landlord", "referred", "other",
] as const;
export type RelationshipKey = (typeof RELATIONSHIP_KEYS)[number];

/** A person's grammatical form for one relationship's words (spec C1). Null is the neutral word. */
export type WordForm = "f" | "m";

export function isRelationshipKey(v: unknown): v is RelationshipKey {
  return typeof v === "string" && (RELATIONSHIP_KEYS as readonly string[]).includes(v);
}

/** One row, read "contact_id is related_contact_id's label_key" (spec §4.2). */
export type RelationshipRow = {
  id: string;
  account_id: string;
  contact_id: string;
  related_contact_id: string;
  label_key: RelationshipKey;
  custom_label: string | null;
  contact_form: WordForm | null;
  related_form: WordForm | null;
  contact_can_pick_up: boolean;
  contact_is_emergency: boolean;
  related_can_pick_up: boolean;
  related_is_emergency: boolean;
  created_at: string;
  updated_at: string;
};

export const RELATIONSHIP_COLUMNS =
  "id, account_id, contact_id, related_contact_id, label_key, custom_label, contact_form, related_form, " +
  "contact_can_pick_up, contact_is_emergency, related_can_pick_up, related_is_emergency, created_at, updated_at";

/** The other person on a relationship, as the caller's RLS lets them read it. */
export type RelatedPerson = { id: string; first_name: string | null; last_name: string | null };

/** The only columns the client role may update (0070's column grant), the per-side forms and flags. */
export const SIDE_COLUMNS = [
  "contact_form", "related_form", "contact_can_pick_up", "contact_is_emergency", "related_can_pick_up", "related_is_emergency",
] as const;
export type SideColumn = (typeof SIDE_COLUMNS)[number];
export type RelationshipSidesPatch = Partial<Pick<RelationshipRow, SideColumn>>;
```

And in `packages/db/package.json` `exports`, after `"./profile-ready": "./src/profile-ready.ts"`, add a comma and `"./relationship-keys": "./src/relationship-keys.ts"`.

- [ ] **Step 4: Write the failing test** `packages/db/src/test/contact-relationships-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs } from "./db";
import { RELATIONSHIP_KEYS } from "../relationship-keys";

/**
 * Relationships between customers (spec §5, migration 0070). One row per pair, both people in the
 * row's own account (composite keys, 0050's shape), unique in either direction, client-written
 * under RLS, and fenced for a Technician like 0068: reading needs EITHER person to be theirs,
 * writing needs BOTH. A refused SELECT/UPDATE/DELETE is not an error (rowCount 0); a refused
 * INSERT, a column without a grant, or a failed constraint raises.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_rel_${RUN}`;
const ORG_B = `org_relb_${RUN}`;
const SUB = {
  owner: `user_r_owner_${RUN}`, staff: `user_r_staff_${RUN}`, tech: `user_r_tech_${RUN}`,
  tech2: `user_r_tech2_${RUN}`, none: `user_r_none_${RUN}`, ownerB: `user_r_ownerb_${RUN}`,
} as const;
type Person = keyof typeof SUB;
const claimsFor = (a: Person | "agency") =>
  a === "agency" ? { app_role: "agency_admin", sub: `user_r_agency_${RUN}` }
    : { org_id: a === "ownerB" ? ORG_B : ORG, sub: SUB[a] };

/** One refusal otherwise aborts the whole withRollback transaction (25P02). */
const refused = async (c: Client, sql: string, args: unknown[]) => {
  await c.query("savepoint refused");
  try {
    return await c.query(sql, args);
  } finally {
    await c.query("rollback to savepoint refused");
  }
};

async function seed(c: Client) {
  const one = async (sql: string, args: unknown[]) => (await c.query<{ id: string }>(sql, args)).rows[0]!.id;
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const account = (org: string, name: string) => one(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, org, name]);
  const acct = await account(ORG, "Rel Co");
  const acctB = await account(ORG_B, "Rel B Co");
  const users = {} as Record<Person, string>;
  for (const k of Object.keys(SUB) as Person[]) {
    users[k] = await one("insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB[k]]);
  }
  await c.query(
    `insert into memberships (user_id, scope, account_id, role) values
       ($1,'account',$6,'owner'), ($2,'account',$6,'staff'), ($3,'account',$6,'technician'),
       ($4,'account',$6,'technician'), ($5,'account',$7,'owner')`,
    [users.owner, users.staff, users.tech, users.tech2, users.ownerB, acct, acctB]);
  const contact = (a: string, name: string, assignee: string | null) =>
    one("insert into contacts (account_id, first_name, assigned_to) values ($1,$2,$3) returning id", [a, name, assignee]);
  const mine = await contact(acct, "Mine", users.tech);
  const mine2 = await contact(acct, "Mine Too", users.tech);
  const theirs = await contact(acct, "Theirs", users.tech2);
  const open = await contact(acct, "Open", null);
  const elsewhere = await contact(acctB, "Elsewhere", null);
  const rel = (a: string, b: string, key: string) => one(
    "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,$4) returning id",
    [acct, a, b, key]);
  const r = {
    mineTheirs: await rel(mine, theirs, "parent"),
    openMine: await rel(open, mine, "sibling"),
    mineMine2: await rel(mine, mine2, "spouse"),
    theirsOpen: await rel(theirs, open, "godparent"),
  };
  return { acct, acctB, users, mine, mine2, theirs, open, elsewhere, r };
}
type Seeded = Awaited<ReturnType<typeof seed>>;

const visibleIds = async (c: Client, acct: string) =>
  (await c.query<{ id: string }>("select id from contact_relationships where account_id = $1 order by id", [acct])).rows.map((x) => x.id);
const all = (s: Seeded) => Object.values(s.r).sort();

describe("shape", () => {
  it("row level security is on; the policies are the tenant policy and four restrictive Technician fences (mutation: drop contact_relationships_technician_delete -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ on: boolean }>(
        "select relrowsecurity as on from pg_class where oid = 'public.contact_relationships'::regclass");
      expect(t!.on).toBe(true);
      const { rows } = await c.query(
        "select policyname, permissive, cmd, roles::text as roles from pg_policies where schemaname = 'public' and tablename = 'contact_relationships' order by policyname");
      expect(rows).toEqual([
        { policyname: "contact_relationships_member_all", permissive: "PERMISSIVE", cmd: "ALL", roles: "{authenticated}" },
        { policyname: "contact_relationships_technician_delete", permissive: "RESTRICTIVE", cmd: "DELETE", roles: "{authenticated}" },
        { policyname: "contact_relationships_technician_insert", permissive: "RESTRICTIVE", cmd: "INSERT", roles: "{authenticated}" },
        { policyname: "contact_relationships_technician_read", permissive: "RESTRICTIVE", cmd: "SELECT", roles: "{authenticated}" },
        { policyname: "contact_relationships_technician_update", permissive: "RESTRICTIVE", cmd: "UPDATE", roles: "{authenticated}" },
      ]);
    }));

  it("label_key's CHECK lists exactly RELATIONSHIP_KEYS (mutation: add 'cousin' to RELATIONSHIP_KEYS only -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [d] } = await c.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'contact_relationships_label_key'");
      const keys = [...d!.def.matchAll(/'([a-z_]+)'::text/g)].map((x) => x[1]).sort();
      expect(keys).toEqual([...RELATIONSHIP_KEYS].sort());
    }));
});

describe("integrity (as the table owner)", () => {
  it("refuses a relationship with oneself (mutation: drop contact_relationships_not_self -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$2,'sibling')",
      [s.acct, s.mine])).rejects.toMatchObject({ code: "23514" });
  }));

  it("refuses a person from another account, either way round (mutation: single-column FK on related_contact_id -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'parent')",
      [s.acct, s.mine, s.elsewhere])).rejects.toMatchObject({ code: "23503" });
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'parent')",
      [s.acctB, s.elsewhere, s.mine])).rejects.toMatchObject({ code: "23503" });
  }));

  it("refuses the same label for a pair in the reverse direction (mutation: index on (contact_id, related_contact_id) without least/greatest -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'parent')",
        [s.acct, s.theirs, s.mine])).rejects.toMatchObject({ code: "23505" });
    }));

  it("'Other' is unique per pair regardless of case; a different text or label is allowed (mutation: drop lower() from the index -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const other = (a: string, b: string, label: string) => c.query(
        "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, custom_label) values ($1,$2,$3,'other',$4)",
        [s.acct, a, b, label]);
      expect((await other(s.mine, s.open, "Vecina")).rowCount).toBe(1);
      await expect(refused(c,
        "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, custom_label) values ($1,$2,$3,'other','VECINA')",
        [s.acct, s.open, s.mine])).rejects.toMatchObject({ code: "23505" });
      expect((await other(s.open, s.mine, "Patrona")).rowCount).toBe(1);
      expect((await c.query(
        "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, contact_is_emergency) values ($1,$2,$3,'emergency_contact',true)",
        [s.acct, s.mine, s.theirs])).rowCount).toBe(1);
    }));

  it("custom_label belongs to 'other' only and is 1 to 60 characters (mutation: drop contact_relationships_custom -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const ins = (key: string, label: string | null) => refused(c,
      "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, custom_label) values ($1,$2,$3,$4,$5)",
      [s.acct, s.mine2, s.open, key, label]);
    await expect(ins("other", null)).rejects.toMatchObject({ code: "23514" });
    await expect(ins("caregiver", "Nana")).rejects.toMatchObject({ code: "23514" });
    await expect(ins("other", "x".repeat(61))).rejects.toMatchObject({ code: "23514" });
    await expect(ins("other", "")).rejects.toMatchObject({ code: "23514" });
  }));

  it("an emergency-contact or authorized-pickup label sets side A's flag (mutation: drop contact_relationships_emergency -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'emergency_contact')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "23514" });
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'authorized_pickup')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "23514" });
  }));

  it("an unknown key or word form is refused", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'cousin')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "23514" });
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key, contact_form) values ($1,$2,$3,'caregiver','x')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "23514" });
  }));

  it("deleting either person removes their relationships (mutation: on delete no action -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("delete from contacts where id = $1", [s.theirs]);
    expect(await visibleIds(c, s.acct)).toEqual([s.r.openMine, s.r.mineMine2].sort());
  }));
});

describe("grants and the tenant (as members)", () => {
  it("an Owner changes a flag, never the people or the label (mutation: grant update (label_key) -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("owner"));
    expect((await c.query("update contact_relationships set contact_can_pick_up = true, updated_at = now() where id = $1", [s.r.mineTheirs])).rowCount).toBe(1);
    await expect(refused(c, "update contact_relationships set label_key = 'spouse' where id = $1", [s.r.mineTheirs])).rejects.toMatchObject({ code: "42501" });
    await expect(refused(c, "update contact_relationships set related_contact_id = $2 where id = $1", [s.r.mineTheirs, s.open])).rejects.toMatchObject({ code: "42501" });
  }));

  it("another company's Owner reads none and cannot write here (mutation: member_all USING (true) -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("ownerB"));
    expect(await visibleIds(c, s.acct)).toEqual([]);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'caregiver')",
      [s.acct, s.mine2, s.open])).rejects.toMatchObject({ code: "42501" });
  }));

  for (const actor of ["owner", "staff", "agency"] as const) {
    it(`${actor}: reads every relationship of the account (mutation: key the read fence on is_account_owner -> the staff case FAILS)`, () =>
      withRollback(async (c) => {
        const s = await seed(c);
        await actAs(c, claimsFor(actor));
        expect(await visibleIds(c, s.acct)).toEqual(all(s));
      }));
  }

  it("a client with no membership reads none (mutation: write the read fence as `(select not app.is_technician(app.current_account_id())) or ...` -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("none"));
      expect(await visibleIds(c, s.acct)).toEqual([]);
    }));
});

describe("the Technician (spec §5.3)", () => {
  it("reads a relationship when EITHER person is theirs, never one with neither (mutation: drop contact_relationships_technician_read -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect(await visibleIds(c, s.acct)).toEqual([s.r.mineTheirs, s.r.openMine, s.r.mineMine2].sort());
    }));

  it("adds one only between two of their own customers (mutation: insert fence with the read expression -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAs(c, claimsFor("tech"));
    expect((await c.query("insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'compadre')",
      [s.acct, s.mine2, s.mine])).rowCount).toBe(1);
    await expect(refused(c, "insert into contact_relationships (account_id, contact_id, related_contact_id, label_key) values ($1,$2,$3,'caregiver')",
      [s.acct, s.mine, s.open])).rejects.toMatchObject({ code: "42501" });
  }));

  it("changes or removes one only when both people are theirs (mutation: update and delete fences with the read expression -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAs(c, claimsFor("tech"));
      expect((await c.query("update contact_relationships set contact_can_pick_up = true where id = $1", [s.r.mineTheirs])).rowCount).toBe(0);
      expect((await c.query("delete from contact_relationships where id = $1", [s.r.mineTheirs])).rowCount).toBe(0);
      expect((await c.query("update contact_relationships set contact_form = 'f' where id = $1", [s.r.mineMine2])).rowCount).toBe(1);
      expect((await c.query("delete from contact_relationships where id = $1", [s.r.mineMine2])).rowCount).toBe(1);
    }));
});
```

- [ ] **Step 5: Run it red on `pre`.**

```bash
source "<SCRATCH>/s02b-t1-impl/env.sh" && cd <WORKTREE>/packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55470/pre NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= BIS_CI_SUPABASE_REF= pnpm exec vitest run src/test/contact-relationships-schema.test.ts > "$S/t1-red.txt" 2>&1; echo $? > "$S/t1-red.exit"
```

Expected: every case fails with `relation "contact_relationships" does not exist` (or `pg_class` cast error for the first). Paste one failing line into the report. The blank `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` make the global setup skip its sweep (`src/test/global-setup.ts:31`), so nothing reaches bis-ci.

- [ ] **Step 6: Write the migration** `packages/db/supabase/migrations/0070_contact_relationships.sql`:

```sql
-- 0070_contact_relationships.sql - relationships between customers
-- (docs/superpowers/specs/2026-10-11-contact-relationships-design.md section 5)
--
-- One row per pair, read "contact_id is related_contact_id's label_key". Each record shows a chip
-- naming the OTHER person, in the reader's language, from a typed registry in apps/web; the
-- database holds the key only (label_key CHECK = @bis/db/relationship-keys RELATIONSHIP_KEYS,
-- pinned by contact-relationships-schema.test.ts). Each side has its own grammatical form
-- (contact_form, related_form; null = neutral word) and its own two flags.
--
-- Both people belong to the row's own account: composite keys to contacts (account_id, id),
-- 0050's shape. Unique in either direction through least/greatest. Client-written under RLS
-- (operator-entered state, like notes and contact_tags), with 0068-style restrictive fences:
-- a Technician reads a row when EITHER person is theirs and writes only when BOTH are.
--
-- Two foreign keys to contacts: an unhinted PostgREST embed contacts(...) on this table is
-- ambiguous (0050's note). @bis/db/relationships.ts never embeds.
--
-- APPLY ORDER: CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
-- apply_migration), then the parity check, then merge. The number is settled with Lane A's 0069
-- BEFORE the CI-project apply.
--
-- ROLLBACK (revert the app first; this drops what operators typed, so only on an owner decision):
--   drop table public.contact_relationships;
--
-- ASCII only, no backslash anywhere.

set local lock_timeout = '5s';

create table public.contact_relationships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_id uuid not null,
  related_contact_id uuid not null,
  label_key text not null,
  custom_label text,
  contact_form text,
  related_form text,
  contact_can_pick_up boolean not null default false,
  contact_is_emergency boolean not null default false,
  related_can_pick_up boolean not null default false,
  related_is_emergency boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_relationships_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade,
  constraint contact_relationships_related_fkey foreign key (account_id, related_contact_id)
    references public.contacts (account_id, id) on delete cascade,
  constraint contact_relationships_label_key check (label_key in (
    'parent', 'spouse', 'sibling', 'godparent', 'compadre', 'emergency_contact',
    'authorized_pickup', 'responsible_party', 'caregiver', 'landlord', 'referred', 'other')),
  constraint contact_relationships_forms check (
    (contact_form is null or contact_form in ('f', 'm')) and (related_form is null or related_form in ('f', 'm'))),
  constraint contact_relationships_not_self check (contact_id <> related_contact_id),
  constraint contact_relationships_custom check (
    (label_key = 'other') = (custom_label is not null)
    and (custom_label is null or char_length(custom_label) between 1 and 60)),
  -- These two labels ARE the flag on side A, so "who can pick X up" is always a flag read.
  constraint contact_relationships_emergency check (label_key <> 'emergency_contact' or contact_is_emergency),
  constraint contact_relationships_pickup check (label_key <> 'authorized_pickup' or contact_can_pick_up)
);

-- Order-free: the same label twice for a pair is refused whichever way round it was written.
create unique index contact_relationships_pair on public.contact_relationships (
  account_id, least(contact_id, related_contact_id), greatest(contact_id, related_contact_id),
  label_key, lower(coalesce(custom_label, '')));
-- "Relationships of X" reads both columns (a BitmapOr); both also serve the cascades.
create index contact_relationships_by_contact on public.contact_relationships (account_id, contact_id);
create index contact_relationships_by_related on public.contact_relationships (account_id, related_contact_id);

alter table public.contact_relationships enable row level security;

revoke all on public.contact_relationships from anon, authenticated;
grant select, insert, delete on public.contact_relationships to authenticated;
grant update (contact_form, related_form, contact_can_pick_up, contact_is_emergency,
              related_can_pick_up, related_is_emergency, updated_at)
  on public.contact_relationships to authenticated;
grant select, insert, update, delete on public.contact_relationships to service_role;

-- The tenant policy, 0003's uniform shape (0003_crm_core.sql:126-128, 0033:78-81).
create policy contact_relationships_member_all on public.contact_relationships
  for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- 0068's fences. sees_all_customers is coalesced (never NULL) and my_contact_ids() is empty for
-- anyone not a current Technician here, so an unknown role reads and writes nothing.
create policy contact_relationships_technician_read on public.contact_relationships
  as restrictive for select to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or contact_id in (select app.my_contact_ids())
         or related_contact_id in (select app.my_contact_ids()));
create policy contact_relationships_technician_insert on public.contact_relationships
  as restrictive for insert to authenticated
  with check ((select app.sees_all_customers(app.current_account_id()))
              or (contact_id in (select app.my_contact_ids())
                  and related_contact_id in (select app.my_contact_ids())));
create policy contact_relationships_technician_update on public.contact_relationships
  as restrictive for update to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or (contact_id in (select app.my_contact_ids())
             and related_contact_id in (select app.my_contact_ids())))
  with check ((select app.sees_all_customers(app.current_account_id()))
              or (contact_id in (select app.my_contact_ids())
                  and related_contact_id in (select app.my_contact_ids())));
create policy contact_relationships_technician_delete on public.contact_relationships
  as restrictive for delete to authenticated
  using ((select app.sees_all_customers(app.current_account_id()))
         or (contact_id in (select app.my_contact_ids())
             and related_contact_id in (select app.my_contact_ids())));
```

Check the file: `LC_ALL=C.UTF-8 grep -nP '[^\x00-\x7F]|\\' packages/db/supabase/migrations/0070_contact_relationships.sql` prints nothing (the pattern is "any non-ASCII byte, or one backslash").

- [ ] **Step 7: Build `post` and run green.**

```bash
source "<SCRATCH>/s02b-t1-impl/env.sh" && cd <WORKTREE>
P -c "create database post template pre"
P -d post -1 -f packages/db/supabase/migrations/0070_contact_relationships.sql
cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55470/post NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= BIS_CI_SUPABASE_REF= pnpm exec vitest run src/test/contact-relationships-schema.test.ts > "$S/t1-green.txt" 2>&1; echo $? > "$S/t1-green.exit"
```

Expected: `Tests  19 passed (19)` (count the `it`s if you changed any; report the exact line).

- [ ] **Step 8: The schema guard, red then green.** Run `src/test/schema-grants-guard.test.ts` on `post` with the same env prefix. Expected red: `gives anon nothing and authenticated exactly the allow-listed writes` with an extra `authenticated contact_relationships` key. Add to `EXPECTED_WRITES` after `"authenticated contact_duplicate_flags": IUD,`:

```ts
  "authenticated contact_relationships": insertDeleteAndUpdate([
    "contact_can_pick_up", "contact_form", "contact_is_emergency", "related_can_pick_up", "related_form",
    "related_is_emergency", "updated_at",
  ]),
```

Re-run: green. Then run the neighbours on `post` to prove nothing else moved: `src/test/technician-scope.test.ts src/test/rls.test.ts src/test/staff-roles.test.ts src/test/server-only-writes-grants.test.ts`. Paste the summary line.

- [ ] **Step 9: Mutation probes** on `post` (after `source "<SCRATCH>/s02b-t1-impl/env.sh"`, apply each with `P -d post -c "…"`, run the named test, paste its failing name, then rebuild `post` from `pre` with `P -c "drop database post" && P -c "create database post template pre" && P -d post -1 -f …0070…`):
  (a) `drop policy contact_relationships_technician_read on public.contact_relationships;` → "reads a relationship when EITHER person is theirs…" fails;
  (b) `alter table public.contact_relationships drop constraint contact_relationships_not_self;` → "refuses a relationship with oneself" fails;
  (c) `drop index public.contact_relationships_pair; create unique index on public.contact_relationships (account_id, contact_id, related_contact_id, label_key, lower(coalesce(custom_label,'')));` → "refuses the same label for a pair in the reverse direction" fails;
  (d) `grant update (label_key) on public.contact_relationships to authenticated;` → "an Owner changes a flag, never the people or the label" fails (and the schema guard).

- [ ] **Step 10: Stop the replica** (`"$PGBIN/pg_ctl" -D "$S/pgdata" stop`) and commit:

```bash
git add packages/db/supabase/migrations/0070_contact_relationships.sql packages/db/src/relationship-keys.ts packages/db/src/test/contact-relationships-schema.test.ts packages/db/package.json packages/db/src/test/schema-grants-guard.test.ts
git commit -m "feat(db): contact_relationships, one row per pair, same-account keys, Technician fences (migration 0070)" -- packages/db/supabase/migrations/0070_contact_relationships.sql packages/db/src/relationship-keys.ts packages/db/src/test/contact-relationships-schema.test.ts packages/db/package.json packages/db/src/test/schema-grants-guard.test.ts
```

Do NOT apply 0070 anywhere but your local replica.

**Reviewer (opus):** rebuild your own replica on `55471` in `s02b-t1-review/`, re-run steps 5, 7 and 8, and run probe (a) and one probe of your own choosing that the implementer did not run. Check the migration line by line against spec §5.

---

## Task 2: `@bis/db` queries, exports, account teardown

**Owner:** bis-crm. **Review:** opus. **Parallel group A** (with Task 3). **Scratch:** `s02b-t2-impl/`, Postgres `55472`, PostgREST `55473`, gateway `55474` (reviewer `s02b-t2-review/`, `55475`-`55477`).

**Files**
- Create: `packages/db/src/relationships.ts`
- Create: `packages/db/src/test/relationships.test.ts`
- Modify: `packages/db/src/index.ts` (one additive export block, after the `./assignment` block)
- Modify: `packages/db/src/account-teardown.ts` (`ACCOUNT_OWNED_TABLES`: `"contact_relationships"` immediately before `"contacts"`)

**Interfaces**
- Consumes: Task 1's `@bis/db/relationship-keys` exports; `emit(db, accountId, type, actorId, payload, actorType?)` (`events.ts:16`); `createContact` (`contacts.ts:408`) in tests; `withTestAccount` (`test/fixtures.ts:140`).
- Produces (exported from `@bis/db`):

```ts
export class RelationshipDbError extends Error { readonly code: string | undefined }
export const MAX_RELATIONSHIPS_READ = 100;
export type NewRelationship = {
  contactId: string; relatedContactId: string; labelKey: RelationshipKey; customLabel: string | null;
  contactForm: WordForm | null; relatedForm: WordForm | null;
  contactCanPickUp: boolean; contactIsEmergency: boolean; relatedCanPickUp: boolean; relatedIsEmergency: boolean;
};
export async function listContactRelationships(db: SupabaseClient, accountId: string, contactId: string): Promise<{ rows: RelationshipRow[]; people: RelatedPerson[] }>;
export async function getRelationship(db: SupabaseClient, accountId: string, relationshipId: string): Promise<RelationshipRow | null>;
export async function addRelationship(db: SupabaseClient, accountId: string, input: NewRelationship, actorId: string, actorType?: ActorType): Promise<RelationshipRow>;
export async function setRelationshipSides(db: SupabaseClient, accountId: string, relationshipId: string, patch: RelationshipSidesPatch, actorId: string, actorType?: ActorType): Promise<{ previous: RelationshipSidesPatch; row: RelationshipRow } | "not_found" | "refused">;
export async function removeRelationship(db: SupabaseClient, accountId: string, relationshipId: string, actorId: string, actorType?: ActorType): Promise<RelationshipRow | "not_found" | "refused">;
export async function restoreRelationship(db: SupabaseClient, accountId: string, row: RelationshipRow, actorId: string, actorType?: ActorType): Promise<RelationshipRow>;
// re-exported from ./relationship-keys:
RELATIONSHIP_KEYS, SIDE_COLUMNS, isRelationshipKey, type RelationshipKey, type WordForm, type RelationshipRow, type RelatedPerson, type RelationshipSidesPatch, type SideColumn
```

Events: `contact.relationship_added` (also on restore, with `restored: true`), `contact.relationship_updated` (with `fields`), `contact.relationship_removed`; payload `{ relationshipId, contactId, relatedContactId, labelKey }`, never the typed text.

- [ ] **Step 1: Stand up your local API** (memory "Local DB replica", 2026-10-08 addition; a previous lane's working copy is in an earlier session's scratchpad as `localapi.mjs`/`pgrst.conf`). Build the replica exactly as Task 1 steps 1 and 7 on port `55472` (database `post`, with Task 1's committed 0070 applied). Then, in your scratch dir:

`gateway.mjs`:

```js
// Local-only stand-in for Supabase's gateway: strips /rest/v1 and forwards to PostgREST on the
// replica; `node gateway.mjs keys` prints anon and service JWTs signed with a LOCAL-ONLY secret.
import http from "node:http";
import crypto from "node:crypto";
const SECRET = "local-replica-only-secret-s02b-not-a-real-key-0070";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (p) => { const h = b64({ alg: "HS256", typ: "JWT" }), b = b64(p);
  return `${h}.${b}.${crypto.createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url")}`; };
if (process.argv[2] === "keys") {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  console.log(`SERVICE=${sign({ role: "service_role", exp })}`);
  console.log(`ANON=${sign({ role: "anon", exp })}`);
  process.exit(0);
}
http.createServer((req, res) => {
  const path = req.url.replace(/^\/rest\/v1/, "") || "/";
  const up = http.request({ host: "127.0.0.1", port: 55473, path, method: req.method,
    headers: { ...req.headers, host: "127.0.0.1:55473" } }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
  req.pipe(up);
}).listen(55474, "127.0.0.1", () => console.log("gateway on 55474"));
```

`pgrst.conf` (PostgREST v14.14 Windows build; copy `postgrest.exe` from an earlier scratchpad's `pgrst/` or `gh release download v14.14 -R PostgREST/postgrest` and check its sha256):

```
db-uri = "postgres://postgres@localhost:55472/post"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "local-replica-only-secret-s02b-not-a-real-key-0070"
server-host = "127.0.0.1"
server-port = 55473
db-pool = 10
```

Start both with `</dev/null >"$S/x.log" 2>&1 &`, then `node gateway.mjs keys > "$S/keys.env"`. This file holds local-only tokens for a local-only secret; it is not an `.env` of the repo and never leaves your scratch dir.

`run.sh` (every Task 2 test run goes through it; write `<SCRATCH>` and `<WORKTREE>` as literal absolute paths, because shell state does not survive between your bash calls):

```bash
#!/usr/bin/env bash
# usage: run.sh <outfile> <vitest args...>
S="<SCRATCH>/s02b-t2-impl"; out=$1; shift
cd "<WORKTREE>/packages/db"
SUPABASE_DB_URL=postgresql://postgres@localhost:55472/post \
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55474 \
SUPABASE_SERVICE_ROLE_KEY=$(grep SERVICE "$S/keys.env" | cut -d= -f2) \
NEXT_PUBLIC_SUPABASE_ANON_KEY=$(grep ANON "$S/keys.env" | cut -d= -f2) \
CLERK_SECRET_KEY= BIS_CI_SUPABASE_REF= \
pnpm exec vitest run "$@" > "$S/$out" 2>&1
echo "vitest exit: $?" >> "$S/$out"
```

Fingerprint check before trusting it: `run.sh fp.txt src/test/contacts.test.ts` is green. **If the local API cannot be stood up in 20 minutes, stop and report** (do not run these tests against bis-ci, which lacks 0070).

- [ ] **Step 2: Write the failing test** `packages/db/src/test/relationships.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import { createContact } from "../contacts";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";
import {
  listContactRelationships, getRelationship, addRelationship, setRelationshipSides, removeRelationship,
  restoreRelationship, RelationshipDbError, type NewRelationship,
} from "../relationships";
import type { RelationshipKey } from "../relationship-keys";

const base = (a: string, b: string, labelKey: RelationshipKey = "parent"): NewRelationship => ({
  contactId: a, relatedContactId: b, labelKey, customLabel: null, contactForm: null, relatedForm: null,
  contactCanPickUp: false, contactIsEmergency: false, relatedCanPickUp: false, relatedIsEmergency: false,
});
const person = async (db: Parameters<typeof createContact>[0], accountId: string, firstName: string) =>
  (await createContact(db, accountId, { firstName, lastName: "Ramírez" }, "user_test")).id;

describe("relationships (spec §6)", () => {
  it("one row reads from both records, each with the OTHER person (mutation: return people for both ids -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const ana = await person(db, accountId, "Ana");
      const sofia = await person(db, accountId, "Sofía");
      const row = await addRelationship(db, accountId, { ...base(ana, sofia), contactForm: "f", relatedForm: "f" }, "user_test");
      const onSofia = await listContactRelationships(db, accountId, sofia);
      expect(onSofia.rows.map((r) => r.id)).toEqual([row.id]);
      expect(onSofia.people).toEqual([{ id: ana, first_name: "Ana", last_name: "Ramírez" }]);
      const onAna = await listContactRelationships(db, accountId, ana);
      expect(onAna.rows.map((r) => r.id)).toEqual([row.id]);
      expect(onAna.people).toEqual([{ id: sofia, first_name: "Sofía", last_name: "Ramírez" }]);
    }));

  it("a customer with none reads empty", () => withTestAccount(async (db, accountId) => {
    const solo = await person(db, accountId, "Solo");
    expect(await listContactRelationships(db, accountId, solo)).toEqual({ rows: [], people: [] });
  }));

  it("a non-uuid id is refused before any query is built (mutation: drop assertUuid -> FAILS with a PostgREST error instead)", () =>
    withTestAccount(async (db, accountId) => {
      await expect(listContactRelationships(db, accountId, "x,contact_id.neq.0")).rejects.toMatchObject({ code: "22P02", name: "RelationshipDbError" });
    }));

  it("a duplicate keeps its SQLSTATE (mutation: throw a plain Error -> FAILS)", () => withTestAccount(async (db, accountId) => {
    const a = await person(db, accountId, "A");
    const b = await person(db, accountId, "B");
    await addRelationship(db, accountId, base(a, b), "user_test");
    const e = await addRelationship(db, accountId, base(b, a), "user_test").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(RelationshipDbError);
    expect((e as RelationshipDbError).code).toBe("23505");
  }));

  it("setRelationshipSides changes only side columns and hands back what they were (mutation: previous read after the write -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b), "user_test");
      const r = await setRelationshipSides(db, accountId, row.id, { contact_can_pick_up: true, contact_form: "m" }, "user_test");
      if (typeof r === "string") throw new Error(`unexpected ${r}`);
      expect(r.previous).toEqual({ contact_can_pick_up: false, contact_form: null });
      expect((await getRelationship(db, accountId, row.id))).toMatchObject({ contact_can_pick_up: true, contact_form: "m" });
      expect(await setRelationshipSides(db, accountId, crypto.randomUUID(), { contact_form: "f" }, "user_test")).toBe("not_found");
      await expect(setRelationshipSides(db, accountId, row.id, { label_key: "spouse" } as never, "user_test")).rejects.toMatchObject({ code: "22023" });
    }));

  it("remove returns the row, a second remove finds nothing, restore puts back the same id (mutation: restore without id -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, base(a, b, "godparent"), "user_test");
      const removed = await removeRelationship(db, accountId, row.id, "user_test");
      expect(removed).toMatchObject({ id: row.id, label_key: "godparent" });
      expect(await removeRelationship(db, accountId, row.id, "user_test")).toBe("not_found");
      const back = await restoreRelationship(db, accountId, removed as typeof row, "user_test");
      expect(back.id).toBe(row.id);
      expect((await listContactRelationships(db, accountId, a)).rows.map((r) => r.id)).toEqual([row.id]);
    }));

  it("restoring when one person was deleted meanwhile keeps 23503 (mutation: swallow the error -> FAILS)", () => withTestAccount(async (db, accountId) => {
    const a = await person(db, accountId, "A");
    const b = await person(db, accountId, "B");
    const row = await addRelationship(db, accountId, base(a, b, "caregiver"), "user_test");
    const removed = await removeRelationship(db, accountId, row.id, "user_test");
    const { error } = await db.from("contacts").delete().eq("id", b);
    if (error) throw new Error(error.message);
    await expect(restoreRelationship(db, accountId, removed as typeof row, "user_test")).rejects.toMatchObject({ code: "23503" });
  }));

  it("each write appends its event with the ids and the key, never the typed text (mutation: drop the removed emit -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const a = await person(db, accountId, "A");
      const b = await person(db, accountId, "B");
      const row = await addRelationship(db, accountId, { ...base(a, b, "other"), customLabel: "Vecina" }, "user_test");
      await setRelationshipSides(db, accountId, row.id, { related_is_emergency: true }, "user_test");
      await removeRelationship(db, accountId, row.id, "user_test");
      const { data, error } = await db.from("events").select("type, payload").eq("account_id", accountId)
        // id, not created_at: three appends can share a millisecond. events.id is
        // `bigint generated always as identity` (0001_tenancy.sql:59), so it ascends with the appends.
        .like("type", "contact.relationship%").order("id", { ascending: true });
      if (error) throw new Error(error.message);
      expect((data ?? []).map((e) => e.type)).toEqual(
        ["contact.relationship_added", "contact.relationship_updated", "contact.relationship_removed"]);
      for (const e of data ?? []) {
        expect(e.payload).toMatchObject({ relationshipId: row.id, contactId: a, relatedContactId: b, labelKey: "other" });
        expect(JSON.stringify(e.payload)).not.toContain("Vecina");
      }
    }));

  it("account teardown removes relationships, listed before contacts (mutation: drop it from ACCOUNT_OWNED_TABLES -> FAILS)", async () => {
    expect(ACCOUNT_OWNED_TABLES.indexOf("contact_relationships")).toBeGreaterThan(-1);
    expect(ACCOUNT_OWNED_TABLES.indexOf("contact_relationships")).toBeLessThan(ACCOUNT_OWNED_TABLES.indexOf("contacts"));
    let seen = "";
    await withTestAccount(async (db, accountId) => {
      seen = accountId;
      await addRelationship(db, accountId, base(await person(db, accountId, "A"), await person(db, accountId, "B"), "sibling"), "user_test");
    });
    const { data, error } = await serviceDb().from("contact_relationships").select("id").eq("account_id", seen);
    if (error) throw new Error(error.message);
    expect(data).toEqual([]);
  });
});
```

(`serviceDb` lives in `packages/db/src/service.ts`; confirm the import path with `grep -n "export function serviceDb" packages/db/src/service.ts`.)

- [ ] **Step 3: Run red.** `run.sh t2-red.txt src/test/relationships.test.ts`. Expected: `Failed to resolve import "../relationships"`. Paste the line.

- [ ] **Step 4: Write `packages/db/src/relationships.ts`:**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import {
  RELATIONSHIP_COLUMNS, SIDE_COLUMNS, type RelationshipKey, type RelationshipRow, type RelatedPerson,
  type RelationshipSidesPatch, type SideColumn, type WordForm,
} from "./relationship-keys";

/**
 * Relationships between customers (spec §6, migration 0070). Every function runs on whichever
 * client the caller passes: the request client for a person's own action, so 0070's RLS and
 * Technician fences bind it. Never embeds contacts(...): the table has TWO foreign keys to
 * contacts and an unhinted embed is ambiguous (0050's note); the people are a second plain read.
 */

/** Keeps PostgREST's SQLSTATE, so a caller tells a duplicate (23505), a refusal (42501) or a
 *  vanished person (23503) apart by code, never by the wording of a message. */
export class RelationshipDbError extends Error {
  readonly code: string | undefined;
  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "RelationshipDbError";
    this.code = code || undefined;
  }
}
const dbError = (what: string, e: { message: string; code?: string }) => new RelationshipDbError(`${what}: ${e.message}`, e.code);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The id is interpolated into a PostgREST `or=` filter, so it is checked before any query is built. */
function assertUuid(v: string, what: string): void {
  if (!UUID.test(v)) throw new RelationshipDbError(`${what}: not a uuid`, "22P02");
}

export const MAX_RELATIONSHIPS_READ = 100;

export type NewRelationship = {
  contactId: string;
  relatedContactId: string;
  labelKey: RelationshipKey;
  customLabel: string | null;
  contactForm: WordForm | null;
  relatedForm: WordForm | null;
  contactCanPickUp: boolean;
  contactIsEmergency: boolean;
  relatedCanPickUp: boolean;
  relatedIsEmergency: boolean;
};

const payloadOf = (row: RelationshipRow) => ({
  relationshipId: row.id, contactId: row.contact_id, relatedContactId: row.related_contact_id, labelKey: row.label_key,
});

export async function listContactRelationships(
  db: SupabaseClient, accountId: string, contactId: string,
): Promise<{ rows: RelationshipRow[]; people: RelatedPerson[] }> {
  assertUuid(contactId, "listContactRelationships");
  const { data, error } = await db.from("contact_relationships").select(RELATIONSHIP_COLUMNS)
    .eq("account_id", accountId)
    .or(`contact_id.eq.${contactId},related_contact_id.eq.${contactId}`)
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .limit(MAX_RELATIONSHIPS_READ);
  if (error) throw dbError("listContactRelationships failed", error);
  const rows = (data ?? []) as unknown as RelationshipRow[];
  const otherIds = [...new Set(rows.map((r) => (r.contact_id === contactId ? r.related_contact_id : r.contact_id)))];
  if (otherIds.length === 0) return { rows, people: [] };
  // Under RLS a person the caller may not see simply does not come back (a Technician's
  // "someone not on your list", spec §5.3).
  const { data: people, error: pErr } = await db.from("contacts").select("id, first_name, last_name")
    .eq("account_id", accountId).in("id", otherIds);
  if (pErr) throw dbError("listContactRelationships people read failed", pErr);
  return { rows, people: (people ?? []) as RelatedPerson[] };
}

export async function getRelationship(db: SupabaseClient, accountId: string, relationshipId: string): Promise<RelationshipRow | null> {
  assertUuid(relationshipId, "getRelationship");
  const { data, error } = await db.from("contact_relationships").select(RELATIONSHIP_COLUMNS)
    .eq("account_id", accountId).eq("id", relationshipId).maybeSingle();
  if (error) throw dbError("getRelationship failed", error);
  return (data as unknown as RelationshipRow | null) ?? null;
}

export async function addRelationship(
  db: SupabaseClient, accountId: string, input: NewRelationship, actorId: string, actorType: ActorType = "user",
): Promise<RelationshipRow> {
  const { data, error } = await db.from("contact_relationships").insert({
    account_id: accountId,
    contact_id: input.contactId,
    related_contact_id: input.relatedContactId,
    label_key: input.labelKey,
    custom_label: input.customLabel,
    contact_form: input.contactForm,
    related_form: input.relatedForm,
    contact_can_pick_up: input.contactCanPickUp,
    contact_is_emergency: input.contactIsEmergency,
    related_can_pick_up: input.relatedCanPickUp,
    related_is_emergency: input.relatedIsEmergency,
  }).select(RELATIONSHIP_COLUMNS).single();
  if (error) throw dbError("addRelationship failed", error);
  const row = data as unknown as RelationshipRow;
  await emit(db, accountId, "contact.relationship_added", actorId, payloadOf(row), actorType);
  return row;
}

/**
 * Only the per-side forms and flags (0070's column grant). Reads first: an UPDATE that RLS filters
 * out raises nothing and returns no row, so "found but not written" is the refusal (a Technician
 * with one person hidden, spec §5.3).
 */
export async function setRelationshipSides(
  db: SupabaseClient, accountId: string, relationshipId: string, patch: RelationshipSidesPatch,
  actorId: string, actorType: ActorType = "user",
): Promise<{ previous: RelationshipSidesPatch; row: RelationshipRow } | "not_found" | "refused"> {
  const keys = Object.keys(patch) as SideColumn[];
  if (keys.length === 0 || keys.some((k) => !(SIDE_COLUMNS as readonly string[]).includes(k))) {
    throw new RelationshipDbError("setRelationshipSides: nothing to change, or not a side column", "22023");
  }
  const current = await getRelationship(db, accountId, relationshipId);
  if (!current) return "not_found";
  const previous: RelationshipSidesPatch = {};
  for (const k of keys) (previous as Record<string, unknown>)[k] = current[k];
  const { data, error } = await db.from("contact_relationships")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", relationshipId).select(RELATIONSHIP_COLUMNS);
  if (error) throw dbError("setRelationshipSides failed", error);
  const row = ((data ?? []) as unknown as RelationshipRow[])[0];
  if (!row) return "refused";
  await emit(db, accountId, "contact.relationship_updated", actorId, { ...payloadOf(row), fields: keys }, actorType);
  return { previous, row };
}

export async function removeRelationship(
  db: SupabaseClient, accountId: string, relationshipId: string, actorId: string, actorType: ActorType = "user",
): Promise<RelationshipRow | "not_found" | "refused"> {
  const current = await getRelationship(db, accountId, relationshipId);
  if (!current) return "not_found";
  const { data, error } = await db.from("contact_relationships").delete()
    .eq("account_id", accountId).eq("id", relationshipId).select("id");
  if (error) throw dbError("removeRelationship failed", error);
  if (!data || data.length === 0) return "refused";
  await emit(db, accountId, "contact.relationship_removed", actorId, payloadOf(current), actorType);
  return current;
}

/** The Undo of a remove: the same row, the same id (rule 6). */
export async function restoreRelationship(
  db: SupabaseClient, accountId: string, row: RelationshipRow, actorId: string, actorType: ActorType = "user",
): Promise<RelationshipRow> {
  if (row.account_id !== accountId) throw new RelationshipDbError("restoreRelationship: another account's row", "22023");
  const { data, error } = await db.from("contact_relationships")
    .insert({ ...row, updated_at: new Date().toISOString() }).select(RELATIONSHIP_COLUMNS).single();
  if (error) throw dbError("restoreRelationship failed", error);
  const restored = data as unknown as RelationshipRow;
  await emit(db, accountId, "contact.relationship_added", actorId, { ...payloadOf(restored), restored: true }, actorType);
  return restored;
}
```

- [ ] **Step 5: Exports and teardown.** In `packages/db/src/index.ts`, after the `./assignment` export block, add:

```ts
// Relationships between customers (0070). See ./relationships.ts and ./relationship-keys.ts.
export {
  listContactRelationships, getRelationship, addRelationship, setRelationshipSides, removeRelationship,
  restoreRelationship, RelationshipDbError, MAX_RELATIONSHIPS_READ, type NewRelationship,
} from "./relationships";
export {
  RELATIONSHIP_KEYS, SIDE_COLUMNS, isRelationshipKey,
  type RelationshipKey, type WordForm, type RelationshipRow, type RelatedPerson, type RelationshipSidesPatch, type SideColumn,
} from "./relationship-keys";
```

In `packages/db/src/account-teardown.ts:26`, change `"custom_values", "tags", "contacts",` to `"custom_values", "tags", "contact_relationships", "contacts",`.

- [ ] **Step 6: Run green.** `run.sh t2-green.txt src/test/relationships.test.ts src/test/contacts.test.ts`, then `pnpm --filter @bis/db exec tsc --noEmit` (exit to a file). Paste both summary lines.

- [ ] **Step 7: Mutation probes:** (a) in `removeRelationship` delete the `emit` line → "each write appends its event…" fails; (b) remove `"contact_relationships"` from `ACCOUNT_OWNED_TABLES` → "account teardown removes relationships…" fails; (c) in `restoreRelationship` insert `{ ...row, id: undefined }` → "remove returns the row… same id" fails. Paste each failing name, revert.

- [ ] **Step 8: Stop PostgREST, the gateway and the replica; commit.**

```bash
git add packages/db/src/relationships.ts packages/db/src/test/relationships.test.ts packages/db/src/index.ts packages/db/src/account-teardown.ts
git commit -m "feat(db): relationship queries, Undo-safe remove and restore, teardown before contacts" -- packages/db/src/relationships.ts packages/db/src/test/relationships.test.ts packages/db/src/index.ts packages/db/src/account-teardown.ts
```

---

## Task 3: Label registry, view and input helpers

**Owner:** bis-crm. **Review:** sonnet. **Parallel group A** (with Task 2). **Scratch:** `s02b-t3-impl/`. No database.

**Files**
- Create: `apps/web/src/lib/contacts/relationship-labels.ts`, `relationship-labels.test.ts`
- Create: `apps/web/src/lib/contacts/relationship-view.ts`, `relationship-view.test.ts`
- Create: `apps/web/src/lib/contacts/relationship-input.ts`, `relationship-input.test.ts`

**Interfaces**
- Consumes: `@bis/db/relationship-keys` (Task 1); `type NewRelationship` from `@bis/db` (Task 2's name; a type-only import, erased at compile, so it does not wait on Task 2's code to run tests; `pnpm --filter web typecheck` passes only once Task 2 has landed, which the orchestrator runs after group A); `isUuid` (`lib/assign/action-guards.ts:11`); `Locale` (`lib/i18n/locale.ts:6`).
- Produces:

```ts
// relationship-labels.ts
export type Forms = { readonly n: string; readonly f?: string; readonly m?: string };
export type SideWords = { readonly en: Forms; readonly es: Forms; readonly shape: "colon" | "phrase"; readonly esAgreesWithSubject?: true };
export type Side = { readonly words: SideWords; readonly pick?: { readonly en: string; readonly es: string } };
export type LabelEntry = { readonly symmetric: boolean; readonly a: Side; readonly b: Side; readonly offer: readonly ("a" | "b")[] };
export const RELATIONSHIP_LABELS: Readonly<Record<RelationshipKey, LabelEntry>>;
export type RelationshipOption = { value: string; key: RelationshipKey; side: "a" | "b"; label: string };
export function relationshipOptions(locale: Locale, subjectName: string): RelationshipOption[];
export type FormChoice = { n: string; f: string; m: string };
export function formChoices(key: RelationshipKey, otherSide: "a" | "b", locale: Locale, who: "other" | "subject"): FormChoice | null;
export function wordFor(key: RelationshipKey, side: "a" | "b", locale: Locale, namedForm: WordForm | null, subjectForm: WordForm | null): string;
export function personName(p: { firstName: string | null; lastName: string | null } | null, fallback: string): string;
export function chipText(view: RelationshipView, locale: Locale, names: { hidden: string; noName: string }): string;
export type ChipFormControl = { who: "named" | "subject"; choices: FormChoice; value: WordForm | null };
export function chipFormControl(view: RelationshipView, locale: Locale): ChipFormControl | null;
// relationship-view.ts
export type RelationshipView = { id: string; labelKey: RelationshipKey; customLabel: string | null; namedSide: "a" | "b"; person: { id: string; firstName: string | null; lastName: string | null } | null; namedForm: WordForm | null; subjectForm: WordForm | null; canPickUp: boolean; isEmergency: boolean; lockedFlag: "canPickUp" | "isEmergency" | null };
export function toRelationshipView(row: RelationshipRow, subjectId: string, people: readonly RelatedPerson[]): RelationshipView | null;
export type ViewPatch = { namedForm?: WordForm | null; subjectForm?: WordForm | null; canPickUp?: boolean; isEmergency?: boolean };
export function columnsForViewPatch(row: RelationshipRow, subjectId: string, patch: ViewPatch): RelationshipSidesPatch | null;
export type NewRelationshipFor = { subjectId: string; otherId: string; labelKey: RelationshipKey; otherSide: "a" | "b"; customLabel: string | null; otherForm: WordForm | null; subjectForm: WordForm | null };
export function newRelationshipFor(i: NewRelationshipFor): NewRelationship;
export type PreviewInput = Omit<NewRelationshipFor, "subjectId" | "otherId"> & { subject: { firstName: string | null; lastName: string | null }; other: { firstName: string | null; lastName: string | null } };
export function previewPair(i: PreviewInput): { onSubject: RelationshipView; onOther: RelationshipView };
// relationship-input.ts
export const CUSTOM_LABEL_MAX = 60;
export function cleanText(v: unknown): string;
export function cleanCustomLabel(v: unknown): string | null;
export type AddRelationshipInput = { subjectId: string; other: { kind: "existing"; contactId: string } | { kind: "new"; firstName: string; lastName: string; phone: string }; labelKey: RelationshipKey; side: "a" | "b"; customLabel: string | null; otherForm: WordForm | null; subjectForm: WordForm | null };
export function parseAddInput(v: unknown): { ok: true; input: AddRelationshipInput } | { ok: false; error: "self" | "invalid" };
export function parseViewPatch(v: unknown): ViewPatch | null;
export function parseSidesPatch(v: unknown): RelationshipSidesPatch | null;
export function parseRelationshipRow(v: unknown): RelationshipRow | null;
```

- [ ] **Step 1: Write the failing tests.**

`apps/web/src/lib/contacts/relationship-labels.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { RELATIONSHIP_KEYS } from "@bis/db/relationship-keys";
import { RELATIONSHIP_LABELS, relationshipOptions, formChoices, wordFor, chipText, chipFormControl } from "./relationship-labels";
import type { RelationshipView } from "./relationship-view";

const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;
const NAMES = { hidden: "someone not on your list", noName: "(no name)" };
const view = (over: Partial<RelationshipView>): RelationshipView => ({
  id: "r1", labelKey: "parent", customLabel: null, namedSide: "a",
  person: { id: "p1", firstName: "Ana", lastName: "Ramírez" }, namedForm: null, subjectForm: null,
  canPickUp: false, isEmergency: false, lockedFlag: null, ...over,
});

describe("the registry (spec §4.2): every pair reads from both sides in both languages", () => {
  for (const key of RELATIONSHIP_KEYS) {
    it(`${key}: sides a and b, English and Spanish, a neutral word, f with m (mutation: delete one es.b -> FAILS naming the key)`, () => {
      const entry = RELATIONSHIP_LABELS[key];
      for (const side of ["a", "b"] as const) {
        for (const locale of ["en", "es"] as const) {
          const forms = entry[side].words[locale];
          expect(forms, `${key}.${side}.${locale}`).toBeDefined();
          if (key !== "other") expect(forms.n.length, `${key}.${side}.${locale}.n`).toBeGreaterThan(0);
          expect(Boolean(forms.f), `${key}.${side}.${locale} f/m pair`).toBe(Boolean(forms.m));
          for (const w of [forms.n, forms.f, forms.m].filter(Boolean) as string[]) {
            expect(w, `${key}.${side}.${locale}`).not.toMatch(/[{}]/);
            expect(w).not.toMatch(INTERNAL_MILESTONE);
            expect(w).not.toContain("/");
          }
        }
      }
      if (entry.symmetric) expect(entry.b).toEqual(entry.a);
      expect(entry.offer.length).toBeGreaterThan(0);
      for (const side of entry.offer) {
        expect(entry[side].pick?.en, `${key}.${side} pick`).toBeTruthy();
        expect(entry[side].pick?.es, `${key}.${side} pick es`).toBeTruthy();
      }
    });
  }
  it("neutral Spanish uses the 'X o Y' form (C7; mutation: write 'Madre/padre' -> FAILS)", () => {
    expect(RELATIONSHIP_LABELS.parent.a.words.es.n).toBe("Madre o padre");
    expect(RELATIONSHIP_LABELS.parent.b.words.es.n).toBe("Hijo o hija");
    expect(RELATIONSHIP_LABELS.godparent.a.words.es.n).toBe("Padrino o madrina");
    expect(RELATIONSHIP_LABELS.compadre.a.words.es.n).toBe("Compadre o comadre");
  });
});

describe("chipText: the word names the OTHER person, in that person's form", () => {
  it("Sofía's record names her mother; Ana's names her daughter (mutation: use subjectForm for the named word -> FAILS)", () => {
    expect(chipText(view({ namedSide: "a", namedForm: "f", subjectForm: "f" }), "en", NAMES)).toBe("Mother: Ana Ramírez");
    expect(chipText(view({ namedSide: "a", namedForm: "f", subjectForm: "m" }), "es", NAMES)).toBe("Madre: Ana Ramírez");
    expect(chipText(view({ namedSide: "b", namedForm: "f", person: { id: "p2", firstName: "Sofía", lastName: "Ramírez" } }), "es", NAMES)).toBe("Hija: Sofía Ramírez");
    expect(chipText(view({ namedSide: "a" }), "es", NAMES)).toBe("Madre o padre: Ana Ramírez");
  });
  it("phrase-shaped sides read without a colon", () => {
    expect(chipText(view({ labelKey: "emergency_contact", namedSide: "b" }), "en", NAMES)).toBe("Emergency contact for Ana Ramírez");
    expect(chipText(view({ labelKey: "caregiver", namedSide: "b" }), "es", NAMES)).toBe("Cuida a Ana Ramírez");
  });
  it("Spanish 'referred' agrees with the record's own customer (mutation: drop esAgreesWithSubject -> FAILS)", () => {
    expect(chipText(view({ labelKey: "referred", namedSide: "a", namedForm: "m", subjectForm: "f" }), "es", NAMES)).toBe("Referida por Ana Ramírez");
    expect(chipText(view({ labelKey: "referred", namedSide: "a", namedForm: "f", subjectForm: null }), "es", NAMES)).toBe("Recomendación de Ana Ramírez");
    expect(chipText(view({ labelKey: "referred", namedSide: "a", subjectForm: "f" }), "en", NAMES)).toBe("Referred by Ana Ramírez");
  });
  it("'Other' shows the typed label as-is in both languages", () => {
    expect(chipText(view({ labelKey: "other", customLabel: "Vecina" }), "en", NAMES)).toBe("Vecina: Ana Ramírez");
    expect(chipText(view({ labelKey: "other", customLabel: "Vecina" }), "es", NAMES)).toBe("Vecina: Ana Ramírez");
  });
  it("a person the reader may not see reads as the hidden-person words (C5)", () => {
    expect(chipText(view({ person: null, namedForm: "f" }), "en", NAMES)).toBe("Mother: someone not on your list");
  });
});

describe("the dialog's choices", () => {
  it("offers both directions of an asymmetric label and the helper side of a support label, with the customer's name", () => {
    const options = relationshipOptions("en", "Sofía");
    const labels = options.map((o) => o.label);
    expect(labels).toContain("Parent");
    expect(labels).toContain("Child");
    expect(labels).toContain("Referred Sofía");
    expect(labels).toContain("Was referred by Sofía");
    expect(options.filter((o) => o.key === "emergency_contact").map((o) => o.side)).toEqual(["a"]);
    expect(options.filter((o) => o.key === "spouse")).toHaveLength(1);
    expect(relationshipOptions("es", "Sofía").map((o) => o.label)).toContain("Padrino o madrina");
  });
  it("word-form rows: the other person's for a family word; the subject's for Spanish 'referred' side a (mutation: ignore esAgreesWithSubject -> FAILS)", () => {
    expect(formChoices("parent", "a", "es", "other")).toEqual({ n: "Madre o padre", f: "Madre", m: "Padre" });
    expect(formChoices("parent", "a", "es", "subject")).toEqual({ n: "Hijo o hija", f: "Hija", m: "Hijo" });
    expect(formChoices("referred", "a", "es", "other")).toBeNull();
    expect(formChoices("referred", "a", "es", "subject")).toEqual({ n: "Recomendación de", f: "Referida por", m: "Referido por" });
    expect(formChoices("emergency_contact", "a", "en", "other")).toBeNull();
  });
  it("wordFor falls back to the neutral word", () => {
    expect(wordFor("landlord", "b", "es", null, null)).toBe("Inquilino o inquilina");
    expect(wordFor("landlord", "b", "es", "f", null)).toBe("Inquilina");
  });
  it("a chip's form control: the named person's, the subject's for Spanish 'referred', none for a hidden person or a neutral-only word", () => {
    expect(chipFormControl(view({ namedForm: "f" }), "en")).toEqual({ who: "named", choices: { n: "Parent", f: "Mother", m: "Father" }, value: "f" });
    expect(chipFormControl(view({ labelKey: "referred", namedSide: "a", subjectForm: "m" }), "es")?.who).toBe("subject");
    expect(chipFormControl(view({ person: null }), "en")).toBeNull();
    expect(chipFormControl(view({ labelKey: "responsible_party" }), "es")).toBeNull();
  });
});
```

`apps/web/src/lib/contacts/relationship-view.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { RelationshipRow } from "@bis/db/relationship-keys";
import { toRelationshipView, columnsForViewPatch, newRelationshipFor, previewPair } from "./relationship-view";

const S = "11111111-1111-4111-8111-111111111111"; // the record's own customer
const O = "22222222-2222-4222-8222-222222222222"; // the other person
const row = (over: Partial<RelationshipRow>): RelationshipRow => ({
  id: "33333333-3333-4333-8333-333333333333", account_id: "44444444-4444-4444-8444-444444444444",
  contact_id: O, related_contact_id: S, label_key: "parent", custom_label: null, contact_form: "f", related_form: "m",
  contact_can_pick_up: true, contact_is_emergency: false, related_can_pick_up: false, related_is_emergency: true,
  created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z", ...over,
});
const PEOPLE = [{ id: O, first_name: "Ana", last_name: "Ramírez" }];

describe("toRelationshipView (spec §4.2)", () => {
  it("names the other person with their own side's form and flags (mutation: read the subject's flags -> FAILS)", () => {
    expect(toRelationshipView(row({}), S, PEOPLE)).toEqual({
      id: row({}).id, labelKey: "parent", customLabel: null, namedSide: "a",
      person: { id: O, firstName: "Ana", lastName: "Ramírez" }, namedForm: "f", subjectForm: "m",
      canPickUp: true, isEmergency: false, lockedFlag: null,
    });
    const flipped = toRelationshipView(row({ contact_id: S, related_contact_id: O }), S, PEOPLE)!;
    expect(flipped).toMatchObject({ namedSide: "b", namedForm: "m", subjectForm: "f", canPickUp: false, isEmergency: true });
  });
  it("a person the caller cannot read is null, and no id of theirs survives (C5)", () => {
    const v = toRelationshipView(row({}), S, [])!;
    expect(v.person).toBeNull();
    expect(JSON.stringify(v)).not.toContain(O);
  });
  it("locks the flag a support label already is, on side a only", () => {
    expect(toRelationshipView(row({ label_key: "emergency_contact", contact_is_emergency: true }), S, PEOPLE)!.lockedFlag).toBe("isEmergency");
    expect(toRelationshipView(row({ label_key: "authorized_pickup", contact_id: S, related_contact_id: O }), S, PEOPLE)!.lockedFlag).toBeNull();
  });
  it("a row that is not about this customer has no view", () => {
    expect(toRelationshipView(row({ contact_id: O, related_contact_id: "55555555-5555-4555-8555-555555555555" }), S, PEOPLE)).toBeNull();
  });
});

describe("columnsForViewPatch: the view's words map back to the right side's columns", () => {
  it("named on side a writes contact_*; named on side b writes related_* (mutation: swap the sides -> FAILS)", () => {
    expect(columnsForViewPatch(row({}), S, { canPickUp: false, namedForm: null })).toEqual({ contact_can_pick_up: false, contact_form: null });
    expect(columnsForViewPatch(row({ contact_id: S, related_contact_id: O }), S, { isEmergency: true, subjectForm: "f" }))
      .toEqual({ related_is_emergency: true, contact_form: "f" });
    expect(columnsForViewPatch(row({ contact_id: O, related_contact_id: "55555555-5555-4555-8555-555555555555" }), S, { canPickUp: true })).toBeNull();
  });
});

describe("newRelationshipFor and previewPair", () => {
  it("the other person on side a is contact_id; a support label sets its flag", () => {
    expect(newRelationshipFor({ subjectId: S, otherId: O, labelKey: "emergency_contact", otherSide: "a", customLabel: null, otherForm: null, subjectForm: "f" }))
      .toEqual({ contactId: O, relatedContactId: S, labelKey: "emergency_contact", customLabel: null, contactForm: null, relatedForm: "f",
        contactCanPickUp: false, contactIsEmergency: true, relatedCanPickUp: false, relatedIsEmergency: false });
    expect(newRelationshipFor({ subjectId: S, otherId: O, labelKey: "parent", otherSide: "b", customLabel: "ignored", otherForm: "m", subjectForm: "f" }))
      .toMatchObject({ contactId: S, relatedContactId: O, contactForm: "f", relatedForm: "m", customLabel: null });
  });
  it("previews both records", () => {
    const p = previewPair({ labelKey: "parent", otherSide: "b", customLabel: null, otherForm: "f", subjectForm: "f",
      subject: { firstName: "Sofía", lastName: "Ramírez" }, other: { firstName: "Ana", lastName: "Ramírez" } });
    expect(p.onSubject).toMatchObject({ namedSide: "b", namedForm: "f", person: { firstName: "Ana" } });
    expect(p.onOther).toMatchObject({ namedSide: "a", namedForm: "f", person: { firstName: "Sofía" } });
  });
});
```

`apps/web/src/lib/contacts/relationship-input.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { cleanCustomLabel, parseAddInput, parseViewPatch, parseSidesPatch, parseRelationshipRow } from "./relationship-input";

const S = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const ok = { subjectId: S, other: { kind: "existing", contactId: O }, labelKey: "parent", side: "a", customLabel: null, otherForm: "f", subjectForm: null };
const ROW = {
  id: "33333333-3333-4333-8333-333333333333", account_id: "44444444-4444-4444-8444-444444444444",
  contact_id: O, related_contact_id: S, label_key: "other", custom_label: "Vecina", contact_form: null, related_form: "f",
  contact_can_pick_up: false, contact_is_emergency: false, related_can_pick_up: true, related_is_emergency: false,
  created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
};

describe("cleanCustomLabel", () => {
  it("strips edge whitespace with an explicit class, zero-width space included (mutation: use .trim() -> FAILS)", () => {
    expect(cleanCustomLabel("​ Vecina  ")).toBe("Vecina");
  });
  it("counts characters, not UTF-16 units, against 60 (mutation: use .length -> FAILS)", () => {
    expect(cleanCustomLabel("🙂".repeat(60))).toBe("🙂".repeat(60));
    expect(cleanCustomLabel("x".repeat(61))).toBeNull();
    expect(cleanCustomLabel("   ")).toBeNull();
    expect(cleanCustomLabel(7)).toBeNull();
  });
});

describe("parseAddInput (the server re-validates what the browser sent)", () => {
  it("accepts a well-formed add", () => expect(parseAddInput(ok)).toEqual({ ok: true, input: ok }));
  it("refuses oneself as self", () => expect(parseAddInput({ ...ok, other: { kind: "existing", contactId: S } })).toEqual({ ok: false, error: "self" }));
  it("refuses a side the label does not offer (mutation: skip the offer check -> FAILS)", () =>
    expect(parseAddInput({ ...ok, labelKey: "emergency_contact", side: "b" })).toEqual({ ok: false, error: "invalid" }));
  it("refuses an unknown key, a bad form, a missing 'Other' text, a non-uuid", () => {
    for (const bad of [{ ...ok, labelKey: "cousin" }, { ...ok, otherForm: "x" }, { ...ok, labelKey: "other", customLabel: " " }, { ...ok, subjectId: "nope" }]) {
      expect(parseAddInput(bad)).toEqual({ ok: false, error: "invalid" });
    }
  });
  it("a new person needs a first or last name; the custom label is cleaned and kept only for 'Other'", () => {
    expect(parseAddInput({ ...ok, other: { kind: "new", firstName: " ", lastName: "", phone: "" } })).toEqual({ ok: false, error: "invalid" });
    const r = parseAddInput({ ...ok, labelKey: "other", customLabel: " Vecina ", other: { kind: "new", firstName: " Ana ", lastName: "", phone: "956 555 0142" } });
    expect(r).toEqual({ ok: true, input: { ...ok, labelKey: "other", customLabel: "Vecina", other: { kind: "new", firstName: "Ana", lastName: "", phone: "956 555 0142" } } });
  });
});

describe("patches and the Undo snapshot", () => {
  it("parseViewPatch takes the four view keys only", () => {
    expect(parseViewPatch({ canPickUp: true })).toEqual({ canPickUp: true });
    expect(parseViewPatch({ namedForm: null, subjectForm: "m" })).toEqual({ namedForm: null, subjectForm: "m" });
    expect(parseViewPatch({})).toBeNull();
    expect(parseViewPatch({ canPickUp: "yes" })).toBeNull();
    expect(parseViewPatch({ label_key: "spouse" })).toBeNull();
  });
  it("parseSidesPatch takes side columns with their own types only (mutation: accept any key -> FAILS)", () => {
    expect(parseSidesPatch({ contact_form: "f", related_is_emergency: false })).toEqual({ contact_form: "f", related_is_emergency: false });
    expect(parseSidesPatch({ contact_form: true })).toBeNull();
    expect(parseSidesPatch({ label_key: "spouse" })).toBeNull();
    expect(parseSidesPatch({})).toBeNull();
  });
  it("parseRelationshipRow accepts exactly a stored row's shape", () => {
    expect(parseRelationshipRow(ROW)).toEqual(ROW);
    expect(parseRelationshipRow({ ...ROW, custom_label: " Vecina" })).toBeNull();
    expect(parseRelationshipRow({ ...ROW, label_key: "parent" })).toBeNull();
    expect(parseRelationshipRow({ ...ROW, contact_id: S })).toBeNull();
    expect(parseRelationshipRow({ ...ROW, extra: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/contacts/relationship-labels.test.ts src/lib/contacts/relationship-view.test.ts src/lib/contacts/relationship-input.test.ts`. Expected: three `Failed to resolve import` lines. Paste one.

- [ ] **Step 3: Write `relationship-view.ts`:**

```ts
import type { NewRelationship } from "@bis/db";
import type { RelationshipKey, RelationshipRow, RelatedPerson, RelationshipSidesPatch, WordForm } from "@bis/db/relationship-keys";

/**
 * One relationship as ONE record shows it (spec §4.2): the OTHER person ("named"), their side's
 * words, their form and their flags. Built on the server; a person the caller cannot read is
 * null and carries no id (C5). Pure and client-safe.
 */
export type RelationshipView = {
  id: string;
  labelKey: RelationshipKey;
  customLabel: string | null;
  namedSide: "a" | "b";
  person: { id: string; firstName: string | null; lastName: string | null } | null;
  namedForm: WordForm | null;
  subjectForm: WordForm | null;
  canPickUp: boolean;
  isEmergency: boolean;
  /** The label already says it ("Emergency contact", "Authorized pickup" on side a): shown, never toggled. */
  lockedFlag: "canPickUp" | "isEmergency" | null;
};

export function toRelationshipView(row: RelationshipRow, subjectId: string, people: readonly RelatedPerson[]): RelationshipView | null {
  if (row.contact_id !== subjectId && row.related_contact_id !== subjectId) return null;
  const namedIsA = row.related_contact_id === subjectId;
  const namedId = namedIsA ? row.contact_id : row.related_contact_id;
  const p = people.find((x) => x.id === namedId);
  return {
    id: row.id,
    labelKey: row.label_key,
    customLabel: row.custom_label,
    namedSide: namedIsA ? "a" : "b",
    person: p ? { id: p.id, firstName: p.first_name, lastName: p.last_name } : null,
    namedForm: namedIsA ? row.contact_form : row.related_form,
    subjectForm: namedIsA ? row.related_form : row.contact_form,
    canPickUp: namedIsA ? row.contact_can_pick_up : row.related_can_pick_up,
    isEmergency: namedIsA ? row.contact_is_emergency : row.related_is_emergency,
    lockedFlag: namedIsA && row.label_key === "emergency_contact" ? "isEmergency"
      : namedIsA && row.label_key === "authorized_pickup" ? "canPickUp" : null,
  };
}

export type ViewPatch = { namedForm?: WordForm | null; subjectForm?: WordForm | null; canPickUp?: boolean; isEmergency?: boolean };

export function columnsForViewPatch(row: RelationshipRow, subjectId: string, patch: ViewPatch): RelationshipSidesPatch | null {
  if (row.contact_id !== subjectId && row.related_contact_id !== subjectId) return null;
  const namedIsA = row.related_contact_id === subjectId;
  const out: RelationshipSidesPatch = {};
  if ("namedForm" in patch) out[namedIsA ? "contact_form" : "related_form"] = patch.namedForm ?? null;
  if ("subjectForm" in patch) out[namedIsA ? "related_form" : "contact_form"] = patch.subjectForm ?? null;
  if (patch.canPickUp !== undefined) out[namedIsA ? "contact_can_pick_up" : "related_can_pick_up"] = patch.canPickUp;
  if (patch.isEmergency !== undefined) out[namedIsA ? "contact_is_emergency" : "related_is_emergency"] = patch.isEmergency;
  return out;
}

export type NewRelationshipFor = {
  subjectId: string; otherId: string; labelKey: RelationshipKey; otherSide: "a" | "b";
  customLabel: string | null; otherForm: WordForm | null; subjectForm: WordForm | null;
};

/** The dialog speaks of "the other person" and "this customer"; the row speaks of sides a and b. */
export function newRelationshipFor(i: NewRelationshipFor): NewRelationship {
  const otherIsA = i.otherSide === "a";
  return {
    contactId: otherIsA ? i.otherId : i.subjectId,
    relatedContactId: otherIsA ? i.subjectId : i.otherId,
    labelKey: i.labelKey,
    customLabel: i.labelKey === "other" ? i.customLabel : null,
    contactForm: otherIsA ? i.otherForm : i.subjectForm,
    relatedForm: otherIsA ? i.subjectForm : i.otherForm,
    contactCanPickUp: i.labelKey === "authorized_pickup",
    contactIsEmergency: i.labelKey === "emergency_contact",
    relatedCanPickUp: false,
    relatedIsEmergency: false,
  };
}

export type PreviewInput = Omit<NewRelationshipFor, "subjectId" | "otherId"> & {
  subject: { firstName: string | null; lastName: string | null };
  other: { firstName: string | null; lastName: string | null };
};

/** How both records will read, before anything is saved (the dialog's preview). */
export function previewPair(i: PreviewInput): { onSubject: RelationshipView; onOther: RelationshipView } {
  const SUBJECT = "preview-subject", OTHER = "preview-other";
  const n = newRelationshipFor({ ...i, subjectId: SUBJECT, otherId: OTHER });
  const row: RelationshipRow = {
    id: "preview", account_id: "preview", contact_id: n.contactId, related_contact_id: n.relatedContactId,
    label_key: n.labelKey, custom_label: n.customLabel, contact_form: n.contactForm, related_form: n.relatedForm,
    contact_can_pick_up: n.contactCanPickUp, contact_is_emergency: n.contactIsEmergency,
    related_can_pick_up: n.relatedCanPickUp, related_is_emergency: n.relatedIsEmergency, created_at: "", updated_at: "",
  };
  const people = [
    { id: SUBJECT, first_name: i.subject.firstName, last_name: i.subject.lastName },
    { id: OTHER, first_name: i.other.firstName, last_name: i.other.lastName },
  ];
  return { onSubject: toRelationshipView(row, SUBJECT, people)!, onOther: toRelationshipView(row, OTHER, people)! };
}
```

- [ ] **Step 4: Write `relationship-labels.ts`:**

```ts
import type { Locale } from "@/lib/i18n/locale";
import { RELATIONSHIP_KEYS, type RelationshipKey, type WordForm } from "@bis/db/relationship-keys";
import type { RelationshipView } from "./relationship-view";

/**
 * The bilingual relationship words (spec §4.2, F-003). Side a names contact_id (shown on
 * related_contact_id's record); side b names related_contact_id. A word takes the form of the
 * person it describes; Spanish "referred" side a describes the record's own customer instead.
 * Neutral Spanish is "X o Y" (C7). Kept out of messages.ts on purpose (spec §4.1); its own test
 * is its completeness gate.
 */
export type Forms = { readonly n: string; readonly f?: string; readonly m?: string };
export type SideWords = {
  readonly en: Forms;
  readonly es: Forms;
  /** "colon": "Mother: Ana Ramírez". "phrase": "Emergency contact for Ana Ramírez". */
  readonly shape: "colon" | "phrase";
  readonly esAgreesWithSubject?: true;
};
export type Side = { readonly words: SideWords; readonly pick?: { readonly en: string; readonly es: string } };
export type LabelEntry = { readonly symmetric: boolean; readonly a: Side; readonly b: Side; readonly offer: readonly ("a" | "b")[] };

const both = (s: Side): { a: Side; b: Side } => ({ a: s, b: s });

export const RELATIONSHIP_LABELS: Readonly<Record<RelationshipKey, LabelEntry>> = {
  parent: {
    symmetric: false, offer: ["a", "b"],
    a: { words: { shape: "colon", en: { n: "Parent", f: "Mother", m: "Father" }, es: { n: "Madre o padre", f: "Madre", m: "Padre" } },
      pick: { en: "Parent", es: "Madre o padre" } },
    b: { words: { shape: "colon", en: { n: "Child", f: "Daughter", m: "Son" }, es: { n: "Hijo o hija", f: "Hija", m: "Hijo" } },
      pick: { en: "Child", es: "Hijo o hija" } },
  },
  spouse: {
    symmetric: true, offer: ["a"],
    ...both({ words: { shape: "colon", en: { n: "Spouse", f: "Wife", m: "Husband" }, es: { n: "Esposo o esposa", f: "Esposa", m: "Esposo" } },
      pick: { en: "Spouse", es: "Esposo o esposa" } }),
  },
  sibling: {
    symmetric: true, offer: ["a"],
    ...both({ words: { shape: "colon", en: { n: "Sibling", f: "Sister", m: "Brother" }, es: { n: "Hermano o hermana", f: "Hermana", m: "Hermano" } },
      pick: { en: "Sibling", es: "Hermano o hermana" } }),
  },
  godparent: {
    symmetric: false, offer: ["a", "b"],
    a: { words: { shape: "colon", en: { n: "Godparent", f: "Godmother", m: "Godfather" }, es: { n: "Padrino o madrina", f: "Madrina", m: "Padrino" } },
      pick: { en: "Godparent", es: "Padrino o madrina" } },
    b: { words: { shape: "colon", en: { n: "Godchild", f: "Goddaughter", m: "Godson" }, es: { n: "Ahijado o ahijada", f: "Ahijada", m: "Ahijado" } },
      pick: { en: "Godchild", es: "Ahijado o ahijada" } },
  },
  compadre: {
    symmetric: true, offer: ["a"],
    ...both({ words: { shape: "colon", en: { n: "Compadre or comadre", f: "Comadre", m: "Compadre" }, es: { n: "Compadre o comadre", f: "Comadre", m: "Compadre" } },
      pick: { en: "Compadre or comadre", es: "Compadre o comadre" } }),
  },
  emergency_contact: {
    symmetric: false, offer: ["a"],
    a: { words: { shape: "colon", en: { n: "Emergency contact" }, es: { n: "Contacto de emergencia" } },
      pick: { en: "Emergency contact", es: "Contacto de emergencia" } },
    b: { words: { shape: "phrase", en: { n: "Emergency contact for" }, es: { n: "Contacto de emergencia de" } } },
  },
  authorized_pickup: {
    symmetric: false, offer: ["a"],
    a: { words: { shape: "colon", en: { n: "Authorized pickup" }, es: { n: "Puede recoger" } },
      pick: { en: "Authorized pickup", es: "Puede recoger" } },
    b: { words: { shape: "phrase", en: { n: "Authorized to pick up" }, es: { n: "Puede recoger a" } } },
  },
  responsible_party: {
    symmetric: false, offer: ["a"],
    a: { words: { shape: "colon", en: { n: "Responsible party" }, es: { n: "Responsable" } },
      pick: { en: "Responsible party", es: "Responsable" } },
    b: { words: { shape: "phrase", en: { n: "Responsible for" }, es: { n: "Responsable de" } } },
  },
  caregiver: {
    symmetric: false, offer: ["a"],
    a: { words: { shape: "colon", en: { n: "Caregiver" }, es: { n: "Cuidador o cuidadora", f: "Cuidadora", m: "Cuidador" } },
      pick: { en: "Caregiver", es: "Cuidador o cuidadora" } },
    b: { words: { shape: "phrase", en: { n: "Cares for" }, es: { n: "Cuida a" } } },
  },
  landlord: {
    symmetric: false, offer: ["a", "b"],
    a: { words: { shape: "colon", en: { n: "Landlord" }, es: { n: "Arrendador o arrendadora", f: "Arrendadora", m: "Arrendador" } },
      pick: { en: "Landlord", es: "Arrendador o arrendadora" } },
    b: { words: { shape: "colon", en: { n: "Tenant" }, es: { n: "Inquilino o inquilina", f: "Inquilina", m: "Inquilino" } },
      pick: { en: "Tenant", es: "Inquilino o inquilina" } },
  },
  referred: {
    symmetric: false, offer: ["a", "b"],
    a: { words: { shape: "phrase", esAgreesWithSubject: true, en: { n: "Referred by" }, es: { n: "Recomendación de", f: "Referida por", m: "Referido por" } },
      pick: { en: "Referred {subject}", es: "Refirió a {subject}" } },
    b: { words: { shape: "phrase", en: { n: "Referred" }, es: { n: "Refirió a" } },
      pick: { en: "Was referred by {subject}", es: "Llegó por recomendación de {subject}" } },
  },
  other: {
    symmetric: true, offer: ["a"],
    ...both({ words: { shape: "colon", en: { n: "" }, es: { n: "" } }, pick: { en: "Other", es: "Otra relación" } }),
  },
};

export type RelationshipOption = { value: string; key: RelationshipKey; side: "a" | "b"; label: string };

/** "Who is {name} to {customer}?": the other person's role, in the reader's language. */
export function relationshipOptions(locale: Locale, subjectName: string): RelationshipOption[] {
  const out: RelationshipOption[] = [];
  for (const key of RELATIONSHIP_KEYS) {
    const entry = RELATIONSHIP_LABELS[key];
    for (const side of entry.offer) {
      const pick = entry[side].pick;
      if (!pick) continue;
      out.push({ value: `${key}:${side}`, key, side, label: pick[locale].replaceAll("{subject}", () => subjectName) });
    }
  }
  return out;
}

export type FormChoice = { n: string; f: string; m: string };

/** The words a person's form changes, for the dialog's "Words" row; null when none change. */
export function formChoices(key: RelationshipKey, otherSide: "a" | "b", locale: Locale, who: "other" | "subject"): FormChoice | null {
  const entry = RELATIONSHIP_LABELS[key];
  const subjectSide = otherSide === "a" ? "b" : "a";
  const own = who === "other" ? otherSide : subjectSide;
  const opposite = own === "a" ? "b" : "a";
  const agrees = (s: "a" | "b") => locale === "es" && entry[s].words.esAgreesWithSubject === true;
  const candidates = [
    ...(agrees(own) ? [] : [entry[own].words[locale]]),
    ...(agrees(opposite) ? [entry[opposite].words[locale]] : []),
  ];
  const withForms = candidates.find((f) => f.f && f.m);
  return withForms ? { n: withForms.n, f: withForms.f!, m: withForms.m! } : null;
}

export function wordFor(key: RelationshipKey, side: "a" | "b", locale: Locale, namedForm: WordForm | null, subjectForm: WordForm | null): string {
  const words = RELATIONSHIP_LABELS[key][side].words;
  const forms = words[locale];
  const form = locale === "es" && words.esAgreesWithSubject ? subjectForm : namedForm;
  return (form && forms[form]) || forms.n;
}

export function personName(p: { firstName: string | null; lastName: string | null } | null, fallback: string): string {
  if (!p) return fallback;
  return [p.firstName, p.lastName].map((s) => s?.trim() ?? "").filter(Boolean).join(" ") || fallback;
}

export function chipText(view: RelationshipView, locale: Locale, names: { hidden: string; noName: string }): string {
  const name = view.person ? personName(view.person, names.noName) : names.hidden;
  const word = view.labelKey === "other" ? (view.customLabel ?? "") : wordFor(view.labelKey, view.namedSide, locale, view.namedForm, view.subjectForm);
  return RELATIONSHIP_LABELS[view.labelKey][view.namedSide].words.shape === "colon" ? `${word}: ${name}` : `${word} ${name}`;
}

export type ChipFormControl = { who: "named" | "subject"; choices: FormChoice; value: WordForm | null };

/** The inline select on a chip edits whichever person's form changes THIS chip's words. */
export function chipFormControl(view: RelationshipView, locale: Locale): ChipFormControl | null {
  if (!view.person || view.labelKey === "other") return null;
  const words = RELATIONSHIP_LABELS[view.labelKey][view.namedSide].words;
  const forms = words[locale];
  if (!forms.f || !forms.m) return null;
  const who = locale === "es" && words.esAgreesWithSubject ? "subject" : "named";
  return { who, choices: { n: forms.n, f: forms.f, m: forms.m }, value: who === "named" ? view.namedForm : view.subjectForm };
}
```

- [ ] **Step 5: Write `relationship-input.ts`:**

```ts
import {
  isRelationshipKey, SIDE_COLUMNS, type RelationshipKey, type RelationshipRow, type RelationshipSidesPatch, type WordForm,
} from "@bis/db/relationship-keys";
import { isUuid } from "@/lib/assign/action-guards";
import { RELATIONSHIP_LABELS } from "./relationship-labels";
import type { ViewPatch } from "./relationship-view";

/**
 * What the browser sends, re-validated on the server before any write (spec §6). Not a
 * "use server" module, so sync helpers may live here.
 */
export const CUSTOM_LABEL_MAX = 60;
/** An explicit class, not .trim(): the zero-width space and the BOM count as edge space too. */
const EDGE_SPACE = /^[\s​﻿]+|[\s​﻿]+$/g;

export function cleanText(v: unknown): string {
  return typeof v === "string" ? v.replace(EDGE_SPACE, "") : "";
}

export function cleanCustomLabel(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = cleanText(v);
  const chars = [...s].length; // char_length counts code points, as 0070's CHECK does
  return chars >= 1 && chars <= CUSTOM_LABEL_MAX ? s : null;
}

const isForm = (v: unknown): v is WordForm | null => v === null || v === "f" || v === "m";
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type AddRelationshipInput = {
  subjectId: string;
  other: { kind: "existing"; contactId: string } | { kind: "new"; firstName: string; lastName: string; phone: string };
  labelKey: RelationshipKey;
  side: "a" | "b";
  customLabel: string | null;
  otherForm: WordForm | null;
  subjectForm: WordForm | null;
};

export function parseAddInput(v: unknown): { ok: true; input: AddRelationshipInput } | { ok: false; error: "self" | "invalid" } {
  const invalid = { ok: false as const, error: "invalid" as const };
  if (!isRecord(v) || !isRecord(v.other)) return invalid;
  const { subjectId, labelKey, side, otherForm, subjectForm } = v;
  if (!isUuid(subjectId) || !isRelationshipKey(labelKey) || (side !== "a" && side !== "b")) return invalid;
  if (!RELATIONSHIP_LABELS[labelKey].offer.includes(side)) return invalid;
  if (!isForm(otherForm) || !isForm(subjectForm)) return invalid;
  const customLabel = labelKey === "other" ? cleanCustomLabel(v.customLabel) : null;
  if (labelKey === "other" && customLabel === null) return invalid;
  const o = v.other;
  let other: AddRelationshipInput["other"];
  if (o.kind === "existing" && isUuid(o.contactId)) {
    if (o.contactId === subjectId) return { ok: false, error: "self" };
    other = { kind: "existing", contactId: o.contactId };
  } else if (o.kind === "new" && typeof o.firstName === "string" && typeof o.lastName === "string" && typeof o.phone === "string") {
    const firstName = cleanText(o.firstName), lastName = cleanText(o.lastName);
    if (!firstName && !lastName) return invalid;
    other = { kind: "new", firstName, lastName, phone: o.phone };
  } else {
    return invalid;
  }
  return { ok: true, input: { subjectId, other, labelKey, side, customLabel, otherForm, subjectForm } };
}

const VIEW_KEYS = ["namedForm", "subjectForm", "canPickUp", "isEmergency"] as const;

export function parseViewPatch(v: unknown): ViewPatch | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length === 0 || keys.some((k) => !(VIEW_KEYS as readonly string[]).includes(k))) return null;
  const out: ViewPatch = {};
  for (const k of keys) {
    const val = v[k];
    if (k === "namedForm" || k === "subjectForm") { if (!isForm(val)) return null; out[k] = val; }
    else { if (typeof val !== "boolean") return null; out[k as "canPickUp" | "isEmergency"] = val; }
  }
  return out;
}

export function parseSidesPatch(v: unknown): RelationshipSidesPatch | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length === 0 || keys.some((k) => !(SIDE_COLUMNS as readonly string[]).includes(k))) return null;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const val = v[k];
    if (k.endsWith("_form") ? !isForm(val) : typeof val !== "boolean") return null;
    out[k] = val;
  }
  return out as RelationshipSidesPatch;
}

const ROW_KEYS = [
  "id", "account_id", "contact_id", "related_contact_id", "label_key", "custom_label", "contact_form", "related_form",
  "contact_can_pick_up", "contact_is_emergency", "related_can_pick_up", "related_is_emergency", "created_at", "updated_at",
] as const;
const isTimestamp = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

/** An Undo's snapshot comes back from the browser: every field is checked as 0070 would. */
export function parseRelationshipRow(v: unknown): RelationshipRow | null {
  if (!isRecord(v)) return null;
  const keys = Object.keys(v);
  if (keys.length !== ROW_KEYS.length || ROW_KEYS.some((k) => !(k in v))) return null;
  const r = v as Record<(typeof ROW_KEYS)[number], unknown>;
  if (![r.id, r.account_id, r.contact_id, r.related_contact_id].every(isUuid) || r.contact_id === r.related_contact_id) return null;
  if (!isRelationshipKey(r.label_key) || !isForm(r.contact_form) || !isForm(r.related_form)) return null;
  if (r.label_key === "other" ? cleanCustomLabel(r.custom_label) !== r.custom_label : r.custom_label !== null) return null;
  if (![r.contact_can_pick_up, r.contact_is_emergency, r.related_can_pick_up, r.related_is_emergency].every((b) => typeof b === "boolean")) return null;
  if (r.label_key === "emergency_contact" && r.contact_is_emergency !== true) return null;
  if (r.label_key === "authorized_pickup" && r.contact_can_pick_up !== true) return null;
  if (!isTimestamp(r.created_at) || !isTimestamp(r.updated_at)) return null;
  return { ...(v as RelationshipRow) };
}
```

- [ ] **Step 6: Run green** with Step 2's command; paste the summary line. The `vi.mock("@bis/db")` factory check does not apply: this task creates modules and edits none, and its only `@bis/db` index import is a type (`NewRelationship`), erased at compile.

- [ ] **Step 7: Mutation probes:** (a) delete `es` from `RELATIONSHIP_LABELS.godparent.b.words` (cast through `as never` if the type stops you, or set it to `{ n: "" }`) → `godparent: sides a and b…` fails by name; (b) in `cleanCustomLabel` use `v.trim()` → "strips edge whitespace … zero-width space" fails; (c) in `formChoices` replace `agrees(...)` with `false` → "word-form rows … referred" fails. Paste each, revert.

- [ ] **Step 8: Commit.**

```bash
git add apps/web/src/lib/contacts/relationship-labels.ts apps/web/src/lib/contacts/relationship-labels.test.ts apps/web/src/lib/contacts/relationship-view.ts apps/web/src/lib/contacts/relationship-view.test.ts apps/web/src/lib/contacts/relationship-input.ts apps/web/src/lib/contacts/relationship-input.test.ts
git commit -m "feat(contacts): bilingual relationship labels that read from both sides, padrinos and compadres included" -- apps/web/src/lib/contacts/relationship-labels.ts apps/web/src/lib/contacts/relationship-labels.test.ts apps/web/src/lib/contacts/relationship-view.ts apps/web/src/lib/contacts/relationship-view.test.ts apps/web/src/lib/contacts/relationship-input.ts apps/web/src/lib/contacts/relationship-input.test.ts
```

---

## Task 4: Server actions, the shared hand-add helper, the read route, error copy

**Owner:** bis-crm. **Review:** opus. **Sequential:** after Tasks 2 and 3. **Scratch:** `s02b-t4-impl/`. Edits `messages.ts` (not in parallel with Task 5 or Lane A).

**Files**
- Create: `apps/web/src/lib/contacts/add-contact-by-hand.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts` (`createContactAction` calls the helper)
- Create: `apps/web/src/lib/contacts/relationship-errors.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationship-actions.ts`, `relationship-actions.test.ts`
- Create: `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/relationships/route.ts`, `route.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (append the `relationships.error.*` block before `} as const;`)

**Interfaces**
- Consumes: Task 2's `getRelationship`, `addRelationship`, `setRelationshipSides`, `removeRelationship`, `restoreRelationship`, `listContactRelationships`; existing `getContact` (`contacts.ts:804`), `listContacts` (`contacts.ts:756`), `createContact`, `readPersonId` (`assignment.ts:51`), `flagMatchesOf`, `serviceDb`; Task 3's helpers; `requireAccountAccess` (`lib/auth.ts:36`), `apiAccountAccess` (`lib/auth.ts:178`), `seesWholeAccount` (`lib/auth-role.ts:15`), `normalizeFieldInput` (`lib/contacts/field-input.ts:21`), `isUuid` (`lib/assign/action-guards.ts:11`).
- Produces:

```ts
// lib/contacts/add-contact-by-hand.ts
export type HandAddAccess = { userId: string; isAgency: boolean; role: AccountRole | null };
export async function addContactByHand(access: HandAddAccess, db: SupabaseClient, accountId: string, input: { firstName?: string; lastName?: string; email?: string; phone?: string }): Promise<{ id: string; existing: boolean }>;
// lib/contacts/relationship-errors.ts
export type RelationshipError = "relationships.error.duplicate" | "relationships.error.refused" | "relationships.error.self" | "relationships.error.gone" | "relationships.error.restore" | "relationships.error.invalid" | "relationships.error.failed";
export function relationshipErrorFor(e: unknown): RelationshipError;
// contacts/relationship-actions.ts ("use server")
export type RelationshipResult = { ok: true; view: RelationshipView } | { ok: false; error: RelationshipError };
export type AddRelationshipResult = { ok: true; view: RelationshipView } | { ok: false; error: RelationshipError; contactId?: string; created?: boolean }; // final review: shipped shape
export async function addRelationshipAction(accountId: string, raw: unknown): Promise<AddRelationshipResult>;
export async function setRelationshipAction(accountId: string, subjectId: string, relationshipId: string, rawPatch: unknown): Promise<{ ok: true; view: RelationshipView; undo: RelationshipSidesPatch } | { ok: false; error: RelationshipError }>;
export async function undoSetRelationshipAction(accountId: string, subjectId: string, relationshipId: string, rawPrevious: unknown): Promise<RelationshipResult>;
export async function removeRelationshipAction(accountId: string, relationshipId: string): Promise<{ ok: true; snapshot: RelationshipRow } | { ok: false; error: RelationshipError }>;
export async function undoRemoveRelationshipAction(accountId: string, subjectId: string, rawSnapshot: unknown): Promise<RelationshipResult>;
export type RelatableHit = { id: string; firstName: string | null; lastName: string | null; phone: string | null };
export async function searchRelatableContactsAction(accountId: string, subjectId: string, term: string): Promise<{ ok: true; hits: RelatableHit[] } | { ok: false }>;
// route.ts
export type RelationshipsResponse = { subject: { firstName: string | null; lastName: string | null }; views: RelationshipView[] };
```

- [ ] **Step 1: Extract the hand-add helper, guarded by the existing tests.** First run the existing tests green and save the summary: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts"`. Then create `apps/web/src/lib/contacts/add-contact-by-hand.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { createContact, readPersonId, flagMatchesOf, serviceDb, type AccountRole } from "@bis/db";
import { seesWholeAccount } from "@/lib/auth-role";
import { loggableError } from "@/lib/loggable-error";

/**
 * A customer a person adds by hand (F-085 part 1, spec §8), shared by Add contact and the
 * Relationships dialog's "New person" (relationships spec R4): it belongs to whoever adds it
 * (readPersonId: the agency is never a member, so what it adds stays Unassigned). A caller who
 * does not see the whole account (a Technician, or a role that could not be settled) cannot see
 * a duplicate held by someone else (0068), so for them the flag writer is the service client and
 * the matches they cannot see are flagged on the new row afterwards: a row the caller just
 * created, so the service client only ever touches a proven target. Moved here unchanged from
 * createContactAction.
 */
export type HandAddAccess = { userId: string; isAgency: boolean; role: AccountRole | null };

export async function addContactByHand(
  access: HandAddAccess, db: SupabaseClient, accountId: string,
  input: { firstName?: string; lastName?: string; email?: string; phone?: string },
): Promise<{ id: string; existing: boolean }> {
  const personId = await readPersonId(db, accountId, access.userId);
  const narrow = !seesWholeAccount(access);
  const result = await createContact(db, accountId, { ...input, assignedTo: personId }, access.userId, "user", narrow ? serviceDb() : db);
  if (!result.existing && narrow) {
    try {
      await flagMatchesOf(serviceDb(), accountId, result.id);
    } catch (e) {
      // The customer is saved; only the duplicate flags are missing.
      console.error(`addContactByHand: hidden-match flags not written (account ${accountId}): ${loggableError(e)}`);
    }
  }
  return { id: result.id, existing: result.existing };
}
```

Confirm `AccountRole` is exported from `@bis/db` (`grep -n "AccountRole" packages/db/src/index.ts`; `lib/auth-role.ts:1` imports it from there). In `contacts/actions.ts`, replace lines 64-88 of `createContactAction` (from the `// F-085 part 1 (spec §8)` comment through the closing `}` of the `if (narrow)` block) with:

```ts
  // F-085 part 1 (spec §8): a customer someone adds by hand is theirs; the
  // narrow path for a caller who cannot see the whole account lives in the
  // shared helper (relationships spec R4 reuses it).
  const db = await dbForRequest();
  const result = await addContactByHand(access, db, accountId, {
    firstName: firstName || undefined, lastName: lastName || undefined,
    email: email.value || undefined, phone: phoneField.value || undefined,
  });
  if (result.existing) return { kind: "existing", contactId: result.id };
```

Add `import { addContactByHand } from "@/lib/contacts/add-contact-by-hand";` and remove from the `@bis/db` import any name the file no longer uses (`readPersonId`, `flagMatchesOf`, `serviceDb` and `createContact` if the file has no other use; check with grep before removing; `seesWholeAccount` likewise). Re-run the same test file: the summary line must equal the saved one (same count, all green). Probe: in the helper, pass `db` instead of `serviceDb()` as `flagDb` → `a Technician: the flag writer is the service client…` fails by name. Revert.

- [ ] **Step 2: Write `relationship-errors.ts`:**

```ts
/** Database refusals become copy keys, by SQLSTATE, never by message wording (relationships spec §6). */
export type RelationshipError =
  | "relationships.error.duplicate" | "relationships.error.refused" | "relationships.error.self"
  | "relationships.error.gone" | "relationships.error.restore" | "relationships.error.invalid" | "relationships.error.failed";

export function relationshipErrorFor(e: unknown): RelationshipError {
  const code = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  if (code === "23505") return "relationships.error.duplicate";
  if (code === "42501") return "relationships.error.refused";
  if (code === "23503") return "relationships.error.gone";
  if (code === "23514") return "relationships.error.self";
  if (code === "22023" || code === "22P02") return "relationships.error.invalid";
  return "relationships.error.failed";
}
```

Corrected by the final review: this step first mapped 23514 to `invalid`, against spec §6. Shipped (and right): 23514 is "Pick someone else.", because every other CHECK is re-checked before a write, so the one a write can still reach is `contact_relationships_not_self`; `fail()` in the actions logs every code but 23505 and 42501, so a 23514 from any other CHECK still reaches the log (spec §6's 23514 note).

- [ ] **Step 3: Write the failing tests.**

`relationship-actions.test.ts` (next to the actions file):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

type Access = { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null; canManage: boolean };
const requireAccountAccess = vi.fn<(id: string) => Promise<Access>>();
vi.mock("@/lib/auth", () => ({ requireAccountAccess: (id: string) => requireAccountAccess(id) }));
const REQUEST = { tag: "request-db" };
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
const revalidatePath = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath }));
const addContactByHand = vi.fn();
vi.mock("@/lib/contacts/add-contact-by-hand", () => ({ addContactByHand: (...a: unknown[]) => addContactByHand(...a) }));
const dbMocks = {
  getContact: vi.fn(), listContacts: vi.fn(), getRelationship: vi.fn(), addRelationship: vi.fn(),
  setRelationshipSides: vi.fn(), removeRelationship: vi.fn(), restoreRelationship: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const {
  addRelationshipAction, setRelationshipAction, undoSetRelationshipAction, removeRelationshipAction,
  undoRemoveRelationshipAction, searchRelatableContactsAction,
} = await import("./relationship-actions");

const A = "44444444-4444-4444-8444-444444444444";
const S = "11111111-1111-4111-8111-111111111111";
const O = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const OWNER: Access = { userId: "user_1", isAgency: false, role: "owner", canManage: true };
const contact = (id: string, first: string) => ({ id, first_name: first, last_name: "Ramírez" });
const ROW = {
  id: R, account_id: A, contact_id: O, related_contact_id: S, label_key: "parent", custom_label: null,
  contact_form: "f", related_form: null, contact_can_pick_up: false, contact_is_emergency: false,
  related_can_pick_up: false, related_is_emergency: false, created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
};
const ADD = { subjectId: S, other: { kind: "existing", contactId: O }, labelKey: "parent", side: "a", customLabel: null, otherForm: "f", subjectForm: null };

beforeEach(() => {
  vi.clearAllMocks();
  requireAccountAccess.mockResolvedValue(OWNER);
  dbMocks.getContact.mockImplementation(async (_db: unknown, _a: string, id: string) => (id === S ? contact(S, "Sofía") : id === O ? contact(O, "Ana") : null));
  dbMocks.addRelationship.mockResolvedValue(ROW);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("addRelationshipAction", () => {
  it("refuses a malformed add without touching the database", async () => {
    expect(await addRelationshipAction(A, { ...ADD, labelKey: "cousin" })).toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(dbMocks.getContact).not.toHaveBeenCalled();
  });
  it("refuses oneself", async () => {
    expect(await addRelationshipAction(A, { ...ADD, other: { kind: "existing", contactId: S } })).toEqual({ ok: false, error: "relationships.error.self" });
  });
  it("refuses when the record is not the caller's to see, before any write (mutation: skip the subject read -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue(null);
    expect(await addRelationshipAction(A, ADD)).toEqual({ ok: false, error: "relationships.error.refused" });
    expect(dbMocks.addRelationship).not.toHaveBeenCalled();
  });
  it("writes on the request client with the other person on side a, and answers the subject's view (mutation: swap the sides -> FAILS)", async () => {
    const r = await addRelationshipAction(A, ADD);
    expect(dbMocks.addRelationship).toHaveBeenCalledWith(REQUEST, A, expect.objectContaining({
      contactId: O, relatedContactId: S, labelKey: "parent", contactForm: "f", relatedForm: null }), "user_1");
    expect(r).toEqual({ ok: true, view: expect.objectContaining({ id: R, namedSide: "a", person: { id: O, firstName: "Ana", lastName: "Ramírez" } }) });
  });
  it("a new person goes through the shared hand-add helper with the caller's access, then is related (spec R4)", async () => {
    addContactByHand.mockResolvedValue({ id: O, existing: false });
    const r = await addRelationshipAction(A, { ...ADD, other: { kind: "new", firstName: "Ana", lastName: "Ramírez", phone: "956 555 0142" } });
    expect(addContactByHand).toHaveBeenCalledWith(OWNER, REQUEST, A, { firstName: "Ana", lastName: "Ramírez", phone: "956 555 0142" });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/accounts/${A}/contacts`);
    expect(r.ok).toBe(true);
  });
  it("maps database refusals to copy, by code (mutation: map every error to failed -> FAILS)", async () => {
    dbMocks.addRelationship.mockRejectedValueOnce({ code: "23505" });
    expect(await addRelationshipAction(A, ADD)).toEqual({ ok: false, error: "relationships.error.duplicate" });
    dbMocks.addRelationship.mockRejectedValueOnce({ code: "42501" });
    expect(await addRelationshipAction(A, ADD)).toEqual({ ok: false, error: "relationships.error.refused" });
  });
});

describe("setRelationshipAction and its Undo", () => {
  beforeEach(() => dbMocks.getRelationship.mockResolvedValue(ROW));
  it("writes the named person's side and returns what it was for Undo (mutation: write the subject's side -> FAILS)", async () => {
    dbMocks.setRelationshipSides.mockResolvedValue({ previous: { contact_can_pick_up: false }, row: { ...ROW, contact_can_pick_up: true } });
    const r = await setRelationshipAction(A, S, R, { canPickUp: true });
    expect(dbMocks.setRelationshipSides).toHaveBeenCalledWith(REQUEST, A, R, { contact_can_pick_up: true }, "user_1");
    expect(r).toEqual({ ok: true, undo: { contact_can_pick_up: false }, view: expect.objectContaining({ canPickUp: true }) });
  });
  it("a zero-row write is a refusal; a vanished row is gone", async () => {
    dbMocks.setRelationshipSides.mockResolvedValueOnce("refused");
    expect(await setRelationshipAction(A, S, R, { canPickUp: true })).toEqual({ ok: false, error: "relationships.error.refused" });
    dbMocks.getRelationship.mockResolvedValueOnce(null);
    expect(await setRelationshipAction(A, S, R, { canPickUp: true })).toEqual({ ok: false, error: "relationships.error.gone" });
  });
  it("the Undo re-validates the columns the browser sends back (mutation: pass rawPrevious through -> FAILS)", async () => {
    expect(await undoSetRelationshipAction(A, S, R, { label_key: "spouse" })).toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(dbMocks.setRelationshipSides).not.toHaveBeenCalled();
  });
});

describe("remove and its Undo", () => {
  it("remove hands back the snapshot; a refusal is refused", async () => {
    dbMocks.removeRelationship.mockResolvedValueOnce(ROW);
    expect(await removeRelationshipAction(A, R)).toEqual({ ok: true, snapshot: ROW });
    dbMocks.removeRelationship.mockResolvedValueOnce("refused");
    expect(await removeRelationshipAction(A, R)).toEqual({ ok: false, error: "relationships.error.refused" });
  });
  it("the Undo refuses another account's snapshot without a write, restores a good one, and says when the person is gone (mutation: drop the account check -> FAILS)", async () => {
    expect(await undoRemoveRelationshipAction(A, S, { ...ROW, account_id: O })).toEqual({ ok: false, error: "relationships.error.invalid" });
    expect(dbMocks.restoreRelationship).not.toHaveBeenCalled();
    dbMocks.restoreRelationship.mockResolvedValueOnce(ROW);
    expect((await undoRemoveRelationshipAction(A, S, ROW)).ok).toBe(true);
    expect(dbMocks.restoreRelationship).toHaveBeenCalledWith(REQUEST, A, ROW, "user_1");
    dbMocks.restoreRelationship.mockRejectedValueOnce({ code: "23503" });
    expect(await undoRemoveRelationshipAction(A, S, ROW)).toEqual({ ok: false, error: "relationships.error.restore" });
  });
});

describe("searchRelatableContactsAction", () => {
  it("needs two characters, leaves out the record's own customer, and stops at eight (mutation: drop the subject filter -> FAILS)", async () => {
    expect(await searchRelatableContactsAction(A, S, "a")).toEqual({ ok: true, hits: [] });
    expect(dbMocks.listContacts).not.toHaveBeenCalled();
    dbMocks.listContacts.mockResolvedValue([S, ...Array.from({ length: 9 }, (_, i) => `2222222${i}-2222-4222-8222-222222222222`)]
      .map((id) => ({ id, first_name: "Ana", last_name: null, phone: null })));
    const r = await searchRelatableContactsAction(A, S, "Ana");
    expect(dbMocks.listContacts).toHaveBeenCalledWith(REQUEST, A, { search: "Ana", limit: 9 });
    expect(r.ok && r.hits.map((h) => h.id)).not.toContain(S);
    expect(r.ok && r.hits).toHaveLength(8);
  });
});
```

`route.test.ts` (in the new route folder):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ apiAccountAccess: access }));
const client = vi.hoisted(() => ({ tag: "request-db" }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => client }));
const getContact = vi.hoisted(() => vi.fn());
const listContactRelationships = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({ getContact, listContactRelationships }));

import { GET } from "./route";

const S = "11111111-1111-4111-8111-111111111111";
const HIDDEN = "22222222-2222-4222-8222-222222222222";
const params = { params: Promise.resolve({ accountId: "a1", contactId: S }) };
const ROW = {
  id: "33333333-3333-4333-8333-333333333333", account_id: "a1", contact_id: HIDDEN, related_contact_id: S, label_key: "parent",
  custom_label: null, contact_form: "f", related_form: null, contact_can_pick_up: true, contact_is_emergency: false,
  related_can_pick_up: false, related_is_emergency: false, created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
};

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u", isAgency: false });
  getContact.mockReset().mockResolvedValue({ id: S, first_name: "Sofía", last_name: "Ramírez" });
  listContactRelationships.mockReset().mockResolvedValue({ rows: [ROW], people: [] });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET …/relationships (spec §6: the card's own read)", () => {
  it("answers the subject and the views, read on the request's own client", async () => {
    const res = await GET(new Request("https://x.test"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subject).toEqual({ firstName: "Sofía", lastName: "Ramírez" });
    expect(body.views).toHaveLength(1);
    expect(listContactRelationships).toHaveBeenCalledWith(client, "a1", S);
  });
  it("a person the caller cannot read reaches the browser with no name and no id (C5; mutation: send the raw rows -> FAILS)", async () => {
    const res = await GET(new Request("https://x.test"), params);
    const text = await res.text();
    expect(text).not.toContain(HIDDEN);
    expect(JSON.parse(text).views[0].person).toBeNull();
  });
  it("404 without access or for a contact the caller cannot see, reading nothing else (mutation: skip the contact read -> FAILS)", async () => {
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    expect(listContactRelationships).not.toHaveBeenCalled();
    access.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
  });
  it("a failed read is a 500 the card shows as its error state", async () => {
    listContactRelationships.mockRejectedValueOnce(new Error("boom"));
    expect((await GET(new Request("https://x.test"), params)).status).toBe(500);
  });
});
```

- [ ] **Step 4: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationship-actions.test.ts" "src/app/api/accounts/[accountId]/contacts/[contactId]/relationships/route.test.ts"`. Expected: two `Failed to resolve import` lines.

- [ ] **Step 5: Write `relationship-actions.ts`:**

```ts
"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import {
  getContact, listContacts, getRelationship, addRelationship, setRelationshipSides, removeRelationship,
  restoreRelationship, type RelationshipRow, type RelationshipSidesPatch,
} from "@bis/db";
import { isUuid } from "@/lib/assign/action-guards";
import { loggableError } from "@/lib/loggable-error";
import { normalizeFieldInput } from "@/lib/contacts/field-input";
import { addContactByHand } from "@/lib/contacts/add-contact-by-hand";
import { parseAddInput, parseViewPatch, parseSidesPatch, parseRelationshipRow } from "@/lib/contacts/relationship-input";
import { toRelationshipView, columnsForViewPatch, newRelationshipFor, type RelationshipView } from "@/lib/contacts/relationship-view";
import { relationshipErrorFor, type RelationshipError } from "@/lib/contacts/relationship-errors";

/**
 * Relationships between customers (spec §6). Every write runs on the request client, so 0070's
 * RLS and Technician fences bind it; the record it is shown on is proven readable first.
 */
export type RelationshipResult = { ok: true; view: RelationshipView } | { ok: false; error: RelationshipError };

function fail(where: string, accountId: string, e: unknown): { ok: false; error: RelationshipError } {
  const error = relationshipErrorFor(e);
  if (error === "relationships.error.failed") console.error(`${where} (account ${accountId}): ${loggableError(e)}`);
  return { ok: false, error };
}

/** The other person, as the caller may read them (null for a Technician's hidden person). */
async function viewOf(db: SupabaseClient, accountId: string, row: RelationshipRow, subjectId: string): Promise<RelationshipView | null> {
  const otherId = row.contact_id === subjectId ? row.related_contact_id : row.contact_id;
  const other = await getContact(db, accountId, otherId);
  const people = other ? [{ id: other.id as string, first_name: other.first_name as string | null, last_name: other.last_name as string | null }] : [];
  return toRelationshipView(row, subjectId, people);
}

export async function addRelationshipAction(accountId: string, raw: unknown): Promise<RelationshipResult> {
  const access = await requireAccountAccess(accountId);
  const parsed = parseAddInput(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error === "self" ? "relationships.error.self" : "relationships.error.invalid" };
  const input = parsed.input;
  const db = await dbForRequest();
  try {
    if (!(await getContact(db, accountId, input.subjectId))) return { ok: false, error: "relationships.error.refused" };
    let otherId: string;
    if (input.other.kind === "existing") {
      otherId = input.other.contactId;
    } else {
      const phone = normalizeFieldInput("phone", input.other.phone);
      if (!phone.ok) return { ok: false, error: "relationships.error.invalid" };
      const made = await addContactByHand(access, db, accountId, {
        firstName: input.other.firstName || undefined, lastName: input.other.lastName || undefined, phone: phone.value || undefined,
      });
      otherId = made.id;
      revalidatePath(`/dashboard/accounts/${accountId}/contacts`);
    }
    if (otherId === input.subjectId) return { ok: false, error: "relationships.error.self" };
    if (!(await getContact(db, accountId, otherId))) return { ok: false, error: "relationships.error.refused" };
    const row = await addRelationship(db, accountId, newRelationshipFor({
      subjectId: input.subjectId, otherId, labelKey: input.labelKey, otherSide: input.side,
      customLabel: input.customLabel, otherForm: input.otherForm, subjectForm: input.subjectForm,
    }), access.userId);
    const view = await viewOf(db, accountId, row, input.subjectId);
    return view ? { ok: true, view } : { ok: false, error: "relationships.error.failed" };
  } catch (e) {
    return fail("addRelationshipAction", accountId, e);
  }
}

export async function setRelationshipAction(
  accountId: string, subjectId: string, relationshipId: string, rawPatch: unknown,
): Promise<{ ok: true; view: RelationshipView; undo: RelationshipSidesPatch } | { ok: false; error: RelationshipError }> {
  const access = await requireAccountAccess(accountId);
  const patch = parseViewPatch(rawPatch);
  if (!isUuid(subjectId) || !isUuid(relationshipId) || !patch) return { ok: false, error: "relationships.error.invalid" };
  const db = await dbForRequest();
  try {
    const row = await getRelationship(db, accountId, relationshipId);
    if (!row) return { ok: false, error: "relationships.error.gone" };
    const columns = columnsForViewPatch(row, subjectId, patch);
    if (!columns) return { ok: false, error: "relationships.error.invalid" };
    const result = await setRelationshipSides(db, accountId, relationshipId, columns, access.userId);
    if (result === "not_found") return { ok: false, error: "relationships.error.gone" };
    if (result === "refused") return { ok: false, error: "relationships.error.refused" };
    const view = await viewOf(db, accountId, result.row, subjectId);
    return view ? { ok: true, view, undo: result.previous } : { ok: false, error: "relationships.error.failed" };
  } catch (e) {
    return fail("setRelationshipAction", accountId, e);
  }
}

export async function undoSetRelationshipAction(
  accountId: string, subjectId: string, relationshipId: string, rawPrevious: unknown,
): Promise<RelationshipResult> {
  const access = await requireAccountAccess(accountId);
  const previous = parseSidesPatch(rawPrevious);
  if (!isUuid(subjectId) || !isUuid(relationshipId) || !previous) return { ok: false, error: "relationships.error.invalid" };
  const db = await dbForRequest();
  try {
    const result = await setRelationshipSides(db, accountId, relationshipId, previous, access.userId);
    if (result === "not_found") return { ok: false, error: "relationships.error.gone" };
    if (result === "refused") return { ok: false, error: "relationships.error.refused" };
    const view = await viewOf(db, accountId, result.row, subjectId);
    return view ? { ok: true, view } : { ok: false, error: "relationships.error.failed" };
  } catch (e) {
    return fail("undoSetRelationshipAction", accountId, e);
  }
}

export async function removeRelationshipAction(
  accountId: string, relationshipId: string,
): Promise<{ ok: true; snapshot: RelationshipRow } | { ok: false; error: RelationshipError }> {
  const access = await requireAccountAccess(accountId);
  if (!isUuid(relationshipId)) return { ok: false, error: "relationships.error.invalid" };
  const db = await dbForRequest();
  try {
    const result = await removeRelationship(db, accountId, relationshipId, access.userId);
    if (result === "not_found") return { ok: false, error: "relationships.error.gone" };
    if (result === "refused") return { ok: false, error: "relationships.error.refused" };
    return { ok: true, snapshot: result };
  } catch (e) {
    return fail("removeRelationshipAction", accountId, e);
  }
}

export async function undoRemoveRelationshipAction(accountId: string, subjectId: string, rawSnapshot: unknown): Promise<RelationshipResult> {
  const access = await requireAccountAccess(accountId);
  const snapshot = parseRelationshipRow(rawSnapshot);
  if (!isUuid(subjectId) || !snapshot || snapshot.account_id !== accountId) return { ok: false, error: "relationships.error.invalid" };
  const db = await dbForRequest();
  try {
    const row = await restoreRelationship(db, accountId, snapshot, access.userId);
    const view = await viewOf(db, accountId, row, subjectId);
    return view ? { ok: true, view } : { ok: false, error: "relationships.error.failed" };
  } catch (e) {
    const r = fail("undoRemoveRelationshipAction", accountId, e);
    return r.error === "relationships.error.gone" ? { ok: false, error: "relationships.error.restore" } : r;
  }
}

export type RelatableHit = { id: string; firstName: string | null; lastName: string | null; phone: string | null };

/** The dialog's picker: the caller's own RLS decides who can be found (a Technician finds only theirs). */
export async function searchRelatableContactsAction(
  accountId: string, subjectId: string, term: string,
): Promise<{ ok: true; hits: RelatableHit[] } | { ok: false }> {
  await requireAccountAccess(accountId);
  if (!isUuid(subjectId) || typeof term !== "string") return { ok: true, hits: [] };
  const q = term.replace(/\s+/g, " ").trim();
  if ([...q].length < 2) return { ok: true, hits: [] };
  const db = await dbForRequest();
  try {
    const rows = await listContacts(db, accountId, { search: q, limit: 9 });
    return {
      ok: true,
      hits: rows.filter((r) => r.id !== subjectId).slice(0, 8)
        .map((r) => ({ id: r.id as string, firstName: r.first_name as string | null, lastName: r.last_name as string | null, phone: r.phone as string | null })),
    };
  } catch (e) {
    console.error(`searchRelatableContactsAction (account ${accountId}): ${loggableError(e)}`);
    return { ok: false };
  }
}
```

- [ ] **Step 6: Write the route** `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/relationships/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getContact, listContactRelationships } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { loggableError } from "@/lib/loggable-error";
import { toRelationshipView, type RelationshipView } from "@/lib/contacts/relationship-view";

export const dynamic = "force-dynamic";

/** The Relationships card's own read (spec §7: it loads and fails on its own). A person the caller
 *  cannot read arrives as `person: null`, with no id (C5). */
export type RelationshipsResponse = {
  subject: { firstName: string | null; lastName: string | null };
  views: RelationshipView[];
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access) return NextResponse.json({}, { status: 404 });
  const db = await dbForRequest(); // RLS-scoped: NEVER serviceDb here
  try {
    const contact = await getContact(db, accountId, contactId);
    if (!contact) return NextResponse.json({}, { status: 404 });
    const { rows, people } = await listContactRelationships(db, accountId, contactId);
    const views = rows.map((r) => toRelationshipView(r, contactId, people)).filter((v): v is RelationshipView => v !== null);
    const body: RelationshipsResponse = {
      subject: { firstName: (contact.first_name as string | null) ?? null, lastName: (contact.last_name as string | null) ?? null },
      views,
    };
    return NextResponse.json(body);
  } catch (e) {
    console.error(`relationships read (account ${accountId}): ${loggableError(e)}`);
    return NextResponse.json({}, { status: 500 });
  }
}
```

- [ ] **Step 7: Error copy.** Append before `} as const;` in `apps/web/src/lib/messages.ts`:

```ts
  // Relationships between customers (relationships spec §6): what a refused write says.
  "relationships.error.duplicate": "That relationship is already there.",
  "relationships.error.duplicate.es": "Esa relación ya está registrada.",
  "relationships.error.refused": "You can't change that customer.",
  "relationships.error.refused.es": "No puede cambiar ese cliente.",
  "relationships.error.self": "Pick someone else.",
  "relationships.error.self.es": "Elija a otra persona.",
  "relationships.error.gone": "That changed since. Reload to see it.",
  "relationships.error.gone.es": "Eso cambió. Vuelva a cargar para verlo.",
  "relationships.error.restore": "Couldn't put it back.",
  "relationships.error.restore.es": "No se pudo deshacer.",
  "relationships.error.invalid": "That doesn't look right. Check it and try again.",
  "relationships.error.invalid.es": "Algo no está bien. Revíselo e intente de nuevo.",
  "relationships.error.failed": "Couldn't save that. Try again.",
  "relationships.error.failed.es": "No se pudo guardar. Intente de nuevo.",
```

Add one assertion to `relationship-actions.test.ts`: every `RelationshipError` value is a key of `m` with a `.es` twin (import `m` from `@/lib/messages`; list the seven keys).

- [ ] **Step 8: Run green.** Step 4's command plus `src/lib/i18n/ratchet.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts"` and `src/lib/contacts`; then `pnpm --filter web typecheck` (exit code to a file). Paste the summary lines.

- [ ] **Step 9: The `vi.mock("@bis/db")` factory check.** `contacts/actions.ts` lost names from its `@bis/db` import and gained none, so its factory needs no addition. Run `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "add-contact-by-hand\|relationship-actions"` and confirm the only hits are this task's own test files.

- [ ] **Step 10: Mutation probes:** (a) in `addRelationshipAction` delete the subject `getContact` check → "refuses when the record is not the caller's to see…" fails; (b) in the route return `rows` instead of `views` → "a person the caller cannot read reaches the browser with no name and no id" fails; (c) in `undoRemoveRelationshipAction` drop `snapshot.account_id !== accountId` → "the Undo refuses another account's snapshot…" fails. Added by the final review (the Task 4 review ran them; kept here so a re-plan keeps them): P5, drop `bothVisible` in `setRelationshipAction` → "a Technician with the other person hidden is refused before any write" fails; P6, drop it in `removeRelationshipAction` → "a Technician cannot remove a relationship with a hidden person, before any write" fails; P7, drop it in `undoRemoveRelationshipAction` → "a narrow caller cannot restore a pair they cannot fully see: refused before the write" fails; P13, drop it in `undoSetRelationshipAction` → "the Undo of an edit is refused for a role that could not be settled when a person is hidden, before any write" fails. Paste each, revert.

- [ ] **Step 11: Commit.**

```bash
git add apps/web/src/lib/contacts/add-contact-by-hand.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts" apps/web/src/lib/contacts/relationship-errors.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationship-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationship-actions.test.ts" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/relationships/route.ts" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/relationships/route.test.ts" apps/web/src/lib/messages.ts
git commit -m "feat(contacts): relationship actions on the request client, a read route that hides who it must, one hand-add path" -- <the same paths>
```

---

## Task 5: The Relationships card and the add dialog

**Owner:** bis-frontend. **Review:** sonnet. **Sequential:** after Task 4. **Scratch:** `s02b-t5-impl/`. Edits `messages.ts`, `contact-drawer.tsx` and the detail page: sequence with Lane A's Groups card (table above).

**Files**
- Create: `apps/web/src/lib/contacts/relationships-load.ts`, `relationships-load.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationships-card.tsx`, `relationships-card.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/add-relationship-dialog.tsx`
- Modify: `contact-drawer.tsx` (import + one line after the "Assigned to" block, `:308`, before Recent, `:331`), `contact-drawer.wiring.test.ts`
- Modify: `[contactId]/page.tsx` (import + one line under `<ContactFieldsPanel …/>`), `[contactId]/page.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (append the `relationships.*` UI block before `} as const;`)

**Interfaces**
- Consumes: Task 4's actions and `RelationshipsResponse`; Task 3's `chipText`, `chipFormControl`, `relationshipOptions`, `formChoices`, `personName`, `previewPair`; `useLocale` (`components/locale-provider.tsx`); `t` (`lib/i18n/t.ts:36`).
- Produces:

```ts
export type RelationshipsLoad = { status: "loading" } | { status: "error" } | { status: "ready"; subject: { firstName: string | null; lastName: string | null }; views: RelationshipView[] };
export async function relationshipsLoadFrom(res: Response): Promise<RelationshipsLoad>;
export function RelationshipsCard(props: { accountId: string; contactId: string }): JSX.Element;
export function RelationshipsCardView(props: CardViewProps): JSX.Element; // pure, for tests
export function AddRelationshipDialog(props: { accountId: string; contactId: string; subject: { firstName: string | null; lastName: string | null }; views: readonly RelationshipView[]; onAdded: (view: RelationshipView) => void }): JSX.Element;
```

Corrected by the final review: `AddRelationshipDialog` takes the record's `views` (so the flag hint can point at an existing row, Task 4 review finding 5), and `addRelationshipAction` answers `AddRelationshipResult` (`{ ok: true; view } | { ok: false; error; contactId?; created? }`, Task 4's Interfaces), not `RelationshipResult`. The card's change/remove/Undo logic shipped in `relationships-card-handlers.ts` (`relationshipHandlers`), with a per-relationship in-flight lock.

- [ ] **Step 1: UI copy.** Append before `} as const;` in `messages.ts` (after Task 4's block):

```ts
  // Relationships card and dialog (relationships spec §7).
  "relationships.title": "Related people",
  "relationships.title.es": "Personas relacionadas",
  "relationships.add": "Add a person",
  "relationships.add.es": "Agregar a una persona",
  "relationships.empty": "No related people yet. Add a parent, a spouse, a padrino or an emergency contact, and it shows on both records.",
  "relationships.empty.es": "Todavía no hay personas relacionadas. Agregue a la mamá o el papá, al esposo o la esposa, a un padrino o un contacto de emergencia, y aparecerá en los dos registros.",
  "relationships.loadFailed": "Couldn't load related people.",
  "relationships.loadFailed.es": "No se pudieron cargar las personas relacionadas.",
  "relationships.retry": "Retry",
  "relationships.retry.es": "Reintentar",
  "relationships.undo": "Undo",
  "relationships.undo.es": "Deshacer",
  "relationships.saved": "Saved.",
  "relationships.saved.es": "Guardado.",
  "relationships.removed": "Removed {name}.",
  "relationships.removed.es": "Se quitó a {name}.",
  "relationships.remove": "Remove {name}",
  "relationships.remove.es": "Quitar a {name}",
  "relationships.hiddenPerson": "someone not on your list",
  "relationships.hiddenPerson.es": "alguien que no está en su lista",
  "relationships.askTeam": "Ask your team to change this.",
  "relationships.askTeam.es": "Pídale a su equipo que lo cambie.",
  "relationships.noName": "(no name)",
  "relationships.noName.es": "(sin nombre)",
  "relationships.flag.canPickUp": "Can pick up",
  "relationships.flag.canPickUp.es": "Puede recoger",
  "relationships.flag.isEmergency": "Emergency contact",
  "relationships.flag.isEmergency.es": "Contacto de emergencia",
  "relationships.wordFor": "Word for {name}",
  "relationships.wordFor.es": "Palabra para {name}",
  "relationships.dialog.search": "Search your customers",
  "relationships.dialog.search.es": "Buscar entre sus clientes",
  "relationships.dialog.searchEmpty": "No one found. Add them as a new person.",
  "relationships.dialog.searchEmpty.es": "No se encontró a nadie. Agréguelo como persona nueva.",
  "relationships.dialog.searchFailed": "Search didn't work. Try again.",
  "relationships.dialog.searchFailed.es": "La búsqueda no funcionó. Intente de nuevo.",
  "relationships.dialog.newPerson": "New person",
  "relationships.dialog.newPerson.es": "Persona nueva",
  "relationships.dialog.findPerson": "Find a customer",
  "relationships.dialog.findPerson.es": "Buscar un cliente",
  "relationships.dialog.firstName": "First name",
  "relationships.dialog.firstName.es": "Nombre",
  "relationships.dialog.lastName": "Last name",
  "relationships.dialog.lastName.es": "Apellido",
  "relationships.dialog.phone": "Phone (optional)",
  "relationships.dialog.phone.es": "Teléfono (opcional)",
  "relationships.dialog.question": "Who is {name} to {customer}?",
  "relationships.dialog.question.es": "¿Quién es {name} para {customer}?",
  "relationships.dialog.thisPerson": "this person",
  "relationships.dialog.thisPerson.es": "esta persona",
  "relationships.dialog.pick": "Pick one",
  "relationships.dialog.pick.es": "Elija una",
  "relationships.dialog.otherLabel": "What are they?",
  "relationships.dialog.otherLabel.es": "¿Qué relación tienen?",
  "relationships.dialog.otherHint": "Don't put custody or court details here.",
  "relationships.dialog.otherHint.es": "No escriba aquí datos de custodia ni de juzgado.",
  "relationships.dialog.wordsFor": "{name} is",
  "relationships.dialog.wordsFor.es": "{name} es",
  "relationships.dialog.preview": "On {name}'s record",
  "relationships.dialog.preview.es": "En el registro de {name}",
  "relationships.dialog.submit": "Add",
  "relationships.dialog.submit.es": "Agregar",
  "relationships.dialog.cancel": "Cancel",
  "relationships.dialog.cancel.es": "Cancelar",
```

- [ ] **Step 2: Write the failing tests.**

`apps/web/src/lib/contacts/relationships-load.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { relationshipsLoadFrom } from "./relationships-load";

const VIEW = { id: "r1", labelKey: "parent", customLabel: null, namedSide: "a", person: null, namedForm: null, subjectForm: null,
  canPickUp: false, isEmergency: false, lockedFlag: null };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("relationshipsLoadFrom", () => {
  it("a 200 with a subject and views is ready", async () => {
    expect(await relationshipsLoadFrom(json({ subject: { firstName: "Sofía", lastName: null }, views: [VIEW] })))
      .toEqual({ status: "ready", subject: { firstName: "Sofía", lastName: null }, views: [VIEW] });
  });
  it("anything else is the card's error state (mutation: trust any 200 body -> FAILS)", async () => {
    expect(await relationshipsLoadFrom(json({}, 500))).toEqual({ status: "error" });
    expect(await relationshipsLoadFrom(json({ views: "nope" }))).toEqual({ status: "error" });
    expect(await relationshipsLoadFrom(json({ subject: {}, views: [{ ...VIEW, labelKey: "cousin" }] }))).toEqual({ status: "error" });
    expect(await relationshipsLoadFrom(new Response("not json", { status: 200 }))).toEqual({ status: "error" });
  });
});
```

`relationships-card.test.ts` (next to the card):

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";
import type { RelationshipView } from "@/lib/contacts/relationship-view";

vi.mock("./relationship-actions", () => ({
  setRelationshipAction: vi.fn(), undoSetRelationshipAction: vi.fn(), removeRelationshipAction: vi.fn(),
  undoRemoveRelationshipAction: vi.fn(), addRelationshipAction: vi.fn(), searchRelatableContactsAction: vi.fn(),
}));
const { RelationshipsCardView } = await import("./relationships-card");
const { m } = await import("@/lib/messages");

const ANA = "22222222-2222-4222-8222-222222222222";
const view = (over: Partial<RelationshipView>): RelationshipView => ({
  id: "r1", labelKey: "parent", customLabel: null, namedSide: "a", person: { id: ANA, firstName: "Ana", lastName: "Ramírez" },
  namedForm: "f", subjectForm: "f", canPickUp: true, isEmergency: false, lockedFlag: null, ...over,
});
const noop = () => {};
const render = (locale: "en" | "es", load: Parameters<typeof RelationshipsCardView>[0]["load"]) =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale },
    createElement(RelationshipsCardView, { accountId: "a1", load, onRetry: noop, onToggle: noop, onForm: noop, onRemove: noop, addSlot: null })));

describe("RelationshipsCardView: its own loaded, empty and error states (rule 5 per card)", () => {
  it("loading is two skeleton chips and no words (rule 7)", () => {
    const html = render("en", { status: "loading" });
    expect(html.match(/data-relationships-skeleton/g)).toHaveLength(2);
    expect(html).not.toContain(m["relationships.empty"]);
  });
  it("empty sells the feature, in the reader's language, with lang set (mutation: hard-code English -> FAILS)", () => {
    expect(render("en", { status: "ready", subject: { firstName: "Sofía", lastName: null }, views: [] })).toContain(m["relationships.empty"]);
    const es = render("es", { status: "ready", subject: { firstName: "Sofía", lastName: null }, views: [] });
    expect(es).toContain(m["relationships.empty.es"]);
    expect(es).toContain('lang="es"');
  });
  it("error offers Retry", () => {
    const html = render("en", { status: "error" });
    expect(html).toContain(m["relationships.loadFailed"]);
    expect(html).toContain(m["relationships.retry"]);
  });
});

describe("chips", () => {
  const ready = (views: RelationshipView[]) => ({ status: "ready" as const, subject: { firstName: "Sofía", lastName: "Ramírez" }, views });
  it("reads 'Mother: Ana Ramírez' / 'Madre: Ana Ramírez', links to her record, and shows her flags as dot plus word (rule 3)", () => {
    const en = render("en", ready([view({})]));
    expect(en).toContain("Mother: Ana Ramírez");
    expect(en).toContain(`href="/dashboard/accounts/a1/contacts/${ANA}"`);
    expect(en).toContain('aria-pressed="true"');
    expect(en).toContain(m["relationships.flag.canPickUp"]);
    expect(render("es", ready([view({})]))).toContain("Madre: Ana Ramírez");
  });
  it("a person not on the reader's list: no name, no link, no controls, and the 'Ask your team' line (C5; mutation: render controls for a hidden person -> FAILS)", () => {
    const html = render("en", ready([view({ person: null })]));
    expect(html).toContain("Mother: someone not on your list");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("<select");
    expect(html).toContain(m["relationships.askTeam"]);
  });
  it("a flag the label already is shows as a word, never a toggle", () => {
    const html = render("en", ready([view({ labelKey: "emergency_contact", isEmergency: true, canPickUp: false, lockedFlag: "isEmergency" })]));
    expect(html).toContain(m["relationships.flag.isEmergency"]);
    expect(html.match(/aria-pressed/g)).toHaveLength(1); // only "Can pick up"
  });
});
```

Add to `contact-drawer.wiring.test.ts`, beside its other `vi.mock` lines (before the `await import("./contact-drawer")`):

```ts
const relationshipsCardProps: unknown[] = [];
vi.mock("./relationships-card", () => ({ RelationshipsCard: (p: unknown) => { relationshipsCardProps.push(p); return null; } }));
```

and a test that renders the drawer for `ROW` once the summary has loaded (use the file's existing harness that resolves the summary fetch; read how its other tests reach the loaded state) and asserts `expect(relationshipsCardProps).toContainEqual({ accountId: "a1", contactId: "c1" })` (mutation: delete the card line from the drawer → FAILS). In `[contactId]/page.test.ts`, add the same recorder for `"../relationships-card"` and assert the page renders it with the page's `accountId` and `contactId`.

- [ ] **Step 3: Run red.** `pnpm --filter web exec vitest run src/lib/contacts/relationships-load.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationships-card.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts"`. Expected: two `Failed to resolve import` lines and the two new wiring cases failing on an empty recorder.

- [ ] **Step 4: Write `relationships-load.ts`:**

```ts
import { isRelationshipKey } from "@bis/db/relationship-keys";
import type { RelationshipView } from "./relationship-view";

export type RelationshipsLoad =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; subject: { firstName: string | null; lastName: string | null }; views: RelationshipView[] };

const nameOrNull = (v: unknown) => (typeof v === "string" ? v : null);
const isForm = (v: unknown) => v === null || v === "f" || v === "m";

function isView(v: unknown): v is RelationshipView {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  const p = o.person as Record<string, unknown> | null;
  return typeof o.id === "string" && isRelationshipKey(o.labelKey) && (o.namedSide === "a" || o.namedSide === "b")
    && (o.customLabel === null || typeof o.customLabel === "string")
    && (p === null || (typeof p === "object" && typeof p.id === "string"))
    && isForm(o.namedForm) && isForm(o.subjectForm)
    && typeof o.canPickUp === "boolean" && typeof o.isEmergency === "boolean"
    && (o.lockedFlag === null || o.lockedFlag === "canPickUp" || o.lockedFlag === "isEmergency");
}

/** The card's read, parsed: anything but a well-formed 200 is its error state. */
export async function relationshipsLoadFrom(res: Response): Promise<RelationshipsLoad> {
  if (!res.ok) return { status: "error" };
  let body: unknown;
  try { body = await res.json(); } catch { return { status: "error" }; }
  const b = body as { subject?: Record<string, unknown>; views?: unknown };
  if (typeof b?.subject !== "object" || b.subject === null || !Array.isArray(b.views) || !b.views.every(isView)) return { status: "error" };
  return { status: "ready", subject: { firstName: nameOrNull(b.subject.firstName), lastName: nameOrNull(b.subject.lastName) }, views: b.views };
}
```

- [ ] **Step 5: Write `relationships-card.tsx`:**

```tsx
"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/locale-provider";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { WordForm } from "@bis/db/relationship-keys";
import { chipText, chipFormControl, personName } from "@/lib/contacts/relationship-labels";
import type { RelationshipView } from "@/lib/contacts/relationship-view";
import { relationshipsLoadFrom, type RelationshipsLoad } from "@/lib/contacts/relationships-load";
import {
  setRelationshipAction, undoSetRelationshipAction, removeRelationshipAction, undoRemoveRelationshipAction,
} from "./relationship-actions";
import { AddRelationshipDialog } from "./add-relationship-dialog";

type Flag = "canPickUp" | "isEmergency";
export type CardViewProps = {
  accountId: string;
  load: RelationshipsLoad;
  onRetry: () => void;
  onToggle: (view: RelationshipView, flag: Flag) => void;
  onForm: (view: RelationshipView, who: "named" | "subject", form: WordForm | null) => void;
  onRemove: (view: RelationshipView) => void;
  addSlot: ReactNode;
};

function FlagPill({ on, label, onClick }: { on: boolean; label: string; onClick?: () => void }) {
  const dot = <span aria-hidden className={`size-1.5 rounded-full ${on ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]"}`} />;
  if (!onClick) {
    return <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs">{dot}{label}</span>;
  }
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-0.5 text-xs hover:bg-[var(--surface-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {dot}{label}
    </button>
  );
}

function Chip({ accountId, view, locale, onToggle, onForm, onRemove }: {
  accountId: string; view: RelationshipView; locale: Locale;
  onToggle: CardViewProps["onToggle"]; onForm: CardViewProps["onForm"]; onRemove: CardViewProps["onRemove"];
}) {
  const names = { hidden: t(m, "relationships.hiddenPerson", locale), noName: t(m, "relationships.noName", locale) };
  const text = chipText(view, locale, names);
  const flags = ([["canPickUp", "relationships.flag.canPickUp"], ["isEmergency", "relationships.flag.isEmergency"]] as const);
  if (!view.person) {
    return (
      <li data-relationship-chip className="rounded-[var(--radius-ctl)] bg-[var(--surface-2)] px-3 py-2 text-sm">
        <p className="truncate">{text}</p>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {flags.filter(([f]) => view[f]).map(([f, key]) => <FlagPill key={f} on label={t(m, key, locale)} />)}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{t(m, "relationships.askTeam", locale)}</p>
      </li>
    );
  }
  const name = personName(view.person, names.noName);
  const control = chipFormControl(view, locale);
  return (
    <li data-relationship-chip className="rounded-[var(--radius-ctl)] bg-[var(--surface-2)] px-3 py-2 text-sm">
      <div className="flex items-center gap-2">
        <Link href={`/dashboard/accounts/${accountId}/contacts/${view.person.id}`} title={text}
          className="min-w-0 flex-1 truncate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {text}
        </Link>
        {control ? (
          <select aria-label={t(m, "relationships.wordFor", locale, { name })}
            value={control.value ?? ""}
            onChange={(e) => onForm(view, control.who, e.target.value === "" ? null : (e.target.value as WordForm))}
            className="h-7 rounded-[var(--radius-ctl)] border border-[var(--line-strong)] bg-[var(--surface-1)] px-1 text-xs">
            <option value="">{control.choices.n}</option>
            <option value="f">{control.choices.f}</option>
            <option value="m">{control.choices.m}</option>
          </select>
        ) : null}
        <Button type="button" size="icon-xs" variant="ghost" aria-label={t(m, "relationships.remove", locale, { name })} onClick={() => onRemove(view)}>
          <X className="size-3.5" aria-hidden />
        </Button>
      </div>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {flags.map(([f, key]) => view.lockedFlag === f
          ? <FlagPill key={f} on label={t(m, key, locale)} />
          : <FlagPill key={f} on={view[f]} label={t(m, key, locale)} onClick={() => onToggle(view, f)} />)}
      </div>
    </li>
  );
}

/** Pure: everything the card shows, for every state. Tests render this. */
export function RelationshipsCardView({ accountId, load, onRetry, onToggle, onForm, onRemove, addSlot }: CardViewProps) {
  const locale = useLocale();
  return (
    <section data-relationships-card lang={locale} aria-labelledby="relationships-title" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 id="relationships-title" className="text-sm font-medium">{t(m, "relationships.title", locale)}</h3>
        {load.status === "ready" ? addSlot : null}
      </div>
      {load.status === "loading" ? (
        <div className="space-y-2">
          <Skeleton data-relationships-skeleton className="h-12 w-full" />
          <Skeleton data-relationships-skeleton className="h-12 w-full" />
        </div>
      ) : load.status === "error" ? (
        <div className="space-y-2 text-sm">
          <p className="text-muted-foreground">{t(m, "relationships.loadFailed", locale)}</p>
          <Button type="button" size="sm" variant="ghost" onClick={onRetry}>{t(m, "relationships.retry", locale)}</Button>
        </div>
      ) : load.views.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(m, "relationships.empty", locale)}</p>
      ) : (
        <ul className="space-y-2">
          {load.views.map((v) => (
            <Chip key={v.id} accountId={accountId} view={v} locale={locale} onToggle={onToggle} onForm={onForm} onRemove={onRemove} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The card on the drawer and the detail page (spec §7, R2): reads its own route, saves at once, Undo on every change (rule 6). */
export function RelationshipsCard({ accountId, contactId }: { accountId: string; contactId: string }) {
  const locale = useLocale();
  const [state, setState] = useState<{ contactId: string; rel: RelationshipsLoad }>({ contactId: "", rel: { status: "loading" } });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/relationships`)
      .then(async (res) => { const rel = await relationshipsLoadFrom(res); if (!stale) setState({ contactId, rel }); })
      .catch(() => { if (!stale) setState({ contactId, rel: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, nonce]);
  const load: RelationshipsLoad = state.contactId === contactId ? state.rel : { status: "loading" };

  const replace = (view: RelationshipView) => setState((s) => s.rel.status !== "ready" ? s
    : { ...s, rel: { ...s.rel, views: s.rel.views.some((v) => v.id === view.id) ? s.rel.views.map((v) => (v.id === view.id ? view : v)) : [...s.rel.views, view] } });
  const drop = (id: string) => setState((s) => s.rel.status !== "ready" ? s : { ...s, rel: { ...s.rel, views: s.rel.views.filter((v) => v.id !== id) } });
  const say = (key: Parameters<typeof t<typeof m>>[1]) => toast.error(t(m, key, locale));

  const change = async (view: RelationshipView, patch: Record<string, unknown>) => {
    const r = await setRelationshipAction(accountId, contactId, view.id, patch);
    if (!r.ok) { say(r.error); return; }
    replace(r.view);
    toast.success(t(m, "relationships.saved", locale), { action: { label: t(m, "relationships.undo", locale), onClick: () => {
      void undoSetRelationshipAction(accountId, contactId, view.id, r.undo).then((u) => (u.ok ? replace(u.view) : say(u.error)));
    } } });
  };

  const remove = async (view: RelationshipView) => {
    const r = await removeRelationshipAction(accountId, view.id);
    if (!r.ok) { say(r.error); return; }
    drop(view.id);
    const name = personName(view.person, t(m, "relationships.noName", locale));
    toast.success(t(m, "relationships.removed", locale, { name }), { action: { label: t(m, "relationships.undo", locale), onClick: () => {
      void undoRemoveRelationshipAction(accountId, contactId, r.snapshot).then((u) => (u.ok ? replace(u.view) : say(u.error)));
    } } });
  };

  return (
    <RelationshipsCardView
      accountId={accountId}
      load={load}
      onRetry={() => setNonce((n) => n + 1)}
      onToggle={(v, flag) => void change(v, { [flag]: !v[flag] })}
      onForm={(v, who, form) => void change(v, who === "named" ? { namedForm: form } : { subjectForm: form })}
      onRemove={(v) => void remove(v)}
      addSlot={load.status === "ready"
        ? <AddRelationshipDialog accountId={accountId} contactId={contactId} subject={load.subject} onAdded={replace} />
        : null}
    />
  );
}
```

If `Parameters<typeof t<typeof m>>[1]` does not type-check under the repo's TS version, type `say` as `(key: keyof typeof m) => …` (the error keys are all keys of `m`). If `size="icon-xs"` is not a Button size, use the one the drawer's tag remove button uses (`contact-drawer.tsx:411`).

- [ ] **Step 6: Write `add-relationship-dialog.tsx`:**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { RelationshipKey, WordForm } from "@bis/db/relationship-keys";
import { relationshipOptions, formChoices, chipText, personName } from "@/lib/contacts/relationship-labels";
import { previewPair, type RelationshipView } from "@/lib/contacts/relationship-view";
import { addRelationshipAction, searchRelatableContactsAction, type RelatableHit } from "./relationship-actions";

type Name = { firstName: string | null; lastName: string | null };

export function AddRelationshipDialog({ accountId, contactId, subject, onAdded }: {
  accountId: string; contactId: string; subject: Name; onAdded: (view: RelationshipView) => void;
}) {
  const locale = useLocale();
  const tt = (key: keyof typeof m, params?: Record<string, string>) => t(m, key as never, locale, params);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"find" | "new">("find");
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<RelatableHit[] | "failed">([]);
  const [picked, setPicked] = useState<RelatableHit | null>(null);
  const [fresh, setFresh] = useState({ firstName: "", lastName: "", phone: "" });
  const [choice, setChoice] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [otherForm, setOtherForm] = useState<WordForm | null>(null);
  const [subjectForm, setSubjectForm] = useState<WordForm | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (mode !== "find" || term.trim().length < 2) { setHits([]); return; }
    let stale = false;
    const id = setTimeout(() => {
      void searchRelatableContactsAction(accountId, contactId, term).then((r) => { if (!stale) setHits(r.ok ? r.hits : "failed"); });
    }, 250);
    return () => { stale = true; clearTimeout(id); };
  }, [accountId, contactId, mode, term]);

  const subjectName = personName(subject, tt("relationships.noName"));
  const other: Name = mode === "new" ? { firstName: fresh.firstName || null, lastName: fresh.lastName || null } : (picked ?? { firstName: null, lastName: null });
  const otherName = personName(other, tt("relationships.dialog.thisPerson"));
  const options = useMemo(() => relationshipOptions(locale, subjectName), [locale, subjectName]);
  const [key, side] = (choice ? choice.split(":") : ["", ""]) as [RelationshipKey | "", "a" | "b" | ""];
  const hasPerson = mode === "new" ? Boolean(fresh.firstName.trim() || fresh.lastName.trim()) : picked !== null;
  const ready = hasPerson && key !== "" && side !== "" && (key !== "other" || customLabel.trim().length > 0);
  const otherWords = key && side ? formChoices(key, side, locale, "other") : null;
  const subjectWords = key && side ? formChoices(key, side, locale, "subject") : null;
  const preview = ready && key && side
    ? previewPair({ labelKey: key, otherSide: side, customLabel: customLabel.trim() || null, otherForm, subjectForm, subject, other })
    : null;
  const names = { hidden: tt("relationships.hiddenPerson"), noName: tt("relationships.noName") };

  const reset = () => { setMode("find"); setTerm(""); setHits([]); setPicked(null); setFresh({ firstName: "", lastName: "", phone: "" });
    setChoice(""); setCustomLabel(""); setOtherForm(null); setSubjectForm(null); };

  const submit = async () => {
    if (!ready || !key || !side) return;
    setPending(true);
    const r = await addRelationshipAction(accountId, {
      subjectId: contactId,
      other: mode === "new" ? { kind: "new", ...fresh } : { kind: "existing", contactId: picked!.id },
      labelKey: key, side, customLabel: key === "other" ? customLabel : null, otherForm, subjectForm,
    }).catch(() => ({ ok: false as const, error: "relationships.error.failed" as const }));
    setPending(false);
    if (!r.ok) { toast.error(tt(r.error)); return; }
    onAdded(r.view);
    reset();
    setOpen(false);
  };

  const WordsRow = ({ who, words, value, onChange }: { who: string; words: { n: string; f: string; m: string }; value: WordForm | null; onChange: (f: WordForm | null) => void }) => (
    <fieldset className="space-y-1">
      <legend className="text-xs text-muted-foreground">{tt("relationships.dialog.wordsFor", { name: who })}</legend>
      <div className="flex flex-wrap gap-3 text-sm">
        {([[null, words.n], ["f", words.f], ["m", words.m]] as const).map(([form, label]) => (
          <label key={label} className="inline-flex items-center gap-1.5">
            <input type="radio" name={`words-${who}`} checked={value === form} onChange={() => onChange(form)} />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="ghost"><Plus className="size-4" aria-hidden />{tt("relationships.add")}</Button>
      </DialogTrigger>
      <DialogContent lang={locale}>
        <DialogHeader><DialogTitle>{tt("relationships.add")}</DialogTitle></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {mode === "find" ? (
            <div className="space-y-2">
              <Label htmlFor="rel-search">{tt("relationships.dialog.search")}</Label>
              <Input id="rel-search" value={term} onChange={(e) => { setTerm(e.target.value); setPicked(null); }} autoComplete="off" />
              {hits === "failed" ? <p className="text-xs text-muted-foreground">{tt("relationships.dialog.searchFailed")}</p>
                : term.trim().length >= 2 && hits.length === 0 ? <p className="text-xs text-muted-foreground">{tt("relationships.dialog.searchEmpty")}</p>
                : (
                  <ul className="space-y-1">
                    {hits.map((h) => (
                      <li key={h.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="radio" name="rel-person" checked={picked?.id === h.id} onChange={() => setPicked(h)} />
                          {personName(h, tt("relationships.noName"))}{h.phone ? <span className="text-xs text-muted-foreground">{h.phone}</span> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              <Button type="button" size="sm" variant="ghost" onClick={() => { setMode("new"); setPicked(null); }}>{tt("relationships.dialog.newPerson")}</Button>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="rel-first">{tt("relationships.dialog.firstName")}</Label>
                <Input id="rel-first" value={fresh.firstName} onChange={(e) => setFresh({ ...fresh, firstName: e.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="rel-last">{tt("relationships.dialog.lastName")}</Label>
                <Input id="rel-last" value={fresh.lastName} onChange={(e) => setFresh({ ...fresh, lastName: e.target.value })} /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="rel-phone">{tt("relationships.dialog.phone")}</Label>
                <Input id="rel-phone" type="tel" value={fresh.phone} onChange={(e) => setFresh({ ...fresh, phone: e.target.value })} /></div>
              <Button type="button" size="sm" variant="ghost" className="sm:col-span-2 justify-self-start" onClick={() => setMode("find")}>{tt("relationships.dialog.findPerson")}</Button>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="rel-kind">{tt("relationships.dialog.question", { name: otherName, customer: subjectName })}</Label>
            <select id="rel-kind" value={choice} onChange={(e) => { setChoice(e.target.value); setOtherForm(null); setSubjectForm(null); }}
              className="h-9 w-full rounded-[var(--radius-ctl)] border border-[var(--line-strong)] bg-[var(--surface-2)] px-2 text-sm">
              <option value="" disabled>{tt("relationships.dialog.pick")}</option>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {key === "other" ? (
            <div className="space-y-1">
              <Label htmlFor="rel-custom">{tt("relationships.dialog.otherLabel")}</Label>
              <Input id="rel-custom" maxLength={60} value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} />
              <p className="text-xs text-muted-foreground">{tt("relationships.dialog.otherHint")}</p>
            </div>
          ) : null}
          {otherWords ? <WordsRow who={otherName} words={otherWords} value={otherForm} onChange={setOtherForm} /> : null}
          {subjectWords ? <WordsRow who={subjectName} words={subjectWords} value={subjectForm} onChange={setSubjectForm} /> : null}
          {preview ? (
            <div className="space-y-1 rounded-[var(--radius-ctl)] bg-[var(--surface-2)] p-2 text-sm" aria-live="polite">
              <p><span className="text-muted-foreground">{tt("relationships.dialog.preview", { name: subjectName })}: </span>{chipText(preview.onSubject, locale, names)}</p>
              <p><span className="text-muted-foreground">{tt("relationships.dialog.preview", { name: otherName })}: </span>{chipText(preview.onOther, locale, names)}</p>
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="ghost">{tt("relationships.dialog.cancel")}</Button></DialogClose>
            <Button type="submit" disabled={!ready || pending}>{tt("relationships.dialog.submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

`WordsRow` is declared inside the component for brevity; if the linter flags a component defined during render (`react/no-unstable-nested-components`), move it to module scope with `tt` passed as a prop.

- [ ] **Step 7: Mount it.** In `contact-drawer.tsx` add `import { RelationshipsCard } from "./relationships-card";` and, directly after the "Assigned to" block that ends before `{m["drawer.recent"]}` (`:308`-`:331`), add `<RelationshipsCard accountId={accountId} contactId={contactId} />` inside the same loaded branch (it renders only when `contactId` is set there; read the surrounding JSX and keep the card inside the `load.status === "ready"` branch so it never shows over the drawer's own error state). In `[contactId]/page.tsx` add `import { RelationshipsCard } from "../relationships-card";` and `<RelationshipsCard accountId={accountId} contactId={contactId} />` directly under `<ContactFieldsPanel … />`.

- [ ] **Step 8: Run green** with Step 3's command plus `src/lib/i18n/ratchet.test.ts src/lib/contacts`; then `pnpm --filter web typecheck` and `pnpm --filter web exec eslint "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/lib/contacts` (exit codes to files). Paste every summary line. The new files must have NO JSX literal copy (the ratchet counts it): every string goes through `t()`.

- [ ] **Step 9: The `vi.mock("@bis/db")` factory check.** This task adds no `@bis/db` import to an existing module (the card imports only the `relationship-keys` subpath, as a type). Confirm with `git diff --stat` that `contact-drawer.tsx` and `page.tsx` gained no `@bis/db` import line.

- [ ] **Step 10: Mutation probes:** (a) in `Chip`, drop the `if (!view.person)` branch → "a person not on the reader's list: no name, no link, no controls…" fails; (b) in `relationshipsLoadFrom`, return ready for any 200 → "anything else is the card's error state" fails; (c) delete the drawer's `<RelationshipsCard …/>` line → the drawer wiring case fails. Paste each, revert.

- [ ] **Step 11: Definition of done, checked by hand** (paste a line per item into the report): tokens only (grep the two new `.tsx` files for `#`, `rgb(`, `px]` and `shadow-`); dark and light; blur fallback unaffected (no `backdrop-filter`); Esc closes the dialog (Radix); focus ring on links, pills, select and buttons; English and Spanish; the pseudo-locale's +35% (`?locale=pseudo` on the dashboard is the only page that honours it; check the card's wrapping by temporarily lengthening a word in a scratch copy, not in the repo); one primary button in the dialog.

- [ ] **Step 12: Commit.**

```bash
git add apps/web/src/lib/contacts/relationships-load.ts apps/web/src/lib/contacts/relationships-load.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationships-card.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/relationships-card.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/add-relationship-dialog.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts" apps/web/src/lib/messages.ts
git commit -m "feat(contacts): a Related people card on the drawer and the record, with inline flags, word forms and Undo" -- <the same paths>
```

---

## Task 6: e2e `relationships.spec.ts`

**Owner:** bis-e2e-qa. **Review:** sonnet. **Sequential:** after Task 5. **Scratch:** `s02b-t6-impl/`. Playwright is the orchestrator's to run.

**Files**
- Create: `apps/web/e2e/relationships.spec.ts`
- Modify: `apps/web/e2e/fixtures/fixture-names.test.ts` (the not-swept list)

- [ ] **Step 1: Verify the facts the spec relies on** and record them in the report: `readClientFixture()` (`e2e/support.ts:103`) gives `accountId`; the client storage state is `e2e/.auth/client-state.json` and its user is the fixture account's Owner (`client-access.spec.ts`); the `users` table has a `language` column that takes `'en'`, `'es'` and `null` (added in 0066, per `0067_person_preferences.sql:3`; read 0066 to confirm). If the column's name or values differ, follow the source and say so.

- [ ] **Step 2: Write the spec:**

```ts
import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { m } from "../src/lib/messages";
import { readClientFixture } from "./support";

// Relationships between customers (spec §9), on the PER-RUN fixture account only, never Test
// Client One. Contacts are made through serviceDb() with a stamp and removed in afterAll; the
// mother is created through the UI's "New person", so afterAll finds her by her stamped name.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

const stamp = Date.now();
const CHILD_LAST = `Child ${stamp}`;
const MOTHER_LAST = `Mother ${stamp}`;

test.describe.serial("relationships on the record", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });
  let accountId = "";
  let childId = "";

  test.beforeAll(async () => {
    const fixture = readClientFixture();
    test.skip(!fixture, "No client fixture: the setup project creates it; run the full suite.");
    accountId = fixture!.accountId;
    childId = (await createContact(serviceDb(), accountId, { firstName: "E2E", lastName: CHILD_LAST }, "e2e-relationships")).id;
  });

  test.afterAll(async () => {
    if (!accountId) return;
    const db = serviceDb();
    await db.from("contacts").delete().eq("account_id", accountId).in("last_name", [CHILD_LAST, MOTHER_LAST]);
  });

  test("an Owner adds a mother as a new person; both records read correctly", async ({ page }) => {
    await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
    const card = page.locator("[data-relationships-card]");
    await expect(card.getByText(m["relationships.empty"])).toBeVisible();
    await card.getByRole("button", { name: m["relationships.add"] }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: m["relationships.dialog.newPerson"] }).click();
    await dialog.getByLabel(m["relationships.dialog.firstName"]).fill("E2E");
    await dialog.getByLabel(m["relationships.dialog.lastName"]).fill(MOTHER_LAST);
    await dialog.locator("#rel-kind").selectOption("parent:a");
    await dialog.getByRole("radio", { name: "Mother" }).check();
    await dialog.getByRole("radio", { name: "Son" }).check();
    await dialog.getByRole("button", { name: m["relationships.dialog.submit"] }).click();
    await expect(card.getByText(`Mother: E2E ${MOTHER_LAST}`)).toBeVisible();

    const db = serviceDb();
    const { data: rows } = await db.from("contact_relationships").select("label_key, contact_form, related_form, contact_id, related_contact_id")
      .eq("account_id", accountId).eq("related_contact_id", childId);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ label_key: "parent", contact_form: "f", related_form: "m" });
    const { data: mother } = await db.from("contacts").select("id, assigned_to").eq("id", rows![0]!.contact_id).single();
    expect(mother!.assigned_to).not.toBeNull(); // hand-added: the Owner's own (F-085)

    await card.getByRole("link", { name: `Mother: E2E ${MOTHER_LAST}` }).click();
    await expect(page.locator("[data-relationships-card]").getByText(`Son: E2E ${CHILD_LAST}`)).toBeVisible();
  });

  test("a flag saves at once with Undo; remove has Undo and restores the same row", async ({ page }) => {
    const db = serviceDb();
    const readRow = async () => (await db.from("contact_relationships").select("id, contact_can_pick_up")
      .eq("account_id", accountId).eq("related_contact_id", childId)).data ?? [];
    await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
    const chip = page.locator("[data-relationship-chip]").filter({ hasText: `Mother: E2E ${MOTHER_LAST}` });
    await chip.getByRole("button", { name: m["relationships.flag.canPickUp"] }).click();
    await expect(chip.getByRole("button", { name: m["relationships.flag.canPickUp"] })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readRow())[0]?.contact_can_pick_up).toBe(true);
    await page.getByRole("button", { name: m["relationships.undo"] }).click();
    await expect.poll(async () => (await readRow())[0]?.contact_can_pick_up).toBe(false);

    const before = (await readRow())[0]!.id;
    await chip.getByRole("button", { name: m["relationships.remove"].replace("{name}", `E2E ${MOTHER_LAST}`) }).click();
    await expect(page.getByText(m["relationships.removed"].replace("{name}", `E2E ${MOTHER_LAST}`))).toBeVisible();
    await expect.poll(async () => (await readRow()).length).toBe(0);
    await page.getByRole("button", { name: m["relationships.undo"] }).click();
    await expect.poll(async () => (await readRow())[0]?.id).toBe(before);
  });

  test("a Spanish reader sees 'Madre:'", async ({ page }) => {
    const db = serviceDb();
    const { data: owner } = await db.from("memberships").select("user_id")
      .eq("scope", "account").eq("account_id", accountId).eq("role", "owner").limit(1).single();
    const { data: prior } = await db.from("users").select("language").eq("id", owner!.user_id).single();
    await db.from("users").update({ language: "es" }).eq("id", owner!.user_id);
    try {
      await page.goto(`/dashboard/accounts/${accountId}/contacts/${childId}`);
      await expect(page.locator('[data-relationships-card][lang="es"]').getByText(`Madre: E2E ${MOTHER_LAST}`)).toBeVisible();
    } finally {
      await db.from("users").update({ language: prior!.language }).eq("id", owner!.user_id);
    }
  });
});
```

If more than one Owner membership exists on the fixture account, select the one whose `users.clerk_user_id` matches the client fixture's Clerk user (read `e2e/.auth/client-fixture.json`'s field name first) instead of `limit(1)`.

- [ ] **Step 3: Fixture names.** The spec's stamped literals do not start with `E2E ` (`Child ${stamp}`, `Mother ${stamp}`), so `fixture-names.test.ts` does not collect them; the chip texts built with `E2E ${MOTHER_LAST}` are. Run `pnpm --filter web exec vitest run e2e/fixtures/fixture-names.test.ts`; for every literal it reports, add an entry to its not-swept map in the existing style, for example `"relationships.spec.ts: E2E ${MOTHER_LAST}": "a contact on the PER-RUN fixture account, removed in afterAll and by that account's own cascade (contacts is in ACCOUNT_OWNED_TABLES)"`. Re-run green.

- [ ] **Step 4: Mutation probe (static, no Playwright):** change the spec's expected `"Mother: E2E …"` to `"Mother of E2E …"` and confirm by reading the card code that the chip can never render that text; revert. The orchestrator's run is the real red/green.

- [ ] **Step 5: The orchestrator runs** `pnpm --filter web test:e2e relationships.spec.ts contacts.spec.ts contacts-drawer.spec.ts contact-detail.spec.ts assign.spec.ts` alone on the machine, after checking no `screenshots.yml` run is in progress.

- [ ] **Step 6: Commit.** `git add apps/web/e2e/relationships.spec.ts apps/web/e2e/fixtures/fixture-names.test.ts` then `git commit -m "test(e2e): a mother added as a new person reads correctly on both records, with Undo, in English and Spanish" -- apps/web/e2e/relationships.spec.ts apps/web/e2e/fixtures/fixture-names.test.ts`.

---

## Task 7: Rollout (orchestrator; not a coding task)

- [ ] **0. Settle the number with Lane A, before anything is applied.** Fetch; if Lane A's 0069 has merged, this lane keeps 0070. If this lane goes first, decide with the orchestrator of Lane A which number each takes; if they swap, rename the file (`git mv`) and every path in this plan and the spec, and re-run Task 1 step 7 on a fresh replica. Never apply a number to bis-ci that the other lane has taken; a version on bis-ci cannot be taken back.
  **Added by the final review: whoever reaches bis-ci first must hold the LOWER number.** `db:push:ci` refuses `--include-all`, so it will not push a version below the project's newest: 0069 (Lane A) must reach bis-ci BEFORE 0070, or 0069 can never be pushed after it. If Lane A is not ready, settle a renumber with its orchestrator before pushing 0070.
- [ ] **1. Merge prep.** Merge `main` into the branch; run `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` one at a time on the combined tree.
- [ ] **2. CI project, dry run.** `gh workflow run ci-project-setup.yml --ref spec/s02-relationships -f step=push-dry-run` (or the implementation branch). Read the run: it must list exactly `0070_contact_relationships.sql` (plus Lane A's 0069 if that is also pending and agreed).
- [ ] **3. CI project, push.** `gh workflow run ci-project-setup.yml --ref <branch> -f step=push`. Read the run for success. The PR's `e2e` job fails until this is done (`.github/scripts/ci-migrations-applied.sh`).
- [ ] **4. Production.** Warn danlo in chat first (memory "Supabase MCP prompts": the Accept/Decline shows only in the CLI terminal). Before applying, check the file has no backslash and no non-ASCII character (memory "MCP SQL escapes"); 0070 has neither. Apply via MCP `apply_migration` with name `contact_relationships`, exactly once; never re-apply.
- [ ] **5. Parity.** Run `docs/runbooks/ci-supabase-project.md`'s parity digest between bis-ci and production; they must match. Spot-check read-only on production: `select count(*) from pg_policies where tablename = 'contact_relationships'` is 5; `select pg_get_constraintdef(oid) from pg_constraint where conname = 'contact_relationships_label_key'` lists the twelve keys.
- [ ] **6. PR, merge, deploy.** Open the PR only now. Read the check runs for the head SHA (`gh api repos/{owner}/{repo}/commits/{sha}/check-runs`); merge with the SHA pinned. Verify the deploy is READY with the merge SHA, `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404, and the served-HTML marker: a contact detail page's HTML contains `data-relationships-card`.
- [ ] **7. Runbook and tracker.** Add 0070 to the run log in `docs/runbooks/ci-supabase-project.md`; update S-02 and F-003's rows in the roadmap tracker (memory "Roadmap tracker").

Hazards (spec §10): migration before app is safe (an empty table nobody reads, fences in the same file); app before migration is data-safe but the card shows its error state and writes fail, so the migration goes first. Rollback: revert the app and leave the table.

---

## Self-review against the spec

| Spec section | Covered by |
|---|---|
| §2 R1 three specs, two lanes, 0070 | header, shared-files table, Task 7 step 0 |
| §2 R2 a working card on drawer and detail page, no new page | Task 5 (`RelationshipsCard`, mounted twice) |
| §2 R3 fixed bilingual pairs from both sides, gendered Spanish, "Other" | Task 3 registry and tests; Task 1 CHECK and parity test |
| §2 R4 the other person is a contact, searched or created inline, assigned by F-085 | Task 4 (`searchRelatableContactsAction`, `addContactByHand`), Task 6 asserts `assigned_to` |
| §2 R5 two flags now, restricted flags wait | Task 1 columns and CHECKs; Global Constraints; the "Other" hint in Task 5 |
| §2 R6 / C5 Technician read either, write both, hidden name | Task 1 fences and tests; Task 3 `toRelationshipView`; Task 4 route test; Task 5 hidden-chip test |
| C1 per-side word form | Task 1 columns; Task 3 `wordFor`, `formChoices`, `chipFormControl`; Task 5 select and Words rows |
| C2 per-side flags | Task 1 columns; Task 3 `columnsForViewPatch`; Task 5 pills |
| C3 code registry, DB CHECK, parity | Task 1 step 4; Task 3 |
| C4 client writes under RLS, column grant | Task 1 grants and schema guard; Task 4 actions on `dbForRequest()` |
| C6 no label edit in place | no action exists for it; Task 1 grant excludes `label_key` |
| C7 "X o Y" | Task 3 test "neutral Spanish uses the 'X o Y' form" |
| §4.3 reader's language, `lang` on the card | Task 5 (`useLocale`, `t()`, `lang`), tests in both languages |
| §5.1 table, keys, cascade, uniqueness, indexes, no embeds | Task 1 migration; Task 2 two plain reads |
| §5.2 RLS | Task 1 |
| §5.4 grants and why | Task 1 |
| §5.5 teardown and guards | Task 2 (`ACCOUNT_OWNED_TABLES`, teardown test); Task 1 (schema guard, policy pin) |
| §6 queries, events without typed text, display, actions, errors, route | Tasks 2, 3, 4 |
| §7 screens: states, inline, Undo, add dialog, copy with `.es` | Task 5 (copy keys listed), Task 4 (error copy) |
| §8 duplicates, delete, merge | Task 1 cascade test; merge is out of scope (no task) |
| §9 testing (RLS, registry, actions, route, e2e) | Tasks 1, 3, 4, 6 |
| §10 rollout and deploy order | Task 7 |

Type and name consistency checked across tasks: `RelationshipRow`, `RelationshipKey`, `WordForm`, `RelatedPerson`, `SIDE_COLUMNS`, `RelationshipSidesPatch`, `NewRelationship`, `RelationshipDbError`, `listContactRelationships`, `getRelationship`, `addRelationship`, `setRelationshipSides`, `removeRelationship`, `restoreRelationship`, `RelationshipView`, `ViewPatch`, `toRelationshipView`, `columnsForViewPatch`, `newRelationshipFor`, `previewPair`, `chipText`, `chipFormControl`, `formChoices`, `relationshipOptions`, `personName`, `parseAddInput`, `parseViewPatch`, `parseSidesPatch`, `parseRelationshipRow`, `RelationshipError`, `relationshipErrorFor`, `addContactByHand`, `RelationshipsResponse`, `RelationshipsLoad`, `relationshipsLoadFrom`, `RelationshipsCard`, `RelationshipsCardView`, `AddRelationshipDialog`.

## Spec gaps found while planning (for the ledger)

1. **The `?locale=es` QA override cannot reach the card** (plan deviation 5): the account layout resolves the locale without `searchParams`. Spec §9's e2e line names it; Task 6 flips the Owner's own language instead. The spec should say so, or the layout should take the override (bis-platform's call).
2. **The route returns the record's own name** (deviation 3); spec §6 lists only the two reads.
3. **The words are bare words with a shape, not `{name}` templates** (deviation 1); the rendered text is the spec's table, unchanged.
4. **A new package subpath `@bis/db/relationship-keys`** (deviation 2) is not in the spec.
5. **`common.undo` and `common.retry` have no `.es` twin today** (`messages.ts:294-295`), so the card carries its own `relationships.undo` and `relationships.retry`. Giving the common keys Spanish twins is a separate copy task.
