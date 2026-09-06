# Automations (Roadmap Phase 2) — Design

> **STATUS: IN PROGRESS — brainstorm interrupted at Section 5 of 5.**
> Sections 1–4 are APPROVED by danlo. Section 5 (testing) was never presented,
> and one question is open (see "Where this stopped"). Do not treat this as a
> finished spec; finish the brainstorm, then hand to `superpowers:writing-plans`.

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
- **Nothing new sends.** Email via `getEmailProvider` + existing templates; SMS
  via `resolveSmsSender` then `getSmsProvider`. The gate stays the only gate.

## Section 3 — The review request, end to end (APPROVED)

- **Trigger:** the operator pressing "Mark completed" — already shipped at
  `bookings-list.tsx:85`. Nothing sends without a human classifying first.
- **Due query:** `status='completed'` · `review_requested_at IS NULL` ·
  `ends_at` inside the staleness window · the account's `review_request` row is
  `enabled` · the contact has a deliverable address for the chosen channel.
- **Timing** reuses the morning gate shipped 2026-09-06 (`followup-timing.ts`):
  08:00–11:00 in the account's zone, meeting ended a strictly earlier local day.
- 🔴 **THE COLLISION, and it is not obvious:** the existing follow-up email
  ALREADY fires next-morning for `completed` bookings when
  `calendars.followup_enabled`. Both enabled = two emails to the customer the
  same morning. **Rule: a review request sends on a qualifying morning only if
  `followup_sent_at` is null, or is on a strictly earlier local day** — the
  same predicate already built. Yields good sequencing for free: day one "how
  did it go?", day two "would you leave us a review?".
- **Channel** is per-recipe config. If SMS is selected and `resolveSmsSender`
  refuses, the pass **skips and counts it — it does NOT silently fall back to
  email.** A silent channel switch erodes trust in the whole feature. The
  settings UI shows the reason using the composer's existing A2P copy.
- **NO template tokens.** DESIGN.md forbids `{{syntax}}` on client-facing
  surfaces, and an operator placing `{link}` correctly is a failure mode worth
  not creating. The body is prose; **the sender appends the review URL**, same
  shape as `defaultTextbackBody`.
- ⚠️ **Direct consequence, and it is this week's bug class exactly: the
  settings preview must count the body PLUS the appended link.** A counter
  measuring only the typed body under-reports on every SMS review request —
  the same preview-vs-send drift fixed twice on 2026-09-06.
- **Staleness cap must be DERIVED, not picked.** The follow-up deferral above
  can push a review request a full day past the follow-up's own window, so
  ~37h is NOT enough — roughly 37h + 24h. Use the method the reviewer used on
  2026-09-06: sweep every IANA zone across a year and take the true worst case.
- **Idempotency:** send-then-stamp on `review_requested_at` using the retry
  helper built 2026-09-06. At 15-minute ticks an unstamped send is up to twelve
  duplicate messages — not optional.

## Section 4 — Safety and failure modes (APPROVED)

Through-line: **prevent structurally, because prose rules lose.** The recorded
precedent is the model reciting the email-ask rule three calls running while
skipping it; the fix that worked was making the tool refuse.

- 🔴 **The brand-name leak, prevented rather than remembered.** Sending
  `accounts.name` to a customer is on its THIRD occurrence (P5 copy, the email
  From line, the text-back body). So **the pass context exposes `brandName`
  only; `accountName` is not on it.** A recipe author cannot reach the internal
  label, rather than being told not to.
- **Volume:** each pass capped per tick and per account per day, with skipped
  counts returned rather than silently dropped. The morning band is twelve
  ticks wide, so an uncapped pass on a busy client is a burst. Also closes the
  "no spend cap" minor still open from SMS Phase 1b.
- **Duplicates:** send-then-stamp + the retry helper, residual stated honestly.
- **Isolation:** each pass independently try/caught, like `finishCall`'s legs.
- **Fail closed, every time, and COUNT it:** A2P not approved · unresolvable
  account timezone · missing/invalid review URL · no deliverable address.
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

## Section 5 — Testing (NOT YET WRITTEN)

Not presented. Must cover at minimum: the zone-discrimination rule (ONE instant,
TWO zones, OPPOSITE assertions — the dev machine is `America/Chicago`, so any
test using only that zone proves nothing); mutation-proving each gate; the
grants e2e above; and that no test can send a real email or SMS.

## Where this stopped

**Open question put to danlo, unanswered:** should the per-account daily
automation cap be a **fixed number** or **configurable per client**?

**Next steps, in order:**
1. Answer the cap question.
2. Present Section 5 (testing) and get approval.
3. Re-read this file top to bottom for placeholders, contradictions and
   ambiguity; fix inline.
4. danlo reviews the written spec.
5. Invoke `superpowers:writing-plans` — and ONLY that skill.

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
