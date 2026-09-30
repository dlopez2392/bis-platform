# Consent Chain PR-3: Email Unsubscribe, the Email Gate and the 0049 Fold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship consent chain PR-3 (spec §7, the PR-3 row): every email the platform sends passes one email gate; the twenty-two send sites carry a registered kind; every customer email carries an unsubscribe footer link and the RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers; a stateless token, the public `/u/[token]` page and the one-click endpoint record the customer's own stop and resubscribe in the ledger; an email unsubscribe stops every automated email except the customer-initiated class (decision 7); the contact's Email row replaces the 0049 "No marketing emails" switch; 0049's opt-outs are folded into the ledger (`backfill_0049`) and nothing reads that column afterwards.

**Architecture:** Five layers. **Data** (`packages/db`): no migration (0054 already lists every email method; 0055 already has the `backfill_0049` and `unsubscribe_page` rules), two pure/read helpers in `consent.ts` (`emailLedgerAddress`, `readBlockedAddresses`), the reactivation walk and the referral ask moved off the 0049 column, and the fold as two orchestrator-run SQL files. **Pure rules** (`apps/web/src/lib/consent/`): the email half of the registry (`EMAIL_KINDS` in `classes.ts`), the token (`token.ts`), the Email row's view model (`email-view.ts`). **The email gate** (`lib/consent/email-gate.ts`): the only module outside `lib/email`'s own provider files that reaches an email provider; it reads the ledger for the automated classes, applies choice 31's hours, adds the footer and headers to customer kinds, and returns sent / deferred / blocked / failed. **Endpoints**: `POST /api/unsubscribe/[token]` (one-click) and the `/u/[token]` page with its two server actions. **Screens**: the Email row in the drawer and on the contact page, and the email composer's notice.

**Tech Stack:** Next.js 16 (App Router, server actions, route handlers), Node `crypto` (HKDF, AES-256-GCM, HMAC-SHA256), Supabase Postgres 17 (the local replica is PG18), `resend@6.18.1`, vitest 4, Playwright, Tailwind 4 with the repo's tokens.

**Spec:** `docs/superpowers/specs/2026-09-26-consent-chain-design.md` at `001a25f9`, corrected by this branch's spec commit `2de603ed` (E1–E5 below: facts only). §1.1 decisions 1–9 are binding; §1.2 defaults stand; §1.3 choices 18–31 are approved (PR-2 plan, header). This plan covers §4.3 in full, §3's PR-3 line (`marketing_email_opted_out_at` stops being read and written), the PR-3 parts of §5 and §6 (the Email row, the composer's email notice, `/u/[token]`, the footer), §8's PR-3 tests (the token, scan 1 for email, scan 4, scan 5's column, the e2e's two email lines) and the PR-3 row of §7.

**Replay status: NOT REPLAYED.** This machine had between 0.1 and 0.2 GB of free memory while this plan was written (the floor for one targeted test file is 1.5 GB), so no step below was run. Every "Expected" output is the plan writer's prediction; every probe row is a prescription, not a measurement. The implementer runs each RED, each GREEN and each probe, and reports any that behave otherwise (verify before you apply; reject with evidence if wrong).

## Global Constraints

- Tier: **HIGH (legal: CAN-SPAM, RFC 8058, the append-only ledger)**. Every new assertion names, in its title, the mutation that turns it red. Every task ends with a probe table; the implementer applies each probe to the finished task, one at a time, and records which tests turned red (memory `bis-vacuous-test-shapes`: a mutation must compile and must produce the WRONG OUTPUT, never a crash a catch launders; judge by the whole file, never one `-t` filter; a harness must tell "stayed green" from "nothing ran"). A guard kept "as defence in depth" gets a pure unit test of its own. Source scans read code with comments stripped (TypeScript's printer, `scans.test.ts`'s `code()`) and each carries a positive control.
- **Decision 6, verbatim:** "The opt-out is an unsubscribe link in every automated email, plus the RFC 8058 one-click `List-Unsubscribe` and `List-Unsubscribe-Post` headers. Both land on a BIS page or endpoint that records the revoke at once. There is **no** inbound-email reading. The token is **signed (HMAC)** and encodes the account, the channel and the address, so there is no token table."
- **Decision 7, verbatim:** "All automated email from that business stops, except a direct response to what the customer just did (the \"customer-initiated transactional\" class, §4.3)."
- **Choices used here:** 19 (a stop the customer made themselves — the unsubscribe link, one-click — is lifted only by the customer's own act; staff Resume only for staff and `backfill_0049` stops), 22 (a staff-typed email to an unsubscribed contact still sends, with a notice), 23 (operator mail passes the gate, is not subject to the ledger, carries no link), 24 (the fold widens: "No marketing emails" becomes "no automated email"), 27 (the page's ghost Resubscribe), 28 (a grant never lifts a stop), 31 (automated email on the fixed 08:00–21:00 window).
- **The customer-initiated class** (spec §4.3, verbatim): "it is sent to the person whose own action caused it; it is sent inside the same request, or the same live call, that action started; it is about only that action; no cron pass sends it." Scan 4 pins those kinds to `app/b/[publicId]/actions.ts`, `lib/forms/enrich.ts` and `lib/voice/tools/registry.ts`, never under `lib/automations/`.
- **The ledger stays append-only** (spec §3): every write goes through `appendConsentEventGuarded` in `packages/db/src/consent.ts` (0055's function; scan 3 unchanged). A `source_ref` names ONE delivery or event, never a token or an address (spec §3, PR-2 S10): the unsubscribe writes carry NO `source_ref`; their idempotence is the guard.
- **Fails closed** (spec §5): an unreadable ledger or zone blocks an automated email (`ledger_unavailable`), which an automation turns into a 15-minute re-hold (`LEDGER_RETRY_MS`), never a send. A production send of a customer kind with no `CONSENT_TOKEN_SECRET` or no origin is blocked `unsubscribe_unavailable` (also a re-hold for automations), never sent without its way out.
- **Copy** lives in `apps/web/src/lib/messages.ts`, plain language (DESIGN.md "Voice"; `messages.test.ts` scans every key). The spec's own words (§4.3 footer, §6 page and composer lines) are used verbatim and pinned in `copy.test.ts`; every other line is this plan's (G-list). Task 4 adds every new line; later tasks only read `m` (Task 11 deletes the 0049 switch's keys).
- **UI** follows DESIGN.md: tokens only (dashboard); both themes through `.dark`; status is a dot and a word (`DotPill`); loaded / empty / error states; one primary per view (rule 8); reversible actions at once with an Undo toast (rule 6); new variants get a `/dashboard/styleguide` specimen. The public `/u/[token]` page follows the cancel page's own convention (`var(--token, fallback)` inside its embedded stylesheet, `publicFormTheme`, `PublicBrand`, rule 9's client logo and colour). Email HTML keeps the email dialect (inline literal colours, the shell's precedent), which DESIGN.md's tokens do not reach.
- **Supabase: never write to either project, never read production** from a lane. PR-3 has NO migration. The orchestrator runs the fold's two SQL files on production exactly as Task 15 says, under danlo's go. Local env files point at PRODUCTION, so the db suite, Playwright and `pnpm check` REFUSE to run locally (#135, by design). Never work around that.
- **DB tests** (`packages/db`): `withRollback` tests run on the local PG18 replica and in CI; `withTestAccount` / `serviceDb` tests are CI only. The replica (memory `bis-local-db-replica`): `bash /c/Users/danlo/bis-platform/.superpowers/sdd/consent-pr2/replica/replica.sh <repo-root> 0056_messaging_profile.sql` builds `pre` (through 0055) and `post` (through 0056 = `main`'s schema). PR-3 adds no migration, so every PR-3 db test runs on **`post`**: `SUPABASE_DB_URL=postgresql://postgres@localhost:55433/post`.
- **Full web suite:** `pnpm --filter web exec vitest run`. In a lane worktree (no `apps/web/.env.local`) it ends with exactly the two failing suites `main` has (`src/app/f/[publicId]/actions.returning-lead.test.ts`, `src/app/(dashboard)/dashboard/accounts/[accountId]/calls/[callId]/actions.test.ts`), each throwing before its tests run. Any other failure is the lane's. Judge by vitest's own summary block.
- **Memory on this machine is tight.** Before any test run: `powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1MB"`; a full suite only above 2.5 GB, a single file only above 1.5 GB; never two at once. **Tasks commit on their targeted tests; full suites run only at the checkpoints.**
- **`vi.mock("@bis/db")` factories.** When a task adds a new top-level `@bis/db` import to a module, every test that mocks `@bis/db` and imports that module (directly or through another) must define the new export, or the path reads an undefined mock and passes vacuously. Each task names the factories it changes; where it cannot enumerate them, it gives the grep that finds them.
- **E2E** runs only on the per-run fixture account ("E2E Client Co …", `auth.setup.ts`), never `Test Client One`.
- **Lanes** (2–3 at a time, disjoint files, `.claude/worktrees/consent-pr3-<lane>` on `feat/consent-pr3`): each lane commits locally, one commit per task; the orchestrator cherry-picks at each checkpoint. Nobody pushes until Task 15.
- **Secrets** (memory `bis-env-secret-reads`): `CONSENT_TOKEN_SECRET` is generated and piped straight into `vercel env add`; it is never echoed, printed, written to a file or parsed by code that can throw with it in the message. The e2e job's value is a NON-secret literal (the `STRIPE_WEBHOOK_SECRET: whsec_bis_ci_e2e_fixture_only` precedent).
- Gates before merge: `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`, all in CI (`verify`, `e2e`). Read the check runs FOR THE HEAD SHA.
- **Written to the recommended answers of the QUESTIONS FOR DANLO below.** Each question names the tasks and steps a different answer changes (marked `[Q-n]` in those steps).

## Prerequisites

1. **`main` at `001a25f9` or later** (PR-1 #151, PR-2 #153, #154, #155 merged; 0054, 0055, 0056 on both Supabase projects — NEVER re-apply). The branch `feat/consent-pr3` is cut from it, and this plan's two commits (`2de603ed` the spec, then the plan) are cherry-picked onto it first. If `main` has moved, re-read every file a task edits before applying its diff (tasks name functions and quote the text to find, not only lines).
2. **The local replica** (orchestrator, once, before Task 1): `bash /c/Users/danlo/bis-platform/.superpowers/sdd/consent-pr2/replica/replica.sh "$(git rev-parse --show-toplevel)" 0056_messaging_profile.sql`. Use `post`.
3. **One new env var, `CONSENT_TOKEN_SECRET`** (and the optional `CONSENT_TOKEN_SECRET_PREVIOUS`). Production's value is set by the orchestrator under danlo's go in Task 15 BEFORE the merge; the e2e job gets a non-secret literal in Task 14; `.env.example` documents both in Task 3. Preview and local dev need none: outside production, a send with no secret carries no link (nothing real is delivered there, `getEmailProvider`'s own rule).
4. **`APP_ORIGIN` is set in Vercel Production** (`.env.example:52` documents it; the orchestrator confirms the NAME exists with `vercel env ls production`, never the value, in Task 15 step 2). The gate builds the unsubscribe links from it first.
5. **No Supabase write before Task 15.** No CI-project apply at all (no migration).

## External facts: verified vs assumed

Read by this plan's writer on 2026-09-30 (documentation and the installed package only; no provider API was called):

- **X1. Resend accepts custom headers — VERIFIED.** `node_modules/.pnpm/resend@6.18.1/node_modules/resend/dist/index.d.mts`, `CreateEmailBaseOptions`: `headers?: Record<string, string>` ("Custom headers to add to the email"). Resend's page `resend.com/docs/dashboard/emails/add-unsubscribe-to-transactional-emails` sends `headers: { 'List-Unsubscribe': '<https://example.com/unsubscribe>' }` and says: "When receiving a `POST`, return a blank page with `200 (OK)` or `202 (Accepted)`, and show the regular unsubscribe page with the `GET` method. Ensure that users stop receiving email within 48 hours of this request."
- **X2. RFC 8058 — VERIFIED** (`datatracker.ietf.org/doc/html/rfc8058`, quoted): "The List-Unsubscribe header field MUST contain one HTTPS URI. It MAY contain other non-HTTP/S URIs such as MAILTO:. The List-Unsubscribe-Post header MUST contain the single key/value pair \"List-Unsubscribe=One-Click\". … the message MUST have a valid DomainKeys Identified Mail (DKIM) signature that covers at least the List-Unsubscribe and List-Unsubscribe-Post headers." "The POST request MUST NOT include cookies, HTTP authorization, or any other context information." "The POST content SHOULD be sent as 'multipart/form-data' [RFC7578] or MAY be sent as 'application/x-www-form-urlencoded'." "The server handling the unsubscription SHOULD verify that the opaque or hard-to-forge component is valid." "many browsers have turned redirected HTTP POSTs into GETs." And its abstract: "mail software sometimes fetches URLs in mail header fields, and thereby accidentally triggers unsubscriptions".
- **X3. Gmail — VERIFIED** (`support.google.com/mail/answer/81126`): "Marketing messages and subscribed messages must support one-click unsubscribe, and include a clearly visible unsubscribe link in the message body." "If you send more than 5,000 message per day, your marketing and subscribed messages must support one-click unsubscribe." Its sample POST is `Content-Type: application/x-www-form-urlencoded`, body `List-Unsubscribe=One-Click`.
- **X4. CAN-SPAM — VERIFIED** (FTC, `ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business`): "Any opt-out mechanism you offer must be able to process opt-out requests for at least 30 days after you send your message. You must honor a recipient's opt-out request within 10 business days. You can't … make the recipient take any step other than sending a reply email or visiting a single page on an Internet website as a condition for honoring an opt-out request." "If it contains only transactional or relationship content, its primary purpose is transactional or relationship. In that case, it may not contain false or misleading routing information, but is otherwise exempt from most provisions of the CAN-SPAM Act." So tokens never expire (the spec already says so).
- **X5. Next.js server actions and CSRF — VERIFIED** (`nextjs.org/docs/app/guides/data-security`): "Server Actions use the POST method, and only this HTTP method is allowed to invoke them." "Server Actions in Next.js also compare the Origin header to the Host header (or X-Forwarded-Host). If these don't match, the request will be aborted."

Repo facts (read on `001a25f9`):

- **R1. Twenty-two email send sites, not twenty** (E1): `rg "\.send\(" apps/web/src --glob '!*.test.ts'` minus SMS and websocket lines. The two the spec's table missed are the voice cancellation email to the caller (`lib/voice/tools/registry.ts:630`, `bookingCancelledEmail`) and the voice phone-change alert to staff (`registry.ts:202`, `alertStaffOfPhoneChange`). The full list is Task 4's `EMAIL_KINDS`.
- **R2. `apps/web/src/proxy.ts:3`** protects only `/dashboard(.*)`; `/u/…` and `/api/unsubscribe/…` are public already (E2).
- **R3. 0054 and 0055 need no change** (E3): 0054's method CHECK lists `unsubscribe_link`, `one_click`, `unsubscribe_page`, `backfill_0049`; its address CHECK accepts `channel = 'email'` when `address = lower(address) and address = btrim(address)`, 3–254 characters, `position('@' in address) > 1`; 0055 already refuses a `backfill_0049` stop over any stop and allows `resubscribed` / `unsubscribe_page` under any guard, and its `unless_customer_stopped` list already names `unsubscribe_link` and `one_click`. PR-3 therefore ships no migration, and its rollout has no CI apply, no production apply and no parity step.
- **R4. The cancel page refuses to write on GET on purpose** (`app/b/[publicId]/cancel/[token]/page.tsx`, its header comment): "an email client or security scanner that prefetches links to check them for malware issues a GET against this exact URL before any human ever opens the message, and a cancel-on-GET design would let that prefetch silently cancel a booking nobody asked to cancel." This is Q1's evidence.
- **R5. The two marketing emails already carry a reply opt-out** (`templates/marketing-footer.ts`, #118/#122): "You're getting this because you've been a customer of {name}. If you'd rather not hear from us, reply and let us know." (`messages.ts:1514`). The referral ask carries it since #122 (`c0ef2d72`), so the memory's "referral_ask email has no opt-out/address" is out of date (Q2).
- **R6. The composer's email template is deliberately bare** (`templates/outbound.ts`): "there is no button, no footer and no campaign chrome here, and that is a decision rather than an omission. The text part is the typed body byte-for-byte." This is Q4's evidence.
- **R7. `getEmailProvider` is the only provider factory** (`lib/email/index.ts`), and today NINE modules outside `lib/email` call it or take its provider (`conversations/actions.ts`, `settings/actions.ts`, `settings/billing-actions.ts`, `b/[publicId]/actions.ts`, `b/[publicId]/cancel/[token]/actions.ts`, `lib/automations/harness.ts`, `lib/forms/enrich.ts`, `lib/voice/finish-call.ts`, `lib/voice/tools/registry.ts`), plus `lib/billing/billing-link.ts`'s `type EmailProvider` import of the index module.
- **R8. The reactivation walk's 0049 filter is IN THE QUERY for a reason** (`packages/db/src/automations.ts`, `listDueReactivations`): a pass-level skip "would come back on every tick at the head of this oldest-first walk and refill the survivor window, starving every other account (the #118 I1 trap)". Task 1 keeps a stopped contact out of the WALK (after the page read, before the survivor count), not in the pass.
- **R9. The drawer's summary parser treats `marketing_email_opted_out_at` as REQUIRED** (`lib/contacts/summary.ts`, `parseContactSummary`): a tab opened before the deploy will show the drawer's "couldn't load" state against the new server until it reloads (Known residuals).

Assumptions (not verified; each names what settles it):

- **A1. Resend's DKIM signature covers custom headers** (X2 requires it for one-click). NOT FOUND in Resend's docs. Settled at go-live (Task 15 step 9): the received message's `DKIM-Signature` `h=` list, read from Gmail's "Show original", must name `list-unsubscribe` and `list-unsubscribe-post`. If it does not: the header one-click is not honoured by Gmail, the footer link still works; report to danlo (no code change can fix Resend's signing).
- **A2. Yahoo's bulk-sender rule** mirrors Gmail's (one-click for bulk senders). Not read; nothing here depends on it.
- **A3. Clerk's middleware answers a cookie-less POST to `/api/unsubscribe/…` without a redirect or a `Set-Cookie`.** Clerk's handshake is for document requests; the e2e asserts no `set-cookie` and no redirect on the one-click POST (Task 14), which settles it for the e2e's Clerk instance; Task 15 step 9 checks production's with `curl -si -X POST`.
- **A4. A page with one button counts as "visiting a single page"** (X4's wording does not say whether a click on that page is allowed; common practice treats a one-button confirm page as one page). Only matters under Q1's recommendation; counsel reads it with the §5 go-live item.
- **A5. Mail scanners (Microsoft Defender Safe Links, Mimecast, Proofpoint) fetch body links with GET** before or when a person clicks. Industry knowledge, not read here; R4 records that this repo already designed around it once.

## Spec gaps resolved here (the reviewer should confirm or overrule)

E1–E5 are corrections applied to the spec itself (commit `2de603ed`, facts only). The G-list is this plan's choices where the spec is silent.

- **E1. Twenty-two send sites** (R1): `voice.cancelled` (customer_initiated: the caller asked on the live call; decision 7's "direct response to what the customer just did") and `operator.phone_change_alert` (operator). Line numbers re-read.
- **E2. Endpoints are already public** (R2): nothing is added to `proxy.ts`; Task 9 pins it with a test.
- **E3. The fold is a backfill statement, not a migration** (R3). It runs on production only, through `execute_sql`, count first, write on danlo's go (Task 2, Task 15). A migration would also run on the CI project (fixture data, nothing to fold) and could not be counted before it writes.
- **E4. CAN-SPAM's 30 days and "single page"** verified (X4).
- **E5. RFC 8058, Gmail and Resend** verified (X1–X3); DKIM coverage is A1.
- **G1. The email gate is its own module** (`lib/consent/email-gate.ts`), not a second half of `gate.ts`. The spec's scan 1 names "only `lib/consent/gate.ts`"; the email scan names `email-gate.ts` instead. Two small modules keep each provider's exceptions (the SMS stop confirmation, the email footer) apart.
- **G2. The token is encrypted as well as signed** ([Q3]): `1.<base64url(iv | AES-256-GCM(payload) | tag)>.<base64url(HMAC-SHA256)>`, both keys derived from `CONSENT_TOKEN_SECRET` by HKDF-SHA256. It still carries the account, the channel and the address (decision 6: no token table) but no one reading a URL (request logs, a scanner's log, browser history, a `Referer`) can read the address. The payload adds two optional fields the spec did not list: `n` (the contact id, evidence only) and `k` (the kind of email that carried it, evidence only).
- **G3. The unsubscribe rows carry `contact_id = null`** and the token's contact in `evidence.contactId`: the composite contact FK (0054) would refuse the insert if the contact had been deleted since the email went out, and an unsubscribe must never fail on that. The state is per address; nothing reads `contact_id` to decide.
- **G4. The unsubscribe writes use guard `unless_customer_stopped`** ([Q5]): an unsubscribe over a STAFF email stop (or a `backfill_0049` one) is recorded, so from then on only the customer can lift it — PR-2's S8 for texts, applied to email. Over the customer's own stop it is refused, so a second click writes nothing (spec §4.3's "an address that is already stopped gets no second row" holds for the customer's own stops).
- **G5. Resubscribe uses guard `if_stopped_or_held`**: it lifts any stop, staff's included (the customer's own act; choice 19 restricts only staff), and answers `was_allowed` without a row for an address that is not stopped.
- **G6. `GET /api/unsubscribe/[token]` redirects (303) to `/u/[token]`**: a client that opens the header URL instead of POSTing to it lands on the page (Resend's advice, X1). The POST never redirects (X2: redirected POSTs turn into GETs).
- **G7. Where the footer goes.** `shell()` emits one marker, `<!--bis:unsubscribe-->`, as the card's last row; the gate replaces it with the footer row for a customer kind and with nothing for operator mail, and appends the footer line to the text part. A customer kind whose `html` has no marker THROWS (a programming error, caught by the gate's tests). User text cannot forge the marker: every template escapes `<`.
- **G8. Outside production with no secret, customer emails carry no link** (and no headers), logged once per send. In production a missing secret or origin blocks the send (`unsubscribe_unavailable`). A preview deployment therefore never mints tokens with a guessable key, and never accepts one.
- **G9. Email hours live in the gate too** (choice 31), exactly as `decideSms` does: an automated kind outside 08:00–21:00 is `deferred`, and `holdOrSend` turns that into its held row. `holdOrSend` already holds email at the same `ctx.now`, so the two never disagree.
- **G10. `ctx.email` keeps its shape** (`{ isFake, send(input) }`), and `send` now takes the gate's request (the send input plus `accountId`, `kind`, `contactId`, …) and throws `EmailNotSent` when the gate did not send. `holdOrSend` turns `EmailNotSent` into held / skipped rows the way it turns `SmsDeferred` / `SmsBlocked` today. The harness still constructs the provider once per tick, so a production tick with `RESEND_API_KEY` unset still fails loudly before any query (context.ts's designed failure).
- **G11. Operator paths that take an `EmailProvider`** (the sending-address check, the billing link) get `operatorMailer(kind, accountId)`: a provider-shaped object whose `send` goes through the gate under that one operator kind and rethrows the provider's own words. `preflight.ts` and `billing-link.ts` keep their signatures and their tests.
- **G12. An email address is keyed by `emailLedgerAddress`** (trim, lowercase, 0054's CHECK rules). The fold SQL uses the same rule, restricted to printable ASCII after trimming spaces, tabs and line breaks; any 0049 address outside that is counted, reported and left for staff to stop by hand (Task 2's count, Task 15).
- **G13. A blocked automated email gives back its cap place** through the existing `outcome === "skipped"` branch of each pass (PR-1's rule). The referral ask's pass-level 0049 skip is removed: the gate's block answers the same row with the same reason ("They asked not to get these emails").
- **G14. The Email row's lines.** Stopped: "Since {date} · {how}", how ∈ "unsubscribe link" (link, one-click), "you recorded it" (staff), "you marked them “No marketing emails”" (the fold). Resume is offered for staff and fold stops only (choice 19). The row has no On hold state (email has no holds); a held row, which nothing writes, reads as Stopped with no Resume.
- **G15. The composer's notice has two lines**: the spec's "They unsubscribed from your emails on {date}. Write only about something they asked you for." for the customer's own stop, and "You stopped emails to them on {date}. Write only about something they asked you for." for a staff or fold stop (the spec's line would be false there).
- **G16. The e2e mints its tokens with the CI literal** through `sealConsentToken` (the spec's list: `/u/{token}` for a fixture contact, Resubscribe, the one-click POST 200) and also asserts no `Set-Cookie`, no redirect, a 400 for a bad token, and the drawer's Email row after each.
- **G17. Complaints are not stops.** Resend's `email.complained` stays a message status (`webhooks/resend/route.ts`). Recording it as a stop needs a method 0054 does not have and an account the event does not carry for automation email (automation emails write no `messages` row). Deferred (Next plans).

## QUESTIONS FOR DANLO

Each has a recommendation (the plan is written to it) and names what a different answer changes.

- **Q1. Does opening the unsubscribe link record the stop at once, or does the page ask for one click first?** Decision 6 (binding) says the page "records the revoke at once", and choice 27 adds the ghost Resubscribe for a mis-tap or a mail scanner. **Recommendation: one click on the page records it; the header one-click (Gmail's own Unsubscribe button) stays instant.** Why: decision 7 makes an email stop cover appointment reminders too, and choice 19 lets only the customer lift it. A corporate mail filter that fetches the footer link (A5; RFC 8058's own abstract says mail software does this; this repo's cancel page refuses to write on GET for exactly that reason, R4) would then silently and permanently stop that customer's reminders, and the customer never sees the page that could undo it. A button still counts as the one page CAN-SPAM allows (A4). **Alternatives:** (a) keep decision 6 literally (the GET records; the page shows "You're unsubscribed" with Resubscribe); (b) record on GET only for the header URL. **A different answer changes:** Task 9 (the page's first state and `unsubscribeAction`), Task 4 (two copy lines), Task 14 (the e2e's first step). Marked `[Q1]`.
- **Q2. Does the referral ask need its own opt-out?** **Recommendation: no.** Since #122 it already carries the reply opt-out and the postal address (R5), and after PR-3 it also carries the unsubscribe link, and an email stop covers it (decision 7 lists it: "reminders, follow-ups, review requests, reactivation and referral asks all stop"). A per-kind choice is the preference page, out of scope (§9). **Alternative:** a per-kind opt-out (a new method or an evidence field, a new screen) — a later plan. **A different answer changes:** nothing in this plan (it would add one).
- **Q3. The token: encrypted, or only signed?** Decision 6 says "signed (HMAC)" and the spec's §5 accepted that the address sits base64-encoded in the URL. The PR-3 brief asks for no personal data in the URL. **Recommendation: encrypt the payload and still sign it (G2)** — no table, the same one secret, about thirty more lines, and the address is no longer readable from a request log, a scanner's log or browser history. **Alternative:** the spec's plain signed token (`base64url(JSON).base64url(HMAC)`). **A different answer changes:** Task 3 only (`sealConsentToken` / `openConsentToken` internals and two tests). Marked `[Q3]`.
- **Q4. Do staff-typed emails carry the unsubscribe link and headers?** The spec's §4.3 says "the first twelve rows", which includes `staff.composer_email`; decision 6 says "every **automated** email", and the composer's template is bare by decision (R6). **Recommendation: no link and no headers on staff-typed email.** A person's one-to-one reply is not automated mail (choice 22), and a List-Unsubscribe header on it would let one tap in Gmail stop every reminder from that business. The composer still shows the notice when they unsubscribed (G15). **Alternative:** follow §4.3 literally. **A different answer changes:** Task 4's `EMAIL_KINDS["staff.composer_email"].footer` (one word) and Task 7's composer test. Marked `[Q4]`.
- **Q5. An unsubscribe over a staff "Stop emails": recorded, or not?** PR-2 decided for texts (S8, danlo 2026-09-28) that the customer's own STOP over a staff stop IS recorded, so only the customer can lift it; spec §4.2 says "PR-3 decides whether email follows this one". **Recommendation: follow S8 (G4).** **Alternative:** "an address already stopped gets no second row" whatever stopped it (guard `if_allowed`), so staff could still Resume. **A different answer changes:** Task 9's `recordUnsubscribe` guard and one test. Marked `[Q5]`.
- **Q6. Email "stop" replies.** Decision 6 (binding) rules out reading inbound email, so a customer who replies "stop" to a reactivation or referral email (whose footer invites it, R5) is honoured only when staff read the reply and press "Stop emails" on the Email row. **Recommendation: keep it that way, and keep the reply sentence** (it is danlo's decision A of 2026-09-22, and CAN-SPAM names a reply as a valid way out, X4); the link now sits beside it, so most customers will use the link. **Alternatives:** reword the footer to point only at the link (a copy change danlo made, so his to change); or parse inbound replies (against decision 6). **A different answer changes:** nothing in this plan (a copy edit to `automations.reactivation.footerReason*`).
- **Q7 (FYI, choice 24's count).** The fold widens every "No marketing emails" contact to "no automated email", reminders included. Task 15 shows you the count, how many of them have a booking in the next 30 days (their reminders will stop), and how many share an address with another contact (who stops too, because the ledger is per address), before anything is written.

## File Structure

Read off each task's Files block (each block is the authority). **34 files created, 85 modified (plus any other test that renders `ActivityTimeline` or `MessageComposer`, Task 12), 5 deleted**, across 14 implementation tasks and one rollout task. No migration. Test counts are left to each task's test code (nothing was run).

**packages/db**

Created:
- `src/email-address.ts` — Task 1
- `supabase/backfills/0049-fold-count.sql`, `supabase/backfills/0049-fold-write.sql`, `src/test/email-optout-fold.test.ts` — Task 2

Modified:
- `package.json` (the `./email-address` subpath), `src/consent.ts`, `src/consent.test.ts`, `src/index.ts`, `src/automations.ts`, `src/contacts.ts`, `src/test/automations.test.ts`, `src/test/contacts.test.ts` — Task 1
- `src/ci/sql-files.test.ts` — Task 2

**apps/web** (paths under `apps/web/`; `…/` is `src/app/(dashboard)/dashboard/accounts/[accountId]/`)

Created:
- `src/lib/consent/token.ts`, `token.test.ts` — Task 3
- `src/lib/email/environment.ts`, `src/lib/consent/email-gate.ts`, `email-gate.test.ts` — Task 5 (Task 8 appends two cases to the test)
- `src/lib/consent/unsubscribe.ts`, `unsubscribe.test.ts`, `unsubscribe-copy.ts`, `unsubscribe-copy.test.ts`, `src/app/api/unsubscribe/[token]/route.ts`, `route.test.ts`, `src/app/u/[token]/page.tsx`, `unsubscribe-form.tsx`, `actions.ts`, `actions.test.ts`, `page.test.ts`, `src/proxy.test.ts` — Task 9
- `src/lib/consent/email-view.ts`, `email-view.test.ts`, `email-staff-actions.ts`, `email-staff-actions.test.ts`, `email-context.ts`, `…/contacts/email-actions.ts`, `src/app/api/accounts/[accountId]/contacts/[contactId]/email/route.ts`, `route.test.ts` — Task 10
- `src/lib/consent/email-row.ts`, `email-row.test.ts`, `…/contacts/email-row.tsx`, `…/contacts/email-row.test.ts` — Task 11
- `e2e/consent-email.spec.ts` — Task 14

Modified:
- `src/lib/messages.ts` (Tasks 4, 11), `src/lib/consent/copy.test.ts`, `src/lib/consent/classes.ts`, `classes.test.ts`, `src/lib/email/templates/shell.ts`, `shell.test.ts`, `src/lib/consent/scans.test.ts` (Tasks 4, 13) — Task 4
- `src/lib/email/types.ts`, `resend.ts`, `resend.test.ts`, `index.ts`, `email.test.ts` — Task 5
- `src/lib/automations/context.ts`, `harness.ts`, `harness.test.ts`, `hold-or-send.ts`, `hold-or-send.test.ts`, `imports.test.ts`, `sentinel.test.ts`, the passes `reminders.ts`, `followups.ts`, `review-request.ts`, `referral-ask.ts`, `reactivation.ts`, `quote-followup.ts`, `no-show-nudge.ts`, `weekly-report.ts`, `weekly-agency-report.ts` and each one's `.test.ts`, `src/app/api/cron/reminders/route.test.ts` — Task 6
- `src/app/b/[publicId]/actions.ts`, `actions.test.ts`, `src/app/b/[publicId]/cancel/[token]/actions.ts`, `actions.test.ts`, `src/lib/forms/enrich.ts`, `src/app/f/[publicId]/actions.test.ts`, `…/conversations/actions.ts`, `…/conversations/actions.test.ts` — Task 7
- `src/lib/voice/tools/registry.ts`, `registry.test.ts`, `src/lib/voice/finish-call.ts`, `finish-call.test.ts`, `…/settings/actions.ts`, `…/settings/billing-actions.ts`, `src/lib/billing/billing-link.ts` — Task 8
- `…/contacts/contact-drawer.tsx`, `contact-drawer.wiring.test.ts`, `…/contacts/[contactId]/contact-fields-panel.tsx`, `…/contacts/[contactId]/page.tsx` (Tasks 11, 12), `page.test.ts` (Tasks 11, 12), `…/contacts/actions.ts`, `…/contacts/actions.test.ts`, `src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts`, `route.test.ts`, `src/lib/contacts/summary.ts`, `summary.test.ts`, `src/lib/zone.ts`, `src/lib/ui/guarded-run.ts` (a comment), `src/app/(dashboard)/dashboard/styleguide/page.tsx`, `e2e/contacts-drawer.spec.ts` — Task 11
- `src/lib/consent/recipient-state.ts`, `recipient-state.test.ts`, `composer-state.ts`, `composer-state.test.ts`, `…/contacts/[contactId]/message-composer.tsx`, `…/contacts/[contactId]/activity-timeline.tsx` — Task 12

Deleted:
- `…/contacts/marketing-optout-switch.tsx`, `marketing-optout-switch.test.ts`, `marketing-optout-switch.wiring.test.ts`, `src/lib/contacts/marketing-optout.ts`, `marketing-optout.test.ts` — Task 11

**repo root**

Modified:
- `.env.example` — Task 3
- `.github/workflows/ci.yml` — Task 14 (one non-secret literal in the `e2e` job)

## Task order and checkpoints

15 tasks, 4 orchestrator checkpoints, at most 3 lanes at a time. Each lane is a worktree on `feat/consent-pr3` (`.claude/worktrees/consent-pr3-<lane>`), created from the branch head at the phase's start, with `pnpm install --frozen-lockfile --prefer-offline`. Lanes commit locally, one commit per task (each task's last step), and never push. The orchestrator cherry-picks at each checkpoint, in task order.

**Phase 1** (two lanes, no shared file):
- **Lane A** (`packages/db` only): Task 1 → Task 2.
- **Lane B** (`apps/web` registry, copy, shell): Task 4.

**Checkpoint A (orchestrator).** Cherry-pick Tasks 1, 2, 4. On that head: both typechecks. Task 1 removes `setMarketingEmailOptOut` and `contactMarketingEmailOptedOut`, and drops the column from the contact select list, so `pnpm --filter web typecheck` is EXPECTED to fail in exactly these files and nowhere else (record the list): `…/contacts/actions.ts`, `…/contacts/[contactId]/contact-fields-panel.tsx`, `src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts` (Task 11 owns them), `lib/automations/passes/referral-ask.ts`, `lib/automations/passes/referral-ask.test.ts`, `lib/automations/sentinel.test.ts` (Task 6 owns them). If the compiler names another file, it read the column through a Task 1 type: add it to the task that owns its folder and say so in the ledger. The full web suite: the two env suites and the suites of those six files — nothing else. The db suite on the replica's `post`, the branch's parent and this head, JSON reporter, per-test statuses diffed: nothing may go from passed to failed except the CI-only files (`automations.test.ts`, `contacts.test.ts` are `withTestAccount` suites and fail to connect locally either way). Nothing goes to any Supabase project.

**Phase 2** (two lanes):
- **Lane A**: Task 3 (the token) → Task 5 (the gate).
- **Lane B**: Task 10 (the Email row's data, actions and route).

**Checkpoint B.** Cherry-pick Tasks 3, 5, 10; the same checks, plus `pnpm --filter web lint`.

**Phase 3** (three lanes, no shared file):
- **Lane A** (automations): Task 6.
- **Lane B** (booking page, forms, composer; then the public endpoints): Task 7 → Task 9.
- **Lane C** (voice, billing, sending address): Task 8.

**Checkpoint C.** Cherry-pick Tasks 6–9; the same checks. Only Task 11's three files may still fail the typecheck.

**Phase 4** (two lanes):
- **Lane A**: Task 11 (the Email row UI, the 0049 switch removed).
- **Lane B**: Task 12 (the composer's notice). Its `page.tsx` step is applied on the integration branch AFTER Task 11's cherry-pick (both edit the contact page; the step says so).

**Checkpoint D.** Cherry-pick Tasks 11 and 12 (Task 12's `page.tsx` step applied here); both typechecks clean; lint; the full web suite; the db diff.

**Phase 5** (the integration branch itself, in order): Task 13 (scans) → Task 14 (e2e and the CI literal) → Task 15 (gates, the secret, the fold count, the fold write, merge, the delta fold, the go-live check, handoff).

Dependencies, in full:
- Task 1: none. Task 2: none in code (it tests 0055 on the replica). Task 4: none.
- Task 3: Task 1 (`emailLedgerAddress`). Task 5: Tasks 1, 3, 4. Task 10: Tasks 1, 4.
- Task 6: Tasks 1, 4, 5. Task 7: Tasks 4, 5. Task 8: Tasks 4, 5. Task 9: Tasks 1, 3, 4.
- Task 11: Tasks 4, 10. Task 12: Tasks 1, 4 (and Task 11 for its `page.tsx` step).
- Task 13: Tasks 1–12. Task 14: Tasks 3, 9, 10, 11, 12. Task 15: everything.

Commands run from the lane's worktree root (Git Bash) unless a step says otherwise. Step 1 writes the tests (complete files, or exact find-and-replace edits against the task's parent commit). Step 2 runs them; "Expected" is the predicted RED. Step 3 writes the implementation. Step 4 runs again; "Expected" is the predicted GREEN. Step 5's probes are applied to the finished task one at a time. A block titled "Create" is a complete new file; "Edit" gives the exact current text to find and its replacement.

---

### Task 1: The ledger's email key, the blocked-address read, and the two due-lists moved off the 0049 column

**Owner:** bis-db-schema. **Tier:** HIGH. **Questions:** none.

**Files:**
- Create: `packages/db/src/email-address.ts`
- Modify: `packages/db/package.json` (the `./email-address` subpath), `packages/db/src/consent.ts` (re-export plus one new function), `packages/db/src/consent.test.ts`, `packages/db/src/index.ts`
- Modify: `packages/db/src/automations.ts` (`REFERRAL_ASK_SELECT`, `DueReferralAsk`, `toDueReferralAsk`, `listDueReactivations`, `getDueReactivationById`)
- Modify: `packages/db/src/contacts.ts` (the column leaves the contact select list; `setMarketingEmailOptOut` is deleted)
- Modify: `packages/db/src/test/automations.test.ts`, `packages/db/src/test/contacts.test.ts` (both CI only: `withTestAccount`)

**Interfaces:**
- Consumes: `consentStateOf`, `DECIDING_ACTIONS`, `ConsentRow`, `ConsentChannel`, `readConsentState`, `appendConsentEvent`, `appendConsentEventGuarded` (PR-1/PR-2).
- Produces (exported from `@bis/db`, and `emailLedgerAddress` also from `@bis/db/email-address`):
  - `emailLedgerAddress(raw: string | null | undefined): string | null` — trimmed and lowercased; null unless it is 3–254 characters long with an `@` after its first character (0054's CHECK).
  - `readBlockedAddresses(db: SupabaseClient, channel: ConsentChannel, pairs: readonly { accountId: string; address: string }[]): Promise<Set<string>>` — the keys `` `${accountId}|${address}` `` whose state is NOT allowed. THROWS on a read error and on a chunk that fills a whole 1000-row page (it never judges on a truncated page).
  - `DueReferralAsk` loses `contactMarketingEmailOptedOut`. `setMarketingEmailOptOut` is gone. `listDueReactivations` and `getDueReactivationById` leave out a contact whose email is stopped in the ledger, and no longer read `marketing_email_opted_out_at`.

- [ ] **Step 1: Write the failing tests**

Edit `packages/db/src/consent.test.ts`. Find:
```ts
  CUSTOMER_STOP_METHODS, type ConsentRow,
} from "./consent";
```
Replace with:
```ts
  CUSTOMER_STOP_METHODS, emailLedgerAddress, readBlockedAddresses, type ConsentRow,
} from "./consent";
```

Append at the end of the file:
```ts
describe("emailLedgerAddress — the ledger's email key (0054's CHECK, spec §3)", () => {
  it("trims and lowercases (mutation: drop .toLowerCase() → the mixed-case address misses the ledger, FAILS)", () => {
    expect(emailLedgerAddress("  Ana.Lopez@Example.COM \n")).toBe("ana.lopez@example.com");
  });

  it("refuses what 0054's CHECK refuses: no @, @ first, under 3 or over 254 characters, blank, null (mutation: indexOf('@') < 0 → '@example.com' passes, FAILS)", () => {
    expect(emailLedgerAddress("ana.example.com")).toBeNull();
    expect(emailLedgerAddress("@example.com")).toBeNull();
    expect(emailLedgerAddress("a@")).toBeNull();
    expect(emailLedgerAddress(`${"a".repeat(250)}@x.co`)).toBeNull();
    expect(emailLedgerAddress("   ")).toBeNull();
    expect(emailLedgerAddress(null)).toBeNull();
    expect(emailLedgerAddress(undefined)).toBeNull();
  });

  it("the boundaries: 3 characters and 254 characters are kept (mutation: `< 3` → `<= 3`, or `> 254` → `>= 254`, FAILS)", () => {
    expect(emailLedgerAddress("a@b")).toBe("a@b");
    const long = `${"a".repeat(248)}@x.com`;   // 254
    expect(long.length).toBe(254);
    expect(emailLedgerAddress(long)).toBe(long);
  });

  it("counts characters, not UTF-16 units, as Postgres's char_length does (mutation: use .length → a 254-character address holding an astral character reads as 255 and is refused, FAILS)", () => {
    const astral = String.fromCodePoint(0x1f600);
    const addr = `${astral}${"a".repeat(247)}@x.com`;   // 254 characters, 255 UTF-16 units
    expect([...addr].length).toBe(254);
    expect(emailLedgerAddress(addr)).toBe(addr);
  });
});

describe("readBlockedAddresses — which addresses a due-list must leave out", () => {
  const ROW = (id: string, account_id: string, address: string, action: string, method: string, occurred_at: string) =>
    ({ id, account_id, address, action, method, occurred_at });

  it("keys `${account}|${address}` whose newest deciding row is a stop; an allowed address and another account's stop of the SAME address are not blocked (mutation: key on address alone → a1's stop blocks a2, FAILS)", async () => {
    const f = fakeDb({ read: { data: [
      ROW("00000000-0000-0000-0000-000000000001", "a1", "ana@x.com", "revoked", "one_click", "2026-10-01T10:00:00Z"),
      ROW("00000000-0000-0000-0000-000000000002", "a1", "bo@x.com", "revoked", "staff", "2026-10-01T10:00:00Z"),
      ROW("00000000-0000-0000-0000-000000000003", "a1", "bo@x.com", "resubscribed", "staff_undo", "2026-10-01T10:01:00Z"),
    ], error: null } });
    const blocked = await readBlockedAddresses(f.db, "email", [
      { accountId: "a1", address: "ana@x.com" }, { accountId: "a1", address: "bo@x.com" }, { accountId: "a2", address: "ana@x.com" },
    ]);
    expect([...blocked]).toEqual(["a1|ana@x.com"]);
  });

  it("reads only deciding rows of that channel for those accounts and addresses (mutation: drop the channel filter → an SMS stop of the same string could block an email, FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    await readBlockedAddresses(f.db, "email", [{ accountId: "a1", address: "ana@x.com" }]);
    expect(f.calls).toEqual(expect.arrayContaining([
      ["from", "consent_events"], ["in", "account_id", ["a1"]], ["eq", "channel", "email"],
      ["in", "address", ["ana@x.com"]], ["in", "action", ["revoked", "held", "hold_released", "resubscribed"]],
      ["limit", 1000],
    ]));
  });

  it("no pairs, no read (mutation: drop the early return → a from() call on an empty list, FAILS)", async () => {
    const f = fakeDb();
    expect([...await readBlockedAddresses(f.db, "email", [])]).toEqual([]);
    expect(f.calls).toEqual([]);
  });

  it("chunks the addresses by 100 so a page of 200 candidates stays a short URL (mutation: one read for all → one limit call, FAILS)", async () => {
    const f = fakeDb({ read: { data: [], error: null } });
    const pairs = Array.from({ length: 150 }, (_, i) => ({ accountId: "a1", address: `c${i}@x.com` }));
    await readBlockedAddresses(f.db, "email", pairs);
    expect(f.calls.filter((c) => c[0] === "limit")).toHaveLength(2);
  });

  it("THROWS on a read error, and on a full 1000-row page, so a walk never judges on a truncated read (mutation: drop the length check → a truncated page answers 'not blocked', FAILS)", async () => {
    await expect(readBlockedAddresses(fakeDb({ read: { data: null, error: { message: "boom" } } }).db, "email",
      [{ accountId: "a1", address: "ana@x.com" }])).rejects.toThrow("readBlockedAddresses failed: boom");
    const full = Array.from({ length: 1000 }, (_, i) =>
      ROW(`00000000-0000-0000-0000-${String(i).padStart(12, "0")}`, "a1", "ana@x.com", "revoked", "staff", "2026-10-01T10:00:00Z"));
    await expect(readBlockedAddresses(fakeDb({ read: { data: full, error: null } }).db, "email",
      [{ accountId: "a1", address: "ana@x.com" }])).rejects.toThrow(/1000 rows/);
  });
});
```

Edit `packages/db/src/test/contacts.test.ts`: delete the whole `describe("setMarketingEmailOptOut (0049)", …)` block (from `describe("setMarketingEmailOptOut (0049)", () => {` to its closing `});`, found with `grep -n 'describe("setMarketingEmailOptOut' packages/db/src/test/contacts.test.ts`), and remove `setMarketingEmailOptOut` from the import list at the top (`         setMarketingEmailOptOut } from "../contacts";` becomes `} from "../contacts";` with the previous line's trailing comma removed if it leaves one). The column's own schema tests (`contacts-marketing-optout-schema.test.ts`, `schema-grants-guard.test.ts`, `server-only-writes-grants.test.ts`) stay: the column exists until a later drop migration (spec §3).

Edit `packages/db/src/test/automations.test.ts`. Find:
```ts
import { createContact, setMarketingEmailOptOut } from "../contacts";
```
Replace with:
```ts
import { createContact, getContact } from "../contacts";
import { appendConsentEvent, appendConsentEventGuarded } from "../consent";
```

Add this helper right after the imports:
```ts
/** Stops a contact's EMAIL in the ledger the way staff's "Stop emails" does, and lifts it with a noted Resume. */
async function stopEmail(db: Parameters<typeof appendConsentEvent>[0], accountId: string, contactId: string): Promise<string> {
  const email = (await getContact(db, accountId, contactId))!.email!;
  return (await appendConsentEvent(db, {
    accountId, channel: "email", address: email.trim().toLowerCase(), action: "revoked", method: "staff", actorId: "user_test",
  })).id;
}
async function resumeEmail(db: Parameters<typeof appendConsentEvent>[0], accountId: string, contactId: string, stopId: string): Promise<void> {
  const email = (await getContact(db, accountId, contactId))!.email!;
  const r = await appendConsentEventGuarded(db, {
    accountId, channel: "email", address: email.trim().toLowerCase(), action: "resubscribed", method: "staff",
    actorId: "user_test", note: "asked on the phone",
  }, { ifNewest: stopId });
  if (r.outcome !== "appended") throw new Error(`resumeEmail: ${r.outcome}`);
}
```

Replace the two reactivation cases (find them with `grep -n "an opted-out contact is never in the walk\|by id, an opted-out contact answers" packages/db/src/test/automations.test.ts`) with:
```ts
  // The email stop (the ledger; 0049's column no longer read, consent PR-3).
  // Left out IN THE WALK, never skipped in the pass: a stopped contact is never
  // stamped, so a pass-level skip would hand the same row back every tick and
  // refill the survivor window with it (the #118 I1 trap). One case per read.
  it("an email-stopped contact is never in the walk, and is back in it once the stop is lifted", async () => {
    await withTestAccount(async (db, accountId) => {
      const contactId = await quietCustomer(db, accountId);
      await setBranding(db, accountId, SEND_READY, "user_test");
      const ids = async () =>
        (await listDueReactivations(db, new Date("2027-09-21T12:00:00Z").toISOString())).map((r) => r.contactId);
      // The positive first, or the negative below is vacuous.
      expect(await ids()).toContain(contactId);
      const stop = await stopEmail(db, accountId, contactId);
      // Mutation: drop the readBlockedAddresses filter from listDueReactivations → this reds.
      expect(await ids()).not.toContain(contactId);
      await resumeEmail(db, accountId, contactId, stop);
      expect(await ids()).toContain(contactId);
    });
  });

  it("by id, an email-stopped contact answers `gone`, and is due again once the stop is lifted", async () => {
    await withTestAccount(async (db, accountId) => {
      const contactId = await quietCustomer(db, accountId);
      expect((await getDueReactivationById(db, contactId)).due?.contactId).toBe(contactId);
      const stop = await stopEmail(db, accountId, contactId);
      // Mutation: drop the readConsentState check from getDueReactivationById → this reds.
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "gone" });
      await resumeEmail(db, accountId, contactId, stop);
      expect((await getDueReactivationById(db, contactId)).due?.contactId).toBe(contactId);
    });
  });

  it("the 0049 column no longer decides anything: a contact stamped by the old switch but NOT stopped in the ledger is in the walk (mutation: leave `.is(\"contacts.marketing_email_opted_out_at\", null)` in the query → this reds)", async () => {
    await withTestAccount(async (db, accountId) => {
      const contactId = await quietCustomer(db, accountId);
      await setBranding(db, accountId, SEND_READY, "user_test");
      const { error } = await db.from("contacts")
        .update({ marketing_email_opted_out_at: new Date("2026-09-01T00:00:00Z").toISOString() })
        .eq("id", contactId).eq("account_id", accountId);
      expect(error).toBeNull();
      const ids = (await listDueReactivations(db, new Date("2027-09-21T12:00:00Z").toISOString())).map((r) => r.contactId);
      expect(ids).toContain(contactId);
    });
  });
```

In the referral-ask case that reads `contactMarketingEmailOptedOut` (find it with `grep -n "contactMarketingEmailOptedOut" packages/db/src/test/automations.test.ts`): delete the two `expect(row.contactMarketingEmailOptedOut)…` lines, the `await setMarketingEmailOptOut(…)` line and the mutation comment about `REFERRAL_ASK_SELECT`, and add, after the second `for (const row of await both())` loop:
```ts
      // PR-3: the row carries no opt-out of its own any more; the email gate
      // reads the ledger at send time. Mutation: put the field back → reds.
      for (const row of await both()) expect("contactMarketingEmailOptedOut" in row).toBe(false);
```

- [ ] **Step 2: Run the unit tests to see them fail**

```bash
cd packages/db
pnpm exec vitest run src/consent.test.ts
```
Expected (predicted): the new cases fail to import (`emailLedgerAddress is not a function` / `readBlockedAddresses is not a function`); every existing case passes. The two CI-only files are not run here (they fail to connect locally).

- [ ] **Step 3: Implement**

Create `packages/db/src/email-address.ts` (its own subpath, `@bis/db/email-address`, like `@bis/db/phone`: the web's email gate and token import it from there, so the many `vi.mock("@bis/db")` factories in the web tests never have to carry it — the Global Constraint's hazard, avoided by construction):
```ts
/**
 * The ledger's email key (consent chain spec §3; 0054's CHECK): trimmed,
 * lowercased, and only when 0054 would accept it — 3 to 254 characters
 * (counted as Postgres counts them, by character) with an "@" after the
 * first character. Null otherwise: there is nothing to key on. Pure. The
 * 0049 fold's SQL applies the same rule (supabase/backfills/0049-fold-write.sql).
 */
export function emailLedgerAddress(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const address = raw.trim().toLowerCase();
  const length = [...address].length;
  if (length < 3 || length > 254) return null;
  if (address.indexOf("@") < 1) return null;
  return address;
}
```

Edit `packages/db/package.json`. Find:
```json
    "./phone": "./src/phone.ts"
```
Replace with:
```json
    "./phone": "./src/phone.ts",
    "./email-address": "./src/email-address.ts"
```

Edit `packages/db/src/consent.ts`. At the top, after `import type { SupabaseClient } from "@supabase/supabase-js";`, add:
```ts
export { emailLedgerAddress } from "./email-address";
```
Find:
```ts
/** A deciding row with what the Texts row and the staff actions show and check. */
```
Insert before it:
```ts
/** One PostgREST page. A chunk that fills it is refused, never judged on. */
const BLOCKED_PAGE = 1000;
/** Addresses per read, so a page of candidates stays a short request. */
const BLOCKED_CHUNK = 100;

/**
 * Which of these addresses are NOT allowed (stopped, or held), each in its
 * own account: the keys `${accountId}|${address}`. For the due-lists that
 * must leave a stopped customer out of the WALK itself rather than skip it
 * in a pass (the reactivation walk, the #118 I1 trap). THROWS on a read
 * error, and on a chunk that fills a whole page: the caller's walk then
 * fails, and nothing is sent on a guess (fails closed, spec §5).
 */
export async function readBlockedAddresses(
  db: SupabaseClient, channel: ConsentChannel, pairs: readonly { accountId: string; address: string }[],
): Promise<Set<string>> {
  const blocked = new Set<string>();
  if (pairs.length === 0) return blocked;
  const accountIds = [...new Set(pairs.map((p) => p.accountId))];
  const addresses = [...new Set(pairs.map((p) => p.address))];
  const byKey = new Map<string, ConsentRow[]>();
  for (let i = 0; i < addresses.length; i += BLOCKED_CHUNK) {
    const { data, error } = await db.from("consent_events")
      .select("id, account_id, address, action, method, occurred_at")
      .in("account_id", accountIds).eq("channel", channel)
      .in("address", addresses.slice(i, i + BLOCKED_CHUNK))
      .in("action", [...DECIDING_ACTIONS])
      .limit(BLOCKED_PAGE);
    if (error) throw new Error(`readBlockedAddresses failed: ${error.message}`);
    const rows = (data ?? []) as (ConsentRow & { account_id: string; address: string })[];
    if (rows.length >= BLOCKED_PAGE) throw new Error(`readBlockedAddresses: a chunk returned ${BLOCKED_PAGE} rows, the whole page; refusing to judge on it`);
    for (const r of rows) {
      const key = `${r.account_id}|${r.address}`;
      const list = byKey.get(key);
      if (list) list.push(r); else byKey.set(key, [r]);
    }
  }
  for (const p of pairs) {
    const key = `${p.accountId}|${p.address}`;
    if (consentStateOf(byKey.get(key) ?? []).state !== "allowed") blocked.add(key);
  }
  return blocked;
}

```

Edit `packages/db/src/index.ts`. Find `readConsentActions, consentWriteArgs, consentAppendSql,` and replace it with `readConsentActions, consentWriteArgs, consentAppendSql, emailLedgerAddress, readBlockedAddresses,`. Find:
```ts
export { setMarketingEmailOptOut, readPhoneCountryFlag, setContactPhoneCountry, phoneFields } from "./contacts";
```
Replace with:
```ts
export { readPhoneCountryFlag, setContactPhoneCountry, phoneFields } from "./contacts";
```

Edit `packages/db/src/contacts.ts`: delete the whole `export async function setMarketingEmailOptOut(` function (with its doc comment; `grep -n "setMarketingEmailOptOut" packages/db/src/contacts.ts`), and in the contact select list (line ~21) remove `, marketing_email_opted_out_at` so it reads `…, sort_name, phone_country_unconfirmed";`. Replace the comment above that list that starts `` // `marketing_email_opted_out_at` (0049) rides along `` with:
```ts
// `marketing_email_opted_out_at` (0049) is no longer read (consent PR-3): the
// email stop lives in the ledger, and a later migration drops the column.
```

Edit `packages/db/src/automations.ts`:
1. `REFERRAL_ASK_SELECT`: `contacts(account_id, email, phone, marketing_email_opted_out_at)` becomes `contacts(account_id, email, phone)`.
2. In `DueReferralAsk`, delete the `contactMarketingEmailOptedOut: boolean;` field and its doc comment (the block beginning `/** Migration 0049: the operator recorded that this contact asked not to`).
3. In `toDueReferralAsk`, delete `contactMarketingEmailOptedOut: r.contacts?.marketing_email_opted_out_at != null,`.
4. Add, after the file's existing imports: `import { emailLedgerAddress } from "./email-address";` and `import { readBlockedAddresses, readConsentState } from "./consent";` (consent.ts imports nothing from automations.ts, so there is no cycle).
5. In `listDueReactivations`, find:
```ts
      .is("contacts.reactivation_sent_at", null)
      // THE MARKETING-EMAIL OPT-OUT (0049), IN THE QUERY and never as a skip
      // in the pass. An opted-out contact is never sent to, so never stamped:
      // skipped per row, it would come back on every tick at the head of this
      // oldest-first walk and refill the survivor window, starving every
      // other account (the #118 I1 trap, one contact at a time). Here it
      // never enters a page at all.
      .is("contacts.marketing_email_opted_out_at", null)
      .not("contacts.email", "is", null)
```
Replace with:
```ts
      .is("contacts.reactivation_sent_at", null)
      .not("contacts.email", "is", null)
```
and find:
```ts
    const candidates = rows.filter(
      (c) => c.contacts.account_id === c.account_id
        && new Date(c.last_message_at).getTime() <= cutoffs.get(c.account_id)!.cutoff.getTime());
```
Replace with:
```ts
    const inWindow = rows.filter(
      (c) => c.contacts.account_id === c.account_id
        && new Date(c.last_message_at).getTime() <= cutoffs.get(c.account_id)!.cutoff.getTime());

    // THE EMAIL STOP (the ledger, consent PR-3; 0049's column is no longer
    // read), IN THE WALK and never as a skip in the pass. A stopped contact is
    // never sent to, so never stamped: skipped per row it would come back on
    // every tick at the head of this oldest-first walk and refill the survivor
    // window, starving every other account (the #118 I1 trap). Here it is
    // dropped before it can count as a survivor. It still takes a slot in
    // the page it arrived in (Known residuals). A ledger that cannot be read
    // THROWS out of the walk: nothing is sent on a guess.
    const keyed = inWindow.map((c) => ({ c, address: emailLedgerAddress(c.contacts.email) }));
    const blocked = await readBlockedAddresses(db, "email",
      keyed.flatMap(({ c, address }) => (address ? [{ accountId: c.account_id, address }] : [])));
    const candidates = keyed
      .filter(({ c, address }) => address !== null && !blocked.has(`${c.account_id}|${address}`))
      .map(({ c }) => c);
```
6. In `getDueReactivationById`, find:
```ts
    .eq("id", contactId).is("reactivation_sent_at", null)
    // The opt-out (0049), same as the walk's: a hold released after the
    // operator recorded "stop" answers `gone` and leaves the queue unsent.
    .is("marketing_email_opted_out_at", null)
    .not("email", "is", null).maybeSingle();
  if (error) throw new Error(`getDueReactivationById failed: ${error.message}`);
  if (!contact) return { due: null, why: "gone" };
  const accountId = (contact as { account_id: string }).account_id;
```
Replace with:
```ts
    .eq("id", contactId).is("reactivation_sent_at", null)
    .not("email", "is", null).maybeSingle();
  if (error) throw new Error(`getDueReactivationById failed: ${error.message}`);
  if (!contact) return { due: null, why: "gone" };
  const accountId = (contact as { account_id: string }).account_id;
  // The email stop, same as the walk's: a hold released after the customer
  // unsubscribed (or staff stopped their email) answers `gone` and leaves the
  // queue unsent. A ledger read error THROWS (the release retries it).
  const address = emailLedgerAddress((contact as { email: string }).email);
  if (!address) return { due: null, why: "gone" };
  if ((await readConsentState(db, accountId, "email", address)).state !== "allowed") return { due: null, why: "gone" };
```

- [ ] **Step 4: Run the unit tests and the typecheck**

```bash
cd packages/db
pnpm exec vitest run src/consent.test.ts
pnpm typecheck
```
Expected (predicted): all pass; the typecheck is clean (the CI-only test files compile against the new imports). `pnpm --filter web typecheck` is NOT run here: it fails in the four apps/web files named at Checkpoint A until Tasks 6 and 11.

- [ ] **Step 5: Probes** (apply one at a time to the finished task; each must turn the named test red; revert after each)

| # | Mutation | Must fail |
|---|---|---|
| 1 | `emailLedgerAddress`: drop `.toLowerCase()` | "trims and lowercases" |
| 2 | `emailLedgerAddress`: `indexOf("@") < 1` → `< 0` | "refuses what 0054's CHECK refuses" |
| 3 | `emailLedgerAddress`: `[...address].length` → `address.length` | "counts characters, not UTF-16 units" |
| 4 | `readBlockedAddresses`: key on `r.address` alone and test `blocked.has(p.address)` | "keys `${account}|${address}`…" |
| 5 | `readBlockedAddresses`: delete `.eq("channel", channel)` | "reads only deciding rows of that channel…" |
| 6 | `readBlockedAddresses`: delete the `rows.length >= BLOCKED_PAGE` throw | "THROWS on a read error, and on a full 1000-row page" |
| 7 | `readBlockedAddresses`: `BLOCKED_CHUNK = 1000` | "chunks the addresses by 100" |
| 8 | (CI, recorded at Task 15 step 4) `listDueReactivations`: `const candidates = inWindow;` | automations.test.ts "an email-stopped contact is never in the walk" |
| 9 | (CI) `getDueReactivationById`: delete the `readConsentState` line | automations.test.ts "by id, an email-stopped contact answers `gone`" |

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/email-address.ts packages/db/package.json packages/db/src/consent.ts packages/db/src/consent.test.ts packages/db/src/index.ts packages/db/src/automations.ts packages/db/src/contacts.ts packages/db/src/test/automations.test.ts packages/db/src/test/contacts.test.ts
git commit -m "feat(consent): the ledger's email key and blocked-address read; reactivation and the referral ask stop reading 0049's column"
```

---

### Task 2: The 0049 fold: the count, the write, and their proof on the replica

**Owner:** bis-db-schema. **Tier:** HIGH. **Questions:** Q7 (the count is shown to danlo before the write, Task 15).

**Files:**
- Create: `packages/db/supabase/backfills/0049-fold-count.sql` (read only)
- Create: `packages/db/supabase/backfills/0049-fold-write.sql` (one statement; writes through 0055's function)
- Create: `packages/db/src/test/email-optout-fold.test.ts` (`withRollback`: the replica's `post` and CI)
- Modify: `packages/db/src/ci/sql-files.test.ts`

**Interfaces:**
- Consumes: `public.append_consent_event` (0055) with guard `none` — its `backfill_0049` rule refuses the row over ANY existing stop, whatever the guard (0055's comment, "review m1, B1"); `public.contacts.marketing_email_opted_out_at` (0049).
- Produces: the two SQL files Task 15 pastes into `execute_sql` on production. The count answers ONE row; the write answers one row per outcome (`appended`, `duplicate`, `refused`).

**What the fold decides** (spec §4.3 "The 0049 fold", choice 24, G12):
- One `revoked` / `backfill_0049` row per ACCOUNT AND ADDRESS (the ledger's key), dated at the EARLIEST opt-out among that account's contacts with that address, `contact_id` = that contact, `source_ref` = `contact:<id>:0049:<the opt-out's own instant>` (ONE event: S10), evidence `{ "column": "contacts.marketing_email_opted_out_at", "contactId": "<id>" }`.
- The address rule is `emailLedgerAddress`'s: whitespace trimmed (space, tab, line breaks), lowercased, 3–254 characters, `@` after the first character — restricted here to printable ASCII. An address outside that is counted (`left_out_needs_a_look`) and never written: staff stop it by hand from the Email row.
- Re-running it writes nothing new: the same source answers `duplicate`; a different contact of an already-folded address answers `refused` (0055's rule).

- [ ] **Step 1: Write the failing tests**

Create `packages/db/src/test/email-optout-fold.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Client } from "pg";
import { withRollback } from "./db";

/**
 * The 0049 fold (consent chain PR-3, plan Task 2): the two SQL files Task 15
 * pastes into execute_sql on production, run here as written, against 0055's
 * function, on the replica's `post` and on the CI project. withRollback only.
 *
 * RED BEFORE THIS TASK: the two files do not exist.
 */
const sql = (name: string) => readFileSync(fileURLToPath(new URL(`../../supabase/backfills/${name}`, import.meta.url)), "utf8");
const RUN = Math.random().toString(36).slice(2, 10);

async function account(c: Client, label: string): Promise<string> {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  return (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name) values ($1, $2, $3) returning id",
    [agency!.id, `org_FOLD_${label}_${RUN}`, `Fold ${label}`])).rows[0]!.id;
}
async function contact(c: Client, accountId: string, email: string | null, optedOutAt: string | null): Promise<string> {
  return (await c.query<{ id: string }>(
    "insert into contacts (account_id, first_name, email, marketing_email_opted_out_at) values ($1, 'Fold', $2, $3) returning id",
    [accountId, email, optedOutAt])).rows[0]!.id;
}
/** As service_role, the function's only grantee besides its owner (0055). */
async function asService<T>(c: Client, q: string): Promise<T[]> {
  await c.query("set local role service_role");
  try {
    return (await c.query(q)).rows as T[];
  } finally {
    await c.query("reset role");
  }
}
type Outcome = { outcome: string; n: number };
const outcomes = (rows: Outcome[]) => Object.fromEntries(rows.map((r) => [r.outcome, Number(r.n)]));

/**
 * The fixture, in one fresh account (the counts below are scoped to it by
 * a WHERE the test adds around the file's own statement, so rows from other
 * accounts on the CI project cannot move them):
 *   ana1  opted out 2026-09-01, "  Ana@X.com " (spaces, capitals)
 *   ana2  opted out 2026-09-05, "ana@x.com" — the same address, later
 *   ana3  NOT opted out, "ANA@x.com" — the same address: it stops too
 *   none  opted out, no email
 *   uni   opted out, "ñandu@x.com" — outside printable ASCII: left out
 *   fe    opted out, "fe@x.com", already stopped by the customer (one_click)
 *   gee   opted out, "gee@x.com", a booking in 7 days
 */
async function fixture(c: Client) {
  const a = await account(c, "one");
  const ids = {
    ana1: await contact(c, a, "  Ana@X.com ", "2026-09-01T10:00:00Z"),
    ana2: await contact(c, a, "ana@x.com", "2026-09-05T10:00:00Z"),
    ana3: await contact(c, a, "ANA@x.com", null),
    none: await contact(c, a, null, "2026-09-02T10:00:00Z"),
    uni: await contact(c, a, "ñandu@x.com", "2026-09-03T10:00:00Z"),
    fe: await contact(c, a, "fe@x.com", "2026-09-04T10:00:00Z"),
    gee: await contact(c, a, "gee@x.com", "2026-09-06T10:00:00Z"),
  };
  await asService(c, `select * from public.append_consent_event('${a}', 'email', 'fe@x.com', 'revoked', 'one_click', 'none', null, null, null, null, null, '{}'::jsonb, null)`);
  const cal = (await c.query<{ id: string }>(
    "insert into calendars (account_id, public_id) values ($1, $2) returning id", [a, `fold-${RUN}`])).rows[0]!.id;
  await c.query(
    "insert into bookings (account_id, calendar_id, contact_id, starts_at, ends_at, cancel_token) values ($1, $2, $3, now() + interval '7 days', now() + interval '7 days 1 hour', $4)",
    [a, cal, ids.gee, `fold-cancel-${RUN}`]);
  return { a, ids };
}

/** The file's OWN statement, narrowed to one account (the CI project holds
 *  other accounts' contacts): the first CTE's filter gains the account. */
const OPTED_FILTER = "   where c.marketing_email_opted_out_at is not null";
const scoped = (file: string, accountId: string) => {
  const text = sql(file);
  expect(text.split(OPTED_FILTER).length, `${file} must hold its opted-out filter exactly once`).toBe(2);
  return text.replace(OPTED_FILTER, `${OPTED_FILTER} and c.account_id = '${accountId}'`);
};

describe("0049-fold-count.sql", () => {
  it("counts what the fold would write and what it widens, naming no customer (mutation: count contacts instead of distinct addresses → to_fold_addresses 4, FAILS; drop the ASCII rule → left_out_needs_a_look 0, FAILS)", () =>
    withRollback(async (c) => {
      const { a } = await fixture(c);
      const [row] = await asService<Record<string, unknown>>(c, scoped("0049-fold-count.sql", a));
      expect({
        opted_out_contacts: Number(row!.opted_out_contacts),
        no_email: Number(row!.no_email),
        left_out_needs_a_look: Number(row!.left_out_needs_a_look),
        to_fold_addresses: Number(row!.to_fold_addresses),
        accounts: Number(row!.accounts),
        already_stopped_or_decided: Number(row!.already_stopped_or_decided),
        other_contacts_sharing_an_address: Number(row!.other_contacts_sharing_an_address),
        with_a_booking_in_30_days: Number(row!.with_a_booking_in_30_days),
        future_stamps: Number(row!.future_stamps),
      }).toEqual({
        opted_out_contacts: 6, no_email: 1, left_out_needs_a_look: 1, to_fold_addresses: 3, accounts: 1,
        already_stopped_or_decided: 1, other_contacts_sharing_an_address: 1, with_a_booking_in_30_days: 1, future_stamps: 0,
      });
      expect(row!.can_write).toBe(true);
    }));
});

describe("0049-fold-write.sql", () => {
  it("writes ONE backfill_0049 stop per address, dated at the earliest opt-out, sourced to that one event; refuses an address the customer already stopped (mutation: order the DISTINCT ON by the stamp DESC → occurred_at is 2026-09-05, FAILS)", () =>
    withRollback(async (c) => {
      const { a, ids } = await fixture(c);
      expect(outcomes(await asService<Outcome>(c, scoped("0049-fold-write.sql", a)))).toEqual({ appended: 2, refused: 1 });
      const { rows } = await c.query<{ address: string; occurred_at: Date; contact_id: string; source_ref: string; evidence: Record<string, unknown> }>(
        "select address, occurred_at, contact_id, source_ref, evidence from consent_events where account_id = $1 and method = 'backfill_0049' order by address", [a]);
      expect(rows.map((r) => r.address)).toEqual(["ana@x.com", "gee@x.com"]);
      expect(rows[0]!.occurred_at.toISOString()).toBe("2026-09-01T10:00:00.000Z");
      expect(rows[0]!.contact_id).toBe(ids.ana1);
      expect(rows[0]!.source_ref).toBe(`contact:${ids.ana1}:0049:2026-09-01T10:00:00.000000Z`);
      expect(rows[0]!.evidence).toEqual({ column: "contacts.marketing_email_opted_out_at", contactId: ids.ana1 });
    }));

  it("is idempotent: a second run writes nothing — the same source answers duplicate, the refused stays refused (spec §5 'Backfills are idempotent'; mutation: a source_ref without the instant, e.g. just the contact id, still dedupes — so instead mutate the source to include now() → the second run appends 2, FAILS)", () =>
    withRollback(async (c) => {
      const { a } = await fixture(c);
      await asService(c, scoped("0049-fold-write.sql", a));
      expect(outcomes(await asService<Outcome>(c, scoped("0049-fold-write.sql", a)))).toEqual({ duplicate: 2, refused: 1 });
      const { rows: [n] } = await c.query<{ n: string }>("select count(*) as n from consent_events where account_id = $1 and method = 'backfill_0049'", [a]);
      expect(Number(n!.n)).toBe(2);
    }));

  it("never lands over a later customer act: after a resubscribe, a delta run's older row does not change the state (0055 appends it, older; the reducer keeps the resubscribe; mutation: pass clock_timestamp() as the row's time in the file → the backfill row is newest and the address reads stopped, FAILS)", () =>
    withRollback(async (c) => {
      const { a } = await fixture(c);
      await asService(c, `select * from public.append_consent_event('${a}', 'email', 'gee@x.com', 'revoked', 'one_click', 'none', null, null, null, null, null, '{}'::jsonb, null)`);
      await c.query("select pg_sleep(0.002)");
      await asService(c, `select * from public.append_consent_event('${a}', 'email', 'gee@x.com', 'resubscribed', 'unsubscribe_page', 'if_stopped_or_held', null, null, null, null, null, '{}'::jsonb, null)`);
      await asService(c, scoped("0049-fold-write.sql", a));
      const { rows: [newest] } = await c.query<{ action: string }>(
        `select action from consent_events where account_id = $1 and channel = 'email' and address = 'gee@x.com'
            and action in ('revoked','held','hold_released','resubscribed')
          order by date_trunc('milliseconds', occurred_at) desc,
                   case action when 'revoked' then 3 when 'held' then 2 else 1 end desc, id desc limit 1`, [a]);
      expect(newest!.action).toBe("resubscribed");
    }));
});
```

**About `scoped`:** both files open with the CTE `opted`, whose filter line is exactly `   where c.marketing_email_opted_out_at is not null` (three spaces). The helper adds `and c.account_id = '<id>'` to that one line, so the test runs each FILE'S OWN statement narrowed only by account, and fails loudly if the line is missing or doubled.

Edit `packages/db/src/ci/sql-files.test.ts`. Find:
```ts
  "backfills/0055-telnyx-optout-owners.sql",
];
```
Replace with:
```ts
  "backfills/0055-telnyx-optout-owners.sql",
  "backfills/0049-fold-count.sql",
];
/** Backfills that WRITE (through the ledger's function): the same byte rules,
 *  refused as a read, and no transaction control of their own. */
const WRITES = ["backfills/0049-fold-write.sql"];
```
and append at the end of the file:
```ts
describe("CI SQL files: the backfills that write", () => {
  it.each(WRITES)("%s is ASCII only and has no backslash (the MCP apply rule; mutation: an E'' escape → FAILS)", (f) => {
    const text = read(f);
    expect([...text].filter((ch) => ch.charCodeAt(0) > 0x7e || (ch.charCodeAt(0) < 0x20 && ch !== "\n" && ch !== "\r"))).toEqual([]);
    expect(text.includes(String.fromCharCode(0x5c))).toBe(false);
  });

  it.each(WRITES)("%s is refused as a read, and runs with --allow-write (no transaction control; mutation: add `commit;` → FAILS)", (f) => {
    expect(sqlRefusals(read(f), { allowWrite: false }).length).toBeGreaterThan(0);
    expect(sqlRefusals(read(f), { allowWrite: true })).toEqual([]);
  });

  it.each(WRITES)("%s is ONE statement, so execute_sql shows its whole answer (review R1-M3's lesson; mutation: split it in two → FAILS)", (f) => {
    const statements = read(f).replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to see them fail**

Replica up (Prerequisites 2), then:
```bash
cd packages/db
SUPABASE_DB_URL=postgresql://postgres@localhost:55433/post pnpm exec vitest run src/test/email-optout-fold.test.ts src/ci/sql-files.test.ts
```
Expected (predicted): every case fails with ENOENT on the two new files.

- [ ] **Step 3: Write the two files**

Create `packages/db/supabase/backfills/0049-fold-count.sql`:
```sql
-- 0049-fold-count.sql
-- Consent chain PR-3 (plan Task 2; run in Task 15 step 3). READ ONLY.
-- What the 0049 fold would write, and what it widens (choice 24), before
-- anything is written: one row of counts, no customer named. Run on
-- production through execute_sql under danlo's go. ASCII only, no backslash
-- (the MCP rule). The address rule is emailLedgerAddress's (packages/db/src/
-- consent.ts): whitespace trimmed, lowercased, 3 to 254 characters, an @
-- after the first character; restricted here to printable ASCII, so any
-- other address is counted as left_out_needs_a_look and never written.
with opted as (
  select c.id, c.account_id, c.marketing_email_opted_out_at as at,
         lower(btrim(c.email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))) as address
    from public.contacts c
   where c.marketing_email_opted_out_at is not null
), judged as (
  select o.*,
         coalesce(o.address <> ''
           and char_length(o.address) between 3 and 254
           and position('@' in o.address) > 1
           and o.address !~ '[^ -~]', false) as valid
    from opted o
), folded as (
  select distinct account_id, address from judged where valid
)
select
  (select count(*) from judged) as opted_out_contacts,
  (select count(*) from judged where address is null or address = '') as no_email,
  (select count(*) from judged where not valid and address is not null and address <> '') as left_out_needs_a_look,
  (select count(*) from folded) as to_fold_addresses,
  (select count(distinct account_id) from folded) as accounts,
  (select count(*) from folded f
    where exists (select 1 from public.consent_events e
                   where e.account_id = f.account_id and e.channel = 'email' and e.address = f.address
                     and e.action in ('revoked', 'held', 'hold_released', 'resubscribed'))) as already_stopped_or_decided,
  (select count(*) from public.contacts c
     join folded f on f.account_id = c.account_id
                  and f.address = lower(btrim(c.email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13)))
    where c.marketing_email_opted_out_at is null) as other_contacts_sharing_an_address,
  (select count(*) from folded f
    where exists (select 1 from public.bookings b
                    join public.contacts c on c.id = b.contact_id and c.account_id = b.account_id
                   where b.account_id = f.account_id and b.status = 'booked'
                     and b.starts_at between now() and now() + interval '30 days'
                     and lower(btrim(c.email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))) = f.address)) as with_a_booking_in_30_days,
  (select count(*) from judged where at > now()) as future_stamps,
  has_function_privilege(current_user,
    'public.append_consent_event(uuid, text, text, text, text, text, uuid, uuid, text, text, text, jsonb, timestamptz)',
    'EXECUTE') as can_write;
```

Create `packages/db/supabase/backfills/0049-fold-write.sql`:
```sql
-- 0049-fold-write.sql
-- Consent chain PR-3 (plan Task 2; run in Task 15 steps 5 and 8). ONE
-- statement, so execute_sql shows its whole answer: one row per outcome.
-- Folds every 0049 "No marketing emails" stamp into the ledger as
-- revoked / backfill_0049 (spec 4.3, choice 24), ONE row per account and
-- address, dated at the EARLIEST stamp among that account's contacts with
-- that address, through 0055's function (the ledger's one write path). Guard
-- 'none': 0055 refuses a backfill_0049 stop over ANY existing stop whatever
-- the guard, so an address the customer already stopped answers 'refused'.
-- source_ref names ONE event, the stamp at its own instant (spec 3, PR-2
-- S10), so a re-run answers 'duplicate' and writes nothing. The address rule
-- is 0049-fold-count.sql's (emailLedgerAddress, printable ASCII only).
-- ASCII only, no backslash (the MCP rule). No transaction control.
with opted as (
  select c.id, c.account_id, c.marketing_email_opted_out_at as at,
         lower(btrim(c.email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))) as address
    from public.contacts c
   where c.marketing_email_opted_out_at is not null
), valid as (
  select distinct on (o.account_id, o.address) o.id, o.account_id, o.address, o.at
    from opted o
   where o.address <> ''
     and char_length(o.address) between 3 and 254
     and position('@' in o.address) > 1
     and o.address !~ '[^ -~]'
     and o.at <= now()
   order by o.account_id, o.address, o.at asc, o.id asc
)
select r.outcome, count(*)::int as n
  from valid v
  cross join lateral public.append_consent_event(
    v.account_id, 'email', v.address, 'revoked', 'backfill_0049', 'none', null,
    v.id, null, null,
    'contact:' || v.id::text || ':0049:' || to_char(v.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    jsonb_build_object('column', 'contacts.marketing_email_opted_out_at', 'contactId', v.id::text),
    v.at) r
 group by r.outcome
 order by r.outcome;
```

(`'[^ -~]'` is a bracket expression from space to tilde: printable ASCII. No backslash anywhere.)

- [ ] **Step 4: Run the tests to see them pass**

```bash
cd packages/db
SUPABASE_DB_URL=postgresql://postgres@localhost:55433/post pnpm exec vitest run src/test/email-optout-fold.test.ts src/ci/sql-files.test.ts
```
Expected (predicted): all pass.

- [ ] **Step 5: Probes** (edit the REAL file the test reads, run, then `git checkout --` it)

| # | Mutation | Must fail |
|---|---|---|
| 1 | count: `select count(*) from folded` → `select count(*) from judged where valid` | the count case (to_fold_addresses 4) |
| 2 | count and write: drop `and o.address !~ '[^ -~]'` / the same line in `judged` | the count case (left_out 0); the write case (appended 3) |
| 3 | write: `o.at asc` → `o.at desc` | the write case (occurred_at 2026-09-05) |
| 4 | write: the source_ref ends `\|\| now()::text` instead of the stamp | the idempotence case (second run appends 2) |
| 5 | write: `v.at) r` → `clock_timestamp()) r` | "never lands over a later customer act" |
| 6 | write: add a second statement `select 1;` | "is ONE statement" |
| 7 | write: `'none'` → `'if_empty'` | the write case (ana's address has no row: still appended; gee's too; fe refused — outcomes unchanged) — this probe is EXPECTED to stay green, and proves the guard does not matter here: 0055's `backfill_0049` rule is what refuses. Record it as such. |

- [ ] **Step 6: Commit**

```bash
git add packages/db/supabase/backfills/0049-fold-count.sql packages/db/supabase/backfills/0049-fold-write.sql packages/db/src/test/email-optout-fold.test.ts packages/db/src/ci/sql-files.test.ts
git commit -m "feat(consent): the 0049 fold — a counted, idempotent backfill_0049 write through the ledger's function"
```

---

### Task 3: The unsubscribe token (sealed and signed, no table)

**Owner:** bis-comms. **Tier:** HIGH. **Questions:** [Q3] (encrypted as well as signed; the plain signed form is the alternative).

**Files:**
- Create: `apps/web/src/lib/consent/token.ts`, `apps/web/src/lib/consent/token.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `emailLedgerAddress` (Task 1).
- Produces:
  - `type ConsentTokenPayload = { v: 1; a: string; c: "email"; t: string; i: number; n: string | null; k?: string }` — `a` the account id, `c` the channel, `t` the ledger address, `i` the issue time (ms), `n` the contact id (evidence only), `k` the email kind that carried it (evidence only).
  - `sealConsentToken(p: ConsentTokenPayload, secret: string): string` — `1.<body>.<mac>`, URL-safe, ASCII.
  - `openConsentToken(token: unknown, secrets: readonly (string | null | undefined)[]): ConsentTokenPayload | null` — tries each secret in order; null for anything it cannot prove.
  - `consentTokenSecrets(env?: NodeJS.ProcessEnv): { current: string | null; previous: string | null }` — `CONSENT_TOKEN_SECRET`, `CONSENT_TOKEN_SECRET_PREVIOUS`, trimmed, blank = null. No fallback to any other key (spec §4.3).
  - `isUuid(v: unknown): v is string` — the opener's own uuid rule, so a sealer never mints a token its opener refuses (the gate passes `n` only through it).

**The format [Q3]:** `1.` + base64url(iv(12) ‖ AES-256-GCM ciphertext ‖ tag(16)) + `.` + base64url(HMAC-SHA256(macKey, `"1." + body`)). `encKey` and `macKey` are HKDF-SHA256 of the secret with salt `bis-consent-token` and infos `enc-v1` / `mac-v1`. The HMAC is checked first, in constant time; only a token that proves its MAC is decrypted. Tokens never expire (X4: the opt-out must work for at least 30 days). **If danlo answers Q3 "only signed":** `body` becomes base64url(JSON) with no cipher, `openConsentToken` parses it after the MAC check, and the two "cannot read the address" tests below are deleted; nothing else in the plan changes.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/consent/token.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sealConsentToken, openConsentToken, consentTokenSecrets, isUuid, type ConsentTokenPayload } from "./token";

/**
 * The unsubscribe token (spec §4.3 "The token", plan Task 3, [Q3]). §8's
 * list: sign and verify, a tampered payload, a wrong secret, the previous
 * secret. Plus: nobody can read the address out of it, and it is URL-safe.
 */
const SECRET = "test-secret-0123456789abcdef-0123456789";
const OTHER = "another-secret-0123456789abcdef-012345";
const P: ConsentTokenPayload = {
  v: 1, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email", t: "ana.lopez@example.com",
  i: Date.parse("2026-10-01T15:00:00Z"), n: "0c9a8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d", k: "automation.reminder",
};

describe("sealConsentToken / openConsentToken", () => {
  it("round-trips the payload (mutation: open with the wrong key derivation info → null, FAILS)", () => {
    expect(openConsentToken(sealConsentToken(P, SECRET), [SECRET])).toEqual(P);
  });

  it("is URL-safe ASCII in three dot-separated parts, starting with its version (mutation: base64 instead of base64url → '+' or '/' appears for some token, FAILS over 200 seals)", () => {
    for (let i = 0; i < 200; i++) {
      const t = sealConsentToken({ ...P, i: P.i + i }, SECRET);
      expect(t).toMatch(/^1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    }
  });

  it("does not carry the address, the account or the kind in readable form, even base64-decoded (plan G2, [Q3]; mutation: store the JSON unencrypted → the decoded body contains the address, FAILS)", () => {
    const t = sealConsentToken(P, SECRET);
    const decoded = Buffer.from(t.split(".")[1]!, "base64url").toString("latin1");
    for (const secret of [P.t, "ana.lopez", P.a, "automation.reminder"]) {
      expect(t).not.toContain(secret);
      expect(decoded).not.toContain(secret);
    }
  });

  it("two seals of the same payload differ (a fresh IV each time), and both open (mutation: a fixed IV → identical tokens, FAILS)", () => {
    const one = sealConsentToken(P, SECRET);
    const two = sealConsentToken(P, SECRET);
    expect(one).not.toBe(two);
    expect(openConsentToken(two, [SECRET])).toEqual(P);
  });

  it("a wrong secret opens nothing (mutation: derive both keys from a constant instead of the secret → the other secret's token opens, FAILS)", () => {
    expect(openConsentToken(sealConsentToken(P, SECRET), [OTHER])).toBeNull();
  });

  it("the PREVIOUS secret still opens a token sealed before a rotation (spec §4.3; mutation: try only the first secret → null, FAILS)", () => {
    const old = sealConsentToken(P, OTHER);
    expect(openConsentToken(old, [SECRET, OTHER])).toEqual(P);
    expect(openConsentToken(old, [SECRET, null])).toBeNull();
  });

  it("a tampered body, a tampered MAC, a swapped body, a wrong version or a wrong shape opens nothing (mutation: compare the MAC with === on strings → still refuses; mutation: return the payload before checking the version → '2.' opens, FAILS)", () => {
    const t = sealConsentToken(P, SECRET);
    const [, body, mac] = t.split(".") as [string, string, string];
    const flip = (s: string) => (s[5] === "A" ? `${s.slice(0, 5)}B${s.slice(6)}` : `${s.slice(0, 5)}A${s.slice(6)}`);
    const other = sealConsentToken({ ...P, t: "bo@example.com" }, SECRET).split(".")[1]!;
    for (const bad of [
      `1.${flip(body)}.${mac}`, `1.${body}.${flip(mac)}`, `1.${other}.${mac}`, `2.${body}.${mac}`,
      `1.${body}`, `${t}.x`, "", "1..", "not a token",
    ]) expect(openConsentToken(bad, [SECRET])).toBeNull();
    expect(openConsentToken(undefined, [SECRET])).toBeNull();
    expect(openConsentToken(12345, [SECRET])).toBeNull();
    expect(openConsentToken(`1.${"A".repeat(5000)}.${mac}`, [SECRET])).toBeNull();
  });

  it("refuses a payload whose shape is wrong even under a valid MAC: another channel, an address the ledger would not key, a non-uuid account, a non-finite time (mutation: drop the shape check → the SMS payload opens, FAILS)", () => {
    const bad = [
      { ...P, c: "sms" }, { ...P, t: "Ana@Example.com" }, { ...P, t: "no-at-sign" },
      { ...P, a: "acct_1" }, { ...P, i: Number.NaN }, { ...P, n: "contact_1" }, { ...P, v: 2 },
    ];
    for (const p of bad) expect(openConsentToken(sealConsentToken(p as ConsentTokenPayload, SECRET), [SECRET])).toBeNull();
  });

  it("n and k are optional: a payload without them opens with n null and no k", () => {
    const bare: ConsentTokenPayload = { v: 1, a: P.a, c: "email", t: P.t, i: P.i, n: null };
    expect(openConsentToken(sealConsentToken(bare, SECRET), [SECRET])).toEqual(bare);
  });

  it("sealing with no secret throws: a caller must never mint a token nobody can check (mutation: fall back to '' → a token opens with the empty secret, FAILS)", () => {
    expect(() => sealConsentToken(P, "")).toThrow(/no secret/);
    expect(openConsentToken(sealConsentToken(P, SECRET), ["", null, undefined])).toBeNull();
  });
});

describe("isUuid", () => {
  it("is the opener's own rule (mutation: accept any string → 'ct_1' passes, FAILS)", () => {
    expect(isUuid(P.a)).toBe(true);
    expect(isUuid("ct_1")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});

describe("consentTokenSecrets", () => {
  it("reads the two variables, trimmed, blank as null — and NOTHING else, not the service-role key (spec §4.3: no fallback; mutation: fall back to SUPABASE_SERVICE_ROLE_KEY → current is set, FAILS)", () => {
    expect(consentTokenSecrets({ CONSENT_TOKEN_SECRET: "  s1  ", CONSENT_TOKEN_SECRET_PREVIOUS: "s0" } as NodeJS.ProcessEnv))
      .toEqual({ current: "s1", previous: "s0" });
    expect(consentTokenSecrets({ CONSENT_TOKEN_SECRET: "   ", SUPABASE_SERVICE_ROLE_KEY: "svc", FORM_TOKEN_SECRET: "f" } as NodeJS.ProcessEnv))
      .toEqual({ current: null, previous: null });
  });
});
```

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/token.test.ts
```
Expected (predicted): the file fails to import `./token`.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/consent/token.ts`:
```ts
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { emailLedgerAddress } from "@bis/db/email-address";

/**
 * The unsubscribe token (consent chain spec §4.3; decision 6: signed, no
 * token table). It carries the account, the channel and the address the
 * ledger keys on, and — for the record only — the contact and the kind of
 * email it came in. Its body is ENCRYPTED as well as signed (plan G2, [Q3]),
 * so no one reading a URL (a request log, a mail scanner, a browser's
 * history, a Referer) can read the customer's address out of it.
 *
 *   1.<base64url(iv | AES-256-GCM(JSON) | tag)>.<base64url(HMAC-SHA256)>
 *
 * Both keys come from CONSENT_TOKEN_SECRET through HKDF, never from any
 * other credential (spec: no fallback to the service-role key, unlike the
 * form render token). CONSENT_TOKEN_SECRET_PREVIOUS still opens tokens
 * sealed before a rotation. Tokens never expire: CAN-SPAM wants the way out
 * to work for at least 30 days after the email (plan X4), and a link in an
 * old email should still work years later.
 *
 * The MAC is checked FIRST, in constant time; only a token that proves it is
 * decrypted. Never log a token.
 */
export type ConsentTokenPayload = {
  v: 1;
  /** The account (uuid). */
  a: string;
  c: "email";
  /** The ledger address (emailLedgerAddress). */
  t: string;
  /** Issued at, ms since the epoch. */
  i: number;
  /** The contact the email went to (uuid), evidence only; null when unknown. */
  n: string | null;
  /** The email kind that carried it, evidence only. */
  k?: string;
};

const VERSION = "1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
/** Far longer than any real token (~330 characters); a bound on work. */
const MAX_TOKEN_LENGTH = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The opener's uuid rule, for a sealer that must not mint what it refuses. */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID.test(v);
}
/** Date's own range, so `new Date(i)` can never throw downstream. */
const MAX_TIME = 8.64e15;

function keys(secret: string): { enc: Buffer; mac: Buffer } {
  return {
    enc: Buffer.from(hkdfSync("sha256", secret, "bis-consent-token", "enc-v1", 32)),
    mac: Buffer.from(hkdfSync("sha256", secret, "bis-consent-token", "mac-v1", 32)),
  };
}

const macOf = (macKey: Buffer, body: string) => createHmac("sha256", macKey).update(`${VERSION}.${body}`).digest();

export function sealConsentToken(p: ConsentTokenPayload, secret: string): string {
  if (!secret) throw new Error("sealConsentToken: no secret");
  const { enc, mac } = keys(secret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", enc, iv);
  const json = JSON.stringify({ v: p.v, a: p.a, c: p.c, t: p.t, i: p.i, n: p.n, ...(p.k ? { k: p.k } : {}) });
  const sealed = Buffer.concat([iv, cipher.update(json, "utf8"), cipher.final(), cipher.getAuthTag()]);
  const body = sealed.toString("base64url");
  return `${VERSION}.${body}.${macOf(mac, body).toString("base64url")}`;
}

function shapeOf(x: unknown): ConsentTokenPayload | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || o.c !== "email") return null;
  if (typeof o.a !== "string" || !UUID.test(o.a)) return null;
  if (typeof o.t !== "string" || emailLedgerAddress(o.t) !== o.t) return null;
  if (typeof o.i !== "number" || !Number.isFinite(o.i) || Math.abs(o.i) > MAX_TIME) return null;
  if (o.n !== undefined && o.n !== null && (typeof o.n !== "string" || !UUID.test(o.n))) return null;
  if (o.k !== undefined && typeof o.k !== "string") return null;
  return { v: 1, a: o.a, c: "email", t: o.t, i: o.i, n: (o.n as string | null | undefined) ?? null, ...(typeof o.k === "string" ? { k: o.k } : {}) };
}

export function openConsentToken(token: unknown, secrets: readonly (string | null | undefined)[]): ConsentTokenPayload | null {
  if (typeof token !== "string" || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, body, sig] = parts as [string, string, string];
  if (!body || !sig) return null;
  const got = Buffer.from(sig, "base64url");
  for (const secret of secrets) {
    if (!secret) continue;
    const { enc, mac } = keys(secret);
    const want = macOf(mac, body);
    if (got.length !== want.length || !timingSafeEqual(got, want)) continue;
    try {
      const raw = Buffer.from(body, "base64url");
      if (raw.length <= IV_BYTES + TAG_BYTES) return null;
      const decipher = createDecipheriv("aes-256-gcm", enc, raw.subarray(0, IV_BYTES));
      decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
      const json = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]).toString("utf8");
      return shapeOf(JSON.parse(json));
    } catch {
      return null;
    }
  }
  return null;
}

export function consentTokenSecrets(env: NodeJS.ProcessEnv = process.env): { current: string | null; previous: string | null } {
  const clean = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return { current: clean(env.CONSENT_TOKEN_SECRET), previous: clean(env.CONSENT_TOKEN_SECRET_PREVIOUS) };
}
```

Edit `.env.example`. Find:
```
APP_ORIGIN=https://app.bis-rgv.com
```
Replace with:
```
APP_ORIGIN=https://app.bis-rgv.com
# Consent chain PR-3: seals and signs the unsubscribe link in every customer
# email (lib/consent/token.ts). REQUIRED in production: without it every
# customer email is held, never sent without its way out. Generate 32 random
# bytes (base64url) and pipe them straight into `vercel env add`; never echo
# it. Rotating: move the old value to CONSENT_TOKEN_SECRET_PREVIOUS so links
# already sent keep working. Unset outside production = emails carry no link
# (nothing real is delivered there). No fallback to any other key.
CONSENT_TOKEN_SECRET=
CONSENT_TOKEN_SECRET_PREVIOUS=
```

- [ ] **Step 4: Run to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/token.test.ts
```
Expected (predicted): all pass.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `sealConsentToken`: `sealed.toString("base64")` | "is URL-safe ASCII …" |
| 2 | `sealConsentToken`: skip the cipher (`const sealed = Buffer.concat([iv, Buffer.from(json), Buffer.alloc(16)])`, and `openConsentToken` reads the JSON directly) | "does not carry the address …" |
| 3 | `randomBytes(IV_BYTES)` → `Buffer.alloc(IV_BYTES)` | "two seals of the same payload differ" |
| 4 | `openConsentToken`: `for (const secret of secrets.slice(0, 1))` | "the PREVIOUS secret still opens …" |
| 5 | `openConsentToken`: drop `parts[0] !== VERSION` | "a tampered body … a wrong version …" |
| 6 | `openConsentToken`: `return shapeOf(JSON.parse(json))` → `return JSON.parse(json)` | "refuses a payload whose shape is wrong …" |
| 7 | `consentTokenSecrets`: `current: clean(env.CONSENT_TOKEN_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY)` | "reads the two variables … and NOTHING else" |
| 8 | `sealConsentToken`: drop the `!secret` throw | "sealing with no secret throws" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/token.ts apps/web/src/lib/consent/token.test.ts .env.example
git commit -m "feat(consent): the unsubscribe token — sealed and signed, no table, a previous secret for rotation"
```

---

### Task 4: The email kinds, every PR-3 line of copy, and the shell's footer marker

**Owner:** bis-comms (copy reviewed by bis-frontend). **Tier:** HIGH. **Questions:** [Q1] (four page lines), [Q4] (`staff.composer_email`'s footer).

**Files:**
- Modify: `apps/web/src/lib/consent/classes.ts`, `apps/web/src/lib/consent/classes.test.ts`
- Modify: `apps/web/src/lib/messages.ts`, `apps/web/src/lib/consent/copy.test.ts`
- Modify: `apps/web/src/lib/email/templates/shell.ts`, `apps/web/src/lib/email/templates/shell.test.ts`
- Modify: `apps/web/src/lib/consent/scans.test.ts` (scan 2 learns the email registry; its full positive control waits for Task 13)

**Interfaces:**
- Produces (from `@/lib/consent/classes`):
  - `type EmailClass = "customer_initiated" | "informational" | "marketing" | "staff_typed" | "operator"`
  - `type EmailKindSpec = { readonly class: EmailClass; readonly hours: HoursRule; readonly footer: "unsubscribe" | "none" }`
  - `EMAIL_KINDS` (22 kinds, below), `type EmailKind`, `type AutomationEmailKind = Extract<EmailKind, \`automation.${string}\`>`, `type OperatorEmailKind = Extract<EmailKind, \`operator.${string}\`>`, `type CustomerInitiatedEmailKind`
  - `isEmailKind(kind: string): kind is EmailKind`, `emailReadsLedger(kind: EmailKind): boolean` (true for `informational` and `marketing` only: decision 7)
- Produces (from `@/lib/email/templates/shell`): `UNSUBSCRIBE_MARKER = "<!--bis:unsubscribe-->"`, emitted exactly once by `shell()`, as the card's last row.
- Produces (in `m`): the keys listed in Step 3.

**The registry** (spec §4.3 as corrected by E1, choice 31, [Q4]):

| Kind | Class | Hours | Footer |
|---|---|---|---|
| `booking.confirmation`, `forms.receipt`, `voice.booked`, `voice.moved`, `voice.cancelled` | customer_initiated | any | unsubscribe |
| `automation.reminder`, `automation.followup` | informational | automated | unsubscribe |
| `automation.review_request`, `automation.referral_ask`, `automation.reactivation`, `automation.quote_followup`, `automation.no_show_nudge` | marketing | automated | unsubscribe |
| `staff.composer_email` | staff_typed | any | **none** [Q4] (§4.3 literally: `unsubscribe`) |
| `operator.booking_alert`, `operator.cancel_notice`, `operator.lead_alert`, `operator.call_alert`, `operator.phone_change_alert`, `operator.weekly_report`, `operator.agency_report`, `operator.billing_link`, `operator.sender_check` | operator | any | none |

- [ ] **Step 1: Write the failing tests**

Edit `apps/web/src/lib/consent/classes.test.ts`. Find:
```ts
import { SMS_KINDS, isSmsKind } from "./classes";
```
Replace with:
```ts
import { SMS_KINDS, isSmsKind, EMAIL_KINDS, isEmailKind, emailReadsLedger, type EmailKind } from "./classes";
```
Append at the end:
```ts
/**
 * The email half (spec §4.3's table, corrected 2026-09-30 by E1: twenty-two
 * sites). A kind moved to a looser class is a legal change (decision 7 decides
 * what an unsubscribe stops by class), so it must fail here and be argued.
 * Hours: choice 31 (automated email keeps the fixed automated window).
 * Footer: every customer email carries the unsubscribe link and headers,
 * except staff-typed email ([Q4], the plan's recommendation).
 */
const EMAIL_TABLE: Record<string, [string, string, string]> = {
  "booking.confirmation": ["customer_initiated", "any", "unsubscribe"],
  "forms.receipt": ["customer_initiated", "any", "unsubscribe"],
  "voice.booked": ["customer_initiated", "any", "unsubscribe"],
  "voice.moved": ["customer_initiated", "any", "unsubscribe"],
  "voice.cancelled": ["customer_initiated", "any", "unsubscribe"],
  "automation.reminder": ["informational", "automated", "unsubscribe"],
  "automation.followup": ["informational", "automated", "unsubscribe"],
  "automation.review_request": ["marketing", "automated", "unsubscribe"],
  "automation.referral_ask": ["marketing", "automated", "unsubscribe"],
  "automation.reactivation": ["marketing", "automated", "unsubscribe"],
  "automation.quote_followup": ["marketing", "automated", "unsubscribe"],
  "automation.no_show_nudge": ["marketing", "automated", "unsubscribe"],
  "staff.composer_email": ["staff_typed", "any", "none"],
  "operator.booking_alert": ["operator", "any", "none"],
  "operator.cancel_notice": ["operator", "any", "none"],
  "operator.lead_alert": ["operator", "any", "none"],
  "operator.call_alert": ["operator", "any", "none"],
  "operator.phone_change_alert": ["operator", "any", "none"],
  "operator.weekly_report": ["operator", "any", "none"],
  "operator.agency_report": ["operator", "any", "none"],
  "operator.billing_link": ["operator", "any", "none"],
  "operator.sender_check": ["operator", "any", "none"],
};

describe("EMAIL_KINDS — spec §4.3's table, row for row", () => {
  it("has exactly the twenty-two send sites (E1) — no more and no fewer (mutation: add or drop a kind → FAILS)", () => {
    expect(Object.keys(EMAIL_KINDS).sort()).toEqual(Object.keys(EMAIL_TABLE).sort());
    expect(Object.keys(EMAIL_KINDS)).toHaveLength(22);
  });

  it.each(Object.entries(EMAIL_TABLE))("%s is %j (mutation: change any one of this row's three fields → FAILS)", (kind, [cls, hours, footer]) => {
    const spec = EMAIL_KINDS[kind as EmailKind];
    expect([spec.class, spec.hours, spec.footer]).toEqual([cls, hours, footer]);
  });

  it("every operator kind is named operator.* and carries no footer; every customer kind but the staff-typed one carries it (choice 23; mutation: give an operator kind the footer → FAILS)", () => {
    for (const [kind, spec] of Object.entries(EMAIL_KINDS)) {
      expect(spec.class === "operator", kind).toBe(kind.startsWith("operator."));
      expect(spec.footer === "unsubscribe", kind).toBe(spec.class !== "operator" && spec.class !== "staff_typed");
    }
  });
});

describe("emailReadsLedger — what an unsubscribe stops (decision 7)", () => {
  it("reads the ledger for the automated classes alone: informational and marketing (mutation: include customer_initiated → a booking confirmation after an unsubscribe is refused, FAILS)", () => {
    const reads = Object.keys(EMAIL_KINDS).filter((k) => emailReadsLedger(k as EmailKind)).sort();
    expect(reads).toEqual([
      "automation.followup", "automation.no_show_nudge", "automation.quote_followup", "automation.reactivation",
      "automation.referral_ask", "automation.reminder", "automation.review_request",
    ]);
  });
});

describe("isEmailKind", () => {
  it("knows the registry's kinds and nothing inherited from Object; an SMS-only kind is not an email kind (mutation: `in` → 'toString' passes, FAILS)", () => {
    expect(isEmailKind("automation.reminder")).toBe(true);
    expect(isEmailKind("toString")).toBe(false);
    expect(isEmailKind("voice.textback")).toBe(false);
    expect(isEmailKind("automation.sms_reminder")).toBe(false);
  });
});
```

Edit `apps/web/src/lib/email/templates/shell.test.ts`. Find:
```ts
import { emailBrand, escapeHtml, shell, button } from "./shell";
```
Replace with:
```ts
import { emailBrand, escapeHtml, shell, button, UNSUBSCRIBE_MARKER } from "./shell";
```
Append at the end:
```ts
describe("the unsubscribe marker (consent PR-3, plan G7)", () => {
  const brand = emailBrand({ ...UNBRANDED, brandName: "Rio Roofing" });

  it("shell() emits the marker exactly once, AFTER the body row and INSIDE the card, so the gate's footer row lands under the message (mutation: emit it before the body → FAILS)", () => {
    const html = shell(brand, "<p>Hello</p>");
    expect(html.split(UNSUBSCRIBE_MARKER)).toHaveLength(2);
    const at = html.indexOf(UNSUBSCRIBE_MARKER);
    expect(at).toBeGreaterThan(html.indexOf("<p>Hello</p>"));
    expect(at).toBeLessThan(html.indexOf("</table>\n  </td></tr>"));
  });

  it("text the operator or customer wrote cannot forge a second marker: escapeHtml neutralises it (mutation: stop escaping '<' → two markers, FAILS)", () => {
    const html = shell(brand, `<p>${escapeHtml(UNSUBSCRIBE_MARKER)}</p>`);
    expect(html.split(UNSUBSCRIBE_MARKER)).toHaveLength(2);
  });
});
```

Edit `apps/web/src/lib/consent/copy.test.ts`: append at the end:
```ts
describe("PR-3: the spec's own words (§4.3 footer, §6 page, composer and Email row)", () => {
  it("the footer, in both languages (mutation: 'Unsubscribe.' → 'Unsubscribe here' FAILS)", () => {
    expect(m["email.unsubscribe.lead.en"]).toBe("Don't want these emails?");
    expect(m["email.unsubscribe.link.en"]).toBe("Unsubscribe");
    expect(m["email.unsubscribe.lead.es"]).toBe("¿No quiere recibir estos correos?");
    expect(m["email.unsubscribe.link.es"]).toBe("Cancelar suscripción");
  });

  it("the page's unsubscribed, resubscribed and bad-link lines, English and Spanish, and its two buttons", () => {
    expect(m["unsubscribe.done.en"]).toBe("You're unsubscribed. {Business} won't send you any more automated emails. You'll still get a confirmation when you book or ask for something.");
    expect(m["unsubscribe.done.es"]).toBe("Listo. {Business} ya no le enviará correos automáticos. Si reserva o pide algo, sí recibirá la confirmación.");
    expect(m["unsubscribe.resubscribe"]).toBe("Resubscribe / Volver a suscribirme");
    expect(m["unsubscribe.resubscribed.en"]).toBe("You'll get emails from {Business} again.");
    expect(m["unsubscribe.resubscribed.es"]).toBe("Volverá a recibir correos de {Business}.");
    expect(m["unsubscribe.badLink.en"]).toBe("This unsubscribe link doesn't work. Reply to any email from the business and ask them to stop.");
    expect(m["unsubscribe.badLink.es"]).toBe("Este enlace no funciona. Responda a cualquier correo del negocio y pida que dejen de escribirle.");
  });

  it("the composer's unsubscribed notice, with its date as {date}", () => {
    expect(m["compose.emailUnsubscribed"]).toBe("They unsubscribed from your emails on {date}. Write only about something they asked you for.");
  });

  it("the Email row's line for a stop only the customer can lift", () => {
    expect(m["contact.email.customerOnly"]).toBe("They can resubscribe from the unsubscribe link in any email from you.");
  });
});
```

Edit `apps/web/src/lib/consent/scans.test.ts` (scan 2 learns the email registry; Task 13 finishes it). Find:
```ts
import { SMS_KINDS } from "./classes";
```
Replace with:
```ts
import { SMS_KINDS, EMAIL_KINDS } from "./classes";
```
Find:
```ts
  const KIND_LITERAL = /["'`]((?:automation|voice|staff|operator|consent)\.[^"'`]+)["'`]/g;
```
Replace with:
```ts
  // PR-3 adds the email kinds' two other prefixes (booking., forms.).
  const KIND_LITERAL = /["'`]((?:automation|voice|staff|operator|consent|booking|forms)\.[^"'`]+)["'`]/g;
```
Find:
```ts
  const GATE_MODULES = new Set(["apps/web/src/lib/consent/gate", "apps/web/src/lib/automations/send-sms"]);
```
Replace with:
```ts
  const GATE_MODULES = new Set([
    "apps/web/src/lib/consent/gate", "apps/web/src/lib/automations/send-sms", "apps/web/src/lib/consent/email-gate",
  ]);
```
Find:
```ts
  it("each kind literal in a file that sends through the gate is a registry key (mutation: a pass sends kind \"automation.review_requests\" → FAILS naming it)", () => {
    expect(kindLiterals().filter(({ kind }) => !(kind in SMS_KINDS))).toEqual([]);
  });

  it("the scan reaches every send path's kind — none of the fourteen is missing (the positive control)", () => {
    const seen = new Set(kindLiterals().map(({ kind }) => kind));
    expect([...seen].sort()).toEqual(Object.keys(SMS_KINDS).sort());
  });
```
Replace with:
```ts
  it("each kind literal in a file that sends through either gate is a key of one of the two registries (mutation: a pass sends kind \"automation.reminders\" → FAILS naming it)", () => {
    expect(kindLiterals().filter(({ kind }) => !(kind in SMS_KINDS) && !(kind in EMAIL_KINDS))).toEqual([]);
  });

  it("the scan reaches every SMS send path's kind — none of the fourteen is missing (the positive control; Task 13 adds the email kinds once every site is routed)", () => {
    const seen = new Set(kindLiterals().map(({ kind }) => kind));
    expect([...seen]).toEqual(expect.arrayContaining(Object.keys(SMS_KINDS)));
  });
```

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/classes.test.ts src/lib/consent/copy.test.ts src/lib/email/templates/shell.test.ts src/lib/consent/scans.test.ts
```
Expected (predicted): classes.test fails to import `EMAIL_KINDS`; copy.test's new cases fail (`undefined`); shell.test fails to import `UNSUBSCRIBE_MARKER`; scans.test fails to import `EMAIL_KINDS`.

- [ ] **Step 3: Implement**

Edit `apps/web/src/lib/consent/classes.ts`. Append at the end:
```ts
/**
 * THE EMAIL KINDS (consent chain spec §4.3, corrected by the PR-3 plan's E1:
 * twenty-two send sites). The email gate (email-gate.ts) throws on a kind
 * that is not here, and scan 2 fails on any kind literal handed to it that
 * is not here.
 *
 * The CLASS decides what an unsubscribe stops (decision 7): `informational`
 * and `marketing` are automated mail, and the gate reads the ledger for them
 * alone; `customer_initiated` (a direct response to what the customer just
 * did, in the same request or live call, never a cron pass — scan 4 pins
 * where these kinds may be used), `staff_typed` (choice 22) and `operator`
 * (choice 23) are not subject to it. The HOURS: every automated kind keeps
 * the fixed automated window (choice 31). The FOOTER: every customer email
 * carries the unsubscribe link and the RFC 8058 headers, except staff-typed
 * email, a person's own reply ([Q4], the plan's recommendation; spec §4.3
 * literally gives it the footer too). Operator mail carries neither.
 */
export type EmailClass = "customer_initiated" | "informational" | "marketing" | "staff_typed" | "operator";

export type EmailKindSpec = { readonly class: EmailClass; readonly hours: HoursRule; readonly footer: "unsubscribe" | "none" };

export const EMAIL_KINDS = {
  "booking.confirmation": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "forms.receipt": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "voice.booked": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "voice.moved": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "voice.cancelled": { class: "customer_initiated", hours: "any", footer: "unsubscribe" },
  "automation.reminder": { class: "informational", hours: "automated", footer: "unsubscribe" },
  "automation.followup": { class: "informational", hours: "automated", footer: "unsubscribe" },
  "automation.review_request": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.referral_ask": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.reactivation": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.quote_followup": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "automation.no_show_nudge": { class: "marketing", hours: "automated", footer: "unsubscribe" },
  "staff.composer_email": { class: "staff_typed", hours: "any", footer: "none" },
  "operator.booking_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.cancel_notice": { class: "operator", hours: "any", footer: "none" },
  "operator.lead_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.call_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.phone_change_alert": { class: "operator", hours: "any", footer: "none" },
  "operator.weekly_report": { class: "operator", hours: "any", footer: "none" },
  "operator.agency_report": { class: "operator", hours: "any", footer: "none" },
  "operator.billing_link": { class: "operator", hours: "any", footer: "none" },
  "operator.sender_check": { class: "operator", hours: "any", footer: "none" },
} as const satisfies Record<string, EmailKindSpec>;

export type EmailKind = keyof typeof EMAIL_KINDS;
export type AutomationEmailKind = Extract<EmailKind, `automation.${string}`>;
export type OperatorEmailKind = Extract<EmailKind, `operator.${string}`>;
export type CustomerInitiatedEmailKind = {
  [K in EmailKind]: (typeof EMAIL_KINDS)[K]["class"] extends "customer_initiated" ? K : never;
}[EmailKind];

export function isEmailKind(kind: string): kind is EmailKind {
  return Object.prototype.hasOwnProperty.call(EMAIL_KINDS, kind);
}

/** Decision 7: an unsubscribe stops the automated classes, and only those. */
export function emailReadsLedger(kind: EmailKind): boolean {
  const cls = EMAIL_KINDS[kind].class;
  return cls === "informational" || cls === "marketing";
}
```
(The file already imports `type HoursRule` from `./hours`.)

Edit `apps/web/src/lib/email/templates/shell.ts`. Find:
```ts
export function shell(brand: EmailBrand, bodyHtml: string): string {
```
Insert before it:
```ts
/**
 * Where the email gate puts the unsubscribe footer (consent PR-3, plan G7):
 * the card's last row. The gate replaces it with the footer row for a
 * customer email and with nothing for operator mail, so no template decides
 * whether its reader may unsubscribe — the kind does (lib/consent/classes.ts).
 * A template's own text cannot forge it: every template escapes "<".
 */
export const UNSUBSCRIBE_MARKER = "<!--bis:unsubscribe-->";

```
Find:
```ts
      <tr><td>${bodyHtml}</td></tr>
    </table>
```
Replace with:
```ts
      <tr><td>${bodyHtml}</td></tr>
      ${UNSUBSCRIBE_MARKER}
    </table>
```

Edit `apps/web/src/lib/messages.ts`. After `"contact.messages.texts": "Texts",` add:
```ts
  // Consent chain PR-3: the Email row (spec §6; plan G14). "Stop emails" /
  // "Resume emails…" mirror the Texts row's words.
  "contact.messages.email": "Email",
  "contact.email.allowed": "Allowed",
  "contact.email.stopped": "Stopped",
  "contact.email.since": "Since {date}",
  "contact.email.how.unsubscribeLink": "unsubscribe link",
  "contact.email.how.staff": "you recorded it",
  "contact.email.how.backfill0049": "you marked them “No marketing emails”",
  "contact.email.stopEmails": "Stop emails",
  "contact.email.stoppedToast": "Emails stopped.",
  "contact.email.resume": "Resume emails…",
  "contact.email.resumeNoteLabel": "What did they ask for? (required)",
  "contact.email.resumeSubmit": "Resume emails",
  "contact.email.resumeCancel": "Cancel",
  "contact.email.resumeNoteRequired": "Write what they asked for before you turn emails back on.",
  "contact.email.resumedToast": "Emails are back on. To stop them again, use Stop emails.",
  "contact.email.customerOnly": "They can resubscribe from the unsubscribe link in any email from you.",
  "contact.email.loadFailed": "Couldn't load their email settings. Try again.",
  "contact.email.changed": "Their emails changed while you were looking. This is where they stand now.",
  "contact.email.failed": "Couldn't save that — please try again.",
  "contact.email.noEmail": "They have no email address.",
  "contact.email.undoBusy": "Your last change is still saving. Try again in a moment.",
  "contact.email.undoExpired": "That can no longer be undone here. Use Stop emails or Resume emails instead.",
```
After `"compose.smsStateUnknown": …,` add:
```ts
  // Consent chain PR-3 (spec §6, choice 22; plan G15): the email composer
  // stays usable and says why the operator should keep it to their matter.
  "compose.emailUnsubscribed": "They unsubscribed from your emails on {date}. Write only about something they asked you for.",
  "compose.emailStoppedByYou": "You stopped emails to them on {date}. Write only about something they asked you for.",
  "compose.emailStateUnknown": "Couldn't check whether they unsubscribed. Write only about something they asked you for.",
```
After `"automations.reason.ledgerRetry": …,` add:
```ts
  "automations.reason.emailLedgerRetry": "Waiting a few minutes: couldn't check whether they can get emails",
  "automations.reason.emailSetupRetry": "Waiting a few minutes: the unsubscribe link couldn't be added",
```
And add a new block (next to the other public-page strings; anywhere inside the object is fine):
```ts
  // Consent chain PR-3: the footer every customer email carries (spec §4.3),
  // in the email's language. The link text is the second key.
  "email.unsubscribe.lead.en": "Don't want these emails?",
  "email.unsubscribe.link.en": "Unsubscribe",
  "email.unsubscribe.lead.es": "¿No quiere recibir estos correos?",
  "email.unsubscribe.link.es": "Cancelar suscripción",
  // The public /u/[token] page (spec §6). English and Spanish stacked: the
  // token carries no language. {Business} is the brand name, or the
  // business/el negocio when it is blank. [Q1]: the confirm lines and the
  // one primary button exist because the page asks for one click.
  "unsubscribe.pageTitle": "Email preferences",
  "unsubscribe.confirm.en": "Stop emails from {Business}?",
  "unsubscribe.confirm.es": "¿Dejar de recibir correos de {Business}?",
  "unsubscribe.confirmBody.en": "{Business} will stop sending you automated emails. You'll still get a confirmation when you book or ask for something.",
  "unsubscribe.confirmBody.es": "{Business} dejará de enviarle correos automáticos. Si reserva o pide algo, sí recibirá la confirmación.",
  "unsubscribe.button": "Unsubscribe / Cancelar suscripción",
  "unsubscribe.done.en": "You're unsubscribed. {Business} won't send you any more automated emails. You'll still get a confirmation when you book or ask for something.",
  "unsubscribe.done.es": "Listo. {Business} ya no le enviará correos automáticos. Si reserva o pide algo, sí recibirá la confirmación.",
  "unsubscribe.resubscribe": "Resubscribe / Volver a suscribirme",
  "unsubscribe.resubscribed.en": "You'll get emails from {Business} again.",
  "unsubscribe.resubscribed.es": "Volverá a recibir correos de {Business}.",
  "unsubscribe.badLink.en": "This unsubscribe link doesn't work. Reply to any email from the business and ask them to stop.",
  "unsubscribe.badLink.es": "Este enlace no funciona. Responda a cualquier correo del negocio y pida que dejen de escribirle.",
  "unsubscribe.failed.en": "Something went wrong on our side. Try the link again in a few minutes.",
  "unsubscribe.failed.es": "Algo falló de nuestro lado. Vuelva a abrir el enlace en unos minutos.",
  "unsubscribe.business.en": "the business",
  "unsubscribe.business.es": "el negocio",
  "unsubscribe.poweredBy": "Powered by BIS",
```

- [ ] **Step 4: Run to see them pass, and the templates unchanged**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/classes.test.ts src/lib/consent/copy.test.ts src/lib/email/templates src/lib/consent/scans.test.ts src/lib/messages.test.ts
```
Expected (predicted): all pass. The template tests assert with `toContain`/`toMatch`; if any pins a template's whole `html` string, add `UNSUBSCRIBE_MARKER` to that expected string at the card's end (the marker is part of the shell now) and say so in the commit message. `messages.test.ts`'s voice scan must stay green: none of the new lines carries a milestone code, carrier jargon or `{{…}}`.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `EMAIL_KINDS["forms.receipt"].class` → `"informational"` | the forms.receipt row; `emailReadsLedger`'s list |
| 2 | `EMAIL_KINDS["operator.weekly_report"].footer` → `"unsubscribe"` | the operator row; "every operator kind … carries no footer" |
| 3 | `emailReadsLedger`: add `\|\| cls === "customer_initiated"` | "reads the ledger for the automated classes alone" |
| 4 | `isEmailKind`: `kind in EMAIL_KINDS` | "knows the registry's kinds and nothing inherited from Object" |
| 5 | `shell()`: put `${UNSUBSCRIBE_MARKER}` before the body row | "shell() emits the marker exactly once, AFTER the body row" |
| 6 | `m["unsubscribe.done.es"]`: "Listo." → "Listo!" | the page lines case |
| 7 | scans.test: KIND_LITERAL without `booking\|forms` | none yet (no gate caller holds such a literal until Task 7) — EXPECTED green here; Task 13's probe 2 covers it |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/classes.ts apps/web/src/lib/consent/classes.test.ts apps/web/src/lib/messages.ts apps/web/src/lib/consent/copy.test.ts apps/web/src/lib/email/templates/shell.ts apps/web/src/lib/email/templates/shell.test.ts apps/web/src/lib/consent/scans.test.ts
git commit -m "feat(consent): the twenty-two email kinds, PR-3's copy, and the shell's unsubscribe marker"
```

---

### Task 5: The email gate, and the provider that carries headers

**Owner:** bis-comms. **Tier:** HIGH. **Questions:** [Q4] (a staff kind carries no footer — decided by Task 4's registry, tested here).

**Files:**
- Create: `apps/web/src/lib/consent/email-gate.ts`, `apps/web/src/lib/consent/email-gate.test.ts`
- Create: `apps/web/src/lib/email/environment.ts`
- Modify: `apps/web/src/lib/email/types.ts` (`headers`), `apps/web/src/lib/email/resend.ts`, `apps/web/src/lib/email/resend.test.ts`, `apps/web/src/lib/email/index.ts` (re-exports `isProductionEnv`), `apps/web/src/lib/email/email.test.ts`

**Interfaces:**
- Consumes: `EMAIL_KINDS`, `isEmailKind`, `emailReadsLedger`, `EmailKind`, `OperatorEmailKind` (Task 4); `UNSUBSCRIBE_MARKER` (Task 4); `sealConsentToken`, `consentTokenSecrets`, `isUuid` (Task 3); `emailLedgerAddress` (Task 1); `readConsentState`, `readAccountTimezone` (`@bis/db`); `nextOpening`, `expiresBeforeOpening`, `hoursZone` (PR-1); `configuredOrigin` (`lib/email/origin.ts`).
- Produces (from `@/lib/consent/email-gate`):
  - `type EmailRequest = Omit<SendEmailInput, "headers"> & { accountId: string | null; kind: EmailKind; contactId?: string | null; language?: "en" | "es"; origin?: string | null; now?: Date; accountZone?: string | null; deadline?: Date | null }`
  - `type EmailBlockReason = "no_address" | "stopped" | "held" | "window_after_deadline" | "ledger_unavailable" | "unsubscribe_unavailable"`
  - `type EmailSendResult = { kind: "sent"; providerMessageId: string } | { kind: "deferred"; until: Date; zone: string } | { kind: "blocked"; reason: EmailBlockReason } | { kind: "failed"; stage: "provider_unavailable" | "provider"; error: string }`
  - `type EmailGateDeps = { db?: SupabaseClient | null; env?: NodeJS.ProcessEnv }`
  - `sendEmail(req: EmailRequest, deps?: EmailGateDeps): Promise<EmailSendResult>` — never throws except for a programming error (an unknown kind, a customer kind with no account, a ledger kind with no client, a customer html with no marker).
  - `class EmailNotSent extends Error { readonly result }` — its message is the provider's own words for `failed`.
  - `sendEmailOrThrow(req, deps?): Promise<SendEmailResult>` — `{ providerMessageId }` or throws `EmailNotSent`.
  - `type GatedEmail = { readonly isFake: boolean; send(input: EmailRequest): Promise<SendEmailResult> }`; `emailSenderFor(db: SupabaseClient, env?): GatedEmail` — constructs the provider once, EAGERLY (it throws in production when Resend is unconfigured, the harness's designed failure), and sends through `sendEmailOrThrow` with that client.
  - `operatorMailer(kind: OperatorEmailKind, accountId: string | null, env?): EmailProvider` — a provider-shaped sender bound to one operator kind (G11).
- Produces (from `@/lib/email/environment`, re-exported by `@/lib/email`): `isProductionEnv(env?: NodeJS.ProcessEnv): boolean` — `getEmailProvider`'s own rule (`VERCEL_ENV === "production"` AND the real `process.env.NODE_ENV === "production"`), now shared. `SendEmailInput.headers?: Record<string, string>`.

**The gate's steps, in order** (spec §4.3 "Routing", G1, G7–G9):
1. a kind missing from the registry THROWS; a non-operator kind with no `accountId` THROWS;
2. `to` is keyed with `emailLedgerAddress`; nothing keyable → blocked `no_address`;
3. an `informational` or `marketing` kind reads the ledger: stopped → blocked `stopped`, held → blocked `held`, a read error → blocked `ledger_unavailable` (fails closed, logged through `loggableError`);
4. an automated kind applies the fixed automated hours (choice 31) in `accountZone` (or `accounts.timezone`, read): outside → `deferred`, unless the deadline falls first → blocked `window_after_deadline`; an unreadable zone → blocked `ledger_unavailable`;
5. the provider is constructed (its throw → failed `provider_unavailable`);
6. a customer kind (footer `unsubscribe`) gets the footer row in place of the marker, the footer line at the end of the text part, and the two headers — or, in production with no secret or no origin, is blocked `unsubscribe_unavailable`; outside production it goes without them (G8). Any other kind has the marker removed and no headers;
7. the provider sends ONLY the send fields (never the gate's own); its throw → failed `provider` with its message.

- [ ] **Step 1: Write the failing tests**

Edit `apps/web/src/lib/email/resend.test.ts`. Append at the end:
```ts
describe("custom headers (consent PR-3; Resend's CreateEmailBaseOptions.headers, plan X1)", () => {
  it("passes the unsubscribe headers through exactly, and a send without them carries no headers key (mutation: drop the headers spread → FAILS; mutation: always send headers: {} → FAILS)", async () => {
    const provider = resendEmailProvider("re_test", "crm@bis-rgv.com");
    const headers = { "List-Unsubscribe": "<https://app.example.com/api/unsubscribe/t>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
    await provider.send({ to: "c@example.com", fromName: "Rio", subject: "Hi", body: "plain", headers });
    expect(sendMock.mock.calls[0]![0].headers).toEqual(headers);
    await provider.send({ to: "c@example.com", fromName: "Rio", subject: "Hi", body: "plain" });
    expect("headers" in sendMock.mock.calls[1]![0]).toBe(false);
  });
});
```

Edit `apps/web/src/lib/email/email.test.ts`. Find:
```ts
import { getEmailProvider } from "./index";
```
Replace with:
```ts
import { getEmailProvider, isProductionEnv } from "./index";
```
Append at the end:
```ts
describe("isProductionEnv — getEmailProvider's own rule, shared with the email gate", () => {
  it("needs BOTH VERCEL_ENV=production and the real NODE_ENV=production (mutation: read VERCEL_ENV alone → a pulled .env under next dev reads as production, FAILS)", () => {
    expect(isProductionEnv({ VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(isProductionEnv({ VERCEL_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(isProductionEnv({ VERCEL_ENV: "preview" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
```

Create `apps/web/src/lib/consent/email-gate.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const db = vi.hoisted(() => ({ readConsentState: vi.fn(), readAccountTimezone: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));
const factory = vi.hoisted(() => ({ getEmailProvider: vi.fn() }));
vi.mock("@/lib/email", async (importOriginal) => ({ ...(await importOriginal<object>()), ...factory }));

import { sendEmail, sendEmailOrThrow, EmailNotSent, emailSenderFor, operatorMailer, type EmailRequest } from "./email-gate";
import { openConsentToken } from "./token";
import { EMAIL_KINDS, type EmailKind } from "./classes";
import { shell, emailBrand, UNSUBSCRIBE_MARKER } from "@/lib/email/templates/shell";

const CLIENT = {} as never;
const SECRET = "gate-test-secret-0123456789abcdef-0123";
const ENV = { APP_ORIGIN: "https://app.example.com", CONSENT_TOKEN_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
const ACCOUNT = "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f";
const CONTACT = "0c9a8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d";
// Tue 2026-10-06 15:00 in Chicago (CDT): inside the automated window.
const DAY = new Date("2026-10-06T20:00:00Z");
// Tue 2026-10-06 22:30 in Chicago: outside it; it opens at 08:00 on the 7th.
const NIGHT = new Date("2026-10-07T03:30:00Z");
const HTML = shell(emailBrand({ brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
  brandCorners: null, brandType: null, brandMode: null, replyToEmail: null }), "<p>See you at 3</p>");
const base = (over: Partial<EmailRequest> = {}): EmailRequest => ({
  accountId: ACCOUNT, kind: "automation.reminder", to: "  Ana.Lopez@Example.com ", contactId: CONTACT,
  fromName: "Rio Roofing", subject: "Reminder", body: "See you at 3", html: HTML,
  accountZone: "America/Chicago", now: DAY, ...over,
});
const send = vi.fn();
const provider = (over: Record<string, unknown> = {}) => ({ isFake: true, send, ...over });
const sent = () => send.mock.calls[0]![0] as Record<string, unknown> & { headers?: Record<string, string>; html?: string; body: string };

beforeEach(() => {
  for (const fn of [...Object.values(db), ...Object.values(factory), send]) fn.mockReset();
  db.readConsentState.mockResolvedValue({ state: "allowed" });
  db.readAccountTimezone.mockResolvedValue("America/Chicago");
  factory.getEmailProvider.mockReturnValue(provider());
  send.mockResolvedValue({ providerMessageId: "re_1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.mocked(console.error).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("sendEmail: the registry and the address", () => {
  it("throws on a kind the registry does not hold, and on a customer kind with no account (mutation: drop the isEmailKind check → resolves, FAILS)", async () => {
    await expect(sendEmail(base({ kind: "automation.reminders" as EmailKind }), { db: CLIENT, env: ENV })).rejects.toThrow(/unknown email kind "automation.reminders"/);
    await expect(sendEmail(base({ accountId: null, kind: "booking.confirmation" }), { env: ENV })).rejects.toThrow(/needs its account/);
  });

  it("an address the ledger cannot key is blocked no_address before any read or provider (mutation: skip emailLedgerAddress → the provider is asked, FAILS)", async () => {
    expect(await sendEmail(base({ to: "not an address" }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "no_address" });
    expect(db.readConsentState).not.toHaveBeenCalled();
    expect(factory.getEmailProvider).not.toHaveBeenCalled();
  });
});

describe("sendEmail: what an unsubscribe stops (decision 7)", () => {
  it.each(["automation.reminder", "automation.followup", "automation.review_request", "automation.referral_ask",
    "automation.reactivation", "automation.quote_followup", "automation.no_show_nudge"] as const)(
    "%s to a stopped address is blocked `stopped`, read on the LEDGER KEY (mutation: read the raw `to` → the mixed-case address is asked, FAILS)", async (kind) => {
      db.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "one_click", eventId: "e1" });
      expect(await sendEmail(base({ kind }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "stopped" });
      expect(db.readConsentState).toHaveBeenCalledWith(CLIENT, ACCOUNT, "email", "ana.lopez@example.com");
      expect(send).not.toHaveBeenCalled();
    });

  it.each(["booking.confirmation", "forms.receipt", "voice.booked", "voice.moved", "voice.cancelled",
    "staff.composer_email", "operator.booking_alert"] as const)(
    "%s is NOT subject to the ledger: it never reads it and sends to a stopped address (decision 7, choices 22 and 23; mutation: read the ledger for every kind → FAILS)", async (kind) => {
      db.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "one_click", eventId: "e1" });
      expect((await sendEmail(base({ kind }), { env: ENV })).kind).toBe("sent");
      expect(db.readConsentState).not.toHaveBeenCalled();
    });

  it("a held address is blocked `held`; an unreadable ledger is blocked `ledger_unavailable`, logged, never sent (fails closed, spec §5; mutation: treat a read error as allowed → FAILS)", async () => {
    db.readConsentState.mockResolvedValueOnce({ state: "held", since: "2026-10-01T00:00:00Z", method: "free_text", eventId: "h1" });
    expect(await sendEmail(base(), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "held" });
    db.readConsentState.mockRejectedValueOnce(new Error("readConsentState failed: timeout"));
    expect(await sendEmail(base(), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).toMatch(/automation\.reminder .*blocked, consent state unreadable/);
    expect(send).not.toHaveBeenCalled();
  });

  it("a ledger kind with no client is a programming error, not a silent send (mutation: skip the read when db is missing → sends, FAILS)", async () => {
    await expect(sendEmail(base(), { env: ENV })).rejects.toThrow(/reads the ledger and needs a client/);
  });
});

describe("sendEmail: the automated hours (choice 31)", () => {
  it("outside 08:00-21:00 in the account's zone an automated kind is deferred to the opening, and a customer kind is not (mutation: drop the hours step → sent at 22:30, FAILS)", async () => {
    expect(await sendEmail(base({ now: NIGHT }), { db: CLIENT, env: ENV }))
      .toEqual({ kind: "deferred", until: new Date("2026-10-07T13:00:00Z"), zone: "America/Chicago" });
    expect((await sendEmail(base({ kind: "booking.confirmation", now: NIGHT }), { env: ENV })).kind).toBe("sent");
  });

  it("a deadline before the opening is blocked window_after_deadline (choice 21; mutation: ignore the deadline → deferred, FAILS)", async () => {
    expect(await sendEmail(base({ now: NIGHT, deadline: new Date("2026-10-07T12:00:00Z") }), { db: CLIENT, env: ENV }))
      .toEqual({ kind: "blocked", reason: "window_after_deadline" });
  });

  it("with no accountZone the zone is READ, and an unreadable zone fails closed (mutation: fall back to Chicago on a read error → deferred, FAILS)", async () => {
    db.readAccountTimezone.mockResolvedValueOnce("America/Los_Angeles");
    expect(await sendEmail(base({ accountZone: undefined, now: new Date("2026-10-06T14:30:00Z") }), { db: CLIENT, env: ENV }))
      .toEqual({ kind: "deferred", until: new Date("2026-10-06T15:00:00Z"), zone: "America/Los_Angeles" });
    db.readAccountTimezone.mockRejectedValueOnce(new Error("down"));
    expect(await sendEmail(base({ accountZone: undefined }), { db: CLIENT, env: ENV })).toEqual({ kind: "blocked", reason: "ledger_unavailable" });
  });
});

describe("sendEmail: the footer and the RFC 8058 headers (spec §4.3, plan G7)", () => {
  it("a customer kind carries the two headers exactly, and ONE token in both links that opens to this account, channel, LEDGER address, contact and kind (RFC 8058, X2; mutation: put the page URL in List-Unsubscribe → FAILS; mutation: seal the raw `to` → t mismatches, FAILS)", async () => {
    await sendEmail(base(), { db: CLIENT, env: ENV });
    const out = sent();
    expect(Object.keys(out.headers!).sort()).toEqual(["List-Unsubscribe", "List-Unsubscribe-Post"]);
    expect(out.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const oneClick = /^<https:\/\/app\.example\.com\/api\/unsubscribe\/([A-Za-z0-9_.-]+)>$/.exec(out.headers!["List-Unsubscribe"]!);
    expect(oneClick).not.toBeNull();
    const token = oneClick![1]!;
    expect(out.body).toBe(`See you at 3\n\nDon't want these emails? Unsubscribe: https://app.example.com/u/${token}`);
    expect(out.html).toContain(`href="https://app.example.com/u/${token}"`);
    expect(openConsentToken(token, [SECRET])).toEqual({
      v: 1, a: ACCOUNT, c: "email", t: "ana.lopez@example.com", i: DAY.getTime(), n: CONTACT, k: "automation.reminder",
    });
  });

  it("the footer row replaces the marker, under the message, and says the spec's words (mutation: append the row after </html> → FAILS)", async () => {
    await sendEmail(base(), { db: CLIENT, env: ENV });
    const html = sent().html!;
    expect(html).not.toContain(UNSUBSCRIBE_MARKER);
    expect(html).toMatch(/<tr><td style="[^"]*">Don&#39;t want these emails\? <a href="[^"]+"[^>]*>Unsubscribe<\/a>\.<\/td><\/tr>|<tr><td style="[^"]*">Don't want these emails\? <a href="[^"]+"[^>]*>Unsubscribe<\/a>\.<\/td><\/tr>/);
    expect(html.indexOf("Unsubscribe</a>")).toBeGreaterThan(html.indexOf("See you at 3"));
    expect(html.indexOf("Unsubscribe</a>")).toBeLessThan(html.indexOf("</body>"));
  });

  it("in Spanish when the email is Spanish (mutation: always English → FAILS)", async () => {
    await sendEmail(base({ kind: "booking.confirmation", language: "es" }), { env: ENV });
    expect(sent().body).toMatch(/\n\n¿No quiere recibir estos correos\? Cancelar suscripción: https:\/\/app\.example\.com\/u\//);
    expect(sent().html).toContain(">Cancelar suscripción</a>");
  });

  it("operator mail and staff-typed mail carry no link and no headers, and the marker is removed ([Q4], choice 23; mutation: give staff kinds the footer → FAILS)", async () => {
    for (const kind of ["operator.booking_alert", "staff.composer_email"] as const) {
      send.mockClear();
      await sendEmail(base({ kind }), { env: ENV });
      expect(sent().headers).toBeUndefined();
      expect(sent().body).toBe("See you at 3");
      expect(sent().html).not.toContain(UNSUBSCRIBE_MARKER);
      expect(sent().html).not.toContain("/u/");
    }
  });

  it("the provider gets the send fields ONLY — never the gate's own (mutation: spread the whole request → accountId reaches Resend, FAILS)", async () => {
    await sendEmail(base({ replyTo: "office@rio.example", fromAddress: "hello@rio.example" }), { db: CLIENT, env: ENV });
    expect(Object.keys(sent()).sort()).toEqual(["body", "fromAddress", "fromName", "headers", "html", "replyTo", "subject", "to"]);
    expect(sent().to).toBe("  Ana.Lopez@Example.com ");
  });

  it("the request's origin is used when APP_ORIGIN is unset, with trailing slashes dropped; APP_ORIGIN wins when set (origin.ts's rule; mutation: prefer the request's origin → FAILS)", async () => {
    await sendEmail(base({ origin: "https://rio.example.com//" }), { db: CLIENT, env: { CONSENT_TOKEN_SECRET: SECRET } as unknown as NodeJS.ProcessEnv });
    expect(sent().headers!["List-Unsubscribe"]).toMatch(/^<https:\/\/rio\.example\.com\/api\/unsubscribe\//);
    send.mockClear();
    await sendEmail(base({ origin: "https://rio.example.com" }), { db: CLIENT, env: ENV });
    expect(sent().headers!["List-Unsubscribe"]).toMatch(/^<https:\/\/app\.example\.com\//);
  });

  it("a contact id that is not a uuid is left out of the token rather than minting one the opener refuses (mutation: pass it through → openConsentToken answers null, FAILS)", async () => {
    await sendEmail(base({ contactId: "ct_1" }), { db: CLIENT, env: ENV });
    const token = /\/api\/unsubscribe\/([^>]+)>/.exec(sent().headers!["List-Unsubscribe"]!)![1]!;
    expect(openConsentToken(token, [SECRET])?.n).toBeNull();
  });

  it("a customer email whose html has no marker is a programming error (plan G7; mutation: skip the check → sent without a footer, FAILS)", async () => {
    await expect(sendEmail(base({ html: "<p>hand-made</p>" }), { db: CLIENT, env: ENV })).rejects.toThrow(/has no unsubscribe marker/);
  });

  it("a text-only customer email gets the footer line and the headers (mutation: require html → FAILS)", async () => {
    await sendEmail(base({ html: undefined }), { db: CLIENT, env: ENV });
    expect(sent().html).toBeUndefined();
    expect(sent().body).toMatch(/Unsubscribe: https:\/\/app\.example\.com\/u\//);
    expect(sent().headers).toBeDefined();
  });
});

describe("sendEmail: with no secret or no origin (plan G8)", () => {
  it("in PRODUCTION a customer kind is blocked unsubscribe_unavailable and never sent; operator mail still goes (mutation: send without the link in production → FAILS)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const prod = { VERCEL_ENV: "production", APP_ORIGIN: "https://app.example.com" } as unknown as NodeJS.ProcessEnv;
    expect(await sendEmail(base(), { db: CLIENT, env: prod })).toEqual({ kind: "blocked", reason: "unsubscribe_unavailable" });
    expect(await sendEmail(base(), { db: CLIENT, env: { VERCEL_ENV: "production", CONSENT_TOKEN_SECRET: SECRET } as unknown as NodeJS.ProcessEnv }))
      .toEqual({ kind: "blocked", reason: "unsubscribe_unavailable" });
    expect(send).not.toHaveBeenCalled();
    expect((await sendEmail(base({ kind: "operator.lead_alert" }), { env: prod })).kind).toBe("sent");
  });

  it("OUTSIDE production a customer kind goes without the link or headers (nothing real is delivered there; mutation: block outside production too → FAILS)", async () => {
    expect((await sendEmail(base(), { db: CLIENT, env: {} as NodeJS.ProcessEnv })).kind).toBe("sent");
    expect(sent().headers).toBeUndefined();
    expect(sent().body).toBe("See you at 3");
    expect(sent().html).not.toContain(UNSUBSCRIBE_MARKER);
  });
});

describe("sendEmail: the provider", () => {
  it("a provider that throws is failed/provider with its own words; a factory that throws is failed/provider_unavailable (mutation: rethrow → rejects, FAILS)", async () => {
    send.mockRejectedValueOnce(new Error("The rio.example domain is not verified."));
    expect(await sendEmail(base(), { db: CLIENT, env: ENV })).toEqual({ kind: "failed", stage: "provider", error: "The rio.example domain is not verified." });
    factory.getEmailProvider.mockImplementationOnce(() => { throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production"); });
    expect(await sendEmail(base(), { db: CLIENT, env: ENV })).toEqual({
      kind: "failed", stage: "provider_unavailable", error: "RESEND_API_KEY and EMAIL_FROM are required in production",
    });
  });
});

describe("sendEmailOrThrow, emailSenderFor, operatorMailer", () => {
  it("sendEmailOrThrow answers the id, or throws EmailNotSent carrying the result, with the provider's own words as its message (G11; mutation: wrap the message → the sending-address check loses Resend's wording, FAILS)", async () => {
    expect(await sendEmailOrThrow(base(), { db: CLIENT, env: ENV })).toEqual({ providerMessageId: "re_1" });
    send.mockRejectedValueOnce(new Error("The rio.example domain is not verified."));
    const e = await sendEmailOrThrow(base(), { db: CLIENT, env: ENV }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(EmailNotSent);
    expect((e as Error).message).toBe("The rio.example domain is not verified.");
    db.readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "staff", eventId: "e1" });
    const b = await sendEmailOrThrow(base(), { db: CLIENT, env: ENV }).catch((x: unknown) => x);
    expect((b as EmailNotSent).result).toEqual({ kind: "blocked", reason: "stopped" });
  });

  it("emailSenderFor builds the provider EAGERLY (a production tick with Resend unset fails before any query) and sends with its client (mutation: build lazily → no throw at construction, FAILS)", async () => {
    factory.getEmailProvider.mockImplementationOnce(() => { throw new Error("RESEND_API_KEY and EMAIL_FROM are required in production"); });
    expect(() => emailSenderFor(CLIENT, ENV)).toThrow(/required in production/);
    const sender = emailSenderFor(CLIENT, ENV);
    expect(sender.isFake).toBe(true);
    await sender.send(base());
    expect(db.readConsentState).toHaveBeenCalledWith(CLIENT, ACCOUNT, "email", "ana.lopez@example.com");
  });

  it("operatorMailer is provider-shaped, bound to ONE operator kind: no ledger, no footer, the provider's words on failure (G11; mutation: bind a customer kind's rules → a footer appears, FAILS)", async () => {
    const mailer = operatorMailer("operator.sender_check", ACCOUNT, ENV);
    expect(mailer.isFake).toBe(true);
    await mailer.send({ to: "admin@rio.example", fromName: "BIS Platform", fromAddress: "hello@rio.example", subject: "Sending address check", body: "ok" });
    expect(sent().headers).toBeUndefined();
    expect(db.readConsentState).not.toHaveBeenCalled();
    send.mockRejectedValueOnce(new Error("The rio.example domain is not verified."));
    await expect(mailer.send({ to: "admin@rio.example", fromName: "BIS Platform", subject: "x", body: "y" }))
      .rejects.toThrow("The rio.example domain is not verified.");
  });

  it("every registry kind is handled by the footer step one way or the other (a guard for a new kind; mutation: a new footer value → the switch falls through, FAILS)", async () => {
    for (const kind of Object.keys(EMAIL_KINDS) as EmailKind[]) {
      send.mockClear();
      const r = await sendEmail(base({ kind, accountId: kind.startsWith("operator.") ? null : ACCOUNT, now: DAY }), { db: CLIENT, env: ENV });
      expect(r.kind, kind).toBe("sent");
      expect(Boolean(sent().headers), kind).toBe(EMAIL_KINDS[kind].footer === "unsubscribe");
    }
  });
});
```

(The `html` regex allows either an escaped or a literal apostrophe: `escapeHtml` does not escape `'` today; the alternation keeps the test honest if it ever does.)

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/email-gate.test.ts src/lib/email/resend.test.ts src/lib/email/email.test.ts
```
Expected (predicted): email-gate.test fails to import `./email-gate`; resend's headers case fails (`headers` undefined); email.test fails to import `isProductionEnv`.

- [ ] **Step 3: Implement**

Edit `apps/web/src/lib/email/types.ts`. Find:
```ts
  html?: string;
};

export type SendEmailResult = { providerMessageId: string };
```
Replace with:
```ts
  html?: string;
  /** Extra headers, passed to Resend as they are (its `headers` field, plan
   *  X1). Only the email gate sets them: the RFC 8058 List-Unsubscribe and
   *  List-Unsubscribe-Post pair on customer email (consent PR-3). */
  headers?: Record<string, string>;
};

export type SendEmailResult = { providerMessageId: string };
```

Edit `apps/web/src/lib/email/resend.ts`. Find:
```ts
      ...(input.html ? { html: input.html } : {}),
    });
```
Replace with:
```ts
      ...(input.html ? { html: input.html } : {}),
      // Same spread discipline: a send without headers carries no key.
      ...(input.headers ? { headers: input.headers } : {}),
    });
```

Create `apps/web/src/lib/email/environment.ts` (its own module, not the index: eleven web tests mock `@/lib/email` with a bare factory holding only `getEmailProvider`, and the gate must not depend on them carrying anything else):
```ts
/**
 * THE production test, shared by getEmailProvider and the email gate (which
 * refuses to send a customer email without its unsubscribe link only in
 * production). Both signals, for the reason getEmailProvider's comment gives:
 * NODE_ENV is read from the REAL process env and cannot be pulled or spoofed.
 */
export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";
}
```

Edit `apps/web/src/lib/email/index.ts`. Add `import { isProductionEnv } from "./environment";` to its imports and `export { isProductionEnv } from "./environment";` beside its other re-exports. Find:
```ts
  const isProduction = env.VERCEL_ENV === "production" && process.env.NODE_ENV === "production";
```
Replace with:
```ts
  const isProduction = isProductionEnv(env);
```

Create `apps/web/src/lib/consent/email-gate.ts` (it takes `emailLedgerAddress` from the `@bis/db/email-address` subpath and `isProductionEnv` from `@/lib/email/environment`, for the same mock-factory reason):
```ts
import { readConsentState, readAccountTimezone, type SupabaseClient } from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";
import { getEmailProvider } from "@/lib/email";
import { isProductionEnv } from "@/lib/email/environment";
import type { EmailProvider, SendEmailInput, SendEmailResult } from "@/lib/email/types";
import { configuredOrigin } from "@/lib/email/origin";
import { escapeHtml, UNSUBSCRIBE_MARKER } from "@/lib/email/templates/shell";
import { loggableError } from "@/lib/loggable-error";
import { m } from "@/lib/messages";
import { EMAIL_KINDS, isEmailKind, emailReadsLedger, type EmailKind, type OperatorEmailKind } from "./classes";
import { nextOpening, expiresBeforeOpening, hoursZone } from "./hours";
import { sealConsentToken, consentTokenSecrets, isUuid } from "./token";

/**
 * THE EMAIL GATE (consent chain spec §4.3 "Routing"; plan G1). The only
 * module outside lib/email's own provider files that may reach an email
 * provider (scan 1, scans.test.ts). Every one of the twenty-two email send
 * sites comes through `sendEmail` — directly, through `sendEmailOrThrow`,
 * through a cron tick's `ctx.email` (`emailSenderFor`), or through
 * `operatorMailer` for the two operator paths that take a provider.
 *
 * The steps, in order:
 *   1. a kind missing from the registry THROWS (a programming error), and so
 *      does a customer kind with no account;
 *   2. `to` is keyed as the ledger keys it (emailLedgerAddress); nothing to
 *      key → blocked `no_address`;
 *   3. an informational or marketing kind — automated mail, what an
 *      unsubscribe stops (decision 7) — reads the ledger: stopped → blocked
 *      `stopped`, held → blocked `held`. Customer-initiated, staff-typed and
 *      operator kinds pass without reading it (decision 7, choices 22, 23);
 *   4. an automated kind keeps the fixed automated hours (choice 31): outside
 *      them → `deferred`, unless the deadline falls first (choice 21) →
 *      blocked `window_after_deadline`;
 *   5. the provider;
 *   6. a customer email gets its way out: the footer row in place of the
 *      shell's marker, the footer line under the text part, and the RFC 8058
 *      List-Unsubscribe / List-Unsubscribe-Post headers, all carrying ONE
 *      sealed token. In production with no CONSENT_TOKEN_SECRET or no origin
 *      it is blocked `unsubscribe_unavailable` — never sent without its way
 *      out; outside production it goes without them (plan G8). Operator and
 *      staff-typed mail have the marker removed and carry no headers;
 *   7. the send, with the send fields ONLY.
 *
 * FAILS CLOSED: a ledger or zone read error is blocked `ledger_unavailable`,
 * logged through `loggableError`, never a send. Never logs a token or an
 * address.
 */
export type EmailRequest = Omit<SendEmailInput, "headers"> & {
  /** The business the email is from. Null only for operator mail with no
   *  account (the agency roll-up). */
  accountId: string | null;
  kind: EmailKind;
  /** The contact it goes to, when known: evidence in the token, nothing more. */
  contactId?: string | null;
  /** The email's language, which picks the footer's. English by default. */
  language?: "en" | "es";
  /** The request's own origin, for the unsubscribe links when APP_ORIGIN is
   *  unset (origin.ts: APP_ORIGIN wins whenever it is set). */
  origin?: string | null;
  /** The instant the hours are judged at. Passes hand in their tick's `now`. */
  now?: Date;
  /** The account's zone when the caller has it. `undefined` → read. */
  accountZone?: string | null;
  /** Choice 21: the latest instant this email is still useful. */
  deadline?: Date | null;
};

export type EmailBlockReason =
  | "no_address" | "stopped" | "held" | "window_after_deadline" | "ledger_unavailable" | "unsubscribe_unavailable";

export type EmailSendResult =
  | { kind: "sent"; providerMessageId: string }
  | { kind: "deferred"; until: Date; zone: string }
  | { kind: "blocked"; reason: EmailBlockReason }
  | { kind: "failed"; stage: "provider_unavailable" | "provider"; error: string };

export type EmailGateDeps = { db?: SupabaseClient | null; env?: NodeJS.ProcessEnv };

type Links = { page: string; oneClick: string };

/** The email dialect (inline, literal), the shell's own muted grey. */
const FOOTER_CELL = "padding-top:16px;font-size:13px;line-height:1.5;color:#71717a;";
const FOOTER_LINK = "color:#71717a;text-decoration:underline;";

function cleanOrigin(origin: string | null | undefined): string | null {
  const o = origin?.trim().replace(/\/+$/, "");
  return o && /^https?:\/\/[^/\s]+$/.test(o) ? o : null;
}

/** The two links, null when this send goes without them, or "unavailable". */
function unsubscribeLinks(req: EmailRequest, address: string, now: Date, env: NodeJS.ProcessEnv): Links | null | "unavailable" {
  const secret = consentTokenSecrets(env).current;
  const origin = configuredOrigin(env) ?? cleanOrigin(req.origin);
  if (!secret || !origin) {
    const missing = !secret ? "CONSENT_TOKEN_SECRET is not set" : "no origin for the link (APP_ORIGIN)";
    if (isProductionEnv(env)) {
      console.error(`email gate: ${req.kind} for account ${req.accountId} not sent, its unsubscribe link cannot be made: ${missing}`);
      return "unavailable";
    }
    console.info(`email gate: ${req.kind} goes without an unsubscribe link outside production (${missing})`);
    return null;
  }
  const token = sealConsentToken({
    v: 1, a: req.accountId!, c: "email", t: address, i: now.getTime(),
    n: isUuid(req.contactId) ? req.contactId : null, k: req.kind,
  }, secret);
  return { page: `${origin}/u/${token}`, oneClick: `${origin}/api/unsubscribe/${token}` };
}

/** The send fields, and nothing of the gate's own. */
function sendFields(req: EmailRequest): SendEmailInput {
  return {
    to: req.to, fromName: req.fromName,
    ...(req.fromAddress !== undefined ? { fromAddress: req.fromAddress } : {}),
    ...(req.replyTo !== undefined ? { replyTo: req.replyTo } : {}),
    subject: req.subject, body: req.body,
  };
}

function withoutFooter(req: EmailRequest): SendEmailInput {
  return { ...sendFields(req), ...(req.html ? { html: req.html.split(UNSUBSCRIBE_MARKER).join("") } : {}) };
}

function withFooter(req: EmailRequest, links: Links | null): SendEmailInput {
  if (req.html !== undefined && !req.html.includes(UNSUBSCRIBE_MARKER)) {
    throw new Error(`email gate: ${req.kind}'s html has no unsubscribe marker (render it with shell())`);
  }
  if (!links) return withoutFooter(req);
  const lang = req.language === "es" ? "es" : "en";
  const lead = m[`email.unsubscribe.lead.${lang}`];
  const label = m[`email.unsubscribe.link.${lang}`];
  const row = `<tr><td style="${FOOTER_CELL}">${escapeHtml(lead)} `
    + `<a href="${escapeHtml(links.page)}" style="${FOOTER_LINK}">${escapeHtml(label)}</a>.</td></tr>`;
  return {
    ...sendFields(req),
    body: `${req.body}\n\n${lead} ${label}: ${links.page}`,
    ...(req.html ? { html: req.html.replace(UNSUBSCRIBE_MARKER, row) } : {}),
    headers: { "List-Unsubscribe": `<${links.oneClick}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export async function sendEmail(req: EmailRequest, deps: EmailGateDeps = {}): Promise<EmailSendResult> {
  const env = deps.env ?? process.env;
  if (!isEmailKind(req.kind)) throw new Error(`email gate: unknown email kind "${String(req.kind)}"`);
  const spec = EMAIL_KINDS[req.kind];
  if (spec.class !== "operator" && !req.accountId) throw new Error(`email gate: ${req.kind} needs its account`);
  const address = emailLedgerAddress(req.to);
  if (!address) return { kind: "blocked", reason: "no_address" };
  const now = req.now ?? new Date();

  if (emailReadsLedger(req.kind)) {
    if (!deps.db) throw new Error(`email gate: ${req.kind} reads the ledger and needs a client`);
    try {
      const state = await readConsentState(deps.db, req.accountId!, "email", address);
      if (state.state === "stopped") return { kind: "blocked", reason: "stopped" };
      if (state.state === "held") return { kind: "blocked", reason: "held" };
    } catch (e) {
      console.error(`email gate: ${req.kind} for account ${req.accountId} blocked, consent state unreadable: ${loggableError(e)}`);
      return { kind: "blocked", reason: "ledger_unavailable" };
    }
  }

  if (spec.hours !== "any") {
    let zone: string | null;
    if (req.accountZone !== undefined) {
      zone = req.accountZone;
    } else {
      if (!deps.db) throw new Error(`email gate: ${req.kind} needs a client to read the account's zone`);
      try {
        zone = await readAccountTimezone(deps.db, req.accountId!);
      } catch (e) {
        console.error(`email gate: ${req.kind} for account ${req.accountId} blocked, zone unreadable: ${loggableError(e)}`);
        return { kind: "blocked", reason: "ledger_unavailable" };
      }
    }
    const opening = nextOpening(spec.hours, now, zone);
    if (expiresBeforeOpening(opening, req.deadline)) return { kind: "blocked", reason: "window_after_deadline" };
    if (opening) return { kind: "deferred", until: opening, zone: hoursZone(zone) };
  }

  let provider: EmailProvider;
  try {
    provider = getEmailProvider(env);
  } catch (e) {
    return { kind: "failed", stage: "provider_unavailable", error: e instanceof Error ? e.message : String(e) };
  }

  let input: SendEmailInput;
  if (spec.footer === "unsubscribe") {
    const links = unsubscribeLinks(req, address, now, env);
    if (links === "unavailable") return { kind: "blocked", reason: "unsubscribe_unavailable" };
    input = withFooter(req, links);
  } else {
    input = withoutFooter(req);
  }

  try {
    const { providerMessageId } = await provider.send(input);
    return { kind: "sent", providerMessageId };
  } catch (e) {
    return { kind: "failed", stage: "provider", error: e instanceof Error ? e.message : String(e) };
  }
}

/** The gate said no. `message` is the provider's own words for a failure. */
export class EmailNotSent extends Error {
  constructor(readonly result: Exclude<EmailSendResult, { kind: "sent" }>) {
    super(result.kind === "failed" ? result.error
      : result.kind === "blocked" ? `email not sent: ${result.reason}`
      : `email deferred until ${result.until.toISOString()}`);
    this.name = "EmailNotSent";
  }
}

/** `sendEmail` for a caller whose existing catch handles a throw. */
export async function sendEmailOrThrow(req: EmailRequest, deps: EmailGateDeps = {}): Promise<SendEmailResult> {
  const r = await sendEmail(req, deps);
  if (r.kind === "sent") return { providerMessageId: r.providerMessageId };
  throw new EmailNotSent(r);
}

/** What a cron tick's `ctx.email` is (harness.ts): the gate, bound to the tick's client. */
export type GatedEmail = {
  readonly isFake: boolean;
  send(input: EmailRequest): Promise<SendEmailResult>;
};

/** Builds the provider ONCE, eagerly: a production tick with Resend unset
 *  fails at construction, before any query (context.ts's designed failure). */
export function emailSenderFor(db: SupabaseClient, env: NodeJS.ProcessEnv = process.env): GatedEmail {
  const provider = getEmailProvider(env);
  return { isFake: provider.isFake, send: (input) => sendEmailOrThrow(input, { db, env }) };
}

/**
 * A provider-shaped sender bound to ONE operator kind (plan G11), for the two
 * operator paths that take an EmailProvider: the sending-address check
 * (preflight.ts, which also reads `isFake`) and the billing link
 * (billing-link.ts). It rethrows the provider's own words.
 */
export function operatorMailer(kind: OperatorEmailKind, accountId: string | null, env: NodeJS.ProcessEnv = process.env): EmailProvider {
  const provider = getEmailProvider(env);
  return {
    isFake: provider.isFake,
    ...(provider.redirectTo !== undefined ? { redirectTo: provider.redirectTo } : {}),
    send: (input) => sendEmailOrThrow({ ...input, accountId, kind }, { env }),
  };
}
```

- [ ] **Step 4: Run to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/email-gate.test.ts src/lib/email
```
Expected (predicted): all pass.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | drop the `isEmailKind` throw | "throws on a kind the registry does not hold" |
| 2 | `readConsentState(deps.db, req.accountId!, "email", req.to)` | "%s to a stopped address is blocked `stopped`, read on the LEDGER KEY" (all seven) |
| 3 | `emailReadsLedger` bypassed: always read when `deps.db` is set, and pass `db` in the not-subject cases | "%s is NOT subject to the ledger" |
| 4 | the ledger `catch` returns `null` and falls through | "a held address … an unreadable ledger is blocked" |
| 5 | delete the hours block | "outside 08:00-21:00 … deferred" |
| 6 | `List-Unsubscribe: <${links.page}>` | "a customer kind carries the two headers exactly …" |
| 7 | seal `t: req.to` | the same case (t mismatches) |
| 8 | `withFooter`: `req.html + row` instead of the replace | "the footer row replaces the marker, under the message" |
| 9 | `lang` fixed to `"en"` | "in Spanish when the email is Spanish" |
| 10 | registry: `staff.composer_email.footer = "unsubscribe"` | "operator mail and staff-typed mail carry no link …" ([Q4]) |
| 11 | `sendFields` returns `{ ...req }` | "the provider gets the send fields ONLY" |
| 12 | `configuredOrigin(env) ?? …` → `cleanOrigin(req.origin) ?? configuredOrigin(env)` | "the request's origin is used when APP_ORIGIN is unset …" |
| 13 | `n: req.contactId ?? null` | "a contact id that is not a uuid is left out …" |
| 14 | drop the marker check in `withFooter` | "a customer email whose html has no marker …" |
| 15 | `unsubscribeLinks`: return `null` in production too | "in PRODUCTION a customer kind is blocked …" |
| 16 | `unsubscribeLinks`: return `"unavailable"` outside production too | "OUTSIDE production a customer kind goes without …" |
| 17 | `EmailNotSent`: `super(\`email not sent: ${result.kind}\`)` | "sendEmailOrThrow answers the id, or throws EmailNotSent … the provider's own words" |
| 18 | `emailSenderFor`: `get isFake() { return getEmailProvider(env).isFake; }` and no eager call | "emailSenderFor builds the provider EAGERLY" |
| 19 | resend.ts: drop the headers spread | resend.test "passes the unsubscribe headers through exactly" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/email-gate.ts apps/web/src/lib/consent/email-gate.test.ts apps/web/src/lib/email/environment.ts apps/web/src/lib/email/types.ts apps/web/src/lib/email/resend.ts apps/web/src/lib/email/resend.test.ts apps/web/src/lib/email/index.ts apps/web/src/lib/email/email.test.ts
git commit -m "feat(consent): the email gate — the ledger for automated mail, the fixed hours, the unsubscribe footer and RFC 8058 headers"
```

---

### Task 6: Every cron email through the gate: the harness, holdOrSend, and nine passes

**Owner:** bis-automations. **Tier:** HIGH. **Questions:** none.

**Files:**
- Modify: `apps/web/src/lib/automations/context.ts`, `harness.ts`, `harness.test.ts`, `imports.test.ts`
- Modify: `apps/web/src/lib/automations/hold-or-send.ts`, `hold-or-send.test.ts`
- Modify: `apps/web/src/lib/automations/passes/reminders.ts`, `followups.ts`, `review-request.ts`, `referral-ask.ts`, `reactivation.ts`, `quote-followup.ts`, `no-show-nudge.ts`, `weekly-report.ts`, `weekly-agency-report.ts`, and each one's `.test.ts`
- Modify: `apps/web/src/lib/automations/sentinel.test.ts`, `apps/web/src/app/api/cron/reminders/route.test.ts`

**Interfaces:**
- Consumes: `GatedEmail`, `emailSenderFor`, `EmailNotSent`, `EmailBlockReason` (Task 5); `AutomationEmailKind` (Task 4); `m["automations.reason.emailLedgerRetry"]`, `m["automations.reason.emailSetupRetry"]` (Task 4); `DueReferralAsk` without `contactMarketingEmailOptedOut` (Task 1).
- Produces:
  - `PassContext.email: GatedEmail` (was `EmailProvider`). Its `send` takes the gate's `EmailRequest` and throws `EmailNotSent` when the gate did not send (G10).
  - `holdOrSend` turns `EmailNotSent` into rows: `deferred` → held at the gate's opening; `ledger_unavailable` → held `LEDGER_RETRY_MS` with `REASONS.emailLedgerRetry`; `unsubscribe_unavailable` → held `LEDGER_RETRY_MS` with `REASONS.emailSetupRetry`; `stopped` / `held` → skipped, "They asked not to get these emails"; `no_address` → skipped, "No email address on file"; `window_after_deadline` → skipped, choice 21's line; `failed` → today's failure path.
  - `EMAIL_BLOCK_REASONS` exported from `hold-or-send.ts`.
  - The referral ask's `skippedOptedOut` counter is gone (the gate's block is counted `blocked`, and gives back its cap place, G13).

**Every pass's send gains the same fields** (the row carries each one): `accountId: row.accountId`, `kind: "<its kind>"`, `contactId: row.contactId`, `origin: ctx.origin`, `now: ctx.now`, `accountZone: row.accountTimezone`. The reminder also passes `deadline: new Date(reminder.startsAt)` (choice 21, the same deadline its HoldSubject carries). The two reports pass `accountId: row.accountId, kind: "operator.weekly_report"` and `accountId: null, kind: "operator.agency_report"`.

| Pass | Kind | Where its `ctx.email.send({` is |
|---|---|---|
| `reminders.ts` | `automation.reminder` | inside `processReminders`' `holdOrSend` callback |
| `followups.ts` | `automation.followup` | inside its `holdOrSend` callback |
| `review-request.ts` | `automation.review_request` | `async function sendEmail(` |
| `referral-ask.ts` | `automation.referral_ask` | `async function sendEmail(` |
| `reactivation.ts` | `automation.reactivation` | inside its `holdOrSend` callback |
| `quote-followup.ts` | `automation.quote_followup` | `async function sendEmail(` |
| `no-show-nudge.ts` | `automation.no_show_nudge` | `async function sendEmail(` |
| `weekly-report.ts` | `operator.weekly_report` | the per-recipient loop |
| `weekly-agency-report.ts` | `operator.agency_report` | after `agencyRollupEmail` |

- [ ] **Step 1: Write the failing tests**

Edit `apps/web/src/lib/automations/hold-or-send.test.ts`. Add to its imports:
```ts
import { EmailNotSent } from "@/lib/consent/email-gate";
import { LEDGER_RETRY_MS } from "./send-sms";
```
(If `send-sms` is already imported, add `LEDGER_RETRY_MS` to that import.) Append at the end (the file's own `ctx(NOON)`, `subject()` and log-call helpers are used as they are; `grep -n "function subject\|function ctx\|const NOON" apps/web/src/lib/automations/hold-or-send.test.ts` finds them):
```ts
describe("holdOrSend: the EMAIL gate's answers (consent PR-3, plan G10)", () => {
  const email = () => ({ ...subject(), channel: "email" as const, smsKind: undefined });
  const logged = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1] as { status: string; reason: string; heldUntil?: string });

  it("a gate deferral is the held row at the gate's own opening (mutation: treat EmailNotSent as a failure → FAILS)", async () => {
    const until = new Date(NOON.getTime() + 3_600_000);
    expect(await holdOrSend(ctx(NOON), email(), async () => { throw new EmailNotSent({ kind: "deferred", until, zone: "America/Chicago" }); })).toBe("held");
    expect(logged()).toEqual([expect.objectContaining({ status: "held", heldUntil: until.toISOString() })]);
  });

  it.each([
    ["ledger_unavailable", "Waiting a few minutes: couldn't check whether they can get emails"],
    ["unsubscribe_unavailable", "Waiting a few minutes: the unsubscribe link couldn't be added"],
  ] as const)("an outage (%s) is a %j re-hold for LEDGER_RETRY_MS, never a send or a skip (fails closed; mutation: log it skipped → the email never goes once the outage ends, FAILS)", async (reason, words) => {
    expect(await holdOrSend(ctx(NOON), email(), async () => { throw new EmailNotSent({ kind: "blocked", reason }); })).toBe("held");
    expect(logged()).toEqual([expect.objectContaining({
      status: "held", reason: words, heldUntil: new Date(NOON.getTime() + LEDGER_RETRY_MS).toISOString(),
    })]);
  });

  it.each([
    ["stopped", "They asked not to get these emails"],
    ["held", "They asked not to get these emails"],
    ["no_address", "No email address on file"],
    ["window_after_deadline", "Not sent: quiet hours ran past the appointment"],
  ] as const)("a refusal (%s) is ONE skipped row reading %j, and no throw (mutation: rethrow it → FAILS)", async (reason, words) => {
    expect(await holdOrSend(ctx(NOON), email(), async () => { throw new EmailNotSent({ kind: "blocked", reason }); })).toBe("skipped");
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: words })]);
  });

  it("a provider failure is today's failure: a failed row and the throw (mutation: swallow it → the pass counts it sent, FAILS)", async () => {
    await expect(holdOrSend(ctx(NOON), email(), async () => {
      throw new EmailNotSent({ kind: "failed", stage: "provider", error: "rejected" });
    })).rejects.toThrow("rejected");
    expect(logged()).toEqual([expect.objectContaining({ status: "failed" })]);
  });
});
```
(`dbMocks` / `ctx` / `NOON` / `subject` are this file's own names; if they differ, use the file's names — the assertions are what matter.)

Edit `apps/web/src/lib/automations/harness.test.ts`. Find:
```ts
const gate = vi.hoisted(() => ({ smsSenderFor: vi.fn() }));
vi.mock("@/lib/consent/gate", () => gate);
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ isFake: true, send: async () => ({ providerMessageId: "e" }) }),
}));
```
Replace with:
```ts
const gate = vi.hoisted(() => ({ smsSenderFor: vi.fn() }));
vi.mock("@/lib/consent/gate", () => gate);
const emailGate = vi.hoisted(() => ({ emailSenderFor: vi.fn() }));
vi.mock("@/lib/consent/email-gate", () => emailGate);
```
In its `beforeEach`, add `emailGate.emailSenderFor.mockReset().mockReturnValue({ isFake: true, send: vi.fn() });`. Append:
```ts
describe("buildPassContext — email goes through the email gate, bound to the tick (consent PR-3)", () => {
  it("ctx.email IS the email gate's sender for this tick's client (mutation: build it from getEmailProvider again → emailSenderFor is never called, FAILS)", () => {
    const db = { tag: "tick-db" } as never;
    const sender = { isFake: false, send: vi.fn() };
    emailGate.emailSenderFor.mockReturnValue(sender);
    const c = buildPassContext({ db, now: new Date("2026-09-09T14:00:00Z"), origin: "https://app.example.com" });
    expect(c.email).toBe(sender);
    expect(emailGate.emailSenderFor).toHaveBeenCalledWith(db);
  });
});
```

Edit `apps/web/src/lib/automations/imports.test.ts`. Find:
```ts
  { rule: /(?:from\s+|import\s*\(\s*)["'](?:@\/lib\/|(?:\.\.\/)+)email(?:\/index)?(?:\.[jt]s)?["']/, allowed: ["harness.ts"] },
```
Replace with:
```ts
  // Consent PR-3: not even the harness any more — ctx.email is the email
  // gate (lib/consent/email-gate.ts), and scan 1 pins it as the only importer.
  { rule: /(?:from\s+|import\s*\(\s*)["'](?:@\/lib\/|(?:\.\.\/)+)email(?:\/index)?(?:\.[jt]s)?["']/, allowed: [] },
```
Find:
```ts
  { rule: /(?:from\s+|import\s*\(\s*)["'][^"']*\/resend["']/, allowed: ["harness.ts"] },   // the real email provider
```
Replace with:
```ts
  { rule: /(?:from\s+|import\s*\(\s*)["'][^"']*\/resend["']/, allowed: [] },   // the real email provider
```
Update the file's header comment's first rule sentence to "NO module here may import the EMAIL factory or the SMS factory (consent PR-1 and PR-3: both go through their gates, `ctx.sms` and `ctx.email`)" and the mutation line to "add `import { getEmailProvider } from "@/lib/email"` to harness.ts → FAILS".

For each of the seven customer passes, add ONE test to its `.test.ts` that pins the gate fields, next to the file's existing "sends" case (the file's own `ctx()`, due-row builder and `emailSend` spy; the names below are `reminders.test.ts`'s — `grep -n "emailSend\|function ctx" <file>` finds each file's):
```ts
  it("the email goes through the gate as automation.reminder, for this account and contact, at the tick's instant, with the appointment as its deadline (consent PR-3; mutation: kind \"automation.followup\" → FAILS; mutation: drop the deadline → FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([reminder()]);
    await remindersPass.run(ctx(NOON));
    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "acct_1", kind: "automation.reminder", contactId: "ct_1", origin: "https://app.example.com",
      now: NOON, accountZone: "America/Chicago", deadline: new Date(reminder().startsAt),
    }));
  });
```
The other six are the same shape with their own kind, their own due-row builder and `now`, no `deadline`, and the values their fixture carries (`accountId`, `contactId`, `accountTimezone`): followups → `automation.followup`; review-request → `automation.review_request`; referral-ask (email channel row) → `automation.referral_ask`; reactivation → `automation.reactivation`; quote-followup (email channel) → `automation.quote_followup`; no-show-nudge (email channel) → `automation.no_show_nudge`. Each title names the mutation "kind → another pass's kind → FAILS".

For each pass, also one stopped case (the gate refuses; the pass's own counters say so; nothing is stamped):
```ts
  it("an unsubscribed customer: the gate refuses, the row is skipped with the reason the client reads, nothing is stamped, and the tick's cap place is given back (decision 7, G13; mutation: count it sent → FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([reminder()]);
    emailSend.mockRejectedValueOnce(new EmailNotSent({ kind: "blocked", reason: "stopped" }));
    expect(await remindersPass.run(ctx(NOON))).toEqual({ sent: 0, failed: 0, unstamped: 0, held: 0, blocked: 1 });
    expect(dbMocks.stampReminderSent).not.toHaveBeenCalled();
  });
```
(each file imports `EmailNotSent` from `@/lib/consent/email-gate`; for the capped passes the expected counters are the file's own `EMPTY` with `blocked: 1`).

Weekly reports: one test each that the send carries `kind: "operator.weekly_report"` with the account's id, and `kind: "operator.agency_report"` with `accountId: null` (mutation: a customer kind → FAILS).

Edit `apps/web/src/lib/automations/passes/referral-ask.test.ts`:
1. In its base row builder, delete `contactMarketingEmailOptedOut: false,`; in `EMPTY`, delete `skippedOptedOut: 0,`.
2. Replace the case `"a contact who asked not to get marketing email is skipped on the EMAIL channel: logged, not sent, not stamped"` with:
```ts
  it("an email-stopped customer (the ledger, via the gate) is skipped on the EMAIL channel: logged with the reason the client reads, not stamped (consent PR-3: the pass no longer reads 0049's column; mutation: count a gate refusal as sent → FAILS)", async () => {
    dbMocks.listDueReferralAsks.mockResolvedValue([email()]);
    emailSend.mockRejectedValueOnce(new EmailNotSent({ kind: "blocked", reason: "stopped" }));
    expect(await referralAskPass.run(ctx())).toEqual({ ...EMPTY, blocked: 1 });
    expect(dbMocks.stampReferralAsked).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "referral_ask", channel: "email", subjectKey: "booking:bk_r1", contactId: "ct_1",
      status: "skipped", reason: OPTED_OUT_REASON,
    }));
  });
```
3. In `"the SMS channel needs no address, no reply-to, and ignores the EMAIL opt-out — the text still goes"`, delete `contactMarketingEmailOptedOut: true` from the row and rename it `"the SMS channel needs no address and no reply-to — the text still goes"`.
4. Replace `"released from a hold, an email row whose contact opted out DURING the hold is skipped — and leaves the queue"` with:
```ts
  it("released from a hold, an email row whose customer unsubscribed DURING the hold is skipped by the gate — and leaves the queue (mutation: rethrow the refusal → the release reports failed, FAILS)", async () => {
    dbMocks.getDueReferralAskById.mockResolvedValue({ due: email() });
    emailSend.mockRejectedValueOnce(new EmailNotSent({ kind: "blocked", reason: "stopped" }));
    expect(await releaseReferralAsk(ctx(), heldRow({ channel: "email" }))).toBe("skipped");
    expect(skippedReasons()).toEqual([OPTED_OUT_REASON]);
  });
```
5. In `"rows that cannot go spend NONE of the tick's ten attempts — another booking's email still goes"`, the eleven `optedOut` rows lose `contactMarketingEmailOptedOut: true`, the email spy refuses them, and the expectation changes:
```ts
    const optedOut = Array.from({ length: 11 }, (_, n) =>
      email({ bookingId: `bk_out_${n}`, contactId: `ct_out_${n}` }));
    emailSend.mockImplementation(async (input: { contactId?: string }) => {
      if (input.contactId?.startsWith("ct_out_")) throw new EmailNotSent({ kind: "blocked", reason: "stopped" });
      return { providerMessageId: "re_ok" };
    });
    dbMocks.listDueReferralAsks.mockResolvedValue([...noAddress, ...optedOut, email({ bookingId: "bk_ok" })]);
    expect(await referralAskPass.run(ctx()))
      .toEqual({ ...EMPTY, sent: 1, skippedNoMailingAddress: 11, blocked: 11 });
    expect(dbMocks.stampReferralAsked).toHaveBeenCalledWith(expect.anything(), "bk_ok");
```
and its comment's mutation line becomes "move the address/reply-to checks below the caps, or stop giving back the cap place on a gate refusal → this reds BY NAME".

Edit `apps/web/src/lib/automations/sentinel.test.ts`: delete `contactMarketingEmailOptedOut: false,` from its referral fixture.

Edit `apps/web/src/app/api/cron/reminders/route.test.ts` (the real harness and the real email gate run here now; review the `vi.mock factories` rule):
Find:
```ts
  readConsentState: async () => { throw new Error("route.test: no text is due"); },
```
Replace with:
```ts
  // Consent PR-3: the reminder and follow-up EMAILS read the ledger through
  // the email gate now, so this answers — allowed — rather than throwing
  // (a throw would fail closed into a re-hold and change every count below).
  // Still no text is due in this suite.
  readConsentState: async () => ({ state: "allowed" as const }),
```

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/automations src/app/api/cron/reminders/route.test.ts
```
Expected (predicted): the new cases fail (no `kind` on the send; `EmailNotSent` counted `failed`; `emailSenderFor` never called; the imports scan names `harness.ts`); the typecheck errors in `referral-ask.ts` (Checkpoint A) are gone only after Step 3.

- [ ] **Step 3: Implement**

Edit `apps/web/src/lib/automations/context.ts`. Find:
```ts
import type { EmailProvider } from "@/lib/email/types";
```
Replace with:
```ts
import type { GatedEmail } from "@/lib/consent/email-gate";
```
Find:
```ts
  /** Constructed once per tick by the harness. In production this THROWS at
   *  construction when RESEND_API_KEY/EMAIL_FROM are unset — loudly, before
   *  any query, which is the designed failure. */
  email: EmailProvider;
```
Replace with:
```ts
  /** THE EMAIL GATE, bound to this tick's client (consent chain PR-3, spec
   *  §4.3 "Routing": "the harness's email factory … call the gate's
   *  sendEmail"). Every automation email names its kind and goes through the
   *  ledger (the automated classes), the fixed hours and the unsubscribe
   *  footer; a refusal throws EmailNotSent, which holdOrSend turns into its
   *  row. Constructed once per tick: in production it THROWS at construction
   *  when RESEND_API_KEY/EMAIL_FROM are unset — loudly, before any query,
   *  which is the designed failure. */
  email: GatedEmail;
```

Edit `apps/web/src/lib/automations/harness.ts`. Find:
```ts
import { getEmailProvider } from "@/lib/email";
import { smsSenderFor } from "@/lib/consent/gate";
```
Replace with:
```ts
import { smsSenderFor } from "@/lib/consent/gate";
import { emailSenderFor } from "@/lib/consent/email-gate";
```
Replace the doc comment's first paragraph (`THE ONLY automations module allowed to import the EMAIL provider factory …`) with:
```ts
 * Builds a tick's context. No automations module imports a provider factory
 * (imports.test.ts): since the consent chain's PR-1 a pass texts only through
 * `ctx.sms` (the SMS gate) and since PR-3 it emails only through `ctx.email`
 * (the email gate, lib/consent/email-gate.ts). Each gate is the only module
 * outside its provider's own files that may reach that provider
 * (lib/consent/scans.test.ts).
```
Find:
```ts
  return { ...input, email: getEmailProvider(), sms: smsSenderFor(input.db) };
```
Replace with:
```ts
  return { ...input, email: emailSenderFor(input.db), sms: smsSenderFor(input.db) };
```

Edit `apps/web/src/lib/automations/hold-or-send.ts`. Add to its imports:
```ts
import { EmailNotSent, type EmailBlockReason } from "@/lib/consent/email-gate";
```
and add `LEDGER_RETRY_MS` to its `./send-sms` import. In `REASONS`, after `ledgerRetry: …,` add:
```ts
  /** The email gate's two outages (consent PR-3): each a LEDGER_RETRY_MS
   *  re-hold, never a skip, so the email goes once the outage ends. */
  emailLedgerRetry: m["automations.reason.emailLedgerRetry"],
  emailSetupRetry: m["automations.reason.emailSetupRetry"],
```
Replace `optedOutEmail`'s doc comment with:
```ts
  /** An automated email to a customer whose email is stopped in the ledger
   *  (consent PR-3): they unsubscribed, staff recorded their request, or
   *  0049's old "No marketing emails" was folded in. The email gate refuses
   *  it for every automated kind (decision 7), and this is the line the
   *  client reads on the Activity page. */
```
After `export const BLOCK_REASONS … };` add:
```ts
/** Every refusal the EMAIL gate can hand an automation, as the Activity page
 *  says it. Its two outages are re-holds, not refusals (holdOrSend). */
export const EMAIL_BLOCK_REASONS: Record<Exclude<EmailBlockReason, "ledger_unavailable" | "unsubscribe_unavailable">, string> = {
  no_address: REASONS.noEmail,
  stopped: REASONS.optedOutEmail,
  held: REASONS.optedOutEmail,
  window_after_deadline: REASONS.windowAfterDeadline,
};
```
In `holdOrSend`'s catch, find:
```ts
    if (e instanceof SmsBlocked) {
      await logSkipped(ctx, s, BLOCK_REASONS[e.reason]);
      return "skipped";
    }
```
Replace with:
```ts
    if (e instanceof SmsBlocked) {
      await logSkipped(ctx, s, BLOCK_REASONS[e.reason]);
      return "skipped";
    }
    if (e instanceof EmailNotSent) {
      const r = e.result;
      if (r.kind === "deferred") {
        await writeHeld(ctx, s, r.until, r.zone);
        return "held";
      }
      if (r.kind === "blocked") {
        if (r.reason === "ledger_unavailable" || r.reason === "unsubscribe_unavailable") {
          await writeHeld(ctx, s, new Date(ctx.now.getTime() + LEDGER_RETRY_MS), zone,
            r.reason === "ledger_unavailable" ? REASONS.emailLedgerRetry : REASONS.emailSetupRetry);
          return "held";
        }
        await logSkipped(ctx, s, EMAIL_BLOCK_REASONS[r.reason]);
        return "skipped";
      }
      // failed: today's failure path, below.
    }
```
Update the header comment's list: after `SmsBlocked → skipped with the gate's reason;` add `EmailNotSent → held, skipped or failed by the email gate's answer (consent PR-3);`.

In each pass, add the fields to its `ctx.email.send({` call (the table above). For example `reminders.ts`, find:
```ts
        await ctx.email.send({
          to,
          fromName: brand.name,
          fromAddress: reminder.fromEmail ?? undefined,
```
Replace with:
```ts
        await ctx.email.send({
          // The email gate (consent PR-3): the ledger, the fixed hours at this
          // tick's instant, choice 21's deadline, and the unsubscribe footer.
          accountId: reminder.accountId, kind: "automation.reminder", contactId: reminder.contactId,
          origin: ctx.origin, now: ctx.now, accountZone: reminder.accountTimezone,
          deadline: new Date(reminder.startsAt),
          to,
          fromName: brand.name,
          fromAddress: reminder.fromEmail ?? undefined,
```
`followups.ts`: `accountId: followup.accountId, kind: "automation.followup", contactId: followup.contactId, origin: ctx.origin, now: ctx.now, accountZone: followup.accountTimezone,` as the first lines of its `ctx.email.send({`. The four `sendEmail(ctx, row, …)` helpers (review-request, referral-ask, quote-followup, no-show-nudge) and reactivation's callback: `accountId: row.accountId, kind: "<kind>", contactId: row.contactId, origin: ctx.origin, now: ctx.now, accountZone: row.accountTimezone,`. `weekly-report.ts`: `await ctx.email.send({ accountId: row.accountId, kind: "operator.weekly_report", to, fromName: brand.name, replyTo, subject, body: text, html });`. `weekly-agency-report.ts`: `await ctx.email.send({ accountId: null, kind: "operator.agency_report", to: reportEmail, fromName: brand.name, subject, body: text, html });`.

Edit `apps/web/src/lib/automations/passes/referral-ask.ts`: delete the block that begins with the comment line `// First the person: a contact the operator marked "No marketing` down to and including:
```ts
      if (row.contactMarketingEmailOptedOut) {
        c.skippedOptedOut++;
        await logSkipped(ctx, subject, REASONS.optedOutEmail);
        continue;
      }
```
(keep the "Then the account" paragraph and the address / reply-to checks, rewording its first line to "The account: the footer prints the postal address …"), delete `skippedOptedOut: 0,` from the counters object and from its type, and add to the comment above the address check: "The email stop itself is the email gate's (consent PR-3): a stopped customer is refused inside holdOrSend, counted `blocked`, and gives back its cap place below."

Edit `apps/web/src/lib/automations/passes/reactivation.ts`: its header comment's line about `getDueReactivationById filter \`marketing_email_opted_out_at is null\`` becomes "`listDueReactivations` and `getDueReactivationById` leave out an email-stopped contact (the ledger, consent PR-3), in the walk, never as a skip here (the #118 I1 trap)".

- [ ] **Step 4: Run to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/automations src/app/api/cron/reminders/route.test.ts
pnpm typecheck
```
Expected (predicted): all pass; the typecheck fails ONLY in Task 11's three files (Checkpoint A lists them).

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | harness: `email: getEmailProvider()` back (and its import) | harness.test "ctx.email IS the email gate's sender"; imports.test |
| 2 | holdOrSend: delete the `EmailNotSent` branch | every new holdOrSend case |
| 3 | holdOrSend: log `ledger_unavailable` skipped instead of re-holding | "an outage (ledger_unavailable) is a … re-hold" |
| 4 | `EMAIL_BLOCK_REASONS.stopped` → `REASONS.failed` | "a refusal (stopped) …" |
| 5 | reminders.ts: `kind: "automation.followup"` | the reminder's gate-fields case |
| 6 | reminders.ts: drop `deadline` | the same case |
| 7 | referral-ask.ts: drop `attemptsThisTick--` in its `outcome === "skipped"` branch | "rows that cannot go spend NONE of the tick's ten attempts" |
| 8 | weekly-agency-report.ts: `kind: "automation.reactivation"` | its operator-kind case |
| 9 | route.test: put the throwing `readConsentState` back | the route's reminder/follow-up counts (fail closed → held) — proves the route runs the real gate |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/automations apps/web/src/app/api/cron/reminders/route.test.ts
git commit -m "feat(consent): every cron email through the email gate — nine passes name their kind; holdOrSend reads the gate's answer"
```

---

### Task 7: The booking page, the cancel page, the form and the composer through the gate

**Owner:** bis-comms (bis-booking reviews the booking page's two sends). **Tier:** HIGH. **Questions:** [Q4] (the composer's kind carries no footer, so it passes no origin).

**Files:**
- Modify: `apps/web/src/app/b/[publicId]/actions.ts`, `actions.test.ts`
- Modify: `apps/web/src/app/b/[publicId]/cancel/[token]/actions.ts`, `actions.test.ts`
- Modify: `apps/web/src/lib/forms/enrich.ts`, `apps/web/src/app/f/[publicId]/actions.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts`, `actions.test.ts`

**Interfaces:**
- Consumes: `sendEmailOrThrow`, `EmailNotSent` (Task 5); the kinds `booking.confirmation`, `forms.receipt`, `staff.composer_email`, `operator.booking_alert`, `operator.cancel_notice`, `operator.lead_alert` (Task 4).
- Produces: nothing new. `enrich.ts`'s private `receipt()` gains `contactId` and `origin` parameters.

**The rule for every site in this task and Task 8:** `getEmailProvider()` and `provider.send(x)` become `sendEmailOrThrow({ ...x, accountId, kind, … })`. Its throw lands in the catch that already surrounds each send, so every "a failed email is logged, never a failed booking/lead/call" rule stands unchanged. A customer-initiated kind also passes `contactId`, `language` and `origin` (the unsubscribe links, G7); an operator kind passes neither.

**The tests for every site in this task and Task 8** spy on the REAL gate, so the kind each site names is asserted and the send still goes through the gate's own rules:
```ts
vi.mock("@/lib/consent/email-gate", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/consent/email-gate")>();
  return { ...real, sendEmailOrThrow: vi.fn(real.sendEmailOrThrow) };
});
import { sendEmailOrThrow } from "@/lib/consent/email-gate";
const gated = () => vi.mocked(sendEmailOrThrow).mock.calls.map((c) => c[0]);
```
(add `vi.mocked(sendEmailOrThrow).mockClear()` to the file's `beforeEach`). The provider mock each file already has (`vi.mock("@/lib/email", …)`) stays: the gate reaches it.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/app/b/[publicId]/actions.test.ts` — add the spy block above, and inside the existing `describe("submitBookingAction — the alert and the confirmation are not the same send …")` (its own submit helper and fixture):
```ts
  it("the alert goes as operator.booking_alert and the confirmation as booking.confirmation — the customer-initiated kind, in the booker's language, with this booking's contact (consent PR-3; mutation: send the confirmation as automation.reminder → an unsubscribed booker would get no confirmation of the booking they just made, FAILS)", async () => {
    // (arrange exactly as the sibling "the alert has NO fromAddress" case does, with locale "es")
    expect(gated().map((r) => r.kind)).toEqual(["operator.booking_alert", "booking.confirmation"]);
    expect(gated()[1]).toMatchObject({ accountId: ACCOUNT_ID, contactId: expect.any(String), language: "es" });
    expect(gated()[0]).not.toHaveProperty("contactId");
  });

  it("with CONSENT_TOKEN_SECRET and APP_ORIGIN set, the confirmation reaches the provider carrying the footer and the RFC 8058 headers, and the alert carries neither (choice 23; mutation: send the alert as a customer kind → headers on the staff alert, FAILS)", async () => {
    vi.stubEnv("CONSENT_TOKEN_SECRET", "booking-test-secret-0123456789abcdef");
    vi.stubEnv("APP_ORIGIN", "https://app.example.com");
    // (arrange as above)
    const [alert, confirmation] = sendMock.mock.calls.map((c) => c[0] as { headers?: Record<string, string>; body: string });
    expect(alert!.headers).toBeUndefined();
    expect(confirmation!.headers!["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(confirmation!.body).toMatch(/¿No quiere recibir estos correos\? Cancelar suscripción: https:\/\/app\.example\.com\/u\//);
    vi.unstubAllEnvs();
  });
```
(`ACCOUNT_ID` and `sendMock` are this file's own names for the calendar's account and the provider's send; use the file's names if they differ. The arrange lines are the sibling case's, copied, with the posted `locale` set to `es`.)

`apps/web/src/app/b/[publicId]/cancel/[token]/actions.test.ts` — the spy block, and next to its existing notify case:
```ts
  it("the cancel notice to staff goes as operator.cancel_notice for the booking's account (consent PR-3; mutation: another kind → FAILS)", async () => {
    // (arrange exactly as the existing "notifies the calendar's notify_emails" case)
    expect(gated().map((r) => [r.kind, r.accountId])).toEqual(
      expect.arrayContaining([["operator.cancel_notice", ACCOUNT_ID]]));
    expect(gated().every((r) => r.kind === "operator.cancel_notice")).toBe(true);
  });
```

`apps/web/src/app/f/[publicId]/actions.test.ts` — the spy block, and next to its existing receipt case (`grep -n "receipt" apps/web/src/app/f/[publicId]/actions.test.ts`):
```ts
  it("the lead alert goes as operator.lead_alert and the receipt as forms.receipt — customer-initiated, in the page's language, with the lead's contact and the request's origin (consent PR-3; mutation: send the receipt as operator.lead_alert → it carries no way out, FAILS)", async () => {
    // (arrange exactly as the existing receipt case, submitting from the Spanish page)
    const kinds = gated().map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["operator.lead_alert", "forms.receipt"]));
    expect(gated().find((r) => r.kind === "forms.receipt")).toMatchObject({
      accountId: expect.any(String), contactId: expect.any(String), language: "es", origin: expect.stringMatching(/^https?:\/\//),
    });
  });
```

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts` — the spy block, and next to its existing email-send case:
```ts
  it("a staff-typed email goes as staff.composer_email for this account and contact, and — [Q4] — reaches the provider with no unsubscribe footer and no headers, even with the secret set (choice 22; mutation: send it as a customer-initiated kind → headers appear, FAILS)", async () => {
    vi.stubEnv("CONSENT_TOKEN_SECRET", "composer-test-secret-0123456789abcdef");
    vi.stubEnv("APP_ORIGIN", "https://app.example.com");
    // (arrange exactly as the existing sendEmailAction success case)
    expect(gated()).toEqual([expect.objectContaining({ kind: "staff.composer_email", accountId: ACCOUNT_ID, contactId: CONTACT_ID })]);
    const provided = sendMock.mock.calls[0]![0] as { headers?: unknown; body: string };
    expect(provided.headers).toBeUndefined();
    expect(provided.body).not.toMatch(/Unsubscribe/);
    vi.unstubAllEnvs();
  });
```

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run "src/app/b/[publicId]/actions.test.ts" "src/app/b/[publicId]/cancel/[token]/actions.test.ts" "src/app/f/[publicId]/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"
```
Expected (predicted): the new cases fail (`gated()` is empty: nothing calls the gate yet). `f/[publicId]/actions.returning-lead.test.ts` is one of the two env suites and is not run here.

- [ ] **Step 3: Implement**

`apps/web/src/app/b/[publicId]/actions.ts`:
1. Replace `import { getEmailProvider } from "@/lib/email";` with `import { sendEmailOrThrow } from "@/lib/consent/email-gate";`.
2. In the comment block that begins `// Everything below is best-effort, structurally`, replace its first sentence's clause "`getEmailProvider()` THROWS the moment RESEND_API_KEY/EMAIL_FROM is missing or rotated in production (see `preflight.ts`)" with "a send through the email gate THROWS (`EmailNotSent`) when the provider is missing or refuses (consent PR-3; `sendEmailOrThrow`)".
3. Delete `const provider = getEmailProvider();`.
4. In the alert loop, `await provider.send({` becomes `await sendEmailOrThrow({ accountId: calendar.account_id, kind: "operator.booking_alert",` (the rest of the object unchanged).
5. The confirmation's `await provider.send({` becomes:
```ts
      await sendEmailOrThrow({
        // The customer-initiated kind (spec §4.3): it answers what the booker
        // just did, so an unsubscribe never stops it — and it still carries
        // the way out (consent PR-3).
        accountId: calendar.account_id, kind: "booking.confirmation", contactId, language: locale, origin,
```
(the rest unchanged: `to: email, fromName: brand.name, fromAddress: …, replyTo: …, subject: …, body: text, html,`).

`apps/web/src/app/b/[publicId]/cancel/[token]/actions.ts`:
1. Replace `import { getEmailProvider } from "@/lib/email";` with `import { sendEmailOrThrow } from "@/lib/consent/email-gate";`.
2. Delete `const provider = getEmailProvider();`.
3. `await provider.send({ to, fromName: brand.name, subject, body });` becomes `await sendEmailOrThrow({ accountId: row.account_id, kind: "operator.cancel_notice", to, fromName: brand.name, subject, body });`.

`apps/web/src/lib/forms/enrich.ts`:
1. Replace `import { getEmailProvider } from "@/lib/email";` with `import { sendEmailOrThrow } from "@/lib/consent/email-gate";`.
2. In the lead alert (`notify`), delete `const provider = getEmailProvider();` and change `await provider.send({` to `await sendEmailOrThrow({ accountId: form.account_id, kind: "operator.lead_alert",`.
3. Change the receipt's signature and send. Find:
```ts
async function receipt(
  db: ReturnType<typeof serviceDb>, form: FormRow, locale: "en" | "es",
  leadEmail: string, firstName: string,
): Promise<void> {
```
Replace with:
```ts
async function receipt(
  db: ReturnType<typeof serviceDb>, form: FormRow, locale: "en" | "es",
  leadEmail: string, firstName: string,
  /** Evidence in the unsubscribe token, and the links' origin (consent PR-3). */
  contactId: string | null, origin: string | null,
): Promise<void> {
```
Find:
```ts
  await getEmailProvider().send({
    to: leadEmail, fromName: brand.name, fromAddress: account?.from_email ?? undefined,
```
Replace with:
```ts
  // The customer-initiated kind (spec §4.3): the person who just filled the
  // form in, in the same request. An unsubscribe never stops it; it still
  // carries the way out.
  await sendEmailOrThrow({
    accountId: form.account_id, kind: "forms.receipt", contactId, language: locale, origin,
    to: leadEmail, fromName: brand.name, fromAddress: account?.from_email ?? undefined,
```
4. At the call site, `await receipt(db, form, locale, byKind.get("core.email") ?? "", byKind.get("core.first_name") ?? "");` becomes `await receipt(db, form, locale, byKind.get("core.email") ?? "", byKind.get("core.first_name") ?? "", contactId, origin);` (both are in `enrich`'s scope: the lead alert above uses them).

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts`:
1. Replace `import { getEmailProvider } from "@/lib/email";` with `import { sendEmailOrThrow } from "@/lib/consent/email-gate";`.
2. `({ providerMessageId } = await getEmailProvider().send({` becomes:
```ts
    ({ providerMessageId } = await sendEmailOrThrow({
      // A person's own reply (choice 22): the gate does not read the ledger
      // for it, and — [Q4] — it carries no unsubscribe footer. The composer
      // shows the notice when they unsubscribed (Task 12).
      accountId, kind: "staff.composer_email", contactId,
```
(the rest of the object unchanged). **If danlo answers Q4 "follow §4.3":** also pass `origin: configuredOrigin() ?? originFrom(await headers())` (both already importable from `@/lib/email/origin` and `next/headers`).

- [ ] **Step 4: Run to see them pass**

The same command as Step 2. Expected (predicted): all pass, and every existing case in the four files stays green (the gate reaches each file's own provider mock; outside production with no secret a customer email goes without its link, G8, so the existing body and html assertions are unchanged).

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | booking confirmation: `kind: "automation.reminder"` | "the alert goes as operator.booking_alert and the confirmation as booking.confirmation" |
| 2 | booking confirmation: drop `language: locale` | the same case; and the footer-language case |
| 3 | booking alert: `kind: "booking.confirmation"` | "… the alert carries neither" |
| 4 | receipt: `kind: "operator.lead_alert"` | "the lead alert goes as operator.lead_alert and the receipt as forms.receipt" |
| 5 | receipt call site: pass `null` for `origin` with APP_ORIGIN unset | the same case (`origin` expected to be a URL) |
| 6 | composer: `kind: "booking.confirmation"` | "a staff-typed email goes as staff.composer_email …" |
| 7 | cancel notice: `kind: "operator.booking_alert"` | "the cancel notice to staff goes as operator.cancel_notice" |

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/b/[publicId]/actions.ts" "apps/web/src/app/b/[publicId]/actions.test.ts" "apps/web/src/app/b/[publicId]/cancel/[token]/actions.ts" "apps/web/src/app/b/[publicId]/cancel/[token]/actions.test.ts" apps/web/src/lib/forms/enrich.ts "apps/web/src/app/f/[publicId]/actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/actions.test.ts"
git commit -m "feat(consent): the booking page, cancel page, form and composer email through the gate, each with its kind"
```

---

### Task 8: Voice, the call alert, the billing link and the sending-address check through the gate

**Owner:** bis-voice (registry, finish-call) and bis-platform (settings, billing). **Tier:** HIGH. **Questions:** none.

**Files:**
- Modify: `apps/web/src/lib/voice/tools/registry.ts`, `registry.test.ts`
- Modify: `apps/web/src/lib/voice/finish-call.ts`, `finish-call.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts`, `…/settings/billing-actions.ts`, `apps/web/src/lib/billing/billing-link.ts`

**Interfaces:**
- Consumes: `sendEmailOrThrow`, `operatorMailer` (Task 5); the kinds `voice.booked`, `voice.moved`, `voice.cancelled`, `operator.phone_change_alert`, `operator.call_alert`, `operator.sender_check`, `operator.billing_link` (Task 4).
- Produces: nothing new. `billing-link.ts` imports `type EmailProvider` from `@/lib/email/types` (not the index), so scan 1 sees no import of the factory module there.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/voice/tools/registry.test.ts` — the spy block from Task 7, and next to the existing book / reschedule / cancel email cases (the file's own tool-call helpers; `grep -n "book_appointment\|reschedule_appointment\|cancel_appointment" apps/web/src/lib/voice/tools/registry.test.ts`):
```ts
  it("the three emails to the caller go as voice.booked, voice.moved and voice.cancelled — customer-initiated, from the live call — and the staff alert as operator.phone_change_alert (consent PR-3, E1; mutation: send the cancellation as automation.reminder → an unsubscribed caller who just cancelled gets no confirmation, FAILS)", async () => {
    // (arrange and run the book, reschedule and cancel cases exactly as their existing tests do, one after another)
    const kinds = gated().map((r) => r.kind);
    expect(kinds).toEqual(expect.arrayContaining(["voice.booked", "voice.moved", "voice.cancelled", "operator.phone_change_alert"]));
    for (const r of gated().filter((x) => x.kind.startsWith("voice."))) {
      expect(r).toMatchObject({ accountId: expect.any(String), origin: expect.stringMatching(/^https?:\/\//) });
    }
    expect(gated().find((r) => r.kind === "voice.cancelled")).toHaveProperty("language");
  });
```

`apps/web/src/lib/voice/finish-call.test.ts` — the spy block, and next to its existing alert case:
```ts
  it("the call alert to staff goes as operator.call_alert for the call's account (consent PR-3; mutation: a customer kind → a footer on a staff alert, FAILS)", async () => {
    // (arrange exactly as the existing "emails every notify address" case)
    expect(gated().length).toBeGreaterThan(0);
    expect(gated().every((r) => r.kind === "operator.call_alert" && typeof r.accountId === "string")).toBe(true);
  });
```

The sending-address check and the billing link keep their unit tests unchanged (`preflight.test.ts`, `billing-link.test.ts` inject their own providers): `operatorMailer` is provider-shaped (G11). Their wiring is pinned by scan 1 (Task 13: neither action imports `@/lib/email`'s factory) and by one source assertion each, appended to `apps/web/src/lib/consent/email-gate.test.ts`:
```ts
describe("the two operator paths that take a provider are handed operatorMailer (G11)", () => {
  const read = (p: string) => readFileSync(join(fileURLToPath(new URL("../../", import.meta.url)), p), "utf8");
  it("the sending-address check sends as operator.sender_check (mutation: getEmailProvider() back → FAILS)", () => {
    expect(read("app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts"))
      .toMatch(/saveVerifiedFromAddress\(\s*operatorMailer\("operator\.sender_check", accountId\)/);
  });
  it("the billing link sends as operator.billing_link (mutation: getEmailProvider() back → FAILS)", () => {
    expect(read("app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts"))
      .toMatch(/email: operatorMailer\("operator\.billing_link", accountId\)/);
  });
});
```
(add `import { readFileSync } from "node:fs"; import { join } from "node:path"; import { fileURLToPath } from "node:url";` to that file's imports.)

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/voice/tools/registry.test.ts src/lib/voice/finish-call.test.ts src/lib/consent/email-gate.test.ts
```
Expected (predicted): the new cases fail.

- [ ] **Step 3: Implement**

`apps/web/src/lib/voice/tools/registry.ts`:
1. Replace `import { getEmailProvider } from "@/lib/email";` with `import { sendEmailOrThrow } from "@/lib/consent/email-gate";`.
2. `alertStaffOfPhoneChange`: delete `const provider = getEmailProvider();` (and its comment line "Throws synchronously when mail config is missing — inside this try."); `await provider.send({ to, fromName: brand.name, subject, body: text, html });` becomes `await sendEmailOrThrow({ accountId: ctx.accountId, kind: "operator.phone_change_alert", to, fromName: brand.name, subject, body: text, html });`.
3. The booking confirmation (`case "book_appointment"`): `await getEmailProvider().send({` becomes `await sendEmailOrThrow({ accountId: ctx.accountId, kind: "voice.booked", contactId, origin: ctx.origin,`.
4. The reschedule (`emailCustomer` in `case "reschedule_appointment"`): `await getEmailProvider().send({` becomes `await sendEmailOrThrow({ accountId: ctx.accountId, kind: "voice.moved", contactId: old.contact_id, origin: ctx.origin,`.
5. The cancellation (`emailCustomer` in `case "cancel_appointment"`): `await getEmailProvider().send({` becomes `await sendEmailOrThrow({ accountId: ctx.accountId, kind: "voice.cancelled", contactId: row.contact_id, language: locale, origin: ctx.origin,`.
(`contactId` in the booking case is the contact the tool just created or found; `old.contact_id` / `row.contact_id` are the booking rows' own. Each surrounding `try` already turns a throw into `emailFailed` or a log line.)

`apps/web/src/lib/voice/finish-call.ts`:
1. Replace `import { getEmailProvider } from "@/lib/email";` with `import { sendEmailOrThrow } from "@/lib/consent/email-gate";`.
2. Delete `const provider = getEmailProvider();`.
3. `await provider.send({ to, fromName: brand.name, subject: \`Call — ${outcome} — ${callerDisplay}\`, body: text, html });` becomes `await sendEmailOrThrow({ accountId: ctx.accountId, kind: "operator.call_alert", to, fromName: brand.name, subject: \`Call — ${outcome} — ${callerDisplay}\`, body: text, html });`.
4. The outer catch's comment ("getEmailProvider() throws synchronously when RESEND_API_KEY …") becomes "a send through the email gate throws EmailNotSent when the provider is missing or refuses; the per-recipient catch above already collects those, and this outer catch keeps anything else from violating never-throws."

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts`:
1. Replace `import { getEmailProvider } from "@/lib/email";` with `import { operatorMailer } from "@/lib/consent/email-gate";`.
2. `await saveVerifiedFromAddress(\n      getEmailProvider(), raw, adminEmail,` becomes `await saveVerifiedFromAddress(\n      operatorMailer("operator.sender_check", accountId), raw, adminEmail,` (keep it on the same line as the call's opening parenthesis, as the source assertion reads it: `saveVerifiedFromAddress(\n      operatorMailer(…` matches `\(\s*operatorMailer`).

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts`:
1. Replace `import { getEmailProvider } from "@/lib/email";` with `import { operatorMailer } from "@/lib/consent/email-gate";`.
2. `db, gateway: gateway.gateway, email: getEmailProvider(), origin, now: new Date(),` becomes `db, gateway: gateway.gateway, email: operatorMailer("operator.billing_link", accountId), origin, now: new Date(),`.

`apps/web/src/lib/billing/billing-link.ts`: `import type { EmailProvider } from "@/lib/email";` becomes `import type { EmailProvider } from "@/lib/email/types";`.

- [ ] **Step 4: Run to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/voice src/lib/consent/email-gate.test.ts src/lib/email/preflight.test.ts src/lib/billing "src/app/(dashboard)/dashboard/accounts/[accountId]/settings"
```
Expected (predicted): all pass. `settings/billing-actions.test.ts` mocks `@/lib/email`; `operatorMailer` calls the mocked `getEmailProvider`, so its cases keep their shape. If one of its `vi.mock("@/lib/email")` factories lacks `getEmailProvider`, it never reached the email before either; leave it.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | registry cancellation: `kind: "automation.reminder"` | "the three emails to the caller …" |
| 2 | registry phone-change alert: `kind: "voice.moved"` | the same case (the operator kind missing) |
| 3 | registry booked: drop `origin: ctx.origin` | the same case |
| 4 | finish-call: `kind: "voice.booked"` | "the call alert to staff goes as operator.call_alert" |
| 5 | settings/actions.ts: `getEmailProvider()` back | "the sending-address check sends as operator.sender_check" |
| 6 | billing-actions.ts: `getEmailProvider()` back | "the billing link sends as operator.billing_link" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/voice/tools/registry.ts apps/web/src/lib/voice/tools/registry.test.ts apps/web/src/lib/voice/finish-call.ts apps/web/src/lib/voice/finish-call.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/billing-actions.ts" apps/web/src/lib/billing/billing-link.ts apps/web/src/lib/consent/email-gate.test.ts
git commit -m "feat(consent): voice, the call alert, the billing link and the sending-address check email through the gate"
```

---

### Task 9: The one-click endpoint and the `/u/[token]` page

**Owner:** bis-comms (bis-frontend reviews the page; bis-design-reviewer audits it at Task 15). **Tier:** HIGH. **Questions:** [Q1] (the page asks for one click; the header one-click is instant), [Q5] (an unsubscribe over a staff stop is recorded).

**Files:**
- Create: `apps/web/src/lib/consent/unsubscribe.ts`, `unsubscribe.test.ts` (server: the token read and the two ledger writes)
- Create: `apps/web/src/lib/consent/unsubscribe-copy.ts`, `unsubscribe-copy.test.ts` (client-safe: the page's words)
- Create: `apps/web/src/app/api/unsubscribe/[token]/route.ts`, `route.test.ts`
- Create: `apps/web/src/app/u/[token]/page.tsx`, `unsubscribe-form.tsx`, `actions.ts`, `actions.test.ts`, `page.test.ts`
- Create: `apps/web/src/proxy.test.ts`

**Interfaces:**
- Consumes: `openConsentToken`, `consentTokenSecrets`, `ConsentTokenPayload` (Task 3); `appendConsentEventGuarded`, `readConsentState`, `serviceDb`, `getBranding`, `brandLogoUrl` (`@bis/db`); the `unsubscribe.*` copy (Task 4); `publicFormTheme`, `parseHostMode`, `PublicBrand` (the cancel page's).
- Produces:
  - `readUnsubscribeToken(token: unknown, env?): { ok: true; payload: ConsentTokenPayload } | { ok: false; why: "bad_token" | "not_configured" }`
  - `recordUnsubscribe(db, p: ConsentTokenPayload, via: "one_click" | "unsubscribe_link"): Promise<"stopped" | "already_stopped">` — `revoked`, guard `unless_customer_stopped` [Q5], `contact_id` null, no `source_ref` (G3, G4). THROWS on a write error.
  - `recordResubscribe(db, p): Promise<"resubscribed" | "was_allowed">` — `resubscribed` / `unsubscribe_page`, guard `if_stopped_or_held` (G5). THROWS on a write error.
  - `emailStateOf(db, p): Promise<"allowed" | "stopped">` (a hold, which nothing writes for email, reads as stopped). THROWS on a read error.
  - `type UnsubscribeState = "allowed" | "stopped" | "resubscribed" | "bad_link" | "failed"`; `pageLines(state, brandName: string | null): { en: string; es: string; detailEn: string | null; detailEs: string | null }`; `fillBusiness(template: string, brandName: string | null, lang: "en" | "es"): string` (from `unsubscribe-copy.ts`).
  - `unsubscribeAction(token: string): Promise<{ state: UnsubscribeState }>`, `resubscribeAction(token: string): Promise<{ state: UnsubscribeState }>` (server actions, `app/u/[token]/actions.ts`).

**What each surface does:**

| Request | Answer | Ledger |
|---|---|---|
| `POST /api/unsubscribe/<valid token>` (any body) | `200`, empty body, `Cache-Control: no-store`, no cookie, no redirect | `revoked` / `one_click`, unless the customer's own stop already stands |
| `POST` with a bad token | `400`, empty | nothing |
| `POST` with no secret configured, or a failed write | `503`, empty (a retry can succeed) | nothing |
| `GET /api/unsubscribe/<token>` | `303` to `/u/<token>` (G6) | nothing |
| `GET /u/<valid token>`, address allowed | the confirm view: the question in English and Spanish, one PRIMARY "Unsubscribe / Cancelar suscripción" [Q1] | nothing on GET [Q1] |
| its button | the unsubscribed view (spec §6 "Loaded") | `revoked` / `unsubscribe_link` |
| `GET /u/<valid token>`, address stopped | the unsubscribed view: spec §6's lines, one GHOST "Resubscribe / Volver a suscribirme", no primary | nothing |
| its Resubscribe | "You'll get emails from {Business} again." / Spanish, and the primary Unsubscribe again | `resubscribed` / `unsubscribe_page` |
| `GET /u/<bad token>` | spec §6's error lines | nothing |
| an unreadable ledger, a failed write, no secret | "Something went wrong on our side …" / Spanish | nothing |

**[Q1] If danlo keeps decision 6 literally (the GET records):** in `page.tsx`, when `emailStateOf` answers `allowed`, call `recordUnsubscribe(db, payload, "unsubscribe_link")` and render `initial = "stopped"`; delete the `allowed` branch's lines from `pageLines` (and Task 4's four `unsubscribe.confirm*` / `unsubscribe.button` keys); the e2e's first step (Task 14) expects the unsubscribed view straight away. Nothing else changes.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/consent/unsubscribe.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ appendConsentEventGuarded: vi.fn(), readConsentState: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { readUnsubscribeToken, recordUnsubscribe, recordResubscribe, emailStateOf } from "./unsubscribe";
import { sealConsentToken, type ConsentTokenPayload } from "./token";

const SECRET = "unsub-test-secret-0123456789abcdef-01";
const ENV = { CONSENT_TOKEN_SECRET: SECRET } as unknown as NodeJS.ProcessEnv;
const P: ConsentTokenPayload = {
  v: 1, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email", t: "ana@example.com",
  i: Date.parse("2026-10-01T15:00:00Z"), n: "0c9a8b7d-1e2f-4a3b-8c4d-5e6f7a8b9c0d", k: "automation.reminder",
};
const CLIENT = { tag: "service" } as never;

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "e1", prior: null });
});

describe("readUnsubscribeToken", () => {
  it("opens a good token, refuses a bad one, and says when no secret is configured — never guessing (mutation: treat no secret as a bad token → the endpoint answers 400 to a real unsubscribe during an outage, FAILS)", () => {
    expect(readUnsubscribeToken(sealConsentToken(P, SECRET), ENV)).toEqual({ ok: true, payload: P });
    expect(readUnsubscribeToken("1.x.y", ENV)).toEqual({ ok: false, why: "bad_token" });
    expect(readUnsubscribeToken(sealConsentToken(P, SECRET), {} as NodeJS.ProcessEnv)).toEqual({ ok: false, why: "not_configured" });
  });

  it("the previous secret still opens (a rotation never breaks a sent link; mutation: open with current only → FAILS)", () => {
    const env = { CONSENT_TOKEN_SECRET: "new-secret-0123456789abcdef-0123456", CONSENT_TOKEN_SECRET_PREVIOUS: SECRET } as unknown as NodeJS.ProcessEnv;
    expect(readUnsubscribeToken(sealConsentToken(P, SECRET), env)).toEqual({ ok: true, payload: P });
  });
});

describe("recordUnsubscribe", () => {
  it("appends the customer's own stop on the token's account and address, with NO contact_id and NO source_ref, and the token's facts as evidence (G3, S10; mutation: pass the token as source_ref → a second real unsubscribe after a resubscribe reads as a duplicate forever, FAILS)", async () => {
    expect(await recordUnsubscribe(CLIENT, P, "one_click")).toBe("stopped");
    expect(db.appendConsentEventGuarded).toHaveBeenCalledWith(CLIENT, {
      accountId: P.a, channel: "email", address: "ana@example.com", action: "revoked", method: "one_click",
      contactId: null, evidence: { issuedAt: "2026-10-01T15:00:00.000Z", kind: "automation.reminder", contactId: P.n },
    }, "unless_customer_stopped");
  });

  it("[Q5] guard unless_customer_stopped: refused over the customer's own stop (idempotent: 'already_stopped', no second row), recorded over a staff stop (mutation: guard 'if_allowed' → FAILS)", async () => {
    db.appendConsentEventGuarded.mockResolvedValueOnce({ outcome: "refused", prior: { id: "e0", action: "revoked", method: "unsubscribe_link", evidence: {} } });
    expect(await recordUnsubscribe(CLIENT, P, "unsubscribe_link")).toBe("already_stopped");
    expect(db.appendConsentEventGuarded.mock.calls[0]![2]).toBe("unless_customer_stopped");
  });

  it("THROWS on a write error, so the endpoint can answer 503 and the mail client retry (mutation: swallow it → 200 for a stop that was never recorded, FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValueOnce(new Error("append_consent_event failed: timeout"));
    await expect(recordUnsubscribe(CLIENT, P, "one_click")).rejects.toThrow(/timeout/);
  });
});

describe("recordResubscribe", () => {
  it("appends resubscribed / unsubscribe_page with guard if_stopped_or_held, and answers was_allowed when nothing was stopped (G5; choice 27; mutation: method 'staff' → 0055 would demand a note, FAILS here on the method)", async () => {
    expect(await recordResubscribe(CLIENT, P)).toBe("resubscribed");
    expect(db.appendConsentEventGuarded).toHaveBeenCalledWith(CLIENT, expect.objectContaining({
      accountId: P.a, channel: "email", address: "ana@example.com", action: "resubscribed", method: "unsubscribe_page", contactId: null,
    }), "if_stopped_or_held");
    db.appendConsentEventGuarded.mockResolvedValueOnce({ outcome: "refused", prior: null });
    expect(await recordResubscribe(CLIENT, P)).toBe("was_allowed");
  });
});

describe("emailStateOf", () => {
  it("reads the token's account and address; a hold reads as stopped (mutation: read the SMS channel → FAILS)", async () => {
    db.readConsentState.mockResolvedValueOnce({ state: "allowed" });
    expect(await emailStateOf(CLIENT, P)).toBe("allowed");
    expect(db.readConsentState).toHaveBeenCalledWith(CLIENT, P.a, "email", "ana@example.com");
    db.readConsentState.mockResolvedValueOnce({ state: "held", since: "x", method: "free_text", eventId: "h" });
    expect(await emailStateOf(CLIENT, P)).toBe("stopped");
  });
});
```

Create `apps/web/src/lib/consent/unsubscribe-copy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { pageLines, fillBusiness } from "./unsubscribe-copy";
import { m } from "@/lib/messages";

describe("fillBusiness", () => {
  it("puts the brand name in as it is written, and a blank brand becomes 'the business' / 'el negocio', capitalised where it starts a sentence (mutation: capitalise the brand too → 'rio roofing' becomes 'Rio roofing', FAILS)", () => {
    expect(fillBusiness("{Business} will stop.", "rio roofing", "en")).toBe("rio roofing will stop.");
    expect(fillBusiness("{Business} will stop.", null, "en")).toBe("The business will stop.");
    expect(fillBusiness("Stop emails from {Business}?", "  ", "en")).toBe("Stop emails from the business?");
    expect(fillBusiness("Listo. {Business} ya no le enviará.", null, "es")).toBe("Listo. El negocio ya no le enviará.");
    expect(fillBusiness("Volverá a recibir correos de {Business}.", null, "es")).toBe("Volverá a recibir correos del negocio.");
    expect(fillBusiness("Volverá a recibir correos de {Business}.", "El Taller", "es")).toBe("Volverá a recibir correos de El Taller.");
  });
});

describe("pageLines — spec §6, English and Spanish stacked", () => {
  it("stopped: the spec's unsubscribed lines, the business named (mutation: show the confirm question → FAILS)", () => {
    expect(pageLines("stopped", "Rio Roofing")).toEqual({
      en: m["unsubscribe.done.en"].replace("{Business}", "Rio Roofing"),
      es: m["unsubscribe.done.es"].replace("{Business}", "Rio Roofing"),
      detailEn: null, detailEs: null,
    });
  });

  it("allowed [Q1]: the question and what it means, in both languages", () => {
    const l = pageLines("allowed", "Rio Roofing");
    expect([l.en, l.es]).toEqual(["Stop emails from Rio Roofing?", "¿Dejar de recibir correos de Rio Roofing?"]);
    expect(l.detailEn).toMatch(/^Rio Roofing will stop sending you automated emails\./);
    expect(l.detailEs).toMatch(/^Rio Roofing dejará de enviarle correos automáticos\./);
  });

  it("resubscribed, bad_link and failed say the spec's (or this plan's) words (mutation: bad_link shows 'failed' → FAILS)", () => {
    expect(pageLines("resubscribed", "Rio Roofing").en).toBe("You'll get emails from Rio Roofing again.");
    expect(pageLines("bad_link", null)).toMatchObject({ en: m["unsubscribe.badLink.en"], es: m["unsubscribe.badLink.es"] });
    expect(pageLines("failed", null)).toMatchObject({ en: m["unsubscribe.failed.en"], es: m["unsubscribe.failed.es"] });
  });
});
```
(The Spanish contraction: "de el negocio" is ungrammatical, so `fillBusiness` contracts " de el " to " del " — for the fallback only; a brand name, "El Taller" above, is never rewritten.)

Create `apps/web/src/app/api/unsubscribe/[token]/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const unsub = vi.hoisted(() => ({ recordUnsubscribe: vi.fn() }));
vi.mock("@/lib/consent/unsubscribe", async (importOriginal) => ({ ...(await importOriginal<object>()), ...unsub }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({ tag: "service" }) }));

import { POST, GET } from "./route";
import { sealConsentToken } from "@/lib/consent/token";

const SECRET = "route-test-secret-0123456789abcdef-012";
const P = { v: 1 as const, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email" as const, t: "ana@example.com", i: 1_790_000_000_000, n: null };
const post = (token: string, body = "List-Unsubscribe=One-Click") => POST(
  new Request(`https://app.example.com/api/unsubscribe/${token}`, {
    method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" },
  }), { params: Promise.resolve({ token }) });

beforeEach(() => {
  unsub.recordUnsubscribe.mockReset().mockResolvedValue("stopped");
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/unsubscribe/[token] — RFC 8058 one-click", () => {
  it("a valid token: 200, an empty body, no-store, no cookie, no redirect, and the stop recorded as one_click (X1, X2; mutation: answer 204 or a body → FAILS; mutation: record 'unsubscribe_link' → FAILS)", async () => {
    const res = await post(sealConsentToken(P, SECRET));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
    expect(unsub.recordUnsubscribe).toHaveBeenCalledWith({ tag: "service" }, expect.objectContaining({ a: P.a, t: P.t }), "one_click");
  });

  it("an already-stopped address is still 200 (idempotent, no second row: the guard's answer; mutation: 409 → a mail client shows an error, FAILS)", async () => {
    unsub.recordUnsubscribe.mockResolvedValueOnce("already_stopped");
    expect((await post(sealConsentToken(P, SECRET))).status).toBe(200);
  });

  it("any body, even an empty one, is accepted: the token is the proof (X2 says the receiver SENDS the pair; nothing requires the server to demand it; mutation: require the body → a client that posts none cannot unsubscribe, FAILS)", async () => {
    expect((await post(sealConsentToken(P, SECRET), "")).status).toBe(200);
  });

  it("a bad token: 400, empty, nothing recorded (mutation: 200 → FAILS)", async () => {
    const res = await post("1.forged.token");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("");
    expect(unsub.recordUnsubscribe).not.toHaveBeenCalled();
  });

  it("no secret configured, or the write failed: 503, so the mail client can retry; logged without the token (fails closed; mutation: 200 on a failed write → a stop never recorded, FAILS)", async () => {
    const token = sealConsentToken(P, SECRET);
    unsub.recordUnsubscribe.mockRejectedValueOnce(new Error("append_consent_event failed: timeout"));
    expect((await post(token)).status).toBe(503);
    vi.stubEnv("CONSENT_TOKEN_SECRET", "");
    expect((await post(token)).status).toBe(503);
    expect(vi.mocked(console.error).mock.calls.flat().join(" ")).not.toContain(token);
  });
});

describe("GET /api/unsubscribe/[token]", () => {
  it("redirects 303 to the page, so a client that opens the header link lands where a person can act (G6; mutation: record on GET → FAILS)", async () => {
    const token = sealConsentToken(P, SECRET);
    const res = await GET(new Request(`https://app.example.com/api/unsubscribe/${token}`), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://app.example.com/u/${token}`);
    expect(unsub.recordUnsubscribe).not.toHaveBeenCalled();
  });
});
```

Create `apps/web/src/app/u/[token]/actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const unsub = vi.hoisted(() => ({ recordUnsubscribe: vi.fn(), recordResubscribe: vi.fn() }));
vi.mock("@/lib/consent/unsubscribe", async (importOriginal) => ({ ...(await importOriginal<object>()), ...unsub }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), serviceDb: () => ({ tag: "service" }) }));

import { unsubscribeAction, resubscribeAction } from "./actions";
import { sealConsentToken } from "@/lib/consent/token";

const SECRET = "page-test-secret-0123456789abcdef-0123";
const P = { v: 1 as const, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email" as const, t: "ana@example.com", i: 1_790_000_000_000, n: null };

beforeEach(() => {
  unsub.recordUnsubscribe.mockReset().mockResolvedValue("stopped");
  unsub.recordResubscribe.mockReset().mockResolvedValue("resubscribed");
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("the page's two server actions", () => {
  it("Unsubscribe records the stop as unsubscribe_link and answers stopped; Resubscribe records the lift and answers resubscribed (spec §4.3; mutation: record one_click from the page → the drawer cannot tell the header from the link, FAILS)", async () => {
    const token = sealConsentToken(P, SECRET);
    expect(await unsubscribeAction(token)).toEqual({ state: "stopped" });
    expect(unsub.recordUnsubscribe).toHaveBeenCalledWith({ tag: "service" }, expect.objectContaining({ a: P.a }), "unsubscribe_link");
    expect(await resubscribeAction(token)).toEqual({ state: "resubscribed" });
    expect(unsub.recordResubscribe).toHaveBeenCalledWith({ tag: "service" }, expect.objectContaining({ a: P.a }));
  });

  it("each re-opens the token itself — a forged one writes nothing and answers bad_link; a failed write answers failed (never trusts the page's state; mutation: skip the re-open → FAILS)", async () => {
    expect(await unsubscribeAction("1.forged.token")).toEqual({ state: "bad_link" });
    expect(await resubscribeAction("1.forged.token")).toEqual({ state: "bad_link" });
    expect(unsub.recordUnsubscribe).not.toHaveBeenCalled();
    unsub.recordUnsubscribe.mockRejectedValueOnce(new Error("down"));
    expect(await unsubscribeAction(sealConsentToken(P, SECRET))).toEqual({ state: "failed" });
  });
});
```

Create `apps/web/src/app/u/[token]/page.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

const dbm = vi.hoisted(() => ({ getBranding: vi.fn(), readConsentState: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbm, serviceDb: () => ({ tag: "service" }) }));
const unsub = vi.hoisted(() => ({ recordUnsubscribe: vi.fn() }));
vi.mock("@/lib/consent/unsubscribe", async (importOriginal) => ({ ...(await importOriginal<object>()), ...unsub }));
vi.mock("./actions", () => ({ unsubscribeAction: vi.fn(), resubscribeAction: vi.fn() }));

import UnsubscribePage, { metadata } from "./page";
import { sealConsentToken } from "@/lib/consent/token";
import { publicFormTheme } from "@/lib/branding/public-form-theme";

const SECRET = "page-test-secret-0123456789abcdef-0123";
const P = { v: 1 as const, a: "5b1f6a5e-6a3d-4f7e-9f65-2a0b1c3d4e5f", c: "email" as const, t: "ana@example.com", i: 1_790_000_000_000, n: null };
const BRANDING = { brandName: "Rio Roofing", brandLogoPath: null, brandColor: "#0e7490", brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null };
const render = async (token: string) => renderToStaticMarkup(await UnsubscribePage({ params: Promise.resolve({ token }) }));

beforeEach(() => {
  dbm.getBranding.mockReset().mockResolvedValue(BRANDING);
  dbm.readConsentState.mockReset().mockResolvedValue({ state: "allowed" });
  unsub.recordUnsubscribe.mockReset();
  vi.stubEnv("CONSENT_TOKEN_SECRET", SECRET);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("/u/[token]", () => {
  it("[Q1] an allowed address: the question in English AND Spanish, the client's name, ONE primary button — and NOTHING recorded on the GET (a mail scanner's fetch changes nothing; mutation: record on render → FAILS)", async () => {
    const html = await render(sealConsentToken(P, SECRET));
    expect(html).toContain("Stop emails from Rio Roofing?");
    expect(html).toContain("¿Dejar de recibir correos de Rio Roofing?");
    expect(html.match(/class="bis-unsub-primary"/g)).toHaveLength(1);
    expect(html).not.toContain("bis-unsub-ghost");
    expect(unsub.recordUnsubscribe).not.toHaveBeenCalled();
  });

  it("a stopped address: spec §6's unsubscribed lines and ONE ghost Resubscribe, no primary (rule 8; mutation: render the primary too → FAILS)", async () => {
    dbm.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-01T00:00:00Z", method: "one_click", eventId: "e1" });
    const html = await render(sealConsentToken(P, SECRET));
    expect(renderedText(html)).toContain("You're unsubscribed. Rio Roofing won't send you any more automated emails.");
    expect(html).toContain("Listo. Rio Roofing ya no le enviará correos automáticos.");
    expect(html).toContain("Resubscribe / Volver a suscribirme");
    expect(html).not.toContain("bis-unsub-primary");
  });

  it("carries the client's brand (rule 9): its name in the header and ITS colour on the page's tokens, not the platform's fallback (mutation: render with the unbranded theme → FAILS)", async () => {
    const html = await render(sealConsentToken(P, SECRET));
    expect(html).toContain("Rio Roofing");
    const accentOf = (b: typeof BRANDING) => (publicFormTheme(b, false).style as Record<string, string>)["--form-accent"];
    const unbranded = { ...BRANDING, brandName: null, brandColor: null };
    expect(accentOf(BRANDING)).not.toBe(accentOf(unbranded));
    expect(html).toContain(`--form-accent:${accentOf(BRANDING)}`);
  });

  it("a bad token shows spec §6's error lines in both languages, and reads nothing (mutation: 500 → FAILS)", async () => {
    const html = await render("1.forged.token");
    expect(renderedText(html)).toContain("This unsubscribe link doesn't work.");
    expect(html).toContain("Este enlace no funciona.");
    expect(dbm.readConsentState).not.toHaveBeenCalled();
  });

  it("an unreadable ledger shows the 'went wrong' lines, never a guessed state (fails closed; mutation: default to allowed → FAILS)", async () => {
    dbm.readConsentState.mockRejectedValue(new Error("down"));
    const html = await render(sealConsentToken(P, SECRET));
    expect(html).toContain("Something went wrong on our side.");
    expect(html).not.toContain("bis-unsub-primary");
  });

  it("is kept out of search engines and sends no Referer to the logo's host (mutation: drop referrer → FAILS)", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});
```
(The apostrophes are read through `renderedText` — `lib/rendered-text.ts`, which decodes React's `&#x27;` — so a negative assertion can never pass vacuously.)

Create `apps/web/src/proxy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("proxy.ts — the unsubscribe surfaces stay public (spec §4.3, E2)", () => {
  it("only /dashboard is protected, so /u/… and /api/unsubscribe/… need no sign-in (mutation: protect \"/u(.*)\" or \"/api(.*)\" → an unsubscribe demands a login, FAILS)", () => {
    const src = readFileSync(fileURLToPath(new URL("./proxy.ts", import.meta.url)), "utf8");
    expect(src.match(/createRouteMatcher\((\[[^\]]*\])\)/)?.[1]).toBe('["/dashboard(.*)"]');
  });
});
```

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/unsubscribe.test.ts src/lib/consent/unsubscribe-copy.test.ts "src/app/api/unsubscribe" "src/app/u" src/proxy.test.ts
```
Expected (predicted): every file but `proxy.test.ts` fails to import its subject; `proxy.test.ts` passes already (it pins today's truth).

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/consent/unsubscribe.ts`:
```ts
import { appendConsentEventGuarded, readConsentState, type SupabaseClient } from "@bis/db";
import { openConsentToken, consentTokenSecrets, type ConsentTokenPayload } from "./token";

/**
 * The customer's own email stop and resubscribe (consent chain spec §4.3,
 * "Endpoints"), shared by the one-click endpoint and the /u page's actions.
 * Server only. Never logs a token or an address.
 *
 * Neither write carries a source_ref (spec §3, PR-2 S10: a token is a
 * reusable channel, never ONE event) — the guards make them idempotent:
 * an unsubscribe is refused over the customer's own stop (no second row) and
 * recorded over a staff one, so only the customer can lift it from then on
 * ([Q5], PR-2's S8 for texts); a resubscribe is refused when nothing is
 * stopped. Both write contact_id null, the token's contact in evidence (G3):
 * the contact may have been deleted since the email went out, and 0054's
 * composite key would refuse the row.
 */
export type TokenRead =
  | { ok: true; payload: ConsentTokenPayload }
  | { ok: false; why: "bad_token" | "not_configured" };

export function readUnsubscribeToken(token: unknown, env: NodeJS.ProcessEnv = process.env): TokenRead {
  const secrets = consentTokenSecrets(env);
  if (!secrets.current && !secrets.previous) return { ok: false, why: "not_configured" };
  const payload = openConsentToken(token, [secrets.current, secrets.previous]);
  return payload ? { ok: true, payload } : { ok: false, why: "bad_token" };
}

function evidenceOf(p: ConsentTokenPayload): Record<string, unknown> {
  return {
    issuedAt: new Date(p.i).toISOString(),
    ...(p.k ? { kind: p.k } : {}),
    ...(p.n ? { contactId: p.n } : {}),
  };
}

export async function recordUnsubscribe(
  db: SupabaseClient, p: ConsentTokenPayload, via: "one_click" | "unsubscribe_link",
): Promise<"stopped" | "already_stopped"> {
  const r = await appendConsentEventGuarded(db, {
    accountId: p.a, channel: "email", address: p.t, action: "revoked", method: via,
    contactId: null, evidence: evidenceOf(p),
  }, "unless_customer_stopped");
  return r.outcome === "appended" ? "stopped" : "already_stopped";
}

export async function recordResubscribe(db: SupabaseClient, p: ConsentTokenPayload): Promise<"resubscribed" | "was_allowed"> {
  const r = await appendConsentEventGuarded(db, {
    accountId: p.a, channel: "email", address: p.t, action: "resubscribed", method: "unsubscribe_page",
    contactId: null, evidence: evidenceOf(p),
  }, "if_stopped_or_held");
  return r.outcome === "appended" ? "resubscribed" : "was_allowed";
}

export async function emailStateOf(db: SupabaseClient, p: ConsentTokenPayload): Promise<"allowed" | "stopped"> {
  const s = await readConsentState(db, p.a, "email", p.t);
  return s.state === "allowed" ? "allowed" : "stopped";
}
```

Create `apps/web/src/lib/consent/unsubscribe-copy.ts`:
```ts
import { m } from "@/lib/messages";

/**
 * The /u page's words (spec §6), client-safe. English and Spanish are always
 * shown together: the token carries no language. {Business} is the brand
 * name exactly as the business wrote it; a blank one becomes "the business" /
 * "el negocio", capitalised where it starts a sentence, and "de el" contracts
 * to "del" (the fallback only — a brand name is never rewritten).
 */
export type UnsubscribeState = "allowed" | "stopped" | "resubscribed" | "bad_link" | "failed";

export function fillBusiness(template: string, brandName: string | null, lang: "en" | "es"): string {
  const brand = brandName?.trim();
  if (brand) return template.split("{Business}").join(brand);
  const fallback = m[`unsubscribe.business.${lang}`];
  const capital = fallback.charAt(0).toUpperCase() + fallback.slice(1);
  let out = "";
  const parts = template.split("{Business}");
  parts.forEach((part, i) => {
    out += part;
    if (i === parts.length - 1) return;
    const startsSentence = out.trim() === "" || /[.?!]\s*$/.test(out);
    out += startsSentence ? capital : fallback;
  });
  return lang === "es" ? out.split(" de el ").join(" del ") : out;
}

export function pageLines(state: UnsubscribeState, brandName: string | null): {
  en: string; es: string; detailEn: string | null; detailEs: string | null;
} {
  const both = (key: "confirm" | "done" | "resubscribed" | "badLink" | "failed") => ({
    en: fillBusiness(m[`unsubscribe.${key}.en`], brandName, "en"),
    es: fillBusiness(m[`unsubscribe.${key}.es`], brandName, "es"),
  });
  switch (state) {
    case "allowed":
      return {
        ...both("confirm"),
        detailEn: fillBusiness(m["unsubscribe.confirmBody.en"], brandName, "en"),
        detailEs: fillBusiness(m["unsubscribe.confirmBody.es"], brandName, "es"),
      };
    case "stopped": return { ...both("done"), detailEn: null, detailEs: null };
    case "resubscribed": return { ...both("resubscribed"), detailEn: null, detailEs: null };
    case "bad_link": return { ...both("badLink"), detailEn: null, detailEs: null };
    case "failed": return { ...both("failed"), detailEn: null, detailEs: null };
  }
}
```

Create `apps/web/src/app/api/unsubscribe/[token]/route.ts`:
```ts
import { serviceDb } from "@bis/db";
import { readUnsubscribeToken, recordUnsubscribe } from "@/lib/consent/unsubscribe";
import { loggableError } from "@/lib/loggable-error";

/**
 * The RFC 8058 one-click target (spec §4.3; plan X1, X2): the URL in every
 * customer email's List-Unsubscribe header. A mail client POSTs
 * "List-Unsubscribe=One-Click" here with no cookies; the token is the proof.
 * 200 with an empty body, never a redirect (X2: redirected POSTs turn into
 * GETs). 400 for a token that does not open; 503 when it could not be
 * recorded (no secret, or the ledger write failed), so the client may retry.
 * Public: proxy.ts protects only /dashboard (proxy.test.ts). Never logs the
 * token.
 */
export const dynamic = "force-dynamic";

const EMPTY = { "Cache-Control": "no-store" };

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const read = readUnsubscribeToken(token);
  if (!read.ok) {
    if (read.why === "not_configured") {
      console.error("one-click unsubscribe refused: CONSENT_TOKEN_SECRET is not set");
      return new Response(null, { status: 503, headers: EMPTY });
    }
    return new Response(null, { status: 400, headers: EMPTY });
  }
  try {
    await recordUnsubscribe(serviceDb(), read.payload, "one_click");
  } catch (e) {
    console.error(`one-click unsubscribe for account ${read.payload.a} not recorded: ${loggableError(e)}`);
    return new Response(null, { status: 503, headers: EMPTY });
  }
  return new Response(null, { status: 200, headers: EMPTY });
}

/** A client that opens the header URL instead of POSTing lands on the page (G6). */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  return new Response(null, { status: 303, headers: { Location: new URL(`/u/${token}`, req.url).toString(), ...EMPTY } });
}
```

Create `apps/web/src/app/u/[token]/actions.ts`:
```ts
"use server";

import { serviceDb } from "@bis/db";
import { readUnsubscribeToken, recordUnsubscribe, recordResubscribe } from "@/lib/consent/unsubscribe";
import type { UnsubscribeState } from "@/lib/consent/unsubscribe-copy";
import { loggableError } from "@/lib/loggable-error";

/**
 * The /u page's two buttons (spec §4.3; choice 27; [Q1]). Each RE-OPENS the
 * token (the page's state is never trusted), writes through the one ledger
 * path, and answers the state to show. Server actions are POST-only and
 * refuse a foreign Origin (plan X5), so a page elsewhere cannot press them.
 */
export async function unsubscribeAction(token: string): Promise<{ state: UnsubscribeState }> {
  const read = readUnsubscribeToken(token);
  if (!read.ok) return { state: read.why === "bad_token" ? "bad_link" : "failed" };
  try {
    await recordUnsubscribe(serviceDb(), read.payload, "unsubscribe_link");
    return { state: "stopped" };
  } catch (e) {
    console.error(`unsubscribe page: account ${read.payload.a}, stop not recorded: ${loggableError(e)}`);
    return { state: "failed" };
  }
}

export async function resubscribeAction(token: string): Promise<{ state: UnsubscribeState }> {
  const read = readUnsubscribeToken(token);
  if (!read.ok) return { state: read.why === "bad_token" ? "bad_link" : "failed" };
  try {
    await recordResubscribe(serviceDb(), read.payload);
    return { state: "resubscribed" };
  } catch (e) {
    console.error(`unsubscribe page: account ${read.payload.a}, resubscribe not recorded: ${loggableError(e)}`);
    return { state: "failed" };
  }
}
```

Create `apps/web/src/app/u/[token]/unsubscribe-form.tsx`:
```tsx
"use client";

import { useState, useTransition } from "react";
import { m } from "@/lib/messages";
import { pageLines, type UnsubscribeState } from "@/lib/consent/unsubscribe-copy";
import { unsubscribeAction, resubscribeAction } from "./actions";

/**
 * The page's one decision (spec §6; DESIGN.md rule 8, one primary per view):
 * allowed → one PRIMARY Unsubscribe [Q1]; stopped → one GHOST Resubscribe
 * (choice 27), no primary; after Resubscribe → the primary again. English and
 * Spanish stacked. The answer is announced (aria-live) and the button that
 * replaces the pressed one keeps the keyboard in the section.
 */
export function UnsubscribeForm({ token, initial, brandName }: {
  token: string; initial: UnsubscribeState; brandName: string | null;
}) {
  const [state, setState] = useState<UnsubscribeState>(initial);
  const [pending, startTransition] = useTransition();
  const run = (act: (t: string) => Promise<{ state: UnsubscribeState }>) => startTransition(async () => {
    try {
      setState((await act(token)).state);
    } catch {
      setState("failed");
    }
  });
  const lines = pageLines(state, brandName);
  return (
    <section aria-live="polite" data-testid="unsubscribe" data-state={state}>
      <div className="bis-unsub-lang" lang="en">
        <p className="bis-unsub-title">{lines.en}</p>
        {lines.detailEn ? <p className="bis-unsub-detail">{lines.detailEn}</p> : null}
      </div>
      <div className="bis-unsub-lang" lang="es">
        <p className="bis-unsub-title">{lines.es}</p>
        {lines.detailEs ? <p className="bis-unsub-detail">{lines.detailEs}</p> : null}
      </div>
      {state === "allowed" || state === "resubscribed" ? (
        <p className="bis-unsub-actions">
          <button type="button" className="bis-unsub-primary" disabled={pending} onClick={() => run(unsubscribeAction)}>
            {m["unsubscribe.button"]}
          </button>
        </p>
      ) : null}
      {state === "stopped" ? (
        <p className="bis-unsub-actions">
          <button type="button" className="bis-unsub-ghost" disabled={pending} onClick={() => run(resubscribeAction)}>
            {m["unsubscribe.resubscribe"]}
          </button>
        </p>
      ) : null}
    </section>
  );
}
```

Create `apps/web/src/app/u/[token]/page.tsx`:
```tsx
import type { Metadata } from "next";
import { serviceDb, getBranding, brandLogoUrl, type Branding } from "@bis/db";
import { publicFormTheme, parseHostMode } from "@/lib/branding/public-form-theme";
import { PublicBrand } from "@/components/public-brand";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { readUnsubscribeToken, emailStateOf } from "@/lib/consent/unsubscribe";
import type { UnsubscribeState } from "@/lib/consent/unsubscribe-copy";
import { UnsubscribeForm } from "./unsubscribe-form";
import "@/styles/public-brand.css";

export const dynamic = "force-dynamic";

/** Never indexed, and no Referer carries the token to the logo's host. */
export const metadata: Metadata = {
  title: m["unsubscribe.pageTitle"],
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const UNBRANDED: Branding = {
  brandName: null, brandLogoPath: null, brandColor: null,
  brandNeutral: null, brandCorners: null, brandType: null, brandMode: null,
  replyToEmail: null,
};

/**
 * `/u/<token>` — the link in every customer email's footer (spec §4.3, §6).
 * A GET only READS [Q1]: a mail scanner that fetches the link records
 * nothing (plan R4, A5); the customer's own click records the stop
 * (unsubscribeAction). Branded with the client's logo and colour (DESIGN.md
 * rule 9), server-rendered, so there is no loading state. Never logs the token.
 */
export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const read = readUnsubscribeToken(token);
  let branding: Branding | null = null;
  let initial: UnsubscribeState;
  if (!read.ok) {
    initial = read.why === "bad_token" ? "bad_link" : "failed";
  } else {
    const db = serviceDb();
    try {
      branding = await getBranding(db, read.payload.a);
    } catch (e) {
      // Decorative: a branding blip never costs a customer the way out.
      console.error(`unsubscribe page: branding unreadable for account ${read.payload.a}: ${loggableError(e)}`);
    }
    try {
      initial = await emailStateOf(db, read.payload);
    } catch (e) {
      console.error(`unsubscribe page: consent state unreadable for account ${read.payload.a}: ${loggableError(e)}`);
      initial = "failed";
    }
  }
  const { style, darkCss, themed } = publicFormTheme(branding ?? UNBRANDED, false, parseHostMode(undefined));
  return (
    <main className="bis-unsub-page" style={style} {...(themed ? { "data-tenant-theme": "" } : {})}>
      {darkCss ? <style>{darkCss}</style> : null}
      <style>{UNSUB_CSS}</style>
      <PublicBrand
        name={branding?.brandName ?? null}
        logoUrl={branding?.brandLogoPath ? brandLogoUrl(branding.brandLogoPath) : null}
      />
      <div className="bis-unsub">
        <UnsubscribeForm token={token} initial={initial} brandName={branding?.brandName ?? null} />
        <p className="bis-unsub-poweredby">
          <a href="https://bis-rgv.com" target="_blank" rel="noopener noreferrer">{m["unsubscribe.poweredBy"]}</a>
        </p>
      </div>
    </main>
  );
}

// The cancel page's convention (its CANCEL_CSS): `var(--token, fallback)`, so
// an unthemed account renders exactly these fallbacks and a themed one the
// tokens publicFormTheme put on <main>. No backticks inside this literal.
const UNSUB_CSS = `
.bis-unsub-page { background: var(--background, transparent); min-height: 100vh; --public-measure: 480px; }
.bis-unsub {
  font: 400 15px/1.5 var(--font-sans, system-ui, -apple-system, "Segoe UI", sans-serif);
  color: var(--foreground, #18181b);
  padding: 16px; max-width: 480px; margin: 0 auto;
}
.bis-unsub-lang + .bis-unsub-lang { margin-top: 16px; }
.bis-unsub-title { font-size: 17px; font-weight: 600; margin: 0 0 4px; }
.bis-unsub-detail { color: var(--muted-foreground, #71717a); margin: 0; }
.bis-unsub-actions { margin: 20px 0 0; }
.bis-unsub-primary, .bis-unsub-ghost {
  font: inherit; font-weight: 600; border-radius: var(--radius, 0.5rem); padding: 10px 18px; cursor: pointer;
}
.bis-unsub-primary { border: none; background: var(--form-accent, #6d28d9); color: var(--form-accent-foreground, #ffffff); }
.bis-unsub-ghost { border: 1px solid var(--border, #e4e4e7); background: transparent; color: var(--foreground, #18181b); }
.bis-unsub-primary:disabled, .bis-unsub-ghost:disabled { opacity: 0.6; cursor: not-allowed; }
.bis-unsub-primary:focus-visible, .bis-unsub-ghost:focus-visible { outline: 2px solid var(--form-accent, #6d28d9); outline-offset: 2px; }
.bis-unsub-poweredby { margin: 24px 0 0; font-size: 12px; text-align: center; }
.bis-unsub-poweredby a { color: var(--muted-foreground, #71717a); text-decoration: none; }
.bis-unsub-poweredby a:hover { text-decoration: underline; }
`;
```

- [ ] **Step 4: Run to see them pass**

The same command as Step 2. Expected (predicted): all pass.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `readUnsubscribeToken`: no secret → `bad_token` | "opens a good token, refuses a bad one, and says when no secret is configured" |
| 2 | `recordUnsubscribe`: `sourceRef: token` (add a token param) or `contactId: p.n` | "appends the customer's own stop … with NO contact_id and NO source_ref" |
| 3 | `recordUnsubscribe`: guard `"if_allowed"` | "[Q5] guard unless_customer_stopped" |
| 4 | `recordResubscribe`: method `"staff"` | "appends resubscribed / unsubscribe_page …" |
| 5 | route POST: `status: 204` | "a valid token: 200, an empty body …" |
| 6 | route POST: `recordUnsubscribe(…, "unsubscribe_link")` | the same case |
| 7 | route POST: answer 200 in the catch | "no secret configured, or the write failed: 503" |
| 8 | route GET: call `recordUnsubscribe` then redirect | "redirects 303 to the page …" |
| 9 | page: `recordUnsubscribe` when `initial === "allowed"` (the [Q1] alternative) | "[Q1] an allowed address … NOTHING recorded on the GET" |
| 10 | unsubscribe-form: render the primary in the `stopped` state too | "a stopped address … ONE ghost Resubscribe, no primary" |
| 11 | page: `initial = "allowed"` in the state read's catch | "an unreadable ledger shows the 'went wrong' lines" |
| 12 | `fillBusiness`: capitalise the brand name too | "puts the brand name in as it is written …" |
| 13 | page metadata: drop `referrer` | "is kept out of search engines and sends no Referer" |
| 14 | proxy.ts: `createRouteMatcher(["/dashboard(.*)", "/u(.*)"])` | proxy.test (then revert) |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/unsubscribe.ts apps/web/src/lib/consent/unsubscribe.test.ts apps/web/src/lib/consent/unsubscribe-copy.ts apps/web/src/lib/consent/unsubscribe-copy.test.ts "apps/web/src/app/api/unsubscribe" "apps/web/src/app/u" apps/web/src/proxy.test.ts
git commit -m "feat(consent): the RFC 8058 one-click endpoint and the branded, bilingual /u/[token] page"
```

---

### Task 10: The Email row's data: the view, the staff actions and the drawer's read

**Owner:** bis-crm. **Tier:** HIGH. **Questions:** none.

**Files:**
- Create: `apps/web/src/lib/consent/email-view.ts`, `email-view.test.ts`
- Create: `apps/web/src/lib/consent/email-staff-actions.ts`, `email-staff-actions.test.ts`
- Create: `apps/web/src/lib/consent/email-context.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/email-actions.ts`
- Create: `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/email/route.ts`, `route.test.ts`

**Interfaces:**
- Consumes: `consentStateOf`, `newestDecidingRow`, `readConsentHistory`, `readConsentEvent`, `appendConsentEventGuarded`, `ConsentHistoryRow`, `ConsentMethod` (`@bis/db`); `emailLedgerAddress` (`@bis/db/email-address`, Task 1); `UNDO_WINDOW_MS` (PR-2's `staff-actions.ts`); `actorName` (PR-2's `actor.ts`); the `contact.email.*` copy (Task 4).
- Produces:
  - `type EmailHow = { kind: "unsubscribe_link" } | { kind: "staff" } | { kind: "backfill_0049" }`
  - `type EmailView = { kind: "no_email" } | { kind: "allowed"; newestId: string | null } | { kind: "stopped"; eventId: string; since: string; how: EmailHow; canResume: boolean }`
  - `EMAIL_RESUMABLE_METHODS: readonly ConsentMethod[] = ["staff", "backfill_0049"]` (choice 19)
  - `emailHowOf(method: ConsentMethod): EmailHow`, `emailViewOf(rows: readonly ConsentHistoryRow[], hasAddress: boolean): EmailView`, `readEmailView(db, accountId, contact: { email: string | null }): Promise<EmailView>` (THROWS on an unreadable ledger)
  - `type EmailContext = { db; writer; accountId; contactId; userId; actorName: string | null; address: string; now: Date }`; `type EmailUndo = { kind: "stop"; eventId: string }`; `type EmailActionResult = { ok: true; view: EmailView; undo?: EmailUndo } | { ok: false; error: string; view?: EmailView }`
  - `stopEmails(ctx, expectNewest: string | null)`, `undoStopEmails(ctx, eventId)`, `resumeEmails(ctx, expectEventId, note)` → `Promise<EmailActionResult>`
  - `emailContextFor(accountId, contactId, userId): Promise<EmailContext | { ok: false; reason: "no_email" | "failed"; error: string }>`
  - Server actions `stopEmailsAction(accountId, contactId, expectNewest)`, `undoStopEmailsAction(accountId, contactId, eventId)`, `resumeEmailsAction(accountId, contactId, expectEventId, note)`
  - `GET /api/accounts/[accountId]/contacts/[contactId]/email` → `type EmailResponse = { view: EmailView; zone: string }` (500 on an unreadable ledger; 404 without access or for another account's contact)

**The rules** (spec §4.2 "Staff controls" for email, §6, choice 19, G14; 0055 already enforces the staff rules for any channel):
- **Stop emails** appends `revoked` / `staff`, at once, with an Undo — only over an allowed address; 0055 refuses it over any stop (`revoked` / `staff` only while allowed).
- **Undo** appends `resubscribed` / `staff_undo` — only that staff member's own stop, within `UNDO_WINDOW_MS`, while it is still the newest row (PR-2's G20).
- **Resume emails…** appends `resubscribed` / `staff` with the required note — only when the newest stop's method is `staff` or `backfill_0049` (choice 19; 0055 refuses the rest). A customer's own stop (`unsubscribe_link`, `one_click`) shows "They can resubscribe from the unsubscribe link in any email from you." and no Resume.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/consent/email-view.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import type { ConsentHistoryRow } from "@bis/db";
import { emailViewOf, emailHowOf, EMAIL_RESUMABLE_METHODS } from "./email-view";

let n = 0;
const row = (action: string, method: string, at: string): ConsentHistoryRow =>
  ({ id: `ev_${++n}`, action, method, occurred_at: at, evidence: {}, note: null, actor_id: null }) as ConsentHistoryRow;

describe("emailViewOf — the Email row, as data (spec §6)", () => {
  it("no address is no_email; no rows is allowed with no newest id (mutation: treat no address as allowed → a Stop on nothing, FAILS)", () => {
    expect(emailViewOf([], false)).toEqual({ kind: "no_email" });
    expect(emailViewOf([], true)).toEqual({ kind: "allowed", newestId: null });
  });

  it("a customer's own stop (link, one-click) is stopped, 'unsubscribe link', and NOT resumable (choice 19; mutation: allow Resume over one_click → FAILS)", () => {
    for (const method of ["unsubscribe_link", "one_click"]) {
      const r = row("revoked", method, "2026-10-01T10:00:00Z");
      expect(emailViewOf([r], true)).toEqual({ kind: "stopped", eventId: r.id, since: r.occurred_at, how: { kind: "unsubscribe_link" }, canResume: false });
    }
  });

  it("a staff stop and a folded 0049 stop are stopped and resumable, each with its own how (G14; mutation: read backfill_0049 as 'staff' → the drawer says 'you recorded it' for the fold, FAILS)", () => {
    const s = row("revoked", "staff", "2026-10-01T10:00:00Z");
    expect(emailViewOf([s], true)).toMatchObject({ how: { kind: "staff" }, canResume: true });
    const f = row("revoked", "backfill_0049", "2026-09-01T10:00:00Z");
    expect(emailViewOf([f], true)).toMatchObject({ how: { kind: "backfill_0049" }, canResume: true });
  });

  it("a resubscribe after a stop is allowed again, carrying the newest id for the next Stop's compare-and-set (mutation: newestId null → a stale Stop is never refused, FAILS)", () => {
    const stop = row("revoked", "unsubscribe_link", "2026-10-01T10:00:00Z");
    const back = row("resubscribed", "unsubscribe_page", "2026-10-02T10:00:00Z");
    expect(emailViewOf([stop, back], true)).toEqual({ kind: "allowed", newestId: back.id });
  });

  it("the resumable list is exactly staff and backfill_0049 (mutation: add one_click → FAILS)", () => {
    expect([...EMAIL_RESUMABLE_METHODS].sort()).toEqual(["backfill_0049", "staff"]);
    expect(emailHowOf("unsubscribe_page")).toEqual({ kind: "unsubscribe_link" });
  });
});
```

Create `apps/web/src/lib/consent/email-staff-actions.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ appendConsentEventGuarded: vi.fn(), readConsentHistory: vi.fn(), readConsentEvent: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { stopEmails, undoStopEmails, resumeEmails, type EmailContext } from "./email-staff-actions";
import { m } from "@/lib/messages";

const READER = { reader: true } as never;
const WRITER = { writer: true } as never;
const NOW = new Date("2026-10-06T20:00:00Z");
const FRESH = "2026-10-06T19:59:30Z";
const ctx: EmailContext = {
  db: READER, writer: WRITER, accountId: "a1", contactId: "c1", userId: "user_1", actorName: "Ana",
  address: "ana@example.com", now: NOW,
};
let n = 0;
const row = (action: string, method: string, at = `2026-10-0${++n}T10:00:00Z`) =>
  ({ id: `ev_${n}`, action, method, occurred_at: at, evidence: {}, note: null, actor_id: null });
const eventOf = (i = 0) => db.appendConsentEventGuarded.mock.calls[i]?.[1];
const guardOf = (i = 0) => db.appendConsentEventGuarded.mock.calls[i]?.[2];

beforeEach(() => {
  for (const fn of Object.values(db)) fn.mockReset();
  n = 0;
  db.readConsentHistory.mockResolvedValue([]);
  db.appendConsentEventGuarded.mockResolvedValue({ outcome: "appended", id: "new_1", prior: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("stopEmails", () => {
  it("writes revoked / staff on the EMAIL channel through the service client, compare-and-set on the row the operator saw, with an Undo (mutation: channel 'sms' → FAILS; mutation: guard 'none' → FAILS)", async () => {
    const r = await stopEmails(ctx, null);
    expect(db.appendConsentEventGuarded.mock.calls[0]![0]).toBe(WRITER);
    expect(eventOf()).toMatchObject({ channel: "email", address: "ana@example.com", action: "revoked", method: "staff", actorId: "user_1", contactId: "c1", evidence: { actorName: "Ana" } });
    expect(guardOf()).toEqual({ ifNewest: null });
    expect(r).toMatchObject({ ok: true, undo: { kind: "stop", eventId: "new_1" } });
  });

  it("over a customer's own stop it writes NOTHING and answers where things stand (choice 19; mutation: drop the read-first check → the write is attempted, FAILS)", async () => {
    db.readConsentHistory.mockResolvedValue([row("revoked", "one_click")]);
    const r = await stopEmails(ctx, "ev_1");
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, error: m["contact.email.changed"], view: { kind: "stopped" } });
  });

  it("a stale click (the newest row moved) is refused, never applied (mutation: ignore expectNewest → FAILS)", async () => {
    db.readConsentHistory.mockResolvedValue([row("resubscribed", "unsubscribe_page")]);
    expect(await stopEmails(ctx, null)).toMatchObject({ ok: false, error: m["contact.email.changed"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("undoStopEmails", () => {
  it("lifts ONLY that staff member's own stop, young, on this address and channel, as staff_undo (G20; mutation: allow another user's row → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff", FRESH), actor_id: "user_1", channel: "email", address: "ana@example.com", contact_id: "c1" });
    expect(await undoStopEmails(ctx, "ev_1")).toMatchObject({ ok: true });
    expect(eventOf()).toMatchObject({ action: "resubscribed", method: "staff_undo", evidence: { undoes: "ev_1" } });
    db.appendConsentEventGuarded.mockClear();
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff", FRESH), actor_id: "user_2", channel: "email", address: "ana@example.com", contact_id: "c1" });
    expect(await undoStopEmails(ctx, "ev_2")).toMatchObject({ ok: false, error: m["contact.email.undoExpired"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("refuses an SMS row of any address, and a customer's stop (mutation: skip the channel check → FAILS)", async () => {
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "staff", FRESH), actor_id: "user_1", channel: "sms", address: "ana@example.com", contact_id: "c1" });
    expect(await undoStopEmails(ctx, "ev_1")).toMatchObject({ ok: false });
    db.readConsentEvent.mockResolvedValue({ ...row("revoked", "one_click", FRESH), actor_id: null, channel: "email", address: "ana@example.com", contact_id: null });
    expect(await undoStopEmails(ctx, "ev_2")).toMatchObject({ ok: false });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });
});

describe("resumeEmails", () => {
  it("needs a note; resumes a staff or folded stop with it, as resubscribed / staff (choice 19; mutation: accept an empty note → FAILS)", async () => {
    expect(await resumeEmails(ctx, "ev_1", "   ")).toEqual({ ok: false, error: m["contact.email.resumeNoteRequired"] });
    db.readConsentHistory.mockResolvedValue([row("revoked", "backfill_0049")]);
    expect(await resumeEmails(ctx, "ev_1", " They asked on the phone ")).toMatchObject({ ok: true });
    expect(eventOf()).toMatchObject({ action: "resubscribed", method: "staff", note: "They asked on the phone" });
    expect(guardOf()).toEqual({ ifNewest: "ev_1" });
  });

  it("refuses to resume a customer's own unsubscribe (choice 19; mutation: add unsubscribe_link to the resumable list → FAILS)", async () => {
    db.readConsentHistory.mockResolvedValue([row("revoked", "unsubscribe_link")]);
    expect(await resumeEmails(ctx, "ev_1", "asked")).toMatchObject({ ok: false, error: m["contact.email.changed"] });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("a thrown read or write is the plain failure line, logged (mutation: rethrow → the drawer crashes, FAILS)", async () => {
    db.readConsentHistory.mockRejectedValue(new Error("down"));
    expect(await resumeEmails(ctx, "ev_1", "asked")).toEqual({ ok: false, error: m["contact.email.failed"] });
  });
});
```

Create `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/email/route.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const access = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ apiAccountAccess: access }));
const maybeSingle = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => client }));
const getContact = vi.hoisted(() => vi.fn());
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), getContact }));
const readEmailView = vi.hoisted(() => vi.fn());
vi.mock("@/lib/consent/email-view", () => ({ readEmailView }));
vi.mock("@/lib/zone", () => ({ renderZone: async (z?: string) => ({ zone: z ?? "UTC", guessed: !z, label: z ?? "UTC" }) }));

import { GET } from "./route";

const params = { params: Promise.resolve({ accountId: "a1", contactId: "c1" }) };

beforeEach(() => {
  access.mockReset().mockResolvedValue({ userId: "u", isAgency: false });
  getContact.mockReset().mockResolvedValue({ id: "c1", email: "Ana@Example.com" });
  readEmailView.mockReset().mockResolvedValue({ kind: "allowed", newestId: null });
  maybeSingle.mockReset().mockResolvedValue({ data: { timezone: "America/Chicago" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET …/email — the Email row's own read (spec §6: its own loading and error)", () => {
  it("answers the view and the account's zone, read under the request's own RLS client (mutation: read under serviceDb → FAILS)", async () => {
    const res = await GET(new Request("https://x.test"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: { kind: "allowed", newestId: null }, zone: "America/Chicago" });
    expect(getContact).toHaveBeenCalledWith(client, "a1", "c1");
    expect(readEmailView).toHaveBeenCalledWith(client, "a1", { id: "c1", email: "Ana@Example.com" });
  });

  it("404 without access and for another account's contact; 500 on an unreadable ledger, never a guessed Allowed (fails closed; mutation: answer allowed in the catch → FAILS)", async () => {
    access.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    getContact.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://x.test"), params)).status).toBe(404);
    readEmailView.mockRejectedValueOnce(new Error("down"));
    expect((await GET(new Request("https://x.test"), params)).status).toBe(500);
  });
});
```

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/email-view.test.ts src/lib/consent/email-staff-actions.test.ts "src/app/api/accounts/[accountId]/contacts/[contactId]/email"
```
Expected (predicted): each fails to import its subject.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/consent/email-view.ts`:
```ts
import {
  consentStateOf, newestDecidingRow, readConsentHistory,
  type ConsentHistoryRow, type ConsentMethod, type SupabaseClient,
} from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";

/**
 * The contact's Email row (consent chain spec §6, PR-3), as data: what the
 * ledger says about their email address. Allowed or Stopped — email has no
 * holds (no free-text detection reads email), so a held row, which nothing
 * writes, reads as Stopped with no Resume. Server-only; the row imports only
 * the TYPES.
 */
export type EmailHow = { kind: "unsubscribe_link" } | { kind: "staff" } | { kind: "backfill_0049" };

export type EmailView =
  | { kind: "no_email" }
  | { kind: "allowed"; newestId: string | null }
  | { kind: "stopped"; eventId: string; since: string; how: EmailHow; canResume: boolean };

/** Choice 19: staff may resume only a stop staff recorded, or 0049's folded switch. */
export const EMAIL_RESUMABLE_METHODS: readonly ConsentMethod[] = ["staff", "backfill_0049"];

export function emailHowOf(method: ConsentMethod): EmailHow {
  switch (method) {
    case "unsubscribe_link":
    case "one_click":
    case "unsubscribe_page": return { kind: "unsubscribe_link" };
    case "backfill_0049": return { kind: "backfill_0049" };
    default: return { kind: "staff" };
  }
}

export function emailViewOf(rows: readonly ConsentHistoryRow[], hasAddress: boolean): EmailView {
  if (!hasAddress) return { kind: "no_email" };
  const state = consentStateOf(rows);
  if (state.state !== "allowed") {
    return {
      kind: "stopped", eventId: state.eventId, since: state.since, how: emailHowOf(state.method),
      canResume: state.state === "stopped" && EMAIL_RESUMABLE_METHODS.includes(state.method),
    };
  }
  return { kind: "allowed", newestId: newestDecidingRow(rows)?.id ?? null };
}

/** The contact's Email row, read. THROWS on an unreadable ledger (the row shows its error line). */
export async function readEmailView(db: SupabaseClient, accountId: string, contact: { email: string | null }): Promise<EmailView> {
  const address = emailLedgerAddress(contact.email);
  if (!address) return { kind: "no_email" };
  return emailViewOf(await readConsentHistory(db, accountId, "email", address), true);
}
```

Create `apps/web/src/lib/consent/email-staff-actions.ts`:
```ts
import {
  appendConsentEventGuarded, readConsentHistory, readConsentEvent, newestDecidingRow,
  type ConsentAction, type ConsentHistoryRow, type ConsentMethod, type SupabaseClient,
} from "@bis/db";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { UNDO_WINDOW_MS } from "./staff-actions";
import { emailViewOf, EMAIL_RESUMABLE_METHODS, type EmailView } from "./email-view";

/**
 * The Email row's staff controls (spec §4.2 "Staff controls", for email;
 * §6). The Texts row's rules (PR-2's staff-actions.ts) on the email channel:
 * every write is a compare-and-set on the newest deciding row the operator
 * SAW, so a stale click — the customer unsubscribed while the drawer was open —
 * is refused and answered with where things stand; 0055 enforces choice 19's
 * staff rules inside its lock whatever this module checks.
 */
export type EmailUndo = { kind: "stop"; eventId: string };

export type EmailActionResult =
  | { ok: true; view: EmailView; undo?: EmailUndo }
  | { ok: false; error: string; view?: EmailView };

export type EmailContext = {
  /** The request's RLS client: reads the ledger. */
  db: SupabaseClient;
  /** The service client: the ledger's only writer (0054, 0055). */
  writer: SupabaseClient;
  accountId: string;
  contactId: string;
  userId: string;
  actorName: string | null;
  /** The contact's address as the ledger keys it (emailLedgerAddress). */
  address: string;
  now: Date;
};

const history = (ctx: EmailContext): Promise<ConsentHistoryRow[]> => readConsentHistory(ctx.db, ctx.accountId, "email", ctx.address);
const view = async (ctx: EmailContext): Promise<EmailView> => emailViewOf(await history(ctx), true);

function undoable(ctx: EmailContext, row: { actor_id: string | null; occurred_at: string }): boolean {
  const age = ctx.now.getTime() - Date.parse(row.occurred_at);
  return row.actor_id === ctx.userId && Number.isFinite(age) && age < UNDO_WINDOW_MS;
}

async function changed(ctx: EmailContext): Promise<EmailActionResult> {
  try {
    return { ok: false, error: m["contact.email.changed"], view: await view(ctx) };
  } catch (e) {
    console.error(`email row: account ${ctx.accountId} contact ${ctx.contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.email.changed"] };
  }
}

async function guarded(label: string, ctx: EmailContext, work: () => Promise<EmailActionResult>): Promise<EmailActionResult> {
  try {
    return await work();
  } catch (e) {
    console.error(`${label}: account ${ctx.accountId} contact ${ctx.contactId}: ${loggableError(e)}`);
    return { ok: false, error: m["contact.email.failed"] };
  }
}

async function write(
  ctx: EmailContext, e: { action: ConsentAction; method: ConsentMethod; note?: string; evidence?: Record<string, unknown> },
  expect: string | null,
): Promise<string | null> {
  const r = await appendConsentEventGuarded(ctx.writer, {
    accountId: ctx.accountId, channel: "email", address: ctx.address, contactId: ctx.contactId,
    action: e.action, method: e.method, actorId: ctx.userId, note: e.note ?? null,
    evidence: { ...(e.evidence ?? {}), ...(ctx.actorName ? { actorName: ctx.actorName } : {}) },
  }, { ifNewest: expect });
  return r.outcome === "appended" ? r.id : null;
}

/** "Stop emails": revoked / staff, at once, with an Undo — only over an allowed address. */
export function stopEmails(ctx: EmailContext, expectNewest: string | null): Promise<EmailActionResult> {
  return guarded("stopEmails", ctx, async () => {
    const newest = newestDecidingRow(await history(ctx));
    if ((newest?.id ?? null) !== expectNewest || (newest !== null && newest.action !== "resubscribed" && newest.action !== "hold_released")) {
      return changed(ctx);
    }
    const id = await write(ctx, { action: "revoked", method: "staff" }, expectNewest);
    if (!id) return changed(ctx);
    return { ok: true, view: await view(ctx), undo: { kind: "stop", eventId: id } };
  });
}

/** The Undo of "Stop emails": only that staff member's own stop, young, still newest. */
export function undoStopEmails(ctx: EmailContext, eventId: string): Promise<EmailActionResult> {
  return guarded("undoStopEmails", ctx, async () => {
    const row = await readConsentEvent(ctx.db, ctx.accountId, eventId);
    if (!row || row.channel !== "email" || row.address !== ctx.address || row.action !== "revoked" || row.method !== "staff") return changed(ctx);
    if (!undoable(ctx, row)) return { ok: false, error: m["contact.email.undoExpired"] };
    const id = await write(ctx, { action: "resubscribed", method: "staff_undo", evidence: { undoes: eventId } }, eventId);
    return id ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}

/** "Resume emails" with the required note: only a stop staff may lift (choice 19). */
export async function resumeEmails(ctx: EmailContext, expectEventId: string, note: string): Promise<EmailActionResult> {
  const text = note.trim();
  if (!text) return { ok: false, error: m["contact.email.resumeNoteRequired"] };
  return guarded("resumeEmails", ctx, async () => {
    const newest = newestDecidingRow(await history(ctx));
    if (!newest || newest.id !== expectEventId || newest.action !== "revoked" || !EMAIL_RESUMABLE_METHODS.includes(newest.method)) {
      return changed(ctx);
    }
    const id = await write(ctx, { action: "resubscribed", method: "staff", note: text.slice(0, 500) }, expectEventId);
    return id ? { ok: true, view: await view(ctx) } : changed(ctx);
  });
}
```

Create `apps/web/src/lib/consent/email-context.ts`:
```ts
import { getContact, serviceDb } from "@bis/db";
import { emailLedgerAddress } from "@bis/db/email-address";
import { dbForRequest } from "@/lib/db";
import { m } from "@/lib/messages";
import { loggableError } from "@/lib/loggable-error";
import { actorName } from "./actor";
import type { EmailContext } from "./email-staff-actions";

/**
 * The context an Email row action runs in, AFTER the caller's own
 * requireAccountAccess: the contact read under the request's RLS client
 * (which proves it is this account's), its address as the ledger keys it,
 * and the service client that writes (0053's server-written shape).
 */
export async function emailContextFor(
  accountId: string, contactId: string, userId: string,
): Promise<EmailContext | { ok: false; reason: "no_email" | "failed"; error: string }> {
  try {
    const db = await dbForRequest();
    const contact = await getContact(db, accountId, contactId);
    const address = emailLedgerAddress(contact?.email ?? null);
    if (!contact || !address) return { ok: false, reason: "no_email", error: m["contact.email.noEmail"] };
    return { db, writer: serviceDb(), accountId, contactId, userId, actorName: await actorName(userId), address, now: new Date() };
  } catch (e) {
    console.error(`emailContextFor: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return { ok: false, reason: "failed", error: m["contact.email.failed"] };
  }
}
```

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/email-actions.ts`:
```ts
"use server";

import { revalidatePath } from "next/cache";
import { requireAccountAccess } from "@/lib/auth";
import { emailContextFor } from "@/lib/consent/email-context";
import {
  stopEmails, undoStopEmails, resumeEmails, type EmailActionResult, type EmailContext,
} from "@/lib/consent/email-staff-actions";

/** The Email row's actions (consent chain PR-3). Each re-reads the contact under RLS. */
async function run(
  accountId: string, contactId: string, act: (ctx: EmailContext) => Promise<EmailActionResult>,
): Promise<EmailActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  const ctx = await emailContextFor(accountId, contactId, userId);
  if ("ok" in ctx) return ctx;
  const result = await act(ctx);
  if (result.ok) revalidatePath(`/dashboard/accounts/${accountId}/contacts/${contactId}`);
  return result;
}

export async function stopEmailsAction(accountId: string, contactId: string, expectNewest: string | null): Promise<EmailActionResult> {
  return run(accountId, contactId, (ctx) => stopEmails(ctx, expectNewest));
}
export async function undoStopEmailsAction(accountId: string, contactId: string, eventId: string): Promise<EmailActionResult> {
  return run(accountId, contactId, (ctx) => undoStopEmails(ctx, eventId));
}
export async function resumeEmailsAction(accountId: string, contactId: string, expectEventId: string, note: string): Promise<EmailActionResult> {
  return run(accountId, contactId, (ctx) => resumeEmails(ctx, expectEventId, note));
}
```

Create `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/email/route.ts`:
```ts
import { NextResponse } from "next/server";
import { getContact } from "@bis/db";
import { apiAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { loggableError } from "@/lib/loggable-error";
import { readEmailView, type EmailView } from "@/lib/consent/email-view";

export const dynamic = "force-dynamic";

/** The drawer's Email row reads this on its own (spec §6: the Messages block's own loading and error). */
export type EmailResponse = { view: EmailView; zone: string };

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ accountId: string; contactId: string }> },
) {
  const { accountId, contactId } = await params;
  const access = await apiAccountAccess(accountId);
  if (!access) return NextResponse.json({}, { status: 404 });
  const db = await dbForRequest(); // RLS-scoped — NEVER serviceDb here
  const contact = await getContact(db, accountId, contactId);
  if (!contact) return NextResponse.json({}, { status: 404 });
  try {
    const [view, account] = await Promise.all([
      readEmailView(db, accountId, contact),
      db.from("accounts").select("timezone").eq("id", accountId).maybeSingle(),
    ]);
    if (account.error) console.error(`email read: account ${accountId} timezone unreadable: ${loggableError(account.error)}`);
    const zone = await renderZone(account.error ? undefined : (account.data as { timezone: string } | null)?.timezone);
    return NextResponse.json({ view, zone: zone.zone } satisfies EmailResponse);
  } catch (e) {
    // Fails closed: an unreadable ledger is the row's error line, never a guessed "Allowed".
    console.error(`email read: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return NextResponse.json({ error: "unreadable" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run to see them pass**

The same command as Step 2. Expected (predicted): all pass.

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `emailViewOf`: `if (!hasAddress)` removed | "no address is no_email …" |
| 2 | `EMAIL_RESUMABLE_METHODS` gains `"one_click"` | "a customer's own stop … NOT resumable"; "the resumable list is exactly …" |
| 3 | `emailHowOf`: `backfill_0049` falls to `default` | "a staff stop and a folded 0049 stop …" |
| 4 | `write`: `channel: "sms"` | "writes revoked / staff on the EMAIL channel …" |
| 5 | `stopEmails`: drop the read-first check | "over a customer's own stop it writes NOTHING …" |
| 6 | `undoStopEmails`: drop `row.channel !== "email"` | "refuses an SMS row …" |
| 7 | `resumeEmails`: drop the `!text` check | "needs a note …" |
| 8 | route: `return NextResponse.json({ view: { kind: "allowed", newestId: null }, zone: "UTC" })` in the catch | "404 without access … 500 on an unreadable ledger" |

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/email-view.ts apps/web/src/lib/consent/email-view.test.ts apps/web/src/lib/consent/email-staff-actions.ts apps/web/src/lib/consent/email-staff-actions.test.ts apps/web/src/lib/consent/email-context.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/email-actions.ts" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/email"
git commit -m "feat(consent): the Email row's data — its view, Stop / Undo / Resume emails, and the drawer's read"
```

---

### Task 11: The Email row in the drawer and on the contact page; the 0049 switch removed

**Owner:** bis-crm (bis-frontend reviews; bis-design-reviewer audits at Task 15). **Tier:** HIGH. **Questions:** none.

**Files:**
- Create: `apps/web/src/lib/consent/email-row.ts`, `email-row.test.ts`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/email-row.tsx`, `email-row.test.ts`
- Modify: `…/contacts/contact-drawer.tsx`, `contact-drawer.wiring.test.ts`
- Modify: `…/contacts/[contactId]/contact-fields-panel.tsx`, `…/contacts/[contactId]/page.tsx`, `…/contacts/[contactId]/page.test.ts`
- Modify: `…/contacts/actions.ts`, `…/contacts/actions.test.ts` (the switch's action goes)
- Modify: `src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts`, `route.test.ts`, `src/lib/contacts/summary.ts`, `summary.test.ts` (the column leaves the summary)
- Modify: `src/lib/zone.ts` (`ZoneLabel`, the type `OptOutZone` was), `src/lib/messages.ts` (the switch's keys go), `src/app/(dashboard)/dashboard/styleguide/page.tsx`, `apps/web/e2e/contacts-drawer.spec.ts` (the switch's e2e case goes)
- Delete: `…/contacts/marketing-optout-switch.tsx`, `marketing-optout-switch.test.ts`, `marketing-optout-switch.wiring.test.ts`, `src/lib/contacts/marketing-optout.ts`, `marketing-optout.test.ts`

**Interfaces:**
- Consumes: `EmailView`, `EmailHow` (Task 10); `EmailActionResult`, `EmailUndo` (Task 10); the three server actions (Task 10); `EmailResponse` (Task 10's route); `ToastLike`, `runGuarded` (`lib/ui/guarded-run.ts`); `DotPill`; the `contact.email.*` and `contact.messages.email` copy (Task 4).
- Produces:
  - `type EmailLoad = { status: "loading" } | { status: "error" } | { status: "ready"; view: EmailView; zone: string }`
  - `EMAIL_TREATMENT` (`allowed`, `stopped`: dot + word, the Texts row's token classes), `emailHowLine(how)`, `emailLine(view, zone)`, `parseEmailResponse(json)`, `emailLoadFrom(res)`, `runEmailAction(act, show, toast, o)` (from `lib/consent/email-row.ts`, client-safe: type-only imports of server modules)
  - `<EmailRow accountId contactId load showTitle onChanged? onRetry? />` — renders nothing for `no_email`; `showTitle` puts the Messages block's label on it when the Texts row shows none (no textable number).
  - `ZoneLabel` in `lib/zone.ts` (was `OptOutZone`).

**The row** (spec §6; DESIGN.md rules 3, 6, 8; G14):
- **Allowed:** "Email" + dot/word "Allowed", ghost "Stop emails" → at once, toast "Emails stopped." with Undo.
- **Stopped:** dot/word "Stopped", the line "Since {date} · {how}"; a stop staff may lift → ghost "Resume emails…" opens the inline note form (label "What did they ask for? (required)", its one primary "Resume emails", ghost "Cancel"); a customer's own stop → "They can resubscribe from the unsubscribe link in any email from you."
- **Loading:** a two-row skeleton (the Texts row's). **Error:** "Couldn't load their email settings. Try again." with a ghost Retry. No empty state: a contact with no email renders no Email row.
- Keyboard: the status line is a focus target kept mounted; every action returns focus to it; the note field takes focus when the form opens; Cancel hands it back (the Texts row's R3-M9 rule).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/lib/consent/email-row.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { emailLine, emailHowLine, parseEmailResponse, runEmailAction, EMAIL_TREATMENT } from "./email-row";
import { m } from "@/lib/messages";

describe("emailLine — 'Since {date} · {how}' (G14)", () => {
  it("each how, and the date in the ACCOUNT's zone (mutation: format in UTC → a Chicago evening stop reads as the next day, FAILS)", () => {
    const at = "2026-10-04T02:30:00Z"; // Oct 3, 9:30 PM in Chicago
    expect(emailLine({ kind: "stopped", eventId: "e", since: at, how: { kind: "unsubscribe_link" }, canResume: false }, "America/Chicago"))
      .toMatch(/^Since .*Oct 3.* · unsubscribe link$/);
    expect(emailHowLine({ kind: "staff" })).toBe(m["contact.email.how.staff"]);
    expect(emailHowLine({ kind: "backfill_0049" })).toBe("you marked them “No marketing emails”");
    expect(emailLine({ kind: "allowed", newestId: null }, "America/Chicago")).toBeNull();
  });

  it("a date that will not format drops the date, never throws in a render (mutation: let formatDateInZone throw → FAILS)", () => {
    expect(emailLine({ kind: "stopped", eventId: "e", since: "not a date", how: { kind: "staff" }, canResume: true }, "America/Chicago"))
      .toBe(m["contact.email.how.staff"]);
  });
});

describe("parseEmailResponse — the drawer's read, parsed, never cast", () => {
  it("accepts the three views and refuses anything it cannot trust (mutation: accept a stopped view with no eventId → FAILS)", () => {
    expect(parseEmailResponse({ view: { kind: "allowed", newestId: null }, zone: "UTC" })).toEqual({ view: { kind: "allowed", newestId: null }, zone: "UTC" });
    expect(parseEmailResponse({ view: { kind: "no_email" }, zone: "UTC" })).not.toBeNull();
    expect(parseEmailResponse({ view: { kind: "stopped", since: "x", how: { kind: "staff" }, canResume: true }, zone: "UTC" })).toBeNull();
    expect(parseEmailResponse({ view: { kind: "held" }, zone: "UTC" })).toBeNull();
    expect(parseEmailResponse(null)).toBeNull();
  });
});

describe("runEmailAction — at once, the answer shown, Undo on the toast (rule 6)", () => {
  it("shows the new view and offers Undo; a refusal shows where things stand and says why (mutation: skip show on a refusal → a stale row stays, FAILS)", async () => {
    const show = vi.fn();
    const toast = { success: vi.fn(), error: vi.fn() };
    const undo = vi.fn();
    await runEmailAction(async () => ({ ok: true, view: { kind: "allowed", newestId: "n" }, undo: { kind: "stop", eventId: "e1" } }), show, toast, { success: "Emails stopped.", undo });
    expect(show).toHaveBeenCalledWith({ kind: "allowed", newestId: "n" });
    expect(toast.success).toHaveBeenCalledWith("Emails stopped.", expect.objectContaining({ action: expect.objectContaining({ label: m["common.undo"] }) }));
    await runEmailAction(async () => ({ ok: false, error: "changed", view: { kind: "allowed", newestId: null } }), show, toast, { success: "x" });
    expect(show).toHaveBeenLastCalledWith({ kind: "allowed", newestId: null });
    expect(toast.error).toHaveBeenCalledWith("changed");
  });

  it("the two treatments are dot + word with token classes only (rule 3; mutation: a hex colour → FAILS)", () => {
    for (const t of Object.values(EMAIL_TREATMENT)) {
      expect(t.label.length).toBeGreaterThan(0);
      expect(`${t.dot} ${t.chip}`).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
    }
  });
});
```

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/email-row.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { m } from "@/lib/messages";
import type { EmailLoad } from "@/lib/consent/email-row";

// Server actions are stubbed: this renders, nothing is clicked (the clicks are e2e, Task 14).
vi.mock("./email-actions", () => ({ stopEmailsAction: vi.fn(), undoStopEmailsAction: vi.fn(), resumeEmailsAction: vi.fn() }));

const { EmailRow } = await import("./email-row");

const ready = (view: Extract<EmailLoad, { status: "ready" }>["view"]): EmailLoad => ({ status: "ready", view, zone: "America/Chicago" });
const html = (load: EmailLoad, showTitle = false) => renderToStaticMarkup(createElement(EmailRow, { accountId: "a1", contactId: "c1", load, showTitle }));
const buttons = (markup: string) => [...markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((b) => b[1]);

describe("EmailRow — spec §6's Email row", () => {
  it("Allowed: 'Email', the dot + word, ONE ghost 'Stop emails', no primary (rules 3, 8; mutation: make Stop emails the default variant → FAILS)", () => {
    const out = html(ready({ kind: "allowed", newestId: null }));
    expect(renderedText(out)).toContain(`${m["contact.messages.email"]}${m["contact.email.allowed"]}`);
    expect(buttons(out)).toEqual([m["contact.email.stopEmails"]]);
    expect(out).toContain('data-variant="ghost"');
    expect(out).not.toContain('data-variant="default"');
  });

  it("Stopped by the customer: the since line, the customer-only line, NO Resume (choice 19; mutation: offer Resume → FAILS)", () => {
    const out = renderedText(html(ready({ kind: "stopped", eventId: "e", since: "2026-10-03T15:00:00Z", how: { kind: "unsubscribe_link" }, canResume: false })));
    expect(out).toContain("unsubscribe link");
    expect(out).toContain(m["contact.email.customerOnly"]);
    expect(out).not.toContain(m["contact.email.resume"]);
  });

  it("Stopped by staff or the fold: ghost 'Resume emails…' (the note form opens on click, e2e), no customer-only line (mutation: canResume ignored → FAILS)", () => {
    const out = html(ready({ kind: "stopped", eventId: "e", since: "2026-09-01T15:00:00Z", how: { kind: "backfill_0049" }, canResume: true }));
    expect(buttons(out)).toEqual([m["contact.email.resume"]]);
    expect(renderedText(out)).toContain("you marked them “No marketing emails”");
    expect(renderedText(out)).not.toContain(m["contact.email.customerOnly"]);
  });

  it("no email address renders nothing; loading is the two-row skeleton; error is the line and Retry (spec §6 states; mutation: render 'Allowed' while loading → FAILS)", () => {
    expect(html(ready({ kind: "no_email" }))).toBe("");
    expect(html({ status: "loading" })).toContain('data-testid="email-row-skeleton"');
    expect(renderedText(html({ status: "error" }))).toContain(m["contact.email.loadFailed"]);
  });

  it("shows the Messages label only when told to (the Texts row shows none for a contact with no number; mutation: always show it → two labels, FAILS)", () => {
    expect(renderedText(html(ready({ kind: "allowed", newestId: null }), true))).toContain(m["contact.messages.title"]);
    expect(renderedText(html(ready({ kind: "allowed", newestId: null }), false))).not.toContain(m["contact.messages.title"]);
  });
});
```
(`renderedText` is `lib/rendered-text.ts`, which PR-2's row tests use; `components/ui/button.tsx` prints `data-variant={variant}`, which the Texts row's tests read the same way.)

Edit `…/contacts/contact-drawer.wiring.test.ts`: every assertion that names `MarketingOptOutSwitch` or `marketing_email_opted_out_at` is deleted; add (next to its Texts row wiring case — `grep -n "texts" …/contact-drawer.wiring.test.ts`):
```ts
  it("the drawer reads the Email row on its own and renders it under the Texts row, and no longer renders the 0049 switch (consent PR-3; mutation: keep MarketingOptOutSwitch → FAILS)", () => {
    const src = readFileSync(fileURLToPath(new URL("./contact-drawer.tsx", import.meta.url)), "utf8");
    expect(src).toMatch(/fetch\(`\/api\/accounts\/\$\{accountId\}\/contacts\/\$\{contactId\}\/email`\)/);
    expect(src.indexOf("<EmailRow")).toBeGreaterThan(src.indexOf("<TextsRow"));
    expect(src).not.toMatch(/MarketingOptOutSwitch|marketing_email_opted_out_at/);
  });
```
(add `readFileSync` / `fileURLToPath` imports if the file lacks them).

Edit `…/contacts/actions.test.ts`: delete every case for `setMarketingEmailOptOutAction` (`grep -n "setMarketingEmailOptOut" …/contacts/actions.test.ts`) and `setMarketingEmailOptOut` from its `@bis/db` mock.

Edit `src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts` and `src/lib/contacts/summary.test.ts`: delete `marketing_email_opted_out_at` from every fixture and expectation; the summary parser's case "a missing marketing_email_opted_out_at refuses the summary" becomes:
```ts
  it("the summary no longer carries 0049's column, and a body that still has it loads (an old server during the deploy; consent PR-3; mutation: keep it required → FAILS)", () => {
    const parsed = parseContactSummary({ tags: [], recent: [], marketing_email_opted_out_at: "2026-09-01T00:00:00Z" });
    expect(parsed).not.toBeNull();
    expect(parsed).not.toHaveProperty("marketing_email_opted_out_at");
  });
```

Edit `…/contacts/[contactId]/page.test.ts`: where it asserts the props handed to `ContactFieldsPanel`, replace `zone` with `email: { status: "ready", view: …, zone: … }` read through a mocked `readEmailView` (add `readEmailView: vi.fn().mockResolvedValue({ kind: "allowed", newestId: null })` to its `@/lib/consent/email-view` mock) and add one case: `readEmailView` rejecting → `email: { status: "error" }` (mutation: let the throw escape → the whole page errors, FAILS).

Edit `apps/web/e2e/contacts-drawer.spec.ts`: delete the test that ticks "No marketing emails" (it reads `marketing_email_opted_out_at` and `m["contact.marketingOptOut.*"]`; `grep -n "marketingOptOut\|marketing_email_opted_out_at" apps/web/e2e/contacts-drawer.spec.ts`). Task 14's `consent-email.spec.ts` replaces it.

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/email-row.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/lib/contacts/summary.test.ts "src/app/api/accounts/[accountId]/contacts/[contactId]/summary"
```
Expected (predicted): the new files fail to import; the wiring and summary cases fail.

- [ ] **Step 3: Implement**

Create `apps/web/src/lib/consent/email-row.ts`:
```ts
import { m } from "@/lib/messages";
import { formatDateInZone } from "@/lib/format";
import type { ToastLike } from "@/lib/ui/guarded-run";
import type { EmailHow, EmailView } from "./email-view";
import type { EmailActionResult, EmailUndo } from "./email-staff-actions";

/**
 * The Email row's behaviour, minus React (spec §6, consent PR-3): its words,
 * its read, and how an action runs (DESIGN.md rule 6: at once, the answer
 * shown, Undo on the toast). Client-safe: TYPE-ONLY imports of the server
 * modules. The Texts row's shape (texts-row.ts), for the email channel.
 */
export type EmailLoad =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; view: EmailView; zone: string };

/** Dot + word (rule 3), the Texts row's token classes. */
export const EMAIL_TREATMENT = {
  allowed: { label: m["contact.email.allowed"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  stopped: { label: m["contact.email.stopped"], dot: "bg-destructive", chip: "border-destructive/25 bg-transparent text-muted-foreground" },
} as const;

export function emailHowLine(how: EmailHow): string {
  switch (how.kind) {
    case "unsubscribe_link": return m["contact.email.how.unsubscribeLink"];
    case "staff": return m["contact.email.how.staff"];
    case "backfill_0049": return m["contact.email.how.backfill0049"];
  }
}

/** The line under the status, or null. A date that will not format drops the date, never throws in a render. */
export function emailLine(view: EmailView, zone: string): string | null {
  if (view.kind !== "stopped") return null;
  let since: string | null = null;
  try {
    since = m["contact.email.since"].replace("{date}", formatDateInZone(view.since, zone));
  } catch {
    since = null;
  }
  const how = emailHowLine(view.how);
  return since ? `${since} · ${how}` : how;
}

export function parseEmailResponse(json: unknown): { view: EmailView; zone: string } | null {
  const j = json as { view?: Record<string, unknown>; zone?: unknown } | null;
  if (!j || typeof j !== "object" || typeof j.zone !== "string" || !j.view) return null;
  const v = j.view;
  if (v.kind === "no_email") return { view: { kind: "no_email" }, zone: j.zone };
  if (v.kind === "allowed" && (v.newestId === null || typeof v.newestId === "string")) return { view: v as EmailView, zone: j.zone };
  if (v.kind === "stopped" && typeof v.eventId === "string" && typeof v.since === "string"
    && typeof v.how === "object" && v.how !== null && typeof v.canResume === "boolean") return { view: v as EmailView, zone: j.zone };
  return null;
}

export async function emailLoadFrom(res: { ok: boolean; json: () => Promise<unknown> }): Promise<EmailLoad> {
  if (!res.ok) return { status: "error" };
  const parsed = parseEmailResponse(await res.json());
  return parsed ? { status: "ready", ...parsed } : { status: "error" };
}

export type EmailRunner = (work: () => Promise<void>) => boolean | Promise<void>;

async function attempt(
  act: () => Promise<EmailActionResult>, show: (v: EmailView) => void, toast: ToastLike,
): Promise<Extract<EmailActionResult, { ok: true }> | null> {
  let r: EmailActionResult;
  try {
    r = await act();
  } catch {
    toast.error(m["inline.crashed"]);
    return null;
  }
  if (!r.ok) {
    if (r.view) show(r.view);
    toast.error(r.error);
    return null;
  }
  show(r.view);
  return r;
}

/** One action. Answers whether it went through. Undo runs through the row's own guard. */
export async function runEmailAction(
  act: () => Promise<EmailActionResult>, show: (v: EmailView) => void, toast: ToastLike,
  o: { success: string; undo?: (u: EmailUndo) => Promise<EmailActionResult>; run?: EmailRunner; onChanged?: () => void },
): Promise<boolean> {
  const r = await attempt(act, show, toast);
  if (!r) return false;
  o.onChanged?.();
  const undo = o.undo;
  const token = r.undo;
  if (!undo || !token) {
    toast.success(o.success);
    return true;
  }
  toast.success(o.success, {
    action: {
      label: m["common.undo"],
      onClick: () => {
        const run = o.run ?? ((work) => work());
        const ran = run(async () => {
          if (await attempt(() => undo(token), show, toast)) o.onChanged?.();
        });
        if (ran === false) toast.error(m["contact.email.undoBusy"]);
        return ran;
      },
    },
  });
  return true;
}
```

Create `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/email-row.tsx`:
```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { DotPill } from "@/components/dot-pill";
import { m } from "@/lib/messages";
import { runGuarded } from "@/lib/ui/guarded-run";
import { EMAIL_TREATMENT, emailLine, runEmailAction, type EmailLoad } from "@/lib/consent/email-row";
import type { EmailView } from "@/lib/consent/email-view";
import type { EmailActionResult, EmailUndo } from "@/lib/consent/email-staff-actions";
import { stopEmailsAction, undoStopEmailsAction, resumeEmailsAction } from "./email-actions";

/**
 * The contact's Messages block, Email row (consent chain spec §6, PR-3):
 * Allowed or Stopped, each a dot + word (rule 3); every button ghost except
 * the Resume form's own "Resume emails" (rule 8: that inline form is its own
 * view); Stop runs at once with an Undo toast (rule 6), Resume asks for a
 * note first. It replaces 0049's "No marketing emails" switch. Keyboard: the
 * status line is a focus target that stays mounted, and every action returns
 * focus to it (the Texts row's rule, PR-2 R3-M9).
 */
type Ready = Extract<EmailLoad, { status: "ready" }>;

function Block({ children, state, showTitle }: { children: React.ReactNode; state?: string; showTitle: boolean }) {
  return (
    <div className="space-y-1.5" data-testid="email-row" data-state={state}>
      {showTitle ? (
        <p className="text-muted-foreground font-mono text-[10px] font-medium tracking-[0.14em] uppercase">{m["contact.messages.title"]}</p>
      ) : null}
      {children}
    </div>
  );
}

export function EmailRow({ accountId, contactId, load, showTitle, onChanged = () => {}, onRetry }: {
  accountId: string;
  contactId: string;
  load: EmailLoad;
  /** True when the Texts row above shows no Messages label (no textable number). */
  showTitle: boolean;
  onChanged?: () => void;
  onRetry?: () => void;
}) {
  if (load.status === "loading") {
    return (
      <Block showTitle={showTitle}>
        <div className="space-y-2" data-testid="email-row-skeleton">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-5 w-32" />
        </div>
      </Block>
    );
  }
  if (load.status === "error") {
    return (
      <Block showTitle={showTitle}>
        <p className="text-muted-foreground text-sm">{m["contact.email.loadFailed"]}</p>
        {onRetry ? <Button size="sm" variant="ghost" onClick={onRetry}>{m["common.retry"]}</Button> : null}
      </Block>
    );
  }
  if (load.view.kind === "no_email") return null;
  return <ReadyRow key={contactId} accountId={accountId} contactId={contactId} load={load} showTitle={showTitle} onChanged={onChanged} />;
}

function ReadyRow({ accountId, contactId, load, showTitle, onChanged }: {
  accountId: string; contactId: string; load: Ready; showTitle: boolean; onChanged: () => void;
}) {
  const [adopted, setAdopted] = useState(load);
  const [view, setView] = useState<EmailView>(load.view);
  const [resuming, setResuming] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const status = useRef<HTMLDivElement>(null);

  // A re-read is the truth, adopted during render (React's pattern for a prop that changed).
  if (adopted !== load) {
    setAdopted(load);
    setView(load.view);
  }

  const run = (work: () => Promise<void>): boolean => runGuarded(busy, startTransition, work);
  const show = (next: EmailView) => {
    setView(next);
    setResuming(false);
    setNote("");
    queueMicrotask(() => status.current?.focus());
  };
  const undo = (u: EmailUndo): Promise<EmailActionResult> => undoStopEmailsAction(accountId, contactId, u.eventId);
  const act = (call: () => Promise<EmailActionResult>, success: string, withUndo = true) => {
    if (pending || busy.current) return;
    run(async () => {
      await runEmailAction(call, show, toast, { success, undo: withUndo ? undo : undefined, run, onChanged });
    });
  };

  if (view.kind === "no_email") return null;
  const line = emailLine(view, load.zone);
  const pill = view.kind === "allowed" ? EMAIL_TREATMENT.allowed : EMAIL_TREATMENT.stopped;

  return (
    <Block state={view.kind} showTitle={showTitle}>
      <div ref={status} tabIndex={-1} data-testid="email-row-status"
        className="flex items-center gap-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span>{m["contact.messages.email"]}</span>
        <DotPill {...pill} dense data-status={view.kind} />
      </div>
      {line ? <p className="text-muted-foreground text-xs">{line}</p> : null}

      {view.kind === "allowed" ? (
        <Button size="sm" variant="ghost" disabled={pending}
          onClick={() => act(() => stopEmailsAction(accountId, contactId, view.newestId), m["contact.email.stoppedToast"])}>
          {m["contact.email.stopEmails"]}
        </Button>
      ) : null}

      {view.kind === "stopped" && !view.canResume ? (
        <p className="text-muted-foreground text-xs">{m["contact.email.customerOnly"]}</p>
      ) : null}
      {view.kind === "stopped" && view.canResume && !resuming ? (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setNote(""); setResuming(true); }}>
          {m["contact.email.resume"]}
        </Button>
      ) : null}
      {view.kind === "stopped" && view.canResume && resuming ? (
        <form className="space-y-2" data-testid="email-resume-form" onSubmit={(e) => {
          e.preventDefault();
          act(() => resumeEmailsAction(accountId, contactId, view.eventId, note), m["contact.email.resumedToast"], false);
        }}>
          <Label htmlFor={`email-resume-${contactId}`}>{m["contact.email.resumeNoteLabel"]}</Label>
          <Input id={`email-resume-${contactId}`} name="note" value={note} required aria-required="true" autoFocus
            onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending || !note.trim()}>{m["contact.email.resumeSubmit"]}</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => {
              setResuming(false);
              queueMicrotask(() => status.current?.focus());
            }}>{m["contact.email.resumeCancel"]}</Button>
          </div>
        </form>
      ) : null}
    </Block>
  );
}
```

Edit `…/contacts/contact-drawer.tsx`:
1. Replace `import { MarketingOptOutSwitch } from "./marketing-optout-switch";` with:
```ts
import { EmailRow } from "./email-row";
import { emailLoadFrom, type EmailLoad } from "@/lib/consent/email-row";
```
2. After the Texts row's read (the block ending `const textsLoad: TextsLoad = …;`), add:
```ts
  // The Email row's own read (consent PR-3), the Texts row's pattern: the
  // same retryNonce, the same stale-closure guard. Its starting value's SHAPE
  // differs from the texts state's (an `email` key, not `load`), so the
  // wiring test's find-by-starting-value harness can tell the two apart.
  const [emailRead, setEmailRead] = useState<{ contactId: string; email: EmailLoad }>({ contactId: "", email: { status: "loading" } });
  useEffect(() => {
    if (!contactId) return;
    let stale = false;
    fetch(`/api/accounts/${accountId}/contacts/${contactId}/email`)
      .then(async (res) => {
        if (stale) return;
        const next = await emailLoadFrom(res);
        if (!stale) setEmailRead({ contactId, email: next });
      })
      .catch(() => { if (!stale) setEmailRead({ contactId, email: { status: "error" } }); });
    return () => { stale = true; };
  }, [accountId, contactId, retryNonce]);
  const emailLoad: EmailLoad = contactId && emailRead.contactId === contactId ? emailRead.email : { status: "loading" };
```
3. Right after the `<TextsRow … />` element, add:
```tsx
              <EmailRow
                accountId={accountId}
                contactId={row.id}
                load={emailLoad}
                showTitle={textsLoad.status === "ready" && textsLoad.view.kind === "no_number"}
                onChanged={() => setRetryNonce((n) => n + 1)}
                onRetry={() => setRetryNonce((n) => n + 1)}
              />
```
4. Delete the `<MarketingOptOutSwitch … />` element and the comment above it (`{/* From the summary, not \`row\`: … */}`).

Edit `…/contacts/[contactId]/contact-fields-panel.tsx`:
1. Replace `import type { OptOutZone } from "@/lib/contacts/marketing-optout";` and `import { MarketingOptOutSwitch } from "../marketing-optout-switch";` with `import { EmailRow } from "../email-row";` and `import type { EmailLoad } from "@/lib/consent/email-row";`.
2. In the props, replace `zone,` / `zone: OptOutZone;` (and its doc line) with `email,` / `/** The Email row (consent PR-3), read on the server by page.tsx. */ email: EmailLoad;`.
3. Replace the `<MarketingOptOutSwitch … />` element with:
```tsx
          <EmailRow
            accountId={accountId}
            contactId={contactId}
            load={email}
            showTitle={texts.status === "ready" && texts.view.kind === "no_number"}
            // The composer on this page reads the same ledger: refresh it too.
            onChanged={() => router.refresh()}
            onRetry={() => router.refresh()}
          />
```

Edit `…/contacts/[contactId]/page.tsx`: import `readEmailView` from `@/lib/consent/email-view` and `type EmailLoad` from `@/lib/consent/email-row`; after the Texts read, add:
```ts
  let email: EmailLoad;
  try {
    email = { status: "ready", view: await readEmailView(db, accountId, contact), zone: zone.zone };
  } catch (e) {
    console.error(`contact page: Email row unreadable for contact ${contactId}: ${loggableError(e)}`);
    email = { status: "error" };
  }
```
and in `<ContactFieldsPanel … />` replace `zone={{ zone: zone.zone, guessed: zone.guessed, label: zone.label }}` with `email={email}`.

Edit `…/contacts/actions.ts`: delete `setMarketingEmailOptOutAction` with its doc comment, and `setMarketingEmailOptOut` from the `@bis/db` import.

Edit `src/lib/zone.ts`: add `export type ZoneLabel = Pick<ResolvedZone, "zone" | "guessed" | "label">;`. In `src/lib/contacts/summary.ts` and `src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts`, replace `import type { OptOutZone } from "@/lib/contacts/marketing-optout";` with `import type { ZoneLabel } from "@/lib/zone";` and `OptOutZone` with `ZoneLabel`; delete the `marketing_email_opted_out_at` field, its doc comment, its value in the route's JSON, and — in `parseContactSummary` — the `const stamp = …` lines, its return key, and the doc bullet that calls it REQUIRED (the bullet now reads "`tags` and `recent` are REQUIRED …").

Edit `src/lib/messages.ts`: delete the `contact.marketingOptOut.*` keys and their comments (`grep -n "contact.marketingOptOut" apps/web/src/lib/messages.ts`).

Delete the five files listed under Files. `grep -rn "marketing-optout\|MarketingOptOut\|marketingOptOut" apps/web/src apps/web/e2e` must print nothing afterwards (the one comment in `lib/ui/guarded-run.ts` that says it moved from there is reworded to "Moved here from the retired 0049 switch").

Edit `src/app/(dashboard)/dashboard/styleguide/page.tsx`: import `EMAIL_TREATMENT` from `@/lib/consent/email-row`; after the `styleguide-texts-state` block add:
```tsx
          <p className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            …/contacts/email-row.tsx · lib/consent/email-row.ts
          </p>
          <div className="flex flex-wrap items-center gap-2" data-testid="styleguide-email-state">
            <span className="text-sm">{m["contact.messages.email"]}</span>
            <DotPill {...EMAIL_TREATMENT.allowed} dense data-status="allowed" />
            <DotPill {...EMAIL_TREATMENT.stopped} dense data-status="stopped" />
          </div>
```

- [ ] **Step 4: Run to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/email-row.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" src/lib/contacts "src/app/api/accounts/[accountId]/contacts" "src/app/(dashboard)/dashboard/styleguide"
pnpm typecheck
```
Expected (predicted): all pass; the typecheck is clean (the last `setMarketingEmailOptOut` reference is gone).

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `emailLine`: format in `"UTC"` | "each how, and the date in the ACCOUNT's zone" |
| 2 | `parseEmailResponse`: accept `stopped` without `eventId` | "accepts the three views and refuses anything it cannot trust" |
| 3 | email-row.tsx: Stop emails without `variant="ghost"` | "Allowed: … ONE ghost 'Stop emails', no primary" |
| 4 | email-row.tsx: render the Resume button when `!view.canResume` too | "Stopped by the customer: … NO Resume" |
| 5 | email-row.tsx: `showTitle` ignored (always render the label) | "shows the Messages label only when told to" |
| 6 | drawer: keep `<MarketingOptOutSwitch` | the wiring case |
| 7 | page.tsx: drop the try around `readEmailView` | page.test's error case |
| 8 | summary parser: keep the stamp REQUIRED | "the summary no longer carries 0049's column …" |

- [ ] **Step 6: Commit**

```bash
git add -A "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts" apps/web/src/lib/consent/email-row.ts apps/web/src/lib/consent/email-row.test.ts apps/web/src/lib/contacts "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary" apps/web/src/lib/zone.ts apps/web/src/lib/messages.ts apps/web/src/lib/ui/guarded-run.ts "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx" apps/web/e2e/contacts-drawer.spec.ts
git commit -m "feat(consent): the contact's Email row — Stop, Undo and Resume emails — replaces the 0049 'No marketing emails' switch"
```

---

### Task 12: The email composer's notice

**Owner:** bis-comms. **Tier:** HIGH. **Questions:** none (choice 22; G15).

**Files:**
- Modify: `apps/web/src/lib/consent/recipient-state.ts`, `recipient-state.test.ts`
- Modify: `apps/web/src/lib/consent/composer-state.ts`, `composer-state.test.ts`
- Modify: `…/contacts/[contactId]/message-composer.tsx`, `…/contacts/[contactId]/activity-timeline.tsx`
- Modify (on the integration branch, after Task 11's cherry-pick): `…/contacts/[contactId]/page.tsx`, `page.test.ts`

**Interfaces:**
- Consumes: `readConsentState` (`@bis/db`), `emailLedgerAddress` (`@bis/db/email-address`), `formatDateInZone`, the three `compose.email*` lines (Task 4).
- Produces:
  - `type EmailRecipientState = { kind: "ok" } | { kind: "stopped"; since: string; byCustomer: boolean } | { kind: "unknown" }`
  - `emailRecipientState(db, accountId, contact: { email: string | null }): Promise<EmailRecipientState>` — NEVER throws (an unreadable ledger is `unknown`).
  - `composerEmailNotice(state: EmailRecipientState, zone: string): string | null`
  - `MessageComposer` and `ActivityTimeline` gain the prop `emailNoticeLine: string | null`.

**The rule** (spec §6 "The conversation composer", choice 22, G15): when the contact's email is stopped, the EMAIL composer stays usable (a person's reply about their own matter is not automated mail) and shows ONE line above the subject: the spec's "They unsubscribed from your emails on {date}. Write only about something they asked you for." for the customer's own stop (link or one-click), "You stopped emails to them on {date}. …" for a staff or folded stop, and "Couldn't check whether they unsubscribed. …" when the ledger cannot be read. The text composer is untouched.

- [ ] **Step 1: Write the failing tests**

Edit `apps/web/src/lib/consent/composer-state.test.ts`. Add `composerEmailNotice` to its import from `./composer-state`, and append:
```ts
describe("composerEmailNotice — the email composer's one line (spec §6, choice 22, G15)", () => {
  it("no line when they can get email (mutation: always a line → FAILS)", () => {
    expect(composerEmailNotice({ kind: "ok" }, "America/Chicago")).toBeNull();
  });

  it("the customer's own stop: the spec's words with the date in the ACCOUNT's zone (mutation: format in UTC → Oct 4, FAILS)", () => {
    expect(composerEmailNotice({ kind: "stopped", since: "2026-10-04T02:30:00Z", byCustomer: true }, "America/Chicago"))
      .toBe(m["compose.emailUnsubscribed"].replace("{date}", formatDateInZone("2026-10-04T02:30:00Z", "America/Chicago")));
    expect(formatDateInZone("2026-10-04T02:30:00Z", "America/Chicago")).toMatch(/Oct 3/);
  });

  it("a staff or folded stop says 'You stopped', never 'They unsubscribed' (G15; mutation: one line for both → FAILS)", () => {
    expect(composerEmailNotice({ kind: "stopped", since: "2026-10-01T15:00:00Z", byCustomer: false }, "America/Chicago"))
      .toMatch(/^You stopped emails to them on /);
  });

  it("an unreadable state says so, and a date that will not format drops the date rather than throwing in a render (mutation: return null for unknown → the operator is told nothing, FAILS)", () => {
    expect(composerEmailNotice({ kind: "unknown" }, "America/Chicago")).toBe(m["compose.emailStateUnknown"]);
    expect(composerEmailNotice({ kind: "stopped", since: "garbage", byCustomer: true }, "America/Chicago"))
      .toBe("They unsubscribed from your emails. Write only about something they asked you for.");
  });
});
```
(add `import { formatDateInZone } from "@/lib/format";` and `import { m } from "@/lib/messages";` if the file lacks them.)

Edit `apps/web/src/lib/consent/recipient-state.test.ts`. Add `emailRecipientState` to its import and append:
```ts
describe("emailRecipientState — the email composer's read", () => {
  it("reads the contact's LEDGER address on the email channel; a customer's own stop is byCustomer, a staff or folded one is not (mutation: read the raw address → FAILS; mutation: byCustomer always true → FAILS)", async () => {
    db.readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-01T15:00:00Z", method: "one_click", eventId: "e1" });
    expect(await emailRecipientState(CLIENT, "a1", { email: " Ana@Example.com " }))
      .toEqual({ kind: "stopped", since: "2026-10-01T15:00:00Z", byCustomer: true });
    expect(db.readConsentState).toHaveBeenLastCalledWith(CLIENT, "a1", "email", "ana@example.com");
    db.readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-09-01T15:00:00Z", method: "backfill_0049", eventId: "e2" });
    expect(await emailRecipientState(CLIENT, "a1", { email: "ana@example.com" })).toMatchObject({ byCustomer: false });
  });

  it("no address is ok (the composer's own 'no email' line covers it); an unreadable ledger is unknown, never a throw (mutation: rethrow → the contact page errors, FAILS)", async () => {
    expect(await emailRecipientState(CLIENT, "a1", { email: null })).toEqual({ kind: "ok" });
    db.readConsentState.mockRejectedValueOnce(new Error("down"));
    expect(await emailRecipientState(CLIENT, "a1", { email: "ana@example.com" })).toEqual({ kind: "unknown" });
  });
});
```
(the file's own `db` mock and client constant; `grep -n "vi.mock\|const CLIENT\|const DB" apps/web/src/lib/consent/recipient-state.test.ts` — use its names.)

- [ ] **Step 2: Run to see them fail**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/composer-state.test.ts src/lib/consent/recipient-state.test.ts
```
Expected (predicted): the new cases fail to import.

- [ ] **Step 3: Implement**

Edit `apps/web/src/lib/consent/composer-state.ts`. Append:
```ts
/** The email composer's read (recipient-state.ts): who stopped their email, if anyone. */
export type EmailRecipientState =
  | { kind: "ok" }
  | { kind: "stopped"; since: string; byCustomer: boolean }
  | { kind: "unknown" };

/**
 * The ONE line the email composer shows above the subject, or null (spec §6,
 * choice 22; plan G15). The composer stays usable: a person writing about
 * the customer's own matter is not automated mail. The spec's line for the
 * customer's own unsubscribe; "You stopped …" for a staff or folded stop,
 * where "They unsubscribed" would be false. A date that will not format drops
 * the date rather than throwing inside a render.
 */
export function composerEmailNotice(state: EmailRecipientState, zone: string): string | null {
  if (state.kind === "ok") return null;
  if (state.kind === "unknown") return m["compose.emailStateUnknown"];
  const line = state.byCustomer ? m["compose.emailUnsubscribed"] : m["compose.emailStoppedByYou"];
  try {
    return line.replace("{date}", formatDateInZone(state.since, zone));
  } catch {
    return line.replace(" on {date}", "");
  }
}
```

Edit `apps/web/src/lib/consent/recipient-state.ts`. Change the first import to `import { readConsentState, type ConsentMethod, type SupabaseClient } from "@bis/db";`, add `import { emailLedgerAddress } from "@bis/db/email-address";` and change `import type { SmsRecipientState } from "./composer-state";` to `import type { SmsRecipientState, EmailRecipientState } from "./composer-state";`. Append:
```ts
/** The customer's own ways to stop email (choice 19): the composer says "They unsubscribed" for these. */
const CUSTOMER_EMAIL_STOPS: readonly ConsentMethod[] = ["unsubscribe_link", "one_click"];

/**
 * The contact page's read for the EMAIL composer (spec §6, choice 22): the
 * ledger state of the contact's address, under the caller's own client.
 * NEVER throws: a read that fails is `unknown`, which the composer states.
 */
export async function emailRecipientState(
  db: SupabaseClient, accountId: string, contact: { email: string | null },
): Promise<EmailRecipientState> {
  const address = emailLedgerAddress(contact.email);
  if (!address) return { kind: "ok" };
  try {
    const state = await readConsentState(db, accountId, "email", address);
    if (state.state === "allowed") return { kind: "ok" };
    return { kind: "stopped", since: state.since, byCustomer: CUSTOMER_EMAIL_STOPS.includes(state.method) };
  } catch (e) {
    console.error(`composer: email consent state unreadable for account ${accountId}: ${loggableError(e)}`);
    return { kind: "unknown" };
  }
}
```

Edit `…/contacts/[contactId]/message-composer.tsx`:
1. Add `emailNoticeLine,` to the destructured props (after `smsBlockedLine,`) and to the props type:
```ts
  // The email composer's one line (spec §6, choice 22): set when the
  // contact's email is stopped. The form STILL shows — a person replying
  // about their own matter is not automated mail.
  emailNoticeLine: string | null;
```
2. Find:
```tsx
          {isEmail ? (
            <Input name="subject" placeholder={m["compose.subject"]} className="text-sm" />
          ) : null}
```
Replace with:
```tsx
          {isEmail && emailNoticeLine ? (
            <p role="note" className="text-xs text-muted-foreground" data-testid="composer-email-notice">{emailNoticeLine}</p>
          ) : null}
          {isEmail ? (
            <Input name="subject" placeholder={m["compose.subject"]} className="text-sm" />
          ) : null}
```

Edit `…/contacts/[contactId]/activity-timeline.tsx`: add `emailNoticeLine` to its props (the same type and a one-line doc: "The email composer's notice, decided on the server (consent PR-3).") and pass `emailNoticeLine={emailNoticeLine}` to `<MessageComposer … />` next to `smsBlockedLine={smsBlockedLine}`. Every test that renders `ActivityTimeline` or `MessageComposer` gains `emailNoticeLine: null` in its props (`grep -rln "ActivityTimeline\|MessageComposer" apps/web/src --include=*.test.ts`).

**On the integration branch, after Task 11's cherry-pick** (Checkpoint D), edit `…/contacts/[contactId]/page.tsx`: add `emailRecipientState` to its import from `@/lib/consent/recipient-state` and `composerEmailNotice` to its import from `@/lib/consent/composer-state`; next to the SMS recipient read add `const emailRecipient = await emailRecipientState(db, accountId, contact);`; and on `<ActivityTimeline … />`, after `smsBlockedLine={…}`, add `emailNoticeLine={composerEmailNotice(emailRecipient, zone.zone)}`. In `page.test.ts`, mock `emailRecipientState` (resolving `{ kind: "stopped", since: "2026-10-01T15:00:00Z", byCustomer: true }` in one case) and assert the `ActivityTimeline` props carry the spec's line (mutation: pass `null` → FAILS).

- [ ] **Step 4: Run to see them pass**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/composer-state.test.ts src/lib/consent/recipient-state.test.ts "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]"
```
Expected (predicted): all pass (the page step's case at Checkpoint D).

- [ ] **Step 5: Probes**

| # | Mutation | Must fail |
|---|---|---|
| 1 | `composerEmailNotice`: format in `"UTC"` | "the customer's own stop: the spec's words with the date in the ACCOUNT's zone" |
| 2 | `composerEmailNotice`: always `m["compose.emailUnsubscribed"]` | "a staff or folded stop says 'You stopped' …" |
| 3 | `composerEmailNotice`: `unknown` → `null` | "an unreadable state says so …" |
| 4 | `emailRecipientState`: read `contact.email` raw | "reads the contact's LEDGER address …" |
| 5 | `emailRecipientState`: rethrow in the catch | "no address is ok …; an unreadable ledger is unknown" |
| 6 | page.tsx: `emailNoticeLine={null}` | page.test's notice case |

The rendered notice itself (the `composer-email-notice` line above the subject, with the form still usable) is proven in the e2e (Task 14), where the composer's mode switch can be clicked.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/consent/recipient-state.ts apps/web/src/lib/consent/recipient-state.test.ts apps/web/src/lib/consent/composer-state.ts apps/web/src/lib/consent/composer-state.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]"
git commit -m "feat(consent): the email composer says when they unsubscribed, and still lets staff reply"
```

---

### Task 13: The source scans for PR-3

**Owner:** bis-reviewer drafts, bis-comms applies (on the integration branch). **Tier:** HIGH. **Questions:** none.

**Files:**
- Modify: `apps/web/src/lib/consent/scans.test.ts`

**What it pins** (spec §8 "Source scans", PR-3's share; each with a positive control, each reading code with comments stripped through the file's own `code()`):
1. **scan 1 for email:** outside `lib/email/index.ts`, `resend.ts`, `fake.ts` and `lib/consent/email-gate.ts`, no source file imports the email factory module, the Resend or fake provider, or the `resend` package, or names `getEmailProvider` / `resendEmailProvider` / `fakeEmailProvider`; only `resend.ts` imports the `resend` package; no file names `api.resend.com`; the email gate re-exports nothing of the factory;
2. **scan 2, finished:** every kind literal in a gate caller is in one of the two registries, and the scan sees all 36 kinds (14 SMS + 22 email);
3. **the email kinds' sites:** each of the 22 email kinds is named in exactly the file(s) the send-site table gives, and nowhere else but the registry (a kind moved to another path is a classification change, argued in review);
4. **scan 4 (spec §8, item 4):** the `customer_initiated` email kinds are named only in `app/b/[publicId]/actions.ts`, `lib/forms/enrich.ts` and `lib/voice/tools/registry.ts`, never under `lib/automations/`;
5. **scan 5, the column:** nothing in `apps/web/src` or `packages/db/src` names `marketing_email_opted_out_at`, `setMarketingEmailOptOut` or `contactMarketingEmailOptedOut`;
6. **the customer's own stop has one writer:** only `lib/consent/unsubscribe.ts` both calls the ledger's write and names `one_click`, `unsubscribe_link` or `unsubscribe_page`;
7. **no token in a log line:** in the five files that hold a token, no `console.*(…)` call's arguments name `token`.

- [ ] **Step 1: Write the scans**

Edit `apps/web/src/lib/consent/scans.test.ts`. Find:
```ts
import { SMS_KINDS, EMAIL_KINDS } from "./classes";
```
Replace with:
```ts
import { SMS_KINDS, EMAIL_KINDS, type EmailKind } from "./classes";
```
In its header comment, after the PR-2 paragraph, add:
```ts
 *
 * PR-3 adds, for email: scan 1 (only the email gate reaches an email
 * provider), scan 2 over both registries, each email kind's own send site,
 * scan 4 (the customer-initiated email kinds only where the customer acted),
 * scan 5's retired 0049 column, one writer of the customer's own email stop,
 * and no token in any log line.
```
Replace the scan 2 positive control Task 4 left:
```ts
  it("the scan reaches every SMS send path's kind — none of the fourteen is missing (the positive control; Task 13 adds the email kinds once every site is routed)", () => {
    const seen = new Set(kindLiterals().map(({ kind }) => kind));
    expect([...seen]).toEqual(expect.arrayContaining(Object.keys(SMS_KINDS)));
  });
```
with:
```ts
  it("the scan reaches every send path's kind — all fourteen SMS kinds and all twenty-two email kinds (the positive control; mutation: a site stops naming its kind → FAILS)", () => {
    const seen = new Set(kindLiterals().map(({ kind }) => kind));
    expect([...seen].sort()).toEqual([...new Set([...Object.keys(SMS_KINDS), ...Object.keys(EMAIL_KINDS)])].sort());
  });
```
Append at the end of the file:
```ts
const EMAIL_GATE = join(WEB_SRC, "lib", "consent", "email-gate.ts");
const DASH = "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]";
const PASSES = "apps/web/src/lib/automations/passes";

describe("scan 1 (email): only the email gate reaches an email provider (consent PR-3)", () => {
  const PROVIDER_MODULES = new Set([
    "apps/web/src/lib/email/index.ts", "apps/web/src/lib/email/resend.ts", "apps/web/src/lib/email/fake.ts",
    "apps/web/src/lib/consent/email-gate.ts",
  ]);
  const PROVIDER_IDS = new Set(["apps/web/src/lib/email", "apps/web/src/lib/email/resend", "apps/web/src/lib/email/fake"]);
  const NAMES = /\bgetEmailProvider\b|\bresendEmailProvider\b|\bfakeEmailProvider\b/;
  const RESEND_PACKAGE = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'`]resend["'`]/;

  it("no source file outside lib/email's provider modules and the email gate imports the factory module, a provider or the resend package, or names them — by ANY path (mutation: import getEmailProvider back into the harness or a pass, or `../../lib/email` from a route → FAILS naming it)", () => {
    const offenders = webSources().filter((f) => !PROVIDER_MODULES.has(rel(f))).filter((f) => {
      const src = code(f);
      return NAMES.test(src) || RESEND_PACKAGE.test(src) || importsOf(f, src).some((m) => PROVIDER_IDS.has(m));
    }).map(rel);
    expect(offenders).toEqual([]);
  });

  it("the email gate does reach the factory (the positive control: the scan can see an import)", () => {
    expect(code(EMAIL_GATE)).toMatch(NAMES);
    expect(importsOf(EMAIL_GATE)).toContain("apps/web/src/lib/email");
  });

  it("only lib/email/resend.ts imports the resend package, and nothing names Resend's API host: no raw fetch around the gate (mutation: fetch https://api.resend.com/emails from a pass → FAILS naming it)", () => {
    expect(webSources().filter((f) => RESEND_PACKAGE.test(code(f))).map(rel)).toEqual(["apps/web/src/lib/email/resend.ts"]);
    expect(webSources().filter((f) => /api\.resend\.com/.test(code(f))).map(rel)).toEqual([]);
  });

  it("the email gate re-exports nothing of the factory, so nothing reaches the provider THROUGH it (mutation: export { getEmailProvider } from the gate → FAILS)", () => {
    const src = code(EMAIL_GATE);
    expect(src.match(/export\s*(?:\*|\{[^}]*\})\s*from\s*["'`](?:@\/lib\/email(?:\/index)?|\.\.\/email(?:\/index)?)["'`]/g) ?? []).toEqual([]);
    expect(src.match(/export\s*\{[^}]*\b(?:getEmailProvider|resendEmailProvider|fakeEmailProvider)\b[^}]*\}/g) ?? []).toEqual([]);
    expect(src).not.toMatch(/export\s+(?:const|let|var)\s+\w+\s*=\s*(?:getEmailProvider|resendEmailProvider|fakeEmailProvider)\b/);
  });
});

describe("the email kinds' own send sites (spec §4.3's table, E1)", () => {
  /** Each email kind, where it may be named (besides the registry). */
  const SITES: Record<EmailKind, readonly string[]> = {
    "booking.confirmation": ["apps/web/src/app/b/[publicId]/actions.ts"],
    "forms.receipt": ["apps/web/src/lib/forms/enrich.ts"],
    "voice.booked": ["apps/web/src/lib/voice/tools/registry.ts"],
    "voice.moved": ["apps/web/src/lib/voice/tools/registry.ts"],
    "voice.cancelled": ["apps/web/src/lib/voice/tools/registry.ts"],
    "automation.reminder": [`${PASSES}/reminders.ts`],
    "automation.followup": [`${PASSES}/followups.ts`],
    "automation.review_request": [`${PASSES}/review-request.ts`],
    "automation.referral_ask": [`${PASSES}/referral-ask.ts`],
    "automation.reactivation": [`${PASSES}/reactivation.ts`],
    "automation.quote_followup": [`${PASSES}/quote-followup.ts`],
    "automation.no_show_nudge": [`${PASSES}/no-show-nudge.ts`],
    "staff.composer_email": [`${DASH}/conversations/actions.ts`],
    "operator.booking_alert": ["apps/web/src/app/b/[publicId]/actions.ts"],
    "operator.cancel_notice": ["apps/web/src/app/b/[publicId]/cancel/[token]/actions.ts"],
    "operator.lead_alert": ["apps/web/src/lib/forms/enrich.ts"],
    "operator.call_alert": ["apps/web/src/lib/voice/finish-call.ts"],
    "operator.phone_change_alert": ["apps/web/src/lib/voice/tools/registry.ts"],
    "operator.weekly_report": [`${PASSES}/weekly-report.ts`],
    "operator.agency_report": [`${PASSES}/weekly-agency-report.ts`],
    "operator.billing_link": [`${DASH}/settings/billing-actions.ts`],
    "operator.sender_check": [`${DASH}/settings/actions.ts`],
  };
  const REGISTRY = "apps/web/src/lib/consent/classes.ts";

  it("the table covers every email kind (mutation: add a kind to the registry without a site → FAILS)", () => {
    expect(Object.keys(SITES).sort()).toEqual(Object.keys(EMAIL_KINDS).sort());
  });

  it.each(Object.entries(SITES))("%s is named in exactly %j, and nowhere else but the registry (mutation: a pass sends kind \"booking.confirmation\" → that pass's file is listed, FAILS)", (kind, sites) => {
    const literal = new RegExp(`["'\`]${kind.replace(/\./g, "\\.")}["'\`]`);
    const naming = webSources().filter((f) => rel(f) !== REGISTRY && literal.test(code(f))).map(rel).sort();
    expect(naming).toEqual([...sites].sort());
  });
});

describe("scan 4: the customer-initiated email kinds only where the customer acted (spec §8 item 4)", () => {
  const CUSTOMER_INITIATED = Object.entries(EMAIL_KINDS).filter(([, s]) => s.class === "customer_initiated").map(([k]) => k);
  const ALLOWED = new Set([
    "apps/web/src/app/b/[publicId]/actions.ts", "apps/web/src/lib/forms/enrich.ts", "apps/web/src/lib/voice/tools/registry.ts",
    "apps/web/src/lib/consent/classes.ts",
  ]);

  it("the class holds exactly the five kinds of spec §4.3 as corrected (the positive control; mutation: classify automation.reminder as customer_initiated → FAILS)", () => {
    expect(CUSTOMER_INITIATED.sort()).toEqual(["booking.confirmation", "forms.receipt", "voice.booked", "voice.cancelled", "voice.moved"]);
  });

  it("no file outside the booking page, the form's enrich step and the voice tools names one, and nothing under lib/automations does (mutation: the reminder pass sends kind \"booking.confirmation\" → FAILS naming it)", () => {
    const literal = new RegExp(`["'\`](?:${CUSTOMER_INITIATED.map((k) => k.replace(/\./g, "\\.")).join("|")})["'\`]`);
    const naming = webSources().filter((f) => literal.test(code(f))).map(rel);
    expect(naming.filter((f) => !ALLOWED.has(f))).toEqual([]);
    expect(naming.filter((f) => f.startsWith("apps/web/src/lib/automations/"))).toEqual([]);
    expect(naming.sort()).toEqual([...ALLOWED].sort());
  });
});

describe("scan 5 (PR-3): nothing reads 0049's retired column", () => {
  const COLUMN = /\bmarketing_email_opted_out_at\b|\bsetMarketingEmailOptOut\b|\bcontactMarketingEmailOptedOut\b|\bMarketingOptOutSwitch\b/;

  it("no source file in apps/web/src or packages/db/src names it (spec §4.3; mutation: put `.is(\"contacts.marketing_email_opted_out_at\", null)` back in the reactivation walk → FAILS naming automations.ts)", () => {
    expect([...webSources(), ...dbSources()].filter((f) => COLUMN.test(code(f))).map(rel)).toEqual([]);
  });

  it("the scan can see the column where it still exists: 0049 and the fold's SQL (the positive control)", () => {
    for (const p of [["migrations", "0049_contacts_marketing_email_optout.sql"], ["backfills", "0049-fold-write.sql"]]) {
      expect(readFileSync(join(REPO, "packages", "db", "supabase", ...p), "utf-8")).toMatch(COLUMN);
    }
  });
});

describe("the customer's own email stop has one writer (consent PR-3)", () => {
  const WRITES = /\bappendConsentEvent(?:Guarded)?\b/;
  const CUSTOMER_METHODS = /["'`](?:one_click|unsubscribe_link|unsubscribe_page)["'`]/;

  it("only lib/consent/unsubscribe.ts both writes the ledger and names one_click, unsubscribe_link or unsubscribe_page (it is also the positive control; mutation: the Email row's staff action writes method \"unsubscribe_link\" → FAILS naming it)", () => {
    expect(webSources().filter((f) => { const src = code(f); return WRITES.test(src) && CUSTOMER_METHODS.test(src); }).map(rel))
      .toEqual(["apps/web/src/lib/consent/unsubscribe.ts"]);
  });
});

describe("no token in a log line (spec §5 'Privacy')", () => {
  const FILES = [
    "lib/consent/unsubscribe.ts", "lib/consent/email-gate.ts", "app/api/unsubscribe/[token]/route.ts",
    "app/u/[token]/page.tsx", "app/u/[token]/actions.ts",
  ];
  const LOGS_TOKEN = /\bconsole\.\w+\((?:[^()]|\([^()]*\))*\btoken\b/;

  it("the five files that hold a token never pass it to console (mutation: log `unsubscribe failed for ${token}` in the route → FAILS naming it)", () => {
    expect(FILES.filter((p) => LOGS_TOKEN.test(code(join(WEB_SRC, p))))).toEqual([]);
  });

  it("the pattern sees a token in a log call and ignores the variable's name in a message (the positive control)", () => {
    expect(LOGS_TOKEN.test(code("probe.ts", "console.error(`bad ${token}`);"))).toBe(true);
    expect(LOGS_TOKEN.test(code("probe.ts", "console.error(\"CONSENT_TOKEN_SECRET is not set\");"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the scans**

```bash
cd apps/web
pnpm exec vitest run src/lib/consent/scans.test.ts
```
Expected (predicted): all pass on the integration branch (Tasks 1–12 in).

- [ ] **Step 3: Probes** (each must turn the named scan red; revert after each)

| # | Mutation | Must fail |
|---|---|---|
| 1 | `lib/automations/harness.ts` imports `getEmailProvider` from `@/lib/email` | scan 1 (email), naming harness.ts; imports.test too |
| 2 | a route imports `{ getEmailProvider }` from `"../../../../lib/email"` | scan 1 (email), by the resolved path |
| 3 | `lib/automations/passes/reminders.ts` sends kind `"booking.confirmation"` | the sites case for booking.confirmation; scan 4 |
| 4 | `lib/automations/passes/reminders.ts`: `kind: "automation.reminders"` | scan 2 "each kind literal … is a key of one of the two registries" |
| 5 | email-gate.ts adds `export { getEmailProvider } from "@/lib/email";` | "the email gate re-exports nothing of the factory" |
| 6 | `packages/db/src/automations.ts`: put `.is("contacts.marketing_email_opted_out_at", null)` back | scan 5 (PR-3), naming automations.ts |
| 7 | email-staff-actions.ts's `stopEmails` writes `method: "unsubscribe_link"` | "the customer's own email stop has one writer" |
| 8 | the one-click route logs `` `refused ${token}` `` | "no token in a log line" |
| 9 | classes.ts: `automation.reminder` class → `customer_initiated` | scan 4's positive control |
| 10 | a pass does `await fetch("https://api.resend.com/emails", …)` | "… nothing names Resend's API host" |

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/consent/scans.test.ts
git commit -m "test(consent): PR-3's source scans — one email gate, every email kind at its own site, the 0049 column gone, one writer of the customer's stop, no token logged"
```

---

### Task 14: e2e on the fixture account: the page, one-click, the Email row, the composer's notice

**Owner:** bis-e2e-qa (and bis-platform for the one `ci.yml` line). **Tier:** HIGH. **Questions:** [Q1] (the page's first step).

**Files:**
- Create: `apps/web/e2e/consent-email.spec.ts`
- Modify: `.github/workflows/ci.yml` (the `e2e` job's `env:` block: one NON-secret literal)

**Interfaces:**
- Consumes: `sealConsentToken` (Task 3, imported from `../src/lib/consent/token`); `serviceDb`, `createContact` (`@bis/db`); the page (Task 9), the Email row (Tasks 10–11), the composer's notice (Task 12); `m` copy (Task 4).
- Produces: nothing.

**Spec §8's e2e lines for PR-3, on the per-run fixture account only (never Test Client One):** "`/u/{token}` for a fixture contact shows the unsubscribed page, and Resubscribe restores it"; "the one-click POST returns 200". Plus (G16): no `Set-Cookie` and no redirect on the POST (A3), a 400 for a bad token, the drawer's Email row after each, staff Stop / Undo / Resume, and the composer's notice.

- [ ] **Step 1: The CI literal**

Edit `.github/workflows/ci.yml`. In the `e2e` job's `env:` block, after the `TELNYX_PUBLIC_KEY: …` line, add:
```yaml
      # NOT a secret: a fixed literal the e2e server seals its unsubscribe
      # links with, and e2e/consent-email.spec.ts mints its tokens with, so
      # the spec can open /u/<token> and POST the one-click endpoint.
      # Production's CONSENT_TOKEN_SECRET is set on Vercel Production only
      # (consent PR-3 plan, Task 15) and is a different value.
      CONSENT_TOKEN_SECRET: bis_ci_e2e_consent_token_fixture_only
```

- [ ] **Step 2: Write the spec**

Create `apps/web/e2e/consent-email.spec.ts`:
```ts
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, createContact } from "@bis/db";
import { sealConsentToken } from "../src/lib/consent/token";
import { m } from "../src/lib/messages";

loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

/**
 * Consent chain PR-3 end to end (spec §8's two email lines, plan G16), ON
 * THE PER-RUN FIXTURE ACCOUNT ONLY (never Test Client One, CLAUDE.md):
 *   1. /u/<token>: [Q1] the question and one Unsubscribe; the click records
 *      the stop; the drawer's Email row says "unsubscribe link" and offers no
 *      Resume; Resubscribe lifts it;
 *   2. the RFC 8058 one-click POST: 200, empty, no cookie, no redirect; a bad
 *      token 400; the GET redirects to the page;
 *   3. staff Stop emails with Undo, and Resume with a required note;
 *   4. the email composer's notice after an unsubscribe, the form still there.
 * Its own contacts, deleted in afterAll; the ledger rows stay (append-only,
 * contact_id null for the customer's own rows) until the fixture account is
 * swept.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

type ClientFixture = { accountId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE} — run the full suite`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};

const ACTOR = "e2e-consent-email";
const STAMP = Date.now().toString();
const made: { contacts: string[]; brand: string | null } = { contacts: [], brand: null };
const address = (who: string) => `e2e-${who}-${STAMP}@example.com`;
const SECRET = process.env.CONSENT_TOKEN_SECRET ?? "";
const tokenFor = (contactId: string, who: string) => sealConsentToken({
  v: 1, a: fixture().accountId, c: "email", t: address(who), i: Date.now(), n: contactId, k: "automation.reminder",
}, SECRET);

test.beforeAll(async () => {
  if (!SECRET) {
    const why = "CONSENT_TOKEN_SECRET is not set for this run (ci.yml's e2e job sets a fixture literal)";
    console.warn(`::warning title=consent-email.spec.ts skipped::${why}`);
    test.skip(true, why);
  }
  const { accountId } = fixture();
  const db = serviceDb();
  for (const who of ["page", "click", "staff", "composer"]) {
    made.contacts.push((await createContact(db, accountId, { firstName: who, lastName: STAMP, email: address(who) }, ACTOR)).id);
  }
  const { data } = await db.from("accounts").select("brand_name").eq("id", accountId).single();
  made.brand = (data as { brand_name: string | null } | null)?.brand_name ?? null;
});

test.afterAll(async () => {
  const db = serviceDb();
  for (const id of made.contacts) {
    const { error } = await db.from("contacts").delete().eq("id", id);
    if (error) console.error(`consent-email e2e: contact cleanup failed (the fixture sweep takes it): ${error.message}`);
  }
});

/** The newest deciding email row for an address, read as the service role. */
async function newestEmailRow(who: string): Promise<{ action: string; method: string } | null> {
  const { data, error } = await serviceDb().from("consent_events")
    .select("action, method, occurred_at, id")
    .eq("account_id", fixture().accountId).eq("channel", "email").eq("address", address(who))
    .in("action", ["revoked", "held", "hold_released", "resubscribed"])
    .order("occurred_at", { ascending: false }).order("id", { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const r = data?.[0] as { action: string; method: string } | undefined;
  return r ? { action: r.action, method: r.method } : null;
}

async function openEmailRow(page: import("@playwright/test").Page, who: string) {
  const { accountId } = fixture();
  await page.goto(`/dashboard/accounts/${accountId}/contacts?q=${STAMP}`);
  await page.getByRole("row").filter({ hasText: `${who} ${STAMP}` }).first().click();
  return page.getByRole("dialog").getByTestId("email-row");
}

test("the unsubscribe link: the question, one click records it, the drawer says so, and Resubscribe lifts it", async ({ page, browser }) => {
  const token = tokenFor(made.contacts[0]!, "page");
  // A fresh context: the page is public, and a customer is never signed in.
  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const cpage = await customer.newPage();
  await cpage.goto(`/u/${token}`);
  const section = cpage.getByTestId("unsubscribe");
  await expect(section).toHaveAttribute("data-state", "allowed");                                   // [Q1]
  await expect(section).toContainText(`Stop emails from ${made.brand}?`);
  await expect(section).toContainText(`¿Dejar de recibir correos de ${made.brand}?`);
  expect(await newestEmailRow("page")).toBeNull();                                                   // nothing on GET [Q1]
  await cpage.getByRole("button", { name: m["unsubscribe.button"] }).click();
  await expect(section).toHaveAttribute("data-state", "stopped");
  await expect(section).toContainText(`${made.brand} won't send you any more automated emails.`);
  expect(await newestEmailRow("page")).toEqual({ action: "revoked", method: "unsubscribe_link" });

  const row = await openEmailRow(page, "page");
  await expect(row).toHaveAttribute("data-state", "stopped");
  await expect(row).toContainText("unsubscribe link");
  await expect(row).toContainText(m["contact.email.customerOnly"]);
  await expect(row.getByRole("button", { name: m["contact.email.resume"] })).toHaveCount(0);   // choice 19

  await cpage.getByRole("button", { name: m["unsubscribe.resubscribe"] }).click();
  await expect(section).toHaveAttribute("data-state", "resubscribed");
  await expect(section).toContainText(`You'll get emails from ${made.brand} again.`);
  expect(await newestEmailRow("page")).toEqual({ action: "resubscribed", method: "unsubscribe_page" });
  await customer.close();
});

test("the one-click POST: 200, empty, no cookie, no redirect; a bad token 400; the GET lands on the page", async ({ request }) => {
  const token = tokenFor(made.contacts[1]!, "click");
  const res = await request.post(`/api/unsubscribe/${token}`, {
    form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0,
  });
  expect(res.status()).toBe(200);
  expect(await res.text()).toBe("");
  expect(res.headers()["set-cookie"]).toBeUndefined();                                              // A3
  expect(res.headers()["location"]).toBeUndefined();
  expect(await newestEmailRow("click")).toEqual({ action: "revoked", method: "one_click" });
  // A second POST is still 200 and writes nothing new (the guard: no second row).
  expect((await request.post(`/api/unsubscribe/${token}`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 })).status()).toBe(200);
  const bad = await request.post(`/api/unsubscribe/1.forged.token`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
  expect(bad.status()).toBe(400);
  const get = await request.get(`/api/unsubscribe/${token}`, { maxRedirects: 0 });
  expect(get.status()).toBe(303);
  expect(get.headers()["location"]).toMatch(new RegExp(`/u/${token.replace(/[.]/g, "\\.")}$`));
});

test("staff Stop emails runs at once with Undo; Resume needs a note and then lifts the stop", async ({ page }) => {
  const row = await openEmailRow(page, "staff");
  await expect(row).toHaveAttribute("data-state", "allowed");
  await row.getByRole("button", { name: m["contact.email.stopEmails"] }).click();
  await expect(row).toHaveAttribute("data-state", "stopped");
  await expect(page.getByTestId("email-row-status")).toBeFocused();
  const toast = page.getByText(m["contact.email.stoppedToast"]);
  await expect(toast).toBeVisible();
  await page.getByRole("button", { name: m["common.undo"] }).click();
  await expect(row).toHaveAttribute("data-state", "allowed");
  expect(await newestEmailRow("staff")).toEqual({ action: "resubscribed", method: "staff_undo" });

  await row.getByRole("button", { name: m["contact.email.stopEmails"] }).click();
  await expect(row).toHaveAttribute("data-state", "stopped");
  await row.getByRole("button", { name: m["contact.email.resume"] }).click();
  const form = page.getByTestId("email-resume-form");
  await expect(form.getByRole("button", { name: m["contact.email.resumeSubmit"] })).toBeDisabled();
  await form.getByLabel(m["contact.email.resumeNoteLabel"]).fill("They asked on the phone to get reminders again");
  await form.getByRole("button", { name: m["contact.email.resumeSubmit"] }).click();
  await expect(row).toHaveAttribute("data-state", "allowed");
  expect(await newestEmailRow("staff")).toEqual({ action: "resubscribed", method: "staff" });
});

test("after an unsubscribe, the email composer says so and still lets staff write", async ({ page, request }) => {
  const contactId = made.contacts[3]!;
  await request.post(`/api/unsubscribe/${tokenFor(contactId, "composer")}`, { form: { "List-Unsubscribe": "One-Click" }, maxRedirects: 0 });
  await page.goto(`/dashboard/accounts/${fixture().accountId}/contacts/${contactId}`);
  await page.getByRole("button", { name: m["compose.email"], exact: true }).click();
  await expect(page.getByTestId("composer-email-notice")).toContainText("They unsubscribed from your emails on");
  await expect(page.getByPlaceholder(m["compose.subject"])).toBeVisible();                           // choice 22
});
```

**[Q1] If danlo keeps decision 6 literally:** the first test's first `data-state` is `stopped` straight away, `newestEmailRow("page")` is the `unsubscribe_link` row before any click, and the Unsubscribe click is removed.

- [ ] **Step 3: Run it** — in CI only (local e2e refuses while env files point at production, #135). Push happens in Task 15 step 2; this task commits.

Expected (predicted), in CI's `e2e` job: `consent-email.spec.ts` 4 passed; `contacts-drawer.spec.ts` green without its removed switch case; every other spec unchanged.

- [ ] **Step 4: Probes** (applied on the branch and pushed ONLY if the orchestrator runs a probe CI round; otherwise recorded as prescriptions)

| # | Mutation | Must fail |
|---|---|---|
| 1 | page.tsx records on GET (the [Q1] alternative) | test 1 (`newestEmailRow` not null before the click) |
| 2 | route POST answers `303` to `/u/…` | test 2 (`status` 200, no `location`) |
| 3 | email-row.tsx: Stop emails without the Undo (`withUndo` false) | test 3 (no Undo button) |
| 4 | message-composer: drop the notice | test 4 |

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/consent-email.spec.ts .github/workflows/ci.yml
git commit -m "test(consent): e2e on the fixture account — the unsubscribe page, one-click, the Email row, the composer's notice"
```

---

### Task 15: Gates, the secret, the fold count, the fold write, merge, the delta fold, the go-live check, handoff

**Owner:** the orchestrator, with bis-e2e-qa for the gates. **Nothing here is an implementer step.** Every production READ, every production write, the Vercel secret and the merge need danlo's explicit go; ask with choice tiles (memory `bis-choice-tiles`). Record each step's result in the ledger (`.superpowers/sdd/progress.md`).

**The order, and why:** branch complete → CI green on the head SHA → **the fold count** (danlo sees it: Q7) → **the secret** (the merged build refuses to send any customer email in production without it) → **the fold write, BEFORE the merge** (the merged build no longer reads 0049's column, so a stop not yet in the ledger at the deploy would be ignored from the first request) → merge → deploy check → **the delta fold** (the old build's switch could still change the column until the deploy) → the go-live check.

**Ordering hazard, analysed (the PR-2 choice-19 lesson):** the fold's rows are dated in the PAST (each opt-out's own time). 0055's `backfill_0049` rule appends one only while the address is ALLOWED (no deciding row, or a lift), so:
- before the merge, nothing writes email deciding rows (no build before PR-3 has an email stop, an unsubscribe or an email staff action; PR-2's form grants are `granted`, which never decides): the pre-flight read in step 3 must show `already_stopped_or_decided = 0`, and every fold row lands as the address's only deciding row — the state the 0049 switch meant;
- after the merge (the delta run), an address with a later customer unsubscribe or staff stop is STOPPED → the fold row is refused (the stop already stands); an address the customer (or staff) lifted since is ALLOWED → the fold row is appended but OLDER than the lift, so the lift stays the newest row and the state stays allowed — the customer's later act wins, as it should. No past-dated row can ever become the newest over a later act; that is the hazard PR-2's Telnyx import had to avoid by timing, and here the rule itself avoids it. The delta run is still done at once after the deploy, so the window for a missed stop is minutes.
- the one residual: a contact the operator UN-ticked in the old build between steps 5 and 7 was folded as stopped. Step 8's second read counts them; staff can Resume a `backfill_0049` stop (choice 19).

- [ ] **Step 1: The branch is complete.** On `feat/consent-pr3` after Checkpoint D and Tasks 13–14: `pnpm install --frozen-lockfile --prefer-offline`; both typechecks; `pnpm --filter web lint` (0 errors); the full web suite (the two env suites only); the db suite on the replica's `post`, parent vs head, JSON reporter, per-test diff (no pass→fail; the CI-only files the only failures). `git log --oneline main..feat/consent-pr3` shows the spec commit, the plan commit, a `main` merge if one was needed, and one commit per task. Then `pnpm --filter web build` and the browser-bundle check (the token's crypto stays on the server; `bis-consent-token` is its HKDF salt, a string only `token.ts` holds): `grep -rl "bis-consent-token" apps/web/.next/server | wc -l` ≥ 1 and `grep -rl "bis-consent-token" apps/web/.next/static | wc -l` = 0. If D7 is done, bis-design-reviewer audits the `/u/[token]` page (a sealed test token, both a branded and an unbranded account, 375 px, the button's focus ring, the Spanish lines) and the Email row (dark and light through `.dark`, the blur fallback); otherwise that is danlo's eyeball after the deploy (step 9).

- [ ] **Step 2: Push, and CI green on the head SHA.** Push the branch (the first push; the pre-push hook runs). There is NO migration: nothing goes to the CI project. Read the check runs FOR THE HEAD SHA:
```bash
SHA=$(git rev-parse feat/consent-pr3)
gh api "repos/{owner}/{repo}/commits/$SHA/check-runs" --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'
```
Expected: `verify` and `e2e` both `completed` / `success`. In `verify`'s log: `email-optout-fold.test.ts` 4 passed on the CI project; `automations.test.ts`'s three reactivation cases and the referral case passed (Task 1's CI-only probes 8 and 9 are applied in a probe round only if the orchestrator runs one). In `e2e`'s: `consent-email.spec.ts` 4 passed.

- [ ] **Step 3: The fold count — production READ, under danlo's go.** Through the Supabase MCP `execute_sql` on `tlbkbmlrfafquucsmsmm`, paste `packages/db/supabase/backfills/0049-fold-count.sql` exactly. It answers one row. Then this read, which must be `0` (the ordering hazard above):
```sql
select count(*) from public.consent_events
 where channel = 'email' and action in ('revoked', 'held', 'hold_released', 'resubscribed');
```
Report to danlo, as Q7 says: `opted_out_contacts`, `to_fold_addresses` (the rows the write will append), `accounts`, `with_a_booking_in_30_days` (their reminders will stop), `other_contacts_sharing_an_address` (they stop too), `left_out_needs_a_look` (staff stop those by hand from the Email row after the merge), `future_stamps` (must be 0; if not, STOP: 0055 raises on a future time and the whole write would fail), and `can_write` (must be `true`; if not, STOP and re-plan the write's role). No customer is named anywhere in this output.

- [ ] **Step 4: The secret — danlo's go (one go covers steps 4 to 8).** In the repo root, with the Vercel CLI linked to the web project:
  1. `vercel env ls production` — confirm the NAME `APP_ORIGIN` is listed (never print values). If it is missing, STOP: every customer email would be blocked `unsubscribe_unavailable` (G8) wherever the request carries no origin (every cron tick).
  2. Generate and add in one pipe, never echoed, never written to a file (memory `bis-env-secret-reads`):
```bash
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | vercel env add CONSENT_TOKEN_SECRET production
```
  3. `vercel env ls production` lists `CONSENT_TOKEN_SECRET`. Nothing redeploys: the live build does not read it; the merge's deploy will. Do NOT add it to Preview or Development (G8).

- [ ] **Step 5: The fold write — production, BEFORE the merge.** Paste `packages/db/supabase/backfills/0049-fold-write.sql` into `execute_sql` exactly (no backslash: `sql-files.test.ts` pins it; no transaction control; ONE statement). Expected: one row per outcome, `appended` = step 3's `to_fold_addresses` minus any address a customer already stopped (none, by step 3's zero), `refused` = 0, no `duplicate`. **Run it a second time** to prove idempotence: every `appended` now answers `duplicate`, total unchanged, nothing appended. If the count is above about 1,000, split the statement by account (`where c.account_id = any(…)` on the `opted` CTE) before running it (PR-2 review R1-N7: one advisory lock per row inside one statement). Ledger line: `0049 FOLD WRITTEN — PROD <date> — appended N — re-run duplicate N`.

- [ ] **Step 6: Merge, under the same go.** Squash-merge through GitHub only after steps 2–5 (the ruleset requires `verify` and `e2e` green on the head SHA; the policy is non-strict, so if `main` moved since step 2, merge `main` in, re-run, and re-read the head SHA's check runs).

- [ ] **Step 7: Deploy check.** The Vercel deployment is READY and its logs are clean; the cron's next tick is 200 and its JSON shows no email `held` with the reason "the unsubscribe link couldn't be added" (that reason means the secret or the origin is missing: STOP and fix before anything else); open any contact on production as the agency — the Email row renders (Allowed, or Stopped "you marked them “No marketing emails”" for a folded contact, with Resume); `curl -si https://app.bis-rgv.com/u/1.bad.token` shows the "This unsubscribe link doesn't work" page; `curl -si -X POST https://app.bis-rgv.com/api/unsubscribe/1.bad.token` answers `400` with no `set-cookie` header (A3).

- [ ] **Step 8: The delta fold, at once after READY.** Run `0049-fold-write.sql` once more: rows the old build's switch added between step 5 and the deploy answer `appended` (expected 0), every other row `duplicate` or `refused`. Then this read (production, read-only) — addresses whose newest email row is a fold stop but where no contact with that address still carries the 0049 stamp (the operator un-ticked it in the window):
```sql
select count(*) from (
  select distinct on (e.account_id, e.address) e.account_id, e.address, e.action, e.method
    from public.consent_events e
   where e.channel = 'email' and e.action in ('revoked', 'held', 'hold_released', 'resubscribed')
   order by e.account_id, e.address, date_trunc('milliseconds', e.occurred_at) desc,
            case e.action when 'revoked' then 3 when 'held' then 2 else 1 end desc, e.id desc
) n
 where n.action = 'revoked' and n.method = 'backfill_0049'
   and not exists (
     select 1 from public.contacts c
      where c.account_id = n.account_id and c.marketing_email_opted_out_at is not null
        and lower(btrim(c.email, ' ' || chr(9) || chr(10) || chr(11) || chr(12) || chr(13))) = n.address);
```
Expected 0. If not 0, tell danlo the count (never the addresses): staff can Resume each from its Email row. From here on nothing reads the column; a later migration drops it (Next plans).

- [ ] **Step 9: The go-live check (right after the deploy; not a merge gate).** From danlo's own inbox (a Gmail address; it must not be one of BIS's `notify_emails` so the receipt and the alert do not land together): submit BIS's own website contact form with that address and ticking nothing else. Then:
  1. The receipt (`forms.receipt`) arrives with the footer line under the message, in the form's language; Gmail's "Show original" shows `List-Unsubscribe: <https://app.bis-rgv.com/api/unsubscribe/…>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, and its `DKIM-Signature` `h=` list names `list-unsubscribe` and `list-unsubscribe-post` (**A1**; if it does not, Gmail will not honour the header one-click: record it and tell danlo; the footer link still works).
  2. The footer link opens the branded page ([Q1]: the question and one Unsubscribe); press it; BIS's drawer for that contact reads Stopped · "unsubscribe link", no Resume.
  3. Resubscribe on the page; the drawer reads Allowed.
  4. If Gmail shows its own "Unsubscribe" beside the sender (it may not for a low-volume sender; that is not a failure), use it: the ledger shows `revoked` / `one_click` for that address (read through the MCP, BIS's own account only). Resubscribe again from the footer link.
  5. Delete the test lead contact from BIS's contacts (the ledger rows stay; their `contact_id` is already null).
  Two footers, a missing header, or an unbranded page: STOP and report.

- [ ] **Step 10: Handoff.** The ledger lines above; the head SHA and its check runs; the counts from steps 3, 5 and 8; A1's and A3's outcomes; danlo's answers to Q1–Q6 if any changed the plan; the Next plans below.

---

## Self-review (done while writing; recorded for the reviewer)

**Spec coverage** (the §7 PR-3 row, item by item):
- Email kinds in the registry: Task 4 (22 kinds; E1's two new sites; the class decides what an unsubscribe stops; choice 31's hours; [Q4]'s footer).
- The footer and the headers: Task 4 (the shell's marker), Task 5 (the gate fills it, the text line, `List-Unsubscribe` / `List-Unsubscribe-Post`, Resend's `headers`, G8's production rule).
- The token: Task 3 (sealed and signed [Q3], the previous secret, never expires, no fallback key; §8's four token tests plus URL-safety and "cannot read the address").
- `/u/[token]` and the one-click endpoint: Task 9 (RFC 8058's 200 / no cookie / no redirect; 400; 503; the GET redirect; the page's four states and its error lines; [Q1]; rule 9's branding; bilingual; no Referer; public, pinned by `proxy.test.ts`).
- The 0049 fold and backfill: Task 1 (no reader left: the reactivation walk and its by-id read, the referral row, the contact select list), Task 2 (count and write, idempotent, one source per event, never over a later act), Task 11 (the switch, its action and copy removed), Task 13 (scan 5's column), Task 15 (count → danlo → secret → write → merge → delta; the ordering hazard analysed).
- Every email path through the gate: Tasks 6, 7, 8 (all 22 sites), Task 13 (scan 1 for email, scan 2 over both registries, the sites table).
- The customer-initiated rule: Task 4 (the class), Task 5 (never reads the ledger), Task 13 (scan 4).
- The Email row on the contact, replacing the 0049 switch: Tasks 10, 11 (Allowed / Stopped, the since line, Stop with Undo, Resume with a note, choice 19's customer-only line, skeleton and error, the Messages label when the Texts row has none, the styleguide specimen).
- §6's composer notice: Task 12 (choice 22; G15).
- §8's PR-3 tests: token (Task 3), registry completeness (Task 4), scans 1, 2, 4, 5 (Task 13), backfill idempotency (Task 2, replica and CI), e2e's two email lines (Task 14).
- §5's PR-3 items: fails closed (Task 5; Task 6's re-holds), mail scanners (Q1, which changes the spec's own answer to them), privacy (Q3; no token in a log line, Task 13; the page's `referrer`), rollout (Task 15).
- Not in PR-3, deliberately: dropping the 0049 column (a later migration, spec §3); a preference page (§9); reading inbound email (decision 6; Q6); recording spam complaints as stops (G17).

**Placeholder scan:** `grep -nE "TBD|TODO|implement later|fill in|similar to Task"` over this file finds only this line. Several edits say "the file's own" helper (`ctx`, `subject`, `sendMock`, a submit helper) instead of quoting it, because those test files are long and each helper is used as it is; each such edit names the grep that finds it.

**Type consistency** (names a later task uses, checked against the task that defines them): `emailLedgerAddress` (Task 1, from `@bis/db/email-address` in the web) → Tasks 3, 5, 10, 12; `readBlockedAddresses` (Task 1) → Task 1's own walk; `ConsentTokenPayload`, `sealConsentToken`, `openConsentToken`, `consentTokenSecrets`, `isUuid` (Task 3) → Tasks 5, 9, 14; `EMAIL_KINDS`, `EmailKind`, `OperatorEmailKind`, `isEmailKind`, `emailReadsLedger`, `UNSUBSCRIBE_MARKER` (Task 4) → Tasks 5, 13; `EmailRequest`, `EmailSendResult`, `EmailBlockReason`, `EmailNotSent`, `sendEmail`, `sendEmailOrThrow`, `GatedEmail`, `emailSenderFor`, `operatorMailer` (Task 5) → Tasks 6, 7, 8; `isProductionEnv` (Task 5, `@/lib/email/environment`); `EMAIL_BLOCK_REASONS` (Task 6); `readUnsubscribeToken`, `recordUnsubscribe`, `recordResubscribe`, `emailStateOf`, `UnsubscribeState`, `pageLines`, `fillBusiness` (Task 9); `EmailView`, `EmailHow`, `EMAIL_RESUMABLE_METHODS`, `readEmailView`, `EmailContext`, `EmailActionResult`, `EmailUndo`, the three `…EmailsAction`s, `EmailResponse` (Task 10) → Task 11; `EmailLoad`, `EMAIL_TREATMENT`, `emailLine`, `runEmailAction` (Task 11); `EmailRecipientState`, `emailRecipientState`, `composerEmailNotice` (Task 12). NOT checked by a compiler: nothing was run.

**Counts** (read off this file): 15 tasks; 4 checkpoints; 0 migrations; 22 email kinds (5 customer-initiated, 2 informational, 5 marketing, 1 staff-typed, 9 operator); 36 kinds seen by scan 2 (14 + 22); 7 questions for danlo (Q7 an FYI); 2 new env vars (`CONSENT_TOKEN_SECRET`, `CONSENT_TOKEN_SECRET_PREVIOUS`); 2 backfill SQL files.

**Vacuity checks applied while writing** (memories `bis-vacuous-test-shapes`, `bis-test-vacuity`):
- Every apostrophe-bearing assertion on rendered HTML reads through `renderedText` (the page and the Email row), so no negative assertion can pass on `&#x27;`.
- The brand-colour assertion compares against the UNBRANDED theme's own value first (the fallback is also a `--form-accent`, so "contains `--form-accent:`" alone would have been vacuous).
- The fold's tests run the FILE'S OWN statement, narrowed by account through one pinned line, and fail loudly if that line moves.
- One probe (Task 2 probe 7) is predicted to STAY green and says so: it proves the guard is not what refuses the fold, 0055's rule is.
- The two `vi.mock` hazards were designed out, not documented: `emailLedgerAddress` and `isProductionEnv` live on subpaths no web test mocks (`@bis/db/email-address`, `@/lib/email/environment`), so the gate cannot read an undefined mock through a bare `vi.mock("@bis/db")` or `vi.mock("@/lib/email")` factory.
- The site tests spy on the REAL gate (`vi.fn(real.sendEmailOrThrow)`), so a site's kind is asserted and its email still meets the gate's rules.
- The one-click route test pins an EMPTY body and the absence of `set-cookie` and `location`, not just the status.
- The e2e reads the ledger row itself, not only the page's words.

**Known residuals** (each a deliberate trade, not a gap to fill silently):
- A tab opened before the deploy sends the drawer's summary parser a body without `marketing_email_opted_out_at` and shows "couldn't load" until it reloads (R9); its old switch's action no longer exists and errors if pressed.
- An email-stopped contact still takes a slot in the reactivation walk's page (Task 1): the walk reads up to `REACTIVATION_CANDIDATE_LIMIT × REACTIVATION_CANDIDATE_PAGES` (1,000) conversations a tick, oldest first; only more than ~1,000 stopped customers at the head of one account's history could starve it. Filtering in the query would need `consent_events` read outside `consent.ts` (scan 3).
- A 0049 address outside printable ASCII is left out of the fold and counted (Task 2); staff stop it by hand.
- A spam complaint (`email.complained`) is not a stop (G17).
- Whether Gmail honours the header one-click rests on Resend's DKIM coverage (A1), checked at go-live.
- A person who forwards an email hands the recipient a working unsubscribe for the original address — the token is the capability (spec decision 6: no token table); the forwarded reader can also Resubscribe it.

**Not replayed:** every step. The machine had 0.1–0.2 GB free while this plan was written. One pure piece was run instead, outside vitest: Task 3's seal/open logic, as a plain Node script (HKDF, AES-256-GCM, HMAC), round-tripped a payload, refused a wrong secret, and produced a 320-character token. That is evidence about the crypto calls, not a vitest run.

## Deferred to whole-branch review

- `scans.test.ts`'s KIND_LITERAL now matches `booking.` and `forms.` in any gate caller: a future `m["forms.…"]` key in `enrich.ts` or the booking action would be read as an unregistered kind (PR-2 moved its reply keys under `sms.` for the same reason). None exists today (checked on `001a25f9`).
- `EMAIL_RESUMABLE_METHODS` and 0055's staff-Resume list (`staff`, `free_text`, `backfill_0049`) are tied by no test; email never writes `free_text`, so the difference is harmless today (PR-2's R1-N4 again).
- The billing link (`operator.billing_link`) goes to the CLIENT, not the business's customer, so it carries no footer; if a later plan emails clients' marketing, it is a new kind, not this one.
- The drawer now makes three reads (summary, texts, email) on every open; a later change could fold the texts and email reads into one route.

## Next plans

- **A migration that drops `contacts.marketing_email_opted_out_at`** once both databases pass the parity check after this PR's deploy (spec §3), with PR-1's pending drop of `automation_settings`'s quiet columns.
- **Recording spam complaints as email stops** (G17): a new method, and an account for automation email (a `messages` row, or the provider id stored with the send).
- **A preference page and per-kind email choices** (spec §9; Q2's alternative).
- **The go-live of texting** (PR-2's Next plans) is independent of this PR.
