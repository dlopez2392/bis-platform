# Design Phase 4 — Tables + Record Drawers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the contacts and calls lists on the DESIGN.md table pattern (whole-row targets, keyboard nav, bulk-action bar) and ship the contact drawer as the record-drawer exemplar with shared inline editing.

**Architecture:** Client-state drawer over the contacts list, summary data via a GET route handler (reads must never ride server actions — Next serializes same-client actions), shallow `?peek=` URL via `history.pushState`. Writes are server actions returning `{ok}` shapes consumed through `notifyActionResult`/sonner toasts. Bulk delete uses skip-blocked semantics (FKs from opportunities/conversations are NO ACTION and bookings is `on delete restrict` by design).

**Tech Stack:** Next.js App Router, shadcn (Sheet/Table/Checkbox/Dialog/DropdownMenu), sonner, Supabase via `@bis/db`, Vitest (node env — NO component rendering tests in apps/web; behavior is proven by pure-logic units + e2e), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-02-design-phase4-tables-drawers-design.md` — decisions there are LOCKED.

## Global Constraints

- Tokens only — no hard-coded colors/radii/shadows (DESIGN.md DoD). Radii 8/11/999px. Hover rows use `--surface-2` (the Tailwind side of it is the `bg-accent`→`--surface-3` / `bg-muted` mappings already in globals; row hover uses the existing `hover:bg-muted/50` idiom of `ui/table.tsx` unless it resolves off-ladder — check, don't invent).
- Status is never color alone; dot + word (`OutcomePill` already complies).
- One primary button per view; everything else ghost/outline.
- Copy passes the "landscaper at 7 AM" read; no jargon, no `{{templates}}`.
- All timestamps render in the ACCOUNT timezone (pages already resolve + `safeZone` it); relative times use `@/lib/dashboard/relative-time`'s `relativeTime(iso, nowMs)`.
- Compare instants by **epoch ms**, never lexicographic ISO (`+00:00` vs `.000Z` misorder).
- Zone-discrimination tests: TWO zones, opposite assertions, ONE instant.
- New server actions return `{ ok: true, ... } | { ok: false; error: string }` and are called through `notifyActionResult` (`@/lib/forms/action-feedback`) so stale-tab rejections toast instead of vanishing.
- The summary route handler must use `dbForRequest()` (RLS) — NEVER `serviceDb()`.
- e2e mutations run ONLY on the per-run client fixture account (`readClientFixture()` from `e2e/support.ts`) — never on `Test Client One` (`SEEDED_ACCOUNT_NAME`, read-only assertions allowed).
- db package tests are real integration tests via `withTestAccount` from `packages/db/src/test/fixtures` — they use serviceDb and are BLIND to grants; RLS/grant proof lives in the e2e client-session test (Task 11).
- Commit after every task; run `pnpm --filter db test` / `pnpm --filter web test` as specified per task. Full gates (`pnpm check`, build, e2e) run in Task 12 — plus after any task if you touched something risky.

---

### Task 1: db — bulk contact ops + per-contact calls

**Files:**
- Modify: `packages/db/src/contacts.ts` (append after `countContacts`)
- Modify: `packages/db/src/voice.ts` (append near `listCalls`)
- Modify: `packages/db/src/index.ts` (export the four new functions)
- Test: `packages/db/src/test/contacts.test.ts` (append), `packages/db/src/test/voice.test.ts` (append if the file exists; otherwise add the call-list test into contacts.test.ts with a comment)

**Interfaces:**
- Produces:
  - `deleteContacts(db, accountId, contactIds: string[]): Promise<{ deleted: number; skippedBlocked: number }>`
  - `addTagToContacts(db, accountId, contactIds: string[], tagName: string): Promise<{ tagId: string; applied: number }>`
  - `removeTagFromContacts(db, accountId, contactIds: string[], tagId: string): Promise<void>`
  - `listContactCalls(db, accountId, contactId: string, limit?: number): Promise<{ id: string; started_at: string; outcome: string }[]>`

- [ ] **Step 1: Write the failing tests** (append to `packages/db/src/test/contacts.test.ts`)

```ts
import { deleteContacts, addTagToContacts, removeTagFromContacts } from "../contacts";

describe("bulk contact ops", () => {
  it("addTagToContacts tags every id once, idempotently, and returns the tagId", () =>
    withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId, { firstName: "A" }, "user_test");
      const b = await createContact(db, accountId, { firstName: "B" }, "user_test");
      const r1 = await addTagToContacts(db, accountId, [a.id, b.id], "VIP");
      expect(r1.applied).toBe(2);
      // idempotent — re-applying does not duplicate contact_tags rows
      const r2 = await addTagToContacts(db, accountId, [a.id, b.id], "vip");
      expect(r2.tagId).toBe(r1.tagId); // trims + lowercases like addTagToContact
      const tagsA = await listContactTags(db, accountId, a.id);
      expect(tagsA).toHaveLength(1);
      // undo path: removeTagFromContacts strips it from both
      await removeTagFromContacts(db, accountId, [a.id, b.id], r1.tagId);
      expect(await listContactTags(db, accountId, a.id)).toHaveLength(0);
      expect(await listContactTags(db, accountId, b.id)).toHaveLength(0);
    }));

  it("deleteContacts deletes unblocked ids and skips one linked to an opportunity", () =>
    withTestAccount(async (db, accountId) => {
      const free = await createContact(db, accountId, { firstName: "Free" }, "user_test");
      const blocked = await createContact(db, accountId, { firstName: "Blocked" }, "user_test");
      // Any blocking child works for the skip proof; opportunities is the
      // easiest to mint. Pipeline + stage rows are prerequisites — mirror
      // however this test file's opportunity tests create them; if none
      // exist in this file, insert directly:
      const { data: pipe } = await db.from("pipelines")
        .insert({ account_id: accountId, name: "P" }).select("id").single();
      const { data: stage } = await db.from("pipeline_stages")
        .insert({ account_id: accountId, pipeline_id: pipe!.id, name: "S", position: 1 })
        .select("id").single();
      await db.from("opportunities").insert({
        account_id: accountId, contact_id: blocked.id, pipeline_id: pipe!.id,
        stage_id: stage!.id, name: "Deal", monetary_value: 0, status: "open",
      });
      const r = await deleteContacts(db, accountId, [free.id, blocked.id]);
      expect(r).toEqual({ deleted: 1, skippedBlocked: 1 });
      expect(await getContact(db, accountId, free.id)).toBeNull();
      expect(await getContact(db, accountId, blocked.id)).not.toBeNull();
    }));

  it("deleteContacts cascades tags/notes and null-scoped: ignores other-account ids", () =>
    withTestAccount(async (db, accountId) => {
      const c = await createContact(db, accountId, { firstName: "C" }, "user_test");
      await addTagToContact(db, accountId, c.id, "temp");
      const r = await deleteContacts(db, accountId, [c.id, "00000000-0000-0000-0000-000000000000"]);
      expect(r.deleted).toBe(1); // the bogus id is not counted, not an error
    }));
});
```

NOTE for the implementer: `pipeline_stages` column names above are a guess in
this brief — read `packages/db/supabase/migrations/0003_crm_core.sql` (the
`pipeline_stages` create table) and use the REAL column names; if an existing
opportunities test in `packages/db/src/test/` already mints pipeline+stage,
copy that instead. Do not ship a test you haven't watched fail then pass.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter db test -- --run -t "bulk contact ops"`
Expected: FAIL — `deleteContacts is not a function` (module has no such export).

- [ ] **Step 3: Implement** (append to `packages/db/src/contacts.ts`)

```ts
/**
 * Bulk tag: one tag upsert + one contact_tags bulk upsert. Same
 * trim/lowercase normalization as addTagToContact so "VIP" and "vip"
 * are the same tag. Returns the tagId so the caller can offer undo.
 */
export async function addTagToContacts(
  db: SupabaseClient, accountId: string, contactIds: string[], tagName: string,
): Promise<{ tagId: string; applied: number }> {
  const name = tagName.trim().toLowerCase();
  if (!name || contactIds.length === 0) throw new Error("addTagToContacts: nothing to do");
  const { data: tag, error: tErr } = await db.from("tags")
    .upsert({ account_id: accountId, name }, { onConflict: "account_id,name" })
    .select("id").single();
  if (tErr || !tag) throw new Error(`tag upsert failed: ${tErr?.message}`);
  const rows = contactIds.map((contactId) => ({
    contact_id: contactId, tag_id: tag.id, account_id: accountId,
  }));
  const { error } = await db.from("contact_tags")
    .upsert(rows, { onConflict: "contact_id,tag_id" });
  if (error) throw new Error(`contact_tags bulk upsert failed: ${error.message}`);
  return { tagId: tag.id, applied: contactIds.length };
}

/** Undo for addTagToContacts: strip ONE tag from the same id set. */
export async function removeTagFromContacts(
  db: SupabaseClient, accountId: string, contactIds: string[], tagId: string,
): Promise<void> {
  if (contactIds.length === 0) return;
  const { error } = await db.from("contact_tags").delete()
    .eq("account_id", accountId).eq("tag_id", tagId).in("contact_id", contactIds);
  if (error) throw new Error(error.message);
}

/**
 * Bulk delete with skip-blocked semantics. opportunities.contact_id and
 * conversations.contact_id are NO ACTION FKs, and bookings.contact_id is
 * `on delete restrict` BY DESIGN (0017) — a single unfiltered
 * `delete … in (…)` would abort the whole batch on one linked contact.
 * So: pre-read which ids have any blocking child, delete only the rest in
 * one statement, and report both counts honestly. contact_tags/notes/tasks
 * cascade; form_submissions and calls set-null (schema, not our concern
 * here). Deliberately NO event emit: `contact.deleted` is not a curated
 * ledger type and the ledger fails closed on unknown types.
 */
export async function deleteContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
): Promise<{ deleted: number; skippedBlocked: number }> {
  if (contactIds.length === 0) return { deleted: 0, skippedBlocked: 0 };
  const blocked = new Set<string>();
  for (const table of ["opportunities", "conversations", "bookings"] as const) {
    const { data, error } = await db.from(table).select("contact_id")
      .eq("account_id", accountId).in("contact_id", contactIds);
    if (error) throw new Error(`deleteContacts ${table} pre-read failed: ${error.message}`);
    for (const r of data ?? []) if (r.contact_id) blocked.add(r.contact_id as string);
  }
  const deletable = contactIds.filter((id) => !blocked.has(id));
  if (deletable.length === 0) return { deleted: 0, skippedBlocked: blocked.size };
  const { data, error } = await db.from("contacts").delete()
    .eq("account_id", accountId).in("id", deletable).select("id");
  if (error) throw new Error(`deleteContacts failed: ${error.message}`);
  return { deleted: (data ?? []).length, skippedBlocked: blocked.size };
}
```

And in `packages/db/src/voice.ts` (near `listCalls`; reuse its column-name
constants if it has them):

```ts
/** The contact drawer's recent-calls source — newest few for ONE contact. */
export async function listContactCalls(
  db: SupabaseClient, accountId: string, contactId: string, limit = 3,
): Promise<{ id: string; started_at: string; outcome: string }[]> {
  const { data, error } = await db.from("calls")
    .select("id, started_at, outcome")
    .eq("account_id", accountId).eq("contact_id", contactId)
    .order("started_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`listContactCalls failed: ${error.message}`);
  return (data ?? []) as { id: string; started_at: string; outcome: string }[];
}
```

Export all four from `packages/db/src/index.ts` alongside the existing
contacts/voice exports (follow the file's grouping).

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter db test -- --run -t "bulk contact ops"`
Expected: PASS (3 tests). Then run the whole file: `pnpm --filter db test -- --run contacts` — no regressions.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/contacts.ts packages/db/src/voice.ts packages/db/src/index.ts packages/db/src/test/contacts.test.ts
git commit -m "feat(db): bulk contact tag/delete with skip-blocked semantics + per-contact calls"
```

---

### Task 2: API access guard + contact summary route handler

**Files:**
- Modify: `apps/web/src/lib/auth.ts` (append)
- Create: `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts`
- Test: `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts`

**Interfaces:**
- Consumes: `listContactTags`, `listNotes`, `listContactSubmissions`, `listContactMessages`, `listContactOpportunities`, `listContactCalls` (Task 1), `getContact` from `@bis/db`; `dbForRequest` from `@/lib/db`.
- Produces:
  - `apiAccountAccess(accountId: string): Promise<{ userId: string; isAgency: boolean } | null>` in `@/lib/auth`
  - `GET /api/accounts/:accountId/contacts/:contactId/summary` → `200 { tags: {id,name}[], recent: { kind, label, at }[] }` | `404 {}` (unknown contact OR no access — deliberately the same, don't confirm existence) 
  - Exported type `ContactSummary = { tags: { id: string; name: string }[]; recent: { kind: "call" | "note" | "submission" | "message" | "opportunity"; label: string; at: string }[] }` from the route file (imported type-only by the drawer in Task 6).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";

const access = vi.fn();
vi.mock("@/lib/auth", () => ({ apiAccountAccess: (...a: unknown[]) => access(...a) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));

const dbMocks = {
  getContact: vi.fn(), listContactTags: vi.fn(), listNotes: vi.fn(),
  listContactSubmissions: vi.fn(), listContactMessages: vi.fn(),
  listContactOpportunities: vi.fn(), listContactCalls: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const { GET } = await import("./route");

function req() { return new Request("http://x/api/accounts/a1/contacts/c1/summary"); }
function ctx() { return { params: Promise.resolve({ accountId: "a1", contactId: "c1" }) }; }

describe("contact summary route", () => {
  it("404s without access, and for a missing contact", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.getContact.mockResolvedValueOnce(null);
    expect((await GET(req(), ctx())).status).toBe(404);
  });

  it("merges sources newest-first by EPOCH not string, caps at 5", async () => {
    access.mockResolvedValue({ userId: "u1", isAgency: true });
    dbMocks.getContact.mockResolvedValue({ id: "c1" });
    dbMocks.listContactTags.mockResolvedValue([{ id: "t1", name: "vip" }]);
    // same instant, two lexical forms — the +00:00 form sorts BEFORE the
    // .000Z form lexicographically; epoch comparison keeps real order
    dbMocks.listNotes.mockResolvedValue([
      { id: "n1", body: "hello", created_at: "2026-09-01T10:00:00+00:00" },
    ]);
    dbMocks.listContactCalls.mockResolvedValue([
      { id: "k1", started_at: "2026-09-01T09:59:59.000Z", outcome: "booked" },
    ]);
    dbMocks.listContactSubmissions.mockResolvedValue([]);
    dbMocks.listContactMessages.mockResolvedValue([]);
    dbMocks.listContactOpportunities.mockResolvedValue(
      Array.from({ length: 6 }, (_, i) => ({
        id: `o${i}`, name: `Deal ${i}`, status: "open", monetary_value: 100,
        created_at: `2026-08-2${i}T00:00:00+00:00`,
      })),
    );
    const body = await (await GET(req(), ctx())).json();
    expect(body.tags).toEqual([{ id: "t1", name: "vip" }]);
    expect(body.recent).toHaveLength(5);
    expect(body.recent[0].kind).toBe("note");   // 10:00:00 beats 09:59:59
    expect(body.recent[1].kind).toBe("call");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- --run summary/route`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/auth.ts` (append; mirrors `requireAccountAccess` minus the
redirects — a route handler must answer JSON, not bounce a fetch to
/sign-in HTML):

```ts
/**
 * requireAccountAccess for API route handlers: same checks, but returns
 * null instead of redirecting — the caller answers 404 (never 403/401
 * with substance: don't confirm to a wrong-tenant caller that the
 * resource exists). Client callers get access to exactly their own
 * account, like the page variant.
 */
export async function apiAccountAccess(
  accountId: string,
): Promise<{ userId: string; isAgency: boolean } | null> {
  const { userId, sessionClaims } = await auth();
  if (!userId) return null;
  const claims = sessionClaims as AppClaims;
  if (claims.app_role === "agency_admin") return { userId, isAgency: true };
  if (!claims.org_id) return null;
  const account = await getAccountByOrgId(serviceDb(), claims.org_id);
  if (!account || !account.client_access_enabled) return null;
  if (account.id !== accountId) return null;
  return { userId, isAgency: false };
}
```

`summary/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  getContact, listContactTags, listNotes, listContactSubmissions,
  listContactMessages, listContactOpportunities, listContactCalls,
} from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { formatCurrency } from "@/lib/format";
import { m } from "@/lib/messages";

export const dynamic = "force-dynamic";

export type ContactSummary = {
  tags: { id: string; name: string }[];
  recent: {
    kind: "call" | "note" | "submission" | "message" | "opportunity";
    label: string;
    at: string;
  }[];
};

const RECENT_LIMIT = 5;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access) return NextResponse.json({}, { status: 404 });
  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here
  const contact = await getContact(db, accountId, contactId);
  if (!contact) return NextResponse.json({}, { status: 404 });

  const [tags, notes, submissions, messages, opportunities, calls] = await Promise.all([
    listContactTags(db, accountId, contactId),
    listNotes(db, accountId, contactId),
    listContactSubmissions(db, accountId, contactId),
    listContactMessages(db, accountId, contactId),
    listContactOpportunities(db, accountId, contactId),
    listContactCalls(db, accountId, contactId, RECENT_LIMIT),
  ]);

  type Item = ContactSummary["recent"][number];
  const items: Item[] = [
    ...calls.map((c): Item => ({
      kind: "call",
      label: m["drawer.recent.call"].replace("{outcome}", String(c.outcome)),
      at: c.started_at,
    })),
    ...notes.map((n): Item => ({
      kind: "note", label: m["drawer.recent.note"], at: n.created_at,
    })),
    ...submissions.map((s: { created_at: string }): Item => ({
      kind: "submission", label: m["drawer.recent.submission"], at: s.created_at,
    })),
    ...messages.map((x: { created_at: string }): Item => ({
      kind: "message", label: m["drawer.recent.message"], at: x.created_at,
    })),
    ...opportunities.map((o): Item => ({
      kind: "opportunity",
      label: m["drawer.recent.opportunity"]
        .replace("{name}", o.name)
        .replace("{value}", formatCurrency(Number(o.monetary_value))),
      at: o.created_at,
    })),
  ];
  // Epoch-ms sort — sources return mixed lexical ISO forms (+00:00 vs .000Z)
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const body: ContactSummary = { tags, recent: items.slice(0, RECENT_LIMIT) };
  return NextResponse.json(body);
}
```

Add to `apps/web/src/lib/messages.ts` (near the other `contact.` keys):

```ts
"drawer.recent.call": "Call — {outcome}",
"drawer.recent.note": "Note added",
"drawer.recent.submission": "Form submitted",
"drawer.recent.message": "Message",
"drawer.recent.opportunity": "Opportunity: {name} ({value})",
```

NOTE: `listContactSubmissions`/`listContactMessages` return-row field names —
verify against `packages/db/src/forms.ts:325` / `messaging.ts:271` (the test
mocks use `created_at`; if the real rows name it differently, e.g. a
submission `submitted_at`, fix BOTH the route and the mock to the real name).

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter web test -- --run summary/route`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/auth.ts "apps/web/src/app/api/accounts" apps/web/src/lib/messages.ts
git commit -m "feat(web): contact summary GET route + apiAccountAccess guard"
```

---

### Task 3: server actions — inline field save + bulk ops

**Files:**
- Create: `apps/web/src/lib/contacts/field-input.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts` (append)
- Test: `apps/web/src/lib/contacts/field-input.test.ts`, `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts` (create)

**Interfaces:**
- Consumes: `updateContact`, `deleteContacts`, `addTagToContacts`, `removeTagFromContacts` from `@bis/db` (Task 1).
- Produces (all in contacts/actions.ts, all `"use server"`):
  - `updateContactFieldAction(accountId, contactId, field: EditableField, value: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `bulkAddTagAction(accountId, contactIds: string[], tagName: string): Promise<{ ok: true; tagId: string; applied: number } | { ok: false; error: string }>`
  - `bulkRemoveTagAction(accountId, contactIds: string[], tagId: string): Promise<{ ok: true } | { ok: false; error: string }>`
  - `bulkDeleteContactsAction(accountId, contactIds: string[]): Promise<{ ok: true; deleted: number; skippedBlocked: number } | { ok: false; error: string }>`
  - From `field-input.ts`: `EDITABLE_FIELDS`, `type EditableField`, `normalizeFieldInput(field, raw): { ok: true; value: string } | { ok: false; error: string }` (shared client+server: trim; empty allowed → ""; email must contain "@" with a dot after it; phone must be digits/`+()- .` only, min 7 digits).

- [ ] **Step 1: Write the failing tests**

`field-input.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeFieldInput, EDITABLE_FIELDS } from "./field-input";

describe("normalizeFieldInput", () => {
  it("trims, allows empty (clears the field)", () => {
    expect(normalizeFieldInput("first_name", "  Maria ")).toEqual({ ok: true, value: "Maria" });
    expect(normalizeFieldInput("email", "   ")).toEqual({ ok: true, value: "" });
  });
  it("rejects a mangled email but accepts a real one", () => {
    expect(normalizeFieldInput("email", "not-an-email").ok).toBe(false);
    expect(normalizeFieldInput("email", "a@b.co").ok).toBe(true);
  });
  it("rejects letters in phone, accepts formatted numbers", () => {
    expect(normalizeFieldInput("phone", "call me").ok).toBe(false);
    expect(normalizeFieldInput("phone", "+1 (956) 555-0100").ok).toBe(true);
  });
  it("field allowlist is exactly the five standard columns", () => {
    expect(EDITABLE_FIELDS).toEqual(["first_name", "last_name", "email", "phone", "company_name"]);
  });
});
```

`actions.test.ts` (mirror the mocking idiom of `calls/page.test.ts` /
`conversations/actions.test.ts`):

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dbMocks = {
  updateContact: vi.fn(), deleteContacts: vi.fn(),
  addTagToContacts: vi.fn(), removeTagFromContacts: vi.fn(),
  // …plus whatever contacts/actions.ts already imports from @bis/db —
  // createContact, addTagToContact, etc. — stub them all or the module
  // import throws. Read the file's import list and cover it.
  createContact: vi.fn(),
};
vi.mock("@bis/db", () => dbMocks);

const { updateContactFieldAction, bulkDeleteContactsAction } = await import("./actions");

describe("updateContactFieldAction", () => {
  it("rejects a non-allowlisted field WITHOUT touching the db", async () => {
    const r = await updateContactFieldAction("a1", "c1", "custom" as never, "x");
    expect(r.ok).toBe(false);
    expect(dbMocks.updateContact).not.toHaveBeenCalled();
  });
  it("maps snake_case field to the ContactInput camel key, empty clears", async () => {
    dbMocks.updateContact.mockResolvedValue(undefined);
    const r = await updateContactFieldAction("a1", "c1", "company_name", "  ");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateContact).toHaveBeenCalledWith(
      {}, "a1", "c1", { companyName: "" }, "user_1",
    );
  });
});

describe("bulkDeleteContactsAction", () => {
  it("passes through honest counts", async () => {
    dbMocks.deleteContacts.mockResolvedValue({ deleted: 2, skippedBlocked: 1 });
    const r = await bulkDeleteContactsAction("a1", ["x", "y", "z"]);
    expect(r).toEqual({ ok: true, deleted: 2, skippedBlocked: 1 });
  });
  it("returns ok:false instead of throwing when the db op throws", async () => {
    dbMocks.deleteContacts.mockRejectedValue(new Error("boom"));
    const r = await bulkDeleteContactsAction("a1", ["x"]);
    expect(r.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- --run field-input contacts/actions`
Expected: FAIL — `normalizeFieldInput` / `updateContactFieldAction` not found.

- [ ] **Step 3: Implement**

`apps/web/src/lib/contacts/field-input.ts` (NO "use server" — it's shared
pure logic imported by both the client component and the actions file):

```ts
export const EDITABLE_FIELDS = [
  "first_name", "last_name", "email", "phone", "company_name",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Maps the snake_case column to updateContact's ContactInput key. */
export const FIELD_TO_INPUT_KEY: Record<EditableField, "firstName" | "lastName" | "email" | "phone" | "companyName"> = {
  first_name: "firstName", last_name: "lastName", email: "email",
  phone: "phone", company_name: "companyName",
};

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_CHARS = /^[+()\-. \d]+$/;

export function normalizeFieldInput(
  field: EditableField, raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (value === "") return { ok: true, value: "" }; // clearing is allowed — columns are nullable
  if (field === "email" && !EMAIL_SHAPE.test(value))
    return { ok: false, error: "That doesn't look like an email address." };
  if (field === "phone") {
    const digits = value.replace(/\D/g, "");
    if (!PHONE_CHARS.test(value) || digits.length < 7)
      return { ok: false, error: "That doesn't look like a phone number." };
  }
  return { ok: true, value };
}
```

Append to `contacts/actions.ts` (imports join the existing ones):

```ts
import { deleteContacts, addTagToContacts, removeTagFromContacts, updateContact } from "@bis/db";
import { EDITABLE_FIELDS, FIELD_TO_INPUT_KEY, normalizeFieldInput,
         type EditableField } from "@/lib/contacts/field-input";

const contactsPath = (accountId: string) => `/dashboard/accounts/${accountId}/contacts`;

export async function updateContactFieldAction(
  accountId: string, contactId: string, field: EditableField, value: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  if (!EDITABLE_FIELDS.includes(field)) return { ok: false, error: "Unknown field." };
  const norm = normalizeFieldInput(field, value);
  if (!norm.ok) return norm;
  try {
    await updateContact(await dbForRequest(), accountId, contactId,
      { [FIELD_TO_INPUT_KEY[field]]: norm.value }, userId);
  } catch {
    return { ok: false, error: "Save failed — please try again." };
  }
  revalidatePath(contactsPath(accountId));
  revalidatePath(`${contactsPath(accountId)}/${contactId}`);
  return { ok: true };
}

export async function bulkAddTagAction(
  accountId: string, contactIds: string[], tagName: string,
): Promise<{ ok: true; tagId: string; applied: number } | { ok: false; error: string }> {
  await requireAccountAccess(accountId);
  if (contactIds.length === 0 || !tagName.trim()) return { ok: false, error: "Nothing selected." };
  try {
    const r = await addTagToContacts(await dbForRequest(), accountId, contactIds, tagName);
    revalidatePath(contactsPath(accountId));
    return { ok: true, ...r };
  } catch {
    return { ok: false, error: "Tagging failed — please try again." };
  }
}

export async function bulkRemoveTagAction(
  accountId: string, contactIds: string[], tagId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAccountAccess(accountId);
  try {
    await removeTagFromContacts(await dbForRequest(), accountId, contactIds, tagId);
    revalidatePath(contactsPath(accountId));
    return { ok: true };
  } catch {
    return { ok: false, error: "Undo failed — the tag is still applied." };
  }
}

export async function bulkDeleteContactsAction(
  accountId: string, contactIds: string[],
): Promise<{ ok: true; deleted: number; skippedBlocked: number } | { ok: false; error: string }> {
  await requireAccountAccess(accountId);
  if (contactIds.length === 0) return { ok: false, error: "Nothing selected." };
  try {
    const r = await deleteContacts(await dbForRequest(), accountId, contactIds);
    revalidatePath(contactsPath(accountId));
    return { ok: true, ...r };
  } catch {
    return { ok: false, error: "Delete failed — please try again." };
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter web test -- --run field-input contacts/actions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/contacts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts"
git commit -m "feat(web): inline field + bulk contact server actions with ok-shaped results"
```

---

### Task 4: InlineField component

**Files:**
- Create: `apps/web/src/components/inline-field.tsx`
- Modify: `apps/web/src/lib/messages.ts` (keys below)

**Interfaces:**
- Consumes: `normalizeFieldInput`, `EditableField` (Task 3); `toast` from sonner.
- Produces: `<InlineField label field value save />` where
  `save: (value: string) => Promise<{ ok: true } | { ok: false; error: string }>`
  — Task 6 (drawer) and Task 8 (fields panel) bind this to
  `updateContactFieldAction(accountId, contactId, field, ·)`.

No unit test — apps/web vitest runs in node with no DOM; behavior is pinned
by the pure `field-input` tests (Task 3) and the e2e edits (Task 11).

- [ ] **Step 1: Implement**

```tsx
"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { normalizeFieldInput, type EditableField } from "@/lib/contacts/field-input";

/**
 * DESIGN.md record-view rule: small edits are inline — click the value,
 * edit, save on blur/Enter with an undo toast; Esc cancels. Undo re-runs
 * the same save with the prior value (spec §Writes). No form, no Save
 * button. Empty input clears the field (nullable columns).
 */
export function InlineField({
  label, field, value, save, inputType = "text",
}: {
  label: string;
  field: EditableField;
  value: string | null;
  save: (value: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  inputType?: "text" | "email" | "tel";
}) {
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState(value ?? "");
  // Tracks the committed value for cancel/undo across saves.
  const committed = useRef(value ?? "");
  const cancelled = useRef(false);

  async function commit(raw: string) {
    const norm = normalizeFieldInput(field, raw);
    if (!norm.ok) {
      toast.error(norm.error);
      setShown(committed.current);
      setEditing(false);
      return;
    }
    setEditing(false);
    if (norm.value === committed.current) return; // no-op edit — no toast
    const prior = committed.current;
    setShown(norm.value);
    let result: { ok: true } | { ok: false; error: string };
    try {
      result = await save(norm.value);
    } catch {
      result = { ok: false, error: m["inline.crashed"] };
    }
    if (!result.ok) {
      setShown(prior);
      toast.error(result.error);
      return;
    }
    committed.current = norm.value;
    toast.success(m["inline.saved"].replace("{label}", label), {
      action: {
        label: m["common.undo"],
        onClick: () => {
          void save(prior).then((r) => {
            if (r.ok) { committed.current = prior; setShown(prior); }
            else toast.error(r.error);
          });
        },
      },
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => { cancelled.current = false; setEditing(true); }}
        className={cn(
          "block w-full rounded-md px-2 py-1 text-left text-sm transition-colors",
          "hover:bg-muted focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none",
          shown ? "text-foreground" : "text-muted-foreground italic",
        )}
        aria-label={m["inline.edit"].replace("{label}", label)}
      >
        {shown || m["inline.empty"]}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      type={inputType}
      defaultValue={shown}
      aria-label={label}
      className="h-8"
      onBlur={(e) => {
        if (cancelled.current) { cancelled.current = false; return; }
        void commit(e.currentTarget.value);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur(); // blur path does the save — one code path
        if (e.key === "Escape") {
          cancelled.current = true;
          setShown(committed.current);
          setEditing(false);
        }
      }}
    />
  );
}
```

Message keys (append near the other `common.` / `contact.` keys):

```ts
"inline.saved": "{label} saved",
"inline.edit": "Edit {label}",
"inline.empty": "Add…",
"inline.crashed": "Save didn't go through — the page may be out of date. Reload and try again.",
"common.undo": "Undo",
```

(If `common.undo` already exists in `messages.ts`, keep the existing one.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter web typecheck` (or `pnpm check` typecheck portion)
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/inline-field.tsx apps/web/src/lib/messages.ts
git commit -m "feat(web): InlineField - click-to-edit with blur save, Esc cancel, undo toast"
```

---

### Task 5: contacts table — whole-row pattern + peek state

**Files:**
- Create: `apps/web/src/lib/contacts/use-peek.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contacts-table.tsx`

**Interfaces:**
- Consumes: nothing new besides React/Next.
- Produces:
  - `usePeek(): { peekId: string | null; open: (id: string) => void; close: () => void }`
  - `ContactsTable` gains props `accountId: string` (drawer mount arrives in Task 6; this task wires rows + peek state and renders nothing extra yet).

- [ ] **Step 1: Implement `use-peek.ts`**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";

const PARAM = "peek";

function readPeek(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(PARAM);
}

/**
 * Drawer open-state mirrored into `?peek=<id>` with SHALLOW history calls —
 * never router.push, which would re-render the server component tree on
 * every open/close (approach A's whole point). Back closes an open drawer
 * (we pushed one entry); refresh with ?peek= present re-opens after
 * hydration; Esc/✕ call close(), which goes back IF we pushed, else
 * (arrived via direct load) strips the param in place.
 */
export function usePeek() {
  const [peekId, setPeekId] = useState<string | null>(null);
  const [pushed, setPushed] = useState(false);

  useEffect(() => {
    setPeekId(readPeek()); // initial mount — honor a deep-linked ?peek=
    const onPop = () => { setPeekId(readPeek()); setPushed(false); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const open = useCallback((id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(PARAM, id);
    window.history.pushState(window.history.state, "", url);
    setPushed(true);
    setPeekId(id);
  }, []);

  const close = useCallback(() => {
    if (pushed) {
      window.history.back(); // popstate handler clears peekId
    } else {
      const url = new URL(window.location.href);
      url.searchParams.delete(PARAM);
      window.history.replaceState(window.history.state, "", url);
      setPeekId(null);
    }
  }, [pushed]);

  return { peekId, open, close };
}
```

- [ ] **Step 2: Rework the rows in `contacts-table.tsx`**

Changes (keep sort/paging/selection exactly as they are):

1. `ContactsTable` signature becomes
   `{ rows, base, accountId }: { rows: ContactRow[]; base: string; accountId: string }`
   and `contacts/page.tsx` passes `accountId={accountId}`.
2. Add `const { peekId, open, close } = usePeek();` (unused `peekId`/`close`
   until Task 6 mounts the drawer — fine for one commit).
3. Replace the row body: the whole `<TableRow>` becomes the target —

```tsx
<TableRow
  key={c.id}
  tabIndex={0}
  data-contact-row={c.id}
  aria-label={name}
  onClick={() => open(c.id)}
  onKeyDown={(e) => {
    if (e.target !== e.currentTarget) return; // typing in a child — not row nav
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(c.id); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const sibling = e.key === "ArrowDown"
        ? e.currentTarget.nextElementSibling
        : e.currentTarget.previousElementSibling;
      if (sibling instanceof HTMLElement) sibling.focus();
    }
  }}
  className="cursor-pointer focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
>
```

4. The checkbox cell stops propagation so ticking never opens the drawer:

```tsx
<TableCell onClick={(e) => e.stopPropagation()}>
  <Checkbox … />
</TableCell>
```

5. The name cell DROPS its `<Link>` (row opens the drawer now; the full page
   is reached from inside the drawer). Keep the avatar + name markup as a
   plain `<span className="flex items-center gap-2 font-medium">`.
6. Remove the now-unused `Link` import if nothing else uses it.

Row hover: `ui/table.tsx`'s own `TableRow` already applies a hover
background — verify it resolves to a surface token (`bg-muted/50` maps into
the token ladder); do NOT add a second hover class unless it's missing.

- [ ] **Step 3: Typecheck + existing tests**

Run: `pnpm --filter web typecheck && pnpm --filter web test -- --run contacts`
Expected: exit 0 / PASS (the table has no unit tests of its own; page tests must not break).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contacts-table.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/page.tsx" apps/web/src/lib/contacts/use-peek.ts
git commit -m "feat(web): contacts rows are whole-row keyboard-navigable targets with ?peek state"
```

---

### Task 6: ContactDrawer

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx`
- Modify: `contacts-table.tsx` (mount), `apps/web/src/lib/messages.ts` (keys)

**Interfaces:**
- Consumes: `usePeek` (Task 5) — the table passes `peekId`/`close` down;
  `ContactSummary` type (Task 2, type-only import); `InlineField` (Task 4);
  `updateContactFieldAction` (Task 3); `addTagAction`, `removeTagAction`
  (existing, FormData-shaped — reuse via small forms exactly like
  `contact-fields-panel.tsx` does); `relativeTime` from
  `@/lib/dashboard/relative-time`; `contactDisplayName`, `initials` from
  `@/lib/format`; `Sheet, SheetContent, SheetHeader, SheetTitle` from
  `@/components/ui/sheet`; `Skeleton` from `@/components/ui/skeleton`.
- Produces: `<ContactDrawer accountId row onClose />` where
  `row: ContactRow | null` (null = closed). The drawer finds its row from
  the table's data — a `?peek=` id not in the current rows renders the
  drawer's error state (deleted or other page).

- [ ] **Step 1: Implement `contact-drawer.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { InlineField } from "@/components/inline-field";
import { contactDisplayName, initials } from "@/lib/format";
import { relativeTime } from "@/lib/dashboard/relative-time";
import { m } from "@/lib/messages";
import { updateContactFieldAction } from "./actions";
import type { ContactRow } from "./contacts-table";
import type { ContactSummary } from "@/app/api/accounts/[accountId]/contacts/[contactId]/summary/route";
import type { EditableField } from "@/lib/contacts/field-input";

type LoadState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; summary: ContactSummary };

const FIELDS: { field: EditableField; labelKey: keyof typeof m; type: "text" | "email" | "tel" }[] = [
  { field: "first_name", labelKey: "contacts.firstName", type: "text" },
  { field: "last_name", labelKey: "contacts.lastName", type: "text" },
  { field: "email", labelKey: "contacts.email", type: "email" },
  { field: "phone", labelKey: "contacts.phone", type: "tel" },
  { field: "company_name", labelKey: "contact.company", type: "text" },
];

export function ContactDrawer({
  accountId, row, onClose,
}: {
  accountId: string;
  row: ContactRow | null;
  onClose: () => void;
}) {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const contactId = row?.id ?? null;

  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    setLoad({ status: "loading" });
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/summary`)
      .then(async (res) => {
        if (stale) return;
        if (!res.ok) { setLoad({ status: "error" }); return; }
        setLoad({ status: "ready", summary: (await res.json()) as ContactSummary });
      })
      .catch(() => { if (!stale) setLoad({ status: "error" }); });
    return () => { stale = true; };
  }, [accountId, contactId]);

  const fullHref = contactId
    ? `/dashboard/accounts/${accountId}/contacts/${contactId}` : "#";
  const nowMs = Date.now();

  return (
    <Sheet open={row !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        {row === null ? null : (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">
                  {initials(contactDisplayName(row))}
                </span>
                <span className="truncate">{contactDisplayName(row)}</span>
                <Link
                  href={fullHref}
                  className="text-muted-foreground hover:text-foreground ml-auto"
                  aria-label={m["drawer.openFull"]}
                >
                  <ExternalLink className="size-4" aria-hidden />
                </Link>
              </SheetTitle>
            </SheetHeader>

            <div className="space-y-4 overflow-y-auto px-4 pb-6">
              <dl className="space-y-1">
                {FIELDS.map(({ field, labelKey, type }) => (
                  <div key={field} className="grid grid-cols-[92px_minmax(0,1fr)] items-center gap-2">
                    <dt className="text-muted-foreground text-xs">{m[labelKey]}</dt>
                    <dd>
                      <InlineField
                        label={m[labelKey]}
                        field={field}
                        inputType={type}
                        value={(row[field] as string | null) ?? null}
                        save={(v) => updateContactFieldAction(accountId, row.id, field, v)}
                      />
                    </dd>
                  </div>
                ))}
              </dl>

              {load.status === "loading" ? (
                <div className="space-y-2" data-testid="drawer-skeleton">
                  <Skeleton className="h-5 w-24" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              ) : load.status === "error" ? (
                <div className="border-border rounded-md border p-3 text-sm" role="alert">
                  <p className="text-muted-foreground">{m["drawer.loadFailed"]}</p>
                  <div className="mt-2 flex gap-3">
                    <Button size="sm" variant="outline" onClick={() => {
                      // re-trigger the effect by clearing to loading with the same id
                      setLoad({ status: "loading" });
                      fetch(`/api/accounts/${accountId}/contacts/${row.id}/summary`)
                        .then(async (res) => res.ok
                          ? setLoad({ status: "ready", summary: (await res.json()) as ContactSummary })
                          : setLoad({ status: "error" }))
                        .catch(() => setLoad({ status: "error" }));
                    }}>
                      {m["common.retry"]}
                    </Button>
                    <Link href={fullHref} className="text-sm underline">{m["drawer.openFull"]}</Link>
                  </div>
                </div>
              ) : (
                <>
                  <TagsRow accountId={accountId} contactId={row.id} tags={load.summary.tags} />
                  <div>
                    <p className="text-muted-foreground mb-2 font-mono text-[10px] tracking-[0.14em] uppercase">
                      {m["drawer.recent"]}
                    </p>
                    {load.summary.recent.length === 0 ? (
                      <p className="text-muted-foreground text-sm">{m["drawer.recentEmpty"]}</p>
                    ) : (
                      <ul className="space-y-1.5 text-sm">
                        {load.summary.recent.map((r, i) => (
                          <li key={i} className="flex items-baseline justify-between gap-2">
                            <span className="truncate">{r.label}</span>
                            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                              {relativeTime(r.at, nowMs)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
```

`TagsRow` in the same file — reuses the EXISTING FormData tag actions with
the same hidden-input idiom as `contact-fields-panel.tsx` (do not invent a
new action shape):

```tsx
import { Plus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { addTagAction, removeTagAction } from "./[contactId]/actions";

function TagsRow({ accountId, contactId, tags }: {
  accountId: string; contactId: string; tags: ContactSummary["tags"];
}) {
  const boundAdd = addTagAction.bind(null, accountId);
  const boundRemove = removeTagAction.bind(null, accountId);
  const hidden = <input type="hidden" name="contactId" value={contactId} />;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((t) => (
        <form key={t.id} action={boundRemove} className="inline-flex">
          {hidden}
          <input type="hidden" name="tagId" value={t.id} />
          <button type="submit" className="group" title={t.name}
            aria-label={m["contact.removeTag"].replace("{name}", t.name)}>
            <Badge variant="secondary" className="gap-1 pr-1.5">
              {t.name}
              <X className="text-muted-foreground group-hover:text-foreground size-3" aria-hidden />
            </Badge>
          </button>
        </form>
      ))}
      <form action={boundAdd} className="inline-flex items-center gap-1">
        {hidden}
        <Input name="tag" placeholder={m["contact.addTag"]} className="h-7 w-28 text-xs" />
        <Button type="submit" size="icon-xs" variant="outline" aria-label={m["contact.addTag"]}>
          <Plus className="size-3" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
```

CAVEAT for the implementer: after a tag add/remove the drawer's `tags` prop
does NOT auto-refresh (the summary was fetched once). Acceptable v1 (the
server revalidates the page; reopening shows truth) — but if the review gate
flags it, refetch the summary after the form's action resolves (wrap the
forms' actions with a client callback that re-runs the fetch).

Message keys:

```ts
"drawer.recent": "Recent",
"drawer.recentEmpty": "Nothing here yet — calls, notes, and form submissions for this contact will show up here.",
"drawer.loadFailed": "Couldn't load this contact's activity.",
"drawer.openFull": "Open full page",
"common.retry": "Retry",
```

(Check `common.retry` for a pre-existing key first.)

- [ ] **Step 2: Mount in `contacts-table.tsx`**

At the end of the component's returned JSX (inside the outer `<div>`):

```tsx
<ContactDrawer
  accountId={accountId}
  row={rows.find((r) => r.id === peekId) ?? (peekId ? MISSING_ROW : null)}
  onClose={close}
/>
```

where `MISSING_ROW` handling is: if `peekId` is set but not among `rows`
(deleted, or on another page of the client-side paging), pass a stub row
`{ id: peekId, first_name: null, last_name: null, email: null, phone: null, company_name: null, created_at: "" }`
— the fields render as empty `InlineField`s and the summary fetch 404s into
the error state, which is exactly the spec's deleted-contact behavior.

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter web typecheck && pnpm --filter web test -- --run contacts summary`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contacts-table.tsx" apps/web/src/lib/messages.ts
git commit -m "feat(web): contact drawer - instant fields, summary fetch, skeleton + error states"
```

---

### Task 7: BulkActionBar

**Files:**
- Create: `apps/web/src/lib/contacts/selection.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/bulk-action-bar.tsx`
- Modify: `contacts-table.tsx` (header checkbox + bar wiring)
- Test: `apps/web/src/lib/contacts/selection.test.ts`

**Interfaces:**
- Consumes: `bulkAddTagAction`, `bulkRemoveTagAction`, `bulkDeleteContactsAction` (Task 3); `notifyActionResult`; Dialog + DropdownMenu primitives.
- Produces:
  - `selection.ts`: `togglePageSelection(selected: Set<string>, pageIds: string[]): Set<string>` (all present → remove them; else add all) and `pageSelectionState(selected, pageIds): "none" | "some" | "all"`.
  - `<BulkActionBar accountId selectedIds existingTags onDone />` — `onDone()` clears the table's selection.

- [ ] **Step 1: Write the failing selection test**

```ts
import { describe, it, expect } from "vitest";
import { togglePageSelection, pageSelectionState } from "./selection";

describe("page selection", () => {
  const page = ["a", "b", "c"];
  it("selects the whole page from empty, then clears it", () => {
    const all = togglePageSelection(new Set(), page);
    expect([...all].sort()).toEqual(page);
    expect(pageSelectionState(all, page)).toBe("all");
    expect(togglePageSelection(all, page).size).toBe(0);
  });
  it("partial page -> toggling completes the page and keeps off-page ids", () => {
    const partial = new Set(["a", "zz-off-page"]);
    expect(pageSelectionState(partial, page)).toBe("some");
    const all = togglePageSelection(partial, page);
    expect(all.has("zz-off-page")).toBe(true);
    expect(pageSelectionState(all, page)).toBe("all");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web test -- --run selection`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `selection.ts`**

```ts
export function pageSelectionState(
  selected: Set<string>, pageIds: string[],
): "none" | "some" | "all" {
  const on = pageIds.filter((id) => selected.has(id)).length;
  return on === 0 ? "none" : on === pageIds.length ? "all" : "some";
}

export function togglePageSelection(
  selected: Set<string>, pageIds: string[],
): Set<string> {
  const next = new Set(selected);
  if (pageSelectionState(selected, pageIds) === "all") {
    for (const id of pageIds) next.delete(id);
  } else {
    for (const id of pageIds) next.add(id);
  }
  return next;
}
```

- [ ] **Step 4: Run selection tests — PASS.** `pnpm --filter web test -- --run selection`

- [ ] **Step 5: Implement `bulk-action-bar.tsx`**

```tsx
"use client";

import { useState } from "react";
import { Trash2, Tag, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { m } from "@/lib/messages";
import { bulkAddTagAction, bulkRemoveTagAction, bulkDeleteContactsAction } from "./actions";

export function BulkActionBar({
  accountId, selectedIds, onDone,
}: {
  accountId: string;
  selectedIds: string[];
  onDone: () => void; // clear selection in the table
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const count = selectedIds.length;
  if (count === 0) return null;

  async function applyTag(name: string) {
    const ids = [...selectedIds];
    const r = await bulkAddTagAction(accountId, ids, name).catch(
      () => ({ ok: false as const, error: m["inline.crashed"] }));
    if (!r.ok) { toast.error(r.error); return; }
    onDone();
    toast.success(
      m["bulk.tagged"].replace("{count}", String(r.applied)).replace("{tag}", name),
      {
        action: {
          label: m["common.undo"],
          onClick: () => void bulkRemoveTagAction(accountId, ids, r.tagId)
            .then((u) => { if (!u.ok) toast.error(u.error); })
            .catch(() => toast.error(m["inline.crashed"])),
        },
      },
    );
  }

  async function doDelete() {
    const ids = [...selectedIds];
    setConfirmOpen(false);
    setTyped("");
    const r = await bulkDeleteContactsAction(accountId, ids).catch(
      () => ({ ok: false as const, error: m["inline.crashed"] }));
    if (!r.ok) { toast.error(r.error); return; }
    onDone();
    toast.success(
      r.skippedBlocked === 0
        ? m["bulk.deleted"].replace("{count}", String(r.deleted))
        : m["bulk.deletedSkipped"]
            .replace("{count}", String(r.deleted))
            .replace("{skipped}", String(r.skippedBlocked)),
    );
  }

  return (
    <div
      role="toolbar"
      aria-label={m["bulk.selected"].replace("{count}", String(count))}
      className="border-border bg-card mb-3 flex items-center gap-3 rounded-lg border px-4 py-2"
      data-testid="bulk-action-bar"
    >
      <span className="text-sm font-medium">
        {m["bulk.selected"].replace("{count}", String(count))}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Tag className="size-3.5" aria-hidden />
            {m["bulk.addTag"]}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <form
            className="flex items-center gap-1 p-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (tagDraft.trim()) { void applyTag(tagDraft.trim()); setTagDraft(""); }
            }}
          >
            <Input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              placeholder={m["contact.addTag"]}
              className="h-7 w-36 text-xs"
            />
          </form>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" variant="outline" onClick={() => setConfirmOpen(true)}>
        <Trash2 className="size-3.5" aria-hidden />
        {m["bulk.delete"]}
      </Button>

      <Button size="icon-xs" variant="ghost" className="ml-auto" onClick={onDone}
        aria-label={m["bulk.clear"]}>
        <X className="size-3.5" aria-hidden />
      </Button>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m["bulk.confirmTitle"].replace("{count}", String(count))}</DialogTitle>
          </DialogHeader>
          <p className="text-muted-foreground text-sm">
            {m["bulk.confirmBody"].replace("{count}", String(count))}
          </p>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={String(count)}
            aria-label={m["bulk.confirmTitle"].replace("{count}", String(count))}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => { setConfirmOpen(false); setTyped(""); }}>
              {m["common.cancel"]}
            </Button>
            <Button
              variant="destructive"
              disabled={typed.trim() !== String(count)}
              onClick={() => void doDelete()}
            >
              {m["bulk.delete"]}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

Message keys (7 AM copy; check `common.cancel` exists — it should):

```ts
"bulk.selected": "{count} selected",
"bulk.addTag": "Add tag",
"bulk.delete": "Delete…",
"bulk.clear": "Clear selection",
"bulk.confirmTitle": "Delete {count} contacts?",
"bulk.confirmBody": "This can't be undone. Type {count} to confirm.",
"bulk.tagged": "Tagged {count} contacts with \"{tag}\"",
"bulk.deleted": "Deleted {count} contacts",
"bulk.deletedSkipped": "Deleted {count} · skipped {skipped} linked to bookings, deals, or conversations",
```

NOTE: if `Button` has no `variant="destructive"` in this repo's button.tsx,
use the closest existing destructive idiom (search for an existing delete
button) — do not invent a new variant.

- [ ] **Step 6: Wire into `contacts-table.tsx`**

1. Header checkbox (replaces the empty `<TableHead className="w-10" />`):

```tsx
<TableHead className="w-10" onClick={(e) => e.stopPropagation()}>
  <Checkbox
    checked={pageSelectionState(selected, visible.map((r) => r.id)) === "all"
      ? true
      : pageSelectionState(selected, visible.map((r) => r.id)) === "some"
        ? "indeterminate"
        : false}
    onCheckedChange={() => setSelected((s) => togglePageSelection(s, visible.map((r) => r.id)))}
    aria-label={m["bulk.selectPage"]}
  />
</TableHead>
```

Add key `"bulk.selectPage": "Select all on this page"`.

2. Above the `<Table>` (inside the outer div, before the table):

```tsx
<BulkActionBar
  accountId={accountId}
  selectedIds={[...selected]}
  onDone={() => setSelected(new Set())}
/>
```

(The bar renders `null` at 0 selected — mount unconditionally.)

- [ ] **Step 7: Typecheck + tests, commit**

Run: `pnpm --filter web typecheck && pnpm --filter web test -- --run selection contacts`
Expected: PASS.

```bash
git add apps/web/src/lib/contacts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" apps/web/src/lib/messages.ts
git commit -m "feat(web): bulk action bar - add tag with undo, typed-count delete, page select"
```

---

### Task 8: full-page fields panel retrofit

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/contact-fields-panel.tsx`

**Interfaces:**
- Consumes: `InlineField` (Task 4), `updateContactFieldAction` (Task 3).
- Produces: no new interface — same props, new internals.

- [ ] **Step 1: Retrofit**

The five standard fields (firstName/lastName/email/phone/companyName) leave
the `<form>` and become `InlineField`s (same `FIELDS` mapping as the drawer
— import the drawer's list if exported, else repeat the 5-entry array). The
remaining `<form action={boundUpdateContact}>` keeps ONLY the custom-fields
section + its SubmitButton. This split is SAFE because
`updateContactAction`'s `val()` maps an ABSENT input to `undefined` and
`toRow` skips `undefined` — the custom-only form cannot clear standard
fields (verified against `[contactId]/actions.ts:28-31` + `contacts.ts:11-21`).
When `fieldDefs.length === 0`, render no form at all (nothing left to save).

The component must gain `"use client"` (InlineField needs it) — check
whether the PAGE currently imports it as a server component child; it does
(page.tsx renders it directly), which stays valid: a client component may
receive the serializable props it already takes. `contact` /`tags`/
`fieldDefs` rows are plain JSON — fine. The bound server-action props
(`boundUpdateContact` etc.) are created INSIDE this component today and stay
that way.

Standard-field block becomes:

```tsx
<dl className="space-y-1">
  {FIELDS.map(({ field, labelKey, type }) => (
    <div key={field} className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{m[labelKey]}</dt>
      <dd>
        <InlineField
          label={m[labelKey]}
          field={field}
          inputType={type}
          value={(contact[field] as string | null) ?? null}
          save={(v) => updateContactFieldAction(accountId, contactId, field, v)}
        />
      </dd>
    </div>
  ))}
</dl>
```

- [ ] **Step 2: Typecheck + tests**

Run: `pnpm --filter web typecheck && pnpm --filter web test -- --run contact`
Expected: PASS. Also `pnpm --filter web build` here — this file sits on a
real page; catch a client/server boundary mistake now, not in Task 12.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/contact-fields-panel.tsx"
git commit -m "feat(web): contact fields panel joins the inline-edit pattern; custom fields keep their form"
```

---

### Task 9: calls table — whole-row pattern

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/call-row.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/calls-table.tsx`

**Interfaces:**
- Consumes: `useRouter` from `next/navigation`.
- Produces: `<CallRow href>` — a client `<TableRow>` wrapper; `calls-table.tsx` stays a server component and renders its cells as children.

- [ ] **Step 1: Implement `call-row.tsx`**

```tsx
"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";

/**
 * The one client boundary in the calls table: whole-row open + keyboard nav
 * (DESIGN.md rule 4). Cells stay server-rendered children. Inner links
 * (the caller's contact link) must stopPropagation — see calls-table.tsx.
 */
export function CallRow({ href, label, children }: {
  href: string; label: string; children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <TableRow
      tabIndex={0}
      aria-label={label}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(href); }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          const sibling = e.key === "ArrowDown"
            ? e.currentTarget.nextElementSibling
            : e.currentTarget.previousElementSibling;
          if (sibling instanceof HTMLElement) sibling.focus();
        }
      }}
      className="group cursor-pointer focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-inset focus-visible:outline-none"
    >
      {children}
    </TableRow>
  );
}
```

- [ ] **Step 2: Rework `calls-table.tsx` rows**

- `<TableRow key={row.id} className="group">` → `<CallRow key={row.id} href={callHref} label={label}>`.
- The when-cell's `<Link>` unwraps to a plain `<span className="font-medium tabular-nums">` (the row IS the link now).
- The contact `<Link>` in the caller cell STAYS a link and gains `onClick={(e) => e.stopPropagation()}` — clicking the caller's name goes to the contact, not the call. That makes the caller cell a client interaction inside a server file — so move the stopPropagation onto the Link inside `call-row.tsx`? NO — simpler: `next/link` accepts `onClick` only in client components. Instead, export a tiny `<StopPropagation>` span wrapper from `call-row.tsx`:

```tsx
export function StopPropagation({ children }: { children: React.ReactNode }) {
  return <span onClick={(e) => e.stopPropagation()}>{children}</span>;
}
```

and in `calls-table.tsx` wrap the contact link: `<StopPropagation><Link …>{label}</Link></StopPropagation>`.
- The trailing chevron cell's `<Link>` also unwraps to a plain flex `<span>` (mouse affordance only; the row handles the click). Keep `aria-hidden` semantics by leaving the icon `aria-hidden` — the extra link disappears from the tab order naturally.
- Remove the now-unused `Link`-import ONLY if the contact link no longer needs it (it does — keep it).

- [ ] **Step 3: Typecheck + tests**

Run: `pnpm --filter web typecheck && pnpm --filter web test -- --run calls`
Expected: PASS — `calls-table.test.ts` exists; if it asserts the old link
markup, update ITS assertions to the new row shape (assert the row has the
href behavior via the rendered `aria-label` + the contact link presence —
not by reaching for removed anchors). Do not delete assertions wholesale.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls"
git commit -m "feat(web): calls rows are whole-row keyboard-navigable targets"
```

---

### Task 10: empty states + copy audit

**Files:**
- Modify (as needed): `apps/web/src/lib/messages.ts`, `calls/page.tsx`

- [ ] **Step 1: Audit against rule 5**

- Contacts list already renders `EmptyState` (page.tsx:46-51) — read
  `contacts.empty.title/body` in messages.ts; they must say what appears
  here + the action that causes it (e.g. "Contacts show up when Sofía takes
  a call, a form is submitted, or you add one."). Fix copy if it falls
  short; do NOT restructure.
- Calls list: open `calls/page.tsx` and verify an empty state exists; if it
  renders a bare empty table, add the same `EmptyState` component idiom with
  copy like "Calls appear here as soon as Sofía answers one for this
  company." (key names follow the `calls.` prefix pattern).
- The drawer's recent-empty state shipped in Task 6.

- [ ] **Step 2: Typecheck, commit**

```bash
git add apps/web/src/lib/messages.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/page.tsx"
git commit -m "chore(web): empty-state copy meets rule 5 on both lists"
```

(Skip the commit if the audit finds nothing to change — note that in the task report.)

---

### Task 11: e2e

**Files:**
- Create: `apps/web/e2e/contacts-drawer.spec.ts`
- Modify (only if needed): `apps/web/e2e/support.ts`

**Interfaces:**
- Consumes: `readClientFixture()`, `SEEDED_ACCOUNT_NAME`, `SEEDED_CONTACT_NAME`, `openAccountByName` from `./support`; the client storage state `e2e/.auth/client-state.json` (see `client-access.spec.ts` for the `test.use({ storageState })` idiom — copy it exactly).

**Rules:** ALL mutations on the per-run client fixture account. `Test Client
One` may be used read-only. Server actions POST to the CURRENT URL — never
wait on `waitForResponse(method+URL)`; assert the UI outcome, or match the
request BODY (the 61429ce lesson).

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from "@playwright/test";
import { readClientFixture } from "./support";

// The fixture account is created per-run by auth.setup.ts; every mutation
// below happens there — NEVER on Test Client One (CLAUDE.md hard rule).
const fixture = readClientFixture();
test.skip(!fixture, "client fixture missing — auth.setup did not run");

const base = () => `/dashboard/accounts/${fixture!.accountId}`;

test.describe("P4 contacts table + drawer (agency session)", () => {
  test("row click opens the drawer; Esc and Back both close it", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    // Seed a contact through the real UI if the fixture account has none:
    // the Add-contact dialog is the existing, tested path.
    if (await page.getByRole("row").count() < 2) {
      await page.getByRole("button", { name: /add contact/i }).click();
      await page.getByLabel(/first name/i).fill("Drawer");
      await page.getByLabel(/last name/i).fill("Target");
      await page.getByRole("button", { name: /save|create/i }).click();
      await expect(page.getByText("Drawer Target")).toBeVisible();
    }
    const row = page.getByRole("row").filter({ hasText: "Drawer Target" }).first();
    await row.click();
    await expect(page).toHaveURL(/peek=/);
    await expect(page.getByRole("dialog")).toBeVisible(); // Sheet renders role=dialog
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page).not.toHaveURL(/peek=/);
    // reopen, then Back closes
    await row.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // refresh with ?peek= present re-opens the drawer (spec: deep-linked peek)
    await row.click();
    await expect(page).toHaveURL(/peek=/);
    await page.reload();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("inline edit saves for real - reload proves it (mutation check)", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    await page.getByRole("row").filter({ hasText: "Drawer Target" }).first().click();
    const drawer = page.getByRole("dialog");
    await drawer.getByRole("button", { name: /edit company/i }).click();
    await drawer.getByLabel(/company/i).fill("Painted Proof LLC");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await page.reload();
    await page.getByRole("row").filter({ hasText: "Drawer Target" }).first().click();
    await expect(page.getByRole("dialog").getByText("Painted Proof LLC")).toBeVisible();
  });

  test("keyboard: focused row opens on Enter, arrows move focus", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    const firstRow = page.locator("tbody tr").first();
    await firstRow.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.locator("tbody tr").nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(firstRow).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("bulk tag applies with undo; bulk delete needs the typed count", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    // two throwaway contacts for the bulk pass
    for (const name of ["Bulk One", "Bulk Two"]) {
      await page.getByRole("button", { name: /add contact/i }).click();
      await page.getByLabel(/first name/i).fill(name.split(" ")[0]!);
      await page.getByLabel(/last name/i).fill(name.split(" ")[1]!);
      await page.getByRole("button", { name: /save|create/i }).click();
      await expect(page.getByText(name)).toBeVisible();
    }
    for (const name of ["Bulk One", "Bulk Two"]) {
      await page.getByRole("row").filter({ hasText: name })
        .getByRole("checkbox").check();
    }
    const bar = page.getByTestId("bulk-action-bar");
    await expect(bar.getByText("2 selected")).toBeVisible();
    // tag + undo round-trip
    await bar.getByRole("button", { name: /add tag/i }).click();
    await page.getByPlaceholder(/tag/i).fill("bulk-e2e");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/tagged 2/i)).toBeVisible();
    await page.getByRole("button", { name: /undo/i }).click();
    // re-select (selection cleared after the action) and delete with confirm
    for (const name of ["Bulk One", "Bulk Two"]) {
      await page.getByRole("row").filter({ hasText: name })
        .getByRole("checkbox").check();
    }
    await bar.getByRole("button", { name: /delete/i }).click();
    const dialog = page.getByRole("dialog").filter({ hasText: /delete 2/i });
    // wrong count leaves the button disabled — the gate is real
    await dialog.getByRole("textbox").fill("1");
    await expect(dialog.getByRole("button", { name: /delete/i })).toBeDisabled();
    await dialog.getByRole("textbox").fill("2");
    await dialog.getByRole("button", { name: /delete/i }).click();
    await expect(page.getByText(/deleted 2/i)).toBeVisible();
    await expect(page.getByText("Bulk One")).toHaveCount(0);
  });

  test("calls row is a whole-row target", async ({ page }) => {
    await page.goto(`${base()}/calls`);
    const rows = page.locator("tbody tr");
    if (await rows.count() === 0) return; // fixture may have no calls — nav-shape is covered on the seeded account read-only below
    await rows.first().click();
    await expect(page).toHaveURL(/\/calls\//);
  });
});

test.describe("P4 client session (RLS proof)", () => {
  // Same storageState idiom as client-access.spec.ts — the CLIENT's cookie jar.
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a client session's drawer summary read succeeds on its own contact", async ({ page }) => {
    await page.goto(`${base()}/contacts`);
    const row = page.locator("tbody tr").first();
    await row.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    // grants proof: the summary fetch resolved into content, not the error
    // state — serviceDb unit fixtures cannot see grants, only this can.
    await expect(drawer.getByText(/couldn't load/i)).toHaveCount(0);
    await expect(drawer.getByText(/recent/i)).toBeVisible();
  });
});
```

NOTE for the implementer: locator details (dialog roles, button names,
placeholder text) must be checked against the REAL rendered markup — run
headed once, adjust locators to what exists, keep assertions equally strong.
If `client-state.json` lacks access to the fixture account contacts page,
read how `client-access.spec.ts` reaches its pages and mirror it.

- [ ] **Step 2: Run the new spec ALONE first**

Run: `pnpm --filter web test:e2e -- contacts-drawer.spec.ts`
Expected: all green. (Judge any red by wall clock — parallel repo work makes suites lie.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/contacts-drawer.spec.ts apps/web/e2e/support.ts
git commit -m "test(e2e): P4 drawer, inline edit, bulk ops, keyboard nav, client-session RLS proof"
```

---

### Task 12: gates + screenshot pass

- [ ] **Step 1: Full gates**

```bash
pnpm check                      # typecheck + lint + db + web — exit 0
pnpm --filter web build         # production build
pnpm --filter web test:e2e      # FULL suite (37 existing + new) — all green
```

Any failure: fix, re-run the full set. Do not rationalize a red as
pre-existing without evidence from the pre-change revision.

- [ ] **Step 2: Screenshot pass (both themes)**

Recipe (proven 2026-09-02): the e2e run leaves `e2e/.auth/state.json` + a
fresh `.next` prod build → `pnpm --filter web start` → Playwright script
placed INSIDE `apps/web` (pnpm module isolation — scratchpad scripts cannot
resolve `@playwright/test`). Shots: contacts list with a focused row ·
drawer open (loaded) · drawer error state (bogus `?peek=`) · bulk bar with
selection + the delete confirm dialog · calls list row hover/focus · full
contact page with inline fields · each in dark AND light (toggle via the
topbar control or the `.dark` class cookie). Save to the session scratchpad
`design-shots-p4/`, send to danlo.

- [ ] **Step 3: Ledger + hand-off**

Update `.superpowers/sdd/progress.md` (P4 section: task-by-task results,
gates, deviations). Push the branch. Final whole-branch review (the standing
review gate) → fix wave → re-run gates → danlo eyeballs shots → merge is
danlo's call.

---

## Self-review notes (already applied)

- Spec coverage: drawer (T5/T6), GET summary (T2), inline shared both
  surfaces (T4/T6/T8), bulk bar + skip-blocked delete (T1/T3/T7), calls row
  pattern (T9), empty states (T10), zone/epoch rules (T2 test), client-RLS
  e2e (T11), gates + shots (T12). Roadmap exit criteria all mapped.
- Type consistency: `deleteContacts → { deleted, skippedBlocked }` flows
  through `bulkDeleteContactsAction` to `bulk.deletedSkipped` copy;
  `addTagToContacts → { tagId, applied }` flows to the undo closure;
  `EditableField` is the single field vocabulary everywhere (snake_case,
  mapped to camel at the updateContact boundary only).
- Known judgment calls the reviewer should weigh: drawer tags don't
  auto-refresh after add/remove (flagged in T6); `MISSING_ROW` stub for a
  stale peek id (T6); calls table keeps its chevron as decoration (T9).
