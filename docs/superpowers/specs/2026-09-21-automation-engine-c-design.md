# Automation engine, part C — one record, one quiet-hours rule, visible usage

**Date:** 2026-09-21 · **Status:** design approved by danlo in conversation; spec awaiting his read
**Owner agents:** bis-automations (passes, page), bis-db-schema (tables, grants, tests), bis-comms (the send seams), bis-voice (the AI seams)
**Supersedes nothing.** Extends `2026-09-06-automations-design.md` (the harness) and `2026-09-07-automations-milestone-c-design.md`.

## Why this, and why now

§8a's M3 row says the engine still owes three things: user-defined triggers → conditions → actions, quiet hours as one rule rather than a per-pass gate, and metering. On 2026-09-06 danlo chose built-in recipes over a rule builder, because every automation spends a client's money and messages their customers. That decision stands. On 2026-09-21 he chose to build the engine's shared pieces first (this spec, "C") and then more recipes ("B", its own spec), and to build a rule builder only when a second client's needs diverge from the catalogue.

What C buys: the first time an automation misfires, a client can read what the system sent on their behalf; every send obeys one quiet-hours rule a business owner understands; and usage is visible in the units the caps are written in, before any cap is made per-client.

## Verified facts (checked in the tree 2026-09-21 — do not re-derive)

- Eight passes run on one cron through the pass registry, each `{ key, run(ctx) → counters }` owning its own query, gate, send and stamp (`2026-09-06-automations-design.md` §2). **None of them writes to the events log** (`grep emitEvent apps/web/src/lib/automations` → nothing).
- Caps are fixed platform constants counted per recipe from that recipe's own stamps: `AUTOMATION_DAILY_CAP = 25` per account per 24h (`apps/web/src/lib/automations/caps.ts:16`), checked e.g. at `instant-reply.ts:119-121`. The concierge has `CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY = 300` (`lib/concierge/guards.ts:24`). There is no shared ledger.
- Reminders have no morning gate; follow-ups have one (§2 of the harness spec). That asymmetry is what "one rule" replaces.
- Per-recipe config lives in `automations (account_id, recipe_key)` with `config jsonb`, agency-written through `serviceDb()` actions, `authenticated` SELECT only (harness §2). Account-level settings have no home there; `accounts` carries the 0013 grant complication.
- `packages/db`'s `ACCOUNT_OWNED_TABLES` and `apps/web/e2e/fixtures/sweep.ts` must both list any new account-owned table, or the e2e fixture account strands (`bis-vacuous-test-shapes` #7).

## Decisions taken in this design (danlo, 2026-09-21)

1. **Quiet hours: one window per account, both channels, deferred not skipped** (option A). Default 21:00–08:00 in the account's own zone. A held send goes out at the window's end and the history says so. Rejected: SMS-only (a client who set quiet hours expects nothing to go out); reusing calendar business hours (wrong shape — the reminder text at 7 PM is wanted).
2. **One table serves history and metering.** Rejected: separate `usage_events` and `automation_runs` tables (two writers per send, two things to drift).
3. **Units, not dollars, in this round.** The caps are written in units; a price table is additive later.
4. **Agency-only editing of quiet hours**, like every other automation setting (harness §2's reasoning). Clients read.
5. **No new caps.** The fixed constants stay; visibility comes first.

## Section 1 — The record: `automation_log`

Migration `0046_automation_log.sql`:

```
automation_log
  id            uuid pk default gen_random_uuid()
  account_id    uuid not null references accounts(id)
  source        text not null      -- recipe key ('review_request', 'no_show_nudge', 'sms_reminder', …), or 'concierge', or 'voice'
  channel       text not null check (channel in ('sms','email','ai'))
  contact_id    uuid null references contacts(id) on delete set null
  subject_key   text not null      -- what this action was about: 'booking:<id>', 'submission:<id>', 'conversation:<id>', 'call:<id>'
  status        text not null check (status in ('sent','held','skipped','failed'))
  reason        text not null default ''   -- plain language, client-readable ("Held until 8:00 — quiet hours", "No email on file")
  held_until    timestamptz null   -- set when status = 'held'
  occurred_at   timestamptz not null default now()
  unique (account_id, source, subject_key, status) where status = 'held'   -- one held row per subject, not one per tick
  index (account_id, occurred_at desc)
```

- **Writers:** every pass, at the moment it sends, holds, skips or fails a subject; the concierge turn route, one `ai` row per conversation start (`subject_key = 'conversation:<id>'`, status `sent` — a conversation began); the voice lifecycle, one `ai` row per handled call at `finishCall`. Writers use `serviceDb()`; the write is a leg, isolated like `finishCall`'s legs — a log failure never fails a send.
- **Held → sent:** when a held subject is finally sent, the pass updates the held row to `sent` (status, reason, `occurred_at`), so the history shows one line per subject, never a held line and a sent line for the same thing.
- **Grants:** `revoke all` then `authenticated` SELECT under RLS on `account_id` (the `screened_calls` shape, `0020`'s lesson); `service_role` all. No INSERT/UPDATE for `authenticated`.
- **Lists:** added to `ACCOUNT_OWNED_TABLES` and `sweep.ts` in the same migration task, with the proof that both lists agree.
- **Retention:** none in v1. Rows are small; a monthly cap on the history page's reads is the cursor, not a purge.

## Section 2 — Quiet hours, one rule

**Storage:** `automation_settings` (migration `0046` as well): `account_id uuid pk`, `quiet_enabled bool not null default true`, `quiet_start time not null default '21:00'`, `quiet_end time not null default '08:00'`, timestamps. Grants as `automations`. Missing row = defaults (the pure function takes the defaults; no row is written until the agency edits).

**The rule** lives in one pure module, `apps/web/src/lib/automations/quiet-hours.ts`:

- `inQuietWindow(now: Date, zone: string, s: QuietSettings): boolean` — evaluated on the account's wall clock; windows that cross midnight (the default) are the normal case; `quiet_start === quiet_end` means disabled.
- `quietWindowEnd(now, zone, s): Date` — the next instant the window ends, in UTC; correct across a daylight-saving change (a 08:00 end is 08:00 on the wall clock on both sides of the change).
- No `Date.now()` inside; `now` is always an argument, as `setup-status.ts` does.

**Every pass** calls one helper before its send: `holdOrSend(ctx, { source, subjectKey, contactId, channel }, sendFn)`. Inside the window it writes (or leaves) the held row with `held_until = quietWindowEnd(...)` and returns `held`; the pass does NOT stamp its domain row, so the same subject is still due on the next tick after the window, when the helper sends, stamps, and flips the row to `sent`. Outside the window it sends, writes `sent`, and the pass stamps as today.

**The follow-ups' morning gate is deleted**; the window is the gate now. Reminders gain the window with **one named exemption:** a reminder whose appointment starts inside the current window sends anyway (the 7 AM text for an 8 AM job). The plan verifies the reminder windows in `packages/db/src/booking.ts` and names the exact rule from what it finds, not from this sentence.

**The page:** a "Quiet hours" card on the Automations page above the recipes: on/off, start, end, the account's zone shown beside them ("9:00 PM to 8:00 AM, America/Chicago"), saved by an agency-gated action on `serviceDb()`, with the same immediate-save-plus-undo pattern the recipes use. Copy: "Nothing automated goes out between these hours. Anything due overnight waits and goes at the end."

## Section 3 — Usage, in units

A "This month" card on the Automations page, computed from `automation_log` for the account's current calendar month in its own zone: texts sent, emails sent, assistant conversations, calls handled; and beneath, held and skipped counts with their top reason. Beside each channel, the fixed cap it lives under, as context ("25 per recipe per day"). A count is never shown alone: each carries the month label (DESIGN.md rule 1). Reads through the caller's client under RLS.

Not here: dollars, per-account caps, trend lines. The weekly report may pick these counts up in B.

## Section 4 — History: "What went out"

Below usage: the account's `automation_log` rows, newest first, cursor-paged with Older/Newer carrying `?before=` (DESIGN.md's paged-list pattern — one pager, server-paged), 25 per page. Each row: the status dot and word (never colour alone), the recipe's own title (from the catalogue's copy, never the key), the contact's name when there is one, the channel, the time in the account's zone, and the reason when status is not `sent`. Clients see their own; the agency sees the account it is viewing.

Empty state (rule 5): "Every text, email and conversation the system handles for this company shows up here. Turn on a recipe above and the first one appears the moment it goes out."

## Section 5 — Testing (the repo's rules apply; each is a mutation that must go red)

- `quiet-hours.test.ts`: inside/outside the window at both edges, a window crossing midnight, `start === end` disabled, a zone east and west of UTC, and the two daylight-saving nights for `America/Chicago` (spring forward and fall back) — `quietWindowEnd` lands on 08:00 wall clock both times.
- Every pass: one "held inside the window" test that asserts the send function was NOT called, the domain row was NOT stamped, and one held row exists with the right `held_until`; and its mirror after the window. Mutation: bypass the helper → the held test's send assertion fails.
- The held → sent flip: exactly one row per subject after both ticks.
- `packages/db`: grants and RLS for both tables asserting **42501 by SQLSTATE** with a second account's row present (never "an error"); `ACCOUNT_OWNED_TABLES` and the sweep list agree (both grow by two).
- The page: render tests for the three cards' loaded, empty and error states; one Playwright pass on the per-run fixture: set quiet hours, reload and read them back; the empty history state; after the fixture enables a recipe whose subject is due, one `held` or `sent` row renders with the title and the reason.
- Nothing that asserts a fixture-equal value: the fixture's quiet window must differ from the defaults, and the history row asserted must carry a reason the code could not produce by default.

## Out of scope, recorded

Per-account or per-client caps; dollar cost; retention; client editing of quiet hours; a rule builder; the weekly report's use of these counts (B). Each is a later decision, not a gap.

## What B is

Its own spec: which recipes next. danlo names them; each ships as a card with a toggle and a few fields on the harness, obeying Section 2 and writing Section 1's rows from its first commit.
