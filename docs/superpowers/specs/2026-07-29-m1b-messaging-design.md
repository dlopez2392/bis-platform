# BIS Platform — M1b Messaging (outbound email)

**Date:** 2026-07-29
**Status:** Approved design, pending implementation plan
**Scope:** Conversations and messages, outbound email via Resend, wired into the contact timeline and a real Conversations screen.

---

## 1. Why

`Conversations` currently ships as an honest empty state pointing at this milestone, and the contact detail screen has a composer that only writes internal notes. The original platform spec (§4) already models `conversations` and `messages`; M1b makes them real.

This milestone deliberately delivers **one channel, one direction**. The reasoning is in §3.

---

## 2. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Channel | **Email only**, via Resend | SMS to US numbers requires A2P 10DLC brand + campaign registration — an external carrier vetting queue measured in days to weeks. Gating the milestone on it means the completion date is set by paperwork, not by work. Resend is already in use on bis-rgv.com and needs no registration. |
| Direction | **Outbound only**, inbound modeled | Receiving needs a subdomain with MX records, a verified inbound path, and reply-matching. `direction` and the channel enum exist from day one so inbound is an adapter, not a migration. |
| Surfaces | Contact composer **and** a real Conversations screen | Sending belongs where you already are — looking at a contact. Conversations fills a nav item that currently goes nowhere, and it is the exact screen inbound plugs into later. |
| Sender identity | **One BIS domain**, per-account from-name, reply-to the client's address | Per-account verified domains are the correct end state for a resold product, but cost a DNS onboarding step per company and a domain-status UI. Heavy for one client and one operator. No per-account sender column is added — a column nothing reads is speculative generality. |
| Send execution | **Write-then-send** with a status lifecycle | The message row exists before anything leaves the building, so a provider failure is a visible `failed` message rather than a silent gap. Honors the lifecycle the platform spec already specifies. A queue with a background worker was rejected: no queue or cron exists in this project, and that is infrastructure for a scale problem that does not exist. |
| Non-production sending | **Hard-guarded, not opt-in** | See §7. This is the highest-consequence risk in the milestone. |

### Non-goals

- SMS. It becomes an adapter behind the same interface once A2P registration clears.
- Inbound email. No MX records, no receiving path, no reply matching.
- Assignment and user management. `conversations.assigned_to` is nullable and unused; there is one operator and assignment matters when there is a team.
- Templates and custom values — those are M1c.
- Attachments, scheduled sends, bulk sends.

---

## 3. Why one channel and one direction

A "unified inbox" with no inbound mail is really a list of threads you started. That is a fair criticism of this scope and worth stating plainly rather than glossing.

It is still the right first cut. Outbound email exercises the entire architecture end to end — conversation creation, message lifecycle, provider integration, webhook status, and both UI surfaces. Inbound and SMS then each add one adapter against interfaces that already exist and have been used in anger. The alternative — building all channels and both directions at once — front-loads DNS work and a carrier queue before a single message has ever been sent successfully.

---

## 4. Data model

Migration `0005` adds two tables, following the M0/M1a pattern: `account_id` on every row, RLS policies via the `app.*` helpers, and an event emitted on every mutation.

**`conversations`** — one per contact, **not** per channel. The platform spec calls conversation-per-contact GHL's best design decision; a person is one conversation regardless of how they reached you.

- `id`, `account_id`, `contact_id` — unique on `(account_id, contact_id)`
- `last_message_at` — orders the inbox
- `unread_count` — integer, default 0. **Stays 0 this milestone**: nothing can be unread when every message is outbound. The column exists so inbound does not have to migrate a live table, and the plan should not build logic to maintain it.
- `assigned_to` — nullable, references `users(id)`, unused this milestone
- `created_at`, `updated_at`

**`messages`**

- `id`, `account_id`, `conversation_id`
- `channel` — the full enum from the platform spec (`email`, `sms`, `webchat`, `voice`, `note`). Only `email` is written this milestone; SMS is then a value, not a migration.
- `direction` — `outbound` | `inbound`. Only `outbound` is written.
- `status` — `queued` | `sent` | `delivered` | `opened` | `bounced` | `failed`
- `provider_message_id` — nullable, correlates webhook events
- `subject`, `body`, `error` (nullable), `meta` jsonb
- `created_at`, `updated_at`

Indexes: `(account_id, conversation_id, created_at)` for thread reads, and `(provider_message_id)` for webhook lookups.

**Deliberate forward-modeling:** `direction` and the full `channel` enum exist before anything uses them. Adding two enum values now is cheap; migrating a live `messages` table later is not. This is the one place in the design where speculative structure earns its place.

---

## 5. Sending pipeline

Three pieces with distinct responsibilities:

**`@bis/db`** gains `ensureConversation`, `createMessage`, `updateMessageStatus`, `listConversations`, `listMessages`. Pure data access. The Resend call does **not** live here — that package talks to Postgres and should keep doing only that.

**`apps/web/src/lib/email/`** holds a thin provider wrapper exposing a single `sendEmail(...)` interface, plus the non-production fake (§7). One consumer today, so it stays a lib module rather than a new workspace package — the same reasoning that kept shadcn components out of `packages/ui`.

**The server action orchestrates:**

1. `ensureConversation(accountId, contactId)`
2. `createMessage(..., status: "queued")`
3. `sendEmail(...)`
4. `updateMessageStatus(id, "sent" | "failed", { providerMessageId, error })`

Failure at step 3 leaves a `failed` row with the error recorded and surfaces a toast, following the catch-and-toast pattern every other surface in this app uses. Nothing is lost and nothing is silently dropped.

**Webhook** — `app/api/webhooks/resend/route.ts`:

- Verifies the provider signature before reading the body. This is an unauthenticated public endpoint and the signature is the only thing standing between it and forged status updates.
- Looks the message up by `provider_message_id`, scoped by the message's own `account_id` — never by an account id taken from the payload.
- **Idempotent.** Providers retry; the same event arriving twice must produce the same result.
- Emits a domain event on status change.

---

## 6. Surfaces

**Contact detail composer.** The footer composer today writes internal notes. It gains a channel switch: **Note** (existing behavior, unchanged) and **Email** (new, sends). Same location, one extra control, nothing to relearn. Email mode adds a subject field.

**Conversations screen.** Two panes:

- **Left** — threads ordered by `last_message_at`: contact name, last-message preview, relative time. `EmptyState` when there are none. **No unread indicator** — outbound-only means nothing is ever unread, and a badge that can never appear is dead UI. It arrives with inbound.
- **Right** — the selected thread. Messages styled by direction, each showing its status; composer beneath.

Selection lives in the URL (`?c=<conversationId>`) so threads are linkable and the back button behaves. Below `lg` the panes stack, list first.

Both surfaces render inside the existing app shell with `PageHeader`, semantic tokens only, and every string from the `m` catalog.

---

## 7. Non-production sending — the guard

**This is the highest-consequence risk in the milestone and the design treats it as such.**

This code sends real email. It runs in local dev, in Vercel preview deploys, and under Playwright. Today's contacts are fake, but the moment one real client contact exists, a stray test run reaches a real person's inbox and there is no unsend.

Therefore: **outside production, sending is redirected by default.** Not a flag someone remembers to set — the default path.

- Non-production resolves to a **fake provider** that records the call, returns a synthetic `provider_message_id`, and sends nothing.
- The full pipeline still runs: rows are written, status advances, the UI behaves identically. Coverage is real; delivery is not.
- E2E tests assert against the fake.
- If a real send is ever wanted outside production, it requires an explicit environment variable naming a single allowlisted recipient — never the contact's actual address.

A guard that depends on remembering to enable it is not a guard.

---

## 8. Testing

- **`@bis/db`** against the real database, following the existing `withTestAccount` harness: `ensureConversation` is idempotent (two calls, one row); `createMessage` writes and emits; `updateMessageStatus` correlates by `provider_message_id`; `listConversations` orders by `last_message_at`.
- **Webhook handler**: rejects an invalid signature; is idempotent across a replayed event; ignores an unknown `provider_message_id` without erroring.
- **Playwright**: compose an email from the contact timeline, assert it appears in the thread with a status, and assert it appears in the Conversations list — against the fake provider.
- `pnpm check` (typecheck + lint + tests) green before every commit.

---

## 9. Risks

**Emailing a real person from a non-production environment.** Addressed in §7. Everything else on this list is recoverable; this one is not.

**Webhook is an unauthenticated public endpoint.** Signature verification is the security boundary. The handler must never trust an account id, message id, or status taken from an unverified payload.

**Resend rate limits and transient failures.** Surface as `failed` with the error recorded; the row is preserved and the user is told. No retry logic this milestone — a queue is a later problem.

**Scope creep toward a full inbox.** Assignment, filters, bulk actions, and templates all feel adjacent. They are non-goals (§2) and the plan should treat them as such.

---

## 10. Success criteria

- An email sent from a contact's timeline arrives at a real address in production, with status advancing past `sent` via webhook.
- The same message appears in the Conversations thread and moves that thread to the top of the list.
- A provider failure produces a visible `failed` message and a toast, never a silent gap.
- No non-production environment can send to a contact's real address.
- `pnpm check` green; new `@bis/db`, webhook, and Playwright tests passing.
