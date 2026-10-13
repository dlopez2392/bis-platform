# A language on every contact (S-09 PR 1, migration 0076): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every contact carries a language (`en` / `es` / not set) with its source and the time it was set, filled from the customer's own first clear sign (a web booking or form in a language that differs from the account's, a phone booking or call where they clearly spoke it), never over a staff choice; the record page and the list drawer show it as a Language line under Phone with inline edit, Undo, and a Switch / Keep hint when later evidence disagrees; text the customer typed carries the contact's language; 0076 also creates the Spanish-box columns PR 2 will use. No customer message changes in this PR.

**Architecture:** One migration (0076, spec C17/Q6) adds seven columns to `contacts`, a service-role-only SQL writer `public.record_language_signal` (C3) that sets the language only when it is null and keeps the newest signal, a plain BEFORE INSERT trigger that nulls the seven columns on a client-role insert (C2), and PR 2's six `*_es` / `*_es_basis` columns with Q1's "emptied" data step. `@bis/db` wraps the writer (`recordLanguageSignal`, which emits `contact.language_set` only when it set the language) and the three staff writes. Four signal points call it best-effort after their own durable write; the caller's language is a new strict reader, `clearCallerLanguage` (C5), whose thresholds are tuned on a read-only production sample before merge (Q7). The hint is computed on read (`languageHint`, C4); the Details line is a server-built `LanguageView` rendered by one `LanguageField` on both surfaces.

**Tech Stack:** Postgres 17 (bis-ci, production) with a local PG18 replica for proofs; supabase-js; Next.js 16 App Router (server actions, route handler, client components); React 19.2; Radix Select (the kit's `Select`); sonner toasts; vitest (`renderToStaticMarkup`, no DOM; `vi.mock`); Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Spec:** `docs/superpowers/specs/2026-10-13-customer-language-design.md` (commits `24514df3`, `e1c1a918`, `1292b9c2`; OWNER-APPROVED 2026-10-13: Q1 keep their English, the Spanish of customised bodies marked emptied; Q2, Q3, Q4 as recommended, backfill only after read-only production counts; Q5 usted; Q10 measure before PR 2; orchestrator rulings Q6 one migration, Q7 thresholds tuned on stored transcripts before PR 1 merges, Q8 instant reply as shipped, Q9 the SMS reminder's closing line gets a box). Base: `0d6d0edc` (#255). Every file:line below was read off this worktree at `1292b9c2`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s09-language` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s09-language`). `<SCRATCH>` = the session scratchpad, written out as a literal absolute path in every command (shell state does not survive between bash calls). `…/contacts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/`. `…/summary/` = `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/`.

## Global Constraints

- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-db-schema:** `packages/db/supabase/migrations/0076_customer_language.sql`; `packages/db/src/test/customer-language-schema.test.ts`; the calendars column lists in `packages/db/src/test/{schema-grants-guard,booking-grants,call-proposals-grants}.test.ts`; the SQL review of Task 14's emitted backfill statements.
  - **bis-voice:** `apps/web/src/lib/voice/language.ts` and a new `language.clear.test.ts`; `apps/web/src/lib/voice/finish-call.ts`, `finish-call.test.ts`; `apps/web/src/lib/voice/tools/registry.ts`, `registry.test.ts`.
  - **bis-booking:** `apps/web/src/app/b/[publicId]/actions.ts`, `actions.test.ts`.
  - **bis-crm:** `packages/db/src/contacts.ts` (`COLS`, the language types and writers), `packages/db/src/record.ts` (`groupActivityMembers` only), `packages/db/src/index.ts` (one export line), `packages/db/src/test/contact-language.test.ts`, `packages/db/src/test/record.test.ts` (one case); `apps/web/src/lib/contacts/{language,language-backfill}.ts` and their tests; `apps/web/src/lib/forms/enrich.ts` and the `@bis/db` mock factories that reach it (`app/f/[publicId]/actions.test.ts`, `lib/concierge/lead.test.ts`, `app/api/concierge/[publicId]/turn/route.test.ts`); `…/contacts/actions.ts`, `actions.test.ts`; `…/contacts/{language-field.tsx,language-field-handlers.ts}` and their tests; `…/contacts/contact-drawer.tsx`, `contact-drawer.wiring.test.ts`; `…/contacts/[contactId]/{contact-fields-panel,page,activity-timeline}.tsx` and their tests; `…/summary/route.ts`, `route.test.ts`; `apps/web/src/lib/contacts/drawer-summary.ts` (+ test); `apps/web/src/lib/record/recent-rows.ts` (+ test); `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/{group-timeline,page}.tsx` (+ a new test); `apps/web/scripts/backfill-contact-language.ts`; `apps/web/src/lib/messages.ts` (the `contact.language.*` and `language.name.*` keys); `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (regenerated, never hand-edited).
  - **bis-comms:** `packages/db/src/messaging.ts` (`ConversationSummary.contactLanguage`), `packages/db/src/test/messaging.test.ts` (one case); `…/conversations/{message-thread,page}.tsx`, `message-thread.test.ts`. (Spec §20 gives the conversations thread to bis-comms; the brief's owner list omits bis-comms, so this plan keeps the spec's owner.)
  - **bis-frontend:** no task. `LanguageField` is a feature component built from the kit's existing `Select` and ghost `Button`; no kit piece and no variant changes, so `/styleguide` is untouched (DESIGN.md DoD's last line does not bind). If review asks for a kit change, it becomes a bis-frontend task then.
  - **bis-e2e-qa:** `apps/web/e2e/contact-language.spec.ts` (new); `apps/web/e2e/fixtures/fixture-names.test.ts` only if it reports the new stamped names.
  - **Orchestrator:** the read-only production reads (Tasks 3 and 19), the backfill runs, the migration applies, `DESIGN.md` (spec §21's bullet), the ledger, the gates, the PR.
- **Shared files, one task at a time, in this order.**
  - `apps/web/src/lib/messages.ts`: **Task 6 only** (every §15.2 key plus the two this plan adds). A `.es` twin goes on the line directly under its English key; the block goes directly after `"contact.source.machine.form.es"` (`messages.ts:726` today).
  - `packages/db/src/index.ts`: **Task 5 only**, one line directly after the barrel's (`export { readPhoneCountryFlag, setContactPhoneCountry, phoneFields } from "./contacts";`, `index.ts:23`).
  - `apps/web/src/lib/voice/language.ts`: **Task 2 → Task 4.**
  - `…/contacts/[contactId]/page.tsx`, `…/summary/route.ts`, `…/summary/route.test.ts`, `lib/contacts/drawer-summary.ts` (+ test): **Task 11 → Task 12.**
  - `…/contacts/actions.ts`, `actions.test.ts`: **Task 10 only.**
  - `…/contacts/contact-drawer.tsx`, `contact-drawer.wiring.test.ts`: **Task 11 only.**
  - `apps/web/src/lib/i18n/*-baseline.json`: **Task 15 only**, after Tasks 6, 11, 12 and 13 have committed.
- **Migrations (memory: local DB replica; bis-ci and production are applied by the orchestrator only).** bis-db-schema writes 0076 and proves it on a **local PG18 replica on its own port** (table below), red on `pre` and green on `post`, every mutation probe red BY NAME on the replica. No agent applies 0076 anywhere else. **No `@bis/db` vitest may run against bis-ci until Task 19 step 2 has applied 0076 there:** every db test in this plan runs on the replica (`withRollback` suites) or on the replica behind a local PostgREST (`withTestAccount` suites), or is proven by CI `verify`'s in-runner stack after the orchestrator pushes. A run that needs 0076 is never pointed at bis-ci or production.
- **Replica ports (one per agent, never `5432`):** Task 1 implementer `55490`, Task 1 reviewer `55491`; Task 5 implementer Postgres `55492`, PostgREST `55493`, gateway `55494`; Task 5 reviewer `55495`/`55496`/`55497`; Task 12 `55500`/`55501`/`55502`; Task 13 `55503`/`55504`/`55505`; spare `55498`, `55499`. Scratch: `<SCRATCH>/s09-t<N>-impl/` and `<SCRATCH>/s09-t<N>-review/`.
- **SQL rules:** migration files are ASCII only with no backslash anywhere (the MCP apply rule, memory "MCP SQL escapes"; checked with a node byte count that has a positive control, because `grep -P` exits 2 silently in Git Bash). A null in a policy or guard fails CLOSED: every boolean built from a nullable value is `coalesce(…, false)` or `is distinct from` (memory "plpgsql NULL guard"); `record_language_signal` raises on any NULL argument before it reads anything. A Supabase `head: true` count throws on `count === null` (memory "head-count null"); this plan adds no count, and a reviewer who finds one checks it.
- **Lists that enumerate columns:** the three calendars UPDATE lists (`schema-grants-guard.test.ts:69-72`, `booking-grants.test.ts:15-27`, `call-proposals-grants.test.ts:129-132`) gain `followup_body_es` and `followup_body_es_basis`; the two contacts UPDATE lists (`schema-grants-guard.test.ts:81-84`, `server-only-writes-grants.test.ts:122-125`) stay **unchanged** (C2, they are the proof). `account-teardown.ts` lists tables, not columns, and 0076 adds no table: unchanged.
- **DESIGN.md definition of done for every UI task (11, 12, 13):** tokens only, no hard-coded colours, radii or shadows; both themes via the `.dark` class; rule 3 (no status here is colour-only: the hint is words); rule 5 and 7 (the Language line rides the Details card's loaded, empty and error states and, in the drawer, shows a one-row skeleton while the route answers); rule 6 (a change runs at once with an Undo toast; Keep toasts without Undo, nothing about the customer changed); rule 8 (Switch and Keep are `ghost`, never a second primary: the record's and the drawer's one primary is Call); a visible `:focus-visible` ring on the Select trigger and both buttons; controls `min-h-11 md:min-h-8`; the 92px label column of `source-field.tsx`; Esc keeps the drawer's rule; nothing animates on scroll; bilingual line: renders in English and Spanish, survives the pseudo-locale, the endonym carries its own `lang`.
- **Copy:** every new string through `t()` / `tr.text()` with an `.es` twin in the same commit (the ratchet, `lib/i18n/ratchet.test.ts`, admits no new key without one). New `.tsx` code carries no JSX literal copy with a letter in it (`ratchet-scan.ts:18-22`; "·" is fine). Usted, the spec's §15.2 words verbatim, "their" never "her" (§4). No `{{…}}`, no milestone codes (`INTERNAL_MILESTONE`), no vendor jargon. A name shown to a customer is `brandDisplayName`, never `accounts.name` (nothing in PR 1 reaches a customer). Server-action error strings stay English (the record-drawer plan's orchestrator ruling).
- **Every test can fail.** Each test names the mutation that breaks it. Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert. A `-t` filter that matches nothing passes silently: check the run count in vitest's summary block. Where a probe sits on one copy of a rule that exists twice (the web booking and the form both call `pageLanguageSignal`; the record page and the drawer both render `LanguageField`), probe the sibling copy too.
- **The `vi.mock("@bis/db")` factory check.** A task that adds a NEW named import from `@bis/db` to an existing module adds that name to every bare factory reaching the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. A factory built on `importOriginal` gets the real function unless the name is added to its mock object; add it there too so no test reaches a real database call.
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. `@bis/db` suites only on the replica as above, judged by vitest's summary block (the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies about the exit; capture an exit code to a file with nothing after the command). Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright: the orchestrator runs them, one at a time. Never pass the folder `…/accounts/[accountId]/` to vitest (it holds `calls/[callId]/actions.test.ts`, a live test); never run `src/app/f/[publicId]/actions.returning-lead.test.ts` or `weekly-metrics.live.test.ts`. A task that changes a shared function's signature runs every test that references it (`grep -rln "<fn>" apps/web/src`).
- **Production reads are the orchestrator's, read-only, through the Supabase MCP `execute_sql`.** No agent connects to production. Transcript text and form evidence are customer data: they live only under `<SCRATCH>/s09-evidence/`, are never committed, never pasted into a report (counts only), and the directory is deleted after Task 19.
- **Mutating e2e only on the per-run fixture account** (`e2e/.auth/client-fixture.json`, `readClientFixture()`), never `Test Client One`; every seeded row deleted in `finally`, each error checked; a person's `users.language` restored in `finally`. Fake providers only; e2e sends nothing.
- **Commits:** `git add -- <new files>` then `git commit -m "<type>(<scope>): <what and why>" -- <every path>`. Never `-A` or `.`. **Never `git stash`, never `--amend`.** If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`. Trailer lines on every commit: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Never** apply a migration outside your own replica, run SQL that writes to a shared project, mutate Test Client One, create or edit `.env*`, call a real provider, place or answer a call, or send a message.

## Where this plan departs from the spec's wording (the source decided)

1. **The writer locks, then writes, inside one function** (C3 says "one atomic UPDATE"). The function must return whether THIS call set the language, and Postgres 17 (bis-ci and production) has no `RETURNING old.*`. `select … for update` then the `update`, in the same plpgsql call, gives the same first-wins guarantee: a racing second caller waits on the row lock and then reads the committed, non-null language.
2. **`automations.body_es` gets a length CHECK (1,000); `calendars.followup_body_es` and `voice_profiles.textback_body_es` get none** (spec §6.4's Assumption). Read: no English body has a database CHECK, `AUTOMATION_BODY_MAX_LENGTH = 1000` (`lib/automations/caps.ts:66`) is the only body validation in the app, and neither `followup_body` nor `textback_body` is length-validated anywhere (`grep` over `app` and `lib`, no hit). A Spanish limit stricter than its English would refuse a save the English allows. Finding for PR 2: validate both English and Spanish in their save actions.
3. **Q1's data step skips the `instant_reply` row** (spec §6.5 says every row with `body <> ''`). C15 keeps the instant reply's own Spanish (`config.bodyEs`); an `automations.body_es` on that row would be a value nothing ever reads. The update is `recipe_key <> 'instant_reply'`; Task 19's count query matches.
4. **The "English at ≥ 2" probe for `"hola, I need una cita for you"` (spec §16.2) cannot fail**: English scores 3 (need, for, you), Spanish 2 (hola, cita), and the ratio rule needs English ≥ 4 whether the minimum is 2 or 3. Substituted: drop the ratio (`en >= CLEAR_EN_MIN` alone) → `en` → FAILS.
5. **An inbound message on the `voice` channel keeps `lang=""`** (spec §9 says every inbound subject and body). `finishCall` writes the call into the thread as an inbound `voice` message whose subject is "Phone call" and whose body is the AI's English summary (`finish-call.ts:420-423`): not text the customer wrote. Only `email`, `sms` and `form` inbound messages take the contact's language.
6. **A form submission written by the AI (`author_kind = 'ai'`) keeps `lang=""`.** Submissions carry `author_kind` `customer | ai` (`record.ts:270`); only the customer's own answers are customer-typed.
7. **The backfill is two committed pieces in `apps/web`, run offline** (spec §18.3 names `packages/db/scripts/backfill-contact-language.ts`, which does not exist and could not import `clearCallerLanguage` or `pageLanguageSignal`, both in `apps/web/src/lib`). A pure planner (`lib/contacts/language-backfill.ts`) and a script (`apps/web/scripts/backfill-contact-language.ts`) turn an evidence JSON the orchestrator reads read-only through the MCP into one SQL file of `record_language_signal` calls that also append the `contact.language_set` events; the orchestrator applies that file through the MCP. No machine holds a production credential (production isolation, 2026-10-07), so nothing connects to production but the MCP.
8. **The backfill runs before the merge AND again after the deploy** (spec §18.3 says after the merge; the brief says "backfill after counts → merge"). Before the merge it sets each contact from its OLDEST evidence (the truest first signal); the re-run after the deploy covers the window between the two. Re-running is a no-op on already-replayed evidence: proved in Task 1 (the same signal twice returns false the second time and leaves the row unchanged).
9. **The e2e seeds the signal through `recordLanguageSignal`** rather than booking on `/b/{id}?locale=es` (spec §16.3). The booking action's call is pinned by Task 7's unit test (arguments, order after `createBooking`, failure isolation) and the rpc's effect by Task 5's db test; a public booking in the e2e would add a slot-picker journey (`booking.spec.ts:72-200`) and a calendar mutation on the fixture account to prove nothing those two do not.
10. **Two keys beyond spec §15.2:** `contact.language.choose` ("Choose" · "Elegir"), the Select's placeholder when no language is set, and `contact.language.notSetUnknown` ("Not set." · "Sin definir."), the line when the account's own row could not be read (both readers log that failure and carry on, `page.tsx:111-113`, `route.ts:69-71`): saying "in English" then could be false.
11. **`who.language` absent from the drawer's body leaves the line out; present but malformed is the who section's error** (spec §16.2 names only the malformed case). Absent means an older server during a deploy, the `assignedTo` precedent (`drawer-summary.ts:31-33`).
12. **A concierge lead signals as `form`.** `lib/concierge/lead.ts:170` sends its leads through `enrich()` with the chat's locale, so C6's page rule applies to the chat's language too. The spec does not mention the concierge; no fifth source is added (C1).
13. **The web booking's actor is `"public"`, `"system"`** (spec §7.1 writes `"public"`): `ACTOR_ID = "public"`, `ACTOR_TYPE = "system"` (`b/[publicId]/actions.ts:48-49`); `ActorType` is `user | system | ai` (`events.ts:4`).
14. **The Select shows no "Not set" option** (spec §8.3) and saves on change; Esc closes the Select's own popover without a change, which is Radix's behaviour, so no handler is written for it.

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/supabase/migrations/0076_customer_language.sql` | bis-db-schema | the seven contact columns, their checks, `record_language_signal`, the INSERT guard, PR 2's six columns and grant, Q1's data step, comments |
| `packages/db/src/test/customer-language-schema.test.ts` | bis-db-schema | 0076's proof on the replica |
| `packages/db/src/test/contact-language.test.ts` | bis-crm | the `@bis/db` writers through PostgREST |
| `apps/web/src/lib/voice/language.clear.test.ts` | bis-voice | `clearCallerLanguage` |
| `apps/web/src/lib/contacts/language.ts` (+ `.test.ts`) | bis-crm | `pageLanguageSignal`, `languageHint`, `languageView`, `parseLanguageView` |
| `apps/web/src/lib/contacts/language-backfill.ts` (+ `.test.ts`) | bis-crm | `planLanguageBackfill`, `backfillSql`, `backfillCounts` |
| `apps/web/scripts/backfill-contact-language.ts` | bis-crm | evidence JSON in, SQL file out, counts printed; no database connection |
| `…/contacts/language-field.tsx` (+ `language-field.test.ts`) | bis-crm | the Details line, its Select, the hint |
| `…/contacts/language-field-handlers.ts` (+ `.test.ts`) | bis-crm | choose / undo / keep with their toasts |
| `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.lang.test.ts` | bis-crm | per-member `lang` |
| `…/contacts/[contactId]/activity-timeline.lang.test.ts` | bis-crm | customer-typed `lang` |
| `apps/web/e2e/contact-language.spec.ts` | bis-e2e-qa | the line, edit, Undo, Spanish reader, hint, Keep |

**Modified:** `packages/db/src/{contacts,record,messaging,index}.ts`; `packages/db/src/test/{schema-grants-guard,booking-grants,call-proposals-grants,record,messaging}.test.ts`; `apps/web/src/lib/voice/{language,finish-call}.ts`, `finish-call.test.ts`, `tools/registry.ts`, `tools/registry.test.ts`; `apps/web/src/app/b/[publicId]/actions.ts` (+ test); `apps/web/src/lib/forms/enrich.ts`, `app/f/[publicId]/actions.test.ts`, `lib/concierge/lead.test.ts`, `app/api/concierge/[publicId]/turn/route.test.ts`; `…/contacts/{actions.ts,actions.test.ts,contact-drawer.tsx,contact-drawer.wiring.test.ts}`; `…/contacts/[contactId]/{contact-fields-panel.tsx,contact-fields-panel.bodies.test.ts,page.tsx,activity-timeline.tsx}`; `…/summary/route.ts`, `route.test.ts`; `lib/contacts/drawer-summary.ts` (+ test); `lib/record/recent-rows.ts` (+ test); `groups/[groupId]/{group-timeline,page}.tsx`; `…/conversations/{message-thread,page}.tsx`, `message-thread.test.ts`; `lib/messages.ts`; `lib/i18n/{catalogue,ratchet}-baseline.json`; `DESIGN.md` (orchestrator).

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Files (disjoint per wave) |
|---|---|---|---|---|---|
| 0 | Confirm the base | orchestrator | n/a | — | none |
| 1 | Migration 0076 and its proof on the replica | bis-db-schema | **opus** | 0 | the migration, `customer-language-schema.test.ts`, three grants lists |
| 2 | `clearCallerLanguage` | bis-voice | sonnet | 0 | `lib/voice/language.ts`, `language.clear.test.ts` |
| 3 | Read-only production sample of caller turns (Q7 input) | orchestrator | n/a | 0 | `<SCRATCH>/s09-evidence/` only |
| 4 | Tune the thresholds on the sample (Q7) | bis-voice | **opus** | 2, 3 | `lib/voice/language.ts` (constants), `language.clear.test.ts` |
| 5 | `@bis/db`: `COLS`, the language types, `recordLanguageSignal` and the staff writers | bis-crm | **opus** | 1 | `packages/db/src/contacts.ts`, `index.ts`, `contact-language.test.ts` |
| 6 | `lib/contacts/language.ts` and every key (**messages.ts, the only writer**) | bis-crm | sonnet | 5 | `lib/contacts/language*`, `lib/messages.ts` |
| 7 | The web booking signal | bis-booking | sonnet | 5, 6 | `app/b/[publicId]/actions*` |
| 8 | The phone-booking and call-finish signals | bis-voice | sonnet | 2, 5 | `lib/voice/finish-call*`, `lib/voice/tools/registry*` |
| 9 | The form signal | bis-crm | sonnet | 5, 6 | `lib/forms/enrich.ts`, three test factories |
| 10 | The staff actions (set, restore, keep) | bis-crm | **opus** | 5, 6 | `…/contacts/actions*` |
| 11 | `LanguageField` on the record page and in the drawer | bis-crm | **opus** | 6, 10 | `…/contacts/language-field*`, `contact-drawer*`, `[contactId]/{contact-fields-panel,page}*`, `…/summary/route*`, `lib/contacts/drawer-summary*` |
| 12 | Customer-typed text takes the contact's language (record, drawer, group) | bis-crm | sonnet | 1, 11 | `[contactId]/{activity-timeline*,page.tsx}`, `lib/record/recent-rows*`, `…/summary/route*`, `lib/contacts/drawer-summary*`, `groups/[groupId]/*`, `packages/db/src/record.ts`, `record.test.ts` |
| 13 | Inbound bubbles in Conversations take the contact's language | bis-comms | sonnet | 1 | `packages/db/src/messaging.ts`, `messaging.test.ts`, `…/conversations/{message-thread,page}*` |
| 14 | The backfill planner and script | bis-crm (SQL reviewed by bis-db-schema) | sonnet | 4, 6 | `lib/contacts/language-backfill*`, `apps/web/scripts/backfill-contact-language.ts` |
| 15 | Regenerate the i18n baselines | bis-crm | sonnet | 6, 11, 12, 13 | `lib/i18n/*-baseline.json` |
| 16 | e2e | bis-e2e-qa | sonnet | 11, 12, 15 | `apps/web/e2e/contact-language.spec.ts` |
| 17 | DESIGN.md bullet; ledger follow-ups | orchestrator | n/a | 11 | `DESIGN.md` |
| 18 | Whole-branch final review (checkpoint, not an implementer task) | reviewer | **opus** | 14, 15, 16, 17 | none |
| 19 | Rollout: bis-ci apply → e2e → production apply → parity → counts → backfill → merge → backfill re-run | orchestrator | n/a | 18 | none |

**Dependency graph (lanes on disjoint files, 2–3 at a time).**

```
Wave A (three lanes):  T1 (bis-db-schema)   T2 (bis-voice)   T3 (orchestrator, read-only, no files)
Wave B (three lanes):  T5 (bis-crm, after T1)   T4 (bis-voice, after T2 + T3)   T13 (bis-comms, after T1)
Wave C (two lanes):    T6 (bis-crm, after T5)   T8 (bis-voice, after T2 + T5; T4 may still be running: disjoint files)
Wave D (three lanes):  T7 (bis-booking, after T5 + T6)   T9 (bis-crm, after T6)   T10 (bis-crm, second instance, after T6)
Wave E (two lanes):    T11 (bis-crm, after T10)   T14 (bis-crm, after T4 + T6)
Wave F:                T12 (bis-crm, after T11)
Wave G (two lanes):    T15 (after T6, T11, T12, T13)   T17 (orchestrator, after T11)
Wave H:                T16 (after T11, T12, T15)
Checkpoint:            T18 (after T14, T15, T16, T17)
Rollout:               T19 (after T18)
```

T9 and T10 never touch the same file (`enrich.ts` and its three factories vs `contacts/actions*`). T4 and T8 never touch the same file (`language.ts` constants vs `finish-call*`/`registry*`); T8 imports `clearCallerLanguage`, whose signature T4 does not change. T11 commits `page.tsx`, `route.ts` and `drawer-summary.ts` before T12 starts. T13 touches no bis-crm file.

---

## Task 0: Confirm the base (orchestrator)

- [ ] **Step 1.** In `<WT>` (branch `feat/s09-language`): `git log --oneline -4` → `<plan commit>`, `1292b9c2 S-09 spec: owner rulings Q1–Q10`, `e1c1a918 …`, `24514df3 …`. `git fetch origin` then `git log --oneline origin/main -1`; if `main` moved past `0d6d0edc`, `git merge origin/main` and re-run Step 2.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0075_group_primary_contact.sql`.
  - `git log --all --oneline -- 'packages/db/supabase/migrations/0076*'` → nothing (no other branch holds a 0076; if one does, this plan's number becomes the next free one and every `0076` below is renamed in the same commit).
  - `grep -c "language" packages/db/src/contacts.ts` → `0`.
  - `grep -n "export function detectCallerLanguage" apps/web/src/lib/voice/language.ts` → `42:`.
  - `grep -n '"contact.source.machine.form.es"' apps/web/src/lib/messages.ts` → `726:`.
  - `grep -n "const ACTOR_ID = \"public\"" "apps/web/src/app/b/[publicId]/actions.ts"` → `48:`.

---

## Task 1: Migration 0076 and its proof on the replica (bis-db-schema)

**Review:** opus. **Runs beside:** Tasks 2 and 3. **Scratch:** `<SCRATCH>/s09-t1-impl/`, replica port `55490` (reviewer `s09-t1-review/`, `55491`).

**Files**
- Create: `packages/db/supabase/migrations/0076_customer_language.sql`
- Create: `packages/db/src/test/customer-language-schema.test.ts`
- Modify: `packages/db/src/test/schema-grants-guard.test.ts:69-72` (the calendars list)
- Modify: `packages/db/src/test/booking-grants.test.ts:15-27` (`CALENDAR_SETTINGS_COLUMNS`)
- Modify: `packages/db/src/test/call-proposals-grants.test.ts:129-132` (the calendars control)

**Interfaces**
- Consumes (SQL): `public.contacts`, `public.automations` (`body`, `recipe_key`), `public.calendars` (`followup_body`), `public.voice_profiles` (`textback_body`), `public.events`; `app.jwt()` is NOT used (the trigger reads only `current_user`, the 0071 shape at `0071_places_and_equipment.sql:139-148`).
- Produces (SQL), every later task relies on these exact names:
  - `contacts` columns `language text`, `language_source text`, `language_set_at timestamptz`, `last_language_signal text`, `last_language_signal_source text`, `last_language_signal_at timestamptz`, `language_hint_kept_at timestamptz`, all NULL with no default.
  - Constraints `contacts_language_check`, `contacts_language_source_check`, `contacts_last_language_signal_check`, `contacts_last_language_signal_source_check`, `contacts_language_coherent`, `contacts_language_signal_coherent`.
  - `public.record_language_signal(p_account uuid, p_contact uuid, p_language text, p_source text, p_at timestamptz) returns boolean`, execute to `service_role` only; raises `22004` on a NULL argument and `22023` on a value outside its set; returns false for a contact not in the account.
  - `app.contacts_language_server_only() returns trigger`; trigger `contacts_language_server_only` BEFORE INSERT on `public.contacts`.
  - `automations.body_es text`, `automations.body_es_basis text`, constraint `automations_body_es_length`; `calendars.followup_body_es text`, `calendars.followup_body_es_basis text` (client UPDATE granted); `voice_profiles.textback_body_es text`, `voice_profiles.textback_body_es_basis text`.

- [ ] **Step 1: Build your replica.** Write the env file:

```bash
mkdir -p "<SCRATCH>/s09-t1-impl"
cat > "<SCRATCH>/s09-t1-impl/env.sh" <<'EOF'
S="<SCRATCH>/s09-t1-impl"
PGBIN="/c/Program Files/PostgreSQL/18/bin"
P() { "$PGBIN/psql" -h localhost -p 55490 -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
EOF
```

Then from `<WT>` in Git Bash:

```bash
source "<SCRATCH>/s09-t1-impl/env.sh"
"$PGBIN/initdb" -U postgres -A trust -E UTF8 --locale=C --locale-provider=icu --icu-locale=en-US -D "$S/pgdata" > "$S/initdb.log" 2>&1
"$PGBIN/pg_ctl" -D "$S/pgdata" -o "-p 55490" -l "$S/pg.log" start </dev/null >/dev/null 2>&1
P -c "create role anon nologin noinherit; create role authenticated nologin noinherit; create role service_role nologin noinherit bypassrls; grant anon, authenticated, service_role to postgres;"
P -c "create database pre"
P -d pre -c "alter database pre set timezone to 'UTC'"
P -d pre -c "create schema if not exists app; create schema if not exists extensions;"
sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql | P -d pre
for f in packages/db/supabase/migrations/0*.sql; do
  case "$f" in *0076_*) continue;; esac
  P -d pre -1 -f "$f" || { echo "FAILED at $f"; break; }
done
```

Expected: no `FAILED at` line. Faithfulness (memory "Local DB replica"): the client-write-surface digest on `pre` equals bis-ci's, read-only on bis-ci with `ci:sql`:

```sql
select count(*) || '|' || md5(string_agg(x, ',' order by x)) from (
  select r || ' ' || c.relname || ' ' || p as x
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) v(r)
  cross join (values ('INSERT'), ('UPDATE'), ('DELETE')) w(p)
  where n.nspname = 'public' and c.relkind = 'r' and has_table_privilege(r, c.oid, p)) s;
```

Paste both values; stop if they differ.

- [ ] **Step 2: Seed the Q1 data step's rows on `pre`** (they must exist BEFORE 0076, as production's do):

```bash
source "<SCRATCH>/s09-t1-impl/env.sh"
P -d pre <<'SQL'
with ag as (select id from agencies limit 1)
insert into accounts (agency_id, clerk_org_id, name) select id, 'org_s09_data', 'S09 Data' from ag;
insert into automations (account_id, recipe_key, body)
  select a.id, v.k, v.b from accounts a,
  (values ('review_request', 'Thanks from us, and 10 percent off this spring'), ('no_show_nudge', ''), ('instant_reply', 'Our own instant reply')) v(k, b)
  where a.clerk_org_id = 'org_s09_data';
insert into calendars (account_id, public_id, followup_body)
  select id, 'cal_s09_custom', 'Thanks for coming in to the shop' from accounts where clerk_org_id = 'org_s09_data';
insert into voice_profiles (account_id, textback_body)
  select id, '' from accounts where clerk_org_id = 'org_s09_data';
SQL
P -c "create database post template pre"
P -d post -c "alter database post set timezone to 'UTC'"
```

- [ ] **Step 3: Write the failing test** `packages/db/src/test/customer-language-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAsMember } from "./db";

/**
 * A language on every customer (S-09, migration 0076). As the table owner inside a rolled-back
 * transaction unless a case switches role. A refused statement runs under a savepoint (`attempt`), so
 * one refusal does not abort the rest of the case (25P02).
 */
const RUN = Math.random().toString(36).slice(2, 10);
const ORG = `org_lang_${RUN}`;
const LANG = [
  "language", "language_source", "language_set_at", "last_language_signal",
  "last_language_signal_source", "last_language_signal_at", "language_hint_kept_at",
] as const;
const T0 = "2026-10-01T15:00:00.000Z";
const T1 = "2026-10-03T15:00:00.000Z";
const T2 = "2026-10-05T15:00:00.000Z";
const FN = "public.record_language_signal(uuid,uuid,text,text,timestamptz)";

async function attempt(c: Client, sql: string, args: unknown[] = []) {
  await c.query("savepoint attempt");
  try {
    const r = await c.query(sql, args);
    await c.query("release savepoint attempt");
    return r;
  } catch (e) {
    await c.query("rollback to savepoint attempt");
    throw e;
  }
}

async function seed(c: Client) {
  const { rows: [agency] } = await c.query<{ id: string }>("select id from agencies limit 1");
  const account = async (org: string, name: string) => (await c.query<{ id: string }>(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency!.id, org, name])).rows[0]!.id;
  const acct = await account(ORG, "Lang Co");
  const other = await account(`${ORG}_b`, "Other Co");
  const contact = async (a: string) =>
    (await c.query<{ id: string }>("insert into contacts (account_id, first_name) values ($1,'Ana') returning id", [a])).rows[0]!.id;
  return { acct, other, ana: await contact(acct), bea: await contact(other) };
}

/** The seven columns, timestamps as ISO strings (pg hands timestamptz back as a Date). */
async function langOf(c: Client, id: string): Promise<Record<string, string | null>> {
  const { rows: [r] } = await c.query(`select ${LANG.join(", ")} from contacts where id = $1`, [id]);
  return Object.fromEntries(LANG.map((k) => [k, r[k] instanceof Date ? (r[k] as Date).toISOString() : (r[k] as string | null)]));
}
const NONE = Object.fromEntries(LANG.map((k) => [k, null]));

const signal = async (c: Client, a: string | null, id: string | null, lang: string | null, source: string | null, at: string | null) =>
  (await attempt(c, "select public.record_language_signal($1::uuid, $2::uuid, $3::text, $4::text, $5::timestamptz) as set",
    [a, id, lang, source, at])).rows[0]!.set as boolean;

describe("contacts' language columns (spec §6.1)", () => {
  it("each value is from its closed set (mutation: drop contacts_language_source_check -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const bad: [string, string][] = [
      ["language = 'fr', language_source = 'staff', language_set_at = now()", "contacts_language_check"],
      ["language = 'es', language_source = 'import', language_set_at = now()", "contacts_language_source_check"],
      ["last_language_signal = 'fr', last_language_signal_source = 'call', last_language_signal_at = now()", "contacts_last_language_signal_check"],
      ["last_language_signal = 'es', last_language_signal_source = 'staff', last_language_signal_at = now()", "contacts_last_language_signal_source_check"],
    ];
    for (const [set, constraint] of bad) {
      await expect(attempt(c, `update contacts set ${set} where id = $1`, [s.ana]), constraint)
        .rejects.toMatchObject({ code: "23514", constraint });
    }
  }));

  it("the language, its source and its time are all set or all null; so is the last signal (mutation: drop contacts_language_coherent -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await expect(attempt(c, "update contacts set language = 'es' where id = $1", [s.ana]))
        .rejects.toMatchObject({ code: "23514", constraint: "contacts_language_coherent" });
      await expect(attempt(c, "update contacts set last_language_signal = 'es', last_language_signal_at = now() where id = $1", [s.ana]))
        .rejects.toMatchObject({ code: "23514", constraint: "contacts_language_signal_coherent" });
      expect(await langOf(c, s.ana)).toEqual(NONE);
    }));

  it("each new column names its one writer in a comment, and accounts.language names its second reader", () => withRollback(async (c) => {
    const { rows } = await c.query<{ attname: string; d: string | null }>(
      `select a.attname, col_description(a.attrelid, a.attnum) as d from pg_attribute a
        where a.attrelid = 'public.contacts'::regclass and a.attname = any($1)`, [[...LANG]]);
    expect(rows).toHaveLength(7);
    for (const r of rows) expect(r.d, r.attname).toMatch(/0076/);
    const { rows: [acct] } = await c.query<{ d: string }>(
      "select col_description('public.accounts'::regclass, (select attnum from pg_attribute where attrelid = 'public.accounts'::regclass and attname = 'language')) as d");
    expect(acct!.d).toMatch(/since 0076/);
  }));
});

describe("record_language_signal (spec §6.2, C3)", () => {
  it("on a contact with no language: sets the language, its source and the evidence's own time, and the last signal; returns true", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      expect(await signal(c, s.acct, s.ana, "es", "booking", T1)).toBe(true);
      expect(await langOf(c, s.ana)).toEqual({
        language: "es", language_source: "booking", language_set_at: T1,
        last_language_signal: "es", last_language_signal_source: "booking", last_language_signal_at: T1, language_hint_kept_at: null,
      });
    }));

  it("a later, disagreeing signal moves only the last signal and returns false (mutation: drop the `language is null` test -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await signal(c, s.acct, s.ana, "es", "booking", T1);
      expect(await signal(c, s.acct, s.ana, "en", "call", T2)).toBe(false);
      expect(await langOf(c, s.ana)).toMatchObject({
        language: "es", language_source: "booking", language_set_at: T1,
        last_language_signal: "en", last_language_signal_source: "call", last_language_signal_at: T2,
      });
    }));

  it("an older signal changes nothing (mutation: drop the time guard -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await signal(c, s.acct, s.ana, "es", "booking", T1);
    expect(await signal(c, s.acct, s.ana, "en", "call", T0)).toBe(false);
    expect(await langOf(c, s.ana)).toMatchObject({ last_language_signal: "es", last_language_signal_source: "booking", last_language_signal_at: T1 });
  }));

  it("the same signal twice is a no-op the second time: the backfill can be re-run (plan deviation 8)", () => withRollback(async (c) => {
    const s = await seed(c);
    expect(await signal(c, s.acct, s.ana, "es", "form", T1)).toBe(true);
    const once = await langOf(c, s.ana);
    expect(await signal(c, s.acct, s.ana, "es", "form", T1)).toBe(false);
    expect(await langOf(c, s.ana)).toEqual(once);
  }));

  it("never touches another account's contact or an unknown id (mutation: drop the account_id filter -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    expect(await signal(c, s.acct, s.bea, "es", "form", T1)).toBe(false);
    expect(await signal(c, s.acct, "00000000-0000-0000-0000-000000000000", "es", "form", T1)).toBe(false);
    expect(await langOf(c, s.bea)).toEqual(NONE);
  }));

  it("a NULL in any argument raises 22004 before anything is written (mutation: remove the NULL guard -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    const args: [string | null, string | null, string | null, string | null, string | null] = [s.acct, s.ana, "es", "booking", T1];
    for (let i = 0; i < args.length; i++) {
      const a = [...args] as typeof args;
      a[i] = null;
      await expect(signal(c, ...a), `argument ${i + 1}`).rejects.toMatchObject({ code: "22004" });
    }
    expect(await langOf(c, s.ana)).toEqual(NONE);
  }));

  it("a value outside its set raises 22023; `staff` is never a signal (mutation: accept 'staff' -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await expect(signal(c, s.acct, s.ana, "fr", "booking", T1)).rejects.toMatchObject({ code: "22023" });
    await expect(signal(c, s.acct, s.ana, "es", "staff", T1)).rejects.toMatchObject({ code: "22023" });
  }));

  it("is security invoker with an empty search_path, and only service_role may execute it (mutation: grant execute to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows: [f] } = await c.query<{ prosecdef: boolean; proconfig: string[] }>(
        "select prosecdef, proconfig from pg_proc where oid = $1::regprocedure", [FN]);
      expect(f).toEqual({ prosecdef: false, proconfig: ['search_path=""'] });
      const { rows: [p] } = await c.query(
        `select has_function_privilege('anon', $1, 'execute') as anon, has_function_privilege('authenticated', $1, 'execute') as auth,
                has_function_privilege('service_role', $1, 'execute') as svc`, [FN]);
      expect(p).toEqual({ anon: false, auth: false, svc: true });
    }));

  it("a signed-in client calling it is refused 42501 (the real refusal, not just the catalogue)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAsMember(c, s.acct, ORG, "owner");
    await expect(signal(c, s.acct, s.ana, "es", "booking", T1)).rejects.toMatchObject({ code: "42501" });
  }));
});

describe("the client role writes no language (spec §6.3, C2)", () => {
  it("a client INSERT carrying all seven values stores none of them (mutation: drop trigger contacts_language_server_only -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await actAsMember(c, s.acct, ORG, "owner");
      const { rows: [row] } = await attempt(c,
        `insert into contacts (account_id, first_name, language, language_source, language_set_at, last_language_signal,
           last_language_signal_source, last_language_signal_at, language_hint_kept_at)
         values ($1, 'Cleo', 'es', 'staff', now(), 'es', 'call', now(), now()) returning id`, [s.acct]);
      await c.query("reset role");
      expect(await langOf(c, row.id as string)).toEqual(NONE);
    }));

  it("the service role's INSERT keeps them (the guard is the client's only)", () => withRollback(async (c) => {
    const s = await seed(c);
    await c.query("set local role service_role");
    const { rows: [row] } = await attempt(c,
      "insert into contacts (account_id, first_name, language, language_source, language_set_at) values ($1, 'Dora', 'es', 'staff', $2) returning id",
      [s.acct, T1]);
    await c.query("reset role");
    expect(await langOf(c, row.id as string)).toMatchObject({ language: "es", language_source: "staff", language_set_at: T1 });
  }));

  it("a client UPDATE of the language is refused 42501 (mutation: grant update (language) -> FAILS)", () => withRollback(async (c) => {
    const s = await seed(c);
    await actAsMember(c, s.acct, ORG, "owner");
    await expect(attempt(c, "update contacts set language = 'es', language_source = 'staff', language_set_at = now() where id = $1", [s.ana]))
      .rejects.toMatchObject({ code: "42501" });
  }));
});

describe("PR 2's Spanish-box columns (spec §6.4, C17)", () => {
  it("six nullable columns with no default", () => withRollback(async (c) => {
    const { rows } = await c.query<{ table_name: string; column_name: string; is_nullable: string; column_default: string | null }>(
      `select table_name, column_name, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = any($1) and column_name = any($2) order by 1, 2`,
      [["automations", "calendars", "voice_profiles"],
       ["body_es", "body_es_basis", "followup_body_es", "followup_body_es_basis", "textback_body_es", "textback_body_es_basis"]]);
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      "automations.body_es", "automations.body_es_basis", "calendars.followup_body_es", "calendars.followup_body_es_basis",
      "voice_profiles.textback_body_es", "voice_profiles.textback_body_es_basis",
    ]);
    for (const r of rows) expect([r.is_nullable, r.column_default]).toEqual(["YES", null]);
  }));

  it("a Spanish automation body is at most 1,000 characters, the English's own limit (mutation: drop automations_body_es_length -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c);
      await c.query("insert into automations (account_id, recipe_key) values ($1, 'review_request')", [s.acct]);
      expect((await attempt(c, "update automations set body_es = repeat('a', 1000) where account_id = $1", [s.acct])).rowCount).toBe(1);
      await expect(attempt(c, "update automations set body_es = repeat('a', 1001) where account_id = $1", [s.acct]))
        .rejects.toMatchObject({ code: "23514", constraint: "automations_body_es_length" });
    }));
});
```

- [ ] **Step 4: Update the three calendars lists** (the contacts lists stay as they are). In `schema-grants-guard.test.ts:69-72`:

```ts
  "authenticated calendars": update([
    "buffer_minutes", "enabled", "followup_body", "followup_body_es", "followup_body_es_basis", "followup_enabled",
    "max_advance_days", "meeting_type", "min_notice_hours", "notify_emails", "open_hours", "slot_duration_minutes", "updated_at",
  ]).sort(),
```

In `booking-grants.test.ts:15-27`, after `"followup_body",`:

```ts
  "followup_body_es",        // PR 2's Spanish box (S-09), client-editable beside followup_body; granted by 0076
  "followup_body_es_basis",  // the English the Spanish was written beside (S-09 C14); granted by 0076
```

In `call-proposals-grants.test.ts:129-132`:

```ts
      expect(await updatable("calendars"), "calendars (the control)").toEqual([
        "buffer_minutes", "enabled", "followup_body", "followup_body_es", "followup_body_es_basis", "followup_enabled",
        "max_advance_days", "meeting_type", "min_notice_hours", "notify_emails", "open_hours", "slot_duration_minutes", "updated_at",
      ]);
```

- [ ] **Step 5: Run red on `pre`.**

```bash
source "<SCRATCH>/s09-t1-impl/env.sh" && cd <WT>/packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55490/pre NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= BIS_CI_SUPABASE_REF= pnpm exec vitest run src/test/customer-language-schema.test.ts src/test/schema-grants-guard.test.ts src/test/booking-grants.test.ts src/test/call-proposals-grants.test.ts src/test/server-only-writes-grants.test.ts src/test/automations-grants.test.ts > "$S/t1-red.txt" 2>&1; echo $? > "$S/t1-red.exit"
```

Expected: the new file fails throughout (`column "language" does not exist`, `function public.record_language_signal(…) does not exist`), the three calendars lists fail (`followup_body_es` missing), `server-only-writes-grants` and `automations-grants` pass. Paste one failing line of each kind. The blank `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` make the global setup skip its sweep (`src/test/global-setup.ts:31`), so nothing reaches bis-ci.

- [ ] **Step 6: Write the migration** `packages/db/supabase/migrations/0076_customer_language.sql`:

```sql
-- 0076_customer_language.sql
--
-- A LANGUAGE ON EVERY CUSTOMER (S-09, spec docs/superpowers/specs/2026-10-13-customer-language-design.md).
--
-- WHAT
--   contacts.language / language_source / language_set_at: the customer's language ('en' or 'es'),
--     how it was set ('booking', 'form', 'call' from the customer's own first clear sign, or 'staff'),
--     and when. All three NULL (not set) or all three set.
--   contacts.last_language_signal / _source / _at: the NEWEST sign the customer gave, kept even when it
--     disagrees with the language; never 'staff'. The record's hint is computed from these on read.
--   contacts.language_hint_kept_at: when someone pressed Keep on that hint.
--   public.record_language_signal(): the ONE automatic writer, service_role only. It records a sign and
--     sets the language only when the language is NULL, so it never overwrites a staff choice.
--   app.contacts_language_server_only(): a client-role INSERT stores none of the seven columns.
--   PR 2's Spanish boxes (inert until PR 2 ships): automations.body_es/_basis,
--     calendars.followup_body_es/_basis (client-editable like followup_body),
--     voice_profiles.textback_body_es/_basis. NULL means "our written Spanish default"; '' means
--     "emptied: Spanish customers get the English".
--
-- WHO WRITES WHAT (the 0053 convention). The client role gets no UPDATE on any contacts language column
-- (a column added after 0053 is not client-updatable until granted by name), and contacts keep their
-- table-level INSERT, hence the trigger. Staff edits run in server actions on the service client after
-- getContact on the request client found the contact.
--
-- DATA (owner decision Q1, 2026-10-13). An account that already rewrote an English body keeps sending
-- that English to Spanish customers: its Spanish is set to '' (emptied). Rows still on our default keep
-- NULL. The instant reply's row is skipped: it keeps its own Spanish in config (spec C15).
--
-- APPLY ORDER. Additive; the build before this PR reads none of it, so it applies before the merge.
-- bis-ci first (ci-project-setup.yml), then production, then the parity check.
--
-- ROLLBACK (roll the app back first):
--   drop function public.record_language_signal(uuid, uuid, text, text, timestamptz);
--   drop trigger contacts_language_server_only on public.contacts;
--   drop function app.contacts_language_server_only();
--   alter table public.contacts drop column language, drop column language_source,
--     drop column language_set_at, drop column last_language_signal,
--     drop column last_language_signal_source, drop column last_language_signal_at,
--     drop column language_hint_kept_at;
--   alter table public.automations drop column body_es, drop column body_es_basis;
--   alter table public.calendars drop column followup_body_es, drop column followup_body_es_basis;
--   alter table public.voice_profiles drop column textback_body_es, drop column textback_body_es_basis;
--   then restore 0065's comment on accounts.language. The Q1 data is lost with the columns; nothing
--   reads it before PR 2.
--
-- ASCII only, no backslash anywhere (the MCP apply rule).

set local lock_timeout = '5s';

-- 1. The contact's language and its newest sign.
alter table public.contacts
  add column language text null,
  add column language_source text null,
  add column language_set_at timestamptz null,
  add column last_language_signal text null,
  add column last_language_signal_source text null,
  add column last_language_signal_at timestamptz null,
  add column language_hint_kept_at timestamptz null,
  add constraint contacts_language_check check (language in ('en', 'es')),
  add constraint contacts_language_source_check check (language_source in ('booking', 'form', 'call', 'staff')),
  add constraint contacts_last_language_signal_check check (last_language_signal in ('en', 'es')),
  add constraint contacts_last_language_signal_source_check check (last_language_signal_source in ('booking', 'form', 'call')),
  add constraint contacts_language_coherent check (
    (language is null and language_source is null and language_set_at is null)
    or (language is not null and language_source is not null and language_set_at is not null)),
  add constraint contacts_language_signal_coherent check (
    (last_language_signal is null and last_language_signal_source is null and last_language_signal_at is null)
    or (last_language_signal is not null and last_language_signal_source is not null and last_language_signal_at is not null));

-- 2. The one automatic writer. Locks the row, then writes: the caller learns whether THIS call set the
--    language, and a racing second caller waits on the lock and then sees it set (first wins).
create function public.record_language_signal(
  p_account uuid, p_contact uuid, p_language text, p_source text, p_at timestamptz
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_found boolean;
  v_prior text;
  v_last_at timestamptz;
begin
  if p_account is null or p_contact is null or p_language is null or p_source is null or p_at is null then
    raise exception 'record_language_signal: every argument is required' using errcode = '22004';
  end if;
  if p_language not in ('en', 'es') then
    raise exception 'record_language_signal: language must be en or es' using errcode = '22023';
  end if;
  if p_source not in ('booking', 'form', 'call') then
    raise exception 'record_language_signal: source must be booking, form or call' using errcode = '22023';
  end if;

  select true, c.language, c.last_language_signal_at into v_found, v_prior, v_last_at
    from public.contacts c
   where c.account_id = p_account and c.id = p_contact
   for update;
  if not coalesce(v_found, false) then
    return false;
  end if;

  update public.contacts c set
    last_language_signal = case when v_last_at is null or p_at >= v_last_at then p_language else c.last_language_signal end,
    last_language_signal_source = case when v_last_at is null or p_at >= v_last_at then p_source else c.last_language_signal_source end,
    last_language_signal_at = case when v_last_at is null or p_at >= v_last_at then p_at else c.last_language_signal_at end,
    language = case when v_prior is null then p_language else c.language end,
    language_source = case when v_prior is null then p_source else c.language_source end,
    language_set_at = case when v_prior is null then p_at else c.language_set_at end
   where c.account_id = p_account and c.id = p_contact;

  return v_prior is null;
end $$;

revoke all on function public.record_language_signal(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.record_language_signal(uuid, uuid, text, text, timestamptz) to service_role;

-- 3. A client-role INSERT stores no language. Plain, not definer, so current_user is the caller
--    (0071's app.stamp_created_by). No UPDATE trigger: no UPDATE grant exists.
create function app.contacts_language_server_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' then
    new.language := null;
    new.language_source := null;
    new.language_set_at := null;
    new.last_language_signal := null;
    new.last_language_signal_source := null;
    new.last_language_signal_at := null;
    new.language_hint_kept_at := null;
  end if;
  return new;
end $$;
create trigger contacts_language_server_only before insert on public.contacts
  for each row execute function app.contacts_language_server_only();

-- 4. PR 2's Spanish boxes (spec 6.4). Inert until PR 2.
alter table public.automations
  add column body_es text null,
  add column body_es_basis text null,
  add constraint automations_body_es_length check (body_es is null or char_length(body_es) <= 1000);
alter table public.calendars
  add column followup_body_es text null,
  add column followup_body_es_basis text null;
grant update (followup_body_es, followup_body_es_basis) on public.calendars to authenticated;
alter table public.voice_profiles
  add column textback_body_es text null,
  add column textback_body_es_basis text null;

-- 5. Q1: an account's already-customised English keeps going to its Spanish customers.
update public.automations set body_es = '' where body <> '' and recipe_key <> 'instant_reply';
update public.calendars set followup_body_es = '' where followup_body <> '';
update public.voice_profiles set textback_body_es = '' where textback_body <> '';

-- 6. Comments: each column names its one writer.
comment on column public.contacts.language is
  'The customer''s language, en or es (0076, S-09). NULL = not set. Written by public.record_language_signal (only while NULL) and by staff through setContactLanguage on the service client.';
comment on column public.contacts.language_source is
  'How contacts.language was set (0076): booking, form or call (record_language_signal) or staff (setContactLanguage / restoreContactLanguage).';
comment on column public.contacts.language_set_at is
  'When contacts.language was set (0076): the evidence''s own time for a sign, the moment of the choice for staff.';
comment on column public.contacts.last_language_signal is
  'The newest language sign the customer gave, en or es (0076). Written only by public.record_language_signal; read for the record''s hint.';
comment on column public.contacts.last_language_signal_source is
  'Where the newest sign came from: booking, form or call, never staff (0076). Written only by public.record_language_signal.';
comment on column public.contacts.last_language_signal_at is
  'When the newest sign was given (0076). An older sign never replaces a newer one. Written only by public.record_language_signal.';
comment on column public.contacts.language_hint_kept_at is
  'When someone pressed Keep on the language hint (0076); the hint stays away until a newer sign. Written only by keepContactLanguageHint on the service client.';
comment on column public.automations.body_es is
  'PR 2 Spanish box (0076, S-09): NULL = our written Spanish default, empty = Spanish customers get the English, else theirs. Service-role writes only.';
comment on column public.automations.body_es_basis is
  'The English body the Spanish was written beside (0076, S-09 C14); the staleness warning compares it with body.';
comment on column public.calendars.followup_body_es is
  'PR 2 Spanish box for the calendar follow-up (0076, S-09): NULL = our Spanish default, empty = the English. Client-editable like followup_body.';
comment on column public.calendars.followup_body_es_basis is
  'The followup_body the Spanish was written beside (0076, S-09 C14).';
comment on column public.voice_profiles.textback_body_es is
  'PR 2 Spanish box for the missed-call text-back (0076, S-09): NULL = our Spanish default, empty = the English. Service-role writes only.';
comment on column public.voice_profiles.textback_body_es_basis is
  'The textback_body the Spanish was written beside (0076, S-09 C14).';
comment on column public.accounts.language is
  'Two readers: the client-role dashboard default (0065) and, since 0076, the language of scheduled customer messages to a contact with no language (S-09 L3). NULL = no preference; resolveLocale() falls through to en.';
```

- [ ] **Step 7: ASCII and backslash check** (a node byte count with a positive control, memory "Local DB replica" gotchas):

```bash
cd <WT> && node -e "const fs=require('fs');const f='packages/db/supabase/migrations/0076_customer_language.sql';const b=fs.readFileSync(f);let bad=0;for(const x of b){if(x>127||x===92)bad++}console.log('bad bytes',bad);const ctl=Buffer.from('a\u00e9\\\\b');let c=0;for(const x of ctl){if(x>127||x===92)c++}console.log('control',c)"
```

Expected: `bad bytes 0` and `control 3` (the é's two bytes and the backslash; if the control is not 3 the check is broken, stop).

- [ ] **Step 8: Apply to `post`, run green.**

```bash
source "<SCRATCH>/s09-t1-impl/env.sh" && cd <WT> && P -d post -1 -f packages/db/supabase/migrations/0076_customer_language.sql && cd packages/db && SUPABASE_DB_URL=postgresql://postgres@localhost:55490/post NEXT_PUBLIC_SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= BIS_CI_SUPABASE_REF= pnpm exec vitest run src/test/customer-language-schema.test.ts src/test/schema-grants-guard.test.ts src/test/booking-grants.test.ts src/test/call-proposals-grants.test.ts src/test/server-only-writes-grants.test.ts src/test/automations-grants.test.ts > "$S/t1-green.txt" 2>&1; echo $? > "$S/t1-green.exit"
```

Expected: every file green; paste the summary block's `Tests` line and the exit file's `0`.

- [ ] **Step 9: Prove Q1's data step on `post`** (the rows Step 2 seeded):

```bash
source "<SCRATCH>/s09-t1-impl/env.sh"
P -d post -At -c "select a.recipe_key || '=' || coalesce(a.body_es, 'NULL') from automations a join accounts x on x.id = a.account_id where x.clerk_org_id = 'org_s09_data' order by 1"
P -d post -At -c "select coalesce(c.followup_body_es, 'NULL') from calendars c join accounts x on x.id = c.account_id where x.clerk_org_id = 'org_s09_data'"
P -d post -At -c "select coalesce(v.textback_body_es, 'NULL') from voice_profiles v join accounts x on x.id = v.account_id where x.clerk_org_id = 'org_s09_data'"
```

Expected exactly: `instant_reply=NULL`, `no_show_nudge=NULL`, `review_request=` (empty after `=`); then an empty line (the custom calendar's `''`); then `NULL` (the voice profile on our default).

- [ ] **Step 10: Mutation probes, each red BY NAME on the replica.** For each: recreate `post` from `pre` (`P -c "drop database post"`, `P -c "create database post template pre"`, `P -d post -c "alter database post set timezone to 'UTC'"`), apply a COPY of 0076 in `$S/0076-probe.sql` with the one change, run the named test file, paste the failing test name and assertion line, then move on (the committed file is never edited for a probe):
  1. Drop the `contacts_language_source_check` line → "each value is from its closed set" FAILS.
  2. Drop `contacts_language_coherent` → "the language, its source and its time are all set or all null" FAILS.
  3. Replace `case when v_prior is null then p_language else c.language end` with `p_language` (and the two siblings likewise) → "a later, disagreeing signal moves only the last signal" FAILS.
  4. Replace each `v_last_at is null or p_at >= v_last_at` with `true` → "an older signal changes nothing" FAILS.
  5. Delete the NULL-guard `if … end if;` → "a NULL in any argument raises 22004" FAILS.
  6. Add `grant execute on function public.record_language_signal(uuid, uuid, text, text, timestamptz) to authenticated;` → "only service_role may execute it" and "a signed-in client calling it is refused" FAIL.
  7. Delete the `create trigger contacts_language_server_only …` statement → "a client INSERT carrying all seven values stores none of them" FAILS.
  8. Add `grant update (language) on public.contacts to authenticated;` → "a client UPDATE of the language is refused" FAILS, and `schema-grants-guard.test.ts` "gives anon nothing and authenticated exactly the allow-listed writes" FAILS.
  9. Delete the `grant update (followup_body_es, followup_body_es_basis)` line → the three calendars lists FAIL by name.
  10. Drop `and recipe_key <> 'instant_reply'` and run Step 9's first query → `instant_reply=` (empty) instead of `instant_reply=NULL`; drop the `where body <> ''` instead → `no_show_nudge=` (empty): the data step is wrong in both directions, paste both outputs.
  11. Drop `automations_body_es_length` → "a Spanish automation body is at most 1,000 characters" FAILS.

  Finally rebuild `post` from `pre` with the committed file and re-run Step 8 green.

- [ ] **Step 11: Commit.**

```bash
cd <WT> && git add -- packages/db/supabase/migrations/0076_customer_language.sql packages/db/src/test/customer-language-schema.test.ts && git commit -m "feat(db): 0076, a language on every contact with one service-only writer, a client-insert guard, and PR 2's Spanish-box columns (S-09)" -- packages/db/supabase/migrations/0076_customer_language.sql packages/db/src/test/customer-language-schema.test.ts packages/db/src/test/schema-grants-guard.test.ts packages/db/src/test/booking-grants.test.ts packages/db/src/test/call-proposals-grants.test.ts
```

(With the two trailer lines from Global Constraints.) Leave the replica running for the reviewer to copy; stop it (`pg_ctl -D "$S/pgdata" stop`) once review has passed.

---

## Task 2: `clearCallerLanguage` (bis-voice)

**Review:** sonnet. **Runs beside:** Tasks 1 and 3.

**Files**
- Modify: `apps/web/src/lib/voice/language.ts` (append after `detectCallerLanguage`, `:42-50`)
- Create: `apps/web/src/lib/voice/language.clear.test.ts`

**Interfaces**
- Consumes: `ES_MARKERS`, `EN_MARKERS`, `ES_CHARS`, `score` (`language.ts:7-13`); `type TranscriptEvent` from `@bis/db` (`voice.ts:45`).
- Produces (Tasks 4, 8 and 14 rely on these exact names):

```ts
export type ClearThresholds = { esMin: number; enMin: number; enRatio: number };
export const CLEAR_THRESHOLDS: ClearThresholds; // { esMin: 2, enMin: 3, enRatio: 2 } until Task 4 tunes it
export function clearCallerLanguage(transcript: TranscriptEvent[], t?: ClearThresholds): "en" | "es" | null;
export function clearCallerLanguageNow(state: { transcript: TranscriptEvent[]; pendingCallerTurn: { text: string } | null }): "en" | "es" | null;
```

- [ ] **Step 1: Write the failing test** `apps/web/src/lib/voice/language.clear.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { TranscriptEvent } from "@bis/db";
import { clearCallerLanguage, clearCallerLanguageNow, detectSpokenLanguage, CLEAR_THRESHOLDS } from "./language";

const caller = (...texts: string[]): TranscriptEvent[] => texts.map((text) => ({ role: "caller", text, at: "t" }));

describe("clearCallerLanguage (S-09 C5): the caller's own words, read strictly, the profile ignored", () => {
  it("two Spanish markers with a majority read Spanish, whatever the line's profile (mutation: honour the profile as detectSpokenLanguage does -> FAILS)", () => {
    const t = caller("hola, necesito una cita");
    expect(detectSpokenLanguage(t, "en")).toBe("en");
    expect(clearCallerLanguage(t)).toBe("es");
  });

  it("a lone 'gracias' is not enough (mutation: esMin 1 -> FAILS)", () => {
    expect(clearCallerLanguage(caller("ok gracias"))).toBeNull();
  });

  it("a tie is unclear, never a default (mutation: return 'en' on a tie as calls.language does -> FAILS)", () => {
    expect(clearCallerLanguage(caller("hola gracias, thank you"))).toBeNull();
  });

  it("three English markers and no Spanish read English", () => {
    expect(clearCallerLanguage(caller("hello, I need an appointment please"))).toBe("en");
  });

  it("code-switching Spanish is never read as English (plan deviation 4; mutation: drop the enRatio test -> 'en' -> FAILS)", () => {
    expect(clearCallerLanguage(caller("hola, I need una cita for you"))).toBeNull();
  });

  it("only the caller's turns count: a bilingual greeting says nothing (mutation: score every role -> FAILS)", () => {
    const t: TranscriptEvent[] = [
      { role: "assistant", text: "Hola, gracias por llamar. Hello, thanks for calling, how can I help you?", at: "t" },
      { role: "caller", text: "yes", at: "t" },
    ];
    expect(clearCallerLanguage(t)).toBeNull();
  });

  it("an empty transcript is unclear", () => {
    expect(clearCallerLanguage([])).toBeNull();
  });

  it("whenever it reads Spanish, the Calls badge on a 'both' line reads Spanish too (spec §7.2: the two never disagree about a Spanish caller)", () => {
    for (const t of [caller("hola, necesito una cita"), caller("buenas tardes, quiero hablar con el señor"), caller("sí, mañana por favor")]) {
      expect(clearCallerLanguage(t)).toBe("es");
      expect(detectSpokenLanguage(t, "both")).toBe("es");
    }
  });

  it("the thresholds are a parameter, so Task 4 can sweep them; the default is the shipped set", () => {
    expect(clearCallerLanguage(caller("ok gracias"), { ...CLEAR_THRESHOLDS, esMin: 1 })).toBe("es");
  });
});

describe("clearCallerLanguageNow (C7): the finished turns plus the one still arriving", () => {
  it("reads the in-flight turn (mutation: ignore pendingCallerTurn -> FAILS)", () => {
    expect(clearCallerLanguageNow({ transcript: caller("hola"), pendingCallerTurn: { text: "necesito una cita" } })).toBe("es");
    expect(clearCallerLanguageNow({ transcript: caller("hola"), pendingCallerTurn: null })).toBeNull();
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/voice/language.clear.test.ts` → FAIL: `clearCallerLanguage is not a function` (or the import's `does not provide an export named`). Paste the line.

- [ ] **Step 3: Implement.** Append to `apps/web/src/lib/voice/language.ts`:

```ts
/** S-09 C5's thresholds. Tuned on stored transcripts before PR 1 merged (Q7; plan Task 4). */
export type ClearThresholds = { esMin: number; enMin: number; enRatio: number };
export const CLEAR_THRESHOLDS: ClearThresholds = { esMin: 2, enMin: 3, enRatio: 2 };

/**
 * The language a CONTACT is recorded as speaking (S-09 C5): a strict reading of the caller's own
 * turns, the voice profile IGNORED, and null when the words do not say. Never `calls.language`,
 * which is forced to the profile's language and turns every tie into English: both defaults, not
 * evidence. Spanish needs the Calls badge's own rule (so the two never disagree about a Spanish
 * caller); English needs more, because EN_MARKERS holds words a code-switching Spanish speaker says
 * every sentence, and a false English is the costly error (it sets English or raises a hint).
 */
export function clearCallerLanguage(transcript: TranscriptEvent[], t: ClearThresholds = CLEAR_THRESHOLDS): "en" | "es" | null {
  const callerText = transcript.filter((e) => e.role === "caller").map((e) => e.text).join(" ");
  const es = score(callerText, ES_MARKERS) + score(callerText, ES_CHARS);
  const en = score(callerText, EN_MARKERS);
  if (es >= t.esMin && es > en) return "es";
  if (en >= t.enMin && en >= t.enRatio * es) return "en";
  return null;
}

/** The strict reading over the finished turns plus the one still arriving (C7), as
 *  `detectCallerLanguage` reads them: a phone booking signals before the call ends. */
export function clearCallerLanguageNow(
  state: { transcript: TranscriptEvent[]; pendingCallerTurn: { text: string } | null },
): "en" | "es" | null {
  const inFlight = state.pendingCallerTurn?.text.trim();
  return clearCallerLanguage(inFlight ? [...state.transcript, { role: "caller", text: inFlight, at: "" }] : state.transcript);
}
```

- [ ] **Step 4: Run green.** `pnpm --filter web exec vitest run src/lib/voice/language.clear.test.ts src/lib/voice/language.test.ts` → both green; `pnpm --filter web typecheck` → clean. Paste the summary lines.
- [ ] **Step 5: Probes** (each red by name, then revert): add `return detectSpokenLanguage(transcript, "en");` as the function's first line (honouring an English-only profile) → "two Spanish markers … whatever the line's profile" FAILS; delete `&& en >= t.enRatio * es` → "code-switching Spanish is never read as English" FAILS; drop the `.filter((e) => e.role === "caller")` → "only the caller's turns count" FAILS; replace `return null` with `return "en"` → "a tie is unclear" FAILS; drop `inFlight ? … :` → "reads the in-flight turn" FAILS.
- [ ] **Step 6: Commit.**

```bash
cd <WT> && git add -- apps/web/src/lib/voice/language.clear.test.ts && git commit -m "feat(voice): clearCallerLanguage, a strict reading of the caller's own words that answers unclear instead of a default (S-09 C5)" -- apps/web/src/lib/voice/language.ts apps/web/src/lib/voice/language.clear.test.ts
```

---

## Task 3: A read-only production sample of caller turns (orchestrator)

**Runs beside:** Tasks 1 and 2. Writes no repo file.

- [ ] **Step 1.** Through the Supabase MCP `execute_sql` on production (`tlbkbmlrfafquucsmsmm`), READ-ONLY:

```sql
select c.id, c.account_id, c.contact_id, c.started_at,
       (select string_agg(e->>'text', ' ' order by t.ord)
          from jsonb_array_elements(c.transcript) with ordinality as t(e, ord)
         where e->>'role' = 'caller') as caller_text
  from public.calls c
 where jsonb_array_length(c.transcript) > 0
 order by c.started_at desc
 limit 200;
```

- [ ] **Step 2.** Write the rows as a JSON array to `<SCRATCH>/s09-evidence/q7-sample.json` (`[{ "id", "account_id", "contact_id", "started_at", "caller_text" }]`). Record ONLY the row count and the number with a non-empty `caller_text` in the ledger. Never commit the file; never paste a transcript into a report or a brief. Hand Task 4 the path.

---

## Task 4: Tune the thresholds on the sample (bis-voice, Q7)

**Review:** opus. **Depends on:** Tasks 2 and 3. **Scratch:** `<SCRATCH>/s09-t4-impl/` (the evidence stays in `<SCRATCH>/s09-evidence/`).

**Files**
- Modify: `apps/web/src/lib/voice/language.ts` (`CLEAR_THRESHOLDS` only, and its comment)
- Modify: `apps/web/src/lib/voice/language.clear.test.ts` (only if the tuned values change a case's expected answer; each change named in the report)

**Interfaces**
- Consumes: `clearCallerLanguage(transcript, t)`, `CLEAR_THRESHOLDS` (Task 2).
- Produces: the committed `CLEAR_THRESHOLDS` (Tasks 8 and 14 read it through `clearCallerLanguage`'s default).

- [ ] **Step 1: Label blind, before classifying.** Read `<SCRATCH>/s09-evidence/q7-sample.json` and, for every row with a non-empty `caller_text`, decide by reading the caller's words what language they spoke: `"es"`, `"en"`, or `"unclear"` (too little said, or an even mix). Write `<SCRATCH>/s09-t4-impl/labels.json` as `{ "<call id>": "es" | "en" | "unclear" }`. Do not run the classifier until every row is labelled. Rows with an empty `caller_text` are not labelled (they are `null` by construction).
- [ ] **Step 2: The sweep script** `<SCRATCH>/s09-t4-impl/tune.ts` (scratch only, never committed):

```ts
import { readFileSync } from "node:fs";
import { clearCallerLanguage, CLEAR_THRESHOLDS, type ClearThresholds } from "<WT>/apps/web/src/lib/voice/language.ts";

type Row = { id: string; caller_text: string | null };
const rows = (JSON.parse(readFileSync("<SCRATCH>/s09-evidence/q7-sample.json", "utf8")) as Row[]).filter((r) => r.caller_text?.trim());
const labels = JSON.parse(readFileSync("<SCRATCH>/s09-t4-impl/labels.json", "utf8")) as Record<string, "es" | "en" | "unclear">;

const grid: ClearThresholds[] = [];
for (const esMin of [2, 3]) for (const enMin of [2, 3, 4, 5]) for (const enRatio of [1.5, 2, 3]) grid.push({ esMin, enMin, enRatio });

const lines = grid.map((t) => {
  const n = { esRight: 0, enRight: 0, falseEn: 0, falseEs: 0, unread: 0, readUnclear: 0 };
  for (const r of rows) {
    const got = clearCallerLanguage([{ role: "caller", text: r.caller_text!, at: "" }], t);
    const want = labels[r.id];
    if (got === null) { n.unread++; continue; }
    if (want === "unclear") n.readUnclear++;
    else if (got === want) got === "es" ? n.esRight++ : n.enRight++;
    else got === "en" ? n.falseEn++ : n.falseEs++;
  }
  return { t, ...n };
});
const fmt = (l: (typeof lines)[number]) =>
  `es>=${l.t.esMin} en>=${l.t.enMin} ratio ${l.t.enRatio}: esRight ${l.esRight} enRight ${l.enRight} falseEn ${l.falseEn} falseEs ${l.falseEs} readUnclear ${l.readUnclear} unread ${l.unread}`;
console.log(`rows ${rows.length}; labels es ${Object.values(labels).filter((v) => v === "es").length} en ${Object.values(labels).filter((v) => v === "en").length} unclear ${Object.values(labels).filter((v) => v === "unclear").length}`);
for (const l of lines) console.log(fmt(l));
const current = lines.find((l) => JSON.stringify(l.t) === JSON.stringify(CLEAR_THRESHOLDS))!;
console.log(`CURRENT ${fmt(current)}`);
```

Run: `cd <WT> && pnpm --filter web exec tsx "<SCRATCH>/s09-t4-impl/tune.ts" > "<SCRATCH>/s09-t4-impl/sweep.txt" 2>&1`.

- [ ] **Step 3: Choose, by this rule, in this order.** (a) `falseEn` must be 0 (a false English is the costly error, spec §7.2). (b) Then the smallest `falseEs`. (c) Then the fewest `readUnclear`. (d) Then the most `esRight + enRight`. (e) A tie keeps the current values. **If the sample has fewer than 30 labelled `es`/`en` rows, keep the current values** and write "thresholds not validated on real traffic: n = …" in the report for the ledger (spec §19's risk stands).
- [ ] **Step 4: Apply.** If the choice differs from `{ esMin: 2, enMin: 3, enRatio: 2 }`, change `CLEAR_THRESHOLDS` and its comment to say "tuned 2026-10-?? on n = … labelled production calls: falseEn 0, falseEs …, coverage …". If `esMin` moves off 2, the "never disagree about a Spanish caller" case still holds only if `esMin >= 2` (the badge's floor); never set it below 2. Re-run `pnpm --filter web exec vitest run src/lib/voice/language.clear.test.ts`; a case whose answer the new values change is updated to the new answer and named in the report with why.
- [ ] **Step 5: Report** the `rows`/`labels` line, the CURRENT line and the chosen line from `sweep.txt` (counts only, no text), and the choice rule's step that decided it.
- [ ] **Step 6: Commit** (only when the values changed):

```bash
cd <WT> && git commit -m "feat(voice): clearCallerLanguage thresholds tuned on a labelled sample of stored calls (S-09 Q7)" -- apps/web/src/lib/voice/language.ts apps/web/src/lib/voice/language.clear.test.ts
```

---

## Task 5: `@bis/db`: the language columns, `recordLanguageSignal` and the staff writers (bis-crm)

**Review:** opus. **Depends on:** Task 1. **Scratch:** `<SCRATCH>/s09-t5-impl/`, Postgres `55492`, PostgREST `55493`, gateway `55494` (reviewer `s09-t5-review/`, `55495`–`55497`).

**Files**
- Modify: `packages/db/src/contacts.ts:58-59` (`COLS`), append the language block after `setContactPhoneCountry` (`:1064-1093`)
- Modify: `packages/db/src/index.ts:23` (one new export line after it)
- Create: `packages/db/src/test/contact-language.test.ts`

**Interfaces**
- Consumes: 0076 (Task 1); `emit(db, accountId, type, actorId, payload, actorType?)` (`events.ts:16`); `withTestAccount` (`test/fixtures.ts:140`); `createContact` (`contacts.ts:414`).
- Produces (exported from `@bis/db`):

```ts
export type ContactLanguage = "en" | "es";
export type LanguageSource = "booking" | "form" | "call" | "staff";
export type LanguageSignalSource = Exclude<LanguageSource, "staff">;
/** contacts.language, its source and when it was set: all three null, or all three set (0076). */
export type LanguageTriple = { language: ContactLanguage | null; source: LanguageSource | null; setAt: string | null };
export const LANGUAGE_SOURCES: readonly LanguageSource[];
export function isLanguageTriple(v: unknown): v is LanguageTriple;
export async function recordLanguageSignal(db: SupabaseClient, accountId: string, contactId: string,
  signal: { language: ContactLanguage; source: LanguageSignalSource; at: Date | string }, actorId: string, actorType: ActorType): Promise<boolean>;
export async function setContactLanguage(db: SupabaseClient, accountId: string, contactId: string, language: ContactLanguage, actorId: string): Promise<boolean>;
export async function restoreContactLanguage(db: SupabaseClient, accountId: string, contactId: string, prior: LanguageTriple, actorId: string): Promise<boolean>;
export async function keepContactLanguageHint(db: SupabaseClient, accountId: string, contactId: string, actorId: string): Promise<boolean>;
```

`getContact` / `listContacts` rows gain the seven 0076 columns. Events: `contact.language_set` (payload `{ contactId, language, source }`, plus `undo: true` from a restore), `contact.language_hint_kept` (payload `{ contactId }`).

- [ ] **Step 1: Stand up your local API.** Build the replica exactly as Task 1 steps 1 and 8 on port `55492` (database `post`, Task 1's committed 0076 applied; skip Task 1's Step 2 seed). Then copy the relationships plan's harness (`git show HEAD:docs/superpowers/plans/2026-10-11-contact-relationships.md`, its Task 2 "Stand up your local API" step: `gateway.mjs`, `pgrst.conf`, `run.sh`) into `<SCRATCH>/s09-t5-impl/`, changing only: ports `55472`/`55473`/`55474` → `55492`/`55493`/`55494`, the scratch path to `s09-t5-impl`, and the local-only secret to `local-replica-only-secret-s09-not-a-real-key-0076` (in both `gateway.mjs` and `pgrst.conf`). Fingerprint: `run.sh fp.txt src/test/contacts.test.ts` is green. **If the local API is not up in 20 minutes, stop and report**; the orchestrator then proves this task through CI `verify`. Never run it against bis-ci.
- [ ] **Step 2: Write the failing test** `packages/db/src/test/contact-language.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { withTestAccount } from "./fixtures";
import {
  createContact, getContact, recordLanguageSignal, setContactLanguage, restoreContactLanguage, keepContactLanguageHint,
} from "../contacts";

const ACTOR = "user_test";
const T1 = "2026-10-03T15:00:00.000Z";
const T2 = "2026-10-05T15:00:00.000Z";
const iso = (v: unknown) => (v === null ? null : new Date(v as string).toISOString());

async function eventsOf(db: SupabaseClient, accountId: string, type: string) {
  const { data, error } = await db.from("events").select("actor_type, actor_id, payload").eq("account_id", accountId).eq("type", type);
  if (error) throw new Error(error.message);
  return data;
}
async function ana(db: SupabaseClient, accountId: string) {
  return (await createContact(db, accountId, { firstName: "Ana" }, ACTOR)).id;
}

describe("recordLanguageSignal (S-09 §7.1, C3)", () => {
  it("the first sign sets the language and emits once with the CALLER's actor; a later one only moves the last sign and emits nothing (mutation: emit when the rpc said false -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      expect(await recordLanguageSignal(db, accountId, id, { language: "es", source: "booking", at: T1 }, "public", "system")).toBe(true);
      expect(await recordLanguageSignal(db, accountId, id, { language: "en", source: "call", at: new Date(T2) }, "voice", "ai")).toBe(false);
      const c = (await getContact(db, accountId, id))!;
      expect({ ...c, language_set_at: iso(c.language_set_at), last_language_signal_at: iso(c.last_language_signal_at) }).toMatchObject({
        language: "es", language_source: "booking", language_set_at: T1,
        last_language_signal: "en", last_language_signal_source: "call", last_language_signal_at: T2, language_hint_kept_at: null,
      });
      expect(await eventsOf(db, accountId, "contact.language_set")).toEqual([
        { actor_type: "system", actor_id: "public", payload: { contactId: id, language: "es", source: "booking" } },
      ]);
    }));

  it("an rpc error throws, naming the writer (mutation: swallow it -> FAILS)", () => withTestAccount(async (db, accountId) => {
    await expect(recordLanguageSignal(db, accountId, "not-a-uuid", { language: "es", source: "form", at: T1 }, "form", "system"))
      .rejects.toThrow(/recordLanguageSignal failed/);
  }));
});

describe("the staff writers (S-09 §7.5, C9)", () => {
  it("setContactLanguage writes a staff choice now, over any sign, and emits as the user (mutation: source 'booking' -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await recordLanguageSignal(db, accountId, id, { language: "es", source: "booking", at: T1 }, "public", "system");
      const before = Date.now();
      expect(await setContactLanguage(db, accountId, id, "en", ACTOR)).toBe(true);
      const c = (await getContact(db, accountId, id))!;
      expect([c.language, c.language_source]).toEqual(["en", "staff"]);
      expect(Date.parse(c.language_set_at as string)).toBeGreaterThanOrEqual(before - 1000);
      expect((await eventsOf(db, accountId, "contact.language_set")).at(-1)).toEqual(
        { actor_type: "user", actor_id: ACTOR, payload: { contactId: id, language: "en", source: "staff" } });
    }));

  it("restoreContactLanguage puts back the prior triple EXACTLY, its source and time included (mutation: restore through setContactLanguage -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await recordLanguageSignal(db, accountId, id, { language: "es", source: "booking", at: T1 }, "public", "system");
      await setContactLanguage(db, accountId, id, "en", ACTOR);
      expect(await restoreContactLanguage(db, accountId, id, { language: "es", source: "booking", setAt: T1 }, ACTOR)).toBe(true);
      const c = (await getContact(db, accountId, id))!;
      expect([c.language, c.language_source, iso(c.language_set_at)]).toEqual(["es", "booking", T1]);
      expect(await restoreContactLanguage(db, accountId, id, { language: null, source: null, setAt: null }, ACTOR)).toBe(true);
      const cleared = (await getContact(db, accountId, id))!;
      expect([cleared.language, cleared.language_source, cleared.language_set_at]).toEqual([null, null, null]);
    }));

  it("an incoherent prior is refused before anything is written (mutation: drop isLanguageTriple -> the db check raises instead, a different message -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await expect(restoreContactLanguage(db, accountId, id, { language: "es", source: null, setAt: null }, ACTOR))
        .rejects.toThrow(/not a language triple/);
      await expect(restoreContactLanguage(db, accountId, id, { language: "es", source: "import" as never, setAt: T1 }, ACTOR))
        .rejects.toThrow(/not a language triple/);
    }));

  it("keepContactLanguageHint stamps only language_hint_kept_at (mutation: also clear the last sign -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const id = await ana(db, accountId);
      await recordLanguageSignal(db, accountId, id, { language: "es", source: "form", at: T1 }, "form", "system");
      await recordLanguageSignal(db, accountId, id, { language: "en", source: "call", at: T2 }, "voice", "ai");
      expect(await keepContactLanguageHint(db, accountId, id, ACTOR)).toBe(true);
      const c = (await getContact(db, accountId, id))!;
      expect([c.language, c.last_language_signal]).toEqual(["es", "en"]);
      expect(c.language_hint_kept_at).not.toBeNull();
    }));

  it("each writer answers false for a contact not in this account and writes nothing (mutation: drop .eq('account_id') -> FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db, otherAccountId) => {
        const theirs = await ana(db, otherAccountId);
        expect(await setContactLanguage(db, accountId, theirs, "es", ACTOR)).toBe(false);
        expect(await keepContactLanguageHint(db, accountId, theirs, ACTOR)).toBe(false);
        expect(await restoreContactLanguage(db, accountId, theirs, { language: "es", source: "staff", setAt: T1 }, ACTOR)).toBe(false);
        expect((await getContact(db, otherAccountId, theirs))!.language).toBeNull();
      });
    }));
});
```

- [ ] **Step 3: Run red.** `"<SCRATCH>/s09-t5-impl/run.sh" t5-red.txt src/test/contact-language.test.ts` → FAIL: `does not provide an export named 'recordLanguageSignal'` (or `recordLanguageSignal is not a function`). Paste the line.
- [ ] **Step 4: Implement.** `COLS` (`contacts.ts:58-59`) stays ONE literal (the comment above it says why):

```ts
const COLS =
  "id, first_name, last_name, email, phone, company_name, source, custom, attribution, created_at, updated_at, sort_name, phone_country_unconfirmed, assigned_to, language, language_source, language_set_at, last_language_signal, last_language_signal_source, last_language_signal_at, language_hint_kept_at";
```

Append after `setContactPhoneCountry`:

```ts
// ---------------------------------------------------------------------------
// S-09: a language on every contact (migration 0076). The automatic writer is the SQL function
// `record_language_signal` (service role only: it sets the language only while it is null, so a
// staff choice is never overwritten). The staff writers below run on the SERVICE client, after the
// server action proved the contact on the caller's own client (getContact under RLS): the client role
// holds no UPDATE on these columns.
// ---------------------------------------------------------------------------
export type ContactLanguage = "en" | "es";
export type LanguageSource = "booking" | "form" | "call" | "staff";
export type LanguageSignalSource = Exclude<LanguageSource, "staff">;
/** contacts.language, its source and when it was set: all three null, or all three set (0076). */
export type LanguageTriple = { language: ContactLanguage | null; source: LanguageSource | null; setAt: string | null };
export const LANGUAGE_SOURCES: readonly LanguageSource[] = ["booking", "form", "call", "staff"];

/** The shape 0076's coherence check accepts, checked before a write so a forged Undo payload is refused here. */
export function isLanguageTriple(v: unknown): v is LanguageTriple {
  if (typeof v !== "object" || v === null) return false;
  const t = v as Record<string, unknown>;
  if (t.language === null && t.source === null && t.setAt === null) return true;
  return (t.language === "en" || t.language === "es")
    && typeof t.source === "string" && (LANGUAGE_SOURCES as readonly string[]).includes(t.source)
    && typeof t.setAt === "string" && Number.isFinite(Date.parse(t.setAt));
}

/**
 * One customer sign (S-09 §7.1): records it as the contact's last sign and sets the language when it
 * has none. Emits `contact.language_set` with the caller's actor ONLY when this call set the language.
 * Throws on an rpc error; every caller wraps it in its own try (a sign must never cost a booking, a
 * form or a call).
 */
export async function recordLanguageSignal(
  db: SupabaseClient, accountId: string, contactId: string,
  signal: { language: ContactLanguage; source: LanguageSignalSource; at: Date | string },
  actorId: string, actorType: ActorType,
): Promise<boolean> {
  const at = typeof signal.at === "string" ? signal.at : signal.at.toISOString();
  const { data, error } = await db.rpc("record_language_signal", {
    p_account: accountId, p_contact: contactId, p_language: signal.language, p_source: signal.source, p_at: at,
  });
  if (error) throw new Error(`recordLanguageSignal failed: ${error.message}`);
  if (data !== true) return false;
  await emit(db, accountId, "contact.language_set", actorId,
    { contactId, language: signal.language, source: signal.source }, actorType);
  return true;
}

async function writeLanguage(
  db: SupabaseClient, accountId: string, contactId: string, patch: Record<string, string | null>,
): Promise<boolean> {
  const { data, error } = await db.from("contacts").update({ ...patch, updated_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId).select("id");
  if (error) throw new Error(`contact language write failed: ${error.message}`);
  return (data ?? []).length > 0;
}

/** A staff choice (S-09 §7.5): `staff`, now. False when the contact is not in this account. */
export async function setContactLanguage(
  db: SupabaseClient, accountId: string, contactId: string, language: ContactLanguage, actorId: string,
): Promise<boolean> {
  const wrote = await writeLanguage(db, accountId, contactId,
    { language, language_source: "staff", language_set_at: new Date().toISOString() });
  if (wrote) await emit(db, accountId, "contact.language_set", actorId, { contactId, language, source: "staff" }, "user");
  return wrote;
}

/** Undo (C9): the prior triple back EXACTLY, its source and time included, "not set" included. */
export async function restoreContactLanguage(
  db: SupabaseClient, accountId: string, contactId: string, prior: LanguageTriple, actorId: string,
): Promise<boolean> {
  if (!isLanguageTriple(prior)) throw new Error("restoreContactLanguage: not a language triple");
  const wrote = await writeLanguage(db, accountId, contactId,
    { language: prior.language, language_source: prior.source, language_set_at: prior.setAt });
  if (wrote) await emit(db, accountId, "contact.language_set", actorId,
    { contactId, language: prior.language, source: prior.source, undo: true }, "user");
  return wrote;
}

/** Keep (§7.4): the hint stays away until a newer sign. Nothing about the customer changes. */
export async function keepContactLanguageHint(
  db: SupabaseClient, accountId: string, contactId: string, actorId: string,
): Promise<boolean> {
  const { data, error } = await db.from("contacts").update({ language_hint_kept_at: new Date().toISOString() })
    .eq("account_id", accountId).eq("id", contactId).select("id");
  if (error) throw new Error(`keepContactLanguageHint failed: ${error.message}`);
  const wrote = (data ?? []).length > 0;
  if (wrote) await emit(db, accountId, "contact.language_hint_kept", actorId, { contactId }, "user");
  return wrote;
}
```

`packages/db/src/index.ts`, one line after `:23`:

```ts
export { recordLanguageSignal, setContactLanguage, restoreContactLanguage, keepContactLanguageHint, isLanguageTriple, LANGUAGE_SOURCES,
         type ContactLanguage, type LanguageSource, type LanguageSignalSource, type LanguageTriple } from "./contacts";
```

- [ ] **Step 5: Run green.** `run.sh t5-green.txt src/test/contact-language.test.ts src/test/contacts.test.ts`, then `pnpm --filter @bis/db exec tsc --noEmit > "<SCRATCH>/s09-t5-impl/tsc.txt" 2>&1; echo $? > "<SCRATCH>/s09-t5-impl/tsc.exit"` and `pnpm --filter web typecheck` (the wider `getContact` row must not break a web caller). Paste the summary lines and both exits.
- [ ] **Step 6: Probes** (each red by name, revert): emit before the `data !== true` check → "the first sign sets the language and emits once" FAILS; `language_source: "booking"` in `setContactLanguage` → "setContactLanguage writes a staff choice" FAILS; `restoreContactLanguage` calling `setContactLanguage(…, prior.language!)` → "restoreContactLanguage puts back the prior triple EXACTLY" FAILS; delete the `isLanguageTriple` line → "an incoherent prior is refused" FAILS (the database's check raises with a different message); drop `.eq("account_id", accountId)` in `writeLanguage` → "each writer answers false for a contact not in this account" FAILS.
- [ ] **Step 7: Commit.**

```bash
cd <WT> && git add -- packages/db/src/test/contact-language.test.ts && git commit -m "feat(db): recordLanguageSignal and the staff language writers, emitting only when the language changed (S-09 §7)" -- packages/db/src/contacts.ts packages/db/src/index.ts packages/db/src/test/contact-language.test.ts
```

---

## Task 6: `lib/contacts/language.ts` and every key (bis-crm; messages.ts, the only writer)

**Review:** sonnet. **Depends on:** Task 5.

**Files**
- Create: `apps/web/src/lib/contacts/language.ts`, `apps/web/src/lib/contacts/language.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (a block after `"contact.source.machine.form.es"`, `:726`) — this task's LAST code step

**Interfaces**
- Consumes: `ContactLanguage`, `LanguageSource`, `LanguageSignalSource` (Task 5, `@bis/db`); `LANGUAGE_OPTIONS` (`lib/i18n/language-options.ts:7-10`); `type Tr`, `makeTr` (`lib/record/copy.ts:9-22`); `type Locale` (`lib/i18n/locale.ts:6`).
- Produces (Tasks 7, 9, 10, 11, 12 and 14 rely on these exact names):

```ts
export type ContactLanguageFacts = {
  language: ContactLanguage | null; language_source: LanguageSource | null; language_set_at: string | null;
  last_language_signal: ContactLanguage | null; last_language_signal_source: LanguageSignalSource | null;
  last_language_signal_at: string | null; language_hint_kept_at: string | null;
};
export type LanguageView = {
  value: ContactLanguage | null;
  /** The endonym ("English" / "Español"), null when not set. */
  valueLabel: string | null;
  /** "from their booking (Oct 3)" when set; the whole Not set sentence when not. */
  phrase: string;
  hint: { language: ContactLanguage; text: string } | null;
};
export const LANGUAGE_ENDONYM: Readonly<Record<ContactLanguage, string>>;
export function pageLanguageSignal(locale: ContactLanguage, accountLanguage: ContactLanguage | null): ContactLanguage | null;
export function languageHint(c: ContactLanguageFacts): { language: ContactLanguage; source: LanguageSignalSource } | null;
export function languageView(c: ContactLanguageFacts, opts: { accountLanguage: ContactLanguage | null | undefined; zone: string; tr: Tr }): LanguageView;
export function parseLanguageView(v: unknown): LanguageView | null;
```

Keys (exact): `contact.language.label`, `.notSet`, `.notSetAccount`, `.notSetUnknown`, `.choose`, `.from.booking`, `.from.form`, `.from.call`, `.from.staff`, `.hint.call`, `.hint.booking`, `.hint.form`, `.switch`, `.keep`, `.setToast`, `.keptToast`, `.saveFailed`, `language.name.en`, `language.name.es`, each with `.es`.

- [ ] **Step 1: Write the failing test** `apps/web/src/lib/contacts/language.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { makeTr } from "@/lib/record/copy";
import { pageLanguageSignal, languageHint, languageView, parseLanguageView, type ContactLanguageFacts } from "./language";

const T0 = "2026-10-01T15:00:00.000Z";
const T1 = "2026-10-03T15:00:00.000Z";
const T2 = "2026-10-05T15:00:00.000Z";
const T3 = "2026-10-07T15:00:00.000Z";
const NONE: ContactLanguageFacts = {
  language: null, language_source: null, language_set_at: null,
  last_language_signal: null, last_language_signal_source: null, last_language_signal_at: null, language_hint_kept_at: null,
};
const set = (over: Partial<ContactLanguageFacts> = {}): ContactLanguageFacts => ({
  ...NONE, language: "es", language_source: "booking", language_set_at: T1,
  last_language_signal: "es", last_language_signal_source: "booking", last_language_signal_at: T1, ...over,
});
const disagreeing = (over: Partial<ContactLanguageFacts> = {}) =>
  set({ last_language_signal: "en", last_language_signal_source: "call", last_language_signal_at: T2, ...over });

describe("pageLanguageSignal (C6, Q2): a page's language counts only when it is not what the customer would get anyway", () => {
  it("Spanish on an English account is a sign (mutation: never count -> FAILS)", () => {
    expect(pageLanguageSignal("es", null)).toBe("es");
    expect(pageLanguageSignal("es", "en")).toBe("es");
  });
  it("English on an English account, or no account language, is nothing (mutation: always count -> FAILS)", () => {
    expect(pageLanguageSignal("en", null)).toBeNull();
    expect(pageLanguageSignal("en", "en")).toBeNull();
  });
  it("English on a Spanish account is a sign; Spanish there is nothing", () => {
    expect(pageLanguageSignal("en", "es")).toBe("en");
    expect(pageLanguageSignal("es", "es")).toBeNull();
  });
});

describe("languageHint (§7.4): four lines, each with the case only it hides", () => {
  it("a later disagreeing sign shows", () => {
    expect(languageHint(disagreeing())).toEqual({ language: "en", source: "call" });
  });
  it("line 1: no language, no hint (mutation: drop it -> FAILS)", () => {
    expect(languageHint({ ...NONE, last_language_signal: "en", last_language_signal_source: "call", last_language_signal_at: T2 })).toBeNull();
  });
  it("line 2: a sign that agrees never shows (mutation: drop `<> language` -> FAILS)", () => {
    expect(languageHint(set({ last_language_signal_at: T2, last_language_signal_source: "call" }))).toBeNull();
  });
  it("line 3: a staff choice made after the sign hides it (mutation: drop `signal_at > set_at` -> FAILS)", () => {
    expect(languageHint(disagreeing({ language_source: "staff", language_set_at: T3 }))).toBeNull();
  });
  it("line 4: Keep hides it until a NEWER sign, which shows it again (mutation: drop the kept test -> FAILS)", () => {
    expect(languageHint(disagreeing({ language_hint_kept_at: T3 }))).toBeNull();
    expect(languageHint(disagreeing({ language_hint_kept_at: T0 }))).toEqual({ language: "en", source: "call" });
  });
});

describe("languageView (§8.2, C8): the line, in the reader's language and the account's zone", () => {
  const view = (c: ContactLanguageFacts, accountLanguage: "en" | "es" | null | undefined = null, locale: "en" | "es" = "en") =>
    languageView(c, { accountLanguage, zone: "America/Chicago", tr: makeTr(locale) });

  it("set: the endonym, then the source and the day in the account's zone (03:00 UTC on Oct 4 is Oct 3 in Chicago)", () => {
    expect(view(set({ language_set_at: "2026-10-04T03:00:00.000Z" }))).toEqual({
      value: "es", valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null,
    });
  });
  it("each source's phrase, English and Spanish (mutation: one key for every source -> FAILS)", () => {
    const phrases = (["booking", "form", "call", "staff"] as const).map((s) => view(set({ language_source: s })).phrase);
    expect(phrases).toEqual(["from their booking (Oct 3)", "from a form they filled in (Oct 3)", "from a call (Oct 3)", "set by your team (Oct 3)"]);
    expect(view(set(), null, "es").phrase).toBe("por su cita (3 oct)");
  });
  it("not set: English with no account language; the account's language named when it has one; nothing claimed when it could not be read (deviation 10)", () => {
    expect(view(NONE, null).phrase).toBe("Not set. Messages go out in English.");
    expect(view(NONE, "es").phrase).toBe("Not set. Messages go out in Spanish, the account's language.");
    expect(view(NONE, "es", "es").phrase).toBe("Sin definir. Los mensajes salen en español, el idioma de la cuenta.");
    expect(view(NONE, undefined).phrase).toBe("Not set.");
    expect(view(NONE).value).toBeNull();
  });
  it("the hint's words name the sign's source and language (mutation: always the call sentence -> FAILS)", () => {
    expect(view(disagreeing()).hint).toEqual({ language: "en", text: "Spoke English on the last call. Switch to English?" });
    expect(view(disagreeing({ last_language_signal_source: "form" })).hint?.text).toBe("Filled in a form in English last time. Switch to English?");
    expect(view(disagreeing(), null, "es").hint?.text).toBe("En la última llamada habló inglés. ¿Cambiar a inglés?");
  });
});

describe("parseLanguageView: the drawer's body is checked, not cast", () => {
  it("accepts what languageView builds and refuses anything else (mutation: return v as LanguageView -> FAILS)", () => {
    const good = languageView(disagreeing(), { accountLanguage: null, zone: "UTC", tr: makeTr("en") });
    expect(parseLanguageView(JSON.parse(JSON.stringify(good)))).toEqual(good);
    for (const bad of [null, {}, { ...good, value: "fr" }, { ...good, phrase: 3 }, { ...good, hint: { language: "en" } }, { ...good, valueLabel: undefined }]) {
      expect(parseLanguageView(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/contacts/language.test.ts` → FAIL: `Failed to resolve import "./language"`. Paste the line.
- [ ] **Step 3: Implement** `apps/web/src/lib/contacts/language.ts`:

```ts
import type { ContactLanguage, LanguageSource, LanguageSignalSource } from "@bis/db";
import type { MessageKey } from "@/lib/messages";
import type { Tr } from "@/lib/record/copy";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language-options";

/** The seven 0076 columns, as getContact reads them. */
export type ContactLanguageFacts = {
  language: ContactLanguage | null; language_source: LanguageSource | null; language_set_at: string | null;
  last_language_signal: ContactLanguage | null; last_language_signal_source: LanguageSignalSource | null;
  last_language_signal_at: string | null; language_hint_kept_at: string | null;
};

/** The record's Language line, built on the server in the reader's language (S-09 §8.2). */
export type LanguageView = {
  value: ContactLanguage | null;
  /** The endonym ("English" / "Español"), null when not set. */
  valueLabel: string | null;
  /** "from their booking (Oct 3)" when set; the whole Not set sentence when not. */
  phrase: string;
  hint: { language: ContactLanguage; text: string } | null;
};

export const LANGUAGE_ENDONYM: Readonly<Record<ContactLanguage, string>> =
  Object.fromEntries(LANGUAGE_OPTIONS.map((o) => [o.value, o.label])) as Record<ContactLanguage, string>;

/**
 * C6 / Q2: no public page offers a language choice, so a page's language is the business's default
 * unless it differs from what the customer would get anyway (the account's language, else English).
 * Only then is it the customer's sign.
 */
export function pageLanguageSignal(locale: ContactLanguage, accountLanguage: ContactLanguage | null): ContactLanguage | null {
  return locale === (accountLanguage ?? "en") ? null : locale;
}

const after = (a: string, b: string) => Date.parse(a) > Date.parse(b);

/** §7.4, computed on read (C4): a later sign that disagrees, not answered by a staff choice or a Keep since. */
export function languageHint(c: ContactLanguageFacts): { language: ContactLanguage; source: LanguageSignalSource } | null {
  if (c.language === null || c.language_set_at === null) return null;
  if (c.last_language_signal === null || c.last_language_signal_source === null || c.last_language_signal_at === null) return null;
  if (c.last_language_signal === c.language) return null;
  if (!after(c.last_language_signal_at, c.language_set_at)) return null;
  if (c.language_hint_kept_at !== null && !after(c.last_language_signal_at, c.language_hint_kept_at)) return null;
  return { language: c.last_language_signal, source: c.last_language_signal_source };
}

const NAME_KEY: Record<ContactLanguage, MessageKey> = { en: "language.name.en", es: "language.name.es" };
const FROM_KEY: Record<LanguageSource, MessageKey> = {
  booking: "contact.language.from.booking", form: "contact.language.from.form",
  call: "contact.language.from.call", staff: "contact.language.from.staff",
};
const HINT_KEY: Record<LanguageSignalSource, MessageKey> = {
  booking: "contact.language.hint.booking", form: "contact.language.hint.form", call: "contact.language.hint.call",
};

/** "Oct 3" / "3 oct": the day the language was set, in the account's zone. */
function shortDay(at: string, zone: string, locale: Tr["locale"]): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-US" : "en-US", { timeZone: zone, month: "short", day: "numeric" }).format(new Date(at));
}

/**
 * The Details line (§8.2). `accountLanguage`: the account's language, null when it has none, undefined
 * when its row could not be read (then the line claims nothing about what goes out; plan deviation 10).
 */
export function languageView(
  c: ContactLanguageFacts, opts: { accountLanguage: ContactLanguage | null | undefined; zone: string; tr: Tr },
): LanguageView {
  const { tr } = opts;
  if (c.language === null || c.language_source === null || c.language_set_at === null) {
    const phrase = opts.accountLanguage === undefined ? tr.text("contact.language.notSetUnknown")
      : opts.accountLanguage === null ? tr.text("contact.language.notSet", { language: tr.text(NAME_KEY.en) })
        : tr.text("contact.language.notSetAccount", { language: tr.text(NAME_KEY[opts.accountLanguage]) });
    return { value: null, valueLabel: null, phrase, hint: null };
  }
  const hint = languageHint(c);
  return {
    value: c.language,
    valueLabel: LANGUAGE_ENDONYM[c.language],
    phrase: tr.text(FROM_KEY[c.language_source], { date: shortDay(c.language_set_at, opts.zone, tr.locale) }),
    hint: hint ? { language: hint.language, text: tr.text(HINT_KEY[hint.source], { language: tr.text(NAME_KEY[hint.language]) }) } : null,
  };
}

const isLang = (v: unknown): v is ContactLanguage => v === "en" || v === "es";

/** The drawer's body is checked, not cast (S-03 part 3 §7.4's rule). */
export function parseLanguageView(v: unknown): LanguageView | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (!(r.value === null || isLang(r.value))) return null;
  if (!(r.valueLabel === null || typeof r.valueLabel === "string") || typeof r.phrase !== "string") return null;
  let hint: LanguageView["hint"] = null;
  if (r.hint !== null) {
    if (typeof r.hint !== "object" || r.hint === null) return null;
    const h = r.hint as Record<string, unknown>;
    if (!isLang(h.language) || typeof h.text !== "string") return null;
    hint = { language: h.language, text: h.text };
  }
  return { value: r.value as ContactLanguage | null, valueLabel: r.valueLabel as string | null, phrase: r.phrase, hint };
}
```

Then, the LAST code step, `apps/web/src/lib/messages.ts` directly after `"contact.source.machine.form.es"` (`:726`):

```ts
  // S-09 (a language on every customer): the record's and the drawer's Language line. Spec §15.2's
  // words verbatim, plus `.choose` and `.notSetUnknown` (plan deviation 10). "their", never "her":
  // BIS stores no gender. {value} is the endonym; {language} the in-sentence name (language.name.*).
  "contact.language.label": "Language",
  "contact.language.label.es": "Idioma",
  "contact.language.notSet": "Not set. Messages go out in {language}.",
  "contact.language.notSet.es": "Sin definir. Los mensajes salen en {language}.",
  "contact.language.notSetAccount": "Not set. Messages go out in {language}, the account's language.",
  "contact.language.notSetAccount.es": "Sin definir. Los mensajes salen en {language}, el idioma de la cuenta.",
  "contact.language.notSetUnknown": "Not set.",
  "contact.language.notSetUnknown.es": "Sin definir.",
  "contact.language.choose": "Choose",
  "contact.language.choose.es": "Elegir",
  "contact.language.from.booking": "from their booking ({date})",
  "contact.language.from.booking.es": "por su cita ({date})",
  "contact.language.from.form": "from a form they filled in ({date})",
  "contact.language.from.form.es": "por un formulario que llenó ({date})",
  "contact.language.from.call": "from a call ({date})",
  "contact.language.from.call.es": "por una llamada ({date})",
  "contact.language.from.staff": "set by your team ({date})",
  "contact.language.from.staff.es": "lo eligió su equipo ({date})",
  "contact.language.hint.call": "Spoke {language} on the last call. Switch to {language}?",
  "contact.language.hint.call.es": "En la última llamada habló {language}. ¿Cambiar a {language}?",
  "contact.language.hint.booking": "Booked in {language} last time. Switch to {language}?",
  "contact.language.hint.booking.es": "La última vez hizo su cita en {language}. ¿Cambiar a {language}?",
  "contact.language.hint.form": "Filled in a form in {language} last time. Switch to {language}?",
  "contact.language.hint.form.es": "La última vez llenó un formulario en {language}. ¿Cambiar a {language}?",
  "contact.language.switch": "Switch",
  "contact.language.switch.es": "Cambiar",
  "contact.language.keep": "Keep",
  "contact.language.keep.es": "Dejarlo así",
  "contact.language.setToast": "Language set to {value}.",
  "contact.language.setToast.es": "Idioma cambiado a {value}.",
  "contact.language.keptToast": "We'll ask again if a newer call, booking or form says otherwise.",
  "contact.language.keptToast.es": "Le volveremos a preguntar si otra llamada, cita o formulario dice otra cosa.",
  "contact.language.saveFailed": "Couldn't change the language. Try again.",
  "contact.language.saveFailed.es": "No se pudo cambiar el idioma. Intente de nuevo.",
  "language.name.en": "English",
  "language.name.en.es": "inglés",
  "language.name.es": "Spanish",
  "language.name.es.es": "español",
```

- [ ] **Step 4: Run green.** `pnpm --filter web exec vitest run src/lib/contacts/language.test.ts src/lib/messages.test.ts src/lib/i18n/ratchet.test.ts` → green (the ratchet admits the new keys because each has its twin); `pnpm --filter web typecheck` → clean. Paste the summary lines.
- [ ] **Step 5: Probes** (each red by name, revert): `pageLanguageSignal` returning `locale` always → "English on an English account … is nothing" FAILS; drop each of the four `languageHint` guard lines in turn → its "line N" case FAILS (four probes, four names); use `FROM_KEY.booking` for every source → "each source's phrase" FAILS; drop the `undefined` branch → "nothing claimed when it could not be read" FAILS; `parseLanguageView` returning `v as LanguageView` → "accepts what languageView builds and refuses anything else" FAILS.
- [ ] **Step 6: Commit.**

```bash
cd <WT> && git add -- apps/web/src/lib/contacts/language.ts apps/web/src/lib/contacts/language.test.ts && git commit -m "feat(contacts): the language sign rule, the hint computed on read, and the Details line's words in both languages (S-09 §7.4, §8.2)" -- apps/web/src/lib/contacts/language.ts apps/web/src/lib/contacts/language.test.ts apps/web/src/lib/messages.ts
```

---

## Task 7: The web booking signal (bis-booking)

**Review:** sonnet. **Depends on:** Tasks 5 and 6. **Runs beside:** Tasks 9 and 10.

**Files**
- Modify: `apps/web/src/app/b/[publicId]/actions.ts:3-8` (import), after `recordBookingGrant` (`:368`)
- Modify: `apps/web/src/app/b/[publicId]/actions.test.ts` (the `@bis/db` factory `:97-130`, `beforeEach` `:267-292`, one new `describe` at the end)

**Interfaces**
- Consumes: `recordLanguageSignal` (Task 5); `pageLanguageSignal` (Task 6); the action's own `locale` (`:181`, normalised), `account` (`:257`, `language` at `:121-125`), `contactId`, `ACTOR_ID`/`ACTOR_TYPE` (`:48-49`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test.** In the factory add `recordLanguageSignal: (...a: unknown[]) => recordLanguageSignalMock(...a),` and at the top `const recordLanguageSignalMock = vi.fn();`; in `beforeEach` add `recordLanguageSignalMock.mockReset().mockResolvedValue(true);`. Append:

```ts
describe("submitBookingAction — the booker's language becomes the contact's (S-09 §7.1, C6)", () => {
  it("a Spanish booking on an English account signals booking/es with the public/system pair, after the booking exists (mutation: signal before createBooking -> FAILS)", async () => {
    const result = await submitBookingAction(PUBLIC_ID, validFormData({ locale: "es" }));
    expect(result.ok).toBe(true);
    expect(recordLanguageSignalMock).toHaveBeenCalledTimes(1);
    const [, accountId, contactId, signal, actorId, actorType] = recordLanguageSignalMock.mock.calls[0]!;
    expect([accountId, contactId, signal.language, signal.source, actorId, actorType]).toEqual([ACCOUNT_ID, "contact_1", "es", "booking", "public", "system"]);
    expect(signal.at).toBeInstanceOf(Date);
    expect(recordLanguageSignalMock.mock.invocationCallOrder[0]!).toBeGreaterThan(createBookingMock.mock.invocationCallOrder[0]!);
  });

  it("an English booking on an English account says nothing: it is what they would get anyway (mutation: always signal -> FAILS)", async () => {
    await submitBookingAction(PUBLIC_ID, validFormData({ locale: "en" }));
    expect(recordLanguageSignalMock).not.toHaveBeenCalled();
  });

  it("an English booking on a Spanish account IS a sign (mutation: compare with 'en' instead of the account's language -> FAILS)", async () => {
    accountRow.language = "es";
    await submitBookingAction(PUBLIC_ID, validFormData({ locale: "en" }));
    expect(recordLanguageSignalMock.mock.calls[0]![3]).toMatchObject({ language: "en", source: "booking" });
  });

  it("a taken slot signals nothing", async () => {
    createBookingMock.mockRejectedValue(new SlotTakenError());
    await submitBookingAction(PUBLIC_ID, validFormData({ locale: "es" }));
    expect(recordLanguageSignalMock).not.toHaveBeenCalled();
  });

  it("a failed signal never costs the booking (mutation: drop the try -> FAILS)", async () => {
    recordLanguageSignalMock.mockRejectedValue(new Error("db down"));
    const result = await submitBookingAction(PUBLIC_ID, validFormData({ locale: "es" }));
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/b/[publicId]/actions.test.ts"` → the new describe FAILS: `expected "spy" to be called 1 times, but got 0 times`. Paste the line.
- [ ] **Step 3: Implement.** Add `recordLanguageSignal` to the `@bis/db` import (`:4-8`) and `import { pageLanguageSignal } from "@/lib/contacts/language";`. Directly after `await recordBookingGrant(…)` (`:368`):

```ts
    // S-09 §7.1 / C6: the page's language is the customer's sign only when it is not what they would
    // get anyway. Best-effort, its own try: the booking is real and a sign must never cost it. After
    // createBooking, so a booker who lost the slot race signals nothing.
    const pageSign = pageLanguageSignal(locale, account?.language ?? null);
    if (pageSign) {
      try {
        await recordLanguageSignal(db, calendar.account_id, contactId,
          { language: pageSign, source: "booking", at: new Date() }, ACTOR_ID, ACTOR_TYPE);
      } catch (e) {
        console.error(`booking ${publicId}: language signal failed for contact ${contactId}: ${String(e)}`);
      }
    }
```

- [ ] **Step 4: Run green.** The same file green; `pnpm --filter web typecheck` clean. Paste the summary line.
- [ ] **Step 5: Probes** (red by name, revert): move the block above `createBooking` → "after the booking exists" FAILS; replace `pageLanguageSignal(…)` with `locale` → "an English booking on an English account says nothing" FAILS; replace `account?.language ?? null` with `null` → "an English booking on a Spanish account IS a sign" FAILS; remove the `try`/`catch` → "a failed signal never costs the booking" FAILS. Sibling copy: the same rule lives in Task 9's form signal; that task probes its own.
- [ ] **Step 6: Commit.**

```bash
cd <WT> && git commit -m "feat(booking): a booking made in a language other than the account's records it as the customer's (S-09 §7.1)" -- "apps/web/src/app/b/[publicId]/actions.ts" "apps/web/src/app/b/[publicId]/actions.test.ts"
```

---

## Task 8: The phone-booking and call-finish signals (bis-voice)

**Review:** sonnet. **Depends on:** Tasks 2 and 5. **Runs beside:** Task 6 (and Task 4, disjoint files).

**Files**
- Modify: `apps/web/src/lib/voice/tools/registry.ts` (import; inside `case "book_appointment"`, after the `createBooking` try, `:481-491`)
- Modify: `apps/web/src/lib/voice/tools/registry.test.ts` (`dbMocks` `:14-33`; one `describe` after `book_appointment`'s, `:274`)
- Modify: `apps/web/src/lib/voice/finish-call.ts` (import `:16`; after the lead-treatment block, `:415-430`)
- Modify: `apps/web/src/lib/voice/finish-call.test.ts` (`dbMocks` `:3-24`; `beforeEach` `:202`; one new `describe`)

**Interfaces**
- Consumes: `clearCallerLanguage`, `clearCallerLanguageNow` (Task 2); `recordLanguageSignal` (Task 5); registry's `ACTOR_ID = "voice"`, `ACTOR_TYPE = "ai"` (`:147-148`) and `now` (`:251`); finish-call's `meaningful`, `contactId`, `meta.endedAt`, `ACTOR_ID`/`ACTOR_TYPE` (`:101-102`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing tests.** In `registry.test.ts` add `recordLanguageSignal: vi.fn(),` to `dbMocks` and append:

```ts
describe("book_appointment — the caller's language becomes the contact's (S-09 C7)", () => {
  const slot = { startsAt: new Date("2027-06-01T14:00:00Z"), endsAt: new Date("2027-06-01T15:00:00Z") };
  beforeEach(() => {
    computeAllSlotsMock.mockResolvedValue([slot]);
    dbMocks.createContact.mockResolvedValue({ id: "ct1", existing: false });
    dbMocks.createBooking.mockResolvedValue({ id: "bk1", cancelToken: "tok123" });
    dbMocks.recordLanguageSignal.mockResolvedValue(true);
  });
  const spanish = () => ({ ...emptyCallState(), transcript: [{ role: "caller" as const, text: "hola, necesito una cita para mañana", at: "t" }] });

  it("a caller who clearly spoke Spanish signals booking/es as the AI, at the tool's clock, after the booking (mutation: signal before createBooking -> FAILS)", async () => {
    await runTool(spanish(), ctx, "book_appointment", { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true });
    expect(dbMocks.recordLanguageSignal).toHaveBeenCalledWith(ctx.db, "a1", "ct1",
      { language: "es", source: "booking", at: new Date("2027-06-01T12:00:00Z") }, "voice", "ai");
    expect(dbMocks.recordLanguageSignal.mock.invocationCallOrder[0]!).toBeGreaterThan(dbMocks.createBooking.mock.invocationCallOrder[0]!);
  });

  it("a caller who said too little signals nothing (mutation: fall back to the profile's language -> FAILS)", async () => {
    await runTool(emptyCallState(), ctx, "book_appointment", { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true });
    expect(dbMocks.recordLanguageSignal).not.toHaveBeenCalled();
  });

  it("a failed signal never costs the booking (mutation: drop the try -> FAILS)", async () => {
    dbMocks.recordLanguageSignal.mockRejectedValue(new Error("db down"));
    const { result } = await runTool(spanish(), ctx, "book_appointment", { startsAt: "2027-06-01T14:00:00.000Z", name: "Ana Ruiz", emailDeclined: true });
    expect(result).toMatchObject({ ok: true });
  });
});
```

In `finish-call.test.ts` add `recordLanguageSignal: vi.fn(),` to `dbMocks`, `dbMocks.recordLanguageSignal.mockResolvedValue(true);` in `beforeEach`, and append:

```ts
describe("finishCall — the caller's words become the contact's language (S-09 C5)", () => {
  const lead = { fields: { fullName: "Ana Ruiz", need: "roof quote", callbackNumber: "956 292 1696" } };
  const spoke = (text: string) => withLead(withTranscript(emptyCallState(), { role: "caller", text, at: "t" }), lead);

  it("a meaningful call in clear Spanish signals call/es as the AI at the call's end, read strictly even on an English-only line (mutation: use detectSpokenLanguage -> FAILS)", async () => {
    await finishCall(spoke("hola, necesito una cita para mañana por favor"), { ...ctx, profileLanguage: "en" }, meta);
    expect(dbMocks.recordLanguageSignal).toHaveBeenCalledWith({}, "a1", "ct1",
      { language: "es", source: "call", at: meta.endedAt }, "voice", "ai");
  });

  it("an unclear call signals nothing, even though calls.language still reads English (mutation: signal spokenLanguage -> FAILS)", async () => {
    await finishCall(spoke("hi"), ctx, meta);
    expect(dbMocks.recordLanguageSignal).not.toHaveBeenCalled();
  });

  it("a call that is not meaningful signals nothing (mutation: drop the meaningful test -> FAILS)", async () => {
    await finishCall(withTranscript(emptyCallState(), { role: "caller", text: "hola, necesito una cita para mañana", at: "t" }), ctx, meta);
    expect(dbMocks.recordLanguageSignal).not.toHaveBeenCalled();
  });

  it("a failed signal never costs the staff alert or the row (mutation: drop the try -> FAILS)", async () => {
    dbMocks.recordLanguageSignal.mockRejectedValue(new Error("db down"));
    const r = await finishCall(spoke("hola, necesito una cita para mañana por favor"), ctx, meta);
    expect(r.notified).toBe(true);
    expect(dbMocks.finishCallRow).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/voice/tools/registry.test.ts src/lib/voice/finish-call.test.ts` → the two new describes FAIL (`expected "spy" to be called with arguments …`, `Number of calls: 0`). Paste one line from each file.
- [ ] **Step 3: Implement.** In `registry.ts`, add `recordLanguageSignal` to the `@bis/db` import and `clearCallerLanguageNow` to the `./language` import (or `../language`, as the file imports `detectCallerLanguage` today). After the `createBooking` try/catch (`:481-491`), before `let emailFailed`:

```ts
      // S-09 C7: a phone booking is a sign at the booking, read strictly from the call so far (never the
      // profile, never calls.language). Best-effort: the booking is real.
      const heard = clearCallerLanguageNow(state);
      if (heard) {
        try {
          await recordLanguageSignal(ctx.db, ctx.accountId, contactId,
            { language: heard, source: "booking", at: now }, ACTOR_ID, ACTOR_TYPE);
        } catch (e) {
          console.error(`voice booking ${bookingId}: language signal failed: ${String(e)}`);
        }
      }
```

In `finish-call.ts`, add `recordLanguageSignal` to the `@bis/db` import and `clearCallerLanguage` to `import { detectSpokenLanguage } from "./language";` (`:16`). Directly after the lead-treatment `if (meaningful) { try { … } catch … }` block (`:415-430`), before the staff alert:

```ts
  // S-09 C5: what the caller's own words say, read strictly; `spokenLanguage` above stays the Calls
  // badge's and the text-back's (a default, not evidence). Its own try: a sign never costs the call.
  if (meaningful && contactId) {
    const heard = clearCallerLanguage(state.transcript);
    if (heard) {
      try {
        await recordLanguageSignal(ctx.db, ctx.accountId, contactId,
          { language: heard, source: "call", at: meta.endedAt }, ACTOR_ID, ACTOR_TYPE);
      } catch (e) {
        console.error(`finishCall ${meta.callRowId ?? "(no row)"}: language signal failed: ${String(e)}`);
      }
    }
  }
```

- [ ] **Step 4: Run green.** Both files green; `pnpm --filter web typecheck` clean. Run every other test that mocks either module (the factory check): `pnpm --filter web exec vitest run src/app/api/voice/incoming/lifecycle.test.ts src/app/api/voice/incoming/route.test.ts src/app/api/voice/web/session/route.test.ts src/app/api/voice/texml/handoff-result/route.test.ts` → green (each is an `importOriginal` factory or does not reach these lines; if one logs `language signal failed` because the real function met a fake client, add `recordLanguageSignal: vi.fn()` to its mock and say so). Paste the summary lines.
- [ ] **Step 5: Probes** (red by name, revert): `const heard = detectSpokenLanguage(state.transcript, ctx.profileLanguage)` in finish-call → the first two finish-call cases FAIL; drop `meaningful &&` → "a call that is not meaningful signals nothing" FAILS; drop the finish-call try → "a failed signal never costs the staff alert" FAILS; move the registry block above `createBooking` (with `contactId`) → "after the booking" FAILS; `clearCallerLanguageNow(state) ?? spokenLocale(state, ctx)` → "a caller who said too little signals nothing" FAILS.
- [ ] **Step 6: Commit.**

```bash
cd <WT> && git commit -m "feat(voice): a phone booking and a finished call record the caller's clearly spoken language on the contact (S-09 C5, C7)" -- apps/web/src/lib/voice/tools/registry.ts apps/web/src/lib/voice/tools/registry.test.ts apps/web/src/lib/voice/finish-call.ts apps/web/src/lib/voice/finish-call.test.ts
```

---

## Task 9: The form signal (bis-crm)

**Review:** sonnet. **Depends on:** Tasks 5 and 6. **Runs beside:** Tasks 7 and 10.

**Files**
- Modify: `apps/web/src/lib/forms/enrich.ts:2-6` (import), after `contactId = created.id;` (`:107`)
- Modify: `apps/web/src/app/f/[publicId]/actions.test.ts` (`accountRow` `:51-60`, factory `:62-117`, `beforeEach` `:156-175`, one new `describe`)
- Modify: `apps/web/src/lib/concierge/lead.test.ts` and `apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts` (their `@bis/db` factories only: add `recordLanguageSignal`)

**Interfaces**
- Consumes: `recordLanguageSignal` (Task 5); `pageLanguageSignal` (Task 6); `enrich`'s `locale` parameter (`:43`).
- Produces: nothing new.

- [ ] **Step 1: Write the failing test.** In `f/[publicId]/actions.test.ts`: add `language: null as "en" | "es" | null,` to `accountRow`; `const recordLanguageSignalMock = vi.fn();` at the top; `recordLanguageSignal: (...a: unknown[]) => recordLanguageSignalMock(...a),` in the factory; in `beforeEach`, `recordLanguageSignalMock.mockReset().mockResolvedValue(true); accountRow.language = null;`. Append:

```ts
describe("submitFormAction — the form's language becomes the contact's (S-09 §7.1, C6)", () => {
  const withName = () => formRow({ fields: [{ key: "first_name", kind: "core.first_name", label: "Name", required: true }] });
  const token = () => signRenderToken(Date.now() - MIN_FILL_MS - 1000, PUBLIC_ID);
  const submit = (locale: string) => submitFormAction(PUBLIC_ID, IDLE, fd({ [RENDER_TOKEN_FIELD]: token(), locale, first_name: "María" }));

  it("a Spanish submission on an English account signals form/es with the form/system pair (mutation: never signal -> FAILS)", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withName());
    expect((await submit("es")).status).toBe("success");
    expect(recordLanguageSignalMock).toHaveBeenCalledTimes(1);
    const [, accountId, contactId, signal, actorId, actorType] = recordLanguageSignalMock.mock.calls[0]!;
    expect([accountId, contactId, signal.language, signal.source, actorId, actorType]).toEqual(["acct_1", "contact_1", "es", "form", "form", "system"]);
  });

  it("an English submission on an English account says nothing (mutation: always signal -> FAILS)", async () => {
    getPublishedFormByPublicIdMock.mockResolvedValue(withName());
    await submit("en");
    expect(recordLanguageSignalMock).not.toHaveBeenCalled();
  });

  it("an English submission on a Spanish account is a sign (mutation: ignore the account's language -> FAILS)", async () => {
    accountRow.language = "es";
    getPublishedFormByPublicIdMock.mockResolvedValue(withName());
    await submit("en");
    expect(recordLanguageSignalMock.mock.calls[0]![3]).toMatchObject({ language: "en", source: "form" });
  });

  it("a failed signal costs neither the lead's thread nor its success (mutation: put it in the contact try before the thread -> FAILS)", async () => {
    recordLanguageSignalMock.mockRejectedValue(new Error("db down"));
    getPublishedFormByPublicIdMock.mockResolvedValue(withName());
    expect((await submit("es")).status).toBe("success");
    expect(createMessageMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/f/[publicId]/actions.test.ts"` → the new describe FAILS (`expected "spy" to be called 1 times, but got 0 times`). Paste the line.
- [ ] **Step 3: Implement.** In `enrich.ts`, add `recordLanguageSignal` to the `@bis/db` import (`:2-6`) and `import { pageLanguageSignal } from "@/lib/contacts/language";`. Directly after `contactId = created.id;` (`:107`):

```ts
    // S-09 §7.1 / C6: the form's language is the customer's sign only when it differs from the
    // account's. Its own try INSIDE the contact group: a failed sign must never skip the thread below.
    // (A concierge lead arrives here too, with the chat's language: it signals as `form`, plan deviation 12.)
    try {
      const { data: acct, error: acctErr } = await db.from("accounts").select("language").eq("id", accountId).maybeSingle();
      if (acctErr) throw new Error(acctErr.message);
      const sign = pageLanguageSignal(locale, (acct as { language: "en" | "es" | null } | null)?.language ?? null);
      if (sign) {
        await recordLanguageSignal(db, accountId, contactId, { language: sign, source: "form", at: new Date() }, "form", "system");
      }
    } catch (e) {
      console.error(`form ${form.id} submission ${submissionId}: language signal failed for contact ${contactId}: ${e instanceof Error ? e.message : String(e)}`);
    }
```

The factory check: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "forms/enrich\|concierge/lead"` → add `recordLanguageSignal: vi.fn(async () => true),` to each bare factory it lists other than `f/[publicId]/actions.test.ts` (expected: `lib/concierge/lead.test.ts`, `app/api/concierge/[publicId]/turn/route.test.ts`; `b/[publicId]/actions.test.ts` mocks `@/lib/forms/enrich` itself and needs nothing).
- [ ] **Step 4: Run green.** `pnpm --filter web exec vitest run "src/app/f/[publicId]/actions.test.ts" src/lib/concierge/lead.test.ts "src/app/api/concierge/[publicId]/turn/route.test.ts"` → green; typecheck clean. Paste the summary lines.
- [ ] **Step 5: Probes** (red by name, revert): replace `pageLanguageSignal(…)` with `locale` → "an English submission on an English account says nothing" FAILS; replace the account read with `null` → "an English submission on a Spanish account is a sign" FAILS; remove the inner try (letting the throw reach the group's catch) → "a failed signal costs neither the lead's thread" FAILS. Sibling copy: Task 7 probes the booking's.
- [ ] **Step 6: Commit.**

```bash
cd <WT> && git commit -m "feat(forms): a form filled in a language other than the account's records it as the customer's (S-09 §7.1)" -- apps/web/src/lib/forms/enrich.ts "apps/web/src/app/f/[publicId]/actions.test.ts" apps/web/src/lib/concierge/lead.test.ts "apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts"
```

---

## Task 10: The staff actions (bis-crm)

**Review:** opus. **Depends on:** Tasks 5 and 6. **Runs beside:** Tasks 7 and 9.

**Files**
- Modify: `…/contacts/actions.ts:6-9` (import), append three actions after `undoContactBusinessAction` (`:201-230`)
- Modify: `…/contacts/actions.test.ts` (`dbMocks` `:20-34`, the import `:41-47`, one new `describe`)

**Interfaces**
- Consumes: `getContact`, `serviceDb`, `setContactLanguage`, `restoreContactLanguage`, `keepContactLanguageHint`, `isLanguageTriple`, `type ContactLanguage`, `type LanguageTriple` (Task 5); `requireAccountAccess` (`@/lib/auth`); `dbForRequest` (`@/lib/db`); `m["contact.language.saveFailed"]` (Task 6).
- Produces (Task 11 relies on these exact names):

```ts
export type LanguageActionResult = { ok: true; undo: LanguageTriple } | { ok: false; error: string };
export async function setContactLanguageAction(accountId: string, contactId: string, language: ContactLanguage): Promise<LanguageActionResult>;
export async function restoreContactLanguageAction(accountId: string, contactId: string, prior: LanguageTriple): Promise<{ ok: true } | { ok: false; error: string }>;
export async function keepContactLanguageHintAction(accountId: string, contactId: string): Promise<{ ok: true } | { ok: false; error: string }>;
```

- [ ] **Step 1: Write the failing test.** Add to `dbMocks`: `setContactLanguage: vi.fn(), restoreContactLanguage: vi.fn(), keepContactLanguageHint: vi.fn(), isLanguageTriple: vi.fn((_v: unknown) => true),` (the real check is pinned in Task 5; here only whether the action consults it). In `beforeEach`, after `vi.clearAllMocks()`, add `dbMocks.isLanguageTriple.mockImplementation(() => true);`. Add the three action names to the destructured import. Append:

```ts
describe("the language actions (S-09 §7.5, C2, C9)", () => {
  const BOOKED = { id: "c1", language: "es", language_source: "booking", language_set_at: "2026-10-03T15:00:00+00:00" };

  it("set: proves the contact on the CALLER's client, writes on the service client, and returns the prior triple (mutation: write before the proof -> FAILS)", async () => {
    dbForRequest.mockResolvedValue(REQUEST);
    dbMocks.getContact.mockResolvedValue(BOOKED);
    dbMocks.setContactLanguage.mockResolvedValue(true);
    expect(await setContactLanguageAction("a1", "c1", "en")).toEqual({
      ok: true, undo: { language: "es", source: "booking", setAt: "2026-10-03T15:00:00+00:00" },
    });
    expect(dbMocks.getContact).toHaveBeenCalledWith(REQUEST, "a1", "c1");
    expect(dbMocks.setContactLanguage).toHaveBeenCalledWith(SERVICE, "a1", "c1", "en", "user_1");
    expect(dbMocks.getContact.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.setContactLanguage.mock.invocationCallOrder[0]!);
  });

  it("a contact the caller cannot see (a Technician's other customer) writes nothing (mutation: skip the proof -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue(null);
    expect(await setContactLanguageAction("a1", "c9", "en")).toEqual({ ok: false, error: m["contact.language.saveFailed"] });
    expect(await restoreContactLanguageAction("a1", "c9", { language: null, source: null, setAt: null })).toMatchObject({ ok: false });
    expect(await keepContactLanguageHintAction("a1", "c9")).toMatchObject({ ok: false });
    expect(dbMocks.setContactLanguage).not.toHaveBeenCalled();
    expect(dbMocks.restoreContactLanguage).not.toHaveBeenCalled();
    expect(dbMocks.keepContactLanguageHint).not.toHaveBeenCalled();
  });

  it("set refuses a language outside the set before reading anything", async () => {
    expect(await setContactLanguageAction("a1", "c1", "fr" as never)).toMatchObject({ ok: false });
    expect(dbMocks.getContact).not.toHaveBeenCalled();
  });

  it("restore sends the prior triple back through the RESTORE writer, never as a staff choice (mutation: route Undo through setContactLanguage -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue({ ...BOOKED, language: "en", language_source: "staff" });
    dbMocks.restoreContactLanguage.mockResolvedValue(true);
    const prior = { language: "es" as const, source: "booking" as const, setAt: "2026-10-03T15:00:00+00:00" };
    expect(await restoreContactLanguageAction("a1", "c1", prior)).toEqual({ ok: true });
    expect(dbMocks.restoreContactLanguage).toHaveBeenCalledWith(SERVICE, "a1", "c1", prior, "user_1");
    expect(dbMocks.setContactLanguage).not.toHaveBeenCalled();
  });

  it("restore refuses a forged, incoherent prior before the proof (mutation: drop the isLanguageTriple check -> FAILS)", async () => {
    dbMocks.isLanguageTriple.mockImplementation(() => false);
    expect(await restoreContactLanguageAction("a1", "c1", { language: "es", source: null, setAt: null } as never)).toMatchObject({ ok: false });
    expect(dbMocks.getContact).not.toHaveBeenCalled();
  });

  it("keep stamps only the hint (mutation: call setContactLanguage -> FAILS)", async () => {
    dbMocks.getContact.mockResolvedValue(BOOKED);
    dbMocks.keepContactLanguageHint.mockResolvedValue(true);
    expect(await keepContactLanguageHintAction("a1", "c1")).toEqual({ ok: true });
    expect(dbMocks.keepContactLanguageHint).toHaveBeenCalledWith(SERVICE, "a1", "c1", "user_1");
    expect(dbMocks.setContactLanguage).not.toHaveBeenCalled();
  });

  it("a thrown write is the plain failure, never a thrown action", async () => {
    dbMocks.getContact.mockResolvedValue(BOOKED);
    dbMocks.setContactLanguage.mockRejectedValue(new Error("db down"));
    expect(await setContactLanguageAction("a1", "c1", "en")).toEqual({ ok: false, error: m["contact.language.saveFailed"] });
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts"` → FAIL: `setContactLanguageAction is not a function`. Paste the line.
- [ ] **Step 3: Implement.** Add to the `@bis/db` import (`:6-9`): `setContactLanguage, restoreContactLanguage, keepContactLanguageHint, isLanguageTriple, type ContactLanguage, type LanguageTriple`. Append after `undoContactBusinessAction`:

```ts
/**
 * S-09 §7.5: a customer's language, chosen by staff. The contact is proved on the CALLER's own client
 * first (getContact under RLS: a Technician reaches only their own customers, 0068), then written on
 * the service client: the client role holds no UPDATE on the language columns (0076, C2). Returns the
 * prior triple, read in the same proof, for the Undo (C9).
 */
export type LanguageActionResult = { ok: true; undo: LanguageTriple } | { ok: false; error: string };

const isContactLanguage = (v: unknown): v is ContactLanguage => v === "en" || v === "es";
const languageFailed = () => ({ ok: false as const, error: m["contact.language.saveFailed"] });

export async function setContactLanguageAction(
  accountId: string, contactId: string, language: ContactLanguage,
): Promise<LanguageActionResult> {
  const { userId } = await requireAccountAccess(accountId);
  if (!isContactLanguage(language)) return languageFailed();
  try {
    const before = await getContact(await dbForRequest(), accountId, contactId);
    if (!before) return languageFailed();
    const undo: LanguageTriple = {
      language: (before.language ?? null) as ContactLanguage | null,
      source: (before.language_source ?? null) as LanguageTriple["source"],
      setAt: (before.language_set_at ?? null) as string | null,
    };
    if (!(await setContactLanguage(serviceDb(), accountId, contactId, language, userId))) return languageFailed();
    revalidatePath(`${contactsPath(accountId)}/${contactId}`);
    return { ok: true, undo };
  } catch (e) {
    console.error(`setContactLanguageAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return languageFailed();
  }
}

/** Undo: the prior triple back exactly, through the same proof. A forged source is the caller's own record. */
export async function restoreContactLanguageAction(
  accountId: string, contactId: string, prior: LanguageTriple,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  if (!isLanguageTriple(prior)) return languageFailed();
  try {
    if (!(await getContact(await dbForRequest(), accountId, contactId))) return languageFailed();
    if (!(await restoreContactLanguage(serviceDb(), accountId, contactId, prior, userId))) return languageFailed();
    revalidatePath(`${contactsPath(accountId)}/${contactId}`);
    return { ok: true };
  } catch (e) {
    console.error(`restoreContactLanguageAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return languageFailed();
  }
}

/** Keep: the hint stays away until a newer sign (§7.4). */
export async function keepContactLanguageHintAction(
  accountId: string, contactId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await requireAccountAccess(accountId);
  try {
    if (!(await getContact(await dbForRequest(), accountId, contactId))) return languageFailed();
    if (!(await keepContactLanguageHint(serviceDb(), accountId, contactId, userId))) return languageFailed();
    revalidatePath(`${contactsPath(accountId)}/${contactId}`);
    return { ok: true };
  } catch (e) {
    console.error(`keepContactLanguageHintAction: account ${accountId} contact ${contactId}: ${loggableError(e)}`);
    return languageFailed();
  }
}
```

(`contactsPath` is this file's existing helper, used at `:197-198`.)
- [ ] **Step 4: Run green.** The file green; `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"` green (`contacts/actions.ts` is already `proven-target`, `:82`, and its comment now covers these three: extend the comment above that entry with "and the language actions (S-09), after getContact on the request client"); typecheck clean. Paste the summary lines.
- [ ] **Step 5: Probes** (red by name, revert): move `setContactLanguage(…)` above the `getContact` line → "set: proves the contact on the CALLER's client" FAILS; delete `if (!before) return languageFailed();` → "a contact the caller cannot see … writes nothing" FAILS; in restore call `setContactLanguage(serviceDb(), accountId, contactId, prior.language!, userId)` → "restore sends the prior triple back through the RESTORE writer" FAILS; delete the `isLanguageTriple` line → "restore refuses a forged, incoherent prior" FAILS.
- [ ] **Step 6: Commit.**

```bash
cd <WT> && git commit -m "feat(contacts): set, undo and keep a customer's language, proved on the caller's client and written on the service client (S-09 §7.5)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/actions.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"
```

---

## Task 11: `LanguageField` on the record page and in the drawer (bis-crm)

**Review:** opus. **Depends on:** Tasks 6 and 10. **Runs beside:** Task 14.

**Files**
- Create: `…/contacts/language-field-handlers.ts`, `language-field-handlers.test.ts`
- Create: `…/contacts/language-field.tsx`, `language-field.test.ts`
- Modify: `…/contacts/[contactId]/contact-fields-panel.tsx:42-62` (prop), after the FIELDS map (`:89`)
- Modify: `…/contacts/[contactId]/contact-fields-panel.bodies.test.ts` (one case)
- Modify: `…/contacts/[contactId]/page.tsx:234` (pass `language`)
- Modify: `…/summary/route.ts:135-144` (`who.language`), `route.test.ts` (one case)
- Modify: `apps/web/src/lib/contacts/drawer-summary.ts:20-32`, `:174-189` (type and parser), `drawer-summary.test.ts` (one describe)
- Modify: `…/contacts/contact-drawer.tsx` (after the FIELDS map, `:333`), `contact-drawer.wiring.test.ts` (`./actions` mock `:59`, `GOOD.who` `:83-85`, one case)

**Interfaces**
- Consumes: `LanguageView`, `languageView`, `parseLanguageView`, `LANGUAGE_ENDONYM`, `ContactLanguageFacts` (Task 6); `setContactLanguageAction`, `restoreContactLanguageAction`, `keepContactLanguageHintAction`, `LanguageActionResult` (Task 10); `Select*` (`components/ui/select.tsx`); `Button` (`components/ui/button.tsx`); `toast` (`sonner`); `useLocale` (`components/locale-provider.tsx`); `RecordCardSkeleton` (`components/record/record-card.tsx`).
- Produces: `DrawerSummary["who"]["language"]: LanguageView`; `ParsedWho` ready gains `language: LanguageView | undefined`; `ContactDetailsBody` gains `language?: LanguageView`; `LanguageField({ accountId, contactId, view, onChanged })`; the e2e hooks `data-language-row`, `data-language` (the value or `""`), `data-language-phrase`, `data-language-hint`.

- [ ] **Step 1: Write the failing handler test** `…/contacts/language-field-handlers.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { chooseLanguage, keepLanguage, type LanguageFieldDeps } from "./language-field-handlers";

const PRIOR = { language: "es" as const, source: "booking" as const, setAt: "2026-10-03T15:00:00+00:00" };
function deps(over: Partial<LanguageFieldDeps> = {}) {
  const toast = { success: vi.fn(), error: vi.fn() };
  const d: LanguageFieldDeps = {
    set: vi.fn(async () => ({ ok: true as const, undo: PRIOR })),
    restore: vi.fn(async () => ({ ok: true as const })),
    keep: vi.fn(async () => ({ ok: true as const })),
    toast, onChanged: vi.fn(), locale: "en", ...over,
  };
  return d;
}

describe("the Language line's handlers (S-09 §8.3, rule 6)", () => {
  it("a choice saves at once, refreshes, and toasts with an Undo that restores the PRIOR triple (mutation: Undo re-sets the new language -> FAILS)", async () => {
    const d = deps();
    await chooseLanguage(d, "en");
    expect(d.set).toHaveBeenCalledWith("en");
    expect(d.onChanged).toHaveBeenCalledTimes(1);
    const [text, opts] = (d.toast.success as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(text).toBe("Language set to English.");
    expect(opts.action.label).toBe("Undo");
    opts.action.onClick();
    await vi.waitFor(() => expect(d.restore).toHaveBeenCalledWith(PRIOR));
    await vi.waitFor(() => expect(d.onChanged).toHaveBeenCalledTimes(2));
  });

  it("the toast speaks the reader's language and names the endonym", async () => {
    const d = deps({ locale: "es" });
    await chooseLanguage(d, "es");
    expect((d.toast.success as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe("Idioma cambiado a Español.");
  });

  it("a refused save toasts its error and offers no Undo (mutation: toast success anyway -> FAILS)", async () => {
    const d = deps({ set: vi.fn(async () => ({ ok: false as const, error: "Couldn't change the language. Try again." })) });
    await chooseLanguage(d, "en");
    expect(d.toast.error).toHaveBeenCalledWith("Couldn't change the language. Try again.");
    expect(d.toast.success).not.toHaveBeenCalled();
    expect(d.onChanged).not.toHaveBeenCalled();
  });

  it("Keep toasts without an Undo: nothing about the customer changed (mutation: add an action -> FAILS)", async () => {
    const d = deps();
    await keepLanguage(d);
    expect(d.keep).toHaveBeenCalledTimes(1);
    expect(d.toast.success).toHaveBeenCalledWith("We'll ask again if a newer call, booking or form says otherwise.");
    expect(d.onChanged).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Write the failing component test** `…/contacts/language-field.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("./actions", () => ({ setContactLanguageAction: vi.fn(), restoreContactLanguageAction: vi.fn(), keepContactLanguageHintAction: vi.fn() }));
vi.mock("@/components/locale-provider", () => ({ useLocale: () => "en" }));
const { LanguageField } = await import("./language-field");

const SET = { value: "es" as const, valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null };
const render = (view: Parameters<typeof LanguageField>[0]["view"]) =>
  renderToStaticMarkup(createElement(LanguageField, { accountId: "a1", contactId: "c1", view, onChanged: () => {} }));

describe("LanguageField (S-09 §8.2)", () => {
  it("set: a labelled row in the 92px column, the endonym in its own lang, then the phrase (mutation: drop lang on the endonym -> FAILS)", () => {
    const html = render(SET);
    expect(html).toMatch(/data-language-row="" data-language="es"/);
    expect(html).toContain("grid-cols-[92px_minmax(0,1fr)]");
    expect(html).toMatch(/<dt[^>]*>Language<\/dt>/);
    expect(html).toMatch(/<span lang="es">Español<\/span>/);
    expect(html).toMatch(/data-language-phrase="">from their booking \(Oct 3\)</);
  });

  it("not set: the Choose placeholder and the whole Not set sentence; no hint", () => {
    const html = render({ value: null, valueLabel: null, phrase: "Not set. Messages go out in English.", hint: null });
    expect(html).toMatch(/data-language=""/);
    expect(html).toContain("Choose");
    expect(html).toContain("Not set. Messages go out in English.");
    expect(html).not.toContain("data-language-hint");
  });

  it("the hint: its sentence and two GHOST buttons, never a primary (rule 8; mutation: variant default -> FAILS)", () => {
    const html = render({ ...SET, hint: { language: "en", text: "Spoke English on the last call. Switch to English?" } });
    const hint = html.slice(html.indexOf("data-language-hint"));
    expect(hint).toContain("Spoke English on the last call. Switch to English?");
    expect(hint.match(/data-variant="ghost"/g)).toHaveLength(2);
    expect(hint).not.toContain('data-variant="default"');
    expect(hint).toMatch(/>Switch<\/button>/);
    expect(hint).toMatch(/>Keep<\/button>/);
  });

  it("every control is a real tap target with a visible focus ring (DESIGN.md DoD)", () => {
    const html = render({ ...SET, hint: { language: "en", text: "x" } });
    for (const el of html.match(/<button[^>]*>/g) ?? []) expect(el).toContain("min-h-11");
  });
});
```

- [ ] **Step 3: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field-handlers.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field.test.ts"` → both FAIL: `Failed to resolve import "./language-field-handlers"` / `"./language-field"`. Paste the lines.
- [ ] **Step 4: Implement the handlers** `…/contacts/language-field-handlers.ts`:

```ts
import type { ContactLanguage, LanguageTriple } from "@bis/db";
import type { Locale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { LANGUAGE_ENDONYM } from "@/lib/contacts/language";
import type { LanguageActionResult } from "./actions";

type Plain = { ok: true } | { ok: false; error: string };
export type LanguageFieldDeps = {
  set: (language: ContactLanguage) => Promise<LanguageActionResult>;
  restore: (prior: LanguageTriple) => Promise<Plain>;
  keep: () => Promise<Plain>;
  toast: {
    success: (message: string, opts?: { action?: { label: string; onClick: () => void } }) => void;
    error: (message: string) => void;
  };
  onChanged: () => void;
  locale: Locale;
};

/** Rule 6: the change runs at once, and its Undo puts back exactly what was there (C9). Switch is this too. */
export async function chooseLanguage(d: LanguageFieldDeps, language: ContactLanguage): Promise<void> {
  const r = await d.set(language);
  if (!r.ok) { d.toast.error(r.error); return; }
  d.onChanged();
  d.toast.success(t(m, "contact.language.setToast", d.locale, { value: LANGUAGE_ENDONYM[language] }), {
    action: { label: t(m, "common.undo", d.locale), onClick: () => { void undoLanguage(d, r.undo); } },
  });
}

export async function undoLanguage(d: LanguageFieldDeps, prior: LanguageTriple): Promise<void> {
  const r = await d.restore(prior);
  if (!r.ok) { d.toast.error(r.error); return; }
  d.onChanged();
}

/** Keep: no Undo, nothing about the customer changed (§8.3). */
export async function keepLanguage(d: LanguageFieldDeps): Promise<void> {
  const r = await d.keep();
  if (!r.ok) { d.toast.error(r.error); return; }
  d.onChanged();
  d.toast.success(t(m, "contact.language.keptToast", d.locale));
}
```

`LanguageActionResult` is a type exported from a `"use server"` file: a type-only import is erased, so no client reference is created.

- [ ] **Step 5: Implement the component** `…/contacts/language-field.tsx`:

```tsx
"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLocale } from "@/components/locale-provider";
import { t } from "@/lib/i18n/t";
import { m } from "@/lib/messages";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/language-options";
import type { LanguageView } from "@/lib/contacts/language";
import { setContactLanguageAction, restoreContactLanguageAction, keepContactLanguageHintAction } from "./actions";
import { chooseLanguage, keepLanguage, type LanguageFieldDeps } from "./language-field-handlers";

/**
 * S-09 §8: the customer's language, under Phone, on the record page and in the drawer. The value is a
 * Select (saves on change, Undo toast; no "Not set" option: a person can set a language, not un-know
 * one); the phrase says where it came from; the hint offers Switch / Keep as ghosts (rule 8: the one
 * primary is Call). Every string arrives built by `languageView` on the server, except the controls'.
 */
export function LanguageField({ accountId, contactId, view, onChanged }: {
  accountId: string; contactId: string; view: LanguageView; onChanged: () => void;
}) {
  const locale = useLocale();
  const label = t(m, "contact.language.label", locale);
  const deps: LanguageFieldDeps = {
    set: (language) => setContactLanguageAction(accountId, contactId, language),
    restore: (prior) => restoreContactLanguageAction(accountId, contactId, prior),
    keep: () => keepContactLanguageHintAction(accountId, contactId),
    toast, onChanged, locale,
  };
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] items-start gap-2" data-language-row="" data-language={view.value ?? ""}>
      <dt className="text-muted-foreground pt-2 text-xs">{label}</dt>
      <dd className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1">
          <Select value={view.value ?? undefined} onValueChange={(v) => { if (v === "en" || v === "es") void chooseLanguage(deps, v); }}>
            <SelectTrigger size="sm" aria-label={label}
              className="min-h-11 md:min-h-8 border-transparent bg-transparent px-2 hover:bg-[var(--surface-3)]">
              <SelectValue placeholder={t(m, "contact.language.choose", locale)} />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}><span lang={o.value}>{o.label}</span></SelectItem>
              ))}
            </SelectContent>
          </Select>
          {view.value ? <span aria-hidden className="text-muted-foreground text-xs">·</span> : null}
          <span data-language-phrase="" className="text-muted-foreground break-words text-xs">{view.phrase}</span>
        </div>
        {view.hint ? (
          <div data-language-hint="" className="mt-1 flex flex-wrap items-center gap-2 px-2">
            <p className="text-muted-foreground text-xs">{view.hint.text}</p>
            <Button type="button" variant="ghost" size="xs" className="min-h-11 md:min-h-8"
              onClick={() => void chooseLanguage(deps, view.hint!.language)}>{t(m, "contact.language.switch", locale)}</Button>
            <Button type="button" variant="ghost" size="xs" className="min-h-11 md:min-h-8"
              onClick={() => void keepLanguage(deps)}>{t(m, "contact.language.keep", locale)}</Button>
          </div>
        ) : null}
      </dd>
    </div>
  );
}
```

`SelectValue` renders the selected item's children (the `<span lang>` endonym) for a set value; the test's `<span lang="es">Español</span>` comes from that. **Assumption:** Radix's `SelectValue` renders the selected item's text in a static render; if `renderToStaticMarkup` shows the value without the item's markup, render the trigger's child explicitly as `{view.valueLabel ? <span lang={view.value!}>{view.valueLabel}</span> : <SelectValue placeholder={…} />}` and say so in the report (the test stays as written).

- [ ] **Step 6: Wire the record page.** In `contact-fields-panel.tsx` add to `DetailsProps` (`:42-62`):

```ts
  /** S-09: the Language line, built on the server by languageView (page.tsx); absent, no line. */
  language?: LanguageView;
```

with `import type { LanguageView } from "@/lib/contacts/language";` and `import { LanguageField } from "../language-field";`, destructure `language` in `ContactDetailsBody`, and directly after the FIELDS `.map(…)` block (`:89`, i.e. under Phone, before the Business row):

```tsx
        {language ? (
          <LanguageField key={`${contactId}:language`} accountId={accountId} contactId={contactId} view={language}
            onChanged={() => router.refresh()} />
        ) : null}
```

In `page.tsx` (`:234`), import `languageView` and `type ContactLanguageFacts` from `@/lib/contacts/language`, and pass:

```tsx
            language={languageView(contact as unknown as ContactLanguageFacts, {
              accountLanguage: account.error ? undefined : accountRow?.language ?? null, zone: zone.zone, tr,
            })}
```

Append to `contact-fields-panel.bodies.test.ts` (and add `vi.mock("../language-field", () => ({ LanguageField: (p: { view: { phrase: string } }) => createElement("div", { "data-language-stub": p.view.phrase }) }));` beside the other mocks):

```ts
  it("the Language line sits directly under Phone, before the Business name (S-09 §8.1; mutation: render it after Source -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(ContactDetailsBody, {
      accountId: "a1", contactId: "ct1", contact: CONTACT as never, fieldDefs: [], email: { status: "error" }, texts: { status: "error" },
      language: { value: null, valueLabel: null, phrase: "Not set. Messages go out in English.", hint: null },
    }));
    const lang = html.indexOf('data-language-stub="Not set. Messages go out in English."');
    expect(lang).toBeGreaterThan(html.lastIndexOf("Phone"));
    expect(lang).toBeLessThan(html.indexOf("Business"));
  });
```

(**Assumption:** the Business row's label reads "Business" in English, `contact.company`; read `messages.ts` for its English and use that word.)

- [ ] **Step 7: Wire the drawer's route and parser.** In `drawer-summary.ts` add `import { parseLanguageView, type LanguageView } from "@/lib/contacts/language";`; in `DrawerSummary["who"]` add `language: LanguageView;`; change `ParsedWho`'s ready arm to `Omit<DrawerSummary["who"], "assignedTo" | "language"> & { assignedTo: string | null | undefined; language: LanguageView | undefined }`; in `parseDrawerSummary`'s who block (`:174-189`):

```ts
  // S-09: absent (an older server) leaves the line out; present but malformed is the who section's error.
  const language = isRecord(w) && w.language !== undefined ? parseLanguageView(w.language) : undefined;
  if (isRecord(w) && language !== null && strOrNull(w.source) && …the existing conditions…) {
    …
    who = { status: "ready", …, language, … };
  }
```

Append to `drawer-summary.test.ts`:

```ts
describe("who.language (S-09 §8.1, plan deviation 11)", () => {
  const VIEW = { value: "es", valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null };
  const body = (language: unknown) => ({ ...JSON.parse(JSON.stringify(GOOD_BODY)), who: { ...GOOD_BODY.who, language } });
  it("a good view passes through", () => {
    const p = parseDrawerSummary(body(VIEW))!;
    expect(p.who).toMatchObject({ status: "ready", language: VIEW });
  });
  it("absent: the line is left out, the section still ready (mutation: treat absent as malformed -> FAILS)", () => {
    const b = body(VIEW);
    delete b.who.language;
    expect(parseDrawerSummary(b)!.who).toMatchObject({ status: "ready", language: undefined });
  });
  it("malformed: the who section's error, never the drawer's (mutation: drop the language !== null test -> FAILS)", () => {
    const p = parseDrawerSummary(body({ ...VIEW, value: "fr" }))!;
    expect(p).not.toBeNull();
    expect(p.who.status).toBe("error");
  });
});
```

(`GOOD_BODY` is the file's existing well-formed body fixture; read `drawer-summary.test.ts`'s top for its name and use it, adding `language: VIEW` to its `who` so every existing case keeps a ready who.)

In `route.ts` (`:135-144`), import `languageView` and `type ContactLanguageFacts`, and add inside `who`:

```ts
      language: languageView(contact as unknown as ContactLanguageFacts, {
        accountLanguage: account.error ? undefined : accountRow?.language ?? null, zone: zone.zone, tr,
      }),
```

Append to `route.test.ts` one case: a contact row whose mocked `getContact` carries `language: "es", language_source: "booking", language_set_at: "2026-10-03T15:00:00+00:00"` and null signal columns answers `who.language` `{ value: "es", valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null }` on an account in `America/Chicago` (mutation: omit `language` from `who` → FAILS). Add the seven columns, null, to the file's default contact fixture so every other case still builds a view.

- [ ] **Step 8: Wire the drawer.** In `contact-drawer.tsx` import `LanguageField` from `./language-field`, and directly after the FIELDS `.map(…)` (`:333`), inside the same `<dl>`:

```tsx
                          {who?.language ? (
                            <LanguageField key={`${row.id}:language`} accountId={accountId} contactId={row.id} view={who.language}
                              onChanged={() => setRetryNonce((n) => n + 1)} />
                          ) : load.status === "loading" ? (
                            <div data-drawer-language-skeleton data-testid="drawer-skeleton"><RecordCardSkeleton rows={1} /></div>
                          ) : null}
```

In `contact-drawer.wiring.test.ts`: extend the `./actions` mock (`:59`) with `setContactLanguageAction: vi.fn(), restoreContactLanguageAction: vi.fn(), keepContactLanguageHintAction: vi.fn()`; add `language: { value: "es", valueLabel: "Español", phrase: "from their booking (Oct 3)", hint: null }` to `GOOD.who` (`:83-85`); append:

```ts
  it("the Language line is the route's view, keyed by contact, and re-reads the route when it changes (S-09 §8.1; mutation: onChanged router.refresh -> FAILS)", async () => {
    const { LanguageField } = await import("./language-field");
    const el = treeOf(READY).find((e) => e.type === LanguageField);
    expect(el?.props.view).toEqual(GOOD.who.language);
    expect(el?.props.contactId).toBe("c1");
    const nonce = states.filter((s) => s.initial === 0);
    (el!.props.onChanged as () => void)();
    expect(nonce[0]!.set).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 9: Run green.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field-handlers.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/contact-fields-panel.bodies.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.test.ts" "src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts" src/lib/contacts/drawer-summary.test.ts` → green; `pnpm --filter web typecheck`; `pnpm --filter web exec eslint` over every touched file. Paste the summary lines.
- [ ] **Step 10: Probes** (red by name, revert): `opts.action.onClick` calling `d.set(language)` → "a choice saves at once … Undo that restores the PRIOR triple" FAILS; `variant="default"` on Switch → "two GHOST buttons" FAILS; drop `lang={o.value}` → "the endonym in its own lang" FAILS; move the record page's `LanguageField` after `SourceField` → "directly under Phone" FAILS; drawer `onChanged={() => router.refresh()}` (import `useRouter`) → the wiring case FAILS; the parser treating `undefined` as malformed → "absent: the line is left out" FAILS. Sibling copy: the record page and the drawer each have their placement test; run both probes.
- [ ] **Step 11: Commit.**

```bash
cd <WT> && git add -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field-handlers.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field-handlers.test.ts" && git commit -m "feat(contacts): the Language line under Phone on the record page and in the drawer, with inline edit, Undo, and a Switch or Keep hint (S-09 §8)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field-handlers.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/language-field-handlers.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/contact-drawer.wiring.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/contact-fields-panel.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/contact-fields-panel.bodies.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts" "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts" apps/web/src/lib/contacts/drawer-summary.ts apps/web/src/lib/contacts/drawer-summary.test.ts
```

---

## Task 12: Customer-typed text takes the contact's language (bis-crm)

**Review:** sonnet. **Depends on:** Tasks 1 and 11. **Scratch:** `<SCRATCH>/s09-t12-impl/`, local API on `55500`/`55501`/`55502` (for `record.test.ts` only).

**Files**
- Modify: `…/contacts/[contactId]/activity-timeline.tsx:25-53` (prop), `:141-145` (`Row`'s props), `:182-211` (the three customer-typed bodies)
- Modify: `…/contacts/[contactId]/page.tsx` (pass `customerLang` to `ActivityTimeline`)
- Modify: `…/contacts/[contactId]/activity-timeline.fixture.ts` (`legacyTimeline` returns `customerLang: ""`)
- Create: `…/contacts/[contactId]/activity-timeline.lang.test.ts`
- Modify: `apps/web/src/lib/record/recent-rows.ts` (+ `recent-rows.test.ts`)
- Modify: `…/summary/route.ts` (`recentRowsView(…, customerLang)`); `lib/contacts/drawer-summary.ts:118-121` (accept `"es"` excerpts) (+ test)
- Modify: `packages/db/src/record.ts:221-255` (`groupActivityMembers` reads `language`), `packages/db/src/test/record.test.ts` (one case)
- Modify: `groups/[groupId]/group-timeline.tsx` (prop `customerLangs`), `groups/[groupId]/page.tsx:200`
- Create: `groups/[groupId]/group-timeline.lang.test.ts`

**Interfaces**
- Consumes: `TimelineEntry` (`record.ts:283-288`: `message.direction`, `message.channel`, `submission.author_kind`, `booking.author_kind`); the contact row's `language` (Task 5).
- Produces: `ActivityTimelineProps.customerLang: "" | "en" | "es"`; `recentRowsView(rows: readonly TimelineRow[], customerLang?: "" | "en" | "es")`; `RecentRowView["excerpt"]["lang"]: "" | "en" | "es"`; `GroupActivity["people"][number].language: "en" | "es" | null`; `GroupTimelineProps.customerLangs: Record<string, "en" | "es">`.

The rule, one sentence each, in all three places (C10, plan deviations 5 and 6): a form's answers take the contact's language when the CUSTOMER wrote them (`author_kind === "customer"`); an inbound `email`, `sms` or `form` message's subject and body take it; a booking's note takes it when the customer booked (`author_kind === "customer"`); everything else, and every row of a contact with no language, stays `lang=""` (a call summary's prose stays `"en"`).

- [ ] **Step 1: Write the failing tests.** `…/contacts/[contactId]/activity-timeline.lang.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineEntry } from "@bis/db";

vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");

const AT = "2026-10-09T16:12:00Z";
const msg = (id: string, direction: "inbound" | "outbound", channel: string, body: string): TimelineEntry => ({
  kind: "message", id, at: AT, contactId: "c1", message: { id, channel, direction, status: "delivered", subject: null, body, error: null,
    created_at: AT, author_kind: direction === "inbound" ? "customer" : "person", author_id: null } } as unknown as TimelineEntry);
const ENTRIES: TimelineEntry[] = [
  msg("m1", "inbound", "sms", "Necesito cambiar mi cita"),
  msg("m2", "outbound", "sms", "Claro, le escribimos"),
  msg("m3", "inbound", "voice", "Caller wants a quote."),
  { kind: "submission", id: "s1", at: AT, contactId: "c1", submission: { id: "s1", created_at: AT, formName: "Contacto", author_kind: "customer",
    answers: [{ key: "msg", label: "Mensaje", value: "Tengo una gotera" }] } } as unknown as TimelineEntry,
  { kind: "booking", id: "b1", at: AT, contactId: "c1", booking: { id: "b1", contact_id: "c1", created_at: AT, starts_at: AT, status: "booked",
    note: "Traigan escalera", author_kind: "customer", author_id: null, rescheduled_from_id: null, moved_from_starts_at: null } } as unknown as TimelineEntry,
  { kind: "booking", id: "b2", at: AT, contactId: "c1", booking: { id: "b2", contact_id: "c1", created_at: AT, starts_at: AT, status: "booked",
    note: "Staff note", author_kind: "person", author_id: "u1", rescheduled_from_id: null, moved_from_starts_at: null } } as unknown as TimelineEntry,
];
const render = (customerLang: "" | "en" | "es") => {
  const tr = makeTr("en");
  const base = legacyTimeline({ accountId: "a1", contactId: "c1" });
  const rows = timelineRows(ENTRIES, { zone: "UTC", tr, author: { viewerId: null, names: {}, personaName: null, tr } });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, customerLang }));
};

describe("customer-typed text carries the contact's language (S-09 §9, C10)", () => {
  it("an inbound text, a customer's form answer and a customer's booking note take it (mutation: drop the prop -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(/<p lang="es"[^>]*>Necesito cambiar mi cita<\/p>/);
    expect(html).toMatch(/<dd lang="es"[^>]*>Tengo una gotera<\/dd>/);
    expect(html).toMatch(/<p lang="es"[^>]*>Traigan escalera<\/p>/);
  });
  it("what the business wrote stays lang=\"\": an outbound text, a staff booking note, the call's summary message (mutation: tag every message -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(/<p lang=""[^>]*>Claro, le escribimos<\/p>/);
    expect(html).toMatch(/<p lang=""[^>]*>Staff note<\/p>/);
    expect(html).toMatch(/<p lang=""[^>]*>Caller wants a quote\.<\/p>/);
  });
  it("a contact with no language keeps lang=\"\" (mutation: fall back to the account's language -> FAILS)", () => {
    expect(render("")).toMatch(/<p lang=""[^>]*>Necesito cambiar mi cita<\/p>/);
  });
});
```

Append to `recent-rows.test.ts`:

```ts
describe("recentRowsView's customer language (S-09 §9)", () => {
  it("an inbound text's excerpt takes the contact's language; an outbound one stays typed-unknown (mutation: ignore direction -> FAILS)", () => {
    const tr = makeTr("en");
    const rows = timelineRows([INBOUND_SMS, OUTBOUND_SMS], { zone: "UTC", tr, author: { viewerId: null, names: {}, personaName: null, tr } });
    expect(recentRowsView(rows, "es").map((r) => r.excerpt?.lang)).toEqual(["es", ""]);
    expect(recentRowsView(rows).map((r) => r.excerpt?.lang)).toEqual(["", ""]);
  });
});
```

(with `INBOUND_SMS`/`OUTBOUND_SMS` two message `TimelineEntry` literals shaped as `msg(…)` above; read the file's existing imports for `makeTr`/`timelineRows` and add them if absent). Append to `drawer-summary.test.ts`: a recent row whose excerpt is `{ text: "Hola", lang: "es", done: false }` parses (mutation: keep `lang === "" || lang === "en"` → the row is malformed → FAILS).

`groups/[groupId]/group-timeline.lang.test.ts`: render `GroupTimeline` with two message rows from members `c1` and `c2` and `customerLangs: { c1: "es" }`; expect `c1`'s inbound body `lang="es"` and `c2`'s `lang=""` (mutation: one language for the whole group → FAILS). Mock what `group-timeline.tsx` imports exactly as `activity-timeline.rows.test.ts:6-17` does for its own file (read `group-timeline.tsx`'s imports first; it imports `RecordCardRetry`, which needs `next/navigation`).

`record.test.ts`: one case in the `groupActivityMembers` describe: a member whose contact has language `es` (set with `recordLanguageSignal`) reads `language: "es"` in `people`, another reads `null` (mutation: drop `language` from the embed → FAILS). Runs on the local API (Task 5 Step 1's harness on `55500`–`55502`) or through CI `verify`; never bis-ci.

- [ ] **Step 2: Run red.** The four web test files → FAIL (`lang=""` where `lang="es"` expected; `customerLang` unknown prop is ignored). `record.test.ts` on the local API → FAIL (`language` undefined). Paste one line each.
- [ ] **Step 3: Implement.**
  - `activity-timeline.tsx`: add to `ActivityTimelineProps` `/** S-09 §9: the contact's language for what the CUSTOMER typed; "" when not set (C10). */ customerLang: "" | "en" | "es";`; pass `customerLang={p.customerLang}` to `Row` and add it to `Row`'s props; then `<dd lang={e.submission.author_kind === "customer" ? customerLang : ""} …>`, for the message `const typedLang = e.message.direction === "inbound" && e.message.channel !== "voice" ? customerLang : "";` used on both the subject and the body `<p lang={typedLang} …>`, and the booking note `<p lang={e.booking.author_kind === "customer" ? customerLang : ""} …>`.
  - `activity-timeline.fixture.ts`'s `legacyTimeline` return gains `customerLang: ""` (so the nine existing files keep compiling).
  - `page.tsx`: `customerLang={(contact.language as "en" | "es" | null) ?? ""}` on `ActivityTimeline`.
  - `recent-rows.ts`: widen `excerpt.lang` to `"" | "en" | "es"`; `excerptOf(e, customerLang)`; the message case `typed(…)` becomes `{ text, lang: e.message.direction === "inbound" && e.message.channel !== "voice" ? customerLang : "", done: false }` when there is text; the booking case uses `e.booking.author_kind === "customer" ? customerLang : ""`; `export function recentRowsView(rows: readonly TimelineRow[], customerLang: "" | "en" | "es" = "")`.
  - `route.ts`: `recentRowsView(timelineRows(…), (contact.language as "en" | "es" | null) ?? "")`.
  - `drawer-summary.ts:118-121`: `(ex.lang === "" || ex.lang === "en" || ex.lang === "es")` and the cast `ex.lang as "" | "en" | "es"`.
  - `record.ts`: the `Row` type's `contacts` gains `language: "en" | "es" | null`; the select becomes `"contact_id, is_primary_contact, created_at, contacts(first_name, last_name, language, conversations(last_message_at))"`; `people` maps `language: r.contacts!.language ?? null`; the `GroupActivity` type's person gains `language: "en" | "es" | null`.
  - `group-timeline.tsx`: `GroupTimelineProps` gains `/** S-09 §9: each member's language, by contact id; a member without one is absent. */ customerLangs: Record<string, "en" | "es">;`; `Row` reads `const customerLang = p.customerLangs[row.entry.contactId] ?? "";` and applies the same three rules as `ActivityTimeline` at `:130`, `:142-143`, `:151`.
  - `groups/[groupId]/page.tsx:200`: `customerLangs={Object.fromEntries((set?.people ?? []).flatMap((p) => (p.language ? [[p.contactId, p.language]] : [])))}`.
- [ ] **Step 4: Run green.** The four web files plus every existing `activity-timeline.*.test.ts`, `group-timeline*.test.ts`, `recent-rows.test.ts`, `drawer-summary.test.ts`, `route.test.ts`, the contact `page.test.ts` and the group `page.test.ts` (by path), `pnpm --filter web typecheck`; `record.test.ts` on the local API. Paste the summary lines.
- [ ] **Step 5: Probes** (red by name, revert): drop `&& e.message.channel !== "voice"` → "what the business wrote stays lang=\"\"" FAILS (the summary message); in `ActivityTimeline`'s `Row`, use `customerLang || "en"` → "a contact with no language keeps lang" FAILS; group timeline using `Object.values(p.customerLangs)[0]` for every row → the group case FAILS; `recentRowsView` ignoring direction → its case FAILS. Sibling copies: the same rule exists in `activity-timeline.tsx`, `group-timeline.tsx` and `recent-rows.ts`; each has its own probe above.
- [ ] **Step 6: Commit.**

```bash
cd <WT> && git add -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.lang.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.lang.test.ts" && git commit -m "feat(contacts): what the customer typed carries their language on the record, the drawer and the household page (S-09 §9)" -- "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.fixture.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/activity-timeline.lang.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/contacts/[contactId]/page.tsx" apps/web/src/lib/record/recent-rows.ts apps/web/src/lib/record/recent-rows.test.ts "apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.ts" apps/web/src/lib/contacts/drawer-summary.ts apps/web/src/lib/contacts/drawer-summary.test.ts packages/db/src/record.ts packages/db/src/test/record.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/group-timeline.lang.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/groups/[groupId]/page.tsx"
```

---

## Task 13: Inbound bubbles in Conversations take the contact's language (bis-comms)

**Review:** sonnet. **Depends on:** Task 1. **Runs beside:** Tasks 4 and 5. **Scratch:** `<SCRATCH>/s09-t13-impl/`, local API on `55503`/`55504`/`55505` (for `messaging.test.ts` only).

**Files**
- Modify: `packages/db/src/messaging.ts:38-46` (`ConversationSummary`), the four `contacts(…)` embeds (`:613` both variants, `:711`, `:841`) and their three mappers (`:665-673`, `:717-725`, `:853-861`)
- Modify: `packages/db/src/test/messaging.test.ts` (one case)
- Modify: `…/conversations/message-thread.tsx:9-21` (prop), `:50-54` (subject and body)
- Modify: `…/conversations/page.tsx:156-170` (pass it)
- Modify: `…/conversations/message-thread.test.ts` (one describe)

**Interfaces**
- Consumes: `contacts.language` (0076).
- Produces: `ConversationSummary.contactLanguage: "en" | "es" | null`; `MessageThread` prop `contactLanguage: "en" | "es" | null`.

- [ ] **Step 1: Write the failing tests.** Append to `message-thread.test.ts` (read its existing render helper and `Message` fixture first; the case uses them):

```ts
describe("inbound bubbles carry the contact's language (S-09 §9, C10)", () => {
  const at = "2026-10-09T16:12:00Z";
  const bubble = (id: string, direction: "inbound" | "outbound", channel: string, body: string) =>
    ({ id, direction, channel, body, subject: null, status: "delivered", error: null, created_at: at }) as never;
  const render = (contactLanguage: "en" | "es" | null) => renderToStaticMarkup(createElement(MessageThread, {
    messages: [bubble("m1", "inbound", "sms", "Necesito cambiar mi cita"), bubble("m2", "outbound", "sms", "Claro"), bubble("m3", "inbound", "voice", "Caller wants a quote.")],
    contactName: "Ana", composer: null, timezone: "UTC", contactLanguage,
  }));
  it("an inbound text takes it; what the business wrote and the call summary do not (mutation: tag every bubble -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(/<p lang="es"[^>]*>Necesito cambiar mi cita<\/p>/);
    expect(html).not.toMatch(/<p lang="es"[^>]*>Claro<\/p>/);
    expect(html).not.toMatch(/<p lang="es"[^>]*>Caller wants a quote\.<\/p>/);
  });
  it("no language: the customer's words are typed-unknown, lang=\"\" (mutation: use the page's language -> FAILS)", () => {
    expect(render(null)).toMatch(/<p lang=""[^>]*>Necesito cambiar mi cita<\/p>/);
  });
});
```

`messaging.test.ts`: one case — a conversation whose contact has language `es` (set through `recordLanguageSignal`) reads `contactLanguage: "es"` from `listConversations`, `getConversationSummary` and `searchConversations`; another with none reads `null` (mutation: drop `language` from one embed → that reader FAILS). Local API or CI `verify`, never bis-ci.

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/message-thread.test.ts"` → FAIL (no `lang` attribute). `messaging.test.ts` on the local API → FAIL (`contactLanguage` undefined). Paste one line each.
- [ ] **Step 3: Implement.** `ConversationSummary` gains `contactLanguage: "en" | "es" | null;`; every `contacts(first_name, last_name…)` embed adds `language` (`contacts!inner(first_name, last_name, language, assigned_to)` and `contacts(first_name, last_name, language)`); each mapper adds `contactLanguage: r.contacts?.language ?? null,`. `MessageThread` gains `/** S-09 §9: the customer's language for their own words; null when not set. */ contactLanguage: "en" | "es" | null;` and, per bubble:

```tsx
            {/* S-09 §9: what the CUSTOMER wrote (inbound, never the voice channel's AI summary) carries
                their language; with none it is typed text of unknown language. Outbound is unchanged. */}
            {(() => {
              const typedLang = message.direction === "inbound" && message.channel !== "voice" ? (contactLanguage ?? "") : undefined;
              return (
                <>
                  {message.subject ? <p lang={typedLang} className="text-sm font-medium text-card-foreground">{message.subject}</p> : null}
                  <p lang={typedLang} className="whitespace-pre-wrap text-sm text-card-foreground">{message.body}</p>
                </>
              );
            })()}
```

replacing the two existing `<p>`s (`:50-54`). `page.tsx`: `contactLanguage={active.contactLanguage}` on `MessageThread`.
- [ ] **Step 4: Run green.** The thread test, `page.test.ts`, `page.pagination.test.ts`, `page.zone.test.ts` (by path), `pnpm --filter web typecheck`, and `messaging.test.ts` + `contact-messages.test.ts` on the local API. Paste the summary lines.
- [ ] **Step 5: Probes** (red by name, revert): drop the `direction === "inbound"` test → "an inbound text takes it; what the business wrote … do not" FAILS; drop `&& message.channel !== "voice"` → the same case FAILS on the summary; `contactLanguage ?? "en"` → "no language … lang=\"\"" FAILS.
- [ ] **Step 6: Commit.**

```bash
cd <WT> && git commit -m "feat(sms): a customer's own words in Conversations carry their language (S-09 §9)" -- packages/db/src/messaging.ts packages/db/src/test/messaging.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/message-thread.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/message-thread.test.ts" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/conversations/page.tsx"
```

---

## Task 14: The backfill planner and script (bis-crm; SQL reviewed by bis-db-schema)

**Review:** sonnet, plus bis-db-schema's read of Step 6's emitted SQL. **Depends on:** Tasks 4 and 6.

**Files**
- Create: `apps/web/src/lib/contacts/language-backfill.ts`, `language-backfill.test.ts`
- Create: `apps/web/scripts/backfill-contact-language.ts`

**Interfaces**
- Consumes: `clearCallerLanguage` (Tasks 2 and 4); `pageLanguageSignal` (Task 6); `public.record_language_signal` and `public.events` (0076).
- Produces (Task 19 runs these):

```ts
export type FormEvidence = { kind: "form"; accountId: string; contactId: string; at: string; locale: string | null; accountLanguage: "en" | "es" | null };
export type CallEvidence = { kind: "call"; accountId: string; contactId: string; at: string; callerText: string | null };
export type Evidence = FormEvidence | CallEvidence;
export type PlannedSignal = { accountId: string; contactId: string; language: "en" | "es"; source: "form" | "call"; at: string };
export function planLanguageBackfill(evidence: readonly Evidence[]): PlannedSignal[];
export function backfillSql(signals: readonly PlannedSignal[]): string;
export function backfillCounts(signals: readonly PlannedSignal[]): { contacts: number; signals: number; es: number; en: number; form: number; call: number };
```

Script: `pnpm --filter web exec tsx scripts/backfill-contact-language.ts --in <evidence.json> --out <signals.sql>` → prints the counts as one JSON line; never connects to anything.

- [ ] **Step 1: Write the failing test** `apps/web/src/lib/contacts/language-backfill.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { planLanguageBackfill, backfillSql, backfillCounts, type Evidence } from "./language-backfill";

const A = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const C2 = "33333333-3333-4333-8333-333333333333";
const form = (contactId: string, at: string, locale: string | null, accountLanguage: "en" | "es" | null = null): Evidence =>
  ({ kind: "form", accountId: A, contactId, at, locale, accountLanguage });
const call = (contactId: string, at: string, callerText: string | null): Evidence => ({ kind: "call", accountId: A, contactId, at, callerText });

describe("planLanguageBackfill (spec §18.3, Q4)", () => {
  it("replays each contact's evidence OLDEST first, from forms by the page rule and calls by the strict reading (mutation: newest first -> FAILS)", () => {
    const plan = planLanguageBackfill([
      call(C1, "2026-09-05T10:00:00Z", "hello, I need an appointment please"),
      form(C1, "2026-09-01T10:00:00Z", "es"),
      form(C2, "2026-09-02T10:00:00Z", "en"),
      call(C2, "2026-09-03T10:00:00Z", "hi"),
    ]);
    expect(plan).toEqual([
      { accountId: A, contactId: C1, language: "es", source: "form", at: "2026-09-01T10:00:00.000Z" },
      { accountId: A, contactId: C1, language: "en", source: "call", at: "2026-09-05T10:00:00.000Z" },
    ]);
  });

  it("never reads calls.language: an English-only line's Spanish caller is Spanish (the evidence carries only the caller's words)", () => {
    expect(planLanguageBackfill([call(C1, "2026-09-05T10:00:00Z", "hola, necesito una cita")])[0]!.language).toBe("es");
  });

  it("a form in the account's own language, an unknown locale, or a bad id or time gives nothing (mutation: accept any uuid-ish id -> FAILS)", () => {
    expect(planLanguageBackfill([
      form(C1, "2026-09-01T10:00:00Z", "es", "es"),
      form(C1, "2026-09-01T10:00:00Z", "fr"),
      form(C1, "2026-09-01T10:00:00Z", null),
      form("x'); drop table contacts; --", "2026-09-01T10:00:00Z", "es"),
      form(C1, "not a time", "es"),
    ])).toEqual([]);
  });
});

describe("backfillSql: one statement per sign, the event written only when the language was set", () => {
  it("each statement calls record_language_signal inside the event insert's WHERE, as the system (mutation: insert the event unconditionally -> FAILS)", () => {
    const sql = backfillSql([{ accountId: A, contactId: C1, language: "es", source: "form", at: "2026-09-01T10:00:00.000Z" }]);
    expect(sql).toBe(
      "insert into public.events (account_id, type, actor_type, actor_id, payload) " +
      `select '${A}', 'contact.language_set', 'system', 'backfill-0076', jsonb_build_object('contactId', '${C1}', 'language', 'es', 'source', 'form') ` +
      `where public.record_language_signal('${A}', '${C1}', 'es', 'form', '2026-09-01T10:00:00.000Z');\n`);
  });
  it("is ASCII with no backslash, the MCP apply rule", () => {
    const sql = backfillSql(planLanguageBackfill([form(C1, "2026-09-01T10:00:00Z", "es"), call(C2, "2026-09-03T10:00:00Z", "hola, necesito una cita")]));
    expect([...sql].every((ch) => ch.charCodeAt(0) < 128 && ch !== "\\")).toBe(true);
  });
  it("counts what it will do", () => {
    const plan = planLanguageBackfill([form(C1, "2026-09-01T10:00:00Z", "es"), call(C1, "2026-09-05T10:00:00Z", "hello, I need an appointment please")]);
    expect(backfillCounts(plan)).toEqual({ contacts: 1, signals: 2, es: 1, en: 1, form: 1, call: 1 });
  });
});
```

- [ ] **Step 2: Run red.** `pnpm --filter web exec vitest run src/lib/contacts/language-backfill.test.ts` → FAIL: `Failed to resolve import "./language-backfill"`. Paste the line.
- [ ] **Step 3: Implement** `apps/web/src/lib/contacts/language-backfill.ts`:

```ts
import { clearCallerLanguage } from "@/lib/voice/language";
import { pageLanguageSignal } from "@/lib/contacts/language";

/**
 * S-09 §18.3 (Q4): every existing contact's language, from the two kinds of stored evidence only:
 * form submissions (C6's page rule on their stored locale) and calls (the strict reading of the
 * caller's own words, never calls.language, C5). Bookings store no language. Each contact's evidence
 * is replayed OLDEST first through record_language_signal: the first sign sets the language, the
 * newest is the last sign, so a contact whose history disagrees shows its hint. Pure: the
 * orchestrator reads the evidence and applies the SQL through the Supabase MCP (plan deviation 7).
 * `accountLanguage` is the account's language TODAY; what it was when the form was sent is not stored.
 */
export type FormEvidence = { kind: "form"; accountId: string; contactId: string; at: string; locale: string | null; accountLanguage: "en" | "es" | null };
export type CallEvidence = { kind: "call"; accountId: string; contactId: string; at: string; callerText: string | null };
export type Evidence = FormEvidence | CallEvidence;
export type PlannedSignal = { accountId: string; contactId: string; language: "en" | "es"; source: "form" | "call"; at: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function signOf(e: Evidence): "en" | "es" | null {
  if (e.kind === "form") return e.locale === "en" || e.locale === "es" ? pageLanguageSignal(e.locale, e.accountLanguage) : null;
  return e.callerText?.trim() ? clearCallerLanguage([{ role: "caller", text: e.callerText, at: "" }]) : null;
}

export function planLanguageBackfill(evidence: readonly Evidence[]): PlannedSignal[] {
  const out: PlannedSignal[] = [];
  for (const e of evidence) {
    if (!UUID.test(e.accountId) || !UUID.test(e.contactId)) continue;
    const ms = Date.parse(e.at);
    if (!Number.isFinite(ms)) continue;
    const language = signOf(e);
    if (language) out.push({ accountId: e.accountId, contactId: e.contactId, language, source: e.kind, at: new Date(ms).toISOString() });
  }
  return out.sort((a, b) => (a.contactId < b.contactId ? -1 : a.contactId > b.contactId ? 1 : 0) || Date.parse(a.at) - Date.parse(b.at));
}

/** One statement per sign; the event row exists only when the function set the language. Every value
 *  is a checked uuid, a fixed word or an ISO time, so nothing here can carry a quote. */
export function backfillSql(signals: readonly PlannedSignal[]): string {
  return signals.map((s) =>
    "insert into public.events (account_id, type, actor_type, actor_id, payload) " +
    `select '${s.accountId}', 'contact.language_set', 'system', 'backfill-0076', jsonb_build_object('contactId', '${s.contactId}', 'language', '${s.language}', 'source', '${s.source}') ` +
    `where public.record_language_signal('${s.accountId}', '${s.contactId}', '${s.language}', '${s.source}', '${s.at}');\n`).join("");
}

export function backfillCounts(signals: readonly PlannedSignal[]) {
  return {
    contacts: new Set(signals.map((s) => s.contactId)).size, signals: signals.length,
    es: signals.filter((s) => s.language === "es").length, en: signals.filter((s) => s.language === "en").length,
    form: signals.filter((s) => s.source === "form").length, call: signals.filter((s) => s.source === "call").length,
  };
}
```

`apps/web/scripts/backfill-contact-language.ts`:

```ts
// S-09 §18.3: evidence JSON in (read by the orchestrator through the Supabase MCP, read-only), one SQL
// file out (applied by the orchestrator through the MCP), counts printed. Connects to nothing.
//   pnpm --filter web exec tsx scripts/backfill-contact-language.ts --in <evidence.json> --out <signals.sql>
import { readFileSync, writeFileSync } from "node:fs";
import { planLanguageBackfill, backfillSql, backfillCounts, type Evidence } from "../src/lib/contacts/language-backfill";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`missing ${name} <path>`);
  return process.argv[i + 1]!;
};
const evidence = JSON.parse(readFileSync(arg("--in"), "utf8")) as Evidence[];
const plan = planLanguageBackfill(evidence);
writeFileSync(arg("--out"), backfillSql(plan), "utf8");
console.log(JSON.stringify({ evidence: evidence.length, ...backfillCounts(plan) }));
```

(**Assumption:** `tsx` resolves the `@/` alias through `apps/web/tsconfig.json`'s `paths`, as `scripts/generate-i18n-baseline.ts` relies on; if it does not, run the script from `apps/web` with `tsx --tsconfig tsconfig.json` and say so.)
- [ ] **Step 4: Run green.** The test green; then a dry run on a fixture: write `<SCRATCH>/s09-t14-impl/ev.json` with the four evidence rows of the first test (synthetic, no customer data), run the script with `--in`/`--out` into the same directory, and paste its JSON line (`{"evidence":4,"contacts":1,"signals":2,"es":1,"en":1,"form":1,"call":1}`). `pnpm --filter web typecheck` clean.
- [ ] **Step 5: Probes** (red by name, revert): sort descending by time → "replays each contact's evidence OLDEST first" FAILS; drop the `UUID.test` line → "a bad id … gives nothing" FAILS; emit the event `insert … values (…)` before a separate `select public.record_language_signal(…)` → "the event written only when the language was set" FAILS.
- [ ] **Step 6: bis-db-schema reads the emitted SQL** from Step 4's output file against 0076: the function's argument order and types, `events`' columns and its `actor_type` check (`system` allowed), one statement per line, no transaction control (the MCP runs the file as one batch). Their verdict goes in this task's report.
- [ ] **Step 7: Commit.**

```bash
cd <WT> && git add -- apps/web/src/lib/contacts/language-backfill.ts apps/web/src/lib/contacts/language-backfill.test.ts apps/web/scripts/backfill-contact-language.ts && git commit -m "feat(contacts): the one-time language backfill, planned offline from stored forms and calls into reviewable SQL (S-09 §18.3)" -- apps/web/src/lib/contacts/language-backfill.ts apps/web/src/lib/contacts/language-backfill.test.ts apps/web/scripts/backfill-contact-language.ts
```

---

## Task 15: Regenerate the i18n baselines (bis-crm)

**Review:** sonnet. **Depends on:** Tasks 6, 11, 12, 13 committed.

**Files**
- Modify: `apps/web/src/lib/i18n/catalogue-baseline.json`, `apps/web/src/lib/i18n/ratchet-baseline.json` (regenerated, never hand-edited)

- [ ] **Step 1: Regenerate.** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`.
- [ ] **Step 2: Read the diff.** `git diff --stat -- apps/web/src/lib/i18n/` and `git diff -- apps/web/src/lib/i18n/`. Expected: no NEW key in `catalogue-baseline.json` (every new key has its twin), and no file's count going UP in `ratchet-baseline.json` (the new `.tsx` carries no letter-bearing literal). A count that went up is a JSX literal one of Tasks 11–13 left: stop and send it back to that task's owner.
- [ ] **Step 3: Run.** `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts src/lib/messages.test.ts` → green. Paste the summary line.
- [ ] **Step 4: Commit.**

```bash
cd <WT> && git commit -m "chore(i18n): regenerate the baselines after the Language line (S-09)" -- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json
```

---

## Task 16: e2e (bis-e2e-qa)

**Review:** sonnet. **Depends on:** Tasks 11, 12, 15. Written by the agent, run by the orchestrator (Task 19 step 3). Never `Test Client One`.

**Files**
- Create: `apps/web/e2e/contact-language.spec.ts`

- [ ] **Step 1: Read first:** `e2e/support.ts:103-134` (`readClientFixture`, `recordPage`, `RECORD_PAGE`), `e2e/contacts-drawer.spec.ts:60-200` (`base()`, the drawer's open helper, `serviceDb`), and the Spanish describe at the end of `contacts-drawer.spec.ts` (the Owner's `users.language` flip restored in `finally`).
- [ ] **Step 2: Write** `apps/web/e2e/contact-language.spec.ts`:

```ts
import { test, expect } from "./fixtures/test";
import { serviceDb, createContact, recordLanguageSignal } from "@bis/db";
import { readClientFixture, recordPage } from "./support";
import { m } from "../src/lib/messages";

/**
 * S-09 PR 1: a customer's language on the record page and in the drawer. On the per-run fixture
 * account only; every row is deleted in finally. The sign is recorded through recordLanguageSignal,
 * the function the booking action calls (plan deviation 9).
 */
test.describe("a language on every contact (S-09)", () => {
  test("a booking's Spanish shows on the record and in the drawer; set English, Undo back to the booking", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) { test.skip(true, "No client fixture; run the full suite."); return; }
    const db = serviceDb();
    const stamp = Date.now();
    const { id, existing } = await createContact(db, fixture.accountId, { firstName: "Lengua", lastName: `Cita ${stamp}` }, "e2e-language");
    if (existing) throw new Error("contact-language e2e: matched an existing contact; refusing to use it.");
    try {
      expect(await recordLanguageSignal(db, fixture.accountId, id, { language: "es", source: "booking", at: new Date() }, "public", "system")).toBe(true);
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts/${id}`);
      const row = recordPage(page).locator("[data-language-row]");
      await expect(row).toHaveAttribute("data-language", "es");
      await expect(row.locator("[data-language-phrase]")).toContainText("from their booking (");
      await expect(row.locator('span[lang="es"]')).toHaveText("Español");

      await row.getByRole("combobox", { name: m["contact.language.label"] }).click();
      await page.getByRole("option", { name: "English" }).click();
      await expect(page.getByText(m["contact.language.setToast"].replace("{value}", "English"))).toBeVisible();
      await expect(row).toHaveAttribute("data-language", "en");
      await expect(row.locator("[data-language-phrase]")).toContainText("set by your team (");
      await page.getByRole("button", { name: m["common.undo"] }).click();
      await expect(row).toHaveAttribute("data-language", "es");
      await expect(row.locator("[data-language-phrase]")).toContainText("from their booking (");

      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts?peek=${id}`);
      const drawerRow = page.getByRole("dialog").locator("[data-language-row]");
      await expect(drawerRow).toHaveAttribute("data-language", "es");
      await expect(drawerRow.locator("[data-language-phrase]")).toContainText("from their booking (");
    } finally {
      const { error } = await db.from("contacts").delete().eq("account_id", fixture.accountId).eq("id", id);
      if (error) console.error(`contact-language e2e: cleanup failed: ${error.message}`);
    }
  });

  test("a later disagreeing call shows the hint; Keep hides it after a reload", async ({ page }) => {
    const fixture = readClientFixture();
    if (!fixture) { test.skip(true, "No client fixture; run the full suite."); return; }
    const db = serviceDb();
    const stamp = Date.now();
    const { id, existing } = await createContact(db, fixture.accountId, { firstName: "Pista", lastName: `Llamada ${stamp}` }, "e2e-language");
    if (existing) throw new Error("contact-language e2e: matched an existing contact; refusing to use it.");
    try {
      const t0 = Date.now() - 60_000;
      await recordLanguageSignal(db, fixture.accountId, id, { language: "es", source: "form", at: new Date(t0) }, "form", "system");
      await recordLanguageSignal(db, fixture.accountId, id, { language: "en", source: "call", at: new Date(t0 + 30_000) }, "voice", "ai");
      await page.goto(`/dashboard/accounts/${fixture.accountId}/contacts/${id}`);
      const hint = recordPage(page).locator("[data-language-hint]");
      await expect(hint).toContainText("Spoke English on the last call. Switch to English?");
      await hint.getByRole("button", { name: m["contact.language.keep"] }).click();
      await expect(page.getByText(m["contact.language.keptToast"])).toBeVisible();
      await page.reload();
      await expect(recordPage(page).locator("[data-language-row]")).toBeVisible();
      await expect(recordPage(page).locator("[data-language-hint]")).toHaveCount(0);
    } finally {
      const { error } = await db.from("contacts").delete().eq("account_id", fixture.accountId).eq("id", id);
      if (error) console.error(`contact-language e2e: cleanup failed: ${error.message}`);
    }
  });
});
```

- [ ] **Step 3: The Spanish reader.** Add a third test in its own `test.describe` with `test.use({ storageState: "e2e/.auth/client-state.json" })`, copying `contacts-drawer.spec.ts`'s Owner `users.language` flip and `finally` reset verbatim: open the same kind of seeded contact's record and expect `recordPage(page).locator("[data-language-row] dt")` to have text `m["contact.language.label.es"]` ("Idioma") and the phrase to contain `por su cita (`.
- [ ] **Step 4: Typecheck and the fixture-name guard.** `pnpm --filter web exec tsc --noEmit -p e2e` (or the e2e typecheck `apps/web/package.json` names) and `pnpm --filter web exec vitest run e2e/fixtures/fixture-names.test.ts e2e/overflow-check.test.ts` → green. The names "Lengua Cita <stamp>" and "Pista Llamada <stamp>" are deleted in `finally`; if the sweep's name guard asks for an `E2E` prefix, follow what `fixture-names.test.ts` says and report it.
- [ ] **Step 5: Commit.**

```bash
cd <WT> && git add -- apps/web/e2e/contact-language.spec.ts && git commit -m "test(e2e): a contact's language on the record and in the drawer, its Undo, the hint and Keep, in English and Spanish (S-09)" -- apps/web/e2e/contact-language.spec.ts
```

---

## Task 17: DESIGN.md and the ledger (orchestrator)

- [ ] **Step 1.** Land spec §21's bullet in `DESIGN.md` → **Key patterns**, directly after "The weekly report" bullet, verbatim: "**A customer's language** (decided 2026-10-13) is one fact on their record: set by their own first clear sign (a Spanish booking or form, a call in which they clearly spoke it), changed by staff at any time, never overwritten by a later sign, which offers a Switch instead. Every scheduled message reads it, then the account's language, then English; a reply in the moment follows the moment. One message is in one language, end to end: subject, body, date, button and footer." Commit: `docs(design): a customer's language is one fact on their record (S-09)` with `git commit -- DESIGN.md`.
- [ ] **Step 2.** File in the ledger: plan deviations 2 (neither `followup_body` nor `textback_body` is length-validated; PR 2 validates both languages), 5 and 6 (voice-channel and AI-written rows keep `lang=""`), 12 (concierge chats signal as `form`); Task 4's threshold report; the Q10 list for PR 2 (Task 19 step 6's `language = 'es'` accounts); "existing Spanish uses tú" (Q5's follow-up pass).

---

## Task 18: Whole-branch final review (checkpoint, not an implementer task)

**Reviewer:** opus, fresh context. Runs after Tasks 14, 15, 16 and 17.

- [ ] **Step 1.** Read the spec end to end (including "Decided 2026-10-13"), then `git diff 0d6d0edc...HEAD` in `<WT>`; walk the coverage table below row by row against the diff.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2 and 6–14 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/messages.test.ts`, `src/components/ui/material.test.ts`, `"src/app/(dashboard)/dashboard/accounts/[accountId]/in-account-service-reads.test.ts"`; `pnpm --filter web typecheck`. The db suites on a replica of your own (port `55491`), never bis-ci. Re-run two probes of your own choosing, by name.
- [ ] **Step 3.** Hunt specifically: (a) a language write on a request client, or a service write before `getContact` on the request client; (b) any path that can overwrite a non-null language other than the three staff writers (grep `language:` in every `update(`); (c) a signal point that runs before its own durable write, or outside its own try; (d) `calls.language` or `detectSpokenLanguage` feeding a signal; (e) a second primary on the record or in the drawer (`data-variant="default"` near `data-language-hint`); (f) a `lang` set on what the business or the AI wrote; (g) a new key without its twin, a JSX literal with a letter, "her" in copy; (h) a test that cannot fail (memory "vacuous test shapes"); (i) a SECURITY DEFINER function or a NULL-able boolean that fails open; (j) the migration's ASCII rule.
- [ ] **Step 4.** Report findings by severity with file:line; the orchestrator routes fixes to the owning task's agent.

---

## Task 19: Rollout (orchestrator; not a coding task)

Additive migration, so it applies before the merge (spec §18.1). Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1.** Merge `origin/main` into `feat/s09-language`; `ls packages/db/supabase/migrations | tail -1` is still `0076_customer_language.sql` and nothing on `main` holds a 0076.
- [ ] **Step 2. bis-ci.** `gh workflow run ci-project-setup.yml -f step=push-dry-run --ref feat/s09-language` → its log lists exactly `0076_customer_language.sql`; then `-f step=push`. Post-apply, read-only with `ci:sql`: the seven contacts columns and six checks (`select conname from pg_constraint where conrelid = 'public.contacts'::regclass and conname like 'contacts_%language%'`), `select proacl from pg_proc where proname = 'record_language_signal'` (service_role only), the trigger (`select tgname from pg_trigger where tgname = 'contacts_language_server_only'`), the six PR 2 columns, calendars' column grants, and the §6.5 counts (step 6's three queries). Push the branch; CI's `verify` (the in-runner stack runs every db suite, the new ones included) and `e2e` green ON THE HEAD SHA, read from `gh api repos/{owner}/{repo}/commits/<sha>/check-runs`.
- [ ] **Step 3. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (after checking no `screenshots.yml` run is in progress). The `forms.spec` unread-badge flake is unrelated; never loosen it.
- [ ] **Step 4. Production.** The MCP procedure: pre-flight read by name (`select column_name from information_schema.columns where table_name = 'contacts' and column_name like '%language%'` → none; `select to_regprocedure('public.record_language_signal(uuid,uuid,text,text,timestamptz)')` → null), `apply_migration` with 0076's exact text, then the same post-apply reads as step 2. Ledger line: `0076 APPLIED <date> on bis-ci and production — NEVER RE-APPLY`.
- [ ] **Step 5. Parity** (`docs/runbooks/ci-supabase-project.md` §5): the digest over `contacts`, `automations`, `calendars`, `voice_profiles` columns, constraints and privileges equal on bis-ci and production.
- [ ] **Step 6. Measure, read-only, on production (spec §18.2), before any backfill.** Run and record the counts (never row contents) in the ledger:

```sql
select count(*) from public.contacts;
select count(distinct fs.contact_id) from public.form_submissions fs
  join public.forms f on f.id = fs.form_id join public.accounts a on a.id = f.account_id
 where fs.contact_id is not null and fs.locale in ('en', 'es') and fs.locale <> coalesce(a.language, 'en');
select count(distinct contact_id) from public.calls where contact_id is not null and jsonb_array_length(transcript) > 0;
select id, brand_name from public.accounts where language = 'es';
select recipe_key, count(*) filter (where body <> '') from public.automations group by recipe_key;
select count(*) filter (where followup_body <> '') from public.calendars;
select count(*) filter (where textback_body <> '') from public.voice_profiles;
select count(*) filter (where body_es = '') as emptied from public.automations;
```

(`accounts.brand_name` is the column `brandDisplayName` reads, `0010_branding.sql:4-5`.) The `language = 'es'` list is Q10's input for PR 2; it goes to danlo, not into PR 1.
- [ ] **Step 7. Backfill, bis-ci first, then production** (plan deviations 7 and 8). For each project, read the evidence read-only through the MCP and write it to `<SCRATCH>/s09-evidence/<project>-evidence.json` as `Evidence[]` (Task 14's types):

```sql
select 'form' as kind, f.account_id as "accountId", fs.contact_id as "contactId", fs.created_at as at,
       fs.locale, a.language as "accountLanguage", null::text as "callerText", null::text as "outcome"
  from public.form_submissions fs join public.forms f on f.id = fs.form_id join public.accounts a on a.id = f.account_id
 where fs.contact_id is not null
union all
select 'call', c.account_id, c.contact_id, c.started_at, null, null,
       (select string_agg(e->>'text', ' ' order by t.ord) from jsonb_array_elements(c.transcript) with ordinality as t(e, ord) where e->>'role' = 'caller'),
       c.outcome
  from public.calls c
 where c.contact_id is not null and jsonb_array_length(c.transcript) > 0
   and c.outcome in ('booked', 'lead', 'message');
```

The call leg's `and c.outcome in ('booked', 'lead', 'message')` matches the live gate (0076's record_language_signal has no opinion on outcome; this is the export deciding a spam/abandoned/transferred call is not meaningful evidence of the caller's language, same test as PR 2's other call-outcome gates). The planner (Task 14) also refuses a non-meaningful `outcome` when the export supplies one, as a second, cheap check — belt and suspenders, not a second source of truth.

Run `pnpm --filter web exec tsx scripts/backfill-contact-language.ts --in <evidence.json> --out <signals.sql>` (add `--chunk N` to split the output on contact boundaries, applied in order, if the file is large enough that one refused statement rolling back the whole batch is a real risk); record its counts line (now `{ evidence, dropped: { badId, badKind, badTime, unknownLocale, unclearCall, nonMeaningfulCall }, files, contacts, signals, es, en, form, call }`); compare `contacts` with step 6's two candidate counts (it can only be lower). Apply `<signals.sql>` (or each chunk file, in order) through the MCP `execute_sql`; then read back `select language_source, language, count(*) from public.contacts where language is not null group by 1, 2` and `select count(*) from public.events where actor_id = 'backfill-0076'` (equals the number of contacts the backfill SET). On bis-ci first; production only after bis-ci's read-back matches its counts.
- [ ] **Step 8. Merge** (squash, through the PR, after the head SHA's `verify` and `e2e` are green and Task 18's findings are closed).
- [ ] **Step 9. Re-run the backfill once on production after the deploy is live** (step 7's read, script and apply): it covers the window between step 7 and the deploy; already-replayed evidence is a no-op (Task 1's "the same signal twice" case). Record the second counts line. Delete `<SCRATCH>/s09-evidence/`.
- [ ] **Step 10.** Ledger: the migration line, steps 6, 7 and 9's counts, Task 4's thresholds, the roadmap tracker row for item 5 (PR 1 merged).

---

## Spec coverage

| Spec | Where |
|---|---|
| L1 auto-set from the first clear sign, only when null, never over staff | Task 1 (`record_language_signal`, its tests), Task 5, Tasks 7–9 |
| L1 hint, Switch / Keep, Keep until a newer sign | Task 6 (`languageHint`), Task 10 (keep), Task 11 (UI), Task 16 |
| L2 / L3 / D5 (PR 2) | only 0076's columns and Q1's data step: Task 1 |
| D4 contacts.language + source + set time | Task 1 |
| D4 signal points: web booking, Sofía's tools, form, call finish | Tasks 7, 8, 9 |
| D4 Language line in Details, record page and drawer, inline edit with Undo, Technician scope | Tasks 10, 11, 16 |
| D4 customer-typed text carries the contact's language | Tasks 12, 13 |
| D4 who may write the column, 0053 in mind | Task 1 (no grant, INSERT trigger), Task 10 (proof then service write) |
| D6 out of scope | nothing added (no CSV column, no inbound-text detection, no bookings column) |
| C1 four sources | Task 1 checks; Task 5 `LANGUAGE_SOURCES` |
| C2 server-only, INSERT guard, staff via proof | Task 1, Task 10 |
| C3 one SQL writer, first wins | Task 1 (deviation 1) |
| C4 hint on read | Task 6 |
| C5 strict caller reading, never calls.language | Tasks 2, 4, 8, 14 |
| C6 page rule (Q2) | Task 6, Tasks 7, 9, 14 |
| C7 phone booking signals as booking, finish as call | Task 8 |
| C8 Not set names the effective fallback | Task 6 (+ deviation 10) |
| C9 Undo restores the prior triple | Tasks 5, 10, 11 |
| C10 customer text only, only when set; caller's words keep the call's lang | Tasks 12, 13 (+ deviations 5, 6) |
| C17 / Q6 one migration with PR 2's columns | Task 1 |
| §6.3 trigger | Task 1 |
| §6.5 / Q1 data step | Task 1 Steps 2, 9, probe 10 (+ deviation 3) |
| §6.6 comments, rollback | Task 1 |
| §7.3 races and order | Task 1 (time guard, lock) |
| §8.2 states (set, not set, hint, loading, error) | Tasks 6, 11 |
| §8.3 editing, toasts, no Not set option, Esc | Task 11 (+ deviation 14) |
| §8.4 bilingual, endonym lang | Tasks 6, 11, 16 |
| §15.2 keys | Task 6 |
| §16.1 db tests | Tasks 1, 5 |
| §16.2 unit tests (PR 1 rows) | Tasks 2, 6–14 |
| §16.3 e2e (PR 1) | Task 16 (+ deviation 9) |
| §18.1 rollout | Task 19 steps 1–5, 8 |
| §18.2 measurements | Task 19 step 6 |
| §18.3 / Q4 backfill | Task 14, Task 19 steps 7, 9 (+ deviations 7, 8) |
| §21 DESIGN.md | Task 17 |
| Q7 thresholds tuned before merge | Tasks 3, 4 |
| Q10 accounts named before PR 2 | Task 19 step 6, Task 17 step 2 |
