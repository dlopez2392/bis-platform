# SMS and missed-call text-back — Design

Roadmap Phase 1b + 1c (`docs/superpowers/plans/2026-09-03-product-roadmap.md`).
Phase 1a (A2P registration as real state) shipped in `27e5207` and is the gate
this design depends on.

Every file:line below was verified against source on 2026-09-04.

## Goal

A company cleared to text can send and receive SMS from the platform, in the
same conversation thread as their email — and, when switched on, can text back
a caller who spoke to Sofía but left without booking.

## What already exists, and what that buys

- **`'sms'` is already legal at the database layer.** `0006_forms.sql:92` sets
  the CHECK to `('email','sms','webchat','voice','note','form')` — a deliberate
  "channels are adapters, not migrations" decision. Adding the channel is a
  one-word edit to the TypeScript union at `packages/db/src/messaging.ts:13`.
- **Delivery receipts need no new plumbing.** `updateMessageStatusByProviderId`
  finds a row by the globally-unique `provider_message_id` and reads
  `account_id` back off it. Telnyx events map onto the existing `STATUS_RANK`
  ladder (`messaging.ts:39-46`: queued 0 → sent 1 → delivered 2 →
  bounced/failed 4), which is monotonic and forward-only, so a late `sent`
  after a `delivered` is correctly ignored (`messaging.ts:162`).
- **Inbound signature verification is already generic.** `verifyTelnyxSignature`
  (`lib/voice/telnyx-signature.ts:14`) takes `{rawBody, timestamp,
  signatureB64, publicKeyB64}` and contains nothing voice-specific. Reused
  verbatim.
- **`voice_profiles` is already serviceDb-only.** `0020_voice_grants_revoke.sql`
  revoked insert/update/delete from `authenticated`. A new column there
  inherits that posture: no grant work, and **a client cannot flip their own
  text-back toggle.**

## Decisions (danlo, 2026-09-04)

1. **Scope is 1b + 1c**, with the plan sequenced so 1b ships alone.
2. **One unified thread per contact.** Conversations stay keyed
   `conversations_account_contact_unique` (`0005_messaging.sql:24`) with no
   channel column. Email and SMS interleave in one timeline, each message
   tagged by `channel`. Zero migrations; matches how a small business thinks.
3. **Text-back fires for `abandoned` only, and creates a contact.**
4. **A2P gate: visible but disabled, with the reason** and a link to the
   checklist.
5. **Text-back ships OFF by default**, per-company toggle.
6. **No `sms_capable` column.** A2P approval plus a live number is the gate.
7. **Ship 1c without retry**, and make the failure visible on the call.

## Architecture

### `SmsProvider`, mirroring `EmailProvider`

New `apps/web/src/lib/sms/{types,index,fake,telnyx}.ts`, shaped after
`lib/email/types.ts:27`:

```ts
export type SendSmsInput = { to: string; from: string; body: string };
export type SendSmsResult = { providerMessageId: string };

export interface SmsProvider {
  readonly isFake: boolean;
  readonly redirectTo?: string;
  send(input: SendSmsInput): Promise<SendSmsResult>;
}
```

**The selection guard is copied from `getEmailProvider` (`lib/email/index.ts:31`)
including its reasoning**, which is the single most important thing carried
over — a stray SMS to a real contact cannot be unsent:

```ts
const isProduction =
  env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";
```

`NODE_ENV` is read from the real process env, never from the injectable `env`
param: Next hardcodes it under `next dev` and refuses to let a `.env` file
override it, so it cannot be spoofed the way `VERCEL_ENV` can. Outside
production the fake provider records instead of sending;
`SMS_DEV_REDIRECT_TO` mirrors `EMAIL_DEV_REDIRECT_TO` for deliberate real
sends to one number.

### One shared gate, two callers

```ts
type SmsGate =
  | { ok: true; from: string }
  | { ok: false; reason: "a2p_not_approved" | "no_live_number" };

export async function resolveSmsSender(db, accountId): Promise<SmsGate>;
```

Both the composer and text-back consult this and neither re-derives it — two
gates that can disagree is how a number ends up blocked for the wrong stated
reason. `ok` requires `getA2pRegistration(...).status === "approved"` **and** a
`phone_numbers` row with `status = 'live'`. Several live rows: the oldest by
`created_at`, deterministically. None: `no_live_number`.

### Write-then-send

From `sendEmailAction` (`conversations/actions.ts:20`): the `messages` row
exists before anything leaves the building, so a provider failure is a visible
`failed` message carrying Telnyx's reason rather than a silent gap. `subject`
is null for SMS — already nullable (`messaging.ts:97`).

## Data — migration `0024`, the only schema change

```sql
alter table public.voice_profiles
  add column textback_enabled boolean not null default false,
  add column textback_body text not null default '';
```

`false` is the honest default. **An empty `textback_body` means "use the live
default at send time"** — the exact contract `calendar.followup_body` carries,
so an unrelated save can never silently pin the frozen default into the column.
The settings textarea shows the live default as its `placeholder`, greyed, so
typing replaces rather than appends.

## Segment counting — encoding-aware, not a character count

SMS fits 160 characters in GSM-7. **Any character outside that set drops the
whole message to UCS-2 at 70 characters per segment.** This platform is
bilingual by design (`greeting_es`, `?locale=es`, Spanish booking pages), so a
Spanish text with the wrong accent or a curly apostrophe silently less-than-
halves capacity and doubles the bill.

A naive character count would therefore mislead precisely where it matters
most. `lib/sms/segments.ts` exports a pure `segmentsFor(body): {encoding, chars,
segments}` with a GSM-7 charset table, rendered under the composer and the
text-back settings textarea. This is DESIGN.md rule 1 — every metric ships with
context — applied to the client's money.

## Inbound SMS

`POST /api/sms/inbound`. Verifies with `verifyTelnyxSignature` against
`TELNYX_PUBLIC_KEY`, resolves the account from the *called* number
(`phone_numbers.e164`), matches an existing contact on that account by phone
and creates one if there is none — the same resolve-or-create shape
`finishCall` already uses for a meaningful call, so an inbound text from a
known customer joins their existing thread rather than opening a duplicate —
then `ensureConversation` (`messaging.ts:48`) and `createMessage` with
`channel: "sms"`, `direction: "inbound"`.

An unknown called-number returns **200 with no write**: a webhook that 500s
gets retried forever, and a number this platform does not own is not an error
condition it can fix.

**But it is logged, not merely dropped.** `console.error` with the called
number, so it reaches Vercel's runtime logs. The failure this guards against
is a number we DO own whose `phone_numbers` row is missing or wrong — in which
case a real customer's text is being silently discarded and nothing on any
screen would ever say so. Logging is the difference between a discoverable
misconfiguration and an invisible one. It stays a log rather than a stored row
because an unowned number is, by definition, not attributable to a tenant.

**Delivery receipts arrive at the same route**, not a sibling: Telnyx posts
both inbound messages and status callbacks to one webhook URL, so the handler
branches on the event type and calls `updateMessageStatusByProviderId`
unchanged for status events. One route means one signature check and one place
where an unknown event type is ignored rather than 500'd.

## Missed-call text-back

A **fourth independent leg in `finishCall`**, matching that file's existing
three-legs-each-allowed-to-fail architecture, gated on
`outcome === "abandoned"` and `textback_enabled`.

`abandoned` and `spam` are different and the distinction is load-bearing:
`classifyOutcome` (`lib/voice/call-state.ts:31`) returns `abandoned` only when
the caller actually **spoke**; a call with no caller speech is `spam`. Gating on
`abandoned` therefore excludes silent robocalls by classification rather than
by rule, which is what makes creating a contact acceptable — the residual
"noise" is real humans who spoke and did not convert, who are exactly the
follow-up target.

The leg creates the contact an abandoned call does not create today
(`isMeaningful`, `finish-call.ts:62`, covers only booked/lead/message), then
`ensureConversation`, then the message — so the text lands in the unified
thread and a reply has somewhere to go.

**Independently try/caught**: `finishCall` is contractually never-throws
because the caller has already hung up. **The Telnyx call carries an explicit
`AbortController` timeout** — this runs on a webhook and a hanging provider
must not hold that request open.

### Known limitation, stated rather than discovered

There is no queue (roadmap Phase 0b: one cron, `0 14 * * *`, no Inngest/QStash/
pg-boss/`waitUntil`). **The send is synchronous and has no retry.** If Telnyx
is unavailable at that moment the text is lost.

Mitigation: write-then-send makes it a `failed` message, and **a failed
text-back is surfaced on the Calls list and call detail**, where the operator
is already looking after a missed call — not only in a Conversations thread
nobody is watching. That turns "silently lost" into "visible, with a resend."

This is the strongest practical argument for Vercel Pro in the codebase, and it
should not be read as making Hobby sufficient: Phase 2's waiting automations
have no runtime at all on a once-daily cron.

## Testing

- **Unit**: `segmentsFor` (GSM-7 vs UCS-2 boundaries, a Spanish string that
  crosses it, the 70/160 edges); `resolveSmsSender` for all three outcomes; the
  provider guard's production/non-production selection; Telnyx status →
  `MessageStatus` mapping including the monotonic-ladder case.
- **The guard is the one that matters most.** A test that proves the real
  provider is unreachable outside production is the test standing between this
  feature and an accidental text to a real person.
- **e2e**: the composer shows SMS disabled with its reason for a non-approved
  account, and enabled once approved (the fixture account can be flipped via
  `setA2pRegistration` on `serviceDb`). ⚠️ Unit tests mock the database and are
  blind to column grants — the `voice_profiles` write posture from `0020` is
  only observable through e2e or a real userDb token.
- **No test may send a real SMS.** The fake provider is the default outside
  production by construction, not by discipline.

## Out of scope, deliberately

Inbound auto-replies (Sofía answering texts), scheduled or drip sequences (no
runtime), bulk or marketing send, MMS, an `sms_capable` column, and per-channel
conversation splitting.

## Prerequisites danlo owns

`TELNYX_API_KEY` and a Telnyx **messaging profile** attached to each sending
number, both absent today — the repo has never made an outbound Telnyx call of
any kind. Needed in Vercel production env before anything real can send; the
fake provider covers all development until then.

## Open, carried from the A2P review

- **`resolveSmsSender` IS the `isClearedToText` predicate the A2P review asked
  for** — there is no second function. It returns a typed refusal rather than a
  boolean, and `getA2pRegistration` returning null (missing or RLS-invisible
  row) must resolve to `a2p_not_approved`, never to cleared. It is the only
  thing any send path consults.
- A2P status on the accounts **list** — the A2P spec's exit criterion reads
  plural ("see which clients are cleared") and today it is one account at a
  time. A status dot on `dashboard/accounts/page.tsx`.
