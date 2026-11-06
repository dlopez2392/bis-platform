# F-077 part 1 — the work queue finishes what it shows: inline Accept and Done on today's loose ends

**Date:** 2026-11-06 · **Owner item:** `docs/crm-features.md:1427` (effort 3, horizon next → later,
"Consumes F-019's kind registry and inverses", depends on F-019, F-033) · **Scope exactly as cut:**
callbacks, failed transfers, Sofía's booking changes — one inline action each, Accept or Done, on
today's To do queue. Part 2 ("the dismissals table and the remaining sources",
`docs/crm-features.md:1548`) is explicitly out, including a general-purpose dismissals table
(`docs/crm-features.md:3343` cites "the work-queue spec's 'no dismissals table' (F-077 part 2)").

## 1. What exists today, and the gap

The To do queue (`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/`) has grown far
past its 2026-09-14 design (`docs/superpowers/specs/2026-09-14-work-queue-design.md`). Today it unions
three sources — `WorkSource = "task" | "conversation" | "booking"`
(`packages/db/src/work-queue.ts:9`) — bucketed by `bucketWork` (`apps/web/src/lib/work/buckets.ts:48`)
into Overdue / Today / Waiting, with exactly one action per row source wired in
`work-row-actions.tsx:60-174`: a task gets **Done** (undo: reopen), a conversation gets **Not now**
(writes a real task, no dismissals table), a booking gets **Completed**/**No-show** (terminal, no
undo). The agency-wide screen (`.../dashboard/work/agency-work-list.tsx`) renders the same rows
read-only, grouped by account.

Checking each of the three loose ends this part names against that code:

### 1.1 Callbacks — already correct; no gap

F-033's call card (`0064_call_card.sql`) writes `calls.reason` / `calls.callback_number` /
`calls.caller_words`, and when a caller leaves a message or a lead with no booking,
`finishCall` inserts a **real task** with `tasks.call_id` set
(`apps/web/src/lib/voice/finish-call.ts:604`, `callbackWanted`/`callbackTaskTitle` in
`apps/web/src/lib/voice/call-card.ts:116-133`). That task is `WorkSource = "task"` like any other: it
buckets normally, shows the receptionist's provenance mark (`fromCall`, `work-list.tsx:225`,
rendered via `<AiAuthorMark/>`), and already has **Done** (`completeWorkTask` →
`packages/db/src/activities.ts:95-115`) with a real undo (`reopenWorkTask` →
`activities.ts:125-142`). `work-list.callback.test.ts:22-39` pins the provenance mark; no test pins
Done/Undo *specifically* for a callback row because it needs none — it is the generic task path.

**Conclusion: callbacks need zero new code in this part.** The only risk is regression, so this
part's task list adds one assertion (not already present) that a callback row's action is literally
`work-row-actions.tsx`'s task branch — see §6 Testing.

### 1.2 Failed transfers — no representation at all today

`docs/superpowers/specs/2026-09-15-call-handoff-design.md:160-166` ("Nobody answers") is explicit: when
a caller asks to be put through and nobody picks up, the call "stays exactly as `finishCall` recorded
it — `abandoned`. Nothing is stamped." No alert, no task, no conversation — `abandoned` is not
`isMeaningful` (`finishCall`'s own classification). And the ORIGINAL work-queue spec deliberately
excludes `abandoned` from the queue entirely (`2026-09-14-work-queue-design.md:105-108`): "a hang-up is
most often a wrong number or a robocall... including it would flood the queue."

A failed transfer is the one `abandoned` call that is never a wrong number: the caller explicitly
asked for a human (`calls.handoff_requested_at is not null`,
`packages/db/supabase/migrations/0037_call_handoff.sql:174`) and never reached one. The predicate
already exists and is already used for a different purpose — the A2P disclosure metric's "asked for a
person" bucket (`packages/db/src/voice.ts:403-404`):

```
trialHalf().eq("outcome", "abandoned").is("handoff_requested_at", null)   // true abandoned
trialHalf().not("handoff_requested_at", "is", null)                      // asked for a person
```

Nothing today turns the second shape into a work-queue row. **This is a genuine gap, not a
misreading** — `WorkSource` has no fourth value, `listAccountWork` (`work-queue.ts:177-188`) reads
only `tasks`, `conversations`, `bookings`.

A separate, later-horizon feature — F-035, "Warm handoff: transfers that never fail silently"
(`docs/crm-features.md:1988`, horizon `later`) — already promises "an alert and a task when a transfer
fails." This part does **not** build F-035: it builds only the narrowest slice needed to make a failed
transfer a loose end on today's queue (a row + one inline action), with no alert. See Owner decision 2.

### 1.3 Sofía's booking changes — visible on the record, invisible on the queue

`ai_acts` (`packages/db/supabase/migrations/0091_ai_acts.sql:58-86`) already records every booking Sofía
created, cancelled or rescheduled, with a full Undo path
(`apps/web/src/lib/ai-acts/actions.ts:58-133`, `undoAiBookingAct`,
`packages/db/src/ai-acts.ts:97-118`) rendered on the **contact's own timeline**
(`activity-timeline.tsx`, `apps/web/src/lib/ai-acts/view.ts:72-104`). `control: "booking"` is the kind
registry's own tag for exactly the three kinds this part means by "Sofía's booking changes"
(`booking-created.ts:7`, `booking-cancelled.ts:12`, `booking-rescheduled.ts:11`, all
`ActKindDef<K>.control = "booking"`, `apps/web/src/lib/ai-acts/kinds/types.ts:55,63`).

**The gap: nothing surfaces this on the To do queue.** A booking change Sofía made on a quiet Tuesday
is invisible to anyone who does not open that exact contact's page. `WorkSource` carries no `ai_act`
(or similarly named) value, and `ai_acts` has no "I saw this, it's fine" column — only `undone_at` /
`undone_by` / `undo_notified` (`0091_ai_acts.sql:66-73`), and a trigger,
`app.ai_acts_act_is_fixed()` (`0091_ai_acts.sql:93-108`), that refuses any update to a column besides
those three.

## 2. Scope of this part, exactly

**In:**
- Callbacks: no code change; one regression test added (§6).
- Failed transfers: a new, 4th derived `WorkRow` source, one inline action (**Done**), real undo.
- Sofía's booking changes: a new derived `WorkRow` source scoped to `control: "booking"` acts only
  (not `contact_created`, not `contact_field_filled`), one inline action (**Accept**), real undo.
- Both new sources appear on the per-account To do screen (bucketed, actioned) and, read-only, on the
  agency-wide screen (grouped by account, same as today's three sources there).
- Two narrow, additive migrations (§4).

**Out (part 2, or later features, named so nobody rebuilds them here):**
- A general dismissals table — forbidden by name (`docs/crm-features.md:3343`).
- Contact-created / contact-field-filled `ai_acts` as loose ends — not named by this part's title,
  and the field-fill case already has its own review path through the proposals tray for the
  call-end suggestion flavor; redoing that analysis for the *live* act flavor is part 2's "remaining
  sources" or a later part.
- The alert half of F-035 ("an alert... when a transfer fails") — a notification is a second,
  separate send path (`one send path` is this codebase's own rule,
  `2026-09-15-call-handoff-design.md:192-196`); this part is additive to the queue only.
- "Not now" (snooze) for either new source — the brief's title says "Accept and Done," not "and
  snooze"; flagged as Owner decision 4 rather than silently added or silently omitted.
- `reply` and general "snooze in place" from the canonical row's long description
  (`docs/crm-features.md:2119`) — those read as the *whole* F-077 feature's eventual shape, not this
  3-ew slice; this spec does not build a reply box into the queue.

## 3. Per loose-end design

### 3.1 Callbacks (unchanged)

Already satisfies the brief. Action: **Done** (`work.done` / `work.done.es`, existing). Write:
`completeTask` → `tasks.completed_at` (`activities.ts:110-113`), event `task.completed`. Undo:
`reopenTask` → `tasks.completed_at = null`, event `task.reopened`. Author: `actorId`/`actorType`
passed into `completeTask`/`reopenTask` (today always `(userId, "user")`,
`tasks/actions.ts:78,100`) — this is the pre-existing events-ledger shape, not F-115's
`withAuthor`/`record_changes`, which (per `docs/superpowers/specs/2026-11-02-record-history-design.md:191`)
explicitly excludes "To-dos or bookings in part 1." Who may: anyone with account access who can see
the task (RLS; Mine/Unassigned per F-085). Row after Done: gone from the queue (task closed); it
already has a provenance mark, so no new timeline work is needed.

### 3.2 Failed transfers (new)

**Source query** (`packages/db/src/work-queue.ts`, new function `failedTransfers`, same shape as
`staleBookings` at `work-queue.ts:152-169`):

```
calls where account_id = X
  and outcome = 'abandoned'
  and handoff_requested_at is not null
  and transfer_followup_at is null        -- NEW column, §4.1
order by started_at asc limit 200
```

`WorkRow.source` gains `"failed_transfer"`. `contactId` = `calls.contact_id` (nullable — an unidentified
caller has none, same as today's conversation/booking rows already tolerate). A new optional
`WorkRow` field, `callbackNumber?: string | null`, carries `calls.callback_number` (falls back to
`calls.caller_e164` the same way `callbackNumberOf` already does for the callback task,
`call-card.ts:89-93`) so the row's own sentence can say the number without a second read.

**Row text** (computed fresh at render, like `work.conversation`/`work.booking` already are —
`work-list.tsx:102-106` — never stored, so it is fully bilingual with no English-locked-text problem
the way a *stored* task title is, `call-card.ts:122-124`'s own documented reason `tasks.title` stays
English): new key `work.failedTransfer` = "Call back at {number} — they asked for a person" /
"Devuelva la llamada al {number} — pidió hablar con alguien", with a `.bare` twin for a withheld
caller ID, mirroring `todo.callback` / `todo.callback.bare` (`messages.ts:4368-4371`) exactly.

**Bucket:** always Waiting, oldest-first — only tasks can be Overdue/Today
(`2026-09-14-work-queue-design.md:168-171`, unchanged doctrine).

**Action: Done.** New `packages/db/src/voice.ts` function `setTransferFollowedUp(db, accountId,
callId, by, at)`: `update calls set transfer_followup_at = at where id = callId and account_id =
accountId and transfer_followup_at is null` (compare-and-swap, `.select("id")`, throw on no match —
mirrors `reopenTask`'s own "no task" throw, `activities.ts:140`, and `setCallOutcome`'s select-back
check, `voice.ts:544-548`). No `emit()` call: no write on `calls` emits an event anywhere in this
codebase today (`setCallOutcome`, `voice.ts:541-549`, is the precedent — this write follows it, not
`completeTask`'s task-table precedent). **Undo:** `clearTransferFollowup(db, accountId, callId)` sets
the column back to `null`, compare-and-swap on `transfer_followup_at = at` (the exact instant written,
same "still holds what Undo expects" shape `restoreContactFieldIf` and `reopenTask` use elsewhere) so
a second Done elsewhere between click and undo-click is not silently clobbered.

Author: `(userId, "user")`, same shape as every other To do action; no `withAuthor` (calls is not an
F-115-audited table).

Who may: anyone with account access who can see the call (RLS; today's `calls_tenant` policy).
Mine/Unassigned: same embed pattern as `staleBookings` (`contacts!inner(assigned_to)` only while
filtering) — a null `contact_id` drops out of a Mine/Unassigned view exactly as an unlinked
booking/conversation already does; not a new limitation.

Row after Done: gone from the queue (the compare-and-swap excludes it on the next read). Not added to
the contact's timeline as a new row kind (the call itself, when linked to a contact, already renders
on the timeline with its `abandoned` outcome badge, `apps/web/src/lib/record/timeline-rows.ts:50`; that
badge does not change — flagged as a finding, §Findings, not built here).

### 3.3 Sofía's booking changes (new)

**Source query** (`packages/db/src/ai-acts.ts`, new function `listPendingBookingActs`):

```
ai_acts where account_id = X
  and kind in ('booking_created', 'booking_cancelled', 'booking_rescheduled')
  and undone_at is null
  and accepted_at is null                  -- NEW column, §4.2
order by created_at asc limit 200
```

Deliberately **no `stillSafe` computation** for inclusion. `stillSafe` (`kinds/types.ts:62`) answers
"may the record page still OFFER Undo" — a heavier, per-contact batched read
(`ActFacts`, `types.ts:25-39`) built for one contact's timeline or one call's page. The To do row never
offers Undo itself (Undo stays on the record, §3.3 "who may"); Accept only means "I saw this, stop
showing it to me," which needs no judgement about whether Undo would still succeed. Building `ActFacts`
account-wide to gate queue inclusion would be the expensive, unnecessary version of this feature —
named here so a future implementer does not add it by reflex.

`WorkRow.source` gains `"booking_act"`. `contactId` = `ai_acts.contact_id` (**never** null on this
table, `0091_ai_acts.sql:62`, simpler than §3.2).

**Row text:** reuses the existing, already-bilingual `describeAct()` (`ai-acts/view.ts:72-74`,
`aiActs.verb.*` / `aiActs.detail.*` keys) verbatim — no new copy for the primary sentence. Example:
"Rescheduled to Thu 2pm" / "Cambió la cita al jueves a las 2:00 p.m." (glossary:
"reschedule" → *cambiar la cita*, never *reprogramar*,
`docs/superpowers/specs/2026-10-31-spanish-dashboard-design.md:267`).

**Bucket:** always Waiting, oldest-first (same doctrine as §3.2).

**Action: Accept.** New key `work.act.accept` = "Accept" / "Aceptar" (mirrors the suggestion tray's
own `suggestions.accept` = "Accept" / "Aceptar", `messages.ts:7417-7418` — same word, different
screen, deliberately not reused across files per each screen's own namespace convention already in
force here). New `packages/db/src/ai-acts.ts` function `stampAiActAccepted(db, accountId, actId, by,
at): Promise<boolean>`, the exact shape of `stampAiActUndone` (`ai-acts.ts:149-156`): compare-and-swap
on `accepted_at is null`, returns whether THIS call moved it. **Undo of Accept** (not to be confused
with the booking's own Undo, which stays on the record and is untouched by this action): a toast
action that clears `accepted_at` back to `null` via the same compare-and-swap pattern, worded as
`common.undo` / "Deshacer" (existing key) — safe to reuse because the two "undo"s never appear on the
same screen at the same time (one is a toast action on the To do list, the other a button on the
record page days or weeks later); see Owner decision 3 for the one open question this raises.

Trigger change required: `app.ai_acts_act_is_fixed()` currently refuses any update outside
`undone_at`/`undone_by`/`undo_notified` (`0091_ai_acts.sql:93-105`) — it must also permit
`accepted_at`/`accepted_by` to move, or every Accept click fails with `P0001`. §4.2 details the exact
migration.

Author: `(userId, "user")` passed as plain columns on `ai_acts` (`accepted_by`, a Clerk user id, **not**
an FK — mirrors `undone_by`'s own documented reason, `0091_ai_acts.sql:69-70`, "not an FK (0040's
reason)"). Not `withAuthor`: `ai_acts` already carries its own bespoke author shape (`actor`,
`undone_by`) predating F-115, and F-115's own scope line (§1.3 above) excludes it from the
`record_changes`/`withAuthor` contract for the facts it actually watches (contacts and their
children) — `ai_acts` is not one of those, before or after this part.

Who may: same read scope as the contact's own timeline — an Owner/Staff/agency member for any
customer, a Technician only for a customer assigned to them (`ai_acts_technician_scope`,
`0091_ai_acts.sql:122-125`, enforced by RLS on the request client exactly as it already is for the
timeline read — no new app-level check needed).

Row after Accept: gone from the queue. **Not** added as a new timeline row — the act's own row on the
contact timeline is unchanged (it already exists, dated when Sofía acted, and still offers Undo while
`stillSafe`); "Accept" is queue-only bookkeeping, matching Provenance's own existing shape (the
timeline already names who did the booking change — Sofía — accepting it on the queue does not change
who did what, only who has seen it).

## 4. Migrations needed — both HIGH tier

Per the speed-process binding rule, a migration is HIGH regardless of how small. Both below are
additive (new nullable column(s), a widened trigger function, new CHECK constraints) — **not** the
dismissals table the spec elsewhere forbids (that would be one new table shared across every loose-end
kind with no FK to any one of them; these are two single-purpose columns FK'd by construction to the
row they describe, the same shape `tasks.call_id` / `tasks.consent_event_id` /
`tasks.document_expiry_id` / `tasks.closure_kind`+`closure_on` already established over six migrations
for exactly this reason — one column per loose-end kind, never a shared table).

**Migration number:** write it as `0113_work_queue_actions.sql` only after confirming
`ls packages/db/supabase/migrations | tail -1` at implementation time. F-115's own backfill migration
is independently reserved to land as "0113" but is explicitly gated to "not before 2026-11-11" (a
7-day zero-unattributed-day gate, `docs/superpowers/specs/2026-11-02-record-history-design.md:95`) —
whichever of the two lands first in `main` takes the number; the other renumbers. Do not hard-code
"0113" in the PR description or the migration's own filename before checking.

### 4.1 `calls.transfer_followup_at`

```sql
alter table public.calls add column transfer_followup_at timestamptz;
comment on column public.calls.transfer_followup_at is
  'When a person marked a failed transfer handled (called the caller back), from the To do queue.
   NULL = not yet followed up, or not a failed transfer. Set/cleared by the service... '
  -- (actually written on the REQUEST client, same as completeTask/reopenTask: no new grant needed,
  -- calls already grants UPDATE to authenticated per 0020's table-level grant, inherited by this column)
```
No new grants (table-level, inherits). No RLS change (existing `calls_tenant` policy already scopes by
account; a Technician's visibility into which calls they may see is unchanged by this column — flagged
as a finding if Technician call-visibility turns out to be scoped narrower than this read assumes,
§Findings). One new partial index is NOT needed: `failedTransfers`'s query already filters on indexed
`account_id` + the existing `calls_caller_idx`-adjacent shape; a `where handoff_requested_at is not
null and outcome = 'abandoned' and transfer_followup_at is null` partial index is a performance
follow-up, not a part-1 requirement at today's call volumes (same posture the original work-queue spec
took on `tasks_account_open`: build the index when a real account's scale asks for it).

### 4.2 `ai_acts.accepted_at` / `ai_acts.accepted_by`, and the trigger widening

```sql
alter table public.ai_acts
  add column accepted_at timestamptz,
  add column accepted_by text;  -- Clerk id, not an FK (0091's own reason for undone_by)

alter table public.ai_acts
  add constraint ai_acts_accepted_pair check ((accepted_at is null) = (accepted_by is null)),
  add constraint ai_acts_not_both_accepted_and_undone
    check (not (accepted_at is not null and undone_at is not null));

create or replace function app.ai_acts_act_is_fixed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.account_id is distinct from old.account_id
     or new.actor is distinct from old.actor or new.call_id is distinct from old.call_id
     or new.chat_id is distinct from old.chat_id or new.contact_id is distinct from old.contact_id
     or new.kind is distinct from old.kind or new.target is distinct from old.target
     or new.before is distinct from old.before or new.after is distinct from old.after
     or new.created_at is distinct from old.created_at then
    raise exception 'ai_acts_act_is_fixed' using errcode = 'P0001';
  end if;
  return new;
end $$;
```
(Only the allow-list implicitly changes — `accepted_at`/`accepted_by` are simply never checked, same
as `undone_at`/`undone_by`/`undo_notified` today.) No grant change (service_role already holds UPDATE
on the whole table, `0091_ai_acts.sql:118`). A new db-layer test mirrors `0091`'s own
`ai_acts_act_is_fixed` coverage (search its existing test for the exact file) with two more cases:
accepting does not let `target`/`before`/`after` move, and an already-undone act refused for Accept at
the CHECK, not just at the app layer (belt + suspenders — `stampAiActAccepted`'s own `accepted_at is
null` guard already excludes an undone act from matching if accept ever tried to race it, but the
CHECK makes the impossible state unreachable even by a hand-run `UPDATE`).

## 5. UI

**Placement — per-account screen (`work-list.tsx`):** both new sources render inside the existing
three-bucket `<ListPanel>` (`work-list.tsx:459-474`), not a fourth visual section — they are rows like
any other, always in Waiting. `WorkRowItem`'s `primaryLabel`/`secondaryLine` (`work-list.tsx:102-119`)
gain two branches each; `WorkRowActions` (`work-row-actions.tsx:60-174`) gains two more `if
(source === ...)` branches, each returning exactly one `<Button>`, following the file's own documented
rule: "Exactly one action per row SOURCE, not a menu" (`work-row-actions.tsx:10-21`). Below `md`, the
existing wrap behaviour (`work-list.tsx:254-263`) is unchanged — these are plain rows, same shape as a
conversation or booking row, so the phone-width fix already shipped for those applies for free with no
new CSS.

**Placement — agency screen (`agency-work-list.tsx`):** text-only (no buttons, per that file's own
documented stance, `agency-work-list.tsx:20-28`: "no action buttons on the WORK rows... acting on it
means following its own link into that account"). Its own, separately-maintained
`primaryLabel`/`secondaryLine` (`agency-work-list.tsx:81-87`) gain the same two branches, duplicated
rather than shared, matching that file's own header comment on why it does not import from
`work-list.tsx`.

**Copy (EN / ES *usted*, glossary `2026-10-31-spanish-dashboard-design.md` §4.3):**

| Key | EN | ES |
|---|---|---|
| `work.failedTransfer` | "Call back at {number} — they asked for a person" | "Devuelva la llamada al {number} — pidió hablar con alguien" |
| `work.failedTransfer.bare` | "A caller asked for a person and couldn't reach one" | "Alguien que llamó pidió hablar con una persona y no pudo comunicarse" |
| `work.failedTransfer.done` | "Called back" | "Llamada devuelta" |
| `work.act.accept` | "Accept" | "Aceptar" |
| `work.act.accept.toast` | "Accepted." | "Aceptado." |

`work.failedTransfer.done` is the button label (distinct from the generic `work.done` "Done" — a
failed-transfer row's own action reads as "Called back" rather than a bare "Done," because "Done" on
this specific row, beside a sentence that already says "Call back at...", would read as answering its
own sentence rather than completing it — a small but real landscaper-at-7am clarity gain over reusing
the task's generic button verbatim). Toasts for both: `work.done.toast` (failed transfer — same
generic "Marked done." already shared by every other Done-shaped action) and `work.act.accept.toast`
(booking act). Both toasts carry `common.undo` ("Undo"/"Deshacer") as their action, exactly like every
existing toast in this file.

**States:**
- *Loaded:* rows interleave into Waiting, oldest-first, same as today.
- *Empty:* unchanged — `work.empty` already covers "nothing on the queue" with no special-casing per
  source (DESIGN rule 5: the empty state sells the feature in general terms; it does not enumerate
  every possible row kind).
- *Error:* a failed read of either new source degrades the SAME way `staleBookings`/
  `unansweredConversations` already do today — `Promise.all` in `listAccountWork` means one source's
  read failure currently fails the whole queue read; this part does not change that failure boundary
  (a pre-existing property, not a regression this part introduces — flagged, not fixed, §Findings).
- *Keyboard:* unchanged — the row's own link (`href`) is a normal anchor, the action button a normal
  `<button type="button">`, both already keyboard-reachable and already carry the app's global
  `:focus-visible` ring (tokens.css). No new overlay, no new `Esc` behaviour to wire.

## 6. Risks, test plan, task list

### Risks
- **Race between two staff members tapping Done/Accept on the same row.** Mitigated by
  compare-and-swap on both new writes (`transfer_followup_at is null`, `accepted_at is null`), same
  shape as every other guarded write in this codebase.
- **A failed-transfer row with no linked contact** renders as a non-link `<div>`
  (`work-list.tsx:297-299`'s existing branch) — already handled, not a new risk, but worth a named test
  since it is the one new case where `contactId` can legitimately be null on a brand-new source.
- **Reusing `common.undo` for two conceptually different "undo"s** (Accept's own reversal vs. the
  booking's Undo) — judged safe (§3.3) because they never share a screen; flagged as Owner decision 3
  in case the owner disagrees.
- **Migration-number collision** with F-115's own pending 0113 — named in §4, mitigated by checking
  fresh at implementation time rather than hard-coding.

### Test plan (each names the mutation that must fail it)

**`packages/db/src/test/work-queue.test.ts`** (extend):
- *Failed transfer appears only when handoff was requested and the call is abandoned and not yet
  followed up* — three rows (a plain abandoned call, a transferred-and-answered call, a followed-up
  failed transfer) must NOT appear; one qualifying row must. Mutation: drop the
  `transfer_followup_at is null` filter → the followed-up row reappears → test fails by name.
- *Booking-act row appears only for `control: "booking"` kinds, only while un-undone and un-accepted.*
  Insert one `contact_field_filled` act and one `booking_cancelled` act, both otherwise eligible — only
  the booking one surfaces. Mutation: widen the `kind in (...)` filter to include `contact_field_filled`
  → test fails by name.
- *Suppression is NOT reused for either new source* — an open task against the SAME contact must not
  hide a failed-transfer or booking-act row (unlike conversations/bookings, these flip their own
  column, so the existing contact-based suppression in `listAccountWork` must not accidentally catch
  them). Mutation: add either new source to the suppression set → a real one disappears behind an
  unrelated open task → test fails by name.

**`packages/db/src/test/voice.test.ts`** (extend):
- *`setTransferFollowedUp` is a real compare-and-swap*: calling it twice — the second throws (already
  followed up). Mutation: drop the `.is("transfer_followup_at", null)` clause → the second call
  silently "succeeds" → test fails by name.
- *`clearTransferFollowup` only clears the exact instant it was given* — a third actor's later Done
  (different `at`) must not be clobbered by an earlier undo's stale expectation. Mutation: drop the
  `.eq("transfer_followup_at", at)` compare → test fails by name.

**`packages/db/src/test/ai-acts.test.ts`** (new or extended file):
- *`stampAiActAccepted` is a real compare-and-swap*, same shape as the existing
  `stampAiActUndone` coverage (grep its own test for the exact pattern to mirror).
- *The widened trigger still refuses `target`/`before`/`after` to move on an Accept update* — attempt
  an update that moves `accepted_at` AND `target` in one statement; must raise `P0001`. Mutation: drop
  `target` from the trigger's own comparison list (an accidental side effect of hand-editing the
  function) → the forbidden move silently succeeds → test fails by name.
- *`ai_acts_not_both_accepted_and_undone` is enforced at the database*, not only in application code —
  a raw `UPDATE ... SET accepted_at = now()` against an already-undone row must violate the CHECK.
  Mutation: drop that constraint → the insert silently succeeds → test fails by name.

**`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.*.test.ts`** (new files,
following `work-list.callback.test.ts`'s own pattern):
- *A failed-transfer row renders its sentence with the number, falls back to the bare sentence with no
  number, and its button reads "Called back" in English and "Llamada devuelta" in Spanish.* Mutation:
  swap the `.bare` branch's condition → a numbered row renders bare or vice versa → test fails by name.
- *A booking-act row renders `describeAct`'s own verb/detail verbatim and offers exactly one button,
  "Accept"/"Aceptar".* Mutation: render a second button → the "exactly one child button" assertion
  fails by name.
- *A contact-less failed-transfer row renders as the non-link `<div>` branch, not a `<Link
  href="#">`.* Mutation: default `href` to `"#"` instead of `null` → the assertion that no anchor tag
  exists for this row fails by name.
- *Regression lock for callbacks (§1.1):* a callback task row's action is the generic task Done
  button, not a new "failed transfer" or "booking act" branch. Mutation: route `callId`-bearing task
  rows through the new `"failed_transfer"` branch by mistake → the row loses its Undo (the task branch
  has one; a misrouted branch built for a different source might not) → test fails by name.

**`apps/web/src/app/(dashboard)/dashboard/work/agency-work-list.test.ts`** (extend):
- *The agency screen's text for both new sources matches the per-account screen's, with NO action
  button rendered* (mirrors the file's own existing no-buttons assertions for the other three
  sources). Mutation: render a button for either new source → the "zero buttons on this screen"
  assertion fails by name.

### Task list (PR-sized, tiered)

1. **[HIGH] Migration** `0113_work_queue_actions.sql` (number TBD, §4): `calls.transfer_followup_at`;
   `ai_acts.accepted_at`/`accepted_by` + the two CHECK constraints + the widened trigger function.
   Ships with its own grants/CHECK test (mirrors `0091`'s and `0037`'s own migration test files) and
   runs through the CI-project-first sequence (`CLAUDE.md`'s bullet on migrations) before this spec's
   other tasks land. Files: new migration; `packages/db/src/test/*-grants.test.ts` additions.
2. **[MEDIUM] DB layer, failed transfers.** `failedTransfers` reader + `WorkRow.source`/
   `callbackNumber` additions + `listAccountWork` wiring (`packages/db/src/work-queue.ts`);
   `setTransferFollowedUp`/`clearTransferFollowup` (`packages/db/src/voice.ts`); exports added to
   `packages/db/src/index.ts` (additive only, per the hot-shared-file rule). Tests per §6.
3. **[MEDIUM] DB layer, booking acts.** `listPendingBookingActs`, `stampAiActAccepted`,
   `unstampAiActAccepted` (`packages/db/src/ai-acts.ts`); `WorkRow.source` addition + `listAccountWork`
   wiring. Tests per §6.
4. **[MEDIUM] Web actions.** `completeFailedTransfer`/`reopenFailedTransfer` and
   `acceptBookingAct`/`unacceptBookingAct` in `tasks/actions.ts`, following that file's own
   `ActionResult`/`revalidatePath` shape exactly. New `messages.ts` keys under `work.*` (additive,
   hot-shared-file rule).
5. **[MEDIUM] Per-account UI.** `work-list.tsx` / `work-row-actions.tsx` branches; new
   `work-list.*.test.ts` files per §6.
6. **[LOW] Agency UI.** `agency-work-list.tsx` text branches (no actions); test additions.
7. **[LOW] Styleguide.** `work-tray-demo.tsx` gains the two new row shapes if the DoD's "`/styleguide`
   updated" checkbox applies to this screen (confirm against that file's current coverage before
   assuming it needs the addition).

## 7. Owner decisions

1. **Scope of "booking changes": `control: "booking"` acts only, or every `ai_acts` kind?**
   Recommend: **booking-only**, as designed above. Contact-created and contact-field-filled acts are
   real loose ends too, but the brief's own title names "Sofía's booking changes" specifically, and
   `docs/crm-features.md:1548`'s "remaining sources" phrase for part 2 reads as the place those
   belong. Building all four kinds now would roughly double this part's DB-layer surface for a cost
   the 3-ew estimate does not obviously budget.

2. **Should this part also write the stored task F-035 promises ("an alert and a task when a transfer
   fails"), instead of a derived row?** Recommend: **derived row, no task, no alert** — as designed.
   A stored task would duplicate F-035's own later-horizon promise before F-035 itself is scoped, and
   risks the two features disagreeing about where "failed transfer" work lives when F-035 eventually
   ships. The derived-row approach costs one migration column either way; it does not foreclose F-035
   adding the alert on top later (a transfer failing is already a recordable event at
   `handoff-result/route.ts:235`'s own call site if an alert is added there).

3. **Reusing `common.undo`/"Deshacer" for the Accept toast's own reversal, versus a distinct label**
   (to avoid any reader ever conflating it with the booking's own, separate Undo). Recommend:
   **reuse `common.undo`** — the two never appear on the same screen, and inventing a second "undo"
   word risks the opposite confusion (two different words for what both read, correctly, as "undo my
   last click"). A one-sentence note in the PR description, not a copy change, is enough mitigation
   if the owner wants it flagged for the Spanish reviewer specifically.

4. **Should the two new sources also get "Not now" (push to tomorrow), for parity with
   conversations/bookings?** Recommend: **no, not in this part** — the brief's own title says "Accept
   and Done," and a failed transfer or a booking change that nobody wants to act on right now has a
   real fallback already (it simply stays on the queue, unlike a conversation whose unread count a
   "Not now" has to manufacture a task to suppress). Adding "Not now" now would mean a THIRD migration
   column per source (to record the snooze) with no named demand for it in this part's own scope line.

5. **The failed-transfer button's own words: "Called back" versus the generic "Done"?** Recommend:
   **a distinct label** (`work.failedTransfer.done`), as designed in §5 — the generic "Done" button
   reads oddly beside a sentence phrased as an instruction ("Call back at...") rather than a statement
   of a thing to finish. This is a small copy call, not a structural one; flagged only because it is
   the one place this spec invents new UI vocabulary rather than reusing an existing word.

## 8. Owner rulings (2026-11-06, all as recommended) — BINDING

1. **Booking changes only.** The queue shows `control: "booking"` acts. Contact-created and field-filled acts stay on the timeline until part 2.
2. **A derived To do row only** for a failed transfer: no stored task and no alert. Those are F-035's, later.
3. **Accept's own reversal reuses `common.undo`** (orchestrator's call; the two Undos never share a screen).
4. **No "Not now"** on the two new rows in this part. Snoozing needs part 2's dismissals table.
5. **The failed-transfer button says "Called back"** (Spanish per the copy table, checked against the glossary), not the generic "Done".

**Migration number:** 0114, not 0113. F-115's 0113 is reserved and lands on or after 2026-11-11. Migrations reach bis-ci in number order (`db:push:ci` refuses `--include-all`), so this part's PR is built now and its migration is applied only after 0113 is on production, the same hold as F-115 PR E. Re-check the next free number on `origin/main` immediately before the PR opens.
