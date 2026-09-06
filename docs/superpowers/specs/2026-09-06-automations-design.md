# Automations (Roadmap Phase 2) — Design

> **STATUS: DESIGN COMPLETE — all five sections approved by danlo 2026-09-06.**
> Sections 1–4 were approved in the first session; the daily-cap question was
> answered and Section 5 (testing) approved in the second. Next: danlo reviews
> this written spec, then `superpowers:writing-plans` — and ONLY that skill.

Unblocked by the Vercel Hobby → Pro upgrade (2026-09-06, `main` @ `aa92cee`).
Roadmap Phase 2 was explicitly "blocked on the Phase 0b decision" — that
decision is now made and deployed.

## Decisions already taken (do not re-litigate)

**danlo chose built-in recipes, not a rule builder.** You ship a fixed
catalogue; per client it is a toggle plus a couple of fields. Rejected: a
client-facing rule builder, and an agency-only builder. Reason: every
automation here spends the client's money and messages their customers, and the
text-back work of 2026-09-05/06 showed how many ways that goes wrong (wrong
name, wrong hour, twelve copies). A fixed catalogue means every path that can
send is reasoned about in advance.

**danlo chose all four candidate recipes:** no-show → rebooking nudge · review
request after a completed job · new lead → instant response · booking reminder
sequence.

**Runtime: NOT Vercel Workflows.** Considered and rejected on the domain, not
on taste. Bookings are cancelled and rescheduled constantly (the voice
receptionist does it mid-call), so every recipe has a "the thing it was about
changed" case — and that is exactly what Workflows handles worst: reaching into
in-flight runs needs signals and cancellation APIs, and pending work is opaque
compared with rows you can query. Revisit only if a recipe ever needs sub-minute
latency or genuine multi-day human-in-the-loop steps.

⚠️ I had earlier told danlo that Workflows looked like the better fit for
"wait 3 days then nudge". That framing was wrong for this domain and was
corrected before the design was settled. Recorded so it is not re-proposed.

**The daily cap is a fixed platform constant, not per-client** (danlo,
2026-09-06). See Section 4 for what that means and why.

## Section 1 — Scope and sequencing (APPROVED)

Split **by mechanism, not by recipe count**.

- **Milestone A — the spine, proven by one recipe.** The generic `automations`
  config table · refactor the cron route from two hard-coded passes into a
  registry of passes, **migrating the two live passes in FIRST** so the harness
  is proven against code already running in production · ship exactly one
  recipe end to end: **review request after a completed job**.
- **Milestone B — the remaining state-derived recipes.** No-show nudge and the
  ~2h SMS booking reminder. Each is then just a registry entry: due-query,
  body, stamp column.
- **Milestone C — the inline path.** New lead → instant response. Fires at the
  emit site, no cron, different mechanism, own seam.

Accepted deliberate over-build: **Milestone A ships a config table holding
exactly one row type.** Taken over the alternative of four migrations adding
toggle columns to `accounts` plus a settings UI growing a bespoke card per
recipe. The refactor belongs in A because the alternative is a cron route with
five sequential loops in one file.

**This spec's implementation plan covers Milestone A.** B is a follow-on plan
under the same spec (each recipe is a registry entry plus the tests Section 5
prescribes). C is a different mechanism and gets its own short design pass for
the inline seam before it is planned; nothing here designs it.

## Section 2 — Architecture (APPROVED)

**Config is generic; due-ness is domain-specific.** That split is the whole
idea, and it is what makes cancellation free.

- **`automations` table:** `(account_id, recipe_key)` unique, `enabled bool
  default false`, `body text default ''`, `config jsonb default '{}'`,
  timestamps.
- **Grants follow `voice_profiles`, NOT `calendars`:** `authenticated` gets
  SELECT only; writes go through an **agency-gated action on `serviceDb()`**.
  v1 is agency-configured because these spend the client's money and can get
  their number carrier-blocked. Client-editable is a later decision, not a v1
  gap. (The calendar follow-up toggle is the counter-precedent, deliberately
  not followed.)
- **The review URL lives in that recipe's `config` jsonb**, not a new
  `accounts` column — `accounts` carries the 0013 grant complication (UPDATE
  revoked from `authenticated`, re-granted only for branding columns). Cost:
  jsonb is untyped, so it is validated on write AND on read, never trusted.
- **Stamps stay on the domain row** (`bookings.review_requested_at`). A booking
  that is un-completed or cancelled simply stops matching — no void step,
  nothing to forget.
- **The pass registry is a HARNESS, not a shared algorithm.** The obvious
  version is wrong: the two existing passes are genuinely different (reminders
  have no morning gate and count a missing email as a failure; follow-ups have
  the gate and count it `skippedNoEmail`). A `listDue/send/stamp` interface
  would force them to be the same shape and make both worse. So each pass is
  `{ key, run(ctx) → counters }` and owns its own query, gate, send and stamp.
  What the registry buys: **independent error isolation** (the `finishCall` leg
  pattern), uniform counter reporting, one place to add a recipe.
- **Nothing new sends.** Email via `getEmailProvider` inside the existing
  template shell; SMS via `resolveSmsSender` then `getSmsProvider`. The gate
  stays the only gate.
  **The harness constructs both providers once per tick and hands them to
  every pass on `ctx`; a pass never imports a provider factory or a provider
  module.** Section 5 makes that structural.
- **Where it lives:** the harness, the pass context type, and each recipe's
  pure gate module go under `apps/web/src/lib/automations/`; due-queries,
  stamps, window constants and the `automations` table access go in
  `packages/db`. The cron route becomes a thin caller of the harness.

## Section 3 — The review request, end to end (APPROVED)

- **Trigger:** the operator pressing "Mark completed" — already shipped at
  `bookings-list.tsx:85`. Nothing sends without a human classifying first.
- **Due query:** `status='completed'` · `review_requested_at IS NULL` ·
  `ends_at` inside the staleness window · the account's `review_request` row is
  `enabled` (a missing row is off) · the contact has a deliverable address for
  the chosen channel.
- **Timing** reuses the morning gate shipped 2026-09-06 (`followup-timing.ts`):
  08:00–11:00 in the account's zone, meeting ended a strictly earlier local day.
  The review gate is its own pure module and does not copy that logic. The
  band and strictly-earlier-local-day predicates are module-private in
  `followup-timing.ts` today; the plan exports them as named helpers and
  re-expresses `shouldSendFollowupNow` on top of them, with its own tests
  unchanged as the proof. `shouldSendFollowupNow` itself cannot be reused
  whole because it carries the 37h cap and the review gate carries 61h.
- 🔴 **THE COLLISION, and it is not obvious:** the existing follow-up email
  ALREADY fires next-morning for `completed` bookings when
  `calendars.followup_enabled`. Both enabled = two emails to the customer the
  same morning. **Rule: a review request sends on a qualifying morning only if
  `followup_sent_at` is null, or is on a strictly earlier local day** — the
  same predicate already built, read in the account's zone. Yields good
  sequencing for free: day one "how did it go?", day two "would you leave us a
  review?". A follow-up that never sent (no email, send failure) leaves the
  stamp null, and the review request proceeds on its own schedule.
- **Channel** is per-recipe config: `config` for this recipe is
  `{ channel: "email" | "sms", reviewUrl: string }`. If SMS is selected and
  `resolveSmsSender` refuses, the pass **skips and counts it — it does NOT
  silently fall back to email.** A silent channel switch erodes trust in the
  whole feature. The settings UI shows the reason using the composer's
  existing A2P copy. Email renders a new `reviewRequestEmail` template inside
  the existing shell (the prose body as paragraphs, the review URL as the one
  link); SMS renders `composeReviewRequestSms`. An empty `body` uses an
  exported default constant, the same pattern as the follow-up template's
  default copy.
- **NO template tokens.** DESIGN.md forbids `{{syntax}}` on client-facing
  surfaces, and an operator placing `{link}` correctly is a failure mode worth
  not creating. The body is prose; **the sender appends the review URL**, same
  shape as `defaultTextbackBody`.
- ⚠️ **Direct consequence, and it is this week's bug class exactly: the
  settings preview must count the body PLUS the appended link.** A counter
  measuring only the typed body under-reports on every SMS review request —
  the same preview-vs-send drift fixed twice on 2026-09-06. One function
  composes body + link; the preview and the sender both call it.
- **Staleness cap: 61 hours, DERIVED, not picked.** The follow-up deferral above
  can push a review request a full day past the follow-up's own window, so the
  follow-up's 37h is not enough: 37h + 24h = 61h. Worst case, a meeting ends at
  00:00 local on a 26-hour day (Antarctica/Troll's October fall-back), the
  follow-up goes out at the close of D+1's band, and the review request's last
  qualifying tick is 11:00 on D+2: 26 + 24 + 11 = 61h. Section 5 pins it
  against real zones the way the 37h cap is pinned. Bounded catch-up stated
  honestly: if the follow-up itself was late (sent D+2 on its own catch-up),
  the review request would land on D+3 and the cap drops it — the safe
  direction, a missing nicety rather than a mistimed one.
- **Idempotency:** send-then-stamp on `review_requested_at` using the retry
  helper built 2026-09-06 (`stampWithRetry`). At 15-minute ticks an unstamped
  send is up to twelve duplicate messages — not optional.

## Section 4 — Safety and failure modes (APPROVED)

Through-line: **prevent structurally, because prose rules lose.** The recorded
precedent is the model reciting the email-ask rule three calls running while
skipping it; the fix that worked was making the tool refuse.

- 🔴 **The brand-name leak, prevented rather than remembered.** Sending
  `accounts.name` to a customer is on its THIRD occurrence (P5 copy, the email
  From line, the text-back body). So **the pass context exposes `brandName`
  only; `accountName` is not on it.** The harness computes `brandName` with
  the existing `brandDisplayName` resolver, once, per account. A recipe author
  cannot reach the internal label, rather than being told not to. Known and
  unchanged: `brandDisplayName` falls back to `accounts.name` when
  `brand_name` is null — platform-wide behaviour, not this design's to fix.
- **Volume: two FIXED platform constants** (danlo, 2026-09-06): a per-pass
  per-tick cap and a per-pass per-account daily cap. Starting values the plan
  pins: **10 per pass per tick, 25 per pass per account per day.** "Day" is a
  rolling 24 hours counted from that pass's own stamp column, so the cap needs
  no new table and no timezone. Skipped rows are counted as `skippedCap` and
  left unstamped, so they are simply due again next tick or next morning.
  Why fixed: the cap's job is a burst guard against a bug or a bulk status
  change, not a plan feature. No storage, no UI, no grant question; the
  counter makes a real client hitting it visible, and per-client configuration
  then becomes a decision with evidence behind it rather than a v1 field. The
  morning band is twelve ticks wide, so an uncapped pass on a busy client is a
  burst. Also closes the "no spend cap" minor still open from SMS Phase 1b.
  **Caps apply to recipe passes only — the two migrated passes stay uncapped.**
  Caught in self-review: a booking reminder is one-to-one with a booking the
  customer made, and a 25-a-day cap on a busy client would DROP reminders
  (the row falls out of its 75-minute window before the rolling day clears),
  turning a burst guard into no-shows. The same holds for follow-ups. Both
  live passes have run uncapped in production and keep exactly that
  behaviour; this is also what lets the migration commit leave their JSON
  and their 30 tests untouched.
- **Duplicates:** send-then-stamp + the retry helper, residual stated honestly.
- **Isolation:** each pass independently try/caught, like `finishCall`'s legs.
  A pass that throws outright is counted `errored` for that pass; the tick
  still returns 200 with every other pass's counters intact.
- **Fail closed, every time, and COUNT it under its own name:** A2P not
  approved · no live number · unresolvable account timezone · missing or
  invalid review URL · no deliverable address for the chosen channel.
- **Off by default:** every `automations` row defaults `enabled=false`. Nothing
  changes for any existing client on deploy — the posture that made the
  text-back deploy provably inert.
- **Grants:** unit tests mock the db and are BLIND to column grants (four
  shipped defects from exactly that). The e2e proving a client cannot write
  `automations` is the only test that can see it, and it **pins the SQLSTATE**
  rather than asserting `status >= 400`.
- ⚠️ **Residual that cannot be designed away:** none of this has been looked at
  in a browser. A settings surface with a live segment counter and an appended
  link is precisely where a rendering bug hides from every gate we have.

## Section 5 — Testing (APPROVED)

Organised by what each test must PROVE and which layer can see it, because the
last four shipped defects were all things a green suite could not see. Every
test below names the mutation that must make it fail; a test whose mutation
leaves it green is not finished. Milestones B and C inherit this section: each
recipe adds its own gate, fail-closed and preview tests under the same rules.

**Layers that exist (verified in source):** vitest unit suites under `pnpm
check` (mocked db and providers; the cron route test mocks `@bis/db` and
`@/lib/email` at module level and fakes only `Date`) · `packages/db`
integration (`test:integration`, real Clerk + hosted Supabase, skips loudly
without credentials, NOT part of `pnpm check`) · Playwright e2e (67 specs,
production build, serial, shared dev database; `client-branding.spec.ts` is the
one spec that drives PostgREST with a minted client token and pins `42501`).

**The harness (Milestone A, migration commit)**

- **The two live passes are proven by the tests that already exist.** The JSON
  the route returns for reminders and follow-ups stays byte-identical, so the
  30 existing tests in `api/cron/reminders/route.test.ts` run unchanged against
  the refactored route. **The migration commit may not edit that file.** New
  recipes add new top-level keys; the two migrated shapes do not move.
- **Isolation.** A registered pass whose `run` rejects outright (not a send
  inside it) leaves the tick at 200, the other passes' counters intact, and
  its own key reporting `errored`. Mutation: remove the try/catch around
  `run(ctx)`.
- **Providers come from `ctx`, never from imports.** One structural vitest
  reads every file under `apps/web/src/lib/automations/` and fails on any
  import of `@/lib/email/resend`, `@/lib/sms/telnyx`, or the two factory
  modules. The harness is the only caller of `getEmailProvider` /
  `getSmsProvider` in the automation path. The two-signal production guard
  (`VERCEL_ENV` AND `NODE_ENV`) is not touched. That is the whole "no test can
  send for real" property, proven once. Mutation: add a direct import to a
  recipe file.
- **The brand-name leak, proven with a sentinel.** Fixture rows carry
  `accountName: "Rio Roofing — trial"` and `branding.brandName: "Rio Roofing"`.
  One test runs every registered pass with due rows and asserts the substring
  `"— trial"` appears in NO argument of any email or SMS send call (`to`,
  `fromName`, `subject`, `body`, `html`, all of it). The `PassContext` type
  has no `accountName` field, so a recipe reaching for it fails `tsc`.
  Mutation: put `accountName` on the context and use it in one send.
- **Caps, recipe passes only.** `AUTOMATION_TICK_CAP` and
  `AUTOMATION_DAILY_CAP` pinned at 10 and 25. N+1 due rows for one account
  yield N sends and one `skippedCap`; the skipped row is not stamped; a mocked
  "already sent in the last 24h" count of 24 yields exactly one send. The two
  migrated passes are asserted uncapped: 30 due reminders for one account send
  30. Mutation: set either cap to `Infinity`; apply the cap to the reminder
  pass.
- **The cron coupling gets its first automated check.** The reminder window
  (`[now+23h, now+24h15m]`) and the follow-up window (37h) are inline literals
  in `packages/db/src/booking.ts` today; the migration commit exports them as
  named constants. One test reads `apps/web/vercel.json`, parses the `*/N`
  schedule to a tick interval, and asserts the reminder window is wider than
  one tick; a second asserts the web-side `FOLLOWUP_MAX_AGE_MS` equals the
  db-side follow-up window constant. This pays down the carried ledger concern
  in the exact file being refactored. Mutation: change either literal alone.

**The review-request recipe (pure gate module, `followup-timing.test.ts` rules)**

- **Zone discrimination.** Every zone-dependent test pins ONE instant against
  TWO zones with OPPOSITE verdicts. `America/Chicago` (the dev machine's zone)
  appears only as one half of a pair, never alone. Every instant is computed
  with `Intl.DateTimeFormat` before the assertion is written, never by hand.
- **The follow-up collision.** One instant, `followup_sent_at` at 04:30Z:
  23:30 yesterday in Chicago, 00:30 today in New York. The review request sends
  in Chicago and holds in New York. A null `followup_sent_at` sends. Mutation:
  compare instants instead of local days.
- **The 61h cap is pinned, not asserted.** `REVIEW_REQUEST_MAX_AGE_MS` is
  defined ONCE in `packages/db` (it sizes the due-query window) and imported by
  the web gate — the follow-up's prose-linked duplication is not repeated. Pin
  the Antarctica/Troll 26-hour-day case at exactly 61h and the New York
  fall-back case under it, both against real zones, so a tzdata change surfaces
  here. Mutation: 60h.
- **Preview equals send.** `composeReviewRequestSms(body, url)` is the one
  function that appends the link. The settings counter renders
  `segmentsFor(composeReviewRequestSms(...))` and the sender sends the same
  string; one test pins the counter's count to the composed string with a body
  that fits one segment alone and two with a realistic Google review URL
  appended. Mutation: count the typed body alone.
- **Fail closed, each case its own counter, each with its own test:** channel
  SMS and `resolveSmsSender` returns `a2p_not_approved` or `no_live_number` →
  counted, NOT emailed (mutation: fall back to email) · review URL missing,
  non-`http(s):`, or not a string in `config` → counted, no send (mutation:
  send with an empty link) · unresolvable zone → held and counted (the
  existing pair: junk zone vs explicit `"UTC"` at 09:30Z) · no deliverable
  address for the chosen channel → skipped.
- **Config is validated on write AND on read.** The agency action refuses an
  unknown `recipe_key`, a non-URL `reviewUrl`, and a `javascript:` scheme; the
  pass treats the same shapes arriving from the database as missing. Both are
  pure and unit-tested with a mocked db.
- **Send-then-stamp and retry** copy the three existing tests per pass: a send
  that throws is counted `failed` and NOT stamped; a transient stamp failure is
  retried through `stampWithRetry`; exhausted retries count `unstamped` while
  the send still counts `sent`. Its retry budget is its own, not shared.
- **The due-query projects the columns the pass reads.** The `packages/db`
  unit test for `listDueReviewRequests` asserts the requested column list, per
  the recorded lesson that a mock more permissive than the real client proves
  nothing. Mutation: drop a column from the select.

**Grants — the only layer that can see them**

- A new `apps/web/e2e/automations.spec.ts` modelled on `client-branding.spec.ts`:
  the POSITIVE case first (a minted client token SELECTs its own account's
  `automations` row and gets it), then a client INSERT and UPDATE are refused
  and the response body contains **SQLSTATE `42501`**, never `PGRST204`
  (which would mean the column is misspelled, not protected). Another
  account's row reads as zero rows on a 2xx (RLS filters, it does not throw).
  The fixture row is inserted with `serviceDb()` in the spec and removed in a
  `finally`.
- **Watched failing first.** The spec is written and run once BEFORE migration
  0025 is applied. The table is absent at that point, so the seed insert
  fails with PostgREST's `PGRST205` (no such table in the schema cache; the
  raw Postgres `42P01` appears only at the pg level, in the db package's own
  grants test) and the `42501` assertion is never reached — which is the
  proof that the spec cannot pass by accident, not a formality. Note the e2e suite shares the ONE
  Supabase project with production (CLAUDE.md), so "applying 0025" is the
  production migration, and once applied it is never re-applied.
- `mintClientToken` moves from `client-branding.spec.ts` into `e2e/support.ts`
  so both specs share it.

**Gates before merge**

- `pnpm check` exit 0 (typecheck, lint, every unit suite) · `next build` ·
  full e2e: the existing 67 plus the new spec, judged by wall clock, re-run
  any red alone before believing it.
- A recorded mutation pass on the harness and the recipe gate: inject N
  defects, get exactly N failures, note it in the ledger.
- Review chain as usual: review → fix wave → re-review every wave, because
  fixes introduce defects.

**What no gate covers, stated so it is eyeballed rather than assumed**

- The rendered settings surface: the live counter, the appended link, the A2P
  reason copy. Needs eyes on a real page.
- The first real Pro tick with a new pass registered: confirm the response
  carries the new key and the two migrated shapes are unchanged in the
  runtime log.
- `brand_name` null on a real account still shows `accounts.name` to a
  customer, by the existing platform-wide fallback. Not new, not fixed here.

## Status and next steps

All five sections approved by danlo on 2026-09-06. In order:

1. danlo reviews this written spec.
2. Invoke `superpowers:writing-plans` — and ONLY that skill — for Milestone A.
3. Milestone B is planned from this spec after A ships. Milestone C gets a
   short design pass of its own first.

## Verified facts (checked in source 2026-09-06 — do not re-derive)

- `bookings.status` check allows `'booked','cancelled','completed','no_show'`
  (`0016_booking.sql:38-39`). All four states are legal at the DB layer.
- The operator already has **"Mark completed"** and **"Mark no-show"** buttons
  (`bookings-list.tsx:85,88`) → `setBookingStatusAction` → `setBookingStatus`,
  which emits `booking.status_changed`. **Both waiting recipes are triggered by
  a human pressing a button** — a safety property worth designing around.
- **No review link exists anywhere** in the schema or code. It is new.
- `events` table (`0001_tenancy.sql:58-68`): `id bigint generated always as
  identity` (monotonic — a natural cursor), `account_id`, `type`, `actor_type`,
  `actor_id`, `payload jsonb`, `created_at`. Indexes on
  `(account_id, created_at desc)` and `(type)`. **No `processed` column, no
  trigger, no LISTEN/NOTIFY.**
- Real domain events already emitted: `booking.created`,
  `booking.status_changed`, `call.recorded`, `form.submitted`,
  `message.received`, `message.status_changed`, `contact.created`,
  `note.created`, `opportunity.created`, `email.delivered`.
  **Nothing consumes any of them for side effects** — the dashboard activity
  feed is the only reader.
- ⚠️ **"Blueprint" is already taken**: it is the agency-scoped client
  provisioning template system (`0007_blueprints.sql`), NOT automations. Do not
  reuse the word.
- The cron runs `*/15` as of `aa92cee`, verified live at 11:30:24Z with **24
  seconds of jitter** (vs 54 MINUTES on Hobby).
- `api/cron/reminders/route.test.ts` holds **30 tests** across three describe
  blocks; it mocks `@bis/db` and `@/lib/email` at module level and uses
  `vi.useFakeTimers({ toFake: ["Date"] })`.
- The reminder window (`+23h` to `+24h15m`) and follow-up window (`37h`) are
  **inline literals** in `packages/db/src/booking.ts` (`listDueReminders`,
  `listDueFollowups`), not exported constants. `FOLLOWUP_MAX_AGE_MS` (37h) is
  exported from `apps/web/src/lib/booking/followup-timing.ts`.
- `getEmailProvider` and `getSmsProvider` return fakes unless BOTH
  `VERCEL_ENV === "production"` and `process.env.NODE_ENV === "production"`;
  `EMAIL_DEV_REDIRECT_TO` / `SMS_DEV_REDIRECT_TO` are the only escape hatches
  and rewrite every recipient.
- `resolveSmsSender(db, accountId)` returns `{ ok: true, from }` or
  `{ ok: false, reason: "a2p_not_approved" | "no_live_number" }`, failing
  closed on a null A2P read.
- `brandDisplayName(branding, accountName)` in `email/templates/shell.ts` is
  the one customer-facing name resolver (`brand_name` falling back to
  `accounts.name`); `emailBrand` wraps it.
- `stampWithRetry(stamp)` in `lib/booking/stamp-retry.ts`, delays
  `STAMP_RETRY_DELAYS_MS = [200, 700]`, returns `{ stamped, attempts, lastError }`.
- `segmentsFor(body)` in `lib/sms/segments.ts` is the one segment counter.
- The e2e client fixture: `readClientFixture()` in `e2e/support.ts`;
  `mintClientToken` and `patchAccount` are local to `client-branding.spec.ts`.
- The last migration applied is **0024** (text-back). The next is 0025.
- `voice_profiles` (`0019_voice_core.sql:38-42`): RLS enabled, one
  tenant-scoped policy `for all to authenticated`, `grant select` only; 0020
  revoked the rest. That is the shape `automations` copies: a client reads its
  own row, sees zero rows for another account, and gets `42501` on any write.
- `followup-timing.ts` exports `FOLLOWUP_MORNING_START_HOUR`,
  `FOLLOWUP_MORNING_END_HOUR`, `FOLLOWUP_MAX_AGE_MS`, `resolveAccountZone`,
  `shouldSendFollowupNow`. `localParts` and `localDayNumber` are
  module-private.
- `templates/followup.ts` exports its English default body as a constant so
  tests assert the same string; there is no per-language default.
- The e2e suite runs against the ONE Supabase project shared with production
  (CLAUDE.md). Mutating specs use the per-run fixture account only.
