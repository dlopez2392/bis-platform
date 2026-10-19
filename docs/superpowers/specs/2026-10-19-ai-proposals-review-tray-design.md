# One table for every AI suggestion, and the one review tray (S-14 + F-019, first release item 8, part 8b)

**Status:** the owner said on 2026-10-18: "start the spec and go with your recommendations." Every choice in §2 is therefore the spec's own recommendation, which the owner accepted wholesale that day; each is marked so and is to be confirmed on spec review. Nothing here is left open. Where a choice touches money, the law or a promise a customer can see, the spec takes the conservative option and says so. **Revised 2026-10-18** after the opus review of 126c440c (1 Critical, 13 Important, Minors) and its re-review (2 Important, Minors): every finding is folded in below.
**Source:** `docs/crm-features.md` §4.3 item 8 (:1287-1292: S-14 "Generalised proposals, as the study costs it", 2 ew; F-019 "the `proposals` table with a kind registry (apply, inverse, evidence) and the one tray", +4–5 ew; F-022, +2.5–3 ew), the F-019, F-022 and F-133 rows (:1953, :1956, :2236), the S-14 row (:3757), §3.2 rules 2, 4, 5, 9, 11 and 14 (:940, :942, :943, :947, :949, :952), Surface 6 "The review tray for AI suggestions" (:2712-2747), decision 19 (:3080-3113, decided 2026-10-05: option (a)), decision 33 (:3316-3327, decided 2026-10-05: "the call-proposals spec's 'no editing before accept' (F-019)" is ratified away), the F-133 part in the legal-date chain (:1180), and every row that consumes F-019 (§5.6 below); the 8a spec `docs/superpowers/specs/2026-10-18-ai-gateway-record-summary-design.md` (its gateway `lib/ai/gateway.ts`, feature union and ledger); the call-proposals spec `docs/superpowers/specs/2026-09-18-call-proposals-design.md`; DESIGN.md (rules 5, 6, 8 and 11 :111-149, the module contract :223-229, the record page :256-276, provenance :284-295, the bilingual line of the definition of done :360-364); CLAUDE.md (migration order bis-ci → production → parity); `docs/runbooks/production-isolation.md:787` (skew protection pins open tabs to the build they loaded).

## 1. Scope

Item 8 is three parts (8a spec, G1). 8a has shipped (#270, #271). This spec is part 8b, built as two PRs:

| Part / PR | Contents | Migration |
|---|---|---|
| **8b-1** | **One `proposals` table and the kind registry.** Today's `call_proposals` rows are copied into it; a mirror keeps the old table's writes flowing in, and a guard stops old code deciding twice, through the deploy gap; the generator writes to the new table; one decision module (Accept, Edit and accept, Discard, Undo) replaces the call page's two actions; one bilingual **suggestion card** replaces the three hand-copied renderings. The card works on the call page and in the **Suggestions** section of the account's To do page (Pendientes), which becomes the tray. The agency Work page reads the new table, still read-only | 0088 |
| **8b-2** | **The tray everywhere a suggestion is read.** The To do tray grouped by customer and source; the same cards, with their actions, on the agency Work page; a flat "Waiting for you" section inside the customer record's **What's next** card; a timeline row for every accepted suggestion; "See it in the transcript" links to the exact turn; `call_proposals`, its mirror, its guard and the copy function dropped | 0089 |
| 8c (later spec) | Sofía's own acts visible and reversible (F-022): author columns, AI writes stamped as AI, a notice whenever Sofía changes a booking, and the inventory of every live write | — |

**Why two PRs.** 8b-1 changes where every suggestion lives and how it is decided, and it touches the live call path once (the generator's insert, `finish-call.ts:930`). It should ship on its own, run on real calls, and prove the copy (§4.6) before anything removes the old table. 8b-2 is placement and a new timeline source; its review is a UI and read-fence review. The next free migration numbers are 0088 and 0089 (`packages/db/supabase/migrations` ends at `0087_record_summaries.sql`).

**What 8b spends.** Nothing new on AI. The only suggestions in 8b are today's, from `generateProposals` (`lib/proposals/generate.ts:241`), already on the gateway as feature `call_proposals` (`generate.ts:329-362`; `packages/db/src/ai-gateway.ts:11`; `0086_ai_gateway.sql:37`). The feature keeps its name; the gateway's union does not change.

## 2. Decisions (recommended; owner accepted the recommendations wholesale 2026-10-18; confirm on spec review)

| # | Decision | Reason |
|---|---|---|
| P1 | **Two PRs**, 8b-1 (table, registry, decisions, card on the call page and the To do tray; 0088) and 8b-2 (placement, timeline, drop the old table; 0089) | 8b-1 is the risky data move and touches the call path; 8b-2 is UI and reads |
| P2 | **A new `proposals` table**, not a rename of `call_proposals`; rows are copied with their ids by a function the migration calls; a **mirror** trigger copies any old-code write into `proposals`, and a **guard** trigger refuses an old-code decision that `proposals` has already overtaken, until 0089 drops all three | A rename breaks the running code the minute the migration lands (migration before code); skew protection keeps pre-deploy tabs on the old build for hours (§10), so old code must keep working and must not decide twice |
| P3 | **The kind registry lives in code** (`lib/proposals/kinds/`), one module per kind (parse, describe, edit, still-holds, apply, inverse); the **list** of kinds and sources lives in `@bis/db` as `PROPOSAL_KINDS` / `PROPOSAL_SOURCES` (the `AI_FEATURES` precedent, `packages/db/src/ai-gateway.ts:11`) and the registry is typed `Record<ProposalKind, KindDef>` against it; the database CHECKs pin the same sets, and a test pins all three equal | A new kind is a list entry, a registry module and a CHECK value; missing any one fails the compiler or the test |
| P4 | **One source column plus one nullable foreign key per source** (`source = 'call'` with `call_id`); a CHECK ties each source to its key | A polymorphic id cannot cascade; a real FK per source keeps "losing the call loses the proposal" (`0040_call_proposals.sql:18-20`) for every future source |
| P5 | **The kinds in 8b are today's three:** `task`, `contact_field`, `opportunity_stage` | S-14 generalises the thing that exists; new kinds belong to the features that make them (§5.6) |
| P6 | **The tray is the Suggestions section of the To do page** (Pendientes), plus the same cards on the call page (8b-1) and the agency Work page (8b-2), and flat rows in the record's What's next card (8b-2). No new page, no new nav item | The module contract (DESIGN.md :223-229) routes work to the work queue and any AI write to the one tray; the To do page already shows suggestions (`tasks/work-list.tsx:547-569`). "One tray" means one table, one set of actions and one description of each change, shown where the work is read |
| P7 | **Edit and accept** ships, inline, and edits **only** each kind's editable fields: a to-do's title and due date; a contact field's value; a deal's target stage, **forward only and never the last stage** (the generator's rule, `generate.ts:478`, `:500-501`). The field, the deal and its starting stage always come from the stored suggestion | Decision 33 (2026-10-05) ratified lifting "no editing before accept" (:3327). Forward only keeps one rule for "a suggestion may move a deal"; a person who wants to move it back does so on the board |
| P8 | **Undo lives in the toast**, which shows for 10 seconds (Surface 6, :2722), on Accept and on Discard. The server accepts an Undo for **2 minutes** after the decision, by the person who decided, as slack for a slow network only; no screen offers Undo after the toast. Undo acts only while the record is still as the decision left it | DESIGN.md rule 6; the 2 minutes is the consent controls' `UNDO_WINDOW_MS` (`lib/consent/staff-actions.ts:51`), which exists for the same reason, so one Undo rule holds in the product |
| P9 | **Undo returns the suggestion to "Suggested"** (pending), with `undone_at`/`undone_by` kept and `decided_*` / `applied_*` cleared | Undo means "as if I had not clicked"; the stamps keep the history an accuracy count needs |
| P10 | **Out of date** ("Out of date" / "Vencida") is a stored status with a reason when Accept finds the starting point gone (the field filled, the name not matching, the deal moved, closed or deleted) or when another suggestion for the same target is accepted. **Age** is derived: a pending row past `expires_at` (30 days) is out of date to every reader through one helper, `effectiveStatus(row, now)` in `@bis/db`, and any action that meets one writes `expired / aged` | Surface 6's five states (:2722); a month-old suggestion is about a world that has moved on. A derived age needs no new pass (rule 9, :947), and one helper means F-021 and every count read aged rows as out of date, never as pending |
| P11 | **No "Accept all" in 8b** | DESIGN.md rule 8's test (:124-126): an Accept all writes what each card's Accept writes, so the group would become one view with one primary. Listed as a revisit of Surface 6 (§9) |
| P12 | **One primary per view, and no card inside a card.** On the call page, the To do tray and (8b-2) the agency Work page, a mono-label section heading sits over a stack of suggestion cards; **each card is its own view with one primary, Accept** (Save and accept in edit mode); Edit and accept and Discard are ghost. Inside a record card (8b-2), suggestions are **flat rows with ghost buttons only**, plus a link to the tray | This **reverses** the reasoning at `calls/[callId]/proposal-actions.tsx:20-24`, which made both buttons ghost because several proposals shared one section and so one view. Today's block puts every proposal inside ONE card (`proposals.tsx:205-209`); 8b gives each suggestion its own card, and rule 8 as amended 2026-09-23 (:116-126) makes independent cards independent views: one card's Accept cannot write what another's writes (the one exception, two suggestions for the same target, is closed by P10's "superseded"). A record card is already a card, so rows inside it stay flat and ghost (DESIGN.md :275, "never a glass card inside the glass sheet"); no DESIGN.md amendment is needed |
| P13 | **Who did it:** the applied write is the **person's** (the accepter is its author, as today, `calls/[callId]/actions.ts:240-243`); the suggestion card carries the AI mark with the persona's name ("Sofía · AI"); 8b-2 adds one timeline row per accepted suggestion, person-marked, naming the persona as the one who suggested it | DESIGN.md provenance (:284-295): one mark per row from the closed set. The person made the change; the persona made the suggestion; both are stated, neither inferred. Author columns on target tables are F-022's (8c) |
| P14 | **Technicians** see and decide suggestions only for customers assigned to them; a suggestion with no customer is Owner and Staff only; every applied write runs on the request client, so RLS refuses what the person could not do by hand | 0068's scope (`0068_mine_unassigned_technician.sql:127-129`) carried over unchanged in meaning |
| P15 | **Concurrency:** the existing compare-and-swap on `status = 'pending'` decides between two people; the loser is told who answered ("Ana already answered this one."), or "Out of date" when the system did (`decided_by = 'system'`); no lock is held across the write | Today's proven shape (`call-proposals.ts:237-247`, `actions.ts:207-214`), kept, with a named answer instead of a bare one |
| P16 | **The stop-request hold stays on the To do queue in 8b**, with its Confirm stop / Not a stop / Undo row; the registry reserves `consent_hold`. This is a **revisit, listed under rule 11** (:949), of the F-133 row's "F-019's tray takes it over as a proposal kind when it lands" (:1180), which this commit corrects at source. **It moves after both 1 December 2026 and counsel's chain step-6 read (:1181), or with decision 6, whichever comes first** | It is keyword detection, not an AI suggestion; rule 4 (:942) keeps it live; it is the legal chain's code, live before 1 December 2026, and its row already confirms and undoes through the consent ledger. **Law: the conservative option** (§5.7) |
| P17 | **No change to Sofía's live writes in 8b** (blank-fills on the caller's own contact, `finish-call.ts:318-350`, `voice/tools/registry.ts:446-457`) | Decision 19 is decided (2026-10-05, option (a), :3081-3084). What remains is to apply it to each live write, and that inventory is F-022's, so 8c's. 8b-1 should not also change `finishCall`'s writes in the week it moves the generator |
| P18 | **Suggestion text stays English** where the model writes it (a to-do title); every word **around** it on the card is in the reader's language, and the evidence keeps the caller's own words with its `lang` | The generator's English rule (`generate.ts:79-82`) is tied to the callback matcher, which reads English (`generate.ts:179-185`); changing both is a model change with its own review. Edit and accept lets the reader retitle in Spanish. Listed for a later slice (§9) |
| P19 | **The age of today's pending rows is counted from the migration**, not from when they were made | Nothing silently goes out of date on the day 0088 lands. Staff trust, the conservative option |
| P20 | **The drawer does not change in 8b** | DESIGN.md's drawer list (:272-276) and its measured read fence (8a §7) stay as they are; the record page, one link away, carries the section (8b-2). Listed as a revisit of Surface 6's "the same card appears in the drawer" (§9) |
| P21 | **No weekly acceptance line** ("Aceptó el 82% de las sugerencias", :2727) in 8b | Rule 5 (:943): the Monday report has one owner (F-100) and a budget, and waits for decision 24. Decided rows are kept so the number can be computed then |
| P22 | **A plain Accept of a to-do whose due date has passed** (in the account's local today) is refused, without changing its status: "Its due date has passed. Use Edit and accept to pick a new one." The card shows it beforehand ("Was due Oct 14") | Clamping the date would accept something the reader never saw; expiring it would take away the Edit path that fixes it |

## 3. What exists today (read in full)

- **Table** `call_proposals` (`0040_call_proposals.sql:12-42`): `call_id not null` (cascade), `contact_id` nullable, `kind` in `task`/`contact_field`/`opportunity_stage`, `payload jsonb`, `evidence text` non-empty, `status` in `pending`/`accepted`/`dismissed`, `decided_at`, `decided_by` (a Clerk id). One pending per `(call_id, kind, coalesce(contact_id, zero))` (:52-56). 0053 made it server-written: client `select` only, decisions on the service client, `call_proposals_decision_complete` (`0053_server_only_writes.sql:123-135`). 0068 added the Technician fence through the call's contact (`0068_mine_unassigned_technician.sql:127-129`). There is **no** composite FK from `(account_id, call_id)` to the call, a hole `insertProposal`'s own doc names (`packages/db/src/call-proposals.ts:80-84`).
- **Generator** `generateProposals` (`lib/proposals/generate.ts:241-611`): eligibility first (:320-323), the gateway (:329-363), at most three attempts per call (:26, :377), every kind grounded in the caller's whole turn (`groundedEvidence`, `lib/proposals/grounding.ts:145`), `contact_field` only for blank fields with phone and email checks (:385-450), `opportunity_stage` forward only, never the last stage (:453-526), `task` with a due date inside the forward window measured from the call's own instant (`MAX_DUE_AT_FORWARD_MS`, `generate.ts:58`; `isSaneDueAt`, `:67-70`) and the callback duplicate dropped (:532-599).
- **Decisions** `acceptProposal` / `dismissProposal` (`calls/[callId]/actions.ts:115-326`, `:335-366`): read under RLS, the stage still-holds check (:178-205), the compare-and-swap (:211), the existing write paths `addTask`, `fillContactBlanks`, `moveOpportunityToStage` (:231-294), `revertToPending` when nothing was written (:39-83, matching `status = 'accepted'` only, :49-53), and "stranded" when a write may have landed (:101-107).
- **Screens:** the call page's block, every proposal as a row inside one card (`calls/[callId]/proposals.tsx:205-209`), both buttons ghost and **no undo** (`proposal-actions.tsx:12-24`); read-only rows on the To do page linking to the call (`tasks/work-list.tsx:240-284`, "Open the call to accept or dismiss", `messages.ts:3238`) and on the agency Work page (`work/agency-work-list.tsx:302-360`, read by `listPendingProposalsForAgency`, `call-proposals.ts:172-178`, from `work/page.tsx:72`). The sentence builder is copied three times (`proposals.tsx:126-160`, `work-list.tsx:200-223`, `agency-work-list.tsx:270-300`). All copy is English only (`messages.ts:3195-3287`).
- **The stop-request stand-in:** a stop sentence in a text holds texts at once and opens a To-do (`lib/consent/inbound.ts:142-148`, `:215-221`); its row carries Confirm stop, Not a stop and Undo (`tasks/actions.ts:233`, `lib/consent/staff-actions.ts:171-200`). An emailed stop sentence is classified "unclear" by `classifyEmailStop` (`lib/consent/email-stop.ts:45`), which only offers staff the Stop emails action (its doc, `:5-13`, `:27-31`). Both are keyword matches, not model output.
- **Provenance kit:** `authorOf` and `authorLabel` (`lib/record/author-mark.ts:26-92`) over the closed five kinds (:13); a To-do with a `call_id` is Sofía's (:30), every other staff To-do its creator's (:34); the AI label carries the persona's name (:87). The record timeline reads nine sources (`packages/db/src/record.ts:273`).
- **The placeholder name:** a caller's contact can be created as first name "Caller" (`finish-call.ts:338-343`), which `fillContactBlanks` treats as blank for the name pair (`packages/db/src/contacts.ts:580`), so a `firstName` fill **overwrites** "Caller".

## 4. PR 8b-1: the table, the registry and the decisions

### 4.1 Migration 0088 (`proposals`)

The file begins with a `do` block that sets `lock_timeout` to `5s` and stamps the transaction id (both with `set_config(…, true)`, transaction-local), then takes `lock table public.call_proposals in share row exclusive mode`. No write to `call_proposals` can land between the copy and the triggers; the lock lasts only for the migration's transaction. The lock is taken inside a `do` block, never as a bare statement, because on PostgreSQL 17.6 (bis-ci, CI's stacks and production) a bare `set local` or `lock table` that is a later statement of a multi-statement string is not guaranteed to run inside a transaction block (the CLI push warns `SET LOCAL can only be used in transaction blocks`). Corrected 2026-10-19 from the 8b-1 plan review (I-1). Inside the lock, the order is: the table, its CHECKs, trigger and indexes; RLS and grants; the copy function; the mirror and the guard; then `select app.copy_call_proposals()`. The copy also uses `on conflict (id) do nothing`, so a row the mirror already wrote is not copied twice; the lock, not that clause, is what stops a write landing between the copy and the triggers.

**One transaction, proven in the file and checked.** The lock and the settings only hold inside one transaction.

- 0088's second statement, a `do` block, raises `0088_not_one_transaction` unless the transaction id still equals the stamp, `lock_timeout` reads `5s`, and `pg_locks` shows this backend holding the share-row-exclusive lock on `call_proposals`. The file's last statement repeats the check. A path that commits between statements fails there, before any DDL, and creates nothing.
- Before 0088 goes to bis-ci, a replica run reads `pg_locks` from a second session mid-migration (a `pg_sleep` inserted for the check only), for `psql -1` and for the CLI's `db push`.
- The local replica is PostgreSQL 18, so the decisive evidence for the CLI path is CI `verify` (PostgreSQL 17) applying 0088 through that same `supabase db push`. The branch is pushed as soon as the migration is committed for that reason.
- The MCP `apply_migration` path cannot be rehearsed without writing a hosted project's history, so it relies on the in-file check. If it refuses on production, the unchanged file is applied once through the dashboard's SQL editor (one simple query, so one implicit transaction, with identical bytes), and the history row is recorded by hand (the 8b-1 plan, Question 1, decided 2026-10-18).
- 0088 never wraps its body in `begin; ... commit;`, which would make its text differ between projects.

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
| `applied_payload` | jsonb | what was written: the payload on Accept, the edited form on Edit and accept |
| `applied_ref` | jsonb | what Undo needs: `{taskId, title, dueAt}`; `{field, before, value}` where `before` is the field's value before the fill and `value` the value as stored after the write path's own normalisation (for a phone, the E.164 `fillContactBlanks` stores through `phoneFields`, `contacts.ts:71-76`, `:614`; the country flag is derived from the number by every write, so it is never stored or restored here); `{opportunityId, fromStageId, toStageId}`; and on every Accept, `superseded: [ids]`, the sibling suggestions this Accept marked out of date (§4.4 step 8) |
| `evidence` | text not null | non-empty (as 0040) |
| `evidence_ref` | jsonb not null default `'{}'` | for a call, `{turn, at}`: the transcript turn index and its instant |
| `evidence_lang` | text | CHECK in (`en`, `es`); the call's `calls.language` at insert |
| `status` | text not null default `pending` | CHECK in (`pending`, `accepted`, `edited`, `dismissed`, `expired`) |
| `expired_reason` | text | CHECK in (`field_filled`, `name_mismatch`, `deal_moved`, `deal_closed`, `deal_gone`, `superseded`, `aged`); required when `status = 'expired'`, null otherwise |
| `decided_at`, `decided_by` | timestamptz, text | as 0053: both null when pending, both set otherwise; `decided_by` is a Clerk id or `system` |
| `undone_at`, `undone_by` | timestamptz, text | the last Undo, kept after the row returns to pending |
| `expires_at` | timestamptz not null, **no default** | every writer sets it explicitly: `insertProposal` (`created_at + 30 days`), the mirror and the copy (§4.6). A writer that forgets fails loudly |
| `created_at` | timestamptz not null default now() | |

- **CHECKs:** `(source = 'call') = (call_id is not null)`, written as one clause per source so a later source adds its column and its clause; `applied_payload is not null` exactly when `status in ('accepted','edited')`; `status = 'edited'` requires `applied_payload <> payload`; decision completeness as above.
- **Immutability trigger** `proposals_proposed_is_fixed` (before update): refuses any change to `payload`, `kind`, `source`, `call_id`, `contact_id`, `evidence`, `evidence_ref`, `evidence_lang`, `account_id`, `created_at`, `expires_at`. Only the decision columns move.
- **Indexes:** unique `(call_id, kind, coalesce(contact_id, zero uuid)) where status = 'pending' and source = 'call'` (0040's rule, with its reason for `coalesce`, :47-51); `(account_id, created_at desc) where status = 'pending'` (the tray and the agency read); `(account_id, contact_id) where status = 'pending'` (the record section, 8b-2); `(call_id, created_at desc)` (the call page); `(account_id, contact_id, decided_at desc) where status in ('accepted','edited')` (the timeline, 8b-2).
- **RLS:** on. `proposals_member_read` for select to authenticated, `app.is_agency() or account_id = app.current_account_id()` (0053's shape). `proposals_technician_scope`, restrictive, for select: `(select app.sees_all_customers(app.current_account_id())) or exists (select 1 from public.contacts c where c.id = proposals.contact_id)`: the `exists` shape 0087 measured as one key probe per row (8a §4.5). A null `contact_id` is Owner and Staff only (P14).
- **Grants:** `revoke all ... from anon, authenticated`; `grant select to authenticated`; `grant select, insert, update, delete to service_role`. No client role writes anything here (0040's reason, :92-94, stands). The schema-wide guard (`packages/db/src/test/schema-grants-guard.test.ts`) sees the new table automatically; its allow-list does not change.
- **The copy function, the mirror and the guard:** §4.6.
- **Teardown:** `proposals` joins `ACCOUNT_OWNED_TABLES` (`packages/db/src/account-teardown.ts:20`) before `calls`; the fixture sweep reads the same list.
- **Rollback** (in the file's header, in this order, for a rollback of the code to the 8a build while `call_proposals` still exists):
  1. `drop trigger call_proposals_mirror on public.call_proposals; drop trigger call_proposals_guard on public.call_proposals;` (first, so step 3's writes are not mirrored back or refused).
  2. Insert into `call_proposals` every `proposals` row with `source = 'call'` whose id is missing there (rows the new generator wrote), with the status mapping below.
  3. Update `call_proposals` from `proposals` by id, mapping status explicitly: `pending → pending`, `accepted → accepted`, `edited → accepted`, `dismissed → dismissed`, `expired → dismissed` (0040's CHECK allows only the three); `decided_at`/`decided_by` copied, null for pending; `payload` stays the proposed one (an edited Accept's applied form is lost to the old code, which never showed it).
  4. Optionally drop `proposals`, the copy function and the two trigger functions.

### 4.2 The kind registry

`apps/web/src/lib/proposals/kinds/` (server only), one module per kind, collected in `kinds/index.ts` as `KINDS: Record<ProposalKind, KindDef>`, where `ProposalKind` is `(typeof PROPOSAL_KINDS)[number]` from `@bis/db` (P3). A kind is:

| Member | Meaning |
|---|---|
| `kind`, `sources` | its name, and which sources may propose it (all three: `call`) |
| `needsContact` | whether a customer is required (`contact_field`, `opportunity_stage`: yes; `task`: no) |
| `parse(payload)` | the read boundary: unknown jsonb in, a typed payload or null out (replaces the bare cast at `call-proposals.ts:58-64`). A row that does not parse is shown as nothing and logged by id |
| `describe(p, ctx)` | `{ before, after, detail }` in the reader's language: "Phone: (empty) → +52 899 000 0000"; "Move from Contacted to Quote sent · A stage is skipped in between"; "Add a to-do: Send the quote · Due Oct 21". One builder for every screen (removes the three copies, §3) |
| `edit` | the editable fields and `validateEdit(stored, input) → p' | error`. It **reads only the kind's editable fields from `input`** (task: `title`, `dueAt`; contact_field: `value`; opportunity_stage: `toStageId`) and builds `p'` from the stored payload plus those, so `field`, `opportunityId` and `fromStageId` can never be changed by an edit. Checks: title trimmed, non-empty, at most 200 (`generate.ts:39`); due date optional, read as a local date in the account's zone and stored as **the first instant of that local day that exists** (midnight, or the first minute after a DST gap where midnight is skipped, as in `America/Havana`, `America/Santiago` or `Asia/Beirut`; on a fall-back day, the earlier of two midnights), not before the account's local today and within a year of it; phone through `spokenPhone`, email through `isValidEmail` and lowercased (`generate.ts:419-437`); stage in the deal's own pipeline, later than `fromStageId`, and not the last stage (P7) |
| `normalise(p)` | the stored form (trimmed title, the due instant, lowercased email, phone as `spokenPhone` returns it). Edit and accept compares `normalise(p')` with `normalise(stored)`: equal → the decision is `accepted`, not `edited` |
| `stillHolds(db, row)` | read on the request client just before the write: `ok`, or an `expired_reason`. For `contact_field`, "still blank" is `fillContactBlanks`'s own rule, placeholder included: a `firstName` is blank when empty or when it is "Caller" with no last name (`contacts.ts:580`) |
| `apply(db, row, p)` | the write, through the **existing write path** only (`addTask`, `fillContactBlanks`, `moveOpportunityToStage`), returning `applied_ref`. For `contact_field`, `before` is read in the same request just before the write |
| `inverse` | `{ undo(db, ref) → "undone" | "changed" }`, or `{ irreversible: sentenceKey }` for a kind whose effect cannot come back ("The email has already gone." / "El correo ya salió."). All three 8b kinds are reversible (§4.4) |
| `toastKey`, `targetKey(p)` | the kind's success words; the target for P10's "superseded" (`contact:<id>:<field>`, `deal:<id>`; a to-do has none) |
| `dataClass` | `facts` for all three. A future kind whose inputs could carry health details is `health` and is refused by the registry until decision 6 is dated (rule 14, :952) |

A test reads `pg_constraint` for `proposals_kind_check` and `proposals_source_check` and asserts both equal `PROPOSAL_KINDS` / `PROPOSAL_SOURCES` and `Object.keys(KINDS)`.

### 4.3 The generator, and every other reference

`generateProposals` keeps every rule it has (§3) and writes to `proposals` through `insertProposal` in `packages/db/src/proposals.ts`, the module that replaces `call-proposals.ts`. Two additions: `groundedEvidence` also returns the turn's index, stored as `evidence_ref {turn, at}`; and `evidence_lang` is the call's spoken language (`finish-call.ts:392`, passed in). `expires_at` is set explicitly. The "NEVER THROWS" contract (`generate.ts:217-240`) and the generation-writes-no-CRM-row boundary (call-proposals spec, Testing) are unchanged.

Every other reference to the old table moves in 8b-1, so 8b-2 can drop it:

| Where | Change |
|---|---|
| `packages/db/src/index.ts:165-169` (the barrel) | exports from `./proposals`: `Proposal`, `PROPOSAL_KINDS`, `PROPOSAL_SOURCES`, `effectiveStatus`, the read and decide helpers |
| `listPendingProposals`, `listProposalsForCall`, `getProposal`, `markProposalDecided` (`call-proposals.ts:114-247`) | read and write `proposals`; the pending reads filter `expires_at > now()` |
| `listPendingProposalsForAgency` (`call-proposals.ts:172-178`), called from `work/page.tsx:72` | reads `proposals`; the agency UI stays read-only until 8b-2 (its rows still link to the call page) |
| `calls/[callId]/actions.ts`, `proposals.tsx`, `proposal-actions.tsx`, `page.tsx` and their tests | replaced by `lib/proposals/decide.ts`, `actions.ts` and the card |
| `tasks/page.tsx`, `tasks/work-list.tsx`, `work/agency-work-list.tsx` and their tests; `in-account-service-reads.test.ts` | read `Proposal`; the To do rows become cards |
| `lib/work/buckets.test.ts:108-112` | the type test retargeted to `Proposal`, not weakened |
| `lib/automations/passes/quote-followup.ts:34`, `lib/db.ts:13`, `account-teardown.ts:62-71` (comments) | name `proposals` |
| `packages/db/src/test/call-proposals.test.ts`, `call-proposals-grants.test.ts` | become `proposals.test.ts`, `proposals-grants.test.ts` |
| `technician-scope.test.ts:28`, `:75`; `server-only-writes-grants.test.ts:54`, `:85`, `:154`; `record-event.test.ts`, `automation-log-grants.test.ts`, `billing-schema.test.ts`, `voice-web-sessions-grants.test.ts`; `test/sweep-fixtures.ts` | seed and assert on `proposals` |
| `lib/proposals/generate.test.ts`, `lib/proposals/generate.fallback.test.ts` | stub and assert the new `insertProposal` (with `evidence_ref`, `evidence_lang` and `expires_at`); every existing assertion kept |
| `apps/web/e2e/call-proposals.spec.ts` (and its helpers in `e2e/fixtures/session-state.ts`, `e2e/relationships.spec.ts`) | seed through the new `insertProposal`; its cleanup's reliance on the call's cascade (`:176-177`) still holds through `call_id` |
| `ai-gateway-schema.test.ts:75`, `ai-gateway.ts:11` | unchanged: `call_proposals` there is the gateway feature's name, not the table |

After 8b-1, `grep -rn "call_proposals" apps packages/db/src` returns only the gateway feature name and 0088/0089 themselves; 8b-2's drop requires that (§4.6).

### 4.4 The decisions

One server module, `lib/proposals/decide.ts`, behind four server actions (`lib/proposals/actions.ts`), each `(accountId, proposalId, ...)`, each starting with `requireAccountAccess(accountId)` (both audiences decide, as today, `actions.ts:110-114`):

1. **Accept** `(id)` and **Edit and accept** `(id, edit)`:
   1. Read the row on the request client (RLS: the reader must see it). Not found, which is also what a row the reader may not see looks like → "This suggestion isn't available." (never a claim that someone answered it). Decided by a person → that person's name (§4.7); decided by `system` or `expired` → "Out of date: …" with its reason.
   2. **Past `expires_at`** → compare-and-swap `pending → expired / aged` (`decided_by = 'system'`) and answer "Out of date: this suggestion is more than 30 days old." This is a server-side refusal, whatever the screen showed.
   3. Parse; for an edit, `validateEdit` (a refusal changes nothing); a plain Accept of a to-do whose due date is before the account's local today is refused (P22).
   4. `stillHolds` → on failure, compare-and-swap `pending → expired` with its reason and answer "Out of date: …".
   5. **Decide first:** compare-and-swap `pending → accepted | edited` (by `normalise`) with `decided_*` and `applied_payload`, on the service client, scoped by account, id and `status = 'pending'`. No row → the loser's answer (step 1's wording).
   6. `apply` on the request client. A known no-write (`fillContactBlanks` returned `[]`) reverts the decision and answers why. **`revertToPending` matches `status in ('accepted','edited')` and `decided_by`, and clears `decided_*`, `applied_payload` and `applied_ref`** (today's matches `accepted` only, `actions.ts:49-53`, which would strand an edited row). A throw from the write is **stranded**: left decided, logged with ids, answered "That may not have gone through. Check before trying again." (today's posture, `actions.ts:85-107`).
   7. Store `applied_ref` (a failure is logged; Undo then answers "Change it by hand"; the write stands).
   8. Compare-and-swap every other **pending** suggestion with the same `targetKey` to `expired / superseded`, and add the ids it actually moved to `applied_ref.superseded`, so Undo can give them back.
   9. Revalidate the call page, the To do page, the agency Work page and the customer's record page.
2. **Discard** `(id)`: compare-and-swap `pending → dismissed`. The row is kept, as today (`actions.ts:328-334`). Discarding a row past `expires_at` writes `expired / aged` instead (by `system`) and answers "Out of date: this suggestion is more than 30 days old.", so an aged row is never counted as a person's Discard.
3. **Undo** `(id)`: only the person who decided (`decided_by`), within 2 minutes of `decided_at` (P8), and only for `accepted`, `edited` or `dismissed`; otherwise "Too late to undo here. Change it by hand."
   - **After Discard:** compare-and-swap `dismissed → pending`, scoped by `decided_by`, clearing `decided_at`/`decided_by` and stamping `undone_*`.
   - **After Accept, the inverse runs FIRST, while the row is still decided:**
     1. `inverse.undo` on the request client, which acts only if the record is still as the Accept left it:
        - **to-do:** still open, with the accepted title and due date (`applied_ref`) → deleted through a named helper, `deleteTaskForUndo(db, accountId, taskId, actorId)` in `packages/db/src/activities.ts`, which deletes by id with those three conditions in its `where` and emits `task.deleted` with the person as actor;
        - **contact field:** the field still holds `applied_ref.value` (the stored form) → set back to `before` through `updateContact`, which derives the phone's country flag itself (so a first name returns to "Caller" when that is what it was, and to empty when it was empty);
        - **deal stage:** still open at `toStageId` → `moveOpportunityToStage` back to `fromStageId`.
        `changed` → nothing is written, the row stays decided, and the answer is "It has changed since. Change it by hand." A **throw** from the inverse is **stranded**: the row stays decided, the ids are logged, and the answer is today's "That may not have gone through. Check before trying again."
     2. Only after `undone`: compare-and-swap `accepted|edited → pending`, scoped by id and `decided_by`, clearing `decided_*`, `applied_payload` and `applied_ref` (its `superseded` list read first, for step 3) and stamping `undone_*`. If it meets the one-pending index (a re-delivered call webhook made the same suggestion meanwhile, the case `actions.ts:56-68` documents), it goes to `expired / superseded` instead. A second Undo racing the first finds the record already reverted and answers "changed"; the card disables its buttons while one runs. **If the inverse succeeded but this compare-and-swap matches nothing or errors**, the record is back as it was while the row still says accepted: the row is logged as **stranded** with both facts (inverse done, status not moved), and the answer is "The change was undone, but this suggestion didn't update. Refresh before doing anything else." Nothing retries the inverse.
     3. Then the siblings in `applied_ref.superseded` go back to `pending`, each by compare-and-swap on `expired / superseded` (one that has since moved stays as it is), clearing their `decided_*` and `expired_reason`.
   - Undo never touches side effects elsewhere: a duplicate flag `fillContactBlanks` raised (`contacts.ts:629`) stays for its own review, and the toast says so when it applies ("Undone. The possible duplicate it found is still in Duplicates.").
   - Undo revalidates the same pages as Accept, the record page included.

### 4.5 The card

`components/proposals/suggestion-card.tsx` (server) with `suggestion-actions.tsx` (client), reading the registry's `describe`. Two presentations of one description: the **card** (call page, To do tray, agency Work page) and the **flat row** (inside a record card, 8b-2; §5.3).

- **Content, top to bottom:** a mono label with the source ("From the call on Tue, Oct 14 · Ana López" / "De la llamada del mar. 14 de oct. · Ana López"); the change as **before → after**; the evidence, "Because the caller said" / "Porque quien llamó dijo", the caller's turn in a `<q lang={evidence_lang}>`, never clamped (the measured reason at `proposals.tsx:231-251` stands); the author mark with the persona's name, `{persona} · AI` / `{persona} · IA` (`author-mark.ts:87`, never a hard-coded "Sofía"); the status as dot and word (rule 3); the buttons.
- **States** (dot + word): Suggested / Pendiente; Accepted / Aceptada; Edited / Editada; Discarded / Descartada; Out of date / Vencida, with its reason as a second line. `effectiveStatus` decides, so an aged pending row reads Out of date with no buttons. A decided card names who decided ("Accepted by Ana · 9:42 AM").
- **Buttons** (pending only): **Accept** (the card's one primary), **Edit and accept**, **Discard** (ghost). Edit opens the kind's fields inline; **Save and accept** becomes the card's one primary and **Cancel** is ghost; Esc cancels; validation errors sit under the field. `useTransition` disables the card's buttons while any one runs (`proposal-actions.tsx:6-10`).
- **After a decision:** a toast for 10 seconds, in the kind's words, with **Undo**: "Added to your to-do list" / "Agregado a sus pendientes"; "Phone saved" / "Teléfono guardado"; "Moved to Quote sent" / "Movido a Cotización enviada"; "Discarded" / "Descartada". Nothing else offers Undo (P8).
- **Layout:** a mono-label section heading ("Suggestions" / "Sugerencias") over the stack of cards; no card wraps the stack (P12). **Rule 11:** no hero; numbers in text colour. **Rule 7:** skeleton cards shaped like the card while the section loads.
- **Language:** the card's words follow `requestLocale` (user, then account, then operator default); the section carries `lang`; the model's to-do title carries `lang="en"` (P18); the caller's words carry `evidence_lang`.
- Tokens only; dark and light through `.dark`; the blur fallback; the styleguide gains the card and the flat row in all five states, in English, Spanish and the pseudo-locale.

**Where it shows in 8b-1:**
- **Call page:** replaces `CallProposals` (`calls/[callId]/page.tsx:382`), same place (after the summary, before the transcript). Pending first (`proposals.tsx:191-197`). The page resolves the reader's locale for this section only; the rest of the call page stays English until its own bilingual pass (the definition of done's line does not retroactively fail today's screens, DESIGN.md :360-364).
- **To do page (the tray):** the Suggestions section (`tasks/work-list.tsx:547-569`) renders cards with their actions instead of links; "Open the call to accept or dismiss" goes. Pending and not past `expires_at`, newest first, capped at 200 with "Showing the newest 200." (today's silent `.limit(500)`, `call-proposals.ts:139`, becomes a stated cap). Never folded into the buckets.
- **Empty:** the section is absent when nothing is pending, as today; the page's own empty-state gate stays (`work-list.tsx:494-497`).
- **Error:** "Couldn't load suggestions." / "No se pudieron cargar las sugerencias." with **Retry** / **Reintentar**; the buckets render regardless (today's silent best-effort read, `tasks/page.tsx:104-133`, becomes a visible error).

### 4.6 Moving today's call proposals

**The copy function** `app.copy_call_proposals() returns jsonb`, `security definer`, `set search_path = ''`, execute revoked from `public`, `anon`, `authenticated` and `service_role` (the migration and the database tests call it as the owner). It:
1. **Pre-check** (raises, so the migration stops): any `call_proposals` row whose call belongs to another account, or whose contact belongs to another account than the row → `raise exception 'proposals_copy_cross_account: % rows' using errcode = 'P0001'`. (A post-check could never fail: the new composite FKs would already have refused the insert.)
2. `insert into proposals (...) select ... from call_proposals on conflict (id) do nothing`, with `source 'call'`, the status unchanged, `applied_payload = payload` when `accepted` (no edits existed before 8b), `applied_ref null` (no Undo for a decision made before 8b), `evidence_ref '{}'` (no turn index was stored; such cards link to the call), `evidence_lang` from `calls.language`, and `expires_at = greatest(created_at, now()) + interval '30 days'` (P19; for decided rows the value is never read).
3. **Post-check** (raises `proposals_copy_mismatch`): every `call_proposals` id is in `proposals`, and per-status counts over those ids are equal.
4. Returns `{copied, skipped, by_status}` for the rollout ledger.

**The mirror** `call_proposals_mirror` (after insert or update on `call_proposals`, for each row; function `app.mirror_call_proposal()`, `security definer`, `set search_path = ''`, executable by no client role). **A mirror failure raises, and so blocks the old code's write**: the old code then answers its own failure copy, and nothing is half-written.

| Branch | Column by column |
|---|---|
| **insert** (the old generator; only `pending` rows are ever inserted, `call-proposals.ts:86-112`) | `insert into proposals` with `id`, `account_id`, `call_id`, `contact_id`, `kind`, `payload`, `evidence`, `created_at` = NEW's; `source 'call'`; `status 'pending'`; `decided_*`, `applied_*`, `undone_*`, `expired_reason` null; `evidence_ref '{}'`; `evidence_lang` from the call; `expires_at = NEW.created_at + 30 days`. `on conflict (id) do nothing` |
| **update** (the old `markProposalDecided` and `revertToPending`, the only old updates) | `update proposals set` **only** `status`, `decided_at`, `decided_by`, `applied_payload` where `id = NEW.id and status is not distinct from OLD.status` (the row the guard locked, still in the state it checked), raising `call_proposals_mirror_missed` when that matches no row: `status = NEW.status`; `decided_* = NEW.decided_*`; `applied_payload = payload` when `NEW.status = 'accepted'` (so the `applied_payload` CHECK holds and an old-code Accept does not fail with 23514), and `null` when `NEW.status` is `pending` or `dismissed` (so the old `revertToPending`, `actions.ts:49-53`, clears it). It never touches `expires_at`, `payload` or any column the immutability trigger fixes, so that trigger never refuses it |

**The guard** `call_proposals_guard` (before update on `call_proposals`, for each row; function `app.guard_call_proposal()`, `security definer`, `set search_path = ''`, execute revoked from `public`, `anon`, `authenticated` and `service_role`; a trigger function runs as its owner whoever fires it). It reads `select status from public.proposals where id = OLD.id for update`, so the `proposals` row stays **locked until the old code's transaction ends**: a new-code compare-and-swap on the same row waits, then finds it no longer pending and loses, and a new-code compare-and-swap that committed first is seen by this read. When the row is **missing**, or its status `is distinct from OLD.status`, it raises `call_proposals_superseded` (errcode `P0001`). In sync means the old code is deciding a row nothing else has decided (both pending), or reverting its own Accept (both accepted). Out of sync means the new code decided or undid it. The old `markProposalDecided` then throws (`call-proposals.ts:245`), `acceptProposal`'s outer catch sees `decided = false`, and the old tab answers "That didn't go through. Try again." (`actions.ts:307-322`): no second `addTask`, and the mirror never overwrites the new decision's `decided_by`.

**The gap.** From 0088 until the deploy is READY, the old build is all there is: its writes land in `call_proposals` and are mirrored. After READY, new requests run the new code, but a tab opened before the deploy stays on the old build (skew protection, `docs/runbooks/production-isolation.md:787`) until it is reloaded or the project's **skew-protection maximum age** passes. That age is read from the Vercel project's settings (Settings → Advanced → Skew Protection) before the deploy and written in the ledger. *Assumption until read: Vercel's documented default for this plan, about 12 hours.* The gap therefore ends at READY plus that age. Webhooks (the call path) are not pinned, so the old generator stops at READY.

**0089** (8b-2) drops the guard, the mirror, their functions, the copy function and `call_proposals` (0053's and 0068's policies on it go with the table). Its evidence, recorded in the ledger before it is applied, on both projects:
1. No `call_proposals` row was created or decided after the deploy's READY time plus the skew-protection maximum age (`created_at` and `decided_at` both earlier).
2. Every `call_proposals` id is present in `proposals`, and for every row decided before the deploy the statuses match (`accepted` ↔ `accepted`, `dismissed` ↔ `dismissed`).
3. `grep -rn "call_proposals" apps packages/db/src` on `main` returns only the gateway feature name (§4.3).

**0089 is the point of no rollback to pre-8b code**: after it, the 8a build has no table to read. Before it, §4.1's rollback applies.

### 4.7 Answers in the moment

| Case | English | Spanish (usted) |
|---|---|---|
| Missing, or not visible to this reader | "This suggestion isn't available." | "Esta sugerencia no está disponible." |
| A person decided first | "{name} already answered this one." | "{name} ya respondió esta." |
| …and the reader cannot name them | "Someone on the team already answered this one." | "Alguien del equipo ya respondió esta." |
| The system decided first (`decided_by = 'system'`) | "Out of date: {reason}" (below) | "Ya no aplica: {reason}" |
| Field filled since | "Out of date: the {field} was filled in since." | "Ya no aplica: el {field} se llenó después." |
| Name does not match | "Out of date: the name on file doesn't match this caller." | "Ya no aplica: el nombre registrado no coincide con quien llamó." |
| Deal moved / closed / gone | "Out of date: this deal has moved since." / "…has been closed." / "…was deleted." | "Ya no aplica: esta oportunidad cambió de etapa." / "…se cerró." / "…se eliminó." |
| Older than 30 days | "Out of date: this suggestion is more than 30 days old." | "Ya no aplica: esta sugerencia tiene más de 30 días." |
| Another suggestion covered it | "Out of date: another suggestion covered this." | "Ya no aplica: otra sugerencia ya lo cubrió." |
| A to-do's due date has passed (P22) | "Its due date has passed. Use Edit and accept to pick a new one." | "Su fecha ya pasó. Use Editar y aceptar para elegir otra." |
| Write may have landed | "That may not have gone through. Check before trying again." | "Puede que no se haya guardado. Revise antes de intentarlo otra vez." |
| Failed cleanly | "That didn't go through. Try again." | "No se guardó. Inténtelo otra vez." |
| Undo too late, or not theirs | "Too late to undo here. Change it by hand." | "Ya no se puede deshacer aquí. Cámbielo a mano." |
| Undo found it changed | "It has changed since. Change it by hand." | "Cambió desde entonces. Cámbielo a mano." |
| Undo reverted the record but not the suggestion | "The change was undone, but this suggestion didn't update. Refresh before doing anything else." | "El cambio se deshizo, pero esta sugerencia no se actualizó. Actualice la página antes de hacer otra cosa." |

## 5. PR 8b-2: the tray everywhere it is read

### 5.1 The To do tray, grouped

The Suggestions section groups cards **by customer, then by source**: a mono-label group heading ("Ana López · from the call on Tue, Oct 14"), cards under it, groups ordered by their newest card; a suggestion with no customer under "No customer yet" / "Sin cliente todavía". A heading is a label, never a card around cards.

### 5.2 The agency Work page

`work/agency-work-list.tsx`'s rows (`:302-360`) become the same cards with their actions, grouped under each account's name, then as §5.1. The read keeps each row's own account zone (`call-proposals.ts:184-212`) and is capped at **50 per account** (the fairness note at `call-proposals.ts:163-170`): one RPC, `list_pending_proposals_for_agency(p_per_account int)`, `security invoker`, executable by `service_role` only, selecting pending rows not past `expires_at` with `row_number() over (partition by account_id order by created_at desc) <= p_per_account`, served by the `(account_id, created_at desc) where status = 'pending'` index. A capped account shows "Showing the newest 50 for this account." The RPC is added in 0089.

### 5.3 The record page

- Inside the **What's next** card (`RECORD_CARDS` `next-up`, `lib/record/record-cards.ts:19`), above its rows, a flat section **"Waiting for you"** / **"Esperan su respuesta"**: a mono label, then this customer's pending suggestions as **flat rows** separated by row rules (the change, the evidence, the persona mark, the status), each with **ghost** Accept and Discard only (P12); at most 5, and a link "Edit or see all in To do" / "Editar o ver todas en Pendientes" to the tray, where editing happens. The toast and Undo are the card's.
- Its **own boundary** within the card: the What's next rows render whatever the section does (rule 5 extended to the card). Loading: two skeleton rows. Empty: nothing (the card's own empty state stands). Error: one line with Retry.
- On a phone it keeps the card's place (DESIGN.md :263-265: the summary and what is next come second).
- Its read is one indexed query (`(account_id, contact_id) where pending`) on the request client; the page's read fence gains it by name.
- Customers only. Household and business pages do not show suggestions in 8b (the 8a I2 reasoning).

### 5.4 The timeline row

- A tenth timeline source, `suggestions`: one row per **accepted or edited** suggestion for the customer, at `decided_at`, read from `proposals` under RLS (so the Technician fence applies).
- **Mark:** the person who accepted (person kind; "Someone on the team" when unnamed). **Words:** "accepted {persona}'s suggestion: Phone (empty) → +52 899 000 0000" / "aceptó la sugerencia de {persona}: Teléfono (vacío) → +52 899 000 0000"; edited: "…with changes" / "…con cambios", with the original as the row's detail. A row returned by Undo disappears with its status. Discarded and out-of-date suggestions make no row.
- The applied write's own row (a to-do) keeps the person's mark it already has (`author-mark.ts:34`); the two rows tell the two facts (P13).

### 5.5 "See it in the transcript"

The call page's transcript turns get `id="turn-{index}"`, and a card whose `evidence_ref` has a turn links "See it in the transcript · 2:14" / "Ver en la transcripción · 2:14" to `#turn-{index}`. Copied rows have no turn and link to the call.

### 5.6 What the registry is built to carry

The rows that consume F-019's registry, and the member of §4.2 each needs. None of these kinds ships in 8b.

| Feature (row) | Kind and source | What it needs from the registry |
|---|---|---|
| F-133 part (:1180, :1586) | `consent_hold`, sources `text`, `email` | a decision whose effect (the hold) is already live; Accept = confirm, Discard = release, Undo = the ledger's `staff_undo` (`staff-actions.ts:185`); `dataClass: health` once a model detects |
| F-077 part (:1426) | callbacks, failed transfers, Sofía's booking changes | `inverse` for a booking change (8c's), inline Done on the work queue |
| F-175 part (:1448) | `open_deal`, source an intake | `apply` that creates an opportunity; `inverse` that deletes it while untouched; `needsContact` |
| S-19 (:1413) | `contact_field` and others, source `document` | a `document_id` source column; `evidence_ref {page, region}`; `dataClass: health` until decision 6 |
| S-20, F-026 (:1490, :1661) | `task`, `contact_field`, `note`, source `voice_note` | the same kinds from a new source; evidence a quoted span of the note |
| S-34 (:1604) | `review_reply` | `inverse: irreversible` ("La respuesta ya se publicó"), shown before Accept |
| F-024 (:1660) | `customer_fact` | a new kind on a new table |
| F-007 (:1477) | `term` | a new kind keyed to contact and deal |
| F-023 (:1492), S-33 (:1590) | any kind, source `assistant` | tools insert proposals; no tool writes a record directly |
| F-021 (:1491) | — | reads decided rows through `effectiveStatus`, so aged rows count as out of date; never writes |
| S-N13 (:3857) | AI fields | "written only through proposals": a `custom_field` kind |

Every new source adds one nullable FK column, its CHECK clause and its own partial unique index (P4); every new kind adds one list entry, one registry module and one CHECK value (P3).

### 5.7 The stop request: why not yet (a rule-11 revisit)

The hold is placed by keyword, at once, because a revocation must stop sends the moment it is detected (rule 4, :942; study §9.6 item 9). Its To-do row already does what a tray card does: it quotes the customer ("{name} may have asked to stop texts: “{excerpt}”", `messages.ts:932`), and Confirm stop, Not a stop and Undo decide it through the consent ledger's compare-and-set (`staff-actions.ts:171-200`). Moving it into `proposals` would put the legal chain's evidence path on new code weeks before 1 December 2026, for no change in what staff see. The F-133 row (:1180) said the tray "takes it over as a proposal kind when it lands"; this spec changes that, so under rule 11 (:949) the change is listed, not silent, and the row is corrected at source in the same commit: the move happens **after both 1 December 2026 and counsel's chain step-6 read (:1181), or with decision 6, whichever comes first**. The registry reserves `consent_hold`.

## 6. Authorship and provenance

- The suggestion is the persona's: the card's mark is the AI kind with the persona's name (P13).
- The applied write is the accepter's: `addTask`, `fillContactBlanks` and `moveOpportunityToStage` run with the accepter's id as actor (`actions.ts:240-243`, `:272-274`, `:289`), so `events` and `tasks.created_by` name the person. Undo's writes, `task.deleted` included, are the same person's.
- The decision is recorded on the suggestion (`decided_by`, `decided_at`, `undone_by`, `undone_at`); 8b-2's timeline row shows it.
- What 8b does **not** do is F-022's: no author columns on `contacts`, `opportunities` or `tasks`, no AI stamp on Sofía's own live writes, no booking-change notice (8c).

## 7. Copy

All new strings go into the typed catalogue (`lib/messages.ts`) in English and Spanish (usted), as `key` and `key.es` (`lib/i18n/t.ts:31-40`); the ratchet gate refuses a new English-only key. Today's `proposals.*` keys gain their Spanish twins. Every string that names the assistant takes `{persona}` from the voice profile, as `provenance.ai` does (`messages.ts:2665-2666`). Besides §4.5 and §4.7:

| Key | English | Spanish |
|---|---|---|
| section heading | Suggestions | Sugerencias |
| section subhead | From {persona}. Nothing changes until you accept. | De {persona}. Nada cambia hasta que usted acepte. |
| empty (tray, when shown alone) | Suggestions appear here after a call. Nothing changes until you accept. | Las sugerencias aparecen aquí después de una llamada. Nada cambia hasta que usted acepte. |
| to-do | Add a to-do: {title} | Agregar un pendiente: {title} |
| due / was due | Due {date} / Was due {date} | Vence el {date} / Vencía el {date} |
| contact field | {Field}: (empty) → {value} | {Field}: (vacío) → {value} |
| stage | Move from {from} to {to} | Mover de {from} a {to} |
| skipped | A stage is skipped in between. / {n} stages are skipped in between. | Se salta una etapa. / Se saltan {n} etapas. |
| decided by | Accepted by {name} · {time} | Aceptada por {name} · {time} |
| cap | Showing the newest {n}. | Se muestran las {n} más recientes. |

The empty sentence names a call only, because a call is the only source in 8b. Everything is checked with the pseudo-locale (+35%) at 360 px and sets `lang` (DESIGN.md :360-364).

## 8. Testing

Agents run only the affected tests locally; the full suite is CI's job. No real model call runs in CI (8a §8.1).

### 8.1 Unit and action tests

- **Registry:** each kind's `parse` rejects the other kinds' payloads; `describe` in both languages with the persona's name; `validateEdit` refuses what the generator refuses (an unparsable phone, an invalid email, the current, an earlier or the last stage, a stage from another pipeline); `validateEdit` ignores an `input` carrying `field`, `opportunityId` or `fromStageId` (the result's are the stored ones); `normalise` makes an edit equal to the proposal an `accepted`, not an `edited`; the list/registry/CHECK parity test (§4.2).
- **Due dates in the account's zone:** a zone whose DST change happens at midnight (`America/Havana`, `America/Santiago` or `Asia/Beirut`), with a due date on the spring-forward day (local midnight does not exist) and on the fall-back day (it exists twice); and "not in the past" judged by the account's local today when it differs from the UTC day (late evening in `America/Chicago`, early morning in `Asia/Beirut`).
- **Decide:** Accept and Edit and accept write through the existing helpers (a spy on each; the event and duplicate-flag side effects asserted); the compare-and-swap's loser gets the named answer, and "Out of date" when the winner was `system`; a known no-write reverts an `accepted` **and an `edited`** row, clearing `applied_*`; a throwing write is stranded and not reverted; `stillHolds` failures mark `expired` with the right reason, the "Caller" placeholder counting as blank; siblings with the same target become `superseded`; a row past `expires_at` is refused on the server and marked `aged`; P22's refusal; Discard keeps the row.
- **Concurrency, with a barrier:** two Accepts on one suggestion, each held at a shared barrier after its read and released together into the compare-and-swap, produce exactly one to-do and one loser's answer (the barrier makes the race certain, not likely).
- **Undo:** within 2 minutes by the decider → undone; after 2 minutes, or by someone else → refused; the record changed since (a to-do retitled or completed, the field edited, the deal moved) → "changed", nothing written, the row still decided; an inverse that throws → stranded, the row still decided; a first name filled over "Caller" is restored to "Caller", a field filled from empty to empty, a phone compared by its stored E.164 (an Undo after the number was re-saved in another format but the same E.164 still undoes); the siblings this Accept superseded are pending again, and one that moved since is left alone; an inverse that succeeded followed by a failed compare-and-swap is stranded with its answer; the one-pending collision → `superseded`; Discard of an aged row writes `expired / aged`; a missing or hidden row answers "This suggestion isn't available."; Undo after Discard → pending with `decided_*` cleared; a to-do Undo emits `task.deleted` and revalidates the record page.
- **The card and the row:** five states in English, Spanish and the pseudo-locale; `lang` on the section, on the English title and on the evidence; exactly one primary per card and Save and accept as the only primary in edit mode; no primary in the flat row; no card element wrapping the stack; Esc cancels; skeleton and error states.
- **No contamination:** suggestions never reach `bucketWork`, the dashboard work row or `listAgencyWork`.
- **The generation boundary:** generating writes nothing to `tasks`, `contacts` or `opportunities` (retargeted, unchanged in force).

### 8.2 Database tests (replica, then bis-ci)

- No `anon` or `authenticated` grant writes `proposals`; a client reads its own account's rows and not another's; the agency reads all; the schema-wide guard passes with its allow-list unchanged.
- A Technician reads only rows whose customer is assigned to them, and no row without a customer.
- The composite FKs refuse a call or a contact from another account; deleting a call or a contact removes its rows; account teardown removes them.
- The CHECKs: decision completeness, `applied_payload` only when accepted or edited, `edited` requires a change, `expired` requires a reason, the source/key clause; an insert without `expires_at` fails.
- The immutability trigger refuses a change to `payload`, `evidence` or `expires_at` from the service role too.
- The one-pending index refuses a second pending row for the same call, kind and customer.
- **The copy, over seeded rows** (CI's databases are empty, so these tests seed `call_proposals` themselves). **The seed runs with the mirror and the guard off**: inside `withRollback`, as the owner the test connects as, `alter table public.call_proposals disable trigger call_proposals_mirror, disable trigger call_proposals_guard` (or `set local session_replication_role = replica`), then the seed inserts `pending`, `accepted` and `dismissed` rows (and, for the pre-check, a row whose call belongs to another account, which only the pre-check can catch because no mirrored copy exists), then the triggers are **enabled again** before `app.copy_call_proposals()` is called. Without that, the mirror would copy every seeded row first, so the copy would have nothing to do, a seeded `accepted` row would hit the mirror rather than the copy, and the pre-check would never be reached. Asserted: ids, per-status counts and `applied_payload` match; the cross-account row makes it raise `proposals_copy_cross_account` and copy nothing; a second call copies nothing new; the test asserts `proposals` held none of the seeded ids before the call, so it cannot pass on mirrored rows.
- **The mirror:** an insert through `call_proposals` appears in `proposals` with `expires_at` set; an old-code Accept (`pending → accepted`) succeeds and sets `applied_payload`; an old-code revert (`accepted → pending`) clears it; neither changes `expires_at`; a mirror that cannot write blocks the `call_proposals` write (seeded: a `call_proposals` insert whose contact belongs to another account, which `proposals`' composite FK refuses, so the insert into `call_proposals` fails too).
- **The guard (C1):** a suggestion accepted through `proposals`, then decided through `call_proposals` as the old code does (`update ... set status = 'accepted' ... where status = 'pending'`), raises `call_proposals_superseded`; the old `acceptProposal` run against it answers "That didn't go through. Try again." and makes **no** to-do; `proposals.decided_by` is unchanged. An old-code revert of the old code's own Accept is allowed. A `call_proposals` row with no `proposals` row raises too.
- **The guard's lock (R1), two sessions:** session A (new code) opens a transaction and runs the compare-and-swap `pending → accepted` on a `proposals` row, and holds it uncommitted; session B (old code) runs `update call_proposals set status = 'accepted' ... where status = 'pending'` on the same id and blocks on the guard's `for update`; A commits; B's guard then reads `accepted`, raises `call_proposals_superseded`, and B's update fails. The reverse order is tested too: B's update holds the lock uncommitted, A's compare-and-swap waits, B commits, A matches no row. In both orders exactly one side decided, and `proposals.decided_by` names that side.
- The agency RPC (8b-2) returns at most `p_per_account` rows per account, none past `expires_at`.

### 8.3 Vacuity-proof probes

Each is a mutation the reviewer applies and runs, and does not accept the plan's word that it fails (the test-vacuity rule):

| Mutation | The test that must fail |
|---|---|
| Drop `.eq("status", "pending")` from the compare-and-swap | two Accepts released through the barrier create exactly one to-do |
| Write the record before deciding | the same barrier test |
| Replace `apply`'s helper with a direct insert | the event and duplicate-flag assertions |
| Let `validateEdit` read `field` or `opportunityId` from the input | an edit carrying another field or deal is applied to the stored one |
| Skip `validateEdit` | an edited phone "abc" is refused |
| Skip `stillHolds`, or drop its placeholder rule | an Accept after the field was filled is Out of date; a first name over "Caller" is still fillable |
| Make `revertToPending` match `accepted` only | an `edited` Accept whose fill wrote nothing is left decided |
| Drop the server-side `expires_at` refusal | a 31-day-old suggestion accepted through the action is refused and marked `aged` |
| Set the Undo window to infinity, or drop the decider check | Undo after 2 minutes, and by another person, is refused |
| Run Undo's compare-and-swap before the inverse | an inverse that finds the record changed leaves the row decided |
| Skip the "still as Accept left it" check in `inverse` | Undo of a to-do retitled since leaves it in place |
| Skip giving back `applied_ref.superseded` on Undo | an Undo leaves the sibling suggestion out of date |
| Restore empty instead of `before` | Undo of a first name filled over "Caller" restores "Caller" |
| Grant `update (payload)` to `authenticated` | the grants test |
| Drop the restrictive Technician policy | the Technician reads an unassigned customer's suggestion |
| Add a kind to `PROPOSAL_KINDS` without the CHECK, or the reverse | the parity test |
| Map `accepted` to `pending` in the copy | the copy's per-status test, **seeded with the mirror and guard disabled** (§8.2), so the copy, not the mirror, is what wrote the rows |
| Drop the copy's cross-account pre-check | the cross-account row, **seeded with the mirror and guard disabled** (§8.2), is refused by name |
| Drop the guard trigger | the C1 test: a second to-do appears |
| Read `proposals` in the guard without `for update` | the two-session lock test: both sides decide |
| Compare with `<>` instead of `is distinct from`, or skip the missing-row raise | a guard over a missing `proposals` row lets the old update through |
| Let the mirror's update branch skip `applied_payload` | the old-code Accept fails with 23514 |
| Mark the 8b-2 timeline row with the AI kind | the provenance test (the accepter's person mark) |
| Render the Spanish card with an English status word | the bilingual render test, and the ratchet |

### 8.4 e2e (the per-run fixture account only)

On the per-run fixture account, never Test Client One or any live account, with a seeded call and three suggestions: Accept the to-do → it is in To do; Undo from the toast → it is gone and the card says Suggested; Edit and accept the phone with a bad value → refused, then a good one → saved and the card says Edited; Discard the stage move → Undo → Suggested; switch the reader to Spanish → the card's words are Spanish and the caller's words keep their `lang`. 8b-2 adds: the flat row in the record's What's next, the timeline row with the person mark, the agency Work page accepting for that account.

## 9. Not in 8b, and the revisits it lists

**Revisits of recorded positions (rule 11, :949), each changed here and listed:**
- Surface 6 (:2712-2747): **the same card in the drawer** (not in 8b, P20); **"Aceptar las 3"** (not in 8b, P11); **the 10-second undo** (kept in the toast; the server accepts 2 minutes as slack, P8); **phone swipes** (the card's buttons are the phone's controls in 8b); **the weekly acceptance line** (P21); **the empty sentence's "un correo o un documento"** (calls only until those sources exist).
- The F-133 row (:1180): the tray does not take over the stop hold yet (P16, §5.7; corrected at source).

**Not in 8b:**
- **F-022's items (8c):** author columns on the target tables, Sofía's live acts stamped as AI and undoable, a notice whenever Sofía changes a booking, and the inventory of live writes under decision 19, including the blank-fills of P17.
- **New sources and kinds:** email, texts, chat, documents, voice notes, reviews (§5.6). Suggestions read from email and texts also wait for decision 6 (crm-features :1318-1320, rule 14).
- **Spanish suggestion text** written by the model (P18).
- **Group record pages** (§5.3).
- **A count on the To do nav item:** it would add a read to every page's layout; later, with the 2027 spine (F-089).
- **Auto-accept at any confidence:** never (Surface 6, :2732).

## 10. Rollout

- **8b-1:**
  1. Read the Vercel project's skew-protection maximum age and write it in the ledger (§4.6, the gap).
  2. 0088 to bis-ci first (the `ci-project-setup.yml` workflow), then production once, then the parity check (`docs/runbooks/ci-supabase-project.md`); record `app.copy_call_proposals()`'s returned counts from both.
  3. **The migration before the code** (the new code reads only `proposals`). The mirror and the guard cover the gap, which lasts until READY plus the skew-protection maximum age.
  4. Owed after deploy, on the test account (the smoke-identities rule): one real call that makes a suggestion → a `proposals` row with a turn in `evidence_ref` and `expires_at` set; Accept, Undo, Edit and accept, Discard on the call page and in To do; a pre-deploy tab, if one is open, answers "That didn't go through" on a suggestion already decided in a new tab.
- **8b-2:** after the gap has closed and §4.6's three pieces of evidence hold on both projects, 0089 goes bis-ci → production → parity, then the code. **0089 is the point of no rollback to pre-8b code.** Owed: the record section and timeline row on an agency-owned customer, in English and Spanish; the agency Work page with a capped account.
- **Env:** none. Nothing is added to Vercel Preview.
- **Tracker:** item 8's S-14 and F-019 rows → `done` after 8b-2; F-022 stays open for 8c.

## 11. Things this spec was unsure of (for the review)

- **The 30-day age** (P10) is a judgement, not a measurement: the one live account's suggestion volume is too small to measure how long suggestions sit. Re-read after a month of 8b-1.
- **The skew-protection maximum age** is an assumption until it is read from the project's settings (§4.6); the gap's length, and so 0089's earliest date, depend on it.
- **Undo of a contact field restores what was there before**, which can be the "Caller" placeholder rather than empty. That is the honest inverse of `fillContactBlanks`, which overwrites the placeholder; it is limited to the decider within 2 minutes.
- **The mirror, the guard and the copy function are throwaway code.** They live through the gap and 0089 removes them; renaming the table was refused because it breaks the code running when the migration lands.
- **"Superseded" across two calls** (two calls each suggesting the same phone) is rare today; the spec does not group the two cards, it marks the older one out of date when the newer is accepted.
