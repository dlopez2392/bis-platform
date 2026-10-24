# The one switch (open, closed today, running late, storm) and planned closed days, PR S-47d (F-084, migration 0097): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. **Ceremony is tiered PER TASK** (owner rule 2026-10-19, binding; spec §9; memory "Speed process"): read each task's tier before dispatching it. HIGH gets the full ceremony; MEDIUM gets one review; LOW gets a short brief and no per-task review. One end-of-PR final review (opus), one design review, then ONE fix agent.

**Goal:** an Owner, the agency or (for Running late only) Staff flips one switch per account: Open, Closed today, Running late (about 15, 30 or 60 minutes, or over an hour) or Storm (with an optional back-on date). Owners and the agency also plan whole closed days. The booking page stops offering the closed times. Sofía and the website chat say the business is closed or running late. Reminders for covered appointments are held, and one To-do lists the customers to contact. All copy is in English and Spanish.

**Architecture:**
- **Migration 0097** adds:
  - `business_status`: one row per account; no row means open.
  - `closed_days`: date ranges, each with an optional reason from a fixed list.
  - `calls.business_status`: what each call was told.
  - Two closure-link columns on `tasks`, with a once-per-day unique index.
  - `bookings.closure_kept_at`.
  - Two stamp triggers, and `app.keep_task_links` re-created.
  - Grants and RLS: Owners and the agency write. Staff may only move between Open and Running late, enforced in the policy.
- **A pure reader** (`apps/web/src/lib/business-status/status.ts`) turns the row, the closed days and the hours chain into one `EffectiveStatus`. Every consumer reads it: the slot engine, the prompt, the topbar, the dashboard card, the booking page, the hold gate and the actions. Expiry is computed on read, so no cron is needed.
- **The slot engine** gains one predicate, `closedOut`. Both the picker and the submit check apply it, so every caller is covered without a call-site change.
- **The prompt** gains a TODAY line, a CLOSED DAYS block and closure-aware Right now / AFTER HOURS lines. With no closure it is byte-identical (`PRE_S47D_DIGEST`). The knowledge payload goes to schema 2 (`closed_days`) and renderer version 2.
- **The send gate** (`holdOrSend`) gains a closure check for the seven booking recipes. A per-tick memoised loader reads each account once. Every switch change, Keep and closed-day removal calls `bumpHeldForAccount`, which releases held rows on the next tick.
- **The UI** uses existing surfaces only:
  - the topbar indicator and its menu;
  - a status card on the account dashboard;
  - a Closed days card on the Calendar page;
  - the booking page's notice;
  - a line on the call page;
  - a section on the knowledge page.

**Tech stack:** Next.js App Router (server components, server actions), Supabase Postgres + PostgREST, plpgsql, vitest, Playwright, `pg`, Radix (shadcn) `DropdownMenu`/`Dialog`, `sonner`.

**Spec:** `docs/superpowers/specs/2026-10-23-one-switch-design.md`, as amended in this plan's fix-round commit.
- D1–D12 are the owner's and are not reopened. S1–S22 are binding except where "Spec deviations" below records code evidence against one.
- **Fix round (2026-10-23, after the opus plan review):**
  - Owner ruling **D12**: Closed today's window ends at midnight; the reopening said and shown is still the hours chain's.
  - The orchestrator's **S22**: the dashboard card lists every covered appointment, up to 14 days.
  - Nine findings applied: the `security definer` byte rule; the cross-account insert probe; Keep per subject; the Staff 26-hour bound; S22; the hold's own-account case; the midnight-DST fixtures; the two-day trigger slack; SD19 and the teardown doc comment.
  - The spec carries all of it in the same commit.
- Every file:line below was read at `d280b847` (= `origin/main` `5e9c07a7` + the spec; `git diff 5e9c07a7 d280b847 --stat` touches only the spec file).
- **Task 0 rebases the branch onto main after 0096 merges.** Every cite into a file that the 0096 PR changes must then be re-read. That PR changes:
  - the call page, the knowledge page and the Services card (with their tests);
  - `messages.ts` and `facts-warnings.ts`;
  - 14 db test files and `definer-search-path.test.ts`.

  `git diff --stat origin/main origin/fix/s47c-followups`, read 2026-10-23, lists 24 files.

**Base:** `feat/s47d-switch` at `d280b847`, rebased onto `origin/main` once 0096 has merged (Task 0).
- `<WT>` = `C:\Users\danlo\bis-platform\.claude\worktrees\s47d` (Git Bash: `/c/Users/danlo/bis-platform/.claude/worktrees/s47d`).
- `<SCRATCH>` = the orchestrator's session scratchpad. Each brief carries it literally, plus a subdirectory of its own per agent.
- `<KIT>` = `/c/Users/danlo/AppData/Local/Temp/claude/C--Users-danlo-bis-platform/ec121ebe-7e97-4a98-9a73-44be5c530909/scratchpad/s15e-kit` (`replica.sh`, `pgrst.sh`; read 2026-10-23, lines cited under Global constraints).

Path abbreviations:
- `[acct]` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]`
- `…/incoming/` = `apps/web/src/app/api/voice/incoming/`
- `…/turn/` = `apps/web/src/app/api/concierge/[publicId]/turn/`
- `…/websession/` = `apps/web/src/app/api/voice/web/session/`
- `…/knowledge/` = `apps/web/src/lib/voice/knowledge/`
- `…/bstatus/` = `apps/web/src/lib/business-status/` (new)
- `…/passes/` = `apps/web/src/lib/automations/passes/`
- `…/b/` = `apps/web/src/app/b/[publicId]/`

---

## Plan-writer check (done 2026-10-23, before this plan was committed; re-run in the fix round)

The SQL in Task 1 Step 4 was applied, exactly as printed there, to the plan writer's own PG18 replica on port 55470:
- `pre` = every migration through 0095, plus 0096. The fix-round run took 0096 from `origin/main` `964a46bd` (#285); `git diff 88edf276 origin/main -- …0096_definer_search_path.sql …definer-search-path.test.ts` prints nothing, so it is the same file the first run used. Its NOTICE read "77 functions now list pg_temp last".
- `post` = `pre` + 0097.

**Fix-round re-run** (the revised SQL: items 1, 4 and 8 and D12's comments):
- **Digest:** still `52|b66203ca5d355155540b520af510d120`; none of the changes adds a table-level grant.
- **Tests on `post`:** `definer-search-path.test.ts` (from main) is GREEN. Across `schema-grants-guard`, `proposals-drop` and the seven schema suites below, 10 files ran and 259 of 261 tests passed. The only two failures are the `EXPECTED_WRITES` and digest literals Task 1 updates.
- **Rollback:** exact, as below.
- **New probes:**
  - Staff `running_late` with `until = now() + 99 days` → 42501. The same with `+ 25 hours` → 1 row. An Owner with `+ 99 days` → 1 row (the bound is Staff only).
  - The window: `current_date - 2` is accepted; `current_date - 3` is refused with the new sentence.
  - Account B's Owner inserting into account A is refused 42501, with and without `returning`.
  - With `closed_days_owner_insert` stripped of its `account_id` clause, the `returning` insert is STILL refused (by the read policy), but the plain insert goes through (`rows_in_a` = 1). That proves finding 2: only the plain form tests the insert policy.
- **Bytes:** `grep -ci "security definer"` now prints `0`.
- **md5:** `0c6ed6130fbdd3fd18d92a7429512a35`.

Read off it:
- **Client-write digest:** `pre` = `51|0dd3e2d7e19f3f3649a893cfd9967d94` (the literal at `packages/db/src/test/proposals-drop.test.ts:98`). `post` = **`52|b66203ca5d355155540b520af510d120`**, exactly the value spec §4.1 computed.
- **On `post`:**
  - `definer-search-path.test.ts` (copied from the 0096 branch for the run, then deleted) is GREEN.
  - `schema-grants-guard.test.ts` fails ONLY on `EXPECTED_WRITES` ("expected { …(22) } to deeply equal { …(20) }": the two new entries).
  - `proposals-drop.test.ts` fails ONLY on the digest literal.
  - `call-card-schema`, `document-expiry-schema`, `document-requests-schema`, `record-provenance-schema`, `structured-facts-schema`, `trade-modules-schema` and `server-only-writes-grants` are green: 7 files, 245 tests.
- **The three functions:** `proconfig` = `{"search_path=pg_catalog, pg_temp"}` and `prosecdef` = false for `app.business_status_stamp()`, `app.closed_days_stamp()` and `app.keep_task_links()`.
- **RLS and grant probes**, all as designed, with one finding (SD1):
  - Staff, Open → Running late: 1 row, `set_by` = the Staff sub.
  - Staff, Open → Closed today: **ERROR 42501 "new row violates row-level security policy"** (not zero rows).
  - Staff, Closed today in force → Open: 0 rows.
  - Staff, expired Closed today → Running late: 1 row.
  - Staff, open-ended Storm → Open: 0 rows.
  - Technician: 0 rows, reads 1.
  - Owner: reads 1, Open → Storm with 1 row.
  - The agency token updates both accounts.
  - Owner of A updating B: 0 rows.
  - A client updating `set_by`, or inserting into `business_status`: `permission denied`.
  - A client sending `created_by`: `permission denied`.
  - Staff inserting `closed_days`: RLS error. Staff deleting: 0 rows. Owner deleting: 1.
  - The window trigger refused a start 2 days ago (23514). The fix round moved the bound to 3 days (item 8, above).
  - A server insert stamps `created_by` = `system`.
  - A past `until` is refused by `business_status_until_check`.
  - A signed-in `tasks` insert stores `closure_kind` NULL.
  - A second closure To-do for the same account, kind and date is refused 23505 by `tasks_closure_once`.
  - As the table owner, a sent `set_by`/`set_at` is overwritten (`system`, `now()`).
- **Rollback:** the ROLLBACK block in Task 1 Step 7, run on `create database rb template post`, leaves no 0097 constraint, table, function or column. The digest is back to `51|0dd3…`, and `app.keep_task_links` has the same `md5(prosrc)` as `pre`'s (`ea8acf1dfbc3417144a994251094ffba`) and the same `proconfig`.
- **Bytes** of the printed SQL:
  - zero non-ASCII bytes and zero backslashes (a node byte count, with a positive control that counts 2 and 1);
  - exactly 16 `$`;
  - `cascade` only in the two `on delete cascade` lines;
  - no `''` at all;
  - no apostrophe in any `--` line or comment string.
- **md5 of the plan writer's file (fix round):** `0c6ed6130fbdd3fd18d92a7429512a35`. The implementer's file must match it if copied byte for byte. The first run's `d8655ef3…` is superseded.
- The replica was stopped afterwards.

---

## Spec deviations (code contradicts or under-specifies the spec; each with evidence and the resolution this plan uses)

- **SD1. A Staff update INTO a closure is refused with an error, not "zero rows".** Spec §7 (db bullet) says Staff "update zero rows for Open → Closed today, Open → Storm, Running late → Closed today, Running late → Storm".
  - Evidence: on the replica those raise `42501 new row violates row-level security policy for table "business_status"`. WITH CHECK failures raise; only a failed USING matches no row.
  - **Resolution:**
    - The four "to a closure" probes expect `{ code: "42501" }`.
    - The "out of a closure" probes (Closed today in force → Open, dated Storm → Open, open-ended Storm → Open or → Running late) and the Technician expect 0 rows.
    - `updateBusinessStatus` (Task 3) maps a PostgREST 42501 to the same refusal as 0 rows.
    - The mutation notes stand: drop the WITH CHECK state clause → the four 42501 probes FAIL; drop the USING clause → the 0-row probes FAIL.
- **SD2. A client cannot send `set_by`, `set_at` or `created_by` at all.** These are column grants, so the request is refused before any trigger runs (probe: `permission denied`). Spec §7's "the stamp triggers ignore a sent `set_by`, `set_at`, `created_by`" is therefore proven as the table owner and as `service_role` (who may write those columns), and the client case is its own "permission denied" test.
- **SD3. `reopeningFrom` with no hours.**
  - Spec §5.1 says: "the start (00:00) of the first day after `from`'s day that is not closed".
  - Closed today stores `until` = the start of tomorrow (D12), and the reader passes that midnight as `from`. Read literally, the spec's rule would then say the business reopens at the start of the DAY AFTER tomorrow. D3 says "else midnight".
  - **Resolution:** with `hours` null, the reopening is the first 00:00 **at or after** `from` whose day is not a closed day. A `from` that is exactly 00:00 counts. `reopensTimeKnown` is `hours !== null`.
- **SD4. Every surface reads the same hours chain, the website chat included.**
  - Spec §5.4.3 gives the chat the status row and the snapshot's closed days, but not the calendar's `open_hours`. The chain (D3) is business hours, else the calendar's hours, and the reader needs it to state a reopening.
  - Without it, a chat whose snapshot has no business hours would compute a `closed_day` reopening without a time. A `closed_today` stored with an 8:00 AM `until` would read as the next midnight: a day late.
  - **Resolution:** a chat turn whose payload has no business hours also reads `getCalendarForAccount(db, accountId)`. The read runs in parallel with the status read, is fail-open (null hours) and adds no round trip to a turn whose payload has hours.
- **SD5. Three of the seven booking recipes cannot see `starts_at`.**
  - Evidence: `NO_SHOW_NUDGE_SELECT` (`packages/db/src/automations.ts:441`), `REVIEW_REQUEST_SELECT` (`:263`) and `REFERRAL_ASK_SELECT` (`:1037-1038`) select `ends_at`, and their Due types carry no `startsAt`.
  - **Resolution:**
    - Task 3 adds `starts_at` to those three selects and `startsAt: string` to the three Due types and their mappers.
    - `starts_at` exists since 0016, so nothing becomes load-bearing.
    - The other four already carry it: `REMINDER_SELECT` `booking.ts:1348`, `SMS_REMINDER_SELECT` `automations.ts:591`, `APPOINTMENT_CONFIRM_SELECT` `:735`, `FOLLOWUP_SELECT` `booking.ts:1483`.
- **SD6. The hold applies only while the cover's WINDOW has not ended at the tick's `now`** (folded into spec §5.1 and §5.5.2 in the fix round; with D12 the window ends at Closed today's midnight, at the start of the day after a closed range, or at a dated storm's `until`).
  - Spec §5.1's `coversAppointment` is true for an appointment on ANY listed closed day. So a review request due today for an appointment on yesterday's closed day would be "held until the reopening" — an instant already in the past.
  - The row would then come back every tick with a past `held_until`. That is the starvation `REASONS.smsCooldown` exists to prevent (`hold-or-send.ts:122-131`).
  - **Resolution:** the closure check holds only when `cover.endsAt === null || cover.endsAt > now`. Otherwise the send goes on. This matches D6 ("they go out on the next run if the closure ends").
- **SD7. `HoldContext` is narrower than `PassContext`.**
  - Evidence: `hold-or-send.ts:52` `HoldContext = Pick<PassContext, "db" | "now">`, and the inline instant reply calls `holdOrSend({ db, now }, …)` (`apps/web/src/lib/automations/instant-reply.ts:213`).
  - **Resolution:**
    - `PassContext` gains a REQUIRED `closures: ClosureLoader`. `HoldContext` becomes `Pick<PassContext, "db" | "now"> & Partial<Pick<PassContext, "closures">>`.
    - A subject with `appointmentAt` and no loader is held for `LEDGER_RETRY_MS` with the "couldn't check" reason: fail held, never a send.
    - The hand-built `PassContext` literals in tests gain `closures: NO_CLOSURES`. Task 9 lists them.
- **SD8. Hold reasons are stored in English and shown raw.**
  - Evidence: `activity-table.tsx:53-55` renders `row.reason` verbatim, and no map from stored reason to key exists. `REASONS.ledgerRetry` is `m["automations.reason.ledgerRetry"]`, the English value (`hold-or-send.ts:92`).
  - **Resolution:** the five new reasons are catalogue keys with `.es` twins (the ratchet requires twins for a new key), referenced through `m[...]` exactly as `ledgerRetry` is. The Activity page keeps showing the stored English, as it does for every reason today.
  - Translating stored reasons is out of scope; it is noted for the owner.
- **SD9. Keep lives in the two lists of affected appointments, not in the main Calendar bookings list.** The fix round narrows it further. Per S22, the dashboard card's list covers every appointment the closure covers, through its window's end and at most 14 days ahead, each with Keep. The Closed days card's per-range list keeps its own Keep. The spec's S9 now says so.
  - S9 says Keep is "set from the dashboard card or the Calendar's bookings list".
  - The main list (`[acct]/calendar/bookings-list.tsx:206-287`) shows every booking, and most of them no closure covers.
  - **Resolution:**
    - Keep is offered in the dashboard card's list (5.6.2) and in the Closed days card's per-range list, which is on the Calendar page (5.6.3).
    - The main list's rows only gain the `id="booking-{id}"` anchor that "Cancel on the calendar" links to. The row at `:213` has no id today.
- **SD10. `keepAppointmentAction` lives in `[acct]/calendar/actions.ts`, beside `cancelBookingAction` (`:295`).**
  - It reuses `proveBooking` (`:186-195`) after a `seesWholeAccount` refusal.
  - That file is already `proven-target` in `in-account-service-reads.test.ts:69`, so the service-read list changes only for the two NEW action files (Task 8).
- **SD11. A Staff Running late on a closed day is refused by the action alone.**
  - Spec §7 asks each Staff refusal to be "checked twice, by the action and separately by RLS". The policy cannot see `closed_days`, so for a closed day only the guard refuses.
  - It is harmless: S11 puts a closed day above Running late, so the stored change would show nowhere.
  - The four row-based closures are checked twice, as asked.
- **SD12. The guard reads the EFFECTIVE status, not only the stored row.**
  - That way it refuses during a closed day (SD11) and allows an expired closure (D8).
  - `mayChangeStatus(actor, effective, change)` and `canChangeFor(actor, effective)` are the TypeScript twin of the policy plus the closed-day rule.
- **SD13. `untilFor` takes no `closedDays`.**
  - Spec §5.1 lists them as a parameter "ignored" for every change.
  - **Resolution:** the signature is `untilFor(change, hours, timezone, now)`.
- **SD14. Undo's compare-and-set compares the `set_at` STRING PostgREST returned.**
  - PostgREST returns microseconds. A JavaScript `Date` keeps milliseconds, so a round trip through `Date` would never match and every Undo would answer "Someone changed this since".
  - **Resolution:** the undo token carries `set_at` verbatim, and `updateBusinessStatus(…, { expectedSetAt })` filters `.eq("set_at", expectedSetAt)`.
- **SD15. Reopening phrases the spec does not list:**
  - A same-day reopening says "today" and "today at {t}". It cannot occur, because S1, S3 and a closed day's next-day `from` all rule it out. It is pinned anyway, so a stray state never throws inside a call.
  - At exactly seven days the Right now line keeps S-47c's "next {Weekday}" (`hours.ts:70-75`). Beyond seven it uses the dated form, S12.
- **SD16. Literals the spec gives as rules:**
  - The two `(see TODAY above)` web and demo AFTER HOURS lines.
  - The booking page's `{date}`.
  - The To-do's `{dates}`.
  - The topbar's time, weekday and month short forms.
  - The Spanish topbar forms the spec did not draft (Owner question Q1).

  Each is pinned in "The model".
- **SD17. Load-bearing sites the spec §4.3 list misses** (each names a 0097 column or table through PostgREST):
  - The agency's own To do page: `apps/web/src/app/(dashboard)/dashboard/work/page.tsx` → `listAgencyWork` → `listAccountWork` → `openTasks` (`packages/db/src/work-queue.ts:171-182`, `:56`).
  - The cron hold loader also reads `voice_profiles.business_hours` and `calendars.open_hours`. They are old columns, but they are listed for the latency read.
  - The Calendar page's Closed days card and the dashboard card read `bookings.closure_kept_at` (`listClosureAppointments`), and so does Keep.
  - The booking page itself (`…/b/(book)/page.tsx`), not only `data.ts`.

  **Resolution:** no scope change; the merge already waits for 0097 on production. The PR body and the 0097 header name them.
- **SD18. The closed-day skip reason rarely shows for a reminder released at its deadline.**
  - The releasers' own pre-checks run before `holdOrSend`:
    - `releaseReminder` skips "Appointment already started" when `startsAt <= now` (`…/passes/reminders.ts:189-192`).
    - `releaseSmsReminder` does the same (`sms-reminder.ts:177-180`).
  - So a reminder held by a closure until its deadline (= the start) is skipped with that reason, not with "Not sent: the business was closed for this appointment".
  - **Resolution:** accepted. The send is still skipped, which is the point. The closed reason is pinned at the `holdOrSend` level, where the first pass meets a passed deadline.
- **SD19. The toasts do not say "Sofía and your booking page now say so."** Spec §5.6.1's example names the persona, but an account with no voice profile still has the switch (spec S15).
  - **Resolution:** each toast says what changed on the booking page (`business.toast.*`, Task 2). `business.toast.persona` ("{persona} says so too.") is appended only when a persona name is known.
  - The spec's §5.6.1 example is updated to match in the fix round. The design reviewer reads it at 7 AM.
- **SD20. Keep is read from each due row, not from the loader** (fix-round finding 3).
  - Evidence: the first draft's loader read kept bookings with `starts_at >= now - 2 days`. But the review request runs until `REVIEW_REQUEST_MAX_AGE_MS` (61 h) after the appointment ENDS (`packages/db/src/automations.ts:176`), and the referral ask until `REFERRAL_ASK_MAX_AGE_MS` (85 h, `:997`). So a kept appointment three days old under a multi-day closed day or storm was held anyway.
  - **Resolution:**
    - Each of the seven due-row selects gains `closure_kept_at`; the by-id re-reads use the same selects, so a release sees a fresh Keep. The seven are `REMINDER_SELECT` `booking.ts:1348`, `FOLLOWUP_SELECT` `booking.ts:1483`, `REVIEW_REQUEST_SELECT` `automations.ts:263`, `NO_SHOW_NUDGE_SELECT` `:441`, `SMS_REMINDER_SELECT` `:591`, `APPOINTMENT_CONFIRM_SELECT` `:735` and `REFERRAL_ASK_SELECT` `:1037-1038`.
    - Each Due type gains `closureKeptAt: string | null`.
    - `HoldSubject` gains `kept?: boolean`.
    - The loader no longer reads kept ids.
  - The spec's §5.5.2 is updated to match.
- **Confirmed, not deviations:**
  - The only callers of the four `availability.ts` functions are the three named in spec §5.3:
    - `…/b/actions.ts:151` and `:277`;
    - `…/b/move/[token]/actions.ts:72` and `:126`;
    - `apps/web/src/lib/voice/tools/registry.ts:289`, `:434` and `:589`.
  - `reschedule_appointment` calls `bookableSlot`, not `movableSlot` (`registry.ts:589`). The closure rule covers it either way.
  - `bumpHeldForAccount` (`packages/db/src/automation-log.ts:131-137`) has no caller today. Its doc comment (`:124-130`) still names the removed quiet-hours save; Task 9 rewrites that comment.
  - `keep_task_links` was last written by `0084_document_expiry_tasks.sql:52-73`, with `set search_path = ''`. 0096 changes only its `proconfig` (an `ALTER FUNCTION … SET`), so "its post-0096 text" = 0084's body + `set search_path = pg_catalog, pg_temp`. That is what Task 1's SQL re-creates, and the plan writer's rollback check matched its `md5(prosrc)`.
  - `record_event` (`0053_server_only_writes.sql:64-89`) takes any type of 1–100 characters. The four new event types need no migration.

---

## Owner questions

- **Q1 (non-blocking: the plan pins the recommendation and the design reviewer reads it at 7 AM). The topbar forms spec §6 did not draft in Spanish, and one English form it did not write out.**
  - D9 approved the Spanish drafts as written, and they are pinned verbatim.
  - These are the gaps, with the plan's drafts:

  | English | Spanish (draft) |
  |---|---|
  | Closed today · opens tomorrow (no known time) | Cerrado hoy · abre mañana |
  | Closed today · opens Mon (no known time) | Cerrado hoy · abre el lun. |
  | Running about 15 min late | Con unos 15 min de retraso |
  | Running about an hour late | Con alrededor de una hora de retraso |
  | 15 min late | 15 min tarde |
  | 1 hr late | 1 h tarde |
  | Closed for a storm · opens 8 AM (back on tomorrow) | Cerrado por tormenta · abre a las 8 AM |
  | Closed for a storm · opens Dec 28 | Cerrado por tormenta · abre el 28 de dic. |

  **Recommendation:** approve these. "Con alrededor de una hora de retraso" follows the menu's "Como una hora" in meaning while reading naturally after "Con"; "Con como una hora" does not.

---

## Tiers (binding, per task)

| Task | What | Tier | Owner | Review |
|---|---|---|---|---|
| 0 | 0096 gate and rebase, install, pre-reads, MCP reads on both projects, the latency read, the bare-factory list | — | orchestrator | — |
| 1 | Migration 0097 and its db proof; `EXPECTED_WRITES` and the digest literal | **HIGH** | bis-db-schema (opus) | opus bis-reviewer in its OWN detached worktree and replica, mutation probes; re-review on any change; orchestrator applies once |
| 2 | Every new copy key (catalogue + `public-strings.ts`), English and Spanish | LOW | bis-frontend | none |
| 3 | `@bis/db`: `business-status.ts`, the call stamp, `openTasks`, the three recipe selects, typed literals and bare factories | MEDIUM | bis-db-schema | one sonnet bis-reviewer, own worktree and replica + PostgREST |
| 4 | The pure status reader | MEDIUM | bis-booking | one sonnet bis-reviewer, own worktree |
| 5 | The slot engine: `closedOut`, `SlotConfig.closures`, `readSlotClosures` in `availability.ts` | MEDIUM | bis-booking | one sonnet bis-reviewer, own worktree |
| 6 | `PRE_S47D_DIGEST` first (own commit); closure lines, `openNow` with closures, payload schema 2, the prompt wiring | MEDIUM | bis-voice | one **opus** bis-reviewer (model input; recomputes the digest from `5e9c07a7`) |
| 7 | The closure To-do: filer, titles, `workRowHref`, the work list | MEDIUM | bis-automations | one sonnet bis-reviewer, own worktree |
| 8 | The server actions and the guard: status set/undo, closed days add/remove, Keep | MEDIUM | bis-booking | one sonnet bis-reviewer, own worktree |
| 9 | The reminder hold: `holdOrSend`, the loader, the seven recipes, release by bump | **HIGH** | bis-automations (opus) | opus bis-reviewer in its own detached worktree, mutation probes; re-review on any change |
| 10 | The three surfaces: phone, chat, demo (reads, stamp, TODAY line); the Voice page saves' closed-days read | MEDIUM | bis-voice | one sonnet bis-reviewer, own worktree |
| 11 | The topbar indicator and menu (shell leg), the dashboard status card | LOW | bis-frontend | none |
| 12 | The Closed days card, the bookings-list anchors, the palette keywords | LOW | bis-frontend | none |
| 13 | The booking page notice and "Closed this day." | LOW | bis-booking | none |
| 14 | The call-page line, the knowledge page's Closed days section, the i18n baselines | LOW | bis-frontend | none |
| 15 | The e2e spec | LOW | bis-e2e-qa | none |
| 16 | Whole-branch final review (opus), design review (opus), ONE fix agent | — | bis-reviewer, bis-design-reviewer, one fixer | checkpoint |
| 17 | Rollout | — | orchestrator | — |

**Waves (tasks in one wave share no file):**
- **Wave A** (parallel, after Task 0):
  - Task 1: the migration and two db test files, plus the two grant-test literals.
  - Task 2: `messages.ts`, `messages.test.ts`, `public-strings.ts`, `public-strings.test.ts`.
  - Task 4: `…/bstatus/status.ts` (+ test).
  - Task 6 **Step 1 only**: the `PRE_S47D_DIGEST` block in `system-prompt.test.ts`, committed alone on the unchanged prompt.
- **Wave B:**
  - Task 3, after Task 1's review approves (it needs 0097 on its replica).
  - Task 5's `slots.ts` half, after Task 4.
  - Task 6 Steps 2+, after Task 4. Files: `…/knowledge/{closure-lines,hours,payload,prompt-blocks}.ts`, `system-prompt.ts`, `session-config.ts` and their tests.
- **Wave C:**
  - Task 5's `availability.ts` half, after Task 3.
  - Task 7, after Tasks 2 and 3. Files: `…/bstatus/closure-todo.ts`, `card-focus.ts`, `work-list.tsx` and their tests.
  - Task 9, after Tasks 2, 3 and 4. Files: `hold-or-send.ts`, `context.ts`, `harness.ts`, `…/automations/closures.ts`, the seven passes, their tests, `cron/reminders/route.test.ts`.
  - Task 10, after Tasks 3 and 6. Files: the three routes and their tests, `…/knowledge/save.ts` (+ test).
- **Wave D:** Task 8, after Tasks 2, 3, 4 and 7. Files: `…/bstatus/guard.ts`, `[acct]/business-status-actions.ts`, `[acct]/calendar/closed-days-actions.ts`, `[acct]/calendar/actions.ts` (Keep only) and their tests, `in-account-service-reads.test.ts`.
- **Wave E** (parallel, after Task 8):
  - Task 11: `shell-actions.ts`, `shell-data.tsx`, `topbar-presence.tsx`, `components/business-status-menu.tsx`, `…/bstatus/labels.ts`, `[acct]/dashboard/{page.tsx,business-status-card.tsx}` and their tests.
  - Task 12: `[acct]/calendar/{page.tsx,closed-days-card.tsx,bookings-list.tsx}`, `apps/web/src/lib/palette/registry.ts` and their tests.
  - Task 13: `…/b/(book)/page.tsx`, `…/b/data.ts`, `…/b/booking-page.tsx`, `…/b/slot-picker.tsx` and their tests.
- **Wave F:** Task 14 (after Tasks 11–13; it regenerates the baselines last), then Task 15.
- **Then:** Task 16, Task 17.
- **Pushes:** the orchestrator pushes after Task 1's review approves and applies 0097 to bis-ci then (Task 17 step 1).
  - CI `verify` then exercises 0097 on the CLI's PostgreSQL 17.
  - The PR's `e2e` migration check (`.github/scripts/ci-migrations-applied.sh`) can go green.
  - Vercel Preview keeps working once the app names the new objects.

---

## File map

| File | Task | Change |
|---|---|---|
| `packages/db/supabase/migrations/0097_one_switch.sql` | 1 | new |
| `packages/db/src/test/one-switch-schema.test.ts` | 1 | new (withRollback): shape, every CHECK by name, triggers, grants, RLS matrix, `keep_task_links`, comments, cascade, function settings |
| `packages/db/src/test/schema-grants-guard.test.ts:65-107` | 1 | two `EXPECTED_WRITES` entries |
| `packages/db/src/test/proposals-drop.test.ts:84-98` | 1 | the digest literal and its comment |
| `apps/web/src/lib/messages.ts` (+ one `describe` in `messages.test.ts`) | 2 | new keys after the S-47c block (last key `"voice.knowledge.loading.es"`, `messages.ts:2298` at `d280b847`; re-read after the rebase) |
| `apps/web/src/lib/booking/public-strings.ts` (+ `public-strings.test.ts`) | 2 | four keys per language |
| `packages/db/src/business-status.ts` (new), `packages/db/src/index.ts:144` (one `export *` after it) | 3 | rows, reads, writers |
| `packages/db/src/voice.ts:322-361` (`startCallRow`), `:1010-1024` (`CallDetailRow`, `CALL_DETAIL_COLS`) | 3 | the call stamp |
| `packages/db/src/work-queue.ts:10-34` (`WorkRow`), `:56` (select), the mapper below it | 3 | `closureFocus` |
| `packages/db/src/automations.ts:191-219`/`:263`, `:412-434`/`:441`, `:999-1029`/`:1037-1038` (types/selects) and their mappers | 3 | `startsAt` (SD5) and `closureKeptAt` (SD20) |
| `packages/db/src/booking.ts:1348` (`REMINDER_SELECT`), `:1483` (`FOLLOWUP_SELECT`); `packages/db/src/automations.ts:591` (`SMS_REMINDER_SELECT`), `:735` (`APPOINTMENT_CONFIRM_SELECT`); their Due types and mappers | 3 | `closureKeptAt` (SD20) |
| `packages/db/src/account-teardown.ts` (the doc block at `:40-113` that explains each account-owned table left off `ACCOUNT_OWNED_TABLES`, the S-47c paragraph on `voice_services` and `voice_knowledge_snapshots` among them) | 3 | doc comment only: add `business_status` and `closed_days` (fix-round item 9) |
| `packages/db/src/automation-log.ts:124-130` | 9 | doc comment only |
| `packages/db/src/test/business-status.test.ts` (new) | 3 | PostgREST |
| `…/bstatus/status.ts` (+ `status.test.ts`) | 4 | new, pure, relative imports only |
| `apps/web/src/lib/booking/slots.ts:11-14` (`SlotConfig`), `:269-363` (`computeSlots`), `:428-467` (`bookableRange`) (+ `slots.test.ts`, `move-slots.test.ts`) | 5 | |
| `apps/web/src/lib/booking/availability.ts` (+ `availability.test.ts`) | 5 | `readSlotClosures` |
| `apps/web/src/lib/voice/system-prompt.test.ts` | 6 | `PRE_S47D_DIGEST` (Step 1), then the closure cases |
| `…/knowledge/closure-lines.ts` (new, + test), `…/knowledge/hours.ts:42-77`, `…/knowledge/payload.ts`, `…/knowledge/prompt-blocks.ts:28-51` (+ their tests) | 6 | |
| `apps/web/src/lib/voice/session-config.ts:56-73` | 6 | two optional fields |
| `apps/web/src/lib/voice/system-prompt.ts:9-16`, `:45-46`, `:145-150`, `:293-313` | 6 | |
| `…/bstatus/closure-todo.ts` (new, + test), `apps/web/src/lib/documents/card-focus.ts:17-30` (+ test), `[acct]/tasks/work-list.tsx:258` (+ `work-list.href.test.ts`) | 7 | |
| `…/bstatus/guard.ts` (new, + test), `[acct]/business-status-actions.ts` (new, + test), `[acct]/calendar/closed-days-actions.ts` (new, + test), `[acct]/calendar/actions.ts` (Keep, + `actions.test.ts`), `[acct]/in-account-service-reads.test.ts:63-193` | 8 | |
| `apps/web/src/lib/automations/{hold-or-send,context,harness}.ts`, `…/automations/closures.ts` (new), the seven passes (+ every test listed in Task 9), `apps/web/src/app/api/cron/reminders/route.test.ts:15-202` | 9 | |
| `…/incoming/route.ts`, `…/turn/route.ts`, `…/websession/route.ts` (+ `route.test.ts` ×3, `lifecycle.test.ts`), `…/knowledge/save.ts` (+ test) | 10 | |
| `[acct]/shell-actions.ts:29-47`, `:125-145` (+ test); `apps/web/src/components/shell-data.tsx`; `apps/web/src/components/topbar-presence.tsx` (+ test); `apps/web/src/components/business-status-menu.tsx` (new, + test); `…/bstatus/labels.ts` (new, + test); `[acct]/dashboard/page.tsx:350-365` (+ `page.test.ts`); `[acct]/dashboard/business-status-card.tsx` (new, + test) | 11 | |
| `[acct]/calendar/page.tsx:86-103` (+ `page.test.ts`); `[acct]/calendar/closed-days-card.tsx` (new, + test); `[acct]/calendar/bookings-list.tsx:213` (+ test); `apps/web/src/lib/palette/registry.ts:70` (+ `registry.test.ts`) | 12 | |
| `…/b/(book)/page.tsx:92-155` (+ `page.test.ts`), `…/b/data.ts`, `…/b/booking-page.tsx:16-33`, `:273-275`, `…/b/slot-picker.tsx:132-148`, `:291-295` (+ tests) | 13 | |
| `[acct]/calls/[callId]/page.tsx:262-319` (+ `page.test.ts`), `[acct]/voice/knowledge/[version]/page.tsx:182-236` (+ `page.test.ts`), `apps/web/src/lib/i18n/{catalogue,ratchet}-baseline.json` | 14 | |
| `apps/web/e2e/one-switch.spec.ts` | 15 | new |

**Not touched:**
- `apps/web/src/lib/voice/modules/**`: no module text moves, so `pin.ts`'s hashes stand (spec §5.4.4).
- `apps/web/src/lib/voice/tools/**`: `bookingMode` and `toolSchemas` are unchanged (spec §5.4.2). The three booking tools inherit the slot rule through `availability.ts`.
- `ACCOUNT_OWNED_TABLES` (`packages/db/src/account-teardown.ts`): neither new table is listed (spec §4 TEARDOWN).
- Styleguide: existing components only (spec §5.6).
- Schedule-pass registry: no new cron pass; expiry is computed on read (D3).

---

## The model (every task reads this; names are binding)

### 0097 (Task 1)

| Object | Name and rule |
|---|---|
| `business_status` | `account_id` pk → `accounts` on delete cascade. `state` text not null default `'open'` (`business_status_state_check`). `late_minutes` integer (`business_status_late_minutes_check`: 15, 30, 60, 120). `until` timestamptz. `set_by` text not null default `'system'`. `set_at` timestamptz not null default now(). Two table CHECKs: `business_status_shape_check` (per state, spec §4) and `business_status_until_check` (`until is null or (until > set_at and until <= set_at + interval '100 days')`). |
| `closed_days` | `id` pk default gen_random_uuid(). `account_id` → `accounts` on delete cascade. `starts_on` and `ends_on` date not null. `reason` (`closed_days_reason_check`: holiday, vacation, other or NULL). `created_by` text not null (trigger). `created_at` timestamptz not null default now(). `closed_days_range_check` (`ends_on >= starts_on and ends_on - starts_on <= 91`). Index `closed_days_account_ends (account_id, ends_on)`. |
| `calls.business_status` | text, nullable, no default. `calls_business_status_check`: the eight codes of S6. |
| `tasks.closure_kind` / `tasks.closure_on` | text (`tasks_closure_kind_check`: status, closed_day) / date. `tasks_closure_coherent`. Unique `tasks_closure_once (account_id, closure_kind, closure_on) where closure_kind is not null`. |
| `bookings.closure_kept_at` | timestamptz, nullable, no default. |
| Triggers | `business_status_stamp` BEFORE INSERT OR UPDATE → `app.business_status_stamp()`. `closed_days_stamp` BEFORE INSERT → `app.closed_days_stamp()`, which also refuses (23514) `starts_on < current_date - 2` or `ends_on > current_date + 367`. That is two days of slack because `current_date` is the UTC date (fix-round item 8). Both are plain plpgsql, not definer, `set search_path = pg_catalog, pg_temp`. |
| `app.keep_task_links()` | 0084's body plus `closure_kind`/`closure_on` on both branches, `set search_path = pg_catalog, pg_temp`. |
| Grants | `business_status`: SELECT → authenticated, service_role; UPDATE (state, late_minutes, until) → authenticated; INSERT → service_role. `closed_days`: SELECT → authenticated, service_role; INSERT (account_id, starts_on, ends_on, reason) and DELETE → authenticated; INSERT and DELETE → service_role. Everything else is revoked from public, anon, authenticated and service_role. |
| Policies | `business_status_member_read` (select). `business_status_update` (update; Owner branch + Staff branch, USING = old row, WITH CHECK = new row). The Staff WITH CHECK also requires `state = 'open' or until <= now() + interval '26 hours'` (fix-round item 4). `closed_days_member_read` (select). `closed_days_owner_insert` (insert, WITH CHECK). `closed_days_owner_delete` (delete, USING). The deparsed text is pinned in Task 1. |
| Events (app side, `emit` on the signed-in client → `record_event`) | `business_status.changed` `{ from, to, late_minutes, until }`; `closed_day.added` `{ id, starts_on, ends_on, reason }`; `closed_day.removed` (same shape); `booking.closure_kept` `{ booking_id, kept }`. |

### `@bis/db` (Task 3) — `packages/db/src/business-status.ts`

```ts
export type BusinessState = "open" | "closed_today" | "running_late" | "storm";
export type LateMinutes = 15 | 30 | 60 | 120;
export type BusinessStatusRow = {
  account_id: string; state: BusinessState; late_minutes: LateMinutes | null;
  until: string | null; set_by: string; set_at: string;      // set_at VERBATIM from PostgREST (SD14)
};
export type ClosedDayReason = "holiday" | "vacation" | "other";
export type ClosedDayRow = {
  id: string; account_id: string; starts_on: string; ends_on: string;
  reason: ClosedDayReason | null; created_by: string; created_at: string;
};
export type BusinessStatusCode = "open" | "closed_today" | "running_late_15" | "running_late_30"
  | "running_late_60" | "running_late_120" | "storm" | "closed_day";
export type ClosureKind = "status" | "closed_day";
export type StatusPatch = { state: BusinessState; late_minutes: LateMinutes | null; until: string | null };
export type ClosureAppointment = {
  id: string; contact_id: string; starts_at: string; ends_at: string; closure_kept_at: string | null;
  first_name: string | null; last_name: string | null;
};
export type HoursChainRaw = { businessHours: unknown; calendarHours: unknown };
export type ClosureSnapshot = {
  timezone: string | null; row: BusinessStatusRow | null; closedDays: ClosedDayRow[];
  hours: HoursChainRaw;                 // no kept ids: Keep is read from each due row (SD20)
};

export const BUSINESS_STATUS_COLS = "account_id, state, late_minutes, until, set_by, set_at";
export const CLOSED_DAY_COLS = "id, account_id, starts_on, ends_on, reason, created_by, created_at";

/** null = no row (reads as open). Throws on a read error. */
export async function getBusinessStatusRow(db: SupabaseClient, accountId: string): Promise<BusinessStatusRow | null>;
/** service_role only: insert … on conflict (account_id) do nothing (upsert, ignoreDuplicates). Throws on error. */
export async function ensureBusinessStatusRow(db: SupabaseClient, accountId: string): Promise<void>;
/** The signed-in client. Updates the three columns where account_id matches (and set_at = expectedSetAt
 *  when given); returns the row read back, or null when no row matched (RLS USING, or a lost
 *  compare-and-set). A 42501 (RLS WITH CHECK, SD1) also returns null. Any other error throws. */
export async function updateBusinessStatus(db: SupabaseClient, accountId: string, patch: StatusPatch,
  opts?: { expectedSetAt?: string }): Promise<BusinessStatusRow | null>;
/** ends_on >= fromDate, order starts_on asc then id asc, at most `limit` (default 100). Throws on error. */
export async function listClosedDaysFrom(db: SupabaseClient, accountId: string, fromDate: string, limit?: number): Promise<ClosedDayRow[]>;
/** Signed-in insert of the four columns; returns the stored row (created_by stamped). Throws on error (the
 *  error keeps its PostgREST `code`). */
export async function insertClosedDay(db: SupabaseClient, accountId: string,
  input: { starts_on: string; ends_on: string; reason: ClosedDayReason | null }): Promise<ClosedDayRow>;
/** Deletes one range of this account; returns it, or null when nothing matched. */
export async function deleteClosedDay(db: SupabaseClient, accountId: string, id: string): Promise<ClosedDayRow | null>;
/** voice_profiles.business_hours and calendars.open_hours, read in parallel. Each failing read logs one
 *  line (ids only) and yields null; never throws. */
export async function readHoursChain(db: SupabaseClient, accountId: string): Promise<HoursChainRaw>;
/** status = 'booked', starts_at in [fromIso, toIso), order starts_at, with the contact's first/last name
 *  (embed `contacts(first_name, last_name)`). Throws on error. */
export async function listClosureAppointments(db: SupabaseClient, accountId: string, fromIso: string, toIso: string): Promise<ClosureAppointment[]>;
/** Held automation_log rows per booking: Map<bookingId, count> from subject_key 'booking:<id>'. */
export async function countHeldByBooking(db: SupabaseClient, accountId: string, bookingIds: readonly string[]): Promise<Map<string, number>>;
/** service_role. Sets (kept) or clears closure_kept_at on a 'booked' booking of this account; true when a row changed. */
export async function setBookingClosureKept(db: SupabaseClient, accountId: string, bookingId: string, kept: boolean): Promise<boolean>;
/** service_role. One To-do per account, kind and date: insert, and on 23505 re-read the existing id. Emits
 *  task.created on a real insert (ensureDocumentExpiryTask's shape, packages/db/src/document-expiry.ts:62-81). */
export async function ensureClosureTask(db: SupabaseClient, accountId: string,
  input: { kind: ClosureKind; on: string; title: string; createdBy: string }): Promise<{ id: string; created: boolean }>;
/** service_role. Deletes the task only while it is open (completed_at null) and still a closure To-do. */
export async function deleteOpenClosureTask(db: SupabaseClient, accountId: string, taskId: string): Promise<boolean>;
/** The cron loader's one read per account per tick (Task 9): accounts.timezone, the row, the closed days
 *  ending on or after `sinceDate`, and the hours chain, all for THIS accountId. Throws when any of the
 *  first three fails (the hours chain never throws). */
export async function loadClosureSnapshot(db: SupabaseClient, accountId: string,
  since: { date: string }): Promise<ClosureSnapshot>;
```

Other `@bis/db` changes (Task 3):
```ts
// packages/db/src/voice.ts
// startCallRow's input gains: businessStatus?: BusinessStatusCode   -> business_status, named only when given
// CallDetailRow gains: business_status: BusinessStatusCode | null;
// CALL_DETAIL_COLS: … + ", business_status"
// packages/db/src/work-queue.ts
// WorkRow gains: closureFocus?: { kind: ClosureKind; on: string };
// openTasks's select gains ", closure_kind, closure_on"; the mapper sets closureFocus when closure_kind is not null
// packages/db/src/automations.ts (SD5)
// NO_SHOW_NUDGE_SELECT, REVIEW_REQUEST_SELECT, REFERRAL_ASK_SELECT gain "starts_at"; DueNoShowNudge,
// DueReviewRequest, DueReferralAsk gain startsAt: string (mapped from starts_at)
// The seven booking-subject selects (SD20): REMINDER_SELECT and FOLLOWUP_SELECT (booking.ts), SMS_REMINDER_SELECT,
// APPOINTMENT_CONFIRM_SELECT, REVIEW_REQUEST_SELECT, NO_SHOW_NUDGE_SELECT, REFERRAL_ASK_SELECT (automations.ts)
// gain "closure_kept_at"; each Due type gains closureKeptAt: string | null (mapped from closure_kept_at)
```

### The reader (Task 4) — `…/bstatus/status.ts` (pure; imports only `../booking/slots`)

```ts
import { partsInZone, zonedTimeToUtc, normalizeOpenHours, type OpenHours, type SlotClosures } from "../booking/slots";
export type LateMinutes = 15 | 30 | 60 | 120;
export type StoredState = "open" | "closed_today" | "running_late" | "storm";
/** Structurally satisfied by @bis/db's BusinessStatusRow (no @bis/db import here: the prompt loads this under tsx). */
export type StatusRowInput = { state: StoredState; late_minutes: number | null; until: string | null; set_at: string };
export type ClosedDayReason = "holiday" | "vacation" | "other";
export type ClosedDay = { starts_on: string; ends_on: string; reason: ClosedDayReason | null };
export type StatusInput = { row: StatusRowInput | null; closedDays: readonly ClosedDay[]; hours: OpenHours | null; timezone: string; now: Date };
export type EffectiveStatus =
  | { state: "open"; nextClosedDay: ClosedDay | null }
  | { state: "running_late"; lateMinutes: LateMinutes; endsAt: Date }
  | { state: "closed_today"; reopensAt: Date; reopensTimeKnown: boolean }
  | { state: "storm"; reopensAt: Date | null; reopensTimeKnown: boolean }
  | { state: "closed_day"; reason: ClosedDayReason | null; startsOn: string; endsOn: string; reopensAt: Date; reopensTimeKnown: boolean };
export type StatusChange = { state: "open" } | { state: "closed_today" }
  | { state: "running_late"; lateMinutes: LateMinutes } | { state: "storm"; backOn: string | null };
export type Cover = { covered: false } | { covered: true; kind: "closed_today" | "storm" | "closed_day"; endsAt: Date | null };
export type StatusCode = "open" | "closed_today" | "running_late_15" | "running_late_30" | "running_late_60"
  | "running_late_120" | "storm" | "closed_day";

export function hoursChain(businessHours: unknown, calendarHours: unknown): OpenHours | null; // first with an open day, normalized
export function dayKey(instant: Date, timezone: string): string;                 // "YYYY-MM-DD" in the zone
export function addDays(key: string, n: number): string;                         // calendar arithmetic on the key
export function wallTime(key: string, hhmm: string, timezone: string): Date;     // a DST-gap wall time -> the first minute after the gap
export function startOfDay(key: string, timezone: string): Date;                 // wallTime(key, "00:00", timezone)
export function rowInForce(row: StatusRowInput | null, now: Date): boolean;      // state !== open and (until null or now < until)
export function closedDayOn(key: string, closedDays: readonly ClosedDay[]): ClosedDay | null;
export function reopeningFrom(from: Date, hours: OpenHours | null, timezone: string,
  closedDays: readonly ClosedDay[]): { at: Date; timeKnown: boolean };            // SD3
export function effectiveStatus(input: StatusInput): EffectiveStatus;            // precedence S11
export function untilFor(change: StatusChange, hours: OpenHours | null, timezone: string, now: Date): Date | null;  // SD13
export function slotClosures(input: StatusInput): SlotClosures;
export function coversAppointment(input: StatusInput, startsAt: Date): Cover;
/** S22 and S7 share it: the instants whose appointments the card lists and the To-do is filed for. null when
 *  the status is open or running late. to = min(window end, now + 14 days); capped = the window runs past it. */
export function closureListWindow(input: StatusInput): { from: Date; to: Date; capped: boolean } | null;
export function statusCode(e: EffectiveStatus): StatusCode;
export function toWire(e: EffectiveStatus): WireStatus;      // Dates as ISO strings, for server-action results and props
export function fromWire(w: WireStatus): EffectiveStatus;
```

Rules (spec §5.1 plus SD3 and SD6):
- **Row in force:** `row.state !== "open"` and (`until` null or `now < until`); otherwise it reads open.
- **A closed day in force:** `dayKey(now)` falls in `[starts_on, ends_on]`.
- **Precedence (S11):** Storm in force > a closed day today > Closed today in force > Running late in force > Open.
- **`reopeningFrom(from, hours, tz, closedDays)`:**
  - With `hours`, walk days from `dayKey(from)` for up to 400 days and skip closed days. On the first day, take the first span start `>= from` (a span start equal to `from` counts). On later days, take the first span start of the day. The result has `timeKnown: true`.
  - With `hours` null, return the first `startOfDay(k)` that is `>= from` on a non-closed day `k`, with `timeKnown: false`.
  - If 400 days pass with no result, return the null-hours answer.
- **`effectiveStatus`:**
  - `closed_today` and `storm` with `until`: `reopeningFrom(new Date(until), …, closedDays)`. For Closed today `until` is the midnight ending today (D12), so this is the first opening on a later day (S1), computed on read from whatever hours chain is current.
  - `storm` with `until` null: `reopensAt` is null and `reopensTimeKnown` is false.
  - `closed_day`: `reopeningFrom(startOfDay(addDays(ends_on, 1)), …, closedDays)`.
  - `running_late`: `endsAt = new Date(until)`.
  - `open`: `nextClosedDay` is the range with the earliest `starts_on` in `[addDays(today, 1), addDays(today, 14)]`, else null.
- **`untilFor`:**
  - `open` → null.
  - `closed_today` → `startOfDay(addDays(today, 1))`. D12: the closure window ends at midnight; the reopening that is said is the reader's, above.
  - `running_late` → `startOfDay(addDays(today, 1))`.
  - `storm` with `backOn` → `reopeningFrom(startOfDay(backOn), hours, tz, []).at`.
  - `storm` with `backOn` null → null.
- **`slotClosures`:**
  - `closedDayKeys` is every date key of every range given.
  - Row in force, `closed_today`, or `storm` with `until`: `blockedBefore = new Date(until)`. For Closed today that is tonight's midnight (D12), so tomorrow's slots stay bookable whichever hours source would have said when it reopens.
  - `storm` with `until` null: `blockAll = true`.
  - `running_late`: `lateBefore = min(now + late_minutes·60 000 ms, until)`.
  - Every other field is null or false.
- **`coversAppointment(input, startsAt)`:** checked in precedence order. Each `endsAt` is the end of the closure's WINDOW (D12), never a reopening computed from hours.
  - Storm in force with `startsAt` in `[set_at, until)` (`until` null = no end) → `{ kind: "storm", endsAt: until ? new Date(until) : null }`.
  - Else a closed day holds `dayKey(startsAt)` → `{ kind: "closed_day", endsAt: startOfDay(addDays(range.ends_on, 1)) }`.
  - Else Closed today in force with `startsAt` in `[set_at, until)` → `{ kind: "closed_today", endsAt: new Date(until) }`, tonight's midnight.
  - Running late covers nothing.
- **`closureListWindow`:**
  - `from` = `now`;
  - `to` = the earlier of the window's end and `now + 14 days`. The window's end is: Closed today → `until`; a dated storm → `until`; a closed day today → the start of the day after its last date; an open-ended storm → no end, so the 14-day cap applies.
  - `capped` = the window ends after `now + 14 days`, or has no end.
  - Open and Running late → null.
  - The card lists, and the filer counts, only the appointments in `[from, to)` that `coversAppointment` covers (S7, S22).
- **`statusCode`:** `open` → `"open"`; `running_late` → `` `running_late_${lateMinutes}` ``; every other state maps to its own name.

`SlotClosures` lives in `slots.ts` (Task 5 adds it; Task 4 imports the type), because `slots.ts` is the lower module:
```ts
export type SlotClosures = { closedDayKeys: ReadonlySet<string>; blockedBefore: Date | null; blockAll: boolean; lateBefore: Date | null };
export function closedOut(start: Date, c: SlotClosures, timezone: string): boolean;
// SlotConfig gains: closures?: SlotClosures;
```
**Task 4 needs the type before Task 5 lands.** Task 4 adds the `SlotClosures` type to `slots.ts` (type only, one line after `SlotConfig`), and Task 5 adds `closedOut` and the wiring. The two tasks do not run in parallel on `slots.ts`: Task 5 starts after Task 4.

### The guard (Task 8) — `…/bstatus/guard.ts` (pure)

```ts
export type Actor = { isAgency: boolean; role: "owner" | "staff" | "technician" | null };
export type CanChange = "all" | "late_only" | null;
export function canChangeFor(actor: Actor, effective: EffectiveStatus): CanChange;
export function mayChangeStatus(actor: Actor, effective: EffectiveStatus, change: StatusChange):
  { ok: true } | { ok: false; reason: "close_or_reopen" | "role" };
```
- **The agency or an Owner:** `"all"`, and every change is ok.
- **Staff:** `"late_only"` when `effective.state` is `open` or `running_late` (an expired stored closure reads open). Otherwise `null`, which covers a closure in force and a closed day.
  - Ok only when `canChangeFor` gives `"late_only"` AND the change is `open` or `running_late`.
  - Otherwise refused with `close_or_reopen`.
- **A Technician, or `role` null:** `null`, refused with `role`.
- **The two sentences (spec §5.2, §6; exact):**
  - `close_or_reopen` → "Only an Owner can close the business or reopen it." / "Solo un propietario puede cerrar el negocio o volver a abrirlo."
  - `role` → "Only an Owner can change this." / "Solo un propietario puede cambiar esto."

### The hold (Task 9) — `apps/web/src/lib/automations/closures.ts`

```ts
export type ClosureState =
  | { ok: true; input: Omit<StatusInput, "now"> }
  | { ok: false };
export type ClosureLoader = (accountId: string) => Promise<ClosureState>;
/** One loadClosureSnapshot per account per tick, always for the accountId it is called with (holdOrSend
 *  passes the SUBJECT's own s.accountId): memoises the PROMISE per accountId; a failed read is memoised as
 *  { ok: false } for the tick. since = { date: dayKey(now - 1 day, "UTC") }. */
export function closureLoader(db: SupabaseClient, now: Date): ClosureLoader;
/** For tests: every account reads open, no closed days. */
export const NO_CLOSURES: ClosureLoader;
export type ClosureVerdict = { kind: "send" } | { kind: "held"; until: Date; reason: string } | { kind: "skipped"; reason: string };
export function closureVerdict(state: ClosureState, s: { appointmentAt: Date; kept: boolean; deadline?: Date | null }, now: Date): ClosureVerdict;
```
**`closureVerdict`:**
- `ok: false` → held until `now + LEDGER_RETRY_MS` with `REASONS.heldClosureUnknown`.
- `s.kept` (the subject's own `closure_kept_at`, SD20) → send. A kept booking sends however old the appointment is.
- `cover = coversAppointment({ ...input, now }, appointmentAt)`.
  - Not covered → send.
  - Covered, with `endsAt !== null && endsAt <= now` (SD6) → send.
- A deadline that is `<= now` → skipped with `REASONS.skippedClosed`.
- Otherwise held until `min(endsAt, deadline)` over the ones that are not null. When both are null (an open-ended storm, no deadline), `now + 24 h`.
- The held reason by cover kind: `closed_today` → `heldClosedToday`; `storm` → `heldStorm`; `closed_day` → `heldClosedDay`.

### Copy keys

The full table is in Task 2. The prompt sentences are model input, pinned below and in Task 6, not catalogue copy.

### The prompt lines (spec §5.4.1, word for word; English only)

**Reopening phrase** (`{reopening}`):
- `dd` is the number of zone-calendar days from `dayKey(now)` to `dayKey(reopensAt)`.
- The day word: `dd === 0` → "today" (SD15); `dd === 1` → "tomorrow"; `2 <= dd <= 6` → "on {Weekday}"; `dd >= 7` → "on {Weekday}, {Month} {d}".
- When `reopensTimeKnown`, add " at {clockTime(HH:MM in zone)}" (S-47c's `clockTime`, `…/knowledge/hours.ts:15-21`).
- Weekday and month names come from fixed English arrays, never `Intl`.

**TODAY lines:**

| state | line |
|---|---|
| closed_today | `TODAY: The business is closed today. It opens again {reopening}.` |
| storm, no date | `TODAY: The business is closed because of a storm, until further notice.` |
| storm, a date | `TODAY: The business is closed because of a storm. It opens again {reopening}.` |
| running_late 15 / 30 | `TODAY: The team is running about {N} minutes behind today. If someone asks about a visit or appointment today, tell them it may start about {N} minutes late.` |
| running_late 60 | `TODAY: The team is running about an hour behind today. If someone asks about a visit or appointment today, tell them it may start about an hour late.` |
| running_late 120 | `TODAY: The team is running more than an hour behind today. If someone asks about a visit or appointment today, tell them it may start more than an hour late.` |
| closed_day | `TODAY: The business is closed all day today{ for a holiday / for vacation / ""}. It opens again {reopening}.` (`other` and none → nothing) |

**Literal fixtures pinned in Task 6:**
- `TODAY: The business is closed today. It opens again tomorrow at 8:00 AM.`
- `TODAY: The business is closed today. It opens again on Monday at 8:00 AM.`
- `TODAY: The business is closed today. It opens again on Monday, January 4 at 8:00 AM.`
- `TODAY: The business is closed today. It opens again tomorrow.`
- `TODAY: The business is closed because of a storm, until further notice.`
- `TODAY: The business is closed because of a storm. It opens again on Thursday at 8:00 AM.`
- `TODAY: The team is running about 15 minutes behind today. If someone asks about a visit or appointment today, tell them it may start about 15 minutes late.`
- `TODAY: The team is running about 30 minutes behind today. If someone asks about a visit or appointment today, tell them it may start about 30 minutes late.`
- `TODAY: The team is running about an hour behind today. If someone asks about a visit or appointment today, tell them it may start about an hour late.`
- `TODAY: The team is running more than an hour behind today. If someone asks about a visit or appointment today, tell them it may start more than an hour late.`
- `TODAY: The business is closed all day today for a holiday. It opens again tomorrow at 8:00 AM.`
- `TODAY: The business is closed all day today for vacation. It opens again on Monday at 8:00 AM.`
- `TODAY: The business is closed all day today. It opens again tomorrow at 8:00 AM.` (reason `other`, and again with none)

**CLOSED DAYS block** (spec §5.4.1, verbatim):
```
CLOSED DAYS (the business is closed all day on these dates, and no time on them can be booked):
- Thursday, December 24, 2026 (holiday)
- Monday, December 28, 2026 to Friday, January 1, 2027 (vacation)
```
- A one-day range is `{Weekday}, {Month} {d}, {yyyy}`.
- A range within one year is `{Weekday}, {Month} {d} to {Weekday}, {Month} {d}, {yyyy}`, as in spec §4.2's example: `- Thursday, December 24 to Friday, December 25, 2026 (holiday)`.
- A range across years carries the year on each date.
- The reason in parentheses when set: `(holiday)`, `(vacation)`, `(other)`. None → nothing.
- Each line starts `- `.
- The heading is the first line, preceded by a blank line, as every S-47c block is.

**Right now with a closure** (S12; `openNow`'s fourth argument):
- The reopening phrase uses S-47c's words: `today` / `tomorrow` / `{Weekday}` / `next {Weekday}` at exactly 7 days, and `on {Weekday}, {Month} {d}` beyond 7 (SD15).
- Pinned:
  - `Right now: closed; opens tomorrow at 8:00 AM.`
  - `Right now: closed; opens on Monday, January 4 at 8:00 AM.`
  - `Right now: closed.` (an open-ended storm)
- An open status whose hours say closed now skips closed days when it names the next opening. For example, closed Thursday, open Friday 8:00, Friday a closed day, Saturday 9:00 → `Right now: closed; opens Saturday at 9:00 AM.`

**AFTER HOURS with a closure and no hours block** (SD16):
- Web: `AFTER HOURS — The business is closed right now (see TODAY above); say so briefly, and use capture_lead to get their name and a way to reach them so the team can follow up.`
- Demo: `AFTER HOURS — The business is closed right now (see TODAY above); say so briefly and take a message; do not attempt anything else.`
- Phone: `afterHoursClosedPhoneLine({ …, see: "TODAY" })`, i.e. `AFTER HOURS — The business is closed right now (see TODAY above). If it matters to what they need, …` (the rest exactly as `prompt-blocks.ts:39`).
- Phone, open-ended storm: the same line built with `canBook: false`, so it has no `, and book a time that check_availability returns` (S13).

### The booking page strings (spec §5.3; `public-strings.ts`, verbatim)

| key | English | Spanish |
|---|---|---|
| `closedTodayNotice` | Closed today. Please pick another day. | Cerrado hoy. Por favor, elija otro día. |
| `stormNotice` | We're closed for now. Please check back soon. | Estamos cerrados por ahora. Por favor, vuelva a consultar pronto. |
| `stormUntilNotice` | Closed until {date}. Please pick a day from then on. | Cerrado hasta el {date}. Por favor, elija un día a partir de esa fecha. |
| `closedDay` | Closed this day. | Cerrado este día. |

`{date}` is `Intl.DateTimeFormat(intlLocale(locale), { weekday: "long", month: "long", day: "numeric", timeZone })` of the reopening (`intlLocale`, `public-strings.ts:231`). Pinned:
- `Closed until Thursday, December 24. Please pick a day from then on.`
- `Cerrado hasta el jueves, 24 de diciembre. Por favor, elija un día a partir de esa fecha.`

### The topbar forms (spec §5.6.1, §6, D9; the leading "● " is the dot element, not text)

- **Time:** `h AM`/`h PM`, with `:mm` only when the minutes are not 00 (`8 AM`, `8:30 AM`, `12 PM`).
- **Short weekday:**
  - English: Sun Mon Tue Wed Thu Fri Sat.
  - Spanish: dom. lun. mar. mié. jue. vie. sáb.
- **Short month:**
  - English: Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec.
  - Spanish: ene. feb. mar. abr. may. jun. jul. ago. sept. oct. nov. dic.
  - Date form: English `{Mon} {d}`, Spanish `{d} de {mes}`.
- **"opens" phrase, by `dd`** (zone days to the reopening):

  | dd | English | Spanish |
  |---|---|---|
  | 1 | opens {time} | abre a las {time} |
  | 1, no known time | opens tomorrow | abre mañana |
  | 2–6 | opens {Day} {time} | abre el {día} a las {time} |
  | 2–6, no known time | opens {Day} | abre el {día} |
  | ≥7 | opens {date} | abre el {date} |

  `dd` 0 cannot occur (SD15); render it as dd 1.

| state | full (sm and up), English | full, Spanish | short, English | short, Spanish |
|---|---|---|---|---|
| closed_today / closed_day | Closed today · {opens} | Cerrado hoy · {opens} | Closed today | Cerrado hoy |
| storm, no date | Closed for a storm | Cerrado por tormenta | Storm | Tormenta |
| storm, a date | Closed for a storm · {opens} | Cerrado por tormenta · {opens} | Storm | Tormenta |
| running_late 15 | Running about 15 min late | Con unos 15 min de retraso | 15 min late | 15 min tarde |
| running_late 30 | Running about 30 min late | Con unos 30 min de retraso | 30 min late | 30 min tarde |
| running_late 60 | Running about an hour late | Con alrededor de una hora de retraso | 1 hr late | 1 h tarde |
| running_late 120 | Running over an hour late | Con más de una hora de retraso | 1+ hr late | 1+ h tarde |
| open, no voice profile, has `canChange` | Open | Abierto | Open | Abierto |

**Literal fixtures pinned in Task 11** (D9's drafts verbatim, then the Q1 drafts):

| English | Spanish |
|---|---|
| Closed today · opens 8 AM | Cerrado hoy · abre a las 8 AM |
| Closed today · opens Mon 8 AM | Cerrado hoy · abre el lun. a las 8 AM |
| Closed today · opens Dec 28 | Cerrado hoy · abre el 28 de dic. |
| Closed today · opens tomorrow | Cerrado hoy · abre mañana |
| Running about 30 min late | Con unos 30 min de retraso |
| Running about an hour late | Con alrededor de una hora de retraso |
| Running over an hour late | Con más de una hora de retraso |
| Closed for a storm | Cerrado por tormenta |
| Closed for a storm · opens Thu 8 AM | Cerrado por tormenta · abre el jue. a las 8 AM |
| (short) Closed today | Cerrado hoy |
| (short) 30 min late | 30 min tarde |
| (short) 1+ hr late | 1+ h tarde |
| (short) Storm | Tormenta |

---

## Assumptions (each labelled, each with its check)

- **A1 — SATISFIED 2026-10-23.** #285 merged as `964a46bd`, and 0096 is on main and on both projects (production version `20261023224205`, as the orchestrator reported). The rest of this item is history. Original wording: 0096 merges before this branch is rebased, and reaches bis-ci and production before 0097 goes anywhere.
  - Check (Task 0): `git -C <WT> log --oneline origin/main -- packages/db/supabase/migrations/0096_definer_search_path.sql` prints the squash commit.
  - Check (Task 0): MCP `list_migrations` (or `select version, name from supabase_migrations.schema_migrations order by version desc limit 2`) shows 0096 on both projects.
- **A2** No other lane has claimed 0097.
  - Check (Task 0): `git -C <WT> log --all --oneline -- 'packages/db/supabase/migrations/0097*'` prints nothing (read 2026-10-23: nothing).
  - Check (Task 0): after the rebase, `ls packages/db/supabase/migrations | tail -1` is `0096_definer_search_path.sql`.
- **A3 — VERIFIED 2026-10-23 (fix round):** `git diff 88edf276 origin/main -- packages/db/supabase/migrations/0096_definer_search_path.sql packages/db/src/test/definer-search-path.test.ts` prints nothing at `964a46bd`. Original wording: the 0096 that merges is byte-identical to the one the plan writer applied (`git show origin/fix/s47c-followups:…`, 142 lines).
  - Check (Task 0): `git -C <WT> diff 88edf276 origin/main -- packages/db/supabase/migrations/0096_definer_search_path.sql packages/db/src/test/definer-search-path.test.ts` prints nothing.
  - If it does print something, Task 1 re-reads it before writing 0097.
- **A4** bis-ci's digest after 0096 is still `51|0dd3e2d7e19f3f3649a893cfd9967d94`. 0096 says "The client-write digest is unchanged", and the replica's `pre` read it. Check: the Task 0 MCP read.
- **A5** PostgREST returns `set_at` as an ISO string with microseconds, and `.eq("set_at", thatString)` matches the stored value. Check: Task 3's `updateBusinessStatus` compare-and-set case over PostgREST (SD14).
- **A6** The cron's `serviceDb()` request carries no `sub`, so the stamp writes `system` for a server write.
  - Check: Task 3's `ensureBusinessStatusRow` case reads `set_by` = `system`.
  - The replica read `system` for a session with no claims.
- **A7** `workers: 1`, `fullyParallel: false` (`apps/web/playwright.config.ts:166-171`): specs run one after another, so the e2e spec's state carries into the next spec unless restored (Task 15).
- **A8** The client fixture user (`e2e/.auth/client-state.json`, used as `test.use({ storageState })` in `apps/web/e2e/activity.spec.ts:56`) is the fixture account's Owner (S-47c's A8).

---

## Global constraints (every task brief inherits these; carried from the S-47c plan, `docs/superpowers/plans/2026-10-23-sofia-structured-facts-pr47c.md:303-361`, re-verified at `d280b847` where carried over)

- **Git:**
  - Never `git stash`, `git reset`, `git restore`, `git checkout` (not even to revert a probe), `--amend` or `rm -rf` under `<WT>` (memory "No rm -rf on worktrees"). The ONE exception is Task 0's `git rebase origin/main`, which the orchestrator runs.
  - Revert a probe by hand: `cp` the original back, then `cmp` it.
  - Stage new files with `git add -- <new paths>`. Commit with `git commit -m "…" -- <every path>`, never `-A` or `.`. Check `git diff --cached --stat` before every commit.
  - Never push (the orchestrator pushes). Never touch `main`.
  - Commits end with the two trailer lines `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p`.
  - Shared worktree: a task whose typecheck goes red re-runs it once after any sibling commit lands (`git log --oneline -3`) before reporting red.
- **Reviewers:**
  - Probe in their OWN `git worktree add --detach <sha> <SCRATCH>/<name>-wt`, with ONE `pnpm install --frozen-lockfile --prefer-offline` per fresh worktree, never in `<WT>`.
  - Remove the worktree with `git worktree remove --force` only.
  - Leftover agents are stopped by the orchestrator.
- **Databases:**
  - **No `@bis/db` vitest runs locally against bis-ci until Task 17 step 1 has applied 0097 there.**
    - That includes mock-only files: the package's globalSetup sweep (`packages/db/vitest.config.ts:5-8`) runs on every invocation.
    - That includes any test that seeds through a changed select list (`CALL_DETAIL_COLS`, `openTasks`, the three recipe selects).
    - The same holds for the three LIVE web tests: `apps/web/src/app/f/[publicId]/actions.returning-lead.test.ts`, `[acct]/calls/[callId]/actions.test.ts` and `weekly-metrics.live.test.ts`.
  - `withRollback` db tests run on the agent's own PG18 replica. `withTestAccount`/PostgREST tests run on the agent's own replica + PostgREST (`pgrst.sh`), or are proven by CI `verify` (its own in-runner stack, `.github/scripts/ci-local-supabase.sh`).
  - `packages/db/.env` and `apps/web/.env.local` do not exist in `<WT>` (read 2026-10-23). Never create or copy either.
    - To list e2e specs, source the main checkout's file into the SHELL only: `set -a; . /c/Users/danlo/bis-platform/apps/web/.env.local; set +a`. Never print it.
  - **0097 is applied only by the orchestrator:**
    - bis-ci through `ci-project-setup.yml` (`push-dry-run`, then `push`);
    - then production through MCP `apply_migration` ONCE, name `one_switch`;
    - then the md5 compare, then parity.
    - Agents never apply a migration anywhere but their own replica.
- **The replica kit:** build `<SCRATCH>/<agent>-kit/` from `<KIT>` with `sed` and show the `diff`. Only these lines may differ (read 2026-10-23):
  - `replica.sh:6`: `WT=` becomes `/c/Users/danlo/bis-platform/.claude/worktrees/s47d`.
  - `replica.sh:31`: `*0091_*` becomes `*0097_*`.
  - `replica.sh:36-40`: `0091_ai_acts.sql` becomes `0097_one_switch.sql` (twice), and the three messages become `post = pre + 0097`, `0097 FAILED`, `post = pre (no 0097 yet)`.
  - `pgrst.sh:6`: `SECRET=` becomes `s47d-local-postgrest-jwt-secret-not-used-anywhere-real-0000`.
  - Unchanged and relied on:
    - `replica.sh:15` (the three roles);
    - `replica.sh:19` (`sed -n '58,63p;72,73p' packages/db/supabase/bootstrap/ci-project.sql`, still the default-privileges lines at `d280b847`);
    - `replica.sh:21-29` (the storage stub 0077 needs);
    - `pgrst.sh:5` (the directory holding `postgrest.exe`, `make-jwt.js` and `proxy.mjs`);
    - `pgrst.sh:24-29` (`env-run.sh`).
  - After the rebase, 0096 is in `<WT>`'s migrations directory, so `pre` = every migration through 0096 with no extra step, and `post` = `pre` + 0097.
  - Stop your own kit only, by the four steps in `docs/superpowers/plans/2026-10-18-ai-proposals-tray-pr8b1.md:295-298`:
    1. `touch stop`;
    2. stop YOUR `postgrest.exe` by path;
    3. stop the gateway listener by port;
    4. `pg_ctl stop -m fast`.

    Never `taskkill /IM postgrest.exe`. A SQL probe on `post` with PostgREST up needs `notify pgrst, 'reload schema'` after it.
- **Ports:** this lane uses **55471–55489** only. Each agent checks its ports are free first (PowerShell `Get-NetTCPConnection -LocalPort <p> -State Listen`).

  | Who | Postgres | PostgREST | gateway |
  |---|---|---|---|
  | Task 1 implementer | 55471 | — | — |
  | Task 1 reviewer | 55472 | — | — |
  | Task 3 implementer | 55473 | 55474 | 55475 |
  | Task 3 reviewer | 55476 | 55477 | 55478 |
  | Task 16 final reviewer | 55479 | 55480 | 55481 |
  | Task 16 fix agent (only if it touches 0097 or db tests) | 55482 | 55483 | 55484 |
  | spare (a re-review) | 55485 | 55486 | 55487 |
  | spare | 55488 | 55489 | — |
- **Faithfulness:**
  - The client-write digest (the query at `packages/db/src/test/proposals-drop.test.ts:88-97`) on `pre` must equal bis-ci's value, which Task 0 reads (expected `51|0dd3e2d7e19f3f3649a893cfd9967d94`).
  - 0097 moves it to `52|b66203ca5d355155540b520af510d120` on `post`, and Task 17 step 1 reads the same value off bis-ci.
  - `schema-grants-guard.test.ts`'s `EXPECTED_WRITES` (`:65-107`) gains exactly the two entries of spec §4.1.
- **SQL byte rules for 0097:**
  - ASCII only and no backslash. Check with a node byte count with a positive control (memory "Local DB replica": the `grep -P` form silently passes in Git Bash):
    ```
    node -e 'const b=require("fs").readFileSync(process.argv[1]);let n=0,s=0;for(const x of b){if(x>127)n++;if(x===92)s++;}console.log(n,s)' <file>
    ```
    It must print `0 0`, and the same command on a buffer holding `é\` must print `2 1`.
  - "Sofia", never "Sofía".
  - Exactly **16** `$` characters: four `$$ … $$` bodies (the `do` block, the two stamps, `keep_task_links`). No `$` in any comment (write "dollar").
  - The word `cascade` appears exactly twice, both `on delete cascade` (the two new tables' `account_id`): `grep -niw cascade f` prints exactly those two lines. No `drop … cascade` anywhere, and no comment uses the word.
  - **`''` appears ZERO times** (`grep -c "''" f` → `0`). This is the mechanical proof that no `set search_path = ''` slipped in: 0096's rule, spec §4. A blank `sub` is tested with `pg_catalog.length(v_sub) > 0`, never `nullif(…, '')`.
  - No apostrophe inside a `--` comment or inside a `comment on … is '…'` string, so no possessives.
  - No `begin;`/`commit;` wrapper.
  - `lock_timeout` is set inside the first `do` block (`0094_trade_modules.sql:65-68`).
  - Every function 0097 creates or re-creates writes `set search_path = pg_catalog, pg_temp`. No `security definer` appears in the file (`grep -ci "security definer" f` → `0`), so `EXPECTED_DEFINERS` (`definer-search-path.test.ts`) does not change.
- **plpgsql NULL guard** (memory "plpgsql NULL guard"):
  - Every tenancy helper in a policy is `coalesce(…, false)` and sits in a scalar subquery.
  - Neither stamp calls a tenancy helper.
  - `keep_task_links` keeps its `coalesce(current_user = 'authenticated', false)`.
- **Tests must be able to fail** (memories "Test vacuity", "Vacuous test shapes"):
  - The implementer runs each named mutation, pastes the failing assertion line, and reverts by `cp` + `cmp`. A mutation counts as caught only if the WHOLE FILE goes red, never under one `-t` filter.
  - Each negative fixture is shaped so the rule it claims is the ONLY thing that can reject it. A shape refusal changes exactly one field of a VALID row.
  - Prompt lines, topbar forms and copy are asserted as typed-out literals, never built by the function under test.
  - A guard that greps source strips comments first and counts calls, not substrings.
  - A loop over a literal list asserts what it iterated.
  - Never a guard satisfiable by a doc comment or a WANT-constant.
  - **Seed from the real writers:**
    - status rows through `ensureBusinessStatusRow` + `updateBusinessStatus`;
    - closed days through `insertClosedDay`;
    - calls through `startCallRow`;
    - closure To-dos through `ensureClosureTask`;
    - kept bookings through `setBookingClosureKept`.

    Never a hand-shaped row a writer would never produce. The exception is the withRollback db tests, which ARE the writer's contract.
  - **Every account-scoped read gets a second-account case:** `getBusinessStatusRow`, `listClosedDaysFrom`, `deleteClosedDay`, `listClosureAppointments`, `countHeldByBooking`, `setBookingClosureKept`, `deleteOpenClosureTask`, `loadClosureSnapshot`, the RLS reads, and every action (each is called with the route's own `accountId`, asserted on the mocks' arguments).
  - **Mutations must be able to fail:** every write case asserts the stored row by re-reading it, never only the function's return value.
- **`@bis/db` in web:**
  - `…/bstatus/status.ts`, `…/knowledge/*.ts` and `…/bstatus/guard.ts` use only RELATIVE imports (`../booking/slots`, never `@/…`) and at most `import type` from `@bis/db`.
    - `system-prompt.ts` imports `prompt-blocks.ts` → `closure-lines.ts` → `status.ts`.
    - `scripts/sofia-corpus.ts` runs that graph under `tsx` with relative imports only (`apps/web/scripts/sofia-corpus.ts:14-28`).
    - Check: `grep -nE "from ['\"]@/" apps/web/src/lib/business-status/{status,guard}.ts apps/web/src/lib/voice/knowledge/*.ts` → nothing.
  - The turn route and the web-session route import `@bis/db` LAZILY (`…/turn/route.ts:189-195`; `…/websession/route.ts:102-105`). New functions are added to those destructures, never to a module-scope import.
  - The incoming route imports at module scope (`…/incoming/route.ts:85-90`).
  - **A bare `vi.mock("@bis/db", () => ({…}))` factory** (94 lines in `apps/web/src` match the bare or `async () =>` form, `grep -rlE 'vi\.mock\("@bis/db", (async )?\(\) =>' apps/web/src | wc -l`, read 2026-10-23):
    - A module under test that CALLS a new function needs it listed, or the call throws and a fail-open catch swallows it silently.
    - The ones this PR's modules reach are Task 0's list.
    - An `importOriginal` factory (`…/turn/route.test.ts:71`, `…/websession/route.test.ts:33`, `[acct]/shell-actions.test.ts:35`, `[acct]/calendar/page.test.ts:47`, `[acct]/calendar/actions.test.ts:49`) spreads the real module. A new function must still be overridden there, or the REAL function runs against the mocked client.
- **Controlled inputs seed React state, not the DOM** (S-47c lesson). The Closed days form's From/To/Reason and the Storm dialog's date are controlled (`value` + `onChange`). Defaults and a `?closedDay=` focus are set in `useState(...)` initialisers, never by writing `input.value` or `defaultValue` after mount.
- **A model-input sentence is its own element with `lang`** (S-47c lesson). The knowledge page's Closed days lines are model input (English): each `<li lang="en">`, inside a Spanish page too. Catalogue copy around them carries the page's `lang`.
- **Affected tests, never the full suite locally** (memory "Agent test scope"):
  - Run every test file that references a changed export, plus every source-scanning test (`grep -rln "readFileSync\|webSources\|code(" apps/web/src --include=*.test.ts`).
  - Run by path: `pnpm --filter web exec vitest run "<path>" …`.
  - `pnpm --filter web typecheck` in every task touching `.ts`/`.tsx`; `pnpm --filter @bis/db typecheck` in every task touching `packages/db/src`. Both must be GREEN at every commit.
  - `pnpm --filter web exec eslint "<touched files>"`.
  - `@bis/db` suites run only on your replica, from `packages/db`: `node node_modules/vitest/vitest.mjs run <files>`, after `export SUPABASE_DB_URL=postgres://postgres@localhost:<pg>/post` (withRollback) or `source <dir>/env-run.sh` (PostgREST).
  - Capture the exit code to a file with nothing after the command in the same block.
  - Never the gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`), and never Playwright beyond `--list`.
- **Copy:**
  - Every UI string goes through the catalogue (`apps/web/src/lib/messages.ts`) with its `.es` twin, rendered through `makeTr(locale, pseudo).text(key, params)` (`apps/web/src/lib/record/copy.ts:15-21`) or `t()` (`apps/web/src/lib/i18n/t.ts`).
  - Spanish copy is **usted**.
  - No JSX literal copy with a letter in it.
  - No plumbing words in copy ("business_status", "closure_kind", "null", "RPC", "set_at").
  - The persona is `{persona}`, never a typed "Sofía".
  - `messages.ts` and `public-strings.ts` belong to **Task 2 only**. A later task that finds a key missing STOPS and reports.
  - The TODAY lines, the CLOSED DAYS lines and the Right now / AFTER HOURS lines are model input, not catalogue copy (spec §6). They live in `…/knowledge/*.ts` and are pinned by tests.
- **UI** (DESIGN.md binds every UI task):
  - Tokens only; both themes via `.dark`.
  - Existing components only: `DropdownMenu` with `DropdownMenuSub`/`DropdownMenuRadioGroup` (`apps/web/src/components/ui/dropdown-menu.tsx:241-256`), `Dialog`, `Card`, `Input type="date"`, `Select`, `Button` ghost, `Notice` (`components/ui/notice.tsx:22`), `Badge`, `sonner` toasts, `RecordCardBoundary` (`apps/web/src/components/record/record-card-boundary.tsx:35-46`) as the dashboard card's own boundary.
  - Status dots: Open `--good`, Running late `--warn`, every closed state `--crit`, always beside a word (rule 3).
  - ONE primary per card (rule 8).
  - Loaded/empty/error states (rule 5); skeletons, not spinners (rule 7).
  - Undo toasts for `UNDO_WINDOW_MS` (`[acct]/calendar/undo-window.ts:14`, 10 000 ms); no "Are you sure?" (rule 6).
  - `lang` set on every new surface root.
  - The shell is never polled (`apps/web/src/components/shell-data.tsx:28-34`).
- **Logs:** ids and codes only. Never a caller number, a name, a reason text, a prompt line, a payload or a key.

---

## Task 0: The 0096 gate, the rebase, pre-reads (orchestrator)

- [x] **Gate 1: 0096 has merged and is on both projects — SATISFIED 2026-10-23.**
  - #285 merged as `964a46bd`, and 0096 is on main and on bis-ci and production (production version `20261023224205`, reported by the orchestrator).
  - The plan writer confirmed `origin/main` at `964a46bd`, and that its 0096 equals the file the replica used (A3).
  - The three reads below stay as the record of what "satisfied" means. The orchestrator may re-run them, but they are not a fresh gate.
  - **The rebase step and the cite re-read below remain the orchestrator's.**

  The three reads:
  1. `git -C <WT> fetch origin`, then `git -C <WT> log --oneline origin/main -3 -- packages/db/supabase/migrations/0096_definer_search_path.sql` prints the 0096 squash commit (`fix/s47c-followups`'s PR).
  2. Read-only MCP `execute_sql` on `odnobiodsftffphuuosz` (bis-ci): `select version, name from supabase_migrations.schema_migrations order by version desc limit 2;` → the top row is 0096. Then `select pg_catalog.array_to_string(proconfig, ',') from pg_proc where oid = 'app.keep_task_links()'::regprocedure;` → `search_path=pg_catalog, pg_temp`.
  3. The same two reads on `tlbkbmlrfafquucsmsmm` (production) → the newest row's `name` is `definer_search_path`, and `keep_task_links` reads the same.
- [ ] **The rebase** (the one rewrite this plan allows; only docs commits move):
  1. `git -C <WT> status --short` prints nothing, or only untracked files never staged. STOP otherwise.
  2. `git -C <WT> log --oneline origin/main..HEAD` lists exactly the spec commits (`a2d075bc`, `d280b847`) and this plan's commit(s).
  3. `git -C <WT> diff --stat origin/main...HEAD` touches only `docs/superpowers/specs/2026-10-23-one-switch-design.md` and `docs/superpowers/plans/2026-10-23-one-switch-pr47d.md`.
  4. `git -C <WT> rebase origin/main`. A docs-only branch cannot conflict with 0096's files. On any conflict, `git -C <WT> rebase --abort` and STOP.
  5. `git -C <WT> diff --stat origin/main HEAD` again touches only those two docs.
  6. `ls <WT>/packages/db/supabase/migrations | tail -2` → `0095_structured_facts.sql`, `0096_definer_search_path.sql`.
  7. If the branch was ever pushed, the orchestrator pushes with `git push --force-with-lease origin feat/s47d-switch`. Never `--force`, never `main`.
- [x] **A3 (0096 unchanged since the plan's check): verified against `origin/main` `964a46bd` in the fix round.** Re-run it after the rebase as a one-line confirmation: `git -C <WT> diff 88edf276 HEAD -- packages/db/supabase/migrations/0096_definer_search_path.sql packages/db/src/test/definer-search-path.test.ts` prints nothing. If it prints anything, put the diff in Task 1's brief.
- [ ] **A2:** `git -C <WT> log --all --oneline -- 'packages/db/supabase/migrations/0097*'` prints nothing.
- [ ] **Re-derive the moved cites.**
  - Run `git -C <WT> diff --stat 5e9c07a7 HEAD -- apps packages`. It lists 0096's PR files.
  - For each cite in this plan into one of those files, re-read the line and amend this plan in ONE commit on this file only (`git commit -m "docs: S-47d plan — re-derive cites after rebasing onto 0096" -- docs/superpowers/plans/2026-10-23-one-switch-pr47d.md`).
  - Known moves: `messages.ts` (+11 lines in the S-47c block), the call page (`[acct]/calls/[callId]/page.tsx`, +9/−… around the Knowledge link), the knowledge page, `services-prices-card.tsx` and `facts-warnings.ts`.
- [ ] **Install once.** `cd <WT> && pnpm install --frozen-lockfile --prefer-offline`. No agent runs `pnpm install` in `<WT>` after this.
- [ ] **Read-only MCP on both projects:**
  1. `select count(*) || '|' || md5(string_agg(x, ',' order by x)) …`, the query at `packages/db/src/test/proposals-drop.test.ts:88-97`. Run it on bis-ci only → expected `51|0dd3e2d7e19f3f3649a893cfd9967d94` (A4).
  2. `select to_regclass('public.business_status'), to_regclass('public.closed_days');` → both NULL, on both projects.
  3. `select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'calls' and column_name = 'business_status') or (table_name = 'tasks' and column_name in ('closure_kind', 'closure_on')) or (table_name = 'bookings' and column_name = 'closure_kept_at'));` → `0`, on both projects.
  4. `select md5(prosrc) from pg_proc where oid = 'app.keep_task_links()'::regprocedure;` → `ea8acf1dfbc3417144a994251094ffba` on both. That is the plan writer's `pre` value, and it proves Task 1's ROLLBACK text restores the live body. A different value is a STOP: put it in Task 1's brief.
  5. Production only, a baseline for Task 17: `select count(*) from public.automation_log where status = 'held';` and `select count(*) from public.calls where started_at > now() - interval '7 days';`.
- [ ] **STOP** if read 1 differs, or read 2/3 is non-zero anywhere.
- [ ] **The latency read** (spec §5.4.3). What the phone path gains:
  - `getBusinessStatusRow` and `listClosedDaysFrom`, started beside `listVoiceServices` (`…/incoming/route.ts:1057-1063`) and awaited with it at `:1072`. That is two more PostgREST GETs in parallel with one that already runs, so no added sequential round trip is expected.
  - Read the S-47c ledger line `s47c T0 latency: …` (same method) and record `s47d T0 latency: reuse s47c's p50/p95 for one PostgREST GET; the two reads overlap servicesP`.
  - **Gate:** if that p95 exceeds 300 ms, STOP before dispatching Task 10 and tell the owner.
- [ ] **The bare-factory list** for Tasks 3, 5, 9, 10, 11, 12 and 13: `grep -rlnE 'vi\.mock\("@bis/db", (async )?\(\) =>' apps/web/src | xargs grep -lE "startCallRow|getCall\b|listAccountWork|getSlotsAction|computeAllSlots|holdOrSend|buildPassContext|getShellSnapshot|listVoiceServices"`. Put the result in each brief. Read 2026-10-23, the files whose module under test will call a NEW function:
  - `…/incoming/route.test.ts:94` and `…/incoming/lifecycle.test.ts:134` (bare): `getBusinessStatusRow`, `listClosedDaysFrom` (Task 10).
  - `…/b/actions.test.ts:102` (bare): `getBusinessStatusRow`, `listClosedDaysFrom`, reached through `availability.ts` (Task 5).
  - `…/b/(book)/page.test.ts:18` (bare): `getBusinessStatusRow`, `listClosedDaysFrom`, `readHoursChain` (Task 13).
  - `[acct]/dashboard/page.test.ts:119` (bare): `getBusinessStatusRow`, `listClosedDaysFrom`, `readHoursChain`, `listClosureAppointments`, `countHeldByBooking` (Task 11).
  - `[acct]/calls/[callId]/page.test.ts:84` (bare): no new function (`business_status` arrives on the `getCall` row). The row literal gains `business_status: null` (Task 3) and a stamped case (Task 14).
  - `apps/web/src/app/api/cron/reminders/route.test.ts:15` (`async () =>`, every export listed by hand, closes `:201-202`): `loadClosureSnapshot` (Task 9).
  - `apps/web/src/lib/voice/knowledge/save.test.ts:8` (`() => db`): `listClosedDaysFrom` (Task 10).
- [ ] **Ports** 55471–55489 free (`Get-NetTCPConnection -LocalPort <p> -State Listen` for each, PowerShell). If any is taken, shift the whole table by 20 and amend this plan in one commit.
- [ ] **Ledger line** `s47d T0: …` with every value. Put the digest into Task 1's and Task 3's briefs.

---

## Task 1 (HIGH): Migration 0097 and its proof (bis-db-schema, opus)

**Files:**
- Create: `packages/db/supabase/migrations/0097_one_switch.sql`
- Create: `packages/db/src/test/one-switch-schema.test.ts` (withRollback)
- Modify: `packages/db/src/test/schema-grants-guard.test.ts:65-107` (`EXPECTED_WRITES`, two entries)
- Modify: `packages/db/src/test/proposals-drop.test.ts:84-98` (the digest literal and its comment)

**Interfaces:**
- Consumes: nothing.
- Produces: every object in "The model, 0097". Task 3 reads and writes them through PostgREST.

**Read first:**
- spec §4 and §4.1 whole;
- `0084_document_expiry_tasks.sql:36-73` (the last `keep_task_links`);
- `0096_definer_search_path.sql` (now on main; the RULE FOR EVERY LATER MIGRATION paragraph);
- `0095_structured_facts.sql:1-125` (header style, the `do` block);
- `0066_staff_and_roles.sql:52-98` (`account_role`, `is_account_owner`, the policy shape);
- `0077_document_vault.sql:123-160` (the tenant read policy);
- `packages/db/src/test/db.ts:4-46` (`withRollback`, `actAs`, `actAsMember`, `actAsOwner`);
- `packages/db/src/test/definer-search-path.test.ts` (now on main).

- [ ] **Step 1: Build the kit** (Global constraints) on 55471. Show the `diff` against `<KIT>`. Confirm `pre`'s client-write digest equals Task 0's bis-ci value (`51|0dd3…`), and that `pre` has 0096: `select array_to_string(proconfig, ',') from pg_proc where oid = 'app.keep_task_links()'::regprocedure` → `search_path=pg_catalog, pg_temp`.

- [ ] **Step 2: Write the failing schema test** `packages/db/src/test/one-switch-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Client } from "pg";
import { withRollback, actAs, actAsMember, actAsOwner } from "./db";
import { testPhoneNumber } from "./fixtures";
import { ACCOUNT_OWNED_TABLES } from "../account-teardown";

/**
 * 0097_one_switch.sql (S-47d): business_status, closed_days, calls.business_status, the closure To-do link on
 * tasks, bookings.closure_kept_at, the two stamp triggers, keep_task_links re-created, grants and RLS.
 * RED BEFORE APPLY: every case names an object that does not exist yet, except the teardown-list case (green
 * on pre by design).
 *
 * Every refusal names its constraint AND is shaped so that constraint is the only one that can refuse it.
 * Postgres tests a table's CHECKs in name order, so a row that would fail two names the first.
 * SD1: a Staff update INTO a closure fails the policy WITH CHECK, which RAISES 42501; an update OUT of a
 * closure fails USING, which matches no row. The two are asserted differently on purpose.
 */
const RUN = Math.random().toString(36).slice(2, 10);
type Seed = { accountId: string; orgId: string };
type Role = "owner" | "staff" | "technician";
type Patch = { state: string; late: number | null; until: string | null };

const at = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

async function seed(c: Client, label: string): Promise<Seed> {
  await actAsOwner(c);
  const orgId = `org_switch_${label}_${RUN}`;
  const { rows: [agency] } = await c.query<{ id: string }>("insert into public.agencies (name) values ('Switch') returning id");
  const { rows: [account] } = await c.query<{ id: string }>(
    `insert into public.accounts (agency_id, clerk_org_id, name, client_access_enabled)
     values ($1, $2, 'One switch', true) returning id`, [agency!.id, orgId]);
  await c.query("insert into public.business_status (account_id) values ($1)", [account!.id]);
  return { accountId: account!.id, orgId };
}

/** The stored row, put in place as the table owner with the stamp off, so set_at may lie in the past. */
async function store(c: Client, accountId: string, p: Patch & { setAt?: string }) {
  await actAsOwner(c);
  await c.query("alter table public.business_status disable trigger business_status_stamp");
  await c.query(
    `update public.business_status set state = $2, late_minutes = $3, until = $4::timestamptz,
       set_at = coalesce($5::timestamptz, now()) where account_id = $1`,
    [accountId, p.state, p.late, p.until, p.setAt ?? null]);
  await c.query("alter table public.business_status enable trigger business_status_stamp");
}

/** One signed-in UPDATE of the three granted columns; resolves to the row count, or rejects. */
async function updateAs(c: Client, s: Seed, role: Role, p: Patch): Promise<number> {
  await actAsOwner(c);
  await actAsMember(c, s.accountId, s.orgId, role);
  const r = await c.query(
    "update public.business_status set state = $2, late_minutes = $3, until = $4::timestamptz where account_id = $1",
    [s.accountId, p.state, p.late, p.until]);
  return r.rowCount ?? 0;
}

const OPEN: Patch = { state: "open", late: null, until: null };
const late = (m: number): Patch => ({ state: "running_late", late: m, until: at(5) });
const closedToday = (): Patch => ({ state: "closed_today", late: null, until: at(20) });
const stormDated = (): Patch => ({ state: "storm", late: null, until: at(30) });
const STORM_OPEN: Patch = { state: "storm", late: null, until: null };

describe("0097 shape", () => {
  it("business_status columns, types, nullability and defaults", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'business_status' order by ordinal_position`);
      expect(rows).toEqual([
        { column_name: "account_id", data_type: "uuid", is_nullable: "NO", column_default: null },
        { column_name: "state", data_type: "text", is_nullable: "NO", column_default: "'open'::text" },
        { column_name: "late_minutes", data_type: "integer", is_nullable: "YES", column_default: null },
        { column_name: "until", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { column_name: "set_by", data_type: "text", is_nullable: "NO", column_default: "'system'::text" },
        { column_name: "set_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
      ]);
    }));
  it("closed_days columns", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'closed_days' order by ordinal_position`);
      expect(rows).toEqual([
        { column_name: "id", data_type: "uuid", is_nullable: "NO", column_default: "gen_random_uuid()" },
        { column_name: "account_id", data_type: "uuid", is_nullable: "NO", column_default: null },
        { column_name: "starts_on", data_type: "date", is_nullable: "NO", column_default: null },
        { column_name: "ends_on", data_type: "date", is_nullable: "NO", column_default: null },
        { column_name: "reason", data_type: "text", is_nullable: "YES", column_default: null },
        { column_name: "created_by", data_type: "text", is_nullable: "NO", column_default: null },
        { column_name: "created_at", data_type: "timestamp with time zone", is_nullable: "NO", column_default: "now()" },
      ]);
    }));
  it("the four added columns are nullable with no default (so the running build's inserts leave them NULL)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select table_name || '.' || column_name as k, data_type, is_nullable, column_default
        from information_schema.columns where table_schema = 'public' and (
          (table_name = 'calls' and column_name = 'business_status') or
          (table_name = 'tasks' and column_name in ('closure_kind', 'closure_on')) or
          (table_name = 'bookings' and column_name = 'closure_kept_at')) order by 1`);
      expect(rows).toEqual([
        { k: "bookings.closure_kept_at", data_type: "timestamp with time zone", is_nullable: "YES", column_default: null },
        { k: "calls.business_status", data_type: "text", is_nullable: "YES", column_default: null },
        { k: "tasks.closure_kind", data_type: "text", is_nullable: "YES", column_default: null },
        { k: "tasks.closure_on", data_type: "date", is_nullable: "YES", column_default: null },
      ]);
    }));
  it("every new constraint, as defined (read off the plan writer's PG18 replica, 2026-10-23; contype 'n' excluded: CI is PG17)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint where contype <> 'n'
           and (conrelid in ('public.business_status'::regclass, 'public.closed_days'::regclass)
                or conname in ('calls_business_status_check', 'tasks_closure_kind_check', 'tasks_closure_coherent'))
         order by conname`);
      expect(Object.fromEntries(rows.map((r) => [r.conname, r.def]))).toEqual({
        business_status_account_id_fkey: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE",
        business_status_late_minutes_check: "CHECK ((late_minutes = ANY (ARRAY[15, 30, 60, 120])))",
        business_status_pkey: "PRIMARY KEY (account_id)",
        business_status_shape_check: "CHECK ((((state = 'open'::text) AND (late_minutes IS NULL) AND (until IS NULL)) OR ((state = 'closed_today'::text) AND (late_minutes IS NULL) AND (until IS NOT NULL)) OR ((state = 'running_late'::text) AND (late_minutes IS NOT NULL) AND (until IS NOT NULL)) OR ((state = 'storm'::text) AND (late_minutes IS NULL))))",
        business_status_state_check: "CHECK ((state = ANY (ARRAY['open'::text, 'closed_today'::text, 'running_late'::text, 'storm'::text])))",
        business_status_until_check: "CHECK (((until IS NULL) OR ((until > set_at) AND (until <= (set_at + '100 days'::interval)))))",
        calls_business_status_check: "CHECK ((business_status = ANY (ARRAY['open'::text, 'closed_today'::text, 'running_late_15'::text, 'running_late_30'::text, 'running_late_60'::text, 'running_late_120'::text, 'storm'::text, 'closed_day'::text])))",
        closed_days_account_id_fkey: "FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE",
        closed_days_pkey: "PRIMARY KEY (id)",
        closed_days_range_check: "CHECK (((ends_on >= starts_on) AND ((ends_on - starts_on) <= 91)))",
        closed_days_reason_check: "CHECK (((reason IS NULL) OR (reason = ANY (ARRAY['holiday'::text, 'vacation'::text, 'other'::text]))))",
        tasks_closure_coherent: "CHECK (((closure_kind IS NULL) = (closure_on IS NULL)))",
        tasks_closure_kind_check: "CHECK ((closure_kind = ANY (ARRAY['status'::text, 'closed_day'::text])))",
      });
    }));
  it("the two indexes, as defined", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(`select indexname, indexdef from pg_indexes
        where indexname in ('tasks_closure_once', 'closed_days_account_ends') order by 1`);
      expect(rows).toEqual([
        { indexname: "closed_days_account_ends", indexdef: "CREATE INDEX closed_days_account_ends ON public.closed_days USING btree (account_id, ends_on)" },
        { indexname: "tasks_closure_once", indexdef: "CREATE UNIQUE INDEX tasks_closure_once ON public.tasks USING btree (account_id, closure_kind, closure_on) WHERE (closure_kind IS NOT NULL)" },
      ]);
    }));
});

describe("0097 business_status CHECKs, each by name", () => {
  const SHAPE = { code: "23514", constraint: "business_status_shape_check" };
  it.each([
    ["open with a delay", { state: "open", late: 15, until: null }],
    ["open with an end", { state: "open", late: null, until: at(5) }],
    ["closed_today with no end", { state: "closed_today", late: null, until: null }],
    ["closed_today with a delay", { state: "closed_today", late: 30, until: at(5) }],
    ["running_late with no delay", { state: "running_late", late: null, until: at(5) }],
    ["running_late with no end", { state: "running_late", late: 30, until: null }],
    ["storm with a delay", { state: "storm", late: 60, until: null }],
    ["an unknown state (the shape check is first by name)", { state: "closed", late: null, until: null }],
  ] as const)("refuses %s (mutation: drop business_status_shape_check -> FAILS)", (_n, p) =>
    withRollback(async (c) => {
      const s = await seed(c, "shape");
      await expect(store(c, s.accountId, p)).rejects.toMatchObject(SHAPE);
    }));
  it.each([OPEN, late(15), late(30), late(60), late(120), closedToday(), stormDated(), STORM_OPEN])
    ("accepts the valid row %o", (p) =>
      withRollback(async (c) => { const s = await seed(c, "shape_ok"); await store(c, s.accountId, p); }));
  it("refuses a 45-minute delay by business_status_late_minutes_check (mutation: add 45 to the list -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "late45");
      await expect(store(c, s.accountId, late(45))).rejects.toMatchObject({ code: "23514", constraint: "business_status_late_minutes_check" });
    }));
  it("refuses an end at or before set_at, and one more than 100 days after it, by business_status_until_check; 99 days is fine", () =>
    withRollback(async (c) => {
      const s = await seed(c, "until");
      await store(c, s.accountId, { state: "storm", late: null, until: at(24 * 99) });
      await c.query("savepoint p");
      await expect(store(c, s.accountId, { state: "closed_today", late: null, until: at(-0.05) }))
        .rejects.toMatchObject({ code: "23514", constraint: "business_status_until_check" });
      await c.query("rollback to savepoint p");
      await expect(store(c, s.accountId, { state: "storm", late: null, until: at(24 * 101) }))
        .rejects.toMatchObject({ code: "23514", constraint: "business_status_until_check" });
    }));
});

describe("0097 the stamp triggers", () => {
  it("an insert and an update with no token stamp set_by 'system' and set_at now(), whatever was sent (SD2: as the table owner; mutation: drop the set_by line -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "stamp");
      await c.query("delete from public.business_status where account_id = $1", [s.accountId]);
      await c.query("insert into public.business_status (account_id, set_by, set_at) values ($1, 'forged', now() - interval '3 days')", [s.accountId]);
      const first = (await c.query("select set_by, set_at = now() as now_ from public.business_status where account_id = $1", [s.accountId])).rows;
      expect(first).toEqual([{ set_by: "system", now_: true }]);
      await c.query("update public.business_status set set_by = 'forged', set_at = now() - interval '9 days' where account_id = $1", [s.accountId]);
      expect((await c.query("select set_by, set_at = now() as now_ from public.business_status where account_id = $1", [s.accountId])).rows)
        .toEqual([{ set_by: "system", now_: true }]);
    }));
  it("a signed-in update stamps the token sub", () =>
    withRollback(async (c) => {
      const s = await seed(c, "stamp_sub");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      const sub = (await c.query<{ s: string }>("select app.jwt() ->> 'sub' as s")).rows[0]!.s;
      const { rows } = await c.query("update public.business_status set state = 'storm' where account_id = $1 returning set_by", [s.accountId]);
      expect(rows).toEqual([{ set_by: sub }]);
    }));
  it("service_role sending created_by on closed_days is overwritten with 'system' (mutation: drop the created_by line -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_stamp");
      await c.query("set local role service_role");
      const { rows } = await c.query(
        "insert into public.closed_days (account_id, starts_on, ends_on, created_by) values ($1, current_date + 3, current_date + 3, 'forged') returning created_by",
        [s.accountId]);
      expect(rows).toEqual([{ created_by: "system" }]);
    }));
});

describe("0097 closed_days CHECKs and the window trigger", () => {
  const ins = (c: Client, a: string, from: string, to: string, reason: string | null = null) =>
    c.query(`insert into public.closed_days (account_id, starts_on, ends_on, reason) values ($1, ${from}, ${to}, $2)`, [a, reason]);
  it("a one-day range and a 92-day range are accepted", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_ok");
      await ins(c, s.accountId, "current_date + 1", "current_date + 1", "holiday");
      await ins(c, s.accountId, "current_date + 10", "current_date + 101", "vacation");
    }));
  it.each([
    ["an end before the start", "current_date + 5", "current_date + 4", null, "closed_days_range_check"],
    ["93 days (mutation: <= 92 -> FAILS)", "current_date + 1", "current_date + 93", null, "closed_days_range_check"],
    ["a reason off the list", "current_date + 1", "current_date + 1", "birthday", "closed_days_reason_check"],
  ] as const)("refuses %s by its named CHECK", (_n, from, to, reason, constraint) =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_chk");
      await expect(ins(c, s.accountId, from, to, reason)).rejects.toMatchObject({ code: "23514", constraint });
    }));
  // current_date is the UTC date: at 7:30 PM in Chicago it is already tomorrow in UTC, so "yesterday" in the
  // account's zone can be current_date - 2 (an Undo re-adding a range that started yesterday locally).
  it("the window: two UTC days ago and today+367 are accepted; three days ago and today+368 raise 23514 (mutation: current_date - 3 in the trigger -> FAILS; current_date - 1 -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_win");
      await ins(c, s.accountId, "current_date - 2", "current_date - 2");
      await ins(c, s.accountId, "current_date + 300", "current_date + 367");
      await c.query("savepoint p");
      await expect(ins(c, s.accountId, "current_date - 3", "current_date - 3")).rejects.toMatchObject({ code: "23514" });
      await c.query("rollback to savepoint p");
      await expect(ins(c, s.accountId, "current_date + 300", "current_date + 368"))
        .rejects.toThrow("closed_days: a closed day must not start in the past or end more than a year ahead");
    }));
});

describe("0097 calls.business_status and the closure To-do link", () => {
  it("every S6 code is accepted and another is refused by calls_business_status_check", () =>
    withRollback(async (c) => {
      const s = await seed(c, "calls");
      const { rows: [ph] } = await c.query<{ id: string }>(
        "insert into public.phone_numbers (account_id, e164) values ($1, $2) returning id", [s.accountId, testPhoneNumber()]);
      const CODES = ["open", "closed_today", "running_late_15", "running_late_30", "running_late_60", "running_late_120", "storm", "closed_day"];
      for (const code of CODES)
        await c.query("insert into public.calls (account_id, phone_number_id, business_status) values ($1, $2, $3)", [s.accountId, ph!.id, code]);
      expect((await c.query("select count(*)::int as n from public.calls where account_id = $1", [s.accountId])).rows).toEqual([{ n: 8 }]);
      await expect(c.query("insert into public.calls (account_id, phone_number_id, business_status) values ($1, $2, 'running_late_45')", [s.accountId, ph!.id]))
        .rejects.toMatchObject({ code: "23514", constraint: "calls_business_status_check" });
    }));
  it("a kind without a date is refused by tasks_closure_coherent; an unknown kind by tasks_closure_kind_check", () =>
    withRollback(async (c) => {
      const s = await seed(c, "todo_chk");
      await c.query("savepoint p");
      await expect(c.query("insert into public.tasks (account_id, title, closure_kind) values ($1, 'x', 'status')", [s.accountId]))
        .rejects.toMatchObject({ code: "23514", constraint: "tasks_closure_coherent" });
      await c.query("rollback to savepoint p");
      await expect(c.query("insert into public.tasks (account_id, title, closure_kind, closure_on) values ($1, 'x', 'expiry', current_date)", [s.accountId]))
        .rejects.toMatchObject({ code: "23514", constraint: "tasks_closure_kind_check" });
    }));
  it("one closure To-do per account, kind and date (mutation: drop tasks_closure_once -> FAILS); another kind or date is fine", () =>
    withRollback(async (c) => {
      const s = await seed(c, "todo_once");
      const add = (kind: string, on: string) => c.query(
        `insert into public.tasks (account_id, title, closure_kind, closure_on) values ($1, 'Contact', $2, ${on})`, [s.accountId, kind]);
      await add("status", "current_date");
      await add("closed_day", "current_date");
      await add("status", "current_date + 1");
      await expect(add("status", "current_date")).rejects.toMatchObject({ code: "23505", constraint: "tasks_closure_once" });
    }));
  it("keep_task_links: a signed-in insert stores NULL in both columns (mutation: drop new.closure_kind := null -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "keep_ins");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      const { rows } = await c.query(
        "insert into public.tasks (account_id, title, closure_kind, closure_on) values ($1, 'x', 'status', current_date) returning closure_kind, closure_on",
        [s.accountId]);
      expect(rows).toEqual([{ closure_kind: null, closure_on: null }]);
    }));
  it("keep_task_links: a server insert keeps them, and a signed-in update cannot change or clear them (mutation: drop new.closure_on := old.closure_on -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "keep_upd");
      await c.query("set local role service_role");
      const { rows: [t] } = await c.query<{ id: string }>(
        "insert into public.tasks (account_id, title, closure_kind, closure_on) values ($1, 'x', 'closed_day', current_date + 3) returning id", [s.accountId]);
      await actAsOwner(c);
      await actAsMember(c, s.accountId, s.orgId, "owner");
      await c.query("update public.tasks set title = 'y', closure_kind = null, closure_on = null where id = $1", [t!.id]);
      await actAsOwner(c);
      const { rows } = await c.query("select title, closure_kind, closure_on = current_date + 3 as same_day from public.tasks where id = $1", [t!.id]);
      expect(rows).toEqual([{ title: "y", closure_kind: "closed_day", same_day: true }]);
    }));
});

describe("0097 grants", () => {
  it("table privileges on both new tables (mutations: grant insert on business_status to authenticated -> FAILS; grant update on closed_days to authenticated -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query<{ k: string }>(
        `select r || ' ' || t || ' ' || p as k
           from (values ('public.business_status'), ('public.closed_days')) tt(t)
          cross join (values ('anon'), ('authenticated'), ('service_role')) rr(r)
          cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) pp(p)
          where has_table_privilege(r, t, p) order by 1`);
      expect(rows.map((r) => r.k)).toEqual([
        "authenticated public.business_status SELECT",
        "authenticated public.closed_days DELETE",
        "authenticated public.closed_days SELECT",
        "service_role public.business_status INSERT",
        "service_role public.business_status SELECT",
        "service_role public.closed_days DELETE",
        "service_role public.closed_days INSERT",
        "service_role public.closed_days SELECT",
      ]);
    }));
  it("column privileges: authenticated UPDATEs exactly state, late_minutes, until; INSERTs exactly the four closed_days columns", () =>
    withRollback(async (c) => {
      const cols = async (t: string, p: string) => (await c.query<{ a: string }>(
        `select a.attname as a from pg_attribute a where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('authenticated', a.attrelid, a.attnum, $2) order by 1`, [t, p])).rows.map((r) => r.a);
      expect(await cols("public.business_status", "UPDATE")).toEqual(["late_minutes", "state", "until"]);
      expect(await cols("public.closed_days", "INSERT")).toEqual(["account_id", "ends_on", "reason", "starts_on"]);
      expect(await cols("public.closed_days", "UPDATE")).toEqual([]);
    }));
  it("a client cannot UPDATE set_by or set_at, INSERT into business_status, or send created_by (SD2; 42501 each)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "client_cols");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      for (const sql of [
        "update public.business_status set set_by = 'x' where account_id = $1",
        "update public.business_status set set_at = now() where account_id = $1",
        "insert into public.business_status (account_id) values ($1)",
        "insert into public.closed_days (account_id, starts_on, ends_on, created_by) values ($1, current_date + 3, current_date + 3, 'x')",
      ]) {
        await c.query("savepoint p");
        await expect(c.query(sql, [s.accountId]), sql).rejects.toMatchObject({ code: "42501" });
        await c.query("rollback to savepoint p");
      }
    }));
});

describe("0097 RLS: who reads", () => {
  const counts = async (c: Client, accountId: string) => (await c.query(
    `select (select count(*)::int from public.business_status where account_id = $1) as status,
            (select count(*)::int from public.closed_days where account_id = $1) as days`, [accountId])).rows[0];
  async function seeded(c: Client, label: string) {
    const s = await seed(c, label);
    await c.query("insert into public.closed_days (account_id, starts_on, ends_on) values ($1, current_date + 3, current_date + 3)", [s.accountId]);
    return s;
  }
  it.each(["owner", "staff", "technician"] as const)("a %s member reads both (D7; mutation: drop the member-read policy -> FAILS)", (role) =>
    withRollback(async (c) => {
      const s = await seeded(c, `read_${role}`);
      await actAsMember(c, s.accountId, s.orgId, role);
      expect(await counts(c, s.accountId)).toEqual({ status: 1, days: 1 });
    }));
  it("an Owner of ANOTHER account reads neither (mutation: member read using (true) -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seeded(c, "xa"); const b = await seed(c, "xb");
      await actAsMember(c, b.accountId, b.orgId, "owner");
      expect(await counts(c, a.accountId)).toEqual({ status: 0, days: 0 });
    }));
  it("the agency reads both; anon has no grant (42501)", () =>
    withRollback(async (c) => {
      const s = await seeded(c, "ag");
      await actAs(c, { app_role: "agency_admin", sub: "user_switch_ag" });
      expect(await counts(c, s.accountId)).toEqual({ status: 1, days: 1 });
      await actAsOwner(c);
      await c.query("set local role anon");
      await expect(c.query("select 1 from public.business_status limit 1")).rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0097 RLS: the switch (D1, D8; SD1)", () => {
  type Cell = [string, Role, Patch | null, () => Patch, "1" | "0" | "42501"];
  const expired = (): Patch & { setAt: string } => ({ state: "closed_today", late: null, until: at(-1), setAt: at(-48) });
  /** [label, role, stored row (null = the seeded open row), change, expected]. */
  const CELLS: Cell[] = [
    ["Staff: Open -> Running late", "staff", null, () => late(30), "1"],
    ["Staff: Running late -> another delay", "staff", late(30), () => late(60), "1"],
    ["Staff: Running late -> Open", "staff", late(30), () => OPEN, "1"],
    ["Staff: an expired Closed today -> Running late (mutation: drop the expiry carve-out -> FAILS)", "staff", expired(), () => late(15), "1"],
    ["Staff: an expired Closed today -> Open", "staff", expired(), () => OPEN, "1"],
    ["Staff: Open -> Running late ending 25 hours out (the fall-back day's end of today)", "staff", null,
      () => ({ state: "running_late", late: 30, until: at(25) }), "1"],
    ["Staff: Open -> Running late ending 99 days out (mutation: drop the 26-hour bound from the Staff WITH CHECK -> FAILS)", "staff", null,
      () => ({ state: "running_late", late: 30, until: at(24 * 99) }), "42501"],
    ["Staff: Open -> Closed today (mutation: drop the WITH CHECK state clause -> FAILS)", "staff", null, closedToday, "42501"],
    ["Staff: Open -> Storm", "staff", null, () => STORM_OPEN, "42501"],
    ["Staff: Running late -> Closed today", "staff", late(30), closedToday, "42501"],
    ["Staff: Running late -> Storm", "staff", late(30), stormDated, "42501"],
    ["Staff: Closed today in force -> Open (mutation: drop the USING state clause -> FAILS)", "staff", closedToday(), () => OPEN, "0"],
    ["Staff: a dated Storm in force -> Open", "staff", stormDated(), () => OPEN, "0"],
    ["Staff: an open-ended Storm -> Open", "staff", STORM_OPEN, () => OPEN, "0"],
    ["Staff: an open-ended Storm -> Running late", "staff", STORM_OPEN, () => late(30), "0"],
    ["Technician: Open -> Running late", "technician", null, () => late(30), "0"],
    ["Technician: Running late -> Open", "technician", late(30), () => OPEN, "0"],
    ["Owner: Open -> Closed today", "owner", null, closedToday, "1"],
    ["Owner: Open -> Storm", "owner", null, () => STORM_OPEN, "1"],
    ["Owner: Closed today in force -> Open", "owner", closedToday(), () => OPEN, "1"],
    ["Owner: an open-ended Storm -> Open", "owner", STORM_OPEN, () => OPEN, "1"],
  ];
  it("the matrix has 21 cells (guards the loop from vacuity)", () => { expect(CELLS.length).toBe(21); });
  it.each(CELLS)("%s", (_label, role, stored, change, want) =>
    withRollback(async (c) => {
      const s = await seed(c, `cell_${role}`);
      if (stored) await store(c, s.accountId, stored);
      if (want === "42501") await expect(updateAs(c, s, role, change())).rejects.toMatchObject({ code: "42501" });
      else expect(await updateAs(c, s, role, change())).toBe(Number(want));
    }));
  it("the agency token updates any account's row", () =>
    withRollback(async (c) => {
      const s = await seed(c, "ag_upd");
      await actAs(c, { app_role: "agency_admin", sub: "user_switch_ag2" });
      const r = await c.query("update public.business_status set state = 'storm' where account_id = $1", [s.accountId]);
      expect(r.rowCount).toBe(1);
    }));
  it("an Owner of ANOTHER account updates no row", () =>
    withRollback(async (c) => {
      const a = await seed(c, "upd_xa"); const b = await seed(c, "upd_xb");
      await actAsMember(c, b.accountId, b.orgId, "owner");
      const r = await c.query("update public.business_status set state = 'storm' where account_id = $1", [a.accountId]);
      expect(r.rowCount).toBe(0);
    }));
});

describe("0097 RLS: closed days are the Owner's (D1, unchanged by D8)", () => {
  const add = (c: Client, accountId: string) => c.query(
    "insert into public.closed_days (account_id, starts_on, ends_on, reason) values ($1, current_date + 3, current_date + 4, 'holiday') returning created_by",
    [accountId]);
  it("an Owner adds one, stamped with the token sub", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_owner");
      const sub = await actAsMember(c, s.accountId, s.orgId, "owner");
      expect((await add(c, s.accountId)).rows).toEqual([{ created_by: sub }]);
    }));
  it.each(["staff", "technician"] as const)("a %s cannot add one (42501; mutation: owner_insert with check (true) -> FAILS)", (role) =>
    withRollback(async (c) => {
      const s = await seed(c, `cd_${role}`);
      await actAsMember(c, s.accountId, s.orgId, role);
      await expect(add(c, s.accountId)).rejects.toMatchObject({ code: "42501" });
    }));
  // A PLAIN insert, no `returning`: with `returning` the READ policy refuses the row whatever the insert policy
  // says, so the case would stay green with the insert policy's account clause gone (plan review, 2026-10-23,
  // proven on the replica: the stripped policy let B's Owner insert into A, rows_in_a = 1).
  it("an Owner of ANOTHER account cannot add one to this account (42501; mutation: drop account_id = current_account_id() from closed_days_owner_insert -> FAILS)", () =>
    withRollback(async (c) => {
      const a = await seed(c, "cd_xa"); const b = await seed(c, "cd_xb");
      await actAsMember(c, b.accountId, b.orgId, "owner");
      await expect(c.query(
        "insert into public.closed_days (account_id, starts_on, ends_on) values ($1, current_date + 3, current_date + 3)",
        [a.accountId])).rejects.toMatchObject({ code: "42501" });
      await actAsOwner(c);
      expect((await c.query("select count(*)::int as n from public.closed_days where account_id = $1", [a.accountId])).rows)
        .toEqual([{ n: 0 }]);
    }));
  it("Staff and Technicians delete nothing; the Owner deletes it (mutation: owner_delete using (true) -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_del");
      await c.query("insert into public.closed_days (account_id, starts_on, ends_on) values ($1, current_date + 3, current_date + 3)", [s.accountId]);
      for (const role of ["staff", "technician"] as const) {
        await actAsOwner(c);
        await actAsMember(c, s.accountId, s.orgId, role);
        expect((await c.query("delete from public.closed_days where account_id = $1", [s.accountId])).rowCount, role).toBe(0);
      }
      await actAsOwner(c);
      await actAsMember(c, s.accountId, s.orgId, "owner");
      expect((await c.query("delete from public.closed_days where account_id = $1", [s.accountId])).rowCount).toBe(1);
    }));
  it("nobody may UPDATE a closed day (no grant: 42501)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "cd_upd");
      await actAsMember(c, s.accountId, s.orgId, "owner");
      await expect(c.query("update public.closed_days set reason = 'other' where account_id = $1", [s.accountId]))
        .rejects.toMatchObject({ code: "42501" });
    }));
  it("the five policies, as defined (read off the replica, 2026-10-23; PG17 may deparse differently: paste CI's text only after reading it says the same)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select polname, polcmd, polpermissive, pg_get_expr(polqual, polrelid) as q, pg_get_expr(polwithcheck, polrelid) as wc
           from pg_policy where polrelid in ('public.business_status'::regclass, 'public.closed_days'::regclass) order by 1`);
      const MEMBER = "(app.is_agency() OR (account_id = app.current_account_id()))";
      const OWNER = `(( SELECT COALESCE(app.is_agency(), false) AS "coalesce") OR ((account_id = ( SELECT app.current_account_id() AS current_account_id)) AND ( SELECT app.is_account_owner(app.current_account_id()) AS is_account_owner)))`;
      const UPD_USING = `(( SELECT COALESCE(app.is_agency(), false) AS "coalesce") OR ((account_id = ( SELECT app.current_account_id() AS current_account_id)) AND (( SELECT app.is_account_owner(app.current_account_id()) AS is_account_owner) OR (( SELECT COALESCE((app.account_role(app.current_account_id()) = 'staff'::text), false) AS "coalesce") AND ((state = ANY (ARRAY['open'::text, 'running_late'::text])) OR ((until IS NOT NULL) AND (until <= now())))))))`;
      const UPD_CHECK = `(( SELECT COALESCE(app.is_agency(), false) AS "coalesce") OR ((account_id = ( SELECT app.current_account_id() AS current_account_id)) AND (( SELECT app.is_account_owner(app.current_account_id()) AS is_account_owner) OR (( SELECT COALESCE((app.account_role(app.current_account_id()) = 'staff'::text), false) AS "coalesce") AND (state = ANY (ARRAY['open'::text, 'running_late'::text])) AND ((state = 'open'::text) OR (until <= (now() + '26:00:00'::interval)))))))`;
      expect(rows).toEqual([
        { polname: "business_status_member_read", polcmd: "r", polpermissive: true, q: MEMBER, wc: null },
        { polname: "business_status_update", polcmd: "w", polpermissive: true, q: UPD_USING, wc: UPD_CHECK },
        { polname: "closed_days_member_read", polcmd: "r", polpermissive: true, q: MEMBER, wc: null },
        { polname: "closed_days_owner_delete", polcmd: "d", polpermissive: true, q: OWNER, wc: null },
        { polname: "closed_days_owner_insert", polcmd: "a", polpermissive: true, q: null, wc: OWNER },
      ]);
    }));
});

describe("0097 functions, comments, teardown", () => {
  it("the three functions are invokers whose whole proconfig is search_path=pg_catalog, pg_temp (0096 rule; mutation: '' on keep_task_links -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select p.oid::regprocedure::text as f, p.prosecdef, p.proconfig from pg_proc p
          where p.oid in ('app.business_status_stamp()'::regprocedure, 'app.closed_days_stamp()'::regprocedure,
                          'app.keep_task_links()'::regprocedure) order by 1`);
      const CFG = ["search_path=pg_catalog, pg_temp"];
      expect(rows).toEqual([
        { f: "app.business_status_stamp()", prosecdef: false, proconfig: CFG },
        { f: "app.closed_days_stamp()", prosecdef: false, proconfig: CFG },
        { f: "app.keep_task_links()", prosecdef: false, proconfig: CFG },
      ]);
    }));
  it("both tables and every column of both, and the four added columns, carry a comment (mutation: delete one -> FAILS)", () =>
    withRollback(async (c) => {
      const { rows } = await c.query(
        `select cl.relname || '.' || a.attname as k from pg_attribute a join pg_class cl on cl.oid = a.attrelid
           join pg_namespace n on n.oid = cl.relnamespace
          where n.nspname = 'public' and a.attnum > 0 and not a.attisdropped
            and (cl.relname in ('business_status', 'closed_days')
                 or (cl.relname = 'calls' and a.attname = 'business_status')
                 or (cl.relname = 'tasks' and a.attname in ('closure_kind', 'closure_on'))
                 or (cl.relname = 'bookings' and a.attname = 'closure_kept_at'))
            and coalesce(col_description(cl.oid, a.attnum), '') = '' order by 1`);
      expect(rows).toEqual([]);
      const { rows: t } = await c.query(`select obj_description('public.business_status'::regclass, 'pg_class') is not null as b,
        obj_description('public.closed_days'::regclass, 'pg_class') is not null as d`);
      expect(t).toEqual([{ b: true, d: true }]);
    }));
  it("the account row delete carries both tables away (mutation: closed_days account_id on delete restrict -> FAILS)", () =>
    withRollback(async (c) => {
      const s = await seed(c, "gone");
      await c.query("insert into public.closed_days (account_id, starts_on, ends_on) values ($1, current_date + 1, current_date + 1)", [s.accountId]);
      await c.query("delete from public.accounts where id = $1", [s.accountId]);
      expect((await c.query(`select (select count(*)::int from public.business_status where account_id = $1) as b,
        (select count(*)::int from public.closed_days where account_id = $1) as d`, [s.accountId])).rows).toEqual([{ b: 0, d: 0 }]);
    }));
  it("neither table is on ACCOUNT_OWNED_TABLES (service_role holds no DELETE on business_status)", () => {
    const listed = ACCOUNT_OWNED_TABLES as readonly string[];
    expect(listed.includes("business_status")).toBe(false);
    expect(listed.includes("closed_days")).toBe(false);
    expect(listed.includes("calls")).toBe(true); // the list is the real one, not an empty import
  });
});
```

- If a role case reads `0` where a row is expected, check the seed is `client_access_enabled = true` (`app.current_account_id()` is NULL otherwise, `0066_staff_and_roles.sql:82-83`) before touching the policy.
- The comments case uses `''` in a TEST file. That is fine: the zero-`''` rule binds the migration only.

- [ ] **Step 3: Run on `pre` to verify it fails.** `export SUPABASE_DB_URL=postgres://postgres@localhost:55471/pre; node node_modules/vitest/vitest.mjs run src/test/one-switch-schema.test.ts`.
  - Expected: every case FAILS except two, the teardown-list case and the 19-cell guard.
  - Record the counts.

- [ ] **Step 4: Write the migration** `packages/db/supabase/migrations/0097_one_switch.sql`. Copy this text byte for byte; the plan writer's copy has md5 `0c6ed6130fbdd3fd18d92a7429512a35`:

```sql
-- 0097_one_switch.sql - the one switch (open, closed today, running late, storm) and planned closed days
-- (S-47 part d; F-084; decision 28 as its middle option; owner decisions D1 to D11)
-- (docs/superpowers/specs/2026-10-23-one-switch-design.md section 4;
--  docs/superpowers/plans/2026-10-23-one-switch-pr47d.md, Task 1)
--
-- WHY. Until this file nothing in the product knew that a business was closed for the day, running
-- behind, or shut by a storm, and nothing knew about a holiday: the booking page kept selling, Sofia said
-- the business was open, and every reminder went out on its own timer. One switch per account now says
-- which of four states it is in, a list of planned closed days says when it will be shut, and the app
-- reads both everywhere a customer is answered (owner decisions D1 to D7).
--
-- WHAT THIS FILE ADDS:
--   public.business_status  one row per account, absent = open. state is open, closed_today,
--     running_late or storm; late_minutes (15, 30, 60, or 120 for over an hour) only while running late;
--     until is when the state ends by itself (expiry is computed on read, no cron): midnight in the account
--     zone for closed today (owner decision D12) and running late, the first opening of the back-on date
--     for a dated storm, NULL for open and for a storm until further notice. The reopening said to
--     callers is computed on read from the hours. set_by and set_at are stamped by a trigger from the
--     token, never taken from the request.
--   public.closed_days  planned whole-day closures: a date or a range of at most 92 days, with an
--     optional reason from a fixed list (holiday, vacation, other; never free text, because it reaches
--     the receptionist prompt). created_by and created_at are stamped by a trigger, which also refuses a
--     range that starts more than two days before the UTC date or ends more than 367 days after it (a
--     CHECK may not read the clock; the action enforces the exact window in the account zone).
--   public.calls.business_status  the status each call started under, one code from a closed set; NULL
--     for every call before this file and for one whose status could not be read.
--   public.tasks.closure_kind and public.tasks.closure_on  the link of the one To-do a closure files per
--     account, kind and date (tasks_closure_once), so a second filing is a 23505 the server treats as
--     already filed (the 0080 and 0084 dedupe).
--   public.bookings.closure_kept_at  the owner kept this appointment through a closure, so its reminders
--     are not held.
--   app.business_status_stamp, app.closed_days_stamp (plain plpgsql triggers, not definer), and
--   app.keep_task_links re-created with the two task columns.
--
-- WHO WRITES. business_status: the server creates the one row of an account (ensureBusinessStatusRow,
-- service_role, insert on conflict do nothing, as getOrCreateCalendar does for calendars); a signed-in
-- Owner or the agency then UPDATEs its three columns under RLS, and a Staff member may move only between
-- open and running late (D8; an expired closure counts as open), with an end no more than 26 hours out.
-- closed_days: a signed-in Owner or the agency INSERTs four columns and DELETEs rows; nobody updates one
-- (a change is a remove and an add).
-- calls.business_status: startCallRow, server only. The two task columns: server code only, through
-- service_role (keep_task_links below). bookings.closure_kept_at: keepAppointmentAction, service_role.
--
-- GRANTS AND POLICIES. business_status: everything revoked from public, anon, authenticated and
-- service_role; SELECT to authenticated and service_role; UPDATE (state, late_minutes, until) to
-- authenticated; INSERT to service_role. closed_days: everything revoked; SELECT to authenticated and
-- service_role; INSERT (account_id, starts_on, ends_on, reason) and DELETE to authenticated; INSERT and
-- DELETE to service_role (fixtures and the local sweep). RLS on both. Every member reads (0077 tenant
-- shape, Technicians included, D7). The update policy has an Owner branch (0066 shape) and a Staff branch
-- (D8); the closed_days insert and delete policies have the Owner branch only. Every helper is coalesced
-- and sits in a scalar subquery, so it runs once per statement. The client-write digest moves from
-- 51|0dd3e2d7e19f3f3649a893cfd9967d94 to 52|b66203ca5d355155540b520af510d120: its one new table-level
-- write is authenticated DELETE on closed_days (the column grants do not count there).
--
-- TEARDOWN. Neither table goes in ACCOUNT_OWNED_TABLES (packages/db/src/account-teardown.ts): the
-- account row delete carries both away, and service_role holds no DELETE on business_status.
--
-- LOCKS. The ALTERs take ACCESS EXCLUSIVE on calls, tasks and bookings for the length of this file; the
-- lock_timeout of 5s below is the protection. Every added column is nullable with no default, so no
-- table is rewritten.
--
-- SEARCH PATHS (0096 rule). Every function this file creates or re-creates writes
-- set search_path = pg_catalog, pg_temp, so pg_temp is searched last. No definer function is added, so
-- EXPECTED_DEFINERS in definer-search-path.test.ts does not change.
--
-- APPLY ORDER: after 0096 everywhere. CI project (ci-project-setup.yml: push-dry-run, then push), then
-- production (MCP apply_migration, once), then the parity check, then merge.
-- LOAD-BEARING: PostgREST refuses a request naming a column or table it does not know, and the build
-- after this file names them on every slot computation (the booking page, its move flow and three
-- receptionist tools), every in-account navigation (the shell reads business_status), every call start,
-- every chat turn, the browser voice demo, every call page, every To do page and the dashboard work
-- count, every cron tick, the Calendar page and every Voice page knowledge save.
-- SAFE UNDER THE RUNNING BUILD: additive. The running build names none of these objects; the new columns
-- are nullable with no default, and the re-created keep_task_links nulls two columns that build never
-- sends.
--
-- ROLLBACK (roll the app back first), in this order. Dropping either table loses every planned closed
-- day and the current switch, and dropping calls.business_status loses what each call was told: each of
-- those is an owner decision.
--   re-create app.keep_task_links() exactly as 0084 wrote it, with set search_path = pg_catalog, pg_temp
--     (FIRST: it names the two task columns, and every task insert fails once they are gone);
--   drop index public.tasks_closure_once;
--   alter table public.tasks drop constraint tasks_closure_coherent, drop column closure_on,
--     drop column closure_kind;   (lost: each closure To-do link; the To-dos stay as plain To-dos)
--   alter table public.bookings drop column closure_kept_at;   (lost: which appointments were kept)
--   alter table public.calls drop column business_status;   (owner decision)
--   drop table public.closed_days;   (owner decision; its trigger goes too)
--   drop table public.business_status;   (owner decision; its trigger goes too)
--   drop function app.closed_days_stamp();
--   drop function app.business_status_stamp();
--
-- ASCII only, no backslash anywhere, and every dollar sign in this file is part of a dollar-quote pair.

-- 0. Fail fast instead of queueing behind a long lock (0094 reason: inside a do block, so it is always in
--    the block transaction).
do $$
begin
  perform pg_catalog.set_config('lock_timeout', '5s', true);
end $$;

-- 1. The switch.
create table public.business_status (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  state text not null default 'open'
    constraint business_status_state_check check (state in ('open', 'closed_today', 'running_late', 'storm')),
  late_minutes integer
    constraint business_status_late_minutes_check check (late_minutes in (15, 30, 60, 120)),
  until timestamptz,
  set_by text not null default 'system',
  set_at timestamptz not null default now(),
  constraint business_status_shape_check check (
    (state = 'open' and late_minutes is null and until is null)
    or (state = 'closed_today' and late_minutes is null and until is not null)
    or (state = 'running_late' and late_minutes is not null and until is not null)
    or (state = 'storm' and late_minutes is null)),
  constraint business_status_until_check check (
    until is null or (until > set_at and until <= set_at + interval '100 days'))
);

create function app.business_status_stamp() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_sub text := app.jwt() ->> 'sub';
begin
  new.set_at := pg_catalog.now();
  new.set_by := case when pg_catalog.length(v_sub) > 0 then v_sub else 'system' end;
  return new;
end $$;
create trigger business_status_stamp before insert or update on public.business_status
  for each row execute function app.business_status_stamp();
revoke all on function app.business_status_stamp() from public, anon;
grant execute on function app.business_status_stamp() to authenticated, service_role;

-- 2. Planned closed days.
create table public.closed_days (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  reason text
    constraint closed_days_reason_check check (reason is null or reason in ('holiday', 'vacation', 'other')),
  created_by text not null,
  created_at timestamptz not null default now(),
  constraint closed_days_range_check check (ends_on >= starts_on and ends_on - starts_on <= 91)
);
create index closed_days_account_ends on public.closed_days (account_id, ends_on);

create function app.closed_days_stamp() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
declare
  v_sub text := app.jwt() ->> 'sub';
begin
  if new.starts_on < current_date - 2 or new.ends_on > current_date + 367 then
    raise exception 'closed_days: a closed day must not start in the past or end more than a year ahead'
      using errcode = '23514';
  end if;
  new.created_at := pg_catalog.now();
  new.created_by := case when pg_catalog.length(v_sub) > 0 then v_sub else 'system' end;
  return new;
end $$;
create trigger closed_days_stamp before insert on public.closed_days
  for each row execute function app.closed_days_stamp();
revoke all on function app.closed_days_stamp() from public, anon;
grant execute on function app.closed_days_stamp() to authenticated, service_role;

-- 3. What each call was told.
alter table public.calls
  add column business_status text
    constraint calls_business_status_check check (business_status in ('open', 'closed_today', 'running_late_15',
      'running_late_30', 'running_late_60', 'running_late_120', 'storm', 'closed_day'));

-- 4. The closure To-do link, once per account, kind and date.
alter table public.tasks
  add column closure_kind text
    constraint tasks_closure_kind_check check (closure_kind in ('status', 'closed_day')),
  add column closure_on date;
alter table public.tasks add constraint tasks_closure_coherent
  check ((closure_kind is null) = (closure_on is null));
create unique index tasks_closure_once on public.tasks (account_id, closure_kind, closure_on)
  where closure_kind is not null;

-- 5. An appointment the owner kept through a closure.
alter table public.bookings add column closure_kept_at timestamptz;

-- 6. Only server code sets or changes a To-do link (0074 guard, extended by 0080 and 0084, now by 0097;
--    create or replace keeps its ACL and the tasks_keep_links trigger).
create or replace function app.keep_task_links() returns trigger
language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  if coalesce(current_user = 'authenticated', false) then
    if tg_op = 'INSERT' then
      new.call_id := null;
      new.consent_event_id := null;
      new.document_request_id := null;
      new.document_request_kind := null;
      new.document_expiry_id := null;
      new.document_expiry_on := null;
      new.closure_kind := null;
      new.closure_on := null;
    else
      new.call_id := old.call_id;
      new.consent_event_id := old.consent_event_id;
      new.document_request_id := old.document_request_id;
      new.document_request_kind := old.document_request_kind;
      new.document_expiry_id := old.document_expiry_id;
      new.document_expiry_on := old.document_expiry_on;
      new.closure_kind := old.closure_kind;
      new.closure_on := old.closure_on;
    end if;
  end if;
  return new;
end $$;

-- 7. Grants.
revoke all on public.business_status from public, anon, authenticated, service_role;
grant select on public.business_status to authenticated, service_role;
grant update (state, late_minutes, until) on public.business_status to authenticated;
grant insert on public.business_status to service_role;

revoke all on public.closed_days from public, anon, authenticated, service_role;
grant select on public.closed_days to authenticated, service_role;
grant insert (account_id, starts_on, ends_on, reason), delete on public.closed_days to authenticated;
grant insert, delete on public.closed_days to service_role;

-- 8. Row level security.
alter table public.business_status enable row level security;
alter table public.closed_days enable row level security;

create policy business_status_member_read on public.business_status for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());

-- USING reads the row as it is (the old state), WITH CHECK the row as written (the new state). Staff may
-- move only between open and running late, never to a closure and never out of one in force; an expired
-- closure (until passed; an open-ended storm never qualifies) already reads as open everywhere. A Staff
-- running late may end no more than 26 hours out (the app always writes the end of today).
create policy business_status_update on public.business_status for update to authenticated
  using (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and ((select app.is_account_owner(app.current_account_id()))
             or ((select coalesce(app.account_role(app.current_account_id()) = 'staff', false))
                 and (state in ('open', 'running_late')
                      or (until is not null and until <= now()))))))
  with check (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and ((select app.is_account_owner(app.current_account_id()))
             or ((select coalesce(app.account_role(app.current_account_id()) = 'staff', false))
                 and state in ('open', 'running_late')
                 and (state = 'open' or until <= now() + interval '26 hours')))));

create policy closed_days_member_read on public.closed_days for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
create policy closed_days_owner_insert on public.closed_days for insert to authenticated
  with check (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and (select app.is_account_owner(app.current_account_id()))));
create policy closed_days_owner_delete on public.closed_days for delete to authenticated
  using (
    (select coalesce(app.is_agency(), false))
    or (account_id = (select app.current_account_id())
        and (select app.is_account_owner(app.current_account_id()))));

-- 9. Comments: who writes each, through what, and what NULL means.
comment on table public.business_status is
  'The one switch of an account (S-47d, F-084). One row per account; no row means open. Created by the server (ensureBusinessStatusRow, service_role); its state, late_minutes and until are UPDATEd by a signed-in Owner or the agency, or by Staff between open and running late (policy business_status_update). Expiry is computed on read: a row whose until has passed reads as open. History is the business_status.changed events, not this row.';
comment on column public.business_status.account_id is 'The account this switch belongs to. Written once, by ensureBusinessStatusRow (service_role).';
comment on column public.business_status.state is 'open, closed_today, running_late or storm. Written by setBusinessStatusAction and its Undo through the signed-in client.';
comment on column public.business_status.late_minutes is 'How far behind while running late: 15, 30, 60, or 120 for over an hour (D11). NULL in every other state.';
comment on column public.business_status.until is 'When the state ends by itself, computed by the server when the switch is set: midnight at the end of the day in the account zone for closed_today (owner decision D12) and for running_late, the first opening of the back-on date for a dated storm. NULL for open and for a storm until further notice. The reopening said to callers is computed on read from the hours.';
comment on column public.business_status.set_by is 'The Clerk user id from the token of whoever set it, or system for a server write. Stamped by app.business_status_stamp; anything sent is ignored.';
comment on column public.business_status.set_at is 'When it was last set. Stamped by app.business_status_stamp; the Undo compares it (compare-and-set).';
comment on table public.closed_days is
  'Planned whole-day closures of an account (S-47d, D5): the booking page offers no time on them and the receptionist says so. Added and removed by a signed-in Owner or the agency (addClosedDayAction, removeClosedDayAction); never updated. Fixtures and the local sweep write through service_role.';
comment on column public.closed_days.id is 'Row id.';
comment on column public.closed_days.account_id is 'The account. Sent by the signed-in insert; policy closed_days_owner_insert binds it to the token account.';
comment on column public.closed_days.starts_on is 'The first closed date, in the account time zone.';
comment on column public.closed_days.ends_on is 'The last closed date, in the account time zone; equal to starts_on for one day. At most 92 days in all.';
comment on column public.closed_days.reason is 'holiday, vacation or other; NULL when none was given. A fixed list, never free text, because it reaches the receptionist prompt.';
comment on column public.closed_days.created_by is 'The Clerk user id from the token, or system. Stamped by app.closed_days_stamp.';
comment on column public.closed_days.created_at is 'Stamped by app.closed_days_stamp.';
comment on column public.calls.business_status is
  'The status this call started under (S-47d, S6): open, closed_today, running_late_15, running_late_30, running_late_60, running_late_120, storm or closed_day. Stamped by startCallRow, server only. NULL for a call before 0097 and for one whose status could not be read.';
comment on column public.tasks.closure_kind is
  'status (a Closed today or Storm switch) or closed_day: this To-do lists the appointments a closure covers. Set only by server code (service_role); a signed-in insert stores NULL and a signed-in update keeps it (app.keep_task_links). NULL for every other To-do.';
comment on column public.tasks.closure_on is
  'The date the closure To-do was filed for: today in the account zone for status, the first closed date for closed_day. NULL exactly when closure_kind is NULL (tasks_closure_coherent).';
comment on column public.bookings.closure_kept_at is
  'When an Owner, Staff member or the agency kept this appointment through a closure (keepAppointmentAction, service_role), so its reminders, confirmations and follow-ups are not held. NULL when nobody kept it.';
```

- [ ] **Step 5: The two grant tests move, in this commit** (spec §4.1; `proposals-drop.test.ts:84-87`'s own rule).
  - In `schema-grants-guard.test.ts`'s `EXPECTED_WRITES` (`:65-107`), add these two entries in key order. `business_status` goes after `"authenticated agencies"`, and `closed_days` after `"authenticated checklist_items"`:
    ```ts
    "authenticated business_status": update(["late_minutes", "state", "until"]).sort(),
    "authenticated closed_days": ["DELETE", "INSERT(account_id)", "INSERT(ends_on)", "INSERT(reason)", "INSERT(starts_on)"],
    ```
  - In `proposals-drop.test.ts:98`, the literal becomes `"52|b66203ca5d355155540b520af510d120"`. Its comment (`:84-87`) gains one sentence: "0097 (S-47d) adds one table-level client write, authenticated DELETE on closed_days (the column-level grants on business_status and closed_days do not count here): 51 → 52, read off bis-ci after 0097."
  - Re-build the kit (it applies 0097 to `post` with `psql -1`). Run on `post`, from `packages/db`: `export SUPABASE_DB_URL=postgres://postgres@localhost:55471/post; node node_modules/vitest/vitest.mjs run src/test/one-switch-schema.test.ts src/test/schema-grants-guard.test.ts src/test/proposals-drop.test.ts src/test/definer-search-path.test.ts src/test/call-card-schema.test.ts src/test/document-expiry-schema.test.ts src/test/document-requests-schema.test.ts src/test/record-provenance-schema.test.ts src/test/structured-facts-schema.test.ts src/test/trade-modules-schema.test.ts src/test/server-only-writes-grants.test.ts` → all green.
    - All eleven are withRollback-only.
    - `definer-search-path.test.ts` proves 0097's three functions keep `pg_temp` last, and that `EXPECTED_DEFINERS` (22) is unchanged.
  - Read the run counts.
  - If the constraint or policy pins differ on your replica, STOP and report. They were read off the plan writer's PG18 replica with this SQL.

- [ ] **Step 6: Run each mutation** on `post`. For each one:
  1. Edit the migration.
  2. Re-build the kit.
  3. Run `one-switch-schema.test.ts`, plus `definer-search-path.test.ts` for mutation 14.
  4. Paste the failing assertion line.
  5. Edit back and `cmp`.

  The defs pin and the policy pin catch most mutations too, so MORE reds than each line lists are expected. A line lists the behavioural cases that must be among them.
  1. Drop `business_status_shape_check` → the eight "refuses …" shape cases FAIL.
  2. `late_minutes in (15, 30, 45, 60, 120)` → "refuses a 45-minute delay" FAILS.
  3. `interval '200 days'` in `business_status_until_check` → "refuses an end … more than 100 days" FAILS.
  4. In `business_status_update`'s WITH CHECK, drop `and state in ('open', 'running_late')` from the Staff branch → the four 42501 cells FAIL.
  5. In its USING, drop the `(state in (…) or (until … <= now()))` clause → the four "→ 0" Staff cells (out of a closure) FAIL.
  6. In its USING, drop `or (until is not null and until <= now())` → the two "expired Closed today" cells FAIL.
  7. `closed_days_owner_insert` with `with check (true)` → "a staff cannot add one", "a technician cannot add one", the cross-account plain insert ("an Owner of ANOTHER account cannot add one") and the policy pin FAIL. In the first draft the cross-account case used `returning` and stayed green; fix-round finding 2 changed it to a plain insert.
  7b. In `closed_days_owner_insert`, drop `account_id = (select app.current_account_id()) and` (keep the owner check) → ONLY "an Owner of ANOTHER account cannot add one" and the policy pin FAIL. Proven on the plan writer's replica: the stripped policy let B's Owner insert into A.
  8. `closed_days_owner_delete` with `using (true)` → "Staff and Technicians delete nothing" FAILS.
  9. `grant update on public.business_status to authenticated;` (table-wide) → "table privileges", "column privileges" and "a client cannot UPDATE set_by …" FAIL.
  10. `grant insert on public.business_status to authenticated;` → "table privileges" and "a client cannot … INSERT into business_status" FAIL.
  11. Drop `new.set_by := …` from `app.business_status_stamp` → both stamp cases FAIL.
  12. `current_date - 3` in `app.closed_days_stamp` → "the window" FAILS (three days ago is then accepted). Likewise `current_date - 1` → "the window" FAILS (two UTC days ago is then refused; that is fix-round item 8's bug).
  13. Drop `new.closure_kind := null;` from `keep_task_links` → "keep_task_links: a signed-in insert" FAILS.
  14. Write `set search_path = ''` on `keep_task_links` → "the three functions are invokers …" FAILS, and so does `definer-search-path.test.ts`'s invoker case ("every OTHER function … ends it with pg_temp").
  15. Drop `tasks_closure_once` → "one closure To-do per account, kind and date" FAILS.
  16. `closed_days.account_id … on delete restrict` → "the account row delete carries both tables away" FAILS.
  17. Delete `comment on column public.bookings.closure_kept_at` → the comments case FAILS.
  18. `business_status_member_read` with `using (true)` → "an Owner of ANOTHER account reads neither" and the policy pin FAIL.
  19. Drop `new.closure_on := old.closure_on;` → "a signed-in update cannot change or clear them" FAILS.
  20. In `business_status_update`'s WITH CHECK, drop `and (state = 'open' or until <= now() + interval '26 hours')` → "Staff: Open -> Running late ending 99 days out" and the policy pin FAIL. Fix-round finding 4: without the bound, Staff could store a 99-day Running late, proven on the replica.

- [ ] **Step 7: Rollback, digest and bytes.**
  - On a throwaway `create database rb template post`, run the ROLLBACK lines in order. They are this exact SQL, which the plan writer ran successfully:
    ```sql
    create or replace function app.keep_task_links() returns trigger
    language plpgsql set search_path = pg_catalog, pg_temp as $$
    begin
      if coalesce(current_user = 'authenticated', false) then
        if tg_op = 'INSERT' then
          new.call_id := null;
          new.consent_event_id := null;
          new.document_request_id := null;
          new.document_request_kind := null;
          new.document_expiry_id := null;
          new.document_expiry_on := null;
        else
          new.call_id := old.call_id;
          new.consent_event_id := old.consent_event_id;
          new.document_request_id := old.document_request_id;
          new.document_request_kind := old.document_request_kind;
          new.document_expiry_id := old.document_expiry_id;
          new.document_expiry_on := old.document_expiry_on;
        end if;
      end if;
      return new;
    end $$;
    drop index public.tasks_closure_once;
    alter table public.tasks drop constraint tasks_closure_coherent, drop column closure_on, drop column closure_kind;
    alter table public.bookings drop column closure_kept_at;
    alter table public.calls drop column business_status;
    drop table public.closed_days;
    drop table public.business_status;
    drop function app.closed_days_stamp();
    drop function app.business_status_stamp();
    ```
  - Then check:
    - `select count(*) from pg_constraint where conname like 'business_status%' or conname like 'closed_days%' or conname like 'tasks_closure%' or conname = 'calls_business_status_check'` → `0`.
    - The client-write digest → `51|0dd3…`.
    - `select md5(prosrc), proconfig from pg_proc where proname = 'keep_task_links'` → `ea8acf1dfbc3417144a994251094ffba`, `{"search_path=pg_catalog, pg_temp"}`. That equals `pre` and Task 0's MCP read 4.
  - Drop `rb`.
  - On `post`, the client-write digest → `52|b66203ca5d355155540b520af510d120`.
  - Bytes:
    - the node byte count → `0 0` (with its `2 1` control);
    - `grep -o '\$' f | wc -l` → `16`;
    - `grep -niw cascade f` → exactly the two `on delete cascade` lines;
    - `grep -c "''" f` → `0`;
    - `grep -ci "security definer" f` → `0`;
    - `grep -n "search_path" f` → the two header comment lines plus exactly three `language plpgsql set search_path = pg_catalog, pg_temp as` lines.
  - Record `md5sum` of the file. It equals `0c6ed6130fbdd3fd18d92a7429512a35` if nothing changed. If it differs, say what changed and why.

- [ ] **Step 8: Commit** (both typechecks green).

```bash
git add -- packages/db/supabase/migrations/0097_one_switch.sql packages/db/src/test/one-switch-schema.test.ts
git diff --cached --stat
git commit -m "db: one switch per account (open, closed today, running late, storm) and planned closed days, what each call was told, the closure To-do link and kept appointments; Owners and the agency write, Staff only between open and running late (S-47d, migration 0097)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013RThMy9QC8x7FZ94Lxib9p" -- packages/db/supabase/migrations/0097_one_switch.sql packages/db/src/test/one-switch-schema.test.ts packages/db/src/test/schema-grants-guard.test.ts packages/db/src/test/proposals-drop.test.ts
```

**Acceptance:**
- Every case is green on `post` and red on `pre` (except the two noted).
- Every mutation fails by name.
- The digest moves exactly as spec §4.1 says.
- The rollback leaves nothing.
- The bytes pass, and the md5 is in the report.

**Review (HIGH):** an opus bis-reviewer in its own detached worktree, with its own kit on 55472.
- It applies 0097 to a fresh `pre` copy through `psql -1` only, and reads every def and policy itself.
- It re-runs mutations 4, 5, 6, 7b, 13, 14 and 20, plus three of its own:
  - `grant select on public.closed_days to anon` (the table-privilege case must catch it);
  - swap `'storm'` for `'storms'` in `business_status_state_check` (only the defs pin and the "accepts the valid row" cases can catch it; say which);
  - in the stamp, `new.set_by := coalesce(new.set_by, v_sub)` (the stamp case must catch it).
- It checks the bytes and the md5, and that no comment string or `--` line holds an apostrophe.
- It reads `keep_task_links` against `0084_document_expiry_tasks.sql:52-73` line by line: only the four new lines differ, plus the SET clause.
- It confirms `definer-search-path.test.ts` is green on `post` and that `EXPECTED_DEFINERS` was not edited.
- A re-review follows any change. The md5 that reaches bis-ci is the reviewed one.

---

## Task 2 (LOW): Every new copy key, English and Spanish (bis-frontend)

**Brief.**
- Add every key below to `apps/web/src/lib/messages.ts`, each `.es` twin on the line after its key.
  - Place them after the S-47c block's last key (`"voice.knowledge.loading.es"`, `messages.ts:2298` at `d280b847`; re-read after the rebase), under one comment line: `// S-47d: the one switch, closed days, the closure To-do and hold reasons, the call-page status line. Usted.`
- Append ONE `describe("S-47d: the one switch copy, English and Spanish (plan Task 2)")` to `apps/web/src/lib/messages.test.ts`, in the shape of the S-47c describe (`messages.test.ts:1444-1568`). It contains:
  - a literal `EXPECTED_PARAMS` map over every new key, with its length asserted as **120** (the 108 rows of the table below plus the 12 of the call-page table; the fix round replaced `todayAppointments`, `laterHeld` and `laterHeldOne` with `affectedAppointments` and `moreLater`, S22, counted off this file with `awk` on 2026-10-23; recount it yourself before you trust it);
  - every key and twin present and different;
  - params identical across the twin;
  - every sentence pinned as a typed literal pair;
  - usted (the S-47b regex);
  - no typed "Sofía";
  - no plumbing word (`business_status|closure_kind|null|RPC|set_at|running_late`).
- In `apps/web/src/lib/booking/public-strings.ts`, add the four keys of "The model, The booking page strings" to BOTH tables (`en` after `noSlotsHint`, `public-strings.ts:20`; `es` after `:139`). `public-strings.test.ts` already pins same keys, no empty value and no verbatim twin (`:7`, `:16`). Add one case pinning the four pairs as literals.
- Run `messages.test.ts`, `public-strings.test.ts`, `src/lib/i18n/ratchet.test.ts` and `src/lib/i18n/accents-guard.test.ts` → green. Then typecheck and eslint.
- Commit `copy: the one switch, closed days, the closure To-do, the hold reasons and the call-page status, English and Spanish (S-47d)`, naming the four files.
- No baseline regeneration here (Task 14 does it once).

| Key | English | Spanish (usted) |
|---|---|---|
| `business.state.open` | Open | Abierto |
| `business.state.closedToday` | Closed today | Cerrado hoy |
| `business.state.runningLate` | Running late | Con retraso |
| `business.state.storm` | Closed for a storm | Cerrado por tormenta |
| `business.menu.trigger` | Change today's status | Cambiar el estado de hoy |
| `business.menu.open` | Open | Abierto |
| `business.menu.closedToday` | Closed today | Cerrado hoy |
| `business.menu.runningLate` | Running late | Con retraso |
| `business.menu.late15` | About 15 minutes | Unos 15 minutos |
| `business.menu.late30` | About 30 minutes | Unos 30 minutos |
| `business.menu.late60` | About an hour | Como una hora |
| `business.menu.late120` | More than an hour | Más de una hora |
| `business.menu.storm` | Storm | Tormenta |
| `business.menu.stormOpenEnded` | Until further notice | Hasta nuevo aviso |
| `business.menu.stormBackOn` | Back on a date… | Reabrimos el… |
| `business.menu.changeClosedDays` | Change closed days | Cambiar días cerrados |
| `business.storm.title` | Closed for a storm until | Cerrado por tormenta hasta |
| `business.storm.date` | Back on | Reabrimos el |
| `business.storm.submit` | Close until then | Cerrar hasta entonces |
| `business.storm.dateError` | Pick a date from tomorrow to 92 days from now. | Elija una fecha entre mañana y dentro de 92 días. |
| `business.opens.time` | opens {time} | abre a las {time} |
| `business.opens.tomorrow` | opens tomorrow | abre mañana |
| `business.opens.dayTime` | opens {day} {time} | abre el {day} a las {time} |
| `business.opens.day` | opens {day} | abre el {day} |
| `business.opens.date` | opens {date} | abre el {date} |
| `business.topbar.closedToday` | Closed today · {opens} | Cerrado hoy · {opens} |
| `business.topbar.storm` | Closed for a storm | Cerrado por tormenta |
| `business.topbar.stormDated` | Closed for a storm · {opens} | Cerrado por tormenta · {opens} |
| `business.topbar.late15` | Running about 15 min late | Con unos 15 min de retraso |
| `business.topbar.late30` | Running about 30 min late | Con unos 30 min de retraso |
| `business.topbar.late60` | Running about an hour late | Con alrededor de una hora de retraso |
| `business.topbar.late120` | Running over an hour late | Con más de una hora de retraso |
| `business.topbar.short.closedToday` | Closed today | Cerrado hoy |
| `business.topbar.short.storm` | Storm | Tormenta |
| `business.topbar.short.late15` | 15 min late | 15 min tarde |
| `business.topbar.short.late30` | 30 min late | 30 min tarde |
| `business.topbar.short.late60` | 1 hr late | 1 h tarde |
| `business.topbar.short.late120` | 1+ hr late | 1+ h tarde |
| `business.topbar.open` | Open | Abierto |
| `business.toast.closedToday` | Closed for today. Your booking page now says so. | Cerrado por hoy. Su página de citas ya lo dice. |
| `business.toast.storm` | Closed for a storm. Your booking page now says so. | Cerrado por tormenta. Su página de citas ya lo dice. |
| `business.toast.late` | Running late today. Booking stays open. | Con retraso hoy. Las citas siguen abiertas. |
| `business.toast.open` | Open again. Your booking page takes bookings as usual. | Abierto de nuevo. Su página de citas recibe citas como siempre. |
| `business.toast.persona` | {persona} says so too. | {persona} también lo dice. |
| `business.toast.todo` | A To-do lists the {n} affected appointments. | Una tarea en Pendientes lista las {n} citas afectadas. |
| `business.toast.todoOne` | A To-do lists the affected appointment. | Una tarea en Pendientes lista la cita afectada. |
| `business.toast.undone` | Change undone. | Cambio deshecho. |
| `business.toast.changedSince` | Someone changed this since, so nothing was undone. | Alguien lo cambió mientras tanto, así que no se deshizo nada. |
| `business.toast.failed` | Couldn't change today's status. Try again. | No se pudo cambiar el estado de hoy. Intente de nuevo. |
| `business.refuse.role` | Only an Owner can change this. | Solo un propietario puede cambiar esto. |
| `business.refuse.closeOrReopen` | Only an Owner can close the business or reopen it. | Solo un propietario puede cerrar el negocio o volver a abrirlo. |
| `business.card.title` | Today | Hoy |
| `business.card.change` | Change | Cambiar |
| `business.card.openToday` | Open today | Abierto hoy |
| `business.card.nextClosedDay` | Next closed day: {date} | Próximo día cerrado: {date} |
| `business.card.nextClosedDayReason` | Next closed day: {date} ({reason}) | Próximo día cerrado: {date} ({reason}) |
| `business.card.opensAgain.tomorrow` | Opens again tomorrow at {time} | Abre de nuevo mañana a las {time} |
| `business.card.opensAgain.day` | Opens again on {day} at {time} | Abre de nuevo el {day} a las {time} |
| `business.card.opensAgain.date` | Opens again on {date} at {time} | Abre de nuevo el {date} a las {time} |
| `business.card.opensAgain.tomorrowNoTime` | Opens again tomorrow | Abre de nuevo mañana |
| `business.card.opensAgain.dayNoTime` | Opens again on {day} | Abre de nuevo el {day} |
| `business.card.opensAgain.dateNoTime` | Opens again on {date} | Abre de nuevo el {date} |
| `business.card.untilReopen` | Until you reopen | Hasta que vuelva a abrir |
| `business.card.endsMidnight` | Ends at midnight | Termina a la medianoche |
| `business.card.lateHidden` | Booking stays open; times in the next {minutes} minutes are hidden. | Las citas siguen abiertas; se ocultan los horarios de los próximos {minutes} minutos. |
| `business.card.lateHidden120` | Booking stays open; times in the next 2 hours are hidden. | Las citas siguen abiertas; se ocultan los horarios de las próximas 2 horas. |
| `business.card.affectedAppointments` | Affected appointments | Citas afectadas |
| `business.card.waiting` | {n} messages waiting | {n} mensajes en espera |
| `business.card.waitingOne` | 1 message waiting | 1 mensaje en espera |
| `business.card.keep` | Keep | Mantener |
| `business.card.kept` | Kept | Se mantiene |
| `business.card.keptToast` | Kept. Its reminders go out as usual. | Se mantiene. Sus recordatorios salen como siempre. |
| `business.card.cancelOnCalendar` | Cancel on the calendar | Cancelar en el calendario |
| `business.card.moreLater` | More appointments after {date} are on the calendar. | Hay más citas después del {date} en el calendario. |
| `business.card.noneAffected` | No appointments are affected. | Ninguna cita se ve afectada. |
| `business.card.error` | Couldn't load today's status. | No se pudo cargar el estado de hoy. |
| `business.card.retry` | Retry | Reintentar |
| `business.reason.holiday` | Holiday | Día festivo |
| `business.reason.vacation` | Vacation | Vacaciones |
| `business.reason.other` | Other | Otro |
| `business.reason.none` | None | Ninguno |
| `closedDays.title` | Closed days | Días cerrados |
| `closedDays.from` | From | Desde |
| `closedDays.to` | To (optional) | Hasta (opcional) |
| `closedDays.reason` | Reason | Motivo |
| `closedDays.add` | Add closed days | Agregar días cerrados |
| `closedDays.remove` | Remove | Quitar |
| `closedDays.count` | {n} appointments | {n} citas |
| `closedDays.countOne` | 1 appointment | 1 cita |
| `closedDays.added` | Closed days added. | Días cerrados agregados. |
| `closedDays.addedTodo` | {n} appointments are on these days. A To-do lists them. | Hay {n} citas en estos días. Una tarea en Pendientes las lista. |
| `closedDays.removed` | Closed days removed. | Días cerrados quitados. |
| `closedDays.empty` | No closed days planned. Add a holiday or a vacation, and your booking page and {persona} will know you're closed. | No hay días cerrados planeados. Agregue un día festivo o unas vacaciones, y su página de citas y {persona} sabrán que está cerrado. |
| `closedDays.error` | Couldn't load closed days. | No se pudieron cargar los días cerrados. |
| `closedDays.saveFailed` | Couldn't save the closed days. Try again. | No se pudieron guardar los días cerrados. Intente de nuevo. |
| `closedDays.role` | Only an Owner can change closed days. | Solo un propietario puede cambiar los días cerrados. |
| `closedDays.error.past` | The first day can't be in the past. | El primer día no puede ser en el pasado. |
| `closedDays.error.endBeforeStart` | The last day must be on or after the first. | El último día debe ser igual o posterior al primero. |
| `closedDays.error.tooLong` | Closed days can cover at most 92 days at a time. | Los días cerrados pueden cubrir como máximo 92 días a la vez. |
| `closedDays.error.tooFar` | Closed days must end within the next 12 months. | Los días cerrados deben terminar dentro de los próximos 12 meses. |
| `closedDays.error.overlap` | These days overlap {range}, already listed. | Estos días se cruzan con {range}, que ya está en la lista. |
| `business.todo.status` | Contact customers affected by the closure | Comuníquese con los clientes afectados por el cierre |
| `business.todo.closedDay` | Contact customers booked on {dates} | Comuníquese con los clientes con cita el {dates} |
| `automations.reason.heldClosedToday` | Held: the business is closed today | En espera: el negocio está cerrado hoy |
| `automations.reason.heldStorm` | Held: closed for a storm | En espera: cerrado por tormenta |
| `automations.reason.heldClosedDay` | Held: the business is closed that day | En espera: el negocio está cerrado ese día |
| `automations.reason.heldClosureUnknown` | Held: couldn't check whether the business is open | En espera: no se pudo comprobar si el negocio está abierto |
| `automations.reason.skippedClosed` | Not sent: the business was closed for this appointment | No se envió: el negocio estaba cerrado para esta cita |

**Call-page and knowledge-page keys** (part of the same describe; counted in the 120):

| Key | English | Spanish |
|---|---|---|
| `calls.detail.businessStatus` | Status at the start | Estado al empezar |
| `calls.detail.businessStatus.open` | Open | Abierto |
| `calls.detail.businessStatus.closed_today` | Closed today | Cerrado hoy |
| `calls.detail.businessStatus.running_late_15` | Running about 15 minutes late | Con unos 15 minutos de retraso |
| `calls.detail.businessStatus.running_late_30` | Running about 30 minutes late | Con unos 30 minutos de retraso |
| `calls.detail.businessStatus.running_late_60` | Running about an hour late | Con alrededor de una hora de retraso |
| `calls.detail.businessStatus.running_late_120` | Running more than an hour late | Con más de una hora de retraso |
| `calls.detail.businessStatus.storm` | Closed for a storm | Cerrado por tormenta |
| `calls.detail.businessStatus.closed_day` | Closed (closed day) | Cerrado (día cerrado) |
| `voice.knowledge.closedDays` | Closed days | Días cerrados |
| `voice.knowledge.noClosedDays` | No closed days were planned. | No había días cerrados planeados. |
| `voice.knowledge.noClosedDaysRecorded` | No closed days were recorded in this version. | En esta versión no se registraron días cerrados. |

- The "Undo" label is the existing `common.undo` (`messages.ts:298-299`).
- The spec's sentences are verbatim:
  - "Someone changed this since, so nothing was undone.", "Only an Owner can change this.", "Only an Owner can close the business or reopen it.", "Contact customers affected by the closure" (the orchestrator's widened S7, 2026-10-23), "Contact customers booked on {dates}", "Keep", "Kept", "Cancel on the calendar", "No appointments today are affected.", "Couldn't load today's status.", "Couldn't load closed days.", "Status at the start", "No closed days were recorded in this version.";
  - the To-do toast pair, worded for the widened S7 (no longer "today's");
  - the menu pairs;
  - the reason pairs.
- SD19: the toasts drop the spec's first-draft example "Sofía and your booking page now say so." (persona may be absent: an account with no voice profile still has the switch; the spec's §5.6.1 now matches). They say what changed on the booking page and append `business.toast.persona` when a persona name is known. The design reviewer reads this at 7 AM.
- `{dates}` format (SD16), built by `closureTodoDates` (Task 7):
  - one day: `December 24` / `24 de diciembre`;
  - a range in one month: `December 24 – 26` / `24 al 26 de diciembre`;
  - across months: `December 28 – January 1` / `28 de diciembre al 1 de enero`.

---

## Task 3 (MEDIUM): `@bis/db` — `business-status.ts`, the call stamp, `openTasks`, the three recipe selects (bis-db-schema)

**Dispatch gate:** Task 1's review approved (this task needs 0097 on its replica).

**Files:**
- Create: `packages/db/src/business-status.ts`; `packages/db/src/test/business-status.test.ts` (PostgREST: `withTestAccount`, `packages/db/src/test/fixtures.ts:140`).
- Modify:
  - `packages/db/src/index.ts:144`: add `export * from "./business-status";` after `export * from "./voice-knowledge";`.
  - `packages/db/src/voice.ts:322-361` (`startCallRow` + doc comment) and `:1010-1024` (`CallDetailRow`, `CALL_DETAIL_COLS`).
  - `packages/db/src/work-queue.ts:10-34` (`WorkRow.closureFocus`), `:56` (select) and the row mapper below it.
  - `packages/db/src/automations.ts`, for SD5:
    - `REVIEW_REQUEST_SELECT` (`:263`) and the type at `:191-219`;
    - `NO_SHOW_NUDGE_SELECT` (`:441`) and the type at `:412-434`;
    - `REFERRAL_ASK_SELECT` (`:1037-1038`) and the type at `:999-1029`;
    - each one's row mapper, which sets `startsAt: row.starts_at`.
  - **SD20, Keep per subject:** all seven booking-subject selects gain `closure_kept_at`, and each Due type gains `closureKeptAt: string | null` (its mapper sets `closureKeptAt: row.closure_kept_at`):
    - `REMINDER_SELECT` (`packages/db/src/booking.ts:1348-1349`);
    - `FOLLOWUP_SELECT` (`booking.ts:1483`);
    - `SMS_REMINDER_SELECT` (`automations.ts:591`);
    - `APPOINTMENT_CONFIRM_SELECT` (`:735`);
    - and the three above.

    The by-id reads use the same selects (`getDueReminderById` `booking.ts:1411-1422`, `getDueFollowupById` `:1530-1544`, and the `automations.ts` by-id reads at `:322`, `:497`, `:638`, `:784`, `:1127`), so a release re-reads a fresh Keep.
  - `packages/db/src/account-teardown.ts`, the doc block at `:40-113` (fix-round item 9). Add one paragraph in the shape of the S-47c one on `voice_services` and `voice_knowledge_snapshots`: "`business_status` and `closed_days` (0097, S-47d) are off this list: service_role holds no DELETE on `business_status`, and both carry `account_id … on delete cascade`, so the account row delete carries them away (`one-switch-schema.test.ts` proves it)."
  - The typed literals that the new required fields break (the typecheck lists them; fix each with `business_status: null` / `startsAt: "<the fixture's starts_at>"` / `closureKeptAt: null`, never by loosening a type):
    - `[acct]/calls/[callId]/page.test.ts` (its `CallDetailRow` literal);
    - `packages/db/src/test/voice.test.ts`;
    - the seven passes' test fixtures (`…/passes/{reminders,followups,sms-reminder,appointment-confirm,no-show-nudge,review-request,referral-ask}.test.ts`).

**Interfaces:** every signature in "The model, `@bis/db`". Task 3 is the only writer of `packages/db/src/**` except Task 1's tests and Task 9's one doc comment.

**Rules:**
- **`updateBusinessStatus`:**
  - `db.from("business_status").update(patch).eq("account_id", accountId)`, plus `.eq("set_at", opts.expectedSetAt)` when given, then `.select(BUSINESS_STATUS_COLS)`.
  - An empty result → `null`.
  - `error.code === "42501"` → `null` (SD1).
  - Any other error → `throw new Error(\`updateBusinessStatus failed: ${error.message}\`)`.
- **`insertClosedDay`** throws an `Error` whose `code` property is PostgREST's `error.code` (the action maps 23514 and 42501).
- **`ensureClosureTask`:**
  - Inserts `{ account_id, title, due_at: new Date().toISOString(), contact_id: null, assigned_to: null, created_by, closure_kind, closure_on }`.
  - On `23505`, re-read the id by `(account_id, closure_kind, closure_on)`.
  - Emits `task.created` on a real insert through `emit(db, accountId, "task.created", createdBy, { task_id }, "user")`. Copy `ensureDocumentExpiryTask`'s exact emit call (`packages/db/src/document-expiry.ts:62-81`).
- **`countHeldByBooking`:** `.from("automation_log").select("subject_key").eq("account_id", …).eq("status", "held").in("subject_key", ids.map((i) => \`booking:${i}\`))`, counted in code. It returns an empty Map for `[]` without a request.
- **`loadClosureSnapshot`:**
  - Runs `Promise.all` of four reads for the given `accountId`: `readAccountTimezone` (`automation-settings.ts:13-17`), `getBusinessStatusRow`, `listClosedDaysFrom(…, since.date)`, `readHoursChain`.
  - It no longer reads kept bookings (SD20).
  - It throws if any of the first three throws; the hours chain never throws.

**Tests** (`business-status.test.ts`, PostgREST; seed only through the writers):
- **`ensureBusinessStatusRow`:**
  - twice → one row, `state` `open`, `set_by` `system` (A6);
  - `getBusinessStatusRow` reads it;
  - a second account reads null for its own id.
- **`updateBusinessStatus` with a service client:**
  - Case 1: patch to `running_late`/30/until → the row read back carries them, and `set_at` is a string that `Date.parse` accepts.
  - Case 2: with `expectedSetAt` = case 1's `set_at` VERBATIM → updated (A5, SD14).
  - Case 3: with a stale `expectedSetAt` → `null`, and the stored row is unchanged (re-read).
  - Case 4: a mutation probe. Rounding `set_at` through `new Date(...).toISOString()` before passing it makes case 2 return null. Write the case so this reads as the reason the string is kept.
- **`listClosedDaysFrom`:**
  - order by `starts_on`, then `id`;
  - `fromDate` filters on `ends_on`;
  - `limit`;
  - a second account's rows never appear.
- **`insertClosedDay` / `deleteClosedDay`** with the service client:
  - insert returns `created_by` `system`;
  - delete returns the row;
  - deleting another account's id with this account's id → null, and the row is still there.
- **`listClosureAppointments`:**
  - Seed bookings through `createBooking` (`packages/db/src/booking.ts`; read its signature) on two accounts.
  - The window is `[from, to)`. A cancelled booking is excluded.
  - Names come through the embed.
  - Second account → none.
- **`setBookingClosureKept`:**
  - true sets it, and the re-read is not null;
  - false clears it;
  - a cancelled booking → false;
  - another account's booking id → false and unchanged.
- **`ensureClosureTask`:**
  - first call → `created: true`;
  - second → `created: false` with the same id;
  - another date → a new id;
  - the row's `closure_kind`/`closure_on` re-read;
  - one `task.created` event.
- **`deleteOpenClosureTask`:**
  - an open one → true;
  - a completed one (`completed_at` set by the service client) → false and still there;
  - a plain To-do with no closure link → false;
  - another account → false.
- **`countHeldByBooking`:** seed `automation_log` rows through `recordAutomationLog` (held/sent, two bookings, two accounts) → only this account's held ones are counted.
- **`loadClosureSnapshot`:** returns each part for the given account. A second account's status row and closed days are absent (seed a storm and a closed day on account B; load A → `row` null, `closedDays` `[]`).
- **The seven due-row readers** carry `closureKeptAt`: null before Keep, the stamp after `setBookingClosureKept(…, true)`. Include one appointment that ENDED three days ago, read through the referral-ask reader (`REFERRAL_ASK_MAX_AGE_MS` is 85 h, `automations.ts:997`), so the kept flag is proven readable outside any two-day window (SD20).
- **`startCallRow` with `businessStatus: "storm"`** → `getCall` reads `business_status: "storm"`. Without it → null.
- **`listAccountWork`** (via `ensureClosureTask`) → the row's `closureFocus` is `{ kind: "status", on: <date> }`, and a plain task has none.
- **The three recipe readers** (`listDueReviewRequests` etc.; read their names at the cited lines) carry `startsAt` equal to the booking's `starts_at`.

**Verify:**
- Build your kit on 55473/55474/55475 with PostgREST (`replica.sh 55473 <dir>`, then `pgrst.sh 55473 55474 55475 <dir>`).
- Run on your replica (`source <dir>/env-run.sh`; from `packages/db`): `src/test/business-status.test.ts src/test/voice.test.ts src/test/work-queue.test.ts src/test/automations*.test.ts src/test/booking.test.ts src/test/voice-schema.test.ts`. Read `ls src/test` for the exact names of the work-queue and automations suites.
- The named mutations:
  - drop `.eq("account_id", …)` in `getBusinessStatusRow`, `listClosedDaysFrom`, `deleteClosedDay`, `setBookingClosureKept` and `deleteOpenClosureTask` → each second-account case FAILS;
  - `CALL_DETAIL_COLS` without `business_status` → the `getCall` case FAILS;
  - `openTasks` without the two columns → the `closureFocus` case FAILS;
  - `expectedSetAt` ignored → case 3 FAILS.
- Paste each, revert, `cmp`.
- Both typechecks; eslint on touched files.
- Commit `db: read and write the switch, closed days, kept appointments and the closure To-do; calls carry the status they started under; three recipes read the appointment start (S-47d)` naming every path. Stop your kit.

**Review (MEDIUM, sonnet, own worktree and kit on 55476–55478):**
- Re-run the second-account mutations.
- Read `updateBusinessStatus` for a path that reports success when no row matched.
- Read `loadClosureSnapshot` for a read that swallows an error the hold needs to see.

---

## Task 4 (MEDIUM): The pure status reader (bis-booking)

**Files:**
- Create: `…/bstatus/status.ts`, `…/bstatus/status.test.ts`.
- Modify: `apps/web/src/lib/booking/slots.ts`. Add ONE exported type line after `SlotConfig` (`:11-14`): `export type SlotClosures = { closedDayKeys: ReadonlySet<string>; blockedBefore: Date | null; blockAll: boolean; lateBefore: Date | null };`. Task 5 adds the rest.

**Interfaces:** "The model, The reader", exactly. Imports: only `../booking/slots` (relative; no `@/`, no `@bis/db`).

**Rules:** "The model, The reader" bullets. Implementation notes:
- `dayKey` uses `partsInZone` (`slots.ts:40`).
- `wallTime(key, "HH:MM", tz)` calls `zonedTimeToUtc` (`slots.ts:82`), which returns null in a DST gap. On null it steps forward one minute at a time, at most 180 times, and returns the first non-null. The test pins `America/Chicago` 2027-03-14 02:30 → 03:00 CDT = `2027-03-14T08:00:00.000Z`.
- `addDays` is pure calendar arithmetic on `YYYY-MM-DD` (`Date.UTC`), never through a zone.
- `hoursChain` uses `normalizeOpenHours` (`slots.ts:132`) and S-47c's open-day rule (`…/knowledge/hours.ts:28-30` `hasOpenDay`). Copy the predicate; do not import `hours.ts`, so the graph stays acyclic: `hours.ts` will import this file in Task 6.

**Tests** (`status.test.ts`, all literals; zone `America/Chicago` unless named):
- `H = { mon: [["08:00","17:00"]], tue: …, fri: [["08:00","17:00"]] }` (Mon–Fri 8–5).
- `SUN_H` adds `sun: [["08:00","12:00"]]`.
- `CAL = { sat: [["09:00","13:00"]] }`.
- **Each state in force, and the same row expired** (until passed) → `{ state: "open", nextClosedDay: null }`.
- **Precedence (S11), one case per pair:**
  - storm + closed day → storm;
  - closed day + Closed today → closed_day;
  - closed day + Running late → closed_day;
  - Closed today + nothing → closed_today;
  - Running late alone → running_late.
- **S1 with D12:** Closed today set Tuesday 2027-06-01 07:00 CDT (12:00Z) with `H` → `untilFor` = tonight's midnight, `2027-06-02T05:00:00.000Z`. `effectiveStatus` at 07:00 has `reopensAt` = Wednesday 08:00 CDT = `2027-06-02T13:00:00.000Z`, `reopensTimeKnown: true` (not Tuesday 08:00, S1). At `2027-06-02T05:00:00.000Z` the same row reads `{ state: "open", … }` (expired).
  - Mutation (the pre-D12 rule): `untilFor` closed_today = the reopening → FAILS.
- **D12, the two-hours-sources case** (F7): business hours `H` (Mon–Fri) and calendar hours `CAL` (Sat 09:00–13:00), so `hoursChain(H, CAL)` = `H`. Closed today set Friday 2027-06-04 10:00 CDT (`2027-06-04T15:00:00.000Z`):
  - `untilFor` → `2027-06-05T05:00:00.000Z` (Saturday 00:00 CDT);
  - `slotClosures(...).blockedBefore` → the same instant, so `closedOut` of the Saturday 09:00 slot (`2027-06-05T14:00:00.000Z`) is false;
  - `coversAppointment` of a Saturday 09:00 appointment → `{ covered: false }`;
  - and the reopening said is `reopensAt` = Monday 08:00 CDT, `2027-06-07T13:00:00.000Z`. The words still follow the hours chain; only the window changed.
- **`untilFor` Running late at 2027-06-01 15:00Z** → `2027-06-02T05:00:00.000Z`.
- **`untilFor` Storm `backOn: "2027-06-07"` (a Monday)** → `2027-06-07T13:00:00.000Z`. `backOn` null → null.
- **`reopeningFrom`:**
  - with business hours;
  - with only calendar hours (`hoursChain(null, CAL)`);
  - with none: `from` = 2027-06-02 05:00Z, exactly 00:00 CDT → returns `from` itself, `timeKnown: false` (SD3; mutation: "the first day AFTER from's day" → FAILS);
  - across a weekend (Friday 18:00 → Monday 08:00);
  - skipping a closed range (Monday a closed day → Tuesday 08:00).
- **DST in Chicago (spec §7):**
  - Saturday 2027-03-13 10:00 CST, Closed today → `until` = `2027-03-14T06:00:00.000Z` (Sunday 00:00 CST). The reopening said: with `SUN_H` → `2027-03-14T13:00:00.000Z` (Sunday 08:00 CDT); with `H` → `2027-03-15T13:00:00.000Z` (Monday 08:00 CDT).
  - Saturday 2026-10-31 10:00 CDT → `until` = `2026-11-01T05:00:00.000Z` (Sunday 00:00 CDT). The reopening said: with `SUN_H` → `2026-11-01T14:00:00.000Z` (Sunday 08:00 CST); with `H` → `2026-11-02T14:00:00.000Z`.
  - A span starting 02:30 on 2027-03-14 → 03:00 CDT (`2027-03-14T08:00:00.000Z`).
- **Zones whose MIDNIGHT is the DST gap, plus Santiago's fall-back** (fix-round item 7). The values were checked by the reviewer's run of this `wallTime`, and independently by the plan writer with a brute-force minute search over Node's ICU time-zone data. The start of the day is 01:00 local in the three gap zones. For each zone, with "the day before" at 15:00 local as `now`, four cases:
  - `startOfDay(day)`;
  - `untilFor({ state: "running_late", lateMinutes: 30 }, …)`;
  - `untilFor({ state: "closed_today" }, …)`, the D12 window end;
  - `reopeningFrom(startOfDay(day), null, tz, [])` → `{ at: startOfDay(day), timeKnown: false }`.

  Every one equals the "start of day" value below:

  | zone | the day before, 15:00 local (`now`) | day | start of day |
  |---|---|---|---|
  | `America/Havana` | `2027-03-13T20:00:00.000Z` | 2027-03-14 | `2027-03-14T05:00:00.000Z` |
  | `America/Santiago` | `2026-09-05T19:00:00.000Z` | 2026-09-06 | `2026-09-06T04:00:00.000Z` |
  | `Asia/Beirut` | `2027-03-27T13:00:00.000Z` | 2027-03-28 | `2027-03-27T22:00:00.000Z` |
  | `America/Santiago` (fall-back) | `2027-04-03T18:00:00.000Z` | 2027-04-04 | `2027-04-04T04:00:00.000Z` |

  Mutation: `wallTime` returning null in the gap → the three gap rows FAIL (not just Chicago's 02:30 case). Mutation: `startOfDay` built as `Date.UTC(…) - offset at noon` → the three gap rows FAIL (noon already carries the post-gap offset).
- **Running late at 11 PM with 120:** now `2027-06-02T04:00:00.000Z` (23:00 CDT), until `2027-06-02T05:00:00.000Z` → `slotClosures(...).lateBefore` = `2027-06-02T05:00:00.000Z`. A 00:30 slot (`05:30Z`) is not before it.
- **`slotClosures` for each state:**
  - `closedDayKeys` of a 3-day range holds exactly those 3 keys;
  - an open-ended storm → `blockAll: true`;
  - a dated storm → `blockedBefore = until`.
- **`coversAppointment`:**
  - each state;
  - the `[set_at, until)` edges (at `set_at` → covered; at `until` → not; one ms before `until` → covered);
  - Running late → `{ covered: false }`;
  - Closed today → `endsAt` = `until` (tonight's midnight, D12), never the reopening;
  - a closed day → `kind: "closed_day"` with `endsAt` = the start of the day after the range's last date (its window, D12);
  - an open-ended storm → `endsAt: null`.
- **`closureListWindow`** (S7, S22):
  - Closed today at 10:00 → `to` = tonight's midnight, `capped: false`;
  - a Storm set Monday 2027-06-07 10:00 CDT with `backOn` Thursday 2027-06-10 → `to` = Thursday's first opening with `H`, `2027-06-10T13:00:00.000Z`, `capped: false`;
  - an open-ended storm → `to` = `now + 14 days` exactly, `capped: true`;
  - a closed day today ending in 20 days → `to` = `now + 14 days`, `capped: true`;
  - open and Running late → null.
- **`statusCode`** for every state and all four delays (8 literals).
- **`effectiveStatus` open with a range starting in 14 days** → `nextClosedDay` set; in 15 days → null.
- **`toWire`/`fromWire`** round-trip each state.

**Mutations** (paste each failing line, revert by `cp` + `cmp`):
- precedence swapped (Closed today above a closed day);
- `now <= until` for in-force;
- the null-hours rule (SD3);
- a fixed `-5` offset in place of `partsInZone`;
- `wallTime` returning null in the gap (now caught by the three midnight-gap zones too);
- `lateBefore` without the `min`;
- `coversAppointment` covering Running late;
- `untilFor` closed_today = the reopening (the pre-D12 rule) → the S1-with-D12 and two-hours-sources cases FAIL;
- `coversAppointment`'s closed-day `endsAt` = the reopening after the range → its case FAILS.

**Verify:**
- `pnpm --filter web exec vitest run src/lib/business-status/status.test.ts src/lib/booking/slots.test.ts`.
- typecheck; eslint.
- `grep -nE "from ['\"](@/|@bis/db)" apps/web/src/lib/business-status/status.ts` → nothing.
- Commit `booking: one pure reader turns the switch, closed days and hours into today's status, its reopening and the times it closes, in the account's zone (S-47d)`, naming the three files.

**Review (MEDIUM, sonnet, own worktree):**
- Re-run the DST cases and the S1 case.
- Read `reopeningFrom` for an off-by-one at a span start equal to `from`.
- Confirm no `Intl` or locale call in this file other than through `partsInZone`.

---

## Task 5 (MEDIUM): The slot engine (bis-booking)

**Dispatch gate:** Task 4 committed (the `slots.ts` half); Task 3 committed (the `availability.ts` half).

**Files:**
- `apps/web/src/lib/booking/slots.ts`:
  - `SlotConfig` gains `closures?: SlotClosures`;
  - `closedOut` is added beside `endsByClose` (`:232`);
  - the call in `computeSlots` (`:303-338`, after the horizon check at `:311`);
  - the call in `bookableRange` (after the horizon check at `:437`).
- `slots.test.ts`, `move-slots.test.ts`.
- `apps/web/src/lib/booking/availability.ts` (+ `availability.test.ts`).
- `…/b/actions.test.ts:102` (bare factory: add `getBusinessStatusRow` and `listClosedDaysFrom`, defaulting to an open account).

**Interfaces:**
```ts
// slots.ts
export function closedOut(start: Date, c: SlotClosures, timezone: string): boolean;
// true when c.blockAll, or the start's zone date key is in c.closedDayKeys, or start < c.blockedBefore, or start < c.lateBefore
// availability.ts
export async function readSlotClosures(db: ReturnType<typeof serviceDb>, accountId: string, timezone: string, now: Date): Promise<SlotClosures>;
```
- `computeSlots` skips a candidate when `config.closures && closedOut(candStart, config.closures, prep.timezone)`. `bookableRange` returns null on the same predicate. Spec §5.3: both, or the picker and the submit disagree.
- `closures` absent → unchanged; every existing slots test must pass with no edit.
- **`readSlotClosures`:**
  - `Promise.all([getBusinessStatusRow(db, accountId), listClosedDaysFrom(db, accountId, addDays(dayKey(now, timezone), -1))])`;
  - then `slotClosures({ row, closedDays, hours: null, timezone, now })`. Hours do not matter for slots: `blockedBefore` is the stored `until`.
  - A throw propagates (spec §5.3, S17).
- The four exported functions (`computeAllSlots` `:27-33`, `bookableSlot` `:55`, `moveSlots` `:68`, `movableSlot` `:78`) each start `readSlotClosures(db, calendar.account_id, timezone, now)` in parallel with `bookedInHorizon` (`:38-45`), await both, and pass `{ ...slotConfigFrom(calendar, timezone), closures }`.

**Tests:**
- **`slots.test.ts`, new `describe("closures (S-47d)")`:**
  - Each closure drops exactly its slots: a closed day drops that day only; Closed today drops the rest of today and nothing after midnight (D12); an open-ended storm drops all; Running late 30 drops only today's slots starting within 30 minutes.
  - **D12's Saturday case:** a calendar open Saturday 09:00–13:00, the account's business hours Monday to Friday, Closed today set Friday at 10:00 → Saturday's 09:00 slot is offered AND `bookableRange` accepts it. Mutation: `blockedBefore` = the reopening (Monday 08:00) → FAILS.
  - For each, `bookableRange` returns null for exactly those starts and the original range for the others.
  - **The invariant case:** for each closure fixture, every slot `computeSlots` offers passes `bookableRange`, and a dropped slot does not.
  - **Mutation (spec §7):** apply the rule in `computeSlots` only. The invariant still passes, but the "bookableRange refuses a dropped start" case FAILS. Paste it.
- **`move-slots.test.ts`:**
  - a move cannot land on a closed day (`computeMoveSlots` offers none there, `movableRange` refuses);
  - a booking ON a closed day can move OUT of it to an open day.
- **`availability.test.ts`:**
  - `readSlotClosures` is called with `calendar.account_id`, and a second account's id is never read (assert the mock's arguments);
  - a throwing `getBusinessStatusRow` rejects each of the four functions, one case each;
  - a closed day reaches `computeAllSlots`'s result.
- **`…/b/actions.test.ts`:** `getSlotsAction` for a closed day returns `{ slots: [] }`, and a failed status read returns `{ error: s.genericError }` (the existing catch at `actions.ts:155-158`).

**Verify:**
- the four files plus `registry.test.ts`, `…/b/move/[token]/actions.test.ts` and `…/b/actions.test.ts` by path → PASS;
- typecheck; eslint.
- Commit `booking: the booking page, its move flow and Sofía's booking tools offer no time the business is closed for, through one predicate the picker and the submit share (S-47d)`.

**Review (MEDIUM, sonnet):**
- Re-run the computeSlots-only mutation.
- Read the four functions for a path that computes slots without closures.
- Confirm `bookedInHorizon` and `readSlotClosures` run in parallel.

---

## Task 6 (MEDIUM): `PRE_S47D_DIGEST` first, then the closure lines, the payload and the prompt (bis-voice)

**Files:**
- Modify: `apps/web/src/lib/voice/system-prompt.test.ts`. Step 1 alone, then the cases.
- Create: `…/knowledge/closure-lines.ts` (+ `closure-lines.test.ts`).
- Modify:
  - `…/knowledge/hours.ts:42-77` (`openNow` with closures);
  - `…/knowledge/prompt-blocks.ts:28-51`;
  - `…/knowledge/payload.ts` (schema 2);
  - their tests;
  - `apps/web/src/lib/voice/session-config.ts:56-73`;
  - `apps/web/src/lib/voice/system-prompt.ts:9-16`, `:45-46`, `:145-150`, `:293-313`.

- [ ] **Step 1: Pin today's prompts BEFORE touching `system-prompt.ts` or `hours.ts`** (spec §5.4.4). Append to `system-prompt.test.ts`, after the S-47c digest block (`:686-693`):

```ts
/** Every S-47c base combination × hours {absent, OPEN_H, CLOSED_H} × price list {absent, LIST}: 5184 × 3 × 2. */
function everyS47dBaseInput(): VoicePromptInput[] {
  const out: VoicePromptInput[] = [];
  for (const i of everyS47cBaseInput())
    for (const businessHours of [undefined, OPEN_H, CLOSED_H] as const)
      for (const priceList of [undefined, LIST] as const)
        out.push({
          ...i,
          ...(businessHours === undefined ? {} : { businessHours }),
          ...(priceList === undefined ? {} : { priceList }),
        });
  return out;
}
/** sha256 over all 31,104 prompts at main 5e9c07a7, BEFORE S-47d touched system-prompt.ts or hours.ts. */
const PRE_S47D_DIGEST = "<computed in Step 1>";

describe("buildSystemPrompt — no closure is byte-identical to before S-47d (spec 5.4.4)", () => {
  it("covers 31104 combinations (guards the digest from an empty loop)", () => {
    expect(everyS47dBaseInput().length).toBe(31104);
  });
  it("with neither new key, every combination is byte-identical to 5e9c07a7", () => {
    expect(digestOf(everyS47dBaseInput().map((i) => buildSystemPrompt(i, now)))).toBe(PRE_S47D_DIGEST);
  }, 60_000);
});
```
- Compute the digest by running the case once with a wrong literal and reading the received value.
- Paste it in place of the placeholder, re-run → green.
- `PRE_S47C_DIGEST` (`:646`) and `PRE_S47B_DIGEST` (`:536`) stay green, untouched.
- Confirm `git diff 5e9c07a7 -- apps/web/src/lib/voice/system-prompt.ts apps/web/src/lib/voice/session-config.ts apps/web/src/lib/voice/knowledge/hours.ts apps/web/src/lib/voice/knowledge/payload.ts apps/web/src/lib/voice/knowledge/prompt-blocks.ts apps/web/src/lib/voice/knowledge/price-sentence.ts apps/web/src/lib/voice/modules` is empty. 0096's PR touched only `facts-warnings.ts` under `knowledge/`, which the prompt does not import. Check with `grep -n "facts-warnings" apps/web/src/lib/voice/system-prompt.ts apps/web/src/lib/voice/knowledge/prompt-blocks.ts` → nothing.
- **Commit this alone:** `test(voice): pin every prompt S-47c can build, before S-47d adds the switch (PRE_S47D_DIGEST)`, naming only `system-prompt.test.ts`.

- [ ] **Step 2: `closure-lines.ts`** (pure; imports `./hours` for `clockTime` and `../../business-status/status` for types and `dayKey`):
```ts
export const CLOSED_DAYS_HEADING = "CLOSED DAYS (the business is closed all day on these dates, and no time on them can be booked):";
export type ClosedDayLine = ClosedDay & { line: string };
export function reopeningPhrase(reopensAt: Date, timeKnown: boolean, timezone: string, now: Date): string; // "tomorrow at 8:00 AM" …
export function todayLine(s: EffectiveStatus, timezone: string, now: Date): string | null;  // null for open
export function closedDayLine(d: ClosedDay): string;                                         // "- Thursday, December 24, 2026 (holiday)"
export function closedDaysBlock(lines: readonly ClosedDayLine[] | null | undefined): string[]; // [] or ["", heading, ...lines]
```
Every literal is in "The model, The prompt lines". Weekday and month names come from fixed English arrays.

- [ ] **Step 3: `openNow(hours, timeZone, now, closures?)`.**
  - The fourth argument is `{ status: EffectiveStatus | null; closedDays: readonly ClosedDay[] }`.
  - **Absent:** today's code path, byte for byte.
  - **Present, with a closure state:**
    - `reopensAt` null → `Right now: closed.`;
    - otherwise `Right now: closed; opens {when} at {t}.`, using S-47c's `when` words for 0–7 days and `on {Weekday}, {Month} {d}` beyond 7.
  - **Present, open or running late:**
    - If the hours say open now → unchanged.
    - If they say closed now → the next opening comes from `reopeningFrom(now, hours, tz, closedDays)`, worded as S-47c words it.
  - `businessHoursBlock(hours, tz, now, closures?)` passes it through (`prompt-blocks.ts:48-51`).

- [ ] **Step 4: `prompt-blocks.ts`.**
  - `afterHoursClosedPhoneLine` gains `see?: "Right now" | "TODAY"` (default `"Right now"`; byte-identical when absent).
  - Add `AFTER_HOURS_CLOSED_WEB_TODAY` and `AFTER_HOURS_CLOSED_WEB_VOICE_TODAY` (the literals in "The model").

- [ ] **Step 5: `payload.ts` schema 2** (spec §4.2).
  - `KNOWLEDGE_RENDERER_VERSION = 2`.
  - `KnowledgePayload` gets `schema: 1 | 2` and `closed_days: ClosedDayLine[]`. The key order puts `closed_days` before `renderer_version`.
  - **`buildKnowledgePayload`** gains `closedDays: readonly ClosedDay[]` and `today: string`:
    - it keeps ranges with `ends_on >= today`;
    - sorts by `starts_on`, then `ends_on`;
    - takes at most 20;
    - sets each `line` to `closedDayLine(range)`;
    - and writes `schema: 2`.
  - **`parseKnowledgePayload`** reads schema 1 (no `closed_days` → `[]`) and schema 2. Each schema-2 element needs strings for `starts_on`/`ends_on`/`line` and a reason in the list or null; anything else → null.
  - **`knowledgeFromLive`** gains `closedDays: readonly ClosedDay[] | null` and `today: string`:
    - `null` → `recordable: false`, `closed_days: []` and a new `closedDaysUnavailable: true` (C20's rule, spec §4.2).
  - **`promptKnowledge`** gains `closedDays: ClosedDayLine[] | null`: null when the list is empty or unavailable.

- [ ] **Step 6: The wiring** (`session-config.ts`, `system-prompt.ts`; spec §5.4, §5.4.2).
  - **`VoicePromptInput`** gains `businessStatus?: EffectiveStatus | null` and `closedDays?: ClosedDayLine[] | null`, each with a doc comment naming spec §5.4.
  - **`closures`** = `businessStatus && businessStatus.state !== "open"` or `closedDays?.length` ? `{ status: businessStatus ?? null, closedDays: closedDays ?? [] }` : `undefined`. Undefined keeps every path byte-identical.
  - **`hoursBlock`** (`:45`) passes `closures`.
  - **`closure`** = `businessStatus?.state` is `closed_today`, `storm` or `closed_day`.
  - **`closedNow`** (`:46`): `onPhone && input.afterHours === "hours_then_message" && (hoursBlock ? !hoursBlock.open : closure)`. Running late never sets it.
  - **After `...(hoursBlock ? hoursBlock.lines : [])` (`:149`):**
    - `...(today ? ["", today] : [])`, with `today = businessStatus ? todayLine(businessStatus, input.timezone, now) : null`;
    - `...closedDaysBlock(input.closedDays)`;
    - then `servicesBlock` as now.
  - **AFTER HOURS (`:293-313`):**
    - Under `message_only`, web and demo with no `hoursBlock`: `closure` → the `_TODAY` constant; otherwise the conditional line as today.
    - Under `hours_then_message`, the condition becomes `(hoursBlock && !hoursBlock.open) || (!hoursBlock && closure)`.
    - On the phone: `afterHoursClosedPhoneLine({ canBook: booking && !openEndedStorm, handoffAvailable, hasTradeRules, see: hoursBlock ? "Right now" : "TODAY" })`, with `openEndedStorm = businessStatus?.state === "storm" && businessStatus.reopensAt === null` (S13).
    - Web and demo: the `"Right now"` constants with `hoursBlock`, the `_TODAY` ones without.
  - `bookingMode`, `toolSchemas`, `tradeModuleBlock` and every trade-module ctx are unchanged.

- [ ] **Step 7: Tests** (all literals from "The model"; guards on whole sentences, never on a heading):
  - **`closure-lines.test.ts`:**
    - every TODAY literal;
    - `reopeningPhrase` at 0, 1, 2, 6 and 7 days, plus a no-time case;
    - the CLOSED DAYS block's one-day, same-year range, cross-year and no-reason lines.
  - **`hours.test.ts`:**
    - `openNow` without closures → the existing cases unchanged (run the file; never edit them);
    - with each closure;
    - the dated form beyond 7 days;
    - an open status whose next opening is a closed day skips it.
  - **`payload.test.ts`:**
    - a schema-2 build and round-trip;
    - a schema-1 stored payload parses with `closed_days: []`;
    - `closedDays: null` → not recordable;
    - `renderer_version: 2`;
    - deterministic order;
    - at most 20;
    - past ranges dropped.
  - **`system-prompt.test.ts`:**
    - **Byte identity:** `PRE_S47D_DIGEST` with the new fields absent, `null`, `[]`, and `businessStatus: { state: "open", nextClosedDay: null }`. That is four runs of 31,104, each 60 s.
    - **Placement:** the TODAY line after the BUSINESS HOURS block's Right now line; after the `Services:` line when there are no hours; before SERVICES AND PRICES.
    - **`closedNow`:**
      - true for each closed state on the phone under "Follow business hours", with and without structured hours;
      - false under "Always take a message" (C19) and for Running late.
    - **With a transfer number:**
      - the four offer sites read "offer to take a message";
      - the closed TOOLS line (`transferToolLineClosed`) is present;
      - `transfer_to_human` is still in `toolSchemas(...)` (`session-config.ts`);
      - the module block is byte-identical to the open one.
    - "(see TODAY above)" appears only without hours.
    - The open-ended storm's phone line has no booking clause.
    - **D10:** the web prompt with a storm still contains the capture_lead AFTER HOURS line, and its tool list is unchanged. The route test (Task 10) asserts the `tools` array.

**Mutations** (paste each, revert):
- an unconditional `""` before the TODAY slot;
- `closures` built for an open status with no closed days;
- `closedNow` true for Running late;
- the `see` parameter ignored;
- `canBook` kept true for an open-ended storm;
- `closed_days` placed after `renderer_version`;
- `parseKnowledgePayload` refusing schema 1.

**Verify** (unchanged files must stay green):
- `session-config.test.ts`, `greeting.test.ts`, `src/lib/voice/modules` (all four; `pin.ts`'s hashes must not move);
- the four route tests;
- `corpus-lib.test.ts`;
- `pnpm --filter web sofia:corpus events --dry-run` (the graph still loads under `tsx`; if it needs a key, report it, never read `.env.local`);
- typecheck; eslint.
- Commit `voice: Sofía is told the business is closed, late or shut by a storm, and its upcoming closed days; with none of that, every prompt is byte-identical (S-47d)`.

**Review (MEDIUM, opus):**
- Recompute `PRE_S47D_DIGEST` from `5e9c07a7` in its own worktree.
- Re-run three mutations.
- Hunt a byte drift on the no-closure path.

---

## Task 7 (MEDIUM): The closure To-do (bis-automations)

**Dispatch gate:** Tasks 2 and 3 committed.

**Files:**
- Create: `…/bstatus/closure-todo.ts` (+ test).
- Modify:
  - `apps/web/src/lib/documents/card-focus.ts:17-30` (+ its test);
  - `[acct]/tasks/work-list.tsx:258-292`, where only the href's consumer changes, if at all (+ `work-list.href.test.ts`);
  - `apps/web/src/app/(dashboard)/dashboard/work/agency-work-list.tsx`, only if it builds its own href. Read it; if it calls `workRowHref`, nothing changes.

**Interfaces:**
```ts
// …/bstatus/closure-todo.ts (server only; imports @bis/db values, but `serviceDb` only as `import type`, so the
// in-account service-reads scan does not list it: its callers pass the client, Task 8)
export function closureTodoDates(from: string, to: string, locale: "en" | "es"): string;   // SD16 literals (Task 2)
export async function fileClosureTodo(db: ReturnType<typeof serviceDb>, input: {
  accountId: string; kind: "status" | "closed_day"; on: string; to?: string; createdBy: string;
}): Promise<{ id: string; created: boolean }>;
```
**`fileClosureTodo`:**
- Reads the account language (`getAccountLanguage`, `packages/db/src/accounts.ts:128-135`; null → English).
- Builds the title: `business.todo.status`, or `business.todo.closedDay` with `{dates}` = `closureTodoDates(on, to ?? on, locale)`, through `t()`.
- Calls `ensureClosureTask(db, accountId, { kind, on, title, createdBy })`.
- It is called only when at least one booked, not-kept appointment is affected. That check is the caller's (Task 8).

**`workRowHref`:** before the `documentFocus` branch:
- `closureFocus.kind === "status"` → `` `${base}/dashboard#business-status` ``;
- `"closed_day"` → `` `${base}/calendar?closedDay=${closureFocus.on}#closed-days` ``.

A contact-less To-do with a closure link is therefore a `Link` (`work-list.tsx:282-292`).

**Tests:**
- **`closureTodoDates`:** the six literals of Task 2's `{dates}` bullet.
- **`fileClosureTodo`:**
  - the English and Spanish titles as literals;
  - `getAccountLanguage` null → English;
  - `ensureClosureTask` is called with the route's own `accountId` (assert the mock's arguments; mutation: a hard-coded id → FAILS);
  - `created: false` passes through.
- **`card-focus.test.ts`:** both hrefs as literals; a closure row with a `contactId` still links to the closure.
- **`work-list.href.test.ts`:** a status To-do renders `data-work-row-link` as an `<a>` with that href.

**Verify:** those files by path; typecheck; eslint. Commit `work: a closure files one To-do that links to the list of customers to contact, in the account's language (S-47d)`.

**Review (MEDIUM, sonnet):** confirm the title language is the account's, not the actor's, and that the dedupe path never throws.

---

## Task 8 (MEDIUM): The server actions and the guard (bis-booking)

**Dispatch gate:** Tasks 2, 3, 4 and 7 committed.

**Files:**
- Create:
  - `…/bstatus/guard.ts` (+ test);
  - `[acct]/business-status-actions.ts` (+ `business-status-actions.test.ts`);
  - `[acct]/calendar/closed-days-actions.ts` (+ test).
- Modify:
  - `[acct]/calendar/actions.ts` (Keep, beside `cancelBookingAction` `:295`) and `[acct]/calendar/actions.test.ts`;
  - `[acct]/in-account-service-reads.test.ts`, whose `ALLOWED` (`:63-193`) gains two entries, each with a one-line comment:
    - `"app/(dashboard)/dashboard/accounts/[accountId]/business-status-actions.ts": "configuration"` (one row per account, guarded by `mayChangeStatus`; serviceDb only to create the row, file the To-do and bump);
    - `"app/(dashboard)/dashboard/accounts/[accountId]/calendar/closed-days-actions.ts": "configuration"` (Owners and the agency, `canManage`; serviceDb only for the To-do and the bump).

**Interfaces:** "The model, The guard", and:
```ts
// [acct]/business-status-actions.ts ("use server")
export type UndoToken = { expectedSetAt: string; before: { state: StoredState; late_minutes: LateMinutes | null; until: string | null }; todoId: string | null };
export type StatusActionResult =
  | { ok: true; effective: WireStatus; undo: UndoToken; todoCount: number }   // todoCount 0 = no To-do filed now
  | { ok: false; error: string };                                            // a catalogue sentence in the caller's locale
export async function setBusinessStatusAction(accountId: string, change: StatusChange, locale: "en" | "es"): Promise<StatusActionResult>;
export async function undoBusinessStatusAction(accountId: string, undo: UndoToken, locale: "en" | "es"): Promise<{ ok: true; effective: WireStatus } | { ok: false; error: string }>;
// [acct]/calendar/closed-days-actions.ts ("use server")
export async function addClosedDayAction(accountId: string, input: { from: string; to: string | null; reason: ClosedDayReason | null }, locale: "en" | "es"):
  Promise<{ ok: true; id: string; appointments: number; todoFiled: boolean } | { ok: false; error: string }>;
export async function removeClosedDayAction(accountId: string, id: string, locale: "en" | "es"):
  Promise<{ ok: true; removed: { from: string; to: string; reason: ClosedDayReason | null } } | { ok: false; error: string }>;
// [acct]/calendar/actions.ts
export async function keepAppointmentAction(accountId: string, bookingId: string, kept: boolean, locale: "en" | "es"): Promise<{ ok: true } | { ok: false; error: string }>;
```

**`setBusinessStatusAction`** (spec §5.2), in this order:
1. **Access and input.**
   - `const access = await requireAccountAccess(accountId)` (`apps/web/src/lib/auth.ts:36-60`).
   - Validate `change`: a known state; `lateMinutes` in {15,30,60,120}; `backOn` either null or matching `/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/` and a real calendar date.
2. **Read, on `db = await dbForRequest()`** (`apps/web/src/lib/db.ts:21`):
   - the zone (`accounts.timezone`, `?? "UTC"`);
   - `readHoursChain`;
   - `listClosedDaysFrom(db, accountId, addDays(today, -1))`;
   - `getBusinessStatusRow`;
   - then `effectiveBefore = effectiveStatus(...)`.
3. **Guard.**
   - `mayChangeStatus({ isAgency: access.isAgency, role: access.role }, effectiveBefore, change)`.
   - Refused → `business.refuse.closeOrReopen` / `business.refuse.role` in `locale`.
4. **Storm date.** `backOn` must lie within `[addDays(today, 1), addDays(today, 92)]`; otherwise `business.storm.dateError`.
5. **The row.** No row → `ensureBusinessStatusRow(serviceDb(), accountId)`.
6. **The update.**
   - `until = untilFor(change, hours, tz, now)`.
   - `updated = updateBusinessStatus(db, accountId, { state, late_minutes, until: until?.toISOString() ?? null })`.
   - `null` → the role sentence (RLS refused it).
   - Any throw → `business.toast.failed` (logged with ids only).
7. **The event.** `emit(db, accountId, "business_status.changed", access.userId, { from: effectiveBefore.state, to: change.state, late_minutes, until }, "user")`. A failure is logged, never shown.
8. **The To-do.** Only when `change.state` is `closed_today` or `storm`:
   - `w = closureListWindow({ row: updated, closedDays, hours, timezone: tz, now })`. It is never null here, because the new state is a closure.
   - `appts = listClosureAppointments(db, accountId, w.from, w.to)`, filtered to rows that `coversAppointment` covers and to `closure_kept_at === null`. This is the card's window (S22), not only today (the orchestrator's widened S7, 2026-10-23).
   - The once-per-day key is still `on: today`, whatever date the appointments are on, so a second change on the same day files none (`tasks_closure_once`, 23505 → "already filed").
   - if `appts.length > 0`: `fileClosureTodo(serviceDb(), { accountId, kind: "status", on: today, createdBy: access.userId })`;
   - `todoId` = its id only when `created`; `todoCount = appts.length`;
   - a failure is logged, never shown.
9. **The bump.** `bumpHeldForAccount(serviceDb(), accountId)`; a failure is logged.
10. **The answer.**
    - `effective` = `effectiveStatus` with `updated`;
    - `undo = { expectedSetAt: updated.set_at, before: <effectiveBefore as a row>, todoId }`.
    - `before` as a row: an expired stored closure or no row → `{ state: "open", late_minutes: null, until: null }`. Otherwise the stored row's three columns.
    - `set_at` is kept verbatim (SD14).

**`undoBusinessStatusAction`:**
- The same access read.
- Validate the token's shape.
- If `before.until` is not null and `<= now`, restore as open (spec §5.2).
- The same guard, with `change` = the `before` state.
- `updateBusinessStatus(db, accountId, before, { expectedSetAt })`. `null` → `business.toast.changedSince`.
- If `todoId`: `deleteOpenClosureTask(serviceDb(), accountId, todoId)`.
- The event (`from` = the current state, `to` = before), then the bump.
- Return `effective`.

**Closed days:**
- **`addClosedDayAction`:**
  - `canManage` (`auth.ts:58-59`), else `closedDays.role`.
  - Validate in the zone: start ≥ today (`closedDays.error.past`); end ≥ start (`endBeforeStart`); length ≤ 92 days (`tooLong`); end ≤ `addDays(today, 365)` (`tooFar`).
  - Overlap with `listClosedDaysFrom(db, accountId, today)` (`overlap`, `{range}` formatted as the card formats it, Task 12).
  - `insertClosedDay(db, …)`; a thrown `code` 23514 or 42501 → `closedDays.saveFailed` / the role sentence.
  - The event `closed_day.added`.
  - Then `listClosureAppointments(db, accountId, startOfDay(from), startOfDay(addDays(to, 1)))`, not kept. When there are any, `fileClosureTodo(serviceDb(), { accountId, kind: "closed_day", on: from, to, createdBy })`.
  - The bump.
- **`removeClosedDayAction`:**
  - `canManage`.
  - `deleteClosedDay(db, …)`; null → `closedDays.saveFailed`.
  - The event `closed_day.removed`.
  - The bump.
  - Return the removed range for the UI's Undo, which calls `addClosedDayAction` with the same values.
  - Undo of a range that started yesterday or today is allowed (the trigger allows yesterday). The action's "past" check compares the START only when it is a fresh add: `input.restore === true` relaxes it to `>= addDays(today, -1)`. Add that optional field to the input type.

**Keep:**
- `keepAppointmentAction` calls `requireAccountAccess`.
- `!seesWholeAccount(access)` (`apps/web/src/lib/auth-role.ts:15`) → `business.refuse.role`.
- Then `proveBooking("keepAppointmentAction", accountId, bookingId)` (`calendar/actions.ts:186-195`).
- `setBookingClosureKept(serviceDb(), accountId, bookingId, kept)`; false → `business.toast.failed`.
- The event `booking.closure_kept` via `emit` on `dbForRequest()`.
- The bump.

**Tests** (each action file; `@/lib/auth`, `@/lib/db` and `@bis/db` mocked):
- **`guard.test.ts`, the table of spec §7.** Every (role × effective × change) cell:
  - roles: agency, owner, staff, technician, `null`;
  - effective: open, running_late, closed_today, dated storm, open-ended storm, closed_day, expired closed_today (reads open);
  - changes: open, closed_today, running_late 30, storm dated, storm open.
  - That is 5 × 7 × 5 = **175** cells, as a literal table whose length is asserted.
  - The expected result per cell is written out, never computed by the guard.
  - `canChangeFor` for 5 × 7 = 35 cells.
- **`business-status-actions.test.ts`:**
  - Staff refused with the exact `closeOrReopen` sentence for Closed today and Storm, from Open and from Running late.
  - Staff refused for Open and Running late while Closed today, a dated Storm, an open-ended Storm or a closed day is in force.
  - A Technician refused with the `role` sentence.
  - Spanish sentences with `locale: "es"`.
  - No update is called on a refusal (assert the mock never ran).
  - `until` = `untilFor`'s for each change (assert the patch sent).
  - The bump is called on every success.
  - The To-do is filed only for Closed today and Storm, and only with ≥1 not-kept, covered appointment in `closureListWindow`'s window.
  - **The widened S7** (orchestrator ruling, 2026-10-23). Now = Monday 2027-06-07 10:00 CDT; a Storm with `backOn: "2027-06-10"`; nobody booked on Monday; one booking on Wednesday 2027-06-09 at 09:00.
    - The first change files exactly ONE To-do: `ensureClosureTask` is called once, with `{ kind: "status", on: "2027-06-07" }`. `todoCount` is 1, and the toast copy is `business.toast.todoOne`.
    - A second change on the same day (Storm to Closed today, then back to Storm) files none. The mock answers `created: false` on the repeat, as the 23505 path does. No second insert happens, `todoId` stays null, and Undo deletes nothing.
    - Mutation: today-only filing (`listClosureAppointments(now, startOfDay(addDays(today, 1)))`) → the Wednesday case FAILS. Paste the line.
    - Also: Closed today with that same Wednesday booking files none. D12 makes Closed today's window the rest of today.
  - The undo token's `before` is open for an expired row.
  - `expectedSetAt` is passed verbatim: a fixture `"2027-06-01T12:00:00.123456+00:00"` arrives unchanged.
  - Undo with a lost compare-and-set → `changedSince`; the To-do delete is called only with the filed id.
  - Every `@bis/db` call carries the route's own `accountId` (the second-account rule).
- **`closed-days-actions.test.ts`:**
  - each validation sentence;
  - Staff refused on add and on remove (D1, unchanged by D8);
  - the To-do with `kind: "closed_day"` and `on: from`;
  - the bump on remove;
  - `restore: true` allows yesterday.
- **`actions.test.ts` (Keep):**
  - a Technician refused;
  - `proveBooking` refusal passes through;
  - `setBookingClosureKept` called with (accountId, bookingId, true/false);
  - the bump.
- **`in-account-service-reads.test.ts`:** passes with the two entries (and FAILS without them, which is the guard's own test).

**Verify:**
- those files, plus `[acct]/never-log-actions.test.ts` and `in-account-service-reads.test.ts`, by path;
- typecheck; eslint.
- Commit `switch: Owners and the agency close, reopen or run late, Staff run late and reopen from it, every change undoable; Owners plan closed days; anyone who may cancel keeps an appointment (S-47d)`.

**Review (MEDIUM, sonnet):**
- Run the guard table against `0097`'s policy text cell by cell for any disagreement other than SD11's closed day.
- Read both actions for a write before the guard.
- Read Undo for a path that restores an expired `until`.

---

## Task 9 (HIGH): The reminder hold (bis-automations, opus)

**Dispatch gate:** Tasks 2, 3 and 4 committed.

**Files:**
- Create: `apps/web/src/lib/automations/closures.ts` (+ `closures.test.ts`).
- Modify:
  - `apps/web/src/lib/automations/context.ts:15-41`: `PassContext` gains `closures: ClosureLoader`, with a doc comment naming spec §5.5.2.
  - `apps/web/src/lib/automations/harness.ts:14-18`: `buildPassContext` adds `closures: closureLoader(input.db, input.now)`.
  - `apps/web/src/lib/automations/hold-or-send.ts`:
    - `:52` (`HoldContext`, SD7);
    - `:68-77` (`HoldSubject` gains `appointmentAt?: Date` and `kept?: boolean`, each with a doc comment; SD20);
    - `REASONS` (`:86-199`) gains five entries that reference `m[...]` as `ledgerRetry` does (`:92`);
    - the check goes inside `holdOrSend` between `const zone = …` (`:298`) and `const opening = …` (`:299`).
  - The seven recipes set `appointmentAt` and `kept: r.closureKeptAt !== null` (the due row's own Keep, Task 3, SD20):
    - `…/passes/reminders.ts:58-63` (`subjectFor`): `appointmentAt: new Date(r.startsAt), kept: r.closureKeptAt !== null`;
    - `sms-reminder.ts:75-80`;
    - `appointment-confirm.ts:74-81`;
    - `followups.ts:52-55` (`DueFollowup.startsAt`, `packages/db/src/booking.ts:104`);
    - `no-show-nudge.ts:87-90`, `review-request.ts:91-94` and `referral-ask.ts:100-103` (the `startsAt` Task 3 added, SD5).
  - `packages/db/src/automation-log.ts:124-130`: `bumpHeldForAccount`'s doc comment, rewritten. "Called by the switch, Keep and closed-day removal (S-47d) so held rows are re-checked on the next tick; holdOrSend re-holds what is still covered."
  - Tests:
    - `hold-or-send.test.ts`, `release-held.test.ts`, `harness.test.ts`, and the seven pass tests;
    - every test file that builds a `PassContext` by hand: 21 files, from `grep -rln "PassContext" apps/web/src --include=*.test.ts`, read 2026-10-23. The typecheck lists the ones that need `closures: NO_CLOSURES`;
    - `apps/web/src/app/api/cron/reminders/route.test.ts:15-202`: add `loadClosureSnapshot: async () => ({ timezone: "UTC", row: null, closedDays: [], hours: { businessHours: null, calendarHours: null } })` to its export list.

**Interfaces:** "The model, The hold". The check inside `holdOrSend`:
```ts
  const zone = hoursZone(s.accountTimezone);
  if (s.appointmentAt) {
    // S-47d (spec 5.5.2): a closure that covers this appointment holds it, before the sending-hours check.
    // The SUBJECT's own account, never another: the loader is per account (fix-round item 6).
    const state: ClosureState = ctx.closures ? await ctx.closures(s.accountId) : { ok: false };
    const v = closureVerdict(state, {
      appointmentAt: s.appointmentAt, kept: s.kept === true, deadline: s.deadline,
    }, ctx.now);
    if (v.kind === "skipped") { await logSkipped(ctx, s, v.reason); return "skipped"; }
    if (v.kind === "held") { await writeHeld(ctx, s, v.until, zone, v.reason); return "held"; }
  }
  const opening = nextOpening(hoursRuleOf(s), ctx.now, zone);
```

**`closureLoader(db, now)`:**
- A `Map<string, Promise<ClosureState>>`. The first call for an account starts `loadClosureSnapshot(db, accountId, { date: dayKey(new Date(now.getTime() - 86_400_000), "UTC") })`.
- It maps the result to `{ ok: true, input: { row, closedDays, hours: hoursChain(snapshot.hours.businessHours, snapshot.hours.calendarHours), timezone: snapshot.timezone ?? "UTC" } }`. Keep is not here: it comes from the subject (SD20).
- **The window `closedDays` covers.** Ranges ending on or after yesterday (UTC) are kept. A follow-up, review request or referral ask for an appointment on an OLDER closed day finds no cover and sends. That is right: under D12 that day's window ended long ago (SD6).
- A rejection logs one line (the account id only) and becomes `{ ok: false }`, memoised for the tick.

**Tests:**
- **`closures.test.ts`:**
  - **`closureVerdict` for each cover kind:**
    - held with the exact reason literal (`"Held: the business is closed today"`, `"Held: closed for a storm"`, `"Held: the business is closed that day"`);
    - `until` = min(cover end, deadline).
  - **The other verdicts:**
    - kept → send;
    - kept, the appointment ENDED three days ago, under a closed-day range that started four days ago and ends tomorrow (a multi-day closure still covering it) → send. Unkept, the same appointment → held. Mutation: read Keep from a loader window of two days → the kept case FAILS (SD20, fix-round item 3);
    - Closed today: an appointment at 23:30 tonight → held until midnight at the latest; an appointment at 09:00 tomorrow → not covered, so it sends (D12);
    - not covered → send;
    - a cover that ended at or before `now` → send (SD6; mutation: drop that branch → FAILS);
    - deadline passed → skipped `"Not sent: the business was closed for this appointment"`;
    - open-ended storm with no deadline → `now + 24 h` exactly;
    - open-ended storm with a deadline → the deadline;
    - `{ ok: false }` → `now + 15 min` with `"Held: couldn't check whether the business is open"`;
    - Running late → send.
  - **`closureLoader`:**
    - two calls for one account → `loadClosureSnapshot` ran ONCE (mutation: no memo → the count FAILS);
    - two accounts → twice;
    - a rejection → `{ ok: false }` for both calls, and only one read.
- **`hold-or-send.test.ts`, new `describe("closures (S-47d)")`:**
  - A subject with `appointmentAt` and a storm loader → `"held"`, and `recordAutomationLog` is written with `status: "held"`, `heldUntil` and the storm reason.
  - The send callback never ran.
  - No loader on the context → held 15 min with the unknown reason (SD7).
  - A subject WITHOUT `appointmentAt` and a storm loader → the loader is never called, and the existing path runs (assert the mock's call count is 0). This is the instant reply, text-back, reactivation, quote follow-up and document request case.
  - The closure check runs before the sending-hours check: inside quiet hours, a covered appointment is held with the CLOSURE reason.
  - **The subject's own account** (fix-round item 6): a loader that returns a storm for account A and open for every other account. A subject of account B with `appointmentAt` → `"sent"`, and the loader was called with B's id exactly. A subject of account A → `"held"`. Mutation: `ctx.closures(<a hard-coded id>)` or another subject's account id → FAILS.
  - **A kept subject:** `kept: true` under A's storm → `"sent"`. Mutation: `kept` ignored → FAILS.
- **Each of the seven pass tests:**
  - one case "a covered appointment is held with the closure reason (S-47d)";
  - one "a kept appointment sends".

  The loader comes from a small helper in the test, never `NO_CLOSURES`.
- **`release-held.test.ts`, the release path:**
  - A held reminder plus a loader that now reads open, plus one release → `"sent"`.
  - "The switch to Open plus one tick sends" is this case with the row's `held_until` set to now (what `bumpHeldForAccount` writes).
  - The same for Keep (the re-read due row now carries `closureKeptAt`) and for a removed closed day (the loader's closed days now `[]`).
- **`harness.test.ts`:** `buildPassContext` returns a `closures` that calls `loadClosureSnapshot` with the context's `db`.

**Mutations** (paste each, revert by `cp` + `cmp`):
1. the check placed after `opening`;
2. `appointmentAt` dropped from `reminders.ts`'s `subjectFor`;
3. the subject's `kept` ignored (and, separately, `kept` dropped from `referral-ask.ts`'s subject → its "a kept appointment sends" case FAILS);
3b. `ctx.closures` called with a fixed account id instead of `s.accountId` → the own-account case FAILS;
4. SD6's "ended" branch dropped;
5. `min` → `max` for `until`;
6. the unknown-state verdict → send;
7. no memo in `closureLoader`.

**Verify:**
- every touched test by path, plus `apps/web/src/lib/automations` and `apps/web/src/lib/consent/scans.test.ts`, `apps/web/src/lib/document-requests/deliver.test.ts` and `apps/web/src/lib/voice/textback.test.ts`;
- `cron-coupling.test.ts`;
- `apps/web/src/app/api/cron/reminders/route.test.ts`;
- both typechecks; eslint.
- Commit `automations: a reminder, confirmation or follow-up for an appointment a closure covers waits until the business reopens or the owner keeps it; a past deadline skips; an unreadable status holds (S-47d)`.

**Review (HIGH):** an opus bis-reviewer in its own detached worktree.
- It re-runs mutations 1, 3, 3b, 4 and 7, plus two of its own:
  - `writeHeld` called with the default reason (the quiet-hours sentence) instead of `v.reason`;
  - `held_until` = the cover's end even when a deadline is earlier.
- **It reads every `holdOrSend` caller** (`grep -rn "holdOrSend(" apps/web/src --include=*.ts | grep -v test`) and confirms that only the seven booking recipes set `appointmentAt`.
- **It reads the seven releasers** (`…/passes/*.ts`, `release*` functions) and confirms each re-enters `holdOrSend` with the same subject (so a release re-checks the closure). SD18 is the accepted exception for the start-time pre-checks.
- **It looks for a starvation path:** a held row whose `held_until` can be in the past when written.

A re-review follows any change.

---

## Task 10 (MEDIUM): The three surfaces and the Voice page saves (bis-voice)

**Dispatch gate:** Tasks 3 and 6 committed.

**Files:**
- `…/incoming/route.ts`:
  - the import at `:85-90`;
  - the reads beside `servicesP` (`:1057-1063`) and the await at `:1072`;
  - `knowledgeFromLive` at `:1073`;
  - the stamp at `:1146-1154`;
  - the prompt at `:1183-1197`.
- `…/incoming/route.test.ts` (bare factory `:94-133`: add the two functions) and `…/incoming/lifecycle.test.ts` (bare factory `:134-187`: the same).
- `…/turn/route.ts`:
  - the lazy destructure at `:189-195` gains `getBusinessStatusRow`, `listClosedDaysFrom` and `getCalendarForAccount`;
  - turn 1 at `:384-399`;
  - turn 2+ at `:458-474`;
  - the prompt at `:493-538`.
- `…/turn/route.test.ts` (`importOriginal` factory `:71-116`: override all three in `dbFns`, `:8-27`).
- `…/websession/route.ts` (the lazy destructure at `:102-105`; the reads at `:180-188`; the prompt at `:199-218`) and `route.test.ts` (`:33-67`).
- `…/knowledge/save.ts` (+ `save.test.ts`, factory `:8`): the payload build gains the closed-days read.

**Rules:**
- **Phone** (spec §5.4.3):
  - Start `statusP = getBusinessStatusRow(db, accountId)` and `closedP = listClosedDaysFrom(db, accountId, dayKey(new Date(now.getTime() - 86_400_000), "UTC"))` next to `servicesP`. Each `.then(ok, (e) => { log(…ids…); return FAILED; })`, with a module-level `const FAILED = Symbol("failed")`.
  - Await them with `servicesP`.
  - `knowledgeFromLive({ profile, timezone, services, closedDays: closed === FAILED ? null : closed, today: dayKey(now, accountRow.timezone) })`.
  - `effective = status === FAILED ? null : effectiveStatus({ row: status, closedDays: closed === FAILED ? [] : closed, hours: hoursChain(profile.business_hours, calendar.open_hours), timezone: accountRow.timezone, now })`.
  - `startCallRow(…, { …, ...(effective ? { businessStatus: statusCode(effective) } : {}) })`.
  - `promptInput.businessStatus = effective` and `promptInput.closedDays = pk.closedDays`.
  - A failed status read leaves the call answered, unstamped, and without the TODAY line (S17).
- **Chat** (S20, SD4):
  - Every turn reads `getBusinessStatusRow(db, profile.account_id)` (fail-open → null status).
  - When `knowledge.business_hours` is null, it also reads `getCalendarForAccount(db, profile.account_id)` in parallel (fail-open → null hours).
  - Turn 1 reads the closed days live (into `knowledgeFromLive`).
  - Turn 2+ uses the stamped snapshot's `closed_days`, or the live read for an unstamped chat (the existing branch at `:463-474`).
  - `effective` is computed with `knowledge.timezone` (S-47c SD13) and the turn's `new Date()`.
  - Nothing is stamped on the conversation.
  - The `tools` array (`:557`) is unchanged in every state (D10).
- **Demo:** live reads of both. The calendar is already read (`:176`). No stamp.
- **Saves:**
  - `saveKnowledgeParts` builds the payload with `closedDays: await listClosedDaysFrom(db, accountId, today)` and `today = dayKey(new Date(), timezone)`.
  - A failed read FAILS the save (the card's "Couldn't save" sentence) rather than recording a payload with no closed days that the next call would contradict.

**Tests:**
- **`route.test.ts` (phone):**
  - the stamp equals `statusCode` of the same `effective` the TODAY line was built from (a storm row → `business_status: "storm"` AND the prompt contains `TODAY: The business is closed because of a storm, until further notice.`);
  - a status read that throws → `startCallRow` has no `businessStatus` and the prompt has no `TODAY:` line, and the call is answered;
  - the closed days reach the payload (`ensureKnowledgeSnapshot`'s payload has `closed_days[0].line` as a literal);
  - every new read gets the route's own `accountId`.
- **`lifecycle.test.ts`:** the existing cases with the two new mocks in the factory; no case loosened.
- **`turn/route.test.ts`:**
  - the status read is called on turn 1 AND on a turn 2+ (call count 2 over two turns);
  - a stamped turn's closed days come from the snapshot, and `listClosedDaysFrom` is NOT called;
  - a storm turn's request still carries `tools: [CAPTURE_LEAD_TOOL]` (D10);
  - the calendar read happens only when the payload has no business hours.
- **`websession/route.test.ts`:** the TODAY line for a Closed today row; no stamp.
- **`save.test.ts`:** the payload has `closed_days`; a failing read → the failed status.

**Mutations:**
- stamp from a second `effectiveStatus` call with `now + 1 h`, so the stamp and the line disagree at a boundary (the equality case must FAIL);
- the chat reading the status on turn 1 only;
- `closedDays` dropped from the phone prompt;
- the save ignoring a failed read.

**Verify:** the five test files, `src/lib/voice/system-prompt.test.ts`, `src/lib/concierge/*.test.ts`, and every source-scanning test, by path; typecheck; eslint. Commit `voice: calls, website chats and the voice demo read today's status and the closed days; each call records the status it started under (S-47d)`.

**Review (MEDIUM, sonnet):**
- Hunt a stamp/prompt split.
- Hunt a second-account read.
- Hunt a path where a status read failure blocks a call.

---

## Task 11 (LOW): The topbar indicator, its menu and the dashboard status card (bis-frontend)

**Dispatch gate:** Task 8 committed.

**Brief.**

**The shell leg** (`[acct]/shell-actions.ts`):
- `ShellSnapshot` (`:29-43`) gains `businessStatus: ShellBusinessStatus | null`. `ShellBusinessStatus = { effective: WireStatus; canChange: CanChange; timezone: string; personaName: string | null; now: string }`.
- A fourth fault-isolated leg, `readBusinessStatus(db, accountId, access)`, in the shape of `readUnreadTotal` (`:147-156`):
  - `serviceDb()`, as the other legs;
  - reads: the zone (`readAccountTimezone`), `getBusinessStatusRow`, `listClosedDaysFrom(…, addDays(today, -1))`, `readHoursChain`, and the persona (`getVoiceProfile`, already imported at `:3`);
  - computes `effective`, and `canChange = canChangeFor({ isAgency, role }, effective)`;
  - a throw → `null` + one log line.
- Added to the `Promise.all` at `:138-142`.
- Fold nothing into `presence`.

**`shell-data.tsx`:** the context gains `setBusinessStatus(s: ShellBusinessStatus)`, a local override that the next snapshot (the `pathname` effect, `:51-67`) replaces. Never a timer, never polling.

**`…/bstatus/labels.ts`** (catalogue through `t()`; English and Spanish):
```ts
export function topbarLabels(e: EffectiveStatus, timezone: string, now: Date, locale: "en" | "es"): { full: string; short: string } | null; // null for open
export function opensPhrase(at: Date, timeKnown: boolean, timezone: string, now: Date, locale: "en" | "es"): string;
export function cardEndLine(e: EffectiveStatus, timezone: string, now: Date, locale: "en" | "es"): string;           // "Opens again tomorrow at 8:00 AM" …
```
- The time, weekday and month tables are in "The model, The topbar forms".
- `labels.test.ts` pins EVERY fixture in that table, in both languages, plus the card's end lines. Typed literals; never built by the function under test.

**`components/business-status-menu.tsx`** (`"use client"`; one component, mounted by the topbar and by the card):
- Props: `{ accountId, status: ShellBusinessStatus, locale, pseudo, onChanged?(s) }`.
- **`canChange === "all"`:**
  - `DropdownMenu` → `DropdownMenuRadioGroup` with the current state checked.
  - Items: Open; Closed today; Running late ▸ `DropdownMenuSub` (four delays); Storm ▸ (Until further notice; Back on a date…, which opens a `Dialog` with one `Input type="date"`, controlled, seeded in `useState` with tomorrow, min tomorrow, max +92, and ONE primary "Close until then").
  - On a closed day, Open is replaced by `business.menu.changeClosedDays`, a `Link` to `` `/dashboard/accounts/${accountId}/calendar#closed-days` `` (S11).
- **`"late_only"`:** exactly two items, Open and Running late ▸ (four delays). Nothing else, not even disabled.
- **`null`:** no button. The caller renders the words only.
- Each choice calls `setBusinessStatusAction(accountId, change, locale)`.
  - **On `ok`:**
    - `onChanged(fromWire(effective))`;
    - `useShellData().setBusinessStatus(...)`;
    - `router.refresh()`;
    - `toast.success(<state toast>{ + " " + business.toast.persona with persona}{ + " " + todo/todoOne when todoCount > 0 }, { duration: UNDO_WINDOW_MS, action: { label: common.undo, onClick: () => undoBusinessStatusAction(...) } })`.
    - The undo's own toast is `business.toast.undone` or the action's error.
  - **On `!ok`:** `toast.error(result.error)`, and the old status stays.
- The trigger is a `Button` ghost with `aria-haspopup="menu"`, the visible focus ring, and an accessible name `business.menu.trigger`. Esc and arrows are Radix's.

**`topbar-presence.tsx`** (S15):
- **Not open**, for everyone: the status replaces the idle count.
  - A dot `<span aria-hidden>` with `--crit`/`--warn`, then the words: full form `hidden sm:flex`, short `sm:hidden`. Both are in the DOM, F-107's pattern (`:86-93`).
  - During a call, the on-call pulse stays and the status follows it at `sm` and up.
- **Open:** unchanged. With no enabled voice profile (`presence` null), show "● Open" (`--good`) only when `canChange` is set, as the menu's trigger. Technicians see nothing, as today.
- With a `canChange`, the indicator IS the menu's trigger.
- `data-testid="topbar-presence"` stays on exactly two elements (`topbar-presence.test.ts:25`).

**The dashboard card** (`[acct]/dashboard/business-status-card.tsx`, `id="business-status"`, rendered between `PageHeader` (`page.tsx:350-353`) and `ZoneNote` (`:364`)):
- A server component wrapped in `RecordCardBoundary` (`components/record/record-card-boundary.tsx:35-46`), with a skeleton shaped like the compact line and an error fallback (`business.card.error` + `business.card.retry` as a reload link).
- **Its reads** (on the page's `dbForRequest()`): zone, row, closed days, hours chain. When not open (S22, the orchestrator's ruling on finding 5):
  - `listClosureAppointments(w.from, w.to)`, with `w = closureListWindow(...)` (Task 4). It is the same function the To-do filer uses (Task 8), so the card and the To-do agree. `windowEnd` is the closure's window end:
    - Closed today → `until`, tonight's midnight (D12);
    - a dated storm → its `until`;
    - a closed day → the start of the day after its last date;
    - an open-ended storm → none, so the 14-day cap applies;
  - each row is kept only when `coversAppointment` covers it (so one open day between two closed ranges is excluded);
  - `countHeldByBooking` for the listed ids.
- **States** (spec §5.6.2):
  - **Open:** one line, "● Open today", plus Change for whoever has a `canChange`, plus the next closed day within 14 days.
  - **Not open:**
    - the dot and word;
    - the end line (`cardEndLine`);
    - the reason on a closed day;
    - Change;
    - `business.card.affectedAppointments`: each covered, booked appointment in that window, kept or not, soonest first. Each row shows:
      - its date and time in the zone;
      - the customer's name linked to `/dashboard/accounts/${accountId}/contacts/${contact_id}`;
      - "{n} messages waiting" when held rows exist;
      - Keep (ghost; `keepAppointmentAction`; toast `business.card.keptToast` with Undo calling it with `false`). A kept row shows `business.card.kept` in place of the button;
      - "Cancel on the calendar" (a link to `` `/dashboard/accounts/${accountId}/calendar#booking-${id}` ``).
    - `business.card.moreLater` with `{date}` = the 14th day and a Calendar link, only when the window runs past `now + 14 days`;
    - `business.card.noneAffected` when the list is empty.
  - **Running late:** state, end, and `lateHidden`/`lateHidden120` only.
- `lang` on the root.
- `page.test.ts` (bare factory `:119-132`) gains the five functions.

**Tests:**
- **`labels.test.ts`:** every fixture.
- **`business-status-menu.test.ts`** (render with `renderToStaticMarkup` and the action mocked):
  - "all" lists the full menu;
  - "late_only" lists exactly two radio items;
  - a closed day replaces Open with the link;
  - null renders no button.
- **`topbar-presence.test.ts`:**
  - the full and short forms per state, English and Spanish;
  - the button only with `canChange`;
  - "● Open" for no profile with `canChange`, nothing without it.
- **`business-status-card.test.ts`:**
  - each state;
  - the error fallback;
  - Keep calls the action with the booking id;
  - every read gets the route's `accountId`;
  - **S22:**
    - a three-day dated storm lists the appointments of all three days, each with Keep, and `listClosureAppointments` is called with the storm's `until` as its end;
    - Closed today lists today's only, ending at midnight (D12);
    - an open-ended storm queries exactly 14 days and shows `moreLater`;
    - a kept appointment shows "Kept".
    - Mutation: the pre-S22 end-of-today window → the storm case FAILS.
- **`shell-actions.test.ts`:**
  - a failing status leg → `businessStatus: null` while the other three legs still answer;
  - `canChange` for an Owner, for Staff during Running late, and for Staff during a closure.

**Verify:** those files, `material.test.ts`, `ratchet.test.ts`, `in-account-service-reads.test.ts` and `toast` tests if any, by path; typecheck; eslint. Commit `ui: the topbar shows today's status to everyone and opens the switch for Owners, the agency and (for running late) Staff; the dashboard lists today's affected appointments with Keep and Cancel (S-47d)`.

---

## Task 12 (LOW): The Closed days card, the booking anchors, the palette (bis-frontend)

**Dispatch gate:** Task 8 committed.

**Brief.**

**`[acct]/calendar/closed-days-card.tsx`** (`id="closed-days"`; spec §5.6.3):
- **Placement:** in the main column after `CalendarSettings` for Owners and the agency (`page.tsx:88-90`); on its own for Staff and Technicians (`canManage` false).
- **Reads** (the page's `db`): `listClosedDaysFrom(db, accountId, today)`, and per range `listClosureAppointments(startOfDay(starts_on), startOfDay(ends_on + 1))` for the counts and lists.
- **Loaded:**
  - Each range reads `"Thursday, December 24 · Holiday"` (one day) or `"Dec 28 – Jan 1 · Vacation"` (a range). The no-reason form drops `" · …"`.
  - Ranges with appointments show "{n} appointments", a toggle that opens that range's list: the same rows as the dashboard card, Keep and Cancel on the calendar.
  - Owners and the agency get a ghost Remove: immediate, toast with Undo calling `addClosedDayAction` with `restore: true`.
- **Add** (Owners and the agency):
  - From (date), To (date, optional), Reason (`Select`: None, Holiday, Vacation, Other).
  - Controlled inputs, seeded in `useState`.
  - The card's one primary, "Add closed days".
  - Validation messages come from the action. The toast says `closedDays.added`, plus `closedDays.addedTodo` when `appointments > 0`, with Undo calling `removeClosedDayAction`.
- **Empty:** `closedDays.empty` (`{persona}` from `getVoiceProfile`'s persona or the default name the topbar uses), with the form for Owners; Staff see the sentence only.
- **Error:** `closedDays.error`, in the card; the rest of the page renders.
- **`?closedDay={date}`:** opens that range's list (initial state from `searchParams`) and scrolls the card into view.
- `lang` on the root.

**Other changes:**
- `bookings-list.tsx:213`: the `<li>` gains `id={\`booking-${b.id}\`}`.
- `apps/web/src/lib/palette/registry.ts:70`: `"/calendar": ["booking", "availability", "hours", "closed days", "holiday", "vacation", "días cerrados", "feriado", "vacaciones"]`. Plus one case in `registry.test.ts` asserting all six new words (mutation: drop one → FAILS). No Calendar keyword pin exists today (read 2026-10-23).
- `calendar/page.test.ts` (`importOriginal` factory `:47`): override the two new reads.

**Tests:**
- the card for an Owner (form present, Remove present) and for Staff (no form, no Remove, the list still opens);
- the empty, error and `?closedDay=` states;
- the range formats as literals;
- `bookings-list.test.ts`: a row carries `id="booking-<id>"`.

**Verify:** those files by path; typecheck; eslint. Commit `ui: the Calendar page lists closed days with their affected appointments; Owners add and remove them with Undo; the palette finds them (S-47d)`.

---

## Task 13 (LOW): The booking page notice (bis-booking)

**Dispatch gate:** Task 8 committed (shares no file with it; waits only for the wave).

**Brief.**
- **`…/b/data.ts`:** a new `loadClosureView(accountId, timezone, now)` on `serviceDb()`. It reads the row, the closed days and the hours chain, and returns `{ notice: string | null; closedDayKeys: string[] }`:
  - Closed today or a closed day today → `closedTodayNotice`;
  - Storm with no date → `stormNotice`;
  - Storm with a date → `stormUntilNotice` with `{date}` (the format in "The model");
  - Running late → no notice;
  - `closedDayKeys` = every key of every range within the page's `maxAdvanceDays`.
  - A failed read → `{ notice: null, closedDayKeys: [] }` + a log line. The slots already fail separately and closed.
- **`(book)/page.tsx`** calls it after the timezone read (`:102`) and passes `closureNotice` and `closedDayKeys` to `BookingPage`.
- **`booking-page.tsx`:** the props (`:16-33`) gain both. It renders the notice above the picker inside the branded card, as a `<p role="status" className="bis-booking-notice">`. Add that class beside the existing booking classes, tokens only. It passes `closedDayKeys` to `SlotPicker`.
- **`slot-picker.tsx`:** the props (`:132-148`) gain `closedDayKeys?: readonly string[]`. The empty state (`:291-295`) shows `strings.closedDay` instead of `strings.noSlots` when the selected day's key is in it.
- `move-form.tsx` is unchanged: a move picker shows "No times available" on a closed day. That is the booking page's string only (spec §5.3).
- `(book)/page.test.ts` (bare factory `:18`) gains `getBusinessStatusRow`, `listClosedDaysFrom` and `readHoursChain`.

**Tests:**
- the three notices in English and Spanish as literals (`?locale=es`);
- no notice for Running late;
- "Closed this day." / "Cerrado este día." for a closed day key;
- a failed read renders the page with no notice.

**Verify:** by path; typecheck; eslint. Commit `booking: the booking page says when the business is closed, and a closed day says so in the picker, in English and Spanish (S-47d)`.

---

## Task 14 (LOW): The call-page line, the knowledge page section, the baselines (bis-frontend)

**Dispatch gate:** Tasks 11–13 committed (this task regenerates the baselines once, last).

**Brief.**
- **The call page** (`[acct]/calls/[callId]/page.tsx`, the `<dl>` at `:262-319` at `d280b847`; re-read after the rebase, since 0096's PR touched this file):
  - One `<div>` with `<dt>` `calls.detail.businessStatus` and `<dd data-business-status="">` = `calls.detail.businessStatus.<code>`.
  - Shown when `call.business_status !== null`, to EVERYONE who can see the call (S19). Not gated on `isAgency`.
  - Place it before the agency-only trade-rules item. Same markup classes as the language item (`:280-285`).
- **The knowledge page** (`[acct]/voice/knowledge/[version]/page.tsx`, after the prices section at `:214-234`; re-read after the rebase):
  - A "Closed days" section listing `payload.closed_days`' `line`s, each `<li lang="en">` (model input; Global constraints).
  - A schema-1 snapshot → `voice.knowledge.noClosedDaysRecorded`.
  - A schema-2 snapshot with `[]` → `voice.knowledge.noClosedDays`.
- **Baselines:** `pnpm --filter web exec tsx scripts/generate-i18n-baseline.ts`. Read the diff line by line: it may only REMOVE entries, or leave both files unchanged. An added entry is a finding: fix the copy, never the baseline.

**Tests:**
- **The call page:**
  - a client + stamped `storm` → the `<dt>` text `Status at the start` and `Closed for a storm`;
  - unstamped → no `data-business-status`;
  - Spanish.
  - Mutation: gate it on `isAgency` → the client case FAILS.
- **The knowledge page:** schema 1, schema 2 with lines (each `lang="en"`), and schema 2 empty.

**Verify:** those, `ratchet.test.ts` and `request-locale-callers.test.ts` by path; typecheck; eslint. Commit `ui: the call page says what status a call started under, and what Sofía knew lists the closed days (S-47d)`.

---

## Task 15 (LOW): The e2e spec (bis-e2e-qa)

**Brief.** Create `apps/web/e2e/one-switch.spec.ts` (spec §7 e2e).
- **Account:** the fixture account only (`e2e/.auth/client-fixture.json`, read as `apps/web/e2e/structured-facts.spec.ts:67-74` does; skip with a reason when absent). Never `Test Client One`.
- **Session:** `test.use({ storageState: "e2e/.auth/client-state.json" })`, the fixture Owner (A8; `activity.spec.ts:56`).
- `test.describe.configure({ mode: "serial", timeout: 60_000 })`.
- Check for an in-progress `screenshots.yml` run before any LOCAL run (CLAUDE.md).

**`beforeAll`** (service client): `ensureBusinessStatusRow`. If the effective status is not open, STOP the file with a reason. Never write the row directly: `service_role` has no UPDATE on it.

**Tests:**
1. **Closed today from the topbar, and Undo.**
   - Go to `/dashboard/accounts/<id>/dashboard`.
   - Click the topbar trigger (`getByRole("button", { name: m["business.menu.trigger"] })`), then "Closed today".
   - The topbar shows "Closed today" and `#business-status` shows "Closed today".
   - Click the toast's "Undo" within 10 s.
   - Both read open again ("Open today" in the card).
   - Poll `getBusinessStatusRow` → `effectiveStatus` open.
2. **A closed day next week on the Calendar page, then the booking page.**
   - Inside `#closed-days`: From = a weekday 7–13 days ahead on which the fixture calendar has hours. Read the fixture's `open_hours` and pick the first matching day; record it.
   - Reason Holiday; "Add closed days"; the toast; poll `listClosedDaysFrom` → one row.
   - Open `/b/<publicId>`, select that day: the picker reads exactly "Closed this day.".
   - Back on the Calendar page, Remove; poll → none.

**`afterAll`** (always runs):
- If the status is not open, restore through the UI: open the menu and click Open. Then poll until it reads open.
- Remove any closed day this file added, through the UI's Remove. If the UI is unusable, delete it through `deleteClosedDay(serviceDb(), …)`; `service_role` holds DELETE on `closed_days`.
- Collect problems and throw at the end (`ai-disclosure.spec.ts:146-202` shape). Specs run one after another (`workers: 1`, A7), so leaving the fixture closed would break the booking specs that follow.

**Verify:**
- `pnpm --filter web exec playwright test --list e2e/one-switch.spec.ts` lists 2 tests (source `.env.local` into the shell only);
- typecheck; eslint.
- Commit `e2e: an Owner closes for the day from the topbar and undoes it, and a planned closed day shows on the booking page (S-47d)`.

---

## Task 16: Final review, design review, one fix agent (checkpoint)

- [ ] **bis-reviewer, opus, fresh context**, on `git diff <rebased spec commit>...HEAD`, in its own detached worktree, with replica 55479/55480/55481.
  - Read spec §§2 and 4–9 (D1–D12, S1–S22) and this plan (SD1–SD20).
  - Run every touched test file by path and both typechecks. On `post`, run: `one-switch-schema`, `business-status`, `definer-search-path`, `schema-grants-guard`, `proposals-drop`, `voice`, `work-queue`, `voice-schema`, `server-only-writes-grants`.
  - Re-check 0097's md5 against Task 1's.
  - Three probes of its own:
    - a byte-identity probe (a stray space on the no-closure path);
    - a stamp/prompt split (the incoming route computing `effective` twice);
    - a picker/submit split (`closedOut` in `computeSlots` only).
  - **Hunt:**
    - a Staff path that closes or reopens from a closure (UI, action or policy);
    - a slot offered during a closure;
    - a reminder sent for a covered, not-kept appointment;
    - a closure window that runs past midnight for Closed today (D12), or a reopening said that is the window end instead of the hours chain's next opening;
    - Keep read from anywhere but the subject's own due row (SD20), or a loader asked for another account than the subject's;
    - a Staff `until` more than 26 hours out that any path can store;
    - a held row with a past `held_until`;
    - a loader read per subject instead of per account;
    - a To-do filed twice, or filed with no affected appointment;
    - an Undo that restores an expired `until` or loses to a microsecond round trip;
    - a prompt that both forbids and permits a transfer;
    - a storm that removes `capture_lead` (D10);
    - a Spanish string with a wrong accent;
    - a typed "Sofía";
    - a card with two primaries;
    - a vacuous test (a guard a comment satisfies; a loop that never ran; an assertion built by the function under test).
- [ ] **bis-design-reviewer, opus**, on Tasks 11–14's diff, with a running build if the orchestrator provides one (a source audit otherwise):
  - tokens only; both themes via `.dark`; the blur fallback (the menu and dialog are overlays: `--glass-filter`; the cards never blur);
  - rule 3 (every status is dot + word);
  - rule 5 (the card's and the Closed days card's loaded/empty/error/loading states);
  - rule 6 (every change with Undo, no confirm dialog);
  - rule 8 (one primary per card; the Storm dialog's one primary);
  - the topbar at 360 px in the pseudo-locale (the longest form: "Con alrededor de una hora de retraso");
  - keyboard: the trigger's focus ring, the menu's arrows and Esc, the Dialog's Esc;
  - the 7 AM read of every new string in both languages, with Q1's drafts named for the owner.
- [ ] **ONE fix agent** takes both reports' Critical, Important and agreed Minor items.
  - A sonnet fix-review runs only if the fix touched HIGH-tier code (0097, its tests, or the hold). Otherwise the orchestrator reads the fix diff and re-runs the touched tests by path.
  - **0097 goes to bis-ci and production only with its reviewed md5 UNCHANGED.** Once 0097 is on bis-ci it is never edited: a SQL change found after that is a new migration (0098), reviewed HIGH.
  - Any change to a closed-day line after Task 6 keeps `KNOWLEDGE_RENDERER_VERSION` at 2 unless a schema-2 snapshot has already been recorded somewhere real; then it is 3, and the commit says so.

---

## Task 17: Rollout (orchestrator; spec §8)

Each step reads its own evidence. Nothing is inferred from an earlier run.

- [ ] **1. bis-ci 0097** (after Task 1's review approves; 0096 is already there, Task 0).
  - Before pushing, confirm in the file:
    - `grep -c "set search_path = pg_catalog, pg_temp" packages/db/supabase/migrations/0097_one_switch.sql` → `5` (three functions + two header comment lines, `0097:63` and `:80` in the plan writer's fix-round file);
    - `grep -c "''" …` → `0`;
    - `keep_task_links` matches 0084's body plus the four lines (spec §8 step 1).
  - `gh workflow run ci-project-setup.yml --ref feat/s47d-switch -f step=push-dry-run`. Its log lists exactly `0097_one_switch.sql`. Then `-f step=push`.
  - Read-only post-checks on bis-ci (MCP `execute_sql`, `odnobiodsftffphuuosz`):
    - the four added columns' types;
    - every constraint def from Task 1's pinned map (its query; 13 rows), equal;
    - the five policies, equal to Task 1's pin;
    - the three functions' `proconfig`;
    - the client-write digest → **`52|b66203ca5d355155540b520af510d120`** (spec §4.1: "the plan confirms it by reading it off bis-ci");
    - `select count(*) from public.business_status` → `0`.
  - If a Preview read then fails naming `business_status`, PostgREST's schema cache is stale: `notify pgrst, 'reload schema'` once on bis-ci, then re-read.
  - Ledger: `0097 APPLIED to bis-ci … NEVER RE-APPLY`.
- [ ] **2. Push and CI.**
  - Read `verify` and `e2e` ON THE HEAD SHA (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`).
  - `one-switch.spec.ts` must have RUN (not skipped): read its lines in `gh run view --log`.
  - Read every red check before calling it expected (memory "CI vs local divergence").
- [ ] **3. Preview by hand** (bis-ci, a test account, never Test Client One):
  - the topbar in each state, in both themes, English and `?locale=es`, at 360 px and at desktop width;
  - Staff's two-item menu and no button during a closure (a Staff test user, memory "Smoke identities");
  - the card's lists;
  - a closed day on the Calendar page and on the booking page;
  - Undo in each place.
- [ ] **4. Production 0097**, BEFORE the merge and after 0096 is on production:
  - MCP `apply_migration`, project `tlbkbmlrfafquucsmsmm`, name `one_switch`, the exact reviewed text, ONCE.
  - Pre-flight: the newest migration name is `definer_search_path`.
  - Post:
    - the same reads as step 1, the digest included;
    - `select md5(array_to_string(statements, '')) from supabase_migrations.schema_migrations where name = 'one_switch'` equals the file's md5. The file has no backslash and no `''`, so memory "MCP SQL escapes" cannot bite.
  - Ledger: `0097 APPLIED to production … NEVER RE-APPLY`.
- [ ] **5. Parity.** Runbook §5 (`docs/runbooks/ci-supabase-project.md`): `-f step=fingerprint` on bis-ci and `packages/db/supabase/parity/fingerprint.sql` on production; equal on every 0097 object (columns, constraints, policies, the two triggers, the three functions, grants). Also read, read-only, on both:
  - `select p.oid::regprocedure, pg_get_userbyid(p.proowner), p.prosecdef, p.proconfig from pg_proc p where p.oid in ('app.business_status_stamp()'::regprocedure, 'app.closed_days_stamp()'::regprocedure, 'app.keep_task_links()'::regprocedure) order by 1::text;` → owner `postgres`, `prosecdef` false, `{"search_path=pg_catalog, pg_temp"}` for all three.
- [ ] **6. PR and merge.**
  - `gh pr create`. The body names:
    - D1–D12 (owner), S22 (orchestrator) and SD1–SD20 with their resolutions;
    - Q1's drafts;
    - both apply lines;
    - the tiers;
    - "LOAD-BEARING: business_status and closed_days (every slot computation: the booking page, its move flow, Sofía's three booking tools; every in-account navigation through the shell; every call start, chat turn and voice demo; the dashboard; the Calendar page; every cron tick; every Voice page knowledge save), calls.business_status (every call start, every call page), tasks.closure_kind/closure_on (every To do page, the dashboard, the agency's own To do page), bookings.closure_kept_at (the dashboard card, the Closed days card, Keep, every cron tick)";
    - "No env var changes; nothing added to Preview";
    - "Merging changes no prompt by itself except that every account's next call or chat records one automatic snapshot (schema 2); an account's prompt changes only when its switch is not Open or it has closed days (spec §8 step 4)".
  - Only after step 4: `gh pr merge <n> --auto --squash --match-head-commit <sha>`, with the head SHA's `verify` and `e2e` green.
- [ ] **7. After the deploy** (READY on the merge SHA, aliased to `app.bis-rgv.com`):
  - **Smokes:** `/` 200, `/sign-in` 200, `/api/cron/reminders` 401, `/b/bogus` 404.
  - **On a fixture account** (spec §8 step 3):
    - set Closed today and check the topbar, the card, the booking page, and the browser voice demo's answer (it says closed);
    - Undo;
    - add a closed day and see it on the booking page;
    - remove it.
  - **Read-only:**
    - `select count(*) from public.business_status` grows only with real use;
    - `select business_status, count(*) from public.calls where started_at > <deploy time> group by 1` shows `open` on new calls;
    - the held count vs Task 0's baseline;
    - `select count(*) from public.voice_knowledge_snapshots where created_by = 'system' and created_at > <deploy time>` grows with real calls (one per account, the accepted C15 consequence).
- [ ] **8. Tracker and ledger** (memory "Roadmap tracker"): F-084 → done; the S-47 subproject row: part d done; bump `meta/plan` asOf and mainSha, with `if_version`. Ledger `s47d MERGED`.

---

## Notes for the owner (no decision reopened)

- **Every account records one automatic knowledge snapshot on its next call or chat after the deploy** (schema 2, renderer 2; spec §4.2, C15). Nothing in any prompt changes until a switch is flipped or a closed day is added.
- **A Staff member's Running late on a closed day is refused by the app only** (SD11). The policy cannot see closed days. Nothing customers see would change anyway: the closed day outranks it.
- **The Activity page shows hold reasons in English** for every account, as it does for every reason today (SD8). The new reasons have Spanish twins ready for when that page translates stored reasons.
- **A reminder held until the appointment starts is skipped as "Appointment already started"**, not with the closed-day sentence (SD18). It is still not sent.
- **D12 as built:** Closed today refuses bookings and holds reminders only until midnight tonight; Sofía, the topbar and the card still say when the business next opens, from the hours. After midnight the switch reads Open by itself.
- **S22 as built:** the dashboard card lists every appointment a closure covers, up to 14 days ahead, each with Keep; a longer closure points to the calendar for the rest.
- **Q1:** eight topbar forms the spec did not draft are pinned as the plan's drafts. Change any by answering Q1. The fix round applies it.

## Spec coverage

| Spec | Where |
|---|---|
| §1 Why (booking page, Sofía, reminders) | Tasks 5, 6, 10, 9 |
| §2 D1 who flips it | Task 1 (policies), Task 8 (guard, actions), Task 11 (menu by `canChange`) |
| §2 D2 appointments kept; one To-do; per-booking cancel | Task 7, Task 8 (filing), Task 11 (card list, Cancel on the calendar), Task 12 (anchors) |
| §2 D3 each state reverts on its own; expiry on read | Task 4 (`untilFor`, `rowInForce`), Task 1 (`until` CHECK) |
| §2 D4 Running late: the line, hidden slots, no texts | Task 6 (TODAY lines), Task 5 (`lateBefore`), Task 9 (Running late covers nothing) |
| §2 D5 closed days | Task 1, Task 3, Task 8, Task 12, Task 5, Task 6 (CLOSED DAYS, Right now), Task 13 |
| §2 D6 reminders held | Task 9 |
| §2 D7 existing surfaces; dot + word; Undo; English and Spanish | Tasks 2, 11, 12, 13, 14 |
| §2 D8 Staff may run late and reopen from it | Task 1 (Staff branch, SD1), Task 8 (guard, SD11, SD12), Task 11 (two-item menu) |
| §2 D9 Spanish topbar drafts as fixtures | "The model, The topbar forms"; Task 11 `labels.test.ts`; Q1 |
| §2 D10 storm keeps capture_lead | Task 6 (prompt case), Task 10 (tools array case) |
| §2 D11 over an hour = 120 | Task 1 (CHECK), Task 4 (`lateBefore`), Task 6 (the 120 line) |
| §2 D12 Closed today's window ends at midnight; the reopening is still said | Task 4 (`untilFor`, the S1-with-D12 and two-hours-sources cases, the midnight-DST table), Task 5 (the Saturday slot case), Task 9 (the 23:30 / 09:00 cases), Task 1 (the `until` column comment) |
| S1 Closed today says it reopens on a later day | Task 4 (S1-with-D12 case) |
| S2 120 minutes | Task 1, Task 6 |
| S3 back-on date window | Task 8 (validation), Task 11 (dialog min/max) |
| S4 closed-day range rules | Task 1 (CHECK, trigger), Task 8 (exact window in the zone) |
| S5 write path (server creates; client updates three columns; triggers stamp) | Task 1, Task 3 (`ensureBusinessStatusRow`), Task 8 |
| S6 `calls.business_status` codes | Task 1, Task 3, Task 4 (`statusCode`), Task 10 |
| S7 (widened 2026-10-23: files for any covered appointment in the card's 14-day window, "Contact customers affected by the closure") | Task 8 (the Wednesday-storm case, the once-per-day case and the today-only mutation), Task 4 (`closureListWindow`), Task 2 (the title and toasts) |
| S7 (as first written) the To-do links to its list | Task 7 |
| S8 a closed day files a To-do | Task 8 (`addClosedDayAction`), Task 7 |
| S9 Keep | Task 3, Task 8 (SD9, SD10), Tasks 11–12 |
| S10 the hold, the bump, fail held | Task 9 (SD6, SD7) |
| S11 precedence; Change closed days on a closed day | Task 4, Task 11 |
| S12 Right now counts closures; dated beyond 7 days | Task 6 (SD15) |
| S13 open-ended storm drops the booking clause | Task 6 |
| S14 CLOSED DAYS block, at most 20 | Task 6 |
| S15 the topbar (indicator, trigger, local value, no polling) | Task 11 |
| S16 the card while open | Task 11 |
| S17 failure modes | Task 5 (throws), Task 10 (fail open), Task 11 (fallbacks), Task 13 |
| S18 booking page notices | Task 13, Task 2 |
| S19 call-page line for everyone | Task 14 |
| S20 chat reads status every turn | Task 10 (SD4) |
| S21 events | Task 8 (four events through `emit` → `record_event`) |
| S22 the dashboard card lists every covered appointment, up to 14 days | Task 11 (the card's window and its S22 cases), Task 2 (`affectedAppointments`, `moreLater`) |
| §4 data, comments, rollback, search paths | Task 1 (Plan-writer check) |
| §4.1 grants, policies, digest | Task 1 (SD1, SD2), Task 17 step 1 |
| §4.2 payload schema 2 | Task 6, Task 10 (saves) |
| §4.3 load-bearing | SD17; Task 17 steps 4, 6 |
| §5.1 reader | Task 4 (SD3, SD13) |
| §5.2 actions | Task 8 (SD12, SD14) |
| §5.3 slot engine, booking page notice | Task 5, Task 13 |
| §5.4 prompt, sentences, closed now, surfaces, byte identity | Task 6, Task 10 |
| §5.5.1 To-do | Task 7, Task 8 |
| §5.5.2 hold | Task 9 |
| §5.6 UI (topbar, card, Closed days card, call page, knowledge page, palette) | Tasks 11, 12, 14 |
| §6 copy | Task 2; model input pinned in Task 6 |
| §7 tests | Tasks 1, 3–15 |
| §8 rollout | Task 0 (0096 gate), Task 17 |
| §9 tiers | Tiers table |
| §10 no open questions | Q1 is a gap in §6's drafts, non-blocking, with a recommendation |
