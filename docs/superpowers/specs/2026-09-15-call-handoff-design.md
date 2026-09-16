# Handing a call to a human — design

**Date:** 2026-09-15, designed 2026-09-16 · **Branch:** `feat/call-handoff`
**Base:** `41f54d1`
**Status:** DESIGNED, approved 2026-09-16. Supersedes the IDEA draft — the
survey below is kept and corrected, the open questions are now answered.

## Why

danlo, 2026-09-15: when a customer calls the number a business is assigned,
there should be an option to forward that call to a number the business
provides, so the caller can reach an actual person.

Today the only answer to "can I speak to someone?" is a message and a callback.
`system-prompt.ts:20` instructs Sofía to answer honestly that she is automated,
**then offer to take a message**. There is no path where the call leaves the AI
and reaches a person.

## What the carrier actually allows

The original draft recorded the constraint — *Telnyx refuses its own per-number
call forwarding on a TeXML-utilising number* — and concluded that a transfer
would need Call Control or SIP REFER. Checked against Telnyx's documentation,
it needs neither.

**`<Dial>` takes an `action` URL**, requested when the dial ends, returning a
fresh TeXML document that continues the call. So when the AI's SIP leg hangs
up, the caller stays connected and we get a new decision point. The action
callback carries `CallSid`, `ParentCallSid`, `DialCallStatus`
(`completed` / `no-answer` / `busy` / `failed`), `DialCallDuration` and an
error code.

`<Dial>` also takes `callerId`, `timeout` (5–120s, default 30), `timeLimit`,
and **`passDiversionHeader`** — which matters, because Telnyx validates
external transfers against call spoofing and *requires* a `Diversion` header
carrying the Telnyx number on the outbound leg. A transfer without it is
rejected.

**So the whole feature is expressible in TeXML.** No Call Control client, no
SIP REFER, no new credential. That is worth stating plainly because the repo
makes exactly **one** outbound Telnyx call today — `POST /v2/messages` in
`lib/sms/telnyx.ts:22`, messaging-only and not reusable — so a Call Control
approach would have meant a new authenticated HTTP client for a feature that
does not need one.

## The three things that were wrong or missing in the draft

**The draft's "the actual work is an action type that reaches the carrier" is
half right.** `VoiceAction` is indeed a single-variant union
(`call-events.ts:6`), produced in one function and consumed at exactly one line
(`incoming/route.ts:539`). But the new variant does not reach the carrier — it
only closes the socket. TeXML's `action` URL does the rest. One variant, one
handling site.

**A transferred call would text the caller "Sorry we missed you just now."**
This is the finding that most shapes the design. A call ending with no booking,
lead or message classifies `abandoned` (`call-state.ts:62`), and `abandoned` +
`textback_enabled` + a caller number fires the missed-call text-back
(`finish-call.ts:367`). A caller *successfully handed to a human* would receive
an apology for missing them. Nothing else would fire either: no staff alert, no
contact, no conversation, because `abandoned` is not `isMeaningful`.

**`alert_phone` cannot be the transfer target.** It is the only business-side
phone column in the schema and it is verified by SMS possession — but that flow
returns `alertPhoneNotClearedToSend` when the A2P gate fails
(`settings/actions.ts:308-309`). Reusing it would put SMS carrier registration
in front of a voice feature. It also forces one destination for two different
jobs: a business may want lead alerts on an office manager's mobile and callers
on the main line.

## The design

### Where the number lives

A new `accounts.transfer_phone`, E.164-checked exactly like `alert_phone`
(`0035_alert_phone.sql:30-33`), set by the **agency** on the account's voice
settings. **The field IS the switch** — no number, no transfer offered, and
that is not a failure. Same doctrine `alert_phone` already states.

**Not verified by possession, deliberately, and this is the design's weakest
point stated honestly.** The agency sets it, the agency already has trusted
write access to everything else about the account, and gating it behind the
SMS verification would re-import the A2P dependency this decision exists to
avoid. The mitigations are that a wrong number rings out and falls back
(below), and that the number is visible in settings. Possession verification is
a worthwhile follow-up, not a prerequisite — but note the asymmetry it leaves:
a wrong `alert_phone` leaks a one-line notification, while a wrong
`transfer_phone` connects a live stranger to whoever answers.

**A transfer must refuse any number the account owns — in BOTH places, not one.** The check belongs at `setTransferPhone`'s call site *and* in the dial path. A CHECK constraint cannot express it, and a number saved before a `phone_numbers` row exists would pass the save-time guard and still loop at call time. Setting
`transfer_phone` to the account's own BIS line would loop the caller back into
Sofía. `refusesAlertLoop` (`lib/sms/sender.ts:71-79`) already performs exactly
this check for alert texts, against every number the account owns in `testing`
or `live` — the transfer guard mirrors it.

### Who decides

**The caller asks. Nothing else.** No AI judgement, no after-hours rule, no
intent classification. `system-prompt.ts:20`'s existing instruction changes
from "offer to take a message" to "offer to put them through" — but only when
a transfer target is configured; otherwise the current message copy stands
unchanged.

A rule-based transfer was considered and rejected for this version. The data
for "is the business open right now" exists (`calendars.open_hours`) and the
arithmetic has a working precedent (`countAfterHours`, `metrics.ts:224-238`),
but there is no live predicate, none of it is wired into the prompt, and
`after_hours` today changes exactly one block of prompt text and nothing else.
That is a second feature.

### The flow

1. `dialXml` gains `action` and `method` on the SIP `<Dial>`, plus a TOKEN IT
   MINTS ITSELF (`newHandoffToken()`) written in two places: onto the SIP URI
   as `X-BIS-Handoff` — the identical trick `X-BIS-Called` already uses
   (`texml/route.ts:5`), for the identical reason — and into the action URL's
   own query string as `?t=`. The two must be the same token or the action
   route can never find the call.

   **Superseded 2026-09-16, and this passage was corrected after the fact:**
   the draft above this line smuggled the Telnyx `CallSid` as `X-BIS-CallSid`
   and matched on `ParentCallSid`. The minted token replaced it and is better —
   a `CallSid` is an IDENTIFIER the carrier also knows and puts in its own
   webhooks, while a token is a CREDENTIAL only we ever mint, unique
   (`calls_handoff_token_unique`, 0037) and unguessable, which is what lets the
   action route resolve a tenant with no session at all. A reader who built
   from the old two sentences would build the wrong thing.

   The token is minted on EVERY bridge, not only on calls that go on to ask for
   a person, so holding one proves nothing about intent —
   `calls.handoff_requested_at` is what proves that. Because it rides a query
   string it also reaches carrier and platform logs, so the handoff route
   refuses it once it is more than ten minutes old (`MAX_TOKEN_AGE_MS`); it is
   NOT single-use, because the result route is handed the same token.
2. The webhook stores that token on the `calls` row at accept time
   (`calls.handoff_token`), so the action callback can find the call it belongs
   to from the token alone.
3. A new `transfer_to_human` tool records the intent in `CallState` and returns
   a result telling the model to say one handoff line. A tool cannot touch the
   call — `ToolContext` carries no socket and no call id — so the tool marks,
   and the lifecycle acts.
4. A new `VoiceAction` variant closes the socket after that line is spoken,
   handled at the one site that consumes actions.
5. The SIP dial ends. Telnyx requests the action URL. If the call asked for a
   transfer and the account has a usable target, it answers with
   `<Dial callerId="{the dialled BIS number}" timeout="20"
   passDiversionHeader="true" action="{result URL}">{transfer_phone}</Dial>`.
   Otherwise `<Hangup/>` — the ordinary end of every call that did not ask.
6. The result URL reads `DialCallStatus`. `completed` stamps the call as
   transferred. `no-answer` / `busy` / `failed` speaks one honest line and
   hangs up.

### What the call records

**A fourth `ServedAction`: `"transferred"`.** That type exists for precisely
this case — its own comment says it records "a tool outcome that means the
receptionist actually DID something for this caller, even though the call ends
with no booking, lead or message of its own" (`call-state.ts:15-18`). It has
two readers, and both matter: the text-back gate — the thing that must not
fire here — and `summaryFactLine`, which uses it to say the transcript covers
only the part before the handoff. One producer, one fact, two consumers. An
earlier draft of this document said one reader; folding the summary's flag
into the same field is what made it two, and that is better than the two
separate fields it replaced.

**`calls.outcome` gains `transferred`.** This needs a migration to widen the
CHECK constraint (`0019_voice_core.sql:53-54`) and touches every consumer of
`CallOutcome`. It is worth it: recording a caller who reached a human as
`abandoned` is a lie the client reads on their own dashboard, and this codebase
refuses that kind of dishonesty elsewhere — the weekly report omits what it did
not measure rather than reporting zero, and the summary carries a MISMATCH
banner rather than asserting what it cannot support.

**No staff alert and no alert text fire on a completed transfer, and
`transferred` is therefore NOT `isMeaningful`.** An earlier draft of this
document said the opposite. Two things corrected it, one structural and one
about what an alert is for.

Structurally, the alert decision happens inside `finishCall`, which runs at
socket close — before the result route knows whether anyone picked up. Firing
an alert for a transfer would mean a SECOND send path inside a TeXML route,
duplicating the email and SMS machinery. This repo has exactly one send path
and has verified that property deliberately.

And it should not fire anyway: a person at the business just spoke to the
caller live, so they already know. An alert exists for work that might be
MISSED. Telling someone about the call they personally answered is noise.

A ring-out is the case that genuinely goes unnoticed — and it records as
`abandoned`, which is the truth, and follows whatever this product already
does with an abandoned call. Alerting specifically on a failed transfer is a
reasonable future refinement; it is not this version.

**The transcript covers only the AI half, and the call row must not pretend
otherwise.** Transcript capture lives on the OpenAI socket
(`call-events.ts:44-57`); once the call leaves it, nothing is recorded,
transcribed or timed. `durationSecs` measures to socket close, so the human
conversation is invisible. The summary must say so in the deterministic fact
line rather than summarising half a call as if it were whole.

### Failure and cost

- **Nobody answers.** The caller was told they are being put through, so
  silence is the one unacceptable outcome. `timeout="20"` then one spoken line,
  and the call records `transferred` with the ring-out noted. Letting the
  existing missed-call text-back fire here is a natural follow-up — it is
  genuinely a missed call — but it runs from `finishCall` on a socket that has
  already closed, so it is plumbing this version does not do.
- **No target configured, or the target is an owned number.** No offer is made
  at all; the prompt keeps today's take-a-message copy. The guard is checked
  before the model is ever told a transfer is possible, so Sofía never offers
  what she cannot deliver — the same rule the alert-phone readiness work
  settled on 2026-09-15.
- **The outbound leg bills.** It is a normal PSTN call on the account's own
  number, bounded by `timeLimit`. Unlike the Realtime session there is no model
  cost, so a long human conversation is cheap by comparison.
- **Caller ID.** The business sees the BIS number that was dialled, not the
  original caller. Telnyx requires an owned number on the outbound leg — the
  same constraint `forwardXml` already documents (`texml/route.ts:182-184`).

  **The rule as shipped (2026-09-16):** the caller id is resolved from
  `calls.phone_number_id` — the row for the number that actually rang — matched
  against the account's own numbers and required to still be `testing` or
  `live`. Only if that row is gone from the list (moved to another account, or
  released) does it fall back to any owned number, live preferred over testing,
  and it is omitted rather than faked when the account has none. "Any owned
  number" was the first implementation and is wrong on the account that owns
  two live numbers: a customer calls B, the handset shows A, and A is a number
  that customer never dialled and may not recognise.
  A business seeing its own tenant number is confusing, and the honest fix is
  for Sofía to say who is calling before transferring, which she can: she has
  the caller's number and usually their name.

## Out of scope

IVR menus. Call queues. Multiple simultaneous destinations. Warm transfer
(Sofía speaking to the human first), which needs a conference, not one SIP leg.
Recording the human half. Anything that makes this a phone system rather than a
receptionist that knows when to step aside.

## Testing

**The boundary that matters: a transfer must never reach a number belonging to
a different account.** `transfer_phone` is read from the account resolved by
the dialled number, and the test must assert the ordering — that the account is
resolved before the number is read — not merely that both happened. The agency
work queue's guard test is the shape.

Alongside it, and each proven by mutating the code it guards until a named test
fails:

- A transfer to a number the account owns is refused. The loop is the failure
  mode; the test is the guard.
- A transferred call does **not** fire the missed-call text-back — the finding
  that most shapes this design, so it gets the sharpest mutation.

  **The mutation is `wasServed` ceasing to count `"transferred"` as served**
  (e.g. `state.served.some((a) => a !== "transferred")`). That compiles, and
  until this test existed the whole suite survived it — while a caller
  successfully put through to a human got texted "Sorry we missed you just
  now".

  It is stated that way because the mutation this section used to prescribe —
  removing `"transferred"` from `ServedAction` — is a **compile** failure, and
  a red `tsc` is exactly what let an earlier wave treat type-checking as the
  proof. A type error tells you a string is missing from a union; it tells you
  nothing about whether the marker still suppresses a text message. The
  behaviour-level mutation must compile, or it is not testing behaviour.

  The test that must go red by name: `does NOT text a caller we put THROUGH TO
  A PERSON` (`apps/web/src/lib/voice/finish-call.test.ts`), run through
  `finishCall` on `withTransferred(abandonedState())` and asserting `send`,
  `createContact` and `createMessage` were none of them called. A test that
  only asserts `served` contains `"transferred"` restates `withTransferred`'s
  one line and stays green through this mutation.
- A transferred call records `transferred`, not `abandoned`.
- `no-answer`, `busy` and `failed` each produce a spoken line, never silence.
- With no `transfer_phone` set, the action URL answers `<Hangup/>` and the
  prompt never offers a transfer.
- The minted token survives to the `calls` row (`calls.handoff_token`) and the
  action callback resolves the call from it alone — the token on the SIP URI
  and the token in the action URL must be proven EQUAL, since two separately
  minted tokens type-check, emit valid TeXML and can never match. A call that
  cannot be matched must hang up rather than transfer to a default. (Corrected
  2026-09-16: this bullet named `X-BIS-CallSid` and `ParentCallSid`, the
  superseded mechanism — see the flow's step 1.)
- Every document either TeXML route emits PARSES. Asserting that a token is
  present is not the same measurement, and the difference is not academic: the
  bridge shipped with a bare `&` joining two SIP URI parameters — a fatal XML
  well-formedness error on the path every real inbound call takes — under
  130/130 green substring assertions.

`forward.test.ts` already covers parsing and normalisation of the global
override and is the obvious place to grow the second half of this.

## What this does not change

`VOICE_FORWARD_TO` stays exactly as it is: a global operator override that
fires before the AI answers, ahead of every gate, for taking a line back by
hand. It is not per-account and is not a transfer. Nothing in this design
touches it.
