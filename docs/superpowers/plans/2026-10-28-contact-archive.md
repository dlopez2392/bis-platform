# Contact archive and internal-only delete: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff archive any contact at once with Undo, restore it by hand or when the customer gets in touch again, and delete for good only a contact with nothing but internal work on it.

**Scope note (coordinator, 2026-10-28 fix round):** "Sofía never stores a placeholder name" (spec §7) is OUT of this plan. It ships as its own small PR on its own branch, run separately. Two items are deferred; see "Deferred" at the end.

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
public.delete_internal_contacts(p_account_id uuid, p_contact_ids uuid[]) returns uuid[]           -- authenticated (Owner of the account, or the agency) and service_role JWTs
conversations.contact_archived boolean (trigger-maintained), conversations.inbox_visible boolean (generated: not contact_archived or unread_count > 0)
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
  // blockers on opts.serviceDb; delete_internal_contacts on `db` (the request client), so 0103's Owner check decides
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

`looksAutomaticText(body: string): boolean` (T9, `apps/web/src/lib/contacts/automatic-text.ts`).

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
| `apps/web/src/lib/email/inbound/pipeline.test.ts:9` | bare (`db` object) | `resumeExisting` calls it | add `restoreContactOnSign: vi.fn(async () => false)` to `db` | T9 |
| `apps/web/src/lib/email/inbound/file.test.ts:4` | bare | guard only: `fileInboundEmail` must NEVER call it (review I6) | `restoreContactOnSign: vi.fn()`, asserted not called | T9 |
| `ACCT/conversations/inbound-actions.test.ts:63` | bare (`dbMock`) | guard only: the manual File must never restore (review I6) | `restoreContactOnSign: vi.fn()`, asserted not called | T9 |
| `apps/web/src/lib/voice/finish-call.test.ts:28` | partial (`...dbMocks`) | `finishCall` calls it | add `restoreContactOnSign: vi.fn()` to `dbMocks` | T8 |
| `ACCT/contacts/actions.test.ts:66` | bare | `deleteContacts` result shape and its `serviceDb` option | update the `deleteContacts` resolutions at `:157` | T4 (that line), T10 (new cases) |
| `ACCT/contacts/page.test.ts:87` | bare | page passes `archived` | none (no new symbol); assertions on `listContacts`/`countContacts` args gain `archived` | T10 |
| `ACCT/contacts/[contactId]/page.test.ts:104` | bare | page renders `ArchiveControls`, which imports `archive-actions.ts` → `archiveContacts`, `restoreContacts`, `contactDeleteBlockers` | `archiveContacts: vi.fn(), restoreContacts: vi.fn(), contactDeleteBlockers: vi.fn()` | T11 |
| `apps/web/src/app/(dashboard)/dashboard/work/page.test.ts:78` | bare | contacts select adds `archived_at` | fixture rows gain `archived_at` | T12 |
| `ACCT/tasks/page.test.ts:131` | partial | same | same | T12 |

Checked and NOT affected: `apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts:125` and `apps/web/src/lib/concierge/lead.test.ts` mock `@/lib/forms/enrich` whole. `apps/web/src/app/(dashboard)/dashboard/page.test.ts:27` (the agency total) is untouched now that its half of T12 is deferred. `apps/web/src/app/api/voice/incoming/lifecycle.test.ts:94` mocks `@/lib/voice/finish-call` whole.

### The second-account rule

Every account-scoped read that now filters on archive gets a test in which a SECOND account holds a matching row, so that a missing `account_id` term, or a filter that leaks across accounts, turns it red:

| Read | Second-account test lives in | Task |
|---|---|---|
| `listContacts`, `countContacts` (both `archived` values) | `packages/db/src/test/contact-archive-live.test.ts` | T4 |
| `archiveContacts` / `restoreContacts` (an id from account B changes nothing) | same | T4 |
| `restore_contact_on_sign`, `contact_delete_blockers`, `delete_internal_contacts` (account B's id passed under account A; an Owner of B calling for A) | `packages/db/src/test/contact-archive-schema.test.ts` | T1 |
| the six "new conversation" due-lists and their by-id reads | `packages/db/src/test/automations-archive-live.test.ts` | T5 |
| `listConversations`, `searchConversations` (and `sumUnreadCount`, deliberately unfiltered) | `packages/db/src/test/messaging-archive-live.test.ts` | T6 |
| the timeline's `archive` source | `packages/db/src/test/contact-archive-live.test.ts` (T7 adds a `describe`; T4 creates the file) | see T7, wave note |

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
| T3 | low | bis-crm | 1 | Every new and changed string, English and Spanish |
| T4 | high | bis-crm | 2 | Contact queries: archive filter, archive/restore, sign restore, blockers, the new delete |
| T5 | medium | bis-automations | 2 | Scheduled sends that start a conversation skip archived contacts |
| T6 | medium | bis-comms | 2 | Inbox and conversation search leave an archived contact's thread out while nothing in it is unread |
| T7 | medium | bis-crm | 3 | Archive rows on the timeline (record, household, drawer) |
| T8 | medium | bis-voice | 3 | A meaningful call restores an archived contact |
| T9 | medium | bis-crm | 3 | Texts (not auto-replies), emails (pipeline only), bookings, forms and chats restore an archived contact |
| T10 | medium | bis-crm | 3 | List: Archived view, bulk Archive/Restore, new delete dialog and toast |
| T12 | low | bis-crm | 3 | "Archived" mark in To do, search test |
| T11 | medium | bis-frontend | 4 | Record header and drawer: Archive, Restore, banner, typed-name delete |
| T13 | medium | bis-e2e-qa | 5 | `contacts-archive.spec.ts` and the two changed lines in `contacts-drawer.spec.ts` |

Task numbers are kept from the reviewed draft so review findings stay traceable; T2 left the plan. Waves: wave 2 starts once T1 is green on the replica. Wave 3 needs T4 merged (T7 needs T4's `contact-archive-live.test.ts` and `COLS`; T9 and T8 need `restoreContactOnSign`; T10 needs T3 and T4). Wave 4 needs T10's `archive-actions.ts`. Wave 5 runs after everything has landed. Two tasks in one wave never share a file. The file lists below are the complete set each task may touch.

---

### Task 1: Migration 0103 and its schema tests

**Tier:** high · **Owner:** bis-db-schema · **Wave:** 1

**Files:**
- Create: `packages/db/supabase/migrations/0103_contact_archive.sql`
- Create: `packages/db/src/test/contact-archive-schema.test.ts`
- Modify: `packages/db/src/test/schema-grants-guard.test.ts:86-89` (the `"authenticated contacts"` entry)
- Modify: `packages/db/src/test/definer-search-path.test.ts:27-50` (`EXPECTED_DEFINERS`), `:68` (`toHaveLength(23)`), `:77` (`toBeGreaterThanOrEqual(23)`)
- Modify: `packages/db/src/test/contacts-marketing-optout-schema.test.ts:69-72` and `packages/db/src/test/server-only-writes-grants.test.ts:130-133`. Both pin contacts' column grants exactly, so `grant update (archived_at)` turns them red (review I2). Each gains `"archived_at"` in sorted position: red on `pre`, green on `post`.
- Modify: `packages/db/src/account-teardown.ts:36` (review M9): `"contact_archive_log"` goes before `"contacts"`. It cascades with its contact, and it has no account FK of its own, so teardown works without it. It is listed anyway, as `record_summaries` is at `:33` ("cascades with its contact too"), so the list stays the whole account's tables.

**Interfaces:** Produces the SQL objects listed under "Shared facts". Consumes nothing.

**Run locally (replica only):**
`cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55434/post pnpm exec vitest run src/test/contact-archive-schema.test.ts src/test/schema-grants-guard.test.ts src/test/definer-search-path.test.ts src/test/proposals-drop.test.ts src/test/contacts-marketing-optout-schema.test.ts src/test/server-only-writes-grants.test.ts`

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

  it("authenticated holds no write privilege on the log (mutation: grant insert on contact_archive_log to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      // A privilege read, not an attempted insert (review I1): with RLS on and no insert policy, an insert is
      // refused 42501 whether or not the grant exists, so a refusal cannot tell the two apart.
      const { rows: [p] } = await c.query(
        `select has_table_privilege('authenticated', 'public.contact_archive_log', 'INSERT') as i,
                has_table_privilege('authenticated', 'public.contact_archive_log', 'UPDATE') as u,
                has_table_privilege('authenticated', 'public.contact_archive_log', 'DELETE') as d`);
      expect(p).toEqual({ i: false, u: false, d: false });
    }));

  it("a member reads only their own account's log rows (second account; mutation: policy `using (true)` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "logA");
      const b = await seedAccount(c, "logB");
      const idB = await contact(c, b.accountId);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [idB]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await c.query("select 1 from public.contact_archive_log where contact_id = $1", [idB])).rowCount).toBe(0);
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
      // The WHOLE log of both contacts, by id (review I1): a filter on author_kind would hide a person row that a
      // log trigger without its WHEN role test writes for this same restore.
      const { rows } = await c.query(
        "select contact_id, action, author_kind, sign from public.contact_archive_log where account_id = $1 order by id", [a.accountId]);
      expect(rows).toEqual([
        { contact_id: archived, action: "archived", author_kind: "person", sign: null },
        { contact_id: archived, action: "restored", author_kind: "customer", sign: "text" },
      ]);
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

  it("authenticated cannot execute the two service-role functions (mutation: grant execute on restore_contact_on_sign to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "exec");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      for (const sql of [
        "select public.restore_contact_on_sign($1, $2, 'text')",
        "select * from public.contact_delete_blockers($1, array[$2]::uuid[])",
      ]) expect((await refusal(c, sql, [a.accountId, id]))?.code, sql).toBe("42501");
    }));
});

describe("0103: delete_internal_contacts keeps the database's Owner check (review I9)", () => {
  it("a Staff member's call is refused 42501 and deletes nothing (mutation: drop the Owner check -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "staffdel");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "staff");
      expect((await refusal(c, "select public.delete_internal_contacts($1, array[$2]::uuid[])", [a.accountId, id]))?.code).toBe("42501");
      await actAsOwner(c);
      expect((await c.query("select 1 from public.contacts where id = $1", [id])).rowCount).toBe(1);
    }));

  it("an Owner of the account deletes; an Owner of ANOTHER account is refused (second account; mutation: drop `p_account_id = app.current_account_id()` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "ownA");
      const b = await seedAccount(c, "ownB");
      const idA = await contact(c, a.accountId);
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect((await refusal(c, "select public.delete_internal_contacts($1, array[$2]::uuid[])", [a.accountId, idA]))?.code).toBe("42501");
      await actAsMember(c, a.accountId, a.orgId, "owner");
      const { rows: [r] } = await c.query("select public.delete_internal_contacts($1, array[$2]::uuid[]) as d", [a.accountId, idA]);
      expect(r.d).toEqual([idA]);
    }));

  it("an Owner of an account whose client access is OFF is refused 42501 (re-review Critical; mutation: drop the outer coalesce AND the inner one around `p_account_id = app.current_account_id()` -> FAILS; either one alone refuses)", () =>
    withRollback(async (c) => {
      // current_account_id() is NULL here (0008:13-18) while is_account_owner is still true (0066:52-66): the
      // expression is NULL, and only the outer coalesce turns that into a refusal.
      const a = await seedAccount(c, "accessoff");
      const id = await contact(c, a.accountId);
      await actAsOwner(c);
      await c.query("update public.accounts set client_access_enabled = false where id = $1", [a.accountId]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      expect((await refusal(c, "select public.delete_internal_contacts($1, array[$2]::uuid[])", [a.accountId, id]))?.code).toBe("42501");
      await actAsOwner(c);
      expect((await c.query("select 1 from public.contacts where id = $1", [id])).rowCount).toBe(1);
    }));

  it("server code (a service_role JWT) may call it: the e2e cleanup and the live suites do (mutation: drop the service_role term -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "svcdel");
      const id = await contact(c, a.accountId);
      await actAsOwner(c);
      await c.query("set local role service_role");
      await c.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      const { rows: [r] } = await c.query("select public.delete_internal_contacts($1, array[$2]::uuid[]) as d", [a.accountId, id]);
      await c.query("reset role");
      expect(r.d).toEqual([id]);
    }));
});
```

Then the blocker cases. Write ONE `it` per reason, each seeding a contact that has ONLY that row. Every `it` name ends with its own mutation, for example `(mutation: delete the 'calls' exists -> FAILS)`. The seeds:

| reason | seed (as `actAsOwner`) |
|---|---|
| `messages` | `conversation` + `message(…, 'sms', 'outbound')` |
| `inbound_email` | `conversation` + one `public.inbound_emails` row on it. Copy the column list from the `recordInboundEmail` insert in `packages/db/src/inbound-email.ts:155-178` |
| `calls` | TWO cases (review M3). (a) One `public.calls` row with `contact_id`. (b) A call with `contact_id` NULL but `conversation_id` = this contact's conversation: `calls.conversation_id` exists (`0019_voice_core.sql:49`), and a shared-number move or a lost contact link leaves exactly this shape. Copy the minimal insert from `packages/db/src/test/voice.test.ts`. |
| `forms` | one `public.forms` row + one `public.form_submissions` row with `contact_id` (minimal inserts from `packages/db/src/test/forms.test.ts`) |
| `consent` | one `public.consent_events` row with `contact_id` (from `packages/db/src/test/consent*.test.ts`) |
| `automations` | one `public.automation_log` row with `contact_id` and `status 'sent'`, AND a second contact with only a `status 'skipped'` row, which must NOT be blocked |
| `bookings` | a calendar + one booking (from `packages/db/src/test/booking*.test.ts`) |
| `deals` | `select public.ensure…` is not needed: insert a pipeline, a stage and an opportunity (from `packages/db/src/test/opportunities.test.ts`) |

Each asserts `expect(await blockers(c, a.accountId, [id])).toEqual([{ contact_id: id, reasons: ["<reason>"] }])`.

Plus four more:

```ts
  it("notes, a To-do, a tag, a place, a note-channel message and an EMPTY conversation block nothing (mutation: treat channel 'note' as a blocker -> FAILS)", ...
  // seed: notes row, tasks row, tags + contact_tags, places row (0071 minimal), conversation + message(..., 'note', 'outbound').
  // A second contact with an EMPTY conversation (one conversation per contact, 0005:24-25). Both expect no blockers.

  it("a contact with three reasons is ONE row with all three, and 500 ids answer at most 500 rows (mutation: return one row per reason -> FAILS)", ...
  // seed messages + calls + deals on one contact; expect reasons sorted to equal ["calls","deals","messages"];
  // then 501 ids, through refusal() so the error is caught inside its savepoint and the transaction stays usable (review M7):
  //   await actAsOwner(c); await c.query("set local role service_role");
  //   expect((await refusal(c, "select * from public.contact_delete_blockers($1, $2::uuid[])", [a.accountId, ids501]))?.code).toBe("22023");
  //   await c.query("reset role");

  it("delete_internal_contacts deletes an internal-only contact with its notes, note messages and empty conversations, and returns its id (mutation: skip the note-message delete -> the conversation delete hits messages_conversation_id_fkey, the id is not returned, FAILS)", ...
  // These three run as the account's Owner (actAsMember(..., "owner")), the path the app takes.

  it("delete_internal_contacts keeps a contact that gained a call or a text after the blockers were read, and still deletes the rest of the batch (mutation: drop the in-lock re-check -> the call's contact is deleted, FAILS)", ...
  // T1: a late TEXT alone cannot prove the re-check: messages_conversation_id_fkey (NO ACTION) and the exception block
  // keep that contact anyway. A late CALL can: calls_contact_id_fkey is ON DELETE SET NULL. Seed both.
  // seed free1, free2; read blockers (empty); then insert an outbound sms on free2; call delete_internal_contacts(array[free1, free2]);
  // expect returned = [free1]; free2 still exists.

  it("a document left behind keeps that one contact and deletes the others (mutation: remove the per-contact exception block -> the whole call errors, FAILS)", ...
  // seed a documents row on doc1 (copy the minimal insert from packages/db/src/test/documents*.test.ts); call with [doc1, free];
  // expect returned = [free]; doc1 exists.

  it("another account's id passed under account A is neither reported nor deleted (second account; mutation: drop `k.account_id = p_account_id` in delete_internal_contacts -> FAILS)", ...
```

And the inbox column (review I8, T6's rule):

```ts
describe("0103: conversations.contact_archived and inbox_visible", () => {
  it("archiving and restoring a contact flips its conversations' contact_archived; inbox_visible stays true while unread > 0 (mutation: drop the sync trigger -> FAILS)", () =>
    withRollback(async (c) => {
      // One conversation per contact (0005_messaging.sql:24-25), so two contacts: one thread with nothing unread
      // (a junk caller's: only our text-back), one with an unread customer text.
      const a = await seedAccount(c, "inbox");
      const quietContact = await contact(c, a.accountId, "Quiet");
      const loudContact = await contact(c, a.accountId, "Loud");
      const quiet = await conversation(c, a.accountId, quietContact);
      const loud = await conversation(c, a.accountId, loudContact);
      await actAsOwner(c);
      await c.query("update public.conversations set unread_count = 2 where id = $1", [loud]);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = any($1::uuid[])", [[quietContact, loudContact]]);
      await actAsOwner(c);
      const read = async (id: string) => (await c.query("select contact_archived, inbox_visible from public.conversations where id = $1", [id])).rows[0];
      expect(await read(quiet)).toEqual({ contact_archived: true, inbox_visible: false });
      expect(await read(loud)).toEqual({ contact_archived: true, inbox_visible: true });
      await c.query("set local role service_role");
      await c.query("select public.restore_contact_on_sign($1, $2, 'text')", [a.accountId, quietContact]);
      await c.query("reset role");
      expect(await read(quiet)).toEqual({ contact_archived: false, inbox_visible: true });
    }));

  it("a conversation created for an archived contact starts archived (mutation: drop the BEFORE INSERT trigger -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "inbox2");
      const id = await contact(c, a.accountId);
      await actAsMember(c, a.accountId, a.orgId, "owner");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      const cv = await conversation(c, a.accountId, id);
      expect((await c.query("select contact_archived from public.conversations where id = $1", [cv])).rows[0]).toEqual({ contact_archived: true });
    }));

  it("a stale contact_archived heals on the conversation's next update (mutation: trigger only `of contact_id` -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seedAccount(c, "heal");
      const id = await contact(c, a.accountId);
      const cv = await conversation(c, a.accountId, id);
      await actAsOwner(c);
      // Simulate the race: the contact is archived, the conversation row still says false.
      await c.query("alter table public.conversations disable trigger conversations_contact_archived");
      await c.query("update public.contacts set archived_at = now() where id = $1", [id]);
      await c.query("update public.conversations set contact_archived = false where id = $1", [cv]);
      await c.query("alter table public.conversations enable trigger conversations_contact_archived");
      await c.query("update public.conversations set last_message_at = now() where id = $1", [cv]);
      expect((await c.query("select contact_archived from public.conversations where id = $1", [cv])).rows[0]).toEqual({ contact_archived: true });
    }));

  it("authenticated cannot write contact_archived (mutation: grant update (contact_archived) -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [p] } = await c.query(
        "select has_column_privilege('authenticated', 'public.conversations', 'contact_archived', 'UPDATE') as u");
      expect(p).toEqual({ u: false });
    }));
});
```

Write each of the abbreviated blocker and delete cases above in full, in the same style as the complete `it` blocks. Every seed copies a minimal insert from the named existing test file. Read that file for the columns; do not guess them.

- [ ] **Step 3: Run it red on `pre`.**
Run: `cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55434/pre pnpm exec vitest run src/test/contact-archive-schema.test.ts`
Expected: every test FAILS. The first failing line reads `column "archived_at" of relation "contacts" does not exist` or `function public.restore_contact_on_sign(...) does not exist`. Paste one.

- [ ] **Step 4: Write the migration.** Create `packages/db/supabase/migrations/0103_contact_archive.sql`. ASCII only, no backslash, every dollar sign part of a `$$` pair (the 0098 rule, `0098_shared_number_holding.sql:58`). The header follows 0098's sections (WHY / WHAT / GRANTS / SEARCH PATHS / LOCKS AND COST / LOAD-BEARING / ROLLBACK), stating:
  - GRANTS: one column grant, `update (archived_at)` to authenticated. `EXPECTED_WRITES` and the two contacts column-grant pins (`contacts-marketing-optout-schema.test.ts:69-72`, `server-only-writes-grants.test.ts:130-133`) gain it. The client-write digest does NOT change (`proposals-drop.test.ts:94-98` counts table privileges only). `delete_internal_contacts` is executable by authenticated and keeps its own Owner check. Six definers are added to `EXPECTED_DEFINERS` (23 -> 29, or 0102's count + 6).
  - LOCKS AND COST: the contacts columns are catalogue-only. Adding the STORED generated column `conversations.inbox_visible` REWRITES `conversations` and its indexes under ACCESS EXCLUSIVE. For the length of the rewrite every inbound text, email and call filing on every account waits, as do the inbox reads. The SMS route answers 503 if it times out, and Telnyx retries. The size is not measured against production here. An estimate: a rewrite of narrow rows runs at roughly tens of thousands of rows per second, so a table in the low thousands of rows takes well under a second. Step 5 MEASURES it on the replica with 50,000 synthetic conversations; put that number in the header. The orchestrator reads `select count(*), pg_size_pretty(pg_total_relation_size('public.conversations')) from public.conversations` on production at apply time. Above 100,000 rows, apply off-peak. `lock_timeout` 5s bounds only the wait to take the lock, not the rewrite.
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
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      -- T1: a signed-in client holds table-level INSERT, so an insert is never born archived.
      new.archived_at := null;
      new.archived_by := null;
    elsif (new.archived_at is null) = (old.archived_at is null) then
      -- T1 fix round: archived again (a stale tab): the first archive stands, nothing is logged.
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    else
      if old.holds_shared_number then
        raise exception 'A shared number holding record is never archived' using errcode = '42501';
      end if;
      if coalesce(app.is_technician(new.account_id), false) then
        raise exception 'A Technician cannot archive a customer' using errcode = '42501';
      end if;
      if new.archived_at is not null then
        new.archived_at := pg_catalog.now();
        -- Bare nullif (T1): NULLIF is a keyword; pg_catalog.nullif does not exist and failed at run time.
        new.archived_by := nullif(app.jwt() ->> 'sub', '');
      else
        new.archived_by := null;
      end if;
    end if;
  end if;
  return new;
end $$;
revoke all on function app.contacts_archive_stamp() from public, anon;
create trigger contacts_archive_stamp before insert or update of archived_at on public.contacts
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
          coalesce(new.archived_by, nullif(app.jwt() ->> 'sub', '')));
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
           where cv.account_id = p_account_id and cv.contact_id = k.id
             and m.account_id = p_account_id and m.channel <> 'note')
        union all select 'inbound_email' where exists (
          select 1 from public.conversations cv join public.inbound_emails ie
                 on ie.account_id = cv.account_id and ie.conversation_id = cv.id
           where cv.account_id = p_account_id and cv.contact_id = k.id)
        union all select 'calls' where exists (
          select 1 from public.calls x where x.account_id = p_account_id and x.contact_id = k.id)
          or exists (
          select 1 from public.conversations cv join public.calls x on x.conversation_id = cv.id
           where cv.account_id = p_account_id and cv.contact_id = k.id and x.account_id = p_account_id)
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

-- 8. Delete for good, internal-only contacts. The DATABASE keeps the Owner check (review I9): an Owner of THIS
--    account (app.is_account_owner, 0066:63, the agency included, with the 0066 policy's own account term), or
--    server code with a service_role JWT (PostgREST verifies the token before it sets request.jwt.claims, so a
--    client cannot claim the role; the e2e cleanup and the live suites call it so). Locks the contacts, then their conversations, in id order,
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
  -- The NULL path is load-bearing (re-review Critical, proven on PG18; corrected in T1: the coalesce on the account
  -- term and the outer one each refuse alone, so the probe drops both): app.current_account_id() is NULL when
  -- the account's client access is off or the token names no org (0008_client_access.sql:13-18), while
  -- is_account_owner keys on the token's sub alone (0066:52-66) and stays true. Without it the test is
  -- `not (false or false or (NULL and true))` = NULL, and IF NULL never raises: it would fail OPEN.
  if not coalesce(
       coalesce(app.jwt() ->> 'role', '') = 'service_role'
       or coalesce(app.is_agency(), false)
       or (coalesce(p_account_id = app.current_account_id(), false)
           and coalesce(app.is_account_owner(p_account_id), false)),
       false) then
    raise exception 'delete_internal_contacts: Owners only' using errcode = '42501';
  end if;
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
       where m.conversation_id = cv.id and cv.account_id = p_account_id and cv.contact_id = v_id
         and m.account_id = p_account_id and m.channel = 'note';
      delete from public.conversations cv where cv.account_id = p_account_id and cv.contact_id = v_id;
      delete from public.contacts k where k.account_id = p_account_id and k.id = v_id;
      v_deleted := v_deleted || v_id;
    exception when foreign_key_violation then
      null;  -- kept: a row still points at it (a file the purge did not clear). The caller reports it.
    end;
  end loop;
  return v_deleted;
end $$;
revoke all on function public.delete_internal_contacts(uuid, uuid[]) from public, anon;
grant execute on function public.delete_internal_contacts(uuid, uuid[]) to authenticated, service_role;

-- 9. The Archived view: keyed on its DEFAULT order (created_at desc, id desc; listContacts' default sort,
--    contacts.ts SORT_COLUMN), so its first page and its count read only archived rows (review M4). The other
--    sorts (name, company) use the existing sort indexes with this filter; measure with explain on the replica
--    before adding more.
create index contacts_account_archived_created on public.contacts (account_id, created_at desc, id desc)
  where archived_at is not null;

-- 10. The inbox rule (owner decision 2026-10-28, review I8): an archived contact's thread leaves the inbox only
--     while nothing in it is unread. contact_archived follows the contact; inbox_visible is the one column the
--     inbox and search filter on, so neither needs an OR across an embed.
alter table public.conversations
  add column contact_archived boolean not null default false,
  add column inbox_visible boolean generated always as (not contact_archived or unread_count > 0) stored;

create function app.conversations_follow_contact_archive() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  update public.conversations set contact_archived = (new.archived_at is not null)
   where account_id = new.account_id and contact_id = new.id;
  return null;
end $$;
revoke all on function app.conversations_follow_contact_archive() from public, anon, authenticated;
create trigger contacts_archive_to_conversations after update of archived_at on public.contacts
  for each row when (old.archived_at is distinct from new.archived_at)
  execute function app.conversations_follow_contact_archive();

create function app.conversation_contact_archived() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
  new.contact_archived := coalesce((select k.archived_at is not null from public.contacts k
                                     where k.account_id = new.account_id and k.id = new.contact_id), false);
  return new;
end $$;
revoke all on function app.conversation_contact_archived() from public, anon, authenticated;
-- On EVERY insert and update, not only `of contact_id` (re-review minor): an archive that commits while a
-- conversation row is being written can leave contact_archived stale, and re-deriving it on each touch (every
-- message bumps last_message_at, every read clears unread) heals it at the next write. One PK lookup per write.
create trigger conversations_contact_archived before insert or update on public.conversations
  for each row execute function app.conversation_contact_archived();

-- 11. (T1 fix round) Production is Postgres 17, with no skip scan: every single-column foreign key a contact or
--     conversation delete checks or clears gets an index leading on its own column; the blockers read them too.
create index calls_contact_id on public.calls (contact_id) where contact_id is not null;
create index calls_conversation_id on public.calls (conversation_id) where conversation_id is not null;
create index automation_log_contact_id on public.automation_log (contact_id) where contact_id is not null;
create index form_submissions_contact_id on public.form_submissions (contact_id) where contact_id is not null;
create index messages_conversation_id on public.messages (conversation_id);
create index conversations_contact_id on public.conversations (contact_id);
```

The committed `0103_contact_archive.sql` is the source of truth over this block; its header carries the
Postgres 17 timings and the index-build lock cost.

ROLLBACK in the header, in order: drop triggers `conversations_contact_archived` and `contacts_archive_to_conversations` and their two functions; drop the conversations columns `inbox_visible` then `contact_archived`; drop index `contacts_account_archived_created`; drop the three public functions; drop trigger `contacts_archive_log` and function `app.contacts_archive_log()`; drop trigger `contacts_archive_stamp` and function `app.contacts_archive_stamp()`; drop table `public.contact_archive_log`; `revoke update (archived_at) on public.contacts from authenticated`; drop constraint `contacts_archived_by_needs_at`; drop both columns.

- [ ] **Step 5: Apply to `post` and run green.** Before applying, also measure the rewrite (LOCKS AND COST): in a copy `create database rw template pre`, insert 50,000 conversations across seeded contacts, then time `psql -p 55434 -d rw -1 -f …0103_contact_archive.sql` (`\timing` or `Measure-Command`). Paste the duration into the migration header and your report.
Run: `psql -p 55434 -d post -1 -v ON_ERROR_STOP=1 -f supabase/migrations/0103_contact_archive.sql`, then the Step 3 command against `post`.
Expected: all pass. Paste vitest's summary line.

- [ ] **Step 6: Update the two guard tests.** In `schema-grants-guard.test.ts:86-89` add `"archived_at"` in sorted position (BEFORE `"assigned_to"`: "ar" sorts before "as"; corrected in T1). Add `"archived_at"` the same way to `contacts-marketing-optout-schema.test.ts:69-72` and `server-only-writes-grants.test.ts:130-133`. In `account-teardown.ts:36` put `"contact_archive_log"` before `"contacts"`. In `definer-search-path.test.ts` add these six entries in sorted position, then change `:68` to `toHaveLength(29)` and `:77` to `toBeGreaterThanOrEqual(29)`. If 0102 is in your `pre`, use its count + 6, read off the file:

```ts
  "app.contacts_archive_log()": PG_CATALOG_PG_TEMP,
  "app.conversation_contact_archived()": PG_CATALOG_PG_TEMP,
  "app.conversations_follow_contact_archive()": PG_CATALOG_PG_TEMP,
  "public.contact_delete_blockers(uuid,uuid[])": PG_CATALOG_PG_TEMP,
  "public.delete_internal_contacts(uuid,uuid[])": PG_CATALOG_PG_TEMP,
  "public.restore_contact_on_sign(uuid,uuid,text)": PG_CATALOG_PG_TEMP,
```

Run all four files on `post` (green) and the two guard files on `pre` (red: `expected 23 to be 27` and the `archived_at` diff). Paste each red line: the definer count, and the three `archived_at` column-list diffs (`schema-grants-guard`, `contacts-marketing-optout-schema`, `server-only-writes-grants`). `proposals-drop.test.ts` must be GREEN on both `pre` and `post` with `52|b66203ca5d355155540b520af510d120`.

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
| `grant insert on public.contact_archive_log to authenticated` | "authenticated holds no write privilege on the log" (the privilege read; an insert attempt could not fail, review I1) |
| delete fn: delete the Owner `if not (…)` block | "a Staff member's call is refused" |
| delete fn: drop `p_account_id = app.current_account_id() and` | "an Owner of ANOTHER account is refused" |
| delete fn: drop BOTH the outer `coalesce(…, false)` and the inner one around `p_account_id = app.current_account_id()` (T1: either one alone refuses, so dropping only the outer one cannot fail) | "an Owner of an account whose client access is OFF is refused" (the NULL path; re-review Critical) |
| delete fn: drop `p_account_id = app.current_account_id()` | "an Owner of ANOTHER account is refused, and so is an Owner of both signed in to the other" (T1 added the Owner of both: is_account_owner(A) already refuses an Owner of B alone) and the client-access-OFF case |
| delete fn: the cap at 501, or drop `p_contact_ids is null or` | "refuses 501 ids with 22023" / "refuses no array at all with 22023" (T1 fix round) |
| stamp: refuse a Technician only when archiving | "a Technician's restore is refused 42501 too" (T1 fix round) |
| stamp: drop the keep-the-first-archive branch | "archiving an already-archived contact again keeps the first archive" (T1 fix round) |
| log policy in the house shape `using (app.is_agency() or account_id = app.current_account_id())` | "a Technician reads the log rows of the customers assigned to them and no others" (T1 fix round) |
| drop `calls_conversation_id` (or any section 11 index) | "every single-column foreign key into contacts or conversations has a valid index" (T1 fix round) |
| delete fn: drop the `service_role` term | "server code (a service_role JWT) may call it" |
| blockers: drop the second calls `exists` (by the contact's conversation) | the calls case (b) |
| drop trigger `contacts_archive_to_conversations` | "archiving and restoring a contact flips its conversations' contact_archived" |
| drop trigger `conversations_contact_archived` | "a conversation created for an archived contact starts archived" |
| blockers: delete each `exists` in turn | that reason's own `it` |
| blockers: `m.channel <> 'note'` → `true` | "notes, a To-do, … block nothing" |
| delete fn: delete the `not exists (… contact_delete_blockers …)` line | "keeps a contact that gained a call or a text" (red by the call) |
| delete fn: remove `exception when foreign_key_violation` | "a document left behind keeps that one contact" |

- [ ] **Step 8: Commit.**

```bash
P="packages/db/supabase/migrations/0103_contact_archive.sql packages/db/src/test/contact-archive-schema.test.ts packages/db/src/test/schema-grants-guard.test.ts packages/db/src/test/definer-search-path.test.ts packages/db/src/test/contacts-marketing-optout-schema.test.ts packages/db/src/test/server-only-writes-grants.test.ts packages/db/src/account-teardown.ts"
git add $P
git commit -m "feat(db): 0103 contact archive: archived_at, archive log, inbox visibility, sign restore and an Owner-checked internal-only delete" -- $P
```

---

### Task 3: Copy, English and Spanish

**Tier:** low · **Owner:** bis-crm · **Wave:** 1

**Files:**
- Modify: `apps/web/src/lib/messages.ts` (`bulk.*` block at `:662-699`; add the `contacts.archive*` and `record.*` keys beside their namespaces; add the `timeline.*` keys beside `timeline.note` at `:5345`)
- Modify: `apps/web/src/lib/messages.test.ts`
- Modify: `ACCT/contacts/bulk-action-bar.test.ts:364-370`. That ONE test pins the old `bulk.deletedSkipped` text in both languages (review I5). Its two literals become the new strings, read from `m` (`m["bulk.deletedSkipped"].replace(...)`), so the branch is not red from wave 1 to wave 3. T10 owns the rest of the file in wave 3.

**Interfaces:** Produces these keys, which T7, T10, T11 and T12 consume by name. Every key has its `.es` twin on the next line.

| Key | English | Spanish |
|---|---|---|
| `bulk.archive` | Archive | Archivar |
| `bulk.archived` | Archived {count} contacts | Se archivaron {count} contactos |
| `bulk.archivedOne` | Archived 1 contact | Se archivó 1 contacto |
| `bulk.restore` | Restore | Restaurar |
| `bulk.restored` | Moved {count} contacts back to your list | Se devolvieron {count} contactos a su lista |
| `bulk.restoredOne` | Moved 1 contact back to your list | Se devolvió 1 contacto a su lista |
| `bulk.deletedSkipped` (REPLACES `:696`/`:699`) | Deleted {count} · kept {skipped} that have a history with you. You can archive those instead. | Contactos borrados: {count} · conservados porque tienen un historial con usted: {skipped}. Puede archivarlos. |
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
| `contacts.delete.archiveOnly` | {name} can't be deleted because they have a history with you, and we keep it. Archive them instead: they leave your list and nothing is lost. | No se puede borrar a {name} porque tiene un historial con usted, y lo conservamos. Mejor archive este contacto: sale de su lista y no se pierde nada. |
| `contacts.delete.someKept` | {kept} of these have a history with you and will be kept. | {kept} de estos tienen un historial con usted y se conservarán. |
| `contacts.delete.noneDeletable` | None of these can be deleted: they all have a history with you. Archive them instead. | Ninguno se puede borrar porque todos tienen un historial con usted. Mejor archívelos. |
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

- [ ] **Step 1: Failing test.** Add a `describe("contact archive copy (spec §6)")` to `messages.test.ts` in the shape of the existing per-feature blocks (`:575-600`). It needs a `WANT` record holding every row above, plus the three tests those blocks carry: exact text, `.es` on the next line, usted and placeholder survival. Also assert `m["bulk.deletedSkipped"]` no longer contains "linked to", and that none of the delete keys lists reasons: no "calls, texts" (review M8; a reason list reads as a form and goes stale when §5.1 grows).
- [ ] **Step 2: Run red:** `pnpm --filter web exec vitest run src/lib/messages.test.ts src/lib/i18n "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/bulk-action-bar.test.ts"`. Expected: `bulk.archive: expected undefined to be 'Archive'`. Paste it.
- [ ] **Step 3: Add the keys** to `messages.ts`, each English key followed by its `.es` line.
- [ ] **Step 4: Run green**, including `src/lib/i18n`: the accents guard, the ratchet and catalogue parity must pass with NO baseline change, because every key has its twin. Paste the summary line.
- [ ] **Step 5: Mutation:** swap one `.es` line out of position → "the .es twin on the very next line" fails. Write "Vuelve" into `contacts.archive.failed.es` → the usted test fails.
- [ ] **Step 6: Commit:** `git commit -m "feat(contacts): archive and delete copy, English and Spanish" -- apps/web/src/lib/messages.ts apps/web/src/lib/messages.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/bulk-action-bar.test.ts"`

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
- Modify: `apps/web/e2e/shared-number.spec.ts:136` (review I3): `deleteContacts(svc, accountId, ids, { serviceDb: svc })`. The web tsconfig includes `e2e/`, so the old `conversationsDb` key fails typecheck. `svc` carries a service_role JWT, which 0103's Owner check admits. That spec's cleanup deletes its contacts' messages and conversations first and creates no call, consent, booking or deal row (checked 2026-10-28), so no new blocker stops it.

**Interfaces:** Produces the TypeScript block under "Shared facts". Consumes T1's SQL.

**Run locally:** `cd packages/db && pnpm exec vitest run src/contacts-archive.test.ts src/contacts-phone.test.ts` (no env, so the sweep skips), `pnpm --filter @bis/db exec tsc --noEmit -p .` and `pnpm --filter web typecheck` (it covers `e2e/`). `src/test/contact-archive-live.test.ts` and `src/test/contacts.test.ts` run in CI verify only.

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
  const rpcAnswers: Record<string, unknown> = { ...rpc };
  const db = {
    from: (table: string) => chainFor(table),
    rpc: async (fn: string, args: unknown) => { rpcs.push({ fn, args }); return { data: rpcAnswers[fn] ?? null, error: null }; },
  } as unknown as SupabaseClient;
  return { db, calls, rpcs, rpcAnswers };
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
  it("450 ids go in three .in() batches of at most 200 (review M1; mutation: one .in() of 450 -> FAILS)", async () => {
    const { db, calls } = recordingDb({ contacts: [] });
    await archiveContacts(db, "A", Array.from({ length: 450 }, (_, i) => `c${i}`));
    const ins = calls.filter((c) => c.method === "in").map((c) => (c.args[1] as string[]).length);
    expect(ins).toEqual([200, 200, 50]);
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
    });
    request.rpcAnswers.delete_internal_contacts = ["free"];
    const seen: string[][] = [];
    const r = await deleteContacts(request.db, "A", ["free", "kept", "stranger"], {
      serviceDb: service.db, beforeDelete: async (ids) => { seen.push(ids); return []; },
    });
    expect(service.rpcs).toEqual([{ fn: "contact_delete_blockers", args: { p_account_id: "A", p_contact_ids: ["free", "kept"] } }]);
    expect(seen).toEqual([["free"]]);
    // On the REQUEST client, so the database's own Owner check runs (review I9; mutation: call it on serviceDb -> FAILS).
    expect(request.rpcs).toEqual([{ fn: "delete_internal_contacts", args: { p_account_id: "A", p_contact_ids: ["free"] } }]);
    expect(r).toEqual({ deleted: 1, skippedBlocked: 1, skippedFiles: 0, skippedIds: ["kept"], lateKept: 0 });
  });
  it("an id the database kept after the purge is reported as lateKept and skipped (mutation: count every id sent as deleted -> FAILS)", async () => {
    const request = recordingDb({ contacts: [{ id: "a" }, { id: "b" }] }, { delete_internal_contacts: ["a"] });
    const service = recordingDb({}, { contact_delete_blockers: [] });
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
/** At most this many ids in one `.in()` (review M1): TAG_LOOKUP_BATCH_SIZE's measured limit (`:1088-1097`), the
 *  size assignment.ts's ASSIGN_IN_BATCH_SIZE (`:92-99`) settled on too. RPC arguments travel in the body and are
 *  not split. */
function inBatches<T>(ids: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += TAG_LOOKUP_BATCH_SIZE) out.push(ids.slice(i, i + TAG_LOOKUP_BATCH_SIZE));
  return out;
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
  const changedIds: string[] = [];
  for (const batch of inBatches(contactIds)) {
    const { data, error } = await db.from("contacts").update({ archived_at: new Date().toISOString() })
      .eq("account_id", accountId).in("id", batch)
      .eq("holds_shared_number", false).is("archived_at", null)
      .select("id");
    if (error) throw new Error(`archiveContacts failed: ${error.message}`);
    changedIds.push(...(data ?? []).map((r) => r.id as string));
  }
  return { changedIds };
}

/** Restore by hand (the Archived view, the record's banner, an Archive's Undo). */
export async function restoreContacts(
  db: SupabaseClient, accountId: string, contactIds: string[],
): Promise<{ changedIds: string[] }> {
  capBatch(contactIds, "restoreContacts");
  const changedIds: string[] = [];
  for (const batch of inBatches(contactIds)) {
    const { data, error } = await db.from("contacts").update({ archived_at: null })
      .eq("account_id", accountId).in("id", batch).not("archived_at", "is", null)
      .select("id");
    if (error) throw new Error(`restoreContacts failed: ${error.message}`);
    changedIds.push(...(data ?? []).map((r) => r.id as string));
  }
  return { changedIds };
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
    /** The SERVICE client, for the blockers read only (0103 step 7, service_role only). The delete itself runs on
     *  `db`, the request client, so 0103's Owner check in delete_internal_contacts decides (review I9). */
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
  const ourSet = new Set<string>();
  for (const batch of inBatches([...new Set(contactIds)])) {
    const { data: mine, error: mineError } = await db.from("contacts").select("id")
      .eq("account_id", accountId).in("id", batch);
    if (mineError) throw new Error(`deleteContacts contacts pre-read failed: ${mineError.message}`);
    for (const r of mine ?? []) ourSet.add(r.id as string);
  }
  const ours = [...new Set(contactIds)].filter((id) => ourSet.has(id));
  if (ours.length === 0) return none;
  const blockers = await contactDeleteBlockers(opts.serviceDb, accountId, ours);
  const blocked = ours.filter((id) => blockers.has(id));
  const deletable = ours.filter((id) => !blockers.has(id));
  const kept = new Set(deletable.length > 0 && opts.beforeDelete ? await opts.beforeDelete(deletable) : []);
  const go = deletable.filter((id) => !kept.has(id));
  if (go.length === 0) return { ...none, skippedBlocked: blocked.length, skippedFiles: kept.size, skippedIds: blocked };
  const { data, error } = await db.rpc("delete_internal_contacts", { p_account_id: accountId, p_contact_ids: go });
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

- [ ] **Step 7: Mutation probes** (pure file, local): (a) delete `q = withArchived(q, opts.archived);` in `countContacts` → "countContacts does too" fails. (b) In `archiveContacts` delete `.is("archived_at", null)` → its test fails. (c) In `deleteContacts` pass `ours` (not `go`) to `delete_internal_contacts` → the first deleteContacts test fails. (d) Return `deleted: go.length` → "lateKept" fails. (e) Call `delete_internal_contacts` on `opts.serviceDb` → the first deleteContacts test fails (review I9). (f) Replace the `inBatches` loop in `archiveContacts` with one `.in("id", contactIds)` → "450 ids go in three batches" fails (review M1). Each must be seen red by name.

- [ ] **Step 8: Commit** the eight paths with `git commit -m "feat(contacts): archive filter, archive and restore, sign restore and internal-only delete in the contact queries" -- …`.

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

### Task 6: Inbox and conversation search

**Tier:** medium · **Owner:** bis-comms · **Wave:** 2

**Rule (owner decision, 2026-10-28, review I8):** an archived contact's thread leaves the inbox and search
ONLY while it holds nothing unread. A thread with unread messages from the customer stays visible until
someone reads it, so a customer's words are never hidden. A junk caller's thread holds only our outbound
text-back (unread 0), so it disappears. T1 adds `conversations.inbox_visible`, a stored generated column:
`not contact_archived or unread_count > 0`. `contact_archived` follows the contact by trigger.

**Files:**
- Modify: `packages/db/src/messaging.ts` (`listConversations` query `:658-685`; `searchConversations` messages read `:920-925`)
- Create: `packages/db/src/messaging-archive.test.ts` (pure, local)
- Create: `packages/db/src/test/messaging-archive-live.test.ts` (CI only)

**Unchanged on purpose:**
- `sumUnreadCount` (`:629-636`). Every thread with unread messages is visible by the rule above, so the badge already counts exactly the visible unread. Filtering it would hide the very messages the rule keeps.
- `getConversationSummary` (`:777-800`). A deep link still opens an archived contact's thread, as the record page does.

**Run locally:** `cd packages/db && pnpm exec vitest run src/messaging-archive.test.ts`

- [ ] **Step 1: Pure failing test** (`recordingDb` copied from T4 Step 1):

```ts
describe("an archived contact's thread leaves the inbox and search while nothing in it is unread (review I8)", () => {
  it("listConversations keeps only inbox_visible threads, with or without Mine (mutation: drop the filter -> FAILS)", async () => {
    for (const opts of [{}, { assignee: { who: "mine" as const, userId: "u1" } }]) {
      const { db, calls } = recordingDb();
      await listConversations(db, "A", opts);
      expect(has(calls, "eq", "inbox_visible", true)).toBe(true);
    }
  });
  it("searchConversations filters BEFORE its five-thread cap: the messages read itself joins visible threads (M2; mutation: filter only the second read -> FAILS)", async () => {
    const { db, calls } = recordingDb({ messages: [] });
    await searchConversations(db, "A", { search: "roof" });
    const msgSelect = calls.find((c) => c.table === "messages" && c.method === "select");
    expect(String(msgSelect?.args[0])).toContain("conversations!inner(inbox_visible)");
    expect(calls.some((c) => c.table === "messages" && c.method === "eq"
      && JSON.stringify(c.args) === JSON.stringify(["conversations.inbox_visible", true]))).toBe(true);
  });
  it("sumUnreadCount is NOT filtered: an archived contact's unread customer text still counts (mutation: add an archive filter -> FAILS)", async () => {
    const { db, calls } = recordingDb();
    await sumUnreadCount(db, "A");
    expect(calls.some((c) => JSON.stringify(c.args).includes("archived") || JSON.stringify(c.args).includes("inbox_visible"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run red.** Paste the first failing line.
- [ ] **Step 3: Implement.**
  - `listConversations`: add `.eq("inbox_visible", true)` after `.eq("messages.account_id", accountId)`. The embeds stay as they are, because the column is the conversation's own. Add a comment naming review I8's rule. Do NOT use a second `.or()`: the cursor clause at `:688-700` is already this query's one `or`.
  - `searchConversations`: the messages read selects `"conversation_id, body, created_at, conversations!inner(inbox_visible)"` and adds `.eq("conversations.inbox_visible", true)` before `.order(...)`. The 200-row read and the five-thread cap then only ever see visible threads. The second read (`:937-940`) is unchanged.
- [ ] **Step 4: Run green.** Paste.
- [ ] **Step 5: Live tests (CI)**, two accounts:
  - A's archived contact with only an outbound text (unread 0) is not listed and not found by search.
  - A's archived contact with an unread inbound text IS listed, IS found, and its unread counts in A's badge. After `clearUnreadCount` it leaves the list.
  - B's matching threads never appear in A's inbox, search or badge.
  - A Technician's inbox for their own active customer is unchanged.
  - Mutations: drop each `.eq` in turn → its case FAILS.
- [ ] **Step 6: Mutation probes** (pure) as named in Step 1, each red by name.
- [ ] **Step 7: Commit** the three paths: `fix(sms): an archived contact's thread leaves the inbox and search once nothing in it is unread`.

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
- Create: `apps/web/src/lib/contacts/automatic-text.ts`, `apps/web/src/lib/contacts/automatic-text.test.ts`
- Modify: `apps/web/src/app/api/sms/inbound/route.ts` (inside the filing `try`, between `ensureConversation` `:219` and `if (firstFiling) { await createMessage(…) }` `:220-229`)
- Modify: `apps/web/src/app/api/sms/inbound/route.test.ts` (mock `:35`), `apps/web/src/app/api/sms/inbound/route.consent.test.ts` (mock `:22`)
- Modify: `apps/web/src/app/b/[publicId]/actions.ts` (after the language-signal block `:374-382`), `apps/web/src/app/b/[publicId]/actions.test.ts` (mock `:105`)
- Modify: `apps/web/src/lib/forms/enrich.ts` (after the language-signal try `:121-131`), `apps/web/src/lib/forms/enrich.test.ts` (mock `:12`), `apps/web/src/app/f/[publicId]/actions.test.ts` (mock `:64`, stub only)
- Modify: `apps/web/src/lib/email/inbound/pipeline.ts` (in `resumeExisting`, after `fileInboundEmail`, `:64-67`), `apps/web/src/lib/email/inbound/pipeline.test.ts` (mock `:9`)
- Modify (guards only, no production change): `apps/web/src/lib/email/inbound/file.test.ts` (mock `:4`), `ACCT/conversations/inbound-actions.test.ts` (mock `:63`)

**Why the email restore is in the pipeline, not `file.ts` (review I6):** `fileInboundEmail` is also called by `fileHeldEmailAction` (`ACCT/conversations/inbound-actions.ts:149`), where a teammate files a held email by hand. A restore there would log a staff act as the customer's ("came back"), breaking spec §4.2 and the provenance rule. Only the pipeline's own customer filing restores.

**Interfaces:** consumes `restoreContactOnSign` (T4). Produces `looksAutomaticText(body: string): boolean`.

**Run:** `pnpm --filter web exec vitest run src/lib/contacts/automatic-text.test.ts src/app/api/sms/inbound "src/app/b/[publicId]/actions.test.ts" src/lib/forms "src/app/f/[publicId]/actions.test.ts" src/lib/email/inbound "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/inbound-actions.test.ts" src/app/api/concierge src/lib/concierge`

The concierge files run to prove they need no change: their tests mock `enrich` whole.

- [ ] **Step 1: `looksAutomaticText`, red then green (review I7, owner decision).** A CLOSED list of whole phrases, English and Spanish, matched on a lower-cased, accent-stripped, whitespace-collapsed copy of the body:

```ts
// apps/web/src/lib/contacts/automatic-text.ts
/** A phone's own auto-reply is not the customer getting in touch (contact archive, review I7): a robocaller's number
 *  that answers our text-back with "I'm driving" must not bring the junk record back. A CLOSED list: a phrase is
 *  added only with a real example. A real reply that happens to contain a listed phrase is still a match, by design:
 *  a missed restore costs one click, while a junk record back on the list costs the owner's trust. */
const PHRASES = [
  "i'm driving", "im driving", "i am driving", "driving right now", "do not disturb while driving",
  "this number cannot receive", "this number can't receive", "this number does not accept", "cannot receive text messages",
  "auto reply", "autoreply", "automatic reply", "this is an automated message", "out of office",
  "estoy manejando", "estoy conduciendo", "respuesta automatica", "mensaje automatico", "no puede recibir mensajes",
  "este numero no recibe", "fuera de la oficina",
] as const;
/** Lower case, accents off, curly quotes straight, and every run of characters that is not a letter, digit or
 *  apostrophe turned into ONE space ("auto-reply" -> "auto reply"), padded, so a phrase matches only on WORD
 *  boundaries (re-review minor): "Send him driving directions" must not match "im driving". */
const norm = (s: string) => ` ${s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[’`]/g, "'")
  .replace(/[^a-z0-9']+/g, " ").trim()} `;
const NORMED = [...new Set(PHRASES.map(norm))];
export function looksAutomaticText(body: string): boolean {
  const b = norm(body);
  return NORMED.some((p) => b.includes(p));
}
```

  Tests both ways:
  - `it.each` over one real example per phrase → true (mutation: drop a phrase → its case FAILS).
  - `it.each(["Yes please send the quote", "Test", "Can you come Tuesday?", "Gracias, ¿pueden venir el martes?", "Stop by anytime", "Send him driving directions", "Tim driving over now", "autoreplying is broken"])` → false. Mutations: match a single word like "driving" or "auto" → FAILS. Drop the word-boundary padding (plain `includes` on the raw text) → "Send him driving directions" FAILS (re-review minor).
  - Positive punctuation cases: "I'm driving." and "Auto-Reply: back Monday" → true (mutation: stop normalising punctuation → FAILS).

- [ ] **Step 2: Failing tests, one per site:**
  - **SMS** (`route.test.ts`). A plain inbound text on a non-shared number calls `restoreContactOnSign(db, accountId, contactId, "text")`. It is called BEFORE `createMessage`; assert with `mock.invocationCallOrder` against `createMessage` (re-review Important; mutation: move it after `createMessage` → FAILS). It runs on a RETRY delivery too, the one where `firstFiling` is false (mutation: put it inside `if (firstFiling)` → FAILS). It is not called for STOP, START, HELP, a Telnyx autoresponse or a stop phrase (`consent.kind !== "none"`), for "I'm driving, will reply later" (`looksAutomaticText`), or on a shared number. Mutations: drop each condition → its case FAILS. A failing restore is a `FilingFailed` (503) on the first filing, so Telnyx retries; assert the 503.
  - **Booking page** (`actions.test.ts`): a successful booking restores with `"booking"`. A slot-taken booking restores nobody (mutation: restore before `createBooking` → FAILS).
  - **Forms** (`enrich.test.ts`): a form submission restores with `"form"`, and a web chat lead (`webchat: { chatId }`) with `"chat"` (mutation: always `"form"` → FAILS). A failing restore still records the conversation and the alert.
  - **Email** (`pipeline.test.ts`):
    - a customer filing with `result.created` and `consent.kind === "none"` restores with `"email"`;
    - a teammate's forward, a duplicate (`created: false`) and a clear stop (`consent.kind === "stopped"`) restore nobody;
    - mutations: drop each term → FAILS.
    - Automatic mail never reaches filing: `classifyAutomatic` drops it at `pipeline.ts:200-211`, before `resumeExisting`. Add one case that an `auto-submitted: auto-replied` email restores nobody.
  - **Manual File never restores (review I6):**
    - In `inbound-actions.test.ts`, add `restoreContactOnSign: vi.fn()` to `dbMock` and assert it is never called by `fileHeldEmailAction`.
    - In `file.test.ts`, add it to the bare mock and assert `fileInboundEmail` never calls it.
    - Mutation: call it from `file.ts` → the `file.test.ts` case FAILS.
  - **f/actions.test.ts**: add the stub only, and assert nothing new. The file must stay green.
- [ ] **Step 3: Run red.** Paste one line per site.
- [ ] **Step 4: Implement.**
  - **SMS**, INSIDE the filing `try`, right after `conversation = await ensureConversation(…)` and BEFORE `if (firstFiling) { await createMessage(…) }`. Two reasons:
    - Placed after the unread bump (`:240`, outside the try), a failing bump would leave the route answering 200, and Telnyx would never retry.
    - Placed after `createMessage` (re-review Important), a failed restore would answer 503, but the retry sees `firstFiling` false (the message is filed), and the unread bump inside `if (firstFiling)` never runs. The text would sit unread-less on a thread that may be hidden.

    Before `createMessage`, a failed restore files nothing: a 503, and the retry files the whole thing. It is idempotent (an active contact answers false), so it also runs harmlessly on retries.

```ts
    // Contact archive, owner ruling Q1 and review I7/I8: the customer's own text brings an archived contact back —
    // not a STOP/START/HELP or stop phrase (consent.kind), not a phone's auto-reply, not a shared number's holding
    // record. Runs on every delivery (idempotent), inside the filing try, so a failure is retried, never lost.
    if (!shared && consent.kind === "none" && !looksAutomaticText(text)) {
      await restoreContactOnSign(db, accountId, contact.id, "text");
    }
```

  - **Booking page**, after the `pageSign` block: `try { await restoreContactOnSign(db, calendar.account_id, contactId, "booking"); } catch (e) { console.error(`booking ${publicId}: restore failed for contact ${contactId}: ${String(e)}`); }`
  - **enrich**, after the language-signal try: `try { await restoreContactOnSign(db, accountId, contactId, webchat ? "chat" : "form"); } catch (e) { console.error(`form ${form.id} submission ${submissionId}: restore failed for contact ${contactId}: ${e instanceof Error ? e.message : String(e)}`); }`
  - **pipeline.ts** `resumeExisting`, after `fileInboundEmail`. `deps.db` is the service client. Add `restoreContactOnSign` to the `@bis/db` import:

```ts
    // Contact archive, owner ruling Q1: the customer's own email brings an archived contact back. Never a forward,
    // never a stop (result.consent), never a duplicate, and never fileHeldEmailAction's manual File (review I6), which
    // does not pass through here. Automatic mail was dropped above (classifyAutomatic). A failure is logged: the email
    // is filed, and its unread keeps the thread in the inbox (T6's rule).
    if (result.created && !isForward && result.consent.kind === "none") {
      try {
        await restoreContactOnSign(deps.db, row.accountId, contactId, "email");
      } catch {
        deps.log(`inbound email: could not restore an archived contact on account ${row.accountId}; the email is filed`);
      }
    }
```

- [ ] **Step 5: Run green.** Paste.
- [ ] **Step 6: Mutation probes** as named in Steps 1 and 2. Each must fail by name.
- [ ] **Step 7: Commit** the fifteen paths: `feat(contacts): a text, email, booking, form or chat from the customer brings an archived contact back; phone auto-replies and manual filing never do`.

---

### Task 10: List, bulk bar, actions and the new delete dialog

**Tier:** medium · **Owner:** bis-crm · **Wave:** 3

**Files:**
- Create: `apps/web/src/lib/contacts/view.ts`, `apps/web/src/lib/contacts/view.test.ts`
- Create: `ACCT/contacts/archive-actions.ts`, `ACCT/contacts/archive-actions.test.ts`
- Modify: `ACCT/contacts/actions.ts:476-524` (`bulkDeleteContactsAction`), `ACCT/contacts/actions.test.ts`
- Modify: `ACCT/in-account-service-reads.test.ts:61` (`ALLOWED`, review I4): add `"app/(dashboard)/dashboard/accounts/[accountId]/contacts/archive-actions.ts": "owner-only",` with a comment saying the service client is used ONLY by `contactDeleteBlockersAction`, behind `requireAccountOwner` and a request-client proof of the ids. Archive and Restore stay on `dbForRequest`. The test scans every in-account file that names `serviceDb` and fails on one it does not list.
- Modify: `ACCT/contacts/bulk-action-bar.tsx`, `ACCT/contacts/bulk-action-bar.test.ts`
- Modify: `ACCT/contacts/contacts-table.tsx` (the `view` prop, threaded to `BulkActionBar` at `:196-205`), `ACCT/contacts/contacts-table.test.ts`
- Modify: `ACCT/contacts/page.tsx`, `ACCT/contacts/page.test.ts`
- Modify: `ACCT/contacts/export/route.ts:128` (passes `archived` from `?view=`), `ACCT/contacts/export/route.get.test.ts`
- Create (fix round): `ACCT/contacts/bulk-action-bar.dialog.test.ts` (renders `DeleteDialogBody` with the dialog primitives as plain elements)
- Modify (fix round): `apps/web/src/lib/messages.ts` and `apps/web/src/lib/messages.test.ts` (One twins, the Archived view's delete lines, the partial-failure lines, the none title); `apps/web/src/lib/billing/read-only.test.ts` (`READ_ONLY_ALLOWED` gains `archive-actions.ts#contactDeleteBlockersAction`, which passes `duringPause: "allow"`)

**As built (corrected 2026-10-28 after the Task 10 review).** Built at `65df28cb`; the fix round's commit follows it. The line numbers in Steps 3-5 were read at `81fb5ad2` and have moved since; the source wins. Three rules the steps below did not state, now binding:
- **The Archived view never offers to archive.** Its contacts are archived already. The bar's Delete dialog, when nothing is deletable, shows `contacts.delete.noneDeletableArchived` and no "Archive instead"; `announceDeleteResult` takes the view and shows `bulk.deletedSkippedArchived` with no "Archive them".
- **A partial Archive or Restore says so.** `ArchiveActionResult`'s ok branch carries `partial?: true` when a `ContactBatchError` ended the write after earlier batches changed contacts; the bar sets the same when a later call of 500 fails. The success toast counts what changed and keeps its Undo; a second, error toast reads `contacts.archive.partial` / `contacts.restore.partial` (no number: which of the rest would have changed is not knowable).
- **Counts of one read in the singular.** `keepsAppointments`, `someKept` and `bulk.deletedSkipped` (and its Archived twin) go through `plural()` on the count they name; nothing deletable titles the dialog `contacts.delete.noneTitle` rather than "Delete 3 contacts?" and does not repeat the kept line.

**Interfaces:** Produces the three actions in "Shared facts". `bulkDeleteContactsAction`'s ok-result gains `skippedIds` and `lateKept`. `parseView(raw): "active" | "archived"`, `withView(params, view)` and `archivedFilterOf(view)` come from `lib/contacts/view.ts`.

**From T4's review fix round (2026-10-28), binding on this task:**
- `archiveContactsAction` (and `restoreContactsAction`) refuse a Technician BY ROLE (`seesWholeAccount`) before any db call. The database does not: a Technician's RLS hides an unassigned contact, so `archiveContacts` matches 0 rows and returns `changedIds: []` with no error.
- `deleteContacts`' `skippedBlocked` ALREADY includes `lateKept`. Never add the two; `lateKept` is the subset kept after the purge ran (the `contacts.delete.filesGoneKept` case).
- A selection survives a page change, so it can exceed `MAX_CONTACT_BATCH` (500), and every one of `archiveContacts`, `restoreContacts`, `contactDeleteBlockers` and `deleteContacts` throws on 501 ids before any query. Cap the selection at 500 in the bulk bar or split the action's calls into chunks of 500.
- `archiveContacts`/`restoreContacts` throw `ContactBatchError` (exported from `@bis/db`) when a batch after the first fails; its `changedIds` are the contacts already changed. The action catches it and still offers Undo for exactly those ids (and revalidates), rather than a bare failure.
- `deleteContacts` now calls `delete_internal_contacts` with an empty array on the request client first (the Owner pre-flight), so a refusal throws BEFORE `beforeDelete` runs; the action's `purged === 0` branch then answers the plain failure, never `filesGoneKept`.

**Run:** `pnpm --filter web exec vitest run src/lib/contacts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` and `pnpm --filter web typecheck`

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
        // listContactUpcomingBookings `.in()`s its ids: at most 200 per call (review M1).
        const now = new Date().toISOString();
        const upcoming = [];
        for (let i = 0; i < changedIds.length; i += 200) {
          upcoming.push(...await listContactUpcomingBookings(db, accountId, changedIds.slice(i, i + 200), now, MAX_CONTACT_BATCH));
        }
        upcoming.sort((x, y) => x.starts_at.localeCompare(y.starts_at));
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
    const db = await dbForRequest();
    const proven: string[] = [];
    for (let i = 0; i < ids.length; i += 200) {  // review M1: at most 200 ids per .in()
      const { data, error } = await db.from("contacts").select("id").eq("account_id", accountId).in("id", ids.slice(i, i + 200));
      if (error) throw new Error(error.message);
      proven.push(...(data ?? []).map((r) => r.id as string));
    }
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
  - **(Review I1.) In `view === "archived"`** neither "Archive instead" nor "Archive them" appears: the contacts are archived already. The none sentence is `contacts.delete.noneDeletableArchived` and the skipped toast `bulk.deletedSkippedArchived`, both saying they stay archived.

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

- [ ] **Step 6: Export.** `export/route.ts:128`: `archived: archivedFilterOf(parseView(url.searchParams.get("view")))`. Add one `route.get.test.ts` case (mutation: drop it → FAILS).

- [ ] **Step 7: Run green** and `pnpm --filter web typecheck`. Paste both.
- [ ] **Step 8: Commit** every path listed under Files: `feat(contacts): archive from the list, an Archived view with Restore, and a delete that says what it keeps`.

---

### Task 12: To do and search

**Tier:** low · **Owner:** bis-crm · **Wave:** 3

(The agency dashboard's total, `apps/web/src/app/(dashboard)/dashboard/page.tsx:20`, is DEFERRED by the coordinator; see "Deferred".)

**Files:**
- Modify: `ACCT/tasks/page.tsx:166-175` and `ACCT/tasks/page.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/work/page.tsx:157-165` and `apps/web/src/app/(dashboard)/dashboard/work/page.test.ts`
- Modify: `apps/web/src/app/api/accounts/[accountId]/search/route.test.ts`

**Run:** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/work" "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks" "src/app/api/accounts/[accountId]/search"`

- [ ] **Step 1: Failing tests.**
  - To do and work: a To-do on an archived contact names it as "Maria Garcia · Archived" (`contacts.archived.mark`), so it is still listed, never hidden (mutation: filter archived out → the row disappears, FAILS; mutation: drop the mark → FAILS).
  - Search route: `listContacts` is called WITHOUT an `archived` override, so the default (`exclude`) holds (mutation: pass `archived: "only"` → FAILS).
- [ ] **Step 2: Run red**, paste. **Step 3: Implement:** add `archived_at` to both contacts selects and append `` ` · ${tr.text("contacts.archived.mark")}` `` (or the page's own translator; read which it uses) when `c.archived_at`. **Step 4: Run green**, paste. **Step 5: Commit** the five paths: `feat(contacts): To do marks an archived customer Archived, never hides the work`.

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
  - a Technician (`canArchive` false) renders no Archive button: render `ArchiveControls` with `renderToStaticMarkup` (react-dom/server, as `app/(dashboard)/dashboard/accounts/account-name-fields.test.ts` and `billing-done/page.test.ts` already do) inside a `LocaleProvider`, with `next/navigation`'s `useRouter` mocked, and assert the markup has no `data-archive-action="archive"` while the Owner's render has one (review M5; mutation: ignore `canArchive` → FAILS). A source regex would pass on a dead branch.
- [ ] **Step 2: Run red**, paste.
- [ ] **Step 3: Implement `ArchiveControls`.** Props: `{ accountId, contactId, name: string | null, phoneLast4: string | null, archived: { at: string; byLabel: string | null } | null, canArchive: boolean, canDelete: boolean, timezone: string, variant: "page" | "drawer", onGone?: () => void }`.
  - Ghost buttons only (rule 8: Call stays the header's one primary). Each carries `data-archive-action="archive" | "restore" | "delete"`, which the `renderToStaticMarkup` test reads. The test file builds the element with `createElement`, as `account-name-fields.test.ts:2-3,28` does, so it stays a `.test.ts`.
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
  1. Before EVERY action below, read the header total as a number off the page (parse the digits of the count element), and assert after the action against that value: `before - 1`, then `before`, and so on (review M6). Never assert a literal total: the fixture account's contact count is whatever earlier specs left.
  2. Tick "Archive One", then `bar.getByRole("button", { name: m["bulk.archive"] })`. Wait for the action's answer with a `waitForRequest` matching the contact id (the `bulkDeleteAnswered` pattern, `:119-129`).
  3. Expect toast `Archived 1 contact`, the row gone, and the total equal to the value read before step 2, minus one.
  4. Click the toast's `m["common.undo"]` → the row back, the total back.
  5. Archive again. `page.getByRole("link", { name: m["contacts.archived.link"], exact: true })`. Read the Archived view's total; expect the row in it. After step 6, expect that total minus one, rather than a literal `1 archived`: an earlier run's leftovers may be archived there too.
  6. Tick it, then `m["bulk.restore"]` → toast `Moved 1 contact back to your list`, and the Archived view is empty (`m["contacts.archived.emptyTitle"]`).
  7. `page.getByRole("link", { name: m["contacts.archived.back"] })` returns to the list.

  `afterAll` deletes both contacts with the service client, as the file's own cleanup does. Both are internal-only, so `delete_internal_contacts` allows it.
- [ ] **Step 2: `contacts-drawer.spec.ts` BulkGate test (`:719-739`).** The dialog is now `page.getByRole("dialog").filter({ hasText: /delete 1 contact/i })`. That title appears once the blockers load and is the deletable count, so it doubles as the wait. Fill `"1"` (not `"2"`). The toast text becomes `m["bulk.deletedSkipped"]` with `{count}` 1 and `{skipped}` 1, read from the catalogue and never hard-coded. Add one assertion: the toast's "Archive them" button (`m["bulk.archiveKept"]`) is visible. The Bulk One/Two test (`:688-717`) is unchanged: both contacts are internal-only, so the title stays "Delete 2 contacts?" and "2" still enables Delete. Confirm this on the run.
- [ ] **Step 3:** The orchestrator runs the suite. Paste the spec lines from the run (pass, or the first failure).
- [ ] **Step 4: Commit** the two paths: `test(e2e): archive, undo, the Archived view and restore on the fixture account; the delete dialog's new count`.

---

## Deferred (coordinator, 2026-10-28 fix round)

- **The archived match in Add contact** (was T10 Step 6). Today a dedupe hit on an archived contact answers `{ kind: "existing" }`, and the dialog links to that contact (`ACCT/contacts/actions.ts:51-99`, `add-contact-dialog.tsx:114-120`). The record page then shows the archived banner with Restore (T11), so the link still lands somewhere honest. Its copy key `contacts.add.existingArchived` was dropped from T3.
- **The agency dashboard's contact total** (`apps/web/src/app/(dashboard)/dashboard/page.tsx:20`, was half of T12). Until it lands, that agency-only tile counts archived contacts, while the account's own list and total (T4) do not. The ledger records the gap.
- **Out of this plan, its own PR:** Sofía never stores a placeholder name (spec §7).
- **Revoking `authenticated`'s table DELETE on `contacts`** (final review M7). Every delete now goes through `delete_internal_contacts`, so the direct grant is no longer needed; it is left in place because 0103 is frozen and on its way to bis-ci. A later migration revokes it, with the grants tests (`server-only-writes-grants.test.ts`) updated beside it.

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

## Review fix round (2026-10-28): what changed, and one pushback

Opus plan review: 9 Important, 9 Minor. Each was verified against the source before it was applied:
- I1: both probes rewritten; the RLS refusal claim was checked against `0103`'s own policy set.
- I2: `contacts-marketing-optout-schema.test.ts:69-72` and `server-only-writes-grants.test.ts:130-133` both pin contacts' column grants.
- I3: `shared-number.spec.ts:136` passes `conversationsDb`.
- I4: `in-account-service-reads.test.ts` `ALLOWED`.
- I5: `bulk-action-bar.test.ts:364-370`.
- I6: `inbound-actions.ts:149`, and `cls` scoped inside `if (!forward)` at `file.ts:56-61`.
- I7: applied as decided.
- I8: `incrementUnreadCount` at `route.ts:240` runs outside the filing try.
- M1: `contacts.ts:1097`, `assignment.ts:99`.
- M2: `messaging.ts:928-932`.
- M3: `0019:49`.
- M4: `SORT_COLUMN` at `contacts.ts:790-794`.
- M5: `renderToStaticMarkup` precedent.
- M6, M7, M8: applied.
- M9: `account-teardown.ts:20-37`.

**Pushback, partial (I9):** "refuse unless agency or Owner" alone would refuse `shared-number.spec.ts:136` and the `deleteContacts` live suites, which call it on the service client with no Owner JWT. So the function also admits a `service_role` JWT. PostgREST verifies the token before setting `request.jwt.claims`, so a client cannot claim that role. Everything else in I9 is applied: execute granted to authenticated, the app calls it on the request client, and a Staff member's call is refused.

**Two of my own corrections, found while applying I8:**
- One conversation per contact (`0005_messaging.sql:24-25`). The T1 inbox test and a blocker seed used two conversations on one contact; both now use two contacts.
- The unread rule cannot be a PostgREST `or` across a conversation column and an embedded contact column, and `listConversations` already spends its one `or` on the cursor. Hence the stored `conversations.inbox_visible` column.

## Self-review (done while writing, 2026-10-28)

- **Spec coverage.** §3 → T1. §4.1 reads → T4 (list, count, search, pickers, export via T10), T6 (inbox, by the unread rule), T12 (To do); the agency total is deferred. §4.2 signs → T8, T9 (SMS auto-replies by `looksAutomaticText`; email only from the pipeline's customer filing); the import → T4 Step 5. §5 delete → T1 (with the database's Owner check), T4, T10, T11. §6 copy → T3. §7 → its own PR, not here. §8 → T5. §9 tests → each task. §11 rulings → Q1 in T8/T9, Q2 in T5 and the T10 toast, Q3 in T1 and T10/T11. Gaps closed: the spec named `registry.ts` for Sofía's booking (not needed, T8 note); the spec named `proposals-drop.test.ts` (not needed, corrected).
- **Placeholders.** T1 Step 2's blocker cases and T4/T5/T6 live tests name the existing test file to copy each seed from rather than inventing column lists. That is deliberate: those inserts carry NOT NULL columns this plan did not read, and rule 1 says the source wins.
- **Type consistency.** `ArchiveActionResult`, `restoreContactOnSign(serviceDb, accountId, contactId, sign)`, `contactDeleteBlockers → Map<string, DeleteBlockReason[]>` and `deleteContacts`' `{ serviceDb, beforeDelete }` are used with the same names in T4, T8, T9, T10 and T11.
