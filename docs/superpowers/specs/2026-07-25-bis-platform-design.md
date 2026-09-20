# BIS Platform — Design Spec

**Date:** 2026-07-25 · **Status:** Approved in brainstorm, pending final review
**Codename:** `bis-platform` (real product name requires trademark/collision check BEFORE buying any domain/handle/listing)

## 1. What & Why

A BIS-owned, multi-tenant client platform in the mold of GoHighLevel: CRM, unified inbox,
booking, automations, review management, and hosted pages for small local businesses —
provisioned per client in minutes from reusable templates, everything stored centrally,
with a deeply-integrated bilingual AI agent layer as the differentiator.

**Drivers (danlo, 2026-07-25):**
1. Own the product — sellable BIS asset, no dependency on HighLevel.
2. Margin — replace $97–497/mo + usage with ~$2–5/client/mo infra cost.
3. Custom AI features GHL structurally can't match (BIS voice receptionist lineage).

**Cadence:** No hard deadline. Quality over speed. Modules ship one at a time to danlo's
existing clients (956 Woodworks, RLC Lumber, …); first paying client onboards at M1.

**Non-goals (v1):** memberships/courses, social planner, ads manager, e-commerce,
affiliate manager, WordPress hosting, 3-level agency reselling UI (architecture supports
it; UI comes at M7+).

## 2. Approach Decision

**Chosen: Build on danlo's proven stack; adopt MIT-licensed libraries only.**
Next.js (Vercel) + Supabase Postgres + Clerk + Telnyx + Resend + Stripe(later).
One central data model; wrap infra vendors exactly as GHL does (GHL's LC Phone = Twilio,
LC Email = Mailgun, payments = Stripe Connect, domains = Cloudflare-for-SaaS, Voice AI =
RetellAI/Synthflow wrappers — see research doc §E).

Rejected: assembling open-source services (Twenty/Chatwoot/Cal.com/n8n) — fragmented
data defeats the AI layer and "stored centrally"; AGPL / n8n Sustainable-Use licensing
traps for a hosted commercial product; permanent ops burden. Rejected: hybrid with paid
hosted components (Cal.com Platform etc.) — recurring per-tenant costs erode the margin
driver and no-deadline removes the speed argument.

**License rule:** external *libraries* must be MIT/BSD/Apache (e.g. Puck page builder,
react-email). No AGPL/SSPL/source-available-restricted code. No external *services* for
core features. Verify every license at adoption time (knowledge cutoff caveat).

## 3. Tenancy & Auth

```
agencies      — row #1 = BIS. Agency layer exists from day one, invisible in v1 UI.
accounts      — the tenant (GHL "Location"): agency_id, name, timezone, branding,
                subdomain, custom_domain (later), status, permissions jsonb (ceiling)
users         — Clerk user id ↔ profile row
memberships   — { user_id, scope: agency|account, role: admin|member,
                account_ids[], permissions jsonb }
```

- Modeled on GHL's 4-field role (`type/role/locationIds[]/restrictSubAccount`) +
  two-level permission bags: the **account-level bag is the ceiling** on membership-level
  bags; plans (M7) derive the account bag → per-plan feature gating is a data change.
- **Every tenant-owned table carries `account_id` with Postgres RLS.** Clerk JWT carries
  the active account claim; agency-scoped claims grant cross-account access via policy.
  Enforcement lives in the database, not the app layer.
- Client users land on their account subdomain (`client.platform-domain`); danlo gets the
  agency dashboard + account switcher ("login as" capability, agency-gated).

## 4. Data Spine (Module 1's schema)

```
contacts         name/email/phone, source, assigned_to, dnd per channel,
                 custom jsonb, attribution jsonb (utm/gclid/fbclid), account_id
tags, contact_tags
pipelines, pipeline_stages
opportunities    status open|won|lost, monetary value, stage/status timestamps
custom_fields    per-account schema-as-data (contact + opportunity models)
custom_values    per-account template variables ({{business_name}}…) — cloning primitive
conversations    ONE per contact (not per channel), unread count, assigned_to
messages         channel sms|email|webchat|voice|note, direction, status lifecycle
                 (queued→sent→delivered→failed/opened), provider_message_id, body, meta
forms, form_submissions   (attribution captured at submit)
tasks, notes
events           append-only domain event log: contact.created, message.received,
                 form.submitted, appointment.booked, call.missed, …
```

- **`events` is the keystone**: automations subscribe to it, AI agents read it for
  context, and it doubles as the audit trail. One primitive, three jobs.
- Search: Postgres (pg_trgm + indexes) until scale demands more. No Elasticsearch.
- Conversation-per-contact copied deliberately from GHL (their best design decision).

## 5. Blueprints (provisioning — "snapshots done right")

A **blueprint** is a versioned JSON bundle of configuration assets: pipelines, custom
fields, tags, form definitions, email/SMS templates (M1); calendar configs (M2);
automation definitions (M3); AI agent configs (M4); page templates (M6) — the asset
vocabulary grows with each module. **Never** live data or credentials — no contacts,
tokens, phone numbers, domains (GHL's exclusion list, research §C.3, defines the line).

- Assets reference **custom values**, so applied config re-points itself per tenant.
- **Idempotent apply:** every asset carries a stable `blueprint_key`; apply = upsert.
  Applying twice duplicates nothing (kills GHL flaw #1: duplicate-on-reload).
- **Provenance + merge:** rows track `origin: blueprint|user` and `modified_by_tenant`.
  Pushing a blueprint update three-way-merges: blueprint-owned & untouched → update;
  tenant-modified → skip and report, never silently revert (kills GHL flaw #2).
- **New-client wizard:** create account → pick blueprint → apply → **activation
  checklist** for non-cloneables: Telnyx number purchase, A2P 10DLC registration, email
  sending subdomain + DKIM, Google Business Profile connect, invite owner. Target:
  signed contract → live client in ~15 minutes of operator time.

## 6. AI Agent Layer (the moat)

One architecture serves all four planned AI capabilities (voice receptionist, web
concierge, follow-up/nurture, review manager):

- **`ai_agents`** per account: persona/prompt, bilingual EN/ES language policy, working
  hours, escalation rules, enabled tools, provider-agnostic model config (OpenAI
  Realtime for voice initially).
- **Shared tool belt:** `search_contacts`, `upsert_contact`, `get_history` (events log),
  `book_appointment`, `send_message`, `add_note`, `handoff_to_human`,
  `search_knowledge`. Every new platform feature enriches every agent.
- **Channels are transports into the same conversation spine:** voice = Telnyx media
  stream ↔ OpenAI Realtime (productized BIS receptionist); webchat = embeddable widget;
  SMS/email = async agent turns. AI messages are ordinary `messages` rows — one inbox,
  human takeover mid-thread is trivial.
- **Knowledge base per tenant:** FAQs + crawled client-site content, pgvector in the
  same Supabase. Voice calls log transcript + summary + extracted data as events.
- **Guardrails:** business-scope-only, DND/quiet-hours respected, always-offer-human,
  per-tenant usage caps (protects danlo's API bill). Informed by CareCompanion/Julia
  persona + cost lessons.
- Follow-up/nurture and review responses = automations (M3) whose action type is
  "hand this thread to the AI agent."

## 7. Vendor / Infra Layer

| Concern | Vendor | Notes |
|---|---|---|
| SMS/Voice | **Telnyx** | One platform connection; `phone_numbers` maps number→account. A2P 10DLC status tracked per account (activation checklist item — deliverability dies without it). |
| Email | **Resend** | Per-account sending *subdomain* + DKIM tracked in `sending_domains`; shared platform domain as starter fallback; inbound-reply webhook → `messages`. |
| Payments | **Stripe** | M7. Danlo invoices clients manually until then. |
| Client sites | **Vercel** (existing per-client sites continue untouched) | Platform serves embeds (form, chat widget, booking page) + hosted pages at `client.<platform>`; Puck (MIT) page builder + custom domains via Vercel Domains API at M6. |
| Adapters | `packages/providers` | Thin `SmsProvider`/`VoiceProvider`/`EmailProvider` interfaces (GHL's ConversationProvider concept) — vendor swap without touching domain logic. |

## 8. Module Roadmap

| # | Module | Client-visible win |
|---|---|---|
| M0 | Foundation: repo, tenancy/RLS, agency shell, events log | accounts can be created |
| M1 | **CRM spine**: contacts, pipeline board, forms + embeds, unified inbox (SMS + email), missed-call text-back (hardcoded first automation), custom fields/values, blueprints v0, activation checklist | **first paying client** |
| M2 | Booking: calendars, booking embed, SMS/email reminders | |
| M3 | Automation engine: event triggers → conditions → actions, quiet hours, metering | |
| M4 | AI: web concierge + voice receptionist, pgvector KB | moat goes live |
| M5 | Reviews: post-job requests, GBP monitoring, AI-drafted replies | |
| M6 | Pages: Puck landing pages inside blueprints | |
| M7 | Billing/plans (Stripe) + agency-layer UI | "sell to other agencies" switch |

Each module ships to a real client before the next starts. **Each module gets its own
implementation-plan cycle; the first plan covers M0 + M1 together** (foundation alone
has no client-visible value).

### 8a. Roadmap status (as of 2026-09-20, the web concierge's second PR, #103)

Nothing else in this repo tracks the table above against what shipped, so this
block does. Read against the 40 specs in `docs/superpowers/specs/` and the code —
each row was checked in the tree, not inferred from a spec's existence.

| # | Status | What exists | What the roadmap row still owes |
|---|---|---|---|
| M0 | ✅ shipped | tenancy/RLS, agency shell, events log | — |
| M1 | ✅ shipped | contacts (paging, drawer, CSV import/export, dedupe), pipeline, forms + embeds, unified inbox (SMS + email), missed-call text-back, custom fields/values, blueprints, activation checklist | — |
| M2 | ✅ shipped | calendars, booking page + embed, SMS/email reminders; plus video meetings and follow-ups the row never asked for | — |
| M3 | ⚠️ partial | a **pass registry** — eight fixed passes on one cron (reminders, follow-ups, review request, no-show nudge, SMS reminder, site traffic, weekly client and agency reports). `2026-09-06-automations-design.md` names it "a HARNESS, not a shared algorithm" on purpose. | the engine itself: user-defined **triggers → conditions → actions**, quiet hours as a rule rather than a per-pass gate, metering |
| M4 | ⚠️ partial | the voice receptionist, live on a real client — answer route, realtime lifecycle, tools, summaries, spam screening, handoff, call proposals; a "Talk to Sofía" web demo; **the web concierge** (#102 the chat, #103 the switch and the bubble) — a text assistant every client can turn on from the Voice page and paste onto their own website as one script tag, filing leads through the form they chose. Standard for every client, not a favour to one. | the **pgvector knowledge base** — deliberately not in v1: the live account's facts are 2,510 characters and a prompt holds them (`2026-09-20-web-concierge-design.md`); no pgvector migration exists. And one proof, not a feature: the concierge's reply path has never been exercised end to end by a machine (the model-call test skips without `OPENAI_API_KEY` in CI), so the first client to switch it on gets a deliberately watched first conversation. |
| M5 | ⚠️ partial | post-job review-request messages (one automation pass) | **GBP monitoring** and **AI-drafted replies**. The checklist's `gbp_connect` item is a "done outside BIS" manual step, not a feature. |
| M6 | ❌ not started | — | Puck landing pages inside blueprints; Puck is not a dependency |
| M7 | ❌ not started | — | Stripe plans, agency-layer UI, the "sell to other agencies" switch; no Stripe anywhere |

**Read across the rows:** M0–M2 done, M3–M5 half-done, M6–M7 untouched. Most of
the work since M2 went to things the table never listed and the first client
needed first — white-labeling and per-tenant theming, A2P 10DLC registration, spam
screening, call handoff, the work queue, call proposals, the weekly report. The
roadmap said "each module ships to a real client before the next starts"; in
practice the first real client's traffic (robocalls, mostly) set the order.

**What the GHL inventory (`docs/research/ghl-domain-model.md` §B) has that this
roadmap never adopted, by decision (§2), not by omission:** funnels/websites
builder, social planner, ad manager, memberships/courses/communities,
payments/invoicing/store, documents & e-sign, affiliate manager, marketplace/apps,
online listings. Not gaps. The one worth revisiting is **SaaS mode / white-label
billing**, because that is what M7 is.

**Update this block when a row changes status** — a status table that is not
maintained is worse than none, because it reads as current.

## 9. Repo & Conventions

`C:\Users\danlo\bis-platform` — pnpm monorepo, carecompanion conventions:
`apps/web` (Next.js App Router) · `packages/db` (migrations + RLS) · `packages/core`
(blueprint engine, automations, permissions) · `packages/providers` · `packages/ai` ·
`packages/ui`. GitHub (dlopez2392), Vercel push-main = deploy, review-gate with danlo
before every merge to main.

## 10. Security & Testing

- RLS on every tenant table + **automated cross-tenant isolation tests in CI** (reads
  with forged claims must fail). This suite is a sales asset, not just hygiene.
- Webhook HMAC verification (Telnyx, Resend, Clerk). Service-role key server-only.
- TCPA basics enforced at the single message-send chokepoint: DND, STOP-keyword
  handling from provider webhooks, quiet hours.
- vitest gates per package + `tsc` clean (house style); Supabase-local for RLS tests;
  Playwright smoke for wizard + inbox once built.
- Events log = audit trail.

## 11. Unit Economics (the margin story)

Per client: Telnyx number ~$1/mo + ~$0.004/SMS · email ≈ free→cheap (Resend tier) ·
shared Supabase/Vercel · AI usage metered per tenant with caps ⇒ **~$2–5/client/mo**
vs GHL's $97–497/mo + usage. Pricing to clients is danlo's call per engagement.

## 12. Risks & Open Questions

1. **A2P 10DLC registration latency/cost** per client brand — must be in the activation
   checklist critical path; verify current Telnyx process at M1 build time.
2. **License verification at adoption time** for every external library (Puck etc.).
3. **Product naming** — full trademark/collision check before any domain/handle purchase
   (CareCompanion lesson).
4. **Scope gravity:** GHL is 15 products; the module gate ("ships to a real client
   before the next starts") is the discipline mechanism.
5. **Email deliverability** on the shared fallback domain — move active senders to their
   own subdomain early.
6. Spend/usage caps on AI per tenant need real metering before M4 GA (Julia cost lesson).

## 13. References

- `docs/research/ghl-domain-model.md` — reverse-engineered GHL entity model, feature
  map, snapshot mechanics, multi-tenancy/white-label design, vendor map (public sources:
  their OpenAPI corpus on GitHub, help docs, sub-processor list).
- Clean-room stance: concepts and feature ideas only; no GHL code, branding, UI assets,
  or copied docs.
