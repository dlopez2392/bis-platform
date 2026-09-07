# Automations Milestone B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two remaining state-derived recipes on the Milestone A harness — the no-show nudge and the ~2h SMS booking reminder — together with the two decisions danlo took after Milestone A shipped: the review clock anchors on completion (`bookings.completed_at`, migration 0026), and a failed SMS attempt holds that booking for 24 hours.

**Architecture:** Nothing structural changes. Each recipe is one more registry entry — its own due-list in `packages/db` (an `automations` read, then a `bookings` read), its own pure gate, its own copy, its own pass with counters — and one more card on the agency-only Automations page. Migration 0026 adds the clocks (`completed_at`, `no_show_at`), the dedupe stamps (`no_show_nudged_at`, `sms_reminder_sent_at`) and the attempt markers (`*_sms_failed_at`) to `bookings`, and extends the recipe catalogue CHECK. The SMS send path (provider first → message row → send → mark failed → attempt marker) moves into ONE shared helper the three SMS-capable passes call, with the review-request tests unchanged as the proof.

**Tech Stack:** Next.js 15 App Router (apps/web), Supabase Postgres + PostgREST via `@supabase/supabase-js` (packages/db), Clerk, vitest, Playwright, Vercel cron every 15 minutes.

**Spec:** `docs/superpowers/specs/2026-09-06-automations-design.md` — Sections 2–5 and **"Decisions taken after Milestone A shipped"** (merged to `main` via PR #27 on 2026-09-06, commit `3f6f447`). Plan A (`docs/superpowers/plans/2026-09-06-automations-milestone-a.md`) is the template this plan copies: same task shape, same mutation discipline.

## Global Constraints

- **Branch:** all work on `feat/automations-b`, branched from `main` after `git fetch origin` (Task 1, Step 1). **The repo is PR-only (PR #25): never push `main`.** Land through a PR; merge only when CI jobs `verify` AND `e2e` are green on the PR's CURRENT head, and only when danlo says to (no autonomous merges).
- **Parallel sessions move this working tree.** Every command that writes or commits verifies the branch IN THE SAME COMMAND: `B="$(git branch --show-current)"; [ "$B" = "feat/automations-b" ] && git commit ... || echo "BRANCH MOVED TO $B"`.
- **Migration 0026 is applied ONCE, by the orchestrating session, via the Supabase MCP `apply_migration` tool on project `tlbkbmlrfafquucsmsmm`**, after a pre-flight read (Task 1, Step 8). The e2e suite and `packages/db` tests share that ONE project with production. **Never re-apply. Never `db:push`. 0025 is already applied — never touch it.**
- **Off by default:** the two new recipes need an `automations` row with `enabled=true` that no account has. Nothing changes for any client on deploy. `completed_at` / `no_show_at` are stamped from the moment of deploy, which is data, not behaviour.
- **The brand-name leak:** every due-row type carries `brandName` and never `accountName`; `PassContext` has no name at all. The sentinel test scans every send of every registered pass.
- **Caps** (`AUTOMATION_TICK_CAP = 10`, `AUTOMATION_DAILY_CAP = 25`, rolling 24h off the pass's own stamp column) apply to the **no-show nudge**. **The SMS reminder pass is UNCAPPED** (decision 4 below), like the two migrated passes.
- **The SMS cooldown:** `SMS_RETRY_COOLDOWN_MS = 24h`. After a provider failure the pass writes the recipe's own `*_sms_failed_at`; the same pass skips the booking while that marker is younger than 24h and counts `skippedRecentFailure`. `ceil(61h / 24h) = 3` attempts across the review window, pinned. Email sends carry no marker and no cooldown (the decision is about the visible failed `messages` rows SMS writes).
- **The clocks:** review request runs from `laterOf(ends_at, completed_at)`; no-show nudge from `laterOf(ends_at, no_show_at)`. A null or unreadable stamp falls back to `ends_at` — rows flipped before 0026 behave exactly as before.
- **Staleness caps:** `REVIEW_REQUEST_MAX_AGE_MS = 61h` (unchanged; only the anchor moves), `NO_SHOW_NUDGE_MAX_AGE_MS = 37h` (= `FOLLOWUP_QUERY_WINDOW_MS`, same derivation, nothing to defer to). Both defined ONCE in `packages/db`.
- **`route.test.ts` may gain ONLY new mocks, new `EMPTY_*` constants, one new key inside `EMPTY_REVIEW_REQUESTS`, and the two new keys on its strict-equality bodies.** No existing line is removed (verified with `git diff | grep -E "^-[^-]"`). `passes/review-request.test.ts` gains one counter key in its `EMPTY` fixture, two fields in its `row()` fixture, one mock, and new tests — its existing assertions are untouched. `review-request-gate.test.ts` and `review-request-copy.test.ts` and `email/templates/review-request.test.ts` are NOT edited except to append (the gate file gains one import and one describe).
- **Zone tests:** one instant, two zones, opposite verdicts. `America/Chicago` (the dev machine) only ever as one half of a pair. Every instant computed with `Intl.DateTimeFormat` before the assertion is written (each task gives the node one-liner and its expected output).
- **Every test names its mutation.** A test whose mutation leaves it green is not finished.
- **Copy:** plain language a business owner reads at 7 AM; no `{{template_syntax}}` on client-facing surfaces (`{name}`/`{when}` in `messages.ts` are filled by code, never by an operator). Every SMS default stays inside GSM-7 (straight apostrophes, no em dashes) and its segment count is MEASURED in a test. UI uses the existing components exactly as `automations-settings.tsx` does; no hard-coded colours (DESIGN.md).
- **`pnpm check` = typecheck + lint + db tests + web tests.** Baseline at `main` `20ad5f3` (from the ledger): db 199 · web 1240 · e2e 70/70. Run gates with `cmd > out.txt 2>&1; echo "exit=$?"` — pipes mask exit codes. Run the db suite ALONE (its tests hit the real, production-shared database).
- **Never run the e2e suite while a live voice/video test is in progress** — it wipes Test Client One's calendar by design.
- **Bash cwd persists across calls: every git/pnpm command starts with `cd /c/Users/danlo/bis-platform`** (three commits silently failed in Milestone A before this became a rule).

## Decisions this plan makes where the spec is silent (flag to danlo, do not re-litigate the ones above)

1. **No-show nudge timing = the follow-up's shape:** the morning band (08:00–11:00 in the account's zone) on a strictly LATER local day than `laterOf(ends_at, no_show_at)`, staleness 37h. Rejected: sending minutes after the operator presses "Mark no-show" — operators mark no-shows while closing the books at night, and a 21:30 text is exactly the class of defect the morning band exists to prevent. No follow-up collision: `listDueFollowups` excludes `no_show` (pinned in `booking.test.ts`).
2. **The nudge's link is the account's public booking page,** `${origin}/b/${calendar.public_id}` — no per-recipe URL to configure or validate. The due-row carries `calendarEnabled`; when the public page is off the pass skips and counts `skippedCalendarOff` rather than send a link that 404s.
3. **SMS reminder window `[now + 1h30m, now + 2h15m]` on `starts_at`.** The window's close decides when a booking first qualifies (the first tick at which the start is ≤ 2h15m away, so the text lands 2h–2h15m ahead); the 45-minute width is three ticks of catch-up. A booking made less than 90 minutes ahead gets no text. Pinned against `vercel.json` in `cron-coupling.test.ts`.
4. **The SMS reminder pass is uncapped.** The spec caps recipe passes, but its own reasoning for leaving the email reminder uncapped ("a reminder is one-to-one with a booking the customer made; a daily cap on a busy client would DROP reminders — the row leaves its window before the rolling day clears — turning a burst guard into no-shows") applies verbatim to a 45-minute window. No bulk status change can create a burst here; only bookings customers made.
5. **The cooldown store is a per-recipe `*_sms_failed_at` column on `bookings`, not `hasRecentOutboundSms`.** The decision names that helper as the pattern; it cannot be reused as-is: it counts ANY outbound SMS in the conversation, sent or failed, so a reminder text that went out at noon would silence the review request the next morning. The pattern (check for a recent attempt before sending) is kept; the store is the booking row, which the due-list already projects — no extra query, no jsonb filter. One column per recipe, not one shared column, so a failed reminder does not hold the review request.
6. **SMS reminder copy shape:** a fixed lead sentence carrying the time (`Reminder: your appointment with {name} is {when}.`) followed by the operator's prose (default `Reply to this text if you need to make a change.`). The time is never the operator's to place; the preview composes the same string with a fixed sample instant. English only — bookings do not store the booker's locale (residual, stated in Task 9).
7. **The gate signatures stay four-argument.** `shouldSendReviewRequestNow(now, anchor, followupSentAt, timezone)` keeps its shape (its parameter is renamed `meetingEnd` → `anchor`, its 10 tests untouched); the pass computes `anchor = laterOf(endsAt, completedAt)`. The no-show gate is `shouldSendNoShowNudgeNow(now, anchor, timezone)`.

---

## File Structure

**packages/db**
- `supabase/migrations/0026_automations_b.sql` — CREATE. Seven `bookings` columns, the recipe-key CHECK, four partial indexes.
- `src/booking.ts` — MODIFY. `BookingRow`/`BOOKING_COLS` gain the seven columns; `setBookingStatus` stamps `completed_at` / `no_show_at`.
- `src/automations.ts` — MODIFY (full replacement in Task 2). `RecipeKey` grows; shared `listEnabled` + `eitherAnchorSince` helpers; review due-row gains `completedAt`, `smsFailedAt`; `stampReviewRequestSmsFailed`; the no-show section (`NoShowNudgeConfig`, `parseNoShowNudgeConfig`, `NO_SHOW_NUDGE_MAX_AGE_MS`, `DueNoShowNudge`, `listDueNoShowNudges`, `stampNoShowNudged`, `stampNoShowNudgeSmsFailed`, `countNoShowNudgesSince`); the SMS-reminder section (`SMS_REMINDER_WINDOW_START_MS`, `SMS_REMINDER_WINDOW_END_MS`, `DueSmsReminder`, `listDueSmsReminders`, `stampSmsReminderSent`, `stampSmsReminderFailed`).
- `src/index.ts` — MODIFY. Exports.
- `src/test/automations-grants.test.ts` — MODIFY (append). 0026 columns + catalogue, watched failing first.
- `src/test/booking.test.ts` — MODIFY (append). `setBookingStatus` stamps, watched failing first.
- `src/test/automations.test.ts` — MODIFY (append). Anchor window, no-show due-list, SMS-reminder due-list, stamps.

**apps/web — lib**
- `src/lib/automations/caps.ts` — MODIFY. `SMS_RETRY_COOLDOWN_MS`.
- `src/lib/automations/send-sms.ts` + `.test.ts` — CREATE. `sendAutomationSms`, `markAutomationSmsSent`, `smsCooldownActive`, the actor constants.
- `src/lib/automations/anchor.ts` + `.test.ts` — CREATE. `laterOf`.
- `src/lib/automations/sms-link.ts` — CREATE. `withTrailingLink` (the ONE place a link is appended to an SMS).
- `src/lib/automations/review-request-copy.ts` — MODIFY. `composeReviewRequestSms` delegates to `withTrailingLink`; its test file is NOT edited.
- `src/lib/automations/review-request-gate.ts` — MODIFY. Parameter rename + doc; its test file gains one import and one describe.
- `src/lib/automations/passes/review-request.ts` — MODIFY. Shared SMS helper, cooldown, anchor.
- `src/lib/automations/passes/review-request.test.ts` — MODIFY (fixture keys + append).
- `src/lib/automations/no-show-nudge-gate.ts` + `.test.ts`, `no-show-nudge-copy.ts` + `.test.ts`, `passes/no-show-nudge.ts` + `.test.ts` — CREATE.
- `src/lib/automations/sms-reminder-copy.ts` + `.test.ts`, `passes/sms-reminder.ts` + `.test.ts` — CREATE.
- `src/lib/automations/registry.ts`, `sentinel.test.ts`, `imports.test.ts`, `cron-coupling.test.ts` — MODIFY.
- `src/lib/email/templates/prose-button.ts` — CREATE. `proseWithButton`. `templates/review-request.ts` — MODIFY to use it (its test NOT edited). `templates/no-show-nudge.ts` + `.test.ts` — CREATE.
- `src/lib/messages.ts` — MODIFY. Copy keys.
- `src/app/api/cron/reminders/route.test.ts` — MODIFY, additions only (Tasks 3, 6, 7).

**apps/web — page**
- `src/components/ui/textarea.tsx` — CREATE (the ledger's deferred "third copy" of the textarea class string, before it becomes a fifth).
- `src/app/(dashboard)/dashboard/accounts/[accountId]/automations/automations-settings.tsx` — MODIFY. `Textarea`, card-scoped ids, `data-testid`.
- `.../automations/no-show-nudge-card.tsx`, `.../automations/sms-reminder-card.tsx` — CREATE.
- `.../automations/actions.ts` + `actions.test.ts` — MODIFY. Two more actions.
- `.../automations/page.tsx` + `page.test.ts` — MODIFY. Three rows, the calendar, the origin, the account zone.
- `src/lib/palette/registry.ts` — MODIFY. Keywords.
- `e2e/automations.spec.ts` — MODIFY. Scope the existing "Send by" to the review card; two new page assertions.

---

### Task 1: Migration 0026 and the status clocks — proven by tests written and watched failing first

**Files:**
- Create: `packages/db/supabase/migrations/0026_automations_b.sql`
- Modify: `packages/db/src/booking.ts` (`BookingRow` at 19-26, `BOOKING_COLS` at 83-85, `setBookingStatus` at 279-290)
- Modify: `packages/db/src/test/automations-grants.test.ts` (append)
- Modify: `packages/db/src/test/booking.test.ts` (append inside the top-level `describe("booking accessors")`, after the `setBookingStatus refuses…` test)

**Interfaces:**
- Produces: columns `public.bookings.{completed_at, no_show_at, no_show_nudged_at, sms_reminder_sent_at, review_request_sms_failed_at, no_show_nudge_sms_failed_at, sms_reminder_failed_at} timestamptz`; `automations.recipe_key` CHECK `in ('review_request','no_show_nudge','sms_reminder')`; `setBookingStatus` stamps `completed_at` on a flip to `completed` and `no_show_at` on a flip to `no_show` (never cleared); `BookingRow` carries all seven.

- [ ] **Step 1: Fetch, fast-forward main, create the branch — clean tree and branch verified in the same command**

```bash
cd /c/Users/danlo/bis-platform && git fetch origin && [ -z "$(git status --porcelain)" ] && [ "$(git branch --show-current)" = "main" ] && git merge --ff-only origin/main && git checkout -b feat/automations-b && echo "NOW ON: $(git branch --show-current) @ $(git rev-parse --short HEAD)" || { echo "NOT CLEAN, NOT ON MAIN, OR NOT FAST-FORWARDABLE"; git status --porcelain; git branch --show-current; }
```
Expected: `NOW ON: feat/automations-b @ <sha>` where `<sha>` is `origin/main`'s head (`3f6f447` at authoring time — PR #27 merged 2026-09-06 20:4xZ, so the spec's decisions section is on `main`). The plan document itself (`docs/superpowers/plans/2026-09-06-automations-milestone-b.md`) is committed on this branch in Step 10.

- [ ] **Step 2: Write the migration**

`packages/db/supabase/migrations/0026_automations_b.sql`:

```sql
-- 0026: Automations Milestone B — the two remaining state-derived recipes
-- (no-show nudge, ~2h SMS booking reminder) and the two decisions taken after
-- Milestone A shipped (spec, "Decisions taken after Milestone A shipped").
--
-- 1. THE CLOCKS. The review clock anchors on COMPLETION, not only on ends_at:
--    a client who batch-marked a week's jobs completed on Friday got no review
--    requests for anything older than 61h, and no counter said so.
--    `completed_at` and its twin `no_show_at` are stamped by setBookingStatus
--    on the flip TO that status; each gate runs from the LATER of ends_at and
--    the stamp. Rows flipped before this migration keep null and therefore
--    keep the ends_at anchor — the pre-B behaviour exactly. Never cleared on a
--    flip away: the status filter already stops the row matching, and a
--    re-flip re-stamps.
-- 2. THE ATTEMPT MARKERS. One SMS attempt per booking per day after a FAILED
--    attempt: write-then-send on a 15-minute cron wrote ~12 failed messages
--    rows per booking per morning band during a carrier outage. Each
--    `*_sms_failed_at` is an ATTEMPT marker (never a receipt), written by its
--    pass on a provider failure and read back by the same pass's due-list;
--    the pass holds the booking while the marker is younger than 24h and
--    counts the hold. One column per recipe, not one shared column: an SMS
--    reminder that failed at noon must not silence the review request the
--    next morning.
-- 3. THE DEDUPE STAMPS for the two new recipes — send-then-stamp, like
--    reminder_sent_at, followup_sent_at and review_requested_at.
-- 4. THE CATALOGUE grows by two keys. Postgres names an inline column CHECK
--    <table>_<column>_check; the pre-flight read confirms the name before
--    this runs.
--
-- Grants: bookings revokes UPDATE from `authenticated` (house pattern, pinned
-- in automations-grants.test.ts); new columns inherit that. OFF BY DEFAULT:
-- the two new recipes need an enabled automations row that no account has.

alter table public.bookings
  add column completed_at timestamptz,
  add column no_show_at timestamptz,
  add column no_show_nudged_at timestamptz,
  add column sms_reminder_sent_at timestamptz,
  add column review_request_sms_failed_at timestamptz,
  add column no_show_nudge_sms_failed_at timestamptz,
  add column sms_reminder_failed_at timestamptz;

alter table public.automations drop constraint automations_recipe_key_check;
alter table public.automations add constraint automations_recipe_key_check
  check (recipe_key in ('review_request', 'no_show_nudge', 'sms_reminder'));

-- The review and no-show due-lists match on EITHER anchor (ends_at OR the
-- stamp inside the window); a second partial index per recipe lets Postgres
-- BitmapOr the two instead of scanning.
create index bookings_review_due_completed
  on public.bookings (completed_at) where status = 'completed' and review_requested_at is null;
create index bookings_no_show_due
  on public.bookings (ends_at) where status = 'no_show' and no_show_nudged_at is null;
create index bookings_no_show_due_marked
  on public.bookings (no_show_at) where status = 'no_show' and no_show_nudged_at is null;
create index bookings_sms_reminder_due
  on public.bookings (starts_at) where status = 'booked' and sms_reminder_sent_at is null;
```

- [ ] **Step 3: Append the 0026 proofs to the grants test**

Append to `packages/db/src/test/automations-grants.test.ts` (after the `0025 automations RLS` describe; `seedTwoAccounts` is a module-level function declaration and is hoisted):

```ts
/**
 * 0026, at the level that can see it. Watched failing BEFORE the migration:
 * the column list comes back empty and the catalogue insert is refused with
 * 23514 (check_violation) — the proof neither test passes by accident.
 */
describe("0026 automations B", () => {
  it("bookings carries the seven B columns: two clocks, two dedupe stamps, three attempt markers", async () => {
    await withRollback(async (c) => {
      const { rows } = await c.query<{ column_name: string }>(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'bookings'
            and column_name in ('completed_at', 'no_show_at', 'no_show_nudged_at', 'sms_reminder_sent_at',
                                'review_request_sms_failed_at', 'no_show_nudge_sms_failed_at', 'sms_reminder_failed_at')`,
      );
      // Sorted in JS on both sides: Postgres collation orders underscores
      // differently from JS, and the order is not the claim.
      expect(rows.map((r) => r.column_name).sort()).toEqual([
        "completed_at", "no_show_at", "no_show_nudge_sms_failed_at", "no_show_nudged_at",
        "review_request_sms_failed_at", "sms_reminder_failed_at", "sms_reminder_sent_at",
      ].sort());
    });
  });

  it("the recipe catalogue accepts the two B keys", async () => {
    await withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await c.query(
        "insert into automations (account_id, recipe_key) values ($1, 'no_show_nudge'), ($1, 'sms_reminder')", [a]);
      const { rows } = await c.query("select recipe_key from automations where account_id = $1", [a]);
      expect(rows.map((r: any) => r.recipe_key).sort()).toEqual(["no_show_nudge", "review_request", "sms_reminder"]);
    });
  });

  it("the recipe catalogue still refuses an unknown key with check_violation (23514)", async () => {
    // Its own transaction: one refused statement per withRollback (the 25P02 lesson).
    await withRollback(async (c) => {
      const { a } = await seedTwoAccounts(c);
      await expect(
        c.query("insert into automations (account_id, recipe_key) values ($1, 'rule_builder')", [a]),
      ).rejects.toMatchObject({ code: "23514" });
    });
  });
});
```

- [ ] **Step 4: Append the clock test to `booking.test.ts`**

Inside the top-level `describe("booking accessors", …)`, directly after the `it("setBookingStatus refuses a booking from the WRONG account, …")` test, add:

```ts
  /**
   * The automation clocks (spec, "Decisions taken after Milestone A shipped"):
   * `completed_at` / `no_show_at` are stamped on the flip TO that status so
   * the review request and the no-show nudge can run from the operator's
   * action, not only from ends_at. Never cleared on a flip away (the status
   * filter does the excluding); a re-flip re-stamps. Watched failing BEFORE
   * 0026: PostgREST answers PGRST204 (no such column in the schema cache).
   * Mutation: drop `...stamp` from setBookingStatus's update.
   */
  it("setBookingStatus stamps completed_at / no_show_at on the flip to that status, keeps them on a flip away, re-stamps on a re-flip", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Clock" }, "user_test");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-20T15:00:00Z"),
          endsAt: new Date("2027-03-20T16:00:00Z") }, "user_test");
      const read = async () => {
        const { data, error } = await db.from("bookings")
          .select("status, completed_at, no_show_at").eq("id", booking.id).single();
        if (error) throw new Error(error.message);
        return data as { status: string; completed_at: string | null; no_show_at: string | null };
      };
      expect(await read()).toEqual({ status: "booked", completed_at: null, no_show_at: null });

      const before = Date.now() - 1000;
      await setBookingStatus(db, accountId, booking.id, "completed", "user_test");
      const completed = await read();
      expect(completed.status).toBe("completed");
      expect(new Date(completed.completed_at!).getTime()).toBeGreaterThanOrEqual(before);
      expect(completed.no_show_at).toBeNull();

      await setBookingStatus(db, accountId, booking.id, "booked", "user_test");
      expect((await read()).completed_at).toBe(completed.completed_at);     // kept, not cleared

      await new Promise((r) => setTimeout(r, 10));
      await setBookingStatus(db, accountId, booking.id, "completed", "user_test");
      expect(new Date((await read()).completed_at!).getTime())
        .toBeGreaterThan(new Date(completed.completed_at!).getTime());       // re-stamped

      await setBookingStatus(db, accountId, booking.id, "no_show", "user_test");
      const noShow = await read();
      expect(noShow.status).toBe("no_show");
      expect(noShow.no_show_at).not.toBeNull();
      expect(noShow.completed_at).not.toBeNull();                            // never cleared
    });
  });
```

- [ ] **Step 5: Run both and watch them fail for the RIGHT reasons**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations-grants.test.ts src/test/booking.test.ts -t "0026|stamps completed_at" > /c/Users/danlo/AppData/Local/Temp/claude/gate-0026-pre.txt 2>&1; echo "exit=$?"; grep -E "23514|PGRST204|schema cache|toEqual|✓|✗|×|passed|failed" /c/Users/danlo/AppData/Local/Temp/claude/gate-0026-pre.txt | head -20
```
Expected: `exit=1`. The columns test fails (`[]` received); "accepts the two B keys" rejects with `23514`; "refuses an unknown key" PASSES (the old CHECK also refuses it — fine); the booking test fails on the first `setBookingStatus` with `Could not find the 'completed_at' column of 'bookings' in the schema cache` (`PGRST204`). **If instead everything passes, 0026 has already been applied by another session — STOP and report.**

- [ ] **Step 6: The `booking.ts` edits**

(a) `BookingRow` — after `review_requested_at: string | null;` add:
```ts
  /** 0026 clocks: stamped on the flip TO completed / no_show, never cleared. */
  completed_at: string | null;
  no_show_at: string | null;
  /** 0026 dedupe stamps (send-then-stamp) and SMS attempt markers. */
  no_show_nudged_at: string | null;
  sms_reminder_sent_at: string | null;
  review_request_sms_failed_at: string | null;
  no_show_nudge_sms_failed_at: string | null;
  sms_reminder_failed_at: string | null;
```
(b) `BOOKING_COLS` becomes:
```ts
const BOOKING_COLS =
  "id, account_id, calendar_id, contact_id, starts_at, ends_at, status, note, " +
  "cancel_token, booker_timezone, reminder_sent_at, meeting_url, followup_sent_at, review_requested_at, " +
  "completed_at, no_show_at, no_show_nudged_at, sms_reminder_sent_at, " +
  "review_request_sms_failed_at, no_show_nudge_sms_failed_at, sms_reminder_failed_at";
```
(c) `setBookingStatus` — replace the whole function with:
```ts
export async function setBookingStatus(
  db: SupabaseClient, accountId: string, bookingId: string, status: BookingStatus, actorId: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  // THE AUTOMATION CLOCKS (0026; spec, "Decisions taken after Milestone A
  // shipped"). The review request runs from the LATER of ends_at and this
  // stamp, so a week of jobs marked completed on Friday earns its review
  // requests on Saturday morning instead of aging out unsent; the no-show
  // nudge runs from no_show_at the same way. Stamped on the flip TO the
  // state, never cleared on a flip away — the status filter already stops a
  // re-opened row from matching — and a re-flip re-stamps.
  const stamp = status === "completed" ? { completed_at: nowIso }
    : status === "no_show" ? { no_show_at: nowIso }
    : {};
  const { data, error } = await db.from("bookings")
    .update({ status, updated_at: nowIso, ...stamp })
    .eq("account_id", accountId).eq("id", bookingId)
    .select("id");
  if (error) throw new Error(`setBookingStatus failed: ${error.message}`);
  if (!data?.length) throw new Error(`setBookingStatus: no booking ${bookingId} for account ${accountId}`);
  await emit(db, accountId, "booking.status_changed", actorId, { bookingId, status });
}
```

- [ ] **Step 7: Typecheck the db package (the new columns are additive; nothing else should move)**

```bash
cd /c/Users/danlo/bis-platform/packages/db && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t1-tc.txt 2>&1; echo "exit=$?"; tail -3 /c/Users/danlo/AppData/Local/Temp/claude/t1-tc.txt
```
Expected: `exit=0`.

- [ ] **Step 8: Pre-flight read, then apply 0026 — orchestrating session only, via the Supabase MCP**

Pre-flight (`execute_sql` on project `tlbkbmlrfafquucsmsmm`):
```sql
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name in ('completed_at','no_show_at','no_show_nudged_at','sms_reminder_sent_at',
                          'review_request_sms_failed_at','no_show_nudge_sms_failed_at','sms_reminder_failed_at')) as b_cols,
  (select string_agg(conname || ' = ' || pg_get_constraintdef(oid), ' | ')
    from pg_constraint where conrelid = 'public.automations'::regclass and contype = 'c') as checks,
  (select version from supabase_migrations.schema_migrations order by version desc limit 1) as latest;
```
Expected: `b_cols` **0** · `checks` exactly one entry whose name is **`automations_recipe_key_check`** and whose definition lists only `'review_request'` · `latest` is the **0025** entry. **If any differs — a different constraint name, any column present, a later migration — STOP and report; do not apply.**

Apply: `apply_migration` with `name: "0026_automations_b"` and the exact SQL of the file from Step 2.

Post-verify (`execute_sql`):
```sql
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'bookings'
      and column_name in ('completed_at','no_show_at','no_show_nudged_at','sms_reminder_sent_at',
                          'review_request_sms_failed_at','no_show_nudge_sms_failed_at','sms_reminder_failed_at')) as b_cols,
  (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.automations'::regclass and conname = 'automations_recipe_key_check') as check_def,
  (select count(*) from pg_indexes where tablename = 'bookings'
    and indexname in ('bookings_review_due_completed','bookings_no_show_due','bookings_no_show_due_marked','bookings_sms_reminder_due')) as idx,
  (select count(*) from information_schema.column_privileges
    where grantee = 'authenticated' and table_schema = 'public' and table_name = 'bookings' and privilege_type = 'UPDATE') as client_update_cols;
```
Expected: `b_cols` 7 · `check_def` names all three keys · `idx` 4 · `client_update_cols` 0. Record in the ledger: **MIGRATION 0026 APPLIED — NEVER RE-APPLY.**

- [ ] **Step 9: Run the proofs and see them pass, then the whole db suite ALONE**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations-grants.test.ts src/test/booking.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/t1a.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/t1a.txt
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run > /c/Users/danlo/AppData/Local/Temp/claude/t1b.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/t1b.txt
```
Expected: both `exit=0`; grants 9 passed (6 + 3), booking 19 passed (18 + 1); db suite = 199 + 4 = **203**.

- [ ] **Step 10: Commit (the plan document rides along)**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-b" ] && git add packages/db/supabase/migrations/0026_automations_b.sql packages/db/src/booking.ts packages/db/src/test/automations-grants.test.ts packages/db/src/test/booking.test.ts docs/superpowers/plans/2026-09-06-automations-milestone-b.md && git commit -q -m "feat(db): 0026 — completion/no-show clocks, B dedupe stamps, SMS attempt markers, catalogue +2; setBookingStatus stamps the clocks

Watched failing first: columns [] and 23514 at the db level, PGRST204 through PostgREST." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 2: The data layer — anchor windows, the no-show and SMS-reminder due-lists, stamps, constants

**Files:**
- Modify: `packages/db/src/automations.ts` (full replacement below)
- Modify: `packages/db/src/index.ts` (the automations export block)
- Modify: `packages/db/src/test/automations.test.ts` (append; extend the import)

**Interfaces:**
- Consumes: `brandDisplayName`, `Branding`, `emit`, `loadAccountBrandInfo` (unchanged).
- Produces (all exported from `@bis/db`):
  - `type RecipeKey = "review_request" | "no_show_nudge" | "sms_reminder"`
  - `DueReviewRequest` gains `completedAt: string | null` and `smsFailedAt: string | null`; `listDueReviewRequests` matches on EITHER anchor; `stampReviewRequestSmsFailed(db, bookingId)`
  - `type NoShowNudgeChannel = "email" | "sms"`; `type NoShowNudgeConfig = { channel: NoShowNudgeChannel }`; `parseNoShowNudgeConfig(raw: unknown): NoShowNudgeConfig | null`; `NO_SHOW_NUDGE_MAX_AGE_MS = 37h`
  - `type DueNoShowNudge = { bookingId; accountId; endsAt; noShowAt: string | null; smsFailedAt: string | null; contactId; contactEmail: string | null; contactPhone: string | null; calendarPublicId: string; calendarEnabled: boolean; brandName: string; branding: Branding; accountTimezone: string; fromEmail: string | null; replyToEmail: string | null; body: string; config: NoShowNudgeConfig | null }`
  - `listDueNoShowNudges(db, nowIso)`, `stampNoShowNudged(db, bookingId)`, `stampNoShowNudgeSmsFailed(db, bookingId)`, `countNoShowNudgesSince(db, accountId, sinceIso)`
  - `SMS_REMINDER_WINDOW_START_MS = 90min`, `SMS_REMINDER_WINDOW_END_MS = 135min`
  - `type DueSmsReminder = { bookingId; accountId; startsAt: string; bookerTimezone: string | null; smsFailedAt: string | null; contactId; contactPhone: string | null; brandName: string; accountTimezone: string; body: string }`
  - `listDueSmsReminders(db, nowIso)`, `stampSmsReminderSent(db, bookingId)`, `stampSmsReminderFailed(db, bookingId)`

- [ ] **Step 1: Write the failing tests**

Extend the import in `packages/db/src/test/automations.test.ts` to:

```ts
import {
  parseReviewRequestConfig, getAutomation, upsertAutomation,
  listDueReviewRequests, stampReviewRequested, stampReviewRequestSmsFailed, countReviewRequestsSince,
  REVIEW_REQUEST_MAX_AGE_MS,
  parseNoShowNudgeConfig, listDueNoShowNudges, stampNoShowNudged, stampNoShowNudgeSmsFailed,
  countNoShowNudgesSince, NO_SHOW_NUDGE_MAX_AGE_MS,
  listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed,
  SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,
} from "../automations";
```
and add `updateCalendarSettings` to the `../booking` import. Then append at the end of the file:

```ts
const MINUTE = 60 * 1000;

/**
 * Anchor tests use a FAKE `now` in 2027 (like the tests above) and write the
 * clock columns directly: setBookingStatus stamps REAL time, which sits six
 * months outside a 2027 window and would prove nothing here. The stamping
 * itself is proven in booking.test.ts. Bookings are spaced ≥1h apart because
 * `bookings_no_overlap` binds while status is 'booked'.
 */
describe("listDueReviewRequests — the completion anchor (0026)", () => {
  it("matches on EITHER ends_at or completed_at inside 61h, and projects both anchors plus the sms attempt marker", async () => {
    await withTestAccount(async (db, accountId) => {
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Anchor", phone: "9565550101" }, "user_test");
      const now = new Date("2027-03-10T12:00:00Z");
      const mk = (endsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(endsAt.getTime() - 30 * MINUTE), endsAt }, "user_test");
      const clock = (id: string, patch: Record<string, string | null>) =>
        db.from("bookings").update({ status: "completed", ...patch }).eq("id", id).then(({ error }) => {
          if (error) throw new Error(error.message);
        });

      // The batch-Friday case: ended 9 days ago, marked completed an hour ago.
      const batchMarked = await mk(new Date(now.getTime() - 9 * 24 * HOUR));
      await clock(batchMarked.id, { completed_at: new Date(now.getTime() - HOUR).toISOString() });
      // Ended 2h ago, completed 1h ago — inside by both anchors.
      const fresh = await mk(new Date(now.getTime() - 2 * HOUR));
      await clock(fresh.id, { completed_at: new Date(now.getTime() - HOUR).toISOString(),
                              review_request_sms_failed_at: now.toISOString() });
      // A pre-0026 row: completed, completed_at NULL — due by ends_at alone.
      const legacy = await mk(new Date(now.getTime() - 4 * HOUR));
      await clock(legacy.id, { completed_at: null });
      // Ended AND completed 9 days ago: outside by both anchors.
      const stale = await mk(new Date(now.getTime() - 9 * 24 * HOUR - 2 * HOUR));
      await clock(stale.id, { completed_at: new Date(now.getTime() - 9 * 24 * HOUR).toISOString() });

      const list = await listDueReviewRequests(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(batchMarked.id);   // Mutation: drop completed_at from the .or() window
      expect(ids).toContain(fresh.id);
      expect(ids).toContain(legacy.id);        // Mutation: drop ends_at from the .or() window
      expect(ids).not.toContain(stale.id);

      const marked = list.find((r) => r.bookingId === batchMarked.id)!;
      expect(new Date(marked.completedAt!).getTime()).toBe(now.getTime() - HOUR);
      expect(marked.smsFailedAt).toBeNull();
      expect(list.find((r) => r.bookingId === legacy.id)!.completedAt).toBeNull();
      expect(new Date(list.find((r) => r.bookingId === fresh.id)!.smsFailedAt!).getTime()).toBe(now.getTime());  // Mutation: drop the projection
    });
  });

  it("stampReviewRequestSmsFailed writes the attempt marker and never the dedupe stamp", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Fail" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-10T09:00:00Z"), endsAt: new Date("2027-03-10T09:30:00Z") }, "user_test");
      const before = Date.now() - 1000;
      await stampReviewRequestSmsFailed(db, b.id);
      const { data } = await db.from("bookings")
        .select("review_requested_at, review_request_sms_failed_at").eq("id", b.id).single();
      const row = data as { review_requested_at: string | null; review_request_sms_failed_at: string | null };
      expect(row.review_requested_at).toBeNull();
      expect(new Date(row.review_request_sms_failed_at!).getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});

describe("no-show nudge — data layer", () => {
  it("parseNoShowNudgeConfig accepts exactly a channel; everything else is null", () => {
    expect(parseNoShowNudgeConfig({ channel: "sms" })).toEqual({ channel: "sms" });
    expect(parseNoShowNudgeConfig({ channel: "email", extra: 1 })).toEqual({ channel: "email" });
    for (const bad of [null, undefined, "sms", 42, [], {}, { channel: "fax" }, { channel: 1 }]) {
      expect(parseNoShowNudgeConfig(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("is exactly the follow-up window: same derivation, nothing to defer to", () => {
    expect(NO_SHOW_NUDGE_MAX_AGE_MS).toBe(37 * HOUR);
  });

  it("listDueNoShowNudges: enabled account, no_show inside 37h by EITHER anchor → due, with brandName never accounts.name", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Miss", email: "miss@example.com", phone: "(956) 555-0102" }, "user_test");
      const now = new Date("2027-03-10T12:00:00Z");
      const mk = (endsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(endsAt.getTime() - 30 * MINUTE), endsAt }, "user_test");
      const clock = (id: string, patch: Record<string, string | null>) =>
        db.from("bookings").update({ status: "no_show", ...patch }).eq("id", id).then(({ error }) => {
          if (error) throw new Error(error.message);
        });

      const due = await mk(new Date(now.getTime() - 2 * HOUR));
      await clock(due.id, { no_show_at: new Date(now.getTime() - 90 * MINUTE).toISOString() });
      // OFF: nothing is due while the recipe is disabled (a missing row is off).
      expect((await listDueNoShowNudges(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(due.id);

      await upsertAutomation(db, accountId, "no_show_nudge",
        { enabled: true, body: "Come back!", config: { channel: "sms" } }, "user_test");
      const batchMarked = await mk(new Date(now.getTime() - 5 * 24 * HOUR));          // ended 5 days ago, marked 1h ago
      await clock(batchMarked.id, { no_show_at: new Date(now.getTime() - HOUR).toISOString() });
      const stillBooked = await mk(new Date(now.getTime() - 3 * HOUR));
      const completed = await mk(new Date(now.getTime() - 4 * HOUR));
      await setBookingStatus(db, accountId, completed.id, "completed", "user_test");
      const nudged = await mk(new Date(now.getTime() - 6 * HOUR));
      await clock(nudged.id, { no_show_at: new Date(now.getTime() - 5 * HOUR).toISOString() });
      await stampNoShowNudged(db, nudged.id);
      const stale = await mk(new Date(now.getTime() - 40 * HOUR));                      // ended AND marked 40h ago
      await clock(stale.id, { no_show_at: new Date(now.getTime() - 40 * HOUR).toISOString() });
      const legacy = await mk(new Date(now.getTime() - 8 * HOUR));                      // pre-0026: no_show_at null
      await clock(legacy.id, { no_show_at: null });

      const list = await listDueNoShowNudges(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(due.id);
      expect(ids).toContain(batchMarked.id);   // Mutation: drop no_show_at from the window
      expect(ids).toContain(legacy.id);        // Mutation: drop ends_at from the window
      expect(ids).not.toContain(stillBooked.id);
      expect(ids).not.toContain(completed.id);
      expect(ids).not.toContain(nudged.id);
      expect(ids).not.toContain(stale.id);

      const row = list.find((r) => r.bookingId === due.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(new Date(row.noShowAt!).getTime()).toBe(now.getTime() - 90 * MINUTE);
      expect(row.smsFailedAt).toBeNull();
      expect(row.calendarPublicId).toBe(cal.public_id);
      expect(row.calendarEnabled).toBe(false);            // the lazily created calendar starts disabled
      expect(row.contactId).toBe(contactId);
      expect(row.contactEmail).toBe("miss@example.com");
      expect(row.contactPhone).toBe("(956) 555-0102");    // raw; the pass normalises
      expect(typeof row.accountTimezone).toBe("string");
      expect(row.fromEmail).toBeNull();
      expect(row.replyToEmail).toBeNull();
      expect(row.body).toBe("Come back!");
      expect(row.config).toEqual({ channel: "sms" });
      expect(list.find((r) => r.bookingId === legacy.id)!.noShowAt).toBeNull();

      // The public page's switch is projected live, not cached.
      await updateCalendarSettings(db, accountId, { enabled: true }, "user_test");
      expect((await listDueNoShowNudges(db, now.toISOString())).find((r) => r.bookingId === due.id)!.calendarEnabled).toBe(true);
    });
  });

  it("an invalid stored config yields the row with config null", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Cfg" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-10T09:30:00Z"), endsAt: new Date("2027-03-10T10:00:00Z") }, "user_test");
      await setBookingStatus(db, accountId, b.id, "no_show", "user_test");
      await upsertAutomation(db, accountId, "no_show_nudge", { enabled: true, body: "", config: { channel: "fax" } }, "user_test");
      const row = (await listDueNoShowNudges(db, "2027-03-10T12:00:00Z")).find((r) => r.bookingId === b.id)!;
      expect(row.config).toBeNull();
      expect(row.contactEmail).toBeNull();
      expect(row.contactPhone).toBeNull();
    });
  });

  it("stampNoShowNudged / stampNoShowNudgeSmsFailed write their own columns; countNoShowNudgesSince counts only the dedupe stamp", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Stamp" }, "user_test");
      const mk = (h: number) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(`2027-03-10T${String(h).padStart(2, "0")}:00:00Z`),
          endsAt: new Date(`2027-03-10T${String(h).padStart(2, "0")}:30:00Z`) }, "user_test");
      const a = await mk(8); const b = await mk(9); const c = await mk(10);
      const before = new Date();
      await stampNoShowNudged(db, a.id);
      await stampNoShowNudged(db, a.id);                // idempotent
      await stampNoShowNudged(db, b.id);
      await stampNoShowNudgeSmsFailed(db, c.id);        // an ATTEMPT, not a send: must not count
      const { data } = await db.from("bookings")
        .select("no_show_nudged_at, no_show_nudge_sms_failed_at").eq("id", c.id).single();
      expect((data as { no_show_nudged_at: string | null }).no_show_nudged_at).toBeNull();
      expect((data as { no_show_nudge_sms_failed_at: string | null }).no_show_nudge_sms_failed_at).not.toBeNull();
      expect(await countNoShowNudgesSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(2);
      expect(await countNoShowNudgesSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
    });
  });
});

describe("sms reminder — data layer", () => {
  it("the window is 90 to 135 minutes ahead, 45 minutes wide", () => {
    expect(SMS_REMINDER_WINDOW_START_MS).toBe(90 * MINUTE);
    expect(SMS_REMINDER_WINDOW_END_MS).toBe(135 * MINUTE);
  });

  it("listDueSmsReminders: enabled account, booked, starting 1h30m–2h15m from now, unstamped → due; edges inclusive", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Soon", phone: "(956) 555-0103" }, "user_test");
      const now = new Date("2027-03-10T12:00:00Z");
      const mk = (startsAt: Date, bookerTimezone?: string) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + 20 * MINUTE), bookerTimezone }, "user_test");

      const inside = await mk(new Date(now.getTime() + 2 * HOUR), "America/Los_Angeles");
      // OFF: nothing is due while the recipe is disabled.
      expect((await listDueSmsReminders(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(inside.id);

      await upsertAutomation(db, accountId, "sms_reminder", { enabled: true, body: "See you soon!", config: {} }, "user_test");
      const lowerEdge = await mk(new Date(now.getTime() + SMS_REMINDER_WINDOW_START_MS));
      const upperEdge = await mk(new Date(now.getTime() + SMS_REMINDER_WINDOW_END_MS));
      const tooSoon = await mk(new Date(now.getTime() + SMS_REMINDER_WINDOW_START_MS - MINUTE));   // 1h29m: was never inside
      const tooFar = await mk(new Date(now.getTime() + SMS_REMINDER_WINDOW_END_MS + MINUTE));      // 2h16m: next tick's business
      const stamped = await mk(new Date(now.getTime() + 2 * HOUR + 5 * MINUTE));
      await stampSmsReminderSent(db, stamped.id);
      const cancelled = await mk(new Date(now.getTime() + 2 * HOUR + 10 * MINUTE));
      await cancelBookingByToken(db, cancelled.cancelToken);
      await db.from("bookings").update({ sms_reminder_failed_at: now.toISOString() }).eq("id", lowerEdge.id);

      const list = await listDueSmsReminders(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(inside.id);
      expect(ids).toContain(lowerEdge.id);
      expect(ids).toContain(upperEdge.id);
      expect(ids).not.toContain(tooSoon.id);     // Mutation: widen the start to 60 minutes
      expect(ids).not.toContain(tooFar.id);      // Mutation: widen the end to 3h
      expect(ids).not.toContain(stamped.id);
      expect(ids).not.toContain(cancelled.id);

      const row = list.find((r) => r.bookingId === inside.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row).not.toHaveProperty("contactEmail");           // SMS only: the row cannot carry an address it must not use
      expect(new Date(row.startsAt).getTime()).toBe(now.getTime() + 2 * HOUR);
      expect(row.bookerTimezone).toBe("America/Los_Angeles");
      expect(row.contactId).toBe(contactId);
      expect(row.contactPhone).toBe("(956) 555-0103");
      expect(typeof row.accountTimezone).toBe("string");
      expect(row.body).toBe("See you soon!");
      expect(row.smsFailedAt).toBeNull();
      expect(new Date(list.find((r) => r.bookingId === lowerEdge.id)!.smsFailedAt!).getTime()).toBe(now.getTime());  // Mutation: drop the projection
    });
  });

  it("stampSmsReminderSent / stampSmsReminderFailed write their own columns, idempotently", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Stamp" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-10T15:00:00Z"), endsAt: new Date("2027-03-10T15:30:00Z") }, "user_test");
      await stampSmsReminderFailed(db, b.id);
      await stampSmsReminderSent(db, b.id);
      await stampSmsReminderSent(db, b.id);
      const { data } = await db.from("bookings")
        .select("sms_reminder_sent_at, sms_reminder_failed_at, reminder_sent_at").eq("id", b.id).single();
      const row = data as { sms_reminder_sent_at: string | null; sms_reminder_failed_at: string | null; reminder_sent_at: string | null };
      expect(row.sms_reminder_sent_at).not.toBeNull();
      expect(row.sms_reminder_failed_at).not.toBeNull();
      expect(row.reminder_sent_at).toBeNull();          // the EMAIL reminder's stamp is a different column
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations.test.ts 2>&1 | grep -E "does not provide an export|is not a function|passed|failed" | head -4
```
Expected: FAIL — `../automations` does not export `parseNoShowNudgeConfig` (and the rest).

- [ ] **Step 3: Replace `automations.ts`**

`packages/db/src/automations.ts` — the whole file:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";
import { brandDisplayName, type Branding } from "./branding";
import { loadAccountBrandInfo } from "./booking";

/**
 * The automations spine. Config is GENERIC — one row per (account, recipe)
 * holding a toggle, a prose body and a jsonb config — and due-ness is
 * DOMAIN-SPECIFIC: each recipe's due-list reads its own domain rows and its
 * own stamp column, so a booking that is cancelled or un-completed just stops
 * matching. There is no void step and nothing to forget.
 *
 * The catalogue is fixed (the CHECK in 0025 + 0026 mirrors `RecipeKey`).
 */
export type RecipeKey = "review_request" | "no_show_nudge" | "sms_reminder";

export type AutomationRow = {
  id: string; account_id: string; recipe_key: RecipeKey;
  enabled: boolean; body: string;
  /** Raw jsonb. NEVER trusted: parse it with the recipe's own parser on every
   *  read, and validate it on every write. */
  config: unknown;
  created_at: string; updated_at: string;
};

const AUTOMATION_COLS = "id, account_id, recipe_key, enabled, body, config, created_at, updated_at";

export async function getAutomation(
  db: SupabaseClient, accountId: string, recipeKey: RecipeKey,
): Promise<AutomationRow | null> {
  const { data, error } = await db.from("automations")
    .select(AUTOMATION_COLS).eq("account_id", accountId).eq("recipe_key", recipeKey).maybeSingle();
  if (error) throw new Error(`getAutomation failed: ${error.message}`);
  return (data as AutomationRow | null) ?? null;
}

/**
 * serviceDb()-only by grant (0025: `authenticated` holds SELECT and nothing
 * else). Every caller is an agency-gated server action; nothing in the
 * database stands behind that except this grant, so callers MUST check
 * `isAgency` themselves. One row per (account, recipe): the unique constraint
 * is what `onConflict` targets.
 */
export async function upsertAutomation(
  db: SupabaseClient, accountId: string, recipeKey: RecipeKey,
  patch: { enabled: boolean; body: string; config: Record<string, unknown> },
  actorId: string, actorType: ActorType = "user",
): Promise<AutomationRow> {
  const { data, error } = await db.from("automations")
    .upsert({
      account_id: accountId, recipe_key: recipeKey,
      enabled: patch.enabled, body: patch.body, config: patch.config,
      updated_at: new Date().toISOString(),
    }, { onConflict: "account_id,recipe_key" })
    .select(AUTOMATION_COLS).single();
  if (error || !data) throw new Error(`upsertAutomation failed: ${error?.message}`);
  await emit(db, accountId, "automation.updated", actorId,
    { recipeKey, enabled: patch.enabled }, actorType);
  return data as unknown as AutomationRow;
}

// ---------------------------------------------------------------------------
// Shared by every due-list
// ---------------------------------------------------------------------------

type EnabledRecipe = { body: string; config: unknown };

/**
 * Every account with `recipeKey` switched on, keyed by account id — the first
 * of the two reads each due-list makes. `automations` first, then the domain
 * table: an idle tick on a platform where no account has the recipe on costs
 * ONE narrow indexed read and zero booking reads. There is no FK from
 * bookings to automations, so PostgREST cannot embed the join; two queries
 * is the honest shape.
 */
async function listEnabled(
  db: SupabaseClient, recipeKey: RecipeKey, caller: string,
): Promise<Map<string, EnabledRecipe>> {
  const { data, error } = await db.from("automations")
    .select("account_id, body, config")
    .eq("recipe_key", recipeKey).eq("enabled", true);
  if (error) throw new Error(`${caller} automations read failed: ${error.message}`);
  const rows = (data ?? []) as { account_id: string; body: string; config: unknown }[];
  return new Map(rows.map((a) => [a.account_id, { body: a.body ?? "", config: a.config }] as const));
}

/**
 * "EITHER anchor is inside the window": ends_at OR the status clock (0026)
 * is at or after `sinceIso`. A pre-0026 row has a null clock and matches by
 * ends_at alone; a job marked days after it ended matches by the clock.
 *
 * PostgREST's `or` filter takes its values inline, and an ISO instant carries
 * two of its reserved characters (`.` and `:`), so each value is double-quoted
 * — the documented escape. `toISOString()` never emits `"`, `,` or `(`, the
 * characters that would break the quoting; contacts.ts's search path is the
 * precedent for treating an interpolated `.or()` with suspicion. Proven
 * against the real database in automations.test.ts.
 */
function eitherAnchorSince(clockColumn: string, sinceIso: string): string {
  return `ends_at.gte."${sinceIso}",${clockColumn}.gte."${sinceIso}"`;
}

// ---------------------------------------------------------------------------
// Recipe: review request after a completed job
// ---------------------------------------------------------------------------

export type ReviewRequestChannel = "email" | "sms";
export type ReviewRequestConfig = { channel: ReviewRequestChannel; reviewUrl: string };

const MAX_REVIEW_URL_LENGTH = 2048;

/**
 * jsonb is untyped, so the stored config is validated on READ (here, by the
 * due-list) and on WRITE (the settings action), never trusted. `null` means
 * "treat as missing" — the pass counts it and sends nothing. Only http(s):
 * a `javascript:` URL in an email button is the obvious reason; a URL of any
 * other scheme is not something a review page lives at.
 */
export function parseReviewRequestConfig(raw: unknown): ReviewRequestConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { channel, reviewUrl } = raw as Record<string, unknown>;
  if (channel !== "email" && channel !== "sms") return null;
  if (typeof reviewUrl !== "string") return null;
  const url = reviewUrl.trim();
  if (url.length === 0 || url.length > MAX_REVIEW_URL_LENGTH) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  // The NORMALISED form, not the raw string: `new URL("https://x/a b")`
  // parses, but the literal space would break the link inside an SMS.
  // `href` percent-encodes it (and adds the trailing slash a bare origin
  // needs). The settings action stores THIS value too, so what is stored,
  // previewed and sent is one clickable string.
  return { channel, reviewUrl: parsed.href };
}

/**
 * The oldest a completed meeting may be and still earn a review request, and
 * the figure the due-query window is sized to. DERIVED, not picked:
 *
 *   37h  the follow-up's own worst case (FOLLOWUP_MAX_AGE_MS in
 *        apps/web/src/lib/booking/followup-timing.ts): a meeting ending at
 *        00:00 local on a 26-hour day (Antarctica/Troll's fall-back) waits
 *        until 11:00 local on D+1, the close of the follow-up's morning band.
 *  +24h  the review request defers to the follow-up: it sends only on a
 *        strictly LATER local day than `followup_sent_at`, so when the
 *        follow-up went out at the very close of D+1's band, the review
 *        request's last qualifying tick is 11:00 on D+2.
 *  = 61h
 *
 * Since 0026 the clock runs from the LATER of ends_at and completed_at
 * (laterOf, apps/web/src/lib/automations/anchor.ts); the derivation is
 * unchanged, only the instant it starts from moved.
 *
 * Pinned against real zones in review-request-gate.test.ts. The web gate
 * imports THIS constant rather than restating it.
 */
export const REVIEW_REQUEST_MAX_AGE_MS = 61 * 60 * 60 * 1000;

/**
 * What the review-request pass is handed per due booking.
 *
 * `brandName` and NEVER `accountName`: `accounts.name` is the agency's
 * internal label ("Rio Roofing — trial") and has reached customers three
 * times. It is resolved here, in the data layer, by `brandDisplayName`, and
 * the row simply has no field for the raw label. A recipe author cannot
 * reach it.
 *
 * `contactPhone` is RAW (`contacts.phone` is only trimmed on write) — the
 * pass runs it through `toE164` and treats a null result as "no deliverable
 * address", exactly as `sendSmsAction` does.
 */
export type DueReviewRequest = {
  bookingId: string; accountId: string;
  /** `ends_at`. The pass runs the clock from laterOf(endsAt, completedAt). */
  endsAt: string;
  /** THE COMPLETION CLOCK (0026): when the operator pressed "Mark completed".
   *  Null on rows completed before the migration — then the clock is ends_at
   *  alone, exactly as before. */
  completedAt: string | null;
  /** THE COLLISION INPUT. The calendar's follow-up email already fires the
   *  morning after a completed meeting; the gate defers the review request
   *  to a strictly later local day than this stamp. Null when no follow-up
   *  was sent (feature off, no email, send failed) — then nothing to defer to. */
  followupSentAt: string | null;
  /** The last FAILED SMS attempt for this booking's review request (0026).
   *  The pass holds the row for 24h after it and counts the hold. Null =
   *  never failed. An attempt marker, never a receipt. */
  smsFailedAt: string | null;
  contactId: string; contactEmail: string | null; contactPhone: string | null;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  /** The operator's prose, "" meaning "use the default at send time". */
  body: string;
  /** Parsed and validated; null when the stored jsonb fails validation. */
  config: ReviewRequestConfig | null;
};

/**
 * Candidates, not decisions: everything returned here still goes through
 * `shouldSendReviewRequestNow` in the pass, which decides the MOMENT. The
 * query only says "enabled, completed, unstamped, inside 61h by either
 * anchor".
 */
export async function listDueReviewRequests(
  db: SupabaseClient, nowIso: string,
): Promise<DueReviewRequest[]> {
  const enabled = await listEnabled(db, "review_request", "listDueReviewRequests");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - REVIEW_REQUEST_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, ends_at, completed_at, followup_sent_at, review_request_sms_failed_at, contacts(email, phone)")
    .in("account_id", [...enabled.keys()])
    .eq("status", "completed").is("review_requested_at", null)
    .or(eitherAnchorSince("completed_at", windowStart))
    .lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueReviewRequests failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueReviewRequests");

  return rows.map((r) => {
    const info = accountInfo.get(r.account_id as string)!;
    const auto = enabled.get(r.account_id as string)!;
    return {
      bookingId: r.id,
      accountId: r.account_id,
      endsAt: r.ends_at,
      completedAt: r.completed_at ?? null,
      followupSentAt: r.followup_sent_at ?? null,
      smsFailedAt: r.review_request_sms_failed_at ?? null,
      contactId: r.contact_id,
      contactEmail: r.contacts?.email ?? null,
      contactPhone: r.contacts?.phone ?? null,
      brandName: brandDisplayName(info.branding, info.accountName),
      branding: info.branding,
      accountTimezone: info.accountTimezone,
      fromEmail: info.fromEmail,
      replyToEmail: info.replyToEmail,
      body: auto.body,
      config: parseReviewRequestConfig(auto.config),
    };
  });
}

/** Send-then-stamp, same reasoning as stampReminderSent: only after a confirmed send. */
export async function stampReviewRequested(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ review_requested_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReviewRequested failed: ${error.message}`);
}

/** The ATTEMPT marker, never the dedupe stamp: written by the pass when the
 *  provider refuses a text, read back by the same pass to hold the booking
 *  for 24h (SMS_RETRY_COOLDOWN_MS). */
export async function stampReviewRequestSmsFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ review_request_sms_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampReviewRequestSmsFailed failed: ${error.message}`);
}

/**
 * The daily cap's input: how many review requests this account has sent
 * since `sinceIso`, read off the stamp column itself. Counting stamps (not a
 * separate ledger) is what lets the cap need no new table and no timezone —
 * "a day" is a rolling 24 hours from the tick.
 */
export async function countReviewRequestsSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("review_requested_at", sinceIso);
  if (error) throw new Error(`countReviewRequestsSince failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Recipe: no-show → rebooking nudge
// ---------------------------------------------------------------------------

export type NoShowNudgeChannel = "email" | "sms";
export type NoShowNudgeConfig = { channel: NoShowNudgeChannel };

/** Same contract as parseReviewRequestConfig: validated on read AND write,
 *  null means "treat as missing". The nudge's link is the account's own
 *  booking page (due-row `calendarPublicId`), so there is no URL to validate. */
export function parseNoShowNudgeConfig(raw: unknown): NoShowNudgeConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { channel } = raw as Record<string, unknown>;
  if (channel !== "email" && channel !== "sms") return null;
  return { channel };
}

/**
 * 37 hours — the follow-up's own derivation, because the nudge has nothing
 * to defer to: a booking whose clock (laterOf(ends_at, no_show_at)) reads
 * 00:00 local on a 26-hour day waits until 11:00 on D+1, the close of the
 * morning band: 26 + 11 = 37. Pinned on Antarctica/Troll in
 * no-show-nudge-gate.test.ts and equal to FOLLOWUP_QUERY_WINDOW_MS in
 * cron-coupling.test.ts. The web gate imports THIS constant.
 */
export const NO_SHOW_NUDGE_MAX_AGE_MS = 37 * 60 * 60 * 1000;

export type DueNoShowNudge = {
  bookingId: string; accountId: string;
  endsAt: string;
  /** THE NO-SHOW CLOCK (0026): when the operator pressed "Mark no-show".
   *  Null on rows flipped before the migration. */
  noShowAt: string | null;
  /** The last FAILED SMS attempt for this booking's nudge (0026). */
  smsFailedAt: string | null;
  contactId: string; contactEmail: string | null; contactPhone: string | null;
  /** The rebook link's target: `${origin}/b/${calendarPublicId}`. */
  calendarPublicId: string;
  /** The public page 404s while this is false (b/[publicId]/page.tsx); the
   *  pass skips and counts rather than send a dead link. */
  calendarEnabled: boolean;
  brandName: string; branding: Branding; accountTimezone: string;
  fromEmail: string | null; replyToEmail: string | null;
  body: string;
  config: NoShowNudgeConfig | null;
};

/** Candidates, not decisions — `shouldSendNoShowNudgeNow` in the pass picks
 *  the moment. "Enabled, no_show, unstamped, inside 37h by either anchor". */
export async function listDueNoShowNudges(
  db: SupabaseClient, nowIso: string,
): Promise<DueNoShowNudge[]> {
  const enabled = await listEnabled(db, "no_show_nudge", "listDueNoShowNudges");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now - NO_SHOW_NUDGE_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now).toISOString();

  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, ends_at, no_show_at, no_show_nudge_sms_failed_at, calendars(public_id, enabled), contacts(email, phone)")
    .in("account_id", [...enabled.keys()])
    .eq("status", "no_show").is("no_show_nudged_at", null)
    .or(eitherAnchorSince("no_show_at", windowStart))
    .lte("ends_at", windowEnd)
    .order("ends_at", { ascending: true });
  if (error) throw new Error(`listDueNoShowNudges failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueNoShowNudges");

  return rows.map((r) => {
    const info = accountInfo.get(r.account_id as string)!;
    const auto = enabled.get(r.account_id as string)!;
    return {
      bookingId: r.id,
      accountId: r.account_id,
      endsAt: r.ends_at,
      noShowAt: r.no_show_at ?? null,
      smsFailedAt: r.no_show_nudge_sms_failed_at ?? null,
      contactId: r.contact_id,
      contactEmail: r.contacts?.email ?? null,
      contactPhone: r.contacts?.phone ?? null,
      calendarPublicId: r.calendars?.public_id,
      calendarEnabled: r.calendars?.enabled === true,
      brandName: brandDisplayName(info.branding, info.accountName),
      branding: info.branding,
      accountTimezone: info.accountTimezone,
      fromEmail: info.fromEmail,
      replyToEmail: info.replyToEmail,
      body: auto.body,
      config: parseNoShowNudgeConfig(auto.config),
    };
  });
}

export async function stampNoShowNudged(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ no_show_nudged_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampNoShowNudged failed: ${error.message}`);
}

export async function stampNoShowNudgeSmsFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ no_show_nudge_sms_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampNoShowNudgeSmsFailed failed: ${error.message}`);
}

/** The daily cap's input for the nudge — the dedupe stamp, never the attempt marker. */
export async function countNoShowNudgesSince(
  db: SupabaseClient, accountId: string, sinceIso: string,
): Promise<number> {
  const { count, error } = await db.from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .gte("no_show_nudged_at", sinceIso);
  if (error) throw new Error(`countNoShowNudgesSince failed: ${error.message}`);
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Recipe: ~2h SMS booking reminder
// ---------------------------------------------------------------------------

/**
 * ~2 hours before `starts_at`, by text. The window's CLOSE (2h15m) decides
 * when a booking first qualifies — the first tick at which starts_at is at
 * most 2h15m away, so the text lands 2h–2h15m ahead; the OPEN (1h30m) is how
 * long a missed tick can catch up before a "reminder" would be silly. 45
 * minutes = three ticks, wider than one (cron-coupling.test.ts pins it
 * against vercel.json). A booking made less than 90 minutes ahead gets no
 * text: it was never inside. Sibling of REMINDER_WINDOW_* in booking.ts.
 */
export const SMS_REMINDER_WINDOW_START_MS = 90 * 60 * 1000;
export const SMS_REMINDER_WINDOW_END_MS = 135 * 60 * 1000;

/** SMS only, so the row carries no email address at all — the type is how a
 *  recipe author is kept from sending this by mail. */
export type DueSmsReminder = {
  bookingId: string; accountId: string;
  startsAt: string;
  /** The booker's own zone, captured at booking, for the time in the text —
   *  `safeZone(bookerTimezone, accountTimezone)` as the email reminder does. */
  bookerTimezone: string | null;
  /** The last FAILED attempt for this booking's text reminder (0026). */
  smsFailedAt: string | null;
  contactId: string; contactPhone: string | null;
  brandName: string; accountTimezone: string;
  body: string;
};

/** No gate follows this list: a text reminder is tied to the appointment,
 *  not to a morning, so the window IS the moment. */
export async function listDueSmsReminders(
  db: SupabaseClient, nowIso: string,
): Promise<DueSmsReminder[]> {
  const enabled = await listEnabled(db, "sms_reminder", "listDueSmsReminders");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso).getTime();
  const windowStart = new Date(now + SMS_REMINDER_WINDOW_START_MS).toISOString();
  const windowEnd = new Date(now + SMS_REMINDER_WINDOW_END_MS).toISOString();

  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, starts_at, booker_timezone, sms_reminder_failed_at, contacts(phone)")
    .in("account_id", [...enabled.keys()])
    .eq("status", "booked").is("sms_reminder_sent_at", null)
    .gte("starts_at", windowStart).lte("starts_at", windowEnd)
    .order("starts_at", { ascending: true });
  if (error) throw new Error(`listDueSmsReminders failed: ${error.message}`);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return [];

  const accountInfo = await loadAccountBrandInfo(
    db, [...new Set(rows.map((r) => r.account_id as string))], "listDueSmsReminders");

  return rows.map((r) => {
    const info = accountInfo.get(r.account_id as string)!;
    const auto = enabled.get(r.account_id as string)!;
    return {
      bookingId: r.id,
      accountId: r.account_id,
      startsAt: r.starts_at,
      bookerTimezone: r.booker_timezone ?? null,
      smsFailedAt: r.sms_reminder_failed_at ?? null,
      contactId: r.contact_id,
      contactPhone: r.contacts?.phone ?? null,
      brandName: brandDisplayName(info.branding, info.accountName),
      accountTimezone: info.accountTimezone,
      body: auto.body,
    };
  });
}

export async function stampSmsReminderSent(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ sms_reminder_sent_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampSmsReminderSent failed: ${error.message}`);
}

export async function stampSmsReminderFailed(db: SupabaseClient, bookingId: string): Promise<void> {
  const { error } = await db.from("bookings")
    .update({ sms_reminder_failed_at: new Date().toISOString() })
    .eq("id", bookingId);
  if (error) throw new Error(`stampSmsReminderFailed failed: ${error.message}`);
}
```

- [ ] **Step 4: Export from `index.ts`**

Replace the automations export block with:

```ts
export { getAutomation, upsertAutomation, parseReviewRequestConfig,
         listDueReviewRequests, stampReviewRequested, stampReviewRequestSmsFailed, countReviewRequestsSince,
         REVIEW_REQUEST_MAX_AGE_MS,
         parseNoShowNudgeConfig, listDueNoShowNudges, stampNoShowNudged, stampNoShowNudgeSmsFailed,
         countNoShowNudgesSince, NO_SHOW_NUDGE_MAX_AGE_MS,
         listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed,
         SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,
         type RecipeKey, type AutomationRow, type ReviewRequestChannel,
         type ReviewRequestConfig, type DueReviewRequest,
         type NoShowNudgeChannel, type NoShowNudgeConfig, type DueNoShowNudge,
         type DueSmsReminder } from "./automations";
```

- [ ] **Step 5: Run the new tests, then the whole db suite ALONE**

```bash
cd /c/Users/danlo/bis-platform/packages/db && npx vitest run src/test/automations.test.ts > /c/Users/danlo/AppData/Local/Temp/claude/t2a.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/t2a.txt
cd /c/Users/danlo/bis-platform/packages/db && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t2b.txt 2>&1; echo "exit=$?"; npx vitest run > /c/Users/danlo/AppData/Local/Temp/claude/t2c.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/t2c.txt
```
Expected: all `exit=0`; automations 7 + 10 = 17 passed; db suite = 203 + 10 = **213**. **If the `.or()` filter is refused by PostgREST** (the two "batch-marked" assertions fail with a 4xx in the thrown message), drop the double quotes in `eitherAnchorSince` (`ends_at.gte.${sinceIso},…`) and re-run; the real-database test decides the form. If both forms fail, split into two reads (`gte ends_at` and `gte <clock>`) merged by id — and say so in the commit message.

- [ ] **Step 6: Mutation check (record in the commit message)**

Run each, see exactly the named assertion fail, revert: (a) `eitherAnchorSince` returns `ends_at.gte."${sinceIso}"` only → `batchMarked` assertions fail in both the review and no-show tests; (b) return `${clockColumn}.gte."${sinceIso}"` only → `legacy` assertions fail; (c) drop `review_request_sms_failed_at` from the review select → the `fresh` marker assertion fails; (d) change `SMS_REMINDER_WINDOW_START_MS` to `60 * 60 * 1000` → `tooSoon` fails (and the constants test).

- [ ] **Step 7: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-b" ] && git add packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts && git commit -q -m "feat(db): review due-list matches on either anchor; no-show and SMS-reminder due-lists, stamps, attempt markers, windows

Mutation-checked: each half of the either-anchor window, the marker projection, the reminder window start." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 3: The shared SMS send helper and the 24h cooldown — applied to the review pass, its existing tests unchanged

**Files:**
- Modify: `apps/web/src/lib/automations/caps.ts` (append)
- Create: `apps/web/src/lib/automations/send-sms.ts` + `send-sms.test.ts`
- Modify: `apps/web/src/lib/automations/passes/review-request.ts`
- Modify: `apps/web/src/lib/automations/passes/review-request.test.ts` (fixture keys + one mock + append)
- Modify: `apps/web/src/lib/automations/imports.test.ts` (fixture guard list)
- Modify: `apps/web/src/app/api/cron/reminders/route.test.ts` — ONLY: one mock line, one key inside `EMPTY_REVIEW_REQUESTS`

**Interfaces:**
- Consumes: `ensureConversation`, `createMessage`, `updateMessageStatus`, `stampReviewRequestSmsFailed`, `DueReviewRequest.smsFailedAt` (Task 2).
- Produces:
  - `SMS_RETRY_COOLDOWN_MS = 24h` (`caps.ts`)
  - `AUTOMATION_ACTOR_ID = "automation"`, `AUTOMATION_ACTOR_TYPE = "system"`
  - `sendAutomationSms(ctx: PassContext, input: { accountId; contactId; to; from; body; onProviderFailure: () => Promise<void> }): Promise<SentSms>` where `type SentSms = { messageId: string; providerMessageId: string }`
  - `markAutomationSmsSent(ctx, accountId, sent: SentSms, what: string): Promise<void>` (best effort)
  - `smsCooldownActive(smsFailedAt: string | null, now: Date): boolean`
  - `reviewRequestPass` counters gain `skippedRecentFailure`.

- [ ] **Step 1: The constant**

Append to `apps/web/src/lib/automations/caps.ts`:

```ts
/**
 * One SMS attempt per booking per day after a FAILED attempt (danlo,
 * 2026-09-06; spec, "Decisions taken after Milestone A shipped").
 * Write-then-send on a 15-minute cron wrote ~12 failed messages rows per
 * booking per morning band during a carrier outage. Each SMS-capable pass
 * writes its recipe's own `*_sms_failed_at` on a provider failure and holds
 * the booking while that marker is younger than this — counted as
 * `skippedRecentFailure`. At most ceil(61h / 24h) = 3 attempts across the
 * review request's window, one visible failed row each
 * (cron-coupling.test.ts pins the 3). Email sends carry no marker: the
 * decision is about the rows a text leaves in the customer's conversation.
 */
export const SMS_RETRY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 2: Write the failing helper tests**

`apps/web/src/lib/automations/send-sms.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { SMS_RETRY_COOLDOWN_MS } from "./caps";
import type { PassContext } from "./context";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive } from "./send-sms";

const NOW = new Date("2026-09-09T14:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("smsCooldownActive — one attempt per booking per day", () => {
  it("is off with no marker, on for a marker younger than 24h, off again at exactly 24h", () => {
    // Mutation: `<=` instead of `<` and the 24h case flips.
    expect(smsCooldownActive(null, NOW)).toBe(false);
    expect(smsCooldownActive(new Date(NOW.getTime() - SMS_RETRY_COOLDOWN_MS + 60_000).toISOString(), NOW)).toBe(true);
    expect(smsCooldownActive(new Date(NOW.getTime() - SMS_RETRY_COOLDOWN_MS).toISOString(), NOW)).toBe(false);
    expect(smsCooldownActive(new Date(NOW.getTime() - 25 * HOUR).toISOString(), NOW)).toBe(false);
  });

  it("holds on a marker in the future (clock skew) and on one it cannot read — the safe direction", () => {
    expect(smsCooldownActive(new Date(NOW.getTime() + HOUR).toISOString(), NOW)).toBe(true);
    expect(smsCooldownActive("not a timestamp", NOW)).toBe(true);
  });

  it("pins the constant", () => {
    expect(SMS_RETRY_COOLDOWN_MS).toBe(24 * HOUR);
  });
});

const smsSend = vi.fn();
function ctx(): PassContext {
  return {
    db: {} as never, now: NOW, origin: "https://app.example.com",
    email: { isFake: true, send: async () => ({ providerMessageId: "e" }) },
    sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }),
  };
}
const input = (onProviderFailure = vi.fn(async () => {})) => ({
  accountId: "acct_1", contactId: "ct_1", to: "+19565550101", from: "+19565550000", body: "hi", onProviderFailure,
});

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sendAutomationSms — write then send, the sendSmsAction discipline, written once", () => {
  it("provider → conversation → message row → send, returning both ids; the marker is NOT written on success", async () => {
    const onProviderFailure = vi.fn(async () => {});
    expect(await sendAutomationSms(ctx(), input(onProviderFailure))).toEqual({ messageId: "msg_1", providerMessageId: "s1" });
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(expect.anything(), "acct_1", "ct_1", "automation", "system");
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: "hi" }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: "hi" });
    expect(onProviderFailure).not.toHaveBeenCalled();
  });

  it("on a provider failure: marks the row failed, THEN runs the marker, then rethrows the provider's error", async () => {
    // Mutation: swap the order, or swallow the throw.
    const order: string[] = [];
    dbMocks.updateMessageStatus.mockImplementation(async () => { order.push("failed"); });
    const onProviderFailure = vi.fn(async () => { order.push("marker"); });
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    await expect(sendAutomationSms(ctx(), input(onProviderFailure))).rejects.toThrow("carrier timeout");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier timeout" }, "automation", "system");
    expect(order).toEqual(["failed", "marker"]);
  });

  it("a marker that itself throws is logged and swallowed; the provider's error still propagates", async () => {
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    const onProviderFailure = vi.fn(async () => { throw new Error("db down"); });
    await expect(sendAutomationSms(ctx(), input(onProviderFailure))).rejects.toThrow("carrier timeout");
    expect(onProviderFailure).toHaveBeenCalledTimes(1);
  });

  it("constructs the provider BEFORE any row is written, so a throwing factory leaves nothing in the inbox", async () => {
    const c: PassContext = { ...ctx(), sms: () => { throw new Error("TELNYX_API_KEY is required in production"); } };
    await expect(sendAutomationSms(c, input())).rejects.toThrow(/TELNYX_API_KEY/);
    expect(dbMocks.ensureConversation).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });
});

describe("markAutomationSmsSent — best effort, after the stamp", () => {
  it("marks the row sent with the provider id, and swallows its own failure", async () => {
    await markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1" }, "test");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("status write failed"));
    await expect(markAutomationSmsSent(ctx(), "acct_1", { messageId: "msg_1", providerMessageId: "s1" }, "test")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/send-sms.test.ts 2>&1 | grep -E "Failed to resolve|does not provide|passed|failed" | head -3
```
Expected: FAIL — `./send-sms` cannot be resolved.

- [ ] **Step 4: Write the helper**

`apps/web/src/lib/automations/send-sms.ts`:

```ts
import { ensureConversation, createMessage, updateMessageStatus } from "@bis/db";
import { SMS_RETRY_COOLDOWN_MS } from "./caps";
import type { PassContext } from "./context";

/** The messages rows automations write are the platform's, not a person's —
 *  the same actor shape the voice text-back uses ("voice"/"ai"). */
export const AUTOMATION_ACTOR_ID = "automation";
export const AUTOMATION_ACTOR_TYPE = "system" as const;

export type AutomationSmsInput = {
  accountId: string;
  contactId: string;
  /** E.164, already through toE164. */
  to: string;
  /** The account's live number, from resolveSmsSender. */
  from: string;
  body: string;
  /** Runs on a PROVIDER failure, after the message row is marked failed: the
   *  recipe's own attempt marker (`*_sms_failed_at`) goes here. Best effort —
   *  its own failure is logged, never thrown, and never re-raised over the
   *  provider's error. */
  onProviderFailure: () => Promise<void>;
};

export type SentSms = { messageId: string; providerMessageId: string };

/**
 * WRITE THEN SEND — sendSmsAction's discipline, shared by every SMS-capable
 * pass so the ordering below is written once (the review-request tests are
 * the proof it did not change when it moved here):
 *   1. the provider FIRST: `ctx.sms()` is lazy and throws in production while
 *      TELNYX_API_KEY is unset; constructing it after the row would leave a
 *      failed text in the customer's conversation on every tick for a
 *      misconfiguration that has nothing to do with the customer;
 *   2. the conversation and the message row, so a provider failure is a
 *      visible failed text in the inbox, not a silent gap;
 *   3. the send;
 *   4. on failure: mark the row failed, write the recipe's attempt marker
 *      (the 24h cooldown's input), rethrow so the pass counts `failed` and
 *      stamps nothing.
 * The caller stamps its dedupe column and THEN calls markAutomationSmsSent.
 */
export async function sendAutomationSms(ctx: PassContext, input: AutomationSmsInput): Promise<SentSms> {
  const sms = ctx.sms();
  const convo = await ensureConversation(
    ctx.db, input.accountId, input.contactId, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  const { id: messageId } = await createMessage(ctx.db, input.accountId, {
    conversationId: convo.id, channel: "sms", direction: "outbound", body: input.body,
  }, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  try {
    const { providerMessageId } = await sms.send({ to: input.to, from: input.from, body: input.body });
    return { messageId, providerMessageId };
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown send failure";
    try {
      await updateMessageStatus(ctx.db, input.accountId, messageId, "failed", { error: message },
        AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
    } catch (statusErr) {
      console.error(`automation sms: could not mark message ${messageId} failed: ${String(statusErr)}`);
    }
    try {
      await input.onProviderFailure();
    } catch (markErr) {
      console.error(`automation sms: could not record the failed attempt for message ${messageId}: ${String(markErr)}`);
    }
    throw e;
  }
}

/**
 * Best effort, AFTER the dedupe stamp: the text is gone and stamped, and a
 * failure here must not re-label a delivered text "failed" (that invites a
 * duplicate send). `what` names the recipe in the log line.
 */
export async function markAutomationSmsSent(
  ctx: PassContext, accountId: string, sent: SentSms, what: string,
): Promise<void> {
  try {
    await updateMessageStatus(ctx.db, accountId, sent.messageId, "sent",
      { providerMessageId: sent.providerMessageId }, AUTOMATION_ACTOR_ID, AUTOMATION_ACTOR_TYPE);
  } catch (e) {
    console.error(`${what}: text sent but message ${sent.messageId} not marked sent: ${String(e)}`);
  }
}

/**
 * Whether a booking's last FAILED text attempt is still inside the cooldown
 * (SMS_RETRY_COOLDOWN_MS). The pass counts a hold as `skippedRecentFailure`
 * and leaves the row unstamped, so it is simply due again once the marker
 * ages out. A marker in the future or one that cannot be read HOLDS — the
 * house rule for a stamp that cannot be trusted is the safe direction.
 */
export function smsCooldownActive(smsFailedAt: string | null, now: Date): boolean {
  if (smsFailedAt === null) return false;
  const t = new Date(smsFailedAt).getTime();
  if (!Number.isFinite(t)) return true;
  return now.getTime() - t < SMS_RETRY_COOLDOWN_MS;
}
```

- [ ] **Step 5: Extend the review-request pass tests BEFORE touching the pass**

In `apps/web/src/lib/automations/passes/review-request.test.ts`:

(a) `dbMocks` gains `stampReviewRequestSmsFailed: vi.fn(),` after `countReviewRequestsSince: vi.fn(),`.
(b) `row()` gains, after `followupSentAt: null,`: `completedAt: null, smsFailedAt: null,` (the type will require them after Task 2).
(c) `EMPTY` gains `skippedRecentFailure: 0,` after `skippedSmsGate: 0,`.
(d) In `beforeEach`, after `dbMocks.countReviewRequestsSince.mockResolvedValue(0);` add `dbMocks.stampReviewRequestSmsFailed.mockResolvedValue(undefined);`.
(e) Append a new describe at the end of the file:

```ts
describe("review-request pass — one SMS attempt per booking per day", () => {
  const sms = (overrides: Partial<DueReviewRequest> = {}) =>
    row({ config: { channel: "sms", reviewUrl: URL }, ...overrides });

  it("a provider failure writes the recipe's attempt marker, after the row is marked failed; nothing is stamped", async () => {
    // Mutation: drop `onProviderFailure` from the sendAutomationSms call.
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.stampReviewRequestSmsFailed).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
    expect(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!)
      .toBeLessThan(dbMocks.stampReviewRequestSmsFailed.mock.invocationCallOrder[0]!);
  });

  it("a marker younger than 24h holds the booking: counted, nothing written, nothing sent", async () => {
    // Mutation: remove the smsCooldownActive check from the SMS branch.
    dbMocks.listDueReviewRequests.mockResolvedValue([sms({ smsFailedAt: new Date(TICK.getTime() - 60 * 60 * 1000).toISOString() })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedRecentFailure: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
    expect(dbMocks.countReviewRequestsSince).not.toHaveBeenCalled();     // a held row never reaches the caps
  });

  it("a marker exactly 24h old is due again", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms({ smsFailedAt: new Date(TICK.getTime() - 24 * 60 * 60 * 1000).toISOString() })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("the EMAIL channel ignores the marker — the decision is about texts", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ smsFailedAt: TICK.toISOString() })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("an email provider failure writes NO marker", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    emailSend.mockRejectedValueOnce(new Error("provider down"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.stampReviewRequestSmsFailed).not.toHaveBeenCalled();
  });
});
```

Run and watch the new describe fail (the old tests still pass — `EMPTY` now carries a key the pass does not return, so EVERY existing `toEqual` on counters fails too; that is expected until Step 6):
```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/passes/review-request.test.ts 2>&1 | grep -E "passed|failed" | head -2
```

- [ ] **Step 6: Rewrite the review-request pass on the shared helper, with the cooldown**

`apps/web/src/lib/automations/passes/review-request.ts` — replace the imports, the `ACTOR_*` constants (delete them), the `Target` type stays; the `run` body's counters, SMS branch and send block change; `sendSms` is deleted; `sendEmail` stays. The whole file:

```ts
import {
  listDueReviewRequests, stampReviewRequested, stampReviewRequestSmsFailed, countReviewRequestsSince,
  type DueReviewRequest, type ReviewRequestConfig,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { reviewRequestEmail } from "@/lib/email/templates/review-request";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { shouldSendReviewRequestNow } from "../review-request-gate";
import { composeReviewRequestSms, defaultReviewRequestBody } from "../review-request-copy";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive, type SentSms } from "../send-sms";
import type { Pass, PassContext } from "../context";

type Target =
  | { channel: "sms"; to: string; from: string }
  | { channel: "email"; to: string };

/**
 * Review request after a completed job — the first RECIPE on the harness.
 *
 * Trigger is a human: the operator's "Mark completed". Everything here is
 * then decided per row, in this order, each refusal counted under its own
 * name so triage can tell them apart:
 *   invalid config → unresolvable zone → not this morning (the gate, which
 *   also defers to the calendar follow-up) → no deliverable address → SMS
 *   gate refused (NO fallback to email) → SMS cooldown → caps → send →
 *   STAMP → (sms) mark the message row sent.
 *
 * Nothing new sends: `ctx.email` and `ctx.sms()` come from the harness.
 * The SMS path is sendAutomationSms — write the message row, then send,
 * mark failed and write the attempt marker on a provider error — so a
 * review text shows up in the customer's conversation like any other
 * outbound text, and a reply lands in the operator's inbox.
 */
export const reviewRequestPass: Pass = {
  key: "reviewRequests",
  async run(ctx) {
    const c = {
      sent: 0, failed: 0, unstamped: 0,
      skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0,
      waitingForMorning: 0, unresolvableTimezone: 0,
    };
    const due = await listDueReviewRequests(ctx.db, ctx.now.toISOString());

    // Per-account memos for one tick: the sender gate and the daily count
    // are answered once per account, not once per row.
    const smsGates = new Map<string, SmsGate>();
    const sentToday = new Map<string, number>();
    let attemptsThisTick = 0;

    for (const row of due) {
      const config = row.config;
      if (config === null) {
        c.skippedInvalidConfig++;
        console.error(
          `review request skipped for booking ${row.bookingId}: account ${row.accountId}'s `
          + `review_request config is missing or invalid — set the review link in Automations`,
        );
        continue;
      }

      // RULE 0, before the gate, same as the follow-up pass: no resolvable
      // zone means no defensible hour. Counted separately so a
      // misconfiguration stays visible rather than hiding in waitingForMorning.
      if (resolveAccountZone(row.accountTimezone) === null) {
        c.unresolvableTimezone++;
        console.error(
          `review request HELD for booking ${row.bookingId}: account ${row.accountId}'s timezone `
          + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve — fix the account's timezone`,
        );
        continue;
      }

      const followupSentAt = row.followupSentAt ? new Date(row.followupSentAt) : null;
      if (!shouldSendReviewRequestNow(ctx.now, new Date(row.endsAt), followupSentAt, row.accountTimezone)) {
        c.waitingForMorning++;
        continue;
      }

      // The deliverable address for the CHOSEN channel. SMS: contacts.phone
      // is free-form and toE164 is what every number leaving this app goes
      // through (null = nothing we can text). Email: the address or nothing.
      let target: Target;
      if (config.channel === "sms") {
        const to = toE164(row.contactPhone);
        if (!to) {
          c.skippedNoAddress++;
          console.error(`review request skipped, no textable phone on file for booking ${row.bookingId}`);
          continue;
        }
        // THE gate, and the only one — never re-derived. Refusal means skip
        // and count, NOT "send it by email instead": a silent channel switch
        // is how an operator stops trusting what the settings page says.
        let gate = smsGates.get(row.accountId);
        if (!gate) {
          // The gate READS (a2p registration, phone_numbers); a read error is
          // this row's failure, not the whole pass's — letting it escape would
          // discard the counters for every row already sent this tick.
          try {
            gate = await resolveSmsSender(ctx.db, row.accountId);
          } catch (e) {
            c.failed++;
            console.error(`review request: sms gate read failed for account ${row.accountId}: ${String(e)}`);
            continue;
          }
          smsGates.set(row.accountId, gate);
        }
        if (!gate.ok) {
          c.skippedSmsGate++;
          console.error(
            `review request skipped for booking ${row.bookingId}: account ${row.accountId} cannot text `
            + `(${gate.reason}) — not falling back to email`,
          );
          continue;
        }
        // ONE ATTEMPT PER DAY: a text that failed less than 24h ago is not
        // retried this tick (caps.ts, SMS_RETRY_COOLDOWN_MS). Held rows never
        // reach the caps and are simply due again when the marker ages out.
        if (smsCooldownActive(row.smsFailedAt, ctx.now)) {
          c.skippedRecentFailure++;
          continue;
        }
        target = { channel: "sms", to, from: gate.from };
      } else {
        if (!row.contactEmail) {
          c.skippedNoAddress++;
          console.error(`review request skipped, no contact email on file for booking ${row.bookingId}`);
          continue;
        }
        target = { channel: "email", to: row.contactEmail };
      }

      // CAPS, recipe passes only (caps.ts). Checked AFTER the gate and the
      // address, so only rows that would actually send count against them;
      // a skipped row is left unstamped and is simply due again.
      if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
        c.skippedCap++;
        continue;
      }
      let today = sentToday.get(row.accountId);
      if (today === undefined) {
        today = await countReviewRequestsSince(
          ctx.db, row.accountId, new Date(ctx.now.getTime() - DAILY_CAP_WINDOW_MS).toISOString(),
        );
        sentToday.set(row.accountId, today);
      }
      if (today >= AUTOMATION_DAILY_CAP) {
        c.skippedCap++;
        continue;
      }
      attemptsThisTick++;
      sentToday.set(row.accountId, today + 1);

      const body = row.body.trim() || defaultReviewRequestBody(row.brandName);

      let smsRow: SentSms | null = null;
      try {
        if (target.channel === "sms") {
          smsRow = await sendAutomationSms(ctx, {
            accountId: row.accountId, contactId: row.contactId, to: target.to, from: target.from,
            body: composeReviewRequestSms(body, config.reviewUrl),
            onProviderFailure: () => stampReviewRequestSmsFailed(ctx.db, row.bookingId),
          });
        } else {
          await sendEmail(ctx, row, config, target.to, body);
        }
      } catch (e) {
        c.failed++;
        console.error(`review request send failed for booking ${row.bookingId}: ${String(e)}`);
        continue;
      }

      // SEND-THEN-STAMP. The stamp comes BEFORE the SMS row's status update:
      // the stamp is what stops ~12 duplicates over the morning band; the
      // status is what the inbox shows. Same residual as the other passes
      // when every attempt fails — counted, logged, and the repeats are live.
      const stamp = await stampWithRetry(() => stampReviewRequested(ctx.db, row.bookingId));
      if (!stamp.stamped) {
        c.unstamped++;
        console.error(
          `review request sent but NOT stamped for booking ${row.bookingId} after `
          + `${stamp.attempts} attempts — expect up to 11 more copies before the morning band `
          + `closes: ${String(stamp.lastError)}`,
        );
      }
      c.sent++;

      if (smsRow) await markAutomationSmsSent(ctx, row.accountId, smsRow, "review request");
    }

    return c;
  },
};

async function sendEmail(
  ctx: PassContext, row: DueReviewRequest, config: ReviewRequestConfig, to: string, body: string,
): Promise<void> {
  // emailBrandNamed, because the row carries the resolved brand name and
  // nothing else — there is no accountName here to get wrong.
  const brand = emailBrandNamed(row.branding, row.brandName);
  const { subject, html, text } = reviewRequestEmail({ brand, body, reviewUrl: config.reviewUrl });
  await ctx.email.send({
    to,
    fromName: brand.name,
    fromAddress: row.fromEmail ?? undefined,
    // The row's OWN top-level replyToEmail, never branding.replyToEmail —
    // the DueFollowup precedent.
    replyTo: normalizeReplyTo(row.replyToEmail),
    subject,
    body: text,
    html,
  });
}
```

- [ ] **Step 7: The two additive edits elsewhere**

`apps/web/src/lib/automations/imports.test.ts` — add `"send-sms.ts"` to the `arrayContaining` list in the fixture-guard test.

`apps/web/src/app/api/cron/reminders/route.test.ts` — (a) inside the `vi.mock("@bis/db", …)` factory, after `countReviewRequestsSince: async () => 0,` add:
```ts
  stampReviewRequestSmsFailed: async () => undefined,
```
(b) inside `EMPTY_REVIEW_REQUESTS`, on a NEW line after `skippedSmsGate: 0, skippedCap: 0, waitingForMorning: 0, unresolvableTimezone: 0,`:
```ts
  skippedRecentFailure: 0,
```
Verify additions only:
```bash
cd /c/Users/danlo/bis-platform && git diff -- apps/web/src/app/api/cron/reminders/route.test.ts | grep -E "^-[^-]"; echo "removed-lines-above (expect none)"
```

- [ ] **Step 8: Run the automations tree, the route tests, the sentinel, typecheck, lint**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations src/app/api/cron > /c/Users/danlo/AppData/Local/Temp/claude/t3.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/t3.txt
cd /c/Users/danlo/bis-platform && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t3b.txt 2>&1; echo "exit=$?"; pnpm lint > /c/Users/danlo/AppData/Local/Temp/claude/t3c.txt 2>&1; echo "exit=$?"
```
Expected: all `exit=0`; review-request 19 + 5 = 24 passed, send-sms 8, route 30, sentinel 2, everything else unchanged. Every pre-existing review-request assertion is byte-identical to `main` — check:
```bash
cd /c/Users/danlo/bis-platform && git diff main -- apps/web/src/lib/automations/passes/review-request.test.ts | grep -E "^-[^-]"; echo "removed-lines-above (expect: only the four fixture/EMPTY lines that gained keys)"
```

- [ ] **Step 9: Mutation check (record in the commit message)**

(a) Remove `smsCooldownActive(...)` from the SMS branch → "a marker younger than 24h holds" fails. (b) Drop `onProviderFailure` (pass `async () => {}`) → "writes the recipe's attempt marker" fails. (c) In `send-sms.ts`, move `ctx.sms()` below `createMessage` → "constructs the provider BEFORE" fails in both files. (d) In `send-sms.ts`, run `onProviderFailure` before `updateMessageStatus` → the order test fails. Revert each.

- [ ] **Step 10: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-b" ] && git add apps/web/src/lib/automations/caps.ts apps/web/src/lib/automations/send-sms.ts apps/web/src/lib/automations/send-sms.test.ts apps/web/src/lib/automations/passes/review-request.ts apps/web/src/lib/automations/passes/review-request.test.ts apps/web/src/lib/automations/imports.test.ts apps/web/src/app/api/cron/reminders/route.test.ts && git commit -q -m "feat(automations): one shared SMS send path; 24h hold after a failed text, applied to the review request

The review pass's SMS path moved into sendAutomationSms with its 19 existing tests unchanged.
Mutation-checked: cooldown check, attempt marker, provider-first, failed-then-marker order." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 4: The completion anchor — `laterOf`, the review gate's clock, the pass

**Files:**
- Create: `apps/web/src/lib/automations/anchor.ts` + `anchor.test.ts`
- Modify: `apps/web/src/lib/automations/review-request-gate.ts` (doc + parameter name only; the body is untouched)
- Modify: `apps/web/src/lib/automations/review-request-gate.test.ts` (one import + one describe appended)
- Modify: `apps/web/src/lib/automations/passes/review-request.ts` (one line)
- Modify: `apps/web/src/lib/automations/passes/review-request.test.ts` (append)

**Interfaces:**
- Produces: `laterOf(endsAt: Date, stampedAt: Date | null): Date`; `shouldSendReviewRequestNow(now: Date, anchor: Date, followupSentAt: Date | null, timezone: string): boolean` (same types, renamed parameter).

- [ ] **Step 1: Confirm the fixture instants with Intl first**

```bash
node -e 'const f=(d,z)=>new Intl.DateTimeFormat("en-US",{timeZone:z,weekday:"short",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(d));for(const [d,z] of [["2026-09-09T14:00:00Z","America/New_York"],["2026-09-09T14:00:00Z","America/Chicago"],["2026-08-31T22:00:00Z","America/New_York"],["2026-09-08T20:00:00Z","America/New_York"],["2026-09-09T12:30:00Z","America/New_York"],["2026-09-09T04:30:00Z","America/New_York"],["2026-09-09T04:30:00Z","America/Chicago"],["2026-09-04T20:00:00Z","America/New_York"],["2026-09-05T14:00:00Z","America/New_York"]])console.log(d.padEnd(22),z.padEnd(20),f(d,z))'
```
Expected:
```
2026-09-09T14:00:00Z   America/New_York     Wed, 09/09, 10:00
2026-09-09T14:00:00Z   America/Chicago      Wed, 09/09, 09:00
2026-08-31T22:00:00Z   America/New_York     Mon, 08/31, 18:00
2026-09-08T20:00:00Z   America/New_York     Tue, 09/08, 16:00
2026-09-09T12:30:00Z   America/New_York     Wed, 09/09, 08:30
2026-09-09T04:30:00Z   America/New_York     Wed, 09/09, 00:30
2026-09-09T04:30:00Z   America/Chicago      Tue, 09/08, 23:30
2026-09-04T20:00:00Z   America/New_York     Fri, 09/04, 16:00
2026-09-05T14:00:00Z   America/New_York     Sat, 09/05, 10:00
```
If any line differs, fix the fixture, never the assertion.

- [ ] **Step 2: Write the failing tests**

`apps/web/src/lib/automations/anchor.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { laterOf } from "./anchor";

describe("laterOf — the instant an automation's clock runs from", () => {
  const ended = new Date("2026-09-08T22:00:00Z");

  it("is the meeting end when there is no stamp (a row flipped before 0026)", () => {
    expect(laterOf(ended, null)).toBe(ended);
  });

  it("is the stamp when the operator acted AFTER the meeting ended, the meeting end when they acted before it", () => {
    // Mutation: always return endsAt — the first assertion fails.
    const later = new Date("2026-09-09T12:30:00Z");
    const earlier = new Date("2026-09-08T21:00:00Z");
    expect(laterOf(ended, later)).toBe(later);
    expect(laterOf(ended, earlier)).toBe(ended);
  });

  it("falls back to the meeting end on a stamp it cannot read", () => {
    expect(laterOf(ended, new Date("nope"))).toBe(ended);
  });
});
```

Append to `apps/web/src/lib/automations/review-request-gate.test.ts` — add `import { laterOf } from "./anchor";` after the existing gate import, and at the end of the file:

```ts
describe("shouldSendReviewRequestNow — the clock runs from laterOf(ends_at, completed_at)", () => {
  /**
   * The batch-Friday case that motivated 0026: a job that ended Monday and
   * was marked completed Friday afternoon. From ends_at it is 4½ days stale
   * and the cap drops it; from completed_at it is Saturday morning's
   * business. Mutation: pass `ENDED` instead of the anchor in the pass.
   */
  const ENDED_MONDAY = new Date("2026-08-31T22:00:00Z");     // NY Mon 18:00
  const COMPLETED_FRIDAY = new Date("2026-09-04T20:00:00Z"); // NY Fri 16:00
  const SATURDAY_MORNING = new Date("2026-09-05T14:00:00Z"); // NY Sat 10:00

  it("a job completed days after it ended is due the morning after completion, not dropped as stale", () => {
    expect(shouldSendReviewRequestNow(SATURDAY_MORNING, ENDED_MONDAY, null, NY)).toBe(false);
    expect(shouldSendReviewRequestNow(SATURDAY_MORNING, laterOf(ENDED_MONDAY, COMPLETED_FRIDAY), null, NY)).toBe(true);
  });

  it("a job completed THIS morning holds until tomorrow even though the meeting ended yesterday", () => {
    const NOW = new Date("2026-09-09T14:00:00Z");              // NY Wed 10:00
    const ENDED = new Date("2026-09-08T22:00:00Z");            // NY Tue 18:00
    const COMPLETED_TODAY = new Date("2026-09-09T12:30:00Z");  // NY Wed 08:30
    expect(shouldSendReviewRequestNow(NOW, ENDED, null, NY)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, laterOf(ENDED, COMPLETED_TODAY), null, NY)).toBe(false);
  });

  it("one completion instant, two zones, opposite verdicts — the stamp's LOCAL day is what counts", () => {
    const NOW = new Date("2026-09-09T14:00:00Z");              // NY Wed 10:00 · CHI Wed 09:00
    const ENDED = new Date("2026-09-08T20:00:00Z");            // NY Tue 16:00
    const COMPLETED = new Date("2026-09-09T04:30:00Z");        // NY Wed 00:30 · CHI Tue 23:30
    expect(shouldSendReviewRequestNow(NOW, laterOf(ENDED, COMPLETED), null, CHI)).toBe(true);
    expect(shouldSendReviewRequestNow(NOW, laterOf(ENDED, COMPLETED), null, NY)).toBe(false);
  });
});
```

Append to `apps/web/src/lib/automations/passes/review-request.test.ts`:

```ts
describe("review-request pass — the completion clock (0026)", () => {
  it("the batch-Friday case: ended 9 days ago, completed yesterday afternoon → sent this morning", async () => {
    // Mutation: pass `new Date(row.endsAt)` to the gate instead of the anchor.
    dbMocks.listDueReviewRequests.mockResolvedValue([row({
      endsAt: "2026-08-31T22:00:00.000Z", completedAt: "2026-09-08T20:00:00.000Z",   // NY Mon 18:00 · Tue 16:00
    })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("one completion instant, two zones: stamped 00:30 today in New York holds, 23:30 yesterday in Chicago sends", async () => {
    const completed = "2026-09-09T04:30:00.000Z";
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ completedAt: completed, accountTimezone: "America/New_York" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, waitingForMorning: 1 });
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ completedAt: completed, accountTimezone: "America/Chicago" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("a pre-0026 row (completedAt null) behaves exactly as before", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ completedAt: null })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/anchor.test.ts src/lib/automations/review-request-gate.test.ts src/lib/automations/passes/review-request.test.ts 2>&1 | grep -E "Failed to resolve|passed|failed" | head -4
```
Expected: FAIL — `./anchor` cannot be resolved; once it can, the batch-Friday pass test fails with `waitingForMorning: 1`.

- [ ] **Step 4: `anchor.ts`, the gate's doc, the pass's one line**

`apps/web/src/lib/automations/anchor.ts`:

```ts
/**
 * The instant an automation's clock runs from: the LATER of the meeting's
 * end and the operator's status stamp (0026; spec, "Decisions taken after
 * Milestone A shipped"). A client who marks a week's jobs completed on
 * Friday gets review requests on Saturday morning; with ends_at alone
 * everything older than 61h aged out unsent and no counter said so. The
 * no-show nudge runs from laterOf(ends_at, no_show_at) the same way.
 *
 * A null stamp (a row flipped before 0026) or one that cannot be read falls
 * back to the meeting end — the pre-B behaviour exactly.
 */
export function laterOf(endsAt: Date, stampedAt: Date | null): Date {
  if (stampedAt === null || !Number.isFinite(stampedAt.getTime())) return endsAt;
  return stampedAt.getTime() > endsAt.getTime() ? stampedAt : endsAt;
}
```

`apps/web/src/lib/automations/review-request-gate.ts` — rename the second parameter `meetingEnd` → `anchor` (in the signature and its two uses in the body; nothing else in the body changes), and replace the doc comment's "Rules" list header line `* Rules, all of which must hold:` with:
```ts
 * `anchor` is laterOf(ends_at, completed_at) (anchor.ts) — the pass computes
 * it; this gate only knows an instant. Rules, all of which must hold:
```
and rule 1/3 read `1. Not stale: the anchor is within 61h.` and `3. The anchor fell on a strictly EARLIER local day.`

`apps/web/src/lib/automations/passes/review-request.ts` — add `import { laterOf } from "../anchor";` and replace the gate call with:
```ts
      const followupSentAt = row.followupSentAt ? new Date(row.followupSentAt) : null;
      // THE CLOCK (0026): the later of the meeting end and "Mark completed".
      const anchor = laterOf(new Date(row.endsAt), row.completedAt ? new Date(row.completedAt) : null);
      if (!shouldSendReviewRequestNow(ctx.now, anchor, followupSentAt, row.accountTimezone)) {
```

- [ ] **Step 5: Run, prove the gate test file's existing tests are untouched, mutate, commit**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations > /c/Users/danlo/AppData/Local/Temp/claude/t4.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/t4.txt
cd /c/Users/danlo/bis-platform && git diff main -- apps/web/src/lib/automations/review-request-gate.test.ts | grep -E "^-[^-]"; echo "removed-lines-above (expect none)"
```
Expected: `exit=0`; anchor 3, gate 10 + 3 = 13, review-request pass 24 + 3 = 27. Mutations: (a) `laterOf` returns `endsAt` always → anchor test + batch-Friday tests fail; (b) in the pass, hand the gate `new Date(row.endsAt)` → the batch-Friday pass test fails. Revert.

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-b" ] && git add apps/web/src/lib/automations/anchor.ts apps/web/src/lib/automations/anchor.test.ts apps/web/src/lib/automations/review-request-gate.ts apps/web/src/lib/automations/review-request-gate.test.ts apps/web/src/lib/automations/passes/review-request.ts apps/web/src/lib/automations/passes/review-request.test.ts && git commit -q -m "feat(automations): the review clock runs from laterOf(ends_at, completed_at)

Gate body untouched, its 10 tests untouched; the pass hands it the anchor. Mutation-checked." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 5: The no-show nudge's pure halves — gate, copy, the ONE link appender, the shared prose-and-button email

**Files:**
- Create: `apps/web/src/lib/automations/no-show-nudge-gate.ts` + `.test.ts`
- Create: `apps/web/src/lib/automations/sms-link.ts`
- Modify: `apps/web/src/lib/automations/review-request-copy.ts` (`composeReviewRequestSms` delegates; its test file NOT edited)
- Create: `apps/web/src/lib/automations/no-show-nudge-copy.ts` + `.test.ts`
- Create: `apps/web/src/lib/email/templates/prose-button.ts`
- Modify: `apps/web/src/lib/email/templates/review-request.ts` (delegates; its test file NOT edited)
- Create: `apps/web/src/lib/email/templates/no-show-nudge.ts` + `.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (copy keys)

**Interfaces:**
- Consumes: `NO_SHOW_NUDGE_MAX_AGE_MS` (`@bis/db`, Task 2); `resolveAccountZone`, `isInMorningBand`, `isStrictlyEarlierLocalDay` (`@/lib/booking/followup-timing`); `shell`, `escapeHtml`, `button`, `EmailBrand` (`./shell`); `m`; `segmentsFor`.
- Produces:
  - `shouldSendNoShowNudgeNow(now: Date, anchor: Date, timezone: string): boolean`
  - `withTrailingLink(body: string, link: string): string`
  - `defaultNoShowNudgeBody(brandName: string): string`; `composeNoShowNudgeSms(body: string, bookingUrl: string): string`
  - `proseWithButton(brand: EmailBrand, body: string, href: string, label: string): { html: string; text: string }`
  - `noShowNudgeEmail(input: { brand: EmailBrand; body: string; bookingUrl: string }): { subject: string; html: string; text: string }`

- [ ] **Step 1: Confirm the fixture instants with Intl first**

```bash
node -e 'const f=(d,z)=>new Intl.DateTimeFormat("en-US",{timeZone:z,weekday:"short",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(d));for(const [d,z] of [["2026-09-09T14:00:00Z","America/New_York"],["2026-09-09T14:00:00Z","America/Los_Angeles"],["2026-09-09T14:00:00Z","America/Chicago"],["2026-09-08T20:30:00Z","America/New_York"],["2026-09-08T20:30:00Z","America/Los_Angeles"],["2026-09-09T12:30:00Z","America/New_York"],["2026-09-09T04:30:00Z","America/New_York"],["2026-09-09T04:30:00Z","America/Chicago"],["2026-10-24T22:00:00Z","Antarctica/Troll"],["2026-10-26T08:00:00Z","Antarctica/Troll"],["2026-10-26T10:59:00Z","Antarctica/Troll"],["2026-10-26T11:00:00Z","Antarctica/Troll"],["2026-09-09T09:30:00Z","UTC"]])console.log(d.padEnd(22),z.padEnd(20),f(d,z))'
```
Expected:
```
2026-09-09T14:00:00Z   America/New_York     Wed, 09/09, 10:00
2026-09-09T14:00:00Z   America/Los_Angeles  Wed, 09/09, 07:00
2026-09-09T14:00:00Z   America/Chicago      Wed, 09/09, 09:00
2026-09-08T20:30:00Z   America/New_York     Tue, 09/08, 16:30
2026-09-08T20:30:00Z   America/Los_Angeles  Tue, 09/08, 13:30
2026-09-09T12:30:00Z   America/New_York     Wed, 09/09, 08:30
2026-09-09T04:30:00Z   America/New_York     Wed, 09/09, 00:30
2026-09-09T04:30:00Z   America/Chicago      Tue, 09/08, 23:30
2026-10-24T22:00:00Z   Antarctica/Troll     Sun, 10/25, 00:00
2026-10-26T08:00:00Z   Antarctica/Troll     Mon, 10/26, 08:00
2026-10-26T10:59:00Z   Antarctica/Troll     Mon, 10/26, 10:59
2026-10-26T11:00:00Z   Antarctica/Troll     Mon, 10/26, 11:00
2026-09-09T09:30:00Z   UTC                  Wed, 09/09, 09:30
```

- [ ] **Step 2: Write the failing gate tests**

`apps/web/src/lib/automations/no-show-nudge-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { NO_SHOW_NUDGE_MAX_AGE_MS, FOLLOWUP_QUERY_WINDOW_MS } from "@bis/db";
import { laterOf } from "./anchor";
import { shouldSendNoShowNudgeNow } from "./no-show-nudge-gate";

/**
 * Same rules as review-request-gate.test.ts: every instant computed with
 * Intl before the assertion was written; every zone-dependent test pins ONE
 * instant against TWO zones with OPPOSITE verdicts; America/Chicago only as
 * one half of a pair.
 */
const NY = "America/New_York";
const LA = "America/Los_Angeles";
const CHI = "America/Chicago";
const HOUR = 60 * 60 * 1000;

describe("shouldSendNoShowNudgeNow — the morning after, in the account's zone", () => {
  const NOW = new Date("2026-09-09T14:00:00Z");       // NY 10:00 · LA 07:00
  const ANCHOR = new Date("2026-09-08T20:30:00Z");    // NY Tue 16:30 · LA Tue 13:30

  it("sends where it is mid-morning, holds where it is still dawn", () => {
    expect(shouldSendNoShowNudgeNow(NOW, ANCHOR, NY)).toBe(true);
    expect(shouldSendNoShowNudgeNow(NOW, ANCHOR, LA)).toBe(false);
  });

  it("never sends for an anchor in the future, and never on the same local day", () => {
    expect(shouldSendNoShowNudgeNow(NOW, new Date("2026-09-09T18:00:00Z"), NY)).toBe(false);
    expect(shouldSendNoShowNudgeNow(NOW, new Date("2026-09-09T12:30:00Z"), NY)).toBe(false);   // marked 08:30 today
  });

  it("fails closed on an unresolvable zone; an explicit UTC account still works", () => {
    const utcMorning = new Date("2026-09-09T09:30:00Z");
    expect(shouldSendNoShowNudgeNow(utcMorning, ANCHOR, "UTC")).toBe(true);
    for (const junk of ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"]) {
      expect(shouldSendNoShowNudgeNow(utcMorning, ANCHOR, junk)).toBe(false);
    }
  });

  it("one 'Mark no-show' instant, two zones: 23:30 yesterday in Chicago sends, 00:30 today in New York holds", () => {
    // The operator closing the books at midnight — the case the morning band
    // exists for. Mutation: compare instants instead of local days.
    const ENDED = new Date("2026-09-08T20:30:00Z");
    const MARKED = new Date("2026-09-09T04:30:00Z");  // NY Wed 00:30 · CHI Tue 23:30
    expect(shouldSendNoShowNudgeNow(NOW, laterOf(ENDED, MARKED), CHI)).toBe(true);
    expect(shouldSendNoShowNudgeNow(NOW, laterOf(ENDED, MARKED), NY)).toBe(false);
  });
});

describe("shouldSendNoShowNudgeNow — the 37h cap, pinned against real zones", () => {
  it("is exactly the follow-up window: same derivation, nothing to defer to", () => {
    expect(NO_SHOW_NUDGE_MAX_AGE_MS).toBe(37 * HOUR);
    expect(NO_SHOW_NUDGE_MAX_AGE_MS).toBe(FOLLOWUP_QUERY_WINDOW_MS);
  });

  it("treats the boundary as still-sendable, one millisecond past it as stale", () => {
    const now = new Date("2026-09-09T09:30:00Z");
    expect(shouldSendNoShowNudgeNow(now, new Date(now.getTime() - NO_SHOW_NUDGE_MAX_AGE_MS), "UTC")).toBe(true);
    expect(shouldSendNoShowNudgeNow(now, new Date(now.getTime() - NO_SHOW_NUDGE_MAX_AGE_MS - 1), "UTC")).toBe(false);
  });

  /**
   * THE DERIVATION, as a test. Antarctica/Troll falls back TWO hours on
   * 2026-10-25, making that local day 26 hours long. An anchor at 00:00
   * local that day is the worst case; the band on Monday is 08:00–11:00,
   * and its last qualifying instant is 37h after the anchor. Mutation: 36h
   * and `justInsideTheBand` fails while `bandOpens` still passes.
   */
  it("covers the true worst case: a 26-hour local day, then the morning band on D+1", () => {
    const anchorAtLocalMidnight = new Date("2026-10-24T22:00:00Z");  // Troll 00:00 Sun Oct 25
    const bandOpens = new Date("2026-10-26T08:00:00Z");              // Troll 08:00 Mon Oct 26
    const bandCloses = new Date("2026-10-26T11:00:00Z");             // Troll 11:00 Mon Oct 26
    const Z = "Antarctica/Troll";
    expect(bandCloses.getTime() - anchorAtLocalMidnight.getTime()).toBe(NO_SHOW_NUDGE_MAX_AGE_MS);
    expect(shouldSendNoShowNudgeNow(bandOpens, anchorAtLocalMidnight, Z)).toBe(true);
    expect(shouldSendNoShowNudgeNow(bandCloses, anchorAtLocalMidnight, Z)).toBe(false);   // the band's exclusive edge
    expect(shouldSendNoShowNudgeNow(new Date(bandCloses.getTime() - 60 * 1000), anchorAtLocalMidnight, Z)).toBe(true);
  });
});
```

- [ ] **Step 3: Write the failing copy and template tests**

`apps/web/src/lib/automations/no-show-nudge-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { withTrailingLink } from "./sms-link";
import { composeReviewRequestSms } from "./review-request-copy";
import { defaultNoShowNudgeBody, composeNoShowNudgeSms } from "./no-show-nudge-copy";

const URL = "https://app.example.com/b/cal_pub_1";

describe("withTrailingLink — the ONE place a link is appended to an SMS", () => {
  it("is the trimmed body, one space, the trimmed link; either alone when the other is empty", () => {
    expect(withTrailingLink("  Book here:  ", ` ${URL} `)).toBe(`Book here: ${URL}`);
    expect(withTrailingLink("Book here:", "")).toBe("Book here:");
    expect(withTrailingLink("", URL)).toBe(URL);
  });

  it("is what both composers are made of — the review composer's own tests stay the proof for its side", () => {
    expect(composeReviewRequestSms("Review us:", URL)).toBe(withTrailingLink("Review us:", URL));
    expect(composeNoShowNudgeSms("Rebook:", URL)).toBe(withTrailingLink("Rebook:", URL));
  });
});

describe("defaultNoShowNudgeBody", () => {
  it("names the company, so a text from an unknown number does not read as spam", () => {
    expect(defaultNoShowNudgeBody("Rio Roofing"))
      .toBe("We missed you for your appointment with Rio Roofing. If you'd like to pick a new time, book here:");
  });

  it("drops the identifying clause for a blank name instead of inventing one", () => {
    expect(defaultNoShowNudgeBody("   "))
      .toBe("We missed you for your appointment. If you'd like to pick a new time, book here:");
  });

  it("inserts a name containing $ patterns literally", () => {
    expect(defaultNoShowNudgeBody("A$&B")).toContain("with A$&B.");
  });

  it("MEASURED: the default plus a booking-page link is ONE GSM-7 segment for a GSM-7 name", () => {
    // Mutation: count the body alone and this still passes — which is why the
    // page's counter test in automations.spec.ts feeds the composed string.
    const s = segmentsFor(composeNoShowNudgeSms(defaultNoShowNudgeBody("Rio Roofing"), URL));
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
    expect(s.chars).toBe(133);
  });

  it("MEASURED: an accented company name flips the whole message to UCS-2 and costs THREE segments", () => {
    // "García" is the common case on this platform, not an edge case, and
    // this message is long enough that the flip costs three. The counter
    // has to show that.
    const s = segmentsFor(composeNoShowNudgeSms(defaultNoShowNudgeBody("García Roofing"), URL));
    expect(s.encoding).toBe("ucs2");
    expect(s.segments).toBe(3);
  });
});
```

`apps/web/src/lib/email/templates/no-show-nudge.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { noShowNudgeEmail } from "./no-show-nudge";
import { reviewRequestEmail } from "./review-request";
import type { EmailBrand } from "./shell";

const brand: EmailBrand = {
  name: "Rio Roofing", logoUrl: null,
  accent: { accent: "#1e3a8a", accentForeground: "#ffffff" } as EmailBrand["accent"],
};
const URL = "https://app.example.com/b/cal_pub_1";

describe("noShowNudgeEmail", () => {
  it("asks in the subject, in the brand's name, never the internal label", () => {
    expect(noShowNudgeEmail({ brand, body: "We missed you.", bookingUrl: URL }).subject)
      .toBe("Want to pick a new time with Rio Roofing?");
  });

  it("renders the body as paragraphs, then the booking page as the ONE button, in both parts", () => {
    const { html, text } = noShowNudgeEmail({ brand, body: "We missed you.\n\nPick a new time:", bookingUrl: URL });
    expect(html).toContain('<p style="margin:0 0 12px;">We missed you.</p>');
    expect(html).toContain('<p style="margin:0 0 12px;">Pick a new time:</p>');
    expect(html).toContain(`href="${URL}"`);
    expect(html).toContain(">Pick a new time</a>");
    expect(text).toBe(`We missed you.\n\nPick a new time:\n\n${URL}`);
  });

  it("escapes markup the operator typed, and escapes the url in the href", () => {
    const { html } = noShowNudgeEmail({ brand, body: "<b>hi</b>", bookingUrl: "https://x.example/?a=1&b=2" });
    expect(html).toContain("&lt;b&gt;hi&lt;/b&gt;");
    expect(html).toContain('href="https://x.example/?a=1&amp;b=2"');
    expect(html).not.toContain("<b>hi</b>");
  });

  it("shares its body with the review request: same paragraphs, same button markup, different label and subject", () => {
    // The review template's own tests stay the proof for its side; this pins
    // that the shared renderer is the same one.
    const a = noShowNudgeEmail({ brand, body: "Same body", bookingUrl: URL }).html;
    const b = reviewRequestEmail({ brand, body: "Same body", reviewUrl: URL }).html;
    expect(a.replace(">Pick a new time</a>", ">Leave a review</a>")).toBe(b);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/no-show-nudge-gate.test.ts src/lib/automations/no-show-nudge-copy.test.ts src/lib/email/templates/no-show-nudge.test.ts 2>&1 | grep -E "Failed to resolve|passed|failed" | head -4
```
Expected: FAIL — the three new modules cannot be resolved.

- [ ] **Step 5: The copy keys**

In `apps/web/src/lib/messages.ts`, directly after `"automations.review.defaultBodyNoName": …,` add:

```ts
  // The no-show nudge's default body. Same rules as the review request's:
  // `{name}` filled at send time with the customer-facing brand name; the
  // NoName variant drops the clause; GSM-7 throughout (straight apostrophe).
  // The trailing colon is where the booking-page link is appended
  // (composeNoShowNudgeSms); the email template renders it as a button.
  "automations.noShow.defaultBody": "We missed you for your appointment with {name}. If you'd like to pick a new time, book here:",
  "automations.noShow.defaultBodyNoName": "We missed you for your appointment. If you'd like to pick a new time, book here:",
  // The text reminder. The LEAD carries the appointment time and is never
  // the operator's to place — `{when}` is formatWhen's output in the
  // booker's zone; the operator's prose (or this default) follows it.
  "automations.smsReminder.lead": "Reminder: your appointment with {name} is {when}.",
  "automations.smsReminder.leadNoName": "Reminder: your appointment is {when}.",
  "automations.smsReminder.defaultBody": "Reply to this text if you need to make a change.",
```

- [ ] **Step 6: The gate, the link appender, the copy, the templates**

`apps/web/src/lib/automations/no-show-nudge-gate.ts`:

```ts
import { NO_SHOW_NUDGE_MAX_AGE_MS } from "@bis/db";
import {
  resolveAccountZone, isInMorningBand, isStrictlyEarlierLocalDay,
} from "@/lib/booking/followup-timing";

/**
 * WHEN a no-show nudge may be sent — the pure half of the no-show pass.
 * The follow-up gate's shape exactly (the same two predicates), with the
 * follow-up's own 37h cap (NO_SHOW_NUDGE_MAX_AGE_MS, derived in
 * packages/db) and nothing to defer to: listDueFollowups excludes no_show,
 * so the two never meet.
 *
 * `anchor` is laterOf(ends_at, no_show_at) (anchor.ts) — the pass computes
 * it. Rules, all of which must hold:
 *  0. A zone we can resolve — else FAIL CLOSED.
 *  1. Not stale: the anchor is within 37h.
 *  2. Morning band, 08:00-11:00 in the account's zone.
 *  3. The anchor fell on a strictly EARLIER local day — an operator marking
 *     no-shows at midnight does not text anyone at midnight.
 *
 * `no_show_nudged_at` does all the deduping; this gate has no memory.
 */
export function shouldSendNoShowNudgeNow(now: Date, anchor: Date, timezone: string): boolean {
  const elapsedMs = now.getTime() - anchor.getTime();
  if (!Number.isFinite(elapsedMs)) return false;
  if (elapsedMs < 0) return false;
  if (elapsedMs > NO_SHOW_NUDGE_MAX_AGE_MS) return false;

  const zone = resolveAccountZone(timezone);
  if (zone === null) return false;

  if (!isInMorningBand(now, zone)) return false;
  return isStrictlyEarlierLocalDay(anchor, now, zone);
}
```

`apps/web/src/lib/automations/sms-link.ts`:

```ts
/**
 * THE ONE PLACE a link is appended to an SMS body. Every settings-page
 * counter and every pass that sends a text with a link on the end calls
 * this with the same inputs, so the count the operator approves is the
 * count that sends — the preview-vs-send drift fixed twice on 2026-09-06
 * cannot recur by construction. No template tokens: the operator writes
 * prose, the link goes on the end, always.
 *
 * An empty link yields the body alone — what a counter shows before the
 * link exists, and what a send never does (each pass refuses first).
 */
export function withTrailingLink(body: string, link: string): string {
  return [body.trim(), link.trim()].filter(Boolean).join(" ");
}
```

`apps/web/src/lib/automations/review-request-copy.ts` — add `import { withTrailingLink } from "./sms-link";` and replace `composeReviewRequestSms`'s body with `return withTrailingLink(body, reviewUrl);`, keeping its doc comment but replacing its first sentence with `The review request's name for withTrailingLink (sms-link.ts).` Its test file is not edited; it stays green.

`apps/web/src/lib/automations/no-show-nudge-copy.ts`:

```ts
import { m } from "@/lib/messages";
import { withTrailingLink } from "./sms-link";

/**
 * What a customer receives when the operator has not written their own
 * nudge. `brandName` is the CUSTOMER-FACING name (brandDisplayName in
 * @bis/db) — the due-row carries only that. Blank name: the identifying
 * clause is dropped, never replaced with an invented noun. Function
 * replacement, not a plain string: a name containing `$&` would otherwise
 * be re-interpreted by String.replace.
 */
export function defaultNoShowNudgeBody(brandName: string): string {
  if (!brandName.trim()) return m["automations.noShow.defaultBodyNoName"];
  return m["automations.noShow.defaultBody"].replace("{name}", () => brandName);
}

/** The nudge's name for withTrailingLink: the settings counter and the pass
 *  both call it with the account's booking-page link. */
export function composeNoShowNudgeSms(body: string, bookingUrl: string): string {
  return withTrailingLink(body, bookingUrl);
}
```

`apps/web/src/lib/email/templates/prose-button.ts`:

```ts
import { shell, escapeHtml, button, type EmailBrand } from "./shell";

/**
 * The operator's prose as paragraphs, then ONE call to action as a button
 * — the shape the review request established, shared with the no-show
 * nudge so the two cannot drift. Blank lines are paragraph breaks (the
 * follow-up template's rule); the text part is composed from the same
 * paragraph list, never by stripping tags, and carries the bare link for
 * text-only clients.
 */
export function proseWithButton(
  brand: EmailBrand, body: string, href: string, label: string,
): { html: string; text: string } {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const html = shell(
    brand,
    paragraphs.map((p) => `<p style="margin:0 0 12px;">${escapeHtml(p)}</p>`).join("")
    + `<p style="margin:16px 0 0;">${button(brand, href, label)}</p>`,
  );
  const text = `${paragraphs.join("\n\n")}\n\n${href}`;
  return { html, text };
}
```

`apps/web/src/lib/email/templates/review-request.ts` — replace the function body (the type and doc comment stay) with:

```ts
export function reviewRequestEmail(input: ReviewRequestEmailInput):
  { subject: string; html: string; text: string } {
  const { html, text } = proseWithButton(input.brand, input.body, input.reviewUrl, "Leave a review");
  return { subject: `Would you leave ${input.brand.name} a review?`, html, text };
}
```
and change its import line to `import { proseWithButton } from "./prose-button";` plus `import type { EmailBrand } from "./shell";`. Its test file is not edited; it stays green.

`apps/web/src/lib/email/templates/no-show-nudge.ts`:

```ts
import { proseWithButton } from "./prose-button";
import type { EmailBrand } from "./shell";

export type NoShowNudgeEmailInput = {
  brand: EmailBrand;
  /** Already defaulted by the caller (the pass). */
  body: string;
  /** The account's public booking page, `${origin}/b/${public_id}` — built
   *  by the pass from ctx.origin, never configured. */
  bookingUrl: string;
};

/**
 * The nudge the morning after a no-show: the operator's paragraphs, then
 * the booking page as the one button. Restrained on purpose — it reads as
 * "we're still here", not as a marketing blast.
 */
export function noShowNudgeEmail(input: NoShowNudgeEmailInput):
  { subject: string; html: string; text: string } {
  const { html, text } = proseWithButton(input.brand, input.body, input.bookingUrl, "Pick a new time");
  return { subject: `Want to pick a new time with ${input.brand.name}?`, html, text };
}
```

- [ ] **Step 7: Run everything touched, prove the two untouched test files, commit**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations src/lib/email/templates src/lib/messages > /c/Users/danlo/AppData/Local/Temp/claude/t5.txt 2>&1; echo "exit=$?"; tail -5 /c/Users/danlo/AppData/Local/Temp/claude/t5.txt
cd /c/Users/danlo/bis-platform && git diff main --stat -- apps/web/src/lib/automations/review-request-copy.test.ts apps/web/src/lib/email/templates/review-request.test.ts; echo "stat-above (expect empty)"
```
Expected: `exit=0`; gate 8, copy 7, template 4, review copy 7 (unchanged), review template 3 (unchanged). If the MEASURED count is not 133, the copy in `messages.ts` differs from this plan's — fix the copy, never the number. Mutations: (a) in the gate, `isStrictlyEarlierLocalDay` → `anchor.getTime() < now.getTime()` → the Chicago/New York pair fails on its New York half; (b) `NO_SHOW_NUDGE_MAX_AGE_MS` = 36h in packages/db → the Troll test and the constants test fail. Revert.

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-b" ] && git add apps/web/src/lib/automations/no-show-nudge-gate.ts apps/web/src/lib/automations/no-show-nudge-gate.test.ts apps/web/src/lib/automations/sms-link.ts apps/web/src/lib/automations/review-request-copy.ts apps/web/src/lib/automations/no-show-nudge-copy.ts apps/web/src/lib/automations/no-show-nudge-copy.test.ts apps/web/src/lib/email/templates/prose-button.ts apps/web/src/lib/email/templates/review-request.ts apps/web/src/lib/email/templates/no-show-nudge.ts apps/web/src/lib/email/templates/no-show-nudge.test.ts apps/web/src/lib/messages.ts && git commit -q -m "feat(automations): no-show nudge gate (37h, Troll-pinned), copy (segments measured), email; link appender and prose+button shared with the review request, whose tests stay untouched" && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 6: The no-show nudge pass — registered, capped, fail-closed, dead-link-proof, and the sentinel

**Files:**
- Create: `apps/web/src/lib/automations/passes/no-show-nudge.ts` + `.test.ts`
- Modify: `apps/web/src/lib/automations/registry.ts`
- Modify: `apps/web/src/lib/automations/sentinel.test.ts` (mocks, fixture rows, two assertions)
- Modify: `apps/web/src/lib/automations/imports.test.ts` (one filename)
- Modify: `apps/web/src/app/api/cron/reminders/route.test.ts` — ONLY: new mock lines, a new `EMPTY_NO_SHOW_NUDGES` const, `noShowNudges: EMPTY_NO_SHOW_NUDGES` on the strict-equality bodies

**Interfaces:**
- Consumes: `listDueNoShowNudges`, `stampNoShowNudged`, `stampNoShowNudgeSmsFailed`, `countNoShowNudgesSince`, `DueNoShowNudge` (Task 2); `laterOf` (Task 4); `shouldSendNoShowNudgeNow`, `composeNoShowNudgeSms`, `defaultNoShowNudgeBody`, `noShowNudgeEmail` (Task 5); `sendAutomationSms`, `markAutomationSmsSent`, `smsCooldownActive` (Task 3); `emailBrandNamed`, `normalizeReplyTo`, `resolveSmsSender`, `toE164`, `resolveAccountZone`, `stampWithRetry`, the caps.
- Produces: `noShowNudgePass` (key `"noShowNudges"`, counters `{ sent, failed, unstamped, skippedInvalidConfig, skippedNoAddress, skippedSmsGate, skippedRecentFailure, skippedCap, skippedCalendarOff, waitingForMorning, unresolvableTimezone }`); `PASSES = [remindersPass, followupsPass, reviewRequestPass, noShowNudgePass]`.

- [ ] **Step 1: Write the failing pass tests**

`apps/web/src/lib/automations/passes/no-show-nudge.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueNoShowNudge } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueNoShowNudges: vi.fn(), stampNoShowNudged: vi.fn(), stampNoShowNudgeSmsFailed: vi.fn(),
  countNoShowNudgesSince: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
}));
// importOriginal keeps NO_SHOW_NUDGE_MAX_AGE_MS and the types real.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));

import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP } from "../caps";
import type { PassContext } from "../context";
import { noShowNudgePass } from "./no-show-nudge";

const STAMP_ATTEMPTS = STAMP_RETRY_DELAYS_MS.length + 1;
const TICK = new Date("2026-09-09T14:00:00Z");   // NY 10:00 Wed · CHI 09:00 Wed
const ORIGIN = "https://app.example.com";
const URL = `${ORIGIN}/b/cal_pub_1`;

/** Distinctive, complete fixture. NO accountName — the type does not have one. */
function row(overrides: Partial<DueNoShowNudge> = {}): DueNoShowNudge {
  return {
    bookingId: "bk_n1", accountId: "acct_1",
    endsAt: "2026-09-08T20:00:00.000Z",           // NY Tue 16:00 — the previous local day
    noShowAt: "2026-09-08T20:30:00.000Z",         // NY Tue 16:30
    smsFailedAt: null,
    contactId: "ct_1", contactEmail: "booker@example.com", contactPhone: "(956) 555-0101",
    calendarPublicId: "cal_pub_1", calendarEnabled: true,
    brandName: "Rio Roofing",
    branding: {
      brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null,
      replyToEmail: "wrong-should-not-be-used@rioroofing.com",
    },
    accountTimezone: "America/New_York",
    fromEmail: "hello@rioroofing.com", replyToEmail: "owner@rioroofing.com",
    body: "", config: { channel: "email" },
    ...overrides,
  };
}
const sms = (overrides: Partial<DueNoShowNudge> = {}) => row({ config: { channel: "sms" }, ...overrides });

const emailSend = vi.fn();
const smsSend = vi.fn();
function ctx(): PassContext {
  return {
    db: {} as never, now: TICK, origin: ORIGIN,
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }),
  };
}
const EMPTY = {
  sent: 0, failed: 0, unstamped: 0, skippedInvalidConfig: 0, skippedNoAddress: 0,
  skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0, skippedCalendarOff: 0,
  waitingForMorning: 0, unresolvableTimezone: 0,
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueNoShowNudges.mockResolvedValue([]);
  dbMocks.stampNoShowNudged.mockResolvedValue(undefined);
  dbMocks.stampNoShowNudgeSmsFailed.mockResolvedValue(undefined);
  dbMocks.countNoShowNudgesSince.mockResolvedValue(0);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("no-show nudge pass — email channel", () => {
  it("sends with the brand name and the company's from/reply-to, the booking page as the link, then stamps", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row()]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const sent = emailSend.mock.calls[0]![0] as Record<string, string>;
    expect(sent.to).toBe("booker@example.com");
    expect(sent.fromName).toBe("Rio Roofing");
    expect(sent.fromAddress).toBe("hello@rioroofing.com");
    expect(sent.replyTo).toBe("owner@rioroofing.com");
    expect(sent.subject).toBe("Want to pick a new time with Rio Roofing?");
    expect(sent.body).toContain("We missed you for your appointment with Rio Roofing.");
    expect(sent.body).toContain(URL);                          // Mutation: build the link off a hard-coded origin
    expect(sent.html).toContain(`href="${URL}"`);
    expect(dbMocks.stampNoShowNudged).toHaveBeenCalledWith(expect.anything(), "bk_n1");
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("uses the operator's own body when one is stored", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ body: "Sorry we missed each other!" })]);
    await noShowNudgePass.run(ctx());
    expect((emailSend.mock.calls[0]![0] as { body: string }).body).toMatch(/^Sorry we missed each other!/);
  });

  it("send-then-stamp: a send that throws is counted failed and NOT stamped", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row()]);
    emailSend.mockRejectedValueOnce(new Error("provider down"));
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalled();
    expect(dbMocks.stampNoShowNudgeSmsFailed).not.toHaveBeenCalled();   // email: no marker
  });

  it("retries a transient stamp failure; exhausted retries count unstamped while still sent", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row()]);
    dbMocks.stampNoShowNudged.mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(undefined);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampNoShowNudged).toHaveBeenCalledTimes(2);
    expect(emailSend).toHaveBeenCalledTimes(1);

    dbMocks.stampNoShowNudged.mockReset().mockRejectedValue(new Error("db unavailable"));
    emailSend.mockClear();
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1, unstamped: 1 });
    expect(dbMocks.stampNoShowNudged).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
  });
});

describe("no-show nudge pass — SMS channel", () => {
  it("gate → message row → send → STAMP → mark sent, with the composed body (link on the end) everywhere", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms()]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const composed = `We missed you for your appointment with Rio Roofing. If you'd like to pick a new time, book here: ${URL}`;
    expect(senderMock.resolveSmsSender).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: composed }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: composed });
    expect(dbMocks.stampNoShowNudged).toHaveBeenCalledWith(expect.anything(), "bk_n1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    expect(dbMocks.stampNoShowNudged.mock.invocationCallOrder[0]!)
      .toBeLessThan(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!);   // stamp BEFORE mark-sent
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("when the sender gate refuses, skips and counts it — and does NOT fall back to email", async () => {
    // Mutation: send the email on the refusal branch.
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms()]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedSmsGate: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a gate READ error fails that row and keeps the pass's counters", async () => {
    senderMock.resolveSmsSender.mockRejectedValue(new Error("phone_numbers read failed"));
    dbMocks.listDueNoShowNudges.mockResolvedValue([row(), sms()]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1, failed: 1 });
  });

  it("consults the gate ONCE per account per tick", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms(), sms({ bookingId: "bk_n2", contactId: "ct_2" })]);
    await noShowNudgePass.run(ctx());
    expect(senderMock.resolveSmsSender).toHaveBeenCalledTimes(1);
  });

  it("a phone that cannot be normalised is no deliverable address: skipped, gate not consulted", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms({ contactPhone: "12" })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
    expect(senderMock.resolveSmsSender).not.toHaveBeenCalled();
  });

  it("a provider failure marks the row failed, writes the nudge's attempt marker, counts failed, stamps nothing", async () => {
    // Mutation: drop `onProviderFailure`.
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms()]);
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier timeout" }, "automation", "system");
    expect(dbMocks.stampNoShowNudgeSmsFailed).toHaveBeenCalledWith(expect.anything(), "bk_n1");
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalled();
  });

  it("a marker younger than 24h holds the booking: counted, nothing written, caps untouched", async () => {
    // Mutation: remove the smsCooldownActive check.
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms({ smsFailedAt: new Date(TICK.getTime() - 60 * 60 * 1000).toISOString() })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedRecentFailure: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.countNoShowNudgesSince).not.toHaveBeenCalled();
  });

  it("the EMAIL channel ignores the marker", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ smsFailedAt: TICK.toISOString() })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });
});

describe("no-show nudge pass — fail closed, each case its own counter", () => {
  it("an invalid stored config sends nothing and is counted", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ config: null })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedInvalidConfig: 1 });
  });

  it("no email on the contact for the email channel is skippedNoAddress", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ contactEmail: null })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
  });

  it("an unresolvable account timezone is held and counted under its own name", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
  });

  it("a booking page that is switched off is skipped and counted — no dead link goes out — but only once its morning arrives", async () => {
    // Mutation: check calendarEnabled before the gate and the second case
    // reports skippedCalendarOff instead of waitingForMorning (96 log lines
    // a day for a row that was never going to send this tick).
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ calendarEnabled: false })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedCalendarOff: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalled();
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ calendarEnabled: false, accountTimezone: "America/Los_Angeles" })]);   // LA 07:00: dawn
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, waitingForMorning: 1 });
  });

  it("THE CLOCK through the pass: marked 00:30 today in New York holds, the same instant 23:30 yesterday in Chicago sends", async () => {
    // Mutation: hand the gate `new Date(row.endsAt)` and both halves send.
    const marked = "2026-09-09T04:30:00.000Z";
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ noShowAt: marked, accountTimezone: "America/New_York" })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, waitingForMorning: 1 });
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ noShowAt: marked, accountTimezone: "America/Chicago" })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("a pre-0026 row (noShowAt null) runs from ends_at", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ noShowAt: null })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });
});

describe("no-show nudge pass — capped, like every recipe pass that a bulk status change can burst", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row({ bookingId: `bk_${i}`, contactId: `ct_${i}` }));

  it("per tick: N+1 eligible rows send N and skip one, which is NOT stamped", async () => {
    // Mutation: AUTOMATION_TICK_CAP = Infinity.
    dbMocks.listDueNoShowNudges.mockResolvedValue(many(AUTOMATION_TICK_CAP + 1));
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: AUTOMATION_TICK_CAP, skippedCap: 1 });
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalledWith(expect.anything(), `bk_${AUTOMATION_TICK_CAP}`);
  });

  it("per account per day: 24 already sent in the last 24h leaves room for exactly one, counted off no_show_nudged_at", async () => {
    // Mutation: AUTOMATION_DAILY_CAP = Infinity; or count off the review stamp.
    dbMocks.countNoShowNudgesSince.mockResolvedValue(AUTOMATION_DAILY_CAP - 1);
    dbMocks.listDueNoShowNudges.mockResolvedValue(many(3));
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedCap: 2 });
    expect(dbMocks.countNoShowNudgesSince).toHaveBeenCalledTimes(1);
    expect(dbMocks.countNoShowNudgesSince).toHaveBeenCalledWith(expect.anything(), "acct_1",
      new Date(TICK.getTime() - 24 * 60 * 60 * 1000).toISOString());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/passes/no-show-nudge.test.ts 2>&1 | grep -E "Failed to resolve|passed|failed" | head -3
```
Expected: FAIL — `./no-show-nudge` cannot be resolved.

- [ ] **Step 3: Write the pass**

`apps/web/src/lib/automations/passes/no-show-nudge.ts`:

```ts
import {
  listDueNoShowNudges, stampNoShowNudged, stampNoShowNudgeSmsFailed, countNoShowNudgesSince,
  type DueNoShowNudge,
} from "@bis/db";
import { emailBrandNamed } from "@/lib/email/templates/shell";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { noShowNudgeEmail } from "@/lib/email/templates/no-show-nudge";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { laterOf } from "../anchor";
import { shouldSendNoShowNudgeNow } from "../no-show-nudge-gate";
import { composeNoShowNudgeSms, defaultNoShowNudgeBody } from "../no-show-nudge-copy";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP, DAILY_CAP_WINDOW_MS } from "../caps";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive, type SentSms } from "../send-sms";
import type { Pass, PassContext } from "../context";

type Target =
  | { channel: "sms"; to: string; from: string }
  | { channel: "email"; to: string };

/**
 * No-show → rebooking nudge, the morning after. Trigger is a human: the
 * operator's "Mark no-show". Per row, in this order, each refusal counted
 * under its own name:
 *   invalid config → unresolvable zone → not this morning (the gate, run
 *   from laterOf(ends_at, no_show_at)) → booking page switched off → no
 *   deliverable address → SMS gate refused (NO fallback to email) → SMS
 *   cooldown → caps → send → STAMP → (sms) mark the message row sent.
 *
 * The link is the account's own booking page — `${ctx.origin}/b/<public
 * id>`, the same origin every customer link carries — never configured.
 * `skippedCalendarOff` sits AFTER the gate on purpose: a row that was never
 * going to send this tick is not logged 96 times a day.
 */
export const noShowNudgePass: Pass = {
  key: "noShowNudges",
  async run(ctx) {
    const c = {
      sent: 0, failed: 0, unstamped: 0,
      skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0,
      skippedCap: 0, skippedCalendarOff: 0,
      waitingForMorning: 0, unresolvableTimezone: 0,
    };
    const due = await listDueNoShowNudges(ctx.db, ctx.now.toISOString());

    const smsGates = new Map<string, SmsGate>();
    const sentToday = new Map<string, number>();
    let attemptsThisTick = 0;

    for (const row of due) {
      const config = row.config;
      if (config === null) {
        c.skippedInvalidConfig++;
        console.error(
          `no-show nudge skipped for booking ${row.bookingId}: account ${row.accountId}'s `
          + `no_show_nudge config is missing or invalid — pick a channel in Automations`,
        );
        continue;
      }

      if (resolveAccountZone(row.accountTimezone) === null) {
        c.unresolvableTimezone++;
        console.error(
          `no-show nudge HELD for booking ${row.bookingId}: account ${row.accountId}'s timezone `
          + `${JSON.stringify(row.accountTimezone)} is not a zone we can resolve — fix the account's timezone`,
        );
        continue;
      }

      // THE CLOCK (0026): the later of the meeting end and "Mark no-show".
      const anchor = laterOf(new Date(row.endsAt), row.noShowAt ? new Date(row.noShowAt) : null);
      if (!shouldSendNoShowNudgeNow(ctx.now, anchor, row.accountTimezone)) {
        c.waitingForMorning++;
        continue;
      }

      if (!row.calendarEnabled) {
        c.skippedCalendarOff++;
        console.error(
          `no-show nudge skipped for booking ${row.bookingId}: account ${row.accountId}'s booking page `
          + `is switched off, so the rebook link would 404 — turn the calendar on`,
        );
        continue;
      }

      let target: Target;
      if (config.channel === "sms") {
        const to = toE164(row.contactPhone);
        if (!to) {
          c.skippedNoAddress++;
          console.error(`no-show nudge skipped, no textable phone on file for booking ${row.bookingId}`);
          continue;
        }
        let gate = smsGates.get(row.accountId);
        if (!gate) {
          try {
            gate = await resolveSmsSender(ctx.db, row.accountId);
          } catch (e) {
            c.failed++;
            console.error(`no-show nudge: sms gate read failed for account ${row.accountId}: ${String(e)}`);
            continue;
          }
          smsGates.set(row.accountId, gate);
        }
        if (!gate.ok) {
          c.skippedSmsGate++;
          console.error(
            `no-show nudge skipped for booking ${row.bookingId}: account ${row.accountId} cannot text `
            + `(${gate.reason}) — not falling back to email`,
          );
          continue;
        }
        if (smsCooldownActive(row.smsFailedAt, ctx.now)) {
          c.skippedRecentFailure++;
          continue;
        }
        target = { channel: "sms", to, from: gate.from };
      } else {
        if (!row.contactEmail) {
          c.skippedNoAddress++;
          console.error(`no-show nudge skipped, no contact email on file for booking ${row.bookingId}`);
          continue;
        }
        target = { channel: "email", to: row.contactEmail };
      }

      // CAPS (caps.ts): a bulk "Mark no-show" is exactly the burst these guard.
      if (attemptsThisTick >= AUTOMATION_TICK_CAP) {
        c.skippedCap++;
        continue;
      }
      let today = sentToday.get(row.accountId);
      if (today === undefined) {
        today = await countNoShowNudgesSince(
          ctx.db, row.accountId, new Date(ctx.now.getTime() - DAILY_CAP_WINDOW_MS).toISOString(),
        );
        sentToday.set(row.accountId, today);
      }
      if (today >= AUTOMATION_DAILY_CAP) {
        c.skippedCap++;
        continue;
      }
      attemptsThisTick++;
      sentToday.set(row.accountId, today + 1);

      const body = row.body.trim() || defaultNoShowNudgeBody(row.brandName);
      const bookingUrl = `${ctx.origin}/b/${row.calendarPublicId}`;

      let smsRow: SentSms | null = null;
      try {
        if (target.channel === "sms") {
          smsRow = await sendAutomationSms(ctx, {
            accountId: row.accountId, contactId: row.contactId, to: target.to, from: target.from,
            body: composeNoShowNudgeSms(body, bookingUrl),
            onProviderFailure: () => stampNoShowNudgeSmsFailed(ctx.db, row.bookingId),
          });
        } else {
          await sendEmail(ctx, row, target.to, body, bookingUrl);
        }
      } catch (e) {
        c.failed++;
        console.error(`no-show nudge send failed for booking ${row.bookingId}: ${String(e)}`);
        continue;
      }

      // SEND-THEN-STAMP, stamp before the SMS row's status update.
      const stamp = await stampWithRetry(() => stampNoShowNudged(ctx.db, row.bookingId));
      if (!stamp.stamped) {
        c.unstamped++;
        console.error(
          `no-show nudge sent but NOT stamped for booking ${row.bookingId} after `
          + `${stamp.attempts} attempts — expect up to 11 more copies before the morning band `
          + `closes: ${String(stamp.lastError)}`,
        );
      }
      c.sent++;

      if (smsRow) await markAutomationSmsSent(ctx, row.accountId, smsRow, "no-show nudge");
    }

    return c;
  },
};

async function sendEmail(
  ctx: PassContext, row: DueNoShowNudge, to: string, body: string, bookingUrl: string,
): Promise<void> {
  const brand = emailBrandNamed(row.branding, row.brandName);
  const { subject, html, text } = noShowNudgeEmail({ brand, body, bookingUrl });
  await ctx.email.send({
    to,
    fromName: brand.name,
    fromAddress: row.fromEmail ?? undefined,
    replyTo: normalizeReplyTo(row.replyToEmail),   // the row's OWN top-level replyToEmail
    subject,
    body: text,
    html,
  });
}
```

- [ ] **Step 4: Register it; extend the sentinel, the fixture guard, and `route.test.ts`**

`apps/web/src/lib/automations/registry.ts` — add `import { noShowNudgePass } from "./passes/no-show-nudge";` and:
```ts
export const PASSES: readonly Pass[] = [remindersPass, followupsPass, reviewRequestPass, noShowNudgePass];
```

`apps/web/src/lib/automations/imports.test.ts` — add `"passes/no-show-nudge.ts"` to the `arrayContaining` list.

`apps/web/src/lib/automations/sentinel.test.ts`:
(a) `dbMocks` gains: `listDueNoShowNudges: vi.fn(), stampNoShowNudged: vi.fn(), stampNoShowNudgeSmsFailed: vi.fn(), countNoShowNudgesSince: vi.fn(), stampReviewRequestSmsFailed: vi.fn(),`
(b) In `beforeEach`, after the review rows, add:
```ts
  const nudge = {
    accountId: "acct_1", endsAt: "2026-09-08T20:00:00.000Z", noShowAt: "2026-09-08T20:30:00.000Z", smsFailedAt: null,
    calendarPublicId: "cal_pub_1", calendarEnabled: true, brandName: BRAND, branding,
    accountTimezone: "America/New_York", fromEmail: null, replyToEmail: null, body: "",
  };
  dbMocks.listDueNoShowNudges.mockResolvedValue([
    { ...nudge, bookingId: "bk_ns_email", contactId: "ct_3", contactEmail: "d@example.com", contactPhone: null, config: { channel: "email" } },
    { ...nudge, bookingId: "bk_ns_sms", contactId: "ct_4", contactEmail: null, contactPhone: "9565550102", config: { channel: "sms" } },
  ]);
  dbMocks.countNoShowNudgesSince.mockResolvedValue(0);
```
Also, the two review rows in the sentinel fixture must now carry `completedAt: null, smsFailedAt: null` (add both to the `review` object) — the type requires them after Task 2.
(c) In the sentinel test, after `expect(results.reviewRequests?.sent).toBe(2);` add `expect(results.noShowNudges?.sent).toBe(2);`; and the registry-order test becomes:
```ts
    expect(PASSES.map((p) => p.key)).toEqual(["reminders", "followups", "reviewRequests", "noShowNudges"]);
```

`apps/web/src/app/api/cron/reminders/route.test.ts` — additions only:
(a) inside the `vi.mock("@bis/db", …)` factory, after the `stampReviewRequestSmsFailed` line:
```ts
  // The no-show nudge pass (Milestone B): same shape, one idle read.
  listDueNoShowNudges: async () => [],
  stampNoShowNudged: async () => undefined,
  stampNoShowNudgeSmsFailed: async () => undefined,
  countNoShowNudgesSince: async () => 0,
  NO_SHOW_NUDGE_MAX_AGE_MS: 37 * 60 * 60 * 1000,
```
(b) after `EMPTY_REVIEW_REQUESTS`:
```ts
const EMPTY_NO_SHOW_NUDGES = {
  sent: 0, failed: 0, unstamped: 0, skippedInvalidConfig: 0, skippedNoAddress: 0,
  skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0, skippedCalendarOff: 0,
  waitingForMorning: 0, unresolvableTimezone: 0,
};
```
(c) the strict-equality bodies — five inline and two multi-line:
```bash
cd /c/Users/danlo/bis-platform/apps/web && sed -i 's/reviewRequests: EMPTY_REVIEW_REQUESTS })/reviewRequests: EMPTY_REVIEW_REQUESTS, noShowNudges: EMPTY_NO_SHOW_NUDGES })/' src/app/api/cron/reminders/route.test.ts && sed -i 's/^      reviewRequests: EMPTY_REVIEW_REQUESTS,$/      reviewRequests: EMPTY_REVIEW_REQUESTS,\n      noShowNudges: EMPTY_NO_SHOW_NUDGES,/' src/app/api/cron/reminders/route.test.ts && grep -c "noShowNudges: EMPTY_NO_SHOW_NUDGES" src/app/api/cron/reminders/route.test.ts
```
Expected: `7`. Then:
```bash
cd /c/Users/danlo/bis-platform && git diff -- apps/web/src/app/api/cron/reminders/route.test.ts | grep -E "^-[^-]"; echo "removed-lines-above (expect: only the 5 one-line bodies that gained the key, as -/+ pairs)"
```

- [ ] **Step 5: Run the automations tree and the route tests, typecheck, lint**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations src/app/api/cron > /c/Users/danlo/AppData/Local/Temp/claude/t6.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/t6.txt
cd /c/Users/danlo/bis-platform && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t6b.txt 2>&1; echo "exit=$?"; pnpm lint > /c/Users/danlo/AppData/Local/Temp/claude/t6c.txt 2>&1; echo "exit=$?"
```
Expected: all `exit=0`; no-show pass 19 passed, sentinel 2, imports 2, route 30, everything else as before.

- [ ] **Step 6: Mutation pass (record in the commit message)**

(a) On the gate's refusal branch call `sendEmail` → "does NOT fall back to email"; (b) `AUTOMATION_TICK_CAP = Infinity` → "per tick"; (c) `AUTOMATION_DAILY_CAP = Infinity` → "per account per day"; (d) hand the gate `new Date(row.endsAt)` → "THE CLOCK through the pass" (both halves send); (e) move the `calendarEnabled` check above the gate → the LA half of the calendar-off test; (f) build `bookingUrl` from `"https://app.bis-rgv.com"` → the email test's link assertion; (g) in `passes/no-show-nudge.ts` pass `row.branding.brandName + " — trial"`… no: instead, in the sentinel fixture set `brandName: INTERNAL_LABEL` on the nudge rows → the sentinel fails, proving it scans this pass. Revert each.

- [ ] **Step 7: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-b" ] && git add apps/web/src/lib/automations/passes/no-show-nudge.ts apps/web/src/lib/automations/passes/no-show-nudge.test.ts apps/web/src/lib/automations/registry.ts apps/web/src/lib/automations/sentinel.test.ts apps/web/src/lib/automations/imports.test.ts apps/web/src/app/api/cron/reminders/route.test.ts && git commit -q -m "feat(automations): no-show nudge pass — morning-after gate on laterOf(ends_at, no_show_at), booking-page link, no email fallback, capped, cooldown, sentinel

route.test.ts gains only the noShowNudges key + mocks. Mutation-checked: fallback, both caps, the clock, calendar-off ordering, the origin, the sentinel." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 7: The ~2h SMS reminder — copy, the pass (uncapped, no gate), the coupling test

**Files:**
- Create: `apps/web/src/lib/automations/sms-reminder-copy.ts` + `.test.ts`
- Create: `apps/web/src/lib/automations/passes/sms-reminder.ts` + `.test.ts`
- Modify: `apps/web/src/lib/automations/registry.ts`
- Modify: `apps/web/src/lib/automations/sentinel.test.ts` (mocks, one fixture row, two assertions)
- Modify: `apps/web/src/lib/automations/imports.test.ts` (one filename)
- Modify: `apps/web/src/lib/automations/cron-coupling.test.ts` (imports + four tests)
- Modify: `apps/web/src/app/api/cron/reminders/route.test.ts` — ONLY: new mock lines, `EMPTY_SMS_REMINDERS`, `smsReminders: EMPTY_SMS_REMINDERS` on the strict bodies

**Interfaces:**
- Consumes: `listDueSmsReminders`, `stampSmsReminderSent`, `stampSmsReminderFailed`, `DueSmsReminder`, `SMS_REMINDER_WINDOW_START_MS`, `SMS_REMINDER_WINDOW_END_MS` (Task 2); `safeZone`, `formatWhen` (`@/lib/booking/time`); `resolveSmsSender`, `toE164`, `stampWithRetry`; `sendAutomationSms`, `markAutomationSmsSent`, `smsCooldownActive` (Task 3); `SMS_RETRY_COOLDOWN_MS`.
- Produces:
  - `smsReminderLead(brandName: string, whenText: string): string`; `defaultSmsReminderBody(): string`; `composeSmsReminder(brandName: string, whenText: string, body: string): string`; `SMS_REMINDER_PREVIEW_INSTANT: Date`
  - `smsReminderPass` (key `"smsReminders"`, counters `{ sent, failed, unstamped, skippedNoAddress, skippedSmsGate, skippedRecentFailure }`); `PASSES = [remindersPass, followupsPass, reviewRequestPass, noShowNudgePass, smsReminderPass]`.

- [ ] **Step 1: Confirm the rendered times with Intl first**

```bash
node -e 'const fw=(d,z)=>new Intl.DateTimeFormat("en-US",{timeZone:z,weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}).format(new Date(d));for(const [d,z] of [["2026-09-30T17:30:00Z","America/Chicago"],["2026-09-09T16:00:00Z","America/Los_Angeles"],["2026-09-09T16:00:00Z","America/New_York"]])console.log(d,z,JSON.stringify(fw(d,z)))'
```
Expected:
```
2026-09-30T17:30:00Z America/Chicago "Wed, Sep 30, 12:30 PM CDT"
2026-09-09T16:00:00Z America/Los_Angeles "Wed, Sep 9, 9:00 AM PDT"
2026-09-09T16:00:00Z America/New_York "Wed, Sep 9, 12:00 PM EDT"
```

- [ ] **Step 2: Write the failing copy tests**

`apps/web/src/lib/automations/sms-reminder-copy.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { segmentsFor } from "@/lib/sms/segments";
import { formatWhen } from "@/lib/booking/time";
import {
  smsReminderLead, defaultSmsReminderBody, composeSmsReminder, SMS_REMINDER_PREVIEW_INSTANT,
} from "./sms-reminder-copy";

const WHEN = "Wed, Sep 30, 12:30 PM CDT";

describe("smsReminderLead — the time is never the operator's to place", () => {
  it("names the company and carries the rendered time", () => {
    expect(smsReminderLead("Rio Roofing", WHEN)).toBe(`Reminder: your appointment with Rio Roofing is ${WHEN}.`);
  });

  it("drops the identifying clause for a blank name instead of inventing one", () => {
    expect(smsReminderLead("  ", WHEN)).toBe(`Reminder: your appointment is ${WHEN}.`);
  });

  it("inserts a name containing $ patterns literally", () => {
    expect(smsReminderLead("A$&B", WHEN)).toContain("with A$&B is");
  });
});

describe("composeSmsReminder — lead, one space, the operator's prose", () => {
  it("is the lead followed by the trimmed body; the lead alone when the body is empty", () => {
    expect(composeSmsReminder("Rio Roofing", WHEN, "  See you soon!  ")).toBe(`Reminder: your appointment with Rio Roofing is ${WHEN}. See you soon!`);
    expect(composeSmsReminder("Rio Roofing", WHEN, "")).toBe(`Reminder: your appointment with Rio Roofing is ${WHEN}.`);
  });

  it("MEASURED: the default with a GSM-7 name is ONE segment at the widest common date width", () => {
    // Mutation: count the operator's body alone and this still passes —
    // which is why automations.spec.ts feeds the page's counter the composed
    // string.
    const s = segmentsFor(composeSmsReminder("Rio Roofing", WHEN, defaultSmsReminderBody()));
    expect(s.encoding).toBe("gsm7");
    expect(s.segments).toBe(1);
    expect(s.chars).toBe(122);
  });

  it("MEASURED: an accented company name flips the whole message to UCS-2 and costs TWO segments", () => {
    const s = segmentsFor(composeSmsReminder("García Roofing", WHEN, defaultSmsReminderBody()));
    expect(s.encoding).toBe("ucs2");
    expect(s.segments).toBe(2);
  });

  it("the preview instant renders at the widest common width, so the count the operator sees is not optimistic", () => {
    expect(formatWhen(SMS_REMINDER_PREVIEW_INSTANT, "America/Chicago")).toBe(WHEN);
  });
});
```

- [ ] **Step 3: Write the failing pass tests**

`apps/web/src/lib/automations/passes/sms-reminder.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueSmsReminder } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueSmsReminders: vi.fn(), stampSmsReminderSent: vi.fn(), stampSmsReminderFailed: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));

import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";
import { formatWhen } from "@/lib/booking/time";
import { AUTOMATION_TICK_CAP } from "../caps";
import type { PassContext } from "../context";
import { smsReminderPass } from "./sms-reminder";

const STAMP_ATTEMPTS = STAMP_RETRY_DELAYS_MS.length + 1;
const TICK = new Date("2026-09-09T14:00:00Z");
const STARTS = "2026-09-09T16:00:00.000Z";   // 2h after the tick; LA 9:00 AM PDT · NY 12:00 PM EDT

/** Distinctive, complete fixture. Booker in Los Angeles, account in New York:
 *  the two zones render DIFFERENT strings for the same instant, so a pass
 *  that used the wrong one cannot pass by coincidence. */
function row(overrides: Partial<DueSmsReminder> = {}): DueSmsReminder {
  return {
    bookingId: "bk_s1", accountId: "acct_1", startsAt: STARTS,
    bookerTimezone: "America/Los_Angeles", smsFailedAt: null,
    contactId: "ct_1", contactPhone: "(956) 555-0101",
    brandName: "Rio Roofing", accountTimezone: "America/New_York",
    body: "",
    ...overrides,
  };
}

const smsSend = vi.fn();
const emailSend = vi.fn();
function ctx(): PassContext {
  return {
    db: {} as never, now: TICK, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }),
  };
}
const EMPTY = { sent: 0, failed: 0, unstamped: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0 };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueSmsReminders.mockResolvedValue([]);
  dbMocks.stampSmsReminderSent.mockResolvedValue(undefined);
  dbMocks.stampSmsReminderFailed.mockResolvedValue(undefined);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  emailSend.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sms reminder pass — the send", () => {
  it("texts the time in the BOOKER's zone, the default closing line, then stamps, then marks the row sent", async () => {
    // Mutation: format in the account zone and the string changes.
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const when = formatWhen(new Date(STARTS), "America/Los_Angeles");
    const composed = `Reminder: your appointment with Rio Roofing is ${when}. Reply to this text if you need to make a change.`;
    expect(when).not.toBe(formatWhen(new Date(STARTS), "America/New_York"));   // guards the fixture
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: composed }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: composed });
    expect(dbMocks.stampSmsReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_s1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    expect(dbMocks.stampSmsReminderSent.mock.invocationCallOrder[0]!)
      .toBeLessThan(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("falls back to the ACCOUNT's zone when the booker's is missing or junk, never to UTC", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ bookerTimezone: null }), row({ bookingId: "bk_s2", bookerTimezone: "Mars/Olympus" })]);
    await smsReminderPass.run(ctx());
    const whenNy = formatWhen(new Date(STARTS), "America/New_York");
    for (const call of smsSend.mock.calls) expect((call[0] as { body: string }).body).toContain(whenNy);
  });

  it("uses the operator's own closing line when one is stored", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ body: "See you soon!" })]);
    await smsReminderPass.run(ctx());
    expect((smsSend.mock.calls[0]![0] as { body: string }).body).toMatch(/PDT\. See you soon!$/);
  });

  it("send-then-stamp: a provider failure marks the row failed, writes the attempt marker, counts failed, stamps nothing", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier timeout" }, "automation", "system");
    expect(dbMocks.stampSmsReminderFailed).toHaveBeenCalledWith(expect.anything(), "bk_s1");
    expect(dbMocks.stampSmsReminderSent).not.toHaveBeenCalled();
  });

  it("retries a transient stamp failure; exhausted retries count unstamped while still sent", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    dbMocks.stampSmsReminderSent.mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(undefined);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(smsSend).toHaveBeenCalledTimes(1);
    dbMocks.stampSmsReminderSent.mockReset().mockRejectedValue(new Error("db unavailable"));
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, unstamped: 1 });
    expect(dbMocks.stampSmsReminderSent).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
  });
});

describe("sms reminder pass — fail closed, each case its own counter", () => {
  it("a phone that cannot be normalised is skipped, gate not consulted", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ contactPhone: null }), row({ bookingId: "bk_s2", contactPhone: "12" })]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 2 });
    expect(senderMock.resolveSmsSender).not.toHaveBeenCalled();
  });

  it("when the sender gate refuses, skips and counts — there is no other channel to fall to", async () => {
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "no_live_number" });
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, skippedSmsGate: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a gate READ error fails that row and keeps the pass's counters; the gate is consulted once per account", async () => {
    senderMock.resolveSmsSender.mockRejectedValueOnce(new Error("phone_numbers read failed")).mockResolvedValue({ ok: true, from: "+19565550000" });
    dbMocks.listDueSmsReminders.mockResolvedValue([row(), row({ bookingId: "bk_s2" })]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, failed: 1, sent: 1 });
    dbMocks.listDueSmsReminders.mockResolvedValue([row(), row({ bookingId: "bk_s2" })]);
    senderMock.resolveSmsSender.mockClear();
    await smsReminderPass.run(ctx());
    expect(senderMock.resolveSmsSender).toHaveBeenCalledTimes(1);
  });

  it("a marker younger than 24h holds the booking — with a 45-minute window that means one attempt, ever", async () => {
    // Mutation: remove the smsCooldownActive check.
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ smsFailedAt: new Date(TICK.getTime() - 15 * 60 * 1000).toISOString() })]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, skippedRecentFailure: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("constructs the SMS provider BEFORE writing the message row", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    const c: PassContext = { ...ctx(), sms: () => { throw new Error("TELNYX_API_KEY is required in production"); } };
    expect(await smsReminderPass.run(c)).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });
});

describe("sms reminder pass — UNCAPPED, like the email reminder it pairs with", () => {
  it("30 due reminders send 30: a reminder is one-to-one with a booking the customer made", async () => {
    // Mutation: apply AUTOMATION_TICK_CAP inside passes/sms-reminder.ts.
    dbMocks.listDueSmsReminders.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => row({ bookingId: `bk_${i}`, contactId: `ct_${i}` })));
    expect(30).toBeGreaterThan(AUTOMATION_TICK_CAP);   // guards the fixture
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, sent: 30 });
    expect(dbMocks.stampSmsReminderSent).toHaveBeenCalledTimes(30);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations/sms-reminder-copy.test.ts src/lib/automations/passes/sms-reminder.test.ts 2>&1 | grep -E "Failed to resolve|passed|failed" | head -3
```
Expected: FAIL — both modules missing.

- [ ] **Step 5: The copy module and the pass**

`apps/web/src/lib/automations/sms-reminder-copy.ts`:

```ts
import { m } from "@/lib/messages";

/**
 * The text reminder's LEAD: the appointment time, rendered by formatWhen in
 * the BOOKER's zone (the email reminder's rule), inside a fixed sentence the
 * operator cannot rearrange. `brandName` is the customer-facing name (the
 * due-row carries only that); a blank one drops the clause, never invents
 * a noun. Function replacement, not a plain string, for names with `$&`.
 */
export function smsReminderLead(brandName: string, whenText: string): string {
  const template = brandName.trim()
    ? m["automations.smsReminder.lead"].replace("{name}", () => brandName)
    : m["automations.smsReminder.leadNoName"];
  return template.replace("{when}", () => whenText);
}

/** The closing line sent when the operator has not written their own. */
export function defaultSmsReminderBody(): string {
  return m["automations.smsReminder.defaultBody"];
}

/**
 * THE ONE composer for the text reminder: the lead, one space, the
 * operator's prose (or the default). The settings counter and the pass both
 * call this, so what the operator approves is what is billed.
 */
export function composeSmsReminder(brandName: string, whenText: string, body: string): string {
  return [smsReminderLead(brandName, whenText), body.trim()].filter(Boolean).join(" ");
}

/**
 * The instant the settings page previews with. FIXED, so the count the
 * operator sees does not drift day to day, and chosen at the widest common
 * width formatWhen produces (a two-digit day, a two-digit hour, a
 * three-letter zone: "Wed, Sep 30, 12:30 PM CDT") so the preview is not
 * optimistic. A real send renders the real time; ±2 characters.
 */
export const SMS_REMINDER_PREVIEW_INSTANT = new Date("2026-09-30T17:30:00Z");
```

`apps/web/src/lib/automations/passes/sms-reminder.ts`:

```ts
import {
  listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed,
} from "@bis/db";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { composeSmsReminder, defaultSmsReminderBody } from "../sms-reminder-copy";
import { sendAutomationSms, markAutomationSmsSent, smsCooldownActive } from "../send-sms";
import type { Pass } from "../context";

/**
 * The text reminder, ~2h before `starts_at` — the second step of the
 * booking reminder sequence (the email goes ~a day before). SMS only, by
 * definition of the recipe; the due-row carries no email address.
 *
 * NO MORNING GATE: the window IS the moment (listDueSmsReminders). Per row:
 *   no textable phone → SMS gate refused (skip and count; there is no other
 *   channel) → SMS cooldown → send → STAMP → mark the message row sent.
 *
 * UNCAPPED, by the spec's own reasoning for the email reminder: a reminder
 * is one-to-one with a booking the customer made, and a cap on a busy
 * client would drop reminders — the row leaves its 45-minute window before
 * a rolling day clears — turning a burst guard into no-shows. No bulk
 * status change can create a burst here.
 *
 * The time is rendered in the BOOKER's zone (safeZone, the email
 * reminder's rule), so a Los Angeles booker of a New York company reads
 * their own clock.
 */
export const smsReminderPass: Pass = {
  key: "smsReminders",
  async run(ctx) {
    const c = { sent: 0, failed: 0, unstamped: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0 };
    const due = await listDueSmsReminders(ctx.db, ctx.now.toISOString());

    const smsGates = new Map<string, SmsGate>();

    for (const row of due) {
      const to = toE164(row.contactPhone);
      if (!to) {
        c.skippedNoAddress++;
        console.error(`text reminder skipped, no textable phone on file for booking ${row.bookingId}`);
        continue;
      }
      let gate = smsGates.get(row.accountId);
      if (!gate) {
        try {
          gate = await resolveSmsSender(ctx.db, row.accountId);
        } catch (e) {
          c.failed++;
          console.error(`text reminder: sms gate read failed for account ${row.accountId}: ${String(e)}`);
          continue;
        }
        smsGates.set(row.accountId, gate);
      }
      if (!gate.ok) {
        c.skippedSmsGate++;
        console.error(
          `text reminder skipped for booking ${row.bookingId}: account ${row.accountId} cannot text (${gate.reason})`,
        );
        continue;
      }
      if (smsCooldownActive(row.smsFailedAt, ctx.now)) {
        c.skippedRecentFailure++;
        continue;
      }

      // Inside the per-row try: a junk ACCOUNT zone makes formatWhen throw,
      // and that is this row's failure, not the pass's.
      try {
        const zone = safeZone(row.bookerTimezone ?? undefined, row.accountTimezone);
        const body = composeSmsReminder(
          row.brandName, formatWhen(new Date(row.startsAt), zone), row.body.trim() || defaultSmsReminderBody());
        const smsRow = await sendAutomationSms(ctx, {
          accountId: row.accountId, contactId: row.contactId, to, from: gate.from, body,
          onProviderFailure: () => stampSmsReminderFailed(ctx.db, row.bookingId),
        });

        // SEND-THEN-STAMP; the stamp before the row's status, as everywhere.
        const stamp = await stampWithRetry(() => stampSmsReminderSent(ctx.db, row.bookingId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `text reminder sent but NOT stamped for booking ${row.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 2 more copies before the window closes: ${String(stamp.lastError)}`,
          );
        }
        c.sent++;
        await markAutomationSmsSent(ctx, row.accountId, smsRow, "text reminder");
      } catch (e) {
        c.failed++;
        console.error(`text reminder send failed for booking ${row.bookingId}: ${String(e)}`);
      }
    }

    return c;
  },
};
```

- [ ] **Step 6: Register it; the sentinel, the fixture guard, the coupling test, `route.test.ts`**

`registry.ts`:
```ts
import { smsReminderPass } from "./passes/sms-reminder";
// ...
export const PASSES: readonly Pass[] = [remindersPass, followupsPass, reviewRequestPass, noShowNudgePass, smsReminderPass];
```
and extend its doc comment with: `The SMS reminder runs last; it reads nothing the others write.`

`imports.test.ts` — add `"passes/sms-reminder.ts"` to the `arrayContaining` list.

`sentinel.test.ts`:
(a) `dbMocks` gains `listDueSmsReminders: vi.fn(), stampSmsReminderSent: vi.fn(), stampSmsReminderFailed: vi.fn(),`
(b) in `beforeEach`, after the nudge rows:
```ts
  dbMocks.listDueSmsReminders.mockResolvedValue([{
    bookingId: "bk_sr", accountId: "acct_1", startsAt: "2026-09-09T16:00:00.000Z", bookerTimezone: null,
    smsFailedAt: null, contactId: "ct_5", contactPhone: "9565550103", brandName: BRAND,
    accountTimezone: "America/New_York", body: "",
  }]);
```
(c) add `expect(results.smsReminders?.sent).toBe(1);` after the nudge assertion, and the registry order becomes `["reminders", "followups", "reviewRequests", "noShowNudges", "smsReminders"]`.

`cron-coupling.test.ts` — extend the `@bis/db` import with `NO_SHOW_NUDGE_MAX_AGE_MS, SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS`, add `import { SMS_RETRY_COOLDOWN_MS } from "./caps";`, and append inside the describe:
```ts
  it("the SMS reminder window is wider than one tick, and fires about two hours ahead", () => {
    // Mutation: change either constant alone.
    const tick = tickIntervalMs(entry!.schedule);
    expect(SMS_REMINDER_WINDOW_END_MS - SMS_REMINDER_WINDOW_START_MS).toBeGreaterThan(tick);
    expect(SMS_REMINDER_WINDOW_END_MS).toBe(135 * MINUTE);
    expect(SMS_REMINDER_WINDOW_START_MS).toBe(90 * MINUTE);
  });

  it("the no-show nudge cap is the follow-up cap: same derivation, nothing to defer to", () => {
    expect(NO_SHOW_NUDGE_MAX_AGE_MS).toBe(FOLLOWUP_MAX_AGE_MS);
  });

  it("the SMS cooldown allows at most three attempts across the review request's window", () => {
    expect(Math.ceil(REVIEW_REQUEST_MAX_AGE_MS / SMS_RETRY_COOLDOWN_MS)).toBe(3);
  });
```

`route.test.ts` — additions only:
(a) in the `@bis/db` factory, after the no-show lines:
```ts
  // The SMS reminder pass (Milestone B).
  listDueSmsReminders: async () => [],
  stampSmsReminderSent: async () => undefined,
  stampSmsReminderFailed: async () => undefined,
```
(b) after `EMPTY_NO_SHOW_NUDGES`:
```ts
const EMPTY_SMS_REMINDERS = {
  sent: 0, failed: 0, unstamped: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0,
};
```
(c) the seven strict bodies:
```bash
cd /c/Users/danlo/bis-platform/apps/web && sed -i 's/noShowNudges: EMPTY_NO_SHOW_NUDGES })/noShowNudges: EMPTY_NO_SHOW_NUDGES, smsReminders: EMPTY_SMS_REMINDERS })/' src/app/api/cron/reminders/route.test.ts && sed -i 's/^      noShowNudges: EMPTY_NO_SHOW_NUDGES,$/      noShowNudges: EMPTY_NO_SHOW_NUDGES,\n      smsReminders: EMPTY_SMS_REMINDERS,/' src/app/api/cron/reminders/route.test.ts && grep -c "smsReminders: EMPTY_SMS_REMINDERS" src/app/api/cron/reminders/route.test.ts
```
Expected: `7`.

- [ ] **Step 7: Run the automations tree and the route tests, typecheck, lint; mutate; commit**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/automations src/app/api/cron > /c/Users/danlo/AppData/Local/Temp/claude/t7.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/t7.txt
cd /c/Users/danlo/bis-platform && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t7b.txt 2>&1; echo "exit=$?"; pnpm lint > /c/Users/danlo/AppData/Local/Temp/claude/t7c.txt 2>&1; echo "exit=$?"
```
Expected: all `exit=0`; copy 7, pass 12, cron-coupling 7, sentinel 2, route 30. Mutations: (a) apply `AUTOMATION_TICK_CAP` in the pass → "30 send 30"; (b) format in `row.accountTimezone` → the booker-zone test; (c) remove the cooldown check → "one attempt, ever"; (d) `SMS_REMINDER_WINDOW_START_MS = 130 * 60 * 1000` → cron-coupling's "wider than one tick". Revert each.

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-b" ] && git add apps/web/src/lib/automations/sms-reminder-copy.ts apps/web/src/lib/automations/sms-reminder-copy.test.ts apps/web/src/lib/automations/passes/sms-reminder.ts apps/web/src/lib/automations/passes/sms-reminder.test.ts apps/web/src/lib/automations/registry.ts apps/web/src/lib/automations/sentinel.test.ts apps/web/src/lib/automations/imports.test.ts apps/web/src/lib/automations/cron-coupling.test.ts apps/web/src/app/api/cron/reminders/route.test.ts && git commit -q -m "feat(automations): ~2h text reminder — booker-zone time, uncapped, cooldown, window pinned against vercel.json

route.test.ts gains only the smsReminders key + mocks. Mutation-checked: tick cap, zone, cooldown, window." && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 8: The Automations page — three cards, each previewing exactly the string that sends

**Files:**
- Create: `apps/web/src/components/ui/textarea.tsx`
- Modify: `apps/web/src/lib/messages.ts` (page keys)
- Modify: `.../automations/automations-settings.tsx` (`Textarea`, card-scoped ids, `data-testid`)
- Create: `.../automations/no-show-nudge-card.tsx`, `.../automations/sms-reminder-card.tsx`
- Modify: `.../automations/actions.ts` (+2 actions), `.../automations/actions.test.ts` (append)
- Modify: `.../automations/page.tsx`, `.../automations/page.test.ts` (rewrite)
- Modify: `apps/web/src/lib/palette/registry.ts` (keywords)
- Modify: `apps/web/e2e/automations.spec.ts` (scope one locator; one new test)

(`.../automations/` = `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/`.)

**Interfaces:**
- Consumes: `getAutomation`, `upsertAutomation`, `parseNoShowNudgeConfig`, `getOrCreateCalendar`, `getBranding`, `AutomationRow`, `NoShowNudgeChannel` (`@bis/db`); `requireAccountAccess`, `requireAgencyOnlyAccountAccess` (`@/lib/auth`); `originFrom` (`@/lib/email/origin`); `brandDisplayName` (`@/lib/email/templates/shell`); `resolveSmsSender`, `SmsGate`; `segmentsFor`; `safeZone`, `formatWhen` (`@/lib/booking/time`); `composeNoShowNudgeSms`, `defaultNoShowNudgeBody` (Task 5); `composeSmsReminder`, `defaultSmsReminderBody`, `SMS_REMINDER_PREVIEW_INSTANT` (Task 7); `useFormSubmit`, `notifyActionResult`, `SubmitButton`, `PageHeader`, the ui components.
- Produces: `Textarea` (`@/components/ui/textarea`); `saveNoShowNudgeAction(accountId, formData)` reading `enabled` ("on"), `channel` ("email"|"sms"), `body`; `saveSmsReminderAction(accountId, formData)` reading `enabled`, `body`; `NoShowNudgeCard` props `{ automation: AutomationRow | null; brandName: string; smsGate: SmsGate; bookingUrl: string; calendarEnabled: boolean; saveAction }`; `SmsReminderCard` props `{ automation: AutomationRow | null; brandName: string; accountTimezone: string; smsGate: SmsGate; saveAction }`; `AutomationsSettings` unchanged props; the page renders all three.

- [ ] **Step 1: Copy keys**

In `apps/web/src/lib/messages.ts`, directly after `"automations.review.urlInvalid": …,` add:

```ts
  // Shared channel labels for the SMS-capable recipes.
  "automations.channel.email": "Email",
  "automations.channel.sms": "Text message",
  "automations.noShow.title": "No-show follow-ups",
  "automations.noShow.body": "The morning after a booking is marked no-show, invite the customer to pick a new time. Your booking page link is added to the end of the message. Off until you turn it on.",
  "automations.noShow.enabled": "Send no-show follow-ups",
  "automations.noShow.channel": "Send by",
  "automations.noShow.message": "Message",
  "automations.noShow.messageHint": "Leave blank to send our default message.",
  "automations.noShow.linkHint": "Added to the end: {link}",
  "automations.noShow.calendarOff": "Your booking page is off, so there is nowhere to send people yet. Turn it on under Calendar first.",
  "automations.noShow.save": "Save no-show follow-ups",
  "automations.noShow.saved": "No-show follow-ups saved",
  "automations.noShow.saveFailed": "Could not save no-show follow-ups.",
  "automations.smsReminder.title": "Text reminders",
  "automations.smsReminder.body": "About two hours before an appointment, text the customer a reminder with the time, on top of the email reminder the day before. Text only. Off until you turn it on.",
  "automations.smsReminder.enabled": "Send text reminders",
  "automations.smsReminder.message": "Closing line",
  "automations.smsReminder.messageHint": "Comes after the appointment time. Leave blank to send our default.",
  "automations.smsReminder.preview": "Preview",
  "automations.smsReminder.save": "Save text reminders",
  "automations.smsReminder.saved": "Text reminders saved",
  "automations.smsReminder.saveFailed": "Could not save text reminders.",
```

- [ ] **Step 2: Write the failing action tests**

Append to `.../automations/actions.test.ts` — extend the import to `import { saveReviewRequestAction, saveNoShowNudgeAction, saveSmsReminderAction } from "./actions";` and add at the end:

```ts
describe("saveNoShowNudgeAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveNoShowNudgeAction("acct_1", fd({ enabled: "on", channel: "sms" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + channel + trimmed body through serviceDb, validated with the pass's own parser", async () => {
    expect(await saveNoShowNudgeAction("acct_1", fd({ enabled: "on", channel: "sms", body: "  Come back!  " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "no_show_nudge",
      { enabled: true, body: "Come back!", config: { channel: "sms" } }, "user_1");
  });

  it("an unknown channel and a database failure both come back as a toastable failure", async () => {
    // Mutation: default an unknown channel to email instead of refusing.
    expect(await saveNoShowNudgeAction("acct_1", fd({ channel: "fax" })))
      .toEqual({ ok: false, error: m["automations.noShow.saveFailed"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveNoShowNudgeAction("acct_1", fd({ enabled: "on", channel: "email" })))
      .toEqual({ ok: false, error: m["automations.noShow.saveFailed"] });
  });
});

describe("saveSmsReminderAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveSmsReminderAction("acct_1", fd({ enabled: "on" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.upsertAutomation).not.toHaveBeenCalled();
  });

  it("saves enabled + trimmed body with an empty config — the recipe has nothing else to configure", async () => {
    expect(await saveSmsReminderAction("acct_1", fd({ enabled: "on", body: " See you soon! " }))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "sms_reminder",
      { enabled: true, body: "See you soon!", config: {} }, "user_1");
  });

  it("saves an OFF row with an empty body, and reports a database failure as a toastable failure", async () => {
    expect(await saveSmsReminderAction("acct_1", fd({}))).toEqual({ ok: true });
    expect(dbMocks.upsertAutomation).toHaveBeenCalledWith(expect.anything(), "acct_1", "sms_reminder",
      { enabled: false, body: "", config: {} }, "user_1");
    dbMocks.upsertAutomation.mockRejectedValue(new Error("db down"));
    expect(await saveSmsReminderAction("acct_1", fd({ enabled: "on" })))
      .toEqual({ ok: false, error: m["automations.smsReminder.saveFailed"] });
  });
});
```

- [ ] **Step 3: Rewrite the page test**

`.../automations/page.test.ts` — the whole file:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationRow } from "@bis/db";

/**
 * The voice page test's one question, asked for each card: which company
 * name does this page hand the preview? It must be the customer-facing
 * brand name, because each preview's default body and the sent default
 * body are built from the same string. Plus, for Milestone B: each card
 * gets ITS OWN row, the nudge card gets the real booking-page link, and the
 * text-reminder card gets the account's zone for its sample time.
 */
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: async () => ({ userId: "user_1" }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "app.example.com" }) }));
vi.mock("@/lib/email/origin", () => ({ originFrom: () => "https://app.example.com" }));
const dbFixture = vi.hoisted(() => ({
  name: "Rio Roofing — trial", timezone: "America/Chicago", brandName: null as string | null,
}));
const dbMock = vi.hoisted(() => ({ getAutomation: vi.fn(), getBranding: vi.fn(), getOrCreateCalendar: vi.fn() }));
vi.mock("@bis/db", () => ({
  serviceDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { name: dbFixture.name, timezone: dbFixture.timezone }, error: null }) }),
      }),
    }),
  }),
  getAutomation: (...a: unknown[]) => dbMock.getAutomation(...a),
  getBranding: (...a: unknown[]) => dbMock.getBranding(...a),
  getOrCreateCalendar: (...a: unknown[]) => dbMock.getOrCreateCalendar(...a),
}));
vi.mock("@/lib/sms/sender", () => ({
  resolveSmsSender: async () => ({ ok: false, reason: "a2p_not_approved" }),
}));
vi.mock("./actions", () => ({
  saveReviewRequestAction: async () => ({ ok: true }),
  saveNoShowNudgeAction: async () => ({ ok: true }),
  saveSmsReminderAction: async () => ({ ok: true }),
}));

type Props = Record<string, unknown>;
const captured = vi.hoisted(() => ({ review: null as Props | null, noShow: null as Props | null, sms: null as Props | null }));
vi.mock("./automations-settings", () => ({
  AutomationsSettings: (props: Props) => { captured.review = props; return null; },
}));
vi.mock("./no-show-nudge-card", () => ({
  NoShowNudgeCard: (props: Props) => { captured.noShow = props; return null; },
}));
vi.mock("./sms-reminder-card", () => ({
  SmsReminderCard: (props: Props) => { captured.sms = props; return null; },
}));

const { default: AutomationsPage } = await import("./page");

const base = { account_id: "a1", created_at: "2026-09-06T00:00:00Z", updated_at: "2026-09-06T00:00:00Z" };
const ROWS: Record<string, AutomationRow> = {
  review_request: { ...base, id: "au1", recipe_key: "review_request", enabled: true, body: "Hi",
    config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
  no_show_nudge: { ...base, id: "au2", recipe_key: "no_show_nudge", enabled: false, body: "Come back", config: { channel: "email" } },
};

async function render() {
  captured.review = captured.noShow = captured.sms = null;
  renderToStaticMarkup(await AutomationsPage({ params: Promise.resolve({ accountId: "a1" }) }));
  return captured;
}

beforeEach(() => {
  dbFixture.name = "Rio Roofing — trial";
  dbFixture.timezone = "America/Chicago";
  dbFixture.brandName = null;
  dbMock.getAutomation.mockReset().mockImplementation(async (_db: unknown, _a: unknown, key: string) => ROWS[key] ?? null);
  dbMock.getBranding.mockReset().mockImplementation(async () => ({
    brandName: dbFixture.brandName, brandLogoPath: null, brandColor: null, brandNeutral: null,
    brandCorners: null, brandType: null, brandMode: null, replyToEmail: null,
  }));
  dbMock.getOrCreateCalendar.mockReset().mockResolvedValue({ id: "cal_1", public_id: "cal_pub_1", enabled: true });
});

describe("automations page", () => {
  it("previews every card with the BRAND name, not the agency's internal accounts.name label", async () => {
    dbFixture.brandName = "Rio Roofing";
    const c = await render();
    expect(c.review!.brandName).toBe("Rio Roofing");
    expect(c.noShow!.brandName).toBe("Rio Roofing");
    expect(c.sms!.brandName).toBe("Rio Roofing");
  });

  it("falls back to the account name when the company has set no brand name", async () => {
    dbFixture.name = "Rio Roofing";
    expect((await render()).review!.brandName).toBe("Rio Roofing");
  });

  it("hands each card ITS OWN row (null where none is stored) and the SMS gate", async () => {
    // Mutation: hand every card the review row.
    const c = await render();
    expect(c.review!.automation).toEqual(ROWS.review_request);
    expect(c.noShow!.automation).toEqual(ROWS.no_show_nudge);
    expect(c.sms!.automation).toBeNull();
    for (const p of [c.review!, c.noShow!, c.sms!]) expect(p.smsGate).toEqual({ ok: false, reason: "a2p_not_approved" });
  });

  it("hands the nudge card the real booking-page link and whether the page is on — the lazily created calendar, as the Calendar page does", async () => {
    const c = await render();
    expect(dbMock.getOrCreateCalendar).toHaveBeenCalledWith(expect.anything(), "a1", "user_1");
    expect(c.noShow!.bookingUrl).toBe("https://app.example.com/b/cal_pub_1");
    expect(c.noShow!.calendarEnabled).toBe(true);
  });

  it("hands the text-reminder card the account's zone for its sample time", async () => {
    expect((await render()).sms!.accountTimezone).toBe("America/Chicago");
  });
});
```

- [ ] **Step 4: Run to verify they fail**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/automations" 2>&1 | grep -E "Failed to resolve|does not provide|passed|failed" | head -4
```
Expected: FAIL — `./no-show-nudge-card`, `./sms-reminder-card` and the two actions do not exist.

- [ ] **Step 5: The `Textarea` component and the review card's edits**

`apps/web/src/components/ui/textarea.tsx` (shadcn's, the ledger's deferred item — the review card's class string was already the third copy):

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

`.../automations/automations-settings.tsx`:
- add `import { Textarea } from "@/components/ui/textarea";`; delete the `TEXTAREA` constant.
- `<Card>` → `<Card data-testid="review-request-card">`.
- Every id and its label, so three cards on one page cannot collide (duplicate ids break label association and Playwright's `getByLabel`): `id="enabled"`/`htmlFor="enabled"` → `review-enabled`; `id="channel"`/`htmlFor="channel"` → `review-channel`; `id="body"`/`htmlFor="body"` → `review-body`. **`id="review_url"` stays** (the e2e spec locates it). `name=` attributes are per-form and stay.
- The `<textarea … className={TEXTAREA} />` becomes `<Textarea id="review-body" name="body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder={defaultReviewRequestBody(brandName)} />`.

- [ ] **Step 6: The two new cards**

`.../automations/no-show-nudge-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { AutomationRow, NoShowNudgeChannel } from "@bis/db";
import type { SmsGate } from "@/lib/sms/sender";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { m } from "@/lib/messages";
import { segmentsFor } from "@/lib/sms/segments";
import { composeNoShowNudgeSms, defaultNoShowNudgeBody } from "@/lib/automations/no-show-nudge-copy";
import type { ActionResult } from "./actions";

type StoredForm = { enabled: boolean; channel: NoShowNudgeChannel; body: string };

/** Lenient on the raw jsonb, like the review card: a stored value the pass
 *  refuses must still be SHOWN so the operator can fix it. */
function formDefaults(row: AutomationRow | null): StoredForm {
  const cfg = row?.config && typeof row.config === "object" && !Array.isArray(row.config)
    ? (row.config as Record<string, unknown>) : {};
  return {
    enabled: row?.enabled ?? false,
    channel: cfg.channel === "sms" ? "sms" : "email",
    body: row?.body ?? "",
  };
}

export function NoShowNudgeCard({
  automation, brandName, smsGate, bookingUrl, calendarEnabled, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx). */
  brandName: string;
  smsGate: SmsGate;
  /** `${origin}/b/${calendar.public_id}` — the very link the pass appends. */
  bookingUrl: string;
  /** The public page's switch; the pass skips while it is off. */
  calendarEnabled: boolean;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const stored = formDefaults(automation);
  const [channel, setChannel] = useState<NoShowNudgeChannel>(stored.channel);
  const [body, setBody] = useState(stored.body);

  // THE COUNTER COUNTS BODY PLUS LINK, through the ONE function the pass
  // uses (composeNoShowNudgeSms → withTrailingLink), with the real link.
  const previewBody = body.trim() || defaultNoShowNudgeBody(brandName);
  const preview = segmentsFor(composeNoShowNudgeSms(previewBody, bookingUrl));

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.noShow.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="no-show-nudge-card">
      <CardHeader>
        <CardTitle>{m["automations.noShow.title"]}</CardTitle>
        <CardDescription>{m["automations.noShow.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="noshow-enabled" name="enabled" defaultChecked={stored.enabled} />
            <Label htmlFor="noshow-enabled">{m["automations.noShow.enabled"]}</Label>
          </div>
          {!calendarEnabled ? (
            <p className="text-xs text-muted-foreground">{m["automations.noShow.calendarOff"]}</p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="noshow-channel">{m["automations.noShow.channel"]}</Label>
            <Select
              name="channel" defaultValue={stored.channel}
              onValueChange={(v) => setChannel(v === "sms" ? "sms" : "email")}
            >
              <SelectTrigger id="noshow-channel" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="email">{m["automations.channel.email"]}</SelectItem>
                <SelectItem value="sms">{m["automations.channel.sms"]}</SelectItem>
              </SelectContent>
            </Select>
            {channel === "sms" && !smsGate.ok ? (
              <p className="text-xs text-muted-foreground">
                {smsGate.reason === "a2p_not_approved"
                  ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
              </p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="noshow-body">{m["automations.noShow.message"]}</Label>
            <Textarea
              id="noshow-body" name="body" rows={3} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultNoShowNudgeBody(brandName)}
            />
            <p className="text-xs text-muted-foreground">{m["automations.noShow.messageHint"]}</p>
            <p className="text-xs text-muted-foreground" data-testid="no-show-link">
              {m["automations.noShow.linkHint"].replace("{link}", () => bookingUrl)}
            </p>
            {channel === "sms" ? (
              <p className="text-xs text-muted-foreground" data-testid="no-show-sms-count">
                {m["compose.smsSegments"]
                  .replace("{chars}", String(preview.chars))
                  .replace("{segments}", String(preview.segments))}
              </p>
            ) : null}
          </div>

          <SubmitButton pending={pending}>{m["automations.noShow.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
```

`.../automations/sms-reminder-card.tsx`:

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
import {
  composeSmsReminder, defaultSmsReminderBody, SMS_REMINDER_PREVIEW_INSTANT,
} from "@/lib/automations/sms-reminder-copy";
import type { ActionResult } from "./actions";

export function SmsReminderCard({
  automation, brandName, accountTimezone, smsGate, saveAction,
}: {
  automation: AutomationRow | null;
  /** Already the CUSTOMER-FACING name (brandDisplayName, page.tsx). */
  brandName: string;
  /** For the sample time in the preview; a real send uses the booker's zone. */
  accountTimezone: string;
  smsGate: SmsGate;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [body, setBody] = useState(automation?.body ?? "");

  // THE PREVIEW IS THE COMPOSED STRING — lead with a sample time, then the
  // closing line — through the ONE composer the pass uses, so the count the
  // operator approves is the count that sends (±2 characters of date width).
  const when = formatWhen(SMS_REMINDER_PREVIEW_INSTANT, safeZone(accountTimezone, "UTC"));
  const composed = composeSmsReminder(brandName, when, body.trim() || defaultSmsReminderBody());
  const preview = segmentsFor(composed);

  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.smsReminder.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card data-testid="sms-reminder-card">
      <CardHeader>
        <CardTitle>{m["automations.smsReminder.title"]}</CardTitle>
        <CardDescription>{m["automations.smsReminder.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="smsrem-enabled" name="enabled" defaultChecked={automation?.enabled ?? false} />
            <Label htmlFor="smsrem-enabled">{m["automations.smsReminder.enabled"]}</Label>
          </div>
          {!smsGate.ok ? (
            // Text only: the reason a text reminder would be skipped, up front.
            <p className="text-xs text-muted-foreground">
              {smsGate.reason === "a2p_not_approved"
                ? m["compose.smsBlockedA2p"] : m["compose.smsBlockedNoNumber"]}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="smsrem-body">{m["automations.smsReminder.message"]}</Label>
            <Textarea
              id="smsrem-body" name="body" rows={2} value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={defaultSmsReminderBody()}
            />
            <p className="text-xs text-muted-foreground">{m["automations.smsReminder.messageHint"]}</p>
          </div>

          <div className="space-y-1.5">
            <Label>{m["automations.smsReminder.preview"]}</Label>
            <p className="rounded-md border border-input px-3 py-2 text-sm" data-testid="sms-reminder-preview">{composed}</p>
            <p className="text-xs text-muted-foreground" data-testid="sms-reminder-count">
              {m["compose.smsSegments"]
                .replace("{chars}", String(preview.chars))
                .replace("{segments}", String(preview.segments))}
            </p>
          </div>

          <SubmitButton pending={pending}>{m["automations.smsReminder.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 7: The two actions**

Append to `.../automations/actions.ts` (extend its `@bis/db` import with `parseNoShowNudgeConfig`):

```ts
export async function saveNoShowNudgeAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  // The pass's own parser, on write: an unknown channel is refused, never
  // defaulted — a default here would let the page show one channel while
  // the row stores another.
  const config = parseNoShowNudgeConfig({ channel: String(formData.get("channel") ?? "email") });
  if (!config) return { ok: false, error: m["automations.noShow.saveFailed"] };
  const enabled = formData.get("enabled") === "on";
  const body = String(formData.get("body") ?? "").trim();

  try {
    await upsertAutomation(serviceDb(), accountId, "no_show_nudge", { enabled, body, config }, userId);
  } catch (e) {
    console.error(`saveNoShowNudgeAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.noShow.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}

export async function saveSmsReminderAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const enabled = formData.get("enabled") === "on";
  const body = String(formData.get("body") ?? "").trim();

  try {
    // Nothing to configure: the channel is the recipe, the time is the booking's.
    await upsertAutomation(serviceDb(), accountId, "sms_reminder", { enabled, body, config: {} }, userId);
  } catch (e) {
    console.error(`saveSmsReminderAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.smsReminder.saveFailed"] };
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}
```

- [ ] **Step 8: The page**

`.../automations/page.tsx` — the whole file:

```tsx
import { headers } from "next/headers";
import { serviceDb, getAutomation, getBranding, getOrCreateCalendar } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { requireAgencyOnlyAccountAccess } from "@/lib/auth";
import { brandDisplayName } from "@/lib/email/templates/shell";
import { originFrom } from "@/lib/email/origin";
import { resolveSmsSender } from "@/lib/sms/sender";
import { m } from "@/lib/messages";
import { AutomationsSettings } from "./automations-settings";
import { NoShowNudgeCard } from "./no-show-nudge-card";
import { SmsReminderCard } from "./sms-reminder-card";
import { saveReviewRequestAction, saveNoShowNudgeAction, saveSmsReminderAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Agency-only throughout, the Voice page's shape: `requireAgencyOnlyAccountAccess`
 * gates the page, every write in ./actions.ts re-checks `isAgency`, and the
 * nav item is hidden from clients — hiding a link is not authorization.
 * Reads go through serviceDb() like the writes; the whole page is one
 * audience, so a second db client buys nothing.
 */
export default async function AutomationsPage({
  params,
}: {
  params: Promise<{ accountId: string }>;
}) {
  const { accountId } = await params;
  const { userId } = await requireAgencyOnlyAccountAccess(accountId);

  const db = serviceDb();
  const [review, noShow, smsReminder, account, smsGate, calendar, origin] = await Promise.all([
    getAutomation(db, accountId, "review_request"),
    getAutomation(db, accountId, "no_show_nudge"),
    getAutomation(db, accountId, "sms_reminder"),
    // The default bodies name the company. Resolved through brandDisplayName
    // exactly as the passes' due-rows are (packages/db), never off
    // `accounts.name` alone — a preview that does not match what sends is
    // worse than no preview. The zone feeds the text reminder's sample time.
    // Cosmetic, so a failed read degrades to ""/UTC.
    (async () => {
      try {
        const [branding, { data, error }] = await Promise.all([
          getBranding(db, accountId),
          db.from("accounts").select("name, timezone").eq("id", accountId).maybeSingle(),
        ]);
        if (error) throw new Error(error.message);
        const acct = data as { name: string; timezone: string } | null;
        return { brandName: brandDisplayName(branding, acct?.name ?? ""), timezone: acct?.timezone ?? "UTC" };
      } catch (e) {
        console.error(`automations: account lookup failed for ${accountId}: ${String(e)}`);
        return { brandName: "", timezone: "UTC" };
      }
    })(),
    // The same gate the passes consult, so the page can say up front why a
    // text would be skipped.
    resolveSmsSender(db, accountId),
    // Lazy, as the Calendar settings page does: the row exists the first
    // time anything asks. The nudge's preview needs its public id.
    getOrCreateCalendar(db, accountId, userId),
    // APP_ORIGIN first, then the request's host — the same origin every
    // customer link carries (origin.ts). The pass builds the sent link from
    // ctx.origin the same way, so the preview shows the link that goes out.
    headers().then((h) => originFrom(h)),
  ]);

  const bookingUrl = origin ? `${origin}/b/${calendar.public_id}` : "";

  return (
    <>
      <PageHeader title={m["automations.title"]} />
      <div className="max-w-2xl space-y-6 p-6">
        <AutomationsSettings
          automation={review}
          brandName={account.brandName}
          smsGate={smsGate}
          saveAction={saveReviewRequestAction.bind(null, accountId)}
        />
        <NoShowNudgeCard
          automation={noShow}
          brandName={account.brandName}
          smsGate={smsGate}
          bookingUrl={bookingUrl}
          calendarEnabled={calendar.enabled}
          saveAction={saveNoShowNudgeAction.bind(null, accountId)}
        />
        <SmsReminderCard
          automation={smsReminder}
          brandName={account.brandName}
          accountTimezone={account.timezone}
          smsGate={smsGate}
          saveAction={saveSmsReminderAction.bind(null, accountId)}
        />
      </div>
    </>
  );
}
```

- [ ] **Step 9: Palette keywords and the e2e spec**

`apps/web/src/lib/palette/registry.ts` — in `NAV_KEYWORDS`, append `"no-show", "no show", "text reminder", "reminder"` to the existing `"/automations"` array (leave its current entries in place).

`apps/web/e2e/automations.spec.ts`:
(a) In the existing "the agency reaches it from the nav…" test, the line `await page.getByLabel("Send by").click();` becomes
```ts
    await page.getByTestId("review-request-card").getByLabel("Send by").click();
```
(two cards now carry a "Send by" select; unscoped, Playwright's strict mode throws).
(b) Append inside the `test.describe("the Automations page", …)` block:

```ts
  test("the no-show and text-reminder cards preview the composed message — link and time included — as one segment", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);

    const noShow = page.getByTestId("no-show-nudge-card");
    await expect(noShow.getByText("No-show follow-ups", { exact: true })).toBeVisible();
    await expect(noShow.getByTestId("no-show-link")).toContainText(`/b/`);
    await noShow.getByLabel("Send by").click();
    await page.getByRole("option", { name: "Text message" }).click();
    await expect(noShow.getByTestId("no-show-sms-count")).toContainText("1 message(s)");

    const reminder = page.getByTestId("sms-reminder-card");
    await expect(reminder.getByText("Text reminders", { exact: true })).toBeVisible();
    await expect(reminder.getByTestId("sms-reminder-preview")).toContainText("Reminder: your appointment");
    await expect(reminder.getByTestId("sms-reminder-count")).toContainText("1 message(s)");
    // Nothing is saved — no form is submitted.
  });
```

- [ ] **Step 10: Run the unit tests, typecheck, lint, then the e2e spec**

```bash
cd /c/Users/danlo/bis-platform/apps/web && npx vitest run "src/app/(dashboard)/dashboard/accounts/[accountId]/automations" src/lib/palette src/lib/messages > /c/Users/danlo/AppData/Local/Temp/claude/t8.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/t8.txt
cd /c/Users/danlo/bis-platform && pnpm typecheck > /c/Users/danlo/AppData/Local/Temp/claude/t8b.txt 2>&1; echo "exit=$?"; pnpm lint > /c/Users/danlo/AppData/Local/Temp/claude/t8c.txt 2>&1; echo "exit=$?"
cd /c/Users/danlo/bis-platform/apps/web && npx playwright test automations.spec.ts > /c/Users/danlo/AppData/Local/Temp/claude/t8d.txt 2>&1; echo "exit=$?"; tail -6 /c/Users/danlo/AppData/Local/Temp/claude/t8d.txt
```
Expected: all `exit=0`; actions 8 + 6 = 14, page 5, palette parity still green; e2e 4 passed (3 + 1). If `noShow.getByText("No-show follow-ups", { exact: true })` matches twice (title and the checkbox label "Send no-show follow-ups" — `exact` prevents it), or the Radix option list is not found, use `page.getByRole("option", …)` as written (the popover portals to `body`).

- [ ] **Step 11: Commit**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-b" ] && git add apps/web/src/components/ui/textarea.tsx apps/web/src/lib/messages.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations" apps/web/src/lib/palette/registry.ts apps/web/e2e/automations.spec.ts && git commit -q -m "feat(automations): Automations page — no-show follow-ups and text reminders cards; every preview is the composed string that sends; Textarea component" && git log --oneline -1 || echo "BRANCH MOVED TO $B"
```

---

### Task 9: Gates on the whole tree, the eyeball, the ledger, the review, the PR — no merge

**Files:**
- Modify: `.superpowers/sdd/progress.md` (gitignored ledger — append)
- No source changes unless a gate fails.

- [ ] **Step 1: The three gates, uncontended, exit codes read from `$?`**

Nothing else may be running against this repo (a parallel `next dev`, another vitest run) — contended suites go red on wall clock, not behaviour. Fetch first: `origin/main` moves during long gates; if it has, merge it INTO the branch and re-run every gate on the combined tree.

```bash
cd /c/Users/danlo/bis-platform && git fetch origin && git log --oneline feat/automations-b..origin/main | head -5; echo "commits-on-main-not-in-branch-above (expect none; if any: git merge origin/main, resolve, re-run ALL gates)"
cd /c/Users/danlo/bis-platform && pnpm check > /c/Users/danlo/AppData/Local/Temp/claude/gate-check.txt 2>&1; echo "check exit=$?"; grep -E "Tests +[0-9]+ passed|Test Files" /c/Users/danlo/AppData/Local/Temp/claude/gate-check.txt
cd /c/Users/danlo/bis-platform && pnpm --filter web build > /c/Users/danlo/AppData/Local/Temp/claude/gate-build.txt 2>&1; echo "build exit=$?"
cd /c/Users/danlo/bis-platform && pnpm --filter web test:e2e > /c/Users/danlo/AppData/Local/Temp/claude/gate-e2e.txt 2>&1; echo "e2e exit=$?"; tail -8 /c/Users/danlo/AppData/Local/Temp/claude/gate-e2e.txt
```
Expected: all three `exit=0`. Unit counts at least: db 199 + 4 (Task 1) + 10 (Task 2) = **213**; web 1240 + 8 (send-sms) + 5 (review pass, cooldown) + 3 (anchor) + 3 (gate, anchor describe) + 3 (review pass, anchor) + 8 (no-show gate) + 7 (no-show copy) + 4 (no-show template) + 19 (no-show pass) + 7 (sms copy) + 12 (sms pass) + 3 (cron-coupling) + 6 (actions) + 2 (page, 5 vs 3) = **1330**; e2e **71/71** (70 + 1). Record the ACTUAL numbers; a shortfall means a test was not written. Any red: re-run that spec ALONE first and judge by wall clock before believing it (the CI run for PR #27 went red on `shell.spec.ts`'s sidebar-collapse test with no code change and passed on re-run).

- [ ] **Step 2: The things no gate covers — eyeball them, and say so in the ledger**

Start the built app locally (`pnpm --filter web start` after the build above) and open the Automations page for a test account: all three cards render; on the no-show card switch to Text message and confirm the counter changes as the message is edited and the link line shows the real `/b/<public id>` link; on the text-reminder card confirm the preview reads as a sentence with the sample time and the counter tracks the closing line; the A2P reason shows on both SMS surfaces for an unapproved account. Record what was seen. Stated residuals: the text reminder is English-only (bookings do not store the booker's locale); the preview's sample date is within ±2 characters of a real send; `brand_name` null still shows `accounts.name` to a customer by the platform-wide fallback.

- [ ] **Step 3: Ledger entry**

Append to `.superpowers/sdd/progress.md`:

```
## === AUTOMATIONS MILESTONE B on branch feat/automations-b, base <main sha> ===
MIGRATION 0026 APPLIED TO PROD (tlbkbmlrfafquucsmsmm) <date> -- NEVER RE-APPLY.
  Pre-flight: 0025 latest, 0 of the 7 columns present, check = automations_recipe_key_check
  (review_request only). Post-verified: 7 columns, check names 3 keys, 4 indexes, client UPDATE
  on bookings = 0 columns.
Tasks 1-8 committed (<first sha>..<last sha>). route.test.ts: additions only (verified);
review-request.test.ts: 19 existing assertions untouched; review-request-gate.test.ts,
review-request-copy.test.ts, templates/review-request.test.ts: untouched.
GATES on the branch: check <exit> (db <n> . web <n>) . build <exit> . e2e <n>/<n>.
MUTATION PASS: <list each mutation and the test that failed>.
EYEBALLED: <the three cards, the two counters, the link line, the preview sentence, the A2P copy>.
INERT ON DEPLOY: no account has an enabled no_show_nudge or sms_reminder row; completed_at /
no_show_at start being stamped (data, not behaviour); the review pass's window now matches on
either anchor, which can only ADD rows for accounts with review_request enabled (currently: none).
DECISIONS MADE WHERE THE SPEC WAS SILENT (plan header): nudge = morning-after gate at 37h;
nudge link = the booking page; SMS reminder window [1h30m, 2h15m]; SMS reminder UNCAPPED;
cooldown store = per-recipe *_sms_failed_at, not hasRecentOutboundSms.
▶ NEXT: review -> fix waves re-reviewed -> PR -> CI green on the head -> danlo merges -> verify
the deploy (build log names the commit) -> watch one Pro tick's JSON carry noShowNudges and
smsReminders beside the four existing shapes unchanged.
```

- [ ] **Step 4: Request review — do NOT merge**

Invoke `superpowers:requesting-code-review` against the branch's full diff (`git diff main...feat/automations-b`). Highest-consequence claims for the reviewer to verify independently (numbered, so the report can be checked claim by claim): (1) the four migrated/shipped passes' JSON is unchanged — `route.test.ts` is additions-only and green; (2) no pass can construct a provider (`imports.test.ts` now covers seven source files); (3) no due-row type and no context carries `accountName`, and the sentinel runs all five passes; (4) the caps apply to the review request and the no-show nudge ONLY — reminders, follow-ups and SMS reminders are uncapped; (5) neither SMS branch falls back to email; (6) the `.or()` anchor window is proven against the real database, including the pre-0026 null-clock row; (7) `completed_at`/`no_show_at` are never cleared; (8) the three page previews are built by the same composers the passes call. Fix waves are re-reviewed; fixes introduce defects.

- [ ] **Step 5: Open the PR, wait for CI on its head, hand it to danlo**

```bash
cd /c/Users/danlo/bis-platform && B="$(git branch --show-current)" && [ "$B" = "feat/automations-b" ] && git push -u origin feat/automations-b 2>&1 | tail -2 || echo "BRANCH MOVED TO $B"
```
Then create the PR with the REST API if `gh pr create` hits the GraphQL rate limit (it did on 2026-09-06):
```bash
cd /c/Users/danlo/bis-platform && gh pr create --base main --head feat/automations-b --title "Automations Milestone B: no-show nudge, ~2h text reminder, completion clocks, SMS cooldown" --body-file /c/Users/danlo/AppData/Local/Temp/claude/pr-body.md 2>&1 | tail -2
```
where `pr-body.md` carries the ledger's gates line, the migration note, the five decisions, and ends with:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01CR9FFbMZBVwxnwtTfzHhYT
```
Read the check runs on the PR's head (`gh api repos/dlopez2392/bis-platform/commits/<head sha>/check-runs`) — both `verify` and `e2e` must be `success` on THAT sha. A red `e2e` with no plausible cause is re-run once (`gh run rerun <run id> --failed`); a second red is investigated, not re-run. **Merging is danlo's call** ("no autonomous merges"); when he says go, `gh api -X PUT repos/dlopez2392/bis-platform/pulls/<n>/merge -f merge_method=merge`, then verify the production deployment's build log names the merge commit, smoke `/`, `/api/cron/reminders` (401), and watch the next `*/15` tick return 200 with `noShowNudges` and `smsReminders` beside the four unchanged shapes.

---

## Plan self-review (done at authoring time, 2026-09-06)

**Spec coverage.** Section 1 (Milestone B = no-show nudge + ~2h SMS reminder, each a registry entry) → Tasks 5–7. Section 2 (generic config, domain stamps, harness unchanged, nothing new sends, providers on ctx, file layout) → Tasks 2, 3, 6, 7; `imports.test.ts` extended in Tasks 3, 6, 7. Section 3's shape reused for the nudge (morning gate, no template tokens, sender appends the link, preview counts body PLUS link, send-then-stamp with `stampWithRetry`) → Tasks 5, 6, 8. Section 4 (brand-name leak prevented structurally — every new due-row type is `brandName`-only, the SMS-reminder row has no email field at all, the sentinel runs all five passes; caps on the nudge, uncapped reminder with the spec's own reasoning; isolation inherited from the harness; fail closed and counted; off by default; grants proven at the layer that sees them) → Tasks 1, 2, 6, 7. Section 5 (zone discrimination, cap pinned on Troll, preview equals send, fail-closed per counter, config validated on write and read, send-then-stamp + retry, due-query projections proven on the real database, watched failing first, gates, mutation record, residuals) → every task; Task 1 watches 0026 fail first at both the pg and PostgREST levels. "Decisions taken after Milestone A shipped": one SMS attempt per booking per day → Task 3 (helper + cooldown, ≤3 attempts pinned in Task 7's coupling test), applied to all three SMS-capable passes in Tasks 3, 6, 7; the completion clock → Tasks 1 (stamp), 2 (window), 4 (gate anchor), with the nudge inheriting both in Task 6.

**Placeholders.** None: every step carries its code, every command its expected output. Five decisions the spec left open are listed in the header with their reasoning, for danlo to overrule before execution rather than discover after.

**Type consistency.** `sendAutomationSms` takes `{ accountId, contactId, to, from, body, onProviderFailure }` and returns `SentSms` in Tasks 3, 6, 7; `markAutomationSmsSent(ctx, accountId, sent, what)` in the same three; `smsCooldownActive(smsFailedAt: string | null, now: Date)` in all three passes with each row's `smsFailedAt`; `laterOf(endsAt: Date, stampedAt: Date | null)` in Tasks 4 and 6; `shouldSendReviewRequestNow(now, anchor, followupSentAt, timezone)` keeps its four arguments in Task 4's gate, its untouched tests, and the pass; `shouldSendNoShowNudgeNow(now, anchor, timezone)` in Tasks 5 and 6; `composeNoShowNudgeSms(body, bookingUrl)` in Tasks 5, 6, 8; `composeSmsReminder(brandName, whenText, body)` in Tasks 7 and 8; `DueNoShowNudge.calendarEnabled` / `calendarPublicId` in Tasks 2, 6 and the sentinel; `DueSmsReminder` has `bookerTimezone` and no `contactEmail` in Tasks 2, 7 and the sentinel; the counter keys in each pass's `EMPTY` fixture, the sentinel, and `route.test.ts`'s `EMPTY_*` constants match the pass's returned object key-for-key; `upsertAutomation`'s patch is `{ enabled, body, config }` in both new actions and their tests; the page hands `NoShowNudgeCard` `{ automation, brandName, smsGate, bookingUrl, calendarEnabled, saveAction }` and `SmsReminderCard` `{ automation, brandName, accountTimezone, smsGate, saveAction }`, which is what the page test asserts.

**Departures from Milestone A's shape, each explained where it happens.** (1) The SMS send path is shared (`send-sms.ts`) rather than copied per pass — the review-request tests, unchanged, are the proof the move preserved it. (2) The link appender and the prose-and-button email body are shared (`sms-link.ts`, `prose-button.ts`) — again with the review request's untouched tests as the proof. (3) The anchor window uses a quoted PostgREST `.or()` filter, proven on the real database, with the unquoted form and a two-read fallback named in case PostgREST refuses it.
