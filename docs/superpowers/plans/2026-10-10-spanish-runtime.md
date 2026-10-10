# Spanish Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the signed-in dashboard a locale-resolution runtime (user → account → default),
generalise `messages.ts`'s existing `.es`-twin catalogue with a shared `t()`/`plural()` helper and
`es-US` formatters, prove it end-to-end on two small surfaces (sidebar/topbar, dashboard KPI row),
thread it through staff alerts and the AI call summary, and put a build-time ratchet in place so no
new English-only user-facing string ships from today forward.

**Architecture:** No new catalogue format — `messages.ts` keeps its flat `"key"`/`"key.es"` shape
and the three per-feature `STRINGS.en`/`STRINGS.es` files keep theirs. A new `lib/i18n/` module
adds the pieces that are missing: a shared `Locale` type, a pure `resolveLocale(userLanguage,
accountLanguage)` resolver (mirrors `theme-mode.ts`'s `resolveThemeMode` shape), `t()`/`plural()`
lookup+interpolation helpers, `es-US` formatters, a pseudo-locale generator, and the ratchet gate's
source scanner. `accounts.language` is a new nullable column; `users.language` is the parallel
staff-and-roles lane's column (NOT added here) — `resolveLocale`'s first parameter already has the
exact shape (`"en" | "es" | null | undefined`) that column will produce, so no code here changes
when that lane ships.

**Tech Stack:** TypeScript, Next.js App Router (RSC + server actions), Supabase/Postgres
(`@supabase/supabase-js`), Vitest, Playwright (Task 11 only), `Intl` (`NumberFormat`,
`DateTimeFormat`, `RelativeTimeFormat`, `PluralRules`) — no new npm dependency.

## Global Constraints

- Tokens only — no hard-coded colors/radii/shadows in any UI touched by this plan (`DESIGN.md`).
- Bilingual DoD — every UI surface this plan touches renders correctly in English and Spanish,
  survives the pseudo-locale's +35% length, and sets `lang` correctly (`DESIGN.md`, added 2026-10).
- Migrations go to the CI project first, then production, then a parity check — **applied by the
  orchestrator, never the implementer** (CLAUDE.md).
- Agents run only their own task's affected tests locally, by path; CI runs the full suite.
- Every test must be able to fail — each step below names the mutation that would make it fail.
- No `.env` value is parsed by code that can throw (a URL parse once echoed a production secret).

---

## Task 1: `accounts.language` — migration, accessor functions, db test

**Owner:** bis-db-schema
**Parallel:** yes — no dependency on any other task.

**Files:**
- Create: `packages/db/supabase/migrations/NNNN_account_language.sql` (NNNN = the next free
  migration number at implementation time — check the highest number in
  `packages/db/supabase/migrations/` immediately before writing the file; the parallel
  staff-and-roles lane also adds a migration, so re-check right before creating this file even if
  checked earlier the same session)
- Modify: `packages/db/src/accounts.ts` (add `getAccountLanguage`, `setAccountLanguage` beside the
  existing `renameAccount` at line 101)
- Modify: `packages/db/src/index.ts:10-11` (add one export line, additive only)
- Modify: `packages/db/src/test/accounts.test.ts` (add one `describe` block)

**Interfaces:**
- Consumes: `SupabaseClient` (`@supabase/supabase-js`), `emit(db, accountId, type, actorId, data)`
  from `packages/db/src/events.ts` (same signature `renameAccount` already calls at line 108).
- Produces: `export type Locale = "en" | "es"` (re-exported from `@bis/db` for convenience, but the
  CANONICAL `Locale` type lives in `apps/web/src/lib/i18n/locale.ts`, Task 2 — this package's copy
  is a structural duplicate, not the source of truth, because `packages/db` must not import from
  `apps/web`). `getAccountLanguage(db: SupabaseClient, accountId: string): Promise<Locale | null>`.
  `setAccountLanguage(db: SupabaseClient, accountId: string, language: Locale, actorId: string):
  Promise<void>`. Task 5's server action calls `setAccountLanguage`; Task 4's resolver calls
  `getAccountLanguage` (or reads `.language` off the account row it already has — see Task 4).

- [ ] **Step 1: Write the failing db test**

Add to `packages/db/src/test/accounts.test.ts` (same file already imports `serviceDb`,
`createAccount`, and uses the `suffix()`/try-finally cleanup shape seen at lines 14-27):

```ts
import { getAccountLanguage, setAccountLanguage } from "../accounts";

describe("account language", () => {
  it("defaults to null, is settable to 'es', and rejects an invalid value (mutation: drop the check constraint → the invalid-value assertion FAILS)", async () => {
    const db = serviceDb();
    const orgId = `org_test_${suffix()}`;
    const { id } = await createAccount(db, { clerkOrgId: orgId, name: "Test Co", actorId: "user_test" });
    try {
      expect(await getAccountLanguage(db, id)).toBeNull();

      await setAccountLanguage(db, id, "es", "user_test");
      expect(await getAccountLanguage(db, id)).toBe("es");

      const { data: ev } = await db.from("events").select("type, data")
        .eq("account_id", id).eq("type", "account.language_updated").single();
      expect(ev).toMatchObject({ type: "account.language_updated", data: { language: "es" } });

      const { error } = await db.from("accounts").update({ language: "fr" }).eq("id", id);
      expect(error).not.toBeNull();
    } finally {
      await db.from("events").delete().eq("account_id", id);
      await db.from("accounts").delete().eq("id", id);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @bis/db exec vitest run src/test/accounts.test.ts -t "account language" > /tmp/t1.txt 2>&1; cat /tmp/t1.txt`
Expected: FAIL — `getAccountLanguage is not a function` (or a Postgres error that the `language`
column does not exist), not a typo-shaped error. Capture to a file per the Global Constraints'
exit-code note, since `pnpm --filter @bis/db exec vitest` prints a misleading
`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` line after real results.

- [ ] **Step 3: Write the migration**

```sql
-- packages/db/supabase/migrations/NNNN_account_language.sql
alter table public.accounts
  add column language text null
  check (language is null or language in ('en', 'es'));

comment on column public.accounts.language is
  'UI language for this account''s CLIENT-role sessions. NULL = no preference recorded; '
  'resolveLocale() falls through to the default (en). Agency-operator sessions do not read '
  'this column (decision 1, 2026-10-10 Spanish-runtime owner decisions) until the parallel '
  'staff-and-roles lane''s users.language exists.';
```

- [ ] **Step 4: Write the accessor functions**

In `packages/db/src/accounts.ts`, immediately after `renameAccount` (line 109):

```ts
export type Locale = "en" | "es";

export async function getAccountLanguage(
  db: SupabaseClient, accountId: string,
): Promise<Locale | null> {
  const { data, error } = await db.from("accounts")
    .select("language").eq("id", accountId).single();
  if (error) throw new Error(`getAccountLanguage failed: ${error.message}`);
  return (data?.language as Locale | null) ?? null;
}

export async function setAccountLanguage(
  db: SupabaseClient, accountId: string, language: Locale, actorId: string,
): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({ language }).eq("id", accountId).select("id");
  if (error) throw new Error(`setAccountLanguage failed: ${error.message}`);
  if (!data?.length) throw new Error(`setAccountLanguage: no account ${accountId}`);
  await emit(db, accountId, "account.language_updated", actorId, { language });
}
```

In `packages/db/src/index.ts`, add (do not touch line 10 or 11):
```ts
export { getAccountLanguage, setAccountLanguage, type Locale as DbLocale } from "./accounts";
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @bis/db exec vitest run src/test/accounts.test.ts -t "account language" > /tmp/t1.txt 2>&1; cat /tmp/t1.txt`
Expected: PASS — vitest's own summary line reads `Tests  1 passed (1)` for this run (not inferred
from exit code — read the printed summary, per CLAUDE.md's `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`
note).

- [ ] **Step 6: Commit**

```bash
git add packages/db/supabase/migrations/NNNN_account_language.sql packages/db/src/accounts.ts packages/db/src/index.ts packages/db/src/test/accounts.test.ts
git commit -m "db: add accounts.language for the Spanish runtime's account-level default (F-013)"
```

---

## Task 2: Locale core — `Locale` type, `resolveLocale`, `t()`/`plural()`

**Owner:** bis-frontend
**Parallel:** yes — pure TypeScript, no dependency on Task 1.

**Files:**
- Create: `apps/web/src/lib/i18n/locale.ts`
- Create: `apps/web/src/lib/i18n/locale.test.ts`
- Create: `apps/web/src/lib/i18n/t.ts`
- Create: `apps/web/src/lib/i18n/t.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `export type Locale = "en" | "es"`. `export function resolveLocale(userLanguage: Locale
  | null | undefined, accountLanguage: Locale | null | undefined): Locale`. `export function
  t(catalogue: Record<string, string>, key: string, locale: Locale, params?: Record<string, string
  | number>): string`. `export function plural(catalogue: Record<string, string>, baseKey: string,
  count: number, locale: Locale, params?: Record<string, string | number>): string`. Tasks 4, 6, 7,
  8, 9 all import from this file and `t.ts`.

- [ ] **Step 1: Write the failing test for `resolveLocale`**

```ts
// apps/web/src/lib/i18n/locale.test.ts
import { describe, it, expect } from "vitest";
import { resolveLocale } from "./locale";

describe("resolveLocale", () => {
  it("user language wins over account language (mutation: swap the precedence → FAILS, since es!=en)", () => {
    expect(resolveLocale("es", "en")).toBe("es");
  });
  it("account language wins when there is no user language", () => {
    expect(resolveLocale(undefined, "es")).toBe("es");
    expect(resolveLocale(null, "es")).toBe("es");
  });
  it("defaults to en when neither is set (mutation: default to 'es' → FAILS)", () => {
    expect(resolveLocale(undefined, undefined)).toBe("en");
    expect(resolveLocale(null, null)).toBe("en");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/i18n/locale.test.ts > /tmp/t2.txt 2>&1; cat /tmp/t2.txt`
Expected: FAIL — `Cannot find module './locale'` (the file does not exist yet).

- [ ] **Step 3: Implement `locale.ts`**

```ts
// apps/web/src/lib/i18n/locale.ts
//
// Mirrors branding/theme-mode.ts's resolveThemeMode shape on purpose: a
// precedence chain over values that may not exist yet. `userLanguage` is
// the seam for the parallel staff-and-roles lane's `users.language text
// null check (language in ('en','es'))` (spec §5) — every caller in THIS
// lane passes undefined for it; the day that column exists, its reader
// starts passing the real value and this function does not change.
export type Locale = "en" | "es";

function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "es";
}

export function resolveLocale(
  userLanguage: Locale | null | undefined,
  accountLanguage: Locale | null | undefined,
): Locale {
  if (isLocale(userLanguage)) return userLanguage;
  if (isLocale(accountLanguage)) return accountLanguage;
  return "en";
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/i18n/locale.test.ts > /tmp/t2.txt 2>&1; cat /tmp/t2.txt`
Expected: PASS — summary line `Tests  3 passed (3)`.

- [ ] **Step 5: Write the failing test for `t()` and `plural()`**

```ts
// apps/web/src/lib/i18n/t.test.ts
import { describe, it, expect } from "vitest";
import { t, plural } from "./t";

const catalogue: Record<string, string> = {
  "greeting": "Hello, {name}",
  "greeting.es": "Hola, {name}",
  "calls.countOne": "1 call",
  "calls.countOne.es": "1 llamada",
  "calls.count": "{count} calls",
  "calls.count.es": "{count} llamadas",
};

describe("t", () => {
  it("looks up the .es twin and substitutes {params} (mutation: look up key without the .es suffix for es → FAILS, returns English)", () => {
    expect(t(catalogue, "greeting", "es", { name: "Marta" })).toBe("Hola, Marta");
    expect(t(catalogue, "greeting", "en", { name: "Marta" })).toBe("Hello, Marta");
  });
});

describe("plural", () => {
  it("selects the One-suffixed key for count===1, the base key otherwise, per locale (mutation: always return the base key → FAILS at count=1)", () => {
    expect(plural(catalogue, "calls.count", 1, "en")).toBe("1 call");
    expect(plural(catalogue, "calls.count", 1, "es")).toBe("1 llamada");
    expect(plural(catalogue, "calls.count", 3, "en", { count: 3 })).toBe("3 calls");
    expect(plural(catalogue, "calls.count", 3, "es", { count: 3 })).toBe("3 llamadas");
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/i18n/t.test.ts > /tmp/t2b.txt 2>&1; cat /tmp/t2b.txt`
Expected: FAIL — `Cannot find module './t'`.

- [ ] **Step 7: Implement `t.ts`**

```ts
// apps/web/src/lib/i18n/t.ts
//
// Generalises the interpolation every call site in this repo today does by
// hand with `.replace("{x}", value)` (see messages.ts's own callers), and
// the two-key plural convention messages.ts already hand-rolls
// (shell.presence.idleShort / idleShortOne) — same shape, named once.
import type { Locale } from "./locale";

function interpolate(raw: string, params?: Record<string, string | number>): string {
  if (!params) return raw;
  let out = raw;
  for (const [k, v] of Object.entries(params)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

/** Looks up `${key}.es` when locale is "es", falling back to `key` itself
 *  when no Spanish twin exists yet (a ratchet-gate violation to catch, not
 *  a runtime crash to cause). */
export function t(
  catalogue: Record<string, string>,
  key: string,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const raw = locale === "es" ? catalogue[`${key}.es`] ?? catalogue[key] : catalogue[key];
  return interpolate(raw ?? key, params);
}

/** `baseKey` holds the "other" form (e.g. "calls.count" → "{count} calls");
 *  `${baseKey}One` holds the singular (e.g. "calls.countOne" → "1 call").
 *  Both get the SAME .es-suffix treatment `t()` uses. Intl.PluralRules
 *  decides "one" vs "other" per locale's own rules, not a hard-coded
 *  count===1 check — the mechanism generalises past English/Spanish's
 *  shared two-way split even though this catalogue's data does not yet
 *  need a third form. */
export function plural(
  catalogue: Record<string, string>,
  baseKey: string,
  count: number,
  locale: Locale,
  params?: Record<string, string | number>,
): string {
  const category = new Intl.PluralRules(locale === "es" ? "es-US" : "en-US").select(count);
  const key = category === "one" ? `${baseKey}One` : baseKey;
  return t(catalogue, key, locale, params);
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/i18n/t.test.ts > /tmp/t2b.txt 2>&1; cat /tmp/t2b.txt`
Expected: PASS — summary line `Tests  2 passed (2)`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/i18n/locale.ts apps/web/src/lib/i18n/locale.test.ts apps/web/src/lib/i18n/t.ts apps/web/src/lib/i18n/t.test.ts
git commit -m "web: add the locale resolver and t()/plural() catalogue helpers (F-013 part 1)"
```

---

## Task 3: Formatters — `es-US` locale param + `formatRelativeTime`

**Owner:** bis-frontend
**Parallel:** yes — no dependency on Task 1 or 2.

**Files:**
- Modify: `apps/web/src/lib/format.ts`
- Create: `apps/web/src/lib/format.test.ts` (none exists today — every call site is `"en-US"`
  literal, confirmed by reading the file; this task is the first to need assertions here)

**Interfaces:**
- Consumes: `Locale` from `apps/web/src/lib/i18n/locale.ts` (Task 2).
- Produces: `formatCurrency(n: number, locale?: Locale): string`, `formatDate(iso: string, locale?:
  Locale): string`, `formatDateTime(iso: string, locale?: Locale): string`,
  `formatDateInZone(iso: string, timeZone: string, locale?: Locale): string`,
  `formatDateTimeInZone(iso: string, timeZone: string, locale?: Locale): string`,
  `formatDateUTC(iso: string, locale?: Locale): string`, `formatRelativeTime(iso: string, locale?:
  Locale): string` (new). Every parameter defaults to `"en"` so existing call sites keep compiling.
  Task 7 passes `locale` explicitly to `formatCurrency`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/format.test.ts
import { describe, it, expect } from "vitest";
import { formatCurrency, formatDateInZone, formatRelativeTime } from "./format";

describe("formatCurrency", () => {
  it("stays USD in both locales, only the Intl locale tag changes (mutation: use es-MX instead of es-US → this still passes for 1234, so the real guard is the locale-tag assertion below, not the output string alone)", () => {
    expect(formatCurrency(1234)).toBe(formatCurrency(1234, "en"));
    // es-US groups identically to en-US (both use "," thousands/"." decimal) —
    // the two calls below must therefore produce the SAME digits, so a
    // regression to es-MX (which also does) would NOT be caught by string
    // equality. The real assertion is on the Intl call itself:
    const spy = vi.spyOn(Intl, "NumberFormat");
    formatCurrency(1234, "es");
    expect(spy.mock.calls.at(-1)?.[0]).toBe("es-US");
    spy.mockRestore();
  });
});

describe("formatDateInZone", () => {
  it("passes the es-US locale tag through to Intl.DateTimeFormat (mutation: hard-code en-US regardless of the locale param → FAILS)", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    formatDateInZone("2026-10-10T12:00:00Z", "America/Chicago", "es");
    expect(spy.mock.calls.at(-1)?.[0]).toBe("es-US");
    spy.mockRestore();
  });
});

describe("formatRelativeTime", () => {
  it("renders a past instant in Spanish when asked (mutation: ignore the locale param → FAILS, stays 'ago')", () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(formatRelativeTime(fiveMinAgo, "es")).not.toMatch(/ago/i);
  });
});
```

Note: add `import { vi } from "vitest";` to the top import line alongside `describe, it, expect`.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/format.test.ts > /tmp/t3.txt 2>&1; cat /tmp/t3.txt`
Expected: FAIL — `formatRelativeTime is not exported` and the two locale-tag spies assert `"en-US"`
against the expected `"es-US"` (every call site is hard-coded today, confirmed by reading the file).

- [ ] **Step 3: Implement the changes**

In `apps/web/src/lib/format.ts`, add the import and change every formatter's locale tag to depend
on a new trailing `locale` parameter (default `"en"`):

```ts
import type { Locale } from "./i18n/locale";

function tag(locale: Locale): string {
  return locale === "es" ? "es-US" : "en-US";
}

export function formatCurrency(n: number, locale: Locale = "en"): string {
  return new Intl.NumberFormat(tag(locale), {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(n);
}

export function formatDate(iso: string, locale: Locale = "en"): string {
  return new Date(iso).toLocaleDateString(tag(locale), { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string, locale: Locale = "en"): string {
  return new Date(iso).toLocaleString(tag(locale), {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function formatDateTimeInZone(iso: string, timeZone: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDateInZone(iso: string, timeZone: string, locale: Locale = "en"): string {
  return new Intl.DateTimeFormat(tag(locale), {
    timeZone, month: "short", day: "numeric", year: "numeric",
  }).format(new Date(iso));
}

export function formatDateUTC(iso: string, locale: Locale = "en"): string {
  return new Date(iso).toLocaleDateString(tag(locale), {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

/** New — no relative-time formatter existed in this file before this task
 *  (confirmed by grep: zero uses of Intl.RelativeTimeFormat anywhere in the
 *  repo). `numeric: "auto"` so a recent instant reads "today"/"ayer" rather
 *  than "0 days ago"/"hace 0 días". */
export function formatRelativeTime(iso: string, locale: Locale = "en"): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  const rtf = new Intl.RelativeTimeFormat(tag(locale), { numeric: "auto" });
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  return rtf.format(Math.round(diffHr / 24), "day");
}
```

Leave `contactDisplayName` and `initials` untouched — neither formats a locale-sensitive value.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/format.test.ts > /tmp/t3.txt 2>&1; cat /tmp/t3.txt`
Expected: PASS — summary line `Tests  3 passed (3)`.

- [ ] **Step 5: Run the full existing format consumers to confirm no regression**

Run: `pnpm --filter web exec vitest run src/lib > /tmp/t3b.txt 2>&1; tail -20 /tmp/t3b.txt`
Expected: every existing test that calls `formatDate`/`formatCurrency`/etc. with no second
argument still passes (default `"en"` preserves today's output byte-for-byte).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/format.ts apps/web/src/lib/format.test.ts
git commit -m "web: es-US locale param on every date/currency formatter, plus formatRelativeTime (F-013 part 1)"
```

---

## Task 4: Request-locale resolution + `LocaleProvider` + QA override

**Owner:** bis-frontend
**Depends on:** Task 1 (reads `accounts.language`), Task 2 (`resolveLocale`).

**Files:**
- Create: `apps/web/src/lib/i18n/request-locale.ts`
- Create: `apps/web/src/lib/i18n/request-locale.test.ts`
- Create: `apps/web/src/components/locale-provider.tsx`

**Interfaces:**
- Consumes: `resolveLocale` (Task 2), an account row shaped `{ language: Locale | null }` (already
  loaded by every account-scoped screen for branding/timezone — no new query).
- Produces: `export function requestLocale(account: { language: Locale | null } | null | undefined,
  searchParams?: Record<string, string | string[] | undefined>): Locale`. `export function
  LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode })` and `export
  function useLocale(): Locale`. Tasks 6 and 7 call `useLocale()`; Task 11 relies on the `?locale=`
  QA override this task adds.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/i18n/request-locale.test.ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { requestLocale } from "./request-locale";

describe("requestLocale", () => {
  it("reads the account's language when there is no QA override (mutation: ignore account.language → FAILS)", () => {
    expect(requestLocale({ language: "es" })).toBe("es");
    expect(requestLocale({ language: null })).toBe("en");
    expect(requestLocale(null)).toBe("en");
  });

  it("the ?locale= override only applies outside production (mutation: drop the NODE_ENV check → this test FAILS because production would then also honor it)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(requestLocale({ language: "en" }, { locale: "es" })).toBe("en");
    vi.stubEnv("NODE_ENV", "test");
    expect(requestLocale({ language: "en" }, { locale: "es" })).toBe("es");
  });

  afterEach(() => vi.unstubAllEnvs());
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/i18n/request-locale.test.ts > /tmp/t4.txt 2>&1; cat /tmp/t4.txt`
Expected: FAIL — `Cannot find module './request-locale'`.

- [ ] **Step 3: Implement `request-locale.ts`**

```ts
// apps/web/src/lib/i18n/request-locale.ts
//
// The one call site every account-scoped server component/action uses to
// resolve its render locale. `account` is whatever the caller already
// loaded for branding/timezone — this reads one more field off that same
// row, never a second query (same discipline as zone.ts's own doc comment
// on readAgencyZone()'s eager-evaluation trap).
//
// `userLanguage` is NOT a parameter here yet: decision 1 (2026-10-10) scopes
// account.language to CLIENT-role sessions only, and no caller in this
// lane has a user-level language to pass regardless. The day the parallel
// staff-and-roles lane's `users.language` exists AND an operator-role
// caller needs it, that caller passes it into `resolveLocale` directly —
// this wrapper does not need to change to support that, because it is
// deliberately a THIN wrapper around resolveLocale, not resolveLocale
// itself.
import { resolveLocale, type Locale } from "./locale";

function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "es";
}

export function requestLocale(
  account: { language: Locale | null } | null | undefined,
  searchParams?: Record<string, string | string[] | undefined>,
): Locale {
  if (process.env.NODE_ENV !== "production") {
    const raw = searchParams?.locale;
    const override = Array.isArray(raw) ? raw[0] : raw;
    if (isLocale(override)) return override;
  }
  return resolveLocale(undefined, account?.language ?? null);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/i18n/request-locale.test.ts > /tmp/t4.txt 2>&1; cat /tmp/t4.txt`
Expected: PASS — summary line `Tests  2 passed (2)`.

- [ ] **Step 5: Add the client provider (no dedicated unit test — the repo has no `.tsx` render-test
  convention; `stat-tile.tsx`'s own comment notes this, and all the testable logic above is already
  covered by Step 1-4's pure-function tests)**

```tsx
// apps/web/src/components/locale-provider.tsx
"use client";
import { createContext, useContext } from "react";
import type { Locale } from "@/lib/i18n/locale";

const LocaleContext = createContext<Locale>("en");

/** Seeded once from the server's already-resolved value (requestLocale) —
 *  no localStorage, no cookie, no client-only signal to disagree with the
 *  server about. Mis preferencias (F-096, later) is where a REAL client-
 *  side toggle and its own cookie would be added; this lane has none. */
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/i18n/request-locale.ts apps/web/src/lib/i18n/request-locale.test.ts apps/web/src/components/locale-provider.tsx
git commit -m "web: resolve the request's render locale and provide it to client components (F-013 part 1)"
```

---

## Task 5: Account Settings — the one Language field

**Owner:** bis-frontend
**Depends on:** Task 1 (`setAccountLanguage`/`getAccountLanguage`).
**Parallel:** yes, alongside Tasks 4, 8, 9 (all depend only on Task 1).

**Files:**
- Modify: `apps/web/src/components/inline-field.tsx` (add a third, `options`-driven arm to the
  discriminated union; export a pure `validateEnumValue` for the new test)
- Create: `apps/web/src/components/inline-field.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts` (add
  `setAccountLanguageAction`, mirroring `setReportEmailsAction` at line 236)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.test.ts`
  (same file `billing-actions.test.ts` is sibling to — confirm the exact existing filename for
  `actions.ts`'s own tests before adding; if none exists yet, create
  `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.test.ts`)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx` (render
  the new field; this page is agency-only via `requireAgencyOnlyAccountAccess`, confirmed at line
  60 of the current file)

**Interfaces:**
- Consumes: `setAccountLanguage`, `getAccountLanguage` (`@bis/db`, Task 1).
- Produces: `setAccountLanguageAction(accountId: string, formData: FormData): Promise<{ ok: true }
  | { ok: false; error: string }>`. `validateEnumValue(options: { value: string }[], raw: string):
  { ok: true; value: string } | { ok: false; error: string }` (exported from `inline-field.tsx`).

- [ ] **Step 1: Write the failing test for the enum validator**

```ts
// apps/web/src/components/inline-field.test.ts
import { describe, it, expect } from "vitest";
import { validateEnumValue } from "./inline-field";

describe("validateEnumValue", () => {
  it("accepts a listed value, rejects anything else (mutation: drop the .some check and always return ok:true → FAILS the second assertion)", () => {
    const options = [{ value: "en", label: "English" }, { value: "es", label: "Español" }];
    expect(validateEnumValue(options, "es")).toEqual({ ok: true, value: "es" });
    expect(validateEnumValue(options, "fr").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/inline-field.test.ts > /tmp/t5.txt 2>&1; cat /tmp/t5.txt`
Expected: FAIL — `validateEnumValue is not exported`.

- [ ] **Step 3: Extend `inline-field.tsx`**

Change the prop union (currently two arms, lines 58-77) to three arms, and export the new pure
validator. Only the union, the `normalize` line (83-84), and the edit-mode render branch
(174-194) change — `commit()`'s body (91-151) is untouched, since `normalize`'s return SHAPE
(`ValidateResult`) stays identical:

```ts
export function validateEnumValue(
  options: { value: string; label: string }[], raw: string,
): ValidateResult {
  return options.some((o) => o.value === raw)
    ? { ok: true, value: raw }
    : { ok: false, error: m["inline.invalidOption"] };
}

export function InlineField(
  props: (
    | { field: EditableField; required?: undefined; options?: undefined }
    | { field?: undefined; required: true; options?: undefined }
    | { field?: undefined; required?: undefined; options: { value: string; label: string }[] }
  ) & {
    label: string;
    value: string | null;
    save: (value: string) => Promise<{ ok: true; undo?: PhoneInlineUndo } | { ok: false; error: string }>;
    inputType?: "text" | "email" | "tel";
    undoPhone?: InlinePhoneUndoWrite;
  },
) {
  const { label, field, required, options, value, save, inputType = "text", undoPhone } = props;
  const normalize = (raw: string): ValidateResult =>
    options ? validateEnumValue(options, raw)
    : required ? normalizeRequired(raw)
    : normalizeFieldInput(field as EditableField, raw);
  // ... unchanged state/commit() below this line ...
```

In the edit-mode render branch (was a plain `<Input>`), add an `options`-driven `<select>` arm
above the existing `<Input>` return:

```tsx
  if (options) {
    return (
      <select
        autoFocus
        defaultValue={shown}
        aria-label={label}
        className="h-8 rounded-[var(--radius-ctl)] border border-input bg-background px-2 text-sm"
        onBlur={(e) => { if (!cancelled.current) void commit(e.currentTarget.value); cancelled.current = false; }}
        onKeyDown={(e) => { if (e.key === "Escape") { cancelled.current = true; setShown(committed.current); setEditing(false); } }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
```

Add `"inline.invalidOption": "Choose one of the options shown."` and its `.es` twin to
`apps/web/src/lib/messages.ts` beside the existing `inline.*` keys.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/inline-field.test.ts > /tmp/t5.txt 2>&1; cat /tmp/t5.txt`
Expected: PASS — summary line `Tests  1 passed (1)`.

- [ ] **Step 5: Write the failing test for the server action**

```ts
// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.test.ts
// (append; this file's existing imports already cover requireAgencyOnlyAccountAccess mocking —
// follow whatever mocking shape billing-actions.test.ts uses for that same guard)
import { setAccountLanguageAction } from "./actions";

describe("setAccountLanguageAction", () => {
  it("rejects a value outside en/es before touching the database (mutation: drop the guard and pass raw through to setAccountLanguage → FAILS, a Postgres check-constraint error leaks as a 500 instead of this action's own {ok:false})", async () => {
    const fd = new FormData();
    fd.set("language", "fr");
    const result = await setAccountLanguageAction(TEST_ACCOUNT_ID, fd);
    expect(result).toEqual({ ok: false, error: expect.stringContaining("English") });
  });
});
```

(`TEST_ACCOUNT_ID` and the auth-guard mock: use whatever this file's sibling `billing-actions.test.ts`
already sets up for `requireAgencyOnlyAccountAccess` — read that file's actual mock before writing
this, per the Working Rules' "read the source the brief names before you write.")

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.test.ts" -t "setAccountLanguageAction" > /tmp/t5b.txt 2>&1; cat /tmp/t5b.txt`
Expected: FAIL — `setAccountLanguageAction is not exported`.

- [ ] **Step 7: Implement the action and the field**

In `actions.ts`, mirror `setReportEmailsAction` (line 236) exactly in shape:

```ts
import { setAccountLanguage } from "@bis/db";

export async function setAccountLanguageAction(
  accountId: string, formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const raw = String(formData.get("language") ?? "");
  if (raw !== "en" && raw !== "es") {
    return { ok: false, error: "Choose English or Español." };
  }
  await setAccountLanguage(serviceDb(), accountId, raw, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
  return { ok: true };
}
```

In `page.tsx`, add one `InlineField` beside the existing fields in the General area of the page
(the same section `BackToSetup`/`PageHeader` sit in near the top of the current file):

```tsx
<InlineField
  label={m["settings.language.label"]}
  value={account.language ?? "en"}
  options={[
    { value: "en", label: "English" },
    { value: "es", label: "Español" },
  ]}
  save={async (value) => {
    const fd = new FormData(); fd.set("language", value);
    const r = await setAccountLanguageAction(accountId, fd);
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }}
/>
```

Add `"settings.language.label": "Language"` / `.es: "Idioma"` to `messages.ts`. (`account.language`
must be selected by this page's existing account query — add `language` to whatever column list
the page's current `accounts.select(...)` call already names.)

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.test.ts" -t "setAccountLanguageAction" > /tmp/t5b.txt 2>&1; cat /tmp/t5b.txt`
Expected: PASS — summary line `Tests  1 passed (1)`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/inline-field.tsx apps/web/src/components/inline-field.test.ts apps/web/src/lib/messages.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx"
git commit -m "web: one Language field on the account Settings page, writing accounts.language (owner decision 4)"
```

---

## Task 6: Sidebar nav + topbar presence, bilingual

**Owner:** bis-frontend
**Depends on:** Task 2 (`t`/`plural`), Task 4 (`useLocale`).

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx:163,392` (confirmed exact lines)
- Modify: `apps/web/src/components/topbar-presence.tsx`
- Create: `apps/web/src/components/app-sidebar-locale.test.ts` (source-scan test, same shape as the
  existing `dashboard/hero.test.ts`'s raw-file-text scan — this repo has no `.tsx` render-test
  convention, confirmed by `stat-tile.tsx`'s own comment, so the testable surface is the file's
  source text, not a rendered tree)
- Modify: `apps/web/src/lib/messages.ts` (add `.es` twins for every `nav.*` key — confirmed absent
  today by reading lines 1-50)
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/*` (add the EN/ES nav example — DoD)

**Interfaces:**
- Consumes: `useLocale()` (Task 4), `t()` (Task 2).
- Produces: nothing new — this task only converts an existing render path.

- [ ] **Step 1: Write the failing source-scan test**

```ts
// apps/web/src/components/app-sidebar-locale.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "app-sidebar.tsx"), "utf8",
);

describe("app-sidebar nav labels resolve through the locale helper", () => {
  it("no longer looks up m[item.labelKey] or m[group.label] directly (mutation: revert to the raw m[...] lookup → FAILS, both patterns reappear)", () => {
    expect(src).not.toMatch(/m\[item\.labelKey\]/);
    expect(src).not.toMatch(/m\[group\.label\]/);
    expect(src).toMatch(/t\(m, item\.labelKey, locale\)/);
    expect(src).toMatch(/t\(m, group\.label, locale\)/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/app-sidebar-locale.test.ts > /tmp/t6.txt 2>&1; cat /tmp/t6.txt`
Expected: FAIL — both `not.toMatch` assertions fail because today's file DOES contain
`m[item.labelKey]` (line 163) and `m[group.label]` (line 392), confirmed by reading the file.

- [ ] **Step 3: Implement**

In `app-sidebar.tsx`, add `import { useLocale } from "@/components/locale-provider";` and `import
{ t } from "@/lib/i18n/t";`, call `const locale = useLocale();` near the component's other hooks,
then change line 163 from `label: m[item.labelKey]` to `label: t(m, item.labelKey, locale)`, and
line 392 from `{m[group.label]}` to `{t(m, group.label, locale)}`.

In `topbar-presence.tsx`, apply the same `useLocale()` + `t()` substitution wherever it reads
`m["shell.presence.*"]` directly (these keys ALREADY have `.es` twins at `messages.ts:81-88` —
confirmed by reading the file — so this is the first place they become reachable).

In `messages.ts`, add `.es` twins for every `nav.*` key (lines 5-46 of the current file) — e.g.
`"nav.dashboard.es": "Panel"`, `"nav.contacts.es": "Contactos"`, etc. (one line per existing
`nav.*` key; the exact Spanish word list is a copy decision for whoever implements this step, not
a placeholder — write real Spanish, not TBD, and run the ratchet gate's catalogue-parity check from
Task 12 against this file once Task 12 exists to confirm none were missed).

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/app-sidebar-locale.test.ts > /tmp/t6.txt 2>&1; cat /tmp/t6.txt`
Expected: PASS — summary line `Tests  1 passed (1)`.

- [ ] **Step 5: Add the `/styleguide` entry (DoD)**

Add a small EN/ES side-by-side example of the sidebar's nav-label rendering to the styleguide page
(the exact component to extend depends on `/styleguide`'s current section layout — add a new
section titled "Locale" alongside the existing dark/light toggle example, rendering the same nav
item under `LocaleProvider locale="en"` and `locale="es"`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/app-sidebar.tsx apps/web/src/components/topbar-presence.tsx apps/web/src/components/app-sidebar-locale.test.ts apps/web/src/lib/messages.ts "apps/web/src/app/(dashboard)/dashboard/styleguide"
git commit -m "web: sidebar nav and topbar presence render in the resolved locale (F-013 proof surface 1)"
```

---

## Task 7: Dashboard KPI row, bilingual

**Owner:** bis-frontend
**Depends on:** Task 2, Task 3 (`formatCurrency` locale param), Task 4 (`useLocale`/`requestLocale`).

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx:343,
  349-385` (confirmed exact lines)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page-locale.test.ts`
  (source-scan, same shape as Task 6 and the existing `hero.test.ts`)
- Modify: `apps/web/src/lib/messages.ts` (add `.es` twins for `dashboard.kpi.*`, `account.*`,
  `common.allTime` — confirmed absent today)

**Interfaces:**
- Consumes: `requestLocale` (Task 4, this is a server component so it calls the server-side
  resolver directly, not `useLocale`), `t()` (Task 2), `formatCurrency(n, locale)` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Write the failing source-scan test**

```ts
// .../dashboard/page-locale.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8",
);

describe("dashboard KPI row resolves through the locale helper", () => {
  it("formatCurrency is called with a locale argument, and the KPI labels route through t() (mutation: call formatCurrency(currentPipelineValue) with no second arg → FAILS)", () => {
    expect(src).toMatch(/formatCurrency\(currentPipelineValue, locale\)/);
    expect(src).toMatch(/t\(m, "dashboard\.kpi\.last7Days", locale\)/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page-locale.test.ts" > /tmp/t7.txt 2>&1; cat /tmp/t7.txt`
Expected: FAIL — today's file calls `formatCurrency(currentPipelineValue)` with no second argument
and `m["dashboard.kpi.last7Days"]` directly (both confirmed by reading the file at lines 343, 372).

- [ ] **Step 3: Implement**

Add `import { requestLocale } from "@/lib/i18n/request-locale"; import { t } from "@/lib/i18n/t";`
and resolve `const locale = requestLocale(account, await searchParams);` once near the top of the
component (the page already awaits `searchParams` for other reasons — confirm the exact existing
destructure before adding a second `await searchParams` call; merge into the existing one).

Change every `m["dashboard.kpi.*"]`, `m["account.*"]`, and `m["common.allTime"]` read in the block
at lines 343-385 to `t(m, "dashboard.kpi.*", locale)` etc., and line 372's
`formatCurrency(currentPipelineValue)` to `formatCurrency(currentPipelineValue, locale)` (and
`pipelineValueDisplay` at line 173, built from the same `formatCurrency` call, the same way).

Add `.es` twins to `messages.ts` for: `dashboard.kpi.last7Days`, `dashboard.kpi.callsAnswered`,
`dashboard.kpi.leadsCaptured`, `dashboard.kpi.appointmentsBooked`, `dashboard.kpi.afterHoursCaptured`,
`dashboard.kpi.pipelineAdded`, `account.contacts`, `account.openOpps`, `account.pipelineValue`,
`common.allTime` (real Spanish text for each, not a placeholder).

Leave `callsDelta`/`leadsDelta`/`bookingsDelta`/`pipelineDelta`/`afterHoursDelta` (the `StatTileDelta`
objects built earlier in the file) untranslated in THIS task — converting their delta-word
generator is outside the two-screen scope the spec names; note it as a gap for S-10 (F-013 part 2),
not silently skip it without saying so.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page-locale.test.ts" > /tmp/t7.txt 2>&1; cat /tmp/t7.txt`
Expected: PASS — summary line `Tests  1 passed (1)`.

- [ ] **Step 5: Run the existing hero/page tests to confirm no regression**

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard" > /tmp/t7b.txt 2>&1; tail -20 /tmp/t7b.txt`
Expected: `hero.test.ts` and `page.test.ts` still pass — the `<StatTile hero .../>` regex scan
(`hero.test.ts`) is unaffected since no prop on the JSX tag itself changed, only the values fed
into `label`/`value`.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page-locale.test.ts" apps/web/src/lib/messages.ts
git commit -m "web: dashboard KPI row renders in the resolved locale, formatCurrency carries it through (F-013 proof surface 2)"
```

---

## Task 8: Staff SMS alert language wiring

**Owner:** bis-comms
**Depends on:** Task 1 (`accounts.language`), Task 2 (`Locale`/`t`).
**Parallel:** yes, alongside Tasks 4, 5, 9.

**Files:**
- Modify: `apps/web/src/lib/sms/alerts.ts:33-64` (confirmed exact lines — `EMAIL_HINT` constant and
  `composeBookingAlertSms`)
- Modify: `apps/web/src/lib/sms/alerts.test.ts` (existing `composeBookingAlertSms` describe block at
  line 44)
- Modify: `apps/web/src/lib/messages.ts` (new `sms.alert.booking.*` keys with `.es` twins)

**Interfaces:**
- Consumes: `Locale`, `t()` (Task 2).
- Produces: `composeBookingAlertSms(whenCompanyZone: string, contactName: string,
  hasEmailRecipients: boolean, language?: Locale): string` — the 4th parameter is new and optional
  (defaults to `"en"`), so the three existing call sites in `alerts.test.ts` (lines 46, 53, 65, 76)
  keep compiling and keep their current expected output unchanged.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/lib/sms/alerts.test.ts`, inside the existing `describe("composeBookingAlertSms"
, ...)` block (after line 67):

```ts
it("writes in Spanish when the account's language is es (mutation: ignore the 4th param → FAILS, stays 'New booking')", () => {
  const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", "Maria Lopez", true, "es");
  expect(body).toContain("Nueva cita");
  expect(body).not.toContain("New booking");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/sms/alerts.test.ts -t "writes in Spanish" > /tmp/t8.txt 2>&1; cat /tmp/t8.txt`
Expected: FAIL — `composeBookingAlertSms` takes no 4th argument today and always writes "New
booking" (confirmed by reading the function body at line 59).

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/sms/alerts.ts
import { m } from "@/lib/messages";
import { t, type Locale } from "@/lib/i18n/t"; // Locale is re-exported from t.ts's own import of locale.ts — confirm the exact re-export path matches Task 2's file before importing; if t.ts does not re-export Locale, import it from "@/lib/i18n/locale" instead.

export function composeBookingAlertSms(
  whenCompanyZone: string, contactName: string, hasEmailRecipients: boolean, language: Locale = "en",
): string {
  const name = contactName.replace(/[\r\n\t]+/g, " ").trim();
  const withName = t(m, "sms.alert.booking.newBookingWithName", language, { when: whenCompanyZone, name });
  if (segmentsFor(withName).segments <= 1) return withName;
  const fallback = t(m, "sms.alert.booking.newBooking", language, { when: whenCompanyZone });
  return hasEmailRecipients ? `${fallback}${t(m, "sms.alert.booking.emailHint", language)}` : fallback;
}
```

Add to `messages.ts`:
```ts
"sms.alert.booking.newBookingWithName": "New booking: {when} - {name}.",
"sms.alert.booking.newBookingWithName.es": "Nueva cita: {when} - {name}.",
"sms.alert.booking.newBooking": "New booking: {when}.",
"sms.alert.booking.newBooking.es": "Nueva cita: {when}.",
"sms.alert.booking.emailHint": " Check email for details.",
"sms.alert.booking.emailHint.es": " Revise su correo para más detalles.",
```

Every existing call to `composeBookingAlertSms` (3 call sites in `alerts.test.ts`, plus its real
caller) passes no 4th argument, so they resolve `language: Locale = "en"` and must produce
BYTE-IDENTICAL output to before — this is the regression Step 5 checks.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/sms/alerts.test.ts -t "writes in Spanish" > /tmp/t8.txt 2>&1; cat /tmp/t8.txt`
Expected: PASS — summary line `Tests  1 passed (1)`.

- [ ] **Step 5: Run the full existing `composeBookingAlertSms` suite to confirm no regression**

Run: `pnpm --filter web exec vitest run src/lib/sms/alerts.test.ts > /tmp/t8b.txt 2>&1; tail -30 /tmp/t8b.txt`
Expected: every pre-existing test in the file (segment-count, no-phone-number, long-accented-name
fallback, email-hint-conditional) still passes unchanged.

- [ ] **Step 6: Find and update the real caller to pass the account's resolved language**

Find where `composeBookingAlertSms` is called in production code (not just the test) — grep
`composeBookingAlertSms(` outside `alerts.test.ts` — and pass
`resolveLocale(undefined, account.language)` (Task 2) as the 4th argument, using whatever account
row that caller already has in scope.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/sms/alerts.ts apps/web/src/lib/sms/alerts.test.ts apps/web/src/lib/messages.ts
git commit -m "comms: booking alert SMS writes in the account's resolved language (F-013 AI/alerts in reader's language)"
```

---

## Task 9: Voice call-summary language wiring

**Owner:** bis-voice
**Depends on:** Task 1, Task 2.
**Parallel:** yes, alongside Tasks 4, 5, 8.

**Files:**
- Modify: `apps/web/src/lib/voice/summary-service.ts:34-55` (confirmed exact lines — the
  `generateSummary` signature and its `systemRules` array)
- Modify: `apps/web/src/lib/voice/summarize.test.ts` (or wherever `generateSummary` is tested today
  — confirm the exact file before editing; `summarize.test.ts` is the closest-named sibling)

**Interfaces:**
- Consumes: `Locale` (Task 2).
- Produces: `generateSummary(state: CallState, opts?: { timezone?: string; fetchImpl?: typeof fetch;
  language?: Locale }): Promise<string>` — `language` is new and optional; omitting it preserves
  today's English-only instruction exactly.

**Explicitly NOT in this task** (same "convert only enough to prove the runtime" scope the spec
draws): `call-card.ts`'s ALREADY-WRITTEN `.es` twins (confirmed at line 118) do not become reachable
here — rendering the call detail page bilingually is not one of this lane's two proof screens, and
wiring the GENERATION language is a separate, smaller, and sufficient proof that the seam works.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/voice/summarize.test.ts (append; confirm this is generateSummary's real test
// home before editing — if generateSummary has its own dedicated test file instead, use that one)
import { generateSummary } from "./summary-service";

describe("generateSummary language", () => {
  it("asks the model to write in Spanish when opts.language is 'es' (mutation: drop the opts?.language branch → FAILS, the instruction always says English)", async () => {
    const calls: unknown[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ choices: [{ message: { content: "..." } }] }) } as Response;
    }) as typeof fetch;
    process.env.OPENAI_API_KEY = "test-key";
    await generateSummary(SOME_NON_SPAM_CALL_STATE, { fetchImpl, language: "es" });
    const body = calls[0] as { messages: { role: string; content: string }[] };
    const systemMsg = body.messages.find((m) => m.role === "system")!.content;
    expect(systemMsg).toMatch(/español/i);
    expect(systemMsg).not.toMatch(/Always write the summary in English/);
  });
});
```

(`SOME_NON_SPAM_CALL_STATE`: use whatever fixture `summarize.test.ts`'s existing non-spam tests
already construct — read that file's existing `CallState` fixture before writing this, rather than
inventing a new one; the exact shape of the chat-completions request body — whether it's
`body.messages` or a differently-named field — must also be read off `summary-service.ts`'s actual
`fetchImpl` call below line 55, not assumed.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/voice/summarize.test.ts -t "generateSummary language" > /tmp/t9.txt 2>&1; cat /tmp/t9.txt`
Expected: FAIL — the system message always contains "Always write the summary in English" today
(confirmed at line 55) regardless of any `opts` passed.

- [ ] **Step 3: Implement**

In `summary-service.ts`, add `language?: Locale` to the `opts` type (line 35) and change the
hard-coded rule (line 55) to a conditional push:

```ts
import type { Locale } from "@/lib/i18n/locale";

export async function generateSummary(
  state: CallState,
  opts?: { timezone?: string; fetchImpl?: typeof fetch; language?: Locale },
): Promise<string> {
  // ...unchanged spam short-circuit and apiKey read...
  const systemRules = [
    "Summarize this front-desk call for staff in 3-4 sentences.",
    "The BOOKED and INTAKE sections are the system's own records and are authoritative.",
    "Only state that an appointment was booked if BOOKED lists one; if BOOKED is (none), say plainly that no appointment was recorded.",
    "Only state that contact details were captured if INTAKE lists them; if INTAKE is (none), say plainly that none were captured.",
    "If the caller asked for something the records do not show, say what they asked for and that it was not completed — do not describe it as done.",
    "Never invent names, phone numbers, email addresses or times that do not appear in the input.",
    opts?.language === "es"
      ? "Escribe el resumen en español (es para el personal), sin importar el idioma en que se habló la llamada."
      : "Always write the summary in English (it is staff-facing), regardless of the language spoken on the call.",
  ];
  // ...unchanged timezone rule push and fetch call below...
```

Note: this instruction text is a PROMPT to the model, never rendered to a human, so it does not go
through `messages.ts`/`t()` and is not subject to the Task 12 ratchet gate — it is plain conditional
TypeScript, same as the existing `opts?.timezone` branch two lines below it.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/voice/summarize.test.ts -t "generateSummary language" > /tmp/t9.txt 2>&1; cat /tmp/t9.txt`
Expected: PASS — summary line `Tests  1 passed (1)`.

- [ ] **Step 5: Run the full existing `generateSummary`/`summarize` suite to confirm no regression**

Run: `pnpm --filter web exec vitest run src/lib/voice/summarize.test.ts src/lib/voice/finish-call.test.ts > /tmp/t9b.txt 2>&1; tail -30 /tmp/t9b.txt`
Expected: every pre-existing test (spam short-circuit, timezone rule, fallback-to-`""` on a failed
fetch) still passes — omitting `language` entirely preserves today's exact English instruction.

- [ ] **Step 6: Find and update the real caller to pass the account's resolved language**

Grep `generateSummary(` outside test files, and pass `language: resolveLocale(undefined,
account.language)` using whichever account row that caller already has.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/voice/summary-service.ts apps/web/src/lib/voice/summarize.test.ts
git commit -m "voice: call summary prompt writes in the account's resolved language, customer quotes untouched (F-013 AI/alerts in reader's language)"
```

---

## Task 10: Pseudo-locale generator + accents-in-capitals guard

**Owner:** bis-frontend
**Parallel:** yes — no dependency on any other task.

**Files:**
- Create: `apps/web/src/lib/i18n/pseudo-locale.ts`
- Create: `apps/web/src/lib/i18n/pseudo-locale.test.ts`
- Create: `apps/web/src/lib/i18n/accents-guard.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `export function pseudoLocale(text: string): string`. Task 11 applies this to the two
  proof screens' rendered strings.

- [ ] **Step 1: Write the failing test for `pseudoLocale`**

```ts
// apps/web/src/lib/i18n/pseudo-locale.test.ts
import { describe, it, expect } from "vitest";
import { pseudoLocale } from "./pseudo-locale";

describe("pseudoLocale", () => {
  it("pads length by at least 35% and wraps in brackets so truncation is visible (mutation: return the text unchanged → FAILS both assertions)", () => {
    const out = pseudoLocale("Dashboard");
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil("Dashboard".length * 1.35));
    expect(out.startsWith("[")).toBe(true);
    expect(out.endsWith("]")).toBe(true);
  });

  it("accents every vowel so font-coverage gaps are visible (mutation: skip the accent substitution → this test's /[ÁÉÍÓÚ]/ match FAILS)", () => {
    expect(pseudoLocale("Dashboard")).toMatch(/[ÁÉÍÓÚáéíóú]/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/i18n/pseudo-locale.test.ts > /tmp/t10.txt 2>&1; cat /tmp/t10.txt`
Expected: FAIL — `Cannot find module './pseudo-locale'`.

- [ ] **Step 3: Implement `pseudo-locale.ts`**

```ts
// apps/web/src/lib/i18n/pseudo-locale.ts
//
// A synthetic third "locale" for F-014's overflow check only — never shown
// to a real user, never translated by a human, so it can never drift from
// real Spanish copy the way a stale translation could. Accented vowels
// stress font glyph coverage; the bracket wrapper makes truncation visible
// in a screenshot that a plain length increase would not.
const ACCENTS: Record<string, string> = { a: "á", e: "é", i: "í", o: "ó", u: "ú" };
const PAD_WORDS = ["Ẋẋ", "Ṿṿ"];

export function pseudoLocale(text: string): string {
  const accented = text.replace(/[aeiou]/gi, (ch) => {
    const lower = ACCENTS[ch.toLowerCase()];
    if (!lower) return ch;
    return ch === ch.toUpperCase() ? lower.toUpperCase() : lower;
  });
  let out = accented;
  let i = 0;
  while (out.length < Math.ceil(text.length * 1.35) + 2) {
    out = `${out} ${PAD_WORDS[i % PAD_WORDS.length]}`;
    i += 1;
  }
  return `[${out}]`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/i18n/pseudo-locale.test.ts > /tmp/t10.txt 2>&1; cat /tmp/t10.txt`
Expected: PASS — summary line `Tests  2 passed (2)`.

- [ ] **Step 5: Write the failing accents-in-capitals guard test**

```ts
// apps/web/src/lib/i18n/accents-guard.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const LABEL_ROLE_FILES = [
  "../../components/app-sidebar.tsx",
  "../../components/stat-tile.tsx",
].map((p) => path.join(here, p));

describe("Label-role rendering never imports the diacritic-stripping keyword matcher", () => {
  it("app-sidebar.tsx and stat-tile.tsx do not import consent/keywords.ts or consent/phrases.ts (mutation: import normalizeKeyword from consent/keywords.ts for 'display tidiness' → FAILS, catching exactly the defect F-014 names)", () => {
    for (const file of LABEL_ROLE_FILES) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/consent\/keywords/);
      expect(src, file).not.toMatch(/consent\/phrases/);
    }
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/i18n/accents-guard.test.ts > /tmp/t10b.txt 2>&1; cat /tmp/t10b.txt`
Expected: this test actually PASSES immediately against today's code (neither file imports the
stripper yet) — per the Global Constraints' "every test must be able to fail" rule, a test that
passes on first run without ever having been red is not evidence. **Before trusting it, invert it
once as a manual check**: temporarily add `import { normalizeKeyword } from "@/lib/consent/keywords";`
to `app-sidebar.tsx`, re-run, confirm it goes RED naming that file, then revert the temporary
import. Record the inverted-run's red line in the task's own report; do not skip this step because
the test "obviously" works.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/i18n/pseudo-locale.ts apps/web/src/lib/i18n/pseudo-locale.test.ts apps/web/src/lib/i18n/accents-guard.test.ts
git commit -m "web: pseudo-locale generator and the accents-in-capitals import guard (F-014)"
```

---

## Task 11: Overflow check on the two proof screens

**Owner:** bis-e2e-qa
**Depends on:** Task 10 (`pseudoLocale`), Task 6, Task 7 (the two converted screens), Task 4 (the
`?locale=` QA override).

**Files:**
- Create: `apps/web/e2e/i18n-overflow.spec.ts`

**Interfaces:**
- Consumes: the `?locale=` override on any account-scoped route (Task 4); Tasks 6 and 7's converted
  sidebar and dashboard KPI row.
- Produces: nothing other code depends on — this is a measurement gate, not a library.

- [ ] **Step 1: Write the failing Playwright spec**

```ts
// apps/web/e2e/i18n-overflow.spec.ts
import { test, expect } from "@playwright/test";

// `?locale=pseudo` is a THIRD override value this task adds to Task 4's
// requestLocale alongside "en"/"es" — it renders every t()-routed string
// through pseudoLocale() instead of looking it up in the catalogue. See
// Step 3 below for the one-line addition requestLocale needs; this spec is
// written RED against the override not existing yet, same as every other
// task in this plan.
test("sidebar Label-role nav text does not clip under the pseudo-locale", async ({ page }) => {
  await page.goto("/dashboard/accounts/TEST_ACCOUNT_ID/dashboard?locale=pseudo");
  const labels = page.locator("[data-nav-label]");
  const count = await labels.count();
  for (let i = 0; i < count; i++) {
    const box = await labels.nth(i).boundingBox();
    const scrollWidth = await labels.nth(i).evaluate((el) => el.scrollWidth);
    expect(scrollWidth, `nav label ${i} overflows its box`).toBeLessThanOrEqual(Math.ceil(box!.width) + 1);
  }
});

test("dashboard KPI tiles do not clip under the pseudo-locale", async ({ page }) => {
  await page.goto("/dashboard/accounts/TEST_ACCOUNT_ID/dashboard?locale=pseudo");
  const tiles = page.locator("[data-slot='stat-tile']");
  const count = await tiles.count();
  for (let i = 0; i < count; i++) {
    const el = tiles.nth(i);
    const [scrollW, clientW] = await el.evaluate((n) => [n.scrollWidth, n.clientWidth]);
    expect(scrollW, `stat tile ${i} overflows its card`).toBeLessThanOrEqual(clientW);
  }
});
```

(`TEST_ACCOUNT_ID`, `[data-nav-label]`, `[data-slot='stat-tile']`: use this repo's own fixture
account and confirm the exact `data-*` hooks already on `app-sidebar.tsx`'s nav link and
`stat-tile.tsx`'s root element before writing this — add either attribute in Task 6/7 if neither
exists yet, rather than guessing a selector here. CLAUDE.md's own measurement discipline: "grep its
HTML for a marker only your branch emits" before trusting what the page served.)

- [ ] **Step 2: Add the `pseudo` override to `requestLocale` (Task 4's file, additive)**

```ts
// apps/web/src/lib/i18n/request-locale.ts — extend the override check only:
const PSEUDO_FLAG = "__pseudo__";
// ...inside requestLocale, before `return resolveLocale(...)`:
if (process.env.NODE_ENV !== "production" && override === PSEUDO_FLAG) return "en"; // locale stays "en" for formatter purposes; t() itself detects pseudo mode separately (see t.ts's own pseudo branch, added here too) — OR, simpler and preferred: widen Locale's render-time type for t() callers to accept a third literal "pseudo" that is never a value resolveLocale returns on its own, only ever a QA override.
```

This step is intentionally sketched rather than fully specified here: whether `"pseudo"` becomes a
third member of a QA-only type, or `t()` grows a separate `pseudoLocale()`-wrapping call path, is an
implementation choice for whoever executes this task — confirm against Task 4's actual committed
code (which may have evolved since this plan was written) before choosing, and write the real
decision into `request-locale.ts`'s own doc comment, not left as this plan's placeholder.

- [ ] **Step 3: Run it to verify it fails**

Run (from `apps/web`): `pnpm exec playwright test e2e/i18n-overflow.spec.ts > /tmp/t11.txt 2>&1; tail -40 /tmp/t11.txt`
Expected: FAIL — either the `?locale=pseudo` override does nothing yet (strings render in English,
no overflow to measure, so the test's own setup is wrong) or the `data-*` selectors do not exist
yet. Per CLAUDE.md: do not run this against a stale `next start` — build fresh for this measurement,
and this agent is the one authorized to run Playwright per the brief.

- [ ] **Step 4: Fix the override and the selectors until green**

Add `data-nav-label` to the nav link's label span in `app-sidebar.tsx` (Task 6) and confirm
`stat-tile.tsx`'s root element already carries `data-slot="stat-tile"` (if it carries a different
`data-slot` value, use that exact value here instead of guessing).

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm exec playwright test e2e/i18n-overflow.spec.ts > /tmp/t11.txt 2>&1; tail -40 /tmp/t11.txt`
Expected: PASS — Playwright's own summary line, e.g. `2 passed (Xs)`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/i18n-overflow.spec.ts apps/web/src/lib/i18n/request-locale.ts
git commit -m "e2e: pseudo-locale overflow check on the two Spanish-runtime proof screens (F-014)"
```

---

## Task 12: The ratchet gate — raw-literal scanner, baseline, allowlist

**Owner:** bis-frontend
**Depends on:** every other task's file changes exist, so the committed baseline reflects the real
end state (Tasks 6 and 7's converted files should show near-zero counts; everything else keeps its
current count). Structurally it could run earlier with a looser baseline, but is placed last so its
first commit is accurate, not provisional.

**Files:**
- Create: `apps/web/src/lib/i18n/ratchet-scan.ts` (the scanner, TypeScript-compiler-API-based per
  the owner-approved spec, to avoid the false positives a regex pass over JSX text produces)
- Create: `apps/web/src/lib/i18n/ratchet-baseline.json` (generated, not hand-written)
- Create: `apps/web/scripts/generate-i18n-baseline.ts` (the regeneration script)
- Create: `apps/web/src/lib/i18n/ratchet.test.ts`

**Interfaces:**
- Consumes: TypeScript's own compiler API (`typescript` package — already a transitive dependency
  via `next`/`tsc`; confirm it is resolvable as a direct import before relying on it, and add it to
  `apps/web/package.json`'s `dependencies` explicitly if it is not already there as a direct one).
- Produces: `export function scanFile(filePath: string, source: string): number` (count of
  un-catalogued JSX text/string-literal nodes). `export function countsByFile(rootDirs: string[],
  allowlistFiles: RegExp[]): Record<string, number>`. Nothing downstream depends on these — this is
  the terminal task.

- [ ] **Step 1: Write the failing test for `scanFile`**

```ts
// apps/web/src/lib/i18n/ratchet.test.ts
import { describe, it, expect } from "vitest";
import { scanFile } from "./ratchet-scan";

describe("scanFile", () => {
  it("counts a raw JSX text literal as 1, and a t()-routed string as 0 (mutation: count every string literal including className values → FAILS the second assertion, since 'px-2' would then count)", () => {
    const withLiteral = `export function X() { return <p className="px-2">Loading your calls</p>; }`;
    expect(scanFile("x.tsx", withLiteral)).toBe(1);

    const withCatalogue = `export function X() { return <p className="px-2">{t(m, "x.loading", locale)}</p>; }`;
    expect(scanFile("x.tsx", withCatalogue)).toBe(0);
  });

  it("reverting a real translated string back to a literal is caught by name (mutation check per the brief: delete the .es twin AND hard-code the English string back into the JSX → the live count for that file now exceeds its baseline entry, which is exactly what Step 5's ratchet test below asserts)", () => {
    const reverted = `export function X() { return <p>Loading your calls</p>; }`;
    expect(scanFile("x.tsx", reverted)).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts > /tmp/t12.txt 2>&1; cat /tmp/t12.txt`
Expected: FAIL — `Cannot find module './ratchet-scan'`.

- [ ] **Step 3: Implement `ratchet-scan.ts`**

```ts
// apps/web/src/lib/i18n/ratchet-scan.ts
//
// AST-based, not regex, per the owner-approved spec's reasoning: a regex
// over JSX text produces false positives on className strings, numeric
// literals and aria-hooks, and false positives are how a ratchet gate gets
// disabled in frustration instead of fixed.
import ts from "typescript";

const ALLOWED_ATTRIBUTE_NAMES = new Set(["className", "data-testid", "data-slot", "href", "type", "name"]);

export function scanFile(filePath: string, source: string): number {
  const sf = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let count = 0;

  function visit(node: ts.Node) {
    if (ts.isJsxText(node) && node.text.trim().length > 0) {
      count += 1;
    }
    if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const attrName = node.name.getText(sf);
      if (!ALLOWED_ATTRIBUTE_NAMES.has(attrName)) count += 1;
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  return count;
}

export function countsByFile(rootDirs: string[], allowlistFiles: RegExp[]): Record<string, number> {
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const out: Record<string, number> = {};
  function walk(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!full.endsWith(".tsx") || full.endsWith(".test.tsx")) continue;
      if (allowlistFiles.some((re) => re.test(full))) continue;
      out[full] = scanFile(full, fs.readFileSync(full, "utf8"));
    }
  }
  for (const root of rootDirs) walk(root);
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts > /tmp/t12.txt 2>&1; cat /tmp/t12.txt`
Expected: PASS — summary line `Tests  2 passed (2)`.

- [ ] **Step 5: Write the failing baseline-ratchet test**

```ts
// append to ratchet.test.ts
import baseline from "./ratchet-baseline.json";
import { countsByFile } from "./ratchet-scan";
import path from "node:path";

// Decision 2 (2026-10-10): agency-only top-level routes are excluded
// entirely from the scan, not frozen-but-included — DESIGN.md's bilingual
// DoD line is itself qualified ("once a surface carries bilingual copy at
// all"), and these routes are internal tooling with no bilingual intent.
const AGENCY_ONLY_ALLOWLIST = [
  /dashboard[\\/]accounts[\\/]page\.tsx$/,
  /dashboard[\\/]blueprints[\\/]/,
  /dashboard[\\/]work[\\/]/,
  /dashboard[\\/]billing[\\/]/,
];

describe("the i18n ratchet", () => {
  it("no file's live raw-literal count exceeds its committed baseline (mutation: revert Task 6's app-sidebar.tsx edit back to m[item.labelKey] → app-sidebar.tsx's live count rises above its baseline entry of 0, FAILS by that file's name)", () => {
    const live = countsByFile(
      [path.join(__dirname, "../../app"), path.join(__dirname, "../../components")],
      AGENCY_ONLY_ALLOWLIST,
    );
    for (const [file, count] of Object.entries(live)) {
      const allowed = (baseline as Record<string, number>)[file] ?? 0;
      expect(count, `${file}: live ${count} > baseline ${allowed}`).toBeLessThanOrEqual(allowed);
    }
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts -t "the i18n ratchet" > /tmp/t12b.txt 2>&1; cat /tmp/t12b.txt`
Expected: FAIL — `ratchet-baseline.json` does not exist yet (module not found), or exists empty
and every file with a nonzero live count fails by name.

- [ ] **Step 7: Write the generator script and run it once**

```ts
// apps/web/scripts/generate-i18n-baseline.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import { countsByFile } from "../src/lib/i18n/ratchet-scan";

const AGENCY_ONLY_ALLOWLIST = [
  /dashboard[\\/]accounts[\\/]page\.tsx$/,
  /dashboard[\\/]blueprints[\\/]/,
  /dashboard[\\/]work[\\/]/,
  /dashboard[\\/]billing[\\/]/,
];

const counts = countsByFile(
  [path.join(__dirname, "../src/app"), path.join(__dirname, "../src/components")],
  AGENCY_ONLY_ALLOWLIST,
);
writeFileSync(
  path.join(__dirname, "../src/lib/i18n/ratchet-baseline.json"),
  JSON.stringify(counts, null, 2) + "\n",
);
console.log(`Wrote ${Object.keys(counts).length} file entries.`);
```

Run: `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`
This writes the real baseline — the only step in this plan whose output is NOT hand-authored, by
design (a count-based ratchet per decision 5 regenerates mechanically, never hand-edited to admit a
new violation).

- [ ] **Step 8: Run the ratchet test to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts -t "the i18n ratchet" > /tmp/t12b.txt 2>&1; cat /tmp/t12b.txt`
Expected: PASS — summary line `Tests  1 passed (1)`.

- [ ] **Step 9: Confirm `pnpm check` collects this test**

Run: `pnpm --filter web exec vitest run src/lib/i18n > /tmp/t12c.txt 2>&1; tail -20 /tmp/t12c.txt`
Expected: all of Tasks 2, 10, and 12's tests appear in one run (proves `vitest.config.ts`'s
`include: ["src/**/*.test.ts", …]` picks this directory up with no config change, so `pnpm check`
→ `pnpm test` → this package's `vitest run` already covers it).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/i18n/ratchet-scan.ts apps/web/src/lib/i18n/ratchet-baseline.json apps/web/src/lib/i18n/ratchet.test.ts apps/web/scripts/generate-i18n-baseline.ts apps/web/package.json
git commit -m "web: the i18n ratchet gate — AST scanner, generated baseline, agency-only route allowlist (F-012)"
```

---

## Parallelization summary

- **Wave 1 (no dependencies, run together):** Task 1 (bis-db-schema), Task 2 (bis-frontend),
  Task 3 (bis-frontend), Task 10 (bis-frontend).
- **Wave 2 (depend only on Wave 1):** Task 4 (bis-frontend, needs 1+2), Task 5 (bis-frontend, needs
  1), Task 8 (bis-comms, needs 1+2), Task 9 (bis-voice, needs 1+2) — all four independent of each
  other, run together.
- **Wave 3 (depend on Wave 2):** Task 6 (bis-frontend, needs 2+4), Task 7 (bis-frontend, needs
  2+3+4) — independent of each other, run together.
- **Wave 4:** Task 11 (bis-e2e-qa, needs 10+6+7+4), Task 12 (bis-frontend, needs the whole tree's
  final state for an accurate baseline) — run together once Wave 3 lands.

## Self-review against the spec

**Coverage.** Architecture/catalogue shape → Task 2. Locale resolution order → Task 2 (resolver) +
Task 4 (where it's read, server/client) + the staff-and-roles seam note in Task 1/2/4. Formatters →
Task 3. Ratchet gate (detection/baseline/allowlist/where it runs/how it fails) → Task 12. Pseudo-
locale + overflow check → Tasks 10 and 11. Accents-in-capitals / Label line-height → Task 10's guard
test (line-height itself is a CSS value with no logic to unit-test; flagged in Task 11 as a
screenshot item for bis-e2e-qa, not silently dropped). AI output and alerts → Tasks 8 (SMS) and 9
(voice summary), both explicit that the customer's own verbatim quote and the customer-facing S-09
path are untouched. Data (accounts.language, described not applied) → Task 1, migration file
written with no number hard-coded. Screens converted → Tasks 6 and 7, matching the spec's own
recommendation exactly. Owner decisions 1-6 → decision 1 encoded directly in Task 4's doc comment
and Task 1's column comment (client-role only); decision 2/6 encoded in Task 12's
`AGENCY_ONLY_ALLOWLIST`; decision 3 is `resolveLocale`'s own default in Task 2; decision 4 is Task
5 in full; decision 5 is Task 12's count-based (not hash-based) baseline.

**Placeholder scan.** No "TBD"/"fill in details" strings found, with one exception flagged
honestly rather than hidden: Task 11 Step 2 is explicitly left as a sketch because it depends on a
choice inside Task 4's code that may evolve between when this plan is written and when Task 11 is
executed — the plan says so outright and tells the implementer what to confirm, rather than
asserting a signature this plan cannot verify yet. Every other step has complete code.

**Type/name consistency, checked task-to-task:** `Locale` — defined once in `lib/i18n/locale.ts`
(Task 2), imported by name in Tasks 1 (db package's own structurally-identical copy, explicitly
NOT the same binding, noted in Task 1), 3, 4, 8, 9. `resolveLocale(userLanguage, accountLanguage)`
— same parameter order and names used in Task 2's definition and every later task's prose
description. `t(catalogue, key, locale, params?)` and `plural(catalogue, baseKey, count, locale,
params?)` — defined in Task 2, called with that exact argument order in Tasks 6, 7, 8. `useLocale()`
/ `LocaleProvider` — defined in Task 4, consumed by name in Task 6. `requestLocale(account,
searchParams?)` — defined in Task 4, consumed in Task 7 and extended (not redefined) in Task 11.
`getAccountLanguage`/`setAccountLanguage` — defined in Task 1, consumed by name in Task 5 (and
Tasks 4/8/9's "real caller" steps, which read `.language` off an already-loaded row rather than
calling `getAccountLanguage` again — consistent with Task 4's own no-extra-query reasoning). One
inconsistency found and fixed inline during this review: Task 1's first draft exported `Locale`
unqualified from `@bis/db`, which would collide with the app's own `Locale` import at every call
site that imports both packages — fixed to export it as `DbLocale` (Task 1, Step 4) and the plan's
later tasks were checked to confirm none of them actually import the db package's copy at all; they
all import `Locale` from `apps/web/src/lib/i18n/locale.ts` only.
