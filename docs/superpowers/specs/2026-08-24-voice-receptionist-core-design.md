# Voice Receptionist Core (V1) — Design

**Date:** 2026-08-24 · **Status:** Approved by danlo (three-section review, this session)
**Fulfills:** the receptionist half of roadmap M4 ("AI: web concierge + voice
receptionist — moat goes live")

## 1. What this is

The BIS Reception Demo ("Sofía", `bis-reception-demo`, live on +1 956 705 5146)
proved a complete AI answering service on real telephony: bilingual voice AI
that answers business questions, captures leads, takes messages, books a real
calendar, and records every call durably. This project ports that proven
capability into bis-platform as a **multi-tenant, per-client product**: every
company BIS signs can be sold a complete answering service, provisioned from
the platform, whose calls land in that company's CRM.

This is sub-project 1 of 3. The decomposition, agreed up front:

1. **Voice core (THIS SPEC)** — multi-tenant call handling inside bis-platform.
2. **Onboarding wizard + Calls page** — agency-driven guided provisioning
   (Telnyx number purchase → profile → verified test call → forwarding
   instructions → go-live), extending the activation checklist.
3. **Web concierge + knowledge base** — embeddable widget per client reusing
   the same brain; pgvector KB.

Each sub-project gets its own spec → plan → implementation cycle.

## 2. Decisions locked with danlo — do not re-litigate

- **V1 scope = full Sofía parity**: answer from profile, capture leads, take
  messages, AND book appointments — into the platform's **native calendar**,
  not Cal.com. Cal.com is gone from the client story.
- **Number model = BIS-owned + forwarding**: every client gets a new number
  purchased in BIS's Telnyx account (~$1/mo). The client publishes it directly
  or forwards their existing line to it (2-minute carrier setting). No
  porting. The GHL model: BIS owns the whole stack.
- **Onboarding is agency-driven**: the wizard (sub-project 2) is built for
  danlo/BIS staff, white-glove. Clients never see setup complexity.
- **Architecture = port the brain into bis-platform** (Approach A of three
  considered). One repo, one deploy, native data, RLS tenancy. NOT a separate
  voice service with API integration — danlo's stated goal is to *own the
  platform*, and A is the only option where the answering service is a feature
  of the product rather than a partner service beside it.
- **BIS's own line does not move.** +1 956 705 5146 and the demo repo stay
  exactly as they are until the platform version has proven itself with a
  client; then BIS migrates as account #1 and the demo retires to sales
  sandbox. Nothing in this project touches `bis-reception-demo`.
- **The persona name is per-account data** ("Sofía" is the default, not a
  constant) — clients may want their own receptionist name.

## 3. Architecture

### 3.1 Telephony chain (one shared pipe, tenant fork at the webhook)

```
client's customers → client's published/forwarded number (Telnyx, BIS account)
  → ONE shared PLATFORM TeXML app (static <Dial><Sip>sip:PROJECT_ID@sip.api.openai.com)
  → OpenAI SIP connector (the platform's OWN OpenAI project — see below)
  → realtime.call.incoming webhook → bis-platform /api/voice/incoming
  → sig-verify (standard-webhooks, OPENAI_WEBHOOK_SECRET)
  → parse CALLED number from sip_headers → phone_numbers lookup → account
  → accept call with that account's session config (greeting, profile, language)
  → attach WS (`ws` pkg), in-process call loop, tools scoped to that account
  → on hangup: durable calls row + lead treatment + guarded summary
```

One webhook, one TeXML app, one OpenAI project, any number of clients. The
demo's carrier-agnostic lesson holds: the webhook receives OpenAI's event
regardless of carrier.

**The platform gets its OWN OpenAI project and its OWN TeXML app**, created
fresh — NOT shared with the demo. OpenAI webhooks are configured per project,
and the demo's project webhook points at demo.bis-rgv.com; sharing it would
either break the demo or route BIS's line through untested code. Two projects
in the org, one per system, each with its own `OPENAI_WEBHOOK_SECRET`. This is
also what keeps the "demo stays untouched" promise (§2) true by construction.

### 3.2 Call runtime

- One long-lived serverless invocation per call holding the WebSocket —
  exactly the demo's shape, proven on Vercel Hobby (`runtime="nodejs"`,
  `maxDuration=300`, call cap `PHONE_MAX_CALL_SECONDS=240`).
- **Per-call state is in-process. No Redis in the platform version.** The
  demo needed Redis for the web-widget/dashboard split; a phone call's state
  lives and dies with its invocation, and the durable record is written at
  hangup. This deletes the demo's entire session-migration bug class
  (`normalizeState` etc.).
- Daily call caps (per-number and per-account) use Supabase counters,
  checked BEFORE accepting the call (that's where cost starts), **fail-open**
  on infrastructure errors.
- Tools execute via `serviceDb()` scoped to the resolved account — same
  privilege model as the booking status actions, tenant boundary pinned by
  cross-account tests.

### 3.3 Ported from the demo (the paid-for lessons, by name)

- `toE164()` on every phone number leaving the app (Cal bug 1: E.164 or
  nothing; native columns get the same discipline).
- Turn detection module verbatim: semantic VAD, `eagerness: medium` (danlo
  personally tuned this — the ladder lives in the demo's
  `src/lib/ai/turn-detection.ts` history), env-tunable via `PHONE_*` vars.
- 900ms greeting delay (`PHONE_GREETING_DELAY_MS`) — SIP accept returns at
  RINGING, not media-ready.
- Digit-by-digit phone readback; email asked ONCE for confirmations, booked
  on phone alone if declined; after 2 failed contact confirmations, stop and
  take a message — never book a guessed address.
- AI disclosure in the greeting. No-invented-facts and never-quote-price
  prompt rules, fenced to the profile's own facts.
- Summary honesty, all three layers: `(none)` markers in the summary input,
  the stored summary LEADS with a fact line derived from state (not the
  model), per-sentence mismatch check prepending ⚠ MISMATCH.
- Never-lose-a-call: recorded if the DB write OR the notify email succeeds;
  only losing both logs `CALL LOST`. The recorder never throws.
- Outcome taxonomy: `booked` / `lead` / `message` / `abandoned` / `spam`.
- Caller-ID parser (`extractCallerNumber` on the SIP From header) — verified
  against real Telnyx traffic.
- The CalendarAdapter lesson (demo BUG 5): **any tool that changes external
  state must leave call state truthful**, or classification/recording lies.
  Platform tools mirror their effects into call state the same way.

## 4. Data model (three new tables; migration numbering continues from 0018)

### `phone_numbers` — the tenant router
- `id`, `account_id` FK, `e164` (unique), `telnyx_id`, `status`
  (`provisioned` → `testing` → `live` → `released`), timestamps.
- One account may hold several numbers later; v1 assigns one.
- RLS: agency full, client read-own (a client can see their number, never
  another's). Writes via serviceDb + app guard only (the M4d precedent).

### `voice_profiles` — one per account, "practice is data, not code"
- Greeting script (EN/ES), business facts / FAQ text the AI may answer from,
  services list, languages (`en` / `es` / `both`), persona name (default
  "Sofía"), booking enabled (bool), after-hours behavior
  (`hours_then_message` / `message_only`).
- **Business hours are NOT stored here** — they come from the account
  calendar's existing `open_hours`. One source of truth.
- RLS: same shape as `phone_numbers`.

### `calls` — durable record + metering ledger
- `id`, `account_id`, `phone_number_id`, `contact_id` (nullable),
  `conversation_id` (nullable), `booking_id` (nullable), `caller_e164`
  (nullable — anonymous), `language`, `outcome`, `started_at`, `ended_at`,
  `duration_secs`, `turn_count`, `transcript` JSONB, `summary` text,
  timestamps.
- Duration + turns per account = the raw material for pricing (M7 billing).
  Metered from day one; caps exist before billing does.
- `booking_id` gives `find_my_booking` by caller ID natively — the
  phone→booking map Cal.com couldn't provide.

## 5. The AI's tools (demo contracts, platform accessors)

| Tool | Platform implementation |
|---|---|
| (answer questions) | Prompt-only, fenced to `voice_profiles` facts |
| `capture_lead` | Existing lead treatment: contact dedupe → conversation → unread → branded alert email |
| `take_message` | Message into the caller's conversation + alert |
| `check_availability` | Native `slots.ts` engine (same slots the public booking page offers) |
| `book_appointment` | Native `createBooking` — overlap exclusion constraint, confirmation email with cancel link, `toE164` enforced |
| `find_my_booking` | `calls` lookup by `caller_e164` → `booking_id` → cancel, or "reschedule" as cancel + fresh booking (the platform has no reschedule primitive; the AI presents it as one operation) |

Booking failures degrade to `take_message`, never to a guessed booking.

## 6. What people see

- **Operator:** nothing new to learn. The call lands in **Conversations**
  (summary as a message in the caller's thread, unread badge), the booking on
  the Calendar page. A dedicated Calls page is a view over `calls` and ships
  with sub-project 2.
- **Client (portal):** their own call activity via the conversations and
  bookings they already see. RLS already fences it — zero new access-control
  surface.
- **Caller:** the demo's tuned feel, inherited wholesale (§3.3).

## 7. Failure behavior

- Unrecognized/unconfigured called number → polite "can't take your call
  right now" + hangup. Never a crash, never another tenant's greeting.
- Caps exceeded → same polite refusal before accept (cost starts at accept).
- Never-lose-a-call as in §3.3; alert email respects the M4d sending rules
  (client-facing sends carry `from_email`, staff alerts stay platform-From).
- A voice failure must never corrupt CRM data: tools are the same accessors
  the rest of the platform uses, with the same validation.

## 8. V1 admin surface (pre-wizard)

A plain agency-only settings page per account: assign an existing Telnyx
number (bought by hand in the Telnyx dashboard for the first client), edit
the voice profile, enable/disable. The wizard (sub-project 2) automates
purchase and gates go-live on a verified test call — but v1 must be fully
operable without it.

## 9. Testing

- Unit: tools, tenant routing, E.164, outcome classification, summary guards
  — ported test contracts, including correct rewrites of the demo tests that
  once encoded bugs (BUG 4/5).
- A webhook-simulation harness so full call flows run in CI without
  telephony.
- Env-gated live tests for Telnyx and OpenAI contracts (the demo's
  `cal-live.test.ts` pattern — the only thing that catches a wrong API
  version/contract).
- **The exit gate is a real phone call and a read of the rows it produced**
  (calls + contact + conversation + booking), not a green suite. Five
  reception bugs were invisible to green gates; this rule is why.

## 10. Verify before planning (both look right on paper, neither proven)

1. **The webhook's `sip_headers` carry the CALLED number** reliably enough
   for tenant routing. The demo logs header keys on every call — one real
   call to the demo line answers this without new code.
2. **Telnyx number-purchase API** (search → buy → attach to TeXML app) —
   endpoints, auth, and whether BIS's Business-tier account can do it
   programmatically. Needed for sub-project 2 but worth a probe now since it
   could shape the `phone_numbers` columns.

## 11. Out of scope for V1 (recorded, not forgotten)

- The onboarding wizard, Calls page UI, forwarding cheat-sheets → sub-project 2.
- Web concierge widget, pgvector KB → sub-project 3.
- SMS (missed-call text-back etc.) — still blocked on A2P 10DLC registration.
- Outbound calling of any kind.
- Billing — metering ships now, invoicing is M7.
- Migrating BIS's own line — after the first client proves the platform path.
- Call recordings (audio) — transcripts only; recording consent/notice rules
  differ by state and need their own decision.

## 12. Cost note (for the record)

Every call burns OpenAI Realtime minutes on BIS's key (~10–30¢/call at demo
rates) plus ~$1/mo/number. `calls` metering exists so pricing can be set from
data; daily caps bound the downside meanwhile.
