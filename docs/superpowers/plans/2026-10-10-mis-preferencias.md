# Mis preferencias: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to carry this plan out task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

Spec: `docs/superpowers/specs/2026-10-10-mis-preferencias-design.md` (owner design D1 to D7, approved 2026-10-10; do not re-open it).

**Goal:** Every signed-in person chooses their own language and theme on one page, stored on their own `users` row, and the whole app honours it on every device.

**Architecture:** Migration 0067 adds `users.theme`. One React-`cache()`d per-request read, `getPersonPrefs()`, supplies `{ language, theme }`: for a client it is the SAME `memberships ⋈ users` read that already settles the role (now selecting two more columns), for the agency one indexed `users` read. `requestLocale` (already taking `userLanguage`) receives it at all three call sites; `resolveThemeMode` gains a `userTheme` parameter checked first. Writes go through two server actions that take no person id, key on Clerk's `userId`, validate against closed lists, and write through `serviceDb()`. The page `/dashboard/preferences` is two radio-group cards that save at once with an undo toast; it is reached from a Clerk `UserButton.Link` and ⌘K.

**Tech Stack:** Next 16 App Router (server actions, `proxy.ts`), Clerk (`@clerk/nextjs` 7.6.1 over `@clerk/react` 6.12.8), Supabase Postgres (RLS, PostgREST), next-themes, sonner, vitest 4, Playwright.

## Global Constraints

- Tokens only: no hard-coded colours, radii or shadows (DESIGN.md). Both themes, the blur fallback, keyboard focus ring visible.
- DESIGN.md rules 5 (loaded, empty and error states), 6 (each change runs at once with an undo toast, no confirm dialog), 7 (skeletons, no spinners), 8 (two independent cards; no primary Save anywhere on the page), and the ⌘K rule: the new destination is registered in `apps/web/src/lib/palette/registry.ts`.
- Migrations are applied by the orchestrator only, in this order: CI project (`ci-project-setup.yml`), then production via MCP, then the parity check, then merge. Never by an implementer, and never re-applied. Before any Supabase MCP call that may show an Accept/Decline prompt, the orchestrator warns danlo first.
- Users writes are server-only (0066). Only `serviceDb()` writes `users`, and only the caller's own row, keyed on `auth().userId`. No action, helper or form field accepts a person id from the browser.
- Agency users never get a membership. Nothing in this plan inserts into `memberships`.
- Agents run only the affected tests, by path. CI runs the full suite. `pnpm check`, the build and `test:e2e` belong to the orchestrator and run one at a time.
- Every test must be able to fail. Each test below names the mutation that must turn it red. Run that mutation, see the test fail BY NAME, then revert. A `-t` filter that matches nothing silently skips: confirm the name matched.
- Never parse `.env` values with code that can throw. Read `process.env.X` for presence only, and never echo a value.
- Never point mutating e2e at Test Client One. Any client-login check runs only on the per-run `E2E Client Co <stamp>` fixture, and any preference a spec sets is restored to NULL in its own teardown.
- Never git stash (the stash stack is shared across worktrees). Set work aside with a WIP commit.
- Any Radix Select inside a form submits via `useFormSubmit` (`apps/web/src/lib/forms/use-form-submit.ts`). This page uses native radio groups and no `<form>`; if a Select is ever added, that rule applies.
- Migration number: `0067` is the next free number today (the folder ends at `0066_staff_and_roles.sql`). Re-check at merge prep and renumber if taken.
- Copy: every new string goes in `apps/web/src/lib/messages.ts` with a `.es` twin (`"key"` / `"key.es"`), under `prefs.*` (page, menu item, palette) or `theme.*` (the toggle's failure toast). Rendered through `t(m, key, locale)`. The page is not agency-only, so the ratchet scans it with a zero baseline.
- Commits: `git add <explicit paths>`, never `-A`. Message form `type(scope): what and why`, ending with the session's attribution lines.

## Where the plan departs from the spec's wording (the source decided)

1. **Path.** The approved design names `/preferences`. The page is `/dashboard/preferences`: `proxy.ts` protects `/dashboard(.*)`, and `dashboard/layout.tsx` supplies the chrome and the `LocaleProvider`. A top-level `/preferences` would need a proxy-matcher change and would render without either.
2. **The user-menu item is a client component.** `components/topbar.tsx` is a server component (no `"use client"`). `UserButton.MenuItems` is a static property of a client reference and cannot be read on the server, and `UserButton.Link`'s `label` is a plain `string` (`@clerk/react/dist/types-BnGFcHu4.d.mts:10970-10974`), so the label must be resolved with `useLocale()` in a client component: `components/user-menu.tsx`.
3. **`requestLocale` needs no logic change.** It already takes `userLanguage` and lets it win on both branches (`lib/i18n/request-locale.ts:58-61`). Only its call sites and its doc comment change.
4. **The stored-role read is extended, not replaced.** `readStoredRole` keeps its exact signature and never-rejects contract and is derived from a new `readStoredPerson`, so the `ensureAccountRole` cache-key fix in `dashboard/layout.tsx` (staff and roles, review I1) needs no edit.
5. **`brand_mode` keeps its place.** The owner's precedence (`users.theme` > cookie > role default) names the person-level sources. A tenant's `brand_mode` stays where `resolveThemeMode` has it today, between the cookie and the role default; a `userTheme` outranks it.
6. **NULL is a valid save value for everyone.** Undo of a first-ever choice restores NULL. The agency's page never offers "Follow the account", but the action accepts NULL from the agency so its Undo works.

---

## Task order and parallelism

| # | Task | Owner | Runs |
|---|---|---|---|
| 1 | Migration 0067 and its schema test | bis-db-schema | first, alone |
| 2 | `@bis/db` preferences data layer, agency-exclusion pins | bis-db-schema | after 1 |
| 3 | Per-request read (`readStoredPerson`, `getPersonPrefs`) and the three `requestLocale` call sites | bis-platform | after 2, parallel with 4 |
| 4 | Save core and the two server actions | bis-platform | after 2, parallel with 3 |
| 5 | Theme: `resolveThemeMode(userTheme)`, `getRequestTheme`, the sync plan, the toggle persists | bis-frontend | after 3 and 4, parallel with 6 (separate dispatch) |
| 6 | The page, the user menu, the ⌘K entry, the copy | bis-frontend | after 3 and 4, parallel with 5 (separate dispatch) |
| 7 | e2e `preferences.spec.ts` | bis-e2e-qa | after 5 and 6 |
| 8 | Rollout, DESIGN.md line, roadmap (orchestrator, not code) | orchestrator | after merge prep |

Shared hot files: `packages/db/src/index.ts` (Task 2, additive), `messages.ts` (Task 5 adds `theme.saveFailed*`; Task 6 adds `prefs.*`; additive, different keys), `palette/registry.ts` (Task 6 only, one entry added, nothing reordered). Tasks 5 and 6 both touch no common file other than `messages.ts`.

---

## Task 1: Migration 0067 and its schema test

**Owner:** bis-db-schema. **Sequential:** first, alone.

Never git stash; any Radix Select inside a form submits via `useFormSubmit`.

**Files**
- Create: `packages/db/supabase/migrations/0067_person_preferences.sql`
- Create: `packages/db/src/test/person-preferences-schema.test.ts`

**Interfaces**
- Produces (SQL): `public.users.theme text` with `constraint users_theme_check check (theme in ('light','dark','system'))`. No grant or policy change.

- [ ] **Step 1: Write the failing test.**

```ts
// packages/db/src/test/person-preferences-schema.test.ts
import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

const RUN = Math.random().toString(36).slice(2, 10);
const SUB = `user_prefs_schema_${RUN}`;

async function seedUser(c: import("pg").Client): Promise<string> {
  return (await c.query<{ id: string }>(
    "insert into users (clerk_user_id, email) values ($1, $1 || '@example.com') returning id", [SUB])).rows[0]!.id;
}

describe("users.theme (0067)", () => {
  it.each(["light", "dark", "system"])("accepts %s (mutation: narrow the check to light/dark -> FAILS on system)", async (v) => {
    await withRollback(async (c) => {
      const id = await seedUser(c);
      const r = await c.query("update users set theme = $1 where id = $2", [v, id]);
      expect(r.rowCount).toBe(1);
    });
  });

  it("accepts NULL, which means no choice", async () => {
    await withRollback(async (c) => {
      const id = await seedUser(c);
      const { rows } = await c.query<{ theme: string | null }>("select theme from users where id = $1", [id]);
      expect(rows[0]!.theme).toBeNull();
    });
  });

  it("rejects anything else (mutation: drop users_theme_check -> FAILS)", async () => {
    await withRollback(async (c) => {
      const id = await seedUser(c);
      await expect(c.query("update users set theme = 'blue' where id = $1", [id])).rejects.toThrow(/users_theme_check/);
    });
  });

  it("a client token cannot write it (mutation: grant update on public.users to authenticated -> FAILS)", async () => {
    await withRollback(async (c) => {
      const id = await seedUser(c);
      await actAs(c, { org_id: `org_prefs_${RUN}`, sub: SUB });
      await expect(c.query("update users set theme = 'dark' where id = $1", [id])).rejects.toThrow(/permission denied/);
    });
  });
});
```

- [ ] **Step 2: Run it red.** `pnpm --filter @bis/db exec vitest run src/test/person-preferences-schema.test.ts` against the LOCAL replica (memory: PG18 + migrations) or the local stack, never production. Expect `column "theme" of relation "users" does not exist`. Paste the line. (Judge by vitest's summary block; the trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` line lies.)

- [ ] **Step 3: Write the migration.**

```sql
-- 0067_person_preferences.sql — a person's own theme (docs/superpowers/specs/2026-10-10-mis-preferencias-design.md §4)
--
-- users.language (en|es|NULL) already exists (0066). This adds users.theme. NULL = no choice:
-- the bis-theme cookie, then the tenant's brand_mode, then the role default (agency dark, client light).
-- Written only by server code (serviceDb(): the Preferences page's actions and the topbar toggle),
-- only to the caller's own row; 0066 already revoked INSERT/UPDATE/DELETE on public.users from authenticated.
-- Readable exactly as users.language is (users_agency_read, users_member_read). Agency rows have no
-- membership, so no client token can read them.
--
-- APPLY ORDER: CI project (ci-project-setup.yml), then production, then the parity check, then merge.
-- The app's stored-role read selects users.theme: code that ships before this column fails that read
-- CLOSED for every client (no role) until the column exists.
--
-- ROLLBACK: revert the code first (it selects theme), then: alter table public.users drop column theme;

set local lock_timeout = '5s';

alter table public.users
  add column theme text constraint users_theme_check check (theme in ('light', 'dark', 'system'));

comment on column public.users.theme is
  'The person''s own theme: light, dark or system (follow the device). NULL = no choice. Written only by the person''s own Preferences page and topbar toggle, server-side.';
```

- [ ] **Step 4: Apply to the LOCAL replica only and run green.** Paste the vitest summary line (`Tests  6 passed (6)`).
- [ ] **Step 5: Mutations.** Each by name: drop the constraint (rejects test fails), narrow to light/dark (`accepts system` fails), add `grant update on public.users to authenticated;` at the end of a scratch copy applied locally (`a client token cannot write it` fails). Revert each.
- [ ] **Step 6: Commit** `feat(db): users.theme, a person's own theme (0067)`. Do not apply to any shared project.

---

## Task 2: `@bis/db` preferences data layer and agency-exclusion pins

**Owner:** bis-db-schema. **Sequential:** after 1.

Never git stash; any Radix Select inside a form submits via `useFormSubmit`.

**Files**
- Create: `packages/db/src/preferences.ts`
- Create: `packages/db/src/test/preferences.test.ts`
- Modify: `packages/db/src/test/team.test.ts` (one new `describe`)
- Modify (additive): `packages/db/src/index.ts`

**Interfaces** (exact)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRole, PersonLanguage } from "./team";

export type PersonTheme = "light" | "dark" | "system";
export const PERSON_THEMES: readonly PersonTheme[];           // ["light", "dark", "system"]
export const PERSON_LANGUAGES: readonly PersonLanguage[];     // ["en", "es"]
export type PersonPrefs = { language: PersonLanguage | null; theme: PersonTheme | null };
export const NO_PREFS: PersonPrefs;                           // frozen { language: null, theme: null }
export function isPersonTheme(v: unknown): v is PersonTheme;
export function isPersonLanguageValue(v: unknown): v is PersonLanguage;
/** Narrows whatever the row holds; an unknown value reads as no choice, never throws. */
export function prefsFromRow(row: { language?: unknown; theme?: unknown } | null | undefined): PersonPrefs;
/** users by clerk_user_id. null = no users row. Throws on a read error. */
export function readPersonPrefs(db: SupabaseClient, clerkUserId: string): Promise<PersonPrefs | null>;
/** ONE read: memberships ⋈ users. null = no membership in this account. Throws on a read error. */
export function readAccountRoleAndPrefs(db: SupabaseClient, accountId: string, clerkUserId: string):
  Promise<{ role: AccountRole; prefs: PersonPrefs } | null>;
export type PreferenceWrite =
  | { field: "language"; value: PersonLanguage | null }
  | { field: "theme"; value: PersonTheme | null };
export type PersonProfile = { email: string; name: string | null };
/**
 * Writes ONE field of the caller's own users row, keyed on clerk_user_id. Creates the row (never a
 * membership) when none exists, asking `profile` for the email it needs. Throws on an unlisted value
 * (callers validate first; this is the second wall) and on a database error.
 */
export function savePersonPreference(
  db: SupabaseClient, clerkUserId: string, write: PreferenceWrite, profile: () => Promise<PersonProfile | null>,
): Promise<{ outcome: "saved"; previous: PersonLanguage | PersonTheme | null } | { outcome: "no_profile" }>;
```

- [ ] **Step 1: Write the failing tests.**

```ts
// packages/db/src/test/preferences.test.ts
import { describe, it, expect, afterAll } from "vitest";
import { serviceDb } from "../service";
import { withTestAccount } from "./fixtures";
import { listAccountTeam } from "../team";
import {
  isPersonTheme, prefsFromRow, NO_PREFS, readPersonPrefs, readAccountRoleAndPrefs, savePersonPreference,
} from "../preferences";

const RUN = Math.random().toString(36).slice(2, 10);
const AGENCY = `user_prefs_agency_${RUN}`;
const OTHER = `user_prefs_other_${RUN}`;
const MEMBER = `user_prefs_member_${RUN}`;
const profile = (sub: string) => async () => ({ email: `${sub}@example.com`, name: "Pat" });

afterAll(async () => {
  await serviceDb().from("users").delete().in("clerk_user_id", [AGENCY, OTHER, MEMBER]);
});

describe("pure narrowing", () => {
  it("isPersonTheme takes exactly the three values (mutation: accept any string -> FAILS)", () => {
    for (const v of ["light", "dark", "system"]) expect(isPersonTheme(v)).toBe(true);
    for (const v of ["blue", "", null, undefined, 1, "Dark"]) expect(isPersonTheme(v)).toBe(false);
  });
  it("prefsFromRow reads an unknown value as no choice and never throws (mutation: cast instead of narrow -> FAILS)", () => {
    expect(prefsFromRow({ language: "fr", theme: "blue" })).toEqual(NO_PREFS);
    expect(prefsFromRow(null)).toEqual(NO_PREFS);
    expect(prefsFromRow({ language: "es", theme: "system" })).toEqual({ language: "es", theme: "system" });
  });
});

describe("savePersonPreference", () => {
  it("creates an agency person's row on first save with NO membership, and no team ever lists it (mutation: also addAccountMember -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const r = await savePersonPreference(db, AGENCY, { field: "theme", value: "dark" }, profile(AGENCY));
      expect(r).toEqual({ outcome: "saved", previous: null });
      const { data: u } = await db.from("users").select("id, theme, email").eq("clerk_user_id", AGENCY).single();
      expect(u).toMatchObject({ theme: "dark", email: `${AGENCY}@example.com` });
      const { count } = await db.from("memberships").select("id", { count: "exact", head: true }).eq("user_id", u!.id);
      expect(count).toBe(0);
      expect((await listAccountTeam(db, accountId)).map((m) => m.clerkUserId)).not.toContain(AGENCY);
    });
  });

  it("returns the previous value, for Undo (mutation: read previous after the write -> FAILS)", async () => {
    const db = serviceDb();
    await savePersonPreference(db, AGENCY, { field: "language", value: "es" }, profile(AGENCY));
    expect(await savePersonPreference(db, AGENCY, { field: "language", value: "en" }, profile(AGENCY)))
      .toEqual({ outcome: "saved", previous: "es" });
    expect(await savePersonPreference(db, AGENCY, { field: "language", value: null }, profile(AGENCY)))
      .toEqual({ outcome: "saved", previous: "en" });
  });

  it("changes only the caller's row (mutation: drop the clerk_user_id filter on the update -> FAILS)", async () => {
    const db = serviceDb();
    await savePersonPreference(db, OTHER, { field: "theme", value: "light" }, profile(OTHER));
    await savePersonPreference(db, AGENCY, { field: "theme", value: "system" }, profile(AGENCY));
    expect(await readPersonPrefs(db, OTHER)).toEqual({ language: null, theme: "light" });
  });

  it("writes only the named field (mutation: send both columns on update -> FAILS)", async () => {
    const db = serviceDb();
    await savePersonPreference(db, OTHER, { field: "language", value: "es" }, profile(OTHER));
    expect(await readPersonPrefs(db, OTHER)).toEqual({ language: "es", theme: "light" });
  });

  it("no profile and no row means nothing is written (mutation: insert with an empty email -> FAILS)", async () => {
    const sub = `user_prefs_noprofile_${RUN}`;
    expect(await savePersonPreference(serviceDb(), sub, { field: "theme", value: "dark" }, async () => null))
      .toEqual({ outcome: "no_profile" });
    expect(await readPersonPrefs(serviceDb(), sub)).toBeNull();
  });

  it("refuses an unlisted value before any query (mutation: drop the guard -> FAILS: the DB check message differs)", async () => {
    await expect(savePersonPreference(serviceDb(), AGENCY, { field: "theme", value: "blue" as never }, profile(AGENCY)))
      .rejects.toThrow(/savePersonPreference: unlisted theme/);
  });
});

describe("readAccountRoleAndPrefs", () => {
  it("returns role and prefs from one read; null with no membership (mutation: default a missing membership to owner -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await readAccountRoleAndPrefs(db, accountId, MEMBER)).toBeNull();
      const { data: u } = await db.from("users")
        .insert({ clerk_user_id: MEMBER, email: `${MEMBER}@example.com`, language: "es", theme: "dark" }).select("id").single();
      await db.from("memberships").insert({ scope: "account", account_id: accountId, user_id: u!.id, role: "staff" });
      expect(await readAccountRoleAndPrefs(db, accountId, MEMBER))
        .toEqual({ role: "staff", prefs: { language: "es", theme: "dark" } });
    });
  });
});
```

And in `packages/db/src/test/team.test.ts`, a new `describe` (read the file's existing fake `ClerkTeamPort` helpers first and reuse them; the shape below is the intent, the source decides the names):

```ts
describe("agency users stay out of every team even once they have a users row (mis preferencias D2)", () => {
  it("reconcileMembership returns agency_user and leaves the agency row's preferences and membership count alone (mutation: move the isAgencyMetadata check below upsertUserFromClerk -> FAILS)", async () => {
    // seed: a users row for the agency sub with theme 'dark', language 'es'; a test account; a port whose
    // getMembership returns an org:admin membership and getUser returns publicMetadata { app_role: "agency_admin" }.
    // assert: outcome "agency_user"; zero memberships for that user; theme/language unchanged.
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter @bis/db exec vitest run src/test/preferences.test.ts src/test/team.test.ts` (local stack). Expect `Failed to load url ../preferences`. Paste it.
- [ ] **Step 3: Implement `packages/db/src/preferences.ts`.** Key code:

```ts
export async function readAccountRoleAndPrefs(db: SupabaseClient, accountId: string, clerkUserId: string) {
  const { data, error } = await db.from("memberships").select("role, users!inner(clerk_user_id, language, theme)")
    .eq("scope", "account").eq("account_id", accountId).eq("users.clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`readAccountRoleAndPrefs failed: ${error.message}`);
  if (!data) return null;
  return { role: data.role as AccountRole, prefs: prefsFromRow(data.users as unknown as { language: unknown; theme: unknown }) };
}

export async function savePersonPreference(db, clerkUserId, write, profile) {
  const ok = write.field === "theme"
    ? write.value === null || isPersonTheme(write.value)
    : write.value === null || isPersonLanguageValue(write.value);
  if (!ok) throw new Error(`savePersonPreference: unlisted ${write.field}`);
  const { data: row, error } = await db.from("users").select("id, language, theme")
    .eq("clerk_user_id", clerkUserId).maybeSingle();
  if (error) throw new Error(`savePersonPreference read failed: ${error.message}`);
  if (row) {
    const previous = prefsFromRow(row)[write.field];
    const { error: e2 } = await db.from("users").update({ [write.field]: write.value }).eq("id", row.id);
    if (e2) throw new Error(`savePersonPreference update failed: ${e2.message}`);
    return { outcome: "saved", previous };
  }
  const p = await profile();
  if (!p?.email) return { outcome: "no_profile" };
  // Upsert, not insert: two first saves racing (two tabs) both land; ON CONFLICT updates only the sent columns.
  const { error: e3 } = await db.from("users")
    .upsert({ clerk_user_id: clerkUserId, email: p.email, name: p.name, [write.field]: write.value }, { onConflict: "clerk_user_id" });
  if (e3) throw new Error(`savePersonPreference insert failed: ${e3.message}`);
  return { outcome: "saved", previous: null };
}
```

Error messages carry `error.message` only (never a value, never an email). Export everything in the interface block from `index.ts`, additively, beside the team exports.
- [ ] **Step 4: Run green.** Paste the summary line.
- [ ] **Step 5: Mutations,** each by name as written in the test titles. Revert each.
- [ ] **Step 6: Commit** `feat(db): read and save a person's own preferences; agency rows stay out of teams`.

---

## Task 3: Per-request read and the three `requestLocale` call sites

**Owner:** bis-platform. **Parallel with 4**, after 2.

Never git stash; any Radix Select inside a form submits via `useFormSubmit`.

**Files**
- Modify: `apps/web/src/lib/team/ensure-role.ts`, `apps/web/src/lib/team/ensure-role.test.ts`
- Create: `apps/web/src/lib/preferences/person-prefs.ts`, `apps/web/src/lib/preferences/person-prefs.test.ts`
- Create: `apps/web/src/lib/i18n/request-locale-callers.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/layout.tsx`, `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/layout.tsx`, `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx`, `apps/web/src/lib/i18n/request-locale.ts` (doc comment only), `apps/web/src/lib/i18n/locale.ts` (doc comment only)

**Interfaces**

```ts
// ensure-role.ts (additions; readStoredRole, readStoredRoleWith, ensureAccountRole keep their signatures)
export type StoredPerson = { role: AccountRole; prefs: PersonPrefs } | null | typeof STORED_READ_FAILED;
export function readStoredPersonWith(db: () => SupabaseClient, accountId: string, clerkUserId: string): Promise<StoredPerson>; // never rejects
export function toStoredRole(p: StoredPerson): StoredRole;
export const readStoredPerson: (accountId: string, clerkUserId: string) => Promise<StoredPerson>; // cache()'d
// readStoredRoleWith(db, a, u) = readStoredPersonWith(db, a, u).then(toStoredRole)
// readStoredRole = cache((a, u) => readStoredPerson(a, u).then(toStoredRole))

// person-prefs.ts
export type AccessState = Awaited<ReturnType<typeof import("@/lib/auth").resolveClientAccessState>>;
export function resolvePersonPrefsWith(deps: {
  userId: string | null;
  state: () => Promise<AccessState>;
  readStored: (accountId: string, clerkUserId: string) => Promise<StoredPerson>;
  readUser: (clerkUserId: string) => Promise<PersonPrefs | null>;
}): Promise<PersonPrefs>; // never rejects
export const getPersonPrefs: () => Promise<PersonPrefs>; // cache()'d; auth() + getTenantAccessState + readStoredPerson + readPersonPrefs(serviceDb())
/** For /dashboard/preferences only: THROWS on a failed read, so the page shows its error state instead of defaults. */
export function loadMyPreferences(): Promise<PersonPrefs>;
```

- [ ] **Step 1: Red tests.**

```ts
// person-prefs.test.ts
import { describe, it, expect, vi } from "vitest";
import { NO_PREFS } from "@bis/db";
import { STORED_READ_FAILED } from "@/lib/team/ensure-role";
import { resolvePersonPrefsWith } from "./person-prefs";

const es = { language: "es", theme: "dark" } as const;
const deps = (over: Partial<Parameters<typeof resolvePersonPrefsWith>[0]> = {}) => ({
  userId: "user_1",
  state: async () => ({ status: "ok", id: "acct", name: "x", timezone: "UTC", language: null }) as const,
  readStored: vi.fn(async () => ({ role: "staff" as const, prefs: es })),
  readUser: vi.fn(async () => null),
  ...over,
});

describe("resolvePersonPrefsWith (spec 5.1)", () => {
  it("signed out reads nothing (mutation: read users with a null id -> FAILS)", async () => {
    const d = deps({ userId: null });
    expect(await resolvePersonPrefsWith(d)).toEqual(NO_PREFS);
    expect(d.readStored).not.toHaveBeenCalled(); expect(d.readUser).not.toHaveBeenCalled();
  });
  it("a client reads the stored-person entry for its own account and nothing else (mutation: call readUser too -> FAILS)", async () => {
    const d = deps();
    expect(await resolvePersonPrefsWith(d)).toEqual(es);
    expect(d.readStored).toHaveBeenCalledWith("acct", "user_1"); expect(d.readUser).not.toHaveBeenCalled();
  });
  it("a client with no membership yet falls back to its users row (mutation: return NO_PREFS on null -> FAILS)", async () => {
    const d = deps({ readStored: vi.fn(async () => null), readUser: vi.fn(async () => es) });
    expect(await resolvePersonPrefsWith(d)).toEqual(es);
  });
  it("the agency reads its users row (mutation: treat agency like signed out -> FAILS)", async () => {
    const d = deps({ state: async () => ({ status: "agency" }) as const, readUser: vi.fn(async () => es) });
    expect(await resolvePersonPrefsWith(d)).toEqual(es);
    expect(d.readStored).not.toHaveBeenCalled();
  });
  it("a failed read is defaults, never a throw (mutation: let readUser's rejection escape -> FAILS)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await resolvePersonPrefsWith(deps({ readStored: vi.fn(async () => STORED_READ_FAILED) }))).toEqual(NO_PREFS);
    expect(await resolvePersonPrefsWith(deps({ state: async () => ({ status: "agency" }) as const,
      readUser: vi.fn(async () => { throw new Error("down"); }) }))).toEqual(NO_PREFS);
  });
});
```

In `ensure-role.test.ts`: the existing `vi.mock("@bis/db")` mocks `readAccountRole` as `readRole`. Re-point that mock at `readAccountRoleAndPrefs` (resolving `{ role, prefs }` or `null`) and keep every existing test's assertion; add:

```ts
it("one read yields both the role and the prefs (mutation: read the role with readAccountRole and the prefs separately -> FAILS: two calls)", async () => {
  readRoleAndPrefs.mockResolvedValue({ role: "owner", prefs: { language: "es", theme: null } });
  const person = await readStoredPersonWith(() => db, "a", "u");
  expect(toStoredRole(person)).toBe("owner");
  expect(person).toMatchObject({ prefs: { language: "es" } });
  expect(readRoleAndPrefs).toHaveBeenCalledTimes(1);
});
```

```ts
// request-locale-callers.test.ts — RSC layouts cannot be rendered in this vitest; this pins the wiring.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const APP = path.resolve(__dirname, "../../app");
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
});

describe("every requestLocale call passes the person's own language (spec 5.2)", () => {
  it("names userLanguage in each call, and finds at least the three known sites (mutation: drop userLanguage from dashboard/layout.tsx -> FAILS naming it)", () => {
    const calls = files(APP).flatMap((f) => {
      const src = readFileSync(f, "utf8");
      return [...src.matchAll(/requestLocale\(\s*\{([\s\S]*?)\}\s*[,)]/g)].map((m) => ({ f: path.relative(APP, f), args: m[1]! }));
    });
    expect(calls.length).toBeGreaterThanOrEqual(3);
    expect(calls.filter((c) => !/userLanguage\s*:/.test(c.args)).map((c) => c.f)).toEqual([]);
  });
});
```

Check the regex against the three real call sites before trusting it (the `account:` argument in `dashboard/layout.tsx` contains a nested `{ language: … }` object: confirm the lazy match still captures `userLanguage` once added, or widen the pattern to read up to the call's closing parenthesis). A pattern that matches zero calls passes vacuously, which is why `>= 3` is asserted.

- [ ] **Step 2: Run red** (`pnpm --filter web exec vitest run src/lib/preferences/person-prefs.test.ts src/lib/team/ensure-role.test.ts src/lib/i18n/request-locale-callers.test.ts`). Paste each failing line.
- [ ] **Step 3: Implement.** `getPersonPrefs`:

```ts
export const getPersonPrefs = cache(async (): Promise<PersonPrefs> => {
  try {
    const { userId } = await auth();
    return await resolvePersonPrefsWith({
      userId: userId ?? null, state: getTenantAccessState, readStored: readStoredPerson,
      readUser: (id) => readPersonPrefs(serviceDb(), id),
    });
  } catch (e) {
    unstable_rethrow(e);
    console.error(`person-prefs: read failed: ${loggableError(e)}`);
    return NO_PREFS;
  }
});
```

`serviceDb()` here is the pre-trust read that `auth.ts`'s rule allows (it runs inside the same request phase as `requireAccountAccess`, keyed on Clerk's own `userId`).

Call sites:
- `dashboard/layout.tsx`: add `getPersonPrefs()` to the existing `Promise.all`; `requestLocale({ account: …, isOperator: isAgency, userLanguage: prefs.language })`. Update the comment above it: operators stay English only until they choose.
- `[accountId]/layout.tsx`: `const [{ isAgency }, prefs] = await Promise.all([requireAccountAccess(accountId), getPersonPrefs()]);` then `requestLocale({ account, isOperator: isAgency, userLanguage: prefs.language })`.
- `[accountId]/dashboard/page.tsx` line 92: same, keeping its `{ locale: localeParam }` second argument.
- `request-locale.ts` and `locale.ts`: replace "Not yet populated by any caller" / "every caller in THIS lane passes undefined" with a pointer to `getPersonPrefs`.

- [ ] **Step 4: Green;** paste the summary line. Also run `src/lib/i18n/request-locale.test.ts` (unchanged, must stay green).
- [ ] **Step 5: Mutations** as named. Revert.
- [ ] **Step 6: Commit** `feat(auth): one per-request read of a person's own language and theme; every locale call honours it`.

---

## Task 4: Save core and the two server actions

**Owner:** bis-platform. **Parallel with 3**, after 2.

Never git stash; any Radix Select inside a form submits via `useFormSubmit`.

**Files**
- Create: `apps/web/src/lib/preferences/save.ts`, `apps/web/src/lib/preferences/save.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/preferences/actions.ts`

**Interfaces**

```ts
// save.ts
export type PrefsError = "prefs.invalid" | "prefs.failed";
export type PrefsResult<T> = { ok: true; previous: T | null } | { ok: false; error: PrefsError };
export function parseLanguage(raw: unknown): { ok: true; value: PersonLanguage | null } | { ok: false };
export function parseTheme(raw: unknown): { ok: true; value: PersonTheme | null } | { ok: false };
export function saveMyPreferenceWith<F extends "language" | "theme">(
  deps: { userId: string; db: () => SupabaseClient; profile: () => Promise<PersonProfile | null> },
  field: F, raw: unknown,
): Promise<PrefsResult<F extends "language" ? PersonLanguage : PersonTheme>>;

// actions.ts ("use server") — NO person id parameter, by design (spec §7)
export async function setMyLanguageAction(language: string | null): Promise<PrefsResult<PersonLanguage>>;
export async function setMyThemeAction(theme: string | null): Promise<PrefsResult<PersonTheme>>;
```

- [ ] **Step 1: Red test.**

```ts
// save.test.ts
import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const save = vi.fn();
vi.mock("@bis/db", async (orig) => ({ ...(await orig<typeof import("@bis/db")>()), savePersonPreference: (...a: unknown[]) => save(...a) }));
const { saveMyPreferenceWith, parseLanguage, parseTheme } = await import("./save");

const db = {} as SupabaseClient;
const deps = { userId: "user_me", db: () => db, profile: async () => ({ email: "me@example.com", name: null }) };

describe("parse (closed lists)", () => {
  it("language: en, es, null only (mutation: accept any 2-letter code -> FAILS on 'fr')", () => {
    expect(parseLanguage("es")).toEqual({ ok: true, value: "es" });
    expect(parseLanguage(null)).toEqual({ ok: true, value: null });
    for (const v of ["fr", "", "ES", undefined, 1]) expect(parseLanguage(v)).toEqual({ ok: false });
  });
  it("theme: light, dark, system, null only (mutation: drop 'system' -> FAILS)", () => {
    for (const v of ["light", "dark", "system", null]) expect(parseTheme(v)).toEqual({ ok: true, value: v });
    for (const v of ["blue", "", undefined]) expect(parseTheme(v)).toEqual({ ok: false });
  });
});

describe("saveMyPreferenceWith (spec §7)", () => {
  it("an unlisted value is refused with no query (mutation: validate after calling save -> FAILS)", async () => {
    expect(await saveMyPreferenceWith(deps, "theme", "blue")).toEqual({ ok: false, error: "prefs.invalid" });
    expect(save).not.toHaveBeenCalled();
  });
  it("writes the AUTHENTICATED user's row, whatever else is passed (mutation: key on a raw input field -> FAILS)", async () => {
    save.mockResolvedValue({ outcome: "saved", previous: "light" });
    expect(await saveMyPreferenceWith(deps, "theme", "dark")).toEqual({ ok: true, previous: "light" });
    expect(save).toHaveBeenCalledWith(db, "user_me", { field: "theme", value: "dark" }, deps.profile);
  });
  it("no Clerk profile on a first save is a clean failure (mutation: report no_profile as ok -> FAILS)", async () => {
    save.mockResolvedValue({ outcome: "no_profile" });
    expect(await saveMyPreferenceWith(deps, "language", "es")).toEqual({ ok: false, error: "prefs.failed" });
  });
  it("a database fault is prefs.failed and is logged without the value (mutation: let it throw -> FAILS)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    save.mockRejectedValue(new Error("savePersonPreference update failed: timeout"));
    expect(await saveMyPreferenceWith(deps, "language", "es")).toEqual({ ok: false, error: "prefs.failed" });
    expect(String(err.mock.calls[0])).toContain("timeout");
  });
});
```

- [ ] **Step 2: Red** (`pnpm --filter web exec vitest run src/lib/preferences/save.test.ts`); paste the line.
- [ ] **Step 3: Implement.** The actions:

```ts
"use server";
export async function setMyThemeAction(theme: string | null): Promise<PrefsResult<PersonTheme>> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const r = await saveMyPreferenceWith({ userId, db: serviceDb, profile: clerkProfile }, "theme", theme);
  if (r.ok) revalidatePath("/dashboard", "layout");
  return r;
}
// setMyLanguageAction: identical shape, field "language".

async function clerkProfile(): Promise<PersonProfile | null> {
  try {
    const u = await currentUser();
    const email = u?.primaryEmailAddress?.emailAddress;
    return email ? { email, name: u?.fullName ?? null } : null;
  } catch (e) {
    console.error(`preferences: Clerk profile unavailable: ${loggableError(e)}`);
    return null;
  }
}
```

`currentUser()` reads the signed-in person's own record from Clerk; it runs only on a first-ever save (no `users` row). It is app code on the request path, not a script (Working rule 7 is about scripts and REPLs).
- [ ] **Step 4: Green,** paste the summary line. **Mutations** as named; revert.
- [ ] **Step 5: Commit** `feat(auth): save a person's own language and theme, keyed on their Clerk id, closed lists first`.

---

## Task 5: Theme resolution, the sync plan, and the toggle persists

**Owner:** bis-frontend. **Parallel with 6** (separate dispatch), after 3 and 4.

Never git stash; any Radix Select inside a form submits via `useFormSubmit`.

**Files**
- Modify: `apps/web/src/lib/branding/theme-mode.ts`, `apps/web/src/lib/branding/theme-mode.test.ts`
- Modify: `apps/web/src/lib/branding/tenant-theme-reader.ts` (+ its test if `pickRequestThemeMode` is covered there)
- Modify: `apps/web/src/app/(dashboard)/layout.tsx` (pass `userTheme` to `ThemeProvider`)
- Modify: `apps/web/src/components/theme-provider.tsx`, `apps/web/src/components/theme-cookie-sync.tsx`
- Modify: `apps/web/src/components/theme-toggle.tsx`, `apps/web/src/components/theme-toggle.test.ts`, `apps/web/src/components/command-palette.tsx` (pass `persist`)
- Modify (additive): `apps/web/src/lib/messages.ts` (`theme.saveFailed`, `theme.saveFailed.es`)

**Interfaces**

```ts
export function resolveThemeMode(
  cookie: string | undefined, brandMode: ModeName | null, isOperator = false, userTheme: PersonTheme | null = null,
): { serverMode: "light" | "dark"; providerDefault: "light" | "dark" | "system" };
export function pickRequestThemeMode(cookie: string | undefined, inputs: ThemeInputs, isOperator = false, userTheme: PersonTheme | null = null): ReturnType<typeof resolveThemeMode>;
export type RequestTheme = { inputs: ThemeInputs; serverMode: "light" | "dark"; providerDefault: "light" | "dark" | "system"; userTheme: PersonTheme | null };
export function userThemeSyncPlan(
  userTheme: PersonTheme | null, theme: string | undefined, existingCookie: string | undefined,
): { setTheme: PersonTheme | null; writeCookie: "light" | "dark" | null; skipMigration: boolean };
export function toggleTheme(
  resolvedTheme: string | undefined, setTheme: (t: string) => void, refresh: () => void,
  persist: (mode: "light" | "dark") => Promise<{ ok: boolean }>, onPersistFailed: () => void,
): void;
```

- [ ] **Step 1: Red tests** (add to `theme-mode.test.ts`):

```ts
describe("a person's own theme outranks everything (mis preferencias D5)", () => {
  it("light/dark win over the cookie, the brand and the role (mutation: check userTheme after the cookie -> FAILS)", () => {
    expect(resolveThemeMode("dark", "dark", true, "light")).toEqual({ serverMode: "light", providerDefault: "light" });
    expect(resolveThemeMode("light", "follow", false, "dark")).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });
  it("system follows the device: provider 'system', server paints the OS snapshot cookie (mutation: providerDefault = cookie -> FAILS)", () => {
    expect(resolveThemeMode("dark", null, false, "system")).toEqual({ serverMode: "dark", providerDefault: "system" });
  });
  it("system with no snapshot yet paints the role default (mutation: always light -> FAILS for the operator)", () => {
    expect(resolveThemeMode(undefined, null, true, "system")).toEqual({ serverMode: "dark", providerDefault: "system" });
    expect(resolveThemeMode(undefined, null, false, "system")).toEqual({ serverMode: "light", providerDefault: "system" });
  });
  it("NULL leaves today's chain untouched (mutation: treat null as 'system' -> FAILS)", () => {
    expect(resolveThemeMode("light", null, true, null)).toEqual({ serverMode: "light", providerDefault: "light" });
    expect(resolveThemeMode(undefined, null, true, null)).toEqual({ serverMode: "dark", providerDefault: "dark" });
  });
});

describe("userThemeSyncPlan", () => {
  it("adopts the stored theme when next-themes disagrees (another device chose it) (mutation: never setTheme -> FAILS)", () => {
    expect(userThemeSyncPlan("light", "dark", "light")).toEqual({ setTheme: "light", writeCookie: null, skipMigration: true });
  });
  it("writes the cookie for light/dark when it differs, never for system (mutation: write 'system' into the cookie -> FAILS)", () => {
    expect(userThemeSyncPlan("dark", "dark", "light").writeCookie).toBe("dark");
    expect(userThemeSyncPlan("system", "system", undefined).writeCookie).toBeNull();
  });
  it("does nothing new when there is no stored choice (mutation: skip the migration for everyone -> FAILS)", () => {
    expect(userThemeSyncPlan(null, "dark", undefined)).toEqual({ setTheme: null, writeCookie: null, skipMigration: false });
  });
});
```

And in `theme-toggle.test.ts`:

```ts
it("persists the new mode and reports a failed save (mutation: drop the persist call -> FAILS)", async () => {
  const persist = vi.fn(async () => ({ ok: false }));
  const failed = vi.fn();
  toggleTheme("dark", vi.fn(), vi.fn(), persist, failed);
  await vi.waitFor(() => expect(failed).toHaveBeenCalledTimes(1));
  expect(persist).toHaveBeenCalledWith("light");
});
```

(Read the existing `theme-toggle.test.ts` first: if it stubs `document.cookie` a particular way, reuse it. Existing calls to `toggleTheme` with three arguments must be updated, not left to a default.)
- [ ] **Step 2: Red;** paste lines (`pnpm --filter web exec vitest run src/lib/branding/theme-mode.test.ts src/components/theme-toggle.test.ts src/lib/branding/tenant-theme-reader.test.ts`).
- [ ] **Step 3: Implement.** `resolveThemeMode`, first lines:

```ts
const cookieMode = cookie === "light" || cookie === "dark" ? cookie : undefined;
const roleDefault = isOperator ? "dark" : "light";
if (userTheme === "light" || userTheme === "dark") return { serverMode: userTheme, providerDefault: userTheme };
if (userTheme === "system") return { serverMode: cookieMode ?? roleDefault, providerDefault: "system" };
// …today's chain, unchanged
```

`getRequestTheme`: add `getPersonPrefs()` to its `Promise.all`; pass `prefs.theme` to `pickRequestThemeMode`; return `userTheme: prefs.theme`. Root layout: `<ThemeProvider defaultTheme={providerDefault} userTheme={userTheme}>`; `ThemeProvider` forwards it to `<ThemeCookieSync userTheme={userTheme} />`. In `ThemeCookieSync`'s effect, compute the plan first: `if (plan.setTheme) setTheme(plan.setTheme); if (plan.writeCookie) document.cookie = …;` and run the migration branch only when `!plan.skipMigration`. Toggle: `persist` = `setMyThemeAction`, `onPersistFailed` = `toast.error(t(m, "theme.saveFailed", locale))` (the toggle reads `useLocale()`). The palette's `toggle-theme` action passes the same two.

Copy: `"theme.saveFailed": "Couldn't save your theme. It may switch back when the page reloads."`, `"theme.saveFailed.es": "No se pudo guardar tu tema. Puede volver al anterior al recargar la página."`
- [ ] **Step 4: Green;** paste the summary. Run `src/lib/i18n/ratchet.test.ts` too.
- [ ] **Step 5: Mutations** as named. Revert.
- [ ] **Step 6: Visual check.** None by the implementer (Playwright is not yours); Task 7 proves the server paint.
- [ ] **Step 7: Commit** `feat(design): a person's own theme outranks the cookie; the toggle saves it`.

---

## Task 6: The page, the user menu, the ⌘K entry, the copy

**Owner:** bis-frontend. **Parallel with 5** (separate dispatch), after 3 and 4.

Never git stash; any Radix Select inside a form submits via `useFormSubmit`.

**Files**
- Create: `apps/web/src/app/(dashboard)/dashboard/preferences/page.tsx`, `loading.tsx`, `error.tsx`
- Create: `apps/web/src/components/preferences/preferences-panel.tsx` (client), `apps/web/src/components/preferences/preference-handlers.ts`, `apps/web/src/components/preferences/preference-handlers.test.ts`
- Create: `apps/web/src/lib/preferences/preference-options.ts`, `apps/web/src/lib/preferences/preference-options.test.ts`
- Create: `apps/web/src/components/user-menu.tsx` (client); Modify: `apps/web/src/components/topbar.tsx` (`<UserButton />` → `<UserMenu />`)
- Modify (one entry, nothing reordered): `apps/web/src/lib/palette/registry.ts`, `apps/web/src/lib/palette/registry.test.ts`
- Modify (additive): `apps/web/src/lib/messages.ts` (`prefs.*` with `.es` twins)
- Modify: the `/styleguide` page only if a new reusable component/variant results (a radio-card group probably does: add one demo)

**Interfaces**

```ts
// preference-options.ts
export type LanguageChoice = "en" | "es" | "account";        // "account" = NULL, client logins only
export function languageChoicesFor(isAgency: boolean): readonly LanguageChoice[];
export function languageChoiceFrom(value: PersonLanguage | null, isAgency: boolean): LanguageChoice | null; // agency NULL -> null (nothing checked)
export function languageValueOf(choice: LanguageChoice): PersonLanguage | null;
export const THEME_CHOICES: readonly PersonTheme[];           // ["light", "dark", "system"]

// preference-handlers.ts — plain async functions, testable without a DOM (team-handlers.ts's pattern)
export const PREFS_TOAST_MS = 10_000;
export type PrefsToast = { success: (msg: string, undo: { label: string; onClick: () => void }) => void; error: (msg: string) => void };
export function changeLanguage(input: {
  next: PersonLanguage | null; current: PersonLanguage | null;
  save: (v: PersonLanguage | null) => Promise<PrefsResult<PersonLanguage>>;
  apply: (v: PersonLanguage | null) => void;          // sets the radio and refreshes the route
  copyFor: (locale: Locale) => (key: PrefsCopyKey, params?: Record<string, string>) => string;
  accountLanguage: PersonLanguage | null; toast: PrefsToast;
}): Promise<void>;
export function changeTheme(input: {
  next: PersonTheme | null; current: PersonTheme | null;
  save: (v: PersonTheme | null) => Promise<PrefsResult<PersonTheme>>;
  apply: (v: PersonTheme | null) => void;              // setTheme + cookie (light/dark) + router.refresh()
  copy: (key: PrefsCopyKey, params?: Record<string, string>) => string; toast: PrefsToast;
}): Promise<void>;
```

- [ ] **Step 1: Red tests.**

```ts
// preference-options.test.ts
it("the agency is offered English and Español only (mutation: return all three for everyone -> FAILS)", () => {
  expect(languageChoicesFor(true)).toEqual(["en", "es"]);
  expect(languageChoicesFor(false)).toEqual(["en", "es", "account"]);
});
it("a client's NULL is 'Follow the account'; an agency's NULL checks nothing (mutation: map agency NULL to 'en' -> FAILS)", () => {
  expect(languageChoiceFrom(null, false)).toBe("account");
  expect(languageChoiceFrom(null, true)).toBeNull();
  expect(languageValueOf("account")).toBeNull();
});
```

```ts
// preference-handlers.test.ts
it("applies at once, saves, and Undo sends the PREVIOUS value the server returned (mutation: undo with next -> FAILS)", async () => {
  const save = vi.fn(async (v: PersonTheme | null) => ({ ok: true as const, previous: v === "dark" ? "light" as const : null }));
  const apply = vi.fn(); let undo: (() => void) | undefined;
  const toast = { success: vi.fn((_m: string, u: { onClick: () => void }) => { undo = u.onClick; }), error: vi.fn() };
  await changeTheme({ next: "dark", current: "light", save, apply, copy: (k) => k, toast });
  expect(apply).toHaveBeenNthCalledWith(1, "dark");
  undo!();
  await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith("light"));
  expect(apply).toHaveBeenLastCalledWith("light");
});
it("a failed save puts the radio back and says so (mutation: skip the revert -> FAILS)", async () => {
  const apply = vi.fn(); const toast = { success: vi.fn(), error: vi.fn() };
  await changeTheme({ next: "dark", current: null, save: async () => ({ ok: false as const, error: "prefs.failed" as const }), apply, copy: (k) => k, toast });
  expect(apply.mock.calls).toEqual([["dark"], [null]]);
  expect(toast.error).toHaveBeenCalledWith("prefs.error.failed");
});
it("a language toast speaks the language just chosen (mutation: use the current locale -> FAILS)", async () => {
  const copyFor = vi.fn(() => (k: string) => k); const toast = { success: vi.fn(), error: vi.fn() };
  await changeLanguage({ next: "es", current: null, save: async () => ({ ok: true as const, previous: null }), apply: vi.fn(),
    copyFor, accountLanguage: null, toast });
  expect(copyFor).toHaveBeenCalledWith("es");
});
it("a thrown action (stale page) is the house reload sentence (mutation: let it throw -> FAILS)", async () => {
  const toast = { success: vi.fn(), error: vi.fn() };
  await changeTheme({ next: "dark", current: null, save: async () => { throw new Error("x"); }, apply: vi.fn(), copy: (k) => k, toast });
  expect(toast.error).toHaveBeenCalledWith("common.actionCrashed");
});
```

```ts
// registry.test.ts (added)
it.each([[true, null], [false, "/dashboard/accounts/a"], [true, "/dashboard/accounts/a"]] as const)(
  "offers Preferences to everyone (isAgency=%s, base=%s) (mutation: mark it agencyOnly or emit it only with a base -> FAILS)",
  (isAgency, base) => {
    const e = buildPaletteEntries(base, isAgency, false).find((x) => x.id === "nav:preferences");
    expect(e).toMatchObject({ kind: "href", href: "/dashboard/preferences", agencyOnly: false });
    expect(filterEntries([e!], "idioma")).toHaveLength(1);
  });
```

- [ ] **Step 2: Red;** paste lines (`pnpm --filter web exec vitest run src/lib/preferences/preference-options.test.ts src/components/preferences/preference-handlers.test.ts src/lib/palette/registry.test.ts`).
- [ ] **Step 3: Implement.**

`page.tsx` (server): `const { userId, sessionClaims } = await auth(); if (!userId) redirect("/sign-in");` `isAgency` from the claim; `const prefs = await loadMyPreferences();` (throws to `error.tsx`); for a client, the account language from `getTenantAccessState()` (already cached by the layout). Root element `<div data-prefs-page>` (the deploy marker). Renders `<PreferencesPanel isAgency prefs accountLanguage />`.

`PreferencesPanel` (client): `useLocale()` for copy; `useTheme()` and `useRouter()` for `apply`. Two cards on `--surface-1` (the house card component), each a `<fieldset role="radiogroup">` with a `<legend>` (Label role) and native `<input type="radio">` rows styled as choice tiles: `--surface-2` at rest, `--surface-3` hover (150ms), `--accent-dim` + `--line-strong` when checked, the house `:focus-visible` ring, `--radius-ctl`. No `<form>`. Hint lines under each group for the empty state (spec §6). Theme `apply`: `setTheme(v ?? providerFallback)`, and for light/dark write `bis-theme` exactly as `toggleTheme` does (reuse a shared `writeThemeCookie(mode)` exported from `theme-toggle.tsx` if Task 5 adds one; otherwise inline the same string), then `router.refresh()`.

`user-menu.tsx`:

```tsx
"use client";
import { UserButton } from "@clerk/nextjs";
import { SlidersHorizontal } from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";

export function UserMenu() {
  const locale = useLocale();
  return (
    <UserButton>
      <UserButton.MenuItems>
        <UserButton.Link label={t(m, "prefs.menuItem", locale)} labelIcon={<SlidersHorizontal className="size-4" aria-hidden />} href="/dashboard/preferences" />
      </UserButton.MenuItems>
    </UserButton>
  );
}
```

(Confirm `useLocale`'s export name in `components/locale-provider.tsx` before writing; the source wins.) Clerk renders custom items above its own "Manage account" / "Sign out"; Clerk's default items stay.

Registry: one entry pushed right after the nav loop, for every caller:

```ts
entries.push({
  kind: "href", id: "nav:preferences", label: m["prefs.palette"], group: "navigation", agencyOnly: false,
  keywords: ["preferences", "language", "idioma", "español", "spanish", "english", "theme", "dark", "light", "appearance", "my"],
  href: "/dashboard/preferences",
});
```

Copy (every key with `.es`; final words are bis-frontend's, passing the 7 AM read; drafts):

| Key | English | Español |
|---|---|---|
| `prefs.title` | Your preferences | Tus preferencias |
| `prefs.intro` | These are just for you. Nobody else on your team sees them change. | Solo son para ti. Nadie más de tu equipo ve el cambio. |
| `prefs.language.legend` | Language | Idioma |
| `prefs.language.account` | Follow the account | Seguir el idioma de la cuenta |
| `prefs.language.accountHint` | Right now that's {language}. | Ahora mismo es {language}. |
| `prefs.language.agencyEmpty` | English until you pick one. | Inglés hasta que elijas uno. |
| `prefs.theme.legend` | Theme | Tema |
| `prefs.theme.light` / `.dark` / `.system` | Light / Dark / Follow my device | Claro / Oscuro / Seguir mi dispositivo |
| `prefs.theme.empty` | You haven't picked one. You're seeing the {mode} look, the default for your login. | Aún no has elegido. Ves el aspecto {mode}, el predeterminado para tu cuenta. |
| `prefs.saved.language` | Language set to {language}. | Idioma cambiado a {language}. |
| `prefs.saved.theme` | Theme set to {theme}. | Tema cambiado a {theme}. |
| `prefs.undo` | Undo | Deshacer |
| `prefs.undone` | Changed back. | Se deshizo el cambio. |
| `prefs.error.failed` | That didn't save. Try again in a moment. | No se guardó. Inténtalo de nuevo en un momento. |
| `prefs.error.load` | We couldn't load your preferences. Reload the page. | No pudimos cargar tus preferencias. Recarga la página. |
| `prefs.reload` | Reload | Recargar |
| `prefs.menuItem` | Preferences | Preferencias |
| `prefs.palette` | Preferences: language and theme | Preferencias: idioma y tema |

`loading.tsx`: two card skeletons with three tile-shaped bars each. `error.tsx` (`"use client"`, the route boundary): `prefs.error.load` + a ghost Reload button (`router.refresh()`), rendered through `useLocale()`.

- [ ] **Step 4: Green;** paste the summary. Run `src/lib/i18n/ratchet.test.ts` and `src/lib/palette/registry.test.ts`; the ratchet must show no new raw copy and no `prefs.*` key without `.es`. Run `pnpm --filter web typecheck && pnpm --filter web lint`.
- [ ] **Step 5: Mutations** as named, plus: add `<p>Your preferences</p>` raw to `page.tsx` (ratchet FAILS naming the file). Revert.
- [ ] **Step 6: Commit** `feat(design): Preferences page, reached from the user menu and ⌘K, two fields that save at once with undo`.

---

## Task 7: e2e `preferences.spec.ts`

**Owner:** bis-e2e-qa. **Sequential:** after 5 and 6.

Never git stash; any Radix Select inside a form submits via `useFormSubmit`.

**Files**
- Create: `apps/web/e2e/preferences.spec.ts`
- Modify (only if needed): the e2e teardown, to NULL the preferences of every e2e identity it touched

Read first: `e2e/fixtures/clerk-identities.ts`, `e2e/fixtures/test.ts`, `e2e/staff-roles.spec.ts` (how it reads a users row by `clerk_user_id` with a service client), `e2e/palette.spec.ts` (how the palette is opened).

- [ ] **Step 1: Agency, language.** Signed in as the agency (default storage state). Open the UserButton (`.cl-userButtonTrigger`), click the "Preferences" item, expect URL `/dashboard/preferences` and `[data-prefs-page]`. Pick Español. Expect the page title "Tus preferencias" after the refresh. Navigate to the per-run fixture account's dashboard and expect the sidebar group label "Resumen" (`nav.group.overview.es`). Back on Preferences, pick English, expect "Your preferences". Mutation: drop `userLanguage` from `dashboard/layout.tsx`'s `requestLocale` → the sidebar stays "Overview" → FAILS.
- [ ] **Step 2: Undo.** Pick Español, click the toast's "Deshacer", expect the radio back on English (or nothing checked if it started NULL) and the title in English.
- [ ] **Step 3: Agency, theme survives a reload with no flash.** Pick Light. Reload. Read the `class` attribute of `<html>` from the RAW response (`page.request.get(url)` + regex on `<html …class="…"`), not after hydration: the server must paint light (no `dark` class / light tokens), proving `users.theme` reached `getRequestTheme`. Then pick Dark; reload; expect `dark`. Mutation: drop `prefs.theme` from `pickRequestThemeMode`'s call → the raw HTML keeps the cookie's mode → FAILS when the cookie and the choice disagree (set the cookie to the opposite with `context.addCookies` before the reload so the two sources disagree; otherwise the test cannot fail).
- [ ] **Step 4: ⌘K.** Open the palette, type "idioma", expect the Preferences entry, Enter, expect `/dashboard/preferences`.
- [ ] **Step 5: Client branch, only if a client login sits on the per-run fixture** (the staff login from staff-and-roles Task 11 may; the source decides). Expect three language options including "Follow the account" checked by default. If no client login is on the fixture, do NOT use Test Client One's login: skip this step and say so in the report (the unit tests cover the option list).
- [ ] **Step 6: Teardown.** In `afterAll`, set `language = null, theme = null` on every identity the spec changed, keyed on its `clerk_user_id`, through the same service client `staff-roles.spec.ts` uses (loopback stack in CI; bis-ci locally, its own row only). Never touch any other row.
- [ ] **Step 7:** Playwright is the orchestrator's to run (one gate at a time). Hand over the spec; report the mutation evidence the orchestrator gathers.
- [ ] **Step 8: Commit** `test(e2e): a person's own language and theme, from the user menu to the server's first paint`.

---

## Task 8: Rollout (orchestrator; not a coding task)

Never git stash; any Radix Select inside a form submits via `useFormSubmit`.

Before any Supabase MCP call that may show an Accept/Decline prompt, the orchestrator warns danlo first.

- [ ] **Merge prep.** Fetch; merge `main` into the branch; re-run `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` on the combined tree, one at a time. Confirm `0067` is still the next free number; if a lane took it, renumber the file and its header before anything is applied. Check whether any migration that arrived with `main` is already applied before touching a database.
- [ ] **1. CI project.** Warn danlo, then apply `0067_person_preferences.sql` through `ci-project-setup.yml`. The e2e job's `ci-migrations-applied.sh` fails until this is done.
- [ ] **2. Production.** Warn danlo, then apply via MCP `apply_migration` (the SQL has no regex escapes; md5-compare not needed). Verify: `select column_name, data_type from information_schema.columns where table_schema='public' and table_name='users' and column_name='theme'` returns one row; `select conname from pg_constraint where conname='users_theme_check'` returns one row.
- [ ] **3. Parity.** `docs/runbooks/ci-supabase-project.md`'s parity check between bis-ci and production. Record it in the run log.
- [ ] **4. Merge and deploy.** Read the check runs for the head SHA via REST (`gh api repos/{owner}/{repo}/commits/{sha}/check-runs`), merge by REST PUT with `sha` pinned, read the PR state before any retry. Verify the deploy: READY with the merge SHA, aliased to `app.bis-rgv.com`; `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404; the marker `data-prefs-page` in the served HTML of `/dashboard/preferences` for a signed-in person (danlo loads it, or the browser tool with danlo's own session; record which).
- [ ] **5. DESIGN.md** (hot file, orchestrator lands it). In Identity, replace "a person's own stored choice (the `bis-theme` cookie, written on toggle or recorded once from the OS when a tenant says "follow") always outranks either default — F-096's per-person preferences store is where that choice eventually lives." with: "a person's own stored choice always outranks either default: first their `users.theme` (light, dark or follow my device; set on Preferences or by the topbar toggle, F-096, 2026-10-10), then the `bis-theme` cookie (written on toggle, or recorded once from the OS when a tenant or the person says "follow")."
- [ ] **6. Roadmap tracker.** F-096 part 1 done; part 2 (larger text, more contrast) open.
- [ ] **7. Rollback, if needed.** Revert the merge commit through a PR first; only once production runs code that no longer selects `users.theme`, drop the column (`alter table public.users drop column theme;`) on production, then bis-ci, then parity.

---

## Self-review against the design

| Design item | Where |
|---|---|
| D1 migration 0067, `theme` check, NULL = no choice | Task 1 |
| D2 agency row on first save, no membership; team list and syncs ignore it, pinned | Task 2 (save test, `listAccountTeam` assertion, `reconcileMembership` pin); webhook `user.updated` and backfill already skip agency users (`api/webhooks/clerk/route.ts:72`, `backfill/members.ts:57`) |
| D3 own language wins for everyone; defaults agency en, client account | Task 3 (call sites; `requestLocale` already orders it) |
| D4 one cached read, both `LocaleProvider`s and every `requestLocale` | Task 3 (`readStoredPerson` shared with `readStoredRole`; callers test) |
| D5 `users.theme` > cookie > role default; system; toggle writes; cookie in step | Task 5 |
| D6 page, two inline fields, undo toast, user menu (API cited), ⌘K, everyone, `t()` + `.es`, states, keyboard | Task 6 |
| D7 own row, Clerk `userId`, `serviceDb()`, closed list first | Task 4 (+ Task 2's second wall) |
| Out of scope (call summaries, larger text, contrast) | spec §2; nothing in the tasks |
| Rollout CI → production → parity → merge; MCP warning | Task 8 |

## Findings for the ledger (outside this plan's scope)

- A client token can read teammates' `users.theme`, as it already reads `users.language` (`users_member_read`). Harmless; recorded so it is not rediscovered as a leak.
- An agency person's `users.email`/`name` are written at first save and never refreshed (the webhook ignores agency users by design). Harmless today; if an agency row is ever shown anywhere, refresh it there.
- The staff-and-roles fallback creates a missing client membership on the first in-account request; a client who saves a preference on `/dashboard/preferences` before that reads it through the no-membership fallback path (one extra read) until then.
