# Automation Engine Part B Implementation Plan — four more recipes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four new recipes on part C's floor — `appointment_confirm` (a text two days out that takes a YES or NO reply), `referral_ask` (the completed-job ladder's third rung), `reactivation` (a once-ever email to a past customer gone quiet) and `quote_followup` (a pipeline-driven check-in) — each a card with a toggle, each through `holdOrSend`, each writing `automation_log` from its first commit.

**Architecture:** Nothing new in the engine. Each recipe is a harness entry: one due-list in `packages/db/src/automations.ts` plus its by-id twin, one pure gate module, one pure copy module, one pass file exporting `processX(ctx, rows, opts)` and `releaseX`, one line in `registry.ts`, one entry each in `RELEASERS` and `SOURCE_TITLES`, one card on the Automations page. The only genuinely new seam is the inbound SMS webhook, which learns to recognise a one-word YES or NO and write it onto the booking — a recorder, never a sender.

**Tech Stack:** Next.js App Router (server components + server actions), `@bis/db` (supabase-js over PostgREST, `serviceDb()`/`userDb()`), Postgres migrations under `packages/db/supabase/migrations`, vitest (unit + live db suite), Playwright (`apps/web/e2e`), Geist/tokens per DESIGN.md.

**Spec:** `docs/superpowers/specs/2026-09-21-automation-engine-b-design.md` (HEAD 782c28b). Read it first; its "Verified facts" section is checked against the tree with file:line and must not be re-derived. It obeys `docs/superpowers/specs/2026-09-21-automation-engine-c-design.md` (as amended 1–11), whose amendment list is authoritative over its body.

### Amendments this plan makes to the spec, and why the tree forced them

- **B1. `AUTOMATION_LOG_SOURCES` grows ONE source per recipe task, not all four alongside the migration.** The spec's migration section says the constant grows "in lockstep" with the CHECK. It cannot usefully: the instant a source is added, `RELEASERS` (`passes/release-held.ts:67`) and `SOURCE_TITLES` (`log-titles.ts:7`) stop compiling, and that red is the registry's bookkeeping. Adding all four at once produces four simultaneous errors an implementer can silence with three `null`s and one real releaser — the exact half-registration the type is there to prevent. Adding one at a time makes the red arrive in the same commit as the releaser and the title that answer it, four times. The SQL CHECK still grows to thirteen in one migration (spec decision 1): a TS constant NARROWER than the database's CHECK is safe in the only direction that matters — nothing can write a source Postgres would reject.
- **B2. `RecipeKey` grows the same way**, one key per recipe's data-layer task, for the same reason and to keep Task 1's diff to one `.sql` file and one test file a reviewer can reject on its own.
- **B3. A vanished `stageId` cannot be logged on a normal tick.** The spec says it "skips with a new reason". It cannot: the due-list filters on `stage_id`, so a vanished stage produces no row, and an `automation_log` write needs a subject with a channel (`review-request.ts:85-92` makes the identical argument for an invalid config — console only, no row). So `REASONS.stageGone` is written by `releaseQuoteFollowup` (a held row whose stage vanished during the hold — a real, reachable case) and the operator-facing warning lives on the card, which can see the account's stages.
- **B4. The `appointment_confirm` reassurance lives in the LEAD, not the operator's body.** Decision 6 buys certainty with the ask's own words; if "either way we'll see it" sat in an editable body, the copy test asserting it would assert a default the operator can delete. So the recipe follows `composeSmsReminder` (`sms-reminder-copy.ts:29`): a fixed lead the operator cannot rearrange, plus an optional closing line.
- **B5. `listDueReactivations` is five narrow reads, not one nested `!inner` embed.** Every predicate stays server-side; the split exists because `months` is per-account config and a single query cannot carry four different cutoffs.
- **B6. Two hunks land in `bis-booking`'s files** — `BookingRow.confirm_reply`/`confirm_reply_at` in `packages/db/src/booking.ts` (`BookingRow` at :19-33, `BOOKING_COLS` at :92-96) and one badge in `calendar/bookings-list.tsx`. Task 4 names them exactly; the dispatching brief must say so and `bis-booking` reviews that task.
- **B7. THREE new email template files, not one.** The spec names `reactivation`'s channel as email; `referral_ask` and `quote_followup` are configured-channel and therefore need one each too. So `apps/web/src/lib/email/templates/{referral-ask,reactivation,quote-followup}.ts` are created. `bis-comms` owns the shell and the rules; this plan writes only content and each file reuses `shell()` + `escapeHtml()` exactly as `bookingFollowupEmail` does (`followup.ts:44-47`) — no new shell primitive, no button in any of the three, because in all three the action is "reply to this email" and a button would need somewhere to point.
- **B8. The `INTERNAL_MILESTONE` guard already covers every new message key.** The spec asks each `*-copy.ts` for its own guard test. `apps/web/src/lib/messages.test.ts:44-51` already walks EVERY key in the catalogue and fails any that matches `/\bM\d[a-z]?\b/`, with a named `AGENCY_ONLY` allowlist that a second test keeps from rotting. That is strictly stronger than a per-module assertion, and every key this plan adds is covered by it the moment it is added. The per-copy tests in Tasks 3, 6, 8 and 10 keep their own assertion anyway — they check the COMPOSED string, not just the catalogue entry — but **no implementer adds anything to `AGENCY_ONLY`**: every string in part B is customer-facing.

## Global Constraints

- **The next free migration is `0047`.** Task 1 WRITES it and STOPS. No implementer applies a migration, ever. The orchestrator applies 0047 exactly once and then runs the db suite.
- Two CHECK constraints grow by **drop-and-re-add**, 0027's shape (`0027_instant_reply.sql:28-30`): `automations_recipe_key_check` four keys → eight; `automation_log_source_check` nine values → thirteen.
- **No grant changes.** New columns on existing tables inherit their table's standing (0027's header); `automations-grants.test.ts` pins it. Both CHECK rewrites are constraint-only.
- **`accounts.outbound_suppressed` is honoured by every pass.** Every `listDue*` and every `getDue*ById` goes through `loadSendableRows` (`booking.ts:501-521`), never `loadAccountBrandInfo`. `packages/db/src/__tests__/outbound-suppressed.test.ts` walks `automations.ts` per FUNCTION and fails a `listDue*`/`getDue*ById` that does not. **Its case is written BEFORE the due-list, every time** (the standing rule).
- **A released row is never left untouched on a branch that can repeat.** Every `continue` in a new `processX` is classified: silent on a normal tick, a real `logSkipped` when `opts.released` (`review-request.ts:155-161`; `REASONS.smsCooldown`'s own comment in `hold-or-send.ts:79-88`). A released row left alone keeps its past `held_until` and parks the head of the queue forever.
- **`RELEASERS` and `SOURCE_TITLES` are `Record<AutomationLogSource, …>` and must NEVER be widened to `Partial<…>` or indexed by a cast.** A type error there IS the red; the task report pastes it.
- **Caps** (`caps.ts`, fixed platform constants, recipe passes only): `referral_ask` and `quote_followup` take `AUTOMATION_TICK_CAP = 10` + `AUTOMATION_DAILY_CAP = 25` + `SMS_RETRY_COOLDOWN_MS = 24h` read back off their own `*_sms_failed_at`. `appointment_confirm` is **uncapped and does not read the cooldown back** (spec decision 2; the 75-minute window would make a 24h hold one attempt ever — the text reminder's recorded bug, `caps.ts:34-40`). `reactivation` has its own `REACTIVATION_DAILY_CAP = 5` plus once-per-contact-ever.
- Passes read `ctx.now`, never `new Date()`. Pure modules take `now` as an argument.
- Only `harness.ts` imports `getEmailProvider`/`getSmsProvider` (`imports.test.ts` scans every other file under `lib/automations`). A pass reaches SMS through `ctx.sms()`, lazily, inside the send's own try/catch.
- **Any test that exercises the HELD path must mock `getAutomationLogEntry`.** `holdOrSend` reads it before re-writing a held row (`hold-or-send.ts:137`); a factory mock that omits it throws at the moment the export is read (part C's recorded trap; `sentinel.test.ts:31` already carries it).
- Customer copy passes the "landscaper at 7 AM" read: no milestone codes (`messages.test.ts:44-51` walks the whole catalogue — see B8; nothing in part B goes on its `AGENCY_ONLY` allowlist), no `{{template_syntax}}`, no carrier jargon, deltas as words. A name shown to a customer is `brandDisplayName`, never `accounts.name` — the due-row types carry only `brandName` and `sentinel.test.ts` scans what actually left the building.
- UI: tokens only, status is dot + word, one primary button per view, every card gets loaded/empty/error states, both themes via `.dark`.
- **Mutation proof for every test.** Each test step names the mutation that must red it BY NAME. Run the WHOLE file, watch the named test fail, revert. Avoid the shapes this repo has shipped (`bis-vacuous-test-shapes`): no fixture where two asserted properties share a value; no negative fixture more than one unit past the boundary (it would trip an earlier guard and pass against any ceiling); no literal count that rots; no assertion satisfied by an adjacent element; no `-t` filter on a name that does not exist. If a prescribed mutation cannot fail, say so and substitute one that can.
- **Judge a run by vitest's own summary block.** `pnpm --filter @bis/db exec vitest run …` prints `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` AFTER the real results, so the shell exit code lies for that package. When an exit code matters, capture it to a file with nothing after the command in the same block.
- **Gates (`pnpm check`, `pnpm --filter web build`, `pnpm --filter web test:e2e`) belong to the orchestrator and run one at a time.** Two at once have OOM-killed this machine mid-e2e. Implementers run their domain's tests by path.

## Commands

```
pnpm --filter web exec vitest run src/lib/automations src/app/api/cron "src/app/(dashboard)/dashboard/accounts/[accountId]/automations"
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
- `packages/db/supabase/migrations/0047_automations_b.sql` — both CHECK rewrites, nine columns, five indexes.
- `packages/db/src/test/automations-b-schema.test.ts` — the constraints, the columns, the indexes and the no-grant-change claim, against the live project.
- `apps/web/src/lib/automations/appointment-confirm-gate.ts` (+ `.test.ts`) — the deadline and the too-close check.
- `apps/web/src/lib/automations/appointment-confirm-copy.ts` (+ `.test.ts`) — the fixed lead and the composer.
- `apps/web/src/lib/automations/passes/appointment-confirm.ts` (+ `.test.ts`).
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/appointment-confirm-card.tsx`.
- `apps/web/src/lib/automations/referral-ask-gate.ts` (+ `.test.ts`), `referral-ask-copy.ts` (+ `.test.ts`), `passes/referral-ask.ts` (+ `.test.ts`), `automations/referral-ask-card.tsx`, `apps/web/src/lib/email/templates/referral-ask.ts` (+ `.test.ts`).
- `apps/web/src/lib/automations/reactivation-gate.ts` (+ `.test.ts`), `reactivation-copy.ts` (+ `.test.ts`), `passes/reactivation.ts` (+ `.test.ts`), `automations/reactivation-card.tsx`, `apps/web/src/lib/email/templates/reactivation.ts` (+ `.test.ts`).
- `apps/web/src/lib/automations/quote-followup-gate.ts` (+ `.test.ts`), `quote-followup-copy.ts` (+ `.test.ts`), `passes/quote-followup.ts` (+ `.test.ts`), `automations/quote-followup-card.tsx`, `apps/web/src/lib/email/templates/quote-followup.ts` (+ `.test.ts`).
- `apps/web/e2e/automations-b.spec.ts`.

**Modify**
- `packages/db/src/automations.ts` — four recipe sections appended, `RecipeKey` grown four times.
- `packages/db/src/automation-log.ts` — `AUTOMATION_LOG_SOURCES` grown four times (one per recipe task).
- `packages/db/src/booking.ts` — `BookingRow` and `BOOKING_COLS` gain `confirm_reply`, `confirm_reply_at` (Task 4; `bis-booking`'s file).
- `packages/db/src/index.ts` — **`./automations` is re-exported by a NAMED list (`index.ts:63-77`), not `export *`.** Every new symbol must be added to that list or it does not leave the package. `./automation-log` IS `export *` (`index.ts:84`), so `AUTOMATION_LOG_SOURCES`' growth needs no index change. Each data-layer task appends its own names and touches nobody else's line (the hot-shared-file rule).
- `packages/db/src/__tests__/outbound-suppressed.test.ts` — no code change needed (the walk is generic); its RED is the proof each new due-list is covered.
- `packages/db/src/test/automations.test.ts`, `due-by-id.test.ts` — four recipes' live cases.
- `apps/web/src/lib/automations/caps.ts` — `REACTIVATION_DAILY_CAP`, and the doc comment names `appointment_confirm` as the second uncapped pass.
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
- `docs/superpowers/specs/2026-09-21-automation-engine-b-design.md` (amendments B1–B7), `docs/superpowers/specs/2026-07-25-bis-platform-design.md` §8a M3 row (Task 11).

---

### Task 1: Migration `0047_automations_b.sql` and its proof (bis-db-schema)

**STOP RULE, in this task's own words:** write the migration and the test, run `pnpm --filter @bis/db typecheck`, run the new test file ONCE to record that it fails because the columns do not exist yet, commit, and report `READY_FOR_APPLY`. **Do not apply the migration.** The orchestrator applies 0047 exactly once against the shared Supabase project and then runs the db suite. An implementer who applies it has written to the project every other agent and production share.

**Files:**
- Create: `packages/db/supabase/migrations/0047_automations_b.sql`
- Create: `packages/db/src/test/automations-b-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (for Tasks 2, 5, 7, 9): the columns `bookings.confirm_asked_at`, `bookings.confirm_reply`, `bookings.confirm_reply_at`, `bookings.confirm_sms_failed_at`, `bookings.referral_asked_at`, `bookings.referral_ask_sms_failed_at`, `opportunities.quote_followup_sent_at`, `opportunities.quote_followup_sms_failed_at`, `contacts.reactivation_sent_at`; the eight-key `automations_recipe_key_check`; the thirteen-value `automation_log_source_check`.

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
-- a new column inherits its table's standing (0027's header, proven by
-- automations-grants.test.ts, which reads the catalogue rather than trusting
-- this comment). Both CHECK rewrites are constraint-only and touch no ACL.
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

-- 6. Indexes.
--    (a) Three partial cap-count indexes, 0027's shape: the daily cap counts
--        stamps (no ledger table, no timezone), so `(account_id, <stamp>)
--        where <stamp> is not null` makes each count an index-only read.
--        appointment_confirm gets one too even though it is UNCAPPED - the
--        Activity page and any later per-client cap both count off it.
create index bookings_confirm_asked
  on public.bookings (account_id, confirm_asked_at)
  where confirm_asked_at is not null;
create index bookings_referral_asked
  on public.bookings (account_id, referral_asked_at)
  where referral_asked_at is not null;
create index contacts_reactivation_sent
  on public.contacts (account_id, reactivation_sent_at)
  where reactivation_sent_at is not null;
--    (b) The two due-list indexes. Each carries its due-list's OWN predicates
--        so an idle tick on a busy account reads index tuples and no heap.
create index opportunities_quote_followup_due
  on public.opportunities (account_id, stage_id, stage_changed_at)
  where quote_followup_sent_at is null and status = 'open';
create index bookings_confirm_due
  on public.bookings (account_id, starts_at)
  where confirm_asked_at is null and status = 'booked';
```

- [ ] **Step 2: Write the proof**

`packages/db/src/test/automations-b-schema.test.ts`. It reads the live database, never the `.sql` file: the failure this guards against is "the migration was never applied", and a grep over the migration passes in that world.

> **Before writing, read `packages/db/src/test/booking.test.ts`'s own insert helpers and `packages/db/src/test/fixtures.ts:139` — `withTestAccount(fn: (db: SupabaseClient, accountId: string) => Promise<void>)`.** If `calendars` or `contacts` require columns the seed below does not set, THE SOURCE WINS: copy that file's working insert and say so in the report. Do not invent column names. Also confirm the client import path (`../client` vs `../db`) from a neighbouring test in the same directory.

```ts
import { describe, it, expect } from "vitest";
import { serviceDb } from "../client";
import { withTestAccount } from "./fixtures";

const db = serviceDb();

/** The bookings FKs a test row needs. Inline rather than a shared helper: it
 *  is four lines and this is the only file that wants them. */
async function seedBookingParents(accountId: string) {
  const { data: cal, error: calErr } = await db.from("calendars")
    .insert({ account_id: accountId, public_id: `cal_${Math.random().toString(36).slice(2, 10)}`,
              name: "Main", slug: "main", timezone: "America/Chicago" })
    .select("id").single();
  if (calErr) throw new Error(`seed calendar failed: ${calErr.message}`);
  const { data: ct, error: ctErr } = await db.from("contacts")
    .insert({ account_id: accountId, first_name: "Bo", phone: "+19565550123" })
    .select("id").single();
  if (ctErr) throw new Error(`seed contact failed: ${ctErr.message}`);
  return { calendarId: cal!.id as string, contactId: ct!.id as string };
}

const token = () => `tok_${Math.random().toString(36).slice(2, 12)}`;

describe("0047 - the recipe catalogue is eight keys", () => {
  it("accepts each of the four new recipe keys", async () => {
    await withTestAccount(async (_db, accountId) => {
      for (const key of ["appointment_confirm", "referral_ask", "reactivation", "quote_followup"] as const) {
        const { error } = await db.from("automations")
          .insert({ account_id: accountId, recipe_key: key, enabled: false, body: "", config: {} });
        expect(error, `inserting recipe_key=${key}`).toBeNull();
      }
    });
  });

  it("still refuses a key that is not in the catalogue, by SQLSTATE 23514", async () => {
    await withTestAccount(async (_db, accountId) => {
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
    await withTestAccount(async (_db, accountId) => {
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
    await withTestAccount(async (_db, accountId) => {
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
    await withTestAccount(async (_db, accountId) => {
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
    await withTestAccount(async (_db, accountId) => {
      const { calendarId, contactId } = await seedBookingParents(accountId);
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
    await withTestAccount(async (_db, accountId) => {
      const { calendarId, contactId } = await seedBookingParents(accountId);
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
```

The `status: "cancelled"` on the `confirm_reply` rows is deliberate: `bookings_no_overlap` only binds `status='booked'`, and five rows at the same instant would otherwise collide with each other rather than with the CHECK under test — a negative fixture that trips an EARLIER guard is one of this repo's recorded vacuous shapes.

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

Report `READY_FOR_APPLY`.

- [ ] **Step 4 (ORCHESTRATOR ONLY): apply once, then prove**

```bash
pnpm --filter @bis/db exec vitest run src/test/automations-b-schema.test.ts src/test/automations-grants.test.ts > /tmp/0047-post-apply.log 2>&1; echo "exit=$?" >> /tmp/0047-post-apply.log
```

Expected AFTER apply: `automations-b-schema.test.ts` green, and `automations-grants.test.ts` **still green, unchanged** — that is the migration's "no grant changes" claim proven rather than asserted. Judge both by vitest's own summary block; `@bis/db` prints `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` after the real results, so the shell exit code lies for that package.

---

### Task 2: `appointment_confirm` — the data layer and the reply matcher (bis-db-schema)

**Files:**
- Modify: `packages/db/src/automations.ts` (append a new section after the `sms_reminder` section, before the `instant_reply` section at :560; grow `RecipeKey` at :15)
- Modify: `packages/db/src/index.ts` (append names to the `./automations` NAMED export list, `index.ts:63-77` — this file is shared; touch nobody else's line)
- Modify: `packages/db/src/test/automations.test.ts` (a new `describe` at the end)

**Interfaces:**
- Consumes: Task 1's columns; `loadSendableRows`, `AccountBrandInfo`, `DueLookup` from `./booking`; `listEnabled`, `enabledRecipeFor`, `brandDisplayName` already in this file.
- Produces:
  ```ts
  export type RecipeKey = "review_request" | "no_show_nudge" | "sms_reminder" | "instant_reply" | "appointment_confirm";
  export const APPOINTMENT_CONFIRM_WINDOW_START_MS: number;  // 47h
  export const APPOINTMENT_CONFIRM_WINDOW_END_MS: number;    // 48h15m
  export const APPOINTMENT_CONFIRM_MIN_LEAD_MS: number;      // 24h
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

Expected: FAIL in `outbound suppression > routes every due-list, and every by-id release lookup, through loadSendableRows`, with `expected [ 'automations.ts: listDueAppointmentConfirms' ] to deeply equal []`. Paste that line into the report. (If it passes, the walk is not seeing the new function — check that the declaration is `export async function`, which is what the splitter at `outbound-suppressed.test.ts:39` matches on. A test that cannot fail is not evidence.)

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
 * The instant the ask stops being worth making: 24 hours before the
 * appointment, which is when the email reminder's own window (23h-24h15m,
 * REMINDER_WINDOW_* in booking.ts) opens. Asking "can you confirm?" in the
 * same hour as "here's your reminder" is two texts and one confused customer.
 * Used twice: as the held subject's `deadline` (hold rather than send past
 * usefulness) and as `releaseAppointmentConfirm`'s own re-check.
 */
export const APPOINTMENT_CONFIRM_MIN_LEAD_MS = 24 * 60 * 60 * 1000;

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

const CONFIRM_YES: ReadonlySet<string> = new Set(["yes", "y", "si", "sí", "confirm", "confirmed"]);
const CONFIRM_NO: ReadonlySet<string> = new Set(["no", "n", "cancel"]);

/**
 * The WHOLE message, not a word inside it. "yes please, but move it to
 * Friday" is a conversation, not a confirmation, and "I said no problem" is
 * not a cancellation — a substring match would mis-read both, and the second
 * would tell an operator a customer cancelled when they did not.
 *
 * So: normalise (NFC, because "sí" can arrive as s + U+0301), trim, lowercase,
 * strip TRAILING punctuation and symbols ("yes.", "YES!!", "no 👍"), then test
 * set membership. Anything else returns null and nothing is written at all.
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
 * message (the getAlertPhone pattern, api/sms/inbound/route.ts:126-131).
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
    .is("confirm_reply", null);
  if (uErr) throw new Error(`applyConfirmationReply write failed: ${uErr.message}`);
  return answer;
}
```

- [ ] **Step 4: Export from the package**

`packages/db/src/index.ts`, inside the existing `export { … } from "./automations";` list (`index.ts:63-77`). Append, do not reorder:

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
    ]) {
      expect(matchConfirmationReply(other), JSON.stringify(other)).toBeNull();
    }
  });
});

describe("appointment confirm — data layer", () => {
  it("the window is 47h to 48h15m ahead, 75 minutes wide", () => {
    expect(APPOINTMENT_CONFIRM_WINDOW_START_MS).toBe(47 * HOUR);
    expect(APPOINTMENT_CONFIRM_WINDOW_END_MS).toBe(48 * HOUR + 15 * MINUTE);
    expect(APPOINTMENT_CONFIRM_MIN_LEAD_MS).toBe(24 * HOUR);
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

  it("getDueAppointmentConfirmById mirrors the list's predicates and reports WHY there is no row", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "ById", phone: "(956) 555-0109" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-05-01T15:00:00Z"), endsAt: new Date("2027-05-01T15:30:00Z") }, "user_test");

      // Recipe off → "off", not "gone": the release writes a different reason.
      expect(await getDueAppointmentConfirmById(db, b.id)).toEqual({ due: null, why: "off" });
      await upsertAutomation(db, accountId, "appointment_confirm", { enabled: true, body: "", config: {} }, "user_test");
      // No window check here on purpose: the release is a held row coming back,
      // and its window closed hours ago by definition.
      expect((await getDueAppointmentConfirmById(db, b.id)).due?.bookingId).toBe(b.id);
      await stampAppointmentConfirmAsked(db, b.id);
      expect(await getDueAppointmentConfirmById(db, b.id)).toEqual({ due: null, why: "gone" });
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
      expect((await read(soon)).confirm_reply_at).not.toBeNull();
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
      // Mutation: delete the .eq("account_id", accountId) line → this reds.
      expect(await applyConfirmationReply(db, stranger, contactId, "yes", new Date("2027-06-01T12:00:00Z"))).toBeNull();
      const { data } = await db.from("bookings").select("confirm_reply").eq("id", b.id).single();
      expect((data as { confirm_reply: string | null }).confirm_reply).toBeNull();
    });
  });
});
```

`MINUTE` may not exist in that file — it declares `const HOUR = 60 * 60 * 1000;` at :22. Read the file's own constants first and add `const MINUTE = 60 * 1000;` beside `HOUR` if it is missing; do not shadow it locally in one describe.

- [ ] **Step 7: Run, mutate, commit**

```bash
pnpm --filter @bis/db typecheck
pnpm --filter @bis/db exec vitest run src/test/automations.test.ts src/__tests__/outbound-suppressed.test.ts > /tmp/task2.log 2>&1; echo "exit=$?" >> /tmp/task2.log
```

Expected: vitest's summary block reports the file green. Then run EACH prescribed mutation above, one at a time, confirming the named test fails and reverting. Paste one red assertion line per mutation into the report. A mutation that stays green is a finding, not a pass.

```bash
git add packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts
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
- Modify: `apps/web/src/app/api/cron/reminders/route.test.ts` (one new `EMPTY_*` literal)
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
  No `ProcessOptions` here: this recipe has no morning band, so there is nothing for `released` to skip. The releaser calls `processAppointmentConfirms(ctx, [due])` directly, exactly as `releaseSmsReminder` does (`passes/sms-reminder.ts:166`).

- [ ] **Step 1: The gate, tests first**

`apps/web/src/lib/automations/appointment-confirm-gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { APPOINTMENT_CONFIRM_MIN_LEAD_MS } from "@bis/db";
import { appointmentConfirmDeadline, tooCloseToAsk } from "./appointment-confirm-gate";

const NOW = new Date("2027-04-12T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);

describe("the confirmation ask's deadline", () => {
  it("is exactly 24 hours before the appointment", () => {
    expect(appointmentConfirmDeadline(at(47 * 3600_000)).toISOString())
      .toBe(at(47 * 3600_000 - APPOINTMENT_CONFIRM_MIN_LEAD_MS).toISOString());
  });

  it("is too close to ask AT the lead and one millisecond inside it, not one millisecond outside", () => {
    // The boundary, tested AT the boundary and 1ms either side. A fixture a
    // day past the bound would pass against any lead value.
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
    // Mutation: return false on a NaN instant — all three go red. Fail closed
    // is the house rule for a stamp that cannot be trusted.
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
 * only under a quiet window nearly 24 hours long — the ask is due two days
 * out and the deadline is a day out, so the two rarely meet — and it is
 * declared anyway because the RULE is "never hold something past the point it
 * helps", not "this fires often".
 *
 * `tooCloseToAsk` is what actually bites, in `releaseAppointmentConfirm`: a
 * row held through a long window and released inside the email reminder's own
 * lead is skipped with a reason, never texted.
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
    const lead = appointmentConfirmLead("   ", WHEN);
    expect(lead).toContain(WHEN);
    expect(lead).not.toContain("undefined");
    expect(lead).not.toMatch(/\bus\b.*booked/i);
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
  "automations.appointmentConfirm.lead": "Hi, it's {name}. You're booked for {when}. Reply YES to confirm or NO if you need a different time — either way we'll see it.",
  "automations.appointmentConfirm.leadNoName": "You're booked for {when}. Reply YES to confirm or NO if you need a different time — either way we'll see it.",
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
const send = vi.fn(async () => ({ providerMessageId: "sm_1" }));

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

  it("a released row now INSIDE the reminder's own lead is skipped with its own reason, never texted", async () => {
    // 23h59m out: one minute inside the 24h lead. Not "next hour" — a fixture
    // far past the bound would pass against any lead value.
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({
      due: row({ startsAt: new Date(TICK.getTime() + 24 * 3600_000 - 60_000).toISOString() }),
    });
    expect(await releaseAppointmentConfirm(ctx(), heldRow())).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "skipped", reason: "Too close to the appointment to ask",
    }));
    // Mutation: delete the tooCloseToAsk branch from the releaser → reds, and
    // the row would have been texted a day before an appointment it was meant
    // to precede by two.
  });

  it("a released row still 24h01m out DOES send — the boundary from the other side", async () => {
    dbMocks.getDueAppointmentConfirmById.mockResolvedValue({
      due: row({ startsAt: new Date(TICK.getTime() + 24 * 3600_000 + 60_000).toISOString() }),
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
});
```

Run it: expected FAIL on the missing `./appointment-confirm` module.

- [ ] **Step 9: Write the pass**

`apps/web/src/lib/automations/hold-or-send.ts` — add ONE key inside `REASONS` (additive; touch no other line):

```ts
  /** The confirmation ask, released after a long hold into the email
   *  reminder's own lead. Asking "can you confirm?" in the same hour as
   *  "here's your reminder" is two texts and one confused customer. */
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
 * THE DEADLINE. The subject carries `starts_at − 24h`: at or before the quiet
 * window's end, holdOrSend sends now rather than holding past usefulness. It
 * is reachable only under a near-24-hour quiet window (the ask is due two days
 * out; the deadline is a day out), and it is declared because the rule is
 * "never hold something past the point it helps". What actually bites is
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

`apps/web/src/lib/automations/registry.ts` — one import and one entry, AFTER `smsReminderPass` and before `siteTrafficPass`. Order is part of the contract; extend the file's own doc comment with one sentence:

```ts
import { appointmentConfirmPass } from "./passes/appointment-confirm";
// …
export const PASSES: readonly Pass[] = [releaseHeldPass, remindersPass, followupsPass, reviewRequestPass, noShowNudgePass, smsReminderPass, appointmentConfirmPass, siteTrafficPass, weeklyClientReportPass, weeklyAgencyReportPass];
```

> The confirmation ask reads nothing the other booking passes write and writes only its own stamp, so it sits with them rather than between them: after the text reminder, before the site-traffic pull.

`apps/web/src/app/api/cron/reminders/route.test.ts` — add the empty-counter literal beside its siblings and into the expected JSON body:

```ts
const EMPTY_APPOINTMENT_CONFIRMS = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedNoAddress: 0, skippedSmsGate: 0 };
```

> **Read that file before editing.** Its `vi.mock("@bis/db", () => ({…}))` FACTORY mocks throw on an export they do not define, at the moment the export is read — it broke twice before (`route.test.ts:24-29`). Add `listDueAppointmentConfirms`, `getDueAppointmentConfirmById`, `stampAppointmentConfirmAsked` and `stampAppointmentConfirmSmsFailed` to every factory that needs them, and copy the pass key `appointmentConfirms` exactly.

`apps/web/src/lib/automations/sentinel.test.ts` — add `listDueAppointmentConfirms: vi.fn(), getDueAppointmentConfirmById: vi.fn(), stampAppointmentConfirmAsked: vi.fn(), stampAppointmentConfirmSmsFailed: vi.fn()` to its `dbMocks` block (`sentinel.test.ts:17-33`), and one due-row returning the internal label nowhere — the absence pin at the bottom of its first describe extends to `DueAppointmentConfirm`.

- [ ] **Step 11: The schedule coupling**

`apps/web/src/lib/automations/cron-coupling.test.ts` — extend the import and add two cases:

```ts
it("the appointment-confirm window is wider than one tick, and asks two days out", () => {
  const tick = tickIntervalMs(entry!.schedule);
  expect(APPOINTMENT_CONFIRM_WINDOW_END_MS - APPOINTMENT_CONFIRM_WINDOW_START_MS).toBeGreaterThan(tick);
  expect(APPOINTMENT_CONFIRM_WINDOW_START_MS).toBe(47 * 60 * MINUTE);
  expect(APPOINTMENT_CONFIRM_WINDOW_END_MS).toBe(48 * 60 * MINUTE + 15 * MINUTE);
  // Mutation: move the window start to 46h without touching vercel.json → red.
});

it("the confirmation ask stops before the email reminder's own window opens", () => {
  // Two texts in one hour — "can you confirm?" and "here's your reminder" —
  // is the collision this bound exists to prevent. Mutation: drop the lead to
  // 22h → the second assertion reds while the first still passes.
  expect(APPOINTMENT_CONFIRM_MIN_LEAD_MS).toBe(24 * 60 * MINUTE);
  expect(APPOINTMENT_CONFIRM_MIN_LEAD_MS).toBeGreaterThanOrEqual(REMINDER_WINDOW_START_MS);
});
```

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
            <p className="text-xs text-muted-foreground" data-testid="appointment-confirm-preview">
              {m["automations.appointmentConfirm.preview"]}: {previewText}
            </p>
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

> The destructuring array at `page.tsx:45` is positional. Add the new binding in the SAME position as the new promise, and re-read the whole array after editing — a positional mismatch here silently hands one card another's row.

`…/automations/actions.test.ts` — the agency gate case (a client call returns `{ ok: false, error: m["automations.agencyOnly"] }` and `upsertAutomation` is not called) and the body-length case, mirroring `saveSmsReminderAction`'s existing cases. `…/automations/page.test.ts` — the card renders, and the degraded state when the read rejects.

- [ ] **Step 14: Run everything, mutate, commit**

```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run src/lib/automations src/app/api/cron "src/app/(dashboard)/dashboard/accounts/[accountId]/automations"
```

Expected: the summary block reports every file green, `sentinel.test.ts` included. Then, one at a time and each reverted:

| Mutation | Test that must red, BY NAME |
| --- | --- |
| remove `"either way we'll see it"` from `automations.appointmentConfirm.lead` | `CARRIES THE REASSURANCE, because there is no text back` |
| bypass `holdOrSend` and call `send()` directly | `inside the window it HOLDS: no send, no stamp, one held row with the window's end` |
| delete the `found.due.accountId !== row.account_id` branch | `a released row whose account does not match the subject NEVER sends` |
| delete the `tooCloseToAsk` branch from the releaser | `a released row now INSIDE the reminder's own lead is skipped with its own reason, never texted` |
| change `APPOINTMENT_CONFIRM_WINDOW_START_MS` to 46h | `the appointment-confirm window is wider than one tick, and asks two days out` |
| change `APPOINTMENT_CONFIRM_MIN_LEAD_MS` to 22h | `the confirmation ask stops before the email reminder's own window opens` |
| delete `appointment_confirm` from `SOURCE_TITLES` | `pnpm --filter web typecheck`, TS2741 — paste it |

```bash
git add apps/web/src/lib/automations apps/web/src/app/api/cron/reminders/route.test.ts apps/web/src/lib/messages.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations" packages/db/src/automation-log.ts
git commit -m "automations(appointment_confirm): the two-day confirmation text, its card and its release path"
```

---

### Task 4: The inbound webhook recognises a one-word answer (bis-comms; two hunks in bis-booking's files, named below)

This is the one genuinely new seam in part B. The inbound SMS route does no keyword handling at all today: it drops self-texts from `accounts.alert_phone`, dedupes on `payload.id`, then `createContact` → `ensureConversation` → `createMessage` → `incrementUnreadCount`, and nothing reads the body (`route.ts:95-174`). `handleInbound` is the only place a reply can be recognised.

**What this task adds, exactly:** one `await` after `incrementUnreadCount`, in its own try/catch, calling Task 2's `applyConfirmationReply`.

**What it must NOT do, and each is a decision recorded in the spec:**
- **No send of any kind.** No reply-back, no `sendInstantReply`, no alert text. A YES gets silence and the ask's own "either way we'll see it" is what covers the customer (decision 6). A reply-back is a LATER DECISION, not a gap.
- **No change to `bookings.status`.** A NO records the answer and raises the unread count the message already raised; the operator cancels (decision 5, DESIGN.md rule 6).
- **No throw that escapes.** The route's outer catch logs and still returns 200, so an uncontained throw here reads to Telnyx as "handled" while the customer's whole message is discarded. This is the `getAlertPhone` containment pattern (`route.ts:126-131`), and the message is not a nicety — the keyword recognition is.
- **No new event, no new table, no second scheduler.**

**Files:**
- Modify: `apps/web/src/app/api/sms/inbound/route.ts` (the import at :27-31, and one block at the end of `handleInbound`, after `await incrementUnreadCount(db, accountId, conversation.id);` at :173)
- Modify: `apps/web/src/app/api/sms/inbound/route.test.ts`
- Modify: `packages/db/src/booking.ts` — **bis-booking's file.** `BookingRow` (:19-33) and `BOOKING_COLS` (:92-96) gain `confirm_reply` and `confirm_reply_at`. Additive, two lines, no behaviour change.
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.tsx` — **bis-booking's file.** One badge beside the status badge at :135.

**Interfaces:**
- Consumes: `applyConfirmationReply(db, accountId, contactId, text, now): Promise<"yes" | "no" | null>` from Task 2.
- Produces: nothing other agents import.

- [ ] **Step 1: Tests first**

Append to `apps/web/src/app/api/sms/inbound/route.test.ts`. **Read that file first** — it already builds a Telnyx envelope and mocks `@bis/db`; reuse its helpers and add `applyConfirmationReply: vi.fn()` to the existing factory mock rather than writing a second one. A factory mock (no `importOriginal`) throws on an export it does not define, at the moment the export is read.

```ts
describe("an inbound text that is a one-word answer", () => {
  it("records the answer AFTER the message is filed, and sends nothing", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue("yes");
    await POST(inboundRequest({ from: "+19565550107", to: OUR_NUMBER, text: "YES" }));
    // Order matters: the customer's message is filed first, always.
    expect(dbMocks.createMessage).toHaveBeenCalled();
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalled();
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledWith(
      expect.anything(), ACCOUNT_ID, CONTACT_ID, "YES", expect.any(Date));
    // Mutation: move the call ABOVE createMessage → the order assertion below reds.
    const filedAt = dbMocks.createMessage.mock.invocationCallOrder[0]!;
    const answeredAt = dbMocks.applyConfirmationReply.mock.invocationCallOrder[0]!;
    expect(answeredAt).toBeGreaterThan(filedAt);
  });

  it("NEVER sends a text back — the route is a recorder", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue("yes");
    const res = await POST(inboundRequest({ from: "+19565550107", to: OUR_NUMBER, text: "yes" }));
    expect(res.status).toBe(200);
    // The route has no send path at all; this is the assertion that keeps it
    // that way. Mutation: add any outbound send to handleInbound → red.
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.createMessage.mock.calls[0]![2].direction).toBe("inbound");
  });

  it("a failure recording the answer NEVER discards the customer's message", async () => {
    dbMocks.applyConfirmationReply.mockRejectedValue(new Error("db blip"));
    const res = await POST(inboundRequest({ from: "+19565550107", to: OUR_NUMBER, text: "no" }));
    expect(res.status).toBe(200);
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.incrementUnreadCount).toHaveBeenCalledTimes(1);
    // Mutation: drop the try/catch around the call → the rejection escapes to
    // the route's outer catch, which logs and STILL returns 200, so the status
    // assertion stays green and only this one reds. That is why the assertion
    // is on createMessage/incrementUnreadCount having run, not on the status.
  });

  it("an ordinary message still goes through untouched", async () => {
    dbMocks.applyConfirmationReply.mockResolvedValue(null);
    await POST(inboundRequest({ from: "+19565550107", to: OUR_NUMBER, text: "can you come Tuesday instead?" }));
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.applyConfirmationReply).toHaveBeenCalledTimes(1);   // it decides; the route does not pre-filter
  });

  it("a text from the account's own alert phone never reaches the matcher", async () => {
    dbMocks.getAlertPhone.mockResolvedValue("+19565559999");
    await POST(inboundRequest({ from: "+19565559999", to: OUR_NUMBER, text: "yes" }));
    expect(dbMocks.applyConfirmationReply).not.toHaveBeenCalled();
    // Mutation: move the new block above the alert-phone guard → red.
  });
});
```

`ACCOUNT_ID`, `CONTACT_ID`, `OUR_NUMBER`, `inboundRequest`, `smsSend` and `dbMocks` are that file's own names — read them and use them verbatim. If it has no `smsSend` handle (the route imports no SMS provider today, which is the point), assert instead that the route's module graph contains no send: `expect(Object.keys(await import("@/lib/sms"))).toBeDefined()` is NOT an assertion — substitute `expect(readFileSync(routePath, "utf8")).not.toMatch(/getSmsProvider|sendSmsAction|sendAutomationSms/)` and say in the report that you substituted, and why.

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm --filter web exec vitest run src/app/api/sms/inbound/route.test.ts
```

Expected: FAIL — `applyConfirmationReply` was never called (`expected "spy" to be called 1 times, but got 0 times`). Paste the line.

- [ ] **Step 3: The one block in the route**

`apps/web/src/app/api/sms/inbound/route.ts` — extend the `@bis/db` import at :27-31 with `applyConfirmationReply`, and append this at the end of `handleInbound`, immediately after `await incrementUnreadCount(db, accountId, conversation.id);`:

```ts
  // PART B: the appointment-confirmation answer. The ONE place in this
  // platform where an inbound text means something other than "a person
  // wrote in" — `appointment_confirm` asks "Reply YES to confirm or NO if
  // you need a different time", and this records what they said.
  //
  // CONTAINED ON PURPOSE, the getAlertPhone pattern above. This route's
  // outer catch logs and still returns 200, so an uncontained throw here is
  // reported to Telnyx as "handled" while the customer's whole message —
  // already written above — would be the last thing that happened before the
  // failure. The message is the product; the keyword is a convenience. A
  // failed recognition therefore degrades to "nobody recorded the answer",
  // which the operator sees as an ordinary unread text saying "yes".
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

Expected: the summary block reports the file green. Run each prescribed mutation, confirm the named test reds, revert.

- [ ] **Step 5: The operator sees the answer (bis-booking's two files)**

`packages/db/src/booking.ts` — `BookingRow` (:19-33) gains two fields and `BOOKING_COLS` (:92-96) gains the two names. Additive only; do not reorder the existing ones:

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

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.tsx` — beside the status badge at :135, dot-plus-word like every status in this app (DESIGN.md rule 3 — never colour alone), tokens only:

```tsx
                        {b.confirm_reply ? (
                          <Badge variant="outline" data-testid="booking-confirm-reply">
                            {b.confirm_reply === "yes"
                              ? m["calendar.bookings.confirmed"]
                              : m["calendar.bookings.confirmDeclined"]}
                          </Badge>
                        ) : null}
```

The two message keys were added in Task 3, Step 6. A test in that page's own test file: a booking with `confirm_reply: "yes"` renders "Confirmed by text"; one with `null` renders neither string. Mutation: render `b.confirm_reply` itself → the test reds on the raw word `yes` appearing where a sentence belongs.

- [ ] **Step 6: Run the touched suites and commit**

```bash
pnpm --filter web typecheck
pnpm --filter web exec vitest run src/app/api/sms "src/app/(dashboard)/dashboard/accounts/[accountId]/calendar"
pnpm --filter @bis/db typecheck
```

```bash
git add apps/web/src/app/api/sms/inbound packages/db/src/booking.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/calendar/bookings-list.tsx"
git commit -m "sms(inbound): recognise a one-word YES or NO and record it on the booking — no reply, no status change"
```

---

### Task 5: `referral_ask` — the data layer (bis-db-schema)

**Files:**
- Modify: `packages/db/src/automations.ts` (a new section; `RecipeKey` gains `"referral_ask"`)
- Modify: `packages/db/src/index.ts` (append names to the `./automations` list)
- Modify: `packages/db/src/test/automations.test.ts`

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

Add the skeleton (`export async function listDueReferralAsks(db, nowIso) { void db; void nowIso; return []; }`), run

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

const REFERRAL_ASK_SELECT =
  "id, account_id, contact_id, ends_at, completed_at, followup_sent_at, review_requested_at, "
  + "referral_ask_sms_failed_at, contacts(email, phone)";

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
 *  table and no timezone: "a day" is a rolling 24 hours from the tick. */
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
  it("the cap is the review request's cap plus one local day", () => {
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
      // a fixture far past the bound passes against any ceiling.
      const atCeiling = await mk(new Date(now.getTime() - REFERRAL_ASK_MAX_AGE_MS));
      const pastCeiling = await mk(new Date(now.getTime() - REFERRAL_ASK_MAX_AGE_MS - 1));
      const stamped = await mk(new Date(now.getTime() - 40 * HOUR));
      await stampReferralAsked(db, stamped.id);

      const list = await listDueReferralAsks(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(fresh.id);
      expect(ids).toContain(atCeiling.id);
      expect(ids).not.toContain(pastCeiling.id);    // Mutation: widen the cap by an hour
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
      expect((data as { referral_ask_sms_failed_at: string | null }).referral_ask_sms_failed_at).not.toBeNull();
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

Run each prescribed mutation, including swapping `loadSendableRows` for `loadAccountBrandInfo` in `listDueReferralAsks` and confirming the walk reds by name. Then:

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
  // email/templates/referral-ask.ts
  export function referralAskEmail(input: { brand: EmailBrand; body: string }): { subject: string; html: string; text: string };
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
/** 09:00 CDT Sept 24 — inside the 08:00–11:00 band. */
const NOW = new Date("2027-09-24T14:00:00.000Z");
/** The job ended 15:00 CDT Sept 21 — three local days earlier, 71h before NOW. */
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
    const at = new Date(NOW.getTime() - REFERRAL_ASK_MAX_AGE_MS);
    const past = new Date(NOW.getTime() - REFERRAL_ASK_MAX_AGE_MS - 1);
    expect(send({ anchor: at, followup: null, reviewed: new Date(at.getTime() + 60_000), reviewOn: true })).toBe(true);
    expect(send({ anchor: past, followup: null, reviewed: new Date(past.getTime() + 60_000), reviewOn: true })).toBe(false);
    // Mutation: change REFERRAL_ASK_MAX_AGE_MS by one hour → this pair reds.
  });

  it("is outside the morning band at 07:59 and inside at 08:00", () => {
    expect(send({ now: new Date("2027-09-24T12:59:00.000Z") })).toBe(false);   // 07:59 CDT
    expect(send({ now: new Date("2027-09-24T13:00:00.000Z") })).toBe(true);    // 08:00 CDT
    expect(send({ now: new Date("2027-09-24T16:00:00.000Z") })).toBe(false);   // 11:00 CDT
  });

  it("fails CLOSED on an unresolvable zone, a negative elapsed time and an unreadable stamp", () => {
    expect(send({ zone: "CST" })).toBe(false);
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
import { defaultReferralAskBody } from "./referral-ask-copy";

describe("the referral ask's copy", () => {
  it("names the brand and asks for a NAME", () => {
    const body = defaultReferralAskBody("Rio Roofing");
    expect(body).toContain("Rio Roofing");
    expect(body.toLowerCase()).toContain("name and number");
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
    expect(defaultReferralAskBody("   ")).not.toContain("undefined");
    expect(defaultReferralAskBody("   ").toLowerCase()).toContain("name and number");
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
```

`apps/web/src/lib/email/templates/referral-ask.ts` — the follow-up template's restraint (`followup.ts`), no button, because there is nowhere to send anyone:

```ts
import { shell, escapeHtml, type EmailBrand } from "./shell";

export type ReferralAskEmailInput = {
  brand: EmailBrand;
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
    subject: `One favour, from ${input.brand.name}`,
    html,
    text: paragraphs.join("\n\n"),
  };
}
```

`referral-ask.test.ts` beside it: the subject names the brand; the html escapes a body containing `<script>`; the text part carries the operator's paragraph breaks and no HTML; **and the html contains no `href`** (mutation: add a button → red). Model it on `apps/web/src/lib/email/templates/followup.test.ts`, which already tests exactly these properties for the same shell — read it and match its assertions rather than inventing new ones.

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
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
                brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
    accountTimezone: "America/Chicago", fromEmail: null, replyToEmail: null,
    body: "", config: { channel: "sms" },
    ...over,
  };
}
```

Cases, each with its mutation named:

1. **sends by the configured channel and stamps.** `config.channel === "sms"` texts and calls `stampReferralAsked`; `channel: "email"` calls `ctx.email.send` with a subject naming the brand and never touches the SMS provider. Mutation: fall back to email when the SMS gate refuses → case 3 reds.
2. **an invalid config sends nothing and writes NO log row** (the channel is unknown before the config parses, so there is no subject). `c.skippedInvalidConfig` is 1 and `recordAutomationLog` was not called. Mutation: build the subject before parsing → reds.
3. **an SMS gate refusal skips and logs, and never becomes an email.** `c.skippedSmsGate === 1`, `ctx.email.send` not called, a `skipped` row with "Texting isn't set up for this company yet".
4. **THE LADDER.** With `reviewRequestedAt` set to 09:05 CDT *this* morning, `c.waitingForMorning === 1` and nothing sends; with it set to the previous morning, it sends. Mutation: delete the `reviewRequestedAt` clause from the gate → the first half reds.
5. **PRECEDENCE.** `reviewRequestEnabled: true, reviewRequestedAt: null`, anchor 18h old: `c.waitingForReviewRequest === 1`, nothing sent, and **no log row** (a normal tick is silent on this branch — the row is due again tomorrow). With `reviewRequestEnabled: false`, it sends. Mutation: hard-code `reviewRequestEnabled` false inside the pass → the first half reds.
6. **the SMS cooldown is silent on a normal tick and LOGGED on a release.** `smsFailedAt` two hours old: normal tick → `skippedRecentFailure === 1` and `recordAutomationLog` not called; released → `skippedRecentFailure === 1` and one `skipped` row with "Waiting before trying this text again". Mutation: drop the `if (opts.released)` guard so the normal tick logs too → the first half reds; delete the whole branch → the second reds. **This is the parked-row rule: a released row left untouched keeps its past `held_until` and starves every newer hold behind it.**
7. **the daily cap.** With `countReferralAsksSince` returning 25, one row: `skippedCap === 1` asserted BY NAME (never "some skip happened") and a `skipped` row reading "Daily limit reached".
8. **quiet hours hold**, exactly as Task 3's: no send, no stamp, one held row whose `heldUntil` is 08:00 local.
9. **release**: sends; tenancy mismatch skips (mutation: delete the `accountId` comparison); **the review still owed writes `skipped` with "Waiting for the review request to go first", never leaves the row untouched** (mutation: `continue` without logging → the assertion that `recordAutomationLog` was called with that reason reds); recipe off writes "This automation was turned off".

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
import { defaultReferralAskBody } from "../referral-ask-copy";
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
  const { subject, html, text } = referralAskEmail({ brand, body });
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
- `route.test.ts`: `const EMPTY_REFERRAL_ASKS = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedInvalidConfig: 0, skippedNoAddress: 0, skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0, waitingForMorning: 0, waitingForReviewRequest: 0, unresolvableTimezone: 0 };` under the key `referralAsks`, plus the factory-mock exports.
- `sentinel.test.ts`: the four new `dbMocks` entries and a `DueReferralAsk` row.
- `cron-coupling.test.ts`:

```ts
it("the referral ask is the review request's cap plus one local day — one rung further down the ladder", () => {
  expect(REFERRAL_ASK_MAX_AGE_MS).toBe(REVIEW_REQUEST_MAX_AGE_MS + 24 * 60 * MINUTE);
  // And the ladder's whole span, stated once: follow-up 37h, review 61h,
  // referral 85h. Mutation: change any one constant → this reds.
  expect([FOLLOWUP_MAX_AGE_MS, REVIEW_REQUEST_MAX_AGE_MS, REFERRAL_ASK_MAX_AGE_MS])
    .toEqual([37 * 60 * MINUTE, 61 * 60 * MINUTE, 85 * 60 * MINUTE]);
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
| change `REFERRAL_ASK_MAX_AGE_MS` by one hour | `is too stale one millisecond past 85 hours, and fine AT 85 hours` |
| paste a review URL into `automations.referral.defaultBody` | `contains NO LINK, because this is not a review request` |
| `continue` without `logSkipped` on the releaser's precedence branch | the release case asserting the `"Waiting for the review request to go first"` row |
| drop `if (opts.released)` on the cooldown branch | the cooldown case's normal-tick half |
| delete `referral_ask` from `RELEASERS` | `pnpm --filter web typecheck`, TS2741 |

```bash
git add apps/web/src/lib/automations apps/web/src/lib/email/templates apps/web/src/lib/messages.ts apps/web/src/app/api/cron/reminders/route.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations" packages/db/src/automation-log.ts
git commit -m "automations(referral_ask): the ladder's third rung, deferring to the review request explicitly"
```

---

### Task 7: `reactivation` — the data layer (bis-db-schema)

This is the recipe with spam teeth, and the whole of its restraint lives here, in query predicates rather than in hope: a past customer with a COMPLETED booking, an email address, no previous reactivation ever, and a conversation that has been silent for the configured months.

**Files:**
- Modify: `packages/db/src/automations.ts` (a new section; `RecipeKey` gains `"reactivation"`)
- Modify: `packages/db/src/index.ts`
- Modify: `packages/db/src/test/automations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const REACTIVATION_MIN_MONTHS = 6;
  export const REACTIVATION_MAX_MONTHS = 18;
  export const REACTIVATION_DEFAULT_MONTHS = 9;
  export const REACTIVATION_CANDIDATE_LIMIT = 200;
  export type ReactivationConfig = { months: number };
  export function parseReactivationConfig(raw: unknown): ReactivationConfig | null;
  export function reactivationCutoff(now: Date, months: number): Date;
  export type DueReactivation = {
    contactId: string; accountId: string; conversationId: string;
    lastMessageAt: string; quietMonths: number;
    contactEmail: string; contactName: string;
    brandName: string; branding: Branding; accountTimezone: string;
    fromEmail: string | null; replyToEmail: string | null; body: string;
  };
  export async function listDueReactivations(db: SupabaseClient, nowIso: string): Promise<DueReactivation[]>;
  export async function getDueReactivationById(db: SupabaseClient, contactId: string): Promise<DueLookup<DueReactivation>>;
  export async function conversationQuietSince(db: SupabaseClient, accountId: string, contactId: string, sinceIso: string): Promise<boolean>;
  export async function stampReactivationSent(db: SupabaseClient, contactId: string): Promise<void>;
  export async function countReactivationsSince(db: SupabaseClient, accountId: string, sinceIso: string): Promise<number>;
  ```

> **`reactivationCutoff` lives in `packages/db`, not in `reactivation-gate.ts`**, because the due-list needs it and `packages/db` cannot import from `apps/web`. The web gate holds only `shouldSendReactivationNow(now, timezone)`. That split is deliberate and is the reason this file, not the gate's, carries the month-arithmetic tests.

- [ ] **Step 1: RED FIRST — the suppression walk**

Add the skeleton `export async function listDueReactivations(db, nowIso) { void db; void nowIso; return []; }`, run

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
 * How many conversations one tick will look at. The per-account daily cap is
 * five, so this is not a throughput limit — it is the bound that keeps the
 * three follow-up reads (contacts, bookings, messages) narrow `.in(...)`
 * queries rather than table scans. Rows beyond it are the next tick's, and
 * the ordering (oldest conversation first) means nobody starves.
 */
export const REACTIVATION_CANDIDATE_LIMIT = 200;

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
  /** The subject of the quiet test, and the row the lagging-touch guard reads. */
  conversationId: string;
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

/**
 * FIVE narrow reads, and every predicate is server-side. One nested `!inner`
 * embed would express it in one query, but `months` is PER ACCOUNT config and
 * a single query cannot carry four different cutoffs — so the widest cutoff
 * goes to Postgres and each row is then narrowed to its own account's.
 *
 *   1. which accounts have the recipe on, and with what config;
 *   2. conversations quiet since the WIDEST cutoff, oldest first, bounded;
 *   3. contacts: unstamped, with an email;
 *   4. bookings: at least one COMPLETED — the rule that stops this being a
 *      blast, and it is a query predicate, not a hope;
 *   5. messages: the lagging-touch guard. `createMessage` touches
 *      `conversations.last_message_at` best-effort and non-fatally
 *      (messaging.ts:120-131), so the column can LAG reality. A candidate
 *      whose conversation actually has a newer message is dropped here.
 *
 * Ordered by `last_message_at` ascending throughout, so the five a day drain
 * oldest-first and nobody starves.
 */
export async function listDueReactivations(
  db: SupabaseClient, nowIso: string,
): Promise<DueReactivation[]> {
  const enabled = await listEnabled(db, "reactivation", "listDueReactivations");
  if (enabled.size === 0) return [];

  const now = new Date(nowIso);
  // Per-account cutoffs, and the widest (latest, most permissive) of them.
  const cutoffs = new Map<string, { cutoff: Date; months: number; body: string }>();
  for (const [accountId, auto] of enabled) {
    const config = parseReactivationConfig(auto.config) ?? { months: REACTIVATION_DEFAULT_MONTHS };
    cutoffs.set(accountId, {
      cutoff: reactivationCutoff(now, config.months), months: config.months, body: auto.body,
    });
  }
  const widest = new Date(Math.max(...[...cutoffs.values()].map((c) => c.cutoff.getTime())));

  const { data: convos, error: cErr } = await db.from("conversations")
    .select("id, account_id, contact_id, last_message_at")
    .in("account_id", [...cutoffs.keys()])
    .lte("last_message_at", widest.toISOString())
    .order("last_message_at", { ascending: true })
    .limit(REACTIVATION_CANDIDATE_LIMIT);
  if (cErr) throw new Error(`listDueReactivations conversations read failed: ${cErr.message}`);

  // Narrow each candidate to ITS OWN account's cutoff. A null
  // `last_message_at` never reaches here (`lte` excludes nulls), which is
  // right: a conversation with no messages says nothing about how long it has
  // been.
  const candidates = ((convos ?? []) as {
    id: string; account_id: string; contact_id: string; last_message_at: string;
  }[]).filter((c) => new Date(c.last_message_at).getTime() <= cutoffs.get(c.account_id)!.cutoff.getTime());
  if (candidates.length === 0) return [];

  const contactIds = candidates.map((c) => c.contact_id);
  const { data: contacts, error: ctErr } = await db.from("contacts")
    .select("id, first_name, last_name, email")
    .in("id", contactIds)
    .is("reactivation_sent_at", null)
    .not("email", "is", null);
  if (ctErr) throw new Error(`listDueReactivations contacts read failed: ${ctErr.message}`);
  const eligible = new Map(((contacts ?? []) as {
    id: string; first_name: string | null; last_name: string | null; email: string;
  }[]).map((c) => [c.id, c] as const));
  if (eligible.size === 0) return [];

  // THE ANTI-BLAST RULE. Not "a contact", not "a lead" — someone whose job
  // this company actually completed.
  const { data: done, error: bErr } = await db.from("bookings")
    .select("contact_id")
    .in("contact_id", [...eligible.keys()])
    .eq("status", "completed");
  if (bErr) throw new Error(`listDueReactivations bookings read failed: ${bErr.message}`);
  const customers = new Set(((done ?? []) as { contact_id: string }[]).map((b) => b.contact_id));

  // The lagging-touch guard. Bounded by the same candidate limit; if more
  // rows exist than that, the ones seen are still dropped and the rest are
  // caught by the same guard on the next tick.
  const { data: recent, error: mErr } = await db.from("messages")
    .select("conversation_id")
    .in("conversation_id", candidates.map((c) => c.id))
    .gt("created_at", widest.toISOString())
    .limit(REACTIVATION_CANDIDATE_LIMIT);
  if (mErr) throw new Error(`listDueReactivations messages read failed: ${mErr.message}`);
  const notActuallyQuiet = new Set(((recent ?? []) as { conversation_id: string }[]).map((r) => r.conversation_id));

  const surviving = candidates.filter((c) =>
    eligible.has(c.contact_id) && customers.has(c.contact_id) && !notActuallyQuiet.has(c.id));
  if (surviving.length === 0) return [];

  const { sendable, accountInfo } = await loadSendableRows(
    db, surviving as { account_id: string }[], "listDueReactivations");

  return sendable.map((c) => {
    const contact = eligible.get(c.contact_id)!;
    const info = accountInfo.get(c.account_id)!;
    const conf = cutoffs.get(c.account_id)!;
    return {
      contactId: c.contact_id, accountId: c.account_id, conversationId: c.id,
      lastMessageAt: c.last_message_at, quietMonths: conf.months,
      contactEmail: contact.email,
      contactName: [contact.first_name, contact.last_name].filter(Boolean).join(" ").trim(),
      brandName: brandDisplayName(info.branding), branding: info.branding,
      accountTimezone: info.accountTimezone, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail,
      body: conf.body,
    };
  });
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
  const config = parseReactivationConfig(auto.config) ?? { months: REACTIVATION_DEFAULT_MONTHS };
  return {
    due: {
      contactId, accountId,
      conversationId: (convo as { id: string }).id,
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
 * direction — newer than `sinceIso`. The release's own re-check: somebody who
 * wrote in (or was written to) during a hold must never then receive "it's
 * been a while since we were out at your place".
 *
 * Reads `messages`, not `conversations.last_message_at`, for the reason the
 * due-list's fifth query exists: that column's touch is best-effort and can
 * lag. Both directions count, because an operator who texted them last night
 * has a live relationship this recipe must not talk over.
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
 *  did not just interact with the business, which is a blast). */
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
         REACTIVATION_CANDIDATE_LIMIT,
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
      await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "actually I wrote in last week" }, "user_test");
      await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);

      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).not.toContain(contactId);
      // Mutation: delete the messages read → this goes red, and someone who
      // wrote in last week is told "it's been a while".
      expect(await conversationQuietSince(db, accountId, contactId, longAgo.toISOString())).toBe(false);
      expect(await conversationQuietSince(db, accountId, contactId, new Date().toISOString())).toBe(true);
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

- [ ] **Step 5: Run, mutate, commit**

```bash
pnpm --filter @bis/db typecheck
pnpm --filter @bis/db exec vitest run src/test/automations.test.ts src/__tests__/outbound-suppressed.test.ts > /tmp/task7.log 2>&1; echo "exit=$?" >> /tmp/task7.log
```

```bash
git add packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts
git commit -m "db(automations): reactivation due-list — quiet, unstamped, emailable, and a completed job"
```

---

### Task 8: `reactivation` — the recipe (bis-automations)

**Files:**
- Modify: `packages/db/src/automation-log.ts` (`"reactivation"`)
- Modify: `apps/web/src/lib/automations/caps.ts` — **TWO edits:** the new `REACTIVATION_DAILY_CAP`, and the file's opening doc comment grows to name `appointment_confirm` as the second uncapped pass (Task 3's decision, documented here because this is the file that states which passes are capped).
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
describe("when a reactivation email may go", () => {
  it("is inside the morning band at 08:00 and 10:59, outside at 07:59 and 11:00", () => {
    expect(shouldSendReactivationNow(new Date("2027-09-21T12:59:00Z"), ZONE)).toBe(false);  // 07:59
    expect(shouldSendReactivationNow(new Date("2027-09-21T13:00:00Z"), ZONE)).toBe(true);   // 08:00
    expect(shouldSendReactivationNow(new Date("2027-09-21T15:59:00Z"), ZONE)).toBe(true);   // 10:59
    expect(shouldSendReactivationNow(new Date("2027-09-21T16:00:00Z"), ZONE)).toBe(false);  // 11:00
    // Mutation: widen the band by an hour → the 07:59 or the 11:00 row reds.
  });
  it("fails CLOSED on a zone Intl cannot resolve, and on an unreadable instant", () => {
    expect(shouldSendReactivationNow(new Date("2027-09-21T14:00:00Z"), "CST")).toBe(false);
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

Its test asserts: the body names the brand; **contains no "http" and no "%" and no "off" discount language** (mutation: add "10% off" to the default → red); contains no `{{`; no `\bM[0-9][a-z]?\b`; the subject carries no `!` (mutation: add one → red); the no-name variants drop the clause without inventing a noun.

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

`passes/reactivation.test.ts`, the Task 3 shape with mocks `listDueReactivations, getDueReactivationById, stampReactivationSent, countReactivationsSince, conversationQuietSince, recordAutomationLog, getAutomationLogEntry`. `ctx.email.send` is a spy.

Cases, each with its mutation:

1. **sends one email, stamps the contact, writes a `sent` row.** The subject names the brand; the `to` is the contact's email; `ctx.sms` is never called (mutation: send by SMS → `expect(smsProvider.send).not.toHaveBeenCalled()` reds — email only until a per-contact consent column and an approved marketing campaign exist).
2. **outside the morning band, nothing goes and nothing is logged** (`waitingForMorning === 1`, `recordAutomationLog` not called).
3. **THE CAP, asserted by name and by number.** Six due rows, `countReactivationsSince` returning 0: exactly **five** `sent` and **one** `skippedCap`, asserted as `expect(c).toEqual({ …, sent: 5, skippedCap: 1, … })` — not "at least one". Six rows so the assertion cannot be satisfied by `AUTOMATION_TICK_CAP` (10). Mutation: use `AUTOMATION_DAILY_CAP` instead of `REACTIVATION_DAILY_CAP` → six send and this reds.
4. **the cap counts what already went today.** `countReactivationsSince` returning 5, one due row: `skippedCap === 1`, `sent === 0`, and a `skipped` row reading "Daily limit reached".
5. **quiet hours hold**: no send, no stamp, one held row at 08:00 local.
6. **release sends**; **tenancy mismatch skips** (mutation: delete the `accountId` comparison); **already stamped → "No longer due"**; **recipe off → "This automation was turned off"**.
7. **THE QUIET RE-CHECK, the test that keeps a release from being a replay.** `conversationQuietSince` resolving `false` (they wrote in during the hold): the release is `skipped` with "They've been in touch since", `ctx.email.send` was NOT called, and the log row says so. Mutation: remove the `conversationQuietSince` call from the releaser → this reds, and a customer who wrote in last night is told "it's been a while since we were out at your place".

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
    skippedCap: 0, waitingForMorning: 0, unresolvableTimezone: 0,
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
- `route.test.ts`: `const EMPTY_REACTIVATIONS = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedCap: 0, waitingForMorning: 0, unresolvableTimezone: 0 };` under `reactivations`, plus the factory-mock exports.
- `sentinel.test.ts`: the new `dbMocks` entries and a `DueReactivation` row.
- `reactivation-card.tsx`: a form with the toggle, a `<Input type="number" name="months" min={6} max={18} step={1}>` defaulting to 9, the body Textarea, the `limitNote` line rendered always (a cap is context, and DESIGN.md rule 1 says a number never ships alone), and NO channel select — the card states "Email only" in its description rather than offering a choice the product refuses.
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
| remove `conversationQuietSince` from the releaser | the quiet-re-check release case |
| add "10% off" to `automations.reactivation.defaultBody` | the copy's no-offer case |
| add `!` to `automations.reactivation.subject` | the copy's subject case |
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
- Modify: `packages/db/src/automations.ts`; `packages/db/src/index.ts`; `packages/db/src/test/automations.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const QUOTE_FOLLOWUP_MAX_AGE_MS: number;          // 30 days
  export const QUOTE_FOLLOWUP_MIN_QUIET_DAYS = 1;
  export const QUOTE_FOLLOWUP_MAX_QUIET_DAYS = 30;
  export const QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS = 3;
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

const QUOTE_FOLLOWUP_SELECT =
  "id, account_id, contact_id, stage_id, stage_changed_at, quote_followup_sms_failed_at, "
  + "contacts(email, phone)";

/**
 * Latest INBOUND message per contact since `sinceIso` — the "they already
 * replied" test the opportunities query cannot express. Two narrow reads,
 * bounded by the candidate list, so this is one pair of reads per tick and
 * not one per row.
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
    .order("created_at", { ascending: false });
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
    .order("stage_changed_at", { ascending: true });
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
         QUOTE_FOLLOWUP_DEFAULT_QUIET_DAYS,
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
      const { pipelineId } = await ensureDefaultPipeline(db, accountId, "user_test");
      const pipelines = await listPipelinesWithStages(db, accountId);
      const stages = pipelines.find((p) => p.id === pipelineId)!.stages;
      const quoted = stages[1] ?? stages[0]!;
      const other = stages[0]!.id === quoted.id ? stages[stages.length - 1]! : stages[0]!;

      const now = new Date("2027-10-20T12:00:00Z");
      const DAY = 24 * HOUR;
      await upsertAutomation(db, accountId, "quote_followup",
        { enabled: true, body: "", config: { stageId: quoted.id, quietDays: 3, channel: "sms" } }, "user_test");

      const mk = async (name: string, stageId: string, changedAt: Date) => {
        const { id: contactId } = await createContact(db, accountId,
          { firstName: name, email: `${name.toLowerCase()}@example.com`, phone: "(956) 555-0120" }, "user_test");
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
      const wroteBefore = await mk("Before", quoted.id, new Date(now.getTime() - 5 * DAY));
      const convo2 = await ensureConversation(db, accountId, wroteBefore.contactId, "user_test");
      const { id: msg2 } = await createMessage(db, accountId,
        { conversationId: convo2.id, channel: "sms", direction: "inbound", body: "can you quote this?" }, "user_test");
      await db.from("messages").update({ created_at: new Date(now.getTime() - 9 * DAY).toISOString() }).eq("id", msg2);

      const ids = (await listDueQuoteFollowups(db, now.toISOString())).map((r) => r.opportunityId);
      expect(ids).toContain(due.oppId);
      expect(ids).toContain(atBound.oppId);
      expect(ids).toContain(wroteBefore.oppId);      // Mutation: drop the `<=` comparison in the quiet filter
      expect(ids).not.toContain(tooFresh.oppId);     // Mutation: widen quietDays
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
      const { pipelineId } = await ensureDefaultPipeline(db, accountId, "user_test");
      const stage = listPipelinesWithStages(db, accountId).then((p) => p.find((x) => x.id === pipelineId)!.stages[0]!);
      const { id: stageId } = await stage;
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

> `ensureDefaultPipeline`, `listPipelinesWithStages` (both `./crm-config`, both already in the barrel at `index.ts:25`) and `createOpportunity` (`./opportunities`) must be added to this test file's imports. **Read `packages/db/src/test/opportunities.test.ts` first** for the working `createOpportunity` call shape and fix this plan's version against it if it differs; the source wins.

- [ ] **Step 5: Run, mutate, commit**

```bash
pnpm --filter @bis/db typecheck
pnpm --filter @bis/db exec vitest run src/test/automations.test.ts src/__tests__/outbound-suppressed.test.ts > /tmp/task9.log 2>&1; echo "exit=$?" >> /tmp/task9.log
```

```bash
git add packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/automations.test.ts
git commit -m "db(automations): quote_followup due-list off the pipeline stage, with the already-replied test"
```

---

### Task 10: `quote_followup` — the recipe (bis-automations; bis-design-reviewer after)

**Files:**
- Modify: `packages/db/src/automation-log.ts` (`"quote_followup"` — the thirteenth and last)
- Modify: `apps/web/src/lib/automations/hold-or-send.ts` (`REASONS.stageGone`)
- Create: `quote-followup-gate.ts` (+ `.test.ts`), `quote-followup-copy.ts` (+ `.test.ts`), `passes/quote-followup.ts` (+ `.test.ts`)
- Modify: `release-held.ts`, `log-titles.ts`, `registry.ts`, `sentinel.test.ts`, `route.test.ts`, `messages.ts`
- Create: `…/automations/quote-followup-card.tsx`; Modify: `…/automations/{page.tsx,actions.ts,page.test.ts,actions.test.ts}`

- [ ] **Step 1: The gate, tests first**

```ts
import { describe, it, expect } from "vitest";
import { QUOTE_FOLLOWUP_MAX_AGE_MS } from "@bis/db";
import { shouldSendQuoteFollowupNow } from "./quote-followup-gate";

const ZONE = "America/Chicago";
const NOW = new Date("2027-10-20T14:00:00.000Z");   // 09:00 CDT, inside the band
const DAY = 24 * 3600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe("when a quote follow-up may go", () => {
  it("goes once the deal has sat for the configured days, and not a minute before", () => {
    expect(shouldSendQuoteFollowupNow(NOW, ago(3 * DAY), 3, ZONE)).toBe(true);
    expect(shouldSendQuoteFollowupNow(NOW, ago(3 * DAY - 60_000), 3, ZONE)).toBe(false);
    // One minute inside the bound, not "yesterday". Mutation: change `>=` to
    // `>` → the at-bound row reds and nothing else moves.
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

  it("fails CLOSED on an unresolvable zone, a future stage change and an unreadable instant", () => {
    expect(shouldSendQuoteFollowupNow(NOW, ago(5 * DAY), 3, "CST")).toBe(false);
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
  "automations.quoteFollowup.defaultBody": "Hi, it's {name}. Just checking you got the quote we sent — happy to answer anything or adjust it. Any questions?",
  "automations.quoteFollowup.defaultBodyNoName": "Just checking you got the quote we sent — happy to answer anything or adjust it. Any questions?",
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

- [ ] **Step 3: Register the last source**

`AUTOMATION_LOG_SOURCES` gains `"quote_followup"` — the thirteenth, and now the constant and 0047's CHECK agree exactly. Run `pnpm --filter web typecheck`, paste the last pair of TS2741 errors, answer them with real entries.

- [ ] **Step 4: The pass — tests first**

`passes/quote-followup.test.ts`, the Task 6 shape (band-gated, configured channel, caps, cooldown), with mocks `listDueQuoteFollowups, getDueQuoteFollowupById, stampQuoteFollowupSent, stampQuoteFollowupSmsFailed, countQuoteFollowupsSince, latestInboundByContact, recordAutomationLog, getAutomationLogEntry`. `latestInboundByContact` defaults to `vi.fn(async () => new Map())`.

Cases and mutations:

1. **sends by the configured channel, stamps the OPPORTUNITY** (`stampQuoteFollowupSent` called with the opportunity id, never a booking id), and the log's `subjectKey` is `opportunity:<id>` (mutation: write `booking:` → red, and the row would then collide with a booking-subject recipe's line for a different thing).
2. **the body never carries the deal's name or a price** — assert the sent body equals `defaultQuoteFollowupBody("Rio Roofing")` exactly when `body` is blank.
3. **an invalid config sends nothing and writes no log row** (no channel ⇒ no subject).
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

- the subject is `{ source: "quote_followup", channel: config.channel, subjectKey: \`opportunity:${row.opportunityId}\`, contactId: row.contactId }`;
- the band call is `shouldSendQuoteFollowupNow(ctx.now, new Date(row.stageChangedAt), row.quietDays, row.accountTimezone)`, wrapped in `if (!opts.released && …)`;
- there is no `laterOf` anchor — `stage_changed_at` IS the clock, written by both `moveOpportunityStage` and `moveOpportunityToStage`;
- the stamp is `stampQuoteFollowupSent(ctx.db, row.opportunityId)` and the failure marker `stampQuoteFollowupSmsFailed(ctx.db, row.opportunityId)`;
- the cap count is `countQuoteFollowupsSince`, against `AUTOMATION_TICK_CAP` and `AUTOMATION_DAILY_CAP`;
- the SMS body is `row.body.trim() || defaultQuoteFollowupBody(row.brandName)` with **no trailing link** (there is nothing to link to — the quote is a document the operator already sent);
- the email is `shell`-based like the referral ask's, with `quoteFollowupSubject(row.brandName)`; create `apps/web/src/lib/email/templates/quote-followup.ts` in the `referral-ask.ts` shape (no button) and its test (no `href`, escaping, paragraph breaks);
- counters: `{ sent, failed, unstamped, held, skippedInvalidConfig, skippedNoAddress, skippedSmsGate, skippedRecentFailure, skippedCap, waitingForMorning, unresolvableTimezone }`.

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

- `release-held.ts`: `quote_followup: releaseQuoteFollowup`. With this entry `RELEASERS` is complete for all thirteen sources and `Record<AutomationLogSource, …>` compiles again — that, and nothing else, is the proof every new source is releasable.
- `log-titles.ts`: `quote_followup: m["automations.quoteFollowup.title"]`.
- `registry.ts`: `quoteFollowupPass` after `reactivationPass`, before `siteTrafficPass`.
- `route.test.ts`: `EMPTY_QUOTE_FOLLOWUPS` under `quoteFollowups`, plus the factory-mock exports.
- `sentinel.test.ts`: the new `dbMocks` entries and a `DueQuoteFollowup` row. **`latestInboundByContact` must be mocked to return an empty Map**, or the sentinel's run of this pass will try to read a database that is not there.

- [ ] **Step 7: The card, the action, the page**

`quote-followup-card.tsx` — the `NoShowNudgeCard` shape plus two fields and one notice:

- a `Select name="stage_id"` built from `stages: { id: string; name: string }[]`, a prop the page resolves with `listPipelinesWithStages(db, accountId)` (already exported, `index.ts:25`), flattened across pipelines and labelled `"<pipeline> · <stage>"` when there is more than one pipeline;
- **the vanished-stage notice**: when the stored `stageId` is not among `stages`, render `m["automations.quoteFollowup.stageMissing"]` above the select and leave the select unset. This is the operator-facing half of B3 — a normal tick cannot log it, so the settings page is where it must be visible;
- when `stages.length === 0`, render `m["automations.quoteFollowup.noStages"]` and disable the form's submit;
- a `<Input type="number" name="quiet_days" min={1} max={30} step={1}>` defaulting to 3;
- the channel Select, the body Textarea, the segment counter on `body.trim() || defaultQuoteFollowupBody(brandName)`;
- `data-testid="quote-followup-card"`.

`saveQuoteFollowupAction` — agency-gated; `parseQuoteFollowupConfig({ stageId, quietDays: Number(...), channel })`; a null parse returns `m["automations.quoteFollowup.saveFailed"]`, except that an out-of-range day count returns `m["automations.quoteFollowup.quietDaysInvalid"]` and an empty stage with `enabled` returns `m["automations.quoteFollowup.stageRequired"]` (check those two cases BEFORE the parse so the operator gets the specific message, the review-request action's pattern at `actions.ts:44-48`).

`page.tsx` — one more `getAutomation`, plus `listPipelinesWithStages(db, accountId).catch(…) => []` in the same `Promise.all` with its own log line, and the card last. Positional bindings in the same positions.

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
| change `>=` to `>` in `shouldSendQuoteFollowupNow`'s quiet comparison | `goes once the deal has sat for the configured days, and not a minute before` |
| drop the uuid regex from `parseQuoteFollowupConfig` | the db suite's `"Quoted"` row |
| delete `quote_followup` from `RELEASERS` | `pnpm --filter web typecheck`, TS2741 |

```bash
git add apps/web/src/lib/automations apps/web/src/lib/email/templates apps/web/src/lib/messages.ts apps/web/src/app/api/cron/reminders/route.test.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations" packages/db/src/automation-log.ts
git commit -m "automations(quote_followup): chase a quiet quote off the pipeline stage the operator nominates"
```

Then hand the Automations page to `bis-design-reviewer`: eight cards on one page is the first time that page has needed a reading order, and the review question is whether the page still reads as one screen or wants grouping.

---

### Task 11: The Playwright pass, the spec's amendments, the roadmap row (bis-e2e-qa; docs by the orchestrator)

**Files:**
- Create: `apps/web/e2e/automations-b.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-21-automation-engine-b-design.md` (append B1–B7), `docs/superpowers/specs/2026-07-25-bis-platform-design.md` (§8a's M3 row)

**Holds the shared slot.** Playwright and the `packages/db` live suite never run at the same time.

- [ ] **Step 1: The spec, on the per-run fixture account — never `Test Client One`**

`apps/web/e2e/automations-b.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import {
  serviceDb, upsertAutomation, recordAutomationLog, matchConfirmationReply, applyConfirmationReply,
} from "@bis/db";

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

  test("the reactivation card refuses a month count outside 6–18, and says which numbers are allowed", async ({ page }) => {
    const { accountId } = fixture();
    try {
      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("reactivation-card");
      await card.getByRole("checkbox").check();
      // 24 is one step outside the range the card advertises, not 999: a
      // value far outside would be refused by the number input's own max and
      // would never reach the action this test is about.
      await card.getByLabel("Quiet for at least").fill("24");
      await card.getByRole("button", { name: "Save check-ins" }).click();
      await expect(page.getByText("Choose a number of months between 6 and 18.")).toBeVisible();
      // It is a cap, so it ships with its context (DESIGN.md rule 1).
      await expect(card).toContainText("At most five a day");
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

> This spec deliberately does **not** drive a real inbound webhook or a real send. `matchConfirmationReply` and `applyConfirmationReply` are covered by the db suite against the live project (Task 2), and no Playwright test in this repo may call a provider. The two imports above are there for a follow-up assertion only if you add one; if you do not, delete them rather than leaving unused imports.

- [ ] **Step 2: Run it**

```bash
pnpm --filter web exec playwright test e2e/automations-b.spec.ts
```

Expected: `4 passed`. Then the two prescribed mutations, each scoped, each reverted: (a) render `row.source` instead of `SOURCE_TITLES[row.source]` in `activity-table.tsx` → the Activity test reds on both assertions; (b) make the reactivation action clamp instead of refusing → the month-range test reds on the missing error text.

The gate run (`pnpm --filter web build` then `pnpm --filter web test:e2e`) is the ORCHESTRATOR's, one at a time, and it is the arbiter.

- [ ] **Step 3: The spec and the roadmap (orchestrator, on the branch)**

Append to `docs/superpowers/specs/2026-09-21-automation-engine-b-design.md`, under a new `## Amendments taken from the plan (2026-09-21)` heading, B1–B8 exactly as they appear at the top of this plan.

In `docs/superpowers/specs/2026-07-25-bis-platform-design.md` §8a, the M3 row: extend its status text with "part B shipped 2026-09-21 (#<PR>): four more recipes — appointment confirmations with a YES/NO reply recorded on the booking, referral asks as the completed-job ladder's third rung, a once-ever reactivation email to a past customer, and a pipeline-driven quote follow-up. Still owed: a rule builder, deferred until a second client's needs diverge from the catalogue." Keep the row's shape; update the header's "as of" to the merge date and PR number.

```bash
git add apps/web/e2e/automations-b.spec.ts docs/superpowers/specs/2026-09-21-automation-engine-b-design.md docs/superpowers/specs/2026-07-25-bis-platform-design.md
git commit -m "e2e(automations): part B's four cards on the fixture account; spec amendments B1-B8; §8a M3 row"
```

---

## Self-review

**Spec coverage**, section by section:

| Spec section | Task |
| --- | --- |
| Migration `0047_automations_b.sql` (both CHECKs, nine columns, five indexes, no grant changes) | Task 1 |
| Recipe 2 `appointment_confirm` — trigger, window, SMS-only, deadline, uncapped, copy, subject key, release, off switches | Tasks 2, 3 |
| Recipe 2's reply leg — `applyConfirmationReply`, whole-word matching, no reply-back, no status change, the operator sees it | Tasks 2, 4 |
| Recipe 4 `referral_ask` — anchor, ladder, precedence, no-link enforcement, channel config, caps, subject key, release | Tasks 5, 6 |
| Recipe 3 `reactivation` — completed-booking predicate, quiet months 6–18/9, email only, own cap of 5, once per contact, oldest-first, lagging-touch guard, quiet re-check on release | Tasks 7, 8 |
| Recipe 1 `quote_followup` — stage config, quiet days, 30-day ceiling, the inbound-quiet test, stage-gone reason, caps, subject key, release | Tasks 9, 10 |
| `caps.ts` grows: `REACTIVATION_DAILY_CAP`, and the doc comment naming `appointment_confirm` uncapped | Task 8, Step 1 |
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
- The spec asks each `*-copy.ts` for an `INTERNAL_MILESTONE` guard. `messages.test.ts:44-51` already walks the WHOLE catalogue and fails any key that matches, so the per-module tests keep the assertion for the COMPOSED strings only, and nothing in part B joins the `AGENCY_ONLY` allowlist (B8).

**Placeholder scan.** No "TBD", "TODO", "implement later", "add validation", "handle edge cases" or "write tests for the above". Four instructions say "read the file first and the SOURCE wins if it differs" — `packages/db/src/test/booking.test.ts`'s insert helpers (Task 1), `route.test.ts`'s fixture names (Tasks 3 and 4), `packages/db/src/test/messaging.test.ts`'s `ensureConversation`/`createMessage` signatures (Task 7), `packages/db/src/test/opportunities.test.ts`'s `createOpportunity` shape (Task 9). Each names a real file that exists and each is a verification instruction, not a blank: the code around it is given in full, and a brief has been wrong about a signature in this repo before.

Tasks 6, 8 and 10 give their pass files as a full code block (Task 6), or as a complete diff list against a named model file plus the full releaser (Tasks 8 and 10). Repeating `review-request.ts`'s two hundred lines four times would be the larger error: the differences are what an implementer needs and every one of them is enumerated, including counter names, stamp function names, subject-key prefixes and whether a link is appended.

**Type consistency.** `DueLookup<T>` is `{ due: T; why?: undefined } | { due: null; why: "gone" | "off" }` in all four by-id lookups. `Releaser = (ctx: PassContext, row: AutomationLogRow) => Promise<ReleaseVerdict>` for all four releasers. `HoldSubject` carries `accountTimezone` and optional `deadline` and is built AFTER the config parses wherever the channel is configured (`referral_ask`, `quote_followup`) and before anything else where it is fixed (`appointment_confirm`, `reactivation`). Subject-key prefixes: `booking:` for `appointment_confirm` and `referral_ask`, `contact:` for `reactivation`, `opportunity:` for `quote_followup`; each releaser strips its own with the matching regex. Stamp names match their columns one-for-one (`stampAppointmentConfirmAsked`/`confirm_asked_at`, `stampReferralAsked`/`referral_asked_at`, `stampReactivationSent`/`reactivation_sent_at`, `stampQuoteFollowupSent`/`quote_followup_sent_at`). `ProcessOptions = { released: boolean }` is declared locally in `referral-ask.ts`, `reactivation.ts` and `quote-followup.ts` and NOT in `appointment-confirm.ts`, which has no band to skip — the same choice `review-request.ts:52` records. `REASONS` gains exactly four keys — `tooCloseToAppointment`, `reviewFirst`, `heardBack`, `stageGone` — and `heardBack` is deliberately shared by `reactivation` and `quote_followup`, which is why its comment names both. `AUTOMATION_LOG_SOURCES` reaches thirteen across Tasks 3, 6, 8 and 10, matching 0047's CHECK exactly after Task 10.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-21-automation-engine-b.md`. Execution is subagent-driven per the Process section: Task 1 → *orchestrator applies 0047 once and runs the db suite* → Tasks 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11, a five-minute brief review before each dispatch, `bis-reviewer` beside each writer, and the db suite and Playwright one at a time on the shared slot.
