# Contact Dedupe Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `findDuplicate` scanning the whole account on every insert, and make the two-different-matches case visible instead of silent.

**Architecture:** Two stored generated columns on `contacts` (`phone_key`, `email_key`) with indexes turn the dedupe scan into two indexed lookups. Both lookups then always run, so when an incoming contact's email matches one record and its phone matches another, the pair is written to a new `contact_duplicate_flags` table instead of being silently discarded.

**Tech Stack:** Postgres/Supabase (generated columns, RLS), TypeScript in `packages/db`, Vitest against the real database, Next.js server action + React for the import summary.

**Spec:** `docs/superpowers/specs/2026-09-11-contact-dedupe-hardening-design.md`. Section references (§3, §5…) point at it.

## Global Constraints

- **Migrations: a separate pre-flight READ first, then apply via the Supabase MCP `apply_migration`.** Never re-run a mutating script to see its output. Record the applied migration so it is never re-applied.
- **The stored `phone` and `email` columns are never reshaped.** The keys are comparison-only. This is `phoneDigits`' existing contract and it does not change.
- **Who wins a match does not change.** Email still wins. This work changes performance and adds a flag — nothing else. An edit to an existing dedupe test is a signal to STOP and report, not to proceed.
- **`packages/db` tests hit the REAL shared database** — the same Supabase project production uses. Never point a mutating test at `Test Client One` or any live account; use the per-run fixture helpers.
- **`serviceDb` test fixtures are BLIND to column grants and RLS.** Only `userDb`/`withRollback`+`actAs` and e2e see them. Pin the SQLSTATE (`42501`), never `status >= 400`, and watch the test fail first.
- **One refused statement per `withRollback`** — the first refusal aborts the transaction and the next reports `25P02`, not its own SQLSTATE.
- **Every git/pnpm command starts from the repo root**, `C:/Users/danlo/bis-platform`. The shell's cwd persists between calls.
- **Repo is PR-only.** Never push `main`. All work lands on `feat/dedupe-hardening`.
- **Read exit codes directly.** Redirect to a file and read `$?` on its own line — never put an `echo` after a command inside a `{ }` block, which masks the real exit code.

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/supabase/migrations/0033_contact_dedupe_keys.sql` | **Create.** Generated columns, indexes, flags table, RLS. |
| `packages/db/src/contacts.ts` | **Modify.** `emailKey`, `findDuplicate` rewrite, flag write in `createContact`. |
| `packages/db/src/test/contact-dedupe-keys.test.ts` | **Create.** SQL↔TS parity for both keys. |
| `packages/db/src/test/contacts.test.ts` | **Modify.** The four match cases and flag idempotence. |
| `apps/web/src/lib/messages.ts` | **Modify.** One string. |
| `apps/web/.../contacts/import/import-wizard.tsx` | **Modify.** Accumulate and show `flagged`. |

---

### Task 1: Migration 0033 and the key parity test

**Files:**
- Create: `packages/db/supabase/migrations/0033_contact_dedupe_keys.sql`
- Modify: `packages/db/src/contacts.ts` (add `emailKey`)
- Test: `packages/db/src/test/contact-dedupe-keys.test.ts`

**Interfaces:**
- Consumes: the existing exported `phoneDigits(value: string): string` from `packages/db/src/contacts.ts`.
- Produces: `contacts.phone_key` and `contacts.email_key` (both `text`, nullable), the table `public.contact_duplicate_flags`, and an exported `emailKey(value: string): string`.

- [ ] **Step 1: Pre-flight READ, separate from any write**

Using the Supabase MCP `execute_sql` against project `tlbkbmlrfafquucsmsmm`, confirm the starting state. Do NOT apply anything in this step.

```sql
select
  (select count(*) from supabase_migrations.schema_migrations where version like '0033%') as m0033,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='contacts'
       and column_name in ('phone_key','email_key')) as new_cols,
  (select count(*) from information_schema.tables
     where table_schema='public' and table_name='contact_duplicate_flags') as flags_table;
```

Expected: `m0033=0`, `new_cols=0`, `flags_table=0`. **If any is non-zero, STOP and report** — the migration is partly or fully applied and re-applying it is the one thing this repo's rules forbid outright.

Also read the RLS policy you will copy, rather than inventing one:

```sql
select polname, pg_get_expr(polqual, polrelid) as using_expr,
       pg_get_expr(polwithcheck, polrelid) as check_expr
from pg_policy where polrelid = 'public.notes'::regclass;
```

`notes` is the model: it is account-scoped exactly as the flags table will be. Record what it returns — you will mirror its shape.

- [ ] **Step 2: Write the failing test**

Create `packages/db/src/test/contact-dedupe-keys.test.ts`. This asserts the database's generated columns agree with the TypeScript twins, input by input — the whole defence against the two implementations drifting (spec §4.1).

```ts
import { describe, expect, it } from "vitest";
import { serviceDb } from "../client";
import { phoneDigits, emailKey } from "../contacts";
import { withTestAccount } from "./helpers";

// Real shapes this database actually holds. "(956) 292-1696" is the majority
// operator-entered shape; "+19562921696" is what toE164 and inbound SMS
// produce. They are the same ten digits and MUST produce the same key — that
// equivalence is the entire reason phoneDigits exists.
const PHONES = [
  "(956) 292-1696",
  "+19562921696",
  "956-292-1696",
  "19562921696",
  "9562921696",
  "956.292.1696 x12",
  "",
];

const EMAILS = [
  "Dan@Example.com",
  "  dan@example.com  ",
  "dan+bis@example.com",
  "dan+a+b@example.com",
  "dan@example.com",
  "",
];

describe("dedupe keys: the database and TypeScript must agree (spec §4.1)", () => {
  it("phone_key matches phoneDigits for every shape", async () => {
    const db = serviceDb();
    await withTestAccount(db, async (accountId) => {
      for (const phone of PHONES) {
        const { data, error } = await db.from("contacts")
          .insert({ account_id: accountId, first_name: "Key", phone: phone || null })
          .select("phone_key").single();
        expect(error, `insert failed for ${JSON.stringify(phone)}`).toBeNull();
        const expected = phone ? (phoneDigits(phone) || null) : null;
        expect(data!.phone_key, `phone_key for ${JSON.stringify(phone)}`).toBe(expected);
      }
    });
  });

  it("email_key matches emailKey for every shape", async () => {
    const db = serviceDb();
    await withTestAccount(db, async (accountId) => {
      for (const email of EMAILS) {
        const { data, error } = await db.from("contacts")
          .insert({ account_id: accountId, first_name: "Key", email: email || null })
          .select("email_key").single();
        expect(error, `insert failed for ${JSON.stringify(email)}`).toBeNull();
        const expected = email ? (emailKey(email) || null) : null;
        expect(data!.email_key, `email_key for ${JSON.stringify(email)}`).toBe(expected);
      }
    });
  });

  it("the flags table refuses an unordered or duplicate pair", async () => {
    const db = serviceDb();
    await withTestAccount(db, async (accountId) => {
      const mk = async (name: string) => {
        const { data } = await db.from("contacts")
          .insert({ account_id: accountId, first_name: name }).select("id").single();
        return data!.id as string;
      };
      const [x, y] = [await mk("A"), await mk("B")].sort();
      const row = { account_id: accountId, contact_a: x, contact_b: y,
                    reason: "email_phone_conflict" };

      const first = await db.from("contact_duplicate_flags").insert(row);
      expect(first.error, "the first flag should insert").toBeNull();

      // Idempotence is a CONSTRAINT, not a convention — the same pair seen
      // twice must not accumulate rows (spec §5).
      const again = await db.from("contact_duplicate_flags").insert(row);
      expect(again.error?.code, "a repeat pair must violate the unique index").toBe("23505");

      // Ordering is a CHECK, so a caller cannot write the mirror image and
      // defeat the unique index.
      const mirror = await db.from("contact_duplicate_flags")
        .insert({ ...row, contact_a: y, contact_b: x });
      expect(mirror.error?.code, "an unordered pair must violate the check").toBe("23514");
    });
  });
});
```

If `withTestAccount` is not the helper this package uses, read `packages/db/src/test/` and use the per-run fixture helper that is there — but do **not** create contacts on a live account.

- [ ] **Step 3: Run it and watch it fail for the RIGHT reason**

```
cd C:/Users/danlo/bis-platform && pnpm --filter @bis/db exec vitest run src/test/contact-dedupe-keys.test.ts
```

Expected: FAIL — `emailKey` is not exported yet, and `phone_key` / `contact_duplicate_flags` do not exist. A failure for any *other* reason is a signal about your setup; say which you got.

- [ ] **Step 4: Write the migration file**

Create `packages/db/supabase/migrations/0033_contact_dedupe_keys.sql`:

```sql
-- 0033_contact_dedupe_keys
--
-- findDuplicate's phone fallback pulled EVERY non-null phone on the account
-- into memory and compared in JS — once per inserted contact, whenever the two
-- sides disagreed on formatting, which is the common case. At ten contacts that
-- is free; at five thousand it is five thousand full scans against the one
-- Supabase project production runs on, and the CSV import walks into it in
-- 200-row batches. These columns turn that into an indexed lookup.
--
-- Generated and STORED rather than maintained by the application, for the same
-- reason 0030 gave for sort_name: the database computes it, so the comparison
-- key cannot drift away from the value it is derived from. The source columns
-- are NOT reshaped — phone and email keep whatever shape they were entered in.
--
-- phone_key mirrors phoneDigits() in packages/db/src/contacts.ts exactly:
-- digits only, and a leading NANP 1 folded off when the result is 11 digits.
-- Two implementations of one rule drift silently, and a drifted key does not
-- throw — it just stops matching. contact-dedupe-keys.test.ts compares this
-- column against that function input by input, which is what pays for the
-- duplication.
alter table public.contacts
  add column phone_key text
  generated always as (
    case
      when length(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) = 11
       and left(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 1) = '1'
      then substr(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 2)
      else nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
    end
  ) stored;

-- email_key mirrors emailKey(): lowercased, trimmed, and `+suffix` stripped
-- from the local part. Plus-addressing is near-universal, so folding it is safe.
-- Gmail's dot-folding is deliberately NOT applied: john.smith@ and johnsmith@
-- are one mailbox AT GMAIL ONLY, and folding dots globally would match distinct
-- people at every other provider.
alter table public.contacts
  add column email_key text
  generated always as (
    nullif(regexp_replace(lower(trim(both ' ' from coalesce(email, ''))), '\+[^@]*@', '@'), '')
  ) stored;

-- Account scope first in both, matching how findDuplicate queries: every lookup
-- is `account_id = ? and <key> = ?`, never a bare key scan across tenants.
create index contacts_account_phone_key on public.contacts (account_id, phone_key);
create index contacts_account_email_key on public.contacts (account_id, email_key);

-- The work queue a merge tool will consume on the day it is built, already
-- populated — rather than having to go find duplicates itself. Written when an
-- incoming contact's email matches one record and its phone matches ANOTHER,
-- which is precisely how a duplicate gets created quietly today.
create table public.contact_duplicate_flags (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  contact_a uuid not null references public.contacts(id) on delete cascade,
  contact_b uuid not null references public.contacts(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now(),
  -- Ordering is enforced, not merely conventional: without it a caller could
  -- write the mirror image of an existing pair and defeat the unique index
  -- below, and the queue would show the same duplicate twice.
  constraint contact_duplicate_flags_ordered check (contact_a < contact_b)
);

create unique index contact_duplicate_flags_pair
  on public.contact_duplicate_flags (account_id, contact_a, contact_b);

-- Access control on these tables is RLS, not column grants. 0030's own trailing
-- note is worth re-reading here: public.contacts carries TABLE-level grants, so
-- the two new columns above need no grant of their own, and
-- information_schema.column_privileges EXPANDS a table-level grant into one row
-- per column — which is exactly how that was misread once before.
alter table public.contact_duplicate_flags enable row level security;
```

Then append the policy, mirroring what Step 1 read off `public.notes` — same account-scoping predicate, renamed for this table. Do not invent a predicate; copy the shape.

- [ ] **Step 5: Add the TypeScript twin**

In `packages/db/src/contacts.ts`, directly below `phoneDigits`, add:

```ts
/**
 * Comparison key for email dedupe, and the twin of `email_key` in migration
 * 0033. Lowercased, trimmed, and `+suffix` stripped from the local part:
 * plus-addressing is near-universal, so `dan+bis@example.com` and
 * `dan@example.com` are one mailbox.
 *
 * Gmail's dot-folding is deliberately NOT applied. `john.smith@` and
 * `johnsmith@` are the same mailbox AT GMAIL ONLY; folding dots globally would
 * match two distinct people at every other provider.
 *
 * Comparison-only — like phoneDigits, this is never written back. The stored
 * column keeps whatever the operator typed.
 */
export function emailKey(value: string): string {
  return value.trim().toLowerCase().replace(/\+[^@]*@/, "@");
}
```

- [ ] **Step 6: Apply the migration**

Apply `0033_contact_dedupe_keys` with the Supabase MCP `apply_migration` against project `tlbkbmlrfafquucsmsmm`. This is the mutating step and it happens exactly once.

- [ ] **Step 7: Run the test and watch it pass**

```
cd C:/Users/danlo/bis-platform && pnpm --filter @bis/db exec vitest run src/test/contact-dedupe-keys.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 8: Mutation-check the parity claim**

Change `phoneDigits`' fold from `digits.length === 11` to `digits.length === 12`, re-run, and confirm the parity test fails **by name** reporting the `+19562921696` case. That is the proof the test compares the real column rather than re-deriving it. Revert and re-run to green. Read the failing test's NAME — a vitest filter that matches nothing skips silently.

- [ ] **Step 9: Commit**

```
cd C:/Users/danlo/bis-platform && git add packages/db/supabase/migrations/0033_contact_dedupe_keys.sql packages/db/src/contacts.ts packages/db/src/test/contact-dedupe-keys.test.ts && git commit -m "feat(db): normalized dedupe keys, so matching stops scanning the account"
```

---

### Task 2: findDuplicate uses the keys, and both lookups always run

**Files:**
- Modify: `packages/db/src/contacts.ts` (`findDuplicate`)
- Test: `packages/db/src/test/contacts.test.ts`

**Interfaces:**
- Consumes: `phone_key` / `email_key` and `emailKey` from Task 1.
- Produces: `findDuplicate` returns `{ emailMatch: string | null; phoneMatch: string | null }` instead of `string | null`. It stays module-private — `createContact` is its only caller.

- [ ] **Step 1: Write the failing tests**

Append to `packages/db/src/test/contacts.test.ts`. These are the four cases in spec §5, plus the assertion that the scan is gone.

```ts
describe("dedupe after the key columns (spec §5)", () => {
  it("returns the email match when email and phone point at DIFFERENT contacts", async () => {
    const db = serviceDb();
    await withTestAccount(db, async (accountId) => {
      const a = await createContact(db, accountId,
        { firstName: "Email", email: "shared@example.com" }, "test");
      const b = await createContact(db, accountId,
        { firstName: "Phone", phone: "(956) 292-1696" }, "test");

      // Incoming row carries BOTH — it matches a by email and b by phone.
      const got = await createContact(db, accountId,
        { firstName: "Both", email: "shared@example.com", phone: "+19562921696" }, "test");

      // Email wins, unchanged. This is deliberate: a phone-wins rule is
      // defensible but would shift every existing caller for no present gain.
      expect(got.existing).toBe(true);
      expect(got.id).toBe(a.id);
      expect(got.id).not.toBe(b.id);
    });
  });

  // NOTE on what this file can and cannot prove. The spec's §8 asked for the
  // scan's absence to be "asserted against the query the function actually
  // makes, not by reading the source" — but "the fallback is gone" is a claim
  // about code SHAPE, and no behavioural test can see a code path that no
  // longer runs: both the old and new implementations return the same contact
  // here. Instrumenting the Supabase builder to record calls would be real
  // work for one assertion. So the deletion is pinned by a source read in the
  // next test instead, which is this repo's established instrument for exactly
  // this (northern-lights.test.ts and clerk-layer.test.ts both read files as
  // data), and the spec line is corrected to say so.
  it("matches a reformatted phone through the key", async () => {
    const db = serviceDb();
    await withTestAccount(db, async (accountId) => {
      const a = await createContact(db, accountId,
        { firstName: "Formatted", phone: "(956) 292-1696" }, "test");
      const got = await createContact(db, accountId,
        { firstName: "E164", phone: "+19562921696" }, "test");
      expect(got.existing).toBe(true);
      expect(got.id).toBe(a.id);
    });
  });

  it("no longer reads the account's phones into memory", () => {
    // The point of the whole exercise, and unobservable from behaviour — see
    // the note above. `.not("phone", "is", null)` was the fallback's tell: an
    // unfiltered read of every non-null phone on the account, once per insert.
    // If it reappears, the O(n^2) import cliff is back and every other test
    // here still passes.
    const src = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "../contacts.ts"), "utf8",
    );
    expect(src).not.toContain('.not("phone", "is", null)');
    // Guard the guard: if findDuplicate is renamed or moved out of this file,
    // the assertion above silently stops covering anything.
    expect(src).toContain("async function findDuplicate");
  });

  it("still creates a contact when nothing matches", async () => {
    const db = serviceDb();
    await withTestAccount(db, async (accountId) => {
      const a = await createContact(db, accountId,
        { firstName: "One", email: "one@example.com" }, "test");
      const b = await createContact(db, accountId,
        { firstName: "Two", email: "two@example.com" }, "test");
      expect(b.existing).toBe(false);
      expect(b.id).not.toBe(a.id);
    });
  });
});
```

- [ ] **Step 2: Run them and watch the first fail**

```
cd C:/Users/danlo/bis-platform && pnpm --filter @bis/db exec vitest run src/test/contacts.test.ts
```

Expected: the first test FAILS — today's `findDuplicate` returns on the email match and never looks at the phone, so the two-match case is indistinguishable from a plain email match and `got.id` is already `a.id`. **If it passes, that is informative, not a win**: say so, because it means the case is already covered and only the flag in Task 3 is new.

- [ ] **Step 3: Rewrite `findDuplicate`**

In `packages/db/src/contacts.ts`, replace the whole of `findDuplicate` with:

```ts
type DuplicateMatch = { emailMatch: string | null; phoneMatch: string | null };

/**
 * Both lookups ALWAYS run, and that is the change. The old version returned on
 * the email match and never looked at the phone — so an incoming contact whose
 * email matched one record and whose phone matched ANOTHER was indistinguishable
 * from a plain email match, and the second record silently stayed a duplicate.
 * That is how a duplicate gets created quietly, and it is what the caller now
 * flags (spec §5).
 *
 * Each lookup is a single indexed equality on the generated key columns from
 * migration 0033. The previous phone path had a fast path plus a fallback that
 * pulled every non-null phone on the account into memory and compared in JS —
 * once per inserted contact. The keys make the fallback unnecessary: the
 * database already holds the normalized form, so the same comparison is an
 * index lookup.
 */
async function findDuplicate(
  db: SupabaseClient, accountId: string, email?: string, phone?: string,
): Promise<DuplicateMatch> {
  const result: DuplicateMatch = { emailMatch: null, phoneMatch: null };

  const eKey = email ? emailKey(email) : "";
  if (eKey) {
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("email_key", eKey).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) result.emailMatch = data[0]!.id as string;
  }

  const pKey = phone ? phoneDigits(phone) : "";
  if (pKey) {
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("phone_key", pKey).limit(1);
    if (error) throw new Error(`contact dedupe failed: ${error.message}`);
    if (data && data.length > 0) result.phoneMatch = data[0]!.id as string;
  }

  return result;
}
```

Then update `createContact`'s use of it — replace its first three lines with:

```ts
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim();
  const match = await findDuplicate(db, accountId, email || undefined, phone || undefined);
  const winner = match.emailMatch ?? match.phoneMatch;
  if (winner) return { id: winner, existing: true };
```

Leave the rest of `createContact` exactly as it is. The flag write is Task 3.

Delete `escapeLikePattern` **only if** nothing else in the file uses it — grep first and say what you found. It existed to make the `ilike` email match a literal, and the `ilike` is gone.

- [ ] **Step 4: Run the tests**

```
cd C:/Users/danlo/bis-platform && pnpm --filter @bis/db exec vitest run src/test/contacts.test.ts
```

Expected: PASS. **Every pre-existing dedupe test in this file must pass untouched.** If one needs editing to go green, STOP and report which and why — this task changes performance, not who wins.

- [ ] **Step 5: Commit**

```
cd C:/Users/danlo/bis-platform && git add packages/db/src/contacts.ts packages/db/src/test/contacts.test.ts && git commit -m "feat(db): dedupe by indexed key, and stop discarding the second match"
```

---

### Task 3: `createContact` flags the conflict

**Files:**
- Modify: `packages/db/src/contacts.ts` (`createContact`)
- Test: `packages/db/src/test/contacts.test.ts`

**Interfaces:**
- Consumes: `DuplicateMatch` from Task 2, `contact_duplicate_flags` from Task 1.
- Produces: `createContact` returns `{ id: string; existing: boolean; flagged: boolean }`. `flagged` is `true` only when this call wrote (or attempted) a conflict flag. Existing callers destructure `id`/`existing` and are unaffected.

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/test/contacts.test.ts`:

```ts
it("flags the pair when email and phone disagree, and does not duplicate the flag", async () => {
  const db = serviceDb();
  await withTestAccount(db, async (accountId) => {
    const a = await createContact(db, accountId,
      { firstName: "Email", email: "clash@example.com" }, "test");
    const b = await createContact(db, accountId,
      { firstName: "Phone", phone: "(956) 292-1696" }, "test");

    const first = await createContact(db, accountId,
      { firstName: "Both", email: "clash@example.com", phone: "+19562921696" }, "test");
    expect(first.flagged, "the conflicting pair should be flagged").toBe(true);

    // The same conflict seen again must not accumulate rows — the queue shows
    // a duplicate pair once, however many times an import re-encounters it.
    await createContact(db, accountId,
      { firstName: "Again", email: "clash@example.com", phone: "956-292-1696" }, "test");

    const [lo, hi] = [a.id, b.id].sort();
    const { data } = await db.from("contact_duplicate_flags")
      .select("id, reason").eq("account_id", accountId)
      .eq("contact_a", lo).eq("contact_b", hi);
    expect(data?.length, "exactly one flag row for the pair").toBe(1);
    expect(data![0]!.reason).toBe("email_phone_conflict");
  });
});

it("does not flag when both matches are the same contact", async () => {
  const db = serviceDb();
  await withTestAccount(db, async (accountId) => {
    await createContact(db, accountId,
      { firstName: "Same", email: "same@example.com", phone: "(956) 292-1696" }, "test");
    const again = await createContact(db, accountId,
      { firstName: "Same", email: "same@example.com", phone: "+19562921696" }, "test");
    expect(again.existing).toBe(true);
    expect(again.flagged, "one contact matching both ways is not a conflict").toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```
cd C:/Users/danlo/bis-platform && pnpm --filter @bis/db exec vitest run src/test/contacts.test.ts
```

Expected: FAIL — `flagged` is not a property of the returned object.

- [ ] **Step 3: Write the flag**

In `packages/db/src/contacts.ts`, change `createContact`'s signature return type to
`Promise<{ id: string; existing: boolean; flagged: boolean }>`, and replace the winner
block from Task 2 with:

```ts
  const match = await findDuplicate(db, accountId, email || undefined, phone || undefined);
  const winner = match.emailMatch ?? match.phoneMatch;

  // Two DIFFERENT existing contacts both look like this person. The row still
  // lands on the email match, unchanged — but the second one is the thing that
  // used to vanish, and it is exactly what a merge tool needs to find later.
  const conflict =
    match.emailMatch !== null &&
    match.phoneMatch !== null &&
    match.emailMatch !== match.phoneMatch;

  let flagged = false;
  if (conflict) {
    const [contactA, contactB] = [match.emailMatch!, match.phoneMatch!].sort();
    // The unique index makes a repeat a no-op rather than a second row, so a
    // 23505 here is the DESIGNED outcome, not a failure. Anything else is real
    // and must not be swallowed: a flag that silently fails to write leaves the
    // queue looking empty, which is worse than not having one.
    const { error } = await db.from("contact_duplicate_flags")
      .insert({ account_id: accountId, contact_a: contactA, contact_b: contactB,
                reason: "email_phone_conflict" });
    if (error && error.code !== "23505") {
      throw new Error(`contact duplicate flag failed: ${error.message}`);
    }
    flagged = true;
  }

  if (winner) return { id: winner, existing: true, flagged };
```

Update the two remaining `return` statements in `createContact` to include `flagged: false`
(the no-match path creates a contact and cannot have a conflict).

- [ ] **Step 4: Run the tests**

```
cd C:/Users/danlo/bis-platform && pnpm --filter @bis/db exec vitest run src/test/contacts.test.ts
```

Expected: PASS, all tests in the file.

- [ ] **Step 5: Mutation-check the flag**

Change `match.emailMatch !== match.phoneMatch` to `===`, re-run, and confirm the flag test fails **by name**. Then restore, change the `23505` tolerance to swallow every error (`if (false)`), and confirm nothing fails — which tells you that branch is currently unexercised by a real non-unique error, and is worth saying in your report rather than leaving implied. Restore both and re-run to green.

- [ ] **Step 6: Commit**

```
cd C:/Users/danlo/bis-platform && git add packages/db/src/contacts.ts packages/db/src/test/contacts.test.ts && git commit -m "feat(db): record the pair when email and phone point at different contacts"
```

---

### Task 4: The import summary says how many were flagged

**Files:**
- Modify: `apps/web/src/lib/messages.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/import-wizard.tsx`
- Modify: whichever module exports `importContactsBatchAction` (find it with the grep in Step 1)

**Interfaces:**
- Consumes: `createContact`'s `flagged: boolean` from Task 3.
- Produces: nothing later depends on this.

- [ ] **Step 1: Find the batch action and its return shape**

```
cd C:/Users/danlo/bis-platform && grep -rn "importContactsBatchAction" apps/web/src --include=*.ts --include=*.tsx
```

It currently resolves to `{ ok: true; created: number; updated: number }` on success. Read it before editing so the `flagged` count is accumulated the same way `created` and `updated` already are — do not invent a second mechanism.

- [ ] **Step 2: Add the string**

In `apps/web/src/lib/messages.ts`, beside the other `contacts.import.*` entries:

```ts
  // Shown only when the count is non-zero. "Possible" is doing real work: these
  // are pairs where an email and a phone pointed at different contacts, which
  // is usually one person entered twice — but not always, and the product has
  // no merge screen yet, so it must not promise a resolution it cannot offer.
  "contacts.import.flagged": "{flagged} possible duplicates flagged for review.",
```

- [ ] **Step 3: Carry the count through all three links**

The count has a three-link chain, and all three change. Step 1's grep gives you the
first; the other two are named here.

**(a) `applyImportBatch` in `packages/db`** is where the counting actually happens — the
action delegates to it and returns what it returns. It sums `created` and `updated` from
`createContact` today; `createContact` now also returns `flagged`, so sum that the same
way and widen its return type to `{ created: number; updated: number; flagged: number }`.

**(b) `importContactsBatchAction`** in
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/actions.ts:23`
— widen the success shape:

```ts
): Promise<{ ok: true; created: number; updated: number; flagged: number } | { ok: false; error: string }> {
```

and its early return at line 34:

```ts
  if (mapped.length === 0) return { ok: true, created: 0, updated: 0, flagged: 0 };
```

then pass `flagged` through from `applyImportBatch`'s result alongside `created` and
`updated`. **Do not add a second counting mechanism** — the sum belongs in
`applyImportBatch` with the other two, not recomputed in the action.

- [ ] **Step 4: Accumulate and render it**

In `import-wizard.tsx`: add `let flagged = 0;` beside `let created = 0;`, add
`flagged += result.flagged;` beside `created += result.created;`, widen the phase type to
`{ name: "done"; created: number; updated: number; flagged: number }`, pass it in the
`setPhase({ name: "done", ... })` call, and render below the existing done line:

```tsx
        {phase.flagged > 0 ? (
          <p className="mt-2 text-sm text-text-2">
            {m["contacts.import.flagged"].replace("{flagged}", String(phase.flagged))}
          </p>
        ) : null}
```

Zero flags renders nothing — a "0 possible duplicates" line is noise on the happy path.

- [ ] **Step 5: Verify the whole thing compiles and the suites pass**

```
cd C:/Users/danlo/bis-platform && pnpm check > check.log 2>&1
```
Then read `$?` on its own line. Expected `0`.

- [ ] **Step 6: Commit**

```
cd C:/Users/danlo/bis-platform && git add apps/web/src/lib/messages.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/import/import-wizard.tsx" && git commit -m "feat(contacts): the import summary reports what it flagged"
```

---

## Final verification

- [ ] **All three gates, each with its exit code read directly**, and run one at a time — a combined background run was killed for low memory on this machine, and the e2e web server died with Windows `0xC0000142`, which is resource exhaustion, not a test failure.

```
cd C:/Users/danlo/bis-platform && pnpm check > check.log 2>&1
cd C:/Users/danlo/bis-platform && pnpm --filter web build > build.log 2>&1
cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e > e2e.log 2>&1
```

- [ ] **Confirm migration 0033 is recorded as applied** and appears exactly once in `supabase_migrations.schema_migrations`.
- [ ] **Re-run the §3 scan check on real data**: insert 200 contacts on a throwaway account and confirm the import path does not degrade — the point of the whole exercise.
- [ ] Delete `check.log`, `build.log`, `e2e.log` with absolute paths.
- [ ] `git fetch` before deciding anything: `origin/main` moved four commits during the last milestone. Merge the remote INTO the branch and re-run every gate on the combined tree before opening the PR.
- [ ] Open the PR. **Merge only when CI `verify` AND `e2e` are green on the PR's current head** — read the check-runs via REST, never infer from an earlier run.

## Known risks

- **Two implementations of one normalization rule.** Task 1's parity test is the only thing standing between that and a silently drifted key. If it is ever weakened, the feature rots invisibly.
- **`23505` is swallowed by design** in Task 3. That is correct for the repeat-pair case and wrong for anything else, which is why the tolerance is narrowed to that one code rather than to "an error happened".
- **The flags table has no reader yet.** That is deliberate (spec §5.1) — the import summary is its one surface until merge is built. A queue nobody drains is acceptable; a queue nobody can see would not be.
