# Contact archive, internal-only delete and no placeholder names: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff archive any contact at once with Undo, restore it by hand or when the customer gets in touch again, delete for good only a contact with nothing but internal work on it, and stop Sofía storing "Unknown" as a name.

**Architecture:** Migration 0103 adds `contacts.archived_at`/`archived_by`, an append-only `contact_archive_log`, a stamp trigger, a log trigger, and three service-role functions (`restore_contact_on_sign`, `contact_delete_blockers`, `delete_internal_contacts`). Every list read filters archived contacts through one helper per module. Each customer-contact entry point calls `restoreContactOnSign`. The UI adds Archive and Restore to the bulk bar, the record header and the drawer, plus an Archived view of the list.

**Tech Stack:** Postgres 17 (Supabase) migrations, supabase-js/PostgREST, Next.js App Router server actions, React, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-28-contact-archive-design.md` (owner rulings in its §11). Every count below was read off the files at `a932a2dd` on 2026-10-28.

## Global Constraints

- Migration number is **0103**. Another lane holds 0102. No agent applies a migration to any Supabase project: 0103 is proven only on a local PG18 replica.
- **No `@bis/db` vitest file built on `withTestAccount` or `serviceDb` runs anywhere locally in this lane**, and nothing runs against bis-ci before the orchestrator confirms 0103 is applied there. This worktree has no `packages/db/.env` and no `apps/web/.env.local` (checked 2026-10-28). Never create one, and never export `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` in a shell. Without them, `src/test/global-setup.ts:31-33` skips the sweep.
- Local db runs are exactly one of two kinds: `withRollback` files against the replica (`SUPABASE_DB_URL=postgresql://postgres@localhost:<your port>/post`), or pure fake-client files in `packages/db/src/*.test.ts`. Files built on `withTestAccount` (named `*-live.test.ts` here) are proven in CI's `verify` job, which builds its own stack from the branch's migrations (`.github/scripts/ci-local-supabase.sh`).
- Replica recipe: memory `bis-local-db-replica`. Use PG18 at `C:\Program Files\PostgreSQL\18`, your own port (55433 + your task number), and your own scratch directory. Use `initdb -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US`. Create `pre` with every migration through 0101, plus 0102 from its branch if the orchestrator gives you its path. Then `create database post template pre` and apply 0103 to `post`.
- Copy follows DESIGN.md's 7 AM rule in English and in usted Spanish. Every English key has its `.es` twin on the very next line. No milestone codes, no `{{template}}`, no arrows. A name shown to a customer is never `accounts.name`.
- DESIGN.md rules 4 (bulk bar), 5 (loaded, empty and error states), 6 (Undo toast; typed-name confirm for anything irreversible), 7 (skeletons, no spinners) and 8 (one primary per view; Call stays the header's one primary) bind every UI task.
- Archive and Restore: Owners, Staff and the agency (`seesWholeAccount`, `apps/web/src/lib/auth-role.ts:15-17`). Technicians may not. Permanent delete: Owner and agency only (`requireAccountOwner`; `canManage`, `apps/web/src/lib/auth.ts:63,80`).
- e2e runs only on the per-run fixture account (`fullFixture()`, `apps/web/e2e/contacts-drawer.spec.ts:84-93`), never on `Test Client One`. Only bis-e2e-qa runs Playwright.
- Commits: `git add <explicit paths>` and `git commit -- <paths>`. Never `-A`, `.`, stash, checkout, amend or push. If `.git/index.lock` exists, wait and retry.
- Gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) are the orchestrator's.

---

## Shared facts every task relies on

### Interfaces (produced by T1 and T4, consumed everywhere else)

SQL (T1, migration 0103):

```text
contacts.archived_at timestamptz null        -- client-writable (column grant); the stamp trigger sets now()
contacts.archived_by text null               -- stamped by trigger; never client-written
public.contact_archive_log(id bigint, account_id uuid, contact_id uuid, action 'archived'|'restored',
  author_kind 'person'|'customer', author_id text null, sign text null, created_at timestamptz)
public.restore_contact_on_sign(p_account_id uuid, p_contact_id uuid, p_sign text) returns boolean   -- service_role
public.contact_delete_blockers(p_account_id uuid, p_contact_ids uuid[]) returns table(contact_id uuid, reasons text[])  -- service_role
public.delete_internal_contacts(p_account_id uuid, p_contact_ids uuid[]) returns uuid[]           -- service_role
```

TypeScript (T4, `packages/db/src/contacts.ts`, exported from `packages/db/src/index.ts`):

```ts
export type ArchivedFilter = "exclude" | "only";
export const RESTORE_SIGNS = ["text", "email", "call", "booking", "form", "chat"] as const;
export type RestoreSign = (typeof RESTORE_SIGNS)[number];
export const DELETE_BLOCK_REASONS = ["messages", "inbound_email", "calls", "forms", "consent", "automations", "bookings", "deals"] as const;
export type DeleteBlockReason = (typeof DELETE_BLOCK_REASONS)[number];
export const MAX_CONTACT_BATCH = 500;

listContacts(db, accountId, opts: { …existing; archived?: ArchivedFilter })   // default "exclude"
countContacts(db, accountId, opts: { …existing; archived?: ArchivedFilter })  // default "exclude"
archiveContacts(db: SupabaseClient, accountId: string, contactIds: string[]): Promise<{ changedIds: string[] }>
restoreContacts(db: SupabaseClient, accountId: string, contactIds: string[]): Promise<{ changedIds: string[] }>
restoreContactOnSign(serviceDb: SupabaseClient, accountId: string, contactId: string, sign: RestoreSign): Promise<boolean>
contactDeleteBlockers(serviceDb: SupabaseClient, accountId: string, contactIds: string[]): Promise<Map<string, DeleteBlockReason[]>>
deleteContacts(db, accountId, contactIds, opts: { serviceDb: SupabaseClient; beforeDelete?: (deletable: string[]) => Promise<string[]> })
  : Promise<{ deleted: number; skippedBlocked: number; skippedFiles: number; skippedIds: string[]; lateKept: number }>
```

`COLS` (`contacts.ts:78-79`) gains `archived_at, archived_by`, so `getContact`/`listContacts` rows carry both.

Server actions (T10, new file `ACCT/contacts/archive-actions.ts`; T11 consumes them):

```ts
export type ArchiveActionResult =
  | { ok: true; changedIds: string[]; nextAppointment: { contactId: string; startsAt: string } | null; withAppointments: number }
  | { ok: false; errorKey: "contacts.archive.failed" | "contacts.restore.failed" };
export async function archiveContactsAction(accountId: string, contactIds: string[]): Promise<ArchiveActionResult>;
export async function restoreContactsAction(accountId: string, contactIds: string[]): Promise<ArchiveActionResult>;
export async function contactDeleteBlockersAction(accountId: string, contactIds: string[])
  : Promise<{ ok: true; blocked: Record<string, DeleteBlockReason[]> } | { ok: false }>;
```

`bulkDeleteContactsAction` (`ACCT/contacts/actions.ts:476`) keeps its name. Its ok-result gains `skippedIds: string[]` and `lateKept: number`.

`ACCT/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`.

### Bare `@bis/db` mock factories a task must update

There are 68 bare `vi.mock("@bis/db", () => ({` factories in `apps/web/src`. A bare factory exposes only what it lists, so a module under test that newly calls a symbol gets `undefined` or a vitest "No export defined on the mock" error. A partial factory (`importOriginal`) spreads the REAL module, so a newly called symbol runs for real against a fake client. Both kinds must stub the new symbol when the module under test now calls it.

| Test file (line of the mock) | Kind | Why it changes | New entries | Task |
|---|---|---|---|---|
| `apps/web/src/app/api/sms/inbound/route.test.ts:35` | bare | route calls `restoreContactOnSign` | `restoreContactOnSign: vi.fn(async () => false)` | T9 |
| `apps/web/src/app/api/sms/inbound/route.consent.test.ts:22` | partial | same route | same | T9 |
| `apps/web/src/app/b/[publicId]/actions.test.ts:105` | bare | booking action calls it | same | T9 |
| `apps/web/src/app/f/[publicId]/actions.test.ts:64` | bare | the action imports the REAL `enrich` (no `@/lib/forms/enrich` mock in the file), which now calls it | same | T9 |
| `apps/web/src/lib/forms/enrich.test.ts:12` | partial | `enrich` calls it | same | T9 |
| `apps/web/src/lib/email/inbound/file.test.ts:4` | bare | `fileInboundEmail` calls it | same | T9 |
| `apps/web/src/lib/voice/finish-call.test.ts:28` | partial (`...dbMocks`) | `finishCall` calls it | add `restoreContactOnSign: vi.fn()` to `dbMocks` | T8 |
| `ACCT/contacts/actions.test.ts:66` | bare | `deleteContacts` result shape and its `serviceDb` option | update the `deleteContacts` resolutions at `:157` | T4 (that line), T10 (new cases) |
| `ACCT/contacts/page.test.ts:87` | bare | page passes `archived` | none (no new symbol); assertions on `listContacts`/`countContacts` args gain `archived` | T10 |
| `ACCT/contacts/[contactId]/page.test.ts:104` | bare | page renders `ArchiveControls`, which imports `archive-actions.ts` → `archiveContacts`, `restoreContacts`, `contactDeleteBlockers` | `archiveContacts: vi.fn(), restoreContacts: vi.fn(), contactDeleteBlockers: vi.fn()` | T11 |
| `apps/web/src/app/(dashboard)/dashboard/page.test.ts:27` | bare, hand-built `.eq`-only chain | the count adds `.is("archived_at", null)`; the chain has no `.is` and would throw | add `is: (k, v) => { contactFilters.push([k, v]); return q; }` to the chain at `:33-37` | T12 |
| `apps/web/src/app/(dashboard)/dashboard/work/page.test.ts:78` | bare | contacts select adds `archived_at` | fixture rows gain `archived_at` | T12 |
| `ACCT/tasks/page.test.ts:131` | partial | same | same | T12 |

Checked and NOT affected: `apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts:125` and `apps/web/src/lib/concierge/lead.test.ts` mock `@/lib/forms/enrich` whole. `apps/web/src/lib/email/inbound/pipeline.test.ts:11` mocks `./file` whole. `apps/web/src/app/api/voice/incoming/lifecycle.test.ts:94` mocks `@/lib/voice/finish-call` whole.

### The second-account rule

Every account-scoped read that now filters on archive gets a test in which a SECOND account holds a matching row, so that a missing `account_id` term, or a filter that leaks across accounts, turns it red:

| Read | Second-account test lives in | Task |
|---|---|---|
| `listContacts`, `countContacts` (both `archived` values) | `packages/db/src/test/contact-archive-live.test.ts` | T4 |
| `archiveContacts` / `restoreContacts` (an id from account B changes nothing) | same | T4 |
| `restore_contact_on_sign`, `contact_delete_blockers`, `delete_internal_contacts` (account B's id passed under account A) | `packages/db/src/test/contact-archive-schema.test.ts` | T1 |
| the six "new conversation" due-lists and their by-id reads | `packages/db/src/test/automations-archive-live.test.ts` | T5 |
| `listConversations`, `sumUnreadCount`, `searchConversations` | `packages/db/src/test/messaging-archive-live.test.ts` | T6 |
| the timeline's `archive` source | `packages/db/src/test/contact-archive-live.test.ts` (T7 adds a `describe`; T4 creates the file) | see T7, wave note |
| agency dashboard count (agency-wide by design: an archived contact in account B is also left out) | `apps/web/src/app/(dashboard)/dashboard/page.test.ts` | T12 |

### e2e locators a new control can collide with

- `getByRole("link", { name: "Contacts", exact: true })`, UNSCOPED, at `apps/web/e2e/phone-width.spec.ts:376` and `apps/web/e2e/staff-roles.spec.ts:115` (scoped to `aside` at `apps/web/e2e/styleguide.spec.ts:172`). **No new link or button on the list is named exactly "Contacts".** The Archived view's way back is "Back to contacts".
- `bar.getByRole("button", { name: /delete/i })` and `dialog.getByRole("button", { name: /delete/i })` at `apps/web/e2e/contacts-drawer.spec.ts:697,701,704,730,734`. The bulk bar gains "Archive", which does not match `/delete/i`. **No new control inside the bulk bar or the delete dialog may contain the word "delete"** other than the existing Delete pair, and the dialog's "Archive instead" button must not either.
- `page.getByRole("dialog").filter({ hasText: /delete 2 contacts/i })` at `contacts-drawer.spec.ts:698,729`. The dialog title becomes the DELETABLE count once the blockers load. At `:698` both contacts are free, so the title still reads "Delete 2 contacts?". At `:729` one is blocked, so T13 updates that line.
- `bar.getByRole("button", { name: m["bulk.delete"] })` with `toHaveCount(0)` for Staff at `staff-roles.spec.ts:139`. Staff now see Archive (`m["bulk.archive"]`), which is a different name, so this line still holds.
- The exact toast text `"Deleted 1 · skipped 1 linked to bookings, deals, or conversations"` at `contacts-drawer.spec.ts:736-738` changes with T3's copy. T13 updates it.
- `getByTestId("bulk-action-bar")` (`contacts-drawer.spec.ts:557,638,688,727`; `documents.spec.ts:626`; `staff-roles.spec.ts:133`): unchanged test id.

---

## Task list

| # | Tier | Owner | Wave | Deliverable |
|---|---|---|---|---|
| T1 | high | bis-db-schema | 1 | Migration 0103 and its schema tests on the replica |
| T2 | low | bis-voice | 1 | No placeholder names from Sofía |
| T3 | low | bis-crm | 1 | Every new and changed string, English and Spanish |
| T4 | high | bis-crm | 2 | Contact queries: archive filter, archive/restore, sign restore, blockers, the new delete |
| T5 | medium | bis-automations | 2 | Scheduled sends that start a conversation skip archived contacts |
| T6 | medium | bis-comms | 2 | Inbox, unread badge and conversation search leave archived threads out |
| T7 | medium | bis-crm | 3 | Archive rows on the timeline (record, household, drawer) |
| T8 | medium | bis-voice | 3 | A meaningful call restores an archived contact |
| T9 | medium | bis-crm | 3 | Texts, emails, bookings, forms and chats restore an archived contact |
| T10 | medium | bis-crm | 3 | List: Archived view, bulk Archive/Restore, new delete dialog and toast |
| T12 | low | bis-crm | 3 | Agency dashboard count, "Archived" mark in To do, search test |
| T11 | medium | bis-frontend | 4 | Record header and drawer: Archive, Restore, banner, typed-name delete |
| T13 | medium | bis-e2e-qa | 5 | `contacts-archive.spec.ts` and the two changed lines in `contacts-drawer.spec.ts` |

Waves: wave 2 starts once T1 is green on the replica. Wave 3 needs T4 merged (T7 needs T4's `contact-archive-live.test.ts` and `COLS`; T9 and T8 need `restoreContactOnSign`; T10 needs T3 and T4). Wave 4 needs T10's `archive-actions.ts`. Wave 5 runs after everything has landed. Two tasks in one wave never share a file. The file lists below are the complete set each task may touch.

---

### Task 1: Migration 0103 and its schema tests

**Tier:** high · **Owner:** bis-db-schema · **Wave:** 1

**Files:**
- Create: `packages/db/supabase/migrations/0103_contact_archive.sql`
- Create: `packages/db/src/test/contact-archive-schema.test.ts`
- Modify: `packages/db/src/test/schema-grants-guard.test.ts:86-89` (the `"authenticated contacts"` entry)
- Modify: `packages/db/src/test/definer-search-path.test.ts:27-50` (`EXPECTED_DEFINERS`), `:68` (`toHaveLength(23)`), `:77` (`toBeGreaterThanOrEqual(23)`)

**Interfaces:** Produces the SQL objects listed under "Shared facts". Consumes nothing.

**Run locally (replica only):**
`cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55434/post pnpm exec vitest run src/test/contact-archive-schema.test.ts src/test/schema-grants-guard.test.ts src/test/definer-search-path.test.ts src/test/proposals-drop.test.ts`

Run the same command against `pre` for the red. `proposals-drop.test.ts` is in the list to prove the digest does NOT move (spec §3.1, corrected).

- [ ] **Step 1: Build the replica.** Follow the recipe in Global Constraints on port 55434. Confirm `pre` has every file through 0101 (and 0102 if given): `psql -p 55434 -d pre -c "select count(*) from public.contacts"` returns a row and does not error.

- [ ] **Step 2: Write the failing schema test.** Create `packages/db/src/test/contact-archive-schema.test.ts`. The helpers are copied from `shared-number-holding-schema.test.ts:15-60` (`seedAccount`, `refusal`); `withRollback`, `actAs`, `actAsMember` and `actAsOwner` come from `./db` (`db.ts:4,22,33,44`).

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";

/**
 * 0103_contact_archive.sql: archived_at / archived_by, the stamp and log triggers, contact_archive_log,
 * restore_contact_on_sign, contact_delete_blockers, delete_internal_contacts.
 * RED BEFORE APPLY: every case names an object that does not exist yet. Replica only (withRollback).
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Acct = { accountId: string; orgId: string };

async function seedAccount(c: Client, label: string): Promise<Acct> {
  await actAsOwner(c);
  const orgId = `org_archive_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Archive') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'Archive test', true) returning id`, [agency!.id, orgId]);
  return { accountId: account!.id, orgId };
}
async function contact(c: Client, accountId: string, first = "Junk"): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.contacts (account_id, first_name, author_kind) values ($1, $2, 'person') returning id", [accountId, first]);
  return r!.id;
}
async function conversation(c: Client, accountId: string, contactId: string): Promise<string> {
  await actAsOwner(c);
  const { rows: [r] } = await c.query<{ id: string }>(
    "insert into public.conversations (account_id, contact_id) values ($1, $2) returning id", [accountId, contactId]);
  return r!.id;
}
async function message(c: Client, accountId: string, conversationId: string, channel: string, direction: string) {
  await actAsOwner(c);
  await c.query(
    `insert into public.messages (account_id, conversation_id, channel, direction, body, status)
     values ($1, $2, $3, $4, 'x', 'delivered')`, [accountId, conversationId, channel, direction]);
}
async function refusal(c: Client, sql: string, params: unknown[] = []) {
  await c.query("savepoint probe");
  try { await c.query(sql, params); await c.query("release savepoint probe"); return null; }
  catch (e) { await c.query("rollback to savepoint probe"); const err = e as { code?: string; message: string }; return { code: err.code, message: err.message }; }
}
const blockers = async (c: Client, accountId: string, ids: string[]) => {
  await actAsOwner(c);
  await c.query("set local role service_role");
  const { rows } = await c.query<{ contact_id: string; reasons: string[] }>(
    "select contact_id, reasons from public.contact_delete_blockers($1, $2::uuid[])", [accountId, ids]);
  await c.query("reset role");
  return rows;
};

describe("0103: archive columns and the stamp trigger", () => {
  it("a signed-in archive stamps archived_by with the caller and archived_at with now, whatever the client sent (mutation: drop `new.archived_at := pg_catalog.now()` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "stamp");
      const id = await contact(c, a.accountId);
      const sub = await actAsMember(c, a.accountId, a.orgId, "staff");
      await c.query("update public.contacts set archived_at = '2001-01-01' where id = $1", [id]);
      await actAsOwner(c);
      const { rows: [r] } = await c.query<{ archived_by: string; recent: boolean }>(
        "select archived_by, archived_at > now() - interval '1 minute' as recent from public.contacts where id = $1", [id]);
      expect(r).toEqual({ archived_by: sub, recent: true });
    }));

  it("a signed-in client cannot write archived_by (mutation: grant update (archived_by) -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "by");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await refusal(c, "update public.contacts set archived_by = 'someone' where id = $1", [id]))?.code).toBe("42501");
    }));

  it("restoring clears archived_by (mutation: drop the restore branch -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "restore");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      await c.query("update public.contacts set archived_at = null where id = $1", [id]);
      await actAsOwner(c);
      const { rows: [r] } = await c.query("select archived_at, archived_by from public.contacts where id = $1", [id]);
      expect(r).toEqual({ archived_at: null, archived_by: null });
    }));

  it("a Technician's archive is refused 42501, on a customer assigned to them (ruling Q3; mutation: drop the is_technician check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "tech");
      const id = await contact(c, a.accountId);
      // contacts.assigned_to is a users.id uuid (0003_crm_core.sql:12), the value app.current_user_id() answers (0068:65),
      // so RLS's technician scope admits this row and only the stamp trigger can refuse it.
      const sub = await actAsMember(c, a.accountId, a.orgId, "technician");
      await actAsOwner(c);
      const { rows: [u] } = await c.query<{ id: string }>("select id from public.users where clerk_user_id = $1", [sub]);
      await c.query("update public.contacts set assigned_to = $2 where id = $1", [id, u!.id]);
      await actAs(c, { org_id: a.orgId, sub });
      expect((await refusal(c, "update public.contacts set archived_at = now() where id = $1", [id]))?.code).toBe("42501");
    }));

  it("archiving a shared number's holding record is refused 42501 (mutation: drop the holds_shared_number check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "holding");
      await actAsOwner(c);
      const { rows: [h] } = await c.query<{ id: string }>(
        `insert into public.contacts (account_id, first_name, phone, holds_shared_number, author_kind)
         values ($1, 'Caller', '+19565550142', true, 'ai') returning id`, [a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await refusal(c, "update public.contacts set archived_at = now() where id = $1", [h!.id]))?.code).toBe("42501");
    }));
});
```

REQUIRED property of the Technician case: with the `is_technician` check removed from the stamp trigger, the same update
must SUCCEED. That proves RLS is not the thing refusing it. Run that mutation and paste the red line. If `actAs`'s claims
(`db.ts:22-31`) do not let the technician's own update through RLS, fix the setup, not the assertion.

Add, in the same file:

```ts
describe("0103: contact_archive_log", () => {
  it("a signed-in archive and a signed-in restore each write ONE person row (mutation: move `current_user = 'authenticated'` from the trigger's WHEN into the definer body -> nothing is logged, FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "log");
      const id = await contact(c, a.accountId);
      const sub = await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      await c.query("update public.contacts set archived_at = null where id = $1", [id]);
      await actAsOwner(c);
      const { rows } = await c.query("select action, author_kind, author_id, sign from public.contact_archive_log where contact_id = $1 order by id", [id]);
      expect(rows).toEqual([
        { action: "archived", author_kind: "person", author_id: sub, sign: null },
        { action: "restored", author_kind: "person", author_id: sub, sign: null },
      ]);
    }));

  it("a signed-in client cannot insert into the log, and reads only its own account's rows (mutation: grant insert on contact_archive_log to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "logA");
      const b = await seedAccount(c, "logB");
      const idB = await contact(c, b.accountId);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [idB]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await c.query("select 1 from public.contact_archive_log where contact_id = $1", [idB])).rowCount).toBe(0);
      expect((await refusal(c,
        "insert into public.contact_archive_log (account_id, contact_id, action, author_kind) values ($1, $2, 'archived', 'person')",
        [a.accountId, idB]))?.code).toBe("42501");
    }));
});

describe("0103: restore_contact_on_sign", () => {
  it("restores an archived contact and writes ONE customer row with its sign; an active one answers false and writes nothing (mutation: drop `and archived_at is not null` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "sign");
      const archived = await contact(c, a.accountId, "Back");
      const active = await contact(c, a.accountId, "Here");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [archived]);
      await actAsOwner(c);
      await c.query("set local role service_role");
      const one = await c.query("select public.restore_contact_on_sign($1, $2, 'text') as r", [a.accountId, archived]);
      const two = await c.query("select public.restore_contact_on_sign($1, $2, 'text') as r", [a.accountId, active]);
      await c.query("reset role");
      expect([one.rows[0].r, two.rows[0].r]).toEqual([true, false]);
      const { rows } = await c.query("select contact_id, action, author_kind, sign from public.contact_archive_log where account_id = $1 and author_kind = 'customer'", [a.accountId]);
      expect(rows).toEqual([{ contact_id: archived, action: "restored", author_kind: "customer", sign: "text" }]);
    }));

  it("another account's contact is never restored (second account; mutation: drop `account_id = p_account_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "signA");
      const b = await seedAccount(c, "signB");
      const idB = await contact(c, b.accountId);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [idB]);
      await actAsOwner(c);
      await c.query("set local role service_role");
      const { rows: [r] } = await c.query("select public.restore_contact_on_sign($1, $2, 'call') as r", [a.accountId, idB]);
      await c.query("reset role");
      expect(r.r).toBe(false);
      expect((await c.query("select archived_at from public.contacts where id = $1 and archived_at is not null", [idB])).rowCount).toBe(1);
    }));

  it("authenticated cannot execute the three service-role functions (mutation: grant execute on restore_contact_on_sign to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "exec");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      for (const sql of [
        "select public.restore_contact_on_sign($1, $2, 'text')",
        "select * from public.contact_delete_blockers($1, array[$2]::uuid[])",
        "select public.delete_internal_contacts($1, array[$2]::uuid[])",
      ]) expect((await refusal(c, sql, [a.accountId, id]))?.code, sql).toBe("42501");
    }));
});
```

Then the blocker cases. Write ONE `it` per reason, each seeding a contact that has ONLY that row. Every `it` name ends with its own mutation, for example `(mutation: delete the 'calls' exists -> FAILS)`. The seeds:

| reason | seed (as `actAsOwner`) |
|---|---|
| `messages` | `conversation` + `message(…, 'sms', 'outbound')` |
| `inbound_email` | `conversation` + one `public.inbound_emails` row on it. Copy the column list from the `recordInboundEmail` insert in `packages/db/src/inbound-email.ts:155-178` |
| `calls` | one `public.calls` row with `contact_id`. Copy the minimal insert from `packages/db/src/test/voice.test.ts` |
| `forms` | one `public.forms` row + one `public.form_submissions` row with `contact_id` (minimal inserts from `packages/db/src/test/forms.test.ts`) |
| `consent` | one `public.consent_events` row with `contact_id` (from `packages/db/src/test/consent*.test.ts`) |
| `automations` | one `public.automation_log` row with `contact_id` and `status 'sent'`, AND a second contact with only a `status 'skipped'` row, which must NOT be blocked |
| `bookings` | a calendar + one booking (from `packages/db/src/test/booking*.test.ts`) |
| `deals` | `select public.ensure…` is not needed: insert a pipeline, a stage and an opportunity (from `packages/db/src/test/opportunities.test.ts`) |

Each asserts `expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["<reason>"] }])`.

Plus four more:

```ts
  it("notes, a To-do, a tag, a place, a note-channel message and an EMPTY conversation block nothing (mutation: treat channel 'note' as a blocker -> FAILS)", ...
  // seed: notes row, tasks row, tags + contact_tags, places row (0071 minimal), conversation + message(..., 'note', 'outbound'),
  // a second empty conversation. expect(await blockers(c, accountId, [id])).toEqual([]).

  it("a contact with three reasons is ONE row with all three, and 500 ids answer at most 500 rows (mutation: return one row per reason -> FAILS)", ...
  // seed messages + calls + deals on one contact; expect reasons sorted to equal ["calls","deals","messages"];
  // then call with 501 ids -> refusal code "22023".

  it("delete_internal_contacts deletes an internal-only contact with its notes, note messages and empty conversations, and returns its id (mutation: skip the note-message delete -> the conversation delete hits messages_conversation_id_fkey, the id is not returned, FAILS)", ...

  it("delete_internal_contacts keeps a contact that gained an outbound text after the blockers were read, and still deletes the rest of the batch (mutation: drop the in-lock re-check -> FAILS)", ...
  // seed free1, free2; read blockers (empty); then insert an outbound sms on free2; call delete_internal_contacts(array[free1, free2]);
  // expect returned = [free1]; free2 still exists.

  it("a document left behind keeps that one contact and deletes the others (mutation: remove the per-contact exception block -> the whole call errors, FAILS)", ...
  // seed a documents row on doc1 (copy the minimal insert from packages/db/src/test/documents*.test.ts); call with [doc1, free];
  // expect returned = [free]; doc1 exists.

  it("another account's id passed under account A is neither reported nor deleted (second account; mutation: drop `k.account_id = p_account_id` in delete_internal_contacts -> FAILS)", ...
```

Write each of these in full, in the same style as the `it` blocks above. Every seed copies a minimal insert from the named existing test file. Read that file for the columns; do not guess them.

- [ ] **Step 3: Run it red on `pre`.**
Run: `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55434/pre pnpm exec vitest run src/test/contact-archive-schema.test.ts`
Expected: every test FAILS. The first failing line reads `column "archived_at" of relation "contacts" does not exist` or `function public.restore_contact_on_sign(...) does not exist`. Paste one.

- [ ] **Step 4: Write the migration.** Create `packages/db/supabase/migrations/0103_contact_archive.sql`. ASCII only, no backslash, every dollar sign part of a `$$` pair (the 0098 rule, `0098_shared_number_holding.sql:58`). The header follows 0098's sections (WHY / WHAT / GRANTS / SEARCH PATHS / LOCKS AND COST / LOAD-BEARING / ROLLBACK), stating:
  - GRANTS: one column grant, `update (archived_at)` to authenticated. `EXPECTED_WRITES` gains it. The client-write digest does NOT change (`proposals-drop.test.ts:94-98` counts table privileges only). Four definers are added to `EXPECTED_DEFINERS` (23 -> 27, or 0102's count + 4).
  - LOAD-BEARING: the app after this file names `archived_at` in `COLS` and every list read, so it merges only after this file is on production.

```sql
-- 0. Fail fast instead of queueing behind a long lock.
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The columns.
alter table public.contacts
  add column archived_at timestamptz,
  add column archived_by text;
alter table public.contacts
  add constraint contacts_archived_by_needs_at check (archived_by is null or archived_at is not null);

-- 2. Only archived_at is client-writable; the stamp trigger owns archived_by and the instant.
grant update (archived_at) on public.contacts to authenticated;

-- 3. The history.
create table public.contact_archive_log (
  id bigint generated always as identity primary key,
  account_id uuid not null,
  contact_id uuid not null,
  action text not null constraint contact_archive_log_action_check check (action in ('archived', 'restored')),
  author_kind text not null constraint contact_archive_log_author_check check (author_kind in ('person', 'customer')),
  author_id text,
  sign text constraint contact_archive_log_sign_check check (sign in ('text', 'email', 'call', 'booking', 'form', 'chat')),
  created_at timestamptz not null default pg_catalog.now(),
  constraint contact_archive_log_sign_shape check ((author_kind = 'customer') = (sign is not null)),
  constraint contact_archive_log_contact_fkey foreign key (account_id, contact_id)
    references public.contacts (account_id, id) on delete cascade
);
create index contact_archive_log_contact
  on public.contact_archive_log (account_id, contact_id, created_at desc, id desc);
alter table public.contact_archive_log enable row level security;
revoke all on public.contact_archive_log from anon, authenticated;
grant select on public.contact_archive_log to authenticated;
grant select, insert, update, delete on public.contact_archive_log to service_role;
create policy contact_archive_log_read on public.contact_archive_log for select to authenticated
  using (exists (select 1 from public.contacts c
                  where c.account_id = contact_archive_log.account_id and c.id = contact_archive_log.contact_id));

-- 4. The stamp: plain, not definer (0098's contacts_holding_server_only shape).
create function app.contacts_archive_stamp() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(current_user = 'authenticated', false)
     and new.archived_at is distinct from old.archived_at then
    if old.holds_shared_number then
      raise exception 'A shared number holding record is never archived' using errcode = '42501';
    end if;
    if coalesce(app.is_technician(new.account_id), false) then
      raise exception 'A Technician cannot archive a customer' using errcode = '42501';
    end if;
    if new.archived_at is not null then
      new.archived_at := pg_catalog.now();
      new.archived_by := pg_catalog.nullif(app.jwt() ->> 'sub', '');
    else
      new.archived_by := null;
    end if;
  end if;
  return new;
end $$;
revoke all on function app.contacts_archive_stamp() from public, anon;
create trigger contacts_archive_stamp before update of archived_at on public.contacts
  for each row execute function app.contacts_archive_stamp();

-- 5. The person's log row. DEFINER (it writes a table authenticated cannot). The role test is in WHEN,
--    which runs in the caller's context: inside a definer body current_user is the owner, never
--    'authenticated', so a test there would log nothing.
create function app.contacts_archive_log() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  insert into public.contact_archive_log (account_id, contact_id, action, author_kind, author_id)
  values (new.account_id, new.id,
          case when new.archived_at is null then 'restored' else 'archived' end,
          'person',
          coalesce(new.archived_by, pg_catalog.nullif(app.jwt() ->> 'sub', '')));
  return null;
end $$;
revoke all on function app.contacts_archive_log() from public, anon, authenticated;
create trigger contacts_archive_log after update of archived_at on public.contacts
  for each row
  when (old.archived_at is distinct from new.archived_at and current_user = 'authenticated')
  execute function app.contacts_archive_log();

-- 6. The customer's own sign brings them back (owner ruling Q1). Service role only.
create function public.restore_contact_on_sign(p_account_id uuid, p_contact_id uuid, p_sign text)
returns boolean
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
begin
  update public.contacts set archived_at = null, archived_by = null
   where account_id = p_account_id and id = p_contact_id and archived_at is not null
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  insert into public.contact_archive_log (account_id, contact_id, action, author_kind, sign)
  values (p_account_id, v_id, 'restored', 'customer', p_sign);
  return true;
end $$;
revoke all on function public.restore_contact_on_sign(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.restore_contact_on_sign(uuid, uuid, text) to service_role;

-- 7. What keeps a contact from being deleted for good (spec section 5.1). ONE row per blocked contact,
--    so 500 ids answer at most 500 rows, under PostgREST max_rows. Definer: a reason the caller's RLS
--    hid would read as no reason (fail open).
create function public.contact_delete_blockers(p_account_id uuid, p_contact_ids uuid[])
returns table (contact_id uuid, reasons text[])
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
  if p_contact_ids is null or pg_catalog.cardinality(p_contact_ids) > 500 then
    raise exception 'contact_delete_blockers: between 0 and 500 ids' using errcode = '22023';
  end if;
  return query
  select k.id, r.reasons
    from public.contacts k
    cross join lateral (
      select pg_catalog.array_agg(x.reason order by x.reason) as reasons from (
        select 'messages'::text as reason where exists (
          select 1 from public.conversations cv join public.messages m on m.conversation_id = cv.id
           where cv.account_id = p_account_id and cv.contact_id = k.id and m.channel <> 'note')
        union all select 'inbound_email' where exists (
          select 1 from public.conversations cv join public.inbound_emails ie
                 on ie.account_id = cv.account_id and ie.conversation_id = cv.id
           where cv.account_id = p_account_id and cv.contact_id = k.id)
        union all select 'calls' where exists (
          select 1 from public.calls x where x.account_id = p_account_id and x.contact_id = k.id)
        union all select 'forms' where exists (
          select 1 from public.form_submissions x where x.account_id = p_account_id and x.contact_id = k.id)
        union all select 'consent' where exists (
          select 1 from public.consent_events x where x.account_id = p_account_id and x.contact_id = k.id)
        union all select 'automations' where exists (
          select 1 from public.automation_log x where x.account_id = p_account_id and x.contact_id = k.id and x.status = 'sent')
        union all select 'bookings' where exists (
          select 1 from public.bookings x where x.account_id = p_account_id and x.contact_id = k.id)
        union all select 'deals' where exists (
          select 1 from public.opportunities x where x.account_id = p_account_id and x.contact_id = k.id)
      ) x
    ) r
   where k.account_id = p_account_id and k.id = any (p_contact_ids) and r.reasons is not null;
end $$;
revoke all on function public.contact_delete_blockers(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.contact_delete_blockers(uuid, uuid[]) to service_role;

-- 8. Delete for good, internal-only contacts. Locks the contacts, then their conversations, in id order,
--    then re-reads the blockers inside the lock: each statement takes a fresh snapshot under READ
--    COMMITTED (the 0083 section 3 approach). Each contact in its own subtransaction, so one file the
--    purge left behind (documents_contact_fkey, NO ACTION) keeps that contact alone.
create function public.delete_internal_contacts(p_account_id uuid, p_contact_ids uuid[])
returns uuid[]
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare
  v_id uuid;
  v_deleted uuid[] := '{}';
begin
  if p_contact_ids is null or pg_catalog.cardinality(p_contact_ids) > 500 then
    raise exception 'delete_internal_contacts: between 0 and 500 ids' using errcode = '22023';
  end if;
  perform 1 from public.contacts k
   where k.account_id = p_account_id and k.id = any (p_contact_ids) order by k.id for update;
  perform 1 from public.conversations cv
   where cv.account_id = p_account_id and cv.contact_id = any (p_contact_ids) order by cv.id for update;
  for v_id in
    select k.id from public.contacts k
     where k.account_id = p_account_id and k.id = any (p_contact_ids)
       and not exists (select 1 from public.contact_delete_blockers(p_account_id, array[k.id]))
     order by k.id
  loop
    begin
      delete from public.messages m using public.conversations cv
       where m.conversation_id = cv.id and cv.account_id = p_account_id and cv.contact_id = v_id and m.channel = 'note';
      delete from public.conversations cv where cv.account_id = p_account_id and cv.contact_id = v_id;
      delete from public.contacts k where k.account_id = p_account_id and k.id = v_id;
      v_deleted := v_deleted || v_id;
    exception when foreign_key_violation then
      null;  -- kept: a row still points at it (a file the purge did not clear). The caller reports it.
    end;
  end loop;
  return v_deleted;
end $$;
revoke all on function public.delete_internal_contacts(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.delete_internal_contacts(uuid, uuid[]) to service_role;

-- 9. The Archived view's count and order.
create index contacts_account_archived on public.contacts (account_id, archived_at desc, id desc)
  where archived_at is not null;
```

ROLLBACK in the header, in order: drop index `contacts_account_archived`; drop the three public functions; drop trigger `contacts_archive_log` and function `app.contacts_archive_log()`; drop trigger `contacts_archive_stamp` and function `app.contacts_archive_stamp()`; drop table `public.contact_archive_log`; `revoke update (archived_at) on public.contacts from authenticated`; drop constraint `contacts_archived_by_needs_at`; drop both columns.

- [ ] **Step 5: Apply to `post` and run green.**
Run: `psql -p 55434 -d post -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0103_contact_archive.sql`, then the Step 3 command against `post`.
Expected: all pass. Paste vitest's summary line.

- [ ] **Step 6: Update the two guard tests.** In `schema-grants-guard.test.ts:86-89` add `"archived_at"` in sorted position (after `"assigned_to"`). In `definer-search-path.test.ts` add these four entries in sorted position, then change `:68` to `toHaveLength(27)` and `:77` to `toBeGreaterThanOrEqual(27)`. If 0102 is in your `pre`, use its count + 4, read off the file:

```ts
  "app.contacts_archive_log()": PG_CATALOG_PG_TEMP,
  "public.contact_delete_blockers(uuid,uuid[])": PG_CATALOG_PG_TEMP,
  "public.delete_internal_contacts(uuid,uuid[])": PG_CATALOG_PG_TEMP,
  "public.restore_contact_on_sign(uuid,uuid,text)": PG_CATALOG_PG_TEMP,
```

Run all four files on `post` (green) and the two guard files on `pre` (red: `expected 23 to be 27` and the `archived_at` diff). Paste both lines. `proposals-drop.test.ts` must be GREEN on both `pre` and `post` with `52|b66203ca5d355155540b520af510d120`.

- [ ] **Step 7: Mutation probes (the reviewer runs each; paste the red line).** Apply each to `post` with `create or replace function …` (or `drop trigger`/`grant`), run the named test, then rebuild `post` from `pre`:

| Change | Test that must go red |
|---|---|
| stamp: delete `new.archived_at := pg_catalog.now();` | "a signed-in archive stamps archived_by … with now" |
| `grant update (archived_by) on public.contacts to authenticated` | "a signed-in client cannot write archived_by" |
| stamp: delete the `is_technician` block | "a Technician's archive is refused" (must fail because the update SUCCEEDS, not because RLS refuses) |
| stamp: delete the `holds_shared_number` block | "archiving a shared number's holding record" |
| recreate the log trigger with no `current_user` in WHEN, and the test in the body instead | "a signed-in archive and a signed-in restore each write ONE person row" |
| recreate the log trigger with no `current_user` test at all | "restores an archived contact and writes ONE customer row" (it logs a person row too) |
| restore fn: drop `and archived_at is not null` | "… an active one answers false and writes nothing" |
| blockers: delete each `exists` in turn | that reason's own `it` |
| blockers: `m.channel <> 'note'` → `true` | "notes, a To-do, … block nothing" |
| delete fn: delete the `not exists (… contact_delete_blockers …)` line | "keeps a contact that gained an outbound text" |
| delete fn: remove `exception when foreign_key_violation` | "a document left behind keeps that one contact" |

- [ ] **Step 8: Commit.**

```bash
git add packages/db/supabase/migrations/0103_contact_archive.sql packages/db/src/test/contact-archive-schema.test.ts packages/db/src/test/schema-grants-guard.test.ts packages/db/src/test/definer-search-path.test.ts
git commit -m "feat(db): 0103 contact archive: archived_at, archive log, sign restore and internal-only delete" -- packages/db/supabase/migrations/0103_contact_archive.sql packages/db/src/test/contact-archive-schema.test.ts packages/db/src/test/schema-grants-guard.test.ts packages/db/src/test/definer-search-path.test.ts
```

---

### Task 2: Sofía never stores a placeholder as a name

**Tier:** low · **Owner:** bis-voice · **Wave:** 1

**Files:**
- Modify: `apps/web/src/lib/voice/tools/placeholders.ts:26-33` (the three sets)
- Modify: `apps/web/src/lib/voice/tools/placeholders.test.ts`
- Modify: `apps/web/src/lib/voice/identity/flow.ts:95-98` (`messageName`)
- Modify: `apps/web/src/lib/voice/identity/flow.test.ts`
- Modify: `apps/web/src/lib/voice/finish-call.ts:306-313` (`namesSaid`), `:386`, `:393`, `:464` (the shared-number message name)
- Modify: `apps/web/src/lib/voice/finish-call.test.ts`

**Interfaces:** none produced. Consumes `isPlaceholderName` (`placeholders.ts:46-49`).

**Run:** `pnpm --filter web exec vitest run src/lib/voice/tools/placeholders.test.ts src/lib/voice/identity/flow.test.ts src/lib/voice/finish-call.test.ts src/lib/voice/modules/corpus-parity.test.ts`

- [ ] **Step 1: Failing tests.** In `placeholders.test.ts` add:

```ts
describe("isPlaceholderName: multi-word stand-ins (contact archive spec §7.2c)", () => {
  it.each(["Unknown caller", "Unknown Caller", "No name", "No name given", "Anonymous", "Anónimo", "Anónima",
           "Sin nombre", "No dio su nombre", "Not provided", "No proporcionado"])(
    "%s is a placeholder name (mutation: drop it from the sets -> FAILS)", (v) => {
      expect(isPlaceholderName(v)).toBe(true);
    });
  it.each(["Anonymous Plumbing LLC", "Ana Unknown", "Sinclair Nombre"])(
    "%s is a real name, never touched (mutation: match by substring -> FAILS)", (v) => {
      expect(isPlaceholderName(v)).toBe(false);
    });
});
```

In `flow.test.ts`:

```ts
it("messageName treats a placeholder as no name (mutation: drop the isPlaceholderName check -> FAILS)", () => {
  expect(messageName({ name: "Unknown" })).toBeNull();
  expect(messageName({ name: " desconocido " })).toBeNull();
  expect(messageName({ name: "Ana Ruiz" })).toBe("Ana Ruiz");
});
```

In `finish-call.test.ts`, beside the lead tests (`:263-300`), using `withLead` directly. This bypasses `capture_lead`, so the upstream guard cannot hide a missing choke point:

```ts
it("a lead whose fullName is a placeholder makes a \"Caller\" contact, never \"Desconocido\" (spec §7.3; mutation: remove spokenName at the splitFullName call -> FAILS)", async () => {
  const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
    { fields: { fullName: "Desconocido", need: "roof quote", callbackNumber: "+19562921696" } });
  await finishCall(s, ctx, meta);
  expect(dbMocks.createContact).toHaveBeenCalledWith({}, "a1",
    expect.objectContaining({ firstName: "Caller", lastName: undefined }), "voice", "ai");
});

it("a placeholder lead name never stops a real message name agreeing (mutation: remove spokenName in namesSaid -> namesAgree fails, no contact, FAILS)", async () => {
  const s = withMessage(withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
    { fields: { fullName: "Unknown", need: "roof quote", callbackNumber: "+19562921696" } }),
    { body: "call me back", name: "Ana Ruiz", at: "t" });
  await finishCall(s, ctx, meta);
  expect(dbMocks.createContact).toHaveBeenCalled();
});
```

Read `withMessage`'s real signature in `apps/web/src/lib/voice/state.ts` (or wherever `withLead` is imported from in `finish-call.test.ts`) before writing the second test. If its shape differs, keep the test's meaning: a placeholder lead name next to a real message name still yields a contact.

- [ ] **Step 2: Run red.** Expected: the eleven `it.each` placeholder cases fail (`expected false to be true`), the `messageName` case fails (`expected 'Unknown' to be null`), and both finish-call cases fail. Paste one line of each.

- [ ] **Step 3: Implement.** In `placeholders.ts`:

```ts
const GENERIC = new Set([
  "not specified", "unspecified", "n/a", "not given", "not provided",
  "no se indico", "no especificado", "no especificada", "sin especificar", "no proporcionado", "no proporcionada",
]);
const UNKNOWN = new Set(["unknown", "desconocido", "desconocida"]);
/** A stand-in for a name. Whole value only ("Anonymous Plumbing LLC" is a business). */
const NAME_STANDINS = new Set([
  "user", "guest", "customer", "cliente", "caller",
  "unknown caller", "no name", "no name given", "anonymous", "anonimo", "anonima", "sin nombre", "no dio su nombre",
]);
```

`norm` lowercases and strips accents (`:19-22`), so "Anónimo" matches "anonimo".

In `flow.ts` add `import { isPlaceholderName } from "../tools/placeholders";` (an import-free module, `placeholders.ts:11-13`) and change `messageName`:

```ts
export function messageName(args: { name?: unknown }): string | null {
  const n = typeof args.name === "string" ? args.name.replace(/\s+/g, " ").trim() : "";
  return n.length > 0 && !isPlaceholderName(n) ? n : null;
}
```

In `finish-call.ts` import `isPlaceholderName` from `./tools/placeholders` and add, above `namesSaid`:

```ts
/** A placeholder ("Unknown", "Desconocido", "N/A") is no name: S-47b's rule, enforced again at the one place every
 *  name reaches createContact, so a tool path that forgets the guard still yields "Caller" (contact archive spec §7.3). */
function spokenName(raw: string | null | undefined): string {
  const v = (raw ?? "").trim();
  return v && !isPlaceholderName(v) ? v : "";
}
```

Then:
- `namesSaid` (`:308-309`): `...state.leads.map((l) => spokenName(l.fields?.fullName)),` and `...state.messages.map((m) => (m.nameDeclined ? undefined : spokenName(m.name))),`. The existing filter drops the empty strings.
- `:386`: `const { firstName, lastName } = splitFullName(spokenName(fields.fullName));`
- `:393`: `pickRecordOnNumber({ …, name: spokenName(fields.fullName) || undefined, … })`
- `:464`: `const name = msg && !msg.nameDeclined ? spokenName(msg.name) || undefined : undefined;`

- [ ] **Step 4: Run green**, then the corpus parity test (`corpus-parity.test.ts` imports `placeholders.ts`). Paste the summary line.

- [ ] **Step 5: Mutation probes.** (a) Remove `"anonymous"` from `NAME_STANDINS` → the "Anonymous" case fails. (b) Revert `messageName` → its test fails. (c) Replace `splitFullName(spokenName(fields.fullName))` with `splitFullName(fields.fullName ?? "")` → "makes a \"Caller\" contact" fails. This can fail because `withLead` bypasses `capturePhoneLead`. (d) Revert `namesSaid` → the agreement test fails.

- [ ] **Step 6: Commit** the six files: `git commit -m "fix(voice): a placeholder like Unknown or Anonymous is never a contact's name" -- <the six paths>`.

---

### Task 3: Copy, English and Spanish

**Tier:** low · **Owner:** bis-crm · **Wave:** 1

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (`bulk.*` block at `:662-699`; add the `contacts.archive*` and `record.*` keys beside their namespaces; add the `timeline.*` keys beside `timeline.note` at `:5345`)
- Modify: `apps/web/src/lib/messages.test.ts`

**Interfaces:** Produces these keys, which T7, T10, T11 and T12 consume by name. Every key has its `.es` twin on the next line.

| Key | English | Spanish |
|---|---|---|
| `bulk.archive` | Archive | Archivar |
| `bulk.archived` | Archived {count} contacts | Se archivaron {count} contactos |
| `bulk.archivedOne` | Archived 1 contact | Se archivó 1 contacto |
| `bulk.restore` | Restore | Restaurar |
| `bulk.restored` | Moved {count} contacts back to your list | Se devolvieron {count} contactos a su lista |
| `bulk.restoredOne` | Moved 1 contact back to your list | Se devolvió 1 contacto a su lista |
| `bulk.deletedSkipped` (REPLACES `:696`/`:699`) | Deleted {count} · kept {skipped} that have calls, texts, bookings or deals. You can archive those instead. | Contactos borrados: {count} · conservados porque tienen llamadas, mensajes, citas u oportunidades: {skipped}. Puede archivarlos. |
| `bulk.archiveKept` | Archive them | Archivarlos |
| `contacts.archived.link` | Archived | Archivados |
| `contacts.archived.title` | Archived contacts | Contactos archivados |
| `contacts.archived.count` | {count} archived | {count} archivados |
| `contacts.archived.countOne` | 1 archived | 1 archivado |
| `contacts.archived.back` | Back to contacts | Volver a contactos |
| `contacts.archived.emptyTitle` | Nothing archived | No hay contactos archivados |
| `contacts.archived.emptyBody` | Contacts you archive wait here, off your list, with every call and text kept. Archive one from your list when you no longer need to see it. | Aquí quedan los contactos que archive: fuera de su lista y con todas sus llamadas y mensajes guardados. Archive uno desde su lista cuando ya no necesite verlo. |
| `contacts.archived.mark` | Archived | Archivado |
| `contacts.archive.failed` | Couldn't archive. Nothing changed. Try again. | No se pudo archivar. No cambió nada. Intente de nuevo. |
| `contacts.restore.failed` | Couldn't restore. Nothing changed. Try again. | No se pudo restaurar. No cambió nada. Intente de nuevo. |
| `contacts.archive.keepsAppointment` | They still have an appointment on {date}. Its reminders still go. | Todavía tiene una cita el {date}. Sus recordatorios se siguen enviando. |
| `contacts.archive.keepsAppointments` | {count} of them still have appointments. Their reminders still go. | {count} de ellos todavía tienen citas. Sus recordatorios se siguen enviando. |
| `contacts.add.existingArchived` | That contact is archived. Open it to restore it. | Ese contacto está archivado. Ábralo para restaurarlo. |
| `contacts.delete.archiveOnly` | {name} can't be deleted: they have calls, texts, bookings or deals on file, and we keep that history. Archive them instead. They leave your list and nothing is lost. | No se puede borrar a {name}: tiene llamadas, mensajes, citas u oportunidades registradas, y ese historial se conserva. Mejor archive este contacto: sale de su lista y no se pierde nada. |
| `contacts.delete.someKept` | {kept} of these will be kept: they have calls, texts, bookings or deals. | Se conservarán {kept} de estos porque tienen llamadas, mensajes, citas u oportunidades. |
| `contacts.delete.noneDeletable` | None of these can be deleted: they all have calls, texts, bookings or deals. Archive them instead. | Ninguno se puede borrar porque todos tienen llamadas, mensajes, citas u oportunidades. Mejor archívelos. |
| `contacts.delete.archiveInstead` | Archive instead | Archivar |
| `contacts.delete.blockersFailed` | Couldn't check which of these can be deleted. Close this and try again. | No se pudo revisar cuáles se pueden borrar. Cierre esto e intente de nuevo. |
| `contacts.delete.oneTitle` | Delete {name} for good? | ¿Borrar a {name} para siempre? |
| `contacts.delete.oneBody` | This removes them with their notes, tasks and files. It can't be undone. Type {name} to confirm. | Esto borra el contacto con sus notas, tareas y archivos. No se puede deshacer. Escriba {name} para confirmar. |
| `contacts.delete.oneBodyNoName` | This contact has no name. Type the last four digits of their phone, {digits}, to confirm. | Este contacto no tiene nombre. Escriba los últimos cuatro dígitos de su teléfono, {digits}, para confirmar. |
| `record.archive` | Archive | Archivar |
| `record.restore` | Restore | Restaurar |
| `record.delete` | Delete… | Borrar… |
| `record.archivedBanner` | Archived {date} by {name}. Their calls and texts are kept. | Archivado el {date} por {name}. Sus llamadas y mensajes se conservan. |
| `record.archivedBannerShort` | Archived {date}. Their calls and texts are kept. | Archivado el {date}. Sus llamadas y mensajes se conservan. |
| `record.archivedToast` | {name} archived | {name} se archivó |
| `record.restoredToast` | {name} is back on your list | {name} volvió a su lista |
| `timeline.archived` | archived this contact | archivó este contacto |
| `timeline.restored` | moved this contact back to the list | devolvió este contacto a la lista |
| `timeline.cameBack.text` | came back: sent you a text | volvió: le envió un mensaje |
| `timeline.cameBack.email` | came back: sent you an email | volvió: le envió un correo |
| `timeline.cameBack.call` | came back: called and talked with Sofía | volvió: llamó y habló con Sofía |
| `timeline.cameBack.booking` | came back: booked an appointment | volvió: hizo una cita |
| `timeline.cameBack.form` | came back: filled out your form | volvió: llenó su formulario |
| `timeline.cameBack.chat` | came back: wrote in your website chat | volvió: escribió en el chat de su sitio web |
| `timeline.what.archive` | archive history | historial de archivo |

The timeline verbs are lower-case because the row draws "{mark} {verb}" (`timeline.note` = "added a note", `messages.ts:5345`). `timeline.cameBack.call` names "Sofía": read how `timeline.chat` takes the persona (`apps/web/src/lib/record/timeline-rows.ts:129-130`) and, if it uses `{persona}`, write `{persona}` here instead and pass it in T7.

- [ ] **Step 1: Failing test.** Add a `describe("contact archive copy (spec §6)")` to `messages.test.ts` in the shape of the existing per-feature blocks (`:575-600`). It needs a `WANT` record holding every row above, plus the three tests those blocks carry: exact text, `.es` on the next line, usted and placeholder survival. Also assert `m["bulk.deletedSkipped"]` no longer contains "linked to".
- [ ] **Step 2: Run red:** `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n`. Expected: `bulk.archive: expected undefined to be 'Archive'`. Paste it.
- [ ] **Step 3: Add the keys** to `messages.ts`, each English key followed by its `.es` line.
- [ ] **Step 4: Run green**, including `src/lib/i18n`: the accents guard, the ratchet and catalogue parity must pass with NO baseline change, because every key has its twin. Paste the summary line.
- [ ] **Step 5: Mutation:** swap one `.es` line out of position → "the .es twin on the very next line" fails. Write "Vuelve" into `contacts.archive.failed.es` → the usted test fails.
- [ ] **Step 6: Commit:** `git commit -m "feat(contacts): archive and delete copy, English and Spanish" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts`

---

### Task 4: Contact queries

**Tier:** high · **Owner:** bis-crm · **Wave:** 2

**Files:**
- Modify: `packages/db/src/contacts.ts` (`COLS` `:78-79`; `withArchived` beside `withAssignee` `:888-890`; `listContacts` `:906-953`; `countContacts` `:1017-1029`; `deleteContacts` and its comment `:1155-1268`; new functions after `deleteContacts`)
- Modify: `packages/db/src/index.ts:20-23` (the `./contacts` export line)
- Create: `packages/db/src/contacts-archive.test.ts` (pure, fake client, runs locally)
- Create: `packages/db/src/test/contact-archive-live.test.ts` (`withTestAccount`, CI only)
- Modify: `packages/db/src/test/contacts.test.ts` (the 12 `deleteContacts(` calls; tests at `:814`, `:833`, `:951`, `:990`, `:1012`, `:1051`, `:1060`, `:1095`, `:1117`)
- Modify: `ACCT/contacts/actions.ts:500-509` (the ONE `deleteContacts` caller: `serviceDb: serviceDb()` replaces `conversationsDb`) and `ACCT/contacts/actions.test.ts:157` (the resolved shape gains `skippedIds: [], lateKept: 0`). Only these lines; T10 owns the rest of both files in wave 3.

**Interfaces:** Produces the TypeScript block under "Shared facts". Consumes T1's SQL.

**Run locally:** `cd packages/db && pnpm exec vitest run src/contacts-archive.test.ts src/contacts-phone.test.ts` (no env, so the sweep skips) and `pnpm --filter @bis/db exec tsc --noEmit -p .`. `src/test/contact-archive-live.test.ts` and `src/test/contacts.test.ts` run in CI verify only.

- [ ] **Step 1: Pure failing tests.** Create `packages/db/src/contacts-archive.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listContacts, countContacts, archiveContacts, restoreContacts, contactDeleteBlockers, deleteContacts } from "./contacts";

/** Every call on every query, and a fixed answer per table. Pure: the live behaviour is CI-only
 *  (src/test/contact-archive-live.test.ts). */
function recordingDb(answers: Record<string, unknown> = {}, rpc: Record<string, unknown> = {}) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const rpcs: { fn: string; args: unknown }[] = [];
  const chainFor = (table: string): unknown => {
    const chain: unknown = new Proxy({}, {
      get(_t, method: string) {
        if (method === "then") {
          return (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
            Promise.resolve({ data: answers[table] ?? [], error: null, count: 0 }).then(res, rej);
        }
        return (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
      },
    });
    return chain;
  };
  const db = {
    from: (table: string) => chainFor(table),
    rpc: async (fn: string, args: unknown) => { rpcs.push({ fn, args }); return { data: rpc[fn] ?? null, error: null }; },
  } as unknown as SupabaseClient;
  return { db, calls, rpcs };
}
const has = (calls: { method: string; args: unknown[] }[], method: string, ...args: unknown[]) =>
  calls.some((c) => c.method === method && JSON.stringify(c.args) === JSON.stringify(args));

describe("the archived filter, one rule for the list and its total", () => {
  it("listContacts leaves archived contacts out by default (mutation: drop `q = withArchived(q, opts.archived)` in listContacts -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await listContacts(db, "A");
    expect(has(calls, "is", "archived_at", null)).toBe(true);
  });
  it("countContacts does too, so the header total agrees (mutation: drop it in countContacts only -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await countContacts(db, "A");
    expect(has(calls, "is", "archived_at", null)).toBe(true);
  });
  it("the Archived view asks for archived ones only, in both (mutation: ignore `archived: \"only\"` -> FAILS)", async () => {
    const one = recordingDb(); await listContacts(one.db, "A", { archived: "only" });
    const two = recordingDb(); await countContacts(two.db, "A", { archived: "only" });
    for (const r of [one, two]) {
      expect(has(r.calls, "not", "archived_at", "is", null)).toBe(true);
      expect(has(r.calls, "is", "archived_at", null)).toBe(false);
    }
  });
});

describe("archiveContacts / restoreContacts", () => {
  it("archive touches only this account's active, non-holding rows and answers the ids it changed (mutation: drop `.is(\"archived_at\", null)` -> FAILS)", async () => {
    const { db, calls } = recordingDb({ contacts: [{ id: "c2" }] });
    const r = await archiveContacts(db, "A", ["c1", "c2"]);
    expect(r).toEqual({ changedIds: ["c2"] });
    expect(has(calls, "eq", "account_id", "A")).toBe(true);
    expect(has(calls, "eq", "holds_shared_number", false)).toBe(true);
    expect(has(calls, "is", "archived_at", null)).toBe(true);
  });
  it("restore touches only archived rows (mutation: drop the `.not` filter -> FAILS)", async () => {
    const { db, calls } = recordingDb({ contacts: [] });
    await restoreContacts(db, "A", ["c1"]);
    expect(has(calls, "not", "archived_at", "is", null)).toBe(true);
    expect(has(calls, "update", { archived_at: null })).toBe(true);
  });
  it("more than 500 ids is refused before any query (mutation: drop the cap -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await expect(archiveContacts(db, "A", Array.from({ length: 501 }, (_, i) => `c${i}`))).rejects.toThrow(/500/);
    expect(calls).toEqual([]);
  });
});

describe("contactDeleteBlockers", () => {
  it("maps one row per contact to its reasons (mutation: key by reason -> FAILS)", async () => {
    const { db } = recordingDb({}, { contact_delete_blockers: [{ contact_id: "c1", reasons: ["calls", "messages"] }] });
    const m = await contactDeleteBlockers(db, "A", ["c1", "c2"]);
    expect([...m]).toEqual([["c1", ["calls", "messages"]]]);
  });
});

describe("deleteContacts", () => {
  it("only proven ids reach the blockers, only unblocked ones reach beforeDelete, and the rest come back as skippedIds (mutation: pass the raw batch to delete_internal_contacts -> FAILS)", async () => {
    const request = recordingDb({ contacts: [{ id: "free" }, { id: "kept" }] });
    const service = recordingDb({}, {
      contact_delete_blockers: [{ contact_id: "kept", reasons: ["messages"] }],
      delete_internal_contacts: ["free"],
    });
    const seen: string[][] = [];
    const r = await deleteContacts(request.db, "A", ["free", "kept", "stranger"], {
      serviceDb: service.db, beforeDelete: async (ids) => { seen.push(ids); return []; },
    });
    expect(service.rpcs[0]).toEqual({ fn: "contact_delete_blockers", args: { p_account_id: "A", p_contact_ids: ["free", "kept"] } });
    expect(seen).toEqual([["free"]]);
    expect(service.rpcs[1]).toEqual({ fn: "delete_internal_contacts", args: { p_account_id: "A", p_contact_ids: ["free"] } });
    expect(r).toEqual({ deleted: 1, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["kept"], lateKept: 0 });
  });
  it("an id the database kept after the purge is reported as lateKept and skipped (mutation: count every id sent as deleted -> FAILS)", async () => {
    const request = recordingDb({ contacts: [{ id: "a" }, { id: "b" }] });
    const service = recordingDb({}, { contact_delete_blockers: [], delete_internal_contacts: ["a"] });
    const r = await deleteContacts(request.db, "A", ["a", "b"], { serviceDb: service.db });
    expect(r).toEqual({ deleted: 1, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["b"], lateKept: 1 });
  });
});
```

- [ ] **Step 2: Run red.** `cd packages/db && pnpm exec vitest run src/contacts-archive.test.ts`. Expected: an import error (`archiveContacts` is not exported) or `expected false to be true`. Paste it.

- [ ] **Step 3: Implement in `contacts.ts`.** Change `COLS` to end `…, author_kind, author_id, holds_shared_number, archived_at, archived_by"`, still ONE literal (`:62-70`). Then add:

```ts
/** Contact archive (0103; owner rulings 2026-10-28). One rule for the list's rows and its header total, as
 *  withAssignee is: "exclude" (the list, search, pickers, export) or "only" (the Archived view). */
export type ArchivedFilter = "exclude" | "only";
function withArchived<T>(q: T, archived: ArchivedFilter | undefined): T {
  const f = q as unknown as { is: (c: string, v: null) => T; not: (c: string, op: string, v: null) => T };
  return archived === "only" ? f.not("archived_at", "is", null) : f.is("archived_at", null);
}
export const MAX_CONTACT_BATCH = 500;
function capBatch(ids: readonly string[], fn: string): void {
  if (ids.length > MAX_CONTACT_BATCH) throw new Error(`${fn}: at most ${MAX_CONTACT_BATCH} contacts at once`);
}
```

In `listContacts`, add `archived?: ArchivedFilter` to `opts` and `q = withArchived(q, opts.archived);` after `q = withAssignee(q, opts.assignee);`. Do the same in `countContacts` (its `opts` type and a line after `withAssignee`).

After `deleteContacts`, add:

```ts
/** Archive (0103): the request client, so RLS and the stamp trigger decide who may and who did. Only rows that
 *  CHANGE come back, so an Undo restores exactly these and never one that was archived before (D-007's rule). */
export async function archiveContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
): Promise<{ changedIds: string[] }> {
  capBatch(contactIds, "archiveContacts");
  if (contactIds.length === 0) return { changedIds: [] };
  const { data, error } = await db.from("contacts").update({ archived_at: new Date().toISOString() })
    .eq("account_id", accountId).in("id", contactIds)
    .eq("holds_shared_number", false).is("archived_at", null)
    .select("id");
  if (error) throw new Error(`archiveContacts failed: ${error.message}`);
  return { changedIds: (data ?? []).map((r) => r.id as string) };
}

/** Restore by hand (the Archived view, the record's banner, an Archive's Undo). */
export async function restoreContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
): Promise<{ changedIds: string[] }> {
  capBatch(contactIds, "restoreContacts");
  if (contactIds.length === 0) return { changedIds: [] };
  const { data, error } = await db.from("contacts").update({ archived_at: null })
    .eq("account_id", accountId).in("id", contactIds).not("archived_at", "is", null)
    .select("id");
  if (error) throw new Error(`restoreContacts failed: ${error.message}`);
  return { changedIds: (data ?? []).map((r) => r.id as string) };
}

export const RESTORE_SIGNS = ["text", "email", "call", "booking", "form", "chat"] as const;
export type RestoreSign = (typeof RESTORE_SIGNS)[number];
/** Owner ruling Q1 (2026-10-28): the customer's own act brings an archived contact back to the list, with a
 *  "came back" row. The SERVICE client (0103 grants execute to service_role only). True when it restored.
 *  THROWS on a failure: every caller wraps it in its own try, so a restore never costs the message, call,
 *  booking or form it rides on. */
export async function restoreContactOnSign(
  serviceDb: SupabaseClient, accountId: string, contactId: string, sign: RestoreSign,
): Promise<boolean> {
  const { data, error } = await serviceDb.rpc("restore_contact_on_sign",
    { p_account_id: accountId, p_contact_id: contactId, p_sign: sign });
  if (error) throw new Error(`restoreContactOnSign failed: ${error.message}`);
  return data === true;
}

export const DELETE_BLOCK_REASONS = ["messages", "inbound_email", "calls", "forms", "consent", "automations", "bookings", "deals"] as const;
export type DeleteBlockReason = (typeof DELETE_BLOCK_REASONS)[number];
/** What keeps each contact from being deleted for good (spec §5.1), on the SERVICE client, for ids the caller
 *  already proved on its own client. One row per blocked contact (0103 step 7), so the answer fits max_rows. */
export async function contactDeleteBlockers(
  serviceDb: SupabaseClient, accountId: string, contactIds: string[],
): Promise<Map<string, DeleteBlockReason[]>> {
  capBatch(contactIds, "contactDeleteBlockers");
  const out = new Map<string, DeleteBlockReason[]>();
  if (contactIds.length === 0) return out;
  const { data, error } = await serviceDb.rpc("contact_delete_blockers", { p_account_id: accountId, p_contact_ids: contactIds });
  if (error) throw new Error(`contactDeleteBlockers failed: ${error.message}`);
  for (const r of (data ?? []) as { contact_id: string; reasons: DeleteBlockReason[] }[]) out.set(r.contact_id, r.reasons);
  return out;
}
```

Replace `deleteContacts`' body and signature. Rewrite its doc comment (`:1155-1217`) to describe the new order (spec §5.3) and keep the "ACCEPTED" residual paragraph, reworded for `lateKept`:

```ts
export async function deleteContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
  opts: {
    /** The SERVICE client: the blockers read and the delete itself (0103, executed by service_role only). */
    serviceDb: SupabaseClient;
    /** Runs on the deletable ids BEFORE any contact row is deleted; answers the ids it could not clear. The
     *  document vault's purge (0077). */
    beforeDelete?: (deletable: string[]) => Promise<string[]>;
  },
): Promise<{ deleted: number; skippedBlocked: number; skippedFiles: number; skippedIds: string[]; lateKept: number }> {
  capBatch(contactIds, "deleteContacts");
  const none = { deleted: 0, skippedBlocked: 0, skippedFiles: 0, skippedIds: [] as string[], lateKept: 0 };
  if (contactIds.length === 0) return none;
  // The proof (review I1): only ids this client READS as this account's contacts go on.
  const { data: mine, error: mineError } = await db.from("contacts").select("id")
    .eq("account_id", accountId).in("id", contactIds);
  if (mineError) throw new Error(`deleteContacts contacts pre-read failed: ${mineError.message}`);
  const ourSet = new Set((mine ?? []).map((r) => r.id as string));
  const ours = [...new Set(contactIds)].filter((id) => ourSet.has(id));
  if (ours.length === 0) return none;
  const blockers = await contactDeleteBlockers(opts.serviceDb, accountId, ours);
  const blocked = ours.filter((id) => blockers.has(id));
  const deletable = ours.filter((id) => !blockers.has(id));
  const kept = new Set(deletable.length > 0 && opts.beforeDelete ? await opts.beforeDelete(deletable) : []);
  const go = deletable.filter((id) => !kept.has(id));
  if (go.length === 0) return { ...none, skippedBlocked: blocked.length, skippedFiles: kept.size, skippedIds: blocked };
  const { data, error } = await opts.serviceDb.rpc("delete_internal_contacts", { p_account_id: accountId, p_contact_ids: go });
  if (error) throw new Error(`deleteContacts failed: ${error.message}`);
  const deleted = new Set((data ?? []) as string[]);
  // Blocked between the read and the lock (a text arrived), or a file the purge left: kept by the database.
  const late = go.filter((id) => !deleted.has(id));
  return {
    deleted: deleted.size, skippedBlocked: blocked.length + late.length, skippedFiles: kept.size,
    skippedIds: [...blocked, ...late], lateKept: late.length,
  };
}
```

In `index.ts:20-23` add to the `./contacts` export: `archiveContacts, restoreContacts, restoreContactOnSign, contactDeleteBlockers, RESTORE_SIGNS, DELETE_BLOCK_REASONS, MAX_CONTACT_BATCH, type ArchivedFilter, type RestoreSign, type DeleteBlockReason`.

- [ ] **Step 4: Run green** (the pure file) and `pnpm --filter @bis/db exec tsc --noEmit -p .`. Paste both. Then make the caller edit at `ACCT/contacts/actions.ts:500-509` (`serviceDb: serviceDb()` in place of `conversationsDb: serviceDb()`) and the `actions.test.ts:157` shape, and run `pnpm --filter web typecheck` and `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts"`, so the branch stays green between waves.

- [ ] **Step 5: Live tests (written now, run by CI).** Create `packages/db/src/test/contact-archive-live.test.ts` with `withTestAccount` (`fixtures.ts:140`; signature `(fn: (db, accountId) => Promise<void>)`). Nest two calls for the second account:

```ts
it("listContacts and countContacts agree for both views, and account B's archived and active rows never appear in A's (second account; mutation: drop withArchived from countContacts -> FAILS)", () =>
  withTestAccount((db, a) => withTestAccount(async (_db, b) => {
    const mk = async (accountId: string, first: string) => {
      const { data, error } = await db.from("contacts").insert({ account_id: accountId, first_name: first, author_kind: "person" }).select("id").single();
      if (error) throw new Error(error.message);
      return data.id as string;
    };
    const [a1, a2, aArchived] = [await mk(a, "Arch A1"), await mk(a, "Arch A2"), await mk(a, "Arch A3")];
    const [, bArchived] = [await mk(b, "Arch B1"), await mk(b, "Arch B2")];
    // The service client: the stamp trigger runs only for authenticated, so archived_by stays null (not read here).
    expect((await archiveContacts(db, a, [aArchived])).changedIds).toEqual([aArchived]);
    expect((await archiveContacts(db, b, [bArchived])).changedIds).toEqual([bArchived]);
    const ids = async (rows: Promise<{ id: string }[] | null>) => ((await rows) ?? []).map((r) => r.id).sort();
    expect(await ids(listContacts(db, a))).toEqual([a1, a2].sort());
    expect(await countContacts(db, a)).toBe(2);
    expect(await ids(listContacts(db, a, { archived: "only" }))).toEqual([aArchived]);
    expect(await countContacts(db, a, { archived: "only" })).toBe(1);
    expect(await ids(listContacts(db, a, { search: "Arch" }))).toEqual([a1, a2].sort());
  })));
```

Write it in full against the real functions, and add one test for each of these:
- search (`opts.search`) still leaves an archived match out;
- an Archived-view page boundary with `limit: 1` and `before`;
- `archiveContacts` with an id from account B changes nothing in B;
- dedupe (`createContact` with an archived contact's phone, then its email) returns that archived contact's id and `existing: true` (mutation: add `.is("archived_at", null)` in `findDuplicate` → FAILS);
- `applyImportBatch` matching an archived contact by email fills a blank and leaves `archived_at` set (spec §4.2: an import never restores);
- `restoreContactOnSign(db, a, id, "form")` returns true once and false the second time.

- [ ] **Step 6: Update `src/test/contacts.test.ts`.** Every `deleteContacts(` call (12, read off the file) passes `{ serviceDb: db, … }` in place of `conversationsDb`, and each result expectation gains `skippedIds`/`lateKept`. Change the tests at `:1012`, `:1051`, `:1060` and `:1117`:
- `:1051` ("without conversationsDb an empty conversation still blocks"): DELETE it. The behaviour no longer exists, because `serviceDb` is required. Name the deletion in your report.
- `:1060`: keep it, renamed. A deal blocks the contact, and its conversation and reply token are untouched. The `delete_empty_conversations` wording goes.
- `:1012` and `:1117`: keep them; they still hold under `delete_internal_contacts`.
- ADD: "a contact with only a call row is blocked (calls are SET NULL, so before 0103 the delete orphaned the call) (mutation: drop the 'calls' exists -> FAILS)".

- [ ] **Step 7: Mutation probes** (pure file, local): (a) delete `q = withArchived(q, opts.archived);` in `countContacts` → "countContacts does too" fails. (b) In `archiveContacts` delete `.is("archived_at", null)` → its test fails. (c) In `deleteContacts` pass `ours` (not `go`) to `delete_internal_contacts` → the first deleteContacts test fails. (d) Return `deleted: go.length` → "lateKept" fails. Each must be seen red by name.

- [ ] **Step 8: Commit** the seven paths with `git commit -m "feat(contacts): archive filter, archive and restore, sign restore and internal-only delete in the contact queries" -- …`.

---

### Task 5: Scheduled sends skip archived contacts

**Tier:** medium · **Owner:** bis-automations · **Wave:** 2

**Files:**
- Modify: `packages/db/src/automations.ts`. The SELECT constants: `REVIEW_REQUEST_SELECT :267-268`, `NO_SHOW_NUDGE_SELECT :452-453`, `REFERRAL_ASK_SELECT :1083-1084`, `QUOTE_FOLLOWUP_SELECT :1954-1955`. The query sites: `:306`, `:331`, `:492`, `:513`, `:1156`, `:1179`, `:2085`, `:2166`. The reactivation walk `:1574-1582` and `getDueReactivationById :1719-1722`.
- Modify: `packages/db/src/booking.ts` (`FOLLOWUP_SELECT :1575`, query sites `:1598`, `:1624`)
- Create: `packages/db/src/automations-archive.test.ts` (pure, local)
- Create: `packages/db/src/test/automations-archive-live.test.ts` (CI only)

**Must NOT change** (ruling Q2: promises already made): `SMS_REMINDER_SELECT :607-608`, `APPOINTMENT_CONFIRM_SELECT :755-756`, `REMINDER_SELECT booking.ts:1439`, and the cancel-notice sweep.

**Interfaces:** consumes T1's `archived_at` column. Produces nothing new.

**Run locally:** `cd packages/db && pnpm exec vitest run src/automations-archive.test.ts src/own-account-embeds.test.ts`

- [ ] **Step 1: Pure failing test.** Create `packages/db/src/automations-archive.test.ts` with the same `recordingDb` as T4 Step 1 (copied; files stay disjoint). The by-id reads each issue their first query with the archive filter, which a fake can record:

```ts
import { getDueReviewRequestById, getDueNoShowNudgeById, getDueReferralAskById, getDueQuoteFollowupById,
         getDueReactivationById, getDueSmsReminderById, getDueAppointmentConfirmById } from "./automations";
import { getDueFollowupById, getDueReminderById } from "./booking";

const STARTS_A_CONVERSATION = [
  ["getDueReviewRequestById", getDueReviewRequestById, "contacts.archived_at"],
  ["getDueNoShowNudgeById", getDueNoShowNudgeById, "contacts.archived_at"],
  ["getDueReferralAskById", getDueReferralAskById, "contacts.archived_at"],
  ["getDueQuoteFollowupById", getDueQuoteFollowupById, "contacts.archived_at"],
  ["getDueFollowupById", getDueFollowupById, "contacts.archived_at"],
  ["getDueReactivationById", getDueReactivationById, "archived_at"],
] as const;
const KEEPS_A_PROMISE = [
  ["getDueSmsReminderById", getDueSmsReminderById],
  ["getDueAppointmentConfirmById", getDueAppointmentConfirmById],
  ["getDueReminderById", getDueReminderById],
] as const;

describe("ruling Q2: archived means no new conversation, and promises already made are kept", () => {
  it.each(STARTS_A_CONVERSATION)("%s reads only contacts that are not archived (mutation: drop its .is filter -> FAILS)", async (_n, fn, col) => {
    const { db, calls } = recordingDb();
    const r = await fn(db, "id-1");
    expect(has(calls, "is", col, null)).toBe(true);
    expect(r).toEqual({ due: null, why: "gone" });
  });
  it.each(KEEPS_A_PROMISE)("%s still reads an archived contact's appointment (mutation: add the filter here -> FAILS)", async (_n, fn) => {
    const { db, calls } = recordingDb();
    await fn(db, "id-1");
    expect(calls.some((c) => JSON.stringify(c.args).includes("archived_at"))).toBe(false);
  });
});
```

Read each by-id function's real signature first (`automations.ts:329`, `:511`, `:656`, `:806`, `:1175`, `:1716`, `:2162`; `booking.ts` `getDueFollowupById`, `getDueReminderById`). If one takes more than `(db, id)`, pass what it needs.

- [ ] **Step 2: Run red.** Expected: six `expected false to be true` lines, one per conversation-starting read. Paste one.

- [ ] **Step 3: Implement.**
  - In each of the four SELECT constants and `FOLLOWUP_SELECT`, change `contacts(account_id, …)` to `contacts!inner(account_id, …, archived_at)`. Keep `account_id` inside the embed: `ownAccountContactOnly` (`:257-259`) fails closed without it. `QUOTE_FOLLOWUP_SELECT` is already `!inner`; add `archived_at`.
  - At each of the ten list and by-id query sites (`:306`, `:331`, `:492`, `:513`, `:1156`, `:1179`, `:2085`, `:2166`, `booking.ts:1598`, `:1624`), add `.is("contacts.archived_at", null)` right after `.select(…)`.
  - In the reactivation walk (`:1575-1578`), add `archived_at` to the `contacts!inner(...)` select and `.is("contacts.archived_at", null)` after `.is("contacts.reactivation_sent_at", null)`. In `getDueReactivationById` (`:1719-1722`), add `.is("archived_at", null)` after `.is("reactivation_sent_at", null)`.
  - Each line carries a short comment: `// Contact archive (0103), owner ruling Q2: archived means no new conversation. In the QUERY, never after the page: a bounded page full of archived rows would starve the rest (cf. :1510-1527).`
  - A by-id read that now finds nothing answers `{ due: null, why: "gone" }` through its existing `if (!data)` branch. The pass logs it and the held row leaves the release queue. No pass file changes.

- [ ] **Step 4: Run green** (pure, plus `own-account-embeds.test.ts`, which pins the embed shapes). Paste the summary line.

- [ ] **Step 5: Live tests (CI).** `src/test/automations-archive-live.test.ts`, with `withTestAccount` nested for two accounts and the recipe and seed helpers of `src/test/automations*.test.ts` (read the closest existing test for each recipe and copy its seed). For each of the six conversation-starting lists:
  - one case where account A's archived customer's row is NOT returned and account B's identical active row IS. (Mutation: drop that list's `.is` → FAILS.)
  - For the SMS reminder and the appointment confirmation: A's archived customer's upcoming appointment IS returned. (Mutation: add the filter → FAILS.)
  - One starvation case for reactivation: `pageSize: 2`, the oldest four conversations belong to archived contacts, and an active one behind them is still found. (Mutation: filter in memory after the page instead of in the query → FAILS.)

- [ ] **Step 6: Mutation probes** (local, pure): for each of the six by-id reads, delete its `.is(…)` line → its `it.each` row fails by name. Add `.is("contacts.archived_at", null)` to `getDueSmsReminderById`'s query → its KEEPS row fails.

- [ ] **Step 7: Commit:** `git commit -m "feat(automations): follow-ups, reviews, referrals, no-show nudges, reactivation and quote follow-ups skip archived contacts; reminders still go" -- packages/db/src/automations.ts packages/db/src/booking.ts packages/db/src/automations-archive.test.ts packages/db/src/test/automations-archive-live.test.ts`

---

### Task 6: Inbox, unread badge and conversation search

**Tier:** medium · **Owner:** bis-comms · **Wave:** 2

**Files:**
- Modify: `packages/db/src/messaging.ts` (`sumUnreadCount :629-636`, `listConversations` embed `:657` and query `:658-685`, `searchConversations` second read `:937-940`)
- Create: `packages/db/src/messaging-archive.test.ts` (pure, local)
- Create: `packages/db/src/test/messaging-archive-live.test.ts` (CI only)

**Unchanged on purpose:** `getConversationSummary` (`:777-800`). A deep link to an archived contact's thread still opens it, matching the record page (spec §4.1).

**Run locally:** `cd packages/db && pnpm exec vitest run src/messaging-archive.test.ts`

- [ ] **Step 1: Pure failing test** (`recordingDb` copied as in T4):

```ts
describe("an archived contact's thread is off the inbox, its badge and its search (spec §4.1)", () => {
  it("sumUnreadCount counts no archived contact's unread (mutation: drop the filter -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await sumUnreadCount(db, "A");
    expect(has(calls, "is", "contacts.archived_at", null)).toBe(true);
    expect(calls.some((c) => c.method === "select" && String(c.args[0]).includes("contacts!inner("))).toBe(true);
  });
  it("listConversations lists no archived contact's thread, with or without Mine (mutation: filter only in the assignee branch -> FAILS)", async () => {
    for (const opts of [{}, { assignee: { who: "mine" as const, userId: "u1" } }]) {
      const { db, calls } = recordingDb();
      await listConversations(db, "A", opts);
      expect(has(calls, "is", "contacts.archived_at", null)).toBe(true);
    }
  });
  it("searchConversations finds no archived contact's thread (mutation: drop it -> FAILS)", async () => {
    const { db, calls } = recordingDb({ messages: [{ conversation_id: "cv1", body: "roof", created_at: "t" }] });
    await searchConversations(db, "A", { search: "roof" });
    expect(has(calls, "is", "contacts.archived_at", null)).toBe(true);
  });
});
```

- [ ] **Step 2: Run red.** Paste the first failing line.
- [ ] **Step 3: Implement.**
  - `sumUnreadCount`: `.select("unread_count, contacts!inner(archived_at)").eq("account_id", accountId).is("contacts.archived_at", null)`.
  - `listConversations`: both embeds become `contacts!inner(…, archived_at)` (the unfiltered one gains `!inner`), and `.is("contacts.archived_at", null)` goes after `.eq("messages.account_id", accountId)`. Rewrite the comment at `:651-656`. The unfiltered inbox is no longer byte-for-byte the old query; say why (archive, 0103). `conversations.contact_id` is NOT NULL (`0005_messaging.sql:14`), so the inner join drops nothing except through this filter.
  - `searchConversations` (`:937-940`): select `contacts!inner(…, archived_at)` and add `.is("contacts.archived_at", null)`.
- [ ] **Step 4: Run green.** Paste.
- [ ] **Step 5: Live tests (CI)**, two accounts:
  - A's archived contact's thread with unread 2 is not listed, and A's badge sum excludes those 2. B's identical active thread IS in B's inbox and badge, and never in A's.
  - A search for a word in A's archived thread finds nothing, while the same word in A's active thread is found.
  - A Technician's inbox (`actAs` with the technician role) is unchanged for their own assigned, active customer. This proves the inner join adds no RLS loss.
  - Mutations: drop each `.is` in turn → its case FAILS.
- [ ] **Step 6: Mutation probes** (pure): remove each of the three `.is` lines → its test fails by name.
- [ ] **Step 7: Commit** the three paths: `fix(sms): an archived contact's thread leaves the inbox, the unread badge and search`.

---

### Task 7: Archive rows on the timeline

**Tier:** medium · **Owner:** bis-crm · **Wave:** 3 (needs T4 merged: it appends a `describe` to T4's live file)

**Files:**
- Modify: `packages/db/src/record.ts` (`TimelineSource :276`, `TIMELINE_SOURCES :280`, the `TimelineEntry` union `:325-352`, a new `settle("archive", …)` in `listTimelinePage` after `:503`)
- Modify: `packages/db/src/test/contact-archive-live.test.ts` (append one `describe`)
- Modify: `apps/web/src/lib/record/author-mark.ts` (`authorOf`, `:26-…`) and `apps/web/src/lib/record/author-mark.test.ts`
- Modify: `apps/web/src/lib/record/timeline-rows.ts` (`SOURCE_KEY :67-71`, `phrase` `:120-…`) and `apps/web/src/lib/record/timeline-rows.test.ts`
- Modify: `apps/web/src/lib/record/recent-rows.ts` and `apps/web/src/lib/record/recent-rows.test.ts`
- Modify: `ACCT/contacts/[contactId]/activity-timeline.tsx` (the `Row` switch, `:146-300`)
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.tsx`
- Create: `ACCT/contacts/[contactId]/activity-timeline.archive.test.ts`

These are the six files that switch over `TimelineEntry["kind"]` (found by `"documentShareOpened"`, 2026-10-28). Read each switch before adding the arm.

**Interfaces:** Produces `{ kind: "archive"; id: string; at: string; contactId: string; archive: TimelineArchive }`, where `TimelineArchive = { action: "archived" | "restored"; author_kind: "person" | "customer"; author_id: string | null; sign: RestoreSign | null }`. `id` is the log row's id as a string.

**Run:** `pnpm --filter web exec vitest run src/lib/record "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]" "src/app/(dashboard)/dashboard/accounts/[accountId]/groups"` and `pnpm --filter @bis/db exec tsc --noEmit -p .`

- [ ] **Step 1: Failing tests.**
  - In `timeline-rows.test.ts`: a person "archived" row reads `timeline.archived` with the person mark; a customer "restored" row with sign `text` reads `timeline.cameBack.text` with the customer mark (mutation: map every customer row to `timeline.restored` → FAILS).
  - In `author-mark.test.ts`: `authorOf` of an archive row is `{ kind: "person", personId: author_id }` or `{ kind: "customer", personId: null }` (mutation: return `unnamed()` → FAILS).
  - `activity-timeline.archive.test.ts`: render one archive row through the same helper `activity-timeline.rows.test.ts` uses (read it and copy its render approach), and assert the verb text and the `data-record-…` attributes the other row tests assert.
- [ ] **Step 2: Run red.** Paste.
- [ ] **Step 3: Implement.**
  - `record.ts`: add `"archive"` to `TimelineSource` and to `TIMELINE_SOURCES`. Add the union member. Add the reader:

```ts
async function listContactArchiveLog(db: SupabaseClient, accountId: string, who: readonly string[], page: { limit: number; before?: TimelineCursor }) {
  let q = forContacts(db.from("contact_archive_log")
    .select("id, contact_id, action, author_kind, author_id, sign, created_at").eq("account_id", accountId), "contact_id", who)
    .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(page.limit);
  // Same cursor clause the other sources build from `page.before`: copy the one listContactSubmissions' caller uses.
  …
}
```

  Read the exact `forContacts` signature (`record.ts:125`) and the cursor clause the `notes` source uses (`:450`) before writing. Copy that clause; do not invent one.
  - `settle("archive", async () => (await listContactArchiveLog(db, accountId, who, page)).map((r) => ({ kind: "archive", id: String(r.id), at: r.created_at, contactId: r.contact_id, archive: { … } })))`
  - `author-mark.ts` `authorOf`: `case "archive": return e.archive.author_kind === "customer" ? { kind: "customer", personId: null } : { kind: "person", personId: e.archive.author_id };`
  - `timeline-rows.ts`: `SOURCE_KEY.archive = "timeline.what.archive"` and the `phrase` arm: `action === "archived"` → `timeline.archived`; a customer row → `timeline.cameBack.<sign>`; a person restore → `timeline.restored`. Status and detail are null.
  - `recent-rows.ts`, `activity-timeline.tsx`, `group-timeline.tsx`: an arm rendering `<TimelineItem {...head} icon={Archive} />` (lucide `Archive`; `ArchiveRestore` for restores) with no body.
  - The page and loader tests mock `TIMELINE_SOURCES` with explicit lists (`ACCT/contacts/[contactId]/page.test.ts:114` and four others, found by grep 2026-10-28). Those are mocks, so leave them unchanged unless one asserts the real list's length.
- [ ] **Step 4: Run green**, plus `pnpm --filter web typecheck`. Paste both.
- [ ] **Step 5: Live (CI).** Append to `packages/db/src/test/contact-archive-live.test.ts`: archive and restore one of A's contacts (on a request-shaped client if the file has one, else seed log rows on the service client). `listContactTimelinePage` shows the rows newest first. B's log rows for its own contact never appear in A's page (second account).
- [ ] **Step 6: Mutation:** drop the `settle("archive", …)` line → the live case fails (CI). Swap `cameBack.<sign>` for `timeline.restored` → the timeline-rows test fails (local).
- [ ] **Step 7: Commit** the listed paths: `feat(contacts): archive and came-back rows on the record, household and drawer timelines`.

---

### Task 8: A meaningful call brings an archived contact back

**Tier:** medium · **Owner:** bis-voice · **Wave:** 3

**Files:**
- Modify: `apps/web/src/lib/voice/finish-call.ts` (after the language-signal block `:614-626`)
- Modify: `apps/web/src/lib/voice/finish-call.test.ts` (`dbMocks`, and the new cases)

Sofía's in-call booking ends with outcome `booked`, which `isMeaningful` (`:166-170`) covers, so `apps/web/src/lib/voice/tools/registry.ts` needs no restore call. That is a deviation from the spec's §4.2 table row 2, and the timeline reads "came back: called and talked with Sofía".

**Run:** `pnpm --filter web exec vitest run src/lib/voice/finish-call.test.ts`

- [ ] **Step 1: Failing tests.** Add `restoreContactOnSign: vi.fn()` to the hoisted `dbMocks`, with `mockResolvedValue(false)` in `beforeEach`. Then:

```ts
it("a lead call on an archived contact restores it with the call sign (ruling Q1; mutation: drop the restore -> FAILS)", async () => {
  const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
    { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
  await finishCall(s, ctx, meta);
  // The contact id is whatever this file's createContact mock resolves in beforeEach: read it and put it here.
  expect(dbMocks.restoreContactOnSign).toHaveBeenCalledWith({}, "a1", CREATED_CONTACT_ID, "call");
});
it("an abandoned call restores nobody (mutation: restore outside `if (contactId)` -> FAILS)", async () => {
  await finishCall(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }), ctx, meta);
  expect(dbMocks.restoreContactOnSign).not.toHaveBeenCalled();
});
it("a failed restore never costs the call its alert (mutation: let it throw -> FAILS)", async () => {
  dbMocks.restoreContactOnSign.mockRejectedValueOnce(new Error("boom"));
  const s = withLead(withTranscript(emptyCallState(), { role: "caller", text: "hi", at: "t" }),
    { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "+19562921696" } });
  expect(await finishCall(s, ctx, meta)).toMatchObject({ notified: true });
});
```

Define `const CREATED_CONTACT_ID` at the top of the new `describe` as the id the file's `createContact` mock resolves in `beforeEach` (read it; do not guess).

- [ ] **Step 2: Run red.** Paste.
- [ ] **Step 3: Implement**, right after the language-signal `if (contactId) { … }` block:

```ts
  // Contact archive, owner ruling Q1 (2026-10-28): a call that ended booked, lead or message is the customer getting in
  // touch again, so an archived contact comes back to the list. `contactId` is set only for meaningful calls (above).
  // Its own try: a restore never costs the call.
  if (contactId) {
    try {
      await restoreContactOnSign(ctx.db, ctx.accountId, contactId, "call");
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: restore failed: ${String(e)}`);
    }
  }
```

`ctx.db` is the service client (`FinishContext.db`, `finish-call.ts:521`). Add `restoreContactOnSign` to the `@bis/db` import at `:3`.
- [ ] **Step 4: Run green.** Paste.
- [ ] **Step 5: Mutation:** delete the block → the first test fails. Move the call above `if (contactId)` with `contactId!` → the abandoned test fails.
- [ ] **Step 6: Commit** the two paths: `feat(voice): an answered call brings an archived customer back to the list`.

---

### Task 9: Texts, emails, bookings, forms and chats bring an archived contact back

**Tier:** medium · **Owner:** bis-crm · **Wave:** 3

**Files:**
- Modify: `apps/web/src/app/api/sms/inbound/route.ts` (inside `if (firstFiling)` after the confirmation block, `:233-276`)
- Modify: `apps/web/src/app/api/sms/inbound/route.test.ts` (mock `:35`), `apps/web/src/app/api/sms/inbound/route.consent.test.ts` (mock `:22`)
- Modify: `apps/web/src/app/b/[publicId]/actions.ts` (after the language-signal block `:374-382`), `apps/web/src/app/b/[publicId]/actions.test.ts` (mock `:105`)
- Modify: `apps/web/src/lib/forms/enrich.ts` (after the language-signal try `:121-131`), `apps/web/src/lib/forms/enrich.test.ts` (mock `:12`), `apps/web/src/app/f/[publicId]/actions.test.ts` (mock `:64`, stub only)
- Modify: `apps/web/src/lib/email/inbound/file.ts` (after `createMessage`, `:114-118`), `apps/web/src/lib/email/inbound/file.test.ts` (mock `:4`)

**Interfaces:** consumes `restoreContactOnSign` and `RestoreSign` (T4).

**Run:** `pnpm --filter web exec vitest run src/app/api/sms/inbound "src/app/b/[publicId]/actions.test.ts" src/lib/forms "src/app/f/[publicId]/actions.test.ts" src/lib/email/inbound src/app/api/concierge src/lib/concierge`

The concierge files are in the run to prove they need no change: their tests mock `enrich` whole.

- [ ] **Step 1: Failing tests, one per site:**
  - **SMS** (`route.test.ts`): a plain inbound text on a non-shared number calls `restoreContactOnSign(db, accountId, contactId, "text")` once. A STOP calls it never, and so do START, HELP, a Telnyx autoresponse (`consent.kind` `stop`/`start`/`help`/`telnyx_only`/`phrase`) and a shared-number text. (Mutation: drop the `consent.kind === "none"` condition → the STOP case FAILS. Drop `!shared` → the shared case FAILS.)
  - **Booking page** (`actions.test.ts`): a successful booking restores with `"booking"`. A slot-taken booking (`SlotTakenError`) restores nobody. (Mutation: restore before `createBooking` → FAILS.)
  - **Forms** (`enrich.test.ts`): a form submission restores with `"form"`; a web chat lead (`webchat: { chatId }`) with `"chat"`. (Mutation: always `"form"` → FAILS.) A failing restore still records the conversation and the alert.
  - **Email** (`file.test.ts`): a filed email restores with `"email"`. A teammate's forward (`forward` set) and a clear STOP (`cls.kind === "clear"`) restore nobody. (Mutation: drop the `!forward` term → FAILS.)
  - **f/actions.test.ts**: add the stub only, and assert nothing new. The file must stay green.
- [ ] **Step 2: Run red.** Paste one line per site.
- [ ] **Step 3: Implement**, each in its own try, logged and never thrown:
  - **SMS**, inside `if (firstFiling)`, after the confirmation `try`:

```ts
    // Contact archive, owner ruling Q1: a customer's own text brings an archived contact back. Not a STOP, START or
    // HELP, not a reply Telnyx already answered (consent.kind), and not a shared number's holding record.
    if (consent.kind === "none" && !shared) {
      try {
        await restoreContactOnSign(db, accountId, contact.id, "text");
      } catch (e) {
        log("could not restore an archived contact — the customer's message is filed regardless", accountId, loggableError(e));
      }
    }
```

  - **Booking page**: after the `pageSign` block: `try { await restoreContactOnSign(db, calendar.account_id, contactId, "booking"); } catch (e) { console.error(\`booking ${publicId}: restore failed for contact ${contactId}: ${String(e)}\`); }`
  - **enrich**: after the language-signal try: `try { await restoreContactOnSign(db, accountId, contactId, webchat ? "chat" : "form"); } catch (e) { console.error(\`form ${form.id} submission ${submissionId}: restore failed for contact ${contactId}: ${e instanceof Error ? e.message : String(e)}\`); }`
  - **email**: after the `createMessage` call inside `if (!forward)`. Add `restoreContactOnSign` to the import at `:1`:

```ts
    // Contact archive, owner ruling Q1: a customer's own email (not a clear stop) brings an archived contact back.
    if (cls.kind !== "clear") {
      try { await restoreContactOnSign(db, row.accountId, i.contactId, "email"); }
      catch (e) { console.error(`fileInboundEmail: restore failed for ${i.contactId}: ${String(e)}`); }
    }
```

  Confirm `db` in `file.ts` is the service client. Read `FileDeps`; the pipeline passes the service client. If a manual "File" from the inbox passes a request client, pass `serviceDb()` here instead, and say so in your report.
- [ ] **Step 4: Run green.** Paste.
- [ ] **Step 5: Mutation probes** as named in Step 1. Each must fail by name.
- [ ] **Step 6: Commit** the eleven paths: `feat(contacts): a text, email, booking, form or chat from the customer brings an archived contact back`.

---

### Task 10: List, bulk bar, actions and the new delete dialog

**Tier:** medium · **Owner:** bis-crm · **Wave:** 3

**Files:**
- Create: `apps/web/src/lib/contacts/view.ts`, `apps/web/src/lib/contacts/view.test.ts`
- Create: `ACCT/contacts/archive-actions.ts`, `ACCT/contacts/archive-actions.test.ts`
- Modify: `ACCT/contacts/actions.ts:476-524` (`bulkDeleteContactsAction`) and `:51-99` (`createContactAction`: an archived match), `ACCT/contacts/actions.test.ts`
- Modify: `ACCT/contacts/bulk-action-bar.tsx`, `ACCT/contacts/bulk-action-bar.test.ts`
- Modify: `ACCT/contacts/contacts-table.tsx` (the `view` prop, threaded to `BulkActionBar` at `:196-205`), `ACCT/contacts/contacts-table.test.ts`
- Modify: `ACCT/contacts/page.tsx`, `ACCT/contacts/page.test.ts`
- Modify: `ACCT/contacts/add-contact-dialog.tsx` (`:62`, `:114-120`), `ACCT/contacts/add-contact-dialog.test.ts`
- Modify: `ACCT/contacts/export/route.ts:128` (passes `archived` from `?view=`), `ACCT/contacts/export/route.get.test.ts`

**Interfaces:** Produces the three actions in "Shared facts". `bulkDeleteContactsAction`'s ok-result gains `skippedIds` and `lateKept`. `parseView(raw): "active" | "archived"`, `withView(params, view)` and `archivedFilterOf(view)` come from `lib/contacts/view.ts`.

**Run:** `pnpm --filter web exec vitest run src/lib/contacts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts"` and `pnpm --filter web typecheck`

- [ ] **Step 1: `view.ts` test first, then the module:**

```ts
// apps/web/src/lib/contacts/view.ts
export type ContactsView = "active" | "archived";
/** `?view=archived` is the Archived view; anything else is the list. */
export function parseView(raw: unknown): ContactsView { return raw === "archived" ? "archived" : "active"; }
/** Carries the view on every link the list builds (pager, sort, search), so paging the Archived view stays in it. */
export function withView(params: Record<string, string>, view: ContactsView): Record<string, string> {
  return view === "archived" ? { ...params, view: "archived" } : params;
}
export const archivedFilterOf = (view: ContactsView) => (view === "archived" ? "only" : "exclude") as "only" | "exclude";
```

  Tests: `parseView("archived")`, `parseView("x")`, `parseView(undefined)`, and `withView` adding and not adding the key. Mutation: `parseView` returning "archived" for any truthy value → FAILS.

- [ ] **Step 2: `archive-actions.ts`, red first.** In `archive-actions.test.ts`, mock `@/lib/auth`, `@/lib/db` and `@bis/db` in the pattern of `actions.test.ts:20-70` (read it). The tests:
  - Staff archive succeeds and an Undo-able `changedIds` comes back. A Technician gets `{ ok: false, errorKey: "contacts.archive.failed" }` and `archiveContacts` is never called. (Mutation: drop the `seesWholeAccount` check → FAILS.)
  - Non-UUID ids, an empty list, or 501 ids are refused before any db call.
  - One archived contact with an upcoming booking answers `nextAppointment` with its `startsAt`. Three with two booked answer `withAppointments: 2`. (Mutation: read bookings for the whole selection, not `changedIds` → FAILS.)
  - `contactDeleteBlockersAction` is Owner-only (`requireAccountOwner` with `duringPause: "allow"`, as `countContactDocumentsAction` at `:527-541`). It reads the ids on the request client first and passes only the proven ones to `contactDeleteBlockers(serviceDb(), …)`. (Mutation: pass the raw ids → FAILS.)

  Then write `archive-actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess, requireAccountOwner } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { seesWholeAccount } from "@/lib/auth-role";
import { isUuid } from "@/lib/assign/action-guards";
import { archiveContacts, restoreContacts, contactDeleteBlockers, listContactUpcomingBookings, serviceDb,
         MAX_CONTACT_BATCH, type DeleteBlockReason } from "@bis/db";
import { loggableError } from "@/lib/loggable-error";

export type ArchiveActionResult =
  | { ok: true; changedIds: string[]; nextAppointment: { contactId: string; startsAt: string } | null; withAppointments: number }
  | { ok: false; errorKey: "contacts.archive.failed" | "contacts.restore.failed" };

const okIds = (ids: unknown): ids is string[] =>
  Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_CONTACT_BATCH && ids.every((id) => isUuid(id));
const contactsPath = (accountId: string) => `/dashboard/accounts/${accountId}/contacts`;

/** Archive (owner rulings 2026-10-28): Owners, Staff and the agency; Technicians never (Q3; 0103's stamp trigger
 *  refuses them too). Runs at once; the caller's toast offers Undo with `changedIds`. An upcoming appointment stays,
 *  and its reminders still go (Q2): the toast names it. */
export async function archiveContactsAction(accountId: string, contactIds: string[]): Promise<ArchiveActionResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !okIds(contactIds)) return { ok: false, errorKey: "contacts.archive.failed" };
  try {
    const db = await dbForRequest();
    const { changedIds } = await archiveContacts(db, accountId, contactIds.map((id) => id.toLowerCase()));
    let nextAppointment: { contactId: string; startsAt: string } | null = null;
    let withAppointments = 0;
    if (changedIds.length > 0) {
      try {
        const upcoming = await listContactUpcomingBookings(db, accountId, changedIds, new Date().toISOString(), MAX_CONTACT_BATCH);
        withAppointments = new Set(upcoming.map((b) => b.contact_id)).size;
        const first = upcoming[0];
        if (changedIds.length === 1 && first) nextAppointment = { contactId: first.contact_id, startsAt: first.starts_at };
      } catch (e) {
        // The archive happened; only the toast's appointment line is lost.
        console.error(`contacts archive: upcoming read failed (account ${accountId}): ${loggableError(e)}`);
      }
    }
    revalidatePath(contactsPath(accountId));
    return { ok: true, changedIds, nextAppointment, withAppointments };
  } catch (e) {
    console.error(`contacts archive (account ${accountId}): ${loggableError(e)}`);
    return { ok: false, errorKey: "contacts.archive.failed" };
  }
}

export async function restoreContactsAction(accountId: string, contactIds: string[]): Promise<ArchiveActionResult> {
  const access = await requireAccountAccess(accountId);
  if (!seesWholeAccount(access) || !okIds(contactIds)) return { ok: false, errorKey: "contacts.restore.failed" };
  try {
    const { changedIds } = await restoreContacts(await dbForRequest(), accountId, contactIds.map((id) => id.toLowerCase()));
    revalidatePath(contactsPath(accountId));
    return { ok: true, changedIds, nextAppointment: null, withAppointments: 0 };
  } catch (e) {
    console.error(`contacts restore (account ${accountId}): ${loggableError(e)}`);
    return { ok: false, errorKey: "contacts.restore.failed" };
  }
}

/** The delete dialog's "which of these can go" read (spec §5.4), Owner-only, usable while paused like the file count. */
export async function contactDeleteBlockersAction(
  accountId: string, contactIds: string[],
): Promise<{ ok: true; blocked: Record<string, DeleteBlockReason[]> } | { ok: false }> {
  await requireAccountOwner(accountId, { duringPause: "allow" });
  if (!okIds(contactIds)) return { ok: false };
  try {
    const ids = contactIds.map((id) => id.toLowerCase());
    const { data, error } = await (await dbForRequest()).from("contacts").select("id").eq("account_id", accountId).in("id", ids);
    if (error) throw new Error(error.message);
    const proven = (data ?? []).map((r) => r.id as string);
    return { ok: true, blocked: Object.fromEntries(await contactDeleteBlockers(serviceDb(), accountId, proven)) };
  } catch (e) {
    console.error(`contacts delete: blockers read failed (account ${accountId}): ${loggableError(e)}`);
    return { ok: false };
  }
}
```

  Read `listContactUpcomingBookings`' return type (`packages/db/src/booking.ts:1101-1133`). If its rows are not `{ contact_id, starts_at }`, adapt the two property reads; do not change that function.

- [ ] **Step 3: `bulkDeleteContactsAction`.** (T4 already passes `serviceDb`.) Return `skippedIds` and `lateKept`. If `purged > 0 && r.lateKept > 0`, return `ok: true` with the counts. The bar shows `contacts.delete.filesGoneKept` for that case: extend `announceDeleteResult` (Step 4) rather than the action's error branch. Add one test: the ok-result carries `skippedIds` straight from `deleteContacts` (mutation: return `skippedIds: []` → FAILS).

- [ ] **Step 4: Bulk bar.** In `bulk-action-bar.tsx`:
  - Props gain `view: ContactsView`, `canArchive: boolean` and `timezone: string`.
  - In `view === "active"` with `canArchive`, show a ghost `Archive` button (lucide `Archive` icon). Its click runs `archiveSelected(...)`, a NEW exported pure async function in the shape of `assignSelected` (`:66-97`). It calls `archiveContactsAction`, then `onDone()`, then toasts `bulk.archived`/`bulk.archivedOne` (through `plural`). The toast's description is `contacts.archive.keepsAppointment` (date via `formatDateInZone(startsAt, timezone, locale)`) when `nextAppointment` is set, or `contacts.archive.keepsAppointments` when `withAppointments > 0`. Its action is `common.undo`, which calls `restoreContactsAction(accountId, r.changedIds)`. With `changedIds.length === 0` it toasts with no Undo.
  - In `view === "archived"` with `canArchive`, show a ghost `Restore` button running `restoreSelected(...)`, same shape: `bulk.restored`/`bulk.restoredOne`, with Undo calling `archiveContactsAction(accountId, r.changedIds)`.
  - Rule 4: a Technician's bar keeps Add tag, so it is never empty.
  - The delete dialog: `openConfirm` also starts `contactDeleteBlockersAction`, through a second `latestCountSettler` (`:137-142`). A new state, `blockers: { status: "loading" } | { status: "ready"; kept: string[] } | { status: "error" }`. Change `canConfirmDelete(typed, count, files)` to `canConfirmDelete(typed, deletable, files, blockers)`. It is true only when both reads are ready, `deletable > 0` and `typed.trim() === String(deletable)`. `deletable = count - kept.length`. The title uses `deletable` once ready (the selection count while loading). The body line shows `contacts.delete.someKept` when `kept.length > 0`. When `deletable === 0`, show `contacts.delete.noneDeletable` and a ghost `contacts.delete.archiveInstead` button ("Archive", no word "delete") running `archiveSelected` on the selection, with no Delete button. A failed blockers read shows `contacts.delete.blockersFailed` and Delete stays off.
  - `announceDeleteResult`: when `skippedBlocked > 0` the toast is `bulk.deletedSkipped` with action `bulk.archiveKept` → `archiveSelected(accountId, r.skippedIds, …)`. When `lateKept > 0` and files were purged, ALSO show `contacts.delete.filesGoneKept` (an error toast).

  Tests in `bulk-action-bar.test.ts`, in the style of the existing `assignSelected`/`announceDeleteResult` tests:
  - `archiveSelected`'s Undo calls `restoreContactsAction` with exactly `changedIds` (mutation: pass the selection → FAILS);
  - the appointment line uses the formatted date (mutation: drop the description → FAILS);
  - `canConfirmDelete` stays false while blockers load (mutation: ignore blockers → FAILS);
  - `canConfirmDelete` takes the deletable count, not the selection (mutation: compare to `count` → FAILS);
  - `announceDeleteResult`'s "Archive them" archives exactly `skippedIds` (mutation: pass the selection → FAILS).

- [ ] **Step 5: Page and table.** In `page.tsx`:
  - Read `view` from `searchParams` (`:150`, `:153`) through `parseView`.
  - Pass `archived: archivedFilterOf(view)` to `listContacts` and `countContacts` (`:182-185`).
  - `buildNewerHref`/`buildOlderHref` gain a last `view: ContactsView = "active"` argument and wrap their params with `withView(…, view)`. `buildExportHref` gains `view` too.
  - The search form gains `{view === "archived" ? <input type="hidden" name="view" value="archived" /> : null}`.
  - In the Archived view: the title is `contacts.archived.title` and the count `contacts.archived.count`/`countOne` (through `tr.count`). The header actions hide Import and Add contact and keep Export. A ghost `Link` to `base` reads `contacts.archived.back`, and `WhoFilter` is hidden.
  - In the active view: one more ghost `Link`, `contacts.archived.link` ("Archived"), to `?view=archived`, shown for `seesWholeAccount(access)`. **Never a link named "Contacts".**
  - Empty state: in the Archived view `EmptyState` gets `title=contacts.archived.emptyTitle`, `body=contacts.archived.emptyBody` and `action={<Link href={base}>…contacts.archived.back</Link>}`.
  - `ContactsTable` gets `view` and `canArchive={wholeAccount}` and passes them, with `timezone`, to `BulkActionBar`.

  `page.test.ts` (bare mock `:87`) assertions:
  - `?view=archived` calls both reads with `archived: "only"`, and the default calls them with `"exclude"` (mutation: pass `archived` to one read only → FAILS);
  - `buildOlderHref(…, "archived")` keeps `view=archived` (mutation: drop `withView` → FAILS);
  - the Archived empty state's copy;
  - no element with accessible name exactly "Contacts" in either view.

- [ ] **Step 6: Add contact.** `createContactAction` (`actions.ts:51-99`): when `result.existing`, read `getContact(db, accountId, result.id)`. If `archived_at` is set, return `{ kind: "existing", contactId, archived: true }`. Extend `CreateContactResult` (`:44-47`). `add-contact-dialog.tsx:114-120` shows `contacts.add.existingArchived` with the same link when `archived`. Test both branches (mutation: ignore `archived` → FAILS).

- [ ] **Step 7: Export.** `export/route.ts:128`: `archived: archivedFilterOf(parseView(url.searchParams.get("view")))`. Add one `route.get.test.ts` case (mutation: drop it → FAILS).

- [ ] **Step 8: Run green** and `pnpm --filter web typecheck`. Paste both.
- [ ] **Step 9: Commit** every path listed under Files: `feat(contacts): archive from the list, an Archived view with Restore, and a delete that says what it keeps`.

---

### Task 12: Agency dashboard, To do and search

**Tier:** low · **Owner:** bis-crm · **Wave:** 3

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/page.tsx:20` and `apps/web/src/app/(dashboard)/dashboard/page.test.ts` (chain `:33-37`)
- Modify: `ACCT/tasks/page.tsx:166-175` and `ACCT/tasks/page.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/work/page.tsx:157-165` and `apps/web/src/app/(dashboard)/dashboard/work/page.test.ts`
- Modify: `apps/web/src/app/api/accounts/[accountId]/search/route.test.ts`

**Run:** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/page.test.ts" "src/app/(dashboard)/dashboard/work" "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks" "src/app/api/accounts/[accountId]/search"`

- [ ] **Step 1: Failing tests.**
  - Dashboard: add `is` to the hand-built chain (it records into `contactFilters`) and assert `contactFilters` contains `["archived_at", null]` beside `["holds_shared_number", false]`. This tile is agency-wide by design, so the filter carries no account term; the test asserts that no `account_id` filter was added (mutation: drop `.is` → FAILS).
  - To do and work: a To-do on an archived contact names it as "Maria Garcia · Archived" (`contacts.archived.mark`), so it is still listed, never hidden (mutation: filter archived out → the row disappears, FAILS; mutation: drop the mark → FAILS).
  - Search route: `listContacts` is called WITHOUT an `archived` override, so the default (`exclude`) holds (mutation: pass `archived: "only"` → FAILS).
- [ ] **Step 2: Run red**, paste. **Step 3: Implement:** add `.is("archived_at", null)` at `page.tsx:20`. Add `archived_at` to both contacts selects and append `` ` · ${tr.text("contacts.archived.mark")}` `` (or the page's own translator; read which it uses) when `c.archived_at`. **Step 4: Run green**, paste. **Step 5: Commit** the eight paths: `feat(contacts): the agency total leaves archived contacts out; To do marks them Archived`.

---

### Task 11: Record header and drawer

**Tier:** medium · **Owner:** bis-frontend · **Wave:** 4

**Files:**
- Create: `ACCT/contacts/archive-controls.tsx`, `ACCT/contacts/archive-controls.test.ts`
- Modify: `ACCT/contacts/[contactId]/page.tsx` (`RecordHeader` `trailing` at `:382-386`; `extraNames` at `:128-129` gains `contact.archived_by`), `ACCT/contacts/[contactId]/page.test.ts` (bare mock `:104`: add `archiveContacts`, `restoreContacts`, `contactDeleteBlockers`)
- Modify: `ACCT/contacts/contact-drawer.tsx` (`trailing` at `:216-222`: controls before the open-full link), `ACCT/contacts/contact-drawer.wiring.test.ts`
- Modify: `ACCT/contacts/contacts-table.tsx:307` (passes `canArchive`, `canDelete`, `timezone` to `ContactDrawer`). **This file is T10's in wave 3; here in wave 4 it is T11's alone.**

**Interfaces:** consumes T10's three actions and `bulkDeleteContactsAction`, and T3's `record.*` and `contacts.delete.*` keys.

**Run:** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts"` and `pnpm --filter web typecheck`

- [ ] **Step 1: Failing tests** (`archive-controls.test.ts`, pure exported handlers in the `assignSelected` style, since apps/web has no DOM renderer per `contact-drawer.wiring.test.ts`'s header):
  - `archiveOne(...)` toasts `record.archivedToast` with Undo → `restoreContactsAction([id])`, plus the appointment line when `nextAppointment` is set;
  - `confirmTyped(typed, name, digits)`: an exact, trimmed, case-SENSITIVE match against `name`, or the last four digits when `name` is null (mutation: case-insensitive → FAILS);
  - `deleteOne` after a blocked answer shows `contacts.delete.archiveOnly` and never calls `bulkDeleteContactsAction` (mutation: call it anyway → FAILS);
  - a Technician (`canArchive` false) renders no Archive (string-match test on the component's JSX the way `contact-drawer.wiring.test.ts` checks wiring).
- [ ] **Step 2: Run red**, paste.
- [ ] **Step 3: Implement `ArchiveControls`.** Props: `{ accountId, contactId, name: string | null, phoneLast4: string | null, archived: { at: string; byLabel: string | null } | null, canArchive: boolean, canDelete: boolean, timezone: string, variant: "page" | "drawer", onGone?: () => void }`.
  - Ghost buttons only (rule 8: Call stays the header's one primary).
  - Not archived and `canArchive`: an `Archive` button. Archived: the banner (`record.archivedBanner` with `{date}` from `formatDateInZone` and `{name}` from `byLabel ?? t(m, "assign.someone")`, or `record.archivedBannerShort` in the drawer) and a `Restore` button.
  - `canDelete`: a `Delete…` (`record.delete`) button opening a `Dialog`. On open it reads `contactDeleteBlockersAction([contactId])`, showing a `Skeleton` while loading (rule 7).
    - Blocked: `contacts.delete.archiveOnly`, plus an "Archive" button when not archived.
    - Deletable: `contacts.delete.oneTitle`/`oneBody` (or `oneBodyNoName`), the typed input, and a destructive Delete enabled by `confirmTyped`. A success on the page `router.push`es to the list; in the drawer it calls `onGone`.
  - On the record page, Archive and Restore `router.refresh()`. In the drawer, Archive calls `onGone` (the row leaves the list).
- [ ] **Step 4: Wire it.** On the page: `trailing={<ArchiveControls … variant="page" />}`. `byLabel` comes from the page's ONE names read: add `contact.archived_by` to `extraNames` at `:128-129`, so no second read. `canArchive = seesWholeAccount(access)`, `canDelete = access.canManage`, and `phoneLast4` comes from `contact.phone`. In the drawer: put `trailing` as `<><ArchiveControls … variant="drawer" onGone={onClose} /><Link …/></>`. The `mr-8` stays on the link. `ContactDrawer` props gain `canArchive`, `canDelete` and `timezone`, passed from `contacts-table.tsx:307`. Update `contact-drawer.wiring.test.ts`'s regexes (`:474`, `:479`) only if the prop order makes them miss; keep what they assert.
- [ ] **Step 5: Run green + typecheck.** Paste.
- [ ] **Step 6: Mutation probes** as in Step 1, each red by name.
- [ ] **Step 7: Commit** the seven paths: `feat(contacts): Archive, Restore and delete-for-good on the record and the drawer`.

---

### Task 13: e2e

**Tier:** medium · **Owner:** bis-e2e-qa · **Wave:** 5

**Files:**
- Create: `apps/web/e2e/contacts-archive.spec.ts`
- Modify: `apps/web/e2e/contacts-drawer.spec.ts:719-739` (the BulkGate test only)

**Run:** only through the orchestrator's `pnpm --filter web test:e2e` slot, after checking that no `screenshots.yml` run is in progress (CLAUDE.md).

- [ ] **Step 1: `contacts-archive.spec.ts`.** Copy `fullFixture()`, `CLIENT_FIXTURE_FILE` and the `test.describe.configure({ timeout: 180_000 })` header from `contacts-drawer.spec.ts:59-93`. Create two contacts through the UI with a unique stamp ("Archive One {stamp}", "Archive Two {stamp}"), as `contacts-drawer.spec.ts:676-684` does. Then:
  1. Read the header total (`m["contacts.count"]` text).
  2. Tick "Archive One", then `bar.getByRole("button", { name: m["bulk.archive"] })`. Wait for the action's answer with a `waitForRequest` matching the contact id (the `bulkDeleteAnswered` pattern, `:119-129`).
  3. Expect toast `Archived 1 contact`, the row gone, and the total down by one.
  4. Click the toast's `m["common.undo"]` → the row back, the total back.
  5. Archive again. `page.getByRole("link", { name: m["contacts.archived.link"], exact: true })`, then expect the row in the Archived view and the header `1 archived`.
  6. Tick it, then `m["bulk.restore"]` → toast `Moved 1 contact back to your list`, and the Archived view is empty (`m["contacts.archived.emptyTitle"]`).
  7. `page.getByRole("link", { name: m["contacts.archived.back"] })` returns to the list.

  `afterAll` deletes both contacts with the service client, as the file's own cleanup does. Both are internal-only, so `delete_internal_contacts` allows it.
- [ ] **Step 2: `contacts-drawer.spec.ts` BulkGate test (`:719-739`).** The dialog is now `page.getByRole("dialog").filter({ hasText: /delete 1 contact/i })`. That title appears once the blockers load and is the deletable count, so it doubles as the wait. Fill `"1"` (not `"2"`). The toast text becomes `m["bulk.deletedSkipped"]` with `{count}` 1 and `{skipped}` 1, read from the catalogue and never hard-coded. Add one assertion: the toast's "Archive them" button (`m["bulk.archiveKept"]`) is visible. The Bulk One/Two test (`:688-717`) is unchanged: both contacts are internal-only, so the title stays "Delete 2 contacts?" and "2" still enables Delete. Confirm this on the run.
- [ ] **Step 3:** The orchestrator runs the suite. Paste the spec lines from the run (pass, or the first failure).
- [ ] **Step 4: Commit** the two paths: `test(e2e): archive, undo, the Archived view and restore on the fixture account; the delete dialog's new count`.

---

## Orchestrator checklist (not agent work)

1. Wave 1 merged on the branch → bis-db-schema hands over the replica proof (T1 Step 5 and Step 6 lines). Do not start wave 2 without both.
2. After wave 2 (and again after wave 4), push `feat/contacts-archive`. CI `verify` builds its own stack from the branch's migrations and runs the `*-live.test.ts` files. Read the check runs for the HEAD SHA. The `e2e` job's migration check will fail on 0103 (not on bis-ci yet); that failure is expected until step 4.
3. Confirm 0102 is applied to bis-ci (its lane's run of `ci-project-setup.yml`).
4. Apply 0103 to bis-ci with `ci-project-setup.yml`, in number order (`db:push:ci` refuses `--include-all`).
5. Apply 0103 to production, then run the parity check (`docs/runbooks/ci-supabase-project.md`).
6. Re-run CI on the HEAD SHA: `verify` and `e2e` both green, read per SHA (`gh api .../commits/<sha>/check-runs`).
7. Open the PR from `feat/contacts-archive` and enable auto-merge (squash).
8. After deploy: archive the four junk contacts on BIS's account by hand in the UI (47362cbc, d5250a70, c937e062, 114fb9ad), and confirm 227ec777 is untouched. This is owner or orchestrator work; no agent touches a live account.
9. Ledger: record the two spec corrections made while planning (the digest does not move; the blockers return one row per contact) and the deferred import summary line.

---

## Self-review (done while writing, 2026-10-28)

- **Spec coverage.** §3 → T1. §4.1 reads → T4 (list, count, search, pickers, export via T10), T6 (inbox), T12 (dashboards, To do). §4.2 signs → T8, T9; the import → T4 Step 5. §5 delete → T1, T4, T10, T11. §6 copy → T3. §7 → T2. §8 → T5. §9 tests → each task. §11 rulings → Q1 in T8/T9, Q2 in T5 and the T10 toast, Q3 in T1 and T10/T11. Gaps closed: the spec named `registry.ts` for Sofía's booking (not needed, T8 note); the spec named `proposals-drop.test.ts` (not needed, corrected).
- **Placeholders.** T1 Step 2's blocker cases and T4/T5/T6 live tests name the existing test file to copy each seed from rather than inventing column lists. That is deliberate: those inserts carry NOT NULL columns this plan did not read, and rule 1 says the source wins.
- **Type consistency.** `ArchiveActionResult`, `restoreContactOnSign(serviceDb, accountId, contactId, sign)`, `contactDeleteBlockers → Map<string, DeleteBlockReason[]>` and `deleteContacts`' `{ serviceDb, beforeDelete }` are used with the same names in T4, T8, T9, T10 and T11.
