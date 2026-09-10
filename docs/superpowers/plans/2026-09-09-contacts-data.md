# Contacts Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The contacts list can hold, receive and release a real client's data — paging past 100 rows, CSV import with mapping and preview, CSV export of the current view.

**Architecture:** Paging follows the `?before=` cursor idiom `calls` already uses, with the cursor widened to a `(created_at, id)` tuple because an import creates thousands of rows inside one millisecond. The CSV is parsed in the browser (Papa Parse) and committed through a Server Action in batches of 200, so a 20k-row file never meets Next's Server Action body cap; the server re-validates every row. Import builds its duplicate-match index once per job rather than calling the existing per-row `findDuplicate`, which is O(n²) at import scale.

**Tech Stack:** Next.js App Router (Server Components + Server Actions), Supabase JS, TypeScript, Vitest, Playwright, Tailwind v4. One new dependency: `papaparse` + `@types/papaparse`.

**Spec:** `docs/superpowers/specs/2026-09-09-contacts-data-design.md`

## Global Constraints

- **Repo is PR-only.** Never push `main`. Branch → PR → merge only when CI `verify` AND `e2e` are green on the PR's current head.
- **Tokens only** for any UI — no hard-coded colors/radii/shadows. `DESIGN.md` governs. Radii are 8px (controls) / 12px (cards) / 999px (pills); spacing on a 4px grid.
- **Copy lives in `apps/web/src/lib/messages.ts`.** No user-visible string inline in a component. Copy passes the "landscaper at 7 AM" read; never expose internal milestone codes or template syntax.
- **TDD.** Every test watched failing for the right reason before implementation. A green suite proves nothing a mutation check hasn't.
- **`pnpm check` is the gate** (typecheck + lint + db + web tests) — run the whole suite, never a targeted subset, before claiming green. **Never pipe it** (`pnpm check | tail` reports `tail`'s exit code); redirect to a file and read `$?`.
- **e2e shares ONE Supabase project with production.** Mutating specs use the per-run fixture account — never `Test Client One` or any live account.
- **`serviceDb` test fixtures are blind to column grants.** Grant-sensitive assertions need `withRollback` + `actAs` or e2e, and must pin the SQLSTATE (`42501`), never `status >= 400`.
- **No migration in this plan.** Every field already exists on `contacts`, including the `custom` jsonb.

---

## File Structure

**Created**
- `apps/web/src/lib/cursor.ts` — shared cursor encode/parse, tuple-aware. Extracted from `calls/page.tsx`.
- `apps/web/src/lib/cursor.test.ts`
- `apps/web/src/lib/contacts/csv.ts` — pure CSV shaping: header auto-match, row→`ContactInput`, validation, error rows. No I/O, no React.
- `apps/web/src/lib/contacts/csv.test.ts`
- `packages/db/src/contact-import.ts` — `buildMatchIndex`, `applyImportBatch`. Server-only.
- `packages/db/src/test/contact-import.test.ts`
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/page.tsx` — the import screen (upload → map → preview → commit).
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/import-wizard.tsx` — client component driving the three steps.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/actions.ts` — `importContactsBatchAction`.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/route.ts` — streaming CSV Route Handler.
- `apps/web/e2e/contacts-data.spec.ts`

**Modified**
- `packages/db/src/contacts.ts` — `listContacts` takes a tuple cursor; `countContacts` takes `search`.
- `packages/db/src/index.ts` — export the new module.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.tsx` — paging UI, count, Import/Export actions.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/page.tsx` — use the extracted cursor helper.
- `apps/web/src/lib/messages.ts` — new copy keys.
- `apps/web/package.json` — `papaparse`, `@types/papaparse`.

---

## Task 1: Extract the cursor helper

**Files:**
- Create: `apps/web/src/lib/cursor.ts`
- Create: `apps/web/src/lib/cursor.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/page.tsx:32-58`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type RowCursor = { at: string; id: string }`, `export function encodeCursor(c: RowCursor): string`, `export function parseCursor(raw: string | undefined): RowCursor | undefined`, `export function parseTimeCursor(raw: string | undefined): string | undefined`.

`calls` keeps a timestamp-only cursor (`parseTimeCursor`) — widening it is not this plan's business. Contacts uses the tuple form.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/cursor.test.ts
import { describe, expect, it } from "vitest";
import { encodeCursor, parseCursor, parseTimeCursor } from "./cursor";

describe("cursor", () => {
  // THE TIMESTAMP IS NOT NORMALISED. Postgres serialises timestamptz with
  // MICROSECONDS and an offset — a real row reads
  // "2026-09-03T17:17:48.364157+00:00", not "…364Z". Both parsers therefore
  // validate the shape and pass the string through untouched; round-tripping
  // it through Date would truncate to milliseconds and could silently skip a
  // row at a page boundary. calls/page.tsx's original comment says exactly
  // this, and a stricter regex here breaks calls paging AND contacts paging.
  it("round-trips a real Postgres timestamp, microseconds and offset intact", () => {
    const c = { at: "2026-09-03T17:17:48.364157+00:00", id: "6b503e2f-3cd3-4531-a0af-5cfaf9bc158e" };
    const out = parseCursor(encodeCursor(c));
    expect(out).toEqual(c);
    expect(out!.at).toContain(".364157");
  });

  it("also accepts the millisecond Z form", () => {
    const c = { at: "2026-09-09T12:00:00.000Z", id: "6b503e2f-3cd3-4531-a0af-5cfaf9bc158e" };
    expect(parseCursor(encodeCursor(c))).toEqual(c);
  });

  // A hand-editable URL parameter. Every one of these must yield undefined
  // (cold start) rather than throwing a 500 on a page a user can reach.
  it.each([undefined, "", "not-a-cursor", "2026-09-09T12:00:00.000Z", "abc|def",
    "2026-09-09T12:00:00.000Z|not-a-uuid", "|", "a|b|c", "9999|x"])(
    "drops the unusable cursor %j", (raw) => {
      expect(parseCursor(raw as string | undefined)).toBeUndefined();
    });

  it("parseTimeCursor keeps calls' EXACT existing behaviour, microseconds included", () => {
    const pg = "2026-01-01T00:00:00.000000+00:00";
    expect(parseTimeCursor(pg)).toBe(pg);
    expect(parseTimeCursor("2026-09-09T12:00:00.000Z")).toBe("2026-09-09T12:00:00.000Z");
    expect(parseTimeCursor("nonsense")).toBeUndefined();
    expect(parseTimeCursor("2026-13-45T99:99:99Z")).toBeUndefined(); // Date.parse rejects
    expect(parseTimeCursor(undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/cursor.test.ts`
Expected: FAIL — `Failed to resolve import "./cursor"`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/lib/cursor.ts
//
// One cursor idiom for every paged list. `calls` had this logic private in its
// own page.tsx; contacts needs the same parsing plus an id tiebreaker, and two
// copies of a rule about a hand-editable URL parameter is one copy too many.
//
// Both parsers are TOTAL: `?before=` is user-editable, so anything unparseable
// must read as "no cursor" (cold start), never as an exception on a page a
// user can navigate to.
//
// VALIDATED, NEVER REWRITTEN. The timestamp goes back into a PostgREST `lt`
// filter exactly as it arrived. Postgres serialises timestamptz with
// microseconds and an offset ("2026-09-03T17:17:48.364157+00:00"), so a regex
// that insists on `.SSSZ` rejects every real cursor, and re-serialising
// through `Date` truncates to milliseconds — which can silently skip a row
// sharing the boundary microsecond. This is the rule calls/page.tsx already
// documented; it is preserved here rather than tightened.
const TS = /^\d{4}-\d{2}-\d{2}T/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isTs = (v: string) => TS.test(v) && !Number.isNaN(Date.parse(v));

/** A row's position in a `created_at desc, id desc` ordering. */
export type RowCursor = { at: string; id: string };

/**
 * CALLERS MUST BUILD THE QUERY STRING WITH `URLSearchParams`, never by
 * concatenation. A Postgres timestamp ends in `+00:00`, and a raw `+` in a
 * query string decodes to a SPACE — the cursor then fails `Date.parse` and
 * silently reads as a cold start, sending the user back to page one forever.
 * `URLSearchParams` percent-encodes it correctly.
 */
export function encodeCursor(c: RowCursor): string {
  return `${c.at}|${c.id}`;
}

export function parseCursor(raw: string | undefined): RowCursor | undefined {
  if (!raw) return undefined;
  const parts = raw.split("|");
  if (parts.length !== 2) return undefined;
  const [at, id] = parts as [string, string];
  if (!isTs(at) || !UUID.test(id)) return undefined;
  return { at, id };
}

/** The timestamp-only form `calls` already ships — byte-for-byte the same
 *  rule as the `cursorFrom` it replaces, so calls' behaviour is unchanged. */
export function parseTimeCursor(raw: string | undefined): string | undefined {
  if (!raw || !isTs(raw)) return undefined;
  return raw;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/cursor.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Point `calls` at the shared helper**

In `calls/page.tsx`, delete the local `cursorFrom` (line 32) and replace its one
use at line 58:

```ts
import { parseTimeCursor } from "@/lib/cursor";
// ...
const cursor = parseTimeCursor(before);
```

- [ ] **Step 6: Prove `calls` is unchanged**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calls/"`
Expected: PASS — including `page.test.ts:115`, the existing test that an unparseable `?before=` reads as cold start. It passed before this task and must still pass; that is the point of running it.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/danlo/bis-platform && git add apps/web/src/lib/cursor.ts apps/web/src/lib/cursor.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/page.tsx" && git commit -m "refactor(contacts): one shared cursor helper, tuple-aware, extracted from calls"
```

---

## Task 2: Page and count the contact list at the data layer

**Files:**
- Modify: `packages/db/src/contacts.ts:201-217` (`listContacts`), `:257-263` (`countContacts`)
- Test: `packages/db/src/test/contacts.test.ts`

**Interfaces:**
- Consumes: `RowCursor` from Task 1 — but `@bis/db` must not import from `apps/web`, so the shape is redeclared locally as `{ at: string; id: string }`. Structurally identical on purpose.
- Produces: `listContacts(db, accountId, opts: { search?: string; limit?: number; before?: { at: string; id: string } }): Promise<ContactRow[]>` and `countContacts(db, accountId, opts?: { search?: string }): Promise<number>`.

**Why the tuple:** `created_at` is not unique — one import writes thousands of rows in the same millisecond. A timestamp-only cursor skips every row that shares the boundary timestamp.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/src/test/contacts.test.ts — add to the existing file
describe("listContacts paging", () => {
  it("pages past 100 and never repeats or skips a row when timestamps collide", async () => {
    // Every row shares ONE created_at — exactly what an import produces, and
    // exactly what a timestamp-only cursor cannot page through.
    const at = "2026-09-09T12:00:00.000Z";
    const ids = await seedContacts(db, accountId, 250, at);

    const seen: string[] = [];
    let before: { at: string; id: string } | undefined;
    for (let page = 0; page < 10; page++) {
      const rows = await listContacts(db, accountId, { limit: 50, before });
      if (rows.length === 0) break;
      seen.push(...rows.map((r) => r.id));
      const last = rows[rows.length - 1]!;
      before = { at: last.created_at, id: last.id };
    }

    expect(seen.length).toBe(250);
    expect(new Set(seen).size).toBe(250);          // no repeats
    expect([...seen].sort()).toEqual([...ids].sort()); // no skips
  });

  it("counts what the search matches, not the whole account", async () => {
    await seedContact(db, accountId, { firstName: "Ada", lastName: "Lovelace" });
    await seedContact(db, accountId, { firstName: "Grace", lastName: "Hopper" });
    expect(await countContacts(db, accountId)).toBe(2);
    expect(await countContacts(db, accountId, { search: "Ada" })).toBe(1);
  });
});
```

- [ ] **Step 2: Run and watch both fail**

Run: `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run -t "listContacts paging"`
Expected: FAIL. The paging test fails on repeats/skips (the 100 cap and the missing `before`); the count test fails because `countContacts` takes no second argument.

**Read the failing test NAME, not just the exit code** — a `-t` filter that matches nothing skips silently and reports success.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/contacts.ts — replace listContacts and countContacts

/** A row's position in this list's `created_at desc, id desc` ordering.
 *  Structurally identical to apps/web's RowCursor; redeclared because
 *  @bis/db must not import from the app. */
export type ContactCursor = { at: string; id: string };

function withSearch<T>(q: T, search?: string): T {
  const s = search ? sanitizeSearchTerm(search) : undefined;
  if (!s) return q;
  return (q as { or: (f: string) => T }).or(
    `first_name.ilike.%${s}%,last_name.ilike.%${s}%,email.ilike.%${s}%,phone.ilike.%${s}%`,
  );
}

export async function listContacts(
  db: SupabaseClient, accountId: string,
  opts: { search?: string; limit?: number; before?: ContactCursor } = {},
) {
  let q = db.from("contacts").select(COLS).eq("account_id", accountId)
    // Two-key ordering: created_at alone is not unique (an import writes
    // thousands in one millisecond), so the id breaks the tie and makes the
    // cursor below total.
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(opts.limit ?? 50);
  q = withSearch(q, opts.search);
  if (opts.before) {
    // Row-value comparison: everything strictly after (created_at, id) in the
    // ordering above. PostgREST expresses this as an `or` of the two cases.
    const { at, id } = opts.before;
    q = q.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${id})`);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data;
}

export async function countContacts(
  db: SupabaseClient, accountId: string, opts: { search?: string } = {},
): Promise<number> {
  let q = db.from("contacts").select("id", { count: "exact", head: true })
    .eq("account_id", accountId);
  q = withSearch(q, opts.search);
  const { count, error } = await q;
  if (error) throw new Error(`countContacts failed: ${error.message}`);
  return count ?? 0;
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run -t "listContacts"`
Expected: PASS.

- [ ] **Step 5: Mutation-check the tiebreaker**

Delete the `.order("id", ...)` line, re-run the paging test, confirm it FAILS with repeats or skips, then restore it. If the test still passes without the tiebreaker, the test is not testing what it claims and must be fixed before moving on.

- [ ] **Step 6: Confirm the existing caller still compiles**

`dashboard/page.tsx:99` calls `countContacts(db, accountId)` with two arguments. The new third parameter is optional, so it must still typecheck untouched.

Run: `cd C:/Users/danlo/bis-platform && pnpm typecheck > /tmp/tc.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/tc.log`
Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/danlo/bis-platform && git add packages/db/src/contacts.ts packages/db/src/test/contacts.test.ts && git commit -m "feat(contacts): tuple cursor paging and a search-aware count"
```

---

## Task 3: Paging UI, count, and the two new actions on the list

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.tsx`
- Modify: `apps/web/src/lib/messages.ts`
- Test: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.test.ts` (create)

**Interfaces:**
- Consumes: `parseCursor`, `encodeCursor` (Task 1); `listContacts`, `countContacts` (Task 2).
- Produces: the `?before=` URL contract the e2e in Task 8 drives.

- [ ] **Step 1: Add the copy keys**

```ts
// apps/web/src/lib/messages.ts — alongside the existing contacts.* keys
"contacts.count": "{count} contacts",
"contacts.countOne": "1 contact",
"contacts.newer": "Newer",
"contacts.older": "Older",
"contacts.import": "Import CSV",
"contacts.export": "Export CSV",
```

- [ ] **Step 2: Write the failing test**

```ts
// contacts/page.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const page = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

describe("contacts list", () => {
  it("reads the cursor through the shared parser, never by hand", () => {
    expect(page).toContain("parseCursor");
    expect(page).not.toMatch(/before\?\.split\(/);
  });
  it("asks for one more row than it shows, to know whether an older page exists", () => {
    expect(page).toContain("PAGE_SIZE + 1");
  });
  it("counts with the same search the list uses", () => {
    expect(page).toMatch(/countContacts\(db, accountId, \{ search: q \}\)/);
  });
  it("offers import and export", () => {
    expect(page).toContain('m["contacts.import"]');
    expect(page).toContain('m["contacts.export"]');
  });
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.test.ts"`
Expected: FAIL on all four.

- [ ] **Step 4: Implement the page**

Fetch one extra row to decide whether an "Older" link is warranted, rather than
counting pages:

```tsx
const PAGE_SIZE = 50;

export default async function ContactsPage({ params, searchParams }: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ q?: string; before?: string }>;
}) {
  const { accountId } = await params;
  const { q, before } = await searchParams;
  const cursor = parseCursor(before);

  const [rows, total] = await Promise.all([
    listContacts(db, accountId, { search: q, limit: PAGE_SIZE + 1, before: cursor }),
    countContacts(db, accountId, { search: q }),
  ]);
  const hasOlder = rows.length > PAGE_SIZE;
  const page = hasOlder ? rows.slice(0, PAGE_SIZE) : rows;
  const last = page[page.length - 1];
  const olderHref = hasOlder && last
    ? `?${new URLSearchParams({ ...(q ? { q } : {}),
        before: encodeCursor({ at: last.created_at, id: last.id }) })}`
    : null;
  // "Newer" returns to the unpaged head; a full back-stack is not worth the
  // state for a list an operator scans rather than browses.
  const newerHref = cursor ? `?${new URLSearchParams(q ? { q } : {})}` : null;
  // ...render: count in the header, Import/Export actions, Newer/Older links
}
```

The count line uses `contacts.countOne` when `total === 1` — the platform
already shipped a "1 people" bug on the Website screen by templating a plural
with no singular form, and this is the same shape.

- [ ] **Step 5: Run and watch it pass**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/" apps/web/src/lib/messages.ts && git commit -m "feat(contacts): pager, total count and import/export actions on the list"
```

---

## Task 4: CSV export

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/route.ts`
- Test: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/route.test.ts`

**Interfaces:**
- Consumes: `listContacts` (Task 2).
- Produces: `GET /dashboard/accounts/:accountId/contacts/export?q=` → `text/csv`. **Column order is the import contract** for Task 6: `first_name,last_name,email,phone,company_name,source,tags`.

Export lands before import on purpose: it produces a known-good file to import in Task 6's round-trip test.

- [ ] **Step 1: Write the failing test**

```ts
// export/route.test.ts
import { describe, expect, it } from "vitest";
import { toCsv, CSV_COLUMNS } from "./route";

describe("contacts CSV", () => {
  it("emits the agreed column order — the import contract depends on it", () => {
    expect(CSV_COLUMNS).toEqual(
      ["first_name", "last_name", "email", "phone", "company_name", "source", "tags"]);
  });

  it("quotes a value containing a comma, a quote or a newline", () => {
    const csv = toCsv([{ first_name: 'A,B', last_name: 'He said "hi"',
      email: "x@y.z", phone: "", company_name: "line1\nline2", source: "", tags: "" }]);
    expect(csv).toContain('"A,B"');
    expect(csv).toContain('"He said ""hi"""');
    expect(csv).toContain('"line1\nline2"');
  });

  it("never lets a leading =, +, - or @ start a cell (CSV injection into Excel)", () => {
    const csv = toCsv([{ first_name: "=cmd|'/c calc'!A1", last_name: "", email: "",
      phone: "", company_name: "", source: "", tags: "" }]);
    expect(csv).not.toMatch(/(^|,)"?=cmd/);
  });

  it("joins tags with a comma inside one quoted cell", () => {
    expect(toCsv([{ first_name: "A", last_name: "", email: "", phone: "",
      company_name: "", source: "", tags: "vip,lead" }])).toContain('"vip,lead"');
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/"`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// export/route.ts
export const CSV_COLUMNS = ["first_name", "last_name", "email", "phone",
  "company_name", "source", "tags"] as const;

/** A cell starting with = + - or @ is a formula to Excel and Sheets, so a
 *  contact named "=HYPERLINK(...)" becomes code on the client's machine when
 *  they open our export. Prefixing a single quote is the standard defence and
 *  is stripped again on import. */
function guard(v: string): string {
  return /^[=+\-@]/.test(v) ? `'${v}` : v;
}

function cell(v: unknown): string {
  const s = guard(v == null ? "" : String(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  return [CSV_COLUMNS.join(","),
    ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n");
}
```

Then the `GET` handler: resolve the account through the same access check every
other route in this folder uses, page through `listContacts` in chunks of 500
with the tuple cursor (so export is not bounded by `PAGE_SIZE`), stream each
chunk into a `ReadableStream`, and respond with
`Content-Type: text/csv; charset=utf-8` and
`Content-Disposition: attachment; filename="contacts-<yyyy-mm-dd>.csv"`.

- [ ] **Step 4: Run and watch it pass**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/export/" && git commit -m "feat(contacts): streaming CSV export of the current view"
```

---

## Task 5: CSV parsing and mapping (pure, no I/O)

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/lib/contacts/csv.ts`
- Create: `apps/web/src/lib/contacts/csv.test.ts`

**Interfaces:**
- Consumes: `CSV_COLUMNS` (Task 4).
- Produces:
  - `type ParsedRow = { line: number; values: Record<string, string> }`
  - `type MappedRow = { line: number; input: ContactInput; tags: string[] }`
  - `type RowError = { line: number; reason: string }`
  - `autoMap(headers: string[]): Record<string, string | null>` — CSV header → field key
  - `mapRows(rows: ParsedRow[], mapping: Record<string, string | null>): { mapped: MappedRow[]; errors: RowError[] }`


**BINDING (Task 4 review) — `autoMap` MUST strip a leading `\uFEFF` from the
first header before matching.** Export now writes a UTF-8 BOM so Excel on
Windows renders á/ñ/é correctly. Verified empirically in Task 4:
`Response.text()` and `Blob.text()` strip that BOM silently, but
`fs.readFileSync(path, "utf8")` and `Buffer#toString("utf8")` do NOT — so the
importer cannot assume its runtime handled it. An unstripped BOM makes the first
header `\uFEFFfirst_name`, which matches nothing and silently drops that whole
column on re-import. `toCsv`'s round-trip test cannot catch it (`toCsv` never
emits a BOM — only the GET handler does), so this needs its OWN test.

- [ ] **Step 1: Add the dependency**

```bash
cd C:/Users/danlo/bis-platform && pnpm --filter web add papaparse && pnpm --filter web add -D @types/papaparse
```

- [ ] **Step 2: Write the failing tests**

```ts
// apps/web/src/lib/contacts/csv.test.ts
import { describe, expect, it } from "vitest";
import { autoMap, mapRows } from "./csv";

describe("autoMap", () => {
  it("matches ignoring case, spaces, underscores and hyphens", () => {
    expect(autoMap(["First Name", "last_name", "E-Mail", "Phone Number"]))
      .toEqual({ "First Name": "first_name", last_name: "last_name",
                 "E-Mail": "email", "Phone Number": "phone" });
  });
  it("leaves a column it cannot place as null rather than guessing", () => {
    expect(autoMap(["Nickname"])).toEqual({ Nickname: null });
  });
});

describe("mapRows", () => {
  const m = { Email: "email", First: "first_name", Tags: "tags" };

  it("splits tags on commas and trims them", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { Email: "a@b.co", First: "Ada", Tags: " vip , lead " } }], m);
    expect(mapped[0]!.tags).toEqual(["vip", "lead"]);
  });

  it("rejects a row with neither email nor phone — nothing could ever match it", () => {
    const { mapped, errors } = mapRows([{ line: 5, values: { First: "Ada" } }], m);
    expect(mapped).toHaveLength(0);
    expect(errors[0]).toEqual({ line: 5, reason: "no email or phone" });
  });

  it("rejects a malformed email but keeps the rest of the file", () => {
    const { mapped, errors } = mapRows([
      { line: 2, values: { Email: "not-an-email", First: "X" } },
      { line: 3, values: { Email: "a@b.co", First: "Y" } },
    ], m);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.line).toBe(2);
    expect(mapped).toHaveLength(1);
  });

  it("strips the leading quote our own export adds to a formula-looking cell", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { First: "'=SUM(A1)", Email: "a@b.co" } }], m);
    expect(mapped[0]!.input.firstName).toBe("=SUM(A1)");
  });

  it("keeps a blank cell OUT of the patch entirely, so it cannot overwrite", () => {
    const { mapped } = mapRows(
      [{ line: 2, values: { Email: "a@b.co", First: "" } }], m);
    expect("firstName" in mapped[0]!.input).toBe(false);
  });
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/contacts/csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `csv.ts`**

`autoMap` normalises a header with `.toLowerCase().replace(/[\s_-]+/g, "")` and
looks it up in a synonym table (`firstname`/`fname`/`given` → `first_name`, and
so on), returning `null` for anything unrecognised. `mapRows` walks each row,
drops empty cells **before** building the patch (so a blank can never reach
`toRow` and null a column), strips a single leading `'` from any cell, validates
that at least one of email/phone is present and that a present email matches a
simple `\S+@\S+\.\S+` shape, and splits `tags` on commas.

- [ ] **Step 5: Run and watch them pass**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/contacts/csv.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/danlo/bis-platform && git add apps/web/package.json pnpm-lock.yaml apps/web/src/lib/contacts/ && git commit -m "feat(contacts): CSV header mapping and row validation"
```

---

## Task 6: The import data layer

**Files:**
- Create: `packages/db/src/contact-import.ts`
- Create: `packages/db/src/test/contact-import.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `createContact`, `updateContact`, `addTagToContacts`, `listTags` from `contacts.ts`.
- Produces:
  - `type MatchIndex = { byEmail: Map<string, string>; byPhone: Map<string, string> }`
  - `buildMatchIndex(db, accountId): Promise<MatchIndex>`
  - `type ImportRow = { input: ContactInput; tags: string[] }`
  - `applyImportBatch(db, accountId, rows: ImportRow[], index: MatchIndex, actorId, opts: { createTags: boolean }): Promise<{ created: number; updated: number }>`

**BINDING (Task 4 review, Important 1) — an empty `tags` cell MUST leave existing
tags untouched.** Export currently emits `tags` empty for every row, because no
bulk tags-for-many-contacts read exists. So the ordinary flow "export this list,
fix a phone number in Excel, re-import" hands you a file whose every `tags` cell
is blank. If an empty cell reads as "clear the tags", that flow silently strips
every tag from every contact in the account, and both the export and the import
report success. Treat `tags` exactly like every other blank cell: absent, not
empty. A test must pin it — seed a contact with a tag, import a row matching it
with an empty tags cell, assert the tag survives.

**Why an index rather than `findDuplicate` per row:** `findDuplicate`'s phone
fallback selects **every non-null phone on the account** and compares in memory.
Correct and cheap for one contact; O(n²) for an import. Build the index once,
and keep it current as rows are created so two identical rows inside one file
collapse to one contact.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/src/test/contact-import.test.ts
describe("applyImportBatch", () => {
  it("creates a new contact and updates a matching one in the same batch", async () => {
    const existing = await createContact(db, accountId,
      { email: "ada@example.com", firstName: "Ada" }, actorId);
    const index = await buildMatchIndex(db, accountId);
    const r = await applyImportBatch(db, accountId, [
      { input: { email: "ada@example.com", companyName: "Analytical Engines" }, tags: [] },
      { input: { email: "grace@example.com", firstName: "Grace" }, tags: [] },
    ], index, actorId, { createTags: false });

    expect(r).toEqual({ created: 1, updated: 1 });
    const ada = await getContact(db, accountId, existing.id);
    expect(ada!.company_name).toBe("Analytical Engines");
    expect(ada!.first_name).toBe("Ada"); // untouched: the CSV had no first name
  });

  it("matches on phone across formatting — (956) 292-1696 is +19562921696", async () => {
    const existing = await createContact(db, accountId, { phone: "+19562921696" }, actorId);
    const index = await buildMatchIndex(db, accountId);
    const r = await applyImportBatch(db, accountId,
      [{ input: { phone: "(956) 292-1696", firstName: "Dan" }, tags: [] }],
      index, actorId, { createTags: false });
    expect(r).toEqual({ created: 0, updated: 1 });
    expect((await getContact(db, accountId, existing.id))!.first_name).toBe("Dan");
  });

  it("a non-empty cell OVERWRITES — this is not fillContactBlanks", async () => {
    const existing = await createContact(db, accountId,
      { email: "a@b.co", firstName: "Old" }, actorId);
    const index = await buildMatchIndex(db, accountId);
    await applyImportBatch(db, accountId,
      [{ input: { email: "a@b.co", firstName: "New" }, tags: [] }],
      index, actorId, { createTags: false });
    expect((await getContact(db, accountId, existing.id))!.first_name).toBe("New");
  });

  it("collapses two identical rows inside ONE batch to a single contact", async () => {
    const index = await buildMatchIndex(db, accountId);
    const r = await applyImportBatch(db, accountId, [
      { input: { email: "dup@example.com", firstName: "A" }, tags: [] },
      { input: { email: "dup@example.com", lastName: "B" }, tags: [] },
    ], index, actorId, { createTags: false });
    expect(r).toEqual({ created: 1, updated: 1 });
  });

  it("does not create an unknown tag when createTags is false", async () => {
    const index = await buildMatchIndex(db, accountId);
    await applyImportBatch(db, accountId,
      [{ input: { email: "t@example.com" }, tags: ["brand-new"] }],
      index, actorId, { createTags: false });
    expect((await listTags(db, accountId)).map((t) => t.name)).not.toContain("brand-new");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run -t "applyImportBatch"`
Expected: FAIL — module not found. Confirm the reported test NAMES are the five above.

- [ ] **Step 3: Implement**

`buildMatchIndex` selects `id, email, phone` for the account and fills two maps —
email lowercased, phone through the same digit normalisation `findDuplicate`
uses (export `phoneDigits` from `contacts.ts` rather than copying it, so the two
paths cannot drift). `applyImportBatch` walks rows: look up email then phone in
the index; on a hit call `updateContact` with the patch as given (blank cells
were already dropped in Task 5) and count `updated`; on a miss call
`createContact`, count `created`, **and add the new id to the index** so a later
row in the same file matches it. Tags resolve against `listTags`
case-insensitively; unknown names are applied only when `createTags` is true.

- [ ] **Step 4: Run and watch them pass**

Run: `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run -t "applyImportBatch"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Mutation-check the in-batch index update**

Remove the line that adds a newly created id to the index. Re-run: the
"collapses two identical rows" test must FAIL with `{ created: 2, updated: 0 }`.
Restore it.

- [ ] **Step 6: Export and commit**

```bash
cd C:/Users/danlo/bis-platform && git add packages/db/src/ && git commit -m "feat(contacts): import match index and batch apply"
```

---

## Task 7: The import screen

**Files:**
- Create: `contacts/import/page.tsx`, `contacts/import/import-wizard.tsx`, `contacts/import/actions.ts`
- Modify: `apps/web/src/lib/messages.ts`
- Test: `contacts/import/import-wizard.test.ts`

**Interfaces:**
- Consumes: `autoMap`, `mapRows` (Task 5); `buildMatchIndex`, `applyImportBatch` (Task 6).
- Produces: `importContactsBatchAction(accountId, rows, opts) => { ok: true; created: number; updated: number } | { ok: false; error: string }`.

- [ ] **Step 1: Add copy keys**

```ts
"contacts.import.title": "Import contacts",
"contacts.import.drop": "Choose a CSV file",
"contacts.import.mapTitle": "Match your columns",
"contacts.import.ignored": "{count} columns won't be imported",
"contacts.import.preview": "Will add {created} and update {updated}.",
"contacts.import.errors": "{count} rows have problems and will be skipped.",
"contacts.import.downloadErrors": "Download the skipped rows",
"contacts.import.createTags": "Also create {count} new tags",
"contacts.import.confirm": "Import",
"contacts.import.done": "Added {created}, updated {updated}.",
"contacts.import.partial": "Stopped after {done} rows. Nothing after that was imported.",
```

- [ ] **Step 2: Write the failing test**

```ts
// import-wizard.test.ts
const src = readFileSync(/* import-wizard.tsx */, "utf8");
const action = readFileSync(/* actions.ts */, "utf8");

it("parses in the browser — the file is never sent whole", () => {
  expect(src).toContain("papaparse");
  expect(src).not.toMatch(/FormData|file\.arrayBuffer\(\)/);
});

it("commits in bounded batches, not one request", () => {
  expect(src).toMatch(/BATCH_SIZE\s*=\s*200/);
});

it("re-validates on the server: the action never trusts the browser's mapping", () => {
  expect(action).toContain("mapRows");
});

it("builds the match index once per BATCH, never once per row", () => {
  // Structural, not a comment scan: buildMatchIndex must be called outside
  // any loop over rows. The behavioural guarantee this protects — that two
  // identical rows collapse — is tested for real in contact-import.test.ts.
  expect(action).toContain("buildMatchIndex");
  expect(action).not.toMatch(/for\s*\([^)]*rows[^)]*\)[\s\S]{0,200}buildMatchIndex/);
});
```

- [ ] **Step 3: Run and watch it fail**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/"`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the three files**

`page.tsx` is a Server Component that checks agency/client access the same way
its sibling routes do and renders the wizard. `import-wizard.tsx` is
`"use client"`: file input → `Papa.parse(file, { header: true, skipEmptyLines: true })`
→ `autoMap` → a mapping table the user can correct → `mapRows` for the preview
counts and the error list → confirm → slice into 200-row batches and call the
action per batch, showing progress and stopping on the first failure with
`contacts.import.partial`.

`actions.ts` re-runs `mapRows` on what it received, builds the match index
**once per batch** — not once per row, and deliberately not cached across
batches: rows committed by an earlier batch are already in the database when
the next batch builds its index, so cross-batch duplicates are caught with no
server-side session state to hold or invalidate. A 5,000-row import does 25
index builds rather than 5,000 duplicate lookups. Then it calls
`applyImportBatch`, and `emit`s a
`contact.imported` event with the counts. It uses `useFormSubmit` from
`@/lib/forms/use-form-submit` (see `dashboard/accounts/create-account-dialog.tsx:38`
for the established call shape) — **not** a bare `<form action>`, which React
resets even when the action failed, and which drives a Radix `Select` backwards
on that reset.

- [ ] **Step 5: Run and watch it pass**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/danlo/bis-platform && git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/" apps/web/src/lib/messages.ts && git commit -m "feat(contacts): CSV import wizard — map, preview, batched commit"
```

---

## Task 8: End-to-end, including the round trip

**Files:**
- Create: `apps/web/e2e/contacts-data.spec.ts`

Runs on the per-run fixture account. **Never `Test Client One`.**

- [ ] **Step 1: Write the spec**

Four flows:

1. **Paging.** Seed 120 contacts on the fixture account, open the list, assert
   the header count reads 120 and exactly `PAGE_SIZE` rows render; click
   "Older", assert the URL carries `?before=` and the next rows are different
   ids; click "Newer", assert the head page returns.
2. **Export.** Click Export, capture the download, assert the header row equals
   `CSV_COLUMNS.join(",")` and the row count matches the total.
3. **Round trip — the strongest test in the plan.** Re-import the file exported
   in flow 2 and assert the result is **`Added 0, updated N`** and that the
   contact count is unchanged. This exercises the parser, mapping, match rule
   and update semantics together; if any one of them is wrong, this fails.
4. **Bad rows.** Import a file with one row missing both email and phone and one
   malformed email; assert the preview reports 2 problems, the import proceeds
   with the rest, and the count rises by exactly the good-row count.

- [ ] **Step 2: Run locally if a port is free, else let CI gate it**

Run: `cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e -- contacts-data.spec.ts`
Expected: 4 passed. If port 3000 is held, the build path refuses to reuse the
server by design — push and let CI's `e2e` job be the gate.

- [ ] **Step 3: Commit**

```bash
cd C:/Users/danlo/bis-platform && git add apps/web/e2e/contacts-data.spec.ts && git commit -m "test(contacts): e2e paging, export, round-trip import and bad rows"
```

---

## Task 9: Gate, document, open the PR

- [ ] **Step 1: Run the whole suite, unpiped**

```bash
cd C:/Users/danlo/bis-platform && { pnpm typecheck; echo "T=$?"; pnpm lint; echo "L=$?"; pnpm --filter @bis/db test; echo "D=$?"; pnpm --filter web test; echo "W=$?"; } > /tmp/gate.log 2>&1; grep -E "=[0-9]|Tests " /tmp/gate.log
```

Expected: `T=0 L=0 D=0 W=0`. **Never** `pnpm check | tail` — the pipe reports
`tail`'s exit code and has hidden a real failure in this repo before.

- [ ] **Step 2: Build**

```bash
cd C:/Users/danlo/bis-platform && pnpm --filter web build > /tmp/build.log 2>&1; echo "B=$?"; tail -3 /tmp/build.log
```

- [ ] **Step 3: Update DESIGN.md**

Add the import wizard and the pager to the key-patterns section; note that the
contact list is the first paged list to carry a total count.

- [ ] **Step 4: Push and open the PR**

Body states: the three defects closed, the tuple-cursor reason, the
client-side-parse reason, the one new dependency, and the gate numbers. Merge
only when `verify` AND `e2e` are green on the PR's current head.

---

## Self-review

**Spec coverage.** Paging → Tasks 2, 3. Tuple cursor → Task 2 (+ mutation
check). Total count → Tasks 2, 3. Client-side parse → Tasks 5, 7. Papa Parse →
Task 5. Mapping incl. custom fields and tags → Tasks 5, 6. Match on email/phone
→ Task 6. Update semantics → Tasks 5 (blank dropped), 6 (non-empty overwrites).
Tag create-or-not → Tasks 6, 7. Preview → Task 7. Batched commit → Tasks 6, 7.
`emit` on import → Task 7. Export of current view → Task 4. Round trip → Tasks
4, 8. Access scope → Tasks 4, 7 (route checks) and Task 8. Malformed CSV → Task
5. Cursor extraction → Task 1. No migration → confirmed, none present.

**One spec item deliberately not implemented as written:** the spec's testing
section lists a real-db access-scope test pinning SQLSTATE `42501`. The contact
routes gate on account membership in the route handler, not on a column grant,
so the honest test is the route-level refusal in Tasks 4 and 7 plus the e2e —
not a grant test that would pass vacuously. Recorded here rather than silently
dropped.

**Placeholder scan:** none. Every code step carries code; every run step carries
a command and an expected result.

**Type consistency:** `ContactCursor` (db) and `RowCursor` (web) are declared
separately and named differently on purpose — `@bis/db` must not import from
`apps/web` — and both are `{ at: string; id: string }`. `CSV_COLUMNS` is defined
once in Task 4 and consumed in Tasks 5 and 8. `ImportRow.input` is
`ContactInput`, the existing exported type. `applyImportBatch`'s return
`{ created, updated }` is the shape asserted in Tasks 6, 7 and 8.

---

## Task 3b: Server-side sorting, and one pager instead of two

Added 2026-09-09 mid-execution. Task 3's implementer reported that
`contacts-table.tsx` already had its own client-side pager, so the list ended up
with two stacked. danlo chose: **drop the client pager, and make sorting work
across the whole list rather than the visible page.**

**Files:**
- Modify: `apps/web/src/lib/cursor.ts` + `cursor.test.ts` — cursor value becomes opaque
- Modify: `packages/db/src/contacts.ts` + `src/test/contacts.test.ts` — sort-aware list
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contacts-table.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces produced:**
- `type SortKey = "name" | "company" | "created"`, `type SortDir = "asc" | "desc"`
- `listContacts(db, accountId, { search?, limit?, before?, sort? })` where
  `sort` is `{ key: SortKey; dir: SortDir }`, defaulting to `{ key: "created", dir: "desc" }`
- Cursor is `{ v: string | null; id: string }` — `v` is the sort column's value

**MIGRATION 0030 IS ALREADY APPLIED. Do not write, re-run, or re-apply it.**
`contacts.sort_name` exists as a stored generated column
(`nullif(lower(trim(coalesce(first_name,'') || ' ' || coalesce(last_name,''))), '')`),
indexed `(account_id, sort_name, id)`, with `select (sort_name)` granted to
`authenticated`. Verified against live data: `Caller` → `caller`,
`Carlos Mendoza` → `carlos mendoza`.

### Why the cursor encoding must change first

Today `encodeCursor` joins with `|`. That was safe for a timestamp. A sort value
is now a **name or company**, which can contain a `|`, and a raw `+` in a query
string still decodes to a space. Both go away by encoding the pair as
base64url of JSON:

```ts
export type RowCursor = { v: string | null; id: string };

export function encodeCursor(c: RowCursor): string {
  return Buffer.from(JSON.stringify([c.v, c.id]), "utf8").toString("base64url");
}

export function parseCursor(raw: string | undefined): RowCursor | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 2) return undefined;
    const [v, id] = parsed as [unknown, unknown];
    if (typeof id !== "string" || !UUID.test(id)) return undefined;
    if (v !== null && typeof v !== "string") return undefined;
    return { v, id };
  } catch { return undefined; }
}
```

`parseTimeCursor` is UNTOUCHED — `calls` still uses it and must not change.
The value is still validated and never re-serialised: a timestamp rides through
`JSON` as the same string it arrived as.

### Null ordering is the part that will be got wrong

`sort_name` and `company_name` are both nullable. Order them `nulls last` in
BOTH directions so nameless contacts always sit at the end, and the cursor has
to step across the null boundary. For ascending, with cursor value `v`:

- `v` is **not null** — the remaining rows are the greater non-nulls *plus every
  null*: `col.gt.v, and(col.eq.v,id.gt.ID), col.is.null`
- `v` **is null** — we are already inside the null block, so only the id moves:
  `and(col.is.null,id.gt.ID)`

Descending is the mirror (`lt`, `id.lt`), still with `col.is.null` appended,
because nulls stay last in both directions.

`created` sorts on `created_at`, which is `not null`, so its cursor keeps the
simple two-branch form.

- [ ] **Step 1: Write the failing tests**

In `cursor.test.ts`: a value containing `|`, a value containing `+`, and a
`null` value each round-trip; a non-base64 string, a base64 string whose JSON is
not a 2-array, and a well-formed pair with a non-uuid id each return `undefined`.

In `packages/db/src/test/contacts.test.ts`: seed contacts whose names sort
differently from their creation order, plus **two with no name at all**, then for
each of `name` and `company`, in both directions, page the whole list with the
cursor and assert every row is seen exactly once, in the right order, with the
nameless ones last in both directions.

- [ ] **Step 2: Run them and watch them fail**

```
cd C:/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/cursor.test.ts
cd C:/Users/danlo/bis-platform/packages/db && npx vitest run -t "sort"
```

- [ ] **Step 3: Implement**

Cursor module as above. In `listContacts`, map `sort.key` to its column
(`name` → `sort_name`, `company` → `company_name`, `created` → `created_at`),
order by `(column, id)` in `sort.dir` with `nullsLast: true`, and build the
cursor `.or()` per the null rules above. The row the page hands back for the
next cursor carries that column's value as `v`.

- [ ] **Step 4: Run them and watch them pass**

- [ ] **Step 5: Mutation-check the null boundary**

Drop the `col.is.null` term from the non-null branch, re-run: the "nameless
contacts last" test must FAIL by skipping them entirely. Restore.

- [ ] **Step 6: One pager, and sort in the URL**

In `contacts-table.tsx`: delete `PAGE_SIZE`, the `page` state, the `sorted`
`useMemo`, `pageCount`/`current`/`visible`, and the Page-X-of-Y control. Render
`rows` directly. `toggleSort` becomes a link/router push that sets `?sort=` and
`?dir=` instead of local state — keep the header's existing aria-sort and
focus behaviour. Selection state keys off `rows` rather than `visible`.

In `page.tsx`: read `sort`/`dir` from `searchParams`, validate against the three
keys and two directions (anything else falls back to the default rather than
throwing), pass them to `listContacts`, and **carry them into the Newer/Older
hrefs** — a cursor from a name-sorted page is meaningless on a date-sorted one,
so changing the sort must also drop the cursor.

- [ ] **Step 7: Run the contacts web tests, then commit**

```
cd C:/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/"
```
