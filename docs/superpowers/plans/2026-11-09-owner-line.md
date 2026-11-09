# F-032 The Owner Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person on a business's team calls the business's own number from their verified cell, keys a 6-digit PIN before the call ever reaches OpenAI, and Sofía answers read-only questions (calls, appointments, To do; customer lookup in PR 2) within exactly what their role sees, while every other caller hears exactly what they hear today.

**Architecture:** The TeXML answer route gains one enrollment lookup that runs beside its existing count reads and fails to a miss. On a hit it answers with a `<Gather>` whose action, `/api/voice/texml/owner-pin`, checks the PIN in SQL under a row lock and, on a match, bridges exactly as today with a signed owner pass on the SIP URI. The pass is signed with the same secret family as `X-BIS-Signature` and bound to the call's handoff token. The Realtime SIP webhook verifies the pass against the INVITE's own signed statement and a live re-read, then accepts a separate owner-line session. That session's only tools are read-only, and they read through ONE client factory (`lib/owner-line/reader.ts`) whose data path the Task 0 spike decides. Owner-line calls are ordinary `calls` rows marked by `owner_line_user_id`, and every counting choke point excludes them.

**Tech Stack:** Next.js 16 route handlers (Node runtime), Telnyx TeXML, OpenAI Realtime SIP (`gpt-realtime`), Supabase Postgres 17 + PostgREST, Clerk third-party auth, vitest 4, Playwright, `node:crypto` (scrypt, HMAC, SHA-256).

**Spec:** `docs/superpowers/specs/2026-11-09-owner-line-design.md` (owner-approved 2026-11-09; binding). §2 holds the non-negotiables and §9 the owner's decisions.

---

## Spec corrections (the code wins; each item cites file:line evidence)

Paths below are short: `WEB` = `apps/web/src`, `ACCT` = `WEB/app/(dashboard)/dashboard/accounts/[accountId]`, `MIG` = `packages/db/supabase/migrations`, `DB` = `packages/db/src`.

- **SC-1. The switch cannot live on Settings, because Settings is agency-only.** `ACCT/settings/page.tsx:78` runs `await requireAgencyOnlyAccountAccess(accountId)`, and `ACCT/settings/layout.tsx` is the agency-only English island. A client Owner never reaches it. **Path:** the switch is a card on **Team**: `ACCT/team/page.tsx:58` is `requireAccountOwner`, the BIS access log already lives on that page, and the page is about who can see the business's data. Owner ruling Q-A (below) lets the agency turn it OFF, never ON. The card shows who last changed it and when.
- **SC-2. Role scope lives only in RLS, never in the readers, so the spec's fallback cannot "reuse" a role filter.** Evidence:
  - `DB/booking.ts:1188-1190`, on `listAgendaBookings`: "On the CALLER's client: RLS (0068) decides what a Technician sees".
  - `MIG/0068_mine_unassigned_technician.sql:113-119` puts restrictive policies on `calls`, `bookings` and `conversations`, and `:134-138` on `tasks`.
  - `listCalls` (`DB/voice.ts:1248`) and `listAccountWork` (`DB/work-queue.ts:177`) carry no role filter.

  For Owner and Staff, `app.sees_all_customers` is true (0068:75-78), and no other restrictive policy touches those four tables (the restrictive-policy inventory in `MIG/*.sql`). So an account-scoped service-role read equals what an Owner or Staff member sees, and only a Technician's scope would need re-implementing. **Path:** the spike's decision point offers three options:
  - **T:** a minted token, so RLS applies (the preferred path).
  - **F2:** service reads for Owner and Staff, with Technicians not offered the owner line until T exists.
  - **F1:** F2 plus a Technician code filter that mirrors `app.my_contact_ids()`, pinned by a parity test.

  The choice lives in ONE module (`lib/owner-line/reader.ts`).
- **SC-3. The PIN check is SECURITY INVOKER, not DEFINER.** `MIG/0104_calendar_feeds.sql:22-28` gives the reason: "only service_role may execute them, and it already holds what they touch … so a definer would add privilege and nothing else (0057's reasoning)". 0105:20-24 says the same. `EXPECTED_DEFINERS` (`DB/test/definer-search-path.test.ts:33`) does not change. The search-path pin still covers every new function: that file says "Scope is every function that SETS a search_path" (lines 12-15), and the new schema test asserts `prosecdef = false` with `search_path=pg_catalog, pg_temp`.
- **SC-4. The enrollment table is server-only, with no client grant and no client RLS read.** `MIG/0104_calendar_feeds.sql:19-20` sets the pattern: "Server code only (0053's pattern): RLS on with no policy, every client privilege revoked. The card reads its own person's row through serviceDb()". A client write grant would let a person set their own `verified_at`, `failed_attempts` or `locked_until`, which §3.2 and §4.2 forbid, and §3.4 already requires that `pin_hash` is never readable. "A person reads and writes only their own enrollment" is enforced by the server actions, which key on Clerk's `userId` (the `WEB/app/(dashboard)/dashboard/preferences/actions.ts:13-18` pattern).
- **SC-5. §3.4 stores nothing for the call-in code that §3.2 requires.** §3.2 needs a code, a 10-minute expiry and three attempts, and §3.4 lists no column for any of them. **Path:** add `verify_code_hash`, `verify_expires_at` and `verify_attempts`, plus the `id`, `account_id` and `user_id` columns.
- **SC-6. Neither argon2 nor bcrypt is in the dependency tree.** See the `dependencies` of `apps/web/package.json:17-38` and `packages/db/package.json`. Node's argon2 (`crypto.argon2`) is experimental and needs Node 24.7 or later; `package.json` engines only require 22 or later. **Path:** `node:crypto` scrypt with N=2^17, r=8, p=1 (OWASP's floor; 128 x N x r = 128 MiB, so `maxmem` is 256 MiB), a 16-byte salt and a 32-byte key. scrypt is memory-hard and built in, so no native dependency is added. Its password is HMAC-SHA256(PIN), keyed by `sha256("bis-owner-line-pin:" + OWNER_LINE_PIN_PEPPER)`: a pepper in its own key domain that lives only in the server's env, so a database-only leak cannot be cracked offline (Task 3). The stored string's prefix `scrypt:17:8:1:` is built from N, r and p, never a separate literal. **The comparison stays in SQL:** Node derives the candidate with the stored salt, and `owner_line_attempt_pin` compares under a row lock and owns the counter and the lock. This is the same Node-hashes, SQL-checks split as `MIG/0036_alert_phone_verifications.sql:153` ("SQL never computes it"). pgcrypto would add a dependency no migration has yet.
- **SC-7. The pass cannot bind a Telnyx "call control id".** The OpenAI webhook never sees that id. The one identifier both legs share is the handoff token:
  - it is minted at `WEB/app/api/voice/texml/route.ts:502`;
  - it rides the SIP URI as `X-BIS-Handoff` (`:521`);
  - it is covered by `X-BIS-Signature`'s MAC (`WEB/lib/voice/sip-handoff-signature.ts:58-59,81`).

  **Path:** the pass's MAC covers the handoff token. Single use is enforced by the owner-line `calls` row insert, which `calls_handoff_token_unique` (`MIG/0037_call_handoff.sql:176-178`) refuses a second time. (Spec §4.3 amended to match, 2026-11-09.)
- **SC-8. The role must be in the pass, and the live role must EQUAL it.** §4.3's HMAC payload carries no role. §7 requires refusal when "their role was downgraded after minting", while §4.3's "the same role or one inside it" would ACCEPT a downgrade. **Path:** the pass carries the role at mint time, and the webhook and every tool call require the live role to equal it. (Spec §4.3 amended to match, 2026-11-09.)
- **SC-9. Today's customer caps would refuse the owner's 6th call of the day.** Three facts combine:
  - `countCallsByCallerSince` (`DB/voice.ts:1010`) counts every call from the cell;
  - `PHONE_MAX_CALLS_PER_NUMBER_PER_DAY` defaults to 5 (`WEB/lib/voice/call-limits.ts:13`);
  - the TeXML route applies that cap (`route.ts:378-388`) before any owner-line branch could run.

  The per-account cap of 50 (same lines) has the same problem. That contradicts §4.4's 10. **Path (owner ruling Q-C):**
  - owner-line rows are excluded from `countCallsSince` and `countCallsByCallerSince`;
  - a `verify` or `pin` hit skips the customer refusals (repeat-spam, both caps) at the answer route, so the owner branch is never refused by them;
  - the webhook's owner branch runs before step 8's caps;
  - the owner-line limit (10 per person, per business, per ACCOUNT-LOCAL day: ruling Q-F) is the only bound.

  Pound or a timeout takes today's path, which re-runs every customer check.
- **SC-10. Bookings have no service field.** `AGENDA_COLS` (`DB/booking.ts:1172-1174`) and `BookingStatus` (`DB/booking.ts:24`) show none. **Path:** `appointments` returns the time, the customer's name, the meeting type and the status. It never returns `note`.
- **SC-11. `calls_and_messages` returns calls only.** §5's table lists call fields only. "Messages" means the calls in which the caller left one, which the needs-callback flag and the reason line carry. Texts are out of PR 1.
- **SC-12. The 60-second freshness applies at redemption only.** It cannot apply to a tool call minutes into the call. **Path:** §5's "each tool re-validates the pass" is the live re-check on every tool call: membership, same role, switch on, enrollment not locked.
- **SC-13. Today the access log only records agency visits.** `MIG/0105_access_log.sql:49-56`: `actor_kind in ('agency')`, and reasons are setup, support, fix or billing. Service_role may insert only named columns, and `actor_kind` is not among them (0105:102). **Path:** the `owner_line_call` entry is:
  - one visit row with `actor_kind 'owner_line'`, `reason 'owner_line_call'` and `clerk_session_id 'call:<calls.id>'`;
  - one item per tool that ran (four new item kinds, `record_id` = the call).

  `access_log_page` gains `actor_kind = 'agency'`, so the BIS access section is byte-for-byte unchanged. The Owner sees "Asked about …" on the owner-line call's own page.
- **SC-14. Signed TeXML is live in production, so the owner line requires it.** `TELNYX_PUBLIC_KEY` has been set in production since 2026-09-29 (`docs/runbooks/voice-setup.md:715-716`), and `VOICE_HANDOFF_SECRET` with `VOICE_HANDOFF_ENFORCE=1` since 2026-10-08 (ledger `.superpowers/sdd/progress.md:13459`). The voice agent's standing brief still says the key is unset; the runbook wins. **Path:** the branch runs only on a Telnyx-signed request with a usable `VOICE_HANDOFF_SECRET`. Anything else gets today's path. **owner-pin holds the same line (Task 9 review m-3):** an unsigned request, or a signed one with no usable `VOICE_HANDOFF_SECRET`, checks nothing, counts no attempt and gets today's path, because no owner pass could be signed.
- **SC-15. The migration is 0115.** `origin/main` ends at `0112_record_changes_q1.sql` (`git ls-tree`). `0114_work_queue_actions.sql` is on `feat/f077-work-queue`. 0113 is on no branch yet: it is F-115 PR D, due 2026-11-11 (memory `bis-next-work`). The spec's "after 0114" holds.
- **SC-16. The press-1 screen still exists behind `VOICE_SCREEN_NUMBERS`** (`route.ts:39-44,748-772`). **Path:** the owner-line branch runs ahead of it, so an enrolled person is never asked to press 1. The customer path is unchanged.
- **SC-17. The owner-line branch is skipped in three states, because in each the Gather's fallthrough would not be today's path:**
  - `forward_calls` is on (`route.ts:814`);
  - billing has no voice (`noVoice`, `route.ts:783`);
  - the fallback drill is engaged (`route.ts:833`).

  This keeps "On a miss, follow today's path exactly" true, and keeps the PIN step's fallthrough identical to today's bridge.

- **SC-18. No TeXML route may reach `@bis/db` at module scope** (`route.ts:219-226`; Global Constraints). The lockout email module reaches it through `WEB/lib/consent/email-gate.ts:1-5` and `WEB/lib/email/templates/shell.ts:1`, so owner-pin imports it dynamically, and only inside `after()`: on `locked_now` it captures the lock instant (`at`) BEFORE calling `after()`, and the deferred callback imports the module and calls `sendOwnerLineLockoutEmails({ ..., at })` (Task 9 decision point, 2026-11-09). The module's chunk is about 613 KB with the catalogue, so none of it may load on Telnyx's answer deadline, and `scheduleOwnerLineLockoutEmails` no longer exists. Every helper the TeXML routes import statically (`owner-line-xml.ts`, `secrets.ts`, `data-path.ts`, `lib/owner-line/names.ts`) imports `@bis/db` for types only.
- **SC-19. Day boundaries.** `localMidnightInstant` (`WEB/lib/reports/weekly-window.ts:95-98`) is documented safe only where no clock change falls at midnight. Owner ruling Q-F needs every zone, so:
  - the 10-a-day limit computes the account's local day start in SQL (`app.owner_line_day_start`);
  - ranges use a bounded-correction `localDayStart` (Task 10).

  Both are tested on a spring-forward day, a fall-back day and a midnight-DST zone.

**The owner's rulings are binding: Q-A to Q-F, in "Owner rulings" at the end of this plan.** Q-A changes the default this plan first had (the agency may turn the switch OFF). Q-E and Q-F are new. Q-G is open.

## Assumptions not verified (each names the task that verifies it)

- **A-1.** Hosted Supabase PostgREST accepts a server-minted JWT beside Clerk's third-party issuer. Locally it does: `.github/scripts/ci-local-supabase.sh:21-34` hands PostgREST "those keys plus the stack's own secret as one JWKS". **Verified by Task 0.**
- **A-2.** bis-ci and production still hold a usable legacy JWT secret, or allow importing a signing key. **Task 0, as a read-only inventory by danlo.**
- **A-3.** Telnyx `<Gather>` documents `finishOnKey`, and what Telnyx sends for "#" with no digits is unknown. The existing screen's Gather uses only `action`, `numDigits` and `timeout`, and states "nothing undocumented goes in" (`route.ts:171-176`). **Task 7 Step 1** reads https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/gather (a documentation read, not a provider call). The documents handle all three outcomes: `Digits` "", `Digits` "#", and fall-through. If `finishOnKey` is not documented, the attribute is left out (Task 7 Step 1 says how).
  - **Read on 2026-11-09 (Task 7 Step 1).** `finishOnKey` IS documented, with default `#`.
  - **Not documented:** what a bare `#` sends, and whether a timeout posts to `action` or falls through to the next verb.
  - **The fall-through case is therefore live, and it is the one no route sees.** Telnyx runs the verbs after the Gather without asking us anything. Those verbs must be today's path for that caller: the refusal when the ask skipped one (Q-C), and the cleared, ticketed bridge only when every guard cleared (Task 7 review C-1; Step 5.6 as built).
- **A-4.** The Gather callback carries `To` and `From`. That is documented but has not been seen on a real call (`WEB/app/api/voice/texml/screen/route.ts:18-23`). owner-pin never acts without both. **O-5 (the real call).**
- **A-5.** DTMF keyed inside a Gather never reaches the SIP leg. This holds by construction, because `<Dial>` has not run yet. **O-5** checks the transcript holds no digits.
- **A-6.** OpenAI passes `?X-BIS-Owner-Pass=` into `sip_headers` exactly as it passes the three `X-BIS-*` values already proven (`sip-handoff-signature.ts:13-17`). **Task 12's log line, then O-5.**
- **A-7.** One extra indexed read run beside the existing batch adds less than 25 ms at p95 on Vercel to Supabase. **Task 0 measures it.**
- **A-8.** Node's scrypt at N=2^17 (128 MiB, `maxmem` 256 MiB) runs inside a Vercel function within the TeXML action's deadline. **Task 3 measures its time locally; O-5 proves it in production.**
- **A-9.** Telnyx's own call logs and debugging tools may keep the `Digits` a `<Gather>` collected. That is provider-side, outside this app's control, and is stated in the spec's §2.2. **Not verifiable from code.** danlo reads one call's detail record in the Telnyx portal during O-5 and records whether the digits appear.

## Global Constraints

The spec's requirements, copied verbatim where quoted. Every task's requirements include this section.

**The feature itself**
- "Customers never hear anything new. Only a call from a registered, verified cell on the dialed business, with the business's switch on, gets the PIN step."
- "The PIN is keyed, never spoken. The phone system collects the DTMF digits (TeXML `<Gather>`) before the call is bridged to OpenAI."
- "Authorisation lives in code, not in the prompt. Owner tools exist only on a session built from a valid signed pass." No security property rests on Sofía's instructions (memory: prompt-only limits).
- "Read-only. Nothing on this line books, cancels, texts, or changes a record."
- "Same visibility as the app. A person hears only what their role shows them in the app, for the dialed business only."
- The PIN is exactly 6 digits. 000000, 123456, a repeated digit and a run are refused with a reason. It is stored only as a slow salted hash, never shown again, and changeable or removable at any time.
- A pending code expires in 10 minutes, with three attempts.
- The switch is off by default. Only the client's Owner turns it ON; the agency may turn it OFF (Q-A). Every change records who and when, and no account can be created with it on.
- "Per day" and "today" mean the ACCOUNT's local day, everywhere (Q-F).
- The PIN hash is scrypt over an HMAC of the PIN keyed by `OWNER_LINE_PIN_PEPPER` (a new Sensitive env var, at least 32 characters), so a database-only leak cannot be cracked offline.
- `<Gather numDigits="6" timeout="8" finishOnKey="#">`, with its action at `/api/voice/texml/owner-pin` (but see A-3).
- Wrong PIN 3 times sets `locked_until = now() + 30 min`, emails the person and the account's Owner, and the call continues as a normal customer call. The counter is per enrollment, so a redial does not reset it.
- The pass is valid for 60 seconds from issue and is single use.
- Each call ends at 10 minutes, with a spoken 1-minute warning. Each person gets 10 owner-line calls per business per day, and the 11th goes to the normal path after a short line.
- A range is today, yesterday, tomorrow, this week, or named dates, always in the account's zone, and at most 31 days.
- An owner-line call is excluded from "calls answered", conversion, the dashboard tiles, the weekly report (client and agency roll-up), the AI-presence count, and billing as an answered call. Its minutes appear in usage.
- An owner-line call writes no customer timeline row. The access log is the record of who heard what.

**Repo rules**
- Tokens only (DESIGN.md), and status is dot plus word (rule 3).
- Spanish uses *usted*, and Owner is "Dueño" (`WEB/lib/messages.ts:5372`).
- A name shown to a customer is `brandDisplayName`, never `accounts.name`.
- Server actions take `locale` right after `accountId`. Pages `.bind()` actions; they never pass an arrow function from a server component to a client one.
- Every new route or guarded action is classified in `ACCT/access-log-routes.test.ts`.
- Before any push, run the i18n gates (`WEB/lib/i18n/*.test.ts`, `WEB/lib/messages.test.ts`) and the consent scans (`WEB/lib/consent/scans.test.ts`).
- `@bis/db` is imported lazily inside the TeXML route handlers (`route.ts:219-226`). Module-scope imports break `next build`.

**Migration rules**
- Only the orchestrator applies a migration. The order is bis-ci (`ci-project-setup.yml`: push-dry-run, then push), then production (MCP `apply_migration`, once), then the parity check.
- No bare `LOCK` outside a `do` block: locks and `lock_timeout` go inside a `do` block, followed by the 0088-style self-check.
- The migration text is ASCII only, with no backslash, and every dollar sign in it belongs to a dollar-quote pair.

**Running tests and gates**
- No `@bis/db` vitest runs against bis-ci until 0115 is there. Locally, those tests run only against the PG18 replica (memory `bis-local-db-replica`, with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` unset in that shell). CI `verify` is the authoritative green.
- Agents never place calls, call providers, edit `.env*`, or run `pnpm check`, `build` or `test:e2e`.

## Tasks, tiers and sizes

Tiers follow the binding speed rule (memory `bis-speed-process`): HIGH gets a full review with mutation probes, MEDIUM one review, and LOW no per-task review (only the end-of-PR review).

| # | Task | Tier | Size | Depends on |
|---|---|---|---|---|
| 0 | Spike: a minted token beside Clerk's issuer; lookup latency; DECISION POINT | HIGH | 2–3 days | none |
| 1 | Migration 0115 and its schema, grants and RLS tests | HIGH | 1.25 days | none to draft; 0113 for the final SQL |
| 2 | DB wrappers, counting exclusions, `startCallRow` and `listCalls` | HIGH | 0.75 day | 1 |
| 3 | PIN and code primitives (scrypt, trivial refusals, code hash) | HIGH | 0.25 day | none |
| 4 | Signed owner pass and header extraction | HIGH | 0.5 day | none |
| 5 | Setup actions: enrol and verify the cell, set or remove the PIN, the Team switch | HIGH | 0.75 day | 2, 3 |
| 6 | Setup card on Mis preferencias, switch card on Team, copy, ⌘K words | LOW | 0.75 day | 5 |
| 7 | Answer-route branch and the `<Gather>` | HIGH | 0.75 day | 2, 4 |
| 8 | Lockout email | MEDIUM | 0.25 day | 2 |
| 9 | `owner-pin` route: verify, PIN, lockout | HIGH | 1 day | 3, 7, 8 |
| 10 | Range resolver and the ONE reader factory | HIGH | 0.5 day | 0 decision |
| 11 | The three owner tools (schemas and registry) | HIGH | 1 day | 10 |
| 12 | Owner-line session: prompt, config, webhook branch, lifecycle hooks, finish | HIGH | 1.5 days | 4, 11 |
| 13 | Calls list label and "Asked about" on the call page | LOW | 0.5 day | 2, 12 |
| 14 | No-guessing corpus, code-graded, repeat=3 | MEDIUM | 0.5 day (plus a run) | 11, 12 |
| 15 | e2e: the setup card | LOW | 0.5 day | 6 |
| 16 | Plan docs (`crm-features.md`) and a runbook proposal | LOW | 0.25 day | none |
| 17 | PR 2: `lookup_customer`, with privacy tests | HIGH | 1 day | PR 1 merged |

PR 1 is Tasks 1–16, about 10.75 days of agent work; PR 2 is Task 17, about 1 day. With the 2–3-day spike, that is 13.75–14.75 days in all. The spec's estimate is 5–6 ew.

## Orchestrator checklist (not agent tasks)

- **O-1. Decision point after Task 0.** Bring the spike's decision record (its T / F2 / F1 table) to the owner as choice tiles, with the recommended option first. **What waits on it:** only Task 10 and everything after it, plus Task 5's one-line `OWNER_LINE_DATA_PATH` value.
  - **Runs beside the spike:** Tasks 3 and 4, which have no dependencies, and Task 1's draft, which is replica-tested against 0112 plus 0114 taken from `feat/f077-work-queue` with `git show`.
  - **Waits for 0113:** Task 1's final SQL (O-2).
  - **May proceed before O-1:** Tasks 2, 5–9, with `OWNER_LINE_DATA_PATH = "token"`, flipped in one line if the owner picks F2.
- **O-2. Holds.** Merge `origin/main` into the branch after 0113 (F-115 PR D) and 0114 (#343) are merged, and re-read the files Task 1 Step 1 names before Task 1's SQL is final. Applying 0115 follows the migration rules above, only after 0113 and 0114 are on production. The PR's `e2e` job fails until 0115 is in bis-ci's history (`.github/scripts/ci-migrations-applied.sh`).
- **O-3. Env (danlo, Vercel Production only), under decision T.** Add `SUPABASE_JWT_SECRET`, or the imported signing key the spike names, as **Sensitive**. Never add it to Preview (`docs/runbooks/production-isolation.md`). It is as powerful as the service-role key already there. Under F2, nothing new is added. **Under every decision:** `OWNER_LINE_PIN_PEPPER` (Sensitive, at least 32 random characters), with three DIFFERENT values:
  - one in Production;
  - one in Preview;
  - a fixed non-secret test value in the CI `e2e` job's env (a `ci.yml` edit, HIGH tier, landed by the orchestrator).

  **Rotating it invalidates every stored PIN:** each person sets a new one, and the card says so (the PIN no longer matches, so it reads as wrong until it is reset). Rollback: none needed, since removing the value makes every PIN attempt take today's path (Task 9). Set it before the first PIN is saved.
- **O-4. Corpus.** Run Task 14's script with `--repeat 3` from danlo's shell (`OPENAI_API_KEY` from the shell only). A person reviews the transcripts, and the code grader's verdict must be 3/3 per item.
- **O-5. The real call (danlo; runbook Step 6 is the exit gate).** Before any client's switch is on, call the BIS account's live number from danlo's verified cell:
  1. Enter the right PIN and ask the four questions (three in PR 1).
  2. Enter a wrong PIN three times on a second call.
  3. Press pound on a third call.

  Check the Vercel log lines `texml owner line asking for a PIN`, `owner pass checked` and `owner line accepted`, and confirm the transcript holds no digits.
- **O-6.** Update the roadmap tracker row for F-032 (memory `bis-roadmap-tracker`) to match Task 16.

## File map

Create:
- `docs/superpowers/specs/2026-11-09-owner-line-spike.md`: the spike's decision record (Task 0).
- `packages/db/supabase/migrations/0115_owner_line.sql` (Task 1).
- `packages/db/src/test/owner-line-schema.test.ts` (Task 1). Replica-run and CI-verified.
- `packages/db/src/owner-line.ts`: the typed wrappers (Task 2).
- `packages/db/src/test/owner-line-counting.test.ts` (Task 2). CI only, because it uses `withTestAccount`.
- `apps/web/src/lib/owner-line/secrets.ts` and `secrets.test.ts` (Task 3).
- `apps/web/src/lib/owner-line/memberships.ts`, `apps/web/src/app/(dashboard)/dashboard/preferences/owner-line-actions.ts` and `.test.ts` (Task 5).
- `ACCT/team/owner-line-actions.ts` and `.test.ts` (Task 5).
- `apps/web/src/components/owner-line/owner-line-card.tsx` and `owner-line-switch-card.tsx`, with `owner-line-view.ts` and `.test.ts` (Task 6).
- `apps/web/src/app/api/voice/texml/owner-line-xml.ts` and `.test.ts` (Task 7). A colocated helper like `./xml.ts`, not a route.
- `apps/web/src/lib/owner-line/lockout.ts` and `.test.ts`, `apps/web/src/lib/email/templates/owner-line.ts` and `.test.ts` (Task 8).
- `apps/web/src/app/api/voice/texml/owner-pin/route.ts` and `route.test.ts` (Task 9).
- `apps/web/src/lib/owner-line/range.ts` and `.test.ts`, `token.ts`, `session.ts`, `reader.ts` and `reader.test.ts` (Task 10).
- `apps/web/src/lib/owner-line/data-path.ts`: THE one module holding the Task 0 decision (Task 5). Only `reader.ts` branches on it.
- `apps/web/src/lib/owner-line/tools/schemas.ts`, `read.ts`, `registry.ts`, and their tests (Task 11).
- `apps/web/src/lib/owner-line/prompt.ts`, `session-config.ts`, `events.ts`, `finish.ts`, and their tests (Task 12). Task 12 also extends `session.ts`.
- `apps/web/scripts/owner-line-corpus.ts`, `apps/web/src/lib/owner-line/corpus/*.json` and `grade.ts` with `grade.test.ts` (Task 14).
- `apps/web/e2e/owner-line-setup.spec.ts` (Task 15).

Modify:
- `packages/db/src/voice.ts`, `packages/db/src/index.ts`, `packages/db/src/account-teardown.ts` (Task 2).
- `ACCT/dashboard/page.tsx:171` (Task 2).
- `apps/web/src/lib/voice/sip-handoff-signature.ts`, `sip-headers.ts` and their tests (Task 4).
- `apps/web/src/app/api/voice/texml/route.ts` and `route.test.ts` (Task 7).
- `apps/web/src/app/api/voice/incoming/route.ts` and `route.test.ts` (Task 12).
- `apps/web/src/lib/messages.ts`, adding the `ownerLine.*` namespace only (Tasks 5–8, 11–13).
- `apps/web/src/lib/consent/classes.ts` (Task 8).
- `apps/web/src/app/api/voice/texml/wellformed.test.ts` (Task 7).
- `apps/web/.gitignore` (Task 14).
- `apps/web/src/lib/palette/registry.ts` (Task 6).
- The preferences page and the team page (Task 6).
- The calls list and call page (Task 13).
- `ACCT/access-log-routes.test.ts` (Task 5).
- `docs/crm-features.md` (Task 16).

---

## Task 0: SPIKE. Can a server-minted short-lived token read PostgREST as a person under RLS, beside Clerk's issuer? (HIGH, 2–3 days, time-boxed)

**Runs on:** the local CLI stack or PG18 replica, and the CI project `bis-ci` (`odnobiodsftffphuuosz`). **NEVER production** (`tlbkbmlrfafquucsmsmm`), not even read-only, except the dashboard inventory in Step 2, which is names and statuses only.

**Files:**
- Create: `docs/superpowers/specs/2026-11-09-owner-line-spike.md` (the decision record, committed).
- Scratch only, never committed: `<scratchpad>/owner-line-spike/probe.ts` and `latency.ts`.

**Interfaces:**
- Consumes: `userDb(accessToken)` (`packages/db/src/user-client.ts:17`), `serviceDb()` (`packages/db/src/service.ts:4`), `listCalls`, `listAgendaBookings`, `listAccountWork`, and `app.jwt()` (0001:4-7), which reads `sub`, `org_id` and `app_role`.
- Produces: a decision, recorded as `OWNER_LINE_DATA_PATH = "token" | "service"` and its role list, which Task 10 writes into `reader.ts`. Under T it also produces the token's exact shape (algorithm, claims, key env var name).

- [ ] **Step 1: Read the code that decides the answer (no edits).**
  - `packages/db/src/user-client.ts:1-33` and `service.ts:1-9`.
  - `apps/web/src/lib/db.ts:21-26`: the request client is `userDb(Clerk getToken())`.
  - `MIG/0001_tenancy.sql:4-12` (`app.jwt`, `app.is_agency`), `0008_client_access.sql:13-18` (`app.current_account_id` needs `client_access_enabled`), `0066_staff_and_roles.sql:52-61` (`app.account_role` by `sub`), and `0068_mine_unassigned_technician.sql:65-79,103-138`.
  - `.github/scripts/ci-local-supabase.sh:15-34`: the local stack's PostgREST JWKS holds the stack's `oct` secret AND Clerk's RSA keys.
  - `packages/db/src/test/ai-acts-schema.test.ts:844-881,1102-1107`: an HS256 token the repo already mints for the replica (`BIS_REPLICA_JWT_SECRET`).
  - `docs/runbooks/production-isolation.md:755-770`: legacy `eyJ…` keys versus `sb_secret_` keys.

  Write down the claims RLS needs: `role: "authenticated"`, `sub` (the Clerk user id), `org_id` (the Clerk org id), and never `app_role`.

- [ ] **Step 2: Inventory (danlo, read-only, about 5 minutes per project; write the answers into the decision record).**
  - In the bis-ci dashboard, go to Settings → JWT Keys. Is a "Legacy JWT secret" listed and *in use*, or has the project moved to signing keys (ES256/RSA)? Does "Import key" exist?
  - Go to Authentication → Third-Party Auth: which Clerk domain is listed?
  - Repeat the same three reads for production: **names and statuses only, never a value.**

  The agent drafts the questions. danlo pastes back the answers.

- [ ] **Step 3: Local proof that a minted token reads under RLS beside Clerk.** Write a vitest file **in the scratchpad**, not the repo, modelled on `ai-acts-schema.test.ts:845-881`. Run it on the replica kit (`BIS_REPLICA_JWT_SECRET`) or a local CLI stack. It seeds:
  - two accounts, A and B, with `client_access_enabled`;
  - A's Owner, Staff and Technician, plus B's Owner;
  - in A and in B, a contact assigned to A's Technician, a contact assigned to nobody, a call on each, a booking on each, and a task on each.

  It then mints an HS256 token per person, `{ role: "authenticated", aud: "authenticated", sub, org_id, iat, exp: iat + 120 }`, and asserts through `userDb(token)`:
  - (a) the Owner's `listCalls`, `listAgendaBookings` and `listAccountWork` return A's rows only, with zero from B;
  - (b) the Technician sees only the assigned contact's call, booking and task;
  - (c) a token whose `exp` is in the past is refused (PostgREST 401 / `PGRST301` or `PGRST303`);
  - (d) a token signed with a different secret is refused;
  - (e) a token carrying `org_id` of B and `sub` of A's Owner reads nothing from A.

  Paste vitest's summary line.

- [ ] **Step 4: Hosted proof on bis-ci (danlo runs it; the agent writes it).** Write `probe.ts`, which reads only `process.env`. It creates one throwaway account on bis-ci through `serviceDb()` with the Step 3 seed, runs (a)–(e) through `userDb(minted)` against bis-ci's REST URL, and deletes the account in a `finally` with `deleteAccountCascade(db, id, "owner-line-spike")`. The signing key is typed into danlo's shell for that one run (`SPIKE_JWT_SIGNING_KEY`), never written to a file, and never printed: the script prints only `PASS a` … `FAIL e` lines. **Its first two lines** (and `latency.ts`'s) are the production guard, before any client exists:

  ```ts
  import { refuseProduction } from "../../e2e/fixtures/production-guard";   // path from the script's own location
  refuseProduction(process.env, "owner-line spike");
  ```

  Run it with:

  ```bash
  node --env-file=apps/web/.env.local --import tsx <scratchpad>/owner-line-spike/probe.ts
  ```

  If Step 2 showed the legacy secret is revoked, run the ES256 variant: sign with a key pair danlo generated and **imported as a standby key** on bis-ci only. Record which variant passed.

- [ ] **Step 5: Measure the answer route's added latency.**
  - Write `latency.ts` against bis-ci. Run 50 iterations of `Promise.all` over today's four reads (`countCallsSince`, `countCallsByCallerSince`, `countCallerHistorySince`, `countForwardedCallsSince`, the shape at `route.ts:337-348`), then 50 iterations of the same plus one `calls_caller_idx`-served select standing in for `owner_line_answer_lookup` (also one unique-index lookup).
  - Report p50 and p95 of each, and the difference.
  - The route's own baseline: no agent reads production's runtime logs (they carry callers' numbers).
    - Take it from **Preview**, with Vercel MCP `get_runtime_logs` scoped to the Preview environment, if a Preview deployment has served `/api/voice/texml`.
    - Otherwise danlo opens production's logs and copies ONLY the duration column of the last 20 `/api/voice/texml` requests into the record, never a row.

  **Budget:** the added p95 is at most 25 ms, with a hard ceiling of 50 ms. Because the lookup runs beside the batch (Task 7), its cost is `max()`, not `+`. Above 50 ms, the plan changes to starting the lookup before the profile read.

- [ ] **Step 6: Write the decision record** at `docs/superpowers/specs/2026-11-09-owner-line-spike.md`, with these sections in this order:
  1. The question, verbatim.
  2. The inventory answers from Step 2.
  3. Step 3's summary line.
  4. Step 4's PASS/FAIL lines.
  5. The latency table and the verdict against the budget.
  6. **The options table**, filled from Steps 2–5, with one row each:

     | Option | Who gets the line | Secret added to Vercel Production | Production's legacy JWT secret | Ongoing cost | Rollback |
     |---|---|---|---|---|---|
     | **T** (minted token, RLS decides) | Owner, Staff, Technician | `SUPABASE_JWT_SECRET`, or an imported private key. **As powerful as the service-role key**: it can mint any identity, the agency included, so it gets the service-role key's handling (Sensitive, Production only, rotation in `production-isolation.md`). | Must stay enabled, or be re-enabled, unless an imported asymmetric key is used. `production-isolation.md:765-768` advised disabling legacy keys, so the record says which path keeps that advice. | none beyond the secret | remove the env var; every tool answers "I couldn't read that"; turn the switches off |
     | **F2** (service reads, Owner and Staff) | Owner, Staff | none | untouched | none | n/a; flip `OWNER_LINE_DATA_PATH` |
     | **F1** (F2 plus a Technician code filter) | Owner, Staff, Technician | none | untouched | every future change to `app.my_contact_ids()` (0068:80-88) or to a Technician policy must be mirrored in code. A parity test (the code filter's contact set equals `app.my_contact_ids()` under the same claims) fails on drift, but someone must then fix it | drop the filter; becomes F2 |

  7. **Recommendation, in one sentence first,** by a rule that can select any of the three:
     - **T** if Step 4 passed (a)–(e) on bis-ci AND production can sign without re-enabling a legacy key the isolation runbook disabled (an imported key is fine);
     - else **F1** if the owner wants Technicians on the line now and accepts the parity test's upkeep;
     - else **F2**.
  8. Under T: the exact token shape, the env var name for Vercel Production (`SUPABASE_JWT_SECRET`, or `OWNER_LINE_JWT_PRIVATE_KEY` for ES256), the TTL (120 s), and the rule that `app_role` is never set.
  9. The open owner question Q-G (if still open at O-1).

- [ ] **Step 7: Commit the record only.**

  ```bash
  git add docs/superpowers/specs/2026-11-09-owner-line-spike.md
  git commit -m "docs(voice): F-032 owner line spike: minted-token RLS reads and lookup latency, with a recommendation" -- docs/superpowers/specs/2026-11-09-owner-line-spike.md
  ```

**DECISION POINT (O-1).** Stop here. The orchestrator brings the record to the owner. No task below starts until the owner has answered.

**Mutation probe for this task:** in Step 3, flip the Technician's assignment to nobody. Case (b) must then report zero rows, and it must FAIL if it still sees the call. That proves the probe reads RLS rather than a filter of its own.

---

## Task 1: Migration 0115 and its schema, grants and RLS tests (HIGH, 1 day)

**Files:**
- Create: `packages/db/supabase/migrations/0115_owner_line.sql`
- Create: `packages/db/src/test/owner-line-schema.test.ts`

**Interfaces:**
- Consumes: `memberships (account_id, user_id)` unique key (0066, used by `MIG/0104_calendar_feeds.sql:72-73`). 0112's `access_log_page` body (`MIG/0112_record_changes_q1.sql:1028-1075`) and kind CHECK (`:1024-1027`).
- Produces, for Task 2 and the routes:
  - Table `public.owner_line_enrollments`, with columns `id, account_id, user_id, e164, verified_at, verify_code_hash, verify_expires_at, verify_attempts, pin_hash, pin_set_at, failed_attempts, locked_until, created_at`.
  - On `public.accounts`: `owner_line_enabled_at timestamptz`, `owner_line_changed_at timestamptz` and `owner_line_changed_by_kind text` (`'owner'` | `'agency'`). These are Q-A's record: WHEN the switch last changed and WHAT KIND of person changed it, never WHO (owner ruling 2026-11-09, "Say BIS, keep names private": every member reads `accounts`). `accounts_owner_line_change_check` pairs the two record columns; `accounts_owner_line_agency_off_check` holds BIS's last change to off (Q-A in the database). `accounts_owner_line_insert_guard` refuses an INSERT carrying any of the three columns; `accounts_owner_line_switch_record` refuses an UPDATE that moves the switch without a fresh, non-null `owner_line_changed_at` (review m-2). Which BIS person turned it off is BIS's own record, a null-account `events` row (Task 5).
  - On `public.calls`: `owner_line_user_id uuid`.
  - The functions (no day-start argument: the ACCOUNT's local day is computed inside, Q-F):
    - `app.owner_line_day_start(text, timestamptz) → timestamptz`
    - `owner_line_answer_lookup(uuid, text, integer) → jsonb`
    - `owner_line_start_verification(uuid, uuid, text, text, integer) → text`: `ok`, `taken` or `too_many` (Task 5 review I-2). Only a VERIFIED cell or a LIVE code holds a cell: a new claim displaces a lapsed or spent unverified claim on the same business, whose person is left with no cell, no code and no PIN (`e164` is nullable for exactly that, `owner_line_enrollments_no_cell_check`). At most five starts per person per business in any rolling 24 hours (`verify_window_started_at`, `verify_starts`): each start keeps a number in the call-in prompt for at most ten minutes, so a day bound caps that at 50 minutes a day where an hour bound would allow most of the day. A row whose cell goes is CLEARED, never deleted, so its count survives.
    - `owner_line_attempt_verify(uuid, text, text) → text`
    - `owner_line_attempt_pin(uuid, text, integer) → jsonb`
    - `owner_line_session_check(uuid, uuid, text, integer) → jsonb`
    - `note_owner_line_call(uuid, uuid, text, text, text[]) → uuid`
    - `app.owner_line_insert_guard() → trigger`
    - `app.owner_line_switch_record_guard() → trigger` (review m-2)
    - `note_agency_open` is re-created with an `owner_line_` refusal (review m-3), 0105's body otherwise unchanged.
  - The item kinds `owner_line_calls_and_messages`, `owner_line_appointments`, `owner_line_needs_attention` and `owner_line_lookup_customer`.

- [ ] **Step 1: Re-read the moving parts (O-2).** After 0113 and 0114 are merged into this branch, run:

  ```bash
  git ls-tree --name-only HEAD packages/db/supabase/migrations/ | tail -4
  grep -n "agency_visit_items_kind_check\|agency_visits_\(actor_kind\|reason\)_check\|function public.access_log_page\|on public.agency_visits\|on public.agency_visit_items\|on public.accounts\|lock table" packages/db/supabase/migrations/011[3-4]*.sql
  ```

  - If either file replaced the kind CHECK, an `agency_visits` constraint or grant, or `access_log_page`, copy THAT file's text below instead of 0112's, and say so in the report.
  - If either takes a lock on a table this file locks, keep this file's order consistent with it.
  - If the highest number is not 0114, renumber this file to the next free number.

  **Until 0113 exists, draft and replica-test against 0112 plus 0114 taken from its branch** (`git show feat/f077-work-queue:packages/db/supabase/migrations/0114_work_queue_actions.sql`). Never check that branch out.

  **Grants to verify before choosing the insert guard** (minor: an agency could create an account with the switch already on). `packages/db/src/test/schema-grants-guard.test.ts:66-69` pins `authenticated` with a TABLE-level INSERT on `accounts` (`insertDeleteAndUpdate`, so INSERT and DELETE whole-table, UPDATE by column). That test runs against a stack built from the same migrations bis-ci holds (parity), so it is the evidence. A column revoke would have to restate the whole INSERT surface and change that pin. A trigger that refuses a non-null `owner_line_enabled_at` on INSERT, for every role, is smaller and also covers service_role's `createAccount`, which never sets it. The orchestrator may confirm on bis-ci, read-only:

  ```sql
  select has_table_privilege('authenticated', 'public.accounts', 'INSERT');
  ```

- [ ] **Step 2: Write the failing schema test.** Model it on `packages/db/src/test/calendar-feeds-schema.test.ts` (the `withRollback`, `actAsMember` and privilege-matrix shapes, which were read from `./db`).

**The block below is the committed file as of the Task 2 review fix round (64 cases: the two m-B cases joined after `21fc2433`, the Task 2 review's teardown pin, and the Task 5 review's nine I-2 cases), copied whole so the plan cannot drift from it; the file is authoritative.** Beyond the first draft it holds the review round's cases: I-1, one second-business case per account-scoped read (the lookup, its count, `attempt_verify`, `session_check` and its count; same cell or same person at business B); I-2, one case per refusal branch, asserting the reason by name (`no_client_access`, `switch_off`, `not_enrolled`, `locked`, `over_limit`, and the lookup's client-access gate and no-PIN branch); m-2, the switch-record trigger; m-3, `note_agency_open`'s refusal; and the 2026-11-09 ruling's kind-only record. ONE refused statement per `withRollback` throughout (25P02).

```ts
// packages/db/src/test/owner-line-schema.test.ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { randomBytes, randomInt } from "node:crypto";
import { withRollback, actAsMember } from "./db";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0115 (F-032 owner line). Spec docs/superpowers/specs/2026-11-09-owner-line-design.md sections 3.4, 4 and 6;
 * plan docs/superpowers/plans/2026-11-09-owner-line.md Task 1 (SC-3, SC-4, SC-5, SC-13; owner rulings Q-A, Q-F).
 * Every case runs in withRollback: the table owner seeds, `set local role service_role` stands for the server (the
 * functions' only grantee, so each case proves service_role runs them on its OWN grants), actAsMember for a signed-in
 * person. RED BEFORE APPLY: every case (42P01 on the table, 42883 on the functions, 42703 on the new columns).
 * GREEN AFTER APPLY: all of them. Run on the PG18 replica pre/post (memory bis-local-db-replica); CI verify is the
 * authoritative green.
 */
const TABLE = "public.owner_line_enrollments";
const FUNCTIONS = [
  "app.owner_line_day_start(text,timestamp with time zone)",
  "public.note_owner_line_call(uuid,uuid,text,text,text[])",
  "public.owner_line_answer_lookup(uuid,text,integer)",
  "public.owner_line_attempt_pin(uuid,text,integer)",
  "public.owner_line_attempt_verify(uuid,text,text)",
  "public.owner_line_session_check(uuid,uuid,text,integer)",
  "public.owner_line_start_verification(uuid,uuid,text,text,integer)",
].sort();
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"] as const;
const RUN = randomBytes(4).toString("hex");
const hex64 = () => randomBytes(32).toString("hex");
/** A pin_hash of the shape 0115's CHECK accepts: "scrypt:17:8:1:" + 22 + ":" + 43 = 80 characters. */
const pinHash = (salt = "A".repeat(22), key = "B".repeat(43)) => `scrypt:17:8:1:${salt}:${key}`;
/** phone_numbers.e164 is unique across every account (0019), so each case dials its own business number. */
const businessNumber = () => `+1956${randomInt(1_000_000, 9_999_999)}`;

type Seed = { a: string; b: string; aOrg: string; owner: string; staff: string; tech: string; bOwner: string };

async function seed(c: Client): Promise<Seed> {
  const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('OL schema') returning id");
  const acct = async (tag: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1, $2, $3, true) returning id",
    [ag!.id, `org_ol_${tag}_${RUN}`, `OL ${tag}`])).rows[0]!.id;
  const a = await acct("a");
  const b = await acct("b");
  const person = async (tag: string, account: string, role: string, name: string | null = null) => {
    const { rows: [u] } = await c.query<{ id: string }>(
      "insert into users (clerk_user_id, email, name) values ($1, $1 || '@example.com', $2) returning id",
      [`user_ol_${tag}_${RUN}`, name]);
    await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, $3)", [u!.id, account, role]);
    return u!.id;
  };
  return {
    a, b, aOrg: `org_ol_a_${RUN}`,
    owner: await person("owner", a, "owner", "Dan Lopez"),
    staff: await person("staff", a, "staff"),
    tech: await person("tech", a, "technician"),
    bOwner: await person("b", b, "owner"),
  };
}

/**
 * Turn the business's switch on or off the way the app must (0115's record trigger): the switch, a NEW change time
 * and the who-kind, in one statement. clock_timestamp(), not now(): now() is fixed for the whole transaction, so a
 * second change inside one withRollback would carry the same time and read as a stale record.
 */
async function switchTo(c: Client, account: string, on: boolean, kind: "owner" | "agency" = "owner") {
  await c.query(
    `update accounts set owner_line_enabled_at = case when $2 then clock_timestamp() end,
            owner_line_changed_at = clock_timestamp(), owner_line_changed_by_kind = $3 where id = $1`, [account, on, kind]);
}

/** A verified enrollment with a PIN, switch on. Inserted as the table owner (seeding, not the code under test). */
async function enrolled(c: Client, account: string, user: string, e164: string) {
  const { rows: [on] } = await c.query<{ on: boolean }>(
    "select owner_line_enabled_at is not null as on from accounts where id = $1", [account]);
  if (!on!.on) await switchTo(c, account, true);
  const { rows: [e] } = await c.query<{ id: string }>(
    `insert into owner_line_enrollments (account_id, user_id, e164, verified_at, pin_hash, pin_set_at)
     values ($1, $2, $3, now(), $4, now()) returning id`, [account, user, e164, pinHash()]);
  return e!.id;
}

/** A verified cell with NO PIN yet (Q-D: a person may verify before setting one). */
async function verifiedNoPin(c: Client, account: string, user: string, e164: string) {
  await c.query("insert into owner_line_enrollments (account_id, user_id, e164, verified_at) values ($1, $2, $3, now())",
    [account, user, e164]);
}

/** The same person on a second business (the I-1 cases): a membership at `account`, as the table owner. */
async function memberOf(c: Client, user: string, account: string, role: "owner" | "staff" | "technician") {
  await c.query("insert into memberships (user_id, scope, account_id, role) values ($1, 'account', $2, $3)", [user, account, role]);
}

async function liveNumber(c: Client, account: string): Promise<string> {
  const { rows: [pn] } = await c.query<{ id: string }>(
    "insert into phone_numbers (account_id, e164, status) values ($1, $2, 'live') returning id", [account, businessNumber()]);
  return pn!.id;
}

/** n owner-line calls for `user` on `account`, started now (this local day), as the table owner. */
async function ownerLineCalls(c: Client, account: string, user: string, n: number) {
  const pn = await liveNumber(c, account);
  for (let i = 0; i < n; i++) {
    await c.query("insert into calls (account_id, phone_number_id, caller_e164, owner_line_user_id) values ($1, $2, '+19565550101', $3)",
      [account, pn, user]);
  }
}

const asService = (c: Client) => c.query("set local role service_role");

describe("0115 owner_line_enrollments: grants, RLS, function privileges", () => {
  it("the whole table privilege matrix is service_role's DELETE, INSERT, SELECT, UPDATE and nothing else (probe: grant select on public.owner_line_enrollments to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ r: string; p: string }>(
        `select r, p from unnest(array['anon', 'authenticated', 'public', 'service_role']) r
           cross join unnest($1::text[]) p
          where has_table_privilege(r, '${TABLE}', p) order by r, p`, [TABLE_PRIVS]);
      expect(rows).toEqual([
        { r: "service_role", p: "DELETE" }, { r: "service_role", p: "INSERT" },
        { r: "service_role", p: "SELECT" }, { r: "service_role", p: "UPDATE" },
      ]);
    }));

  it("no column privilege for anon, authenticated or PUBLIC, so pin_hash is never readable through PostgREST (probe: grant select (pin_hash) to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select r, p from unnest(array['anon', 'authenticated', 'public']) r
           cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
          where has_any_column_privilege(r, '${TABLE}', p)`);
      expect(rows).toEqual([]);
    }));

  it("row level security is on with NO policy (probe: disable row level security -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [t] } = await c.query<{ relrowsecurity: boolean }>(`select relrowsecurity from pg_class where oid = '${TABLE}'::regclass`);
      const { rows: policies } = await c.query(`select polname from pg_policy where polrelid = '${TABLE}'::regclass`);
      expect([t!.relrowsecurity, policies]).toEqual([true, []]);
    }));

  it("a signed-in Owner selecting the table is refused 42501, not shown zero rows (probe: grant select to authenticated -> no error, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.owner, "+19565550101");
      await actAsMember(c, s.a, s.aOrg, "owner");
      await expect(c.query("select pin_hash from public.owner_line_enrollments")).rejects.toMatchObject({ code: "42501" });
    }));

  it("EXECUTE on all seven functions is service_role's alone (probe: grant execute on owner_line_attempt_pin to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select f, r, has_function_privilege(r, f::regprocedure, 'EXECUTE') as x
           from unnest($1::text[]) f cross join unnest(array['anon', 'authenticated', 'public', 'service_role']) r order by f, r`,
        [FUNCTIONS]);
      expect(rows).toEqual(FUNCTIONS.flatMap((f) => [
        { f, r: "anon", x: false }, { f, r: "authenticated", x: false },
        { f, r: "public", x: false }, { f, r: "service_role", x: true },
      ]));
    }));

  it("all seven run as their CALLER with search_path pg_catalog, pg_temp: the PIN-check pin (SC-3; probe: security definer on owner_line_attempt_pin, or search_path '' -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select f, p.prosecdef, p.proconfig from unnest($1::text[]) f join pg_proc p on p.oid = f::regprocedure order by f`, [FUNCTIONS]);
      expect(rows).toEqual(FUNCTIONS.map((f) => ({ f, prosecdef: false, proconfig: ["search_path=pg_catalog, pg_temp"] })));
    }));

  it("calls.owner_line_user_id and accounts.owner_line_enabled_at exist, nullable, with no client write (probe: grant update (owner_line_enabled_at) on accounts to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select table_name, column_name, is_nullable, data_type from information_schema.columns
          where table_schema = 'public' and column_name in ('owner_line_user_id', 'owner_line_enabled_at') order by table_name`);
      expect(rows).toEqual([
        { table_name: "accounts", column_name: "owner_line_enabled_at", is_nullable: "YES", data_type: "timestamp with time zone" },
        { table_name: "calls", column_name: "owner_line_user_id", is_nullable: "YES", data_type: "uuid" },
      ]);
      const { rows: w } = await c.query(
        `select has_column_privilege('authenticated', 'public.accounts', 'owner_line_enabled_at', 'UPDATE') as acct,
                has_column_privilege('authenticated', 'public.calls', 'owner_line_user_id', 'UPDATE') as calls`);
      expect(w).toEqual([{ acct: false, calls: false }]);
    }));
});

describe("0115: one cell is one person per business", () => {
  it("a second person cannot claim the same cell on the same business while the first holds a live code; another business can (probe: displace a live code -> ok, FAILS; the unique key itself is pinned in the I-2 block)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      expect((await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10) as r", [s.a, s.owner, hex64()])).rows[0].r).toBe("ok");
      expect((await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10) as r", [s.a, s.staff, hex64()])).rows[0].r).toBe("taken");
      expect((await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10) as r", [s.b, s.bOwner, hex64()])).rows[0].r).toBe("ok");
    }));

  // ONE refused statement per withRollback: after the first error the transaction is aborted and every later
  // statement fails 25P02, which would make a second assertion pass or fail for the wrong reason.
  it("a PIN cannot be stored on an unverified cell (probe: drop owner_line_enrollments_pin_needs_cell_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into owner_line_enrollments (account_id, user_id, e164, pin_hash, pin_set_at) values ($1, $2, '+19565550101', $3, now())",
        [s.a, s.owner, pinHash()])).rejects.toMatchObject({ code: "23514", constraint: "owner_line_enrollments_pin_needs_cell_check" });
    }));

  it("a PIN stored in the clear is refused by the hash's shape (probe: drop owner_line_enrollments_pin_hash_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "insert into owner_line_enrollments (account_id, user_id, e164, verified_at, pin_hash, pin_set_at) values ($1, $2, '+19565550101', now(), '123456', now())",
        [s.a, s.owner])).rejects.toMatchObject({ code: "23514", constraint: "owner_line_enrollments_pin_hash_check" });
    }));

  it("removing the person from the team deletes their enrollment (probe: drop the cascade -> 23503, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.owner, "+19565550101");
      await c.query("delete from memberships where account_id = $1 and user_id = $2", [s.a, s.owner]);
      const { rows } = await c.query("select 1 from owner_line_enrollments where user_id = $1", [s.owner]);
      expect(rows).toEqual([]);
    }));
});

describe("0115: the call-in code", () => {
  it("the right code verifies; a wrong one counts; the third wrong spends it (probe: verify_attempts + 1 >= 4 -> the third answer is 'wrong', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const right = hex64();
      await asService(c);
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10)", [s.a, s.owner, right]);
      const attempt = async (h: string) => (await c.query("select public.owner_line_attempt_verify($1, '+19565550101', $2) as r", [s.a, h])).rows[0].r;
      expect(await attempt(hex64())).toBe("wrong");
      expect(await attempt(hex64())).toBe("wrong");
      expect(await attempt(hex64())).toBe("spent");
      expect(await attempt(right)).toBe("none");
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10)", [s.a, s.owner, right]);
      expect(await attempt(right)).toBe("verified");
    }));

  it("an expired code is spent, never verified (probe: drop the verify_expires_at > now() test -> 'verified', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const right = hex64();
      await asService(c);
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10)", [s.a, s.owner, right]);
      await c.query("reset role");
      await c.query("update owner_line_enrollments set verify_expires_at = now() - interval '1 second' where user_id = $1", [s.owner]);
      await asService(c);
      expect((await c.query("select public.owner_line_attempt_verify($1, '+19565550101', $2) as r", [s.a, right])).rows[0].r).toBe("spent");
    }));

  it("the answer route is told 'verify' while a code is pending, with the switch still off (Q-D), and 'none' once it has expired unused (probe: drop the e.verify_expires_at > now() test from the lookup -> the expired case answers 'verify', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const look = async () => (await c.query(
        "select public.owner_line_answer_lookup($1, '+19565550101', 10) as r", [s.a])).rows[0].r;
      await asService(c);
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550101', $3, 10)", [s.a, s.owner, hex64()]);
      expect(await look()).toMatchObject({ status: "verify", user_id: s.owner, role: "owner", name: "Dan Lopez" });
      await c.query("reset role");
      // Nobody called within the ten minutes: the code is still stored (only an attempt clears it), but it is dead.
      await c.query("update owner_line_enrollments set verify_expires_at = now() - interval '1 second' where user_id = $1", [s.owner]);
      await asService(c);
      expect(await look()).toEqual({ status: "none" });
    }));

  it("changing the cell clears the verification and the PIN (probe: keep pin_hash on a new e164 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.owner, "+19565550101");
      await asService(c);
      await c.query("select public.owner_line_start_verification($1, $2, '+19565550199', $3, 10)", [s.a, s.owner, hex64()]);
      const { rows } = await c.query("select e164, verified_at, pin_hash from owner_line_enrollments where user_id = $1", [s.owner]);
      expect(rows).toEqual([{ e164: "+19565550199", verified_at: null, pin_hash: null }]);
    }));
});

describe("0115: the PIN and the lock", () => {
  it("a correct PIN is ok and resets the counter (probe: compare pin_hash <> p_candidate -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await enrolled(c, s.a, s.owner, "+19565550101");
      await asService(c);
      expect((await c.query("select public.owner_line_attempt_pin($1, 'nope', 30) as r", [id])).rows[0].r).toMatchObject({ status: "wrong", failed_attempts: 1 });
      expect((await c.query("select public.owner_line_attempt_pin($1, $2, 30) as r", [id, pinHash()])).rows[0].r).toEqual({ status: "ok" });
      await c.query("reset role");
      expect((await c.query("select failed_attempts from owner_line_enrollments where id = $1", [id])).rows[0].failed_attempts).toBe(0);
    }));

  it("the third wrong PIN locks for 30 minutes; the lock refuses even the right PIN; the counter is per enrollment, so a new call does not reset it (probe: >= 4 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await enrolled(c, s.a, s.owner, "+19565550101");
      await asService(c);
      const pin = async (cand: string) => (await c.query("select public.owner_line_attempt_pin($1, $2, 30) as r", [id, cand])).rows[0].r;
      expect((await pin("x")).status).toBe("wrong");
      expect((await pin("y")).status).toBe("wrong");   // "a redial": nothing about the call is an argument
      const third = await pin("z");
      expect(third.status).toBe("locked_now");
      const minutes = (new Date(third.locked_until).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(29);
      expect(minutes).toBeLessThanOrEqual(30.1);
      expect((await pin(pinHash())).status).toBe("locked");
    }));

  it("the answer lookup: pin for a verified, unlocked, switched-on person; off; locked; over_limit at the 10th prior owner-line call; none for a stranger (probe: count >= p_max + 1 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await enrolled(c, s.a, s.owner, "+19565550101");
      const look = async (caller: string) => (await c.query(
        "select public.owner_line_answer_lookup($1, $2, 10) as r", [s.a, caller])).rows[0].r;
      await asService(c);
      expect(await look("+19565550199")).toEqual({ status: "none" });
      const hit = await look("+19565550101");
      expect(hit).toMatchObject({ status: "pin", enrollment_id: id, user_id: s.owner, role: "owner", name: "Dan Lopez", pin_params: pinHash().slice(0, 36) });
      await c.query("reset role");
      const pn = await liveNumber(c, s.a);
      for (let i = 0; i < 10; i++) {
        await c.query("insert into calls (account_id, phone_number_id, caller_e164, owner_line_user_id) values ($1, $2, '+19565550101', $3)", [s.a, pn, s.owner]);
      }
      await asService(c);
      expect((await look("+19565550101")).status).toBe("over_limit");
      await c.query("reset role");
      await c.query("update owner_line_enrollments set locked_until = now() + interval '5 minutes' where id = $1", [id]);
      await asService(c);
      expect(await look("+19565550101")).toEqual({ status: "locked" });
      await c.query("reset role");
      await switchTo(c, s.a, false);
      await asService(c);
      expect(await look("+19565550101")).toEqual({ status: "off" });
    }));

  it("the session check refuses a removed person and a changed role, and answers the person's facts when all holds (probe: drop the role comparison -> the downgrade case FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.staff, "+19565550102");
      const check = async (role: string) => (await c.query(
        "select public.owner_line_session_check($1, $2, $3, null) as r", [s.a, s.staff, role])).rows[0].r;
      await asService(c);
      expect(await check("staff")).toMatchObject({ ok: true, clerk_org_id: s.aOrg });
      expect(await check("owner")).toEqual({ ok: false, reason: "role_changed" });
      await c.query("reset role");
      await c.query("update memberships set role = 'technician' where account_id = $1 and user_id = $2", [s.a, s.staff]);
      await asService(c);
      expect(await check("staff")).toEqual({ ok: false, reason: "role_changed" });
      await c.query("reset role");
      await c.query("delete from memberships where account_id = $1 and user_id = $2", [s.a, s.staff]);
      await asService(c);
      expect(await check("technician")).toEqual({ ok: false, reason: "not_a_member" });
    }));
});

describe("0115: the account's local day (owner ruling Q-F)", () => {
  // app.owner_line_day_start(zone, instant): the first instant whose local date is the instant's local date.
  const dayStart = async (c: Client, zone: string, at: string) =>
    (await c.query<{ d: Date }>("select app.owner_line_day_start($1, $2::timestamptz) as d", [zone, at])).rows[0]!.d.toISOString();

  it("an ordinary day, a spring-forward day (23 h) and a fall-back day (25 h) in America/Chicago (probe: return date_trunc('day', p_at) -> FAILS)", () =>
    withRollback(async (c) => {
      expect(await dayStart(c, "America/Chicago", "2026-11-09T15:00:00Z")).toBe("2026-11-09T06:00:00.000Z");
      expect(await dayStart(c, "America/Chicago", "2026-03-08T20:00:00Z")).toBe("2026-03-08T06:00:00.000Z");  // CST until 2 AM
      expect(await dayStart(c, "America/Chicago", "2026-03-09T04:59:00Z")).toBe("2026-03-08T06:00:00.000Z");  // 23:59 CDT
      expect(await dayStart(c, "America/Chicago", "2026-11-01T20:00:00Z")).toBe("2026-11-01T05:00:00.000Z");  // CDT until 2 AM
      expect(await dayStart(c, "America/Chicago", "2026-11-02T05:59:00Z")).toBe("2026-11-01T05:00:00.000Z");  // 23:59 CST
    }));

  // A pinned VALUE, not a probe: PostgreSQL already reads this missing midnight as the instant the clocks jump, so no
  // mutation of owner_line_day_start's loops can fail it (replica, 2026-11-09). The Havana case below carries the probe.
  it("a zone whose clocks jump AT midnight (America/Santiago, 2026-09-06 00:00 -> 01:00): the day starts at the first instant that exists, 04:00Z", () =>
    withRollback(async (c) => {
      // Confirmed with node's ICU (77.1, tz 2025b): 2026-09-06T03:59Z is Sept 5 23:59 and 04:00Z is Sept 6 01:00 in Santiago.
      expect(await dayStart(c, "America/Santiago", "2026-09-06T15:00:00Z")).toBe("2026-09-06T04:00:00.000Z");
    }));

  // PostgreSQL resolves an AMBIGUOUS local time to the LATER instant: ('2026-11-01'::timestamp at time zone
  // 'America/Havana') is 05:00Z, the second midnight. The day began an hour earlier, at the first one (04:00Z, read
  // with node's ICU: 03:59Z is Oct 31 23:59 GMT-4, 04:00Z is Nov 1 00:00 GMT-4, 05:00Z is Nov 1 00:00 GMT-5). Only the
  // step-back loop finds it; the Santiago case above cannot fail without the loops, because PostgreSQL already reads
  // a midnight that does not exist as the instant the clocks jump.
  it("a zone whose clocks fall back to midnight (America/Havana, 2026-11-01 01:00 -> 00:00): the day starts at the FIRST midnight (probe: drop the step-back loop -> 05:00Z, FAILS)", () =>
    withRollback(async (c) => {
      expect(await dayStart(c, "America/Havana", "2026-11-01T15:00:00Z")).toBe("2026-11-01T04:00:00.000Z");
      expect(await dayStart(c, "America/Havana", "2026-11-01T04:30:00Z")).toBe("2026-11-01T04:00:00.000Z");
    }));

  it("the daily limit counts this account-local day only: ten calls YESTERDAY local do not refuse today (probe: count from utc midnight -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.owner, "+19565550101");
      await c.query("update accounts set timezone = 'America/Chicago' where id = $1", [s.a]);
      const pn = await liveNumber(c, s.a);
      // One minute before this account's local midnight: yesterday, local, whatever the UTC date says.
      for (let i = 0; i < 10; i++) {
        await c.query(`insert into calls (account_id, phone_number_id, caller_e164, owner_line_user_id, started_at)
                       values ($1, $2, '+19565550101', $3, app.owner_line_day_start('America/Chicago', now()) - interval '1 minute')`,
          [s.a, pn, s.owner]);
      }
      await asService(c);
      expect((await c.query("select public.owner_line_answer_lookup($1, '+19565550101', 10) as r", [s.a])).rows[0].r.status).toBe("pin");
    }));
});

describe("0115: the switch's guard and its record (owner rulings Q-A, spec 3.3)", () => {
  // The guard's own refusal carries its message and no constraint name, so each case below fails if the guard stops
  // testing its column, even where a CHECK would still refuse the same row with another message.
  const GUARD = { code: "23514", message: expect.stringMatching(/the owner line starts off/) };
  const newAccount = async (c: Client, tag: string, cols: string, vals: string) => {
    const { rows: [ag] } = await c.query<{ id: string }>("insert into agencies (name) values ('OL guard') returning id");
    return c.query(`insert into accounts (agency_id, clerk_org_id, name${cols}) values ($1, $2, 'OL guard'${vals})`,
      [ag!.id, `org_ol_${tag}_${RUN}`]);
  };

  it("no account can be CREATED with the switch on, by any role (probe: drop trigger accounts_owner_line_insert_guard -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(newAccount(c, "guard", ", owner_line_enabled_at", ", now()")).rejects.toMatchObject(GUARD);
    }));

  // One column per case: a row that sets two guarded columns is still refused by the other one when the guard forgets
  // either, so it cannot catch that probe (it survived on the replica, 2026-11-09).
  it("no account can be created carrying a record of a change that never happened (no CHECK reaches this row: both record columns set; probe: drop trigger -> FAILS)", () =>
    withRollback(async (c) => {
      await expect(newAccount(c, "guard3", ", owner_line_changed_at, owner_line_changed_by_kind", ", now(), 'owner'")).rejects.toMatchObject(GUARD);
    }));

  it("no account can be created with only a change time set (probe: drop owner_line_changed_at from the guard -> the pair CHECK refuses instead, FAILS)", () =>
    withRollback(async (c) => {
      await expect(newAccount(c, "guard5", ", owner_line_changed_at", ", now()")).rejects.toMatchObject(GUARD);
    }));

  it("no account can be created with only a who-kind set (probe: drop owner_line_changed_by_kind from the guard -> the pair CHECK refuses instead, FAILS)", () =>
    withRollback(async (c) => {
      await expect(newAccount(c, "guard4", ", owner_line_changed_by_kind", ", 'agency'")).rejects.toMatchObject(GUARD);
    }));

  it("an account created with it off is fine, and the record columns start empty", () =>
    withRollback(async (c) => {
      await newAccount(c, "guard2", "", "");
      const { rows: [a] } = await c.query(
        "select owner_line_enabled_at, owner_line_changed_at, owner_line_changed_by_kind from accounts where clerk_org_id = $1",
        [`org_ol_guard2_${RUN}`]);
      expect(a).toEqual({ owner_line_enabled_at: null, owner_line_changed_at: null, owner_line_changed_by_kind: null });
    }));

  it("accounts stores WHO-KIND and WHEN only, never a person's id: exactly three owner_line columns (owner ruling 2026-11-09, 'Say BIS, keep names private'; probe: add a person-id column, owner_line_changed_by_user text -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select column_name, data_type, is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'accounts' and column_name like 'owner_line%' order by column_name`);
      expect(rows).toEqual([
        { column_name: "owner_line_changed_at", data_type: "timestamp with time zone", is_nullable: "YES" },
        { column_name: "owner_line_changed_by_kind", data_type: "text", is_nullable: "YES" },
        { column_name: "owner_line_enabled_at", data_type: "timestamp with time zone", is_nullable: "YES" },
      ]);
    }));

  it("the record travels with the switch: a change says when AND who-kind (probe: drop accounts_owner_line_change_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query("update accounts set owner_line_changed_at = now() where id = $1", [s.a]))
        .rejects.toMatchObject({ code: "23514", constraint: "accounts_owner_line_change_check" });
    }));

  it("the who-kind is the Owner or BIS, nothing else (probe: drop accounts_owner_line_changed_by_kind_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query("update accounts set owner_line_changed_at = now(), owner_line_changed_by_kind = 'user_2abc' where id = $1", [s.a]))
        .rejects.toMatchObject({ code: "23514", constraint: "accounts_owner_line_changed_by_kind_check" });
    }));

  it("the Owner may leave it on or off; BIS may leave it off", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, true, "owner");
      await switchTo(c, s.a, false, "owner");
      await switchTo(c, s.a, false, "agency");
      const { rows } = await c.query("select owner_line_enabled_at, owner_line_changed_by_kind from accounts where id = $1", [s.a]);
      expect(rows).toEqual([{ owner_line_enabled_at: null, owner_line_changed_by_kind: "agency" }]);
    }));

  it("BIS's last word can only be OFF: on with who-kind agency is refused (owner ruling Q-A; probe: drop accounts_owner_line_agency_off_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query(
        "update accounts set owner_line_enabled_at = now(), owner_line_changed_at = now(), owner_line_changed_by_kind = 'agency' where id = $1", [s.a]))
        .rejects.toMatchObject({ code: "23514", constraint: "accounts_owner_line_agency_off_check" });
    }));
});

describe("0115: the access log learns owner_line_call", () => {
  it("note_owner_line_call writes one owner_line visit and one item per tool; the BIS access page does not show it (probe: drop actor_kind = 'agency' from access_log_page -> total 1, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const pn = await liveNumber(c, s.a);
      const { rows: [call] } = await c.query<{ id: string }>(
        "insert into calls (account_id, phone_number_id, owner_line_user_id) values ($1, $2, $3) returning id", [s.a, pn, s.owner]);
      await asService(c);
      await c.query("select public.note_owner_line_call($1, $2, 'user_x', 'Dan Lopez', array['owner_line_appointments', 'owner_line_calls_and_messages', 'owner_line_appointments'])",
        [s.a, call!.id]);
      await c.query("reset role");
      const { rows: v } = await c.query("select actor_kind, reason, clerk_session_id from agency_visits where account_id = $1", [s.a]);
      expect(v).toEqual([{ actor_kind: "owner_line", reason: "owner_line_call", clerk_session_id: `call:${call!.id}` }]);
      const { rows: i } = await c.query("select kind from agency_visit_items where account_id = $1 order by kind", [s.a]);
      expect(i).toEqual([{ kind: "owner_line_appointments" }, { kind: "owner_line_calls_and_messages" }]);
      await actAsMember(c, s.a, s.aOrg, "owner");
      const { rows: [p] } = await c.query("select public.access_log_page($1, null, null, 20) as p", [s.a]);
      expect(p.p).toEqual({ total: 0, visits: [] });
    }));

  it("note_owner_line_call refuses an agency kind (probe: drop the owner_line_ prefix guard -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      await expect(c.query("select public.note_owner_line_call($1, gen_random_uuid(), 'user_x', null, array['contact'])", [s.a]))
        .rejects.toMatchObject({ code: "22023" });
    }));
});

// Review I-1 (2026-11-09): every read is THIS business's. Each case puts the same cell or the same person at business
// B, so a read that loses its account filter answers from B's row and fails here by name.
describe("0115: every read is the dialed business's only (review I-1)", () => {
  const CELL = "+19565550101";
  const look = async (c: Client, account: string) => (await c.query(
    "select public.owner_line_answer_lookup($1, $2, 10) as r", [account, CELL])).rows[0].r;
  const check = async (c: Client, account: string, user: string, role: string, max: number | null) => (await c.query(
    "select public.owner_line_session_check($1, $2, $3, $4) as r", [account, user, role, max])).rows[0].r;

  it("the lookup on A's line answers none for a cell enrolled only at B, the same person on both (probe t1: drop account_id from the lookup's enrollment read -> B's 'pin', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await memberOf(c, s.owner, s.b, "staff");
      await switchTo(c, s.a, true);
      await enrolled(c, s.b, s.owner, CELL);
      await asService(c);
      expect(await look(c, s.a)).toEqual({ status: "none" });
      expect((await look(c, s.b)).status).toBe("pin");   // control: the row is live where it belongs
    }));

  it("B's owner-line calls never count toward A's ten a day, for the same person and the same cell (probe t2: drop c.account_id from the lookup's count -> 'over_limit', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await memberOf(c, s.owner, s.b, "staff");
      await enrolled(c, s.a, s.owner, CELL);
      await enrolled(c, s.b, s.owner, CELL);
      await ownerLineCalls(c, s.b, s.owner, 10);
      await asService(c);
      expect((await look(c, s.a)).status).toBe("pin");
      expect((await look(c, s.b)).status).toBe("over_limit");   // control: they count at B
    }));

  it("a code attempt on A's line never touches B's pending code for the same cell, even with B's right code (probe t3: drop account_id from attempt_verify's read -> 'verified', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const codeB = hex64();
      await asService(c);
      await c.query("select public.owner_line_start_verification($1, $2, $3, $4, 10)", [s.b, s.bOwner, CELL, codeB]);
      const r = (await c.query("select public.owner_line_attempt_verify($1, $2, $3) as r", [s.a, CELL, codeB])).rows[0].r;
      const { rows } = await c.query(
        "select verified_at, verify_attempts, verify_code_hash from owner_line_enrollments where account_id = $1", [s.b]);
      expect([r, rows]).toEqual(["none", [{ verified_at: null, verify_attempts: 0, verify_code_hash: codeB }]]);
    }));

  it("the session check on A refuses a person enrolled only at B (probe t4: drop account_id from session_check's enrollment read -> ok, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await memberOf(c, s.owner, s.b, "staff");
      await switchTo(c, s.a, true);
      await enrolled(c, s.b, s.owner, CELL);
      await asService(c);
      expect(await check(c, s.a, s.owner, "owner", null)).toEqual({ ok: false, reason: "not_enrolled" });
      expect(await check(c, s.b, s.owner, "staff", null)).toMatchObject({ ok: true });   // control
    }));

  it("the session check counts A's calls only (probe t5: drop c.account_id from session_check's count -> 'over_limit', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await memberOf(c, s.owner, s.b, "staff");
      await enrolled(c, s.a, s.owner, CELL);
      await enrolled(c, s.b, s.owner, CELL);
      await ownerLineCalls(c, s.b, s.owner, 10);
      await asService(c);
      expect(await check(c, s.a, s.owner, "owner", 10)).toMatchObject({ ok: true });
      expect(await check(c, s.b, s.owner, "staff", 10)).toEqual({ ok: false, reason: "over_limit" });   // control
    }));
});

// Review I-2 (2026-11-09): every refusal branch, by name. Each case reaches exactly one branch with everything else
// holding, so deleting that branch lets the call through ('pin' or ok: true) and the case fails by name.
describe("0115: every refusal answers by name (review I-2)", () => {
  const CELL = "+19565550102";
  const check = async (c: Client, s: Seed, max: number | null = null) => (await c.query(
    "select public.owner_line_session_check($1, $2, 'staff', $3) as r", [s.a, s.staff, max])).rows[0].r;
  const look = async (c: Client, s: Seed) => (await c.query(
    "select public.owner_line_answer_lookup($1, $2, 10) as r", [s.a, CELL])).rows[0].r;

  it("session check: client access off, or the business archived, is no_client_access (probe u1: delete that line -> ok, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.staff, CELL);
      await c.query("update accounts set client_access_enabled = false where id = $1", [s.a]);
      await asService(c);
      const off = await check(c, s);
      await c.query("reset role");
      await c.query("update accounts set client_access_enabled = true, status = 'archived' where id = $1", [s.a]);
      await asService(c);
      expect([off, await check(c, s)]).toEqual([
        { ok: false, reason: "no_client_access" }, { ok: false, reason: "no_client_access" }]);
    }));

  it("session check: the switch off is switch_off (probe u2: delete that line -> ok, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.staff, CELL);
      await switchTo(c, s.a, false, "agency");
      await asService(c);
      expect(await check(c, s)).toEqual({ ok: false, reason: "switch_off" });
    }));

  it("session check: no enrollment, or a verified cell with no PIN, is not_enrolled (probe u3: delete that branch -> ok, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, true);
      await asService(c);
      const none = await check(c, s);
      await c.query("reset role");
      await verifiedNoPin(c, s.a, s.staff, CELL);
      await asService(c);
      expect([none, await check(c, s)]).toEqual([
        { ok: false, reason: "not_enrolled" }, { ok: false, reason: "not_enrolled" }]);
    }));

  it("session check: a locked enrollment is locked (probe u4: delete that line -> ok, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      const id = await enrolled(c, s.a, s.staff, CELL);
      await c.query("update owner_line_enrollments set locked_until = now() + interval '5 minutes' where id = $1", [id]);
      await asService(c);
      expect(await check(c, s)).toEqual({ ok: false, reason: "locked" });
    }));

  it("session check: the tenth call today is over_limit at the webhook (p_max 10), never on a tool call (p_max null) (probe u5: delete the over_limit block -> ok, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.staff, CELL);
      await ownerLineCalls(c, s.a, s.staff, 10);
      await asService(c);
      expect([await check(c, s, 10), (await check(c, s, null)).ok]).toEqual([{ ok: false, reason: "over_limit" }, true]);
    }));

  it("lookup: client access off, or the business archived, answers none, never asks for a PIN (probe u6: delete the client-access gate -> 'pin', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.staff, CELL);
      await c.query("update accounts set client_access_enabled = false where id = $1", [s.a]);
      await asService(c);
      const off = await look(c, s);
      await c.query("reset role");
      await c.query("update accounts set client_access_enabled = true, status = 'archived' where id = $1", [s.a]);
      await asService(c);
      expect([off, await look(c, s)]).toEqual([{ status: "none" }, { status: "none" }]);
    }));

  it("lookup: a verified cell with no PIN answers none (probe u7: delete the no-PIN line -> 'pin' with no pin_params, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, true);
      await verifiedNoPin(c, s.a, s.staff, CELL);
      await asService(c);
      expect(await look(c, s)).toEqual({ status: "none" });
    }));
});

// Review m-2 (2026-11-09): the switch never moves without its record. Each refusal is the trigger's own (its message,
// no constraint name), so a case cannot pass on a CHECK refusing the same row.
describe("0115: the switch moves only with a fresh record (review m-2)", () => {
  const RECORD = { code: "23514", message: expect.stringMatching(/must record when and who-kind/) };

  it("turning it on with no record is refused (probe: drop trigger accounts_owner_line_switch_record -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query("update accounts set owner_line_enabled_at = now() where id = $1", [s.a])).rejects.toMatchObject(RECORD);
    }));

  it("turning it on over a stale 'owner' record is refused (probe: drop the 'is not distinct from old' test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, false, "owner");
      await expect(c.query("update accounts set owner_line_enabled_at = now() where id = $1", [s.a])).rejects.toMatchObject(RECORD);
    }));

  it("turning it on while clearing the record is refused (probe: drop the 'is null' test -> the change goes through, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, false, "owner");
      await expect(c.query(
        "update accounts set owner_line_enabled_at = now(), owner_line_changed_at = null, owner_line_changed_by_kind = null where id = $1",
        [s.a])).rejects.toMatchObject(RECORD);
    }));

  it("a write that does not move the switch needs no record (probe: drop the trigger WHEN clause -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, true);
      await c.query("update accounts set name = 'OL renamed', owner_line_enabled_at = owner_line_enabled_at where id = $1", [s.a]);
      const { rows } = await c.query("select name from accounts where id = $1", [s.a]);
      expect(rows).toEqual([{ name: "OL renamed" }]);
    }));
});

// Review m-3 (2026-11-09): an agency visit never carries an owner-line item. parseVisit (packages/db/src/access-log.ts)
// accepts only ACCESS_LOG_KINDS, so one such item on an agency visit would make the Team page's BIS access section throw.
describe("0115: note_agency_open refuses the owner-line kinds (review m-3)", () => {
  it("an agency note with an owner_line_ kind is refused 22023, while a contact note on the same live visit is ok (probe: drop the guard -> 'ok', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      await c.query("select public.start_agency_visit($1, 'user_bis_ol', 'Dan', 'sess_ol', 'support')", [s.a]);
      const note = (kind: string) => c.query(
        "select public.note_agency_open($1, 'user_bis_ol', 'sess_ol', $2, gen_random_uuid(), null) as r", [s.a, kind]);
      expect((await note("contact")).rows[0].r).toBe("ok");
      await expect(note("owner_line_appointments")).rejects.toMatchObject({ code: "22023" });
    }));
});

// Review m-B (2026-11-09): a switched-on business always says who-kind and when. The record trigger (m-2) fires only
// when the switch MOVES, so without this CHECK an UPDATE that leaves the switch on and clears its record was accepted.
describe("0115: an ON switch keeps its record (review m-B)", () => {
  it("clearing the record while the switch is on is refused (probe: drop accounts_owner_line_on_has_record_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, true);
      await expect(c.query(
        "update accounts set owner_line_changed_at = null, owner_line_changed_by_kind = null where id = $1", [s.a]))
        .rejects.toMatchObject({ code: "23514", constraint: "accounts_owner_line_on_has_record_check" });
    }));

  it("Task 15's reset still works: off with a fresh record, then the record cleared with the switch off", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await switchTo(c, s.a, true);
      await switchTo(c, s.a, false, "owner");
      await c.query("update accounts set owner_line_changed_at = null, owner_line_changed_by_kind = null where id = $1", [s.a]);
      const { rows } = await c.query(
        "select owner_line_enabled_at, owner_line_changed_at, owner_line_changed_by_kind from accounts where id = $1", [s.a]);
      expect(rows).toEqual([{ owner_line_enabled_at: null, owner_line_changed_at: null, owner_line_changed_by_kind: null }]);
    }));
});

// Review (Task 2) m-2: the teardown names the table (calendar-feeds-schema.test.ts case 8 is the precedent). It also
// cascades with its membership, so a test that forgets it still cleans up today; the list is the record of intent.
describe("0115: teardown", () => {
  it("owner_line_enrollments is on ACCOUNT_OWNED_TABLES, and the first two stay the AI tables (probe: remove \"owner_line_enrollments\" -> FAILS)", () => {
    expect((ACCOUNT_OWNED_TABLES as readonly string[]).includes("owner_line_enrollments")).toBe(true);
    expect(ACCOUNT_OWNED_TABLES.slice(0, 2)).toEqual(["ai_ledger", "account_ai_settings"]);
  });
});

// Task 5 review I-2 (2026-11-09): an unverified claim whose code has lapsed or been spent no longer holds a cell. A new
// claim on that cell DISPLACES it (the displaced person is left with no cell, no code and no PIN); a verified holder or a
// live code still answers `taken`. And a person may start at most five codes per business in any 24 hours, so nobody
// can keep a number they do not hold in the call-in prompt for long (spec 2.1).
describe("0115: a lapsed claim never holds a cell (review I-2)", () => {
  const CELL = "+19565550123";
  const start = async (c: Client, account: string, user: string, cell = CELL) => (await c.query(
    "select public.owner_line_start_verification($1, $2, $3, $4, 10) as r", [account, user, cell, hex64()])).rows[0].r;
  const rowOf = async (c: Client, user: string) => (await c.query(
    `select e164, verified_at, verify_code_hash, pin_hash from owner_line_enrollments where user_id = $1`, [user])).rows;
  const CLEARED = [{ e164: null, verified_at: null, verify_code_hash: null, pin_hash: null }];

  it("an expired claim is displaced: the real holder gets the cell, the other person keeps no cell, code or PIN (probe: never displace -> 'taken', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      expect(await start(c, s.a, s.staff)).toBe("ok");
      await c.query("reset role");
      await c.query("update owner_line_enrollments set verify_expires_at = now() - interval '1 second' where user_id = $1", [s.staff]);
      await asService(c);
      expect(await start(c, s.a, s.owner)).toBe("ok");
      expect([(await rowOf(c, s.owner))[0].e164, await rowOf(c, s.staff)]).toEqual([CELL, CLEARED]);
    }));

  it("a spent claim (three wrong codes) is displaced too (probe: displace only an expired code -> 'taken', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      await start(c, s.a, s.staff);
      for (let i = 0; i < 3; i++) await c.query("select public.owner_line_attempt_verify($1, $2, $3)", [s.a, CELL, hex64()]);
      expect(await start(c, s.a, s.owner)).toBe("ok");
      expect(await rowOf(c, s.staff)).toEqual(CLEARED);
    }));

  it("a live code is not displaced: the newcomer is told taken and the holder keeps the cell and the code (probe: displace a live code -> 'ok', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      await start(c, s.a, s.staff);
      expect(await start(c, s.a, s.owner)).toBe("taken");
      expect((await rowOf(c, s.staff))[0]).toMatchObject({ e164: CELL, verify_code_hash: expect.any(String) });
    }));

  it("a verified holder is never displaced, PIN and all (probe: displace a verified row -> 'ok', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await enrolled(c, s.a, s.staff, CELL);
      await asService(c);
      expect(await start(c, s.a, s.owner)).toBe("taken");
      expect((await rowOf(c, s.staff))[0]).toMatchObject({ e164: CELL, verified_at: expect.anything(), pin_hash: expect.any(String) });
    }));

  it("another business's claim never displaces this one's, even a lapsed one (probe: drop account_id from the holder read -> A's row cleared, FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      await start(c, s.a, s.staff);
      await c.query("reset role");
      await c.query("update owner_line_enrollments set verify_expires_at = now() - interval '1 second' where user_id = $1", [s.staff]);
      await asService(c);
      expect(await start(c, s.b, s.bOwner)).toBe("ok");
      expect((await rowOf(c, s.staff))[0]).toMatchObject({ e164: CELL, verify_code_hash: expect.any(String) });
    }));

  it("five starts per person per business in 24 hours; the sixth is too_many and stores nothing; a day later it is allowed again (probe: no cap -> 'ok', FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      const answers = [];
      for (let i = 1; i <= 6; i++) answers.push(await start(c, s.a, s.staff, `+1956555020${i}`));
      expect(answers).toEqual(["ok", "ok", "ok", "ok", "ok", "too_many"]);
      expect((await rowOf(c, s.staff))[0].e164).toBe("+19565550205");
      expect(await start(c, s.b, s.bOwner, "+19565550206")).toBe("ok");   // another person, another business: their own budget
      await c.query("reset role");
      await c.query("update owner_line_enrollments set verify_window_started_at = now() - interval '24 hours' where user_id = $1", [s.staff]);
      await asService(c);
      expect(await start(c, s.a, s.staff, "+19565550207")).toBe("ok");
    }));

  it("a displaced or removed row keeps its restart count, so clearing a cell never resets the cap (probe: reset verify_starts when a row is displaced -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await asService(c);
      for (let i = 1; i <= 5; i++) await start(c, s.a, s.staff, `+1956555030${i}`);
      await c.query("reset role");
      await c.query("update owner_line_enrollments set verify_expires_at = now() - interval '1 second' where user_id = $1", [s.staff]);
      await asService(c);
      expect(await start(c, s.a, s.owner, "+19565550305")).toBe("ok");   // displaces the staff member's lapsed claim
      expect(await start(c, s.a, s.staff, "+19565550399")).toBe("too_many");
    }));

  // Since I-2 the function answers taken BEFORE it writes, so the unique key is a backstop no function case reaches
  // (the old "second person" case survived dropping it). Pinned here, on the table itself.
  it("the table itself refuses a second person on the same cell of the same business (probe: drop owner_line_enrollments_one_cell -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("insert into owner_line_enrollments (account_id, user_id, e164) values ($1, $2, $3)", [s.a, s.owner, CELL]);
      await expect(c.query("insert into owner_line_enrollments (account_id, user_id, e164) values ($1, $2, $3)", [s.a, s.staff, CELL]))
        .rejects.toMatchObject({ code: "23505", constraint: "owner_line_enrollments_one_cell" });
    }));

  it("a row with no cell can hold no verification, code or PIN (probe: drop owner_line_enrollments_no_cell_check -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(c.query("insert into owner_line_enrollments (account_id, user_id, e164, verified_at) values ($1, $2, null, now())", [s.a, s.owner]))
        .rejects.toMatchObject({ code: "23514", constraint: "owner_line_enrollments_no_cell_check" });
    }));
});
```

- [ ] **Step 3: Run it on the replica's `pre` database (no 0115) and see it fail.**

  ```bash
  cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55433/pre pnpm exec vitest run src/test/owner-line-schema.test.ts
  ```

  Expected: every case FAILS (`relation "public.owner_line_enrollments" does not exist`, or `function … does not exist`). Paste one failing assertion line and the summary line. Judge the run by vitest's own summary, never the exit code (repo rule 4).

- [ ] **Step 4: Write the migration.**

**The block below is the committed file as of the Task 2 commit (review m-B's CHECK and m-A's wording joined after `1cda0c20`; a DRAFT until 0113 lands: its header lists what to re-read), copied whole; the file is authoritative.**

```sql
-- 0115_owner_line.sql - the owner line (F-032 PR 1)
-- (docs/superpowers/specs/2026-11-09-owner-line-design.md sections 3.4, 4 and 6;
--  docs/superpowers/plans/2026-11-09-owner-line.md, Task 1, spec corrections SC-3 to SC-9 and SC-13)
--
-- DRAFT (2026-11-09). Written and replica-tested against 0112 plus 0114 (read from feat/f077-work-queue with git
-- show), because 0113 (F-115 PR D) does not exist yet. RE-READ AFTER 0113 IS MERGED (plan O-2, Task 1 Step 1), and
-- delete this paragraph when the file is final:
--   a. section 3's agency_visit_items_kind_check list: copied from 0112 section 6. If 0113 replaces it, copy 0113's.
--   b. section 3's agency_visits_actor_kind_check and agency_visits_reason_check: copied from 0105. Same rule.
--   c. section 3's access_log_page: 0112 section 6's text plus the two actor_kind filters. If 0113 replaces the
--      function, re-copy 0113's body and re-add the two filters.
--   d. section 3's grant insert (actor_kind) on agency_visits: if 0113 changes agency_visits' column grants, the
--      eleven-column pin in access-log-schema.test.ts moves with it.
--   e. section 0's lock order: if 0113 locks any of agency_visit_items, calls, agency_visits, memberships or
--      accounts, keep this file's children-first order consistent with it.
--   f. the number: if the highest migration is not 0114, renumber to the next free one.
--   g. section 3's note_agency_open: 0105's text plus the owner_line_ guard (0112 left it unchanged). If 0113
--      replaces it, re-copy 0113's body and re-add the guard.
--
-- WHAT.
--   public.owner_line_enrollments: one row per (account, person) who calls in to hear the day. The cell (e164) is
--     unique per account, so one cell is one person per business. A pending call-in code (verify_*, sha256 hex the
--     APP computes), the PIN as an scrypt string the APP computes (pin_hash; SQL only compares, 0036's split), the
--     wrong-PIN counter and the lock. The composite FK to memberships cascades: a person removed from the team, a
--     deleted user and a deleted account take the row with them.
--     Only a VERIFIED cell, or one with a LIVE code, holds a cell (Task 5 review I-2): a new claim on a cell whose
--     holder is unverified and whose code has lapsed or been spent displaces that holder, who is left with no cell,
--     no code and no PIN (e164 is null then; owner_line_enrollments_no_cell_check). Without that, a typo held a
--     teammate's cell forever and a requester could keep any number, a customer's included, in the call-in prompt.
--     A row is CLEARED, never deleted, when its cell goes (displaced, or removed by its person), so its restart
--     counter survives: at most five codes per person per business in any 24 hours (verify_window_started_at,
--     verify_starts). Why five a day and not five an hour: each start keeps a number in the prompt for at most ten
--     minutes, so a day bound caps it at 50 minutes a day, where an hour bound would allow most of the day; a
--     person who mistypes or misses the call still has several tries.
--   public.accounts.owner_line_enabled_at: the business's switch; null = off, the default. owner_line_changed_at and
--     owner_line_changed_by_kind ('owner' or 'agency'): WHEN it last changed and WHAT KIND of person changed it, never
--     WHO. Owner ruling 2026-11-09, "Say BIS, keep names private": every member reads accounts (authenticated holds
--     table-level SELECT), so no person's id is stored here; the card says "Turned on by the Owner" or "Turned off by
--     BIS". Which BIS person did it is BIS's own record, written by the app outside this table (plan Task 5).
--     Both set together or neither (accounts_owner_line_change_check). Owner ruling Q-A in the database: the agency
--     may turn it OFF, never ON, so a row whose last change was BIS's is off (accounts_owner_line_agency_off_check).
--     No account is born with any of the three set: a trigger refuses each on INSERT, for every role. The switch
--     never moves without a fresh TIME on its record (review m-2): a second trigger refuses any UPDATE that changes
--     owner_line_enabled_at unless owner_line_changed_at changes with it to a non-null value (the pair CHECK then
--     needs a who-kind). A writer that moves the switch and forgets the record is refused. What the database does
--     NOT guarantee (review m-A): that the who-kind is CURRENT. A writer that moves the time but leaves a stale
--     who-kind is accepted; keeping it current is the writer's job, and setOwnerLineSwitch (packages/db/src/
--     owner-line.ts) always writes both. Two more edges, named: two flips inside ONE transaction that both stamp
--     now() carry the same time, so the second is refused; and a backdated owner_line_changed_at (any value other
--     than the old one) is accepted. And an ON switch always has its record (review m-B,
--     accounts_owner_line_on_has_record_check): the trigger fires only when the switch moves, so without that CHECK
--     an UPDATE that left it on and cleared its record was accepted.
--   public.calls.owner_line_user_id: the person an owner-line call was for; null on every customer call. No foreign
--     key on purpose: the mark must outlive a deleted user, or the call would start counting as a customer's.
--   app.owner_line_day_start(zone, instant): the first instant of the instant's local date in that zone (owner
--     ruling Q-F: "per day" is the ACCOUNT's day). The 10-a-day limit counts from it.
--   The access log learns the owner_line_call entry (SC-13): agency_visits.actor_kind gains 'owner_line', reason gains
--     'owner_line_call' (the two travel together), agency_visit_items.kind gains one kind per owner-line tool, and
--     service_role may insert actor_kind. access_log_page reads actor_kind = 'agency' only, so the Team page's BIS
--     access section is unchanged (its parser, parseVisit in packages/db/src/access-log.ts, refuses any reason
--     outside setup, support, fix and billing, so an unfiltered page would break that section outright).
--     agency_visit_live (0105) is NOT changed and does not filter on actor_kind. It finds a visit by actor, account
--     AND clerk_session_id, and it stays agency-only because the two session shapes never meet: an owner-line visit's
--     is 'call:<calls.id>', a Clerk session id is 'sess_...'. Anything that ever writes another session shape into
--     agency_visits must add actor_kind = 'agency' to agency_visit_live first.
--     note_agency_open (0105) is re-created with one guard (review m-3): it refuses every owner_line_ kind (22023).
--     Those kinds now pass the items CHECK, and parseVisit accepts only ACCESS_LOG_KINDS, so an agency visit carrying
--     one would make the Team page's BIS access section throw. Owner-line items come only from note_owner_line_call.
-- FUNCTIONS. Seven callable, all SECURITY INVOKER with set search_path = pg_catalog, pg_temp (0096's rule), EXECUTE
--   to service_role only: app.owner_line_day_start, owner_line_answer_lookup, owner_line_start_verification,
--   owner_line_attempt_verify, owner_line_attempt_pin, owner_line_session_check, note_owner_line_call. Plus two
--   trigger functions, app.owner_line_insert_guard and app.owner_line_switch_record_guard, executable by no role (a
--   trigger's function is checked for EXECUTE only when the trigger is created). note_agency_open (0105) is
--   re-created, still an invoker, with 0105's grants restated. Only service_role runs them and it already holds what they touch,
--   so a definer would add privilege and nothing else (0104's reasoning). EXPECTED_DEFINERS does not change (39).
--   Every policy-like NULL is coalesced to a refusal (the plpgsql NULL-guard lesson).
-- GRANTS. The default ACL hands ALL on a new table to anon, authenticated and service_role by name: revoked from all
--   three, then SELECT, INSERT, UPDATE, DELETE back to service_role (0104's shape). RLS on, no policy. No client
--   grant moves, so EXPECTED_WRITES in schema-grants-guard.test.ts is unchanged. The new accounts and calls columns
--   get no column grant: authenticated holds table-level SELECT on both (so a member reads them under the existing
--   row policies) and no UPDATE on either column.
-- LOCKS. Five tables, taken up front inside a do block with lock_timeout 5s. The Supabase CLI does not run a file
--   inside a transaction block, and a bare LOCK TABLE there fails 25P01 (0114's header). The second do block raises
--   0115_not_one_transaction unless the rest of the file runs in that same transaction (0088's self-check), so a path
--   that commits between statements fails before any DDL. Apply only with a client that stops on the first error
--   (the CLI, apply_migration, psql -v ON_ERROR_STOP=1); a bare psql -f would carry on past the raise.
--   THE ORDER IS CHILDREN FIRST, accounts LAST:
--     agency_visit_items, calls, agency_visits (ACCESS EXCLUSIVE: new columns and constraint swaps), then
--     memberships (SHARE ROW EXCLUSIVE: the new FK), then accounts (ACCESS EXCLUSIVE: new columns and the trigger).
--   Why: a live writer takes its child table first and its parent second, in one statement. A call's startCallRow
--   holds calls, then its FK check needs accounts; note_agency_open holds agency_visit_items, then needs
--   agency_visits. Taking a parent first deadlocks such a writer: the file holds accounts and waits for calls while
--   the writer holds calls and waits for accounts (40P01). 0114 recorded exactly this on the PG 17.6 replica
--   (feat/f077-work-queue, 0114 LOCKS AND COST), and there the victim can be a live call's row. Children first, the
--   file simply waits behind the writer. Proven on the PG18 replica, 2026-11-09 (plan Task 1 Step 6b): with a call
--   insert held open, this order waited and applied; accounts first deadlocked the same writer.
--   0114 locks ai_acts then calls; this file does not lock ai_acts, so the two orders cannot cross.
--   Residual risk, named: public.set_account_member_role (0066) locks the account row and then updates memberships.
--   If an Owner changes a role in the milliseconds between this file's memberships lock and its accounts lock, one
--   side fails 40P01. If the file is the victim it applies nothing and is re-run; if the role change is, the Owner
--   presses Save again.
--   Residual risk, named (review m-4): deleting an account takes accounts first and then cascades into its
--   children (memberships, agency_visits and agency_visit_items; calls by its own statement first, through
--   deleteAccountCascade's ACCOUNT_OWNED_TABLES). A delete that has locked its accounts row when this file reaches
--   accounts holds what the file waits for while waiting on a child the file holds: one side fails 40P01. If the
--   file is the victim it applies nothing and is re-run; if the delete is, the agency runs it again. Account
--   deletion is agency-only and rare. Apply outside business hours, and not during an account deletion.
--   An added column with no default and no NOT NULL is a catalog change only: no table rewrite. The new CHECKs on
--   accounts, agency_visits and agency_visit_items are added valid, so each scans its table once under the lock
--   already held.
-- APPLY ORDER: after 0113 and 0114. CI project (ci-project-setup.yml: push-dry-run, then push), then production (MCP
--   apply_migration, once), then the parity check, then merge. Additive: the build before it reads none of this. The
--   build after it is LOAD-BEARING on it, so it goes BEFORE the deploy, and the cost of getting that wrong is not a
--   visible error (Task 2 review m-1): the app filters calls.owner_line_user_id in countCallsSince and
--   countCallsByCallerSince, and BOTH voice routes FAIL OPEN when a cap read errors (apps/web/src/app/api/voice/
--   texml/route.ts's "fail open" catch; incoming/route.ts's "call-limit counts failed - failing open"). An app
--   deployed before this file therefore answers every call with BOTH call caps silently off, and the Calls list,
--   the dashboard and the weekly report fail outright (listCalls and listCallStartsByOutcomeBetween name the column
--   too). Never deploy the F-032 build to a project whose schema_migrations lacks this file.
--
-- Rollback (by hand, in this order; revert the app first). It destroys every enrollment and every owner-line
-- access-log entry:
--   drop function public.note_owner_line_call(uuid, uuid, text, text, text[]);
--   drop function public.owner_line_session_check(uuid, uuid, text, integer);
--   drop function public.owner_line_attempt_pin(uuid, text, integer);
--   drop function public.owner_line_attempt_verify(uuid, text, text);
--   drop function public.owner_line_start_verification(uuid, uuid, text, text, integer);
--   drop function public.owner_line_answer_lookup(uuid, text, integer);
--   drop function app.owner_line_day_start(text, timestamptz);
--   drop trigger accounts_owner_line_switch_record on public.accounts; drop function app.owner_line_switch_record_guard();
--   drop trigger accounts_owner_line_insert_guard on public.accounts; drop function app.owner_line_insert_guard();
--   re-run 0105's note_agency_open as create or replace, with its revoke and grant lines;
--   alter table public.accounts drop constraint accounts_owner_line_on_has_record_check,
--     drop constraint accounts_owner_line_agency_off_check,
--     drop constraint accounts_owner_line_change_check, drop column owner_line_changed_by_kind,
--     drop column owner_line_changed_at;
--   re-run 0112's access_log_page (its section 6) as create or replace;
--   by OWNER DECISION ONLY (it deletes access-log rows): delete from public.agency_visits where actor_kind = 'owner_line';
--   restore 0112's agency_visit_items_kind_check, 0105's agency_visits_actor_kind_check and agency_visits_reason_check;
--   alter table public.agency_visits drop constraint agency_visits_owner_line_check;
--   revoke insert (actor_kind) on public.agency_visits from service_role;
--   drop index public.calls_owner_line_idx; alter table public.calls drop column owner_line_user_id;
--   alter table public.accounts drop column owner_line_enabled_at;
--   drop table public.owner_line_enrollments;
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. One transaction, holding the locks, or nothing at all (0088 section 0).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
  perform pg_catalog.set_config('bis.m0115_xid', pg_catalog.txid_current()::text, true);
  -- Children first, accounts last (LOCKS). One statement per table, so the order is the order written.
  lock table public.agency_visit_items in access exclusive mode;
  lock table public.calls in access exclusive mode;
  lock table public.agency_visits in access exclusive mode;
  lock table public.memberships in share row exclusive mode;
  lock table public.accounts in access exclusive mode;
end $$;
do $$
begin
  if pg_catalog.current_setting('bis.m0115_xid', true) is distinct from pg_catalog.txid_current()::text
     or pg_catalog.current_setting('lock_timeout') <> '5s'
     or (select count(*) from pg_catalog.pg_locks l
          where l.pid = pg_catalog.pg_backend_pid() and l.granted and l.locktype = 'relation'
            and ((l.relation in ('public.accounts'::regclass, 'public.calls'::regclass,
                                 'public.agency_visits'::regclass, 'public.agency_visit_items'::regclass)
                  and l.mode = 'AccessExclusiveLock')
              or (l.relation = 'public.memberships'::regclass and l.mode = 'ShareRowExclusiveLock'))) <> 5 then
    raise exception '0115_not_one_transaction' using errcode = 'P0001';
  end if;
end $$;

-- 1. The enrollments.
create table public.owner_line_enrollments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  user_id uuid not null,
  e164 text constraint owner_line_enrollments_e164_check
    check (substr(e164, 1, 1) = '+' and substr(e164, 2, 1) <> '0' and substr(e164, 2) !~ '[^0-9]'
           and char_length(e164) between 9 and 16),
  verified_at timestamptz,
  verify_code_hash text constraint owner_line_enrollments_code_hash_check
    check (verify_code_hash is null or (char_length(verify_code_hash) = 64 and verify_code_hash !~ '[^0-9a-f]')),
  verify_expires_at timestamptz,
  verify_attempts integer not null default 0 constraint owner_line_enrollments_verify_attempts_check
    check (verify_attempts between 0 and 3),
  verify_window_started_at timestamptz,
  verify_starts integer not null default 0 constraint owner_line_enrollments_verify_starts_check
    check (verify_starts between 0 and 5),
  pin_hash text constraint owner_line_enrollments_pin_hash_check
    check (pin_hash is null or (char_length(pin_hash) = 80 and substr(pin_hash, 1, 14) = 'scrypt:17:8:1:'
           and substr(pin_hash, 15) !~ '[^A-Za-z0-9_:-]')),
  pin_set_at timestamptz,
  failed_attempts integer not null default 0 constraint owner_line_enrollments_failed_attempts_check
    check (failed_attempts between 0 and 2),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  constraint owner_line_enrollments_member_fkey foreign key (account_id, user_id)
    references public.memberships (account_id, user_id) on delete cascade,
  constraint owner_line_enrollments_one_per_member unique (account_id, user_id),
  constraint owner_line_enrollments_one_cell unique (account_id, e164),
  constraint owner_line_enrollments_pin_pair_check check ((pin_hash is null) = (pin_set_at is null)),
  constraint owner_line_enrollments_code_pair_check check ((verify_code_hash is null) = (verify_expires_at is null)),
  constraint owner_line_enrollments_pin_needs_cell_check check (pin_hash is null or verified_at is not null),
  constraint owner_line_enrollments_no_cell_check
    check (e164 is not null or (verified_at is null and verify_code_hash is null and pin_hash is null))
);
comment on table public.owner_line_enrollments is
  'F-032 (0115): a person''s registered cell and PIN for calling in to hear the day. Server-written and server-read only.';

alter table public.owner_line_enrollments enable row level security;
-- No policy: RLS on with none refuses every row to every role that does not bypass it, and the grants below
-- refuse anon and authenticated outright (0104's shape, SC-4).
revoke all on public.owner_line_enrollments from anon, authenticated, service_role;
grant select, insert, update, delete on public.owner_line_enrollments to service_role;

-- 2. The switch and its record: when, and what kind of person, never who (owner ruling 2026-11-09).
alter table public.accounts
  add column owner_line_enabled_at timestamptz,
  add column owner_line_changed_at timestamptz,
  add column owner_line_changed_by_kind text constraint accounts_owner_line_changed_by_kind_check
    check (owner_line_changed_by_kind in ('owner', 'agency')),
  add constraint accounts_owner_line_change_check
    check ((owner_line_changed_at is null) = (owner_line_changed_by_kind is null)),
  add constraint accounts_owner_line_agency_off_check
    check (owner_line_changed_by_kind is distinct from 'agency' or owner_line_enabled_at is null),
  add constraint accounts_owner_line_on_has_record_check
    check (owner_line_enabled_at is null or owner_line_changed_at is not null);
comment on column public.accounts.owner_line_enabled_at is
  'F-032 (0115): when the Owner let the team call in to hear the day; null = off (the default). Only the client''s Owner turns it on; the agency may turn it off (owner ruling Q-A).';
comment on column public.accounts.owner_line_changed_by_kind is
  'F-032 (0115): who last turned the switch on or off, as a kind only: owner (the client''s Owner) or agency (BIS). Never a person''s id (owner ruling 2026-11-09: every member reads accounts). BIS may only turn it off (accounts_owner_line_agency_off_check).';

-- The switch is never ON at birth (spec 3.3: the client's Owner decides), and no account is born carrying a record of
-- a change nobody made. authenticated holds a TABLE-level INSERT on accounts (schema-grants-guard.test.ts
-- EXPECTED_WRITES), so a column grant cannot express this; a trigger can, for every role, service_role's
-- createAccount included (it never sets these columns). It tests each of the three columns by name, so its own
-- refusal (this message, no constraint name) comes before any CHECK could refuse the same row.
create function app.owner_line_insert_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if new.owner_line_enabled_at is not null or new.owner_line_changed_at is not null
     or new.owner_line_changed_by_kind is not null then
    raise exception 'accounts: the owner line starts off; only the client''s Owner turns it on' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.owner_line_insert_guard() from public, anon, authenticated, service_role;
create trigger accounts_owner_line_insert_guard before insert on public.accounts
  for each row execute function app.owner_line_insert_guard();

-- The switch never moves without a fresh TIME on its record (review m-2). When owner_line_enabled_at changes, the same
-- UPDATE must move owner_line_changed_at to a new, non-null value; the pair CHECK then requires a who-kind, and the
-- agency-off CHECK holds BIS to off. An unchanged time or a cleared record is refused. Whether the who-kind is CURRENT
-- is the writer's job (review m-A; the header names the edges). A write that does not move the switch is not touched
-- (the WHEN clause), so every other accounts UPDATE costs nothing.
create function app.owner_line_switch_record_guard() returns trigger
language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
begin
  if new.owner_line_changed_at is null
     or new.owner_line_changed_at is not distinct from old.owner_line_changed_at then
    raise exception 'accounts: turning the owner line on or off must record when and who-kind' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function app.owner_line_switch_record_guard() from public, anon, authenticated, service_role;
create trigger accounts_owner_line_switch_record before update on public.accounts
  for each row when (old.owner_line_enabled_at is distinct from new.owner_line_enabled_at)
  execute function app.owner_line_switch_record_guard();

-- The ACCOUNT's local day (owner ruling Q-F): the first instant whose local date, in p_zone, is p_at's local date.
-- The local midnight, back to an instant; then two bounded corrections, 15 minutes at a time (no zone moves its
-- clocks by more than 2 hours, and every transition falls on a quarter hour):
--   forward, while that instant is still on the previous date (a defensive guard: PostgreSQL already reads a
--     midnight that does not exist, America/Santiago's 2026-09-06, as the instant the clocks jump);
--   back, while the instant 15 minutes earlier is still on this date (load-bearing: PostgreSQL reads a midnight that
--     happens TWICE, America/Havana's 2026-11-01, as the LATER one, an hour after the day began).
create function app.owner_line_day_start(p_zone text, p_at timestamptz) returns timestamptz
language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare v_day date; v_start timestamptz; i integer := 0;
begin
  if p_zone is null or p_at is null then
    raise exception 'owner_line_day_start: a required argument is null' using errcode = '22004';
  end if;
  v_day := (p_at at time zone p_zone)::date;
  v_start := (v_day::timestamp) at time zone p_zone;
  while (v_start at time zone p_zone)::date < v_day and i < 8 loop
    v_start := v_start + interval '15 minutes';
    i := i + 1;
  end loop;
  while ((v_start - interval '15 minutes') at time zone p_zone)::date = v_day and i < 16 loop
    v_start := v_start - interval '15 minutes';
    i := i + 1;
  end loop;
  return v_start;
end $$;
revoke all on function app.owner_line_day_start(text, timestamptz) from public, anon, authenticated, service_role;
grant execute on function app.owner_line_day_start(text, timestamptz) to service_role;

-- The call mark, and the read behind the 10-a-day limit.
alter table public.calls add column owner_line_user_id uuid;
comment on column public.calls.owner_line_user_id is
  'F-032 (0115): the person an owner-line call was for; null on every customer call. No FK: the mark outlives the user.';
create index calls_owner_line_idx on public.calls (account_id, owner_line_user_id, started_at desc)
  where owner_line_user_id is not null;

-- 3. The access log learns owner_line_call (SC-13). The kind list is 0112 section 6's, plus four (DRAFT note a).
alter table public.agency_visits drop constraint agency_visits_actor_kind_check;
alter table public.agency_visits add constraint agency_visits_actor_kind_check check (actor_kind in ('agency', 'owner_line'));
alter table public.agency_visits drop constraint agency_visits_reason_check;
alter table public.agency_visits add constraint agency_visits_reason_check
  check (reason in ('setup', 'support', 'fix', 'billing', 'owner_line_call'));
alter table public.agency_visits add constraint agency_visits_owner_line_check
  check ((actor_kind = 'owner_line') = (reason = 'owner_line_call'));
alter table public.agency_visit_items drop constraint agency_visit_items_kind_check;
alter table public.agency_visit_items add constraint agency_visit_items_kind_check check (kind in (
  'contact', 'group', 'call', 'conversation', 'document_view', 'document_download', 'document_share',
  'form_answers', 'customer_list_export', 'record_history_export',
  'owner_line_calls_and_messages', 'owner_line_appointments', 'owner_line_needs_attention', 'owner_line_lookup_customer'));
grant insert (actor_kind) on public.agency_visits to service_role;

-- note_agency_open: 0105's text with one guard (review m-3; DRAFT note g). An owner_line_ kind is
-- note_owner_line_call's alone; on an agency visit it would blank the BIS access section (parseVisit).
create or replace function public.note_agency_open(
  p_account_id uuid, p_actor text, p_session text, p_kind text, p_record_id uuid, p_item_count integer)
returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_visit uuid;
begin
  if p_account_id is null or p_actor is null or p_session is null or p_kind is null then
    raise exception 'note_agency_open: a required argument is null' using errcode = '22004';
  end if;
  if left(p_kind, 11) = 'owner_line_' then
    raise exception 'note_agency_open: owner_line_ kinds belong to note_owner_line_call' using errcode = '22023';
  end if;
  -- The live visit for THIS person, session and account: a caller can never name another visit.
  v_visit := public.agency_visit_live(p_account_id, p_actor, p_session);
  if v_visit is null then return 'no_visit'; end if;
  if p_kind = 'customer_list_export' then
    insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count)
    values (v_visit, p_account_id, p_kind, null, p_item_count);
  else
    insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count)
    values (v_visit, p_account_id, p_kind, p_record_id, null)
    on conflict (visit_id, kind, record_id) where record_id is not null do nothing;
  end if;
  return 'ok';
end $$;
revoke all on function public.note_agency_open(uuid, text, text, text, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.note_agency_open(uuid, text, text, text, uuid, integer) to service_role;

-- access_log_page: 0112's text with one change, actor_kind = 'agency' on the count and on the page.
create or replace function public.access_log_page(
  p_account_id uuid, p_before_started timestamptz, p_before_id uuid, p_limit integer)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare v_total bigint; v_visits jsonb;
begin
  if p_account_id is null or p_limit is null then
    raise exception 'access_log_page: a required argument is null' using errcode = '22004';
  end if;
  if p_limit < 1 or p_limit > 50 then
    raise exception 'access_log_page: p_limit must be 1 to 50' using errcode = '22023';
  end if;
  if (p_before_started is null) <> (p_before_id is null) then
    raise exception 'access_log_page: a cursor needs both halves' using errcode = '22023';
  end if;
  select count(*) into v_total from public.agency_visits v where v.account_id = p_account_id and v.actor_kind = 'agency';
  select coalesce(jsonb_agg(pg.visit order by pg.started_at desc, pg.id desc), '[]'::jsonb) into v_visits
  from (
    select v.id, v.started_at, jsonb_build_object(
      'id', v.id, 'actor_name', v.actor_name, 'reason', v.reason, 'started_at', v.started_at,
      'ended_at', (select max(i.first_opened_at) from public.agency_visit_items i where i.visit_id = v.id),
      'counts', (select jsonb_build_object(
          'contact', count(*) filter (where i.kind = 'contact'),
          'group', count(*) filter (where i.kind = 'group'),
          'call', count(*) filter (where i.kind = 'call'),
          'conversation', count(*) filter (where i.kind = 'conversation'),
          'file', count(distinct i.record_id) filter (where i.kind in ('document_view', 'document_download', 'document_share')),
          'form_answers', count(*) filter (where i.kind = 'form_answers'),
          'customer_list_export', count(*) filter (where i.kind = 'customer_list_export'),
          'record_history_export', count(*) filter (where i.kind = 'record_history_export'))
        from public.agency_visit_items i where i.visit_id = v.id),
      'item_total', (select count(*) from public.agency_visit_items i where i.visit_id = v.id),
      'items', (select coalesce(jsonb_agg(jsonb_build_object(
            'kind', x.kind, 'record_id', x.record_id, 'item_count', x.item_count, 'first_opened_at', x.first_opened_at)
            order by x.first_opened_at desc, x.id desc), '[]'::jsonb)
        from (select i.id, i.kind, i.record_id, i.item_count, i.first_opened_at
                from public.agency_visit_items i where i.visit_id = v.id
               order by i.first_opened_at desc, i.id desc limit 100) x)
    ) as visit
    from public.agency_visits v
    where v.account_id = p_account_id and v.actor_kind = 'agency'
      and (p_before_started is null or (v.started_at, v.id) < (p_before_started, p_before_id))
    order by v.started_at desc, v.id desc
    limit p_limit + 1
  ) pg;
  return jsonb_build_object('total', v_total, 'visits', v_visits);
end $$;
revoke all on function public.access_log_page(uuid, timestamptz, uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.access_log_page(uuid, timestamptz, uuid, integer) to authenticated;

-- 4. What the answer route does for this caller on this business. One unique-index read for a stranger.
create function public.owner_line_answer_lookup(
  p_account_id uuid, p_caller_e164 text, p_max integer)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare e public.owner_line_enrollments%rowtype; v_role text; v_name text; v_lang text; v_acct_lang text;
        v_open boolean; v_on timestamptz; v_zone text; v_count bigint; v_base jsonb;
begin
  if p_account_id is null or p_caller_e164 is null or p_max is null then
    raise exception 'owner_line_answer_lookup: a required argument is null' using errcode = '22004';
  end if;
  select * into e from public.owner_line_enrollments where account_id = p_account_id and e164 = p_caller_e164;
  if not found then return jsonb_build_object('status', 'none'); end if;
  select m.role into v_role from public.memberships m
   where m.scope = 'account' and m.account_id = e.account_id and m.user_id = e.user_id;
  if not coalesce(v_role in ('owner', 'staff', 'technician'), false) then return jsonb_build_object('status', 'none'); end if;
  select coalesce(a.client_access_enabled, false) and a.status <> 'archived', a.owner_line_enabled_at, a.language, a.timezone
    into v_open, v_on, v_acct_lang, v_zone from public.accounts a where a.id = e.account_id;
  if not coalesce(v_open, false) then return jsonb_build_object('status', 'none'); end if;
  select u.name, u.language into v_name, v_lang from public.users u where u.id = e.user_id;
  v_base := jsonb_build_object('enrollment_id', e.id, 'user_id', e.user_id, 'role', v_role, 'name', v_name,
    'language', v_lang, 'account_language', v_acct_lang);
  if e.verified_at is null then
    if e.verify_code_hash is not null and e.verify_expires_at > now() and e.verify_attempts < 3 then
      return v_base || jsonb_build_object('status', 'verify');
    end if;
    return jsonb_build_object('status', 'none');
  end if;
  if e.pin_hash is null then return jsonb_build_object('status', 'none'); end if;
  if v_on is null then return jsonb_build_object('status', 'off'); end if;
  if e.locked_until is not null and e.locked_until > now() then return jsonb_build_object('status', 'locked'); end if;
  select count(*) into v_count from public.calls c
   where c.account_id = e.account_id and c.owner_line_user_id = e.user_id
     and c.started_at >= app.owner_line_day_start(v_zone, now());
  if v_count >= p_max then return v_base || jsonb_build_object('status', 'over_limit'); end if;
  return v_base || jsonb_build_object('status', 'pin', 'pin_params', substr(e.pin_hash, 1, 36));
end $$;

-- 5. (Re)start a call-in code. A new cell clears the verification, the PIN, the counter and the lock. Answers 'ok',
--    'taken' (another person on this business holds the cell: verified, or with a live code) or 'too_many' (this
--    person has started five codes on this business in the last 24 hours; nothing is stored). A lapsed or spent
--    unverified claim on the cell is displaced first (review I-2). One cell at a time on one business: the advisory
--    lock below serializes two claims racing for the same cell, so only one of them can displace.
create function public.owner_line_start_verification(
  p_account_id uuid, p_user_id uuid, p_e164 text, p_code_hash text, p_minutes integer)
returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare mine public.owner_line_enrollments%rowtype; holder public.owner_line_enrollments%rowtype;
        v_fresh boolean;
begin
  if p_account_id is null or p_user_id is null or p_e164 is null or p_code_hash is null or p_minutes is null then
    raise exception 'owner_line_start_verification: a required argument is null' using errcode = '22004';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('owner_line_cell|' || p_account_id::text || '|' || p_e164, 0));
  select * into mine from public.owner_line_enrollments
   where account_id = p_account_id and user_id = p_user_id for update;
  v_fresh := not found or mine.verify_window_started_at is null
    or mine.verify_window_started_at <= now() - interval '24 hours';
  if not v_fresh and mine.verify_starts >= 5 then return 'too_many'; end if;
  select * into holder from public.owner_line_enrollments
   where account_id = p_account_id and e164 = p_e164 and user_id <> p_user_id for update;
  if found then
    if holder.verified_at is not null
       or (holder.verify_code_hash is not null and holder.verify_expires_at > now() and holder.verify_attempts < 3) then
      return 'taken';
    end if;
    update public.owner_line_enrollments
       set e164 = null, verified_at = null, verify_code_hash = null, verify_expires_at = null, verify_attempts = 0,
           pin_hash = null, pin_set_at = null, failed_attempts = 0, locked_until = null
     where id = holder.id;
  end if;
  begin
    insert into public.owner_line_enrollments as e
      (account_id, user_id, e164, verify_code_hash, verify_expires_at, verify_window_started_at, verify_starts)
    values (p_account_id, p_user_id, p_e164, p_code_hash, now() + make_interval(mins => p_minutes), now(), 1)
    on conflict (account_id, user_id) do update
       set e164 = excluded.e164,
           verify_code_hash = excluded.verify_code_hash,
           verify_expires_at = excluded.verify_expires_at,
           verify_attempts = 0,
           verified_at = case when e.e164 = excluded.e164 then e.verified_at end,
           pin_hash = case when e.e164 = excluded.e164 then e.pin_hash end,
           pin_set_at = case when e.e164 = excluded.e164 then e.pin_set_at end,
           failed_attempts = case when e.e164 = excluded.e164 then e.failed_attempts else 0 end,
           locked_until = case when e.e164 = excluded.e164 then e.locked_until end,
           verify_window_started_at = case when v_fresh then now() else e.verify_window_started_at end,
           verify_starts = case when v_fresh then 1 else e.verify_starts + 1 end;
  exception when unique_violation then
    return 'taken';
  end;
  return 'ok';
end $$;

-- 6. One call-in code attempt, under the row lock.
create function public.owner_line_attempt_verify(p_account_id uuid, p_caller_e164 text, p_code_hash text)
returns text language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare e public.owner_line_enrollments%rowtype;
begin
  if p_account_id is null or p_caller_e164 is null or p_code_hash is null then
    raise exception 'owner_line_attempt_verify: a required argument is null' using errcode = '22004';
  end if;
  select * into e from public.owner_line_enrollments
   where account_id = p_account_id and e164 = p_caller_e164 for update;
  if not found or e.verified_at is not null or e.verify_code_hash is null then return 'none'; end if;
  if e.verify_expires_at <= now() or e.verify_attempts >= 3 then
    update public.owner_line_enrollments set verify_code_hash = null, verify_expires_at = null where id = e.id;
    return 'spent';
  end if;
  if e.verify_code_hash = p_code_hash then
    update public.owner_line_enrollments
       set verified_at = now(), verify_code_hash = null, verify_expires_at = null, verify_attempts = 0
     where id = e.id;
    return 'verified';
  end if;
  if e.verify_attempts + 1 >= 3 then
    update public.owner_line_enrollments
       set verify_attempts = 3, verify_code_hash = null, verify_expires_at = null where id = e.id;
    return 'spent';
  end if;
  update public.owner_line_enrollments set verify_attempts = e.verify_attempts + 1 where id = e.id;
  return 'wrong';
end $$;

-- 7. One PIN attempt, under the row lock. Owns the counter (per enrollment, so a redial never resets it) and the lock.
create function public.owner_line_attempt_pin(p_enrollment_id uuid, p_candidate text, p_lock_minutes integer)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare e public.owner_line_enrollments%rowtype; v_until timestamptz;
begin
  if p_enrollment_id is null or p_candidate is null or p_lock_minutes is null then
    raise exception 'owner_line_attempt_pin: a required argument is null' using errcode = '22004';
  end if;
  select * into e from public.owner_line_enrollments where id = p_enrollment_id for update;
  if not found or e.verified_at is null or e.pin_hash is null then return jsonb_build_object('status', 'none'); end if;
  if e.locked_until is not null and e.locked_until > now() then
    return jsonb_build_object('status', 'locked', 'locked_until', e.locked_until);
  end if;
  if e.pin_hash = p_candidate then
    update public.owner_line_enrollments set failed_attempts = 0, locked_until = null where id = e.id;
    return jsonb_build_object('status', 'ok');
  end if;
  if e.failed_attempts + 1 >= 3 then
    update public.owner_line_enrollments
       set failed_attempts = 0, locked_until = now() + make_interval(mins => p_lock_minutes)
     where id = e.id returning locked_until into v_until;
    return jsonb_build_object('status', 'locked_now', 'locked_until', v_until);
  end if;
  update public.owner_line_enrollments set failed_attempts = e.failed_attempts + 1 where id = e.id;
  return jsonb_build_object('status', 'wrong', 'failed_attempts', e.failed_attempts + 1);
end $$;

-- 8. The live re-read: the SIP webhook (with p_max) and every owner tool call (p_max null). The day is the account's (Q-F).
create function public.owner_line_session_check(
  p_account_id uuid, p_user_id uuid, p_role text, p_max integer)
returns jsonb language plpgsql stable security invoker set search_path = pg_catalog, pg_temp as $$
declare e public.owner_line_enrollments%rowtype; v_role text; v_open boolean; v_on timestamptz; v_org text;
        v_zone text; v_acct_lang text; v_name text; v_lang text; v_clerk text; v_count bigint;
begin
  if p_account_id is null or p_user_id is null or p_role is null then
    raise exception 'owner_line_session_check: a required argument is null' using errcode = '22004';
  end if;
  select m.role into v_role from public.memberships m
   where m.scope = 'account' and m.account_id = p_account_id and m.user_id = p_user_id;
  if v_role is null then return jsonb_build_object('ok', false, 'reason', 'not_a_member'); end if;
  if v_role is distinct from p_role then return jsonb_build_object('ok', false, 'reason', 'role_changed'); end if;
  select coalesce(a.client_access_enabled, false) and a.status <> 'archived', a.owner_line_enabled_at, a.clerk_org_id,
         a.timezone, a.language
    into v_open, v_on, v_org, v_zone, v_acct_lang from public.accounts a where a.id = p_account_id;
  if not coalesce(v_open, false) then return jsonb_build_object('ok', false, 'reason', 'no_client_access'); end if;
  if v_on is null then return jsonb_build_object('ok', false, 'reason', 'switch_off'); end if;
  select * into e from public.owner_line_enrollments where account_id = p_account_id and user_id = p_user_id;
  if not found or e.verified_at is null or e.pin_hash is null then
    return jsonb_build_object('ok', false, 'reason', 'not_enrolled');
  end if;
  if e.locked_until is not null and e.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  if p_max is not null then
    select count(*) into v_count from public.calls c
     where c.account_id = p_account_id and c.owner_line_user_id = p_user_id
       and c.started_at >= app.owner_line_day_start(v_zone, now());
    if v_count >= p_max then return jsonb_build_object('ok', false, 'reason', 'over_limit'); end if;
  end if;
  select u.name, u.language, u.clerk_user_id into v_name, v_lang, v_clerk from public.users u where u.id = p_user_id;
  return jsonb_build_object('ok', true, 'name', v_name, 'language', v_lang, 'clerk_user_id', v_clerk,
    'clerk_org_id', v_org, 'timezone', v_zone, 'account_language', v_acct_lang);
end $$;

-- 9. The access-log entry for one owner-line call: one visit, one item per tool that ran (duplicates folded).
create function public.note_owner_line_call(
  p_account_id uuid, p_call_id uuid, p_actor text, p_actor_name text, p_kinds text[])
returns uuid language plpgsql security invoker set search_path = pg_catalog, pg_temp as $$
declare v_visit uuid;
begin
  if p_account_id is null or p_call_id is null or p_actor is null or p_kinds is null then
    raise exception 'note_owner_line_call: a required argument is null' using errcode = '22004';
  end if;
  if exists (select 1 from unnest(p_kinds) k where k is null or left(k, 11) <> 'owner_line_') then
    raise exception 'note_owner_line_call: only owner_line_ kinds' using errcode = '22023';
  end if;
  insert into public.agency_visits (account_id, actor_kind, actor_clerk_user_id, actor_name, clerk_session_id, reason)
  values (p_account_id, 'owner_line', p_actor, nullif(pg_catalog.btrim(p_actor_name), ''), 'call:' || p_call_id::text,
          'owner_line_call')
  returning id into v_visit;
  insert into public.agency_visit_items (visit_id, account_id, kind, record_id, item_count)
  select v_visit, p_account_id, k, p_call_id, null from (select distinct unnest(p_kinds) as k) x;
  return v_visit;
end $$;

-- 10. Function privileges: everything revoked by name (0043's lesson), then EXECUTE to service_role.
revoke all on function public.owner_line_answer_lookup(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.owner_line_start_verification(uuid, uuid, text, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.owner_line_attempt_verify(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.owner_line_attempt_pin(uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.owner_line_session_check(uuid, uuid, text, integer) from public, anon, authenticated, service_role;
revoke all on function public.note_owner_line_call(uuid, uuid, text, text, text[]) from public, anon, authenticated, service_role;
grant execute on function public.owner_line_answer_lookup(uuid, text, integer) to service_role;
grant execute on function public.owner_line_start_verification(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.owner_line_attempt_verify(uuid, text, text) to service_role;
grant execute on function public.owner_line_attempt_pin(uuid, text, integer) to service_role;
grant execute on function public.owner_line_session_check(uuid, uuid, text, integer) to service_role;
grant execute on function public.note_owner_line_call(uuid, uuid, text, text, text[]) to service_role;
```

- [ ] **Step 5: Check the file's text against the repo rules.** Use a node byte check, never `grep -P` in Git Bash (the replica memory's gotcha):

  ```bash
  node -e "const b=require('fs').readFileSync('packages/db/supabase/migrations/0115_owner_line.sql');let bad=0;for(const x of b){if(x>127||x===92)bad++}const t=b.toString();const d=(t.match(/[$]/g)||[]).length;const q=(t.match(/[$][$]/g)||[]).length*2;console.log('non-ascii-or-backslash',bad,'stray-dollars',d-q)"
  ```

  Expected: `non-ascii-or-backslash 0 stray-dollars 0`. As a positive control, run the same command on a temporary copy with an `é` added, and expect `1`.

- [ ] **Step 6: Update the one existing test 0115 deliberately changes, then apply to the replica's `post` database and run green.**

  `packages/db/src/test/access-log-schema.test.ts:105-120` pins EXACTLY ten service_role INSERT columns across `agency_visits` and `agency_visit_items`. `grant insert (actor_kind)` makes eleven, so that case would fail, and correctly so. Update it on purpose:
  - Rename it to "column INSERT: service_role on exactly these eleven columns, actor_kind since 0115 (the owner line's entry)…".
  - Add `"agency_visits.actor_kind"` to its expected list, in sorted position: after `"agency_visits.account_id"`.
  - Add to its name the probe `revoke insert (actor_kind) on public.agency_visits from service_role -> FAILS`.

  Any other pin in that file that 0115 moves (a kind or reason CHECK listing) is updated the same way, named in the report, never loosened.

  ```bash
  # Apply the way the Supabase CLI does: ONE extended-protocol pipeline, one Sync, no transaction block (memory
  # bis-local-db-replica, 2026-11-06). psql -1 -f is a transaction block, so it hides a bare LOCK; and psql in pipeline
  # mode exits 0 even on an ERROR, so judge the apply by its output, never its exit code.
  python pipeline.py packages/db/supabase/migrations/0115_owner_line.sql 0115.pipe.psql
  psql -h localhost -p <your port> -U postgres -d post -v ON_ERROR_STOP=1 -f 0115.pipe.psql   # then: no ERROR line
  cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55433/post pnpm exec vitest run src/test/owner-line-schema.test.ts src/test/definer-search-path.test.ts src/test/schema-grants-guard.test.ts src/test/access-log-schema.test.ts
  ```

  Expected: every case passes.
  - `definer-search-path` and `schema-grants-guard` stay green UNCHANGED: SC-3's "EXPECTED_DEFINERS unchanged", and "no client grant moves", measured.
  - `access-log-schema` is green with the one deliberate edit above.

  Paste the summary line. Then run the access-log case against `pre` with the edit in place, and paste its FAIL line: the eleventh column is absent there, so it must fail.

- [ ] **Step 6b: Lock-order proof with a live writer, on the replica (I-2; 0114's method).** Prove the children-first order cannot deadlock a call being written, and that the parents-first order can. Run this twice against a fresh copy of `pre` (`createdb -T pre lockproof`):
  - **(a) As written.** Session B holds a live call insert open:

    ```bash
    psql -d lockproof -c "begin; insert into calls (account_id, phone_number_id) select p.account_id, p.id from phone_numbers p limit 1; select pg_sleep(3); commit;" &
    ```

    Then, within a second, apply the file in session A with `-v ON_ERROR_STOP=1 -1 -f`. **Expected:** A waits about 3 s, then succeeds. B commits. There is no 40P01 in either log.
  - **(b) The reverse.** Edit a scratch copy so section 0 locks `accounts` first, then `select pg_sleep(2)`, then the rest. Start A first. During its sleep, start B's insert WITHOUT the sleep. **Expected:** one of them fails `40P01 deadlock detected`. That is the failure (a) avoids.

  Seed `lockproof` with one account and one phone number first, if `pre` has none. Paste both outcomes into the report. If (b) does NOT deadlock on PG18, say so: the proof then rests on (a) plus 0114's recorded 40P01 on PG 17.6.

- [ ] **Step 7: Mutation probes (HIGH).** Apply each mutation straight to `post` (`create or replace`, or `alter`), run the named case, see it FAIL BY NAME, then reset `post` (`dropdb post; createdb -T pre post`, then re-apply):
  1. `grant select (pin_hash) on public.owner_line_enrollments to authenticated` → "no column privilege … pin_hash is never readable" FAILS.
  2. In `owner_line_attempt_pin`, change `e.failed_attempts + 1 >= 3` to `>= 4` → "the third wrong PIN locks" FAILS.
  3. In `owner_line_session_check`, delete the `role_changed` line → "refuses a removed person and a changed role" FAILS.
  4. `alter function public.owner_line_attempt_pin(uuid, text, integer) security definer` → "all seven run as their CALLER" FAILS.
  5. In `access_log_page`, drop `and v.actor_kind = 'agency'` from the count → "note_owner_line_call writes one owner_line visit" FAILS.
  6. `create or replace` `app.owner_line_day_start` to `return date_trunc('day', p_at);` → the America/Chicago day-start case FAILS. Delete its two `while` loops → **the America/Santiago case CANNOT fail on PostgreSQL** (measured 2026-11-09: PostgreSQL already reads that missing midnight as the jump, 04:00Z), so it is kept as a pinned value and claims no probe; the America/Havana case (a midnight that happens twice, which PostgreSQL reads as the later one) carries the step-back loop's probe and FAILS. Deleting only the forward loop fails nothing: it is a guard no case can reach.
  7. `drop trigger accounts_owner_line_insert_guard on public.accounts` → "no account can be CREATED with the switch on" FAILS.
  8. In `owner_line_answer_lookup`, count from `date_trunc('day', now())` (UTC) instead of `app.owner_line_day_start(v_zone, now())` → "the daily limit counts this account-local day only" FAILS, because the ten calls one minute before Chicago midnight fall after UTC midnight. The exception is 00:00-06:00 UTC, when the Chicago date is still the previous one and the mutation survives. Run this probe outside those hours, and say when it ran.
  9. **CHECK-free variants (review m-8).** Probe 2 also trips `owner_line_enrollments_failed_attempts_check` (0..2), so on its own it cannot tell the function's logic from the CHECK. Run it clamped as well: `>= 4` AND `failed_attempts = least(e.failed_attempts + 1, 2)` in both the update and the returned value → "the third wrong PIN locks" FAILS (`expected 'wrong' to be 'locked_now'`). Likewise "keep pin_hash on a new e164" trips `pin_needs_cell_check`; run it as keep the PIN AND the verification (`verified_at = e.verified_at, pin_hash = e.pin_hash, pin_set_at = e.pin_set_at`) → "changing the cell clears the verification and the PIN" FAILS on the values.
  10. **Business scope (review I-1).** Drop the account filter from each read, one at a time: t1 the lookup's enrollment read, t2 the lookup's count, t3 `attempt_verify`'s read, t4 `session_check`'s enrollment read, t5 `session_check`'s count → each one's second-business case FAILS.
  11. **Every refusal by name (review I-2).** Delete, one at a time: u1 `no_client_access`, u2 `switch_off`, u3 the `not_enrolled` branch, u4 `locked`, u5 the `over_limit` block (all `session_check`), u6 the lookup's client-access/archived gate, u7 the lookup's no-PIN line → each one's case FAILS by its reason.
  12. **The switch record (review m-2).** Drop trigger `accounts_owner_line_switch_record` → "turning it on with no record" FAILS; drop its `is not distinct from old` test → "over a stale 'owner' record" FAILS; drop its `is null` test → "while clearing the record" FAILS; drop its WHEN clause → "a write that does not move the switch" FAILS.
  13. **The insert guard, one column at a time** (each case sets ONE guarded column, so a CHECK cannot refuse it in the guard's place): drop `owner_line_enabled_at`, `owner_line_changed_at` or `owner_line_changed_by_kind` from the guard → that column's case FAILS. Drop `accounts_owner_line_agency_off_check` → "BIS's last word can only be OFF" FAILS. Add a person-id column (`owner_line_changed_by_user text`) → "exactly three owner_line columns" FAILS.
  14. **note_agency_open (review m-3).** Delete its `owner_line_` guard → "an agency note with an owner_line_ kind is refused" FAILS.
  15. **An ON switch keeps its record (re-review m-B).** Drop `accounts_owner_line_on_has_record_check` → "clearing the record while the switch is on is refused" FAILS. The reset case beside it (off with a fresh record, then the record cleared) stays green, so Task 15's two-write cleanup still works.
  16. **Teardown (Task 2 review m-2).** Remove `"owner_line_enrollments"` from `ACCOUNT_OWNED_TABLES` → "owner_line_enrollments is on ACCOUNT_OWNED_TABLES" FAILS.
  17. **A lapsed claim never holds a cell (Task 5 review I-2).** Never displace → the expired, spent and cap-survives cases FAIL; displace only an EXPIRED code → "a spent claim" FAILS; displace a live code → "a live code is not displaced" and the older "second person" case FAIL; displace a verified holder → "a verified holder is never displaced" FAILS; drop `account_id` from the holder read → "another business's claim never displaces" FAILS; drop the cap → the sixth start trips `verify_starts_check`, and with that CHECK widened (the CHECK-free variant) the sixth answers `ok` → "five starts" FAILS; reset the count on displacement → "clearing a cell never resets" FAILS; never reopen the window within 48 hours → "five starts" FAILS; drop `owner_line_enrollments_no_cell_check` → its case FAILS. The holder check answers `taken` before anything is written, so dropping `owner_line_enrollments_one_cell` no longer fails the old "second person" case: a table-level case now pins that key, and that case FAILS instead. The `verify_attempts < 3` clause in the holder check is a guard no case can reach: `owner_line_attempt_verify` clears the code on the third wrong one.
  18. **The wrappers (Task 5 review m-1, I-2), live:** `setOwnerLinePin` without its verified-only filter → the CHECK throws, "is not verified answers false" FAILS; `removeOwnerLineEnrollment` deleting the row → "five starts a day" FAILS (`ok` where `too_many` was due); `startOwnerLineVerification` dropping `too_many` → FAILS ("unexpected answer"); `readMyOwnerLineEnrollment` without its `e164` filter → FAILS (a cleared row reads as an enrollment).

  Paste each FAIL line.

- [ ] **Step 8: Commit.**

  ```bash
  git add packages/db/supabase/migrations/0115_owner_line.sql packages/db/src/test/owner-line-schema.test.ts packages/db/src/test/access-log-schema.test.ts
  git commit -m "feat(db): 0115 owner line: enrollments with a call-in code and an scrypt PIN, the business switch with who changed it, the owner-line call mark, the account-local day, and its access-log entry"
  ```

  Do not apply the migration anywhere else (O-2).

---

## Task 2: DB wrappers, counting exclusions, `startCallRow` and `listCalls` (HIGH, 0.75 day)

**Files:**
- Create: `packages/db/src/owner-line.ts`, `packages/db/src/test/owner-line-counting.test.ts`
- Modify: `packages/db/src/voice.ts`:
  - `:347-373` `startCallRow`;
  - `:957-966` `countCallsSince`;
  - `:976-986` `countAnsweredCallsSince`;
  - `:1010-1019` `countCallsByCallerSince`;
  - `:1134-1158` `listCallStartsByOutcomeBetween`;
  - `:1209-1259` `CallListRow`, `CALL_LIST_COLS` and `listCalls`.
- Modify: `packages/db/src/index.ts` (add an `export * from "./owner-line"` line beside its neighbours, touching no other line).
- Modify: `packages/db/src/account-teardown.ts:28-35` (add `"owner_line_enrollments"` beside `"calendar_feeds"`).
- Modify: `ACCT/dashboard/page.tsx:171`, and its `page.test.ts` (one case: the recent calls ask for `excludeOwnerLine: true`, the only test that can see the page pass it).
- Modify, because `CallListRow` gains a REQUIRED `owner_line_user_id` (found by the web typecheck, 2026-11-09): six fixtures gain `owner_line_user_id: null`, one line each: `ACCT/calls/[callId]/page.test.ts`, `ACCT/calls/calls-table.test.ts`, `ACCT/calls/page.test.ts`, `ACCT/calls/textback-window.test.ts`, `ACCT/dashboard/calls-chart-card.test.ts`, `ACCT/voice/knowledge/[version]/page.test.ts`. Optional would hide a missing select column from every later reader.
- Create: `packages/db/src/test/owner-line-wrappers.test.ts` (pure, a scripted builder; Task 2 review m-3): `setOwnerLineSwitch` answers a real change from the UPDATE's own row in one round trip, re-reads only on a no-op, and throws for a missing account.
- Modify: `packages/db/src/test/call-outcome-starts-pagination.test.ts`: its fake builder learns `.is` (column-aware, like its siblings), plus one case that pins the owner-line filter on EVERY page without a database.

**Interfaces:**
- Consumes: the Task 1 SQL.
- Produces (exact names; every later task uses these):

```ts
// packages/db/src/owner-line.ts
export const OWNER_LINE_MAX_CALLS_PER_DAY = 10;
export const OWNER_LINE_LOCK_MINUTES = 30;
export const OWNER_LINE_VERIFY_MINUTES = 10;
export const OWNER_LINE_LOG_KINDS = ["owner_line_calls_and_messages", "owner_line_appointments",
  "owner_line_needs_attention", "owner_line_lookup_customer"] as const;
export type OwnerLineLogKind = (typeof OWNER_LINE_LOG_KINDS)[number];
export type OwnerLineEnrollment = { id: string; e164: string; verifiedAt: string | null; verifyExpiresAt: string | null;
  pinSetAt: string | null; lockedUntil: string | null };
export type OwnerLineLookup =
  | { status: "none" | "off" | "locked" }
  | { status: "verify" | "pin" | "over_limit"; enrollmentId: string; userId: string; role: AccountRole;
      name: string | null; language: "en" | "es" | null; accountLanguage: "en" | "es" | null; pinParams: string | null };
export type OwnerLineSessionFacts = { name: string | null; language: "en" | "es" | null; clerkUserId: string;
  clerkOrgId: string; timezone: string; accountLanguage: "en" | "es" | null };
export async function readMyOwnerLineEnrollment(db, accountId, userId): Promise<OwnerLineEnrollment | null>;
export async function startOwnerLineVerification(db, accountId, userId, e164, codeHash): Promise<"ok" | "taken" | "too_many">;   // too_many stores NOTHING: never show a code (I-2)
export async function attemptOwnerLineVerify(db, accountId, callerE164, codeHash): Promise<"verified" | "wrong" | "spent" | "none">;
export async function setOwnerLinePin(db, accountId, userId, pinHash): Promise<boolean>;
export async function removeOwnerLinePin(db, accountId, userId): Promise<void>;
export async function removeOwnerLineEnrollment(db, accountId, userId): Promise<void>;
export async function ownerLineAnswerLookup(db, accountId, callerE164, max): Promise<OwnerLineLookup>;   // the account-local day is SQL's (Q-F)
export type OwnerLinePinResult = { status: "ok" | "wrong" | "none" } | { status: "locked_now" | "locked"; lockedUntil: string };
export async function attemptOwnerLinePin(db, enrollmentId, candidate): Promise<OwnerLinePinResult>;
export async function ownerLineSessionCheck(db, p: { accountId: string; userId: string; role: AccountRole;
  maxCalls: number | null }): Promise<({ ok: true } & OwnerLineSessionFacts) | { ok: false; reason: string }>;
export async function noteOwnerLineCall(db, p: { accountId: string; callId: string; actorClerkUserId: string;
  actorName: string | null; kinds: readonly OwnerLineLogKind[] }): Promise<void>;
export async function readOwnerLineCallLog(db, accountId, callId): Promise<OwnerLineLogKind[]>;
export type OwnerLineSwitchKind = "owner" | "agency";
export type OwnerLineSwitchState = { enabledAt: string | null; changedAt: string | null; changedByKind: OwnerLineSwitchKind | null };
export async function readOwnerLineSwitch(db, accountId): Promise<OwnerLineSwitchState>;
export async function setOwnerLineSwitch(db, accountId, on: boolean, by: OwnerLineSwitchKind): Promise<{ changed: boolean; state: OwnerLineSwitchState }>;   // throws on agency ON; a no-op writes nothing (m-E)
```

`voice.ts` gains the following. `startCallRow`'s input gains `ownerLineUserId?: string`. `CallListRow` gains `owner_line_user_id: string | null`. `listCalls`' opts gain `excludeOwnerLine?: boolean`. These four functions each gain `.is("owner_line_user_id", null)`:
- `countCallsSince`
- `countAnsweredCallsSince`
- `countCallsByCallerSince`
- `listCallStartsByOutcomeBetween`

**Every reader of `calls` that counts, and what it does about owner-line rows.** This is the whole inventory: `grep -rn 'from("calls")'` over `packages/db/src` and `apps/web/src`, plus every caller of each helper.

| Reader (file:line) | Feeds | Change |
|---|---|---|
| `DB/voice.ts:957` `countCallsSince` | caps (`texml/route.ts:338`, `incoming/route.ts:1041`), Calls page meter (`ACCT/calls/page.tsx:72`) | **exclude** (SC-9) |
| `DB/voice.ts:1010` `countCallsByCallerSince` | per-number cap (`texml/route.ts:339`, `incoming/route.ts:1042`) | **exclude** (SC-9) |
| `DB/voice.ts:976` `countAnsweredCallsSince` | setup wizard "Test call" step (`WEB/lib/setup/setup-inputs.ts:118`) | **exclude** |
| `DB/voice.ts:1134` `listCallStartsByOutcomeBetween` | `WEB/lib/reports/weekly-metrics.ts:86,111,134,149`. Through it: the dashboard tiles and conversion (`ACCT/dashboard/page.tsx:158,168,204,205`), the weekly report and the agency roll-up (`weekly-metrics.ts:169-170`), and the AI-presence count (`WEB/lib/voice/presence.ts:58`) | **exclude** (the one choke point) |
| `DB/voice.ts:1248` `listCalls` | Calls list (a record: rows stay, labelled in Task 13), dashboard "recent calls" (`ACCT/dashboard/page.tsx:171`) | **dashboard passes `excludeOwnerLine: true`**. Basis: spec §6 (an owner-line call is excluded from the dashboard tiles) and SC-9 (it is not a customer's call). NOT Q-E, which is about the answered count `calls_and_messages` shares with the tile |
| `DB/voice.ts:389` `getDisclosureResults` | S-47a results card | none: it counts only calls stamped `trial`, and owner-line rows are never stamped (a test could not fail, so none is written) |
| `DB/voice.ts:999` `hasActiveCallSince` | the topbar pulse "on a call" | none: Sofía IS on a call; the spec excludes only the *count* |
| `DB/voice.ts:1058` `countCallerHistorySince` | Guard 2 and the press-1 screen | none: an owner-line row reads as `otherCalls`, which only ever unblocks |
| `DB/automation-log.ts:236` `callsHandled` | the Activity usage card | none: the owner-line finish writes no `automation_log` row (pinned in Task 12) |
| `WEB/lib/voice/finish-call.ts:990` `voice_minutes` | billing | the owner-line finish records `voice_minutes` too: "its minutes appear in usage" (Q-B) |
| `DB/work-queue.ts:128`, `ACCT/tasks/page.tsx:149`, `WEB/lib/proposals/view-reads.ts:92`, `WEB/lib/access-log/names.ts:58` | reads by call id from tasks, conversations and proposals | none: an owner-line call has no task, conversation or proposal |
| `DB/voice.ts:1282` `listContactCalls` | record timeline | none: `contact_id` is null on an owner-line row, so there is no timeline row (§6) |
| `DB/voice.ts:1347` `callerInTouchSince` (re-grep, 2026-11-09) | the held text-back's "has the caller been back in touch" | none: an owner-line call from that number IS the caller back in touch, and only cancels a text-back to a cell that is on the team |
| `DB/voice.ts:1322` `searchCalls` (re-grep) | ⌘K search | none: the Calls list is a record and keeps owner-line calls; search finds what the list shows |
| `DB/voice.ts` `getCall`, `getCallByHandoffToken`, `getCallCard`, `listCallReasons`, the writers (`markHandoffRequested`, `setCallOutcome`, `setTransferAnsweredBy`, `finishCallRow`, `setCallCard`, `deleteCallRow`) (re-grep) | reads by id, or writes | none: not counters. `getCall` and `searchCalls` now carry `owner_line_user_id` through `CALL_LIST_COLS`, which Task 13 reads |
| SQL functions that read `calls` (0064, 0068, 0088, 0091, 0092, 0103, 0106, 0112) (re-grep) | contact links, merges, RLS, AI acts | none: none of them counts calls; an owner-line row has no `contact_id` |
| `usage_events` meters `voice_minutes`, `sms`, `ai_chats` (`DB/billing.ts:13`) (re-grep) | billing | none: there is no per-answered-call meter; owner-line minutes stay on `voice_minutes` (Q-B) |

- [ ] **Step 1: Write the failing counting test** (it uses `withTestAccount`, read from `packages/db/src/test/fixtures.ts:140`). **The block below is the committed file** (10 cases; the Task 5 review added a PIN on an unverified cell answering false (m-1) and the restart cap surviving a removed cell (I-2): the four counting cases, one live round trip through every wrapper that also pins the ten-a-day limit through both wrappers (Task 2 review I-1), a lock case, re-review m-E's no-op case, and the Task 2 review m-3 missing-account case). It runs in CI `verify`, and locally against a PostgREST in front of the PG18 replica (2026-11-09: PostgREST 14.14 on its own port, a `/rest/v1` proxy, keys signed with a local-only secret, no `.env` in the worktree); never against bis-ci before 0115 is there.

```ts
// packages/db/src/test/owner-line-counting.test.ts
import { describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  assignPhoneNumber, startCallRow, finishCallRow, countCallsSince, countCallsByCallerSince, countAnsweredCallsSince,
  listCallStartsByOutcomeBetween, listCalls,
  readMyOwnerLineEnrollment, startOwnerLineVerification, attemptOwnerLineVerify, setOwnerLinePin, removeOwnerLinePin,
  removeOwnerLineEnrollment, ownerLineAnswerLookup, attemptOwnerLinePin, ownerLineSessionCheck, noteOwnerLineCall,
  readOwnerLineCallLog, readOwnerLineSwitch, setOwnerLineSwitch, OWNER_LINE_MAX_CALLS_PER_DAY,
} from "../index";
import { withTestAccount, testPhoneNumber } from "./fixtures";

/**
 * F-032 §6 / SC-9 / owner rulings Q-B, Q-C, Q-E: an owner-line call moves none of the counted customer numbers.
 * withTestAccount writes through serviceDb (PostgREST): CI verify runs it on its own stack, and a local run needs a
 * PostgREST in front of a replica holding 0115. NEVER run it against bis-ci before 0115 is there.
 */
const FROM = "2000-01-01T00:00:00.000Z";
const TO = "2999-01-01T00:00:00.000Z";
const CELL = "+19565550142";

/**
 * Two customer calls (a lead, an abandoned one) and two owner-line calls. One owner-line call is finished as
 * `message`, an ANSWERED outcome, ON PURPOSE: the real owner-line finish writes `abandoned`, which no answered reader
 * would count anyway, so only an answered outcome makes each exclusion below able to fail (review minor finding).
 */
async function seedCalls(db: SupabaseClient, accountId: string) {
  const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
  const done = { endedAt: new Date(), durationSecs: 60, turnCount: 2, transcript: [], summary: "", language: "en" as const };
  const row = async (callerE164: string, outcome: "lead" | "abandoned" | "message", owner: boolean) => {
    const r = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164, ...(owner ? { ownerLineUserId: randomUUID() } : {}) });
    await finishCallRow(db, accountId, r.id, { ...done, outcome });
    return r.id;
  };
  await row("+19565550177", "lead", false);
  await row("+19565550178", "abandoned", false);
  const owner = await row(CELL, "message", true);
  await row(CELL, "abandoned", true);
  return { owner };
}

describe("owner-line calls are not customer calls (F-032 §6, SC-9, owner ruling Q-C)", () => {
  it("both caps count only the two customer calls (mutation: drop .is('owner_line_user_id', null) from countCallsSince -> 4; from countCallsByCallerSince -> 2; FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await seedCalls(db, accountId);
      expect([await countCallsSince(db, accountId, FROM), await countCallsByCallerSince(db, accountId, CELL, FROM)]).toEqual([2, 0]);
    }));

  it("answered and abandoned starts ignore it: dashboard tiles, conversion, weekly report, presence (mutation: drop it from listCallStartsByOutcomeBetween -> 2 and 2, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await seedCalls(db, accountId);
      expect([
        (await listCallStartsByOutcomeBetween(db, accountId, ["booked", "lead", "message", "transferred"], FROM, TO)).length,
        (await listCallStartsByOutcomeBetween(db, accountId, ["abandoned"], FROM, TO)).length,
      ]).toEqual([1, 1]);
    }));

  it("the setup wizard's answered count ignores it (mutation: drop it from countAnsweredCallsSince -> 2, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await seedCalls(db, accountId);
      expect(await countAnsweredCallsSince(db, accountId, FROM)).toBe(1);
    }));

  it("the Calls list keeps it, marked; the dashboard's recent calls drop it (mutation: ignore excludeOwnerLine -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { owner } = await seedCalls(db, accountId);
      const all = await listCalls(db, accountId, { limit: 10 });
      expect(all.map((r) => r.id)).toContain(owner);
      expect(all.find((r) => r.id === owner)?.owner_line_user_id).toEqual(expect.any(String));
      expect(all.filter((r) => r.owner_line_user_id === null)).toHaveLength(2);
      expect((await listCalls(db, accountId, { limit: 10, excludeOwnerLine: true })).map((r) => r.id)).not.toContain(owner);
    }));
});

/**
 * Every wrapper once, against the real functions through PostgREST. PostgREST matches an RPC by its NAMED arguments,
 * so a misspelt p_ name is a PGRST202 that no type check can see; the SQL's own cases (owner-line-schema.test.ts) call
 * the functions directly and cannot see it either. A person on the account is seeded through the service client;
 * their users row is not account-owned, so the finally deletes it.
 */
describe("the owner-line wrappers reach their functions (F-032 Task 2)", () => {
  it("verify a cell, set a PIN, the switch, the lookup, a wrong and a right PIN, the session check, the access-log entry, and removal", () =>
    withTestAccount(async (db, accountId) => {
      const clerk = `user_ol_wrap_${randomBytes(4).toString("hex")}`;
      const { data: u, error: uErr } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com`, name: "Dan Lopez" })
        .select("id").single();
      if (uErr || !u) throw new Error(`seed user: ${uErr?.message}`);
      const userId = (u as { id: string }).id;
      try {
        const { error: mErr } = await db.from("memberships").insert({ user_id: userId, scope: "account", account_id: accountId, role: "staff" });
        if (mErr) throw new Error(`seed membership: ${mErr.message}`);
        const { error: aErr } = await db.from("accounts").update({ client_access_enabled: true }).eq("id", accountId);
        if (aErr) throw new Error(`seed client access: ${aErr.message}`);
        const code = randomBytes(32).toString("hex");
        const pin = `scrypt:17:8:1:${"A".repeat(22)}:${"B".repeat(43)}`;

        expect(await startOwnerLineVerification(db, accountId, userId, CELL, code)).toBe("ok");
        expect(await ownerLineAnswerLookup(db, accountId, CELL, OWNER_LINE_MAX_CALLS_PER_DAY)).toMatchObject(
          { status: "verify", userId, role: "staff", name: "Dan Lopez", pinParams: null });
        expect(await attemptOwnerLineVerify(db, accountId, CELL, code)).toBe("verified");
        expect(await setOwnerLinePin(db, accountId, userId, pin)).toBe(true);
        expect(await readMyOwnerLineEnrollment(db, accountId, userId)).toMatchObject({ e164: CELL, verifiedAt: expect.any(String), pinSetAt: expect.any(String), lockedUntil: null });
        expect(await ownerLineAnswerLookup(db, accountId, CELL, OWNER_LINE_MAX_CALLS_PER_DAY)).toEqual({ status: "off" });

        expect(await readOwnerLineSwitch(db, accountId)).toEqual({ enabledAt: null, changedAt: null, changedByKind: null });
        // The wrapper refuses before writing, with its own words; the database CHECK is a second guard, never the first.
        await expect(setOwnerLineSwitch(db, accountId, true, "agency")).rejects.toThrow("setOwnerLineSwitch: the agency cannot turn the owner line on");
        expect(await setOwnerLineSwitch(db, accountId, true, "owner")).toMatchObject({ changed: true, state: { enabledAt: expect.any(String), changedByKind: "owner" } });

        const hit = await ownerLineAnswerLookup(db, accountId, CELL, OWNER_LINE_MAX_CALLS_PER_DAY);
        expect(hit).toMatchObject({ status: "pin", userId, role: "staff", pinParams: pin.slice(0, 36) });
        const enrollmentId = (hit as { enrollmentId: string }).enrollmentId;
        expect(await attemptOwnerLinePin(db, enrollmentId, "wrong")).toEqual({ status: "wrong" });
        expect(await attemptOwnerLinePin(db, enrollmentId, pin)).toEqual({ status: "ok" });
        expect(await ownerLineSessionCheck(db, { accountId, userId, role: "staff", maxCalls: OWNER_LINE_MAX_CALLS_PER_DAY }))
          .toMatchObject({ ok: true, name: "Dan Lopez", clerkUserId: clerk, timezone: expect.any(String) });
        expect(await ownerLineSessionCheck(db, { accountId, userId, role: "owner", maxCalls: null })).toEqual({ ok: false, reason: "role_changed" });

        const num = await assignPhoneNumber(db, accountId, { e164: testPhoneNumber() }, "user_test");
        const call = await startCallRow(db, accountId, { phoneNumberId: num.id, callerE164: CELL, ownerLineUserId: userId });
        // The ten-a-day limit is the ONLY bound on owner-line calls (Q-C), and Tasks 7 and 12 mock both wrappers, so it
        // is pinned HERE, through them (review I-1): with one owner-line call today and a limit of one, the lookup says
        // over_limit with the person's facts, and the session check refuses (mutations: drop over_limit from the
        // lookup's mapping; send p_max null from the session check; send a huge p_max from the lookup -> FAILS).
        expect(await ownerLineAnswerLookup(db, accountId, CELL, 1)).toMatchObject({ status: "over_limit", enrollmentId, userId });
        expect(await ownerLineSessionCheck(db, { accountId, userId, role: "staff", maxCalls: 1 })).toEqual({ ok: false, reason: "over_limit" });
        await noteOwnerLineCall(db, { accountId, callId: call.id, actorClerkUserId: clerk, actorName: "Dan Lopez",
          kinds: ["owner_line_appointments", "owner_line_calls_and_messages"] });
        expect((await readOwnerLineCallLog(db, accountId, call.id)).sort()).toEqual(["owner_line_appointments", "owner_line_calls_and_messages"]);

        expect(await setOwnerLineSwitch(db, accountId, false, "agency")).toMatchObject({ changed: true, state: { enabledAt: null, changedByKind: "agency" } });
        await removeOwnerLinePin(db, accountId, userId);
        expect(await readMyOwnerLineEnrollment(db, accountId, userId)).toMatchObject({ pinSetAt: null });
        await removeOwnerLineEnrollment(db, accountId, userId);
        expect(await readMyOwnerLineEnrollment(db, accountId, userId)).toBeNull();
      } finally {
        const { error } = await db.from("users").delete().eq("id", userId);
        if (error) throw new Error(`owner-line wrapper test cleanup (users) failed: ${error.message}`);
      }
    }));

  it("a lock always carries its end, and three wrong PINs lock (attemptOwnerLinePin's locked_now)", () =>
    withTestAccount(async (db, accountId) => {
      const clerk = `user_ol_lock_${randomBytes(4).toString("hex")}`;
      const { data: u, error: uErr } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com` }).select("id").single();
      if (uErr || !u) throw new Error(`seed user: ${uErr?.message}`);
      const userId = (u as { id: string }).id;
      try {
        const { error: mErr } = await db.from("memberships").insert({ user_id: userId, scope: "account", account_id: accountId, role: "owner" });
        if (mErr) throw new Error(`seed membership: ${mErr.message}`);
        const code = randomBytes(32).toString("hex");
        await startOwnerLineVerification(db, accountId, userId, CELL, code);
        await attemptOwnerLineVerify(db, accountId, CELL, code);
        await setOwnerLinePin(db, accountId, userId, `scrypt:17:8:1:${"A".repeat(22)}:${"B".repeat(43)}`);
        const id = (await readMyOwnerLineEnrollment(db, accountId, userId))!.id;
        await attemptOwnerLinePin(db, id, "x");
        await attemptOwnerLinePin(db, id, "y");
        const third = await attemptOwnerLinePin(db, id, "z");
        expect(third).toEqual({ status: "locked_now", lockedUntil: expect.any(String) });
        expect(await attemptOwnerLinePin(db, id, "w")).toEqual({ status: "locked", lockedUntil: (third as { lockedUntil: string }).lockedUntil });
      } finally {
        const { error } = await db.from("users").delete().eq("id", userId);
        if (error) throw new Error(`owner-line wrapper test cleanup (users) failed: ${error.message}`);
      }
    }));

  // Review m-E (2026-11-09): asking for the state the switch is already in writes nothing and says so, so an agency OFF on
  // a switch the Owner already turned off never relabels it "Turned off by BIS", and Task 5 emits BIS's switch_off
  // event only for a change that happened.
  it("a switch write that changes nothing writes nothing and reports changed: false (mutation: drop the conditional filter -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const on = await setOwnerLineSwitch(db, accountId, true, "owner");
      const again = await setOwnerLineSwitch(db, accountId, true, "owner");
      const off = await setOwnerLineSwitch(db, accountId, false, "owner");
      const bisOff = await setOwnerLineSwitch(db, accountId, false, "agency");
      expect([on.changed, again.changed, off.changed, bisOff.changed]).toEqual([true, false, true, false]);
      expect(again.state).toEqual(on.state);
      expect(bisOff.state).toEqual({ enabledAt: null, changedAt: off.state.changedAt, changedByKind: "owner" });
    }));

  it("a switch write on an account that does not exist throws (review m-3; mutation: answer changed: false with an all-null state -> FAILS)", () =>
    withTestAccount(async (db) => {
      const gone = randomUUID();
      await expect(setOwnerLineSwitch(db, gone, false, "agency")).rejects.toThrow(`setOwnerLineSwitch: no such account ${gone}`);
    }));
});

/** A person on the account, through the service client; the users row is not account-owned, so `done` deletes it. */
async function seedPerson(db: SupabaseClient, accountId: string, role: "owner" | "staff") {
  const clerk = `user_ol_p_${randomBytes(4).toString("hex")}`;
  const { data: u, error: uErr } = await db.from("users").insert({ clerk_user_id: clerk, email: `${clerk}@example.com` }).select("id").single();
  if (uErr || !u) throw new Error(`seed user: ${uErr?.message}`);
  const userId = (u as { id: string }).id;
  const { error: mErr } = await db.from("memberships").insert({ user_id: userId, scope: "account", account_id: accountId, role });
  if (mErr) throw new Error(`seed membership: ${mErr.message}`);
  return {
    userId,
    done: async () => {
      const { error } = await db.from("users").delete().eq("id", userId);
      if (error) throw new Error(`owner-line test cleanup (users) failed: ${error.message}`);
    },
  };
}

describe("the owner-line wrappers: an unverified cell and the restart cap (Task 5 review m-1, I-2)", () => {
  it("setting a PIN on a cell that is not verified answers false and stores nothing, never a database error (mutation: drop the verified-only filter -> the CHECK throws, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const p = await seedPerson(db, accountId, "staff");
      try {
        expect(await startOwnerLineVerification(db, accountId, p.userId, CELL, randomBytes(32).toString("hex"))).toBe("ok");
        expect(await setOwnerLinePin(db, accountId, p.userId, `scrypt:17:8:1:${"A".repeat(22)}:${"B".repeat(43)}`)).toBe(false);
        expect(await readMyOwnerLineEnrollment(db, accountId, p.userId)).toMatchObject({ e164: CELL, verifiedAt: null, pinSetAt: null });
      } finally { await p.done(); }
    }));

  it("five starts a day; removing the cell reads as no enrollment but does NOT reset the count (mutations: removal deletes the row -> 'ok'; the wrapper drops too_many -> throws; FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const p = await seedPerson(db, accountId, "staff");
      try {
        const code = () => randomBytes(32).toString("hex");
        for (let i = 1; i <= 5; i++) expect(await startOwnerLineVerification(db, accountId, p.userId, `+1956555040${i}`, code())).toBe("ok");
        await removeOwnerLineEnrollment(db, accountId, p.userId);
        expect(await readMyOwnerLineEnrollment(db, accountId, p.userId)).toBeNull();
        expect(await startOwnerLineVerification(db, accountId, p.userId, "+19565550499", code())).toBe("too_many");
      } finally { await p.done(); }
    }));
});
```

`getDisclosureResults` gets no case: it counts only `trial`-stamped calls, and the owner-line call row is never stamped, so a case could not fail. The inventory table records why it needs no exclusion.

- [ ] **Step 2: Confirm the red locally, without bis-ci.** Two reds:
  - **The type error.** `ownerLineUserId` is not on `startCallRow`'s input, and `excludeOwnerLine` is not on `listCalls`' opts:

    ```bash
    pnpm --filter @bis/db exec tsc --noEmit -p . 2>&1 | grep owner-line-counting
    ```

    Expected: `error TS2353: Object literal may only specify known properties, and 'ownerLineUserId' does not exist`. Paste it.
  - **The runtime proof.** This file uses `withTestAccount` (PostgREST), which the PG18 replica does not serve. CI `verify` runs it on its OWN throwaway stack, built from every migration in the branch, 0115 included. **It does not wait for bis-ci;** only the `e2e` job's migration check does (O-2). So: push the branch with Steps 1–4, and read `verify`'s result for the head SHA. The mutation probes in Step 7 go the same way.

- [ ] **Step 3: Implement the `voice.ts` changes.** Exact edits:

```ts
// startCallRow input type (voice.ts:349-355): add
    ownerLineUserId?: string;
// in its insert object, after businessStatus:
      ...(input.ownerLineUserId === undefined ? {} : { owner_line_user_id: input.ownerLineUserId }),

// countCallsSince (voice.ts:960-962):
  const { count, error } = await db.from("calls")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("started_at", sinceIso).is("owner_line_user_id", null);

// countAnsweredCallsSince (voice.ts:979-982): append  .is("owner_line_user_id", null)  after .in("outcome", …)
// countCallsByCallerSince (voice.ts:1013-1015): append  .is("owner_line_user_id", null)  after .gte("started_at", sinceIso)

// listCallStartsByOutcomeBetween (voice.ts:1144-1148):
    let query = db.from("calls")
      .select("id, started_at")
      .eq("account_id", accountId).in("outcome", outcomes as string[])
      .gte("started_at", fromIso).lt("started_at", toIso)
      .is("owner_line_user_id", null)
      .order("id", { ascending: true });

// CallListRow (voice.ts:1209-1228): add the field
  /** F-032 (0115): the person an owner-line call was for; null on every customer call. */
  owner_line_user_id: string | null;
// CALL_LIST_COLS (voice.ts:1239-1241): LOAD-BEARING like 0094's columns, so 0115 must be on a project before this build reads it.
const CALL_LIST_COLS =
  "id, started_at, ended_at, duration_secs, outcome, language, caller_e164, contact_id, " +
  "conversation_id, owner_line_user_id, contact:contacts(first_name, last_name)";
// listCalls (voice.ts:1248-1259):
export async function listCalls(
  db: SupabaseClient, accountId: string, opts: { limit?: number; before?: string; excludeOwnerLine?: boolean } = {},
): Promise<CallListRow[]> {
  let q = db.from("calls").select(CALL_LIST_COLS)
    .eq("account_id", accountId)
    .order("started_at", { ascending: false })
    .limit(opts.limit ?? 50);
  if (opts.before) q = q.lt("started_at", opts.before);
  if (opts.excludeOwnerLine) q = q.is("owner_line_user_id", null);
  const { data, error } = await q;
  if (error) throw new Error(`listCalls failed: ${error.message}`);
  return (data ?? []) as unknown as CallListRow[];
}
```

Then edit the two comments that now lie:
- `voice.ts:1130-1132` says these helpers "must count every call that cost money". Replace it with: "must count every customer call that cost money; an owner-line call (0115) is bounded by its own per-person limit (owner_line_answer_lookup, owner_line_session_check), never by these."
- `WEB/lib/voice/presence.ts:47-48` gets the same wording.

`ACCT/dashboard/page.tsx:171` becomes `listCalls(db, accountId, { limit: 3, excludeOwnerLine: true }),`.

- [ ] **Step 4: Write `packages/db/src/owner-line.ts`.** The block below is the committed file. It adds two things the first text lacked: the `OwnerLinePinResult` declaration (the Interfaces list had it, the code did not), and re-review m-E's conditional switch write.

```ts
// packages/db/src/owner-line.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountRole } from "./team";

/**
 * F-032 (0115): the owner line's database seam. Every function takes serviceDb() EXCEPT readOwnerLineCallLog, which
 * takes the READER's request client (the access log's RLS: the agency, or this account's Owner). The table has no
 * client grant at all (SC-4): a person's own row is reached only through a server action keyed on Clerk's userId.
 * Every wrapper THROWS on an error and on an answer it did not expect, naming itself. pin_hash and the code hash are
 * written here and never read back out, except the PIN's salt prefix (pin_params) the answer lookup returns.
 */
export const OWNER_LINE_MAX_CALLS_PER_DAY = 10;
export const OWNER_LINE_LOCK_MINUTES = 30;
export const OWNER_LINE_VERIFY_MINUTES = 10;
export const OWNER_LINE_LOG_KINDS = ["owner_line_calls_and_messages", "owner_line_appointments",
  "owner_line_needs_attention", "owner_line_lookup_customer"] as const;
export type OwnerLineLogKind = (typeof OWNER_LINE_LOG_KINDS)[number];

export type OwnerLineEnrollment = {
  id: string; e164: string; verifiedAt: string | null; verifyExpiresAt: string | null;
  pinSetAt: string | null; lockedUntil: string | null;
};
export type OwnerLineLookup =
  | { status: "none" | "off" | "locked" }
  | { status: "verify" | "pin" | "over_limit"; enrollmentId: string; userId: string; role: AccountRole;
      name: string | null; language: "en" | "es" | null; accountLanguage: "en" | "es" | null; pinParams: string | null };
/** A lock always carries its end (owner_line_attempt_pin returns locked_until with locked_now and locked). */
export type OwnerLinePinResult = { status: "ok" | "wrong" | "none" } | { status: "locked_now" | "locked"; lockedUntil: string };
export type OwnerLineSessionFacts = {
  name: string | null; language: "en" | "es" | null; clerkUserId: string; clerkOrgId: string;
  timezone: string; accountLanguage: "en" | "es" | null;
};

const ROLES: readonly string[] = ["owner", "staff", "technician"];
const lang = (v: unknown): "en" | "es" | null => (v === "en" || v === "es" ? v : null);

/**
 * This person's cell on this business, or null when they have none. A row whose cell was displaced or removed stays
 * (its restart count must survive: 0115, Task 5 review I-2) with e164 null, and reads as null here, exactly as no row.
 */
export async function readMyOwnerLineEnrollment(
  db: SupabaseClient, accountId: string, userId: string,
): Promise<OwnerLineEnrollment | null> {
  const { data, error } = await db.from("owner_line_enrollments")
    .select("id, e164, verified_at, verify_expires_at, pin_set_at, locked_until")
    .eq("account_id", accountId).eq("user_id", userId).not("e164", "is", null).maybeSingle();
  if (error) throw new Error(`readMyOwnerLineEnrollment failed: ${error.message}`);
  if (!data) return null;
  const r = data as { id: string; e164: string; verified_at: string | null; verify_expires_at: string | null;
    pin_set_at: string | null; locked_until: string | null };
  return { id: r.id, e164: r.e164, verifiedAt: r.verified_at, verifyExpiresAt: r.verify_expires_at,
    pinSetAt: r.pin_set_at, lockedUntil: r.locked_until };
}

/**
 * Start (or restart) a call-in code for this person's cell on this business.
 *   - "ok": stored. A lapsed or spent unverified claim on the cell by someone else was displaced first.
 *   - "taken": another person on this business holds the cell (verified, or with a live code).
 *   - "too_many": this person has started five codes on this business in the last 24 hours. NOTHING was stored, so the
 *     caller must not show a code (Task 5 review I-2; the bound and its reason are in 0115's header).
 */
export async function startOwnerLineVerification(
  db: SupabaseClient, accountId: string, userId: string, e164: string, codeHash: string,
): Promise<"ok" | "taken" | "too_many"> {
  const { data, error } = await db.rpc("owner_line_start_verification", {
    p_account_id: accountId, p_user_id: userId, p_e164: e164, p_code_hash: codeHash, p_minutes: OWNER_LINE_VERIFY_MINUTES,
  });
  if (error) throw new Error(`startOwnerLineVerification failed: ${error.message}`);
  if (data === "ok" || data === "taken" || data === "too_many") return data;
  throw new Error(`startOwnerLineVerification: unexpected answer ${JSON.stringify(data)}`);
}

export async function attemptOwnerLineVerify(
  db: SupabaseClient, accountId: string, callerE164: string, codeHash: string,
): Promise<"verified" | "wrong" | "spent" | "none"> {
  const { data, error } = await db.rpc("owner_line_attempt_verify", {
    p_account_id: accountId, p_caller_e164: callerE164, p_code_hash: codeHash,
  });
  if (error) throw new Error(`attemptOwnerLineVerify failed: ${error.message}`);
  if (data === "verified" || data === "wrong" || data === "spent" || data === "none") return data;
  throw new Error(`attemptOwnerLineVerify: unexpected answer ${JSON.stringify(data)}`);
}

/** False when the cell is not verified (the row's pin_needs_cell CHECK would refuse; this asks first). */
export async function setOwnerLinePin(
  db: SupabaseClient, accountId: string, userId: string, pinHash: string,
): Promise<boolean> {
  const { data, error } = await db.from("owner_line_enrollments")
    .update({ pin_hash: pinHash, pin_set_at: new Date().toISOString(), failed_attempts: 0, locked_until: null })
    .eq("account_id", accountId).eq("user_id", userId).not("verified_at", "is", null).select("id");
  if (error) throw new Error(`setOwnerLinePin failed: ${error.message}`);
  return (data ?? []).length === 1;
}

export async function removeOwnerLinePin(db: SupabaseClient, accountId: string, userId: string): Promise<void> {
  const { error } = await db.from("owner_line_enrollments")
    .update({ pin_hash: null, pin_set_at: null, failed_attempts: 0, locked_until: null })
    .eq("account_id", accountId).eq("user_id", userId);
  if (error) throw new Error(`removeOwnerLinePin failed: ${error.message}`);
}

/**
 * The person removes their cell: no cell, no code, no PIN, no lock. The row is CLEARED, never deleted, so its restart
 * count survives (Task 5 review I-2): deleting it would let anyone reset the five-a-day bound by removing and re-adding.
 * readMyOwnerLineEnrollment then answers null, as for someone who never had a cell.
 */
export async function removeOwnerLineEnrollment(db: SupabaseClient, accountId: string, userId: string): Promise<void> {
  const { error } = await db.from("owner_line_enrollments")
    .update({ e164: null, verified_at: null, verify_code_hash: null, verify_expires_at: null, verify_attempts: 0,
      pin_hash: null, pin_set_at: null, failed_attempts: 0, locked_until: null })
    .eq("account_id", accountId).eq("user_id", userId);
  if (error) throw new Error(`removeOwnerLineEnrollment failed: ${error.message}`);
}

export async function ownerLineAnswerLookup(
  db: SupabaseClient, accountId: string, callerE164: string, max: number,
): Promise<OwnerLineLookup> {
  const { data, error } = await db.rpc("owner_line_answer_lookup", {
    p_account_id: accountId, p_caller_e164: callerE164, p_max: max,
  });
  if (error) throw new Error(`ownerLineAnswerLookup failed: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  const status = r?.status;
  if (status === "none" || status === "off" || status === "locked") return { status };
  if ((status === "verify" || status === "pin" || status === "over_limit")
      && typeof r?.enrollment_id === "string" && typeof r?.user_id === "string" && ROLES.includes(String(r?.role))) {
    return {
      status, enrollmentId: r.enrollment_id, userId: r.user_id, role: r.role as AccountRole,
      name: typeof r.name === "string" ? r.name : null, language: lang(r.language), accountLanguage: lang(r.account_language),
      pinParams: typeof r.pin_params === "string" ? r.pin_params : null,
    };
  }
  throw new Error(`ownerLineAnswerLookup: unexpected answer ${JSON.stringify(data)}`);
}

export async function attemptOwnerLinePin(
  db: SupabaseClient, enrollmentId: string, candidate: string,
): Promise<OwnerLinePinResult> {
  const { data, error } = await db.rpc("owner_line_attempt_pin", {
    p_enrollment_id: enrollmentId, p_candidate: candidate, p_lock_minutes: OWNER_LINE_LOCK_MINUTES,
  });
  if (error) throw new Error(`attemptOwnerLinePin failed: ${error.message}`);
  const r = data as { status?: unknown; locked_until?: unknown } | null;
  const s = r?.status;
  // A lock always carries its end: owner_line_attempt_pin returns locked_until from the same UPDATE ... RETURNING
  // (locked_now) or from the row it read (locked). A lock without one is an unexpected answer, never a null that the
  // lockout email would have to print as nothing (Task 8).
  if (s === "locked_now" || s === "locked") {
    if (typeof r?.locked_until === "string") return { status: s, lockedUntil: r.locked_until };
  } else if (s === "ok" || s === "wrong" || s === "none") {
    return { status: s };
  }
  throw new Error(`attemptOwnerLinePin: unexpected answer ${JSON.stringify(data)}`);
}

export async function ownerLineSessionCheck(
  db: SupabaseClient,
  p: { accountId: string; userId: string; role: AccountRole; maxCalls: number | null },
): Promise<({ ok: true } & OwnerLineSessionFacts) | { ok: false; reason: string }> {
  const { data, error } = await db.rpc("owner_line_session_check", {
    p_account_id: p.accountId, p_user_id: p.userId, p_role: p.role, p_max: p.maxCalls,
  });
  if (error) throw new Error(`ownerLineSessionCheck failed: ${error.message}`);
  const r = data as Record<string, unknown> | null;
  if (r?.ok === false && typeof r.reason === "string") return { ok: false, reason: r.reason };
  if (r?.ok === true && typeof r.clerk_user_id === "string" && typeof r.clerk_org_id === "string" && typeof r.timezone === "string") {
    return { ok: true, name: typeof r.name === "string" ? r.name : null, language: lang(r.language),
      clerkUserId: r.clerk_user_id, clerkOrgId: r.clerk_org_id, timezone: r.timezone, accountLanguage: lang(r.account_language) };
  }
  throw new Error(`ownerLineSessionCheck: unexpected answer ${JSON.stringify(data)}`);
}

export async function noteOwnerLineCall(
  db: SupabaseClient,
  p: { accountId: string; callId: string; actorClerkUserId: string; actorName: string | null; kinds: readonly OwnerLineLogKind[] },
): Promise<void> {
  const { error } = await db.rpc("note_owner_line_call", {
    p_account_id: p.accountId, p_call_id: p.callId, p_actor: p.actorClerkUserId, p_actor_name: p.actorName,
    p_kinds: [...p.kinds],
  });
  if (error) throw new Error(`noteOwnerLineCall failed: ${error.message}`);
}

/** On the READER's client: RLS returns rows to the agency and this account's Owner only, [] to anyone else. */
export async function readOwnerLineCallLog(db: SupabaseClient, accountId: string, callId: string): Promise<OwnerLineLogKind[]> {
  const { data, error } = await db.from("agency_visit_items").select("kind")
    .eq("account_id", accountId).eq("record_id", callId).in("kind", [...OWNER_LINE_LOG_KINDS]);
  if (error) throw new Error(`readOwnerLineCallLog failed: ${error.message}`);
  return ((data ?? []) as { kind: OwnerLineLogKind }[]).map((r) => r.kind);
}

/**
 * The switch and its record (owner rulings Q-A and 2026-11-09 "Say BIS, keep names private"): WHEN it last changed and
 * WHAT KIND of person changed it, never who. The card says "Turned on by the Owner" or "Turned off by BIS". Which BIS
 * person did it is BIS's own null-account event (Task 5), never read here.
 */
export type OwnerLineSwitchKind = "owner" | "agency";
export type OwnerLineSwitchState = { enabledAt: string | null; changedAt: string | null; changedByKind: OwnerLineSwitchKind | null };

const SWITCH_COLS = "owner_line_enabled_at, owner_line_changed_at, owner_line_changed_by_kind";
type SwitchRow = { owner_line_enabled_at: string | null; owner_line_changed_at: string | null; owner_line_changed_by_kind: string | null };

function switchState(r: SwitchRow | null, who: string): OwnerLineSwitchState {
  const kind = r?.owner_line_changed_by_kind ?? null;
  if (kind !== null && kind !== "owner" && kind !== "agency") throw new Error(`${who}: unexpected kind ${kind}`);
  return { enabledAt: r?.owner_line_enabled_at ?? null, changedAt: r?.owner_line_changed_at ?? null, changedByKind: kind };
}

/** Server code only (the Team page after requireAccountOwner; the preferences card after the membership check). */
export async function readOwnerLineSwitch(db: SupabaseClient, accountId: string): Promise<OwnerLineSwitchState> {
  const { data, error } = await db.from("accounts").select(SWITCH_COLS).eq("id", accountId).maybeSingle();
  if (error) throw new Error(`readOwnerLineSwitch failed: ${error.message}`);
  return switchState(data as SwitchRow | null, "readOwnerLineSwitch");
}

/**
 * Server code only, after requireAccountOwner. Owner ruling Q-A: the client's Owner turns it on or off; the agency may
 * turn it OFF and never ON. Enforced here, in the action, and in the database (accounts_owner_line_agency_off_check).
 * The switch, a NEW change time and the who-kind travel in one UPDATE: 0115's accounts_owner_line_switch_record refuses
 * a switch change whose owner_line_changed_at does not move. The database checks only that the TIME is fresh; keeping
 * the who-kind current is this function's job, and it always writes both.
 *
 * Asking for the state the switch is already in writes NOTHING (review m-E) and answers `changed: false`: an agency OFF
 * on a switch the Owner already turned off must not relabel it "Turned off by BIS", and Task 5 emits BIS's
 * owner_line.switch_off event only when `changed` is true. The test is the UPDATE's own filter, so two clicks racing
 * each other change it once.
 *
 * The answer's `state` is the UPDATE's OWN returned row when it changed something (review m-3: one round trip, and no
 * window for another write to show through), and a re-read only on a no-op. An account that does not exist THROWS:
 * it is never answered as an all-null "off".
 */
export async function setOwnerLineSwitch(
  db: SupabaseClient, accountId: string, on: boolean, by: OwnerLineSwitchKind,
): Promise<{ changed: boolean; state: OwnerLineSwitchState }> {
  if (on && by === "agency") throw new Error("setOwnerLineSwitch: the agency cannot turn the owner line on");
  const at = new Date().toISOString();
  const base = db.from("accounts")
    .update({ owner_line_enabled_at: on ? at : null, owner_line_changed_at: at, owner_line_changed_by_kind: by })
    .eq("id", accountId);
  const { data, error } = await (on ? base.is("owner_line_enabled_at", null) : base.not("owner_line_enabled_at", "is", null))
    .select(SWITCH_COLS);
  if (error) throw new Error(`setOwnerLineSwitch failed: ${error.message}`);
  const rows = (data ?? []) as SwitchRow[];
  if (rows.length === 1) return { changed: true, state: switchState(rows[0]!, "setOwnerLineSwitch") };
  const { data: now, error: readError } = await db.from("accounts").select(SWITCH_COLS).eq("id", accountId).maybeSingle();
  if (readError) throw new Error(`setOwnerLineSwitch (no change) failed: ${readError.message}`);
  if (now === null) throw new Error(`setOwnerLineSwitch: no such account ${accountId}`);
  return { changed: false, state: switchState(now as SwitchRow, "setOwnerLineSwitch") };
}
```

Add `export * from "./owner-line";` to `packages/db/src/index.ts` beside its siblings (additive only). Add `"owner_line_enrollments",` to `ACCOUNT_OWNED_TABLES` in `account-teardown.ts`, beside `"calendar_feeds"`, with the comment `// F-032 (0115): owner-line enrollments (cascade with their membership too).`

- [ ] **Step 5: Typecheck green.**

  ```bash
  pnpm --filter @bis/db exec tsc --noEmit -p . && pnpm --filter web typecheck
  ```

  Expected: no output from either, with the exit status captured to a file and nothing after it (repo rule 4).

- [ ] **Step 6: Run the web tests that read these functions.** A mocked `@bis/db` stays valid.

  ```bash
  pnpm --filter web exec vitest run src/app/api/voice "src/app/(dashboard)/dashboard/accounts/[accountId]/calls" "src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard" src/lib/voice/presence.test.ts src/lib/reports
  ```

  Expected: green. Paste vitest's summary line.

- [ ] **Step 7: Mutation probes (on CI verify's own stack; no bis-ci needed).** These run on a probe branch of the PR's head (memory `bis-lane-pipeline`: own probe worktree). Each must FAIL BY NAME in CI `verify`:
  1. Remove `.is("owner_line_user_id", null)` from `countCallsSince` → "both caps count only the two customer calls" FAILS. The same probe on `countCallsByCallerSince` also FAILS that case.
  2. Remove it from `listCallStartsByOutcomeBetween` → "answered and abandoned starts ignore it" FAILS.
  3. Make `listCalls` ignore `excludeOwnerLine` → "the dashboard's recent calls drop it" FAILS.
  4. Remove it from `countAnsweredCallsSince` → "the setup wizard's answered count ignores it" FAILS.
  5. `startCallRow` never writes `owner_line_user_id` → "both caps" and "the Calls list keeps it" FAIL.
  6. `ownerLineAnswerLookup` sends `p_maxx` → the round trip FAILS with PostgREST's "Could not find the function" (a misspelt RPC argument no type check sees).
  7. `attemptOwnerLinePin` drops `lockedUntil` from a lock → "a lock always carries its end" FAILS.
  8. `setOwnerLineSwitch` without its agency-ON guard → the round trip FAILS, because it asserts the wrapper's own message, not the database CHECK's (the CHECK alone would satisfy a loose `/agency/`).
  9. `setOwnerLineSwitch` without its conditional filter (re-review m-E) → "a switch write that changes nothing" FAILS (`[true, true, true, true]`).
  10. The dashboard page without `excludeOwnerLine` → its page-test case FAILS; `listCallStartsByOutcomeBetween` without the filter → the pagination case FAILS (both run without a database).

  11. **The ten-a-day limit through the wrappers (Task 2 review I-1; the ONLY bound on owner-line calls, Q-C, and Tasks 7 and 12 mock both wrappers):** x1 `ownerLineAnswerLookup` stops mapping `over_limit` → the round trip FAILS ("unexpected answer"); x3 `ownerLineSessionCheck` sends `p_max: null` → FAILS (`{ ok: true }` where `over_limit` was due); x4 `ownerLineAnswerLookup` sends `p_max: 1000000` → FAILS (`pin` where `over_limit` was due).
  12. **The switch's answer (Task 2 review m-3):** re-read after a real change → "a real change answers from the UPDATE's own row" FAILS; answer an all-null state for a missing account → both missing-account cases FAIL.

  All were run locally on 2026-11-09 against the PostgREST-fronted replica; CI verify re-proves them on its own stack.

- [ ] **Step 8: Commit.**

  ```bash
  git add packages/db/src/owner-line.ts packages/db/src/index.ts packages/db/src/account-teardown.ts packages/db/src/voice.ts packages/db/src/test/owner-line-counting.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/page.tsx" apps/web/src/lib/voice/presence.ts
  git commit -m "feat(db): owner line wrappers; owner-line calls never count as customer calls (caps, answered, dashboard, weekly report, presence)"
  ```

---

## Task 3: PIN and code primitives (HIGH, 0.25 day; no dependencies, runs beside the spike)

**Files:**
- Create: `apps/web/src/lib/owner-line/secrets.ts`, `apps/web/src/lib/owner-line/secrets.test.ts`

**Interfaces:**
- Produces:

```ts
export const PIN_PARAMS_PREFIX = "scrypt:17:8:1:";
export type PinRefusal = "not_six_digits" | "repeated" | "run";
export function checkPin(pin: string): { ok: true } | { ok: false; reason: PinRefusal };
export async function hashPin(pin: string, env?: NodeJS.ProcessEnv): Promise<string>;   // 80 chars, 0115's CHECK shape; throws with no pepper
export async function candidateFor(pin: string, pinParams: string, env?: NodeJS.ProcessEnv): Promise<string | null>; // pinParams = first 36 chars; throws with no pepper
export function pinPepperConfigured(env?: NodeJS.ProcessEnv): boolean;
export function newVerifyCode(): string;                                    // 6 digits, zero-padded
export function hashVerifyCode(code: string): string;                       // sha256 lowercase hex
```

**Why a pepper.** A 6-digit PIN has a million values. A slow hash alone makes a stolen `pin_hash` cost hours to crack, not years. scrypt therefore runs over HMAC-SHA256(PIN), keyed by `sha256("bis-owner-line-pin:" + OWNER_LINE_PIN_PEPPER)`. The pepper lives only in Vercel's env (O-3), never in the database, so a database-only leak cannot be cracked offline at all. It gets its own key domain, so the pepper can never stand in for another secret. N=2^17, r=8, p=1 is OWASP's scrypt floor; 128 x N x r = 128 MiB, and `maxmem` is 256 MiB (A-8).

- [ ] **Step 1: Write the failing test.**

```ts
// apps/web/src/lib/owner-line/secrets.test.ts
import { describe, it, expect } from "vitest";
import { checkPin, hashPin, candidateFor, newVerifyCode, hashVerifyCode, pinPepperConfigured, PIN_PARAMS_PREFIX } from "./secrets";

const SHAPE = /^scrypt:17:8:1:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]{43}$/;
const ENV = { OWNER_LINE_PIN_PEPPER: "p".repeat(40) } as unknown as NodeJS.ProcessEnv;
const OTHER = { OWNER_LINE_PIN_PEPPER: "q".repeat(40) } as unknown as NodeJS.ProcessEnv;

describe("checkPin (spec §3.1: exactly 6 digits; 000000, 123456, a repeated digit, a run refused with a reason)", () => {
  it.each([
    ["000000", "repeated", "all zeros"],
    ["777777", "repeated", "one digit six times"],
    ["123456", "run", "the ascending run from 1"],
    ["654321", "run", "a descending run (mutation: drop the descending run -> FAILS)"],
    ["345678", "run", "an ascending run that does not start at 1"],
    ["12345", "not_six_digits", "five digits"],
    ["1234567", "not_six_digits", "seven digits"],
    ["12a456", "not_six_digits", "a letter among the digits"],
    [" 48291", "not_six_digits", "a leading space"],
  ])("%s is refused as %s: %s", (pin, reason) => {
    expect(checkPin(pin)).toEqual({ ok: false, reason });
  });
  it.each(["482913", "135790", "112358", "090807"])("%s is accepted", (pin) => {
    expect(checkPin(pin)).toEqual({ ok: true });
  });
});

describe("hashPin / candidateFor (SC-6: peppered scrypt; SQL compares the strings)", () => {
  it("is the exact shape 0115's pin_hash CHECK accepts: 80 characters", async () => {
    const h = await hashPin("482913", ENV);
    expect(h).toMatch(SHAPE);
    expect(h).toHaveLength(80);
    expect(h.startsWith(PIN_PARAMS_PREFIX)).toBe(true);
  });
  it("salts: one PIN hashes differently twice", async () => {
    expect(await hashPin("482913", ENV)).not.toBe(await hashPin("482913", ENV));
  });
  it("the candidate for the right PIN, derived from the stored salt prefix, IS the stored hash (mutation: N = 2**16 in candidateFor -> FAILS)", async () => {
    const h = await hashPin("482913", ENV);
    expect(await candidateFor("482913", h.slice(0, 36), ENV)).toBe(h);
    expect(await candidateFor("482914", h.slice(0, 36), ENV)).not.toBe(h);
  });
  it("a hash and its salt are useless without the pepper: another pepper never reproduces it (mutation: hash the bare PIN -> FAILS)", async () => {
    const h = await hashPin("482913", ENV);
    expect(await candidateFor("482913", h.slice(0, 36), OTHER)).not.toBe(h);
  });
  it("a known answer, computed outside this file with scryptSync(HMAC-SHA256(PIN) keyed by sha256(\"bis-owner-line-pin:\" + pepper), salt, 32, {N: 2**17, r: 8, p: 1}) (mutations: N = 2**16; N = 2**10 with r = 1; the handoff key domain; the raw pepper as the HMAC key -> each FAILS)", async () => {
    expect(PIN_PARAMS_PREFIX).toBe("scrypt:17:8:1:");
    expect(await candidateFor("482913", PIN_PARAMS_PREFIX + "AAAAAAAAAAAAAAAAAAAAAA", ENV))
      .toBe("scrypt:17:8:1:AAAAAAAAAAAAAAAAAAAAAA:ShB19WHKMzNMK8TkJhYrbry-KQiFxCfEK5dcl71dz4E");
  });
  it("no pepper, or a short one, refuses to hash or check at all, rather than silently hashing without it", async () => {
    expect(pinPepperConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(pinPepperConfigured({ OWNER_LINE_PIN_PEPPER: "short" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    await expect(hashPin("482913", {} as NodeJS.ProcessEnv)).rejects.toThrow(/OWNER_LINE_PIN_PEPPER/);
    await expect(candidateFor("482913", PIN_PARAMS_PREFIX + "A".repeat(22), {} as NodeJS.ProcessEnv)).rejects.toThrow(/OWNER_LINE_PIN_PEPPER/);
  });
  it("names an unset pepper and a short one as different problems, and never prints the value or its length", async () => {
    const SHORT = "shortpepper-xyz";   // 15 characters
    await expect(hashPin("482913", {} as NodeJS.ProcessEnv)).rejects.toThrow("owner line: OWNER_LINE_PIN_PEPPER is not set");
    await expect(hashPin("482913", { OWNER_LINE_PIN_PEPPER: "   " } as unknown as NodeJS.ProcessEnv))
      .rejects.toThrow("owner line: OWNER_LINE_PIN_PEPPER is not set");
    const err = await hashPin("482913", { OWNER_LINE_PIN_PEPPER: SHORT } as unknown as NodeJS.ProcessEnv).then(() => null, (e: Error) => e);
    expect(err?.message).toBe("owner line: OWNER_LINE_PIN_PEPPER is too short (it needs at least 32 characters)");
    expect(err?.message).not.toContain(SHORT);
    expect(err?.message).not.toMatch(/\b15\b/);
  });
  it("a malformed prefix or a non-6-digit entry has no candidate (it can never match)", async () => {
    const h = await hashPin("482913", ENV);
    expect(await candidateFor("482913", "scrypt:15:8:1:" + h.slice(14, 36), ENV)).toBeNull();
    expect(await candidateFor("4829", h.slice(0, 36), ENV)).toBeNull();
  });
  it("one hash takes under 2 s here (A-8; logs the measured time for the report)", async () => {
    const t0 = Date.now();
    await hashPin("482913", ENV);
    const ms = Date.now() - t0;
    console.log(`owner-line scrypt N=2^17: ${ms} ms`);
    expect(ms).toBeLessThan(2000);
  });
});

describe("the call-in code", () => {
  it("is 6 digits, zero-padded, and hashes to 64 lowercase hex (0115's verify_code_hash CHECK)", () => {
    for (let i = 0; i < 50; i++) expect(newVerifyCode()).toMatch(/^[0-9]{6}$/);
    expect(hashVerifyCode("123456")).toBe("8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92");
  });
});
```

The digest literal is the one Postgres produced, already pinned in `packages/db/src/test/alert-phone-verification-grants.test.ts:36-37`.

The known-answer literal (`…:ShB19WHKMzNMK8TkJhYrbry-KQiFxCfEK5dcl71dz4E`) was computed ONCE, outside the code under test, with `scryptSync(HMAC-SHA256(pin) keyed by sha256("bis-owner-line-pin:" + "p".repeat(40)), "A".repeat(22), 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 MiB })`. It pins the cost and the pepper's key domain: without it, a global N = 2**16, N = 2**10 with r = 1, the handoff key domain, or the raw pepper as the HMAC key each left the suite green (review round, 2026-11-09). The test env casts are `as unknown as NodeJS.ProcessEnv` wherever the object carries a property: this repo's `ProcessEnv` requires `NODE_ENV`, so a bare `as NodeJS.ProcessEnv` is TS2352 (the existing `sip-handoff-signature.test.ts` does the same).

- [ ] **Step 2: Run it and see it fail.**

  ```bash
  pnpm --filter web exec vitest run src/lib/owner-line/secrets.test.ts
  ```

  Expected: FAIL, `Cannot find module './secrets'` (vitest 4.1 wording; older versions say `Failed to resolve import "./secrets"`). Paste the line.

- [ ] **Step 3: Implement.**

```ts
// apps/web/src/lib/owner-line/secrets.ts
// The owner line's two secrets (F-032 §3.1, §3.2; plan SC-6). No @bis/db import (the TeXML routes import this
// statically: SC-18).
//
// THE PIN: scrypt from node:crypto (memory-hard and built in; neither argon2 nor bcrypt is a dependency), N=2^17,
// r=8, p=1 (OWASP's floor), a 16-byte salt and a 32-byte key. Its password is HMAC-SHA256(PIN) under a key derived
// from OWNER_LINE_PIN_PEPPER in its own domain, so a database-only leak cannot be cracked offline. It is written as
// "scrypt:17:8:1:<salt b64url 22>:<key b64url 43>" (80 characters, 0115's CHECK).
// SQL never derives it. The answer lookup returns the first 36 characters (the parameters and the salt), this file
// derives the candidate, and owner_line_attempt_pin compares under a row lock.
// No pepper is a CONFIGURATION error, never a silent unpeppered hash: both functions throw. owner-pin turns that
// into today's path, with no attempt counted.
//
// THE CALL-IN CODE: sha256 hex, exactly like the alert-phone code (packages/db/src/alert-phone-verification.ts:68),
// because a 10-minute, 3-attempt code is defended by its limits.
import { createHash, createHmac, randomBytes, randomInt, scrypt } from "node:crypto";

const N = 2 ** 17;
const R = 8;
const P = 1;
/** "scrypt:17:8:1:", built from the parameters it names, so the stored string can never claim a cost it was not
 *  derived at. */
export const PIN_PARAMS_PREFIX = `scrypt:${Math.log2(N)}:${R}:${P}:`;
const KEYLEN = 32;
/** 128 * N * r = 128 MiB; node refuses at its default maxmem, so 256 MiB. */
const MAXMEM = 256 * 1024 * 1024;
const PEPPER_MIN = 32;

export type PinRefusal = "not_six_digits" | "repeated" | "run";

export function checkPin(pin: string): { ok: true } | { ok: false; reason: PinRefusal } {
  if (!/^[0-9]{6}$/.test(pin)) return { ok: false, reason: "not_six_digits" };
  const d = [...pin].map(Number);
  if (d.every((x) => x === d[0])) return { ok: false, reason: "repeated" };
  const up = d.every((x, i) => i === 0 || x === d[i - 1]! + 1);
  const down = d.every((x, i) => i === 0 || x === d[i - 1]! - 1);
  if (up || down) return { ok: false, reason: "run" };
  return { ok: true };
}

export function pinPepperConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.OWNER_LINE_PIN_PEPPER?.trim().length ?? 0) >= PEPPER_MIN;
}

function peppered(pin: string, env: NodeJS.ProcessEnv): string {
  // Two messages, neither carrying the value or its length.
  const pepper = env.OWNER_LINE_PIN_PEPPER?.trim();
  if (!pepper) throw new Error("owner line: OWNER_LINE_PIN_PEPPER is not set");
  if (pepper.length < PEPPER_MIN) {
    throw new Error(`owner line: OWNER_LINE_PIN_PEPPER is too short (it needs at least ${PEPPER_MIN} characters)`);
  }
  const key = createHash("sha256").update(`bis-owner-line-pin:${pepper}`).digest();
  return createHmac("sha256", key).update(pin, "utf8").digest("base64url");
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPin(pin: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const password = peppered(pin, env);
  const salt = randomBytes(16).toString("base64url");
  return `${PIN_PARAMS_PREFIX}${salt}:${(await derive(password, salt)).toString("base64url")}`;
}

/** The string owner_line_attempt_pin compares. Null for a malformed prefix or an entry that is not 6 digits. */
export async function candidateFor(pin: string, pinParams: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const password = peppered(pin, env);   // throws first: a missing pepper is never mistaken for a wrong PIN
  if (!/^[0-9]{6}$/.test(pin)) return null;
  if (pinParams.length !== 36 || !pinParams.startsWith(PIN_PARAMS_PREFIX)) return null;
  const salt = pinParams.slice(PIN_PARAMS_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{22}$/.test(salt)) return null;
  return `${pinParams}:${(await derive(password, salt)).toString("base64url")}`;
}

export function newVerifyCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashVerifyCode(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex");
}
```

- [ ] **Step 4: Run it green.** Use the same command as Step 2. Expected: all pass. Paste the summary line and the logged `N=2^17: … ms`.

- [ ] **Step 5: Mutation probes.** Each must FAIL BY NAME, then revert:
  1. In `candidateFor`, derive at `N = 2 ** 16` → "the candidate for the right PIN … IS the stored hash" FAILS.
  2. In both functions, pass the bare `pin` to `derive` instead of `peppered(...)` → "useless without the pepper" FAILS.
  3. Global `N = 2 ** 16` → "a known answer" and "is the exact shape" FAIL (the prefix is built from N, r and p).
  4. `N = 2 ** 10` with `R = 1` → "a known answer" and "is the exact shape" FAIL.
  5. The pepper domain `bis-owner-line-pin:` → `bis-voice-sip-handoff:` → "a known answer" FAILS.
  6. The raw pepper as the HMAC key instead of its sha256 → "a known answer" FAILS.
  7. `if (up || down)` → `if (up)` → "654321 is refused as run: a descending run" FAILS.
  8. One message for an unset and a short pepper → "names an unset pepper and a short one as different problems" FAILS.

- [ ] **Step 6: Commit.**

  ```bash
  git add apps/web/src/lib/owner-line/secrets.ts apps/web/src/lib/owner-line/secrets.test.ts
  git commit -m "feat(voice): owner line PIN (peppered scrypt N=2^17, trivial PINs refused) and call-in code primitives"
  ```


---

## Task 4: The signed owner pass and header extraction (HIGH, 0.5 day)

**Files:**
- Modify: `apps/web/src/lib/voice/sip-handoff-signature.ts` (`key()` at `:41-45` becomes one use of a domain-keyed derivation; the new exports are appended).
- Modify: `apps/web/src/lib/voice/sip-headers.ts` (append `extractOwnerPass`).
- Test: `apps/web/src/lib/voice/sip-handoff-signature.test.ts` (append a `describe`) and `apps/web/src/lib/voice/sip-headers.test.ts` (append one case).

**Interfaces:**
- Produces:

```ts
export const OWNER_PASS_HEADER = "X-BIS-Owner-Pass";
export const OWNER_PASS_MAX_AGE_MS = 60_000;
export type OwnerPassRole = "owner" | "staff" | "technician";
export function signOwnerPass(handoffToken: string,
  p: { accountId: string; userId: string; role: OwnerPassRole; calledE164: string },
  nowMs: number, env?: NodeJS.ProcessEnv): string | null;
export type OwnerPassCheck =
  | { ok: true; accountId: string; userId: string; role: OwnerPassRole; calledE164: string; issuedAtMs: number }
  | { ok: false; reason: "no-key" | "absent" | "malformed" | "bad-signature" | "expired" };
export function verifyOwnerPass(value: string | null | undefined, handoffToken: string | null, nowMs: number,
  env?: NodeJS.ProcessEnv, maxAgeMs?: number): OwnerPassCheck;
// sip-headers.ts
export function extractOwnerPass(eventData: unknown): string | null;
```

The format is `<issuedAtMs>.<accountId>.<userId>.<role>.<calledDigits>.<hmac>`, six dot-separated parts. Every character is in `[0-9A-Za-z._-]`, so URI encoding leaves it byte-identical, the same property as `X-BIS-Signature` (`:13-17`). The MAC covers `${handoffToken}|${payload}`, keyed by `sha256("bis-voice-owner-pass:" + VOICE_HANDOFF_SECRET)`. That is a separate domain from the handoff key, so neither value can stand in for the other.

- [ ] **Step 1: Write the failing tests** (append to `sip-handoff-signature.test.ts`). Merge the imports into the file's EXISTING import lines: it already imports `signSipHandoff` and `verifySipHandoff`, so a second import statement naming them is a duplicate-binding SyntaxError. The env cast is `as unknown as NodeJS.ProcessEnv`: this repo's `ProcessEnv` requires `NODE_ENV`, so a bare `as NodeJS.ProcessEnv` on an object with a property is TS2352.

```ts
// merged into the existing imports at the top of the file:
import { createHash, createHmac } from "node:crypto";
//   ..., signOwnerPass, verifyOwnerPass, OWNER_PASS_MAX_AGE_MS, } from "./sip-handoff-signature";

describe("the owner pass (F-032 §4.3; plan SC-7, SC-8)", () => {
  const SECRET = "s".repeat(40);
  const env = { VOICE_HANDOFF_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
  const TOKEN = "a".repeat(32);
  const A = "11111111-1111-4111-8111-111111111111";
  const U = "22222222-2222-4222-8222-222222222222";
  const B = "33333333-3333-4333-8333-333333333333";
  const T0 = 1_800_000_000_000;
  const mint = (over: Partial<{ accountId: string; userId: string; role: "owner" | "staff" | "technician"; calledE164: string }> = {}) =>
    signOwnerPass(TOKEN, { accountId: A, userId: U, role: "staff", calledE164: "+19565550100", ...over }, T0, env)!;

  it("round-trips account, person, role and called number", () => {
    expect(verifyOwnerPass(mint(), TOKEN, T0 + 1000, env)).toEqual({
      ok: true, accountId: A, userId: U, role: "staff", calledE164: "+19565550100", issuedAtMs: T0 });
  });
  it("is refused when tampered: another account swapped in keeps the MAC of the first (mutation: MAC over the token only -> FAILS)", () => {
    expect(verifyOwnerPass(mint().replace(A, B), TOKEN, T0, env)).toEqual({ ok: false, reason: "bad-signature" });
    expect(verifyOwnerPass(mint().replace(".staff.", ".owner."), TOKEN, T0, env)).toEqual({ ok: false, reason: "bad-signature" });
  });
  it("is refused when another person is swapped in under the original MAC (mutation: leave userId out of the MAC on both sides -> FAILS)", () => {
    const forged = mint().replace(`.${U}.`, `.${B}.`);
    expect(forged).not.toBe(mint());
    expect(verifyOwnerPass(forged, TOKEN, T0, env)).toEqual({ ok: false, reason: "bad-signature" });
  });
  it("is refused when another called number is swapped in under the original MAC (mutation: leave the called digits out of the MAC on both sides -> FAILS)", () => {
    const forged = mint().replace(".19565550100.", ".19565550199.");
    expect(forged).not.toBe(mint());
    expect(verifyOwnerPass(forged, TOKEN, T0, env)).toEqual({ ok: false, reason: "bad-signature" });
  });
  it("is refused when the issue time is shifted under the original MAC, so the window cannot be moved (mutation: leave issued-at out of the MAC on both sides -> FAILS)", () => {
    const forged = mint().replace(`${T0}.`, `${T0 + 30_000}.`);
    expect(forged).not.toBe(mint());
    expect(verifyOwnerPass(forged, TOKEN, T0 + 30_000, env)).toEqual({ ok: false, reason: "bad-signature" });
  });
  it("a pass dated 60 s ahead of the clock is valid and 61 s ahead is expired (mutation: drop Math.abs -> FAILS)", () => {
    expect(verifyOwnerPass(mint(), TOKEN, T0 - 60_000, env).ok).toBe(true);
    expect(verifyOwnerPass(mint(), TOKEN, T0 - 61_000, env)).toEqual({ ok: false, reason: "expired" });
  });
  it("a clock or window that is not a finite number never verifies (mutation: the plain `Math.abs(nowMs - issued) > maxAgeMs` check -> FAILS)", () => {
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(verifyOwnerPass(mint(), TOKEN, now, env)).toEqual({ ok: false, reason: "expired" });
    }
    expect(verifyOwnerPass(mint(), TOKEN, T0, env, Number.NaN)).toEqual({ ok: false, reason: "expired" });
  });
  it("is never minted on a clock that is not a finite, non-negative number (mutation: drop the clock guard in signOwnerPass -> FAILS)", () => {
    for (const now of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(signOwnerPass(TOKEN, { accountId: A, userId: U, role: "owner", calledE164: "+19565550100" }, now, env)).toBeNull();
    }
    expect(signOwnerPass(TOKEN, { accountId: A, userId: U, role: "owner", calledE164: "+19565550100" }, 0, env)).not.toBeNull();
  });
  it("is bound to this call's handoff token", () => {
    expect(verifyOwnerPass(mint(), "b".repeat(32), T0, env)).toEqual({ ok: false, reason: "bad-signature" });
  });
  it("is valid at 60 s and expired at 61 s (mutation: OWNER_PASS_MAX_AGE_MS = 2 * 60_000 -> FAILS)", () => {
    expect(OWNER_PASS_MAX_AGE_MS).toBe(60_000);
    expect(verifyOwnerPass(mint(), TOKEN, T0 + 60_000, env).ok).toBe(true);
    expect(verifyOwnerPass(mint(), TOKEN, T0 + 61_000, env)).toEqual({ ok: false, reason: "expired" });
  });
  it("is its own key domain: a MAC made with the handoff key is refused (mutation: owner domain = handoff domain -> FAILS)", () => {
    const value = mint();
    const payload = value.slice(0, value.lastIndexOf("."));
    const handoffKey = createHash("sha256").update(`bis-voice-sip-handoff:${SECRET}`).digest();
    const forged = `${payload}.${createHmac("sha256", handoffKey).update(`${TOKEN}|${payload}`).digest("base64url")}`;
    expect(verifyOwnerPass(forged, TOKEN, T0, env)).toEqual({ ok: false, reason: "bad-signature" });
  });
  it("the handoff signature is byte-identical to before the refactor (the existing key derivation is untouched)", () => {
    const sig = signSipHandoff(TOKEN, "+19565550100", "+19565550142", T0, env)!;
    const key = createHash("sha256").update(`bis-voice-sip-handoff:${SECRET}`).digest();
    const payload = `${T0}.19565550100.19565550142`;
    expect(sig).toBe(`${payload}.${createHmac("sha256", key).update(`${TOKEN}|${payload}`).digest("base64url")}`);
    expect(verifySipHandoff(sig, TOKEN, T0, env).ok).toBe(true);
  });
  it("is null with no usable secret, and verify says no-key first", () => {
    expect(signOwnerPass(TOKEN, { accountId: A, userId: U, role: "owner", calledE164: "+19565550100" }, T0, {} as NodeJS.ProcessEnv)).toBeNull();
    expect(verifyOwnerPass("x", TOKEN, T0, {} as NodeJS.ProcessEnv)).toEqual({ ok: false, reason: "no-key" });
  });
  it("refuses a role outside the three and a malformed value", () => {
    expect(signOwnerPass(TOKEN, { accountId: A, userId: U, role: "agency" as never, calledE164: "+19565550100" }, T0, env)).toBeNull();
    expect(verifyOwnerPass("1.2.3", TOKEN, T0, env)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyOwnerPass(null, TOKEN, T0, env)).toEqual({ ok: false, reason: "absent" });
  });
});
```

Append to `sip-headers.test.ts`, adding `extractOwnerPass` to the file's existing import line:

```ts
describe("extractOwnerPass", () => {
  it("reads X-BIS-Owner-Pass verbatim and trimmed, in our own casing and any other (mutation: a case-sensitive name match -> FAILS)", () => {
    const value = "1.a.b.owner.19565550100.mac";
    for (const name of ["X-BIS-Owner-Pass", "x-bis-owner-pass", "X-Bis-Owner-Pass"]) {
      expect(extractOwnerPass(ev([{ name, value: ` ${value} ` }]))).toBe(value);
    }
  });
  it("absent, blank and degenerate inputs -> null", () => {
    expect(extractOwnerPass(ev([{ name: "X-BIS-Signature", value: "v" }]))).toBeNull();
    expect(extractOwnerPass(ev([{ name: "X-BIS-Owner-Pass", value: "  " }]))).toBeNull();
    for (const bad of [null, undefined, {}, { sip_headers: "nope" }, { sip_headers: [] }, 42, { sip_headers: [null] }]) {
      expect(extractOwnerPass(bad)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  pnpm --filter web exec vitest run src/lib/voice/sip-handoff-signature.test.ts src/lib/voice/sip-headers.test.ts
  ```

  Expected: FAIL, `signOwnerPass is not a function` / `extractOwnerPass is not a function`. Paste the line.

- [ ] **Step 3: Implement.** In `sip-handoff-signature.ts`, replace `key()` (`:41-45`) with:

```ts
function derivedKey(domain: string, env: NodeJS.ProcessEnv): Buffer | null {
  const secret = env.VOICE_HANDOFF_SECRET?.trim();
  if (!secret || secret.length < SIP_HANDOFF_MIN_SECRET_LENGTH) return null;
  return createHash("sha256").update(`${domain}:${secret}`).digest();
}

function key(env: NodeJS.ProcessEnv): Buffer | null {
  return derivedKey("bis-voice-sip-handoff", env);
}
```

and append:

```ts
// ---------------------------------------------------------------------------
// THE OWNER PASS (F-032 §4.3). Minted by /api/voice/texml/owner-pin after a correct PIN and carried on the same
// <Sip> URI as X-BIS-Owner-Pass. It says: this call, on this business's number, is this person, in this role. Bound
// to the call's handoff token (the one identifier both legs see; plan SC-7) and to the role at mint (SC-8: the
// webhook requires the live role to EQUAL it). Its own key domain, so a handoff signature can never pass for one.
// Single use is not this file's job: the owner-line calls row the webhook inserts carries the handoff token, and
// calls_handoff_token_unique (0037) refuses a second redemption.
export const OWNER_PASS_HEADER = "X-BIS-Owner-Pass";
export const OWNER_PASS_MAX_AGE_MS = 60_000;
export type OwnerPassRole = "owner" | "staff" | "technician";
const PASS_ROLES: readonly string[] = ["owner", "staff", "technician"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function ownerKey(env: NodeJS.ProcessEnv): Buffer | null {
  return derivedKey("bis-voice-owner-pass", env);
}

export function signOwnerPass(
  handoffToken: string, p: { accountId: string; userId: string; role: OwnerPassRole; calledE164: string },
  nowMs: number, env: NodeJS.ProcessEnv = process.env,
): string | null {
  const k = ownerKey(env);
  const called = digitsOf(p.calledE164);
  if (!k || !handoffToken || !Number.isFinite(nowMs) || nowMs < 0 || !UUID.test(p.accountId) || !UUID.test(p.userId)
      || !PASS_ROLES.includes(p.role) || !DIGITS.test(called)) return null;
  const payload = `${Math.trunc(nowMs)}.${p.accountId}.${p.userId}.${p.role}.${called}`;
  return `${payload}.${mac(k, handoffToken, payload)}`;
}

export type OwnerPassCheck =
  | { ok: true; accountId: string; userId: string; role: OwnerPassRole; calledE164: string; issuedAtMs: number }
  | { ok: false; reason: "no-key" | "absent" | "malformed" | "bad-signature" | "expired" };

export function verifyOwnerPass(
  value: string | null | undefined, handoffToken: string | null, nowMs: number,
  env: NodeJS.ProcessEnv = process.env, maxAgeMs: number = OWNER_PASS_MAX_AGE_MS,
): OwnerPassCheck {
  const k = ownerKey(env);
  if (!k) return { ok: false, reason: "no-key" };
  if (!value) return { ok: false, reason: "absent" };
  const parts = value.split(".");
  if (parts.length !== 6) return { ok: false, reason: "malformed" };
  const [issuedRaw, accountId, userId, role, called, given] = parts as [string, string, string, string, string, string];
  const issued = Number(issuedRaw);
  if (!/^[0-9]{1,16}$/.test(issuedRaw) || !Number.isFinite(issued) || !UUID.test(accountId) || !UUID.test(userId)
      || !PASS_ROLES.includes(role) || !DIGITS.test(called)) {
    return { ok: false, reason: "malformed" };
  }
  const expected = Buffer.from(mac(k, handoffToken ?? "", `${issuedRaw}.${accountId}.${userId}.${role}.${called}`));
  const actual = Buffer.from(given);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, reason: "bad-signature" };
  // Both directions (a pass from the future is a clock problem or a forgery), and written so that a NaN clock or
  // window can only fail: every comparison with NaN is false.
  if (!Number.isFinite(nowMs) || !(Math.abs(nowMs - issued) <= maxAgeMs)) return { ok: false, reason: "expired" };
  return { ok: true, accountId, userId, role: role as OwnerPassRole, calledE164: `+${called}`, issuedAtMs: issued };
}
```

In `sip-headers.ts`, append:

```ts
/**
 * The owner pass our owner-pin route put on the SIP URI as `X-BIS-Owner-Pass` (sip-handoff-signature.ts), verbatim.
 * Null when absent, which is every customer call. Never logged: it is a credential.
 */
export function extractOwnerPass(eventData: unknown): string | null {
  return rawHeader(headers(eventData), "x-bis-owner-pass");
}
```

- [ ] **Step 4: Run green.** Use the Step 2 command, plus the existing signature users:

  ```bash
  pnpm --filter web exec vitest run src/lib/voice/sip-handoff-signature.test.ts src/lib/voice/sip-headers.test.ts src/app/api/voice/incoming/webhook-signing.test.ts src/app/api/voice/texml
  ```

  Expected: green. The handoff signature's own tests are unchanged. Paste the summary line.

- [ ] **Step 5: Mutation probes.** Each must FAIL BY NAME:
  1. `OWNER_PASS_MAX_AGE_MS = 2 * 60_000` → "is valid at 60 s and expired at 61 s" FAILS.
  2. `ownerKey` returns `derivedKey("bis-voice-sip-handoff", env)` → "is its own key domain" FAILS.
  3. Make the MAC cover the handoff token ONLY, on BOTH sides: pass `""` as the payload to `mac(...)` in `signOwnerPass` AND in `verifyOwnerPass` → "is refused when tampered" FAILS, because a swapped account or role now verifies. (Mutating only the signer would fail the round-trip case instead and leave the tamper case green, so the probe changes both.)
  4. Leave userId out of the MAC on both sides → "is refused when another person is swapped in" FAILS.
  5. Leave the called digits out of the MAC on both sides → "is refused when another called number is swapped in" FAILS.
  6. Leave issued-at out of the MAC on both sides → "is refused when the issue time is shifted" FAILS.
  7. `Math.abs(nowMs - issued)` → `nowMs - issued` → "a pass dated 60 s ahead of the clock …" FAILS.
  8. The plain `Math.abs(nowMs - issued) > maxAgeMs` check (no finite guard) → "a clock or window that is not a finite number never verifies" FAILS.
  9. Drop `!Number.isFinite(nowMs) || nowMs < 0` from `signOwnerPass` → "is never minted on a clock that is not a finite, non-negative number" FAILS.
  10. A case-sensitive name match in `extractOwnerPass` → "reads X-BIS-Owner-Pass verbatim and trimmed, in our own casing and any other" FAILS.

  Several mutated lines also occur, verbatim, in the handoff signature's own code (`mac(k, handoffToken, payload)`, `derivedKey("bis-voice-sip-handoff", env)`, `Math.abs(nowMs - issued) > maxAgeMs`). Scope each edit and each revert to the owner functions, and byte-check the file afterwards. `verifySipHandoff` keeps its inherited `Math.abs(nowMs - issued) > maxAgeMs`, which a NaN clock passes; that is out of this PR's scope and is recorded as a finding.

- [ ] **Step 6: Commit.**

  ```bash
  git add apps/web/src/lib/voice/sip-handoff-signature.ts apps/web/src/lib/voice/sip-handoff-signature.test.ts apps/web/src/lib/voice/sip-headers.ts apps/web/src/lib/voice/sip-headers.test.ts
  git commit -m "feat(voice): the owner pass: a 60-second, role-bound signature on the SIP URI, its own key domain beside X-BIS-Signature"
  ```

---

## Task 5: Setup actions: enrol and verify the cell, set or remove the PIN, the Team switch (HIGH, 0.75 day)

**Files:**
- Create: `apps/web/src/lib/owner-line/data-path.ts`. **The ONE module that holds the Task 0 decision.**
- Create: `apps/web/src/lib/owner-line/memberships.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/preferences/owner-line-actions.ts` and `owner-line-actions.test.ts`
- Create: `ACCT/team/owner-line-actions.ts` and `owner-line-actions.test.ts`
- Modify: `ACCT/access-log-routes.test.ts` (one line in `NOT_A_RECORD_ACTIONS`)
- Modify: `apps/web/src/lib/messages.ts` (append the `ownerLine.error.*` and `ownerLine.switch.*` keys with their `.es` twins)
- Modify (bis-db, additive, its own symbol only): `packages/db/src/events.ts` gains `emitAgencyEvent`; add it to `packages/db/src/index.ts:4`'s named `./events` export (that line names each symbol; there is no `export *` for events). Create `packages/db/src/test/events-agency.test.ts`.

**Interfaces:**
- Consumes (Task 2): `readMyOwnerLineEnrollment`, `startOwnerLineVerification`, `setOwnerLinePin`, `removeOwnerLinePin`, `removeOwnerLineEnrollment`, `setOwnerLineSwitch`, `OwnerLineSwitchState`, `OWNER_LINE_VERIFY_MINUTES`.
- Consumes (this task, bis-db): `emitAgencyEvent(db, type, actorClerkUserId, payload)`.
- **`startOwnerLineVerification` answers `"ok" | "taken" | "too_many"` (Task 5 review I-2).** On `too_many` nothing was stored, so the action must NOT show the code it generated; it fails with its own copy ("You've asked for five codes today. Try again tomorrow." / *usted* Spanish), as it fails on `taken`. `readMyOwnerLineEnrollment` answers null for a cell that was displaced or removed, exactly as for none, and `removeOwnerLineEnrollment` clears rather than deletes; neither changes the action's code.

**Which BIS person turned the switch off (owner ruling 2026-11-09, "Say BIS, keep names private").** `accounts` stores only the who-kind, so the person goes in BIS's own record: one `events` row with `account_id` NULL, `type 'owner_line.switch_off'`, `actor_type 'user'`, `actor_id` = the BIS person's Clerk user id, `payload { account_id, changed_at }`, written on `serviceDb()`. Why that row and not the existing patterns, measured on the replica 2026-11-09: an account-scoped event is readable by the client's Owner AND Staff (`events_read`, 0109:198: `is_agency() or account_id = current_account_id()`), so its `actor_id` would name the BIS person to them; an access-log item is Owner-readable next to the visit's `actor_name` on the same Team page. With `account_id` null only `is_agency()` and service_role read the row (Owner 0, Staff 0, agency 1). These rows **outlive `deleteAccountCascade`** (it deletes events by `account_id`), so any test that writes one deletes it itself, by its id.

```ts
// packages/db/src/events.ts (additive)
/**
 * An AGENCY-ONLY record (account_id null): events_read (0109) shows it to the agency and to service_role, never to a
 * client member. For what BIS did that the client must not see by name (F-032: which BIS person turned a switch off).
 * The service client only: a user client cannot write events at all (0053), and record_event would stamp its sub.
 */
export async function emitAgencyEvent(
  db: SupabaseClient, type: string, actorClerkUserId: string, payload: object,
): Promise<void> {
  if (isUserClient(db)) throw new Error(`event emit failed: an agency-only event needs the service client (${type})`);
  const { error } = await db.from("events").insert({ account_id: null, type, actor_type: "user", actor_id: actorClerkUserId, payload });
  if (error) throw new Error(`event emit failed: ${error.message}`);
}
```

`events-agency.test.ts` holds two cases: a fake-builder unit case that the inserted row is exactly `{ account_id: null, type, actor_type: "user", actor_id, payload }` and that a user client is refused before any write (mutation: send `account_id: payload.account_id` -> FAILS), and a `withRollback` case that seeds one null-account event and one account event for the same account and reads them as the account's Owner, its Staff and the agency: 0 / 1, 0 / 1 and 1 (mutation: write the account's id -> the Owner case FAILS). Both run on the replica and in CI verify; neither writes a row that outlives its transaction.
- Consumes (Task 3): `checkPin`, `hashPin`, `newVerifyCode`, `hashVerifyCode`.
- Consumes: `requireAccountOwner(accountId)` (`WEB/lib/auth.ts:104-110`, which returns `{ userId, isAgency }`, userId being the Clerk user id), `e164Of` (`WEB/lib/voice/phone-number.ts:17`), `getPhoneNumberByE164` (`DB/voice.ts:101`).
- Produces:

```ts
// lib/owner-line/data-path.ts
export type OwnerLineDataPath = "token" | "service";
export const OWNER_LINE_DATA_PATH: OwnerLineDataPath;     // set from the Task 0 decision record
export const OWNER_LINE_ROLES: readonly AccountRole[];   // token: all three; service (F2): owner, staff
// lib/owner-line/memberships.ts
export type MyMembership = { accountId: string; userId: string; role: AccountRole; businessName: string; number: string | null };
export async function listMyMemberships(db: SupabaseClient, clerkUserId: string): Promise<MyMembership[]>;
export async function myMembership(db: SupabaseClient, clerkUserId: string, accountId: string): Promise<MyMembership | null>;
// preferences/owner-line-actions.ts ("use server"); every one keyed on auth().userId, never a person id argument
export type OwnerLineResult<T = null> = { ok: true; value: T } | { ok: false; error: string };
export async function startOwnerLineVerificationAction(accountId: string, locale: Locale, cell: string): Promise<OwnerLineResult<{ code: string; expiresAt: string }>>;
export async function setOwnerLinePinAction(accountId: string, locale: Locale, pin: string): Promise<OwnerLineResult>;
export async function removeOwnerLinePinAction(accountId: string, locale: Locale): Promise<OwnerLineResult>;
export async function removeOwnerLineCellAction(accountId: string, locale: Locale): Promise<OwnerLineResult>;
// team/owner-line-actions.ts ("use server")
export async function setOwnerLineSwitchAction(accountId: string, locale: Locale, on: boolean): Promise<OwnerLineResult<OwnerLineSwitchState>>;   // agency: OFF only (Q-A)
```

- [ ] **Step 1: Write `data-path.ts` from the decision record** (no test of its own; Task 10 pins it):

```ts
// apps/web/src/lib/owner-line/data-path.ts
// THE ONE PLACE the Task 0 decision lives (docs/superpowers/specs/2026-11-09-owner-line-spike.md, decided by the
// owner on <date>). Only `ownerLineReadClient` (./reader.ts) branches on OWNER_LINE_DATA_PATH; the setup card and
// the answer route read OWNER_LINE_ROLES. "token": reads run as the person through a minted token, RLS decides,
// Technicians included. "service" (F2, plan SC-2): service-role reads scoped to the account, which equal what an
// Owner or Staff member sees; a Technician is not offered the owner line, because their scope lives only in RLS.
import type { AccountRole } from "@bis/db";

export type OwnerLineDataPath = "token" | "service";
export const OWNER_LINE_DATA_PATH: OwnerLineDataPath = "token";
export const OWNER_LINE_ROLES: readonly AccountRole[] =
  OWNER_LINE_DATA_PATH === "token" ? ["owner", "staff", "technician"] : ["owner", "staff"];
```

  If the owner chose F2, write `"service"` on the `OWNER_LINE_DATA_PATH` line. Nothing else in the plan changes.

- [ ] **Step 2: Write the failing action tests.**

```ts
// apps/web/src/app/(dashboard)/dashboard/preferences/owner-line-actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  redirect: vi.fn((to: string) => { throw new Error(`NEXT_REDIRECT ${to}`); }),
  my: vi.fn(),
  phone: vi.fn(),
  read: vi.fn(),
  start: vi.fn(),
  setPin: vi.fn(),
  removePin: vi.fn(),
  removeCell: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/owner-line/memberships", () => ({ myMembership: mocks.my }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}), OWNER_LINE_VERIFY_MINUTES: 10,
  getPhoneNumberByE164: mocks.phone, readMyOwnerLineEnrollment: mocks.read, startOwnerLineVerification: mocks.start,
  setOwnerLinePin: mocks.setPin, removeOwnerLinePin: mocks.removePin, removeOwnerLineEnrollment: mocks.removeCell,
}));

import {
  startOwnerLineVerificationAction, setOwnerLinePinAction, removeOwnerLinePinAction, removeOwnerLineCellAction,
} from "./owner-line-actions";

const A = "11111111-1111-4111-8111-111111111111";
const ME = { accountId: A, userId: "u-me", role: "staff", businessName: "Rio Roofing", number: "+19565550100" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OWNER_LINE_PIN_PEPPER = "p".repeat(40);
  mocks.auth.mockResolvedValue({ userId: "user_clerk_me" });
  mocks.my.mockResolvedValue(ME);
  mocks.phone.mockResolvedValue(null);
  mocks.read.mockResolvedValue(null);
  mocks.start.mockResolvedValue("ok");
  mocks.setPin.mockResolvedValue(true);
});

describe("the owner line's setup actions (F-032 §3.1, §3.2; SC-4)", () => {
  it("signed out: redirected, nothing written (mutation: drop the !userId redirect -> FAILS)", async () => {
    mocks.auth.mockResolvedValue({ userId: null });
    await expect(startOwnerLineVerificationAction(A, "en", "956 555 0142")).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("not a member of the named business: refused, nothing written (mutation: skip the membership check -> FAILS)", async () => {
    mocks.my.mockResolvedValue(null);
    expect(await startOwnerLineVerificationAction(A, "en", "956 555 0142")).toMatchObject({ ok: false });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("a role the data path does not offer is refused like a non-member (F2: a Technician; mutation: drop the OWNER_LINE_ROLES filter in me() -> FAILS)", async () => {
    vi.resetModules();
    vi.doMock("@/lib/owner-line/data-path", () => ({ OWNER_LINE_DATA_PATH: "service", OWNER_LINE_ROLES: ["owner", "staff"] }));
    const { startOwnerLineVerificationAction: start } = await import("./owner-line-actions");
    mocks.my.mockResolvedValue({ ...ME, role: "technician" });
    expect(await start(A, "en", "956 555 0142")).toMatchObject({ ok: false });
    expect(mocks.start).not.toHaveBeenCalled();
    vi.doUnmock("@/lib/owner-line/data-path");
  });

  it("no pepper: the PIN is refused with words and nothing is stored (O-3)", async () => {
    delete process.env.OWNER_LINE_PIN_PEPPER;
    expect(await setOwnerLinePinAction(A, "en", "482913")).toMatchObject({ ok: false });
    expect(mocks.setPin).not.toHaveBeenCalled();
  });

  it("writes as the signed-in person only: the user id comes from the Clerk session's membership, never an argument", async () => {
    const r = await startOwnerLineVerificationAction(A, "en", "(956) 555-0142");
    expect(r).toMatchObject({ ok: true, value: { code: expect.stringMatching(/^[0-9]{6}$/) } });
    expect(mocks.my).toHaveBeenCalledWith({}, "user_clerk_me", A);
    expect(mocks.start).toHaveBeenCalledWith({}, A, "u-me", "+19565550142", expect.stringMatching(/^[0-9a-f]{64}$/));
  });

  it("refuses a business's own number as a cell (it would ring straight back into Sofía)", async () => {
    mocks.phone.mockResolvedValue({ id: "pn" });
    expect(await startOwnerLineVerificationAction(A, "en", "+19565550100")).toMatchObject({ ok: false });
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it("a cell someone else on the business holds is refused with words", async () => {
    mocks.start.mockResolvedValue("taken");
    expect(await startOwnerLineVerificationAction(A, "es", "+19565550142")).toEqual({
      ok: false, error: expect.stringMatching(/./) });
  });

  it("a trivial PIN is refused with its reason, and nothing is hashed or stored (mutation: skip checkPin -> FAILS)", async () => {
    expect(await setOwnerLinePinAction(A, "en", "123456")).toMatchObject({ ok: false });
    expect(mocks.setPin).not.toHaveBeenCalled();
  });

  it("a good PIN is stored as an 80-character scrypt string, never the digits", async () => {
    expect(await setOwnerLinePinAction(A, "en", "482913")).toEqual({ ok: true, value: null });
    const stored = mocks.setPin.mock.calls[0]![3] as string;
    expect(stored).toHaveLength(80);
    expect(stored).not.toContain("482913");
  });

  it("a PIN before the cell is verified is refused", async () => {
    mocks.setPin.mockResolvedValue(false);
    expect(await setOwnerLinePinAction(A, "en", "482913")).toMatchObject({ ok: false });
  });

  it("removing the PIN and the cell act on the signed-in person's row only", async () => {
    await removeOwnerLinePinAction(A, "en");
    await removeOwnerLineCellAction(A, "en");
    expect(mocks.removePin).toHaveBeenCalledWith({}, A, "u-me");
    expect(mocks.removeCell).toHaveBeenCalledWith({}, A, "u-me");
  });
});
```

```ts
// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/team/owner-line-actions.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({ owner: vi.fn(), set: vi.fn(), emit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAccountOwner: mocks.owner }));
vi.mock("@bis/db", () => ({ serviceDb: () => ({}), setOwnerLineSwitch: mocks.set, emitAgencyEvent: mocks.emit }));

import { setOwnerLineSwitchAction } from "./owner-line-actions";

const A = "11111111-1111-4111-8111-111111111111";
const ON = { enabledAt: "2026-11-09T20:00:00.000Z", changedAt: "2026-11-09T20:00:00.000Z", changedByKind: "owner" };
const OFF = { enabledAt: null, changedAt: "2026-11-09T20:00:00.000Z", changedByKind: "agency" };
const OWNER_OFF = { enabledAt: null, changedAt: "2026-11-09T19:00:00.000Z", changedByKind: "owner" };
beforeEach(() => { vi.clearAllMocks(); mocks.emit.mockResolvedValue(undefined); });

describe("the business's switch (F-032 §3.3; owner rulings Q-A and 2026-11-09)", () => {
  it("the client's Owner turns it on as the Owner's kind, and no agency record is written", async () => {
    // requireAccountOwner returns { userId, isAgency } (WEB/lib/auth.ts:104-110); userId is the Clerk user id.
    mocks.owner.mockResolvedValue({ userId: "user_owner", isAgency: false });
    mocks.set.mockResolvedValue({ changed: true, state: ON });
    expect(await setOwnerLineSwitchAction(A, "en", true)).toEqual({ ok: true, value: ON });
    expect(mocks.set).toHaveBeenCalledWith({}, A, true, "owner");
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("the agency's ON is refused, and nothing is written (mutation: drop the agency-ON refusal -> FAILS)", async () => {
    mocks.owner.mockResolvedValue({ userId: "user_bis", isAgency: true });
    expect(await setOwnerLineSwitchAction(A, "en", true)).toMatchObject({ ok: false });
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("the agency's OFF works as the agency's kind, and BIS's own record names the person (mutations: record 'owner' -> FAILS; drop the emit -> FAILS)", async () => {
    mocks.owner.mockResolvedValue({ userId: "user_bis", isAgency: true });
    mocks.set.mockResolvedValue({ changed: true, state: OFF });
    expect(await setOwnerLineSwitchAction(A, "en", false)).toEqual({ ok: true, value: OFF });
    expect(mocks.set).toHaveBeenCalledWith({}, A, false, "agency");
    expect(mocks.emit).toHaveBeenCalledWith({}, "owner_line.switch_off", "user_bis", { account_id: A, changed_at: OFF.changedAt });
  });
  it("the agency's OFF on a switch the Owner already turned off changes nothing and records nothing (re-review m-E; mutation: emit without checking changed -> FAILS)", async () => {
    mocks.owner.mockResolvedValue({ userId: "user_bis", isAgency: true });
    mocks.set.mockResolvedValue({ changed: false, state: OWNER_OFF });
    expect(await setOwnerLineSwitchAction(A, "en", false)).toEqual({ ok: true, value: OWNER_OFF });
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it("staff never reach it: requireAccountOwner redirects them", async () => {
    mocks.owner.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(setOwnerLineSwitchAction(A, "en", true)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
```

`setOwnerLineSwitch` itself also refuses an agency ON (Task 2), so no other caller can bypass the action. **`setOwnerLineSwitch` throws `setOwnerLineSwitch: no such account <id>` when the account does not exist (Task 2 review m-3); it never answers an all-null "off".** The action calls it only after `requireAccountOwner(accountId)` has found the account, so the throw is reachable only if the account is deleted in between. The action needs no handling of its own: like every other database error it surfaces as the action's failure, and nothing was written. **That case is already in `owner-line-counting.test.ts` (Task 2): the round trip asserts the wrapper's own refusal, and the m-E case pins the no-op. Do not append the block below; it is kept only as the record of what Task 2 now covers:**

```ts
it("setOwnerLineSwitch refuses an agency ON before writing, and records an agency OFF as the agency's kind (mutation: drop its guard -> FAILS)", () =>
  withTestAccount(async (db, accountId) => {
    await expect(setOwnerLineSwitch(db, accountId, true, "agency")).rejects.toThrow("setOwnerLineSwitch: the agency cannot turn the owner line on");
    expect((await readOwnerLineSwitch(db, accountId)).enabledAt).toBeNull();
    const off = await setOwnerLineSwitch(db, accountId, false, "agency");
    expect(off).toMatchObject({ changed: false, state: { enabledAt: null } });   // already off: nothing to record
  }));
```

- [ ] **Step 3: Run both test files and see them fail.**

  ```bash
  pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/preferences/owner-line-actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/team/owner-line-actions.test.ts"
  ```

  Expected: FAIL, `Failed to resolve import "./owner-line-actions"`. Paste the line.

- [ ] **Step 4: Implement `memberships.ts`.**

```ts
// apps/web/src/lib/owner-line/memberships.ts
// A person's own business memberships, for the "Call in to your business" card (F-032 §3.1: one card per
// membership). serviceDb() keyed on Clerk's own userId, the pre-trust read preferences/actions.ts and
// person-prefs.ts already use; the businesses come back only through the person's own memberships, and only those
// with client access on and not archived. businessName is brandDisplayName's answer, never accounts.name.
import type { SupabaseClient, AccountRole, Branding } from "@bis/db";
import { brandDisplayName } from "@/lib/email/templates/shell";

export type MyMembership = { accountId: string; userId: string; role: AccountRole; businessName: string; number: string | null };

type Row = {
  account_id: string; user_id: string; role: AccountRole;
  accounts: { client_access_enabled: boolean; status: string; brand_name: string | null } | null;
};

export async function listMyMemberships(db: SupabaseClient, clerkUserId: string): Promise<MyMembership[]> {
  const { data, error } = await db.from("memberships")
    .select("account_id, user_id, role, users!inner(clerk_user_id), accounts!inner(client_access_enabled, status, brand_name)")
    .eq("scope", "account").eq("users.clerk_user_id", clerkUserId);
  if (error) throw new Error(`listMyMemberships failed: ${error.message}`);
  const rows = ((data ?? []) as unknown as Row[])
    .filter((r) => r.accounts?.client_access_enabled === true && r.accounts.status !== "archived");
  if (rows.length === 0) return [];
  const { data: nums, error: nErr } = await db.from("phone_numbers")
    .select("account_id, e164, status").in("account_id", rows.map((r) => r.account_id)).in("status", ["live", "testing"]);
  if (nErr) throw new Error(`listMyMemberships numbers failed: ${nErr.message}`);
  const numberOf = (id: string) => {
    const mine = ((nums ?? []) as { account_id: string; e164: string; status: string }[]).filter((n) => n.account_id === id);
    return (mine.find((n) => n.status === "live") ?? mine[0])?.e164 ?? null;
  };
  return rows.map((r) => ({
    accountId: r.account_id, userId: r.user_id, role: r.role, number: numberOf(r.account_id),
    businessName: brandDisplayName({ brandName: r.accounts?.brand_name ?? null } as Branding),
  }));
}

export async function myMembership(db: SupabaseClient, clerkUserId: string, accountId: string): Promise<MyMembership | null> {
  return (await listMyMemberships(db, clerkUserId)).find((x) => x.accountId === accountId) ?? null;
}
```

  Read `brandDisplayName` (`WEB/lib/email/templates/shell.ts:46`) before this step. If it reads any `Branding` field besides `brandName`, select those columns too, rather than casting.

- [ ] **Step 5: Implement the two action files.**

```ts
// apps/web/src/app/(dashboard)/dashboard/preferences/owner-line-actions.ts
"use server";

import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  serviceDb, getPhoneNumberByE164, readMyOwnerLineEnrollment, startOwnerLineVerification, setOwnerLinePin,
  removeOwnerLinePin, removeOwnerLineEnrollment, OWNER_LINE_VERIFY_MINUTES,
} from "@bis/db";
import { myMembership, type MyMembership } from "@/lib/owner-line/memberships";
import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";
import { checkPin, hashPin, newVerifyCode, hashVerifyCode, pinPepperConfigured } from "@/lib/owner-line/secrets";
import { e164Of } from "@/lib/voice/phone-number";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * "Call in to your business" (F-032 §3.1, §3.2; plan SC-4). NO person id parameter, by design: auth() is the only
 * source of the row these actions touch, and the business named must be one of THAT person's memberships, in a role
 * the owner line is offered to (OWNER_LINE_ROLES). Writes go through serviceDb() (the table has no client grant).
 */
export type OwnerLineResult<T = null> = { ok: true; value: T } | { ok: false; error: string };

const lc = (l: Locale): Locale => (l === "es" ? "es" : "en");
const fail = (locale: Locale, key: keyof typeof m): { ok: false; error: string } => ({ ok: false, error: t(m, key, lc(locale)) });

async function me(accountId: string): Promise<MyMembership | null> {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  const mine = await myMembership(serviceDb(), userId, accountId);
  return mine && OWNER_LINE_ROLES.includes(mine.role) ? mine : null;
}

export async function startOwnerLineVerificationAction(
  accountId: string, locale: Locale, cell: string,
): Promise<OwnerLineResult<{ code: string; expiresAt: string }>> {
  const mine = await me(accountId);
  if (!mine) return fail(locale, "ownerLine.error.notMember");
  const e164 = e164Of(cell);
  if (!e164) return fail(locale, "ownerLine.error.cell");
  const db = serviceDb();
  if (await getPhoneNumberByE164(db, e164)) return fail(locale, "ownerLine.error.cellIsBusiness");
  const existing = await readMyOwnerLineEnrollment(db, accountId, mine.userId);
  if (existing?.verifiedAt && existing.e164 === e164) return fail(locale, "ownerLine.error.alreadyVerified");
  const code = newVerifyCode();
  if (await startOwnerLineVerification(db, accountId, mine.userId, e164, hashVerifyCode(code)) === "taken") {
    return fail(locale, "ownerLine.error.cellTaken");
  }
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: { code, expiresAt: new Date(Date.now() + OWNER_LINE_VERIFY_MINUTES * 60_000).toISOString() } };
}

export async function setOwnerLinePinAction(accountId: string, locale: Locale, pin: string): Promise<OwnerLineResult> {
  const mine = await me(accountId);
  if (!mine) return fail(locale, "ownerLine.error.notMember");
  const check = checkPin(pin.trim());
  if (!check.ok) return fail(locale, `ownerLine.error.pin.${check.reason}` as keyof typeof m);
  // No pepper is a deployment fault (O-3), never a reason to store an unpeppered hash.
  if (!pinPepperConfigured()) return fail(locale, "ownerLine.error.notReady");
  if (!(await setOwnerLinePin(serviceDb(), accountId, mine.userId, await hashPin(pin.trim())))) {
    return fail(locale, "ownerLine.error.notVerified");
  }
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: null };
}

export async function removeOwnerLinePinAction(accountId: string, locale: Locale): Promise<OwnerLineResult> {
  const mine = await me(accountId);
  if (!mine) return fail(locale, "ownerLine.error.notMember");
  await removeOwnerLinePin(serviceDb(), accountId, mine.userId);
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: null };
}

export async function removeOwnerLineCellAction(accountId: string, locale: Locale): Promise<OwnerLineResult> {
  const mine = await me(accountId);
  if (!mine) return fail(locale, "ownerLine.error.notMember");
  await removeOwnerLineEnrollment(serviceDb(), accountId, mine.userId);
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: null };
}
```

```ts
// apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/team/owner-line-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { serviceDb, setOwnerLineSwitch, emitAgencyEvent, type OwnerLineSwitchState } from "@bis/db";
import { requireAccountOwner } from "@/lib/auth";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

/**
 * "Let your team call in to hear the day" (F-032 §3.3; plan SC-1; owner ruling Q-A). requireAccountOwner admits the
 * agency and a client Owner, and returns { userId, isAgency } (WEB/lib/auth.ts:104-110).
 *   - The client's Owner turns it on or off.
 *   - The agency may turn it OFF, a protective act (a lost phone, a person let go), and never ON: the client's Owner
 *     decides who may phone into their data.
 * Every change records WHEN and WHAT KIND of person (shown on the card: "Turned off by BIS"), never who (owner ruling
 * 2026-11-09). Which BIS person turned it off is BIS's own null-account event, read by the agency only. The switch is
 * written first: an OFF is protective, so a failed audit write must not leave it on; the error then surfaces.
 */
export async function setOwnerLineSwitchAction(
  accountId: string, locale: Locale, on: boolean,
): Promise<{ ok: true; value: OwnerLineSwitchState } | { ok: false; error: string }> {
  const { userId, isAgency } = await requireAccountOwner(accountId);
  if (on && isAgency) return { ok: false, error: t(m, "ownerLine.switch.agencyCannot", locale === "es" ? "es" : "en") };
  const db = serviceDb();
  const { changed, state } = await setOwnerLineSwitch(db, accountId, on === true, isAgency ? "agency" : "owner");
  // Only a real change is BIS's to record (re-review m-E): asking for the state it is already in wrote nothing.
  if (isAgency && changed) {
    await emitAgencyEvent(db, "owner_line.switch_off", userId, { account_id: accountId, changed_at: state.changedAt });
  }
  revalidatePath(`/dashboard/accounts/${accountId}/team`);
  revalidatePath("/dashboard/preferences");
  return { ok: true, value: state };
}
```

- [ ] **Step 6: Add the copy keys to `messages.ts`** (append in one block under a `// F-032 owner line` comment, inside the `m` object; additive only):

```ts
  // F-032 owner line (plan Tasks 5-9, 11, 13). Spanish is usted; Owner is "Dueño".
  "ownerLine.error.notMember": "You can't set this up for that business.",
  "ownerLine.error.notMember.es": "No puede configurar esto para ese negocio.",
  "ownerLine.error.cell": "Enter your cell number with its area code.",
  "ownerLine.error.cell.es": "Escriba su número de celular con el código de área.",
  "ownerLine.error.cellIsBusiness": "That is one of your business's own numbers. Enter your personal cell.",
  "ownerLine.error.cellIsBusiness.es": "Ese es uno de los números de su negocio. Escriba su celular personal.",
  "ownerLine.error.cellTaken": "Someone else on your team already uses that cell here.",
  "ownerLine.error.cellTaken.es": "Otra persona de su equipo ya usa ese celular aquí.",
  "ownerLine.error.alreadyVerified": "That cell is already verified.",
  "ownerLine.error.alreadyVerified.es": "Ese celular ya está verificado.",
  "ownerLine.error.notVerified": "Verify your cell first.",
  "ownerLine.error.notVerified.es": "Primero verifique su celular.",
  "ownerLine.error.notReady": "Calling in is not ready yet. Try again later.",
  "ownerLine.error.notReady.es": "Las llamadas todavía no están listas. Intente más tarde.",
  "ownerLine.error.pin.not_six_digits": "Your PIN must be exactly 6 digits.",
  "ownerLine.error.pin.not_six_digits.es": "Su PIN debe tener exactamente 6 dígitos.",
  "ownerLine.error.pin.repeated": "Use different digits. A PIN like 000000 is too easy to guess.",
  "ownerLine.error.pin.repeated.es": "Use dígitos distintos. Un PIN como 000000 es muy fácil de adivinar.",
  "ownerLine.error.pin.run": "Avoid digits in a row. A PIN like 123456 is too easy to guess.",
  "ownerLine.error.pin.run.es": "Evite dígitos seguidos. Un PIN como 123456 es muy fácil de adivinar.",
  "ownerLine.switch.agencyCannot": "Only the business's Owner can turn this on.",
  "ownerLine.switch.agencyCannot.es": "Solo el Dueño del negocio puede encenderlo.",
```

- [ ] **Step 7: Classify the guarded action** in `ACCT/access-log-routes.test.ts`'s `NOT_A_RECORD_ACTIONS`, beside the `team/actions.ts` line:

  ```ts
  ...each(`${A}/team/owner-line-actions.ts`, ["setOwnerLineSwitchAction"], CFG),
  ```

- [ ] **Step 8: Run green, with the gates this task touches.**

  ```bash
  pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/preferences/owner-line-actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/team/owner-line-actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/access-log-routes.test.ts" src/lib/i18n src/lib/messages.test.ts src/lib/consent/scans.test.ts
  ```

  Expected: green. If `access-log-routes` names the preferences actions file (it calls no guard, so it should not), add its four actions with `CFG` too and say so in the report. If the Spanish style gate (`spanish-style.test.ts`) flags a word, change the Spanish copy, never the gate. Paste the summary line.

- [ ] **Step 9: Mutation probes.** Each must FAIL BY NAME:
  1. Delete `if (on && isAgency) return …` → "the agency's ON is refused" FAILS. Change it to `if (isAgency)` → "the agency's OFF works and is attributed" FAILS.
  2. In `me()`, drop `&& OWNER_LINE_ROLES.includes(mine.role)` → "a role the data path does not offer is refused" FAILS. (The earlier probe, which also dropped the null check, failed only the non-member case, so the role case would have stayed green.)
  3. Skip `checkPin` → "a trivial PIN is refused" FAILS.

- [ ] **Step 10: Commit.**

  ```bash
  git add apps/web/src/lib/owner-line/data-path.ts apps/web/src/lib/owner-line/memberships.ts "apps/web/src/app/(dashboard)/dashboard/preferences/owner-line-actions.ts" "apps/web/src/app/(dashboard)/dashboard/preferences/owner-line-actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/team/owner-line-actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/team/owner-line-actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/access-log-routes.test.ts" apps/web/src/lib/messages.ts
  git commit -m "feat(voice): owner line setup actions: verify a cell by call-in code, set a PIN, and the Owner-only business switch"
  ```

---

## Task 6: Setup card on Mis preferencias, switch card on Team, copy, ⌘K words (LOW, 0.75 day)

**Files:**
- Create: `apps/web/src/components/owner-line/owner-line-view.ts` and `owner-line-view.test.ts` (the pure status logic, tested)
- Create: `apps/web/src/components/owner-line/owner-line-card.tsx` and `owner-line-switch-card.tsx` (client)
- Modify: `apps/web/src/app/(dashboard)/dashboard/preferences/page.tsx` (render one card per membership)
- Modify: `ACCT/team/page.tsx` (render the switch card under `TeamSection`, above `BisAccessFrame`)
- Modify: `apps/web/src/lib/messages.ts` (the `ownerLine.card.*` keys)
- Modify: `apps/web/src/lib/palette/registry.ts:113` and `:101` (append keywords to the existing arrays, never reorder)

**Interfaces:**
- Consumes (Task 5): the actions, `listMyMemberships`, `MyMembership`. Consumes (Task 2): `readMyOwnerLineEnrollment`, `readOwnerLineSwitch`.
- Produces:

```ts
export type OwnerLineCardStep = "cell" | "pin" | "ready" | "off" | "locked";
export type OwnerLineCardView = { step: OwnerLineCardStep; cell: string | null;
  status: { key: "ownerLine.card.status.ready" | "ownerLine.card.status.off" | "ownerLine.card.status.locked" | null;
    params: Record<string, string> } };
export function ownerLineCardView(i: { enrollment: OwnerLineEnrollment | null; switchOn: boolean; number: string | null;
  now: Date; zone: string; locale: Locale }): OwnerLineCardView;
export function nationalNumber(e164: string | null): string;
```

- [ ] **Step 1: Write the failing view test.**

```ts
// apps/web/src/components/owner-line/owner-line-view.test.ts
import { describe, it, expect } from "vitest";
import { ownerLineCardView, nationalNumber } from "./owner-line-view";

const NOW = new Date("2026-11-09T20:00:00.000Z");
const base = { switchOn: true, number: "+19565550100", now: NOW, zone: "America/Chicago", locale: "en" as const };
const enr = (over = {}) => ({ id: "e", e164: "+19565550142", verifiedAt: "2026-11-09T19:00:00Z", verifyExpiresAt: null,
  pinSetAt: "2026-11-09T19:01:00Z", lockedUntil: null, ...over });

describe("the card's status line in words (spec §3.1)", () => {
  it("ready: names the business's number in its national form", () => {
    expect(ownerLineCardView({ ...base, enrollment: enr() })).toEqual({ step: "ready", cell: "956-555-0142",
      status: { key: "ownerLine.card.status.ready", params: { number: "956-555-0100" } } });
  });
  it("the switch off says so, whatever else is ready (mutation: ignore switchOn -> FAILS)", () => {
    expect(ownerLineCardView({ ...base, switchOn: false, enrollment: enr() }).status.key).toBe("ownerLine.card.status.off");
  });
  it("locked: says until when, in the account's zone", () => {
    const v = ownerLineCardView({ ...base, enrollment: enr({ lockedUntil: "2026-11-09T20:30:00.000Z" }) });
    expect(v).toMatchObject({ step: "locked", status: { key: "ownerLine.card.status.locked", params: { time: "2:30 PM" } } });
  });
  it("no cell yet, or not verified: the cell step; verified without a PIN: the PIN step", () => {
    expect(ownerLineCardView({ ...base, enrollment: null }).step).toBe("cell");
    expect(ownerLineCardView({ ...base, enrollment: enr({ verifiedAt: null, pinSetAt: null }) }).step).toBe("cell");
    expect(ownerLineCardView({ ...base, enrollment: enr({ pinSetAt: null }) }).step).toBe("pin");
  });
  it("nationalNumber: US numbers read 956-555-0100; others stay E.164", () => {
    expect(nationalNumber("+19565550100")).toBe("956-555-0100");
    expect(nationalNumber("+528991234567")).toBe("+528991234567");
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

  ```bash
  pnpm --filter web exec vitest run src/components/owner-line/owner-line-view.test.ts
  ```

  Expected: FAIL, unresolved import.

- [ ] **Step 3: Implement the view, the cards and the copy.**

```ts
// apps/web/src/components/owner-line/owner-line-view.ts
import type { OwnerLineEnrollment } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";

export type OwnerLineCardStep = "cell" | "pin" | "ready" | "off" | "locked";
export type OwnerLineCardView = {
  step: OwnerLineCardStep; cell: string | null;
  status: { key: "ownerLine.card.status.ready" | "ownerLine.card.status.off" | "ownerLine.card.status.locked" | null;
    params: Record<string, string> };
};

export function nationalNumber(e164: string | null): string {
  if (!e164) return "";
  const d = e164.replace(/[^0-9]/g, "");
  return e164.startsWith("+1") && d.length === 11 ? `${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}` : e164;
}

export function ownerLineCardView(i: {
  enrollment: OwnerLineEnrollment | null; switchOn: boolean; number: string | null; now: Date; zone: string; locale: Locale;
}): OwnerLineCardView {
  const e = i.enrollment;
  const none = { key: null, params: {} };
  if (!e || !e.verifiedAt) return { step: "cell", cell: e ? nationalNumber(e.e164) : null, status: none };
  const cell = nationalNumber(e.e164);
  if (!e.pinSetAt) return { step: "pin", cell, status: none };
  if (!i.switchOn) return { step: "off", cell, status: { key: "ownerLine.card.status.off", params: {} } };
  if (e.lockedUntil && new Date(e.lockedUntil) > i.now) {
    const time = new Intl.DateTimeFormat(i.locale === "es" ? "es-US" : "en-US",
      { timeZone: i.zone, hour: "numeric", minute: "2-digit" }).format(new Date(e.lockedUntil)).replace(/\u202f/g, " ");
    return { step: "locked", cell, status: { key: "ownerLine.card.status.locked", params: { time } } };
  }
  return { step: "ready", cell, status: { key: "ownerLine.card.status.ready", params: { number: nationalNumber(i.number) } } };
}
```

```tsx
// apps/web/src/components/owner-line/owner-line-card.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { OwnerLineCardView } from "./owner-line-view";

type Result<T = null> = { ok: true; value: T } | { ok: false; error: string };

/**
 * "Call in to your business" (F-032 §3.1, §3.2), one per membership on Mis preferencias. One primary per step
 * (DESIGN rule 8): Verify this cell, or Save PIN; everything else is ghost. The code is shown only from the action's
 * answer: it is stored hashed, so a reload shows "Make a new code" rather than a code nobody can read back.
 */
export function OwnerLineCard(props: {
  accountId: string; businessName: string; number: string; view: OwnerLineCardView; locale: Locale; pseudo: boolean;
  startVerification: (cell: string) => Promise<Result<{ code: string; expiresAt: string }>>;
  setPin: (pin: string) => Promise<Result>; removePin: () => Promise<Result>; removeCell: () => Promise<Result>;
}) {
  const tr = makeTr(props.locale, props.pseudo);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(fn: () => Promise<Result<T>>, done?: (v: T) => void) => start(async () => {
    const r = await fn();
    if (!r.ok) { setError(r.error); return; }
    setError(null);
    done?.(r.value);
    router.refresh();
  });
  const v = props.view;
  return (
    <Card data-owner-line-card={props.accountId}>
      <CardHeader>
        <CardTitle>{tr.text("ownerLine.card.title")}</CardTitle>
        <p className="text-sm text-[var(--text-2)]">{tr.text("ownerLine.card.body", { business: props.businessName })}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {v.status.key ? <p data-owner-line-status className="text-sm">{tr.text(v.status.key, v.status.params)}</p> : null}
        {v.step === "cell" ? (
          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault();
            const cell = String(new FormData(e.currentTarget).get("cell") ?? "");
            run(() => props.startVerification(cell), (val) => setCode(val.code));
          }}>
            <Label htmlFor={`ol-cell-${props.businessName}`}>{tr.text("ownerLine.card.cell.label")}</Label>
            <Input id={`ol-cell-${props.businessName}`} name="cell" inputMode="tel" autoComplete="tel" defaultValue={v.cell ?? ""} />
            <Button type="submit" disabled={pending}>{tr.text(code ? "ownerLine.card.cell.again" : "ownerLine.card.cell.save")}</Button>
          </form>
        ) : null}
        {v.step === "cell" && code ? (
          <div data-owner-line-code className="space-y-2">
            <p className="text-sm">{tr.text("ownerLine.card.verify.instructions", { number: props.number })}</p>
            <p className="font-mono text-2xl tabular-nums tracking-[0.3em]" aria-label={tr.text("ownerLine.card.verify.codeLabel")}>{code}</p>
            <Button type="button" variant="ghost" onClick={() => router.refresh()}>{tr.text("ownerLine.card.verify.check")}</Button>
          </div>
        ) : null}
        {v.step === "pin" ? (
          <form className="space-y-2" onSubmit={(e) => {
            e.preventDefault();
            const pin = String(new FormData(e.currentTarget).get("pin") ?? "");
            run(() => props.setPin(pin), () => toast.success(tr.text("ownerLine.card.pin.saved")));
          }}>
            <Label htmlFor={`ol-pin-${props.businessName}`}>{tr.text("ownerLine.card.pin.label")}</Label>
            <Input id={`ol-pin-${props.businessName}`} name="pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} />
            <Button type="submit" disabled={pending}>{tr.text("ownerLine.card.pin.save")}</Button>
          </form>
        ) : null}
        {v.step === "ready" || v.step === "off" || v.step === "locked" ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => run(props.removePin, () => toast.success(tr.text("ownerLine.card.pin.removed")))}>
              {tr.text("ownerLine.card.pin.change")}
            </Button>
            <Button type="button" variant="ghost" disabled={pending} onClick={() => run(props.removeCell, () => toast.success(tr.text("ownerLine.card.removed")))}>
              {tr.text("ownerLine.card.remove")}
            </Button>
          </div>
        ) : null}
        {error ? <p role="alert" className="text-sm text-[var(--crit)]">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
```

**Undo (DESIGN rule 6), and what the design review is asked to rule on.**
- **"Change PIN" has no Undo, on purpose.** It removes the stored PIN, which drops the card back to the PIN step, so the person sets a new one in the same card. An Undo would need the old hash kept, which defeats changing a PIN that may have leaked.
- **"Stop calling in from this cell" is reversible in practice, so it gets the deferred-commit shape.** The card hides its controls at once and shows a 10-second toast, "This cell will stop calling in", with Undo. The removal runs only when that toast closes without Undo (sonner's `onAutoClose`/`onDismiss`). Undo restores the controls and writes nothing.

Rule 6 says reversible actions "run immediately", so both choices are **flagged for the end-of-PR design review**: it either accepts the deferred commit or asks for a soft-delete column.

```tsx
// owner-line-card.tsx: the "Stop calling in" button, replacing the immediate run(props.removeCell, ...) above
<Button type="button" variant="ghost" disabled={pending || leaving} onClick={() => {
  setLeaving(true);
  let undone = false;
  toast(tr.text("ownerLine.card.removing"), {
    duration: 10_000,
    action: { label: tr.text("common.undo"), onClick: () => { undone = true; setLeaving(false); } },
    onAutoClose: () => { if (!undone) run(props.removeCell, () => toast.success(tr.text("ownerLine.card.removed"))); },
    onDismiss: () => { if (!undone) run(props.removeCell, () => toast.success(tr.text("ownerLine.card.removed"))); },
  });
}}>
  {tr.text("ownerLine.card.remove")}
</Button>
```

`const [leaving, setLeaving] = useState(false);` joins the card's state, and the ready/off/locked controls render only while `!leaving`. Copy: `"ownerLine.card.removing": "This cell will stop calling in."`, `"ownerLine.card.removing.es": "Este celular dejará de llamar."`.

```tsx
// apps/web/src/components/owner-line/owner-line-switch-card.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { makeTr } from "@/lib/record/copy";
import type { Locale } from "@/lib/i18n/locale";
import type { OwnerLineSwitchState } from "@bis/db";

type Result = { ok: true; value: OwnerLineSwitchState } | { ok: false; error: string };

/**
 * F-032 §3.3, owner ruling Q-A: off by default. The client's Owner turns it on or off; the agency may turn it OFF,
 * never ON. The card says what kind of person last changed it and when ("Turned off by BIS, Nov 9, 2:14 PM";
 * "Turned on by the Owner, ..."), never a name (owner ruling 2026-11-09, "Say BIS, keep names private").
 * Status is dot + word (rule 3). A change runs at once; Undo is offered only when THIS viewer may make the reverse
 * change (rule 6): an Owner always, the agency never, because undoing its OFF would be an ON.
 */
export function OwnerLineSwitchCard(props: {
  state: OwnerLineSwitchState; viewer: "owner" | "agency"; locale: Locale; zone: string; pseudo: boolean;
  setSwitch: (on: boolean) => Promise<Result>;
}) {
  const tr = makeTr(props.locale, props.pseudo);
  const [state, setState] = useState(props.state);
  const [pending, start] = useTransition();
  const on = state.enabledAt !== null;
  const mayTurn = (next: boolean) => props.viewer === "owner" || next === false;
  const flip = (next: boolean, offerUndo = true) => start(async () => {
    const r = await props.setSwitch(next);
    if (!r.ok) { toast.error(r.error); return; }
    setState(r.value);
    const undo = offerUndo && mayTurn(!next)
      ? { action: { label: tr.text("common.undo"), onClick: () => flip(!next, false) } } : {};
    toast.success(tr.text(next ? "ownerLine.switch.turnedOn" : "ownerLine.switch.turnedOff"), undo);
  });
  const when = state.changedAt ? new Intl.DateTimeFormat(props.locale === "es" ? "es-US" : "en-US",
    { timeZone: props.zone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    .format(new Date(state.changedAt)).replace(/\u202f/g, " ") : null;
  const who = tr.text(state.changedByKind === "agency" ? "ownerLine.switch.byBis" : "ownerLine.switch.byOwner");
  return (
    <Card data-owner-line-switch className="mt-6">
      <CardHeader>
        <CardTitle>{tr.text("ownerLine.switch.title")}</CardTitle>
        <p className="text-sm text-[var(--text-2)]">{tr.text("ownerLine.switch.body")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 text-sm">
            <span aria-hidden className={`size-2 rounded-full ${on ? "bg-[var(--good)]" : "bg-[var(--text-3)]"}`} />
            {tr.text(on ? "ownerLine.switch.on" : "ownerLine.switch.off")}
          </span>
          {mayTurn(!on) ? (
            <Button type="button" variant={on ? "ghost" : "default"} disabled={pending} onClick={() => flip(!on)}>
              {tr.text(on ? "ownerLine.switch.turnOff" : "ownerLine.switch.turnOn")}
            </Button>
          ) : (
            <p className="text-sm text-[var(--text-2)]">{tr.text("ownerLine.switch.agencyCannot")}</p>
          )}
        </div>
        {when ? (
          <p data-owner-line-switch-record className="text-sm text-[var(--text-2)]">
            {tr.text(on ? "ownerLine.switch.turnedOnBy" : "ownerLine.switch.turnedOffBy", { who, when })}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
```

Copy for the record line, appended to the F-032 block:

```ts
  "ownerLine.switch.turnedOnBy": "Turned on by {who}, {when}.",
  "ownerLine.switch.turnedOnBy.es": "Lo encendió {who}, {when}.",
  "ownerLine.switch.turnedOffBy": "Turned off by {who}, {when}.",
  "ownerLine.switch.turnedOffBy.es": "Lo apagó {who}, {when}.",
  "ownerLine.switch.byBis": "BIS",
  "ownerLine.switch.byBis.es": "BIS",
  "ownerLine.switch.byOwner": "the Owner",
  "ownerLine.switch.byOwner.es": "el Dueño",
```

`ownerLine.switch.agencyCannot` now reads "Only the business's Owner can turn this on." / "Solo el Dueño del negocio puede encenderlo." (it is shown to the agency while the switch is off). Update both values in Task 5's block.

Read `components/ui/button.tsx` first and use its real variant names for primary and ghost. If they differ from `default` and `ghost`, use the file's names.

Wire the preferences page. In `preferences/page.tsx`, after the `PreferencesPanel`, render the cards for a client person (an agency person has no memberships, so nothing renders). Add this to the existing `Promise.all`:

```tsx
// preferences/page.tsx additions (imports)
import { serviceDb, readMyOwnerLineEnrollment, readOwnerLineSwitch, readAccountTimezone } from "@bis/db";
import { listMyMemberships } from "@/lib/owner-line/memberships";
import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";
import { ownerLineCardView, nationalNumber } from "@/components/owner-line/owner-line-view";
import { OwnerLineCard } from "@/components/owner-line/owner-line-card";
import {
  startOwnerLineVerificationAction, setOwnerLinePinAction, removeOwnerLinePinAction, removeOwnerLineCellAction,
} from "./owner-line-actions";
// …inside PreferencesPage, after `prefs` resolves; `locale` is prefs.language ?? accountLanguage ?? "en":
  const memberships = isAgency ? [] : (await listMyMemberships(serviceDb(), userId))
    .filter((mb) => OWNER_LINE_ROLES.includes(mb.role));
  const cards = await Promise.all(memberships.map(async (mb) => {
    const db = serviceDb();
    const [enrollment, sw, zoneRead] = await Promise.all([
      readMyOwnerLineEnrollment(db, mb.accountId, mb.userId), readOwnerLineSwitch(db, mb.accountId),
      readAccountTimezone(db, mb.accountId),
    ]);
    // readAccountTimezone answers string | null (DB/automation-settings.ts:13-17); null is the column default's zone.
    const zone = zoneRead ?? "America/Chicago";
    return { mb, view: ownerLineCardView({ enrollment, switchOn: sw.enabledAt !== null, number: mb.number, now: new Date(), zone, locale }) };
  }));
// …in the JSX, after <PreferencesPanel …/>:
      {cards.length > 0 ? (
        <section id="owner-line" className="mt-6 space-y-4">
          {cards.map(({ mb, view }) => (
            <OwnerLineCard key={mb.accountId} accountId={mb.accountId} businessName={mb.businessName} number={nationalNumber(mb.number)}
              view={view} locale={locale} pseudo={false}
              startVerification={startOwnerLineVerificationAction.bind(null, mb.accountId, locale)}
              setPin={setOwnerLinePinAction.bind(null, mb.accountId, locale)}
              removePin={removeOwnerLinePinAction.bind(null, mb.accountId, locale)}
              removeCell={removeOwnerLineCellAction.bind(null, mb.accountId, locale)} />
          ))}
        </section>
      ) : null}
```

Wire the team page. In `ACCT/team/page.tsx`, after the `TeamSection` `Suspense`:

```tsx
import { serviceDb, readOwnerLineSwitch, readAccountTimezone } from "@bis/db";
import { OwnerLineSwitchCard } from "@/components/owner-line/owner-line-switch-card";
import { setOwnerLineSwitchAction } from "./owner-line-actions";
// …after `locale`/`pseudo`:
  const [ownerLine, zoneRead] = await Promise.all([
    readOwnerLineSwitch(serviceDb(), accountId), readAccountTimezone(serviceDb(), accountId),
  ]);
// …JSX, between the TeamSection Suspense and BisAccessFrame:
        <OwnerLineSwitchCard state={ownerLine} viewer={isAgency ? "agency" : "owner"} locale={locale}
          zone={zoneRead ?? "America/Chicago"} pseudo={pseudo}
          setSwitch={setOwnerLineSwitchAction.bind(null, accountId, locale)} />
```

(`requireAccountOwner` ran first on this page, so the service read is scoped to an account this caller may manage. The action itself refuses the agency's ON, so the card hiding the button is presentation, not the control.)

The copy, appended to the `F-032 owner line` block in `messages.ts`:

```ts
  "ownerLine.card.title": "Call in to your business",
  "ownerLine.card.title.es": "Llame a su negocio",
  "ownerLine.card.body": "Call {business} from your cell, enter your PIN, and Sofía tells you about your calls, your appointments and what needs your attention.",
  "ownerLine.card.body.es": "Llame a {business} desde su celular, marque su PIN y Sofía le cuenta sobre sus llamadas, sus citas y lo que necesita su atención.",
  "ownerLine.card.cell.label": "Your cell",
  "ownerLine.card.cell.label.es": "Su celular",
  "ownerLine.card.cell.save": "Verify this cell",
  "ownerLine.card.cell.save.es": "Verificar este celular",
  "ownerLine.card.cell.again": "Make a new code",
  "ownerLine.card.cell.again.es": "Generar otro código",
  "ownerLine.card.verify.instructions": "From this cell, call {number} and enter this code. It works for 10 minutes.",
  "ownerLine.card.verify.instructions.es": "Desde este celular, llame al {number} y marque este código. Sirve por 10 minutos.",
  "ownerLine.card.verify.codeLabel": "Your code",
  "ownerLine.card.verify.codeLabel.es": "Su código",
  "ownerLine.card.verify.check": "I called. Check again",
  "ownerLine.card.verify.check.es": "Ya llamé. Revisar de nuevo",
  "ownerLine.card.pin.label": "PIN (6 digits)",
  "ownerLine.card.pin.label.es": "PIN (6 dígitos)",
  "ownerLine.card.pin.save": "Save PIN",
  "ownerLine.card.pin.save.es": "Guardar PIN",
  "ownerLine.card.pin.saved": "PIN saved.",
  "ownerLine.card.pin.saved.es": "PIN guardado.",
  "ownerLine.card.pin.change": "Change PIN",
  "ownerLine.card.pin.change.es": "Cambiar PIN",
  "ownerLine.card.pin.removed": "PIN removed. Set a new one to call in again.",
  "ownerLine.card.pin.removed.es": "Se quitó el PIN. Ponga uno nuevo para volver a llamar.",
  "ownerLine.card.remove": "Stop calling in from this cell",
  "ownerLine.card.remove.es": "Dejar de llamar desde este celular",
  "ownerLine.card.removed": "This cell no longer calls in.",
  "ownerLine.card.removed.es": "Este celular ya no puede llamar.",
  "ownerLine.card.status.ready": "Ready: call {number} from your cell.",
  "ownerLine.card.status.ready.es": "Listo: llame al {number} desde su celular.",
  "ownerLine.card.status.off": "Your business has calling in turned off. Ask the Owner.",
  "ownerLine.card.status.off.es": "Su negocio tiene apagada esta opción. Pídasela al Dueño.",
  "ownerLine.card.status.locked": "Calling in is paused until {time} after 3 wrong PINs.",
  "ownerLine.card.status.locked.es": "Las llamadas están en pausa hasta las {time} por 3 PIN incorrectos.",
  "ownerLine.switch.title": "Let your team call in to hear the day",
  "ownerLine.switch.title.es": "Permita que su equipo llame para escuchar el día",
  "ownerLine.switch.body": "Each person calls this business's number from their own verified cell and enters their own PIN. They hear only what they see in the app.",
  "ownerLine.switch.body.es": "Cada persona llama al número de este negocio desde su propio celular verificado y marca su propio PIN. Solo escucha lo que ve en la aplicación.",
  "ownerLine.switch.on": "On",
  "ownerLine.switch.on.es": "Encendido",
  "ownerLine.switch.off": "Off",
  "ownerLine.switch.off.es": "Apagado",
  "ownerLine.switch.turnOn": "Turn on",
  "ownerLine.switch.turnOn.es": "Encender",
  "ownerLine.switch.turnOff": "Turn off",
  "ownerLine.switch.turnOff.es": "Apagar",
  "ownerLine.switch.turnedOn": "Your team can call in now.",
  "ownerLine.switch.turnedOn.es": "Su equipo ya puede llamar.",
  "ownerLine.switch.turnedOff": "Calling in is off.",
  "ownerLine.switch.turnedOff.es": "Las llamadas están apagadas.",
```

⌘K: in `WEB/lib/palette/registry.ts`, append `"owner line", "call in", "pin", "llamar"` to the end of the `"nav:preferences"` array (`:113`), and `"call in", "owner line"` to the end of the `"settings:team"` array (`:101`). Do not reorder anything.

- [ ] **Step 4: Run green.**

  ```bash
  pnpm --filter web exec vitest run src/components/owner-line "src/app/(dashboard)/dashboard/preferences" "src/app/(dashboard)/dashboard/accounts/[accountId]/team" src/lib/palette src/lib/i18n src/lib/messages.test.ts src/lib/consent/scans.test.ts && pnpm --filter web typecheck
  ```

  Expected: green, and typecheck silent. Paste the summary line. LOW tier: no mutation probe of its own beyond the switch-ignored case in Step 1.

- [ ] **Step 5: Commit.**

  ```bash
  git add apps/web/src/components/owner-line "apps/web/src/app/(dashboard)/dashboard/preferences/page.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/team/page.tsx" apps/web/src/lib/messages.ts apps/web/src/lib/palette/registry.ts
  git commit -m "feat(voice): the Call in to your business card on Mis preferencias and the Owner's switch on Team (EN/ES)"
  ```

---

## Task 7: Answer-route branch and the `<Gather>` (HIGH, 0.75 day)

**Files:**
- Create: `apps/web/src/app/api/voice/texml/owner-line-xml.ts` and `owner-line-xml.test.ts`. These are colocated helpers, not routes, like `./xml.ts` and `./telnyx-request.ts`, so `lib/` never imports from `app/`.
- Modify: `apps/web/src/app/api/voice/texml/route.ts`:
  - `Routability` (`:89-103`)
  - `classify` (`:218-409`)
  - `dialXml` (`:479-540`)
  - `answer` (`:684-700`)
  - `route` (`:715-844`)
- Modify: `apps/web/src/app/api/voice/texml/route.test.ts` (append one `describe`) and `wellformed.test.ts` (append one `describe`).
- Modify: `apps/web/src/app/api/voice/texml/screen/route.ts` (`:66`, `:71`, `:97`: `skipOwnerLine`) and `screen/route.test.ts` (one case).
- Create: `apps/web/src/lib/owner-line/names.ts` (`firstName`, used by `app/` and `lib/` alike).
- Modify: `apps/web/src/lib/messages.ts` (the `ownerLine.say.*` keys).

**Interfaces:**
- Consumes (Task 2): `ownerLineAnswerLookup`, `OWNER_LINE_MAX_CALLS_PER_DAY`, `OwnerLineLookup` (lazy `@bis/db` import).
- Consumes (Task 4): `signOwnerPass`, `OWNER_PASS_HEADER`, `OwnerPassRole`.
- Consumes (Task 5): `OWNER_LINE_ROLES` (`lib/owner-line/data-path.ts`).
- Produces (exported from `route.ts`, for Task 9):

```ts
export async function answer(calledE164: string | null, callerE164: string | null, origin: string, authenticated: boolean,
  opts?: { skipScreen?: boolean; skipOwnerLine?: boolean }): Promise<NextResponse>;
export function ownerLineBridge(calledE164: string, callerE164: string, origin: string,
  owner: { accountId: string; userId: string; role: OwnerPassRole }): NextResponse;
export async function ownerLineGatherAgain(calledE164: string, callerE164: string, origin: string,
  p: { kind: "pin" | "verify"; locale: Locale; accountId: string; name: string | null }): Promise<NextResponse>;
```

and from `owner-line-xml.ts`:

```ts
export const OWNER_PIN_TIMEOUT_SECONDS = 8;
export function ownerPinUrl(origin: string): string;     // `${origin}/api/voice/texml/owner-pin`
export function ownerPinAskXml(p: { locale: Locale; name: string | null; persona: string; action: string; retry: boolean; bridge: string }): string;
export function ownerVerifyAskXml(p: { locale: Locale; action: string; retry: boolean; bridge: string }): string;
export function ownerLimitXml(p: { locale: Locale; persona: string; bridge: string }): string;
export function ownerVerifiedXml(locale: Locale): string;
```

and from `apps/web/src/lib/owner-line/names.ts` (in `lib/`, so `lib/` never imports from `app/`):

```ts
export function firstName(name: string | null): string | null;   // "  Dan   Lopez " -> "Dan"; null or blank -> null
```

- [ ] **Step 1: Verify the `<Gather>` attributes (A-3); a documentation read, not a provider call.**
  - Read https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/gather and record in the report:
    - (a) whether `finishOnKey` is a documented attribute, and its default;
    - (b) what the docs say is sent when the finish key is pressed with no digits;
    - (c) whether `timeout` with no input falls through to the next verb or posts to `action`.
  - If (a) is NO, delete `finishOnKey="#"` from `gather()` below and from the test's expected string.
  - Every case of (b) and (c) is already handled: the next verb after the Gather is today's bridge, and owner-pin treats `Digits` "" and "#" as today's path.

  Write the answers into the file header of `owner-line-xml.ts`, with the date read, as `route.ts:171-176` does for the screen.

- [ ] **Step 2: Write the failing tests.**

```ts
// apps/web/src/app/api/voice/texml/owner-line-xml.test.ts
import { describe, it, expect } from "vitest";
import { ownerPinAskXml, ownerVerifyAskXml, ownerLimitXml, ownerVerifiedXml, ownerPinUrl } from "./owner-line-xml";
import { firstName } from "@/lib/owner-line/names";

const DIAL = `<Dial answerOnBridge="true" action="https://x/h" method="POST"><Sip>sip:p@sip.api.openai.com</Sip></Dial>`;

describe("the owner line's TeXML words (spec §4.1, §4.2)", () => {
  it("asks for the PIN by first name, in one Gather of exactly six digits, then falls through to today's bridge", () => {
    const xml = ownerPinAskXml({ locale: "en", name: "Dan", persona: "Sofía", action: ownerPinUrl("https://x"), retry: false, bridge: DIAL });
    expect(xml).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Gather action="https://x/api/voice/texml/owner-pin" numDigits="6" timeout="8" finishOnKey="#"><Say>Hi Dan. Enter your PIN, or press pound to talk to Sofía.</Say></Gather>${DIAL}</Response>`);
  });
  it("Spanish speaks es-MX, in usted", () => {
    const xml = ownerPinAskXml({ locale: "es", name: "Dan", persona: "Sofía", action: "a", retry: false, bridge: DIAL });
    expect(xml).toContain(`<Say language="es-MX">Hola, Dan. Marque su PIN, o oprima la tecla de número para hablar con Sofía.</Say>`);
  });
  it("a retry says the PIN did not match before asking again, inside the same Gather", () => {
    const xml = ownerPinAskXml({ locale: "en", name: null, persona: "Sofía", action: "a", retry: true, bridge: DIAL });
    // xmlText escapes the apostrophe (./xml.ts: five entities), so the document carries &apos;.
    expect(xml).toContain(`<Gather action="a" numDigits="6" timeout="8" finishOnKey="#"><Say>That PIN didn&apos;t match. Try again.</Say><Say>Hi. Enter your PIN, or press pound to talk to Sofía.</Say></Gather>`);
  });
  it("the call-in code ask, the limit line and the verified goodbye", () => {
    expect(ownerVerifyAskXml({ locale: "en", action: "a", retry: false, bridge: DIAL })).toContain("<Say>Enter the 6-digit code shown on your screen.</Say>");
    expect(ownerLimitXml({ locale: "en", persona: "Sofía", bridge: DIAL })).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>You&apos;ve reached today&apos;s limit for calling in. Here is Sofía.</Say>${DIAL}</Response>`);
    expect(ownerVerifiedXml("en")).toBe(`<?xml version="1.0" encoding="UTF-8"?>\n<Response><Say>Thank you. This phone is verified. You can hang up now.</Say><Hangup/></Response>`);
  });
  it("escapes a name: a stored name can never break the document", () => {
    expect(ownerPinAskXml({ locale: "en", name: "A&B <x>", persona: "Sofía", action: "a", retry: false, bridge: DIAL }))
      .toContain("Hi A&amp;B. Enter");
    expect(firstName("  Dan   Lopez ")).toBe("Dan");
    expect(firstName(null)).toBeNull();
  });
});
```

Append to `route.test.ts`. Extend the existing `vi.mock("@bis/db", …)` object, keeping every existing key, with:

```ts
  ownerLineAnswerLookup: (...a: unknown[]) => ownerLookupMock(...a),
  OWNER_LINE_MAX_CALLS_PER_DAY: 10,
```

Declare `const ownerLookupMock = vi.hoisted(() => vi.fn());` beside the other hoisted mocks. In the top-level `beforeEach`, add `ownerLookupMock.mockReset().mockResolvedValue({ status: "none" });`. Then:

```ts
describe("the owner line at the answer route (F-032 §4.1; SC-9, SC-14, SC-16, SC-17)", () => {
  const SECRET = "h".repeat(48);
  const TO = "+19565550999";
  const CELL = "+19565550142";
  const HIT = { status: "pin", enrollmentId: "e1", userId: "22222222-2222-4222-8222-222222222222", role: "owner",
    name: "Dan Lopez", language: "en", accountLanguage: "es", pinParams: "scrypt:17:8:1:" + "A".repeat(22) };

  function telnyxSigned(params: Record<string, string>) {
    const raw = new URLSearchParams(params).toString();
    const ts = String(Math.floor(Date.now() / 1000));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const sig = cryptoSign(null, Buffer.from(`${ts}|${raw}`, "utf8"), privateKey);
    const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    process.env.TELNYX_PUBLIC_KEY = spki.subarray(spki.length - 32).toString("base64");
    return POST(new Request("https://x.example/api/voice/texml", {
      method: "POST", body: raw,
      headers: { "content-type": "application/x-www-form-urlencoded", "telnyx-timestamp": ts, "telnyx-signature-ed25519": sig.toString("base64") },
    }));
  }
  const sipParams = (xml: string) => {
    const uri = /<Sip>([^<]*)<\/Sip>/.exec(xml)![1]!.replaceAll("&amp;", "&");
    return new URLSearchParams(uri.slice(uri.indexOf("?") + 1));
  };

  beforeEach(() => { process.env.VOICE_HANDOFF_SECRET = SECRET; });
  afterEach(() => { delete process.env.VOICE_HANDOFF_SECRET; delete process.env.TELNYX_PUBLIC_KEY; });

  it("a registered, verified cell with a PIN hears the PIN step, and the fallthrough is today's bridge with no owner pass", async () => {
    ownerLookupMock.mockResolvedValue(HIT);
    const xml = await (await telnyxSigned({ To: TO, From: CELL })).text();
    expect(xml).toContain(`<Gather action="https://x.example/api/voice/texml/owner-pin" numDigits="6" timeout="8" finishOnKey="#"><Say>Hi Dan. Enter your PIN, or press pound to talk to Sofía.</Say></Gather><Dial`);
    expect(sipParams(xml).get("X-BIS-Owner-Pass")).toBeNull();
    expect(ownerLookupMock).toHaveBeenCalledWith({}, "a1", CELL, 10);
  });

  it("a customer (no enrollment) gets today's document byte-for-byte apart from the per-call token (mutation: offer the Gather on 'none' -> FAILS)", async () => {
    const xml = await (await telnyxSigned({ To: TO, From: "+19565550177" })).text();
    expect(xml).not.toContain("<Gather");
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>\n<Response><Dial answerOnBridge="true" action="[^"]+" method="POST"><Sip>[^<]+<\/Sip><\/Dial><\/Response>$/);
  });

  it("an UNSIGNED request never looks the owner up, so it can never offer the step (mutation: drop authenticated from the eligibility -> FAILS)", async () => {
    ownerLookupMock.mockResolvedValue(HIT);
    const xml = await (await POST(new Request("https://x.example/api/voice/texml", {
      method: "POST", body: new URLSearchParams({ To: TO, From: CELL }),
      headers: { "content-type": "application/x-www-form-urlencoded" } }))).text();
    expect(xml).not.toContain("<Gather");
    expect(ownerLookupMock).not.toHaveBeenCalled();
  });

  it("a lookup that throws is a miss AND the call stays CLEARED: today's bridge with its fallback ticket (mutation: put the lookup inside the count batch without its catch -> uncleared, no &f=, FAILS)", async () => {
    // Only a cleared call's action URL carries the fallback ticket `&f=` (route.ts:529-533). The ticket is signed only
    // with SUPABASE_SERVICE_ROLE_KEY set and a UUID account id (fallback-ticket.ts:35-39,66), so this case sets both.
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k".repeat(64);
    lookupMock.mockResolvedValue({ id: "pn1", account_id: "11111111-1111-4111-8111-111111111111", e164: TO, telnyx_id: null, status: "live" });
    ownerLookupMock.mockRejectedValue(new Error("db blip"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const xml = await (await telnyxSigned({ To: TO, From: CELL })).text();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(xml).not.toContain("<Gather");
    expect(xml).toMatch(/<Dial answerOnBridge="true" action="[^"]*&amp;f=[^"]+"/);
    expect(err.mock.calls.flat().join(" ")).toContain("owner-line lookup failed");
  });

  it("a registered person is never refused by the CUSTOMER caps: over the per-caller and per-account caps, still asked for the PIN (owner ruling Q-C; mutation: drop the !ownerAsk wrapper -> the cap sentence, FAILS)", async () => {
    ownerLookupMock.mockResolvedValue(HIT);
    countCallsByCallerSinceMock.mockResolvedValue(99);
    countCallsSinceMock.mockResolvedValue(999);
    expect(await (await telnyxSigned({ To: TO, From: CELL })).text()).toContain("<Gather");
  });

  it("over its own limit the person is a customer again: the customer caps apply", async () => {
    ownerLookupMock.mockResolvedValue({ ...HIT, status: "over_limit" });
    countCallsSinceMock.mockResolvedValue(999);
    const xml = await (await telnyxSigned({ To: TO, From: CELL })).text();
    expect(xml).not.toContain("<Dial");
    expect(xml).toContain("call back tomorrow");
  });

  it.each([["off"], ["locked"]])("status %s is today's path (a locked person continues as a customer)", async (status) => {
    ownerLookupMock.mockResolvedValue({ status });
    expect(await (await telnyxSigned({ To: TO, From: CELL })).text()).not.toContain("<Gather");
  });

  it("over the daily limit: a short line in their language, then today's bridge", async () => {
    ownerLookupMock.mockResolvedValue({ ...HIT, status: "over_limit", language: "es" });
    const xml = await (await telnyxSigned({ To: TO, From: CELL })).text();
    expect(xml).toContain(`<Response><Say language="es-MX">Ya llegó al límite de llamadas de hoy. Le comunico con Sofía.</Say><Dial`);
  });

  it("the agency's forward is on: not offered, so the fallthrough can never differ from today's path (SC-17)", async () => {
    ownerLookupMock.mockResolvedValue(HIT);
    profileMock.mockResolvedValue({ ...ENABLED_PROFILE, forward_calls: true });
    transferPhoneMock.mockResolvedValue(null);
    ownedNumbersMock.mockResolvedValue([]);
    expect(await (await telnyxSigned({ To: TO, From: CELL })).text()).not.toContain("<Gather");
  });

  it("a role the data path does not offer is not asked (F2: a Technician)", async () => {
    vi.doMock("@/lib/owner-line/data-path", () => ({ OWNER_LINE_ROLES: ["owner", "staff"], OWNER_LINE_DATA_PATH: "service" }));
    vi.resetModules();
    const { POST: post } = await import("./route");
    ownerLookupMock.mockResolvedValue({ ...HIT, role: "technician" });
    const raw = new URLSearchParams({ To: TO, From: CELL }).toString();
    const ts = String(Math.floor(Date.now() / 1000));
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
    process.env.TELNYX_PUBLIC_KEY = spki.subarray(spki.length - 32).toString("base64");
    const res = await post(new Request("https://x.example/api/voice/texml", { method: "POST", body: raw, headers: {
      "content-type": "application/x-www-form-urlencoded", "telnyx-timestamp": ts,
      "telnyx-signature-ed25519": cryptoSign(null, Buffer.from(`${ts}|${raw}`, "utf8"), privateKey).toString("base64") } }));
    expect(await res.text()).not.toContain("<Gather");
    vi.doUnmock("@/lib/owner-line/data-path");
  });

  it("ownerLineBridge carries an owner pass that verifies against THIS dial's handoff token (mutation: sign with a fresh token -> FAILS)", async () => {
    const { ownerLineBridge } = await import("./route");
    const { verifyOwnerPass } = await import("@/lib/voice/sip-handoff-signature");
    const xml = await ownerLineBridge(TO, CELL, "https://x.example", { accountId: "11111111-1111-4111-8111-111111111111", userId: HIT.userId, role: "staff" }).text();
    const p = sipParams(xml);
    expect(verifyOwnerPass(p.get("X-BIS-Owner-Pass"), p.get("X-BIS-Handoff"), Date.now())).toMatchObject({
      ok: true, accountId: "11111111-1111-4111-8111-111111111111", userId: HIT.userId, role: "staff", calledE164: TO });
    expect(p.get("X-BIS-Signature")).toBeTruthy();
  });
});
```

`profileMock`, `transferPhoneMock`, `ownedNumbersMock`, `ENABLED_PROFILE`, `generateKeyPairSync`, `cryptoSign` already exist at the top of `route.test.ts` (`:1-90`). Read them before writing. If the forward test needs a stub shape other than the one above, use whatever that file's own forward cases (`forward.test.ts`) use.

Append to `wellformed.test.ts`:

```ts
import { ownerPinAskXml, ownerVerifyAskXml, ownerLimitXml, ownerVerifiedXml } from "./owner-line-xml";
describe("the owner line's documents parse (F-032)", () => {
  const DIAL = `<Dial answerOnBridge="true" action="https://x/h?t=a&amp;f=b" method="POST"><Sip>sip:p@sip.api.openai.com;transport=tls?X-BIS-Called=%2B1&amp;X-BIS-Handoff=t</Sip></Dial>`;
  it.each([
    ownerPinAskXml({ locale: "en", name: "O'Brien & Sons", persona: "Sofía", action: "https://x/api/voice/texml/owner-pin", retry: true, bridge: DIAL }),
    ownerVerifyAskXml({ locale: "es", action: "https://x/api/voice/texml/owner-pin", retry: true, bridge: DIAL }),
    ownerLimitXml({ locale: "en", persona: "Sofía", bridge: DIAL }),
    ownerVerifiedXml("es"),
  ])("parses strictly: %#", (xml) => { expect(() => parseXmlStrict(xml)).not.toThrow(); });
});
```

- [ ] **Step 3: Run them and see them fail.**

  ```bash
  pnpm --filter web exec vitest run src/app/api/voice/texml/owner-line-xml.test.ts src/app/api/voice/texml/route.test.ts src/app/api/voice/texml/wellformed.test.ts
  ```

  Expected: FAIL (unresolved `./owner-line-xml`, and `ownerLineBridge is not a function`). Paste one line.

- [ ] **Step 4: Implement `lib/owner-line/names.ts` and `owner-line-xml.ts`.**

```ts
// apps/web/src/lib/owner-line/names.ts
/** The first word of a stored name, for "Hi Dan" and "Owner line · Dan". Null for no name or a blank one. */
export function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}
```

```ts
// apps/web/src/app/api/voice/texml/owner-line-xml.ts
// The owner line's TeXML (F-032 §4.1, §4.2). NOT a route: a helper colocated with ./xml.ts.
//
// THE GATHER. Telnyx's <Gather> (https://developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/gather,
// read <date> in Task 7 Step 1): action, numDigits, timeout, finishOnKey <record (a), (b), (c) here>. No `method`,
// for the screen's reason (route.ts:171-176). The digits are keyed into Telnyx's leg BEFORE <Dial> runs, so they never
// reach OpenAI, its audio or our transcripts (spec §2.2).
//
// THE FALLTHROUGH IS TODAY'S BRIDGE. Every ask is followed by the same <Dial> a customer gets (passed in as `bridge`),
// with NO owner pass. Whatever Telnyx does when the ask times out, falling through or posting with no Digits, the
// caller reaches Sofía as a customer: "pound, or a timeout with no digits: today's normal call path" (§4.2).
import { xmlText } from "./xml";
import { firstName } from "@/lib/owner-line/names";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

export const OWNER_PIN_TIMEOUT_SECONDS = 8;
const HEAD = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>`;

export function ownerPinUrl(origin: string): string {
  return `${origin}/api/voice/texml/owner-pin`;
}

function say(locale: Locale, text: string): string {
  return locale === "es" ? `<Say language="es-MX">${xmlText(text)}</Say>` : `<Say>${xmlText(text)}</Say>`;
}

function gather(action: string, inner: string): string {
  return `<Gather action="${xmlText(action)}" numDigits="6" timeout="${OWNER_PIN_TIMEOUT_SECONDS}" finishOnKey="#">${inner}</Gather>`;
}

export function ownerPinAskXml(p: { locale: Locale; name: string | null; persona: string; action: string; retry: boolean; bridge: string }): string {
  const name = firstName(p.name);
  const prompt = name
    ? t(m, "ownerLine.say.pinPrompt", p.locale, { name, persona: p.persona })
    : t(m, "ownerLine.say.pinPromptNoName", p.locale, { persona: p.persona });
  const inner = (p.retry ? say(p.locale, t(m, "ownerLine.say.pinWrong", p.locale)) : "") + say(p.locale, prompt);
  return `${HEAD}${gather(p.action, inner)}${p.bridge}</Response>`;
}

export function ownerVerifyAskXml(p: { locale: Locale; action: string; retry: boolean; bridge: string }): string {
  const inner = (p.retry ? say(p.locale, t(m, "ownerLine.say.verifyWrong", p.locale)) : "")
    + say(p.locale, t(m, "ownerLine.say.verifyPrompt", p.locale));
  return `${HEAD}${gather(p.action, inner)}${p.bridge}</Response>`;
}

export function ownerLimitXml(p: { locale: Locale; persona: string; bridge: string }): string {
  return `${HEAD}${say(p.locale, t(m, "ownerLine.say.limit", p.locale, { persona: p.persona }))}${p.bridge}</Response>`;
}

export function ownerVerifiedXml(locale: Locale): string {
  return `${HEAD}${say(locale, t(m, "ownerLine.say.verifyDone", locale))}<Hangup/></Response>`;
}
```

The spoken copy goes into `messages.ts`'s F-032 block. This is customer-adjacent telephone copy (TeXML `<Say>`): plain words, *usted*, no jargon.

```ts
  "ownerLine.say.pinPrompt": "Hi {name}. Enter your PIN, or press pound to talk to {persona}.",
  "ownerLine.say.pinPrompt.es": "Hola, {name}. Marque su PIN, o oprima la tecla de número para hablar con {persona}.",
  "ownerLine.say.pinPromptNoName": "Hi. Enter your PIN, or press pound to talk to {persona}.",
  "ownerLine.say.pinPromptNoName.es": "Hola. Marque su PIN, o oprima la tecla de número para hablar con {persona}.",
  "ownerLine.say.pinWrong": "That PIN didn't match. Try again.",
  "ownerLine.say.pinWrong.es": "Ese PIN no coincide. Intente de nuevo.",
  "ownerLine.say.limit": "You've reached today's limit for calling in. Here is {persona}.",
  "ownerLine.say.limit.es": "Ya llegó al límite de llamadas de hoy. Le comunico con {persona}.",
  "ownerLine.say.verifyPrompt": "Enter the 6-digit code shown on your screen.",
  "ownerLine.say.verifyPrompt.es": "Marque el código de 6 dígitos que aparece en su pantalla.",
  "ownerLine.say.verifyWrong": "That code didn't match. Try again.",
  "ownerLine.say.verifyWrong.es": "Ese código no coincide. Intente de nuevo.",
  "ownerLine.say.verifyDone": "Thank you. This phone is verified. You can hang up now.",
  "ownerLine.say.verifyDone.es": "Gracias. Este teléfono quedó verificado. Ya puede colgar.",
```

- [ ] **Step 5: Implement the `route.ts` changes.**
  1. Imports: add `import { signOwnerPass, OWNER_PASS_HEADER, type OwnerPassRole } from "@/lib/voice/sip-handoff-signature";` to the existing sip-handoff import line, plus `import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";`, `import type { OwnerLineLookup } from "@bis/db";` (type-only, so there is no runtime import), `import type { Locale } from "@/lib/i18n/locale";`, and `import { ownerPinUrl, ownerPinAskXml, ownerVerifyAskXml, ownerLimitXml } from "./owner-line-xml";` plus `import { firstName } from "@/lib/owner-line/names";`.
  2. `Routability`'s `dial` arm gains `ownerLine?: Extract<OwnerLineLookup, { status: "verify" | "pin" | "over_limit" }>; personaName?: string;`.
  3. `classify(calledE164, callerE164, ownerLineEligible: boolean)`. Declare the lookup BEFORE the inner `try` (so the cleared return can see it), started before the batch so it overlaps it:

```ts
    // F-032 (§4.1): started BESIDE the count batch, never inside it. Inside a Promise.all its rejection would reject
    // the whole batch and fail the call UNCLEARED (Task 7's I-7 test pins that it does not). Its own catch makes a
    // throw a miss: today's path. A stranger's call waits for max(), not +. The account's local day is SQL's (Q-F).
    const ownerRead: Promise<OwnerLineLookup | null> = ownerLineEligible && callerE164
      ? dbModule.ownerLineAnswerLookup(db, row.account_id, callerE164, dbModule.OWNER_LINE_MAX_CALLS_PER_DAY)
        .catch((e: unknown) => {
          console.error(`texml owner-line lookup failed — today's path, accountId ${row.account_id}: ${String(e)}`);
          return null;
        })
      : Promise.resolve(null);
```

     Inside the inner `try`, right after the `Promise.all` batch resolves and BEFORE the reputation and cap verdicts (`:356-388`):

```ts
      const looked = await ownerRead;
      ownerLine = looked && (looked.status === "verify" || looked.status === "pin" || looked.status === "over_limit")
        && OWNER_LINE_ROLES.includes(looked.role) ? looked : undefined;
      // Owner ruling Q-C: a registered, verified person about to be asked for a PIN or a call-in code is never refused
      // by the CUSTOMER checks (repeat-spam, the per-caller cap, the per-account cap of 50). Their own limit is the
      // lookup's. Over that limit they are a customer again, so every customer check applies. Pound or a timeout
      // re-runs this whole function with the owner line skipped, so the customer checks apply there too.
      const ownerAsk = ownerLine && (ownerLine.status === "verify" || ownerLine.status === "pin");
```

     Wrap the existing `if (reputation.blocked) {…}` and `if (!verdict.allowed) {…}` returns in `if (!ownerAsk) { … }`. The cleared `dial` return (`:400-404`) becomes:

```ts
    return {
      kind: "dial", accountId: row.account_id, phoneNumberId: row.id,
      forwardCalls: profile.forward_calls === true, cleared: true,
      languages: profile.languages, firstTimeCaller, personaName: profile.persona_name,
      ...(ownerLine ? { ownerLine } : {}), ...(await withBilling()),
    };
```

     `ownerLine` is declared with `let ownerLine: … | undefined;` above the inner `try`, so the return can read it. The fail-open return inside `catch` (`:394-398`) carries no `ownerLine`, so an UNCLEARED call is never offered the owner line.
  4. `dialXml(…, drill = false, extra: { ownerLine?: { accountId: string; userId: string; role: OwnerPassRole }; wrap?: (dial: string) => string } = {})`. After `signature` is computed, add:

```ts
  // F-032 §4.3: the owner pass, only for a Telnyx-signed request (owner-pin refuses any other) and only with a
  // usable secret. A pass that cannot be signed is logged and the call reaches the receptionist, never an error.
  const ownerPass = extra.ownerLine && authenticated && calledE164
    ? signOwnerPass(token, { ...extra.ownerLine, calledE164 }, Date.now())
    : null;
  if (extra.ownerLine && !ownerPass) {
    console.error(`texml: an owner pass could not be signed — this call reaches the receptionist, accountId ${extra.ownerLine.accountId}`);
  }
```

     Then add `...(ownerPass ? [`${OWNER_PASS_HEADER}=${encodeURIComponent(ownerPass)}`] : []),` as the last element of `params`. The return becomes:

```ts
  const dial = `<Dial answerOnBridge="true" action="${xmlText(action)}" method="POST"><Sip>${xmlText(uri)}</Sip></Dial>`;
  return {
    body: extra.wrap ? extra.wrap(dial) : `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${dial}</Response>`,
    unsignedBridge,
  };
```

     The default body is byte-identical to before, which the existing tests pin.
  5. `answer(..., opts: { skipScreen?: boolean; skipOwnerLine?: boolean } = {})` passes `opts.skipOwnerLine === true` as a sixth argument to `route`. `route(..., skipScreen = false, skipOwnerLine = false)` calls `classify(calledE164, callerE164, !skipOwnerLine && authenticated && sipHandoffSecretConfigured())`.
  6. In `route`, right after the `cap` return (`:742`) and before the press-1 screen block. **AS BUILT after the Task 7 review (C-1, 2026-11-09). The first draft of this step was wrong.**
     - **The fall-through case.** After the Gather, Telnyx either posts to owner-pin or FALLS THROUGH to the next verb without asking us anything (A-3; the screen's own case A, `route.ts` `screenXml`). So the verbs after the Gather must already be today's path for this caller.
     - **The draft's defect.** It always followed the ask with the CLEARED bridge. When the ask had skipped a customer refusal (Q-C: repeat-spam, a cap), that bridge carried the model-down ticket `&f=`, which means "every guard cleared" (`fallback-ticket.ts`, `handoff/route.ts` `modelDownFallback`). On a fall-through the webhook declines the over-cap caller, and the handoff route then rang the business's transfer number, wrote a model-down forwarded row and raised a false "Sofía unreachable" alert (reproduced by the reviewer).
     - **As built.** `classify` always computes the two verdicts. For an ask, a refusal they reach is carried on the result as `ownerSkipped: { kind: "blocked" | "cap"; languages }` instead of being returned, reputation first as today. In `route`, the ask's fallthrough is:
       - **a skipped refusal:** `refusalVerbs(kind, languages)`, the same `<Say>…<Hangup/>` and language today's path speaks. `refusalXml`, used by today's three refusal returns, wraps the same string, so the two cannot differ by a byte. No bridge is minted at all.
       - **no refusal skipped:** today's bridge, cleared, because every guard really did clear.
     - The SC-17 states (forward, no-voice, drill) are checked in `classify`'s offer decision, not here, so the caps are skipped only when the step is actually offered (Task 7 report, deviation 1).
     - The XML helpers' `bridge` argument is named `fallthrough`, because it is today's path, not always a bridge.
     - `ownerLineGatherAgain` (step 7) had the same defect: owner-pin's re-ask also falls through. It now re-reads today's verdicts with `classify(..., false)`:
       - a refusal is followed by its sentence and hang-up;
       - the ticketed bridge only for the same account with every guard clear and no forward, no-voice or drill;
       - anything else (a failed read, the number now on another account) gets the UNCLEARED bridge, which the webhook gates.
     - Tests: `route.test.ts`, "the fallthrough after an ask is exactly today's path" and "ownerLineGatherAgain's fallthrough is today's path too". Each document is compared byte for byte with the `skipOwnerLine` document, with the token and the clock pinned.

```ts
    const ol = result.ownerLine;
    if (ol && result.cleared && result.accountId) {
      const locale: Locale = ol.language ?? ol.accountLanguage ?? "en";
      const persona = result.personaName || "Sofía";
      const accountId = result.accountId;
      const action = ownerPinUrl(origin);
      const skipped = result.ownerSkipped;
      const ask = (doc: (fallthrough: string) => string) => {
        if (skipped) return done(xmlResponse(doc(refusalVerbs(skipped.kind, skipped.languages))));
        const d = dialXml(calledE164, callerE164, origin, authenticated,
          { accountId, callerE164 }, false, { wrap: doc });
        return done(xmlResponse(d.body), false, d.unsignedBridge);
      };
      if (ol.status === "verify") {
        console.log(`texml owner line asking for a call-in code, accountId ${result.accountId}`);
        return ask((fallthrough) => ownerVerifyAskXml({ locale, action, retry: false, fallthrough }));
      }
      if (ol.status === "pin") {
        console.log(`texml owner line asking for a PIN, accountId ${result.accountId}`);
        return ask((fallthrough) => ownerPinAskXml({ locale, name: ol.name, persona, action, retry: false, fallthrough }));
      }
      // Over their own limit the person is a customer: no refusal was skipped, so the line, then today's bridge.
      console.log(`texml owner line over its daily limit — today's path, accountId ${result.accountId}`);
      return ask((fallthrough) => ownerLimitXml({ locale, persona, fallthrough }));
    }
```

     **The same review round also changed:**
     - **M-1.** The lookup races `OWNER_LINE_LOOKUP_DEADLINE_MS = 300`, then counts as a miss, logged by account. Why 300: spike §5 measured the lookup at p95 171–192 ms from a residential link, about 150 ms of which is the round trip, and 0.16 ms in Postgres.
     - **M-2.** The ask copy is in `./owner-line-copy.ts`, pinned byte for byte to the catalogue's `ownerLine.say.*` keys by `owner-line-copy.test.ts`. That test also checks that no `texml/` source imports `@/lib/messages`. The route's esbuild bundle went 598 KB → 48 KB (37 KB before Task 7).
     - **M-5.** The failure line names the error class only. The wrapper's "unexpected answer" message quotes the RPC answer, which includes a name and `pin_params`.
     - **Spanish (orchestrator decision).** The ES PIN ask names the key: "o oprima la tecla de gato (#) para hablar con {persona}".

  7. Append the two exports for Task 9:

```ts
/** F-032 §4.2: a correct PIN. The bridge every call gets, plus the owner pass. Only owner-pin calls this, and only
 *  for a Telnyx-signed request, so `authenticated` is true by construction. */
export function ownerLineBridge(
  calledE164: string, callerE164: string, origin: string,
  owner: { accountId: string; userId: string; role: OwnerPassRole },
): NextResponse {
  console.log(`texml owner line PIN ok — bridging with an owner pass, accountId ${owner.accountId}`);
  return xmlResponse(dialXml(calledE164, callerE164, origin, true,
    { accountId: owner.accountId, callerE164 }, false, { ownerLine: owner }).body);
}

/** F-032 §4.2: a wrong PIN (below 3) or a wrong code. Asks again, falling through to today's bridge. */
export async function ownerLineGatherAgain(
  calledE164: string, callerE164: string, origin: string,
  p: { kind: "pin" | "verify"; locale: Locale; accountId: string; name: string | null },
): Promise<NextResponse> {
  let persona = "Sofía";
  try {
    const { serviceDb, getVoiceProfile } = await import("@bis/db");
    persona = (await getVoiceProfile(serviceDb(), p.accountId))?.persona_name || persona;
  } catch (e) {
    console.error(`texml owner line: persona read failed — saying Sofía, accountId ${p.accountId}: ${String(e)}`);
  }
  const action = ownerPinUrl(origin);
  return xmlResponse(dialXml(calledE164, callerE164, origin, true, { accountId: p.accountId, callerE164 }, false, {
    wrap: (dial) => p.kind === "pin"
      ? ownerPinAskXml({ locale: p.locale, name: p.name, persona, action, retry: true, bridge: dial })
      : ownerVerifyAskXml({ locale: p.locale, action, retry: true, bridge: dial }),
  }).body);
}
```

  8. **The press-1 re-run never asks a customer for a PIN.** `screen/route.ts` re-runs `answer()` at `:66`, `:71` and `:97` with `{ skipScreen: true }` only. Pass `{ skipScreen: true, skipOwnerLine: true }` at all three. A caller who reached the screen was not an owner-line hit on the first pass, because the owner branch runs ahead of the screen, so a hit on the re-run could only come from a race or a flaky first read. Append to `screen/route.test.ts`, reading its harness first and reusing its signed-request helper and its `@bis/db` mock (add `ownerLineAnswerLookup` to that mock, resolving a `pin` hit):

```ts
it("a customer who pressed 1 is never asked for a PIN on the re-run (mutation: drop skipOwnerLine at :71 -> FAILS)", async () => {
  // arrange the screen's own "pressed 1" request (Digits "1"), with the owner lookup mocked to a pin hit
  const xml = await (await pressed("1")).text();   // `pressed` = this file's helper for a signed Digits request
  expect(xml).not.toContain("<Gather");
  expect(xml).toContain("<Dial");
});
```

  The comment lines name this file's own helper by role, because its exact name is not quoted here. Before writing the case, read `screen/route.test.ts`'s top and use its real helper and mock names.

- [ ] **Step 6: Run green, the whole TeXML folder included.**

  ```bash
  pnpm --filter web exec vitest run src/app/api/voice/texml src/lib/voice/sip-handoff-signature.test.ts src/lib/i18n src/lib/messages.test.ts
  ```

  Expected: green, and every pre-existing case unchanged. Paste the summary line.

- [ ] **Step 7: Mutation probes.** Each must FAIL BY NAME:
  1. Pass `true` instead of `authenticated` into the eligibility → "an UNSIGNED request never looks the owner up" FAILS.
  2. Move the lookup INTO the count `Promise.all` and delete its `.catch` → "a lookup that throws is a miss AND the call stays CLEARED" FAILS. The batch rejects, the uncleared fail-open dial carries no `&f=`, and the `owner-line lookup failed` line is absent. (Moving it in WITH its catch would survive, which is why the probe removes both.)
  3. Remove `!result.forwardCalls` → "the agency's forward is on: not offered" FAILS.
  4. In `ownerLineBridge`, sign with `newHandoffToken()` instead of the dial's `token` → "carries an owner pass that verifies against THIS dial's handoff token" FAILS.
  5. Drop the `if (!ownerAsk)` wrapper → "a registered person is never refused by the CUSTOMER caps" FAILS.
  6. In `screen/route.ts`, drop `skipOwnerLine: true` from the press-1 re-run → "a customer who pressed 1 is never asked for a PIN" FAILS.

- [ ] **Step 8: Commit.**

  ```bash
  git add apps/web/src/lib/owner-line/names.ts apps/web/src/app/api/voice/texml/screen apps/web/src/app/api/voice/texml/owner-line-xml.ts apps/web/src/app/api/voice/texml/owner-line-xml.test.ts apps/web/src/app/api/voice/texml/route.ts apps/web/src/app/api/voice/texml/route.test.ts apps/web/src/app/api/voice/texml/wellformed.test.ts apps/web/src/lib/messages.ts
  git commit -m "feat(voice): the answer route asks a registered, verified cell for its PIN before the bridge; every other caller's call is unchanged"
  ```

---

## Task 8: Lockout email (MEDIUM, 0.25 day)

**Files:**
- Create: `apps/web/src/lib/email/templates/owner-line.ts` and `owner-line.test.ts` (following bis-comms' template conventions: `shell`, `escapeHtml`, `emailBrand`, as in `templates/voice.ts:1-4`).
- Create: `apps/web/src/lib/owner-line/lockout.ts` and `lockout.test.ts`.
- Modify: `apps/web/src/lib/consent/classes.ts:125` (add `"operator.owner_line_lockout"` beside `"operator.call_alert"`).
- Modify: `apps/web/src/lib/messages.ts` (the `ownerLine.email.*` keys).

**Interfaces:**
- Consumes: `sendEmailOrThrow({ accountId, kind, to, fromName, subject, body, html })` (`WEB/lib/consent/email-gate.ts:406`, called at `finish-call.ts:716-720`), `listAccountTeam(db, accountId): TeamMember[]` (`DB/team.ts:156`), `getBranding(db, accountId)` (`DB/branding.ts:345`), `readAccountTimezone(db, accountId): string | null` (`DB/automation-settings.ts:13`), `emailBrand(branding)` (`WEB/lib/email/templates/shell.ts:68`).
- Produces:

```ts
export function ownerLineLockoutEmail(i: { brand: EmailBrand; locale: Locale; forSelf: boolean; personName: string | null;
  time: string; until: string }): { subject: string; text: string; html: string };
export async function sendOwnerLineLockoutEmails(p: { accountId: string; userId: string; lockedUntil: string;
  at: Date; accountLanguage: "en" | "es" | null }, deps?: { send: typeof sendEmailOrThrow }): Promise<void>;
// scheduleOwnerLineLockoutEmails was REMOVED at Task 9's decision point (2026-11-09): owner-pin captures `at` before
// after() and calls sendOwnerLineLockoutEmails inside it, so the module never loads before the response.
```

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/web/src/lib/owner-line/lockout.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ team: vi.fn(), brand: vi.fn(), zone: vi.fn() }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}), listAccountTeam: db.team, getBranding: db.brand, readAccountTimezone: db.zone,
}));
import { sendOwnerLineLockoutEmails } from "./lockout";

const AT = new Date("2026-11-09T20:14:00.000Z");      // 2:14 PM in America/Chicago
const UNTIL = "2026-11-09T20:44:00.000Z";
const P = { accountId: "a1", userId: "u-staff", lockedUntil: UNTIL, at: AT, accountLanguage: "en" as const };
beforeEach(() => {
  db.brand.mockResolvedValue({ brandName: "Rio Roofing" });
  db.zone.mockResolvedValue("America/Chicago");
  db.team.mockResolvedValue([
    { userId: "u-staff", clerkUserId: "c1", email: "dan@example.com", name: "Dan Lopez", role: "staff", language: "es" },
    { userId: "u-owner", clerkUserId: "c2", email: "ana@example.com", name: "Ana", role: "owner", language: null },
  ]);
});

describe("three wrong PINs email the person and the account's Owner (spec §4.2)", () => {
  it("one email each, each in its reader's own language, kind operator.owner_line_lockout, with the time in the account's zone", async () => {
    const send = vi.fn().mockResolvedValue({ id: "x" });
    await sendOwnerLineLockoutEmails(P, { send });
    expect(send).toHaveBeenCalledTimes(2);
    const [self, owner] = send.mock.calls.map((c) => c[0]);
    expect(self).toMatchObject({ accountId: "a1", kind: "operator.owner_line_lockout", to: "dan@example.com" });
    expect(self.body).toContain("2:14");          // es-US renders "2:14 p.m."
    expect(self.subject).toBe("Alguien marcó el PIN incorrecto 3 veces");
    expect(owner).toMatchObject({ to: "ana@example.com" });
    expect(owner.body).toContain("Someone entered the wrong PIN 3 times from Dan's phone at 2:14 PM");
    expect(owner.body).toContain("2:44 PM");
  });
  it("an Owner locked out gets ONE email, and it is the 'from your phone' one, not the third-person one (mutation: drop the has() guard so the owner loop overwrites the entry -> forSelf flips, FAILS)", async () => {
    // A Map keyed by address can never send two, so a count alone could not fail. What the overwrite would change is
    // WHICH email: forSelf false says "from Ana's phone" to Ana. The body is the assertion.
    const send = vi.fn().mockResolvedValue({ id: "x" });
    await sendOwnerLineLockoutEmails({ ...P, userId: "u-owner" }, { send });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].body).toContain("from your phone");
  });
  it("addresses are compared case-insensitively: Dan@ and dan@ are one person", async () => {
    db.team.mockResolvedValue([
      { userId: "u-owner", clerkUserId: "c2", email: "Ana@Example.com", name: "Ana", role: "owner", language: null },
      { userId: "u-owner2", clerkUserId: "c3", email: "ana@example.com", name: "Ana", role: "owner", language: null },
    ]);
    const send = vi.fn().mockResolvedValue({ id: "x" });
    await sendOwnerLineLockoutEmails({ ...P, userId: "u-owner" }, { send });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("one failed send never stops the other (mutation: drop the per-recipient catch -> FAILS)", async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error("resend down")).mockResolvedValue({ id: "x" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await sendOwnerLineLockoutEmails(P, { send });
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("never names the business by its internal label: the brand name only", async () => {
    const send = vi.fn().mockResolvedValue({ id: "x" });
    await sendOwnerLineLockoutEmails(P, { send });
    expect(send.mock.calls[0]![0].fromName).toBe("Rio Roofing");
  });
});
```

```ts
// apps/web/src/lib/email/templates/owner-line.test.ts
import { describe, it, expect } from "vitest";
import { ownerLineLockoutEmail } from "./owner-line";

const brand = { name: "Rio Roofing", logoUrl: null, color: "#6D28D9" } as never;
describe("ownerLineLockoutEmail", () => {
  it("escapes the person's name and keeps one language end to end", () => {
    const e = ownerLineLockoutEmail({ brand, locale: "en", forSelf: false, personName: "<b>Dan</b>", time: "2:14 PM", until: "2:44 PM" });
    expect(e.html).not.toContain("<b>Dan</b>");
    expect(e.text).toContain("from <b>Dan</b>'s phone");
    expect(e.subject).toBe("Someone entered the wrong PIN 3 times");
  });
});
```

Read `EmailBrand`'s real fields in `shell.ts:4` before writing `brand`, and build it with `emailBrand({ brandName: "Rio Roofing" } as Branding)` if the shape differs.

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  pnpm --filter web exec vitest run src/lib/owner-line/lockout.test.ts src/lib/email/templates/owner-line.test.ts
  ```

  Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement.**

```ts
// apps/web/src/lib/email/templates/owner-line.ts
import { shell, escapeHtml, type EmailBrand } from "./shell";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { Locale } from "@/lib/i18n/locale";

/** F-032 §4.2: three wrong PINs. To the person (forSelf) or to the account's Owner. One language end to end. */
export function ownerLineLockoutEmail(i: {
  brand: EmailBrand; locale: Locale; forSelf: boolean; personName: string | null; time: string; until: string;
}): { subject: string; text: string; html: string } {
  const subject = t(m, "ownerLine.email.subject", i.locale);
  const body = i.forSelf
    ? t(m, "ownerLine.email.self", i.locale, { time: i.time, until: i.until })
    : i.personName
      ? t(m, "ownerLine.email.owner", i.locale, { name: i.personName, time: i.time, until: i.until })
      : t(m, "ownerLine.email.ownerNoName", i.locale, { time: i.time, until: i.until });
  const tail = t(m, i.forSelf ? "ownerLine.email.selfTail" : "ownerLine.email.ownerTail", i.locale);
  const text = `${body}\n\n${tail}`;
  const html = shell(i.brand, `<p>${escapeHtml(body)}</p><p>${escapeHtml(tail)}</p>`);
  return { subject, text, html };
}
```

**As built (2026-11-09), after Task 9's decision point and review m-1: the committed file.** The scheduler is gone (owner-pin calls `sendOwnerLineLockoutEmails` inside `after()`), and both failure lines log through `loggableError`, because a provider's rejection can quote the recipient ("550 <ana@example.com>: recipient rejected").

```ts
// apps/web/src/lib/owner-line/lockout.ts
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
import { emailBrand } from "@/lib/email/templates/shell";
import { ownerLineLockoutEmail } from "@/lib/email/templates/owner-line";
import { firstName } from "@/lib/owner-line/names";
import { loggableError } from "@/lib/loggable-error";
import type { Locale } from "@/lib/i18n/locale";

/**
 * F-032 §4.2: "email the person and the account's Owner ('Someone entered the wrong PIN 3 times from your phone at
 * 2:14 PM')". Each recipient in their own language (users.language, then the account's, then English), deduplicated
 * by address, each send in its own try/catch so one failure never costs the other. Never throws.
 * THIS MODULE REACHES @bis/db AT MODULE SCOPE, through email-gate.ts:1-5 and templates/shell.ts:1, so a TeXML route
 * must never import it statically (route.ts:219-226; SC-18). owner-pin imports it with await import() INSIDE after(),
 * once the caller has been answered, and captures the lock instant (`at`) before calling after()
 * (owner-pin/route.ts lockoutEmailsAfterResponse; the module's chunk is about 613 KB with the catalogue, which must
 * never load on Telnyx's answer deadline). The await import("@bis/db") below is for this file's own reads.
 */
export async function sendOwnerLineLockoutEmails(
  p: { accountId: string; userId: string; lockedUntil: string; at: Date; accountLanguage: "en" | "es" | null },
  deps: { send: typeof sendEmailOrThrow } = { send: sendEmailOrThrow },
): Promise<void> {
  try {
    const { serviceDb, listAccountTeam, getBranding, readAccountTimezone } = await import("@bis/db");
    const db = serviceDb();
    const [team, branding, zoneRead] = await Promise.all([
      listAccountTeam(db, p.accountId), getBranding(db, p.accountId), readAccountTimezone(db, p.accountId),
    ]);
    const zone = zoneRead ?? "America/Chicago";
    const brand = emailBrand(branding);
    const person = team.find((x) => x.userId === p.userId);
    const recipients = new Map<string, { to: string; language: "en" | "es" | null; forSelf: boolean }>();
    // Keyed by the lowercased address; the person goes in FIRST and is never overwritten, so a locked-out Owner gets
    // the "from your phone" email, not the one about "Ana's phone".
    const key = (email: string) => email.trim().toLowerCase();
    if (person) recipients.set(key(person.email), { to: person.email, language: person.language, forSelf: true });
    for (const o of team.filter((x) => x.role === "owner")) {
      if (!recipients.has(key(o.email))) recipients.set(key(o.email), { to: o.email, language: o.language, forSelf: false });
    }
    // ICU writes a narrow no-break space before AM/PM; a plain space reads the same and matches every other email.
    const at = (iso: Date | string, locale: Locale) => new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US",
      { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date(iso)).replace(/\u202F/g, " ");
    for (const r of recipients.values()) {
      const to = r.to;
      const locale: Locale = r.language ?? p.accountLanguage ?? "en";
      const email = ownerLineLockoutEmail({
        brand, locale, forSelf: r.forSelf, personName: firstName(person?.name ?? null),
        time: at(p.at, locale), until: at(p.lockedUntil, locale),
      });
      try {
        await deps.send({ accountId: p.accountId, kind: "operator.owner_line_lockout", to, fromName: brand.name,
          subject: email.subject, body: email.text, html: email.html });
      } catch (e) {
        // loggableError (review m-1): a provider's rejection can quote the recipient ("550 <ana@…>: recipient rejected").
        console.error(`owner line lockout email failed for one recipient, accountId ${p.accountId}: ${loggableError(e)}`);
      }
    }
  } catch (e) {
    console.error(`owner line lockout emails could not be prepared, accountId ${p.accountId}: ${loggableError(e)}`);
  }
}
```

**Corrections from the Task 8 review (2026-11-09), binding on the code above:**
- `lockedUntil` is a `string`, never null: Task 2's `attemptOwnerLinePin` returns it on every `locked_now` (the same UPDATE's RETURNING) and throws otherwise, so the email never prints an empty "until".
- The lock instant is captured BEFORE `after()`: the email states when the PIN was keyed, not when the deferred work ran. **Since Task 9's decision point that capture lives in owner-pin (`lockoutEmailsAfterResponse`), which also imports this module inside `after()`; `scheduleOwnerLineLockoutEmails` is removed, and the capture is pinned in `owner-pin/route.test.ts`.**
- The narrow no-break space is matched by the six-character escape `\u202f` in both regexes. Keep it an escape: the Write and Edit tools turn it into the literal character, which no reviewer can see.
- The tail names the page as the app does: "Preferences" / "Preferencias", never "Mis preferencias".
- **No test that merely imports `lockout.ts` through `import()` and checks that its exports are functions.** Static and dynamic imports resolve the same module, so that case cannot fail on the import FORM, which is the only thing SC-18 is about. The real guard is Task 9's source scan (`texml-no-static-db.test.ts`): no file under `app/api/voice/texml/` imports `lib/owner-line/lockout` (or anything else that reaches `@bis/db`) statically.

Add the `classes.ts` line `"operator.owner_line_lockout": { class: "operator", hours: "any", footer: "none" },` beside `operator.call_alert`. Add the copy to `messages.ts`:

```ts
  "ownerLine.email.subject": "Someone entered the wrong PIN 3 times",
  "ownerLine.email.subject.es": "Alguien marcó el PIN incorrecto 3 veces",
  "ownerLine.email.self": "Someone entered the wrong PIN 3 times from your phone at {time}. Calling in from your phone is paused until {until}.",
  "ownerLine.email.self.es": "Alguien marcó el PIN incorrecto 3 veces desde su teléfono a las {time}. Las llamadas desde su teléfono están en pausa hasta las {until}.",
  "ownerLine.email.selfTail": "If it was you, wait and try again. If it was not you, change your PIN in Preferences.",
  "ownerLine.email.selfTail.es": "Si fue usted, espere e intente de nuevo. Si no fue usted, cambie su PIN en Preferencias.",
  "ownerLine.email.owner": "Someone entered the wrong PIN 3 times from {name}'s phone at {time}. Calling in from that phone is paused until {until}.",
  "ownerLine.email.owner.es": "Alguien marcó el PIN incorrecto 3 veces desde el teléfono de {name} a las {time}. Las llamadas desde ese teléfono están en pausa hasta las {until}.",
  "ownerLine.email.ownerNoName": "Someone entered the wrong PIN 3 times from a team member's phone at {time}. Calling in from that phone is paused until {until}.",
  "ownerLine.email.ownerNoName.es": "Alguien marcó el PIN incorrecto 3 veces desde el teléfono de alguien de su equipo a las {time}. Las llamadas desde ese teléfono están en pausa hasta las {until}.",
  "ownerLine.email.ownerTail": "Nothing about your business was read out. The caller was answered like any customer.",
  "ownerLine.email.ownerTail.es": "No se leyó nada de su negocio. A la persona se le atendió como a cualquier cliente.",
```

- [ ] **Step 4: Run green with the consent and i18n gates.**

  ```bash
  pnpm --filter web exec vitest run src/lib/owner-line/lockout.test.ts src/lib/email/templates src/lib/consent src/lib/i18n src/lib/messages.test.ts
  ```

  Expected: green. Paste the summary line.

- [ ] **Step 5: Commit.**

  ```bash
  git add apps/web/src/lib/owner-line/lockout.ts apps/web/src/lib/owner-line/lockout.test.ts apps/web/src/lib/email/templates/owner-line.ts apps/web/src/lib/email/templates/owner-line.test.ts apps/web/src/lib/consent/classes.ts apps/web/src/lib/messages.ts
  git commit -m "feat(voice): owner line lockout email to the person and the Owner, each in their own language"
  ```

---

## Task 9: The `owner-pin` route: verify, PIN, lockout (HIGH, 1 day)

**Files:**
- Create: `apps/web/src/app/api/voice/texml/owner-pin/route.ts` and `route.test.ts`
- Create: `apps/web/src/app/api/voice/texml/texml-no-static-db.test.ts` (the I-8 guard, SC-18)

**Interfaces:**
- Consumes (Task 7): `answer`, `ownerLineBridge`, `ownerLineGatherAgain`, `bridgeAfterFailure`, `actionOrigin`, `xmlResponse` (`../route`), plus `ownerVerifiedXml` (`../owner-line-xml`).
- Consumes (Task 2): `readTelnyxForm` and `logFormFields` (`../telnyx-request`), `ownerLineAnswerLookup`, `attemptOwnerLineVerify`, `attemptOwnerLinePin`, `getPhoneNumberByE164`, `OWNER_LINE_MAX_CALLS_PER_DAY`.
- Consumes (Task 3): `candidateFor`, `hashVerifyCode`.
- Consumes (Task 8): `sendOwnerLineLockoutEmails`, imported inside `after()` with `at` captured before it (decision point, 2026-11-09).
- Consumes (Task 7, review m-4): `ownerLineStillOffered` (`../route`), which re-reads today's states before a pass.
- Produces: `GET` (always 405) and `POST` at `/api/voice/texml/owner-pin`.

- [ ] **Step 1: Write the failing tests.** These isolate the decision: `../route`, `../telnyx-request`, `@bis/db` and the lockout scheduler are mocked.

```ts
// apps/web/src/app/api/voice/texml/owner-pin/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

const h = vi.hoisted(() => ({
  form: { ok: true as const, form: new URLSearchParams(), authenticated: true },
  today: vi.fn(), bridge: vi.fn(), again: vi.fn(), failsafe: vi.fn(),
  phone: vi.fn(), look: vi.fn(), verify: vi.fn(), pin: vi.fn(), lockout: vi.fn(),
}));
const xml = (s: string) => new NextResponse(s, { status: 200 });
vi.mock("../telnyx-request", () => ({ readTelnyxForm: vi.fn(async () => h.form), logFormFields: vi.fn() }));
vi.mock("../route", () => ({
  actionOrigin: () => "https://x.example",
  answer: (...a: unknown[]) => h.today(...a),
  ownerLineBridge: (...a: unknown[]) => h.bridge(...a),
  ownerLineGatherAgain: (...a: unknown[]) => h.again(...a),
  bridgeAfterFailure: (...a: unknown[]) => h.failsafe(...a),
  xmlResponse: (s: string) => xml(s),
}));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({}), OWNER_LINE_MAX_CALLS_PER_DAY: 10,
  getPhoneNumberByE164: h.phone, ownerLineAnswerLookup: h.look,
  attemptOwnerLineVerify: h.verify, attemptOwnerLinePin: h.pin,
}));
vi.mock("@/lib/owner-line/lockout", () => ({ sendOwnerLineLockoutEmails: h.lockout }));   // as built: also next/server's after() recorded

import { GET, POST } from "./route";
import { hashPin } from "@/lib/owner-line/secrets";

const TO = "+19565550999";
const CELL = "+19565550142";
const post = (fields: Record<string, string>) => {
  h.form = { ok: true, form: new URLSearchParams({ To: TO, From: CELL, ...fields }), authenticated: h.form.authenticated };
  return POST(new Request("https://x.example/api/voice/texml/owner-pin", { method: "POST", body: "" }));
};
let HASH = "";
const PIN_HIT = () => ({ status: "pin", enrollmentId: "e1", userId: "u1", role: "staff", name: "Dan", language: "en",
  accountLanguage: null, pinParams: HASH.slice(0, 36) });

beforeEach(async () => {
  vi.clearAllMocks();
  h.form = { ok: true, form: new URLSearchParams(), authenticated: true };
  process.env.OWNER_LINE_PIN_PEPPER = "p".repeat(40);
  HASH ||= await hashPin("482913");
  h.today.mockResolvedValue(xml("TODAY"));
  h.bridge.mockReturnValue(xml("BRIDGE"));
  h.again.mockResolvedValue(xml("AGAIN"));
  h.failsafe.mockReturnValue(xml("FAILSAFE"));
  h.phone.mockResolvedValue({ id: "pn", account_id: "a1", status: "live" });
  h.look.mockResolvedValue(PIN_HIT());
});

describe("owner-pin (F-032 §4.2)", () => {
  it("GET is 405 whatever the environment", async () => {
    expect((await GET(new Request("https://x.example/api/voice/texml/owner-pin?Digits=482913"))).status).toBe(405);
  });

  it("an UNSIGNED request checks nothing and gets today's path (mutation: drop the authenticated guard -> FAILS)", async () => {
    h.form.authenticated = false;
    expect(await (await post({ Digits: "482913" })).text()).toBe("TODAY");
    expect(h.look).not.toHaveBeenCalled();
    expect(h.pin).not.toHaveBeenCalled();
  });

  it("the right PIN bridges with the owner pass for THIS person and role, and the digits never reach a log", async () => {
    h.pin.mockResolvedValue({ status: "ok", lockedUntil: null });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await (await post({ Digits: "482913" })).text()).toBe("BRIDGE");
    expect(h.pin).toHaveBeenCalledWith({}, "e1", HASH);
    expect(h.bridge).toHaveBeenCalledWith(TO, CELL, "https://x.example", { accountId: "a1", userId: "u1", role: "staff" });
    expect(log.mock.calls.flat().join(" ")).not.toContain("482913");
  });

  it.each([[""], ["#"]])("Digits %j (pound, or a timeout) is today's path and does NOT count as a wrong PIN (mutation: attempt it -> FAILS)", async (d) => {
    expect(await (await post({ Digits: d })).text()).toBe("TODAY");
    expect(h.pin).not.toHaveBeenCalled();
    expect(h.today).toHaveBeenCalledWith(TO, CELL, "https://x.example", true, { skipScreen: true, skipOwnerLine: true });
  });

  it("no pepper: today's path, and NO attempt is counted against the person (O-3; mutation: drop the pepper check -> the outer catch bridges instead, FAILS)", async () => {
    delete process.env.OWNER_LINE_PIN_PEPPER;
    expect(await (await post({ Digits: "482913" })).text()).toBe("TODAY");
    expect(h.pin).not.toHaveBeenCalled();
  });

  it.each([["spent"], ["none"]])("a call-in code that is %s goes to today's path, never a hang-up (spec §2.1, §3.2; mutation: answer spent with <Hangup/> -> FAILS)", async (r) => {
    h.look.mockResolvedValue({ ...PIN_HIT(), status: "verify", pinParams: null });
    h.verify.mockResolvedValue(r);
    expect(await (await post({ Digits: "123456" })).text()).toBe("TODAY");
  });

  it("a wrong PIN below three asks again; a short entry counts as wrong", async () => {
    h.pin.mockResolvedValue({ status: "wrong", lockedUntil: null });
    expect(await (await post({ Digits: "1234#" })).text()).toBe("AGAIN");
    expect(h.pin).toHaveBeenCalledWith({}, "e1", "invalid");
    expect(h.again).toHaveBeenCalledWith(TO, CELL, "https://x.example", { kind: "pin", locale: "en", accountId: "a1", name: "Dan" });
  });

  it("the third wrong PIN emails both people and the call continues as a customer's (mutation: hang up instead -> FAILS)", async () => {
    h.pin.mockResolvedValue({ status: "locked_now", lockedUntil: "2026-11-09T20:44:00.000Z" });
    expect(await (await post({ Digits: "111112" })).text()).toBe("TODAY");
    expect(h.lockout).toHaveBeenCalledWith({ accountId: "a1", userId: "u1", lockedUntil: "2026-11-09T20:44:00.000Z", accountLanguage: null });
  });

  it("a call-in code: the sha256 of the digits is what is checked, never the digits", async () => {
    h.look.mockResolvedValue({ ...PIN_HIT(), status: "verify", pinParams: null });
    h.verify.mockResolvedValue("verified");
    const res = await (await post({ Digits: "123456" })).text();
    expect(res).toContain("This phone is verified");
    expect(h.verify).toHaveBeenCalledWith({}, "a1", CELL, "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92");
  });

  it("a stranger or a status that is not verify/pin is today's path", async () => {
    h.look.mockResolvedValue({ status: "none" });
    expect(await (await post({ Digits: "482913" })).text()).toBe("TODAY");
    expect(h.pin).not.toHaveBeenCalled();
  });

  it("anything that throws is the last-resort bridge, never a 500", async () => {
    h.look.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await (await post({ Digits: "482913" })).text()).toBe("FAILSAFE");
  });
});
```

**The source scan (I-8; SC-18; rewritten for review m-D).** The unit tests mock `@/lib/owner-line/lockout`, so they cannot see HOW it is imported. This file walks every source under `app/api/voice/texml/` and everything it imports AT MODULE SCOPE, following resolved `@/` and relative paths transitively, and fails, printing each chain, when any walk reaches the bare `@bis/db`. It recognises every module-scope form: `import x from`, a bare `import "x"`, `export … from`, either quote, and a trailing comment. It skips what the build erases (`import type`, `export type`, an import whose every name is `type`; `tsconfig.json` sets no `verbatimModuleSyntax`) and the dynamic `await import(...)` inside a handler, which is the allowed form. `@bis/db/*` subpaths are pure modules and stay allowed. Proven 2026-11-09 with a scratch script of the same logic, and this file run once in place: all twelve sample forms classified as below, the real `lockout.ts` reaches `@bis/db` through `lib/consent/email-gate.ts`, and today's seven `texml` sources reach nothing.

```ts
// apps/web/src/app/api/voice/texml/texml-no-static-db.test.ts
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEXML = fileURLToPath(new URL(".", import.meta.url));
const SRC = resolve(TEXML, "../../../..");                 // apps/web/src
const FORBIDDEN = /^@bis\/db$/;                            // subpaths (@bis/db/phone, ...) are pure and allowed

/** Every specifier a module imports or re-exports at MODULE SCOPE (see the paragraph above for what is skipped). */
function staticSpecifiers(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  const stmt = /^[ \t]*(import|export)\s+(?!type\b)([^;'"]*?)\s*from\s*(['"])([^'"]+)\3|^[ \t]*import\s*(['"])([^'"]+)\5/gm;
  for (const m of code.matchAll(stmt)) {
    if (m[6] !== undefined) { out.push(m[6]); continue; }
    const braces = (m[2] ?? "").match(/^\{([\s\S]*)\}$/);
    if (braces && braces[1]!.split(",").map((s) => s.trim()).filter(Boolean).every((s) => /^type\s/.test(s))) continue;
    out.push(m[4]!);
  }
  return out;
}

function resolveLocal(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(fromFile), spec) : null;
  if (base === null) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx"), base]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/** Every chain from `file` to a forbidden specifier, through resolved local imports (cycle-safe). */
function forbiddenChains(file: string, seen = new Set<string>(), chain: string[] = []): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const here = [...chain, relative(SRC, file).replace(/\\/g, "/")];
  return staticSpecifiers(readFileSync(file, "utf8")).flatMap((spec) => {
    if (FORBIDDEN.test(spec)) return [[...here, spec].join(" -> ")];
    const next = resolveLocal(spec, file);
    return next ? forbiddenChains(next, seen, here) : [];
  });
}

const entries = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (statSync(p).isDirectory()) return entries(p);
  return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
});

describe("no TeXML route reaches @bis/db at module scope (SC-18; reviews I-8 and m-D)", () => {
  it("recognises every module-scope form and skips only what the build erases (mutation: drop the bare-import branch -> FAILS)", () => {
    const one = (s: string) => staticSpecifiers(s);
    expect([
      one(`import "@bis/db";`), one(`export { serviceDb } from "@bis/db";`), one(`import { a } from '@bis/db';`),
      one(`import { a } from "@bis/db"; // the db`), one(`import {\n  a,\n  b,\n} from "@bis/db";`),
      one(`import { type A, b } from "@bis/db";`),
    ]).toEqual([["@bis/db"], ["@bis/db"], ["@bis/db"], ["@bis/db"], ["@bis/db"], ["@bis/db"]]);
    expect([
      one(`import type { A } from "@bis/db";`), one(`import { type A, type B } from "@bis/db";`),
      one(`export type { A } from "@bis/db";`), one(`const { a } = await import("@bis/db");`),
      one(`// import { a } from "@bis/db";\n/* import { b } from "@bis/db"; */`),
    ]).toEqual([[], [], [], [], []]);
  });

  it("walks transitively: the real lockout module reaches @bis/db through the email gate (positive control; mutation: stop following @/ imports -> FAILS)", () => {
    expect(forbiddenChains(join(SRC, "lib/owner-line/lockout.ts"))).toContain(
      "lib/owner-line/lockout.ts -> lib/consent/email-gate.ts -> @bis/db");
  });

  it("no source under app/api/voice/texml/ reaches @bis/db at module scope, directly or through anything it imports (mutation: import sendOwnerLineLockoutEmails statically in owner-pin/route.ts -> FAILS naming the chain)", () => {
    const files = entries(TEXML);
    expect(files.some((f) => f.endsWith(join("owner-pin", "route.ts")))).toBe(true);   // the walk sees owner-pin
    expect(files.flatMap((f) => forbiddenChains(f))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

  ```bash
  pnpm --filter web exec vitest run src/app/api/voice/texml/owner-pin/route.test.ts src/app/api/voice/texml/texml-no-static-db.test.ts
  ```

  Expected: FAIL, `Failed to resolve import "./route"` for the route test; the scan's forms case and its transitive control PASS, and its third case FAILS on the owner-pin control (`owner-pin/route.ts` does not exist yet), as measured 2026-11-09: `Tests  1 failed | 2 passed (3)`.

- [ ] **Step 3: Implement.**

**As built (2026-11-09), after the Task 9 review and its decision point: the committed file.** What changed from the first draft of this step:
- **m-2 (orchestrator decision, fail closed):** anything that throws tries TODAY'S PATH first (`answer(..., { skipScreen: true, skipOwnerLine: true })`), so an over-cap caller still hears the cap sentence and the `screened_calls` row is written; only if that also throws is it `bridgeAfterFailure`. Proven end to end in `owner-pin/today-path.test.ts`.
- **m-3 (SC-14):** the entry guard also requires `sipHandoffSecretConfigured()`; without it, today's path with nothing checked.
- **m-4:** a correct PIN mints the pass only after `ownerLineStillOffered` re-reads VOICE_FORWARD_TO, the drill, the profile's `forward_calls` and billing's no-voice with the answer route's own reads; otherwise today's path, no pass.
- **m-6:** `readTelnyxForm(req, "texml owner-pin", { logCaller: false })`: the shared reader's refusal line names the claimed called number only.
- **Decision point:** the lockout emails are prepared and sent inside `after()`, `at` captured before (`lockoutEmailsAfterResponse`).
- **Logs:** an error's CLASS, never `String(e)` (a message can quote the caller, the digits or the hash). The phone-number row's local is `line`, not `phone`: `phone` tripped the consent scan's F-009 phone-binding rule.

```ts
// apps/web/src/app/api/voice/texml/owner-pin/route.ts
// The owner line's PIN and call-in code step (F-032 §3.2, §4.2). /api/voice/texml asked a registered cell for a
// PIN (or for the code shown on their screen) with <Gather>; Telnyx posts the keys here.
//
// TELNYX-SIGNED OR NOTHING. A request whose signature fails is refused 403 by the shared reader before this file
// reads a thing (../telnyx-request.ts). An UNSIGNED request (TELNYX_PUBLIC_KEY unset) checks nothing and gets today's
// path, unsigned: this route would otherwise be an oracle anyone could feed a caller ID and guesses (spec §4.2:
// "must carry a valid Telnyx signature"), and its one bridge that carries an owner pass (../route.ts
// ownerLineBridge) is minted as Telnyx-signed by construction. That guard is what makes the construction true.
// GET is 405 always, because a GET carries no signed body.
//
// The account and the person are re-derived from the SIGNED To/From on every request; nothing on the query string is
// trusted. The role is re-checked against OWNER_LINE_ROLES here (O-1 = F2: Owner and Staff), because the two SQL
// attempt functions check no role at all. A PIN check happens only in SQL (owner_line_attempt_pin), under a row lock
// that owns the counter and the lock.
//
// LOGS carry statuses and the account id only: never the caller's number, the digits, the code or its hash, and
// for a failure the error's CLASS, never its message (a message can quote any of those).
//
// WHAT THE CALLER GETS. Every path that is not the owner's own ends in TODAY'S PATH: answer() with the screen and the
// owner line skipped, which re-runs every customer check (a refusal is spoken and recorded in screened_calls, a
// clear call gets the cleared bridge). Never a hang-up of this route's own (plan I-3, spec §2.1).
//   - pound, a timeout, or no digits: today's path, and NOT an attempt;
//   - the right PIN: today's bridge with the owner pass, bound to THAT dial's handoff token (ownerLineBridge),
//     once today's states are re-read (ownerLineStillOffered);
//   - a wrong PIN, 1st or 2nd: asked again; the re-ask re-reads today's verdicts for its own fallthrough;
//   - the 3rd wrong PIN: the lock, today's path as a customer, and the two emails, prepared and sent after the response;
//   - no OWNER_LINE_PIN_PEPPER (plan O-3): today's path, and no attempt is counted against the person;
//   - a call-in code: verified (a goodbye), wrong (asked again), spent or unknown (today's path; the card tells the
//     person to make a new code);
//   - the right PIN while today's path no longer reaches Sofía (the forward, billing, the drill): today's path;
//   - no usable VOICE_HANDOFF_SECRET: today's path, nothing checked (SC-14);
//   - anything that throws: today's path (fail closed); only if that throws too, the last-resort bridge, never a 500.
//
// No module-scope @bis/db, directly or through anything imported here (plan SC-18; ../texml-no-static-db.test.ts):
// the database is imported inside the handler, and the lockout module (which reaches it through the email gate)
// only inside after(), once the caller has been answered (lockoutEmailsAfterResponse).
import { NextResponse, after } from "next/server";
import { e164Of } from "@/lib/voice/phone-number";
import {
  actionOrigin, answer, bridgeAfterFailure, ownerLineBridge, ownerLineGatherAgain, ownerLineStillOffered, xmlResponse,
} from "../route";
import { logFormFields, readTelnyxForm } from "../telnyx-request";
import { ownerVerifiedXml } from "../owner-line-xml";
import { candidateFor, hashVerifyCode, pinPepperConfigured } from "@/lib/owner-line/secrets";
import { OWNER_LINE_ROLES } from "@/lib/owner-line/data-path";
import { sipHandoffSecretConfigured } from "@/lib/voice/sip-handoff-signature";

export const runtime = "nodejs";
const SIX = /^[0-9]{6}$/;

/** An error as a log line may name it: its class only. */
const errorClass = (e: unknown) => (e instanceof Error ? e.name : typeof e);

/**
 * The third wrong PIN's two emails (spec §4.2), entirely OFF Telnyx's answer deadline.
 *   - The lock instant is captured HERE, before after() defers anything, so the email's "at 2:14 PM" is when the PIN
 *     was wrong a third time, not whenever the deferred work runs (Task 8's m-7).
 *   - The lockout module is imported INSIDE after(), never before the response: it reaches @bis/db through the email
 *     gate (SC-18; ../texml-no-static-db.test.ts), and its chunk is about 613 KB with the catalogue, which a cold
 *     load would otherwise spend on the carrier's clock.
 *   - after() itself throws synchronously outside a request scope; that throw is caught here, so it can never turn
 *     this caller's today's path into the last-resort bridge. The deferred work has its own catch, so nothing it
 *     does can reject unseen. Both log the error's class and the account only.
 */
function lockoutEmailsAfterResponse(
  p: { accountId: string; userId: string; lockedUntil: string; accountLanguage: "en" | "es" | null },
): void {
  const at = new Date();
  try {
    after(async () => {
      try {
        const { sendOwnerLineLockoutEmails } = await import("@/lib/owner-line/lockout");
        await sendOwnerLineLockoutEmails({ ...p, at });
      } catch (e) {
        console.error(`texml owner-pin: lockout emails failed (${errorClass(e)}), accountId ${p.accountId}`);
      }
    });
  } catch (e) {
    console.error(`texml owner-pin: lockout emails could not be scheduled (${errorClass(e)}), accountId ${p.accountId}`);
  }
}

async function decide(form: URLSearchParams, origin: string, authenticated: boolean): Promise<NextResponse> {
  const called = e164Of(form.get("To") || null);
  const caller = e164Of(form.get("From") || null);
  const today = () => answer(called, caller, origin, authenticated, { skipScreen: true, skipOwnerLine: true });
  try {
    if (!authenticated) {
      console.error("texml owner-pin: request not Telnyx-signed — today's path, nothing checked");
      return await today();
    }
    // Review m-3 (SC-14): with no usable VOICE_HANDOFF_SECRET no owner pass can be signed, so no PIN is checked and no
    // attempt is counted against anyone: today's path.
    if (!sipHandoffSecretConfigured()) {
      console.error("texml owner-pin: VOICE_HANDOFF_SECRET is not usable — today's path, nothing checked");
      return await today();
    }
    if (!called || !caller) {
      console.log("texml owner-pin: no called or caller number — today's path");
      return await today();
    }
    const {
      serviceDb, getPhoneNumberByE164, ownerLineAnswerLookup, attemptOwnerLineVerify, attemptOwnerLinePin,
      OWNER_LINE_MAX_CALLS_PER_DAY,
    } = await import("@bis/db");
    const db = serviceDb();
    const line = await getPhoneNumberByE164(db, called);
    if (!line || (line.status !== "testing" && line.status !== "live")) {
      console.log("texml owner-pin: the called number is not live — today's path");
      return await today();
    }
    const who = `accountId ${line.account_id}`;
    const look = await ownerLineAnswerLookup(db, line.account_id, caller, OWNER_LINE_MAX_CALLS_PER_DAY);
    if ((look.status !== "verify" && look.status !== "pin") || !OWNER_LINE_ROLES.includes(look.role)) {
      console.log(`texml owner-pin: not asked here (${look.status}) — today's path, ${who}`);
      return await today();
    }
    const locale = look.language ?? look.accountLanguage ?? "en";
    // The finish key ends the entry; Telnyx may or may not include it (owner-line-xml.ts header, (b)).
    const digits = (form.get("Digits") ?? "").trim().replace(/#+$/, "");

    if (look.status === "verify") {
      if (!SIX.test(digits)) {
        console.log(`texml owner-pin: no call-in code entered — today's path, ${who}`);
        return await today();
      }
      const r = await attemptOwnerLineVerify(db, line.account_id, caller, hashVerifyCode(digits));
      console.log(`texml owner-pin: call-in code ${r}, ${who}`);
      if (r === "verified") return xmlResponse(ownerVerifiedXml(locale));
      if (r === "wrong") return await ownerLineGatherAgain(called, caller, origin, { kind: "verify", locale, accountId: line.account_id, name: look.name });
      // spent (expired, or the third wrong code) and none: TODAY'S PATH, never a hang-up (plan I-3, spec §2.1).
      return await today();
    }

    if (digits === "") {
      console.log(`texml owner-pin: pound or no PIN — today's path, ${who}`);
      return await today();
    }
    // No pepper (O-3) is a deployment fault: today's path, and NO attempt is counted against the person.
    if (!pinPepperConfigured()) {
      console.error(`texml owner-pin: OWNER_LINE_PIN_PEPPER is not set — today's path, nothing checked, ${who}`);
      return await today();
    }
    // A short or malformed entry is still an attempt: it is a wrong PIN, counted like one.
    const candidate = (await candidateFor(digits, look.pinParams ?? "")) ?? "invalid";
    const r = await attemptOwnerLinePin(db, look.enrollmentId, candidate);
    console.log(`texml owner-pin: PIN ${r.status}, ${who}`);
    if (r.status === "ok") {
      // Review m-4: the pass only while today's path still reaches Sofía (the forward, billing's no-voice, the drill,
      // VOICE_FORWARD_TO, each re-read; ../route.ts ownerLineStillOffered). Otherwise today's path, with no pass.
      if (!(await ownerLineStillOffered(called, caller, line.account_id))) return await today();
      return ownerLineBridge(called, caller, origin, { accountId: line.account_id, userId: look.userId, role: look.role });
    }
    if (r.status === "wrong") return await ownerLineGatherAgain(called, caller, origin, { kind: "pin", locale, accountId: line.account_id, name: look.name });
    if (r.status === "locked_now") {
      lockoutEmailsAfterResponse({ accountId: line.account_id, userId: look.userId, lockedUntil: r.lockedUntil, accountLanguage: look.accountLanguage });
    }
    // locked_now, locked (another call locked it first) and none: today's path, as a customer.
    return await today();
  } catch (e) {
    // Review m-2 (orchestrator decision): FAIL CLOSED to today's path, which re-runs every customer check, so an
    // over-cap caller still hears the cap sentence and the screened_calls row is still written. Only if today's
    // path ALSO throws is it the last-resort bridge, never a 500.
    console.error(`texml owner-pin failed (${errorClass(e)}) — today's path for ${called ?? "unknown"}`);
    try {
      return await today();
    } catch (e2) {
      console.error(`texml owner-pin: today's path failed too (${errorClass(e2)}) — the last-resort bridge, for ${called ?? "unknown"}`);
      return bridgeAfterFailure(called, caller, origin, authenticated);
    }
  }
}

export async function GET(): Promise<NextResponse> {
  return new NextResponse(null, { status: 405 });
}

export async function POST(req: Request): Promise<NextResponse> {
  const read = await readTelnyxForm(req, "texml owner-pin", { logCaller: false });
  if (!read.ok) return read.response;
  // Field NAMES only (telnyx-request.ts): `Digits` appears as a name, and its value is never printed.
  logFormFields("texml owner-pin", read.form);
  return decide(read.form, actionOrigin(req), read.authenticated);
}
```

`logFormFields` prints field NAMES only (`telnyx-request.ts:60-79`): `Digits` appears as a name, and its value is never printed.

- [ ] **Step 4: Run green, then prove the route builds (SC-18).**

  ```bash
  pnpm --filter web exec vitest run src/app/api/voice/texml
  node -e "const s=require('fs').readFileSync('apps/web/src/app/api/voice/texml/owner-pin/route.ts','utf8');const bad=[...s.matchAll(/^import (?!type)[^;]*from \"([^\"]+)\"/gm)].map(m=>m[1]).filter(p=>/lockout|email|consent|@bis/db/.test(p));console.log(bad.length?'STATIC DB PATH: '+bad:'no static db path')"
  ```

  Expected: green, the `wellformed` documents unchanged, and `no static db path`. Paste both lines.

  **This task's verification requires `pnpm --filter web build`.** It is a gate, so the ORCHESTRATOR runs it, alone, after this task (repo rule 3), and pastes its last line. A module-scope `@bis/db` path from a TeXML route fails it during page-data collection (`route.ts:219-226`).

- [ ] **Step 5: Mutation probes.** Each must FAIL BY NAME:
  1. Delete the `!authenticated` early return → "an UNSIGNED request checks nothing" FAILS.
  2. Remove `if (digits === "")` → "Digits "" … does NOT count" FAILS.
  3. Return `xmlResponse("<Response><Hangup/></Response>")` on `locked_now` → "the third wrong PIN … continues as a customer's" FAILS.
  4. Answer `spent` with a goodbye and `<Hangup/>` → "a call-in code that is spent goes to today's path" FAILS.
  5. Move the lockout import to the top of `owner-pin/route.ts` → `texml-no-static-db.test.ts` FAILS naming the chain `app/api/voice/texml/owner-pin/route.ts -> lib/owner-line/lockout.ts -> lib/consent/email-gate.ts -> @bis/db`, and the orchestrator's build fails. (The unit tests mock the module, so they cannot see this; the scan is the probe. Step 4's one-off `node -e` check stays as a quick look; the test is the guard.)

- [ ] **Step 6: Commit.**

  ```bash
  git add apps/web/src/app/api/voice/texml/owner-pin
  git commit -m "feat(voice): owner-pin: the PIN and call-in code step, checked in SQL; three wrong PINs lock for 30 minutes and the call continues as a customer's"
  ```

---

## Task 10: The range resolver and the ONE reader factory (HIGH, 0.5 day)

**Covers T and F2.** If the owner picks **F1** at O-1, this task is re-planned before it starts: `ownerLineReadClient` would return a client that adds the Technician filter, plus its parity test against `app.my_contact_ids()`. The tools in Task 11 do not change under any option.

**Files:**
- Create: `apps/web/src/lib/owner-line/range.ts` and `range.test.ts`
- Create: `apps/web/src/lib/owner-line/token.ts` (used only under decision T)
- Create: `apps/web/src/lib/owner-line/reader.ts` and `reader.test.ts`
- Create: `apps/web/src/lib/owner-line/session.ts` (the session type and the live re-check; Task 12 adds `decideOwnerSession`)

**Interfaces:**
- Consumes: `dayKeyInZone(instant, timezone)` (`WEB/lib/booking/availability.ts:119`), `localMidnightInstant(dayKey, zone): Date` (`WEB/lib/reports/weekly-window.ts:100`), `userDb`, `serviceDb`, `ownerLineSessionCheck` (Task 2), and `OWNER_LINE_DATA_PATH` (Task 5).
- Produces:

```ts
// range.ts
export const MAX_RANGE_DAYS = 31;
export const RANGE_KINDS = ["today", "yesterday", "tomorrow", "this_week", "dates"] as const;
export type ResolvedRange = { ok: true; fromIso: string; toIso: string; firstDay: string; lastDay: string; multiDay: boolean }
  | { ok: false; error: "bad_range" | "range_too_long" };
export function resolveRange(input: { range?: unknown; from?: unknown; to?: unknown }, zone: string, now: Date): ResolvedRange;
// token.ts
export const OWNER_LINE_TOKEN_TTL_SECONDS = 120;
export function mintOwnerLineToken(p: { clerkUserId: string; clerkOrgId: string }, nowMs: number, env?: NodeJS.ProcessEnv): string;
// session.ts
export type OwnerLineSession = { accountId: string; userId: string; role: AccountRole; clerkUserId: string; clerkOrgId: string;
  firstName: string | null; actorName: string | null; locale: Locale; timezone: string };
export async function recheckOwnerSession(s: OwnerLineSession, _now: Date): Promise<boolean>;
// reader.ts — the ONLY function that branches on the Task 0 decision
export function ownerLineReadClient(s: Pick<OwnerLineSession, "role" | "clerkUserId" | "clerkOrgId">, now?: Date,
  deps?: { path: OwnerLineDataPath; userDb: typeof userDb; serviceDb: typeof serviceDb; mint: typeof mintOwnerLineToken }): SupabaseClient;
```

- [ ] **Step 1: Write the failing tests.**

```ts
// apps/web/src/lib/owner-line/range.test.ts
import { describe, it, expect } from "vitest";
import { resolveRange } from "./range";

const Z = "America/Chicago";
const NOW = new Date("2026-11-09T15:00:00.000Z");   // Monday 9:00 AM CST (DST ended 2026-11-01)

describe("resolveRange (spec §5: always in the account's zone, at most 31 days)", () => {
  it("today, yesterday and tomorrow are whole local days", () => {
    expect(resolveRange({ range: "today" }, Z, NOW)).toEqual({ ok: true, fromIso: "2026-11-09T06:00:00.000Z",
      toIso: "2026-11-10T06:00:00.000Z", firstDay: "2026-11-09", lastDay: "2026-11-09", multiDay: false });
    expect(resolveRange({ range: "yesterday" }, Z, NOW)).toMatchObject({ fromIso: "2026-11-08T06:00:00.000Z", toIso: "2026-11-09T06:00:00.000Z" });
    expect(resolveRange({ range: "tomorrow" }, Z, NOW)).toMatchObject({ fromIso: "2026-11-10T06:00:00.000Z", toIso: "2026-11-11T06:00:00.000Z" });
  });
  it("this week is Monday through Sunday of the account's own week", () => {
    expect(resolveRange({ range: "this_week" }, Z, NOW)).toMatchObject({ firstDay: "2026-11-09", lastDay: "2026-11-15",
      fromIso: "2026-11-09T06:00:00.000Z", toIso: "2026-11-16T06:00:00.000Z", multiDay: true });
  });
  it("fall-back: a named date on the day the clocks changed is 25 hours, from local midnight to local midnight", () => {
    expect(resolveRange({ range: "dates", from: "2026-11-01" }, Z, NOW)).toMatchObject({
      fromIso: "2026-11-01T05:00:00.000Z", toIso: "2026-11-02T06:00:00.000Z" });
  });
  it("spring-forward: 2026-03-08 is 23 hours in Chicago (owner ruling Q-F)", () => {
    expect(resolveRange({ range: "dates", from: "2026-03-08" }, Z, NOW)).toMatchObject({
      fromIso: "2026-03-08T06:00:00.000Z", toIso: "2026-03-09T05:00:00.000Z" });
  });
  it("'today' during the night of a clock change is the account's day, not UTC's (Q-F)", () => {
    // 2026-03-08 04:30Z is 22:30 CST on March 7 in Chicago, while UTC already reads March 8.
    expect(resolveRange({ range: "today" }, Z, new Date("2026-03-08T04:30:00.000Z"))).toMatchObject({ firstDay: "2026-03-07",
      fromIso: "2026-03-07T06:00:00.000Z", toIso: "2026-03-08T06:00:00.000Z" });
  });
  it("a zone whose clocks jump AT midnight: the day starts at the first instant that exists (America/Santiago, 2026-09-06; mutation: return localMidnightInstant unchanged -> 03:00Z, FAILS)", () => {
    // weekly-window.ts:95-98 documents that localMidnightInstant assumes no clock change at midnight. Measured with
    // Node 24.13 ICU on 2026-11-09: it answers 2026-09-06T03:00Z here, which is 23:00 on Sept 5 local; 03:59Z still
    // reads Sept 5 and 04:00Z reads Sept 6. localDayStart corrects it to 04:00Z.
    expect(resolveRange({ range: "dates", from: "2026-09-06" }, "America/Santiago", NOW)).toMatchObject({
      fromIso: "2026-09-06T04:00:00.000Z" });
  });
  it("31 days is allowed; 32 is refused (mutation: > MAX_RANGE_DAYS + 1 -> FAILS)", () => {
    expect(resolveRange({ range: "dates", from: "2026-10-01", to: "2026-10-31" }, Z, NOW).ok).toBe(true);
    expect(resolveRange({ range: "dates", from: "2026-10-01", to: "2026-11-01" }, Z, NOW)).toEqual({ ok: false, error: "range_too_long" });
  });
  it("refuses what is not a range: an unknown word, a backwards span, a date that does not exist", () => {
    expect(resolveRange({ range: "last_year" }, Z, NOW)).toEqual({ ok: false, error: "bad_range" });
    expect(resolveRange({ range: "dates", from: "2026-11-05", to: "2026-11-01" }, Z, NOW)).toEqual({ ok: false, error: "bad_range" });
    expect(resolveRange({ range: "dates", from: "2026-02-30" }, Z, NOW)).toEqual({ ok: false, error: "bad_range" });
  });
});
```

```ts
// apps/web/src/lib/owner-line/reader.test.ts
import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";
import { ownerLineReadClient } from "./reader";
import { mintOwnerLineToken, OWNER_LINE_TOKEN_TTL_SECONDS } from "./token";

const SECRET = "j".repeat(40);
const env = { SUPABASE_JWT_SECRET: SECRET } as NodeJS.ProcessEnv;
const T0 = 1_800_000_000_000;
const decode = (tok: string) => JSON.parse(Buffer.from(tok.split(".")[1]!, "base64url").toString());

describe("mintOwnerLineToken (decision T; the shape the Task 0 spike proved)", () => {
  it("carries exactly role, aud, sub, org_id, iat, exp, and NEVER app_role (mutation: add app_role -> FAILS)", () => {
    const tok = mintOwnerLineToken({ clerkUserId: "user_1", clerkOrgId: "org_1" }, T0, env);
    const claims = decode(tok);
    expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "iat", "org_id", "role", "sub"]);
    expect(claims).toMatchObject({ role: "authenticated", aud: "authenticated", sub: "user_1", org_id: "org_1" });
    expect(claims.exp - claims.iat).toBe(OWNER_LINE_TOKEN_TTL_SECONDS);
    const [h, b, s] = tok.split(".");
    expect(s).toBe(createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url"));
  });
  it("refuses to mint without a usable secret", () => {
    expect(() => mintOwnerLineToken({ clerkUserId: "u", clerkOrgId: "o" }, T0, {} as NodeJS.ProcessEnv)).toThrow(/SUPABASE_JWT_SECRET/);
  });
});

describe("ownerLineReadClient: the ONE place the data path is decided (plan SC-2)", () => {
  const S = { role: "technician" as const, clerkUserId: "user_t", clerkOrgId: "org_a" };
  it("token: the client reads AS the person (a minted token for their Clerk ids), never as the service role", () => {
    const userDb = vi.fn(() => "USER" as never);
    const serviceDb = vi.fn(() => "SERVICE" as never);
    const mint = vi.fn(() => "TOKEN");
    expect(ownerLineReadClient(S, new Date(T0), { path: "token", userDb, serviceDb, mint })).toBe("USER");
    expect(mint).toHaveBeenCalledWith({ clerkUserId: "user_t", clerkOrgId: "org_a" }, T0);
    expect(userDb).toHaveBeenCalledWith("TOKEN");
    expect(serviceDb).not.toHaveBeenCalled();
  });
  it("service (F2): Owner and Staff read through the service role; a Technician is refused, never given unscoped reads (mutation: drop the technician refusal -> FAILS)", () => {
    const deps = { path: "service" as const, userDb: vi.fn(), serviceDb: vi.fn(() => "SERVICE" as never), mint: vi.fn() };
    expect(ownerLineReadClient({ ...S, role: "staff" }, new Date(T0), deps)).toBe("SERVICE");
    expect(() => ownerLineReadClient(S, new Date(T0), deps)).toThrow(/Technician/);
  });
});
```

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  pnpm --filter web exec vitest run src/lib/owner-line/range.test.ts src/lib/owner-line/reader.test.ts
  ```

  Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement.**

```ts
// apps/web/src/lib/owner-line/range.ts
// The owner line's ranges (F-032 §5): today, yesterday, tomorrow, this week, or named dates, always as whole days in
// the ACCOUNT's zone (owner ruling Q-F), at most 31 days. Day boundaries start from the weekly report's
// localMidnightInstant, the conversion that has already been wrong once in this repo and is pinned there. Its own
// doc (weekly-window.ts:95-98) says it assumes no clock change AT midnight, so localDayStart corrects the answer for
// the zones where one happens: the first instant whose local date is the day. The same rule SQL uses
// (app.owner_line_day_start, 0115) for the 10-a-day limit.
import { dayKeyInZone } from "@/lib/booking/availability";
import { localMidnightInstant } from "@/lib/reports/weekly-window";

const STEP_MS = 15 * 60_000;
/** The first instant whose local date in `zone` is `day`. Bounded: no zone jumps more than 2 hours. */
export function localDayStart(day: string, zone: string): Date {
  let t = localMidnightInstant(day, zone).getTime();
  for (let i = 0; i < 8 && dayKeyInZone(new Date(t), zone) < day; i++) t += STEP_MS;
  for (let i = 0; i < 8 && dayKeyInZone(new Date(t - STEP_MS), zone) === day; i++) t -= STEP_MS;
  return new Date(t);
}

export const MAX_RANGE_DAYS = 31;
export const RANGE_KINDS = ["today", "yesterday", "tomorrow", "this_week", "dates"] as const;
export type ResolvedRange =
  | { ok: true; fromIso: string; toIso: string; firstDay: string; lastDay: string; multiDay: boolean }
  | { ok: false; error: "bad_range" | "range_too_long" };

const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
function shift(day: string, n: number): string {
  const [y, m, d] = parts(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const isDay = (v: unknown): v is string => typeof v === "string" && DAY.test(v) && shift(v, 0) === v;
const days = (a: string, b: string) => {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000) + 1;
};

export function resolveRange(input: { range?: unknown; from?: unknown; to?: unknown }, zone: string, now: Date): ResolvedRange {
  const today = dayKeyInZone(now, zone);
  let first: string;
  let last: string;
  switch (input.range) {
    case "today": first = last = today; break;
    case "yesterday": first = last = shift(today, -1); break;
    case "tomorrow": first = last = shift(today, 1); break;
    case "this_week": {
      const [y, m, d] = parts(today);
      const sinceMonday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
      first = shift(today, -sinceMonday);
      last = shift(first, 6);
      break;
    }
    case "dates": {
      if (!isDay(input.from) || (input.to !== undefined && !isDay(input.to))) return { ok: false, error: "bad_range" };
      first = input.from;
      last = (input.to as string | undefined) ?? input.from;
      if (last < first) return { ok: false, error: "bad_range" };
      if (days(first, last) > MAX_RANGE_DAYS) return { ok: false, error: "range_too_long" };
      break;
    }
    default: return { ok: false, error: "bad_range" };
  }
  return {
    ok: true, firstDay: first, lastDay: last, multiDay: first !== last,
    fromIso: localDayStart(first, zone).toISOString(),
    toIso: localDayStart(shift(last, 1), zone).toISOString(),
  };
}
```

```ts
// apps/web/src/lib/owner-line/token.ts
// Decision T (docs/superpowers/specs/2026-11-09-owner-line-spike.md): a short-lived token PostgREST accepts as the
// person, so RLS decides exactly as in the app (spec §5, preferred path). The claims RLS reads are sub (Clerk user),
// org_id (Clerk org) and role; app_role is NEVER minted, so this can never mint the agency. If the spike chose an
// imported asymmetric key instead of the legacy secret, this file is the one that changes (algorithm and env name);
// its test pins the claims, which do not.
import { createHmac } from "node:crypto";

export const OWNER_LINE_TOKEN_TTL_SECONDS = 120;

export function mintOwnerLineToken(
  p: { clerkUserId: string; clerkOrgId: string }, nowMs: number, env: NodeJS.ProcessEnv = process.env,
): string {
  const secret = env.SUPABASE_JWT_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("owner line: SUPABASE_JWT_SECRET is not set");
  const iat = Math.floor(nowMs / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role: "authenticated", aud: "authenticated", sub: p.clerkUserId, org_id: p.clerkOrgId,
    iat, exp: iat + OWNER_LINE_TOKEN_TTL_SECONDS });
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}
```

```ts
// apps/web/src/lib/owner-line/session.ts
import { serviceDb, ownerLineSessionCheck, type AccountRole } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";

/** Who an owner-line call is, as the SIP webhook verified it (Task 12's decideOwnerSession builds it). */
export type OwnerLineSession = {
  accountId: string; userId: string; role: AccountRole; clerkUserId: string; clerkOrgId: string;
  firstName: string | null; actorName: string | null; locale: Locale; timezone: string;
};

/**
 * F-032 §5 (plan SC-12): before EVERY tool call, the conditions that made the pass valid are read again: still a
 * member, the same role, the switch on, enrolled and not locked. No daily-limit check here: this call is already
 * counted. False on any refusal; a throw is the caller's to turn into "I couldn't read that".
 */
export async function recheckOwnerSession(s: OwnerLineSession, _now: Date): Promise<boolean> {
  const r = await ownerLineSessionCheck(serviceDb(), {
    accountId: s.accountId, userId: s.userId, role: s.role, maxCalls: null,
  });
  if (!r.ok) console.log(`[voice/owner-line] session no longer valid (${r.reason}), accountId ${s.accountId}`);
  return r.ok;
}
```

```ts
// apps/web/src/lib/owner-line/reader.ts
// THE ONE PLACE the Task 0 decision changes behaviour (plan SC-2). Every owner tool reads through the client this
// returns and calls the app's OWN readers with it (listCalls, listAgendaBookings, listAccountWork); no tool filters
// by role itself. "token": the client reads as the person, so RLS (0068) decides, Technicians included. "service"
// (F2): the service role scoped by account id, which equals what an Owner or Staff member sees; a Technician's scope
// lives only in RLS, so they are refused here AND never offered the line (OWNER_LINE_ROLES).
import { userDb, serviceDb, type SupabaseClient } from "@bis/db";
import { OWNER_LINE_DATA_PATH, type OwnerLineDataPath } from "./data-path";
import { mintOwnerLineToken } from "./token";
import type { OwnerLineSession } from "./session";

export function ownerLineReadClient(
  s: Pick<OwnerLineSession, "role" | "clerkUserId" | "clerkOrgId">, now: Date = new Date(),
  deps: { path: OwnerLineDataPath; userDb: typeof userDb; serviceDb: typeof serviceDb; mint: typeof mintOwnerLineToken } =
    { path: OWNER_LINE_DATA_PATH, userDb, serviceDb, mint: mintOwnerLineToken },
): SupabaseClient {
  if (deps.path === "token") return deps.userDb(deps.mint({ clerkUserId: s.clerkUserId, clerkOrgId: s.clerkOrgId }, now.getTime()));
  if (s.role === "technician") throw new Error("owner line: a Technician's reads need the token path (plan SC-2)");
  return deps.serviceDb();
}
```

- [ ] **Step 4: Run green.** Use the Step 2 command. Expected: all pass. Paste the summary line.

- [ ] **Step 5: Mutation probes.** Each must FAIL BY NAME:
  1. `> MAX_RANGE_DAYS + 1` → "31 days is allowed; 32 is refused" FAILS.
  2. Add `app_role: "agency_admin"` to the minted body → "NEVER app_role" FAILS.
  3. Delete the technician refusal → "a Technician is refused" FAILS.
  4. `localDayStart(first, "UTC")` → "fall-back: a named date on the day the clocks changed" and "spring-forward" FAIL.
  5. Delete the two loops in `localDayStart` → the America/Santiago case FAILS (03:00Z; measured with Node 24.13 ICU when this plan was fixed).

  **As built (2026-11-09, commits 9c7d855e and 1fcc0ea8).** All five probes fail by name. Two additions:
  - A fall-back-TO-midnight case (America/Havana, 2026-11-01, day start 04:00Z, the value 0115's SQL pins). In JavaScript the mirror image of SQL holds: `localMidnightInstant` already lands on Havana's FIRST midnight, so deleting only the step-back loop leaves every case green (it is a guard no case can reach), while deleting only the forward loop fails Santiago. The Havana case is a pinned value and claims no probe. PostgreSQL is the other way round (0115's `app.owner_line_day_start`: its step-back loop is the load-bearing one).
  - `reader.test.ts` casts its one-key env through `unknown`: Next types `NODE_ENV` as required on `ProcessEnv`, so the plan's direct cast was TS2352.

- [ ] **Step 6: Commit.**

  ```bash
  git add apps/web/src/lib/owner-line/range.ts apps/web/src/lib/owner-line/range.test.ts apps/web/src/lib/owner-line/token.ts apps/web/src/lib/owner-line/reader.ts apps/web/src/lib/owner-line/reader.test.ts apps/web/src/lib/owner-line/session.ts
  git commit -m "feat(voice): owner line ranges in the account's zone, and the one read-client factory the data-path decision lives in"
  ```

---

## Task 11: The three owner tools, schemas and registry (HIGH, 1.25 days)

**Files:**
- Create: `apps/web/src/lib/owner-line/tools/schemas.ts`, `read.ts`, `registry.ts`, with `registry.test.ts`
- Create: `apps/web/src/lib/owner-line/tools/read.live.test.ts`. It runs on the replica kit only: it is skipped without `BIS_REPLICA_JWT_SECRET`, and a skip is not a pass. It is modelled on `WEB/lib/ai-acts/actions.live.test.ts:1-60`.
- Create: `apps/web/src/lib/work/row-label.ts` and `row-label.test.ts`. This extracts the To do page's own row words, so the line and the page say the same thing.
- Modify: `ACCT/tasks/work-list.tsx:102-106`. `primaryLabel` becomes `workRowLabel`, imported. This is a one-line change in bis-frontend's file, done here because the owner line must say exactly what To do says. Report it to bis-frontend.
- Modify: `apps/web/src/lib/messages.ts` (the `ownerLine.tool.*` keys)

**Interfaces:**
- Consumes these app readers:
  - `listCalls(db, accountId, { limit, before })` (`DB/voice.ts:1248`)
  - `listCallReasons(db, accountId, ids): Map<string,string>` (`:675`)
  - `listAgendaBookings(db, accountId, fromIso, toIso): { rows, truncated }` (`DB/booking.ts:1195`)
  - `listAccountWork(db, accountId, opts?): WorkRow[]` (`DB/work-queue.ts:177`)
  - **the dashboard tile's own reads**: `listAnsweredCallStartsBetween` and `listSpamCallStartsBetween` (`WEB/lib/reports/weekly-metrics.ts:107,130`; the tile reads them at `ACCT/dashboard/page.tsx:158,204`)
  - its constants: `ANSWERED_CALL_OUTCOMES` (`DB/voice.ts:1088`, pinned equal to the report's `ANSWERED_OUTCOMES` by `texml/route.test.ts`) and `agencyHandsets()` (`WEB/lib/voice/caller-reputation.ts`, the tile's `excludeCallers` default)
- **After #343 (F-077) merges, re-read three things** and follow the file, recording any change in the report:
  - `listAccountWork`'s signature and `WorkSource`. #343 adds `failed_transfer` and `booking_act` (`git show feat/f077-work-queue:packages/db/src/work-queue.ts`, line 11).
  - `work-list.tsx`'s `primaryLabel`, which on that branch gains a `failed_transfer` branch and a `booking_act` branch that calls `describeAct(row.bookingAct!, { tr, zone })` (`:111-116`).
  - Extract THAT version, with its extra arguments, into `workRowLabel`.
- Consumes (Task 10): `resolveRange`, `ownerLineReadClient`, `recheckOwnerSession`, `OwnerLineSession`.
- Produces:

```ts
// schemas.ts
export const OWNER_TOOL_SCHEMAS: readonly [...];           // flat GA format, like voice/tools/schemas.ts
export type OwnerToolName = "calls_and_messages" | "appointments" | "needs_attention";
export const OWNER_TOOL_NAMES: readonly OwnerToolName[];
export const LOG_KIND_OF: Record<OwnerToolName, OwnerLineLogKind>;
// registry.ts
export type OwnerToolContext = { session: OwnerLineSession; now: () => Date;
  recheck: (s: OwnerLineSession, now: Date) => Promise<boolean>;
  client: (s: OwnerLineSession, now: Date) => SupabaseClient };
export async function runOwnerTool(ctx: OwnerToolContext, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
// lib/work/row-label.ts
export function workRowLabel(row: WorkRow, contactName: string, tr: Tr): string;   // (+ zone after #343)
```

**Owner ruling Q-E.** `calls_and_messages` counts the SAME calls as the dashboard's "Calls answered" tile:
- **The count** is `listAnsweredCallStartsBetween(...).length`, the tile's own read.
- **The spam number** is `listSpamCallStartsBetween(...).length`, the tile's "Sofía flagged N as likely spam". It is said separately.
- **The described calls** are the ones the tile counts: `ANSWERED_CALL_OUTCOMES`, not an agency handset, not an owner-line call. They are taken from `listCalls` with those same two constants, never a copy. A test pins that the list and the count agree.
- **Each described call carries its outcome in plain words**, in the person's language.

Every result is something a caller hears, so it is copy:
- **Counts are computed in code**, never by the model.
- **A failure is `{ ok: false, error: "couldnt_read" }`**, with nothing partial.
- **No field outside §5's "Returns" column:**
  - `calls_and_messages`: `when`, `caller`, `outcome`, `reason`, `needsCallback`;
  - `appointments`: `when`, `customer`, `meetingType`, `status`;
  - `needs_attention`: `what`, `customer`, `due`. Never a raw source code.

- [ ] **Step 1: Write the failing tests (unit, with mocked readers).**

```ts
// apps/web/src/lib/owner-line/tools/registry.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const r = vi.hoisted(() => ({ calls: vi.fn(), reasons: vi.fn(), agenda: vi.fn(), work: vi.fn(), answered: vi.fn(), spam: vi.fn(), names: vi.fn() }));
vi.mock("@bis/db", () => ({
  listCalls: r.calls, listCallReasons: r.reasons, listAgendaBookings: r.agenda, listAccountWork: r.work,
  ANSWERED_CALL_OUTCOMES: ["booked", "lead", "message", "transferred"],
}));
vi.mock("@/lib/reports/weekly-metrics", () => ({ listAnsweredCallStartsBetween: r.answered, listSpamCallStartsBetween: r.spam }));
vi.mock("@/lib/voice/caller-reputation", () => ({ agencyHandsets: () => ["+19565550999"] }));
import { runOwnerTool, type OwnerToolContext } from "./registry";
import { OWNER_TOOL_NAMES } from "./schemas";
import { toolSchemas } from "@/lib/voice/tools/schemas";

const A = "acct-A";
// The factory's client: a fake that answers the one direct read this module makes (contact names for To do rows).
const DB = { from: (table: string) => ({ select: () => ({ eq: () => ({ in: async (_c: string, ids: string[]) => {
  r.names(table, ids);
  return { data: [{ id: "k1", first_name: "Maria", last_name: "López" }].filter((k) => ids.includes(k.id)), error: null };
} }) }) }) } as never;
const SESSION = { accountId: A, userId: "u1", role: "staff" as const, clerkUserId: "c1", clerkOrgId: "o1",
  firstName: "Dan", actorName: "Dan Lopez", locale: "en" as const, timezone: "America/Chicago" };
const NOW = new Date("2026-11-09T21:00:00.000Z");   // 3:00 PM CST
const ctx = (over: Partial<OwnerToolContext> = {}): OwnerToolContext => ({
  session: SESSION, now: () => NOW, recheck: vi.fn(async () => true), client: vi.fn(() => DB), ...over });
const call = (id: string, startedAt: string, over = {}) => ({ id, started_at: startedAt, ended_at: null, duration_secs: 60,
  outcome: "lead", language: "en", caller_e164: "+19565550177", contact_id: "k1", conversation_id: null,
  owner_line_user_id: null, contact: { first_name: "Maria", last_name: "López" }, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  r.calls.mockResolvedValue([
    call("c4", "2026-11-09T20:30:00.000Z", { outcome: "spam", contact: null }),                    // flagged spam: counted apart
    call("c3", "2026-11-09T20:14:00.000Z"),                                                        // lead
    call("c2", "2026-11-09T19:00:00.000Z", { contact: null, outcome: "message" }),                 // a new caller
    call("c5", "2026-11-09T18:30:00.000Z", { caller_e164: "+19565550999", outcome: "booked" }),    // the agency's handset
    call("c1", "2026-11-09T18:00:00.000Z", { owner_line_user_id: "u1", outcome: "message" }),      // an owner-line call
    call("c0", "2026-11-08T12:00:00.000Z"),                                                        // yesterday
  ]);
  // The tile counts THREE today (one it counts is not among the rows listCalls returns here), so a count taken from
  // the described rows (2) can be told apart from the tile's (3).
  r.answered.mockResolvedValue(["2026-11-09T20:14:00.000Z", "2026-11-09T19:00:00.000Z", "2026-11-09T17:00:00.000Z"]);
  r.spam.mockResolvedValue(["2026-11-09T20:30:00.000Z"]);
  r.reasons.mockResolvedValue(new Map([["c3", "Roof leak over the kitchen"]]));
  r.work.mockResolvedValue([
    { id: "task:t1", source: "task", accountId: A, contactId: "k1", title: "Call back Maria", dueAt: null, occurredAt: "x", callId: "c3" },
    { id: "conversation:v1", source: "conversation", accountId: A, contactId: "k1", title: "", dueAt: null, occurredAt: "x" },
    { id: "booking:b1", source: "booking", accountId: A, contactId: "k1", title: "", dueAt: null, occurredAt: "x" },
  ]);
  r.agenda.mockResolvedValue({ truncated: false, rows: [
    { id: "b1", starts_at: "2026-11-10T15:00:00.000Z", status: "booked", meeting_type: "in_person", note: "gate code 1234", replaced: false,
      contact: { first_name: "Ana", last_name: null, phone: "+19565550188", email: "ana@example.com" }, place: { label: "Home", address: "1 Main" } },
    { id: "b0", starts_at: "2026-11-10T14:00:00.000Z", status: "cancelled", meeting_type: null, note: null, replaced: true, contact: null, place: null },
  ] });
});

describe("the owner tools (F-032 §5)", () => {
  it("THE WALL: only the three owner tools exist, and no receptionist tool is among them", () => {
    expect([...OWNER_TOOL_NAMES].sort()).toEqual(["appointments", "calls_and_messages", "needs_attention"]);
    const receptionist = toolSchemas("full", "in_person", true).map((t: { name: string }) => t.name);
    expect(OWNER_TOOL_NAMES.filter((n) => (receptionist as string[]).includes(n))).toEqual([]);
  });

  it("a session that is no longer valid gets an error and NO read at all (mutation: skip the recheck -> FAILS)", async () => {
    const c = ctx({ recheck: vi.fn(async () => false) });
    expect(await runOwnerTool(c, "calls_and_messages", { range: "today" })).toEqual({ ok: false, error: "couldnt_read" });
    expect(c.client).not.toHaveBeenCalled();
    expect(r.calls).not.toHaveBeenCalled();
  });

  it("reads through the factory's client and this session's account only, including the tile's own reads (mutation: serviceDb() in the tool -> FAILS)", async () => {
    await runOwnerTool(ctx(), "calls_and_messages", { range: "today" });
    expect(r.calls).toHaveBeenCalledWith(DB, A, expect.objectContaining({ before: "2026-11-10T06:00:00.000Z" }));
    expect(r.answered).toHaveBeenCalledWith(DB, A, "2026-11-09T06:00:00.000Z", "2026-11-10T06:00:00.000Z");
    expect(r.spam).toHaveBeenCalledWith(DB, A, "2026-11-09T06:00:00.000Z", "2026-11-10T06:00:00.000Z");
  });

  it("Q-E: the count is the 'Calls answered' tile's; spam is said apart; each described call has its outcome in words; owner-line, handset and spam calls are not described (mutation: count the described rows instead of the tile's read -> 2, FAILS)", async () => {
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" });
    expect(out).toEqual({ ok: true, range: { first: "2026-11-09", last: "2026-11-09" }, count: 3, spam: 1, more: 1, truncated: false, calls: [
      { when: "2:14 PM", caller: "Maria López", outcome: "left their details", reason: "Roof leak over the kitchen", needsCallback: true },
      { when: "1:00 PM", caller: "a new caller", outcome: "left a message", reason: null, needsCallback: false },
    ] });
  });

  it("the reasons are read for the spoken calls only, never more than 20 ids (mutation: pass every id -> FAILS)", async () => {
    r.calls.mockResolvedValue(Array.from({ length: 30 }, (_, i) => call(`x${i}`, new Date(Date.parse("2026-11-09T20:00:00.000Z") - i * 60_000).toISOString())));
    r.answered.mockResolvedValue(Array.from({ length: 30 }, () => "t"));
    const out = await runOwnerTool(ctx(), "calls_and_messages", { range: "today" }) as { more: number };
    expect((r.reasons.mock.calls[0]![2] as string[]).length).toBe(20);
    expect(out.more).toBe(10);
  });

  it("appointments: never the note, the phone, the email or the address; a moved booking's cancelled half is not read out", async () => {
    const out = await runOwnerTool(ctx(), "appointments", { range: "tomorrow" }) as { appointments: object[]; count: number };
    expect(out.count).toBe(1);
    expect(out.appointments).toEqual([{ when: "9:00 AM", customer: "Ana", meetingType: "in_person", status: "booked" }]);
    expect(JSON.stringify(out)).not.toMatch(/gate code|ana@example|5550188|Main/);
  });

  it("needs_attention: the To do page's own words for each source, with the customer's name, never a raw source code (mutation: what = w.title -> two empty items, FAILS)", async () => {
    expect(await runOwnerTool(ctx(), "needs_attention", {})).toEqual({ ok: true, count: 3, more: 0, items: [
      { what: "Call back Maria", customer: "Maria López", due: null },
      { what: "Reply to Maria López", customer: "Maria López", due: null },
      { what: "Did this job happen?", customer: "Maria López", due: null },
    ] });
    expect(r.work).toHaveBeenCalledWith(DB, A);
    expect(r.names).toHaveBeenCalledWith("contacts", ["k1"]);
  });

  it("a range of 32 days is refused before any read", async () => {
    expect(await runOwnerTool(ctx(), "appointments", { range: "dates", from: "2026-10-01", to: "2026-11-01" }))
      .toEqual({ ok: false, error: "range_too_long" });
    expect(r.agenda).not.toHaveBeenCalled();
  });

  it("a reader that throws is 'couldnt_read', never a partial answer", async () => {
    r.agenda.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await runOwnerTool(ctx(), "appointments", { range: "today" })).toEqual({ ok: false, error: "couldnt_read" });
  });

  it("an unknown tool name, or a receptionist tool name, is refused without a read", async () => {
    expect(await runOwnerTool(ctx(), "book_appointment", {})).toEqual({ ok: false, error: "unknown_tool" });
    expect(r.calls).not.toHaveBeenCalled();
  });
});
```

Read `toolSchemas`' real signature (`WEB/lib/voice/tools/schemas.ts`, below `:80`) and call it with the arguments it takes (`bookingMode`, `meetingType`, `handoffAvailable`). Use its widest setting so every receptionist tool is listed. After #343, add one `needs_attention` case per new source (`failed_transfer`, `booking_act`), each expecting the words `workRowLabel` returns for it, and one case to `row-label.test.ts` per source.

```ts
// apps/web/src/lib/work/row-label.test.ts
import { describe, it, expect } from "vitest";
import { workRowLabel } from "./row-label";
import { makeTr } from "@/lib/record/copy";
import { m } from "@/lib/messages";

const row = (source: "task" | "conversation" | "booking", title = "") =>
  ({ id: `${source}:1`, source, accountId: "a", contactId: "k", title, dueAt: null, occurredAt: "x" }) as never;
describe("workRowLabel: the To do page's primary words, shared with the owner line", () => {
  it.each([["task", "Call back Maria", "Call back Maria"], ["conversation", "", "Reply to Maria"], ["booking", "", m["work.booking"]]] as const)(
    "%s reads %j", (source, title, words) => {
      expect(workRowLabel(row(source, title), "Maria", makeTr("en"))).toBe(words);
    });
  it("Spanish reads the Spanish twins", () => {
    expect(workRowLabel(row("booking"), "Maria", makeTr("es"))).toBe(m["work.booking.es"]);
  });
});
```

- [ ] **Step 2: Write the live scope test (replica kit; spec §7 "Scope", for EACH tool).** Two businesses each hold the SAME customer name and phone. A has an Owner, a Staff member and a Technician. In A, one customer is assigned to the Technician and one is unassigned; B has one. Each of those three customers gets one answered call today, one booking tomorrow, and one open task. Every tool runs through the real factory and the real readers.

```ts
// apps/web/src/lib/owner-line/tools/read.live.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { refuseProduction } from "../../../../e2e/fixtures/production-guard";
import { runOwnerTool } from "./registry";
import { ownerLineReadClient } from "../reader";
import { OWNER_LINE_DATA_PATH } from "../data-path";

// BIS_REPLICA_JWT_SECRET doubles as SUPABASE_JWT_SECRET on the replica kit's PostgREST. Without it this file is
// SKIPPED, and a skip is not a pass: the PR description states the replica run.
loadEnv({ path: ".env.local" });
refuseProduction(process.env, "lib/owner-line/tools/read.live.test.ts");
const SECRET = process.env.BIS_REPLICA_JWT_SECRET;
const RUN = randomUUID().slice(0, 8);
type Seed = { a: string; b: string; aOrg: string; bOrg: string; owner: string; staff: string; tech: string; bOwner: string };
let seed: Seed;
const TOMORROW = new Date(Date.now() + 26 * 3600_000);

describe.skipIf(!SECRET)("owner tools see exactly what the role sees, on the dialed business only (spec §7), for EVERY tool", () => {
  beforeAll(async () => {
    process.env.SUPABASE_JWT_SECRET = SECRET;
    const db = serviceDb();
    const { getOrCreateCalendar } = await import("@bis/db");
    const { data: ag } = await db.from("agencies").select("id").limit(1).single();
    const acct = async (tag: string) => (await db.from("accounts").insert({ agency_id: ag!.id, clerk_org_id: `org_olt_${tag}_${RUN}`,
      name: `OLT ${tag}`, client_access_enabled: true }).select("id").single()).data!.id as string;
    const a = await acct("a");
    const b = await acct("b");
    const person = async (tag: string, account: string, role: string) => {
      const { data: u } = await db.from("users").insert({ clerk_user_id: `user_olt_${tag}_${RUN}`, email: `${tag}_${RUN}@example.com` }).select("id").single();
      await db.from("memberships").insert({ user_id: u!.id, scope: "account", account_id: account, role });
      return u!.id as string;
    };
    const owner = await person("owner", a, "owner");
    const staff = await person("staff", a, "staff");
    const tech = await person("tech", a, "technician");
    const bOwner = await person("bowner", b, "owner");
    const phone = async (account: string, n: string) => (await db.from("phone_numbers").insert({ account_id: account, e164: `+1956557${n}`, status: "live" }).select("id").single()).data!.id as string;
    const digits = String(Date.now()).slice(-3);
    const pn = { [a]: await phone(a, `${digits}1`), [b]: await phone(b, `${digits}2`) };
    const cal = { [a]: (await getOrCreateCalendar(db, a, "voice", "ai")).id, [b]: (await getOrCreateCalendar(db, b, "voice", "ai")).id };
    const customer = async (account: string, assigned: string | null) => {
      const k = (await db.from("contacts").insert({ account_id: account, first_name: "Maria", last_name: "López",
        phone: "+19565550177", assigned_to: assigned }).select("id").single()).data!.id as string;
      await db.from("calls").insert({ account_id: account, phone_number_id: pn[account], contact_id: k, caller_e164: "+19565550177",
        outcome: "lead", started_at: new Date().toISOString() });
      await db.from("bookings").insert({ account_id: account, contact_id: k, calendar_id: cal[account], status: "booked",
        starts_at: TOMORROW.toISOString(), ends_at: new Date(TOMORROW.getTime() + 3600_000).toISOString() });
      await db.from("tasks").insert({ account_id: account, contact_id: k, title: `Call back Maria ${assigned ? "T" : "U"}` });
    };
    await customer(a, tech);
    await customer(a, null);
    await customer(b, null);
    seed = { a, b, aOrg: `org_olt_a_${RUN}`, bOrg: `org_olt_b_${RUN}`, owner, staff, tech, bOwner };
  });

  afterAll(async () => {
    const { deleteAccountCascade } = await import("@bis/db");
    for (const id of [seed?.a, seed?.b].filter(Boolean)) await deleteAccountCascade(serviceDb(), id!, "owner-line live test");
  });

  const run = (tool: string, args: Record<string, unknown>, userId: string, role: "owner" | "staff" | "technician", tag: string,
    account = seed.a, org = seed.aOrg) => runOwnerTool({
    session: { accountId: account, userId, role, clerkUserId: `user_olt_${tag}_${RUN}`, clerkOrgId: org,
      firstName: null, actorName: null, locale: "en", timezone: "America/Chicago" },
    now: () => new Date(), recheck: async () => true, client: (s, n) => ownerLineReadClient(s, n),
  }, tool, args) as Promise<{ ok: boolean; count?: number }>;
  const TOOLS = [["calls_and_messages", { range: "today" }], ["appointments", { range: "this_week" }], ["needs_attention", {}]] as const;

  it.each(TOOLS)("Owner, %s: A's two, nothing of B's same-named customer", async (tool, args) => {
    expect(await run(tool, args, seed.owner, "owner", "owner")).toMatchObject({ ok: true, count: 2 });
  });
  it.each(TOOLS)("Staff, %s: what Staff see, A's two", async (tool, args) => {
    expect(await run(tool, args, seed.staff, "staff", "staff")).toMatchObject({ ok: true, count: 2 });
  });
  it.each(TOOLS)("B's Owner, %s: B's one, nothing of A's (a second account)", async (tool, args) => {
    expect(await run(tool, args, seed.bOwner, "owner", "bowner", seed.b, seed.bOrg)).toMatchObject({ ok: true, count: 1 });
  });
  it.skipIf(OWNER_LINE_DATA_PATH !== "token").each(TOOLS)("Technician, %s: only the assigned customer's, never the unassigned one", async (tool, args) => {
    expect(await run(tool, args, seed.tech, "technician", "tech")).toMatchObject({ ok: true, count: 1 });
  });
  it.skipIf(OWNER_LINE_DATA_PATH !== "token").each(TOOLS)("A's identity naming business B, %s: RLS refuses it, count 0 (the tool cannot widen a token)", async (tool, args) => {
    expect(await run(tool, args, seed.owner, "owner", "owner", seed.b)).toMatchObject({ ok: true, count: 0 });
  });
});
```

The `appointments` cases use `this_week` because tomorrow may fall in next week on a Sunday run. If the run is on a Sunday, use `{ range: "dates", from: <tomorrow's day key in Chicago> }` instead, computed with `dayKeyInZone`.

**Under F2,** the two Technician and cross-identity groups are skipped by design. The second-account case is then carried by the "B's Owner" group, which runs under both paths.

**Seed through the same writes the existing live tests use.** Read `WEB/lib/ai-acts/actions.live.test.ts`'s seeding first, and match it if the replica's record-history guard (0111, and 0113's enforcement once merged) refuses a bare `serviceDb()` insert without an author. `bookings` and `tasks` may need author columns there.

- [ ] **Step 3: Run the unit tests and see them fail.**

  ```bash
  pnpm --filter web exec vitest run src/lib/owner-line/tools/registry.test.ts src/lib/work/row-label.test.ts
  ```

  Expected: FAIL, unresolved `./registry` and `./row-label`.

- [ ] **Step 4: Implement.**

```ts
// apps/web/src/lib/work/row-label.ts
// The To do page's primary words for one row (moved out of ACCT/tasks/work-list.tsx's primaryLabel, unchanged), so
// the owner line's needs_attention says exactly what the page says. A task's own title is the user's words; a derived
// row's sentence comes from the catalogue, in the reader's language. After #343 this file carries that branch's
// failed_transfer and booking_act sentences too (Task 11 interfaces).
import type { WorkRow } from "@bis/db";
import type { Tr } from "@/lib/record/copy";

export function workRowLabel(row: WorkRow, contactName: string, tr: Tr): string {
  if (row.source === "task") return row.title;
  if (row.source === "conversation") return tr.text("work.conversation", { name: contactName });
  return tr.text("work.booking");
}
```

  In `work-list.tsx`, delete `primaryLabel`'s body and import `workRowLabel` in its place (same arguments). Read the file's `Tr` import first. `makeTr`'s return type is exported from `@/lib/record/copy`; if it is named differently there, use that name.

```ts
// apps/web/src/lib/owner-line/tools/schemas.ts
// Flat GA Realtime tool format (lib/voice/tools/schemas.ts:1-3). The owner line's tools are a SEPARATE list: the
// receptionist's are never registered on an owner-line session (spec §4.4), and none of these on a customer's.
import type { OwnerLineLogKind } from "@bis/db";

const RANGE = {
  range: { type: "string", enum: ["today", "yesterday", "tomorrow", "this_week", "dates"],
    description: "Which days, in the business's timezone. Use dates with from (and to) for a named day or days." },
  from: { type: "string", description: "YYYY-MM-DD. Only with range dates." },
  to: { type: "string", description: "YYYY-MM-DD, the last day, at most 31 days after from. Only with range dates." },
} as const;

export const OWNER_TOOL_SCHEMAS = [
  { type: "function", name: "calls_and_messages",
    description: "The calls Sofía answered in a range, the same calls the dashboard counts as 'Calls answered', newest first. count is exact; spam is how many calls looked like spam, said separately and only when above zero. Each call has when, caller (a name, or 'a new caller'), outcome (what came of it, in words), reason (or null) and needsCallback. more says how many were not listed; truncated means the list stopped early. Say counts from here; never count yourself.",
    parameters: { type: "object", properties: RANGE, required: ["range"] } },
  { type: "function", name: "appointments",
    description: "The appointments in a range, soonest first: count is exact, and each has when, customer (or null), meetingType and status. Say the count from here.",
    parameters: { type: "object", properties: RANGE, required: ["range"] } },
  { type: "function", name: "needs_attention",
    description: "What is on this person's To do right now, in the same words the To do page uses: count is exact, and each item has what, customer (or null) and due (or null).",
    parameters: { type: "object", properties: {}, required: [] } },
] as const;

export type OwnerToolName = (typeof OWNER_TOOL_SCHEMAS)[number]["name"];
export const OWNER_TOOL_NAMES: readonly OwnerToolName[] = OWNER_TOOL_SCHEMAS.map((s) => s.name);
export const LOG_KIND_OF: Record<OwnerToolName, OwnerLineLogKind> = {
  calls_and_messages: "owner_line_calls_and_messages",
  appointments: "owner_line_appointments",
  needs_attention: "owner_line_needs_attention",
};
```

```ts
// apps/web/src/lib/owner-line/tools/read.ts
// The three reads (spec §5), each through the APP's own readers with the client the factory made, so the role filter
// is RLS's (token) or the account scope (F2), never re-implemented here (plan SC-2). Counts are computed here.
// calls_and_messages counts what the dashboard's "Calls answered" tile counts, with the tile's own reads (Q-E).
import {
  listCalls, listCallReasons, listAgendaBookings, listAccountWork, ANSWERED_CALL_OUTCOMES,
  type SupabaseClient, type CallListRow,
} from "@bis/db";
import { listAnsweredCallStartsBetween, listSpamCallStartsBetween } from "@/lib/reports/weekly-metrics";
import { agencyHandsets } from "@/lib/voice/caller-reputation";
import { workRowLabel } from "@/lib/work/row-label";
import { makeTr } from "@/lib/record/copy";
import { resolveRange } from "../range";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import type { Locale } from "@/lib/i18n/locale";

export type OwnerReadContext = { db: SupabaseClient; accountId: string; timezone: string; locale: Locale; now: Date };
export const CALLS_SPOKEN = 20;
export const APPOINTMENTS_SPOKEN = 25;
export const TODO_SPOKEN = 15;
const CALL_PAGE = 100;
const CALL_PAGES = 10;

function when(iso: string, c: OwnerReadContext, withDay: boolean): string {
  return new Intl.DateTimeFormat(c.locale === "es" ? "es-US" : "en-US", {
    timeZone: c.timezone, hour: "numeric", minute: "2-digit",
    ...(withDay ? { weekday: "long", month: "long", day: "numeric" } : {}),
  }).format(new Date(iso)).replace(/\u202f/g, " ");
}
const nameOf = (k: { first_name: string | null; last_name: string | null } | null) =>
  [k?.first_name, k?.last_name].filter((x): x is string => !!x && x.trim() !== "").join(" ") || null;

const OUTCOME_WORDS: Record<string, keyof typeof m> = {
  booked: "ownerLine.tool.outcome.booked", lead: "ownerLine.tool.outcome.lead",
  message: "ownerLine.tool.outcome.message", transferred: "ownerLine.tool.outcome.transferred",
};

/** The calls the "Calls answered" tile counts, decided by the tile's own two constants, never a copy of them. */
function tileCall(x: CallListRow, handsets: readonly string[]): boolean {
  return x.owner_line_user_id === null && (ANSWERED_CALL_OUTCOMES as readonly string[]).includes(x.outcome)
    && !(x.caller_e164 !== null && handsets.includes(x.caller_e164));
}

export async function callsAndMessages(c: OwnerReadContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = resolveRange(args, c.timezone, c.now);
  if (!r.ok) return { ok: false, error: r.error };
  const [answered, spam] = await Promise.all([
    listAnsweredCallStartsBetween(c.db, c.accountId, r.fromIso, r.toIso),
    listSpamCallStartsBetween(c.db, c.accountId, r.fromIso, r.toIso),
  ]);
  const handsets = agencyHandsets();
  const rows: CallListRow[] = [];
  let before = r.toIso;
  let truncated = true;
  for (let page = 0; page < CALL_PAGES; page++) {
    const batch = await listCalls(c.db, c.accountId, { limit: CALL_PAGE, before });
    rows.push(...batch.filter((x) => x.started_at >= r.fromIso && tileCall(x, handsets)));
    const last = batch[batch.length - 1];
    if (batch.length < CALL_PAGE || !last || last.started_at < r.fromIso) { truncated = false; break; }
    before = last.started_at;
  }
  const spoken = rows.slice(0, CALLS_SPOKEN);
  const [reasons, work] = await Promise.all([
    listCallReasons(c.db, c.accountId, spoken.map((x) => x.id)), listAccountWork(c.db, c.accountId),
  ]);
  const open = new Set(work.map((w) => w.callId).filter((x): x is string => typeof x === "string"));
  return {
    ok: true, range: { first: r.firstDay, last: r.lastDay },
    count: answered.length, spam: spam.length,
    more: Math.max(0, answered.length - spoken.length), truncated,
    calls: spoken.map((x) => ({
      when: when(x.started_at, c, r.multiDay),
      caller: nameOf(x.contact) ?? t(m, "ownerLine.tool.newCaller", c.locale),
      outcome: t(m, OUTCOME_WORDS[x.outcome]!, c.locale),
      reason: reasons.get(x.id) ?? null,
      needsCallback: open.has(x.id),
    })),
  };
}

export async function appointments(c: OwnerReadContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = resolveRange(args, c.timezone, c.now);
  if (!r.ok) return { ok: false, error: r.error };
  const { rows, truncated } = await listAgendaBookings(c.db, c.accountId, r.fromIso, r.toIso);
  const shown = rows.filter((x) => !(x.status === "cancelled" && x.replaced));
  return {
    ok: true, range: { first: r.firstDay, last: r.lastDay }, count: shown.length, truncated,
    more: Math.max(0, shown.length - APPOINTMENTS_SPOKEN),
    appointments: shown.slice(0, APPOINTMENTS_SPOKEN).map((x) => ({
      when: when(x.starts_at, c, r.multiDay), customer: nameOf(x.contact), meetingType: x.meeting_type, status: x.status,
    })),
  };
}

export async function needsAttention(c: OwnerReadContext): Promise<Record<string, unknown>> {
  const rows = await listAccountWork(c.db, c.accountId);
  const shown = rows.slice(0, TODO_SPOKEN);
  // Names through the SAME client (so RLS, or the account scope, bounds them too): tasks/page.tsx:183-195's shape.
  const ids = [...new Set(shown.map((w) => w.contactId).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const { data, error } = await c.db.from("contacts").select("id, first_name, last_name").eq("account_id", c.accountId).in("id", ids);
    if (error) throw new Error(`needs_attention names failed: ${error.message}`);
    for (const k of (data ?? []) as { id: string; first_name: string | null; last_name: string | null }[]) {
      const n = nameOf(k);
      if (n) names.set(k.id, n);
    }
  }
  const tr = makeTr(c.locale);
  return {
    ok: true, count: rows.length, more: Math.max(0, rows.length - TODO_SPOKEN),
    items: shown.map((w) => {
      const customer = w.contactId ? names.get(w.contactId) ?? null : null;
      return {
        what: workRowLabel(w, customer ?? t(m, "ownerLine.tool.aCustomer", c.locale), tr),
        customer, due: w.dueAt ? when(w.dueAt, c, true) : null,
      };
    }),
  };
}
```

`count` is the tile's count. `more` is what the tile counted beyond the calls spoken. A difference between `answered.length` and the described rows (`truncated`, or a row the tile counts that `listCalls` cannot see) is never invented: the count stays the tile's.

`appointments` keeps `truncated` in its payload, because it tells the model the agenda's 400-row cap (`AGENDA_ROW_CAP`) cut rows. That is why its unit test asserts `out.appointments` and `out.count`.

```ts
// apps/web/src/lib/owner-line/tools/registry.ts
import type { SupabaseClient } from "@bis/db";
import { OWNER_TOOL_NAMES, type OwnerToolName } from "./schemas";
import { callsAndMessages, appointments, needsAttention } from "./read";
import type { OwnerLineSession } from "../session";

export type OwnerToolContext = {
  session: OwnerLineSession; now: () => Date;
  recheck: (s: OwnerLineSession, now: Date) => Promise<boolean>;
  client: (s: OwnerLineSession, now: Date) => SupabaseClient;
};

/**
 * Runs one owner tool (F-032 §5). In order:
 *   1. an unknown name — a receptionist tool included — is refused without a read;
 *   2. the session is re-checked live (SC-12), and a refusal or a throw is "couldnt_read" with no read at all;
 *   3. the read runs through the factory's client;
 *   4. anything that throws is "couldnt_read", never partial data.
 * The prompt turns "couldnt_read" into "I couldn't read that just now" — but nothing here depends on it: the model
 * simply has no data to speak.
 */
export async function runOwnerTool(ctx: OwnerToolContext, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (!(OWNER_TOOL_NAMES as readonly string[]).includes(name)) return { ok: false, error: "unknown_tool" };
  const now = ctx.now();
  let live = false;
  try {
    live = await ctx.recheck(ctx.session, now);
  } catch (e) {
    console.error(`[voice/owner-line] session re-check failed — refusing ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!live) return { ok: false, error: "couldnt_read" };
  try {
    const c = { db: ctx.client(ctx.session, now), accountId: ctx.session.accountId, timezone: ctx.session.timezone,
      locale: ctx.session.locale, now };
    switch (name as OwnerToolName) {
      case "calls_and_messages": return await callsAndMessages(c, args);
      case "appointments": return await appointments(c, args);
      case "needs_attention": return await needsAttention(c);
    }
  } catch (e) {
    console.error(`[voice/owner-line] tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, error: "couldnt_read" };
  }
  return { ok: false, error: "unknown_tool" };
}
```

Copy:

```ts
  "ownerLine.tool.newCaller": "a new caller",
  "ownerLine.tool.newCaller.es": "una persona nueva",
  "ownerLine.tool.aCustomer": "a customer",
  "ownerLine.tool.aCustomer.es": "un cliente",
  "ownerLine.tool.outcome.booked": "booked an appointment",
  "ownerLine.tool.outcome.booked.es": "agendó una cita",
  "ownerLine.tool.outcome.lead": "left their details",
  "ownerLine.tool.outcome.lead.es": "dejó sus datos",
  "ownerLine.tool.outcome.message": "left a message",
  "ownerLine.tool.outcome.message.es": "dejó un mensaje",
  "ownerLine.tool.outcome.transferred": "was put through to a person",
  "ownerLine.tool.outcome.transferred.es": "se le comunicó con una persona",
```

- [ ] **Step 5: Run green.**

  ```bash
  pnpm --filter web exec vitest run src/lib/owner-line src/lib/work "src/app/(dashboard)/dashboard/accounts/[accountId]/tasks" src/lib/i18n src/lib/messages.test.ts
  ```

  Expected: green, with `read.live.test.ts` SKIPPED here and the To do page's own tests unchanged. Then run the live file on the replica kit:

  ```bash
  BIS_REPLICA_JWT_SECRET=<kit secret> <kit>/env-run.sh pnpm --filter web exec vitest run src/lib/owner-line/tools/read.live.test.ts
  ```

  Expected: 15 passed under T (9 passed and 6 skipped under F2). Paste both summary lines.

- [ ] **Step 6: Mutation probes.** Each must FAIL BY NAME:
  1. In `runOwnerTool`, set `live = true` without calling `recheck` → "a session that is no longer valid gets an error and NO read" FAILS.
  2. In `read.ts`, pass `serviceDb()` instead of `c.db` to `listCalls`, `listAgendaBookings` and `listAccountWork` → "reads through the factory's client" FAILS. In the live file, every Technician case also FAILS (it hears 2).
  3. Set `count: rows.length` instead of the tile's `answered.length` → "Q-E: the count is the 'Calls answered' tile's" FAILS (its fixture's tile read holds 3 and the described rows 2).
  4. Drop `tileCall`'s owner-line clause → the Q-E case FAILS (it describes the owner-line call).
  5. Pass every row's id to `listCallReasons` → "the reasons are read for the spoken calls only" FAILS.
  6. Spread the whole booking row into the appointment item → "appointments: never the note…" FAILS.
  7. Set `what: w.title` → the `needs_attention` case FAILS.

  **As built (2026-11-09, commit f3b191dc).** All seven fail by name, plus:
  - **One `needs_attention` case per To do source** (task, conversation, booking), each alone, so a wrong sentence for one source fails by its name (probe 7 fails the conversation and booking cases; the task case stays green under `what: w.title` because a task's words ARE its title).
  - **`truncated`:** a case where every listing page is full of the tile's calls: `listCalls` is read 10 times, `truncated` is true, and `count` is still the tile's (probe: never set truncated → FAILS). **Superseded by review m-2 (below): `calls_and_messages` no longer returns `truncated`.**
  - **No ids, phone digits, note, email or address in ANY tool's output, with ONE sanctioned exception:** the callback number inside a callback To do's own words in `needs_attention`'s `what`, read exactly as the To do row shows it (owner ruling 2026-11-09, extended, in the rulings section). Today that is Sofía's callback To do (`callbackTaskTitle`, "Call back at {number}: {reason}"); after #343, a failed transfer's (`work.failedTransfer`, `{number}`). Nothing else may carry a number: the scan replaces exactly that `what` and then forbids every fixture id, every phone digit string, any run of 5 or more digits and any `+` followed by a digit across all three outputs, so the same number as a call's caller ID in `calls_and_messages` still fails (probes: add `id`, or the caller's number, to a spoken call → FAILS).
  - **`workRowLabel` is an exhaustive switch.** A source with no branch is a `never` and stops the typecheck (probes: the conversation or booking branch returning the title → their row-label and needs_attention cases FAIL).
  - **The live scope test (I-11) uses the REAL live re-check**, not the plan's stub, so it seeds what `owner_line_session_check` needs: a verified enrollment with a PIN for every person, the switch on (`setOwnerLineSwitch`), client access on. Seeding goes through `createAccount`, `createContact`, `createBooking` and `ensureCallbackTask` (the writers `ai-acts/actions.live.test.ts` uses), with ONE live number per account (`phone_numbers_one_active_per_account`) and A's two bookings two hours apart (the slot guard). The range is today through tomorrow as named dates, never `this_week`. Five groups, each for all three tools:
    - A's Owner: A's two, and nothing of B's text;
    - A's Staff: A's two, and nothing of B's text;
    - B's Owner: B's one;
    - A's Owner naming business B: `couldnt_read`, refused by the live re-check (not a member) under BOTH data paths;
    - A's Technician: `couldnt_read` under F2 (the factory refuses before any read); under T, the assigned customer's one.

    Result on the replica kit (PG18 + PostgREST 14.14, the f032-db stack): `Tests  15 passed | 3 skipped (18)`; the three skips are the T-only Technician group. Live probes: skip the re-check → the three "naming business B" cases FAIL (B's data comes back); drop the Technician refusal → the three F2 Technician cases FAIL.
  - **Copy:** "booked" in Spanish is "agendó una cita". The plan's "reservó una cita" broke the glossary gate (`lib/i18n/spanish-style.ts:65`: book is "agendar, cita", never "reserv").
  - **After #343 (F-077) merges, re-read and decide:**
    - `WorkSource` gains `failed_transfer` and `booking_act`. `workRowLabel`'s `never` stops the typecheck until both have branches. Move THAT branch's `primaryLabel` (with `zone`, for `describeAct`) into `workRowLabel`, and add one `needs_attention` case and one row-label case per source.
    - **Decided (owner ruling 2026-11-09, extended):** the owner line reads a callback number aloud as the To do row shows it. For a failed transfer that is `work.failedTransfer` with `{number}`, never `work.failedTransfer.bare` when the row has a number. Add the `failed_transfer` case with a number to the scan's sanctioned exception, exactly as the callback To do's is.
  **Review fix round (2026-11-09, Tasks 10/11 review).** No tenancy hole was found in the code. The gaps were in the tests, and these are the changes:
  - **I-1:** the live calls case could not see the listing read another business: the count is the tile's read, a different query. Now every listed call must be one the count counts (`calls.length === count`), and B's call carries an outcome none of A's does ("left a message"), which A must never hear. Probe N1 (drop `listCalls`' account filter, service path): the three `calls_and_messages` cases FAIL by name (A's Owner, A's Staff, B's Owner; 3 listed against 2 and 1).
  - **I-2:** a unit case where `recheck` REJECTS: `couldnt_read` for every tool, the client and every reader never called. Probe P12 (`let live = true`): it FAILS.
  - **Logging (Task 12 review):** a failed re-check and a failed tool log the error CLASS and the account id, never the message, which can quote a customer (`e instanceof Error ? e.name : typeof e`, the pattern in `finish.ts`). A case throws a message holding a name and a phone and asserts neither reaches the log. Probes: either log line back on `e.message` → FAILS.
  - **I-3:** the unit and live fixtures write the callback To do with the REAL writer, `callbackTaskTitle(number, reason)`, in both stored shapes: caller ID (`+19565550177`) and a national number the caller said (`9565550123`). The tests pin that the number is read as written. Probe: scrub numbers from `what` → the `needs_attention` cases and the scan FAIL.
  - **I-4:** the live seed gave A's two customers one phone, so `createContact` returned the first contact for the second and the Technician (assigned one) saw both. Now A's second customer has its own phone, B's customer keeps A's first customer's name AND phone, and every `createContact` in the seed asserts `existing === false`. Probes on the token path:
    - T0a, the old seed with no guard: the three T Technician cases FAIL;
    - T0b, the old seed with the guard: `beforeAll` FAILS, naming `createContact` and the phone;
    - T1, the fixed seed (not a mutation): `Tests  15 passed | 3 skipped (18)`, with the T Technician group run and passed and the F2 group skipped.
    `data-path.ts` was restored to `"service"` and proven byte-identical.
  - **m-1:** `resolveRange` never throws. A year above 9998 is `bad_range`, because the day after 9999-12-31 has no ISO form, and a zone the conversion cannot use is caught and answered `bad_range`. Probes: drop the year check → 9999-01-01 accepted, FAILS; drop the try → "Invalid time zone", FAILS; drop both → throws, FAILS.
  - **m-2:** the listing stops once it holds the 20 calls it describes, still at most 10 pages. **`truncated` is DROPPED** from `calls_and_messages`: the count is the tile's, which pages to the end, so it is never capped, and "the list stopped early" is already what `more` says. The tool's description no longer mentions it. `appointments` keeps its `truncated`, which does mean its count was capped (`AGENDA_ROW_CAP`), and its description now says so. Cases:
    - exactly 1000 answered calls: one page read, count 1000, more 980, no `truncated` key;
    - a sparse first page reads on to 20;
    - the 10-page bound.
    Probes: drop the stop → FAILS; `CALL_PAGES` 11 → FAILS; put `truncated` back → FAILS.
  - **m-4:** `OUTCOME_WORDS` is keyed on `(typeof ANSWERED_CALL_OUTCOMES)[number]`, and the listing is narrowed to those outcomes. Probe: add `"abandoned"` to `ANSWERED_CALL_OUTCOMES` → `tsc` fails in `read.ts` only (TS2741, `OUTCOME_WORDS`).
  - **m-5:** `meetingType` and `status` are spoken as the agenda's own words, in the person's language, through the agenda view model's `meetingWord` and `statusWord` (`calendar.job.*` and `calendar.bookings.status.*`, each with its `.es`). There is no new copy. A null `meetingType` stays null. Probes: either back to the stored code → FAILS.
  - **m-6:** the listing compares instants, never strings. PostgREST writes `+00:00`, and as strings a call on the range's first instant sorted before `…000Z`. The break is on `<=`, because `listCalls`' `before` is strict, so nothing in range can follow a row on the first instant. Probes: the string compare → the `+00:00` boundary call is dropped, FAILS; `<` → a second read, FAILS.
- [ ] **Step 7: Commit.**

  ```bash
  git add apps/web/src/lib/owner-line/tools apps/web/src/lib/work/row-label.ts apps/web/src/lib/work/row-label.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.tsx" apps/web/src/lib/messages.ts
  git commit -m "feat(voice): owner line tools: the dashboard's own answered count with each call's outcome in words, appointments, and To do in the page's own words, re-checked on every call"
  ```


---

## Task 12: The owner-line session: prompt, config, webhook branch, lifecycle hooks, finish (HIGH, 1.5 days)

**Files:**
- Modify: `apps/web/src/lib/owner-line/session.ts` (add `decideOwnerSession`)
- Create: `apps/web/src/lib/owner-line/prompt.ts`, `session-config.ts`, `events.ts`, `finish.ts`, and `session.test.ts`, `session-config.test.ts`, `events.test.ts`, `finish.test.ts`
- Modify: `apps/web/src/app/api/voice/incoming/route.ts`:
  - imports (`:85-117`)
  - `LifecycleArgs` (`:298-308`)
  - `runCallLifecycle` (`:320-874`): the cap/warning timers and the handle/finish hooks
  - a new step 7b after step 7 (`:1000`)
  - the receptionist `after(...)` (`:1362-1365`) gains `mode: "receptionist"`
- Modify: `apps/web/src/app/api/voice/incoming/route.test.ts` and `lifecycle.test.ts` (append a `describe` each), and `apps/web/src/lib/voice/call-events.test.ts` (one case)
- Modify: `apps/web/src/lib/messages.ts` (`ownerLine.session.warning` / `.es`)

**Interfaces:**
- Consumes (Task 4): `verifyOwnerPass`, `extractOwnerPass`, `SipHandoffCheck`.
- Consumes (Task 2): `ownerLineSessionCheck`, `noteOwnerLineCall`, `finishCallRow`, `startCallRow({ …, ownerLineUserId })`, `OWNER_LINE_MAX_CALLS_PER_DAY`.
- Consumes (Tasks 10–11): `OwnerLineSession`, `recheckOwnerSession`, `ownerLineReadClient`, `runOwnerTool`, `OWNER_TOOL_SCHEMAS`, `LOG_KIND_OF`, `OwnerToolName`.
- Consumes: `REALTIME_MODEL` (`WEB/lib/voice/session-config.ts:13`), `readTurnDetection` (`./turn-detection`), `withTranscript`, `emptyCallState`, `CallState`, `detectCallerLanguage`, `voiceMinutes`, `recordUsageSafely`.
- Produces:

```ts
// session.ts
export type OwnerSessionDecision = { ok: true; session: OwnerLineSession } | { ok: false; reason: string };
export async function decideOwnerSession(p: { db: SupabaseClient; raw: string; handoffToken: string | null;
  handoffCheck: SipHandoffCheck; accountId: string; now: Date }, deps?: { check: typeof ownerLineSessionCheck }): Promise<OwnerSessionDecision>;
// prompt.ts
export function ownerLineInstructions(p: { firstName: string | null; locale: Locale; businessName: string; personaName: string; timezone: string; now: Date }): string;
export function ownerLineGreeting(p: { firstName: string | null; locale: Locale }): string;
export function ownerLineWarning(locale: Locale): string;
// session-config.ts
export const OWNER_LINE_MAX_CALL_SECONDS = 600;
export function buildOwnerLineSessionConfig(p: Parameters<typeof ownerLineInstructions>[0]): { type: "realtime"; model: string;
  instructions: string; tools: typeof OWNER_TOOL_SCHEMAS; audio: object };
// events.ts
export async function processOwnerLineEvent(state: CallState, ctx: OwnerToolContext, ran: Set<OwnerToolName>,
  event: RealtimeCallEvent): Promise<{ state: CallState; actions: VoiceAction[] }>;
// finish.ts
export async function finishOwnerLineCall(state: CallState, ctx: { db: SupabaseClient; session: OwnerLineSession;
  ran: ReadonlySet<OwnerToolName> }, meta: { callRowId: string | null; startedAt: Date; endedAt: Date }): Promise<void>;
```

- [ ] **Step 1: Write the failing unit tests.**

```ts
// apps/web/src/lib/owner-line/session.test.ts
import { describe, it, expect, vi } from "vitest";
vi.mock("@bis/db", () => ({ serviceDb: () => ({}), ownerLineSessionCheck: vi.fn(), OWNER_LINE_MAX_CALLS_PER_DAY: 10 }));
import { decideOwnerSession } from "./session";
import { signOwnerPass } from "@/lib/voice/sip-handoff-signature";

const SECRET = "s".repeat(40);
const A = "11111111-1111-4111-8111-111111111111";
const B = "33333333-3333-4333-8333-333333333333";
const U = "22222222-2222-4222-8222-222222222222";
const TOKEN = "t".repeat(32);
const NOW = new Date(1_800_000_000_000);
const CALLED = "+19565550100";
const OK_CHECK = { ok: true as const, calledE164: CALLED, callerE164: "+19565550142" };
const LIVE = { ok: true as const, name: "Dan Lopez", language: "es" as const, clerkUserId: "user_d", clerkOrgId: "org_a",
  timezone: "America/Chicago", accountLanguage: null };
process.env.VOICE_HANDOFF_SECRET = SECRET;
const pass = (over: Partial<{ accountId: string; role: "owner" | "staff" | "technician"; at: number }> = {}) =>
  signOwnerPass(TOKEN, { accountId: over.accountId ?? A, userId: U, role: over.role ?? "staff", calledE164: CALLED }, over.at ?? NOW.getTime())!;
const decide = (raw: string, over: Partial<Parameters<typeof decideOwnerSession>[0]> = {}, check = vi.fn(async () => LIVE)) =>
  decideOwnerSession({ db: {} as never, raw, handoffToken: TOKEN, handoffCheck: OK_CHECK, accountId: A, now: NOW, ...over }, { check });

describe("decideOwnerSession: the pass is refused when (spec §7)", () => {
  it("all holds: a session for this person, in their language", async () => {
    expect(await decide(pass())).toEqual({ ok: true, session: { accountId: A, userId: U, role: "staff", clerkUserId: "user_d",
      clerkOrgId: "org_a", firstName: "Dan", actorName: "Dan Lopez", locale: "es", timezone: "America/Chicago" } });
  });
  it("its signature is tampered", async () => {
    expect(await decide(pass().replace(".staff.", ".owner."))).toEqual({ ok: false, reason: "pass-bad-signature" });
  });
  it("it is expired at 61 s", async () => {
    expect(await decide(pass({ at: NOW.getTime() - 61_000 }))).toEqual({ ok: false, reason: "pass-expired" });
  });
  it("it was minted for business A but is used on business B's number (mutation: drop the account comparison -> FAILS)", async () => {
    expect(await decide(pass(), { accountId: B })).toEqual({ ok: false, reason: "wrong-business" });
    expect(await decide(pass(), { handoffCheck: { ...OK_CHECK, calledE164: "+19565550111" } })).toEqual({ ok: false, reason: "wrong-business" });
  });
  it("the call itself did not come through our answer route (no X-BIS-Signature)", async () => {
    expect(await decide(pass(), { handoffCheck: { ok: false, reason: "absent" } })).toEqual({ ok: false, reason: "call-not-signed" });
  });
  it("the person was removed, or their role changed, after minting: the live re-read says so, with the minted role (SC-8)", async () => {
    const check = vi.fn(async () => ({ ok: false as const, reason: "role_changed" }));
    expect(await decide(pass(), {}, check)).toEqual({ ok: false, reason: "role_changed" });
    expect(check).toHaveBeenCalledWith({}, expect.objectContaining({ userId: U, role: "staff", maxCalls: 10 }));
  });
});
```

Replay is not this function's job. The webhook's redemption row refuses it (`calls_handoff_token_unique`), and the webhook test "a replayed pass…" below proves it.

```ts
// apps/web/src/lib/owner-line/session-config.test.ts
import { describe, it, expect } from "vitest";
import { buildOwnerLineSessionConfig, OWNER_LINE_MAX_CALL_SECONDS } from "./session-config";
import { toolSchemas } from "@/lib/voice/tools/schemas";

const P = { firstName: "Dan", locale: "en" as const, businessName: "Rio Roofing", personaName: "Sofía", timezone: "America/Chicago", now: new Date("2026-11-09T21:00:00Z") };
describe("the owner-line session (spec §4.4)", () => {
  it("is FLAT (type/model/instructions/tools/audio at the top level), never nested under session", () => {
    expect(Object.keys(buildOwnerLineSessionConfig(P)).sort()).toEqual(["audio", "instructions", "model", "tools", "type"]);
  });
  it("registers ONLY the owner tools: no booking, no lead capture, no transfer (mutation: concat toolSchemas(...) -> FAILS)", () => {
    const names = buildOwnerLineSessionConfig(P).tools.map((t) => t.name);
    expect(names).toEqual(["calls_and_messages", "appointments", "needs_attention"]);
    const receptionist = toolSchemas("full", "in_person", true).map((t: { name: string }) => t.name);
    expect(names.some((n) => (receptionist as string[]).includes(n))).toBe(false);
  });
  it("speaks to the person by first name, in their language, and is not the receptionist's prompt", () => {
    const i = buildOwnerLineSessionConfig({ ...P, locale: "es" }).instructions;
    expect(i).toContain("Dan");
    expect(i).toContain("Spanish");
    expect(i).toContain("usted");
    // Not the receptionist's prompt: none of its tool names or its message-taking rule.
    expect(i).not.toMatch(/take_message|capture_lead|book_appointment|transfer_to_human|take a message/i);
  });
  it("ends at 10 minutes", () => { expect(OWNER_LINE_MAX_CALL_SECONDS).toBe(600); });
});
```

```ts
// apps/web/src/lib/owner-line/finish.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
const d = vi.hoisted(() => ({ finish: vi.fn(), note: vi.fn(), usage: vi.fn() }));
vi.mock("@bis/db", () => ({ finishCallRow: d.finish, noteOwnerLineCall: d.note }));
vi.mock("@/lib/billing/usage", () => ({ recordUsageSafely: d.usage, voiceMinutes: (s: number) => Math.max(1, Math.ceil(s / 60)) }));
import { finishOwnerLineCall } from "./finish";
import { emptyCallState, withTranscript } from "@/lib/voice/call-state";

const S = { accountId: "a1", userId: "u1", role: "owner" as const, clerkUserId: "user_d", clerkOrgId: "org_a",
  firstName: "Dan", actorName: "Dan Lopez", locale: "en" as const, timezone: "America/Chicago" };
const T0 = new Date("2026-11-09T21:00:00Z");
const T1 = new Date("2026-11-09T21:02:05Z");
beforeEach(() => { vi.clearAllMocks(); d.finish.mockResolvedValue(undefined); d.note.mockResolvedValue(undefined); });

describe("finishOwnerLineCall (spec §6)", () => {
  it("closes the row with its transcript, records the minutes, and writes the access-log entry with the tools that ran", async () => {
    const state = withTranscript(emptyCallState(), { role: "caller", text: "what calls did I get today?", at: T0.toISOString() });
    await finishOwnerLineCall(state, { db: {} as never, session: S, ran: new Set(["calls_and_messages", "appointments"] as const) },
      { callRowId: "row1", startedAt: T0, endedAt: T1 });
    expect(d.finish).toHaveBeenCalledWith({}, "a1", "row1", expect.objectContaining({ durationSecs: 125, turnCount: 1, summary: "" }));
    expect(d.usage).toHaveBeenCalledWith({}, expect.objectContaining({ meter: "voice_minutes", quantity: 3, sourceRef: "call:row1" }), expect.any(String));
    expect(d.note).toHaveBeenCalledWith({}, { accountId: "a1", callId: "row1", actorClerkUserId: "user_d", actorName: "Dan Lopez",
      kinds: ["owner_line_calls_and_messages", "owner_line_appointments"] });
  });
  it("each leg on its own: a failed row write still logs who heard what (mutation: one shared try -> FAILS)", async () => {
    d.finish.mockRejectedValue(new Error("db"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await finishOwnerLineCall(emptyCallState(), { db: {} as never, session: S, ran: new Set() }, { callRowId: "row1", startedAt: T0, endedAt: T1 });
    expect(d.note).toHaveBeenCalled();
  });
  it("can reach nothing that writes to a customer: its imports are exactly these (mutation: import ensureCallbackTask from @bis/db -> FAILS)", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("./finish.ts", import.meta.url), "utf8");
    // Import lines only, never prose: a guard that a doc comment can satisfy or trip is no guard (memory bis-vacuous-test-shapes).
    const lines = [...src.matchAll(/^import [^;]+;$/gm)].map((x) => x[0]).sort();
    expect(lines).toEqual([
      'import type { CallState } from "@/lib/voice/call-state";',
      'import type { OwnerLineSession } from "./session";',
      'import { LOG_KIND_OF, type OwnerToolName } from "./tools/schemas";',
      'import { detectCallerLanguage } from "@/lib/voice/language";',
      'import { finishCallRow, noteOwnerLineCall, type SupabaseClient } from "@bis/db";',
      'import { recordUsageSafely, voiceMinutes } from "@/lib/billing/usage";',
    ].sort());
  });
});
```

The import-list case is a guard, not behaviour: it FAILS if a later edit gives the finish any way to reach a contact, a text-back, an alert, an automation log or an event.

```ts
// apps/web/src/lib/owner-line/events.test.ts
import { describe, it, expect, vi } from "vitest";
import { processOwnerLineEvent } from "./events";
import { emptyCallState } from "@/lib/voice/call-state";

describe("processOwnerLineEvent", () => {
  it("a tool call runs ONLY through runOwnerTool's context and records which tool ran", async () => {
    const recheck = vi.fn(async () => false);
    const ran = new Set<"calls_and_messages" | "appointments" | "needs_attention">();
    const ctx = { session: {} as never, now: () => new Date(), recheck, client: vi.fn() };
    const r = await processOwnerLineEvent(emptyCallState(), ctx, ran,
      { type: "response.function_call_arguments.done", name: "appointments", call_id: "fc1", arguments: "{\"range\":\"today\"}" });
    expect(r.actions[0]).toEqual({ kind: "send", payload: { type: "conversation.item.create",
      item: { type: "function_call_output", call_id: "fc1", output: JSON.stringify({ ok: false, error: "couldnt_read" }) } } });
    expect(r.actions[1]).toEqual({ kind: "send", payload: { type: "response.create" } });
    expect([...ran]).toEqual(["appointments"]);
  });
  it("a receptionist tool name asked for on this line is refused and never recorded", async () => {
    const ran = new Set<"calls_and_messages" | "appointments" | "needs_attention">();
    await processOwnerLineEvent(emptyCallState(), { session: {} as never, now: () => new Date(), recheck: vi.fn(), client: vi.fn() }, ran,
      { type: "response.function_call_arguments.done", name: "book_appointment", call_id: "x", arguments: "{}" });
    expect([...ran]).toEqual([]);
  });
  it("records both sides of the conversation into the transcript", async () => {
    let s = emptyCallState();
    const ctx = { session: {} as never, now: () => new Date(), recheck: vi.fn(), client: vi.fn() };
    s = (await processOwnerLineEvent(s, ctx, new Set(), { type: "conversation.item.input_audio_transcription.completed", transcript: "hi", item_id: "i1" })).state;
    s = (await processOwnerLineEvent(s, ctx, new Set(), { type: "response.output_audio_transcript.done", transcript: "Hi Dan" })).state;
    expect(s.transcript.map((t) => [t.role, t.text])).toEqual([["caller", "hi"], ["assistant", "Hi Dan"]]);
  });
});
```

- [ ] **Step 2: Run them and see them fail.**

  ```bash
  pnpm --filter web exec vitest run src/lib/owner-line/session.test.ts src/lib/owner-line/session-config.test.ts src/lib/owner-line/finish.test.ts src/lib/owner-line/events.test.ts
  ```

  Expected: FAIL (`decideOwnerSession is not a function`, and unresolved modules).

- [ ] **Step 3: Implement the four modules.**

```ts
// session.ts additions
import type { SupabaseClient } from "@bis/db";
import { OWNER_LINE_MAX_CALLS_PER_DAY } from "@bis/db";
import { verifyOwnerPass, type SipHandoffCheck } from "@/lib/voice/sip-handoff-signature";
import { OWNER_LINE_ROLES } from "./data-path";
import { firstName } from "@/lib/owner-line/names";

export type OwnerSessionDecision = { ok: true; session: OwnerLineSession } | { ok: false; reason: string };

/**
 * F-032 §4.3: an owner-line session ONLY when the pass verifies, is fresh, names the business the INVITE's own
 * signed statement names, carries a role this data path offers, and a live re-read finds the person still a member
 * in THAT role, enrolled, unlocked, switch on, under today's limit. Any refusal is a reason for the log, and the call
 * is the receptionist's. Single use is the webhook's redemption row, not this function's (plan SC-7).
 */
export async function decideOwnerSession(
  p: { db: SupabaseClient; raw: string; handoffToken: string | null; handoffCheck: SipHandoffCheck; accountId: string; now: Date },
  deps: { check: typeof ownerLineSessionCheck } = { check: ownerLineSessionCheck },
): Promise<OwnerSessionDecision> {
  const pass = verifyOwnerPass(p.raw, p.handoffToken, p.now.getTime());
  if (!pass.ok) return { ok: false, reason: `pass-${pass.reason}` };
  if (!p.handoffCheck.ok) return { ok: false, reason: "call-not-signed" };
  if (pass.calledE164 !== p.handoffCheck.calledE164 || pass.accountId !== p.accountId) return { ok: false, reason: "wrong-business" };
  if (!OWNER_LINE_ROLES.includes(pass.role)) return { ok: false, reason: "role-not-offered" };
  const live = await deps.check(p.db, { accountId: p.accountId, userId: pass.userId, role: pass.role,
    maxCalls: OWNER_LINE_MAX_CALLS_PER_DAY });
  if (!live.ok) return { ok: false, reason: live.reason };
  return { ok: true, session: {
    accountId: p.accountId, userId: pass.userId, role: pass.role, clerkUserId: live.clerkUserId, clerkOrgId: live.clerkOrgId,
    firstName: firstName(live.name), actorName: live.name, locale: live.language ?? live.accountLanguage ?? "en",
    timezone: live.timezone,
  } };
}
```

```ts
// apps/web/src/lib/owner-line/prompt.ts
// The owner line's OWN instruction set (spec §4.4), never the receptionist's. Nothing here is a security property
// (spec §2.3; memory prompt-only limits): the tools ARE the boundary, and their results are the only facts.
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";

export function ownerLineInstructions(p: { firstName: string | null; locale: Locale; businessName: string;
  personaName: string; timezone: string; now: Date }): string {
  const lang = p.locale === "es" ? "Spanish, always with usted" : "English";
  const who = p.firstName ? `${p.firstName}, who works at ${p.businessName || "the business"}` : `someone on the team at ${p.businessName || "the business"}`;
  const today = new Intl.DateTimeFormat("en-US", { timeZone: p.timezone, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(p.now);
  return [
    `You are ${p.personaName}, speaking on the phone with ${who}. They called in to hear about their own business. They are not a customer.`,
    `Speak ${lang}. If they switch language, answer in the language they just used.`,
    `Keep every answer short: one to three spoken sentences. Never read out more than five items; give the count and offer the rest.`,
    `Every number and every name you say must come from a tool result in this call. Never estimate, never round, never guess, never fill a gap.`,
    `Say counts exactly as the tool's count says. A caller of "a new caller" has no name on file.`,
    `If a tool result has ok false, say: "${t(m, "ownerLine.session.couldntRead", "en")}" (in Spanish: "${t(m, "ownerLine.session.couldntRead", "es")}"), and offer to try again.`,
    `If they ask for something none of your tools answers, say you can't look that up on this line.`,
    `This line only reads. You cannot book, cancel, move, text, call anyone, or change anything. If asked, say so plainly.`,
    `Today is ${today}, in the business's time zone (${p.timezone}). "This week" means Monday to Sunday.`,
    `Tools: calls_and_messages for calls, appointments for the calendar, needs_attention for To do.`,
  ].join("\n");
}

export function ownerLineGreeting(p: { firstName: string | null; locale: Locale }): string {
  const lang = p.locale === "es" ? "Spanish, with usted" : "English";
  return p.firstName
    ? `Say, in ${lang}, one short sentence greeting ${p.firstName} by first name and asking what they want to know.`
    : `Say, in ${lang}, one short sentence asking what they want to know.`;
}

export function ownerLineWarning(locale: Locale): string {
  return `Say exactly this and nothing else: "${t(m, "ownerLine.session.warning", locale)}"`;
}
```

```ts
// apps/web/src/lib/owner-line/session-config.ts
// FLAT, like buildRealtimeSessionConfig (lib/voice/session-config.ts:89-107): nesting under `session` is the
// documented silent 4xx. Same model, transcription, voice and turn detection as the receptionist; its own prompt
// and ONLY its own tools.
import { REALTIME_MODEL } from "@/lib/voice/session-config";
import { readTurnDetection } from "@/lib/voice/turn-detection";
import { OWNER_TOOL_SCHEMAS } from "./tools/schemas";
import { ownerLineInstructions } from "./prompt";

export const OWNER_LINE_MAX_CALL_SECONDS = 600;

export function buildOwnerLineSessionConfig(p: Parameters<typeof ownerLineInstructions>[0]) {
  return {
    type: "realtime" as const,
    model: REALTIME_MODEL,
    instructions: ownerLineInstructions(p),
    tools: OWNER_TOOL_SCHEMAS,
    audio: {
      input: {
        transcription: { model: "gpt-4o-mini-transcribe" },
        noise_reduction: { type: "near_field" },
        turn_detection: readTurnDetection(),
      },
      output: { voice: "marin" },
    },
  };
}
```

```ts
// apps/web/src/lib/owner-line/events.ts
import { withTranscript, type CallState } from "@/lib/voice/call-state";
import type { RealtimeCallEvent, VoiceAction } from "@/lib/voice/call-events";
import { runOwnerTool, type OwnerToolContext } from "./tools/registry";
import { OWNER_TOOL_NAMES, type OwnerToolName } from "./tools/schemas";

function parse(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}

/** The owner line's frame handler: the transcript both ways and the owner tools. No recording guard (a person
 *  who keyed a PIN is not a broadcast), no transfer, no hangup action. */
export async function processOwnerLineEvent(
  state: CallState, ctx: OwnerToolContext, ran: Set<OwnerToolName>, event: RealtimeCallEvent,
): Promise<{ state: CallState; actions: VoiceAction[] }> {
  switch (event?.type) {
    case "response.output_audio_transcript.done":
      return event.transcript
        ? { state: withTranscript(state, { role: "assistant", text: String(event.transcript), at: new Date().toISOString() }), actions: [] }
        : { state, actions: [] };
    case "conversation.item.input_audio_transcription.completed":
      return event.transcript
        ? { state: withTranscript(state, { role: "caller", text: String(event.transcript), at: new Date().toISOString() }), actions: [] }
        : { state, actions: [] };
    case "response.function_call_arguments.done": {
      const name = String(event.name ?? "");
      const result = await runOwnerTool(ctx, name, parse(event.arguments));
      if ((OWNER_TOOL_NAMES as readonly string[]).includes(name)) ran.add(name as OwnerToolName);
      return { state, actions: [
        { kind: "send", payload: { type: "conversation.item.create",
          item: { type: "function_call_output", call_id: event.call_id, output: JSON.stringify(result) } } },
        { kind: "send", payload: { type: "response.create" } },
      ] };
    }
    default:
      return { state, actions: [] };
  }
}
```

`VoiceAction` and `RealtimeCallEvent` are already exported from `WEB/lib/voice/call-events.ts:18,31`.

```ts
// apps/web/src/lib/owner-line/finish.ts
import { finishCallRow, noteOwnerLineCall, type SupabaseClient } from "@bis/db";
import { recordUsageSafely, voiceMinutes } from "@/lib/billing/usage";
import { detectCallerLanguage } from "@/lib/voice/language";
import type { CallState } from "@/lib/voice/call-state";
import { LOG_KIND_OF, type OwnerToolName } from "./tools/schemas";
import type { OwnerLineSession } from "./session";

/**
 * F-032 §6, the "legs" pattern (finish-call.ts), each leg in its own try/catch, NEVER throws:
 *   1. the calls row: ended, duration, transcript (the PIN was never in it: §2.2). Outcome stays the column default
 *      `abandoned`. Every counting reader leaves the row out by owner_line_user_id (Task 2), so the outcome is not a
 *      metric anywhere;
 *   2. its minutes on the voice_minutes meter, when the person spoke (M7a: minutes for a call Sofía talked to; Q-B);
 *   3. the access-log entry: who, which business, when, which tools ran.
 * Nothing else: no contact, no conversation, no text-back, no staff alert, no call card, no callback To do, no
 * proposals, no automation log, no event. A read is not a change (§6).
 */
export async function finishOwnerLineCall(
  state: CallState, ctx: { db: SupabaseClient; session: OwnerLineSession; ran: ReadonlySet<OwnerToolName> },
  meta: { callRowId: string | null; startedAt: Date; endedAt: Date },
): Promise<void> {
  const s = ctx.session;
  const durationSecs = Math.max(0, Math.round((meta.endedAt.getTime() - meta.startedAt.getTime()) / 1000));
  if (!meta.callRowId) {
    console.error(`[voice/owner-line] finish with no call row, accountId ${s.accountId}`);
    return;
  }
  try {
    await finishCallRow(ctx.db, s.accountId, meta.callRowId, {
      outcome: "abandoned", endedAt: meta.endedAt, durationSecs, turnCount: state.transcript.length,
      transcript: state.transcript, summary: "", language: detectCallerLanguage(state, s.locale),
    });
  } catch (e) {
    console.error(`[voice/owner-line] call row finish failed ${meta.callRowId}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (state.transcript.some((x) => x.role === "caller")) {
    await recordUsageSafely(ctx.db, { accountId: s.accountId, meter: "voice_minutes", quantity: voiceMinutes(durationSecs),
      occurredAt: meta.endedAt, sourceRef: `call:${meta.callRowId}` }, `owner line ${meta.callRowId}`);
  }
  try {
    await noteOwnerLineCall(ctx.db, { accountId: s.accountId, callId: meta.callRowId, actorClerkUserId: s.clerkUserId,
      actorName: s.actorName, kinds: [...ctx.ran].map((n) => LOG_KIND_OF[n]) });
  } catch (e) {
    console.error(`[voice/owner-line] access-log entry failed ${meta.callRowId}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
```

Copy:

```ts
  "ownerLine.session.couldntRead": "I couldn't read that just now.",
  "ownerLine.session.couldntRead.es": "No pude leer eso en este momento.",
  "ownerLine.session.warning": "We have one minute left on this call.",
  "ownerLine.session.warning.es": "Nos queda un minuto en esta llamada.",
```

- [ ] **Step 4: Run the units green.** Use the Step 2 command. Expected: all pass. Paste the summary line.

- [ ] **Step 5: Write the failing webhook and lifecycle tests.** Append to `incoming/route.test.ts`. Add `vi.mock("@/lib/owner-line/session", …)` beside the existing mocks, and give the existing `@bis/db` factory no new key (the owner branch's `@bis/db` calls are `startCallRow` and `deleteCallRow`, both already mocked):

```ts
const decideOwnerMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/owner-line/session", () => ({
  decideOwnerSession: (...a: unknown[]) => decideOwnerMock(...a),
  recheckOwnerSession: vi.fn(async () => true),
}));
// in the top-level beforeEach:  decideOwnerMock.mockReset();

describe("POST /api/voice/incoming — step 7b: the owner line (F-032 §4.3, §4.4, §7 'the wall')", () => {
  const SESSION = { accountId: "acct1", userId: "u1", role: "owner", clerkUserId: "user_d", clerkOrgId: "org_a",
    firstName: "Dan", actorName: "Dan Lopez", locale: "en", timezone: "America/Chicago" };
  const withPass = () => {
    const e = callIncomingEvent();
    e.data.sip_headers.push({ name: "X-BIS-Handoff", value: "tok_owner" }, { name: "X-BIS-Owner-Pass", value: "1.a.b.owner.19565550999.mac" });
    return e;
  };
  const acceptBody = () => JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)) as { tools: { name: string }[]; instructions: string };

  it("a customer call never reaches the owner decision and never gets an owner tool", async () => {
    unwrapMock.mockResolvedValue(callIncomingEvent());
    await POST(req());
    expect(decideOwnerMock).not.toHaveBeenCalled();
    expect(acceptBody().tools.map((t) => t.name)).not.toContain("calls_and_messages");
  });

  it("an owner check that THROWS is the receptionist's call, never an unaccepted one (I-1; mutation: drop the try/catch -> the outer catch acks without accepting, FAILS)", async () => {
    decideOwnerMock.mockRejectedValue(new Error("db blip"));
    unwrapMock.mockResolvedValue(withPass());
    const log = vi.spyOn(console, "log");
    expect((await POST(req())).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(acceptBody().tools.map((t) => t.name)).not.toContain("calls_and_messages");
    expect(JSON.stringify(log.mock.calls)).toContain("owner-check-failed");
  });

  it("a valid pass: the redemption row first (marked, with the handoff token), then a FLAT accept with ONLY the owner tools", async () => {
    decideOwnerMock.mockResolvedValue({ ok: true, session: SESSION });
    unwrapMock.mockResolvedValue(withPass());
    expect((await POST(req())).status).toBe(200);
    expect(startCallRowMock).toHaveBeenCalledWith(expect.anything(), "acct1",
      expect.objectContaining({ handoffToken: "tok_owner", ownerLineUserId: "u1" }));
    const body = acceptBody();
    expect(body.tools.map((t) => t.name)).toEqual(["calls_and_messages", "appointments", "needs_attention"]);
    expect(body.instructions).toContain("Dan");
    expect(afterMock).toHaveBeenCalledOnce();
  });

  it("the owner path is not refused by the customer caps (SC-9): its own limit lives in the decision", async () => {
    countCallsByCallerSinceMock.mockResolvedValue(99);
    decideOwnerMock.mockResolvedValue({ ok: true, session: SESSION });
    unwrapMock.mockResolvedValue(withPass());
    await POST(req());
    expect(acceptBody().tools.map((t) => t.name)).toEqual(["calls_and_messages", "appointments", "needs_attention"]);
  });

  it("a refused pass is today's receptionist, logged with the reason (mutation: accept on any pass -> FAILS)", async () => {
    decideOwnerMock.mockResolvedValue({ ok: false, reason: "wrong-business" });
    unwrapMock.mockResolvedValue(withPass());
    const log = vi.spyOn(console, "log");
    await POST(req());
    expect(acceptBody().tools.map((t) => t.name)).not.toContain("calls_and_messages");
    expect(JSON.stringify(log.mock.calls)).toContain("wrong-business");
  });

  it("a replayed pass: the redemption row is refused (unique handoff token), so the call is the receptionist's, never a second owner session", async () => {
    decideOwnerMock.mockResolvedValue({ ok: true, session: SESSION });
    startCallRowMock.mockReset()
      .mockRejectedValueOnce(new Error('startCallRow failed: duplicate key value violates unique constraint "calls_handoff_token_unique"'))
      .mockRejectedValueOnce(new Error("startCallRow failed: duplicate key"));
    unwrapMock.mockResolvedValue(withPass());
    await POST(req());
    expect(acceptBody().tools.map((t) => t.name)).not.toContain("calls_and_messages");
  });
});
```

**"A customer call never gets them, even one saying 'this is the owner, my PIN is…'" (spec §7).** The caller's words reach only the model. What matters is that a receptionist session can run no owner tool even if the model calls one by name. Append to `apps/web/src/lib/voice/call-events.test.ts`:

```ts
it("a receptionist session cannot run an owner tool, whatever the caller said: calls_and_messages is an unknown tool there (spec §7 'the wall'; mutation: register calls_and_messages in voice/tools/registry.ts -> FAILS)", async () => {
  // runTool reads ctx.profile and ctx.now before its name switch (WEB/lib/voice/tools/registry.ts:309-321); read the rest
  // of that path and supply whatever else it touches before the switch, so the result is the unknown-tool branch and
  // not a TypeError (which would produce the "tool failed" payload and pass for the wrong reason).
  const ctx = { profile: { booking_enabled: true, after_hours: "hours_then_message", languages: "en" }, now: () => new Date() } as never;
  const r = await processCallEvent(emptyCallState(), ctx,
    { type: "response.function_call_arguments.done", name: "calls_and_messages", call_id: "x", arguments: "{\"range\":\"today\"}" });
  expect(r.actions[0]).toEqual({ kind: "send", payload: { type: "conversation.item.create",
    item: { type: "function_call_output", call_id: "x", output: JSON.stringify({ ok: false, error: "unknown tool" }) } } });
});
```

Append to `lifecycle.test.ts`, with the same `vi.mock("@/lib/owner-line/session", …)` plus a mock of `@/lib/owner-line/finish` (`finishOwnerLineCall: finishOwnerMock`) and of `@/lib/voice/finish-call`'s `finishCall` if that file does not already spy on it. Read its top before adding a second mock of the same module.

```ts
describe("runCallLifecycle — the owner line's timers and finish (F-032 §4.4)", () => {
  it("warns at 540 s, ends at 600 s whatever PHONE_MAX_CALL_SECONDS says, and finishes as an owner-line call (mutation: receptionist finishCall -> FAILS)", async () => {
    vi.useFakeTimers();
    process.env.PHONE_MAX_CALL_SECONDS = "60";
    decideOwnerMock.mockResolvedValue({ ok: true, session: { accountId: "acct1", userId: "u1", role: "owner", clerkUserId: "c",
      clerkOrgId: "o", firstName: "Dan", actorName: "Dan", locale: "en", timezone: "America/Chicago" } });
    const e = callIncomingEvent("call_owner", "tok_owner");
    e.data.sip_headers.push({ name: "X-BIS-Owner-Pass", value: "1.a.b.owner.19565550999.mac" });
    unwrapMock.mockResolvedValue(e);
    await POST(req());
    const lifecycleDone = (afterMock.mock.calls[0]![0] as () => Promise<void>)();
    const ws = fakeSockets.instances[fakeSockets.instances.length - 1]!;
    ws.send = vi.fn();
    ws.emit("open");
    ws.emit("message", JSON.stringify({ type: "input_audio_buffer.speech_started" }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(539_000);
    expect(instructionsSent(ws.send as ReturnType<typeof vi.fn>).some((i) => i.includes("one minute left"))).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(instructionsSent(ws.send as ReturnType<typeof vi.fn>).some((i) => i.includes("one minute left"))).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(instructionsSent(ws.send as ReturnType<typeof vi.fn>).some((i) => i.includes("brief goodbye"))).toBe(true);
    ws.emit("close", 1000, Buffer.from(""));
    await lifecycleDone;
    expect(finishOwnerMock).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
```

The `"brief goodbye"` substring is the one the existing clamp test reads (`lifecycle.test.ts:742`) from `capGoodbye`. Confirm it in `WEB/lib/voice/silence-guard.ts` before relying on it.

- [ ] **Step 6: Run them and see them fail.**

  ```bash
  pnpm --filter web exec vitest run src/app/api/voice/incoming
  ```

  Expected: the new cases FAIL (the route never calls `decideOwnerSession`), and every older case is green. Paste one failing line.

- [ ] **Step 7: Implement the route changes.**
  1. Imports: add `extractOwnerPass` to the sip-headers import, plus:

```ts
import { decideOwnerSession, recheckOwnerSession, type OwnerLineSession } from "@/lib/owner-line/session";
import { buildOwnerLineSessionConfig, OWNER_LINE_MAX_CALL_SECONDS } from "@/lib/owner-line/session-config";
import { ownerLineGreeting, ownerLineWarning } from "@/lib/owner-line/prompt";
import { processOwnerLineEvent } from "@/lib/owner-line/events";
import { finishOwnerLineCall } from "@/lib/owner-line/finish";
import { ownerLineReadClient } from "@/lib/owner-line/reader";
import type { OwnerToolName } from "@/lib/owner-line/tools/schemas";
import type { OwnerToolContext } from "@/lib/owner-line/tools/registry";
import type { CallState } from "@/lib/voice/call-state";
import type { RealtimeCallEvent, VoiceAction } from "@/lib/voice/call-events";
```

  2. `LifecycleArgs` becomes a union:

```ts
interface LifecycleBase {
  callId: string; apiKey: string; greetingInstruction: string; languages: "en" | "es" | "both";
  callRowId: string | null; startedAt: Date;
}
type OwnerLineHooks = {
  handle: (state: CallState, event: RealtimeCallEvent) => Promise<{ state: CallState; actions: VoiceAction[] }>;
  finish: (state: CallState, meta: { callRowId: string | null; startedAt: Date; endedAt: Date }) => Promise<void>;
  capSeconds: number; warning: { atSeconds: number; instruction: string };
};
type LifecycleArgs = LifecycleBase & (
  | { mode: "receptionist"; toolCtx: ToolContext; finishCtx: FinishContext }
  | { mode: "owner_line"; ownerLine: OwnerLineHooks });
```

  3. Inside `runCallLifecycle`:
     - Destructure only the base fields at the top, and declare `let warnTimer: NodeJS.Timeout | undefined;` beside the other timers. Clear it everywhere `capTimer` is cleared: in `finish`, the silence guard, the hangup and the handoff branches.
     - In `finish`: `if (args.mode === "owner_line") await args.ownerLine.finish(state, { callRowId, startedAt, endedAt: new Date() }); else await finishCall(state, args.finishCtx, { callRowId, startedAt, endedAt: new Date() });`, inside the existing try.
     - `maxSeconds`: `const maxSeconds = args.mode === "owner_line" ? Math.min(args.ownerLine.capSeconds, MAX_CALL_SECONDS_CLAMP) : Math.min(Math.max(parsedOrDefault, 10), MAX_CALL_SECONDS_CLAMP);`. Then for the owner line arm the warning:

```ts
      if (args.mode === "owner_line") {
        const { atSeconds, instruction } = args.ownerLine.warning;
        warnTimer = setTimeout(() => {
          if (settled) return;
          try { ws.send(JSON.stringify({ type: "response.create", response: { instructions: instruction } })); }
          catch { /* socket closing; the cap still ends the call */ }
        }, Math.min(atSeconds, maxSeconds - 1) * 1000);
      }
```

     - In `handleMessage`: `const result = args.mode === "owner_line" ? await args.ownerLine.handle(state, event) : await processCallEvent(state, args.toolCtx, event);`. The recorded-message log's caller becomes `args.mode === "receptionist" ? args.finishCtx.callerNumber ?? "unknown" : "owner line"`.
     - The receptionist call site at step 13 becomes `runCallLifecycle({ mode: "receptionist", callId, apiKey, … })`.
  4. The owner-line answer, a new function beside `acceptCall`:

```ts
/**
 * F-032 §4.3-§4.4. The redemption row FIRST: it carries the handoff token, which calls_handoff_token_unique allows
 * once, so a replayed pass fails here and the call is the receptionist's (plan SC-7). Unlike startCallRow at step 10
 * this one FAILS CLOSED: no row, no owner tools. Returns false to hand the call back to the receptionist path, true
 * when this function answered the webhook (accepted, or accept refused).
 */
async function answerOwnerLine(a: {
  callId: string; apiKey: string; db: ReturnType<typeof serviceDb>; accountId: string; phoneRowId: string;
  callerNumber: string | null; handoffToken: string | null; personaName: string; session: OwnerLineSession; now: Date;
}): Promise<boolean> {
  if (!a.handoffToken) {
    log("owner line refused — no handoff token to redeem", { callId: a.callId, accountId: a.accountId });
    return false;
  }
  let callRowId: string;
  try {
    callRowId = (await startCallRow(a.db, a.accountId, {
      phoneNumberId: a.phoneRowId, callerE164: a.callerNumber, handoffToken: a.handoffToken, ownerLineUserId: a.session.userId,
    })).id;
  } catch (e) {
    log("owner line refused — its single-use call row could not be written (a replay, or the database)",
      { callId: a.callId, accountId: a.accountId, error: loggableError(e) });
    return false;
  }
  let businessName = "";
  try {
    const row = await loadAccountContext(a.db, a.accountId);
    businessName = brandDisplayName({
      brandName: row.brand_name, brandLogoPath: row.brand_logo_path, brandColor: row.brand_color,
      brandNeutral: row.brand_neutral, brandCorners: row.brand_corners, brandType: row.brand_type,
      brandMode: row.brand_mode, replyToEmail: row.reply_to_email,
    });
  } catch (e) {
    log("owner line: brand read failed — the prompt says 'the business'", { callId: a.callId, error: loggableError(e) });
  }
  const config = buildOwnerLineSessionConfig({ firstName: a.session.firstName, locale: a.session.locale, businessName,
    personaName: a.personaName, timezone: a.session.timezone, now: a.now });
  const ran = new Set<OwnerToolName>();
  const toolCtx: OwnerToolContext = { session: a.session, now: () => new Date(), recheck: recheckOwnerSession, client: ownerLineReadClient };
  try {
    await acceptCall(a.callId, a.apiKey, config);
  } catch (e) {
    log("failed to accept the owner-line call", { callId: a.callId, error: String(e) });
    stampHeartbeat("voice.sip_webhook", { ok: false, error: `OpenAI did not accept the call (${e instanceof Error ? e.name : typeof e})` });
    try { await deleteCallRow(a.db, a.accountId, callRowId); } catch (c) {
      log("owner-line accept-failure cleanup: deleteCallRow failed", { callId: a.callId, error: String(c) });
    }
    return true;
  }
  log("owner line accepted", { callId: a.callId, accountId: a.accountId });
  stampHeartbeat("voice.sip_webhook", { ok: true });
  after(() => runCallLifecycle({
    mode: "owner_line", callId: a.callId, apiKey: a.apiKey,
    greetingInstruction: ownerLineGreeting({ firstName: a.session.firstName, locale: a.session.locale }),
    languages: a.session.locale, callRowId, startedAt: a.now,
    ownerLine: {
      handle: (state, event) => processOwnerLineEvent(state, toolCtx, ran, event),
      finish: (state, meta) => finishOwnerLineCall(state, { db: a.db, session: a.session, ran }, meta),
      capSeconds: OWNER_LINE_MAX_CALL_SECONDS,
      warning: { atSeconds: OWNER_LINE_MAX_CALL_SECONDS - 60, instruction: ownerLineWarning(a.session.locale) },
    },
  }));
  return true;
}
```

  5. Step 7b in `POST`, right after the `if (!profile) {…}` narrowing (`:998-1000`) and BEFORE step 8's caps (SC-9):

```ts
    // --- Step 7b: the owner line (F-032 §4.3) -------------------------------
    // Only a call carrying an owner pass is even considered; every customer call skips this block entirely. The
    // decision is in code (lib/owner-line/session.ts), never in the prompt. A refusal is today's receptionist below.
    const ownerPassRaw = extractOwnerPass(event.data);
    if (ownerPassRaw) {
      // Its own try (I-1): decideOwnerSession reads the database, and a throw escaping here would reach POST's outer
      // catch, which acks 200 WITHOUT accepting (route.ts:906, :1366-1371): dead air. A failed check is a refusal of
      // the OWNER path only; the call continues to step 8 as a customer's, with every customer check. This is not a
      // fail-open site: nothing is granted on a failure.
      let owner: Awaited<ReturnType<typeof decideOwnerSession>>;
      try {
        owner = await decideOwnerSession({
          db, raw: ownerPassRaw, handoffToken: extractHandoffToken(event.data), handoffCheck, accountId, now,
        });
      } catch (e) {
        owner = { ok: false, reason: "owner-check-failed" };
        log("owner pass check threw", { callId, accountId, error: loggableError(e) });
      }
      log("owner pass checked", { callId, accountId, result: owner.ok ? "ok" : owner.reason });
      if (owner.ok && await answerOwnerLine({
        callId, apiKey, db, accountId, phoneRowId: phoneRow.id, callerNumber,
        handoffToken: extractHandoffToken(event.data), personaName: profile.persona_name || "Sofía",
        session: owner.session, now,
      })) {
        return NextResponse.json({ ok: true });
      }
    }
```

  6. Update the file header's "Fail-open, deliberately, in exactly five places" list. It stays five: the owner line adds no fail-open site, and its redemption row fails CLOSED. Add one sentence saying so, so an auditor does not read the new `startCallRow` as a sixth site.

- [ ] **Step 8: Run green, the whole voice suite.**

  ```bash
  pnpm --filter web exec vitest run src/lib/voice src/app/api/voice src/lib/owner-line && pnpm --filter web typecheck
  ```

  Expected: green, and typecheck silent. Paste the summary line.

- [ ] **Step 9: Mutation probes (HIGH).** Each must FAIL BY NAME:
  1. In step 7b, accept whenever a pass is present (skip `owner.ok`) → "a refused pass is today's receptionist" FAILS.
  1b. Remove the `try`/`catch` around `decideOwnerSession` → "an owner check that THROWS is the receptionist's call" FAILS (no accept is issued).
  2. In `answerOwnerLine`, ignore a `startCallRow` throw (continue with `callRowId = null`) → "a replayed pass … never a second owner session" FAILS.
  3. In `buildOwnerLineSessionConfig`, use `tools: [...OWNER_TOOL_SCHEMAS, ...toolSchemas("full", "in_person", true)]` → "registers ONLY the owner tools" and the webhook's flat-accept case FAIL.
  4. In `runCallLifecycle`, call `finishCall` for both modes → the lifecycle case FAILS.
  5. In `decideOwnerSession`, drop `pass.accountId !== p.accountId` → "minted for business A but used on business B's number" FAILS.

**As built (2026-11-09, commit `3120c8bc`).** What differs from the steps above, and why:
- **The owner runtime is loaded on the owner path only.** `answerOwnerLine` does `await import()` of `events`, `finish` and `reader` before it writes anything. The incoming route already loads the catalogue eagerly (922 KB measured), but the tools' read path (`weekly-metrics`, `row-label`, `record/copy`) is new weight, and a customer's call should load none of it. A failed load is a refusal: the receptionist, with no row written.
- **Every `answerOwnerLine` step fails closed.** A session that cannot be built deletes its redemption row and goes to the receptionist. Its logs name the error class only: a duplicate-key message can quote the handoff token, which is a credential.
- **Step 4b's "incoming call" line logs `withheld (owner pass present)` instead of the caller's number when an owner pass rides the call.** Every other call's line is unchanged, and a test pins that.
- **The receptionist-side wall test sits in `lib/voice/tools/registry.test.ts`, not `call-events.test.ts`.** That file mocks `runTool` wholesale, so the planned case would only have exercised the mock. The new cases drive the real `runTool` for every owner tool name, and the real `processCallEvent` once.
- **`events.ts` records a caller turn once, by item id (`callerItemIds`), as the receptionist's handler does.**
- **`finish.ts` logs the error class and the account only.** Its import list is exactly the pinned one.
- **`prompt.ts` gives the couldn't-read sentence in the person's language first and the other language second.** It reads the catalogue through `t(m, key, locale)` with a computed locale: the i18n ratchet (G3) counts a hard-coded `"en"`/`"es"` as a direct read.
- **The owner session also refuses a Technician pass (`role-not-offered`) before any read, and a missing handoff token.**
- **Review m-3 (Tasks 10/11), carried here because it edits `session.ts`.**
  - `recheckOwnerSession` refuses a session whose `clerkUserId` or `clerkOrgId` is not the re-checked row's.
  - A scan in `session.test.ts` fails on any non-test source that annotates, casts to, satisfies or returns an `OwnerLineSession`, so `decideOwnerSession` stays the only builder.
  - Branding the type would be stronger, but it breaks every test that builds a session literal (several are the db agent's files). Recommended before the T flip.
- **Probes, each failing its named case and reverted byte-identical:** the six above (1, 1b, 2, 3, 4, 5), plus:
  - the called-number comparison, the role check and the handoff-signature check;
  - owner frames sent to `processCallEvent`;
  - no warning timer, and the owner line on `PHONE_MAX_CALL_SECONDS`;
  - the caller's number in step 4b's line;
  - an owner accept failure falling through to a second accept;
  - no handoff-token check, and no brand name;
  - the finish's row leg sharing one catch, and a customer-writing import in the finish;
  - a refused tool name recorded;
  - an owner tool registered in the receptionist's registry;
  - m-3's three probes: the user-id comparison, the org-id comparison, and a second builder.

- [ ] **Step 10: Commit.**

  ```bash
  git add apps/web/src/lib/owner-line apps/web/src/app/api/voice/incoming apps/web/src/lib/voice/call-events.test.ts apps/web/src/lib/messages.ts
  git commit -m "feat(voice): the owner-line session: built only from a verified, unredeemed pass and a live re-read, with only the owner tools, 10 minutes, and a finish that writes no customer record"
  ```

---

## Task 13: Calls list label and "Asked about" on the call page (LOW, 0.5 day)

**Files:**
- Modify: `ACCT/calls/format.ts` (add `ownerLineLabel`, `askedAboutLine`), `format.test.ts`
- Modify: `ACCT/calls/calls-table.tsx` (the outcome cell), `ACCT/calls/page.tsx` (one team read, only when a row needs it)
- Modify: `ACCT/calls/[callId]/page.tsx` (the label and the Asked-about line)
- Modify: `apps/web/src/lib/messages.ts` (`ownerLine.calls.*`)

**Interfaces:**
- Consumes: `CallListRow.owner_line_user_id` (Task 2), `listAccountTeam` (`DB/team.ts:156`, readable by a member under RLS: `users_member_read`, 0066:108), `readOwnerLineCallLog` (Task 2), `firstName` (Task 7).
- Produces: `ownerLineLabel(name: string | null, locale: Locale): string` and `askedAboutLine(kinds: readonly OwnerLineLogKind[], locale: Locale): string | null`.

- [ ] **Step 1: Write the failing test** (append to `format.test.ts`):

```ts
import { ownerLineLabel, askedAboutLine } from "./format";
describe("the owner-line call's label (spec §6; DESIGN rule 3: dot plus word, the dot is the cell's)", () => {
  it("names the person, or 'Someone on the team' when the reader cannot", () => {
    expect(ownerLineLabel("Dan", "en")).toBe("Owner line · Dan");
    expect(ownerLineLabel(null, "en")).toBe("Owner line · Someone on the team");
    expect(ownerLineLabel("Dan", "es")).toBe("Línea del dueño · Dan");
  });
  it("Asked about: in the order the tools are listed, in words; null when nothing ran", () => {
    expect(askedAboutLine(["owner_line_appointments", "owner_line_calls_and_messages"], "en")).toBe("Asked about: calls and messages, appointments");
    expect(askedAboutLine([], "en")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

  ```bash
  pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calls/format.test.ts"
  ```

  Expected: FAIL, `ownerLineLabel is not exported`.

- [ ] **Step 3: Implement.** In `format.ts`:

```ts
import { OWNER_LINE_LOG_KINDS, type OwnerLineLogKind } from "@bis/db";
export function ownerLineLabel(name: string | null, locale: Locale): string {
  return t(m, "ownerLine.calls.label", locale, { name: name ?? t(m, "ownerLine.calls.someone", locale) });
}
const ASKED: Record<OwnerLineLogKind, keyof typeof m> = {
  owner_line_calls_and_messages: "ownerLine.calls.kind.calls",
  owner_line_appointments: "ownerLine.calls.kind.appointments",
  owner_line_needs_attention: "ownerLine.calls.kind.attention",
  owner_line_lookup_customer: "ownerLine.calls.kind.lookup",
};
export function askedAboutLine(kinds: readonly OwnerLineLogKind[], locale: Locale): string | null {
  const ordered = OWNER_LINE_LOG_KINDS.filter((k) => kinds.includes(k));
  if (ordered.length === 0) return null;
  return t(m, "ownerLine.calls.askedAbout", locale, { list: ordered.map((k) => t(m, ASKED[k], locale)).join(", ") });
}
```

`format.ts` must stay importable by client components. If it is a client module, import `OWNER_LINE_LOG_KINDS` with a type-only import plus a local copy of the four strings, and pin that copy equal to the `@bis/db` constant in `format.test.ts`.

In `calls-table.tsx`, where `<OutcomePill …/>` renders (`:158`): when `row.owner_line_user_id` is set, render this instead of the outcome pill and the text-back badge:

```tsx
<span className="inline-flex items-center gap-2 text-sm" data-owner-line-call>
  <span aria-hidden className="size-2 rounded-full bg-[var(--accent)]" />
  {tr.text("ownerLine.calls.label", { name: ownerNames[row.owner_line_user_id] ?? tr.text("ownerLine.calls.someone") })}
</span>
```

Here `ownerNames: Record<string, string>` is a new prop. `page.tsx` builds it only when some row has `owner_line_user_id`:

```ts
const ownerIds = [...new Set(rows.map((r) => r.owner_line_user_id).filter((x): x is string => !!x))];
const ownerNames: Record<string, string> = ownerIds.length === 0 ? {} : Object.fromEntries(
  (await listAccountTeam(db, accountId).catch((e: unknown) => { console.error(`calls: team read failed: ${loggableError(e)}`); return []; }))
    .filter((p) => ownerIds.includes(p.userId))
    .map((p) => [p.userId, firstName(p.name) ?? p.email.split("@")[0]!]));
```

On `[callId]/page.tsx`, when the call has `owner_line_user_id`:
- **The page shows "Owner line · Dan" (dot and word) WHERE IT SHOWS THE OUTCOME, never the outcome pill.** The row's stored outcome is `abandoned` (Task 12's finish), and "Abandoned" on an owner-line call would be a false word.
- **Below the label, "Asked about…" sits in its own small section with its own three states (DESIGN rule 5):**
  - **loaded:** the `askedAboutLine` text, or nothing when no tool ran;
  - **empty:** for a reader the access log's RLS returns no rows to (Staff), the section is not rendered at all. 0105's reader rule: the Owner and the agency only.
  - **error:** a failed `readOwnerLineCallLog` is NOT swallowed. It is logged with `loggableError` and the section says "We couldn't load what was asked on this call." (`ownerLine.calls.askedAboutError` / `.es`: "No pudimos cargar lo que se preguntó en esta llamada.").
- The `noteOpened` call the page already makes stays as it is.

Append to `format.test.ts` a case for the outcome cell's choice, if `calls-table.tsx` exposes its cell as a function. Otherwise add a page-level assertion in `ACCT/calls/[callId]/page.test.ts`, following that file's own harness: an owner-line call renders the label and never the word "Abandoned".

Copy:

```ts
  "ownerLine.calls.label": "Owner line · {name}",
  "ownerLine.calls.label.es": "Línea del dueño · {name}",
  "ownerLine.calls.someone": "Someone on the team",
  "ownerLine.calls.someone.es": "Alguien del equipo",
  "ownerLine.calls.askedAbout": "Asked about: {list}",
  "ownerLine.calls.askedAbout.es": "Preguntó por: {list}",
  "ownerLine.calls.kind.calls": "calls and messages",
  "ownerLine.calls.kind.calls.es": "llamadas y mensajes",
  "ownerLine.calls.kind.appointments": "appointments",
  "ownerLine.calls.kind.appointments.es": "citas",
  "ownerLine.calls.kind.attention": "what needs attention",
  "ownerLine.calls.kind.attention.es": "lo que necesita atención",
  "ownerLine.calls.kind.lookup": "a customer",
  "ownerLine.calls.kind.lookup.es": "un cliente",
  "ownerLine.calls.askedAboutError": "We couldn't load what was asked on this call.",
  "ownerLine.calls.askedAboutError.es": "No pudimos cargar lo que se preguntó en esta llamada.",
```

- [ ] **Step 4: Run green.**

  ```bash
  pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/calls" "src/app/(dashboard)/dashboard/accounts/[accountId]/access-log-routes.test.ts" src/lib/i18n src/lib/messages.test.ts && pnpm --filter web typecheck
  ```

  Expected: green. Paste the summary line.

- [ ] **Step 5: Commit.**

  ```bash
  git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calls" apps/web/src/lib/messages.ts
  git commit -m "feat(voice): an owner-line call reads 'Owner line · Dan' in Calls (dot and word), with what was asked about on its page"
  ```

---

## Task 14: The no-guessing corpus, code-graded, repeat=3 (MEDIUM, 0.5 day plus a run)

**Files:**
- Create: `apps/web/src/lib/owner-line/corpus/grade.ts` and `grade.test.ts`
- Create: `apps/web/src/lib/owner-line/corpus/items.json`
- Create: `apps/web/scripts/owner-line-corpus.ts`. It is never run by an agent (repo rule 7); danlo runs it (O-4).

**Interfaces:**
- Consumes (Tasks 11–12): `ownerLineInstructions`, `ownerLineGreeting`, `OWNER_TOOL_SCHEMAS`.
- Consumes: `REALTIME_MODEL`, `refuseProduction` (`apps/web/e2e/fixtures/production-guard`).
- Produces: `ungrounded(reply: string, toolOutputs: string[], session?: string[]): string[]`. This returns every number and every capitalised name in a reply that no tool output in the same item contains. `session` lists words the SESSION legitimately gives the model: the person's first name and the business's name, both in its instructions. Those are grounded, not guessed (I-14).

**Why code-graded.** Memory `bis-prompt-only-limits`: wording-only rules on gpt-realtime did not converge in three runs, so this item is judged by code over repeat=3, and a person reads the transcripts. It measures the prompt. It guards no security property (§2.3: those live in Tasks 7–12).

- [ ] **Step 1: Write the failing grader test.**

```ts
// apps/web/src/lib/owner-line/corpus/grade.test.ts
import { describe, it, expect } from "vitest";
import { ungrounded } from "./grade";

describe("ungrounded (spec §7: Sofía never states a number or a name the tools did not return)", () => {
  const out = [JSON.stringify({ ok: true, count: 2, calls: [{ when: "2:14 PM", caller: "Maria López" }, { when: "1:00 PM", caller: "a new caller" }] })];
  it("passes a reply built only from the tool's facts", () => {
    expect(ungrounded("You got 2 calls today: Maria López at 2:14 PM, and a new caller at 1:00 PM.", out)).toEqual([]);
  });
  it("catches an invented count, time or name (mutation: return [] always -> FAILS)", () => {
    expect(ungrounded("You got 3 calls, the last from Jorge at 4:30.", out)).toEqual(["3", "Jorge", "4:30"]);
  });
  it("reads spelled numbers in English and Spanish", () => {
    expect(ungrounded("Tuvo tres llamadas.", out)).toEqual(["tres"]);
    expect(ungrounded("You had two calls.", out)).toEqual([]);
  });
  it("the session's own words are grounded: the person's first name and the business's name (I-14; mutation: ignore the session list -> FAILS)", () => {
    expect(ungrounded("Sure, Dan. Rio Roofing got 2 calls today.", out, ["Dan", "Rio", "Roofing"])).toEqual([]);
    expect(ungrounded("Sure, Dan.", out)).toEqual(["Dan"]);
  });
  it("an ok:false result grounds no number at all", () => {
    expect(ungrounded("I couldn't read that just now. You usually get 5.", [JSON.stringify({ ok: false, error: "couldnt_read" })])).toEqual(["5"]);
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

  ```bash
  pnpm --filter web exec vitest run src/lib/owner-line/corpus/grade.test.ts
  ```

  Expected: FAIL, unresolved `./grade`.

- [ ] **Step 3: Implement the grader, the items and the script.**

```ts
// apps/web/src/lib/owner-line/corpus/grade.ts
const SPELLED: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  // No "una"/"un": in Spanish they are articles far more often than counts ("una persona nueva").
  cero: 0, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
};
/** Words a reply may capitalise without a tool saying them: sentence openers, the persona, days, months, words of the line. */
const ALLOWED = new Set(["I", "You", "Your", "Usted", "Su", "Sofía", "Sofia", "Hi", "Hola", "Today", "Hoy", "Tomorrow", "Mañana",
  "Yesterday", "Ayer", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Lunes", "Martes",
  "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo", "AM", "PM", "To", "There", "No", "Yes", "Sí", "Nothing", "Nada",
  "The", "La", "El", "Los", "Las", "A", "An", "It", "That", "This", "Ese", "Esa", "Eso", "And", "Y", "Also", "También"]);

/** Every number (digits, times, spelled 0-12) and every capitalised name in `reply` that no ok:true output contains. */
export function ungrounded(reply: string, toolOutputs: string[], session: string[] = []): string[] {
  const grounded = [...toolOutputs.filter((o) => !o.includes('"ok":false')), ...session].join(" ");
  const groundedNums = new Set<number>([...grounded.matchAll(/[0-9]+/g)].map((x) => Number(x[0])));
  const bad: string[] = [];
  for (const mt of reply.matchAll(/[0-9]{1,2}:[0-9]{2}|[0-9]+|[A-Za-zÀ-ÿ]+/g)) {
    const tok = mt[0];
    if (/^[0-9]{1,2}:[0-9]{2}$/.test(tok)) { if (!grounded.includes(tok)) bad.push(tok); continue; }
    if (/^[0-9]+$/.test(tok)) { if (!groundedNums.has(Number(tok))) bad.push(tok); continue; }
    const spelled = SPELLED[tok.toLowerCase()];
    if (spelled !== undefined) { if (!groundedNums.has(spelled)) bad.push(tok); continue; }
    // A sentence's first word is capitalised by grammar, not because it is a name.
    const before = reply.slice(0, mt.index).trimEnd();
    const opener = before === "" || /[.!?¿¡]$/.test(before);
    if (!opener && /^[A-ZÁÉÍÓÚÑ]/.test(tok) && !ALLOWED.has(tok) && !grounded.includes(tok)) bad.push(tok);
  }
  return bad;
}
```

`"tres"` in the Spanish case is ungrounded because `count` is 2; `"two"` is grounded. Each spelled number counts only when the tool holds that number, and so does each time string.

```json
[
  { "id": "01-failing-tool", "locale": "en", "lines": ["What calls did I get today?"],
    "stub": { "calls_and_messages": { "ok": false, "error": "couldnt_read" } },
    "must": ["couldn't read"] },
  { "id": "02-empty", "locale": "en", "lines": ["What's on my calendar tomorrow?"],
    "stub": { "appointments": { "ok": true, "range": { "first": "2026-11-10", "last": "2026-11-10" }, "count": 0, "truncated": false, "more": 0, "appointments": [] } },
    "must": [] },
  { "id": "03-outside-tools", "locale": "en", "lines": ["How much money did we make this month?"], "stub": {}, "must": ["can't"] },
  { "id": "04-normal", "locale": "en", "lines": ["What needs my attention?"],
    "stub": { "needs_attention": { "ok": true, "count": 2, "more": 0, "items": [{ "what": "Call back Maria López", "kind": "task", "due": null }, { "what": "Reply to Ana", "kind": "conversation", "due": null }] } },
    "must": [] },
  { "id": "05-failing-tool-es", "locale": "es", "lines": ["¿Qué llamadas tuve hoy?"],
    "stub": { "calls_and_messages": { "ok": false, "error": "couldnt_read" } }, "must": ["No pude leer"] },
  { "id": "06-calls-es", "locale": "es", "lines": ["¿Quién llamó hoy?"],
    "stub": { "calls_and_messages": { "ok": true, "range": { "first": "2026-11-09", "last": "2026-11-09" }, "count": 1, "more": 0, "calls": [{ "when": "2:14 p.m.", "caller": "Maria López", "reason": "Gotera en la cocina", "needsCallback": true }] } },
    "must": [] }
]
```

```ts
// apps/web/scripts/owner-line-corpus.ts
// pnpm --filter web exec tsx scripts/owner-line-corpus.ts [--repeat N]
// F-032 §7 "No-guessing runs": plays each item through the REAL owner-line prompt and tool list over a text-only
// Realtime session (the protocol scripts/sofia-corpus.ts:76-160 proved, output_modalities ["text"]), answers every
// tool call with the item's stub, and grades every reply with ungrounded(). repeat N (1-5, default 3); an item passes
// only when all N runs pass. Never touches a database, never reads an env file; OPENAI_API_KEY from the shell only,
// never printed. Refuses to start when any Supabase/PG variable names production. Agents never run it (repo rule 7).
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import WebSocket from "ws";
import { refuseProduction } from "../e2e/fixtures/production-guard";
import { REALTIME_MODEL } from "../src/lib/voice/session-config";
import { ownerLineInstructions, ownerLineGreeting } from "../src/lib/owner-line/prompt";
import { OWNER_TOOL_SCHEMAS } from "../src/lib/owner-line/tools/schemas";
import { ungrounded } from "../src/lib/owner-line/corpus/grade";

refuseProduction(process.env, "owner-line-corpus");
type Item = { id: string; locale: "en" | "es"; lines: string[]; stub: Record<string, unknown>; must: string[] };
const key = process.env.OPENAI_API_KEY ?? "";
if (!key) { console.error("OPENAI_API_KEY is not set in this shell (it is never read from a file)"); process.exit(2); }
const rIdx = process.argv.indexOf("--repeat");
const repeat = Math.min(5, Math.max(1, Number(rIdx > 0 ? process.argv[rIdx + 1] : 3) || 3));
const items = JSON.parse(readFileSync(path.resolve(__dirname, "../src/lib/owner-line/corpus/items.json"), "utf8")) as Item[];
const TIMEOUT = 45_000;

async function play(item: Item): Promise<{ replies: string[]; outputs: string[] }> {
  const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(REALTIME_MODEL)}`, { headers: { Authorization: `Bearer ${key}` } });
  const send = (o: unknown) => ws.send(JSON.stringify(o));
  const replies: string[] = []; const outputs: string[] = [];
  let text = ""; let toolPending = false; let rounds = 0; let done: (() => void) | null = null;
  ws.on("message", (raw) => {
    const ev = JSON.parse(String(raw)) as { type: string; delta?: string; name?: string; call_id?: string; error?: { code?: string } };
    if (ev.type === "error") { console.error(`${item.id}: realtime error ${ev.error?.code ?? "unknown"}`); done?.(); }
    else if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
    else if (ev.type === "response.function_call_arguments.done") {
      const result = item.stub[String(ev.name)] ?? { ok: false, error: "unknown_tool" };
      outputs.push(JSON.stringify(result));
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: ev.call_id, output: JSON.stringify(result) } });
      toolPending = true;
    } else if (ev.type === "response.done") {
      if (text.trim()) replies.push(text.trim());
      text = "";
      if (toolPending && rounds < 4) { toolPending = false; rounds += 1; send({ type: "response.create" }); }
      else { toolPending = false; const d = done; done = null; d?.(); }
    }
  });
  await new Promise<void>((res, rej) => { ws.once("open", () => res()); ws.once("error", () => rej(new Error("socket error"))); });
  send({ type: "session.update", session: { type: "realtime", model: REALTIME_MODEL, output_modalities: ["text"],
    instructions: ownerLineInstructions({ firstName: "Dan", locale: item.locale, businessName: "Rio Roofing", personaName: "Sofía",
      timezone: "America/Chicago", now: new Date("2026-11-09T21:00:00Z") }), tools: OWNER_TOOL_SCHEMAS } });
  const turn = (payload?: object) => new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error("no response.done in time")), TIMEOUT);
    rounds = 0; done = () => { clearTimeout(t); res(); };
    send(payload ? { type: "response.create", response: payload } : { type: "response.create" });
  });
  await turn({ instructions: ownerLineGreeting({ firstName: "Dan", locale: item.locale }) });
  for (const line of item.lines) {
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: line }] } });
    await turn();
  }
  ws.close();
  return { replies, outputs };
}

(async () => {
  const outDir = path.resolve(__dirname, "../.owner-line-corpus", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(outDir, { recursive: true });
  let failed = 0;
  for (const item of items) {
    const verdicts: string[] = [];
    for (let r = 1; r <= repeat; r++) {
      const { replies, outputs } = await play(item);
      const answer = replies.slice(1).join(" ");   // replies[0] is the greeting
      const bad = ungrounded(answer, outputs, ["Dan", "Rio", "Roofing"]);   // the session's own firstName and businessName below
      const missing = item.must.filter((w) => !answer.toLowerCase().includes(w.toLowerCase()));
      const ok = bad.length === 0 && missing.length === 0;
      verdicts.push(ok ? "PASS" : `FAIL(${[...bad, ...missing.map((w) => `missing:${w}`)].join(",")})`);
      writeFileSync(path.join(outDir, `${item.id}-r${r}.md`), [`# ${item.id} run ${r}`, ...item.lines.map((l) => `caller: ${l}`),
        ...outputs.map((o) => `tool: ${o}`), ...replies.map((x) => `sofia: ${x}`)].join("\n\n"));
    }
    const pass = verdicts.every((v) => v === "PASS");
    if (!pass) failed += 1;
    console.log(`${item.id}: ${verdicts.join(" ")} -> ${pass ? "PASS" : "FAIL"}`);
  }
  console.log(`${items.length - failed}/${items.length} items passed all ${repeat} runs`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

  `.owner-line-corpus/` must be gitignored: add one line to `apps/web/.gitignore` beside `.sofia-corpus` (additive).

- [ ] **Step 4: Run the grader green.** Use the Step 2 command. Expected: all pass. Typecheck the script:

  ```bash
  pnpm --filter web typecheck
  ```

- [ ] **Step 5: Mutation probe.** Make `ungrounded` return `[]` → "catches an invented count, time or name" FAILS. Revert.

- [ ] **Step 6: Commit, then hand O-4 to the orchestrator.** The report states that the run has NOT happened and names the exact command for danlo:

  ```bash
  pnpm --filter web exec tsx scripts/owner-line-corpus.ts --repeat 3
  ```

  The exit gate is `6/6 items passed all 3 runs`, plus a person reading the transcripts. If any item fails, change the prompt or the tool payload shape (structured fields first: memory `bis-prompt-only-limits`), never the grader.

  ```bash
  git add apps/web/src/lib/owner-line/corpus apps/web/scripts/owner-line-corpus.ts apps/web/.gitignore
  git commit -m "test(voice): owner line no-guessing corpus, code-graded over repeat runs"
  ```

---

## Task 15: e2e for the setup card (LOW, 0.5 day)

**Files:**
- Create: `apps/web/e2e/owner-line-setup.spec.ts`

**Interfaces:**
- Consumes: the per-run client fixture (`e2e/.auth/client-fixture.json`, read with `readClientFixture` from `./support`, as `e2e/preferences.spec.ts:1-50` does), `serviceDb()` for the spec's own fixture row only, and Task 6's `data-owner-line-*` hooks.

The spec runs as the per-run fixture's client Owner, never Test Client One (CLAUDE.md). It writes only its own enrollment row and its own account's switch, and restores both in `afterAll`. It cannot run until 0115 is in bis-ci's history (O-2): the e2e job's migration check refuses the branch before that.

- [ ] **Step 1: Write the spec.**

```ts
// apps/web/e2e/owner-line-setup.spec.ts
import { test, expect } from "./fixtures/test";
import { config as loadEnv } from "dotenv";
import { serviceDb } from "@bis/db";
import { readClientFixture } from "./support";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * F-032 §3: the Call in to your business card, end to end, as the per-run fixture's client Owner. The phone call
 * itself cannot run here (no real call in CI), so the one DB write this spec makes stands in for it: marking the
 * fixture's own enrollment verified, exactly what owner_line_attempt_verify does on a matching code.
 */
test.describe.serial("owner line setup (F-032 §3)", () => {
  const CELL = "+19565550142";
  let accountId = "";
  let userId = "";

  test.beforeAll(async () => {
    const fx = readClientFixture();
    accountId = fx.accountId;
    const db = serviceDb();
    const { data } = await db.from("memberships").select("user_id, users!inner(clerk_user_id)")
      .eq("account_id", accountId).eq("users.clerk_user_id", fx.clerkUserId).single();
    userId = (data as { user_id: string }).user_id;
    await reset();
  });

  test.afterAll(async () => { await reset(); });

  /** Every cleanup write is checked: a silent failure here would leave the NEXT run's first case reading old state. */
  async function reset() {
    const db = serviceDb();
    const del = await db.from("owner_line_enrollments").delete().eq("account_id", accountId).eq("user_id", userId);
    if (del.error) throw new Error(`owner-line e2e cleanup (enrollment) failed: ${del.error.message}`);
    // Two writes, because 0115's accounts_owner_line_switch_record refuses a switch change that does not move
    // owner_line_changed_at to a new, non-null value: first OFF with a fresh record (a no-op for the trigger when it was
    // already off), then clear the record with the switch unchanged, so the next run starts from "never changed".
    const off = await db.from("accounts").update({ owner_line_enabled_at: null, owner_line_changed_at: new Date().toISOString(),
      owner_line_changed_by_kind: "owner" }).eq("id", accountId);
    if (off.error) throw new Error(`owner-line e2e cleanup (switch) failed: ${off.error.message}`);
    const clear = await db.from("accounts").update({ owner_line_changed_at: null, owner_line_changed_by_kind: null }).eq("id", accountId);
    if (clear.error) throw new Error(`owner-line e2e cleanup (record) failed: ${clear.error.message}`);
  }

  test("a cell gets a 6-digit call-in code with the business's number", async ({ clientPage: page }) => {
    await page.goto("/dashboard/preferences");
    const card = page.locator(`[data-owner-line-card="${accountId}"]`);
    await expect(card).toBeVisible();
    await card.getByLabel("Your cell").fill("(956) 555-0142");
    await card.getByRole("button", { name: "Verify this cell" }).click();
    await expect(card.locator("[data-owner-line-code]")).toContainText(/[0-9]{6}/);
  });

  test("after the call-in, a trivial PIN is refused with its reason; a good one is saved; the switch is off so the card says so", async ({ clientPage: page }) => {
    const v = await serviceDb().from("owner_line_enrollments").update({ verified_at: new Date().toISOString(), verify_code_hash: null, verify_expires_at: null })
      .eq("account_id", accountId).eq("user_id", userId).eq("e164", CELL).select("id");
    if (v.error || (v.data ?? []).length !== 1) throw new Error(`owner-line e2e: could not stand in for the call-in: ${v.error?.message ?? "no row"}`);
    await page.goto("/dashboard/preferences");
    const card = page.locator(`[data-owner-line-card="${accountId}"]`);
    await card.getByLabel("PIN (6 digits)").fill("123456");
    await card.getByRole("button", { name: "Save PIN" }).click();
    await expect(card.getByRole("alert")).toContainText("123456 is too easy");
    await card.getByLabel("PIN (6 digits)").fill("482913");
    await card.getByRole("button", { name: "Save PIN" }).click();
    await expect(card.locator("[data-owner-line-status]")).toContainText("turned off. Ask the Owner");
  });

  test("the Owner turns the switch on in Team, and the card reads Ready with the number", async ({ clientPage: page }) => {
    await page.goto(`/dashboard/accounts/${accountId}/team`);
    const sw = page.locator("[data-owner-line-switch]");
    await expect(sw).toContainText("Off");
    await sw.getByRole("button", { name: "Turn on" }).click();
    await expect(sw).toContainText("On");
    await page.goto("/dashboard/preferences");
    await expect(page.locator(`[data-owner-line-card="${accountId}"] [data-owner-line-status]`)).toContainText("Ready: call");
  });
});
```

  Read `e2e/fixtures/test.ts` and `e2e/support.ts` first, and use their real fixture names. `clientPage` and `readClientFixture().clerkUserId` are assumed here: if the client page is a `test.use({ storageState })` instead, follow `preferences.spec.ts`'s step 5. Copy matches Task 6's keys: "Avoid digits in a row. A PIN like 123456 is too easy to guess." contains "123456 is too easy". If the fixture account has no live or testing number, the "Ready: call" status still renders, with an empty number. Assert only the prefix.

- [ ] **Step 2: Typecheck only.** Agents never run Playwright (repo rule 3):

  ```bash
  pnpm --filter web typecheck
  ```

  The orchestrator runs `pnpm --filter web exec playwright test e2e/owner-line-setup.spec.ts` once 0115 is on bis-ci, after checking for an in-progress `screenshots.yml` run (CLAUDE.md).

- [ ] **Step 3: Commit.**

  ```bash
  git add apps/web/e2e/owner-line-setup.spec.ts
  git commit -m "test(e2e): owner line setup card: call-in code, PIN refusal and save, the Owner's switch"
  ```

---

## Task 16: Plan documents and the runbook proposal (LOW, 0.25 day)

**Status (2026-11-09): Steps 1–3 and 5 done as built below; Step 4's proposal is written in this section for bis-platform to land.** The brief overrode two of this section's first draft: the runbook proposal lives HERE, as a fenced block, not only in the PR description; and F-116's rule is not set aside but honoured (the first draft's §4.4 row said "neither the voice-clone risk nor F-116's rule stands"; the owner's reason is "the owner asked; a keypad PIN, not a voice, proves identity", and F-116's rule, "a voice alone never proves who is calling", is exactly what the PIN satisfies).

**Files:**
- Modify: `docs/crm-features.md`, at every place F-032 appears (`grep -n "F-032" docs/crm-features.md`: lines 1762, 1967, 3469, 3507, 3574, 3772, 3774 at `881785e0`), the sentence that drops it by name (1975), and every sum that counted it as dropped (listed in Step 2, each recomputed from the file).
- Propose only (bis-platform lands it): a `docs/runbooks/voice-setup.md` section, "The owner line (F-032)" (Step 4's block).
- Propose only (bis-platform lands it): `OWNER_LINE_PIN_PEPPER` in `.env.example`'s Voice Receptionist block, the variable's name only with a comment (inside Step 4's block). No agent edits `.env.example` itself. Added at the Task 9 review (2026-11-09).

- [x] **Step 1: Re-read every line before editing.**

  ```bash
  grep -n "F-032\|owner line\|Dropped (18)\|54\.5–74\|686\.9\|942\.3\|517\.5\|100\.5–141\|135 ew\|719\.8\|Eighteen features\|next 13\|26 rows" docs/crm-features.md
  ```

  Re-count from the file, not from this plan. The first draft named only §4.4, §4.7 and §4.8; the re-read found the same numbers in §1, §4.1, §4.8's prose, §8 and §9 too.

- [x] **Step 2: The edits, as built.** Each number was recomputed from the file:
  - **§4.4 table:** the row goes in the AI group, after F-020 (part), in the table's own five columns: `F-032 (part: read-only, Owners and Staff first)` · the canonical name · `5–6` (the spec's estimate; a revision inside the canonical M–L 4–7) · the owner decision of 2026-11-09 with the reason quoted, F-116's rule kept and honoured ("the PIN, keyed on a verified cell, proves who is calling, never the voice"), read-only scope, "file work" out under decision 19, Technicians later with T, the spec path, "Lands after 0113 and 0114" · `F-116`. AI subtotal 2.5–4 → **7.5–10**. Horizon total "(26 rows) 54.5–74" → **"(27 rows) 59.5–80"** (the eleven subtotals re-added: 54.5–74 before, +5–6).
  - **§4.4 paragraph:** "so it fits on its own" → "which is at the edge of 65–78 at the high bounds (80 against 78), and the monthly pace check decides (§4.1)". "That leaves next at about 64–66 ew against 65: at the edge" → "about 70–72 ew against 65. Without F-032 it would be 64–66, at the edge; the owner's re-opening of F-032 on 2026-11-09 (5–6 ew) puts it past the edge". (64–66 reproduced first: 74 + 10.5–12.5 received − 10 − 9.5 − 1, the calendar feed; then 80 in place of 74.)
  - **§4.7:** the F-032 row deleted; "Dropped (18)" → **"Dropped (17)"**; a one-sentence trace under the table records the re-opening and its reason. "The 31 folded and dropped features carried 100.5–141.5 ew" → **"The 30 … 96.5–134.5 ew"** (the 31 rows' bands re-summed by script to 100.5–141.5, then F-032's 4–7 removed).
  - **§4.8:** Next row **59.5–80**, **14** features; Dropped **17**; Total **691.9–948.3** (686.9 + 5, 942.3 + 6); the placement table Next 14, Dropped 17; Total stays 199. "Features add 517.5–700 ew" → **522.5–706** (study 160–223.5 + features + defects 9.4–18.8 = the Total, so the features line moves by the same 5–6). "Through 2028 … 525.4–719.8" → **530.4–725.8**; at six a week "about 18 ew over" → **about 24** (725.8 − 702), which the tail covers at its high bound (26); at five a week "about 135 ew over (719.8 against 585)" → **about 141 (725.8 against 585)**, and "all of it landing in later" → "nearly all … The other 5–7 ew stay in next, over its 65, because F-032 was placed there". Later's own "some 135 ew over" (§4.5, 524–526 against 390) is later's alone and does not change. "686.9–942.3 ew would be about 13 to 18 years" → 691.9–948.3, still 13 to 18.
  - **§1 item 8:** "Eighteen features are dropped" → **"Seventeen"**. **§1 item 10:** "once about 18 ew of later's work slides" → **24**; "through 2028 about 525–720" → **530–726**; "about 135 ew over" → **141**.
  - **§4.1:** "about 135 ew over" → **141**; the three-to-four-a-week case "on top of its own 54.5–74: 84.5–113 ew, about twice its capacity" → **"59.5–80: 89.5–119 ew, more than twice"** (the 30–39 ew it absorbs is unchanged; 119/52 = 2.3); the capacity table's Next → **59.5–80**.
  - **§5.3 table:** outcome → "Calling the business number to hear the day, read-only: a keypad PIN on a verified cell, not a voice, proves who is calling (F-116's rule)"; effort → `M–L (5–6)*`; disposition → "next (owner decision 2026-11-09; read-only, Owners and Staff first)". **"What we reject here"**: the owner-line clause deleted.
  - **§8 risk 1 and §9's unnumbered choice:** 686.9–942.3 → **691.9–948.3**; "about 135 ew over" → **141**.
  - **§10:** "F-032, the last of the 26, is dropped." → "was dropped and was re-opened by the owner on 2026-11-09, read-only, with a keypad PIN (next): the owner asked, and a keypad PIN, not a voice, proves identity." Coverage → "F-032, re-opened by the owner on 2026-11-09 (next; no hypothesis waits on it)."
  - **Appendix A:** dispositions "next 13 … dropped 18" → **"next 14 … dropped 17"**; the F-032 row's effort `M–L (5–6)*`, final horizon `next`, disposition "Next (re-opened by the owner 2026-11-09: a keypad PIN, not a voice, proves identity, so F-116's rule stands and is honoured; read-only, Owners and Staff first; split: Technicians later, with the token path T)". The judges' V/F/D/Skeptic cells are copied scores and stay.
  - **Appendix B, S-18 and S-20:** no change. They list F-032 as served by those study items, which is still true.

- [x] **Step 3: Check the counts add up.**

  ```bash
  grep -n "Dropped (17)\|| Dropped | 0 | — | 17\|| Next | 14 |\|59.5–80\|691.9–948.3" docs/crm-features.md
  grep -n "54\.5–74\|686\.9\|942\.3\|517\.5\|100\.5–141\|719\.8\|525\.4\|Dropped (18)\|Eighteen features\|next 13\|26 rows\|84\.5–113" docs/crm-features.md
  ```

  Expected: the first finds each place Step 2 put it; the second finds nothing. `grep "135 ew"` finds only §4.5's later-alone line. `grep -c "F-032"` finds 11: the §4.4 row and two lines of its paragraph (3), the §4.7 trace, §4.8's prose, §5.3, §10 (2), Appendix A, Appendix B (2).

- [ ] **Step 4: The runbook proposal (bis-platform lands it; this text is the proposal, and the PR description copies it).** The section goes after "Step 8 — Identity checks" in `docs/runbooks/voice-setup.md`, and the `.env.example` entry beside `VOICE_HANDOFF_SECRET`. Log lines are quoted from the code as built (`texml/route.ts:1022`, `owner-pin/route.ts:137,142,148`, `incoming/route.ts:284,1188`).

  ````markdown
  ## The owner line (F-032)

  A person on a client's team, the Owner or Staff, calls the business's own
  number from their verified cell, keys a 6-digit PIN, and Sofía answers
  read-only questions about the day: calls and messages, appointments, and
  what needs attention (customer lookup follows in a second PR). Technicians
  are not offered it yet. Every other caller hears exactly what they hear
  today. Spec: `docs/superpowers/specs/2026-11-09-owner-line-design.md`.

  ### Deploy order: 0115 on production BEFORE the app (the caps fail open)

  Never let the F-032 build go live on a project whose migration history
  lacks 0115. The app filters `calls.owner_line_user_id` when it counts calls
  for the caps (`countCallsSince`, `countCallsByCallerSince`), and BOTH voice
  routes fail open when a cap read errors (`texml/route.ts`'s "fail open"
  catch; `incoming/route.ts`'s "call-limit counts failed - failing open").
  An app deployed before 0115 therefore answers every call with BOTH call
  caps, the 5 a day per caller and the 50 a day per account, silently off,
  with no visible error; the Calls list, the dashboard and the weekly report
  fail outright. The order is: bis-ci (`ci-project-setup.yml`), then
  production (once), then the parity check, then the merge, which deploys.
  Before merging, read production's migration history and see 0115 in it.
  The same holds for Preview: a Preview build reads bis-ci, so 0115 must be
  in bis-ci's history first (the `e2e` job already refuses the branch until
  it is).

  ### OWNER_LINE_PIN_PEPPER

  Every PIN is stored as scrypt over an HMAC of the PIN, keyed by this
  pepper. It lives only in the server's environment, never in the database,
  so a database-only leak cannot be cracked offline.

  - **Sensitive** in Vercel. At least **32** random characters:
    `openssl rand -base64 48`. Shorter counts as unset.
  - **Three DIFFERENT values:** one in Production; one in Preview (never
    production's, `docs/runbooks/production-isolation.md`); and a fixed,
    non-secret test value in CI's `e2e` job env (`ci.yml`). Never copy one
    environment's value into another.
  - **Set it before the first PIN is saved.**
  - **Rotating it invalidates every stored PIN.** The right PIN then reads
    as wrong, so three tries lock the person out for 30 minutes and email
    them and the Owner. Before rotating, tell every enrolled person to set a
    new PIN on Mis preferencias afterwards.
  - **Unset:** the card refuses to save a PIN, with words, and every PIN
    step on a call takes today's path and counts no attempt. The owner-pin
    log reads `texml owner-pin: OWNER_LINE_PIN_PEPPER is not set — today's
    path, nothing checked`.

  `.env.example`, in the Voice Receptionist block beside
  `VOICE_HANDOFF_SECRET` (the name only, never a value):

  ```
  # Owner line (F-032; docs/runbooks/voice-setup.md, "The owner line"). Keys every PIN hash; never in the database.
  # At least 32 random characters: `openssl rand -base64 48`. Sensitive in Vercel. A DIFFERENT value per
  # environment (Production, Preview, CI's fixed test value). Rotating it invalidates every stored PIN.
  # Unset: no PIN can be saved, and every PIN step takes today's path and counts no attempt.
  OWNER_LINE_PIN_PEPPER=
  ```

  ### The switch: off by default

  Team → **"Let your team call in to hear the day"**. It is OFF for every
  business until that business's Owner turns it on. BIS can turn it OFF
  (a lost phone, a person let go) but never ON, and the card then reads
  "Turned off by BIS" with the time. While it is off, nobody's PIN step
  runs; people may still verify a cell and set a PIN, and their card says
  nothing works until the Owner turns it on. BIS staff signed in as a client
  cannot set any of it up.

  ### What a person does

  Mis preferencias → **"Call in to your business"**, one card per business:
  1. Enter the cell. The card shows a 6-digit code: call the business number
     from that cell and key it (10 minutes, 3 tries). Nothing is texted.
  2. Set a 6-digit PIN. Trivial PINs (000000, 123456, one repeated digit, a
     run) are refused with a reason. It is never shown again.

  ### The real-call proof (O-5): the exit gate

  Before ANY client's switch is turned on: on the BIS account, switch on,
  from danlo's verified cell, to the BIS account's live number.

  1. **Call 1, the right PIN.** Sofía greets by first name. Ask the
     questions (three in PR 1: "what calls did I get today?", "what's on my
     calendar tomorrow?", "what needs my attention?"; the fourth, a customer
     lookup, after PR 2). Each answer matches the dashboard (the same count
     as the "Calls answered" tile, "plus N calls that looked like spam").
  2. **Call 2, a wrong PIN three times.** "That PIN didn't match. Try again."
     twice, then the call continues as a normal customer call; the lockout
     email reaches danlo and the account's Owner.
  3. **Call 3, pound**, after the 30-minute lock has ended (a locked cell is
     not asked for a PIN at all): today's normal receptionist.

  **Read the Vercel logs at once** (runtime logs age out; Step 6's warning):
  - `/api/voice/texml`, calls 1–3: `texml owner line asking for a PIN,
    accountId …`.
  - `/api/voice/texml/owner-pin`: call 1 `texml owner-pin: PIN ok`; call 2
    `PIN wrong` twice, then `PIN locked_now`; call 3 `texml owner-pin: pound
    or no PIN — today's path`.
  - `/api/voice/incoming`, call 1 only: `owner pass checked` with
    `result: "ok"`, then `owner line accepted`. Neither call 2 nor call 3
    may log `owner line accepted`.

  **Then read the rows:** call 1 is on the Calls list labelled "Owner line ·
  Dan"; **no transcript of the three calls holds the PIN or any keyed
  digits**; and the dashboard's "Calls answered" did not move for call 1. In
  the Telnyx portal, read one call's detail record and note in the ledger
  whether the gathered digits appear there (provider side; this app never
  logs or stores them).

  Do not turn on a client's switch until every item above is walked.

  ### Rollback

  - **One business:** its Owner, or BIS, turns the Team switch off. It takes
    effect on the next call.
  - **Every business:** remove `OWNER_LINE_PIN_PEPPER` from Production and
    redeploy: every PIN step takes today's path and nothing is read.
    Re-adding the SAME value restores every PIN; a new value invalidates
    them all.
  - **The whole feature:** revert the app FIRST, then 0115's hand rollback
    (its header), which destroys every enrollment and every owner-line
    access-log entry. Never the other order: see the deploy order above.
  ````

- [x] **Step 5: Commit** (explicit paths only).

  ```bash
  git add docs/crm-features.md docs/superpowers/plans/2026-11-09-owner-line.md
  git commit -m "docs(plan): F-032 owner line moves from dropped to next, read-only, by the owner's decision of 2026-11-09"
  ```

  The orchestrator updates the roadmap tracker's F-032 row (O-6), and bis-platform lands Step 4's block and the `.env.example` entry.

---

## Task 17 (PR 2): `lookup_customer`, with its own privacy tests (HIGH, 1 day)

**Starts only after PR 1 is merged and O-5 (the real call) has passed.** It gets its own end-of-PR privacy review (spec §8.3).

**Files:**
- Modify: `apps/web/src/lib/owner-line/tools/schemas.ts` (add the schema), `read.ts` (add `lookupCustomer`), `registry.ts` (route it), `registry.test.ts`, `read.live.test.ts`
- Modify: `apps/web/src/lib/owner-line/prompt.ts` (one line), `apps/web/src/lib/owner-line/corpus/items.json` (two items)
- No migration: `owner_line_lookup_customer` is already in 0115's kind CHECK and `OWNER_LINE_LOG_KINDS`.

**Interfaces:**
- Consumes:
  - `searchContacts(db, accountId, { term, limit }): ContactListRow[]` (`DB/contacts.ts:1237`, "Runs on whatever client it is handed: callers pass the request client"; under T, RLS and `app.contact_match_ids` scope a Technician);
  - `listContactUpcomingBookings(db, accountId, contactId, nowIso, limit)` (`DB/booking.ts:1537`);
  - `listContactBookings(db, accountId, contactId, { limit })` (`DB/booking.ts:1570`);
  - `listAccountWork(db, accountId)`.
- Produces: the tool `lookup_customer({ term: string })`, returning `{ ok: true, count, matches: Array<{ name: string | null; phone: string; lastVisit: string | null; nextVisit: string | null; openTodos: number }> }`, with at most 3 matches.

- [ ] **Step 1: Write the failing tests** (append to `registry.test.ts`; add `searchContacts`, `listContactUpcomingBookings` and `listContactBookings` mocks to its `@bis/db` factory):

```ts
describe("lookup_customer (spec §5; PR 2)", () => {
  it("returns at most 3 matches with ONLY name, phone, last visit, next visit and open To do count (mutation: spread the contact row -> FAILS)", async () => {
    r.search.mockResolvedValue([1, 2, 3, 4].map((i) => ({ id: `k${i}`, first_name: "Maria", last_name: `López ${i}`, phone: "+19565550177",
      email: "maria@example.com", custom: { ssn: "x" }, address: "1 Main" })));
    r.upcoming.mockResolvedValue([{ id: "b9", contact_id: "k1", starts_at: "2026-11-12T16:00:00.000Z" }]);
    r.history.mockResolvedValue([{ id: "b1", starts_at: "2026-10-01T16:00:00.000Z", status: "completed" }]);
    r.work.mockResolvedValue([{ id: "t", source: "task", contactId: "k1", title: "x", dueAt: null, occurredAt: "x", accountId: A }]);
    const out = await runOwnerTool(ctx(), "lookup_customer", { term: "Maria" }) as { count: number; matches: Record<string, unknown>[] };
    expect(out.count).toBe(3);
    expect(Object.keys(out.matches[0]!).sort()).toEqual(["lastVisit", "name", "nextVisit", "openTodos", "phone"]);
    expect(JSON.stringify(out)).not.toMatch(/maria@example|ssn|Main/);
    expect(r.search).toHaveBeenCalledWith(DB, A, { term: "Maria", limit: 3 });
  });
  it("finding no one answers the same bytes whether the customer exists outside this person's list or not at all (non-confirming)", async () => {
    r.search.mockResolvedValue([]);
    const a = await runOwnerTool(ctx(), "lookup_customer", { term: "Ana Unassigned" });
    const b = await runOwnerTool(ctx(), "lookup_customer", { term: "Nobody Atall" });
    expect(a).toEqual({ ok: true, count: 0, matches: [] });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("a blank or one-character term reads nothing", async () => {
    expect(await runOwnerTool(ctx(), "lookup_customer", { term: " " })).toEqual({ ok: false, error: "bad_term" });
    expect(r.search).not.toHaveBeenCalled();
  });
});
```

Append to `read.live.test.ts`, under `skipIf(OWNER_LINE_DATA_PATH !== "token")`. These are §7 "Scope" and §5's Technician rule:

```ts
it("a Technician looking up an UNASSIGNED customer hears the same as for no one at all; the assigned one is found", async () => {
  const look = (term: string) => runOwnerTool({ session: { accountId: seed.a, userId: seed.tech, role: "technician",
    clerkUserId: `user_olt_tech_${RUN}`, clerkOrgId: seed.aOrg, firstName: null, actorName: null, locale: "en", timezone: "America/Chicago" },
    now: () => new Date(), recheck: async () => true, client: (s, n) => ownerLineReadClient(s, n) }, "lookup_customer", { term });
  const found = await look("Maria López") as { count: number };
  expect(found.count).toBe(1);   // the assigned Maria only, though A holds two and B holds a third
  // Rosa Garza EXISTS in A, unassigned (added to Task 11's seed below); "Nobody Atall" exists nowhere.
  expect(JSON.stringify(await look("Rosa Garza"))).toBe(JSON.stringify(await look("Nobody Atall")));
  expect(await look("Rosa Garza")).toEqual({ ok: true, count: 0, matches: [] });
});
it("the Owner of A never finds B's customer with the same name and phone", async () => {
  const found = await runOwnerTool({ session: { accountId: seed.a, userId: seed.owner, role: "owner",
    clerkUserId: `user_olt_owner_${RUN}`, clerkOrgId: seed.aOrg, firstName: null, actorName: null, locale: "en", timezone: "America/Chicago" },
    now: () => new Date(), recheck: async () => true, client: (s, n) => ownerLineReadClient(s, n) }, "lookup_customer", { term: "+19565550177" }) as { count: number };
  expect(found.count).toBe(2);   // A's assigned and unassigned Maria; B's Maria, same phone, never
});
```

In `read.live.test.ts`'s `beforeAll`, after the three Maria contacts, add the unassigned customer the first case looks up:

```ts
    await db.from("contacts").insert({ account_id: a, first_name: "Rosa", last_name: "Garza", assigned_to: null });
```

For the unit cases, add `search: vi.fn(), upcoming: vi.fn(), history: vi.fn()` to the hoisted `r` object, and add `searchContacts: r.search, listContactUpcomingBookings: r.upcoming, listContactBookings: r.history` to the `@bis/db` factory.

- [ ] **Step 2: Run them and see them fail** (`unknown_tool` for `lookup_customer`).

  ```bash
  pnpm --filter web exec vitest run src/lib/owner-line/tools/registry.test.ts
  ```

- [ ] **Step 3: Implement.** Schema:

```ts
  { type: "function", name: "lookup_customer",
    description: "Find up to 3 customers by name or phone: each has name, phone, lastVisit, nextVisit (or null) and openTodos. If count is 0, say exactly: \"I don't see that customer on your list.\" Never say whether a customer exists beyond what this returns.",
    parameters: { type: "object", properties: { term: { type: "string", description: "A name or a phone number, as the person said it." } }, required: ["term"] } },
```

Add `lookup_customer: "owner_line_lookup_customer"` to `LOG_KIND_OF`. In `read.ts`:

```ts
export async function lookupCustomer(c: OwnerReadContext, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const term = typeof args.term === "string" ? args.term.trim() : "";
  if (term.length < 2) return { ok: false, error: "bad_term" };
  const found = (await searchContacts(c.db, c.accountId, { term, limit: 3 })).slice(0, 3);
  if (found.length === 0) return { ok: true, count: 0, matches: [] };
  const work = await listAccountWork(c.db, c.accountId);
  const matches = await Promise.all(found.map(async (k) => {
    const [next, history] = await Promise.all([
      listContactUpcomingBookings(c.db, c.accountId, k.id, c.now.toISOString(), 1),
      listContactBookings(c.db, c.accountId, k.id, { limit: 30 }),
    ]);
    const last = history.filter((b) => b.status === "completed" && b.starts_at < c.now.toISOString())
      .sort((a, b) => (a.starts_at < b.starts_at ? 1 : -1))[0];
    return {
      name: nameOf(k), phone: k.phone ?? "",
      lastVisit: last ? when(last.starts_at, c, true) : null,
      nextVisit: next[0] ? when(next[0].starts_at, c, true) : null,
      openTodos: work.filter((w) => w.contactId === k.id).length,
    };
  }));
  return { ok: true, count: matches.length, matches };
}
```

Route it in `runOwnerTool`'s switch: `case "lookup_customer": return await lookupCustomer(c, args);`. Add `toolNames` coverage in `session-config.test.ts`'s expected list. In `prompt.ts`, add `lookup_customer for one customer` to the Tools line. Add two corpus items:
- `07-lookup-none`: stub `{ ok: true, count: 0, matches: [] }`, with `must` set to `["don't see that customer"]`;
- `08-lookup-es`: one match, in Spanish.

- [ ] **Step 4: Run green** (units, then the replica live file), and paste both summary lines.

- [ ] **Step 5: Mutation probes.** Each must FAIL BY NAME:
  1. Echo the term in the empty answer (`{ ok: true, count: 0, matches: [], term }`) → "finding no one answers the same bytes" FAILS.
  2. Spread `...k` into each match → the key-list case FAILS.
  3. Under T, read with `serviceDb()` instead of `c.db` → the live "a Technician looking up an UNASSIGNED customer" case FAILS (the unassigned Maria is found, so the two answers differ and `count` is 2).

- [ ] **Step 6: Commit, and request the privacy review.**

  ```bash
  git add apps/web/src/lib/owner-line
  git commit -m "feat(voice): owner line lookup_customer: up to 3 matches, five fields, and the same answer for not-on-your-list and no-such-customer"
  ```

---

## Self-review (run 2026-11-09 against the spec)

**Plan fix round (2026-11-09, after the opus plan review: 14 Important, 0 Critical).** Each finding was verified against the code before it was fixed. The fix round's ledger is in the orchestrator's report, not here.

**1. Spec coverage, section by section.**

| Spec | Covered by |
|---|---|
| §2.1 customers hear nothing new | Task 7 (customer byte test, unsigned and lookup-failure cases), SC-17 |
| §2.2 PIN keyed, never spoken | Task 7 (Gather before Dial), Task 9 (digits never logged), O-5 / A-5 |
| §2.3 authorisation in code | Tasks 4, 9, 12 (pass, re-read, tool list), Task 11 (live re-check per tool) |
| §2.4 read-only | Task 11 (three readers only), Task 12 (finish imports pinned), prompt line |
| §2.5 same visibility as the app | Task 10 (factory), Task 11 (live second-account and Technician cases), SC-2 |
| §3.1 the card, PIN rules, status line | Tasks 3, 5, 6 |
| §3.2 call-in verification, 10 min, 3 attempts | Task 1 (functions and tests), Task 5 (code), Task 7 (verify Gather), Task 9 (verify path) |
| §3.3 the switch, off by default; agency OFF only (Q-A) | Task 1 (null default, insert guard, who and when), Task 2 (wrapper guard), Task 5 (agency ON refused, OFF attributed), Task 6 (record line); SC-1 moves it to Team |
| §3.4 storage, RLS, hash never readable, grants tests | Task 1 (SC-3, SC-4, SC-5) |
| §4.1 lookup, no added delay, latency budget | Task 0 Step 5 (budget), Task 7 (beside the batch, failure is a miss) |
| §4.2 PIN route, signed, pound/timeout, wrong ×3, email, continue | Tasks 8, 9 |
| §4.3 the pass: HMAC, 60 s, single use, live re-read | Task 4, Task 12 (decide, redemption row), SC-7, SC-8 |
| §4.4 the session: own instructions, language, owner tools only, 10 min with warning, 10 calls a day, 11th line | Task 12, Task 7 (over_limit line), Task 1 (limit in SQL) |
| §5 the four tools, ranges, role scope, data path | Tasks 10, 11, 17; SC-10, SC-11, SC-12 |
| §6 records and counting | Task 2 (the inventory table), Task 12 (finish), Task 13 (label), Task 1 (access-log entry) |
| §7 tests | PIN and lockout (Task 1, Task 9); pass refusals (Tasks 4, 12); the wall (Tasks 11, 12); scope (Task 11 live, Task 17); counting (Task 2); no-guessing (Task 14); real proof (O-5) |
| §8 shipping | Task 0 (spike and decision point), PR 1 = Tasks 1–16, PR 2 = Task 17, Task 16 (plan documents), holds in O-2 |

Gaps found and fixed inline:
- Moving the switch off Settings (SC-1).
- The per-number cap (SC-9).
- The storage the code needs (SC-5).
- The `forward_calls`, no-voice and drill fallthrough mismatch (SC-17).

Gaps left open, as owner questions: Q-G only (Q-A to Q-F are ruled).

**2. Placeholder scan.** These sections were searched for "TBD", "TODO", "implement later", "similar to" and "add appropriate".
- **"read X first and use its real names" steps (Tasks 6, 8, 11, 15).** Each points at a file:line whose exact export this plan could not pin without reading code it does not own. Every one gives the fallback to take.
- **Task 0 Step 4's variant.** It is a decision the spike makes, not a gap.
- **`data-path.ts` has a `<date>` slot.** The owner's answer fills it at O-1.
- **The `owner-line-xml.ts` header has a `<date>` slot.** Task 7 Step 1 fills it.

**3. Type and name consistency.** These were checked across tasks:
- **db wrappers:** `ownerLineAnswerLookup` (Tasks 2, 7, 9), `attemptOwnerLinePin` / `attemptOwnerLineVerify` (2, 9), `ownerLineSessionCheck` (2, 10, 12), `noteOwnerLineCall` (2, 12), `readOwnerLineCallLog` (2, 13), `setOwnerLineSwitch` / `readOwnerLineSwitch` (2, 5, 6), `startCallRow({ ownerLineUserId })` (2, 12).
- **web helpers:** `OWNER_LINE_ROLES` (5, 7, 9, 10, 12), `ownerLineReadClient` (10, 11, 12), `OwnerLineSession` (10, 11, 12), `OWNER_TOOL_NAMES` / `LOG_KIND_OF` / `OwnerToolName` (11, 12, 17), `firstName` (7, 8, 12, 13).
- **SQL argument order:** `owner_line_attempt_pin(uuid, text, integer)` is the same in the migration, the wrappers, the test signatures and `FUNCTIONS`.
- **access-log kinds:** the four `owner_line_*` kinds are the same in the migration CHECK, `OWNER_LINE_LOG_KINDS`, `LOG_KIND_OF` and `askedAboutLine`.
- **Renamed during review:** `lib/owner-line/texml.ts` became `app/api/voice/texml/owner-line-xml.ts`, so the TeXML helpers sit with `xml.ts`. `firstName` lives in `lib/owner-line/names.ts`, and every `lib/` file imports it from there, so `lib/` never imports from `app/`.
- **Signatures changed by the fix round:**
  - `ownerLineAnswerLookup(db, accountId, callerE164, max)` and `ownerLineSessionCheck(db, { accountId, userId, role, maxCalls })` have no day-start argument; SQL computes the account's day (Q-F).
  - `setOwnerLineSwitch(db, accountId, on, by: "owner" | "agency")` and `readOwnerLineSwitch` return `OwnerLineSwitchState` (`changedByKind`, never a name: owner ruling 2026-11-09).
  - `attemptOwnerLinePin` returns `OwnerLinePinResult`; a lock always carries `lockedUntil: string`.
  - `hashPin` / `candidateFor` take the pepper from `env`.

  Every call site in Tasks 2, 5, 6, 7, 9, 10 and 12 was updated.

**4. Things this plan could not verify, and the task that does.**
- A-1 to A-9 above.
- `listAccountWork` after #343 (Task 11's interface note).
- The 0113/0114 changes to the access-log kind CHECK (Task 1 Step 1).

## Owner rulings Q-A to Q-F (2026-11-09, binding), and the one open question Q-G

- **Q-A: YES, the agency may turn a client's switch OFF, never ON.** This CHANGES the plan's default. Turning it off is protective and only reduces exposure: a lost phone, or a team member let go while the Owner is unreachable. The switch card must:
  - show who turned it off and when;
  - leave turning it back ON to the client's Owner only;
  - be covered by a test that the agency's ON is refused.
- **Q-B: same `voice_minutes` meter, no separate price** (the plan's default). Owner-line calls are still never counted as answered calls.
- **Q-C: YES** (the plan's default). Owner-line calls are excluded from the 5-a-day per-caller cap and from the per-account cap of 50 (`route.ts:378-388`), so the owner branch is never refused by either. They are bounded by their own 10 per person, per business, per day. **Where:**
  - Task 2: exclusion in the counts;
  - Task 7: a `verify` or `pin` hit skips the customer refusals;
  - Task 12: the webhook's owner branch runs before step 8.
- **Q-D: YES** (the plan's default). A person may verify their cell and set a PIN while the switch is off, and the card says that nothing works until the Owner turns it on.
- **Q-E (new, from review finding I-9): `calls_and_messages` counts the same calls as the dashboard's "Calls answered" tile.** It adds the spam count separately ("plus 12 calls that looked like spam"), and every described call carries its outcome in plain words. Implemented in Task 11 with the tile's own reads (`listAnsweredCallStartsBetween`, `listSpamCallStartsBetween`) and its own constants, never a copy.
- **Q-F (new): "per day" and "today" mean the ACCOUNT's local day, everywhere.** That covers the 10-a-day limit (`app.owner_line_day_start`, Task 1) and every tool range (`localDayStart`, Task 10). Both have spring-forward, fall-back and midnight-DST-zone tests. `weekly-window.ts:95-98` documents the limitation those corrections handle.
- **Q-G (OPEN, for the owner):** Q-E's wording was "spam calls I BLOCKED". The dashboard's spam line counts calls Sofía answered and flagged as likely spam (`listSpamCallStartsBetween`). Calls refused BEFORE Sofía (repeat-spam callers, over-cap callers and not-live numbers, recorded in `screened_calls`, 0039) are not on the dashboard at all. **The plan's default:** the tile's definition only, worded "looked like spam", never "blocked", so the line and the dashboard agree. **The alternative:** add the `screened_calls` count as a second number, "and N more I didn't put through". That needs a new reader, and the dashboard would then disagree with the line until it shows the same number.

- **Q-G (2026-11-09): the dashboard's spam number only** (the plan's default). The phone says "plus N calls that looked like spam", using the same read as the dashboard. Calls refused before Sofía answered (`screened_calls`) are not counted, so the phone and the dashboard always agree.

- **Callback numbers (2026-11-09, owner, extended): the owner line reads a callback number aloud as the To do row shows it.** Today that is Sofía's own callback To do ("Call back at {number}: {reason}", `callbackTaskTitle`). After #343 it also covers failed transfers, through `work.failedTransfer` with `{number}`. It is the ONE sanctioned number in any owner tool's output (Task 11's scan). No other id or digit string is allowed.

- **O-1 DECIDED (2026-11-09, owner): F2 now, T later.**
  - Task 10 writes `OWNER_LINE_DATA_PATH = "service"` with roles `["owner","staff"]`.
  - Technicians are not offered the owner line: the card does not render for them, and the enrolment action refuses them.
  - T comes later, as its own step:
    1. danlo's dashboard inventory (the spike record §4 question);
    2. the ES256 import-then-rotate on bis-ci, until the probe prints six PASS lines;
    3. then production;
    4. then a one-line flip to `"token"` with all three roles, on two conditions (Tasks 10/11 review):
       - the live scope test's Technician group passes under `"token"` on the seed where A's two customers are two contacts (review I-4; measured green on the replica 2026-11-09, T1);
       - the live re-check binds the session's Clerk ids, the ones the minted token carries, to the person it re-reads (review m-3, `session.ts`), so a token can never name a person other than the one re-checked.
  - No new production secret is added for PR 1, beyond `OWNER_LINE_PIN_PEPPER`.

- **Impersonation (2026-11-09, owner): REFUSED.** A Clerk session carrying `actor` (BIS staff signed in as a client) is redirected before any owner-line read or write, on every setup action (Task 5 `member()`, b8ec379e). The Team switch is already refused through `lib/auth.ts:69`. This matches the access-log rule that BIS enters a client account only through the logged agency path.
- **Orchestrator decisions (2026-11-09), owner-protective, inside the rulings above:**
  - the Owner's and the agency's OFF are allowed during a billing pause; ON is not;
  - "Stop calling in" is open to any current member, Technicians included;
  - after a real agency OFF, a failed BIS event is retried once and then logged; the action still answers ok;
  - the lockout email chunk loads only inside `after()`;
  - the Spanish ask says "la tecla de gato" with no spoken "(#)".
