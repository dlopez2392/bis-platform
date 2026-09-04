# A2P registration as real state — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** The platform records, per client company, the A2P brand and campaign
identifiers and whether that client is cleared to text — and the activation
checklist derives from it instead of a manual tick.

**Architecture:** Four columns on `accounts` (migration `0023`), one db writer
shaped like `renameAccount`, an agency-gated server action on `serviceDb()`,
and one new optional argument to the pure `mergeChecklist`.

**Tech Stack:** Supabase/Postgres, `packages/db`, Next.js App Router server
actions, vitest (no DOM), Playwright.

## Global Constraints

- **The write NEVER goes through `dbForRequest()`.** `0013_client_branding.sql:46-47`
  revokes `UPDATE on public.accounts from authenticated` and re-grants only
  branding columns. A new `a2p_*` column written by the RLS-scoped client fails
  with a permission error **unit tests cannot see, because they mock the
  database** — the third occurrence of that class in this repo. Agency-gated
  action, `serviceDb()`, full stop.
- **Do NOT grant the new columns.** `0013:45` records that
  `client-branding-grants.test.ts` asserts the granted set EXACTLY in both
  directions. Leaving `a2p_*` ungranted needs no change there and is correct.
- **Zero-row writes must throw.** PostgREST reports no error for an update
  matching nothing; without the check the action returns success having written
  nothing (P5's shipped bug).
- **No new `withTestAccount` cycles** in `packages/db` tests — extend an
  existing one. `blueprints.test.ts` measures ~17s against a 20s default and
  extra fixture cycles tip it into a timeout.
- **This phase ships no texting.** No Telnyx call, no send path.
- Copy in `lib/messages.ts` as `m["key"]`; tokens only; DESIGN.md applies.

## File Structure

**Create:** `packages/db/supabase/migrations/0023_a2p_registration.sql` ·
`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/checklist/a2p-panel.tsx`

**Modify:** `packages/db/src/accounts.ts` · `packages/db/src/index.ts` ·
`packages/db/src/test/accounts.test.ts` · `apps/web/src/lib/checklist-catalogue.ts` ·
its test · `.../checklist/page.tsx` · `.../checklist/actions.ts` ·
`.../dashboard/page.tsx` · `apps/web/src/lib/messages.ts` · an e2e spec

---

### Task 1: Migration, writer, and the db test

**Files:** create `packages/db/supabase/migrations/0023_a2p_registration.sql`;
modify `packages/db/src/accounts.ts`, `packages/db/src/index.ts`,
`packages/db/src/test/accounts.test.ts`

**Interfaces produced:**
- `export type A2pStatus = "not_started" | "pending" | "approved" | "rejected"`
- `setA2pRegistration(db, accountId, patch: { brandId: string | null; campaignId: string | null; status: A2pStatus }, actorId): Promise<void>`
- `getA2pRegistration(db, accountId): Promise<{ brandId: string | null; campaignId: string | null; status: A2pStatus } | null>`

- [ ] **Step 1: Write the migration**

`0022` is the current highest — confirm with `ls packages/db/supabase/migrations/`
before naming the file. Create `0023_a2p_registration.sql`:

```sql
-- A2P 10DLC registration state, per client company.
--
-- Deliberately NOT granted to `authenticated`. 0013 revoked UPDATE on accounts
-- and re-granted only branding columns, and client-branding-grants.test.ts
-- asserts that set exactly. A2P entry is agency operator work performed with
-- serviceDb(); a client never writes it, and a client reading it is harmless
-- (the existing row-level select policy already covers their own row).
--
-- One campaign per account: a brand belongs to a business and a campaign to a
-- use case, and this product has one use case per client. Numbers inherit
-- eligibility from their account, so there is no per-number A2P state.
alter table public.accounts
  add column a2p_brand_id text,
  add column a2p_campaign_id text,
  add column a2p_status text not null default 'not_started'
    check (a2p_status in ('not_started','pending','approved','rejected')),
  add column a2p_updated_at timestamptz;
```

The default is honest: for every existing account the platform genuinely does
not know, so `not_started` is the truth rather than a backfill guess.

- [ ] **Step 2: Write the failing test**

Extend the EXISTING `withTestAccount` cycle in
`packages/db/src/test/accounts.test.ts` — read the file first and add to a cycle
that already creates an account, rather than opening a new one. Add:

```ts
      // P1a: A2P registration round-trip.
      expect((await getA2pRegistration(db, accountId))!.status).toBe("not_started");

      await setA2pRegistration(db, accountId, {
        brandId: "BRAND123", campaignId: "CAMP456", status: "pending",
      }, "user_test");
      const pending = (await getA2pRegistration(db, accountId))!;
      expect(pending.brandId).toBe("BRAND123");
      expect(pending.campaignId).toBe("CAMP456");
      expect(pending.status).toBe("pending");

      const { data: ev } = await db.from("events").select("type")
        .eq("account_id", accountId).eq("type", "account.a2p_updated");
      expect(ev).toHaveLength(1);

      // A write that matches nothing must THROW, not report success —
      // PostgREST returns no error for a zero-row update (P5's shipped bug).
      await expect(setA2pRegistration(
        db, "00000000-0000-0000-0000-000000000000",
        { brandId: null, campaignId: null, status: "approved" }, "user_test",
      )).rejects.toThrow(/no account/);
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd packages/db && npx vitest run src/test/accounts.test.ts`
Expected: FAIL — `setA2pRegistration is not a function`.

- [ ] **Step 4: Implement**

Append to `packages/db/src/accounts.ts`, beside `renameAccount` whose shape
this mirrors:

```ts
export type A2pStatus = "not_started" | "pending" | "approved" | "rejected";

export type A2pRegistration = {
  brandId: string | null;
  campaignId: string | null;
  status: A2pStatus;
};

/**
 * A2P 10DLC state, recorded rather than performed: registration happens in the
 * Telnyx portal with the carriers, and this is where its outcome lands so the
 * platform can refuse to text on a number that is not cleared.
 *
 * serviceDb ONLY. 0013 revoked UPDATE on accounts from `authenticated` and
 * re-granted branding columns alone, so these columns are unwritable by the
 * RLS-scoped client — and unit tests, which mock the database, cannot see
 * that. Callers must be agency-gated.
 */
export async function setA2pRegistration(
  db: SupabaseClient, accountId: string, patch: A2pRegistration, actorId: string,
): Promise<void> {
  const { data, error } = await db.from("accounts")
    .update({
      a2p_brand_id: patch.brandId,
      a2p_campaign_id: patch.campaignId,
      a2p_status: patch.status,
      a2p_updated_at: new Date().toISOString(),
    })
    .eq("id", accountId).select("id");
  if (error) throw new Error(`setA2pRegistration failed: ${error.message}`);
  // Zero rows is not success: PostgREST reports no error for an update that
  // matched nothing, so without this a wrong id returns ok having written
  // nothing.
  if (!data?.length) throw new Error(`setA2pRegistration: no account ${accountId}`);
  await emit(db, accountId, "account.a2p_updated", actorId, { status: patch.status });
}

export async function getA2pRegistration(
  db: SupabaseClient, accountId: string,
): Promise<A2pRegistration | null> {
  const { data, error } = await db.from("accounts")
    .select("a2p_brand_id, a2p_campaign_id, a2p_status")
    .eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getA2pRegistration failed: ${error.message}`);
  if (!data) return null;
  return {
    brandId: data.a2p_brand_id, campaignId: data.a2p_campaign_id,
    status: data.a2p_status as A2pStatus,
  };
}
```

Check `accounts.ts`'s existing imports for `emit` and add it if absent.

Export from `packages/db/src/index.ts` on the accounts line:
`setA2pRegistration, getA2pRegistration, type A2pStatus, type A2pRegistration`.

- [ ] **Step 5: Apply the migration, run the test**

🔴 Migrations in this repo are applied ONCE and never re-applied. Apply `0023`
the way the runbook prescribes, then:

Run: `cd packages/db && npx vitest run src/test/accounts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db
git commit -m "feat(db): record A2P 10DLC registration state per account"
```

---

### Task 2: The checklist derives instead of ticks

**Files:** modify `apps/web/src/lib/checklist-catalogue.ts` and its test

**Interfaces:** `mergeChecklist(rows, derived?: { a2pStatus?: A2pStatus })` —
the second argument is optional so existing callers keep compiling; Task 3
passes it at both call sites.

- [ ] **Step 1: Write the failing test**

In `apps/web/src/lib/checklist-catalogue.test.ts` (create it if absent — check
first):

```ts
  it("derives A2P from account state, not from a stored tick", () => {
    const a2p = (entries: ReturnType<typeof mergeChecklist>) =>
      entries.find((e) => e.key === "a2p_registration")!;

    expect(a2p(mergeChecklist([], { a2pStatus: "approved" })).done).toBe(true);
    for (const status of ["not_started", "pending", "rejected"] as const) {
      expect(a2p(mergeChecklist([], { a2pStatus: status })).done, status).toBe(false);
    }
    // Only `approved` counts — a rejected registration cannot read as done.
    // And a stale manual tick must NOT win: the whole point is that this item
    // now reflects the carriers, so a row saying done with a status saying
    // otherwise resolves to NOT done.
    const ticked = [{
      item_key: "a2p_registration", done_at: new Date().toISOString(),
      title: null, note: null,
    }] as Parameters<typeof mergeChecklist>[0];
    expect(a2p(mergeChecklist(ticked, { a2pStatus: "pending" })).done).toBe(false);
  });

  it("leaves every other item on its stored tick", () => {
    const rows = [{
      item_key: "phone_number", done_at: new Date().toISOString(),
      title: null, note: null,
    }] as Parameters<typeof mergeChecklist>[0];
    const entries = mergeChecklist(rows, { a2pStatus: "not_started" });
    expect(entries.find((e) => e.key === "phone_number")!.done).toBe(true);
  });
```

⚠️ `ChecklistStateRow`'s real shape may carry more fields — read it from
`@bis/db` and match the literal to it rather than to the cast above.

- [ ] **Step 2: Run and confirm it fails**

Run: `cd apps/web && npx vitest run src/lib/checklist-catalogue.test.ts`
Expected: FAIL — `mergeChecklist` takes one argument.

- [ ] **Step 3: Implement**

```ts
export function mergeChecklist(
  rows: ChecklistStateRow[],
  /** Items whose truth lives in account state rather than a stored tick.
   *  A2P is the first: registration happens with the carriers, so a manual
   *  tick could claim done for a client who cannot legally text. Undefined
   *  (no account read available) falls back to the stored row. */
  derived: { a2pStatus?: A2pStatus } = {},
): ChecklistEntry[] {
  const byKey = new Map(rows.map((r) => [r.item_key, r]));

  const catalogue: ChecklistEntry[] = CHECKLIST_CATALOGUE.map((item) => {
    const row = byKey.get(item.key);
    const done = item.key === "a2p_registration" && derived.a2pStatus !== undefined
      ? derived.a2pStatus === "approved"
      : Boolean(row?.done_at);
    return {
      key: item.key, title: item.title, help: item.help,
      external: item.external, href: item.href, custom: false,
      done, note: row?.note ?? null,
    };
  });
  // …custom block unchanged…
}
```

Import `type A2pStatus` from `@bis/db`.

- [ ] **Step 4: Run and confirm it passes**

Run: `cd apps/web && npx vitest run src/lib/checklist-catalogue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/checklist-catalogue.ts apps/web/src/lib/checklist-catalogue.test.ts
git commit -m "feat(checklist): A2P derives from account state, not a manual tick"
```

---

### Task 3: The agency-only panel, and wiring both call sites

**Files:** create `.../checklist/a2p-panel.tsx`; modify `.../checklist/actions.ts`,
`.../checklist/page.tsx`, `.../dashboard/page.tsx`, `apps/web/src/lib/messages.ts`

- [ ] **Step 1: Copy**

Add to `messages.ts`:

```ts
  "a2p.title": "A2P registration",
  "a2p.body": "What the carriers have approved for this company. Texting stays off until the campaign is approved.",
  "a2p.brandId": "Brand ID",
  "a2p.campaignId": "Campaign ID",
  "a2p.status": "Status",
  "a2p.status.not_started": "Not started",
  "a2p.status.pending": "With the carriers",
  "a2p.status.approved": "Approved",
  "a2p.status.rejected": "Rejected",
  "a2p.saved": "A2P registration updated",
  "a2p.saveFailed": "Could not update A2P registration",
```

"With the carriers" rather than "Pending" on purpose: it names who is holding
it up, which is the thing the operator actually wants to know and matches the
checklist help's "nothing you do here speeds it up."

- [ ] **Step 2: The action**

In `.../checklist/actions.ts`, following the file's existing action shape (read
it first — match its `requireAgencyOnlyAccountAccess` usage and revalidate
calls):

```ts
export async function setA2pRegistrationAction(
  accountId: string, formData: FormData,
): Promise<void> {
  // Agency-gated AND serviceDb: 0013 left the a2p_* columns ungranted to
  // `authenticated`, so dbForRequest() would fail with a permission error no
  // unit test can see. This is deliberate, not an oversight.
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const status = String(formData.get("status") ?? "");
  if (!["not_started", "pending", "approved", "rejected"].includes(status)) {
    throw new Error("setA2pRegistrationAction: unknown status");
  }
  const str = (k: string) => {
    const v = String(formData.get(k) ?? "").trim();
    return v === "" ? null : v;
  };
  await setA2pRegistration(serviceDb(), accountId, {
    brandId: str("brandId"), campaignId: str("campaignId"),
    status: status as A2pStatus,
  }, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/checklist`);
  revalidatePath(`/dashboard/accounts/${accountId}/dashboard`);
}
```

- [ ] **Step 3: The panel**

Create `a2p-panel.tsx` — a Card with two text inputs and a Select for status,
bound to the action. Match the shape of an existing settings panel
(`settings/sending-address-card.tsx` is the closest sibling: read it and mirror
its Card/Label/Input/SubmitButton structure and its toast handling). Tokens
only; no hard-coded colours or radii.

- [ ] **Step 4: Wire both `mergeChecklist` call sites**

Both must pass the derived status or the item silently keeps ticking:

- `.../checklist/page.tsx:40` — add `getA2pRegistration(db, accountId)` to the
  existing `Promise.all` at `:24` and pass
  `mergeChecklist(rows, { a2pStatus: a2p?.status })`. Render `<A2pPanel …/>`.
- `.../dashboard/page.tsx:132` — same, using the existing `Promise.all` at `:96`.

⚠️ Read both files first: `checklist/page.tsx` uses `dbForRequest()` for its
READS, which is correct and must not change — only the WRITE needs `serviceDb`.

- [ ] **Step 5: Gates**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: exit 0 for all three.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(checklist): agency panel for A2P registration"
```

---

### Task 4: The e2e that sees the grant, then the full gates

**Files:** modify an e2e spec (extend `setup.spec.ts` or `client-access.spec.ts`
— whichever already has an agency-and-client pair; read both and pick, do not
create a new spec)

- [ ] **Step 1: Write it**

```ts
  // The agency records a registration and the checklist reflects it.
  await page.goto(`/dashboard/accounts/${accountId}/checklist`);
  await page.getByLabel("Brand ID").fill("BRAND123");
  await page.getByLabel("Campaign ID").fill("CAMP456");
  await page.getByLabel("Status").selectOption("approved");
  await page.getByRole("button", { name: /save/i }).click();
  await expect(page.getByText("A2P registration updated")).toBeVisible();
  // Derived, not ticked: the item now reads done because the status says so.
  const item = page.getByRole("listitem").filter({ hasText: "Register A2P" });
  await expect(item).toContainText(/done/i);
```

and, in a client-session block:

```ts
    // THE ASSERTION THIS PHASE EXISTS FOR. 0013 left a2p_* ungranted to
    // `authenticated`, and unit tests mock the database so they are blind to
    // column grants — this is the only test that can see the constraint the
    // whole design turns on.
    const { error } = await userDb(clientToken).from("accounts")
      .update({ a2p_status: "approved" }).eq("id", accountId).select("id");
    expect(error, "a client must not be able to write A2P state").not.toBeNull();
```

⚠️ Getting a client-scoped `userDb` token inside a spec may not be possible the
way it is written above — check how `client-branding.spec.ts` proves its own
grant boundary ("writes its own branding columns, and nothing else, on its own
row only") and copy that mechanism exactly. If it proves grants from the
Playwright runner with a real client token, mirror it; if the boundary is only
provable through the UI, assert the panel is absent for a client session
instead and say so in a comment rather than shipping a weaker test dressed as a
strong one.

- [ ] **Step 2: Run the chosen spec alone**

Run: `cd apps/web && npx playwright test <spec>`
Expected: PASS.

- [ ] **Step 3: Full gates**

```bash
pnpm check
pnpm --filter web build
cd apps/web && npx playwright test
```

⚠️ `contacts-drawer.spec.ts:348` is a known contention flake — if it is the only
red, re-run it alone before treating it as a regression. Never diagnose an e2e
failure while a second run is alive.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e
git commit -m "test(e2e): the agency records A2P state; a client cannot"
```

---

## Final gates before merge

- [ ] `pnpm check` exit 0 · `pnpm --filter web build` · full e2e
- [ ] Review gate (no autonomous merge)
- [ ] danlo gate

## Self-review notes

Spec coverage: data model → Task 1; the grants constraint → Tasks 1 and 3 and
the e2e in Task 4; derived checklist → Task 2 and wired in Task 3; the
backwards-going item → pinned by Task 2's `rejected` case; the gate for Phase 1b
→ `getA2pRegistration` is the predicate, and there is no send path to refuse yet
by design.

Three `⚠️` notes are verification instructions, not placeholders: match
`ChecklistStateRow`'s real shape, read both page files before editing their
`Promise.all`s, and copy `client-branding.spec.ts`'s grant-proof mechanism
rather than inventing one. Each says what to look for and what to do if it does
not hold — and the last explicitly forbids shipping a weaker test that looks
strong, which is the failure mode this phase's own e2e exists to prevent.
