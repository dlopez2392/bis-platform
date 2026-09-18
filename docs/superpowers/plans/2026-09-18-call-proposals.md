# A finished call proposes the next step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a call is recorded, propose at most a few grounded next steps — a follow-up task, a contact-field fill, an opportunity stage move — that a human accepts or dismisses; nothing reaches the CRM without that human action.

**Architecture:** A new `call_proposals` table, deliberately NOT a `tasks` row (spec §"The decision that shapes everything"). Generation runs in the voice lifecycle's existing `after()` work, **after `finishCallRow` has persisted the transcript**, is best-effort, and grounds every proposal in a verbatim span of the stored transcript. Accept routes through the *existing* human write paths (`addTask`, `fillContactBlanks`, `moveOpportunityToStage`) so every validation, RLS policy, dedupe key and event emission applies unchanged.

**Tech Stack:** Postgres/Supabase (migration `0040`), TypeScript, Next.js App Router server actions, vitest (db + web), Playwright (e2e).

---

## Verification record — spec corrections this plan carries

Four read-only agents verified every shape against source on 2026-09-18. **The spec names five things that do not exist.** These corrections are binding; do not "fix" them back toward the spec.

| Spec says | Reality | Source |
|---|---|---|
| `createTask` | **`addTask(db, accountId, {contactId?, title, dueAt?}, actorId, actorType?)`** | `packages/db/src/activities.ts:25` |
| `setOpportunityStage` | **`moveOpportunityToStage(db, accountId, oppId, toStageId, actorId, actorType?)`** | `packages/db/src/opportunities.ts:53` |
| "the contact update action" | **`fillContactBlanks(db, accountId, contactId, {firstName?,lastName?,email?,phone?}, actorId, actorType?) => Promise<string[]>`** — already implements Containment 2 | `packages/db/src/contacts.ts:208` |
| `outcomeOf` | **`classifyOutcome(state)`** | `apps/web/src/lib/voice/call-state.ts:90` |
| generation "alongside the summary" | **WRONG.** Summary is `finish-call.ts:233`; the transcript is not durable until `finishCallRow` resolves at `finish-call.ts:427` (`stored = true` at `:439`). Generating "alongside the summary" grounds proposals in unpersisted state. | `finish-call.ts:233` vs `:427` |

Further binding facts:

- **`fillContactBlanks` returns the column names it actually wrote, `[]` if none.** This makes propose-time check and accept-time re-check a single atomic call — no check-then-write race. The spec's Containment 2 is satisfied by *using this function*, not by hand-rolling a blank check.
- **Opportunity stage is a `uuid` FK to `pipeline_stages.id`**, not a text enum. Order comes from `pipeline_stages.position` via the private `stagesOf()`. There is no stage-CRUD API anywhere.
- **`moveOpportunityToStage` does NOT verify the current stage** — it only rejects a stage outside the opportunity's pipeline. The spec's "refuse if the stage moved" is a read-then-write at the accept layer with a real race window.
- **This Supabase project's default ACL auto-grants ALL (`arwdDxtm`) to `anon` AND `authenticated` on every new table.** `config.toml:19-24` describes the local CLI and is false here. A migration with a policy and no grant block ships wide open. Proven live: `contact_duplicate_flags` (0033) carries full privileges to `anon` today.
- **`classifyOutcome` never returns `"transferred"`** — a handed-off call classifies `abandoned` at socket close and only becomes `transferred` later via `/handoff-result`. It is also the one case where the transcript is provably partial.
- **`CallOutcome` has six values:** `booked | lead | message | abandoned | spam | transferred` (`packages/db/src/voice.ts:30`).
- **`TranscriptEvent = { role: "caller" | "assistant"; text: string; at: string }`** (`packages/db/src/voice.ts:31`).
- **`withRollback(fn: (c: Client) => Promise<void>)`** yields a raw `pg` Client. **One refused statement per block** — after the first rejection the transaction is aborted (`25P02`) and later assertions test the abort, not the property.
- **`withTestAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>)`** yields a `serviceDb()` client.
- `contacts.account_id` names **no** delete action (predates the 0017 rule); `calls.account_id` is `restrict`.
- The one non-realtime model call in the repo is `summary-service.ts:36-101` — plain `fetch` to Chat Completions, `gpt-4o-mini`, key read *inside* the function body, `AbortSignal.timeout(10_000)`, and an injectable `fetchImpl` seam for tests. **No JSON mode or tool-calling exists anywhere in this repo yet.**

## Global Constraints

- **Tokens only.** No hard-coded colors/radii/shadows. Every UI change obeys `DESIGN.md`'s definition of done.
- **All user-visible copy goes in `apps/web/src/lib/messages.ts`** (single `as const`, 985 keys), keyed and referenced as `m["..."]`. `messages.test.ts` forbids internal milestone labels in client-reachable strings.
- **Voice never blocks.** A failure anywhere in proposal generation logs and changes nothing about the call, its transcript, its outcome or its text-back.
- **Status is never colour alone** — dot + word (`DESIGN.md` rule 3).
- **Gates before merge:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`. Run one at a time; read exit codes from files.
- **Anything mutating in e2e runs on the per-run fixture account.** Never `Test Client One`, never a live account.
- ⚠️ **`withTestAccount` yields a `serviceDb()` client, which bypasses RLS AND all grants.** Any property that depends on a grant or a policy — above all this table's column-level UPDATE grant, its declared security boundary — is INVISIBLE to a test written that way. Prove those as the `authenticated` role via `withRollback` + `actAs`, seeding real `accounts` rows with `client_access_enabled` true. A grants test that never runs as the restricted role is the shape this repo has shipped green and hollow before.
- **Every test is proven by mutation:** break the code the test guards, watch that named test go red, restore. A test that cannot fail is a defect (see the ledger's vacuity catalogue).
- Migration `0040_call_proposals.sql`. Filename form `NNNN_snake_name.sql`, no timestamp.

---

## File Structure

**Create:**
- `packages/db/supabase/migrations/0040_call_proposals.sql` — table, CHECKs, partial unique index, RLS, grants.
- `packages/db/src/call-proposals.ts` — typed accessors (`insertProposal`, `listProposalsForCall`, `listPendingProposals`, `getProposal`, `markProposalDecided` in Task 2; `listPendingProposalsForAgency` added in Task 10, where the agency screen consumes it).
- `packages/db/src/test/call-proposals-grants.test.ts` — grants + RLS proof.
- `packages/db/src/test/call-proposals.test.ts` — accessor + constraint proof.
- `apps/web/src/lib/proposals/grounding.ts` — `isGrounded(evidence, transcript)`; pure, no IO.
- `apps/web/src/lib/proposals/grounding.test.ts`
- `apps/web/src/lib/proposals/eligibility.ts` — `callIsEligible(...)`; pure.
- `apps/web/src/lib/proposals/eligibility.test.ts`
- `apps/web/src/lib/proposals/generate.ts` — the model call + validation + write.
- `apps/web/src/lib/proposals/generate.test.ts`
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/proposals.tsx` — server-rendered block.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/proposal-actions.tsx` — client boundary.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.ts` — accept/dismiss server actions.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.test.ts`
- `apps/web/e2e/call-proposals.spec.ts`

**Modify:**
- `packages/db/src/index.ts` — export the new accessors and types.
- `packages/db/src/account-teardown.ts:29-45` — extend the exclusion doc-block (cascade, not register).
- `apps/web/src/lib/voice/finish-call.ts` — call the generator after `stored = true`.
- `apps/web/src/lib/messages.ts` — copy keys.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/page.tsx` — render the block.
- `apps/web/src/app/(dashboard)/dashboard/work/page.tsx` + `agency-work-list.tsx` — proposals as a sibling section.
- `docs/superpowers/specs/2026-09-18-call-proposals-design.md` — correct the five wrong names and the placement sentence.

---

## Task 1: The `call_proposals` table

**Files:**
- Create: `packages/db/supabase/migrations/0040_call_proposals.sql`
- Create: `packages/db/src/test/call-proposals-grants.test.ts`
- Modify: `packages/db/src/account-teardown.ts:29-45`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.call_proposals` with columns `id, account_id, call_id, contact_id, kind, payload, evidence, status, decided_at, decided_by, created_at`. `kind ∈ {task, contact_field, opportunity_stage}`, `status ∈ {pending, accepted, dismissed}`.

**Design decisions locked here (do not re-litigate):**
1. **Client-mutable, so NOT the `events` two-policy shape.** Both audiences accept/dismiss, and every human write path goes through `dbForRequest()` under RLS. Use the `notes_member_all` house shape (`0033_contact_dedupe_keys.sql:75-81`).
2. **Grants are explicit and restrictive**, because the default ACL grants everything. `authenticated` gets `select` plus **column-level** `update (status, decided_at, decided_by)` — precedent `0016_booking.sql:84-88`. No INSERT for `authenticated`: the pass is the only writer. `anon` gets nothing.
3. **`account_id` is `on delete cascade`**, so `call_proposals` stays OFF `ACCOUNT_OWNED_TABLES` and joins the exclusion doc-block alongside `screened_calls`, `contact_duplicate_flags` and `alert_phone_verifications`.
4. **The partial unique index must `coalesce` the nullable `contact_id`** — NULLs are distinct in Postgres, so a bare three-column unique index would not constrain task proposals at all (the ones with no contact). Precedent: `0001_tenancy.sql:54-55`.

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0040_call_proposals.sql`:

```sql
-- A proposal is a QUESTION about work, never work itself.
--
-- WHY THIS IS NOT A `tasks` ROW WITH A `proposed` STATUS. `bucketWork`
-- (lib/work/buckets.ts), the account dashboard's work row, and
-- `listAgencyWork` all read `tasks` without knowing about any status
-- column. Adding a state there means teaching EVERY existing reader to
-- exclude it, and the failure mode of missing one is that a machine's
-- guess renders as a real task a human believes. That is the exact defect
-- this feature exists to avoid producing. A separate table touches none of
-- them. Same reasoning as 0039_screened_calls.sql's refusal to be a
-- `calls` row.
create table public.call_proposals (
  id uuid primary key default gen_random_uuid(),
  -- Unlike screened_calls, every proposal HAS an account: it came from a
  -- call that reached one. Cascade, not restrict, so the account's own
  -- deletion carries these away (see account-teardown.ts's doc-block).
  account_id uuid not null references public.accounts(id) on delete cascade,
  -- The evidence. A proposal with no call is not reviewable, so losing the
  -- call must lose the proposal.
  call_id uuid not null references public.calls(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  -- NOT NULL and non-empty: the generator does not get to assert, it has
  -- to point. A proposal whose evidence is absent from the stored
  -- transcript is dropped at write time (lib/proposals/grounding.ts).
  evidence text not null,
  status text not null default 'pending',
  decided_at timestamptz,
  -- A Clerk user id, deliberately NOT an FK: `users` is empty and
  -- assignment is dead throughout this codebase. A breadcrumb, not a
  -- relation.
  decided_by text,
  created_at timestamptz not null default now(),
  constraint call_proposals_kind_check check (kind in (
    'task', 'contact_field', 'opportunity_stage'
  )),
  constraint call_proposals_status_check check (status in (
    'pending', 'accepted', 'dismissed'
  )),
  constraint call_proposals_evidence_nonempty check (length(btrim(evidence)) > 0)
);

comment on table public.call_proposals is
  'Machine-suggested next steps from a finished call. Never work itself: nothing here reaches the CRM without a human accept.';

-- COALESCE IS LOAD-BEARING, NOT DEFENSIVE. `contact_id` is nullable and
-- Postgres treats NULLs as distinct in a unique index, so the bare
-- three-column form would constrain nothing for `task` proposals — which
-- are exactly the ones with no contact. Precedent: memberships_unique
-- (0001_tenancy.sql:54-55).
create unique index call_proposals_one_pending_unique
  on public.call_proposals (
    call_id, kind, coalesce(contact_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'pending';

-- The call detail page's read.
create index call_proposals_call_idx
  on public.call_proposals (call_id, created_at desc);
-- The work queue's read: pending only, newest first, per account.
create index call_proposals_account_pending_idx
  on public.call_proposals (account_id, created_at desc)
  where status = 'pending';

alter table public.call_proposals enable row level security;

-- Mirrors notes_member_all / contact_duplicate_flags_member_all exactly:
-- same account-scoping predicate, same `for all to authenticated`. Both
-- audiences review proposals, so this is NOT a service-role-only table
-- like screened_calls.
create policy call_proposals_member_all on public.call_proposals
  for all to authenticated
  using (app.is_agency() or account_id = app.current_account_id())
  with check (app.is_agency() or account_id = app.current_account_id());

-- ⚠️ THE GRANTS ARE THE SECURITY BOUNDARY HERE, NOT THE POLICY.
-- This project's default ACL auto-grants ALL privileges to `anon` AND
-- `authenticated` on every new table (verified live in pg_default_acl;
-- config.toml's auto_expose_new_tables block describes the LOCAL CLI and
-- is false here). 0020_voice_grants_revoke.sql exists because of exactly
-- this, and 0033 shipped without a grant block and still carries
-- INSERT/UPDATE/DELETE to `anon` today. So: revoke everything, then grant
-- back only what a reviewer needs.
revoke all on public.call_proposals from anon, authenticated;
grant select on public.call_proposals to authenticated;
-- COLUMN-LEVEL update (0016_booking.sql:84-88's shape): a reviewer answers
-- a proposal, they do not get to rewrite what was proposed. Without the
-- column list, a client could edit `payload` and then accept their own
-- edit through the trusted write path.
grant update (status, decided_at, decided_by) on public.call_proposals to authenticated;
-- INSERT belongs to the generator alone. A client that could insert could
-- manufacture a proposal and accept it, laundering an arbitrary write
-- through the accept path's trusted call to addTask/fillContactBlanks.
grant select, insert, update, delete on public.call_proposals to service_role;
```

- [ ] **Step 2: Write the failing grants test**

Create `packages/db/src/test/call-proposals-grants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

describe("call_proposals grants", () => {
  // EXISTENCE FIRST, and not as ceremony: "no rows in role_table_grants" is
  // also true of a table that was never created, so without this the whole
  // file is vacuously green before the migration is applied.
  it("the table exists (guards every assertion below from vacuity)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(
        `select to_regclass('public.call_proposals')::text as oid`,
      );
      expect(rows[0].oid).toBe("public.call_proposals");
    }));

  it("anon holds NO privileges at all (mutation: drop the `revoke all ... from anon` -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select privilege_type from information_schema.role_table_grants
           where table_name = 'call_proposals' and grantee = 'anon'`,
      );
      expect(rows).toEqual([]);
    }));

  it("authenticated may select but NOT insert or delete (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ privilege_type: string }>(
        `select privilege_type from information_schema.role_table_grants
           where table_name = 'call_proposals' and grantee = 'authenticated'`,
      );
      const privs = rows.map((r) => r.privilege_type);
      expect(privs).toContain("SELECT");
      expect(privs).not.toContain("INSERT");
      expect(privs).not.toContain("DELETE");
    }));

  it("authenticated's UPDATE is column-scoped to the decision columns (mutation: grant update on the whole table -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.column_privileges
           where table_name = 'call_proposals'
             and grantee = 'authenticated' and privilege_type = 'UPDATE'`,
      );
      const cols = rows.map((r) => r.column_name).sort();
      expect(cols).toEqual(["decided_at", "decided_by", "status"]);
    }));

  // ONE REFUSED STATEMENT PER withRollback. After a rejection the
  // transaction is aborted (25P02) and every later statement fails with the
  // abort, not the property under test — so this gets its own block.
  it("a client cannot INSERT a proposal (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(
        c.query(
          `insert into public.call_proposals (account_id, call_id, kind, payload, evidence)
             values (gen_random_uuid(), gen_random_uuid(), 'task', '{}'::jsonb, 'x')`,
        ),
      ).rejects.toThrow(/permission denied/i);
    }));
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @bis/db test -- call-proposals-grants`
Expected: FAIL — the existence assertion is unsatisfied because the migration has not been applied. ⚠️ Note `to_regclass` returns the BARE name (`call_proposals`) on this project's connection, not `public.call_proposals` — strip the schema prefix as `alert-phone-verification-grants.test.ts:174-176` already does, rather than asserting the qualified form.

- [ ] **Step 4: Hand the migration to the orchestrator to apply**

**The implementer does NOT apply the migration.** Per the repo's standing rule, `bis-db-schema` writes migrations and their proof; the orchestrator applies, exactly once. Stop here and report that the migration is ready.

- [ ] **Step 5: Re-run the test after the orchestrator applies**

Run: `pnpm --filter @bis/db test -- call-proposals-grants`
Expected: PASS. The file grows past 6 as the grants/RLS proof is completed — read vitest's own summary rather than expecting a fixed count.

- [ ] **Step 6: Prove each assertion can fail**

For each of the four privilege tests, apply the mutation named in its own title against the live schema inside a rolled-back transaction, confirm that test goes red, and restore. Record the exact red output in the task report.

- [ ] **Step 7: Extend the teardown exclusion doc-block**

In `packages/db/src/account-teardown.ts`, the doc-block at lines 29-45 currently names `alert_phone_verifications`, `contact_duplicate_flags` and `screened_calls` as deliberately absent from `ACCOUNT_OWNED_TABLES`. Add `call_proposals` to that list. ⚠️ **The reason is NOT the one the other three carry.** For this table it is `call_id … on delete cascade` firing from `calls`, which IS already on the teardown list and is deleted before `accounts`. `account_id`'s cascade is a backstop for a direct `accounts` delete and is never exercised by `deleteAccountCascade`. Word it that way. **Do not add it to `ACCOUNT_OWNED_TABLES` itself.**

- [ ] **Step 8: Prove the cascade actually removes the rows**

Add to `packages/db/src/test/call-proposals-grants.test.ts` a test following the shape at `alert-phone-verification-grants.test.ts:311-328`: inside `withTestAccount`, insert a phone number, a call and a proposal; let the `finally` teardown run; then through a fresh `serviceDb()` assert the proposal rows for that account are `[]`.

⚠️ **Mutate `call_proposals_call_id_fkey`, named explicitly — NOT `account_id`'s.** The table has two cascading FKs and the `account_id` one is vacuous here: `calls` is deleted before `accounts`, so `call_id`'s cascade has already removed the rows and an `account_id`-restrict mutation completes without error. Proven empirically in Task 1.

- [ ] **Step 9: Commit**

```bash
git add packages/db/supabase/migrations/0040_call_proposals.sql \
        packages/db/src/test/call-proposals-grants.test.ts \
        packages/db/src/account-teardown.ts
git commit -m "feat(db): a table for proposals, readable by both audiences and writable by neither"
```

---

## Task 2: Typed accessors

**Files:**
- Create: `packages/db/src/call-proposals.ts`
- Create: `packages/db/src/test/call-proposals.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: the `call_proposals` table from Task 1.
- Produces:

```ts
export type ProposalKind = "task" | "contact_field" | "opportunity_stage";
export type ProposalStatus = "pending" | "accepted" | "dismissed";

export type TaskPayload = { title: string; dueAt: string | null };
export type ContactFieldPayload = { field: "firstName" | "lastName" | "email" | "phone"; value: string };
export type OpportunityStagePayload = {
  opportunityId: string; fromStageId: string; toStageId: string;
};
// DISCRIMINATED ON `kind`, never a bare union. `payload` is unconstrained
// jsonb — only `kind`, `status` and `evidence` carry CHECKs — so this type
// is the ONLY thing standing between a `kind: "task"` row and an
// opportunity payload. A bare union type-checks that pairing and writes it,
// and it surfaces as a review card with an undefined title.
export type ProposalInput =
  | { kind: "task"; payload: TaskPayload }
  | { kind: "contact_field"; payload: ContactFieldPayload }
  | { kind: "opportunity_stage"; payload: OpportunityStagePayload };
export type ProposalPayload = TaskPayload | ContactFieldPayload | OpportunityStagePayload;

export type CallProposal = {
  id: string; accountId: string; callId: string; contactId: string | null;
  kind: ProposalKind; payload: ProposalPayload; evidence: string;
  status: ProposalStatus; decidedAt: string | null; decidedBy: string | null;
  createdAt: string;
};

export async function insertProposal(
  db: SupabaseClient, accountId: string,
  input: { callId: string; contactId?: string | null; kind: ProposalKind;
           payload: ProposalPayload; evidence: string },
): Promise<{ id: string } | null>;

export async function listProposalsForCall(
  db: SupabaseClient, accountId: string, callId: string,
): Promise<CallProposal[]>;

export async function listPendingProposals(
  db: SupabaseClient, accountId: string,
): Promise<CallProposal[]>;

export async function getProposal(
  db: SupabaseClient, accountId: string, id: string,
): Promise<CallProposal | null>;

export async function markProposalDecided(
  db: SupabaseClient, accountId: string, id: string,
  status: "accepted" | "dismissed", decidedBy: string,
): Promise<boolean>;
```

- [ ] **Step 1: Write the failing accessor tests**

Create `packages/db/src/test/call-proposals.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount, testPhoneNumber } from "./fixtures";
import {
  insertProposal, listProposalsForCall, listPendingProposals,
  getProposal, markProposalDecided,
} from "../call-proposals";

async function seedCall(db: any, accountId: string): Promise<string> {
  const num = await db.from("phone_numbers")
    .insert({ account_id: accountId, e164: testPhoneNumber() }).select("id").single();
  expect(num.error, `phone_numbers insert failed: ${num.error?.message}`).toBeNull();
  const call = await db.from("calls")
    .insert({ account_id: accountId, phone_number_id: num.data!.id, caller_e164: "+19562921696" })
    .select("id").single();
  expect(call.error, `calls insert failed: ${call.error?.message}`).toBeNull();
  return call.data!.id as string;
}

describe("call proposals accessors", () => {
  it("round-trips a task proposal", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const created = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      expect(created).not.toBeNull();
      const rows = await listProposalsForCall(db, accountId, callId);
      expect(rows).toHaveLength(1);
      expect(rows[0].kind).toBe("task");
      expect(rows[0].status).toBe("pending");
      expect(rows[0].evidence).toBe("call me Tuesday");
    });
  });

  it("refuses a SECOND pending proposal of the same kind on the same call, INCLUDING when contact_id is null (mutation: drop the coalesce from the unique index -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const first = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      expect(first).not.toBeNull();
      const second = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday again", dueAt: null },
      });
      // Swallowed as null, not thrown: a duplicate is a non-event for a
      // best-effort pass, never a reason to fail a call's finish.
      expect(second).toBeNull();
      expect(await listProposalsForCall(db, accountId, callId)).toHaveLength(1);
    });
  });

  it("allows a new pending proposal once the previous one is decided", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const first = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      expect(await markProposalDecided(db, accountId, first!.id, "dismissed", "user_x")).toBe(true);
      const second = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Wednesday",
        payload: { title: "Call back Wednesday", dueAt: null },
      });
      expect(second).not.toBeNull();
    });
  });

  it("rejects an empty evidence string (mutation: drop call_proposals_evidence_nonempty -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const created = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "   ",
        payload: { title: "Ungrounded", dueAt: null },
      });
      expect(created).toBeNull();
    });
  });

  it("markProposalDecided stamps status, decided_at and decided_by, and returns false for an unknown id", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const p = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      expect(await markProposalDecided(db, accountId, p!.id, "accepted", "user_abc")).toBe(true);
      const after = await getProposal(db, accountId, p!.id);
      expect(after!.status).toBe("accepted");
      expect(after!.decidedBy).toBe("user_abc");
      expect(after!.decidedAt).not.toBeNull();
      expect(await listPendingProposals(db, accountId)).toHaveLength(0);
      expect(
        await markProposalDecided(db, accountId, "00000000-0000-0000-0000-000000000001", "accepted", "user_abc"),
      ).toBe(false);
    });
  });

  it("markProposalDecided will not decide a proposal belonging to another account", async () => {
    await withTestAccount(async (db, accountId) => {
      const callId = await seedCall(db, accountId);
      const p = await insertProposal(db, accountId, {
        callId, kind: "task", evidence: "call me Tuesday",
        payload: { title: "Call back Tuesday", dueAt: null },
      });
      const wrong = "00000000-0000-0000-0000-0000000000aa";
      expect(await markProposalDecided(db, wrong, p!.id, "accepted", "user_abc")).toBe(false);
      expect((await getProposal(db, accountId, p!.id))!.status).toBe("pending");
    });
  });
});
```

⚠️ **Three tests above are load-bearing and easy to write in a form that cannot fail.** A review proved all three of these mutations leave a 6-test suite fully green:

- **The compare-and-swap.** Deciding a proposal ONCE never exercises `.eq("status", "pending")`. The test must decide it twice, with a DIFFERENT `decidedBy` the second time, and assert both that the second call returns `false` AND that `getProposal(...).decidedBy` is still the first user's — without the guard, the second decide silently overwrites the record of who decided it.
- **The account filter is the ONLY tenant barrier on reads** (no composite FK ties `call_proposals.account_id` to `calls.account_id`). Asserting `listPendingProposals(A)` is empty proves nothing while the table is globally empty — it is an emptiness assertion, not a scoping one. Seed a SECOND account with its own call and its own pending proposal, then assert `listPendingProposals(A)` returns exactly A's row by id, `listProposalsForCall(A, callB)` is empty, and `getProposal(A, proposalB)` is null.
- **`listPendingProposals` needs a POSITIVE case.** Asserting only the post-decide zero means `return []` passes the suite.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bis/db test -- call-proposals.test`
Expected: FAIL — `Cannot find module '../call-proposals'`.

- [ ] **Step 3: Write the accessors**

Create `packages/db/src/call-proposals.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type ProposalKind = "task" | "contact_field" | "opportunity_stage";
export type ProposalStatus = "pending" | "accepted" | "dismissed";

export type TaskPayload = { title: string; dueAt: string | null };
export type ContactFieldPayload = {
  field: "firstName" | "lastName" | "email" | "phone"; value: string;
};
export type OpportunityStagePayload = {
  opportunityId: string; fromStageId: string; toStageId: string;
};
export type ProposalPayload = TaskPayload | ContactFieldPayload | OpportunityStagePayload;

export type CallProposal = {
  id: string; accountId: string; callId: string; contactId: string | null;
  kind: ProposalKind; payload: ProposalPayload; evidence: string;
  status: ProposalStatus; decidedAt: string | null; decidedBy: string | null;
  createdAt: string;
};

const COLS =
  "id, account_id, call_id, contact_id, kind, payload, evidence, status, decided_at, decided_by, created_at";

type Row = {
  id: string; account_id: string; call_id: string; contact_id: string | null;
  kind: ProposalKind; payload: ProposalPayload; evidence: string;
  status: ProposalStatus; decided_at: string | null; decided_by: string | null;
  created_at: string;
};

function toProposal(r: Row): CallProposal {
  return {
    id: r.id, accountId: r.account_id, callId: r.call_id, contactId: r.contact_id,
    kind: r.kind, payload: r.payload, evidence: r.evidence, status: r.status,
    decidedAt: r.decided_at, decidedBy: r.decided_by, createdAt: r.created_at,
  };
}

/**
 * Writes one proposal, or returns null.
 *
 * NULL, NEVER A THROW. This runs inside the voice lifecycle's best-effort
 * tail, where the contract is that nothing about the call changes if
 * proposals fail. The two expected refusals — the partial unique index
 * (a re-run proposing the same thing twice) and the non-empty evidence
 * CHECK — are both normal outcomes of a pass doing its job, not faults.
 * The caller logs the count it got; it never reacts to a null.
 */
export async function insertProposal(
  db: SupabaseClient, accountId: string,
  input: {
    callId: string; contactId?: string | null; kind: ProposalKind;
    payload: ProposalPayload; evidence: string;
  },
): Promise<{ id: string } | null> {
  const { data, error } = await db.from("call_proposals")
    .insert({
      account_id: accountId, call_id: input.callId,
      contact_id: input.contactId ?? null, kind: input.kind,
      payload: input.payload, evidence: input.evidence,
    })
    .select("id").single();
  if (error) {
    // TWO SANCTIONED REFUSALS, everything else is a FAULT. 23505 is the
    // partial unique index (a re-run proposing the same thing twice) and
    // 23514 is the blank-evidence CHECK; both are normal outcomes of a pass
    // doing its job. Logging a dropped connection or a renamed column under
    // the same word means a TOTAL OUTAGE of this feature reads, in the logs,
    // as a quiet day with nothing to propose.
    const expected = error.code === "23505" || error.code === "23514";
    const label = expected ? "refused" : `FAULT (${error.code ?? "no code"})`;
    console.error(
      `insertProposal: ${label} for call ${input.callId} kind ${input.kind}: ${error.message}`,
    );
    return null;
  }
  return { id: data!.id as string };
}

export async function listProposalsForCall(
  db: SupabaseClient, accountId: string, callId: string,
): Promise<CallProposal[]> {
  const { data, error } = await db.from("call_proposals").select(COLS)
    .eq("account_id", accountId).eq("call_id", callId)
    .order("created_at", { ascending: false })
    // Same backstop as listPendingProposals below: service_role has NO
    // statement_timeout on this project and PostgREST's db-max-rows is unset,
    // so an unbounded read is unbounded in production.
    .limit(500);
  if (error) throw new Error(`listProposalsForCall failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toProposal);
}

export async function listPendingProposals(
  db: SupabaseClient, accountId: string,
): Promise<CallProposal[]> {
  const { data, error } = await db.from("call_proposals").select(COLS)
    .eq("account_id", accountId).eq("status", "pending")
    .order("created_at", { ascending: false })
    // Same backstop as listScreenedCalls: service_role has NO
    // statement_timeout, so an unbounded read is unbounded in production.
    .limit(500);
  if (error) throw new Error(`listPendingProposals failed: ${error.message}`);
  return ((data ?? []) as Row[]).map(toProposal);
}

export async function getProposal(
  db: SupabaseClient, accountId: string, id: string,
): Promise<CallProposal | null> {
  const { data, error } = await db.from("call_proposals").select(COLS)
    .eq("account_id", accountId).eq("id", id).maybeSingle();
  if (error) throw new Error(`getProposal failed: ${error.message}`);
  return data ? toProposal(data as Row) : null;
}

/**
 * Decides a proposal, and reports whether it actually decided one.
 *
 * `.eq("status", "pending")` is the compare-and-swap: two reviewers
 * clicking Accept on the same proposal must not both succeed, and the
 * second one has to learn that it did nothing. `.select("id")` is what
 * makes that knowable — PostgREST returns no error and no rows for an
 * update matching nothing, which would otherwise read as success.
 */
export async function markProposalDecided(
  db: SupabaseClient, accountId: string, id: string,
  status: "accepted" | "dismissed", decidedBy: string,
): Promise<boolean> {
  const { data, error } = await db.from("call_proposals")
    .update({ status, decided_at: new Date().toISOString(), decided_by: decidedBy })
    .eq("account_id", accountId).eq("id", id).eq("status", "pending")
    .select("id");
  if (error) throw new Error(`markProposalDecided failed: ${error.message}`);
  return (data ?? []).length > 0;
}
```

- [ ] **Step 4: Export from the barrel**

In `packages/db/src/index.ts`, alongside the existing exports, add:

```ts
export {
  insertProposal, listProposalsForCall, listPendingProposals, getProposal,
  markProposalDecided,
  type CallProposal, type ProposalKind, type ProposalStatus,
  type ProposalPayload, type TaskPayload, type ContactFieldPayload,
  type OpportunityStagePayload,
} from "./call-proposals";
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @bis/db test -- call-proposals.test`
Expected: PASS, 6 tests.

- [ ] **Step 6: Prove the coalesce test is real**

⚠️ **NEVER RUN THIS AS PRODUCTION DDL.** This project's database is shared with production. Dropping and recreating `call_proposals_one_pending_unique` outside a transaction leaves the table with no pending-uniqueness guarantee in between, on a live system.

Run it the Task 1 way: ONE raw `pg.Client`, `BEGIN`, drop and recreate the index without the `coalesce`, re-run **the test's own query text** on that same connection, observe the assertion fail, `ROLLBACK`.

**And record the honest limitation:** a rolled-back DDL is invisible to vitest's separate connection, so on this project the proof can never show the test red *by name* — only the assertion red inside the transaction. State that in the report rather than claiming a by-name red that did not happen, and do not commit DDL to production to manufacture one.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/call-proposals.ts packages/db/src/test/call-proposals.test.ts packages/db/src/index.ts
git commit -m "feat(db): accessors for call proposals, with a compare-and-swap decide"
```

---

## Task 3: Grounding and eligibility — the two pure guards

**Files:**
- Create: `apps/web/src/lib/proposals/grounding.ts`
- Create: `apps/web/src/lib/proposals/grounding.test.ts`
- Create: `apps/web/src/lib/proposals/eligibility.ts`
- Create: `apps/web/src/lib/proposals/eligibility.test.ts`

**Interfaces:**
- Consumes: `TranscriptEvent`, `CallOutcome` from `@bis/db`.
- Produces:

```ts
export function isGrounded(evidence: string, transcript: TranscriptEvent[]): boolean;
export function callIsEligible(input: {
  outcome: CallOutcome; transcript: TranscriptEvent[]; handoffRequested: boolean;
}): boolean;
```

Pure, no IO — the same shape as `recorded-message.ts` and `silence-guard.ts`, and for the same reason.

- [ ] **Step 1: Write the failing grounding test**

Create `apps/web/src/lib/proposals/grounding.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isGrounded } from "./grounding";
import type { TranscriptEvent } from "@bis/db";

const t = (role: "caller" | "assistant", text: string): TranscriptEvent =>
  ({ role, text, at: "2026-09-18T12:00:00.000Z" });

describe("isGrounded", () => {
  const transcript = [
    t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
    t("caller", "I need a quote for a dining table. Call me Tuesday morning."),
  ];

  it("accepts a span the caller actually said", () => {
    expect(isGrounded("Call me Tuesday morning", transcript)).toBe(true);
  });

  it("is insensitive to case and surrounding whitespace", () => {
    expect(isGrounded("  call me TUESDAY morning  ", transcript)).toBe(true);
  });

  it("REJECTS a plausible sentence nobody said (mutation: return true unconditionally -> FAILS)", () => {
    expect(isGrounded("Call me Thursday morning", transcript)).toBe(false);
  });

  it("rejects a span assembled across two different turns", () => {
    expect(isGrounded("How can I help? I need a quote", transcript)).toBe(false);
  });

  it("rejects empty or whitespace evidence (mutation: drop the length floor -> FAILS)", () => {
    expect(isGrounded("", transcript)).toBe(false);
    expect(isGrounded("   ", transcript)).toBe(false);
  });

  // The floor is what stops a one-word "yes" — present in almost every
  // transcript — from grounding an arbitrary proposal.
  it("rejects a span too short to be evidence of anything", () => {
    expect(isGrounded("a", transcript)).toBe(false);
    expect(isGrounded("quote", transcript)).toBe(false);
  });

  it("rejects everything against an empty transcript", () => {
    expect(isGrounded("Call me Tuesday morning", [])).toBe(false);
  });

  // Only the CALLER's words are evidence. Sofía's own sentences are the
  // model quoting itself, which grounds nothing.
  it("does not accept the assistant's own words as evidence (mutation: drop the role filter -> FAILS)", () => {
    expect(isGrounded("Thanks for calling 956 Woodworks", transcript)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- grounding`
Expected: FAIL — `Cannot find module './grounding'`.

- [ ] **Step 3: Write grounding.ts**

```ts
import type { TranscriptEvent } from "@bis/db";

/**
 * The shortest span that can count as evidence.
 *
 * Not about suspicion — about not grounding on a fragment. "yes", "ok" and
 * "quote" appear in nearly every transcript, so accepting them would let a
 * proposal cite a word that supports any claim at all. Fifteen characters
 * is roughly the shortest real clause a caller produces ("call me Tuesday"
 * is fifteen).
 */
const MIN_EVIDENCE = 15;

/**
 * True when `evidence` is a span the CALLER actually said.
 *
 * Three properties, all load-bearing:
 *
 * • CALLER TURNS ONLY. Sofía's sentences are the model's own output; a
 *   proposal citing them is the model quoting itself and has grounded
 *   nothing. This is the difference between this check and
 *   `checkSummaryAgainstState`, which reconciles prose against CallState.
 *
 * • WITHIN ONE TURN, never across the join. Concatenating the transcript
 *   and searching it would let a span straddle two speakers and read as a
 *   sentence neither of them said.
 *
 * • CASE- AND WHITESPACE-INSENSITIVE, because the transcriber is not
 *   consistent about either between calls, and a proposal dropped over a
 *   capital letter is a false negative nobody can debug.
 */
export function isGrounded(evidence: string, transcript: TranscriptEvent[]): boolean {
  const needle = evidence.trim().toLowerCase().replace(/\s+/g, " ");
  if (needle.length < MIN_EVIDENCE) return false;
  return transcript.some(
    (e) => e.role === "caller"
      && e.text.trim().toLowerCase().replace(/\s+/g, " ").includes(needle),
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- grounding`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing eligibility test**

Create `apps/web/src/lib/proposals/eligibility.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { callIsEligible } from "./eligibility";
import type { TranscriptEvent } from "@bis/db";

const t = (role: "caller" | "assistant", text: string): TranscriptEvent =>
  ({ role, text, at: "2026-09-18T12:00:00.000Z" });

const real: TranscriptEvent[] = [
  t("assistant", "Thanks for calling. How can I help?"),
  t("caller", "I need a quote for a dining table. Call me Tuesday morning."),
];

describe("callIsEligible", () => {
  it("accepts an ordinary call that captured a lead", () => {
    expect(callIsEligible({ outcome: "lead", transcript: real, handoffRequested: false })).toBe(true);
  });

  it("refuses a spam call (mutation: drop 'spam' from the skip list -> FAILS)", () => {
    expect(callIsEligible({ outcome: "spam", transcript: real, handoffRequested: false })).toBe(false);
  });

  it("refuses an abandoned call (mutation: drop 'abandoned' -> FAILS)", () => {
    expect(callIsEligible({ outcome: "abandoned", transcript: real, handoffRequested: false })).toBe(false);
  });

  // THE ONE THAT OUTCOME ALONE CANNOT CATCH. classifyOutcome never returns
  // "transferred" — a handed-off call is stamped `abandoned` at socket
  // close and only becomes `transferred` later, from /handoff-result. So a
  // row reading `abandoned` may be a SUCCESSFUL transfer whose transcript
  // provably stops mid-conversation. Proposing from half a call is
  // proposing from a call we did not hear the end of.
  it("refuses a call that asked for a person, whatever the outcome says (mutation: drop the handoff check -> FAILS)", () => {
    expect(callIsEligible({ outcome: "transferred", transcript: real, handoffRequested: true })).toBe(false);
    expect(callIsEligible({ outcome: "abandoned", transcript: real, handoffRequested: true })).toBe(false);
    expect(callIsEligible({ outcome: "booked", transcript: real, handoffRequested: true })).toBe(false);
  });

  it("refuses a call with no caller turn at all", () => {
    expect(callIsEligible({
      outcome: "message", transcript: [t("assistant", "Thanks for calling.")], handoffRequested: false,
    })).toBe(false);
  });

  it("refuses an empty transcript", () => {
    expect(callIsEligible({ outcome: "message", transcript: [], handoffRequested: false })).toBe(false);
  });

  it("accepts booked and message calls", () => {
    expect(callIsEligible({ outcome: "booked", transcript: real, handoffRequested: false })).toBe(true);
    expect(callIsEligible({ outcome: "message", transcript: real, handoffRequested: false })).toBe(true);
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm --filter web test -- eligibility`
Expected: FAIL — `Cannot find module './eligibility'`.

- [ ] **Step 7: Write eligibility.ts**

```ts
import type { CallOutcome, TranscriptEvent } from "@bis/db";

/**
 * Outcomes that never propose anything.
 *
 * `spam` is a robocall or a connect timeout; `abandoned` is a caller who
 * hung up before anything happened. Neither supports a next step.
 *
 * ⚠️ This differs deliberately from `summary-service.ts:26-29`, which
 * still calls the model for an `abandoned` call because "its stored
 * summary is the only account anywhere of why a real human rang and left".
 * A summary is a RECORD of what happened; a proposal is an ACTION someone
 * is asked to take. Recording a call nobody completed is useful; proposing
 * work from it is inventing it.
 */
const SKIP_OUTCOMES: readonly CallOutcome[] = ["spam", "abandoned"] as const;

/**
 * True when this finished call may be proposed from at all.
 *
 * Most calls should propose nothing, and that is the design target rather
 * than a fallback: a feature that suggests something every time trains a
 * client to dismiss without reading, which is worse than silence.
 */
export function callIsEligible(input: {
  outcome: CallOutcome;
  transcript: TranscriptEvent[];
  handoffRequested: boolean;
}): boolean {
  // FIRST, and independent of the outcome string. A call where the caller
  // asked for a person has a transcript that stops at the handoff —
  // "what was said afterwards is not here" (summarize.ts:80). Whatever was
  // agreed with the human is invisible to us, so any proposal would be
  // built on the half of the call we heard, and would sit beside a real
  // conversation it contradicts.
  if (input.handoffRequested) return false;
  if (SKIP_OUTCOMES.includes(input.outcome)) return false;
  return input.transcript.some((e) => e.role === "caller" && e.text.trim().length > 0);
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `pnpm --filter web test -- eligibility`
Expected: PASS, 7 tests.

- [ ] **Step 9: Prove the mutations**

Apply each mutation named in a test title, confirm that named test goes red, restore. Record the output.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/proposals/grounding.ts apps/web/src/lib/proposals/grounding.test.ts \
        apps/web/src/lib/proposals/eligibility.ts apps/web/src/lib/proposals/eligibility.test.ts
git commit -m "feat(web): a proposal must cite the caller, and most calls propose nothing"
```

---

## Task 4: The generator

**Files:**
- Create: `apps/web/src/lib/proposals/generate.ts`
- Create: `apps/web/src/lib/proposals/generate.test.ts`

**Interfaces:**
- Consumes: `isGrounded` (Task 3), `callIsEligible` (Task 3), `insertProposal` (Task 2).
- Produces:

```ts
export async function generateProposals(input: {
  db: SupabaseClient; accountId: string; callId: string;
  contactId: string | null; outcome: CallOutcome;
  transcript: TranscriptEvent[]; handoffRequested: boolean;
  fetchImpl?: typeof fetch;
}): Promise<number>;   // how many proposals were written
```

**Scope note — ordering, NOT narrowing.** All three kinds ship (danlo took the full scope over the narrower recommendation, knowing the blast radius). This task builds the generator's spine and the `task` kind; Tasks 8 and 9 add `contact_field` and `opportunity_stage` generation. They come *after* the accept path (Task 6) and the review screen (Task 7) so that no proposal kind can be produced before the surface that can answer it exists. That sequence is how the blast radius gets contained rather than reduced.

- [ ] **Step 1: Write the failing generator test**

Create `apps/web/src/lib/proposals/generate.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { generateProposals } from "./generate";
import type { TranscriptEvent } from "@bis/db";

const t = (role: "caller" | "assistant", text: string): TranscriptEvent =>
  ({ role, text, at: "2026-09-18T12:00:00.000Z" });

const transcript: TranscriptEvent[] = [
  t("assistant", "Thanks for calling 956 Woodworks. How can I help?"),
  t("caller", "I need a quote for a dining table. Call me Tuesday morning."),
];

function modelReturning(content: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify(content) } }],
  }), { status: 200 })) as unknown as typeof fetch;
}

function fakeDb() {
  const inserted: any[] = [];
  const db: any = {
    inserted,
    from: () => ({
      insert: (row: any) => {
        inserted.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "p1" }, error: null }) }) };
      },
    }),
  };
  return db;
}

const base = {
  accountId: "acct", callId: "call1", contactId: null,
  outcome: "lead" as const, transcript, handoffRequested: false,
};

describe("generateProposals", () => {
  it("writes a grounded task proposal", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db,
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "Send a dining table quote",
                      dueAt: null, evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(1);
    expect(db.inserted).toHaveLength(1);
    expect(db.inserted[0].kind).toBe("task");
    expect(db.inserted[0].evidence).toBe("Call me Tuesday morning");
  });

  // THE CENTRAL SAFETY PROPERTY. A model that invents a quote must produce
  // NOTHING, not a proposal a human might believe.
  it("DROPS a proposal whose evidence is not in the transcript (mutation: skip the isGrounded call -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db,
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "Call Thursday",
                      dueAt: null, evidence: "Call me Thursday morning" }],
      }),
    });
    expect(n).toBe(0);
    expect(db.inserted).toEqual([]);
  });

  it("proposes nothing for an ineligible call, and does NOT call the model at all (mutation: move the eligibility check after the fetch -> FAILS)", async () => {
    const db = fakeDb();
    const fetchImpl = modelReturning({ proposals: [] });
    const n = await generateProposals({ ...base, db, outcome: "spam", fetchImpl });
    expect(n).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.inserted).toEqual([]);
  });

  it("returns 0 and writes nothing when the model returns unparseable content", async () => {
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "I'm afraid I can't help with that." } }],
    }), { status: 200 })) as unknown as typeof fetch;
    expect(await generateProposals({ ...base, db, fetchImpl })).toBe(0);
    expect(db.inserted).toEqual([]);
  });

  it("returns 0 when the model call fails outright, and never throws", async () => {
    const db = fakeDb();
    const fetchImpl = vi.fn(async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    await expect(generateProposals({ ...base, db, fetchImpl })).resolves.toBe(0);
    expect(db.inserted).toEqual([]);
  });

  it("caps the number of proposals per call (mutation: raise or drop MAX_PER_CALL -> FAILS)", async () => {
    const db = fakeDb();
    const many = Array.from({ length: 9 }, (_, i) => ({
      kind: "task", title: `Task ${i}`, dueAt: null,
      evidence: "Call me Tuesday morning",
    }));
    const n = await generateProposals({ ...base, db, fetchImpl: modelReturning({ proposals: many }) });
    expect(n).toBe(3);
    expect(db.inserted).toHaveLength(3);
  });

  it("ignores a kind it does not know (mutation: drop the kind allow-list -> FAILS)", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db,
      fetchImpl: modelReturning({
        proposals: [{ kind: "delete_contact", title: "Remove them",
                      dueAt: null, evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(0);
    expect(db.inserted).toEqual([]);
  });

  it("drops a proposal with a blank title even when the evidence is real", async () => {
    const db = fakeDb();
    const n = await generateProposals({
      ...base, db,
      fetchImpl: modelReturning({
        proposals: [{ kind: "task", title: "   ", dueAt: null,
                      evidence: "Call me Tuesday morning" }],
      }),
    });
    expect(n).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- generate`
Expected: FAIL — `Cannot find module './generate'`.

- [ ] **Step 3: Write generate.ts**

```ts
import { insertProposal, type CallOutcome, type TranscriptEvent } from "@bis/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isGrounded } from "./grounding";
import { callIsEligible } from "./eligibility";

/**
 * At most three per call.
 *
 * Not a cost control — a noise control. A screen that offers eight
 * questions about one phone call is a screen a client stops reading, and
 * the spec's success criterion is that most calls propose NOTHING. A model
 * that wants to say eight things has not found three good ones.
 */
const MAX_PER_CALL = 3;

const SYSTEM = [
  "You read a finished phone call and propose at most three concrete next steps.",
  "Propose nothing at all unless the caller stated something specific that needs doing.",
  "Every proposal MUST carry an `evidence` field quoting the CALLER's own words VERBATIM from the transcript.",
  "Never quote the assistant. Never paraphrase. If you cannot quote the caller, do not propose.",
  'Reply ONLY with JSON: {"proposals":[{"kind":"task","title":"...","dueAt":null,"evidence":"..."}]}',
  'If there is nothing to propose, reply {"proposals":[]}.',
].join(" ");

type RawProposal = { kind?: unknown; title?: unknown; dueAt?: unknown; evidence?: unknown };

function transcriptForModel(transcript: TranscriptEvent[]): string {
  return transcript.map((e) => `${e.role}: ${e.text}`).join("\n");
}

/**
 * Generates and stores proposals for one finished call. Returns how many
 * were written.
 *
 * NEVER THROWS, and that is the contract the caller depends on: this runs
 * in the voice lifecycle's best-effort tail, after the call row is already
 * durable. A proposal failure must change nothing about the call, its
 * transcript, its outcome or its text-back.
 */
export async function generateProposals(input: {
  db: SupabaseClient; accountId: string; callId: string;
  contactId: string | null; outcome: CallOutcome;
  transcript: TranscriptEvent[]; handoffRequested: boolean;
  fetchImpl?: typeof fetch;
}): Promise<number> {
  // BEFORE the model call, never after. An ineligible call must not cost a
  // request — and asserting that the model was not called is the only way
  // a test can tell "skipped" from "called and returned nothing".
  if (!callIsEligible({
    outcome: input.outcome, transcript: input.transcript,
    handoffRequested: input.handoffRequested,
  })) return 0;

  // Read inside the body, not at module scope: a missing key at build time
  // must never break the import (summary-service.ts:7-10's rule).
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return 0;
  const fetchImpl = input.fetchImpl ?? fetch;

  let raw: RawProposal[] = [];
  try {
    const r = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: transcriptForModel(input.transcript) },
        ],
      }),
      // Same 10s bound as the summary call. This runs after the row is
      // written so a hang cannot lose the call, but it still shares the
      // invocation's maxDuration budget.
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return 0;
    const data = await r.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return 0;
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed?.proposals)) return 0;
    raw = parsed.proposals as RawProposal[];
  } catch {
    // Unparseable content, a network failure and a timeout are all the
    // same event here: no proposals. Never a throw.
    return 0;
  }

  let written = 0;
  for (const p of raw) {
    if (written >= MAX_PER_CALL) break;
    // ALLOW-LIST, never a denylist. v1 emits `task` only; the other two
    // kinds exist in the schema but have no generator yet, and a model
    // naming one must not smuggle it past this loop.
    if (p.kind !== "task") continue;
    const title = typeof p.title === "string" ? p.title.trim() : "";
    const evidence = typeof p.evidence === "string" ? p.evidence.trim() : "";
    if (!title) continue;
    // THE BOUNDARY. A proposal that cannot cite the caller is not made —
    // not shown, not stored.
    if (!isGrounded(evidence, input.transcript)) continue;
    const dueAt = typeof p.dueAt === "string" && p.dueAt.trim() ? p.dueAt : null;
    const created = await insertProposal(input.db, input.accountId, {
      callId: input.callId, contactId: input.contactId, kind: "task",
      payload: { title, dueAt }, evidence,
    });
    if (created) written++;
  }
  return written;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- generate`
Expected: PASS, 8 tests.

- [ ] **Step 5: Prove each mutation**

Apply each mutation named in a test title; confirm the named test goes red; restore. The grounding one is the critical path — record its red output verbatim.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/proposals/generate.ts apps/web/src/lib/proposals/generate.test.ts
git commit -m "feat(web): generate grounded task proposals from a finished call"
```

---

## Task 5: Wire the generator into the lifecycle

**Files:**
- Modify: `apps/web/src/lib/voice/finish-call.ts`
- Modify: `apps/web/src/lib/voice/finish-call.test.ts`

**Interfaces:**
- Consumes: `generateProposals` (Task 4).
- Produces: no new exports. `finishCall`'s signature and `FinishResult` are unchanged.

**The placement correction — this is the whole point of the task.** The spec says generation runs "alongside the summary". That is wrong: the summary is produced at `finish-call.ts:233`, and the transcript does not become durable until `finishCallRow` resolves at `:427` (`stored = true` at `:439`). Proposals must be generated **after `stored = true`**, and only when `stored` is true.

- [ ] **Step 1: Write the failing test**

Add to `apps/web/src/lib/voice/finish-call.test.ts`:

```ts
it("generates proposals only AFTER the call row is stored (mutation: move the call above finishCallRow -> FAILS)", async () => {
  const order: string[] = [];
  // ... existing harness setup for a lead-outcome call ...
  // Stub finishCallRow to record when it ran, and generateProposals likewise.
  // Assert the recorded order is exactly ["finishCallRow", "generateProposals"].
  expect(order).toEqual(["finishCallRow", "generateProposals"]);
});

it("writes no proposals when the call row was never stored (callRowId null)", async () => {
  // startCallRow fail-opened, so meta.callRowId is null and no row exists.
  // A proposal keyed on a persisted transcript must produce nothing.
  expect(generateProposalsSpy).not.toHaveBeenCalled();
});

it("a proposal failure changes nothing about the call (mutation: remove the catch -> FAILS)", async () => {
  // generateProposals rejects. finishCall must still resolve with the same
  // FinishResult it would otherwise have returned, and must not throw.
  const result = await finishCall(state, ctx, meta);
  expect(result.stored).toBe(true);
  expect(result.outcome).toBe("lead");
});
```

The implementer must fill these against the real harness already in that file — read it first and follow its existing stubbing idiom exactly rather than inventing one.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web test -- finish-call`
Expected: FAIL — `generateProposals` is never called.

- [ ] **Step 3: Add the call after the row write**

In `apps/web/src/lib/voice/finish-call.ts`, immediately after `stored = true;` (currently line 439) and before the alert-SMS carrier POST:

```ts
      // PROPOSALS, AND ONLY FROM HERE. The transcript became durable one
      // line above; before this point `state.transcript` is in-memory and a
      // proposal grounded in it would cite a call nobody can open. The spec
      // said "alongside the summary" — that is ~194 lines and four legs
      // earlier, and would have grounded every proposal in unpersisted
      // state.
      //
      // Swallowed on purpose, and this is the contract, not caution: a call
      // is a record, proposals are an opinion about it. Nothing here may
      // change the call's outcome, its text-back, or this function's
      // never-throws guarantee.
      try {
        const { generateProposals } = await import("@/lib/proposals/generate");
        const n = await generateProposals({
          db: ctx.db, accountId: ctx.accountId, callId: meta.callRowId,
          contactId, outcome, transcript: state.transcript,
          handoffRequested: state.served.includes("transferred"),
        });
        if (n > 0) console.log(`proposals: wrote ${n} for call ${meta.callRowId}`);
      } catch (e) {
        console.error(`proposals: generation failed for call ${meta.callRowId}: ${String(e)}`);
      }
```

Note: `contactId` is the local already resolved earlier in `finishCall` for the lead leg — the implementer must confirm the exact local name in scope at that point and use it, not re-resolve.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter web test -- finish-call`
Expected: PASS, including the three new tests.

- [ ] **Step 5: Prove the ordering mutation**

Move the block above the `finishCallRow` await. Confirm **"generates proposals only AFTER the call row is stored"** goes red. Restore.

- [ ] **Step 6: Run the whole voice suite**

Run: `pnpm --filter web test -- voice`
Expected: PASS. The lifecycle is the most-guarded area of this codebase; a regression here is the one that costs a real call.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/voice/finish-call.ts apps/web/src/lib/voice/finish-call.test.ts
git commit -m "feat(voice): propose next steps once the call is on the record"
```

---

## Task 6: Accept and dismiss — the server actions

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.test.ts`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `getProposal`, `markProposalDecided` (Task 2); `addTask`, `fillContactBlanks`, `moveOpportunityToStage`.
- Produces:

```ts
export type ActionResult = { ok: true } | { ok: false; error: string };
export async function acceptProposal(accountId: string, callId: string, proposalId: string): Promise<ActionResult>;
export async function dismissProposal(accountId: string, callId: string, proposalId: string): Promise<ActionResult>;
```

**Binding design points:**
1. `requireAccountAccess` — **not** the agency-only variant. Both audiences act (spec §Screens).
2. Accept routes through the existing human write paths. **Never a bespoke insert.**
3. **Decide FIRST, then write.** `markProposalDecided` is a compare-and-swap (`.eq("status","pending")`); if it returns false, another reviewer already answered and this action must do nothing. Doing the CRM write first would let a double-click create two tasks.
4. `fillContactBlanks` IS the accept-time re-check for `contact_field` — it writes only still-empty columns and returns what it wrote. An empty return means a human filled the field in between, and the action reports that.
5. For `opportunity_stage`, re-read the opportunity's current `stage_id` and refuse if it no longer equals `fromStageId`.

- [ ] **Step 1: Add copy keys**

In `apps/web/src/lib/messages.ts`, before the closing `} as const;`:

```ts
  "proposals.heading": "Suggested next steps",
  "proposals.subhead": "From this call. Nothing happens until you accept.",
  "proposals.evidence": "Because the caller said",
  "proposals.accept": "Accept",
  "proposals.dismiss": "Dismiss",
  "proposals.status.pending": "Suggested",
  "proposals.status.accepted": "Accepted",
  "proposals.status.dismissed": "Dismissed",
  "proposals.accepted.toast": "Added to your to-do list",
  "proposals.dismissed.toast": "Dismissed",
  "proposals.empty.title": "Nothing to suggest from this call",
  "proposals.empty.body":
    "When a caller asks for something specific — a quote, a callback, a time — it shows up here as a suggestion you can accept in one click.",
  "proposals.gone": "Someone already answered this one.",
  "proposals.contactFilled":
    "That detail was already filled in, so nothing was changed.",
  "proposals.stageMoved":
    "This opportunity has moved since the suggestion was made, so nothing was changed.",
  "proposals.failed": "That didn't go through. Try again.",
  "proposals.work.heading": "Suggestions",
  "proposals.work.body": "Questions about work, not work yet.",
```

Every string passes the "landscaper at 7 AM" read: no jargon, no `{{template}}`, no milestone labels.

- [ ] **Step 2: Write the failing action tests**

Create `actions.test.ts` covering, each named for the property and each proven by mutation:

```ts
describe("acceptProposal", () => {
  it("creates a task through addTask, not a direct insert (mutation: replace addTask with a raw insert -> the task.created event assertion FAILS)", async () => {
    // Accept a pending `task` proposal.
    // Assert: a tasks row exists AND an events row of type "task.created"
    // exists. The event is what proves the trusted path ran — a bespoke
    // insert would produce the row but not the event.
  });

  it("marks the proposal accepted", async () => { /* status === "accepted", decidedBy === the Clerk user id */ });

  it("refuses a proposal another reviewer already answered, and writes NOTHING (mutation: drop the markProposalDecided return check -> FAILS)", async () => {
    // Decide it first, then accept. Expect { ok:false, error: m["proposals.gone"] }
    // and assert the tasks table is unchanged.
  });

  it("decides BEFORE it writes, so a double accept creates ONE task (mutation: swap the order -> FAILS)", async () => {
    // Fire acceptProposal twice concurrently; exactly one task row.
  });

  it("fills only a blank contact field, and says so when the field filled in between (mutation: swap fillContactBlanks for updateContact -> FAILS)", async () => {
    // Pre-fill contact.email by hand, then accept a contact_field email
    // proposal. Expect { ok:false, error: m["proposals.contactFilled"] } and
    // the hand-typed value untouched.
  });

  it("refuses an opportunity stage move whose fromStage no longer holds (mutation: drop the re-read -> FAILS)", async () => {
    // Move the opportunity, then accept. Expect m["proposals.stageMoved"]
    // and the stage unchanged.
  });

  it("refuses a proposal belonging to another account", async () => { /* ... */ });
});

describe("dismissProposal", () => {
  it("keeps the row and marks it dismissed, never deletes it (mutation: change to a delete -> FAILS)", async () => {
    // The row must still be readable with status "dismissed": it is the
    // only evidence the feature offered something and a human declined.
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter web test -- calls/\\[callId\\]/actions`
Expected: FAIL — module not found.

- [ ] **Step 4: Write actions.ts**

```ts
"use server";

import { revalidatePath } from "next/cache";
import {
  getProposal, markProposalDecided, addTask, fillContactBlanks,
  moveOpportunityToStage,
  type ContactFieldPayload, type OpportunityStagePayload, type TaskPayload,
} from "@bis/db";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";

export type ActionResult = { ok: true } | { ok: false; error: string };

function callPath(accountId: string, callId: string): string {
  return `/dashboard/accounts/${accountId}/calls/${callId}`;
}

export async function acceptProposal(
  accountId: string, callId: string, proposalId: string,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const db = await dbForRequest();

  try {
    const proposal = await getProposal(db, accountId, proposalId);
    if (!proposal || proposal.status !== "pending") {
      return { ok: false, error: m["proposals.gone"] };
    }

    // For `opportunity_stage` ONLY, the world-still-holds check has to run
    // before the decide: `moveOpportunityToStage` validates that the target
    // is in the pipeline but NOT that the opportunity is still where the
    // proposal thought it was, and a stage that moved while this sat is a
    // proposal about a world that no longer exists.
    if (proposal.kind === "opportunity_stage") {
      const p = proposal.payload as OpportunityStagePayload;
      const { data, error } = await db.from("opportunities")
        .select("stage_id").eq("account_id", accountId).eq("id", p.opportunityId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data || data.stage_id !== p.fromStageId) {
        return { ok: false, error: m["proposals.stageMoved"] };
      }
    }

    // DECIDE FIRST. This is a compare-and-swap on `status = 'pending'`, so
    // two reviewers racing produce exactly one winner. Writing the CRM
    // record first and stamping afterwards would let a double-click create
    // two tasks and then stamp one row twice.
    if (!await markProposalDecided(db, accountId, proposalId, "accepted", userId)) {
      return { ok: false, error: m["proposals.gone"] };
    }

    // THE EXISTING WRITE PATHS, always. Every validation, RLS policy,
    // dedupe key and event emission applies because these are the same
    // functions a human action calls. A second write path would be a second
    // set of rules to keep in step, and the one that skipped a check would
    // be the one the machine uses.
    if (proposal.kind === "task") {
      const p = proposal.payload as TaskPayload;
      await addTask(db, accountId, {
        contactId: proposal.contactId ?? undefined,
        title: p.title, dueAt: p.dueAt ?? undefined,
      }, userId);
    } else if (proposal.kind === "contact_field") {
      const p = proposal.payload as ContactFieldPayload;
      if (!proposal.contactId) return { ok: false, error: m["proposals.failed"] };
      // fillContactBlanks IS the re-check: it writes only columns that are
      // still empty and returns the ones it actually wrote. An empty array
      // means a human filled it in the minutes since — which is not a
      // failure, it is the guard working.
      const written = await fillContactBlanks(
        db, accountId, proposal.contactId, { [p.field]: p.value }, userId,
      );
      if (written.length === 0) return { ok: false, error: m["proposals.contactFilled"] };
    } else {
      const p = proposal.payload as OpportunityStagePayload;
      await moveOpportunityToStage(db, accountId, p.opportunityId, p.toStageId, userId);
    }
  } catch (e) {
    console.error(`acceptProposal: failed for ${proposalId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["proposals.failed"] };
  }

  revalidatePath(callPath(accountId, callId));
  revalidatePath("/dashboard/work");
  return { ok: true };
}

export async function dismissProposal(
  accountId: string, callId: string, proposalId: string,
): Promise<ActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    // The row is KEPT with status 'dismissed', never deleted: it is the
    // only evidence the feature offered something and a human declined, it
    // is what a future accuracy measurement is computed from, and a deleted
    // row means the next pass proposes the same thing again.
    if (!await markProposalDecided(await dbForRequest(), accountId, proposalId, "dismissed", userId)) {
      return { ok: false, error: m["proposals.gone"] };
    }
  } catch (e) {
    console.error(`dismissProposal: failed for ${proposalId} (account ${accountId}): ${String(e)}`);
    return { ok: false, error: m["proposals.failed"] };
  }
  revalidatePath(callPath(accountId, callId));
  revalidatePath("/dashboard/work");
  return { ok: true };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm --filter web test -- calls/\\[callId\\]/actions`
Expected: PASS.

- [ ] **Step 6: Prove every mutation**

Each test title names its mutation. Apply, confirm red **by name**, restore. The double-accept ordering test and the `fillContactBlanks` substitution are the two that matter most — record both red outputs.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.ts" \
        "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.test.ts" \
        apps/web/src/lib/messages.ts
git commit -m "feat(web): accept a proposal through the path a human already uses"
```

---

## Task 7: The call-detail proposals block

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/proposals.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/proposal-actions.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/page.tsx`

**Interfaces:**
- Consumes: `listProposalsForCall` (Task 2), `acceptProposal`/`dismissProposal` (Task 6).
- Produces: `<CallProposals proposals={...} accountId={...} callId={...} />`.

**Binding conventions** (verified against source):
- Section wrapper is `CARD` / `CARD_HEAD` as already defined at `page.tsx:36` and `:41-42`.
- **No section at all when there are no proposals** — the page already establishes this at `:255-257` ("a heading over nothing reads as a summary that said nothing"). The empty state belongs on the work queue, not here.
- Server actions are passed to the client boundary **as props**, never imported into the client file — the `work-row-actions.tsx:4-8` rule.
- Status chip follows `BUCKET_TREATMENT`'s pattern (own map + `Badge variant="chip"`), **not** `OutcomePill`, which is keyed to `CallOutcome`.
- Dot **+ word**, never colour alone.
- The read is best-effort: wrap it in `.catch()` and degrade this block to absent, exactly as `page.tsx:90-100` does for the text-back panel.

- [ ] **Step 1: Write proposals.tsx**

Render one `<section aria-labelledby="call-proposals" className={CARD}>` containing, per proposal: the status chip (dot + word), the proposal in plain language, the evidence span prefixed with `m["proposals.evidence"]` and visually quoted, and the Accept/Dismiss pair. For an `opportunity_stage` proposal, render **`fromStage → toStage` by name, never the destination alone**, and when the move skips more than one position in `pipeline_stages.position` order, say so in words.

Place it in `page.tsx`'s main column immediately after the Summary section (`:258-269`) and before the Transcript (`:271`) — the evidence spans read against the transcript directly below.

- [ ] **Step 2: Write proposal-actions.tsx**

`"use client"` at file top. `useTransition` to disable both buttons while pending. On success, `toast.success(m["proposals.accepted.toast"])`. **No undo toast** — accepting creates a real record and dismissal is terminal-by-design, matching the booking close-out posture at `work-row-actions.tsx:19-21`. On `{ ok: false }`, `toast.error(result.error)`.

- [ ] **Step 3: Run the design reviewer**

Dispatch `bis-design-reviewer` against the diff. It must confirm: tokens only; both themes via the `.dark` class; the blur fallback; focus ring visible; Esc behaviour unaffected; copy passes the 7 AM read; `/styleguide` updated if a new variant was added.

- [ ] **Step 4: Run the web suite**

Run: `pnpm --filter web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/"
git commit -m "feat(web): show a call's suggestions next to the words that caused them"
```

---

## Task 8: Generate `contact_field` proposals

**Files:**
- Modify: `apps/web/src/lib/proposals/generate.ts`
- Modify: `apps/web/src/lib/proposals/generate.test.ts`

**Interfaces:**
- Consumes: `isGrounded` (Task 3), `insertProposal` (Task 2).
- Produces: no new exports. `generateProposals` gains a `contact_field` branch and one new input field:

```ts
// added to generateProposals' input
blankFields: readonly ("firstName" | "lastName" | "email" | "phone")[];
```

**The containment rule, restated because it is the whole task:** a `contact_field` proposal may only target a field that is **currently empty**. Never a value a human typed. The generator is told which fields are blank and may propose no others — it is not trusted to check, because it cannot see the contact row.

- [ ] **Step 1: Write the failing tests**

Add to `generate.test.ts`:

```ts
it("proposes a contact field that is currently blank", async () => {
  const db = fakeDb();
  const n = await generateProposals({
    ...base, db, contactId: "c1", blankFields: ["email"],
    fetchImpl: modelReturning({
      proposals: [{ kind: "contact_field", field: "email",
                    value: "sam@example.com",
                    evidence: "my email is sam at example dot com" }],
    }),
  });
  expect(n).toBe(1);
  expect(db.inserted[0].kind).toBe("contact_field");
  expect(db.inserted[0].payload).toEqual({ field: "email", value: "sam@example.com" });
});

// THE CONTAINMENT BOUNDARY. A wrong fill into an empty field costs a
// correction; a wrong OVERWRITE destroys something a person typed and is
// unrecoverable from the UI.
it("NEVER proposes a field that is not blank, even when the model asks (mutation: drop the blankFields filter -> FAILS)", async () => {
  const db = fakeDb();
  const n = await generateProposals({
    ...base, db, contactId: "c1", blankFields: [],   // nothing is blank
    fetchImpl: modelReturning({
      proposals: [{ kind: "contact_field", field: "email",
                    value: "attacker@example.com",
                    evidence: "my email is sam at example dot com" }],
    }),
  });
  expect(n).toBe(0);
  expect(db.inserted).toEqual([]);
});

it("refuses a field outside the allow-list (mutation: drop the field allow-list -> FAILS)", async () => {
  const db = fakeDb();
  // `custom`, tags and consent flags are out of scope by design — consent
  // in particular is a legal record, not a convenience.
  const n = await generateProposals({
    ...base, db, contactId: "c1", blankFields: ["email"],
    fetchImpl: modelReturning({
      proposals: [{ kind: "contact_field", field: "consent", value: "true",
                    evidence: "my email is sam at example dot com" }],
    }),
  });
  expect(n).toBe(0);
});

it("proposes no contact field when the call resolved no contact", async () => {
  const db = fakeDb();
  const n = await generateProposals({
    ...base, db, contactId: null, blankFields: ["email"],
    fetchImpl: modelReturning({
      proposals: [{ kind: "contact_field", field: "email", value: "sam@example.com",
                    evidence: "my email is sam at example dot com" }],
    }),
  });
  expect(n).toBe(0);
});

it("still requires grounding for a contact field (mutation: skip isGrounded on this branch -> FAILS)", async () => {
  const db = fakeDb();
  const n = await generateProposals({
    ...base, db, contactId: "c1", blankFields: ["email"],
    fetchImpl: modelReturning({
      proposals: [{ kind: "contact_field", field: "email", value: "sam@example.com",
                    evidence: "he gave me his email" }],   // not in the transcript
    }),
  });
  expect(n).toBe(0);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter web test -- generate`
Expected: FAIL — `contact_field` is currently skipped by the `p.kind !== "task"` allow-list.

- [ ] **Step 3: Extend generate.ts**

Add to the module:

```ts
const CONTACT_FIELDS = ["firstName", "lastName", "email", "phone"] as const;
type ContactField = (typeof CONTACT_FIELDS)[number];
```

Extend `SYSTEM` with a sentence naming only the blank fields, built per call:

```ts
function systemFor(blankFields: readonly ContactField[]): string {
  const base = SYSTEM;
  if (blankFields.length === 0) return base;
  return `${base} You may also propose {"kind":"contact_field","field":"<one of: ${
    blankFields.join(", ")
  }>","value":"...","evidence":"..."} — but ONLY for those fields, and only when the caller stated the value out loud.`;
}
```

Replace the allow-list line with a per-kind branch. The `contact_field` branch:

```ts
    if (p.kind === "contact_field") {
      // THE MODEL IS NOT TRUSTED TO CHECK — it cannot see the contact row.
      // `blankFields` is computed from the stored contact by the caller, and
      // a field absent from it is refused here regardless of what the model
      // asked for. This is the propose-time half of Containment 2; the
      // accept-time half is `fillContactBlanks`, which re-checks atomically
      // because a human may have filled the field in between.
      const field = typeof p.field === "string" ? p.field as ContactField : null;
      const value = typeof p.value === "string" ? p.value.trim() : "";
      if (!field || !CONTACT_FIELDS.includes(field)) continue;
      if (!input.blankFields.includes(field)) continue;
      if (!value || !input.contactId) continue;
      if (!isGrounded(evidence, input.transcript)) continue;
      const created = await insertProposal(input.db, input.accountId, {
        callId: input.callId, contactId: input.contactId, kind: "contact_field",
        payload: { field, value }, evidence,
      });
      if (created) written++;
      continue;
    }
```

- [ ] **Step 4: Compute `blankFields` at the call site**

In `apps/web/src/lib/voice/finish-call.ts`, before calling `generateProposals`, read the resolved contact's four allow-listed columns and pass the empty ones. When `contactId` is null, pass `[]`. Wrap the read in the same try/catch — a failure here means `[]`, never a throw.

- [ ] **Step 5: Run to verify they pass, then prove every mutation**

Run: `pnpm --filter web test -- generate`
Expected: PASS. Then apply each named mutation and confirm the named test goes red. The `blankFields` filter is the critical one — record its red output verbatim.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/proposals/generate.ts apps/web/src/lib/proposals/generate.test.ts \
        apps/web/src/lib/voice/finish-call.ts
git commit -m "feat(web): propose a contact detail only where the record is blank"
```

---

## Task 9: Generate `opportunity_stage` proposals

**Files:**
- Modify: `apps/web/src/lib/proposals/generate.ts`
- Modify: `apps/web/src/lib/proposals/generate.test.ts`

**Interfaces:**
- Produces: `generateProposals` gains an `opportunity_stage` branch and one new input field:

```ts
// added to generateProposals' input
openOpportunity: {
  id: string; stageId: string; stageName: string;
  stages: readonly { id: string; name: string; position: number }[];
} | null;
```

**This is the largest blast radius on the board** — Resaca has sixteen opportunities and a wrong stage move rewrites a sales pipeline on the account with the most to lose. The generator therefore never invents a stage: it is handed the opportunity's real pipeline and may only name a stage from it.

- [ ] **Step 1: Write the failing tests**

```ts
const pipeline = {
  id: "o1", stageId: "s1", stageName: "New Lead",
  stages: [
    { id: "s1", name: "New Lead", position: 0 },
    { id: "s2", name: "Contacted", position: 1 },
    { id: "s3", name: "Appointment", position: 2 },
    { id: "s4", name: "Quote Sent", position: 3 },
  ],
};

it("proposes a stage move, recording where it came FROM as well as to", async () => {
  const db = fakeDb();
  const n = await generateProposals({
    ...base, db, openOpportunity: pipeline,
    fetchImpl: modelReturning({
      proposals: [{ kind: "opportunity_stage", toStage: "Contacted",
                    evidence: "I need a quote for a dining table" }],
    }),
  });
  expect(n).toBe(1);
  // fromStageId is stored so the review screen can show the MOVE, and so an
  // accept can refuse a proposal whose starting point has since changed.
  expect(db.inserted[0].payload).toEqual({
    opportunityId: "o1", fromStageId: "s1", toStageId: "s2",
  });
});

it("refuses a stage that is not in this opportunity's pipeline (mutation: drop the stage lookup -> FAILS)", async () => {
  const db = fakeDb();
  const n = await generateProposals({
    ...base, db, openOpportunity: pipeline,
    fetchImpl: modelReturning({
      proposals: [{ kind: "opportunity_stage", toStage: "Closed Won",
                    evidence: "I need a quote for a dining table" }],
    }),
  });
  expect(n).toBe(0);
});

// A machine must not walk an opportunity BACKWARDS through a pipeline. A
// human can; this feature may not, because the evidence for a regression is
// almost never in one phone call.
it("refuses a backwards move (mutation: drop the position comparison -> FAILS)", async () => {
  const db = fakeDb();
  const n = await generateProposals({
    ...base, db,
    openOpportunity: { ...pipeline, stageId: "s4", stageName: "Quote Sent" },
    fetchImpl: modelReturning({
      proposals: [{ kind: "opportunity_stage", toStage: "Contacted",
                    evidence: "I need a quote for a dining table" }],
    }),
  });
  expect(n).toBe(0);
});

it("refuses a move to the stage it is already in", async () => {
  const db = fakeDb();
  const n = await generateProposals({
    ...base, db, openOpportunity: pipeline,
    fetchImpl: modelReturning({
      proposals: [{ kind: "opportunity_stage", toStage: "New Lead",
                    evidence: "I need a quote for a dining table" }],
    }),
  });
  expect(n).toBe(0);
});

it("proposes no stage move when the contact has no open opportunity", async () => {
  const db = fakeDb();
  const n = await generateProposals({
    ...base, db, openOpportunity: null,
    fetchImpl: modelReturning({
      proposals: [{ kind: "opportunity_stage", toStage: "Contacted",
                    evidence: "I need a quote for a dining table" }],
    }),
  });
  expect(n).toBe(0);
});
```

- [ ] **Step 2: Run to verify they fail, then implement**

Add the branch:

```ts
    if (p.kind === "opportunity_stage") {
      const opp = input.openOpportunity;
      if (!opp) continue;
      const toName = typeof p.toStage === "string" ? p.toStage.trim().toLowerCase() : "";
      // NAMED FROM THE REAL PIPELINE, never invented. The model is given
      // this account's own stage names and may only pick one of them;
      // anything else is dropped rather than fuzzy-matched.
      const target = opp.stages.find((s) => s.name.trim().toLowerCase() === toName);
      const current = opp.stages.find((s) => s.id === opp.stageId);
      if (!target || !current) continue;
      // FORWARD ONLY. A single phone call is evidence that a deal advanced;
      // it is almost never evidence that it went backwards, and a machine
      // that can retreat a pipeline can undo a human's read of a customer.
      if (target.position <= current.position) continue;
      if (!isGrounded(evidence, input.transcript)) continue;
      const created = await insertProposal(input.db, input.accountId, {
        callId: input.callId, contactId: input.contactId, kind: "opportunity_stage",
        payload: { opportunityId: opp.id, fromStageId: current.id, toStageId: target.id },
        evidence,
      });
      if (created) written++;
      continue;
    }
```

Extend `systemFor` to name the real stage names when `openOpportunity` is present.

- [ ] **Step 3: Resolve the open opportunity at the call site**

In `finish-call.ts`, when `contactId` is non-null, read the contact's single open (`status = 'open'`) opportunity plus its pipeline's stages ordered by `position`. More than one open opportunity → pass `null`: the call does not say which one it is about, and guessing is exactly the failure this feature must not produce. Failure of the read → `null`.

- [ ] **Step 4: Verify, prove every mutation, commit**

Run: `pnpm --filter web test -- generate`
Expected: PASS. Apply each named mutation, confirm red by name. The backwards-move and pipeline-membership mutations are the two that matter most.

```bash
git add apps/web/src/lib/proposals/generate.ts apps/web/src/lib/proposals/generate.test.ts \
        apps/web/src/lib/voice/finish-call.ts
git commit -m "feat(web): propose a stage move forward, from this pipeline only"
```

---

## Task 10: Proposals on the work queue

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/work/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/work/agency-work-list.tsx`

**Interfaces:**
- Consumes: `listPendingProposals` (Task 2).
- Produces: `listPendingProposalsForAgency(db: SupabaseClient): Promise<(CallProposal & { brandName: string })[]>` in `packages/db/src/call-proposals.ts`, exported from the barrel.
  It lives here rather than in Task 2 because `/dashboard/work` is the AGENCY screen and `listAgencyWork(db)` takes no `accountId` — it is inherently cross-tenant. Copy `listAgencyWork`'s own accounts-join shape (`work-queue.ts:190-231`) rather than inventing one, and give it the same `.limit()` backstop the other reads carry.

**Binding constraint:** `Bucket` and `BucketedWork` (`lib/work/buckets.ts:4-5`) are a pinned, tested union reused verbatim by `agency-buckets.ts`. **Do not add a fourth key.** Proposals are a separate data prop rendered as a sibling `<section>` inside the existing `flex flex-col gap-6` wrapper, above or below the buckets but visually separated and labelled `m["proposals.work.heading"]`.

- [ ] **Step 1: Write the failing test**

Assert, each by mutation:
- Pending proposals render in their own section, labelled as suggestions.
- **Proposals never appear in Overdue/Today/Waiting** — mutation: push a proposal into `bucketWork`'s output and confirm the test fails.
- **`bucketWork`, the dashboard work row and `listAgencyWork` counts are unchanged by the presence of proposals** — the same no-contamination proof `screened_calls` carries. Seed proposals, assert every one of those three numbers is identical to the no-proposals baseline.
- The read failing degrades to no section, never a broken page.

- [ ] **Step 2: Run to verify it fails, then implement, then verify it passes**

Run: `pnpm --filter web test -- work`

- [ ] **Step 3: Prove the contamination mutation**

⚠️ **Read the ledger's warning before writing this fixture.** The `screened_calls` equivalent of this test proved nothing for two weeks because its fixture used a column shape the contamination mutation could not produce. Here the trap is the same: seed proposals that are **realistic** — a real `account_id`, a real `call_id`, a real `contact_id` on at least one — and inject the mutation to confirm the guard turns red *by name*. A fixture whose rows the mutation cannot create is a green test that proves nothing.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/work/
git commit -m "feat(web): suggestions sit beside the work queue, never inside it"
```

---

## Task 11: e2e, spec correction, and the gates

**Files:**
- Create: `apps/web/e2e/call-proposals.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-18-call-proposals-design.md`

- [ ] **Step 1: Correct the spec**

Fix the five wrong names (`createTask`→`addTask`, `setOpportunityStage`→`moveOpportunityToStage`, the contact update action→`fillContactBlanks`, `outcomeOf`→`classifyOutcome`) and rewrite the placement sentence at spec line 172 from "alongside the summary" to "after `finishCallRow` succeeds — the summary runs ~194 lines earlier, before the transcript is durable". Add a line recording that `fillContactBlanks` already implements Containment 2.

- [ ] **Step 2: Write the e2e spec**

On the **per-run fixture account** only. Never `Test Client One`, never a live account. Seed a call with a transcript and a pending proposal through the service client; open the call detail page; assert the proposal and its evidence render; click Accept; assert the task appears on the work queue and the proposal reads Accepted.

- [ ] **Step 3: Run the gates, one at a time, reading exit codes from files**

```bash
pnpm check                      # typecheck + lint + db + web tests
pnpm --filter web build
pnpm --filter web test:e2e
```

All three must be EXIT 0. Report the real numbers.

- [ ] **Step 4: Commit and open the PR**

Do **not** merge until both `verify` and `e2e` are green **on the PR's current head commit** — read the check runs directly; never infer from an earlier run. Never push to `main`.

---

## Self-review

**Spec coverage:** Data ✓ T1. Payload shapes ✓ T2. RLS/grants ✓ T1. Containment 1 (grounding) ✓ T3/T4, re-proved per kind in T8/T9. Containment 2 (fill a blank) ✓ T8 at propose time, T6 at accept time via `fillContactBlanks`. Containment 3 (stage move shown + starting point verified) ✓ T9 propose-side, T6 accept-side, T7 display-side. Containment 4 (existing write path) ✓ T6. Containment 5 (dismissal recorded) ✓ T6. Generation location ✓ T5. "Most calls propose nothing" ✓ T3. Screens ✓ T7/T10. Every test the spec lists ✓ across T1–T10. Out-of-scope items (forms/SMS/email sources, auto-accept, editing before accept, custom fields, tags, consent, assignment, live-call behaviour) are absent by construction.

**Full scope, all three kinds.** `task` (T4), `contact_field` (T8) and `opportunity_stage` (T9) all ship with generators, accept paths, tests and UI. The kinds are sequenced after the accept path and review screen so no proposal can be produced before the surface that answers it exists — containment through ordering, not through reduction.

**Two properties the plan adds beyond the spec, both narrowing the machine's reach:**
- A `contact_field` proposal is refused at propose time for any field not in the caller-supplied `blankFields`, because the model cannot see the contact row and must not be trusted to check.
- An `opportunity_stage` proposal may only move **forward** through the pipeline. One phone call is evidence a deal advanced; it is almost never evidence it regressed, and a machine that can retreat a pipeline can undo a human's read of a customer. A human retains full freedom to move a stage either way.

**One property the spec asks for that the schema cannot enforce, stated plainly:** "accept refuses if the stage moved while the proposal sat" is a read-then-write in `acceptProposal`, not a database constraint, so a stage change landing between the read and `moveOpportunityToStage` would not be caught. The window is milliseconds and the failure is a single stage move a human can see and undo. Closing it properly needs a conditional update inside `moveOpportunityToStage`, which is a change to a shared human write path and is out of scope here.
