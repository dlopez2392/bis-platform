# M1b Messaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship outbound email from the BIS Platform CRM — conversations and messages with a full delivery-status lifecycle, sendable from a contact's timeline and readable in a real Conversations screen.

**Architecture:** Migration `0005` adds `conversations` and `messages` following the established `account_id` + RLS pattern. `@bis/db` gains pure data services; the Resend call lives in `apps/web/src/lib/email/` behind a provider interface so non-production can substitute a fake. Server actions orchestrate write-then-send: the message row is written as `queued` before anything leaves the building, then stamped `sent` or `failed`. A signed webhook advances status to `delivered` / `opened` / `bounced`.

**Tech Stack:** Next 16.2.11 (App Router), React 19.2.4, Tailwind v4, Supabase/Postgres, Resend, svix (webhook signature verification), Vitest, Playwright.

## Global Constraints

- Package manager is **pnpm 10.13.1**; Node **>= 22**. Never npm or yarn.
- `pnpm check` (typecheck + lint + tests) must pass before every commit.
- All 24 existing `packages/db` tests must stay green. A break means unintended behavior change.
- `packages/db` tests need `SUPABASE_DB_URL` reachable (from `packages/db/.env`). If tests error on connection, stop and report — do not skip them.
- **No hardcoded user-facing strings.** Every visible string is a key in `apps/web/src/lib/messages.ts` (declared `as const`), including `aria-label`s.
- Semantic token classes only (`bg-card`, `text-muted-foreground`, `border-border`, …). Never raw Tailwind palette colors.
- Every dialog, drawer, and form that calls a server action uses the project's catch-and-toast pattern — there is no `error.tsx` outside `/dashboard`. `import { toast } from "sonner"` (the package directly; `@/components/ui/sonner` exports only `Toaster`).
- Account-scoped server actions take `accountId` as a **bound first parameter** (`action.bind(null, accountId)`), never from FormData. This is the tenancy boundary; `serviceDb()` bypasses RLS.
- Every mutation emits a domain event via the existing `emit` helper pattern.
- **Outside production, email sending is redirected by default.** Not a flag. See Task 2.
- Do not build: SMS, inbound receiving, assignment/user management, templates, attachments, scheduling.

---

## File Structure

**Created**

| Path | Responsibility |
|---|---|
| `packages/db/supabase/migrations/0005_messaging.sql` | `conversations` + `messages` tables, indexes, RLS |
| `packages/db/src/messaging.ts` | Conversation/message data services |
| `packages/db/src/test/messaging.test.ts` | Real-database tests for the above |
| `apps/web/src/lib/email/types.ts` | `EmailProvider` interface and input/result types |
| `apps/web/src/lib/email/resend.ts` | Real Resend provider |
| `apps/web/src/lib/email/fake.ts` | Non-production provider that sends nothing |
| `apps/web/src/lib/email/index.ts` | `getEmailProvider()` — the environment guard |
| `apps/web/src/lib/email/email.test.ts` | Provider-selection tests |
| `apps/web/src/app/api/webhooks/resend/route.ts` | Signed status webhook |
| `apps/web/src/app/dashboard/accounts/[accountId]/conversations/actions.ts` | `sendEmailAction` |
| `apps/web/src/app/dashboard/accounts/[accountId]/conversations/conversation-list.tsx` | Thread list pane |
| `apps/web/src/app/dashboard/accounts/[accountId]/conversations/message-thread.tsx` | Thread pane + composer |
| `apps/web/src/app/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.tsx` | Note/Email switch |
| `apps/web/e2e/messaging.spec.ts` | Compose → send → appears in thread and list |

**Modified**

| Path | Change |
|---|---|
| `packages/db/src/index.ts` | Export the messaging services |
| `apps/web/src/app/dashboard/accounts/[accountId]/conversations/page.tsx` | Replace empty state with the two-pane screen |
| `apps/web/src/app/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.tsx` | Swap the note-only footer for `MessageComposer` |
| `apps/web/src/lib/messages.ts` | New keys |
| `apps/web/package.json` | Add `resend`, `svix` |

---

## Task 1: Schema and data services

**Files:**
- Create: `packages/db/supabase/migrations/0005_messaging.sql`
- Create: `packages/db/src/messaging.ts`
- Create: `packages/db/src/test/messaging.test.ts`
- Modify: `packages/db/src/index.ts`

**Interfaces:**
- Consumes: the `emit` helper pattern used in `packages/db/src/activities.ts:3-7`; the `withTestAccount` fixture in `packages/db/src/test/fixtures.ts`
- Produces:
  - `ensureConversation(db, accountId, contactId, actorId): Promise<{ id: string; created: boolean }>`
  - `createMessage(db, accountId, input: NewMessage, actorId): Promise<{ id: string }>` where `NewMessage = { conversationId: string; channel: "email"; direction: "outbound"; subject?: string; body: string }`
  - `updateMessageStatus(db, accountId, messageId, status: MessageStatus, patch?: { providerMessageId?: string; error?: string }, actorId?): Promise<void>`
  - `updateMessageStatusByProviderId(db, providerMessageId, status: MessageStatus): Promise<{ updated: boolean }>`
  - `listConversations(db, accountId): Promise<ConversationSummary[]>` — ordered by `last_message_at` desc
  - `listMessages(db, accountId, conversationId): Promise<MessageRow[]>` — ascending
  - `type MessageStatus = "queued" | "sent" | "delivered" | "opened" | "bounced" | "failed"`

- [ ] **Step 1: Write the migration**

Create `packages/db/supabase/migrations/0005_messaging.sql`. Follow the documentation style of `0004_pipelines_unique_name.sql` — explain *why*, not just what.

```sql
-- M1b messaging. Two tables, following the M0/M1a pattern: account_id on every
-- row, RLS via the app.* helpers, events emitted on mutation.
--
-- conversations is ONE PER CONTACT, not per channel. A person is one thread
-- regardless of how they reached us; this is copied deliberately from GHL.
--
-- `channel` and `direction` carry values nothing writes yet (sms/webchat/
-- voice/note, inbound). That is intentional: adding an enum value later is
-- cheap, migrating a live messages table is not.

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  contact_id uuid not null references public.contacts(id),
  last_message_at timestamptz,
  unread_count integer not null default 0,
  assigned_to uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One conversation per contact. Also makes ensureConversation's
-- lookup-then-insert safe under concurrency via ON CONFLICT.
create unique index conversations_account_contact_unique
  on public.conversations (account_id, contact_id);

create index conversations_account_recent
  on public.conversations (account_id, last_message_at desc nulls last);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id),
  conversation_id uuid not null references public.conversations(id),
  channel text not null check (channel in ('email','sms','webchat','voice','note')),
  direction text not null check (direction in ('outbound','inbound')),
  status text not null default 'queued'
    check (status in ('queued','sent','delivered','opened','bounced','failed')),
  provider_message_id text,
  subject text,
  body text not null,
  error text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index messages_thread on public.messages (account_id, conversation_id, created_at);

-- Webhook lookups arrive with only a provider id and no tenant context, so
-- this index is not account-scoped.
create unique index messages_provider_message_id_unique
  on public.messages (provider_message_id) where provider_message_id is not null;

do $$
declare t text;
begin
  foreach t in array array['conversations','messages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I_member_all on public.%I for all to authenticated
         using (app.is_agency() or account_id = app.current_account_id())
         with check (app.is_agency() or account_id = app.current_account_id())', t, t);
  end loop;
end $$;
```

- [ ] **Step 2: Apply the migration to the dev database**

The `packages/db` test suite runs against the real dev database. Apply the migration however the project already does (the Supabase CLI in `packages/db`, or by executing the SQL directly against `SUPABASE_DB_URL`). Confirm both tables exist before writing tests, and report in your report exactly how you applied it.

- [ ] **Step 3: Write the failing tests**

Read `packages/db/src/test/opportunities.test.ts` first to match the existing fixture style. Create `packages/db/src/test/messaging.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import {
  ensureConversation, createMessage, updateMessageStatus,
  updateMessageStatusByProviderId, listConversations, listMessages,
} from "../messaging";

describe("messaging", () => {
  it("ensureConversation is idempotent per contact", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");

      const first = await ensureConversation(db, accountId, contactId, "user_test");
      const second = await ensureConversation(db, accountId, contactId, "user_test");

      expect(second.id).toBe(first.id);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);

      const convos = await listConversations(db, accountId);
      expect(convos).toHaveLength(1);
    }));

  it("createMessage writes the row and bumps last_message_at", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");

      await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound",
        subject: "Hello", body: "First contact",
      }, "user_test");

      const messages = await listMessages(db, accountId, convo.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.status).toBe("queued");
      expect(messages[0]!.subject).toBe("Hello");

      const [summary] = await listConversations(db, accountId);
      expect(summary!.lastMessageAt).not.toBeNull();
      expect(summary!.lastMessagePreview).toContain("First contact");
    }));

  it("updateMessageStatus records a provider id and an error", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");

      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_1" }, "user_test");
      let [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("sent");
      expect(msg!.provider_message_id).toBe("prov_1");

      await updateMessageStatus(db, accountId, id, "failed", { error: "boom" }, "user_test");
      [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("failed");
      expect(msg!.error).toBe("boom");
    }));

  it("updateMessageStatusByProviderId finds the row without tenant context", () =>
    withTestAccount(async (db, accountId) => {
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ada" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id } = await createMessage(db, accountId, {
        conversationId: convo.id, channel: "email", direction: "outbound", body: "x",
      }, "user_test");
      await updateMessageStatus(db, accountId, id, "sent", { providerMessageId: "prov_2" }, "user_test");

      const hit = await updateMessageStatusByProviderId(db, "prov_2", "delivered");
      expect(hit.updated).toBe(true);

      const [msg] = await listMessages(db, accountId, convo.id);
      expect(msg!.status).toBe("delivered");
    }));

  it("updateMessageStatusByProviderId ignores an unknown id without throwing", () =>
    withTestAccount(async (db) => {
      const miss = await updateMessageStatusByProviderId(db, "prov_does_not_exist", "delivered");
      expect(miss.updated).toBe(false);
    }));

  it("listConversations orders most-recent first", () =>
    withTestAccount(async (db, accountId) => {
      const a = await createContact(db, accountId, { firstName: "Older" }, "user_test");
      const b = await createContact(db, accountId, { firstName: "Newer" }, "user_test");
      const ca = await ensureConversation(db, accountId, a.id, "user_test");
      const cb = await ensureConversation(db, accountId, b.id, "user_test");

      await createMessage(db, accountId, {
        conversationId: ca.id, channel: "email", direction: "outbound", body: "first",
      }, "user_test");
      await createMessage(db, accountId, {
        conversationId: cb.id, channel: "email", direction: "outbound", body: "second",
      }, "user_test");

      const convos = await listConversations(db, accountId);
      expect(convos[0]!.id).toBe(cb.id);
      expect(convos[1]!.id).toBe(ca.id);
    }));
});
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd C:/Users/danlo/bis-platform
pnpm --filter @bis/db test
```

Expected: FAIL — `ensureConversation is not a function` and similar. If instead it fails on a database connection error, stop: `SUPABASE_DB_URL` is not reachable. If it fails because `conversations` does not exist, Step 2 did not apply.

- [ ] **Step 5: Implement the services**

Create `packages/db/src/messaging.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type MessageStatus =
  | "queued" | "sent" | "delivered" | "opened" | "bounced" | "failed";

export type NewMessage = {
  conversationId: string;
  channel: "email";
  direction: "outbound";
  subject?: string;
  body: string;
};

export type ConversationSummary = {
  id: string;
  contactId: string;
  contactFirstName: string | null;
  contactLastName: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
};

const MESSAGE_COLS =
  "id, conversation_id, channel, direction, status, provider_message_id, subject, body, error, created_at";

async function emit(
  db: SupabaseClient, accountId: string, type: string, actorId: string, payload: object,
) {
  const { error } = await db.from("events").insert({
    account_id: accountId, type, actor_type: "user", actor_id: actorId, payload });
  if (error) throw new Error(`event emit failed: ${error.message}`);
}

export async function ensureConversation(
  db: SupabaseClient, accountId: string, contactId: string, actorId: string,
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error: findErr } = await db.from("conversations")
    .select("id").eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (findErr) throw new Error(`conversation lookup failed: ${findErr.message}`);
  if (existing) return { id: existing.id, created: false };

  // `conversations_account_contact_unique` makes this safe under concurrency:
  // two callers can both miss the lookup, and the loser's insert conflicts
  // rather than creating a duplicate thread.
  const { data, error } = await db.from("conversations")
    .upsert({ account_id: accountId, contact_id: contactId },
            { onConflict: "account_id,contact_id" })
    .select("id").single();
  if (error || !data) throw new Error(`ensureConversation failed: ${error?.message}`);

  await emit(db, accountId, "conversation.created", actorId,
    { conversationId: data.id, contactId });
  return { id: data.id, created: true };
}

export async function createMessage(
  db: SupabaseClient, accountId: string, input: NewMessage, actorId: string,
): Promise<{ id: string }> {
  const { data, error } = await db.from("messages")
    .insert({
      account_id: accountId,
      conversation_id: input.conversationId,
      channel: input.channel,
      direction: input.direction,
      subject: input.subject ?? null,
      body: input.body,
    })
    .select("id").single();
  if (error || !data) throw new Error(`createMessage failed: ${error?.message}`);

  const { error: touchErr } = await db.from("conversations")
    .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", input.conversationId);
  if (touchErr) throw new Error(`conversation touch failed: ${touchErr.message}`);

  await emit(db, accountId, "message.created", actorId,
    { messageId: data.id, conversationId: input.conversationId, channel: input.channel });
  return { id: data.id };
}

export async function updateMessageStatus(
  db: SupabaseClient, accountId: string, messageId: string,
  status: MessageStatus,
  patch: { providerMessageId?: string; error?: string } = {},
  actorId = "system",
): Promise<void> {
  const row: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (patch.providerMessageId !== undefined) row.provider_message_id = patch.providerMessageId;
  if (patch.error !== undefined) row.error = patch.error;

  const { error } = await db.from("messages")
    .update(row).eq("account_id", accountId).eq("id", messageId);
  if (error) throw new Error(`updateMessageStatus failed: ${error.message}`);

  await emit(db, accountId, "message.status_changed", actorId, { messageId, status });
}

/**
 * Webhook path. Provider events carry only their own message id and no tenant
 * context, so this deliberately does not take an accountId — the provider id
 * is globally unique (see the partial unique index in migration 0005). The
 * account is read back from the row, never taken from the payload.
 */
export async function updateMessageStatusByProviderId(
  db: SupabaseClient, providerMessageId: string, status: MessageStatus,
): Promise<{ updated: boolean }> {
  const { data, error } = await db.from("messages")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("provider_message_id", providerMessageId)
    .select("id, account_id").maybeSingle();
  if (error) throw new Error(`updateMessageStatusByProviderId failed: ${error.message}`);
  if (!data) return { updated: false };

  await emit(db, data.account_id, "message.status_changed", "system",
    { messageId: data.id, status, providerMessageId });
  return { updated: true };
}

export async function listConversations(
  db: SupabaseClient, accountId: string,
): Promise<ConversationSummary[]> {
  const { data, error } = await db.from("conversations")
    .select("id, contact_id, last_message_at, contacts(first_name, last_name)")
    .eq("account_id", accountId)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  // One query for the previews rather than one per thread. Ordered newest
  // first, so the first row seen for a conversation is its latest message.
  //
  // This does fetch more rows than it strictly needs. PostgREST caps results
  // at max_rows (1000), so at a few hundred conversations with long histories
  // the tail of the previews would be truncated. Correct fix at that scale is
  // a DB-side lateral join or a denormalised last_message_preview column;
  // neither is warranted for one operator, and N+1 queries are worse.
  const ids = rows.map((r) => r.id);
  const { data: msgs, error: msgErr } = await db.from("messages")
    .select("conversation_id, body")
    .eq("account_id", accountId).in("conversation_id", ids)
    .order("created_at", { ascending: false });
  if (msgErr) throw new Error(msgErr.message);

  const preview = new Map<string, string>();
  for (const row of (msgs ?? []) as any[]) {
    if (!preview.has(row.conversation_id)) preview.set(row.conversation_id, row.body);
  }

  return rows.map((r) => ({
    id: r.id,
    contactId: r.contact_id,
    contactFirstName: r.contacts?.first_name ?? null,
    contactLastName: r.contacts?.last_name ?? null,
    lastMessageAt: r.last_message_at,
    lastMessagePreview: preview.get(r.id) ?? null,
  }));
}

export async function listMessages(
  db: SupabaseClient, accountId: string, conversationId: string,
) {
  const { data, error } = await db.from("messages")
    .select(MESSAGE_COLS)
    .eq("account_id", accountId).eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}
```

- [ ] **Step 6: Export from the package index**

In `packages/db/src/index.ts`, append:

```ts
export { ensureConversation, createMessage, updateMessageStatus,
         updateMessageStatusByProviderId, listConversations, listMessages,
         type MessageStatus, type NewMessage, type ConversationSummary } from "./messaging";
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
pnpm --filter @bis/db test
```

Expected: PASS — 30 tests (24 existing + 6 new), zero failures.

- [ ] **Step 8: Run the full check**

```bash
pnpm check
```

- [ ] **Step 9: Commit**

```bash
git add packages/db docs
git commit -m "feat(db): conversations and messages with delivery status lifecycle"
```

---

## Task 2: Email provider and the non-production guard

**Files:**
- Create: `apps/web/src/lib/email/types.ts`
- Create: `apps/web/src/lib/email/fake.ts`
- Create: `apps/web/src/lib/email/resend.ts`
- Create: `apps/web/src/lib/email/index.ts`
- Create: `apps/web/src/lib/email/email.test.ts`
- Modify: `apps/web/package.json` (add `resend`)

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces:
  - `type SendEmailInput = { to: string; fromName: string; replyTo?: string; subject: string; body: string }`
  - `type SendEmailResult = { providerMessageId: string }`
  - `interface EmailProvider { send(input: SendEmailInput): Promise<SendEmailResult> }`
  - `getEmailProvider(env?: NodeJS.ProcessEnv): EmailProvider`
  - `fakeEmailProvider(): EmailProvider`

**This task is the safety boundary of the milestone.** This code sends real email and runs in dev, in preview deploys, and under Playwright. A guard that depends on someone remembering to enable it is not a guard.

- [ ] **Step 1: Add the dependency**

```bash
cd C:/Users/danlo/bis-platform
pnpm --filter web add resend
```

`apps/web` has no test runner configured yet. Add Vitest to `apps/web` as a dev dependency and a `test` script, so `pnpm check` (which runs `pnpm -r --if-present test`) picks it up:

```bash
pnpm --filter web add -D vitest
```

In `apps/web/package.json` add to `scripts`: `"test": "vitest run"`.

- [ ] **Step 2: Write the failing provider-selection tests**

Create `apps/web/src/lib/email/email.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getEmailProvider } from "./index";
import { fakeEmailProvider } from "./fake";

const base = { RESEND_API_KEY: "re_test", EMAIL_FROM: "crm@bis-rgv.com" };

describe("getEmailProvider", () => {
  it("uses the fake when VERCEL_ENV is unset (local dev)", () => {
    const p = getEmailProvider({ ...base } as NodeJS.ProcessEnv);
    expect(p.isFake).toBe(true);
  });

  it("uses the fake on preview deploys", () => {
    const p = getEmailProvider({ ...base, VERCEL_ENV: "preview" } as NodeJS.ProcessEnv);
    expect(p.isFake).toBe(true);
  });

  it("uses the real provider only in production", () => {
    const p = getEmailProvider({ ...base, VERCEL_ENV: "production" } as NodeJS.ProcessEnv);
    expect(p.isFake).toBe(false);
  });

  it("allows a real send outside production only when a single recipient is allowlisted", () => {
    const p = getEmailProvider({
      ...base, VERCEL_ENV: "preview", EMAIL_DEV_REDIRECT_TO: "dan@example.com",
    } as NodeJS.ProcessEnv);
    expect(p.isFake).toBe(false);
    expect(p.redirectTo).toBe("dan@example.com");
  });

  it("the fake returns a synthetic provider id and sends nothing", async () => {
    const p = fakeEmailProvider();
    const r = await p.send({
      to: "someone@example.com", fromName: "Test Co", subject: "s", body: "b",
    });
    expect(r.providerMessageId).toMatch(/^fake_/);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
pnpm --filter web test
```

Expected: FAIL — module `./index` has no export `getEmailProvider`.

- [ ] **Step 4: Implement the types**

Create `apps/web/src/lib/email/types.ts`:

```ts
export type SendEmailInput = {
  to: string;
  fromName: string;
  replyTo?: string;
  subject: string;
  body: string;
};

export type SendEmailResult = { providerMessageId: string };

export interface EmailProvider {
  /** True when this provider does not actually deliver mail. */
  readonly isFake: boolean;
  /** Set when a real provider is forced outside production; all mail goes here. */
  readonly redirectTo?: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}
```

- [ ] **Step 5: Implement the fake**

Create `apps/web/src/lib/email/fake.ts`:

```ts
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

class FakeEmailProvider implements EmailProvider {
  readonly isFake = true;

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    // Deliberately does not deliver. Logged so a developer can see that a
    // send was attempted and to whom it *would* have gone.
    console.info(
      `[email:fake] suppressed send to ${input.to} — subject: ${input.subject}`,
    );
    const id = `fake_${Math.random().toString(36).slice(2, 12)}`;
    return { providerMessageId: id };
  }
}

export function fakeEmailProvider(): EmailProvider {
  return new FakeEmailProvider();
}
```

- [ ] **Step 6: Implement the Resend provider**

Create `apps/web/src/lib/email/resend.ts`:

```ts
import { Resend } from "resend";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";

class ResendEmailProvider implements EmailProvider {
  readonly isFake = false;
  readonly redirectTo?: string;
  #client: Resend;
  #fromAddress: string;

  constructor(apiKey: string, fromAddress: string, redirectTo?: string) {
    this.#client = new Resend(apiKey);
    this.#fromAddress = fromAddress;
    this.redirectTo = redirectTo;
  }

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    const to = this.redirectTo ?? input.to;
    const { data, error } = await this.#client.emails.send({
      from: `${input.fromName} <${this.#fromAddress}>`,
      to,
      replyTo: input.replyTo,
      subject: input.subject,
      text: input.body,
    });
    if (error) throw new Error(error.message);
    if (!data?.id) throw new Error("resend returned no message id");
    return { providerMessageId: data.id };
  }
}

export function resendEmailProvider(
  apiKey: string, fromAddress: string, redirectTo?: string,
): EmailProvider {
  return new ResendEmailProvider(apiKey, fromAddress, redirectTo);
}
```

If the installed `resend` SDK's `emails.send` signature differs from the above (for example `reply_to` rather than `replyTo`, or a different result shape), **adapt to the installed version and say so explicitly in your report** — do not force the code to match this plan against the real SDK.

- [ ] **Step 7: Implement the guard**

Create `apps/web/src/lib/email/index.ts`:

```ts
import { fakeEmailProvider } from "./fake";
import { resendEmailProvider } from "./resend";
import type { EmailProvider } from "./types";

export type { EmailProvider, SendEmailInput, SendEmailResult } from "./types";
export { fakeEmailProvider } from "./fake";

/**
 * Chooses the email provider for the current environment.
 *
 * Production sends for real. EVERYTHING ELSE — local dev, preview deploys,
 * CI, Playwright — gets the fake by default, because this code mails real
 * people and a stray run against a real contact cannot be unsent.
 *
 * The single escape hatch is EMAIL_DEV_REDIRECT_TO, which forces the real
 * provider but rewrites every recipient to that one allowlisted address.
 * There is deliberately no way to send to a contact's real address outside
 * production.
 */
export function getEmailProvider(env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const apiKey = env.RESEND_API_KEY ?? "";
  const from = env.EMAIL_FROM ?? "";
  const isProduction = env.VERCEL_ENV === "production";

  if (isProduction) {
    if (!apiKey || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production");
    return resendEmailProvider(apiKey, from);
  }

  const redirectTo = env.EMAIL_DEV_REDIRECT_TO;
  if (redirectTo && apiKey && from) {
    return resendEmailProvider(apiKey, from, redirectTo);
  }

  return fakeEmailProvider();
}
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
pnpm --filter web test
```

Expected: PASS — 5 tests.

- [ ] **Step 9: Document the environment variables**

Append to `.env.example` at the repo root:

```
# M1b messaging. Sending is FAKE everywhere except VERCEL_ENV=production.
RESEND_API_KEY=
EMAIL_FROM=crm@bis-rgv.com
# Optional, non-production only: forces real sends but rewrites every
# recipient to this one address. Never set this to a contact's real address.
EMAIL_DEV_REDIRECT_TO=
RESEND_WEBHOOK_SECRET=
```

- [ ] **Step 10: Full check and commit**

```bash
pnpm check
git add apps/web .env.example
git commit -m "feat(email): provider interface with a hard non-production send guard"
```

---

## Task 3: Send action and the contact composer

**Files:**
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/conversations/actions.ts`
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.tsx`
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `ensureConversation`, `createMessage`, `updateMessageStatus` (Task 1); `getEmailProvider` (Task 2); `addNoteAction` from `contacts/[contactId]/actions.ts`
- Produces: `sendEmailAction(accountId: string, formData: FormData): Promise<void>` — reads `contactId`, `subject`, `body`

- [ ] **Step 1: Add the message keys**

Append inside the `m` object in `apps/web/src/lib/messages.ts`:

```ts
  "compose.note": "Note",
  "compose.email": "Email",
  "compose.subject": "Subject",
  "compose.emailPlaceholder": "Write an email…",
  "compose.send": "Send",
  "compose.sendFailed": "Could not send that email. It is saved as failed in the thread.",
  "compose.noEmailOnContact": "This contact has no email address.",
```

- [ ] **Step 2: Write the send action**

Create `apps/web/src/app/dashboard/accounts/[accountId]/conversations/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/auth";
import {
  serviceDb, getContact, ensureConversation, createMessage, updateMessageStatus,
} from "@bis/db";
import { getEmailProvider } from "@/lib/email";

export async function sendEmailAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAgency();
  const contactId = String(formData.get("contactId") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!contactId || !body) throw new Error("contactId and body required");

  const db = serviceDb();
  const contact = await getContact(db, accountId, contactId);
  if (!contact) throw new Error("contact not in account");
  if (!contact.email) throw new Error("contact has no email address");

  const convo = await ensureConversation(db, accountId, contactId, userId);

  // Write-then-send: the row exists before anything leaves the building, so a
  // provider failure is a visible `failed` message rather than a silent gap.
  const { id: messageId } = await createMessage(db, accountId, {
    conversationId: convo.id, channel: "email", direction: "outbound",
    subject: subject || undefined, body,
  }, userId);

  const { data: account } = await db.from("accounts").select("name").eq("id", accountId).maybeSingle();

  try {
    const { providerMessageId } = await getEmailProvider().send({
      to: contact.email,
      fromName: account?.name ?? "BIS",
      subject: subject || "(no subject)",
      body,
    });
    await updateMessageStatus(db, accountId, messageId, "sent", { providerMessageId }, userId);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    await updateMessageStatus(db, accountId, messageId, "failed", { error: message }, userId);
    throw e;
  }

  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
}
```

Note the deliberate re-throw: the message row is already marked `failed`, and the throw is what triggers the composer's catch-and-toast so the user is told.

- [ ] **Step 3: Build the composer**

Create `apps/web/src/app/dashboard/accounts/[accountId]/contacts/[contactId]/message-composer.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";

type Mode = "note" | "email";

export function MessageComposer({
  contactId,
  contactHasEmail,
  noteAction,
  emailAction,
}: {
  contactId: string;
  contactHasEmail: boolean;
  noteAction: (formData: FormData) => Promise<void>;
  emailAction: (formData: FormData) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("note");
  const isEmail = mode === "email";

  return (
    <div className="w-full space-y-2">
      <div className="flex gap-1">
        {(["note", "email"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setMode(value)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              mode === value
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {value === "note" ? m["compose.note"] : m["compose.email"]}
          </button>
        ))}
      </div>

      {isEmail && !contactHasEmail ? (
        <p className="text-xs text-muted-foreground">{m["compose.noEmailOnContact"]}</p>
      ) : (
        <form
          key={mode}
          action={async (formData) => {
            try {
              await (isEmail ? emailAction : noteAction)(formData);
            } catch {
              toast.error(isEmail ? m["compose.sendFailed"] : m["contact.addNote"]);
            }
          }}
          className="space-y-2"
        >
          <input type="hidden" name="contactId" value={contactId} />
          {isEmail ? (
            <Input name="subject" placeholder={m["compose.subject"]} className="text-sm" />
          ) : null}
          <div className="flex gap-2">
            <Input
              name="body"
              placeholder={isEmail ? m["compose.emailPlaceholder"] : m["contact.addNote"]}
              className="flex-1"
              required
            />
            <Button type="submit" variant={isEmail ? "default" : "outline"}>
              {isEmail ? m["compose.send"] : m["common.add"]}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
```

The `key={mode}` on the form matters: switching modes remounts it, so a half-typed note does not leak into an email body.

- [ ] **Step 4: Wire it into the timeline**

In `activity-timeline.tsx`, replace the `CardFooter`'s note-only form with `MessageComposer`. The component needs two new props — `contactHasEmail: boolean` and the bound `emailAction` — threaded from the contact detail page, which already binds `accountId`. Read the file and the page before editing; preserve the `name="body"` and `name="contactId"` fields exactly, since the note action reads them.

- [ ] **Step 5: Verify**

```bash
pnpm check
pnpm --filter web build
```

Then in dev, open a contact, switch to Email, send. Expected: the message appears in the thread with status, and the terminal logs `[email:fake] suppressed send…` — proving the guard is active locally.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(ui): send email from the contact timeline"
```

---

## Task 4: Resend status webhook

**Files:**
- Create: `apps/web/src/app/api/webhooks/resend/route.ts`
- Create: `apps/web/src/app/api/webhooks/resend/route.test.ts`
- Modify: `apps/web/package.json` (add `svix`)

**Interfaces:**
- Consumes: `updateMessageStatusByProviderId` (Task 1)
- Produces: `POST /api/webhooks/resend`

This is an **unauthenticated public endpoint**. Signature verification is the only thing between it and forged status updates. It must never trust an account id, message id, or status taken from an unverified payload.

- [ ] **Step 1: Confirm the signing mechanism**

Resend signs webhooks using Svix. **Verify this against Resend's current documentation before implementing.** If the mechanism has changed, stop and report rather than implementing against this plan's assumption.

```bash
pnpm --filter web add svix
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/app/api/webhooks/resend/route.test.ts`. Map Resend event types to statuses: `email.sent` → `sent`, `email.delivered` → `delivered`, `email.opened` → `opened`, `email.bounced` → `bounced`, `email.complained` → `bounced`.

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const updateMock = vi.fn();
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}),
  updateMessageStatusByProviderId: (...args: unknown[]) => updateMock(...args),
}));
const verifyMock = vi.fn();
vi.mock("svix", () => ({ Webhook: class { verify(...a: unknown[]) { return verifyMock(...a); } } }));

import { POST } from "./route";

function req(body: unknown) {
  return new Request("http://localhost/api/webhooks/resend", {
    method: "POST",
    headers: { "svix-id": "1", "svix-timestamp": "2", "svix-signature": "v1,x" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  updateMock.mockReset().mockResolvedValue({ updated: true });
  verifyMock.mockReset();
  process.env.RESEND_WEBHOOK_SECRET = "whsec_test";
});

describe("resend webhook", () => {
  it("rejects an invalid signature and never touches the database", async () => {
    verifyMock.mockImplementation(() => { throw new Error("bad signature"); });
    const res = await POST(req({ type: "email.delivered", data: { email_id: "prov_1" } }));
    expect(res.status).toBe(400);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("maps a delivered event to the delivered status", async () => {
    verifyMock.mockReturnValue({ type: "email.delivered", data: { email_id: "prov_1" } });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.anything(), "prov_1", "delivered");
  });

  it("is idempotent across a replayed event", async () => {
    verifyMock.mockReturnValue({ type: "email.opened", data: { email_id: "prov_2" } });
    await POST(req({}));
    await POST(req({}));
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenLastCalledWith(expect.anything(), "prov_2", "opened");
  });

  it("returns 200 for an unknown provider id so the provider stops retrying", async () => {
    verifyMock.mockReturnValue({ type: "email.delivered", data: { email_id: "nope" } });
    updateMock.mockResolvedValue({ updated: false });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
  });

  it("ignores an event type it does not map", async () => {
    verifyMock.mockReturnValue({ type: "email.something_else", data: { email_id: "prov_3" } });
    const res = await POST(req({}));
    expect(res.status).toBe(200);
    expect(updateMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
pnpm --filter web test
```

Expected: FAIL — `./route` has no export `POST`.

- [ ] **Step 4: Implement the route**

Create `apps/web/src/app/api/webhooks/resend/route.ts`:

```ts
import { Webhook } from "svix";
import { serviceDb, updateMessageStatusByProviderId, type MessageStatus } from "@bis/db";

const STATUS_BY_EVENT: Record<string, MessageStatus> = {
  "email.sent": "sent",
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.bounced": "bounced",
  "email.complained": "bounced",
};

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return new Response("not configured", { status: 500 });

  const payload = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = new Webhook(secret).verify(payload, headers) as typeof event;
  } catch {
    // Unverified payloads are never read. This is the security boundary.
    return new Response("invalid signature", { status: 400 });
  }

  const status = event.type ? STATUS_BY_EVENT[event.type] : undefined;
  const providerMessageId = event.data?.email_id;
  if (!status || !providerMessageId) {
    // Unmapped event or malformed payload: acknowledge so the provider stops
    // retrying something we will never act on.
    return new Response("ignored", { status: 200 });
  }

  // Not found is also a 200 — a message we do not have is not an error the
  // provider can fix by retrying.
  await updateMessageStatusByProviderId(serviceDb(), providerMessageId, status);
  return new Response("ok", { status: 200 });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
pnpm --filter web test
```

Expected: PASS — 10 tests (5 from Task 2 + 5 here).

- [ ] **Step 6: Confirm the route is publicly reachable**

`apps/web/src/middleware.ts` protects `/dashboard(.*)`. Confirm `/api/webhooks/resend` is NOT caught by the matcher — a webhook that redirects to sign-in is a webhook that never works. Read the middleware and state what you found in your report; adjust the matcher only if it actually captures the route.

- [ ] **Step 7: Full check and commit**

```bash
pnpm check
git add apps/web
git commit -m "feat(api): signed Resend status webhook"
```

---

## Task 5: Conversations screen

**Files:**
- Modify: `apps/web/src/app/dashboard/accounts/[accountId]/conversations/page.tsx`
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/conversations/conversation-list.tsx`
- Create: `apps/web/src/app/dashboard/accounts/[accountId]/conversations/message-thread.tsx`
- Modify: `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `listConversations`, `listMessages` (Task 1); `sendEmailAction` (Task 3); `PageHeader`, `EmptyState`, `formatDateTime`, `contactDisplayName`
- Produces: nothing consumed downstream

- [ ] **Step 1: Add the message keys**

```ts
  "conversations.empty.title": "No conversations yet",
  "conversations.empty.body": "Email a contact from their timeline and the thread will appear here.",
  "conversations.pickThread": "Select a conversation to read it.",
  "conversations.status.queued": "Queued",
  "conversations.status.sent": "Sent",
  "conversations.status.delivered": "Delivered",
  "conversations.status.opened": "Opened",
  "conversations.status.bounced": "Bounced",
  "conversations.status.failed": "Failed",
```

Add a `MESSAGE_STATUS_LABEL` lookup to `apps/web/src/lib/labels.ts`, following the `STATUS_LABEL` pattern already there.

- [ ] **Step 2: Build the thread list**

Create `conversation-list.tsx` as a server component taking `{ conversations, base, activeId }`. Each row is a `Link` to `${base}?c=${id}` showing the contact name, the last-message preview truncated to one line, and a relative timestamp. The active row gets `bg-secondary`. No unread badge — outbound-only means nothing is ever unread, and a badge that can never appear is dead UI.

- [ ] **Step 3: Build the thread pane**

Create `message-thread.tsx` as a server component taking `{ messages, contactName, composer }`. Messages render newest-last in a scrollable column: subject in medium weight when present, body beneath, and a footer line with `formatDateTime(created_at)` and the status label. Outbound messages align right with `bg-primary/10`. The `composer` node renders beneath.

- [ ] **Step 4: Rewrite the page**

Replace `conversations/page.tsx` with a server component that reads `searchParams.c`, loads `listConversations`, resolves the active conversation (the `c` param, else the first), loads its messages, and renders the two panes in `grid gap-4 p-6 lg:grid-cols-[320px_minmax(0,1fr)]`. Below `lg` they stack, list first. `EmptyState` when there are no conversations at all; `conversations.pickThread` when there are threads but none selected.

Keep `export const dynamic = "force-dynamic"` and supply `PageHeader` with `title={m["nav.conversations"]}`.

- [ ] **Step 5: Verify**

```bash
pnpm check
pnpm --filter web build
```

In dev, send an email from a contact, then open Conversations. Expected: the thread appears at the top of the list, selecting it shows the message with its status, and the URL carries `?c=`.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(ui): Conversations two-pane screen"
```

---

## Task 6: End-to-end coverage and sweep

**Files:**
- Create: `apps/web/e2e/messaging.spec.ts`

- [ ] **Step 1: Write the spec**

Create `apps/web/e2e/messaging.spec.ts`:

```ts
import { test, expect } from "@playwright/test";

const ACCOUNT_NAME = "Test Client One";

test("email sent from a contact appears in the thread and in Conversations", async ({ page }) => {
  await page.goto("/dashboard/accounts");
  await page.getByRole("link", { name: new RegExp(ACCOUNT_NAME, "i") }).first().click();
  await expect(page).toHaveURL(/\/contacts$/);

  await page.getByRole("table").getByRole("link").first().click();
  await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);

  const subject = `E2E ${Date.now()}`;
  await page.getByRole("button", { name: "Email" }).click();
  await page.getByPlaceholder("Subject").fill(subject);
  await page.getByPlaceholder("Write an email…").fill("Sent by the e2e suite.");
  await page.getByRole("button", { name: "Send" }).click();

  // The fake provider is active outside production, so nothing is delivered —
  // but the full pipeline runs and the row must land as sent.
  await expect(page.getByText(subject)).toBeVisible();
  await expect(page.getByText("Sent").first()).toBeVisible();

  await page.getByRole("link", { name: "Conversations" }).click();
  await expect(page).toHaveURL(/\/conversations/);
  await expect(page.getByText("Sent by the e2e suite.").first()).toBeVisible();
});
```

- [ ] **Step 2: Run the full suite**

```bash
pnpm --filter web test:e2e
```

Expected: 9 passed (8 existing + 1 new). Run it **twice consecutively** — this spec writes real rows, so a second run proves it is not order-dependent. If the second run fails, fix the spec's isolation; do not weaken assertions.

- [ ] **Step 3: Confirm the guard held**

Grep the dev-server output for `[email:fake] suppressed send`. Its presence is the proof no real mail left the machine during the test run. Put the line in your report.

- [ ] **Step 4: Full verification**

```bash
pnpm check
pnpm --filter web build
pnpm --filter web test:e2e
```

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "test(ui): end-to-end email send coverage"
```

---

## Self-Review

**Spec coverage**

| Spec section | Task |
|---|---|
| §4 `conversations` / `messages` schema | 1 |
| §4 indexes, RLS | 1 |
| §5 `@bis/db` services | 1 |
| §5 provider wrapper | 2 |
| §5 action orchestration (write-then-send) | 3 |
| §5 webhook, signature, idempotency | 4 |
| §6 contact composer Note/Email switch | 3 |
| §6 Conversations two-pane, URL selection | 5 |
| §7 non-production send guard | 2 (enforced), 6 (verified) |
| §8 db tests | 1 |
| §8 webhook tests | 4 |
| §8 Playwright | 6 |
| §2 no unread logic | 1 (column defaults 0, nothing maintains it), 5 (no badge) |

**Type consistency checked:** `MessageStatus` is defined in Task 1's `messaging.ts` and imported by Task 4's route. `NewMessage.channel` is narrowed to `"email"` and `direction` to `"outbound"` deliberately — the database accepts the full enums, but this milestone's code should not be able to write a value it has not implemented. `EmailProvider.isFake` is asserted in Task 2's tests and relied on nowhere else, so it is observable rather than load-bearing. `sendEmailAction` takes `accountId` bound-first, matching every other account-scoped action in the app.

**Known risk the plan does not remove:** Task 2 and Task 4 both depend on third-party API shapes (`resend` SDK, Resend's Svix signing) that may have changed since this plan was written. Both tasks instruct the implementer to verify against the installed package and current docs and to report deviations rather than force the plan's assumption. That is the correct failure mode — a reported mismatch is cheap, a silently wrong integration is not.
