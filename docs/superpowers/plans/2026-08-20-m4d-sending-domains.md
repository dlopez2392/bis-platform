# M4d — Per-Client Sending Domains Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A client's outbound email to their customers leaves from the client's own domain instead of `crm@bis-rgv.com`.

**Architecture:** A nullable `accounts.from_email` column with **no** `authenticated` grant, read and written through a **new accessor of its own** (`sending-identity.ts`) rather than the client-writable `Branding` type. `SendEmailInput` gains an optional `fromAddress` that overrides the provider's configured address for one send; only the outbound-to-customer call site passes it. Saving an address is gated by a preflight test send, so an unverified domain is rejected before the value is stored.

**Tech Stack:** pnpm monorepo · Next.js App Router (`apps/web`) · `packages/db` (Supabase/PostgREST + SQL migrations) · vitest · Playwright · Resend.

**Spec:** `docs/superpowers/specs/2026-08-20-m4d-sending-domains-design.md` — read §4, §5 and §9 before Task 1.

## Global Constraints

- **`from_email` must never be client-writable.** Migration 0015 writes no `grant update`. See spec §5 — a client able to write it could send as another BIS client, and RLS would never see it.
- **The lead alert (`f/[publicId]/actions.ts`) must not change.** Spec §3. Only `conversations/actions.ts` sends from the client's address.
- **Unset = today's behaviour.** `from_email IS NULL` → the provider's `EMAIL_FROM`.
- **Never weaken the send guard.** Both `VERCEL_ENV === "production"` and `process.env.NODE_ENV === "production"` stay required in `getEmailProvider`.
- **`emit` signature is `emit(db, accountId, type, actorId, payload, actorType = "user")`** — verified in `packages/db/src/events.ts:14`.
- **`withRollback` returns void.** Every assertion goes INSIDE its callback. A previous plan on this project invented a `withConnection` helper that does not exist.
- **House test rule:** an assertion is not evidence until it has been watched to fail against the defect it claims to catch. Every task below names its mutation.

## File Structure

| File | Responsibility |
|---|---|
| `packages/db/supabase/migrations/0015_from_email.sql` | **Create** — the column, and a comment explaining the deliberately absent grant |
| `packages/db/src/sending-identity.ts` | **Create** — `getSendingIdentity` / `setFromEmail`. Agency-only data, kept out of `Branding` |
| `packages/db/src/index.ts` | **Modify** — export the two new functions |
| `packages/db/src/test/sending-identity.test.ts` | **Create** — accessor behaviour |
| `packages/db/src/test/client-branding-grants.test.ts` | **Modify** — pin `from_email` as NOT granted |
| `apps/web/src/lib/email/types.ts` | **Modify** — `fromAddress?` on `SendEmailInput` |
| `apps/web/src/lib/email/resend.ts` | **Modify** — resolve `input.fromAddress ?? this.#fromAddress` |
| `apps/web/src/lib/email/resend.test.ts` | **Modify** — override and fallback |
| `apps/web/src/lib/email/preflight.ts` | **Create** — `verifyFromAddress`, the save gate |
| `apps/web/src/lib/email/preflight.test.ts` | **Create** — gate behaviour |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts` | **Modify** — pass the account's `from_email` |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts` | **Modify** — `setFromEmailAction` |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/sending-address-card.tsx` | **Create** — the agency-only card |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx` | **Modify** — render the card |
| `apps/web/src/lib/messages.ts` | **Modify** — card copy + the DMARC checklist fix |
| `apps/web/e2e/client-branding.spec.ts` | **Modify** — the field is absent from a client's page |

---

### Task 1: Migration 0015 — the column, and the grant that must not exist

**Files:**
- Create: `packages/db/supabase/migrations/0015_from_email.sql`
- Modify: `packages/db/src/test/client-branding-grants.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `public.accounts.from_email text` (nullable, no default, **no** `authenticated` UPDATE grant).

- [ ] **Step 1: Write the failing assertion**

In `packages/db/src/test/client-branding-grants.test.ts`, add `'from_email'` to the column list in the second test. Replace that test's query and add the explanatory comment:

```ts
  it("does not grant UPDATE on client_access_enabled, the escalation this prevents", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name
           from information_schema.column_privileges
          where grantee = 'authenticated'
            and table_schema = 'public'
            and table_name = 'accounts'
            and privilege_type = 'UPDATE'
            and column_name in ('client_access_enabled', 'name', 'clerk_org_id', 'agency_id', 'from_email')`,
      );
      expect(rows).toEqual([]);
    });
  });
```

Above `BRANDING_COLUMNS`, add:

```ts
/**
 * `from_email` is deliberately NOT in this list and must never be added.
 * Resend accepts a send from any domain verified on OUR account, not only the
 * requesting tenant's — so a client able to write this column could send as
 * another BIS client, without touching a single row of theirs, which means RLS
 * never sees it. The exact-set test above cannot catch its addition on its own
 * (a column with no grant simply does not appear), so the second test names it
 * explicitly. See spec §5.
 */
```

- [ ] **Step 2: Run it and confirm it PASSES for the wrong reason**

Run: `pnpm --filter @bis/db test -- client-branding-grants --run`
Expected: PASS — the column does not exist yet, so it cannot be granted. This is why Step 5's mutation is the real proof, not this run.

- [ ] **Step 3: Write the migration**

Create `packages/db/supabase/migrations/0015_from_email.sql`:

```sql
-- The address a client's outbound email leaves FROM.
--
-- Today everything sends as EMAIL_FROM (crm@bis-rgv.com) with the client's
-- brand as the display name, so a customer sees "Acme Corp <crm@bis-rgv.com>".
-- The name is theirs and the domain is ours.
--
-- Nullable, no default. Every existing account starts unset, and unset is a
-- documented state rather than a gap: the send path falls back to EMAIL_FROM,
-- which is exactly the behaviour today.
alter table public.accounts add column from_email text;

-- ⚠️ THE ABSENT GRANT IS THE POINT. DO NOT "FIX" THIS BY ADDING ONE.
--
-- 0013 revoked UPDATE on public.accounts from `authenticated` and granted it
-- back on a named list, and 0014 added reply_to_email to that list, obeying
-- 0013's warning that "adding a branding column later means adding it here."
--
-- This column inverts that warning deliberately. It is AGENCY-ONLY, because
-- Resend accepts a send from any domain verified on our account -- not only
-- the one belonging to the tenant making the request. A client able to write
-- this column could set another BIS client's verified domain and send mail as
-- that company, without touching a single row belonging to them. RLS, which is
-- this platform's whole isolation story, would never see it.
--
-- client-branding-grants.test.ts names from_email in its not-granted assertion
-- so this stays pinned rather than resting on this comment.
```

- [ ] **Step 4: Apply the migration**

Run: `pnpm --filter @bis/db exec supabase db push` — **or** apply `0015_from_email.sql` through the Supabase SQL editor if the CLI is not linked.

⚠️ There is exactly ONE Supabase project and production reads it, so this changes production's schema. That is safe here **only** because the column is nullable with no default and nothing reads it until Task 4: no existing row changes meaning.

Verify: `select column_name from information_schema.columns where table_name='accounts' and column_name='from_email';` returns one row.

- [ ] **Step 5: Mutation-check the assertion**

Run against the database:

```sql
grant update (from_email) on public.accounts to authenticated;
```

Run: `pnpm --filter @bis/db test -- client-branding-grants --run`
Expected: **FAIL** — the not-granted test returns a `from_email` row. Then revert:

```sql
revoke update (from_email) on public.accounts from authenticated;
```

Re-run: PASS. **Do not skip the revoke.**

- [ ] **Step 6: Commit**

```bash
git add packages/db/supabase/migrations/0015_from_email.sql packages/db/src/test/client-branding-grants.test.ts
git commit -m "feat(db): add accounts.from_email, deliberately without a client grant"
```

---

### Task 2: The sending-identity accessor

**Files:**
- Create: `packages/db/src/sending-identity.ts`
- Create: `packages/db/src/test/sending-identity.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `accounts.from_email` (Task 1); `emit` from `./events`.
- Produces:
  - `type SendingIdentity = { fromEmail: string | null }`
  - `getSendingIdentity(db: SupabaseClient, accountId: string): Promise<SendingIdentity>`
  - `setFromEmail(db: SupabaseClient, accountId: string, fromEmail: string | null, actorId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/test/sending-identity.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { getSendingIdentity, setFromEmail } from "../sending-identity";

/**
 * Kept out of `Branding` on purpose. `Branding` is a CLIENT-WRITABLE type and
 * this column must never be client-writable (spec §4, §5), so mixing the two
 * write-scopes in one type is the thing being avoided.
 */
describe("sending identity", () => {
  it("reads null for an account that has never set one", async () => {
    await withTestAccount(async (db, accountId) => {
      expect((await getSendingIdentity(db, accountId)).fromEmail).toBeNull();
    });
  });

  it("writes an address, reads it back, and emits the event", async () => {
    await withTestAccount(async (db, accountId) => {
      await setFromEmail(db, accountId, "leads@acme.com", "user_test");
      expect((await getSendingIdentity(db, accountId)).fromEmail).toBe("leads@acme.com");

      const { data: ev } = await db.from("events").select("type, actor_type, actor_id")
        .eq("account_id", accountId).eq("type", "account.sending_identity_updated").single();
      expect(ev).toMatchObject({
        type: "account.sending_identity_updated", actor_type: "user", actor_id: "user_test",
      });
    });
  });

  it("clears with null", async () => {
    await withTestAccount(async (db, accountId) => {
      await setFromEmail(db, accountId, "leads@acme.com", "user_test");
      await setFromEmail(db, accountId, null, "user_test");
      expect((await getSendingIdentity(db, accountId)).fromEmail).toBeNull();
    });
  });

  /**
   * The assertion that matters most. PostgREST returns NO error and NO rows
   * for an update matching nothing, which is indistinguishable from success —
   * two milestones on this project have already lost work to exactly that.
   */
  it("throws rather than reporting success for an account that does not exist", async () => {
    await withTestAccount(async (db) => {
      await expect(
        setFromEmail(db, "00000000-0000-0000-0000-000000000000", "x@y.com", "user_test"),
      ).rejects.toThrow(/no account/);
    });
  });
});
```

This is the pattern `branding.test.ts` uses — verified, not assumed. `withTestAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>)` from `./fixtures` is the only account-scoped helper in this package. **`withRollback`/`actAsOwner` in `test/db.ts` are a different thing** — they take a raw `pg` Client and `actAsOwner(c)` merely runs `reset role` and returns nothing. They are for catalog/RLS assertions (see `client-branding-grants.test.ts`), not accessor tests. Do not mix them up.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @bis/db test -- sending-identity --run`
Expected: FAIL — `Cannot find module '../sending-identity'`.

- [ ] **Step 3: Write the accessor**

Create `packages/db/src/sending-identity.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit } from "./events";

/**
 * The address an account's outbound email leaves FROM.
 *
 * Its own type and its own accessor, NOT part of `Branding`. The reply-to
 * milestone left the instruction to extract an email identity the day a
 * per-account From arrived, and the reason is stronger than tidiness:
 * `Branding` is client-writable and this column must never be. Keeping the two
 * write-scopes in separate types makes the mistake unavailable rather than
 * merely discouraged. See spec §4.
 *
 * `reply_to_email` deliberately stays on `Branding` — a client edits that one
 * on their own page, and moving working code for symmetry would be churn.
 */
export type SendingIdentity = {
  /** null means "send as EMAIL_FROM", which is every account until set. */
  fromEmail: string | null;
};

/**
 * Reads one account's sending identity.
 *
 * A row that does not exist reads as unset rather than throwing, matching
 * getBranding: a missing account is the caller's problem to detect, and this
 * read is on paths that must not 500 over it.
 */
export async function getSendingIdentity(
  db: SupabaseClient, accountId: string,
): Promise<SendingIdentity> {
  const { data, error } = await db.from("accounts")
    .select("from_email").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`getSendingIdentity failed: ${error.message}`);
  return { fromEmail: data?.from_email ?? null };
}

/**
 * Sets or clears one account's from-address. SERVER ONLY, agency-gated at the
 * call site — there is no column grant that would let a client reach this.
 *
 * `null` clears. Unlike setBranding there is no undefined-means-leave-alone
 * case, because there is exactly one field: a caller with nothing to say
 * simply does not call this.
 */
export async function setFromEmail(
  db: SupabaseClient, accountId: string, fromEmail: string | null, actorId: string,
): Promise<void> {
  // `.select("id")` so the update reports WHICH rows it touched. PostgREST
  // returns no error and no rows for an update matching nothing, which reads
  // as success and would report a save that changed nothing.
  const { data, error } = await db.from("accounts")
    .update({ from_email: fromEmail }).eq("id", accountId).select("id");
  if (error) throw new Error(`setFromEmail failed: ${error.message}`);
  if (!data?.length) throw new Error(`setFromEmail: no account ${accountId}`);
  await emit(db, accountId, "account.sending_identity_updated", actorId, {
    fromEmail,
  });
}
```

- [ ] **Step 4: Export from the package**

In `packages/db/src/index.ts`, add alongside the existing exports:

```ts
export { getSendingIdentity, setFromEmail, type SendingIdentity } from "./sending-identity";
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @bis/db test -- sending-identity --run`
Expected: PASS (4 tests).

- [ ] **Step 6: Mutation-check the no-account assertion**

Temporarily delete the two lines:

```ts
  if (!data?.length) throw new Error(`setFromEmail: no account ${accountId}`);
```

and change `.select("id")` to nothing (`.update({...}).eq("id", accountId)`).

Run: `pnpm --filter @bis/db test -- sending-identity --run`
Expected: **FAIL** on "throws rather than reporting success". Restore both lines, re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/sending-identity.ts packages/db/src/test/sending-identity.test.ts packages/db/src/index.ts
git commit -m "feat(db): a sending identity of its own, kept out of client-writable branding"
```

---

### Task 3: A per-send from-address on the email provider

**Files:**
- Modify: `apps/web/src/lib/email/types.ts`
- Modify: `apps/web/src/lib/email/resend.ts`
- Modify: `apps/web/src/lib/email/resend.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SendEmailInput.fromAddress?: string` — absent means the provider's configured address.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/email/resend.test.ts`, inside the existing `describe("resendEmailProvider", ...)`:

```ts
  it("sends from the per-send address when one is given", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Acme Corp",
      fromAddress: "leads@acme.com",
      subject: "Hi", body: "plain",
    });

    expect(sendMock.mock.calls[0]![0].from).toBe("Acme Corp <leads@acme.com>");
  });

  // The fallback every unset account relies on, and the lead alert always.
  it("falls back to the configured address when none is given", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    await provider.send({
      to: "customer@example.com", fromName: "Acme Corp",
      subject: "Hi", body: "plain",
    });

    expect(sendMock.mock.calls[0]![0].from).toBe("Acme Corp <crm@bis-rgv.com>");
  });
```

- [ ] **Step 2: Run to verify the first fails**

Run: `pnpm --filter web test -- resend.test.ts --run`
Expected: the override test FAILS (typecheck rejects `fromAddress`, or `from` is `Acme Corp <crm@bis-rgv.com>`). The fallback test PASSES already — it pins existing behaviour.

- [ ] **Step 3: Add the optional field**

In `apps/web/src/lib/email/types.ts`, add to `SendEmailInput` after `fromName`:

```ts
  /** Overrides the provider's configured from-address for THIS SEND only.
   *
   *  Optional so every existing caller is unchanged: absent means the platform
   *  address, exactly as before. That is what keeps the lead alert on
   *  crm@bis-rgv.com without it having to say so — see spec §3, where sending
   *  a client's own staff mail from their own domain is a deliverability risk
   *  on the one message that must never be quarantined. */
  fromAddress?: string;
```

- [ ] **Step 4: Resolve it in the provider**

In `apps/web/src/lib/email/resend.ts`, change the `from` line inside `send`:

```ts
      from: `${input.fromName} <${input.fromAddress ?? this.#fromAddress}>`,
```

- [ ] **Step 5: Run to verify both pass**

Run: `pnpm --filter web test -- resend.test.ts --run`
Expected: PASS (4 tests).

- [ ] **Step 6: Mutation-check the fallback**

Change the line to `` from: `${input.fromName} <${input.fromAddress}>` `` (drop the fallback).
Run the file. Expected: **FAIL** on "falls back to the configured address" with `from` reading `Acme Corp <undefined>`. Restore, re-run: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/email/types.ts apps/web/src/lib/email/resend.ts apps/web/src/lib/email/resend.test.ts
git commit -m "feat(email): let a send carry its own from-address, falling back to the platform's"
```

---

### Task 4: The outbound call site uses the client's address

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts`
- Modify: `apps/web/src/app/f/[publicId]/actions.test.ts`

**Interfaces:**
- Consumes: `SendEmailInput.fromAddress` (Task 3); `accounts.from_email` (Task 1).
- Produces: outbound customer email sent from the account's address when set.

- [ ] **Step 1: Widen the existing select**

In `conversations/actions.ts`, the account lookup already fetches a column list — add `from_email` to it. Change:

```ts
  const { data: account } = await db.from("accounts")
    .select("name, reply_to_email, brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", accountId).maybeSingle();
```

to:

```ts
  const { data: account } = await db.from("accounts")
    .select("name, reply_to_email, from_email, brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode")
    .eq("id", accountId).maybeSingle();
```

This costs no extra query — the row is already being read for the brand and the reply-to.

- [ ] **Step 2: Pass it to the send**

In the same file, inside the `getEmailProvider().send({ ... })` call, add after `fromName`:

```ts
      // The client's own domain, when they have one. Undefined falls back to
      // EMAIL_FROM inside the provider, which is every account until the agency
      // sets one — and stays the behaviour for the lead alert always (spec §3).
      fromAddress: account?.from_email ?? undefined,
```

- [ ] **Step 3: Pin the lead alert as unchanged**

This is the assertion that stops a later "consistency" edit silently discarding §3's deliverability reasoning.

The harness already exists. `apps/web/src/app/f/[publicId]/actions.test.ts:18` mocks the email module as `vi.mock("@/lib/email", () => ({ getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }) }))`, so `sendMock` observes the lead alert directly.

Add to that file, inside the describe that already exercises a successful submission — reuse whichever existing test drives a submission through to the notify step rather than building a new fixture:

```ts
  it("sends the lead alert from the platform address, never the client's domain", async () => {
    // Deliberate, and load-bearing: this message goes to the CLIENT'S OWN
    // STAFF. acme.com -> acme.com through a third-party sender is the shape
    // corporate filters treat as internal spoofing, and nothing downstream
    // retries a lead alert — notified_at records an attempt, not a receipt.
    // See spec §3.
    expect(sendMock).toHaveBeenCalled();
    expect(sendMock.mock.calls[0]![0].fromAddress).toBeUndefined();
  });
```

- [ ] **Step 4: Run the suites**

Run: `pnpm --filter web test --run`
Expected: PASS, with the new lead-alert assertion included.

- [ ] **Step 5: Mutation-check**

In `f/[publicId]/actions.ts`, temporarily add `fromAddress: account?.from_email ?? undefined,` to the lead alert's send, and set a `from_email` on the test fixture's account.
Run the file. Expected: **FAIL** on the new assertion. Revert both edits, re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts" apps/web/src/app/f/
git commit -m "feat(conversations): a client's email to a customer leaves from their own domain"
```

---

### Task 5: The preflight gate

**Files:**
- Create: `apps/web/src/lib/email/preflight.ts`
- Create: `apps/web/src/lib/email/preflight.test.ts`

**Interfaces:**
- Consumes: `EmailProvider` and `SendEmailInput.fromAddress` (Task 3).
- Produces: `verifyFromAddress(provider: EmailProvider, fromAddress: string, to: string): Promise<void>` — resolves if the address can send, throws with the provider's own message otherwise.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/email/preflight.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { verifyFromAddress } from "./preflight";
import type { EmailProvider } from "./types";

function providerThat(send: EmailProvider["send"], isFake = false): EmailProvider {
  return { isFake, send };
}

describe("verifyFromAddress", () => {
  it("sends one message from the candidate address to the given recipient", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "re_1" });
    await verifyFromAddress(providerThat(send), "leads@acme.com", "admin@bis-rgv.com");

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: "admin@bis-rgv.com",
      fromAddress: "leads@acme.com",
    });
  });

  /**
   * The property this whole gate exists for. Resend rejects an unverified
   * sender with a synchronous 403 validation_error carrying "The domain.com
   * domain is not verified" — so the caller must see THAT wording, not a
   * message this module invented. See spec §7.
   */
  it("rethrows the provider's own message so the operator sees Resend's wording", async () => {
    const send = vi.fn().mockRejectedValue(
      new Error("The acme.com domain is not verified. Please, add and verify your domain."),
    );
    await expect(
      verifyFromAddress(providerThat(send), "leads@acme.com", "admin@bis-rgv.com"),
    ).rejects.toThrow(/acme\.com domain is not verified/);
  });

  /**
   * Outside production getEmailProvider returns the fake, which delivers
   * nothing and therefore proves nothing. It must SAY so rather than resolve
   * quietly — a green save on a laptop is not evidence a domain is verified.
   */
  it("refuses to certify anything when the provider is the fake", async () => {
    const send = vi.fn().mockResolvedValue({ providerMessageId: "fake_x" });
    await expect(
      verifyFromAddress(providerThat(send, true), "leads@acme.com", "admin@bis-rgv.com"),
    ).rejects.toThrow(/cannot be verified outside production/i);
    expect(send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web test -- preflight --run`
Expected: FAIL — `Cannot find module './preflight'`.

- [ ] **Step 3: Write the gate**

Create `apps/web/src/lib/email/preflight.ts`:

```ts
import type { EmailProvider } from "./types";

/**
 * Proves an address can actually send BEFORE it is stored.
 *
 * Setting a from-address whose domain is not verified breaks every outbound
 * email for that client, and the breakage is invisible until a customer does
 * not reply. Resend rejects an unverified sender synchronously with a 403
 * validation_error, so one real send is a sufficient gate — and it needs no
 * key beyond the sending key already in production, which is the property
 * agency-run provisioning was chosen to keep (spec §2 decision 1, §7).
 *
 * ⚠️ It does NOT prove the domain is authenticated well enough to LAND.
 * Verified and deliverable are different properties: a domain with no DMARC
 * record is accepted by the receiving server and then filed or discarded, and
 * nothing here or in Resend's webhook can see that happen. See spec §9 — this
 * is why no "deliverability" indicator may be built on top of this function.
 */
export async function verifyFromAddress(
  provider: EmailProvider, fromAddress: string, to: string,
): Promise<void> {
  // The fake delivers nothing, so letting it resolve would report a
  // verification that never happened — the exact class of lie this gate
  // exists to prevent. Fail loudly instead of certifying silence.
  if (provider.isFake) {
    throw new Error(
      "A sending address cannot be verified outside production, because email is suppressed there.",
    );
  }

  // Deliberately unguarded: the caller must see the provider's own wording.
  // Resend's message names the domain and tells the operator what to do, and
  // anything this module substituted would be worse.
  await provider.send({
    to,
    fromName: "BIS Platform",
    fromAddress,
    subject: "Sending address check",
    body: `This confirms ${fromAddress} can send from this platform. No action needed.`,
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web test -- preflight --run`
Expected: PASS (3 tests).

- [ ] **Step 5: Mutation-check the fake guard**

Delete the `if (provider.isFake) { ... }` block.
Run the file. Expected: **FAIL** on "refuses to certify anything when the provider is the fake". Restore, re-run: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/email/preflight.ts apps/web/src/lib/email/preflight.test.ts
git commit -m "feat(email): prove a from-address can send before storing it"
```

---

### Task 6: The agency-only Settings card

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/sending-address-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `getSendingIdentity`/`setFromEmail` (Task 2), `verifyFromAddress` (Task 5).
- Produces: `setFromEmailAction(accountId: string, formData: FormData): Promise<void>`.

- [ ] **Step 1: Add the copy**

In `apps/web/src/lib/messages.ts`, beside the other `settings.*` keys:

```ts
  "settings.sendingAddress": "Sending address",
  "settings.sendingAddressBody": "The address this company's email to their customers goes out from. Verify the domain in Resend and add its DNS records first — saving sends a test message and fails if the domain is not verified.",
  "settings.sendingAddressPlaceholder": "leads@theircompany.com",
  "settings.sendingAddressDefault": "Using the platform address (crm@bis-rgv.com).",
  "settings.sendingAddressSaved": "Sending address updated",
  "settings.sendingAddressBad": "Enter an email address, like leads@theircompany.com.",
```

⚠️ `messages.test.ts` asserts no string carries an internal roadmap label (`/\bM\d[a-z]?\b/`). None of the above do — keep it that way.

- [ ] **Step 2: Write the action**

In `settings/actions.ts`, add the imports and the action:

```ts
import { clerkClient } from "@clerk/nextjs/server";
import { getSendingIdentity, setFromEmail } from "@bis/db";
import { getEmailProvider } from "@/lib/email";
import { verifyFromAddress } from "@/lib/email/preflight";
```

```ts
/**
 * Agency-only, and there is no column grant that would let a client reach this
 * even if the guard were removed (spec §5) — the boundary is enforced twice.
 *
 * The preflight runs BEFORE the write, so a domain that is not verified in
 * Resend never reaches the column. Storing it first and letting the send fail
 * later would break every outbound email for that client, invisibly.
 */
export async function setFromEmailAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);
  const raw = String(formData.get("fromEmail") ?? "").trim();

  if (!raw) {
    await setFromEmail(await dbForRequest(), accountId, null, userId);
    revalidatePath(`/dashboard/accounts/${accountId}/settings`);
    return;
  }

  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(raw)) {
    throw new Error(m["settings.sendingAddressBad"]);
  }

  // To the admin making the change: no new configuration, and the failure
  // lands in front of the person who caused it.
  const clerk = await clerkClient();
  const admin = await clerk.users.getUser(userId);
  const adminEmail = admin.primaryEmailAddress?.emailAddress;
  if (!adminEmail) throw new Error("Cannot verify a sending address without an admin email address.");

  await verifyFromAddress(getEmailProvider(), raw, adminEmail);
  await setFromEmail(await dbForRequest(), accountId, raw, userId);
  revalidatePath(`/dashboard/accounts/${accountId}/settings`);
}
```

⚠️ **A known coverage limit, recorded rather than hidden.** The load-bearing property here is the ORDER — `verifyFromAddress` must complete before `setFromEmail` runs, so a rejected address never reaches the column. `apps/web` has no server-action unit harness (the same limitation the brand-colour milestone recorded), so nothing pins that ordering and a future edit could swap the two lines with every suite still green. Task 5 covers the gate in isolation and Task 2 covers the write in isolation; the seam between them rests on the comment above it. **Do not "fix" this by weakening the send guard to make the action testable.** If a reviewer wants it pinned, the cheap option is extracting the two-step sequence into a plain async function taking both as parameters — worth doing only if the review asks.

`m`, `requireAgencyOnlyAccountAccess`, `dbForRequest` and `revalidatePath` are already imported in this file — verified. Note it carries a file-level `"use server"`, which may export **async functions only**: a sync helper or a const added here fails the build. Put any helper in a sibling module.

- [ ] **Step 3: Write the card**

Create `settings/sending-address-card.tsx`:

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "@/app/(dashboard)/dashboard/accounts/submit-button";
import { m } from "@/lib/messages";

/**
 * Agency-only by construction: this component is rendered from the Settings
 * page, which is gated by requireAgencyOnlyAccountAccess. It is deliberately
 * NOT part of BrandingPanel — that panel also renders on the client's own
 * /branding page, and a client must never see or set this (spec §4, §5).
 */
export function SendingAddressCard({
  fromEmail, action,
}: {
  fromEmail: string | null;
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m["settings.sendingAddress"]}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          {m["settings.sendingAddressBody"]}
        </p>
        <form action={action} className="flex flex-col gap-3">
          <Label htmlFor="fromEmail">{m["settings.sendingAddress"]}</Label>
          <Input
            id="fromEmail"
            name="fromEmail"
            type="email"
            defaultValue={fromEmail ?? ""}
            placeholder={m["settings.sendingAddressPlaceholder"]}
          />
          {!fromEmail && (
            <p className="text-xs text-muted-foreground">
              {m["settings.sendingAddressDefault"]}
            </p>
          )}
          <SubmitButton>{m["common.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
```

⚠️ Confirm the import paths for `Card`, `Input`, `Label` and `SubmitButton` against a sibling that already uses them (`client-access-panel.tsx`). Match that file rather than these guesses if they differ.

- [ ] **Step 4: Render it**

In `settings/page.tsx`, add `getSendingIdentity(db, accountId)` to the existing `Promise.all` and destructure it as `sendingIdentity`, then render the card beside the other cards:

```tsx
<SendingAddressCard
  fromEmail={sendingIdentity.fromEmail}
  action={setFromEmailAction.bind(null, accountId)}
/>
```

Add the imports: `import { getSendingIdentity } from "@bis/db";`, `import { SendingAddressCard } from "./sending-address-card";`, and `setFromEmailAction` from `./actions`.

- [ ] **Step 5: Run the gates**

Run: `pnpm check`
Expected: EXIT 0 — typecheck, lint, and both unit suites green.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings" apps/web/src/lib/messages.ts
git commit -m "feat(settings): set a company's sending address, gated by a real send"
```

---

### Task 7: The DMARC correction, and proof a client cannot reach this

**Files:**
- Modify: `apps/web/src/lib/messages.ts`
- Modify: `apps/web/e2e/client-branding.spec.ts`

**Interfaces:**
- Consumes: the Settings card (Task 6).
- Produces: nothing downstream. This is the last task.

- [ ] **Step 1: Fix the checklist copy**

The current text teaches the wrong thing — DKIM alone is not enough, and a domain without DMARC has its mail accepted and then discarded with every system reporting `delivered` (spec §9). In `messages.ts`, replace:

```ts
  "checklist.email_domain.title": "Add a sending subdomain and DKIM",
  "checklist.email_domain.help":
    "Done in Resend, then the DNS records at the domain host. A subdomain keeps this client's sending reputation separate.",
```

with:

```ts
  "checklist.email_domain.title": "Add a sending subdomain, DKIM and DMARC",
  "checklist.email_domain.help":
    "Done in Resend, then the DNS records at the domain host. DKIM alone is not enough — without a DMARC record the receiving server accepts the mail and may discard it, and every system here will still say delivered. Check the domain's Insights in Resend before the client sends anything real. A subdomain keeps this client's sending reputation separate.",
```

- [ ] **Step 2: Run the messages guard**

Run: `pnpm --filter web test -- messages.test.ts --run`
Expected: PASS. `checklist.email_domain.help` is not on the roadmap-label allowlist and must not acquire a label.

- [ ] **Step 3: Write the absence assertion**

In `apps/web/e2e/client-branding.spec.ts`, add to the existing client-branding test:

```ts
  // A client must never see or set the sending address. The structural
  // guarantee is that the column carries no grant (spec §5); this is the
  // surface-level half of the same boundary.
  await expect(page.getByLabel("Sending address")).toHaveCount(0);
```

⚠️ Match the file's existing locator style and fixture. If it navigates to `/branding` already, add the assertion there rather than writing a new test.

- [ ] **Step 4: Run e2e**

Run: `pnpm --filter web test:e2e`
Expected: PASS.

⚠️ **Judge a red by WALL CLOCK, not failure count.** Cold runs take 6–8 minutes and fail spuriously; warm runs are ~2.1–2.6 minutes. Two consecutive reds is still not proof. Before believing one: re-run → run the failing spec alone → audit the dev DB read-only.

- [ ] **Step 5: Full gates**

```bash
pnpm check
pnpm --filter web build
```
Expected: both EXIT 0.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/e2e/client-branding.spec.ts
git commit -m "fix(checklist): DKIM alone is not enough, and prove a client cannot set a sending address"
```

---

## Before this milestone can be verified in production

Not code, and not optional — recorded here so it is not discovered at the end:

1. **The production Resend key must be replaced** with one carrying no domain restriction. Scope is fixed at creation; `PATCH /api-keys/{id}` accepts `name` only. Full procedure in spec §8. **Until this is done every client-domain send fails**, and the preflight in Task 5 is what will report it.
2. **Every client domain needs SPF + DKIM + DMARC**, checked in Resend's per-domain Insights. Spec §9. A domain missing DMARC produces mail that is accepted and then discarded while `messages.status` reads `delivered`.
3. **The preflight cannot be exercised outside production** — the fake provider makes Task 5's third test the only coverage of that path. The first production save is the real proof, and it should be done against a domain you know is verified before one you do not.
