# Reply-to address Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reply to mail this platform sends reaches the right mailbox — the customer for a lead notification, the client for an outbound email — instead of always landing in the BIS inbox.

**Architecture:** `replyTo` is already typed and already passed to Resend; no caller populates it. The lead notification takes the address from the submission itself (`enrich` already computes it). The outbound path takes it from a new `accounts.reply_to_email` column that rides the existing branding read/write path, so both editing surfaces come free from the shared `BrandingPanel`.

**Tech Stack:** Next 16 App Router, TypeScript, Supabase/PostgREST, Resend, vitest, Playwright.

Spec: `docs/superpowers/specs/2026-08-16-reply-to-address-design.md`.

## Global Constraints

- **Migration 0014 must add `reply_to_email` to the `grant update (...)` list from 0013.** Without it the field saves for the agency (service role is bound by neither grants nor RLS) and **silently fails for every client**.
- **Unset means the header is OMITTED.** Never send `replyTo: ""` — an empty string is not the same as absent to Resend. Never fall back to the sending user's address.
- **`branding-panel.tsx` is a client component and must NOT import `@/lib/forms/guards`** (it pulls `node:crypto`). Address validation happens in the server action only.
- **Any string added to `panel-copy.ts` needs BOTH audience variants.** Its test asserts an exact key set across both and that no client string uses the third person.
- Mail continues to go **from `crm@bis-rgv.com`**. This changes where replies land, not who the message is from.
- Commit after every task. Run gates with the command last so no pipe eats the exit code.

---

### Task 1: Migration 0014 — the column and the grant

**Files:**
- Create: `packages/db/supabase/migrations/0014_reply_to_email.sql`
- Modify: `packages/db/src/test/client-branding-grants.test.ts:14-22` and its first `it` title

**Interfaces:**
- Consumes: the grant list established by `0013_client_branding.sql`
- Produces: column `public.accounts.reply_to_email text`, granted UPDATE to `authenticated`

- [ ] **Step 1: Update the grants test to expect the new column**

In `packages/db/src/test/client-branding-grants.test.ts`, add the column to the exact set and drop the stale count from the test name:

```ts
const BRANDING_COLUMNS = [
  "brand_color",
  "brand_corners",
  "brand_logo_path",
  "brand_mode",
  "brand_name",
  "brand_neutral",
  "brand_type",
  "reply_to_email",
].sort();
```

```ts
  it("grants UPDATE on exactly the branding columns a client may write", async () => {
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/db && pnpm vitest run src/test/client-branding-grants.test.ts`
Expected: FAIL — the received array lacks `reply_to_email`.

- [ ] **Step 3: Write the migration**

Create `packages/db/supabase/migrations/0014_reply_to_email.sql`:

```sql
-- Where a reply goes.
--
-- Everything this platform sends comes FROM crm@bis-rgv.com, so every reply to
-- a client's outbound email lands in the BIS mailbox. `replyTo` has been typed
-- and passed to Resend since M1b with no caller populating it; this column is
-- the missing half.
--
-- Nullable with no default. Every existing account starts unset, and unset is a
-- documented state: the send path omits the header entirely, which is exactly
-- today's behaviour.
alter table public.accounts add column reply_to_email text;

-- 0013 revoked UPDATE on public.accounts from `authenticated` and granted it
-- back on a named list, because an UPDATE policy is ROW-scoped and never
-- column-scoped. That file's own warning applies here:
--
--   "⚠️ ADDING A BRANDING COLUMN LATER MEANS ADDING IT HERE. Otherwise it saves
--    for the agency and silently fails for clients."
--
-- The agency writes through the service role, which is bound by neither column
-- grants nor RLS, so omitting this line produces a bug the agency cannot see
-- and the client cannot escape. client-branding-grants.test.ts asserts the set
-- EXACTLY, in both directions.
--
-- `grant update (col)` is additive — it does not disturb the seven columns
-- granted by 0013.
grant update (reply_to_email) on public.accounts to authenticated;
```

- [ ] **Step 4: Apply it to the dev database (which production reads)**

There is exactly one Supabase project — `bis-platform-dev` / `tlbkbmlrfafquucsmsmm` — and Vercel production points at it.

Apply with the Supabase MCP `apply_migration` tool (project `tlbkbmlrfafquucsmsmm`, name `0014_reply_to_email`), or:

Run: `psql "$SUPABASE_DB_URL" -f packages/db/supabase/migrations/0014_reply_to_email.sql`

**Record it as applied. DO NOT RE-APPLY** — `add column` is not idempotent and will error on a second run.

- [ ] **Step 5: Run the grants test to verify it passes**

Run: `cd packages/db && pnpm vitest run src/test/client-branding-grants.test.ts`
Expected: PASS, all three tests.

- [ ] **Step 6: Mutation-check the grant**

Temporarily remove `reply_to_email` from `BRANDING_COLUMNS` in the test and re-run: it must FAIL with the received array containing a column the expectation lacks. Restore it. This proves the assertion is an exact set in both directions rather than a subset check.

- [ ] **Step 7: Commit**

```bash
git add packages/db/supabase/migrations/0014_reply_to_email.sql packages/db/src/test/client-branding-grants.test.ts
git commit -m "feat(db): a per-account reply-to address, writable by the client"
```

---

### Task 2: The `Branding` type, `getBranding` and `setBranding`

**Files:**
- Modify: `packages/db/src/branding.ts:71-79` (type), `:92-110` (setBranding), `:141-157` (getBranding)
- Modify: `packages/db/src/test/branding.test.ts`

**Interfaces:**
- Consumes: `reply_to_email` column from Task 1
- Produces: `Branding.replyToEmail: string | null`; `setBranding(db, accountId, { replyToEmail?: string | null }, actorId)`

- [ ] **Step 1: Write the failing test**

The existing first test asserts the whole object with `toEqual`, so it must gain the new key — that exact-object shape is what forces every field to be accounted for. In `packages/db/src/test/branding.test.ts`, add `replyToEmail: null` to that assertion, then add this test:

```ts
  it("writes, reads back and clears the reply-to address", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { replyToEmail: "hello@rioroofing.com" }, "user_test");
      expect((await getBranding(db, accountId)).replyToEmail).toBe("hello@rioroofing.com");

      // `undefined` means leave alone — the panel omits fields it did not edit.
      await setBranding(db, accountId, { brandName: "Rio Roofing" }, "user_test");
      expect((await getBranding(db, accountId)).replyToEmail).toBe("hello@rioroofing.com");

      // An explicit null clears it.
      await setBranding(db, accountId, { replyToEmail: null }, "user_test");
      expect((await getBranding(db, accountId)).replyToEmail).toBeNull();
    });
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/db && pnpm vitest run src/test/branding.test.ts`
Expected: FAIL — `replyToEmail` is not a property the type or the query knows about.

- [ ] **Step 3: Implement**

In `packages/db/src/branding.ts`, add to the `Branding` type:

```ts
  brandMode: "light" | "dark" | "follow" | null;
  /** Where a reply to this company's outbound mail should go. Not visual
   *  branding, and it rides this type deliberately: the client's /branding
   *  page is safe to expose because it reads branding and NOTHING else, and a
   *  second accessor would cost exactly that property. Extract it the day M4d
   *  grows a real email identity (custom domain, per-account From). */
  replyToEmail: string | null;
```

Add to the `setBranding` input type and its patch block:

```ts
    brandType?: Branding["brandType"]; brandMode?: Branding["brandMode"];
    replyToEmail?: string | null;
```

```ts
  if (input.brandMode !== undefined) patch.brand_mode = input.brandMode;
  if (input.replyToEmail !== undefined) patch.reply_to_email = input.replyToEmail;
```

Add to `getBranding`'s select and mapping:

```ts
    .select("brand_name, brand_logo_path, brand_color, brand_neutral, brand_corners, brand_type, brand_mode, reply_to_email")
```

```ts
    brandMode: data?.brand_mode ?? null,
    replyToEmail: data?.reply_to_email ?? null,
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/db && pnpm vitest run src/test/branding.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: exit 0. Any surface constructing a `Branding` literal now needs the key — fix each by adding `replyToEmail: null` where the literal is a fallback for an unbranded account.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/branding.ts packages/db/src/test/branding.test.ts
git commit -m "feat(db): read and write reply_to_email through the branding accessors"
```

---

### Task 3: `normalizeReplyTo` — the guard that stops an empty header

**Files:**
- Create: `apps/web/src/lib/email/reply-to.ts`
- Create: `apps/web/src/lib/email/reply-to.test.ts`

**Interfaces:**
- Produces: `normalizeReplyTo(value: string | null | undefined): string | undefined`, used by both send sites in Tasks 4 and 5

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/email/reply-to.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeReplyTo } from "./reply-to";

describe("normalizeReplyTo", () => {
  it("returns the address when there is one", () => {
    expect(normalizeReplyTo("hello@rioroofing.com")).toBe("hello@rioroofing.com");
    expect(normalizeReplyTo("  hello@rioroofing.com  ")).toBe("hello@rioroofing.com");
  });

  // The whole reason this function exists. `replyTo: ""` is NOT the same as
  // omitting the header, and every one of these reaches the send path today:
  // an unset column is null, a cleared form field is "", and a form with no
  // email field yields "" from the byKind map.
  it("returns undefined for every flavour of absent", () => {
    expect(normalizeReplyTo(null)).toBeUndefined();
    expect(normalizeReplyTo(undefined)).toBeUndefined();
    expect(normalizeReplyTo("")).toBeUndefined();
    expect(normalizeReplyTo("   ")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run src/lib/email/reply-to.test.ts`
Expected: FAIL — cannot resolve `./reply-to`.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/email/reply-to.ts`:

```ts
/**
 * The one place an absent reply-to becomes `undefined`.
 *
 * Three unrelated sources feed the send path and each spells "no address"
 * differently: an unset column is `null`, a cleared form field is `""`, and a
 * form with no email question yields `""` from `enrich`'s byKind map. Passing
 * any of them straight through would hand Resend `replyTo: ""`, which is a
 * header with an empty value rather than no header at all.
 */
export function normalizeReplyTo(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd apps/web && pnpm vitest run src/lib/email/reply-to.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/email/reply-to.ts apps/web/src/lib/email/reply-to.test.ts
git commit -m "feat(email): normalize an absent reply-to to an omitted header"
```

---

### Task 4: A lead notification replies to the customer

**Files:**
- Modify: `apps/web/src/app/f/[publicId]/actions.ts` — the `notify()` signature and its `provider.send` call, and the `notify(...)` call inside `enrich`
- Modify: `apps/web/src/app/f/[publicId]/actions.test.ts`

**Interfaces:**
- Consumes: `normalizeReplyTo` from Task 3
- Produces: nothing later tasks depend on

- [ ] **Step 1: Write the failing tests**

Add to `apps/web/src/app/f/[publicId]/actions.test.ts`. The harness already in the file supplies `formRow`, `fd`, `signRenderToken`, `MIN_FILL_MS`, `RENDER_TOKEN_FIELD`, `PUBLIC_ID`, `IDLE` and `sendMock`:

```ts
describe("submitFormAction — the lead notification replies to the customer", () => {
  it("sets reply-to to the address the visitor submitted", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "email", kind: "core.email", label: "Email", required: true }],
      notify_emails: ["owner@rioroofing.com"],
    }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    const result = await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", email: "customer@example.com",
    }));

    expect(result.status).toBe("success");
    // Hitting Reply on "New lead" must reach the person who asked for a quote,
    // not crm@bis-rgv.com — which is where every one of these went until now.
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "owner@rioroofing.com",
      replyTo: "customer@example.com",
    }));
  });

  it("omits reply-to when the form asks for no email address", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(formRow({
      fields: [{ key: "phone", kind: "core.phone", label: "Phone", required: true }],
      notify_emails: ["owner@rioroofing.com"],
    }));
    const token = signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);

    await submitFormAction(PUBLIC_ID, IDLE, fd({
      [RENDER_TOKEN_FIELD]: token, locale: "en", phone: "956-555-0101",
    }));

    expect(sendMock).toHaveBeenCalled();
    // Absent, NOT empty: `replyTo: ""` is a header with no value.
    expect(sendMock.mock.calls[0]![0].replyTo).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && pnpm vitest run "src/app/f/[publicId]/actions.test.ts"`
Expected: the first test FAILS — the object sent has no `replyTo`. (If a test fails earlier than the assertion, the submission was rejected by a guard: check the render token age is above `MIN_FILL_MS` and below `MAX_TOKEN_AGE_MS`.)

- [ ] **Step 3: Implement**

In `apps/web/src/app/f/[publicId]/actions.ts`, import the helper:

```ts
import { normalizeReplyTo } from "@/lib/email/reply-to";
```

`enrich` already builds the map that holds the answer — pass it down. Change the call inside `enrich`:

```ts
    await notify(db, form, contactId, answers, byKind.get("core.email") ?? "");
```

Change `notify`'s signature and its send call:

```ts
async function notify(
  db: ReturnType<typeof serviceDb>, form: FormRow, contactId: string | null,
  answers: { key: string; label: string; value: string }[],
  /** The address the visitor gave, or "" when the form has no email question.
   *  The recipient here is the CLIENT, so the reply must go the other way — to
   *  the customer. Attacker-chosen, and harmless: the Resend SDK takes it as a
   *  JSON field rather than a raw header, so there is nothing to inject, and
   *  the worst a submitter can nominate is their own address. */
  leadEmail: string,
): Promise<void> {
```

```ts
      await provider.send({
        to, fromName: account?.name ?? "BIS",
        subject: `New lead: ${form.name}`, body,
        replyTo: normalizeReplyTo(leadEmail),
      });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run "src/app/f/[publicId]/actions.test.ts"`
Expected: PASS, the whole file.

- [ ] **Step 5: Mutation-check**

Change `replyTo: normalizeReplyTo(leadEmail)` to `replyTo: leadEmail` and re-run. The second test must FAIL (`""` is not `undefined`). Restore. This proves the omit case is genuinely asserted rather than incidentally true.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/f/[publicId]/actions.ts" "apps/web/src/app/f/[publicId]/actions.test.ts"
git commit -m "feat(forms): a lead notification replies to the customer who submitted it"
```

---

### Task 5: An outbound email replies to the client

**Files:**
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts:38` (the account read) and `:47-52` (the send)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts`

**Interfaces:**
- Consumes: `normalizeReplyTo` from Task 3, `accounts.reply_to_email` from Task 1
- Produces: nothing later tasks depend on

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts`. Mock factories reference the mutable row through a closure, so it is read at call time rather than at module-init time — the same shape `f/[publicId]/actions.test.ts` uses for `sendMock`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => ({ userId: "user_1" }) }));

const sendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ send: (...a: unknown[]) => sendMock(...a) }),
}));

// The one direct query the action makes: the account's name and reply-to.
const accountRow: { name: string; reply_to_email: string | null } = {
  name: "Rio Roofing", reply_to_email: null,
};
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: accountRow }) }) }),
    }),
  }),
}));

vi.mock("@bis/db", () => ({
  getContact: async () => ({ id: "contact_1", email: "customer@example.com" }),
  ensureConversation: async () => ({ id: "convo_1" }),
  createMessage: async () => ({ id: "msg_1" }),
  updateMessageStatus: vi.fn(),
  clearUnreadCount: vi.fn(),
}));

import { sendEmailAction } from "./actions";

function fd(entries: Record<string, string>) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(entries)) formData.set(k, v);
  return formData;
}

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "pm_1" });
  accountRow.reply_to_email = null;
});

describe("sendEmailAction — where the customer's reply goes", () => {
  it("replies to the company's own address when one is set", async () => {
    accountRow.reply_to_email = "hello@rioroofing.com";

    await sendEmailAction("acct_1", fd({ contactId: "contact_1", subject: "Hi", body: "Quote attached" }));

    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "customer@example.com",
      replyTo: "hello@rioroofing.com",
    }));
  });

  it("omits reply-to when the company has not set one, exactly as before", async () => {
    await sendEmailAction("acct_1", fd({ contactId: "contact_1", subject: "Hi", body: "Quote attached" }));

    expect(sendMock).toHaveBeenCalled();
    expect(sendMock.mock.calls[0]![0].replyTo).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"`
Expected: the first test FAILS — the sent object has no `replyTo`.

- [ ] **Step 3: Implement**

In `conversations/actions.ts`, import the helper:

```ts
import { normalizeReplyTo } from "@/lib/email/reply-to";
```

Widen the existing account read — no extra query:

```ts
  const { data: account } = await db.from("accounts")
    .select("name, reply_to_email").eq("id", accountId).maybeSingle();
```

Pass it on the send:

```ts
    ({ providerMessageId } = await getEmailProvider().send({
      to: contact.email,
      fromName: account?.name ?? "BIS",
      subject: subject || "(no subject)",
      body,
      // Mail goes out from crm@bis-rgv.com, so without this the customer's
      // reply reaches BIS and never the company that wrote to them. Unset
      // omits the header, which is what every account does until it is set.
      replyTo: normalizeReplyTo(account?.reply_to_email),
    }));
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Mutation-check the query**

Revert the select to `.select("name")` and re-run: the first test must FAIL, because `reply_to_email` is then absent from the row. This is the assertion that the column is actually fetched — the failure mode a reviewer cannot see by reading the send call alone. Restore.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"
git commit -m "feat(conversations): a customer's reply reaches the company, not BIS"
```

---

### Task 6: The field, in both voices, on both surfaces

**Files:**
- Modify: `apps/web/src/lib/messages.ts`
- Modify: `apps/web/src/lib/branding/panel-copy.ts`
- Modify: `apps/web/src/components/branding-panel.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts`

**Interfaces:**
- Consumes: `setBranding({ replyToEmail })` from Task 2
- Produces: form field `name="replyToEmail"`, used by the e2e in Task 8

- [ ] **Step 1: Add the strings, both audiences**

In `apps/web/src/lib/messages.ts`, beside the other branding keys:

```ts
  "branding.replyTo": "Reply-to address",
  "branding.replyToHint": "Where replies land when this company emails a contact, and when you reply to one of their lead alerts. Leave blank to send replies to the BIS mailbox.",
  "branding.clientReplyToHint": "Where replies land when you email a contact. Leave blank and replies come to us instead of you.",
  "branding.badReplyTo": "Enter an email address, like hello@yourcompany.com.",
```

In the client block of `apps/web/src/lib/branding/panel-copy.ts`, extend the type and both maps:

```ts
  modeFollow: string;
  /** Where a reply goes. The agency wording names the BIS mailbox as the
   *  fallback; the client's says "us", because naming our own mailbox to them
   *  explains nothing and leaks how the plumbing works. */
  replyToHint: string;
```

```ts
  modeFollow: m["branding.modeFollow"],
  replyToHint: m["branding.replyToHint"],
```

```ts
  modeFollow: m["branding.clientModeFollow"],
  replyToHint: m["branding.clientReplyToHint"],
```

- [ ] **Step 2: Run the copy test to verify it still passes**

Run: `cd apps/web && pnpm vitest run src/lib/branding/panel-copy.test.ts`
Expected: PASS, 3 tests — the exact-key-set test covers the new key on both audiences, and the third-person test covers the new client string. If either fails, one variant is missing or the client wording says "their".

- [ ] **Step 3: Add the field to the shared panel**

In `apps/web/src/components/branding-panel.tsx`, immediately after the Logo field's `</div>` and before the Brand color block:

```tsx
          <div className="space-y-1.5">
            <Label htmlFor="reply-to-email">{m["branding.replyTo"]}</Label>
            <Input
              id="reply-to-email"
              name="replyToEmail"
              type="email"
              defaultValue={replyToEmail ?? ""}
            />
            <p className="text-xs text-muted-foreground">{copy.replyToHint}</p>
          </div>
```

Add the prop, beside `brandName`:

```ts
  replyToEmail,
```

```ts
  replyToEmail: string | null;
```

**Do not import `@/lib/forms/guards` here.** This is a client component and that module pulls `node:crypto`; validation belongs in the action.

- [ ] **Step 4: Pass it from both pages**

Both pages pass each branding field to the panel individually (verified: `settings/page.tsx:156` and `branding/page.tsx:51` both read `brandName={branding.brandName}`), so both need the new line. In each, add it beside `brandName`:

```tsx
        replyToEmail={branding.replyToEmail}
```

- [ ] **Step 5: Validate and save it in the action**

In `branding/actions.ts`, import the existing validator — do not write a second email regex:

```ts
// The forms guard, reused deliberately. Its rejections are stricter than RFC
// (no % or _) for a reason recorded there: those are ILIKE metacharacters in
// contact dedupe. The extra strictness is harmless for an address we only ever
// hand to Resend, and one regex that drifts is worse than one that is strict.
import { isValidEmail } from "@/lib/forms/guards";
```

Beside the `brandColor` parsing:

```ts
  // Empty clears it, like brandName and brandColor above.
  const rawReplyTo = String(formData.get("replyToEmail") ?? "").trim();
  const replyToEmail = rawReplyTo === "" ? null : rawReplyTo;
  if (replyToEmail !== null && !isValidEmail(replyToEmail)) {
    return { ok: false, error: m["branding.badReplyTo"] };
  }
```

Add it to the `setBranding` call in the same action:

```ts
    replyToEmail,
```

- [ ] **Step 6: Typecheck and run the web unit suite**

Run: `pnpm typecheck`
Expected: exit 0.

Run: `cd apps/web && pnpm vitest run`
Expected: PASS, every file.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/src/lib/branding/panel-copy.ts apps/web/src/components/branding-panel.tsx "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/branding/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx"
git commit -m "feat(branding): set a company's reply-to address from either surface"
```

---

### Task 7: An activation-checklist item, so unset is visible

**Files:**
- Modify: `apps/web/src/lib/messages.ts`
- Modify: `apps/web/src/lib/checklist-catalogue.ts:14-31`
- Modify: `apps/web/src/lib/checklist-catalogue.test.ts:19-20`

**Interfaces:**
- Consumes: nothing
- Produces: catalogue key `reply_to`

- [ ] **Step 1: Update the exact-set assertion first**

In `apps/web/src/lib/checklist-catalogue.test.ts`, the internal-items assertion is an exact set. Add the new key:

```ts
    expect(CHECKLIST_CATALOGUE.filter((i) => !i.external).map((i) => i.key).sort())
      .toEqual(["form_notify", "invite_owner", "reply_to"]);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd apps/web && pnpm vitest run src/lib/checklist-catalogue.test.ts`
Expected: FAIL — expected three keys, received two.

- [ ] **Step 3: Add the strings and the catalogue entry**

In `apps/web/src/lib/messages.ts`:

```ts
  "checklist.reply_to.title": "Set a reply-to address",
  "checklist.reply_to.help": "In this company's Branding, add the address their replies should reach. Until it is set, a customer replying to their email reaches the BIS mailbox instead of them.",
```

In `apps/web/src/lib/checklist-catalogue.ts`, after the `form_notify` entry:

```ts
  // external:false — this is done in this app, on the company's Branding page.
  // No href: the catalogue is a static module with no account id in scope, so
  // the help text names the destination instead, as every internal item does.
  { key: "reply_to", title: m["checklist.reply_to.title"],
    help: m["checklist.reply_to.help"], external: false },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/web && pnpm vitest run src/lib/checklist-catalogue.test.ts`
Expected: PASS. The `mergeChecklist` tests also cover the new item automatically — a catalogue entry with no stored row reads as undone, so no backfill exists to get wrong.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/messages.ts apps/web/src/lib/checklist-catalogue.ts apps/web/src/lib/checklist-catalogue.test.ts
git commit -m "feat(checklist): make an unset reply-to address visible per company"
```

---

### Task 8: Prove a client can save it, through RLS

**Files:**
- Modify: `apps/web/e2e/client-branding.spec.ts`

**Interfaces:**
- Consumes: the `replyToEmail` field from Task 6 and the column grant from Task 1

- [ ] **Step 1: Extend the browser test**

This is the only assertion that exercises the column grant end to end: the client's write runs as the RLS-enforced client, so a column missing from the 0014 grant fails **here and nowhere else**. In the existing `"changes the colour from their own Branding page and it persists"` test, after the colour is filled and before the Save click:

```ts
      await page.locator("#reply-to-email").fill("hello@rioroofing.com");
```

After the existing colour poll:

```ts
      await expect
        .poll(async () => (await getBranding(serviceDb(), accountId)).replyToEmail)
        .toBe("hello@rioroofing.com");
```

And extend the `finally` so the fixture is restored on both fields — the spec that follows this one depends on the fixture's state:

```ts
      await setBranding(serviceDb(), accountId,
        { brandColor: before.brandColor, replyToEmail: before.replyToEmail }, clerkUserId);
```

- [ ] **Step 2: Run the spec**

Run: `cd apps/web && pnpm test:e2e --grep "changes the colour"`
Expected: PASS. A failure with the poll timing out on `null` means the column is missing from the 0014 grant — the write was filtered, not errored.

- [ ] **Step 3: Run the full suite**

Run: `cd apps/web && pnpm test:e2e`
Expected: 29 passed + the extended spec still counted as one test. If a single unrelated spec fails on a `toHaveURL` timeout, re-run it alone before believing it — that straggler is documented and unrelated.

- [ ] **Step 4: Run every gate, with the command last**

```bash
pnpm check > /tmp/check.log 2>&1; echo "CHECK_EXIT=$?"
```
Expected: `CHECK_EXIT=0`, with the db and web test counts both up on their previous numbers.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/client-branding.spec.ts
git commit -m "test(e2e): a client saves their own reply-to address through RLS"
```

---

## Self-review notes

- **Spec coverage.** §4 data → Task 1 + 2. §5 both send sites → Tasks 4 + 5. §6 surface → Task 6. §7 checklist → Task 7. §7.1 blueprints → nothing to do, verified in the spec. §8 validation → Task 6 step 5. §9 testing → every task's own steps plus Task 8.
- **Type consistency.** `replyToEmail` is the property name in `Branding`, the panel prop, and the `setBranding` input; `reply_to_email` is the column and the PostgREST select; `replyToEmail` is the form field name; `normalizeReplyTo` is the helper. No third spelling appears anywhere.
- **The mutation that matters most** is Task 1 step 6 and Task 5 step 5: dropping the column from the grant, or from the select, passes every agency-side test and fails only for clients.
