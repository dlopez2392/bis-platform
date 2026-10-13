# Scheduled customer messages in the customer's language (S-09 PR 2, no migration): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every scheduled customer message (the reminder email, the text reminder, the calendar follow-up, and the six recipes: review request, no-show nudge, appointment confirmation, quote follow-up, referral ask, reactivation) goes out in the customer's language: `contacts.language`, else `accounts.language`, else English (L3). Each message is in ONE language end to end: subject, body, date, button, footer and opt-out line (C11). Every editable body gets a Spanish box beside the English, starting as our written Spanish; emptied means Spanish customers get the English; a Spanish box written beside an older English warns "The Spanish still says the old message". The missed-call text-back keeps following the caller's spoken language and also gets a box. An early appointment booked the evening before gets its reminder email at 08:00 when no text reminder will cover it (Q3). The record's "Not set" line names the account's language again, now that sends follow it. In-the-moment replies (confirmations, lead receipt, instant reply, consent replies) are unchanged.

**Architecture:** No migration: 0076 (applied to bis-ci and production 2026-10-13, ledger "0076 APPLIED … NEVER RE-APPLY") already holds `automations.body_es/_basis`, `calendars.followup_body_es/_basis` and `voice_profiles.textback_body_es/_basis`. Four pure functions in `packages/db/src/messaging.ts` (bis-comms) are the whole rule: `recipientLanguage` (L3, C12), `chooseBody` (C11, C13), `spanishIsStale` (C14) and `nextSpanishBox` (the save-side twin of C13/C14, shared by the three save actions). The account read every due-list already shares (`ACCOUNT_BRAND_COLS` → `AccountBrandInfo`) gains `language`; each due-list's mapper resolves the row's `language` once, so no pass re-derives it. Templates and copy modules take a language; every pass hands the language `chooseBody` returned to its template, its date, and its gate (`ctx.email.send({ language })`, `sendAutomationSms(ctx, { language })`), which already speak Spanish. One shared client component (`SpanishBodyField`, bis-frontend) renders the Spanish box on all nine cards. The late reminder is one new input to `reminderDeadline`: `{ textCovers }`.

**Tech Stack:** supabase-js; Next.js 16 App Router (server actions, client components); React 19.2; vitest (`renderToStaticMarkup`, no DOM; `vi.mock`); the `@bis/db` suites run against bis-ci (0076 is on it), judged by vitest's summary block; Playwright (bis-e2e-qa writes it, the orchestrator runs it).

**Spec:** `docs/superpowers/specs/2026-10-13-customer-language-design.md` (OWNER-APPROVED 2026-10-13: Q1 keep their English; Q3 the 08:00 late reminder at 45 minutes, only where no text goes; Q5 usted for new copy; Q8 instant reply as shipped; Q9 the text reminder's closing line gets a box; Q10 measure and name the switched accounts before merge). PR 1's own plan (`2026-10-13-customer-language-pr1.md`) deviation 2 (no DB length check on `followup_body` / `textback_body`; PR 2 validates both languages in the actions) and final review I-2 (`notSetAccount` moves to PR 2) are carried here. Base: `main` at `f47e27ca` (#256, PR 1 merged, 0076 live). Every file:line below was read off this worktree at `f47e27ca`; anything not read is labelled **Assumption**.

`<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s09-pr2` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s09-pr2`), branch `feat/s09-pr2`. `<SCRATCH>` = the session scratchpad, written out as a literal absolute path in every command. `…/accounts/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/`. `…/summary/` = `apps/web/src/app/api/accounts/[accountId]/contacts/[contactId]/summary/`.

## Global Constraints

- **NEVER `git stash`, `git reset`, `git checkout --`, or `--amend` in the shared worktree.** All three hit PR 1's worktree: another agent's uncommitted work lives in the same tree, and each of those commands destroys or rewrites it. To undo your own edit, edit it back. To see the committed text, `git show HEAD:<path>`.
- **Ownership (tag on every task; no task edits a file its owner does not own).**
  - **bis-comms:** `packages/db/src/messaging.ts` (the four functions), `packages/db/src/recipient-language.test.ts` (new), `packages/db/src/index.ts` (one export line); `apps/web/src/lib/sms/segments.ts`, `segments.test.ts`; `apps/web/src/lib/messages.ts` (every key this PR adds or changes) and `apps/web/src/lib/i18n/spanish-sms-gsm.test.ts` (new); `apps/web/src/lib/email/templates/{booking,followup,review-request,no-show-nudge}.ts` and their tests, `brand-name-parity.test.ts`; the copy modules `apps/web/src/lib/automations/{sms-reminder,appointment-confirm,review-request,no-show-nudge,quote-followup,referral-ask,reactivation,marketing}-copy.ts` and their tests; `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` (regenerated, never hand-edited).
  - **bis-booking:** `packages/db/src/booking.ts` (`ACCOUNT_BRAND_COLS`, `AccountBrandInfo`, `DueReminder`, `DueFollowup`, `CALENDAR_COLS`, `CalendarRow`, `CalendarSettingsPatch`, `updateCalendarSettings`, the booking list's contact embed), `packages/db/src/test/booking.test.ts`; `apps/web/src/lib/booking/reminder-timing.ts` (+ test); `apps/web/src/lib/automations/cron-coupling.test.ts`; `apps/web/src/lib/automations/passes/followups.ts` (+ test); `apps/web/src/lib/automations/passes/reminders.ts` **only the `textCovers` change in Task 13, after Task 9 committed**; `…/accounts/calendar/{calendar-settings.tsx,actions.ts,actions.test.ts,cancel-notice-draft.ts,cancel-notice-draft.test.ts,cancel-dialog.tsx,bookings-list.tsx,page.tsx,page.test.ts}`; `apps/web/src/app/b/[publicId]/actions.test.ts` (one pin case).
  - **bis-automations:** `packages/db/src/automations.ts`, `packages/db/src/test/automations.test.ts`, `packages/db/src/test/due-by-id.test.ts`; the passes `apps/web/src/lib/automations/passes/{reminders,sms-reminder,appointment-confirm,review-request,no-show-nudge,referral-ask,reactivation,quote-followup}.ts` and their tests; `…/accounts/automations/{actions.ts,actions.test.ts,*-card.tsx,*-card.test.ts,automations-settings.tsx,automations-settings.test.ts,page.tsx,page.test.ts}` (never `instant-reply-card*`, C15).
  - **bis-voice:** `apps/web/src/lib/voice/textback.ts` (+ test), `apps/web/src/lib/voice/finish-call.ts` (the `textbackBodyEs` field only, + test), `apps/web/src/app/api/voice/incoming/route.ts` (one field), `apps/web/src/app/api/voice/texml/handoff-result/route.ts` (one field), `…/accounts/voice/{voice-settings.tsx,actions.ts,actions.test.ts}` and the voice-settings test.
  - **bis-crm:** `apps/web/src/lib/contacts/language.ts`, `language.test.ts`; `…/accounts/contacts/[contactId]/page.tsx` (line 185 only); `…/summary/route.ts` (line 122 only), `route.test.ts`.
  - **bis-frontend:** `apps/web/src/components/spanish-body-field.tsx` and `spanish-body-field.test.ts` (new); `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` (one section).
  - **bis-e2e-qa:** `apps/web/e2e/automations-spanish.spec.ts` (new).
  - **Orchestrator:** the read-only production and bis-ci reads, the guarded Q1 re-run (Task 21), the Q10 notice, the ledger, the gates, the PR. No `DESIGN.md` edit is needed: PR 1 landed the "A customer's language" bullet (`DESIGN.md`, Key patterns) and it already states PR 2's rule.
- **Shared files, one task at a time, in this order.**
  - `apps/web/src/lib/messages.ts`: **Task 3 only.** A `.es` twin goes on the line directly under its English key.
  - `packages/db/src/index.ts`: **Task 1 only**, one line directly after the messaging block's closing line (`sumUnreadCount, searchConversations } from "./messaging";`, `index.ts:55`). `AccountBrandInfo` is already exported (`index.ts:88`); `DueReminder`/`DueFollowup` (`:85`) and the `Due*` recipe types (`:126` area) are already exported, and their new fields need no barrel change.
  - `packages/db/src/booking.ts`: **Task 6 → Task 13** (Task 13 edits one comment, nothing else).
  - `packages/db/src/automations.ts`: **Task 7 only** (after Task 6, it reads `AccountBrandInfo.accountLanguage`).
  - `apps/web/src/lib/automations/passes/reminders.ts` (+ test): **Task 9 → Task 13.**
  - `…/accounts/automations/actions.ts`, `actions.test.ts`, `page.tsx`, `page.test.ts`: **Task 15 → Task 16** (two halves of the cards; Task 16 starts after Task 15 committed).
  - `apps/web/src/lib/i18n/*-baseline.json`: **Task 20 only**, after Tasks 3, 14–19 have committed.
- **No migration.** Nothing in this PR writes DDL. If an implementer finds one is needed, they STOP and report it; the orchestrator decides. bis-ci and production both carry 0076; the e2e job's migration check passes with no new file.
- **Database tests** run against bis-ci (the project both `.env` files name; 0076 is on it). Only the affected files, by path: `pnpm --filter @bis/db exec vitest run src/test/booking.test.ts src/test/automations.test.ts src/test/due-by-id.test.ts`. Judge by vitest's summary block; the `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` trailer lies about the exit (capture an exit code to a file with nothing after the command). Every `@bis/db` run also triggers `src/test/global-setup.ts` (refuse-production, fixture sweep): that is expected. Never point a run at production; the guard refuses it.
- **DESIGN.md definition of done for every UI task (14–19):** tokens only, no hard-coded colours, radii or shadows; both themes via the `.dark` class; rule 3 (the stale line is a dot AND words, never colour alone); rule 5 (each box's states: our Spanish, theirs, emptied, stale; the card's own error toast unchanged); rule 7 (no spinner: the cards are server-rendered with their data); **rule 8: one primary Save per card, unchanged** — the Spanish box, its checkbox and "Use our Spanish" (a `ghost` button, `type="button"`) are inside the card's ONE form and are committed by the card's ONE Save; a test per card pins exactly one `data-variant="default"` button; a visible `:focus-visible` ring on both textareas, the checkbox and the ghost button; controls `min-h-11 md:min-h-8`; side by side at `md`, stacked below (`grid gap-4 md:grid-cols-2`); nothing animates on scroll. The bilingual DoD line does NOT bind the cards' chrome (agency-only and English today, spec §21) but DOES bind the customer content: the Spanish box's text carries `lang="es"`, its preview too. `/styleguide` gains the new component (Task 14).
- **Copy:** every new string through `m[…]` (English chrome) or `t(m, key, language, params)` (`lib/i18n/t.ts`, customer content) with an `.es` twin in the same commit (the ratchet, `lib/i18n/ratchet.test.ts`, admits no new key without one). Twins are ALSO added to the existing customer-facing `automations.*` defaults this PR starts sending in Spanish (shrinking the frozen list is free, `ratchet-scan.ts:106-112`). New `.tsx` code carries no JSX literal copy with a letter in it (`ratchet-scan.ts`). Usted, the spec's §15.1 and §15.3 words verbatim. **Every Spanish SMS string carries no á, í, ó or ú** (é, ñ, ü, ¿, ¡ are GSM-7, `segments.ts:15-17`); Task 3's guard test pins it. No `{{…}}`, no milestone codes (`INTERNAL_MILESTONE`), no vendor jargon. A name shown to a customer is `brandDisplayName` (the due-rows' `brandName` / `branding`), never `accounts.name`. `t()` silently falls back to English when a twin is missing: every Spanish assertion in this plan compares against the literal Spanish string, never against `t()`'s output, or a missing twin would pass.
- **Every test can fail.** Each test names the mutation that breaks it. Run the probe, see the test fail BY NAME, paste the failing assertion line into the report, revert by editing back (never `git checkout --`). A `-t` filter that matches nothing passes silently: check the run count in vitest's summary block. **Where a rule exists twice, probe the sibling copy too:** `chooseBody` is called by nine senders (probe a second pass, not only the first); the Spanish box renders on nine cards (Task 14's component probe AND one card's wiring probe); the late rule is applied at listing AND at release (both paths of `processReminders`); the gate's `language` is passed to the email gate AND the SMS gate (probe each in a pass that has both channels).
- **The `vi.mock("@bis/db")` factory check.** A task that adds a NEW named import from `@bis/db` to an existing module adds that name to every bare factory reaching the module: `grep -rln 'vi.mock("@bis/db"' apps/web/src | xargs grep -ln "<module basename>"`. A factory built on `importOriginal` (every pass test, e.g. `reminders.test.ts:7`) already gets the real pure functions; a bare one does not, and `chooseBody` would be `undefined` there.
- **Running tests.** Only the affected tests, by path: `pnpm --filter web exec vitest run "<path>" …`, `pnpm --filter web typecheck`, `pnpm --filter web exec eslint "<touched files>"`. Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) and never Playwright: the orchestrator runs them, one at a time. Never pass the folder `…/accounts/` to vitest (it holds `calls/[callId]/actions.test.ts`, a live test); never run `src/app/f/[publicId]/actions.returning-lead.test.ts` or `weekly-metrics.live.test.ts`. A task that changes a shared function's signature runs every test that references it (`grep -rln "<fn>" apps/web/src`).
- **Nothing sends.** Every pass test runs on the fake gate (`ctx.email.send` / `fakeSmsGate` mocks). No script, REPL or test calls Resend or Telnyx; `getSmsProvider()`/`getEmailProvider()` are touched only by `lib/automations/harness.ts` (`imports.test.ts` scans the rest).
- **Production and bis-ci reads and writes are the orchestrator's, through the Supabase MCP.** No agent connects to either. Counts only in reports; never row contents.
- **Mutating e2e only on the per-run fixture account** (`e2e/.auth/client-fixture.json`), never `Test Client One`; the automations row the spec mutates is restored (or deleted) in `finally`, each error checked. Fake providers only; e2e sends nothing.
- **Commits:** `git add -- <new files>` then `git commit -m "<type>(<scope>): <what and why>" -- <every path>`. Never `-A` or `.`. **Never `git stash`, `git reset`, `git checkout --`, `--amend`.** If `.git/index.lock` exists, wait and retry; never delete it. Never push (the orchestrator pushes). Never touch `main`. Trailer lines on every commit: `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
- **Never** apply a migration, run SQL that writes to a shared project, mutate Test Client One, create or edit `.env*`, call a real provider, place or answer a call, or send a message.

## Where this plan departs from the spec's wording (the source decided)

1. **`textCovers` reads `getAutomation`, not `listEnabled`** (spec §11.3 names `listEnabled`, `automations.ts:80-90`). `listEnabled` is module-private and returns every enabled account; the reminders pass needs one boolean per account for LATE rows only. `getAutomation(db, accountId, "sms_reminder")` (`automations.ts:32`, exported) is the same row, read once per account per tick and cached beside the SMS gate, exactly as `passes/sms-reminder.ts:80-101` caches `resolveSmsSender`.
2. **`DueReminder` gains `contactPhone`** (spec §11.3 says "the contact has a textable phone" without naming where it comes from). `REMINDER_SELECT`'s contact embed (`booking.ts:1321-1322`) adds `phone` and `language`; `normalisePhone` judges it in the pass, as the text pass does (`sms-reminder.ts:84`).
3. **A fourth pure function, `nextSpanishBox`,** beside the spec's three (§10.2). The save rule (C13 "equals our default → null", §12.3's basis rule) is needed by three actions owned by three agents (automations, calendar, voice); one function keeps them identical. It also resolves a collision the spec does not see (finding F1 below): it keeps a stored value when the submitted text equals it, BEFORE comparing with our default, and honours an explicit "Use our Spanish" flag.
4. **The appointment confirmation's "our Spanish default" is the empty string.** Its English has no default either (`appointment-confirm-copy.ts:36-38`: a blank closing line sends the question alone). So the box opens empty, "emptied" is shown only when the STORED value is `''` (Q1's rows), and "Use our Spanish" posts `body_es_use_ours=1` (finding F1).
5. **The staleness line reads the STORED row** (spec §12.2 does not say stored or live). A warning that flickered while typing would warn about an edit not yet saved; the stored row is what Spanish customers receive now. The "emptied" line is live (it describes what Save will store) except on the confirmation card (deviation 4).
6. **English length is validated on `followup_body` and `textback_body` for the first time** (PR 1 plan deviation 2: neither has any check). Both languages ≤ `AUTOMATION_BODY_MAX_LENGTH` (1,000, `lib/automations/caps.ts`), message `automations.bodyTooLong`. A stored English already longer would be refused on its next save; Task 21 step 2 reads the longest stored values read-only before merge and stops the merge if any exceeds 1,000.
7. **The follow-up's default moves into the catalogue as `email.followup.defaultBody`**; `DEFAULT_FOLLOWUP_BODY` stays exported from `followup.ts` as `m["email.followup.defaultBody"]`, so `calendar/actions.ts:122`'s collapse-to-empty comparison is unchanged.
8. **The reminder email's four strings get catalogue keys** (`email.reminder.subject`, `.intro`, `.join`, `.cancel`) rather than a `REMINDER_COPY` table in `booking.ts` (spec §11.1). The catalogue is where the ratchet and the GSM/milestone guards look; `CONFIRMATION_COPY` (`booking.ts:12-33`) predates that and is left alone (Q5's tú → usted pass owns it).
9. **The business-cancel dialog (C18) pre-selects from the booking list's own row**, which already embeds the contact (`booking.ts:872`): the embed adds `language`, the page passes `accounts.language`, and `initialDraft(locale)` takes the resolved one. The owner still chooses.
10. **A Spanish date in a text is folded; the brand name and the operator's own words are not.** `gsmFoldVowels` is applied to the `{when}` string only (spec §13: "the date inside a Spanish text is folded"). Folding a customer's chosen words would rewrite them; the accent-cost line (§12.2) tells the operator what their own accents cost instead.

## Spec findings (raised to the orchestrator; resolved here as stated)

- **F1 (C13 vs the confirmation card).** C13 says an empty Spanish box is `''` (emptied) AND that a box equal to our default is stored `null`. For `appointment_confirm` our Spanish default IS empty, so an untouched box matches both rules; the naive order (`=== default → null` first) would silently turn Q1's `''` rows into `null` on any unrelated save of that card, switching their Spanish customers from English to Spanish. Resolution: deviation 3's ordering (unchanged → keep; then use-ours → null; then `=== default` → null; then `''`).
- **F2 (the guarded Q1 re-run is safe only BEFORE PR 2 is live).** The orchestrator's guard (`body_es is null and body_es_basis is null`) correctly skips anything PR 2's UI wrote. But once PR 2 is live, an operator who saves ONLY a new English while keeping our Spanish leaves exactly `body_es null, body_es_basis null`, and a re-run would flip that row to `''` (English for Spanish customers) behind their back. Task 21 therefore runs it once, as the last step before the merge, and the ledger line says "never re-run after PR 2 deploys".
- **F3 (the window between the re-run and the deploy).** An English saved by the OLD build after the re-run leaves `body_es null`: its Spanish customers get our Spanish default once PR 2 is live, and the card shows it stale (basis null ≠ body). Small (minutes), visible, and said to the owner in the PR body.
- **F5 (the opt-out line is tú).** `sms.optOut.es` is "Responde STOP para cancelar." (`messages.ts:1807`), so every Spanish usted text from this PR ends in a tú sentence. Known and decided (Q5: the opt-out line converts LAST, after its carrier wording is checked); this PR does not touch it. Named in the PR body.
- **F4 (spec §16.2's "probe: drop the gate's language → an English footer under a Spanish body").** The pass tests mock the gate (`ctx.email.send`), so a missing `language` is caught as `language: undefined` in the gate's call, not as footer text. The probe is kept; the assertion is on the gate's argument.

## File Structure

**Created**

| Path | Owner | Responsibility |
|---|---|---|
| `packages/db/src/recipient-language.test.ts` | bis-comms | the four pure functions' truth tables |
| `apps/web/src/lib/i18n/spanish-sms-gsm.test.ts` | bis-comms | every Spanish SMS key is GSM-7; every new customer key has a real Spanish twin |
| `apps/web/src/components/spanish-body-field.tsx` (+ `.test.ts`) | bis-frontend | the Spanish box, its line, Use our Spanish, its preview and count |
| `apps/web/e2e/automations-spanish.spec.ts` | bis-e2e-qa | the review card's box: our Spanish, stale, emptied, Use our Spanish |

**Modified:** `packages/db/src/{messaging,booking,automations,index}.ts`; `packages/db/src/test/{booking,automations,due-by-id}.test.ts`; `apps/web/src/lib/sms/segments.ts` (+ test); `apps/web/src/lib/messages.ts`; `apps/web/src/lib/email/templates/{booking,followup,review-request,no-show-nudge}.ts` (+ tests, `brand-name-parity.test.ts`); the eight `lib/automations/*-copy.ts` (+ tests); the nine `lib/automations/passes/*.ts` named above (+ tests); `lib/booking/reminder-timing.ts` (+ test); `lib/automations/cron-coupling.test.ts`; `lib/voice/{textback,finish-call}.ts` (+ tests); `app/api/voice/incoming/route.ts`; `app/api/voice/texml/handoff-result/route.ts`; `…/accounts/automations/*`; `…/accounts/calendar/*` (named above); `…/accounts/voice/{voice-settings.tsx,actions.ts}` (+ tests); `lib/contacts/language.ts` (+ test); `…/accounts/contacts/[contactId]/page.tsx`; `…/summary/route.ts` (+ test); `app/b/[publicId]/actions.test.ts`; `app/(dashboard)/dashboard/styleguide/page.tsx`; `lib/i18n/{catalogue,ratchet}-baseline.json`.

## Task list, owners, order

| # | Task | Owner | Review | Depends on | Files (disjoint per wave) |
|---|---|---|---|---|---|
| 0 | Confirm the base | orchestrator | n/a | — | none |
| 1 | `recipientLanguage`, `chooseBody`, `spanishIsStale`, `nextSpanishBox` | bis-comms | **opus** | 0 | `packages/db/src/messaging.ts`, `recipient-language.test.ts`, `index.ts` |
| 2 | `gsmFoldVowels` and `accentCost` | bis-comms | sonnet | 0 | `lib/sms/segments*` |
| 3 | Every key (**messages.ts, the only writer**) and the Spanish-SMS guard | bis-comms | sonnet | 0 | `lib/messages.ts`, `lib/i18n/spanish-sms-gsm.test.ts` |
| 4 | Templates take a locale (reminder, follow-up, review, no-show) | bis-comms | sonnet | 3 | `lib/email/templates/{booking,followup,review-request,no-show-nudge}*`, `brand-name-parity.test.ts` |
| 5 | Copy modules take a language | bis-comms | sonnet | 3 | the eight `lib/automations/*-copy*` |
| 6 | `@bis/db` booking side: account language, `DueReminder`/`DueFollowup` language, calendar box columns, the list's contact language | bis-booking | **opus** | 1 | `packages/db/src/booking.ts`, `test/booking.test.ts` |
| 7 | `@bis/db` automations side: `body_es` on the row, the due-rows' `language` and `bodyEs` | bis-automations | **opus** | 1, 6 | `packages/db/src/automations.ts`, `test/automations.test.ts`, `test/due-by-id.test.ts` |
| 8 | The follow-up pass + the in-the-moment pin | bis-booking | sonnet | 1, 4, 6 | `passes/followups*`, `app/b/[publicId]/actions.test.ts` |
| 9 | The reminder email and text reminder passes, and the appointment confirmation pass | bis-automations | **opus** | 1, 2, 4, 5, 6, 7 | `passes/{reminders,sms-reminder,appointment-confirm}*` |
| 10 | Review request and no-show nudge passes | bis-automations | sonnet | 1, 4, 5, 7 | `passes/{review-request,no-show-nudge}*` |
| 11 | Referral ask, reactivation and quote follow-up passes | bis-automations | sonnet | 1, 5, 7 | `passes/{referral-ask,reactivation,quote-followup}*` |
| 12 | The text-back's Spanish box at send | bis-voice | sonnet | 1, 3 | `lib/voice/{textback,finish-call}*`, `api/voice/incoming/route.ts`, `api/voice/texml/handoff-result/route.ts` |
| 13 | The late-booking 08:00 reminder (Q3) | bis-booking | **opus** | 9 | `lib/booking/reminder-timing*`, `passes/reminders*`, `cron-coupling.test.ts`, one comment in `packages/db/src/booking.ts` |
| 14 | `SpanishBodyField` + `/styleguide` | bis-frontend | **opus** | 1, 2, 3 | `components/spanish-body-field*`, `styleguide/page.tsx` |
| 15 | Spanish boxes, cards A: review, no-show, text reminder, confirmation (cards + actions) | bis-automations | **opus** | 5, 7, 14 | `…/automations/{actions*,automations-settings*,no-show-nudge-card*,sms-reminder-card*,appointment-confirm-card*,page*}` |
| 16 | Spanish boxes, cards B: referral, reactivation, quote | bis-automations | sonnet | 15 | `…/automations/{actions*,referral-ask-card*,reactivation-card*,quote-followup-card*,page*}` |
| 17 | The calendar follow-up's box and the cancel dialog's pre-selection (C18) | bis-booking | sonnet | 4, 6, 14 | `…/calendar/*` (named) |
| 18 | The text-back card's box | bis-voice | sonnet | 12, 14 | `…/voice/{voice-settings*,actions*}` |
| 19 | "Not set" names the account's language again | bis-crm | sonnet | 3 | `lib/contacts/language*`, `[contactId]/page.tsx`, `…/summary/route*` |
| 20 | Regenerate the i18n baselines | bis-comms | sonnet | 3, 14–19 | `lib/i18n/*-baseline.json` |
| 21 | Rollout: Q10, length read, the guarded Q1 re-run, gates, merge | orchestrator | n/a | 22 | none in the repo |
| 22 | e2e | bis-e2e-qa | sonnet | 15, 20 | `apps/web/e2e/automations-spanish.spec.ts` |
| 23 | Whole-branch final review (checkpoint) | reviewer | **opus** | 8–20, 22 | none |

(Task 21 is listed before 22 by number only; it runs LAST, after Task 23.)

**Dependency graph (lanes on disjoint files, 2–3 at a time).**

```
Wave A (three lanes):  T1 (bis-comms)            T2 (bis-comms, 2nd instance)   T3 (bis-comms, 3rd instance)
Wave B (three lanes):  T6 (bis-booking, after T1)   T4 (bis-comms, after T3)   T5 (bis-comms, after T3)
Wave C (three lanes):  T7 (bis-automations, after T1+T6)   T14 (bis-frontend, after T1+T2+T3)   T19 (bis-crm, after T3)
Wave D (three lanes):  T9 (bis-automations, after T2,T4,T5,T7)   T8 (bis-booking, after T4+T6)   T12 (bis-voice, after T1+T3)
Wave E (three lanes):  T10 (bis-automations, after T7)   T11 (bis-automations, 2nd instance, after T7)   T13 (bis-booking, after T9)
Wave F (three lanes):  T15 (bis-automations, after T14)   T17 (bis-booking, after T14)   T18 (bis-voice, after T12+T14)
Wave G:                T16 (bis-automations, after T15)
Wave H:                T20 (after T3, T14–T19)
Wave I:                T22 (after T15, T20)
Checkpoint:            T23
Rollout:               T21 (orchestrator, LAST)
```

Disjointness: T9, T10, T11 each touch only their own `passes/*` files. T13 touches `reminders.ts` only after T9 committed (the shared-files order). T15 and T16 share `actions.ts`/`page.tsx` and therefore run in sequence. T17 (`calendar/*`) and T18 (`voice/*`) never touch an automations file. T19 touches no file any other task touches. T4 and T5 are disjoint (`email/templates` vs `automations/*-copy`).

---

## Task 0: Confirm the base (orchestrator)

- [ ] **Step 1.** In `<WT>`: `git log --oneline -2` → `<plan commit>`, `f47e27ca Every customer has a language on their record …`. `git fetch origin && git log --oneline origin/main -1`; if `main` moved, `git merge origin/main` (never rebase in the shared tree) and re-run Step 2.
- [ ] **Step 2.** Confirm, and stop if any line differs:
  - `ls packages/db/supabase/migrations | tail -1` → `0076_customer_language.sql`.
  - `grep -n "body_es" packages/db/supabase/migrations/0076_customer_language.sql | head -2` → `143:` and `158:`.
  - `grep -c "recipientLanguage" packages/db/src/messaging.ts` → `0`.
  - `grep -n "subject: \"Reminder: your upcoming booking\"" apps/web/src/lib/automations/passes/reminders.ts` → `95:`.
  - `grep -n "export function reminderDeadline" apps/web/src/lib/booking/reminder-timing.ts` → `29:`.
  - `grep -n '"contact.language.notSet"' apps/web/src/lib/messages.ts` → `734:`.
  - `grep -n "sumUnreadCount, searchConversations } from \"./messaging\";" packages/db/src/index.ts` → `55:`.
  - The ledger holds `0076 APPLIED TO PROD 2026-10-13 … NEVER RE-APPLY` and the parity line.

---

## Task 1: The four pure functions (bis-comms)

**Review:** opus. **Runs beside:** Tasks 2 and 3.

**Files**
- Modify: `packages/db/src/messaging.ts` (append after the last function, `searchConversations`, `:820-868`)
- Create: `packages/db/src/recipient-language.test.ts`
- Modify: `packages/db/src/index.ts:55` (one line after it)

**Interfaces**
- Consumes: nothing (pure).
- Produces (exact names every later task imports from `@bis/db`):
  - `export type RecipientLanguage = "en" | "es";`
  - `export function recipientLanguage(contactLanguage: string | null | undefined, accountLanguage: string | null | undefined): RecipientLanguage`
  - `export type BodyDefaults = { en: string; es: string };`
  - `export function chooseBody(input: { language: RecipientLanguage; body: string; bodyEs: string | null; defaults: BodyDefaults }): { language: RecipientLanguage; text: string }`
  - `export function spanishIsStale(input: { body: string; bodyEs: string | null; bodyEsBasis: string | null }): boolean`
  - `export function nextSpanishBox(input: { submitted: string; useOurs: boolean; stillMatches: boolean; defaultEs: string; body: string; stored: { bodyEs: string | null; basis: string | null } }): { bodyEs: string | null; basis: string | null }`

- [ ] **Step 1: Write the failing test** `packages/db/src/recipient-language.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { recipientLanguage, chooseBody, spanishIsStale, nextSpanishBox } from "./messaging";

/** S-09 PR 2, spec §10.2, §12.3, C11-C14. Pure: no database (global-setup still runs for the package). */
const D = { en: "Our English.", es: "Nuestro español." };

describe("recipientLanguage (L3, C12)", () => {
  it("the contact's, else the account's, else English (mutation: account before contact -> FAILS)", () => {
    expect(recipientLanguage("en", "es")).toBe("en");
    expect(recipientLanguage("es", "en")).toBe("es");
    expect(recipientLanguage(null, "es")).toBe("es");
    expect(recipientLanguage(undefined, null)).toBe("en");
  });
  it("a stored value outside en/es is not a language (mutation: return contactLanguage as-is -> FAILS)", () => {
    expect(recipientLanguage("fr", null)).toBe("en");
    expect(recipientLanguage("fr", "es")).toBe("es");
    expect(recipientLanguage(null, "pt")).toBe("en");
  });
});

describe("chooseBody (C11, C13)", () => {
  it("English: theirs trimmed, else ours", () => {
    expect(chooseBody({ language: "en", body: "  Theirs.  ", bodyEs: "Suyo.", defaults: D })).toEqual({ language: "en", text: "Theirs." });
    expect(chooseBody({ language: "en", body: "   ", bodyEs: "Suyo.", defaults: D })).toEqual({ language: "en", text: "Our English." });
  });
  it("Spanish: null is our Spanish (mutation: null -> English -> FAILS)", () => {
    expect(chooseBody({ language: "es", body: "Theirs.", bodyEs: null, defaults: D })).toEqual({ language: "es", text: "Nuestro español." });
  });
  it("Spanish emptied: the WHOLE message switches to English, not just the body (mutation: return language 'es' -> FAILS)", () => {
    expect(chooseBody({ language: "es", body: " Theirs. ", bodyEs: "  ", defaults: D })).toEqual({ language: "en", text: "Theirs." });
    expect(chooseBody({ language: "es", body: "", bodyEs: "", defaults: D })).toEqual({ language: "en", text: "Our English." });
  });
  it("Spanish written: theirs, trimmed", () => {
    expect(chooseBody({ language: "es", body: "x", bodyEs: "  Suyo.  ", defaults: D })).toEqual({ language: "es", text: "Suyo." });
  });
});

describe("spanishIsStale (§12.3, C14)", () => {
  it("emptied never warns (mutation: drop the first line -> FAILS)", () => {
    expect(spanishIsStale({ body: "New English.", bodyEs: "", bodyEsBasis: null })).toBe(false);
  });
  it("our English beside our Spanish never warns (mutation: drop the second line -> FAILS)", () => {
    expect(spanishIsStale({ body: "  ", bodyEs: null, bodyEsBasis: null })).toBe(false);
  });
  it("a custom English beside our Spanish warns until someone writes Spanish or ticks the box", () => {
    expect(spanishIsStale({ body: "Custom.", bodyEs: null, bodyEsBasis: null })).toBe(true);
    expect(spanishIsStale({ body: "Custom.", bodyEs: null, bodyEsBasis: "Custom." })).toBe(false);
  });
  it("a written Spanish beside a later English warns; beside its own English it does not (mutation: compare bodyEs with body -> FAILS)", () => {
    expect(spanishIsStale({ body: "New.", bodyEs: "Viejo.", bodyEsBasis: "Old." })).toBe(true);
    expect(spanishIsStale({ body: "Old.", bodyEs: "Viejo.", bodyEsBasis: "Old." })).toBe(false);
  });
});

describe("nextSpanishBox (C13 on save, §12.3's basis rule, plan deviation 3)", () => {
  const base = { useOurs: false, stillMatches: false, defaultEs: "Nuestro español.", body: "New English." };
  it("a box equal to our default stores null, and the basis does not move (mutation: store the literal -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, submitted: " Nuestro español. ", stored: { bodyEs: null, basis: "Old English." } }))
      .toEqual({ bodyEs: null, basis: "Old English." });
  });
  it("a changed Spanish moves the basis to the new English (mutation: never move it -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, submitted: "Suyo nuevo.", stored: { bodyEs: "Suyo.", basis: "Old English." } }))
      .toEqual({ bodyEs: "Suyo nuevo.", basis: "New English." });
  });
  it("an English-only edit leaves the basis, so the Spanish goes stale (mutation: always move it -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, submitted: "Suyo.", stored: { bodyEs: "Suyo.", basis: "Old English." } }))
      .toEqual({ bodyEs: "Suyo.", basis: "Old English." });
  });
  it("'The Spanish still matches' moves the basis without changing the Spanish", () => {
    expect(nextSpanishBox({ ...base, stillMatches: true, submitted: "Suyo.", stored: { bodyEs: "Suyo.", basis: "Old English." } }))
      .toEqual({ bodyEs: "Suyo.", basis: "New English." });
  });
  it("an emptied box stores '' (emptied, C13)", () => {
    expect(nextSpanishBox({ ...base, submitted: "   ", stored: { bodyEs: null, basis: null } }))
      .toEqual({ bodyEs: "", basis: "New English." });
  });
  it("F1: with an EMPTY default, a stored '' survives an unrelated save (mutation: test the default before 'unchanged' -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, defaultEs: "", submitted: "", stored: { bodyEs: "", basis: null } }))
      .toEqual({ bodyEs: "", basis: null });
  });
  it("F1: Use our Spanish stores null even when our default is empty (mutation: ignore useOurs -> FAILS)", () => {
    expect(nextSpanishBox({ ...base, defaultEs: "", useOurs: true, submitted: "", stored: { bodyEs: "", basis: null } }))
      .toEqual({ bodyEs: null, basis: "New English." });
  });
});
```

- [ ] **Step 2: Run, see it fail.** `pnpm --filter @bis/db exec vitest run src/recipient-language.test.ts` → FAIL, `does not provide an export named 'recipientLanguage'` (or `recipientLanguage is not a function`). Paste the line.
- [ ] **Step 3: Implement** — append to `packages/db/src/messaging.ts`:

```ts
// ---------------------------------------------------------------------------
// S-09 PR 2: the language a scheduled customer message goes out in, and which
// body it sends. Pure; every scheduled due-list's mapper calls
// `recipientLanguage` once (spec C12) and every sender calls `chooseBody`.
// ---------------------------------------------------------------------------

export type RecipientLanguage = "en" | "es";
const asLanguage = (v: string | null | undefined): RecipientLanguage | null => (v === "en" || v === "es" ? v : null);

/** L3: the contact's language, else the account's (0065, its second reader since 0076), else English. */
export function recipientLanguage(
  contactLanguage: string | null | undefined, accountLanguage: string | null | undefined,
): RecipientLanguage {
  return asLanguage(contactLanguage) ?? asLanguage(accountLanguage) ?? "en";
}

export type BodyDefaults = { en: string; es: string };

/**
 * C11 + C13. English: theirs, else ours. Spanish: NULL is our written Spanish; an EMPTIED box
 * ('' after trim) sends the English AND switches the whole message to English, because the
 * returned `language` is the one the subject, date, button and footer follow.
 */
export function chooseBody(input: {
  language: RecipientLanguage; body: string; bodyEs: string | null; defaults: BodyDefaults;
}): { language: RecipientLanguage; text: string } {
  const english = { language: "en" as const, text: input.body.trim() || input.defaults.en };
  if (input.language === "en") return english;
  if (input.bodyEs === null) return { language: "es", text: input.defaults.es };
  const theirs = input.bodyEs.trim();
  return theirs ? { language: "es", text: theirs } : english;
}

/** C14, spec §12.3: a comparison with the English the Spanish was written beside. No clock. */
export function spanishIsStale(input: { body: string; bodyEs: string | null; bodyEsBasis: string | null }): boolean {
  if (input.bodyEs === "") return false;
  if (input.body.trim() === "" && input.bodyEs === null) return false;
  return input.bodyEsBasis !== input.body;
}

/**
 * The save side (plan deviation 3). Order matters (finding F1): an unchanged box keeps what is
 * stored; "Use our Spanish" stores NULL; a box equal to our default stores NULL (the 0024
 * discipline); anything else is theirs, '' meaning emptied. The basis moves to the new English
 * only when the Spanish changed in this save or "The Spanish still matches" was ticked.
 */
export function nextSpanishBox(input: {
  submitted: string; useOurs: boolean; stillMatches: boolean; defaultEs: string; body: string;
  stored: { bodyEs: string | null; basis: string | null };
}): { bodyEs: string | null; basis: string | null } {
  const text = input.submitted.trim();
  let bodyEs: string | null;
  if (input.useOurs) bodyEs = null;
  else if (input.stored.bodyEs !== null && text === input.stored.bodyEs.trim()) bodyEs = input.stored.bodyEs;
  else if (text === input.defaultEs.trim()) bodyEs = null;
  else bodyEs = text;
  const changed = bodyEs !== input.stored.bodyEs;
  return { bodyEs, basis: changed || input.stillMatches ? input.body : input.stored.basis };
}
```

And in `packages/db/src/index.ts`, directly after line 55:

```ts
export { recipientLanguage, chooseBody, spanishIsStale, nextSpanishBox, type RecipientLanguage, type BodyDefaults } from "./messaging";
```

- [ ] **Step 4: Run, see it pass.** Same command → `Tests  N passed (N)` with N = 17. Paste the summary line.
- [ ] **Step 5: Probes, each red BY NAME then edited back:** swap the two `asLanguage(...)` in `recipientLanguage`; return `{ language: "es", text: input.defaults.en }` for the emptied branch; delete `if (input.bodyEs === "") return false;`; move the `text === input.defaultEs.trim()` line above the "unchanged" line (F1's test fails); drop `|| input.stillMatches`. Paste each failing test name.
- [ ] **Step 6: Typecheck.** `pnpm --filter web typecheck` (the barrel line compiles where it is consumed).
- [ ] **Step 7: Commit.**

```bash
cd /c/Users/danlo/bis-platform/.claude/worktrees/s09-pr2 && git add -- packages/db/src/recipient-language.test.ts && git commit -m "feat(sms): one rule for a scheduled message's language and body, and the save side of the Spanish box (S-09 PR 2)" -- packages/db/src/messaging.ts packages/db/src/recipient-language.test.ts packages/db/src/index.ts
```

---

## Task 2: `gsmFoldVowels` and `accentCost` (bis-comms)

**Review:** sonnet. **Runs beside:** Tasks 1 and 3.

**Files**
- Modify: `apps/web/src/lib/sms/segments.ts` (append after `segmentsFor`, `:28-50`)
- Modify: `apps/web/src/lib/sms/segments.test.ts` (append a `describe`)

**Interfaces**
- Produces: `export function gsmFoldVowels(text: string): string` (á→a, í→i, ó→o, ú→u, Á→A, Í→I, Ó→O, Ú→U; nothing else); `export function accentCost(body: string): { parts: number; foldedParts: number } | null` (null when the body has none of the eight).

- [ ] **Step 1: Failing test** (append to `segments.test.ts`; `formatWhen` is imported live so a different ICU on another Node fails here, not on a customer's bill):

```ts
import { gsmFoldVowels, accentCost } from "./segments";
import { formatWhen } from "@/lib/booking/time";

describe("Spanish texts stay one alphabet (spec §13, C19)", () => {
  it("folds exactly the four vowels outside GSM-7 and their capitals; é, ñ, ü, ¿, ¡ stay (mutation: also fold é -> FAILS)", () => {
    expect(gsmFoldVowels("sáb ÁÍÓÚ íóú é ñ ü ¿¡")).toBe("sab AIOU iou é ñ ü ¿¡");
  });
  it("a Saturday in Spanish is GSM-7 once folded (mutation: return text unchanged -> FAILS)", () => {
    const sat = formatWhen(new Date("2026-10-17T14:30:00Z"), "America/Chicago", "es");
    expect(segmentsFor(sat).encoding).toBe("ucs2");
    expect(segmentsFor(gsmFoldVowels(sat)).encoding).toBe("gsm7");
  });
  it("accentCost: the parts with the accents and without; null when there are none (mutation: count the unfolded text twice -> FAILS)", () => {
    const long = "Gracias por su visita, aquí estamos para lo que necesite. ".repeat(2);
    expect(accentCost(long)).toEqual({ parts: segmentsFor(long).segments, foldedParts: segmentsFor(gsmFoldVowels(long)).segments });
    expect(accentCost(long)!.parts).toBeGreaterThan(accentCost(long)!.foldedParts);
    expect(accentCost("Hola, sin acentos.")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, see it fail.** `pnpm --filter web exec vitest run src/lib/sms/segments.test.ts` → FAIL (`gsmFoldVowels is not a function`). Paste.
- [ ] **Step 3: Implement** (append to `segments.ts`):

```ts
/** The four Spanish vowels outside GSM-7 (é, ñ, ü, ¿ and ¡ are inside it, GSM7_BASE above). */
const FOLD: Readonly<Record<string, string>> = { á: "a", í: "i", ó: "o", ú: "u", Á: "A", Í: "I", Ó: "O", Ú: "U" };
const FOLD_RE = /[áíóúÁÍÓÚ]/g;

/**
 * S-09 C19: a Spanish date in a text ("sáb, 17 de oct") would otherwise turn the whole message
 * into UCS-2 at 70 characters a part. Folds ONLY those eight characters; applied to the date we
 * render, never to an operator's own words (plan deviation 10).
 */
export function gsmFoldVowels(text: string): string {
  return text.replace(FOLD_RE, (c) => FOLD[c] ?? c);
}

/** The accent hint (spec §12.2): what the operator's own accents cost, or null when there are none. */
export function accentCost(body: string): { parts: number; foldedParts: number } | null {
  if (!FOLD_RE.test(body)) return null;
  FOLD_RE.lastIndex = 0;
  return { parts: segmentsFor(body).segments, foldedParts: segmentsFor(gsmFoldVowels(body)).segments };
}
```

- [ ] **Step 4: Run, see it pass.** Same command; paste the summary line.
- [ ] **Step 5: Probes** (each red by name, edited back): add `é: "e"` to `FOLD`; make `gsmFoldVowels` return `text`; in `accentCost` return `foldedParts: segmentsFor(body).segments`.
- [ ] **Step 6: Commit.** `git commit -m "feat(sms): fold Spanish vowels out of a texted date and price an operator's accents (S-09 PR 2)" -- apps/web/src/lib/sms/segments.ts apps/web/src/lib/sms/segments.test.ts`

---

## Task 3: Every key, and the Spanish-SMS guard (bis-comms; messages.ts, the only writer)

**Review:** sonnet (plus the owner-facing copy read by the orchestrator: Q5 usted). **Runs beside:** Tasks 1 and 2.

**Files**
- Modify: `apps/web/src/lib/messages.ts` at the lines named below
- Create: `apps/web/src/lib/i18n/spanish-sms-gsm.test.ts`

**Interfaces**
- Produces these exact keys (each with `.es` on the next line). Words are spec §15.1 / §15.2 / §15.3 verbatim; keys this plan names (spec gave only a description) are marked *.
  - **Twins added to existing keys** (`messages.ts:2089-2107`, `:2100-2101`, `:2194-2195`, `:2253-2256`, `:2282-2285`, `:2303-2304`, `:2326-2329`): `automations.review.defaultBody`, `.defaultBodyNoName`; `automations.noShow.defaultBody`, `.defaultBodyNoName`; `automations.smsReminder.lead`, `.leadNoName`, `.defaultBody`; `automations.appointmentConfirm.lead`, `.leadNoName`; `automations.referral.defaultBody`, `.defaultBodyNoName`, `.emailSubject`, `.emailSubjectNoName`; `automations.reactivation.defaultBody`, `.defaultBodyNoName`, `.subject`, `.subjectNoName`, `.footerReason`, `.footerReasonNoName`; `automations.quoteFollowup.defaultBody`, `.defaultBodyNoName`, `.emailSubject`, `.emailSubjectNoName`.
  - **New customer keys** (a new block directly after `automations.quoteFollowup.emailSubjectNoName`, `:2329`): `email.reminder.subject`*, `email.reminder.intro`*, `email.reminder.join`*, `email.reminder.cancel`*, `email.followup.defaultBody`*, `email.followup.subject`*, `email.review.subject`*, `email.review.button`*, `email.noShow.subject`*, `email.noShow.button`*.
  - **New settings keys** (same block): `automations.bodyEn.label`, `automations.bodyEs.label`, `automations.bodyEs.hint`, `automations.bodyEs.stale`, `automations.bodyEs.stillMatches`, `automations.bodyEs.emptied`, `automations.bodyEs.useOurs`, `automations.bodyEs.accentCost`, `automations.previewEs`.
  - **Changed:** `settings.language.description` and its twin (`:967-968`).
  - **Restored (PR 1 final review I-2, plan deviation 10 of PR 1):** `contact.language.notSetAccount`, `contact.language.notSetUnknown`, directly after `contact.language.notSet.es` (`:735`).

- [ ] **Step 1: Failing guard test** `apps/web/src/lib/i18n/spanish-sms-gsm.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { withOptOut } from "@/lib/sms/opt-out";

/** S-09 PR 2, spec §13 and §15: every Spanish text default and lead is one GSM-7 alphabet. */
const SPANISH_SMS = [
  "automations.smsReminder.lead.es", "automations.smsReminder.leadNoName.es", "automations.smsReminder.defaultBody.es",
  "automations.appointmentConfirm.lead.es", "automations.appointmentConfirm.leadNoName.es",
  "automations.review.defaultBody.es", "automations.review.defaultBodyNoName.es",
  "automations.noShow.defaultBody.es", "automations.noShow.defaultBodyNoName.es",
  "automations.quoteFollowup.defaultBody.es", "automations.quoteFollowup.defaultBodyNoName.es",
  "automations.referral.defaultBody.es", "automations.referral.defaultBodyNoName.es",
] as const;

/** Customer-facing keys this PR sends in Spanish: a twin that merely repeats the English would pass the ratchet. */
const CUSTOMER = [
  ...SPANISH_SMS.map((k) => k.slice(0, -3)),
  "automations.referral.emailSubject", "automations.reactivation.defaultBody", "automations.reactivation.subject",
  "automations.reactivation.subjectNoName", "automations.reactivation.footerReason", "automations.quoteFollowup.emailSubject",
  "email.reminder.subject", "email.reminder.intro", "email.reminder.join", "email.reminder.cancel",
  "email.followup.defaultBody", "email.followup.subject", "email.review.subject", "email.review.button",
  "email.noShow.subject", "email.noShow.button",
] as const;

const cat = m as unknown as Record<string, string>;

describe("Spanish texts (spec §13)", () => {
  it.each(SPANISH_SMS)("%s is GSM-7, opt-out line included (mutation: write 'aquí' into it -> FAILS)", (key) => {
    const text = cat[key]!.replace("{name}", "Rio Roofing").replace("{when}", "sab, 17 de oct, 9:30 a.m. CDT");
    expect(segmentsFor(withOptOut(text, "es")).encoding).toBe("gsm7");
  });
});

describe("each customer key has a real Spanish twin (mutation: copy the English into the twin -> FAILS)", () => {
  it.each(CUSTOMER)("%s.es exists and differs from the English", (key) => {
    expect(cat[`${key}.es`], key).toBeTypeOf("string");
    expect(cat[`${key}.es`]).not.toBe(cat[key]);
  });
});
```

- [ ] **Step 2: Run, see it fail.** `pnpm --filter web exec vitest run src/lib/i18n/spanish-sms-gsm.test.ts` → FAIL (`expected undefined to be 'string'` / `Cannot read properties of undefined`). Paste one line.
- [ ] **Step 3: Write the keys.** Twins for existing keys (each directly under its English line):

```ts
  "automations.review.defaultBody.es": "¡Gracias por elegir a {name}! Si tiene un minuto, nos ayuda mucho que nos deje una reseña:",
  "automations.review.defaultBodyNoName.es": "¡Gracias por elegirnos! Si tiene un minuto, nos ayuda mucho que nos deje una reseña:",
  "automations.noShow.defaultBody.es": "Le estuvimos esperando en su cita con {name}. Escoja otro horario en este enlace:",
  "automations.noShow.defaultBodyNoName.es": "Le estuvimos esperando en su cita. Escoja otro horario en este enlace:",
  "automations.smsReminder.lead.es": "Recordatorio: su cita con {name} es el {when}.",
  "automations.smsReminder.leadNoName.es": "Recordatorio: su cita es el {when}.",
  "automations.smsReminder.defaultBody.es": "Si necesita hacer un cambio, responda a este mensaje.",
  "automations.appointmentConfirm.lead.es": "Hola, le escribe {name}. Tiene cita el {when}. Responda SI para confirmar o NO si necesita otro horario. Sea cual sea su respuesta, la vamos a ver.",
  "automations.appointmentConfirm.leadNoName.es": "Tiene cita el {when}. Responda SI para confirmar o NO si necesita otro horario. Sea cual sea su respuesta, la vamos a ver.",
  "automations.referral.defaultBody.es": "Gracias otra vez de parte de {name}. ¿Conoce a alguien que necesite el mismo trabajo? Denos su nombre y su cel y nosotros nos encargamos.",
  "automations.referral.defaultBodyNoName.es": "Gracias otra vez. ¿Conoce a alguien que necesite el mismo trabajo? Denos su nombre y su cel y nosotros nos encargamos.",
  "automations.referral.emailSubject.es": "Un favor, de parte de {name}",
  "automations.referral.emailSubjectNoName.es": "Un favor",
  "automations.reactivation.defaultBody.es": "Hola, le saluda {name}. Ya hace tiempo que no pasamos por su casa. Si algo necesita revisión antes de la temporada, responda este correo y le damos una cita.",
  "automations.reactivation.defaultBodyNoName.es": "Hola. Ya hace tiempo que no pasamos por su casa. Si algo necesita revisión antes de la temporada, responda este correo y le damos una cita.",
  "automations.reactivation.subject.es": "Un saludo de {name}",
  "automations.reactivation.subjectNoName.es": "Pasamos a saludar",
  "automations.reactivation.footerReason.es": "Le llega este correo porque ha sido cliente de {name}. Si prefiere no recibir más mensajes, responda y avísenos.",
  "automations.reactivation.footerReasonNoName.es": "Le llega este correo porque ha sido nuestro cliente. Si prefiere no recibir más mensajes, responda y avísenos.",
  "automations.quoteFollowup.defaultBody.es": "Hola, le escribe {name}. ¿Ya pudo ver el estimado que le mandamos? Con gusto le contestamos cualquier pregunta o lo ajustamos.",
  "automations.quoteFollowup.defaultBodyNoName.es": "¿Ya pudo ver el estimado que le mandamos? Con gusto le contestamos cualquier pregunta o lo ajustamos.",
  "automations.quoteFollowup.emailSubject.es": "Sobre su estimado de {name}",
  "automations.quoteFollowup.emailSubjectNoName.es": "Sobre su estimado",
```

The new block after `automations.quoteFollowup.emailSubjectNoName.es`:

```ts
  // S-09 PR 2: what scheduled customer emails say in each language (spec §15.1). Customer-facing.
  "email.reminder.subject": "Reminder: your upcoming booking",
  "email.reminder.subject.es": "Recordatorio: su próxima cita",
  "email.reminder.intro": "This is a reminder for your upcoming booking.",
  "email.reminder.intro.es": "Le recordamos su próxima cita.",
  "email.reminder.join": "Join your video meeting",
  "email.reminder.join.es": "Entrar a la videollamada",
  "email.reminder.cancel": "Cancel this booking",
  "email.reminder.cancel.es": "Cancelar esta cita",
  "email.followup.defaultBody": "Thanks for coming in! If you have any questions or want to book again, just reply to this email.",
  "email.followup.defaultBody.es": "¡Gracias por su visita! Si tiene alguna pregunta o quiere hacer otra cita, solo responda a este correo.",
  "email.followup.subject": "Thanks from {name}",
  "email.followup.subject.es": "Gracias de parte de {name}",
  "email.review.subject": "Would you leave {name} a review?",
  "email.review.subject.es": "¿Le gustaría dejarle una reseña a {name}?",
  "email.review.button": "Leave a review",
  "email.review.button.es": "Dejar una reseña",
  "email.noShow.subject": "Want to pick a new time with {name}?",
  "email.noShow.subject.es": "¿Quiere escoger otro horario con {name}?",
  "email.noShow.button": "Pick a new time",
  "email.noShow.button.es": "Escoger otro horario",
  // S-09 PR 2: the Spanish box on every editable message (spec §15.3). Agency chrome renders English; twinned for the ratchet.
  "automations.bodyEn.label": "English message",
  "automations.bodyEn.label.es": "Mensaje en inglés",
  "automations.bodyEs.label": "Spanish message",
  "automations.bodyEs.label.es": "Mensaje en español",
  "automations.bodyEs.hint": "Sent to customers whose language is Spanish. It starts as our Spanish; change it to say what your English says.",
  "automations.bodyEs.hint.es": "Se manda a los clientes que hablan español. Empieza con nuestro mensaje en español; cámbielo para que diga lo mismo que su mensaje en inglés.",
  "automations.bodyEs.stale": "The Spanish still says the old message. Update it to match your English.",
  "automations.bodyEs.stale.es": "El mensaje en español todavía dice lo de antes. Actualícelo para que diga lo mismo que el de inglés.",
  "automations.bodyEs.stillMatches": "The Spanish still matches",
  "automations.bodyEs.stillMatches.es": "El español todavía coincide",
  "automations.bodyEs.emptied": "Customers whose language is Spanish will get the English message.",
  "automations.bodyEs.emptied.es": "Los clientes que hablan español recibirán el mensaje en inglés.",
  "automations.bodyEs.useOurs": "Use our Spanish",
  "automations.bodyEs.useOurs.es": "Usar nuestro español",
  "automations.bodyEs.accentCost": "Accents on á, í, ó or ú make this text cost {n} parts instead of {m}.",
  "automations.bodyEs.accentCost.es": "Los acentos en á, í, ó o ú hacen que este texto cueste {n} partes en vez de {m}.",
  "automations.previewEs": "Spanish preview",
  "automations.previewEs.es": "Vista previa en español",
```

Replace `messages.ts:967-968`:

```ts
  "settings.language.description": "Changes the language your client sees when they sign in and their alert texts, and the language automatic messages go out in to customers whose language we don't know yet. Agency staff stay in English.",
  "settings.language.description.es": "Cambia el idioma que ve su cliente al iniciar sesión y sus mensajes de aviso, y el idioma de los mensajes automáticos a los clientes de quienes todavía no sabemos el idioma. El personal de la agencia sigue en inglés.",
```

After `contact.language.notSet.es` (`:735`), and update the comment above `:729` to say the account clause is live from PR 2:

```ts
  "contact.language.notSetAccount": "Not set. Messages go out in {language}, the account's language.",
  "contact.language.notSetAccount.es": "Sin definir. Los mensajes salen en {language}, el idioma de la cuenta.",
  "contact.language.notSetUnknown": "Not set.",
  "contact.language.notSetUnknown.es": "Sin definir.",
```

- [ ] **Step 4: Run, see it pass**, then the catalogue's own guards and every test that pins a changed string: `pnpm --filter web exec vitest run src/lib/i18n/spanish-sms-gsm.test.ts src/lib/messages.test.ts src/lib/i18n/ratchet.test.ts` and `grep -rln "Changes the language your client sees" apps/web/src` → run each hit. Expected: `ratchet.test.ts` may report the frozen list shrank (free) and the baseline is regenerated only in Task 20; anything else red is a real failure. Paste the summary lines.
- [ ] **Step 5: Probes:** write `aquí` into `automations.smsReminder.defaultBody.es` (the GSM case fails by name); set `email.review.button.es` to `"Leave a review"` (the twin case fails); edit back.
- [ ] **Step 6: Commit.** `git commit -m "feat(sms): Spanish for every scheduled customer message, the Spanish box's words, and the account-language sentences (S-09 PR 2)" -- apps/web/src/lib/messages.ts apps/web/src/lib/i18n/spanish-sms-gsm.test.ts` (after `git add -- apps/web/src/lib/i18n/spanish-sms-gsm.test.ts`).

---

## Task 4: Templates take a locale (bis-comms)

**Review:** sonnet. **Depends on:** Task 3.

**Files**
- Modify: `apps/web/src/lib/email/templates/booking.ts:1-11` (file comment), `:318-375` (`BookingReminderInput`, `bookingReminderEmail`), plus a new `bookingReminderSubject`
- Modify: `apps/web/src/lib/email/templates/followup.ts:1-58`
- Modify: `apps/web/src/lib/email/templates/review-request.ts:4-25`
- Modify: `apps/web/src/lib/email/templates/no-show-nudge.ts:4-22`
- Modify: their four `.test.ts` files; `brand-name-parity.test.ts` (add a Spanish render per template)

**Interfaces**
- Produces: `bookingReminderSubject(locale: PublicLocale = "en"): string`; `BookingReminderInput.locale?: PublicLocale`; `BookingFollowupInput.locale?: PublicLocale`; `ReviewRequestEmailInput.locale?: PublicLocale`; `NoShowNudgeEmailInput.locale?: PublicLocale`; `DEFAULT_FOLLOWUP_BODY` (unchanged name and English value, now read from the catalogue); `defaultFollowupBody(locale: PublicLocale): string`. Every `locale` defaults to `"en"`, so every caller not yet migrated compiles and sends exactly today's English.

- [ ] **Step 1: Failing tests.** Append to `booking.test.ts`:

```ts
import { bookingReminderEmail, bookingReminderSubject } from "./booking";

describe("the reminder in Spanish (spec §11.1, C11)", () => {
  const brand = { name: "Rio Roofing", logoUrl: null, color: "#6D28D9" } as Parameters<typeof bookingReminderEmail>[0]["brand"];
  it("subject, intro, video button and cancel link are Spanish when locale is es (mutation: ignore locale -> FAILS)", () => {
    expect(bookingReminderSubject("es")).toBe("Recordatorio: su próxima cita");
    expect(bookingReminderSubject()).toBe("Reminder: your upcoming booking");
    const { html, text } = bookingReminderEmail({ brand, whenBookerZone: "sáb, 17 de oct", cancelUrl: "https://x/c?locale=es", meetingUrl: "https://m", locale: "es" });
    expect(text).toContain("Le recordamos su próxima cita.");
    expect(text).toContain("Entrar a la videollamada: https://m");
    expect(text).toContain("Cancelar esta cita: https://x/c?locale=es");
    expect(html).toContain("Entrar a la videollamada");
    expect(text).not.toMatch(/reminder|Cancel this/);
  });
  it("no locale is today's English, byte for byte (mutation: default to es -> FAILS)", () => {
    const { text } = bookingReminderEmail({ brand, whenBookerZone: "Sat, Oct 17", cancelUrl: "https://x/c" });
    expect(text).toBe("This is a reminder for your upcoming booking.\n\nSat, Oct 17\n\nCancel this booking: https://x/c");
  });
});
```

(Read the existing `booking.test.ts` for its `brand` fixture and use it instead of the cast if one exists; the cast above is the fallback shape of `EmailBrand`, **Assumption** until read.) Append to `followup.test.ts`: `bookingFollowupEmail({ brand, body: "", locale: "es" })` → `subject` `"Gracias de parte de Rio Roofing"`, `text` `"¡Gracias por su visita! Si tiene alguna pregunta o quiere hacer otra cita, solo responda a este correo."`; `locale: "es"` with `body: "Suyo."` → `text` `"Suyo."` (the operator's words never translated); no locale → `DEFAULT_FOLLOWUP_BODY` and `"Thanks from Rio Roofing"` (mutation: default body ignores locale → FAILS). Append to `review-request.test.ts`: `reviewRequestEmail({ brand, body: "b", reviewUrl: "https://r", locale: "es" })` → `subject` `"¿Le gustaría dejarle una reseña a Rio Roofing?"`, `html` contains `"Dejar una reseña"` (mutation: hard-coded button → FAILS). Append to `no-show-nudge.test.ts`: `subject` `"¿Quiere escoger otro horario con Rio Roofing?"`, `html` contains `"Escoger otro horario"`. In `brand-name-parity.test.ts`, add each of the four templates rendered with `locale: "es"` to whatever list it iterates (read the file; its rule is that every template shows `brandDisplayName`, never `accounts.name`).

- [ ] **Step 2: Run, see them fail.** `pnpm --filter web exec vitest run src/lib/email/templates/booking.test.ts src/lib/email/templates/followup.test.ts src/lib/email/templates/review-request.test.ts src/lib/email/templates/no-show-nudge.test.ts src/lib/email/templates/brand-name-parity.test.ts` → FAIL on the new cases. Paste one line per file.
- [ ] **Step 3: Implement.** In `booking.ts` add `import { m } from "@/lib/messages"; import { t } from "@/lib/i18n/t";`, rewrite the file comment (`:4-11`): "The confirmation, the reschedule and the cancellation a phone call sends follow the language of the moment (the page, the call). The reminder follows the customer's own language (S-09 PR 2: the contact's, else the account's, else English), resolved by the due-list. The alert stays English: it is for the operator." Then:

```ts
export function bookingReminderSubject(locale: PublicLocale = "en"): string {
  return t(m, "email.reminder.subject", locale);
}

export type BookingReminderInput = {
  brand: EmailBrand;
  /** Pre-formatted in the booker's own zone, IN `locale` (formatWhen's third argument). */
  whenBookerZone: string;
  cancelUrl: string;
  meetingUrl?: string;
  /** S-09 PR 2: the customer's language. One message, one language (C11). English by default. */
  locale?: PublicLocale;
};

export function bookingReminderEmail(input: BookingReminderInput): { html: string; text: string } {
  const locale = input.locale ?? "en";
  const join = t(m, "email.reminder.join", locale);
  const cancel = t(m, "email.reminder.cancel", locale);
  const intro = t(m, "email.reminder.intro", locale);
  const meetingHtml = input.meetingUrl
    ? `<p style="margin:0 0 16px;">${button(input.brand, input.meetingUrl, join)}</p>` : "";
  const cancelHtml = input.cancelUrl
    ? `<p style="margin:0;"><a href="${escapeHtml(input.cancelUrl)}" style="color:#71717a;">${escapeHtml(cancel)}</a></p>` : "";
  const html = shell(input.brand, `
    <p style="margin:0 0 12px;">${escapeHtml(intro)}</p>
    <p style="margin:0 0 16px;font-size:16px;">${escapeHtml(input.whenBookerZone)}</p>
    ${meetingHtml}
    ${cancelHtml}
  `);
  const text = [
    intro, "", input.whenBookerZone,
    ...(input.meetingUrl ? ["", `${join}: ${input.meetingUrl}`] : []),
    ...(input.cancelUrl ? ["", `${cancel}: ${input.cancelUrl}`] : []),
  ].join("\n");
  return { html, text };
}
```

(Keep the existing doc comment above `bookingReminderEmail`; the inline `color:#71717a` is the existing email literal, `booking.ts:351`, emails cannot read tokens.) In `followup.ts`:

```ts
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import type { PublicLocale } from "@/lib/forms/public-strings";
// BookingFollowupInput gains:  locale?: PublicLocale;
export const DEFAULT_FOLLOWUP_BODY: string = m["email.followup.defaultBody"];
export function defaultFollowupBody(locale: PublicLocale): string {
  return t(m, "email.followup.defaultBody", locale);
}
// inside bookingFollowupEmail:
  const locale = input.locale ?? "en";
  const raw = input.body.trim() ? input.body : defaultFollowupBody(locale);
  // …unchanged paragraphs/html/text…
  return { subject: t(m, "email.followup.subject", locale, { name: input.brand.name }), html, text };
```

`review-request.ts`: `const locale = input.locale ?? "en";` then `proseWithButton(input.brand, input.body, input.reviewUrl, t(m, "email.review.button", locale))` and `subject: t(m, "email.review.subject", locale, { name: input.brand.name })`. `no-show-nudge.ts` the same with `email.noShow.button` / `email.noShow.subject`. (`t`'s interpolation uses a replacer function, `t.ts`, so a `$&` in a brand name is literal, as the templates' template strings were.)
- [ ] **Step 4: Run, see them pass** (same command) and every test that references the four functions: `grep -rln "bookingReminderEmail\|bookingFollowupEmail\|reviewRequestEmail\|noShowNudgeEmail\|DEFAULT_FOLLOWUP_BODY" apps/web/src` → run each. Paste the summary lines.
- [ ] **Step 5: Probes:** hard-code `"Join your video meeting"` again (the Spanish case fails); default `locale` to `"es"` (the byte-for-byte English case fails); in `followup.ts` use `DEFAULT_FOLLOWUP_BODY` for every locale (the Spanish default case fails). Sibling: hard-code `"Leave a review"` in `review-request.ts` (fails) — then the same in `no-show-nudge.ts`.
- [ ] **Step 6: Commit.** `git commit -m "feat(sms): the reminder, follow-up, review and no-show emails speak the customer's language end to end (S-09 PR 2)" -- <the four templates and five tests>`

---

## Task 5: Copy modules take a language (bis-comms)

**Review:** sonnet. **Depends on:** Task 3. **Runs beside:** Task 4.

**Files** (each `.ts` and its `.test.ts`): `lib/automations/sms-reminder-copy.ts:10-29`, `appointment-confirm-copy.ts:23-38`, `review-request-copy.ts:14-17`, `no-show-nudge-copy.ts:12-17`, `quote-followup-copy.ts:14-30`, `referral-ask-copy.ts:18-35`, `reactivation-copy.ts:12-27`, `marketing-copy.ts:19-…`.

**Interfaces** (every new `language` parameter is LAST and defaults to `"en"`, so today's callers keep compiling and keep English until their pass task migrates them):
- `smsReminderLead(brandName, whenText, language = "en")`, `defaultSmsReminderBody(language = "en")`, `composeSmsReminder(brandName, whenText, body, language = "en")`
- `appointmentConfirmLead(brandName, whenText, language = "en")`, `composeAppointmentConfirm(brandName, whenText, body, language = "en")`
- `defaultReviewRequestBody(brandName, language = "en")`, `defaultNoShowNudgeBody(brandName, language = "en")`, `defaultQuoteFollowupBody(brandName, language = "en")`, `quoteFollowupSubject(brandName, language = "en")`, `defaultReferralAskBody(brandName, language = "en")`, `referralAskSubject(brandName, language = "en")`, `defaultReactivationBody(brandName, language = "en")`, `reactivationSubject(brandName, language = "en")`, `marketingFooterReason(brandName, language = "en")`
- **The date is folded inside the two text leads when `language === "es"`** (`gsmFoldVowels(whenText)`, plan deviation 10), so no pass can forget it.

- [ ] **Step 1: Failing tests.** In `sms-reminder-copy.test.ts`:

```ts
import { formatWhen } from "@/lib/booking/time";
import { segmentsFor } from "@/lib/sms/segments";
import { smsReminderLead, defaultSmsReminderBody, composeSmsReminder } from "./sms-reminder-copy";

describe("the text reminder in Spanish (spec §11.2, §13)", () => {
  const sat = formatWhen(new Date("2026-10-17T14:30:00Z"), "America/Chicago", "es");
  it("the lead and the default are Spanish, and the Saturday is folded to GSM-7 (mutation: no gsmFoldVowels -> FAILS)", () => {
    expect(smsReminderLead("Rio Roofing", sat, "es")).toBe("Recordatorio: su cita con Rio Roofing es el sab, 17 de oct, 9:30 a.m. CDT.");
    expect(defaultSmsReminderBody("es")).toBe("Si necesita hacer un cambio, responda a este mensaje.");
    expect(segmentsFor(composeSmsReminder("Rio Roofing", sat, defaultSmsReminderBody("es"), "es")).encoding).toBe("gsm7");
  });
  it("English is unchanged and never folded (mutation: fold for every language -> an English 'é' brand would change; here the English lead is byte-for-byte)", () => {
    expect(smsReminderLead("Rio Roofing", "Sat, Oct 17, 9:30 AM CDT")).toBe("Reminder: your appointment with Rio Roofing is Sat, Oct 17, 9:30 AM CDT.");
  });
  it("a blank brand drops the clause in Spanish too (mutation: always the named lead -> FAILS)", () => {
    expect(smsReminderLead("  ", sat, "es")).toBe("Recordatorio: su cita es el sab, 17 de oct, 9:30 a.m. CDT.");
  });
});
```

The same three-case shape for `appointment-confirm-copy.test.ts` (Spanish lead `"Hola, le escribe Rio Roofing. Tiene cita el sab, 17 de oct, 9:30 a.m. CDT. Responda SI …"`, folded; no-name lead); and one case per remaining module: `defaultReviewRequestBody("Rio Roofing", "es")` → `"¡Gracias por elegir a Rio Roofing! Si tiene un minuto, nos ayuda mucho que nos deje una reseña:"`; `defaultNoShowNudgeBody("", "es")` → the NoName Spanish; `quoteFollowupSubject("Rio Roofing", "es")` → `"Sobre su estimado de Rio Roofing"`; `referralAskSubject("", "es")` → `"Un favor"`; `reactivationSubject("Rio Roofing", "es")` → `"Un saludo de Rio Roofing"`; `marketingFooterReason("Rio Roofing", "es")` → `"Le llega este correo porque ha sido cliente de Rio Roofing. Si prefiere no recibir más mensajes, responda y avísenos."`. Each test also asserts its English call with no third argument equals today's string (read it from the existing test). Mutation per module: ignore `language` → its Spanish case FAILS.
- [ ] **Step 2: Run, see them fail.** `pnpm --filter web exec vitest run src/lib/automations/sms-reminder-copy.test.ts src/lib/automations/appointment-confirm-copy.test.ts src/lib/automations/review-request-copy.test.ts src/lib/automations/no-show-nudge-copy.test.ts src/lib/automations/quote-followup-copy.test.ts src/lib/automations/referral-ask-copy.test.ts src/lib/automations/reactivation-copy.test.ts src/lib/automations/marketing-copy.test.ts` → FAIL on each new case. (A module with no test file today gets one; check `ls` first.)
- [ ] **Step 3: Implement.** `sms-reminder-copy.ts`:

```ts
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { gsmFoldVowels } from "@/lib/sms/segments";

type Lang = "en" | "es";

export function smsReminderLead(brandName: string, whenText: string, language: Lang = "en"): string {
  // S-09 C19: a Spanish date carries "sáb"/"mié"; folded so the text stays GSM-7. English is never folded.
  const when = language === "es" ? gsmFoldVowels(whenText) : whenText;
  return brandName.trim()
    ? t(m, "automations.smsReminder.lead", language, { name: brandName, when })
    : t(m, "automations.smsReminder.leadNoName", language, { when });
}

export function defaultSmsReminderBody(language: Lang = "en"): string {
  return t(m, "automations.smsReminder.defaultBody", language);
}

export function composeSmsReminder(brandName: string, whenText: string, body: string, language: Lang = "en"): string {
  return [smsReminderLead(brandName, whenText, language), body.trim()].filter(Boolean).join(" ");
}
```

`appointment-confirm-copy.ts` the same shape with `automations.appointmentConfirm.lead` / `.leadNoName`. The default-body modules: `return brandName.trim() ? t(m, "<key>", language, { name: brandName }) : t(m, "<key>NoName", language);` (keep each file's doc comment; `t` interpolates with a replacer function, so the `$&` safety each comment describes holds).
- [ ] **Step 4: Run, see them pass**, then every caller's test: `grep -rln "smsReminderLead\|composeSmsReminder\|defaultSmsReminderBody\|appointmentConfirmLead\|composeAppointmentConfirm\|defaultReviewRequestBody\|defaultNoShowNudgeBody\|defaultQuoteFollowupBody\|quoteFollowupSubject\|defaultReferralAskBody\|referralAskSubject\|defaultReactivationBody\|reactivationSubject\|marketingFooterReason" apps/web/src` → run each file. Paste the summary lines.
- [ ] **Step 5: Probes:** drop the `gsmFoldVowels` in `smsReminderLead` (its GSM case fails) — then the SIBLING in `appointmentConfirmLead` (its case fails); make `defaultReferralAskBody` ignore `language` (fails).
- [ ] **Step 6: Commit.** `git commit -m "feat(sms): every default body, subject and lead has its Spanish, and a Spanish texted date is folded to one alphabet (S-09 PR 2)" -- <the sixteen files>`

---

## Task 6: `@bis/db` booking side (bis-booking)

**Review:** opus. **Depends on:** Task 1.

**Files**
- Modify: `packages/db/src/booking.ts`: `DueReminder` (`:68-89`), `DueFollowup` (`:91-102`), `CALENDAR_COLS` (`:104-107`), `CalendarRow` (`:9-…`), `CalendarSettingsPatch` (`:43-…`), `updateCalendarSettings` (`:191-…`, beside `:204`), the booking list's contact embed (`:872`) and its row type, `ACCOUNT_BRAND_COLS` (`:1067-1072`), `AccountBrandInfo` (`:1129-1138`), `loadAccountBrandInfo` (`:1146-1170`), `REMINDER_SELECT` / `toDueReminder` (`:1321-1334`), `FOLLOWUP_SELECT` / `toDueFollowup` (`:1454-1464`)
- Modify: `packages/db/src/test/booking.test.ts`

**Interfaces**
- Consumes: `recipientLanguage`, `type RecipientLanguage` from `./messaging` (Task 1).
- Produces:
  - `AccountBrandInfo.accountLanguage: RecipientLanguage | null` (`ACCOUNT_BRAND_COLS` appends `, language`)
  - `DueReminder.language: RecipientLanguage`; `DueReminder.contactPhone: string | null`
  - `DueFollowup.language: RecipientLanguage`; `DueFollowup.followupBodyEs: string | null`
  - `CalendarRow.followup_body_es: string | null`, `CalendarRow.followup_body_es_basis: string | null` (in `CALENDAR_COLS`)
  - `CalendarSettingsPatch.followupBodyEs?: string | null`, `.followupBodyEsBasis?: string | null`
  - the booking list row's `contact_language: string | null` beside `contact_name` / `contact_email` (read the mapper that builds `contact_name` from the `:872` embed and add it there; `bookings-list.tsx:18`'s `Booking` type reads it)

- [ ] **Step 1: Failing db tests** (append to `booking.test.ts`'s describe; `setAccountLanguage` from `../accounts`, `setContactLanguage` from `../contacts`):

```ts
  it("S-09 PR 2: the reminder and the follow-up carry the customer's language — the contact's, else the account's, else English (mutation: drop `language` from REMINDER_SELECT's contact embed -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const mk = async (firstName: string, email: string) =>
        (await createContact(db, accountId, { firstName, email, phone: "+19565550111" }, "user_test")).id;
      const es = await mk("Esa", "es@example.com");
      const none = await mk("Nadie", "none@example.com");
      await setContactLanguage(db, accountId, es, "es", "user_test");
      const now = new Date("2027-03-01T12:00:00Z");
      for (const [contactId, h] of [[es, 11], [none, 12]] as const) {
        await createBooking(db, accountId, { calendarId: cal.id, contactId,
          startsAt: new Date(`2027-03-02T${h}:00:00Z`), endsAt: new Date(`2027-03-02T${h}:30:00Z`) }, "user_test");
      }
      const lang = async () => Object.fromEntries((await listDueReminders(db, now.toISOString())).map((d) => [d.contactId, d.language]));
      expect(await lang()).toEqual({ [es]: "es", [none]: "en" });
      await setAccountLanguage(db, accountId, "es", "user_test");
      expect(await lang()).toEqual({ [es]: "es", [none]: "es" });   // L3: the account's, for a contact with none
      const due = await listDueReminders(db, now.toISOString());
      expect(due.find((d) => d.contactId === es)!.contactPhone).toBe("+19565550111");
    });
  });

  it("S-09 PR 2: a calendar's Spanish follow-up box round-trips and reaches the follow-up row (mutation: omit followup_body_es from CALENDAR_COLS -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await updateCalendarSettings(db, accountId, { followupBodyEs: "Gracias.", followupBodyEsBasis: "Thanks." }, "user_test");
      const again = await getOrCreateCalendar(db, accountId, "user_test");
      expect([again.followup_body_es, again.followup_body_es_basis]).toEqual(["Gracias.", "Thanks."]);
      expect(cal.id).toBe(again.id);
    });
  });
```

Plus, inside the existing follow-up test (read the one that calls `listDueFollowups`), assert `due[0]!.language === "en"` and `due[0]!.followupBodyEs === null` for the default calendar. (Use the existing tests' `createContact` input shape; if `phone` is not an accepted key there, read `ContactInput` in `contacts.ts` and use its name for it.)
- [ ] **Step 2: Run, see them fail.** `pnpm --filter @bis/db exec vitest run src/test/booking.test.ts > <SCRATCH>/s09p2-t6-red.txt 2>&1; echo $? > <SCRATCH>/s09p2-t6-red.code` then read the summary block (`expected { … } to deeply equal`). Paste the failing assertion line.
- [ ] **Step 3: Implement.**

```ts
// imports
import { recipientLanguage, type RecipientLanguage } from "./messaging";

// DueReminder gains:
  /** S-09 PR 2: the language this reminder is written in — contacts.language, else accounts.language, else
   *  English (recipientLanguage, resolved HERE once, spec C12). Set on every row, by-id reads too. */
  language: RecipientLanguage;
  /** For the late rule's `textCovers` (plan deviation 2): is there a textable phone at all. Unjudged here. */
  contactPhone: string | null;

// DueFollowup gains:
  language: RecipientLanguage;
  /** 0076: NULL = our Spanish default, '' = emptied (the English), else theirs. */
  followupBodyEs: string | null;

// CALENDAR_COLS: append ", followup_body_es, followup_body_es_basis" to the last string piece
//   ("meeting_type, followup_enabled, followup_body, followup_body_es, followup_body_es_basis")
// CalendarRow gains: followup_body_es: string | null; followup_body_es_basis: string | null;
// CalendarSettingsPatch gains: followupBodyEs: string | null; followupBodyEsBasis: string | null;
// updateCalendarSettings, beside :204:
  if (patch.followupBodyEs !== undefined) row.followup_body_es = patch.followupBodyEs;
  if (patch.followupBodyEsBasis !== undefined) row.followup_body_es_basis = patch.followupBodyEsBasis;

// ACCOUNT_BRAND_COLS: append to the last piece
  "mailing_address, " +
  // S-09 PR 2 (0065, its second reader since 0076): the language of scheduled messages to a contact with none.
  "language";
// AccountBrandInfo gains:
  /** 0065. NULL = no preference. Read by recipientLanguage in every due-list's mapper (S-09 L3). */
  accountLanguage: RecipientLanguage | null;
// loadAccountBrandInfo: the cast gains `language: string | null;` and the object
  accountLanguage: acct.language === "en" || acct.language === "es" ? acct.language : null,

// REMINDER_SELECT's contact embed:  contacts(account_id, first_name, last_name, email, phone, language)
// toDueReminder adds:
    language: recipientLanguage(r.contacts?.language, info.accountLanguage),
    contactPhone: r.contacts?.phone ?? null,
// FOLLOWUP_SELECT: calendars!inner(account_id, followup_body, followup_body_es, followup_enabled), contacts(account_id, first_name, last_name, email, language)
// toDueFollowup adds:
    language: recipientLanguage(r.contacts?.language, info.accountLanguage),
    followupBodyEs: r.calendars?.followup_body_es ?? null,
// :872:  `${BOOKING_COLS}, contacts(first_name, last_name, email, language)` and the mapper adds
//    contact_language: r.contacts?.language ?? null
```

`FOLLOWUP_SELECT` and `REMINDER_SELECT` stay single string literals (the supabase-js type parser, `automations.ts:1843-1847`'s note).
- [ ] **Step 4: Run, see them pass**, then the other db suites that read these shapes: `pnpm --filter @bis/db exec vitest run src/test/booking.test.ts src/test/due-by-id.test.ts src/__tests__/outbound-suppressed.test.ts`, and the web typecheck (every `DueReminder` / `DueFollowup` / `CalendarRow` literal in a web test now misses a required field): `pnpm --filter web typecheck`; fix ONLY by adding `language: "en"`, `contactPhone: null`, `followupBodyEs: null`, `followup_body_es: null, followup_body_es_basis: null` to the web test builders that fail (`grep -rln "DueReminder\|DueFollowup\|CalendarRow" apps/web/src --include=*.test.ts`); those builder edits are this task's, listed in its commit. Paste the summaries.
- [ ] **Step 5: Probes:** drop `language` from `REMINDER_SELECT`'s embed (first case fails); pass `null` instead of `info.accountLanguage` (the L3 line fails); drop `followup_body_es` from `CALENDAR_COLS` (second case fails).
- [ ] **Step 6: Commit.** `git commit -m "feat(booking): reminder and follow-up rows carry the customer's language, the account read carries the account's, and the calendar holds its Spanish follow-up (S-09 PR 2)" -- packages/db/src/booking.ts packages/db/src/test/booking.test.ts <each web test builder touched>`

---

## Task 7: `@bis/db` automations side (bis-automations)

**Review:** opus. **Depends on:** Tasks 1 and 6.

**Files**
- Modify: `packages/db/src/automations.ts`: `AutomationRow` (`:21-28`), `AUTOMATION_COLS` (`:30`), `upsertAutomation` (`:48-…`), `EnabledRecipe` + `listEnabled` (`:70-89`), `enabledRecipeFor` (`:297-300`); each `Due*` type and mapper: review request (`:177-266`), no-show (`:392-439`), text reminder (`:545-576`), appointment confirm (`:684-716`), referral (`:961-1022`), reactivation (`:1294-1320`, the `contacts!inner(…)` at `:1478`, the builders at `:1593`, `:1676`), quote (`:1826-1850`, builders `:2044`, `:2085`)
- Modify: `packages/db/src/test/automations.test.ts`, `packages/db/src/test/due-by-id.test.ts`

**Interfaces**
- Consumes: `recipientLanguage`, `RecipientLanguage` (Task 1); `AccountBrandInfo.accountLanguage` (Task 6).
- Produces:
  - `AutomationRow.body_es: string | null`, `AutomationRow.body_es_basis: string | null` (in `AUTOMATION_COLS`)
  - `upsertAutomation(db, accountId, recipeKey, patch: { enabled: boolean; body: string; config: Record<string, unknown>; bodyEs?: string | null; bodyEsBasis?: string | null }, actorId)` — `bodyEs`/`bodyEsBasis` written ONLY when present (`!== undefined`), so the instant reply's save (`automations/actions.ts:319`), which never passes them, can never touch them (C15)
  - `EnabledRecipe = { body: string; bodyEs: string | null; config: unknown }`
  - every one of `DueReviewRequest`, `DueNoShowNudge`, `DueSmsReminder`, `DueAppointmentConfirm`, `DueReferralAsk`, `DueReactivation`, `DueQuoteFollowup` gains `language: RecipientLanguage` and `bodyEs: string | null`

- [ ] **Step 1: Failing db tests.** In `automations.test.ts` (read its existing `listDueReviewRequests` case for the seed it uses; add a sibling):

```ts
  it("S-09 PR 2: every recipe's due row carries the customer's language and the Spanish box (mutation: drop `language` from REVIEW_REQUEST_SELECT -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      // …the existing review-request seed (a completed booking in the window, recipe on)…
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "Thanks.", config: { channel: "email", reviewUrl: "https://g.page/r" }, bodyEs: "Gracias.", bodyEsBasis: "Thanks." }, "user_test");
      await setContactLanguage(db, accountId, contactId, "es", "user_test");
      const [row] = await listDueReviewRequests(db, now.toISOString());
      expect([row!.language, row!.bodyEs]).toEqual(["es", "Gracias."]);
    });
  });

  it("S-09 PR 2: upsertAutomation leaves the Spanish box alone when the patch does not name it (C15: the instant reply's save; mutation: write bodyEs ?? null -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await upsertAutomation(db, accountId, "review_request", { enabled: false, body: "", config: {}, bodyEs: "Gracias.", bodyEsBasis: "" }, "user_test");
      await upsertAutomation(db, accountId, "review_request", { enabled: false, body: "x", config: {} }, "user_test");
      const row = await getAutomation(db, accountId, "review_request");
      expect([row!.body_es, row!.body_es_basis]).toEqual(["Gracias.", ""]);
    });
  });
```

In `due-by-id.test.ts`, one case per by-id read that has a body (`getDueSmsReminderById`, `getDueReviewRequestById`, `getDueNoShowNudgeById`, and the referral / reactivation / quote / confirm by-id reads the file already exercises): the found row's `language` is `"en"` for the seeded contact and `"es"` after `setAccountLanguage(db, accountId, "es", "user_test")` (mutation: one by-id builder hard-codes `"en"` → FAILS; the release path reads by id, so the rule must hold there too).
- [ ] **Step 2: Run, see them fail.** `pnpm --filter @bis/db exec vitest run src/test/automations.test.ts src/test/due-by-id.test.ts > <SCRATCH>/s09p2-t7-red.txt 2>&1; echo $? > <SCRATCH>/s09p2-t7-red.code` → the new cases fail. Paste.
- [ ] **Step 3: Implement.**

```ts
import { recipientLanguage, type RecipientLanguage } from "./messaging";

export type AutomationRow = {
  id: string; account_id: string; recipe_key: RecipeKey;
  enabled: boolean; body: string;
  /** 0076, S-09 PR 2: NULL = our written Spanish default, '' = emptied (Spanish customers get the
   *  English), else theirs. Never read for `instant_reply` (C15: its Spanish is config.bodyEs). */
  body_es: string | null;
  /** The English the Spanish was written beside (C14). */
  body_es_basis: string | null;
  config: unknown;
  created_at: string; updated_at: string;
};
const AUTOMATION_COLS = "id, account_id, recipe_key, enabled, body, body_es, body_es_basis, config, created_at, updated_at";

// upsertAutomation: patch type gains `bodyEs?: string | null; bodyEsBasis?: string | null;` and the row it writes:
//   ...(patch.bodyEs !== undefined ? { body_es: patch.bodyEs } : {}),
//   ...(patch.bodyEsBasis !== undefined ? { body_es_basis: patch.bodyEsBasis } : {}),

type EnabledRecipe = { body: string; bodyEs: string | null; config: unknown };
// listEnabled: .select("account_id, body, body_es, config") and
//   [a.account_id, { body: a.body ?? "", bodyEs: a.body_es ?? null, config: a.config }]
// enabledRecipeFor: { body: row.body ?? "", bodyEs: row.body_es ?? null, config: row.config }
```

Each `*_SELECT`'s `contacts(account_id, …)` gains `, language` (single literals; `REACTIVATION`'s `contacts!inner(id, account_id, first_name, last_name, email, language)` at `:1478`). Each `Due*` type gains, with the same two doc lines:

```ts
  /** S-09 PR 2 (spec C12): contacts.language, else accounts.language, else English, resolved by the mapper. */
  language: RecipientLanguage;
  /** 0076: the recipe's Spanish box as stored (chooseBody reads it). */
  bodyEs: string | null;
```

and each mapper / builder adds `language: recipientLanguage(r.contacts?.language, info.accountLanguage), bodyEs: auto.bodyEs` (reactivation's and quote's builders at `:1593`, `:1676`, `:2044`, `:2085` carry `conf.bodyEs` the way they already carry `conf.body`: add `bodyEs` beside `body` in the two per-account maps at `:1397-1408` and `:1941-1956`).
- [ ] **Step 4: Run, see them pass**, then `pnpm --filter @bis/db exec vitest run src/__tests__/outbound-suppressed.test.ts src/own-account-embeds.test.ts`, and `pnpm --filter web typecheck`; add `language: "en", bodyEs: null` (and `body_es: null, body_es_basis: null` to `AutomationRow` literals) to every web test builder the typecheck names (`grep -rln "DueReviewRequest\|DueNoShowNudge\|DueSmsReminder\|DueAppointmentConfirm\|DueReferralAsk\|DueReactivation\|DueQuoteFollowup\|AutomationRow" apps/web/src --include=*.test.ts`), and list them in the commit. Paste the summaries.
- [ ] **Step 5: Probes:** drop `language` from `REVIEW_REQUEST_SELECT` (the first case fails); write `body_es: patch.bodyEs ?? null` unconditionally (the second fails); hard-code `language: "en"` in the reactivation by-id builder (its due-by-id case fails) — sibling: the same in `toDueSmsReminder`.
- [ ] **Step 6: Commit.** `git commit -m "feat(automations): every recipe's due row carries the customer's language and its Spanish box; saves that do not name the box never touch it (S-09 PR 2)" -- packages/db/src/automations.ts packages/db/src/test/automations.test.ts packages/db/src/test/due-by-id.test.ts <web test builders>`

---

## Task 8: The follow-up pass, and the in-the-moment pin (bis-booking)

**Review:** sonnet. **Depends on:** Tasks 1, 4, 6.

**Files**
- Modify: `apps/web/src/lib/automations/passes/followups.ts:110-130` (the `bookingFollowupEmail` call and `ctx.email.send`)
- Modify: `apps/web/src/lib/automations/passes/followups.test.ts`
- Modify: `apps/web/src/app/b/[publicId]/actions.test.ts` (one case)

**Interfaces**
- Consumes: `chooseBody` (`@bis/db`), `defaultFollowupBody` (Task 4), `DueFollowup.language` / `.followupBodyEs` (Task 6).

- [ ] **Step 1: Failing tests.** In `followups.test.ts` (its `row()` at `:25`, `ctx()` at `:40`, `emailSend` at `:39`; use a `now` the file's existing sending case uses):

```ts
describe("S-09 PR 2: the follow-up in the customer's language", () => {
  it("a Spanish contact with our default gets our Spanish, a Spanish subject, and the gate is told es (mutation: drop `language` from ctx.email.send -> FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ language: "es", followupBody: "", followupBodyEs: null })]);
    await followupsPass.run(ctx(SEND_TIME));
    const sent = emailSend.mock.calls[0]![0] as { subject: string; body: string; language?: string };
    expect(sent.subject).toBe("Gracias de parte de Rio Roofing");
    expect(sent.body).toBe("¡Gracias por su visita! Si tiene alguna pregunta o quiere hacer otra cita, solo responda a este correo.");
    expect(sent.language).toBe("es");
  });
  it("a Spanish contact whose box was emptied gets the WHOLE email in English (C11; mutation: pass row.language to the template -> FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ language: "es", followupBody: "Thanks for coming by the shop.", followupBodyEs: "" })]);
    await followupsPass.run(ctx(SEND_TIME));
    const sent = emailSend.mock.calls[0]![0] as { subject: string; body: string; language?: string };
    expect([sent.subject, sent.body, sent.language]).toEqual(["Thanks from Rio Roofing", "Thanks for coming by the shop.", "en"]);
  });
});
```

(`SEND_TIME` = the instant the file's existing "sends" case uses; read it and name it. `row()` must set `branding.brandName: "Rio Roofing"` or read what it sets.) In `b/[publicId]/actions.test.ts`, one pin (spec §16.2 "in-the-moment unchanged"): with the account's `language` `en` and the posted `locale: "es"`, the confirmation email's subject is `"Tu cita quedó agendada"` even though the mock contact row carries `language: "en"` (read the file's existing confirmation case for its mocks). Mutation: route the confirmation's locale through `recipientLanguage(contact.language, account.language)` → the subject is English → FAILS.
- [ ] **Step 2: Run, see the follow-up cases fail.** `pnpm --filter web exec vitest run src/lib/automations/passes/followups.test.ts "src/app/b/[publicId]/actions.test.ts"` → the two follow-up cases FAIL; the pin passes (it guards existing behaviour; its probe in Step 5 is its red). Paste.
- [ ] **Step 3: Implement** in `followups.ts`, before the template call (`:115`):

```ts
        // S-09 PR 2 (C11): one language end to end. `chooseBody` may switch a Spanish row to English
        // (an emptied box), and that RETURNED language drives the subject, the body and the footer.
        const chosen = chooseBody({
          language: followup.language, body: followup.followupBody, bodyEs: followup.followupBodyEs,
          defaults: { en: defaultFollowupBody("en"), es: defaultFollowupBody("es") },
        });
        const { subject: emailSubject, html, text } = bookingFollowupEmail({
          brand, body: chosen.text, locale: chosen.language,
        });
```

and `language: chosen.language,` in the `ctx.email.send({ … })` object. Imports: `chooseBody` from `@bis/db`; `defaultFollowupBody` from `@/lib/email/templates/followup`.
- [ ] **Step 4: Run, see them pass.** Same command; paste.
- [ ] **Step 5: Probes:** remove `language: chosen.language` from the send (case 1 fails); pass `locale: followup.language` (case 2 fails); and the pin's probe: in `b/[publicId]/actions.ts` temporarily pass `"en"` as the confirmation locale (the pin fails by name), edit back.
- [ ] **Step 6: Commit.** `git commit -m "feat(booking): the follow-up email goes out in the customer's language, all of it (S-09 PR 2)" -- apps/web/src/lib/automations/passes/followups.ts apps/web/src/lib/automations/passes/followups.test.ts "apps/web/src/app/b/[publicId]/actions.test.ts"`

---

## Task 9: The reminder email, the text reminder and the appointment confirmation passes (bis-automations)

**Review:** opus. **Depends on:** Tasks 1, 2, 4, 5, 6, 7.

**Files**
- Modify: `apps/web/src/lib/automations/passes/reminders.ts:73-98`; `reminders.test.ts`
- Modify: `apps/web/src/lib/automations/passes/sms-reminder.ts:110-121`; `sms-reminder.test.ts`
- Modify: `apps/web/src/lib/automations/passes/appointment-confirm.ts:145-160`; `appointment-confirm.test.ts`

**Interfaces**
- Consumes: `DueReminder.language`, `DueSmsReminder.{language, bodyEs}`, `DueAppointmentConfirm.{language, bodyEs}`; `bookingReminderEmail({ locale })`, `bookingReminderSubject`; `composeSmsReminder(…, language)`, `defaultSmsReminderBody(language)`; `composeAppointmentConfirm(…, language)`; `chooseBody`; `formatWhen(…, locale)`.

- [ ] **Step 1: Failing tests.** `reminders.test.ts` (helpers `row`, `ctx`, `emailSend`, `NOON` at `:13-46`):

```ts
describe("S-09 PR 2: the reminder email in the customer's language", () => {
  it("es: Spanish subject, intro, date and cancel link, and the gate is told es (mutation: drop `language` from ctx.email.send -> FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row({ language: "es" })]);
    await remindersPass.run(ctx(NOON));
    const sent = emailSend.mock.calls[0]![0] as { subject: string; body: string; language?: string };
    expect(sent.subject).toBe("Recordatorio: su próxima cita");
    expect(sent.body).toContain("Le recordamos su próxima cita.");
    expect(sent.body).toContain("mar, 22 de sept");   // formatWhen(…, "es") of 2026-09-22 15:00 CDT
    expect(sent.body).toContain("Cancelar esta cita: https://app.example.com/b/cal_pub/cancel/tok_1?locale=es");
    expect(sent.language).toBe("es");
  });
  it("en: today's email, byte for byte, no ?locale (mutation: always add ?locale -> FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row()]);   // row() must now default language: "en" (Task 6 added the field)
    await remindersPass.run(ctx(NOON));
    const sent = emailSend.mock.calls[0]![0] as { subject: string; body: string; language?: string };
    expect(sent.subject).toBe("Reminder: your upcoming booking");
    expect(sent.body).toContain("Cancel this booking: https://app.example.com/b/cal_pub/cancel/tok_1");
    expect(sent.body).not.toContain("locale=");
    expect(sent.language).toBe("en");
  });
});
```

(Measured on this machine's Node v24.13.0 with `formatWhen`'s options: `"mar, 22 de sept, 3:00 p.m. CDT"` for the fixture's `startsAt` in `America/Chicago`. The test runs `formatWhen` live, so a different ICU fails here first.) `sms-reminder.test.ts` (helpers `row` `:28`, `ctx` `:41`, `smsSend` `:39`, `senderMock`):

```ts
describe("S-09 PR 2: the text reminder in the customer's language", () => {
  it("es with our default: Spanish lead, folded Saturday, Spanish closing line, Spanish opt-out, ONE GSM-7 part set (mutation: no gsm fold -> the encoding check FAILS)", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ language: "es", body: "", bodyEs: null, startsAt: "2026-10-17T14:30:00.000Z" })]);
    await smsReminderPass.run(ctx());
    const body = (smsSend.mock.calls[0]![0] as { body: string }).body;
    expect(body.startsWith("Recordatorio: su cita con ")).toBe(true);
    expect(body).toContain("es el sab, 17 de oct");
    expect(body).toContain("Si necesita hacer un cambio, responda a este mensaje.");
    expect(body.endsWith(m["sms.optOut.es"])).toBe(true);   // "Responde STOP para cancelar." (messages.ts:1807), not the English
    expect(segmentsFor(body).encoding).toBe("gsm7");
  });
  it("es with an emptied box: the whole text is English, opt-out included (C11; mutation: lead in row.language -> FAILS)", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ language: "es", body: "Call us to move it.", bodyEs: "" })]);
    await smsReminderPass.run(ctx());
    const body = (smsSend.mock.calls[0]![0] as { body: string }).body;
    expect(body.startsWith("Reminder: your appointment")).toBe(true);
    expect(body).toContain("Call us to move it.");
    expect(body.endsWith(m["sms.optOut.en"])).toBe(true);   // "Reply STOP to opt out." (messages.ts:1806)
  });
});
```

(Import `m` from `@/lib/messages` and `segmentsFor` from `@/lib/sms/segments`. `withOptOut` is idempotent on a STOP sentence, `opt-out.ts:56-68`, so the line appears once. The time `ctx()`'s default `TICK` must put `2026-10-17T14:30Z` inside the window: set `startsAt` relative to `TICK` as the file's existing cases do, and choose a Saturday.) `appointment-confirm.test.ts` (helpers `row` `:53`, `ctx` `:36`, `send` `:34`): es row with `bodyEs: null` → body starts `"Hola, le escribe "`, contains `"Responda SI para confirmar"`, GSM-7; es row with `bodyEs: ""` (Q1's state) → English lead.
- [ ] **Step 2: Run, see them fail.** `pnpm --filter web exec vitest run src/lib/automations/passes/reminders.test.ts src/lib/automations/passes/sms-reminder.test.ts src/lib/automations/passes/appointment-confirm.test.ts`. Paste one failing line per file.
- [ ] **Step 3: Implement.** `reminders.ts` (`:73-80`, `:95`):

```ts
      const brand = emailBrand(reminder.branding);
      const bookerZone = safeZone(reminder.bookerTimezone ?? undefined, reminder.accountTimezone);
      // S-09 PR 2: no editable body, so the row's resolved language IS the message's (C11).
      const locale = reminder.language;
      const whenBookerZone = formatWhen(new Date(reminder.startsAt), bookerZone, locale);
      // ?locale=es as the confirmation's cancel link does (b/[publicId]/actions.ts), so the page matches the email.
      const cancelUrl = `${ctx.origin}/b/${reminder.calendarPublicId}/cancel/${reminder.cancelToken}${locale === "es" ? "?locale=es" : ""}`;
      const { html, text } = bookingReminderEmail({
        brand, whenBookerZone, cancelUrl, meetingUrl: reminder.meetingUrl ?? undefined, locale,
      });
      // …in ctx.email.send:
          subject: bookingReminderSubject(locale),
          language: locale,
```

`sms-reminder.ts` (`:112-121`):

```ts
      const zone = safeZone(row.bookerTimezone ?? undefined, row.accountTimezone);
      // S-09 PR 2 (C11, C15): the closing line's box decides the language of the WHOLE text.
      const chosen = chooseBody({
        language: row.language, body: row.body, bodyEs: row.bodyEs,
        defaults: { en: defaultSmsReminderBody("en"), es: defaultSmsReminderBody("es") },
      });
      const body = composeSmsReminder(
        row.brandName, formatWhen(new Date(row.startsAt), zone, chosen.language), chosen.text, chosen.language);
      // …in sendAutomationSms's input:
          language: chosen.language,
```

`appointment-confirm.ts` (`:152-160`): the same with `defaults: { en: "", es: "" }` (plan deviation 4) and `composeAppointmentConfirm(row.brandName, formatWhen(new Date(row.startsAt), zone, chosen.language), chosen.text, chosen.language)`, `language: chosen.language` to `sendAutomationSms`. Update each pass's top doc comment with one sentence: "S-09 PR 2: in the customer's language (the due row's `language`; an emptied Spanish box sends the whole text in English)."
- [ ] **Step 4: Run, see them pass.** Same command plus `src/lib/automations/send-sms.test.ts src/lib/automations/hold-or-send.test.ts`; paste.
- [ ] **Step 5: Probes:** remove `language: locale` from the reminder's send (its case fails); remove `language: chosen.language` from the SMS send in `sms-reminder.ts` (fails) — SIBLING: the same in `appointment-confirm.ts` (fails); pass `row.language` instead of `chosen.language` to `composeSmsReminder` (the emptied case fails).
- [ ] **Step 6: Commit.** `git commit -m "feat(automations): the reminder email, the text reminder and the confirmation text go out in the customer's language (S-09 PR 2)" -- <the six files>`

---

## Task 10: Review request and no-show nudge passes (bis-automations)

**Review:** sonnet. **Depends on:** Tasks 1, 4, 5, 7. **Runs beside:** Tasks 11, 13.

**Files:** `passes/review-request.ts:230-243`, `:316-335` (`sendEmail`) and its test; `passes/no-show-nudge.ts:211-…`, `:290-305` and its test.

- [ ] **Step 1: Failing tests.** In each test file (helpers `row`, `ctx`, `emailSend`, `smsSend`, `senderMock` at the lines listed under Task 9's survey: review `:31/:52/:50/:51/:13`, no-show `:28/:52/:50/:51/:12`), four cases: (a) es, email channel, `bodyEs: null` → `emailSend`'s `subject` is `"¿Le gustaría dejarle una reseña a Rio Roofing?"` (no-show: `"¿Quiere escoger otro horario con Rio Roofing?"`), `body` starts with the Spanish default, `language: "es"`; (b) es, SMS channel → the text starts with the Spanish default and ends with the review link (no-show: the booking link), the gate's opt-out is the Spanish one, GSM-7; (c) es, `bodyEs: ""` → everything English, `language: "en"`; (d) `language: "es"`, `bodyEs: "Gracias, de verdad."` → the body is exactly theirs. Mutation names on each `it`: (a) drop `language` from the email send; (b) drop `language` from `sendAutomationSms`; (c) pass `row.language` to the template; (d) ignore `bodyEs`.
- [ ] **Step 2: Run, see them fail.** `pnpm --filter web exec vitest run src/lib/automations/passes/review-request.test.ts src/lib/automations/passes/no-show-nudge.test.ts`.
- [ ] **Step 3: Implement.** `review-request.ts:230`:

```ts
    // S-09 PR 2 (C11): the chosen language drives the template, the link sentence and the gate's footer.
    const chosen = chooseBody({
      language: row.language, body: row.body, bodyEs: row.bodyEs,
      defaults: { en: defaultReviewRequestBody(row.brandName, "en"), es: defaultReviewRequestBody(row.brandName, "es") },
    });
    const body = chosen.text;
```

Pass `language: chosen.language` to `sendAutomationSms` (`:236`), and give `sendEmail` (`:316`) a `language: RecipientLanguage` parameter: `reviewRequestEmail({ brand, body, reviewUrl: config.reviewUrl, locale: language })` and `language` in its `ctx.email.send`. `no-show-nudge.ts` the same with `defaultNoShowNudgeBody` and `noShowNudgeEmail({ …, locale: language })`.
- [ ] **Step 4: Run, see them pass.** Paste.
- [ ] **Step 5: Probes:** (a)–(d) above in `review-request.ts`, then (b) and (c) again in the SIBLING `no-show-nudge.ts`.
- [ ] **Step 6: Commit.** `git commit -m "feat(automations): review requests and no-show nudges go out in the customer's language, by email or text (S-09 PR 2)" -- <the four files>`

---

## Task 11: Referral ask, reactivation and quote follow-up passes (bis-automations)

**Review:** sonnet. **Depends on:** Tasks 1, 5, 7. **Runs beside:** Tasks 10, 13.

**Files:** `passes/referral-ask.ts:253-…`, `:345-360` and its test; `passes/reactivation.ts:185-205` and its test; `passes/quote-followup.ts:200-…`, `:305-320` and its test.

- [ ] **Step 1: Failing tests**, the four-case shape of Task 10 in each file (helpers: referral `row` `:30`, `ctx` `:71`; reactivation `row` `:36`, `ctx` `:77`; quote `row` `:33`, `ctx` `:69`). Spanish expectations: referral subject `"Un favor, de parte de Rio Roofing"` and its email footer reason `"Le llega este correo porque ha sido cliente de Rio Roofing. Si prefiere no recibir más mensajes, responda y avísenos."` (both recipes' footers come from `marketingFooterReason`, which reads the `automations.reactivation.footerReason*` keys, `marketing-copy.ts:19-22`); reactivation (email only) subject `"Un saludo de Rio Roofing"`, body starts `"Hola, le saluda Rio Roofing."`, the footer reason Spanish; quote subject `"Sobre su estimado de Rio Roofing"`. Reactivation has no SMS case (b).
- [ ] **Step 2: Run, see them fail.** `pnpm --filter web exec vitest run src/lib/automations/passes/referral-ask.test.ts src/lib/automations/passes/reactivation.test.ts src/lib/automations/passes/quote-followup.test.ts`.
- [ ] **Step 3: Implement** — each pass computes `chosen` exactly as Task 10 with its own default function, and passes `chosen.language` to: the subject (`referralAskSubject(row.brandName, chosen.language)`, `reactivationSubject(…)`, `quoteFollowupSubject(…)`), `marketingFooterReason(row.brandName, chosen.language)` (referral `:352`, reactivation `:196`), `sendAutomationSms`'s `language`, and the email send's `language`. Thread `language` into each file's `sendEmail` helper as Task 10 did.
- [ ] **Step 4: Run, see them pass.** Paste.
- [ ] **Step 5: Probes:** in `reactivation.ts`, pass `"en"` to `marketingFooterReason` (the footer case fails); SIBLING in `referral-ask.ts` (fails); drop `language` from the quote's SMS send (fails).
- [ ] **Step 6: Commit.** `git commit -m "feat(automations): referral asks, check-ins and quote follow-ups go out in the customer's language, footer included (S-09 PR 2)" -- <the six files>`

---

## Task 12: The text-back's Spanish box at send (bis-voice)

**Review:** sonnet. **Depends on:** Tasks 1, 3.

**Files**
- Modify: `apps/web/src/lib/voice/textback.ts`: `TextbackRequest` (`:81`), `prepareTextback` (`:201-240`), the release's request (`:436`)
- Modify: `apps/web/src/lib/voice/finish-call.ts:69` (ctx field), `:600` (passes it)
- Modify: `apps/web/src/app/api/voice/incoming/route.ts:1157`; `apps/web/src/app/api/voice/texml/handoff-result/route.ts:341-359`
- Modify: `apps/web/src/lib/voice/textback.test.ts`, `finish-call.test.ts`

**Interfaces**
- Produces: `TextbackRequest.textbackBodyEs: string | null` (required, so every caller is found by the compiler); `FinishCallContext.textbackBodyEs: string | null` (read `finish-call.ts:60-75` for the type's real name).
- The rule stays LIVE (spec §10.1): `r.language` is the caller's spoken language; only the body choice and the language it returns are new.

- [ ] **Step 1: Failing tests** in `textback.test.ts` (read its existing `prepareTextback` case for the mocked `decideSms` and the request builder):

```ts
  it("S-09 PR 2: a Spanish caller with our default gets our Spanish; the gate is told es", async () => { /* r = { …, language: "es", textbackBody: "", textbackBodyEs: null } → decideSms called with body defaultTextbackBody(brand, "es") and language "es" */ });
  it("S-09 PR 2: a Spanish caller of an account whose box is emptied gets the English body AND the English opt-out (C11; mutation: keep r.language for the gate -> FAILS)", async () => { /* textbackBody: "Sorry we missed you, call back anytime.", textbackBodyEs: "" → body is that English, decideSms language "en" */ });
  it("S-09 PR 2: a Spanish caller with a written Spanish box gets it, trimmed", async () => { /* textbackBodyEs: "  Perdón, ya le llamamos.  " → "Perdón, ya le llamamos." */ });
```

Write each body out in full against the file's real helper names (the comments state the exact inputs and expectations). In `finish-call.test.ts`, the case that asserts what `prepareTextback` receives gains `textbackBodyEs` equal to the context's (mutation: pass `null` always → FAILS).
- [ ] **Step 2: Run, see them fail.** `pnpm --filter web exec vitest run src/lib/voice/textback.test.ts src/lib/voice/finish-call.test.ts`.
- [ ] **Step 3: Implement** in `prepareTextback` (`:207-210`):

```ts
  // The caller's spoken language stays the rule (live, spec §10.1). New in S-09 PR 2: the Spanish box.
  // NULL = our Spanish default; '' = emptied, so the whole text, opt-out included, goes in English (C11).
  const chosen = chooseBody({
    language: r.language, body: r.textbackBody, bodyEs: r.textbackBodyEs,
    defaults: {
      en: defaultTextbackBody(r.brandName, "en", r.held === true),
      es: defaultTextbackBody(r.brandName, "es", r.held === true),
    },
  });
  const body = chosen.text;
```

and `language: chosen.language` in `decideSms` (`:237`) and in the held payload (`language: chosen.language`, `:233`), so a release replays the same language. `:436`: `textbackBody: profile.textback_body ?? "", textbackBodyEs: profile.textback_body_es ?? null,`. `incoming/route.ts:1157`: `textbackBodyEs: profile.textback_body_es ?? null,` beside `textbackBody`. `handoff-result/route.ts:341`: `const textbackBodyEs = profile.textback_body_es ?? null;` and pass it at `:359`. Update the comment at `textback.ts:204-206`: the operator's own English is still never translated; their Spanish box (or ours) is what a Spanish caller gets.
- [ ] **Step 4: Run, see them pass**, plus every test that builds a `TextbackRequest` or the finish context: `grep -rln "textbackBody" apps/web/src --include=*.test.ts` → run each. `pnpm --filter web typecheck`. Paste.
- [ ] **Step 5: Probes:** `language: r.language` in `decideSms` (the emptied case fails); `textbackBodyEs: null` at `incoming/route.ts` (finish-call's case fails if it covers the route; otherwise say which test covers it, or add one to the route's existing test).
- [ ] **Step 6: Commit.** `git commit -m "feat(voice): the missed-call text-back sends the Spanish box to a Spanish caller, or the whole text in English when it is emptied (S-09 PR 2)" -- <the six files>`

---

## Task 13: The late-booking 08:00 reminder (bis-booking; Q3, C16)

**Review:** opus. **Depends on:** Task 9 (it committed `reminders.ts`).

**Files**
- Modify: `apps/web/src/lib/booking/reminder-timing.ts:1-32` (+ `reminder-timing.test.ts`)
- Modify: `apps/web/src/lib/automations/passes/reminders.ts:49-54` (`subjectFor`), `:57-66` (per-row), `:90` (the gate's deadline); `reminders.test.ts`
- Modify: `apps/web/src/lib/automations/cron-coupling.test.ts:103-184`

**Interfaces**
- Produces: `export const MORNING_OF_MIN_NOTICE_MS = 45 * 60 * 1000;` and `reminderDeadline(reminder: { startsAt: string; late: boolean }, opts: { textCovers: boolean }): Date`. The `opts` argument is REQUIRED, so every caller is found by the compiler.
- Consumes: `getAutomation` (`@bis/db`, exported, `automations.ts:32`), `resolveSmsSender` (`@/lib/sms/sender`), `normalisePhone` (`@bis/db/phone`), `DueReminder.contactPhone` (Task 6).

- [ ] **Step 1: Failing tests.** `reminder-timing.test.ts`:

```ts
import { reminderDeadline, MORNING_OF_MIN_NOTICE_MS } from "./reminder-timing";
import { SMS_REMINDER_WINDOW_END_MS } from "@bis/db";

describe("reminderDeadline (spec §11.3, C16)", () => {
  const startsAt = "2027-04-06T14:00:00.000Z";
  const s = Date.parse(startsAt);
  it("day-before: the start, whatever texts", () => {
    expect(reminderDeadline({ startsAt, late: false }, { textCovers: true }).getTime()).toBe(s);
    expect(reminderDeadline({ startsAt, late: false }, { textCovers: false }).getTime()).toBe(s);
  });
  it("late with a text coming: start - 2h15m, D-029 unchanged (mutation: ignore textCovers -> FAILS)", () => {
    expect(reminderDeadline({ startsAt, late: true }, { textCovers: true }).getTime()).toBe(s - SMS_REMINDER_WINDOW_END_MS);
  });
  it("late with no text: start - 45 minutes (mutation: 60 minutes -> FAILS)", () => {
    expect(MORNING_OF_MIN_NOTICE_MS).toBe(45 * 60 * 1000);
    expect(reminderDeadline({ startsAt, late: true }, { textCovers: false }).getTime()).toBe(s - 45 * 60 * 1000);
  });
});
```

`cron-coupling.test.ts`: the existing D-029 case (`:135-184`) passes `{ textCovers: true }` to its `reminderDeadline` call (`:168`) and is otherwise UNCHANGED (its 10:15 assertion is the text-on price). Add a sibling case after it, reusing its `land`/`openingAt` shape (copy the helper lines `:138-155` into the new case; they are local to the first):

```ts
  /**
   * S-09 PR 2 (C16, Q3): with texting OFF, every late-booked appointment that starts after 08:45 gets its
   * email at or after 08:00 and at least 45 minutes ahead; none at or before 08:45 gets one. Mutation:
   * MORNING_OF_MIN_NOTICE_MS = 60 minutes -> the 09:00 appointment gets none -> FAILS.
   */
  it("S-09: with no text reminder, a late-booked appointment after 08:45 is emailed at 08:00, at least 45 minutes ahead", () => {
    // …tick, zone, dayStart, openings, openingAt, land: as the D-029 case above…
    let earlyEmailed = 0;
    const keptStarts = new Set<number>();
    for (let s = dayStart; s < dayStart + 24 * 60 * MINUTE; s += 15 * MINUTE) {
      const startsAt = new Date(s).toISOString();
      for (let lead = 3 * 60; lead <= 24 * 60 + 15; lead += 5) {
        const b = s - lead * MINUTE;
        if (!isLateBooking(new Date(b).toISOString(), startsAt)) continue;
        const email = land(
          (t) => s >= t + LATE_REMINDER_WINDOW_START_MS && s <= t + LATE_REMINDER_WINDOW_END_MS && b <= t - LATE_REMINDER_MIN_AGE_MS,
          reminderDeadline({ startsAt, late: true }, { textCovers: false }), Math.max(b, s - LATE_REMINDER_WINDOW_END_MS), s);
        const windowReached = lead * MINUTE >= LATE_REMINDER_WINDOW_START_MS + LATE_REMINDER_MIN_AGE_MS;
        if (!windowReached) continue;
        const minutesOfDay = (s - dayStart) / MINUTE;
        if (typeof email === "number") {
          expect(s - email, `start ${minutesOfDay}`).toBeGreaterThanOrEqual(45 * MINUTE);
          if (minutesOfDay <= 8 * 60 + 45) earlyEmailed++;
          keptStarts.add(minutesOfDay);
        }
      }
    }
    expect(earlyEmailed).toBe(0);                                   // 07:30, 08:30, 08:45: the confirmation only
    for (const m of [9 * 60, 9 * 60 + 30, 10 * 60, 10 * 60 + 15]) expect(keptStarts.has(m), `${m}`).toBe(true);
  });
```

`reminders.test.ts`: add `getAutomation: vi.fn()` to `dbMocks` (`:4-6`) and mock the sender as the SMS test does (`vi.mock("@/lib/sms/sender", …)` with a `senderMock.resolveSmsSender`). Cases: (a) a LATE row for 09:00 CDT, held at a 05:00 tick, with `getAutomation` → `null` (texting off): the held row's deadline (the `recordAutomationLog` call's subject, or the gate's `deadline`) is `start − 45m`; (b) the same with `getAutomation` → `{ enabled: true }`, the sender `{ ok: true }` and `contactPhone: "+19565550111"`: the deadline is `start − 2h15m`; (c) texting on but `contactPhone: null` → `start − 45m` (no textable phone, no text); (d) a NOT-late row never reads `getAutomation` (`expect(dbMocks.getAutomation).not.toHaveBeenCalled()`, the cost rule, spec §11.3); (e) `releaseReminder` at 08:00 for the 09:00 late row with texting off SENDS (the release path recomputes the same deadline). Mutation names: (a) `textCovers: true` always; (b) ignore the sender; (c) ignore the phone; (d) read for every row; (e) release with `{ textCovers: true }` hard-coded.
- [ ] **Step 2: Run, see them fail.** `pnpm --filter web exec vitest run src/lib/booking/reminder-timing.test.ts src/lib/automations/cron-coupling.test.ts src/lib/automations/passes/reminders.test.ts` (typecheck errors on the old one-argument calls are part of the red). Paste.
- [ ] **Step 3: Implement.** `reminder-timing.ts`:

```ts
import { SMS_REMINDER_WINDOW_END_MS } from "@bis/db";

/** S-09 PR 2 (C16, Q3): the least notice a morning-of reminder email is still worth sending with. A
 *  09:00 appointment gets 45-60 minutes (the release tick lands 08:00-08:15); 08:45 would get less use
 *  than the confirmation already gave, so it gets none. */
export const MORNING_OF_MIN_NOTICE_MS = 45 * 60 * 1000;

/**
 * The latest instant an EMAIL reminder is still worth sending: the `deadline` the reminders pass gives
 * `holdOrSend` and the email gate. Past it, a reminder held by the sending hours (08:00-21:00,
 * lib/consent/hours.ts) is dropped rather than released (choice 21).
 *
 * Day-before: the appointment itself.
 * LATE (D-029, booked less than 24h15m ahead) AND a text reminder will go (`textCovers`): the start
 * minus 2h15m, the earliest the text can go, so the two are never released together at 08:00.
 * LATE and NO text will go: the start minus 45 minutes. Held overnight, it is released at 08:00 for
 * every appointment after 08:45 — the early appointment booked the evening before no longer goes
 * without a reminder where texting is off (every live account until A2P). Proved over a whole day in
 * lib/automations/cron-coupling.test.ts, both ways.
 */
export function reminderDeadline(reminder: { startsAt: string; late: boolean }, opts: { textCovers: boolean }): Date {
  const startsAt = new Date(reminder.startsAt).getTime();
  if (!reminder.late) return new Date(startsAt);
  return new Date(startsAt - (opts.textCovers ? SMS_REMINDER_WINDOW_END_MS : MORNING_OF_MIN_NOTICE_MS));
}
```

`reminders.ts`: `subjectFor(r, deadline: Date)` takes the deadline; in `processReminders`, two per-call caches and one helper, used before `subjectFor`:

```ts
  // S-09 PR 2 (C16): does a text reminder cover this LATE row? Read only for late rows, once per account
  // per tick (the text pass's own cache shape, sms-reminder.ts:80-101). A read failure counts as "no
  // text": the email then goes at 08:00, the safe side of a missed reminder.
  const textOn = new Map<string, boolean>();
  async function textCovers(r: DueReminder): Promise<boolean> {
    if (!r.late || !normalisePhone(r.contactPhone)) return false;
    if (!textOn.has(r.accountId)) {
      try {
        const recipe = await getAutomation(ctx.db, r.accountId, "sms_reminder");
        textOn.set(r.accountId, recipe?.enabled === true && (await resolveSmsSender(ctx.db, r.accountId)).ok);
      } catch (e) {
        console.error(`reminders: text-reminder read failed for account ${r.accountId}: ${String(e)}`);
        textOn.set(r.accountId, false);
      }
    }
    return textOn.get(r.accountId)!;
  }
  // in the loop, first line:
    const deadline = reminderDeadline(reminder, { textCovers: await textCovers(reminder) });
    const subject = subjectFor(reminder, deadline);
  // and the gate: deadline,
```

Rewrite the pass's QUIET HOURS comment (`:29-38`) to the new rule, and the ACCEPTED paragraph of the `LATE_REMINDER_*` comment in `packages/db/src/booking.ts` (`:1110-1116` at `f47e27ca`; Task 6 has committed, so re-read the line numbers) to: "With texting OFF for the row (no `textCovers`), the late email's deadline is the start minus 45 minutes instead (S-09 PR 2, `MORNING_OF_MIN_NOTICE_MS`): held overnight, it is released at 08:00 for every appointment after 08:45." Comment-only; this is the second and last touch of `booking.ts` (shared-files order: Task 6 → Task 13). **Assumption** that a failure reading the recipe should mean "no text"; the alternative (skip the row) would cost the reminder.
- [ ] **Step 4: Run, see them pass**, plus every caller: `grep -rln "reminderDeadline" apps/web/src` → run each. Paste.
- [ ] **Step 5: Probes:** `MORNING_OF_MIN_NOTICE_MS = 60 * 60 * 1000` (the cron sweep fails at 09:00 BY NAME; the unit case fails); `reminderDeadline` ignoring `opts` (the D-029 sweep's collision count fails); `textCovers` returning `false` always (reminders case (b) fails); remove the `!r.late` short-circuit (case (d) fails).
- [ ] **Step 6: Commit.** `git commit -m "feat(booking): an early appointment booked the evening before gets its reminder email at 8 AM when no text reminder will go (S-09 PR 2, Q3)" -- <the six or seven files>`

---

## Task 14: `SpanishBodyField` and `/styleguide` (bis-frontend)

**Review:** opus. **Depends on:** Tasks 1, 2, 3.

**Files**
- Create: `apps/web/src/components/spanish-body-field.tsx`, `apps/web/src/components/spanish-body-field.test.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` (one section, read the page for how sections are laid out)

**Interfaces**
- Consumes: `accentCost` (Task 2); `m["automations.bodyEs.*"]`, `m["automations.previewEs"]`, `m["compose.smsSegments"]` (Task 3 / existing); the kit's `Textarea`, `Label`, `Checkbox`, `Button` (`variant="ghost"`), `SmsPreview` (`@/components/sms-preview`, as `sms-reminder-card.tsx:11`).
- Produces:

```ts
export type SpanishBodyFieldProps = {
  /** Unique per card, e.g. "review". Builds the element ids. */
  idPrefix: string;
  /** The stored row (null = never saved): drives the opening text and the stale line. */
  stored: { bodyEs: string | null; stale: boolean };
  /** Our written Spanish, rendered with the brand name ("" for the confirmation card, plan deviation 4). */
  defaultEs: string;
  /** Turns the box's text into the string a Spanish customer receives (lead + body + link + opt-out). */
  composeEs: (text: string) => string;
  /** SMS cards count parts and show the accent line; email cards do not. */
  sms: boolean;
};
export function SpanishBodyField(props: SpanishBodyFieldProps): JSX.Element;
```

Form fields it posts (every save action reads exactly these): `body_es` (the box), `body_es_still_matches` (`"on"` when ticked), `body_es_use_ours` (`"1"` after "Use our Spanish" until the next keystroke).

- [ ] **Step 1: Failing test** `spanish-body-field.test.ts` (`renderToStaticMarkup`, no DOM; the precedent of the cards' own tests):

```ts
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { SpanishBodyField, type SpanishBodyFieldProps } from "./spanish-body-field";

const base: SpanishBodyFieldProps = {
  idPrefix: "t", stored: { bodyEs: null, stale: false }, defaultEs: "Nuestro español.", composeEs: (x) => x, sms: true,
};
const html = (p: Partial<SpanishBodyFieldProps>) => renderToStaticMarkup(createElement(SpanishBodyField, { ...base, ...p }));

describe("SpanishBodyField (spec §12.2)", () => {
  it("opens with our Spanish when nothing is stored, marked lang=es (mutation: open empty -> FAILS)", () => {
    const out = html({});
    expect(out).toMatch(/<textarea[^>]*name="body_es"[^>]*lang="es"[^>]*>Nuestro español\.<\/textarea>|<textarea[^>]*lang="es"[^>]*name="body_es"[^>]*>Nuestro español\.<\/textarea>/);
  });
  it("opens with theirs when stored", () => {
    expect(html({ stored: { bodyEs: "Suyo.", stale: false } })).toContain(">Suyo.</textarea>");
  });
  it("stale: a dot AND the words, and the 'still matches' checkbox (rule 3; mutation: drop the words -> FAILS)", () => {
    const out = html({ stored: { bodyEs: "Viejo.", stale: true } });
    expect(out).toContain("The Spanish still says the old message. Update it to match your English.");
    expect(out).toContain('data-stale-dot');
    expect(out).toContain('name="body_es_still_matches"');
  });
  it("emptied: the English line and a GHOST Use our Spanish, never a second primary (rule 8; mutation: variant default -> FAILS)", () => {
    const out = html({ stored: { bodyEs: "", stale: false } });
    expect(out).toContain("Customers whose language is Spanish will get the English message.");
    expect(out).toMatch(/data-variant="ghost"[^>]*>Use our Spanish|>Use our Spanish<\/button>/);
    expect(out).not.toContain('data-variant="default"');
    expect(out).toMatch(/<button[^>]*type="button"/);   // never submits the card's form on its own
  });
  it("an empty default is not 'emptied' until stored '' (plan deviation 4; mutation: blank box alone -> FAILS)", () => {
    expect(html({ defaultEs: "" })).not.toContain("will get the English message");
    expect(html({ defaultEs: "", stored: { bodyEs: "", stale: false } })).toContain("will get the English message");
  });
  it("SMS: the accent line names both part counts; an email card has none (mutation: show it on email -> FAILS)", () => {
    const accented = "Aquí estamos, gracias por su visita. ".repeat(3);
    expect(html({ stored: { bodyEs: accented, stale: false } })).toMatch(/make this text cost \d+ parts instead of \d+\./);
    expect(html({ stored: { bodyEs: accented, stale: false }, sms: false })).not.toContain("make this text cost");
  });
});
```

(The label's `for` + the textarea's `id` pairing and the `md:grid-cols-2` side-by-side layout live in the CARD, which places this beside the English box; Task 15 pins it.)
- [ ] **Step 2: Run, see it fail.** `pnpm --filter web exec vitest run src/components/spanish-body-field.test.ts` → FAIL (module not found). Paste.
- [ ] **Step 3: Implement** `spanish-body-field.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SmsPreview } from "@/components/sms-preview";
import { m } from "@/lib/messages";
import { segmentsFor, accentCost } from "@/lib/sms/segments";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";

export type SpanishBodyFieldProps = {
  idPrefix: string;
  stored: { bodyEs: string | null; stale: boolean };
  defaultEs: string;
  composeEs: (text: string) => string;
  sms: boolean;
};

/**
 * S-09 PR 2, spec §12.2: the Spanish box beside an editable English message. Part of the card's ONE
 * form (rule 8): nothing here saves on its own. NULL stored = our Spanish (shown pre-filled); '' =
 * emptied (Spanish customers get the English); else theirs. The stale line reads the STORED row
 * (plan deviation 5); the emptied line reads the box (what Save will store).
 */
export function SpanishBodyField({ idPrefix, stored, defaultEs, composeEs, sms }: SpanishBodyFieldProps) {
  const [text, setText] = useState(stored.bodyEs ?? defaultEs);
  const [useOurs, setUseOurs] = useState(false);
  const id = `${idPrefix}-body-es`;
  const blank = text.trim() === "";
  const emptied = blank && (defaultEs.trim() !== "" || (stored.bodyEs === "" && !useOurs));
  const sent = emptied ? "" : composeEs(text.trim());
  const parts = sent ? segmentsFor(sent) : null;
  const cost = sms ? accentCost(sent) : null;

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{m["automations.bodyEs.label"]}</Label>
      <Textarea
        id={id} name="body_es" lang="es" rows={3} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={text}
        className="min-h-11 md:min-h-8"
        onChange={(e) => { setText(e.target.value); setUseOurs(false); }}
      />
      <input type="hidden" name="body_es_use_ours" value={useOurs ? "1" : ""} />
      <p className="text-xs text-muted-foreground">{m["automations.bodyEs.hint"]}</p>
      {stored.stale && !emptied ? (
        <div className="space-y-1.5">
          <p className="flex items-center gap-2 text-xs">
            <span data-stale-dot aria-hidden="true" className="inline-block size-2 rounded-full bg-[var(--accent)]" />
            {m["automations.bodyEs.stale"]}
          </p>
          <div className="flex items-center gap-2">
            <Checkbox id={`${id}-matches`} name="body_es_still_matches" />
            <Label htmlFor={`${id}-matches`}>{m["automations.bodyEs.stillMatches"]}</Label>
          </div>
        </div>
      ) : null}
      {emptied ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>{m["automations.bodyEs.emptied"]}</span>
          <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-8"
            onClick={() => { setText(defaultEs); setUseOurs(true); }}>
            {m["automations.bodyEs.useOurs"]}
          </Button>
        </div>
      ) : null}
      {cost && cost.parts > cost.foldedParts ? (
        <p className="text-xs text-muted-foreground">
          {m["automations.bodyEs.accentCost"].replace("{n}", String(cost.parts)).replace("{m}", String(cost.foldedParts))}
        </p>
      ) : null}
      {sms ? (
        <div className="space-y-1.5" lang="es">
          <SmsPreview id={`${id}-preview`} label={m["automations.previewEs"]} text={sent} testId={`${idPrefix}-preview-es`} />
          {parts ? (
            <p className="text-xs text-muted-foreground" data-testid={`${idPrefix}-count-es`}>
              {m["compose.smsSegments"].replace("{chars}", String(parts.chars)).replace("{segments}", String(parts.segments))}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

(The dot's colour is a token, `var(--accent)`, and the word carries the meaning, rule 3. Read `components/ui/button.tsx` for the attribute the kit renders for the variant: the test's `data-variant` matches `automations-settings.test.ts`'s existing assertions; if the kit renders `data-slot`/a class instead, the test asserts what the kit renders and says so. The accent line shows only when the accents actually cost a part; spec §12.2 says "make this text cost {n} parts instead of {m}", which is false when n = m.)
- [ ] **Step 4: Run, see it pass.** Paste the summary. `pnpm --filter web exec eslint src/components/spanish-body-field.tsx`; `pnpm --filter web typecheck`.
- [ ] **Step 5: `/styleguide`.** Add a "Spanish message box" section rendering the component three times (our Spanish; stale; emptied) with `composeEs={(x) => x}`, `sms`, in the page's existing section shape. Check the ratchet scan does not count a new literal (the section's heading goes through `m[…]` if the page's other headings do; otherwise follow the page's own convention and say which). Render-check: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/styleguide"` if a test exists there.
- [ ] **Step 6: Probes:** open with `""` instead of `defaultEs` (case 1 fails); `variant="default"` on Use our Spanish (case 4 fails); `emptied = blank` (case 5 fails); show the accent line for `sms: false` (case 6 fails).
- [ ] **Step 7: Commit.** `git add -- apps/web/src/components/spanish-body-field.tsx apps/web/src/components/spanish-body-field.test.ts && git commit -m "feat(design): the Spanish message box every editable automatic message shares, on the styleguide (S-09 PR 2)" -- apps/web/src/components/spanish-body-field.tsx apps/web/src/components/spanish-body-field.test.ts "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx"`

---

## Task 15: Spanish boxes, cards A — review, no-show, text reminder, confirmation (bis-automations)

**Review:** opus. **Depends on:** Tasks 5, 7, 14.

**Files**
- Modify: `…/automations/actions.ts:28-94` (review, no-show), `:247-290` (text reminder, confirmation)
- Modify: `…/automations/actions.test.ts`
- Modify: `…/automations/automations-settings.tsx` (the review card), `no-show-nudge-card.tsx`, `sms-reminder-card.tsx`, `appointment-confirm-card.tsx` and each `*.test.ts`
- Modify: `…/automations/page.tsx` / `page.test.ts` only if the cards need a prop the page does not pass yet (they already receive the whole `AutomationRow`, which now carries `body_es`/`body_es_basis` from Task 7)

**Interfaces**
- Consumes: `nextSpanishBox`, `spanishIsStale`, `getAutomation` (`@bis/db`); the copy defaults with `language`; `SpanishBodyField`.
- Produces (shared helper, top of `actions.ts`, used by Task 16 too):

```ts
/** S-09 PR 2: read the Spanish box's three fields and work out what to store (nextSpanishBox). Validates the
 *  Spanish exactly as the English (length). Reads the stored row for "unchanged" and the basis. */
async function spanishBoxPatch(
  accountId: string, recipe: RecipeKey, formData: FormData, body: string, defaultEs: string,
): Promise<{ ok: true; bodyEs: string | null; bodyEsBasis: string | null } | { ok: false; error: string }> {
  const submitted = String(formData.get("body_es") ?? "");
  if (submitted.trim().length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };
  const row = await getAutomation(serviceDb(), accountId, recipe);
  const next = nextSpanishBox({
    submitted, useOurs: formData.get("body_es_use_ours") === "1", stillMatches: formData.get("body_es_still_matches") === "on",
    defaultEs, body, stored: { bodyEs: row?.body_es ?? null, basis: row?.body_es_basis ?? null },
  });
  return { ok: true, bodyEs: next.bodyEs, bodyEsBasis: next.basis };
}
```

`RecipeKey` is imported as a type from `@bis/db` (check the barrel exports it; `automations.ts:17` declares it).

- [ ] **Step 1: Failing tests.** `actions.test.ts` (read its `vi.mock("@bis/db")` factory and its auth mock; add `getAutomation` to the factory if it is bare — the factory check):

```ts
describe("S-09 PR 2: the Spanish box on save", () => {
  it("a box equal to our Spanish stores null and leaves the basis (C13; mutation: store the literal -> FAILS)", async () => {
    dbMocks.getAutomation.mockResolvedValue({ body_es: null, body_es_basis: null });
    const fd = form({ enabled: "on", channel: "email", review_url: "https://g.page/r", body: "",
      body_es: "¡Gracias por elegir a Rio Roofing! Si tiene un minuto, nos ayuda mucho que nos deje una reseña:" });
    await saveReviewRequestAction("acct_1", fd);
    expect(dbMocks.upsertAutomation.mock.calls[0]![3]).toMatchObject({ bodyEs: null, bodyEsBasis: null });
  });
  it("an edited Spanish moves the basis to the saved English", async () => { /* body: "Thanks!", body_es: "¡Gracias!" → bodyEs "¡Gracias!", bodyEsBasis "Thanks!" */ });
  it("an English-only edit keeps the old basis, so the card warns (mutation: always move it -> FAILS)", async () => { /* stored { body_es: "Viejo.", body_es_basis: "Old." }, body: "New.", body_es: "Viejo." → bodyEs "Viejo.", basis "Old." */ });
  it("a Spanish over 1,000 characters is refused like the English (mutation: skip the check -> FAILS)", async () => { /* body_es: "a".repeat(1001) → { ok: false, error: m["automations.bodyTooLong"] }, no upsert */ });
  it("the confirmation card's stored '' survives an unrelated save (F1)", async () => { /* saveAppointmentConfirmAction, stored body_es "", body_es "" → bodyEs "" */ });
});
```

Write each commented case out in full with the file's own `form()` / mock names (read them; the comment states inputs and expectations exactly). "Rio Roofing" must be what the action's brand read returns in the test (the action renders `defaultEs` from the account's `brandDisplayName`: read how `saveReactivationAction` reads `getBranding`, `actions.ts:15`, and use the same read here). One wiring case per card file (four): the rendered card contains `name="body_es"` with our Spanish rendered for the brand, `lang="es"`, the English box's label `"English message"`, both inside ONE `<form>`, and exactly ONE `data-variant="default"` button (rule 8; mutation: render SpanishBodyField outside the form, or give Use our Spanish `variant="default"` → FAILS). The text-reminder card's Spanish preview starts `"Recordatorio: su cita con "` and ends with the Spanish opt-out line (its `composeEs`).
- [ ] **Step 2: Run, see them fail.** `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/automations/automations-settings.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/automations/no-show-nudge-card.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/automations/sms-reminder-card.test.ts" "src/app/(dashboard)/dashboard/accounts/[accountId]/automations/appointment-confirm-card.test.ts"`. Paste.
- [ ] **Step 3: Implement.** Each of the four actions, after its English `body` is validated:

```ts
  const brandName = brandDisplayName(await getBranding(serviceDb(), accountId));   // the read saveReactivationAction already makes
  const es = await spanishBoxPatch(accountId, "review_request", formData, body, defaultReviewRequestBody(brandName, "es"));
  if (!es.ok) return es;
  // …upsertAutomation(serviceDb(), accountId, "review_request", { enabled, body, config, bodyEs: es.bodyEs, bodyEsBasis: es.bodyEsBasis }, userId)
```

(`defaultEs`: review `defaultReviewRequestBody(brandName, "es")`; no-show `defaultNoShowNudgeBody(brandName, "es")`; text reminder `defaultSmsReminderBody("es")`; confirmation `""`, plan deviation 4. Read `getBranding`'s signature at its declaration and `brandDisplayName`'s import before writing; both are already imported or exported from `@bis/db`.) Each card: wrap the existing English `Textarea` block and the new field in `<div className="grid gap-4 md:grid-cols-2">`. The English box's label becomes `m["automations.bodyEn.label"]` ("English message") on the review, no-show, referral, reactivation, quote, follow-up and text-back cards; the two closing-line cards (text reminder, confirmation) keep their "Closing line" label unchanged, because it says what the field is, and the Spanish box beside it ("Spanish message") makes the pair plain. Then:

```tsx
<SpanishBodyField
  idPrefix="review"
  stored={{ bodyEs: automation?.body_es ?? null, stale: spanishIsStale({ body: automation?.body ?? "", bodyEs: automation?.body_es ?? null, bodyEsBasis: automation?.body_es_basis ?? null }) }}
  defaultEs={defaultReviewRequestBody(brandName, "es")}
  composeEs={(text) => (channel === "sms" ? withOptOut(composeReviewRequestSms(text, reviewUrl.trim()), "es") : text)}
  sms={channel === "sms"}
/>
```

Text reminder: `composeEs={(text) => withOptOut(composeSmsReminder(brandName, formatWhen(SMS_REMINDER_PREVIEW_INSTANT, safeZone(accountTimezone, "UTC"), "es"), text || defaultSmsReminderBody("es"), "es"), "es")}` (the preview is the sent string, the card's own rule at `sms-reminder-card.tsx:38-51`). Confirmation: `composeAppointmentConfirm(brandName, <the card's preview when, in es>, text, "es")` wrapped in `withOptOut(…, "es")`. `spanishIsStale` is imported from `@bis/db` in a client component: it is pure, but importing the `@bis/db` barrel into a client bundle may pull server code. **Check first:** does any existing `"use client"` file import a VALUE (not a type) from `@bis/db`? (`grep -rln '"use client"' apps/web/src | xargs grep -ln 'import {[^}]*} from "@bis/db"' | xargs grep -L "import type"`.) If none does, compute `stale` in `page.tsx` (server) and pass it to each card as a prop `spanishStale: boolean` instead, and say so in the report.
- [ ] **Step 4: Run, see them pass**, plus `page.test.ts` and `src/lib/i18n/ratchet.test.ts` (no new JSX literal). `pnpm --filter web typecheck`; eslint on the touched files. Paste.
- [ ] **Step 5: Probes:** skip the Spanish length check (its case fails); `stillMatches: true` always (the English-only case fails); render `SpanishBodyField` after `</form>` in `no-show-nudge-card.tsx` (its wiring case fails) — SIBLING: the same in `sms-reminder-card.tsx` (fails).
- [ ] **Step 6: Commit.** `git commit -m "feat(automations): review, no-show, text-reminder and confirmation cards get a Spanish box beside the English, one Save each (S-09 PR 2)" -- <the files>`

---

## Task 16: Spanish boxes, cards B — referral, reactivation, quote (bis-automations)

**Review:** sonnet. **Depends on:** Task 15 (shared `actions.ts`, `page.tsx`).

**Files:** `…/automations/actions.ts:96-245` (referral, reactivation, quote); `actions.test.ts`; `referral-ask-card.tsx`, `reactivation-card.tsx`, `quote-followup-card.tsx` and their tests.

- [ ] **Step 1: Failing tests**, Task 15's shape: one save case per action (an edited Spanish moves the basis; a box equal to our Spanish stores null) and one wiring case per card (`name="body_es"`, our Spanish for the brand, one primary). The reactivation card is email-only (`sms: false`, no part count, no accent line).
- [ ] **Step 2: Run, see them fail** (the four test files by path).
- [ ] **Step 3: Implement** with `spanishBoxPatch` and `defaultEs` = `defaultReferralAskBody(brandName, "es")`, `defaultReactivationBody(brandName, "es")`, `defaultQuoteFollowupBody(brandName, "es")`; each card's `composeEs` is the card's existing preview composer with `"es"`, wrapped in `withOptOut(…, "es")` on SMS channels.
- [ ] **Step 4: Run, see them pass.** Paste.
- [ ] **Step 5: Probes:** `defaultEs` passed as the ENGLISH default in `saveReferralAskAction` (the "equals our Spanish → null" case fails); SIBLING in `saveQuoteFollowupAction`.
- [ ] **Step 6: Commit.** `git commit -m "feat(automations): referral, check-in and quote cards get their Spanish box (S-09 PR 2)" -- <the files>`

---

## Task 17: The calendar follow-up's box, and the cancel dialog's pre-selection (bis-booking)

**Review:** sonnet. **Depends on:** Tasks 4, 6, 14.

**Files**
- Modify: `…/calendar/actions.ts:110-143` (`updateCalendarSettingsAction`), `actions.test.ts`
- Modify: `…/calendar/calendar-settings.tsx:58-68`, `:225-245` (the follow-up block)
- Modify: `…/calendar/cancel-notice-draft.ts:12-30`, `cancel-notice-draft.test.ts`; `cancel-dialog.tsx:31-45`; `bookings-list.tsx:18`, `:140-150`; `page.tsx` (passes `accounts.language`), `page.test.ts`

**Interfaces**
- Consumes: `nextSpanishBox`, `spanishIsStale`, `recipientLanguage` (`@bis/db`); `defaultFollowupBody` (Task 4); `CalendarRow.followup_body_es(_basis)`, `CalendarSettingsPatch.followupBodyEs(Basis)`, the list row's `contact_language` (Task 6).
- Produces: `initialDraft(locale: PublicLocale = "en"): NoticeDraft`; `CancelDialog` prop `defaultLocale: PublicLocale`.

- [ ] **Step 1: Failing tests.** `actions.test.ts`: (a) a follow-up Spanish box equal to `defaultFollowupBody("es")` stores `followupBodyEs: null`; (b) an edited Spanish stores it and `followupBodyEsBasis` = the saved English; (c) an English over 1,000 characters is now refused with `m["automations.bodyTooLong"]` (plan deviation 6; mutation: no English check → FAILS); (d) a Spanish over 1,000 is refused. The stored row for "unchanged" comes from the calendar read the action already makes or `getOrCreateCalendar` on the SAME request client (never the service client: this write is client-role, `0022:12-13`, and 0076 granted the two columns). `cancel-notice-draft.test.ts`: `initialDraft("es")` → `{ send: true, locale: "es", message: <bookingStrings("es").cancelNoticeDefault> }`; `initialDraft()` unchanged (mutation: ignore the argument → FAILS). A `bookings-list` render case (or the page test): a booking whose contact is `es` opens the dialog with `defaultLocale: "es"`; a contact with none on an `es` account → `"es"`; `en` contact on an `es` account → `"en"` (C18; mutation: account before contact → FAILS).
- [ ] **Step 2: Run, see them fail** (`calendar/actions.test.ts`, `cancel-notice-draft.test.ts`, `page.test.ts`, and the list's test if any; never the folder).
- [ ] **Step 3: Implement.** In the action, after `followupBody` (`:122`):

```ts
  if (followupBody.trim().length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };
  const submittedEs = String(formData.get("body_es") ?? "");
  if (submittedEs.trim().length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };
  const current = await getOrCreateCalendar(db, accountId, userId);   // the request client, as the update below
  const es = nextSpanishBox({
    submitted: submittedEs, useOurs: formData.get("body_es_use_ours") === "1",
    stillMatches: formData.get("body_es_still_matches") === "on", defaultEs: defaultFollowupBody("es"),
    body: followupBody, stored: { bodyEs: current.followup_body_es, basis: current.followup_body_es_basis },
  });
  // …updateCalendarSettings(db, accountId, { …, followupBody, followupBodyEs: es.bodyEs, followupBodyEsBasis: es.basis }, userId)
```

(`db` = the `await dbForRequest()` the action already uses, hoisted into a const; read whether the action already reads the calendar and reuse that read if so.) `calendar-settings.tsx`: the follow-up block becomes `grid gap-4 md:grid-cols-2` with the existing English textarea and `<SpanishBodyField idPrefix="followup" stored={{ bodyEs: calendar.followup_body_es, stale: <server-computed or spanishIsStale(…)> }} defaultEs={defaultFollowupBody("es")} composeEs={(x) => x} sms={false} />` (the same client-import check as Task 15 Step 3). `cancel-notice-draft.ts`: `export function initialDraft(locale: PublicLocale = "en"): NoticeDraft { return { send: true, locale, message: defaultFor(locale) }; }`. `cancel-dialog.tsx:40`: `useState<NoticeDraft>(() => initialDraft(defaultLocale))`. `bookings-list.tsx`: the `Booking` type gains `contact_language: string | null`; the list takes an `accountLanguage: "en" | "es" | null` prop and passes `defaultLocale={recipientLanguage(booking.contact_language, accountLanguage)}`; `page.tsx` reads `accounts.language` with the account read it already makes (read it; add `language` to its select).
- [ ] **Step 4: Run, see them pass.** Paste.
- [ ] **Step 5: Probes:** no English length check (c fails); `initialDraft` ignoring its argument; `recipientLanguage(accountLanguage, booking.contact_language)` (C18 case fails).
- [ ] **Step 6: Commit.** `git commit -m "feat(booking): the calendar follow-up gets its Spanish box, and a business cancel notice starts in the customer's language (S-09 PR 2)" -- <the files>`

---

## Task 18: The text-back card's box (bis-voice)

**Review:** sonnet. **Depends on:** Tasks 12, 14.

**Files:** `…/voice/actions.ts:60-97` (`saveVoiceProfileAction`), `actions.test.ts`; `…/voice/voice-settings.tsx:60-120`, `:240-260`, and its test (read the folder for the test's name).

- [ ] **Step 1: Failing tests.** Save: (a) Spanish equal to `defaultTextbackBody(brand, "es")` stores `textback_body_es: null`; (b) edited Spanish stores it with `textback_body_es_basis` = the saved English; (c) English over 1,000 now refused (plan deviation 6); (d) Spanish over 1,000 refused. The stored row for "unchanged" comes from `getVoiceProfile` on `serviceDb()` (read its name in `packages/db/src/voice.ts`; the save is agency-only on the service client, as today). Card: `name="body_es"` beside the English text-back box, one primary.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** In the action's `patch` (`:74-86`): validate both lengths, compute `nextSpanishBox({ …, defaultEs: defaultTextbackBody(brandName, "es"), body: patch.textback_body, stored: { bodyEs: current?.textback_body_es ?? null, basis: current?.textback_body_es_basis ?? null } })` and add `textback_body_es`, `textback_body_es_basis` to the patch. `brandName` from the branding read the page already makes (read it; the action may need `getBranding` like the automations actions). Card: the box beside the existing text-back textarea, `sms`, `composeEs={(x) => withOptOut(x || defaultTextbackBody(brandName, "es"), "es")}` (the card's own preview rule, `voice-settings.tsx:98-116`).
- [ ] **Step 4: Run, see them pass.** Paste.
- [ ] **Step 5: Probes:** store the literal (a fails); skip the English check (c fails).
- [ ] **Step 6: Commit.** `git commit -m "feat(voice): the missed-call text-back card gets its Spanish box (S-09 PR 2)" -- <the files>`

---

## Task 19: "Not set" names the account's language again (bis-crm)

**Review:** sonnet. **Depends on:** Task 3.

**Files**
- Modify: `apps/web/src/lib/contacts/language.ts:61-75` (`languageView`, its comment), `language.test.ts:72-76`
- Modify: `…/accounts/contacts/[contactId]/page.tsx:185`; `…/summary/route.ts:122`, `route.test.ts`

**Interfaces**
- Produces: `languageView(c, opts: { zone: string; tr: Tr; accountLanguage: ContactLanguage | null | undefined })`. `undefined` = the account row could not be read (both callers log it and carry on, `page.tsx:112-114`, `route.ts:72-74`).

- [ ] **Step 1: Failing test** (replace the PR 1 case at `language.test.ts:72-76`; read the file's `view()` helper and give it an `accountLanguage` argument):

```ts
  it("not set names the effective fallback now that sends follow it (C8, spec §8.2; mutation: always notSet -> FAILS)", () => {
    expect(view(NONE, "en", null).phrase).toBe("Not set. Messages go out in English.");
    expect(view(NONE, "en", "es").phrase).toBe("Not set. Messages go out in Spanish, the account's language.");
    expect(view(NONE, "en", "en").phrase).toBe("Not set. Messages go out in English, the account's language.");
    expect(view(NONE, "es", "es").phrase).toBe("Sin definir. Los mensajes salen en español, el idioma de la cuenta.");
  });
  it("an unreadable account says only 'Not set.', never a guess (mutation: treat undefined as null -> FAILS)", () => {
    expect(view(NONE, "en", undefined).phrase).toBe("Not set.");
    expect(view(NONE, "es", undefined).phrase).toBe("Sin definir.");
  });
```

`route.test.ts`: with the account row `{ timezone, language: "es" }` the drawer's `who.language.phrase` is `"Not set. Messages go out in Spanish, the account's language."`; with the account read failing it is `"Not set."`.
- [ ] **Step 2: Run, see them fail.** `pnpm --filter web exec vitest run src/lib/contacts/language.test.ts "src/app/api/accounts/[accountId]/contacts/[contactId]/summary/route.test.ts"`.
- [ ] **Step 3: Implement.**

```ts
/**
 * The Details line (§8.2). Not set names what the customer gets (C8): the account's language when it is
 * set ("…, the account's language."), English when it is not, and only "Not set." when the account row
 * could not be read (saying "in English" then could be false). Live since S-09 PR 2, which made scheduled
 * sends follow the account's language.
 */
export function languageView(
  c: ContactLanguageFacts, opts: { zone: string; tr: Tr; accountLanguage: ContactLanguage | null | undefined },
): LanguageView {
  const { tr } = opts;
  if (c.language === null || c.language_source === null || c.language_set_at === null) {
    const phrase = opts.accountLanguage === undefined
      ? tr.text("contact.language.notSetUnknown")
      : opts.accountLanguage === null
        ? tr.text("contact.language.notSet", { language: tr.text(NAME_KEY.en) })
        : tr.text("contact.language.notSetAccount", { language: tr.text(NAME_KEY[opts.accountLanguage]) });
    return { value: null, valueLabel: null, phrase, hint: null };
  }
  // …unchanged…
}
```

`page.tsx:185` and `route.ts:122`: `languageView(contact as unknown as ContactLanguageFacts, { zone: zone.zone, tr, accountLanguage: accountRow ? (accountRow.language ?? null) : undefined })`.
- [ ] **Step 4: Run, see them pass**, plus the record page's test that renders the Details line (`grep -rln "languageView\|notSet" apps/web/src --include=*.test.ts`). Paste.
- [ ] **Step 5: Probes:** `accountLanguage ?? null` at the top (the unreadable case fails); pass `undefined` from `route.ts` always (the route case fails) — SIBLING: the same in `page.tsx` (find the page test that would fail, or add one).
- [ ] **Step 6: Commit.** `git commit -m "feat(contacts): a customer with no language reads what they get, the account's language, now that messages follow it (S-09 PR 2)" -- <the five files>`

---

## Task 20: Regenerate the i18n baselines (bis-comms)

**Depends on:** Tasks 3, 14–19 committed.

- [ ] **Step 1.** `pnpm --filter web exec vitest run src/lib/i18n/ratchet.test.ts` → read what it reports: the catalogue baseline's frozen list shrank (every twin Task 3 added) and possibly per-file counts. Regenerate with the command the test file's own header names (read it; never hand-edit the JSON).
- [ ] **Step 2.** Re-run → green. `git diff --stat` shows only the two baseline files. Paste the summary.
- [ ] **Step 3: Commit.** `git commit -m "chore(i18n): baselines after S-09 PR 2 (Spanish twins for scheduled customer messages)" -- apps/web/src/lib/i18n/catalogue-baseline.json apps/web/src/lib/i18n/ratchet-baseline.json`

---

## Task 22: e2e (bis-e2e-qa)

**Depends on:** Tasks 15, 20.

**Files:** Create `apps/web/e2e/automations-spanish.spec.ts`.

- [ ] **Step 1.** Read `e2e/automations.spec.ts:1-60` (its fixture read, the agency session, how it opens `/dashboard/accounts/{id}/automations`) and copy that setup. Before the test, read the fixture account's `review_request` row with `serviceDb()` (`getAutomation`) and keep it.
- [ ] **Step 2: The spec.**

```ts
import { test, expect } from "./fixtures/test";
import { readFileSync } from "node:fs";
import { serviceDb, getAutomation, upsertAutomation, getBranding, brandDisplayName } from "@bis/db";
import { m } from "../src/lib/messages";

type ClientFixture = { accountId: string; clerkUserId: string };
const fixture = (): ClientFixture => JSON.parse(readFileSync("e2e/.auth/client-fixture.json", "utf-8")) as ClientFixture;

test.describe("S-09 PR 2: the review card's Spanish box (fixture account only)", () => {
  test("opens with our Spanish; an English-only edit warns; emptied says so; Use our Spanish refills", async ({ page }) => {
    const { accountId, clerkUserId } = fixture();
    const db = serviceDb();
    const before = await getAutomation(db, accountId, "review_request");
    const brand = brandDisplayName(await getBranding(db, accountId));
    const ours = m["automations.review.defaultBody.es"].replace("{name}", brand);
    try {
      await upsertAutomation(db, accountId, "review_request",
        { enabled: false, body: "", config: { channel: "email", reviewUrl: "https://example.com/r" }, bodyEs: null, bodyEsBasis: null }, clerkUserId);
      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("review-request-card");   // read the card's real test id
      const es = card.locator('textarea[name="body_es"]');
      await expect(es).toHaveValue(ours);

      await card.locator('textarea[name="body"]').fill("Thanks for having us out, it means a lot.");
      await card.getByRole("button", { name: m["automations.review.save"] }).click();   // read the real save key
      await page.reload();
      await expect(card.getByText(m["automations.bodyEs.stale"])).toBeVisible();

      await es.fill("");
      await expect(card.getByText(m["automations.bodyEs.emptied"])).toBeVisible();
      await card.getByRole("button", { name: m["automations.bodyEs.useOurs"] }).click();
      await expect(es).toHaveValue(ours);
    } finally {
      const restore = before
        ? upsertAutomation(db, accountId, "review_request", { enabled: before.enabled, body: before.body, config: before.config as Record<string, unknown>, bodyEs: before.body_es, bodyEsBasis: before.body_es_basis }, clerkUserId)
        : db.from("automations").delete().eq("account_id", accountId).eq("recipe_key", "review_request").then(({ error }) => { if (error) throw error; });
      await restore.catch((e: unknown) => console.error(`automations-spanish e2e: restore failed: ${String(e)}`));
    }
  });
});
```

(The page is agency-only: use the agency storage state the existing automations spec uses for its agency tests, never the client one. Read the review card's `data-testid` and the save button's key, `automations.review.save` is an **Assumption**.)
- [ ] **Step 3.** Typecheck the e2e project as `apps/web/package.json` names it and run `pnpm --filter web exec vitest run e2e/fixtures/fixture-names.test.ts`. Do not run Playwright; the orchestrator does.
- [ ] **Step 4: Commit.** `git add -- apps/web/e2e/automations-spanish.spec.ts && git commit -m "test(e2e): the review card's Spanish box, its stale and emptied lines and Use our Spanish (S-09 PR 2)" -- apps/web/e2e/automations-spanish.spec.ts`

---

## Task 23: Whole-branch final review (checkpoint)

**Reviewer:** opus, fresh context, after Tasks 8–20 and 22.

- [ ] **Step 1.** Read the spec end to end (including "Decided 2026-10-13" and the PR 2 notes in §8.2, §15.2), this plan's deviations and findings, then `git diff f47e27ca...HEAD` in `<WT>`; walk the coverage table below row by row.
- [ ] **Step 2.** Web tests by path: every test file Tasks 2–5, 8–19 touched, plus `src/lib/i18n/ratchet.test.ts`, `src/lib/i18n/spanish-sms-gsm.test.ts`, `src/lib/messages.test.ts`, `src/lib/automations/imports.test.ts`, `src/lib/email/templates/brand-name-parity.test.ts`, `src/components/ui/material.test.ts`; `pnpm --filter web typecheck`. The db files of Tasks 1, 6, 7 by path. Re-run two probes of your own choosing, by name, each on a SIBLING copy the implementer did not probe.
- [ ] **Step 3.** Hunt specifically: (a) a scheduled sender that passes `row.language` instead of `chooseBody`'s returned language to its template, date, subject, footer or gate (C11); (b) an in-the-moment sender (confirmation, lead receipt, instant reply, consent replies) that now reads `contacts.language`; (c) a gate call without `language`; (d) a Spanish SMS string with á/í/ó/ú, or a texted Spanish date not folded; (e) a save that can write `body_es` when the form did not carry the box (the instant reply, C15), or that stores our default's literal; (f) a second primary in any card; (g) the late rule reading the recipe or the sender for NON-late rows; (h) `accounts.name` reaching a customer; (i) a test that cannot fail (memory "vacuous test shapes"); (j) any DDL.
- [ ] **Step 4.** Report findings by severity with file:line.

---

## Task 21: Rollout (orchestrator; LAST; not a coding task)

No migration. Each step reads its own evidence; nothing is inferred from an earlier run.

- [ ] **Step 1. Q10, read-only on production (spec §18.4).** Through the MCP `execute_sql`:

```sql
select id, brand_name from public.accounts where language = 'es';
select a.brand_name, count(c.id) as no_language_contacts
  from public.accounts a join public.contacts c on c.account_id = a.id
 where a.language = 'es' and c.language is null group by a.brand_name;
select language, count(*) from public.contacts where language is not null group by language;
```

The 2026-10-13 read found zero `es` accounts; this re-read is the one that counts. If any row comes back, STOP and name each account (brand name, never `accounts.name`) and its count to danlo; the merge waits for his word that each client has heard it from BIS (Q10). Ledger: the counts.
- [ ] **Step 2. The length read (plan deviation 6), read-only on production:**

```sql
select max(char_length(followup_body)) as followup_max from public.calendars;
select max(char_length(textback_body)) as textback_max from public.voice_profiles;
select max(char_length(body)) as automations_max from public.automations;
```

Any value over 1,000: STOP; the owner chooses between raising the cap for that field and asking the client to shorten it.
- [ ] **Step 3. Gates, one at a time:** `pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e` (after checking no `screenshots.yml` run is in progress). The `forms.spec` unread-badge flake is unrelated; never loosen it. Push; read `verify` and `e2e` FOR THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`).
- [ ] **Step 4. The guarded Q1 re-run — bis-ci, then production, as the LAST step before the merge (finding F2: never after PR 2 is live).** On each project, first the read-only counts with the exact predicates:

```sql
select count(*) from public.automations
 where body ~ '[^[:space:]]' and body_es is null and body_es_basis is null and recipe_key <> 'instant_reply';
select count(*) from public.calendars
 where followup_body ~ '[^[:space:]]' and followup_body_es is null and followup_body_es_basis is null;
select count(*) from public.voice_profiles
 where textback_body ~ '[^[:space:]]' and textback_body_es is null and textback_body_es_basis is null;
```

Record them. Then, through the MCP `execute_sql` (the destructive-SQL prompt is auto-answered, memory "Supabase MCP prompts"; read the hook log after), the three guarded updates, each with `returning` so the row count is read, not inferred:

```sql
update public.automations set body_es = ''
 where body ~ '[^[:space:]]' and body_es is null and body_es_basis is null and recipe_key <> 'instant_reply'
returning id;
update public.calendars set followup_body_es = ''
 where followup_body ~ '[^[:space:]]' and followup_body_es is null and followup_body_es_basis is null
returning id;
update public.voice_profiles set textback_body_es = ''
 where textback_body ~ '[^[:space:]]' and textback_body_es is null and textback_body_es_basis is null
returning id;
```

Each returned count equals its pre-count. Re-run the three counts: each is now 0. bis-ci first; production only after bis-ci's numbers match. The guard never touches a row whose Spanish was written (`body_es` not null), emptied already, or touched by PR 2's save (`body_es_basis` not null), nor `instant_reply` (C15). Ledger line: `S-09 PR 2 guarded Q1 re-run <date>: bis-ci <n/n/n>, prod <n/n/n> — NEVER re-run after PR 2 deploys (F2)`.
- [ ] **Step 5. Merge** (squash, through the PR, the head SHA's `verify` and `e2e` green, Task 23's findings closed). The PR body names: the Q10 result; F3's window; that the late 08:00 email starts at once on every account without texting; that the Spanish copy is usted while confirmations are still tú (Q5's follow-up pass).
- [ ] **Step 6. After the deploy is READY at the merge SHA,** read-only the next morning: the reminders' log rows since the deploy grouped by status (`select status, count(*) from public.automation_log where source = 'reminders' and occurred_at > '<deploy time>' group by status`; columns per `automation-log.ts:43`, the status values per its `AutomationLogStatus` — read them, **Assumption** that a released send is logged there), and the outbound email messages' statuses since the deploy (no bounce from a malformed Spanish subject). Ledger: the roadmap tracker row for item 5 (PR 2 merged).

---

## Spec coverage

| Spec | Where |
|---|---|
| L2 Spanish box on every editable message, pre-filled, stale warning, emptied → English, no machine translation | Tasks 1, 14, 15, 16, 17, 18 |
| L3 contact → account → English | Task 1 (`recipientLanguage`), Tasks 6, 7 (mappers) |
| D5 live replies unchanged; scheduled sends follow L3 | Tasks 8–12 (scheduled), Task 8's pin (live), Task 12 (text-back stays live) |
| D5 late-booking gap, exact threshold | Task 13 (+ deviation 1, 2) |
| C11 one message, one language | Task 1 (`chooseBody`'s returned language), Tasks 4, 8–12 |
| C12 one resolver, in the mapper | Tasks 1, 6, 7 |
| C13 three states, default → null | Task 1 (`nextSpanishBox`, + deviation 3, F1), Tasks 15–18 |
| C14 staleness by basis | Task 1, Task 14, Tasks 15–18 |
| C15 the text reminder's closing line gets a box; the instant reply untouched | Tasks 9, 15; Task 7 (`upsertAutomation` writes the box only when named) |
| C16 / Q3 the 08:00 late reminder | Task 13 |
| C18 the cancel dialog pre-selects | Task 17 (+ deviation 9) |
| C19 GSM-7 Spanish, folded dates | Tasks 2, 3 (guard), 5, 9 (+ deviation 10) |
| §10.4 gates unchanged, told the language | Tasks 8–12 (each probes its gate call) |
| §11.1 reminder email in Spanish, `?locale=es` | Tasks 4, 9 (+ deviation 8) |
| §11.2 text reminder in Spanish, preview in both | Tasks 5, 9, 15 |
| §12.2 the box's states, accent hint, one Save | Task 14, Tasks 15–18 |
| §14 Settings says the account's language now governs | Task 3 (`settings.language.description`) |
| §15.1, §15.3 copy | Task 3 |
| §8.2 / §15.2 / PR 1 I-2: Not set names the account's language | Task 3 (keys), Task 19 |
| PR 1 deviation 2: both languages length-validated | Tasks 15–18 (+ deviation 6), Task 21 step 2 |
| §16.2 unit tests (PR 2 rows) | Tasks 1–19 |
| §16.3 e2e (PR 2) | Task 22 |
| §18.4 Q10 named before merge | Task 21 step 1 |
| Q1 keep their English, re-run guarded before deploy | Task 21 step 4 (+ F2, F3) |
| No migration (Q6) | Global Constraints; Task 23 (j) |
