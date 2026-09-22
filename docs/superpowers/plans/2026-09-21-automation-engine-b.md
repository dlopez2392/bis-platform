# Automation Engine Part B Implementation Plan — four more recipes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four new recipes on part C's floor — `appointment_confirm` (a text two days out that takes a YES or NO reply), `referral_ask` (the completed-job ladder's third rung), `reactivation` (a once-ever email to a past customer gone quiet) and `quote_followup` (a pipeline-driven check-in) — each a card with a toggle, each through `holdOrSend`, each writing `automation_log` from its first commit.

**Architecture:** Nothing new in the engine. Each recipe is a harness entry: one due-list in `packages/db/src/automations.ts` plus its by-id twin, one pure gate module, one pure copy module, one pass file exporting `processX(ctx, rows, opts)` and `releaseX`, one line in `registry.ts`, one entry each in `RELEASERS` and `SOURCE_TITLES`, one card on the Automations page. The only genuinely new seam is the inbound SMS webhook, which learns to recognise a one-word YES or NO and write it onto the booking — a recorder, never a sender.

**Tech Stack:** Next.js App Router (server components + server actions), `@bis/db` (supabase-js over PostgREST, `serviceDb()`/`userDb()`), Postgres migrations under `packages/db/supabase/migrations`, vitest (unit + live db suite), Playwright (`apps/web/e2e`), Geist/tokens per DESIGN.md.

**Spec:** `docs/superpowers/specs/2026-09-21-automation-engine-b-design.md` (HEAD 782c28b). Read it first; its "Verified facts" section is checked against the tree with file:line and must not be re-derived. It obeys `docs/superpowers/specs/2026-09-21-automation-engine-c-design.md` (as amended 1–11), whose amendment list is authoritative over its body.

### Amendments this plan makes to the spec, and why the tree forced them

- **B1. `AUTOMATION_LOG_SOURCES` grows ONE source per recipe task, not all four alongside the migration.** The spec's migration section says the constant grows "in lockstep" with the CHECK. It cannot usefully: the instant a source is added, `RELEASERS` (`passes/release-held.ts:67`) and `SOURCE_TITLES` (`log-titles.ts:7`) stop compiling, and that red is the registry's bookkeeping. Adding all four at once produces four simultaneous errors an implementer can silence with three `null`s and one real releaser — the exact half-registration the type is there to prevent. Adding one at a time makes the red arrive in the same commit as the releaser and the title that answer it, four times. The SQL CHECK still grows to thirteen in one migration (spec decision 1): a TS constant NARROWER than the database's CHECK is safe in the only direction that matters — nothing can write a source Postgres would reject.
- **B2. `RecipeKey` grows the same way**, one key per recipe's data-layer task, for the same reason and to keep Task 1's diff to one `.sql` file and one test file a reviewer can reject on its own.
- **B3. A vanished `stageId` cannot be logged on a normal tick.** The spec says it "skips with a new reason". It cannot: the due-list filters on `stage_id`, so a vanished stage produces no row, and an `automation_log` write needs a subject with a channel (`review-request.ts:83-86` makes the identical argument for an invalid config — console only, no row). So `REASONS.stageGone` is written by `releaseQuoteFollowup` (a held row whose stage vanished during the hold — a real, reachable case) and the operator-facing warning lives on the card, which can see the account's stages.
- **B4. The `appointment_confirm` reassurance lives in the LEAD, not the operator's body.** Decision 6 buys certainty with the ask's own words; if "either way we'll see it" sat in an editable body, the copy test asserting it would assert a default the operator can delete. So the recipe follows `smsReminderLead` (`sms-reminder-copy.ts:10-15`, composed by `composeSmsReminder` at `:27-29`): a fixed lead the operator cannot rearrange, plus an optional closing line.
- **B5. `listDueReactivations` pushes every predicate it CAN into the candidate query, and walks pages for the one it cannot.** The contact predicates — unstamped, has an email — ride a `contacts!inner(...)` embed (`booking.ts:638`, `:663` is the precedent). Two things stay client-side and neither is negotiable: `months` is PER-ACCOUNT config, so one query cannot carry four different cutoffs (the widest goes to Postgres, each row is narrowed to its own), and "has a completed booking" has no path from `conversations` to `bookings`. Because that second one is a permanent disqualifier for a LEAD, a single 200-row page would let an account's oldest lead conversations park the window for ever — so the read walks up to `REACTIVATION_CANDIDATE_PAGES` pages until `REACTIVATION_SURVIVOR_TARGET` rows survive. The quiet period is then re-checked EXACTLY, per row, in the pass.
- **B6. Two hunks land in `bis-booking`'s files** — `BookingRow.confirm_reply`/`confirm_reply_at` in `packages/db/src/booking.ts` (`BookingRow` (anchor on the symbol, not a line), `BOOKING_COLS` (anchor on the symbol, not a line)) and one badge in `calendar/bookings-list.tsx`. Task 4 names them exactly; the dispatching brief must say so and `bis-booking` reviews that task.
- **B7. THREE new email template files, not one.** The spec names `reactivation`'s channel as email; `referral_ask` and `quote_followup` are configured-channel and therefore need one each too. So `apps/web/src/lib/email/templates/{referral-ask,reactivation,quote-followup}.ts` are created. `bis-comms` owns the shell and the rules; this plan writes only content and each file reuses `shell()` + `escapeHtml()` exactly as `bookingFollowupEmail` does (`followup.ts:44-47`) — no new shell primitive, no button in any of the three, because in all three the action is "reply to this email" and a button would need somewhere to point.
- **B8. The `INTERNAL_MILESTONE` guard already covers every new message key.** The spec asks each `*-copy.ts` for its own guard test. `apps/web/src/lib/messages.test.ts:44-51` already walks EVERY key in the catalogue and fails any that matches `/\bM\d[a-z]?\b/`, with a named `AGENCY_ONLY` allowlist that a second test keeps from rotting. That is strictly stronger than a per-module assertion, and every key this plan adds is covered by it the moment it is added. The per-copy tests in Tasks 3, 6, 8 and 10 keep their own assertion anyway — they check the COMPOSED string, not just the catalogue entry — but **no implementer adds anything to `AGENCY_ONLY`**: every string in part B is customer-facing.
- **B9. `listDueQuoteFollowups` is bounded by its own candidate limit, not by the tick cap.** The spec (line 42) says "Candidates are bounded by the tick cap". They are not: `AUTOMATION_TICK_CAP` is applied inside `processQuoteFollowups`, after the read. This recipe's trigger is a RESTING state with a thirty-day window, so an account whose nominated stage holds hundreds of open deals would put hundreds of uuids into the quiet test's `.in(…)` and fail the whole tick for every account. So `QUOTE_FOLLOWUP_CANDIDATE_LIMIT = 200` (oldest stage change first) bounds the due-list, mirroring `REACTIVATION_CANDIDATE_LIMIT`, and the thirty-day ceiling — not the ordering — is what drains the head of that queue.
- **B10. `0047` ships NINE indexes, not the five the spec’s shape implied, and one the first draft named is dropped.** Three are the cap counts, one per CAPPED recipe — and `appointment_confirm` is not one of them, so `bookings_confirm_asked` is gone: it would index a column nothing ever counts (the recipe is uncapped by decision 2, and this plan deliberately declares no `countAppointmentConfirmsSince`), while `countQuoteFollowupsSince` would have had a sequential scan on `opportunities` every tick. Three more were added because two new due-lists would otherwise scan `bookings` whole on every tick: `listDueReferralAsks` needs its OWN two anchor indexes, because a partial index is chosen only when its predicate is IMPLIED by the query's and `referral_asked_at is null` does not imply `review_requested_at is null` (so the review request's pair, `0025:44` and `0026:49-50`, cannot serve it); and `listDueReactivations`' anti-blast read filters `bookings` on `contact_id`, which **had no index of any kind** — the live catalogue's only bookings indexes are `bookings_pkey`, `bookings_cancel_token_key`, `bookings_no_overlap`, `bookings_by_calendar`, `bookings_reminder_due`, `bookings_review_due`, `bookings_review_due_completed`, `bookings_no_show_due`, `bookings_no_show_due_marked` and `bookings_sms_reminder_due`. Names follow the house form (a bare table prefix, `opps_` for `opportunities` as `opps_account_pipeline` and `opps_contact` already do); **zero of the 113 indexes in `public` use an `idx_` prefix** and none of the nine may. The NINTH was added by the pre-apply review: `applyConfirmationReply` (Task 4) looks a booking up by `(account_id, contact_id)` with `confirm_asked_at is not null and confirm_reply is null and starts_at > now()`, on the hot path of every inbound text from a known contact, and neither `bookings_confirm_due` (whose `confirm_asked_at IS NULL` is that query’s exact contradiction) nor `bookings_completed_by_contact` (whose `status = 'completed'` the query does not imply) can serve it — so `bookings_confirm_reply_pending` does. B10 reached the opposite conclusion for the structurally identical reactivation read; the reply lookup was simply not considered until the apply gate.
- **B11. `APPOINTMENT_CONFIRM_MIN_LEAD_MS` is the email reminder's window END (24h15m), not the spec's flat 24h.** The spec's reason is right and its number is not: the email reminder's due window is `starts_at ∈ [now + REMINDER_WINDOW_START_MS, now + REMINDER_WINDOW_END_MS]` = `[23h, 24h15m]` (`booking.ts:383-384`, used at `:546-547`), so a booking becomes eligible for the reminder the first tick at which its lead is **24h15m** — the window's CLOSE is where the reminder OPENS. A 24h lead therefore leaves a 15-minute band in which a released confirmation ask and the email reminder are both due. The constant is `(24 * 60 + 15) * 60 * 1000`, declared as its own literal (the `REVIEW_REQUEST_MAX_AGE_MS = 61h` shape, `automations.ts:158`) with `cron-coupling.test.ts` pinning it against `REMINDER_WINDOW_END_MS` — derived from the import it could never drift, and a coupling assertion that cannot fail is not a coupling assertion. **The collision is ONE TEXT AND ONE EMAIL**, not "two texts": the SMS reminder's window is 90–135 minutes (`automations.ts:466-467`) and cannot meet a 24h lead at all. Every comment that said "two texts and one confused customer" says the true thing instead.
- **B12. The confirmation-reply lookup takes the SOONEST UPCOMING unanswered ask, not the spec's "most recent".** Spec Recipe 2 says "that contact's single most recent booking with `confirm_asked_at is not null`". The appointment a customer has in mind when they text YES is the next one, not the one they were asked about last, and an appointment that has already started is not a thing anyone is confirming — so the query orders `starts_at` ASCENDING behind `.gt("starts_at", now)`. With one outstanding ask the two rules agree; they differ only when a contact has two, which is exactly when getting it wrong writes the answer on the wrong job.
- **B13. `{when}` in the confirmation text renders in the BOOKER's zone, not the spec's "the account's zone".** The spec sentence points at "the formatter the SMS reminder already uses" and that formatter is called `safeZone(row.bookerTimezone ?? undefined, row.accountTimezone)` (`passes/sms-reminder.ts:115`, the email reminder's rule) — the precedent the spec cites contradicts the zone the spec names. A Los Angeles booker of a Texas company reads their own clock; the account zone is the fallback when the booking carries none.
- **B14. The confirmation answer surfaces on ONE screen, not the spec's three.** Spec Recipe 2 ends "The booking drawer and the work queue show the answer." There is no booking drawer in this app — `…/[accountId]/calendar/` holds `bookings-list.tsx`, `calendar-settings.tsx`, `embed-snippet.tsx`, `hours-form.ts`, `actions.ts` and `page.tsx`, and nothing else. And the work queue's booking rows are a fixed projection of `id, contact_id, ends_at` over bookings that are STILL `booked` with `ends_at` already in the past (`work-queue.ts:95-108`) — a confirmation answer for an appointment that has already ended is moot, and adding it would be a `bis-booking` change to that query rather than a render. So Task 4 ships the one surface that is both real and timely: the badge on the calendar's bookings list.
- **B15. The confirmation-reply lookup is scoped to STILL-BOOKED bookings, and its UPDATE reports what it matched.** The spec lists the reply predicates (`2026-09-21-automation-engine-b-design.md:57`) as account, contact, `confirm_asked_at is not null`, `confirm_reply is null` and upcoming — no status. That is a live bug, not a tidiness point: a contact with an asked booking at +47h that was then cancelled through the cancel link, and a second asked booking at +71h, sends one "YES" and the answer lands on the CANCELLED one, because it is the sooner and B12 takes the soonest. Task 4's badge would then paint "confirmed" on a job nobody is doing while the live appointment reads as unanswered. So the lookup carries `.eq("status", "booked")`, proven by `applyConfirmationReply never answers a CANCELLED booking, even when it is the soonest asked` in `automations.test.ts` (the cancelled fixture is the SOONEST on purpose — behind the live one the ordering would exclude it anyway and the filter would be non-load-bearing). `bookings_confirm_reply_pending` still serves the read: an equality on a column the index does not carry is a recheck of the rows it returned, not a lost index, so 0047 needs nothing. Second half: the UPDATE's `.is("confirm_reply", null)` is a compare-and-set whose only possible loser is a second inbound text arriving between the SELECT and the UPDATE, and without a `.select()` the function could not tell a matched write from a lost race — it returned the answer either way, while its own doc comment promised "the answer it wrote, or null when it wrote nothing" and Task 4's route logs on exactly that value. It is now `.select("id").maybeSingle()` with `return written ? answer : null`. **No mutation can red that CAS predicate** (the SELECT already excludes answered rows, so single-threaded it always matches) and the code says so in place, rather than leaving it looking like a filter a later author should be able to prove; dropping the `.select()` DOES red two cases, which is what keeps the guarded return honest.

## Global Constraints

- **The next free migration is `0047`.** Task 1 WRITES it and STOPS. No implementer applies a migration, ever. The orchestrator applies 0047 exactly once and then runs the db suite.
- Two CHECK constraints grow by **drop-and-re-add**, 0027's shape (`0027_instant_reply.sql:28-30`): `automations_recipe_key_check` four keys → eight; `automation_log_source_check` nine values → thirteen.
- **No grant changes.** New columns on existing tables inherit their table's standing (0027's header); `automations-grants.test.ts` pins it. Both CHECK rewrites are constraint-only.
- **`accounts.outbound_suppressed` is honoured by every pass.** Every `listDue*` and every `getDue*ById` goes through `loadSendableRows` (`booking.ts:501-521`), never `loadAccountBrandInfo`. `packages/db/src/__tests__/outbound-suppressed.test.ts` walks `automations.ts` per FUNCTION and fails a `listDue*`/`getDue*ById` that does not. **Its case is written BEFORE the due-list, every time** (the standing rule).
- **A released row is never left untouched on a branch that can repeat.** Every `continue` in a new `processX` is classified: silent on a normal tick, a real `logSkipped` when `opts.released` (`review-request.ts:168-172`; `REASONS.smsCooldown`'s own comment in `hold-or-send.ts:79-88`). A released row left alone keeps its past `held_until` and parks the head of the queue forever.
- **`RELEASERS` and `SOURCE_TITLES` are `Record<AutomationLogSource, …>` and must NEVER be widened to `Partial<…>` or indexed by a cast.** A type error there IS the red; the task report pastes it.
- **Caps** (`caps.ts`, fixed platform constants, recipe passes only): `referral_ask` and `quote_followup` take `AUTOMATION_TICK_CAP = 10` + `AUTOMATION_DAILY_CAP = 25` + `SMS_RETRY_COOLDOWN_MS = 24h` read back off their own `*_sms_failed_at`. `appointment_confirm` is **uncapped and does not read the cooldown back** (spec decision 2; the 75-minute window would make a 24h hold one attempt ever — the text reminder's recorded bug, `caps.ts:34-40`). `reactivation` has its own `REACTIVATION_DAILY_CAP = 5` plus once-per-contact-ever.
- Passes read `ctx.now`, never `new Date()`. Pure modules take `now` as an argument.
- Only `harness.ts` imports `getEmailProvider`/`getSmsProvider` (`imports.test.ts` scans every other file under `lib/automations`). A pass reaches SMS through `ctx.sms()`, lazily, inside the send's own try/catch.
- **Any test that exercises the HELD path must mock `getAutomationLogEntry`.** `holdOrSend` reads it before re-writing a held row (`hold-or-send.ts:143`); a factory mock that omits it throws at the moment the export is read (part C's recorded trap; `sentinel.test.ts:30` already carries it).
- **NO EM DASH, AND NO NON-GSM-7 CHARACTER, IN ANY BODY THAT CAN BE SENT AS A TEXT** (added 2026-09-22, after Task 3 shipped one). `segments.ts:15-19` carries neither U+2014 nor curly quotes in `GSM7_BASE`/`GSM7_EXTENDED`, and ONE occurrence drops the WHOLE body to UCS-2 at 70 chars/segment. Measured on the appointment confirm: the em-dash lead billed 3 segments, the period 2 — one extra billed segment on every send, every client, for one punctuation mark. The rule is already recorded four times in the tree (`sms/opt-out.ts:43-46`, `instant-reply-copy.test.ts:64`, `voice/textback-body.ts:12` and `:35`). **Every SMS-capable recipe's copy test asserts `encoding === "gsm7"` on its default body** — pin the encoding and the segment count, never `chars`, which rots. This plan's own prescribed copy was swept on 2026-09-22 and two bodies fixed (`appointmentConfirm.lead`, `quoteFollowup.defaultBody`); `reactivation` is email-only and exempt.
- **A FIXTURE ON A FAKE FUTURE `now` CANNOT EXERCISE A `completed_at` ANCHOR** (added 2026-09-22; Task 5 shipped a two-anchor due-list whose second disjunct was carried by no row). `setBookingStatus` stamps REAL time, so on a fake 2027 `now` every fixture's `completed_at` sits ~11 months BELOW the window and every match is by `ends_at` alone — a reviewer replaced the whole `.or(eitherAnchorSince(…))` with a plain `.gte("ends_at", …)` and the suite stayed green, while `bookings_referral_due_completed` exists for that disjunct alone. Write `completed_at` DIRECTLY, on a row whose `ends_at` is OUTSIDE the window (the batch-Friday case: job ended nine days ago, marked completed an hour ago), plus a pre-0026 row with `completed_at: null` due by `ends_at` alone. The review request's own case at `automations.test.ts:195-236` is the model.
- **A MUTATION MUST BE SCOPED TO THE FUNCTION IT NAMES.** `parseReferralAskConfig` and `parseNoShowNudgeConfig` have byte-identical bodies and the no-show one comes first in the file, so a whole-file find-and-replace mutates the WRONG one and a `-t` filter on the intended test then reports green. This is the `-t`-matches-nothing shape wearing a different hat. When two functions in a file share a body, verify you edited the one you meant before believing the result.
- **"ASSERT IT IS NOT NULL" IS VACUOUS AGAINST A MISSING COLUMN** (added 2026-09-22; this plan prescribed it twice and Task 5 produced the receipt). PostgREST OMITS an unselected column entirely, so the value is `undefined`, not `null` — and `expect(undefined).not.toBeNull()` PASSES, as does `toBeDefined`-shaped anything. A stamp case written that way cannot fail under "drop the column from the select", which is the only mutation it exists to catch. **Assert the VALUE**: the instant the writer wrote, or `>= before`. Task 5 proved it by dropping the column, putting the plan's line above its own, and watching the run fail at ITS line.
- **A supabase-js SELECT IS ONE STRING LITERAL, never a concatenation.** The client parses the select at the TYPE level off a literal; `"a, " + "b"` is plain `string`, the parser answers `GenericStringError`, and the `data as {…}` cast then fails TS2352. Task 5 hit this on the plan's own prescribed code. Every `*_SELECT` in `automations.ts` is a single literal.
- **AN UNBOUNDED GAP IN A MARKUP ASSERTION IS A VACUOUS ASSERTION** (added 2026-09-22; this plan prescribed one). `/data-testid="x"[sS]*?aria-hidden/` is satisfied by ANY `aria-hidden` later in the document, not by the one you meant — it reds today only if the component happens to emit exactly one, and the first decorative icon added anywhere below makes it pass with the thing under test deleted. This is "an assertion satisfied by an adjacent element" wearing a regex. BIND IT: `/data-testid="x"[^>]*><span aria-hidden="true"/` cannot cross the opening tag, so it asserts the dot IS the pill's first child. Same rule for any `[sS]*` or `.*` between two things you are claiming are adjacent.
- **A SEGMENT COUNTER COUNTS THE DISCLOSED BODY.** `sendAutomationSms` appends `withOptOut` unconditionally (`send-sms.ts:82`), so a card counting the composed body alone under-reports what the carrier bills. Task 3 shipped this and it was caught in review: the card rendered 1 segment where every send was 2. Count `segmentsFor(withOptOut(preview))`, and make the mutation real — counting the undisclosed text must red the case by name.
- Customer copy passes the "landscaper at 7 AM" read: no milestone codes (`messages.test.ts:44-51` walks the whole catalogue — see B8; nothing in part B goes on its `AGENCY_ONLY` allowlist), no `{{template_syntax}}`, no carrier jargon, deltas as words. A name shown to a customer is `brandDisplayName`, never `accounts.name` — the due-row types carry only `brandName` and `sentinel.test.ts` scans what actually left the building.
- UI: tokens only, status is dot + word, one primary button per view, every card gets loaded/empty/error states, both themes via `.dark`.
- **Mutation proof for every test.** Each test step names the mutation that must red it BY NAME. Run the WHOLE file, watch the named test fail, revert. Avoid the shapes this repo has shipped (`bis-vacuous-test-shapes`): no fixture where two asserted properties share a value; no negative fixture more than one unit past the boundary (it would trip an earlier guard and pass against any ceiling); no literal count that rots; no assertion satisfied by an adjacent element; no `-t` filter on a name that does not exist. If a prescribed mutation cannot fail, say so and substitute one that can.
- **Judge a run by vitest's own summary block.** `pnpm --filter @bis/db exec vitest run …` prints `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` AFTER the real results, so the shell exit code lies for that package. When an exit code matters, capture it to a file with nothing after the command in the same block.
- **Gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) belong to the orchestrator and run one at a time.** Two at once have OOM-killed this machine mid-e2e. Implementers run their domain's tests by path.
- **A fix wave that touches a component whose ONLY coverage is Playwright re-runs Playwright before the merge, not just the unit files.** The four cards Tasks 3, 6, 8 and 10 ship are covered in `page.test.ts` only by the PROPS the page hands them (`captured`, a `vi.mock` per card) — nothing there renders their markup. `apps/web/e2e/automations-b.spec.ts` (Task 11) is the whole of their end-to-end coverage, so a later edit to a card's own body that runs only `vitest` has been proven by nothing. Like the other gates, that run is the orchestrator's and takes the slot alone.

## Commands

```
pnpm --filter web exec vitest run src/lib/automations src/lib/email src/app/api/cron "src/app/(dashboard)/dashboard/accounts/[accountId]/automations"
pnpm --filter @bis/db exec vitest run src/test/automations.test.ts src/test/due-by-id.test.ts src/test/automations-grants.test.ts src/__tests__/outbound-suppressed.test.ts
pnpm --filter web typecheck
pnpm --filter @bis/db typecheck
```

## Process (danlo, 2026-09-21 — carried forward from part C, which executed cleanly through nine tasks)

- One implementer at a time in the main checkout; disjoint tasks run in git worktrees (`C:/Users/danlo/bis-wt-<x>`, deps via `pnpm install --frozen-lockfile --prefer-offline`, copy `apps/web/.env.local`).
- Read-only reviewers (`bis-reviewer`, opus) run beside a writer, never in its checkout.
- A five-minute brief review (sonnet) before every dispatch — it caught two real brief bugs on part C's last wave.
- Playwright and the `packages/db` live suite share ONE Supabase project with production and run ONE AT A TIME across implementers (the "slot"). An implementer stops at `READY_FOR_DB` / `READY_FOR_PLAYWRIGHT` and is resumed for the slot.
- **Order is the spec's build order and is mostly sequential by construction**, because every data-layer task appends to `packages/db/src/automations.ts` and every recipe task touches `registry.ts`, `release-held.ts`, `log-titles.ts`, `messages.ts`, `automations/page.tsx` and `automations/actions.ts`:

  Task 1 → *orchestrator applies 0047, runs the db suite* → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10 → Task 11.

  The only safe parallelism is INSIDE a recipe pair: a recipe's gate + copy modules (pure, own files, own tests) can be cut into a worktree beside its data-layer task. Take it only if the slot is otherwise idle.
- Owners: Task 1 `bis-db-schema`. Tasks 2, 5, 7, 9 (data layers) `bis-db-schema` with `bis-automations` reviewing. Tasks 3, 6, 8, 10 (recipes) `bis-automations`, with `bis-design-reviewer` after 10. Task 4 `bis-comms` (the webhook) with the two `bis-booking` hunks named in the brief. Task 11 `bis-e2e-qa`.
- **A recipe is not done until its pass runs green in `sentinel.test.ts`** — that file runs every registered pass and scans every send argument for `accounts.name`. Each recipe task extends its `dbMocks` block.

## File Structure

**Create**
- `packages/db/supabase/migrations/0047_automations_b.sql` — both CHECK rewrites, nine columns, **nine** indexes (B10 — the ninth, `bookings_confirm_reply_pending`, was added at the pre-apply review for `applyConfirmationReply`'s lookup).
- `packages/db/src/test/automations-b-schema.test.ts` — the constraints, the columns, the indexes and the no-grant-change claim, against the live project. **Two harnesses in one file, on purpose:** `withTestAccount` (PostgREST, real rows) for the two CHECKs, because each refused insert is its own transaction there; `withRollback` + `actAs` (raw `pg`) for the catalogue reads, because `pg_indexes` and `information_schema.role_table_grants` are not reachable through supabase-js at all — a file that advertises an index claim and goes through PostgREST cannot make it.
- `apps/web/src/lib/automations/appointment-confirm-gate.ts` (+ `.test.ts`) — the deadline and the too-close check.
- `apps/web/src/lib/automations/appointment-confirm-copy.ts` (+ `.test.ts`) — the fixed lead and the composer.
- `apps/web/src/lib/automations/passes/appointment-confirm.ts` (+ `.test.ts`).
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/appointment-confirm-card.tsx`.
- `apps/web/src/lib/automations/referral-ask-gate.ts` (+ `.test.ts`), `referral-ask-copy.ts` (+ `.test.ts`), `passes/referral-ask.ts` (+ `.test.ts`), `automations/referral-ask-card.tsx`, `apps/web/src/lib/email/templates/referral-ask.ts` (+ `.test.ts`).
- `apps/web/src/lib/automations/reactivation-gate.ts` (+ `.test.ts`), `reactivation-copy.ts` (+ `.test.ts`), `passes/reactivation.ts` (+ `.test.ts`), `automations/reactivation-card.tsx`, `apps/web/src/lib/email/templates/reactivation.ts` (+ `.test.ts`).
- `apps/web/src/lib/automations/quote-followup-gate.ts` (+ `.test.ts`), `quote-followup-copy.ts` (+ `.test.ts`), `passes/quote-followup.ts` (+ `.test.ts`), `automations/quote-followup-card.tsx`, `apps/web/src/lib/email/templates/quote-followup.ts` (+ `.test.ts`).
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.test.ts` — Task 4. That component has no test today; the confirmation pill would otherwise ship uncovered.
- `apps/web/e2e/automations-b.spec.ts`.

**Modify**
- `packages/db/src/automations.ts` — four recipe sections appended, `RecipeKey` grown four times.
- `packages/db/src/automation-log.ts` — `AUTOMATION_LOG_SOURCES` grown four times (one per recipe task).
- `packages/db/src/booking.ts` — `BookingRow` and `BOOKING_COLS` gain `confirm_reply`, `confirm_reply_at` (Task 4; `bis-booking`'s file).
- `packages/db/src/index.ts` — **`./automations` is re-exported by a NAMED list (`index.ts:65-77`), not `export *`.** Lines 63-64 are the TAIL of the `./booking` list immediately above it, so "inside 63-77" lands a name in the wrong export; the `./automations` list opens at `:65`. Every new symbol must be added to that list or it does not leave the package. `./automation-log` IS `export *` (`index.ts:84`), so `AUTOMATION_LOG_SOURCES`' growth needs no index change. Each data-layer task appends its own names and touches nobody else's line (the hot-shared-file rule).
- `packages/db/src/__tests__/outbound-suppressed.test.ts` — no code change needed (the walk is generic); its RED is the proof each new due-list is covered.
- `packages/db/src/test/automations.test.ts`, `due-by-id.test.ts` — four recipes' live cases.
- `apps/web/src/lib/automations/caps.ts` — `REACTIVATION_DAILY_CAP` (Task 8), and the doc comment names `appointment_confirm` as the **THIRD** uncapped pass (Task 3, Step 7a). Third, not second: `caps.ts:2-5` already records the reminder and follow-up passes as uncapped.
- `apps/web/src/lib/automations/hold-or-send.ts` — four new `REASONS` keys.
- `apps/web/src/lib/automations/passes/release-held.ts` — four `RELEASERS` entries.
- `apps/web/src/lib/automations/log-titles.ts` — four `SOURCE_TITLES` entries.
- `apps/web/src/lib/automations/registry.ts` — four lines in `PASSES`.
- `apps/web/src/lib/automations/cron-coupling.test.ts` — the `appointment_confirm` window case and the `referral_ask` derivation case.
- `apps/web/src/lib/automations/sentinel.test.ts` — four recipes' mocks and due-rows.
- `apps/web/src/app/api/cron/reminders/route.test.ts` — four `EMPTY_*` counter literals.
- `apps/web/src/app/api/sms/inbound/route.ts` — ONE isolated leg after `incrementUnreadCount` (Task 4).
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.tsx` — one confirmation badge (Task 4; `bis-booking`'s file).
- `apps/web/src/lib/messages.ts` — four card namespaces under `automations.*`.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/{page.tsx,actions.ts,page.test.ts,actions.test.ts}`.
- `docs/superpowers/specs/2026-09-21-automation-engine-b-design.md` (every amendment in the list at the top of this plan, B1 onwards — count them THERE, never from a range written here; the 2026-09-21 fix wave added five and a hard-coded range has already rotted once), `docs/superpowers/specs/2026-07-25-bis-platform-design.md` §8a M3 row (Task 11).

---

### Task 1: Migration `0047_automations_b.sql` and its proof (bis-db-schema)

**STOP RULE, in this task's own words:** write the migration and the test, run `pnpm --filter @bis/db typecheck`, run the new test file ONCE to record that it fails because the columns do not exist yet, commit, and report `READY_FOR_APPLY`. **Do not apply the migration.** The orchestrator applies 0047 exactly once against the shared Supabase project and then runs the db suite. An implementer who applies it has written to the project every other agent and production share.

**Files:**
- Create: `packages/db/supabase/migrations/0047_automations_b.sql`
- Create: `packages/db/src/test/automations-b-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (for Tasks 2, 5, 7, 9): the columns `bookings.confirm_asked_at`, `bookings.confirm_reply`, `bookings.confirm_reply_at`, `bookings.confirm_sms_failed_at`, `bookings.referral_asked_at`, `bookings.referral_ask_sms_failed_at`, `opportunities.quote_followup_sent_at`, `opportunities.quote_followup_sms_failed_at`, `contacts.reactivation_sent_at`; the eight-key `automations_recipe_key_check`; the thirteen-value `automation_log_source_check`; and NINE indexes whose names later tasks cite in their own comments and must not be renamed — `bookings_referral_ask_count`, `contacts_reactivation_count`, `opps_quote_followup_count`, `opps_quote_followup_due`, `bookings_confirm_due`, `bookings_referral_due`, `bookings_referral_due_completed`, `bookings_completed_by_contact`, `bookings_confirm_reply_pending` (Task 5 names the first, the sixth and the seventh; Task 7 names the second and the eighth; Task 9 names the fourth; Task 4's reply lookup is served by the ninth).

- [ ] **Step 1: Write the migration**

`packages/db/supabase/migrations/0047_automations_b.sql`:

```sql
-- 0047_automations_b.sql
-- Automation engine, part B (docs/superpowers/specs/2026-09-21-automation-engine-b-design.md).
--
-- FOUR recipes on part C's floor, and ONE migration for the four because they
-- share two CHECK rewrites: four separate drop/re-adds of the same constraint
-- would be four chances to misspell one of the nine values that must survive.
--
-- Nothing here is a new table. Every column is an `alter table ... add column`
-- on a table that already exists, which is why there are NO GRANT CHANGES:
-- a new column inherits its table's standing (0027's header). The two shapes
-- that standing takes, and both are PROVEN rather than asserted, in
-- automations-b-schema.test.ts's catalogue describe:
--   * bookings carries NO `authenticated` UPDATE at all - 0016:88 revokes it
--     and nothing re-grants it - so the client's UPDATE set for that table is
--     empty, and six new columns leave it empty.
--   * contacts and opportunities carry TABLE-level grants, which
--     information_schema.column_privileges EXPANDS into one row per column,
--     so a new column appears automatically with the same four privileges
--     every other column already has. 0030_contacts_sort_name.sql:37-49 is
--     the in-repo record of that mechanism, appended as a CORRECTION after
--     the same mistake was made there.
-- Both CHECK rewrites are constraint-only and touch no ACL.
--
-- Column by column, and why each one exists:
--   bookings.confirm_asked_at        the appointment_confirm dedupe stamp
--                                    (send-then-stamp, like every recipe).
--   bookings.confirm_reply           'yes' | 'no', written by the INBOUND SMS
--                                    webhook when the customer answers. It
--                                    NEVER changes bookings.status: a
--                                    destructive action from one word in a
--                                    text, with no confirmation, is what
--                                    DESIGN.md rule 6 forbids. The operator
--                                    cancels.
--   bookings.confirm_reply_at        when they answered.
--   bookings.confirm_sms_failed_at   the attempt marker. WRITTEN AND NEVER
--                                    READ BACK: the confirm's due window is
--                                    75 minutes, so a 24h cooldown would mean
--                                    one attempt ever - the text reminder's
--                                    recorded bug (caps.ts's
--                                    SMS_RETRY_COOLDOWN_MS comment). It exists
--                                    so a failed attempt is visible.
--   bookings.referral_asked_at       the referral_ask dedupe stamp.
--   bookings.referral_ask_sms_failed_at   its attempt marker, read back.
--   opportunities.quote_followup_sent_at  one send per opportunity, EVER.
--   opportunities.quote_followup_sms_failed_at   its attempt marker, read back.
--   contacts.reactivation_sent_at    one send per contact, EVER. This column
--                                    IS the off switch that outlives the
--                                    toggle: turning reactivation off mid-drain
--                                    strands nothing, because the stamp is
--                                    permanent.

-- 1. The recipe catalogue: four keys become eight. 0027's shape - Postgres
--    has no "alter check", so drop and re-add.
alter table public.automations drop constraint automations_recipe_key_check;
alter table public.automations add constraint automations_recipe_key_check
  check (recipe_key in (
    'review_request', 'no_show_nudge', 'sms_reminder', 'instant_reply',
    'appointment_confirm', 'referral_ask', 'reactivation', 'quote_followup'));

-- 2. The log's sources: nine become thirteen. The nine are copied from
--    0046_automation_log.sql:35-37 verbatim; re-typing them from memory is
--    how a source silently stops being writable.
alter table public.automation_log drop constraint automation_log_source_check;
alter table public.automation_log add constraint automation_log_source_check
  check (source in (
    'reminders', 'followups', 'review_request', 'no_show_nudge', 'sms_reminder',
    'instant_reply', 'weekly_report', 'concierge', 'voice',
    'appointment_confirm', 'referral_ask', 'reactivation', 'quote_followup'));

-- 3. bookings: the confirmation ask and its answer, plus the referral ask.
alter table public.bookings add column confirm_asked_at timestamptz;
alter table public.bookings add column confirm_reply text
  constraint bookings_confirm_reply_check check (confirm_reply in ('yes', 'no'));
alter table public.bookings add column confirm_reply_at timestamptz;
alter table public.bookings add column confirm_sms_failed_at timestamptz;
alter table public.bookings add column referral_asked_at timestamptz;
alter table public.bookings add column referral_ask_sms_failed_at timestamptz;

-- 4. opportunities: the quote follow-up's stamp and its attempt marker.
alter table public.opportunities add column quote_followup_sent_at timestamptz;
alter table public.opportunities add column quote_followup_sms_failed_at timestamptz;

-- 5. contacts: the reactivation stamp.
alter table public.contacts add column reactivation_sent_at timestamptz;

-- 6. Indexes - NINE, and the count is a decision (plan amendment B10, plus the
--    ninth added by the pre-apply review; see the note above it).
--    NAMING: a bare table prefix, no `idx_`. Zero of the 113 indexes in
--    `public` carry that prefix today, and `opportunities` is abbreviated
--    `opps_` by its own two existing indexes (opps_account_pipeline,
--    opps_contact). An index name is permanent once applied; this is the
--    house form, read off the live catalogue, not invented here.
--
--    (a) THREE partial cap-count indexes, 0027's shape: a daily cap counts
--        stamps (no ledger table, no timezone), so `(account_id, <stamp>)
--        where <stamp> is not null` makes each count an index-only read.
--        ONE PER CAPPED RECIPE, and there are exactly three of those -
--        referral_ask, reactivation, quote_followup. appointment_confirm is
--        UNCAPPED (spec decision 2) and this plan deliberately declares no
--        countAppointmentConfirmsSince, so an index on confirm_asked_at
--        would index a column nothing ever counts. It is not created.
create index bookings_referral_ask_count
  on public.bookings (account_id, referral_asked_at)
  where referral_asked_at is not null;
create index contacts_reactivation_count
  on public.contacts (account_id, reactivation_sent_at)
  where reactivation_sent_at is not null;
create index opps_quote_followup_count
  on public.opportunities (account_id, quote_followup_sent_at)
  where quote_followup_sent_at is not null;
--    (b) TWO due-list indexes for the two due-lists whose predicates are new
--        columns on their own table. Each carries its due-list's OWN
--        predicates so an idle tick on a busy account reads index tuples and
--        no heap.
create index opps_quote_followup_due
  on public.opportunities (account_id, stage_id, stage_changed_at)
  where quote_followup_sent_at is null and status = 'open';
create index bookings_confirm_due
  on public.bookings (account_id, starts_at)
  where confirm_asked_at is null and status = 'booked';
--    (c) THREE more the review added, because without them two new due-lists
--        scan `bookings` whole on every fifteen-minute tick.
--
--        The referral ask needs its OWN pair of anchors. The review request
--        has the identical two-anchor shape and TWO partial indexes for it
--        (0025:44 bookings_review_due on (ends_at), 0026:49-50
--        bookings_review_due_completed on (completed_at)), and NEITHER can
--        serve this query: Postgres chooses a partial index only when its
--        predicate is IMPLIED by the query's, and
--        `referral_asked_at is null` does not imply
--        `review_requested_at is null`.
create index bookings_referral_due
  on public.bookings (ends_at)
  where status = 'completed' and referral_asked_at is null;
create index bookings_referral_due_completed
  on public.bookings (completed_at)
  where status = 'completed' and referral_asked_at is null;
--        And reactivation's anti-blast read filters bookings on
--        `.in("contact_id", ...).eq("status","completed")`. There is no
--        index on bookings.contact_id AT ALL - the live catalogue's only
--        bookings indexes are bookings_pkey, bookings_cancel_token_key,
--        bookings_no_overlap, bookings_by_calendar, bookings_reminder_due,
--        bookings_review_due, bookings_review_due_completed,
--        bookings_no_show_due, bookings_no_show_due_marked and
--        bookings_sms_reminder_due.
create index bookings_completed_by_contact
  on public.bookings (contact_id)
  where status = 'completed';
--        And one more the pre-apply review caught, on the hot path of every
--        inbound text: applyConfirmationReply (part B Task 4) looks up the
--        booking a YES or NO answers with
--          account_id = ? and contact_id = ?
--          and confirm_asked_at is not null and confirm_reply is null
--          and starts_at > now()  order by starts_at  limit 1
--        NEITHER of the two candidates above can serve it, and for the same
--        implication rule: bookings_confirm_due's predicate is
--        `confirm_asked_at IS NULL`, the exact CONTRADICTION of this query's
--        `IS NOT NULL`, so it is never chosen; and bookings_completed_by_contact
--        carries `status = 'completed'`, which a query with no status filter
--        does not imply. Without this index the read is a sequential scan plus
--        a sort on EVERY inbound SMS from a known contact - and the `limit 1`
--        does not bound it, because `order by starts_at` must find every
--        matching row before it can return the first.
create index bookings_confirm_reply_pending
  on public.bookings (account_id, contact_id, starts_at)
  where confirm_asked_at is not null and confirm_reply is null;
```

- [ ] **Step 2: Write the proof**

`packages/db/src/test/automations-b-schema.test.ts`. It reads the live database, never the `.sql` file: the failure this guards against is "the migration was never applied", and a grep over the migration passes in that world.

**TWO HARNESSES, and which claim needs which.** `withTestAccount` (`test/fixtures.ts:139`, signature `withTestAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>)`) is supabase-js over PostgREST against real rows, and it is the only way to prove a CHECK by being refused by it — each refused insert is its own HTTP round trip and its own transaction, so a refusal does not poison the next assertion. What it CANNOT do is reach `pg_indexes` or `information_schema.role_table_grants`: PostgREST exposes `public` tables, not the catalogue. So the index and grant claims this file advertises are written with `withRollback` + `actAs` (`test/db.ts:4-19`, `:21-25`) — a raw `pg` client inside `begin … rollback`. In THAT harness the one-refused-statement-per-transaction rule applies (`automations-grants.test.ts:56-58`: a refusal aborts the transaction and every statement after it reports `25P02` instead of its own reason), but nothing below refuses anything — they are all reads.

> **Before writing, read `packages/db/src/test/automations.test.ts:370-378` and `packages/db/src/test/due-by-id.test.ts:13-21` for the working fixture shape, and `packages/db/src/test/fixtures.ts:139` for `withTestAccount`'s signature.** THE SOURCE WINS over anything below. Do not invent column names: `calendars` has no `name`, no `slug` and no `timezone` (`0016_booking.sql:7-27`; the only `alter table calendars add column` in 46 migrations is `0022_meetings_followups.sql:2-6`, which adds `meeting_type`/`followup_enabled`/`followup_body`), and an insert naming one dies on 42703 — **before AND after the apply**, so the migration's proof would never land. Use the helpers the sibling tests already use. There is no `packages/db/src/client.ts` either; the service client lives in `../service`, and this file does not need it at all because `withTestAccount` hands one to the callback.

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { withRollback } from "./db";
import { getOrCreateCalendar, createBooking } from "../booking";
import { createContact } from "../contacts";

const token = () => `tok_${Math.random().toString(36).slice(2, 12)}`;

/** The bookings FKs a test row needs — the sibling suites' own helpers, not a
 *  local re-implementation (automations.test.ts:373-374, due-by-id.test.ts:14-16).
 *  `createBooking` does no time validation, so past and future fixtures are
 *  both fine, and `getOrCreateCalendar` is idempotent per account
 *  (`calendars_one_per_account`). */
async function parents(db: Parameters<typeof createContact>[0], accountId: string) {
  const cal = await getOrCreateCalendar(db, accountId, "user_test");
  const { id: contactId } = await createContact(
    db, accountId, { firstName: "Bo", phone: "(956) 555-0123" }, "user_test");
  return { calendarId: cal.id, contactId };
}

describe("0047 - the recipe catalogue is eight keys", () => {
  it("accepts each of the four new recipe keys", async () => {
    await withTestAccount(async (db, accountId) => {
      for (const key of ["appointment_confirm", "referral_ask", "reactivation", "quote_followup"] as const) {
        const { error } = await db.from("automations")
          .insert({ account_id: accountId, recipe_key: key, enabled: false, body: "", config: {} });
        expect(error, `inserting recipe_key=${key}`).toBeNull();
      }
    });
  });

  it("keeps all FOUR original recipe keys writable", async () => {
    // The drop-and-re-add is the stated reason this is ONE migration rather
    // than four (the migration's own header): re-typing a surviving value is
    // how a key silently stops being writable. The log's nine are checked the
    // same way below; the catalogue's four were not, until this case.
    await withTestAccount(async (db, accountId) => {
      for (const key of ["review_request", "no_show_nudge", "sms_reminder", "instant_reply"] as const) {
        const { error } = await db.from("automations")
          .insert({ account_id: accountId, recipe_key: key, enabled: false, body: "", config: {} });
        expect(error, `inserting recipe_key=${key}`).toBeNull();
      }
    });
  });

  it("still refuses a key that is not in the catalogue, by SQLSTATE 23514", async () => {
    await withTestAccount(async (db, accountId) => {
      const { error } = await db.from("automations")
        .insert({ account_id: accountId, recipe_key: "birthday_greeting", enabled: false, body: "", config: {} });
      // 23514 = check_violation. The CODE, never "an error": a typo'd column
      // name also produces an error and would satisfy a truthiness check
      // while proving nothing about the constraint.
      expect(error?.code).toBe("23514");
    });
  });
});

describe("0047 - the log accepts thirteen sources and no more", () => {
  it("accepts each of the four new sources", async () => {
    await withTestAccount(async (db, accountId) => {
      for (const source of ["appointment_confirm", "referral_ask", "reactivation", "quote_followup"] as const) {
        const { error } = await db.from("automation_log").insert({
          account_id: accountId, source, channel: "sms", subject_key: `t:${source}`,
          status: "sent", reason: "",
        });
        expect(error, `inserting source=${source}`).toBeNull();
      }
    });
  });

  it("keeps all NINE original sources writable", async () => {
    await withTestAccount(async (db, accountId) => {
      const nine = ["reminders", "followups", "review_request", "no_show_nudge", "sms_reminder",
                    "instant_reply", "weekly_report", "concierge", "voice"] as const;
      for (const source of nine) {
        const isAi = source === "concierge" || source === "voice";
        const { error } = await db.from("automation_log").insert({
          account_id: accountId, source, channel: isAi ? "ai" : "email",
          subject_key: `t9:${source}`, status: "sent", reason: "",
        });
        expect(error, `inserting source=${source}`).toBeNull();
      }
    });
  });

  it("refuses an unknown source by SQLSTATE 23514", async () => {
    await withTestAccount(async (db, accountId) => {
      const { error } = await db.from("automation_log").insert({
        account_id: accountId, source: "weekly_agency_report", channel: "email",
        subject_key: "t:none", status: "sent", reason: "",
      });
      expect(error?.code).toBe("23514");
    });
  });
});

describe("0047 - the nine columns exist and carry their constraints", () => {
  it("bookings.confirm_reply accepts yes and no and refuses anything else", async () => {
    await withTestAccount(async (db, accountId) => {
      const { calendarId, contactId } = await parents(db, accountId);
      const mk = (reply: string | null) => db.from("bookings").insert({
        account_id: accountId, calendar_id: calendarId, contact_id: contactId,
        starts_at: "2027-01-05T15:00:00Z", ends_at: "2027-01-05T16:00:00Z",
        status: "cancelled", cancel_token: token(), confirm_reply: reply,
      }).select("id").maybeSingle();

      expect((await mk("yes")).error).toBeNull();
      expect((await mk("no")).error).toBeNull();
      expect((await mk(null)).error).toBeNull();
      // "YES" is the customer's word, not the column's: the webhook lowercases
      // before it writes, and this constraint is what proves it must.
      expect((await mk("YES")).error?.code).toBe("23514");
      expect((await mk("maybe")).error?.code).toBe("23514");
    });
  });

  it("every new column is selectable and defaults to null", async () => {
    await withTestAccount(async (db, accountId) => {
      const { calendarId, contactId } = await parents(db, accountId);
      const { data: bk, error: bkErr } = await db.from("bookings").insert({
        account_id: accountId, calendar_id: calendarId, contact_id: contactId,
        starts_at: "2027-01-06T15:00:00Z", ends_at: "2027-01-06T16:00:00Z",
        status: "booked", cancel_token: token(),
      }).select("confirm_asked_at, confirm_reply, confirm_reply_at, confirm_sms_failed_at, referral_asked_at, referral_ask_sms_failed_at").single();
      expect(bkErr).toBeNull();
      expect(bk).toEqual({
        confirm_asked_at: null, confirm_reply: null, confirm_reply_at: null,
        confirm_sms_failed_at: null, referral_asked_at: null, referral_ask_sms_failed_at: null,
      });

      const { data: ct } = await db.from("contacts")
        .insert({ account_id: accountId, first_name: "Ada", email: "ada@example.com" })
        .select("id, reactivation_sent_at").single();
      expect(ct!.reactivation_sent_at).toBeNull();

      const { data: pipe } = await db.from("pipelines")
        .insert({ account_id: accountId, name: "Sales", position: 0 }).select("id").single();
      const { data: stage } = await db.from("pipeline_stages")
        .insert({ account_id: accountId, pipeline_id: pipe!.id, name: "Quoted", position: 0 })
        .select("id").single();
      const { data: opp, error: oppErr } = await db.from("opportunities").insert({
        account_id: accountId, contact_id: ct!.id, pipeline_id: pipe!.id, stage_id: stage!.id,
        name: "Reroof",
      }).select("quote_followup_sent_at, quote_followup_sms_failed_at").single();
      expect(oppErr).toBeNull();
      expect(opp).toEqual({ quote_followup_sent_at: null, quote_followup_sms_failed_at: null });
    });
  });
});

/**
 * THE CATALOGUE CLAIMS — the two CHECK definitions in full, the nine columns,
 * the EIGHT index names with their partial predicates, and the
 * no-grant-change claim. `withRollback` + raw SQL, because supabase-js goes
 * through PostgREST and PostgREST reaches neither `pg_indexes` nor
 * `information_schema.role_table_grants`: a file that advertises an index
 * claim over PostgREST cannot make it.
 *
 * Every statement below is a READ, so the one-refused-statement-per-
 * transaction rule (`automations-grants.test.ts:56-58` — a refusal aborts the
 * transaction and everything after it reports 25P02 instead of its own
 * reason) has nothing to bite here. It still governs the CHECK cases above,
 * which is why those stay on `withTestAccount`: each PostgREST refusal is its
 * own transaction.
 */
describe("0047 - the catalogue, read directly", () => {
  it("both CHECKs list every value, eight keys and thirteen sources, in one read", async () => {
    // The insert cases above prove one value at a time and cannot see a value
    // that was DROPPED and never re-added unless someone thought to test it.
    // This sees the whole list at once. `pg_get_constraintdef` renders an
    // `in (...)` as `= ANY (ARRAY[...])`; that is Postgres's spelling, not a
    // rewrite of the migration.
    await withRollback(async (c) => {
      const { rows } = await c.query<{ conname: string; def: string }>(
        `select conname, pg_get_constraintdef(oid) as def from pg_constraint
          where conname in ('automations_recipe_key_check', 'automation_log_source_check')
          order by conname`,
      );
      expect(rows.map((r) => r.conname)).toEqual(
        ["automation_log_source_check", "automations_recipe_key_check"]);
      expect(rows[0]!.def).toBe(
        "CHECK ((source = ANY (ARRAY['reminders'::text, 'followups'::text, 'review_request'::text, "
        + "'no_show_nudge'::text, 'sms_reminder'::text, 'instant_reply'::text, 'weekly_report'::text, "
        + "'concierge'::text, 'voice'::text, 'appointment_confirm'::text, 'referral_ask'::text, "
        + "'reactivation'::text, 'quote_followup'::text])))");
      expect(rows[1]!.def).toBe(
        "CHECK ((recipe_key = ANY (ARRAY['review_request'::text, 'no_show_nudge'::text, "
        + "'sms_reminder'::text, 'instant_reply'::text, 'appointment_confirm'::text, "
        + "'referral_ask'::text, 'reactivation'::text, 'quote_followup'::text])))");
    });
  });

  it("adds exactly the nine columns, each nullable, each timestamptz but confirm_reply", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ t: string; col: string; ty: string; nullable: string }>(
        `select table_name as t, column_name as col, data_type as ty, is_nullable as nullable
           from information_schema.columns
          where table_schema = 'public'
            and (table_name, column_name) in (
              ('bookings','confirm_asked_at'), ('bookings','confirm_reply'),
              ('bookings','confirm_reply_at'), ('bookings','confirm_sms_failed_at'),
              ('bookings','referral_asked_at'), ('bookings','referral_ask_sms_failed_at'),
              ('opportunities','quote_followup_sent_at'), ('opportunities','quote_followup_sms_failed_at'),
              ('contacts','reactivation_sent_at'))`,
      );
      // Sorted in JS, never by SQL: the database's collation decides whether
      // `referral_ask_sms_failed_at` sorts before `referral_asked_at`, and a
      // test that depends on that answer is a test that moves on its own.
      expect(rows.map((r) => `${r.t}.${r.col} ${r.ty} nullable=${r.nullable}`).sort()).toEqual([
        "bookings.confirm_asked_at timestamp with time zone nullable=YES",
        "bookings.confirm_reply text nullable=YES",
        "bookings.confirm_reply_at timestamp with time zone nullable=YES",
        "bookings.confirm_sms_failed_at timestamp with time zone nullable=YES",
        "bookings.referral_ask_sms_failed_at timestamp with time zone nullable=YES",
        "bookings.referral_asked_at timestamp with time zone nullable=YES",
        "contacts.reactivation_sent_at timestamp with time zone nullable=YES",
        "opportunities.quote_followup_sent_at timestamp with time zone nullable=YES",
        "opportunities.quote_followup_sms_failed_at timestamp with time zone nullable=YES",
      ]);
    });
  });

  it("ships NINE indexes, under those exact names, every one of them PARTIAL", async () => {
    // AN INDEX NAME IS PERMANENT. Tasks 5, 7 and 9 cite six of these eight by
    // name in their due-lists' own comments, so a typo here is a comment that
    // points at nothing for as long as the schema lives. The predicates are
    // pinned too: a partial index is chosen only when its predicate is
    // IMPLIED by the query's, so a wrong predicate is a silent sequential
    // scan rather than an error.
    const EXPECTED: Record<string, readonly string[]> = {
      bookings_referral_ask_count: [
        "ON public.bookings USING btree (account_id, referral_asked_at)",
        "WHERE (referral_asked_at IS NOT NULL)"],
      contacts_reactivation_count: [
        "ON public.contacts USING btree (account_id, reactivation_sent_at)",
        "WHERE (reactivation_sent_at IS NOT NULL)"],
      opps_quote_followup_count: [
        "ON public.opportunities USING btree (account_id, quote_followup_sent_at)",
        "WHERE (quote_followup_sent_at IS NOT NULL)"],
      opps_quote_followup_due: [
        "ON public.opportunities USING btree (account_id, stage_id, stage_changed_at)",
        "quote_followup_sent_at IS NULL", "status = 'open'::text"],
      bookings_confirm_due: [
        "ON public.bookings USING btree (account_id, starts_at)",
        "confirm_asked_at IS NULL", "status = 'booked'::text"],
      bookings_referral_due: [
        "ON public.bookings USING btree (ends_at)",
        "status = 'completed'::text", "referral_asked_at IS NULL"],
      bookings_referral_due_completed: [
        "ON public.bookings USING btree (completed_at)",
        "status = 'completed'::text", "referral_asked_at IS NULL"],
      bookings_completed_by_contact: [
        "ON public.bookings USING btree (contact_id)",
        "WHERE (status = 'completed'::text)"],
    };

    await withRollback(async (c) => {
      const { rows } = await c.query<{ indexname: string; indexdef: string }>(
        `select indexname, indexdef from pg_indexes
          where schemaname = 'public'
            and (indexname = any($1::text[]) or indexname = 'bookings_confirm_asked')`,
        [Object.keys(EXPECTED)],
      );
      const byName = new Map(rows.map((r) => [r.indexname, r.indexdef]));

      expect([...byName.keys()].sort()).toEqual(Object.keys(EXPECTED).sort());
      for (const [name, fragments] of Object.entries(EXPECTED)) {
        for (const fragment of fragments) expect(byName.get(name), name).toContain(fragment);
        expect(byName.get(name), `${name} must be PARTIAL`).toContain(" WHERE ");
      }
      // The one the first draft named and the review dropped. It would index
      // confirm_asked_at for a cap count that does not exist, because
      // appointment_confirm is uncapped and this plan declares no
      // countAppointmentConfirmsSince (B10). The set equality above already
      // fails if it is present; this says WHY out loud.
      expect(byName.has("bookings_confirm_asked")).toBe(false);
    });
  });

  it("changes no grant: bookings keeps NO client UPDATE, and the new columns carry exactly their table's standing", async () => {
    await withRollback(async (c) => {
      // THE SHARPEST PIN AVAILABLE. `0016_booking.sql:88` revokes UPDATE on
      // bookings from authenticated and never re-grants it, so the client's
      // UPDATE set for this table is EMPTY — and six new columns must leave
      // it empty. (`automations-grants.test.ts` makes the same assertion for
      // 0025's and 0026's columns; this is 0047's six.)
      const { rows: bookingUpdates } = await c.query(
        `select column_name from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = 'bookings' and privilege_type = 'UPDATE'`);
      expect(bookingUpdates).toEqual([]);

      // contacts and opportunities are the OTHER shape, and 0030's own
      // appended correction is the in-repo proof of it
      // (`0030_contacts_sort_name.sql:37-49`): these tables carry TABLE-level
      // grants, and `information_schema.column_privileges` EXPANDS a
      // table-level grant into one row per column — so a newly added column
      // appears automatically with the same four privileges every other
      // column already has. Both sides are written as LITERALS rather than
      // one compared to the other: two empty sets are also equal.
      const privs = async (table: string, col: string) => (await c.query<{ p: string }>(
        `select privilege_type as p from information_schema.column_privileges
          where grantee = 'authenticated' and table_schema = 'public'
            and table_name = $1 and column_name = $2 order by privilege_type`,
        [table, col])).rows.map((r) => r.p);
      const FOUR = ["INSERT", "REFERENCES", "SELECT", "UPDATE"];
      expect(await privs("contacts", "first_name"), "contacts.first_name (the control)").toEqual(FOUR);
      expect(await privs("contacts", "reactivation_sent_at"), "contacts.reactivation_sent_at").toEqual(FOUR);
      expect(await privs("opportunities", "name"), "opportunities.name (the control)").toEqual(FOUR);
      expect(await privs("opportunities", "quote_followup_sent_at"), "opportunities.quote_followup_sent_at").toEqual(FOUR);
      expect(await privs("opportunities", "quote_followup_sms_failed_at"), "opportunities.quote_followup_sms_failed_at").toEqual(FOUR);
    });
  });
});
```

The `status: "cancelled"` on the `confirm_reply` rows is deliberate: `bookings_no_overlap` only binds `status='booked'`, and five rows at the same instant would otherwise collide with each other rather than with the CHECK under test — a negative fixture that trips an EARLIER guard is one of this repo's recorded vacuous shapes.

**Which of these are legitimately RED before the apply, and which are not.** Say so in the report, per case, and do not round a vacuous pass up to green:
- RED before the apply: "accepts each of the four new recipe keys" and "accepts each of the four new sources" (the old CHECK refuses them, so `error.code` is `23514` where `null` is expected); "bookings.confirm_reply accepts yes and no…" (**`PGRST204`**, not 42703 — PostgREST rejects an unknown column in a WRITE payload from its own schema cache before Postgres sees the statement) and "every new column is selectable and defaults to null" (42703 — an unknown column in a `select` is a real Postgres error); "both CHECKs list every value…" (the constraint defs still carry the old four and nine); "adds exactly the nine columns…" (the read returns `[]`); "ships NINE indexes…" (none of the nine exists).
- ALSO RED before the apply: "the three new client-writable columns inherit their table's four privileges" — `information_schema.column_privileges` has no row for a column that does not exist, so `[]` where `FOUR` is expected.
- GREEN BEFORE AND AFTER, and that is what they are FOR: "keeps all FOUR original recipe keys writable", "keeps all NINE original sources writable", "still refuses a key that is not in the catalogue", "refuses an unknown source by SQLSTATE 23514", and "changes no grant: bookings keeps NO client UPDATE, and the two control columns keep exactly four". They are the drop-and-re-add's safety net and the no-grant-change claim — a claim is only proven by a value that does NOT move. Report them as green-before-and-after, never as if the post-apply green were new evidence.

  **So the pre-apply count is 8 RED / 5 GREEN, over 13 cases.** (The split ADDED a red; it did not turn a green into one — 7+1 red, 5 green. An earlier draft of this line said 8/4, subtracting the split-out case from the green side as well as adding it to the red.) The line originally read 7/5, with the grants case listed as green-before-and-after, and Task 1’s implementer caught it: that one `it` had mixed the two kinds of claim, asserting the unmoved grant surface AND the three new columns' privileges in the same body. Pre-apply it failed at the first new column — so nothing it claimed about the unmoved grants was ever demonstrated, which is precisely the property a both-sides-green case exists to have. **The case is now split** (`automations-b-schema.test.ts:281` and `:329`): the unmoved surface plus its two control columns in the green-both-sides case, the three new columns in their own red-before case. A both-sides-green assertion sharing an `it` with a red-before one is a vacuous-proof shape worth naming: the green is unobservable, so the claim rests on nothing.

- [ ] **Step 3: Typecheck, record the pre-apply red, commit, STOP**

```bash
pnpm --filter @bis/db typecheck
```

Expected: exit 0, no output.

```bash
pnpm --filter @bis/db exec vitest run src/test/automations-b-schema.test.ts > /tmp/0047-pre-apply.log 2>&1; echo "exit=$?" >> /tmp/0047-pre-apply.log
```

Expected BEFORE apply: RED. The failure will be a PostgREST complaint that a column does not exist, or a `23514` expectation met by `null` on an insert Postgres accepted because the constraint is still the old one. Paste the exact failing assertion line into the report — that red is the evidence this test reads the database and not a string. Nothing follows the command in that block on purpose: a trailing `echo` has masked a red suite as exit 0 in this repo before.

```bash
git add packages/db/supabase/migrations/0047_automations_b.sql packages/db/src/test/automations-b-schema.test.ts
git commit -m "db(automations): migration 0047 - eight recipe keys, thirteen log sources, nine columns for part B"
```

Report `READY_FOR_APPLY`, and hand over the two queries below verbatim.

- [ ] **Step 4 (ORCHESTRATOR ONLY): pre-flight, apply once, then prove**

**The pre-flight READ, before `apply_migration`.** All four results must be `0` / absent; if any is not, 0047 has already been applied and must NOT be applied again.

```sql
select
  (select count(*) from supabase_migrations.schema_migrations where name = '0047_automations_b')            as ledger_rows,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'bookings' and column_name = 'confirm_asked_at')        as confirm_col,
  (select count(*) from pg_indexes
     where schemaname = 'public' and indexname in (
       'bookings_referral_ask_count','contacts_reactivation_count','opps_quote_followup_count',
       'opps_quote_followup_due','bookings_confirm_due','bookings_referral_due',
       'bookings_referral_due_completed','bookings_completed_by_contact','bookings_confirm_reply_pending'))                                  as new_indexes,
  (select count(*) from pg_constraint
     where conname = 'automations_recipe_key_check'
       and pg_get_constraintdef(oid) like '%appointment_confirm%')                                          as key_check_grown;
```

> **`name`, NOT `version`.** In this project `supabase_migrations.schema_migrations.version` holds a timestamp (`20260921121302` for `0046_automation_log`) and `name` holds `0046_automation_log`. A guard written as `version like '0047%'` reads 0 before AND after the apply and gates nothing — that exact mistake has already been made here once. The three object checks are belt and braces: the ledger row and the schema can disagree if a migration was ever applied by hand.

**The post-apply verification READ**, same shape, all four now non-zero:

```sql
select
  (select count(*) from supabase_migrations.schema_migrations where name = '0047_automations_b')            as ledger_rows,
  (select count(*) from information_schema.columns where table_schema = 'public' and (
     (table_name = 'bookings' and column_name in ('confirm_asked_at','confirm_reply','confirm_reply_at',
        'confirm_sms_failed_at','referral_asked_at','referral_ask_sms_failed_at')) or
     (table_name = 'opportunities' and column_name in ('quote_followup_sent_at','quote_followup_sms_failed_at')) or
     (table_name = 'contacts' and column_name = 'reactivation_sent_at')))                                   as new_columns,   -- expect 9
  (select count(*) from pg_indexes
     where schemaname = 'public' and indexname in (
       'bookings_referral_ask_count','contacts_reactivation_count','opps_quote_followup_count',
       'opps_quote_followup_due','bookings_confirm_due','bookings_referral_due',
       'bookings_referral_due_completed','bookings_completed_by_contact','bookings_confirm_reply_pending'))                                  as new_indexes,   -- expect 9
  (select count(*) from pg_indexes
     where schemaname = 'public' and indexname = 'bookings_confirm_asked')                                  as dropped_index; -- expect 0
```

Then the suite:

```bash
pnpm --filter @bis/db exec vitest run src/test/automations-b-schema.test.ts src/test/automations-grants.test.ts > /tmp/0047-post-apply.log 2>&1; echo "exit=$?" >> /tmp/0047-post-apply.log
```

Expected AFTER apply: `automations-b-schema.test.ts` green, and `automations-grants.test.ts` **still green, unchanged** — that is the migration's "no grant changes" claim proven rather than asserted. Judge both by vitest's own summary block; `@bis/db` prints `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` after the real results, so the shell exit code lies for that package.

---

### Task 2: `appointment_confirm` — the data layer and the reply matcher (bis-db-schema)

**Files:**
- Modify: `packages/db/src/automations.ts` (append a new section after the `sms_reminder` section, before the `instant_reply` section at :560; grow `RecipeKey` at :15)
- Modify: `packages/db/src/index.ts` (append names to the `./automations` NAMED export list, which opens at `index.ts:65` and closes at `:77`; `:63-64` are the TAIL of the `./booking` list above it — this file is shared; touch nobody else's line)
- Modify: `packages/db/src/test/automations.test.ts` (a new `describe` at the end)
- Modify: `packages/db/src/test/due-by-id.test.ts` (the by-id case — that file IS the house home for every `getDue*ById`, its `describe("the recipe lookups: \`off\` until the recipe is on, \`gone\` in the wrong status")` at `:53` already owns exactly this shape, and its `"sms reminder"` case at `:54-63` is the model to copy line for line. The File Structure names this file; Task 2's Files list omitted it.)

**Interfaces:**
- Consumes: Task 1's columns; `loadSendableRows`, `AccountBrandInfo`, `DueLookup` from `./booking`; `listEnabled`, `enabledRecipeFor`, `brandDisplayName` already in this file.
- Produces:
  ```ts
  export type RecipeKey = "review_request" | "no_show_nudge" | "sms_reminder" | "instant_reply" | "appointment_confirm";
  export const APPOINTMENT_CONFIRM_WINDOW_START_MS: number;  // 47h
  export const APPOINTMENT_CONFIRM_WINDOW_END_MS: number;    // 48h15m
  export const APPOINTMENT_CONFIRM_MIN_LEAD_MS: number;      // 24h15m — REMINDER_WINDOW_END_MS (B11)
  export type DueAppointmentConfirm = {
    bookingId: string; accountId: string; startsAt: string; bookerTimezone: string | null;
    contactId: string; contactPhone: string | null; brandName: string; accountTimezone: string; body: string;
  };
  export async function listDueAppointmentConfirms(db: SupabaseClient, nowIso: string): Promise<DueAppointmentConfirm[]>;
  export async function getDueAppointmentConfirmById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueAppointmentConfirm>>;
  export async function stampAppointmentConfirmAsked(db: SupabaseClient, bookingId: string): Promise<void>;
  export async function stampAppointmentConfirmSmsFailed(db: SupabaseClient, bookingId: string): Promise<void>;
  export type ConfirmationAnswer = "yes" | "no";
  export function matchConfirmationReply(text: string): ConfirmationAnswer | null;
  export async function applyConfirmationReply(
    db: SupabaseClient, accountId: string, contactId: string, text: string, now: Date,
  ): Promise<ConfirmationAnswer | null>;
  ```
  There is deliberately **no `countAppointmentConfirmsSince`**: the recipe is uncapped (spec decision 2), and an accessor whose only purpose is a cap that does not exist is a function a later author would wire up by mistake.

- [ ] **Step 1: RED FIRST — prove the suppression walk can see this recipe**

`packages/db/src/__tests__/outbound-suppressed.test.ts` needs no edit: its first case walks every `export async function listDue*`/`getDue*ById` in `automations.ts` per FUNCTION and fails any that does not mention `loadSendableRows`. That is how the "write the case before the pass" rule cashes out here, and the way to make the red REAL is to write the due-list's skeleton without the call first.

Append this skeleton to `packages/db/src/automations.ts` (it will be completed in Step 3):

```ts
export async function listDueAppointmentConfirms(
  db: SupabaseClient, nowIso: string,
): Promise<DueAppointmentConfirm[]> {
  void db; void nowIso;
  return [];
}
```

with the `DueAppointmentConfirm` type from the Interfaces block above.

- [ ] **Step 2: Run it and watch the walk go red BY NAME**

```bash
pnpm --filter @bis/db exec vitest run src/__tests__/outbound-suppressed.test.ts > /tmp/supp-red.log 2>&1; echo "exit=$?" >> /tmp/supp-red.log
```

Expected: FAIL in `outbound suppression > routes every due-list, and every by-id release lookup, through loadSendableRows`, with `expected [ 'automations.ts: listDueAppointmentConfirms' ] to deeply equal []`. Paste that line into the report. (If it passes, the walk is not seeing the new function — check that the declaration is `export async function`, which is what the splitter at `outbound-suppressed.test.ts:42` matches on (`.split(/(?=export (?:async )?function )/)`). A test that cannot fail is not evidence.)

- [ ] **Step 3: Write the section**

Replace the skeleton. Append this whole block to `packages/db/src/automations.ts` after the `sms_reminder` section (i.e. immediately before the `Recipe: instant reply` banner comment at :560), and grow `RecipeKey` at :15:

```ts
export type RecipeKey =
  | "review_request" | "no_show_nudge" | "sms_reminder" | "instant_reply"
  | "appointment_confirm";
```

```ts
// ---------------------------------------------------------------------------
// Recipe: appointment confirmation, two days out (part B)
// ---------------------------------------------------------------------------

/**
 * Two days out, 75 minutes wide — the email reminder's width and for its
 * reason (booking.ts:383-384, the measured cron jitter). The CLOSE is 48h15m
 * so a text sent at the far edge still reads as "two days from now"; the OPEN
 * at 47h is how long a missed tick can catch up. A booking made less than 47
 * hours ahead is never inside and is never asked — its email reminder and its
 * text reminder are already on the way.
 *
 * cron-coupling.test.ts pins both against vercel.json. Change one, change both.
 */
export const APPOINTMENT_CONFIRM_WINDOW_START_MS = 47 * 60 * 60 * 1000;
export const APPOINTMENT_CONFIRM_WINDOW_END_MS = 48 * 60 * 60 * 1000 + 15 * 60 * 1000;

/**
 * The instant the ask stops being worth making: 24 HOURS AND 15 MINUTES
 * before the appointment, which is the instant the EMAIL reminder becomes
 * eligible.
 *
 * Read `REMINDER_WINDOW_*` in booking.ts (:383-384) before changing this. The
 * email reminder's due window is `starts_at ∈ [now + 23h, now + 24h15m]`
 * (:546-547): a booking first matches it on the tick where its lead is
 * 24h15m, and stops matching at 23h. So the window's CLOSE is where the
 * reminder OPENS, and a 24h bound here would leave a fifteen-minute band in
 * which both are due. The collision is ONE TEXT AND ONE EMAIL — "can you
 * confirm?" and "here's your reminder" in the same quarter hour. (Not two
 * texts: the SMS reminder's window is 90-135 minutes, SMS_REMINDER_WINDOW_*
 * below, and cannot meet a 24h lead at all.)
 *
 * Its own literal, not `= REMINDER_WINDOW_END_MS`, and that is deliberate:
 * derived from the import the two could never drift and cron-coupling's
 * assertion could never fail, which is the shape this repo keeps shipping by
 * accident. REVIEW_REQUEST_MAX_AGE_MS (:158) is the same choice — a literal
 * 61h, with cron-coupling.test.ts pinning the derivation.
 *
 * Used twice: as the held subject's `deadline` (hold rather than send past
 * usefulness) and as `releaseAppointmentConfirm`'s own re-check.
 */
export const APPOINTMENT_CONFIRM_MIN_LEAD_MS = (24 * 60 + 15) * 60 * 1000;

/** SMS only, by definition of the recipe ("Reply YES" in an email points at a
 *  no-reply address), so the row carries no email address at all — the type is
 *  how a recipe author is kept from sending this by mail. It also carries no
 *  `smsFailedAt`: this recipe writes its attempt marker and NEVER reads it
 *  back (a 24h cooldown over a 75-minute window is one attempt ever — the text
 *  reminder's recorded bug), and a field that must not be read is best absent. */
export type DueAppointmentConfirm = {
  bookingId: string; accountId: string;
  startsAt: string;
  /** The booker's own zone, captured at booking, for the time in the text —
   *  safeZone(bookerTimezone, accountTimezone), the email reminder's rule. */
  bookerTimezone: string | null;
  contactId: string; contactPhone: string | null;
  brandName: string; accountTimezone: string;
  /** The operator's optional CLOSING line. The ask itself is fixed copy
   *  (appointment-confirm-copy.ts): "either way we'll see it" is the whole
   *  reason there is no reply-back, so it cannot live in an editable field. */
  body: string;
};

const APPOINTMENT_CONFIRM_SELECT =
  "id, account_id, contact_id, starts_at, booker_timezone, contacts(phone)";

function toDueAppointmentConfirm(r: any, info: AccountBrandInfo, auto: EnabledRecipe): DueAppointmentConfirm {
  return {
    bookingId: r.id,
    accountId: r.account_id,
    startsAt: r.starts_at,
    bookerTimezone: r.booker_timezone ?? null,
    contactId: r.contact_id,
    contactPhone: r.contacts?.phone ?? null,
    brandName: brandDisplayName(info.branding),
    accountTimezone: info.accountTimezone,
    body: auto.body,
  };
}

/** No gate follows this list beyond the window: the ask is tied to the
 *  appointment, not to a morning, and quiet hours already holds a 6 AM send
 *  until 08:00. */
export async function listDueAppointmentConfirms(
  db: SupabaseClient, nowIso: string,
): Promise<DueAppointmentConfirm[]> {
  const enabled = await listEnabled(db, "appointment_confirm", "listDueAppointmentConfirms");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now + APPOINTMENT_CONFIRM_WINDOW_START_MS).toISOString();
  const windowEnd = new Date(now + APPOINTMENT_CONFIRM_WINDOW_END_MS).toISOString();

  const { data, error } = await db.from("bookings")
    .select(APPOINTMENT_CONFIRM_SELECT)
    .in("account_id", [...enabled.keys()])
    .eq("status", "booked").is("confirm_asked_at", null)
    .gte("starts_at", windowStart).lte("starts_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueAppointmentConfirms failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueAppointmentConfirms");

  return sendable.map((r: any) =>
    toDueAppointmentConfirm(r, accountInfo.get(r.account_id as string)!, enabled.get(r.account_id as string)!));
}

export async function getDueAppointmentConfirmById(
  db: SupabaseClient, bookingId: string,
): Promise<DueLookup<DueAppointmentConfirm>> {
  const { data, error } = await db.from("bookings")
    .select(APPOINTMENT_CONFIRM_SELECT)
    .eq("id", bookingId).eq("status", "booked").is("confirm_asked_at", null).maybeSingle();
  if (error) throw new Error(`getDueAppointmentConfirmById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const auto = await enabledRecipeFor(db, (data as any).account_id, "appointment_confirm");
  if (!auto) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(
    db, [data as { account_id: string }], "getDueAppointmentConfirmById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueAppointmentConfirm(data, accountInfo.get((data as any).account_id)!, auto) };
}

/** Send-then-stamp, same reasoning as every other recipe: only after a
 *  confirmed send. This is what stops five copies over the 75-minute window. */
export async function stampAppointmentConfirmAsked(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ confirm_asked_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampAppointmentConfirmAsked failed: ${error.message}`);
}

/** The attempt marker, WRITTEN AND NEVER READ BACK (caps.ts's text-reminder
 *  exemption, for the same reason: a 24h cooldown over a 75-minute window is
 *  one attempt ever). It exists so a failed attempt is visible to the
 *  operator, not so the pass can hold on it. */
export async function stampAppointmentConfirmSmsFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ confirm_sms_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampAppointmentConfirmSmsFailed failed: ${error.message}`);
}

// --- the reply -------------------------------------------------------------

export type ConfirmationAnswer = "yes" | "no";

// The accented member is written as an ESCAPED codepoint, never as an editor
// literal: an editor, a formatter or a git filter that re-saved this file in
// NFD would turn a typed "sí" into s + U+0301, and the set would then
// silently stop matching the composed form the matcher normalises to. A
// \u00ed cannot be decomposed by a save.
const CONFIRM_YES: ReadonlySet<string> = new Set([
  "yes", "y", "si", "s\u00ed" /* sí, COMPOSED. The ESCAPE is the protection:
                                  an editor that re-saves this file in NFD
                                  cannot decompose a codepoint written so. */
  , "confirm", "confirmed",
]);
const CONFIRM_NO: ReadonlySet<string> = new Set(["no", "n", "cancel"]);

/**
 * The WHOLE message, not a word inside it. "yes please, but move it to
 * Friday" is a conversation, not a confirmation, and "I said no problem" is
 * not a cancellation — a substring match would mis-read both, and the second
 * would tell an operator a customer cancelled when they did not.
 *
 * So: normalise (NFC, because "sí" can arrive as s + U+0301 — iOS and some
 * Android keyboards send the decomposed form, and the set above holds the
 * composed one), trim, lowercase, strip TRAILING punctuation and symbols
 * ("yes.", "YES!!", "no 👍"), then test set membership. Anything else returns
 * null and nothing is written at all.
 *
 * TRAILING ONLY, and that is a decision: "¡Sí!" returns null, because the
 * opening "¡" survives the strip. A Spanish speaker who opens with "¡" is
 * writing a sentence, not tapping one word, and widening the strip to both
 * ends would start admitting fragments of sentences — the exact thing the
 * whole-message rule exists to refuse.
 *
 * Pure, and exported on its own so it can be tested without a database.
 */
export function matchConfirmationReply(text: string): ConfirmationAnswer | null {
  const cleaned = text.normalize("NFC").trim().toLowerCase().replace(/[\s\p{P}\p{S}]+$/u, "");
  if (CONFIRM_YES.has(cleaned)) return "yes";
  if (CONFIRM_NO.has(cleaned)) return "no";
  return null;
}

/**
 * Records a customer's one-word answer against the booking the ask went out
 * for. Called from the inbound SMS webhook, in its own try/catch, AFTER the
 * message has been filed — a keyword failure must never discard a customer's
 * message (the getAlertPhone pattern, api/sms/inbound/route.ts:124-128).
 *
 * What it does NOT do, and both are decisions, not omissions:
 *   - it never touches bookings.status. A destructive action from one word in
 *     a text, with no confirmation, is what DESIGN.md rule 6 forbids; the
 *     operator cancels, having read the answer on the booking.
 *   - it never sends anything. A reply-back would make this webhook a sender,
 *     cost a message per confirmation and risk a loop against the carrier's
 *     own STOP handling. The ask's own "either way we'll see it" is what
 *     covers the customer (spec decision 6).
 *
 * "Which booking": the SOONEST UPCOMING one this contact was asked about and
 * has not answered. Soonest rather than most recently asked, because that is
 * the appointment the customer has in mind when they reply; an appointment
 * that has already started is not a thing anyone is confirming.
 *
 * Returns the answer it wrote, or null when it wrote nothing — the route logs
 * the difference and does nothing else with it.
 */
export async function applyConfirmationReply(
  db: SupabaseClient, accountId: string, contactId: string, text: string, now: Date,
): Promise<ConfirmationAnswer | null> {
  const answer = matchConfirmationReply(text);
  if (answer === null) return null;

  const { data, error } = await db.from("bookings")
    .select("id")
    .eq("account_id", accountId).eq("contact_id", contactId)
    .not("confirm_asked_at", "is", null)
    .is("confirm_reply", null)
    .gt("starts_at", now.toISOString())
    .order("starts_at", { ascending: true })
    .limit(1).maybeSingle();
  if (error) throw new Error(`applyConfirmationReply lookup failed: ${error.message}`);
  if (!data) return null;

  const { error: uErr } = await db.from("bookings")
    .update({ confirm_reply: answer, confirm_reply_at: now.toISOString() })
    .eq("id", (data as { id: string }).id)
    // Re-scoped by account on the WRITING statement too. Not a live hole —
    // the id came out of the account-scoped SELECT above — but this runs
    // service-role, and a writing statement whose tenancy you have to trace
    // to another query to see is how the next edit loses it.
    .eq("account_id", accountId)
    .is("confirm_reply", null);
  if (uErr) throw new Error(`applyConfirmationReply write failed: ${uErr.message}`);
  return answer;
}
```

- [ ] **Step 4: Export from the package**

`packages/db/src/index.ts`, inside the existing `export { … } from "./automations";` list — it OPENS at `index.ts:65` (`export { getAutomation, upsertAutomation, …`) and closes at `:77`. **`:63-64` are the tail of the `./booking` list immediately above**, so a name appended "inside 63-77" can land in the wrong export and leave `@bis/db` compiling while the symbol is re-exported from a module that does not define it. Append, do not reorder:

```ts
         listDueAppointmentConfirms, getDueAppointmentConfirmById,
         stampAppointmentConfirmAsked, stampAppointmentConfirmSmsFailed,
         matchConfirmationReply, applyConfirmationReply,
         APPOINTMENT_CONFIRM_WINDOW_START_MS, APPOINTMENT_CONFIRM_WINDOW_END_MS,
         APPOINTMENT_CONFIRM_MIN_LEAD_MS,
         type DueAppointmentConfirm, type ConfirmationAnswer,
```

`./automations` is re-exported by a NAMED list, not `export *` — a symbol left off it does not leave the package, and a forgotten export has cost a whole commit in this repo before.

- [ ] **Step 5: Run the suppression walk again and watch it go green**

```bash
pnpm --filter @bis/db exec vitest run src/__tests__/outbound-suppressed.test.ts > /tmp/supp-green.log 2>&1; echo "exit=$?" >> /tmp/supp-green.log
```

Expected: the `routes every due-list…` case passes. Then the mutation: swap `loadSendableRows` for `loadAccountBrandInfo` in `listDueAppointmentConfirms` only, re-run, confirm the SAME case fails naming `automations.ts: listDueAppointmentConfirms` **and** the third case (`leaves loadAccountBrandInfo called only where the flag is already applied`) fails on the caller list, revert.

- [ ] **Step 6: The live tests**

Append to `packages/db/src/test/automations.test.ts`, and add `listDueAppointmentConfirms, getDueAppointmentConfirmById, stampAppointmentConfirmAsked, stampAppointmentConfirmSmsFailed, matchConfirmationReply, applyConfirmationReply, APPOINTMENT_CONFIRM_WINDOW_START_MS, APPOINTMENT_CONFIRM_WINDOW_END_MS, APPOINTMENT_CONFIRM_MIN_LEAD_MS` to that file's existing `from "../automations"` import:

```ts
describe("appointment confirm — the matcher is the whole message, never a substring", () => {
  it("reads a one-word yes in the forms a customer actually sends", () => {
    for (const yes of ["yes", "YES", " Yes ", "yes.", "YES!!", "y", "Si", "sí", "SÍ", "confirm", "Confirmed"]) {
      expect(matchConfirmationReply(yes), JSON.stringify(yes)).toBe("yes");
    }
  });

  it("reads a DECOMPOSED sí — the form some phone keyboards actually send", () => {
    // ESCAPED codepoints, NEVER editor-typed literals. A typed decomposed
    // "s" + U+0301 is one save away from being silently recomposed, and this
    // case would then pass with `.normalize("NFC")` DELETED — which is the
    // one mutation it exists to catch. Every fixture in the case above is
    // already composed, so not one of them can red that deletion: verified
    // by running the matcher both ways.
    // Mutation: delete `.normalize("NFC")` from matchConfirmationReply —
    // THIS case reds by name and nothing else in the file moves.
    expect(matchConfirmationReply("si\u0301"), "si + U+0301").toBe("yes");
    expect(matchConfirmationReply("SI\u0301"), "SI + U+0301").toBe("yes");
    expect(matchConfirmationReply("si\u0301."), "si + U+0301 + a full stop").toBe("yes");
  });

  it("reads a one-word no", () => {
    for (const no of ["no", "NO", "no.", "n", "cancel", "Cancel!"]) {
      expect(matchConfirmationReply(no), JSON.stringify(no)).toBe("no");
    }
  });

  it("reads NOTHING out of a sentence that merely contains the word", () => {
    // Mutation: replace the set membership test with `cleaned.includes(...)`
    // — BOTH of the first two go red, and they are the two real customer
    // sentences this rule exists for.
    for (const other of [
      "yes please, but move it to Friday",
      "I said no problem",
      "", "   ", "yesterday", "know", "can I confirm the address?", "👍",
      // Only TRAILING punctuation is stripped, so the opening "¡" survives
      // and this is a sentence, not a tap. Documented in the matcher's own
      // comment so the asymmetry reads as a decision.
      "¡Sí!",
    ]) {
      expect(matchConfirmationReply(other), JSON.stringify(other)).toBeNull();
    }
  });
});

describe("appointment confirm — data layer", () => {
  it("the window is 47h to 48h15m ahead and 75 minutes wide, and the ask's lead is 24h15m", () => {
    expect(APPOINTMENT_CONFIRM_WINDOW_START_MS).toBe(47 * HOUR);
    expect(APPOINTMENT_CONFIRM_WINDOW_END_MS).toBe(48 * HOUR + 15 * MINUTE);
    // 24h15m, not 24h: the email reminder becomes eligible at 24h15m out, so
    // that is where the ask has to stop (B11). `cron-coupling.test.ts` is
    // what pins it to REMINDER_WINDOW_END_MS; this pins the number itself.
    expect(APPOINTMENT_CONFIRM_MIN_LEAD_MS).toBe(24 * HOUR + 15 * MINUTE);
  });

  it("listDueAppointmentConfirms: enabled, booked, starting 47h–48h15m out, unasked → due; edges inclusive", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Twodays", phone: "(956) 555-0107" }, "user_test");
      const now = new Date("2027-04-12T12:00:00Z");
      const mk = (startsAt: Date, bookerTimezone?: string) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + MINUTE), bookerTimezone }, "user_test");

      const inside = await mk(new Date(now.getTime() + 47 * HOUR + 30 * MINUTE), "America/Los_Angeles");
      // OFF: nothing is due while the recipe is disabled.
      expect((await listDueAppointmentConfirms(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(inside.id);

      await upsertAutomation(db, accountId, "appointment_confirm",
        { enabled: true, body: "Any questions, just reply.", config: {} }, "user_test");
      const lowerEdge = await mk(new Date(now.getTime() + APPOINTMENT_CONFIRM_WINDOW_START_MS));
      const upperEdge = await mk(new Date(now.getTime() + APPOINTMENT_CONFIRM_WINDOW_END_MS));
      // ONE MINUTE outside each edge, never "next week": a fixture a day past
      // the bound passes against any ceiling and proves nothing.
      const tooSoon = await mk(new Date(now.getTime() + APPOINTMENT_CONFIRM_WINDOW_START_MS - MINUTE));
      const tooFar = await mk(new Date(now.getTime() + APPOINTMENT_CONFIRM_WINDOW_END_MS + MINUTE));
      const asked = await mk(new Date(now.getTime() + 47 * HOUR + 40 * MINUTE));
      await stampAppointmentConfirmAsked(db, asked.id);
      const cancelled = await mk(new Date(now.getTime() + 47 * HOUR + 50 * MINUTE));
      await cancelBookingByToken(db, cancelled.cancelToken);
      // An ATTEMPT marker must NOT remove the row from the list: this recipe
      // never reads the cooldown back (0047's own comment). Mutation: add a
      // `.is("confirm_sms_failed_at", null)` predicate — this expectation reds.
      await db.from("bookings").update({ confirm_sms_failed_at: now.toISOString() }).eq("id", lowerEdge.id);

      const ids = (await listDueAppointmentConfirms(db, now.toISOString())).map((r) => r.bookingId);
      expect(ids).toContain(inside.id);
      expect(ids).toContain(lowerEdge.id);
      expect(ids).toContain(upperEdge.id);
      expect(ids).not.toContain(tooSoon.id);     // Mutation: move the start to 46h
      expect(ids).not.toContain(tooFar.id);      // Mutation: move the end to 49h
      expect(ids).not.toContain(asked.id);
      expect(ids).not.toContain(cancelled.id);

      const row = (await listDueAppointmentConfirms(db, now.toISOString())).find((r) => r.bookingId === inside.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row).not.toHaveProperty("contactEmail");   // SMS only: no address it must not use
      expect(row).not.toHaveProperty("smsFailedAt");    // written, never read back
      expect(row.bookerTimezone).toBe("America/Los_Angeles");
      expect(row.contactPhone).toBe("(956) 555-0107");
      expect(row.body).toBe("Any questions, just reply.");
    });
  });

  it("a suppressed account's booking is never due", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Quiet", phone: "(956) 555-0108" }, "user_test");
      await upsertAutomation(db, accountId, "appointment_confirm", { enabled: true, body: "", config: {} }, "user_test");
      const now = new Date("2027-04-12T12:00:00Z");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(now.getTime() + 47 * HOUR + 30 * MINUTE),
          endsAt: new Date(now.getTime() + 47 * HOUR + 31 * MINUTE) }, "user_test");
      expect((await listDueAppointmentConfirms(db, now.toISOString())).map((r) => r.bookingId)).toContain(b.id);
      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      expect((await listDueAppointmentConfirms(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(b.id);
      expect((await getDueAppointmentConfirmById(db, b.id)).due).toBeNull();
    });
  });

  it("applyConfirmationReply writes the answer on the SOONEST unanswered ask, and nothing else", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Replier", phone: "(956) 555-0110" }, "user_test");
      const now = new Date("2027-06-01T12:00:00Z");
      const mk = (startsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + MINUTE) }, "user_test");

      const past = await mk(new Date(now.getTime() - 3 * HOUR));
      const soon = await mk(new Date(now.getTime() + 47 * HOUR));
      const later = await mk(new Date(now.getTime() + 71 * HOUR));
      const never = await mk(new Date(now.getTime() + 95 * HOUR));   // asked? no.
      for (const b of [past, soon, later]) await stampAppointmentConfirmAsked(db, b.id);

      // A message that is not an answer writes nothing at all.
      expect(await applyConfirmationReply(db, accountId, contactId, "can I confirm the address?", now)).toBeNull();
      const { data: untouched } = await db.from("bookings").select("confirm_reply").eq("id", soon.id).single();
      expect((untouched as { confirm_reply: string | null }).confirm_reply).toBeNull();

      expect(await applyConfirmationReply(db, accountId, contactId, "YES", now)).toBe("yes");
      const read = async (id: string) => (await db.from("bookings")
        .select("status, confirm_reply, confirm_reply_at").eq("id", id).single()).data as
        { status: string; confirm_reply: string | null; confirm_reply_at: string | null };

      expect((await read(soon)).confirm_reply).toBe("yes");                  // soonest upcoming
      // BY VALUE, never .not.toBeNull(): a column dropped from a select comes back
      // UNDEFINED, and expect(undefined).not.toBeNull() PASSES — so that form cannot
      // fail under the very mutation it exists to catch (proven in Task 5).
      expect(new Date((await read(soon.id)).confirm_reply_at!).getTime()).toBe(NOW.getTime());
      expect((await read(soon)).status).toBe("booked");                      // a NO never cancels; a YES never confirms the STATUS either
      expect((await read(later)).confirm_reply).toBeNull();                  // Mutation: order descending → this reds
      expect((await read(past)).confirm_reply).toBeNull();                   // Mutation: drop the starts_at filter → this reds
      expect((await read(never)).confirm_reply).toBeNull();                  // Mutation: drop the confirm_asked_at filter → this reds

      // A second answer does not overwrite the first: the row is already answered.
      expect(await applyConfirmationReply(db, accountId, contactId, "no", now)).toBe("no");
      expect((await read(soon)).confirm_reply).toBe("yes");
      expect((await read(later)).confirm_reply).toBe("no");                  // it moved to the next unanswered one
    });
  });

  it("applyConfirmationReply never reaches another account's booking", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Tenant", phone: "(956) 555-0111" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-07-01T15:00:00Z"), endsAt: new Date("2027-07-01T15:30:00Z") }, "user_test");
      await stampAppointmentConfirmAsked(db, b.id);
      const stranger = "00000000-0000-4000-8000-000000000000";
      // Mutation: delete the .eq("account_id", accountId) from the SELECT
      // (the lookup, not the UPDATE) → this reds. Deleting it from the
      // UPDATE alone cannot red anything, which is why that one carries a
      // comment saying it is defence in depth rather than a live guard.
      expect(await applyConfirmationReply(db, stranger, contactId, "yes", new Date("2027-06-01T12:00:00Z"))).toBeNull();
      const { data } = await db.from("bookings").select("confirm_reply").eq("id", b.id).single();
      expect((data as { confirm_reply: string | null }).confirm_reply).toBeNull();
    });
  });
});
```

`MINUTE` may not exist in that file — it declares `const HOUR = 60 * 60 * 1000;` at :22. Read the file's own constants first and add `const MINUTE = 60 * 1000;` beside `HOUR` if it is missing; do not shadow it locally in one describe.

**And the by-id case goes in the other file.** `packages/db/src/test/due-by-id.test.ts` is the house home for every `getDue*ById` — its `describe("the recipe lookups: \`off\` until the recipe is on, \`gone\` in the wrong status")` at `:53` already owns exactly this three-answer shape, and its `"sms reminder"` case at `:54-63` is the model. Append there, and add `getDueAppointmentConfirmById, stampAppointmentConfirmAsked` to that file's `from "../automations"` import at `:5`:

```ts
  it("appointment confirm: off until the recipe is on, gone once asked", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await seed(db, accountId);
      // "off", not "gone" — the releaser writes a DIFFERENT reason for each
      // ("This automation was turned off" vs "No longer due"), so a lookup
      // that collapsed them would put the wrong sentence on a client's
      // screen. Mutation: return `why: "gone"` from the `!auto` branch of
      // getDueAppointmentConfirmById → this case reds by name.
      expect(await getDueAppointmentConfirmById(db, bookingId)).toEqual({ due: null, why: "off" });
      await upsertAutomation(db, accountId, "appointment_confirm",
        { enabled: true, body: "", config: {} }, "user_test");
      // No window check on the by-id path, on purpose: a release is a held
      // row coming back, and its 75-minute window closed hours ago by
      // definition. `seed`'s booking is in 2027 and is never inside it.
      expect((await getDueAppointmentConfirmById(db, bookingId)).due?.bookingId).toBe(bookingId);
      await stampAppointmentConfirmAsked(db, bookingId);
      expect(await getDueAppointmentConfirmById(db, bookingId)).toEqual({ due: null, why: "gone" });
    });
  });
```

> `seed` (`due-by-id.test.ts:13-21`) already builds the calendar, the contact and a `booked` booking at `2027-03-05T15:00:00Z`. Read it before writing — if its shape has moved, THE SOURCE WINS.

- [ ] **Step 7: Run, mutate, commit**

```bash
pnpm --filter @bis/db typecheck
pnpm --filter @bis/db exec vitest run src/test/automations.test.ts src/test/due-by-id.test.ts src/__tests__/outbound-suppressed.test.ts > /tmp/task2.log 2>&1; echo "exit=$?" >> /tmp/task2.log
```

Expected: vitest's summary block reports all three files green. Then run EACH prescribed mutation above, one at a time, confirming the named test fails and reverting. Paste one red assertion line per mutation into the report. A mutation that stays green is a finding, not a pass. The full list for this task:

| Mutation | Test that must red, BY NAME |
| --- | --- |
| swap `loadSendableRows` for `loadAccountBrandInfo` in `listDueAppointmentConfirms` | `routes every due-list, and every by-id release lookup, through loadSendableRows` |
| delete `.normalize("NFC")` from `matchConfirmationReply` | `reads a DECOMPOSED sí — the form some phone keyboards actually send` |
| replace the set membership test with `cleaned.includes(...)` | `reads NOTHING out of a sentence that merely contains the word` |
| move the window start to 46h / the end to 49h | `listDueAppointmentConfirms: enabled, booked, starting 47h–48h15m out, unasked → due; edges inclusive` |
| add a `.is("confirm_sms_failed_at", null)` predicate to the due-list | same case (the `lowerEdge` expectation) |
| order `starts_at` descending in `applyConfirmationReply`'s lookup | `applyConfirmationReply writes the answer on the SOONEST unanswered ask, and nothing else` |
| drop the `.gt("starts_at", …)` filter / drop the `confirm_asked_at` filter | same case |
| delete `.eq("account_id", accountId)` from the LOOKUP | `applyConfirmationReply never reaches another account's booking` |
| return `why: "gone"` from the `!auto` branch of `getDueAppointmentConfirmById` | `appointment confirm: off until the recipe is on, gone once asked` |

```bash
git add packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts packages/db/src/test/due-by-id.test.ts
git commit -m "db(automations): appointment_confirm due-list, by-id lookup, stamps and the one-word reply matcher"
```

---

### Task 3: `appointment_confirm` — the recipe (bis-automations)

**Files:**
- Modify: `packages/db/src/automation-log.ts` (`AUTOMATION_LOG_SOURCES` gains `"appointment_confirm"`)
- Modify: `apps/web/src/lib/automations/hold-or-send.ts` (`REASONS.tooCloseToAppointment`)
- Create: `apps/web/src/lib/automations/appointment-confirm-gate.ts` (+ `.test.ts`)
- Create: `apps/web/src/lib/automations/appointment-confirm-copy.ts` (+ `.test.ts`)
- Create: `apps/web/src/lib/automations/passes/appointment-confirm.ts` (+ `.test.ts`)
- Modify: `apps/web/src/lib/automations/passes/release-held.ts`, `log-titles.ts`, `registry.ts`, `cron-coupling.test.ts`, `sentinel.test.ts`
- Modify: `apps/web/src/lib/automations/caps.ts` — **doc comments only, no new constant** (Step 7a): spec decision 2's closing obligation, "`caps.ts`'s doc comment grows to name it".
- Modify: `apps/web/src/app/api/cron/reminders/route.test.ts` (one new `EMPTY_*` literal, and the SEVEN whole-body equality assertions that enumerate every pass key)
- Modify: `apps/web/src/lib/messages.ts` (the `automations.appointmentConfirm.*` namespace)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/appointment-confirm-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/{page.tsx,actions.ts,page.test.ts,actions.test.ts}`

**Interfaces:**
- Consumes: Task 2's exports; `holdOrSend`, `logSkipped`, `subjectOf`, `verdict`, `REASONS`, `HoldSubject`, `Releaser` from `../hold-or-send`; `sendAutomationSms`, `markAutomationSmsSent` from `../send-sms`; `resolveSmsSender` from `@/lib/sms/sender`; `toE164`; `safeZone`, `formatWhen` from `@/lib/booking/time`; `stampWithRetry`; `SMS_REMINDER_PREVIEW_INSTANT` from `../sms-reminder-copy`.
- Produces:
  ```ts
  // appointment-confirm-gate.ts
  export function appointmentConfirmDeadline(startsAt: Date): Date;
  export function tooCloseToAsk(now: Date, startsAt: Date): boolean;
  // appointment-confirm-copy.ts
  export function appointmentConfirmLead(brandName: string, whenText: string): string;
  export function composeAppointmentConfirm(brandName: string, whenText: string, body: string): string;
  // passes/appointment-confirm.ts
  export type AppointmentConfirmCounters = { sent: number; failed: number; unstamped: number; held: number; skippedNoAddress: number; skippedSmsGate: number };
  export const appointmentConfirmPass: Pass;                      // key: "appointmentConfirms"
  export async function processAppointmentConfirms(ctx: PassContext, due: DueAppointmentConfirm[]): Promise<AppointmentConfirmCounters>;
  export const releaseAppointmentConfirm: Releaser;
  ```
  No `ProcessOptions` here: this recipe has no morning band, so there is nothing for `released` to skip. The releaser calls `processAppointmentConfirms(ctx, [due])` directly, exactly as `releaseSmsReminder` does (`passes/sms-reminder.ts:167`).

- [ ] **Step 1: The gate, tests first**

`apps/web/src/lib/automations/appointment-confirm-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { APPOINTMENT_CONFIRM_MIN_LEAD_MS } from "@bis/db";
import { appointmentConfirmDeadline, tooCloseToAsk } from "./appointment-confirm-gate";

const NOW = new Date("2027-04-12T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("the confirmation ask's deadline", () => {
  it("is exactly 24 hours and 15 minutes before the appointment", () => {
    // LITERAL on both sides. Building the expectation out of
    // APPOINTMENT_CONFIRM_MIN_LEAD_MS would make this red only if
    // appointmentConfirmDeadline flipped its arithmetic SIGN — the constant
    // and the expectation would move together and the number itself would
    // never be pinned. 2027-04-14T11:00Z minus 24h15m is 2027-04-13T10:45Z.
    expect(appointmentConfirmDeadline(new Date("2027-04-14T11:00:00.000Z")).toISOString())
      .toBe("2027-04-13T10:45:00.000Z");
    // Mutation A: `startsAt.getTime() + APPOINTMENT_CONFIRM_MIN_LEAD_MS` → red.
    // Mutation B: set the constant back to a flat 24h → also red, which is
    // the half the derived version could not see.
  });

  it("is too close to ask AT the lead and one millisecond inside it, not one millisecond outside", () => {
    // The boundary, tested AT the boundary and 1ms either side. A fixture a
    // day past the bound would pass against any lead value. These three ARE
    // built from the constant on purpose — the case is about the comparison
    // operator, not the number, and the number is pinned above and in
    // cron-coupling.test.ts.
    expect(tooCloseToAsk(NOW, at(APPOINTMENT_CONFIRM_MIN_LEAD_MS - 1))).toBe(true);
    expect(tooCloseToAsk(NOW, at(APPOINTMENT_CONFIRM_MIN_LEAD_MS))).toBe(true);
    expect(tooCloseToAsk(NOW, at(APPOINTMENT_CONFIRM_MIN_LEAD_MS + 1))).toBe(false);
    // Mutation: change the comparison to `<` — the exactly-at-the-lead row
    // goes red BY NAME and nothing else moves.
  });

  it("an appointment already in the past is too close, and an unreadable instant fails CLOSED", () => {
    expect(tooCloseToAsk(NOW, at(-3600_000))).toBe(true);
    expect(tooCloseToAsk(NOW, new Date("nonsense"))).toBe(true);
    expect(tooCloseToAsk(new Date("nonsense"), at(47 * 3600_000))).toBe(true);
    // Mutation: return false on a NaN instant — TWO of these three go red
    // (the two NaN ones), not all three: an appointment an hour in the past
    // has a lead of −3,600,000, which is finite, never reaches the guard,
    // and is `true` by the comparison alone. Fail closed is the house rule
    // for a stamp that cannot be trusted.
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter web exec vitest run src/lib/automations/appointment-confirm-gate.test.ts
```

Expected: FAIL — `Failed to resolve import "./appointment-confirm-gate"`. Paste the line.

- [ ] **Step 3: Write the gate**

`apps/web/src/lib/automations/appointment-confirm-gate.ts`:

```ts
import { APPOINTMENT_CONFIRM_MIN_LEAD_MS } from "@bis/db";

/**
 * WHEN a confirmation ask stops being worth making — the pure half of the
 * appointment-confirm pass. There is no morning band here and no staleness
 * cap: the due WINDOW (47h–48h15m, listDueAppointmentConfirms) already says
 * when the ask becomes due, and quiet hours says when it may go. All that is
 * left is the far end.
 *
 * `appointmentConfirmDeadline` is handed to `holdOrSend` as the subject's
 * `deadline`, which sends rather than holds past usefulness. It is reachable
 * only under a quiet window nearly 23 hours long — the ask is due two days
 * out and the deadline is 24h15m out, so the two rarely meet — and it is
 * declared anyway because the RULE is "never hold something past the point it
 * helps", not "this fires often".
 *
 * `tooCloseToAsk` is what actually bites, in `releaseAppointmentConfirm`: a
 * row held through a long window and released inside the email reminder's own
 * eligibility is skipped with a reason, never texted. The lead is 24h15m and
 * not a flat 24h because the email reminder becomes eligible at 24h15m out
 * (REMINDER_WINDOW_END_MS, booking.ts:384) — the collision this prevents is
 * one text and one email in the same quarter hour, not two texts.
 */
export function appointmentConfirmDeadline(startsAt: Date): Date {
  return new Date(startsAt.getTime() - APPOINTMENT_CONFIRM_MIN_LEAD_MS);
}

/** FAIL CLOSED on an instant that cannot be read: this runs inside a cron
 *  tick with no one watching, and the safe direction is not to text. */
export function tooCloseToAsk(now: Date, startsAt: Date): boolean {
  const lead = startsAt.getTime() - now.getTime();
  if (!Number.isFinite(lead)) return true;
  return lead <= APPOINTMENT_CONFIRM_MIN_LEAD_MS;
}
```

- [ ] **Step 4: Run it green**

```bash
pnpm --filter web exec vitest run src/lib/automations/appointment-confirm-gate.test.ts
```

Expected: `Test Files 1 passed`, `Tests 3 passed`. Then run each of the three prescribed mutations, confirm the named test reds, revert.

- [ ] **Step 5: The copy, tests first**

`apps/web/src/lib/automations/appointment-confirm-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { appointmentConfirmLead, composeAppointmentConfirm } from "./appointment-confirm-copy";

const WHEN = "Wed, Sep 30, 12:30 PM CDT";

describe("the confirmation ask's copy", () => {
  it("names the brand, states the time, and asks for YES or NO", () => {
    const lead = appointmentConfirmLead("Rio Roofing", WHEN);
    expect(lead).toContain("Rio Roofing");
    expect(lead).toContain(WHEN);
    expect(lead).toContain("YES");
    expect(lead).toContain("NO");
  });

  it("CARRIES THE REASSURANCE, because there is no text back", () => {
    // Spec decision 6: a YES gets no reply. The customer's certainty is
    // bought here, in the ask, or not at all — so this clause is structural,
    // not a default an operator can delete. Mutation: remove "either way
    // we'll see it" from messages.ts → this test goes red BY NAME.
    expect(appointmentConfirmLead("Rio Roofing", WHEN).toLowerCase()).toContain("either way we'll see it");
    expect(appointmentConfirmLead("", WHEN).toLowerCase()).toContain("either way we'll see it");
  });

  it("drops the naming clause when there is no brand name, and never invents a noun", () => {
    // EXACT EQUALITY against the no-name template, not a bag of
    // `not.toContain`s. The first draft asserted
    // `not.toMatch(/\bus\b.*booked/i)`, which cannot fail: neither template
    // contains the word "us". This one reds the moment the blank-name
    // branch is deleted, because the with-name template then renders as
    // "Hi, it's    . You're booked for …".
    // Mutation: delete the `brandName.trim() ?` branch → red BY NAME.
    expect(appointmentConfirmLead("   ", WHEN))
      .toBe(m["automations.appointmentConfirm.leadNoName"].replace("{when}", WHEN));
    expect(appointmentConfirmLead("   ", WHEN)).not.toContain("undefined");
  });

  it("survives a company name containing a String.replace special", () => {
    // Function replacement, not a plain string: "$&" would otherwise be
    // re-interpreted. Mutation: drop the arrow function in the .replace call.
    expect(appointmentConfirmLead("A $& B", WHEN)).toContain("A $& B");
  });

  it("composes lead + the operator's optional closing line, and nothing when there is none", () => {
    expect(composeAppointmentConfirm("Rio Roofing", WHEN, "  Parking is out front.  "))
      .toBe(`${appointmentConfirmLead("Rio Roofing", WHEN)} Parking is out front.`);
    expect(composeAppointmentConfirm("Rio Roofing", WHEN, "   "))
      .toBe(appointmentConfirmLead("Rio Roofing", WHEN));
  });

  it("carries no internal milestone code and no template syntax", () => {
    const all = [appointmentConfirmLead("Rio Roofing", WHEN), composeAppointmentConfirm("Rio Roofing", WHEN, "x")];
    for (const s of all) {
      expect(s).not.toMatch(/\bM[0-9][a-z]?\b/);
      expect(s).not.toContain("{{");
    }
  });
});
```

Run: `pnpm --filter web exec vitest run src/lib/automations/appointment-confirm-copy.test.ts`. Expected FAIL on the missing module.

- [ ] **Step 6: The copy module and its message keys**

`apps/web/src/lib/messages.ts`, appended under the `automations.` namespace (a registry: add lines, never reorder, never touch another namespace):

```ts
  "automations.appointmentConfirm.lead": "Hi, it's {name}. You're booked for {when}. Reply YES to confirm or NO if you need a different time. Either way we'll see it.",
  "automations.appointmentConfirm.leadNoName": "You're booked for {when}. Reply YES to confirm or NO if you need a different time. Either way we'll see it.",
  "automations.appointmentConfirm.title": "Appointment confirmations",
  "automations.appointmentConfirm.body": "Two days before an appointment, text the customer to confirm. They reply YES or NO and you see the answer on the booking. Nothing is cancelled automatically. Text only. Off until you turn it on.",
  "automations.appointmentConfirm.enabled": "Ask customers to confirm",
  "automations.appointmentConfirm.message": "Closing line",
  "automations.appointmentConfirm.messageHint": "Optional. Comes after the confirmation question. Leave blank to send just the question.",
  "automations.appointmentConfirm.preview": "Preview",
  "automations.appointmentConfirm.save": "Save appointment confirmations",
  "automations.appointmentConfirm.saved": "Appointment confirmations saved",
  "automations.appointmentConfirm.saveFailed": "Could not save appointment confirmations.",
  "calendar.bookings.confirmed": "Confirmed by text",
  "calendar.bookings.confirmDeclined": "Asked for a different time",
```

`apps/web/src/lib/automations/appointment-confirm-copy.ts`:

```ts
import { m } from "@/lib/messages";

/**
 * The confirmation ask's LEAD: the brand, the appointment time (formatWhen,
 * in the BOOKER's zone — the email reminder's rule), the question, and the
 * reassurance, inside a fixed sentence the operator cannot rearrange.
 *
 * WHY IT IS FIXED. Spec decision 6: a YES gets no text back — a second
 * outbound per confirmation costs a message, risks a loop against the
 * carrier's own STOP handling, and would make the inbound webhook a sender
 * rather than a recorder. But a customer who replies YES into silence does
 * not know it worked, and this recipe exists to cut no-shows, so the
 * certainty is written into the ask instead: "either way we'll see it". If
 * that clause lived in the operator's editable body, the copy test asserting
 * it would be asserting a default anyone can delete — a guarantee the product
 * would not actually have. So the operator's field is a CLOSING line, exactly
 * as the text reminder's is (sms-reminder-copy.ts).
 *
 * `brandName` is the customer-facing name (the due-row carries only that); a
 * blank one drops the clause rather than inventing a noun. Function
 * replacement, not a plain string, for names containing `$&`.
 */
export function appointmentConfirmLead(brandName: string, whenText: string): string {
  const template = brandName.trim()
    ? m["automations.appointmentConfirm.lead"].replace("{name}", () => brandName)
    : m["automations.appointmentConfirm.leadNoName"];
  return template.replace("{when}", () => whenText);
}

/**
 * THE ONE composer: the lead, one space, the operator's optional closing
 * line. The settings page's segment counter and the pass both call this with
 * the same inputs, so the count the operator approves is the count that is
 * billed — the preview-vs-send drift fixed twice on 2026-09-06 cannot recur.
 */
export function composeAppointmentConfirm(brandName: string, whenText: string, body: string): string {
  return [appointmentConfirmLead(brandName, whenText), body.trim()].filter(Boolean).join(" ");
}
```

Run the copy test: expected `Tests 6 passed`. Then the prescribed mutations, each reverted.

- [ ] **Step 7: Register the source — and let the compiler do the bookkeeping**

`packages/db/src/automation-log.ts:10`, append ONE value:

```ts
export const AUTOMATION_LOG_SOURCES = [
  "reminders", "followups", "review_request", "no_show_nudge", "sms_reminder",
  "instant_reply", "weekly_report", "concierge", "voice",
  "appointment_confirm",
] as const;
```

```bash
pnpm --filter web typecheck
```

Expected: TWO errors, and they are the point of this step — paste both into the report:

```
src/lib/automations/log-titles.ts(7,14): error TS2741: Property 'appointment_confirm' is missing in type '{ reminders: string; ... }' but required in type 'Record<AutomationLogSource, string>'.
src/lib/automations/passes/release-held.ts(67,14): error TS2741: Property 'appointment_confirm' is missing in type '{ ... }' but required in type 'Record<AutomationLogSource, Releaser | null>'.
```

**This is the registry's bookkeeping and it is not to be silenced.** Do NOT widen either map to `Partial<…>`, do not add an index signature, do not cast. Both get a real entry below. A source that can be logged but has no releaser parks a held row forever; a source with no title renders its KEY on a client's screen.

- [ ] **Step 7a: `caps.ts` names the exemption — spec decision 2's closing obligation**

Decision 2 ends "`caps.ts`'s doc comment grows to name it", and no step owned that until now. **Comments only; no constant changes in this file in this task** (`REACTIVATION_DAILY_CAP` belongs to Task 8).

`apps/web/src/lib/automations/caps.ts:2-5` — the file's opening doc comment currently reads "they apply to RECIPE passes only — the reminder and follow-up passes are uncapped". Amend to:

```ts
 * FIXED platform constants (danlo, 2026-09-06), and they apply to RECIPE
 * passes only — the reminder and follow-up passes are uncapped (see their doc
 * comments: a reminder is one-to-one with a booking the customer made, and a
 * daily cap would drop reminders for a busy client), and since part B so is
 * `appointment_confirm`, the THIRD uncapped pass and the first RECIPE to be
 * one (spec decision 2): it is keyed on `starts_at` inside a 75-minute
 * window, so no status change and no import can burst it, and a fully-booked
 * Saturday would otherwise leave five customers unasked.
```

**THIRD, not second.** The two lines directly above it already record the reminder and follow-up passes as uncapped, so `appointment_confirm` is the third — the plan's own File Structure line said "second" and was wrong.

`apps/web/src/lib/automations/caps.ts:34-40` — the `SMS_RETRY_COOLDOWN_MS` comment's "THE TEXT REMINDER IS EXEMPT" paragraph gains its second exempt pass, in the same words and for the same measured reason:

```ts
 * THE TEXT REMINDER IS EXEMPT (danlo, 2026-09-07, from Milestone B's
 * review): its window is 45 minutes — three ticks — so a 24h hold outlived
 * the window and meant ONE attempt ever; a single carrier blip cost the
 * customer their reminder. That pass still writes its attempt marker but
 * never reads it back; the window itself bounds it to three attempts and
 * three failed rows, which is the pile-up this hold exists to prevent.
 * THE CONFIRMATION ASK IS EXEMPT TOO (part B), for the identical reason at a
 * different width: its window is 75 minutes — five ticks — so the same 24h
 * hold would again mean one attempt ever. It writes `confirm_sms_failed_at`
 * and never reads it back.
```

There is no test to write here: `messages.test.ts` does not read comments and nothing else can. The proof is that Step 14's full run stays green and the diff is two comment hunks — say so in the report rather than claiming a red.

- [ ] **Step 8: The pass — tests first**

`apps/web/src/lib/automations/passes/appointment-confirm.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueAppointmentConfirm, AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueAppointmentConfirms: vi.fn(), getDueAppointmentConfirmById: vi.fn(),
  stampAppointmentConfirmAsked: vi.fn(), stampAppointmentConfirmSmsFailed: vi.fn(),
  ensureConversation: vi.fn(async () => ({ id: "cv_1" })),
  createMessage: vi.fn(async () => ({ id: "msg_1" })),
  updateMessageStatus: vi.fn(),
  recordAutomationLog: vi.fn(),
  // holdOrSend reads this BEFORE re-writing a held row. A factory mock that
  // omits it throws at the moment the export is read — part C's recorded trap.
  getAutomationLogEntry: vi.fn(async () => null),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const gate = vi.fn(async () => ({ ok: true as const, from: "+19565550000" }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => gate(...(a as [])) }));

import type { PassContext } from "../context";
import { appointmentConfirmPass, releaseAppointmentConfirm } from "./appointment-confirm";

const TICK = new Date("2027-04-12T12:00:00.000Z");
const ON = { enabled: true, start: "21:00", end: "08:00" };
const OFF = { enabled: false, start: "21:00", end: "08:00" };
const send = vi.fn(async (_msg: { to: string; from: string; body: string }) => ({ providerMessageId: "sm_1" }));
// The parameter is DECLARED, not inferred: `vi.fn(async () => …)` gives
// `mock.calls` a zero-length tuple, and the `send.mock.calls[0]![0].body` read
// below is then TS2532 + TS2493. Declaring it keeps that line cast-free.

function ctx(over: Partial<PassContext> = {}): PassContext {
  return {
    db: {} as PassContext["db"], now: TICK, origin: "https://app.example",
    email: { isFake: true, send: vi.fn() } as unknown as PassContext["email"],
    sms: () => ({ isFake: true, send }) as unknown as ReturnType<PassContext["sms"]>,
    quiet: async () => OFF,
    ...over,
  };
}

function row(over: Partial<DueAppointmentConfirm> = {}): DueAppointmentConfirm {
  return {
    bookingId: "bk_1", accountId: "acct_1",
    startsAt: new Date(TICK.getTime() + 47 * 3600_000).toISOString(),
    bookerTimezone: "America/Chicago", contactId: "ct_1", contactPhone: "(956) 555-0107",
    brandName: "Rio Roofing", accountTimezone: "America/Chicago", body: "",
    ...over,
  };
}

function heldRow(over: Partial<AutomationLogRow> = {}): AutomationLogRow {
  return {
    id: "log_1", account_id: "acct_1", source: "appointment_confirm", channel: "sms",
    contact_id: "ct_1", subject_key: "booking:bk_1", status: "held", reason: "",
    held_until: TICK.toISOString(), payload: {}, occurred_at: TICK.toISOString(),
    ...over,
  } as AutomationLogRow;
}

beforeEach(() => { vi.clearAllMocks(); gate.mockResolvedValue({ ok: true, from: "+19565550000" }); });

describe("the confirmation ask sends", () => {
  it("texts, stamps, and writes ONE sent log row", async () => {
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row()]);
    const c = await appointmentConfirmPass.run(ctx());
    expect(c).toEqual({ sent: 1, failed: 0, unstamped: 0, held: 0, skippedNoAddress: 0, skippedSmsGate: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampAppointmentConfirmAsked).toHaveBeenCalledWith(expect.anything(), "bk_1");
    const body = send.mock.calls[0]![0].body as string;
    expect(body).toContain("Rio Roofing");
    expect(body.toLowerCase()).toContain("either way we'll see it");
    // The company's INTERNAL label can never reach a customer: the due-row
    // has no field for it. sentinel.test.ts scans every send argument.
    expect(body).not.toContain("trial");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "appointment_confirm", channel: "sms", subjectKey: "booking:bk_1", status: "sent",
    }));
  });

  it("skips and LOGS when there is no textable phone, and never falls back to email", async () => {
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row({ contactPhone: null })]);
    const c = await appointmentConfirmPass.run(ctx());
    expect(c.skippedNoAddress).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "No phone number we can text",
    }));
  });

  it("skips and LOGS when the account cannot text", async () => {
    gate.mockResolvedValue({ ok: false, reason: "a2p_not_approved" } as never);
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row()]);
    const c = await appointmentConfirmPass.run(ctx());
    expect(c.skippedSmsGate).toBe(1);
    expect(dbMocks.stampAppointmentConfirmAsked).not.toHaveBeenCalled();
  });
});

describe("the confirmation ask and quiet hours", () => {
  it("inside the window it HOLDS: no send, no stamp, one held row with the window's end", async () => {
    dbMocks.listDueAppointmentConfirms.mockResolvedValue([row()]);
    // 02:00 Chicago on the tick date — inside the default 21:00–08:00 window.
    const night = new Date("2027-04-12T07:00:00.000Z");
    const c = await appointmentConfirmPass.run(ctx({ now: night, quiet: async () => ON }));
    expect(c.held).toBe(1);
    expect(c.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();                          // Mutation: bypass holdOrSend → this reds
    expect(dbMocks.stampAppointmentConfirmAsked).not.toHaveBeenCalled();
    const write = dbMocks.recordAutomationLog.mock.calls.at(-1)![1] as { status: string; heldUntil: string };
    expect(write.status).toBe("held");
    expect(new Date(write.heldUntil).toISOString()).toBe("2027-04-12T13:00:00.000Z");  // 08:00 CDT
  });
});

describe("releasing a held confirmation ask", () => {
  it("re-reads the booking and sends", async () => {
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({ due: row() });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a released row whose account does not match the subject NEVER sends", async () => {
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({ due: row({ accountId: "acct_other" }) });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    // Mutation: delete the `found.due.accountId !== row.account_id` line → reds.
  });

  it("a released row now INSIDE the reminder's own eligibility is skipped with its own reason, never texted", async () => {
    // 24h14m out: ONE MINUTE inside the 24h15m lead. Not "next hour" — a
    // fixture far past the bound would pass against any lead value. Written
    // as a literal rather than `APPOINTMENT_CONFIRM_MIN_LEAD_MS - 60_000`,
    // so moving the constant moves this case's verdict instead of dragging
    // the fixture along with it.
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({
      due: row({ startsAt: new Date(TICK.getTime() + 24 * 3600_000 + 14 * 60_000).toISOString() }),
    });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "Too close to the appointment to ask",
    }));
    // Mutation: delete the tooCloseToAsk branch from the releaser → reds, and
    // the row would have been texted in the same quarter hour as the email
    // reminder for an appointment it was meant to precede by two days.
  });

  it("a released row still 24h16m out DOES send — the boundary from the other side", async () => {
    // One minute OUTSIDE the lead, the mirror of the case above. Together
    // they pin 24h15m from both sides: move the constant either way and one
    // of the two reds.
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({
      due: row({ startsAt: new Date(TICK.getTime() + 24 * 3600_000 + 16 * 60_000).toISOString() }),
    });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("sent");
  });

  it("a released row whose recipe was switched off says so", async () => {
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "This automation was turned off",
    }));
  });

  it("a released row whose booking is GONE says that instead — the other arm of the same ternary", async () => {
    // Both arms, or the ternary is half-tested: with only the "off" case
    // above, swapping `found.why === "off" ? REASONS.recipeOff :
    // REASONS.noLongerDue` to its opposite reds one case and leaves this
    // reading correct by accident. The two reasons are different SENTENCES
    // on a client's Activity page, not two spellings of the same thing.
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({ due: null, why: "gone" });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "No longer due",
    }));
    // Mutation: swap the ternary's arms → this case AND the one above red.
  });
});
```

Run it: expected FAIL on the missing `./appointment-confirm` module.

- [ ] **Step 9: Write the pass**

`apps/web/src/lib/automations/hold-or-send.ts` — add ONE key inside `REASONS` (additive; touch no other line):

```ts
  /** The confirmation ask, released after a long hold into the window in
   *  which the email reminder is already eligible (24h15m out,
   *  REMINDER_WINDOW_END_MS). Sending "can you confirm?" in the same quarter
   *  hour as "here's your reminder" is ONE TEXT AND ONE EMAIL landing
   *  together, asking the customer for the same thing twice. */
  tooCloseToAppointment: "Too close to the appointment to ask",
```

`apps/web/src/lib/automations/passes/appointment-confirm.ts`:

```ts
import {
  listDueAppointmentConfirms, getDueAppointmentConfirmById,
  stampAppointmentConfirmAsked, stampAppointmentConfirmSmsFailed,
  type DueAppointmentConfirm,
} from "@bis/db";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { appointmentConfirmDeadline, tooCloseToAsk } from "../appointment-confirm-gate";
import { composeAppointmentConfirm } from "../appointment-confirm-copy";
import { sendAutomationSms, markAutomationSmsSent } from "../send-sms";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

/**
 * The confirmation ask, two days before the appointment — part B's first
 * recipe and the one that fires on every booking a client already takes.
 *
 * NO MORNING GATE: the window IS the moment (listDueAppointmentConfirms,
 * 47h–48h15m), and quiet hours already holds a 6 AM send until 08:00. Per row:
 *   no textable phone → SMS gate refused (skip and count; there IS no other
 *   channel — "Reply YES" in an email points at a no-reply address) →
 *   holdOrSend(send → STAMP → mark the message row sent).
 *
 * UNCAPPED, the first recipe that is (spec decision 2). The cap is a burst
 * guard against a bug or a bulk status change (caps.ts); this pass is keyed on
 * `starts_at` inside a 75-minute window, so no status change and no import can
 * burst it — and a fully-booked Saturday would otherwise leave five customers
 * unasked. Consistency that drops a real customer's text is not a rule worth
 * keeping.
 *
 * NO 24h COOLDOWN either, for the text reminder's recorded reason
 * (SMS_RETRY_COOLDOWN_MS in caps.ts): the window is 75 minutes — five ticks —
 * so a hold that outlived it would mean ONE attempt ever. The failed attempt
 * marker is still written, so the operator can see it; this pass never reads
 * it back.
 *
 * THE DEADLINE. The subject carries `starts_at − 24h15m`: at or before the
 * quiet window's end, holdOrSend sends now rather than holding past
 * usefulness. 24h15m and not a flat 24h because that is the instant the
 * EMAIL reminder becomes eligible (REMINDER_WINDOW_END_MS, booking.ts:384)
 * — the collision is one text and one email, not two texts; the SMS
 * reminder's own window is 90–135 minutes and never meets this. The deadline
 * is reachable only under a quiet window of nearly 23 hours (the ask is due
 * two days out), and it is declared because the rule is "never hold
 * something past the point it helps". What actually bites is
 * `releaseAppointmentConfirm`'s own `tooCloseToAsk` re-check.
 *
 * The time is rendered in the BOOKER's zone (safeZone, the email reminder's
 * rule), so a Los Angeles booker of a Texas company reads their own clock.
 */
export const appointmentConfirmPass: Pass = {
  key: "appointmentConfirms",
  async run(ctx) {
    return processAppointmentConfirms(ctx, await listDueAppointmentConfirms(ctx.db, ctx.now.toISOString()));
  },
};

export type AppointmentConfirmCounters = {
  sent: number; failed: number; unstamped: number; held: number;
  skippedNoAddress: number; skippedSmsGate: number;
};

/** No `ProcessOptions`: this recipe has no morning band, so a release has
 *  nothing to skip. `releaseSmsReminder` is the precedent. */
function subjectFor(r: DueAppointmentConfirm): HoldSubject {
  return {
    accountId: r.accountId, accountTimezone: r.accountTimezone,
    source: "appointment_confirm", channel: "sms",
    subjectKey: `booking:${r.bookingId}`, contactId: r.contactId,
    deadline: appointmentConfirmDeadline(new Date(r.startsAt)),
  };
}

export async function processAppointmentConfirms(
  ctx: PassContext, due: DueAppointmentConfirm[],
): Promise<AppointmentConfirmCounters> {
  const c: AppointmentConfirmCounters = {
    sent: 0, failed: 0, unstamped: 0, held: 0, skippedNoAddress: 0, skippedSmsGate: 0,
  };
  const smsGates = new Map<string, SmsGate>();

  for (const row of due) {
    const subject = subjectFor(row);
    const to = toE164(row.contactPhone);
    if (!to) {
      c.skippedNoAddress++;
      await logSkipped(ctx, subject, REASONS.noPhone);
      console.error(`appointment confirm skipped, no textable phone on file for booking ${row.bookingId}`);
      continue;
    }
    let gate = smsGates.get(row.accountId);
    if (!gate) {
      try {
        gate = await resolveSmsSender(ctx.db, row.accountId);
      } catch (e) {
        // A gate READ failure is this row's failure, not the pass's: letting
        // it escape would discard the counters for every row already sent.
        c.failed++;
        console.error(`appointment confirm: sms gate read failed for account ${row.accountId}: ${String(e)}`);
        continue;
      }
      smsGates.set(row.accountId, gate);
    }
    if (!gate.ok) {
      c.skippedSmsGate++;
      await logSkipped(ctx, subject, REASONS.smsGate);
      console.error(
        `appointment confirm skipped for booking ${row.bookingId}: account ${row.accountId} cannot text (${gate.reason})`,
      );
      continue;
    }
    const from = gate.from;

    try {
      // Inside the per-row try: a junk ACCOUNT zone makes formatWhen throw,
      // and that is this row's failure, not the pass's.
      const zone = safeZone(row.bookerTimezone ?? undefined, row.accountTimezone);
      const body = composeAppointmentConfirm(
        row.brandName, formatWhen(new Date(row.startsAt), zone), row.body);
      const outcome = await holdOrSend(ctx, subject, async () => {
        const smsRow = await sendAutomationSms(ctx, {
          accountId: row.accountId, contactId: row.contactId, to, from, body,
          onProviderFailure: () => stampAppointmentConfirmSmsFailed(ctx.db, row.bookingId),
        });
        // SEND-THEN-STAMP; the stamp before the row's status, as everywhere.
        const stamp = await stampWithRetry(() => stampAppointmentConfirmAsked(ctx.db, row.bookingId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `appointment confirm sent but NOT stamped for booking ${row.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 4 more copies before the window closes: ${String(stamp.lastError)}`,
          );
        }
        await markAutomationSmsSent(ctx, row.accountId, smsRow, "appointment confirm");
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`appointment confirm send failed for booking ${row.bookingId}: ${String(e)}`);
    }
  }

  return c;
}

export const releaseAppointmentConfirm: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueAppointmentConfirmById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  // The held row's key is not trusted across tenants: getDueAppointmentConfirmById
  // takes no account argument and runs service-role, so a mismatch never sends
  // and leaves the queue.
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  // Released after a long hold, now inside the email reminder's own lead: the
  // ask has stopped being useful. Written `skipped`, never left untouched — an
  // untouched released row keeps its past `held_until` and parks the head of
  // the queue forever.
  if (tooCloseToAsk(ctx.now, new Date(found.due.startsAt))) {
    await logSkipped(ctx, subjectOf(row), REASONS.tooCloseToAppointment);
    return "skipped";
  }
  return verdict(await processAppointmentConfirms(ctx, [found.due]));
};
```

- [ ] **Step 10: Registry, releaser, title, counters**

`apps/web/src/lib/automations/passes/release-held.ts` — one entry in `RELEASERS` plus the import:

```ts
import { releaseAppointmentConfirm } from "./appointment-confirm";
// …
  appointment_confirm: releaseAppointmentConfirm,
```

`apps/web/src/lib/automations/log-titles.ts` — one entry in `SOURCE_TITLES`:

```ts
  appointment_confirm: m["automations.appointmentConfirm.title"],
```

**And close the hole the type cannot.** `RELEASERS` is `Record<AutomationLogSource, Releaser | null>` (`release-held.ts:67`), so the compiler forces a KEY, not a function: `appointment_confirm: null` compiles, and every held row of that source would then be logged `skipped` "No longer due" (`release-held.ts:94-98`, the `if (!releaser)` branch; the reason string is `hold-or-send.ts:74`) and silently dropped. B1's one-source-at-a-time discipline is the only thing guarding it today, and discipline is not a test. Add ONE case to `apps/web/src/lib/automations/passes/release-held.test.ts` (import `RELEASERS` beside `releaseHeldPass` at `:17`):

```ts
it("only the three non-releasable sources map to null — every recipe source has a real releaser", () => {
  // Written as the list of NULLS, not the list of functions, so it never
  // needs to grow again: each of part B's four recipes is caught by this
  // case the moment its source is registered, whether or not anyone
  // remembers to come back here. A releaser left `null` type-checks and
  // then drops every held row of that source as "No longer due".
  const nulls = Object.entries(RELEASERS).filter(([, r]) => r === null).map(([k]) => k).sort();
  expect(nulls).toEqual(["concierge", "voice", "weekly_report"]);
});
```

> Mutation: set `appointment_confirm: null` in `RELEASERS` → this case reds by name (`expected [ 'appointment_confirm', 'concierge', 'voice', 'weekly_report' ] to deeply equal [ 'concierge', 'voice', 'weekly_report' ]`), and nothing else in the file moves. Tasks 6, 8 and 10 inherit the guard with no edit of their own.

`apps/web/src/lib/automations/registry.ts` — one import and one entry, AFTER `smsReminderPass` and before `siteTrafficPass`. Order is part of the contract; extend the file's own doc comment with one sentence:

```ts
import { appointmentConfirmPass } from "./passes/appointment-confirm";
// …
export const PASSES: readonly Pass[] = [releaseHeldPass, remindersPass, followupsPass, reviewRequestPass, noShowNudgePass, smsReminderPass, appointmentConfirmPass, siteTrafficPass, weeklyClientReportPass, weeklyAgencyReportPass];
```

> The confirmation ask reads nothing the other booking passes write and writes only its own stamp, so it sits with them rather than between them: after the text reminder, before the site-traffic pull.

**`sentinel.test.ts` PINS THAT ARRAY AS A LITERAL, and this step must update it.** `apps/web/src/lib/automations/sentinel.test.ts:157` (under the title at `:156`) is:

```ts
expect(PASSES.map((p) => p.key)).toEqual(["releaseHeld","reminders","followups","reviewRequests","noShowNudges","smsReminders","siteTraffic","weeklyClientReport","weeklyAgencyReport"]);
```

It is green today (run it and see). Adding a pass to `registry.ts` without touching it turns this file red, and the step's own "every file green, `sentinel.test.ts` included" would be a claim the step cannot meet. **The danger is not the red — it is an implementer "fixing" a literal order assertion by loosening it to `toContain` or a length check.** Insert `"appointmentConfirms"` at its position and amend the test's TITLE at `:156`, which names the order in prose ("…no-show nudges, text reminders, site traffic…"):

```ts
it("the registry runs the release pass, then reminders, follow-ups, review requests, no-show nudges, text reminders, appointment confirmations, site traffic, then the two weekly reports — the first three's order is the collision's contract", () => {
  expect(PASSES.map((p) => p.key)).toEqual(["releaseHeld","reminders","followups","reviewRequests","noShowNudges","smsReminders","appointmentConfirms","siteTraffic","weeklyClientReport","weeklyAgencyReport"]);
});
```

> Tasks 6, 8 and 10 each do the same for their own key. The array after Task 10 is
> `["releaseHeld","reminders","followups","reviewRequests","referralAsks","noShowNudges","smsReminders","appointmentConfirms","reactivations","quoteFollowups","siteTraffic","weeklyClientReport","weeklyAgencyReport"]`
> — `referralAsks` lands immediately after `reviewRequests` (the ladder's precedence), which is why Task 3's insert is not its final position and Task 6 moves nothing but adds one name.

`apps/web/src/app/api/cron/reminders/route.test.ts` — add the empty-counter literal beside its siblings, and into **every** expected body:

```ts
const EMPTY_APPOINTMENT_CONFIRMS = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedNoAddress: 0, skippedSmsGate: 0 };
```

> **Read that file before editing.** Two traps in it, both recorded in the file itself:
> 1. Its `vi.mock("@bis/db", () => ({…}))` FACTORY (`route.test.ts:15-69`) throws on an export it does not define, at the moment the export is read, and its own comment at `:25-27` says how this went wrong twice: "Registering a pass and NOT mocking its read here makes it `errored: 1` in this route's exact-equality body — which is how Tasks 7 and 8 broke this file: both scoped their gate to `src/lib/automations/` and never ran it." Add `listDueAppointmentConfirms`, `getDueAppointmentConfirmById`, `stampAppointmentConfirmAsked` and `stampAppointmentConfirmSmsFailed` to it, and copy the pass key `appointmentConfirms` exactly.
> 2. **"Into the expected JSON body" is SEVEN bodies, not one.** The file carries seven exact-equality expectations that enumerate every pass key — `:253`, `:276`, `:299`, `:315`, `:408`, `:423-435` and `:459-471`. Miss one and it reds with no named expectation to explain why, which is a bad half-hour. `grep -n EMPTY_SMS_REMINDERS` returns eight lines: the declaration at `:185` and those seven. Put the new literal beside every one of the seven.

`apps/web/src/lib/automations/sentinel.test.ts` — add `listDueAppointmentConfirms: vi.fn(), getDueAppointmentConfirmById: vi.fn(), stampAppointmentConfirmAsked: vi.fn(), stampAppointmentConfirmSmsFailed: vi.fn()` to its `dbMocks` block (`sentinel.test.ts:16-33`), and one due-row returning the internal label nowhere — the absence pin at the bottom of its first describe extends to `DueAppointmentConfirm`.

> **And give `listDueAppointmentConfirms` an explicit resolved value in that file's `beforeEach`.** `sentinel.test.ts:69` is `for (const fn of Object.values(dbMocks)) fn.mockReset().mockResolvedValue(undefined);`, which resets EVERY mock to `undefined` — so a due-list left at the default hands `undefined` to `processAppointmentConfirms`, the `for…of` throws, and the harness reports the pass as `errored` rather than failing on anything you wrote. The existing lines at `:70-71` (`listDueReminders`, `listDueFollowups`) are the model; add
> `dbMocks.listDueAppointmentConfirms.mockResolvedValue([CONFIRM_ROW]);` beside them, with `CONFIRM_ROW` a `DueAppointmentConfirm` carrying `brandName: BRAND` and no internal label anywhere.

- [ ] **Step 11: The schedule coupling**

`apps/web/src/lib/automations/cron-coupling.test.ts` — extend the import and add two cases:

`REMINDER_WINDOW_END_MS` is already in that file's `@bis/db` import (`cron-coupling.test.ts:4`); add `APPOINTMENT_CONFIRM_WINDOW_START_MS`, `APPOINTMENT_CONFIRM_WINDOW_END_MS` and `APPOINTMENT_CONFIRM_MIN_LEAD_MS` beside it.

```ts
it("the appointment-confirm window is wider than one tick, and asks two days out", () => {
  const tick = tickIntervalMs(entry!.schedule);
  expect(APPOINTMENT_CONFIRM_WINDOW_END_MS - APPOINTMENT_CONFIRM_WINDOW_START_MS).toBeGreaterThan(tick);
  expect(APPOINTMENT_CONFIRM_WINDOW_START_MS).toBe(47 * 60 * MINUTE);
  expect(APPOINTMENT_CONFIRM_WINDOW_END_MS).toBe(48 * 60 * MINUTE + 15 * MINUTE);
  // Mutation: move the window start to 46h without touching vercel.json → red.
});

it("the confirmation ask stops at the instant the email reminder becomes eligible", () => {
  // ONE TEXT AND ONE EMAIL in the same quarter hour — "can you confirm?" and
  // "here's your reminder" — is the collision this bound exists to prevent.
  // NOT two texts: the SMS reminder's window is 90–135 minutes and can never
  // meet a lead measured in days.
  //
  // `>= REMINDER_WINDOW_END_MS`, never `>= REMINDER_WINDOW_START_MS`. The
  // email reminder's due window is [now+23h, now+24h15m] and a booking first
  // MATCHES it when its lead is 24h15m — the window's CLOSE is where the
  // reminder OPENS. Comparing against the START would have passed with a
  // flat 24h lead and left a fifteen-minute band where both are due; that is
  // the bug this case was rewritten to catch.
  expect(APPOINTMENT_CONFIRM_MIN_LEAD_MS).toBe(24 * 60 * MINUTE + 15 * MINUTE);
  expect(APPOINTMENT_CONFIRM_MIN_LEAD_MS).toBeGreaterThanOrEqual(REMINDER_WINDOW_END_MS);
});
```

Two mutations for that second case, and they red different halves — run both:
- set `APPOINTMENT_CONFIRM_MIN_LEAD_MS` back to a flat `24 * 60 * 60 * 1000`: **both** assertions red (the literal AND the coupling). Named in the table below.
- widen `REMINDER_WINDOW_END_MS` to 25h in `packages/db/src/booking.ts` and leave the lead alone: **only the second assertion** reds, which is the drift this case exists for. Verified safe to run: `REMINDER_WINDOW_END_MS` appears nowhere else in `apps/web/src` but this file, and the existing case above it asserts only `END − START > tick` (2h > 15m), so it stays green. Revert immediately — it is a `packages/db` edit.

> **Why the constant is not simply `= REMINDER_WINDOW_END_MS`.** Derived, the `>=` could never fail and this case would be decoration. `REVIEW_REQUEST_MAX_AGE_MS` (`automations.ts:158`, a literal 61h) is pinned to `FOLLOWUP_MAX_AGE_MS + 24h` the same way, by this same file, for this same reason.

- [ ] **Step 12: The card**

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/appointment-confirm-card.tsx` — the `SmsReminderCard` shape (`sms-reminder-card.tsx`): a form with a Save button, `useFormSubmit` + `notifyActionResult` + `SubmitButton`, the segment counter computed through the SAME composer the pass uses, and the SMS-gate notice.

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AutomationRow } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { AUTOMATION_BODY_MAX_LENGTH } from "@/lib/automations/caps";
import { composeAppointmentConfirm } from "@/lib/automations/appointment-confirm-copy";
import { SMS_REMINDER_PREVIEW_INSTANT } from "@/lib/automations/sms-reminder-copy";
import type { ActionResult } from "./actions";

export function AppointmentConfirmCard({
  automation, brandName, accountTimezone, smsGate, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx). */
  brandName: string;
  accountTimezone: string;
  smsGate: SmsGate;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [body, setBody] = useState(automation?.body ?? "");

  // The FIXED preview instant the text reminder already uses — chosen at the
  // widest common width formatWhen produces, so the count the operator
  // approves is not optimistic and does not drift day to day. Reused rather
  // than copied: two preview instants would be two things to keep in step.
  const when = formatWhen(SMS_REMINDER_PREVIEW_INSTANT, safeZone(accountTimezone, "UTC"));
  const previewText = composeAppointmentConfirm(brandName, when, body);
  const preview = segmentsFor(previewText);

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.appointmentConfirm.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="appointment-confirm-card">
      <CardHeader>
        <CardTitle>{m["automations.appointmentConfirm.title"]}</CardTitle>
        <CardDescription>{m["automations.appointmentConfirm.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="confirm-enabled" name="enabled" defaultChecked={automation?.enabled ?? false} />
            <Label htmlFor="confirm-enabled">{m["automations.appointmentConfirm.enabled"]}</Label>
          </div>
          {!smsGate.ok ? (
            <p className="text-xs text-muted-foreground">
              {smsGate.reason === "a2p_not_approved"
                ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="confirm-body">{m["automations.appointmentConfirm.message"]}</Label>
            <Textarea
              id="confirm-body" name="body" rows={2} maxLength={AUTOMATION_BODY_MAX_LENGTH} value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.appointmentConfirm.messageHint"]}</p>
          </div>

          {/* The preview is `SmsReminderCard`'s block verbatim
              (sms-reminder-card.tsx:80-88), not a bare <p>: a <Label htmlFor>
              plus an <output id> is what NAMES the preview to a screen
              reader and makes it a live region, and the --input-line /
              --input-bg box is what makes it read as the text it will
              become. Two cards side by side must not render the same idea
              two ways. */}
          <div className="space-y-1.5">
            <Label htmlFor="confirm-preview">{m["automations.appointmentConfirm.preview"]}</Label>
            <output
              id="confirm-preview"
              className="block rounded-[8px] border border-[var(--input-line)] bg-[var(--input-bg)] px-3 py-2 text-[13px]"
              data-testid="appointment-confirm-preview"
            >{previewText}</output>
            <p className="text-xs text-muted-foreground" data-testid="appointment-confirm-sms-count">
              {m["compose.smsSegments"]
                .replace("{chars}", String(preview.chars))
                .replace("{segments}", String(preview.segments))}
            </p>
          </div>

          <SubmitButton pending={pending}>{m["automations.appointmentConfirm.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 13: The action and the page**

`…/automations/actions.ts`, appended after `saveSmsReminderAction` (agency-gated, `serviceDb()`, the same shape):

```ts
export async function saveAppointmentConfirmAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const enabled = formData.get("enabled") === "on";
  const body = String(formData.get("body") ?? "").trim();
  if (body.length > AUTOMATION_BODY_MAX_LENGTH) return { ok: false, error: m["automations.bodyTooLong"] };

  try {
    // Nothing to configure: the channel IS the recipe (a "Reply YES" email
    // points at a no-reply address), and the time is the booking's.
    await upsertAutomation(serviceDb(), accountId, "appointment_confirm", { enabled, body, config: {} }, userId);
  } catch (e) {
    console.error(`saveAppointmentConfirmAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.appointmentConfirm.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}
```

`…/automations/page.tsx` — one more `getAutomation` in the existing `Promise.all` (with the same `.catch` degrade and log line as its siblings), and the card rendered after `SmsReminderCard`:

```tsx
    getAutomation(db, accountId, "appointment_confirm").catch((e): AutomationRow | null => {
      console.error(`automations: appointment_confirm read failed for ${accountId}: ${String(e)}`);
      return null;
    }),
```

```tsx
        <AppointmentConfirmCard
          automation={appointmentConfirm}
          brandName={account.brandName}
          accountTimezone={account.timezone}
          smsGate={smsGate}
          saveAction={saveAppointmentConfirmAction.bind(null, accountId)}
        />
```

> The destructuring array at `page.tsx:48` (`const [review, noShow, smsReminder, instantReply, account, smsGate, calendar, origin, quiet] = await Promise.all([`) is positional. Add the new binding in the SAME position as the new promise, and re-read the whole array after editing — a positional mismatch here silently hands one card another's row.

`…/automations/actions.test.ts` — the agency gate case (a client call returns `{ ok: false, error: m["automations.agencyOnly"] }` and `upsertAutomation` is not called) and the body-length case, mirroring `saveSmsReminderAction`'s existing cases. That file uses `importOriginal` (`actions.test.ts:7-9`), so its `@bis/db` mock needs nothing added.

`…/automations/page.test.ts` — the card renders, and the degraded state when the read rejects. **Three edits that file needs before either case can run, and none of them is optional:**

1. **The `./actions` mock is a FACTORY** (`page.test.ts:43-49`, listing exactly `saveReviewRequestAction`, `saveNoShowNudgeAction`, `saveSmsReminderAction`, `saveInstantReplyAction`, `saveQuietHoursAction`). The moment `page.tsx` imports `saveAppointmentConfirmAction`, that factory throws on the missing export — the whole file errors, not one test. Add `saveAppointmentConfirmAction: async () => ({ ok: true }),` to it. (The `@bis/db` factory at `:25-38` needs nothing: this task adds no new `@bis/db` read to the page, only a fifth `getAutomation` call, and `getAutomation` is already defined there.)
2. **The card needs its own `vi.mock` and its own `captured` slot** — `captured` is a hoisted object at `:52-55` with one field per card (`review`, `noShow`, `sms`, `instant`, `quiet`); add `confirm: null as Props | null` and the matching `vi.mock("./appointment-confirm-card", …)` beside the others, or the render assertion has nothing to read.
3. **The comment at `page.test.ts:199` says "the four `getAutomation` calls"** and there will be five. A literal count in prose is still a literal count: update it in the same commit or it is wrong from this task onward.

- [ ] **Step 14: Run everything, mutate, commit**

```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run src/lib/automations src/app/api/cron "src/app/(dashboard)/dashboard/accounts/[accountId]/automations"
```

Expected: the summary block reports every file green, `sentinel.test.ts` included — and it is included only because Step 10 updated its literal `PASSES` array and its title. If that array was not touched, the red you are looking at is the one this step predicted; fix the array, never the assertion. Then, one at a time and each reverted:

| Mutation | Test that must red, BY NAME |
| --- | --- |
| remove `"either way we'll see it"` from `automations.appointmentConfirm.lead` | `CARRIES THE REASSURANCE, because there is no text back` |
| delete the `brandName.trim() ?` branch in `appointmentConfirmLead` | `drops the naming clause when there is no brand name, and never invents a noun` |
| `startsAt.getTime() + APPOINTMENT_CONFIRM_MIN_LEAD_MS` in `appointmentConfirmDeadline` | `is exactly 24 hours and 15 minutes before the appointment` |
| bypass `holdOrSend` and call `send()` directly | `inside the window it HOLDS: no send, no stamp, one held row with the window's end` |
| delete the `found.due.accountId !== row.account_id` branch | `a released row whose account does not match the subject NEVER sends` |
| delete the `tooCloseToAsk` branch from the releaser | `a released row now INSIDE the reminder's own eligibility is skipped with its own reason, never texted` |
| swap the arms of `found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue` | BOTH `a released row whose recipe was switched off says so` and `a released row whose booking is GONE says that instead — the other arm of the same ternary` |
| set `appointment_confirm: null` in `RELEASERS` | `only the three non-releasable sources map to null — every recipe source has a real releaser` |
| change `APPOINTMENT_CONFIRM_WINDOW_START_MS` to 46h | `the appointment-confirm window is wider than one tick, and asks two days out` |
| change `APPOINTMENT_CONFIRM_MIN_LEAD_MS` to a flat 24h | THREE red: `the confirmation ask stops at the instant the email reminder becomes eligible` (its FIRST assertion only — vitest stops a test at the first failure, so "both assertions red" is not observable in one run; the second is proven by the drift mutation below), `is exactly 24 hours and 15 minutes before the appointment`, and `a released row now INSIDE the reminder's own eligibility is skipped with its own reason, never texted`. **NOT the 24h16m case** — corrected 2026-09-22, proven by running it: at a flat 24h lead a 24h16m row is still OUTSIDE the bound and still sends, so it cannot red. THE GENERAL RULE Tasks 6, 8 and 10 must copy: for a bound-LOWERING mutation the case that reds is the one INSIDE the old bound, never the one outside it. |
| widen `REMINDER_WINDOW_END_MS` to 25h in `packages/db/src/booking.ts`, leaving the lead alone | `the confirmation ask stops at the instant the email reminder becomes eligible` — and ONLY its second assertion. This is the drift mutation; the one above cannot distinguish the two constants. Revert at once: it is an edit outside this task's files. |
| remove `"appointmentConfirms"` from `PASSES` | `the registry runs the release pass, then reminders, … — the first three's order is the collision's contract` (`sentinel.test.ts`) |
| delete `appointment_confirm` from `SOURCE_TITLES` | `pnpm --filter web typecheck`, TS2741 — paste it |

**Not mutable, and say so rather than inventing one:** Step 7a's `caps.ts` edit is two doc comments. Nothing in this repo reads a comment, so no mutation can red it. Its evidence is the diff plus this run staying green.

```bash
git add apps/web/src/lib/automations apps/web/src/app/api/cron/reminders/route.test.ts apps/web/src/lib/messages.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations" packages/db/src/automation-log.ts
git commit -m "automations(appointment_confirm): the two-day confirmation text, its card and its release path"
```

> `apps/web/src/lib/automations` covers `caps.ts`, `cron-coupling.test.ts`, `sentinel.test.ts`, `registry.ts`, `log-titles.ts`, `hold-or-send.ts` and `passes/release-held.ts` — every file Steps 7a, 9, 10 and 11 touch. Check `git status` before committing anyway: `-A` and `.` are forbidden here because another agent may be editing the same working tree.

---

### Task 4: The inbound webhook recognises a one-word answer (bis-comms; two hunks in bis-booking's files, named below)

This is the one genuinely new seam in part B. The inbound SMS route does no keyword handling at all today: it drops self-texts from `accounts.alert_phone`, dedupes on `payload.id`, then `createContact` → `ensureConversation` → `createMessage` → `incrementUnreadCount`, and nothing reads the body (`handleInbound`'s body is `route.ts:94-172`; the function closes at `:173`). `handleInbound` is the only place a reply can be recognised.

**What this task adds, exactly:** one `await` after `incrementUnreadCount`, in its own try/catch, calling Task 2's `applyConfirmationReply`.

**What it must NOT do, and each is a decision recorded in the spec:**
- **No send of any kind.** No reply-back, no `sendInstantReply`, no alert text. A YES gets silence and the ask's own "either way we'll see it" is what covers the customer (decision 6). A reply-back is a LATER DECISION, not a gap.
- **No change to `bookings.status`.** A NO records the answer and raises the unread count the message already raised; the operator cancels (decision 5, DESIGN.md rule 6).
- **No throw that escapes.** The route's outer catch (`route.ts:229-231`) logs `"unexpected failure handling webhook"` and **still returns `NextResponse.json({ ok: true })`** at `:232`, so an uncontained throw here reads to Telnyx as "handled" while the customer's whole message is discarded. This is the `getAlertPhone` containment pattern (the try/catch at `route.ts:124-128`, the guard it feeds at `:129-132`), and the message is not a nicety — the keyword recognition is.
- **No new event, no new table, no second scheduler.**

**Files:**
- Modify: `apps/web/src/app/api/sms/inbound/route.ts` (the `@bis/db` import at :27-31, and one block at the end of `handleInbound`, after `await incrementUnreadCount(db, accountId, conversation.id);` at **:172**)
- Modify: `apps/web/src/app/api/sms/inbound/route.test.ts`
- Modify: `packages/db/src/booking.ts` — **bis-booking's file.** `BookingRow` (anchor on the symbol, not a line — the range has drifted twice) and `BOOKING_COLS` (anchor on the symbol, not a line) gain `confirm_reply` and `confirm_reply_at`. Additive, two lines, no behaviour change.
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.tsx` — **bis-booking's file.** One status pill beside the status badge at :135.
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.test.ts` — that component has NO test today (the directory holds only `actions.test.ts` and `hours-form.test.ts`), so the pill's only coverage would otherwise be a reader's eye. Step 5 gives it.

**Interfaces:**
- Consumes: `applyConfirmationReply(db, accountId, contactId, text, now): Promise<"yes" | "no" | null>` from Task 2.
- Produces: nothing other agents import.

- [ ] **Step 1: Tests first**

Append to `apps/web/src/app/api/sms/inbound/route.test.ts`.

**What that file actually gives you, read off it rather than assumed** — an earlier draft of this step named six helpers "to use verbatim" and five of them do not exist:

- Its only request helper is **`post(body: object)`** at `:20-26`. It takes a WHOLE Telnyx envelope. There is no `inboundRequest`.
- There is no `ACCOUNT_ID`, no `CONTACT_ID`, no `OUR_NUMBER` and no `smsSend`. The account id every case uses is the literal `"acct_1"`, the contact id is `"contact_1"`, and the platform number is `"+15550000000"` — all inline.
- **`beforeEach` (`:28-39`) does NOT default `getPhoneNumberByE164`.** Every case that wants to reach `createMessage` sets it itself. Leave it unset and the route returns at `:95-97` ("a number this platform does not own or is not active") long before anything below, so the new cases would go red for a reason that has nothing to do with this task and would still be red after the code is written.
- `dbMocks` IS its name (`:4-14`), and its `vi.mock("@bis/db", () => dbMocks)` at `:16` is a FACTORY with no `importOriginal`: it throws on an export it does not define, at the moment the export is read. **Add `applyConfirmationReply: vi.fn(),` to that object.**

`:110-116` (the `records an inbound text from a known number` case) is the working setup to copy. A local helper keeps the five new cases from repeating it:

```ts
const OUR_NUMBER = "+15550000000";
const THEIR_NUMBER = "+19565550107";

/** The four mocks a message has to pass to reach the end of handleInbound,
 *  set exactly as `records an inbound text from a known number` (:110-116)
 *  sets them. Local to this describe: the file's own beforeEach deliberately
 *  leaves getPhoneNumberByE164 unset so the "unowned number" cases can use
 *  the default. */
function anOwnedNumberAndAKnownContact() {
  dbMocks.getPhoneNumberByE164.mockResolvedValue({
    id: "pn_1", account_id: "acct_1", e164: OUR_NUMBER, telnyx_id: null, status: "live",
  });
  dbMocks.createContact.mockResolvedValue({ id: "contact_1", existing: true });
  dbMocks.ensureConversation.mockResolvedValue({ id: "conv_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
}

const inbound = (text: string, from = THEIR_NUMBER) => post({
  data: {
    event_type: "message.received",
    payload: {
      id: `evt_${text.slice(0, 6)}`,
      to: [{ phone_number: OUR_NUMBER }], from: { phone_number: from }, text,
    },
  },
});

describe("an inbound text that is a one-word answer", () => {
  beforeEach(anOwnedNumberAndAKnownContact);

  it("records the answer AFTER the message is filed, and sends nothing", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue("yes");
    await POST(inbound("YES"));
    // Order matters: the customer's message is filed first, always.
    expect(dbMocks.createMessage).toHaveBeenCalled();
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalled();
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledWith(
      expect.anything(), "acct_1", "contact_1", "YES", expect.any(Date));
    // Mutation: move the call ABOVE createMessage → the order assertion below reds.
    const filedAt = dbMocks.createMessage.mock.invocationCallOrder[0]!;
    const answeredAt = dbMocks.applyConfirmationReply.mock.invocationCallOrder[0]!;
    expect(answeredAt).toBeGreaterThan(filedAt);
  });

  it("NEVER sends anything back — the route is a recorder", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue("yes");
    const res = await POST(inbound("yes"));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.createMessage.mock.calls[0]![2].direction).toBe("inbound");
    // THE ROUTE HAS NO SEND PATH AT ALL, which is exactly why there is no
    // `smsSend` spy in this file to assert against — so the assertion is on
    // the source, not on a mock that does not exist. `Object.keys(await
    // import(...))` would not be an assertion; this is.
    // Mutation: add any outbound send to handleInbound → red.
    const routeSource = readFileSync(
      new URL("./route.ts", import.meta.url), "utf8");
    expect(routeSource).not.toMatch(/getSmsProvider|sendSmsAction|sendAutomationSms|sendInstantReply/);
  });

  it("a failure recording the answer is CONTAINED — the customer's message is filed and the outer catch never sees it", async () => {
    // The containment is the whole point of this leg, and the ONLY thing
    // that proves it is WHICH log line came out. Dropping the try/catch
    // lets the rejection reach the route's outer catch at :229-231, which
    // logs and STILL returns `{ ok: true }` at :232 — by which time
    // createMessage (:160) and incrementUnreadCount (:172) have each run
    // once. So `res.status === 200` and both call counts of 1 stay TRUE
    // under the mutation: an earlier draft of this case asserted exactly
    // those three and could not fail.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.applyConfirmationReply.mockRejectedValue(new Error("db blip"));
    const res = await POST(inbound("no"));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalledTimes(1);

    const logged = spy.mock.calls.map((args) => args.join(" ")).join("\n");
    // Mutation: drop the try/catch around applyConfirmationReply → this pair
    // flips, and only this pair. The contained line disappears and the outer
    // catch's appears.
    expect(logged).toContain("could not record a confirmation reply");
    expect(logged).not.toContain("unexpected failure handling webhook");
    spy.mockRestore();
  });

  it("an ordinary message still goes through untouched", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue(null);
    await POST(inbound("can you come Tuesday instead?"));
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledTimes(1);   // it decides; the route does not pre-filter
  });

  it("a text from the account's own alert phone never reaches the matcher", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559999");
    await POST(inbound("yes", "+19565559999"));
    expect(dbMocks.applyConfirmationReply).not.toHaveBeenCalled();
    // Mutation: move the new block above the alert-phone guard → red.
  });
});
```

> Two mechanical notes. `readFileSync` and `import.meta.url` need `import { readFileSync } from "node:fs";` at the top of the file — `cron-coupling.test.ts:2` is the in-repo precedent for reading a source file from a test. And the `beforeEach(anOwnedNumberAndAKnownContact)` inside this `describe` runs AFTER the file's top-level `beforeEach` (`:28-39`), so `vi.clearAllMocks()` there cannot undo it.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter web exec vitest run src/app/api/sms/inbound/route.test.ts
```

Expected: FAIL, and check WHY before you believe it. **Do not string-match the quoted text below: it is from an OLDER vitest.** This repo runs vitest 4.1.10, which prints `expected "vi.fn()" to be called with arguments: [ Anything, 'acct_1', …(3) ]` — a different mock name and a truncated argument list. The reliable discriminator that you got the RIGHT red is whether the `createMessage` assertion two lines above PASSED, which is only possible if the route ran to the end of `handleInbound` instead of bailing at "a number this platform does not own". Also expect 3 of the 5 cases to red, not 5: the send-source scan and the alert-phone never-called assertion both pass before the implementation exists. The red you want is `applyConfirmationReply` never having been called — `AssertionError: expected "spy" to be called with arguments: [ Anything, 'acct_1', 'contact_1', 'YES', Any<Date> ] / Received: Number of calls: 0`. Paste that line.

The red you do NOT want, and which means the setup is wrong rather than the code missing, is `createMessage` at 0 calls too: that is the route returning early at `:95-97` because `getPhoneNumberByE164` resolved `undefined`. If you see it, the `describe`'s own `beforeEach` did not run — a red for the wrong reason is not evidence.

- [ ] **Step 3: The one block in the route**

`apps/web/src/app/api/sms/inbound/route.ts` — extend the `@bis/db` import at :27-31 with `applyConfirmationReply`, and append this at the end of `handleInbound`, immediately after `await incrementUnreadCount(db, accountId, conversation.id);`:

```ts
  // PART B: the appointment-confirmation answer. The ONE place in this
  // platform where an inbound text means something other than "a person
  // wrote in" — `appointment_confirm` asks "Reply YES to confirm or NO if
  // you need a different time", and this records what they said.
  //
  // CONTAINED ON PURPOSE, the getAlertPhone pattern above (:124-128). This
  // route's outer catch logs and still returns 200, so an uncontained throw
  // here is reported to Telnyx as "handled" while the customer's whole
  // message — already written above — would be the last thing that happened
  // before the failure. The message is the product; the keyword is a
  // convenience. A failed recognition therefore degrades to "nobody recorded
  // the answer", which the operator sees as an ordinary unread text saying
  // "yes". THE LOG LINE BELOW IS LOAD-BEARING: it is the only observable
  // difference between contained and uncontained, and route.test.ts asserts
  // on exactly it.
  //
  // AFTER incrementUnreadCount, never before: the answer is a fact ABOUT a
  // message that must already exist, and the operator's unread badge must
  // rise whether or not the word was recognised.
  //
  // It sends NOTHING. A second outbound per confirmation costs a message,
  // risks a loop against the carrier's own STOP handling, and would make this
  // webhook a sender rather than a recorder (spec decision 6). It changes no
  // booking STATUS either: a destructive action from one word in a text, with
  // no confirmation, is what DESIGN.md rule 6 forbids (decision 5).
  try {
    const answer = await applyConfirmationReply(db, accountId, contact.id, payload?.text ?? "", new Date());
    if (answer) log("recorded an appointment confirmation reply", accountId, contact.id, answer);
  } catch (e) {
    log("could not record a confirmation reply — the customer's message is filed regardless", accountId, String(e));
  }
```

- [ ] **Step 4: Run it green**

```bash
pnpm --filter web exec vitest run src/app/api/sms/inbound/route.test.ts
```

Expected: the summary block reports the file green. Run each prescribed mutation, confirm the named test reds, revert. The four for this task:

| Mutation | Test that must red, BY NAME |
| --- | --- |
| move the new block ABOVE `createMessage` | `records the answer AFTER the message is filed, and sends nothing` |
| drop the try/catch around `applyConfirmationReply` | `a failure recording the answer is CONTAINED — the customer's message is filed and the outer catch never sees it` (the log-line pair; the status and the two call counts all stay true, which is why they are not the evidence) |
| move the new block ABOVE the alert-phone guard | `a text from the account's own alert phone never reaches the matcher` |
| add any outbound send to `handleInbound` | `NEVER sends anything back — the route is a recorder` |

- [ ] **Step 5: The operator sees the answer (bis-booking's two files)**

> **ONE surface, and the spec names three (amendment B14).** Spec Recipe 2 ends "The booking drawer and the work queue show the answer." There is no booking drawer — `…/[accountId]/calendar/` contains `page.tsx`, `bookings-list.tsx`, `calendar-settings.tsx`, `embed-snippet.tsx`, `hours-form.ts` and `actions.ts`, and nothing else. And `staleBookings` (`packages/db/src/work-queue.ts:95-108`) projects `id, contact_id, ends_at` over bookings that are still `booked` with `ends_at` ALREADY PAST — a confirmation answer about an appointment that has finished is moot, and surfacing it there would be a change to that query, in `bis-booking`'s file, for no operator benefit. Build the badge below and nothing else; do not invent the other two.

`packages/db/src/booking.ts` — `BookingRow` (anchor on the symbol, not a line — the range has drifted twice) gains two fields and `BOOKING_COLS` (anchor on the symbol, not a line) gains the two names. Additive only; do not reorder the existing ones:

```ts
  /** 0047: the customer's own answer to the confirmation text, and when.
   *  Written by the inbound SMS webhook; it never changes `status`. */
  confirm_reply: "yes" | "no" | null;
  confirm_reply_at: string | null;
```

```ts
  "review_request_sms_failed_at, no_show_nudge_sms_failed_at, sms_reminder_failed_at, " +
  "confirm_reply, confirm_reply_at";
```

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.tsx` — beside the status badge at :135, **dot AND word** (DESIGN.md rule 3 — status is never colour alone), tokens only. A bare `<Badge variant="outline">` is a word with no dot and is not the house treatment; the house treatment is `log-titles.ts:25-30`'s `STATUS_TREATMENTS`, a 6px round `dot` span inside a `chip`-classed pill, which the Activity page and the Calls page already share:

```tsx
                        {b.confirm_reply ? (
                          <span
                            data-testid="booking-confirm-reply"
                            className={
                              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs "
                              + (b.confirm_reply === "yes"
                                ? "border-success/30 bg-success/10 text-foreground"
                                : "border-border bg-transparent text-muted-foreground")
                            }
                          >
                            <span
                              aria-hidden
                              className={
                                "size-1.5 rounded-full "
                                + (b.confirm_reply === "yes" ? "bg-success" : "bg-muted-foreground/60")
                              }
                            />
                            {b.confirm_reply === "yes"
                              ? m["calendar.bookings.confirmed"]
                              : m["calendar.bookings.confirmDeclined"]}
                          </span>
                        ) : null}
```

> The two colour pairs are `STATUS_TREATMENTS.sent` and `STATUS_TREATMENTS.skipped` verbatim, so the confirmation pill and the automation-history pills read as one system. Do not invent a third pair. If `bookings-list.tsx` has since grown a shared pill helper, use it and say so — the source wins.

The two message keys were added in Task 3, Step 6.

**The test file does not exist yet — CREATE `…/calendar/bookings-list.test.ts`.** That directory holds `actions.test.ts` and `hours-form.test.ts` and nothing that renders, and there is not a single `.test.tsx` in `apps/web/src`: the house way to render a component in a test here is `renderToStaticMarkup` inside a plain `.test.ts`, exactly as the automations `page.test.ts:83` does. `BookingsList` is `"use client"` and uses `useTransition`, which server-renders fine as `[false, noop]`. Its props are `{ accountId, timezone, bookings, statusAction }` with `bookings: (BookingRow & { contact_name: string; contact_email: string | null })[]` (`bookings-list.tsx:98-107`) and `statusAction` can be `async () => ({ ok: true })`.

```ts
const html = renderToStaticMarkup(
  BookingsList({ accountId: "a1", timezone: "America/Chicago", bookings: [answered], statusAction: async () => ({ ok: true }) }),
);
expect(html).toContain(m["calendar.bookings.confirmed"]);
// DOT AND WORD, never colour alone (DESIGN.md rule 3). Mutation: delete the
// aria-hidden dot span → this reds by name.
expect(html).toMatch(/data-testid="booking-confirm-reply"[\s\S]*?aria-hidden/);
```

and the same render with `confirm_reply: null` contains neither message. Mutation: render `b.confirm_reply` itself → the first assertion reds on the raw word `yes` appearing where a sentence belongs. **Add `bookings-list.test.ts` to this task's Files list when you create it**, and report whether `renderToStaticMarkup` on this component needed anything the automations page did not — if it does, that is a finding, not a reason to drop the test.

- [ ] **Step 6: Run the touched suites and commit**

```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run src/app/api/sms "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar"
pnpm --filter @bis/db typecheck
```

```bash
git add apps/web/src/app/api/sms/inbound packages/db/src/booking.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.tsx" "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.test.ts"
git commit -m "sms(inbound): recognise a one-word YES or NO and record it on the booking — no reply, no status change"
```

---

### Task 5: `referral_ask` — the data layer (bis-db-schema)

**Files:**
- Modify: `packages/db/src/automations.ts` (a new section; `RecipeKey` gains `"referral_ask"`)
- Modify: `packages/db/src/index.ts` (append names to the `./automations` list)
- Modify: `packages/db/src/test/automations.test.ts`
- Modify: `packages/db/src/test/due-by-id.test.ts` — **the house home for every `getDue*ById`**, which the File Structure promises four recipes' cases. Task 5 shipped WITHOUT it and its release path went unproven: `getDue*ById`'s `.is("<stamp>", null)` is the ONLY double-send guard, and a reviewer deleted it and watched the suite stay green — a held row stamped during the hold would come back as due and the customer would get a second text. Copy the block Task 2 landed at `due-by-id.test.ts:89-105`, and assert `toEqual({ due: null, why: … })` rather than `.due` alone: `why` picks between two different customer-facing sentences.

**Interfaces:**
- Produces:
  ```ts
  export const REFERRAL_ASK_MAX_AGE_MS: number;            // REVIEW_REQUEST_MAX_AGE_MS + 24h = 85h
  export type ReferralAskChannel = "email" | "sms";
  export type ReferralAskConfig = { channel: ReferralAskChannel };
  export function parseReferralAskConfig(raw: unknown): ReferralAskConfig | null;
  export type DueReferralAsk = {
    bookingId: string; accountId: string; endsAt: string; completedAt: string | null;
    followupSentAt: string | null; reviewRequestedAt: string | null; smsFailedAt: string | null;
    /** Whether THIS account has review_request switched on — the precedence input. */
    reviewRequestEnabled: boolean;
    contactId: string; contactEmail: string | null; contactPhone: string | null;
    brandName: string; branding: Branding; accountTimezone: string;
    fromEmail: string | null; replyToEmail: string | null;
    body: string; config: ReferralAskConfig | null;
  };
  export async function listDueReferralAsks(db: SupabaseClient, nowIso: string): Promise<DueReferralAsk[]>;
  export async function getDueReferralAskById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueReferralAsk>>;
  export async function stampReferralAsked(db: SupabaseClient, bookingId: string): Promise<void>;
  export async function stampReferralAskSmsFailed(db: SupabaseClient, bookingId: string): Promise<void>;
  export async function countReferralAsksSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number>;
  ```

- [ ] **Step 1: RED FIRST — the suppression walk, again**

Add the skeleton — **annotated, not implicit `any`**, because `packages/db` compiles under
`noImplicitAny` and an unannotated skeleton reds `typecheck` instead of the walk:

```ts
export async function listDueReferralAsks(
  db: SupabaseClient, nowIso: string,
): Promise<DueReferralAsk[]> { void db; void nowIso; return []; }
```

(with `DueReferralAsk` declared above it, per Step 2). Then run

```bash
pnpm --filter @bis/db exec vitest run src/__tests__/outbound-suppressed.test.ts > /tmp/supp-red-2.log 2>&1; echo "exit=$?" >> /tmp/supp-red-2.log
```

Expected: `expected [ 'automations.ts: listDueReferralAsks' ] to deeply equal []`. Paste it.

- [ ] **Step 2: Write the section**

`RecipeKey` at :15 grows by one:

```ts
export type RecipeKey =
  | "review_request" | "no_show_nudge" | "sms_reminder" | "instant_reply"
  | "appointment_confirm" | "referral_ask";
```

Append after the `appointment_confirm` section:

```ts
// ---------------------------------------------------------------------------
// Recipe: referral ask — the completed-job ladder's third rung (part B)
// ---------------------------------------------------------------------------

export type ReferralAskChannel = "email" | "sms";
export type ReferralAskConfig = { channel: ReferralAskChannel };

/** jsonb is untrusted on read AND write, the review request's contract.
 *  `null` means "treat as missing" and the pass sends nothing. There is
 *  deliberately NO url field: the referral ask asks for a NAME, never a
 *  rating, and a config with nowhere to put a link is how that stays true. */
export function parseReferralAskConfig(raw: unknown): ReferralAskConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { channel } = raw as Record<string, unknown>;
  if (channel !== "email" && channel !== "sms") return null;
  return { channel };
}

/**
 * The follow-up's 37h, plus one local day for the review request (61h), plus
 * one more for this. Day one "how did it go?", day two "would you leave a
 * review?", day three "know anyone else?" — each rung one strictly-later
 * local day than the last, so the ladder is a ladder and not a pile.
 * cron-coupling.test.ts pins the derivation, as it already pins the 61h.
 */
export const REFERRAL_ASK_MAX_AGE_MS = REVIEW_REQUEST_MAX_AGE_MS + 24 * 60 * 60 * 1000;

export type DueReferralAsk = {
  bookingId: string; accountId: string;
  endsAt: string;
  /** The completion clock (0026); the pass runs from laterOf(endsAt, completedAt). */
  completedAt: string | null;
  /** Rung one's stamp. The gate defers to a strictly later local day. */
  followupSentAt: string | null;
  /** Rung two's stamp. Same deferral — never the same morning as the review. */
  reviewRequestedAt: string | null;
  /** The last FAILED referral text for this booking. Read back (24h cooldown). */
  smsFailedAt: string | null;
  /** THE PRECEDENCE INPUT. When review_request is ON for this account and
   *  `reviewRequestedAt` is still null and the anchor is still inside 61h,
   *  the referral ask WAITS — so the review always goes first, never merely
   *  usually. Resolved here, in the data layer, by a second narrow
   *  `listEnabled` read, because the gate is pure and cannot query. */
  reviewRequestEnabled: boolean;
  contactId: string; contactEmail: string | null; contactPhone: string | null;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  body: string;
  config: ReferralAskConfig | null;
};

// ONE STRING LITERAL, never a concatenation — see the note in Task 9, and
// Task 5 proved it: a concatenated select is plain `string`, supabase-js's
// type-level parser answers `GenericStringError`, and the cast below is TS2352.
const REFERRAL_ASK_SELECT =
  "id, account_id, contact_id, ends_at, completed_at, followup_sent_at, review_requested_at, referral_ask_sms_failed_at, contacts(email, phone)";

function toDueReferralAsk(
  r: any, info: AccountBrandInfo, auto: EnabledRecipe, reviewRequestEnabled: boolean,
): DueReferralAsk {
  return {
    bookingId: r.id,
    accountId: r.account_id,
    endsAt: r.ends_at,
    completedAt: r.completed_at ?? null,
    followupSentAt: r.followup_sent_at ?? null,
    reviewRequestedAt: r.review_requested_at ?? null,
    smsFailedAt: r.referral_ask_sms_failed_at ?? null,
    reviewRequestEnabled,
    contactId: r.contact_id,
    contactEmail: r.contacts?.email ?? null,
    contactPhone: r.contacts?.phone ?? null,
    brandName: brandDisplayName(info.branding),
    branding: info.branding,
    accountTimezone: info.accountTimezone,
    fromEmail: info.fromEmail,
    replyToEmail: info.replyToEmail,
    body: auto.body,
    config: parseReferralAskConfig(auto.config),
  };
}

/**
 * Candidates, not decisions: `shouldSendReferralAskNow` decides the MOMENT.
 * The query only says "enabled, completed, unstamped, inside 85h by either
 * anchor". The SECOND `listEnabled` read is the precedence input and costs
 * one narrow indexed query per tick, not one per row.
 *
 * THE INDEXES THAT SERVE IT are its own, added by 0047:
 * `bookings_referral_due` on `(ends_at) where status = 'completed' and
 * referral_asked_at is null` and `bookings_referral_due_completed` on
 * `(completed_at)` with the same predicate — one per anchor, because the
 * `.or(...)` is a union of two ranges. The review request's pair
 * (`bookings_review_due`, `bookings_review_due_completed`) CANNOT serve this
 * query: a partial index is only chosen when its predicate is implied by the
 * query's, and `referral_asked_at is null` does not imply
 * `review_requested_at is null`.
 */
export async function listDueReferralAsks(
  db: SupabaseClient, nowIso: string,
): Promise<DueReferralAsk[]> {
  const enabled = await listEnabled(db, "referral_ask", "listDueReferralAsks");
  if (enabled.size === 0) return [];
  const reviewOn = await listEnabled(db, "review_request", "listDueReferralAsks");

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - REFERRAL_ASK_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select(REFERRAL_ASK_SELECT)
    .in("account_id", [...enabled.keys()])
    .eq("status", "completed").is("referral_asked_at", null)
    .or(eitherAnchorSince("completed_at", windowStart))
    .lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueReferralAsks failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueReferralAsks");

  return sendable.map((r: any) => toDueReferralAsk(
    r, accountInfo.get(r.account_id as string)!, enabled.get(r.account_id as string)!,
    reviewOn.has(r.account_id as string)));
}

export async function getDueReferralAskById(
  db: SupabaseClient, bookingId: string,
): Promise<DueLookup<DueReferralAsk>> {
  const { data, error } = await db.from("bookings")
    .select(REFERRAL_ASK_SELECT)
    .eq("id", bookingId).eq("status", "completed").is("referral_asked_at", null).maybeSingle();
  if (error) throw new Error(`getDueReferralAskById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const accountId = (data as any).account_id as string;
  const auto = await enabledRecipeFor(db, accountId, "referral_ask");
  if (!auto) return { due: null, why: "off" };
  // A STORED CONFIG THAT NO LONGER PARSES IS `off` FOR A RELEASE, and saying
  // so HERE is what keeps a released row from parking. On a normal tick
  // `processReferralAsks` is silent on `config === null` (the channel is
  // unknown before the config parses, so there is no subject to write
  // against) and that is right — the row is simply examined again next tick.
  // A RELEASED row given the same silence keeps its past `held_until` and is
  // handed back every tick for ever, the parked-row bug. Answering `off`
  // sends `releaseReferralAsk` down its existing `REASONS.recipeOff` path,
  // which writes a real row and takes the hold out of the queue. Same shape
  // as `getDueQuoteFollowupById` (Task 9), and the reason Task 6's releaser
  // can state that its `config === null` branch is unreachable on a release.
  if (parseReferralAskConfig(auto.config) === null) return { due: null, why: "off" };
  // The precedence input, re-read for THIS account: the agency may have
  // turned the review request on during the hold, and a release that ignored
  // that would text a referral ask before the review it must follow.
  const review = await enabledRecipeFor(db, accountId, "review_request");
  const { sendable, accountInfo } = await loadSendableRows(
    db, [data as { account_id: string }], "getDueReferralAskById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueReferralAsk(data, accountInfo.get(accountId)!, auto, review !== null) };
}

/** Send-then-stamp. One referral ask per booking, ever. */
export async function stampReferralAsked(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ referral_asked_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReferralAsked failed: ${error.message}`);
}

/** The ATTEMPT marker, read back by the pass for SMS_RETRY_COOLDOWN_MS. */
export async function stampReferralAskSmsFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ referral_ask_sms_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReferralAskSmsFailed failed: ${error.message}`);
}

/** The daily cap's input, counted off the stamp column itself — no ledger
 *  table and no timezone: "a day" is a rolling 24 hours from the tick.
 *  Served by 0047's `bookings_referral_ask_count` on
 *  `(account_id, referral_asked_at) where referral_asked_at is not null` —
 *  a head-only count that never touches a heap page. */
export async function countReferralAsksSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("referral_asked_at", sinceIso);
  if (error) throw new Error(`countReferralAsksSince failed: ${error.message}`);
  return count ?? 0;
}
```

- [ ] **Step 3: Export**

In `packages/db/src/index.ts`'s `./automations` list, append:

```ts
         parseReferralAskConfig, listDueReferralAsks, getDueReferralAskById,
         stampReferralAsked, stampReferralAskSmsFailed, countReferralAsksSince,
         REFERRAL_ASK_MAX_AGE_MS,
         type ReferralAskChannel, type ReferralAskConfig, type DueReferralAsk,
```

- [ ] **Step 4: Live tests**

Append to `packages/db/src/test/automations.test.ts` (and extend that file's `../automations` import):

```ts
describe("referral ask — data layer", () => {
  it("the cap is 85 hours, which is the review request's cap plus one local day", () => {
    // THE LITERAL FIRST. `REFERRAL_ASK_MAX_AGE_MS = REVIEW_REQUEST_MAX_AGE_MS + 24h`
    // is the constant's own definition, so asserting only the derivation is a
    // tautology: change both constants and it stays green. 85h is the number
    // this recipe promises, so 85h is what is pinned; the derivation is
    // asserted second, as the STATEMENT that the three rungs are one local
    // day apart.
    expect(REFERRAL_ASK_MAX_AGE_MS).toBe(85 * HOUR);
    expect(REFERRAL_ASK_MAX_AGE_MS).toBe(REVIEW_REQUEST_MAX_AGE_MS + 24 * HOUR);
  });

  it("parseReferralAskConfig takes a channel and NOTHING else — there is nowhere to put a link", () => {
    expect(parseReferralAskConfig({ channel: "sms" })).toEqual({ channel: "sms" });
    expect(parseReferralAskConfig({ channel: "email", reviewUrl: "https://x.example" })).toEqual({ channel: "email" });
    for (const bad of [null, undefined, "sms", 1, [], {}, { channel: "fax" }, { channel: "" }]) {
      expect(parseReferralAskConfig(bad), JSON.stringify(bad)).toBeNull();
    }
    // Mutation: spread `raw` into the result → the second expectation reds,
    // because a reviewUrl would survive into the config the pass reads.
  });

  it("listDueReferralAsks: completed, unstamped, inside 85h → due, and carries the precedence input", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Ref", email: "ref@example.com", phone: "(956) 555-0112" }, "user_test");
      const now = new Date("2027-08-20T12:00:00Z");
      const mk = async (endsAt: Date) => {
        const b = await createBooking(db, accountId,
          { calendarId: cal.id, contactId, startsAt: new Date(endsAt.getTime() - MINUTE), endsAt }, "user_test");
        await setBookingStatus(db, accountId, b.id, "completed", "user_test");
        return b;
      };

      const fresh = await mk(new Date(now.getTime() - 30 * HOUR));
      expect((await listDueReferralAsks(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(fresh.id);

      await upsertAutomation(db, accountId, "referral_ask",
        { enabled: true, body: "", config: { channel: "sms" } }, "user_test");
      // ONE MILLISECOND either side of the 85h ceiling, never "a week ago":
      // a fixture far past the bound passes against any ceiling. Built from
      // the LITERAL 85h, not from REFERRAL_ASK_MAX_AGE_MS: the query window
      // is derived from that same constant, so a fixture built from it moves
      // with the window and the pair survives any value the constant takes.
      const CEILING = 85 * HOUR;
      const atCeiling = await mk(new Date(now.getTime() - CEILING));
      const pastCeiling = await mk(new Date(now.getTime() - CEILING - 1));
      const stamped = await mk(new Date(now.getTime() - 40 * HOUR));
      await stampReferralAsked(db, stamped.id);

      const list = await listDueReferralAsks(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(fresh.id);
      expect(ids).toContain(atCeiling.id);
      // Mutation: change REFERRAL_ASK_MAX_AGE_MS to 86h → pastCeiling falls
      // inside the widened window and this reds; change it to 84h and the
      // atCeiling row above reds instead.
      expect(ids).not.toContain(pastCeiling.id);
      expect(ids).not.toContain(stamped.id);

      const row = list.find((r) => r.bookingId === fresh.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row.config).toEqual({ channel: "sms" });
      // review_request is OFF for this account, so the precedence input is false.
      expect(row.reviewRequestEnabled).toBe(false);

      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      const after = (await listDueReferralAsks(db, now.toISOString())).find((r) => r.bookingId === fresh.id)!;
      // Mutation: hard-code `reviewRequestEnabled: false` in toDueReferralAsk
      // → this reds and the whole precedence rule silently stops working.
      expect(after.reviewRequestEnabled).toBe(true);
    });
  });

  it("a suppressed account's completed booking is never due, by list or by id", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Hush", email: "h@example.com" }, "user_test");
      await upsertAutomation(db, accountId, "referral_ask", { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      const now = new Date("2027-08-20T12:00:00Z");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(now.getTime() - 31 * HOUR), endsAt: new Date(now.getTime() - 30 * HOUR) }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      expect((await listDueReferralAsks(db, now.toISOString())).map((r) => r.bookingId)).toContain(b.id);
      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      expect((await listDueReferralAsks(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(b.id);
      expect((await getDueReferralAskById(db, b.id)).due).toBeNull();
    });
  });

  it("by id, a config that no longer parses answers `off` — so a released hold leaves the queue", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Broken", email: "broken@example.com" }, "user_test");
      await upsertAutomation(db, accountId, "referral_ask",
        { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      const now = new Date("2027-08-20T12:00:00Z");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(now.getTime() - 31 * HOUR), endsAt: new Date(now.getTime() - 30 * HOUR) }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      expect((await getDueReferralAskById(db, b.id)).due?.bookingId).toBe(b.id);

      // Straight to the column: `upsertAutomation` validates on write, and
      // the case being proved is a row that went bad UNDER the app (an older
      // shape, a hand-edited jsonb, a config written before a parser change).
      await db.from("automations").update({ config: { channel: "fax" } })
        .eq("account_id", accountId).eq("recipe_key", "referral_ask");
      expect(await getDueReferralAskById(db, b.id)).toEqual({ due: null, why: "off" });
      // Mutation: delete the `parseReferralAskConfig(auto.config) === null`
      // guard from getDueReferralAskById → this reds, and a released hold
      // whose config went bad is left `held` with its past `held_until` for
      // ever, parking the head of the release queue.
    });
  });

  it("stampReferralAsked and stampReferralAskSmsFailed write their own columns; only the first counts", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Stamp2" }, "user_test");
      const mk = (offset: number) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(Date.now() - offset - MINUTE), endsAt: new Date(Date.now() - offset) }, "user_test");
      const before = new Date();
      const a = await mk(3 * HOUR);
      const c = await mk(4 * HOUR);
      await stampReferralAsked(db, a.id);
      await stampReferralAsked(db, a.id);                 // idempotent
      await stampReferralAskSmsFailed(db, c.id);          // an ATTEMPT, not a send
      const { data } = await db.from("bookings")
        .select("referral_asked_at, referral_ask_sms_failed_at").eq("id", c.id).single();
      expect((data as { referral_asked_at: string | null }).referral_asked_at).toBeNull();
      // BY VALUE, never .not.toBeNull() — see the note in Task 2. A dropped column
      // is UNDEFINED, and not.toBeNull() is green against it.
      const marked = data as { referral_ask_sms_failed_at: string | null };
      expect(new Date(marked.referral_ask_sms_failed_at!).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(await countReferralAsksSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(1);
      expect(await countReferralAsksSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
    });
  });
});
```

- [ ] **Step 5: Run, mutate, commit**

```bash
pnpm --filter @bis/db typecheck
pnpm --filter @bis/db exec vitest run src/test/automations.test.ts src/__tests__/outbound-suppressed.test.ts > /tmp/task5.log 2>&1; echo "exit=$?" >> /tmp/task5.log
```

Mutations, each reverted, each named test confirmed red:

| Mutation | Test that must red |
| --- | --- |
| swap `loadSendableRows` for `loadAccountBrandInfo` in `listDueReferralAsks` | the suppression walk, by function name |
| change `REFERRAL_ASK_MAX_AGE_MS` to 86h | `the cap is 85 hours, which is the review request's cap plus one local day` AND `listDueReferralAsks: completed, unstamped, inside 85h → due…` (both fixtures are literals now; before this fix neither could red) |
| spread `raw` into `parseReferralAskConfig`'s result | `parseReferralAskConfig takes a channel and NOTHING else` |
| delete the `parseReferralAskConfig(auto.config) === null` guard in `getDueReferralAskById` | `by id, a config that no longer parses answers 'off' — so a released hold leaves the queue` |
| hard-code `reviewRequestEnabled: false` in `toDueReferralAsk` | the precedence-input half of the due-list case |

```bash
git add packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts
git commit -m "db(automations): referral_ask due-list with the review-request precedence input, by-id lookup, stamps"
```

---

### Task 6: `referral_ask` — the recipe (bis-automations)

**Files:**
- Modify: `packages/db/src/automation-log.ts` (`AUTOMATION_LOG_SOURCES` gains `"referral_ask"`)
- Modify: `apps/web/src/lib/automations/hold-or-send.ts` (`REASONS.reviewFirst`)
- Create: `apps/web/src/lib/automations/referral-ask-gate.ts` (+ `.test.ts`), `referral-ask-copy.ts` (+ `.test.ts`), `passes/referral-ask.ts` (+ `.test.ts`)
- Create: `apps/web/src/lib/email/templates/referral-ask.ts` (+ `.test.ts`) — **bis-comms owns the shell; this file uses `shell()` and `escapeHtml()` exactly as `followup.ts:44-47` does, adds no primitive and no button**
- Modify: `release-held.ts`, `log-titles.ts`, `registry.ts`, `cron-coupling.test.ts`, `sentinel.test.ts`, `route.test.ts`, `messages.ts`
- Create: `…/automations/referral-ask-card.tsx`; Modify: `…/automations/{page.tsx,actions.ts,page.test.ts,actions.test.ts}`

**Interfaces:**
- Produces:
  ```ts
  // referral-ask-gate.ts
  export function reviewRequestStillOwed(now: Date, anchor: Date, reviewRequestedAt: Date | null, reviewRequestEnabled: boolean): boolean;
  export function shouldSendReferralAskNow(now: Date, anchor: Date, followupSentAt: Date | null, reviewRequestedAt: Date | null, reviewRequestEnabled: boolean, timezone: string): boolean;
  // referral-ask-copy.ts
  export function defaultReferralAskBody(brandName: string): string;
  export function referralAskSubject(brandName: string): string;
  // email/templates/referral-ask.ts — the subject comes from the CALLER, the
  // same shape reactivationEmail (Task 8) and quoteFollowupEmail (Task 10)
  // take, so the blank-brand branch lives once in the copy module instead of
  // three times in three templates.
  export function referralAskEmail(input: { brand: EmailBrand; subject: string; body: string }): { subject: string; html: string; text: string };
  // passes/referral-ask.ts
  export type ProcessOptions = { released: boolean };
  export const referralAskPass: Pass;                    // key: "referralAsks"
  export async function processReferralAsks(ctx: PassContext, due: DueReferralAsk[], opts: ProcessOptions): Promise<ReferralAskCounters>;
  export const releaseReferralAsk: Releaser;
  ```

- [ ] **Step 1: The gate, tests first**

`apps/web/src/lib/automations/referral-ask-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { REFERRAL_ASK_MAX_AGE_MS, REVIEW_REQUEST_MAX_AGE_MS } from "@bis/db";
import { shouldSendReferralAskNow, reviewRequestStillOwed } from "./referral-ask-gate";

const ZONE = "America/Chicago";
const WEST = "America/Los_Angeles";
/** 09:00 CDT Sept 24 · 07:00 PDT Sept 24 — inside the 08:00–11:00 band in
 *  Chicago and before it in Los Angeles. One instant, two verdicts. */
const NOW = new Date("2027-09-24T14:00:00.000Z");
/** The job ended 15:00 CDT Sept 21 — three local days earlier, 66h before NOW. */
const ANCHOR = new Date("2027-09-21T20:00:00.000Z");
/** Rung one, 09:00 CDT Sept 22. */
const FOLLOWUP = new Date("2027-09-22T14:00:00.000Z");
/** Rung two, 09:05 CDT Sept 23 — a DIFFERENT instant from FOLLOWUP on
 *  purpose: a fixture where both stamps share a value is satisfied by
 *  whichever clause survives a mutation, which is this repo's fixture-equal
 *  shape. */
const REVIEWED = new Date("2027-09-23T14:05:00.000Z");

const send = (over: Partial<{
  now: Date; anchor: Date; followup: Date | null; reviewed: Date | null; reviewOn: boolean; zone: string;
}> = {}) => {
  const a = { now: NOW, anchor: ANCHOR, followup: FOLLOWUP, reviewed: REVIEWED, reviewOn: true, zone: ZONE, ...over };
  return shouldSendReferralAskNow(a.now, a.anchor, a.followup, a.reviewed, a.reviewOn, a.zone);
};

describe("the referral ask is the ladder's third rung", () => {
  it("sends on the morning after the review request went out", () => {
    expect(send()).toBe(true);
  });

  it("does NOT send on the SAME morning the review request went out, and does the next", () => {
    // 09:30 CDT Sept 23 — the review stamp is 25 minutes old, same local day.
    expect(send({ now: new Date("2027-09-23T14:30:00.000Z") })).toBe(false);
    // Mutation: delete the reviewRequestedAt clause from
    // shouldSendReferralAskNow → this case goes red and the other stays green.
    expect(send()).toBe(true);
  });

  it("does NOT send on the same morning as the follow-up either", () => {
    expect(send({ now: new Date("2027-09-22T14:30:00.000Z"), reviewed: null, reviewOn: false })).toBe(false);
  });

  it("WAITS while the review request is still owed — precedence, not luck", () => {
    // review_request ON, never sent, anchor still inside its own 61h.
    const anchor = new Date("2027-09-23T20:00:00.000Z");                 // 15:00 CDT Sept 23
    const now = new Date("2027-09-24T14:00:00.000Z");                    // 09:00 CDT Sept 24, 18h later
    expect(shouldSendReferralAskNow(now, anchor, null, null, true, ZONE)).toBe(false);
    // Mutation: make reviewRequestEnabled unread (hard-code false inside the
    // gate) → this case goes red.
    expect(reviewRequestStillOwed(now, anchor, null, true)).toBe(true);
    // The same morning with review_request OFF: nothing to wait for.
    expect(shouldSendReferralAskNow(now, anchor, null, null, false, ZONE)).toBe(true);
  });

  it("stops waiting once the review request's own 61h has run out unsent", () => {
    // Anchor 61h + 1ms before NOW: the review can never go now, so the
    // referral stops deferring to it. Tested AT the bound and 1ms either side.
    const atBound = new Date(NOW.getTime() - REVIEW_REQUEST_MAX_AGE_MS);
    const pastBound = new Date(NOW.getTime() - REVIEW_REQUEST_MAX_AGE_MS - 1);
    expect(reviewRequestStillOwed(NOW, atBound, null, true)).toBe(true);
    expect(reviewRequestStillOwed(NOW, pastBound, null, true)).toBe(false);
    // Mutation: change the comparison to `<` → the at-bound row reds.
  });

  it("is too stale one millisecond past 85 hours, and fine AT 85 hours", () => {
    // THE LITERAL, NOT THE IMPORT, on both sides. `REFERRAL_ASK_MAX_AGE_MS`
    // is the gate's own threshold: build the fixtures from it and `at` is
    // false / `past` is true for ANY value it takes, so the mutation named
    // below could never red this. The import is pinned once, here, against
    // the number the recipe promises.
    const MAX = 85 * 60 * 60 * 1000;
    expect(REFERRAL_ASK_MAX_AGE_MS).toBe(MAX);
    const at = new Date(NOW.getTime() - MAX);
    const past = new Date(NOW.getTime() - MAX - 1);
    expect(send({ anchor: at, followup: null, reviewed: new Date(at.getTime() + 60_000), reviewOn: true })).toBe(true);
    expect(send({ anchor: past, followup: null, reviewed: new Date(past.getTime() + 60_000), reviewOn: true })).toBe(false);
    // Mutation: change REFERRAL_ASK_MAX_AGE_MS to 86h → `past` (85h + 1ms)
    // is no longer stale and the second line reds; change it to 84h and the
    // first reds. Either way this test names the drift.
  });

  it("is outside the morning band at 07:59 and inside at 08:00", () => {
    expect(send({ now: new Date("2027-09-24T12:59:00.000Z") })).toBe(false);   // 07:59 CDT
    expect(send({ now: new Date("2027-09-24T13:00:00.000Z") })).toBe(true);    // 08:00 CDT
    expect(send({ now: new Date("2027-09-24T16:00:00.000Z") })).toBe(false);   // 11:00 CDT
  });

  /**
   * ONE INSTANT, TWO ZONES, OPPOSITE VERDICTS — the house rule for every
   * zone-dependent test, stated at the top of `review-request-gate.test.ts:7-12`
   * and demonstrated at `:23-24`. Without this pair, a gate that ignored its
   * `timezone` argument entirely would pass every other case in this file,
   * because they all pin America/Chicago, which is this machine's zone.
   * 14:00Z is 09:00 in Chicago (inside the 08:00–11:00 band) and 07:00 in
   * Los Angeles (before it); the anchor, both stamps and the instant are
   * identical.
   */
  it("reads the ACCOUNT's zone, not the machine's: the same instant sends in Chicago and waits in Los Angeles", () => {
    expect(send()).toBe(true);
    expect(send({ zone: WEST })).toBe(false);
    // Mutation: hard-code `"America/Chicago"` inside shouldSendReferralAskNow
    // instead of reading `timezone` → the second line reds.
  });

  it("fails CLOSED on an unresolvable zone, a negative elapsed time and an unreadable stamp — and an explicit UTC account still works", () => {
    // THE JUNK LIST IS THE THREE SIBLING GATES' LIST, verbatim
    // (`review-request-gate.test.ts:34-37`, `no-show-nudge-gate.test.ts:34`,
    // `followup-timing.test.ts:196`). NOT `"CST"`: `resolveAccountZone` is
    // `safeZone(tz, ZONE_UNRESOLVABLE)` and `safeZone`'s whole validation is
    // "did `new Intl.DateTimeFormat` throw" (`lib/booking/time.ts:20-30`,
    // `followup-timing.ts:122-125`). ICU RESOLVES `CST` — to America/Chicago,
    // verified — so asserting `false` for it would fail against a CORRECT
    // gate and invite an implementer to weaken the fail-closed rule to make
    // it pass. (`followup-timing.ts:110` names "the operator typed CST" as
    // the bug it was written for; the fix was the sentinel fallback, not a
    // claim that ICU rejects the string.)
    const utcMorning = new Date("2027-09-24T09:30:00.000Z");   // 09:30 UTC, inside the band
    expect(send({ now: utcMorning, zone: "UTC" })).toBe(true);  // the positive control
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(send({ now: utcMorning, zone: junk }), junk).toBe(false);
    }
    expect(send({ anchor: new Date(NOW.getTime() + 3600_000) })).toBe(false);
    expect(send({ reviewed: new Date("nonsense") })).toBe(false);
    expect(send({ followup: new Date("nonsense") })).toBe(false);
  });
});
```

Run: expected FAIL on the missing module. Paste the line.

- [ ] **Step 2: Write the gate**

`apps/web/src/lib/automations/referral-ask-gate.ts`:

```ts
import { REFERRAL_ASK_MAX_AGE_MS, REVIEW_REQUEST_MAX_AGE_MS } from "@bis/db";
import {
  resolveAccountZone, isInMorningBand, isStrictlyEarlierLocalDay,
} from "@/lib/booking/followup-timing";

/**
 * THE PRECEDENCE RULE, on its own so the pass can count it separately from
 * "not this morning" — two very different reasons a referral ask did not go.
 *
 * When review requests are ON for this account, the review has not been sent,
 * and the job's anchor is still inside the review's OWN 61-hour window, the
 * referral ask waits. That makes the ladder an ordering rather than a
 * coincidence: without it, a morning where both became eligible would send
 * whichever pass ran first, and the registry's order is not a product promise.
 *
 * Once the review's 61h has run out unsent (the feature was off, no address,
 * three failed texts), there is nothing left to defer to and the referral ask
 * goes on its own.
 */
export function reviewRequestStillOwed(
  now: Date, anchor: Date, reviewRequestedAt: Date | null, reviewRequestEnabled: boolean,
): boolean {
  if (!reviewRequestEnabled) return false;
  if (reviewRequestedAt !== null) return false;
  const elapsedMs = now.getTime() - anchor.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  return elapsedMs <= REVIEW_REQUEST_MAX_AGE_MS;
}

/**
 * WHEN a referral ask may be sent — the pure, unit-testable half of the pass.
 * Composes the same predicates as the review-request gate rather than copying
 * them, so the three rungs cannot drift. All must hold:
 *  0. A zone we can resolve — else FAIL CLOSED (no hour is defensible).
 *  1. Not stale: the anchor is within 85h (61h plus one local day).
 *  2. Morning band, 08:00–11:00 in the account's zone.
 *  3. The anchor fell on a strictly EARLIER local day.
 *  4. BOTH earlier rungs' stamps, when set, fell on strictly earlier local
 *     days: day one "how did it go?", day two "would you leave a review?",
 *     day three "know anyone else?" — never two on one morning.
 *  5. The review request is not still owed (above).
 *
 * `referral_asked_at` does all the deduping; this gate has no memory.
 */
export function shouldSendReferralAskNow(
  now: Date, anchor: Date, followupSentAt: Date | null, reviewRequestedAt: Date | null,
  reviewRequestEnabled: boolean, timezone: string,
): boolean {
  const elapsedMs = now.getTime() - anchor.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < 0) return false;                        // has not ended
  if (elapsedMs > REFERRAL_ASK_MAX_AGE_MS) return false;  // too stale to be welcome

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;

  if (!isInMorningBand(now, zone)) return false;
  if (!isStrictlyEarlierLocalDay(anchor, now, zone)) return false;

  for (const stamp of [followupSentAt, reviewRequestedAt]) {
    if (stamp === null) continue;
    // An unparseable stamp is a data problem; the safe direction is to hold.
    if (!Number.isFinite(stamp.getTime())) return false;
    if (!isStrictlyEarlierLocalDay(stamp, now, zone)) return false;
  }

  if (reviewRequestStillOwed(now, anchor, reviewRequestedAt, reviewRequestEnabled)) return false;
  return true;
}
```

Run green, then each prescribed mutation.

- [ ] **Step 3: The copy and the email template, tests first**

`apps/web/src/lib/messages.ts`, appended under `automations.`:

```ts
  "automations.referral.defaultBody": "Thanks again from {name}. If you know someone who needs the same done, reply with their name and number and we'll look after them.",
  "automations.referral.defaultBodyNoName": "Thanks again. If you know someone who needs the same done, reply with their name and number and we'll look after them.",
  "automations.referral.emailSubject": "One favour, from {name}",
  "automations.referral.emailSubjectNoName": "One favour",
  "automations.referral.title": "Referral asks",
  "automations.referral.body": "The morning after the review request, ask the customer whether they know someone else who needs the same work. Never lands on the same morning as the review request. Off until you turn it on.",
  "automations.referral.enabled": "Ask for referrals",
  "automations.referral.channel": "Send by",
  "automations.referral.message": "Message",
  "automations.referral.messageHint": "Leave blank to send our default message. No link is added — this asks for a name, not a rating.",
  "automations.referral.save": "Save referral asks",
  "automations.referral.saved": "Referral asks saved",
  "automations.referral.saveFailed": "Could not save referral asks.",
```

`apps/web/src/lib/automations/referral-ask-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { defaultReferralAskBody, referralAskSubject } from "./referral-ask-copy";

describe("the referral ask's copy", () => {
  it("names the brand and asks for a NAME", () => {
    const body = defaultReferralAskBody("Rio Roofing");
    expect(body).toContain("Rio Roofing");
    expect(body.toLowerCase()).toContain("name and number");
  });

  it("the subject names the brand, and names nothing at all when there is none", () => {
    expect(referralAskSubject("Rio Roofing")).toBe("One favour, from Rio Roofing");
    // Mutation: hard-code the subject in referralAskEmail again (the shape
    // this plan started with) → the second line reds, because an unbranded
    // account's subject becomes "One favour, from " with nothing after the
    // comma. `brandDisplayName` returns "" for an account with no brand name
    // (`branding.ts:197-199`), so this is reachable, not theoretical.
    expect(referralAskSubject("   ")).toBe(m["automations.referral.emailSubjectNoName"]);
    expect(referralAskSubject("A $& B")).toContain("A $& B");
  });

  it("contains NO LINK, because this is not a review request", () => {
    // The distinction is enforced, not hoped for: the config has no url field
    // and the body has no link. Mutation: paste a review URL into
    // automations.referral.defaultBody → this reds BY NAME.
    for (const name of ["Rio Roofing", ""]) {
      expect(defaultReferralAskBody(name)).not.toContain("http");
      expect(defaultReferralAskBody(name)).not.toContain("www.");
    }
  });

  it("never asks for a rating or a review", () => {
    const body = defaultReferralAskBody("Rio Roofing").toLowerCase();
    expect(body).not.toContain("review");
    expect(body).not.toContain("star");
  });

  it("drops the naming clause when there is no brand name", () => {
    // THE EXACT STRING, not `not.toContain("undefined")` + a substring:
    // deleting the blank-name branch yields "Thanks again from    . If you
    // know someone…", which satisfies both of those and reds nothing.
    // Mutation: delete the `if (!brandName.trim())` branch → this reds BY NAME.
    expect(defaultReferralAskBody("   ")).toBe(m["automations.referral.defaultBodyNoName"]);
    expect(defaultReferralAskBody("")).toBe(m["automations.referral.defaultBodyNoName"]);
  });

  it("survives a company name containing a String.replace special", () => {
    expect(defaultReferralAskBody("A $& B")).toContain("A $& B");
  });

  it("carries no internal milestone code and no template syntax", () => {
    const body = defaultReferralAskBody("Rio Roofing");
    expect(body).not.toMatch(/\bM[0-9][a-z]?\b/);
    expect(body).not.toContain("{{");
  });
});
```

`apps/web/src/lib/automations/referral-ask-copy.ts`:

```ts
import { m } from "@/lib/messages";

/**
 * What a customer receives when the operator has not written their own
 * referral ask. Three things this copy is NOT, each on purpose:
 *   - not a review request. It asks for a NAME, never a rating, and there is
 *     no link anywhere in it. `ReferralAskConfig` has no url field, so an
 *     operator cannot turn it into one by configuration either.
 *   - not urgent, and carries no offer. A referral bounty is a business
 *     decision nobody has taken.
 *   - not a form. "Reply with their name and number" uses the thread the
 *     customer is already in, which is the only channel that costs them
 *     nothing.
 *
 * `brandName` is the CUSTOMER-FACING name (the due-row carries only that).
 * Function replacement, not a plain string, for names containing `$&`.
 */
export function defaultReferralAskBody(brandName: string): string {
  if (!brandName.trim()) return m["automations.referral.defaultBodyNoName"];
  return m["automations.referral.defaultBody"].replace("{name}", () => brandName);
}

/**
 * The email's subject line, here rather than in the template, for the same
 * reason the body's blank-brand branch is here: `brandDisplayName` returns
 * `""` for an account that has never set a brand name (`branding.ts:197-199`),
 * and a template that interpolates it directly sends "One favour, from "
 * with nothing after the comma. Task 8's `reactivationSubject` and Task 10's
 * `quoteFollowupSubject` are the same function for the same reason.
 */
export function referralAskSubject(brandName: string): string {
  if (!brandName.trim()) return m["automations.referral.emailSubjectNoName"];
  return m["automations.referral.emailSubject"].replace("{name}", () => brandName);
}
```

`apps/web/src/lib/email/templates/referral-ask.ts` — the follow-up template's restraint (`followup.ts`), no button, because there is nowhere to send anyone:

```ts
import { shell, escapeHtml, type EmailBrand } from "./shell";

export type ReferralAskEmailInput = {
  brand: EmailBrand;
  /** Composed by the caller with `referralAskSubject(row.brandName)`, never
   *  interpolated here: `brand.name` is `""` for an account with no brand
   *  name, and `One favour, from ${brand.name}` would then ship a subject
   *  ending in a comma and a space. */
  subject: string;
  /** Already defaulted by the caller (the pass). Blank lines are paragraph
   *  breaks, as in the follow-up template. */
  body: string;
};

/**
 * The referral ask, the morning after the review request. Deliberately the
 * FOLLOW-UP's shape and not the review request's: no button and no call to
 * action, because the action is "reply to this email with a name" and a
 * button would need somewhere to point. A short personal note, not marketing.
 */
export function referralAskEmail(input: ReferralAskEmailInput):
  { subject: string; html: string; text: string } {
  const paragraphs = input.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const html = shell(
    input.brand,
    paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join(""),
  );
  return {
    subject: input.subject,
    html,
    text: paragraphs.join("\n\n"),
  };
}
```

`referral-ask.test.ts` beside it: the subject is the caller's, passed through unchanged; the html escapes a body containing `<script>`; the text part carries the operator's paragraph breaks and no HTML; **and the html contains no `href`** (mutation: add a button → red). Model it on `apps/web/src/lib/email/templates/followup.test.ts`, which already tests exactly these properties for the same shell — read it and match its assertions rather than inventing new ones.

- [ ] **Step 4: Register the source**

`packages/db/src/automation-log.ts` — append `"referral_ask"` to `AUTOMATION_LOG_SOURCES`. Run `pnpm --filter web typecheck` and paste the two TS2741 errors (`log-titles.ts`, `release-held.ts`). Do not widen either map.

- [ ] **Step 5: The pass — tests first**

`apps/web/src/lib/automations/passes/referral-ask.test.ts`. Use the shape from Task 3's pass test (the `dbMocks`/`ctx`/`heldRow` helpers), with these mocks: `listDueReferralAsks, getDueReferralAskById, stampReferralAsked, stampReferralAskSmsFailed, countReferralAsksSince, ensureConversation, createMessage, updateMessageStatus, recordAutomationLog, getAutomationLogEntry`. `countReferralAsksSince` defaults to `vi.fn(async () => 0)`.

```ts
const TICK = new Date("2027-09-24T14:00:00.000Z");      // 09:00 CDT, inside the band
function row(over: Partial<DueReferralAsk> = {}): DueReferralAsk {
  return {
    bookingId: "bk_r1", accountId: "acct_1",
    endsAt: "2027-09-21T20:00:00.000Z", completedAt: "2027-09-21T21:00:00.000Z",
    followupSentAt: "2027-09-22T14:00:00.000Z",
    reviewRequestedAt: "2027-09-23T14:05:00.000Z",     // NOT equal to followupSentAt
    smsFailedAt: null, reviewRequestEnabled: true,
    contactId: "ct_1", contactEmail: "maria@example.com", contactPhone: "(956) 555-0112",
    brandName: "Rio Roofing",
    // The two replyToEmails are DIFFERENT and neither is null, copying
    // `review-request.test.ts:39` and `:42` exactly (and its assertions at
    // `:93-94`): the pass must use the row's own
    // top-level `replyToEmail` and never `branding.replyToEmail`, and a
    // fixture that nulls both cannot tell the two apart. Mutation: read
    // `row.branding.replyToEmail` in sendEmail → the email case's
    // `replyTo` assertion reds with the decoy address.
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
                brandCorners: null, brandType: null, brandMode: null,
                replyToEmail: "wrong-should-not-be-used@rioroofing.com" },
    accountTimezone: "America/Chicago",
    fromEmail: "hello@rioroofing.com", replyToEmail: "owner@rioroofing.com",
    body: "", config: { channel: "sms" },
    ...over,
  };
}
```

Cases, each with its mutation named:

1. **sends by the configured channel and stamps.** `config.channel === "sms"` texts and calls `stampReferralAsked`; `channel: "email"` calls `ctx.email.send` with `subject: "One favour, from Rio Roofing"`, `fromAddress: "hello@rioroofing.com"` and **`replyTo: "owner@rioroofing.com"` — the row's own, never the branding decoy** — and never touches the SMS provider. Mutation: fall back to email when the SMS gate refuses → case 3 reds; read `row.branding.replyToEmail` instead of `row.replyToEmail` → this reds.
2. **an invalid config sends nothing and writes NO log row** (the channel is unknown before the config parses, so there is no subject). `c.skippedInvalidConfig` is 1 and `recordAutomationLog` was not called. Mutation: **delete the `config === null` guard** → the loop dereferences `null.channel` building the subject, `processReferralAsks` rejects, and this case reds. (Do NOT name "build the subject before parsing": it moves neither the counter nor the absence of a log row, so it cannot red anything — the shape this repo keeps shipping.)
3. **an SMS gate refusal skips and logs, and never becomes an email.** `c.skippedSmsGate === 1`, `ctx.email.send` not called, a `skipped` row with "Texting isn't set up for this company yet".
4. **THE LADDER.** With `reviewRequestedAt` set to 09:05 CDT *this* morning, `c.waitingForMorning === 1` and nothing sends; with it set to the previous morning, it sends. Mutation: delete the `reviewRequestedAt` clause from the gate → the first half reds.
5. **PRECEDENCE.** `reviewRequestEnabled: true, reviewRequestedAt: null`, anchor 18h old: `c.waitingForReviewRequest === 1`, nothing sent, and **no log row** (a normal tick is silent on this branch — the row is due again tomorrow). With `reviewRequestEnabled: false`, it sends. Mutation: hard-code `reviewRequestEnabled` false inside the pass → the first half reds.
6. **the SMS cooldown is silent on a normal tick and LOGGED on a release.** `smsFailedAt` two hours old: normal tick → `skippedRecentFailure === 1` and `recordAutomationLog` not called; released → `skippedRecentFailure === 1` and one `skipped` row with "Waiting before trying this text again". Mutation: drop the `if (opts.released)` guard so the normal tick logs too → the first half reds; delete the whole branch → the second reds. **This is the parked-row rule: a released row left untouched keeps its past `held_until` and starves every newer hold behind it.**
7. **the daily cap.** With `countReferralAsksSince` returning 25, one row: `skippedCap === 1` asserted BY NAME (never "some skip happened") and a `skipped` row reading "Daily limit reached".
8. **quiet hours hold**, exactly as Task 3's: no send, no stamp, one held row whose `heldUntil` is 08:00 local.
9. **release**: sends; tenancy mismatch skips (mutation: delete the `accountId` comparison); **the review still owed writes `skipped` with "Waiting for the review request to go first", never leaves the row untouched** (mutation: `continue` without logging → the assertion that `recordAutomationLog` was called with that reason reds); recipe off writes "This automation was turned off".
10. **A RELEASE NEVER LEAVES A ROW UNTOUCHED, AND THE INVALID-CONFIG BRANCH IS WHY THIS CASE EXISTS.** Two halves, one fixture apart.
    - `getDueReferralAskById` mocked to `{ due: null, why: "off" }` — which, after Task 5's parse guard, is what a config that no longer parses answers: `releaseReferralAsk` returns `"skipped"` **and** `recordAutomationLog` was called exactly once, with "This automation was turned off". Mutation: `return "skipped"` on the `!found.due` path without the `logSkipped` → this reds, and the held row keeps its past `held_until` for ever.
    - The half that shows what the data-layer guard is FOR: `getDueReferralAskById` mocked to return a due row whose `config` is `null`. `releaseReferralAsk` delegates, the pass's silent `config === null` branch runs, and `recordAutomationLog` is **not** called — assert exactly that, with a comment naming it as the reason `getDueReferralAskById` can never produce such a row. This is a characterisation test of the branch, not a wish: it stays green, and it is the thing that goes green-for-the-wrong-reason if anyone ever removes the parse guard, which is why **the guard's own red lives in Task 5's db suite** (`by id, a config that no longer parses answers 'off'`), not here.

> **Every `continue` in `processReferralAsks`, classified** (the Global Constraint at the top of this plan). `config === null`: silent on a normal tick, and UNREACHABLE on a release because `getDueReferralAskById` answers `why: "off"` for a config that will not parse, so the releaser logs `recipeOff` and never enters the loop. The SMS gate READ failure: `c.failed++`, console only, on both paths — a transient read error, not a branch that repeats deterministically, so leaving the held row with its past `held_until` IS the retry, exactly the call `review-request.ts:136-146` makes for the same read. `waitingForReviewRequest` and `waitingForMorning`: skipped entirely when `opts.released`, so they cannot be reached on a release at all. The SMS cooldown: the one branch that must write on a release, and does.

- [ ] **Step 6: Write the pass**

`apps/web/src/lib/automations/hold-or-send.ts` — one more `REASONS` key:

```ts
  /** The referral ask, released while the review request is still owed. The
   *  row is written `skipped` rather than left untouched: an untouched
   *  released row keeps its past `held_until` and parks the head of the
   *  queue. The normal pass re-discovers the unstamped booking the next
   *  morning and moves this same row back to `held` or `sent` in place. */
  reviewFirst: "Waiting for the review request to go first",
```

`apps/web/src/lib/automations/passes/referral-ask.ts` — the `review-request.ts` shape end to end (read that file before writing; it is the model for every band-gated, configured-channel recipe). Its differences, all of them:

```ts
import {
  listDueReferralAsks, stampReferralAsked, stampReferralAskSmsFailed, countReferralAsksSince,
  getDueReferralAskById, type DueReferralAsk, type ReferralAskConfig,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { referralAskEmail } from "@/lib/email/templates/referral-ask";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { laterOf } from "../anchor";
import { shouldSendReferralAskNow, reviewRequestStillOwed } from "../referral-ask-gate";
import { defaultReferralAskBody, referralAskSubject } from "../referral-ask-copy";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive, type SentSms } from "../send-sms";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

type Target =
  | { channel: "sms"; to: string; from: string }
  | { channel: "email"; to: string };

/**
 * The referral ask — the completed-job ladder's THIRD rung. Day one the
 * calendar's follow-up ("how did it go?"), day two the review request
 * ("would you leave a review?"), day three this ("know anyone else?").
 *
 * It is a recipe of its own rather than a channel option on the review
 * request, and that is a decision: one `automations` row cannot be enabled
 * twice with two bodies, and an operator who wanted only referrals would have
 * had to turn reviews off to get them.
 *
 * It DEFERS TO THE REVIEW REQUEST EXPLICITLY, not by luck — see
 * reviewRequestStillOwed. Relying on the registry's order would make a
 * product promise out of an array literal.
 *
 * Per row, each refusal counted under its own name so triage can tell them
 * apart: invalid config → unresolvable zone → the review is still owed →
 * not this morning → no deliverable address → SMS gate refused (NO fallback
 * to email) → SMS cooldown → caps → send → STAMP → (sms) mark the row sent.
 */
export const referralAskPass: Pass = {
  key: "referralAsks",
  async run(ctx) {
    return processReferralAsks(ctx, await listDueReferralAsks(ctx.db, ctx.now.toISOString()), { released: false });
  },
};

export type ProcessOptions = { released: boolean };

export async function processReferralAsks(
  ctx: PassContext, due: DueReferralAsk[], opts: ProcessOptions,
) {
  const c = {
    sent: 0, failed: 0, unstamped: 0, held: 0,
    skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0,
    waitingForMorning: 0, waitingForReviewRequest: 0, unresolvableTimezone: 0,
  };

  const smsGates = new Map<string, SmsGate>();
  const sentToday = new Map<string, number>();
  let attemptsThisTick = 0;

  for (const row of due) {
    const config = row.config;
    if (config === null) {
      c.skippedInvalidConfig++;
      console.error(
        `referral ask skipped for booking ${row.bookingId}: account ${row.accountId}'s referral_ask `
        + `config is missing or invalid — re-save the recipe in Automations`,
      );
      // NOT logged: the channel is unknown before the config parses, so there
      // is no subject (its channel field is required) to write against.
      // UNREACHABLE ON A RELEASE, and that is load-bearing:
      // `getDueReferralAskById` answers `why: "off"` for a config that will
      // not parse, so `releaseReferralAsk` writes `REASONS.recipeOff` and
      // never enters this loop. Without that guard this silent `continue`
      // would leave a released row `held` with its past `held_until`, and
      // `listReleasableHolds` would hand it back every tick for ever.
      continue;
    }

    const subject: HoldSubject = {
      accountId: row.accountId, accountTimezone: row.accountTimezone, source: "referral_ask",
      channel: config.channel, subjectKey: `booking:${row.bookingId}`, contactId: row.contactId,
    };

    if (resolveAccountZone(row.accountTimezone) === null) {
      c.unresolvableTimezone++;
      console.error(
        `referral ask HELD for booking ${row.bookingId}: account ${row.accountId}'s timezone `
        + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve`,
      );
      await logSkipped(ctx, subject, REASONS.timezone);
      continue;
    }

    const anchor = laterOf(new Date(row.endsAt), row.completedAt ? new Date(row.completedAt) : null);
    const followupSentAt = row.followupSentAt ? new Date(row.followupSentAt) : null;
    const reviewRequestedAt = row.reviewRequestedAt ? new Date(row.reviewRequestedAt) : null;

    // Both of these are skipped on a RELEASE: the band already said yes once,
    // when this row was held, and the releaser has already re-applied
    // precedence itself (and written a real `skipped` row if it bit). Counted
    // separately because "the review goes first" and "not this morning" are
    // very different answers to "why has nothing gone out?".
    if (!opts.released) {
      if (reviewRequestStillOwed(ctx.now, anchor, reviewRequestedAt, row.reviewRequestEnabled)) {
        c.waitingForReviewRequest++;
        continue;   // silent: the row is due again tomorrow morning
      }
      if (!shouldSendReferralAskNow(
        ctx.now, anchor, followupSentAt, reviewRequestedAt, row.reviewRequestEnabled, row.accountTimezone)) {
        c.waitingForMorning++;
        continue;
      }
    }

    let target: Target;
    if (config.channel === "sms") {
      const to = toE164(row.contactPhone);
      if (!to) {
        c.skippedNoAddress++;
        console.error(`referral ask skipped, no textable phone on file for booking ${row.bookingId}`);
        await logSkipped(ctx, subject, REASONS.noPhone);
        continue;
      }
      let gate = smsGates.get(row.accountId);
      if (!gate) {
        try {
          gate = await resolveSmsSender(ctx.db, row.accountId);
        } catch (e) {
          // TRANSIENT, on both paths, and deliberately not logged: a read
          // error is not a branch that repeats deterministically, so a
          // released row left `held` with its past `held_until` IS the
          // retry — the next tick re-examines it. Same call
          // `review-request.ts:136-146` makes for the same read.
          c.failed++;
          console.error(`referral ask: sms gate read failed for account ${row.accountId}: ${String(e)}`);
          continue;
        }
        smsGates.set(row.accountId, gate);
      }
      if (!gate.ok) {
        c.skippedSmsGate++;
        console.error(
          `referral ask skipped for booking ${row.bookingId}: account ${row.accountId} cannot text `
          + `(${gate.reason}) — not falling back to email`,
        );
        await logSkipped(ctx, subject, REASONS.smsGate);
        continue;
      }
      // Silent on a normal tick (the row is simply due again once the marker
      // ages out); a REAL skip on a release, or the row keeps its past
      // held_until and parks the head of the queue forever.
      if (smsCooldownActive(row.smsFailedAt, ctx.now)) {
        c.skippedRecentFailure++;
        if (opts.released) await logSkipped(ctx, subject, REASONS.smsCooldown);
        continue;
      }
      target = { channel: "sms", to, from: gate.from };
    } else {
      if (!row.contactEmail) {
        c.skippedNoAddress++;
        console.error(`referral ask skipped, no contact email on file for booking ${row.bookingId}`);
        await logSkipped(ctx, subject, REASONS.noEmail);
        continue;
      }
      target = { channel: "email", to: row.contactEmail };
    }

    // CAPS, after the gate and the address so only rows that would actually
    // send count against them. The TICK cap is a per-tick queue and is not
    // logged; the DAILY cap is — the client's own limit was reached today.
    if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
      c.skippedCap++;
      continue;
    }
    let today = sentToday.get(row.accountId);
    if (today === undefined) {
      today = await countReferralAsksSince(
        ctx.db, row.accountId, new Date(ctx.now.getTime() - DAILY_CAP_WINDOW_MS).toISOString());
      sentToday.set(row.accountId, today);
    }
    if (today >= AUTOMATION_DAILY_CAP) {
      c.skippedCap++;
      await logSkipped(ctx, subject, REASONS.dailyCap);
      continue;
    }
    attemptsThisTick++;
    sentToday.set(row.accountId, today + 1);

    const body = row.body.trim() || defaultReferralAskBody(row.brandName);

    let smsRow: SentSms | null = null;
    try {
      const outcome = await holdOrSend(ctx, subject, async () => {
        if (target.channel === "sms") {
          // NO composer and NO trailing link: this recipe asks for a name,
          // never a rating, and there is nowhere for a link to point.
          smsRow = await sendAutomationSms(ctx, {
            accountId: row.accountId, contactId: row.contactId, to: target.to, from: target.from,
            body,
            onProviderFailure: () => stampReferralAskSmsFailed(ctx.db, row.bookingId),
          });
        } else {
          await sendEmail(ctx, row, target.to, body);
        }

        const stamp = await stampWithRetry(() => stampReferralAsked(ctx.db, row.bookingId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `referral ask sent but NOT stamped for booking ${row.bookingId} after ${stamp.attempts} `
            + `attempts — expect up to 11 more copies before the morning band closes: ${String(stamp.lastError)}`,
          );
        }
        if (smsRow) await markAutomationSmsSent(ctx, row.accountId, smsRow, "referral ask");
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`referral ask send failed for booking ${row.bookingId}: ${String(e)}`);
      continue;
    }
  }

  return c;
}

export const releaseReferralAsk: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueReferralAskById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  // PRECEDENCE, RE-APPLIED. The agency may have switched review requests on
  // during the hold. Written `skipped` rather than left untouched (the
  // parked-row rule); the normal pass re-discovers this unstamped booking the
  // next morning and moves this SAME row back to `held` or `sent` in place,
  // because the log's unique key is (account, source, subject).
  const anchor = laterOf(
    new Date(found.due.endsAt), found.due.completedAt ? new Date(found.due.completedAt) : null);
  const reviewRequestedAt = found.due.reviewRequestedAt ? new Date(found.due.reviewRequestedAt) : null;
  if (reviewRequestStillOwed(ctx.now, anchor, reviewRequestedAt, found.due.reviewRequestEnabled)) {
    await logSkipped(ctx, subjectOf(row), REASONS.reviewFirst);
    return "skipped";
  }
  return verdict(await processReferralAsks(ctx, [found.due], { released: true }));
};

async function sendEmail(
  ctx: PassContext, row: DueReferralAsk, to: string, body: string,
): Promise<void> {
  // emailBrandNamed, because the row carries the resolved brand name and
  // nothing else — there is no accountName here to get wrong.
  const brand = emailBrandNamed(row.branding, row.brandName);
  // The subject is composed here, not inside the template: an account with no
  // brand name has `brandName === ""` (brandDisplayName, branding.ts:197-199)
  // and a template interpolating it would ship "One favour, from ".
  const { subject, html, text } = referralAskEmail({
    brand, subject: referralAskSubject(row.brandName), body,
  });
  await ctx.email.send({
    to,
    fromName: brand.name,
    fromAddress: row.fromEmail ?? undefined,
    // The row's OWN top-level replyToEmail, never branding.replyToEmail.
    replyTo: normalizeReplyTo(row.replyToEmail),
    subject,
    body: text,
    html,
  });
}

/** Unused import guard: `ReferralAskConfig` is referenced by the subject's
 *  `channel: config.channel`; if the compiler flags it as unused, delete the
 *  type import rather than adding a `void`. */
export type { ReferralAskConfig };
```

> If `pnpm --filter web typecheck` reports `ReferralAskConfig` as an unused import, **delete the import and the re-export line** rather than keeping a no-op. The source wins over this plan's guess about what the compiler wants.

- [ ] **Step 7: Registry, releaser, title, counters, coupling**

- `release-held.ts`: `referral_ask: releaseReferralAsk` plus its import.
- `log-titles.ts`: `referral_ask: m["automations.referral.title"]`.
- `registry.ts`: `referralAskPass` **immediately after `reviewRequestPass`** and before `noShowNudgePass`. Extend the file's doc comment: *"the review-request pass stamps `review_requested_at` and the referral-ask pass reads it in the same tick, which is what guarantees the review goes out on day two and the referral on day three even when both become eligible on the same morning — the same dependency the follow-up and the review request already have, one rung further down."* Order is part of the contract.
- `route.test.ts`: `const EMPTY_REFERRAL_ASKS = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0, waitingForMorning: 0, waitingForReviewRequest: 0, unresolvableTimezone: 0 };` under the key `referralAsks`, added to **all SEVEN whole-body equality assertions** (`:253, :276, :299, :315, :408, :423-435, :459-471`) — miss one and that test reds with no named expectation; miss them all and seven do. **Seven, not eight** — `grep -c "expect(body).toEqual" apps/web/src/app/api/cron/reminders/route.test.ts` returns `7`; the citation list has seven entries, two of them spanning lines. Plus the factory-mock exports: `route.test.ts:15` is a BARE factory (no `importOriginal`) that throws on any export it does not define, at the moment it is read, so it gains `listDueReferralAsks: async () => []`, `countReferralAsksSince: async () => 0` and `REFERRAL_ASK_MAX_AGE_MS` (the gate module reads that constant at import time — a missing one throws before any test body runs). The two stamps and `getDueReferralAskById` take the file's own convention for a thing that must not happen in this suite: `async () => { throw new Error("route.test: nothing is due") }`.
- `sentinel.test.ts`, **three edits, and the second is a red this step must EXPECT rather than discover**:
  - the new `dbMocks` entries and a `DueReferralAsk` row. `beforeEach` resets every `dbMock` to `mockResolvedValue(undefined)` (`:69`), so `listDueReferralAsks` needs its own explicit `mockResolvedValue([row])` after the reset or the pass iterates `undefined`, throws, and the harness reports `errored`.
  - **the registry literal at `:157`.** It is an ordered `toEqual` of every pass key and it goes RED the moment `referralAskPass` is registered. The tempting "fix" is to loosen an order assertion that exists to pin an order; the correct one is to insert the new key at its position. After this task it reads, in full:
    ```ts
    expect(PASSES.map((p) => p.key)).toEqual(["releaseHeld", "reminders", "followups", "reviewRequests", "referralAsks", "noShowNudges", "smsReminders", "appointmentConfirms", "siteTraffic", "weeklyClientReport", "weeklyAgencyReport"]);
    ```
    (`appointmentConfirms` is already there — Task 3 inserted it. Tasks 8 and 10 each insert one more; Task 10's step states the final thirteen.)
  - **the test's TITLE at `:156`**, which names the order in prose and rots silently otherwise: "the registry runs the release pass, then reminders, follow-ups, review requests, referral asks, no-show nudges, text reminders, appointment confirmations, site traffic, then the two weekly reports — the first three's order is the collision's contract".
- `cron-coupling.test.ts`:

```ts
it("the referral ask is the review request's cap plus one local day — one rung further down the ladder", () => {
  // THE LITERALS FIRST. The ladder's whole span, stated once: follow-up 37h,
  // review 61h, referral 85h. Mutation: change any one constant → this reds.
  expect([FOLLOWUP_MAX_AGE_MS, REVIEW_REQUEST_MAX_AGE_MS, REFERRAL_ASK_MAX_AGE_MS])
    .toEqual([37 * 60 * MINUTE, 61 * 60 * MINUTE, 85 * 60 * MINUTE]);
  // The derivation second, and only as a STATEMENT of the relationship: on
  // its own it mirrors `REFERRAL_ASK_MAX_AGE_MS`'s own definition and reds
  // for nothing but a sign flip.
  expect(REFERRAL_ASK_MAX_AGE_MS).toBe(REVIEW_REQUEST_MAX_AGE_MS + 24 * 60 * MINUTE);
});
```

- [ ] **Step 8: The card, the action, the page**

`referral-ask-card.tsx` — the `NoShowNudgeCard` shape exactly (channel Select + Textarea + segment counter + SMS-gate notice), with **no link hint line**, `data-testid="referral-ask-card"`, and the counter computed on `body.trim() || defaultReferralAskBody(brandName)` with no composer (there is no link to append).

`saveReferralAskAction` in `actions.ts` — `saveNoShowNudgeAction`'s shape exactly, with `parseReferralAskConfig` on write and `"referral_ask"` as the key.

`page.tsx` — one more `getAutomation` in the `Promise.all` (same `.catch` degrade), the card after `AutomationsSettings` (the review-request card) so the page reads in ladder order, and its positional binding added in the SAME position as the promise.

`page.test.ts` / `actions.test.ts` — the render case, the degraded case, the agency gate case, the invalid-channel case.

- [ ] **Step 9: Run, mutate, commit**

```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run src/lib/automations src/lib/email src/app/api/cron "src/app/(dashboard)/dashboard/accounts/[accountId]/automations"
```

Mutations, each reverted, each named test confirmed red:

| Mutation | Test that must red |
| --- | --- |
| delete the `reviewRequestedAt` clause in `shouldSendReferralAskNow` | `does NOT send on the SAME morning the review request went out, and does the next` |
| hard-code `reviewRequestEnabled` to `false` inside the gate | `WAITS while the review request is still owed — precedence, not luck` |
| change `REFERRAL_ASK_MAX_AGE_MS` to 86h | `is too stale one millisecond past 85 hours, and fine AT 85 hours` AND `the referral ask is the review request's cap plus one local day — one rung further down the ladder`. Both fixtures are built from the literal now, so both red; before this fix neither could |
| hard-code `"America/Chicago"` inside `shouldSendReferralAskNow` | `reads the ACCOUNT's zone, not the machine's: the same instant sends in Chicago and waits in Los Angeles` |
| paste a review URL into `automations.referral.defaultBody` | `contains NO LINK, because this is not a review request` |
| delete the `if (!brandName.trim())` branch from `defaultReferralAskBody` | `drops the naming clause when there is no brand name` |
| hard-code the subject inside `referralAskEmail` again | `the subject names the brand, and names nothing at all when there is none` |
| delete the `config === null` guard in `processReferralAsks` | the invalid-config pass case (the loop dereferences `null.channel` and the run rejects) |
| `return "skipped"` on the releaser's `!found.due` path without the `logSkipped` | case 10's first half (`recordAutomationLog` called once with "This automation was turned off") |
| `continue` without `logSkipped` on the releaser's precedence branch | the release case asserting the `"Waiting for the review request to go first"` row |
| drop `if (opts.released)` on the cooldown branch | the cooldown case's normal-tick half |
| read `row.branding.replyToEmail` instead of `row.replyToEmail` in `sendEmail` | the email half of case 1 (`replyTo` is the decoy address) |
| delete `referral_ask` from `RELEASERS` | `pnpm --filter web typecheck`, TS2741 |

```bash
git add apps/web/src/lib/automations apps/web/src/lib/email/templates apps/web/src/lib/messages.ts apps/web/src/app/api/cron/reminders/route.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations" packages/db/src/automation-log.ts
git commit -m "automations(referral_ask): the ladder's third rung, deferring to the review request explicitly"
```

---

### Task 7: `reactivation` — the data layer (bis-db-schema)

This is the recipe with spam teeth, and almost all of its restraint lives here, in query predicates rather than in hope: a past customer with a COMPLETED booking, an email address, no previous reactivation ever, and a conversation that has been silent for the configured months. The ONE restraint that does not live here is the quiet period's exact re-check — `conversations.last_message_at` can lag, so the due-list's message read is a bounded pre-filter and `processReactivations` asks `conversationQuietSince` per row, against that account's own cutoff, immediately before it sends (Task 8, Step 6). Nothing goes out on the pre-filter alone.

**Files:**
- Modify: `packages/db/src/automations.ts` (a new section; `RecipeKey` gains `"reactivation"`)
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/test/automations.test.ts`
- Modify: `packages/db/src/test/due-by-id.test.ts` — **the house home for every `getDue*ById`**, which the File Structure promises four recipes' cases. Task 5 shipped WITHOUT it and its release path went unproven: `getDue*ById`'s `.is("<stamp>", null)` is the ONLY double-send guard, and a reviewer deleted it and watched the suite stay green — a held row stamped during the hold would come back as due and the customer would get a second text. Copy the block Task 2 landed at `due-by-id.test.ts:89-105`, and assert `toEqual({ due: null, why: … })` rather than `.due` alone: `why` picks between two different customer-facing sentences.

**Interfaces:**
- Produces:
  ```ts
  export const REACTIVATION_MIN_MONTHS = 6;
  export const REACTIVATION_MAX_MONTHS = 18;
  export const REACTIVATION_DEFAULT_MONTHS = 9;
  export const REACTIVATION_CANDIDATE_LIMIT = 200;
  export const REACTIVATION_CANDIDATE_PAGES = 5;
  export const REACTIVATION_SURVIVOR_TARGET = 50;
  export type ReactivationConfig = { months: number };
  export function parseReactivationConfig(raw: unknown): ReactivationConfig | null;
  export function reactivationCutoff(now: Date, months: number): Date;
  export type DueReactivation = {
    contactId: string; accountId: string;
    lastMessageAt: string; quietMonths: number;
    contactEmail: string; contactName: string;
    brandName: string; branding: Branding; accountTimezone: string;
    fromEmail: string | null; replyToEmail: string | null; body: string;
  };
  export async function listDueReactivations(
    db: SupabaseClient, nowIso: string,
    opts?: { pageSize?: number; maxPages?: number },
  ): Promise<DueReactivation[]>;
  export async function getDueReactivationById(db: SupabaseClient, contactId: string): Promise<DueLookup<DueReactivation>>;
  export async function conversationQuietSince(db: SupabaseClient, accountId: string, contactId: string, sinceIso: string): Promise<boolean>;
  export async function stampReactivationSent(db: SupabaseClient, contactId: string): Promise<void>;
  export async function countReactivationsSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number>;
  ```

> **`reactivationCutoff` lives in `packages/db`, not in `reactivation-gate.ts`**, because the due-list needs it and `packages/db` cannot import from `apps/web`. The web gate holds only `shouldSendReactivationNow(now, timezone)`. That split is deliberate and is the reason this file, not the gate's, carries the month-arithmetic tests.

> **Amendment B5 is narrower than its first sentence said, and this task is where that shows.** Its real argument — the one that survives — is that the per-account `months` narrowing cannot be expressed in one query, because one query cannot carry four different cutoffs. The CONTACT predicates can: `contacts!inner(...)` with `contacts.reactivation_sent_at=is.null` and `contacts.email=not.is.null` is the same shape `listDueFollowups` already uses (`booking.ts:638`, `:663`), and pushing them server-side is what stops a page of leads parking the oldest-first window for ever. The completed-booking rule still cannot join (there is no path from `conversations` to `bookings`), which is why the candidate read walks pages. **B5's wording must be updated when the amendment list is rewritten; the plan's own text below is the authority meanwhile.**

- [ ] **Step 1: RED FIRST — the suppression walk**

Add the skeleton — **annotated, not implicit `any`**, or `noImplicitAny` reds `typecheck` instead of the walk:

```ts
export async function listDueReactivations(
  db: SupabaseClient, nowIso: string,
): Promise<DueReactivation[]> { void db; void nowIso; return []; }
```

(with `DueReactivation` declared above it, per Step 2). Then run

```bash
pnpm --filter @bis/db exec vitest run src/__tests__/outbound-suppressed.test.ts > /tmp/supp-red-3.log 2>&1; echo "exit=$?" >> /tmp/supp-red-3.log
```

Expected: `expected [ 'automations.ts: listDueReactivations' ] to deeply equal []`. Paste it.

- [ ] **Step 2: Write the section**

`RecipeKey` gains `| "reactivation"`. Append after the `referral_ask` section:

```ts
// ---------------------------------------------------------------------------
// Recipe: reactivation — a past customer who has gone quiet (part B)
// ---------------------------------------------------------------------------

/**
 * Six to eighteen months, defaulting to nine (danlo, 2026-09-21). Roofing and
 * landscaping are seasonal: nine months reaches someone whose last job was
 * last spring, while the relationship is still warm enough that the message
 * reads as a business they know. Twelve is a full cycle, by which point it
 * reads as a blast from a stranger — which is precisely the risk this recipe
 * carries. The range is narrow for the same reason: three months is too soon
 * to call someone lapsed, two years is a cold list.
 */
export const REACTIVATION_MIN_MONTHS = 6;
export const REACTIVATION_MAX_MONTHS = 18;
export const REACTIVATION_DEFAULT_MONTHS = 9;

/**
 * ONE PAGE of the candidate read. The per-account daily cap is five, so this
 * is not a throughput limit — it is the bound that keeps the follow-up reads
 * (bookings, messages) narrow `.in(...)` queries rather than table scans.
 */
export const REACTIVATION_CANDIDATE_LIMIT = 200;

/**
 * HOW MANY PAGES ONE TICK WILL WALK, and why there is a walk at all.
 *
 * A single page plus client-side eligibility STARVES. The candidate read can
 * only express "this account, quiet since the cutoff, unstamped, has an
 * email" — the completed-booking rule cannot be a predicate on the same
 * query. So a page whose rows are all LEADS (a contact who wrote in, never
 * booked, and never will) survives the query, fails the booking read, and —
 * because the order is deterministic and oldest-first, and nothing ever
 * stamps a row that did not send — occupies the head of the window on EVERY
 * subsequent tick. An account with 200+ old lead conversations would get an
 * empty due-list for ever, with no error and no counter: the same class of
 * bug `release-held.ts:56-64` guards against.
 *
 * So the read walks pages until enough rows survive ALL the filters, or the
 * budget is spent. The residual bound is honest and worth stating: an
 * account with more than `LIMIT × PAGES` quiet, unstamped, emailable
 * conversations that have NEVER had a completed booking still starves, and
 * so does one whose pages are filled by a SUPPRESSED account's rows
 * (suppression is applied by `loadSendableRows`, after the page is read). At
 * 200 × 5 that is a thousand, which is far past any trades business this
 * product serves; if a real account reaches it, the counter to raise is
 * PAGES, and the fix after that is a `contacts.last_completed_booking_at`
 * column the candidate query can filter on directly.
 */
export const REACTIVATION_CANDIDATE_PAGES = 5;

/** Enough survivors to fill a tick, so the walk stops early in the normal
 *  case: `AUTOMATION_TICK_CAP` is 10 and the per-account daily cap is 5, so
 *  fifty covers ten accounts' worth of sends before the walk is pointless. */
export const REACTIVATION_SURVIVOR_TARGET = 50;

export type ReactivationConfig = { months: number };

/** jsonb is untrusted on read AND write. A whole number inside the range or
 *  null; no clamping, because silently turning a typo'd 99 into 18 would show
 *  the operator one number and send on another. */
export function parseReactivationConfig(raw: unknown): ReactivationConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { months } = raw as Record<string, unknown>;
  if (typeof months !== "number" || !Number.isInteger(months)) return null;
  if (months < REACTIVATION_MIN_MONTHS || months > REACTIVATION_MAX_MONTHS) return null;
  return { months };
}

/**
 * `now` minus whole CALENDAR months, clamped to the end of the target month.
 * Calendar months, not 30-day blocks, because "nine months" is what the
 * operator typed and what the card says. The clamp is what stops 31 August
 * minus six months becoming 3 March: `setUTCMonth` rolls a day that does not
 * exist in the target month forward, silently.
 *
 * UTC throughout: this produces a CUTOFF for a `timestamptz` comparison, not
 * a wall clock a person reads, so there is no zone to be wrong about.
 */
export function reactivationCutoff(now: Date, months: number): Date {
  const d = new Date(now.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - months);
  const lastDayOfTarget = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDayOfTarget));
  return d;
}

/** Email only in v1 (spec decision 4): there is no per-contact SMS consent in
 *  this schema — `contacts.dnd` is dead and the opt-out mechanism is Telnyx's
 *  carrier-side STOP list — and "we haven't seen you in a while" is marketing,
 *  not customer care, against an A2P campaign that does not exist yet. The
 *  row therefore carries no phone number at all. */
export type DueReactivation = {
  contactId: string; accountId: string;
  /** What `conversations.last_message_at` CLAIMED at the moment this row was
   *  built. Carried for the pass's console line on the heard-back skip: when
   *  the exact re-check disagrees with this column, that line is the only
   *  place the lag is visible. There is deliberately NO `conversationId` —
   *  nothing downstream takes one (`conversationQuietSince` looks the
   *  conversation up from the contact), and a field nobody reads is a field
   *  that drifts. */
  lastMessageAt: string;
  /** This account's configured quiet period, carried so the release can
   *  re-derive the same cutoff without re-reading the config. */
  quietMonths: number;
  contactEmail: string;
  /** For the greeting. Never `accounts.name`. */
  contactName: string;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  body: string;
};

/** One page's worth of candidate conversation, contact already joined. */
type ReactivationCandidate = {
  id: string; account_id: string; contact_id: string; last_message_at: string;
  contacts: { id: string; first_name: string | null; last_name: string | null; email: string };
};

/**
 * ONE read up front, then THREE PER PAGE, and every predicate that CAN be
 * server-side is.
 *
 *   1. (once) which accounts have the recipe on, and with what config;
 *   2. conversations quiet since the WIDEST cutoff, oldest first, one page at
 *      a time, with `contacts!inner(...)` carrying the two contact
 *      predicates — unstamped and has an email — INTO the same query
 *      (`calendars!inner` + `.eq("calendars.followup_enabled", true)` in
 *      `booking.ts:638` and `:663` is the precedent for the shape);
 *   3. bookings: at least one COMPLETED — the rule that stops this being a
 *      blast, and it is a query predicate, not a hope. It cannot join onto
 *      read 2 (there is no path from `conversations` to `bookings`), so it is
 *      the one eligibility test that stays client-side, and it is the reason
 *      the candidate read WALKS PAGES instead of taking one;
 *   4. messages: the lagging-touch PRE-FILTER. `createMessage` touches
 *      `conversations.last_message_at` best-effort and non-fatally
 *      (messaging.ts:120-131), so the column can LAG reality.
 *
 * WHY `months` STAYS CLIENT-SIDE (amendment B5's real argument): it is
 * PER-ACCOUNT config, and one query cannot carry four different cutoffs. So
 * the widest (latest, most permissive) cutoff goes to Postgres and each row
 * is then narrowed to its OWN account's. Pushing the contact predicates into
 * the query does not touch that split.
 *
 * WHY THE MESSAGE READ QUERIES THE EARLIEST CUTOFF, NOT THE WIDEST: the
 * question is "does this conversation have a message newer than THIS
 * account's cutoff", and an account with a LONGER quiet period has an
 * EARLIER cutoff, so `> widest` would miss exactly the messages that matter
 * to it. Concrete: account A is set to 18 months, account B to 6; `widest` is
 * B's cutoff; a contact of A who last wrote ten months ago is newer than A's
 * cutoff but older than B's, and a `> widest` read would not see the message
 * at all — A's customer would then be told "it's been a while since we were
 * out at your place" ten months after writing in. So the read is `>
 * earliest` (a superset for every account) and each row is compared to its
 * OWN account's cutoff.
 *
 * AND THE READ IS A PRE-FILTER, NOT THE GUARD. Its `.limit()` bounds MESSAGE
 * ROWS, not conversations, so one chatty conversation can consume the whole
 * page's budget and leave the others unchecked. That is survivable — and only
 * survivable — because `processReactivations` calls `conversationQuietSince`
 * EXACTLY, per row, immediately before sending. A miss here can only let a
 * not-quiet row through to that check; it can never drop a quiet one.
 */
export async function listDueReactivations(
  db: SupabaseClient, nowIso: string,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<DueReactivation[]> {
  const enabled = await listEnabled(db, "reactivation", "listDueReactivations");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso);
  // Per-account cutoffs. A config that does not parse SKIPS THE ACCOUNT —
  // `null` means "treat as missing and send nothing", the contract every
  // other recipe keeps (`parseReviewRequestConfig`'s doc, automations.ts:112-118).
  // Defaulting to nine months here would send on a number the operator never
  // chose, for the one recipe with spam teeth.
  const cutoffs = new Map<string, { cutoff: Date; months: number; body: string }>();
  for (const [accountId, auto] of enabled) {
    const config = parseReactivationConfig(auto.config);
    if (config === null) {
      console.error(
        `listDueReactivations: account ${accountId}'s reactivation config is missing or invalid `
        + `— skipping the account rather than sending on a default nobody chose`,
      );
      continue;
    }
    cutoffs.set(accountId, {
      cutoff: reactivationCutoff(now, config.months), months: config.months, body: auto.body,
    });
  }
  if (cutoffs.size === 0) return [];

  const accountIds = [...cutoffs.keys()];
  const cutoffTimes = [...cutoffs.values()].map((c) => c.cutoff.getTime());
  const widest = new Date(Math.max(...cutoffTimes));     // latest — the query's superset
  const earliest = new Date(Math.min(...cutoffTimes));   // earliest — the message read's superset

  const pageSize = opts.pageSize ?? REACTIVATION_CANDIDATE_LIMIT;
  const maxPages = opts.maxPages ?? REACTIVATION_CANDIDATE_PAGES;
  const out: DueReactivation[] = [];

  for (let page = 0; page < maxPages && out.length < REACTIVATION_SURVIVOR_TARGET; page++) {
    const from = page * pageSize;
    // `conversations_account_recent (account_id, last_message_at desc nulls
    // last)` (0005) serves the account + range + order; a DESC index scans
    // backward for an ASC order at no cost. `id` is the tiebreaker, without
    // which two conversations sharing a `last_message_at` could swap places
    // between pages and one of them would never be read.
    const { data: convos, error: cErr } = await db.from("conversations")
      .select("id, account_id, contact_id, last_message_at, contacts!inner(id, first_name, last_name, email)")
      .in("account_id", accountIds)
      .lte("last_message_at", widest.toISOString())
      .is("contacts.reactivation_sent_at", null)
      .not("contacts.email", "is", null)
      .order("last_message_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (cErr) throw new Error(`listDueReactivations conversations read failed: ${cErr.message}`);

    const rows = (convos ?? []) as unknown as ReactivationCandidate[];
    if (rows.length === 0) break;

    // Narrow each candidate to ITS OWN account's cutoff. A null
    // `last_message_at` never reaches here (`lte` excludes nulls), which is
    // right: a conversation with no messages says nothing about how long it
    // has been.
    const candidates = rows.filter(
      (c) => new Date(c.last_message_at).getTime() <= cutoffs.get(c.account_id)!.cutoff.getTime());

    if (candidates.length > 0) {
      // THE ANTI-BLAST RULE. Not "a contact", not "a lead" — someone whose
      // job this company actually completed. Served by 0047's
      // `bookings_completed_by_contact` on `(contact_id) where status =
      // 'completed'`; before it there was no index on `bookings.contact_id`
      // at all and this was a sequential scan every tick.
      const { data: done, error: bErr } = await db.from("bookings")
        .select("contact_id")
        .in("contact_id", candidates.map((c) => c.contact_id))
        .eq("status", "completed");
      if (bErr) throw new Error(`listDueReactivations bookings read failed: ${bErr.message}`);
      const customers = new Set(((done ?? []) as { contact_id: string }[]).map((b) => b.contact_id));

      // `account_id` is in the filter so `messages_thread (account_id,
      // conversation_id, created_at)` (0005) can be used — without a
      // constraint on the leading column it cannot be.
      const { data: recent, error: mErr } = await db.from("messages")
        .select("conversation_id, created_at")
        .in("account_id", accountIds)
        .in("conversation_id", candidates.map((c) => c.id))
        .gt("created_at", earliest.toISOString())
        .limit(REACTIVATION_CANDIDATE_LIMIT);
      if (mErr) throw new Error(`listDueReactivations messages read failed: ${mErr.message}`);
      const newestByConversation = new Map<string, number>();
      for (const r of (recent ?? []) as { conversation_id: string; created_at: string }[]) {
        const t = new Date(r.created_at).getTime();
        const seen = newestByConversation.get(r.conversation_id);
        if (seen === undefined || t > seen) newestByConversation.set(r.conversation_id, t);
      }

      const surviving = candidates.filter((c) => {
        if (!customers.has(c.contact_id)) return false;
        const newest = newestByConversation.get(c.id);
        // Compared to THIS account's cutoff, never to `earliest`.
        return newest === undefined || newest <= cutoffs.get(c.account_id)!.cutoff.getTime();
      });

      if (surviving.length > 0) {
        // No cast. `loadSendableRows` is generic over `T extends
        // { account_id: string }` (`booking.ts:512-514`), so casting to
        // `{ account_id: string }[]` pins `T` to exactly that and erases
        // `contact_id`, `id` and `last_message_at` from `sendable`.
        const { sendable, accountInfo } = await loadSendableRows(
          db, surviving, "listDueReactivations");

        for (const c of sendable) {
          const info = accountInfo.get(c.account_id)!;
          const conf = cutoffs.get(c.account_id)!;
          out.push({
            contactId: c.contact_id, accountId: c.account_id,
            lastMessageAt: c.last_message_at, quietMonths: conf.months,
            contactEmail: c.contacts.email,
            contactName: [c.contacts.first_name, c.contacts.last_name].filter(Boolean).join(" ").trim(),
            brandName: brandDisplayName(info.branding), branding: info.branding,
            accountTimezone: info.accountTimezone, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail,
            body: conf.body,
          });
        }
      }
    }

    if (rows.length < pageSize) break;   // the end of the data, not the budget
  }

  return out;
}

/**
 * The release's re-read. It does NOT apply the quiet test: the releaser
 * applies it separately, through `conversationQuietSince`, so that "they
 * wrote in during the hold" gets its own client-readable reason instead of a
 * flat "No longer due".
 */
export async function getDueReactivationById(
  db: SupabaseClient, contactId: string,
): Promise<DueLookup<DueReactivation>> {
  const { data: contact, error } = await db.from("contacts")
    .select("id, account_id, first_name, last_name, email, reactivation_sent_at")
    .eq("id", contactId).is("reactivation_sent_at", null).not("email", "is", null).maybeSingle();
  if (error) throw new Error(`getDueReactivationById failed: ${error.message}`);
  if (!contact) return { due: null, why: "gone" };
  const accountId = (contact as { account_id: string }).account_id;

  const auto = await enabledRecipeFor(db, accountId, "reactivation");
  if (!auto) return { due: null, why: "off" };
  // A config that does not parse is `off`, never a default: `null` means
  // "treat as missing and send nothing" (automations.ts:112-118), and a
  // release that fell back to nine months would send on a number the
  // operator never chose. Answering `off` also keeps the released row from
  // parking — `releaseReactivation` writes `REASONS.recipeOff` and the hold
  // leaves the queue.
  const config = parseReactivationConfig(auto.config);
  if (config === null) return { due: null, why: "off" };

  const { data: done, error: bErr } = await db.from("bookings")
    .select("id").eq("contact_id", contactId).eq("status", "completed").limit(1).maybeSingle();
  if (bErr) throw new Error(`getDueReactivationById bookings read failed: ${bErr.message}`);
  if (!done) return { due: null, why: "gone" };

  const { data: convo, error: cErr } = await db.from("conversations")
    .select("id, last_message_at").eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (cErr) throw new Error(`getDueReactivationById conversation read failed: ${cErr.message}`);
  if (!convo || !(convo as { last_message_at: string | null }).last_message_at) return { due: null, why: "gone" };

  const { sendable, accountInfo } = await loadSendableRows(
    db, [{ account_id: accountId }], "getDueReactivationById");
  if (sendable.length === 0) return { due: null, why: "off" };

  const c = contact as { first_name: string | null; last_name: string | null; email: string };
  const info = accountInfo.get(accountId)!;
  return {
    due: {
      contactId, accountId,
      lastMessageAt: (convo as { last_message_at: string }).last_message_at,
      quietMonths: config.months,
      contactEmail: c.email,
      contactName: [c.first_name, c.last_name].filter(Boolean).join(" ").trim(),
      brandName: brandDisplayName(info.branding), branding: info.branding,
      accountTimezone: info.accountTimezone, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail,
      body: auto.body,
    },
  };
}

/**
 * True when this contact's conversation carries NO message — in either
 * direction — newer than `sinceIso`. THE EXACT CHECK, and it runs twice:
 * once per row in `processReactivations` immediately before the send, and
 * again in `releaseReactivation`. Somebody who wrote in (or was written to)
 * must never then receive "it's been a while since we were out at your
 * place".
 *
 * It is exact where the due-list's bulk message read is only a PRE-FILTER:
 * that read is bounded by a row limit and answers for a page of
 * conversations at once, so a chatty conversation can crowd the others out
 * of its results. This one is scoped to a single conversation and takes no
 * limit, and `messages_thread (account_id, conversation_id, created_at)`
 * (0005:47) answers it from the index alone.
 *
 * Reads `messages`, not `conversations.last_message_at`, because that
 * column's touch is best-effort and can lag (messaging.ts:120-131). Both
 * directions count, because an operator who texted them last night has a
 * live relationship this recipe must not talk over.
 */
export async function conversationQuietSince(
  db: SupabaseClient, accountId: string, contactId: string, sinceIso: string,
): Promise<boolean> {
  const { data: convo, error } = await db.from("conversations")
    .select("id").eq("account_id", accountId).eq("contact_id", contactId).maybeSingle();
  if (error) throw new Error(`conversationQuietSince failed: ${error.message}`);
  if (!convo) return true;   // no conversation at all is as quiet as it gets
  const { count, error: mErr } = await db.from("messages")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .eq("conversation_id", (convo as { id: string }).id)
    .gt("created_at", sinceIso);
  if (mErr) throw new Error(`conversationQuietSince messages read failed: ${mErr.message}`);
  return (count ?? 0) === 0;
}

/** Send-then-stamp. ONE reactivation per contact, EVER — and this column is
 *  the off switch that outlives the toggle: turning the recipe off mid-drain
 *  strands nothing, because the stamp is permanent. */
export async function stampReactivationSent(db: SupabaseClient, contactId: string): Promise<void> {
  const { error } = await db.from("contacts")
    .update({ reactivation_sent_at: new Date().toISOString() })
    .eq("id", contactId);
  if (error) throw new Error(`stampReactivationSent failed: ${error.message}`);
}

/** The input to REACTIVATION_DAILY_CAP — five per account per rolling day,
 *  its own cap and not the platform's 25 (25 a day is 750 people a month who
 *  did not just interact with the business, which is a blast). Served by
 *  0047's `contacts_reactivation_count` on
 *  `(account_id, reactivation_sent_at) where reactivation_sent_at is not null`. */
export async function countReactivationsSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("contacts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("reactivation_sent_at", sinceIso);
  if (error) throw new Error(`countReactivationsSince failed: ${error.message}`);
  return count ?? 0;
}
```

- [ ] **Step 3: Export**

Append to `packages/db/src/index.ts`'s `./automations` list:

```ts
         parseReactivationConfig, reactivationCutoff, listDueReactivations, getDueReactivationById,
         conversationQuietSince, stampReactivationSent, countReactivationsSince,
         REACTIVATION_MIN_MONTHS, REACTIVATION_MAX_MONTHS, REACTIVATION_DEFAULT_MONTHS,
         REACTIVATION_CANDIDATE_LIMIT, REACTIVATION_CANDIDATE_PAGES, REACTIVATION_SURVIVOR_TARGET,
         type ReactivationConfig, type DueReactivation,
```

- [ ] **Step 4: Live tests**

```ts
describe("reactivation — the cutoff is calendar months, clamped", () => {
  it("subtracts whole months", () => {
    expect(reactivationCutoff(new Date("2027-09-21T12:00:00Z"), 9).toISOString())
      .toBe("2026-12-21T12:00:00.000Z");
    expect(reactivationCutoff(new Date("2027-09-21T12:00:00Z"), 6).toISOString())
      .toBe("2027-03-21T12:00:00.000Z");
  });

  it("clamps a day the target month does not have, instead of rolling forward", () => {
    // 31 August minus six months is February. Mutation: drop the clamp and
    // `setUTCMonth` silently produces 3 March — this goes red BY NAME.
    expect(reactivationCutoff(new Date("2027-08-31T12:00:00Z"), 6).toISOString())
      .toBe("2027-02-28T12:00:00.000Z");
    expect(reactivationCutoff(new Date("2028-08-31T12:00:00Z"), 6).toISOString())
      .toBe("2028-02-29T12:00:00.000Z");   // a leap year, and the clamp still holds
  });

  it("parseReactivationConfig takes a whole number in range and refuses everything else", () => {
    expect(parseReactivationConfig({ months: 9 })).toEqual({ months: 9 });
    expect(parseReactivationConfig({ months: REACTIVATION_MIN_MONTHS })).toEqual({ months: 6 });
    expect(parseReactivationConfig({ months: REACTIVATION_MAX_MONTHS })).toEqual({ months: 18 });
    // ONE outside each bound, never 99: a fixture far past the bound passes
    // against any range.
    for (const bad of [null, undefined, {}, { months: "9" }, { months: 9.5 },
                       { months: REACTIVATION_MIN_MONTHS - 1 }, { months: REACTIVATION_MAX_MONTHS + 1 }]) {
      expect(parseReactivationConfig(bad), JSON.stringify(bad)).toBeNull();
    }
    // Mutation: clamp instead of refusing → the two boundary-adjacent rows red.
  });
});

describe("reactivation — data layer", () => {
  it("a quiet past CUSTOMER with an email is due; a quiet contact with no completed booking is NOT", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const longAgo = new Date("2026-10-01T12:00:00Z");    // ~11.7 months, well inside 9

      const mkPerson = async (name: string, completed: boolean) => {
        const { id } = await createContact(db, accountId,
          { firstName: name, email: `${name.toLowerCase()}@example.com` }, "user_test");
        const convo = await ensureConversation(db, accountId, id, "user_test");
        await createMessage(db, accountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
        await db.from("messages").update({ created_at: longAgo.toISOString() }).eq("conversation_id", convo.id);
        await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);
        if (completed) {
          const b = await createBooking(db, accountId,
            { calendarId: cal.id, contactId: id, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo }, "user_test");
          await setBookingStatus(db, accountId, b.id, "completed", "user_test");
        }
        return id;
      };

      const customer = await mkPerson("Customer", true);
      const stranger = await mkPerson("Stranger", false);

      const ids = (await listDueReactivations(db, now.toISOString())).map((r) => r.contactId);
      expect(ids).toContain(customer);
      // THE ANTI-BLAST RULE. Mutation: drop the completed-booking read → this
      // goes red, and the recipe becomes a mailing list.
      expect(ids).not.toContain(stranger);

      const row = (await listDueReactivations(db, now.toISOString())).find((r) => r.contactId === customer)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row).not.toHaveProperty("contactPhone");     // email only: no address it must not use
      expect(row.contactEmail).toBe("customer@example.com");
      expect(row.quietMonths).toBe(9);
    });
  });

  it("a contact already reactivated is never due again, and the quiet period is respected at the boundary", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const cutoff = reactivationCutoff(now, 9);

      const mk = async (name: string, lastMessageAt: Date) => {
        const { id } = await createContact(db, accountId,
          { firstName: name, email: `${name.toLowerCase()}@example.com` }, "user_test");
        const convo = await ensureConversation(db, accountId, id, "user_test");
        await createMessage(db, accountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
        await db.from("messages").update({ created_at: lastMessageAt.toISOString() }).eq("conversation_id", convo.id);
        await db.from("conversations").update({ last_message_at: lastMessageAt.toISOString() }).eq("id", convo.id);
        const b = await createBooking(db, accountId,
          { calendarId: cal.id, contactId: id, startsAt: new Date(lastMessageAt.getTime() - HOUR), endsAt: lastMessageAt }, "user_test");
        await setBookingStatus(db, accountId, b.id, "completed", "user_test");
        return id;
      };

      // ONE MILLISECOND either side of the cutoff, never "a year ago".
      const atCutoff = await mk("Atcut", cutoff);
      const insideCutoff = await mk("Inside", new Date(cutoff.getTime() + 1));
      const already = await mk("Already", new Date(cutoff.getTime() - 1000));
      await stampReactivationSent(db, already);

      const ids = (await listDueReactivations(db, now.toISOString())).map((r) => r.contactId);
      expect(ids).toContain(atCutoff);
      expect(ids).not.toContain(insideCutoff);   // Mutation: change lte to lt / widen months
      expect(ids).not.toContain(already);        // Mutation: drop the reactivation_sent_at filter
    });
  });

  it("the lagging-touch guard drops a contact whose conversation actually has a newer message", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const longAgo = new Date("2026-10-01T12:00:00Z");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Lagged", email: "lagged@example.com" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id: oldMsg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "old" }, "user_test");
      await db.from("messages").update({ created_at: longAgo.toISOString() }).eq("id", oldMsg);
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      // The column says quiet; the messages table says otherwise. This is the
      // exact shape messaging.ts:120-131 admits is possible.
      await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);
      const { id: newMsg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "actually I wrote in last week" }, "user_test");
      // REWRITE THE NEWER MESSAGE'S CLOCK TOO. `createMessage` inserts no
      // `created_at`, so the column takes `now()` — REAL time, which is
      // months BEFORE the faked 2027 `now` and therefore before the 2026-12
      // cutoff as well. Left alone, the "newer" message is older than the
      // cutoff, the contact stays due, and every assertion below inverts.
      // This is the trap this file's own doc comment records at
      // `automations.test.ts:179-185`, and every other fixture in this task
      // rewrites the clock; the one that IS the test must too.
      await db.from("messages").update({ created_at: new Date(now.getTime() - 7 * 24 * HOUR).toISOString() })
        .eq("id", newMsg);
      await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);

      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).not.toContain(contactId);
      // Mutation: delete the messages read from listDueReactivations → this
      // goes red, and someone who wrote in last week is told "it's been a
      // while".
      expect(await conversationQuietSince(db, accountId, contactId, longAgo.toISOString())).toBe(false);
      // The floor is the FAKED now, not `new Date()`: nothing in this fixture
      // is on the real clock, and a real-clock floor would answer `true` for
      // the wrong reason.
      expect(await conversationQuietSince(db, accountId, contactId, now.toISOString())).toBe(true);
    });
  });

  it("the guard compares each account to ITS OWN cutoff, not the widest across accounts", async () => {
    // TWO ACCOUNTS, one set to 18 months and one to 6. The widest (latest,
    // most permissive) cutoff is the 6-month account's, so a bulk message
    // read written against `widest` cannot see a message that is newer than
    // the 18-month account's cutoff but older than the 6-month one's — and
    // that account's customer is then told "it's been a while since we were
    // out at your place" ten months after writing in.
    await withTestAccount(async (db, longAccountId) => {
      await withTestAccount(async (db2, shortAccountId) => {
        void db2;
        const now = new Date("2027-09-21T12:00:00Z");
        await upsertAutomation(db, longAccountId, "reactivation",
          { enabled: true, body: "", config: { months: 18 } }, "user_test");
        await upsertAutomation(db, shortAccountId, "reactivation",
          { enabled: true, body: "", config: { months: 6 } }, "user_test");

        const cal = await getOrCreateCalendar(db, longAccountId, "user_test");
        const { id: contactId } = await createContact(db, longAccountId,
          { firstName: "Tenmonths", email: "ten@example.com" }, "user_test");
        const convo = await ensureConversation(db, longAccountId, contactId, "user_test");
        // The column LAGS at 20 months; the real newest message is 10 months
        // old — inside 18 months, outside 6.
        const lagged = new Date("2026-01-21T12:00:00Z");     // 20 months
        const real = new Date("2026-11-21T12:00:00Z");       // 10 months
        const { id: msg } = await createMessage(db, longAccountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
        await db.from("messages").update({ created_at: real.toISOString() }).eq("id", msg);
        await db.from("conversations").update({ last_message_at: lagged.toISOString() }).eq("id", convo.id);
        const b = await createBooking(db, longAccountId,
          { calendarId: cal.id, contactId, startsAt: new Date(lagged.getTime() - HOUR), endsAt: lagged }, "user_test");
        await setBookingStatus(db, longAccountId, b.id, "completed", "user_test");

        // Mutation: query the message read on `widest` instead of `earliest`,
        // or compare every row to `widest` instead of its own account's
        // cutoff → this reds, and only this.
        expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId))
          .not.toContain(contactId);
      });
    });
  });

  it("walks past a page of contacts that can never qualify — the oldest-first window is not parked by leads", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");

      // Three quiet, unstamped, emailable contacts, OLDEST FIRST. The two
      // oldest are leads — a contact who wrote in, never booked, and never
      // will — so they survive the candidate query and fail the
      // completed-booking read on every tick, for ever.
      const mk = async (name: string, at: Date, completed: boolean) => {
        const { id } = await createContact(db, accountId,
          { firstName: name, email: `${name.toLowerCase()}@example.com` }, "user_test");
        const convo = await ensureConversation(db, accountId, id, "user_test");
        const { id: msg } = await createMessage(db, accountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
        await db.from("messages").update({ created_at: at.toISOString() }).eq("id", msg);
        await db.from("conversations").update({ last_message_at: at.toISOString() }).eq("id", convo.id);
        if (completed) {
          const b = await createBooking(db, accountId,
            { calendarId: cal.id, contactId: id, startsAt: new Date(at.getTime() - HOUR), endsAt: at }, "user_test");
          await setBookingStatus(db, accountId, b.id, "completed", "user_test");
        }
        return id;
      };
      // Deliberately ancient, and that is what makes the page numbers
      // reliable: the candidate read is platform-wide (`.in("account_id",
      // <every enabled account>)`), so a conversation left by a concurrent
      // run could otherwise land between these three and push the customer
      // past page 3. Nothing else in this project carries a 2020 timestamp,
      // so these three are the first three rows of an oldest-first walk.
      // (The db suite also runs ONE AT A TIME across implementers — the
      // slot — which is the backstop, not the guarantee.)
      await mk("Leadone", new Date("2020-01-01T12:00:00Z"), false);
      await mk("Leadtwo", new Date("2020-02-01T12:00:00Z"), false);
      const customer = await mk("Customer", new Date("2020-03-01T12:00:00Z"), true);

      // ONE conversation per page, so the customer is only reachable on the
      // third. Mutation: read one page and return (the shape this plan
      // started with) → this reds, and an account whose oldest conversations
      // are all leads gets an empty due-list on every tick, for ever, with no
      // error and no counter.
      expect((await listDueReactivations(db, now.toISOString(), { pageSize: 1, maxPages: 3 }))
        .map((r) => r.contactId)).toContain(customer);
      // And the page size is real, not decorative: one page reaches only the
      // oldest lead. Without this half the assertion above would pass against
      // an implementation that ignored `pageSize` entirely.
      expect((await listDueReactivations(db, now.toISOString(), { pageSize: 1, maxPages: 1 }))
        .map((r) => r.contactId)).not.toContain(customer);
    });
  });

  it("an account whose stored config does not parse is skipped, never defaulted to nine months", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const longAgo = new Date("2026-10-01T12:00:00Z");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Bad", email: "bad@example.com" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id: msg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
      await db.from("messages").update({ created_at: longAgo.toISOString() }).eq("id", msg);
      await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).toContain(contactId);
      expect((await getDueReactivationById(db, contactId)).due?.contactId).toBe(contactId);

      // Straight to the column: `upsertAutomation` validates on write, and
      // the case being proved is a row that went bad UNDER the app.
      await db.from("automations").update({ config: { months: 99 } })
        .eq("account_id", accountId).eq("recipe_key", "reactivation");
      // Mutation: restore `?? { months: REACTIVATION_DEFAULT_MONTHS }` in
      // either place → both of these red, and the one recipe with spam teeth
      // sends on a number the operator never chose.
      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).not.toContain(contactId);
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "off" });
    });
  });

  it("a suppressed account's customer is never due, by list or by id; and the cap counts stamps", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const longAgo = new Date("2026-10-01T12:00:00Z");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Hushed", email: "hushed@example.com" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id: msg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
      await db.from("messages").update({ created_at: longAgo.toISOString() }).eq("id", msg);
      await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");

      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).toContain(contactId);
      expect((await getDueReactivationById(db, contactId)).due?.contactId).toBe(contactId);

      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).not.toContain(contactId);
      expect((await getDueReactivationById(db, contactId)).due).toBeNull();
      await db.from("accounts").update({ outbound_suppressed: false }).eq("id", accountId);

      const before = new Date();
      await stampReactivationSent(db, contactId);
      await stampReactivationSent(db, contactId);   // idempotent
      expect(await countReactivationsSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(1);
      expect(await countReactivationsSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "gone" });
    });
  });
});
```

> `ensureConversation` and `createMessage` come from `../messaging`. Read that module's signatures before writing — this plan's calls follow `packages/db/src/test/messaging.test.ts`, and **the source wins** if they differ.

> **One shape in this task has no precedent in the repo and the live suite is what proves it:** `contacts!inner(...)` embedded from `conversations`, with `.is("contacts.reactivation_sent_at", null)` and `.not("contacts.email", "is", null)` filtering on the embedded table. The one-level `!inner` + dotted-path filter is exactly `listDueFollowups`' shape (`booking.ts:638`, `:663`), and both FKs are single and unambiguous (`conversations.contact_id → contacts.id`, `0005_messaging.sql:14`), so the join direction cannot be mistaken. What is NOT proven until the slot runs is whether PostgREST returns `contacts` as an OBJECT here (it should — the FK is on `conversations`, so the embed is to-one, same as `calendars(...)` and `contacts(...)` in `booking.ts`). **If the first live run returns an array, take the first element rather than reaching for a second query, and say so in the report.**

- [ ] **Step 5: Run, mutate, commit**

```bash
pnpm --filter @bis/db typecheck
pnpm --filter @bis/db exec vitest run src/test/automations.test.ts src/__tests__/outbound-suppressed.test.ts > /tmp/task7.log 2>&1; echo "exit=$?" >> /tmp/task7.log
```

**Typecheck is the first gate and it is not a formality here.** `loadSendableRows` is
generic over `T extends { account_id: string }` (`booking.ts:512-514`); casting the
candidate array to `{ account_id: string }[]` pins `T` to exactly that and the
`sendable` rows lose `contact_id`, `id`, `last_message_at` and `contacts`. Pass
`surviving` unannotated and uncast. If `pnpm --filter @bis/db typecheck` reports
`TS2339: Property 'contact_id' does not exist on type '{ account_id: string; }'`,
a cast has crept back in.

Mutations, each reverted, each named test confirmed red:

| Mutation | Test that must red |
| --- | --- |
| swap `loadSendableRows` for `loadAccountBrandInfo` | the suppression walk, by function name |
| drop the clamp from `reactivationCutoff` | `clamps a day the target month does not have, instead of rolling forward` |
| clamp instead of refusing in `parseReactivationConfig` | `parseReactivationConfig takes a whole number in range and refuses everything else` |
| drop the completed-booking read | `a quiet past CUSTOMER with an email is due; a quiet contact with no completed booking is NOT` |
| change the candidate read's `lte` to `lt` | `a contact already reactivated is never due again…` (the at-cutoff row) |
| delete the messages read from `listDueReactivations` | `the lagging-touch guard drops a contact whose conversation actually has a newer message` |
| query the messages read on `widest` instead of `earliest` (or compare rows to `widest`) | `the guard compares each account to ITS OWN cutoff, not the widest across accounts` |
| read one page and return instead of walking | `walks past a page of contacts that can never qualify` |
| restore `?? { months: REACTIVATION_DEFAULT_MONTHS }` in either place | `an account whose stored config does not parse is skipped, never defaulted to nine months` |

```bash
git add packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts
git commit -m "db(automations): reactivation due-list — quiet, unstamped, emailable, and a completed job"
```

---

### Task 8: `reactivation` — the recipe (bis-automations)

**Files:**
- Modify: `packages/db/src/automation-log.ts` (`"reactivation"`)
- Modify: `apps/web/src/lib/automations/caps.ts` — **TWO edits:** the new `REACTIVATION_DAILY_CAP`, and the file's opening doc comment grows to name `appointment_confirm` as the **third** uncapped pass (Task 3's decision, documented here because this is the file that states which passes are capped). Third, not second: `caps.ts:3-5` already names TWO — "the reminder and follow-up passes are uncapped". The File Structure entry near the top of this plan still says "second"; it is wrong and the orchestrator lands the correction there.
- Modify: `apps/web/src/lib/automations/hold-or-send.ts` (`REASONS.heardBack`)
- Create: `apps/web/src/lib/automations/reactivation-gate.ts` (+ `.test.ts`), `reactivation-copy.ts` (+ `.test.ts`), `passes/reactivation.ts` (+ `.test.ts`)
- Create: `apps/web/src/lib/email/templates/reactivation.ts` (+ `.test.ts`)
- Modify: `release-held.ts`, `log-titles.ts`, `registry.ts`, `sentinel.test.ts`, `route.test.ts`, `messages.ts`
- Create: `…/automations/reactivation-card.tsx`; Modify: `…/automations/{page.tsx,actions.ts,page.test.ts,actions.test.ts}`

- [ ] **Step 1: The caps**

```ts
/**
 * REACTIVATION'S OWN CAP (danlo, 2026-09-21), and the reason it is not the
 * platform's 25: 25 a day is 750 people a month who did NOT just interact
 * with the business, which is a blast. Five is a number an operator can read
 * in their sent folder. Counted per account per rolling 24h off
 * `contacts.reactivation_sent_at`, and it composes with the harder limit the
 * schema itself enforces — one reactivation per contact, ever.
 */
export const REACTIVATION_DAILY_CAP = 5;
```

and in the file's opening block comment, after "the reminder and follow-up passes are uncapped", add:

```
 * The appointment-confirmation ask is the third uncapped send (danlo,
 * 2026-09-21, part B decision 2): it is keyed on `starts_at` inside a
 * 75-minute window, so no status change and no import can burst it, and a
 * fully-booked Saturday would otherwise leave five customers unasked.
```

- [ ] **Step 2: The gate, tests first**

`reactivation-gate.test.ts` — `shouldSendReactivationNow(now, timezone)` is the morning band plus a resolvable zone, and nothing else: the quiet period is a query predicate (Task 7), not a gate.

```ts
import { describe, it, expect } from "vitest";
import { shouldSendReactivationNow } from "./reactivation-gate";

const ZONE = "America/Chicago";
const WEST = "America/Los_Angeles";
describe("when a reactivation email may go", () => {
  it("is inside the morning band at 08:00 and 10:59, outside at 07:59 and 11:00", () => {
    expect(shouldSendReactivationNow(new Date("2027-09-21T12:59:00Z"), ZONE)).toBe(false);  // 07:59
    expect(shouldSendReactivationNow(new Date("2027-09-21T13:00:00Z"), ZONE)).toBe(true);   // 08:00
    expect(shouldSendReactivationNow(new Date("2027-09-21T15:59:00Z"), ZONE)).toBe(true);   // 10:59
    expect(shouldSendReactivationNow(new Date("2027-09-21T16:00:00Z"), ZONE)).toBe(false);  // 11:00
    // Mutation: widen the band by an hour → the 07:59 or the 11:00 row reds.
  });

  /**
   * ONE INSTANT, TWO ZONES, OPPOSITE VERDICTS — the house rule for every
   * zone-dependent test (`review-request-gate.test.ts:7-12` states it,
   * `:23-24` demonstrates it). Without it, every case in this file pins
   * America/Chicago, which is this machine's zone, and a gate that ignored
   * its `timezone` argument entirely would pass all of them. 13:00Z is 08:00
   * in Chicago (the band's first minute) and 06:00 in Los Angeles.
   */
  it("reads the ACCOUNT's zone, not the machine's: the same instant sends in Chicago and waits in Los Angeles", () => {
    const instant = new Date("2027-09-21T13:00:00Z");
    expect(shouldSendReactivationNow(instant, ZONE)).toBe(true);
    expect(shouldSendReactivationNow(instant, WEST)).toBe(false);
    // Mutation: hard-code `"America/Chicago"` inside the gate → the second
    // line reds.
  });

  it("fails CLOSED on a zone Intl cannot resolve, and on an unreadable instant — and an explicit UTC account still works", () => {
    // THE JUNK LIST IS THE THREE SIBLING GATES' LIST, verbatim
    // (`review-request-gate.test.ts:34-37`, `no-show-nudge-gate.test.ts:34`,
    // `followup-timing.test.ts:196`). NOT `"CST"`: `resolveAccountZone` is
    // `safeZone(tz, ZONE_UNRESOLVABLE)` and `safeZone`'s whole validation is
    // "did `new Intl.DateTimeFormat` throw" (`lib/booking/time.ts:20-30`,
    // `followup-timing.ts:122-125`). ICU RESOLVES `CST` — to America/Chicago,
    // verified — so asserting `false` for it would fail against a CORRECT
    // gate and invite an implementer to weaken the fail-closed rule to make
    // it pass. (`followup-timing.ts:110` names "the operator typed CST" as
    // the bug it was written for; the fix was the sentinel fallback, not a
    // claim that ICU rejects the string.)
    const utcMorning = new Date("2027-09-21T09:30:00Z");
    expect(shouldSendReactivationNow(utcMorning, "UTC")).toBe(true);           // the positive control
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(shouldSendReactivationNow(utcMorning, junk), junk).toBe(false);
    }
    expect(shouldSendReactivationNow(new Date("nonsense"), ZONE)).toBe(false);
  });
});
```

```ts
import { resolveAccountZone, isInMorningBand } from "@/lib/booking/followup-timing";

/**
 * WHEN a reactivation email may go — and that is ALL this gate decides. The
 * quiet period itself is a query predicate (listDueReactivations), not a
 * gate, because "has this person been silent for nine months" is a question
 * the database can answer once for every account rather than one the pass
 * asks per row.
 *
 * FAIL CLOSED on an unresolvable zone: no hour is defensible, and this runs
 * inside a cron tick with no one watching.
 */
export function shouldSendReactivationNow(now: Date, timezone: string): boolean {
  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;
  if (!Number.isFinite(now.getTime())) return false;
  return isInMorningBand(now, zone);
}
```

- [ ] **Step 3: The copy, the email, the message keys**

```ts
  "automations.reactivation.defaultBody": "Hi, it's {name}. It's been a while since we were out at your place. If anything needs looking at before the season, just reply and we'll get you on the schedule.",
  "automations.reactivation.defaultBodyNoName": "Hi. It's been a while since we were out at your place. If anything needs looking at before the season, just reply and we'll get you on the schedule.",
  "automations.reactivation.subject": "A note from {name}",
  "automations.reactivation.subjectNoName": "Checking in",
  "automations.reactivation.title": "Checking in with past customers",
  "automations.reactivation.body": "Email a past customer who hasn't been in touch for a while. Only people whose job you completed, at most five a day, and only once each — ever. Email only. Off until you turn it on.",
  "automations.reactivation.enabled": "Check in with past customers",
  "automations.reactivation.months": "Quiet for at least",
  "automations.reactivation.monthsUnit": "months",
  "automations.reactivation.monthsHint": "Between 6 and 18. Nine is a good default for seasonal work: last spring's customer still knows you.",
  "automations.reactivation.message": "Message",
  "automations.reactivation.messageHint": "Leave blank to send our default message. No discount, no offer — just an open door.",
  "automations.reactivation.limitNote": "At most five a day, oldest first, and never twice to the same person.",
  "automations.reactivation.save": "Save check-ins",
  "automations.reactivation.saved": "Check-ins saved",
  "automations.reactivation.saveFailed": "Could not save check-ins.",
  "automations.reactivation.monthsInvalid": "Choose a number of months between 6 and 18.",
```

`reactivation-copy.ts`:

```ts
import { m } from "@/lib/messages";

/**
 * What a past customer receives. Three things it deliberately is not: no
 * urgency, no discount, and no "we miss you". This message reaches someone
 * who has not thought about this business in nine months, and the only
 * version of it that is welcome is one that reads as a door left open.
 *
 * `brandName` is the customer-facing name; a blank one drops the clause.
 * Function replacement, not a plain string, for names containing `$&`.
 */
export function defaultReactivationBody(brandName: string): string {
  if (!brandName.trim()) return m["automations.reactivation.defaultBodyNoName"];
  return m["automations.reactivation.defaultBody"].replace("{name}", () => brandName);
}

/** Plain, the brand name, and no exclamation mark — a subject line that
 *  looks like a newsletter gets treated as one. */
export function reactivationSubject(brandName: string): string {
  if (!brandName.trim()) return m["automations.reactivation.subjectNoName"];
  return m["automations.reactivation.subject"].replace("{name}", () => brandName);
}
```

Its test asserts: the body names the brand; **contains no "http" and no "%" and no "off" discount language** (mutation: add "10% off" to the default → red); contains no `{{`; no `\bM[0-9][a-z]?\b`; the subject carries no `!` (mutation: add one → red). The no-name variants are asserted as **exact strings**, not `not.toContain("undefined")` plus a substring — deleting the blank-name branch yields `"Hi, it's    . It's been a while…"`, which satisfies both of those and reds nothing:

```ts
it("drops the naming clause when there is no brand name", () => {
  expect(defaultReactivationBody("   ")).toBe(m["automations.reactivation.defaultBodyNoName"]);
  expect(reactivationSubject("   ")).toBe(m["automations.reactivation.subjectNoName"]);
  // Mutation: delete either `if (!brandName.trim())` branch → this reds BY NAME.
});
```

Plus **two assertions that keep the card's prose honest about numbers it restates**, because copy is a static catalogue and cannot interpolate a constant — change a constant and the card would otherwise lie to the operator while the input and the parser silently used a different range:

```ts
// import { REACTIVATION_MIN_MONTHS, REACTIVATION_MAX_MONTHS } from "@bis/db";
// import { REACTIVATION_DAILY_CAP } from "./caps";
// import { m } from "@/lib/messages";
it("the month-range copy names the range the parser actually enforces", () => {
  const range = `between ${REACTIVATION_MIN_MONTHS} and ${REACTIVATION_MAX_MONTHS}`;
  for (const key of ["automations.reactivation.monthsHint", "automations.reactivation.monthsInvalid"] as const) {
    expect(m[key].toLowerCase(), key).toContain(range);
  }
  // Mutation: set REACTIVATION_MAX_MONTHS to 12 → both keys still read
  // "between 6 and 18" and this reds.
});

it("the copy names the daily limit the cap actually enforces", () => {
  // The two keys say "five" in WORDS — "5 a day" reads like a receipt — so
  // the copy cannot be derived from the constant. The guard is therefore a
  // literal pin on the constant, standing beside the strings it has to agree
  // with. Mutation: change REACTIVATION_DAILY_CAP to 8 → this reds, and the
  // two keys that have to change are named in the failure.
  expect(REACTIVATION_DAILY_CAP).toBe(5);
  for (const key of ["automations.reactivation.limitNote", "automations.reactivation.body"] as const) {
    expect(m[key].toLowerCase(), key).toContain("five a day");
  }
});
```

`apps/web/src/lib/email/templates/reactivation.ts` — `followup.ts`'s shape verbatim in structure (shell + escaped paragraphs, no button), with `subject` taken from the caller:

```ts
import { shell, escapeHtml, type EmailBrand } from "./shell";

export type ReactivationEmailInput = { brand: EmailBrand; subject: string; body: string };

/**
 * The check-in to a past customer. The FOLLOW-UP's restraint, not the review
 * request's: no button, because the action is "reply to this email", and a
 * button would need somewhere to point. A short personal note from a business
 * they know, not a campaign.
 */
export function reactivationEmail(input: ReactivationEmailInput):
  { subject: string; html: string; text: string } {
  const paragraphs = input.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const html = shell(
    input.brand, paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join(""));
  return { subject: input.subject, html, text: paragraphs.join("\n\n") };
}
```

Its test: the html escapes `<script>`; the text part carries the paragraph breaks and no tags; **the html contains no `href`** (mutation: add a button → red).

- [ ] **Step 4: Register the source**

`AUTOMATION_LOG_SOURCES` gains `"reactivation"`. Run `pnpm --filter web typecheck`, paste the two TS2741 errors, then answer them with real entries below. Do not widen either map.

- [ ] **Step 5: The pass — tests first**

`passes/reactivation.test.ts`, the Task 3 shape with mocks `listDueReactivations, getDueReactivationById, stampReactivationSent, countReactivationsSince, conversationQuietSince, recordAutomationLog, getAutomationLogEntry`. `ctx.email.send` is a spy. `conversationQuietSince` defaults to `vi.fn(async () => true)` — **the default is load-bearing**: a pass that awaits an unstubbed mock gets `undefined`, which is falsy, so every row would skip and case 1 would red for the wrong reason. **`reactivationCutoff` is NOT in `dbMocks`**: this file mocks `@bis/db` with `importOriginal` + spread (`review-request.test.ts:11-12`), so the real pure function survives; adding it to the mock object would replace it with a stub returning `undefined` and the pass would throw on `.toISOString()`. (`route.test.ts:15` is the one file with a BARE factory — no `importOriginal` — so it is the one that must name `reactivationCutoff` explicitly, and it throws on any export it does not define at the moment that export is read. Step 7 says so.)

The fixture carries **two different reply-to addresses and a non-null `fromEmail`**, copying `review-request.test.ts:39` and `:42` (assertions at `:93-94`): `branding.replyToEmail: "wrong-should-not-be-used@rioroofing.com"` beside `replyToEmail: "owner@rioroofing.com"`, so "the row's OWN replyToEmail, never `branding.replyToEmail`" is a thing a test can tell apart. And **no `conversationId`** — the type does not have one.

Cases, each with its mutation:

1. **sends one email, stamps the contact, writes a `sent` row.** The subject names the brand; the `to` is the contact's email; `ctx.sms` is never called (mutation: send by SMS → `expect(smsProvider.send).not.toHaveBeenCalled()` reds — email only until a per-contact consent column and an approved marketing campaign exist).
2. **outside the morning band, nothing goes and nothing is logged** (`waitingForMorning === 1`, `recordAutomationLog` not called).
3. **THE CAP, asserted by name and by number.** Six due rows, `countReactivationsSince` returning 0: exactly **five** `sent` and **one** `skippedCap`, asserted as `expect(c).toEqual({ …, sent: 5, skippedCap: 1, … })` — not "at least one". Six rows so the assertion cannot be satisfied by `AUTOMATION_TICK_CAP` (10). Mutation: use `AUTOMATION_DAILY_CAP` instead of `REACTIVATION_DAILY_CAP` → six send and this reds.
4. **the cap counts what already went today.** `countReactivationsSince` returning 5, one due row: `skippedCap === 1`, `sent === 0`, and a `skipped` row reading "Daily limit reached".
5. **quiet hours hold**: no send, no stamp, one held row at 08:00 local.
6. **release sends**; **tenancy mismatch skips** (mutation: delete the `accountId` comparison); **already stamped → "No longer due"**; **recipe off → "This automation was turned off"** (which is also what the by-id lookup now answers for a config that no longer parses, so a released row never sits untouched on that branch).
7. **THE QUIET RE-CHECK ON RELEASE, the test that keeps a release from being a replay.** `conversationQuietSince` resolving `false` (they wrote in during the hold): the release is `skipped` with "They've been in touch since", `ctx.email.send` was NOT called, and the log row says so. Mutation: remove the `conversationQuietSince` call from the releaser → this reds, and a customer who wrote in last night is told "it's been a while since we were out at your place".
8. **THE QUIET RE-CHECK ON A NORMAL TICK — the exact guard the due-list's bulk read is only a pre-filter for.** One due row, band open, `conversationQuietSince` resolving `false`: `c.skippedHeardBack === 1`, `sent === 0`, `ctx.email.send` not called, `stampReactivationSent` not called, and **`recordAutomationLog` NOT called** (silent on a normal tick — the row was never due, and there is nothing a client would want to read). It is called with this row's OWN cutoff: assert the third argument is `reactivationCutoff(TICK, row.quietMonths).toISOString()`, not a cutoff derived from any other month count. Second half, the negative that cannot be satisfied by an earlier guard: `conversationQuietSince` resolving `true` with the identical fixture → it SENDS. Mutation: delete the per-row `conversationQuietSince` call from `processReactivations` → the first half reds, and an account whose `months` is longer than the widest across the platform mails a customer who wrote in ten months ago.

- [ ] **Step 6: Write the pass**

`hold-or-send.ts` gains:

```ts
  /** A reactivation or a quote follow-up released after the customer had
   *  already been in touch. Sending it anyway would talk straight over a live
   *  conversation — the one failure mode these two recipes cannot survive. */
  heardBack: "They've been in touch since",
```

`passes/reactivation.ts`:

```ts
import {
  listDueReactivations, getDueReactivationById, stampReactivationSent, countReactivationsSince,
  conversationQuietSince, reactivationCutoff, type DueReactivation,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { reactivationEmail } from "@/lib/email/templates/reactivation";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { shouldSendReactivationNow } from "../reactivation-gate";
import { defaultReactivationBody, reactivationSubject } from "../reactivation-copy";
import { AUTOMATION_TICK_CAP, REACTIVATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

/**
 * The check-in to a past customer who has gone quiet — part B's recipe with
 * spam teeth, and every one of its restraints is structural rather than
 * advisory:
 *   - EMAIL ONLY (spec decision 4). There is no per-contact SMS consent in
 *     this schema, and "we haven't seen you in a while" is marketing, not
 *     customer care. The due-row carries no phone number, so a recipe author
 *     cannot text it by mistake. The unlock is named, not vague: a
 *     per-contact consent column and an approved marketing campaign.
 *   - ONLY PAST CUSTOMERS. A completed booking is a query predicate in the
 *     due-list, not a hope.
 *   - FIVE A DAY per account (REACTIVATION_DAILY_CAP), oldest conversation
 *     first so nobody starves.
 *   - ONCE PER CONTACT, EVER. `contacts.reactivation_sent_at` is permanent,
 *     which is also why turning the recipe off mid-drain strands nothing.
 *   - THE QUIET PERIOD IS CHECKED EXACTLY, HERE, before every send. The
 *     due-list's bulk message read is a bounded pre-filter against a column
 *     that can lag; this pass asks `conversationQuietSince` per row, with
 *     THIS account's own cutoff. Nothing goes out on the strength of the
 *     pre-filter alone.
 *
 * Morning band 08:00–11:00 in the account's zone, plus quiet hours. The
 * release re-checks the quiet period FIRST, because someone who wrote in
 * during a hold must never then be told "it's been a while".
 */
export const reactivationPass: Pass = {
  key: "reactivations",
  async run(ctx) {
    return processReactivations(ctx, await listDueReactivations(ctx.db, ctx.now.toISOString()), { released: false });
  },
};

export type ProcessOptions = { released: boolean };

export async function processReactivations(
  ctx: PassContext, due: DueReactivation[], opts: ProcessOptions,
) {
  const c = {
    sent: 0, failed: 0, unstamped: 0, held: 0,
    skippedCap: 0, skippedHeardBack: 0, waitingForMorning: 0, unresolvableTimezone: 0,
  };
  const sentToday = new Map<string, number>();
  let attemptsThisTick = 0;

  for (const row of due) {
    // The channel is fixed, so unlike the configured-channel recipes the
    // subject can be built before anything else.
    const subject: HoldSubject = {
      accountId: row.accountId, accountTimezone: row.accountTimezone, source: "reactivation",
      channel: "email", subjectKey: `contact:${row.contactId}`, contactId: row.contactId,
    };

    if (resolveAccountZone(row.accountTimezone) === null) {
      c.unresolvableTimezone++;
      console.error(
        `reactivation HELD for contact ${row.contactId}: account ${row.accountId}'s timezone `
        + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve`,
      );
      await logSkipped(ctx, subject, REASONS.timezone);
      continue;
    }

    // Skipped entirely on a release: the band already said yes once, when
    // this row was held. Silent on a normal tick — the row is due again
    // tomorrow morning and there is nothing a client would want to read.
    if (!opts.released && !shouldSendReactivationNow(ctx.now, row.accountTimezone)) {
      c.waitingForMorning++;
      continue;
    }

    if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
      c.skippedCap++;
      continue;                                  // a per-tick queue, not logged
    }
    let today = sentToday.get(row.accountId);
    if (today === undefined) {
      today = await countReactivationsSince(
        ctx.db, row.accountId, new Date(ctx.now.getTime() - DAILY_CAP_WINDOW_MS).toISOString());
      sentToday.set(row.accountId, today);
    }
    if (today >= REACTIVATION_DAILY_CAP) {
      c.skippedCap++;
      await logSkipped(ctx, subject, REASONS.dailyCap);
      continue;
    }
    attemptsThisTick++;
    sentToday.set(row.accountId, today + 1);

    // THE EXACT QUIET CHECK, per row, immediately before the send — and the
    // reason the due-list's bulk message read is allowed to be a cheap
    // pre-filter. That read is bounded by a row limit, so one chatty
    // conversation can crowd the others out of its results; this one is
    // scoped to a single conversation, takes no limit, and asks THIS
    // account's own cutoff rather than the widest across accounts. Without
    // it, an account set to eighteen months on a platform where somebody
    // else is set to six never has its own cutoff enforced, and a customer
    // who wrote in ten months ago is told "it's been a while since we were
    // out at your place".
    //
    // It sits AFTER the caps on purpose: the caps are what bound how many of
    // these reads one tick can make. The cost is that a row skipped here has
    // spent one of the five in-memory day slots — for this tick only, since
    // the next tick re-reads the real count from the stamp column.
    //
    // Skipped on a RELEASE because `releaseReactivation` has already made the
    // same call and written a real `heardBack` row if it bit; making it twice
    // would be a second read for the same answer.
    //
    // Silent on a normal tick: the row was never due, it is examined again
    // next tick, and there is nothing here a client would want to read.
    if (!opts.released) {
      const cutoff = reactivationCutoff(ctx.now, row.quietMonths);
      if (!await conversationQuietSince(ctx.db, row.accountId, row.contactId, cutoff.toISOString())) {
        c.skippedHeardBack++;
        console.error(
          `reactivation skipped for contact ${row.contactId}: a message newer than `
          + `${cutoff.toISOString()} exists, though conversations.last_message_at said `
          + `${row.lastMessageAt} — the touch lagged (messaging.ts:120-131)`,
        );
        continue;
      }
    }

    const body = row.body.trim() || defaultReactivationBody(row.brandName);

    try {
      const outcome = await holdOrSend(ctx, subject, async () => {
        const brand = emailBrandNamed(row.branding, row.brandName);
        const { subject: line, html, text } = reactivationEmail({
          brand, subject: reactivationSubject(row.brandName), body,
        });
        await ctx.email.send({
          to: row.contactEmail,
          fromName: brand.name,
          fromAddress: row.fromEmail ?? undefined,
          replyTo: normalizeReplyTo(row.replyToEmail),
          subject: line, body: text, html,
        });
        const stamp = await stampWithRetry(() => stampReactivationSent(ctx.db, row.contactId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `reactivation sent but NOT stamped for contact ${row.contactId} after ${stamp.attempts} `
            + `attempts — this person can receive it again: ${String(stamp.lastError)}`,
          );
        }
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`reactivation send failed for contact ${row.contactId}: ${String(e)}`);
    }
  }

  return c;
}

export const releaseReactivation: Releaser = async (ctx, row) => {
  const contactId = row.subject_key.replace(/^contact:/, "");
  const found = await getDueReactivationById(ctx.db, contactId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  // THE QUIET RE-CHECK, and it runs FIRST among this releaser's own rules.
  // A hold can last hours; someone who wrote in during it has a live
  // conversation, and "it's been a while since we were out at your place"
  // talks straight over it. Written `skipped` rather than left untouched —
  // an untouched released row keeps its past `held_until` and parks the head
  // of the queue.
  const cutoff = reactivationCutoff(ctx.now, found.due.quietMonths);
  if (!await conversationQuietSince(ctx.db, found.due.accountId, contactId, cutoff.toISOString())) {
    await logSkipped(ctx, subjectOf(row), REASONS.heardBack);
    return "skipped";
  }
  return verdict(await processReactivations(ctx, [found.due], { released: true }));
};
```

- [ ] **Step 7: Registry, releaser, title, counters, card**

- `release-held.ts`: `reactivation: releaseReactivation`.
- `log-titles.ts`: `reactivation: m["automations.reactivation.title"]`.
- `registry.ts`: `reactivationPass` after `appointmentConfirmPass`, before `siteTrafficPass`. It reads nothing any other pass writes.
- `route.test.ts`: `const EMPTY_REACTIVATIONS = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedCap: 0, skippedHeardBack: 0, waitingForMorning: 0, unresolvableTimezone: 0 };` under `reactivations`, added to **all SEVEN whole-body equality assertions** (`:253, :276, :299, :315, :408, :423-435, :459-471`; seven, not eight — see Task 6's step). Plus the factory-mock exports. `route.test.ts:15` is a BARE factory (no `importOriginal`) that throws on any export it does not define, **including a pure function the pass calls**, so it gains `listDueReactivations: async () => []`, `countReactivationsSince: async () => 0`, `conversationQuietSince: async () => true` and a REAL `reactivationCutoff` (copy the implementation or re-export it — a stub returning `undefined` throws on `.toISOString()`). `stampReactivationSent` and `getDueReactivationById` take the file's own convention for a thing that must not happen in this suite: `async () => { throw new Error("route.test: nothing is due") }`.
- `sentinel.test.ts`, **three edits, and the second is a red this step must EXPECT rather than discover**:
  - the new `dbMocks` entries and a `DueReactivation` row (no `conversationId`). `beforeEach` resets every `dbMock` to `mockResolvedValue(undefined)` (`:69`), so `listDueReactivations` needs its own explicit `mockResolvedValue([row])` AND `conversationQuietSince` an explicit `mockResolvedValue(true)` — left at `undefined` the pass skips every row and the sentinel proves nothing.
  - **the registry literal at `:157`**, which goes RED the moment `reactivationPass` is registered. Insert the key at its position; never loosen an order assertion that exists to pin an order. After this task it reads, in full:
    ```ts
    expect(PASSES.map((p) => p.key)).toEqual(["releaseHeld", "reminders", "followups", "reviewRequests", "referralAsks", "noShowNudges", "smsReminders", "appointmentConfirms", "reactivations", "siteTraffic", "weeklyClientReport", "weeklyAgencyReport"]);
    ```
  - **the test's TITLE at `:156`**: "the registry runs the release pass, then reminders, follow-ups, review requests, referral asks, no-show nudges, text reminders, appointment confirmations, check-ins, site traffic, then the two weekly reports — the first three's order is the collision's contract".
- `reactivation-card.tsx`: a form with the toggle, a `<Input type="number" name="months" min={REACTIVATION_MIN_MONTHS} max={REACTIVATION_MAX_MONTHS} step={1}>` defaulting to `REACTIVATION_DEFAULT_MONTHS` — **the constants, never the literals `6`, `18`, `9`**, so the input and the parser cannot disagree — the body Textarea, the `limitNote` line rendered always (a cap is context, and DESIGN.md rule 1 says a number never ships alone), and NO channel select — the card states "Email only" in its description rather than offering a choice the product refuses. (The prose copy restates the range and the cap in words and cannot interpolate; Step 3's two assertions are what keep that honest.) Note what `max` buys and what it does not: the browser refuses to fire `submit` at all when the value is out of range, so the server's `monthsInvalid` message is unreachable from a normal keyboard — which is why the parser's refusal is proved in `actions.test.ts` and never in Playwright.
- `saveReactivationAction`: agency-gated; `parseReactivationConfig({ months: Number(formData.get("months")) })`; a null parse returns `m["automations.reactivation.monthsInvalid"]`; `upsertAutomation(..., "reactivation", { enabled, body, config }, userId)`.
- `page.tsx`: one more `getAutomation` with the same degrade, the card after the referral-ask card, positional binding in the same position.

- [ ] **Step 8: Run, mutate, commit**

```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run src/lib/automations src/lib/email src/app/api/cron "src/app/(dashboard)/dashboard/accounts/[accountId]/automations"
```

| Mutation | Test that must red |
| --- | --- |
| use `AUTOMATION_DAILY_CAP` instead of `REACTIVATION_DAILY_CAP` | the six-row cap case (`sent: 5, skippedCap: 1`) |
| remove `conversationQuietSince` from the releaser | the quiet-re-check release case (case 7) |
| remove the per-row `conversationQuietSince` from `processReactivations` | the normal-tick quiet case (case 8) |
| hard-code `"America/Chicago"` inside `shouldSendReactivationNow` | `reads the ACCOUNT's zone, not the machine's: the same instant sends in Chicago and waits in Los Angeles` |
| add "10% off" to `automations.reactivation.defaultBody` | the copy's no-offer case |
| delete either `if (!brandName.trim())` branch in `reactivation-copy.ts` | `drops the naming clause when there is no brand name` |
| add `!` to `automations.reactivation.subject` | the copy's subject case |
| set `REACTIVATION_MAX_MONTHS` to 12 | `the month-range copy names the range the parser actually enforces` |
| change `REACTIVATION_DAILY_CAP` to 8 | `the copy names the daily limit the cap actually enforces` (and, separately, the six-row cap case) |
| add a button to `reactivationEmail` | the template's no-`href` case |
| delete `reactivation` from `SOURCE_TITLES` | `pnpm --filter web typecheck`, TS2741 |

```bash
git add apps/web/src/lib/automations apps/web/src/lib/email/templates apps/web/src/lib/messages.ts apps/web/src/app/api/cron/reminders/route.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations" packages/db/src/automation-log.ts
git commit -m "automations(reactivation): a once-ever check-in to a past customer, five a day, email only"
```

---

### Task 9: `quote_followup` — the data layer (bis-db-schema)

**Read the spec's own finding before starting**, because it changes how this recipe is judged: *nothing creates an opportunity automatically*. Only the pipeline page's dialog and the demo seed call `createOpportunity`; the one semi-automatic path is a `call_proposals` row of kind `opportunity_stage` that the operator accepts. So this trigger is real but fires only for a client who works the board — a sales fact, not a schema gap, and the card's copy says so. That is also why this recipe is built LAST despite having the highest revenue ceiling.

**Files:**
- Modify: `packages/db/src/automations.ts`; `packages/db/src/index.ts`; `packages/db/src/test/automations.test.ts`; `packages/db/src/test/due-by-id.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const QUOTE_FOLLOWUP_MAX_AGE_MS: number;          // 30 days
  export const QUOTE_FOLLOWUP_MIN_QUIET_DAYS = 1;
  export const QUOTE_FOLLOWUP_MAX_QUIET_DAYS = 30;
  export const QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS = 3;
  export const QUOTE_FOLLOWUP_CANDIDATE_LIMIT = 200;
  export type QuoteFollowupChannel = "email" | "sms";
  export type QuoteFollowupConfig = { stageId: string; quietDays: number; channel: QuoteFollowupChannel };
  export function parseQuoteFollowupConfig(raw: unknown): QuoteFollowupConfig | null;
  export type DueQuoteFollowup = {
    opportunityId: string; accountId: string;
    /** The opportunity's CURRENT stage, and what the recipe watches. Equal by
     *  construction in the due-list; compared by the RELEASER, which is the
     *  only place they can have drifted. */
    stageId: string; configStageId: string;
    stageChangedAt: string; quietDays: number;
    smsFailedAt: string | null;
    contactId: string; contactEmail: string | null; contactPhone: string | null;
    brandName: string; branding: Branding; accountTimezone: string;
    fromEmail: string | null; replyToEmail: string | null;
    body: string; config: QuoteFollowupConfig | null;
  };
  export async function listDueQuoteFollowups(db: SupabaseClient, nowIso: string): Promise<DueQuoteFollowup[]>;
  export async function getDueQuoteFollowupById(db: SupabaseClient, opportunityId: string): Promise<DueLookup<DueQuoteFollowup>>;
  export async function latestInboundByContact(db: SupabaseClient, contactIds: readonly string[], sinceIso: string): Promise<Map<string, string>>;
  export async function stampQuoteFollowupSent(db: SupabaseClient, opportunityId: string): Promise<void>;
  export async function stampQuoteFollowupSmsFailed(db: SupabaseClient, opportunityId: string): Promise<void>;
  export async function countQuoteFollowupsSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number>;
  ```

- [ ] **Step 1: RED FIRST — the suppression walk**

Skeleton, then

```bash
pnpm --filter @bis/db exec vitest run src/__tests__/outbound-suppressed.test.ts > /tmp/supp-red-4.log 2>&1; echo "exit=$?" >> /tmp/supp-red-4.log
```

Expected: `expected [ 'automations.ts: listDueQuoteFollowups' ] to deeply equal []`. Paste it. **An opportunity-subject due-list still carries an `account_id` on every row, so it satisfies `loadSendableRows`' `T extends { account_id: string }` constraint unchanged.**

- [ ] **Step 2: Write the section**

`RecipeKey` gains `| "quote_followup"` (now eight, matching 0047's CHECK). Append:

```ts
// ---------------------------------------------------------------------------
// Recipe: quote follow-up — a quoted lead that went quiet (part B)
// ---------------------------------------------------------------------------

/** A month. A 7 AM text about a quote sent five weeks ago reads as a mistake,
 *  and the operator has almost certainly moved the card by then anyway. */
export const QUOTE_FOLLOWUP_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
export const QUOTE_FOLLOWUP_MIN_QUIET_DAYS = 1;
export const QUOTE_FOLLOWUP_MAX_QUIET_DAYS = 30;
export const QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS = 3;

/**
 * How many parked deals one tick will look at. The reactivation recipe’s
 * `REACTIVATION_CANDIDATE_LIMIT` bounds its candidate read the same way, but
 * for a DIFFERENT residual: that one WALKS pages, because its disqualifier (no
 * completed booking) is permanent and would otherwise park the window for
 * ever. This one needs no walk — see the head-drain note below.
 *
 * THIS RECIPE'S TRIGGER IS A RESTING STATE, not an event: a card sits in the
 * nominated stage for up to thirty days, so an account whose "Quote Sent"
 * column holds hundreds of open deals yields hundreds of rows on EVERY tick —
 * and every contact id on them goes into an `.in("contact_id", …)` and then an
 * `.in("conversation_id", …)`. A PostgREST GET carrying that many uuids fails,
 * and a throw here fails the whole tick for every account, not just this one.
 * `AUTOMATION_TICK_CAP` does not help: it is applied inside the PASS, after
 * this read has already been made.
 *
 * Rows beyond the limit are the next tick's — the query orders oldest stage
 * change first, so the overflow drains from the front. What drains the HEAD is
 * `QUOTE_FOLLOWUP_MAX_AGE_MS`: a row the quiet test keeps refusing (they
 * replied) stays unstamped and keeps its place until it ages out at thirty
 * days. That is the bound; do not claim "nobody starves" here.
 */
export const QUOTE_FOLLOWUP_CANDIDATE_LIMIT = 200;

/**
 * How many inbound messages the quiet test will scan. Ordered newest first, so
 * within one contact the answer never changes; the limit can only drop a
 * contact whose latest inbound is older than 1,000 others in the candidate
 * set's window — and that errs towards SENDING, which is why it is generous
 * (five times the candidate limit) rather than tight. It exists so one very
 * busy account cannot make this read unbounded.
 */
const QUOTE_FOLLOWUP_INBOUND_SCAN_LIMIT = 1000;

export type QuoteFollowupChannel = "email" | "sms";
export type QuoteFollowupConfig = { stageId: string; quietDays: number; channel: QuoteFollowupChannel };

/**
 * jsonb is untrusted on read AND write. `stageId` is the id of one of THIS
 * account's `pipeline_stages` rows — free text per account (0003), so there
 * is no platform-wide "Quoted" stage to hard-code and the operator picks one.
 * Validated as a shape here; that it still BELONGS to the account is a
 * question only a query can answer, and the card asks it (see Task 10).
 */
export function parseQuoteFollowupConfig(raw: unknown): QuoteFollowupConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { stageId, quietDays, channel } = raw as Record<string, unknown>;
  if (channel !== "email" && channel !== "sms") return null;
  if (typeof stageId !== "string") return null;
  const id = stageId.trim();
  // The shape Postgres will accept as a uuid. A junk string would otherwise
  // reach the `.in("stage_id", …)` filter and make PostgREST return a 400 for
  // the WHOLE tick, taking every other account's rows with it.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  if (typeof quietDays !== "number" || !Number.isInteger(quietDays)) return null;
  if (quietDays < QUOTE_FOLLOWUP_MIN_QUIET_DAYS || quietDays > QUOTE_FOLLOWUP_MAX_QUIET_DAYS) return null;
  return { stageId: id, quietDays, channel };
}

export type DueQuoteFollowup = {
  opportunityId: string; accountId: string;
  stageId: string; configStageId: string;
  stageChangedAt: string; quietDays: number;
  smsFailedAt: string | null;
  contactId: string; contactEmail: string | null; contactPhone: string | null;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  /** The operator's prose. NEVER the deal's own `name` — "Smith reroof —
   *  maybe" is the operator's internal words, the same class of leak
   *  `accounts.name` is, and this row has no field for it. */
  body: string;
  config: QuoteFollowupConfig | null;
};

// ONE STRING LITERAL, never a concatenation: supabase-js parses the select at
// the TYPE level off a string literal, so `"a, " + "b"` is plain `string`, the
// parser answers `GenericStringError`, and the `data as {...}` below fails with
// TS2352. Task 5 hit this and every other *_SELECT in the file is a single
// literal for the same reason.
const QUOTE_FOLLOWUP_SELECT =
  "id, account_id, contact_id, stage_id, stage_changed_at, quote_followup_sms_failed_at, contacts(email, phone)";

/**
 * Latest INBOUND message per contact since `sinceIso` — the "they already
 * replied" test the opportunities query cannot express. Two narrow reads,
 * bounded by the candidate list (`QUOTE_FOLLOWUP_CANDIDATE_LIMIT`) and by
 * `QUOTE_FOLLOWUP_INBOUND_SCAN_LIMIT`, so this is one pair of reads per tick
 * and not one per row.
 *
 * Exported because the RELEASE needs the single-contact case: a customer who
 * replied during a hold must not be chased at 8 AM.
 */
export async function latestInboundByContact(
  db: SupabaseClient, contactIds: readonly string[], sinceIso: string,
): Promise<Map<string, string>> {
  if (contactIds.length === 0) return new Map();
  const { data: convos, error } = await db.from("conversations")
    .select("id, contact_id").in("contact_id", [...contactIds]);
  if (error) throw new Error(`latestInboundByContact conversations read failed: ${error.message}`);
  const byConversation = new Map(((convos ?? []) as { id: string; contact_id: string }[])
    .map((c) => [c.id, c.contact_id] as const));
  if (byConversation.size === 0) return new Map();

  const { data: msgs, error: mErr } = await db.from("messages")
    .select("conversation_id, created_at")
    .in("conversation_id", [...byConversation.keys()])
    .eq("direction", "inbound")
    .gt("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(QUOTE_FOLLOWUP_INBOUND_SCAN_LIMIT);
  if (mErr) throw new Error(`latestInboundByContact messages read failed: ${mErr.message}`);

  const latest = new Map<string, string>();
  for (const msg of (msgs ?? []) as { conversation_id: string; created_at: string }[]) {
    const contactId = byConversation.get(msg.conversation_id);
    if (!contactId) continue;
    // Ordered newest first, so the first one wins.
    if (!latest.has(contactId)) latest.set(contactId, msg.created_at);
  }
  return latest;
}

/**
 * Candidates, then the quiet test the query cannot express.
 *
 * `stage_id` and `quietDays` are BOTH per-account config, so the query gets
 * the union of the stage ids (exact — uuids do not collide across accounts)
 * and the WIDEST quiet cutoff, and each row is then narrowed to its own
 * account's. `stage_changed_at` is written by both `moveOpportunityStage` and
 * `moveOpportunityToStage` (opportunities.ts:45-46, 65-66), so "parked in the
 * stage you nominate, and how long ago" is a real column and not an
 * inference.
 *
 * The index that serves this read is `opps_quote_followup_due`
 * (0047, `(account_id, stage_id, stage_changed_at) where quote_followup_sent_at
 * is null and status = 'open'`) — its predicate is implied by this query's, in
 * that direction only. BOUNDED by `QUOTE_FOLLOWUP_CANDIDATE_LIMIT`: read that
 * constant's comment before removing the `.limit(...)`.
 */
export async function listDueQuoteFollowups(
  db: SupabaseClient, nowIso: string,
): Promise<DueQuoteFollowup[]> {
  const enabled = await listEnabled(db, "quote_followup", "listDueQuoteFollowups");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const DAY = 24 * 60 * 60 * 1000;
  const configured = new Map<string, { config: QuoteFollowupConfig; quietCutoff: number; body: string }>();
  for (const [accountId, auto] of enabled) {
    const config = parseQuoteFollowupConfig(auto.config);
    // An invalid config cannot even be queried for — there is no stage id to
    // filter on — so it is dropped here rather than surviving as a row the
    // pass would have to refuse. Logged, because an operator believes this
    // recipe is on.
    if (!config) {
      console.error(
        `listDueQuoteFollowups: account ${accountId} has quote_followup enabled with an invalid `
        + `config — re-save the recipe in Automations`,
      );
      continue;
    }
    configured.set(accountId, {
      config, quietCutoff: now - config.quietDays * DAY, body: auto.body,
    });
  }
  if (configured.size === 0) return [];

  const widestQuiet = new Date(Math.max(...[...configured.values()].map((c) => c.quietCutoff)));
  const oldest = new Date(now - QUOTE_FOLLOWUP_MAX_AGE_MS);

  const { data, error } = await db.from("opportunities")
    .select(QUOTE_FOLLOWUP_SELECT)
    .in("account_id", [...configured.keys()])
    .in("stage_id", [...configured.values()].map((c) => c.config.stageId))
    .eq("status", "open").is("quote_followup_sent_at", null)
    .lte("stage_changed_at", widestQuiet.toISOString())
    .gte("stage_changed_at", oldest.toISOString())
    .order("stage_changed_at", { ascending: true })
    .limit(QUOTE_FOLLOWUP_CANDIDATE_LIMIT);
  if (error) throw new Error(`listDueQuoteFollowups failed: ${error.message}`);

  // Narrow each row to ITS OWN account's stage and quiet period. The stage
  // check is belt-and-braces against the `.in(...)` union — and it is also
  // what keeps one account's stage id from ever selecting another's row.
  const rows = ((data ?? []) as any[]).filter((r) => {
    const conf = configured.get(r.account_id);
    if (!conf) return false;
    if (r.stage_id !== conf.config.stageId) return false;
    return new Date(r.stage_changed_at).getTime() <= conf.quietCutoff;
  });
  if (rows.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, rows as { account_id: string }[], "listDueQuoteFollowups");
  if (sendable.length === 0) return [];

  // THE QUIET TEST. Any inbound message since the stage changed means this
  // person is already talking to the business, and a "just checking you got
  // the quote" text would land on top of that conversation. One read pair for
  // the whole candidate set, since the earliest stage change among them.
  const earliest = sendable
    .map((r: any) => new Date(r.stage_changed_at).getTime())
    .reduce((a: number, b: number) => Math.min(a, b));
  const inbound = await latestInboundByContact(
    db, sendable.map((r: any) => r.contact_id as string), new Date(earliest).toISOString());

  return sendable
    .filter((r: any) => {
      const replied = inbound.get(r.contact_id as string);
      return !replied || new Date(replied).getTime() <= new Date(r.stage_changed_at).getTime();
    })
    .map((r: any) => {
      const conf = configured.get(r.account_id as string)!;
      const info = accountInfo.get(r.account_id as string)!;
      return {
        opportunityId: r.id, accountId: r.account_id,
        stageId: r.stage_id, configStageId: conf.config.stageId,
        stageChangedAt: r.stage_changed_at, quietDays: conf.config.quietDays,
        smsFailedAt: r.quote_followup_sms_failed_at ?? null,
        contactId: r.contact_id,
        contactEmail: r.contacts?.email ?? null, contactPhone: r.contacts?.phone ?? null,
        brandName: brandDisplayName(info.branding), branding: info.branding,
        accountTimezone: info.accountTimezone, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail,
        body: conf.body, config: conf.config,
      };
    });
}

/**
 * The release's re-read. It does NOT compare the opportunity's stage with the
 * configured one: the releaser does, so that "the stage this automation
 * watches is gone" gets its own client-readable reason. Both ids are on the
 * row for exactly that comparison.
 */
export async function getDueQuoteFollowupById(
  db: SupabaseClient, opportunityId: string,
): Promise<DueLookup<DueQuoteFollowup>> {
  const { data, error } = await db.from("opportunities")
    .select(QUOTE_FOLLOWUP_SELECT)
    .eq("id", opportunityId).eq("status", "open").is("quote_followup_sent_at", null).maybeSingle();
  if (error) throw new Error(`getDueQuoteFollowupById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const accountId = (data as any).account_id as string;
  const auto = await enabledRecipeFor(db, accountId, "quote_followup");
  if (!auto) return { due: null, why: "off" };
  const config = parseQuoteFollowupConfig(auto.config);
  if (!config) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(
    db, [data as { account_id: string }], "getDueQuoteFollowupById");
  if (sendable.length === 0) return { due: null, why: "off" };
  const r = data as any;
  const info = accountInfo.get(accountId)!;
  return {
    due: {
      opportunityId: r.id, accountId,
      stageId: r.stage_id, configStageId: config.stageId,
      stageChangedAt: r.stage_changed_at, quietDays: config.quietDays,
      smsFailedAt: r.quote_followup_sms_failed_at ?? null,
      contactId: r.contact_id,
      contactEmail: r.contacts?.email ?? null, contactPhone: r.contacts?.phone ?? null,
      brandName: brandDisplayName(info.branding), branding: info.branding,
      accountTimezone: info.accountTimezone, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail,
      body: auto.body, config,
    },
  };
}

/** Send-then-stamp. One quote follow-up per opportunity, EVER — re-arming
 *  when a card re-enters the stage is recorded out of scope for v1. */
export async function stampQuoteFollowupSent(db: SupabaseClient, opportunityId: string): Promise<void> {
  const { error } = await db.from("opportunities")
    .update({ quote_followup_sent_at: new Date().toISOString() })
    .eq("id", opportunityId);
  if (error) throw new Error(`stampQuoteFollowupSent failed: ${error.message}`);
}

/** The ATTEMPT marker, read back by the pass for SMS_RETRY_COOLDOWN_MS. */
export async function stampQuoteFollowupSmsFailed(db: SupabaseClient, opportunityId: string): Promise<void> {
  const { error } = await db.from("opportunities")
    .update({ quote_followup_sms_failed_at: new Date().toISOString() })
    .eq("id", opportunityId);
  if (error) throw new Error(`stampQuoteFollowupSmsFailed failed: ${error.message}`);
}

export async function countQuoteFollowupsSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("opportunities")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("quote_followup_sent_at", sinceIso);
  if (error) throw new Error(`countQuoteFollowupsSince failed: ${error.message}`);
  return count ?? 0;
}
```

- [ ] **Step 3: Export**

```ts
         parseQuoteFollowupConfig, listDueQuoteFollowups, getDueQuoteFollowupById,
         latestInboundByContact, stampQuoteFollowupSent, stampQuoteFollowupSmsFailed,
         countQuoteFollowupsSince,
         QUOTE_FOLLOWUP_MAX_AGE_MS, QUOTE_FOLLOWUP_MIN_QUIET_DAYS, QUOTE_FOLLOWUP_MAX_QUIET_DAYS,
         QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS, QUOTE_FOLLOWUP_CANDIDATE_LIMIT,
         type QuoteFollowupChannel, type QuoteFollowupConfig, type DueQuoteFollowup,
```

- [ ] **Step 4: Live tests**

```ts
describe("quote follow-up — data layer", () => {
  it("parseQuoteFollowupConfig needs a real uuid stage, a channel and a day count in range", () => {
    const stage = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
    expect(parseQuoteFollowupConfig({ stageId: stage, quietDays: 3, channel: "sms" }))
      .toEqual({ stageId: stage, quietDays: 3, channel: "sms" });
    for (const bad of [
      null, {}, { stageId: stage, quietDays: 3 },
      { stageId: "", quietDays: 3, channel: "sms" },
      { stageId: "Quoted", quietDays: 3, channel: "sms" },            // a NAME, not an id
      { stageId: stage, quietDays: 0, channel: "sms" },               // one under the floor
      { stageId: stage, quietDays: QUOTE_FOLLOWUP_MAX_QUIET_DAYS + 1, channel: "sms" },
      { stageId: stage, quietDays: 3.5, channel: "sms" },
      { stageId: stage, quietDays: 3, channel: "fax" },
    ]) {
      expect(parseQuoteFollowupConfig(bad), JSON.stringify(bad)).toBeNull();
    }
    // Mutation: drop the uuid regex → the "Quoted" row reds, and a stage NAME
    // would reach `.in("stage_id", …)` and 400 the whole tick.
  });

  it("an open deal parked in the configured stage past the quiet days is due; one that moved, closed, or was answered is not", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      // TWO arguments. `ensureDefaultPipeline(db, accountId)` takes no actor and
      // writes no event (crm-config.ts:72-74) — a third argument is TS2554 and
      // Step 5's typecheck stops before a single test runs.
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const pipelines = await listPipelinesWithStages(db, accountId);
      const stages = pipelines.find((p) => p.id === pipelineId)!.stages;
      const quoted = stages[1] ?? stages[0]!;
      const other = stages[0]!.id === quoted.id ? stages[stages.length - 1]! : stages[0]!;

      const now = new Date("2027-10-20T12:00:00Z");
      const DAY = 24 * HOUR;
      await upsertAutomation(db, accountId, "quote_followup",
        { enabled: true, body: "", config: { stageId: quoted.id, quietDays: 3, channel: "sms" } }, "user_test");

      // A DISTINCT NUMBER PER CONTACT. `createContact` dedupes within the
      // account on `phone_key` (`contacts.ts:120-141`), and the winner is
      // `match.emailMatch ?? match.phoneMatch` (`:150-179`) — so distinct
      // emails do NOT save a shared number: the phone match wins and all eight
      // rows collapse onto ONE contact. Every opportunity would then point at
      // that contact, the `replied` fixture's inbound message would be its
      // message, and the quiet filter would drop the entire list.
      let seq = 0;
      const mk = async (name: string, stageId: string, changedAt: Date) => {
        const phone = `(956) 555-${1200 + seq++}`;
        const { id: contactId } = await createContact(db, accountId,
          { firstName: name, email: `${name.toLowerCase()}@example.com`, phone }, "user_test");
        const opp = await createOpportunity(db, accountId, { contactId, pipelineId, name: "Reroof" }, "user_test");
        await db.from("opportunities")
          .update({ stage_id: stageId, stage_changed_at: changedAt.toISOString() }).eq("id", opp.id);
        return { oppId: opp.id, contactId };
      };

      const due = await mk("Due", quoted.id, new Date(now.getTime() - 5 * DAY));
      // ONE MINUTE either side of the three-day bound, never "yesterday".
      const atBound = await mk("Atbound", quoted.id, new Date(now.getTime() - 3 * DAY));
      const tooFresh = await mk("Fresh", quoted.id, new Date(now.getTime() - 3 * DAY + MINUTE));
      const tooOld = await mk("Old", quoted.id, new Date(now.getTime() - QUOTE_FOLLOWUP_MAX_AGE_MS - MINUTE));
      const elsewhere = await mk("Elsewhere", other.id, new Date(now.getTime() - 5 * DAY));
      const won = await mk("Won", quoted.id, new Date(now.getTime() - 5 * DAY));
      await db.from("opportunities").update({ status: "won" }).eq("id", won.oppId);
      const stamped = await mk("Stamped", quoted.id, new Date(now.getTime() - 5 * DAY));
      await stampQuoteFollowupSent(db, stamped.oppId);

      // The one who already replied — AFTER the stage changed.
      const replied = await mk("Replied", quoted.id, new Date(now.getTime() - 5 * DAY));
      const convo = await ensureConversation(db, accountId, replied.contactId, "user_test");
      const { id: msg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "got it, thanks" }, "user_test");
      await db.from("messages").update({ created_at: new Date(now.getTime() - 2 * DAY).toISOString() }).eq("id", msg);

      // And one whose only inbound message is OLDER than the stage change —
      // the negative that keeps the quiet test from being "has ever written".
      //
      // ITS POSITION IS THE WHOLE POINT, and it is not "nine days ago". The
      // read is scoped to the EARLIEST stage change in the candidate set
      // (`sinceIso`, here now−5d from `due` and `replied`), so a message four
      // days older than that never enters the map at all and the row would
      // survive on `!replied` alone — leaving the `<=` comparison untested and
      // the mutation below unable to red. So: stage changed four days ago, the
      // message ONE MINUTE before that. It is inside the scan window, it IS in
      // the map, and only the per-row comparison keeps it.
      const wroteBefore = await mk("Before", quoted.id, new Date(now.getTime() - 4 * DAY));
      const convo2 = await ensureConversation(db, accountId, wroteBefore.contactId, "user_test");
      const { id: msg2 } = await createMessage(db, accountId,
        { conversationId: convo2.id, channel: "sms", direction: "inbound", body: "can you quote this?" }, "user_test");
      await db.from("messages").update({ created_at: new Date(now.getTime() - 4 * DAY - MINUTE).toISOString() }).eq("id", msg2);

      const ids = (await listDueQuoteFollowups(db, now.toISOString())).map((r) => r.opportunityId);
      expect(ids).toContain(due.oppId);
      expect(ids).toContain(atBound.oppId);
      expect(ids).toContain(wroteBefore.oppId);      // Mutation: `return !replied;` (drop the `<=` comparison) → this reds
      expect(ids).not.toContain(tooFresh.oppId);     // Mutation: query `now` instead of `quietCutoff` → this reds and nothing else does
      expect(ids).not.toContain(tooOld.oppId);       // Mutation: widen QUOTE_FOLLOWUP_MAX_AGE_MS
      expect(ids).not.toContain(elsewhere.oppId);    // Mutation: drop the stage filter
      expect(ids).not.toContain(won.oppId);          // Mutation: drop the status filter
      expect(ids).not.toContain(stamped.oppId);
      expect(ids).not.toContain(replied.oppId);      // Mutation: delete the latestInboundByContact read

      const row = (await listDueQuoteFollowups(db, now.toISOString())).find((r) => r.opportunityId === due.oppId)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row).not.toHaveProperty("name");        // the DEAL's name is the operator's internal words
      expect(row.stageId).toBe(quoted.id);
      expect(row.configStageId).toBe(quoted.id);
      expect(row.quietDays).toBe(3);
    });
  });

  it("a suppressed account's deal is never due, and the stamps are idempotent and separate", async () => {
    await withTestAccount(async (db, accountId) => {
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const pipelines = await listPipelinesWithStages(db, accountId);
      const { id: stageId } = pipelines.find((p) => p.id === pipelineId)!.stages[0]!;
      await upsertAutomation(db, accountId, "quote_followup",
        { enabled: true, body: "", config: { stageId, quietDays: 3, channel: "email" } }, "user_test");
      const now = new Date("2027-10-20T12:00:00Z");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Supp", email: "supp@example.com" }, "user_test");
      const opp = await createOpportunity(db, accountId, { contactId, pipelineId, name: "Job" }, "user_test");
      await db.from("opportunities")
        .update({ stage_id: stageId, stage_changed_at: new Date(now.getTime() - 5 * 24 * HOUR).toISOString() })
        .eq("id", opp.id);

      expect((await listDueQuoteFollowups(db, now.toISOString())).map((r) => r.opportunityId)).toContain(opp.id);
      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      expect((await listDueQuoteFollowups(db, now.toISOString())).map((r) => r.opportunityId)).not.toContain(opp.id);
      expect((await getDueQuoteFollowupById(db, opp.id)).due).toBeNull();
      await db.from("accounts").update({ outbound_suppressed: false }).eq("id", accountId);

      const before = new Date();
      await stampQuoteFollowupSmsFailed(db, opp.id);
      await stampQuoteFollowupSent(db, opp.id);
      await stampQuoteFollowupSent(db, opp.id);
      expect(await countQuoteFollowupsSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(1);
      expect(await getDueQuoteFollowupById(db, opp.id)).toEqual({ due: null, why: "gone" });
    });
  });
});
```

> `ensureDefaultPipeline`, `listPipelinesWithStages` (both `./crm-config`, both already in the barrel at `index.ts:25`) and `createOpportunity` (`./opportunities`) must be added to this test file's imports — plus `ensureConversation` and `createMessage` from `../messaging` if Task 7 has not already added them (it does; check the import block before adding a duplicate). **Read `packages/db/src/test/opportunities.test.ts` first** for the working `createOpportunity` call shape and fix this plan's version against it if it differs; the source wins.
>
> Three signatures read off the source on 2026-09-21, because the argument counts differ from each other and a wrong one is a typecheck failure before any test runs:
> `ensureDefaultPipeline(db, accountId)` → `{ pipelineId }` (**two** args, no actor — `crm-config.ts:72-74`);
> `createOpportunity(db, accountId, { contactId, pipelineId, name }, actorId)` → `{ id }` (**four** — `opportunities.ts:12-17`, and it drops the deal in the pipeline's FIRST stage, which is why every fixture above rewrites `stage_id`);
> `listPipelinesWithStages(db, accountId)` → `{ id, name, stages: { id, name, position }[] }[]` (`crm-config.ts:107-118`). The default pipeline's stages are `New Lead, Contacted, Appointment, Quote Sent, Closed` (`crm-config.ts:54`), so `stages[1]` exists and `stages[0]` is never the same row.

Then the by-id lookup's live `off` case, appended to the third `describe` in `packages/db/src/test/due-by-id.test.ts` — the house home for every `getDue*ById` (the File Structure names it, and the recipe lookups already sit in one describe there):

```ts
  it("quote follow-up is `off` until the recipe is on, and `gone` once the deal is closed", async () => {
    await withTestAccount(async (db, accountId) => {
      const { contactId } = await seed(db, accountId);
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const stages = (await listPipelinesWithStages(db, accountId)).find((p) => p.id === pipelineId)!.stages;
      const stageId = stages[1]!.id;
      const { id: oppId } = await createOpportunity(db, accountId, { contactId, pipelineId, name: "Reroof" }, "user_test");
      await db.from("opportunities").update({ stage_id: stageId }).eq("id", oppId);

      expect(await getDueQuoteFollowupById(db, oppId)).toEqual({ due: null, why: "off" });
      // Mutation: return the row before `enabledRecipeFor` → this reds.
      await upsertAutomation(db, accountId, "quote_followup",
        { enabled: true, body: "", config: { stageId, quietDays: 3, channel: "email" } }, "user_test");
      const found = await getDueQuoteFollowupById(db, oppId);
      expect(found.due?.opportunityId).toBe(oppId);
      expect(found.due?.configStageId).toBe(stageId);

      await updateOpportunity(db, accountId, oppId, { status: "won" }, "user_test");
      expect(await getDueQuoteFollowupById(db, oppId)).toEqual({ due: null, why: "gone" });
      // Mutation: drop `.eq("status", "open")` from the by-id lookup → the won
      // deal comes back due and this reds. It is the one the RELEASE path
      // depends on: a held row whose deal was won must not send.
    });
  });
```

> `getDueQuoteFollowupById` (`../automations`), `ensureDefaultPipeline`/`listPipelinesWithStages` (`../crm-config`) and `createOpportunity`/`updateOpportunity` (`../opportunities`) join that file's imports; `seed` and `upsertAutomation` are already there (`due-by-id.test.ts:13-21` and `:5`). `updateOpportunity(db, accountId, oppId, { status }, actorId)` — five args (`opportunities.ts:73-78`).

- [ ] **Step 5: Run, mutate, commit**

```bash
pnpm --filter @bis/db typecheck
pnpm --filter @bis/db exec vitest run src/test/automations.test.ts src/test/due-by-id.test.ts src/__tests__/outbound-suppressed.test.ts > /tmp/task9.log 2>&1; echo "exit=$?" >> /tmp/task9.log
```

Judge that run by **vitest's own summary block inside the log**, not by `exit=`: `pnpm --filter @bis/db exec vitest` prints `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL "Command vitest not found"` AFTER the real results, so the shell's code lies for this package. Nothing may follow the command on that line, either — a trailing `echo` has masked a red suite as exit 0, which is why the redirect and the `echo "exit=$?"` are two statements on one line and the log is what you read.

```bash
git add packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts packages/db/src/test/due-by-id.test.ts
git commit -m "db(automations): quote_followup due-list off the pipeline stage, with the already-replied test"
```

---

### Task 10: `quote_followup` — the recipe (bis-automations; bis-design-reviewer after)

**Files:**
- Modify: `packages/db/src/automation-log.ts` (`"quote_followup"` — the thirteenth and last)
- Modify: `apps/web/src/lib/automations/hold-or-send.ts` (`REASONS.stageGone`)
- Create: `quote-followup-gate.ts` (+ `.test.ts`), `quote-followup-copy.ts` (+ `.test.ts`), `passes/quote-followup.ts` (+ `.test.ts`), `apps/web/src/lib/email/templates/quote-followup.ts` (+ `.test.ts`)
- Modify: `passes/release-held.ts` and `passes/release-held.test.ts`, `log-titles.ts`, `registry.ts`, `sentinel.test.ts`, `route.test.ts`, `messages.ts`
- Create: `…/automations/quote-followup-card.tsx`; Modify: `…/automations/{page.tsx,actions.ts,page.test.ts,actions.test.ts}`

- [ ] **Step 1: The gate, tests first**

```ts
import { describe, it, expect } from "vitest";
import { QUOTE_FOLLOWUP_MAX_AGE_MS } from "@bis/db";
import { shouldSendQuoteFollowupNow } from "./quote-followup-gate";

const ZONE = "America/Chicago";
const WEST = "America/Los_Angeles";
const NOW = new Date("2027-10-20T14:00:00.000Z");   // 09:00 CDT · 07:00 PDT
const DAY = 24 * 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("when a quote follow-up may go", () => {
  it("goes once the deal has sat for the configured days, and not a minute before", () => {
    expect(shouldSendQuoteFollowupNow(NOW, ago(3 * DAY), 3, ZONE)).toBe(true);
    expect(shouldSendQuoteFollowupNow(NOW, ago(3 * DAY - 60_000), 3, ZONE)).toBe(false);
    // One minute inside the bound, not "yesterday". Mutation: change the gate's
    // `if (elapsedMs < quietDays * DAY_MS)` to `<=` → the at-bound row reds and
    // nothing else moves. (There is no `>=` in this gate to flip; naming one
    // sends an implementer mutating the max-age instead, which reds a
    // different test and passes this one.)
  });

  /**
   * ONE INSTANT, TWO ZONES, OPPOSITE VERDICTS — the house rule for every
   * zone-dependent test (`review-request-gate.test.ts:7-13` states it, `:59-61`
   * demonstrates it). Without the pair, a gate that ignored its `timezone` argument
   * entirely would pass every other case in this file. 14:00Z is 09:00 in
   * Chicago (inside the 08:00–11:00 band) and 07:00 in Los Angeles (before it),
   * and the deal, the quiet days and the instant are identical.
   *
   * Mutation: hard-code `"America/Chicago"` inside the gate instead of reading
   * the argument → the second line reds.
   */
  it("reads the ACCOUNT's zone, not the machine's: the same instant sends in Chicago and waits in Los Angeles", () => {
    expect(shouldSendQuoteFollowupNow(NOW, ago(5 * DAY), 3, ZONE)).toBe(true);
    expect(shouldSendQuoteFollowupNow(NOW, ago(5 * DAY), 3, WEST)).toBe(false);
  });

  it("is too stale one millisecond past thirty days, and fine AT thirty days", () => {
    expect(shouldSendQuoteFollowupNow(NOW, ago(QUOTE_FOLLOWUP_MAX_AGE_MS), 3, ZONE)).toBe(true);
    expect(shouldSendQuoteFollowupNow(NOW, ago(QUOTE_FOLLOWUP_MAX_AGE_MS + 1), 3, ZONE)).toBe(false);
  });

  it("respects the morning band at both edges", () => {
    expect(shouldSendQuoteFollowupNow(new Date("2027-10-20T12:59:00Z"), ago(5 * DAY), 3, ZONE)).toBe(false);
    expect(shouldSendQuoteFollowupNow(new Date("2027-10-20T13:00:00Z"), ago(5 * DAY), 3, ZONE)).toBe(true);
    expect(shouldSendQuoteFollowupNow(new Date("2027-10-20T16:00:00Z"), ago(5 * DAY), 3, ZONE)).toBe(false);
  });

  it("fails CLOSED on an unresolvable zone, a future stage change and an unreadable instant — and an explicit UTC account still works", () => {
    // THE JUNK LIST IS THE THREE SIBLING GATES' LIST, verbatim
    // (`review-request-gate.test.ts:34-37`, `no-show-nudge-gate.test.ts:34`,
    // `followup-timing.test.ts:196`). NOT `"CST"`: `resolveAccountZone` is
    // `safeZone(tz, ZONE_UNRESOLVABLE)` and `safeZone`'s whole validation is
    // "did `new Intl.DateTimeFormat` throw" (`lib/booking/time.ts:20-30`,
    // `followup-timing.ts:122-125`). ICU RESOLVES `CST` — to America/Chicago,
    // verified — so asserting `false` for it would fail against a CORRECT gate
    // and invite an implementer to weaken the fail-closed rule to make it pass.
    // (`followup-timing.ts:110` names "the operator typed CST" as the bug it
    // was written for; the fix was the sentinel fallback, not a claim that ICU
    // rejects the string.)
    expect(shouldSendQuoteFollowupNow(NOW, ago(5 * DAY), 3, "UTC")).toBe(false); // 14:00 UTC — outside the band, not unresolvable
    const utcMorning = new Date("2027-10-20T09:30:00.000Z");
    expect(shouldSendQuoteFollowupNow(utcMorning, ago(5 * DAY), 3, "UTC")).toBe(true);   // the positive control
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(shouldSendQuoteFollowupNow(utcMorning, ago(5 * DAY), 3, junk), junk).toBe(false);
    }
    expect(shouldSendQuoteFollowupNow(NOW, new Date(NOW.getTime() + DAY), 3, ZONE)).toBe(false);
    expect(shouldSendQuoteFollowupNow(NOW, new Date("nonsense"), 3, ZONE)).toBe(false);
  });
});
```

```ts
import { QUOTE_FOLLOWUP_MAX_AGE_MS } from "@bis/db";
import { resolveAccountZone, isInMorningBand } from "@/lib/booking/followup-timing";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * WHEN a quote follow-up may go — the pure half of the pass. There is no
 * "strictly earlier local day" rule here, unlike the completed-job ladder:
 * the quiet period is at least one whole day already, so the rule it would
 * enforce is enforced by the operator's own setting.
 *
 * The "have they replied since?" test is NOT here, because it is a query
 * (listDueQuoteFollowups, and again in the releaser). A gate that took a
 * database would not be a gate.
 *
 * FAIL CLOSED on an unresolvable zone: no hour is defensible.
 */
export function shouldSendQuoteFollowupNow(
  now: Date, stageChangedAt: Date, quietDays: number, timezone: string,
): boolean {
  const elapsedMs = now.getTime() - stageChangedAt.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < quietDays * DAY_MS) return false;         // not quiet long enough yet
  if (elapsedMs > QUOTE_FOLLOWUP_MAX_AGE_MS) return false;  // a month on, it reads as a mistake

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;
  return isInMorningBand(now, zone);
}
```

- [ ] **Step 2: The copy and the message keys**

```ts
  "automations.quoteFollowup.defaultBody": "Hi, it's {name}. Just checking you got the quote we sent. Happy to answer anything or adjust it. Any questions?",
  "automations.quoteFollowup.defaultBodyNoName": "Just checking you got the quote we sent. Happy to answer anything or adjust it. Any questions?",
  "automations.quoteFollowup.emailSubject": "About your quote from {name}",
  "automations.quoteFollowup.emailSubjectNoName": "About your quote",
  "automations.quoteFollowup.title": "Quote follow-ups",
  "automations.quoteFollowup.body": "This watches your pipeline. It only runs for deals you move into the stage you pick — after a few quiet days with no reply, it checks in about the quote. Off until you turn it on.",
  "automations.quoteFollowup.enabled": "Follow up on quiet quotes",
  "automations.quoteFollowup.stage": "Pipeline stage to watch",
  "automations.quoteFollowup.stageHint": "Pick the stage you move a deal to once you've sent the quote.",
  "automations.quoteFollowup.stagePlaceholder": "Choose a stage",
  "automations.quoteFollowup.stageMissing": "The stage this automation watches is gone. Pick another one before this can run again.",
  "automations.quoteFollowup.noStages": "This company has no pipeline stages yet, so there is nothing to watch. Set up the pipeline first.",
  "automations.quoteFollowup.quietDays": "Days with no reply",
  "automations.quoteFollowup.quietDaysHint": "Between 1 and 30. Three is a good default — long enough to not feel pushy.",
  "automations.quoteFollowup.quietDaysInvalid": "Choose a number of days between 1 and 30.",
  "automations.quoteFollowup.stageRequired": "Pick the stage to watch before turning this on.",
  "automations.quoteFollowup.channel": "Send by",
  "automations.quoteFollowup.message": "Message",
  "automations.quoteFollowup.messageHint": "Leave blank to send our default message. The price and the deal's name are never included.",
  "automations.quoteFollowup.save": "Save quote follow-ups",
  "automations.quoteFollowup.saved": "Quote follow-ups saved",
  "automations.quoteFollowup.saveFailed": "Could not save quote follow-ups.",
```

```ts
import { m } from "@/lib/messages";

/**
 * One line, the brand name, and NEITHER the price NOR the deal's name. The
 * deal's `name` is the operator's internal words — "Smith reroof — maybe" —
 * the same class of leak `accounts.name` is, and the due-row has no field for
 * it, so this function could not include it if it wanted to. The price is
 * left out for the same reason a quote is a document: a number in a text
 * invites a negotiation nobody prepared for.
 */
export function defaultQuoteFollowupBody(brandName: string): string {
  if (!brandName.trim()) return m["automations.quoteFollowup.defaultBodyNoName"];
  return m["automations.quoteFollowup.defaultBody"].replace("{name}", () => brandName);
}

export function quoteFollowupSubject(brandName: string): string {
  if (!brandName.trim()) return m["automations.quoteFollowup.emailSubjectNoName"];
  return m["automations.quoteFollowup.emailSubject"].replace("{name}", () => brandName);
}
```

Its test: names the brand; **no `$`, no digits** in the default body (mutation: add "for $4,200" → red); no `http`; no `{{`; no `\bM[0-9][a-z]?\b`; the `$&` survival case; the no-name variants.

Plus **one assertion that keeps the card's copy honest about the range**, because the two numbers are written out in prose and the card's `min`/`max` come from the constants — change a constant and the copy would otherwise lie to the operator while the input silently accepted a different range:

```ts
// in quote-followup-copy.test.ts, beside the guards above:
// import { QUOTE_FOLLOWUP_MIN_QUIET_DAYS, QUOTE_FOLLOWUP_MAX_QUIET_DAYS } from "@bis/db";
// import { m } from "@/lib/messages";
it("the day-range copy names the range the parser actually enforces", () => {
  const range = `between ${QUOTE_FOLLOWUP_MIN_QUIET_DAYS} and ${QUOTE_FOLLOWUP_MAX_QUIET_DAYS}`;
  for (const key of ["automations.quoteFollowup.quietDaysHint", "automations.quoteFollowup.quietDaysInvalid"] as const) {
    expect(m[key].toLowerCase(), key).toContain(range);
  }
  // Mutation: set QUOTE_FOLLOWUP_MAX_QUIET_DAYS to 21 → both keys still read
  // "between 1 and 30" and this reds. It is the only guard against that drift:
  // copy is a static catalogue and cannot interpolate a constant.
});
```

- [ ] **Step 3: Register the last source**

`AUTOMATION_LOG_SOURCES` gains `"quote_followup"` — the thirteenth, and now the constant and 0047's CHECK agree exactly. Run `pnpm --filter web typecheck`, paste the last pair of TS2741 errors, answer them with real entries.

- [ ] **Step 4: The pass — tests first**

`passes/quote-followup.test.ts`, the Task 6 shape (band-gated, configured channel, caps, cooldown), with mocks `listDueQuoteFollowups, getDueQuoteFollowupById, stampQuoteFollowupSent, stampQuoteFollowupSmsFailed, countQuoteFollowupsSince, latestInboundByContact, recordAutomationLog, getAutomationLogEntry`. `latestInboundByContact` defaults to `vi.fn(async () => new Map())`.

Cases and mutations:

1. **sends by the configured channel, stamps the OPPORTUNITY** (`stampQuoteFollowupSent` called with the opportunity id, never a booking id), and the log's `subjectKey` is `opportunity:<id>` (mutation: write `booking:` → red, and the row would then collide with a booking-subject recipe's line for a different thing).
2. **the body never carries the deal's name or a price** — assert the sent body equals `defaultQuoteFollowupBody("Rio Roofing")` exactly when `body` is blank.
3. **an invalid config sends nothing and writes no log row** (no channel ⇒ no subject), `skippedInvalidConfig === 1`. Mutation: **delete the `config === null` guard** → the loop dereferences `null.channel`, `run` rejects, and this case reds. (Do NOT name "build the subject before parsing" as the mutation: it changes neither the counter nor the absence of a log row, so it cannot red anything.) Note in the pass's own comment that this counter is DEFENSIVE only — the due-list drops an unparseable config before it can become a row (`listDueQuoteFollowups`, the `console.error` branch) and the by-id lookup returns `why: "off"`, so nothing but a hand-built row reaches it. It stays because `DueQuoteFollowup.config` is nullable and a silent `null.channel` in a cron tick is worse than a counter that reads 0 for ever.
4. **an SMS gate refusal skips and logs, never becomes an email.**
5. **outside the band: `waitingForMorning === 1`, nothing logged.**
6. **the SMS cooldown: silent on a normal tick, a real `skipped` row with "Waiting before trying this text again" on a release.** Mutation: drop the `if (opts.released)` guard → the normal-tick half reds; delete the branch → the release half reds.
7. **the daily cap: `skippedCap` by name, and a `skipped` row reading "Daily limit reached".**
8. **quiet hours hold**: no send, no stamp, one held row at 08:00 local.
9. **release sends**; **tenancy mismatch skips**; **recipe off → "This automation was turned off"**.
10. **THE STAGE VANISHED.** `getDueQuoteFollowupById` returning a row whose `stageId !== configStageId`: `skipped` with "The stage this automation watches is gone", nothing sent. Mutation: delete the comparison from the releaser → red.
11. **THE QUIET RE-CHECK ON RELEASE.** `latestInboundByContact` returning a map with this contact at an instant AFTER `stageChangedAt`: `skipped` with "They've been in touch since", nothing sent. Mutation: remove the call from the releaser → red, and a customer who replied during the hold is chased at 8 AM. Second fixture, the negative that cannot be satisfied by an earlier guard: the map carries the contact at an instant BEFORE `stageChangedAt` → it SENDS.

- [ ] **Step 5: Write the pass**

`hold-or-send.ts` gains the last reason:

```ts
  /** A quote follow-up released after the operator deleted or replaced the
   *  pipeline stage this recipe watches. A normal tick can never produce
   *  this — the due-list filters on the stage, so a vanished one yields no
   *  row and there is no subject to write against — but a HELD row's stage
   *  can disappear during the hold, and that row must leave the queue with a
   *  reason rather than sit in it. */
  stageGone: "The stage this automation watches is gone",
```

`passes/quote-followup.ts` — **`review-request.ts`'s structure end to end** (read it again before writing), with these differences, all of them:

- the subject is the COMPLETE `HoldSubject` (`hold-or-send.ts:45-63`: `LogSubject` requires `accountId`, and `HoldSubject` adds `accountTimezone` — omit either and it does not compile), built after the config parses, exactly as `review-request.ts:91-93` builds its own:
  ```ts
  const subject: HoldSubject = {
    accountId: row.accountId, accountTimezone: row.accountTimezone, source: "quote_followup",
    channel: config.channel, subjectKey: `opportunity:${row.opportunityId}`, contactId: row.contactId,
  };
  ```
- the band call is `shouldSendQuoteFollowupNow(ctx.now, new Date(row.stageChangedAt), row.quietDays, row.accountTimezone)`, wrapped in `if (!opts.released && …)`;
- there is no `laterOf` anchor — `stage_changed_at` IS the clock, written by both `moveOpportunityStage` and `moveOpportunityToStage`;
- the stamp is `stampQuoteFollowupSent(ctx.db, row.opportunityId)` and the failure marker `stampQuoteFollowupSmsFailed(ctx.db, row.opportunityId)`;
- the cap count is `countQuoteFollowupsSince`, against `AUTOMATION_TICK_CAP` and `AUTOMATION_DAILY_CAP`;
- the SMS body is `row.body.trim() || defaultQuoteFollowupBody(row.brandName)` with **no trailing link** (there is nothing to link to — the quote is a document the operator already sent);
- the email is `shell`-based like the referral ask's, with `quoteFollowupSubject(row.brandName)`; create `apps/web/src/lib/email/templates/quote-followup.ts` in the `referral-ask.ts` shape (no button) and its test (no `href`, escaping, paragraph breaks);
- counters: `{ sent, failed, unstamped, held, skippedInvalidConfig, skippedNoAddress, skippedSmsGate, skippedRecentFailure, skippedCap, waitingForMorning, unresolvableTimezone }` — `skippedInvalidConfig` is the defensive one described in Step 4's case 3; every other one moves on a real path;
- **the `continue`s you are copying, and why none of them parks a released row here.** A released row that is left untouched keeps its past `held_until` and is handed back every tick for ever — the parked-row bug. Three branches `continue` without writing: `config === null` is UNREACHABLE on a release (the by-id lookup returns `why: "off"` for an unparseable config, so the releaser logs `recipeOff` and never enters the loop); the SMS gate READ failure is a transient `failed` the next tick retries, the same call `review-request.ts:142-146` makes; and the SMS cooldown is the one that must write on a release and does — `if (opts.released) await logSkipped(ctx, subject, REASONS.smsCooldown)` (`review-request.ts:168-171`). Copy that `if`, not just the `continue`.

The releaser:

```ts
export const releaseQuoteFollowup: Releaser = async (ctx, row) => {
  const opportunityId = row.subject_key.replace(/^opportunity:/, "");
  const found = await getDueQuoteFollowupById(ctx.db, opportunityId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (found.due.accountId !== row.account_id) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  // The stage the recipe watches may have been deleted or re-pointed during
  // the hold. A normal tick cannot produce this — the due-list filters on the
  // stage — so this is the ONLY place the reason is reachable, and it exists
  // so the held row leaves the queue instead of sitting in it forever.
  if (found.due.stageId !== found.due.configStageId) {
    await logSkipped(ctx, subjectOf(row), REASONS.stageGone);
    return "skipped";
  }
  // THE QUIET RE-CHECK. A customer who replied during the hold must not be
  // chased at 8 AM about a quote they already answered. Written `skipped`,
  // never left untouched: an untouched released row keeps its past
  // `held_until` and parks the head of the queue.
  const inbound = await latestInboundByContact(
    ctx.db, [found.due.contactId], found.due.stageChangedAt);
  const replied = inbound.get(found.due.contactId);
  if (replied && new Date(replied).getTime() > new Date(found.due.stageChangedAt).getTime()) {
    await logSkipped(ctx, subjectOf(row), REASONS.heardBack);
    return "skipped";
  }
  return verdict(await processQuoteFollowups(ctx, [found.due], { released: true }));
};
```

- [ ] **Step 6: Registry, releaser, title, counters**

- `passes/release-held.ts`: `quote_followup: releaseQuoteFollowup`. With this entry `RELEASERS` is complete for all thirteen sources and `Record<AutomationLogSource, …>` compiles again — that, and nothing else, is the proof every new source is registered.
- `passes/release-held.test.ts`: `vi.mock("./quote-followup", …)` beside the six mocks already there (`:9-14`), **and the one assertion that closes the hole the type leaves open**. `RELEASERS` is `Record<AutomationLogSource, Releaser | null>` (`release-held.ts:67`), so the compiler forces a KEY, not a function: a `null` compiles, and every held row of that source would then be logged `skipped` "No longer due" (`release-held.ts:94-98`, the `if (!releaser)` branch) for ever, silently. Task 10 is the first moment all four part-B sources exist, so it is where the assertion lands (`RELEASERS` joins the import at `release-held.test.ts:17`):
  ```ts
  it("every part B source has a REAL releaser, not the `null` the type would accept", () => {
    for (const source of ["appointment_confirm", "referral_ask", "reactivation", "quote_followup"] as const) {
      expect(typeof RELEASERS[source], source).toBe("function");
    }
    // Mutation: set any one of the four to `null` → it compiles, the whole
    // suite otherwise stays green, and ONLY this reds.
  });
  ```
- `log-titles.ts`: `quote_followup: m["automations.quoteFollowup.title"]`.
- `registry.ts`: `quoteFollowupPass` after `reactivationPass`, before `siteTrafficPass`.
- `route.test.ts`: `const EMPTY_QUOTE_FOLLOWUPS = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0, waitingForMorning: 0, unresolvableTimezone: 0 };` added under `quoteFollowups` **to all SEVEN whole-body equality assertions** (`:253, :276, :299, :315, :408, :423-435, :459-471`) — miss one and seven tests red with no named expectation. Its `@bis/db` mock is a BARE factory that throws on any export it does not define, **including a constant read at import time**, so it also gains `listDueQuoteFollowups: async () => []`, `latestInboundByContact: async () => new Map()`, `countQuoteFollowupsSince: async () => 0`, and `QUOTE_FOLLOWUP_MAX_AGE_MS` (the gate module reads that constant at import time — a missing one throws before any test body runs). The two stamps and `getDueQuoteFollowupById` take the file's own convention for a thing that must not happen in this suite — `async () => { throw new Error("route.test: nothing is due") }` — so a change that makes one due fails loudly instead of passing quietly.
- `sentinel.test.ts`, three edits:
  - the new `dbMocks` entries and a `DueQuoteFollowup` row. **`latestInboundByContact` must be mocked to return an empty Map**, or the sentinel's run of this pass will try to read a database that is not there. `beforeEach` resets every `dbMock` to `mockResolvedValue(undefined)` (`:69`), so `listDueQuoteFollowups` needs its own explicit `mockResolvedValue([row])` after the reset or the pass iterates `undefined`, throws, and the harness reports `errored`.
  - **the registry literal at `:157`.** It is an ordered `toEqual` of every pass key and it goes RED the moment a pass is registered — a red the plan must EXPECT, not discover, because the tempting "fix" is to loosen an order assertion that exists to pin an order. After Task 10 it reads, in full:
    ```ts
    expect(PASSES.map((p) => p.key)).toEqual(["releaseHeld", "reminders", "followups", "reviewRequests", "referralAsks", "noShowNudges", "smsReminders", "appointmentConfirms", "reactivations", "quoteFollowups", "siteTraffic", "weeklyClientReport", "weeklyAgencyReport"]);
    ```
  - **the test's TITLE at `:156`**, which names the order in prose and rots silently otherwise: "the registry runs the release pass, then reminders, follow-ups, review requests, referral asks, no-show nudges, text reminders, appointment confirmations, check-ins, quote follow-ups, site traffic, then the two weekly reports — the first three's order is the collision's contract".

- [ ] **Step 7: The card, the action, the page**

`quote-followup-card.tsx` — the `NoShowNudgeCard` shape plus two fields and one notice:

- a `Select name="stage_id"` built from `stages: { id: string; name: string }[]`, a prop the page resolves with `listPipelinesWithStages(db, accountId)` (already exported, `index.ts:25`), flattened across pipelines and labelled `"<pipeline> · <stage>"` when there is more than one pipeline;
- **the vanished-stage notice**: when the stored `stageId` is not among `stages`, render `m["automations.quoteFollowup.stageMissing"]` above the select and leave the select unset. This is the operator-facing half of B3 — a normal tick cannot log it, so the settings page is where it must be visible;
- when `stages.length === 0`, render `m["automations.quoteFollowup.noStages"]` and disable the form's submit;
- a `<Input type="number" name="quiet_days" min={QUOTE_FOLLOWUP_MIN_QUIET_DAYS} max={QUOTE_FOLLOWUP_MAX_QUIET_DAYS} step={1}>` defaulting to `QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS` — **the constants, never the literals `1`, `30`, `3`**, so the input and the parser cannot disagree. (The prose copy restates the range in words and cannot interpolate; Step 2's range assertion is what keeps that honest.) Note what `max` buys and what it does not: the browser refuses to fire `submit` at all when the value is out of range, so the server's message is unreachable from a normal keyboard — which is why the parser's refusal is proved in `actions.test.ts` and not in Playwright (Task 11, and the reason its range case changed);
- the channel Select, the body Textarea, the segment counter on `body.trim() || defaultQuoteFollowupBody(brandName)`;
- `data-testid="quote-followup-card"`.

`saveQuoteFollowupAction` — agency-gated; ONE `parseQuoteFollowupConfig({ stageId, quietDays: Number(...), channel })`, then branch on WHY it failed, which is the review-request action's own shape (`actions.ts:46-48`: one parse, then the specific messages, most specific first): an empty `stage_id` with `enabled` returns `m["automations.quoteFollowup.stageRequired"]`; a `quiet_days` outside the range returns `m["automations.quoteFollowup.quietDaysInvalid"]`; anything else that failed to parse returns `m["automations.quoteFollowup.saveFailed"]`. Store the PARSED config, not the raw form values — the same reason that action gives at `actions.ts:50-53`.

`page.tsx` — one more `getAutomation`, plus `listPipelinesWithStages(db, accountId).catch(…) => []` in the same `Promise.all` with its own log line, and the card last. Positional bindings in the same positions.

**`page.test.ts` needs four edits before the page compiles under it, all of them the same trap and all of them silent until the file runs:**
- its `@bis/db` mock is a **bare factory** (`:25-37`, no `importOriginal`) defining exactly `serviceDb, getAutomation, getBranding, getCalendarForAccount, readQuietSettings, DEFAULT_QUIET_SETTINGS`. A factory mock throws on any export it does not define, at the moment the export is read — so `listPipelinesWithStages: async () => []` goes in, or the page's new `Promise.all` entry errors the whole file;
- its `./actions` mock is a factory too (`:42-48`); add `saveQuoteFollowupAction: async () => ({ ok: true })`;
- add `vi.mock("./quote-followup-card", …)` with its own `captured` slot, the shape the other five use (`:56-70`);
- the comment at `:199` says "the four `getAutomation` calls". After part B there are eight. Correct the number rather than leaving a comment that names a count the page no longer has.

Card tests: the stage select lists the account's stages; the missing-stage notice renders when the stored id is absent **and does not render when it is present** (a one-sided assertion here would pass against a notice that always renders); the no-stages state disables submit.

- [ ] **Step 8: Run, mutate, commit**

```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run src/lib/automations src/lib/email src/app/api/cron "src/app/(dashboard)/dashboard/accounts/[accountId]/automations"
```

| Mutation | Test that must red |
| --- | --- |
| write `booking:` instead of `opportunity:` in the subject key | the subject-key case in the pass test |
| add "for $4,200" to `automations.quoteFollowup.defaultBody` | the copy's no-price case |
| delete the `stageId !== configStageId` branch from the releaser | the vanished-stage release case |
| remove `latestInboundByContact` from the releaser | the quiet-re-check release case |
| change `elapsedMs < quietDays * DAY_MS` to `<=` in `shouldSendQuoteFollowupNow` | `goes once the deal has sat for the configured days, and not a minute before` |
| hard-code `"America/Chicago"` in `shouldSendQuoteFollowupNow` instead of reading `timezone` | `reads the ACCOUNT's zone, not the machine's: the same instant sends in Chicago and waits in Los Angeles` |
| drop the uuid regex from `parseQuoteFollowupConfig` | the db suite's `"Quoted"` row |
| set `RELEASERS.quote_followup` to `null` | the release suite's "every part B source has a REAL releaser" case — it COMPILES, so nothing else moves |
| delete `quote_followup` from `RELEASERS` | `pnpm --filter web typecheck`, TS2741 |
| change `QUOTE_FOLLOWUP_MAX_QUIET_DAYS` to 21 | the copy's day-range case |

```bash
git add apps/web/src/lib/automations apps/web/src/lib/email/templates apps/web/src/lib/messages.ts apps/web/src/app/api/cron/reminders/route.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations" packages/db/src/automation-log.ts
git commit -m "automations(quote_followup): chase a quiet quote off the pipeline stage the operator nominates"
```

Then hand the Automations page to `bis-design-reviewer`: eight cards on one page is the first time that page has needed a reading order, and the review question is whether the page still reads as one screen or wants grouping.

---

### Task 11: The Playwright pass, the spec's amendments, the roadmap row (bis-e2e-qa; docs by the orchestrator)

**Files:**
- Create: `apps/web/e2e/automations-b.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-21-automation-engine-b-design.md` (append EVERY amendment in this plan's own list at the top — B1 onwards; count them there, never from a number written here, because the fix wave added to that list), `docs/superpowers/specs/2026-07-25-bis-platform-design.md` (§8a's M3 row)

**Holds the shared slot.** Playwright and the `packages/db` live suite never run at the same time.

- [ ] **Step 1: The spec, on the per-run fixture account — never `Test Client One`**

`apps/web/e2e/automations-b.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, upsertAutomation, recordAutomationLog } from "@bis/db";

// Same two paths, same reason, as every spec that talks to Supabase from the
// runner process rather than through a Next request.
loadEnv({ path: "apps/web/.env.local" });
loadEnv({ path: ".env.local" });

test.describe.configure({ timeout: 90_000 });

type ClientFixture = { accountId: string; clerkUserId: string };
const FIXTURE_FILE = "e2e/.auth/client-fixture.json";
/** Read at RUN TIME, never at module scope (setup.spec.ts:70-84 explains the collection-time trap). */
const fixture = (): ClientFixture => {
  if (!existsSync(FIXTURE_FILE)) throw new Error(`client fixture missing at ${FIXTURE_FILE} — run the full suite`);
  return JSON.parse(readFileSync(FIXTURE_FILE, "utf-8")) as ClientFixture;
};
/** A per-run stamp on every string this file writes, so a killed run's row
 *  can never satisfy a later run's assertion. */
const STAMP = Date.now().toString();

/**
 * THE PRECONDITION NO FIXTURE OWNS. `client-access.spec.ts` switches the
 * fixture account's client access OFF and does not restore it, so the second
 * describe below — which signs in as the client — passes or fails on FILENAME
 * ORDER unless this runs. `automations-b` happens to sort before
 * `client-access` today; that is luck, not a guarantee, and both existing
 * specs that use `client-state.json` carry exactly this block for exactly this
 * reason (`automations.spec.ts:40-51`, `activity.spec.ts:23-27`). File-level,
 * not inside a describe, so it covers both.
 */
test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

test.describe("part B's recipes on the Automations page (agency)", () => {
  test("all four cards render, and each one says what it does before it is turned on", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);
    for (const id of ["appointment-confirm-card", "referral-ask-card", "reactivation-card", "quote-followup-card"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    // The pipeline caveat is on the card, in the operator's language, because
    // this recipe only fires for a client who works the board.
    await expect(page.getByTestId("quote-followup-card")).toContainText("only runs for deals you move into the stage you pick");
    // No recipe KEY ever reaches a screen.
    await expect(page.locator("body")).not.toContainText("appointment_confirm");
    await expect(page.locator("body")).not.toContainText("quote_followup");
  });

  test("saving the confirmation ask round-trips a closing line that is NOT a default", async ({ page }) => {
    const { accountId } = fixture();
    const line = `Park on the street ${STAMP}.`;
    try {
      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("appointment-confirm-card");
      await card.getByRole("checkbox").check();
      await card.getByLabel("Closing line").fill(line);
      // The preview is computed through the SAME composer the pass uses, so
      // this is also the proof the operator's count is the billed count.
      await expect(card.getByTestId("appointment-confirm-preview")).toContainText(line);
      await expect(card.getByTestId("appointment-confirm-preview")).toContainText("either way we'll see it");
      await card.getByRole("button", { name: "Save appointment confirmations" }).click();
      await expect(page.getByText("Appointment confirmations saved")).toBeVisible();

      await page.reload();
      const after = page.getByTestId("appointment-confirm-card");
      await expect(after.getByLabel("Closing line")).toHaveValue(line);
      await expect(after.getByRole("checkbox")).toBeChecked();
    } finally {
      // Leave the fixture account OFF: a recipe left enabled would text the
      // fixture's contacts on the next real cron tick.
      await upsertAutomation(serviceDb(), accountId, "appointment_confirm",
        { enabled: false, body: "", config: {} }, "e2e-cleanup");
    }
  });

  /**
   * WHAT THIS CASE CANNOT BE. It was written as "fill 24, expect the server's
   * 'Choose a number of months between 6 and 18.'" — and that can never pass.
   * The field is `<Input type="number" min={6} max={18}>` inside a plain
   * `<form onSubmit>` handled by `useFormSubmit` (`lib/forms/use-form-submit.ts:50-53`,
   * a handler that only ever runs on a `submit` event the browser chose to fire),
   * with no `noValidate`: the browser refuses to dispatch `submit` at all when
   * constraint validation fails, so 24 is refused exactly as 999 would be, the
   * server action never runs, and the assertion times out. The parser's
   * refusal is real and is proved where it can be — `actions.test.ts`, Task 8.
   * So this asserts the two things only a browser can show: that the refusal
   * happens at all, and that a VALID non-default value round-trips.
   */
  test("the reactivation card refuses an out-of-range month count in the browser, and round-trips a valid one", async ({ page }) => {
    const { accountId } = fixture();
    try {
      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("reactivation-card");
      await card.getByRole("checkbox").check();
      const months = card.getByLabel("Quiet for at least");

      // The browser's own refusal, asserted as what it is. Mutation: drop
      // `max={18}` from the card → `rangeOverflow` is false and this reds.
      await months.fill("24");
      expect(await months.evaluate((el) => (el as HTMLInputElement).validity.rangeOverflow)).toBe(true);

      // 12: inside the range, and NOT the 9 the card defaults to, so a page
      // that re-rendered the default after saving could not pass this.
      await months.fill("12");
      await card.getByRole("button", { name: "Save check-ins" }).click();
      await expect(page.getByText("Check-ins saved")).toBeVisible();

      await page.reload();
      const after = page.getByTestId("reactivation-card");
      await expect(after.getByLabel("Quiet for at least")).toHaveValue("12");
      // It is a cap, so it ships with its context (DESIGN.md rule 1).
      await expect(after).toContainText("At most five a day");
    } finally {
      await upsertAutomation(serviceDb(), accountId, "reactivation",
        { enabled: false, body: "", config: { months: 9 } }, "e2e-cleanup");
    }
  });
});

test.describe("part B on the Activity page (client)", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("a part B row renders with the recipe's TITLE and a reason the code could not produce by default", async ({ page }) => {
    const { accountId } = fixture();
    const subjectKey = `booking:e2e-${STAMP}`;
    const reason = `E2E reason ${STAMP}`;
    try {
      await recordAutomationLog(serviceDb(), {
        accountId, source: "appointment_confirm", channel: "sms", contactId: null,
        subjectKey, status: "skipped", reason,
      });
      await page.goto(`/dashboard/accounts/${accountId}/activity`);
      const row = page.locator("[data-log-row]").first();
      await expect(row).toContainText("Appointment confirmations");
      await expect(row).not.toContainText("appointment_confirm");
      await expect(row).toContainText("Skipped");
      await expect(row).toContainText(reason);
      // Mutation: render `row.source` instead of SOURCE_TITLES[row.source] →
      // both the positive and the negative assertion red.
    } finally {
      await serviceDb().from("automation_log")
        .delete().eq("account_id", accountId).eq("subject_key", subjectKey);
    }
  });
});
```

> This spec deliberately does **not** drive a real inbound webhook or a real send. `matchConfirmationReply` and `applyConfirmationReply` are covered by the db suite against the live project (Task 2), and no Playwright test in this repo may call a provider — so neither is imported here. Import nothing this file does not use.

- [ ] **Step 2: Run it — and make sure the fixture it runs against is alive**

A bare filtered run is a trap this repo has already written down. `playwright.config.ts` declares a `setup` project (`auth.setup.ts`, two tests) that the `chromium` project depends on, and a `teardown` project (`auth.teardown.ts`) that **deletes the fixture ACCOUNT after every run while leaving `e2e/.auth/client-fixture.json` on disk** (`auth.teardown.ts:38-97`). A filter of one spec file matches neither, so the setup never runs, `fixture()` happily reads a stale file, and all four tests fail against a deleted tenant — which reads as a code failure and is not. `setup.spec.ts:69-87` records exactly this ("missing at run time is a FAILURE, not a skip — the 'setup' project's dependency was bypassed").

So either run the whole suite:

```bash
pnpm --filter web test:e2e
```

or include the setup file in the filter and **confirm from the run's own summary that it ran**:

```bash
pnpm --filter web exec playwright test e2e/auth.setup.ts e2e/automations-b.spec.ts
```

Expected: the four titles below pass —
`all four cards render, and each one says what it does before it is turned on`,
`saving the confirmation ask round-trips a closing line that is NOT a default`,
`the reactivation card refuses an out-of-range month count in the browser, and round-trips a valid one`,
`a part B row renders with the recipe's TITLE and a reason the code could not produce by default`.
Count TITLES, not a total: the summary also carries the setup project's `authenticate as agency_admin` and `authenticate as client user (no app_role)` and the teardown's `delete the client-access e2e fixture` whenever those ran, so no single number ("4 passed") is the right expectation for this file.

Then the two prescribed mutations, each scoped, each reverted: (a) render `row.source` instead of `SOURCE_TITLES[row.source]` in `activity-table.tsx` → the Activity test reds on both assertions; (b) drop `max={18}` from the reactivation card's number input → the browser stops refusing and `rangeOverflow` is false, so the reactivation test reds on its first assertion.

**This is the only end-to-end coverage the four new cards have.** Any later fix wave that touches one of them re-runs this file, not just the unit tests beside it.

The gate run (`pnpm --filter web build` then `pnpm --filter web test:e2e`) is the ORCHESTRATOR's, one at a time, and it is the arbiter.

- [ ] **Step 3: The spec and the roadmap (orchestrator, on the branch)**

Append to `docs/superpowers/specs/2026-09-21-automation-engine-b-design.md`, under a new `## Amendments taken from the plan (2026-09-21)` heading, **every amendment in this plan's own list at the top, verbatim, from B1 to the last one there.** Take the count from that list, never from a number written in this step: the fix wave of 2026-09-21 added amendments to it, and a step that hard-codes "B1–B8" silently drops whatever came after.

One correction in the same file while you are in it, because it states something the code cannot do. Spec line 42 ends: *"Candidates are bounded by the tick cap, so this is one `.in(…)` read per tick, not one per row."* They are not: `AUTOMATION_TICK_CAP` is applied inside `processQuoteFollowups`, long after the due-list's read has been made, and this recipe's trigger is a RESTING state with a thirty-day window — an account whose nominated stage holds hundreds of open deals yields hundreds of rows and hundreds of uuids in the `.in(…)`. Replace that sentence with: *"Candidates are bounded by `QUOTE_FOLLOWUP_CANDIDATE_LIMIT` (200, oldest stage change first), so this is one bounded `.in(…)` read per tick, not one per row; the tick cap is a SEND cap applied later in the pass and bounds nothing about this read."*

In `docs/superpowers/specs/2026-07-25-bis-platform-design.md` §8a, the M3 row: extend its status text with "part B shipped 2026-09-21 (#<PR>): four more recipes — appointment confirmations with a YES/NO reply recorded on the booking, referral asks as the completed-job ladder's third rung, a once-ever reactivation email to a past customer, and a pipeline-driven quote follow-up. Still owed: a rule builder, deferred until a second client's needs diverge from the catalogue." Keep the row's shape; update the header's "as of" to the merge date and PR number.

```bash
git add apps/web/e2e/automations-b.spec.ts docs/superpowers/specs/2026-09-21-automation-engine-b-design.md docs/superpowers/specs/2026-07-25-bis-platform-design.md
git commit -m "e2e(automations): part B's four cards on the fixture account; the plan's spec amendments; §8a M3 row"
```

---

## Self-review

**Spec coverage**, section by section:

| Spec section | Task |
| --- | --- |
| Migration `0047_automations_b.sql` (both CHECKs, nine columns, **nine** indexes — three cap counts, two due-lists the spec named, three the plan review added for the referral ask's two anchors and reactivation's anti-blast read, and one the PRE-APPLY review added for applyConfirmationReply's lookup — no grant changes) | Task 1 |
| Recipe 2 `appointment_confirm` — trigger, window, SMS-only, deadline, uncapped, copy, subject key, release, off switches | Tasks 2, 3 |
| Recipe 2's reply leg — `applyConfirmationReply`, whole-word matching, no reply-back, no status change, the operator sees it | Tasks 2, 4 |
| Recipe 4 `referral_ask` — anchor, ladder, precedence, no-link enforcement, channel config, caps, subject key, release | Tasks 5, 6 |
| Recipe 3 `reactivation` — completed-booking predicate, quiet months 6–18/9, email only, own cap of 5, once per contact, oldest-first with a PAGED candidate read, lagging-touch pre-filter plus an exact per-row quiet check before every send, quiet re-check on release | Tasks 7, 8 |
| Recipe 1 `quote_followup` — stage config, quiet days, 30-day ceiling, the inbound-quiet test, stage-gone reason, caps, subject key, release | Tasks 9, 10 |
| `caps.ts` grows: `REACTIVATION_DAILY_CAP` | Task 8, Step 1 |
| `caps.ts`'s doc comment names `appointment_confirm` beside the text reminder as an exempt pass (spec decision 2's closing obligation) | Task 3, with the recipe that earns the exemption |
| Testing section — gates pure and alone with boundaries AT the boundary; the ladder's collision and precedence; the anti-blast rule and the exact cap number; the quiet re-check on release for both recipes; the matcher's positives and negatives; tenancy on every releaser; `outbound-suppressed` cases first; the copy guards; the registry as a type error; the `cron-coupling` case | Every task's test steps; the mutation table at the end of each |
| Build order `appointment_confirm → referral_ask → reactivation → quote_followup`, schema first | The Process section and the task numbering |
| Out of scope (re-arming, a segment picker, SMS for reactivation, auto-cancel on NO, a reply-back, per-account caps, a second scheduler) | Nothing in this plan builds any of them; the `quote_followup` stamp comment and the reactivation channel comment each say so in code |

**Gaps found and closed while reviewing.**
- The spec says `outbound-suppressed.test.ts` "gets its four cases written BEFORE the four due-lists". That file's walk is GENERIC (per-function, over `automations.ts`), so there are no four cases to write. The honest equivalent — and the one that produces a real red — is to add each due-list's skeleton WITHOUT `loadSendableRows`, watch the walk fail naming the new function, then complete it. Every data-layer task's Step 1 does exactly that, plus a live suppression case in `automations.test.ts`.
- The spec's `stageId`-gone reason is unreachable on a normal tick (B3); the plan moves it to the releaser and adds the card notice.
- `packages/db/src/index.ts` re-exports `./automations` by a NAMED list, not `export *`. Every data-layer task has an explicit export step.
- The `appointment_confirm` deadline is very nearly inert (the ask is due two days out; the deadline is a day out; a quiet window is under 24 hours). Task 3 says so in the pass's own comment rather than implying the exemption does work it does not.
- `reactivationCutoff` had to live in `packages/db`, not in the web gate, because the due-list needs it and the package cannot import from `apps/web`.
- Two email templates did not exist (`referral-ask.ts`, `quote-followup.ts`) beyond the one the spec implied (`reactivation`); all three are in the `followup.ts` shape, none has a button, and none adds a shell primitive (B7).
- The reactivation due-list starved and mis-scoped its lagging-touch guard. Contact eligibility now rides a `contacts!inner` embed and the candidate read WALKS pages (the completed-booking rule has no join path from `conversations`), and the bulk message read queries the EARLIEST cutoff with each row compared to its OWN account's — an account set to 18 months on a platform where another is set to 6 previously never had its own cutoff enforced, so a contact who wrote in ten months ago would still have received "it's been a while". The exact check now runs per row in the pass, immediately before the send. B5's wording was narrowed to its real argument.
- The spec asks each `*-copy.ts` for an `INTERNAL_MILESTONE` guard. `messages.test.ts:44-51` already walks the WHOLE catalogue and fails any key that matches, so the per-module tests keep the assertion for the COMPOSED strings only, and nothing in part B joins the `AGENCY_ONLY` allowlist (B8).

**Placeholder scan.** No "TBD", "TODO", "implement later", "add validation", "handle edge cases" or "write tests for the above". Five instructions say "read the file first and the SOURCE wins if it differs" — `packages/db/src/test/booking.test.ts`'s insert helpers (Task 1), `route.test.ts`'s fixture names (Tasks 3 and 4), `packages/db/src/test/messaging.test.ts`'s `ensureConversation`/`createMessage` signatures (Task 7), `packages/db/src/test/opportunities.test.ts`'s `createOpportunity` shape (Task 9), and the PostgREST `contacts!inner` embed shape (Task 7, to be confirmed at the live-db slot). Each names a real file that exists and each is a verification instruction, not a blank: the code around it is given in full, and a brief has been wrong about a signature in this repo before.

Tasks 6, 8 and 10 give their pass files as a full code block (Task 6), or as a complete diff list against a named model file plus the full releaser (Tasks 8 and 10). Repeating `review-request.ts`'s two hundred lines four times would be the larger error: the differences are what an implementer needs and every one of them is enumerated, including counter names, stamp function names, subject-key prefixes and whether a link is appended.

**Type consistency.** `DueLookup<T>` is `{ due: T; why?: undefined } | { due: null; why: "gone" | "off" }` in all four by-id lookups. `Releaser = (ctx: PassContext, row: AutomationLogRow) => Promise<ReleaseVerdict>` for all four releasers. `HoldSubject` carries `accountTimezone` and optional `deadline` and is built AFTER the config parses wherever the channel is configured (`referral_ask`, `quote_followup`) and before anything else where it is fixed (`appointment_confirm`, `reactivation`). Subject-key prefixes: `booking:` for `appointment_confirm` and `referral_ask`, `contact:` for `reactivation`, `opportunity:` for `quote_followup`; each releaser strips its own with the matching regex. Stamp names match their columns one-for-one (`stampAppointmentConfirmAsked`/`confirm_asked_at`, `stampReferralAsked`/`referral_asked_at`, `stampReactivationSent`/`reactivation_sent_at`, `stampQuoteFollowupSent`/`quote_followup_sent_at`). `ProcessOptions = { released: boolean }` is declared locally in `referral-ask.ts`, `reactivation.ts` and `quote-followup.ts` and NOT in `appointment-confirm.ts`, which has no band to skip — the same choice `review-request.ts:52` records. `REASONS` gains exactly four keys — `tooCloseToAppointment`, `reviewFirst`, `heardBack`, `stageGone` — and `heardBack` is deliberately shared by `reactivation` and `quote_followup`, which is why its comment names both. `AUTOMATION_LOG_SOURCES` reaches thirteen across Tasks 3, 6, 8 and 10, matching 0047's CHECK exactly after Task 10.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-21-automation-engine-b.md`. Execution is subagent-driven per the Process section: Task 1 → *orchestrator applies 0047 once and runs the db suite* → Tasks 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11, a five-minute brief review before each dispatch, `bis-reviewer` beside each writer, and the db suite and Playwright one at a time on the shared slot.
