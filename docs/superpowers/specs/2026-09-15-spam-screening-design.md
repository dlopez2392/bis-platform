# Not paying to talk to robots — design

**Date:** 2026-09-15 · **Branch:** `feat/spam-screening` · **Base:** `bda1b94`
**Status:** DESIGNED, approved 2026-09-15. Supersedes the IDEA draft written on
`docs/feature-specs` — the survey below is kept, the open questions are now
answered.

> **Line citations below are a snapshot, re-derived after both guards shipped.**
> Guard 1 alone moved every line under it in `incoming/route.ts` by ~50. Each
> citation names the symbol or quotes the text it points at — if a number has
> drifted again, grep the quoted text and trust that, not the number.

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
(`lib/voice/call-state.ts:58-64`) reaches `abandoned` *only when a caller
spoke* — that is the branch's condition, and `spam` is the fall-through with
none. Live data agreed: abandoned averages 5.0 transcript events and carries
the longest summaries on file. There is real content there.

**It removed a fabrication, not just a bill.** See "The call this feature is
built from" below — that call is the one PR #64 was describing.

## Where the money actually goes

| Call site | Model | Reachable by an unsolicited caller? |
|---|---|---|
| `api/voice/incoming/route.ts` — the Realtime socket | `gpt-realtime` + `gpt-4o-mini-transcribe` | **Yes.** Billed audio up to `PHONE_MAX_CALL_SECONDS` (240s) |
| `lib/voice/summary-service.ts` | `gpt-4o-mini` | Was yes; now skipped for `spam` |
| `api/voice/web/session/route.ts` | Realtime, marketing demo | Origin allowlist + signed ticket |

Those are the only model calls in the product. `grep gpt-` returns three lines.
The contact "summary" route is pure database aggregation despite its name.

**So the remaining spend is the Realtime session itself:** up to four minutes of
billed audio before anything decides the call was spam.

## The call this feature is built from

One row in the live `calls` table is the entire argument. Account "Bespoke
Intelligent Solutions", 2026-08-30, `outcome: spam`, `duration_secs: 247`,
`turn_count: 2`. Both turns are the assistant's; there is no caller turn at all,
which is what makes it `spam`:

```
23:38:44  assistant  "Hello and welcome to Bespoke Intelligent Solutions.
                      How can we assist you today?"
23:42:44  assistant  "Entendido, podemos revisar la disponibilidad para el
                      miércoles 4 de septiembre. Un momento, por favor..."
```

Exactly four minutes apart, nothing in between. The greeting played, **240
seconds of billed silence followed**, `capTimer` fired the wrap-up instruction
at `PHONE_MAX_CALL_SECONDS`, and Sofía answered a caller who had never spoken —
in the wrong language, about an appointment nobody requested. That hallucination
is what the summary model then turned into the fabricated record PR #64
describes: *"the caller asked to review availability for Wednesday,
September 4."*

**The most expensive call on file and the fabricated record are the same
event.** Both have one cause: nothing notices silence until the cost cap fires.

Every other genuine `spam` call in the database ran 6, 7, 12 and 17 seconds —
those callers hung up on their own and cost almost nothing. The expensive shape
is not the robot that hangs up. It is the one that stays on the line.

## What the data does and does not say

Read before assuming this feature is urgent:

- **Exactly one real phone number is reachable today** — Bespoke's
  `+19565061545`, status `testing`. Resaca's `live` number is a seeded `555`
  fixture and Test Client One's is `released`. There is no bleeding to stop this
  week. This ships so the mechanism exists *before* a client's number goes live
  and gets scraped.
- **There is not a single real robocall on file.** All 56 calls come from two of
  danlo's own numbers. The five genuine `spam` rows are test calls where nobody
  spoke. So this design cannot be tuned against a real robocall corpus, and must
  not pretend otherwise — every threshold below is a starting value behind an
  env var, not a measured optimum.
- **`+19562921696` is simultaneously the top spam caller (4) and the top
  booker (13) — ACROSS BOTH of danlo's accounts.** That pair is a cross-account
  aggregate, and this document's rule is explicitly per account (below), so the
  two numbers cannot be reconciled with a per-account query. **Corrected here
  rather than deleted, because the constraint survives the correction.** Per
  account the same caller is (2 spam, 11 other) on one and (2 spam, 2 other) on
  the other: still, on each account separately, a caller with real spam rows and
  real good outcomes. Any reputation rule that counted spam without also
  requiring zero good outcomes would have blocked the best customer in the
  database at either gate. This is the single most important constraint in this
  document, and `caller-reputation.test.ts:39-43` pins the clause with the
  aggregate figures as its fixture.
- **No caller on any account reaches `spamCalls >= 3`.** The maximum anywhere
  is 2 — one short of the default threshold. So Guard 2 would refuse **nobody**
  in the database as it stands today. That is the "blast radius today is near
  zero" claim, established from the data rather than from the argument about how
  few numbers are reachable. It also means the threshold has never been
  exercised against a real caller, only against fixtures.
- **There is not a single `turn_count = 0` row in the entire `calls` table.**
  The connect-timeout exclusion (`turn_count >= 1` on the spam count, below) is
  therefore a **prediction, not an observation**: it guards a shape production
  has never yet produced. Still the right guard — the row it excludes is our own
  outage being charged to a caller, which is the worst false positive available
  here, and the cost of being wrong in the other direction is only that one
  robot gets one extra call. But it must not be described as something the data
  showed, and if a `turn_count = 0` row ever does appear it is worth reading
  before trusting this reasoning further.

## What stands in front of the model today

Only three things, and only one is a volume control:

1. Tenancy — is this a number we know, is the profile enabled
   (`texml/route.ts:77-99`, re-checked authoritatively at
   `incoming/route.ts:605-628`, steps 6–7).
2. `callAnswerable` (`lib/voice/accept-gate.ts:26-32`).
3. Daily caps — `PHONE_MAX_CALLS_PER_NUMBER_PER_DAY` (5) and
   `PHONE_MAX_CALLS_PER_ACCOUNT_PER_DAY` (50), counted off the `calls` table.

Refusals in `api/voice/texml` are spoken and hung up **before the SIP bridge**
(`respond()` at `texml/route.ts:213-233`, where `dialXml` is unconditionally the
last line), so a refused call never reaches OpenAI at all. The webhook has a
second zero-token refusal zone of its own: nothing is billed until `acceptCall`
at `incoming/route.ts:814`, and a decline there is expressed simply by never
calling it.

**The caps fail open on a database error**, by explicit decision — "losing a
prospect costs more than paying for one extra robocall"
(`incoming/route.ts:43-60`, contract #3, which enumerates every fail-open site
in that route and is kept exhaustive so an auditor does not "harden" one).

There is no caller reputation check, no blocklist, no first-time-caller screen,
and no per-account cost budget. Nothing reads CNAM or any carrier risk signal.

## The design

Two guards. Neither one asks a real customer to prove anything, and both reuse
machinery already proven in production.

### Guard 1 — the silence cutoff

**The problem it solves:** a call that connects and then produces no caller
audio at all bills up to 240 seconds.

In the Realtime lifecycle (`incoming/route.ts`, inside `ws.on("open")`), arm a
`silenceTimer` beside the existing `capTimer`. Cancel it the first time the
caller makes any sound. If it fires, run the same SHAPE of goodbye →
`ws.close()` chain `capTimer` already runs (`incoming/route.ts:334-348`) — a
`response.create` instruction, then the socket closed 5s later so it plays out.

**It is deliberately not the same chain, and must not be "restored" to one.**
Two divergences, both load-bearing, both pinned by tests:

- The instruction is its own **fixed sentence** (`silenceGoodbye`), never the
  cap's open-ended "Politely wrap up…". Asking a model to wrap up a
  conversation that never happened is asking it to invent one — which is
  exactly what the 247-second call's summary recorded as fact.
- The silence callback also **clears `capTimer`**. The cap has nothing left to
  bound once the call is ending, and leaving it armed lets it speak its
  open-ended wrap-up over the fixed goodbye on any configuration where the two
  land close together. Sharing one chain between the timers would reopen that
  path.

This is not new machinery. It is a second instance of proven machinery with a
shorter fuse and a cancel condition.

- **Window:** `PHONE_MAX_SILENT_SECONDS`, default **30**. Armed at
  `ws.on("open")` alongside `capTimer`, not after the greeting — one timer, one
  origin, no second lifecycle concept.

  **The knob's own clamp is not the window, and the difference is
  operator-visible.** The armed window is

  ```
  min( clamp(PHONE_MAX_SILENT_SECONDS, 5..120), PHONE_MAX_CALL_SECONDS / 2 )
  ```

  (`silence-guard.ts:48-52` for the clamp, `incoming/route.ts:389` for the
  bound). Half the cost cap, because the two knobs are independent in the
  environment and `120` with a cap of `60` is a legal pair an operator reaches
  by two individually sensible edits — under which the CAP would fire first on
  a silent call and hand the model its open-ended "Politely wrap up…", which is
  exactly how the 247-second call produced a fabricated summary. *Half*
  specifically, not "cap minus something": half is strictly less than the cap
  for every positive cap and so can never TIE it, and a tie fires the cap first
  (same-deadline timers run in insertion order, and `capTimer` is armed a few
  lines earlier).

  **That bound is why this branch also puts a 10-second FLOOR on
  `PHONE_MAX_CALL_SECONDS`** (`incoming/route.ts:333`, now clamped `10..750`).
  The floor has nothing to do with the cap — a 1s cost cap is absurd but
  harmless on its own. It exists so half the cap can never land under the
  guard's own 5s minimum: measured off the route's log line, a cap of 8 armed a
  4s window and a cap of 1 armed 0.5s, and the silent caller heard "I can't
  hear anything, goodbye" 400ms *before* the 900ms greeting reached them.
  Flooring the CAP is what makes the half-bound incapable of undercutting the
  clamp it is applied to; flooring after the `min` instead would let the window
  TIE the cap. Both ends of the `min` are therefore >= 5, so the 5s floor —
  which is what guarantees the greeting has played — holds for every legal pair.

  Pinned by two tests in `incoming/lifecycle.test.ts`: "the two cost knobs
  cannot invert" and "the window's 5s floor survives the half-cap bound".
  `.env.example` documents both knobs in these terms.
- **Cancel signal:** any event indicating the caller produced audio. The event
  vocabulary must be **read off a real call, not assumed** — log every inbound
  event `type` for one silent call and one spoken call, then pin the set. This
  is the same discipline the voice runbook already uses for `sipHeaderNames`.
  The guaranteed backstop is
  `conversation.item.input_audio_transcription.completed`, which is the exact
  event `classifyOutcome` keys `spam` off; `input_audio_buffer.speech_started`
  is the faster signal if it is confirmed to arrive under `semantic_vad`. Cancel
  on either. Never cancel on an assistant/response event.
- **The caller hears a fixed line before the hangup**, not dead air — a human on
  a broken microphone deserves to know why the call ended, and it costs **five
  seconds**: the guard closes the socket on the same 5000ms playout delay the
  cost cap uses (`incoming/route.ts:420-423`, matching `344-347`), deliberately
  the same number so there is one playout constant rather than two. It must use
  the **constrained** utterance form the greeting already
  uses, `Greet the caller with exactly: ${greeting}`
  (`incoming/route.ts:255-258`) — **not** the cap's open-ended
  `"Politely wrap up and say a brief goodbye to the caller — we're out of time"`
  (`incoming/route.ts:337-340`).

  That distinction is the whole reason the fabricated record exists. Asking a
  model to "wrap up" a conversation that never happened is asking it to invent
  one, and on the 247-second call it did exactly that. The cap keeps its
  open-ended instruction, which is correct for a *real* conversation that runs
  long; Guard 1 gets the fixed line, because on a silent call there is nothing
  to wrap up.

  Note what this means: the fabrication path closes **without touching the
  cap**. A silent call simply never reaches 240 seconds any more.

**Why this is safe:** the cutoff and the end-of-call classification agree *by
construction*. A call cut for silence is exactly a call that `classifyOutcome`
would have labelled `spam` anyway, because both read the same signal. Nothing
downstream changes: no summary (PR #64's guard), no conversation, no unread
bump, no text-back (that gate is `abandoned` only, `finish-call.ts:367`).

**What it would have done to the call above:** cut it at 30s instead of 247s —
an 88% reduction on the worst call on file — and removed the hallucinated turn
along with it, because the open-ended wrap-up instruction that produced it never
fires on a call that ends at 30 seconds.

### Guard 2 — repeat-offender refusal

**The problem it solves:** the same robot calling back tomorrow.

A fourth variant on the `Routability` union in `texml/route.ts:30-39`, branching
in `respond()` **above** the unconditional `return xmlResponse(dialXml(...))`
(`texml/route.ts:232`). The decision itself lives in a new pure
module and is called from **both** voice gates, exactly as `callAnswerable` is:

> *"The ONE shared predicate both voice gates call — the OpenAI webhook's accept
> decision and TeXML's spoken-refusal decision — so the two can never drift out
> of agreement."* — `lib/voice/accept-gate.ts:13-17`

- **New pure module** `lib/voice/caller-reputation.ts`, shaped like
  `call-limits.ts`: no database, trivially unit-testable, with the try/catch and
  fail-open wrapping left to the callers.
- **New read** `countCallerHistorySince` in `packages/db/src/voice.ts`. It
  returns **two counts** — `{ spamCalls, otherCalls }` — for one caller on one
  account since a timestamp, **not a list of `outcome`/`turn_count` rows**.
  Corrected to follow the implementation, which argues the point at length
  (`voice.ts:199-204`): both halves run `count: "exact", head: true`, so no rows
  travel and neither query needs a `.limit()`. A limited list could truncate
  away an older good outcome and produce a false block, which is the one
  failure this guard must not have. **No migration is needed** —
  `calls_caller_idx (account_id, caller_e164, started_at desc)` already exists
  (`0019_voice_core.sql:64`) and carries both queries.
- **In TeXML** the read joins the existing `Promise.all` next to the two cap
  counts (`texml/route.ts:126-132`), so it adds **no wall-clock** on Telnyx's
  carrier answer deadline. In the webhook it follows the caps' sequential shape.

**The rule.** A caller is refused when, within the window, they have at least
`PHONE_SPAM_BLOCK_THRESHOLD` calls on this account that **all** classified
`spam`, and **zero** calls of any other outcome:

- **Zero good outcomes ever in the window is mandatory**, not a refinement. See
  the live-data constraint above: the top spam caller is also the top booker —
  and still is when the aggregate is split per account, which is the sense that
  matters here. One booking, lead, message or even `abandoned` in the window
  clears the caller completely.
- **`turn_count: 0` rows are excluded from the count.** A connect-timeout also
  records `spam` with no turns (`incoming/route.ts:201-209`); that is our
  infrastructure failing, not a robot, and blocking a caller for our own outage
  is the worst possible false positive. A genuine silent call still carries the
  greeting, so it has at least one turn.
- **Per account, not global.** One client's robocaller is not another's, and
  `calls` has no cross-account caller index anyway.
- **Rolling window**, `PHONE_SPAM_BLOCK_WINDOW_DAYS`, default **30**. This is
  load-bearing, not cosmetic: a refused call writes **no `calls` row**
  (`startCallRow` is step 10, after every gate), so a blocked caller can never
  produce the good outcome that would clear them. Without a rolling window the
  block is permanent and unappealable. With one it expires on its own.
- **Threshold** `PHONE_SPAM_BLOCK_THRESHOLD`, default **3**. Against the
  existing per-caller cap of 5/day, a robot is refused partway through its first
  day and costs nothing from then on.

**Copy: none is added.** A blocked caller hears the existing refusal line —
*"Sorry, this number can't take your call right now. Please try again later"* —
which is true, is already translated, and is already byte-pinned by a test. Only
the server log line distinguishes the reason, matching the three decline lines
already in `classify()`.

### The bounded worst case

Per caller, per account, per UTC day:

| | Worst case |
|---|---|
| Today | 5 sessions × 240s = **20 minutes** of billed audio |
| After Guard 1 | 5 × 30s = **2.5 minutes** |
| After Guard 2, from the next call | **zero** |

## Decisions, and what was rejected

**The caps keep failing open.** Guard 1 changes the arithmetic in the original
decision's favour: a failed cap read now costs at most ~30 seconds of audio
instead of 240. "Losing a prospect costs more than paying for one extra
robocall" was already sound; it is now roughly eight times more sound. Do not
"harden" this.

**Rejected — answer, prompt, and wait for speech before bridging.** It is the
cheapest possible screen in carrier seconds, and it is out of scope by this
document's own rule: it makes every real customer prove themselves before they
reach the receptionist. It would also be a new TeXML verb for this codebase —
there is no `<Gather>`, `<Record>`, `<Pause>` or `<Play>` anywhere in the repo,
and no precedent for a response that screens *and* bridges.

**Rejected — a per-account spend budget.** Caps count calls, not money, and a
budget would bound the bill directly. But it means a busy day can silence a
client's phone, which is worse than the spend.

**Deferred — carrier spam scoring.** Telnyx exposes signals this product does
not read, and nothing in the repo reads CNAM or any risk field. Cheaper than
anything we could infer ourselves and worth checking — but it is a research
dependency with a per-lookup cost, and Guards 1 and 2 need no external data at
all. Revisit if real robocall volume ever appears.

## Out of scope

Anything that makes a real customer prove themselves. A receptionist that
interrogates callers is worse than the spend it prevents.

Inbound texts. They have no spam concept at all — no status, no column, no rate
limit beyond the carrier's own — but they also cost nothing, and a guard with no
bill behind it is speculation.

## Known properties, accepted

- **A refused call is invisible in the product.** No `calls` row is written, so
  a blocked caller appears nowhere in the UI — only in a server log line. This
  is not new: unknown-number and over-cap refusals already behave exactly this
  way. Accepted as consistent with existing behaviour; surfacing refused calls
  is a worthwhile follow-up, not part of this work.
- **A call whose `To` cannot be parsed skips every gate and dials**
  (`respond()`'s `if (calledE164)` guard, `texml/route.ts:223-231`, pinned by a
  test). Pre-existing, unrelated to spam, left alone.
- **`VOICE_FORWARD_TO` bypasses both guards**, deliberately, because it sits
  ahead of every gate by design (`texml/route.ts:214-222`). An operator who has
  taken the line back must not have calls swallowed by a spam rule.

## Testing

**The rule that matters, and the reason this section exists:** a refusal must
happen **before** the SIP bridge, and a test must fail if that ordering is ever
reversed.

Today that guarantee is enforced *by absence*: every refusal test asserts
`expect(xml).not.toContain("<Dial")`. That is strong for the current shape — one
response body cannot hold both — but **nothing pins that `classify()` runs
before `dialXml()`**, and the absence assertion would not catch a future design
where a screen and a bridge legitimately coexist in one document. Guard 2 must
add the real ordering pin, on the model of the agency work queue's guard test:
prove the ordering by moving the guard and watching the test fail.

Every test in this work is proven by **mutating the code it guards and watching
it fail by name**. A prescribed mutation that stays green is investigated, not
accepted. This codebase has shipped eight tests that could not fail on their own
claim; do not ship a ninth.

Specifically:

- Guard 1's timer must be proven to **cancel** — a test where the caller speaks
  must fail if the cancel is removed, and a test where nobody speaks must fail
  if the timer is removed. Both directions, or the test proves nothing.
- Guard 1 must be proven not to change the recorded outcome: a cut call still
  classifies `spam`, still writes no summary, still sends no text-back.
- Guard 1's goodbye must be pinned to the **constrained** form. A test asserting
  the instruction contains `exactly:` fails if someone later "unifies" it with
  the cap's open-ended wording — which would reopen the fabrication path this
  feature exists to close. The cap's own instruction must stay unchanged, and a
  test should say so, because the obvious refactor is to share one string.
- Guard 2's "zero good outcomes" clause gets a test built from the real shape in
  the database — a caller with 4 spam and 13 good calls is **allowed**. That
  test fails if the clause is dropped, which is the whole point of it.
- Guard 2's `turn_count: 0` exclusion gets its own test; dropping the exclusion
  must turn a connect-timeout victim into a blocked caller.
- Guard 2's window must be proven to expire: the same history, read one day past
  the window, allows the call.
- The shared predicate must be proven to be shared — both gates agree, on the
  model of `accept-gate.test.ts`.

## Rollout

Blast radius today is near zero and should be stated rather than assumed: one
reachable number, on danlo's own account, in `testing`. Ship both guards
together with their defaults; the thresholds are env vars precisely because
there is no real robocall corpus to tune them against yet.

The first real tuning signal will be a genuine `spam` row with a duration at or
near `PHONE_MAX_SILENT_SECONDS` — that is a robot that stayed on the line and
was cut. The first sign of a false positive would be a `texml declined` log line
for a caller who then calls back and books.

## Addendum 2026-09-19 — hang up at the first IVR phrase (Option B)

**What #88 did and did not do.** It fixed the label — a talking robot is
`spam`, not `abandoned` — and it did not shorten the call. The predicate ran
only on `conversation.item.input_audio_transcription.completed`, and
`semantic_vad` lands a robot's whole ~470-character script as one turn, so
the hangup fired at the moment the robot would have hung up anyway. Measured
on 956 Woodworks: calls on 09-17 (no guard) and 09-18 (guard) both cost
38–56 seconds.

**What changed.** `call-events.ts` now also handles the API's incremental
`…input_audio_transcription.delta` frames, keeps the growing prefix per item
in `CallState.pendingCallerTurn`, and runs the SAME predicate on it. The
first delta whose prefix passes produces the existing `hangup`. The prefix
is written as the caller turn first — the audit trail. No change to the
predicate, the lifecycle, or the session config.

**What was considered and set aside.** (A) A per-account campaign signature —
the reputation rule's own safety condition ("refuse only when the caller's
ENTIRE history is spam") is disarmed by a single real call, and it can do
nothing for a campaign's first call. (C) STIR/SHAKEN attestation before
answering — nothing in the TeXML route reads an attestation field and it is
unconfirmed the carrier surfaces one; a "find out", not a fix.

**What this does not do.** It does not stop the call being answered, and it
does not stop the campaign. It makes each robocall cost roughly the seconds
up to its first "press 0 to" instead of the whole script (estimate: ~240 of
~470 characters in — word 40 of 80, where the predicate's `press <digit>
(to|for|and|if)` shape completes — plus Sofía's reply saved outright; the
real number comes from the next live call, not from this document).

**The rule that still binds.** Never keyed on "Google". Both conditions,
never either. A real caller is never cut: proven word by word in
`call-events.test.ts` and at the socket in `lifecycle.test.ts`, and the
negatives go red when the phrase clause is deleted.
