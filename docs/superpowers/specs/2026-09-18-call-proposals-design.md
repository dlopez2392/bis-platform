# A finished call proposes the next step — design

**Date:** 2026-09-18 · **Branch:** `feat/calls-propose-next-step` · **Base:** `main`
**Status:** Design approved by danlo, 2026-09-18 (scope and audience). Ready to plan.

## Why

**The work queue is empty.** Measured against production on 2026-09-18:

| Account | Contacts | Open tasks | Real calls | Opportunities |
|---|---|---|---|---|
| Resaca Air Conditioning | 40 | **0** | 34 | 16 |
| Test Client One | 5 | **1** | 18 | 1 |
| Bespoke Intelligent Solutions | 5 | **0** | 11 | 2 |
| 956 Woodworks | 0 | **0** | 15 | 0 |

One open task across the whole platform, against 78 real calls. Resaca has
sixteen opportunities and not one next action against any of them.

That is the finding this design exists to answer, and it is a stronger reason
than the competitive one. The work queue shipped. The account dashboard was
rebuilt to open on it rather than on KPI tiles. Both are correct and both are
currently **furniture** — they show a client an empty room. The material never
arrived because creating a task is a thing a human has to remember to do, after
a phone call, on a screen they are not looking at.

Sofía is already on the call. She already produces a transcript and an outcome.
Every call that ended "call me Tuesday" or "send me a quote" is a task nobody
created.

## What it may propose

danlo, 2026-09-18, chose the full scope over the narrower recommendation:
**a follow-up task, a contact-field fill, and an opportunity stage move.**

That is the widest blast radius of the three options offered, and it was chosen
knowing that. So containment is not a caveat in this design — it is the
architecture. The three sections under "Containment" below are the load-bearing
part of this document; the rest is plumbing.

## The decision that shapes everything: NOT a `tasks` row

A proposal is not a task. It must not live in `tasks` with a `proposed` status,
for the same reason a refused call did not become a `calls` row on 2026-09-18:

`bucketWork` (`lib/work/buckets.ts`), the account dashboard's work row, the
agency roll-up in `listAgencyWork`, and every count on both screens read
`tasks` without knowing about any status. Adding a state to that table means
teaching **every** existing reader to exclude it, and the failure mode of
missing one is that **a machine's guess renders as a real task a human
believes**. That is the exact defect this feature exists to avoid producing.

A separate table touches none of them.

## Data

New table `call_proposals`:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `account_id` | uuid not null | FK `accounts`, `on delete cascade`. Unlike `screened_calls`, every proposal has an account — it came from a call that reached one. |
| `call_id` | uuid not null | FK `calls`, `on delete cascade`. The evidence. A proposal with no call is not reviewable. |
| `contact_id` | uuid null | FK `contacts`, `on delete cascade`. Null for a task not tied to a person. |
| `kind` | text not null | `task` · `contact_field` · `opportunity_stage` |
| `payload` | jsonb not null | Shape per kind, below. |
| `evidence` | text not null | The transcript span the proposal rests on. **Not optional** — see Grounding. |
| `status` | text not null | `pending` · `accepted` · `dismissed`. Default `pending`. |
| `decided_at` | timestamptz null | |
| `decided_by` | text null | The Clerk user id. Not an FK — `users` is empty and assignment is dead. |
| `created_at` | timestamptz not null | |

`kind` and `status` both get CHECK constraints. These values are ours, not a
vendor's — the same position `calls_outcome_check` and
`screened_calls_reason_check` take.

**One pending proposal per (call, kind, contact).** A partial unique index on
`status = 'pending'`. A re-run of the pass must not stack duplicates on one
call; the idempotency gap recorded against `screened_calls` is a known debt and
should not be repeated here.

### Payload shapes

- `task` — `{ title, dueAt | null }`. Nothing else. `assigned_to` is deliberately
  absent: `users` is empty, so assignment would be a field nobody can fill.
- `contact_field` — `{ field, value }`, where `field` is one of an allow-list
  (see Containment 2).
- `opportunity_stage` — `{ opportunityId, fromStageId, toStageId }`. **Stage ids,
  not names**: stage is a uuid FK to `pipeline_stages`, whose `position` column
  defines pipeline order. `fromStageId` is stored so the review screen can show
  the move, and so an accept can refuse a proposal whose starting point has since
  changed. The review surface resolves both ids to names — and that resolution is
  where the raw-uuid risk lives: an id that will not resolve must drop the
  proposal from the screen, never render as a uuid to a reader.

### RLS and grants

Both audiences review proposals, so unlike `screened_calls` this table is NOT
service-role-only. It follows the `events` shape: SELECT to the agency **and**
to `account_id = app.current_account_id()`. Writes are service-role (the pass)
plus the accept/dismiss actions, which run server-side behind
`requireAccountAccess`.

## Containment

### 1. Grounding — a proposal that cannot cite the call is not made

`evidence` is `not null` and must be a span the transcript actually contains.
The generator does not get to assert; it has to point.

This is not a new idea in this repo — `composeSummary`
(`lib/voice/summarize.ts:142`) already runs `checkSummaryAgainstState` and
stamps a visible `⚠ MISMATCH` block when the model's prose claims a booking or
an intake that the system did not record. The product already distrusts the
model's narration and reconciles it against recorded facts. This design extends
that same check from *describing* the call to *acting* on it.

A proposal whose `evidence` is not found in the stored transcript is **dropped
at write time**, not shown and not stored.

### 2. Contact fields: fill a blank, never overwrite

**A `contact_field` proposal may only target a field that is currently empty.**
Never a value a human typed.

This is the CSV-import rule, already settled in this repo and stated in
DESIGN.md's own pattern list: *"Blank cells are dropped before the patch is
built, so re-importing an export can never blank a column."* Same principle,
same reason. A wrong fill into an empty field costs a correction; a wrong
overwrite destroys something a person entered and cannot be recovered from the
UI.

The allow-list is `first_name`, `last_name`, `email`, `phone`, plus nothing
else in v1. Custom fields, tags and consent flags are out — consent in
particular is a legal record, not a convenience.

**Re-checked at accept time, not just at propose time.** A human may have
filled the field in the minutes between. If it is no longer blank, the accept
refuses and says why.

### 3. Opportunity stage: the move is shown, and the starting point is verified

The largest blast radius on the board — Resaca has sixteen opportunities and a
wrong stage move rewrites a sales pipeline on the account with the most to lose.

Three guards:
- The review UI shows **`fromStage` → `toStage`**, never just the destination.
  A reader must be able to see what is being changed, not only what to.
- Accept **re-reads the opportunity's current stage** and refuses if it no
  longer equals `fromStage`. A stage that moved while the proposal sat is a
  proposal about a world that no longer exists.
- **A move into the pipeline's LAST stage is never proposed** (settled
  2026-09-19). A stage move changes only `stage_id`; it never touches
  `opportunities.status`, which is a separate `open`/`won`/`lost` field. In the
  live data EVERY opportunity sitting in the last stage is `won` — four of them
  across three accounts, none `open` — because a human who drags a deal to the
  end also records how it ended. So a machine proposal into that stage can only
  ever produce a deal AT THE FINISH LINE WITH ITS OUTCOME STILL OPEN, a
  combination that exists nowhere in this database. Nothing errors; anything
  counting open deals counts a finished one, and anything reporting
  won-versus-lost has a deal in neither bucket.

  On the merits too: closing a deal is a judgement about money and outcome, one
  phone call is weak evidence for it, and the machine cannot set the outcome
  anyway. The guard is keyed on the LAST `position` in the opportunity's own
  pipeline, not on the name "Closed" — the name is seeded and could differ;
  "the end of the board" is the structural property. A one-stage pipeline is
  therefore also refused, correctly: there is nowhere forward to go.

- **A multi-stage jump IS allowed** (settled 2026-09-19), because it is real: a
  caller who rings and says "just send me a price" genuinely has skipped two
  steps. It is not silent — see the next rule, which is what makes allowing it
  safe.

- No stage is skipped silently. **If `|toStage.position − fromStage.position| > 1`
  — any move that leaves a stage behind — the UI says so in words.**

  Stated as arithmetic because the prose form produced a real misreading: an
  implementer read "more than one step" as "more than one stage bypassed" and
  shipped a threshold that stayed silent for exactly half the skipping moves the
  live pipelines can express — including `New Lead → Appointment`, the caller who
  books on the first call, which is the most likely stage proposal this feature
  will ever produce. The topic sentence above already ruled that reading out.

### 4. Accept goes through the existing write path — always

Accepting a proposal calls the **same** function a human action calls. Never a
bespoke insert. The three, named as they actually exist in `packages/db`
(corrected 2026-09-18 — this section originally named three functions, none of
which exist):

- `addTask(db, accountId, { contactId?, title, dueAt? }, actorId, actorType?)`
  — `packages/db/src/activities.ts`. Not `createTask`.
- **`fillContactBlanks(db, accountId, contactId, {...}, actorId, actorType?)`**
  — `packages/db/src/contacts.ts`. **This function already IS Containment 2.**
  It writes only columns that are still empty and returns the list of what it
  actually wrote, `[]` if none — so the propose-time rule and the accept-time
  re-check are one atomic call, not the check-then-write race the wording of
  Containment 2 implies. Accepting through `updateContact` instead would have
  no blank guard at all.
- `moveOpportunityToStage(db, accountId, oppId, toStageId, actorId, actorType?)`
  — `packages/db/src/opportunities.ts`. Not `setOpportunityStage`. It validates
  that the target stage belongs to the opportunity's pipeline, but it does NOT
  check the current stage — so the `fromStageId` guard in §3 is a read-then-write
  at the accept layer with a real race window, and the accept path re-reads
  `status` too, refusing a deal a human has since marked won or lost.

**And the decision must be given back if the write fails.** The compare-and-swap
stamps `accepted` BEFORE the write, so a failure afterwards would leave a
proposal claiming a human accepted it and a record exists when none does — on
the same table this design names as what a future accuracy measurement is
computed from. Revert only when the write is known not to have landed: `addTask`
is two non-transactional statements, so a helper that throws is AMBIGUOUS and
must strand the proposal honestly rather than invite a retry that duplicates.

This is what makes every existing validation, RLS policy, dedupe key and event
emission apply automatically. A second write path would be a second set of
rules to keep in step, and the one that skipped a check would be the one the
machine uses.

### 5. Dismissal is recorded, not deleted

A dismissed proposal keeps its row with `status = 'dismissed'`. Three reasons:
it is the only evidence the feature offered something and a human declined; it
is what a future accuracy measurement is computed from; and a deleted row means
the next pass proposes the same thing again.

## Where proposals are generated

In the call lifecycle's existing `after()` work — the pattern
`incoming/route.ts:1035` already establishes. Never on a live call's
critical path.

**CORRECTED 2026-09-18, and the correction is load-bearing: NOT "alongside the
summary".** The summary is produced at `finish-call.ts:233`; the transcript does
not become durable until `finishCallRow` resolves ~194 lines and four database
legs later. Generating alongside the summary would ground every proposal in
UNPERSISTED state — a proposal citing a call nobody can open, which is the exact
defect this design exists to prevent.

Generation runs **after `stored = true`, and only when it is true**, as the last
leg before `finishCall` returns — after the staff alert, the text-back, the
`CALL LOST` alarm and the `call.recorded` emit, none of which may wait on a
model call.

**Best-effort, and that is a contract.** A failure to generate proposals logs
and changes nothing about the call, its transcript, its outcome or its
text-back. A call is a record; proposals are an opinion about it.

**Most calls should propose nothing.** A feature that finds something to
suggest on every call is noise, and noise is how a client learns to dismiss
without reading — which is worse than silence, because it trains them past the
one proposal that mattered. The pass returns an empty list for a spam call, an
abandoned call, a wrong number, and any call whose transcript does not support
a specific next step. This is an explicit success criterion, not a fallback.

## Screens

**Call detail** — proposals for that call, each with the caller's own words as
evidence, an Accept and a Dismiss. This is the primary surface: the reader has
the transcript directly **below** (corrected 2026-09-18 — the block sits after
the summary and before the transcript).

**Evidence is a whole caller turn, and it is NOT clipped.** Measured on calls
that can actually produce a proposal (`booked`/`lead`/`message`): 231 turns,
mean 33 characters, p95 85, max 95 — one line. An earlier figure of "max 483"
was measured across ALL caller turns and was contaminated: every turn over 200
characters in this database is the same robocall script on a `spam` or
`abandoned` call, both of which eligibility refuses before a proposal can exist.
A CSS clamp on the citation would re-create, at the display layer, the very
defect whole-turn evidence exists to prevent — a negation lives at the end of a
turn as often as anywhere else.

**The work queue** — pending proposals appear as a distinct group, visually
separated from real work and labelled as proposals, never mixed into the
Overdue/Today/Waiting buckets. Dot **+ word** (DESIGN.md rule 3). A proposal is
not work; it is a question about work.

Both audiences see both surfaces (danlo, 2026-09-18). Accepting creates
ordinary records the client already understands.

## Testing

Each proven by mutating the code it guards until a test named for that claim
fails.

**The boundary that matters: a proposal must never become a record without a
human action.** Assert that generating proposals writes nothing to `tasks`,
`contacts` or `opportunities` — the sharpest mutation, because the failure is
silent and the harm is a CRM a client no longer trusts.

Alongside:
- An ungrounded proposal (evidence absent from the transcript) is dropped.
- A `contact_field` proposal for a NON-blank field is never generated, and is
  refused at accept time if the field filled in between.
- An `opportunity_stage` accept refuses when the current stage no longer equals
  `fromStage`.
- Accept routes through the existing write path — mutation: bypass it with a
  direct insert, and the test that asserts the event/dedupe side effect fails.
- A spam, abandoned or wrong-number call proposes nothing.
- Proposals do not reach `bucketWork`, the dashboard work row or
  `listAgencyWork` — the same no-contamination proof `screened_calls` carries.
- A client and the agency both see and can act on a proposal (RLS, live-proof).

Any test that writes runs on the per-run fixture account.

## Out of scope

Named so they are not quietly absorbed: proposing from anything other than a
call (forms, SMS, email); auto-accept on any confidence threshold; editing a
proposal before accepting (accept or dismiss, nothing in between — an editable
proposal is just a form); custom fields, tags and consent flags; assignment;
and any change to how Sofía behaves on a live call.

## Known properties, accepted

- **A proposal can be wrong and that is expected.** The design target is that a
  wrong one is cheap to dismiss and impossible to apply silently — not that
  none are made.
- **No accuracy measurement in v1.** The `status` history is what a later
  measurement would be computed from; nothing computes it yet. State this
  rather than implying the feature is self-monitoring.
- **`decided_by` is a Clerk user id with no FK**, because `users` is empty. It
  is a breadcrumb, not a relation.
