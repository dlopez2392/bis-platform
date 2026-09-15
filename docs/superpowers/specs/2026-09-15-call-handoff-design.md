# Handing a call to a human — design

**Date:** 2026-09-15 · **Branch:** `docs/feature-specs` · **Base:** `6613c09`
**Status:** IDEA. Not planned, not scheduled. The findings below were read from
the tree; the design is not settled.

## Why

danlo, 2026-09-15: when a customer calls the number a business is assigned,
there should be an option to forward that call to a number the business
provides, so the caller can reach an actual person.

Today the answer to "can I speak to someone?" is a message and a callback.

## What happens on a call today, verified

Two entry points, chained:

1. `api/voice/texml/route.ts` — Telnyx hits this for every inbound call.
   `classify()` resolves the dialed number, then returns TeXML. Three exits:
   spoken refusal + hangup (unknown or inactive number), spoken cap message +
   hangup, or `<Dial><Sip>` bridging to OpenAI's SIP connector.
2. `api/voice/incoming/route.ts` — OpenAI's `realtime.call.incoming` webhook.
   Opens a `calls` row, accepts, then runs `runCallLifecycle()` on a WebSocket
   that lives for the whole call.

Exits from the live call: caller hangs up, socket error, connect timeout
(`PHONE_CONNECT_TIMEOUT_MS`, 15s), or the cost cap
(`PHONE_MAX_CALL_SECONDS`, 240s) which asks for a goodbye then closes.

**There is no path where the call leaves the AI and reaches a person.** No
`<Dial>` to a PSTN number after answering, no SIP REFER, no Call Control
transfer, no warm or cold handoff.

## Two things that look like forwarding and are not

**The setup step named `forwarding`** (`lib/setup/setup-status.ts`, step 7 of 9)
is the *opposite direction*. Its own copy, `messages.ts:1082-1088`:

> The client forwards their business line to the number below at their carrier.
> Tick when confirmed.

It is a manual localStorage tick (`setup:forwarding_done`). It stores no number,
triggers no behaviour, and is deliberately excluded from `goLivePrereqsMet()`.

**`VOICE_FORWARD_TO`** (`api/voice/texml/route.ts:132-139`) *is* real call
forwarding, and is the closest existing primitive — but it is a **bypass, not a
transfer**:

- A **global** env var. One value for the entire platform, not per business.
- It fires **before the AI ever answers**, deliberately ahead of routability and
  cap checks. Sofía never speaks.
- Its documented purpose is an operator override, born from needing to receive a
  voice verification code.
- Outbound caller ID is **our** number, not the original caller's. Telnyx
  requires an owned number on the outbound leg.

That file also records the constraint that shapes any design here:
**Telnyx refuses its own per-number call forwarding on a TeXML-utilising
number.** Any forwarding must be expressed in TeXML or Call Control.

## Where the seam is

There is a mature mid-call tool mechanism, and it is the right place.
`lib/voice/tools/registry.ts` and `tools/schemas.ts` already carry eight tools:
availability, book, reschedule, cancel, find-my-booking, capture-lead,
take-message, log-transcript.

**None of them can affect the call itself.** Every tool returns
`{ state, result }`, and `VoiceAction` is a single-variant union
(`{ kind: "send" }`), so there is currently no way for a tool to say "do
something to the telephony leg". Adding a ninth tool is routine. Adding an
action type that reaches the carrier is the actual work.

## What happens today when a caller asks for a person

Deliberate, and poor. `lib/voice/system-prompt.ts:20` instructs Sofía to answer
honestly that she is automated, then **offer to take a message**. `take_message`
writes to `CallState`, and at hangup produces outcome `message`, a contact, a
conversation, a `voice` message row and a staff alert email.

The caller gets an asynchronous callback. Never a live person.

## Open questions — none of these are decided

**Whose number, and where does it live?** Nothing in `accounts`, `calendars`,
`voice_profiles` or the A2P table stores a business phone. This needs a column
and a settings surface, and it overlaps with
`2026-09-15-lead-sms-alerts-design.md` — the same number may serve both, or may
deliberately not.

**Who decides to transfer?** The caller asking, the AI judging, or a rule
(after hours, certain intents)? Each is a different product.

**What happens when nobody answers?** A transfer that rings out is worse than
the message we take today, because the caller has already been told they are
being put through. Voicemail, fall back to Sofía, or take a message anyway.

**What does the business hear?** A cold transfer drops a stranger on them. A
warm one needs Sofía to speak to the human first, which the current
architecture cannot do — it is one SIP leg, not a conference.

**Does the call stay recorded?** Transcript capture lives on the OpenAI socket.
Transfer away and the transcript stops. A call that becomes a human
conversation produces a half transcript and a summary of only the first half.

**Cost and caller ID.** The outbound leg bills, and shows our number. A
business seeing its own tenant number calling is confusing at best.

**Is it even transfer, or a callback?** "Press 1 and we will call you right
back" avoids the carrier constraint, the ring-out problem and the caller-ID
problem entirely. Worth considering before building the harder thing.

## Out of scope

IVR menus. Call queues. Multiple simultaneous destinations. Anything that makes
this a phone system rather than a receptionist that knows when to step aside.

## Testing, when this is real

The boundary that matters: a transfer must never reach a number belonging to a
different account. The existing agency-only work queue spec's guard test is the
shape — assert the ordering, not just the presence, of the check.

`api/voice/texml/forward.test.ts` already covers parsing and normalisation of
the global override and is the obvious place to grow.
