# Caller identity checks scaled to each pack's risk, PR S-47e (F-116 part, migration 0098): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **Ceremony is tiered PER TASK** (owner rule 2026-10-19, binding; spec §9; memory "Speed process"): read each task's tier before dispatching it. HIGH gets the full ceremony; MEDIUM gets one review; LOW gets a short brief and no per-task review. One end-of-PR final review (opus), one design review, then ONE fix agent.

**Goal:** on a phone several customers share, Sofía asks whose appointment it is before she reads, moves or cancels one, and every booking, lead, message thread and blank-fill lands on the person the name or the confirmation picks, or on nobody. An insurance account (once its pack is switched on) also asks for the email on file. Two misses end the look-up and file one To-do. The shared number's missed-call texts and incoming texts file on one "Caller" holding record that staff move to the right person, with Undo. The SIP leg's caller-ID attestation is logged, never acted on.

**Architecture:**
- **Migration 0098** adds `contacts.holds_shared_number`, its shape CHECK, one holding record per account and number, a server-only trigger and `public.move_holding_thread(...)` (SECURITY DEFINER, service_role only).
- **`@bis/db`** gains `listContactsOnNumber`, `findUpcomingBookingForContact`, `ensureHoldingContact`, `moveHoldingThread`, `findConversationForContact`, `createContact`'s `matchBy: "email_only"`, and a holding-record skip in every dedupe and list read. `findUpcomingBookingForPhone` is removed.
- **A pure identity module** (`apps/web/src/lib/voice/identity/`) holds the ladder, the name and email rules, the decision, the per-call state helpers, the fixed tool-result sentences, the record picker and the tool flows. The live registry and the corpus stub both run it.
- **The registry** gates `find_my_booking`, `reschedule_appointment` and `cancel_appointment` on the per-call confirmation, adds `confirm_identity`, and picks the record for every voice write; on a phone with ONE contact, a different name asks "for you or for someone else?" through a structured `forSomeoneElse`. `finishCall`, the text-back and the inbound-text route use the same picker and the holding record; a YES from a shared number confirms the household's one asked appointment or files one To-do (S30).
- **The UI** uses existing surfaces only: the inbox list, the thread header (a Notice and a ghost "Move to…" menu with Undo), the call page's link, the record page's redirect and the palette's label.
- **The prompt does not change** (`PRE_S47B/C/D_DIGEST` stay green untouched). Only tool schemas and tool results change.

**Tech stack:** Next.js App Router (server components, server actions), Supabase Postgres + PostgREST, plpgsql, vitest, Playwright, `pg`, Radix (shadcn) `DropdownMenu`/`Dialog`, `sonner`.

**Spec:** `docs/superpowers/specs/2026-10-24-caller-identity-ladder-design.md` at `df8882ce`.
- E1–E8 are the owner's and are not reopened. O1–O3 are the orchestrator's. S1–S29 bind except where "Spec deviations" below records code or replica evidence against one.
- Every file:line below was read at `df8882ce` (= main `449d5bf6` + the spec). **Main has since moved to `a1ccb19a` (#287, S-47d follow-ups).** That PR changes 30 files; the only ones this plan cites are `apps/web/src/lib/messages.ts` and `apps/web/src/lib/messages.test.ts`. Task 0 rebases onto it and re-reads those cites (P14).

**Base:** `feat/s47e-identity` at `df8882ce` + this plan, rebased onto `origin/main` (`a1ccb19a` or later) in Task 0.
- `<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s47e` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s47e`).
- `<SCRATCH>` = the orchestrator's session scratchpad. Each brief carries it literally, plus a subdirectory of its own per agent.
- `<KIT>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/af047a84-9509-4fd4-98e5-c54325960da6/scratchpad/kit` (`replica.sh`, `pgrst.sh`, the plan writer's reviewed 0098 copy `0098_shared_number_holding.reviewed.sql`; read 2026-10-24, lines cited under Global constraints).

Path abbreviations:
- `[acct]` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]`
- `…/incoming/` = `apps/web/src/app/api/voice/incoming/`
- `…/identity/` = `apps/web/src/lib/voice/identity/` (new)
- `…/tools/` = `apps/web/src/lib/voice/tools/`
- `…/convos/` = `[acct]/conversations/`
- `…/inbound/` = `apps/web/src/app/api/sms/inbound/`

---

## Plan-writer check (done 2026-10-24; re-run in the fix round)

The 0098 SQL went through three versions on the plan writer's own PG18 replica on port **55490**, built by `<KIT>/replica.sh 55490 <dir> <0098 file>` (`pre` = every migration through 0097, one `psql -1 -f` per file; `post` = `pre` + the 0098 file under test):
- the spec's first text (spec §4.1 at `df8882ce`, lines 277-443; md5 `c262c2ed43bedb3a0fcea77bc45fd164`);
- the first plan's revision (md5 `13f26cbe99753bfbbd8e20e7ba9ee632`, approved by the opus plan review: md5, digest and definers reproduced, its 12 mutations failed, the rollback was clean);
- the first fix round's text (md5 `a76f898b5e362d9e0b8c71e2a0d28fff`, 216 lines; the re-review reproduced its md5, digest, definers, 32/32 and 19 mutations);
- **the second fix round's text** (Task 1 Step 4; md5 **`ae8371757c516d581810b713e86d7cb0`**; 221 lines). It answers the first review's items 7, 8, 11 and 13, closes the hole the first fix round found (P22), and the re-review's item 1 (P1: an Undo accepts only the function's own event). The spec's §4.1 carries the same text.
- **Task 1 changed the text after this check** (the orchestrator's amendments 1 and 2, then the Task 1 review's fix round and the unread hand-back, P32): md5 `fbee986eb08d1502eed552f4c1eed5a0`, 245 lines, a 52-case test, 36 mutations, each red, on the Task 1 implementer's replica (port 55492). The counts below are the plan writer's, on the 221-line text.

**Read off the replica, on the second fix round's text (every line re-run after the last change):**
- **Client-write digest** (the query at `packages/db/src/test/proposals-drop.test.ts:93-98`): `pre` = `post` = **`52|b66203ca5d355155540b520af510d120`**, unchanged.
- **Definers** in `public` and `app`: `pre` 22, `post` **23**. The new one: `public.move_holding_thread(uuid,uuid,uuid,text,bigint)`, `prosecdef` t, `proconfig` `{"search_path=pg_catalog, pg_temp"}`, owner `postgres`. The trigger function `app.contacts_holding_server_only()`: `prosecdef` f, the same `proconfig`.
- **Task 1's test, copied out of this plan** into a throwaway `packages/db/src/test/zz-holding-probe.test.ts`: `pre` → `Tests  42 failed (42)`; `post` → `Tests  42 passed (42)`.
- **Task 1 Step 6's 25 mutations**, each applied to its own database cloned from `pre` (`<KIT>/mutate4.js` writes them): 23 turned that file red; the two that each drop ONE of the Undo-of-an-Undo guards (m20a, m20b) stayed green, as Step 6 predicts, because each guard covers the other; dropping both (m20) is red. The counts are in Step 6.
- **`definer-search-path.test.ts`** with Task 1 Step 5's 23-entry pin applied (a temporary edit, restored by `cp` + `cmp`): `Tests  6 passed (6)` on `post`.
- **13 schema and grant suites on `post`** (`definer-search-path` unedited, `schema-grants-guard`, `proposals-drop`, `server-only-writes-grants`, `record-provenance-schema`, `one-switch-schema`, `call-card-schema`, `document-expiry-schema`, `document-requests-schema`, `structured-facts-schema`, `trade-modules-schema`, `customer-language-schema`, `company-name-read-only-schema`): `Test Files 1 failed | 12 passed (13)`, `Tests 1 failed | 374 passed (375)`. The one failure is the definer pin Task 1 updates ("exactly these 22"). `schema-grants-guard.test.ts` is green, so `EXPECTED_WRITES` does not change.
- On the first revision, three more files had failures on `post` AND on `pre`, 16 cases, identical by name: `voice-schema`, `same-account-fk-schema` and `ai-acts-schema`. Every one needs `serviceDb()` or PostgREST ("Supabase service env vars missing"), which a bare replica does not have. Environment, not 0098. (`customer-language-schema` and `company-name-read-only-schema`, which the first plan listed with them, are green: review item 14.)
- **Rollback:** the six ROLLBACK lines of the file's header, run on `create database rb template post`, leave 0 `contacts_holding%` constraints, 0 columns, 0 of the two functions, 0 indexes; definers back to 22; the digest still `52|b66203ca…`.
- **Bytes of the second fix round's file:** 0 non-ASCII and 0 backslashes (node byte count; its positive control on `é\` printed `2 1`); 0 carriage returns; exactly **12** `$` (the E.164 test is written without a `$` anchor, so every `$` is a dollar-quote); two consecutive apostrophes → `0`; no apostrophe on any `--` line or inside either comment string; `grep -ciw cascade` → `0`; one `security definer` on a code line; `grep -n "search_path"` → the header line 31 and the two `language plpgsql … set search_path = pg_catalog, pg_temp as` lines (80, 108); 221 lines.
- **What the first two texts got wrong, proven on the replica:**
  - The spec's Undo guard let an Undo that named its messages but no calls repoint a household member's own call to the holding thread (P1, first round). The fix round replaces the id arrays with the move's own event (P1).
  - **Both earlier CHECKs admitted a holding record with NO first name.** `first_name = 'Caller'` is NULL for a NULL first name, the whole term goes NULL, and a CHECK passes on NULL. An insert of `{ first_name: null, holds_shared_number: true }` succeeded on the first revision's `post` (P22).
- **0098 is free:** `git log --all --oneline -- 'packages/db/supabase/migrations/0098*'` printed nothing after `git fetch origin` (2026-10-24); `origin/main` is `a1ccb19a`, whose latest migration is still 0097.
- **The baseline the spec cites (§5.5):** `pnpm --filter web exec vitest run src/lib/voice/system-prompt.test.ts src/lib/voice/tools/schemas.test.ts src/lib/voice/tools/registry.test.ts` → `Test Files  3 passed (3)`, `Tests  256 passed (256)`, at `df8882ce`.
- **The `@bis/db` barrel loads under `tsx` with no env** (A3): a throwaway `apps/web/scripts/zz-barrel-probe.ts` (`import * as db from "@bis/db"`) printed `barrel loaded function 765`, then was deleted.
- **`normalisePhone`** (A9, P4): `"+52 1 899 922 1234"`, `"+5218999221234"`, `"899 922 1234"` and `"52 899 922 1234"` all read `+528999221234`; `"(956) 292-1696"` and `"9562921696"` read `+19562921696`.
- **The identity module** (first round): the model's code blocks, extracted into a throwaway folder, passed a probe of every example (`Tests 6 passed (6)`), and `pnpm --filter web typecheck` exited 0 with the model's `call-state.ts`. The fix round's changes to `match.ts`, `record.ts`, `flow.ts`, `results.ts` and `state.ts` are re-proven by Task 5's and Task 7's own red-first tests; they were not re-extracted.
- Every throwaway file was deleted (`git status --short` clean before each commit), and the replica was stopped afterwards (`pg_ctl stop -m fast`; port 55490 not listening).

---

## Spec deviations (code or replica evidence against the spec, or a gap it leaves; each with the resolution this plan uses)

The fix round's review items are cited as R1–R15 (the opus plan review of 2026-10-24) and its orchestrator rulings as the "ruling" of R2 and R3. The spec carries every change in the same commit (its §13).

- **P1. An Undo names its move, and moves back only what that move recorded** (R11; first round: the spec's guard let a call-less Undo repoint a housemate's calls).
  - **Resolution:** `move_holding_thread(p_account_id, p_from_conversation, p_to_conversation, p_actor, p_undo_of bigint default null)`. A move records the ids it moved on its `conversation.moved` event (`messageIds`, `callIds`) and returns `moveId`, that event's id. An Undo passes `p_undo_of`; the function reads that event of THIS account and refuses (`invalid`) unless the function itself wrote it (`actor_type = 'system'` and `payload.writer = 'move_holding_thread'`) and it is a move (not an Undo) between the same two threads reversed, then moves back only those ids still on the person's thread.
  - **Why the writer check is the guard (re-review R1, ruling):** any signed-in member, a Technician included, can append an event of any type and payload through `public.record_event` (`0053_server_only_writes.sql:64-89`), and it always stamps `actor_type 'user'` (`:87-88`); a client cannot insert into `events` any other way since 0053. A forged `conversation.moved` naming a housemate's message and call is therefore refused, and Task 1 has that exact probe (a Technician and an Owner call `record_event`, then the Undo with its id → `invalid`, Ana's call untouched; mutation m21). Only server code (service_role) could write an `actor_type 'system'` event, and it is trusted. This is the S-47d pattern (a server-written `system` event the app reads back: `apps/web/src/lib/team/removal-log.ts:47-48` reads `team.member_removed` by `.eq("actor_type", "system")`); `record_event` is not edited.
  - **The person is never shown as an automation:** `actor_id` and `payload.by` hold the person who moved the thread. No reader of `events` renders `conversation.moved` today: the dashboard's activity card turns only its listed types into copy and drops every other one (`[acct]/dashboard/activity-card.tsx:100-175`, `default: return null`); the record timeline reads no events at all (its sources are notes, To-dos, deals, forms, messages, bookings, calls and documents, `TIMELINE_SOURCES`); and every other `events` read filters its own type (`packages/db/src/booking.ts:477`, `contacts.ts:739`, `business-status.ts:249`, `team.ts:57`, `blueprints.ts:268`, `[acct]/contacts/groups-actions.ts:230-231`, `lib/team/removal-log.ts:47-48`; read 2026-10-24). A later reader that shows the move must name `payload.by`, never "an automation".
  - Nothing the browser sends can name a row. Task 11's Undo token carries only `moveId` and the two thread ids.
- **P2. 0098 follows 0097's byte rules.** The spec's first text had two `''` (`person''s`, `app''s`), apostrophes on seven `--` lines, `set local lock_timeout` at top level, and a LOCKS paragraph that is wrong inside one transaction (ADD COLUMN already holds ACCESS EXCLUSIVE to the end of the file).
  - Evidence: `0097_one_switch.sql` has 0 `''` and 0 apostrophes in comments, and 0091/0094/0097 set `lock_timeout` inside a `do` block (`0094_trade_modules.sql:62-68`).
  - **Resolution:** Task 1 Step 4's text.
- **P3. A signed-in UPDATE naming the mark is refused by the grant, not the trigger.** Evidence: `permission denied for table contacts` (42501), because no column UPDATE grant names `holds_shared_number` (`schema-grants-guard.test.ts:86-89`).
  - **Resolution:** the update probe expects `{ code: "42501" }`. "Drop the trigger" is caught by the INSERT probe and the edit probes (R8). The trigger's `new.holds_shared_number := old…` line is defence in depth for a future grant: `grant update (holds_shared_number) … to authenticated` → the update probe FAILS, and so does `schema-grants-guard.test.ts` (mutation m07).
- **P4. One more phone key.** `normalisePhone` reads `"+52 1 899 922 1234"` as `+528999221234` (A9), but its stored `phone_key` is `5218999221234`.
  - **Resolution:** `phoneKeysOf(e164)` returns the digits key, the ten national digits, and both the `52` and `521` forms; `isCallerIdNumber` (S1) still decides who is on the number.
- **P5. Two of spec §7's name mutations cannot fail.** "García María" already fails rule 2; "María de" is not a subsequence of "María Elena García López".
  - **Resolution:** rule 3's probe is "María López García" against "María Elena García López"; rule 4's is "María de" against "María de la Cruz". Each is rejected by its rule alone.
- **P6. "Refuses once" needs memory.** Spec §5.10.5's `take_message` "refuses once".
  - **Resolution:** `IdentityState.messageNameAsked`. (`leadWhoseAsked`, P27, is its twin for a lead.)
- **P7. A confirmation of the right person at too low a rung** answers NOT CONFIRMED YET; only a confirmation of a DIFFERENT contact answers "isn't one they have confirmed is theirs".
- **P8. More LOAD-BEARING sites than spec §4.2 lists:** the inbox's three reads (`packages/db/src/messaging.ts:644`, `:767`, `:913`), `COLS` (`contacts.ts:69-70`), `findConversationForContact`. No scope change; the PR body names them.
- **P9. The label needs the number:** `ConversationSummary` gains `holdsSharedNumber` and `sharedNumber`.
- **P10. One flow, two callers:** `…/identity/flow.ts` (and the lead/booking picker in `record.ts`) hold the pure steps; the registry and the corpus stub feed them reads.
- **P11. The parity test gets its own file** (`corpus-parity.test.ts`), and `corpus-lib.test.ts:437`'s pinned regex changes with the session argument.
- **P12. One e2e spec** (Task 16): the inbox Move is not a phone path, and the binding process rule asks for one, run against a production build before the final review.
- **P13. The work-list mutation needs a fixture that can fail:** two precedence probes on the pure function.
- **P14. Main moved, and Owner is "dueño" in Spanish now** (`a1ccb19a`, #287). Task 0 rebases; Task 2 uses "dueño".
- **P15. The text-back resolver is a wrapper** (`resolveTextbackContact`), not a mode.
- **P16. The text-back's contact types widen** to `ResolvedTextbackContact`.
- **P17. `findUpcomingBookingForPhone` leaves with its last caller** (Task 6).
- **P18. A holding call has no resend button** (`[acct]/calls/[callId]/page.tsx:436-441` needs a contact). Out of scope; noted for the owner.
- **P19. A consent To-do from a shared number names the number, never "Caller"** (R5). `holdTodo` and `cancelTodo` build their titles from `contactLabel` (`apps/web/src/lib/consent/inbound.ts:123-127`), which would read "Caller may have asked to stop texts…" on a holding record.
  - **Resolution:** on the holding path the hold To-do's title is `todo.sharedNumber.hold` ("A text from the shared number {number} may have asked to stop texts: “{excerpt}”. Texts to that number are on hold.") and the CANCEL To-do follows S30 (P30). Both on the holding record, in the account's language. The ledger itself is keyed by the phone address, unchanged.
- **P20. The call page's link for a holding call opens the thread** (`conversations?c=<id>`, `call.holding.openTexts`).
- **P21. The palette's label is English** (`holdingLabel(number, "en")`), matching the route's other labels.
- **P22. The shape CHECK is written null-safe.** Evidence: the replica, above. A CHECK passes when its expression is NULL, and `first_name = 'Caller'` is NULL for a NULL first name.
  - **Resolution:** `first_name is not distinct from 'Caller'`, and `phone is not null` with a plain E.164 test (length 8–16 since Task 1's amendment 2, a leading `+`, digits after it). Mutation m02 (`first_name = 'Caller'`) → the "no first name" case FAILS.
- **P23. One holding record per account and E.164, not per `phone_key`** (R13). Two numbers of two countries can share a digits key: `+1 322 123 4567` and Belgium's `+32 2 123 4567` both key `3221234567`. With the index on `phone_key`, the second number's `ensureHoldingContact` got 23505, re-read by its own E.164, found nothing, and threw, so the inbound route answered 503 to every retry.
  - **Resolution:** `contacts_one_holding_per_number` is unique `(account_id, phone)`, and the CHECK fixes a holding record's phone to E.164, so the two can never collide. `ensureHoldingContact` reads by the exact phone. If a 23505 is ever followed by a read that finds no row, it throws `HoldingContactUnavailable`. Its one remaining cause is a delete racing the insert, which a retry recovers from, so the inbound route answers it like any other filing failure: `FilingFailed`, 503, and Telnyx retries (re-review R5; the collision that could have made it permanent is gone with the index on the exact E.164). The text-back logs and sends nothing. Mutation m04 (back to `phone_key`) → the two-countries case FAILS.
- **P24. Staff cannot edit a holding record** (R8). The spec's §4.1 said "no name or customer detail is ever written onto it … for every writer, staff included", but the CHECK binds only the name, the email and the phone's shape; a signed-in session could still change its phone, source, custom fields, `dnd` and the rest.
  - **Resolution:** the trigger refuses (42501, "A shared number holding record is changed by server code only") any signed-in change to a holding record's `first_name`, `last_name`, `email`, `phone`, `phone_country_unconfirmed`, `source`, `custom`, `attribution`, `dnd` or `marketing_email_opted_out_at` (every client-updatable column except `assigned_to` and `updated_at`, `schema-grants-guard.test.ts:86-89`). Server code (service_role) is not limited. Mutation m06 → the four edit cases FAIL.
- **P25. A different person after a confirmation** (R1). Confirm Beto, then ask about Ana's appointment: `find_my_booking` reads the confirmation it holds and answers Beto's time as if it were Ana's. And on a number with one contact, `decideIdentity`'s first rows confirmed the sole contact whatever name `confirm_identity` was given.
  - **Resolution (tool text and code only; the prompt digests stay untouched):**
    - `confirm_identity`'s description now opens: "Confirm whose appointment the caller means, when find_my_booking asks you to and whenever the caller asks about a different person's appointment than the one already confirmed."
    - A found result whose confirmation came from a name (`by` `name` or `name_email`) carries `FOUND_BY_NAME_NEXT`: "This is the appointment of the person they confirmed. If the caller asks about a different person's appointment than the one already confirmed, call confirm_identity with that person's first and last name before you call find_my_booking again."
    - Spec §5.3's sole-candidate row applies only when no full name is given: `confirm_identity` with a name on a one-contact number confirms only when the name matches.
    - Tests: the Beto-then-Ana case, and a wrong name on a one-contact number is a miss.
- **P26. The name rule (R2, ruling a).** The spec's rule (the spoken words a subsequence of the record's) duplicated "María García López" against a sole "María García", and locked out a son "José Garza" whose father "José Luis Garza" shares the number.
  - **Resolution:** `nameMatch(spoken, record)` is `"exact"` when the words are the same, in order; `"partial"` when the first words are equal and EITHER every spoken word is on record in order (its last word not a particle, rules 3 and 4) OR every word of the record's name was spoken, in order; else null. Both names need two words or more (rule 1). `nameHits` takes the exact hits when there are any, else the partial ones. A partial match that hits more than one candidate is ambiguous: with an email given it must pick one, otherwise `ask_email` when any of them has one, else a miss. So "José Garza" is the son (exact), "José Luis Garza" the father, and "María García López" is the sole "María García" (partial).
- **P27. A name that does not match the ONE contact on a number asks, never creates silently** (R2, ruling b; finding 9).
  - **Resolution:** `book_appointment` and `capture_lead` gain a structured `forSomeoneElse: boolean`. On a number with exactly one real contact: `true` → a new contact (`create`); `false` → that contact, whatever the name (nicknames: "Daniel" for "Dan", "Beto" for "Roberto"); absent and the name agrees with the contact (P26's rule, a first name alone counting when its first word is the contact's) or the contact is a "Caller" placeholder → today's path; absent and the name does not agree → `ask_whose`, whose result asks "Is this appointment for you or for someone else?" in English and Spanish. `book_appointment` writes nothing until answered. `capture_lead` asks ONCE (`leadWhoseAsked`) and then records the lead; `finishCall` then files a lead still unanswered on no customer (the same order as the booking's: the picker, with the call's confirmation counted only on the caller-ID number). This replaces S20's "a full name that does not match a sole contact makes a new contact".
- **P28. Spanish dash words** (R2, ruling c): `spokenEmail` maps "guion bajo" → `_`, "guion medio" → `-`, "guion" (with or without its accent) → `-`, "raya" → `-`, and still "dash"/"hyphen" → `-`, "underscore" → `_`. Each is pinned by a test.
- **P29. A new person on a shared number is still offered to the merge queue** (R2). `createContact` with `matchBy: "email_only"` skipped the phone branch entirely, so "Beto" made next to an existing "Roberto" was never flagged.
  - **Resolution:** with `matchBy`, the phone lookup still runs (the holding record skipped), never as the winner; after the insert, the new contact and the first phone match are filed as one `contact_duplicate_flags` pair, reason `phone_shared_new_person` (the table's only CHECK is the pair's order). The number stays shared until staff merge the two, which is what the flag is for.
- **P30. Replies and CANCEL words from a shared number (R3, ruling; spec S30).** `applyConfirmationReply` (`packages/db/src/automations.ts:938-996`) finds the booking by `contact_id`, so once a shared number's texts file on its holding record a household member's "YES" never confirms their appointment; `cancelTodo` (`apps/web/src/lib/consent/inbound.ts:130-139`) likewise looks for the holding record's own (non-existent) next booking.
  - **Resolution, on the holding path only:**
    - A recognised one-word answer (`matchConfirmationReply`) looks for outstanding confirmation asks across the REAL contacts on the number (`listOutstandingConfirmAsks`, Task 10). Exactly one → `applyConfirmationReply` for that contact, as today. More than one, or none → nothing is applied, and ONE To-do is filed on the holding record: `todo.sharedNumber.reply`, "A reply from a shared number couldn't be matched to one appointment", in the account's language.
    - A CANCEL word: the real contacts with an upcoming booked appointment (`nextBookedStart` each). Exactly one → today's CANCEL To-do for THAT contact, with their name and date. More than one → the same `todo.sharedNumber.reply` To-do on the holding record. None → no To-do, today's rule for a CANCEL with nothing to check (`inbound.ts:131-132`); said in S30.
- **P31. Task 10 is HIGH and carries mutation probes** (R4): (a) and (b) plus the reviewer's own, like the other HIGH tasks.
- **P32. Task 1's review fix round (2026-10-24): a business name, an empty move, and three pins.** The Task 1 review proved on its replica that `set_contacts_business` (0069) puts a business name on a holding record: `app.sync_company_name` is a definer and writes `company_name` as its owner, so the trigger never sees a signed-in session.
  - **Resolution:** `contacts_holding_shape` gains `company_name is null`, so that group write fails 23514 for every writer. (`contacts_company_name_derived` already re-derives any `company_name` an insert or update names, so the group write is the one shape that can carry one, and the test probes exactly that, with a person as its control.)
  - A forward move that finds nothing left to move (a concurrent second move, or a stale tab) answers `{"status":"empty"}`, changes no count and writes no event, so no toast claims a move and no Undo can name one. Task 3 maps it, Task 11 answers `conversation.holding.moveEmpty` (a Task 2 follow-up key) and Task 12's handler toasts it. An Undo never answers `empty`.
  - The E.164 bounds are pinned at both edges (8 and 16 characters admitted, 7 and 17 refused), and the Undo's `e.type` check has its own probe.
  - **The unread count goes back with an Undo** (the orchestrator's ruling after the review approved `1d9cffd8`): a move records on its event the unread count it handed over (`unread`); its Undo hands that back, at most what the person's thread still has unread (some may have been read since; `conversations.unread_count` has no CHECK, so the cap is what keeps it from going negative), and nothing when it moves nothing. So a second Undo of the same move answers `{"status":"ok","messageIds":[],"callIds":[]}`, hands back 0 and still writes its event.
  - **For any later reader of `events` that renders a move on a timeline (re-review Minor 2):** skip an Undo event that moved nothing (`undo` true, `messageIds` and `callIds` both empty); it is a second press of Undo, not news.
  - 0098 is md5 `fbee986eb08d1502eed552f4c1eed5a0` (245 lines); Task 1's test has 52 cases.
- **Confirmed, not deviations:**
  - Every registry, finish-call, textback, phone-number, sip-headers, telnyx-request, card-focus, corpus-lib, contacts, voice and route cite in the spec reads as the spec says at `df8882ce` (re-read for this plan).
  - `isCallerIdNumber(stored, number)` (`phone-number.ts:63-67`) is a plain normalised compare, so it filters candidates for any number (spec §4).
  - `ensureCallbackTask` (`voice.ts:695-727`) answers a second insert for the same call with the first row (`created: false`), so the identity To-do needs no new dedupe.
  - `tasks_call_once` already exists; no new link kind.
  - `contacts.ts:343` already queries `.in("phone_key", …)`, so the candidate read's filter shape is proven over PostgREST.
  - No same-account foreign key ties `messages` or `conversations` to their account (only `bookings` and `opportunities`, `0050_same_account_fks.sql:98-110`), which is why Task 1 can build the cross-account rows its account-filter mutations need.

---

## Owner questions

- **Q1 (non-blocking; the plan pins its drafts, and the design reviewer reads them at 7 AM). Four staff-facing strings spec §6 did not draft**, needed by the Move menu's search and its role refusal:

  | Key | English | Spanish (usted) |
  |---|---|---|
  | `conversation.holding.findLabel` | Search customers by name or phone | Buscar clientes por nombre o teléfono |
  | `conversation.holding.findNone` | No customers match. | Ningún cliente coincide. |
  | `conversation.holding.findFailed` | Couldn't search customers. Try again. | No se pudo buscar clientes. Inténtelo de nuevo. |
  | `conversation.holding.moveRole` | Only an Owner or Staff can move these texts. | Solo un dueño o un empleado puede mover estos mensajes. |

  **Recommendation:** approve. The role sentence mirrors `business.refuse.keep` word for word in both languages.

- **Q2 (non-blocking, the fix round's two To-do titles; P19, P30).** The orchestrator's ruling gave the English of the first; the rest are the plan's drafts:

  | Key | English | Spanish (usted) |
  |---|---|---|
  | `todo.sharedNumber.reply` | A reply from a shared number couldn't be matched to one appointment | Una respuesta de un número compartido no se pudo asociar con una sola cita |
  | `todo.sharedNumber.hold` | A text from the shared number {number} may have asked to stop texts: “{excerpt}”. Texts to that number are on hold. | Un mensaje del número compartido {number} quizá pidió dejar de recibir mensajes: “{excerpt}”. Los mensajes a ese número están en pausa. |

  **Recommendation:** approve. The hold sentence follows `todo.consent.hold.en`/`.es` (`messages.ts:932-933`) with the number in place of the name. Both are rendered in the ACCOUNT's language (ruling R3); today's consent To-dos stay English (`inbound.ts:134`, `:144` read the `.en` keys), which this PR does not change.

No other open question. Two behaviours the owner may want to know about are in "Notes for the owner" at the end.

---

## Tiers (binding, per task)

| Task | What | Tier | Owner | Review |
|---|---|---|---|---|
| 0 | Rebase onto main, install, pre-reads, MCP reads on both projects, ports, the bare-factory list | — | orchestrator | — |
| 1 | Migration 0098 and its withRollback proof; `EXPECTED_DEFINERS` 22 → 23 | **HIGH** | bis-db-schema (opus) | opus bis-reviewer in its OWN detached worktree and replica, mutation probes; re-review on any change; orchestrator applies once |
| 2 | Every new copy key, English and Spanish; the insurance hint's closing sentence | LOW | bis-frontend | none |
| 3 | `@bis/db` voice reads and the holding writers: `listContactsOnNumber`, `phoneKeysOf`, `findUpcomingBookingForContact`, `ensureHoldingContact`, `moveHoldingThread`; the `emailKey` barrel line | **HIGH** | bis-voice (opus) | opus bis-reviewer, own worktree and replica + PostgREST |
| 4 | `@bis/db` contacts: `matchBy`, every dedupe's holding skip, the lists and count, `COLS`, the import's match index; the inbox reads' holding fields and `findConversationForContact` | **HIGH** | bis-db-schema (opus) | opus bis-reviewer, own worktree and replica + PostgREST |
| 5 | The identity module (ladder, match, state, results, candidates, flow) and `CallState.identity` | MEDIUM | bis-voice | one sonnet bis-reviewer, own worktree |
| 6 | The gate: `find_my_booking`, `confirm_identity`, `reschedule`/`cancel` ownership, the schemas, `ToolContext.tradeModule`; `findUpcomingBookingForPhone` removed | **HIGH** | bis-voice (opus) | opus bis-reviewer, own worktree, mutation probes |
| 7 | The record rule in the call: the picker, `book_appointment`'s contact choice and fill, `forSomeoneElse` on a one-contact number, `capture_lead`'s ask, `take_message`'s name | **HIGH** | bis-voice (opus) | opus bis-reviewer, own worktree, mutation probes |
| 8 | The record rule after the call: `resolveContactId`, the text-back's holding record, the adopt rule, `contactForCallerId` | **HIGH** | bis-voice (opus) | opus bis-reviewer, own worktree, mutation probes |
| 9 | The identity To-do in `finishCall`; `workRowHref`'s call link | MEDIUM | bis-voice | one sonnet bis-reviewer, own worktree |
| 10 | Inbound texts from a shared number: the holding filing, its fail-closed path, confirmation replies and CANCEL words across the household (S30), the shared hold To-do | **HIGH** | bis-comms (opus) | opus bis-reviewer in its own detached worktree, mutation probes (a), (b), (c) and its own; re-review on any change |
| 11 | The inbox Move and its Undo: two server actions and their role check | MEDIUM | bis-comms | one sonnet bis-reviewer, own worktree |
| 12 | The UI: inbox label, thread Notice and Move menu, call-page link, record-page redirect, palette label; the i18n baselines | LOW | bis-frontend | none |
| 13 | The SIP attestation log line and the shared value rule | LOW | bis-voice | none |
| 14 | The corpus stub follows the ladder; the parity test | LOW | bis-voice | none |
| 15 | The runbook's Step 8 and the press-1 sentence | LOW | bis-platform | none |
| 16 | The e2e spec: Move and Undo on a holding thread | LOW | bis-e2e-qa | none |
| 17 | Whole-branch final review (opus), design review (opus), ONE fix agent | — | bis-reviewer, bis-design-reviewer, one fixer | checkpoint |
| 18 | Rollout | — | orchestrator | — |

**Waves (tasks in one wave share no file):**
- **Wave A** (parallel, after Task 0):
  - Task 1: the migration, `shared-number-holding-schema.test.ts` (new), `definer-search-path.test.ts`.
  - Task 2: `messages.ts`, `messages.test.ts`.
  - Task 13: `lib/voice/attestation-log.ts` (new, + test), `…/texml/telnyx-request.ts`, `lib/voice/sip-headers.ts` (+ test), `…/incoming/route.ts`, `…/incoming/route.test.ts`.
  - Task 15: `docs/runbooks/voice-setup.md`.
- **Wave B** (after Task 1's review approves; it needs 0098 on its replica): Task 3: `packages/db/src/voice.ts`, `packages/db/src/index.ts:25`, `packages/db/src/test/voice.test.ts`.
- **Wave C** (parallel, after Task 3):
  - Task 4: `packages/db/src/contacts.ts`, `packages/db/src/contact-import.ts`, `packages/db/src/messaging.ts`, `packages/db/src/index.ts:51-58` (a different line from Task 3's, and Task 3 is committed), their three db test files, and the typed `ConversationSummary` literals the typecheck lists.
  - Task 5: `…/identity/{ladder,match,state,results,candidates,flow}.ts` (+ tests), `lib/voice/call-state.ts` (+ test).
- **Wave C2:** Task 11, after Tasks 2 and 4: `…/convos/actions.ts`, `…/convos/actions.test.ts`.
- **Wave D:**
  - Task 6, after Tasks 5 and 13 (both touch nothing of each other, but Task 6 edits `…/incoming/route.ts` one line after Task 13's): `…/tools/registry.ts`, `…/tools/schemas.ts`, `…/tools/registry.test.ts`, `…/tools/schemas.test.ts`, `…/incoming/route.ts`, `packages/db/src/voice.ts` and `voice.test.ts` (the removal only).
  - Task 10, after Tasks 2, 4 and 5: `…/inbound/route.ts`, `…/inbound/route.test.ts`, `…/inbound/route.consent.test.ts`, `apps/web/src/lib/consent/inbound.ts` (+ `inbound.test.ts`), `packages/db/src/automations.ts` (one new export), `packages/db/src/index.ts:119` (one name; Tasks 3 and 4 own other lines and are committed), `packages/db/src/test/automations.test.ts` (one new `describe`).
  - Task 12, after Tasks 2, 4 and 11: `…/convos/{page,conversation-list,message-thread}.tsx`, `…/convos/holding-move.tsx` (new), `…/convos/holding-move-handlers.ts` (new, + test), `[acct]/calls/[callId]/page.tsx`, `[acct]/contacts/[contactId]/page.tsx`, `apps/web/src/app/api/accounts/[accountId]/search/route.ts`, `apps/web/src/lib/contacts/holding-label.ts` (new, + test), their tests, the two i18n baselines.
- **Wave E:** Task 7, after Task 6: `…/identity/record.ts` (new, + test), `…/tools/registry.ts`, `…/tools/schemas.ts`, `…/tools/registry.test.ts`, `…/tools/schemas.test.ts`.
- **Wave F** (parallel, after Task 7):
  - Task 8: `lib/voice/finish-call.ts`, `lib/voice/textback.ts`, `finish-call.test.ts`, `textback.test.ts`.
  - Task 14: `lib/voice/modules/corpus-lib.ts`, `apps/web/scripts/sofia-corpus.ts`, `corpus-lib.test.ts`, `corpus-parity.test.ts` (new).
- **Wave G:** Task 9, after Tasks 2 and 8: `lib/voice/finish-call.ts`, `finish-call.test.ts`, `lib/documents/card-focus.ts` (+ test).
- **Wave H:** Task 16, after Tasks 3, 4, 11 and 12: `apps/web/e2e/shared-number.spec.ts` (new).
- **Then:** Task 17, Task 18.
- **Pushes:** the orchestrator pushes after Task 1's review approves and applies 0098 to bis-ci then (Task 18 step 1). CI `verify` then exercises 0098 on the CLI's PostgreSQL 17, and Vercel Preview keeps working once the app names the new objects.

---

## File map

| File | Task | Change |
|---|---|---|
| `packages/db/supabase/migrations/0098_shared_number_holding.sql` | 1 | new |
| `packages/db/src/test/shared-number-holding-schema.test.ts` | 1 | new (withRollback): shape, CHECK by name, unique index across accounts, trigger, `move_holding_thread` behaviour and grants, comments, settings |
| `packages/db/src/test/definer-search-path.test.ts:25-50` (the 22-entry `EXPECTED_DEFINERS`, its doc line and the `toHaveLength(22)`) | 1 | one entry, 22 → 23 |
| `apps/web/src/lib/messages.ts` (after `"voice.knowledge.noClosedDaysRecorded.es"`, `messages.ts:2573` at `a1ccb19a`; and the `voice.tradeRules.insurance_pcHint` pair at `:2056-2057`) + `messages.test.ts` (one new `describe`; the S-47b pin of the hint at `:1409-1411` at `df8882ce`) | 2 | 13 new keys + their twins; the hint's closing sentence |
| `packages/db/src/voice.ts` (new exports after `ensureCallbackTask`, `:695-727`) | 3 | reads and writers |
| `packages/db/src/index.ts:25` (one line after it) | 3 | `export { emailKey } from "./contacts";` |
| `packages/db/src/index.ts:51-58` (the messaging export block) | 4 | `findConversationForContact` |
| `packages/db/src/test/voice.test.ts` | 3 (add), 6 (remove the old test, `:197-217`, and its import, `:14`) | PostgREST |
| `packages/db/src/contacts.ts:33-42`, `:69-70`, `:261-354`, `:396-423`, `:425-494`, `:502-515`, `:883-891`, `:993-997` | 4 | `matchBy`, skips, lists, `COLS` |
| `packages/db/src/contact-import.ts:38-53` | 4 | `buildMatchIndex` skips the holding record |
| `packages/db/src/messaging.ts:46-56`, `:633-761`, `:763-787`, `:888-948` (+ a new `findConversationForContact`) | 4 | holding fields on the summary |
| `packages/db/src/test/contacts.test.ts`, `contact-import.test.ts`, `messaging.test.ts` | 4 | PostgREST |
| `…/identity/{ladder,match,state,results,candidates,flow}.ts` (+ one test each) | 5 | new, pure except `candidates.ts`'s one read |
| `apps/web/src/lib/voice/call-state.ts:12`, `:64-113` (+ `call-state.test.ts`) | 5 | `identity`, `TakenMessage.name/nameDeclined` |
| `…/tools/registry.ts:2-41`, `:49-73`, `:96-136`, `:306-329`, new `confirm_identity` case, `:582-583`, `:712-713` | 6 | the gate |
| `…/tools/schemas.ts:6-26` | 6 | `confirm_identity`, `find_my_booking`'s sentence |
| `…/incoming/route.ts:1266-1271` | 6 | `tradeModule` on the tool context |
| `…/tools/registry.test.ts`, `…/tools/schemas.test.ts` | 6, 7 | |
| `…/identity/record.ts` (+ test) | 7 | new, pure |
| `…/tools/registry.ts:331-337` (capture_lead), `:339-347` (take_message), `:437-476` (the book contact) | 7 | |
| `…/tools/schemas.ts:10-12` (book), `:29-31` (capture_lead), `:32-34` (take_message) | 7 | `forSomeoneElse` ×2, `take_message.name`, `nameDeclined` |
| `apps/web/src/lib/voice/finish-call.ts:292-379`, `:632-660` (+ `finish-call.test.ts`) | 8 | resolver, text-back, adopt |
| `apps/web/src/lib/voice/textback.ts:64-75`, `:126-136` (`TextbackOutcome`), `:154-184`, `:215-325` (+ `textback.test.ts`) | 8 | holding record |
| `apps/web/src/lib/voice/finish-call.ts:798-835` (+ `finish-call.test.ts`) | 9 | the identity To-do |
| `apps/web/src/lib/documents/card-focus.ts:23-42` (+ `card-focus.test.ts`) | 9 | the call link |
| `…/inbound/route.ts:193-218`, `:235-242` (+ `route.test.ts`, `route.consent.test.ts`) | 10 | holding filing, its fail-closed path, the household reply (S30) |
| `apps/web/src/lib/consent/inbound.ts:94-150` (+ `inbound.test.ts`) | 10 | `sharedNumber` on the input; the shared hold and CANCEL To-dos |
| `packages/db/src/automations.ts` (after `applyConfirmationReply`, `:938-996`), `packages/db/src/index.ts:119` (+ `automations.test.ts`) | 10 | `listOutstandingConfirmAsks` |
| `…/convos/actions.ts` (+ `actions.test.ts`) | 11 | two actions |
| `…/convos/page.tsx:255-256`, `:369-385`, `conversation-list.tsx:52-58`, `message-thread.tsx:24-115`, new `holding-move.tsx`, `holding-move-handlers.ts` | 12 | |
| `[acct]/calls/[callId]/page.tsx:232-262` | 12 | `Open the texts` |
| `[acct]/contacts/[contactId]/page.tsx:94-95` | 12 | the redirect |
| `apps/web/src/app/api/accounts/[accountId]/search/route.ts:121-133` | 12 | the label |
| `apps/web/src/lib/contacts/holding-label.ts` (+ test) | 12 | new |
| `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` | 12 | regenerated last |
| `apps/web/src/lib/voice/attestation-log.ts` (new, + test); `…/texml/telnyx-request.ts:63-108`; `lib/voice/sip-headers.ts` (+ test); `…/incoming/route.ts:924` (+ `route.test.ts`) | 13 | |
| `apps/web/src/lib/voice/modules/corpus-lib.ts:38-43`, `:163-206`; `apps/web/scripts/sofia-corpus.ts:214`; `corpus-lib.test.ts:435-439`; new `corpus-parity.test.ts` | 14 | |
| `docs/runbooks/voice-setup.md` (after "Step 7 — Booking leg", before "## Video meetings (Daily.co)" at `:487`; and `:795-796`) | 15 | Step 8 |
| `apps/web/e2e/shared-number.spec.ts` | 16 | new |

**Not touched:**
- `apps/web/src/lib/voice/system-prompt.ts` and `system-prompt.test.ts` (spec §5.5): the three digests stay green untouched.
- `apps/web/src/lib/voice/modules/{index,insurance-pc,events,pin}.ts`: no module text, `VERSION` or hash moves.
- `packages/db/src/test/schema-grants-guard.test.ts` and `proposals-drop.test.ts`: the replica proved both unchanged (Plan-writer check).
- The web chat and the browser voice demo (rung 0, spec §5.8).
- `ACCOUNT_OWNED_TABLES`: no new table.

---

## The model (every task reads this; names are binding)

### 0098 (Task 1)

| Object | Name and rule |
|---|---|
| Column | `public.contacts.holds_shared_number boolean not null default false` |
| CHECK | `contacts_holding_shape`: `not holds_shared_number or (first_name is not distinct from 'Caller' and last_name is null and email is null and company_name is null and phone is not null and length(phone) between 8 and 16 and substr(phone, 1, 1) = '+' and substr(phone, 2) !~ '[^0-9]')`, null-safe (P22), added NOT VALID then validated; `company_name is null` because the business group sync writes it as a definer (P32) |
| Index | `contacts_one_holding_per_number`: unique `(account_id, phone) where holds_shared_number` (the exact E.164, P23) |
| Trigger | `contacts_holding_server_only` BEFORE INSERT OR UPDATE FOR EACH ROW → `app.contacts_holding_server_only()` (plain plpgsql, not definer). For `current_user = 'authenticated'`: INSERT stores `false`; UPDATE of a holding record that changes any of `first_name, last_name, email, phone, phone_country_unconfirmed, source, custom, attribution, dnd, marketing_email_opted_out_at` raises 42501 "A shared number holding record is changed by server code only" (P24); every UPDATE keeps `old.holds_shared_number` |
| Function | `public.move_holding_thread(p_account_id uuid, p_from_conversation uuid, p_to_conversation uuid, p_actor text, p_undo_of bigint default null) returns jsonb`, SECURITY DEFINER, `set search_path = pg_catalog, pg_temp`, EXECUTE to service_role only |
| Answers | `{"status":"invalid"}` (same conversation twice; not exactly one side holding; toward the holding side with no `p_undo_of`; away from it with one; a `p_undo_of` that is not a move of this account between the same two threads reversed, P1), `{"status":"not_found"}` (either conversation not on this account), `{"status":"empty"}` (a move with no `p_undo_of` that found no message and no call left to move: no count changes and no event is written, P32), `{"status":"ok","moveId":<bigint>,"messageIds":[…],"callIds":[…]}` |
| Event | `conversation.moved`, written by the function itself: `actor_type` `system`, `actor_id` = `p_actor` (the person), payload `{ writer: "move_holding_thread", by: <the person>, fromConversationId, toConversationId, fromContactId, toContactId, messages, undo, undoOf, unread, messageIds, callIds }`, where `unread` is the unread count the move handed over (an Undo: the count it handed back, capped at the person thread's, 0 when it moved nothing; P32); its `id` is the answer's `moveId`; an `empty` move writes none. An Undo accepts only such an event (P1) |

### `@bis/db` (Task 3) — `packages/db/src/voice.ts`

```ts
// New import at the top of voice.ts (contacts.ts imports nothing from voice.ts, so there is no cycle):
import { phoneDigits, phoneFields } from "./contacts";

/** S-47e (spec 4, 5.2): one contact on a number, as the identity check and the record picker read it. The raw
 *  stored email is never selected (spec E2, S3): only its key. */
export type NumberContactRow = {
  id: string; first_name: string | null; last_name: string | null; phone: string | null;
  email_key: string | null; holds_shared_number: boolean;
};

/** More than this many contacts on one number cannot be narrowed by name on a call (spec S6). */
export const CONTACTS_ON_NUMBER_LIMIT = 20;

/**
 * The phone_key values a stored phone that reads as this E.164 can carry (spec 4; plan P4): its own digits key
 * (phoneDigits folds a leading NANP 1), and for a Mexican number its ten national digits plus both the 52 and
 * 521 forms of them, because "+52 1 899 922 1234" reads as +528999221234 but keys 5218999221234. A superset on
 * purpose: isCallerIdNumber decides who is really on the number.
 */
export function phoneKeysOf(e164: string): string[] {
  const key = phoneDigits(e164);
  const ten = /^521(\d{10})$/.exec(key)?.[1] ?? /^52(\d{10})$/.exec(key)?.[1] ?? null;
  return ten === null ? [key] : [...new Set([key, ten, `52${ten}`, `521${ten}`])];
}

/**
 * Every contact of THIS account whose phone_key could be this number, oldest first, at most
 * CONTACTS_ON_NUMBER_LIMIT; `truncated` when more came back. Holding records come back flagged; the callers
 * treat them as nobody (spec 5.12.3). The rows are NOT yet filtered by isCallerIdNumber (the app does that,
 * spec S1). Throws on a read error: every caller fails closed or has a net (spec S5).
 */
export async function listContactsOnNumber(
  db: SupabaseClient, accountId: string, e164: string,
): Promise<{ rows: NumberContactRow[]; truncated: boolean }> {
  const { data, error } = await db.from("contacts")
    .select("id, first_name, last_name, phone, email_key, holds_shared_number")
    .eq("account_id", accountId).in("phone_key", phoneKeysOf(e164))
    .order("created_at", { ascending: true }).order("id", { ascending: true })
    .limit(CONTACTS_ON_NUMBER_LIMIT + 1);
  if (error) throw new Error(`listContactsOnNumber failed: ${error.message}`);
  const all = (data ?? []) as NumberContactRow[];
  return { rows: all.slice(0, CONTACTS_ON_NUMBER_LIMIT), truncated: all.length > CONTACTS_ON_NUMBER_LIMIT };
}

/** The soonest booked, future booking of ONE contact on this account (spec S17), or null. Throws on error. */
export async function findUpcomingBookingForContact(
  db: SupabaseClient, accountId: string, contactId: string, nowIso: string,
): Promise<{ bookingId: string; startsAt: string } | null> {
  const { data, error } = await db.from("bookings")
    .select("id, starts_at").eq("account_id", accountId).eq("contact_id", contactId)
    .eq("status", "booked").gt("starts_at", nowIso)
    .order("starts_at", { ascending: true }).limit(1);
  if (error) throw new Error(`findUpcomingBookingForContact failed: ${error.message}`);
  const row = (data ?? [])[0] as { id: string; starts_at: string } | undefined;
  return row ? { bookingId: row.id, startsAt: row.starts_at } : null;
}

/**
 * Thrown when the number's holding record can be neither found nor made: a 23505 on
 * contacts_one_holding_per_number followed by a read that finds no row (it was deleted in between). A retry
 * recovers, so the inbound route treats it as FilingFailed (503, Telnyx retries; plan P23); the text-back sends
 * nothing. Its message names no number.
 */
export class HoldingContactUnavailable extends Error {
  constructor(accountId: string) {
    super(`the shared number's holding record could not be read or made (account ${accountId})`);
    this.name = "HoldingContactUnavailable";
  }
}

/**
 * The ONE holding record of this account and number (0098, spec 5.12.2), made when there is none. Never through
 * createContact, whose phone match would return a household member. service_role only (0098's trigger stores
 * false for a signed-in insert). Keyed by the exact E.164 (0098's index and CHECK, plan P23). Two calls at once:
 * the loser's insert is 23505, and it reads again, once. No contact_created act is recorded (spec 5.12.1).
 * Throws on any other error; every caller has a net.
 */
export async function ensureHoldingContact(
  db: SupabaseClient, accountId: string, e164: string,
): Promise<{ id: string; created: boolean }> {
  const find = async (): Promise<string | null> => {
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("phone", e164).eq("holds_shared_number", true).maybeSingle();
    if (error) throw new Error(`ensureHoldingContact read failed: ${error.message}`);
    return (data as { id: string } | null)?.id ?? null;
  };
  const existing = await find();
  if (existing) return { id: existing, created: false };
  const { data, error } = await db.from("contacts").insert({
    account_id: accountId, first_name: "Caller", ...phoneFields(e164), source: "voice",
    holds_shared_number: true, author_kind: "ai", author_id: null,
  }).select("id").single();
  if (error?.code === "23505") {
    const again = await find();
    if (again) return { id: again, created: false };
    throw new HoldingContactUnavailable(accountId);
  }
  if (error || !data) throw new Error(`ensureHoldingContact failed: ${error?.message ?? "no row"}`);
  const id = (data as { id: string }).id;
  try {
    await emit(db, accountId, "contact.created", "voice", { contactId: id, holding: true }, "ai");
  } catch (e) {
    console.error(`ensureHoldingContact: holding record ${id} written, but its contact.created emit failed: ${String(e)}`);
  }
  return { id, created: true };
}

export type HoldingMove =
  | { status: "ok"; moveId: number; messageIds: string[]; callIds: string[] }
  | { status: "invalid" | "not_found" | "empty" };

/**
 * 0098's move_holding_thread through PostgREST, on the SERVICE client (the caller has checked the role, spec
 * 5.12.5). A move names no event; its Undo names the move's own `moveId` and nothing else (plan P1): the
 * function moves back only the ids that move recorded. Throws on a transport error or an answer the function
 * never gives. A move that finds nothing left to move is `empty` (plan P32), never an `ok` with no ids.
 */
export async function moveHoldingThread(
  db: SupabaseClient, accountId: string,
  input: { from: string; to: string; actor: string; undoOf?: number },
): Promise<HoldingMove> {
  const { data, error } = await db.rpc("move_holding_thread", {
    p_account_id: accountId, p_from_conversation: input.from, p_to_conversation: input.to, p_actor: input.actor,
    p_undo_of: input.undoOf ?? null,
  });
  if (error) throw new Error(`moveHoldingThread failed: ${error.message}`);
  const r = (data ?? null) as { status?: unknown; moveId?: unknown; messageIds?: unknown; callIds?: unknown } | null;
  if (r?.status === "ok" && typeof r.moveId === "number") {
    return {
      status: "ok", moveId: r.moveId,
      messageIds: Array.isArray(r.messageIds) ? r.messageIds.map(String) : [],
      callIds: Array.isArray(r.callIds) ? r.callIds.map(String) : [],
    };
  }
  if (r?.status === "invalid" || r?.status === "not_found" || r?.status === "empty") return { status: r.status };
  throw new Error("moveHoldingThread: unexpected answer");
}
```

`packages/db/src/index.ts`: one new line after `:25`, `export { emailKey } from "./contacts";` (spec O1). Everything above is reached by `export * from "./voice"` (`:143`).

### `@bis/db` (Task 4) — `contacts.ts`, `contact-import.ts`, `messaging.ts`

```ts
// contacts.ts, CreateContactInput (:33-42) gains, after `author`:
  /** S-47e (E7, spec 5.10.1; plan P29): "email_only" dedupes on the email alone: a phone match never makes this
   *  write land on an existing contact (no phone winner, no legacy-key read, no country twin). The direct phone
   *  read still runs, and its first match is filed for the merge queue with the new contact (reason
   *  phone_shared_new_person), so a nickname made into a second person ("Beto" beside "Roberto") is found later.
   *  Sofía passes it when a name on a shared number makes a new person. Read only by createContact (as
   *  assignedTo and author are); toRow never sees it. Absent = today's dedupe. */
  matchBy?: "email_only";

// findDuplicate (:261-263) gains a fifth parameter. The email block (:266-272) is unchanged. In the phone block
// (:274-351), the direct read (:276-277) still runs and both of its reads gain the holding skip; with
// emailOnly, the legacy-key fallback (:323-350) is skipped:
async function findDuplicate(
  db: SupabaseClient, accountId: string, email?: string, phone?: string,
  opts: { emailOnly?: boolean } = {},
): Promise<DuplicateMatch> {
// :276-277 becomes:
    const { data, error } = await db.from("contacts").select("id")
      .eq("account_id", accountId).eq("holds_shared_number", false).eq("phone_key", pKey).limit(1);
// :325 and :328 each gain `!opts.emailOnly &&` as their first condition:
    if (!opts.emailOnly && !result.phoneMatch && /^52\d{10}$/.test(pKey)) {
    } else if (!opts.emailOnly && !result.phoneMatch && /^\d{10}$/.test(pKey) && phone === `+1${pKey}`) {
// :342-343 becomes:
      const { data: bare, error: bareErr } = await db.from("contacts").select("id, phone")
        .eq("account_id", accountId).eq("holds_shared_number", false).in("phone_key", legacyKeys).limit(10);

// createContact (:439-440):
  const emailOnly = input.matchBy === "email_only";
  const match = await findDuplicate(db, accountId, email || undefined, phone, { emailOnly });
  const winner = emailOnly ? match.emailMatch : (match.emailMatch ?? match.phoneMatch);
// Its `conflict` flag (:445-464) is unchanged: an email match AND a different phone match is still filed.
// After the insert's emit (:489-490), before the country-twin flag:
  if (emailOnly && match.phoneMatch !== null) {
    await flagDuplicatePair(flagDb, accountId, data.id, match.phoneMatch, "phone_shared_new_person");
  }
// The final return (:493) becomes `flagged: twinFlagged || (emailOnly && match.phoneMatch !== null)`.

// flagDuplicatesAfterWrite, the PHONE branch only (:413-414): .eq("holds_shared_number", false) after .eq("account_id", accountId)
// flagMatchesOf (:512-513): .eq("holds_shared_number", false) after .eq("account_id", accountId)
// listContacts (:891) and countContacts (:994-995): .eq("holds_shared_number", false) after .eq("account_id", accountId)
// COLS (:69-70): ", holds_shared_number" appended at the END of the one string literal (never a `+`; the
//   literal's own comment, :55-61, says why)

// contact-import.ts, buildMatchIndex (:41): select "id, email, phone, holds_shared_number", and the loop's first
// line becomes `if (row.holds_shared_number) continue;` so an imported row never matches (or updates) it.

// messaging.ts, ConversationSummary (:46-56) gains:
  /** S-47e (E8, spec 5.12.4): this thread belongs to a shared number's holding record (0098). */
  holdsSharedNumber: boolean;
  /** The holding record's phone, for the "Shared number {number}" label; null on every other thread (plan P9). */
  sharedNumber: string | null;
// The three embeds (listConversations :644 both forms, getConversationSummary :767, searchConversations :913)
// gain ", phone, holds_shared_number" inside contacts(…), and each of the three mappers sets:
//   holdsSharedNumber: r.contacts?.holds_shared_number === true,
//   sharedNumber: r.contacts?.holds_shared_number === true ? (r.contacts?.phone ?? null) : null,

/** S-47e (spec 5.12.4): the one conversation of this contact, or null (one per contact, 0005). Throws on error. */
export async function findConversationForContact(
  db: SupabaseClient, accountId: string, contactId: string,
): Promise<string | null> {
  const { data, error } = await db.from("conversations").select("id")
    .eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (error) throw new Error(`findConversationForContact failed: ${error.message}`);
  return (data as { id: string } | null)?.id ?? null;
}
```
`packages/db/src/index.ts`'s messaging export block (`:51-58`) gains `findConversationForContact` (Task 4 owns that one token; Task 3 owns `:25`'s new line; Task 10 owns one name at `:119`; they are different lines).

### The identity module (Task 5) — `…/identity/` (pure; relative imports, plus `@bis/db` values `emailKey` and `listContactsOnNumber` only)

`call-state.ts` (`:11`, `:12`, `:64-113`):
```ts
export type CapturedLead = {
  fields: Record<string, string>;
  /** S-47e (plan P27): the caller's answer to "for you or for someone else?"; absent when not asked or not answered. */
  forSomeoneElse?: boolean;
};
export type TakenMessage = {
  body: string; callbackNumber?: string; at: string;
  /** S-47e (spec 5.10.5): the first and last name the caller gave when take_message asked for it. */
  name?: string;
  /** S-47e: asked, and they would not say. The message then stays on the call, in no customer's thread. */
  nameDeclined?: boolean;
};

/** S-47e (spec 5.4.1): who this call has confirmed. Ids and counters only: never a name, email or number. */
export type IdentityConfirmed = { contactId: string; rung: 1 | 2; by: "caller_id" | "name" | "name_email" };
export type IdentityState = {
  confirmed: IdentityConfirmed | null;
  /** Tries that confirmed nobody (spec S5). The second locks. */
  misses: number;
  locked: null | "misses" | "cannot";
  /** take_message has asked for a name once on this call (plan P6); the next call records the message. */
  messageNameAsked: boolean;
  /** capture_lead has asked "for you or for someone else?" once on this call (plan P27); the next call records the lead. */
  leadWhoseAsked: boolean;
};
// CallState gains, after `callerItemIds`:
  /** S-47e: the per-call identity (spec 5.4.1). Lives here because ToolContext is fixed per call (SD3). */
  identity: IdentityState;
// emptyCallState() gains: identity: { confirmed: null, misses: 0, locked: null, messageNameAsked: false, leadWhoseAsked: false },
```

`ladder.ts`:
```ts
// S-47e (spec 5.1): the identity ladder. Decision 28: fixed in code, no account setting. The ONLY place a rung
// or a requirement is written. Pure.
import type { TradeModuleId } from "../modules";

export type Rung = 0 | 1 | 2 | 3;
export type IdentityAction = "read_existing" | "change_existing" | "book_new" | "leave_message";
type Requirements = Readonly<Record<IdentityAction, Rung>>;

/** Rung 3 (a one-time code) is declared and unbuilt: no action requires it (spec E1). */
export const NO_PACK: Requirements = { read_existing: 1, change_existing: 1, book_new: 0, leave_message: 0 };
export const PACK_REQUIREMENTS: Readonly<Record<TradeModuleId, Requirements>> = {
  // Equal to the no-pack row today (SD11), declared so a later change to the base row cannot move it silently.
  events: { read_existing: 1, change_existing: 1, book_new: 0, leave_message: 0 },
  insurance_pc: { read_existing: 2, change_existing: 2, book_new: 0, leave_message: 0 },
};

/** An id this build does not know reads as no pack (modules/index.ts:53-58's rule). */
export function requiredRung(action: IdentityAction, tradeModule: TradeModuleId | null | undefined): Rung {
  const row = tradeModule != null && Object.hasOwn(PACK_REQUIREMENTS, tradeModule)
    ? PACK_REQUIREMENTS[tradeModule]
    : NO_PACK;
  return row[action];
}
```

`match.ts`:
```ts
// S-47e (spec 5.3; plan P26, P28): the name and email rules and the decision. The code compares; the model is
// told only the outcome (spec E2). Never fuzzy. Pure.
import { emailKey } from "@bis/db";
import { isValidEmail } from "../../forms/guards";

export type Candidate = { id: string; words: readonly string[]; emailKey: string | null };
export type Decision =
  | { kind: "none" }
  | { kind: "confirmed"; contactId: string; rung: 1 | 2; by: "caller_id" | "name" | "name_email" }
  | { kind: "ask_name" } | { kind: "ask_email" } | { kind: "miss" } | { kind: "cannot_on_this_call" };

const PARTICLES: ReadonlySet<string> = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "di", "van", "von"]);

/** NFKD with combining marks removed, lowercased, apostrophes removed, every other non-letter a space. */
export function nameWords(text: string | null | undefined): string[] {
  return String(text ?? "")
    .normalize("NFKD").replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}]+/gu, " ")
    .trim().split(" ").filter((w) => w.length > 0);
}

/** Every word of `a` appears in `b`, in the same order (words of `b` may be skipped). */
function inOrder(a: readonly string[], b: readonly string[]): boolean {
  let i = 0;
  for (const w of b) {
    if (w === a[i]) i += 1;
    if (i === a.length) return true;
  }
  return a.length === 0;
}

/**
 * How a spoken name relates to one record's (plan P26, the orchestrator's ruling on R2):
 * - "exact": the same words, in the same order;
 * - "partial": the first words are equal, and EITHER every spoken word is on record in order and the spoken
 *   name does not end on a particle (spec 5.3 rules 3 and 4: "María García" for "María Elena García López"), OR
 *   every word of the record's name was spoken, in order ("María García López" for "María García");
 * - null otherwise. Both names need two words or more (rule 1): a first name alone, or a "Caller" placeholder,
 *   is never confirmed by name.
 */
export function nameMatch(spoken: readonly string[], record: readonly string[]): "exact" | "partial" | null {
  if (spoken.length < 2 || record.length < 2) return null;
  if (spoken[0] !== record[0]) return null;
  if (spoken.length === record.length && spoken.every((w, i) => w === record[i])) return "exact";
  const shorter = !PARTICLES.has(spoken[spoken.length - 1]!) && inOrder(spoken, record);
  return shorter || inOrder(record, spoken) ? "partial" : null;
}

export function nameMatches(spoken: readonly string[], record: readonly string[]): boolean {
  return nameMatch(spoken, record) !== null;
}

/** The candidates a spoken name names: the exact matches when there are any, else the partial ones. */
export function nameHits<T extends Candidate>(spoken: readonly string[], candidates: readonly T[]): T[] {
  const exact = candidates.filter((c) => nameMatch(spoken, c.words) === "exact");
  return exact.length > 0 ? exact : candidates.filter((c) => nameMatch(spoken, c.words) === "partial");
}

/** Whole words only, and only in an address said with no "@" (plan P28). */
const EMAIL_WORDS: Readonly<Record<string, string>> = {
  at: "@", arroba: "@", dot: ".", punto: ".", underscore: "_", dash: "-", hyphen: "-", guion: "-", raya: "-",
  plus: "+", mas: "+",
};
/** Two-word forms, read before the one-word ones ("guion bajo" before "guion"). */
const EMAIL_PAIRS: Readonly<Record<string, string>> = { "guion bajo": "_", "guion medio": "-" };

/** The spoken address as an email, or null when it does not have an email's shape (spec S3). */
export function spokenEmail(text: string | null | undefined): string | null {
  const s = String(text ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  let out: string;
  if (s.includes("@")) {
    out = s.replace(/\s+/g, "");
  } else {
    const words = s.trim().split(/\s+/).filter((w) => w.length > 0);
    const parts: string[] = [];
    for (let i = 0; i < words.length; i += 1) {
      const pair = `${words[i]} ${words[i + 1] ?? ""}`;
      if (Object.hasOwn(EMAIL_PAIRS, pair)) { parts.push(EMAIL_PAIRS[pair]!); i += 1; continue; }
      const w = words[i]!;
      parts.push(Object.hasOwn(EMAIL_WORDS, w) ? EMAIL_WORDS[w]! : w);
    }
    out = parts.join("");
  }
  return isValidEmail(out) ? out : null;
}

/** The repo's one "same mailbox" key (packages/db's emailKey, the twin of 0034's email_key) of a spoken address. */
export function spokenEmailKey(text: string | null | undefined): string | null {
  const e = spokenEmail(text);
  return e === null ? null : emailKey(e);
}

export function candidateOf(row: { id: string; first_name: string | null; last_name: string | null; email_key: string | null }): Candidate {
  return { id: row.id, words: nameWords(`${row.first_name ?? ""} ${row.last_name ?? ""}`), emailKey: row.email_key };
}

/**
 * Spec 5.3's table, top to bottom, as amended (plan P25, P26). `fullName` absent is find_my_booking's case: the
 * sole-candidate row confirms by caller ID ONLY when no name was given, so a name given to confirm_identity on a
 * one-contact number must match it.
 */
export function decideIdentity(input: {
  candidates: readonly Candidate[]; truncated: boolean; required: 1 | 2;
  fullName?: string | null; email?: string | null;
}): Decision {
  const { candidates, truncated, required } = input;
  if (candidates.length === 0 && !truncated) return { kind: "none" };
  if (truncated) return { kind: "cannot_on_this_call" };
  const spoken = nameWords(input.fullName);
  if (required === 1 && candidates.length === 1 && spoken.length === 0) {
    return { kind: "confirmed", contactId: candidates[0]!.id, rung: 1, by: "caller_id" };
  }
  if (required === 2 && !candidates.some((c) => c.emailKey !== null)) return { kind: "cannot_on_this_call" };
  if (spoken.length < 2) return { kind: "ask_name" };
  const key = input.email == null ? null : spokenEmailKey(input.email);
  if (required === 2 && key === null) return { kind: "ask_email" };
  const byName = nameHits(spoken, candidates);
  if (required === 1) {
    if (byName.length === 1) return { kind: "confirmed", contactId: byName[0]!.id, rung: 1, by: "name" };
    if (byName.length > 1) {
      if (key === null) return byName.some((c) => c.emailKey !== null) ? { kind: "ask_email" } : { kind: "miss" };
      const picked = byName.filter((c) => c.emailKey === key);
      return picked.length === 1
        ? { kind: "confirmed", contactId: picked[0]!.id, rung: 2, by: "name_email" }
        : { kind: "miss" };
    }
    return { kind: "miss" };
  }
  const both = byName.filter((c) => c.emailKey !== null && c.emailKey === key);
  return both.length === 1 ? { kind: "confirmed", contactId: both[0]!.id, rung: 2, by: "name_email" } : { kind: "miss" };
}
```

`state.ts`:
```ts
// S-47e (spec 5.4.1): the per-call identity helpers. Pure. Only ids and counters.
import type { CallState, IdentityConfirmed } from "../call-state";
import type { Rung } from "./ladder";

export const MAX_MISSES = 2;

export function withConfirmed(state: CallState, c: IdentityConfirmed): CallState {
  return { ...state, identity: { ...state.identity, confirmed: { contactId: c.contactId, rung: c.rung, by: c.by } } };
}
/** One try that confirmed nobody; the second locks ("misses"). */
export function withMiss(state: CallState): CallState {
  const misses = state.identity.misses + 1;
  return { ...state, identity: { ...state.identity, misses, locked: state.identity.locked ?? (misses >= MAX_MISSES ? "misses" : null) } };
}
/** The first lock wins; a call never changes why it was locked. */
export function withLocked(state: CallState, why: "misses" | "cannot"): CallState {
  return state.identity.locked ? state : { ...state, identity: { ...state.identity, locked: why } };
}
export function withMessageNameAsked(state: CallState): CallState {
  return state.identity.messageNameAsked ? state : { ...state, identity: { ...state.identity, messageNameAsked: true } };
}
export function withLeadWhoseAsked(state: CallState): CallState {
  return state.identity.leadWhoseAsked ? state : { ...state, identity: { ...state.identity, leadWhoseAsked: true } };
}
export function isLocked(state: CallState): boolean {
  return state.identity.locked !== null;
}
/** The confirmation is this contact's, at the rung asked or above. No action asks rung 0 of an existing
 *  appointment, so 0 reads as 1 (the stricter); rung 3 is unreachable, so it is never met. */
export function confirmedFor(state: CallState, contactId: string, required: Rung): boolean {
  const r = required === 0 ? 1 : required;
  const c = state.identity.confirmed;
  return c !== null && r <= 2 && c.contactId === contactId && c.rung >= r;
}
```

`results.ts` (spec 5.4.4 word for word; S14: model input, not catalogue copy):
```ts
// S-47e (spec 5.4.4, S14): what Sofía is told. Model input, not catalogue copy: English instructions with the
// sentences she says quoted in English and Spanish (usted). Pinned word for word by results.test.ts. No result
// carries a candidate's name, email or number (spec E2).
export type ToolResult = Readonly<Record<string, unknown>>;

export const ASK_NAME: ToolResult = {
  found: false, confirmIdentity: "name",
  next: `Before you look anything up, ask whose name the appointment is under: the first and last name. For example: "Whose name is the appointment under? I'll need the first and last name." In Spanish: "¿A nombre de quién está la cita? Necesito el nombre y el apellido." Then call confirm_identity with fullName. Do not suggest or guess a name, and do not say how many people use this number.`,
};
export const ASK_NAME_AND_EMAIL: ToolResult = {
  found: false, confirmIdentity: "name_and_email",
  next: `Before you look anything up, ask for the full name the appointment is under and the email address on file. For example: "To look that up, I need the full name and the email address we have on file." In Spanish: "Para buscarla, necesito el nombre completo y el correo electrónico que tenemos registrado." Spell the email back character by character, saying 'at' for @ and 'dot' for the period, and wait for them to confirm. Then call confirm_identity with fullName and email. Do not suggest or guess a name or an email.`,
};
export const ASK_NAME_AGAIN: ToolResult = {
  ok: false, confirmed: false, next: "Ask for their first AND last name, then call confirm_identity again.",
};
export const ASK_EMAIL: ToolResult = {
  ok: false, confirmed: false, confirmIdentity: "email",
  next: `Ask for the email address on file: "Could I also have the email address we have on file?" In Spanish: "¿Me da también el correo electrónico que tenemos registrado?" Spell it back character by character and wait for them to confirm, then call confirm_identity again with fullName and email.`,
};
export const CONFIRMED: ToolResult = { ok: true, confirmed: true, next: "Confirmed. Call find_my_booking now." };
export const MISS: ToolResult = {
  ok: false, confirmed: false,
  next: `Say: "I couldn't find it under those details." In Spanish: "No la encontré con esos datos." You may ask them once more and call confirm_identity again. You have not been told which detail did not match, so do not say or guess.`,
};
export const LOCKED: ToolResult = {
  ok: false, confirmed: false, locked: true,
  next: `Say: "I'm sorry, I couldn't find it under those details, so I can't look it up on this call. I can take a message and someone from the team will call you back." In Spanish: "Lo siento, no la encontré con esos datos, así que no puedo consultarla en esta llamada. Puedo tomarle un mensaje y alguien del equipo le devolverá la llamada." If they want, take the message with take_message. Do not ask for these details again on this call.`,
};
export const CANNOT: ToolResult = {
  found: false, locked: true,
  next: `Say: "I'm sorry, I can't look that up on this call. I can take a message and someone from the team will call you back." In Spanish: "Lo siento, no puedo consultarla en esta llamada. Puedo tomarle un mensaje y alguien del equipo le devolverá la llamada." If they want, take the message with take_message.`,
};
export const NOT_CONFIRMED_YET: ToolResult = {
  ok: false,
  error: "This appointment can't be changed until find_my_booking has found it for them on this call. Call find_my_booking first. Do not share any of its details.",
};
/** take_message on a shared number with no name (spec 5.10.5). */
export const MESSAGE_ASK_NAME: ToolResult = {
  ok: false,
  error: "Before you take the message, ask for their first and last name, then call take_message again with name. If they would rather not say, call it again with nameDeclined: true.",
};
/** book_appointment's two refusals (spec 5.10.1). */
export const BOOK_ASK_NAME: ToolResult = {
  ok: false, error: "Before you book, ask for their first AND last name, then call book_appointment again with it.",
};
export const BOOK_AMBIGUOUS: ToolResult = {
  ok: false,
  error: "This appointment can't be booked under that name on this call. First call capture_lead with their name and what they needed, then take_message, so the team can book it.",
};
/** book_appointment on a number with ONE contact whose name the caller's does not match (plan P27). */
export const BOOK_ASK_WHOSE: ToolResult = {
  ok: false,
  error: `Not booked yet. Ask: "Is this appointment for you or for someone else?" In Spanish: "¿La cita es para usted o para otra persona?" Then call book_appointment again with forSomeoneElse: false if it is for them, or true if it is for someone else.`,
};
/** capture_lead, the same question, asked once (plan P27). */
export const LEAD_ASK_WHOSE: ToolResult = {
  ok: false,
  error: `Not recorded yet. Ask: "Is this for you or for someone else?" In Spanish: "¿Es para usted o para otra persona?" Then call capture_lead again with forSomeoneElse: false if it is for them, or true if it is for someone else.`,
};
/** Added to find_my_booking's found result when the confirmation came from a name (plan P25). */
export const FOUND_BY_NAME_NEXT =
  "This is the appointment of the person they confirmed. If the caller asks about a different person's appointment than the one already confirmed, call confirm_identity with that person's first and last name before you call find_my_booking again.";

/** After a "cannot" lock every later refusal says CANNOT, so she never says "those details" to someone who gave none. */
export function lockedResult(why: "misses" | "cannot"): ToolResult {
  return why === "cannot" ? CANNOT : LOCKED;
}
/** `next` is registry.ts's nextStep(ctx): a transfer where one is set up, else a message. */
export function readFailed(next: string): ToolResult {
  return { ok: false, confirmed: false, error: `The details couldn't be checked right now, so nothing was looked up. Apologize, then ${next} so the team can help.` };
}
export function notTheirs(next: string): ToolResult {
  return { ok: false, error: `This appointment isn't one they have confirmed is theirs, so it can't be changed on this call. Do not share any of its details. Apologize, then ${next} so the team can confirm who they are and help.` };
}
/** confirm_identity with no caller ID: find_my_booking's own refusal sentence (a name never raises rung 0). */
export function noCallerId(next: string): ToolResult {
  return { ok: false, confirmed: false, error: `This call has no visible caller number, so appointments can't be looked up on it — not by a number the caller says, either. Apologize, then ${next} so the team can help them.` };
}
```

`candidates.ts`:
```ts
// S-47e (spec 5.2, S1): who is really on a number: listContactsOnNumber's rows, holding records out, filtered by
// the rule the ownership check has always used (isCallerIdNumber). One indexed read per call of readCandidates.
import { listContactsOnNumber, type NumberContactRow } from "@bis/db";
import type { serviceDb } from "@bis/db";
import { isCallerIdNumber } from "../phone-number";
import { candidateOf, type Candidate } from "./match";

type VoiceDb = ReturnType<typeof serviceDb>;
export type CandidateList = { candidates: Candidate[]; truncated: boolean };

export function realCandidates(rows: readonly NumberContactRow[], e164: string): Candidate[] {
  return rows.filter((r) => !r.holds_shared_number && isCallerIdNumber(r.phone, e164)).map(candidateOf);
}
/** Two or more real contacts, or more than the limit (spec S20). */
export function isShared(list: { candidates: readonly Candidate[]; truncated: boolean }): boolean {
  return list.truncated || list.candidates.length >= 2;
}
/** Throws on a read error. */
export async function readCandidates(db: VoiceDb, accountId: string, e164: string): Promise<CandidateList> {
  const { rows, truncated } = await listContactsOnNumber(db, accountId, e164);
  return { candidates: realCandidates(rows, e164), truncated };
}
```

`flow.ts` (plan P10):
```ts
// S-47e (spec 5.4.2, 5.10.5; plan P10): the identity steps of find_my_booking, confirm_identity, the move/cancel
// ownership check and take_message's name ask. Every read is the caller's; this decides. Pure: registry.ts and
// the corpus stub (modules/corpus-lib.ts) run exactly this, so a corpus run cannot pass the ladder vacuously (O2).
import type { CallState } from "../call-state";
import { isCallerIdNumber } from "../phone-number";
import type { Rung } from "./ladder";
import { decideIdentity, type Candidate, type Decision } from "./match";
import { withConfirmed, withMiss, withLocked, withMessageNameAsked, isLocked, confirmedFor } from "./state";
import {
  ASK_NAME, ASK_NAME_AND_EMAIL, ASK_NAME_AGAIN, ASK_EMAIL, CONFIRMED, MISS, LOCKED, CANNOT, NOT_CONFIRMED_YET,
  MESSAGE_ASK_NAME, lockedResult, readFailed, notTheirs, type ToolResult,
} from "./results";

export type CandidateRead = { ok: true; candidates: readonly Candidate[]; truncated: boolean } | { ok: false };
/** `event` is the spec 5.9 log line's tail, or null when nothing worth a line happened. */
export type Step = { state: CallState; result: ToolResult; event: string | null };
export type FindStep = ({ kind: "answer" } & Step)
  | { kind: "lookup"; state: CallState; contactId: string; by: "caller_id" | "name" | "name_email"; event: string | null };

/** No action requires rung 0 or rung 3 for an existing appointment (ladder.ts); 0 reads as 1, the stricter. */
function need(required: Rung): 1 | 2 | 3 {
  return required >= 3 ? 3 : required === 2 ? 2 : 1;
}
function confirmedEvent(d: Extract<Decision, { kind: "confirmed" }>): string {
  return `confirmed rung ${d.rung} by ${d.by === "caller_id" ? "caller-id" : d.by === "name" ? "name" : "name-email"}`;
}

export function findNeedsRead(state: CallState, required: Rung): boolean {
  if (isLocked(state) || need(required) === 3) return false;
  const c = state.identity.confirmed;
  return !(c !== null && c.rung >= need(required));
}

/** find_my_booking after its two caller-ID refusals (registry.ts keeps those). `read` is null when
 *  findNeedsRead said no read was needed. */
export function findStep(state: CallState, required: Rung, read: CandidateRead | null, next: string): FindStep {
  if (isLocked(state)) return { kind: "answer", state, result: lockedResult(state.identity.locked!), event: null };
  const r = need(required);
  if (r === 3) return { kind: "answer", state: withLocked(state, "cannot"), result: CANNOT, event: "locked (cannot)" };
  const c = state.identity.confirmed;
  if (c !== null && c.rung >= r) return { kind: "lookup", state, contactId: c.contactId, by: c.by, event: null };
  if (read === null || !read.ok) return { kind: "answer", state, result: readFailed(next), event: "read failed" };
  const d = decideIdentity({ candidates: read.candidates, truncated: read.truncated, required: r });
  if (d.kind === "none") return { kind: "answer", state, result: { found: false }, event: null };
  if (d.kind === "confirmed") return { kind: "lookup", state: withConfirmed(state, d), contactId: d.contactId, by: d.by, event: confirmedEvent(d) };
  if (d.kind === "cannot_on_this_call") return { kind: "answer", state: withLocked(state, "cannot"), result: CANNOT, event: "locked (cannot)" };
  return { kind: "answer", state, result: r === 2 ? ASK_NAME_AND_EMAIL : ASK_NAME, event: null };
}

/** confirm_identity after its caller-ID refusal and its locked check (registry.ts makes no read when locked). */
export function confirmStep(
  state: CallState, required: Rung, read: CandidateRead, args: { fullName?: unknown; email?: unknown }, next: string,
): Step {
  if (isLocked(state)) return { state, result: lockedResult(state.identity.locked!), event: null };
  const r = need(required);
  if (r === 3) return { state: withLocked(state, "cannot"), result: CANNOT, event: "locked (cannot)" };
  if (!read.ok) return { state, result: readFailed(next), event: "read failed" };
  const d = decideIdentity({
    candidates: read.candidates, truncated: read.truncated, required: r,
    fullName: typeof args.fullName === "string" ? args.fullName : "",
    email: typeof args.email === "string" ? args.email : null,
  });
  switch (d.kind) {
    case "confirmed": return { state: withConfirmed(state, d), result: CONFIRMED, event: confirmedEvent(d) };
    case "ask_name": return { state, result: ASK_NAME_AGAIN, event: null };
    case "ask_email": return { state, result: ASK_EMAIL, event: null };
    case "cannot_on_this_call": return { state: withLocked(state, "cannot"), result: CANNOT, event: "locked (cannot)" };
    default: {
      // "none" (nobody on the number) and "miss": a well-shaped try that confirmed nobody (spec S5).
      const after = withMiss(state);
      return isLocked(after)
        ? { state: after, result: LOCKED, event: "locked (misses)" }
        : { state: after, result: MISS, event: `miss ${after.identity.misses}` };
    }
  }
}

/** reschedule_appointment / cancel_appointment, after registry.ts's one contact read (spec 5.4.2; plan P7). */
export function ownsStep(
  state: CallState, required: Rung,
  b: { bookingId: string; contactId: string; contactPhone: string | null | undefined; callerNumber: string | null },
  next: string,
): { owned: true } | { owned: false; result: ToolResult } {
  if (state.bookings.some((x) => x.id === b.bookingId)) return { owned: true };          // rung 0: made on this call
  if (isLocked(state)) return { owned: false, result: lockedResult(state.identity.locked!) };
  if (confirmedFor(state, b.contactId, required) && isCallerIdNumber(b.contactPhone, b.callerNumber)) {
    return { owned: true };
  }
  const c = state.identity.confirmed;
  if (c === null || c.contactId === b.contactId) return { owned: false, result: NOT_CONFIRMED_YET };
  return { owned: false, result: notTheirs(next) };
}

/** The name the caller gave take_message, whitespace collapsed; null when none. */
export function messageName(args: { name?: unknown }): string | null {
  const n = typeof args.name === "string" ? args.name.replace(/\s+/g, " ").trim() : "";
  return n.length > 0 ? n : null;
}
/** Whether take_message must read the number before recording (spec 5.10.5; plan P6: asks once per call). */
export function messageNeedsNameCheck(
  state: CallState, callerNumber: string | null, args: { name?: unknown; nameDeclined?: unknown },
): boolean {
  return callerNumber !== null && state.identity.confirmed === null && !state.identity.messageNameAsked
    && messageName(args) === null && args.nameDeclined !== true;
}
/** The refusal on a shared number, or null to record the message (a failed read records it: a message is
 *  never lost on our outage, spec 5.10.5). */
export function messageNameStep(state: CallState, read: CandidateRead): Step | null {
  if (!read.ok) return null;
  if (!read.truncated && read.candidates.length < 2) return null;
  return { state: withMessageNameAsked(state), result: MESSAGE_ASK_NAME, event: null };
}
```

### The record picker (Task 7) — `…/identity/record.ts`

```ts
// S-47e (E7, spec 5.10.0, S19-S21; plan P26, P27): which contact a voice write lands on, on the number it would
// store. The SAME name and email rules as the confirm (match.ts). Never fuzzy; never a contact the caller did not
// name, confirm or say was them. Pure.
import type { CallState } from "../call-state";
import { nameWords, nameMatch, nameHits, spokenEmailKey, type Candidate } from "./match";
import { withLeadWhoseAsked } from "./state";
import { LEAD_ASK_WHOSE, type ToolResult } from "./results";

export type RecordPick =
  | { kind: "today" } | { kind: "existing"; contactId: string } | { kind: "create" }
  | { kind: "ask_name" } | { kind: "ask_whose" } | { kind: "ambiguous" };

/** A "Caller" placeholder, or a record with no name at all: today's path fills its blanks (decision 19). */
function isPlaceholder(words: readonly string[]): boolean {
  return words.length === 0 || (words.length === 1 && words[0] === "caller");
}

/** A name agrees with the ONE contact on a number when P26's rule matches, or when either side is a first name
 *  alone and the first words are equal ("Ana" for "Ana Prueba", "Dan Lopez" for a record of "Dan"). */
function agreesWithSole(spoken: readonly string[], words: readonly string[]): boolean {
  if (spoken.length === 0 || spoken[0] !== words[0]) return false;
  return spoken.length === 1 || words.length === 1 || nameMatch(spoken, words) !== null;
}

export function pickRecordOnNumber(input: {
  /** realCandidates of the number being stored (holding records already out). */
  onNumber: readonly Candidate[];
  truncated: boolean;
  name: string | null | undefined;
  email: string | null | undefined;
  /** state.identity.confirmed?.contactId, ONLY when the number being stored is the caller ID; else null. */
  confirmedId: string | null;
  /** The caller's own answer to "Is this for you or for someone else?" (plan P27); undefined when not asked. */
  forSomeoneElse?: boolean;
}): RecordPick {
  const { onNumber, truncated } = input;
  const spoken = nameWords(input.name);
  if (!truncated && onNumber.length === 0) return { kind: "today" };
  if (!truncated && onNumber.length === 1) {
    const sole = onNumber[0]!;
    if (input.forSomeoneElse === true) return { kind: "create" };
    if (input.forSomeoneElse === false) return { kind: "existing", contactId: sole.id };
    if (isPlaceholder(sole.words) || spoken.length === 0 || agreesWithSole(spoken, sole.words)) return { kind: "today" };
    return { kind: "ask_whose" };
  }
  if (truncated) return { kind: "ambiguous" };
  const c = input.confirmedId === null ? undefined : onNumber.find((x) => x.id === input.confirmedId);
  if (c && (input.forSomeoneElse === false || spoken.length === 0 || nameMatch(spoken, c.words) !== null
    || (spoken.length === 1 && spoken[0] === c.words[0]))) {
    return { kind: "existing", contactId: c.id };
  }
  if (spoken.length < 2) return { kind: "ask_name" };
  const byName = nameHits(spoken, onNumber);
  if (byName.length === 1) return { kind: "existing", contactId: byName[0]!.id };
  if (byName.length > 1) {
    const key = input.email == null ? null : spokenEmailKey(input.email);
    const picked = key === null ? [] : byName.filter((x) => x.emailKey === key);
    return picked.length === 1 ? { kind: "existing", contactId: picked[0]!.id } : { kind: "ambiguous" };
  }
  return { kind: "create" };
}

/** capture_lead asks "for you or for someone else?" once per call, and only when the lead has a name and a number
 *  and the caller has not already answered (plan P27). */
export function leadNeedsWhoseCheck(state: CallState, fullName: string | undefined, forSomeoneElse: boolean | undefined): boolean {
  return !state.identity.leadWhoseAsked && forSomeoneElse === undefined && nameWords(fullName).length > 0;
}

/** The ask, or null to record the lead (a failed read records it: a lead is never lost on our outage). */
export function leadWhoseStep(
  state: CallState, read: { ok: true; candidates: readonly Candidate[]; truncated: boolean } | { ok: false }, fullName: string | undefined,
): { state: CallState; result: ToolResult } | null {
  if (!read.ok) return null;
  const pick = pickRecordOnNumber({ onNumber: read.candidates, truncated: read.truncated, name: fullName, email: null, confirmedId: null });
  return pick.kind === "ask_whose" ? { state: withLeadWhoseAsked(state), result: LEAD_ASK_WHOSE } : null;
}
```

### The text-back contact (Task 8) — `textback.ts`

```ts
/** S-47e (E8, plan P16): a real contact (a string), or a shared number's holding record. */
export type ResolvedTextbackContact = string | { id: string; holding: true } | null;
// TextbackRequest.resolveContact: () => Promise<ResolvedTextbackContact>
// TextbackOutcome gains:
  /** S-47e (E8): the text lives on the shared number's holding record. finishCall then keeps the call row's
   *  contact null and records only the conversation (spec 5.10.4). False on every other path. */
  holding: boolean;
// contactForCallerId returns Promise<string | { id: string; holding: true }>
```

### The inbox Move (Task 11) — `…/convos/actions.ts`

```ts
export type HoldingMoveUndo = { moveId: number; fromConversationId: string; toConversationId: string };
export type MoveHoldingResult =
  | { ok: true; toConversationId: string; name: string; undo: HoldingMoveUndo }
  | { ok: false; error: "conversation.holding.moveRole" | "conversation.holding.moveFailed" | "conversation.holding.moveEmpty" };
export async function moveHoldingThreadAction(accountId: string, conversationId: string, toContactId: string): Promise<MoveHoldingResult>;
export async function undoMoveHoldingThreadAction(accountId: string, undo: HoldingMoveUndo):
  Promise<{ ok: true; conversationId: string } | { ok: false; error: "conversation.holding.moveRole" | "conversation.holding.moveFailed" }>;
```

### The SIP attestation (Task 13) — `apps/web/src/lib/voice/attestation-log.ts` and `sip-headers.ts`

```ts
// attestation-log.ts: moved byte for byte from app/api/voice/texml/telnyx-request.ts:63-67 and :101.
export const FIELD_NAME = /^[A-Za-z0-9_.-]{1,64}$/;
export const ATTESTATION_FIELD = /attest|shaken|stir|verstat/i;
export const SAFE_VALUE = /^[A-Za-z0-9 _.:-]{0,64}$/;
export const MAX_ATTESTATION = 10;
/** "(unprintable)" unless short and plain, "(redacted)" with seven or more digits in a run, else the value. */
export function shownValue(value: string): string {
  return !SAFE_VALUE.test(value) ? "(unprintable)" : /\d{7,}/.test(value) ? "(redacted)" : value;
}
// sip-headers.ts:
export function sipAttestation(eventData: unknown): string;   // "none" when nothing is found
```

### Copy keys (Task 2)

| Key | English | Spanish (usted) |
|---|---|---|
| `voice.todo.identity` | Someone asked about an appointment and couldn't confirm who they are | Alguien preguntó por una cita y no pudo confirmar quién es |
| `contact.holding.label` | Shared number {number} | Número compartido {number} |
| `conversation.holding.notice` | These texts came from {number}, a phone more than one customer uses, so they aren't filed under anyone yet. Move them to the right person. | Estos mensajes llegaron del {number}, un teléfono que usa más de un cliente, así que todavía no están archivados con nadie. Muévalos a la persona correcta. |
| `conversation.holding.move` | Move to… | Mover a… |
| `conversation.holding.moveOther` | Find another customer | Buscar otro cliente |
| `conversation.holding.moved` | Moved to {name}. | Se movió a {name}. |
| `conversation.holding.movedBack` | Moved back. | Se regresó. |
| `conversation.holding.moveFailed` | That conversation couldn't be moved. Try again. | No se pudo mover la conversación. Inténtelo de nuevo. |
| `conversation.holding.moveEmpty` (P32; a Task 2 follow-up, after `07f1a112`) | These texts were already moved. | Estos mensajes ya se movieron. |
| `call.holding.openTexts` | Open the texts | Abrir los mensajes |
| `conversation.holding.findLabel` (Q1) | Search customers by name or phone | Buscar clientes por nombre o teléfono |
| `conversation.holding.findNone` (Q1) | No customers match. | Ningún cliente coincide. |
| `conversation.holding.findFailed` (Q1) | Couldn't search customers. Try again. | No se pudo buscar clientes. Inténtelo de nuevo. |
| `conversation.holding.moveRole` (Q1) | Only an Owner or Staff can move these texts. | Solo un dueño o un empleado puede mover estos mensajes. |
| `todo.sharedNumber.reply` (Q2, P30) | A reply from a shared number couldn't be matched to one appointment | Una respuesta de un número compartido no se pudo asociar con una sola cita |
| `todo.sharedNumber.hold` (Q2, P19) | A text from the shared number {number} may have asked to stop texts: “{excerpt}”. Texts to that number are on hold. | Un mensaje del número compartido {number} quizá pidió dejar de recibir mensajes: “{excerpt}”. Los mensajes a ese número están en pausa. |

And the changed pair (S16), each gaining a closing sentence:
- `voice.tradeRules.insurance_pcHint`: "{persona} takes quote requests for a licensed agent to call back, and never gives prices, says anyone is covered or discusses a policy. Before reading, moving or cancelling an appointment, {persona} asks for the full name and the email on file."
- `voice.tradeRules.insurance_pcHint.es`: "{persona} toma solicitudes de cotización para que un agente con licencia devuelva la llamada, y nunca da precios, ni dice que alguien está cubierto, ni habla de una póliza. Antes de consultar, cambiar o cancelar una cita, {persona} pide el nombre completo y el correo electrónico registrado."

---

## Assumptions (each labelled, each with its check)

- **A1 — VERIFIED 2026-10-24.** No branch has taken 0098: `git log --all --oneline -- 'packages/db/supabase/migrations/0098*'` printed nothing after `git fetch origin`. Re-check in Task 0 and again before Task 18 step 1; renumber everything (file, header, md5) if one has landed.
- **A2.** bis-ci and production are both at 0097 (`one_switch`), with the digest `52|b66203ca5d355155540b520af510d120` and 22 definers. Check: Task 0's MCP reads.
- **A3 — VERIFIED 2026-10-24.** The `@bis/db` barrel loads under `tsx` with no env (Plan-writer check), so `…/identity/match.ts` may import `emailKey` as a value even though `scripts/sofia-corpus.ts` reaches it (spec §5.11). The script's own guard (`corpus-lib.test.ts:312-319`) scans the SCRIPT's source only and stays green.
- **A4 — VERIFIED by code.** PostgREST accepts `.in("phone_key", [...])` on the generated column: `contacts.ts:343` already does it.
- **A5 — ASSUMPTION, not verified (spec §5.7).** Whether Telnyx forwards a STIR/SHAKEN `Identity` header or a `verstat` parameter onto the leg it dials to OpenAI, and whether OpenAI's `sip_headers` repeats it. Task 13's line only observes; Step 8.7 records what a real call shows.
- **A6.** Production's `contacts` row count is small enough that 0098's one ACCESS EXCLUSIVE window (catalogue change, one validate scan, one partial index build) lasts milliseconds. Check: Task 0's read-only count. STOP and tell the owner if it exceeds 1,000,000.
- **A7 — VERIFIED 2026-10-24.** `apps/web/playwright.config.ts:166`/`:171`: `fullyParallel: false`, `workers: 1`; specs run one after another, so Task 16's fixture state carries into the next spec unless restored.
- **A8.** A bare `vi.mock("@bis/db", () => ({…}))` factory throws only when a missing export is CALLED (vitest resolves a named import at its use), so a factory whose module under test never reaches a new function needs no new entry. Check: every task's affected-test run, which runs each such file.
- **A9 — VERIFIED 2026-10-24.** `normalisePhone` reads every +52/+521 form of one Mexican number as `+52…` and both US forms as `+1…` (Plan-writer check), which is why `phoneKeysOf` adds the `521` key (P4).
- **A10.** The client fixture user (`e2e/.auth/client-state.json`) is the per-run fixture account's Owner (S-47d's A8; `apps/web/e2e/one-switch.spec.ts:66`), so Task 16 can Move.

---

## Global constraints (every task brief inherits these; carried from the S-47d plan, `docs/superpowers/plans/2026-10-23-one-switch-pr47d.md:736-871`, re-verified at `df8882ce` where carried over)

- **Git:**
  - Never `git stash`, `git reset`, `git restore`, `git checkout` (not even to revert a probe), `--amend` or `rm -rf` under `<WT>` (memory "No rm -rf on worktrees"). The ONE exception is Task 0's `git rebase origin/main`, which the orchestrator runs.
  - Revert a probe by hand: `cp` the original back, then `cmp` it.
  - Stage new files with `git add -- <new paths>`. Commit with `git commit -m "…" -- <every path>`, never `-A` or `.`. Check `git diff --cached --stat` before every commit.
  - Never push (the orchestrator pushes). Never touch `main`. If `.git/index.lock` exists another agent is committing: wait and retry, never delete it.
  - Commits end with the two trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
  - Shared worktree: a task whose typecheck goes red re-runs it once after any sibling commit lands (`git log --oneline -3`) before reporting red.
- **Reviewers:**
  - Probe in their OWN `git worktree add --detach <sha> <SCRATCH>/<name>-wt`, with ONE `pnpm install --frozen-lockfile --prefer-offline` per fresh worktree, never in `<WT>`.
  - Remove the worktree with `git worktree remove --force` only.
  - Leftover agents are stopped by the orchestrator.
- **Databases:**
  - **No `@bis/db` vitest runs locally against bis-ci until Task 18 step 1 has applied 0098 there.** That includes mock-only files: the package's globalSetup sweep (`packages/db/vitest.config.ts:5-8`) runs on every invocation. The same holds for the three LIVE web tests: `apps/web/src/app/f/[publicId]/actions.returning-lead.test.ts`, `[acct]/calls/[callId]/actions.test.ts` and `weekly-metrics.live.test.ts`.
  - `withRollback` db tests run on the agent's own PG18 replica. `withTestAccount`/PostgREST tests run on the agent's own replica + PostgREST (`<KIT>/pgrst.sh`), or are proven by CI `verify` (its own in-runner stack, `.github/scripts/ci-local-supabase.sh`).
  - `packages/db/.env` and `apps/web/.env.local` do not exist in `<WT>` (read 2026-10-24: `ls packages/db/.env` → "No such file"). Never create or copy either. To list e2e specs, source the main checkout's file into the SHELL only: `set -a; . /c/Users/danlo/bis-platform/apps/web/.env.local; set +a`. Never print it.
  - **0098 is applied only by the orchestrator:** bis-ci through `ci-project-setup.yml` (`push-dry-run`, then `push`); then production through MCP `apply_migration` ONCE, name `shared_number_holding`; then the md5 compare; then parity. Agents never apply a migration anywhere but their own replica.
  - **A refused statement aborts the transaction.** Every refusal probe in a `withRollback` test runs inside `savepoint probe` / `rollback to savepoint probe` (Task 1's `refusal()` helper), or the next statement fails "current transaction is aborted".
  - **RETURNING and a WHERE on `account_id` apply the read policy.** A signed-in cross-account probe is an UNQUALIFIED statement, then a re-read as the table owner (S-47d Task 1 review, P8 there). Service-role probes of `move_holding_thread` name the account explicitly (it is a function argument).
- **The replica kit** (`<KIT>`, read 2026-10-24):
  - `replica.sh <pgPort> <dir> <0098 file>`: `:6` `WT=/c/Users/danlo/bis-platform/.claude/worktrees/s47e`; `:15` the three roles; `:19` `sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql` (still the default-privileges lines at `df8882ce`, read for this plan); `:20-28` the storage stub 0077 needs; `:29-32` every migration EXCEPT `*0098_*` into `pre`; `:33-36` `post` = `pre` + the file named by the third argument.
  - `pgrst.sh <pg> <postgrest> <gateway> <dir>`: `:5` the directory holding `postgrest.exe`, `make-jwt.js` and `proxy.mjs` (`…/db21dcfe-…/scratchpad/s07-t3-impl`, read 2026-10-24: all three present); `:6` `SECRET=s47e-local-postgrest-jwt-secret-not-used-anywhere-real-0000`; `:24-29` `env-run.sh`.
  - Build `<SCRATCH>/<agent>-kit/` by copying both files; pass `<WT>/packages/db/supabase/migrations/0098_shared_number_holding.sql` as the third argument once Task 1 has committed it (Task 1's implementer passes its working copy).
  - Stop your own kit only, by the four steps in `docs/superpowers/plans/2026-10-18-ai-proposals-tray-pr8b1.md:295-298`: (1) `touch stop`; (2) stop YOUR `postgrest.exe` by path; (3) stop the gateway listener by port; (4) `pg_ctl stop -m fast`. Never `taskkill /IM postgrest.exe`. A SQL probe on `post` with PostgREST up needs `notify pgrst, 'reload schema'` after it.
- **Ports:** this lane uses **55492–55511** only (55490/55491 were the plan writer's, now stopped). Each agent checks its ports are free first (PowerShell `Get-NetTCPConnection -LocalPort <p> -State Listen`).

  | Who | Postgres | PostgREST | gateway |
  |---|---|---|---|
  | Task 1 implementer | 55492 | — | — |
  | Task 1 reviewer | 55493 | — | — |
  | Task 3 implementer | 55494 | 55495 | 55496 |
  | Task 3 reviewer | 55497 | 55498 | 55499 |
  | Task 4 implementer | 55500 | 55501 | 55502 |
  | Task 4 reviewer | 55503 | 55504 | 55505 |
  | Task 17 final reviewer | 55506 | 55507 | 55508 |
  | Task 17 fix agent (only if it touches 0098 or db tests) | 55509 | 55510 | 55511 |
- **Faithfulness:** the client-write digest (the query at `packages/db/src/test/proposals-drop.test.ts:93-98`) on `pre` must equal bis-ci's value, which Task 0 reads (expected `52|b66203ca5d355155540b520af510d120`); 0098 leaves it unchanged on `post`, and Task 18 step 1 reads the same value off bis-ci. `schema-grants-guard.test.ts`'s `EXPECTED_WRITES` does not change.
- **SQL byte rules for 0098:**
  - ASCII only and no backslash. Check with a node byte count with a positive control (memory "Local DB replica": the `grep -P` form silently passes in Git Bash): `node -e 'const b=require("fs").readFileSync(process.argv[1]);let n=0,s=0;for(const x of b){if(x>127)n++;if(x===92)s++;}console.log(n,s)' <file>` must print `0 0`, and the same command on a buffer holding `é\` must print `2 1`.
  - "Sofia", never "Sofía" (the file names neither).
  - Exactly **12** `$` characters: three `$$ … $$` bodies (the `do` block and the two functions). No `$` in any comment.
  - The word `cascade` appears zero times (`grep -ciw cascade f` → `0`).
  - **Two consecutive apostrophes appear ZERO times** (`grep -c` for them → `0`): the mechanical proof that no empty `set search_path` slipped in (0096's rule).
  - No apostrophe inside a `--` comment or inside a `comment on … is '…'` string, so no possessives.
  - No `begin;`/`commit;` wrapper. `lock_timeout` is set inside the first `do` block (`0091_ai_acts.sql:45-51` gives the reason: on PostgreSQL 17 a bare SET LOCAL as a later statement of a multi-statement string is not guaranteed to be inside a transaction block).
  - Every function 0098 creates writes `set search_path = pg_catalog, pg_temp`. Exactly one `security definer` on a code line (`move_holding_thread`), so `EXPECTED_DEFINERS` gains exactly that one entry.
  - The md5 of the committed file is `fbee986eb08d1502eed552f4c1eed5a0` (LF line ends, one trailing newline, 245 lines), after Task 1's amendments and its review fix round (P32). The plan writer's reviewed text was `ae8371757c516d581810b713e86d7cb0` (221 lines).
  - The E.164 test in the CHECK is written without a `$` anchor (length, a leading `+`, no non-digit after it), so every `$` stays a dollar-quote.
- **plpgsql NULL guard** (memory "plpgsql NULL guard"): `app.contacts_holding_server_only()` keeps `coalesce(current_user = 'authenticated', false)`; `move_holding_thread` tests `v_from_holding is null or v_to_holding is null` before comparing them.
- **Tests must be able to fail** (memories "Test vacuity", "Vacuous test shapes"):
  - The implementer runs each named mutation, pastes the failing assertion line, and reverts by `cp` + `cmp`. A mutation counts as caught only if the WHOLE FILE goes red, never under one `-t` filter (a `-t` that matches no test name skips silently).
  - Each negative fixture is shaped so the rule it claims is the ONLY thing that can reject it (P5 is this rule applied to the spec's own examples).
  - Tool results and copy are asserted as typed-out literals, never built by the function under test.
  - A loop over a literal list asserts what it iterated (its length first).
  - Never a guard satisfiable by a doc comment or a WANT-constant.
  - **Seed from the real writers:** contacts through `createContact` (with `matchBy: "email_only"` to put two people on one number), holding records through `ensureHoldingContact`, conversations through `ensureConversation`, messages through `createMessage`, calls through `startCallRow`, bookings through `createBooking`. Two exceptions, each said in its test's doc comment: the withRollback schema tests, which ARE the writer's contract; and a legacy typed phone (`"(956) 292-1696"`, `"899 922 1234"`), which no writer stores since F-009, inserted directly with the service client to stand for a pre-F-009 row.
  - **Every account-scoped read gets a second-account case:** `listContactsOnNumber`, `findUpcomingBookingForContact`, `ensureHoldingContact`, `moveHoldingThread`, `findConversationForContact`, the `matchBy` email branch, `listContacts`/`countContacts`, and every action (each called with the route's own `accountId`, asserted on the mocks' arguments).
  - **Mutations must be able to fail:** every write case asserts the stored row by re-reading it, never only the function's return value.
- **The affected-test rule (the S-47d lesson; every task's Verify lists all six kinds, or says "none" for a kind after looking):**
  1. **Tests that MOCK a module the task changes.** A spread-real factory (`vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal()), ...mocks }))`) runs the REAL new function against the test's fake client unless the test overrides it: every such file whose module under test calls a new function gets the function in its `dbMocks` with a default (for `listContactsOnNumber`, `{ rows: [], truncated: false }`), or its existing assertions start failing for an unrelated reason.
  2. **Catalogue prefix-count pins:** `apps/web/src/lib/consent/copy.test.ts:42` and `:111`. Neither regex matches a key this PR adds (`contact\.phoneCountry`, `contact\.messages`, `contact\.texts`, `sms\.consentReply`, `todo\.consent`, …), read 2026-10-24; Task 2 runs the file to prove it.
  3. **Pinned select literals:** `packages/db/src/test/tasks-call-id-read.test.ts` (pins `openTasks`'s select; this PR does not touch it); `contacts.test.ts:895-901` (scans `contacts.ts` for `.not("phone", "is", null)` and `async function findDuplicate`, both still true after Task 4); no test pins `COLS`, `contacts(first_name, last_name, language)` or `"id, email, phone"` (grep, 2026-10-24).
  4. **Bare `vi.mock("@bis/db", () => ({` factories** for a new import a module under test CALLS (A8). Read 2026-10-24: `…/inbound/route.test.ts:28` (bare, `() => dbMocks`; Task 10 adds `listContactsOnNumber`, `ensureHoldingContact`, `listOutstandingConfirmAsks`, `addTask`, `getAccountLanguage`); `…/convos/actions.test.ts:141` (bare; Task 11 adds `moveHoldingThread`, plus `ensureConversation` and `getContact` if absent); `[acct]/contacts/[contactId]/page.test.ts:100` (bare; Task 12's new case adds `findConversationForContact`; the existing cases never reach it); the six `…/convos/page*.test.ts` (bare; Task 12's page calls `listContactsOnNumber` only on a holding thread, so only its new case adds it); `[acct]/calls/[callId]/page.test.ts:84` (bare; no new function). The spread-real files that need defaults: `…/tools/registry.test.ts:36-39`, `lib/voice/finish-call.test.ts:26`, `lib/voice/textback.test.ts:20`, `…/inbound/route.consent.test.ts:19`, `apps/web/src/lib/consent/inbound.test.ts:7`. `lib/automations/passes/release-held.test.ts:9` reaches `prepareTextback` with a payload contact only, so it needs no default; run it to prove it.
  5. **e2e locators a renamed control could hit:** no existing control is renamed. The thread header's name line changes ONLY on a holding thread; `apps/web/e2e/messaging.spec.ts` and `contacts*.spec.ts` never create one. Task 12 greps `getByText`/`getByRole` in `apps/web/e2e` for any string it changes and lists the hits (expected: none).
  6. **`[acct]/in-account-service-reads.test.ts`** for any new value-level `serviceDb`/`ledgerDb` under `[acct]`, `app/api/accounts` or `lib`: `…/convos/actions.ts` is already `proven-target` (`:127`); `…/identity/*.ts` and `lib/contacts/holding-label.ts` use `serviceDb` as a type only; `[acct]/contacts/[contactId]/page.tsx` already imports `serviceDb` (`:3`) and is listed. Every task touching those trees runs the file.
- **Affected tests, never the full suite locally** (memory "Agent test scope"):
  - Run every test file that references a changed export, plus every source-scanning test that reads a file this PR changes: `packages/db/src/test/contacts.test.ts`, `…/inbound/route.test.ts`, `[acct]/contacts/[contactId]/page.test.ts`, `[acct]/in-account-service-reads.test.ts`, `lib/consent/scans.test.ts`, `lib/messages.test.ts`, `lib/voice/modules/corpus-lib.test.ts` (from `grep -rln "readFileSync"`, 2026-10-24).
  - Run by path: `pnpm --filter web exec vitest run "<path>" …`.
  - `pnpm --filter web typecheck` in every task touching `.ts`/`.tsx`; `pnpm --filter @bis/db typecheck` in every task touching `packages/db/src`. Both must be GREEN at every commit.
  - `pnpm --filter web exec eslint "<touched files>"`.
  - `@bis/db` suites run only on your replica, from `packages/db`: `node node_modules/vitest/vitest.mjs run <files>`, after `export SUPABASE_DB_URL=postgres://postgres@localhost:<pg>/post` (withRollback) or `source <dir>/env-run.sh` (PostgREST). Judge the run by vitest's own summary block (the pnpm wrapper's trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` lies).
  - Capture the exit code to a file with nothing after the command in the same block.
  - Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`), never Playwright beyond `--list`, except where a task says so: Task 12 runs `pnpm --filter web build` once (the client/server import boundary), alone, after checking nothing else is building.
- **The prompt:** `apps/web/src/lib/voice/system-prompt.ts` and `system-prompt.test.ts` are not edited by any task. Every task touching `lib/voice` runs `system-prompt.test.ts` by path: `PRE_S47B_DIGEST` (`:538`), `PRE_S47C_DIGEST` (`:648`) and `PRE_S47D_DIGEST` green untouched. No test hashes `toolSchemas` (spec §5.5, re-read for this plan: the digests hash `buildSystemPrompt` only). The tool-schema pins that DO exist are `…/tools/schemas.test.ts` (Tasks 6, 7) and `corpus-lib.test.ts:90-137`'s tool-name lists (`toContain`, so a new tool passes; Task 14 runs it).
- **`@bis/db` in web:**
  - `…/identity/*.ts` use RELATIVE imports for the app (`../phone-number`, `../../forms/guards`, `../modules`, `../call-state`), plus the `@bis/db` VALUES `emailKey` (`match.ts`) and `listContactsOnNumber` (`candidates.ts`) only; `serviceDb` only as a type. `scripts/sofia-corpus.ts` runs this graph under `tsx` (A3). Check: `grep -nE "from ['\"]@/" apps/web/src/lib/voice/identity/*.ts` → nothing.
  - The incoming route imports `@bis/db` at module scope (`…/incoming/route.ts:85-91`); new names join that import.
  - The inbound SMS route imports `@bis/db` at module scope (`…/inbound/route.ts:36-41`); new names join it. Its own source scan (`…/inbound/route.test.ts:377-383`) forbids `@/lib/sms`, `@/lib/automations`, `@/lib/email`, `@/lib/consent/gate` and `sendSmsAction`; `@/lib/voice/identity/candidates` is none of those.
- **Copy:**
  - Every UI string goes through the catalogue (`apps/web/src/lib/messages.ts`) with its `.es` twin, rendered through `makeTr(locale, pseudo).text(key, params)` (`apps/web/src/lib/record/copy.ts:15-21`) or `t()` (`apps/web/src/lib/i18n/t.ts`).
  - Spanish copy is **usted**; Owner is "dueño" (P14).
  - No JSX literal copy with a letter in it.
  - No plumbing words in copy ("holds_shared_number", "holding record", "RPC", "null", "conversation_id").
  - The persona is `{persona}`, never a typed "Sofía".
  - `messages.ts` belongs to **Task 2 only**. A later task that finds a key missing STOPS and reports.
  - Sofía's tool-result sentences (`…/identity/results.ts`) are model input, not catalogue copy (spec S14), English with the Spanish quoted, pinned by tests.
- **UI** (DESIGN.md binds every UI task):
  - Tokens only; both themes via `.dark`.
  - Existing components only: `DropdownMenu` (`apps/web/src/components/ui/dropdown-menu.tsx:241-256`), `Dialog`, `Input`, `Button` ghost, `Notice` (`components/ui/notice.tsx:22-40`, tone `warn` with `className="text-foreground"` for a sentence), `sonner` toasts.
  - ONE primary per view (rule 8): the thread's one primary stays Send; "Move to…" and every menu item are ghost; the search dialog has no primary (its rows are ghost buttons).
  - Loaded/empty/error states (rule 5); skeletons, not spinners (rule 7).
  - Undo toasts for `UNDO_WINDOW_MS` (`[acct]/calendar/undo-window.ts:14`, 10 000 ms); no "Are you sure?" (rule 6).
  - `lang` set on every new surface root.
- **Logs:** ids and codes only. Never a caller number, a name, an email, a message body or a key. The identity line is exactly `voice identity {callRowId|(no row)}: {event}` (spec §5.9).

---

## Task 0: Rebase, pre-reads (orchestrator)

- [ ] **The rebase** (the one rewrite this plan allows; only docs commits move):
  1. `git -C <WT> status --short` prints nothing, or only untracked files never staged. STOP otherwise.
  2. `git -C <WT> fetch origin`, then `git -C <WT> log --oneline origin/main..HEAD` lists exactly the three spec commits (`1875cb0d`, `20117586`, `df8882ce`) and this plan's commit.
  3. `git -C <WT> diff --stat origin/main...HEAD` touches only `docs/superpowers/specs/2026-10-24-caller-identity-ladder-design.md` and this plan.
  4. `git -C <WT> rebase origin/main`. A docs-only branch cannot conflict. On any conflict, `git -C <WT> rebase --abort` and STOP.
  5. `git -C <WT> diff --stat origin/main HEAD` again touches only those two docs.
  6. `ls <WT>/packages/db/supabase/migrations | tail -1` → `0097_one_switch.sql`.
  7. If the branch was ever pushed, the orchestrator pushes with `git push --force-with-lease origin feat/s47e-identity`. Never `--force`, never `main`.
- [ ] **Re-derive the moved cites.** `git -C <WT> diff --stat 449d5bf6 HEAD -- apps packages` lists #287's files (and any later merge's). For each cite in this plan into one of them, re-read the line and amend this plan in ONE commit on this file only (`git commit -m "docs: S-47e plan, re-derive cites after rebasing" -- docs/superpowers/plans/2026-10-24-caller-identity-ladder-pr47e.md`). Known: `messages.ts` (the S-47d block's end, `:2573` at `a1ccb19a`; the insurance hint, still `:2056-2057` at `a1ccb19a`) and `messages.test.ts` (the S-47b hint pin, `:1409-1411` at `df8882ce`).
- [ ] **A1 again:** `git -C <WT> log --all --oneline -- 'packages/db/supabase/migrations/0098*'` prints nothing.
- [ ] **Install once.** `cd <WT> && pnpm install --frozen-lockfile --prefer-offline`. No agent runs `pnpm install` in `<WT>` after this.
- [ ] **Read-only MCP on both projects** (`odnobiodsftffphuuosz` bis-ci, `tlbkbmlrfafquucsmsmm` production):
  1. `select version, name from supabase_migrations.schema_migrations order by version desc limit 1;` → name `one_switch` on both.
  2. The client-write digest (the query at `proposals-drop.test.ts:93-98`), bis-ci only → `52|b66203ca5d355155540b520af510d120` (A2).
  3. `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.prosecdef and n.nspname in ('public', 'app');` → `22` on both.
  4. `select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name = 'holds_shared_number';` → `0`, and `select to_regprocedure('public.move_holding_thread(uuid,uuid,uuid,text,bigint)');` → NULL, on both.
  5. Production only (A6): `select count(*) from public.contacts;`.
  6. Production only, for the owner (how many numbers start asking names on merge): `select count(*) from (select account_id, phone_key from public.contacts where phone_key is not null group by 1, 2 having count(*) >= 2) s;` and the same with `>= 21`.
- [ ] **STOP** if read 1, 2 or 3 differs, or read 4 is non-zero anywhere, or read 5 exceeds 1,000,000 (A6).
- [ ] **The bare-factory list** (the affected-test rule's kind 4): `grep -rlnE 'vi\.mock\("@bis/db", (async )?\(\) =>' apps/web/src | xargs grep -lE "createContact|prepareTextback|runTool|finishCall|listConversations|getConversationSummary|getContact\b"`, and put the result in each brief of Tasks 6–12. Read 2026-10-24, the files whose module under test will CALL a new function are listed under kind 4 above.
- [ ] **Ports** 55492–55511 free (`Get-NetTCPConnection -LocalPort <p> -State Listen` for each, PowerShell). If any is taken, shift the whole table by 20 and amend this plan in one commit.
- [ ] **Ledger line** `s47e T0: …` with every value read. Put the digest, the definer count and read 6 into Task 1's and Task 18's briefs.

---

## Task 1 (HIGH): Migration 0098 and its proof (bis-db-schema, opus)

**Files:**
- Create: `packages/db/supabase/migrations/0098_shared_number_holding.sql`
- Create: `packages/db/src/test/shared-number-holding-schema.test.ts` (withRollback)
- Modify: `packages/db/src/test/definer-search-path.test.ts:25`, `:47-48` (one entry between them), `:62`, `:67`, `:76`

**Interfaces:**
- Consumes: nothing.
- Produces: every object in "The model, 0098". Tasks 3, 4 and 11 read and write them through PostgREST.

**Read first:** spec §4.1 whole; this plan's Plan-writer check and P1–P3; `0097_one_switch.sql:1-100` (header style, the `do` block); `0091_ai_acts.sql:45-51` and `:155-175` (`contacts_author_guard`, the shape of a server-only trigger); `0096_definer_search_path.sql` (the RULE FOR EVERY LATER MIGRATION paragraph); `packages/db/src/test/db.ts:1-46` (`withRollback`, `actAs`, `actAsMember`, `actAsOwner`); `packages/db/src/test/definer-search-path.test.ts:1-140`.

- [ ] **Step 1: Build the kit** (Global constraints) on 55492. The migration is not written yet, so the first build's third argument is a copy of the plan writer's file: `cp <KIT>/0098_shared_number_holding.reviewed.sql <SCRATCH>/t1-kit/0098.sql`, then `bash <SCRATCH>/t1-kit/replica.sh 55492 <SCRATCH>/t1-kit/r <SCRATCH>/t1-kit/0098.sql`. Show `diff <KIT>/replica.sh <SCRATCH>/t1-kit/replica.sh` (no difference). Confirm `pre`'s client-write digest equals Task 0's bis-ci value (`52|b66203ca…`) and `pre` has 22 definers. Steps 3 and 6 use `pre` only; Step 5 rebuilds with the committed file.

- [ ] **Step 2: Write the failing schema test** `packages/db/src/test/shared-number-holding-schema.test.ts`. DONE (Task 1, then its review fix round, P32): the committed file is the text, 52 cases. This plan no longer carries a copy, because the copy drifted from the file; read the file at the branch head.

- [ ] **Step 3: Run on `pre` to verify it fails.** From `packages/db`: `export SUPABASE_DB_URL=postgres://postgres@localhost:55492/pre; node node_modules/vitest/vitest.mjs run src/test/shared-number-holding-schema.test.ts`. Expected: `Tests  52 failed (52)` (`column "holds_shared_number" … does not exist`, or a null def), as on the Task 1 implementer's replica after the review fix round (P32; the plan writer's 42-case file read 42 of 42). Paste the summary line.

- [ ] **Step 4: Write the migration** `packages/db/supabase/migrations/0098_shared_number_holding.sql`. DONE: the committed file is the text, md5 `fbee986eb08d1502eed552f4c1eed5a0` (245 lines). The plan writer's reviewed copy was `ae8371757c516d581810b713e86d7cb0`; amendments 1 and 2 and the review fix round (P32) changed it. This plan no longer carries a copy.

- [ ] **Step 5: `EXPECTED_DEFINERS` 22 → 23, in this commit** (`definer-search-path.test.ts`'s own rule, `:20`):
  - `:25`: "The 22 SECURITY DEFINER functions in public and app at 0096" → "The 23 SECURITY DEFINER functions in public and app at 0098".
  - Between `:47` (`"public.mark_document_version_ready(…)"`) and `:48` (`"public.record_event(…)"`), one line: `  "public.move_holding_thread(uuid,uuid,uuid,text,bigint)": PG_CATALOG_PG_TEMP,`.
  - `:62` "exactly these 22" → "exactly these 23"; `:67` `toHaveLength(22)` → `toHaveLength(23)`; `:76` `toBeGreaterThanOrEqual(22)` → `toBeGreaterThanOrEqual(23)`.
  - The plan writer applied exactly these five edits to a temporary copy: `Tests  6 passed (6)` on `post`.
  - Re-build the kit with the committed file as its third argument. Run on `post`, from `packages/db`: `export SUPABASE_DB_URL=postgres://postgres@localhost:55492/post; node node_modules/vitest/vitest.mjs run src/test/shared-number-holding-schema.test.ts src/test/definer-search-path.test.ts src/test/schema-grants-guard.test.ts src/test/proposals-drop.test.ts src/test/server-only-writes-grants.test.ts src/test/record-provenance-schema.test.ts src/test/one-switch-schema.test.ts src/test/customer-language-schema.test.ts src/test/company-name-read-only-schema.test.ts` → all green (all nine are withRollback-only; the plan writer's run of the last seven, unedited, was green).
  - If the defs or the comments differ on your replica, STOP and report.

- [ ] **Step 6: Run each mutation.** For each: write the mutated copy (`<SCRATCH>/s47e/t1-kit/mutate5.js <file> <dir>` writes all 31, m06b is written beside them, all with `split().join()`, never `String.replace`, whose replacement string turns `$$` into `$`), `create database mut template pre` (+ `alter database mut set timezone to 'UTC'`), `psql -1 -f` the copy into `mut`, run `shared-number-holding-schema.test.ts` against `mut` (plus `schema-grants-guard.test.ts` for m07 and `definer-search-path.test.ts` for m13), paste the failing assertion lines, drop `mut`. Never edit the committed file for a probe. The counts in brackets are the Task 1 implementer's after the review fix round (out of 52, or 58 with the second file); more reds than a line names are fine, fewer is a finding.
  - m01. Drop `contacts_holding_shape` (both statements) → the eight `refuses a holding record with …` cases, the business-name case and the pin case FAIL [10 failed of 52].
  - m02. `first_name = 'Caller'` (not null-safe, P22) → "…with no first name…" and the pin case FAIL [2 failed].
  - m03. The index on `(phone)` alone → "…account B gets its own on the same number…", the pin case, and every `move_holding_thread` case (`household()` seeds a holding record on both accounts) FAIL [21 failed].
  - m04. The index on `(account_id, phone_key)` (P23) → "two numbers of two countries…" and the pin case FAIL [2 failed].
  - m05. Drop the `create trigger contacts_holding_server_only …` statement → the signed-in insert case, the ten edit cases and the pin case FAIL [12 failed].
  - m06. Drop the edit refusal (keep `new.holds_shared_number := old…`) → the ten "cannot change a holding record's …" cases and the column-coverage case FAIL [11 failed]. m06b: drop `source` from both tuples → the `source` case and the column-coverage case FAIL [2 failed].
  - m07. Append `grant update (holds_shared_number) on public.contacts to authenticated;` → "a signed-in update that names the mark is refused…" FAILS, and `schema-grants-guard.test.ts`'s "gives anon nothing and authenticated exactly the allow-listed writes" FAILS [2 failed of 58].
  - m08. Drop `or (v_to_holding and p_undo_of is null)` → the `invalid` case FAILS [1 failed].
  - m09. Drop the event's `fromConversationId`/`toConversationId` checks → the forged-Undo case FAILS [1 failed].
  - m10. Drop `and (p_undo_of is null or m.id = any (v_want_messages))` → the Undo case (`later` moves too) and the texts-only Undo FAIL [2 failed].
  - m11. Drop `c.account_id = p_account_id and` from BOTH `select c.contact_id …` reads → the `not_found` case FAILS [1 failed].
  - m12. Append `grant execute on function public.move_holding_thread(uuid, uuid, uuid, text, bigint) to authenticated;` → "only service_role may execute it" FAILS [1 failed].
  - m13. `set search_path = public` on `move_holding_thread` → the settings pin FAILS, and so do both definer cases of `definer-search-path.test.ts` [3 failed of 58]. The shadow case stays GREEN: only the pins catch this one.
  - m14. Delete `comment on function public.move_holding_thread …` → the comments case FAILS [1 failed].
  - m15. A move hands over no unread (`v_hand := 0` for a move) → the whole-move case, the empty case and the two hand-back cases FAIL [4 failed].
  - m16. Drop the calls contact guard `and (k.contact_id is null or k.contact_id = v_from_contact)` → "a call on the holding thread that names another contact…" FAILS [1 failed] (R7).
  - m17. Drop `m.account_id = p_account_id and` from the messages update → "a message carrying another account's id…" FAILS [1 failed] (R7).
  - m18. Drop `k.account_id = p_account_id and` from BOTH contacts reads → "a conversation of A whose contact is B's holding record…" FAILS [1 failed] (R7).
  - m19. `'undo', false` always in the event → the Undo case FAILS on the event's `undo` [1 failed] (R7).
  - m20. Drop the direction guard `or (v_from_holding and p_undo_of is not null)` → "an Undo cannot itself be undone…" FAILS [1 failed]. Amendment 1 deleted the Undo flag check, which no call could reach (on the 221-line text, dropping either guard alone stayed green), so the direction guard is the one guard and it fails alone.
  - m21. Drop `and e.actor_type = 'system' and (e.payload ->> 'writer') = 'move_holding_thread'` → both record_event cases (Technician, Owner) FAIL [2 failed] (re-review R1).
  - m22. Drop `and (p_undo_of is null or k.id = any (v_want_calls))` → the Undo case on Beto's own call and the call-only Undo FAIL [2 failed] (re-review R2).
  - m23. Write the event as `'user'` → the whole-move pin, the Undo case, the Undo-of-an-Undo case, the one-sided case and the hand-back cases FAIL [7 failed]: the function can no longer undo from its own event.
  - m24. `between 9 and 16` → the 8-character case and the pin FAIL [2 failed] (amendment 2).
  - m25. `between 7 and 16` → the 7-character refusal and the pin FAIL [2 failed].
  - m26. Drop `and company_name is null` → the business-name case and the pin FAIL [2 failed] (P32).
  - m27. Drop the `empty` answer → "a second move of the same thread … answers empty and writes no event" FAILS [1 failed] (P32).
  - m27b. `or` for `and` between the two emptiness tests → "texts with no call, and a call with no text, are each a move…" and the second-Undo case FAIL [2 failed] (P32).
  - m28. `between 8 and 15` → the 16-character case and the pin FAIL [2 failed] (P32).
  - m29. `between 8 and 17` → the 17-character refusal and the pin FAIL [2 failed] (P32).
  - m30. Drop `and e.type = 'conversation.moved'` → "an Undo naming a system event of another type…" FAILS [1 failed] (P32).
  - m31. An Undo hands back nothing (`v_hand := 0` in the Undo branch) → the Undo case, the two hand-back cases and the second-Undo case FAIL [4 failed] (P32).
  - m32. Drop the cap (`least(…, v_from_unread)`) → "an Undo after the person read some…" FAILS: the person thread reads -1 [1 failed] (P32).
  - m33. Hand back on an Undo that moved nothing (drop the `elsif … then v_hand := 0`) → "a second Undo of the same move…" FAILS [1 failed] (P32).
  - m34. The event records no `unread` → the whole-move pin and every hand-back case FAIL [5 failed] (P32).

- [ ] **Step 7: Rollback, digest and bytes.**
  - On a throwaway `create database rb template post`, run the six ROLLBACK lines of the file's header in order (they ran on the plan writer's replica). Then: `select count(*) from pg_constraint where conname like 'contacts_holding%'` → `0`; `select count(*) from information_schema.columns where table_name = 'contacts' and column_name = 'holds_shared_number'` → `0`; the two functions gone; the definer count back to 22; the client-write digest `52|b66203ca…`. Drop `rb`.
  - On `post`, the client-write digest → `52|b66203ca5d355155540b520af510d120`.
  - Bytes: the node byte count → `0 0` (with its `2 1` control); `grep -o '\$' f | wc -l` → `12`; `grep -ciw cascade f` → `0`; the two-apostrophe count → `0`; `grep -c "^ *--.*'" f` → `0`; `grep -n "search_path" f` → line 37 and the two `language plpgsql … set search_path = pg_catalog, pg_temp as` lines (87, 115); `wc -l f` → `245`.
  - Record `md5sum` of the file. It equals `fbee986eb08d1502eed552f4c1eed5a0` (P32). If it differs, say what changed and why.

- [ ] **Step 8: Commit** (both typechecks green; eslint on the test file).

```bash
git add -- packages/db/supabase/migrations/0098_shared_number_holding.sql packages/db/src/test/shared-number-holding-schema.test.ts
git diff --cached --stat
git commit -m "db: one holding record per shared phone number, which no booking, lead, name or customer detail reaches, and a server-only move of its texts to a person with Undo (S-47e E8, migration 0098)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- packages/db/supabase/migrations/0098_shared_number_holding.sql packages/db/src/test/shared-number-holding-schema.test.ts packages/db/src/test/definer-search-path.test.ts
```

**Verify (the affected-test rule):** (1) no web mock reaches 0098; (2) none; (3) none; (4) none; (5) none; (6) none. The db suites above, on the replica.

**Acceptance:** all 52 cases green on `post` and red on `pre`; every mutation fails by name; the digest unchanged; the rollback leaves nothing; the bytes pass; the md5 in the report.

**Review (HIGH):** an opus bis-reviewer in its own detached worktree, with its own kit on 55493.
- It applies 0098 to a fresh `pre` copy through `psql -1` only, and reads every def itself.
- It re-runs m02, m04, m06, m08, m09, m10, m16, m18, m20 (the direction guard alone, amendment 1), m21, m22, m26, m27, m27b, m30, m31, m32 and m33, plus three of its own: `grant insert on public.contacts to anon` (R6: anon already holds SELECT, so a SELECT grant cannot fail; on the plan writer's replica this one turned `schema-grants-guard.test.ts`'s "gives anon nothing…" and `proposals-drop.test.ts`'s digest case red, `Tests 2 failed | 40 passed (42)`); `first_name is not distinct from 'caller'` (lowercase) in the CHECK (the pin and the exact-shape case must catch it); and removing `order by c.id for update` (nothing in a single-session test can catch a deadlock; say so, and read the lock order by eye).
- It checks the bytes and the md5, and that no comment string or `--` line holds an apostrophe.
- It confirms `definer-search-path.test.ts` is green on `post` with exactly one new entry, and that `schema-grants-guard.test.ts` and `proposals-drop.test.ts` were NOT edited.
- A re-review follows any change. The md5 that reaches bis-ci is the reviewed one.

---

## Task 2 (LOW): Every new copy key, English and Spanish (bis-frontend)

**Brief.**
- Add the 16 keys of "The model, Copy keys" (Task 2 committed 15 at `07f1a112`; `conversation.holding.moveEmpty`, P32, is the one follow-up) to `apps/web/src/lib/messages.ts`, each `.es` twin on the line after its key, after the S-47d block's last key (`"voice.knowledge.noClosedDaysRecorded.es"`, `:2573` at `a1ccb19a`; re-read after the rebase), under one comment line: `// S-47e: identity checks (the To-do), the shared number's holding thread (label, Notice, Move, the call page) and its two To-dos. Usted.` The two `todo.sharedNumber.*` keys must NOT start `todo.consent.` (`lib/consent/copy.test.ts:111` counts that prefix: 80).
- Replace the `voice.tradeRules.insurance_pcHint` pair (`:2056-2057`) with the two sentences of "The model, Copy keys" (S16), and the S-47b describe's pinned pair (`messages.test.ts:1409-1411` at `df8882ce`) with the same two literals. `voice-settings.test.ts:39` and `:826` read the key through `m[…]` and need no edit; run them.
- Append ONE `describe("S-47e: identity and shared-number copy, English and Spanish (plan Task 2)")` to `apps/web/src/lib/messages.test.ts`, in the shape of the S-47d describe (`messages.test.ts:1723-…`). It contains:
  - a literal `EXPECTED_PARAMS` over the 16 keys, with its length asserted as **16** (the table's rows, counted off this plan: one `voice`, one `contact`, eleven `conversation`, one `call`, two `todo`; recount it yourself before you trust it): `voice.todo.identity` `[]`, `contact.holding.label` `["number"]`, `conversation.holding.notice` `["number"]`, `conversation.holding.moved` `["name"]`, `todo.sharedNumber.hold` `["excerpt", "number"]` (sorted), every other `[]`;
  - every key and twin present and different;
  - params identical across the twin;
  - every sentence pinned as a typed literal pair (all 16 rows, both columns, word for word);
  - usted (the S-47b regex);
  - no typed "Sofía";
  - no plumbing word (`holds_shared_number|holding record|RPC|null|conversation_id`);
  - "dueño", never "propietario", in `conversation.holding.moveRole.es` (P14).
- Run `messages.test.ts`, `src/lib/consent/copy.test.ts` (the prefix pins: green unedited), `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/accents-guard.test.ts` and `"src/app/(dashboard)/dashboard/accounts/[accountId]/voice/voice-settings.test.ts"` → green. Then typecheck and eslint.
- No baseline regeneration here (Task 12 does it once).
- Commit `copy: the identity To-do, the shared number's holding thread and the insurance hint's identity sentence, English and Spanish (S-47e)`, naming the two files.

**Verify (the affected-test rule):** (1) `voice-settings.test.ts` (reads the hint); (2) `copy.test.ts:42`, `:111` green unedited; (3) none; (4) none; (5) `grep -rn "takes quote requests" apps/web/e2e` → expected none; (6) none.

---

## Task 3 (HIGH): `@bis/db` voice reads and the holding writers (bis-voice, opus)

**Dispatch gate:** Task 1's review approved (this task needs 0098 on its replica).

**Files:**
- Modify: `packages/db/src/voice.ts` (the imports at `:1-5`; new exports after `ensureCallbackTask`, which ends at `:727`), `packages/db/src/index.ts` (one line after `:25`).
- Test: `packages/db/src/test/voice.test.ts` (one new `describe` at the end; import the new names in the `../voice` block at `:8-23`).

**Interfaces:**
- Consumes: 0098 (Task 1).
- Produces: `NumberContactRow`, `CONTACTS_ON_NUMBER_LIMIT`, `phoneKeysOf`, `listContactsOnNumber`, `findUpcomingBookingForContact`, `HoldingContactUnavailable`, `ensureHoldingContact`, `HoldingMove`, `moveHoldingThread` (exact code in "The model, `@bis/db` (Task 3)"), and `emailKey` from the barrel. Tasks 5, 6, 8, 10, 11 and 16 call them.
- `findUpcomingBookingForPhone` STAYS until Task 6 (P17).

- [ ] **Step 1: Build your kit** on 55494/55495/55496 with PostgREST (`replica.sh 55494 <dir> <WT>/packages/db/supabase/migrations/0098_shared_number_holding.sql`, then `pgrst.sh 55494 55495 55496 <dir>`).
- [ ] **Step 2: Write the failing tests** (append to `voice.test.ts`; seed through the real writers, Global constraints):

```ts
import { emailKey as barrelEmailKey } from "../index";
import { listContactsOnNumber, findUpcomingBookingForContact, ensureHoldingContact, moveHoldingThread, phoneKeysOf,
  CONTACTS_ON_NUMBER_LIMIT } from "../voice";
// (these join the existing `../voice` import block at :8-23; `createContact` is already imported at :3)

describe("S-47e: who is on a number, one contact's next booking, the holding record (plan Task 3)", () => {
  /** A person on a number the way staff put a second one there today: a contact with no phone (createContact
   *  then has nothing to dedupe on), then an edit that gives it the number (updateContact keeps both and files
   *  the pair for the merge queue). createContact with a phone alone would dedupe onto the first by phone. */
  async function person(db: SupabaseClient, accountId: string, firstName: string, lastName: string, phone: string, email?: string) {
    const { id } = await createContact(db, accountId, { firstName, lastName, email, source: "voice" }, "user_test");
    await updateContact(db, accountId, id, { phone }, "user_test");
    return { id };
  }
  /** A pre-F-009 row (no writer stores this shape any more): the service client's own insert, said so here. */
  async function legacy(db: SupabaseClient, accountId: string, firstName: string, phone: string): Promise<string> {
    const { data, error } = await db.from("contacts").insert({ account_id: accountId, first_name: firstName, last_name: "Prueba", phone })
      .select("id").single();
    if (error || !data) throw new Error(error?.message);
    return (data as { id: string }).id;
  }

  it("phoneKeysOf: a US number's digits key; a Mexican number's own key, its ten digits and its 521 form (plan P4)", () => {
    expect(phoneKeysOf("+19565550160")).toEqual(["9565550160"]);
    expect(phoneKeysOf("+528999221234")).toEqual(["528999221234", "8999221234", "5218999221234"]);
  });

  it("finds an E.164 phone and a legacy typed one, oldest first, with email_key and never the raw email", async () => {
    await withTestAccount(async (db, accountId) => {
      const ana = await person(db, accountId, "Ana", "Prueba", "+19565550160", "Ana+bis@Example.com");
      const beto = await legacy(db, accountId, "Beto", "(956) 555-0160");
      const { rows, truncated } = await listContactsOnNumber(db, accountId, "+19565550160");
      expect(truncated).toBe(false);
      expect(rows.map((r) => r.id)).toEqual([ana.id, beto]);
      expect(Object.keys(rows[0]!).sort()).toEqual(["email_key", "first_name", "holds_shared_number", "id", "last_name", "phone"]);
      expect(rows[0]).toMatchObject({ first_name: "Ana", last_name: "Prueba", email_key: "ana@example.com", holds_shared_number: false });
      expect(rows[1]).toMatchObject({ phone: "(956) 555-0160", email_key: null });
    });
  });

  it("finds a Mexican number stored with its code, without it, and in its 521 form (mutation: drop the 521 key from phoneKeysOf -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const withCode = await person(db, accountId, "Carla", "Prueba", "+528999221234");
      const bare = await legacy(db, accountId, "Dora", "899 922 1234");
      const old521 = await legacy(db, accountId, "Eva", "+52 1 899 922 1234");
      const { rows } = await listContactsOnNumber(db, accountId, "+528999221234");
      expect(rows.map((r) => r.id).sort()).toEqual([withCode.id, bare, old521].sort());
    });
  });

  it("never returns another account's contact with the same phone and name (mutation: drop .eq(\"account_id\", …) -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const a = await person(dbA, accountA, "Ana", "Prueba", "+19565550161");
        await person(dbB, accountB, "Ana", "Prueba", "+19565550161");
        const { rows } = await listContactsOnNumber(dbA, accountA, "+19565550161");
        expect(rows.map((r) => r.id)).toEqual([a.id]);
      });
    });
  });

  it(`${CONTACTS_ON_NUMBER_LIMIT + 1} contacts set truncated and return ${CONTACTS_ON_NUMBER_LIMIT}; ${CONTACTS_ON_NUMBER_LIMIT} do not`, async () => {
    await withTestAccount(async (db, accountId) => {
      expect(CONTACTS_ON_NUMBER_LIMIT).toBe(20);
      for (let i = 0; i < 20; i += 1) await person(db, accountId, `P${i}`, "Prueba", "+19565550162");
      expect(await listContactsOnNumber(db, accountId, "+19565550162")).toMatchObject({ truncated: false });
      await person(db, accountId, "P20", "Prueba", "+19565550162");
      const r = await listContactsOnNumber(db, accountId, "+19565550162");
      expect(r.truncated).toBe(true);
      expect(r.rows).toHaveLength(20);
    });
  });

  it("findUpcomingBookingForContact: that ONE contact's soonest booked future booking; past, cancelled and a housemate's are skipped", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const ana = await person(db, accountId, "Ana", "Prueba", "+19565550163");
      const beto = await person(db, accountId, "Beto", "Prueba", "+19565550163");
      const now = new Date("2027-05-01T12:00:00Z");
      const at = (d: string) => ({ startsAt: new Date(`${d}T15:00:00Z`), endsAt: new Date(`${d}T16:00:00Z`) });
      await createBooking(db, accountId, { calendarId: cal.id, contactId: ana.id, ...at("2027-04-30") }, "user_test");
      const cancelled = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana.id, ...at("2027-05-02") }, "user_test");
      await setBookingStatus(db, accountId, cancelled.id, "cancelled", "user_test");
      await createBooking(db, accountId, { calendarId: cal.id, contactId: beto.id, ...at("2027-05-03") }, "user_test");
      const anas = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana.id, ...at("2027-05-04") }, "user_test");
      expect(await findUpcomingBookingForContact(db, accountId, ana.id, now.toISOString()))
        .toEqual({ bookingId: anas.id, startsAt: expect.stringMatching(/^2027-05-04T15:00:00/) });
    });
  });

  it("findUpcomingBookingForContact answers null for account A asked about account B's contact (mutation: drop .eq(\"account_id\", …) -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const cal = await getOrCreateCalendar(dbB, accountB, "user_test");
        const b = await person(dbB, accountB, "Ana", "Prueba", "+19565550164");
        await createBooking(dbB, accountB, { calendarId: cal.id, contactId: b.id,
          startsAt: new Date("2027-05-04T15:00:00Z"), endsAt: new Date("2027-05-04T16:00:00Z") }, "user_test");
        expect(await findUpcomingBookingForContact(dbA, accountA, b.id, "2027-05-01T12:00:00Z")).toBeNull();
      });
    });
  });

  it("ensureHoldingContact makes the exact shape once, by Sofía, then reuses it; one contact.created with holding true (mutation: insert every time -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await person(db, accountId, "Ana", "Prueba", "+19565550165");
      const first = await ensureHoldingContact(db, accountId, "+19565550165");
      const again = await ensureHoldingContact(db, accountId, "+19565550165");
      expect(first.created).toBe(true);
      expect(again).toEqual({ id: first.id, created: false });
      const { data: row } = await db.from("contacts")
        .select("first_name, last_name, email, phone, source, holds_shared_number, author_kind, author_id").eq("id", first.id).single();
      expect(row).toEqual({ first_name: "Caller", last_name: null, email: null, phone: "+19565550165", source: "voice",
        holds_shared_number: true, author_kind: "ai", author_id: null });
      const { data: events } = await db.from("events").select("payload").eq("account_id", accountId).eq("type", "contact.created");
      expect((events ?? []).filter((e: { payload: { holding?: boolean } }) => e.payload.holding === true)).toHaveLength(1);
    });
  });

  it("two ensureHoldingContact calls at once make ONE row", async () => {
    await withTestAccount(async (db, accountId) => {
      const [x, y] = await Promise.all([
        ensureHoldingContact(db, accountId, "+19565550166"), ensureHoldingContact(db, accountId, "+19565550166"),
      ]);
      expect(x.id).toBe(y.id);
      const { data } = await db.from("contacts").select("id").eq("account_id", accountId).eq("holds_shared_number", true);
      expect(data).toHaveLength(1);
    });
  });

  it("two numbers that share a digits key get two holding records (P23: +1 322 123 4567 and +32 2 123 4567; mutation: read by phone_key -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const us = await ensureHoldingContact(db, accountId, "+13221234567");
      const be = await ensureHoldingContact(db, accountId, "+3221234567");
      expect(be.id).not.toBe(us.id);
      expect(be.created).toBe(true);
      expect(await ensureHoldingContact(db, accountId, "+3221234567")).toEqual({ id: be.id, created: false });
    });
  });

  it("ensureHoldingContact never returns account B's holding record for account A (mutation: drop .eq(\"account_id\", …) from its read -> FAILS)", async () => {
    await withTestAccount(async (dbA, accountA) => {
      await withTestAccount(async (dbB, accountB) => {
        const b = await ensureHoldingContact(dbB, accountB, "+19565550167");
        const a = await ensureHoldingContact(dbA, accountA, "+19565550167");
        expect(a.id).not.toBe(b.id);
        expect(a.created).toBe(true);
      });
    });
  });

  it("listContactsOnNumber returns the holding record flagged; an ordinary \"Caller\" contact is not one", async () => {
    await withTestAccount(async (db, accountId) => {
      const caller = await createContact(db, accountId, { firstName: "Caller", phone: "+19565550168", source: "voice" }, "voice", "ai");
      const holding = await ensureHoldingContact(db, accountId, "+19565550168");
      const { rows } = await listContactsOnNumber(db, accountId, "+19565550168");
      expect(rows.map((r) => [r.id, r.holds_shared_number])).toEqual([[caller.id, false], [holding.id, true]]);
    });
  });

  it("moveHoldingThread moves through PostgREST and its Undo names the move; a second move is empty; another account's thread is not_found", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (dbB, accountB) => {
        await person(db, accountId, "Ana", "Prueba", "+19565550169");
        const beto = await person(db, accountId, "Beto", "Prueba", "+19565550169");
        const holding = await ensureHoldingContact(db, accountId, "+19565550169");
        const hc = await ensureConversation(db, accountId, holding.id, "voice", "ai");
        const bc = await ensureConversation(db, accountId, beto.id, "user_test");
        const msg = await createMessage(db, accountId, { conversationId: hc.id, channel: "sms", direction: "inbound", body: "test", status: "delivered" }, "sms-inbound", "system");
        const moved = await moveHoldingThread(db, accountId, { from: hc.id, to: bc.id, actor: "user_test" });
        expect(moved).toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [msg.id], callIds: [] });
        if (moved.status !== "ok") throw new Error("unreachable");
        const { data: m } = await db.from("messages").select("conversation_id").eq("id", msg.id).single();
        expect(m).toEqual({ conversation_id: bc.id });
        // Nothing is left on the holding thread: a second move is empty and writes no event (P32).
        expect(await moveHoldingThread(db, accountId, { from: hc.id, to: bc.id, actor: "user_test" })).toEqual({ status: "empty" });
        expect(await moveHoldingThread(db, accountId, { from: bc.id, to: hc.id, actor: "user_test", undoOf: moved.moveId }))
          .toEqual({ status: "ok", moveId: expect.any(Number), messageIds: [msg.id], callIds: [] });
        // An Undo that names no move is refused by the function (P1), never a silent no-op.
        expect(await moveHoldingThread(db, accountId, { from: bc.id, to: hc.id, actor: "user_test" })).toEqual({ status: "invalid" });
        const holdingB = await ensureHoldingContact(dbB, accountB, "+19565550169");
        const hbc = await ensureConversation(dbB, accountB, holdingB.id, "voice", "ai");
        expect(await moveHoldingThread(db, accountId, { from: hbc.id, to: bc.id, actor: "user_test" })).toEqual({ status: "not_found" });
      });
    });
  });

  it("the barrel exports emailKey, the twin of 0034's email_key (spec O1; mutation: drop the index.ts line -> FAILS)", () => {
    expect(barrelEmailKey("  Dan+BIS@Example.com ")).toBe("dan@example.com");
  });
});
```
  `:3`'s `import { createContact } from "../contacts";` becomes `import { createContact, updateContact } from "../contacts";`. `ensureConversation` and `createMessage` (`:4`) and `getOrCreateCalendar`, `createBooking`, `setBookingStatus` (`:5`) are already imported; `SupabaseClient` comes from `@supabase/supabase-js` as a type import.
- [ ] **Step 3: Run to verify they fail.** `source <dir>/env-run.sh; cd packages/db; node node_modules/vitest/vitest.mjs run src/test/voice.test.ts` → the new cases FAIL (`listContactsOnNumber is not a function` or a missing export). Before implementing, one throwaway probe proves the spec's SD4: `findUpcomingBookingForPhone(db, accountId, "+19565550160", …)` returns `null` for a booking of the LEGACY Beto above. Paste it in the report; do not commit the probe.
- [ ] **Step 4: Implement** the model's code exactly (`voice.ts`, then the barrel line `export { emailKey } from "./contacts";` after `index.ts:25`).
- [ ] **Step 5: Run to verify they pass**, then run the mutations named in the cases (drop the 521 key; each `.eq("account_id", …)` in `listContactsOnNumber`, `findUpcomingBookingForContact`, `ensureHoldingContact`'s read; `ensureHoldingContact` without its `find()` before the insert; its read by `phoneKeysOf` instead of the exact phone, which the two-countries case catches; the barrel line). Paste each failing line, revert, `cmp`.
- [ ] **Step 6: Commit** `db: who is on a number (by its phone key, holding records flagged), one contact's next booking, and the shared number's one holding record and its move (S-47e)`, naming `voice.ts`, `index.ts`, `voice.test.ts`. Stop your kit.

**Verify (the affected-test rule):** (1) none yet (nothing calls the new functions until Task 5); (2) none; (3) none; (4) none yet; (5) none; (6) none. Both typechecks; eslint on the two source files; `voice.test.ts` and `voice-schema.test.ts` on your replica + PostgREST.

**Review (HIGH, opus, own worktree and kit on 55497–55499):** re-runs every account mutation above itself; checks that no read selects `email`; that `ensureHoldingContact` never calls `createContact`; that a 23505 from any OTHER unique index would not be mistaken for the holding race (read `contacts`' unique indexes on the replica and say which exist); and that an Undo can name nothing but a `moveId` (the type allows nothing else, and the function reads the ids from the move's own event, P1).

---

## Task 4 (HIGH): `@bis/db` contacts, the import and the inbox reads (bis-db-schema, opus)

**Dispatch gate:** Task 3 committed (this task's tests seed holding records through `ensureHoldingContact`).

**Files:**
- Modify: `packages/db/src/contacts.ts` (`:33-42`, `:69-70`, `:261-354`, `:396-423`, `:425-494`, `:502-515`, `:883-891`, `:993-997`), `packages/db/src/contact-import.ts:38-53`, `packages/db/src/messaging.ts` (`:46-56`, the three reads, one new function), `packages/db/src/index.ts:51-58` (the messaging export block gains `findConversationForContact`).
- Test: `packages/db/src/test/contacts.test.ts`, `packages/db/src/test/contact-import.test.ts`, `packages/db/src/test/messaging.test.ts` (one new `describe` each).
- Typed literals the typecheck lists after `ConversationSummary` gains two required fields: fix each with `holdsSharedNumber: false, sharedNumber: null`, never by loosening the type (read them off `pnpm --filter web typecheck`; expected among them `…/convos/conversation-list.test.ts` and the six `…/convos/page*.test.ts` fixtures, and `apps/web/src/app/api/accounts/[accountId]/search/route.test.ts`).

**Interfaces:**
- Consumes: 0098 (Task 1); `ensureHoldingContact` from Task 3, in its tests only.
- Produces: `CreateContactInput.matchBy`, the holding skip everywhere, `ConversationSummary.holdsSharedNumber` / `.sharedNumber`, `findConversationForContact` (exact code in "The model, `@bis/db` (Task 4)").

- [ ] **Step 1: Kit** on 55500/55501/55502 with PostgREST.
- [ ] **Step 2: Write the failing tests.** Each re-reads the stored rows; each seeds through `createContact`/`ensureHoldingContact`:
  - **`matchBy: "email_only"` (contacts.test.ts):**
    - With it, a contact with the same phone and no email match is NOT returned: a second `createContact({ firstName: "Beto", lastName: "Prueba", phone: P, matchBy: "email_only" })` after Ana's on P answers `existing: false` with a new id; re-read: two rows on P.
    - An email match still returns its contact: Ana with `ana@example.com` on P, then `{ firstName: "A", email: "ANA+x@example.com", phone: "+19565550199", matchBy: "email_only" }` → `{ id: ana, existing: true }`.
    - The new person and the phone match are filed for the merge queue as ONE pair, reason `phone_shared_new_person` (P29; re-read `contact_duplicate_flags`: one row, the two ids sorted; mutation: drop the flag → FAILS), and `flagged` is true.
    - No country-twin read on that path: Ana stored `+19565550170`, then `matchBy` with `+529565550170` → a new contact, no `phone_country_twin` flag and no `phone_shared_new_person` flag either: `+529565550170` keys `529565550170`, so the direct read misses Ana, and only the legacy read (skipped with `matchBy`) would have found her. Without `matchBy` the same pair files `phone_country_twin`: assert that too, so the case can fail.
    - Absent, every existing dedupe test passes unedited (run the file; paste the summary).
    - Second account: account B's contact with the same email is never returned for account A (mutation: drop `.eq("account_id", accountId)` from the EMAIL branch at `:268-269` → FAILS).
  - **The holding skip (contacts.test.ts):** on a number with Ana and the holding record (`ensureHoldingContact`):
    - `createContact({ phone: P })` with and without `matchBy` never returns the holding id (without `matchBy` it returns Ana; mutation: drop the filter at `:276-277` → FAILS).
    - With ONLY the holding record on P, `createContact({ phone: P })` makes a NEW contact (mutation: drop the filter → it returns the holding id, FAILS).
    - The legacy read (`:341-350`, reached only by an incoming +52 key with no direct match): the holding record on `+19565550171` (key `9565550171`) and nobody else on those digits; `createContact({ firstName: "Gil", phone: "+529565550171" })` → its legacy keys are `["9565550171", "5219565550171"]`, so without the filter the holding record is read, becomes `countryTwin`, and a `phone_country_twin` flag is filed against it. Assert `existing: false` and that no `contact_duplicate_flags` row names the holding id (mutation: drop the filter at `:342-343` → FAILS).
    - `updateContact` of Ana's phone to P (the post-write check) files no `phone_match_on_edit` pair with the holding id (mutation: drop the filter at `:413-414` → FAILS).
    - `flagMatchesOf(db, account, ana)` on P writes 0 pairs with the holding id (mutation: drop the filter at `:512-513` → FAILS).
    - `listContacts` and `countContacts` leave it out: with Ana and the holding record on the account, `countContacts` → 1 and `listContacts` ids → `[ana]`; with `search: "Caller"` → none (mutation: drop the filter from `countContacts` → the count FAILS; from `listContacts` → the list FAILS).
    - `getContact(holding)` reads `holds_shared_number: true` and `getContact(ana)` reads `false` (the `COLS` change; the record page's redirect reads it).
  - **`buildMatchIndex` (contact-import.test.ts):** with the holding record on P and no other contact, `byPhone.get(phoneDigits(P))` is `undefined` (mutation: drop the `continue` → FAILS); with Ana too, it is Ana's id.
  - **The inbox (messaging.test.ts):** a holding thread (`ensureHoldingContact`, `ensureConversation`, `createMessage`) and Ana's thread:
    - `listConversations` answers `holdsSharedNumber: true, sharedNumber: P` for the holding thread and `false, null` for Ana's; the same through `getConversationSummary` and `searchConversations` (search a word in the holding thread's message).
    - `listConversations` with `assignee: { kind: "unassigned" }` (read `AssigneeFilter` in `packages/db/src/assignment.ts` for the exact shape) still carries the fields (the `!inner` embed).
    - `findConversationForContact(db, A, holding)` → the holding thread's id; for a contact with no thread → null; account B asked about A's contact → null (mutation: drop `.eq("account_id", …)` → FAILS).
- [ ] **Step 3: Run to verify they fail** (on your replica + PostgREST), then **implement** the model's changes exactly, then **run to verify they pass**, then each named mutation (paste, revert, `cmp`).
- [ ] **Step 4: The typed literals** (`ConversationSummary`), then both typechecks.
- [ ] **Step 5: Commit** `db: a contact write can dedupe by email alone, and no dedupe, list, count, import match or inbox read ever treats a shared number's holding record as a customer (S-47e E7, E8)`, naming every path. Stop your kit.

**Verify (the affected-test rule):**
1. Mocks: `listContacts`/`countContacts` are mocked by name in web tests and keep their signatures; nothing to change. Run `apps/web/src/app/api/accounts/[accountId]/search/route.test.ts`, `[acct]/contacts/relationship-actions.test.ts`, `[acct]/contacts/page.test.ts` and `…/convos/conversation-list.test.ts` by path.
2. Prefix pins: none.
3. Pinned selects: `contacts.test.ts:895-901` stays green (both strings still in `contacts.ts`); `tasks-call-id-read.test.ts` untouched.
4. Bare factories: none for this task's new names (Task 12 adds `findConversationForContact` where it calls it).
5. e2e: none.
6. In-account service reads: none.
- On your replica + PostgREST: `contacts.test.ts`, `contact-import.test.ts`, `contact-import.business-link.test.ts`, `messaging.test.ts`, `voice.test.ts`, `server-only-writes-grants.test.ts`.

**Review (HIGH, opus, own worktree and kit on 55503–55505):** re-runs the four filter mutations and the `matchBy` email-branch mutation; reads every other `.from("contacts")` read in `packages/db/src` that could pick a contact for a person (`grep -n 'from("contacts")' packages/db/src/*.ts`) and lists any that can still return a holding record to a writer, with the spec §5.12.3 row it falls under or "not covered"; confirms `toRow` (`:128-163`) never reads `matchBy`.

---

## Task 5 (MEDIUM): The identity module and `CallState.identity` (bis-voice)

**Dispatch gate:** Task 3 committed (`candidates.ts` imports `listContactsOnNumber`; `match.ts` imports the barrel's `emailKey`).

**Files:**
- Create: `…/identity/ladder.ts`, `match.ts`, `state.ts`, `results.ts`, `candidates.ts`, `flow.ts`, each with its `*.test.ts`.
- Modify: `apps/web/src/lib/voice/call-state.ts` (`:12` `TakenMessage`; `:64-106` `CallState`; `:108-113` `emptyCallState`), `apps/web/src/lib/voice/call-state.test.ts` (one case).

**Interfaces:** exactly "The model, The identity module (Task 5)". Produces every export there for Tasks 6, 7, 8, 10 and 14.

**The plan writer's check (2026-10-24, first round):** the six code blocks of "The model" (these five files plus Task 7's `record.ts`) were extracted into a throwaway `apps/web/src/lib/voice/zzid/` and run against a probe of every example: `Tests 6 passed (6)`; with the model's `call-state.ts`, `pnpm --filter web typecheck` exited 0; both were removed (`cp` + `cmp` restored `call-state.ts`). The fix round changed `match.ts` (P25, P26, P28), `results.ts`, `state.ts`, `flow.ts`'s lookup and `record.ts` (P27) without re-running that probe: the cases below, red first, are their proof.

- [ ] **Step 1: Write the failing tests.** Literal fixtures, literal expectations; each named mutation must turn the WHOLE file red.
  - `ladder.test.ts`:
    - All twelve cells as one typed-out table: `[["read_existing", null, 1], ["change_existing", null, 1], ["book_new", null, 0], ["leave_message", null, 0], ["read_existing", "events", 1], ["change_existing", "events", 1], ["book_new", "events", 0], ["leave_message", "events", 0], ["read_existing", "insurance_pc", 2], ["change_existing", "insurance_pc", 2], ["book_new", "insurance_pc", 0], ["leave_message", "insurance_pc", 0]]`; assert the table's length is 12 first (mutation: insurance read → 1 FAILS).
    - An id this build does not know reads as no pack: `"constructor"`, `"toString"`, `"plumbing"` → the no-pack row (mutation: drop `Object.hasOwn` → `"constructor"` FAILS).
    - No cell anywhere is 3.
  - `match.test.ts`:
    - `nameWords`: `"María Elena García López"` → `["maria", "elena", "garcia", "lopez"]`; `"O'Brien García-López Muñoz"` → `["obrien", "garcia", "lopez", "munoz"]`; `"  José   "` → `["jose"]`.
    - Against the record "María Elena" / "García López": `"María García"`, `"María Elena García"`, `"María García López"`, `"maria lopez"` match; `"Elena García"` (rule 2), `"María García Pérez"` (rule 3: a word not on record) do not.
    - Rule 3's own probe (P5): `"María López García"` does not match (mutation: drop rule 3's order, e.g. match by set membership → FAILS).
    - Rule 4's own probe (P5): against the record "María" / "de la Cruz", `"María de"` does not match and `"María Cruz"` does (mutation: drop rule 4 → `"María de"` FAILS).
    - The voice-created split: the record "María García" / "López" (first name "María García", `registry.ts:444-446`'s split) is matched by `"María López"`.
    - A one-word record ("Dan" / null) and a "Caller" placeholder never match `"Caller Prueba"` or `"Dan Lopez"` (rule 1).
    - `nameMatch` kinds (P26): `"María Elena García López"` against itself → `"exact"`; `"María García"` against it → `"partial"`; `"María García López"` against the record "María" / "García" → `"partial"` (every record word spoken; mutation: drop the record-in-spoken direction → FAILS).
    - `nameHits` prefers exact (P26): father "José Luis" / "Garza" and son "José" / "Garza": `"José Garza"` → `[son]`; `"José Luis Garza"` → `[father]` (mutation: exact and partial pooled → `"José Garza"` hits both, FAILS); two partial hits ("Ana Prueba" against "Ana María Prueba" and "Ana Lucía Prueba") → both.
    - `spokenEmail`: `"ana dot garcia at gmail dot com"` → `"ana.garcia@gmail.com"`; `"ana punto garcia arroba gmail punto com"` → the same; `"A N A @ x . com"` → `"ana@x.com"`; `"ana guion bajo garcia arroba gmail punto com"` → `"ana_garcia@gmail.com"`; `"ana guión bajo b arroba x punto com"` → `"ana_b@x.com"`; `"ana plus bis at gmail dot com"` and `"ana más bis arroba gmail punto com"` → `"ana+bis@gmail.com"`; the dash words (P28), each its own case: `"ana guion medio b arroba x punto com"` → `"ana-b@x.com"`, `"ana guión b arroba x punto com"` → `"ana-b@x.com"`, `"ana guion bajo b arroba x punto com"` → `"ana_b@x.com"` (mutation: read "guion" before the pairs → `"ana-bajob@x.com"`, FAILS), `"ana raya b arroba x punto com"` → `"ana-b@x.com"`; `"dottie@x.com"` → `"dottie@x.com"` (an address with "@" is never word-mapped); `"ana at gmail"` → `null`.
    - `spokenEmailKey("Ana+bis@Gmail.com")` → `"ana@gmail.com"`; and it equals `emailKey` from `@bis/db` on five literal addresses (parity: the one rule, never a copy).
    - `decideIdentity`, every row of spec §5.3's table as amended, with candidates Ana (`"ana@x.com"`), Beto (no email): none (`[]` → `{ kind: "none" }`); truncated → cannot; rung 1 one candidate and NO name → confirmed caller_id; rung 1 one candidate (Ana) and `"Carla Prueba"` → miss (P25; mutation: the sole row ignores the name → FAILS); rung 1 one candidate and `"Ana Prueba"` → confirmed by name; rung 1 one candidate and `"Ana"` → ask_name; rung 2 no email anywhere → cannot; one-word name → ask_name; rung 2 no email given → ask_email; rung 2 malformed email (`"ana at x"`) → ask_email; rung 1 name picks one → confirmed rung 1 by name; rung 1 name matches none → miss; the same-name pair (two "Ana Prueba", emails `ana@x.com`, `ana2@x.com`): no email → ask_email, `"ana2@x.com"` → confirmed `a2` rung 2 by name_email, `"zed@x.com"` → miss; two "Ana Prueba" with NO email → miss; rung 2 name and email match exactly one → confirmed rung 2; rung 2 two records matching name AND email → miss (S4).
  - `state.test.ts`: `withLeadWhoseAsked` sets `leadWhoseAsked` and leaves the rest; `withMiss` once → `misses: 1, locked: null`; twice → `locked: "misses"` (mutation: `MAX_MISSES` 3 → FAILS); `withLocked(…, "cannot")` then `withLocked(…, "misses")` keeps `"cannot"`; `confirmedFor` true at the rung and above, false for another contact, false for rung 2 asked of a rung-1 confirmation, false for rung 3; `withMessageNameAsked` sets the flag; every helper returns a NEW state and leaves the old one unchanged.
  - `results.test.ts`: every constant and builder of `results.ts` deep-equal to the object typed out AGAIN in the test (copy the strings from "The model"; the test file must not import them to build its expectation). The three builders with `next = "offer to take a message with take_message"`. No string value in any result holds a `{word}` template marker (`/\{[A-Za-z]+\}/`) or "Sofía".
  - `candidates.test.ts`: `realCandidates` over five literal rows on `+19562921696`: an E.164 contact (in), a legacy `"(956) 292-1696"` contact (in), the holding record (out; mutation: drop `!r.holds_shared_number` → FAILS), a `"+529562921696"` contact (out: another number with the same ten digits; mutation: drop the `isCallerIdNumber` filter → FAILS), a `null` phone (out). `isShared`: 1 real → false; 2 → true; 1 real and truncated → true. `readCandidates` (with `@bis/db` mocked spread-real and `listContactsOnNumber` overridden) passes ITS OWN `accountId` and `e164` through (call it with `"a2"`; mutation: a fixed id → FAILS).
  - `flow.test.ts` (states built from `emptyCallState()`; `next` = `"NEXT"`):
    - `findStep`: two candidates rung 1 → `ASK_NAME`, state unchanged, no event; rung 2 with an email on file → `ASK_NAME_AND_EMAIL`; one candidate rung 1 → `lookup` of it with `by: "caller_id"`, event `"confirmed rung 1 by caller-id"`, state confirmed by `caller_id`; a state confirmed by name → `lookup` with `by: "name"` (the registry adds `FOUND_BY_NAME_NEXT` on it); truncated → `CANNOT`, locked `"cannot"`, event `"locked (cannot)"`; read failed → `readFailed("NEXT")`, event `"read failed"`, misses 0; confirmed at the rung → `lookup` with NO read needed (`findNeedsRead` false); confirmed at rung 1 on an insurance call → `findNeedsRead` true and `ASK_NAME_AND_EMAIL`; locked → `LOCKED` (misses) or `CANNOT` (cannot).
    - `confirmStep`: Beto by name → `CONFIRMED`, event `"confirmed rung 1 by name"`; then Ana → confirmed REPLACED by Ana (S7); `"Carla Prueba"` → `MISS`, event `"miss 1"`, then again → `LOCKED`, event `"locked (misses)"`; a name miss and an email miss on an insurance call are `toEqual` each other AND the typed-out MISS object (E5); `"Ana"` → `ASK_NAME_AGAIN`, misses 0; rung 2 with no email → `ASK_EMAIL`, misses 0; read failed → `readFailed`, misses 0 (S5); no candidate at all → a miss (counts as a try).
    - `ownsStep`: a booking made on this call → owned even with nothing confirmed and no caller ID; locked → `lockedResult`; confirmed this contact, rung met, phone is the caller ID (typed `"(956) 292-1696"` included) → owned; phone no longer the caller ID → `NOT_CONFIRMED_YET`; nothing confirmed → `NOT_CONFIRMED_YET`; confirmed this contact at rung 1, rung 2 required → `NOT_CONFIRMED_YET` (P7); confirmed ANOTHER contact → `notTheirs("NEXT")`.
    - `messageNeedsNameCheck` / `messageNameStep`: no caller ID → false; confirmed → false; `name: "Ana Prueba"` → false; `nameDeclined: true` → false; already asked → false; otherwise true. Two real candidates → the refusal, with `messageNameAsked` set; one → null; truncated → the refusal; a failed read → null.
  - `call-state.test.ts`: `emptyCallState().identity` toEqual `{ confirmed: null, misses: 0, locked: null, messageNameAsked: false, leadWhoseAsked: false }`, and two calls return two different objects.
- [ ] **Step 2: Run to verify they fail** (`pnpm --filter web exec vitest run src/lib/voice/identity src/lib/voice/call-state.test.ts` → missing modules). Paste the summary line.
- [ ] **Step 3: Implement** the model's code exactly.
- [ ] **Step 4: Run to verify they pass**, then each named mutation (paste, revert, `cmp`).
- [ ] **Step 5: Commit** `voice: the identity ladder, the name and email rules, the per-call identity and the fixed sentences, in one pure module the live tools and the corpus share (S-47e)`, naming every path.

**Verify (the affected-test rule):**
1. Mocks: `CallState` gains a required field: every test that builds a state spreads `emptyCallState()` (grep for a hand-built literal: `grep -rn "callerItemIds: \[\]" apps/web/src --include=*.ts` → only `call-state.ts`, read 2026-10-24). Run `src/lib/voice/call-events.test.ts`, `src/lib/voice/summarize.test.ts`, `src/lib/voice/call-card.test.ts`, `src/lib/voice/language.test.ts` and `src/app/api/voice/incoming/lifecycle.test.ts` by path (they read `CallState`).
2. Prefix pins: none. 3. Pinned selects: none. 4. Bare factories: none (nothing calls the module yet). 5. e2e: none. 6. In-account service reads: run it (`lib/voice/identity/*.ts` must not be listed: `serviceDb` is a type there).
- `grep -nE "from ['\"]@/" apps/web/src/lib/voice/identity/*.ts` → nothing. `system-prompt.test.ts` green. Typecheck; eslint.

**Review (MEDIUM, sonnet, own worktree):** checks every literal in `results.ts` against spec §5.4.4 character by character (including the `¿`, the accents and the straight quotes); that no file in `…/identity/` imports `@/…`; that `decideIdentity` follows the table's order; and that `nameMatches` cannot be satisfied by a substring of a word.

---

## Task 6 (HIGH): The gate — `find_my_booking`, `confirm_identity`, the ownership check, the schemas (bis-voice, opus)

**Dispatch gate:** Tasks 5 and 13 committed.

**Files:**
- Modify: `…/tools/registry.ts` (`:2-11` imports, `:37-41` `ToolName`, `:49-67` `ToolContext`, `:71-73` `MANAGE_TOOLS`, `:96-136` `checkCallerOwnsBooking`, `:306-329` `find_my_booking`, a new `confirm_identity` case after it, `:582-583`, `:712-713`), `…/tools/schemas.ts:6-26`, `…/incoming/route.ts:1266-1271` (one property).
- Modify (P17): `packages/db/src/voice.ts:932-947` (delete `findUpcomingBookingForPhone`), `packages/db/src/test/voice.test.ts` (delete its import at `:14` and its test at `:197-217`).
- Test: `…/tools/registry.test.ts`, `…/tools/schemas.test.ts`.

**Interfaces:**
- Consumes: Task 3's `findUpcomingBookingForContact`; Task 5's `requiredRung`, `readCandidates`, `findNeedsRead`, `findStep`, `confirmStep`, `ownsStep`, `isLocked`, `lockedResult`, `noCallerId`, `CandidateRead`, `ToolResult`.
- Produces: `ToolName` with `"confirm_identity"`; `ToolContext.tradeModule: TradeModuleId | null`.

- [ ] **Step 1: The existing tests move first** (red against today's code where a line says so). Line numbers are `registry.test.ts` at `df8882ce`, BEFORE any other edit in this task; do these first, top to bottom.
  - `:15` `findUpcomingBookingForPhone: vi.fn(),` → `listContactsOnNumber: vi.fn(), findUpcomingBookingForContact: vi.fn(),`.
  - `ctx` (`:79-91`) gains `tradeModule: null,` after `handoffTarget`.
  - The `beforeEach` (`:97-111`) gains, after `dbMocks.serviceDb.mockReturnValue({});`: `dbMocks.listContactsOnNumber.mockResolvedValue({ rows: [], truncated: false });`.
  - After `ctx`, two helpers (and `import { withConfirmed } from "../identity/state";` beside `:76`'s `emptyCallState` import):
    ```ts
    /** S-47e: a call that has confirmed this contact, the state find_my_booking or confirm_identity leaves (Task 6). */
    const owns = (contactId = "ct1", rung: 1 | 2 = 1) => withConfirmed(emptyCallState(), { contactId, rung, by: "caller_id" });
    /** The caller ID's one contact (ct1) with this upcoming booking, through the two reads that replaced the household one. */
    const ONE_ON_NUMBER = { id: "ct1", first_name: "Ana", last_name: "Ruiz", phone: "+19562921696", email_key: null, holds_shared_number: false };
    function onNumber(hit: { bookingId: string; startsAt: string } | null) {
      dbMocks.listContactsOnNumber.mockResolvedValue({ rows: [ONE_ON_NUMBER], truncated: false });
      dbMocks.findUpcomingBookingForContact.mockResolvedValue(hit);
    }
    ```
  - Every `dbMocks.findUpcomingBookingForPhone.mockResolvedValue(X)` (9: `:161`, `:172`, `:186`, `:196`, `:212`, `:238`, `:243`, `:1623`, `:1629`) → `onNumber(X)`.
  - Every `expect(dbMocks.findUpcomingBookingForPhone).toHaveBeenCalledWith({}, "a1", "+19562921696", expect.any(String));` (2: `:163`, `:198`) → `expect(dbMocks.listContactsOnNumber).toHaveBeenCalledWith({}, "a1", "+19562921696"); expect(dbMocks.findUpcomingBookingForContact).toHaveBeenCalledWith({}, "a1", "ct1", expect.any(String));`.
  - Every `expect(dbMocks.findUpcomingBookingForPhone).not.toHaveBeenCalled();` (5: `:175`, `:189`, `:207`, `:216`, `:1642`) → `expect(dbMocks.listContactsOnNumber).not.toHaveBeenCalled(); expect(dbMocks.findUpcomingBookingForContact).not.toHaveBeenCalled();`. (`grep -c findUpcomingBookingForPhone` must then print `0`; it printed 17 = 1 + 9 + 2 + 5.)
  - **The move/cancel tests that change an existing booking now need a confirmation (S9, SD9).** Their state argument changes, nothing else:
    - `runTool(emptyCallState(),` → `runTool(owns(),` on these 37 lines: `:745`, `:768`, `:784`, `:811`, `:830`, `:862`, `:880`, `:911`, `:947`, `:959`, `:973`, `:984`, `:1212`, `:1247`, `:1306`, `:1333`, `:1361`, `:1372`, `:1386`, `:1396`, `:1397`, `:1426`, `:1463`, `:1483`, `:1485`, `:1750`, `:1764`, `:1769`, `:1783`, `:1797`, `:1810`, `:1814`, `:1829`, `:1835`, `:1870`, `:1885`, `:1897` (each of these 44 lines was read for this plan and holds `emptyCallState()`; the SITES and G1 tables at `:1810`-`:1897` include `book_appointment` sites, which a confirmation does not change).
    - `{ ...emptyCallState(),` → `{ ...owns(),` at `:932`, `:1259`, `:1286`.
    - "bound to the caller ID" (`:1020-1184`): `:1071` and `:1083` `const pre = emptyCallState();` → `const pre = owns("ct1");` (a DIFFERENT contact is confirmed), and `:1074` and `:1085`'s `/isn't under the number they're calling from/` → `/isn't one they have confirmed is theirs/`; `:1094` and `:1101` `runTool(emptyCallState(), ctx,` → `runTool(owns("ct2"), ctx,` (the typed `"(956) 292-1696"` still matches: the kept second check). Every other test in that describe keeps `emptyCallState()`: the withheld-caller-ID ones (`toMatchObject({ ok: false })`, now NOT CONFIRMED YET), the made-on-this-call ones, and the two throwing-lookup ones (the contact read stays first, so they refuse before any identity step).
    - Not changed: `:817` (unknown booking, refused before ownership), `:1129`, `:1638` (the mode guard).
  - Run the file against TODAY's code: the 9 + 2 + 5 lines fail on `listContactsOnNumber`/`findUpcomingBookingForContact` never being called (red first); the rest stay green. Paste the summary line.
- [ ] **Step 2: Write the new failing tests** (append to `registry.test.ts`):

```ts
import { ASK_NAME, ASK_NAME_AND_EMAIL, ASK_EMAIL, CONFIRMED, MISS, LOCKED, CANNOT, NOT_CONFIRMED_YET, FOUND_BY_NAME_NEXT, readFailed } from "../identity/results";
// (results.test.ts pins every one of these word for word; here they say WHICH answer the tool gave.)

describe("S-47e: whose appointment it is (plan Task 6)", () => {
  const ANA = { id: "ct1", first_name: "Ana", last_name: "Prueba", phone: "+19562921696", email_key: "ana@example.com", holds_shared_number: false };
  const BETO = { id: "ct2", first_name: "Beto", last_name: "Prueba", phone: "(956) 292-1696", email_key: null, holds_shared_number: false };
  const HOLDING = { id: "ct9", first_name: "Caller", last_name: null, phone: "+19562921696", email_key: null, holds_shared_number: true };
  const HIT = { bookingId: "b9", startsAt: "2027-06-03T14:00:00Z" };
  const insurance: ToolContext = { ...ctx, tradeModule: "insurance_pc" };
  const on = (...rows: object[]) => dbMocks.listContactsOnNumber.mockResolvedValue({ rows, truncated: false });
  beforeEach(() => { dbMocks.findUpcomingBookingForContact.mockResolvedValue(HIT); });

  it("one contact (a holding record is nobody): no name asked, and the lookup is that contact's", async () => {
    on(ANA, HOLDING);
    const { state, result } = await runTool(emptyCallState(), ctx, "find_my_booking", {});
    expect(result).toMatchObject({ found: true, bookingId: "b9" });
    expect(dbMocks.findUpcomingBookingForContact).toHaveBeenCalledWith({}, "a1", "ct1", expect.any(String));
    expect(state.identity.confirmed).toEqual({ contactId: "ct1", rung: 1, by: "caller_id" });
  });

  it("two contacts: ASK NAME, and nothing of theirs is in it (mutation: put a candidate's name in the result -> FAILS)", async () => {
    on(ANA, BETO);
    const { state, result } = await runTool(emptyCallState(), ctx, "find_my_booking", {});
    expect(result).toEqual(ASK_NAME);
    for (const detail of ["Ana", "Beto", "Prueba", "ana@example.com", "956", "292", "1696", "ct1", "ct2"]) {
      expect(JSON.stringify(result)).not.toContain(detail);
    }
    expect(dbMocks.findUpcomingBookingForContact).not.toHaveBeenCalled();
    expect(state.identity).toEqual({ confirmed: null, misses: 0, locked: null, messageNameAsked: false });
  });

  it("confirm Beto, then find: the lookup is Beto's only, and the found result says to confirm anyone else first; confirming Ana afterwards replaces him (S7, P25)", async () => {
    on(ANA, BETO);
    const c1 = await runTool(emptyCallState(), ctx, "confirm_identity", { fullName: "Beto Prueba" });
    expect(c1.result).toEqual(CONFIRMED);
    const f1 = await runTool(c1.state, ctx, "find_my_booking", {});
    expect(f1.result).toMatchObject({ found: true, bookingId: "b9", next: FOUND_BY_NAME_NEXT });
    expect(dbMocks.findUpcomingBookingForContact.mock.calls.map((c) => c[2])).toEqual(["ct2"]);
    const c2 = await runTool(c1.state, ctx, "confirm_identity", { fullName: "Ana Prueba" });
    await runTool(c2.state, ctx, "find_my_booking", {});
    expect(dbMocks.findUpcomingBookingForContact.mock.calls.map((c) => c[2])).toEqual(["ct2", "ct1"]);
  });

  it("a found result confirmed by the caller ID alone (one contact) carries no note", async () => {
    on(ANA);
    const { result } = await runTool(emptyCallState(), ctx, "find_my_booking", {});
    expect(result).toMatchObject({ found: true });
    expect(result).not.toHaveProperty("next");
  });

  it("a name that is not the one contact on the number confirms nobody (P25; mutation: the sole-candidate row ignores the name -> FAILS)", async () => {
    on(ANA);
    const { state, result } = await runTool(emptyCallState(), ctx, "confirm_identity", { fullName: "Carla Prueba" });
    expect(result).toEqual(MISS);
    expect(state.identity.confirmed).toBeNull();
  });

  it("two misses lock; a third confirm_identity makes no read (mutation: no lock -> FAILS)", async () => {
    on(ANA, BETO);
    const m1 = await runTool(emptyCallState(), ctx, "confirm_identity", { fullName: "Carla Prueba" });
    const m2 = await runTool(m1.state, ctx, "confirm_identity", { fullName: "Carla Prueba" });
    const m3 = await runTool(m2.state, ctx, "confirm_identity", { fullName: "Ana Prueba" });
    expect([m1.result, m2.result, m3.result]).toEqual([MISS, LOCKED, LOCKED]);
    expect(dbMocks.listContactsOnNumber).toHaveBeenCalledTimes(2);
  });

  it("while locked: find, reschedule and cancel answer LOCKED; a booking made on this call can still be cancelled (S18)", async () => {
    on(ANA, BETO);
    const m1 = await runTool(emptyCallState(), ctx, "confirm_identity", { fullName: "Carla Prueba" });
    const locked = (await runTool(m1.state, ctx, "confirm_identity", { fullName: "Carla Prueba" })).state;
    dbMocks.getBookingById.mockResolvedValue({ id: "b1", contact_id: "ct1", calendar_id: "cal1", starts_at: "2027-06-01T14:00:00Z", ends_at: "2027-06-01T15:00:00Z", status: "booked" });
    dbMocks.getContact.mockResolvedValue({ id: "ct1", first_name: "Ana", last_name: "Prueba", email: null, phone: "+19562921696" });
    expect((await runTool(locked, ctx, "find_my_booking", {})).result).toEqual(LOCKED);
    expect((await runTool(locked, ctx, "cancel_appointment", { bookingId: "b1" })).result).toEqual(LOCKED);
    expect((await runTool(locked, ctx, "reschedule_appointment", { bookingId: "b1", startsAt: "2027-06-02T14:00:00.000Z" })).result).toEqual(LOCKED);
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
    const madeHere = { ...locked, bookings: [{ id: "b1", contactName: "Ana", startsAt: "x", endsAt: "y", status: "booked" as const }] };
    dbMocks.setBookingStatus.mockResolvedValue({ updatedAt: "2027-05-31T09:00:00.000Z" });
    dbMocks.ensureConversation.mockResolvedValue({ id: "cv1", created: false });
    dbMocks.createMessage.mockResolvedValue({ id: "m1" });
    expect((await runTool(madeHere, ctx, "cancel_appointment", { bookingId: "b1" })).result).toEqual({ ok: true });
  });

  it("a locked call can still book, take a message, and move the booking it made (spec 7, S18; R10)", async () => {
    on(ANA, BETO);
    const m1 = await runTool(emptyCallState(), ctx, "confirm_identity", { fullName: "Carla Prueba" });
    const locked = (await runTool(m1.state, ctx, "confirm_identity", { fullName: "Carla Prueba" })).state;
    expect(locked.identity.locked).toBe("misses");
    const slot = { startsAt: new Date("2027-06-02T14:00:00Z"), endsAt: new Date("2027-06-02T15:00:00Z") };
    const later = { startsAt: new Date("2027-06-02T16:00:00Z"), endsAt: new Date("2027-06-02T17:00:00Z") };
    computeAllSlotsMock.mockResolvedValue([slot, later]);
    dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: true });
    dbMocks.getContact.mockResolvedValue({ id: "ct1", first_name: "Ana", last_name: "Prueba", email: null, phone: "+19562921696" });
    dbMocks.fillContactBlanksReport.mockResolvedValue({ fields: [], flagged: false, prior: {}, written: {} });
    dbMocks.createBooking.mockResolvedValueOnce({ id: "bk1", cancelToken: "t1" }).mockResolvedValueOnce({ id: "bk2", cancelToken: "t2" });
    const booked = await runTool(locked, ctx, "book_appointment", { startsAt: slot.startsAt.toISOString(), name: "Ana Prueba", emailDeclined: true });
    expect(booked.result).toMatchObject({ ok: true, bookingId: "bk1" });
    const msg = await runTool(booked.state, ctx, "take_message", { body: "Please call me", name: "Ana Prueba" });
    expect(msg.result).toEqual({ ok: true });
    dbMocks.getBookingById.mockResolvedValue({ id: "bk1", contact_id: "ct1", calendar_id: "cal1", starts_at: slot.startsAt.toISOString(), ends_at: slot.endsAt.toISOString(), status: "booked" });
    dbMocks.setBookingStatus.mockResolvedValue({ updatedAt: "2027-05-31T09:00:00.000Z" });
    dbMocks.ensureConversation.mockResolvedValue({ id: "cv1", created: false });
    dbMocks.createMessage.mockResolvedValue({ id: "m1" });
    const moved = await runTool(msg.state, ctx, "reschedule_appointment", { bookingId: "bk1", startsAt: later.startsAt.toISOString() });
    expect(moved.result).toMatchObject({ ok: true, bookingId: "bk2" });
    expect(moved.state.identity.locked).toBe("misses");
  });

  it("a failed candidate read is READ FAILED and not a try", async () => {
    dbMocks.listContactsOnNumber.mockRejectedValue(new Error("db blip"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { state, result } = await runTool(emptyCallState(), ctx, "confirm_identity", { fullName: "Ana Prueba" });
    err.mockRestore();
    expect(result).toEqual(readFailed("offer to take a message with take_message"));
    expect(state.identity.misses).toBe(0);
  });

  it("insurance: a name alone gets ASK EMAIL; the name and email confirm at rung 2; with no email on file it is CANNOT and locks", async () => {
    on(ANA, BETO);
    expect((await runTool(emptyCallState(), insurance, "find_my_booking", {})).result).toEqual(ASK_NAME_AND_EMAIL);
    expect((await runTool(emptyCallState(), insurance, "confirm_identity", { fullName: "Ana Prueba" })).result).toEqual(ASK_EMAIL);
    const ok = await runTool(emptyCallState(), insurance, "confirm_identity", { fullName: "Ana Prueba", email: "ana at example dot com" });
    expect(ok.result).toEqual(CONFIRMED);
    expect(ok.state.identity.confirmed).toEqual({ contactId: "ct1", rung: 2, by: "name_email" });
    on(BETO);
    const cannot = await runTool(emptyCallState(), insurance, "find_my_booking", {});
    expect(cannot.result).toEqual(CANNOT);
    expect(cannot.state.identity.locked).toBe("cannot");
  });

  it("move or cancel before any confirmation: NOT CONFIRMED YET, nothing written (S9; mutation: today's caller-ID-only rule -> FAILS)", async () => {
    dbMocks.getBookingById.mockResolvedValue({ id: "b1", contact_id: "ct1", calendar_id: "cal1", starts_at: "2027-06-01T14:00:00Z", ends_at: "2027-06-01T15:00:00Z", status: "booked" });
    dbMocks.getContact.mockResolvedValue({ id: "ct1", first_name: "Ana", last_name: "Prueba", email: null, phone: "+19562921696" });
    for (const [name, args] of [["cancel_appointment", { bookingId: "b1" }], ["reschedule_appointment", { bookingId: "b1", startsAt: "2027-06-02T14:00:00.000Z" }]] as const) {
      expect((await runTool(emptyCallState(), ctx, name, args)).result, name).toEqual(NOT_CONFIRMED_YET);
    }
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
    expect(dbMocks.createBooking).not.toHaveBeenCalled();
  });

  it("a rung-1 confirmation on an insurance call cannot move the booking (P7; mutation: ignore the rung -> FAILS)", async () => {
    dbMocks.getBookingById.mockResolvedValue({ id: "b1", contact_id: "ct1", calendar_id: "cal1", starts_at: "2027-06-01T14:00:00Z", ends_at: "2027-06-01T15:00:00Z", status: "booked" });
    dbMocks.getContact.mockResolvedValue({ id: "ct1", first_name: "Ana", last_name: "Prueba", email: null, phone: "+19562921696" });
    expect((await runTool(owns("ct1", 1), insurance, "cancel_appointment", { bookingId: "b1" })).result).toEqual(NOT_CONFIRMED_YET);
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
  });

  it("no caller ID: confirm_identity is refused and reads nothing; a recited other number is still refused by find", async () => {
    const r = await runTool(emptyCallState(), { ...ctx, callerNumber: null }, "confirm_identity", { fullName: "Ana Prueba" });
    expect(r.result).toMatchObject({ ok: false, confirmed: false, error: expect.stringMatching(/no visible caller number/) });
    expect(dbMocks.listContactsOnNumber).not.toHaveBeenCalled();
    const f = await runTool(emptyCallState(), ctx, "find_my_booking", { phone: "(956) 555-0100" });
    expect(f.result).toMatchObject({ found: false, verified: false });
    expect(dbMocks.listContactsOnNumber).not.toHaveBeenCalled();
  });

  it("a line with booking off refuses confirm_identity, reading nothing", async () => {
    const off: ToolContext = { ...ctx, profile: { booking_enabled: false, after_hours: "hours_then_message" } as unknown as VoiceProfileRow };
    expect((await runTool(emptyCallState(), off, "confirm_identity", { fullName: "Ana Prueba" })).result).toMatchObject({ ok: false });
    expect(dbMocks.listContactsOnNumber).not.toHaveBeenCalled();
  });

  it("every read is the context's own account (second account; mutation: a fixed account id in a read -> FAILS)", async () => {
    on(ANA, BETO);
    const a2: ToolContext = { ...ctx, accountId: "a2" };
    const c = await runTool(emptyCallState(), a2, "confirm_identity", { fullName: "Ana Prueba" });
    await runTool(c.state, a2, "find_my_booking", {});
    expect(dbMocks.listContactsOnNumber.mock.calls.map((x) => x[1])).toEqual(["a2"]);
    expect(dbMocks.findUpcomingBookingForContact.mock.calls.map((x) => x[1])).toEqual(["a2"]);
  });

  it("logs one identity line per event, by call row, with no name, email or number", async () => {
    on(ANA, BETO);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const rowCtx: ToolContext = { ...ctx, callRowId: "call-7" };
    const m1 = await runTool(emptyCallState(), rowCtx, "confirm_identity", { fullName: "Carla Prueba" });
    await runTool(m1.state, rowCtx, "confirm_identity", { fullName: "Carla Prueba" });
    const lines = log.mock.calls.map((x) => String(x[0])).filter((l) => l.startsWith("voice identity"));
    log.mockRestore();
    expect(lines).toEqual(["voice identity call-7: miss 1", "voice identity call-7: locked (misses)"]);
  });
});
```
  And in `schemas.test.ts`, one `describe("S-47e: confirm_identity (plan Task 6)")`:
  - `confirm_identity` is in `toolSchemas("full", mt, false)` for all three meeting types and in `"manage"`, and NOT in `"none"`;
  - its `parameters` is `{ type: "object", properties: { fullName: { type: "string", description: "First and last name, as the caller said it." }, email: { type: "string", description: "Only when asked for. The address as confirmed, with @ and . symbols." } }, required: ["fullName"] }` (deep-equal, typed out);
  - its description is the literal of Step 4 below (typed out) and matches `/never suggest, guess or spell/` and `/whenever the caller asks about a different person's appointment than the one already confirmed/` (P25);
  - `find_my_booking`'s description is `"Find the caller's upcoming booking by the number they are calling from. It cannot look up any other number. If it asks you to confirm who they are, ask for exactly what it says, call confirm_identity, then call find_my_booking again."` (typed out; the existing `:73-81` pins stay green);
  - the existing "video variant touches ONLY book_appointment" case (`:37-45`) stays green with the new tool in the list.
- [ ] **Step 3: Run to verify they fail** (`pnpm --filter web exec vitest run src/lib/voice/tools`) and paste the summary.
- [ ] **Step 4: Implement.**
  - `registry.ts` imports: `findUpcomingBookingForPhone` → `findUpcomingBookingForContact` in the `@bis/db` block; then
    ```ts
    import type { TradeModuleId } from "../modules";
    import { requiredRung } from "../identity/ladder";
    import { readCandidates } from "../identity/candidates";
    import { findNeedsRead, findStep, confirmStep, ownsStep, type CandidateRead } from "../identity/flow";
    import { isLocked } from "../identity/state";
    import { lockedResult, noCallerId, FOUND_BY_NAME_NEXT, type ToolResult } from "../identity/results";
    ```
  - `ToolName` gains `| "confirm_identity"`. `MANAGE_TOOLS` gains `"confirm_identity"`. `ToolContext` gains, after `handoffTarget`:
    ```ts
      /** S-47e (S15): the trade module this call runs under, the route's own `tradeStamp?.module ?? null` (the
       *  value that stamped the row and built the prompt). Decides the identity rung (identity/ladder.ts). */
      tradeModule: TradeModuleId | null;
    ```
  - Two module-private helpers above `runTool`:
    ```ts
    /** S-47e (spec 5.9): one line per identity event, by the call row id; never a name, an email or a number. */
    function logIdentity(ctx: ToolContext, event: string | null): void {
      if (event) console.log(`voice identity ${ctx.callRowId ?? "(no row)"}: ${event}`);
    }
    /** Who is on the caller ID. A failed read is { ok: false }: nothing confirmed, not a try (spec S5). */
    async function readOnCallerId(ctx: ToolContext): Promise<CandidateRead> {
      try {
        return { ok: true, ...(await readCandidates(ctx.db, ctx.accountId, ctx.callerNumber!)) };
      } catch (e) {
        console.error(`voice identity ${ctx.callRowId ?? "(no row)"}: candidate read failed: ${String(e)}`);
        return { ok: false };
      }
    }
    ```
  - `checkCallerOwnsBooking` (`:114-136`) becomes (its doc comment `:96-113` rewritten to say: made on this call, or confirmed on this call at the pack's rung AND the contact's stored phone is the caller ID; the contact is still read once, first, failing closed):
    ```ts
    async function checkCallerOwnsBooking(
      state: CallState, ctx: ToolContext, tool: "cancel" | "reschedule",
      bookingId: string, contactId: string,
    ): Promise<{ owned: true; contact: BookingContact | null } | { owned: false; result: ToolResult }> {
      let contact: BookingContact | null;
      try {
        contact = (await getContact(ctx.db, ctx.accountId, contactId)) as BookingContact | null;
      } catch (e) {
        console.error(`voice ${tool} ${bookingId}: contact lookup failed, nothing changed: ${String(e)}`);
        return { owned: false, result: { ok: false, error:
          "The appointment couldn't be checked right now, so nothing was changed. "
          + `Apologize, then ${nextStep(ctx)} so the team can help.` } };
      }
      const verdict = ownsStep(state, requiredRung("change_existing", ctx.tradeModule),
        { bookingId, contactId, contactPhone: contact?.phone, callerNumber: ctx.callerNumber }, nextStep(ctx));
      return verdict.owned ? { owned: true, contact } : { owned: false, result: verdict.result };
    }
    ```
    and its two callers (`:583`, `:713`): `if (!owner.owned) return { state, result: owner.result };`.
  - `find_my_booking` (`:319-328`, after its two unchanged refusals):
    ```ts
      const required = requiredRung("read_existing", ctx.tradeModule);
      const step = findStep(state, required, findNeedsRead(state, required) ? await readOnCallerId(ctx) : null, nextStep(ctx));
      logIdentity(ctx, step.event);
      if (step.kind === "answer") return { state: step.state, result: step.result };
      const hit = await findUpcomingBookingForContact(ctx.db, ctx.accountId, step.contactId, now.toISOString());
      // `found: false` is NOT served (unchanged reasoning, above).
      if (!hit) return { state: step.state, result: { found: false } };
      return { state: withServed(step.state, "booking_found"), result: {
        found: true, ...hit,
        startsAtLocal: formatWhen(new Date(hit.startsAt), ctx.timezone),
        // P25: a confirmation that came from a name says to confirm anyone else before looking again.
        ...(step.by === "caller_id" ? {} : { next: FOUND_BY_NAME_NEXT }),
      } };
    ```
  - The new case, right after `find_my_booking`:
    ```ts
    // S-47e (spec 5.4.2): who the caller says they are, checked against the caller ID's people only. The result
    // never names anyone (spec E2); a name never raises a call with no caller ID above rung 0.
    case "confirm_identity": {
      if (!ctx.callerNumber) return { state, result: noCallerId(nextStep(ctx)) };
      if (isLocked(state)) return { state, result: lockedResult(state.identity.locked!) };
      const step = confirmStep(state, requiredRung("read_existing", ctx.tradeModule), await readOnCallerId(ctx),
        (args ?? {}) as { fullName?: unknown; email?: unknown }, nextStep(ctx));
      logIdentity(ctx, step.event);
      return { state: step.state, result: step.result };
    }
    ```
  - `schemas.ts`: after `find_my_booking` in `BOOKING_TOOLS`:
    ```ts
      // S-47e (spec 5.4.3): on the session exactly where find_my_booking is (modes full and manage).
      { type: "function", name: "confirm_identity",
        description: "Confirm whose appointment the caller means, when find_my_booking asks you to and whenever the caller asks about a different person's appointment than the one already confirmed. Pass the first and last name exactly as the caller said it, and the email address only when you were asked for it: spell the email back character by character and wait for them to confirm, then write it with the @ and . symbols. It checks only the people under the number they are calling from. It never tells you a name or an email, and you must never suggest, guess or spell one for them.",
        parameters: { type: "object", properties: { fullName: { type: "string", description: "First and last name, as the caller said it." }, email: { type: "string", description: "Only when asked for. The address as confirmed, with @ and . symbols." } }, required: ["fullName"] } },
    ```
    and `find_my_booking`'s description gains `" If it asks you to confirm who they are, ask for exactly what it says, call confirm_identity, then call find_my_booking again."` at its end.
  - `…/incoming/route.ts:1266-1271`: `callRowId, handoffTarget,` → `callRowId, handoffTarget,\n      tradeModule: tradeStamp?.module ?? null,` (`tradeStamp` is `:1174`).
  - P17: delete `findUpcomingBookingForPhone` (`voice.ts:932-947`) and, in `voice.test.ts`, its import (`:14`) and its test (`:197-217`).
- [ ] **Step 5: Run to verify they pass**, then each named mutation: (a) `ownsStep` call replaced by today's `bookedThisCall || isCallerIdNumber(contact?.phone, ctx.callerNumber)` → the S9 case FAILS; (b) `requiredRung("change_existing", null)` (the rung ignored) → the P7 case FAILS; (c) `confirmStep` called with no `isLocked` check and `withMiss` never locking (edit `state.ts` `MAX_MISSES` to 99 for the probe) → the lock case FAILS; (d) `readCandidates(ctx.db, "a1", …)` → the second-account case FAILS; (e) put `name: c.words.join(" ")` into `ASK_NAME`'s builder (probe in `results.ts`) → the "nothing of theirs" case FAILS; (f) drop `&& spoken.length === 0` from `decideIdentity`'s sole-candidate row → the "a name that is not the one contact" case FAILS; (g) always add `FOUND_BY_NAME_NEXT` → the caller-ID-alone case FAILS. Paste each, revert, `cmp`.
- [ ] **Step 6: Commit** `voice: on a shared phone Sofía asks whose appointment it is before she reads, moves or cancels one; an insurance pack asks for the email too; two misses end the look-up (S-47e)`, naming every path.

**Verify (the affected-test rule):**
1. Mocks of changed modules: `…/tools/registry.test.ts` (done above); `lib/voice/call-events.test.ts` and `…/incoming/lifecycle.test.ts` mock `registry` itself (no change; run them); `…/incoming/route.test.ts` (the tool context's new property; run it).
2. Prefix pins: none. 3. Pinned selects: none.
4. Bare factories: `…/incoming/route.test.ts:99` and `lifecycle.test.ts:134` are bare but the route calls no new `@bis/db` function (only the registry does, and lifecycle mocks it); run both.
5. e2e: none.
6. In-account service reads: none.
- `src/lib/voice/system-prompt.test.ts` green untouched (the three digests). `src/lib/voice/modules/corpus-lib.test.ts` green (its tool lists use `toContain`). `src/lib/voice/session-config.test.ts` green. On a replica + PostgREST, `packages/db/src/test/voice.test.ts` (the removal). Both typechecks; eslint.

**Review (HIGH, opus, own worktree):** re-runs mutations (a), (b) and (d), plus its own: swap the order so `ownsStep` runs before the contact read (the "throwing lookup refuses even a booking made on this call" test must FAIL); and make `find_my_booking` skip `findNeedsRead` (always read) — say what, if anything, catches it (the "confirm Beto then find" case's read count should). Confirms `ToolContext.tradeModule` comes from the same `tradeStamp` that stamped the row (S15), and that no identity result reaches the model with a candidate's id.

---

## Task 7 (HIGH): The record rule in the call — the picker, `book_appointment`, `capture_lead`, `take_message` (bis-voice, opus)

**Dispatch gate:** Task 6 committed.

**Files:**
- Create: `…/identity/record.ts` (+ `record.test.ts`).
- Modify: `…/tools/registry.ts` (`:331-337` `capture_lead`; `:339-347` `take_message`; `:437-476` the booking's contact), `…/tools/schemas.ts` (`:10-12` `book_appointment`, `:29-31` `capture_lead`, `:32-34` `take_message`). (`CapturedLead.forSomeoneElse` and `leadWhoseAsked` are Task 5's, in its `call-state.ts` model.)
- Test: `…/tools/registry.test.ts`, `…/tools/schemas.test.ts`.

**Interfaces:**
- Consumes: Task 5's `readCandidates`, `isShared`, `messageNeedsNameCheck`, `messageNameStep`, `messageName`, `withLeadWhoseAsked`, `BOOK_ASK_NAME`, `BOOK_AMBIGUOUS`, `BOOK_ASK_WHOSE`, `LEAD_ASK_WHOSE`, `MESSAGE_ASK_NAME`, `nameWords`, `nameMatch`, `nameHits`; Task 4's `matchBy`.
- Produces: `pickRecordOnNumber`, `RecordPick`, `leadNeedsWhoseCheck`, `leadWhoseStep` (exact code in "The model, The record picker (Task 7)"). Tasks 8 and 14 call them.

- [ ] **Step 1: Write the failing tests.**
  - `record.test.ts`, every row of spec §5.10.0's order as amended (P27), literal candidates (`cand(id, first, last, emailKey)` built with `candidateOf`):
    - Nobody on the number → `today`.
    - ONE contact, no `forSomeoneElse`: a sole "Caller" / null and "Ana Prueba" → `today`; a sole "Dan" / "Lopez" and "Dan Lopez" → `today`; "Dan" alone → `today`; a sole "María" / "García" and "María García López" → `today` (P26: every record word spoken; this was the duplicate the review found); a sole "Dan" / null (first name only) and "Dan Lopez" → `today`; a sole "Dan" / "Lopez" and "Daniel Lopez" → `ask_whose` (mutation: today's S20 `create` → FAILS); a sole "Roberto" / "Prueba" and "Beto Prueba" → `ask_whose`; no name at all → `today`.
    - ONE contact with `forSomeoneElse`: `true` → `create` (even when the name agrees: "José Garza" booking for a son beside a sole "José Luis Garza"); `false` → `existing` of the sole contact whatever the name ("Daniel Lopez" for "Dan Lopez"; mutation: ignore `false` → `ask_whose`, FAILS).
    - Truncated → `ambiguous` (even with a matching name).
    - Several, confirmed `a` on the number: name absent → `existing a`; `"Ana"` alone → `existing a`; `"Ana Prueba"` → `existing a`; `forSomeoneElse: false` with any name → `existing a`; `"Beto Prueba"` → `existing b` (the name wins when it names someone else on the number).
    - A `confirmedId` that is not among `onNumber`: ignored; with no name → `ask_name`. (Whether a confirmation is passed at all is the CALLER's rule, "only on the caller-ID number"; the registry case below with a recited number proves it.)
    - Several, nobody confirmed: one word → `ask_name`; `"Beto Prueba"` among Dan, Ana, Beto → `existing b`; `"Carla Prueba"` → `create`; father "José Luis Garza" and son "José Garza", no emails: `"José Garza"` → `existing` son, `"José Luis Garza"` → `existing` father (P26; mutation: pool exact and partial → `ambiguous`, FAILS).
    - The same-name pair (`"Ana Prueba"` twice, emails `ana@x.com`, `k2`): no email → `ambiguous`; `"ana@x.com"` → `existing a1`; `"zed@x.com"` → `ambiguous`.
    - `leadNeedsWhoseCheck`: already asked → false; `forSomeoneElse` given → false; no name → false; otherwise true. `leadWhoseStep`: a sole "Dan Lopez" and "Ana Prueba" → `LEAD_ASK_WHOSE` with `leadWhoseAsked` set; a sole "Ana Prueba" and "Ana Prueba" → null; two contacts → null (a shared number's lead is picked by name after the call); a failed read → null.
  - `registry.test.ts`, one `describe("S-47e: the booking lands on the person named (plan Task 7)")` (its `beforeEach` sets one free slot and `createBooking` → `{ id: "bk1", cancelToken: "t" }`, as the `book_appointment` describe at `:300-310` does; read it):
    - On a shared caller-ID number (`listContactsOnNumber` → Ana ct1, Beto ct2), `"Beto Prueba"` with `emailDeclined: true` books onto ct2 and calls `createContact` NOT at all (red first against today's code: today it calls `createContact` and books onto whatever it returns); the same with `email: "beto@example.com"` → still ct2, and `fillContactBlanksReport` is called once on ct2 with `{ firstName: "Beto", lastName: "Prueba", email: "beto@example.com" }`.
    - `"Carla Prueba"` makes a new contact: `createContact` called with `({}, "a1", { firstName: "Carla", lastName: "Prueba", phone: "+19562921696", email: undefined, source: "voice", matchBy: "email_only" }, "voice", "ai")`, the booking on its id, one `contact_created` act; when that call answers `existing: true` (the email dedupe reached someone), NO `fillContactBlanksReport` and no `contact_created` (mutation: today's `created.existing && isCallerIdNumber(...)` fill → FAILS, with `getContact` answering the caller ID's phone).
    - ONE contact on the number (Dan Lopez, ct1): `"Daniel Lopez"` → `BOOK_ASK_WHOSE` and nothing written (no `createContact`, no `createBooking`; red first: today it books onto ct1 through the phone dedupe); then `forSomeoneElse: false` → booked onto ct1, no `createContact`; `forSomeoneElse: true` with `"Ana Prueba"` → `createContact` with `matchBy: "email_only"`.
    - `"Beto"` alone on a shared number → `BOOK_ASK_NAME`, and neither `createContact` nor `createBooking` is called.
    - Two "Ana Prueba" with no email (`rows` Ana ct1 and Ana ct3) and `"Ana Prueba"` → `BOOK_AMBIGUOUS`, nothing written.
    - S23, a shared number: book `"Ana Prueba"` (→ ct1), then on the SAME state book `"Beto Prueba"` → ct2 (mutation: reuse `state.contactId` before the picker → FAILS).
    - S23, a number with nobody on it before the call: `listContactsOnNumber` answers `{ rows: [], … }` the first time (today's path: `createContact` → `{ id: "ct5", existing: false }`) and `{ rows: [Ana ct5], … }` after; the second booking `"Beto Prueba"` → `BOOK_ASK_WHOSE`, nothing written; again with `forSomeoneElse: true` → `createContact` with `matchBy: "email_only"`, not ct5 (mutation: reuse `state.contactId` → FAILS).
    - A confirmed person booking under their first name alone: state `withConfirmed(…, { contactId: "ct1", rung: 1, by: "name" })`, Ana and Beto on the number, `"Ana"` → booked onto ct1.
    - A recited number (`phone: "956 555 0199"`, not the caller ID) with Ana and Beto on THAT number and ct1 confirmed on the caller ID: `"Ana"` → `BOOK_ASK_NAME` (the confirmation counts only on the caller-ID number; mutation: pass the confirmation for any number → FAILS).
    - A number with no contact: every existing `book_appointment` test passes UNEDITED (the default `rows: []` in `beforeEach`).
    - A failed number read: `listContactsOnNumber` rejects → `runTool` rejects (call-events' net answers "tool failed"), and nothing was written.
  - `registry.test.ts`, `describe("S-47e: capture_lead asks whose it is, once (plan Task 7)")`:
    - ONE contact (Dan Lopez) and a lead `{ fullName: "Ana Prueba", need: "quote" }` → `LEAD_ASK_WHOSE`, `state.leads` empty, `leadWhoseAsked` true; the same call again → recorded with no `forSomeoneElse` (mutation: drop the once-only flag → FAILS); a call with `forSomeoneElse: true` → recorded with `forSomeoneElse: true`, no read.
    - A lead whose name agrees, a shared number, no contact at all, no name, and a failed read → recorded at once.
  - `registry.test.ts`, `describe("S-47e: take_message asks for a name on a shared number (plan Task 7)")`:
    - Shared, nothing confirmed, no name: `MESSAGE_ASK_NAME`, `state.messages` empty, `state.identity.messageNameAsked` true; the SAME call again with no name → recorded (P6; mutation: drop the `messageNameAsked` check → FAILS).
    - With `name: "Ana Prueba"` → recorded with `name: "Ana Prueba"`, no read; with `nameDeclined: true` → recorded with `nameDeclined: true`.
    - One real contact on the number → recorded, no refusal; a confirmed caller → recorded, `listContactsOnNumber` not called; a failed read → recorded (logged by call row).
  - `schemas.test.ts`:
    - `take_message`'s `parameters` deep-equal `{ type: "object", properties: { body: { type: "string" }, callbackNumber: { type: "string", description: "Digits as spoken; no country code unless the caller said one." }, name: { type: "string", description: "The caller's first and last name, when you were asked for it." }, nameDeclined: { type: "boolean", description: "true ONLY after you asked for their name and they would not give it." } }, required: ["body"] }`.
    - `book_appointment` (all three meeting types, the video variant included) has `forSomeoneElse: { type: "boolean", description: "Only after you asked whether the appointment is for the caller or for someone else: false if it is for the caller, true if it is for someone else." }`, and `required` stays `["startsAt", "name"]`.
    - `capture_lead` has `forSomeoneElse: { type: "boolean", description: "Only after you asked whether this is for the caller or for someone else: false if it is for the caller, true if it is for someone else." }` beside `fields`, and `required` stays `["fields"]`.
    - The existing "video variant touches ONLY book_appointment" case (`:37-45`) stays green.
- [ ] **Step 2: Run to verify they fail**; paste the summary.
- [ ] **Step 3: Implement.**
  - `record.ts`: the model's code exactly.
  - `registry.ts` imports gain `import { pickRecordOnNumber, leadNeedsWhoseCheck, leadWhoseStep, type RecordPick } from "../identity/record";`, `readCandidates` (Task 6 already imports it from `../identity/candidates`), `import { messageNeedsNameCheck, messageNameStep, messageName } from "../identity/flow";` and `BOOK_ASK_NAME, BOOK_AMBIGUOUS, BOOK_ASK_WHOSE` from `../identity/results`.
  - `capture_lead` (`:331-337`):
    ```ts
    case "capture_lead": {
      // S-47b v3: a placeholder value is never stored (placeholders.ts, on every account); a placeholder
      // name is no name, so the no-name path applies. The corpus stub runs this same function.
      const { fields, result } = capturePhoneLead(args?.fields, ctx.callerNumber);
      if (result.ok !== true) return { state, result };
      const forSomeoneElse = typeof args?.forSomeoneElse === "boolean" ? args.forSomeoneElse : undefined;
      // S-47e (plan P27): a lead whose name is not the ONE contact on its number asks, once, whose it is.
      if (leadNeedsWhoseCheck(state, fields.fullName, forSomeoneElse)) {
        const number = e164Of(spokenPhone(fields.callbackNumber, ctx.callerNumber) ?? "");
        if (number) {
          let read: CandidateRead = { ok: false };
          try {
            read = { ok: true, ...(await readCandidates(ctx.db, ctx.accountId, number)) };
          } catch (e) {
            console.error(`voice capture_lead ${ctx.callRowId ?? "(no row)"}: number read failed, lead recorded: ${String(e)}`);
          }
          const ask = leadWhoseStep(state, read, fields.fullName);
          if (ask) return { state: ask.state, result: ask.result };
        }
      }
      return { state: withLead(state, { fields, ...(forSomeoneElse === undefined ? {} : { forSomeoneElse }) }), result };
    }
    ```
  - `take_message` (`:339-347`):
    ```ts
    case "take_message": {
      const { body, dropped } = messageBody(args?.body);
      if (!body) return { state, result: withDroppedNote({ ok: false, error: "message body required" }, dropped, "phone") };
      const callbackNumber = e164Of(String(args?.callbackNumber ?? "")) ?? ctx.callerNumber ?? undefined;
      const a = (args ?? {}) as { name?: unknown; nameDeclined?: unknown };
      // S-47e (spec 5.10.5; plan P6): on a shared number with nobody confirmed, ask once for a name.
      if (messageNeedsNameCheck(state, ctx.callerNumber, a)) {
        let read: CandidateRead = { ok: false };
        try {
          read = { ok: true, ...(await readCandidates(ctx.db, ctx.accountId, ctx.callerNumber!)) };
        } catch (e) {
          console.error(`voice take_message ${ctx.callRowId ?? "(no row)"}: number read failed, message recorded: ${String(e)}`);
        }
        const ask = messageNameStep(state, read);
        if (ask) return { state: ask.state, result: ask.result };
      }
      const name = messageName(a);
      return {
        state: withMessage(state, {
          body, callbackNumber, at: now.toISOString(),
          ...(name ? { name } : {}), ...(a.nameDeclined === true ? { nameDeclined: true } : {}),
        }),
        result: withDroppedNote({ ok: true }, dropped, "phone"),
      };
    }
    ```
  - The booking's contact (`:440-476`) becomes:
    ```ts
      const source = voiceSource(ctx.callRowId);
      const acts: NewAiAct[] = [];
      const space = name.lastIndexOf(" ");
      const firstName = space > 0 ? name.slice(0, space) : name;
      const lastName = space > 0 ? name.slice(space + 1) : undefined;
      // S-47e (E7, spec 5.10.1, S23): every booking with a number picks its record on THAT number, the call's
      // second booking included. A read failure throws to call-events' net; nothing is written.
      const number = phone ? e164Of(phone) : null;
      const onCallerId = number !== null && number === ctx.callerNumber;
      let pick: RecordPick = { kind: "today" };
      if (number) {
        const { candidates, truncated } = await readCandidates(ctx.db, ctx.accountId, number);
        pick = pickRecordOnNumber({ onNumber: candidates, truncated, name, email,
          confirmedId: onCallerId ? state.identity.confirmed?.contactId ?? null : null,
          forSomeoneElse: typeof args?.forSomeoneElse === "boolean" ? args.forSomeoneElse : undefined });
      }
      if (pick.kind === "ask_name") return { state, result: BOOK_ASK_NAME };
      if (pick.kind === "ask_whose") return { state, result: BOOK_ASK_WHOSE };
      if (pick.kind === "ambiguous") return { state, result: BOOK_AMBIGUOUS };
      let contactId: string | null;
      if (pick.kind === "existing") {
        contactId = pick.contactId;
        // 5.10.2: decision 19's fill, ONLY on a record picked on the caller-ID number. Never fails the booking.
        if (onCallerId) {
          try {
            const filled = await fillContactBlanksReport(ctx.db, ctx.accountId, contactId,
              { firstName, lastName, email: email ?? undefined }, "voice", "ai");
            acts.push(...fieldFillActs(source, contactId, filled));
          } catch (e) {
            console.error(`voice fillContactBlanks failed for ${contactId}: ${String(e)}`);
          }
        }
      } else if (pick.kind === "create") {
        // S21: a new person on the number. The email still wins (matchBy "email_only"); a record reached that way
        // was not picked by name, so nothing of this caller's is written onto it.
        const created = await createContact(ctx.db, ctx.accountId,
          { firstName, lastName, phone: phone ?? undefined, email: email ?? undefined, source: "voice", matchBy: "email_only" },
          "voice", "ai");
        contactId = created.id;
        if (!created.existing) acts.push({ ...source, kind: "contact_created", contactId, target: {}, before: null, after: null });
      } else {
        contactId = state.contactId;
        if (!contactId) {
          // today's code, moved unchanged (registry.ts:447-475 at df8882ce):
          const created = await createContact(ctx.db, ctx.accountId,
            { firstName, lastName, phone: phone ?? undefined, email: email ?? undefined, source: "voice" },
            "voice", "ai");
          contactId = created.id;
          if (!created.existing) {
            acts.push({ ...source, kind: "contact_created", contactId, target: {}, before: null, after: null });
          }
          // Dedupe returns the existing row untouched — backfill blanks so a
          // repeat caller stops being "Caller" with no email (the unsendable-
          // reminder casualty). ONLY on the caller's own contact: the dedupe
          // matches email first, then phone, and either can be something the
          // caller merely said, so the match may be someone else's record. The
          // booking still lands on it; nothing of this caller's is written
          // onto it. `phone` is never passed — on the caller's own contact it
          // already is the caller ID. A withheld caller ID fills nothing.
          // Failure here (the read or the fill) must NEVER fail the booking.
          if (created.existing && ctx.callerNumber) {
            try {
              const existing = (await getContact(ctx.db, ctx.accountId, contactId)) as BookingContact | null;
              if (isCallerIdNumber(existing?.phone, ctx.callerNumber)) {
                const filled = await fillContactBlanksReport(ctx.db, ctx.accountId, contactId,
                  { firstName, lastName, email: email ?? undefined },
                  "voice", "ai");
                acts.push(...fieldFillActs(source, contactId, filled));
              }
            } catch (e) {
              console.error(`voice fillContactBlanks failed for ${contactId}: ${String(e)}`);
            }
          }
        }
      }
    ```
    The `else` branch keeps today's `:447-475` statements exactly (move them, do not retype them; `git diff -w` shows only the indentation and the three moved declarations). After it, `contactId` is non-null on every path; the rest of the case (`:478-573`) is unchanged.
  - `schemas.ts:10-12`: `book_appointment`'s properties gain `forSomeoneElse: { type: "boolean", description: "Only after you asked whether the appointment is for the caller or for someone else: false if it is for the caller, true if it is for someone else." }` (the video variant spreads these properties, `:66-69`, so it carries it too). `schemas.ts:29-31`: `capture_lead`'s properties gain `forSomeoneElse: { type: "boolean", description: "Only after you asked whether this is for the caller or for someone else: false if it is for the caller, true if it is for someone else." }`.
  - `schemas.ts:32-34`: `take_message`'s properties gain `name: { type: "string", description: "The caller's first and last name, when you were asked for it." }, nameDeclined: { type: "boolean", description: "true ONLY after you asked for their name and they would not give it." }`; `required` stays `["body"]`; its description stays `"Leave a message for a human callback."`.
- [ ] **Step 4: Run to verify they pass**, then each named mutation; paste, revert, `cmp`.
- [ ] **Step 5: Commit** `voice: on a shared phone every booking, lead and message lands on the person the caller names; on a phone with one contact, a different name asks whether it is for someone else (S-47e E7)`, naming every path.

**Verify (the affected-test rule):**
1. Mocks: `registry.test.ts` (its `beforeEach` default `rows: []` keeps every existing booking test on today's path; run the whole file and paste its summary).
2–6. None beyond Task 6's list; run `call-events.test.ts`, `lifecycle.test.ts`, `system-prompt.test.ts`, `corpus-lib.test.ts`, `session-config.test.ts`.
- Typecheck; eslint.

**Review (HIGH, opus, own worktree):** re-runs the S23 mutations, the fill mutation and the `forSomeoneElse: false` mutation; reads that the `today` branch is today's code byte for byte (`git diff -w`); checks that a booking with NO number (caller ID withheld, none said) never reads; that `pickRecordOnNumber` is never handed a confirmation for a recited number; that a one-contact number never gains a contact silently (every `create` on it passed `forSomeoneElse: true`); and that `capture_lead` cannot loop (it asks once).

---

## Task 8 (HIGH): The record rule after the call — `resolveContactId`, the text-back's holding record (bis-voice, opus)

**Dispatch gate:** Task 7 committed.

**Files:**
- Modify: `apps/web/src/lib/voice/finish-call.ts` (`:1-22` imports; `:292-379` `resolveContactId` and its doc; a new `resolveTextbackContact` after it; `:639` and `:654`), `apps/web/src/lib/voice/textback.ts` (`:25-30` imports; `:64-75` `TextbackRequest.resolveContact`; `:126-136` `TextbackOutcome`; `:154-184` `contactForCallerId`; `:215-312` `prepareTextback`'s resolution and its 8 `return` statements, read at `:219`, `:242`, `:256`, `:276`, `:285`, `:287`, `:298`, `:307`).
- Test: `apps/web/src/lib/voice/finish-call.test.ts`, `apps/web/src/lib/voice/textback.test.ts`.

**Interfaces:**
- Consumes: `readCandidates`, `isShared` (Task 5); `pickRecordOnNumber` (Task 7); `ensureHoldingContact`, `HoldingContactUnavailable` (Task 3); `matchBy` (Task 4); `TakenMessage.name/nameDeclined`, `CallState.identity` (Task 5).
- Produces: `ResolvedTextbackContact` and `TextbackOutcome.holding` ("The model, The text-back contact (Task 8)").

- [ ] **Step 1: The mocks first.** Both files' `dbMocks` (`finish-call.test.ts:3-25`, `textback.test.ts:3-19`) gain `listContactsOnNumber: vi.fn(), ensureHoldingContact: vi.fn(),`, and both `beforeEach` blocks (after their `mockReset` loop) gain `dbMocks.listContactsOnNumber.mockResolvedValue({ rows: [], truncated: false }); dbMocks.ensureHoldingContact.mockResolvedValue({ id: "ct_hold", created: true });`. With these alone, both files are green on today's code (no existing test changes; paste both summaries).
- [ ] **Step 2: Write the failing tests** (finish-call.test.ts, one `describe("S-47e: the record after the call (plan Task 8)")`; the household fixture rows are `{ id: "ct1", first_name: "Ana", last_name: "Prueba", phone: "+19562921696", email_key: null, holds_shared_number: false }` and `ct2` Beto Prueba on the same number):
  - **The confirmed person, in the booking's order (5.10.3; R2 finding 9):** Ana (ct7) and Beto (ct2) on the caller ID, state `withConfirmed(caller(), { contactId: "ct7", rung: 1, by: "name" })`:
    - a lead `{ fullName: "Ana Prueba", email: "ana@example.com", need: "quote" }` → ct7's thread (`ensureConversation` called with `({}, "a1", "ct7", "voice", "ai")`), no `createContact`, and `fillContactBlanksReport` on ct7 with `{ firstName: "Ana", lastName: "Prueba", email: "ana@example.com" }`;
    - a lead named "Beto Prueba" → ct2, as `book_appointment` would book it (mutation: a confirmed-first shortcut ahead of the lead → ct7, FAILS);
    - a message with no name → ct7 (the confirmation picks).
  - **A lead on a number with ONE contact (P27):** Dan Lopez (ct1) alone on the caller ID, a lead "Ana Prueba": with no `forSomeoneElse` (capture_lead asked once and the caller never answered) → NO contact, no conversation, no message, while the alert and the To-do are written (mutation: today's phone dedupe → ct1, FAILS); with `forSomeoneElse: true` → `createContact` with `matchBy: "email_only"`; with `forSomeoneElse: false` → ct1, with the fill.
  - **A lead on a shared number:** Ana and Beto on the caller ID, lead "Beto Prueba" → ct2, no `createContact`, one fill on ct2; lead "Carla Prueba" → `createContact` with `matchBy: "email_only"` and the lead's phone; two "Ana Prueba" and a lead "Ana Prueba" (no email) → NO contact, NO conversation, NO message; `finishCallRow`'s `contactId` undefined; the staff alert (`emailRefs.send`) still sent; the callback To-do still filed with `contactId: null`.
  - **A message on a shared number (S22):** `withMessage(caller(), { body: "Call me", at: "t", name: "Beto Prueba" })` → ct2's thread; `{ …, nameDeclined: true }` → no contact, no conversation, no message row, while `finishCallRow`, `setCallCard`, the alert and `ensureCallbackTask` are all still called; no name and no `nameDeclined` (the model ignored the ask) → the same as declined.
  - **The create path never fills (5.10.2; mutation at this site: today's `created.existing && isCallerIdNumber(...)` fill → FAILS):** lead "Carla Prueba" with `createContact` answering `{ id: "ct8", existing: true }` and `getContact` answering the caller ID's phone → `fillContactBlanksReport` NOT called.
  - **A non-shared number is today's path:** every existing finish-call test passes unedited (Step 1 proved it).
  - **The text-back (E8, S25):** `textbackCtx`, an abandoned caller (`caller()`), Ana and Beto on the caller ID, nothing confirmed: `ensureHoldingContact` called with `({}, "a1", "+19562921696")`; `ensureConversation` called with `"ct_hold"`; `createContact` NOT called (red first against today's code, which phone-picks a household member); `finishCallRow`'s patch has `contactId: undefined` and `conversationId` = the holding conversation (`"cv1"` from the mock); `generateProposals` receives `contactId: null` (mutation: adopt every text-back contact at `:654` → FAILS).
  - **A confirmed caller's text-back** goes to the confirmed person, not the holding record (`ensureHoldingContact` not called).
  - **The holding record unavailable (P23):** `ensureHoldingContact` rejects with `new HoldingContactUnavailable("a1")` → no message row, no `deliverTextback`, one `text-back failed` log line naming the call row and no number, and `finishCall` still writes the row and returns.
  - textback.test.ts, `describe("S-47e: a shared number's text-back (plan Task 8)")`:
    - `prepareTextback(DB, "a1", request({ contactId: null }))` with Ana and Beto on the number → `outcome.holding` true, `outcome.contactId` `"ct_hold"`, `createContact` and `fillContactBlanksReport` NOT called (red first).
    - One contact on the number → today's `contactForCallerId` (`createContact` with `{ firstName: "Caller", phone, source: "voice" }`), `outcome.holding` false.
    - A resolver that answers `{ id: "ct_hold", holding: true }` → `outcome.holding` true; one that answers `"ct_9"` → false (the existing `:162` case, unedited).
    - A given `contactId` (the release pass, the handoff route) never reads the number (`listContactsOnNumber` not called) and answers `holding: false`.
- [ ] **Step 3: Run to verify they fail**; paste the summary.
- [ ] **Step 4: Implement.**
  - `finish-call.ts` imports: `ensureHoldingContact` joins the `@bis/db` value block; then
    ```ts
    import { readCandidates, isShared } from "./identity/candidates";
    import { pickRecordOnNumber } from "./identity/record";
    import type { ResolvedTextbackContact } from "./textback";
    ```
    and `:22` becomes `import { e164Of, isCallerIdNumber, spokenPhone } from "./phone-number";`.
  - `resolveContactId` (`:307-379`) becomes (its doc `:292-306` gains one paragraph: "S-47e (E7, spec 5.10.3): on a number several contacts share, the confirmed person, the one the lead's or the message's name picks, a new person the name makes, or NOBODY: never whichever record the phone dedupe finds. A read failure throws to the lead-treatment leg's catch, which writes nothing."):
    ```ts
    async function resolveContactId(state: CallState, ctx: FinishContext, callId: string | null): Promise<string | null> {
      if (state.contactId) return state.contactId;
      const source = voiceSource(callId);
      const acts: NewAiAct[] = [];
      const lead = state.leads[0];

      // The call's confirmation counts only for the caller-ID number (5.10.0), and no step runs ahead of the
      // lead or the message: the same order as book_appointment's (R2 finding 9). The confirmed person with no
      // lead and no message name is the message path's `existing`, below.
      const confirmedId = state.identity.confirmed?.contactId ?? null;

      if (lead) {
        const fields = lead.fields ?? {};
        const { firstName, lastName } = splitFullName(fields.fullName ?? "");
        // As said, or the caller ID (review R2-C1): phoneFields flags a number that could be Mexican or US.
        const phone = spokenPhone(fields.callbackNumber, ctx.callerNumber) ?? undefined;
        const number = phone ? e164Of(phone) : null;
        if (number) {
          // 5.10.3 step 3: the lead's name picks its record on the number it would store.
          const { candidates, truncated } = await readCandidates(ctx.db, ctx.accountId, number);
          const pick = pickRecordOnNumber({ onNumber: candidates, truncated, name: fields.fullName, email: fields.email,
            confirmedId: number === ctx.callerNumber ? confirmedId : null, forSomeoneElse: lead.forSomeoneElse });
          // ask_whose here means capture_lead asked once and the caller never answered: nothing ambiguous is written.
          if (pick.kind === "ask_name" || pick.kind === "ambiguous" || pick.kind === "ask_whose") return null;
          if (pick.kind === "existing") {
            if (number === ctx.callerNumber) {
              try {
                const filled = await fillContactBlanksReport(ctx.db, ctx.accountId, pick.contactId,
                  { firstName: firstName || undefined, lastName, email: fields.email }, ACTOR_ID, ACTOR_TYPE);
                acts.push(...fieldFillActs(source, pick.contactId, filled));
              } catch (e) {
                console.error(`finishCall fillContactBlanks failed for ${pick.contactId}: ${String(e)}`);
              }
            }
            await recordActs(ctx.db, ctx.accountId, acts);
            return pick.contactId;
          }
          if (pick.kind === "create") {
            const created = await createContact(ctx.db, ctx.accountId, {
              firstName: firstName || "Caller", lastName, phone, email: fields.email, source: "voice", matchBy: "email_only",
            }, ACTOR_ID, ACTOR_TYPE);
            if (!created.existing) {
              acts.push({ ...source, kind: "contact_created", contactId: created.id, target: {}, before: null, after: null });
            }
            await recordActs(ctx.db, ctx.accountId, acts);
            return created.id;
          }
        }
        // `today`: zero or one contact on the number, or no number at all. Today's code, moved unchanged
        // (finish-call.ts:316-349 at df8882ce); `fields`, `firstName` and `lastName` are declared above.
        const created = await createContact(ctx.db, ctx.accountId, {
          firstName: firstName || "Caller",
          lastName,
          // As said, or the caller ID (review R2-C1): phoneFields flags a
          // number that could be Mexican or US; an e164Of here would not.
          phone: spokenPhone(fields.callbackNumber, ctx.callerNumber) ?? undefined,
          email: fields.email,
          source: "voice",
        }, ACTOR_ID, ACTOR_TYPE);
        if (!created.existing) {
          acts.push({ ...source, kind: "contact_created", contactId: created.id, target: {}, before: null, after: null });
        }
        // Backfill ONLY the caller's own contact. The lead's email or callback
        // number is what the caller said, and the dedupe (email first, then
        // phone) can land it on someone else's record: the lead still goes
        // there, but nothing of this caller's is written onto it unless its
        // stored phone is the caller ID. `phone` is never passed — on the
        // caller's own contact it already is the caller ID. A withheld caller ID
        // fills nothing.
        if (created.existing && ctx.callerNumber) {
          try {
            const existing = (await getContact(ctx.db, ctx.accountId, created.id)) as { phone?: string | null } | null;
            if (isCallerIdNumber(existing?.phone, ctx.callerNumber)) {
              const filled = await fillContactBlanksReport(ctx.db, ctx.accountId, created.id,
                { firstName: firstName || undefined, lastName, email: fields.email },
                ACTOR_ID, ACTOR_TYPE);
              acts.push(...fieldFillActs(source, created.id, filled));
            }
          } catch (e) {
            console.error(`finishCall fillContactBlanks failed for ${created.id}: ${String(e)}`);
          }
        }
        await recordActs(ctx.db, ctx.accountId, acts);
        return created.id;
      }

      if (ctx.callerNumber) {
        const read = await readCandidates(ctx.db, ctx.accountId, ctx.callerNumber);
        if (isShared(read)) {
          // 5.10.3 step 4 (S22): the confirmed person, or the last message's name; declined, absent or ambiguous is nobody's.
          const msg = state.messages[state.messages.length - 1];
          const name = msg && !msg.nameDeclined ? msg.name : undefined;
          const pick = pickRecordOnNumber({ onNumber: read.candidates, truncated: read.truncated, name, email: null, confirmedId });
          if (pick.kind === "existing") return pick.contactId;
          if (pick.kind !== "create") return null;
          const { firstName, lastName } = splitFullName(name!);
          const created = await createContact(ctx.db, ctx.accountId,
            { firstName, lastName, phone: ctx.callerNumber, source: "voice", matchBy: "email_only" }, ACTOR_ID, ACTOR_TYPE);
          if (!created.existing) {
            acts.push({ ...source, kind: "contact_created", contactId: created.id, target: {}, before: null, after: null });
          }
          await recordActs(ctx.db, ctx.accountId, acts);
          return created.id;
        }
        // Not shared: today's "Caller" path, moved unchanged (finish-call.ts:353-375 at df8882ce).
        // Safe as it stands: this dedupes on the caller ID ALONE, so a match IS
        // the caller's own contact and the phone fill is a no-op. Do not add the
        // lead path's email/name here without its caller-ID check.
        const created = await createContact(ctx.db, ctx.accountId, {
          firstName: "Caller",
          phone: ctx.callerNumber,
          source: "voice",
        }, ACTOR_ID, ACTOR_TYPE);
        if (!created.existing) {
          acts.push({ ...source, kind: "contact_created", contactId: created.id, target: {}, before: null, after: null });
        } else {
          try {
            // A no-op on a caller-ID match (written comes back empty), so usually no act.
            const filled = await fillContactBlanksReport(ctx.db, ctx.accountId, created.id,
              { phone: ctx.callerNumber ?? undefined },
              ACTOR_ID, ACTOR_TYPE);
            acts.push(...fieldFillActs(source, created.id, filled));
          } catch (e) {
            console.error(`finishCall fillContactBlanks failed for ${created.id}: ${String(e)}`);
          }
        }
        await recordActs(ctx.db, ctx.accountId, acts);
        return created.id;
      }

      return null;
    }
    ```
    The two blocks marked "moved unchanged" are today's statements (`:316-349` after its two declarations, now above; `:353-375` whole): MOVE them, do not retype them. `git diff -w` must show only the new code and the moved declarations.
  - After it:
    ```ts
    /**
     * S-47e (E8, spec 5.10.4; plan P15): the text-back's contact. resolveContactId's answer, or, on a shared
     * caller-ID number with nobody confirmed or named, the number's ONE holding record: the text and any reply live
     * there until staff move them, and finishCall keeps the call row's contact null.
     */
    async function resolveTextbackContact(state: CallState, ctx: FinishContext, callId: string | null): Promise<ResolvedTextbackContact> {
      const id = await resolveContactId(state, ctx, callId);
      if (id !== null || !ctx.callerNumber) return id;
      if (!isShared(await readCandidates(ctx.db, ctx.accountId, ctx.callerNumber))) return null;
      const holding = await ensureHoldingContact(ctx.db, ctx.accountId, ctx.callerNumber);
      return { id: holding.id, holding: true };
    }
    ```
  - `:639` `resolveContact: () => resolveContactId(state, ctx, meta.callRowId),` → `resolveContact: () => resolveTextbackContact(state, ctx, meta.callRowId),`.
  - `:654` `if (result.contactId) contactId = result.contactId;` → `if (result.contactId && !result.holding) contactId = result.contactId;` with the comment line "S-47e (SD21): never a holding record: no contact_field or stage suggestion may be offered for it."
  - `textback.ts`: `ensureHoldingContact` joins the `@bis/db` value import; `import { readCandidates, isShared } from "./identity/candidates";`; the model's `ResolvedTextbackContact` type above `TextbackRequest`; `resolveContact?: () => Promise<ResolvedTextbackContact>;`; `TextbackOutcome` gains `holding` (the model's doc); `contactForCallerId`'s return type becomes `Promise<string | { id: string; holding: true }>` and its first lines:
    ```ts
      // S-47e (E8, S25): a number several customers share files its text on its ONE holding record, never on a
      // household member by phone. Its phone-only fill (below) never runs on a holding record.
      if (isShared(await readCandidates(db, accountId, callerNumber))) {
        const holding = await ensureHoldingContact(db, accountId, callerNumber);
        return { id: holding.id, holding: true };
      }
    ```
  - `prepareTextback` (`:237-238`):
    ```ts
      const resolved: ResolvedTextbackContact = r.contactId
        ?? (r.resolveContact ? await r.resolveContact() : await contactForCallerId(db, accountId, r.callerNumber, r.callId));
      const contactId = typeof resolved === "string" ? resolved : resolved?.id ?? null;
      const holding = resolved !== null && typeof resolved === "object";
    ```
    and each of the 8 `return` statements gains `holding` (`holding: false` on the first two, `:219` and `:242`).
- [ ] **Step 5: Run to verify they pass**, then each named mutation; paste, revert, `cmp`.
- [ ] **Step 6: Commit** `voice: after a call on a shared phone, the lead, the message and the missed-call text land on the person named or confirmed, or on the number's one holding record, never on a housemate by phone (S-47e E7, E8)`, naming the four files.

**Verify (the affected-test rule):**
1. Mocks: `finish-call.test.ts`, `textback.test.ts` (Step 1). `lib/automations/passes/release-held.test.ts` (spread-real; reaches `prepareTextback` with a payload contact only; run it, expect green unedited). `apps/web/src/app/api/voice/texml/handoff-result/route.test.ts` mocks `@/lib/voice/textback` (`:88`); run it. `…/incoming/lifecycle.test.ts` mocks `finishCall`; run it.
2. Prefix pins: none. 3. Pinned selects: none.
4. Bare factories: none reach the new calls (lifecycle and route mock `finishCall`/the registry).
5. e2e: none. 6. In-account service reads: run it (`textback.ts` and `finish-call.ts` keep `serviceDb` as a type).
- `system-prompt.test.ts`, `summary-service.test.ts`, `call-card.test.ts` green. Typecheck; eslint.

**Review (HIGH, opus, own worktree):** re-runs the adopt mutation and the fill mutations; reads `git diff -w` of the two moved blocks; confirms `resolveTextbackContact` is the ONLY caller of `ensureHoldingContact` in `finish-call.ts`; checks that a read failure in the text-back's resolver reaches finishCall's text-back catch (`:657-659`) and costs nothing else; and that the holding conversation reaches `finishCallRow` while the contact does not.

---

## Task 9 (MEDIUM): The identity To-do; `workRowHref`'s call link (bis-voice)

**Dispatch gate:** Tasks 2 and 8 committed.

**Files:**
- Modify: `apps/web/src/lib/voice/finish-call.ts:798-835` (the callback To-do leg), `apps/web/src/lib/documents/card-focus.ts:23-42`.
- Test: `apps/web/src/lib/voice/finish-call.test.ts`, `apps/web/src/lib/documents/card-focus.test.ts`.

**Interfaces:** consumes `voice.todo.identity` (Task 2), `CallState.identity` (Task 5). Produces nothing new for other tasks.

- [ ] **Step 1: Write the failing tests.**
  - finish-call.test.ts, inside the existing "the call card and the callback To do" describe (`:1738`), using its `caller()`/`messageState()` helpers and a locked state `const locked = (s: CallState) => ({ ...s, identity: { ...s.identity, locked: "misses" as const } });`:
    - A locked call that took a message files exactly ONE To-do, with the identity title in the account's language, no contact, the call's id: `ensureCallbackTask` called once with `({}, "a1", { callId: "call1", contactId: null, title: "Someone asked about an appointment and couldn't confirm who they are", dueAt: "2027-06-01T17:02:00.000Z" }, "voice", "ai")` (mutation: file the callback title → FAILS).
    - The same with `accountLanguage: "es"` → title `"Alguien preguntó por una cita y no pudo confirmar quién es"`; with `accountLanguage: null` → English.
    - A locked call with NO message and no lead (callbackLine null) still files the identity To-do.
    - A `"cannot"` lock files it too.
    - Locked + transferred (`withTransferred`), locked + recording (`withRecordedCaller`), locked + no row (`callRowId: null`) → `ensureCallbackTask` NOT called; the skipped case logs one line naming the account id and no number.
    - An unlocked call files today's callback To-do unchanged (the existing cases, unedited).
    - `generateProposals` receives `callbackTodo: true` after the identity To-do is filed.
  - card-focus.test.ts:
    - `workRowHref("a1", { contactId: null, callId: "call9" })` → `"/dashboard/accounts/a1/calls/call9"`.
    - `{ contactId: "ct1", callId: "call9" }` → `"/dashboard/accounts/a1/contacts/ct1"` (mutation: test `callId` before `contactId` → FAILS; P13).
    - `{ contactId: null, callId: "call9", closureFocus: { kind: "status", on: "2027-06-01" } }` → `"/dashboard/accounts/a1/dashboard#business-status"` (a precedence probe: a real closure To-do has no call; mutation: test `callId` first → FAILS; P13).
    - `{ contactId: null, callId: null }` → `null`; every existing case unedited.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
  - `finish-call.ts` imports gain `import { m } from "@/lib/messages";` and `import { t } from "@/lib/i18n/t";`.
  - The leg (`:823-835`) becomes:
    ```ts
      // S-47e (spec 5.6, S10): a call whose identity check locked leaves THE call's one To-do (tasks_call_once):
      // E5's sentence, in the ACCOUNT's language, on no customer (nobody was confirmed). Not for a call a person
      // took (transferred), a recording, or a call with no row. The callback number and the message stay on the
      // call card and in the alert.
      const identityTodo = state.identity.locked !== null && !state.recordedCaller && !wasTransferred(state);
      if (state.identity.locked !== null && (!identityTodo || !meta.callRowId)) {
        console.log(`finishCall ${meta.callRowId ?? "(no row)"}: identity To do not filed (transferred, a recording, or no row), account ${ctx.accountId}`);
      }
      let callbackTodo = false;
      if (meta.callRowId && (identityTodo || callbackLine)) {
        try {
          await ensureCallbackTask(ctx.db, ctx.accountId, {
            callId: meta.callRowId,
            contactId: identityTodo ? null : contactId,
            title: identityTodo
              ? t(m, "voice.todo.identity", resolveLocale(undefined, ctx.accountLanguage ?? null))
              : callbackLine!,
            dueAt: meta.endedAt.toISOString(),
          }, ACTOR_ID, ACTOR_TYPE);
          callbackTodo = true;
        } catch (e) {
          console.error(`finishCall ${meta.callRowId}: callback To do failed: ${String(e)}`);
        }
      }
    ```
  - `card-focus.ts`: `workRowHref`'s `row` type gains `callId?: string | null;`, and its last line becomes:
    ```ts
      if (row.contactId) return `${base}/contacts/${row.contactId}`;
      // S-47e (spec 5.6, S11): a call's To-do with no customer (the identity To-do; a callback with no contact) opens the call.
      return row.callId ? `${base}/calls/${row.callId}` : null;
    ```
    `work-list.tsx:258` and `agency-work-list.tsx:184` already pass the whole row (`WorkRow.callId`, `work-queue.ts:27`); no edit.
- [ ] **Step 4: Run to verify they pass**, then the mutations; paste, revert, `cmp`.
- [ ] **Step 5: Commit** `voice: a call whose identity check locked leaves one To-do for the team in the account's language, and a call's To-do with no customer opens the call (S-47e)`.

**Verify (the affected-test rule):** (1) `finish-call.test.ts`; `[acct]/tasks/work-list.href.test.ts` and `apps/web/src/app/(dashboard)/dashboard/work/*.test.ts` (they render `workRowHref`; run them); (2) none; (3) `packages/db/src/test/tasks-call-id-read.test.ts` untouched (no select changes); (4) none; (5) `grep -rn "data-work-row-link" apps/web/e2e` and read each hit: a To-do with a call and no contact is now a link (expected: `work-queue.spec.ts` asserts on rows it seeds; say whether any seeds a call To-do with no contact); (6) none.

**Review (MEDIUM, sonnet):** the title's language is the account's, never the caller's or the actor's; exactly one `ensureCallbackTask` per call in every branch; the skipped log line carries no number.

---

## Task 10 (HIGH): Inbound texts from a shared number (bis-comms, opus)

**Dispatch gate:** Tasks 2, 4 and 5 committed (and Task 3).

**Files:**
- Modify: `…/inbound/route.ts` (`:36-41` the `@bis/db` import; `:193-218` the filing; `:235-242` the confirmation answer; `:253-254` the consent step's input), `apps/web/src/lib/consent/inbound.ts` (`:94-109` `InboundConsentInput`; `:123-148` `contactLabel`, `cancelTodo`, `holdTodo`; one new export), `packages/db/src/automations.ts` (one new export after `applyConfirmationReply`, `:938-996`), `packages/db/src/index.ts:119` (one name in the existing `matchConfirmationReply, applyConfirmationReply,` line).
- Test: `…/inbound/route.test.ts`, `…/inbound/route.consent.test.ts`, `apps/web/src/lib/consent/inbound.test.ts`, `packages/db/src/test/automations.test.ts` (one new `describe`).

**Interfaces:**
- Consumes: `ensureHoldingContact`, `listContactsOnNumber` (Task 3); `readCandidates`, `isShared`, `realCandidates` (Task 5); `todo.sharedNumber.reply`, `todo.sharedNumber.hold` (Task 2); today's `matchConfirmationReply`, `applyConfirmationReply`, `nextBookedStart`, `ensureConsentTask`, `addTask`, `getAccountLanguage`.
- Produces:
  ```ts
  // packages/db/src/automations.ts
  /** S-47e (S30): the outstanding confirmation asks among these contacts, the same predicates as
   *  applyConfirmationReply (booked, future, asked, unanswered), at most 2 (the caller asks "exactly one?").
   *  [] for [] without a request. Throws on error. */
  export async function listOutstandingConfirmAsks(
    db: SupabaseClient, accountId: string, contactIds: readonly string[], now: Date,
  ): Promise<{ bookingId: string; contactId: string }[]>;
  // apps/web/src/lib/consent/inbound.ts
  /** InboundConsentInput gains: the real contacts of a shared number whose text filed on its holding record,
   *  or null on every other filing. */
  sharedNumber: { realContactIds: string[] } | null;
  /** S-47e (S30): the one To-do for a reply from a shared number no single appointment answers. */
  export async function fileSharedReplyTodo(db: SupabaseClient, accountId: string, holdingContactId: string, now: Date): Promise<void>;
  ```

- [ ] **Step 1: The mocks.** `route.test.ts`'s bare `dbMocks` (`:5-26`) gains `listContactsOnNumber`, `ensureHoldingContact`, `listOutstandingConfirmAsks`, `addTask`, `getAccountLanguage` with defaults in its `beforeEach` (`{ rows: [], truncated: false }`, `{ id: "ct_hold", created: true }`, `[]`, `{ id: "t1" }`, `null`); `route.consent.test.ts`'s spread-real `db` (`:19`) and `inbound.test.ts`'s (`:7`) gain the same functions with the same defaults. All three files green on today's code with only this change (paste the three summaries).
- [ ] **Step 2: Write the failing tests.**
  - `automations.test.ts` (PostgREST, `withTestAccount`, seeded through `createContact`, `createBooking` and the ask's own writer, `stampAppointmentConfirmAsked(db, bookingId)` (`packages/db/src/automations.ts:826`), never a hand-shaped row): two household members each with an asked, unanswered, future, booked appointment → both returned; one answered (`applyConfirmationReply`) → only the other; a cancelled one and a past one → not returned; `[]` → `[]`; account B's member with an outstanding ask, asked for with account A's id and B's contact id → `[]` (mutation: drop `.eq("account_id", …)` → FAILS).
  - `route.test.ts`, the holding filing:
    - A text from a number with Ana and Beto on it files on the holding thread: `ensureHoldingContact` called with `(db, "<the route's own accountId>", "<fromNumber>")`, `ensureConversation` with `"ct_hold"`, `createContact` NOT called (red first: today it phone-picks).
    - From a number with one contact → `createContact` as today, `ensureHoldingContact` not called.
    - No `fromNumber` → no read.
  - `route.consent.test.ts` (it drives the route end to end, `(await POST(signed(payload))).status`, `:123-145`): a failed number read on the first filing → `503` and no message row; a failed `ensureHoldingContact`, an ordinary `Error` and a `HoldingContactUnavailable` alike (P23, re-review R5), → the same `503`, and nothing filed; a stop word from the shared number is recorded against the ADDRESS, with `contactId` the holding record.
  - `route.test.ts`, the household reply (S30; the text `"Sí"`, which `matchConfirmationReply` reads as yes):
    - Ana has the one outstanding ask → `applyConfirmationReply` called with `(db, accountId, "<Ana's id>", "Sí", <now>)`, no To-do (red first: today it is called with the holding id).
    - Ana and Beto both have one → `applyConfirmationReply` NOT called, `addTask` called once with `(db, accountId, { contactId: "ct_hold", title: "A reply from a shared number couldn't be matched to one appointment", dueAt: <now ISO> }, "sms-inbound", "system")`; with `getAccountLanguage` → `"es"` the title is `"Una respuesta de un número compartido no se pudo asociar con una sola cita"`.
    - Nobody has one → not applied, the same one To-do (the ruling's "none").
    - `listOutstandingConfirmAsks` is asked with exactly the REAL contacts on the number (the holding record and a `+52` twin with the same ten digits left out) and the route's own account id (mutation: the holding id → FAILS; mutation: a literal account id → FAILS).
    - A text that is not a one-word answer ("hola") → no read of asks, no To-do.
    - A retried delivery (`firstFiling` false) → nothing applied, no To-do.
    - A one-contact number → today's `applyConfirmationReply(db, accountId, <that contact>, …)`, no ask read.
  - `inbound.test.ts`, the consent To-dos on the holding path (`sharedNumber: { realContactIds: [...] }`, `contactId: "ct_hold"`, address `+19565550142`):
    - A held phrase → `ensureConsentTask` with `contactId: "ct_hold"` and the title `"A text from the shared number (956) 555-0142 may have asked to stop texts: “<excerpt>”. Texts to that number are on hold."` (R5; never "Caller may have asked…"; mutation: today's `contactLabel` title → FAILS); Spanish with `getAccountLanguage` → `"es"`.
    - A CANCEL word, exactly one real contact (Ana) with an upcoming booking → `ensureConsentTask` with Ana's id and today's English title naming Ana and her date (red first: today it reads the holding record's next booking, finds none, files nothing).
    - A CANCEL word, two real contacts with upcoming bookings → ONE `ensureConsentTask` on `"ct_hold"` titled `"A reply from a shared number couldn't be matched to one appointment"`.
    - A CANCEL word, nobody with an upcoming booking → no To-do (S30's choice, today's rule).
    - `sharedNumber: null` → every existing case unchanged (they pass unedited).
- [ ] **Step 3: Run to verify they fail.**
- [ ] **Step 4: Implement.**
  - `automations.ts`, after `applyConfirmationReply`:
    ```ts
    export async function listOutstandingConfirmAsks(
      db: SupabaseClient, accountId: string, contactIds: readonly string[], now: Date,
    ): Promise<{ bookingId: string; contactId: string }[]> {
      if (contactIds.length === 0) return [];
      const { data, error } = await db.from("bookings")
        .select("id, contact_id")
        .eq("account_id", accountId).in("contact_id", [...contactIds])
        .eq("status", "booked").not("confirm_asked_at", "is", null).is("confirm_reply", null)
        .gt("starts_at", now.toISOString())
        .order("confirm_asked_at", { ascending: false }).limit(2);
      if (error) throw new Error(`listOutstandingConfirmAsks failed: ${error.message}`);
      return ((data ?? []) as { id: string; contact_id: string }[]).map((r) => ({ bookingId: r.id, contactId: r.contact_id }));
    }
    ```
    and `index.ts:119`'s `matchConfirmationReply, applyConfirmationReply,` becomes `matchConfirmationReply, applyConfirmationReply, listOutstandingConfirmAsks,`.
  - `inbound.ts`: `InboundConsentInput` gains `sharedNumber` (the Produces block's doc); imports gain `addTask`, `getAccountLanguage` from `@bis/db`, `t` from `@/lib/i18n/t`, `formatPhone` from `@/lib/document-requests/customer-state`, `type Locale` from `@/lib/i18n/locale`. Then:
    ```ts
    async function accountLocale(db: SupabaseClient, accountId: string): Promise<Locale> {
      return (await getAccountLanguage(db, accountId)) === "es" ? "es" : "en";
    }

    /** S-47e (S30, P30): the one To-do for a reply from a shared number that no single appointment answers. */
    export async function fileSharedReplyTodo(db: SupabaseClient, accountId: string, holdingContactId: string, now: Date): Promise<void> {
      const title = t(m, "todo.sharedNumber.reply", await accountLocale(db, accountId));
      await addTask(db, accountId, { contactId: holdingContactId, title, dueAt: now.toISOString() }, ACTOR, "system");
    }
    ```
    `cancelTodo` (`:130-139`) gains, as its first lines:
    ```ts
      // S-47e (S30): on a shared number the holding record has no booking; the household's do.
      if (i.sharedNumber) {
        const upcoming = (await Promise.all(i.sharedNumber.realContactIds.map(async (id) =>
          ({ id, startsAt: await nextBookedStart(db, i.accountId, id, i.now.toISOString()) }))))
          .filter((x): x is { id: string; startsAt: string } => x.startsAt !== null);
        if (upcoming.length === 0) return;
        if (upcoming.length > 1) {
          const title = t(m, "todo.sharedNumber.reply", await accountLocale(db, i.accountId));
          await ensureConsentTask(db, i.accountId, { contactId: i.contactId as string, consentEventId: eventId, title, dueAt: i.now.toISOString() }, ACTOR, "system");
          return;
        }
        return cancelTodo(db, { ...i, contactId: upcoming[0]!.id, sharedNumber: null }, eventId, word);
      }
    ```
    `holdTodo` (`:142-148`) gains, as its first lines:
    ```ts
      if (i.sharedNumber) {
        const title = t(m, "todo.sharedNumber.hold", await accountLocale(db, i.accountId),
          { number: formatPhone(i.address), excerpt: excerptOf(i.text, TODO_EXCERPT) });
        await ensureConsentTask(db, i.accountId, { contactId: i.contactId as string, consentEventId: eventId, title, dueAt: i.now.toISOString() }, ACTOR, "system");
        return;
      }
    ```
    Every other caller of `InboundConsentInput` passes `sharedNumber: null` (the typecheck lists them: the alert-phone path at `route.ts:171` and any test literal).
  - `route.ts`: `ensureHoldingContact`, `listOutstandingConfirmAsks`, `matchConfirmationReply` join the `@bis/db` import at `:36-41`; `import { readCandidates, isShared } from "@/lib/voice/identity/candidates";` and `fileSharedReplyTodo` joins the `@/lib/consent/inbound` import. The filing (`:199-218`) becomes:
    ```ts
      let contact: Awaited<ReturnType<typeof createContact>>;
      let conversation: Awaited<ReturnType<typeof ensureConversation>>;
      let shared: { realContactIds: string[] } | null = null;
      try {
        // S-47e (E8, S27): a text from a number several customers share carries no name, so it files on the
        // number's ONE holding record, never on a household member by phone. Staff move it. A failed read on
        // the first filing is FilingFailed (503), like every other step here.
        const read = fromNumber ? await readCandidates(db, accountId, fromNumber) : null;
        if (read && fromNumber && isShared(read)) {
          shared = { realContactIds: read.candidates.map((c) => c.id) };
          contact = { id: (await ensureHoldingContact(db, accountId, fromNumber)).id, existing: true, flagged: false };
        } else {
          contact = await createContact(db, accountId, { phone: fromNumber ?? undefined }, ACTOR_ID, ACTOR_TYPE);
        }
        conversation = await ensureConversation(db, accountId, contact.id, ACTOR_ID, ACTOR_TYPE);
        if (firstFiling) {
          // …the createMessage call, unchanged…
        }
      } catch (e) {
        // A HoldingContactUnavailable lands here too (P23): a delete raced the insert, and Telnyx's retry recovers.
        if (firstFiling) throw new FilingFailed(e);
        throw e;
      }
    ```
    The confirmation answer (`:235-242`) becomes:
    ```ts
        if (consent.kind === "none" || consent.kind === "telnyx_only") {
          try {
            if (shared) {
              // S-47e (S30): the household's one outstanding ask, or one To-do when there is not exactly one.
              if (matchConfirmationReply(text)) {
                const now = new Date();
                const asks = await listOutstandingConfirmAsks(db, accountId, shared.realContactIds, now);
                if (asks.length === 1) {
                  const answer = await applyConfirmationReply(db, accountId, asks[0]!.contactId, text, now);
                  if (answer) log("recorded an appointment confirmation reply", accountId, asks[0]!.contactId, answer);
                } else {
                  await fileSharedReplyTodo(db, accountId, contact.id, now);
                  log("a reply from a shared number matched no single appointment; To-do filed", accountId);
                }
              }
            } else {
              const answer = await applyConfirmationReply(db, accountId, contact.id, text, new Date());
              if (answer) log("recorded an appointment confirmation reply", accountId, contact.id, answer);
            }
          } catch (e) {
            log("could not record a confirmation reply — the customer's message is filed regardless", accountId, loggableError(e));
          }
        }
    ```
    (the existing `log("recorded an appointment confirmation reply", …)` line is LOAD-BEARING, `route.ts:232-233`: it stays word for word.) And the consent step (`:253`) passes `sharedNumber: shared`.
- [ ] **Step 5: Run to verify they pass**, then the mutations (each must turn the WHOLE file red; paste, revert, `cmp`):
  - (a) `isShared` replaced by `false` in the filing → the shared case FAILS;
  - (b) the account id replaced by a literal in `readCandidates(...)` → the account assertion FAILS;
  - (c) `listOutstandingConfirmAsks` called with `[contact.id]` (the holding id) → the "Ana has the one outstanding ask" case FAILS;
  - (d) `asks.length === 1` → `asks.length >= 1` → the two-asks case FAILS;
  - (e) a `HoldingContactUnavailable` caught and answered 200 (the first fix round's shape) → its 503 case in `route.consent.test.ts` FAILS;
  - (f) `holdTodo`'s shared branch removed → the R5 title case FAILS.
- [ ] **Step 6: Commit** `sms: a text from a phone several customers share files on that number's one holding thread; a YES confirms the household's one asked appointment or files one To-do, and the consent To-dos name the number (S-47e E8, S30)`.

**Verify (the affected-test rule):** (1) `route.test.ts`, `route.consent.test.ts`, `inbound.test.ts` (Step 1); `apps/web/src/lib/consent/*.test.ts` that build an `InboundConsentInput` (the typecheck lists them); (2) `copy.test.ts:42`, `:111` (the `todo.sharedNumber.*` keys match neither; run it); (3) none; (4) `route.test.ts:28` bare (Step 1); (5) `grep -rln "sms/inbound" apps/web/e2e` → read each hit (expected none); (6) none (the route and `lib/consent/inbound.ts` take the client they are given). `lib/consent/scans.test.ts` (it scans every web source for consent writers; run it). On a replica + PostgREST: `packages/db/src/test/automations.test.ts`. Both typechecks; eslint.

**Review (HIGH, opus, own worktree):** re-runs (a), (b), (c) and (e), plus its own: (g) `nextBookedStart` asked for the holding id in `cancelTodo`'s shared branch (the one-contact CANCEL case must FAIL). It also confirms: a retried delivery (`firstFiling` false) cannot file on a different record than the first did (it reads the same number; say what happens if a housemate was added between the two deliveries); the holding contact never reaches `applyConfirmationReply`; a `HoldingContactUnavailable` answers 503 and writes nothing; and that a reply is never applied to an ask of a contact who is not on the number (the read takes only `realContactIds`).

---

## Task 11 (MEDIUM): The inbox Move and its Undo (bis-comms)

**Dispatch gate:** Tasks 2 and 4 committed.

**Files:**
- Modify: `…/convos/actions.ts` (two new exports at the end), `…/convos/actions.test.ts`.

**Interfaces:** exactly "The model, The inbox Move (Task 11)". Consumes `moveHoldingThread` (Task 3), `getContact` (its row now carries `holds_shared_number`, Task 4), `ensureConversation`, `callerCanSee` (`apps/web/src/lib/auth/visible.ts:14-19`), `seesWholeAccount` (`apps/web/src/lib/auth-role.ts:15-17`), `isUuid` (`apps/web/src/lib/assign/action-guards.ts:11`).

- [ ] **Step 1: Write the failing tests** (the file's bare factory `:141` gains `moveHoldingThread`, and `ensureConversation`/`getContact` if absent; read its `@/lib/auth` mock for how a role is set per test):
  - A Technician (`role: "technician"`, `isAgency: false`) is refused `{ ok: false, error: "conversation.holding.moveRole" }` and nothing is called.
  - An Owner's move: `callerCanSee("conversations", "a1", conv)` true, `getContact` → Beto (`holds_shared_number: false`), `ensureConversation(serviceDb(), "a1", "ct2", userId, "user")` → `bc`, `moveHoldingThread` → `{ status: "ok", moveId: 41, messageIds: ["m1"], callIds: ["k1"] }` → `{ ok: true, toConversationId: "bc", name: "Beto Prueba", undo: { moveId: 41, fromConversationId: conv, toConversationId: "bc" } }` (no id list leaves the server, P1); `moveHoldingThread` called with `(service, "a1", { from: conv, to: "bc", actor: userId })` (no `undo`).
  - Staff and the agency may move; a Technician may not (two more cases).
  - A target that is itself a holding record, a target `getContact` cannot see (null), a conversation `callerCanSee` denies, a non-UUID id, and `moveHoldingThread` answering `invalid` or `not_found` → `{ ok: false, error: "conversation.holding.moveFailed" }`.
  - `moveHoldingThread` answering `empty` (a second move of the same thread, or a stale tab; P32) → `{ ok: false, error: "conversation.holding.moveEmpty" }`, with `revalidatePath` called so the tab shows where the texts went (mutation: answer `moveFailed` for `empty` → FAILS).
  - Undo: `undoMoveHoldingThreadAction("a1", undo)` calls `moveHoldingThread(service, "a1", { from: "bc", to: conv, actor: userId, undoOf: 41 })` and answers `{ ok: true, conversationId: conv }`; an `undo` whose `moveId` is not a positive safe integer, or whose thread ids are not UUIDs, is refused `moveFailed` without a call; a forged `moveId` is the function's to refuse (`invalid` → `moveFailed`).
  - Second account: every call carries the action's own `accountId` (call with `"a2"`; mutation: a literal account id → FAILS).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement** (append to `actions.ts`; its imports gain `moveHoldingThread`, `type HoldingMove` from `@bis/db`, `seesWholeAccount` from `@/lib/auth-role`, `isUuid` from `@/lib/assign/action-guards`, `contactDisplayName` from `@/lib/format`):
    ```ts
    // S-47e (E8, spec 5.12.5): staff move a shared number's holding thread to the right person, with Undo.
    // Owners, Staff and the agency (the people who reply in the inbox), never a Technician. The SQL function
    // (0098) checks the account and the holding side again; this proves what the caller may see first.
    /** The Undo token: the move's own event and its two threads. The function reads the moved ids from that event
     *  (0098, plan P1), so nothing a browser sends can name a row. */
    export type HoldingMoveUndo = { moveId: number; fromConversationId: string; toConversationId: string };
    export type MoveHoldingResult =
      | { ok: true; toConversationId: string; name: string; undo: HoldingMoveUndo }
      | { ok: false; error: "conversation.holding.moveRole" | "conversation.holding.moveFailed" | "conversation.holding.moveEmpty" };
    const MOVE_FAILED = { ok: false, error: "conversation.holding.moveFailed" } as const;
    const MOVE_EMPTY = { ok: false, error: "conversation.holding.moveEmpty" } as const;
    const MOVE_ROLE = { ok: false, error: "conversation.holding.moveRole" } as const;

    export async function moveHoldingThreadAction(
      accountId: string, conversationId: string, toContactId: string,
    ): Promise<MoveHoldingResult> {
      const access = await requireAccountAccess(accountId);
      if (!seesWholeAccount(access)) return MOVE_ROLE;
      if (!isUuid(conversationId) || !isUuid(toContactId)) return MOVE_FAILED;
      try {
        if (!(await callerCanSee("conversations", accountId, conversationId))) return MOVE_FAILED;
        const db = await dbForRequest();
        const person = (await getContact(db, accountId, toContactId)) as
          { first_name: string | null; last_name: string | null; holds_shared_number?: boolean } | null;
        if (!person || person.holds_shared_number) return MOVE_FAILED;
        const svc = serviceDb();
        const target = await ensureConversation(svc, accountId, toContactId, access.userId, "user");
        const moved: HoldingMove = await moveHoldingThread(svc, accountId, { from: conversationId, to: target.id, actor: access.userId });
        if (moved.status === "empty") {
          // Someone, or another tab, moved them first (P32): say so, and refresh the inbox to show where they went.
          revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
          return MOVE_EMPTY;
        }
        if (moved.status !== "ok") return MOVE_FAILED;
        revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
        return {
          ok: true, toConversationId: target.id,
          name: contactDisplayName({ first_name: person.first_name, last_name: person.last_name }),
          undo: { moveId: moved.moveId, fromConversationId: conversationId, toConversationId: target.id },
        };
      } catch (e) {
        console.error(`moveHoldingThreadAction (account ${accountId}): ${e instanceof Error ? e.message : String(e)}`);
        return MOVE_FAILED;
      }
    }

    export async function undoMoveHoldingThreadAction(
      accountId: string, undo: HoldingMoveUndo,
    ): Promise<{ ok: true; conversationId: string } | { ok: false; error: "conversation.holding.moveRole" | "conversation.holding.moveFailed" }> {
      const access = await requireAccountAccess(accountId);
      if (!seesWholeAccount(access)) return MOVE_ROLE;
      if (!isUuid(undo?.fromConversationId) || !isUuid(undo?.toConversationId)
        || !Number.isSafeInteger(undo?.moveId) || undo.moveId <= 0) return MOVE_FAILED;
      try {
        const moved = await moveHoldingThread(serviceDb(), accountId, {
          from: undo.toConversationId, to: undo.fromConversationId, actor: access.userId, undoOf: undo.moveId,
        });
        if (moved.status !== "ok") return MOVE_FAILED;
        revalidatePath(`/dashboard/accounts/${accountId}/conversations`);
        return { ok: true, conversationId: undo.fromConversationId };
      } catch (e) {
        console.error(`undoMoveHoldingThreadAction (account ${accountId}): ${e instanceof Error ? e.message : String(e)}`);
        return MOVE_FAILED;
      }
    }
    ```
- [ ] **Step 4: Run to verify they pass**, then the mutations (the role check dropped → the Technician case FAILS; the account literal → FAILS). Paste, revert, `cmp`.
- [ ] **Step 5: Commit** `inbox: staff move a shared number's texts to the right person, and can undo it (S-47e E8)`.

**Verify (the affected-test rule):** (1) `actions.test.ts`; (2) none; (3) none; (4) `actions.test.ts:141` bare (Step 1); (5) none; (6) `[acct]/in-account-service-reads.test.ts` (the file is already `proven-target`, `:127`; run it, green unedited). Typecheck; eslint.

**Review (MEDIUM, sonnet):** the role check runs before any read; an Undo built in a browser cannot move another account's rows (the function's `account_id` filters) nor any row the named move did not move (the ids come from its event, P1); errors are message keys the client localises, never raw text.

---

## Task 12 (LOW): The UI — inbox label, thread Notice and Move, call-page link, record-page redirect, palette label (bis-frontend)

**Dispatch gate:** Tasks 2, 4 and 11 committed.

**Brief.**
- **`apps/web/src/lib/contacts/holding-label.ts`** (new, + test):
  ```ts
  // S-47e (E8, spec 5.12.4, S29): the one name a shared number's holding thread shows wherever a customer's
  // name would. Never "Caller".
  import { m } from "@/lib/messages";
  import { t } from "@/lib/i18n/t";
  import type { Locale } from "@/lib/i18n/locale";
  import { formatPhone } from "@/lib/document-requests/customer-state";

  export function holdingLabel(number: string | null, locale: Locale): string {
    return t(m, "contact.holding.label", locale, { number: number ? formatPhone(number) : "" }).trim();
  }
  ```
  Test: `holdingLabel("+19565550142", "en")` → `"Shared number (956) 555-0142"`; `"es"` → `"Número compartido (956) 555-0142"`; `holdingLabel("+528999221234", "en")` → `"Shared number +528999221234"`.
- **`…/convos/holding-move-handlers.ts`** (new, + test; the S-47d `closed-days-card.tsx` "minus React" shape, `:51-56` and `:120-140`):
  ```ts
  // S-47e (spec 5.12.5): the Move and its Undo, minus React, so the toasts are testable without a browser.
  import type { MessageKey } from "@/lib/messages";
  import type { Tr } from "@/lib/record/copy";
  import { UNDO_WINDOW_MS } from "../calendar/undo-window";
  import type { MoveHoldingResult, HoldingMoveUndo } from "./actions";

  type Toaster = {
    success: (message: string, opts?: { action?: { label: string; onClick: () => void }; duration?: number }) => unknown;
    error: (message: string) => unknown;
  };
  type UndoResult = { ok: true; conversationId: string } | { ok: false; error: MessageKey };
  export type MoveDeps = {
    move: () => Promise<MoveHoldingResult>;
    undo: (u: HoldingMoveUndo) => Promise<UndoResult>;
    toast: Toaster; tr: Tr;
    /** Opens a conversation in the inbox (?c=). */
    open: (conversationId: string) => void;
  };

  export async function moveAndToast(d: MoveDeps): Promise<MoveHoldingResult> {
    let r: MoveHoldingResult;
    try {
      r = await d.move();
    } catch {
      d.toast.error(d.tr.text("conversation.holding.moveFailed"));
      return { ok: false, error: "conversation.holding.moveFailed" };
    }
    if (!r.ok) {
      d.toast.error(d.tr.text(r.error));
      return r;
    }
    const undo = r.undo;
    d.toast.success(d.tr.text("conversation.holding.moved", { name: r.name }), {
      action: { label: d.tr.text("common.undo"), onClick: () => { void undoAndToast(d, undo); } },
      duration: UNDO_WINDOW_MS,
    });
    d.open(r.toConversationId);
    return r;
  }

  export async function undoAndToast(d: MoveDeps, undo: HoldingMoveUndo): Promise<void> {
    try {
      const u = await d.undo(undo);
      if (!u.ok) { d.toast.error(d.tr.text(u.error)); return; }
      d.toast.success(d.tr.text("conversation.holding.movedBack"));
      d.open(u.conversationId);
    } catch {
      d.toast.error(d.tr.text("conversation.holding.moveFailed"));
    }
  }
  ```
  Tests (literal copy, both languages): ok → `success("Moved to Beto Prueba.", { action: { label: "Undo", … }, duration: 10000 })` and `open("bc")`; pressing the action → `undo(undo)`, `success("Moved back.")`, `open(<the holding conversation>)`; `{ ok: false, error: "conversation.holding.moveRole" }` → `error("Only an Owner or Staff can move these texts.")`; a throw → `error("That conversation couldn't be moved. Try again.")`; Spanish → `"Se movió a Beto Prueba."` / `"Se regresó."`; an Undo that fails → the error toast and no `open`; `{ ok: false, error: "conversation.holding.moveEmpty" }` → `error("These texts were already moved.")` (Spanish `"Estos mensajes ya se movieron."`) and no `open` (P32).
- **`…/convos/holding-move.tsx`** (new, `"use client"`): the menu and the search dialog. Search is the existing `searchRelatableContactsAction(accountId, holdingContactId, term)` (`[acct]/contacts/relationship-actions.ts:227-251`; its own RLS bounds who can be found, and `listContacts` now leaves holding records out), searched as you type after 250 ms, the `add-relationship-dialog.tsx` pattern.
  ```tsx
  "use client";
  // S-47e (E8, spec 5.12.5): the holding thread's "Move to…" (ghost: the thread's one primary stays Send,
  // DESIGN.md rule 8). The real contacts on the number first, then "Find another customer".
  import { useEffect, useState } from "react";
  import { useRouter } from "next/navigation";
  import { toast } from "sonner";
  import { Button } from "@/components/ui/button";
  import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
  } from "@/components/ui/dropdown-menu";
  import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { Skeleton } from "@/components/ui/skeleton";
  import { makeTr } from "@/lib/record/copy";
  import { contactDisplayName } from "@/lib/format";
  import type { Locale } from "@/lib/i18n/locale";
  import { moveHoldingThreadAction, undoMoveHoldingThreadAction } from "./actions";
  import { searchRelatableContactsAction, type RelatableHit } from "../contacts/relationship-actions";
  import { moveAndToast } from "./holding-move-handlers";

  export function HoldingMove({ accountId, conversationId, holdingContactId, people, locale }: {
    accountId: string; conversationId: string; holdingContactId: string;
    /** The real contacts on the number, by name (holding records already out). */
    people: { id: string; name: string }[];
    locale: Locale;
  }) {
    const tr = makeTr(locale);
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const [finding, setFinding] = useState(false);
    const [term, setTerm] = useState("");
    const [hits, setHits] = useState<RelatableHit[] | null>(null);
    const [searching, setSearching] = useState(false);
    const [failed, setFailed] = useState(false);
    const open = (id: string) => router.push(`/dashboard/accounts/${accountId}/conversations?c=${id}`);
    const moveTo = async (contactId: string) => {
      setBusy(true);
      await moveAndToast({
        move: () => moveHoldingThreadAction(accountId, conversationId, contactId),
        undo: (u) => undoMoveHoldingThreadAction(accountId, u),
        toast, tr, open,
      });
      setBusy(false);
      setFinding(false);
    };
    useEffect(() => {
      if (!finding || [...term.trim()].length < 2) { setHits(null); setFailed(false); setSearching(false); return; }
      let live = true;
      setSearching(true);
      const timer = setTimeout(() => {
        void searchRelatableContactsAction(accountId, holdingContactId, term).then((r) => {
          if (!live) return;
          setSearching(false);
          if (r.ok) { setHits(r.hits); setFailed(false); } else { setHits(null); setFailed(true); }
        });
      }, 250);
      return () => { live = false; clearTimeout(timer); };
    }, [finding, term, accountId, holdingContactId]);
    return (
      <div lang={locale}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={busy} data-holding-move="">
              {tr.text("conversation.holding.move")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {people.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => { void moveTo(p.id); }}>{p.name}</DropdownMenuItem>
            ))}
            {people.length > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem onSelect={() => setFinding(true)}>{tr.text("conversation.holding.moveOther")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Dialog open={finding} onOpenChange={(o) => { setFinding(o); if (!o) setTerm(""); }}>
          <DialogContent lang={locale}>
            <DialogHeader><DialogTitle>{tr.text("conversation.holding.moveOther")}</DialogTitle></DialogHeader>
            <Label htmlFor="holding-find">{tr.text("conversation.holding.findLabel")}</Label>
            <Input id="holding-find" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" />
            {searching ? <Skeleton className="h-8 w-full" />
              : failed ? <p role="alert" className="text-sm text-[var(--crit)]">{tr.text("conversation.holding.findFailed")}</p>
              : hits === null ? null
              : hits.length === 0 ? <p className="text-sm text-muted-foreground">{tr.text("conversation.holding.findNone")}</p>
              : (
                <ul className="space-y-1">
                  {hits.map((h) => (
                    <li key={h.id}>
                      <Button variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => { void moveTo(h.id); }}>
                        {contactDisplayName({ first_name: h.firstName, last_name: h.lastName })}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
          </DialogContent>
        </Dialog>
      </div>
    );
  }
  ```
- **`…/convos/message-thread.tsx`** (server component): a new optional prop `holding?: { number: string; canMove: boolean; holdingContactId: string; people: { id: string; name: string }[] } | null`. The header (`:110-112`) becomes a row with the name (its `<p>` gains `data-thread-name=""`, for Task 16's locator) and, when `holding?.canMove`, `<HoldingMove accountId={accountId} conversationId={conversationId} holdingContactId={holding.holdingContactId} people={holding.people} locale={locale} />`; under it, when `holding`, `<Notice tone="warn" className="mt-2 text-foreground" lang={locale}>{tr.text("conversation.holding.notice", { number: formatPhone(holding.number) })}</Notice>` (`formatPhone` from `@/lib/document-requests/customer-state`). Nothing else in the thread changes.
- **`…/convos/conversation-list.tsx`:** a new optional prop `locale?: Locale` (default `"en"`); each row's `<Link>` gains `data-conversation-row={conversation.id}` (Task 16's locator); the row's `name` (`:52-55`) becomes `conversation.holdsSharedNumber ? holdingLabel(conversation.sharedNumber, locale) : contactDisplayName({…})`.
- **`…/convos/page.tsx`:** passes `locale` to `ConversationList`; when `active?.holdsSharedNumber`, reads the people on the number on the REQUEST client and builds the holding view, best-effort (a failed read leaves `people: []`; "Find another customer" still works), and passes `contactName={holdingLabel(active.sharedNumber, locale)}` instead of the contact's name:
  ```ts
  // S-47e (E8, spec 5.12.4-5): a shared number's holding thread names its number, says why, and offers Move to
  // the people on the number (the request client's own RLS) for those who may reply in the inbox.
  let holding: { number: string; canMove: boolean; holdingContactId: string; people: { id: string; name: string }[] } | null = null;
  if (active?.holdsSharedNumber && active.sharedNumber) {
    const number = active.sharedNumber;
    let people: { id: string; name: string }[] = [];
    try {
      const { rows } = await listContactsOnNumber(db, accountId, number);
      people = rows.filter((r) => !r.holds_shared_number && isCallerIdNumber(r.phone, number))
        .map((r) => ({ id: r.id, name: contactDisplayName({ first_name: r.first_name, last_name: r.last_name }) }));
    } catch (e) {
      console.error(`conversations: account ${accountId} holding people read failed: ${loggableError(e)}`);
    }
    holding = { number, canMove: seesWholeAccount(access), holdingContactId: active.contactId, people };
  }
  ```
  (imports: `listContactsOnNumber` from `@bis/db`, `isCallerIdNumber` from `@/lib/voice/phone-number`, `seesWholeAccount` from `@/lib/auth-role`, `holdingLabel` from `@/lib/contacts/holding-label`.)
- **`[acct]/calls/[callId]/page.tsx:244-251`:** the conversation link becomes, when `call.conversation_id && !call.contact_id`, `{ key: "conversation", href: `${base}/conversations?c=${call.conversation_id}`, label: m["call.holding.openTexts"], Icon: MessagesSquare }` (P20); every other call unchanged.
- **`[acct]/contacts/[contactId]/page.tsx:94-95`:** after `if (!contact) notFound();`:
  ```ts
  // S-47e (E8, spec 5.12.4): a shared number's holding record is not a customer; its page is its thread, so no
  // card, field, document, relationship or deal can be added to it.
  if (contact.holds_shared_number) {
    const thread = await findConversationForContact(db, accountId, contactId);
    redirect(`/dashboard/accounts/${accountId}/conversations${thread ? `?c=${thread}` : ""}`);
  }
  ```
  (`redirect` from `next/navigation`; `findConversationForContact` from `@bis/db`.)
- **`apps/web/src/app/api/accounts/[accountId]/search/route.ts:123`:** `label: v.holdsSharedNumber ? holdingLabel(v.sharedNumber, "en") : (joinName(v.contactFirstName, v.contactLastName) || UNNAMED),` (P21).
- **Tests:** `holding-label.test.ts`; `holding-move-handlers.test.ts`; `message-thread.test.ts` (a holding prop renders the label, the Notice in English and in Spanish word for word, the `data-holding-move` button when `canMove`, none when not, and a non-holding thread renders byte-identical to before: snapshot the existing fixture's HTML before your edit and compare); `conversation-list.test.ts` (a holding summary renders `Shared number (956) 555-0142`, never `Caller`); a new `…/convos/page.holding.test.ts` copying `page.test.ts`'s bare factory and adding `listContactsOnNumber` (people on the number, the holding record excluded, a Technician gets no Move, a failed read still renders the thread); `[acct]/calls/[callId]/page.test.ts` (a call with a conversation and no contact links `conversations?c=<id>` as "Open the texts"; one with a contact keeps "View conversation"); `[acct]/contacts/[contactId]/page.test.ts` (one new case adding `findConversationForContact` to its bare factory and mocking `next/navigation`'s `redirect`: a holding contact redirects to its thread; an ordinary one does not call it); `search/route.test.ts` (the label).
- **Baselines last:** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`, then `git diff --stat apps/web/src/lib/i18n/` (only the two baseline files; the keys Task 2 added appear).
- **Build once, after Tasks 6 and 10 have committed** (they edit the same worktree in this wave; a build over a half-edited file proves nothing): `pnpm --filter web build` (the client/server boundary: `holding-move.tsx` imports two server actions and the relationship search action; `message-thread.tsx` stays a server component). Run it alone; capture its exit code to a file.
- **Design (DESIGN.md):** tokens only (`--crit` for the search error, `text-muted-foreground`, the Notice's own tokens); both themes; the menu and dialog are overlays (`--glass-filter` comes with the components); one primary per view (Send); rule 6 (Move runs at once, with Undo for 10 s; no confirm dialog); rule 7 (the search's skeleton); `lang` on the new roots; the Notice survives the pseudo-locale's +35% (it wraps).
- Commit `inbox: a shared number's texts show as "Shared number {number}" with a note and a Move menu with Undo; its call opens the thread and its record page redirects there (S-47e E8)`.

**Verify (the affected-test rule):** (1) the six `…/convos/page*.test.ts` (bare; the page calls `listContactsOnNumber` only on a holding thread, so they stay green unedited: run them), `message-thread.test.ts`, `conversation-list.test.ts`, the record page test, the call page test, the search route test; (2) none; (3) none; (4) the record page's and `page.holding.test.ts`'s factories (above); (5) `grep -rn "View conversation\|calls.detail.viewConversation\|Shared number\|Move to" apps/web/e2e` → read each hit (expected none); (6) `[acct]/in-account-service-reads.test.ts` (no new value-level `serviceDb`: the page reads on the request client; run it). Typecheck; eslint; the build's exit code; the baselines' diff.

---

## Task 13 (LOW): The SIP attestation log line (bis-voice)

**Dispatch gate:** none (Wave A).

**Brief.**
- **`apps/web/src/lib/voice/attestation-log.ts`** (new): the model's code exactly (the four constants and `shownValue`, moved from `…/texml/telnyx-request.ts:63-67` and the value expression at `:101`).
- **`…/texml/telnyx-request.ts`:** delete `:63-65` and `:67` (`FIELD_NAME`, `ATTESTATION_FIELD`, `SAFE_VALUE`, `MAX_ATTESTATION`; `MAX_LISTED` at `:66` stays), import the four from `@/lib/voice/attestation-log`, and `:101` becomes `const shown = shownValue(value);`. Its existing tests (`…/texml/telnyx-request.test.ts`, and the texml route tests that read the `texml form fields:` line) pass WITHOUT EDITS: the extraction is byte-identical.
- **`apps/web/src/lib/voice/sip-headers.ts`** gains (imports `FIELD_NAME`, `ATTESTATION_FIELD`, `MAX_ATTESTATION`, `shownValue` from `./attestation-log`):
  ```ts
  /**
   * S-47e (spec 5.7, S13): what the SIP leg says about the caller ID's attestation, for ONE log line.
   * OBSERVATION ONLY: nothing is verified, stored or decided on it (A5: whether any of it reaches this leg is
   * what the line exists to find out). The STIR/SHAKEN `Identity` header prints only its `attest` (A, B or C),
   * never the token; a `verstat` parameter inside From or P-Asserted-Identity prints when it is a short word.
   * Bounded like logFormFields: at most MAX_ATTESTATION values; a name that could forge a log line is counted.
   */
  export function sipAttestation(eventData: unknown): string {
    const out: string[] = [];
    let unprintable = 0;
    for (const h of headers(eventData)) {
      if (out.length >= MAX_ATTESTATION) break;
      if (!h || typeof h !== "object" || typeof h.name !== "string") continue;
      if (!FIELD_NAME.test(h.name)) { unprintable += 1; continue; }
      const name = h.name.toLowerCase();
      const value = typeof h.value === "string" ? h.value : "";
      if (name === "identity") { out.push(`identity=${identityAttest(value)}`); continue; }
      if (name === "from" || name === "p-asserted-identity") {
        const v = /;\s*verstat=([^;>\s]*)/i.exec(value)?.[1];
        if (v !== undefined) out.push(`${name}.verstat=${/^[A-Za-z-]{1,40}$/.test(v) ? v : "(unprintable)"}`);
        continue;
      }
      if (ATTESTATION_FIELD.test(h.name)) out.push(`${h.name}=${shownValue(value)}`);
    }
    const extra = unprintable > 0 ? ` (+${unprintable} unprintable)` : "";
    return `${out.join(",") || "none"}${extra}`;
  }

  /** The `attest` claim of a STIR/SHAKEN PASSporT (header.payload.signature), or "(present)". Never throws. */
  function identityAttest(token: string): string {
    try {
      const payload = token.split(";")[0]!.trim().split(".")[1];
      if (!payload || payload.length > 4096) return "(present)";
      const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { attest?: unknown };
      return json.attest === "A" || json.attest === "B" || json.attest === "C" ? `attest:${json.attest}` : "(present)";
    } catch {
      return "(present)";
    }
  }
  ```
- **`…/incoming/route.ts:924`:** `log("incoming call", { callId, callerNumber, calledNumber, sipHeaderNames: sipHeaderNames(event.data), attestation: sipAttestation(event.data) });` (`sipAttestation` joins the `@/lib/voice/sip-headers` import at `:92-94`).
- **Tests:**
  - `attestation-log.test.ts`: `shownValue("TN-Validation-Passed")` → itself; `"9565550142123"` → `"(redacted)"`; `"a\nb"` → `"(unprintable)"`; a 65-character plain value → `"(unprintable)"`.
  - `sip-headers.test.ts`, `describe("sipAttestation")` (event data built as the file's own `ev([...])` helper builds it): `[]` → `"none"`; a header `X-Attest-Level: B` → `"X-Attest-Level=B"`; `Identity` with a payload `base64url(JSON.stringify({ attest: "A", orig: { tn: "19565550142" } }))` → `"identity=attest:A"` (and the line holds no `19565550142` and no part of the token); `attest` B and C likewise; a malformed token, a payload over 4,096 characters and `attest: "D"` → `"identity=(present)"`; `From: <sip:+19565550142@x;verstat=TN-Validation-Passed>;tag=1` → `"from.verstat=TN-Validation-Passed"`; a verstat of 41 letters → `"(unprintable)"`; a stir header holding 7+ digits → `(redacted)`; 12 matching headers → 10 printed; a name with a newline → counted, ` (+1 unprintable)`.
  - `…/incoming/route.test.ts`: one case reading the `"incoming call"` log call (the file's `logSpy` pattern, `:781`/`:959`) for a call whose `sip_headers` carry an `Identity` header with `attest: "B"` → its object has `attestation: "identity=attest:B"`; and the accept `fetch` body for that call deep-equals the one for the same call without the header (the accept is unchanged).
- Run `src/lib/voice/attestation-log.test.ts`, `src/lib/voice/sip-headers.test.ts`, `src/app/api/voice/texml` (all of it, unedited), `src/app/api/voice/incoming/route.test.ts`; typecheck; eslint.
- Commit `voice: the incoming-call log line says what the SIP leg carries about the caller ID's attestation, observation only (S-47e)`.

**Verify (the affected-test rule):** (1) the texml tests that read `logFormFields`' line (unedited, green); (2)–(6) none.

---

## Task 14 (LOW): The corpus stub follows the ladder (bis-voice)

**Dispatch gate:** Task 7 committed (the stub runs Task 5's flow and Task 7's take_message rule).

**Brief.**
- **`apps/web/src/lib/voice/modules/corpus-lib.ts`:**
  - `CorpusFixture` (`:38-43`) gains `contactsOnNumber?: { firstName: string; lastName: string; email?: string }[];` (absent = `[]`; `parseFixture` (`:112-118`) is unchanged, so every existing fixture parses).
  - A per-item session:
    ```ts
    import { emptyCallState, type CallState } from "../call-state";
    import { emailKey } from "@bis/db";
    import { requiredRung } from "../identity/ladder";
    import { candidateOf, type Candidate } from "../identity/match";
    import { findNeedsRead, findStep, confirmStep, ownsStep, messageNeedsNameCheck, messageNameStep, type CandidateRead } from "../identity/flow";
    import { pickRecordOnNumber, leadNeedsWhoseCheck, leadWhoseStep } from "../identity/record";
    import { BOOK_ASK_NAME, BOOK_AMBIGUOUS, BOOK_ASK_WHOSE } from "../identity/results";
    import { formatWhen as stubWhen } from "../../booking/time";

    /** O2, S24: the stub's per-item memory: the identity state and the bookings this item made. */
    export type StubSession = {
      state: CallState; candidates: Candidate[]; module: TradeModuleId; callerNumber: string | null; transfer: boolean;
      /** booking id -> the contact it belongs to (the found one, or "this-call" for one the item booked). */
      bookings: Map<string, string>;
      made: number;
    };
    /** The fixed booking a confirmed find answers (spec 5.11). */
    export const STUB_BOOKING = { bookingId: "stub-booking-1", startsAt: "2027-06-03T15:00:00.000Z" } as const;

    export function newStubSession(f: CorpusFixture, item: CorpusItem, module: TradeModuleId): StubSession {
      const candidates = (f.contactsOnNumber ?? []).map((c, i) => candidateOf({
        id: `stub-contact-${i + 1}`, first_name: c.firstName, last_name: c.lastName, email_key: c.email ? emailKey(c.email) : null,
      }));
      // The fixed booking exists from the start (the live tool's getBookingById finds any id it is given), owned
      // by the first contact until a confirmed find hands it to the one confirmed.
      return { state: emptyCallState(), candidates, module, callerNumber: item.callerId === "withheld" ? null : f.callerNumber,
        transfer: item.transfer, bookings: new Map(candidates.length > 0 ? [[STUB_BOOKING.bookingId, candidates[0]!.id]] : []), made: 0 };
    }
    ```
  - `StubContext` (`:165`) gains `session?: StubSession`. In `stubToolResult`, inside `if (ctx.medium === "phone")` and before the existing branches, when `ctx.session` is set, the five tools run the live flow (the strings are `registry.ts`'s own, word for word; a parity test proves it):
    ```ts
      const s = ctx.session;
      if (s) {
        const next = s.transfer ? "offer to put them through to someone on the team with transfer_to_human" : "offer to take a message with take_message";
        const read: CandidateRead = { ok: true, candidates: s.candidates, truncated: false };
        if (name === "find_my_booking") {
          if (!s.callerNumber) return { found: false, verified: false, error: "This call has no visible caller number, so appointments can't be looked up on it — not by a number the caller says, either. " + `Apologize, then ${next} so the team can help them.` };
          const required = requiredRung("read_existing", s.module);
          const step = findStep(s.state, required, findNeedsRead(s.state, required) ? read : null, next);
          s.state = step.state;
          if (step.kind === "answer") return { ...step.result };
          s.bookings.set(STUB_BOOKING.bookingId, step.contactId);
          return { found: true, ...STUB_BOOKING, startsAtLocal: stubWhen(new Date(STUB_BOOKING.startsAt), ctx.timezone) };
        }
        if (name === "confirm_identity") {
          if (!s.callerNumber) return { ...noCallerId(next) };
          const step = confirmStep(s.state, requiredRung("read_existing", s.module), read, args, next);
          s.state = step.state;
          return { ...step.result };
        }
        if (name === "cancel_appointment" || name === "reschedule_appointment") {
          const bookingId = String(args.bookingId ?? "");
          const owner = s.bookings.get(bookingId);
          if (!owner) return { ok: false, error: "no such booking — use find_my_booking first" };
          const verdict = ownsStep(s.state, requiredRung("change_existing", s.module),
            { bookingId, contactId: owner, contactPhone: s.callerNumber, callerNumber: s.callerNumber }, next);
          if (!verdict.owned) return { ...verdict.result };
          return { ok: true };
        }
        if (name === "take_message" && messageNeedsNameCheck(s.state, s.callerNumber, args)) {
          const ask = messageNameStep(s.state, read);
          if (ask) { s.state = ask.state; return { ...ask.result }; }
        }
        // P27: the same "for you or for someone else?" a live lead asks, once.
        if (name === "capture_lead") {
          const { fields, result } = capturePhoneLead(args.fields, s.callerNumber);
          if (result.ok !== true) return result;
          const fse = typeof args.forSomeoneElse === "boolean" ? args.forSomeoneElse : undefined;
          if (leadNeedsWhoseCheck(s.state, fields.fullName, fse)) {
            const ask = leadWhoseStep(s.state, read, fields.fullName);
            if (ask) { s.state = ask.state; return { ...ask.result }; }
          }
          return result;
        }
      }
    ```
    (`noCallerId` joins the imports from `../identity/results`; `withBooking` from `../call-state`.) The existing `book_appointment` branch (`corpus-lib.ts:200-203`) becomes, so a booking the item makes can be moved or cancelled on it (rung 0, S18):
    ```ts
        if (name === "book_appointment") {
          const { name: who, dropped } = bookingName(args.name);
          if (!who) return withDroppedNote({ ok: false, error: "name required" }, dropped, "phone");
          if (ctx.session) {
            const s2 = ctx.session;
            // P27: the live picker's refusals, over the fixture's contacts on the caller ID (a recited number is
            // not modelled: the stub books it).
            if (s2.callerNumber && !String(args.phone ?? "").trim()) {
              const pick = pickRecordOnNumber({ onNumber: s2.candidates, truncated: false, name: who,
                email: typeof args.email === "string" ? args.email : null,
                confirmedId: s2.state.identity.confirmed?.contactId ?? null,
                forSomeoneElse: typeof args.forSomeoneElse === "boolean" ? args.forSomeoneElse : undefined });
              if (pick.kind === "ask_name") return { ...BOOK_ASK_NAME };
              if (pick.kind === "ambiguous") return { ...BOOK_AMBIGUOUS };
              if (pick.kind === "ask_whose") return { ...BOOK_ASK_WHOSE };
            }
            const id = `stub-made-${++s2.made}`;
            s2.bookings.set(id, "this-call");
            s2.state = withBooking(s2.state, { id, contactName: who, startsAt: String(args.startsAt ?? ""), endsAt: String(args.startsAt ?? "") });
            return { ok: true, bookingId: id };
          }
        }
    ```
- **`apps/web/scripts/sofia-corpus.ts:214`:** `const session = newStubSession(f, item, moduleId!);` then `const stub: Stub = (name, a, said) => stubToolResult(name, a, { medium: item.medium, timezone: f.timezone, said, session });` (`newStubSession` joins the `corpus-lib` import at `:22-27`).
- **`corpus-lib.test.ts:437`** (the pinned regex, P11): `/stubToolResult\(name, a, \{ medium: item\.medium, timezone: f\.timezone, said \}\)/` → `/stubToolResult\(name, a, \{ medium: item\.medium, timezone: f\.timezone, said, session \}\)/`, plus `expect(src).toMatch(/const session = newStubSession\(f, item, moduleId!\);/)`. `:438`'s count of 2 stays.
- **`corpus-lib.test.ts`**, new cases: with no `contactsOnNumber`, `find_my_booking` → `{ found: false }`; a `cancel_appointment` of an unknown id → `{ ok: false, error: "no such booking — use find_my_booking first" }`; a cancel of `STUB_BOOKING.bookingId` before any confirmation (two contacts on the number) → the NOT CONFIRMED YET object (mutation: today's `{ ok: true }` for every unmirrored tool → FAILS); a booking the item made can be cancelled with no confirmation; a booking and a lead for "Ana Prueba" on a fixture with ONE contact ("Dan Lopez") get the `BOOK_ASK_WHOSE` and `LEAD_ASK_WHOSE` objects, and pass with `forSomeoneElse: true`; without a `session` every existing stub case answers as before (they pass unedited); every existing fixture still parses (read `modules/corpus/fixtures` and `parseFixture` each).
- **`apps/web/src/lib/voice/modules/corpus-parity.test.ts`** (new; P11): `@bis/db` mocked spread-real with `listContactsOnNumber` (the fixture's two contacts as rows on the fixture's number), `findUpcomingBookingForContact` (→ `STUB_BOOKING`), `getBookingById` (→ `STUB_BOOKING`'s row, `contact_id` the confirmed id), `getContact` (→ that contact with the fixture number), `setBookingStatus`, `insertAiActs`, `ensureConversation`, `createMessage`, `incrementUnreadCount`, `readEmailSuppression`, `isAccountOutboundSuppressed`, `serviceDb` (the registry test's own list, `registry.test.ts:14-35`). One fixture (Ana Prueba, Beto Prueba on `+19565550142`); one `ToolContext` built like `registry.test.ts:79-91` with that number and `tradeModule: "events"`; then the same sequence through `stubToolResult` (with a fresh session) and through `runTool` (threading its state), requiring `toEqual` at every step: `find_my_booking` (ASK NAME) → `confirm_identity { fullName: "Carla Prueba" }` (MISS) → `confirm_identity { fullName: "Beto Prueba" }` (CONFIRMED) → `find_my_booking` (found, `startsAtLocal` in the fixture zone) → `cancel_appointment { bookingId: STUB_BOOKING.bookingId }` (`{ ok: true }`); and on a fresh pair, `take_message { body: "Call me" }` (the name ask) then again (`{ ok: true }`); and on a third fresh pair, `reschedule_appointment { bookingId: "stub-booking-1", startsAt: "2027-06-04T15:00:00.000Z" }` before any confirmation (NOT CONFIRMED YET on both sides: the live `getBookingById` mock answers the row, and the stub's session holds the fixed booking from its start). The steps' count asserted first (5 + 2 + 1).
- Run `src/lib/voice/modules` (all of it), `system-prompt.test.ts`; typecheck; eslint. No corpus run (spec §3).
- Commit `voice: the corpus stub follows the identity ladder with the live tools' own steps, so a corpus run cannot pass it vacuously (S-47e O2)`.

**Verify (the affected-test rule):** (1) `corpus-lib.test.ts` (`:437`, above), `corpus.test.ts`; (2)–(6) none. `corpus-lib.test.ts:312-319` (the script imports no database value) stays green: `@bis/db` is imported by `corpus-lib.ts`, not the script (A3).

---

## Task 15 (LOW): The runbook's Step 8 (bis-platform)

**Brief.**
- In `docs/runbooks/voice-setup.md`, insert after "## Step 7 — Booking leg" (`:461-486`) and before "## Video meetings (Daily.co)" (`:487`) the text of spec §8 "The text of Step 8", byte for byte (the fenced block under "The text of Step 8 (the plan pins it):" in spec §8, as amended in the fix round: its 8.6c carries the R15 assumption; copy the fence's CONTENT, not the fence).
- `:795-796`'s paragraph gains one sentence at its end: "Since the identity-checks release, record the result in Step 8.7."
- Check: `node -e` diff of the inserted block against the spec's fenced block prints nothing; the runbook's own links still resolve (`grep -n "Step 8" docs/runbooks/voice-setup.md` lists the heading and the press-1 sentence).
- Commit `docs(voice): runbook Step 8, the real test calls for the identity checks and the shared number's holding thread (S-47e O1, O3)`.

---

## Task 16 (LOW): The e2e spec — Move and Undo on a holding thread (bis-e2e-qa)

**Dispatch gate:** Tasks 3, 4, 11 and 12 committed.

**Brief.** Create `apps/web/e2e/shared-number.spec.ts` (P12). Shape: `apps/web/e2e/one-switch.spec.ts:1-75` (the env loading, `readFixture`, `test.use({ storageState: "e2e/.auth/client-state.json" })`, `test.describe.configure({ mode: "serial", timeout: 60_000 })`).
- **Account:** the per-run fixture account only (`e2e/.auth/client-fixture.json`; skip the file with a reason when absent). Never `Test Client One`.
- **`beforeAll`** (service client, real writers only): a number unique to the run, `+1956555` + four digits from `Date.now()`; Ana and Beto through `createContact({ firstName, lastName: "Prueba", phone, matchBy: "email_only" })`; the holding record through `ensureHoldingContact`; its thread through `ensureConversation` and one inbound text through `createMessage({ channel: "sms", direction: "inbound", body: "test <run tag>", status: "delivered" })`.
- **Locators (R12):** never a bare `getByText("Beto Prueba")` or `getByText("Shared number …")`: after the Move the same words are in the toast, the thread header and the inbox row at once, and Playwright's strict mode fails on two matches. Scope every locator by role or by attribute:
  - the thread header: `page.locator("[data-thread-name]")`;
  - the inbox row: `page.locator(`[data-conversation-row="${holdingConversationId}"]`)`;
  - the menu: `page.getByRole("button", { name: m["conversation.holding.move"] })`, then `page.getByRole("menuitem", { name: "Beto Prueba", exact: true })`;
  - the toast: `page.locator("[data-sonner-toast]").filter({ hasText: "Moved to Beto Prueba." })`, and its Undo `.getByRole("button", { name: m["common.undo"] })`;
  - every literal is the catalogue's (`m[…]`, with `{number}`/`{name}` filled), never retyped.
- **Test 1, Move and Undo:** open `/dashboard/accounts/<id>/conversations?c=<holding conversation>`; the thread header reads `Shared number (956) 555-<digits>` and the Notice reads the English sentence with that number; the inbox row reads the same label; click "Move to…" (`[data-holding-move]`), then "Beto Prueba"; the toast reads "Moved to Beto Prueba."; the URL's `c` is Beto's conversation and the thread shows the moved text; click the toast's "Undo" within 10 s; the toast reads "Moved back."; poll the service client until the message's `conversation_id` is the holding thread again.
- **Test 2, the holding record is not a customer:** `/dashboard/accounts/<id>/contacts?q=<the run's digits>` lists Ana and Beto and no "Caller" row; `/dashboard/accounts/<id>/contacts/<holding id>` lands on the holding thread (`?c=`).
- **`afterAll`** (always, best-effort: the per-run fixture account is itself removed by `auth.teardown.ts`): delete the three contacts' messages and conversations, then `deleteContacts(svc, accountId, [ana, beto, holding], { conversationsDb: svc })` (`packages/db/src/contacts.ts:1193-1202`), then re-read that none remains; collect problems and throw at the end (`ai-disclosure.spec.ts:146-202`'s shape).
- **Verify:** `pnpm --filter web exec playwright test --list e2e/shared-number.spec.ts` lists 2 tests (source `.env.local` into the shell only); typecheck; eslint. Commit `e2e: staff move a shared number's texts to a person and undo it, and its holding record never shows as a customer (S-47e)`.
- **Run once, by the orchestrator, before Task 17**, against a PRODUCTION build: check no `screenshots.yml` run is in progress (CLAUDE.md) and that nothing else is building; `USE_DEV_SERVER` unset, so the config's own webServer runs `pnpm build && pnpm start` (`apps/web/playwright.config.ts:247`); then `pnpm --filter web exec playwright test e2e/shared-number.spec.ts`, alone. Paste the summary line into the ledger.

---

## Task 17: Final review, design review, one fix agent (checkpoint)

- [ ] **Before it:** Task 16's one local run against a production build (its last bullet) is in the ledger, green.
- [ ] **bis-reviewer, opus, fresh context**, on `git diff <rebased spec commit>...HEAD`, in its own detached worktree, with its kit on 55506/55507/55508 (PostgREST up).
  - Read spec §§2 and 4–9 (E1–E8, O1–O3, S1–S29) and this plan (P1–P21).
  - Run every touched test file by path and both typechecks. On `post`: `shared-number-holding-schema`, `definer-search-path`, `schema-grants-guard`, `proposals-drop`, `server-only-writes-grants`, `voice`, `contacts`, `contact-import`, `messaging`.
  - Re-check 0098's md5 against Task 1's (`fbee986eb08d1502eed552f4c1eed5a0` after its review fix round, P32, or the re-reviewed one if it changed again).
  - Three probes of its own: a byte-identity probe of the prompt (`system-prompt.test.ts`'s three digests, plus a `buildSystemPrompt` diff of one input at `a1ccb19a` against HEAD → no difference); a read/act split (find confirms one contact but `findUpcomingBookingForContact` is called for another: make `findStep` return the first candidate and see what fails); a picker/writer split (`book_appointment` picks `existing` but `createBooking` receives `state.contactId`).
  - **Hunt:**
    - a path where a household member's appointment is read, moved or cancelled without that person's name (or name and email on insurance) on THIS call;
    - an identity result, a log line or a To-do carrying a candidate's name, email or number;
    - a confirmation that crosses calls, or a confirmation of the caller ID used for a recited number;
    - a third try that reads, or a lock that a later confirm lifts;
    - a write (booking, lead, message thread, fill) that lands on a contact the caller neither named nor confirmed on a shared number;
    - any writer, dedupe, list, count, export, picker or import match that can return a holding record (E8, spec §5.12.3);
    - a holding record that gains a name or an email by any path, staff included;
    - a holding thread whose call row gets a contact, or whose contact reaches `generateProposals`;
    - an Undo that can move more than the move moved, or anything a move between two OTHER threads moved (P1), or a Move a Technician can run;
    - a signed-in edit that changes a holding record (P24), or a holding record with no first name or a non-E.164 phone (P22, P23);
    - a found result after a name confirmation without `FOUND_BY_NAME_NEXT`, or a name on a one-contact number that confirms the contact without matching it (P25);
    - a one-contact number that gains a contact without `forSomeoneElse: true`, or a nickname ("Daniel" for "Dan") that lands nowhere after `false` (P27);
    - a household member's YES applied to another member's appointment, or a reply To-do filed twice for one text (S30);
    - a 503 that Telnyx would retry forever (P23: none is left; the only 503 on the holding path is a race a retry recovers from);
    - the identity To-do filed twice, on a customer, in the caller's language, or for a transferred call or a recording;
    - a `''` or an apostrophe in 0098; a definer without `pg_temp` last;
    - a test that cannot fail (a guard a comment satisfies; a loop that never ran; an assertion built by the function under test; a `-t` filter that matches nothing).
- [ ] **bis-design-reviewer, opus**, on Task 12's diff, with a running build if the orchestrator provides one (a source audit otherwise):
  - tokens only; both themes via `.dark`; the blur fallback (the menu and dialog are overlays; the thread card does not blur);
  - rule 3 (none of this is a status, so no dot is owed; say so if you disagree);
  - rule 5 (the search's loaded, empty, error and loading states; the holding people read failing);
  - rule 6 (Move runs at once with Undo; no confirm dialog);
  - rule 8 (the thread's one primary stays Send; "Move to…" ghost);
  - the thread header at 360 px in the pseudo-locale (the Notice wraps; the label and the button share one row);
  - keyboard: the trigger's focus ring, the menu's arrows and Esc, the dialog's Esc, the search results reachable by Tab;
  - the 7 AM read of every new string in both languages, with Q1's four drafts named for the owner.
- [ ] **ONE fix agent** takes both reports' Critical, Important and agreed Minor items.
  - A sonnet fix-review runs only if the fix touched HIGH-tier code (0098, its tests, the gate, the record rule, the holding writers, the inbound route). Otherwise the orchestrator reads the fix diff and re-runs the touched tests by path.
  - **0098 goes to bis-ci and production only with its reviewed md5 UNCHANGED.** Once 0098 is on bis-ci it is never edited: a SQL change found after that is a new migration (0099), reviewed HIGH.
  - The prompt digests stay green untouched through the fix.

---

## Task 18: Rollout (orchestrator; spec §8)

Each step reads its own evidence. Nothing is inferred from an earlier run.

- [ ] **1. bis-ci 0098** (after Task 1's review approves).
  - A1 again: `git log --all --oneline -- 'packages/db/supabase/migrations/0098*'` lists only this branch's commit.
  - In the file: `grep -c "set search_path = pg_catalog, pg_temp" packages/db/supabase/migrations/0098_shared_number_holding.sql` → `3` (the header line 24 and the two functions); the two-apostrophe count → `0`; `md5sum` → the reviewed md5.
  - `gh workflow run ci-project-setup.yml --ref feat/s47e-identity -f step=push-dry-run`. Its log lists exactly `0098_shared_number_holding.sql`. Then `-f step=push`.
  - Read-only post-checks on bis-ci (MCP `execute_sql`, `odnobiodsftffphuuosz`): the column (`boolean`, `NO`, `false`); `pg_get_constraintdef` of `contacts_holding_shape` and `indexdef` of `contacts_one_holding_per_number` and `pg_get_triggerdef` of `contacts_holding_server_only`, each equal to Task 1's pins; both functions' `prosecdef`/`proconfig`/owner equal to Task 1's pin; `has_function_privilege` service_role t, authenticated f, anon f; the definer count `23`; the client-write digest → **`52|b66203ca5d355155540b520af510d120`**; `select count(*) from public.contacts where holds_shared_number` → `0`.
  - If a Preview read then fails naming `holds_shared_number`, PostgREST's schema cache is stale: `notify pgrst, 'reload schema'` once on bis-ci, then re-read.
  - Ledger: `0098 APPLIED to bis-ci … NEVER RE-APPLY`.
- [ ] **2. Push and CI.**
  - Read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`).
  - `shared-number.spec.ts` must have RUN (not skipped): read its lines in `gh run view --log`.
  - Read every red check before calling it expected (memory "CI vs local divergence").
- [ ] **3. Preview by hand** (bis-ci, a test account, never Test Client One): seed a shared number's holding thread on the fixture account the way Task 16's `beforeAll` does; the inbox label, the Notice and Move with Undo in both themes, English and `?locale=es`, at 360 px and desktop width; a Staff test user can Move, a Technician sees no Move (memory "Smoke identities"); the record page of the holding record redirects; the palette finds the thread by a word of its text and shows the label; the Voice page's insurance hint shows the new sentence.
- [ ] **4. Production 0098**, BEFORE the merge:
  - Pre-flight: the newest migration name is `one_switch`.
  - MCP `apply_migration`, project `tlbkbmlrfafquucsmsmm`, name `shared_number_holding`, the exact reviewed text, ONCE.
  - Post: the same reads as step 1, the digest included; `select md5(array_to_string(statements, '')) from supabase_migrations.schema_migrations where name = 'shared_number_holding'` equals the file's md5 (the file has no backslash and no two consecutive apostrophes, so memory "MCP SQL escapes" cannot bite).
  - Ledger: `0098 APPLIED to production … NEVER RE-APPLY`.
- [ ] **5. Parity.** Runbook §5 (`docs/runbooks/ci-supabase-project.md`): `-f step=fingerprint` on bis-ci and `packages/db/supabase/parity/fingerprint.sql` on production; equal on every 0098 object (the column, the CHECK, the index, the trigger, the two functions, the function grants). Also read, read-only, on both: `select p.oid::regprocedure, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig from pg_proc p where p.proname in ('contacts_holding_server_only', 'move_holding_thread') order by 1::text;` → owner `postgres`, `prosecdef` f then t, `{"search_path=pg_catalog, pg_temp"}` for both.
- [ ] **6. PR and merge.**
  - `gh pr create`. The body names:
    - E1–E8 (owner), O1–O3 (orchestrator), S1–S29, and P1–P21 with their resolutions;
    - Q1's four drafts;
    - both apply lines and the md5;
    - the tiers;
    - "LOAD-BEARING: contacts.holds_shared_number (every contact write's dedupe: the booking page, forms, the web chat, inbound email and texts, the CSV import, Sofía; the contact list, its total, its export, search and every picker; every contact read through COLS; the inbox list, a thread's summary and the palette's conversation results; every call), and public.move_holding_thread (the inbox Move)";
    - "No env var changes; nothing added to Preview";
    - spec §8 step 2's sentence on what merging changes, with Task 0's read 6 ("N numbers on production have two or more contacts today; on those, Sofía now asks whose appointment it is"). Every pack stays off (E4); nothing is backfilled.
  - Only after step 4: `gh pr merge <n> --auto --squash --match-head-commit <sha>`, with the head SHA's `verify` and `e2e` green.
- [ ] **7. After the deploy** (READY on the merge SHA, aliased to `app.bis-rgv.com`):
  - **Smokes:** `/` 200, `/sign-in` 200, `/b/bogus` 404.
  - **Read-only:** `select count(*) from public.contacts where holds_shared_number` (grows only when a shared number first gets a missed-call text or sends a text); the Vercel log has no `listContactsOnNumber failed` or `contact dedupe failed` line in the first hour.
- [ ] **8. The owner's real test calls (the exit gate; E6).** The runbook's Step 8 (Task 15), on BIS's own account (`+19565061545`, status testing). danlo places the calls; the orchestrator does every dashboard step and writes each time in the ledger:
  - 8.1 the contacts on danlo's mobile before the calls;
  - 8.5's insurance switch: Voice page → Trade rules → Insurance (property & casualty) → Save, the time written down JUST before Call 4, and Trade rules → None → Save straight after, the time written down; every call between the two times ran under the insurance rules;
  - 8.7's two attestation lines copied for every call ("none" is a result);
  - 8.8's clean-up.
  - A booking or a time for the wrong person, a name said by Sofía before the caller said one, a To-do missing after 8.4, or a text filed on Dan Lopez, Ana or Beto in 8.6 is a failed release: revert the PR (the app only; 0098 stays).
- [ ] **9. Tracker and ledger** (memory "Roadmap tracker"): F-116 part → done once Step 8 passes, with the ledger entry of its 8.7; the S-47 subproject row: part e done; bump `meta/plan` asOf and mainSha, with `if_version`. Ledger `s47e MERGED`.

**Rollback:** revert the PR; 0098 stays (additive: the old build never names its column or function). A To-do it filed stays an ordinary To-do; a holding record reads to the old build as an ordinary "Caller" contact on that number, which its phone dedupe may then match. Dropping 0098 itself (its header's ROLLBACK lines) only after the app is reverted, and only on an owner decision, because it turns every holding thread into an ordinary contact's.

---

## Notes for the owner (no decision reopened)

- **On merge, every number with two or more contacts starts asking whose appointment it is** (Task 0's read 6 gives the count on production). A number with one contact is today's behaviour: its caller hears that contact's appointment without giving a name (rung 1 is the caller ID, E4, spec §5.3's table), even if they name someone else.
- **A holding call has no resend button** for a failed text-back (P18): the button needs a contact, and the call deliberately has none. The failure badge still shows; staff reply from the holding thread.
- **A STOP texted from a shared number files its consent To-do on the holding record** (P19). The ledger itself is keyed by the phone number, so the stop applies to everyone on it, as today.
- **The spec's Undo was one guard short** (P1): an Undo naming messages but no calls would have moved a household member's own calls to the holding thread. The Undo now names its move and nothing else; proven on the replica.
- **The holding record's shape check admitted a record with no first name** (P22, found while fixing). Fixed in 0098 before anything was applied anywhere.
- **On a phone with one contact, a booking or lead for a different name now asks "Is this for you or for someone else?"** (P27). A nickname ("Daniel" for "Dan") then lands on the contact once the caller says it is them.
- **A new person made on a shared number is filed in the duplicates table with the contact it shares the phone with** (P29), so a nickname that became a second record can be merged once a merge screen exists (none reads the table yet).
- **The two shared-number To-dos are in the account's language** (Q2); today's consent To-dos stay English.
- **The name rule's trade-off** (P26, the orchestrator's ruling): a spoken name is the record's person when every word of the record's name was spoken. So "José Antonio Garza", who is not on file, partially matches "José Garza" and is confirmed as José (on a shared number, and on a one-contact number where "José Garza" is the one contact). An insurance account's rung 2 still asks for the email on file; on every other account the caller ID plus the name is the bar E4 sets.
- **A holding record can still be tagged** through `contact_tags`, which 0098 does not guard (it is its own table, with its own grant). No screen reaches it: the record page redirects to the thread, and the contact list leaves it out. A tag on it changes nothing a customer sees.
- **Q1:** four staff-facing strings the spec did not draft are pinned as the plan's drafts (the Move's search and its role refusal). Change any by answering Q1; the fix round applies it.
- **No corpus run** (spec §3; the modules are paused). The stub now follows the ladder, so the next run cannot pass it by accident (O2).

---

## Spec coverage

| Spec | Where |
|---|---|
| §1 Why (shared phone, no pack can ask for more, attestation unread) | Tasks 6, 7, 8 (E3/E7), 5 (ladder), 13 |
| §2 E1 scope | the whole plan; one-time codes out (rung 3 declared, Task 5) |
| §2 E2 rung 2 = full name + email, compared by code | Task 5 (`decideIdentity`, `spokenEmailKey`, `results.ts`), Task 6 (the "nothing of theirs" case) |
| §2 E3 the name picks on a shared phone | Task 5, Task 6 (S7 case) |
| §2 E4 insurance rung 2, events rung 1, packs off | Task 5 (`ladder.ts`), Task 6 (insurance cases), Task 18 step 6 |
| §2 E5 two tries, then a message; one To-do; never which detail | Task 5 (`withMiss`, MISS/LOCKED), Task 6 (lock case), Task 9 (the To-do) |
| §2 E6 one rung-2 test call, switched before and after | Task 15 (Step 8.5), Task 18 step 8 |
| §2 E7 one record rule on a shared number | Tasks 4 (`matchBy`), 7 (the call), 8 (after the call) |
| §2 E8 the holding record | Tasks 1, 3, 4, 8, 10, 11, 12 |
| O1 `emailKey` barrel, `workRowHref`, runbook Step 8 | Task 3, Task 9, Task 15 |
| O2 the corpus stub follows the ladder | Task 14 |
| O3 F5 into Step 8 | Task 15 (8.7) |
| S1 candidates by `phone_key` + `isCallerIdNumber`, at most 20 | Task 3 (`listContactsOnNumber`, P4), Task 5 (`realCandidates`) |
| S2 the name rule (amended, R2 ruling a) | Task 5 (`nameWords`, `nameMatch`, `nameHits`; P5, P26) |
| S3 the email rule | Task 5 (`spokenEmail`, `spokenEmailKey`; the dash words, P28) |
| S4 same-name pairs | Task 5 (decision table cases) |
| S5 what a try is | Task 5 (`confirmStep`), Task 6 (read-failed case) |
| S6 cannot on this call | Task 5, Task 6 (insurance no-email case) |
| S7 one confirmed contact at a time; a different person is confirmed first (R1) | Task 5, Task 6 (P25) |
| S8 confirm returns no appointment | Task 5 (`CONFIRMED`), Task 6 |
| S9 move/cancel need the confirmation (SD9) | Task 6 (`ownsStep`, the S9 case; P7) |
| S10 the call's one To-do | Task 9 |
| S11 the To-do opens the call | Task 9 (`workRowHref`, P13) |
| S12 no stored note; the log line | Task 6 (`logIdentity` case) |
| S13 attestation on the SIP leg | Task 13 |
| S14 the sentences, pinned | Task 5 (`results.ts`, `results.test.ts`) |
| S15 the rung reads the call's own module stamp | Task 6 (`ToolContext.tradeModule` from `tradeStamp`) |
| S16 the Voice page's insurance hint | Task 2 |
| S17 `findUpcomingBookingForPhone` removed | Task 6 (P17) |
| S18 a locked call can still book, message, and change its own booking | Task 6 (the locked case) |
| S19 one picker for every write | Task 7 (`record.ts`), Task 8 |
| S20 "shared" judged on the stored number; one contact asks whose it is (amended, R2 ruling b) | Task 7 (`pickRecordOnNumber`, `forSomeoneElse`, `capture_lead`), Task 8 (the lead in the booking's order); P27 |
| S21 a new name makes a new contact (`matchBy`, still flagged for the merge queue) | Task 4 (P29), Task 7, Task 8 |
| S22 `take_message` asks for a name | Task 5 (`messageNameStep`, P6), Task 7, Task 8 |
| S23 a second booking is picked again | Task 7 (both S23 cases) |
| S24 the stub follows the ladder | Task 14 (P10, P11) |
| S25 the text-back on an unconfirmed shared number | Task 8 |
| S26 the mark is a new server-only column | Task 1 |
| S27 every inbound text from a shared number files on the holding record | Task 10 |
| S28 Move moves messages and calls, with an Undo bound to its move (amended, R11) | Task 1 (`move_holding_thread`, P1), Task 3, Task 11, Task 12 |
| S30 replies and CANCEL words from a shared number (added, R3) | Task 10 (P30), Task 2 (`todo.sharedNumber.*`) |
| S29 the holding record is not a customer | Task 4 (lists, counts, import), Task 12 (label, redirect, palette) |
| §4 data, §4.1 0098, its grants and rollback | Task 1 (Plan-writer check, P1–P3) |
| §4.2 load-bearing | P8; Task 18 steps 4, 6 |
| §5.1–5.4 the ladder, candidates, matching, the tools | Tasks 5, 6 |
| §5.5 the prompt does not change | Global constraints ("The prompt"); every voice task's Verify |
| §5.6 the To-do | Task 9 |
| §5.7 attestation | Task 13 |
| §5.8 web chat and demo at rung 0 | not touched (File map) |
| §5.9 logs | Task 6 |
| §5.10 the record rule | Tasks 4, 7, 8 |
| §5.11 the corpus stub | Task 14 |
| §5.12 the holding record | Tasks 1, 3, 4, 8, 10, 11, 12 |
| §6 copy | Task 2 (+ Q1, Q2) |
| §13 fix round (R1-R15) | P1, P19, P22-P31; every task they name |
| §7 tests | Tasks 1, 3–14, 16 (P12) |
| §8 rollout, Step 8 | Task 15, Task 18 |
| §9 tiers | Tiers table (the binding process rule's tiers; spec §9's MEDIUM `listContacts`/`countContacts` ride in HIGH Task 4 because they share `contacts.ts` with the dedupe) |
| §11 no open questions | Q1 is a gap in §6's drafts, non-blocking, with a recommendation |
