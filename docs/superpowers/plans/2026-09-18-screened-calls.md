# Screened Calls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every refused inbound call in a new agency-only table, show them on a new `/dashboard/screened` page, and raise a derived banner on the agency work queue when a number is turning callers away because of our own misconfiguration.

**Architecture:** A new `screened_calls` table that is deliberately NOT a `calls` row (see Global Constraints — reusing `calls` breaks the daily cap and disarms the spam guard). The TeXML route's `classify()` starts returning a record payload alongside its existing verdict; `respond()` writes it in `after()` so nothing lands on Telnyx's answer deadline. Two read paths: a cursor-paged agency list, and a 24-hour distinct-number count that the work queue renders as a banner and that clears itself when the refusals stop.

**Tech Stack:** Next.js 16 App Router (`after()` from `next/server`), Supabase/Postgres with RLS, TypeScript, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-18-screened-calls-design.md`

## Global Constraints

- **NEVER write a refusal into `public.calls`.** `countCallsSince` (`packages/db/src/voice.ts:403`) counts every row unfiltered by outcome and feeds the daily cap; `decideReputation` (`apps/web/src/lib/voice/caller-reputation.ts:130`) returns `{ blocked: false }` the moment `history.otherCalls > 0`, and `otherCalls` is `.neq("outcome","spam")`. A refusal stored in `calls` would eat the client's call cap and un-block the robocaller it just blocked.
- **The six reasons, exact strings:** `unknown-number`, `not-live`, `no-profile`, `profile-disabled`, `over-cap`, `repeat-spam`.
- **The three classes, exact strings:** `misconfigured` (= `not-live`, `no-profile`, `profile-disabled`), `screened` (= `over-cap`, `repeat-spam`), `unattributed` (= `unknown-number`).
- **The class is derived from the reason, never stored.** One exported function is the single source of truth.
- **The write is best-effort and off the answer path.** It happens inside `after()`. A failure logs and changes nothing: not the verdict, not the spoken copy, not the hang-up. Existing `console.log` lines stay exactly as they are.
- **Tokens only in UI** — no hard-coded colours, radii or shadows. Status is dot **+ word**, never colour alone (DESIGN.md rule 3).
- **Cursor paging, never offset.** Exactly ONE pager. The header states a real total, not the number on screen.
- **Copy lives in `apps/web/src/lib/messages.ts`.** No inline strings in components. No internal milestone codes.
- **Gates before any merge:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`.
- **Never merge to `main` directly.** Branch + PR, and both `verify` and `e2e` must be read green pinned to the PR's head SHA.
- **Any test that writes runs on the per-run fixture account**, never `Test Client One` or a live account.
- **Prove every test by mutating the code it guards** until a test named for that claim fails. A prescribed mutation that passes green is investigated before being accepted, and must leave the file syntactically valid.

### Deviation from the spec, decided during planning

The spec says "one RLS policy, `app.is_agency()`". Planning found a **stronger** option already used by `0036_alert_phone_verifications.sql`: revoke all from `anon, authenticated` and grant only to `service_role`. The agency page reads through `serviceDb()` behind `requireAgency()` — the pattern `/dashboard/numbers` already establishes — so no in-app caller needs the `authenticated` grant at all. With no grant, a client gets **permission denied** rather than zero rows, which is a stronger guarantee than a row policy. RLS is still enabled so a future grant cannot silently open the table.

---

## File Structure

**Create:**
- `packages/db/supabase/migrations/0039_screened_calls.sql` — the table, indexes, RLS, grants.
- `packages/db/src/screened-calls.ts` — reason/class vocabulary + all four accessors. One file: these change together and none is useful alone.
- `packages/db/src/test/screened-calls-grants.test.ts` — the grant/RLS proof.
- `packages/db/src/test/screened-calls.test.ts` — accessor behaviour + the no-contamination proof.
- `apps/web/src/app/(dashboard)/dashboard/screened/page.tsx` — the agency list route.
- `apps/web/src/app/(dashboard)/dashboard/screened/screened-table.tsx` — the table component.
- `apps/web/src/app/(dashboard)/dashboard/screened/page.test.ts` — route tests.
- `apps/web/src/components/line-down-banner.tsx` — the derived work-queue banner.
- `apps/web/src/components/line-down-banner.test.ts` — banner tests.
- `apps/web/e2e/screened-calls.spec.ts` — the client-cannot-reach guard.

**Modify:**
- `packages/db/src/index.ts` — export the new module.
- `apps/web/src/app/api/voice/texml/route.ts` — `classify()` returns the record; `respond()` writes it in `after()`.
- `apps/web/src/app/api/voice/texml/route.test.ts` — the six reasons and the best-effort contract.
- `apps/web/src/lib/nav-groups.ts` — the new top-level entry.
- `apps/web/src/lib/palette/registry.ts` — keywords only (nav entries are derived, so registration is automatic).
- `apps/web/src/components/app-sidebar.tsx` — the icon for the new nav key.
- `apps/web/src/lib/messages.ts` — all copy.
- `apps/web/src/app/(dashboard)/dashboard/work/page.tsx` — render the banner.
- `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` — the banner's states.

---

### Task 1: The table, and the proof that only the server can read it

**Files:**
- Create: `packages/db/supabase/migrations/0039_screened_calls.sql`
- Create: `packages/db/src/test/screened-calls-grants.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.screened_calls` with columns `id uuid`, `account_id uuid null`, `phone_number_id uuid null`, `called_e164 text not null`, `caller_e164 text null`, `reason text not null`, `created_at timestamptz not null`.

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0039_screened_calls.sql`:

```sql
-- 0039_screened_calls.sql
-- The refusals the product currently forgets.
--
-- A refused inbound call leaves no trace. `texml/route.ts` writes one
-- console.log line and hangs up: no row, nothing on any screen, nothing
-- queryable once the log rotates. Two things follow, and the second is the
-- larger one.
--
--   1. A false positive is undiscoverable. Guard 2 (`decideReputation`)
--      blocks a caller whose entire recent history on an account is silent
--      calls. 956 Woodworks took eight robocalls in a day on 2026-09-17, so
--      this guard is live against real traffic on a real client. If it ever
--      misfires on a person, the only evidence is a log line.
--   2. A misconfigured number turns EVERY caller away, silently. A number
--      that is not live, or an account whose voice profile is missing or
--      disabled, refuses everyone — and nothing anywhere says so. That is an
--      outage on a paying client that the product does not notice.
--
-- WHY THIS IS NOT A `calls` ROW, which is the whole design and must not be
-- "simplified" later:
--
--   `countCallsSince` counts every `calls` row for an account unfiltered by
--   outcome, and feeds `decideLimit` — the daily cap that declines real
--   callers. Refusals stored there would let a robocall wave consume a
--   client's call limit and start declining genuine customers.
--
--   Worse: `decideReputation` returns `{blocked:false}` the moment
--   `history.otherCalls > 0`, and `otherCalls` is the
--   `.neq("outcome","spam")` branch of `countCallerHistorySince`. A refusal
--   written as a `calls` row with any new outcome would UN-BLOCK that caller
--   for the rest of the window on the very first block — the guard disabling
--   itself, silently, in the direction of letting spam through.
--
--   Writing them as `outcome:'spam'` is not a fix either: that branch also
--   requires `turn_count >= 1` and a refused call has zero turns, so the row
--   would be invisible to both branches by accident. Correct today, fragile
--   forever.


-- ─────────────────────────────────────────────────────────────────────────
-- `account_id` AND `phone_number_id` ARE NULLABLE, and that is load-bearing
-- rather than lax.
--
-- `calls.account_id` and `calls.phone_number_id` are both NOT NULL, which is
-- precisely why a call to a number this platform does not own cannot be
-- recorded there at all. That call is the one case where we know least and a
-- wrong number is indistinguishable from a probe — exactly the sort of thing
-- worth being able to count. A nullable pair is what makes it representable.
--
-- `on delete cascade` for the account: a deleted account's screening history
-- is about an account that no longer exists. `on delete set null` for the
-- number, because a number OUTLIVES its assignment — it gets reassigned to
-- another client, and the refusal still happened on the line.
create table public.screened_calls (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.accounts(id) on delete cascade,
  phone_number_id uuid references public.phone_numbers(id) on delete set null,
  called_e164 text not null,
  caller_e164 text,
  reason text not null,
  created_at timestamptz not null default now(),
  -- A CHECK here, UNLIKE 0038's `transfer_answered_by`, and the contrast is
  -- the reasoning. 0038 refused a constraint because its values are chosen by
  -- a CARRIER and the column existed to learn what they are; a constraint
  -- would have dropped the unanticipated value the column was added to see.
  -- These six values are OURS, enumerated in our own source, and a seventh
  -- must not appear without a migration saying so — the same position
  -- `calls_outcome_check` takes.
  constraint screened_calls_reason_check check (reason in (
    'unknown-number', 'not-live', 'no-profile', 'profile-disabled',
    'over-cap', 'repeat-spam'
  ))
);

comment on table public.screened_calls is
  'Inbound calls the platform refused before bridging. NOT a calls row, deliberately: see 0039 header — a calls row would feed the daily cap and disarm the repeat-spam guard. Agency-only; service_role writes, nothing else reads.';

-- The list page orders by created_at desc across every account.
create index screened_calls_created_idx
  on public.screened_calls (created_at desc);

-- The banner counts distinct numbers per account in a 24h window; the list
-- filters by account. Both are (account_id, created_at) prefixes.
create index screened_calls_account_created_idx
  on public.screened_calls (account_id, created_at desc);


-- ─────────────────────────────────────────────────────────────────────────
-- GRANTS ARE THE CONTROL HERE, not the row policy — the shape
-- 0036_alert_phone_verifications.sql established for a table only the server
-- touches.
--
-- The design called for an `app.is_agency()` policy. This is stronger. No
-- in-app caller needs the `authenticated` grant at all: the agency list runs
-- `requireAgency()` then reads through `serviceDb()`, which is the pattern
-- /dashboard/numbers already uses for a cross-tenant screen. With no grant, a
-- client asking for this table gets PERMISSION DENIED rather than zero rows —
-- a stronger guarantee than a policy, and one that cannot be defeated by a
-- future query that forgets a filter.
--
-- RLS is still enabled: not because a policy is doing work today, but so that
-- a future `grant select ... to authenticated` cannot silently open the whole
-- table. Enabled RLS with no policy denies by default.
alter table public.screened_calls enable row level security;
revoke all on public.screened_calls from anon, authenticated;
grant select, insert, delete on public.screened_calls to service_role;
```

- [ ] **Step 2: Apply the migration**

Do NOT apply it yourself. Report to the orchestrator that `0039_screened_calls.sql` is ready; the orchestrator applies migrations exactly once.

- [ ] **Step 3: Write the grants/RLS proof**

Create `packages/db/src/test/screened-calls-grants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";

/**
 * 0039_screened_calls.sql — the proof that only the server touches this table.
 *
 * The design's audience decision ("agency-only") is enforced by GRANTS rather
 * than by a row policy, which is the stronger of the two: with no grant to
 * `authenticated`, a client gets permission denied instead of zero rows, and
 * no future query that forgets a filter can leak anything.
 */
describe("screened_calls grants", () => {
  it("a client cannot read the table at all — permission denied, not zero rows (mutation: grant select to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(
        c.query("select * from public.screened_calls"),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("an AGENCY user cannot read it through the user client either (mutation: add an is_agency policy plus a select grant to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      // `app.is_agency()` is `app_role = 'agency_admin'` (0001), so this is
      // what an agency session actually looks like. NOT `actAsOwner`, which
      // does `reset role` — the table owner bypasses grants entirely and
      // would read the table happily, passing this test for a reason that has
      // nothing to do with the property being asserted.
      //
      // Deliberate and worth pinning: the agency reads this table through
      // serviceDb() behind requireAgency(), never through the user client. If
      // that ever changes, this is where the decision gets revisited rather
      // than silently widened.
      await actAs(c, { app_role: "agency_admin" });
      await expect(
        c.query("select * from public.screened_calls"),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("a client cannot insert either (mutation: grant insert to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      await actAs(c, { org_id: "org_A" });
      await expect(
        c.query(
          "insert into public.screened_calls (called_e164, reason) values ('+19565550100','repeat-spam')",
        ),
      ).rejects.toThrow(/permission denied/i);
    }));

  it("refuses a reason outside the six (mutation: drop screened_calls_reason_check -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(
        c.query(
          "insert into public.screened_calls (called_e164, reason) values ('+19565550100','made-up')",
        ),
      ).rejects.toThrow(/screened_calls_reason_check/);
    }));

  it("accepts a row with NO account and NO phone number — the wrong-number case (mutation: make account_id NOT NULL -> FAILS)", () =>
    withRollback(async (c) => {
      // The case `calls` structurally cannot hold, and the reason this table
      // exists in its own right rather than as a view over calls.
      const { rows } = await c.query(
        "insert into public.screened_calls (called_e164, caller_e164, reason) values ('+19565550100','+19565550111','unknown-number') returning id, account_id, phone_number_id",
      );
      expect(rows[0].account_id).toBeNull();
      expect(rows[0].phone_number_id).toBeNull();
    }));
});
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @bis/db test -- screened-calls-grants`
Expected: 5 passed. If the migration has not been applied yet, every case fails with `relation "public.screened_calls" does not exist` — that is the signal to ask the orchestrator to apply it, not to edit the test.

- [ ] **Step 5: Prove the tests by mutation**

For each `mutation:` note in a test name, apply it to `0039_screened_calls.sql`, re-apply to a scratch database, and confirm the test named for it fails. Record the results. Revert every mutation.

- [ ] **Step 6: Commit**

```bash
git add packages/db/supabase/migrations/0039_screened_calls.sql packages/db/src/test/screened-calls-grants.test.ts
git commit -m "feat(db): a table for the refusals the product forgets"
```

---

### Task 2: Vocabulary, accessors, and the proof they cannot contaminate `calls`

**Files:**
- Create: `packages/db/src/screened-calls.ts`
- Create: `packages/db/src/test/screened-calls.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: the `public.screened_calls` table from Task 1.
- Produces:
  - `type ScreenedReason = "unknown-number" | "not-live" | "no-profile" | "profile-disabled" | "over-cap" | "repeat-spam"`
  - `type ScreenedClass = "misconfigured" | "screened" | "unattributed"`
  - `const SCREENED_REASONS: readonly ScreenedReason[]`
  - `function screenedClass(reason: ScreenedReason): ScreenedClass`
  - `interface ScreenedCallInput { accountId: string | null; phoneNumberId: string | null; calledE164: string; callerE164: string | null; reason: ScreenedReason }`
  - `interface ScreenedCallRow { id: string; accountId: string | null; calledE164: string; callerE164: string | null; reason: ScreenedReason; createdAt: string }`
  - `async function recordScreenedCall(db, input: ScreenedCallInput): Promise<void>`
  - `async function listScreenedCalls(db, opts?: { limit?: number; before?: string }): Promise<ScreenedCallRow[]>`
  - `async function countScreenedCalls(db): Promise<number>`
  - `async function countLinesTurningCallersAway(db, sinceIso: string): Promise<number>`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/test/screened-calls.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";
import {
  recordScreenedCall, listScreenedCalls, countScreenedCalls,
  countLinesTurningCallersAway, screenedClass, SCREENED_REASONS,
} from "../screened-calls";
import { countCallsSince, countCallerHistorySince } from "../voice";
import { withTestAccount } from "./fixtures";

describe("screenedClass", () => {
  it("routes OUR misconfiguration to `misconfigured` (mutation: move not-live into `screened` -> FAILS)", () => {
    expect(screenedClass("not-live")).toBe("misconfigured");
    expect(screenedClass("no-profile")).toBe("misconfigured");
    expect(screenedClass("profile-disabled")).toBe("misconfigured");
  });

  it("routes working-as-designed refusals to `screened` (mutation: move repeat-spam into `misconfigured` -> FAILS)", () => {
    expect(screenedClass("over-cap")).toBe("screened");
    expect(screenedClass("repeat-spam")).toBe("screened");
  });

  it("routes the ownerless call to `unattributed` (mutation: fold unknown-number into `misconfigured` -> FAILS)", () => {
    // A wrong number is nobody's outage. Folding it into `misconfigured`
    // would raise the work-queue banner for every stray dial on the trunk.
    expect(screenedClass("unknown-number")).toBe("unattributed");
  });

  it("classifies every reason in the vocabulary — no reason falls through (mutation: add a seventh reason to SCREENED_REASONS without a class -> FAILS)", () => {
    for (const reason of SCREENED_REASONS) {
      expect(["misconfigured", "screened", "unattributed"]).toContain(screenedClass(reason));
    }
  });
});

describe("recordScreenedCall / listScreenedCalls", () => {
  it("records a refusal with no account at all (mutation: make accountId required -> FAILS)", async () => {
    const db = serviceDb();
    await recordScreenedCall(db, {
      accountId: null, phoneNumberId: null,
      calledE164: "+19565550100", callerE164: "+19565550111",
      reason: "unknown-number",
    });
    const rows = await listScreenedCalls(db, { limit: 5 });
    const mine = rows.find((r) => r.calledE164 === "+19565550100");
    expect(mine?.accountId).toBeNull();
    expect(mine?.reason).toBe("unknown-number");
  });

  it("pages by cursor, newest first, never by offset (mutation: swap .lt for .gt -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      for (const called of ["+19565550201", "+19565550202", "+19565550203"]) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null, calledE164: called,
          callerE164: null, reason: "repeat-spam",
        });
      }
      const first = await listScreenedCalls(db, { limit: 2 });
      expect(first).toHaveLength(2);
      const older = await listScreenedCalls(db, { limit: 2, before: first[1].createdAt });
      // Strictly older than the cursor — no row may appear on both pages.
      const firstIds = new Set(first.map((r) => r.id));
      for (const row of older) expect(firstIds.has(row.id)).toBe(false);
    });
  });
});

describe("countLinesTurningCallersAway", () => {
  it("counts DISTINCT numbers, not refusals (mutation: count(*) instead of count(distinct) -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const before = await countLinesTurningCallersAway(db, new Date(Date.now() - 3600_000).toISOString());
      // Three refusals, ONE line. A dialer hammering one dead number is one
      // problem to fix, not three.
      for (let i = 0; i < 3; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null, calledE164: "+19565550300",
          callerE164: null, reason: "not-live",
        });
      }
      const after = await countLinesTurningCallersAway(db, new Date(Date.now() - 3600_000).toISOString());
      expect(after - before).toBe(1);
    });
  });

  it("ignores `screened` and `unattributed` reasons (mutation: drop the reason filter -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const before = await countLinesTurningCallersAway(db, since);
      await recordScreenedCall(db, {
        accountId, phoneNumberId: null, calledE164: "+19565550400",
        callerE164: null, reason: "repeat-spam",
      });
      await recordScreenedCall(db, {
        accountId: null, phoneNumberId: null, calledE164: "+19565550401",
        callerE164: null, reason: "unknown-number",
      });
      // A blocked robocall is the system working. It is not an outage and
      // must never raise the banner.
      expect(await countLinesTurningCallersAway(db, since)).toBe(before);
    });
  });
});

/**
 * THE PROOF THE WHOLE DESIGN EXISTS FOR.
 *
 * If a screened row ever reached `calls`, two things break silently: the
 * daily cap starts counting robocalls against the client's limit, and
 * `decideReputation` sees `otherCalls > 0` and un-blocks the caller it just
 * blocked. Both failures point toward letting spam through, and neither
 * would produce an error anywhere.
 */
describe("screened rows cannot contaminate the calls table", () => {
  it("leaves countCallsSince byte-identical (mutation: insert into `calls` from recordScreenedCall -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const before = await countCallsSince(db, accountId, since);
      for (let i = 0; i < 5; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null, calledE164: "+19565550500",
          callerE164: "+19565550511", reason: "repeat-spam",
        });
      }
      expect(await countCallsSince(db, accountId, since)).toBe(before);
    });
  });

  it("leaves the repeat-spam verdict's inputs byte-identical (mutation: as above -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const since = new Date(Date.now() - 3600_000).toISOString();
      const caller = "+19565550611";
      const before = await countCallerHistorySince(db, accountId, caller, since);
      for (let i = 0; i < 5; i++) {
        await recordScreenedCall(db, {
          accountId, phoneNumberId: null, calledE164: "+19565550600",
          callerE164: caller, reason: "repeat-spam",
        });
      }
      const after = await countCallerHistorySince(db, accountId, caller, since);
      // `otherCalls` is the dangerous one: a single increment here would make
      // decideReputation return {blocked:false} for the rest of the window.
      expect(after).toEqual(before);
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @bis/db test -- screened-calls`
Expected: FAIL — `Cannot find module '../screened-calls'`.

- [ ] **Step 3: Write the module**

Create `packages/db/src/screened-calls.ts`:

```ts
import type { SupabaseClient } from "./types";

/**
 * A refusal the product used to forget.
 *
 * Six reasons where `texml/route.ts`'s logs have four. `refuse-unknown`
 * merged a wrong number (nobody's problem) with a number we own that is not
 * live (an outage on a paying client); `refuse-disabled` merged "never set
 * up" with "deliberately turned off". Those collapses are why a dead line
 * could sit unnoticed, so un-collapsing them is the point rather than a
 * tidy-up.
 */
export type ScreenedReason =
  | "unknown-number"
  | "not-live"
  | "no-profile"
  | "profile-disabled"
  | "over-cap"
  | "repeat-spam";

/** Mirrors `screened_calls_reason_check` in 0039. Keep the two in step. */
export const SCREENED_REASONS: readonly ScreenedReason[] = [
  "unknown-number", "not-live", "no-profile",
  "profile-disabled", "over-cap", "repeat-spam",
] as const;

export type ScreenedClass = "misconfigured" | "screened" | "unattributed";

/**
 * What KIND of problem a refusal is — derived, never stored.
 *
 * A stored class column would be a second source of truth, free to disagree
 * with the reason beside it on the same row. This is the only one.
 *
 * `misconfigured` is ours to fix and raises the work-queue banner.
 * `screened` is the system working as designed; it is a receipt, not an
 * alarm. `unattributed` is a call to a number this platform does not own —
 * real, countable, and nobody's outage.
 */
export function screenedClass(reason: ScreenedReason): ScreenedClass {
  switch (reason) {
    case "not-live":
    case "no-profile":
    case "profile-disabled":
      return "misconfigured";
    case "over-cap":
    case "repeat-spam":
      return "screened";
    case "unknown-number":
      return "unattributed";
  }
}

export interface ScreenedCallInput {
  /** Null when the dialled number belongs to no account on this platform. */
  accountId: string | null;
  phoneNumberId: string | null;
  calledE164: string;
  /** Null for a withheld caller ID — a real shape, not an error. */
  callerE164: string | null;
  reason: ScreenedReason;
}

export interface ScreenedCallRow {
  id: string;
  accountId: string | null;
  calledE164: string;
  callerE164: string | null;
  reason: ScreenedReason;
  createdAt: string;
}

/**
 * Writes one refusal.
 *
 * THROWS on failure, deliberately — the caller decides what a failure costs,
 * and the only caller (the TeXML route) runs this inside `after()` where a
 * rejection is logged and the call is already over. Swallowing here would
 * hide a broken table from every future caller instead.
 */
export async function recordScreenedCall(
  db: SupabaseClient, input: ScreenedCallInput,
): Promise<void> {
  const { error } = await db.from("screened_calls").insert({
    account_id: input.accountId,
    phone_number_id: input.phoneNumberId,
    called_e164: input.calledE164,
    caller_e164: input.callerE164,
    reason: input.reason,
  });
  if (error) throw new Error(`recordScreenedCall failed: ${error.message}`);
}

const SCREENED_COLS = "id, account_id, called_e164, caller_e164, reason, created_at";

function toRow(r: Record<string, unknown>): ScreenedCallRow {
  return {
    id: r.id as string,
    accountId: (r.account_id as string | null) ?? null,
    calledE164: r.called_e164 as string,
    callerE164: (r.caller_e164 as string | null) ?? null,
    reason: r.reason as ScreenedReason,
    createdAt: r.created_at as string,
  };
}

/**
 * One page of refusals across EVERY account, newest first.
 *
 * Cursor paging, never offset (DESIGN.md): `before` is a `created_at` and the
 * comparison is strictly `<`, so a row can never appear on two pages.
 */
export async function listScreenedCalls(
  db: SupabaseClient, opts: { limit?: number; before?: string } = {},
): Promise<ScreenedCallRow[]> {
  let q = db.from("screened_calls").select(SCREENED_COLS)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.before) q = q.lt("created_at", opts.before);
  const { data, error } = await q;
  if (error) throw new Error(`listScreenedCalls failed: ${error.message}`);
  return (data ?? []).map((r) => toRow(r as Record<string, unknown>));
}

/** The REAL total for the list header — not the number of rows on screen. */
export async function countScreenedCalls(db: SupabaseClient): Promise<number> {
  const { count, error } = await db.from("screened_calls")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`countScreenedCalls failed: ${error.message}`);
  return count ?? 0;
}

/** The three reasons that mean a line is turning callers away. */
const MISCONFIGURED: ScreenedReason[] = ["not-live", "no-profile", "profile-disabled"];

/**
 * How many DISTINCT numbers refused callers because of our own configuration
 * since `sinceIso`.
 *
 * DISTINCT NUMBERS, not refusals: a dialer hammering one dead line is one
 * problem to fix, and a count of refusals would read as a crisis that scales
 * with the spammer's persistence rather than with anything the agency can do.
 *
 * Reads only the column it counts on, and de-duplicates in JS: the row count
 * in a 24-hour window is small by construction, and PostgREST has no
 * `count(distinct)`. If that ever stops being true, this becomes an RPC.
 */
export async function countLinesTurningCallersAway(
  db: SupabaseClient, sinceIso: string,
): Promise<number> {
  const { data, error } = await db.from("screened_calls")
    .select("called_e164")
    .in("reason", MISCONFIGURED)
    .gte("created_at", sinceIso);
  if (error) throw new Error(`countLinesTurningCallersAway failed: ${error.message}`);
  return new Set((data ?? []).map((r) => (r as { called_e164: string }).called_e164)).size;
}
```

- [ ] **Step 4: Export the module**

In `packages/db/src/index.ts`, add alongside the other `export *` lines:

```ts
export * from "./screened-calls";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @bis/db test -- screened-calls`
Expected: all cases pass.

- [ ] **Step 6: Prove the tests by mutation**

Apply each `mutation:` note and confirm the test named for it fails. The two contamination cases get the sharpest treatment: make `recordScreenedCall` additionally insert into `calls` and confirm BOTH of them go red by name. Revert every mutation.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/screened-calls.ts packages/db/src/test/screened-calls.test.ts packages/db/src/index.ts
git commit -m "feat(db): record and read screened calls, provably apart from calls"
```

---

### Task 3: The TeXML route writes the refusal, off the answer path

**Files:**
- Modify: `apps/web/src/app/api/voice/texml/route.ts`
- Modify: `apps/web/src/app/api/voice/texml/route.test.ts`

**Interfaces:**
- Consumes: `recordScreenedCall`, `ScreenedCallInput`, `ScreenedReason` from Task 2.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/app/api/voice/texml/route.test.ts`:

```ts
describe("screened calls are recorded", () => {
  it("records `not-live` for a number we own that is not live, NOT `unknown-number` (mutation: collapse the two back into one reason -> FAILS)", async () => {
    // The collapse this un-does: today both cases log `refuse-unknown`, so a
    // client's dead line is indistinguishable from a wrong number. One is an
    // outage, the other is noise.
    phoneNumberRow = { id: "pn1", account_id: "acct1", status: "parked" };
    await GET(texmlRequest({ To: "+19565550100", From: "+19565550111" }));
    await flushAfter();
    expect(recordScreenedCallMock).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct1", phoneNumberId: "pn1",
      calledE164: "+19565550100", callerE164: "+19565550111",
      reason: "not-live",
    });
  });

  it("records `unknown-number` with NO account when the number belongs to nobody (mutation: skip the write when there is no account -> FAILS)", async () => {
    phoneNumberRow = null;
    await GET(texmlRequest({ To: "+19565550100", From: "+19565550111" }));
    await flushAfter();
    expect(recordScreenedCallMock).toHaveBeenCalledWith(expect.anything(), {
      accountId: null, phoneNumberId: null,
      calledE164: "+19565550100", callerE164: "+19565550111",
      reason: "unknown-number",
    });
  });

  it("records `profile-disabled` distinctly from `no-profile` (mutation: emit one reason for both gate failures -> FAILS)", async () => {
    phoneNumberRow = { id: "pn1", account_id: "acct1", status: "live" };
    voiceProfile = { enabled: false, languages: "en" };
    await GET(texmlRequest({ To: "+19565550100", From: "+19565550111" }));
    await flushAfter();
    expect(recordScreenedCallMock).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ reason: "profile-disabled" }),
    );
  });

  it("records `no-profile` when the account never set one up", async () => {
    phoneNumberRow = { id: "pn1", account_id: "acct1", status: "live" };
    voiceProfile = null;
    await GET(texmlRequest({ To: "+19565550100", From: "+19565550111" }));
    await flushAfter();
    expect(recordScreenedCallMock).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ reason: "no-profile" }),
    );
  });

  it("records `repeat-spam` for a blocked caller", async () => {
    phoneNumberRow = { id: "pn1", account_id: "acct1", status: "live" };
    voiceProfile = { enabled: true, languages: "en" };
    callerHistory = { spamCalls: 5, otherCalls: 0 };
    await GET(texmlRequest({ To: "+19565550100", From: "+19565550111" }));
    await flushAfter();
    expect(recordScreenedCallMock).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ reason: "repeat-spam" }),
    );
  });

  it("records NOTHING for a call that is answered (mutation: record on the dial path too -> FAILS)", async () => {
    phoneNumberRow = { id: "pn1", account_id: "acct1", status: "live" };
    voiceProfile = { enabled: true, languages: "en" };
    await GET(texmlRequest({ To: "+19565550100", From: "+19565550111" }));
    await flushAfter();
    expect(recordScreenedCallMock).not.toHaveBeenCalled();
  });

  it("the caller hears EXACTLY the same thing when the write throws (mutation: await the write on the answer path -> FAILS)", async () => {
    // The contract: a caller's experience never depends on our bookkeeping.
    phoneNumberRow = { id: "pn1", account_id: "acct1", status: "parked" };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    recordScreenedCallMock.mockRejectedValueOnce(new Error("table gone"));
    const broken = await GET(texmlRequest({ To: "+19565550100", From: "+19565550111" }));
    const brokenXml = await broken.text();

    recordScreenedCallMock.mockResolvedValue(undefined);
    const working = await GET(texmlRequest({ To: "+19565550100", From: "+19565550111" }));
    const workingXml = await working.text();

    await flushAfter();
    expect(brokenXml).toBe(workingXml);
    expect(broken.status).toBe(working.status);
    spy.mockRestore();
  });

  it("writes in after(), never before the response (mutation: await recordScreenedCall inline -> FAILS)", async () => {
    // Telnyx holds a carrier answer deadline; this route's own comments say
    // wall-clock is the one thing it cannot spend.
    phoneNumberRow = { id: "pn1", account_id: "acct1", status: "parked" };
    await GET(texmlRequest({ To: "+19565550100", From: "+19565550111" }));
    expect(recordScreenedCallMock).not.toHaveBeenCalled(); // not yet
    await flushAfter();
    expect(recordScreenedCallMock).toHaveBeenCalledTimes(1); // now
  });
});
```

Reuse the existing `after()` harness from `apps/web/src/app/api/voice/incoming/lifecycle.test.ts:207` for `flushAfter()`; do not invent a second one. If this spec file does not already mock `next/server`'s `after`, add the same mock that file uses.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test -- texml/route.test`
Expected: FAIL — `recordScreenedCallMock` is not defined / never called.

- [ ] **Step 3: Extend `Routability` to carry the record**

In `apps/web/src/app/api/voice/texml/route.ts`, add to the imports:

```ts
import { after } from "next/server";
import type { ScreenedCallInput } from "@bis/db";
```

Change the `Routability` type so every refusal carries what to write:

```ts
type Routability =
  | { kind: "dial" }
  | { kind: "refuse"; languages: Languages; screened: ScreenedCallInput }
  | { kind: "cap"; languages: Languages; screened: ScreenedCallInput }
  | { kind: "blocked"; languages: Languages; screened: ScreenedCallInput };
```

- [ ] **Step 4: Return the record from each refusal branch**

In `classify()`, leave every `console.log` line exactly as it is and add the `screened` payload to each return. The two collapses are un-done here:

```ts
    const row = await getPhoneNumberByE164(db, calledE164);
    if (!row || (row.status !== "testing" && row.status !== "live")) {
      console.log(`texml declined refuse-unknown for ${calledE164}, caller ${callerE164 ?? "unknown"}`);
      // ONE log line, TWO different facts — which is exactly the collapse
      // this record un-does. No row at all is a wrong number and nobody's
      // outage; a number we own that is not live is turning away every
      // caller a paying client has.
      return {
        kind: "refuse", languages: "en",
        screened: {
          accountId: row?.account_id ?? null,
          phoneNumberId: row?.id ?? null,
          calledE164, callerE164,
          reason: row ? "not-live" : "unknown-number",
        },
      };
    }
    const profile = await getVoiceProfile(db, row.account_id);
    const gate = callAnswerable({ status: row.status, profile });
    if (!gate.answerable) {
      console.log(`texml declined refuse-disabled for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
      // `gate.reason` has always distinguished these two and nothing has ever
      // read it — the follow-up recorded in the ledger. "Never set up" and
      // "deliberately turned off" need different answers from an operator.
      return {
        kind: "refuse", languages: profile?.languages ?? "en",
        screened: {
          accountId: row.account_id, phoneNumberId: row.id,
          calledE164, callerE164,
          reason: gate.reason === "no-profile" ? "no-profile" : "profile-disabled",
        },
      };
    }
    if (!profile) {
      return {
        kind: "refuse", languages: "en",
        screened: {
          accountId: row.account_id, phoneNumberId: row.id,
          calledE164, callerE164, reason: "no-profile",
        },
      };
    }
```

and inside the cap/reputation block:

```ts
      if (reputation.blocked) {
        console.log(`texml declined blocked (${reputation.reason}) for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
        return {
          kind: "blocked", languages: profile.languages,
          screened: {
            accountId: row.account_id, phoneNumberId: row.id,
            calledE164, callerE164, reason: "repeat-spam",
          },
        };
      }
      const verdict = decideLimit({ forNumber, forAccount }, readLimitConfig());
      if (!verdict.allowed) {
        console.log(`texml declined cap (${verdict.reason}) for ${calledE164}, caller ${callerE164 ?? "unknown"}, accountId ${row.account_id}`);
        return {
          kind: "cap", languages: profile.languages,
          screened: {
            accountId: row.account_id, phoneNumberId: row.id,
            calledE164, callerE164, reason: "over-cap",
          },
        };
      }
```

- [ ] **Step 5: Write it, once, in `after()`**

In `respond()`, replace the `if (calledE164) { ... }` block:

```ts
  if (calledE164) {
    const result = await classify(calledE164, callerE164);
    if (result.kind !== "dial") {
      // ONE write site for all five refusals, not one per branch — five
      // call sites would be five chances for the next reason to forget one.
      //
      // `after()` because this route sits on Telnyx's carrier answer
      // deadline and its own comments say wall-clock is the thing it cannot
      // spend. Same pattern, same reason, as incoming/route.ts:1035.
      //
      // BEST-EFFORT, and that is a contract: a failed write logs and changes
      // nothing about the refusal, the spoken copy or the hang-up. The
      // console.log lines above are untouched and remain the evidence if
      // this write is itself broken.
      const screened = result.screened;
      after(async () => {
        try {
          const { serviceDb, recordScreenedCall } = await import("@bis/db");
          await recordScreenedCall(serviceDb(), screened);
        } catch (e) {
          console.error(`texml: screened-call write failed (${screened.reason}) for ${screened.calledE164}: ${String(e)}`);
        }
      });
    }
    if (result.kind === "refuse") return xmlResponse(sayXml(result.languages, COPY.refuse));
    if (result.kind === "blocked") return xmlResponse(sayXml(result.languages, COPY.refuse));
    if (result.kind === "cap") return xmlResponse(sayXml(result.languages, COPY.cap));
  }
  return xmlResponse(dialXml(calledE164, origin));
```

The `import("@bis/db")` is lazy for the reason `classify()`'s own comment already gives: a module-scope DB import here breaks `next build` during page-data collection.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter web test -- texml/route.test`
Expected: all cases pass, including every pre-existing case in the file — the spoken copy and the verdicts must be unchanged.

- [ ] **Step 7: Prove the tests by mutation**

Apply each `mutation:` note and confirm the test named for it fails. Pay particular attention to the two un-collapsed pairs and to the `after()` ordering case. Revert every mutation.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/api/voice/texml/route.ts apps/web/src/app/api/voice/texml/route.test.ts
git commit -m "feat(voice): write down every refusal, off the answer path"
```

---

### Task 4: The Screened calls page

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/screened/page.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/screened/screened-table.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/screened/page.test.ts`
- Create: `apps/web/e2e/screened-calls.spec.ts`
- Modify: `apps/web/src/lib/messages.ts`, `apps/web/src/lib/nav-groups.ts`, `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/lib/palette/registry.ts`

**Interfaces:**
- Consumes: `listScreenedCalls`, `countScreenedCalls`, `screenedClass`, `ScreenedCallRow` from Task 2.
- Produces: the route `/dashboard/screened`; nav key `"screened"`.

- [ ] **Step 1: Add the copy**

In `apps/web/src/lib/messages.ts`, before the closing `} as const;`:

```ts
  // ── Screened calls (2026-09-18) ────────────────────────────────────────
  // A refused call used to leave no trace but a log line. These screens are
  // agency-only: a client never sees them, so the voice is an operator's,
  // not a business owner's.
  "nav.screened": "Screened calls",
  "screened.title": "Screened calls",
  "screened.total": "{n} refused calls",
  "screened.col.when": "When",
  "screened.col.account": "Company",
  "screened.col.called": "Number dialled",
  "screened.col.caller": "Caller",
  "screened.col.reason": "Reason",
  // Dot + word, never colour alone (DESIGN.md rule 3). Each says what
  // happened in an operator's language, not the enum's.
  "screened.reason.unknown-number": "Not our number",
  "screened.reason.not-live": "Number not live",
  "screened.reason.no-profile": "No receptionist set up",
  "screened.reason.profile-disabled": "Receptionist turned off",
  "screened.reason.over-cap": "Over the daily cap",
  "screened.reason.repeat-spam": "Repeat spam",
  "screened.unknownCaller": "Withheld",
  "screened.noAccount": "—",
  "screened.empty.title": "Nothing has been turned away",
  "screened.empty.body":
    "When the receptionist refuses a call — a number that isn't live, a repeat spammer, a caller over the daily cap — it lands here with the reason. Nothing to do until then.",
  "screened.older": "Older",

  // The work-queue banner. Counts DISTINCT numbers, because a dialer
  // hammering one dead line is one problem to fix.
  "work.linesDown.one": "1 number is turning callers away",
  "work.linesDown.many": "{n} numbers are turning callers away",
  "work.linesDown.action": "See which",
```

- [ ] **Step 2: Write the failing route test**

Create `apps/web/src/app/(dashboard)/dashboard/screened/page.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import type { ScreenedCallRow } from "@bis/db";

vi.mock("@/lib/auth", () => ({ requireAgency: async () => ({ userId: "user_1" }) }));

let rows: ScreenedCallRow[] = [];
let total = 0;
vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return {
    ...actual, // `screenedClass` stays REAL — the mapping is under test.
    serviceDb: () => ({}),
    listScreenedCalls: async () => rows,
    countScreenedCalls: async () => total,
    listAccounts: async () => [{ id: "acct1", name: "Rio Roofing", timezone: "America/Chicago" }],
  };
});

const { default: ScreenedPage } = await import("./page");

function route(before?: string) {
  return { searchParams: Promise.resolve({ before }) };
}

function row(over: Partial<ScreenedCallRow> = {}): ScreenedCallRow {
  return {
    id: "s1", accountId: "acct1", calledE164: "+19565550100",
    callerE164: "+19565550111", reason: "repeat-spam",
    createdAt: "2026-09-18T14:30:00.000Z", ...over,
  };
}

describe("ScreenedPage", () => {
  beforeEach(() => { rows = []; total = 0; });

  it("states the REAL total, not the number of rows on screen (mutation: render rows.length -> FAILS)", async () => {
    rows = [row()];
    total = 412;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.total"].replace("{n}", "412"));
  });

  it("names the reason in WORDS (mutation: render the raw enum -> FAILS)", async () => {
    rows = [row({ reason: "not-live" })];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.reason.not-live"]);
    expect(renderedText(html)).not.toContain("not-live");
  });

  it("renders a row with NO account without throwing (mutation: assume accountId is non-null -> FAILS)", async () => {
    rows = [row({ accountId: null, reason: "unknown-number" })];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.reason.unknown-number"]);
  });

  it("says WITHHELD rather than blank for a withheld caller (mutation: render the null -> FAILS)", async () => {
    rows = [row({ callerE164: null })];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.unknownCaller"]);
  });

  it("shows the empty state on a cold start (mutation: render the table at zero rows -> FAILS)", async () => {
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    expect(renderedText(html)).toContain(m["screened.empty.title"]);
  });

  it("renders exactly ONE pager, and only when the page is full (mutation: always render the pager -> FAILS)", async () => {
    rows = [row()];
    total = 1;
    const html = renderToStaticMarkup(await ScreenedPage(route()));
    const pagers = html.split(m["screened.older"]).length - 1;
    expect(pagers).toBe(0);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter web test -- screened/page.test`
Expected: FAIL — `Cannot find module './page'`.

- [ ] **Step 4: Write the page**

Create `apps/web/src/app/(dashboard)/dashboard/screened/page.tsx`:

```tsx
// The refusals the product used to forget.
//
// `requireAgency()` is the literal first line, before any read — every read
// below is cross-tenant through `serviceDb()`, and such a read must never be
// ISSUED on a client's behalf, not merely have its output withheld. The same
// discipline /dashboard/numbers states in its own header.
//
// The table itself is unreadable by `authenticated` at all (0039 revokes the
// grant), so this route is the only way in and the gate above is the whole
// of the access control.
import { ShieldAlert } from "lucide-react";
import { listScreenedCalls, countScreenedCalls, listAccounts, serviceDb } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { requireAgency } from "@/lib/auth";
import { parseTimeCursor } from "@/lib/cursor";
import { m } from "@/lib/messages";
import { ScreenedTable } from "./screened-table";

export const dynamic = "force-dynamic";

/** One page of history. A full page back is the only signal there may be
 *  more, so it is also what decides whether the "Older" link renders. */
const PAGE_SIZE = 50;

export default async function ScreenedPage({
  searchParams,
}: {
  searchParams: Promise<{ before?: string }>;
}) {
  await requireAgency();
  const { before } = await searchParams;
  const cursor = parseTimeCursor(before);
  const db = serviceDb();

  const [rows, total, accounts] = await Promise.all([
    listScreenedCalls(db, { limit: PAGE_SIZE, before: cursor }),
    countScreenedCalls(db),
    listAccounts(db),
  ]);

  // accountId → the account's own label and zone. A row with a null
  // accountId has neither, and that is a real state (the call was to a
  // number this platform does not own), not a lookup failure.
  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  const last = rows[rows.length - 1];
  const olderHref =
    rows.length === PAGE_SIZE && last
      ? `/dashboard/screened?before=${encodeURIComponent(last.createdAt)}`
      : undefined;

  return (
    <>
      <PageHeader title={m["screened.title"]} />
      <div className="space-y-6 p-6">
        {rows.length === 0 && !cursor ? (
          <EmptyState
            icon={ShieldAlert}
            title={m["screened.empty.title"]}
            body={m["screened.empty.body"]}
          />
        ) : (
          <ScreenedTable
            rows={rows}
            total={total}
            accountsById={accountsById}
            olderHref={olderHref}
          />
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 5: Write the table component**

Create `apps/web/src/app/(dashboard)/dashboard/screened/screened-table.tsx`. Follow `calls-table.tsx`'s structure exactly for the row/hover/focus treatment. The reason cell is a **dot + word** — the dot is a graphical object held to 3:1 and the WORD is what distinguishes the reason (DESIGN.md rule 3, and `calls/format.ts`'s `OUTCOMES` map is the precedent to copy):

```tsx
import Link from "next/link";
import type { ScreenedCallRow, ScreenedClass } from "@bis/db";
import { screenedClass } from "@bis/db";
import { m } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { formatDateInZone } from "@/lib/format";

/**
 * Hue by CLASS, never by reason — three classes, three treatments, and the
 * WORD beside the dot is what says which of the six reasons it is.
 *
 * `misconfigured` takes the warning hue because it is the only one an
 * operator must act on. `screened` recedes: the system worked. `unattributed`
 * recedes furthest — a wrong number is nobody's problem.
 */
const CLASS_DOT: Record<ScreenedClass, string> = {
  misconfigured: "bg-[var(--warn)]",
  screened: "bg-muted-foreground/60",
  unattributed: "bg-muted-foreground/30",
};

const LABEL_ROLE =
  "font-mono text-[10px] font-medium tracking-[0.14em] text-muted-foreground uppercase";

export function ScreenedTable({
  rows, total, accountsById, olderHref,
}: {
  rows: ScreenedCallRow[];
  /** The REAL total across every page — never `rows.length`. */
  total: number;
  accountsById: Map<string, { name: string; timezone: string }>;
  olderHref?: string;
}) {
  return (
    <section className="space-y-3">
      <p className={LABEL_ROLE}>{m["screened.total"].replace("{n}", String(total))}</p>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.when"]}</th>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.account"]}</th>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.called"]}</th>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.caller"]}</th>
              <th className={cn(LABEL_ROLE, "px-5 py-3 text-left")}>{m["screened.col.reason"]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const account = r.accountId ? accountsById.get(r.accountId) : undefined;
              const cls = screenedClass(r.reason);
              return (
                <tr key={r.id} className="border-t border-[var(--row-line)]">
                  <td className="px-5 py-3 tabular-nums text-muted-foreground">
                    {/* The account's OWN zone where there is one. A row with
                        no account has no zone to claim, so it renders in UTC
                        and the column header is the only promise made. */}
                    {formatDateInZone(r.createdAt, account?.timezone ?? "UTC")}
                  </td>
                  <td className="px-5 py-3">{account?.name ?? m["screened.noAccount"]}</td>
                  <td className="px-5 py-3 tabular-nums">{r.calledE164}</td>
                  <td className="px-5 py-3 tabular-nums">
                    {r.callerE164 ?? m["screened.unknownCaller"]}
                  </td>
                  <td className="px-5 py-3">
                    <span className="inline-flex items-center gap-1.5">
                      <span className={cn("size-[7px] shrink-0 rounded-full", CLASS_DOT[cls])} aria-hidden />
                      {m[`screened.reason.${r.reason}` as const]}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* EXACTLY ONE pager, and only when a full page came back. */}
      {olderHref ? (
        <Link href={olderHref} className="text-sm underline underline-offset-2">
          {m["screened.older"]}
        </Link>
      ) : null}
    </section>
  );
}
```

- [ ] **Step 6: Register the nav entry, icon and palette keywords**

In `apps/web/src/lib/nav-groups.ts`, append to the `base === null` item list (this registry's convention is "add a line, never reorder"):

```ts
          // The screened-call log — /dashboard/screened, agency-only by
          // construction (requireAgency, first line) and unreadable by
          // `authenticated` at the grant level besides.
          { href: "/dashboard/screened", labelKey: "nav.screened", iconKey: "screened" },
```

Add `"screened"` to the `NavIconKey` union at `apps/web/src/lib/nav-groups.ts:9`, and to `NAV_ICONS` in `apps/web/src/components/app-sidebar.tsx:45` (the record is typed `Record<NavIconKey, LucideIcon>`, so missing it is a typecheck failure, not a silent gap):

```ts
  // `ShieldAlert` rather than `Shield`: this screen is not a security
  // setting, it is a list of things that were turned away.
  screened: ShieldAlert,
```

importing `ShieldAlert` from `lucide-react`. In `apps/web/src/lib/palette/registry.ts`, add to `NAV_KEYWORDS` (the entry itself is derived from the nav groups, so only keywords are needed):

```ts
  "/dashboard/screened": ["refused", "blocked", "spam", "declined", "rejected", "turned away"],
```

- [ ] **Step 7: Write the e2e guard**

Create `apps/web/e2e/screened-calls.spec.ts`, mirroring `work-queue.spec.ts:84`'s "a client cannot reach the agency work queue" case exactly — same fixture account, same assertion shape. A client visiting `/dashboard/screened` must not see `screened.title`.

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter web test -- screened/page.test`
Expected: all cases pass.
Run: `pnpm --filter web test -- palette/registry.test`
Expected: still passes — the parity test asserts every nav destination has a palette entry, so a missing registration fails here.

- [ ] **Step 9: Update the styleguide**

In `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`, add a `<Section title="Screened reasons" file="…/screened/screened-table.tsx">` showing all three class treatments side by side with their words, so the dot-plus-word rule is inspectable.

- [ ] **Step 10: Prove the tests by mutation, then commit**

Apply each `mutation:` note and confirm the named test fails. Then:

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/screened apps/web/src/app/\(dashboard\)/dashboard/styleguide/page.tsx apps/web/src/lib/messages.ts apps/web/src/lib/nav-groups.ts apps/web/src/lib/palette/registry.ts apps/web/src/components/app-sidebar.tsx apps/web/e2e/screened-calls.spec.ts
git commit -m "feat(web): a screen for the calls we turned away"
```

---

### Task 5: The derived work-queue banner

**Files:**
- Create: `apps/web/src/components/line-down-banner.tsx`
- Create: `apps/web/src/components/line-down-banner.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/work/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`

**Interfaces:**
- Consumes: `countLinesTurningCallersAway` from Task 2.
- Produces: `<LineDownBanner count={number} />`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/line-down-banner.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LineDownBanner } from "./line-down-banner";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

const render = (count: number) =>
  renderToStaticMarkup(createElement(LineDownBanner, { count }));

describe("LineDownBanner", () => {
  it("renders NOTHING at zero — it clears itself (mutation: always render -> FAILS)", () => {
    // The whole reason this is derived rather than a stored task: when the
    // number goes live the refusals stop and the banner disappears on the
    // next render. There is nothing to complete, dismiss or forget.
    expect(render(0)).toBe("");
  });

  it("says ONE number in the singular (mutation: always use the plural string -> FAILS)", () => {
    expect(renderedText(render(1))).toContain(m["work.linesDown.one"]);
  });

  it("counts in the plural above one (mutation: as above -> FAILS)", () => {
    expect(renderedText(render(3))).toContain(m["work.linesDown.many"].replace("{n}", "3"));
  });

  it("says it in WORDS, not by colour alone (mutation: delete the sentence, keep the tint -> FAILS)", () => {
    // DESIGN.md rule 3. Strip every tag and class: what is left is what a
    // reader with no colour perception receives.
    expect(renderedText(render(2)).trim().length).toBeGreaterThan(20);
  });

  it("links to the screened list (mutation: drop the link -> FAILS)", () => {
    expect(render(2)).toContain('href="/dashboard/screened"');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test -- line-down-banner`
Expected: FAIL — `Cannot find module './line-down-banner'`.

- [ ] **Step 3: Write the component**

Create `apps/web/src/components/line-down-banner.tsx`:

```tsx
import Link from "next/link";
import { Notice } from "@/components/ui/notice";
import { m } from "@/lib/messages";

/**
 * "2 numbers are turning callers away."
 *
 * DERIVED, NEVER STORED, and that is the design rather than an
 * implementation detail. The count comes from a 24-hour window over
 * `screened_calls`; when the number goes live the refusals stop and this
 * disappears on the next render. There is no task to stamp, complete,
 * dismiss or forget — and therefore no state that can go stale and lie,
 * which is the failure mode a stored "line down" task would have.
 *
 * It is also why this is not a new `WorkSource`: a source would ripple into
 * `bucketWork`, the per-account queue and both list components to model
 * something that is not a task.
 *
 * Renders NOTHING at zero. A banner that says "0 numbers are turning callers
 * away" is noise on the good day, which is most days.
 */
export function LineDownBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  const sentence =
    count === 1
      ? m["work.linesDown.one"]
      : m["work.linesDown.many"].replace("{n}", String(count));

  // `text-foreground` per the repo's standing rule (setup-shell.tsx): a full
  // SENTENCE keeps the foreground colour and lets the ground carry the hue,
  // because a sentence in `--warn` sits at the AA floor.
  //
  // `role="note"` overrides Notice's own `role="alert"`: this is a standing
  // fact present on first paint, not something that just happened.
  return (
    <Notice tone="warn" role="note" className="text-foreground">
      {sentence}{" "}
      <Link href="/dashboard/screened" className="underline underline-offset-2">
        {m["work.linesDown.action"]}
      </Link>
    </Notice>
  );
}
```

- [ ] **Step 4: Render it on the work queue**

In `apps/web/src/app/(dashboard)/dashboard/work/page.tsx`, add the read to the existing `Promise.all` and the banner above the list:

```tsx
  const linesDown = await countLinesTurningCallersAway(
    db, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  );
```

```tsx
        <LineDownBanner count={linesDown} />
```

Swallow a failure of this read the way the Calls page swallows its badge read: the queue is the page, and a cosmetic banner must not cost the agency their work list.

```tsx
  let linesDown = 0;
  try {
    linesDown = await countLinesTurningCallersAway(db, since);
  } catch (e) {
    console.error(`work queue: lines-down read failed, rendering no banner: ${String(e)}`);
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter web test -- line-down-banner`
Expected: all cases pass.
Run: `pnpm --filter web test -- dashboard/work`
Expected: existing work-queue cases still pass.

- [ ] **Step 6: Add the banner to the styleguide**

In `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`, add a `<Section title="Line-down banner" file="components/line-down-banner.tsx">` showing the singular and plural states. The zero state renders nothing, so note that in a caption rather than showing an empty box.

- [ ] **Step 7: Prove the tests by mutation, then commit**

```bash
git add apps/web/src/components/line-down-banner.tsx apps/web/src/components/line-down-banner.test.ts apps/web/src/app/\(dashboard\)/dashboard/work/page.tsx apps/web/src/app/\(dashboard\)/dashboard/styleguide/page.tsx
git commit -m "feat(web): tell the agency when a line is turning callers away"
```

---

## Final gates

- [ ] `pnpm check` — exit 0. Read the log, not the wrapper's exit code.
- [ ] `pnpm --filter web build` — exit 0.
- [ ] `pnpm --filter web test:e2e` — exit 0.
- [ ] Design review against DESIGN.md's definition of done (bis-design-reviewer).
- [ ] Two-stage review of the whole branch (bis-reviewer).
- [ ] Open a PR. Do NOT merge until `verify` AND `e2e` are read green **pinned to the PR's head SHA**.

## Self-review notes

- **Spec coverage:** table (T1) · reasons and derived class (T2) · accessors (T2) · `after()` write and six reasons (T3) · agency list with cursor paging, real total, dot+word, empty state (T4) · derived banner (T5) · no-contamination proof (T2) · RLS/grants proof (T1) · e2e client guard (T4) · styleguide (T4, T5) · palette registration (T4, automatic via nav derivation). No spec requirement is unassigned.
- **Known deviation:** grants replace the RLS policy as the control (recorded above, stronger).
- **Type consistency:** `ScreenedCallInput` is produced in T2 and consumed verbatim in T3's `Routability`. `ScreenedCallRow` is produced in T2 and consumed in T4. `countLinesTurningCallersAway` is named identically in T2 and T5.
