# Not paying to talk to robots — design

**Date:** 2026-09-15 · **Branch:** `docs/feature-specs` · **Base:** `6613c09`
**Status:** IDEA for the screening half. The summary half already shipped —
see below.

## Why

danlo, 2026-09-15: spam takes token usage from the OpenAI account.

Correct, and the survey that followed found the spend is **entirely on the
phone side**. Form submissions cost nothing. Inbound texts cost nothing —
`api/sms/inbound/route.ts` writes rows and bumps a counter, with no model in
the path.

## Already fixed, 2026-09-15 (PR #64, `18b1bd3`)

`generateSummary` ran at the end of **every** call, before the
meaningful-outcome check, so a silent robocall still bought a `gpt-4o-mini`
completion. It now skips calls classified `spam`.

Two things worth keeping from that work:

**`spam` only, deliberately not `abandoned`.** `classifyOutcome`
(`lib/voice/call-state.ts`) reaches `abandoned` *only when a caller spoke* —
that is the branch's condition, and `spam` is the fall-through with none. Live
data agreed: abandoned averages 5.0 transcript events and carries the longest
summaries on file. There is real content there.

**It removed a fabrication, not just a bill.** One real spam call — 247
seconds, zero caller events — produced a summary asserting *"the caller asked
to review availability for Wednesday, September 4"*, invented wholesale from an
empty transcript. `composeSummary`'s MISMATCH banner caught it. The guard
worked; not asking is cleaner.

## Where the money actually goes

| Call site | Model | Reachable by an unsolicited caller? |
|---|---|---|
| `api/voice/incoming/route.ts` — the Realtime socket | `gpt-realtime` + `gpt-4o-mini-transcribe` | **Yes.** Billed audio up to `PHONE_MAX_CALL_SECONDS` (240s) |
| `lib/voice/summary-service.ts` | `gpt-4o-mini` | Was yes; now skipped for `spam` |
| `api/voice/web/session/route.ts` | Realtime, marketing demo | Origin allowlist + signed ticket |

Those are the only model calls in the product. `grep gpt-` returns three lines.
The contact "summary" route is pure database aggregation despite its name.

**So the remaining spend is the Realtime session itself, and that is the whole
problem:** up to four minutes of billed audio before anything decides the call
was spam.

## What stands in front of the model today

Only three things, and only one is a volume control:

1. Tenancy — is this a number we know, is the profile enabled.
2. `callAnswerable`.
3. Daily caps — `PHONE_MAX_CALLS_PER_NUMBER_PER_DAY` (5) and
   `PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY` (50), counted off the `calls` table.

Refusals in `api/voice/texml` are spoken and hung up **before the SIP bridge**,
so a refused call never reaches OpenAI at all. That is the good news: the
mechanism for cheap refusal already exists.

**The caps fail open on a database error**, by explicit decision — "losing a
prospect costs more than paying for one extra robocall". Worth re-reading that
line with a bill in hand rather than assuming it still holds.

There is no caller reputation check, no blocklist, no first-time-caller screen,
no per-account cost budget. A robocall from a fresh number gets a full session,
five times a day, per number.

## Open questions — none of these are decided

**What is the cheapest signal that separates a robot from a customer?** Silence
is the one we already use, but only *after* paying. Answering and waiting for
speech before bridging would cost carrier seconds instead of model seconds.

**Is a blocklist worth the table?** Repeat offenders are the easy case, and
`calls` already records caller and outcome, so the data to build one exists.

**Should the caps stop failing open?** The original reasoning is sound for a
quiet product. It is a different trade at volume, and it is one line.

**Is a per-account spend budget the real answer?** Caps count calls, not money.
A budget would bound the bill directly, but it also means a busy day can
silence a client's phone, which is worse than the spend.

**Does carrier-level spam scoring help?** Telnyx exposes signals this product
does not read. Cheaper than anything we could infer ourselves, and worth
checking before building inference.

**What about inbound texts?** No spam concept at all — no status, no column,
no rate limit beyond the carrier's own. Costs nothing today, but it is the
surface with the least protection.

## Out of scope

Anything that makes a real customer prove themselves. A receptionist that
interrogates callers is worse than the spend it prevents.

## Testing, when this is real

The rule that matters: a refusal must happen **before** the SIP bridge, and a
test must fail if that ordering is ever reversed. That is the same shape as the
agency work queue's guard test, which proved ordering rather than presence by
moving the guard and watching the test fail.
