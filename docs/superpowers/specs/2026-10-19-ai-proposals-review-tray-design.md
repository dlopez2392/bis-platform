# One table for every AI suggestion, and the one review tray (S-14 + F-019, first release item 8, part 8b)

**Status:** the owner said on 2026-10-18: "start the spec and go with your recommendations." Every choice in §2 is therefore the spec's own recommendation, which the owner accepted wholesale that day; each is marked so and is to be confirmed on spec review. Nothing here is left open. Where a choice touches money, the law or a promise a customer can see, the spec takes the conservative option and says so.
**Source:** `docs/crm-features.md` §4.3 item 8 (:1287-1292: S-14 "Generalised proposals, as the study costs it", 2 ew; F-019 "the `proposals` table with a kind registry (apply, inverse, evidence) and the one tray", +4–5 ew; F-022, +2.5–3 ew), the F-019, F-022 and F-133 rows (:1953, :1956, :2236), the S-14 row (:3757), §3.2 rules 2, 4, 5, 9 and 14 (:940, :942, :943, :947, :952), Surface 6 "The review tray for AI suggestions" (:2712-2747), decision 19 (:3080-3113, decided 2026-10-05: option (a)), decision 33 (:3316-3327, decided 2026-10-05: "the call-proposals spec's 'no editing before accept' (F-019)" is ratified away), the F-133 part in the legal-date chain (:1180), and every row that consumes F-019 (§5.6 below); the 8a spec `docs/superpowers/specs/2026-10-18-ai-gateway-record-summary-design.md` (its gateway `lib/ai/gateway.ts`, feature union and ledger); the call-proposals spec `docs/superpowers/specs/2026-09-18-call-proposals-design.md`; DESIGN.md (the module contract :223-227, rules 5, 6, 8 and 11 :111-148, the record page :256-276, provenance :284-296, the bilingual line of the definition of done :360-364); CLAUDE.md (migration order bis-ci → production → parity).

## 1. Scope

Item 8 is three parts (8a spec, G1). 8a has shipped (#270, #271). This spec is part 8b, built as two PRs:

| Part / PR | Contents | Migration |
|---|---|---|
| **8b-1** | **One `proposals` table and the kind registry.** Today's `call_proposals` rows move into it; the generator writes to it; one decision module (Accept, Edit and accept, Discard, Undo) replaces the call page's two actions; one bilingual **suggestion card** replaces the three hand-copied renderings. The card works on the call page and in the **Suggestions** section of the account's To do page (Pendientes), which becomes the tray | 0088 |
| **8b-2** | **The tray everywhere a suggestion is read.** The To do tray grouped by customer and source; the same card on the agency's Work page, with its actions; a "Waiting for you" section inside the customer record's **What's next** card; a timeline row for every accepted suggestion; "See it in the transcript" links to the exact turn; `call_proposals` and its mirror trigger dropped | 0089 |
| 8c (later spec) | Sofía's own acts visible and reversible (F-022): author columns, AI writes stamped as AI, a notice whenever Sofía changes a booking | — |

**Why two PRs.** 8b-1 changes where every suggestion lives and how it is decided, and it touches the live call path once (the generator's insert, `finish-call.ts:930`). It should ship on its own, run on real calls, and prove the move of today's rows (§4.6) before anything reads only the new table. 8b-2 is new placement and a new timeline source; its review is a UI and read-fence review, and it removes the old table only after 8b-1 has run in production. The next free migration numbers are 0088 and 0089 (`packages/db/supabase/migrations` ends at `0087_record_summaries.sql`).

**What 8b spends.** Nothing new on AI. No new model call is added: the only suggestions in 8b are today's, from `generateProposals` (`lib/proposals/generate.ts:241`), which already goes through the gateway as feature `call_proposals` (`generate.ts:329-362`; `0086_ai_gateway.sql:37`). The gateway's feature union does not change.

## 2. Decisions (recommended; owner accepted the recommendations wholesale 2026-10-18; confirm on spec review)

| # | Decision | Reason |
|---|---|---|
| P1 | **Two PRs**, 8b-1 (table, registry, decisions, card on the call page and the To do tray; 0088) and 8b-2 (placement, timeline, drop the old table; 0089) | 8b-1 is the risky data move and touches the call path; 8b-2 is UI and reads |
| P2 | **A new `proposals` table**, not a rename of `call_proposals`; today's rows are copied with their ids; a trigger mirrors any write to `call_proposals` until 0089 drops it | A rename breaks the running code the minute the migration lands (migration-before-code order); a copy plus mirror leaves the old code working through the deploy gap and the rollback |
| P3 | **The kind registry lives in code** (`lib/proposals/kinds/`), one module per kind with parse, describe, edit, still-holds, apply and inverse; the database pins the set with a CHECK, and a test pins the two equal | The same shape as the gateway's feature union (8a §3.1): a new kind is a registry entry plus a CHECK value, so it cannot arrive unnoticed |
| P4 | **One source column plus one nullable foreign key per source** (`source = 'call'` with `call_id`); a CHECK ties each source to its key | A polymorphic id cannot cascade; a real FK per source keeps "losing the call loses the proposal" (`0040_call_proposals.sql:18-20`) for every future source |
| P5 | **The kinds in 8b are today's three:** `task`, `contact_field`, `opportunity_stage` | S-14 generalises the thing that exists; new kinds belong to the features that make them (§5.6) |
| P6 | **The tray is the Suggestions section of the To do page** (Pendientes), plus the same card on the call page (8b-1), the agency Work page and the record's What's next card (8b-2). No new page, no new nav item | The module contract (DESIGN.md :223-227) routes work to the work queue and any AI write to the one tray; the To do page already shows suggestions (`tasks/work-list.tsx:547-569`). "One tray" means one table, one card and one set of actions, shown where the work is read |
| P7 | **Edit and accept** ships, inline on the card, per kind: a to-do's title and due date; a contact field's value; a deal's target stage | Decision 33 (2026-10-05) ratified lifting "no editing before accept" (:3327) |
| P8 | **Undo on Accept and on Discard**, from the toast, for **2 minutes**, by the person who decided, and only while the record is still as the decision left it | DESIGN.md rule 6; the 2-minute window is the consent controls' `UNDO_WINDOW_MS` (`lib/consent/staff-actions.ts:51`), so one Undo rule holds in the product |
| P9 | **Undo returns the suggestion to "Suggested"** (pending), with `undone_at`/`undone_by` kept | Undo means "as if I had not clicked"; the stamps keep the history an accuracy count needs |
| P10 | **A suggestion goes out of date** ("Out of date" / "Vencida") when Accept finds its starting point gone (the field filled, the deal moved or closed or deleted, the name no longer matching), when another suggestion for the same target is accepted, or **30 days after it was made** | Surface 6's five states (:2722); a month-old suggestion is about a world that has moved on. The age needs no new pass: it is a column read (rule 9, :947, caps new passes on today's tick) |
| P11 | **No "Accept all" in 8b** | DESIGN.md rule 8's test (:124-126): an Accept all writes what each card's Accept writes, so the group would become one view with one primary; leave it until acceptance data shows people accept in bulk |
| P12 | **Accept is each card's one primary** (cards are independent views); Edit and accept and Discard are ghost; in edit mode Save and accept replaces Accept as the primary | Surface 6 (:2719-2721) and rule 8 as amended 2026-09-23: one card's Accept cannot write what another card's Accept writes (the one exception, two suggestions for the same target, is handled by P10's "superseded") |
| P13 | **Who did it:** the applied write is the **person's** (the accepter is its author, as today, `calls/[callId]/actions.ts:240-243`); the suggestion card itself carries the **"Sofía · AI"** mark; 8b-2 adds one timeline row per accepted suggestion, person-marked, naming Sofía as the one who suggested it | DESIGN.md provenance (:284-296): one mark per row from the closed set. The person made the change; Sofía made the suggestion; both are stated, neither inferred. Author columns on target tables are F-022's (8c) |
| P14 | **Technicians** see and decide suggestions only for customers assigned to them; a suggestion with no customer is Owner and Staff only; every applied write runs on the request client, so RLS refuses what the person could not do by hand | 0068's scope (`0068_mine_unassigned_technician.sql:127-129`) carried over unchanged in meaning |
| P15 | **Concurrency:** the existing compare-and-swap on `status = 'pending'` decides between two people; the loser is told who answered ("Ana already answered this one."); no lock is held across the write | Today's proven shape (`call-proposals.ts:237-247`, `actions.ts:207-214`), kept, with a named answer instead of a bare one |
| P16 | **The stop-request hold stays on the To do queue in 8b**, with its Confirm stop / Not a stop / Undo row; the registry reserves the kind name `consent_hold` | It is keyword detection, not an AI suggestion; rule 4 (:942) keeps it live and calls the tray its later home; it is the legal chain's code, live before 1 December 2026, and already confirms and undoes on its row. **Law: the conservative option.** It moves into the tray when decision 6 lets a model detect stops (§5.7) |
| P17 | **No change to Sofía's live writes in 8b** (blank-fills on the caller's own contact during or after a call, `finish-call.ts:318-350`, `voice/tools/registry.ts:446-457`) | Decision 19 (:3080-3113) blocks F-022's item 1, which is 8c's; 8c's spec inventories every live write and decides each one's stamp, undo or tray. 8b-1 should not change `finishCall` twice in a week |
| P18 | **Suggestion text stays English** where the model writes it (a to-do title); every word **around** it on the card is in the reader's language, and the evidence keeps the caller's own words with its `lang` | The generator's English rule (`generate.ts:79-82`) is tied to the callback matcher, which reads English (`generate.ts:179-185`); changing both is a model change with its own review. Edit and accept lets the reader retitle in Spanish. Listed for a later slice (§9) |
| P19 | **Expiry of today's pending rows is counted from the migration**, not from when they were made | Nothing silently goes out of date on the day 0088 lands. A customer-visible promise is not at stake, but staff trust is: the conservative option |
| P20 | **The drawer does not change in 8b** | DESIGN.md's drawer list (:272-276) and its measured read fence (8a §7) stay as they are; the record page, one link away, carries the section (8b-2) |
| P21 | **No weekly acceptance line** ("Aceptó el 82% de las sugerencias", :2727) in 8b | Rule 5 (:943): the Monday report has one owner (F-100) and a budget, and waits for decision 24. The decided rows are kept so the number can be computed then |

## 3. What exists today (read in full)

- **Table** `call_proposals` (`0040_call_proposals.sql:12-42`): `call_id not null` (cascade), `contact_id` nullable, `kind` in `task`/`contact_field`/`opportunity_stage`, `payload jsonb`, `evidence text` non-empty, `status` in `pending`/`accepted`/`dismissed`, `decided_at`, `decided_by` (a Clerk id, not an FK). One pending per `(call_id, kind, coalesce(contact_id, zero))` (:52-56). 0053 made it server-written: client `select` only, decisions on the service client, and `call_proposals_decision_complete` (`0053_server_only_writes.sql:123-135`). 0068 added the Technician fence through the call's contact (`0068_mine_unassigned_technician.sql:127-129`). There is **no** composite FK from `(account_id, call_id)` to the call, a hole `insertProposal`'s own doc names (`packages/db/src/call-proposals.ts:80-84`).
- **Generator** `generateProposals` (`lib/proposals/generate.ts:241-611`): eligibility first (:320-323), the gateway (:329-363), at most three attempts per call (:26, :377), every kind grounded in the caller's whole turn (`groundedEvidence`, `lib/proposals/grounding.ts:145`), `contact_field` only for blank fields with phone and email checks (:385-450), `opportunity_stage` forward only, never the last stage (:453-526), `task` with a sane due date and the callback duplicate dropped (:532-599).
- **Decisions** `acceptProposal` / `dismissProposal` (`calls/[callId]/actions.ts:115-326`, `:335-366`): read under RLS, the stage still-holds check (:178-205), the compare-and-swap (:211), the existing write paths `addTask`, `fillContactBlanks`, `moveOpportunityToStage` (:231-294), a revert when nothing was written (:39-83), and "stranded" when a write may have landed (:101-107).
- **Screens:** the call page's block (`calls/[callId]/proposals.tsx:171-275`, both buttons ghost and **no undo**, `proposal-actions.tsx:12-24`); read-only rows on the To do page linking to the call (`tasks/work-list.tsx:240-284`, "Open the call to accept or dismiss", `messages.ts:3238`) and on the agency Work page (`work/agency-work-list.tsx:302-360`). The sentence builder is copied three times (`proposals.tsx:126-160`, `work-list.tsx:200-223`, `agency-work-list.tsx:270-300`). All copy is English only (`messages.ts:3195-3287`).
- **The stop-request stand-in:** a stop sentence in a text holds texts at once and opens a To-do (`lib/consent/inbound.ts:142-148`, `:215-221`); its row carries Confirm stop, Not a stop and Undo (`tasks/actions.ts:233`, `lib/consent/staff-actions.ts:171-200`). An emailed stop sentence offers a "Stop emails" chip (`lib/consent/email-stop.ts:45`). Both are keyword matches, not model output.
- **Provenance kit:** `authorOf` and `authorLabel` (`lib/record/author-mark.ts:26-92`) over the closed five kinds (:13); a To-do with a `call_id` is Sofía's (:30), every other staff To-do its creator's (:34). The record timeline reads nine sources (`packages/db/src/record.ts:273`).

## 4. PR 8b-1: the table, the registry and the decisions

### 4.1 Migration 0088 (`proposals`)

`public.proposals`:

| Column | Type | Rule |
|---|---|---|
| `id` | uuid pk | today's rows keep their ids (§4.6) |
| `account_id` | uuid not null | FK accounts, cascade |
| `source` | text not null | CHECK in (`call`) |
| `call_id` | uuid | composite FK `(account_id, call_id)` → `calls (account_id, id)` (`calls_account_id_id_key`, `0064_call_card.sql:104`), cascade. Closes the cross-account hole |
| `contact_id` | uuid | composite FK `(account_id, contact_id)` → `contacts (account_id, id)` (`contacts_account_id_id_key`, `0050_same_account_fks.sql:94`), cascade; null allowed (a call with no customer) |
| `kind` | text not null | CHECK in (`task`, `contact_field`, `opportunity_stage`) |
| `payload` | jsonb not null | **as proposed; never changes** |
| `applied_payload` | jsonb | what was written: equal to `payload` on Accept, the edited form on Edit and accept |
| `applied_ref` | jsonb | what Undo needs: `{taskId}`, `{field, value}`, `{opportunityId, fromStageId, toStageId}` |
| `evidence` | text not null | non-empty (as 0040) |
| `evidence_ref` | jsonb not null default `'{}'` | for a call, `{turn, at}`: the transcript turn index and its instant |
| `evidence_lang` | text | CHECK in (`en`, `es`); the call's `calls.language` at insert |
| `status` | text not null default `pending` | CHECK in (`pending`, `accepted`, `edited`, `dismissed`, `expired`) |
| `expired_reason` | text | CHECK in (`field_filled`, `name_mismatch`, `deal_moved`, `deal_closed`, `deal_gone`, `superseded`); required when `status = 'expired'`, null otherwise |
| `decided_at`, `decided_by` | timestamptz, text | as 0053: both null when pending, both set otherwise; `decided_by` is a Clerk id or `system` |
| `undone_at`, `undone_by` | timestamptz, text | the last Undo, kept after the row returns to pending |
| `expires_at` | timestamptz not null | `created_at + 30 days` (P10) |
| `created_at` | timestamptz not null default now() | |

- **CHECKs:** `(source = 'call') = (call_id is not null)`, written as one clause per source so a later source adds its column and its clause; `applied_payload is not null` exactly when `status in ('accepted','edited')`; `status = 'edited'` requires `applied_payload <> payload`; decision completeness as above.
- **Immutability trigger** `proposals_proposed_is_fixed` (before update): refuses any change to `payload`, `kind`, `source`, `call_id`, `contact_id`, `evidence`, `evidence_ref`, `evidence_lang`, `account_id`, `created_at`. What was proposed is evidence of what the machine said; only the decision columns move.
- **Indexes:** unique `(call_id, kind, coalesce(contact_id, zero uuid)) where status = 'pending' and source = 'call'` (0040's rule, with its reason for `coalesce`, :47-51); `(account_id, created_at desc) where status = 'pending'` (the To do tray); `(account_id, contact_id) where status = 'pending'` (the record section, 8b-2); `(call_id, created_at desc)` (the call page); `(account_id, contact_id, decided_at desc) where status in ('accepted','edited')` (the timeline, 8b-2).
- **RLS:** on. `proposals_member_read` for select to authenticated, `app.is_agency() or account_id = app.current_account_id()` (0053's shape). `proposals_technician_scope`, restrictive, for select: `(select app.sees_all_customers(app.current_account_id())) or exists (select 1 from public.contacts c where c.id = proposals.contact_id)`: the `exists` shape 0087 measured as one key probe per row against the `in (select ...)` scan (8a §4.5). A null `contact_id` is Owner and Staff only (P14).
- **Grants:** `revoke all ... from anon, authenticated`; `grant select to authenticated`; `grant select, insert, update, delete to service_role`. No client role writes anything here (the reason 0040 gave, :92-94, stands: a client that could insert could launder a write through Accept).
- **The mirror** (P2): `app.mirror_call_proposal()`, a `security definer` trigger function with `set search_path = ''`, `after insert or update on public.call_proposals`, upserts the row into `proposals` by id (source `call`, status mapped one to one, `evidence_ref '{}'`, `evidence_lang` from the call, `expires_at` per P19). Executable by no client role. 0089 drops it.
- **The copy** (§4.6) runs in the same file, after the table and before the mirror.
- **Teardown:** `proposals` joins `ACCOUNT_OWNED_TABLES` (`packages/db/src/account-teardown.ts:20`) before `calls`; the fixture sweep reads the same list. The doc block about `call_proposals` (:62-71) is rewritten for 8b-2's drop.
- **Rollback note** in the file's header, as every migration's: drop the trigger and its function, then the table; `call_proposals` was never touched, so the 8a build runs as before. Decisions taken on `proposals` after the deploy are not copied back; the header gives the one `update ... from proposals` statement that carries them back if the code is rolled back.

### 4.2 The kind registry

`apps/web/src/lib/proposals/kinds/` (server only), one module per kind, collected in `kinds/index.ts` as `KINDS: Record<ProposalKind, KindDef>`. A kind is:

| Member | Meaning |
|---|---|
| `kind`, `sources` | its name, and which sources may propose it (all three: `call`) |
| `needsContact` | whether a customer is required (`contact_field`, `opportunity_stage`: yes; `task`: no) |
| `parse(payload)` | the read boundary: unknown jsonb in, a typed payload or null out (replaces the bare cast at `call-proposals.ts:58-64`). A row that does not parse is shown as nothing and logged by id |
| `describe(p, ctx)` | `{ before, after, detail }` in the reader's language: "Phone: (empty) → +52 899 000 0000"; "Move from Contacted to Quote sent · A stage is skipped in between"; "Add a to-do: Send the quote · Due Oct 21". One builder, used by every screen (removes the three copies, §3) |
| `edit` | the editable fields and `validateEdit(p, input) → p' | error`: the same checks the generator runs (title trimmed to 200; due date in the account's zone, not in the past, within a year, `generate.ts:58-70`; phone through `spokenPhone`, email through `isValidEmail`, `generate.ts:419-437`; a stage in the deal's own pipeline, not the current one and not the last, `generate.ts:469-501`) |
| `stillHolds(db, row)` | read on the request client just before the write: `ok`, or an `expired_reason` |
| `apply(db, row, p)` | the write, through the **existing write path** only (`addTask`, `fillContactBlanks`, `moveOpportunityToStage`), returning `applied_ref` |
| `inverse` | `{ undo(db, ref) → "undone" | "changed" }`, or `{ irreversible: sentenceKey }` for a kind whose effect cannot come back ("The email has already gone." / "El correo ya salió."). All three 8b kinds are reversible |
| `toastKey`, `targetKey(p)` | the kind's own success words; the target used for P10's "superseded" (`contact:<id>:<field>`, `deal:<id>`; a to-do has none) |
| `dataClass` | `facts` for all three. A future kind whose inputs could carry health details is `health` and is refused by the registry until decision 6 is dated (rule 14, :952) |

A test reads `pg_constraint` for `proposals_kind_check` and `proposals_source_check` and asserts the sets equal `Object.keys(KINDS)` and the sources the kinds name; a kind added on one side only fails it.

### 4.3 The generator

`generateProposals` keeps every rule it has (§3) and writes to `proposals` through a renamed `insertProposal` (`packages/db/src/proposals.ts`, the module that replaces `call-proposals.ts`). Two additions: `groundedEvidence` also returns the turn's index, stored as `evidence_ref {turn, at}`; and `evidence_lang` is the call's spoken language (`finish-call.ts:392`, passed in). The "NEVER THROWS" contract (`generate.ts:217-240`) and the generation-writes-no-CRM-row boundary (call-proposals spec, Testing) are unchanged.

### 4.4 The decisions

One server module, `lib/proposals/decide.ts`, behind four server actions (`lib/proposals/actions.ts`), each `(accountId, proposalId, ...)`, each starting with `requireAccountAccess(accountId)` (both audiences decide, as today, `actions.ts:110-114`):

1. **Accept** `(id)` and **Edit and accept** `(id, edit)`:
   1. Read the row on the request client (RLS: the reader must be able to see it). Not found, or not `pending`, or past `expires_at` → the answer for that case (§4.7).
   2. Parse; for an edit, `validateEdit` (a refusal changes nothing).
   3. `stillHolds` → on failure, mark `expired` with its reason on the service client (compare-and-swap on pending) and answer "Out of date: …".
   4. **Decide first:** compare-and-swap `pending → accepted | edited` with `decided_*` and `applied_payload`, on the service client, scoped by account, id and `status = 'pending'` (`markProposalDecided`'s shape). No row → the loser's answer, naming who won.
   5. `apply` on the request client. A known no-write (`fillContactBlanks` returned `[]`) reverts the decision (today's `revertToPending`) and answers why; a throw from the write is **stranded**: left decided, logged with ids, answered "That may not have gone through. Check before trying again." (today's posture, `actions.ts:85-107`, kept).
   6. Store `applied_ref` (a failure is logged and makes Undo answer "Change it by hand"; the write stands).
   7. Mark every other **pending** suggestion with the same `targetKey` `expired / superseded` (P10).
   8. Revalidate the call page, the To do page, the agency Work page and (8b-2) the record page.
2. **Discard** `(id)`: compare-and-swap `pending → dismissed`. The row is kept, as today (`actions.ts:328-334`).
3. **Undo** `(id)`: only the person who decided (`decided_by`), within 2 minutes of `decided_at` (P8), and only for `accepted`, `edited` or `dismissed`:
   - after Discard: compare-and-swap back to `pending`, stamp `undone_*`.
   - after Accept: compare-and-swap back to `pending` (stamping `undone_*`, clearing `decided_*` and `applied_*`), **then** the kind's `inverse.undo` on the request client, which acts only if the record is still as the Accept left it: the to-do still open with the accepted title and due date (then it is deleted); the contact field still holding the written value (then it is set back to empty through `updateContact`); the deal still open at the target stage (then `moveOpportunityToStage` back to `fromStageId`). `changed` → the row is put back to its decided state (compare-and-swap on pending) and the answer is "It has changed since. Change it by hand."
   - Undo never touches what Accept set off as a side effect elsewhere: a duplicate flag `fillContactBlanks` raised (`contacts.ts:629`) stays for its own review. This is stated in the toast's Undo result only when it applies ("Undone. The possible duplicate it found stays in Duplicates.").
   - A returned-to-pending row that meets the one-pending index (a re-delivered call webhook made the same suggestion while this one sat decided, the case `actions.ts:56-68` documents) goes to `expired / superseded` instead, and the inverse still runs.

### 4.5 The card

`components/proposals/suggestion-card.tsx` (server) with `suggestion-actions.tsx` (client), reading the registry's `describe`. One card everywhere (P6).

- **Content, top to bottom:** a mono label with the source ("From the call on Tue, Oct 14 · Ana López" / "De la llamada del mar. 14 de oct. · Ana López"); the change as **before → after** (`describe`); the evidence, "Because the caller said" / "Porque quien llamó dijo", the caller's turn in a `<q lang={evidence_lang}>`, never clamped (the measured reason at `proposals.tsx:231-251` stands); the author mark **"Sofía · AI"** / **"Sofía · IA"** (the persona's name, `author-mark.ts:87`); the status as dot and word (rule 3); the buttons.
- **States** (dot + word): Suggested / Pendiente; Accepted / Aceptada; Edited / Editada; Discarded / Descartada; Out of date / Vencida (with its reason as a second line). A decided card shows its state and who decided ("Accepted by Ana · 9:42 AM"), and no buttons.
- **Buttons** (pending only): **Accept** (primary), **Edit and accept**, **Discard** (ghost). Edit opens the kind's fields inline on the card; **Save and accept** becomes the card's primary and **Cancel** is ghost; Esc cancels; validation errors sit under the field.
- **After a decision:** the toast names what happened, in the kind's words, with **Undo** for 2 minutes' worth of the toast's life (the toast itself shows for 10 seconds, Surface 6 :2722): "Added to your to-do list" / "Agregado a sus pendientes"; "Phone saved" / "Teléfono guardado"; "Moved to Quote sent" / "Movido a Cotización enviada"; "Discarded" / "Descartada". `useTransition` disables the card's buttons while any one runs (today's rule, `proposal-actions.tsx:6-10`).
- **Rule 8:** each card is its own view (P12). **Rule 11:** no hero anywhere; numbers in text colour. **Rule 7:** skeleton cards shaped like the card while the section loads.
- **Language:** the card's words follow `requestLocale` (user, then account, then operator default), the section carries `lang`; the model's to-do title is English (P18) and carries `lang="en"`; the caller's words carry `evidence_lang`. One card is otherwise in one language.
- Tokens only; dark and light through `.dark`; the blur fallback; the styleguide gains the card in all five states, in English, Spanish and the pseudo-locale.

**Where it shows in 8b-1:**
- **Call page:** replaces `CallProposals` (`calls/[callId]/page.tsx:382`), same place (after the summary, before the transcript). Pending first, as today (`proposals.tsx:191-197`). Past-expiry pending cards show as Out of date with no buttons. The page resolves the reader's locale for this section only; the rest of the call page stays English until its own bilingual pass (the definition of done's line does not retroactively fail today's screens, DESIGN.md :360-364).
- **To do page (the tray):** the Suggestions section (`tasks/work-list.tsx:547-569`) renders cards with their actions instead of links; "Open the call to accept or dismiss" goes. Pending and not past `expires_at`, newest first, capped at 200 with "Showing the newest 200" when capped (`listPendingProposals`'s silent `.limit(500)`, `call-proposals.ts:139`, becomes a stated cap). Never folded into the buckets (the type test `lib/work/buckets.test.ts:108-112` is retargeted to `Proposal`, not weakened).
- **Empty:** the section is absent when there is nothing pending, as today (the page's own empty state already says "Nothing needs you right now"), except on a To do page whose only empty reason is suggestions, which keeps today's gate (`work-list.tsx:494-497`).
- **Error:** "Couldn't load suggestions." / "No se pudieron cargar las sugerencias." with **Retry** / **Reintentar**; the buckets render regardless (the section has its own boundary; today's best-effort read, `tasks/page.tsx:104-133`, becomes a visible error instead of a silent nothing).

### 4.6 Moving today's call proposals

- **The copy** (in 0088): `insert into proposals (...) select ... from call_proposals on conflict (id) do nothing`, with `source 'call'`, status unchanged (`pending`, `accepted`, `dismissed`), `applied_payload = payload` for `accepted` (the write that happened was the proposal as made; there was no edit before 8b), `applied_ref null` (no Undo for a decision made before 8b), `evidence_ref '{}'` (the old rows stored no turn index; their card links to the call page, not to a turn), `evidence_lang` from `calls.language`, and `expires_at = greatest(created_at, now()) + 30 days` for pending rows (P19).
- **The gap:** between 0088 and the deploy, the running code still writes `call_proposals`; the mirror trigger copies each write. After the deploy nothing writes `call_proposals`.
- **Proof in the migration's own post-check** (run on bis-ci and production): row counts equal; the id sets equal; per-status counts equal; zero rows in `proposals` whose `call_id` belongs to another account.
- **8b-2's 0089** drops the trigger, its function and `call_proposals`, after 8b-1 has run in production for at least one day and the post-check still holds. `0053`'s and `0068`'s policies on it go with the table.

### 4.7 Answers in the moment

| Case | English | Spanish (usted) |
|---|---|---|
| Someone else decided first | "{name} already answered this one." | "{name} ya respondió esta." |
| …and the reader cannot name them | "Someone on the team already answered this one." | "Alguien del equipo ya respondió esta." |
| Field filled since | "Out of date: the {field} was filled in since." | "Ya no aplica: el {field} se llenó después." |
| Name does not match | "Out of date: the name on file doesn't match this caller." | "Ya no aplica: el nombre registrado no coincide con quien llamó." |
| Deal moved / closed / gone | "Out of date: this deal has moved since." / "…has been closed." / "…was deleted." | "Ya no aplica: esta oportunidad cambió de etapa." / "…se cerró." / "…se eliminó." |
| Older than 30 days | "Out of date: this suggestion is more than 30 days old." | "Ya no aplica: esta sugerencia tiene más de 30 días." |
| Another suggestion covered it | "Out of date: another suggestion covered this." | "Ya no aplica: otra sugerencia ya lo cubrió." |
| Write may have landed | "That may not have gone through. Check before trying again." | "Puede que no se haya guardado. Revise antes de intentarlo otra vez." |
| Failed cleanly | "That didn't go through. Try again." | "No se guardó. Inténtelo otra vez." |
| Undo too late, or not theirs | "Too late to undo here. Change it by hand." | "Ya no se puede deshacer aquí. Cámbielo a mano." |
| Undo found it changed | "It has changed since. Change it by hand." | "Cambió desde entonces. Cámbielo a mano." |

## 5. PR 8b-2: the tray everywhere it is read

### 5.1 The To do tray, grouped

The Suggestions section groups cards **by customer, then by source** ("Ana López · from the call on Tue, Oct 14"), groups ordered by their newest card, a suggestion with no customer under "No customer yet" / "Sin cliente todavía". One group heading is a mono label, never a card inside a card.

### 5.2 The agency Work page

`work/agency-work-list.tsx`'s rows (`:302-360`) become the same cards with their actions, under each account's name, grouped as §5.1. The cross-account read keeps its per-row account zone (`call-proposals.ts:184-212`) and gains a per-account cap of 50 so one busy account cannot crowd the rest off the screen (the fairness note at `call-proposals.ts:163-170`), stated on screen when it binds.

### 5.3 The record page

- Inside the **What's next** card (`RECORD_CARDS` `next-up`, `lib/record/record-cards.ts:19`), above its rows, a section **"Waiting for you"** / **"Esperan su respuesta"** with this customer's pending cards, newest first, at most 5, and "See all N in To do" / "Ver las N en Pendientes" when there are more.
- Its **own boundary** within the card: the What's next rows render whatever the section does (rule 5 extended to the card, as 8a-2's paragraph sits in the summary card). Loading: one skeleton card. Empty: nothing (the card's own empty state stands). Error: one line with Retry.
- On a phone it keeps the card's place (DESIGN.md :263-265: the summary and what is next come second).
- Its read is one indexed query (`(account_id, contact_id) where pending`) on the request client; the page's read fence gains it by name.
- Customers only. Household and business pages do not show suggestions in 8b (the 8a I2 reasoning: members and Technician assignment differ).

### 5.4 The timeline row

- A tenth timeline source, `suggestions`: one row per **accepted or edited** suggestion for the customer, at `decided_at`, read from `proposals` under RLS (so the Technician fence applies).
- **Mark:** the person who accepted (person kind; "Someone on the team" when unnamed). **Words:** "accepted Sofía's suggestion: Phone (empty) → +52 899 000 0000" / "aceptó la sugerencia de Sofía: Teléfono (vacío) → +52 899 000 0000"; edited: "…with changes" / "…con cambios", with the original as the row's detail. A row returned by Undo disappears with its status. Discarded and out-of-date suggestions are not news and make no row.
- The applied write's own row (a to-do) keeps the person's mark it already has (`author-mark.ts:34`); the two rows tell the two facts (P13).

### 5.5 "See it in the transcript"

The call page's transcript turns get `id="turn-{index}"`, and a card whose `evidence_ref` has a turn links "See it in the transcript · 2:14" / "Ver en la transcripción · 2:14" to `#turn-{index}` (on the call page, a jump; elsewhere, the call page at that turn). Rows copied from `call_proposals` have no turn and link to the call.

### 5.6 What the registry is built to carry

The rows that consume F-019's registry, and the member of §4.2 each needs. None of these kinds ships in 8b.

| Feature (row) | Kind and source | What it needs from the registry |
|---|---|---|
| F-133 part (:1180, :1586) | `consent_hold`, sources `text`, `email` | A decision with a live effect already in place (the hold); Accept = confirm, Discard = release, Undo = the consent ledger's `staff_undo` (`staff-actions.ts:185`); `dataClass: health` once a model detects |
| F-077 part (:1426) | callbacks, failed transfers, Sofía's booking changes | `inverse` for a booking change (8c's), inline Done on the work queue |
| F-175 part (:1448) | `open_deal`, source an intake | `apply` that creates an opportunity; `inverse` that deletes it while untouched; `needsContact` |
| S-19 (:1413) | `contact_field` and others, source `document` | a `document_id` source column; `evidence_ref {page, region}`; `dataClass: health` until decision 6 |
| S-20, F-026 (:1490, :1661) | `task`, `contact_field`, `note`, source `voice_note` | the same kinds from a new source; evidence a quoted span of the note |
| S-34 (:1604) | `review_reply` | `inverse: irreversible` ("La respuesta ya se publicó"), shown before Accept |
| F-024 (:1660) | `customer_fact` | a new kind on a new table |
| F-007 (:1477) | `term` | a new kind keyed to contact and deal |
| F-023 (:1492), S-33 (:1590) | any kind, source `assistant` | tools insert proposals; no tool writes a record directly |
| F-021 (:1491) | — | reads decided rows (accepted, edited, dismissed) for accuracy; never writes |
| S-N13 (:3857) | AI fields | "written only through proposals": a `custom_field` kind |

Every new source adds one nullable FK column and its CHECK clause (P4); every new kind adds one registry module and one CHECK value (P3).

### 5.7 The stop request: why not yet

The hold is placed by keyword, at once, because a revocation must stop sends the moment it is detected (rule 4, :942; study §9.6 item 9). Its To-do row already does what a tray card does: it quotes the customer ("{name} may have asked to stop texts: “{excerpt}”", `messages.ts:932`), and Confirm stop, Not a stop and Undo decide it through the consent ledger's compare-and-set (`staff-actions.ts:171-200`). Moving it into `proposals` would put the legal chain's evidence path on new code weeks before 1 December 2026, for no change in what staff see. The registry reserves `consent_hold`; the move comes with the slice that lets a model detect stops (decision 6), when the hold becomes model output and the tray is its right home.

## 6. Authorship and provenance

- The suggestion is Sofía's: the card's mark is the AI kind (P13).
- The applied write is the accepter's: `addTask`, `fillContactBlanks` and `moveOpportunityToStage` run with the accepter's id as actor (`actions.ts:240-243`, `:272-274`, `:289`), so `events` and `tasks.created_by` name the person. Undo's writes are the same person's.
- The decision is recorded on the suggestion (`decided_by`, `decided_at`, `undone_by`, `undone_at`); 8b-2's timeline row shows it.
- What 8b does **not** do is F-022's: no author columns on `contacts`, `opportunities` or `tasks`, no AI stamp on Sofía's own live writes, no booking-change notice (8c).

## 7. Copy

All new strings go into the typed catalogue (`lib/messages.ts`) in English and Spanish (usted), as `key` and `key.es` (`lib/i18n/t.ts:31-40`); the ratchet gate refuses a new English-only key. Today's `proposals.*` keys gain their Spanish twins. Besides §4.5 and §4.7:

| Key | English | Spanish |
|---|---|---|
| section heading | Suggestions | Sugerencias |
| section subhead | From Sofía. Nothing changes until you accept. | De Sofía. Nada cambia hasta que usted acepte. |
| empty (tray, when shown alone) | Suggestions appear here after a call. Nothing changes until you accept. | Las sugerencias aparecen aquí después de una llamada. Nada cambia hasta que usted acepte. |
| to-do | Add a to-do: {title} | Agregar un pendiente: {title} |
| due | Due {date} | Vence el {date} |
| contact field | {Field}: (empty) → {value} | {Field}: (vacío) → {value} |
| stage | Move from {from} to {to} | Mover de {from} a {to} |
| skipped | A stage is skipped in between. / {n} stages are skipped in between. | Se salta una etapa. / Se saltan {n} etapas. |
| decided by | Accepted by {name} · {time} | Aceptada por {name} · {time} |
| cap | Showing the newest {n}. | Se muestran las {n} más recientes. |

The empty sentence names a call only, because a call is the only source in 8b; Surface 6's "una llamada, un correo o un documento" waits for those sources. Everything is checked with the pseudo-locale (+35%) at 360 px and sets `lang` (DESIGN.md :360-364).

## 8. Testing

Agents run only the affected tests locally; the full suite is CI's job. No real model call runs in CI (8a §8.1).

### 8.1 Unit and action tests

- **Registry:** each kind's `parse` rejects the other kinds' payloads; `describe` in both languages; `validateEdit` refuses what the generator refuses (a past due date, an unparsable phone, an invalid email, the current or last stage, a stage from another pipeline); the registry/CHECK parity test (§4.2).
- **Decide:** Accept and Edit and accept write through the existing helpers (a spy on each; the event and duplicate-flag side effects asserted); the compare-and-swap's loser gets the named answer; a known no-write reverts; a throwing write is stranded and not reverted; `stillHolds` failures mark `expired` with the right reason; siblings with the same target become `superseded`; Discard keeps the row.
- **Undo:** within 2 minutes by the decider → undone; after 2 minutes, or by someone else → refused; the record changed since (a to-do retitled or completed, the field edited, the deal moved) → "changed", and the row is back to its decided state; the one-pending collision → `superseded`; Undo after Discard → pending.
- **The card:** five states in English, Spanish and the pseudo-locale; `lang` on the section, on the English title and on the evidence; one primary per card, and Save and accept as the only primary in edit mode; Esc cancels; skeleton and error states.
- **No contamination:** suggestions never reach `bucketWork`, the dashboard work row or `listAgencyWork` (retargeted from `call_proposals`).
- **The generation boundary:** generating writes nothing to `tasks`, `contacts` or `opportunities` (the call-proposals spec's sharpest test, retargeted, unchanged in force).

### 8.2 Database tests (replica, then bis-ci)

- No `anon` or `authenticated` grant writes `proposals`; a client reads its own account's rows and not another's; the agency reads all.
- A Technician reads only rows whose customer is assigned to them, and no row without a customer (`technician-scope.test.ts`'s table list swaps `call_proposals` for `proposals`).
- The composite FKs refuse a call or a contact from another account; deleting a call or a contact removes its rows; account teardown removes them.
- The CHECKs: decision completeness, `applied_payload` only when accepted or edited, `edited` requires a change, `expired` requires a reason, the source/key clause.
- The immutability trigger refuses a change to `payload` or `evidence` from the service role too.
- The one-pending index refuses a second pending row for the same call, kind and customer.
- The copy: counts, id sets and per-status counts equal; the mirror copies an insert and an update made through `call_proposals` after 0088.

### 8.3 Vacuity-proof probes

Each is a mutation the reviewer applies and runs, and does not accept the plan's word that it fails (the test-vacuity rule):

| Mutation | The test that must fail |
|---|---|
| Drop `.eq("status", "pending")` from the compare-and-swap | two concurrent Accepts create exactly one to-do |
| Write the record before deciding | a double click creates exactly one to-do |
| Replace `apply`'s helper with a direct insert | the event and duplicate-flag assertions |
| Skip `validateEdit` | an edited phone "abc" is refused |
| Skip `stillHolds` | an Accept after the field was filled is Out of date, and the contact keeps its value |
| Set the Undo window to infinity, or drop the decider check | Undo after 2 minutes, and by another person, is refused |
| Skip the "still as Accept left it" check in `inverse` | Undo of a to-do retitled since leaves it in place |
| Grant `update (payload)` to `authenticated` | the grants test |
| Drop the restrictive Technician policy | the Technician reads an unassigned customer's suggestion |
| Add a kind to `KINDS` without the CHECK, or the reverse | the registry parity test |
| Map `accepted` to `pending` in the copy | the per-status equality check |
| Drop the `expires_at > now()` filter from the tray read | a 31-day-old suggestion is offered Accept |
| Mark the 8b-2 timeline row with the AI kind | the provenance test (the accepter's person mark) |
| Render the Spanish card with an English status word | the bilingual render test, and the ratchet |

### 8.4 e2e (the per-run fixture account only)

On the per-run fixture account, never Test Client One or any live account, with a seeded call and three suggestions: Accept the to-do → it is in To do; Undo → it is gone and the card says Suggested; Edit and accept the phone with a bad value → refused, then a good one → saved and the card says Edited; Discard the stage move → Undo → Suggested; switch the reader to Spanish → the card's words are Spanish and the caller's words keep their `lang`. 8b-2 adds: the card in the record's What's next, the timeline row with the person mark, the agency Work page accepting for that account.

## 9. Not in 8b

- **F-022's items (8c):** author columns on the target tables, Sofía's live acts stamped as AI and undoable, a notice whenever Sofía changes a booking, and the decision 19 inventory of live writes, including the blank-fills of P17.
- **New sources and kinds:** email, texts, chat, documents, voice notes, reviews (§5.6). Suggestions read from email and texts also wait for decision 6 (crm-features :1318-1320, rule 14).
- **The stop-request hold** moves later (§5.7).
- **Accept all** (P11); **swipes** on a phone (Surface 6, :2724): the card's buttons are the phone's controls in 8b.
- **Spanish suggestion text** written by the model (P18).
- **The weekly acceptance line** (P21).
- **Group record pages** and **the drawer** (P20, §5.3).
- **A count on the To do nav item:** it would add a read to every page's layout; later, with the 2027 spine (F-089).
- **Auto-accept at any confidence:** never (Surface 6, :2732).

## 10. Rollout

- **8b-1:** 0088 goes to bis-ci first (the `ci-project-setup.yml` workflow), then production (once), then the parity check (`docs/runbooks/ci-supabase-project.md`), including the copy's post-check on both. **Deploy order: the migration before the code** (the new code reads only `proposals`). The mirror covers the gap. Owed after deploy: on the test account (the smoke-identities rule), one real call that makes a suggestion → it is a `proposals` row with a turn in `evidence_ref`; Accept, Undo, Edit and accept, Discard on the call page and in To do; read the copy's post-check again.
- **8b-2:** after at least one day of 8b-1 in production with the post-check holding, 0089 goes bis-ci → production → parity, then the code. Owed: the record section and timeline row on an agency-owned customer, in English and Spanish; the agency Work page.
- **Env:** none. Nothing is added to Vercel Preview.
- **Tracker:** item 8's S-14 and F-019 rows → `done` after 8b-2; F-022 stays open for 8c.

## 11. Things this spec was unsure of (for the review)

- **The 30-day age** (P10) is a judgement, not a measurement: the one live account's suggestion volume is too small to measure how long suggestions sit. Re-read after a month of 8b-1.
- **Undo of a filled contact field sets it back to empty.** If the customer's record was blank on purpose (a withheld email), that is right; if staff had meanwhile seen and relied on the value, Undo within 2 minutes is still the decider's own correction. Accepted.
- **The mirror trigger is the one piece of throwaway code.** It lives about a day; 0089 removes it. The alternative (renaming the table) was refused because it breaks the code that is running when the migration lands.
- **"Superseded" across two calls** (two calls each suggesting the same phone) is rare enough today that the spec does not group the two cards; it only marks the older one out of date when the newer is accepted.
