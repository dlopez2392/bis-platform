# Onboarding Wizard + Calls Page — Design

**Date:** 2026-08-27 · **Milestone:** Voice sub-project 2 · **Approved by:** danlo (section-by-section, this session)

## Goal

Get the platform ready for its first real voice client: a guided Setup wizard that
takes a client from nothing to live, a Calls page that makes call history visible
to both audiences, and the ten follow-ups recorded during Voice Core V1 — every one
of which is an edge a real client would hit.

## Scope decisions (locked — do not re-litigate)

1. **All ten recorded follow-ups ride along** in this milestone (list below).
2. **Numbers:** danlo buys in the Telnyx dashboard; the wizard assigns. The
   number step is designed as a slot so a purchase-via-API button can land in a
   future milestone without redesign.
3. **Wizard scope:** full onboarding (account → branding → hours → voice →
   number → test call → go live), **built thin** — the wizard links to the
   existing pages and derives progress from live data; it does not duplicate
   forms.
4. **Calls page:** per-client list + detail + usage meter. Agency-wide roll-up
   deferred (recorded follow-up; `calls.account_id` already supports it — the
   future roll-up is purely a new page over existing data).
5. **Email identity:** a skippable wizard step. Skipping is safe by design —
   the platform-From fallback is deliberate (M4d).
6. **Exit gate:** dry-run a throwaway client end-to-end through the wizard with
   a real phone call, verified on the new Calls page, then tear down. The first
   real client walks on proven ground afterward.
7. **Wizard state = derived from reality** (Approach 1). Step completion is
   computed from the actual data at render time; only genuinely unknowable
   steps store a tick. A stored step-tracker that can drift from reality was
   considered and rejected.
8. **Design quality is a first-class requirement** for every surface in this
   milestone. The Setup page, Calls list, and call detail get the full
   frontend-design treatment — these pages are the product's showroom (the call
   detail transcript should read like something worth showing a prospective
   client). No admin-plumbing aesthetics.

## Part 1 — The Setup wizard

### Route and access

- `dashboard/accounts/[accountId]/setup`, **agency-only**
  (`requireAgencyOnlyAccountAccess`, same as the checklist page). Added to the
  account nav for the agency audience.
- New client: the existing create-account action gains a redirect to the new
  account's Setup page. Existing clients: Setup in nav.

### Steps and their reality checks

Completion is **computed at render time from live rows** — never stored, except
where marked. A check that errors renders "couldn't check", never green.

| # | Step | Done when (derived) | Work happens on |
|---|------|---------------------|-----------------|
| 1 | Create account | Account exists (always true on this page) | existing create flow |
| 2 | Branding | `accounts.brand_name` set | Branding page |
| 3 | Business hours | `calendars.enabled` **and** `open_hours != '{}'` | Calendar page |
| 4 | Voice profile | `voice_profiles` row exists with non-blank greeting and facts | Voice page |
| 5 | Phone number | `phone_numbers` row for this account, status `provisioned`/`testing`/`live` | Voice page |
| 6 | Email identity *(skippable)* | `accounts.from_email` set **or** stored "skipped" tick | Settings page |
| 7 | Call forwarding *(external)* | Stored manual tick — happens at the client's carrier, invisible to us. Card displays the assigned BIS number to forward to. | client's carrier |
| 8 | Test call | ≥1 `calls` row for this account | phone in hand |
| 9 | **Go live** | `voice_profiles.enabled` **and** `phone_numbers.status = 'live'` | the wizard itself |

- Step 3's check is the guard that would have caught the wiped-`open_hours`
  bug from exit-gate call #1 before any caller heard "no availability."
- Stored ticks (steps 6, 7) reuse the existing `checklist_state` storage under
  namespaced keys (e.g. `setup:email_skipped`, `setup:forwarding_done`) — no
  new table. The checklist page's `mergeChecklist` drops unknown keys, so these
  never render there untitled (verified behavior, documented in its own
  comment).
- Each step card: status, one-line explanation, button to the existing page
  with `?from=setup`; target pages show a "← Back to setup" link when the
  param is present. That is the entirety of the "built thin" mechanism.
- **Number reassignment is an explicit action, not a second insert.**
  `phone_numbers.e164` is globally unique (0019), so moving a number to
  another account (the dry-run does this; a real client swap will too) must
  either move the existing row's `account_id` or release-then-assign — the
  existing `assignNumberAction` alone cannot express it. The number step must
  surface "currently assigned to <account>" and support the move, agency-only.

### Go live

A real server action, not just a derived check:

- Sets `voice_profiles.enabled = true` and `phone_numbers.status = 'live'`.
- **Prerequisites re-checked server-side** at click time (steps 3, 4, 5, 8
  green; email exempt when skipped; forwarding advisory only). A disabled
  button is UI courtesy, not enforcement.
- Guard-then-`serviceDb()` write, following the ratified Task 13 pattern
  (`settings/actions.ts` agency-only precedent). Client sessions are rejected
  before any db call.

### Relationship to the existing checklist page

Unchanged this milestone. It keeps the manual/SMS/Google items (A2P, GBP). The
overlapping items (phone number, email domain) now live primarily in Setup.
Consolidation of the two pages: recorded follow-up.

## Part 2 — The Calls page

### Routes and audience

- `dashboard/accounts/[accountId]/calls` — list.
- `dashboard/accounts/[accountId]/calls/[callId]` — detail.
- **Both audiences** (like Contacts/Conversations). Client users read only
  their own calls — enforced by RLS + the SELECT-only grant from 0019/0020
  (verified live during Voice Core), read via `dbForRequest()`, not page
  logic. Voice *configuration* stays agency-only; the Setup page stays
  agency-only.

### List

Each row: started time · caller (linked contact name when `contact_id` set,
else `caller_e164`) · duration · outcome badge (booked / lead / message /
abandoned / spam) · language badge (EN/ES). Newest first, paginated.
`calls_account_started_idx` already serves this query.

**Usage meter** at the top: "N of CAP calls today" with a progress bar.
Corrected against source during planning: cap enforcement is **per-day**
(`call-limits.ts`, default 50/account/day counted from midnight UTC), not
monthly — the meter reads **the same daily count enforcement uses**
(`countCallsSince` from `utcDayStart`, one source of truth, pinned by a test)
so what the meter shows is exactly what the cap sees.

### Detail

- Header: outcome, started/ended, duration, language.
- **Summary with the honesty layer intact**: the same 3-layer honest summary
  as the alert emails; when prose claims something the structured intake
  doesn't back, the MISMATCH banner renders here too. The page never dresses
  up a claim the data can't support.
- Transcript rendered as a conversation (caller one side, assistant the
  other) from the `transcript` jsonb. Plain text only — React-escaped, no
  markup interpretation of caller speech.
- Sidebar links: contact card, conversation thread, booking (each only when
  the FK is set — all three are nullable by design).

## Part 3 — The ten follow-ups

The "already bit us" four:

1. **fillBlanks on voice contact dedupe** — when a call matches an existing
   contact, blank fields are filled: name replaces "Caller"/empty, email fills
   NULL. **Iron rule: never overwrite a non-blank value** (pinned by a
   mutation-style test). Measured casualty this closes: the voice booking's
   reminder couldn't send (contact email NULL).
2. **`APP_ORIGIN` env override** — all email link building prefers it;
   falls back to current request-derived origin when unset. Closes the last
   `vercel.app` link source (cron reminders) after the deliverability root
   cause was confirmed.
3. **Prompt: char-by-char email confirmation** — always spell back
   character-by-character; spoken "plus" triggers an explicit "is that the +
   sign?" (the `plusdomainfix@` wrong-address bug).
4. **Prompt: capture_lead alongside take_message on failed bookings** — the
   caller's name and need survive a booking that can't complete (call #1 lost
   "Dan Lopez").

Hardening four:

5. **Telnyx signature validation on the TeXML route** — requests must carry a
   valid Telnyx signature; invalid/missing → rejected response + log line.
   (The OpenAI webhook already validates; this closes the other door.)
6. **Polite refusal for live-number-with-disabled-profile** — spoken refusal
   instead of today's silent decline, in the profile's configured language(s).
7. **Cap-message-on-decline** — same treatment when the monthly call cap
   declines: polite spoken message, not dead air.
8. **`telnyx_id` uniqueness** — migration **0021**, partial unique index
   (`where telnyx_id is not null`). The only migration in this milestone;
   0019/0020 are applied and stay untouched.

Cross-channel:

9. **Web-boundary phone normalization** — contact form (`f/[publicId]`) and
   booking widget (`b/[publicId]`) normalize parseable US numbers to E.164 at
   the action boundary; unparseable input is stored as typed (never mangled,
   never rejected for a bad phone). Existing prod rows: one real contact —
   checked and corrected by hand (read-first), no backfill machinery.

The freebie:

10. **`calls.language` recorded** — the column already exists (0019, default
    `'en'`); the WS call loop now records the language actually spoken. The
    Calls page badge consumes it immediately.

## Security and failure rules

- Setup page + wizard actions: agency-only, server-enforced. Go-live
  prerequisites re-checked server-side.
- Calls pages: reads as the signed-in user (`dbForRequest`); RLS + grants are
  the enforcement layer.
- **Grant-blindness countermeasure:** the wizard reads calendars, branding
  (accounts), voice_profiles, and phone_numbers as the signed-in user — each
  derived check gets e2e coverage through a real signed-in session, the only
  layer that can see a missing grant (recorded lesson, two shipped defects).
- A derived check that errors shows "couldn't check" — never defaults to done.
- **fillBlanks can never break a call**: contact-update failure mid-call still
  completes the booking and records the call (rule ③ precedent: send-failure
  never fails a booked caller).
- Refusal-building failure still ends the call cleanly.
- Transcript rendering is plain text (React escaping; no markup from speech).

## Testing

- Every derived check tested in both directions (done and not-done states).
- Mutation-style pins: fillBlanks never-overwrite · booking survives
  fillBlanks failure · usage meter and cap enforcement share one count
  source · go-live server guard rejects a client session before any db call.
- Signature validation: valid / tampered / missing-header.
- e2e (signed-in sessions): Setup page renders with correct step states ·
  calls list + detail with seeded rows · client audience sees Calls but not
  Setup.
- Gates per task: `pnpm check` (typecheck, lint, db, web) · build · e2e
  (red-spec protocol: re-run the spec alone first, judge by wall clock).

## Exit gate (decision C)

1. Throwaway client taken from nothing to live using **only the Setup page**,
   including reassigning the test number (+1 956 506 1545) via the wizard's
   number step (this also exercises the reassignment path a real client swap
   will use).
2. danlo makes one real call and books.
3. Result read **on the new Calls page**: outcome badge, transcript, summary,
   language, usage meter = 1; confirmation email links all `app.bis-rgv.com`.
4. Tear-down: number back, throwaway client deleted — read-first audit before
   any delete (standing rule).
5. Then the first real client walks through on proven ground.

## Recorded follow-ups (deferred, not this milestone)

- Agency-wide Calls roll-up (all clients, one list) — new page over existing
  data; no storage work needed now.
- Telnyx purchase-via-API in the wizard's number slot.
- Checklist page ↔ Setup page consolidation.
- Tool-schema email requirement (deprioritized: Resend verdict proved the
  model does pass email).

## Out of scope

- Web widget + knowledge base (sub-project 3).
- SMS (A2P remains a checklist item).
- Vercel Pro upgrade / cron cadence changes (separate standing item: on Pro,
  restore `*/15` and narrow the reminder window).
