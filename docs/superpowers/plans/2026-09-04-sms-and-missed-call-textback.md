# SMS and missed-call text-back — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A company cleared to text can send and receive SMS in the same
thread as their email, and — when switched on — automatically texts back a
caller who spoke to Sofía but left without booking.

**Architecture:** An `SmsProvider` mirroring `EmailProvider` with its
production-only selection guard copied verbatim; one shared gate
(`resolveSmsSender`) that both the composer and text-back consult; write-then-
send ordering so a provider failure is a visible `failed` row; one Telnyx
webhook handling both inbound messages and delivery receipts.

**Tech Stack:** Next.js App Router server actions, Supabase/Postgres,
`packages/db`, vitest (no DOM), Playwright.

Spec: `docs/superpowers/specs/2026-09-04-sms-and-missed-call-textback-design.md`

## Global Constraints

- **Tasks 1–4 are Phase 1b and must ship without Tasks 5–7.** After Task 4 the
  branch is a complete, valuable increment. If the review gate wants to cut,
  that is the seam.
- **The provider guard is the most important line in this plan.** Real provider
  ONLY when `env.VERCEL_ENV === "production" && process.env.NODE_ENV ===
  "production"`, with `NODE_ENV` read from the real process env and never from
  the injectable `env` param — Next hardcodes it under `next dev` and refuses
  to let a `.env` override it, so it cannot be spoofed the way `VERCEL_ENV`
  can. Copy `lib/email/index.ts:31` including its reasoning. **A stray SMS to a
  real contact cannot be unsent.**
- **No test may send a real SMS.** The fake provider is the default outside
  production by construction, not by discipline.
- **`resolveSmsSender` is the ONLY gate.** No caller re-derives "can this
  account text". A null `getA2pRegistration` read resolves to
  `a2p_not_approved`, never to cleared.
- **serviceDb for `voice_profiles` writes.** `0020_voice_grants_revoke.sql`
  revoked insert/update/delete from `authenticated`. Unit tests mock the
  database and are BLIND to column grants — four shipped defects in this repo
  came from exactly that. Agency-gated action on `serviceDb()`.
- **Forms use `useFormSubmit` (`lib/forms/use-form-submit.ts`), never the
  `action` prop.** React resets an action-prop form even when the action
  failed, and Radix Select drives state backwards on that reset.
- Copy lives in `lib/messages.ts` as `m["key"]`; tokens only; DESIGN.md applies.
- **`0024` is the only migration.** Migrations are applied ONCE and never
  re-applied.

## File Structure

**Create:** `apps/web/src/lib/sms/types.ts` · `.../sms/fake.ts` ·
`.../sms/telnyx.ts` · `.../sms/index.ts` · `.../sms/segments.ts` (+ test) ·
`.../lib/sms/sender.ts` (+ test) · `apps/web/src/app/api/sms/inbound/route.ts` ·
`packages/db/supabase/migrations/0024_textback.sql`

**Modify:** `packages/db/src/messaging.ts` (channel union) ·
`packages/db/src/voice.ts` (voice profile row/upsert) ·
`.../conversations/actions.ts` · the composer components ·
`.../voice/voice-settings.tsx` + its actions · `lib/voice/finish-call.ts` ·
the calls list/detail · `lib/messages.ts` · an e2e spec

---

### Task 1: The SMS provider, its guard, and segment counting

**Files:** create `apps/web/src/lib/sms/{types,fake,telnyx,index,segments}.ts`;
create `apps/web/src/lib/sms/segments.test.ts`,
`apps/web/src/lib/sms/index.test.ts`

**Interfaces produced:**
- `type SendSmsInput = { to: string; from: string; body: string }`
- `type SendSmsResult = { providerMessageId: string }`
- `interface SmsProvider { readonly isFake: boolean; readonly redirectTo?: string; send(i: SendSmsInput): Promise<SendSmsResult> }`
- `getSmsProvider(env?): SmsProvider`
- `segmentsFor(body: string): { encoding: "gsm7" | "ucs2"; chars: number; segments: number }`

- [ ] **Step 1: Write the failing segment test**

Create `apps/web/src/lib/sms/segments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { segmentsFor } from "./segments";

describe("segmentsFor", () => {
  it("counts GSM-7 at 160 per segment", () => {
    expect(segmentsFor("a".repeat(160))).toEqual({ encoding: "gsm7", chars: 160, segments: 1 });
    // Over one segment, GSM-7 concatenation uses 153 per part, not 160.
    expect(segmentsFor("a".repeat(161)).segments).toBe(2);
  });

  it("drops the WHOLE message to UCS-2 at 70 for one non-GSM character", () => {
    // The defect this exists to prevent: this platform is bilingual, and a
    // single curly apostrophe or an accent outside GSM-7 more than halves
    // capacity while a naive character count still reads "fine".
    const curly = "a".repeat(80) + "’"; // right single quote, NOT in GSM-7
    expect(segmentsFor(curly).encoding).toBe("ucs2");
    expect(segmentsFor(curly).segments).toBe(2);
    expect(segmentsFor("a".repeat(70)).segments).toBe(1);
  });

  it("keeps Spanish that IS representable in GSM-7 on the cheap encoding", () => {
    // á í ó ú are NOT in GSM-7; ñ, é and ü ARE. Asserting both directions so
    // the charset table cannot be quietly emptied and still pass.
    expect(segmentsFor("mañana señor").encoding).toBe("gsm7");
    expect(segmentsFor("café").encoding).toBe("gsm7");
    expect(segmentsFor("adiós").encoding).toBe("ucs2");
  });

  it("counts a GSM-7 extension character as two", () => {
    // { } [ ] ~ ^ \ | € occupy two septets each.
    expect(segmentsFor("{".repeat(80)).chars).toBe(160);
    expect(segmentsFor("{".repeat(81)).segments).toBe(2);
  });

  it("an empty body is one segment, not zero", () => {
    expect(segmentsFor("")).toEqual({ encoding: "gsm7", chars: 0, segments: 1 });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && npx vitest run src/lib/sms/segments.test.ts`
Expected: FAIL — cannot find module `./segments`.

- [ ] **Step 3: Implement `segments.ts`**

```ts
/**
 * SMS segment counting, encoding-aware.
 *
 * A message fits 160 characters in GSM-7. ANY character outside that set
 * drops the WHOLE message to UCS-2 at 70 characters per segment — and this
 * platform is bilingual by design (greeting_es, ?locale=es, Spanish booking
 * pages), so a Spanish text with the wrong accent or a curly apostrophe
 * silently less-than-halves capacity and doubles the bill. A naive character
 * count would mislead precisely where it matters most, which is why this is
 * a charset check rather than `body.length`.
 *
 * Concatenation costs header space: multi-part GSM-7 is 153 per part and
 * multi-part UCS-2 is 67, not 160/70.
 */
const GSM7_BASE =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
/** Each costs TWO septets, because it is sent as an escape plus the char. */
const GSM7_EXTENDED = "^{}\\[~]|€";

export type SmsSegments = {
  encoding: "gsm7" | "ucs2";
  /** Septets for gsm7 (extension chars counted as 2), UTF-16 code units for ucs2. */
  chars: number;
  segments: number;
};

export function segmentsFor(body: string): SmsSegments {
  let septets = 0;
  let gsm7 = true;
  for (const ch of body) {
    if (GSM7_BASE.includes(ch)) { septets += 1; continue; }
    if (GSM7_EXTENDED.includes(ch)) { septets += 2; continue; }
    gsm7 = false;
    break;
  }

  if (gsm7) {
    const segments = septets <= 160 ? 1 : Math.ceil(septets / 153);
    return { encoding: "gsm7", chars: septets, segments: Math.max(1, segments) };
  }

  // UCS-2 counts UTF-16 code units, so an emoji (a surrogate pair) is two.
  const units = body.length;
  const segments = units <= 70 ? 1 : Math.ceil(units / 67);
  return { encoding: "ucs2", chars: units, segments: Math.max(1, segments) };
}
```

- [ ] **Step 4: Run it and confirm it passes**

Run: `cd apps/web && npx vitest run src/lib/sms/segments.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the provider types and the fake**

Create `apps/web/src/lib/sms/types.ts`:

```ts
export type SendSmsInput = {
  /** E.164, e.g. "+19565551234". */
  to: string;
  /** E.164 of the account's own live number. */
  from: string;
  body: string;
};

export type SendSmsResult = { providerMessageId: string };

export interface SmsProvider {
  /** True when this provider does not actually deliver. */
  readonly isFake: boolean;
  /** Set when a real provider is forced outside production; all texts go here. */
  readonly redirectTo?: string;
  send(input: SendSmsInput): Promise<SendSmsResult>;
}
```

Create `apps/web/src/lib/sms/fake.ts`, mirroring `lib/email/fake.ts`:

```ts
import type { SmsProvider, SendSmsInput, SendSmsResult } from "./types";

class FakeSmsProvider implements SmsProvider {
  readonly isFake = true;

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    // Deliberately does not deliver. Logged so a developer can see that a
    // send was attempted and to whom it *would* have gone.
    console.info(`[sms:fake] suppressed send to ${input.to} — ${input.body.slice(0, 60)}`);
    return { providerMessageId: `fake_${Math.random().toString(36).slice(2, 12)}` };
  }
}

export function fakeSmsProvider(): SmsProvider {
  return new FakeSmsProvider();
}
```

- [ ] **Step 6: Write the failing guard test**

Create `apps/web/src/lib/sms/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getSmsProvider } from "./index";

// THE test of this task. A provider that delivers outside production is an
// unrecallable text to a real person.
describe("getSmsProvider", () => {
  it("is FAKE unless BOTH VERCEL_ENV and NODE_ENV say production", () => {
    // NODE_ENV is "test" under vitest, so every combination here must be fake
    // — including the one that fakes the spoofable half.
    expect(getSmsProvider({ VERCEL_ENV: "production", TELNYX_API_KEY: "k" }).isFake).toBe(true);
    expect(getSmsProvider({ VERCEL_ENV: "preview", TELNYX_API_KEY: "k" }).isFake).toBe(true);
    expect(getSmsProvider({}).isFake).toBe(true);
  });

  it("uses the real provider with a redirect when one is configured", () => {
    const p = getSmsProvider({ TELNYX_API_KEY: "k", SMS_DEV_REDIRECT_TO: "+15550001111" });
    expect(p.isFake).toBe(false);
    expect(p.redirectTo).toBe("+15550001111");
  });

  it("falls back to fake when a redirect is set with no key", () => {
    expect(getSmsProvider({ SMS_DEV_REDIRECT_TO: "+15550001111" }).isFake).toBe(true);
  });
});
```

- [ ] **Step 7: Run it and confirm it fails**

Run: `cd apps/web && npx vitest run src/lib/sms/index.test.ts`
Expected: FAIL — cannot find module `./index`.

- [ ] **Step 8: Implement `telnyx.ts` and `index.ts`**

Create `apps/web/src/lib/sms/telnyx.ts`:

```ts
import type { SmsProvider, SendSmsInput, SendSmsResult } from "./types";

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";

/** Outbound sends must not hold a webhook open. finishCall runs on Telnyx's
 *  own callback after the caller hung up; a hanging provider there would keep
 *  that request alive for the platform's whole function timeout. */
const SEND_TIMEOUT_MS = 10_000;

class TelnyxSmsProvider implements SmsProvider {
  readonly isFake = false;
  constructor(
    private readonly apiKey: string,
    readonly redirectTo?: string,
  ) {}

  async send(input: SendSmsInput): Promise<SendSmsResult> {
    const to = this.redirectTo ?? input.to;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
    try {
      const res = await fetch(TELNYX_MESSAGES_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: input.from, to, text: input.body }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`telnyx send failed (${res.status}): ${text}`);
      const parsed = JSON.parse(text) as { data?: { id?: string } };
      const id = parsed.data?.id;
      if (!id) throw new Error(`telnyx send returned no message id: ${text}`);
      return { providerMessageId: id };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function telnyxSmsProvider(apiKey: string, redirectTo?: string): SmsProvider {
  return new TelnyxSmsProvider(apiKey, redirectTo);
}
```

Create `apps/web/src/lib/sms/index.ts`:

```ts
import type { SmsProvider } from "./types";
import { fakeSmsProvider } from "./fake";
import { telnyxSmsProvider } from "./telnyx";

type SmsEnv = {
  VERCEL_ENV?: string;
  TELNYX_API_KEY?: string;
  SMS_DEV_REDIRECT_TO?: string;
};

/**
 * Selects the provider. Copied from getEmailProvider (lib/email/index.ts:31)
 * including its reasoning, because the reasoning is the point.
 *
 * Both halves are required. VERCEL_ENV alone is spoofable: someone can put
 * VERCEL_ENV=production and a TELNYX_API_KEY into a local env file and
 * `next dev` would load both, and this guard would wave a laptop run through
 * as production. NODE_ENV closes that hole because it is read from the real
 * process env here (never from the injectable `env` param) — Next hardcodes
 * NODE_ENV=development under `next dev` and refuses to let a `.env` file
 * override it.
 *
 * A stray SMS to a real contact cannot be unsent.
 */
export function getSmsProvider(env: SmsEnv = process.env as SmsEnv): SmsProvider {
  const apiKey = env.TELNYX_API_KEY;
  const isProduction =
    env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";

  if (isProduction) {
    if (!apiKey) throw new Error("TELNYX_API_KEY is required in production");
    return telnyxSmsProvider(apiKey);
  }

  const redirectTo = env.SMS_DEV_REDIRECT_TO;
  if (redirectTo && apiKey) return telnyxSmsProvider(apiKey, redirectTo);

  return fakeSmsProvider();
}
```

- [ ] **Step 9: Run both test files and confirm they pass**

Run: `cd apps/web && npx vitest run src/lib/sms/`
Expected: PASS (8 tests).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/sms
git commit -m "feat(sms): provider with the production-only guard, and encoding-aware segments"
```

---

### Task 2: The channel union and the one gate

**Files:** modify `packages/db/src/messaging.ts:13`; create
`apps/web/src/lib/sms/sender.ts` and `apps/web/src/lib/sms/sender.test.ts`

**Interfaces:**
- Consumes: `getA2pRegistration(db, accountId)` from `@bis/db` (returns
  `A2pRegistrationRecord | null` with `.status`)
- Produces: `type SmsGate = { ok: true; from: string } | { ok: false; reason: "a2p_not_approved" | "no_live_number" }`;
  `resolveSmsSender(db: SupabaseClient, accountId: string): Promise<SmsGate>`

- [ ] **Step 1: Add `"sms"` to the channel union**

In `packages/db/src/messaging.ts:13`, change:

```ts
  channel: "email" | "form" | "voice";
```

to:

```ts
  // "sms" needs no migration: 0006_forms.sql:92 already sets the CHECK to
  // ('email','sms','webchat','voice','note','form') — a deliberate
  // "channels are adapters, not migrations" decision.
  channel: "email" | "form" | "voice" | "sms";
```

- [ ] **Step 2: Write the failing gate test**

Create `apps/web/src/lib/sms/sender.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { resolveSmsSender } from "./sender";

const a2p = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", () => ({ getA2pRegistration: a2p }));

/** Minimal PostgREST stub for the phone_numbers lookup. */
function dbReturning(rows: { e164: string; created_at: string }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }),
        }),
      }),
    }),
  } as never;
}

describe("resolveSmsSender", () => {
  it("refuses when A2P is not approved, whatever the numbers say", async () => {
    a2p.mockResolvedValue({ status: "pending", brandId: "B", campaignId: "C", updatedAt: null });
    const gate = await resolveSmsSender(dbReturning([{ e164: "+15551112222", created_at: "2026-01-01" }]), "acc");
    expect(gate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });

  it("FAILS CLOSED when the account read returns null", async () => {
    // The assertion this function exists for. A missing or RLS-invisible row
    // must never resolve to "cleared to text" — texting without a valid
    // registration is what gets a client's number carrier-blocked.
    a2p.mockResolvedValue(null);
    const gate = await resolveSmsSender(dbReturning([{ e164: "+15551112222", created_at: "2026-01-01" }]), "acc");
    expect(gate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });

  it("refuses when approved but no live number exists", async () => {
    a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", updatedAt: null });
    const gate = await resolveSmsSender(dbReturning([]), "acc");
    expect(gate).toEqual({ ok: false, reason: "no_live_number" });
  });

  it("returns the OLDEST live number when approved", async () => {
    a2p.mockResolvedValue({ status: "approved", brandId: "B", campaignId: "C", updatedAt: null });
    const gate = await resolveSmsSender(dbReturning([
      { e164: "+15550001111", created_at: "2026-01-01" },
      { e164: "+15559998888", created_at: "2026-06-01" },
    ]), "acc");
    expect(gate).toEqual({ ok: true, from: "+15550001111" });
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd apps/web && npx vitest run src/lib/sms/sender.test.ts`
Expected: FAIL — cannot find module `./sender`.

- [ ] **Step 4: Implement `sender.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { getA2pRegistration } from "@bis/db";

export type SmsGate =
  | { ok: true; from: string }
  | { ok: false; reason: "a2p_not_approved" | "no_live_number" };

/**
 * THE gate. Every send path consults this and none re-derives it — two gates
 * that can disagree is how a number ends up blocked for the wrong stated
 * reason, or texted from one that was never cleared.
 *
 * This is also the `isClearedToText` predicate the A2P review asked for, and
 * it FAILS CLOSED by construction: a null read (row missing, or invisible to
 * this client under RLS) resolves to `a2p_not_approved`, never to cleared.
 *
 * "Live" matches the voice path's own meaning — the status the setup wizard's
 * go-live press sets. Several live rows resolve to the oldest, deterministically,
 * so the sending number cannot change under an account between two sends.
 */
export async function resolveSmsSender(
  db: SupabaseClient, accountId: string,
): Promise<SmsGate> {
  const a2p = await getA2pRegistration(db, accountId);
  if (a2p?.status !== "approved") return { ok: false, reason: "a2p_not_approved" };

  const { data, error } = await db.from("phone_numbers")
    .select("e164, created_at")
    .eq("account_id", accountId)
    .eq("status", "live")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`resolveSmsSender failed: ${error.message}`);

  const first = data?.[0] as { e164: string } | undefined;
  if (!first) return { ok: false, reason: "no_live_number" };
  return { ok: true, from: first.e164 };
}
```

- [ ] **Step 5: Run and confirm it passes**

Run: `cd apps/web && npx vitest run src/lib/sms/sender.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck the union change did not break callers**

Run: `pnpm --filter web typecheck && pnpm --filter @bis/db typecheck`
Expected: exit 0 for both. A `channel` switch that is now non-exhaustive will
surface here — fix any that appear rather than casting.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/messaging.ts apps/web/src/lib/sms
git commit -m "feat(sms): the sms channel, and one fail-closed gate for sending"
```

---

### Task 3: Sending — the action and the composer

**Files:** modify `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts`,
`.../conversations/email-composer.tsx`,
`.../contacts/[contactId]/message-composer.tsx`, `apps/web/src/lib/messages.ts`

**Interfaces:**
- Consumes: `resolveSmsSender` (Task 2), `getSmsProvider` (Task 1),
  `segmentsFor` (Task 1)
- Produces: `sendSmsAction(accountId: string, formData: FormData): Promise<void>`

- [ ] **Step 1: Add the copy**

In `apps/web/src/lib/messages.ts`, beside the existing `compose.*` keys:

```ts
  "compose.sms": "Text",
  "compose.smsPlaceholder": "Write a text…",
  "compose.smsSent": "Text sent",
  "compose.smsFailed": "Could not send the text",
  // Says WHO is holding it up and what unblocks it, rather than "unavailable".
  "compose.smsBlockedA2p": "Texting is off until this company's A2P registration is approved",
  "compose.smsBlockedNoNumber": "Texting needs a live phone number on this company",
  // {n} segments — SMS bills per segment, and a single non-GSM character
  // (an accent, a curly apostrophe) drops the whole message to 70 per segment.
  "compose.smsSegments": "{chars} characters · {segments} message(s)",
```

- [ ] **Step 2: Write the action**

In `.../conversations/actions.ts`, following `sendEmailAction` (`:20`) exactly
— same guard, same write-then-send ordering:

```ts
export async function sendSmsAction(accountId: string, formData: FormData): Promise<void> {
  const { userId } = await requireAccountAccess(accountId);
  const contactId = String(formData.get("contactId") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  if (!contactId || !body) rejectSend("contactId and body required");

  const db = serviceDb();

  // THE gate, and the only one. Never re-derive this.
  const gate = await resolveSmsSender(db, accountId);
  if (!gate.ok) rejectSend(gate.reason);

  const contact = await getContact(db, accountId, contactId);
  const to = contact?.phone;
  if (!to) rejectSend("contact has no phone number");

  const conversation = await ensureConversation(db, accountId, contactId, userId);

  // WRITE THEN SEND: the row exists before anything leaves the building, so a
  // provider failure is a visible `failed` message carrying the reason rather
  // than a silent gap. Same ordering as sendEmailAction, same reason.
  const message = await createMessage(db, accountId, {
    conversationId: conversation.id, channel: "sms", direction: "outbound",
    subject: null, body,
  }, userId);

  try {
    const { providerMessageId } = await getSmsProvider().send({ to, from: gate.from, body });
    await setMessageProviderId(db, accountId, message.id, providerMessageId, "sent");
  } catch (e) {
    await setMessageStatus(db, accountId, message.id, "failed", String(e));
    throw e;
  }

  revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
  revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
}
```

⚠️ `getContact`, `setMessageProviderId` and `setMessageStatus` are named here
as the operations needed. **Read `packages/db/src/messaging.ts` and
`contacts.ts` first and use the real exported names** — if an equivalent does
not exist, add it there rather than inlining a raw `.update()` in the action
(the house rule every account-level write already follows).

- [ ] **Step 3: Add the SMS channel to both composers**

Both composers already have a mode toggle (`message-composer.tsx`) or a single
channel (`email-composer.tsx`). Add "Text" alongside "Email" in
`message-composer.tsx` only — the Conversations composer stays email-only for
now, matching its existing comment that the thread has no note concept.

The mode button for Text renders **disabled with the reason** when the gate
refuses, per the spec:

```tsx
{smsGate.ok ? null : (
  <p className="text-xs text-muted-foreground">
    {smsGate.reason === "a2p_not_approved"
      ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
  </p>
)}
```

The gate result is resolved on the SERVER (the contact page is a server
component) and passed in as a prop — the composer must not call the database.

- [ ] **Step 4: Add the segment counter**

Under the body input, when the mode is Text:

```tsx
{isSms ? (
  <p className="text-xs text-muted-foreground">
    {m["compose.smsSegments"]
      .replace("{chars}", String(segmentsFor(body).chars))
      .replace("{segments}", String(segmentsFor(body).segments))}
  </p>
) : null}
```

This requires the body to be controlled state. **`message-composer.tsx`
already uses `useFormSubmit`** — keep that; do NOT reintroduce the `action`
prop.

- [ ] **Step 5: Gates**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build`
Expected: exit 0 for all three.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(sms): send a text from the contact composer, gated and counted"
```

---

### Task 4: Inbound messages and delivery receipts

**Files:** create `apps/web/src/app/api/sms/inbound/route.ts`; create
`apps/web/src/app/api/sms/inbound/route.test.ts`

**Interfaces:**
- Consumes: `verifyTelnyxSignature` (`lib/voice/telnyx-signature.ts:14`),
  `updateMessageStatusByProviderId`, `ensureConversation`, `createMessage`,
  `createContact`

- [ ] **Step 1: Write the failing route test**

Create `apps/web/src/app/api/sms/inbound/route.test.ts`. Cover the three
behaviours that matter:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const verify = vi.hoisted(() => vi.fn());
const dbMocks = vi.hoisted(() => ({
  updateMessageStatusByProviderId: vi.fn(), ensureConversation: vi.fn(),
  createMessage: vi.fn(), createContact: vi.fn(), serviceDb: vi.fn(),
}));
vi.mock("@/lib/voice/telnyx-signature", () => ({ verifyTelnyxSignature: verify }));
vi.mock("@bis/db", () => dbMocks);

import { POST } from "./route";

function post(body: object) {
  return new Request("https://x.test/api/sms/inbound", {
    method: "POST",
    headers: { "telnyx-timestamp": "1", "telnyx-signature-ed25519": "sig" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => { vi.clearAllMocks(); verify.mockReturnValue(true); });

describe("POST /api/sms/inbound", () => {
  it("rejects a bad signature with 401 and writes nothing", async () => {
    verify.mockReturnValue(false);
    const res = await POST(post({ data: { event_type: "message.received" } }));
    expect(res.status).toBe(401);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("returns 200 and writes NOTHING for a number this platform does not own", async () => {
    // A webhook that 500s gets retried forever, and an unowned number is not
    // an error condition this platform can fix. It is LOGGED, because the case
    // that matters is a number we DO own whose row is missing — in which case
    // a real customer's text is being discarded and no screen would say so.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(post({
      data: { event_type: "message.received", payload: {
        to: [{ phone_number: "+15550000000" }], from: { phone_number: "+15551112222" }, text: "hi" } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("routes a delivery receipt to updateMessageStatusByProviderId", async () => {
    const res = await POST(post({
      data: { event_type: "message.finalized", id: "prov_1", payload: { to: [{ status: "delivered" }] } },
    }));
    expect(res.status).toBe(200);
    expect(dbMocks.updateMessageStatusByProviderId).toHaveBeenCalled();
  });
});
```

⚠️ The Telnyx payload shape above is written from the v2 messaging webhook
docs. **Confirm the exact `event_type` values and payload nesting against
Telnyx's current documentation before implementing**, and adjust both the test
and the route together. Getting this wrong means inbound texts are silently
dropped, which is the failure the unowned-number log exists to make visible.

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd apps/web && npx vitest run src/app/api/sms/inbound/route.test.ts`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 3: Implement the route**

One route handles both inbound messages and status callbacks, because Telnyx
posts both to one URL. Branch on `event_type`; an unrecognised type returns
200 and does nothing rather than 500.

Key requirements, all load-bearing:
- Verify with `verifyTelnyxSignature` against `TELNYX_PUBLIC_KEY` on the RAW
  body text, before parsing.
- Resolve the account from the **called** number via `phone_numbers.e164`.
- Unknown called-number: `console.error` naming the number, return 200.
- Match an existing contact on that account by phone; create one if absent, so
  an inbound text from a known customer joins their existing thread.
- `ensureConversation`, then `createMessage` with `channel: "sms"`,
  `direction: "inbound"`, `subject: null`.
- `serviceDb()` throughout — this is a webhook with no user session.

- [ ] **Step 4: Run and confirm it passes**

Run: `cd apps/web && npx vitest run src/app/api/sms/inbound/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Gates and commit**

```bash
pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web build
git add apps/web/src/app/api/sms
git commit -m "feat(sms): inbound messages and delivery receipts on one webhook"
```

**🔶 PHASE 1b IS COMPLETE AND SHIPPABLE HERE.** Tasks 5–7 are 1c. If the
review gate wants to cut scope, cut at this line.

---

### Task 5: Migration 0024 and the text-back setting

**Files:** create `packages/db/supabase/migrations/0024_textback.sql`; modify
`packages/db/src/voice.ts`, `.../voice/voice-settings.tsx`,
`.../voice/actions.ts`, `apps/web/src/lib/messages.ts`

- [ ] **Step 1: Write the migration**

`0023` is the current highest — confirm with `ls packages/db/supabase/migrations/`
before naming the file. Create `0024_textback.sql`:

```sql
-- Missed-call text-back, per company.
--
-- OFF by default and deliberately so: this sends automatically, on the
-- client's own number, costing their money, with no human in the loop. It is
-- trialled on one company before it touches another — the same posture as the
-- voice go-live press and the calendar's follow-up emails.
--
-- No grant work needed: 0020_voice_grants_revoke.sql already revoked
-- insert/update/delete on voice_profiles from `authenticated`, so these
-- columns are serviceDb-only by inheritance and a client cannot flip their
-- own toggle.
--
-- An EMPTY textback_body means "use the live default at send time" — the same
-- contract calendars.followup_body carries, so an unrelated save can never
-- silently pin the frozen default into the column.
alter table public.voice_profiles
  add column textback_enabled boolean not null default false,
  add column textback_body text not null default '';
```

- [ ] **Step 2: Extend the voice profile row type and writer**

In `packages/db/src/voice.ts`, add `textback_enabled: boolean` and
`textback_body: string` to the profile row type and to `upsertVoiceProfile`'s
input and column list. **Read the file first** and follow its existing shape
rather than the sketch here.

- [ ] **Step 3: Apply the migration**

🔴 Migrations in this repo are applied ONCE and never re-applied. Do a
pre-flight read first (confirm the columns are absent and `0023` is the latest
applied), then apply `0024` the way the runbook prescribes, then verify the
grant posture: `authenticated` must hold SELECT and NOT UPDATE on both new
columns.

- [ ] **Step 4: Define the live default body**

Create `apps/web/src/lib/voice/textback-body.ts`. Task 6 sends this whenever
`textback_body` is empty, and Step 5's textarea shows it as `placeholder` —
one definition, so the preview can never drift from what actually sends (the
mistake `DEFAULT_FOLLOWUP_BODY` already exists to prevent for calendar
follow-ups):

```ts
/**
 * What a missed caller receives when the operator has not written their own.
 *
 * Deliberately short: it is one SMS segment in GSM-7 for any plausible
 * company name, so the default never silently costs two messages. Check it
 * with segmentsFor() if you change it.
 *
 * Plain language a business owner would text, no template syntax, and it
 * names the company because a text from an unknown number is otherwise
 * indistinguishable from spam.
 */
export function defaultTextbackBody(accountName: string): string {
  return `Hi, this is ${accountName}. Sorry we missed you just now — reply here and we'll help.`;
}
```

Add a test in `apps/web/src/lib/voice/textback-body.test.ts` asserting the
default stays one GSM-7 segment for a realistic name:

```ts
import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { defaultTextbackBody } from "./textback-body";

it("the default text-back is one GSM-7 segment", () => {
  const s = segmentsFor(defaultTextbackBody("Rio Roofing"));
  expect(s.encoding).toBe("gsm7");
  expect(s.segments).toBe(1);
});
```

- [ ] **Step 5: Add the settings UI**

In `voice-settings.tsx`'s profile form (already converted to `useFormSubmit`
— keep it that way), add a checkbox for `textback_enabled` and a textarea for
`textback_body`, with the live default as the textarea's `placeholder` and the
segment counter from Task 1 beneath it. Copy:

```ts
  "voice.textback.enabled": "Text back callers who didn't book",
  "voice.textback.help": "When someone talks to Sofía and hangs up without booking, send them a text. Off until you turn it on, and only for companies whose A2P registration is approved.",
  "voice.textback.body": "Message",
```

- [ ] **Step 6: Gates and commit**

```bash
pnpm check && pnpm --filter web build
git add packages/db apps/web/src
git commit -m "feat(voice): per-company missed-call text-back setting, off by default"
```

---

### Task 6: The fourth leg in finishCall

**Files:** modify `apps/web/src/lib/voice/finish-call.ts`,
`apps/web/src/lib/voice/finish-call.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `finish-call.test.ts`, mirroring its existing style:

```ts
  it("texts back an ABANDONED caller when the toggle is on, and creates the contact", async () => {
    // abandoned = the caller SPOKE but produced no booking, lead or message
    // (call-state.ts:31). That is the follow-up target.
    // ...arrange an abandoned state with textback_enabled true...
    expect(smsMocks.send).toHaveBeenCalledOnce();
    expect(dbMocks.createContact).toHaveBeenCalled();
  });

  it("does NOT text a SPAM call", async () => {
    // spam = the caller never spoke. Gating on `abandoned` excludes silent
    // robocalls by CLASSIFICATION rather than by rule, which is what makes
    // creating a contact acceptable.
    expect(smsMocks.send).not.toHaveBeenCalled();
  });

  it("does NOT text when the toggle is off", async () => {
    expect(smsMocks.send).not.toHaveBeenCalled();
  });

  it("does NOT text when the SMS gate refuses", async () => {
    // A2P not approved must stop the automation too, not just the composer.
    expect(smsMocks.send).not.toHaveBeenCalled();
  });

  it("a text-back failure does not take down the rest of finishCall", async () => {
    // finishCall is contractually never-throws: the caller has already hung
    // up, and there is nobody to surface a rejection to.
    smsMocks.send.mockRejectedValue(new Error("telnyx down"));
    await expect(finishCall(state, ctx, meta)).resolves.toBeDefined();
  });
```

- [ ] **Step 2: Run and confirm they fail**

Run: `cd apps/web && npx vitest run src/lib/voice/finish-call.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement the leg**

Add after the staff-alert leg in `finishCall`, as a fourth independent block:

```ts
  // Fourth leg: missed-call text-back. Independent and independently
  // try/caught for the same reason as the three above — finishCall is
  // contractually never-throws, because the caller has already hung up and
  // there is nobody for a rejection to reach.
  //
  // `abandoned` ONLY: classifyOutcome returns it when the caller actually
  // SPOKE, while a call with no caller speech is `spam`. That distinction is
  // what keeps silent robocalls out of the CRM by classification rather than
  // by rule, and it is why creating a contact here is acceptable.
  let textedBack = false;
  if (outcome === "abandoned" && ctx.textbackEnabled && ctx.callerNumber) {
    try {
      const gate = await resolveSmsSender(ctx.db, ctx.accountId);
      if (gate.ok) {
        const body = ctx.textbackBody.trim() || defaultTextbackBody(ctx.accountName);
        const contact = await createContact(ctx.db, ctx.accountId, {
          firstName: "Caller", phone: ctx.callerNumber, source: "voice",
        }, ACTOR_ID, ACTOR_TYPE);
        const conversation = await ensureConversation(
          ctx.db, ctx.accountId, contact.id, ACTOR_ID, ACTOR_TYPE);
        const message = await createMessage(ctx.db, ctx.accountId, {
          conversationId: conversation.id, channel: "sms", direction: "outbound",
          subject: null, body,
        }, ACTOR_ID, ACTOR_TYPE);
        const { providerMessageId } = await getSmsProvider().send({
          to: ctx.callerNumber, from: gate.from, body,
        });
        await setMessageProviderId(ctx.db, ctx.accountId, message.id, providerMessageId, "sent");
        textedBack = true;
      }
    } catch (e) {
      console.error(`finishCall ${meta.callRowId ?? "(no row)"}: text-back failed: ${String(e)}`);
    }
  }
```

`FinishContext` gains `textbackEnabled: boolean` and `textbackBody: string`;
its one caller reads them from the voice profile it already loads.

⚠️ The `createContact` → `createMessage` ordering above writes the row BEFORE
the send, which is the house write-then-send rule. Keep it: a provider failure
must leave a visible `failed` message, not a silent gap. Set the message to
`failed` in the catch when a message id exists.

- [ ] **Step 4: Run and confirm they pass**

Run: `cd apps/web && npx vitest run src/lib/voice/finish-call.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/voice
git commit -m "feat(voice): text back an abandoned caller, off by default"
```

---

### Task 7: A failed text-back is visible on the call

**Files:** modify the calls list and call detail pages, `lib/messages.ts`

- [ ] **Step 1: Surface it**

There is no retry (roadmap Phase 0b: one cron, no queue), so the only
mitigation is visibility. A `failed` outbound SMS whose conversation belongs to
this call's contact renders on the Calls list row and the call detail as a
badge with a resend control:

```ts
  "calls.textbackFailed": "Text-back didn't send",
  "calls.textbackResend": "Send it now",
```

**Read `calls/page.tsx` and `calls/[callId]/page.tsx` first** and follow their
existing row/detail shape. The resend reuses `sendSmsAction` — do NOT write a
second send path.

- [ ] **Step 2: Gates and commit**

```bash
pnpm check && pnpm --filter web build
git add apps/web/src
git commit -m "feat(calls): show a failed text-back where the operator is already looking"
```

---

### Task 8: e2e and the full gates

**Files:** modify an existing e2e spec (read `voice.spec.ts` / `calls.spec.ts`
/ `messaging.spec.ts` and extend whichever already has the right session — do
NOT create a new spec)

- [ ] **Step 1: The gate boundary, end to end**

```ts
  // Unit tests mock the database and are blind to column grants. This is the
  // layer that sees the real one.
  await page.goto(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  await expect(page.getByText(/A2P registration is approved/)).toBeVisible();
  // Then flip the fixture to approved via setA2pRegistration on serviceDb,
  // reload, and assert the Text mode is now selectable.
```

- [ ] **Step 2: Run the chosen spec alone**

Run: `cd apps/web && npx playwright test <spec>`
Expected: PASS.

- [ ] **Step 3: Full gates**

```bash
pnpm check
pnpm --filter web build
cd apps/web && npx playwright test
```

⚠️ Free port 3000 first — the e2e webServer runs `pnpm build && pnpm start`
and refuses to adopt an existing dev server. **And after any full e2e run,
`rm -rf apps/web/.next` before starting `next dev` again**: the suite leaves a
production build there and `next dev` against it fails in confusing ways
(worker crashes, or 404s on every route). This bit twice on 2026-09-04.

⚠️ `contacts-drawer.spec.ts` and `forms.spec.ts:92` are known contention
flakes that move between tests. If one is the only red, re-run it ALONE before
treating it as a regression, and judge by wall clock.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e
git commit -m "test(e2e): the SMS gate refuses until A2P is approved"
```

---

## Final gates before merge

- [ ] `pnpm check` exit 0 · `pnpm --filter web build` · full e2e
- [ ] Review gate (no autonomous merge)
- [ ] danlo gate

## danlo owes before anything real can send

`TELNYX_API_KEY` and a Telnyx **messaging profile** attached to each sending
number, in Vercel production env. Absent today — the repo has never made an
outbound Telnyx call of any kind. Everything above is buildable and testable
against the fake provider without them.

## Self-review notes

Spec coverage: provider + guard → Task 1; segment counting → Task 1, rendered
in Tasks 3 and 5; channel union → Task 2; the one gate incl. fail-closed on a
null read → Task 2; composer with disabled reason → Task 3; write-then-send →
Tasks 3 and 6; inbound + receipts + the unowned-number log → Task 4; migration
0024 and the off-by-default toggle → Task 5; the fourth leg and the
abandoned/spam distinction → Task 6; no-retry mitigation → Task 7; grants
visible only to e2e → Task 8.

Three `⚠️` notes are verification instructions, not placeholders: confirm the
Telnyx webhook payload shape against current docs before implementing Task 4;
use the real exported db function names in Task 3 rather than the sketched
ones; and read the calls pages before editing them in Task 7. Each says what
to check and what to do about it.

Deliberately not planned: inbound auto-replies, drip sequences, bulk send,
MMS, an `sms_capable` column, per-channel conversation splitting.
