# Automation Engine Part C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One record of everything the automations do on a client's behalf (`automation_log`), one per-account quiet-hours window every customer-facing send obeys (deferred, never skipped, released by a queue), and a client-visible page that shows this month's usage in units and the history of what went out.

**Architecture:** A release-first cron tick: `releaseHeldPass` runs first on every tick and re-runs each held subject through its own pass's per-row path; every customer-facing pass wraps its send in `holdOrSend`, which either sends (and writes a `sent`/`failed` row) or writes a `held` row with `held_until` = the window's end. The held row IS the queue — a subject is never re-discovered by a due-list after its window closes. One row per (account, source, subject) moves through states in place, so history shows one line per thing considered. Quiet hours are a pure module over the account's wall clock; settings live in `automation_settings` (missing row = defaults). The usage and history cards live on a NEW client-visible page, `/activity` ("What went out"), because the Automations page is agency-only by construction and the spec says clients read.

**Tech Stack:** Next.js App Router (server components + server actions), `@bis/db` (supabase-js over PostgREST, `serviceDb()`/`userDb()`), Postgres migrations under `packages/db/supabase/migrations`, vitest (unit + live db suite), Playwright (`apps/web/e2e`), Geist/tokens per DESIGN.md.

**Spec:** `docs/superpowers/specs/2026-09-21-automation-engine-c-design.md` (as amended 8727550). Read it first. Three further amendments this plan makes, recorded here and folded into the spec in Task 9:

- **A9. The usage and history cards live on a new page, `/dashboard/accounts/[accountId]/activity`, both audiences, nav label "Activity", page title "What went out".** The Automations page is gated by `requireAgencyOnlyAccountAccess` and hidden from clients (`nav-groups.ts:152`, `automations/page.tsx:26`); putting client-readable cards there would satisfy nobody. The Quiet hours card stays on the agency Automations page, which gains a "See what went out" link.
- **A10. The agency roll-up does not log.** `automation_log.account_id` is NOT NULL and the roll-up has no account; the client weekly report logs one `email` row per account per week (`week:<monday>`). Sources are therefore exactly nine: `reminders, followups, review_request, no_show_nudge, sms_reminder, instant_reply, weekly_report, concierge, voice`.
- **A11. The Quiet hours card is a form with a Save button**, like every recipe card on that page (the spec's "immediate-save-plus-undo" described the Voice page's toggle, not this page's cards; `automations-settings.tsx:70-85` is the pattern — `useFormSubmit` + `notifyActionResult` + `SubmitButton`).

## Global Constraints

- Tokens only in UI (DESIGN.md): no hard-coded colours/radii/shadows; status is dot + word, never colour alone; every metric carries its period label; empty and error states designed; both themes via `.dark`.
- Copy passes the "landscaper at 7 AM" read. Never a recipe KEY on screen; the sources render as titles (Task 7's `SOURCE_TITLES`).
- `serviceDb()` writes for every automation write; `authenticated` holds SELECT only on both new tables, under RLS `app.is_agency() or account_id = app.current_account_id()`; `anon` nothing. Grants asserted **exactly** and refusals asserted **by SQLSTATE 42501** (never "an error").
- Both new tables `references accounts(id) on delete cascade`; NEITHER joins `ACCOUNT_OWNED_TABLES` nor `apps/web/e2e/fixtures/sweep.ts`; the cascade is PROVEN (Task 1) the way `alert-phone-verification-grants.test.ts:203-220` proves 0036's.
- A log write is an isolated leg: `try/catch`, `console.error`, never fails a send (`hold-or-send.ts`'s `record`).
- No `Date.now()` / `new Date()` inside the pure modules: `now` is always an argument.
- The three morning bands (`shouldSendFollowupNow`, `shouldSendReviewRequestNow`, `shouldSendNoShowNudgeNow`) are UNCHANGED for the normal tick and SKIPPED on release (`{ released: true }`) — the band said when a thing became due; the window says when it may go.
- Reminder exemption: a subject whose `deadline` (the appointment's `starts_at`) is at or before the window's end sends now. On release, a reminder whose appointment has already started is `skipped` with reason "Appointment already started".
- Counters: every customer-facing pass gains `held` (a number, always present, `0` when idle). The release pass reports `{ examined, sent, held, skipped, failed, errored }`.
- Every `vi.mock("@bis/db", () => ({...}))` FACTORY mock (no `importOriginal`) throws on an export it does not define, **at the moment the export is read**. Task 6 lists the factories to extend and the exact exports; do not discover this in CI (it broke `route.test.ts` twice before: `route.test.ts:24-29`).
- Mutation proof for every test: mutate the code the test guards, run the WHOLE file, watch it go red BY NAME, revert. A mutation that stays green is a finding, not a pass (`bis-vacuous-test-shapes`). Each task's brief carries its prescribed mutations; substitute a row that can fail when one cannot, and say so.
- The shared Supabase project: `packages/db`'s live suite and Playwright run ONE AT A TIME across implementers (the "slot"). Implementers stop at `READY_FOR_DB` / `READY_FOR_PLAYWRIGHT` and are resumed for the slot.
- Migrations are written by Task 1 and NEVER applied by an implementer. The orchestrator applies 0046 exactly once, then runs the db suite.

## Process (danlo, 2026-09-21)

- One implementer at a time in the main checkout; disjoint tasks run in git worktrees (`C:/Users/danlo/bis-wt-<x>`, deps via `pnpm install --frozen-lockfile --prefer-offline`, copy `apps/web/.env.local`).
- Read-only reviewers (`bis-reviewer`, opus) run beside a writer, never in its checkout.
- A five-minute brief review (sonnet) before every dispatch — it caught two real brief bugs on the last wave.
- Playwright and the db suite: one at a time; CI is the arbiter for a one-line spec change.
- Order: **Task 1 ∥ Task 2** (worktrees, disjoint) → orchestrator applies 0046, runs the db suite → **Task 3** → **Task 4a ∥ Task 4b ∥ Task 5** (worktrees; they touch disjoint pass files because Task 3 already added every accessor) → **Task 6** → **Task 7 ∥ Task 8** (worktrees; Task 7 owns `messages.ts` and adds BOTH pages' keys, Task 8 only consumes them) → **Task 9**.
- Owners: Task 1 `bis-db-schema`; Tasks 2–6, 8 `bis-automations` (Task 5's seam is also `bis-crm`'s form pipeline — the brief says so); Task 7 `bis-automations` with `bis-design-reviewer` after; Task 9 `bis-e2e-qa`. Task 6's concierge and voice hunks are one line each inside files `bis-voice` owns — the brief names them and the reviewer reads them as `bis-voice` would.

## File Structure

**Create**
- `packages/db/supabase/migrations/0046_automation_log.sql` — both tables, constraints, indexes, RLS, grants.
- `packages/db/src/automation-log.ts` — `recordAutomationLog`, `listReleasableHolds`, `bumpHeldForAccount`, `listAutomationLog`, `countAutomationUsage`, types.
- `packages/db/src/automation-settings.ts` — `QuietSettings`, `DEFAULT_QUIET_SETTINGS`, `isClock`, `readQuietSettings`, `saveQuietSettings`, `readAccountTimezone`.
- `packages/db/src/test/automation-log-grants.test.ts` — grants, RLS, constraints, cascade, upsert-in-place, settings round trip.
- `packages/db/src/test/due-by-id.test.ts` — the five by-id lookups against the live project.
- `apps/web/src/lib/automations/quiet-hours.ts` (+ `.test.ts`) — pure window math.
- `apps/web/src/lib/automations/hold-or-send.ts` (+ `.test.ts`) — `holdOrSend`, `logSkipped`, `REASONS`, `Releaser`, `subjectOf`, `verdict`.
- `apps/web/src/lib/automations/passes/release-held.ts` (+ `.test.ts`) — the release pass and `RELEASERS`.
- `apps/web/src/lib/automations/log-titles.ts` (+ `.test.ts`) — source → title, channel → word, status → word + treatment.
- `apps/web/src/lib/reports/month-window.ts` (+ `.test.ts`) — this month in the account's zone.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/activity/page.tsx`, `usage-card.tsx`, `activity-table.tsx`, `log-status-pill.tsx`, `page.test.ts`, `activity-table.test.ts`, `usage-card.test.ts`.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/quiet-hours-card.tsx`.
- `apps/web/e2e/activity.spec.ts`.

**Modify**
- `packages/db/src/index.ts` — export the two new modules and the five by-id lookups.
- `packages/db/src/booking.ts` — `DueReminder.contactId`, `DueFollowup.contactId`, `getDueReminderById`, `getDueFollowupById`, `DueLookup<T>`.
- `packages/db/src/automations.ts` — `getDueReviewRequestById`, `getDueNoShowNudgeById`, `getDueSmsReminderById`.
- `apps/web/src/lib/automations/context.ts` — `PassContext.quiet`.
- `apps/web/src/lib/automations/harness.ts` — `quietSettingsReader`, `buildPassContext`.
- `apps/web/src/lib/automations/registry.ts` — `releaseHeldPass` first.
- `apps/web/src/lib/automations/passes/{reminders,followups,review-request,no-show-nudge,sms-reminder}.ts` — `processX` extraction, `holdOrSend`, `logSkipped`, `releaseX`, `held` counter.
- `apps/web/src/lib/automations/instant-reply.ts` — the hold, the payload, `releaseInstantReply`.
- `apps/web/src/lib/automations/passes/weekly-report.ts` — one `sent` row per account-week.
- `apps/web/src/app/api/concierge/[publicId]/turn/route.ts` — one `ai` row per conversation start.
- `apps/web/src/lib/voice/finish-call.ts` — one `ai` row per answered call.
- `apps/web/src/lib/reports/weekly-window.ts` — export `localMidnightInstant`.
- `apps/web/src/lib/nav-groups.ts`, `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/lib/palette/registry.ts`, `apps/web/src/lib/messages.ts`.
- `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/{page.tsx,actions.ts,page.test.ts,actions.test.ts}`.
- `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx` — the status pill row.
- Tests whose fixtures the seam change touches (listed per task): the eight pass-test `ctx()` literals, `route.test.ts`, `sentinel.test.ts`, `instant-reply.test.ts`, `finish-call.test.ts`, the turn route's `route.test.ts`, `weekly-report.test.ts`, `nav-groups.test.ts`, `client-access.spec.ts`.
- `docs/superpowers/specs/2026-09-21-automation-engine-c-design.md` (A9–A11), `docs/superpowers/specs/2026-07-25-bis-platform-design.md` §8a M3 row.

---

### Task 1: Schema — `automation_log`, `automation_settings`, accessors, proof (bis-db-schema)

**STOP RULE:** write the migration, the accessors and the tests; run `pnpm --filter @bis/db typecheck`; run the grants test ONCE to record that it fails with `to_regclass` → null (the table does not exist yet); commit; report `READY_FOR_APPLY`. Do NOT apply the migration. The orchestrator applies it once and runs the suite.

**Files:**
- Create: `packages/db/supabase/migrations/0046_automation_log.sql`
- Create: `packages/db/src/automation-log.ts`
- Create: `packages/db/src/automation-settings.ts`
- Create: `packages/db/src/test/automation-log-grants.test.ts`
- Modify: `packages/db/src/index.ts` (append two export lines after line 81 `export * from "./weekly-report";`)

**Interfaces:**
- Produces (consumed by Tasks 3–8):
  ```ts
  // automation-log.ts
  export const AUTOMATION_LOG_SOURCES: readonly ["reminders","followups","review_request","no_show_nudge","sms_reminder","instant_reply","weekly_report","concierge","voice"];
  export type AutomationLogSource; export type AutomationLogChannel = "sms" | "email" | "ai"; export type AutomationLogStatus = "sent" | "held" | "skipped" | "failed";
  export type AutomationLogRow = { id; account_id; source; channel; contact_id: string|null; subject_key; status; reason; held_until: string|null; payload: Record<string,unknown>; occurred_at };
  export type AutomationLogWrite = { accountId; source; channel; contactId: string|null; subjectKey; status; reason?: string; heldUntil?: string|null; payload?: Record<string,unknown> };
  export async function recordAutomationLog(db, w: AutomationLogWrite): Promise<void>;          // upsert on (account_id, source, subject_key)
  export async function listReleasableHolds(db, nowIso: string, limit?: number): Promise<AutomationLogRow[]>;
  export async function bumpHeldForAccount(db, accountId): Promise<number>;
  export type AutomationLogCursor = { occurredAt: string; id: string };
  export type AutomationLogListRow = AutomationLogRow & { contact_name: string | null };
  export async function listAutomationLog(db, accountId, opts: { limit: number; before?: AutomationLogCursor }): Promise<AutomationLogListRow[]>;
  export type AutomationUsage = { textsSent; emailsSent; conversations; callsHandled; held; skipped; topHeldReason: string|null; topSkippedReason: string|null };
  export async function countAutomationUsage(db, accountId, fromIso, toIso): Promise<AutomationUsage>;
  // automation-settings.ts
  export type QuietSettings = { enabled: boolean; start: string; end: string };  // "HH:MM", 24h
  export const DEFAULT_QUIET_SETTINGS: QuietSettings;  // { enabled: true, start: "21:00", end: "08:00" }
  export function isClock(v: string): boolean;
  export async function readQuietSettings(db, accountId): Promise<QuietSettings>;   // missing row → defaults
  export async function saveQuietSettings(db, accountId, s: QuietSettings, actorId, actorType?): Promise<void>;
  export async function readAccountTimezone(db, accountId): Promise<string | null>;
  ```

- [ ] **Step 1: Write the migration**

`packages/db/supabase/migrations/0046_automation_log.sql`:

```sql
-- 0046_automation_log.sql
-- Automation engine, part C (docs/superpowers/specs/2026-09-21-automation-engine-c-design.md).
--
-- ONE record of everything the automations do on a client's behalf, and ONE
-- quiet-hours window per account.
--
-- automation_log: one row per (account, source, subject). A subject moves
-- through states IN PLACE — held → sent when the window ends, skipped → sent
-- when an address is added, failed → sent when a retry lands — which is why
-- the unique key carries no status. Two things follow, and both are the
-- design rather than tidiness:
--   1. the history shows one line per thing the system considered, wearing
--      its latest status, never a held line and a sent line for one subject;
--   2. the release step (lib/automations/passes/release-held.ts) finds work
--      by `status = 'held' and held_until <= now()`, so a held row IS the
--      queue. The email reminder's due window is 75 minutes wide and the SMS
--      reminder's 45, so a booking held at 22:00 is gone from both due-lists
--      by 08:00 — nothing but this row remembers it.
--
-- `payload` carries what a release needs that the subject row cannot cheaply
-- re-derive (the instant reply's phone, locale and consent flag). Never
-- rendered. `reason` is CLIENT-READABLE plain language ("Held until 8:00 AM —
-- quiet hours", "No email address on file"); the console keeps the detail.
--
-- `on delete cascade`, NOT restrict, and therefore NOT on ACCOUNT_OWNED_TABLES
-- or the e2e sweep list: these rows are derived state about an account, the
-- exact class 0036 and 0039 argued for (account-teardown.ts:30-56). The
-- cascade is proven in automation-log-grants.test.ts, not assumed.
-- `contact_id … on delete set null`: a contact deleted later leaves the line
-- in the history with no name, which is the truth.
create table public.automation_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  source text not null
    constraint automation_log_source_check check (source in (
      'reminders', 'followups', 'review_request', 'no_show_nudge', 'sms_reminder',
      'instant_reply', 'weekly_report', 'concierge', 'voice')),
  channel text not null
    constraint automation_log_channel_check check (channel in ('sms', 'email', 'ai')),
  contact_id uuid references public.contacts(id) on delete set null,
  -- 'booking:<id>', 'submission:<id>', 'conversation:<id>', 'call:<id>', 'week:<YYYY-MM-DD>'
  subject_key text not null,
  status text not null
    constraint automation_log_status_check check (status in ('sent', 'held', 'skipped', 'failed')),
  reason text not null default '',
  held_until timestamptz,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  -- held rows carry held_until; no other status does. A held row without a
  -- release time would sit in the queue forever; a sent row with one would
  -- be released again.
  constraint automation_log_held_until_check check ((status = 'held') = (held_until is not null)),
  constraint automation_log_subject_key unique (account_id, source, subject_key)
);

comment on table public.automation_log is
  'One row per (account, source, subject) for everything the automations, the website assistant and the phone assistant do on a client''s behalf. Status moves in place (held → sent). The release pass reads held rows as its queue. authenticated reads its own account under RLS; service_role writes.';

-- The history page: newest first, keyset on (occurred_at, id).
create index automation_log_account_occurred_idx
  on public.automation_log (account_id, occurred_at desc, id desc);
-- The release pass: every held row whose time has come, across accounts.
create index automation_log_held_idx
  on public.automation_log (held_until) where status = 'held';

-- Grants copy 0025 (automations): authenticated SELECT under RLS, nothing
-- else; anon nothing. Supabase's default ACL hands ALL to every role on a
-- new table (the 0020 lesson), so the revokes live HERE.
alter table public.automation_log enable row level security;
create policy automation_log_tenant on public.automation_log for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
revoke all on public.automation_log from anon, authenticated;   -- 0040's shape: the enumerated revoke leaves PG17's MAINTAIN behind
grant select on public.automation_log to authenticated;


-- automation_settings: the quiet-hours window. One row per account, and a
-- MISSING row means the defaults (21:00–08:00, on) — readQuietSettings
-- returns them without writing, so nothing is inserted until the agency
-- edits. `time` columns: the wall clock in the ACCOUNT's zone
-- (accounts.timezone); the pure module resolves them against an instant.
-- `quiet_start = quiet_end` is the "disabled" spelling the module honours;
-- the CHECK does not forbid it.
create table public.automation_settings (
  account_id uuid primary key references public.accounts(id) on delete cascade,
  quiet_enabled boolean not null default true,
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.automation_settings is
  'Per-account automation settings: the quiet-hours window every customer-facing automated send obeys (held, never skipped). Missing row = defaults. Agency-edited through serviceDb(); authenticated reads its own under RLS.';

alter table public.automation_settings enable row level security;
create policy automation_settings_tenant on public.automation_settings for select to authenticated
  using (app.is_agency() or account_id = app.current_account_id());
revoke all on public.automation_settings from anon, authenticated;
grant select on public.automation_settings to authenticated;
```

- [ ] **Step 2: Write the log accessors**

`packages/db/src/automation-log.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The automation log (0046): one row per (account, source, subject), status
 * moving in place. Every writer is serviceDb() — the table grants
 * `authenticated` SELECT only — and every writer wraps the call as an
 * isolated leg (apps/web's hold-or-send.ts `record`): a log failure never
 * fails a send.
 */
export const AUTOMATION_LOG_SOURCES = [
  "reminders", "followups", "review_request", "no_show_nudge", "sms_reminder",
  "instant_reply", "weekly_report", "concierge", "voice",
] as const;
export type AutomationLogSource = (typeof AUTOMATION_LOG_SOURCES)[number];
export type AutomationLogChannel = "sms" | "email" | "ai";
export type AutomationLogStatus = "sent" | "held" | "skipped" | "failed";

export type AutomationLogRow = {
  id: string; account_id: string;
  source: AutomationLogSource; channel: AutomationLogChannel;
  contact_id: string | null; subject_key: string;
  status: AutomationLogStatus; reason: string;
  held_until: string | null; payload: Record<string, unknown>;
  occurred_at: string;
};

const LOG_COLS =
  "id, account_id, source, channel, contact_id, subject_key, status, reason, held_until, payload, occurred_at";

export type AutomationLogWrite = {
  accountId: string; source: AutomationLogSource; channel: AutomationLogChannel;
  contactId: string | null; subjectKey: string; status: AutomationLogStatus;
  /** Client-readable. Empty for `sent`. */
  reason?: string;
  /** Required when status is `held`, forbidden otherwise (the CHECK agrees). */
  heldUntil?: string | null;
  /** What a release needs that the subject row cannot re-derive. Never rendered. */
  payload?: Record<string, unknown>;
};

/**
 * UPSERT on the subject key: the same subject written again REPLACES its
 * row (status, reason, held_until, payload, occurred_at). That is the whole
 * "one line per subject" contract, so a caller never has to know whether a
 * row exists. `occurred_at` is the moment of the latest transition.
 */
export async function recordAutomationLog(db: SupabaseClient, w: AutomationLogWrite): Promise<void> {
  if ((w.status === "held") !== Boolean(w.heldUntil)) {
    throw new Error(`recordAutomationLog: status ${w.status} ${w.heldUntil ? "must not carry" : "needs"} heldUntil`);
  }
  const { error } = await db.from("automation_log").upsert({
    account_id: w.accountId, source: w.source, channel: w.channel, contact_id: w.contactId,
    subject_key: w.subjectKey, status: w.status, reason: w.reason ?? "",
    held_until: w.status === "held" ? w.heldUntil : null,
    payload: w.payload ?? {},
    occurred_at: new Date().toISOString(),
  }, { onConflict: "account_id,source,subject_key" });
  if (error) throw new Error(`recordAutomationLog failed: ${error.message}`);
}

/** The release pass's queue: held rows whose time has come, oldest first. */
export async function listReleasableHolds(
  db: SupabaseClient, nowIso: string, limit = 200,
): Promise<AutomationLogRow[]> {
  const { data, error } = await db.from("automation_log").select(LOG_COLS)
    .eq("status", "held").lte("held_until", nowIso)
    .order("held_until", { ascending: true }).limit(limit);
  if (error) throw new Error(`listReleasableHolds failed: ${error.message}`);
  return (data ?? []) as AutomationLogRow[];
}

/**
 * Called by the quiet-hours SAVE: every held row of the account becomes due
 * for another look on the next tick, where holdOrSend re-evaluates it under
 * the NEW window (re-holding it if still quiet). Without this, turning
 * quiet hours off would leave tonight's texts waiting until the old 08:00.
 * Returns how many rows were bumped (the action logs it).
 */
export async function bumpHeldForAccount(db: SupabaseClient, accountId: string): Promise<number> {
  const { data, error } = await db.from("automation_log")
    .update({ held_until: new Date().toISOString() })
    .eq("account_id", accountId).eq("status", "held").select("id");
  if (error) throw new Error(`bumpHeldForAccount failed: ${error.message}`);
  return (data ?? []).length;
}

export type AutomationLogCursor = { occurredAt: string; id: string };
export type AutomationLogListRow = AutomationLogRow & { contact_name: string | null };

/**
 * The history page, newest first, keyset on (occurred_at desc, id desc) so
 * two rows in one instant cannot skip across a page edge. Runs under the
 * CALLER's client (RLS) — never serviceDb() on the in-account surface.
 *
 * `before.occurredAt` is interpolated into a PostgREST `.or()` inside double
 * quotes; the page validates it as a timestamp (parseTimeCursor) and the id
 * as a uuid (parseCursor) BEFORE it reaches here — the contacts list's rule.
 */
export async function listAutomationLog(
  db: SupabaseClient, accountId: string, opts: { limit: number; before?: AutomationLogCursor },
): Promise<AutomationLogListRow[]> {
  let q = db.from("automation_log")
    .select(`${LOG_COLS}, contacts(first_name, last_name)`)
    .eq("account_id", accountId);
  if (opts.before) {
    q = q.or(
      `occurred_at.lt."${opts.before.occurredAt}",`
      + `and(occurred_at.eq."${opts.before.occurredAt}",id.lt.${opts.before.id})`,
    );
  }
  const { data, error } = await q
    .order("occurred_at", { ascending: false }).order("id", { ascending: false })
    .limit(opts.limit);
  if (error) throw new Error(`listAutomationLog failed: ${error.message}`);
  return ((data ?? []) as any[]).map((r) => {
    const { contacts, ...row } = r;
    const name = [contacts?.first_name, contacts?.last_name].filter(Boolean).join(" ").trim();
    return { ...(row as AutomationLogRow), contact_name: name || null };
  });
}

export type AutomationUsage = {
  textsSent: number; emailsSent: number; conversations: number; callsHandled: number;
  held: number; skipped: number;
  topHeldReason: string | null; topSkippedReason: string | null;
};

/** The most frequent non-empty string, ties broken alphabetically so the
 *  answer is stable between two renders of the same data. */
function topReason(reasons: string[]): string | null {
  const tally = new Map<string, number>();
  for (const r of reasons) if (r) tally.set(r, (tally.get(r) ?? 0) + 1);
  let best: string | null = null;
  for (const [reason, n] of tally) {
    if (best === null || n > tally.get(best)! || (n === tally.get(best)! && reason < best)) best = reason;
  }
  return best;
}

/**
 * "This month" in units. Six exact counts over the (account, occurred_at)
 * index — `head: true`, so no row travels — plus one bounded read of the
 * held/skipped reasons for the "most common" line. `[fromIso, toIso)`.
 */
export async function countAutomationUsage(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<AutomationUsage> {
  const base = () => db.from("automation_log").select("id", { count: "exact", head: true })
    .eq("account_id", accountId).gte("occurred_at", fromIso).lt("occurred_at", toIso);
  const count = async (apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { count: n, error } = await apply(base());
    if (error) throw new Error(`countAutomationUsage failed: ${error.message}`);
    return n ?? 0;
  };
  const [textsSent, emailsSent, conversations, callsHandled, held, skipped] = await Promise.all([
    count((q) => q.eq("status", "sent").eq("channel", "sms")),
    count((q) => q.eq("status", "sent").eq("channel", "email")),
    count((q) => q.eq("status", "sent").eq("source", "concierge")),
    count((q) => q.eq("status", "sent").eq("source", "voice")),
    count((q) => q.eq("status", "held")),
    count((q) => q.eq("status", "skipped")),
  ]);
  const { data, error } = await db.from("automation_log").select("status, reason")
    .eq("account_id", accountId).gte("occurred_at", fromIso).lt("occurred_at", toIso)
    .in("status", ["held", "skipped"]).limit(1000);
  if (error) throw new Error(`countAutomationUsage reasons failed: ${error.message}`);
  const rows = (data ?? []) as { status: "held" | "skipped"; reason: string }[];
  return {
    textsSent, emailsSent, conversations, callsHandled, held, skipped,
    topHeldReason: topReason(rows.filter((r) => r.status === "held").map((r) => r.reason)),
    topSkippedReason: topReason(rows.filter((r) => r.status === "skipped").map((r) => r.reason)),
  };
}
```

- [ ] **Step 3: Write the settings accessors**

`packages/db/src/automation-settings.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { emit, type ActorType } from "./events";

/** The quiet-hours window as the app speaks it: "HH:MM" on the account's wall clock. */
export type QuietSettings = { enabled: boolean; start: string; end: string };

export const DEFAULT_QUIET_SETTINGS: QuietSettings = { enabled: true, start: "21:00", end: "08:00" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isClock(v: string): boolean {
  return HHMM.test(v);
}

/** Postgres renders `time` as "21:00:00"; the app carries "21:00". */
function toClock(pgTime: string): string {
  return pgTime.slice(0, 5);
}

/** Missing row = the defaults, WITHOUT writing one. */
export async function readQuietSettings(db: SupabaseClient, accountId: string): Promise<QuietSettings> {
  const { data, error } = await db.from("automation_settings")
    .select("quiet_enabled, quiet_start, quiet_end").eq("account_id", accountId).maybeSingle();
  if (error) throw new Error(`readQuietSettings failed: ${error.message}`);
  if (!data) return DEFAULT_QUIET_SETTINGS;
  const r = data as { quiet_enabled: boolean; quiet_start: string; quiet_end: string };
  return { enabled: r.quiet_enabled, start: toClock(r.quiet_start), end: toClock(r.quiet_end) };
}

/** serviceDb()-only by grant; the caller checks isAgency (0025's rule). */
export async function saveQuietSettings(
  db: SupabaseClient, accountId: string, s: QuietSettings, actorId: string, actorType: ActorType = "user",
): Promise<void> {
  if (!isClock(s.start) || !isClock(s.end)) throw new Error("saveQuietSettings: times must be HH:MM");
  const { error } = await db.from("automation_settings").upsert({
    account_id: accountId, quiet_enabled: s.enabled, quiet_start: s.start, quiet_end: s.end,
    updated_at: new Date().toISOString(),
  }, { onConflict: "account_id" });
  if (error) throw new Error(`saveQuietSettings failed: ${error.message}`);
  await emit(db, accountId, "automation_settings.updated", actorId, { quiet: s }, actorType);
}

/** The inline instant reply has no due-row to carry the zone; it reads it here, once, after a send is decided. */
export async function readAccountTimezone(db: SupabaseClient, accountId: string): Promise<string | null> {
  const { data, error } = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle();
  if (error) throw new Error(`readAccountTimezone failed: ${error.message}`);
  return (data as { timezone: string | null } | null)?.timezone ?? null;
}
```

- [ ] **Step 4: Export from the package**

In `packages/db/src/index.ts`, after line 81 (`export * from "./weekly-report";`), add:

```ts
export * from "./automation-log";
export * from "./automation-settings";
```

Run: `pnpm --filter @bis/db typecheck` — Expected: no errors.

- [ ] **Step 5: Write the proof**

`packages/db/src/test/automation-log-grants.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withRollback, actAs } from "./db";
import { withTestAccount } from "./fixtures";
import { serviceDb } from "../service";
import {
  recordAutomationLog, listReleasableHolds, bumpHeldForAccount, listAutomationLog, countAutomationUsage,
} from "../automation-log";
import { readQuietSettings, saveQuietSettings, DEFAULT_QUIET_SETTINGS } from "../automation-settings";

/**
 * 0046 at the level that can see it. Unit tests that mock the db are blind
 * to grants (four shipped defects in this repo); these run real SQL inside a
 * rolled-back transaction, or through serviceDb() under withTestAccount.
 */
const RUN = Math.random().toString(36).slice(2, 10);
const orgId = (label: string) => `org_AL_${label}_${RUN}`;

const TABLES = ["automation_log", "automation_settings"] as const;

async function seedTwoAccountsWithLog(c: any) {
  const { rows: [agency] } = await c.query("select id from agencies limit 1");
  const mk = async (org: string, name: string) => (await c.query(
    "insert into accounts (agency_id, clerk_org_id, name, client_access_enabled) values ($1,$2,$3,true) returning id",
    [agency.id, org, name])).rows[0].id as string;
  const a = await mk(orgId("A"), "Alpha");
  const b = await mk(orgId("B"), "Bravo");
  await c.query(
    `insert into automation_log (account_id, source, channel, subject_key, status, reason)
       values ($1,'sms_reminder','sms','booking:a1','sent',''), ($2,'sms_reminder','sms','booking:b1','sent','')`,
    [a, b]);
  await c.query(
    "insert into automation_settings (account_id, quiet_start, quiet_end) values ($1,'22:00','07:00'), ($2,'23:00','06:00')",
    [a, b]);
  return { a, b };
}

describe("0046 tables exist (guards every grants assertion below from vacuity)", () => {
  for (const table of TABLES) {
    it(`${table} exists`, () => withRollback(async (c) => {
      const { rows } = await c.query<{ oid: string | null }>(`select to_regclass('public.${table}')::text as oid`);
      expect(rows[0]!.oid?.replace(/^public\./, "")).toBe(table);
    }));
  }
});

describe("0046 grants", () => {
  for (const table of TABLES) {
    // EXACT set, not containment: the default ACL hands TRUNCATE to
    // authenticated on every new table (call-proposals-grants.test.ts:104-118).
    it(`${table}: authenticated holds EXACTLY select (mutation: grant insert to authenticated → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select grantee, privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'authenticated' order by privilege_type`, [table]);
        expect(rows).toEqual([{ grantee: "authenticated", privilege_type: "SELECT" }]);
      }));

    it(`${table}: anon holds nothing (mutation: drop the revoke from anon → FAILS)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query(
          `select privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'anon'`, [table]);
        expect(rows).toEqual([]);
      }));

    it(`${table}: service_role holds at least select/insert/update/delete`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ privilege_type: string }>(
          `select privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee = 'service_role'`, [table]);
        expect(rows.map((r) => r.privilege_type)).toEqual(expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]));
      }));

    it(`${table}: the whole grant set across every role but postgres (catches a grant to PUBLIC)`, () =>
      withRollback(async (c) => {
        const { rows } = await c.query<{ grantee: string; privilege_type: string }>(
          `select grantee, privilege_type from information_schema.role_table_grants
             where table_schema = 'public' and table_name = $1 and grantee <> 'postgres' order by grantee, privilege_type`, [table]);
        expect(rows).toEqual([
          { grantee: "authenticated", privilege_type: "SELECT" },
          { grantee: "service_role", privilege_type: "DELETE" },
          { grantee: "service_role", privilege_type: "INSERT" },
          { grantee: "service_role", privilege_type: "REFERENCES" },
          { grantee: "service_role", privilege_type: "SELECT" },
          { grantee: "service_role", privilege_type: "TRIGGER" },
          { grantee: "service_role", privilege_type: "TRUNCATE" },
          { grantee: "service_role", privilege_type: "UPDATE" },
        ]);
      }));
  }
});

describe("0046 RLS — a second account's row is PRESENT in every case", () => {
  it("a client reads only its own log rows (mutation: drop the policy's account_id clause → FAILS)", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query("select account_id from automation_log");
      expect(rows.map((r: any) => r.account_id)).toEqual([a]);
    }));

  it("a client reads only its own settings row", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      const { rows } = await c.query("select account_id, quiet_start::text as s from automation_settings");
      expect(rows).toEqual([{ account_id: a, s: "22:00:00" }]);
    }));

  it("the agency reads every account's rows", () =>
    withRollback(async (c) => {
      const { a, b } = await seedTwoAccountsWithLog(c);
      await actAs(c, { app_role: "agency_admin" });
      const { rows } = await c.query("select account_id from automation_log where account_id in ($1,$2) order by account_id", [a, b]);
      expect(rows.map((r: any) => r.account_id).sort()).toEqual([a, b].sort());
    }));

  // ONE refused statement per withRollback (the abort would hide the reason
  // of any later one). A REAL account id, so RLS's own check would PASS and
  // the only thing refusing is the grant — 42501, never "an error".
  it("a client cannot INSERT a log row, even for its own account: 42501", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query(
        "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'voice','ai','call:x','sent')", [a],
      )).rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot UPDATE a log row (the escalation: re-labelling a skipped send as sent): 42501", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("update automation_log set status = 'skipped' where account_id = $1", [a]))
        .rejects.toMatchObject({ code: "42501" });
    }));

  it("a client cannot turn its own quiet hours off: 42501", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await actAs(c, { org_id: orgId("A") });
      await expect(c.query("update automation_settings set quiet_enabled = false where account_id = $1", [a]))
        .rejects.toMatchObject({ code: "42501" });
    }));
});

describe("0046 constraints (23514 = check_violation, 23505 = unique_violation)", () => {
  it("a held row must carry held_until and a sent row must not; source and status are closed lists", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      const verdicts: Record<string, string | undefined> = {};
      for (const [label, sql] of Object.entries({
        "held without held_until": "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'reminders','email','booking:h1','held')",
        "sent with held_until": "insert into automation_log (account_id, source, channel, subject_key, status, held_until) values ($1,'reminders','email','booking:s1','sent',now())",
        "an unknown source": "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'weekly_agency_report','email','week:x','sent')",
        "an unknown status": "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'reminders','email','booking:q1','queued')",
      })) {
        await c.query("savepoint s");
        try { await c.query(sql, [a]); verdicts[label] = undefined; }
        catch (e: any) { verdicts[label] = e.code; }
        await c.query("rollback to savepoint s");
      }
      expect(verdicts).toEqual({
        "held without held_until": "23514", "sent with held_until": "23514",
        "an unknown source": "23514", "an unknown status": "23514",
      });
    }));

  it("one row per (account, source, subject): a second INSERT is refused (23505); the accessor upserts instead", () =>
    withRollback(async (c) => {
      const { a } = await seedTwoAccountsWithLog(c);
      await expect(c.query(
        "insert into automation_log (account_id, source, channel, subject_key, status) values ($1,'sms_reminder','sms','booking:a1','skipped')", [a],
      )).rejects.toMatchObject({ code: "23505" });
    }));
});

describe("0046 accessors, live (serviceDb under withTestAccount)", () => {
  it("recordAutomationLog flips a held row to sent IN PLACE — exactly one row after both writes (mutation: insert instead of upsert → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const base = { accountId, source: "sms_reminder" as const, channel: "sms" as const, contactId: null, subjectKey: `booking:${RUN}` };
      await recordAutomationLog(db, { ...base, status: "held", heldUntil: "2026-09-22T13:00:00.000Z", reason: "Held until 8:00 AM — quiet hours" });
      await recordAutomationLog(db, { ...base, status: "sent" });
      const rows = await listAutomationLog(db, accountId, { limit: 10 });
      expect(rows.map((r) => [r.subject_key, r.status, r.reason, r.held_until])).toEqual([[`booking:${RUN}`, "sent", "", null]]);
    });
  });

  it("recordAutomationLog refuses a held write without heldUntil BEFORE any query", async () => {
    await expect(recordAutomationLog(serviceDb(), {
      accountId: "00000000-0000-0000-0000-000000000000", source: "reminders", channel: "email",
      contactId: null, subjectKey: "booking:x", status: "held",
    })).rejects.toThrow(/needs heldUntil/);
  });

  it("listReleasableHolds returns held rows whose time has come, oldest first, and nothing else (mutation: drop the lte → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const mk = (k: string, status: "held" | "sent", heldUntil?: string) =>
        recordAutomationLog(db, { accountId, source: "followups", channel: "email", contactId: null, subjectKey: `booking:${k}`, status, heldUntil });
      await mk("later", "held", "2099-01-01T00:00:00.000Z");
      await mk("due2", "held", "2026-01-02T00:00:00.000Z");
      await mk("due1", "held", "2026-01-01T00:00:00.000Z");
      await mk("sent", "sent");
      const due = (await listReleasableHolds(db, "2026-06-01T00:00:00.000Z"))
        .filter((r) => r.account_id === accountId);   // the shared project may hold other accounts' rows
      expect(due.map((r) => r.subject_key)).toEqual(["booking:due1", "booking:due2"]);
    });
  });

  it("bumpHeldForAccount makes every held row of ONE account due now and touches no other status", async () => {
    await withTestAccount(async (db, accountId) => {
      await recordAutomationLog(db, { accountId, source: "reminders", channel: "email", contactId: null, subjectKey: "booking:h", status: "held", heldUntil: "2099-01-01T00:00:00.000Z" });
      await recordAutomationLog(db, { accountId, source: "reminders", channel: "email", contactId: null, subjectKey: "booking:s", status: "sent" });
      expect(await bumpHeldForAccount(db, accountId)).toBe(1);
      const rows = await listAutomationLog(db, accountId, { limit: 10 });
      const held = rows.find((r) => r.subject_key === "booking:h")!;
      expect(new Date(held.held_until!).getTime()).toBeLessThan(Date.now() + 1000);
      expect(rows.find((r) => r.subject_key === "booking:s")!.held_until).toBeNull();
    });
  });

  it("listAutomationLog pages newest-first on (occurred_at, id) with no overlap and no skip, and carries the contact's name", async () => {
    await withTestAccount(async (db, accountId) => {
      for (const k of ["1", "2", "3"]) {
        await recordAutomationLog(db, { accountId, source: "voice", channel: "ai", contactId: null, subjectKey: `call:${k}`, status: "sent" });
      }
      const page1 = await listAutomationLog(db, accountId, { limit: 2 });
      expect(page1).toHaveLength(2);
      const last = page1[1]!;
      const page2 = await listAutomationLog(db, accountId, { limit: 2, before: { occurredAt: last.occurred_at, id: last.id } });
      const seen = [...page1, ...page2].map((r) => r.subject_key);
      expect(new Set(seen).size).toBe(3);
      expect(page2).toHaveLength(1);
      expect(page1[0]!.contact_name).toBeNull();
    });
  });

  it("countAutomationUsage counts sent by channel and source, plus held/skipped with their most common reason, inside [from, to)", async () => {
    await withTestAccount(async (db, accountId) => {
      const w = (source: any, channel: any, k: string, status: any, reason = "", heldUntil?: string) =>
        recordAutomationLog(db, { accountId, source, channel, contactId: null, subjectKey: k, status, reason, heldUntil });
      await w("sms_reminder", "sms", "booking:1", "sent");
      await w("instant_reply", "sms", "submission:1", "sent");
      await w("reminders", "email", "booking:2", "sent");
      await w("concierge", "ai", "conversation:1", "sent");
      await w("voice", "ai", "call:1", "sent");
      await w("voice", "ai", "call:2", "skipped", "Screened as a robocall");
      await w("voice", "ai", "call:3", "skipped", "Screened as a robocall");
      await w("followups", "email", "booking:3", "skipped", "No email address on file");
      await w("review_request", "sms", "booking:4", "held", "Held until 8:00 AM — quiet hours", "2099-01-01T00:00:00.000Z");
      const from = new Date(Date.now() - 60_000).toISOString();
      const to = new Date(Date.now() + 60_000).toISOString();
      expect(await countAutomationUsage(db, accountId, from, to)).toEqual({
        textsSent: 2, emailsSent: 1, conversations: 1, callsHandled: 1,
        held: 1, skipped: 3,
        topHeldReason: "Held until 8:00 AM — quiet hours", topSkippedReason: "Screened as a robocall",
      });
      expect((await countAutomationUsage(db, accountId, to, "2099-01-01T00:00:00.000Z")).textsSent).toBe(0);
    });
  });

  it("readQuietSettings returns the defaults for an account with no row, and the saved window after a save", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await readQuietSettings(db, accountId)).toEqual(DEFAULT_QUIET_SETTINGS);
      await saveQuietSettings(db, accountId, { enabled: true, start: "22:30", end: "06:15" }, "user_test");
      expect(await readQuietSettings(db, accountId)).toEqual({ enabled: true, start: "22:30", end: "06:15" });
      const { data: ev } = await db.from("events").select("type").eq("account_id", accountId).eq("type", "automation_settings.updated");
      expect(ev).toHaveLength(1);
    });
  });

  it("saveQuietSettings refuses a clock that is not HH:MM before writing", async () => {
    await expect(saveQuietSettings(serviceDb(), "00000000-0000-0000-0000-000000000000", { enabled: true, start: "9pm", end: "08:00" }, "user_test"))
      .rejects.toThrow(/HH:MM/);
  });

  for (const table of TABLES) {
    it(`${table} is carried off by the account's own deletion, so it needs no line in the teardown list`, async () => {
      let accountId = "";
      await withTestAccount(async (db, id) => {
        accountId = id;
        if (table === "automation_log") {
          await recordAutomationLog(db, { accountId: id, source: "voice", channel: "ai", contactId: null, subjectKey: "call:c", status: "sent" });
        } else {
          await saveQuietSettings(db, id, { enabled: false, start: "21:00", end: "08:00" }, "user_test");
        }
      });
      // withTestAccount's finally has run deleteAccountCascade, which does NOT
      // name either table. Under restrict that would have thrown; under
      // cascade the rows are gone. This is what makes the absence from
      // ACCOUNT_OWNED_TABLES a decision instead of an omission.
      const { data, error } = await serviceDb().from(table).select("account_id").eq("account_id", accountId);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });
  }
});
```

- [ ] **Step 6: Typecheck, run the file ONCE to record the pre-apply failure, commit, stop**

Run: `pnpm --filter @bis/db typecheck` — Expected: no errors.
Run: `pnpm --filter @bis/db exec vitest run src/test/automation-log-grants.test.ts` — Expected: the two "exists" tests FAIL (`to_regclass` → null) and the rest fail on the missing relation. Paste the two "exists" failures into the report.

```bash
git add packages/db/supabase/migrations/0046_automation_log.sql packages/db/src/automation-log.ts packages/db/src/automation-settings.ts packages/db/src/test/automation-log-grants.test.ts packages/db/src/index.ts
git commit -m "db: 0046 automation_log + automation_settings — one row per subject, cascade, authenticated SELECT under RLS (not applied)"
```

Report `READY_FOR_APPLY`. The orchestrator applies 0046 via the Supabase MCP `apply_migration` (name `0046_automation_log`), verifies `select to_regclass('public.automation_log')`, then runs `pnpm --filter @bis/db test` — Expected: the new file green, no other file red.

---

### Task 2: `quiet-hours.ts` — the pure window (bis-automations, worktree, parallel with Task 1)

**Files:**
- Create: `apps/web/src/lib/automations/quiet-hours.ts`
- Create: `apps/web/src/lib/automations/quiet-hours.test.ts`

**Interfaces:**
- Consumes: `resolveAccountZone` from `@/lib/booking/followup-timing` (returns `null` for a zone Intl cannot resolve).
- Produces:
  ```ts
  export type QuietSettings = { enabled: boolean; start: string; end: string };   // structurally identical to @bis/db's; declared here so this file has NO @bis/db import (Task 3 re-exports the db one and they must stay assignable)
  export function clockMinutes(hhmm: string): number | null;                       // "21:00" → 1260; junk → null
  export function inQuietWindow(now: Date, zone: string, s: QuietSettings): boolean;
  export function quietWindowEnd(now: Date, zone: string, s: QuietSettings): Date | null;   // null when not in the window
  export function formatClock(hhmm: string): string;                              // "21:00" → "9:00 PM"
  export function formatInstantClock(instant: Date, zone: string): string;        // "8:00 AM" on the account's wall clock
  ```

- [ ] **Step 1: Write the failing tests**

`apps/web/src/lib/automations/quiet-hours.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  clockMinutes, inQuietWindow, quietWindowEnd, formatClock, formatInstantClock, type QuietSettings,
} from "./quiet-hours";

const CHI = "America/Chicago";
const DEFAULT: QuietSettings = { enabled: true, start: "21:00", end: "08:00" };
// 2026-09-21 is CDT (UTC-5): 21:00 CDT = 02:00Z next day; 08:00 CDT = 13:00Z.
const at = (iso: string) => new Date(iso);

describe("clockMinutes", () => {
  it("reads HH:MM and refuses everything else", () => {
    expect(clockMinutes("21:00")).toBe(1260);
    expect(clockMinutes("00:00")).toBe(0);
    expect(clockMinutes("23:59")).toBe(1439);
    for (const bad of ["24:00", "9:00", "21:60", "9pm", "", "21:00:00"]) expect(clockMinutes(bad), bad).toBeNull();
  });
});

describe("inQuietWindow — the default window, crossing midnight, on Chicago's wall clock", () => {
  it("is quiet at 23:00 and 03:00, not at 12:00 or 20:59", () => {
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, DEFAULT)).toBe(true);    // 23:00 CDT
    expect(inQuietWindow(at("2026-09-22T08:00:00Z"), CHI, DEFAULT)).toBe(true);    // 03:00 CDT
    expect(inQuietWindow(at("2026-09-21T17:00:00Z"), CHI, DEFAULT)).toBe(false);   // 12:00 CDT
    expect(inQuietWindow(at("2026-09-22T01:59:00Z"), CHI, DEFAULT)).toBe(false);   // 20:59 CDT
  });

  it("the start edge is inside and the end edge is outside (mutation: >= to > on start, or < to <= on end → FAILS)", () => {
    expect(inQuietWindow(at("2026-09-22T02:00:00Z"), CHI, DEFAULT)).toBe(true);    // 21:00:00 CDT exactly
    expect(inQuietWindow(at("2026-09-22T12:59:59Z"), CHI, DEFAULT)).toBe(true);    // 07:59:59 CDT
    expect(inQuietWindow(at("2026-09-22T13:00:00Z"), CHI, DEFAULT)).toBe(false);   // 08:00:00 CDT exactly
  });

  it("a window that does NOT cross midnight (13:00–15:00) is quiet only between those hours", () => {
    const s = { enabled: true, start: "13:00", end: "15:00" };
    expect(inQuietWindow(at("2026-09-21T19:00:00Z"), CHI, s)).toBe(true);    // 14:00 CDT
    expect(inQuietWindow(at("2026-09-21T17:59:00Z"), CHI, s)).toBe(false);   // 12:59 CDT
    expect(inQuietWindow(at("2026-09-21T20:00:00Z"), CHI, s)).toBe(false);   // 15:00 CDT
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, s)).toBe(false);   // 23:00 CDT — not quiet under this window
  });

  it("start === end means disabled, and so does enabled:false (mutation: drop either guard → FAILS)", () => {
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, { enabled: true, start: "08:00", end: "08:00" })).toBe(false);
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, { ...DEFAULT, enabled: false })).toBe(false);
  });

  it("the account's zone decides, never the machine's: one instant, two zones, two answers", () => {
    const instant = at("2026-09-21T09:00:00Z");   // 23:00 HST (Sept 20) · 18:00 JST (Sept 21)
    expect(inQuietWindow(instant, "Pacific/Honolulu", DEFAULT)).toBe(true);
    expect(inQuietWindow(instant, "Asia/Tokyo", DEFAULT)).toBe(false);
    const noon = at("2026-09-21T03:00:00Z");      // 12:00 JST · 17:00 HST (the previous day)
    expect(inQuietWindow(noon, "Asia/Tokyo", DEFAULT)).toBe(false);
    expect(inQuietWindow(noon, "Pacific/Honolulu", DEFAULT)).toBe(false);
  });

  it("fails CLOSED (not quiet) on a zone Intl cannot resolve or an invalid instant — never throws inside a tick", () => {
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), "Mars/Olympus", DEFAULT)).toBe(false);
    expect(inQuietWindow(new Date(NaN), CHI, DEFAULT)).toBe(false);
    expect(inQuietWindow(at("2026-09-22T04:00:00Z"), CHI, { enabled: true, start: "9pm", end: "08:00" })).toBe(false);
  });
});

describe("quietWindowEnd — the next 08:00 on the wall clock, as a UTC instant", () => {
  it("at 23:00 the window ends at tomorrow's 08:00; at 03:00 at today's 08:00", () => {
    expect(quietWindowEnd(at("2026-09-22T04:00:00Z"), CHI, DEFAULT)?.toISOString()).toBe("2026-09-22T13:00:00.000Z");
    expect(quietWindowEnd(at("2026-09-22T08:00:00Z"), CHI, DEFAULT)?.toISOString()).toBe("2026-09-22T13:00:00.000Z");
  });

  it("returns null outside the window (mutation: return today's end unconditionally → FAILS)", () => {
    expect(quietWindowEnd(at("2026-09-21T17:00:00Z"), CHI, DEFAULT)).toBeNull();
    expect(quietWindowEnd(at("2026-09-22T04:00:00Z"), CHI, { ...DEFAULT, enabled: false })).toBeNull();
  });

  it("a non-crossing window ends at today's end", () => {
    expect(quietWindowEnd(at("2026-09-21T19:00:00Z"), CHI, { enabled: true, start: "13:00", end: "15:00" })?.toISOString())
      .toBe("2026-09-21T20:00:00.000Z");
  });

  it("SPRING FORWARD (2026-03-08, 02:00 CST → 03:00 CDT): held at 01:30 CST, the end is 08:00 CDT = 13:00Z, and the wall clock reads 08:00", () => {
    const end = quietWindowEnd(at("2026-03-08T07:30:00Z"), CHI, DEFAULT)!;
    expect(end.toISOString()).toBe("2026-03-08T13:00:00.000Z");   // NOT 14:00Z (the pre-shift offset applied blindly)
    expect(formatInstantClock(end, CHI)).toBe("8:00 AM");
  });

  it("FALL BACK (2026-11-01, 02:00 CDT → 01:00 CST): held at 00:30 CDT, the end is 08:00 CST = 14:00Z, and the wall clock reads 08:00", () => {
    const end = quietWindowEnd(at("2026-11-01T05:30:00Z"), CHI, DEFAULT)!;
    expect(end.toISOString()).toBe("2026-11-01T14:00:00.000Z");   // NOT 13:00Z
    expect(formatInstantClock(end, CHI)).toBe("8:00 AM");
  });

  it("east and west of UTC: the end lands on the wall clock's 08:00 in each zone", () => {
    expect(quietWindowEnd(at("2026-09-21T14:00:00Z"), "Asia/Tokyo", DEFAULT)?.toISOString()).toBe("2026-09-21T23:00:00.000Z");     // 08:00 JST Sept 22
    expect(quietWindowEnd(at("2026-09-21T09:00:00Z"), "Pacific/Honolulu", DEFAULT)?.toISOString()).toBe("2026-09-21T18:00:00.000Z"); // 08:00 HST Sept 21
  });
});

describe("formatting", () => {
  it("renders HH:MM and instants as the clock a business owner reads", () => {
    expect(formatClock("21:00")).toBe("9:00 PM");
    expect(formatClock("08:00")).toBe("8:00 AM");
    expect(formatClock("00:30")).toBe("12:30 AM");
    expect(formatClock("junk")).toBe("junk");   // never throws; the raw value is better than a crash on a settings page
    expect(formatInstantClock(at("2026-09-22T13:00:00Z"), CHI)).toBe("8:00 AM");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/automations/quiet-hours.test.ts`
Expected: FAIL — `Cannot find module './quiet-hours'`.

- [ ] **Step 3: Write the module**

`apps/web/src/lib/automations/quiet-hours.ts`:

```ts
import { resolveAccountZone } from "@/lib/booking/followup-timing";

/**
 * Quiet hours, the pure half (spec §2). One window per account, on the
 * ACCOUNT's wall clock, evaluated against an instant the caller supplies —
 * never `Date.now()` — so one tick has one "now" and a test can put the
 * clock anywhere.
 *
 * Two rules and a spelling:
 *   - a window that crosses midnight (the default, 21:00–08:00) is the
 *     normal case: quiet when `t >= start || t < end`;
 *   - a window inside one day (13:00–15:00): quiet when `start <= t < end`;
 *   - `start === end` means disabled, as does `enabled: false`.
 *
 * FAILS CLOSED, and "closed" here means NOT QUIET: an unresolvable zone, an
 * invalid instant or a junk clock string yields `false` from `inQuietWindow`
 * and `null` from `quietWindowEnd`. A reminder that never sends is a
 * no-show; a text at 11 PM is a complaint; a reminder held forever against a
 * misconfigured zone would be the first, silently. The pass logs the zone
 * problem (hold-or-send.ts) so it is visible rather than guessed at.
 *
 * `QuietSettings` is declared here rather than imported from `@bis/db` so
 * this module stays free of the package (imports.test.ts's spirit: a pure
 * module owns no I/O). It is structurally identical to the db's, and
 * hold-or-send.ts hands the db's straight in.
 */
export type QuietSettings = { enabled: boolean; start: string; end: string };

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** "21:00" → 1260 (minutes since local midnight); anything else → null. */
export function clockMinutes(hhmm: string): number | null {
  const m = HHMM.exec(hhmm);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

type Wall = { year: number; month: number; day: number; minutes: number };

/**
 * `hourCycle: "h23"`, never `hour12: false` (midnight renders as "24" in
 * several locales), and "en-US" pinned so no non-Gregorian calendar sneaks
 * in — the same two rules followup-timing.ts's `localParts` states.
 */
function wallOf(instant: Date, zone: string): Wall {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  return { year: get("year"), month: get("month"), day: get("day"), minutes: get("hour") * 60 + get("minute") };
}

/**
 * The UTC instant at which `zone`'s wall clock reads `minutes` past midnight
 * on the given local date — weekly-window.ts's `localMidnightInstant` fixed
 * point, generalised to any minute. Two iterations converge for every real
 * offset; a wall time that does not exist (the spring-forward gap) resolves
 * to the instant after the gap, which is the right answer for "the window
 * ends at 08:00" because 08:00 always exists.
 */
function wallInstant(year: number, month: number, day: number, minutes: number, zone: string): Date {
  const target = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0);
  let ts = target;
  for (let i = 0; i < 2; i++) {
    const seen = wallOf(new Date(ts), zone);
    const seenTs = Date.UTC(seen.year, seen.month - 1, seen.day, Math.floor(seen.minutes / 60), seen.minutes % 60, 0);
    ts += target - seenTs;
  }
  return new Date(ts);
}

function nextDay(w: Wall): { year: number; month: number; day: number } {
  const t = new Date(Date.UTC(w.year, w.month - 1, w.day + 1));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function resolve(now: Date, zone: string, s: QuietSettings) {
  if (!s.enabled) return null;
  const start = clockMinutes(s.start);
  const end = clockMinutes(s.end);
  if (start === null || end === null || start === end) return null;
  const resolved = resolveAccountZone(zone);
  if (resolved === null || !Number.isFinite(now.getTime())) return null;
  const wall = wallOf(now, resolved);
  const quiet = start < end ? wall.minutes >= start && wall.minutes < end : wall.minutes >= start || wall.minutes < end;
  return { quiet, end, resolved, wall };
}

export function inQuietWindow(now: Date, zone: string, s: QuietSettings): boolean {
  return resolve(now, zone, s)?.quiet ?? false;
}

/**
 * The next instant the CURRENT window ends, or null when `now` is not
 * inside one. If the wall clock has not yet reached `end` today (the
 * morning half of a crossing window, or any non-crossing window), that is
 * today's `end`; otherwise tomorrow's. Resolved through the wall-time fixed
 * point, so a 08:00 end is 08:00 on the clock on both sides of a DST change.
 */
export function quietWindowEnd(now: Date, zone: string, s: QuietSettings): Date | null {
  const r = resolve(now, zone, s);
  if (!r || !r.quiet) return null;
  const day = r.wall.minutes < r.end ? r.wall : nextDay(r.wall);
  return wallInstant(day.year, day.month, day.day, r.end, r.resolved);
}

/** "21:00" → "9:00 PM". A string that is not a clock comes back unchanged. */
export function formatClock(hhmm: string): string {
  const minutes = clockMinutes(hhmm);
  if (minutes === null) return hhmm;
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })
    .format(new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)));
}

/** An instant on the account's wall clock: "8:00 AM". Unresolvable zone → UTC, labelled by the caller. */
export function formatInstantClock(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: resolveAccountZone(zone) ?? "UTC",
  }).format(instant);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter web exec vitest run src/lib/automations/quiet-hours.test.ts`
Expected: PASS, every test. Then the prescribed mutations, each run against the WHOLE file and reverted: (a) `wall.minutes >= start` → `> start` on EACH branch separately (the crossing branch reds the edge test; the non-crossing branch reds the 13:00-exactly assertion); (b) delete `start === end` → the disabled test reds; (c) in `quietWindowEnd` replace `r.wall.minutes < r.end ? r.wall : nextDay(r.wall)` with `r.wall` → the 23:00 case reds; (d) replace the fixed-point loop with `return new Date(target)` → both DST tests red (13:00Z becomes 14:00Z / 14:00Z becomes 13:00Z is NOT what happens — the blind UTC construction ignores the offset entirely, and both `toISOString` assertions fail).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/automations/quiet-hours.ts apps/web/src/lib/automations/quiet-hours.test.ts
git commit -m "automations: quiet-hours.ts — the pure window on the account's wall clock, DST-proof end"
```

---

### Task 3: `holdOrSend`, `PassContext.quiet`, the five by-id lookups (bis-automations, main checkout, after 0046 is applied)

**Files:**
- Create: `apps/web/src/lib/automations/hold-or-send.ts`, `apps/web/src/lib/automations/hold-or-send.test.ts`
- Modify: `apps/web/src/lib/automations/context.ts`, `apps/web/src/lib/automations/harness.ts`, `apps/web/src/lib/automations/harness.test.ts`
- Modify (one line each, the `ctx()` literal): `apps/web/src/lib/automations/passes/{no-show-nudge,review-request,site-traffic,sms-reminder,weekly-agency-report,weekly-report}.test.ts`, `apps/web/src/lib/automations/send-sms.test.ts`, `apps/web/src/lib/automations/sentinel.test.ts`
- Modify: `packages/db/src/booking.ts` (`DueReminder.contactId`, `DueFollowup.contactId`, `DueLookup`, `getDueReminderById`, `getDueFollowupById`), `packages/db/src/automations.ts` (`getDueReviewRequestById`, `getDueNoShowNudgeById`, `getDueSmsReminderById`), `packages/db/src/index.ts`
- Create: `packages/db/src/test/due-by-id.test.ts`
- Modify: `apps/web/src/app/api/cron/reminders/route.test.ts` (reminder/follow-up fixtures gain `contactId`; the factory mock gains `readQuietSettings` and `recordAutomationLog`)

**Interfaces:**
- Consumes: Task 1's `recordAutomationLog`, `readQuietSettings`, `QuietSettings`, `AutomationLogRow`; Task 2's `inQuietWindow`, `quietWindowEnd`, `formatInstantClock`.
- Produces:
  ```ts
  // context.ts
  export type PassContext = { db; now; origin; email; sms; quiet: (accountId: string) => Promise<QuietSettings> };
  // harness.ts
  export function quietSettingsReader(db: SupabaseClient): (accountId: string) => Promise<QuietSettings>;   // memoised per account for one tick
  // hold-or-send.ts
  export type HoldContext = Pick<PassContext, "db" | "now" | "quiet">;
  export type LogSubject = { accountId; source: AutomationLogSource; channel: "sms" | "email"; subjectKey; contactId: string | null; payload?: Record<string, unknown> };
  export type HoldSubject = LogSubject & { accountTimezone: string | null; deadline?: Date | null };
  export const REASONS: { quietHours(endsAt: Date, zone: string): string; noEmail; noPhone; smsGate; dailyCap; failed; appointmentStarted; noLongerDue; recipeOff; timezone; calendarOff; recentText; outsideRegion; consentWithheld; robocall };
  export async function holdOrSend(ctx: HoldContext, s: HoldSubject, send: () => Promise<void>): Promise<"sent" | "held">;
  export async function logSkipped(ctx: Pick<PassContext, "db">, s: LogSubject, reason: string): Promise<void>;   // never throws
  export type ReleaseVerdict = "sent" | "held" | "skipped" | "failed";
  export type Releaser = (ctx: PassContext, row: AutomationLogRow) => Promise<ReleaseVerdict>;
  export function subjectOf(row: AutomationLogRow): LogSubject;
  export function verdict(c: { sent: number; held: number; failed: number }): ReleaseVerdict;
  // packages/db
  export type DueLookup<T> = { due: T; why?: undefined } | { due: null; why: "gone" | "off" };
  export async function getDueReminderById(db, bookingId): Promise<DueLookup<DueReminder>>;
  export async function getDueFollowupById(db, bookingId): Promise<DueLookup<DueFollowup>>;
  export async function getDueReviewRequestById(db, bookingId): Promise<DueLookup<DueReviewRequest>>;
  export async function getDueNoShowNudgeById(db, bookingId): Promise<DueLookup<DueNoShowNudge>>;
  export async function getDueSmsReminderById(db, bookingId): Promise<DueLookup<DueSmsReminder>>;
  // DueReminder and DueFollowup gain `contactId: string`
  ```

- [ ] **Step 1: The seam — `PassContext.quiet` and the reader**

In `apps/web/src/lib/automations/context.ts`, add to the imports `import type { QuietSettings } from "@bis/db";` and to `PassContext`, after `sms`:

```ts
  /** The account's quiet-hours window, read once per account per tick
   *  (harness.ts's `quietSettingsReader`). Lazy like `sms`: an idle tick
   *  never reads settings. holdOrSend is the only caller. */
  quiet: (accountId: string) => Promise<QuietSettings>;
```

In `apps/web/src/lib/automations/harness.ts`, change the `@bis/db` import to `import { readQuietSettings, type SupabaseClient, type QuietSettings } from "@bis/db";` and add, above `buildPassContext`:

```ts
/**
 * One settings read per account per tick, shared by every pass through
 * `ctx.quiet`. A rejected read is NOT memoised, so the next row asks again
 * rather than inheriting a dead promise for the rest of the tick.
 */
export function quietSettingsReader(db: SupabaseClient): (accountId: string) => Promise<QuietSettings> {
  const memo = new Map<string, Promise<QuietSettings>>();
  return (accountId) => {
    let p = memo.get(accountId);
    if (!p) {
      p = readQuietSettings(db, accountId);
      memo.set(accountId, p);
      p.catch(() => memo.delete(accountId));
    }
    return p;
  };
}
```

and in `buildPassContext` return `{ ...input, email: getEmailProvider(), sms: lazySmsProvider(), quiet: quietSettingsReader(input.db) }`.

- [ ] **Step 2: Every hand-built `PassContext` literal gains `quiet`**

`grep -rln "sms: () => ({ isFake" apps/web/src --include=*.test.ts` lists exactly eight files. In each `ctx()` (or inline `const ctx: PassContext = {…}` in `sentinel.test.ts` and `send-sms.test.ts`), add one field after `sms`:

```ts
    quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }),
```

Existing tests keep their behaviour (no window). Task 4's held tests override with an enabled window per test.

Add to `harness.test.ts`, after the `buildPassContext — the SMS provider is LAZY` describe:

```ts
describe("quietSettingsReader — one read per account per tick", () => {
  it("memoises per account and drops a rejected read so the next caller retries", async () => {
    const { quietSettingsReader } = await import("./harness");
    let calls = 0;
    const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
      calls++;
      if (calls === 1) return { data: null, error: { message: "boom" } };
      return { data: { quiet_enabled: true, quiet_start: "22:00:00", quiet_end: "07:00:00" }, error: null };
    } }) }) }) } as never;
    const quiet = quietSettingsReader(db);
    await expect(quiet("a1")).rejects.toThrow(/boom/);
    expect(await quiet("a1")).toEqual({ enabled: true, start: "22:00", end: "07:00" });
    expect(await quiet("a1")).toEqual({ enabled: true, start: "22:00", end: "07:00" });
    expect(calls).toBe(2);   // mutation: memoise the rejection too → 1, and the second await rejects
  });
});
```

Run: `pnpm --filter web typecheck` — Expected: clean (every literal now satisfies the type). Run `pnpm --filter web exec vitest run src/lib/automations` — Expected: green (nothing behavioural changed yet).

- [ ] **Step 3: Write the failing `hold-or-send` tests**

`apps/web/src/lib/automations/hold-or-send.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ recordAutomationLog: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { holdOrSend, logSkipped, REASONS, subjectOf, verdict, type HoldSubject } from "./hold-or-send";

const NIGHT = new Date("2026-09-22T04:00:00Z");   // 23:00 CDT
const NOON = new Date("2026-09-21T17:00:00Z");    // 12:00 CDT
const ON = { enabled: true, start: "21:00", end: "08:00" };
const OFF = { ...ON, enabled: false };
const END = "2026-09-22T13:00:00.000Z";           // 08:00 CDT

function subject(overrides: Partial<HoldSubject> = {}): HoldSubject {
  return {
    accountId: "acct_1", accountTimezone: "America/Chicago", source: "sms_reminder", channel: "sms",
    subjectKey: "booking:bk_1", contactId: "ct_1", ...overrides,
  };
}
const ctx = (now: Date, settings = ON, db: unknown = {}) =>
  ({ db: db as never, now, quiet: vi.fn(async () => settings) });

beforeEach(() => {
  dbMocks.recordAutomationLog.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});

describe("holdOrSend", () => {
  it("outside the window: sends, then writes ONE sent row (mutation: skip the record → FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NOON), subject(), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct_1", source: "sms_reminder", channel: "sms", subjectKey: "booking:bk_1", contactId: "ct_1",
      status: "sent", reason: "",
    });
  });

  it("inside the window: does NOT send, writes a held row with held_until = the window's end and a client-readable reason (mutation: invert inQuietWindow → FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT), subject(), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "held", heldUntil: END, reason: "Held until 8:00 AM — quiet hours",
    }));
  });

  it("the reminder exemption: a deadline at or before the window's end sends now; one after it holds (mutation: drop the deadline check → the first FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT), subject({ deadline: new Date("2026-09-22T12:30:00Z") }), send)).toBe("sent");   // 07:30 CDT job
    expect(await holdOrSend(ctx(NIGHT), subject({ deadline: new Date("2026-09-22T13:00:00Z") }), send)).toBe("sent");   // exactly 08:00
    expect(await holdOrSend(ctx(NIGHT), subject({ deadline: new Date("2026-09-22T13:00:01Z") }), send)).toBe("held");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a send that throws writes a failed row with the plain reason and RETHROWS so the pass counts it", async () => {
    const send = vi.fn(async () => { throw new Error("carrier timeout"); });
    await expect(holdOrSend(ctx(NOON), subject(), send)).rejects.toThrow("carrier timeout");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "failed", reason: REASONS.failed }));
  });

  it("a log write that fails never fails the send: still sent, one console.error (mutation: let record throw → FAILS)", async () => {
    dbMocks.recordAutomationLog.mockRejectedValue(new Error("log down"));
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NOON), subject(), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining("automation log write failed")]);
  });

  it("quiet hours OFF: sends at night", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT, OFF), subject(), send)).toBe("sent");
  });

  it("an unresolvable account zone sends (never holds forever) and says so in the log line — settings are not even read", async () => {
    const send = vi.fn(async () => {});
    const c = ctx(NIGHT);
    expect(await holdOrSend(c, subject({ accountTimezone: "Mars/Olympus" }), send)).toBe("sent");
    expect(c.quiet).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.map((cl) => String(cl[0]))).toEqual([expect.stringContaining("Mars/Olympus")]);
  });

  it("a settings read that rejects rejects the call: nothing sent, nothing written (the row is due again next tick)", async () => {
    const send = vi.fn(async () => {});
    const c = { db: {} as never, now: NIGHT, quiet: async () => { throw new Error("settings down"); } };
    await expect(holdOrSend(c, subject(), send)).rejects.toThrow("settings down");
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("settings are read for the SUBJECT's account (mutation: hardcode an account id → FAILS)", async () => {
    const c = ctx(NOON);
    await holdOrSend(c, subject({ accountId: "acct_2" }), async () => {});
    expect(c.quiet).toHaveBeenCalledWith("acct_2");
  });
});

describe("logSkipped, subjectOf, verdict", () => {
  it("logSkipped writes a skipped row and never throws", async () => {
    await logSkipped({ db: {} as never }, subject(), REASONS.noPhone);
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "No phone number we can text" }));
    dbMocks.recordAutomationLog.mockRejectedValue(new Error("down"));
    await expect(logSkipped({ db: {} as never }, subject(), REASONS.noPhone)).resolves.toBeUndefined();
  });

  it("subjectOf maps a log row back to the subject the release re-writes, payload included", () => {
    expect(subjectOf({
      id: "l1", account_id: "acct_1", source: "instant_reply", channel: "sms", contact_id: "ct_9",
      subject_key: "submission:s1", status: "held", reason: "x", held_until: END, payload: { locale: "es" }, occurred_at: END,
    })).toEqual({ accountId: "acct_1", source: "instant_reply", channel: "sms", subjectKey: "submission:s1", contactId: "ct_9", payload: { locale: "es" } });
  });

  it("verdict reads a pass's counters: sent beats held beats failed beats skipped", () => {
    expect(verdict({ sent: 1, held: 0, failed: 0 })).toBe("sent");
    expect(verdict({ sent: 0, held: 1, failed: 0 })).toBe("held");
    expect(verdict({ sent: 0, held: 0, failed: 1 })).toBe("failed");
    expect(verdict({ sent: 0, held: 0, failed: 0 })).toBe("skipped");
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `pnpm --filter web exec vitest run src/lib/automations/hold-or-send.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 5: Write `hold-or-send.ts`**

```ts
import {
  recordAutomationLog, type AutomationLogRow, type AutomationLogSource, type AutomationLogWrite,
} from "@bis/db";
import { resolveAccountZone } from "@/lib/booking/followup-timing";
import { inQuietWindow, quietWindowEnd, formatInstantClock } from "./quiet-hours";
import type { PassContext } from "./context";

/**
 * The one place a customer-facing send meets the quiet-hours window and the
 * automation log (spec §1, §2, amendments 1 and 4).
 *
 *   holdOrSend(ctx, subject, send)
 *     inside the window → write (or re-write) the held row, held_until =
 *                         the window's end, return "held". The pass does NOT
 *                         stamp; the release pass brings the subject back.
 *     otherwise         → send(); write `sent`; return "sent".
 *                         send() throwing → write `failed`, rethrow.
 *     the exemption     → a `deadline` (a reminder's starts_at) at or before
 *                         the window's end sends now: the 6:45 text for the
 *                         7:30 job.
 *
 * The log write is an isolated leg (`record`): it never fails a send, and a
 * failure is one console.error. The settings READ is not: a rejected read
 * rejects the call, the pass counts `failed`, and the row is due again next
 * tick — fail-closed for one tick rather than guessing the window.
 */
export type HoldContext = Pick<PassContext, "db" | "now" | "quiet">;

export type LogSubject = {
  accountId: string;
  source: AutomationLogSource;
  channel: "sms" | "email";
  subjectKey: string;
  contactId: string | null;
  /** What a release needs that the subject row cannot re-derive. */
  payload?: Record<string, unknown>;
};

export type HoldSubject = LogSubject & {
  accountTimezone: string | null;
  /** The latest instant this send is still useful. At or before the window's end → send now. */
  deadline?: Date | null;
};

/** Client-readable, every one of them: a business owner reads these on the Activity page. */
export const REASONS = {
  quietHours: (endsAt: Date, zone: string) => `Held until ${formatInstantClock(endsAt, zone)} — quiet hours`,
  noEmail: "No email address on file",
  noPhone: "No phone number we can text",
  smsGate: "Texting isn't set up for this company yet",
  dailyCap: "Daily limit reached",
  failed: "Couldn't be delivered",
  appointmentStarted: "Appointment already started",
  noLongerDue: "No longer due",
  recipeOff: "This automation was turned off",
  timezone: "The company's time zone isn't set",
  calendarOff: "The booking page is switched off",
  recentText: "A text already went to this person today",
  outsideRegion: "Number is outside the US, Canada or Mexico",
  consentWithheld: "They didn't agree to texts",
  robocall: "Screened as a robocall",
} as const;

/** The write, from the LogSubject fields ONLY — never `{ ...s }`: a HoldSubject carries `accountTimezone` and a `deadline` Date that must not land in the row. */
function writeOf(s: LogSubject) {
  return {
    accountId: s.accountId, source: s.source, channel: s.channel, subjectKey: s.subjectKey, contactId: s.contactId,
    ...(s.payload ? { payload: s.payload } : {}),
  };
}

async function record(db: PassContext["db"], w: AutomationLogWrite): Promise<void> {
  try {
    await recordAutomationLog(db, w);
  } catch (e) {
    console.error(`automation log write failed for ${w.source} ${w.subjectKey}: ${String(e)}`);
  }
}

export async function logSkipped(ctx: Pick<PassContext, "db">, s: LogSubject, reason: string): Promise<void> {
  await record(ctx.db, { ...writeOf(s), status: "skipped", reason });
}

export async function holdOrSend(
  ctx: HoldContext, s: HoldSubject, send: () => Promise<void>,
): Promise<"sent" | "held"> {
  const zone = resolveAccountZone(s.accountTimezone);
  let quietEnd: Date | null = null;
  if (zone === null) {
    console.error(
      `quiet hours: account ${s.accountId}'s timezone ${JSON.stringify(s.accountTimezone)} cannot be resolved — `
      + `sending ${s.source} ${s.subjectKey} without a window; fix the account's timezone`,
    );
  } else {
    const settings = await ctx.quiet(s.accountId);
    if (inQuietWindow(ctx.now, zone, settings)) quietEnd = quietWindowEnd(ctx.now, zone, settings);
  }

  if (quietEnd !== null && !(s.deadline && s.deadline.getTime() <= quietEnd.getTime())) {
    await record(ctx.db, {
      ...writeOf(s), status: "held", heldUntil: quietEnd.toISOString(), reason: REASONS.quietHours(quietEnd, zone!),
    });
    return "held";
  }

  try {
    await send();
  } catch (e) {
    await record(ctx.db, { ...writeOf(s), status: "failed", reason: REASONS.failed });
    throw e;
  }
  await record(ctx.db, { ...writeOf(s), status: "sent", reason: "" });
  return "sent";
}

export type ReleaseVerdict = "sent" | "held" | "skipped" | "failed";
export type Releaser = (ctx: PassContext, row: AutomationLogRow) => Promise<ReleaseVerdict>;

/** A held row, back into the shape the pass writes with — so the release re-writes the SAME row. */
export function subjectOf(row: AutomationLogRow): LogSubject {
  return {
    accountId: row.account_id, source: row.source, channel: row.channel === "ai" ? "sms" : row.channel,
    subjectKey: row.subject_key, contactId: row.contact_id, payload: row.payload,
  };
}

/** What a one-row process run amounted to. */
export function verdict(c: { sent: number; held: number; failed: number }): ReleaseVerdict {
  if (c.sent > 0) return "sent";
  if (c.held > 0) return "held";
  if (c.failed > 0) return "failed";
  return "skipped";
}
```

Run: `pnpm --filter web exec vitest run src/lib/automations/hold-or-send.test.ts` — Expected: PASS. Mutations (whole file, revert each): (a) `return "held"` without the record → the held test reds on `recordAutomationLog`; (b) delete the deadline clause → the exemption test reds at `expect(...).toBe("sent")` on the first line; (c) remove the try/catch in `record` → "a log write that fails" reds; (d) `ctx.quiet("acct_1")` hardcoded → the last holdOrSend test reds.

- [ ] **Step 6: The five by-id lookups in `packages/db`**

`packages/db/src/booking.ts`:

1. Add `contactId: string;` to `DueReminder` (after `accountId`) and to `DueFollowup` (after `accountId`).
2. Add, above `listDueReminders`:

```ts
/** A subject looked up by id for RELEASE: the row, or why there is none —
 *  `gone` (cancelled, already sent, deleted) or `off` (the recipe, the
 *  calendar's feature, or the account's outbound is switched off). */
export type DueLookup<T> = { due: T; why?: undefined } | { due: null; why: "gone" | "off" };

const REMINDER_SELECT = `id, account_id, contact_id, starts_at, booker_timezone, cancel_token, meeting_url,
             calendars(public_id), contacts(first_name, last_name, email)`;

function toDueReminder(r: any, info: AccountBrandInfo): DueReminder {
  const contactName = [r.contacts?.first_name, r.contacts?.last_name].filter(Boolean).join(" ").trim();
  return {
    bookingId: r.id, accountId: r.account_id, contactId: r.contact_id, startsAt: r.starts_at,
    bookerTimezone: r.booker_timezone ?? null, cancelToken: r.cancel_token,
    calendarPublicId: r.calendars?.public_id, contactEmail: r.contacts?.email ?? null,
    contactName: contactName || "Unknown", accountTimezone: info.accountTimezone,
    branding: info.branding, fromEmail: info.fromEmail, meetingUrl: r.meeting_url ?? null,
  };
}
```

3. In `listDueReminders`, replace the inline `.select(\`…\`)` string with `.select(REMINDER_SELECT)` and the whole `return sendable.map((r: any) => {…})` with `return sendable.map((r: any) => toDueReminder(r, accountInfo.get(r.account_id as string)!));`.
4. Add after `listDueReminders`:

```ts
/** The same predicates as the due-list MINUS the time window: the release
 *  step decides "when", this answers "is it still a reminder to send". */
export async function getDueReminderById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueReminder>> {
  const { data, error } = await db.from("bookings").select(REMINDER_SELECT)
    .eq("id", bookingId).eq("status", "booked").is("reminder_sent_at", null).maybeSingle();
  if (error) throw new Error(`getDueReminderById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueReminderById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueReminder(data, accountInfo.get((data as any).account_id)!) };
}
```

5. The same shape for follow-ups. Add `const FOLLOWUP_SELECT = \`id, account_id, contact_id, starts_at, ends_at, calendars!inner(followup_body, followup_enabled), contacts(first_name, last_name, email)\`;` and a `toDueFollowup(r, info)` returning `{ bookingId: r.id, accountId: r.account_id, contactId: r.contact_id, startsAt: r.starts_at, endsAt: r.ends_at, contactEmail: r.contacts?.email ?? null, contactName: …, accountTimezone: info.accountTimezone, branding: info.branding, fromEmail: info.fromEmail, replyToEmail: info.replyToEmail, followupBody: r.calendars?.followup_body ?? "" }`; make `listDueFollowups` use both (it keeps its `.eq("calendars.followup_enabled", true)` and window); add:

```ts
export async function getDueFollowupById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueFollowup>> {
  const { data, error } = await db.from("bookings").select(FOLLOWUP_SELECT)
    .eq("id", bookingId).in("status", ["booked", "completed"]).is("followup_sent_at", null).maybeSingle();
  if (error) throw new Error(`getDueFollowupById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  if ((data as any).calendars?.followup_enabled !== true) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueFollowupById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueFollowup(data, accountInfo.get((data as any).account_id)!) };
}
```

`packages/db/src/automations.ts` — the three recipe lookups. Each reads the booking by id with the due-list's non-window predicates, then the ONE account's automation row (`getAutomation`), then `loadSendableRows`. Extract each list's `sendable.map` body into `toDueReviewRequest(r, info, auto)`, `toDueNoShowNudge(r, info, auto)`, `toDueSmsReminder(r, info, auto)` (where `auto: EnabledRecipe`) and reuse them in the lists. Then add:

```ts
async function enabledRecipeFor(db: SupabaseClient, accountId: string, recipeKey: RecipeKey): Promise<EnabledRecipe | null> {
  const row = await getAutomation(db, accountId, recipeKey);
  return row && row.enabled ? { body: row.body ?? "", config: row.config } : null;
}

export async function getDueReviewRequestById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueReviewRequest>> {
  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, ends_at, completed_at, followup_sent_at, review_request_sms_failed_at, contacts(email, phone)")
    .eq("id", bookingId).eq("status", "completed").is("review_requested_at", null).maybeSingle();
  if (error) throw new Error(`getDueReviewRequestById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const auto = await enabledRecipeFor(db, (data as any).account_id, "review_request");
  if (!auto) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueReviewRequestById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueReviewRequest(data, accountInfo.get((data as any).account_id)!, auto) };
}

export async function getDueNoShowNudgeById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueNoShowNudge>> {
  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, ends_at, no_show_at, no_show_nudge_sms_failed_at, calendars(public_id, enabled), contacts(email, phone)")
    .eq("id", bookingId).eq("status", "no_show").is("no_show_nudged_at", null).maybeSingle();
  if (error) throw new Error(`getDueNoShowNudgeById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const auto = await enabledRecipeFor(db, (data as any).account_id, "no_show_nudge");
  if (!auto) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueNoShowNudgeById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueNoShowNudge(data, accountInfo.get((data as any).account_id)!, auto) };
}

export async function getDueSmsReminderById(db: SupabaseClient, bookingId: string): Promise<DueLookup<DueSmsReminder>> {
  const { data, error } = await db.from("bookings")
    .select("id, account_id, contact_id, starts_at, booker_timezone, sms_reminder_failed_at, contacts(phone)")
    .eq("id", bookingId).eq("status", "booked").is("sms_reminder_sent_at", null).maybeSingle();
  if (error) throw new Error(`getDueSmsReminderById failed: ${error.message}`);
  if (!data) return { due: null, why: "gone" };
  const auto = await enabledRecipeFor(db, (data as any).account_id, "sms_reminder");
  if (!auto) return { due: null, why: "off" };
  const { sendable, accountInfo } = await loadSendableRows(db, [data as { account_id: string }], "getDueSmsReminderById");
  if (sendable.length === 0) return { due: null, why: "off" };
  return { due: toDueSmsReminder(data, accountInfo.get((data as any).account_id)!, auto) };
}
```

`packages/db/src/index.ts`: add `getDueReminderById, getDueFollowupById, type DueLookup` to the `./booking` export list and `getDueReviewRequestById, getDueNoShowNudgeById, getDueSmsReminderById` to the `./automations` list.

Run: `pnpm --filter @bis/db typecheck && pnpm --filter web typecheck` — Expected: web reports `sentinel.test.ts`'s typed `REMINDER_ROW: DueReminder` / `FOLLOWUP_ROW: DueFollowup` (lines ~52/57) missing `contactId`. Add `contactId: "ct_1"` there. Then ALSO add `contactId: "ct_1"` to `route.test.ts`'s `reminder()` and `followup()` helpers (lines ~83 and ~125) — those fixtures are UNTYPED (`Record<string, unknown>` into a bare `vi.fn()`), so typecheck will never flag them, and Task 4a's subject needs the field at runtime. Re-run typecheck — Expected: clean.

- [ ] **Step 7: The live proof of the lookups**

`packages/db/src/test/due-by-id.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking, setBookingStatus, getDueReminderById, getDueFollowupById, stampReminderSent } from "../booking";
import { upsertAutomation, getDueSmsReminderById, getDueReviewRequestById, getDueNoShowNudgeById } from "../automations";

/**
 * Each lookup answers "is this still a thing to send" WITHOUT a time window
 * — the release step owns "when". Three answers per lookup: the row, `gone`,
 * `off`. Live, because the predicates are PostgREST filters and a mocked db
 * cannot tell `.eq("status","booked")` from `.eq("status","completed")`.
 */
async function seed(db: Parameters<typeof createContact>[0], accountId: string) {
  const cal = await getOrCreateCalendar(db, accountId, "user_test");
  const { id: contactId } = await createContact(db, accountId,
    { firstName: "Due", email: "due@example.com", phone: "(956) 555-0199" }, "user_test");
  const { id: bookingId } = await createBooking(db, accountId,
    { calendarId: cal.id, contactId, startsAt: new Date("2027-03-05T15:00:00Z"), endsAt: new Date("2027-03-05T16:00:00Z") },
    "user_test");
  return { cal, contactId, bookingId };
}

describe("getDueReminderById", () => {
  it("returns the row for a booked, unstamped booking; `gone` once stamped or cancelled; `contactId` filled", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId, contactId } = await seed(db, accountId);
      const found = await getDueReminderById(db, bookingId);
      expect(found.due?.bookingId).toBe(bookingId);
      expect(found.due?.contactId).toBe(contactId);
      await stampReminderSent(db, bookingId);
      expect(await getDueReminderById(db, bookingId)).toEqual({ due: null, why: "gone" });
      expect(await getDueReminderById(db, "00000000-0000-0000-0000-000000000000")).toEqual({ due: null, why: "gone" });
    });
  });
});

describe("getDueFollowupById", () => {
  it("`off` while the calendar's follow-ups are disabled; the row once enabled (mutation: drop the followup_enabled check → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { cal, bookingId } = await seed(db, accountId);
      // getOrCreateCalendar's default has follow-ups OFF — read it rather than assume.
      const { data: c } = await db.from("calendars").select("followup_enabled").eq("id", cal.id).single();
      if ((c as { followup_enabled: boolean }).followup_enabled) {
        await db.from("calendars").update({ followup_enabled: false }).eq("id", cal.id);
      }
      expect(await getDueFollowupById(db, bookingId)).toEqual({ due: null, why: "off" });
      await db.from("calendars").update({ followup_enabled: true }).eq("id", cal.id);
      expect((await getDueFollowupById(db, bookingId)).due?.bookingId).toBe(bookingId);
    });
  });
});

describe("the recipe lookups: `off` until the recipe is on, `gone` in the wrong status", () => {
  it("sms reminder", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await seed(db, accountId);
      expect(await getDueSmsReminderById(db, bookingId)).toEqual({ due: null, why: "off" });
      await upsertAutomation(db, accountId, "sms_reminder", { enabled: true, body: "", config: {} }, "user_test");
      expect((await getDueSmsReminderById(db, bookingId)).due?.bookingId).toBe(bookingId);
      await setBookingStatus(db, accountId, bookingId, "cancelled", "user_test");
      expect(await getDueSmsReminderById(db, bookingId)).toEqual({ due: null, why: "gone" });
    });
  });

  it("review request needs status completed", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await seed(db, accountId);
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      expect(await getDueReviewRequestById(db, bookingId)).toEqual({ due: null, why: "gone" });   // still booked
      await setBookingStatus(db, accountId, bookingId, "completed", "user_test");
      const found = await getDueReviewRequestById(db, bookingId);
      expect(found.due?.bookingId).toBe(bookingId);
      expect(found.due?.config).toEqual({ channel: "email", reviewUrl: "https://g.page/r/x/review" });
    });
  });

  it("no-show nudge needs status no_show and carries the calendar's public id", async () => {
    await withTestAccount(async (db, accountId) => {
      const { cal, bookingId } = await seed(db, accountId);
      await upsertAutomation(db, accountId, "no_show_nudge", { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      await setBookingStatus(db, accountId, bookingId, "no_show", "user_test");
      const found = await getDueNoShowNudgeById(db, bookingId);
      expect(found.due?.calendarPublicId).toBe(cal.public_id);
    });
  });
});
```

If `setBookingStatus`'s signature differs from `(db, accountId, bookingId, status, actorId)`, read `booking.ts` and use the real one — do not stub it.

Run: `pnpm --filter @bis/db exec vitest run src/test/due-by-id.test.ts` — ONLY when holding the shared-db slot. Expected: PASS.

- [ ] **Step 8: `route.test.ts`'s factory mock**

`apps/web/src/app/api/cron/reminders/route.test.ts`'s `vi.mock("@bis/db", () => ({…}))` is a factory (no `importOriginal`): add, inside the object,

```ts
  // Task 3 (part C): the reminder and follow-up passes now read the account's
  // quiet window on every send and write the automation log. Off here so
  // the 30 route tests keep their exact bodies; the log write is a no-op.
  readQuietSettings: async () => ({ enabled: false, start: "21:00", end: "08:00" }),
  recordAutomationLog: async () => undefined,
```

Run: `pnpm --filter web exec vitest run src/app/api/cron/reminders/route.test.ts src/lib/automations` — Expected: green (no pass calls holdOrSend yet; Task 4 does).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/automations/hold-or-send.ts apps/web/src/lib/automations/hold-or-send.test.ts apps/web/src/lib/automations/context.ts apps/web/src/lib/automations/harness.ts apps/web/src/lib/automations/harness.test.ts apps/web/src/lib/automations/passes/*.test.ts apps/web/src/lib/automations/send-sms.test.ts apps/web/src/lib/automations/sentinel.test.ts packages/db/src/booking.ts packages/db/src/automations.ts packages/db/src/index.ts packages/db/src/test/due-by-id.test.ts apps/web/src/app/api/cron/reminders/route.test.ts
git commit -m "automations: holdOrSend + ctx.quiet + the five by-id lookups — the seam every pass sends through"
```

---

### Task 4a: The two reminder passes obey the window and can be released (bis-automations, worktree A, parallel with 4b and 5)

**Files:**
- Modify: `apps/web/src/lib/automations/passes/reminders.ts` (full rewrite below), `apps/web/src/lib/automations/passes/sms-reminder.ts` (full rewrite below)
- Create: `apps/web/src/lib/automations/passes/reminders.test.ts`
- Modify: `apps/web/src/lib/automations/passes/sms-reminder.test.ts`, `apps/web/src/app/api/cron/reminders/route.test.ts` (ONLY the top-level reminder literals and `EMPTY_SMS_REMINDERS` — Task 4b owns the other three EMPTY constants; the two hunks are adjacent, and the orchestrator resolves the merge)

**Interfaces:**
- Consumes: Task 3's `holdOrSend`, `logSkipped`, `subjectOf`, `verdict`, `REASONS`, `HoldSubject`, `Releaser`; `getDueReminderById`, `getDueSmsReminderById`, `DueLookup`.
- Produces: `processReminders(ctx, rows)`, `releaseReminder: Releaser`, `processSmsReminders(ctx, rows)`, `releaseSmsReminder: Releaser`; both passes' counters gain `held`.

Merge note for the brief: in THIS worktree `route.test.ts` stays red on `EMPTY_FOLLOWUPS`/`EMPTY_REVIEW_REQUESTS`/`EMPTY_NO_SHOW_NUDGES` until 4b lands (those passes gain `held` there). Run `route.test.ts` here only to confirm that the ONLY failures are those three constants; the gate for this task is `reminders.test.ts` + `sms-reminder.test.ts` + typecheck + eslint. The orchestrator runs `route.test.ts` once after the merge.

- [ ] **Step 1: Write the failing reminder tests**

`apps/web/src/lib/automations/passes/reminders.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueReminder, AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueReminders: vi.fn(), stampReminderSent: vi.fn(), getDueReminderById: vi.fn(), recordAutomationLog: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import type { PassContext } from "../context";
import { remindersPass, releaseReminder } from "./reminders";

const NIGHT = new Date("2026-09-22T04:00:00Z");   // 23:00 CDT, Sept 21
const NOON = new Date("2026-09-21T17:00:00Z");    // 12:00 CDT
const END = "2026-09-22T13:00:00.000Z";           // 08:00 CDT, Sept 22
const ON = { enabled: true, start: "21:00", end: "08:00" };

function row(overrides: Partial<DueReminder> = {}): DueReminder {
  return {
    bookingId: "bk_1", accountId: "acct_1", contactId: "ct_1",
    startsAt: "2026-09-22T20:00:00.000Z",    // 15:00 CDT tomorrow — a day ahead, the email reminder's normal distance
    bookerTimezone: null, cancelToken: "tok_1", calendarPublicId: "cal_pub",
    contactEmail: "maria@example.com", contactName: "Maria Garcia",
    accountTimezone: "America/Chicago",
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
    fromEmail: null, meetingUrl: null,
    ...overrides,
  };
}
const held = (subjectKey = "booking:bk_1"): AutomationLogRow => ({
  id: "log_1", account_id: "acct_1", source: "reminders", channel: "email", contact_id: "ct_1",
  subject_key: subjectKey, status: "held", reason: "Held until 8:00 AM — quiet hours", held_until: END, payload: {}, occurred_at: NIGHT.toISOString(),
});

const emailSend = vi.fn();
function ctx(now: Date, quiet = ON): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => { throw new Error("the email reminder never texts"); },
    quiet: async () => quiet,
  };
}
const logCalls = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1]);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueReminders.mockResolvedValue([]);
  dbMocks.stampReminderSent.mockResolvedValue(undefined);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the email reminder under quiet hours", () => {
  it("inside the window: NOT sent, NOT stamped, one held row with the window's end (mutation: send before holdOrSend → FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row()]);
    expect(await remindersPass.run(ctx(NIGHT))).toEqual({ sent: 0, failed: 0, unstamped: 0, held: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReminderSent).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({
      source: "reminders", channel: "email", subjectKey: "booking:bk_1", contactId: "ct_1",
      status: "held", heldUntil: END, reason: "Held until 8:00 AM — quiet hours",
    })]);
  });

  it("outside the window: sent, stamped, one sent row — exactly as before, plus the row", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row()]);
    expect(await remindersPass.run(ctx(NOON))).toEqual({ sent: 1, failed: 0, unstamped: 0, held: 0 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_1");
    expect(logCalls()).toEqual([expect.objectContaining({ status: "sent", subjectKey: "booking:bk_1" })]);
  });

  it("the exemption: an appointment at 07:30 tomorrow sends at 23:00 tonight (mutation: drop `deadline` from the subject → FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row({ startsAt: "2026-09-22T12:30:00.000Z" })]);
    expect(await remindersPass.run(ctx(NIGHT))).toEqual({ sent: 1, failed: 0, unstamped: 0, held: 0 });
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("no email on file: a skipped row with the plain reason, still counted failed as the route always counted it", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row({ contactEmail: null })]);
    expect(await remindersPass.run(ctx(NOON))).toEqual({ sent: 0, failed: 1, unstamped: 0, held: 0 });
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "No email address on file" })]);
    expect(emailSend).not.toHaveBeenCalled();
  });
});

describe("releaseReminder — the held row is the queue", () => {
  it("a booking no longer due is skipped with 'No longer due'; a suppressed/off account with 'This automation was turned off'", async () => {
    dbMocks.getDueReminderById.mockResolvedValueOnce({ due: null, why: "gone" }).mockResolvedValueOnce({ due: null, why: "off" });
    expect(await releaseReminder(ctx(NOON), held())).toBe("skipped");
    expect(await releaseReminder(ctx(NOON), held())).toBe("skipped");
    expect(logCalls().map((w) => w.reason)).toEqual(["No longer due", "This automation was turned off"]);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("an appointment that already started is skipped with 'Appointment already started' (mutation: drop the check → FAILS: it sends)", async () => {
    dbMocks.getDueReminderById.mockResolvedValue({ due: row({ startsAt: "2026-09-21T16:00:00.000Z" }) });
    expect(await releaseReminder(ctx(NOON), held())).toBe("skipped");
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "Appointment already started" })]);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("a booking still due sends through the SAME path: email, stamp, and the row flips to sent (mutation: release without stamping → FAILS)", async () => {
    dbMocks.getDueReminderById.mockResolvedValue({ due: row() });
    expect(await releaseReminder(ctx(NOON), held())).toBe("sent");
    expect(dbMocks.getDueReminderById).toHaveBeenCalledWith(expect.anything(), "bk_1");
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_1");
    expect(logCalls()).toEqual([expect.objectContaining({ status: "sent", subjectKey: "booking:bk_1" })]);
  });

  it("released while STILL inside the window (the agency lengthened it): re-held, not sent", async () => {
    dbMocks.getDueReminderById.mockResolvedValue({ due: row() });
    expect(await releaseReminder(ctx(NIGHT), held())).toBe("held");
    expect(emailSend).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({ status: "held" })]);
  });
});
```

Run: `pnpm --filter web exec vitest run src/lib/automations/passes/reminders.test.ts` — Expected: FAIL (`releaseReminder` is not exported; counters lack `held`).

- [ ] **Step 2: Rewrite `reminders.ts`**

```ts
import { listDueReminders, stampReminderSent, getDueReminderById, type DueReminder } from "@bis/db";
import { normalizeReplyTo } from "@/lib/email/reply-to";
import { emailBrand } from "@/lib/email/templates/shell";
import { bookingReminderEmail } from "@/lib/email/templates/booking";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

/**
 * Booking reminders, ~a day before `starts_at`. Moved verbatim from
 * api/cron/reminders/route.ts onto the harness (2026-09-06); the route's 30
 * tests run unchanged against this pass through the route.
 *
 * UNCAPPED, by design. The automation caps (caps.ts) guard RECIPE passes
 * against bursts; a reminder is one-to-one with a booking the customer made,
 * and a daily cap on a busy client would drop reminders — the row leaves its
 * 75-minute window before a rolling day clears — turning a burst guard into
 * no-shows. This pass has run uncapped in production and keeps doing so.
 *
 * Counted the way the route always counted: a reminder with no contact email
 * is a `failed` send (contrast the follow-up pass, which counts it
 * `skippedNoEmail`). That difference is the reason the registry is a harness
 * and not a shared listDue/send/stamp algorithm.
 *
 * QUIET HOURS (part C): the send runs inside `holdOrSend`. Inside the
 * account's window the row is HELD — not stamped — and `releaseReminder`
 * brings it back when the window ends, because the 75-minute due window
 * will have closed by then and `listDueReminders` would never see it again.
 * The `deadline` is the appointment itself: a reminder for a job that starts
 * before the window ends goes out now.
 */
export const remindersPass: Pass = {
  key: "reminders",
  async run(ctx) {
    return processReminders(ctx, await listDueReminders(ctx.db, ctx.now.toISOString()));
  },
};

export type ReminderCounters = { sent: number; failed: number; unstamped: number; held: number };

function subjectFor(r: DueReminder): HoldSubject {
  return {
    accountId: r.accountId, accountTimezone: r.accountTimezone, source: "reminders", channel: "email",
    subjectKey: `booking:${r.bookingId}`, contactId: r.contactId, deadline: new Date(r.startsAt),
  };
}

/** The per-row path, shared by the tick (every due row) and the release (one held row). */
export async function processReminders(ctx: PassContext, reminders: DueReminder[]): Promise<ReminderCounters> {
  const c: ReminderCounters = { sent: 0, failed: 0, unstamped: 0, held: 0 };

  for (const reminder of reminders) {
    const subject = subjectFor(reminder);
    // SEND-THEN-STAMP, never the reverse: `reminder_sent_at` is a dedupe
    // marker, not a record of an attempt. A send failure is counted in
    // `failed` and logged, and the row stays unstamped so
    // `listDueReminders` returns it again next tick.
    try {
      if (!reminder.contactEmail) {
        await logSkipped(ctx, subject, REASONS.noEmail);
        throw new Error("no contact email on file");
      }

      const brand = emailBrand(reminder.branding);
      const bookerZone = safeZone(reminder.bookerTimezone ?? undefined, reminder.accountTimezone);
      const whenBookerZone = formatWhen(new Date(reminder.startsAt), bookerZone);
      const cancelUrl = `${ctx.origin}/b/${reminder.calendarPublicId}/cancel/${reminder.cancelToken}`;

      const { html, text } = bookingReminderEmail({
        brand, whenBookerZone, cancelUrl, meetingUrl: reminder.meetingUrl ?? undefined,
      });

      const outcome = await holdOrSend(ctx, subject, async () => {
        // fromAddress carries the account's sending address: a reminder is
        // customer-facing outbound, same shape as the booking confirmation.
        await ctx.email.send({
          to: reminder.contactEmail!,
          fromName: brand.name,
          fromAddress: reminder.fromEmail ?? undefined,
          replyTo: normalizeReplyTo(reminder.branding.replyToEmail),
          subject: "Reminder: your upcoming booking",
          body: text,
          html,
        });

        // A send that already left the building counts as `sent` no matter
        // what happens next. The stamp is retried (stampWithRetry) because at
        // 96 ticks a day an unstamped row is 5-6 identical reminders, and it
        // is still reported when every attempt fails — the retry shrinks the
        // duplicate window, it does not close it.
        const stamp = await stampWithRetry(() => stampReminderSent(ctx.db, reminder.bookingId));
        if (!stamp.stamped) {
          c.unstamped++;
          console.error(
            `reminder sent but NOT stamped for booking ${reminder.bookingId} after `
            + `${stamp.attempts} attempts — expect up to 5 more copies over the next 75 `
            + `minutes: ${String(stamp.lastError)}`,
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
      console.error(`reminder send failed for booking ${reminder.bookingId}: ${String(e)}`);
    }
  }

  return c;
}

/** The release: re-read the booking (the due window is long gone), re-check, send through processReminders. */
export const releaseReminder: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueReminderById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (new Date(found.due.startsAt).getTime() <= ctx.now.getTime()) {
    await logSkipped(ctx, subjectOf(row), REASONS.appointmentStarted);
    return "skipped";
  }
  return verdict(await processReminders(ctx, [found.due]));
};
```

Run: `pnpm --filter web exec vitest run src/lib/automations/passes/reminders.test.ts` — Expected: PASS. Mutations (whole file, revert each): (a) move `ctx.email.send` above `holdOrSend` → "inside the window" reds on `emailSend`; (b) delete `deadline:` from `subjectFor` → the exemption test reds; (c) delete the `startsAt <= now` block in `releaseReminder` → "already started" reds; (d) in the release, call `ctx.email.send` directly instead of `processReminders` → "still due sends through the SAME path" reds on the stamp.

- [ ] **Step 3: The text reminder — tests first**

In `apps/web/src/lib/automations/passes/sms-reminder.test.ts`:
- add `getDueSmsReminderById: vi.fn(), recordAutomationLog: vi.fn()` to `dbMocks`; in `beforeEach` add `dbMocks.recordAutomationLog.mockResolvedValue(undefined);`
- change `function ctx(): PassContext` to `function ctx(now: Date = TICK, quiet = QUIET_OFF): PassContext` with `now` in place of `TICK` and `quiet: async () => quiet` in place of the Task 3 line; define `const QUIET_OFF = { enabled: false, start: "21:00", end: "08:00" }; const QUIET_ON = { ...QUIET_OFF, enabled: true };`
- change `const EMPTY = {…}` to include `held: 0`.
- add `import { smsReminderPass, releaseSmsReminder } from "./sms-reminder";` (replace the existing import) and `import type { AutomationLogRow } from "@bis/db";`
- append:

```ts
describe("sms reminder pass — quiet hours", () => {
  // 06:30 CDT for an 08:30 CDT appointment: due (inside 90–135 min), inside the window, and the appointment is AFTER the window ends.
  const EARLY = new Date("2026-09-22T11:30:00Z");
  const APPT_0830 = "2026-09-22T13:30:00.000Z";
  const END = "2026-09-22T13:00:00.000Z";
  const heldRow = (): AutomationLogRow => ({
    id: "log_s", account_id: "acct_1", source: "sms_reminder", channel: "sms", contact_id: "ct_1",
    subject_key: "booking:bk_s1", status: "held", reason: "Held until 8:00 AM — quiet hours", held_until: END, payload: {}, occurred_at: EARLY.toISOString(),
  });

  it("inside the window with the appointment after its end: NOT sent, NO message row, NOT stamped, one held row (mutation: bypass holdOrSend → FAILS)", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ startsAt: APPT_0830 })]);
    expect(await smsReminderPass.run(ctx(EARLY, QUIET_ON))).toEqual({ ...EMPTY, held: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampSmsReminderSent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "sms_reminder", channel: "sms", subjectKey: "booking:bk_s1", contactId: "ct_1", status: "held", heldUntil: END,
    }));
  });

  it("the exemption: 05:30 for a 07:30 job — before the window ends — sends now (mutation: drop `deadline` → FAILS)", async () => {
    const fiveThirty = new Date("2026-09-22T10:30:00Z");
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ startsAt: "2026-09-22T12:30:00.000Z" })]);
    expect(await smsReminderPass.run(ctx(fiveThirty, QUIET_ON))).toEqual({ ...EMPTY, sent: 1 });
    expect(smsSend).toHaveBeenCalledTimes(1);
  });

  it("no textable phone / gate refused: a skipped row with the plain reason (mutation: drop either logSkipped → FAILS)", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ contactPhone: "" }), row({ bookingId: "bk_s2" })]);
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    await smsReminderPass.run(ctx());
    expect(dbMocks.recordAutomationLog.mock.calls.map((c) => [c[1].subjectKey, c[1].status, c[1].reason])).toEqual([
      ["booking:bk_s1", "skipped", "No phone number we can text"],
      ["booking:bk_s2", "skipped", "Texting isn't set up for this company yet"],
    ]);
  });

  it("release: an appointment that started during the hold is skipped, never texted (mutation: drop the check → FAILS)", async () => {
    dbMocks.getDueSmsReminderById.mockResolvedValue({ due: row({ startsAt: "2026-09-22T12:45:00.000Z" }) });   // 07:45, before an 08:00 release
    expect(await releaseSmsReminder(ctx(new Date("2026-09-22T13:00:00Z")), heldRow())).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "Appointment already started" }));
  });

  it("release: still due → texts through the same path and the row flips to sent", async () => {
    dbMocks.getDueSmsReminderById.mockResolvedValue({ due: row({ startsAt: APPT_0830 }) });
    expect(await releaseSmsReminder(ctx(new Date("2026-09-22T13:00:00Z")), heldRow())).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampSmsReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_s1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: "sent" }));
  });

  it("release: the recipe was turned off meanwhile → 'This automation was turned off'", async () => {
    dbMocks.getDueSmsReminderById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseSmsReminder(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "This automation was turned off" }));
  });
});
```

Every EXISTING `expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, … })` keeps working because `EMPTY` gained `held: 0` and the default `ctx()` is quiet-off.

Run the file — Expected: FAIL on the new describe (no `releaseSmsReminder`, no held).

- [ ] **Step 4: Rewrite `sms-reminder.ts`**

```ts
import {
  listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed, getDueSmsReminderById,
  type DueSmsReminder,
} from "@bis/db";
import { resolveSmsSender, type SmsGate } from "@/lib/sms/sender";
import { toE164 } from "@/lib/voice/phone-number";
import { safeZone, formatWhen } from "@/lib/booking/time";
import { stampWithRetry } from "@/lib/booking/stamp-retry";
import { composeSmsReminder, defaultSmsReminderBody } from "../sms-reminder-copy";
import { sendAutomationSms, markAutomationSmsSent } from "../send-sms";
import {
  holdOrSend, logSkipped, subjectOf, verdict, REASONS, type HoldSubject, type Releaser,
} from "../hold-or-send";
import type { Pass, PassContext } from "../context";

/**
 * The text reminder, ~2h before `starts_at` — the second step of the
 * booking reminder sequence (the email goes ~a day before). SMS only, by
 * definition of the recipe; the due-row carries no email address.
 *
 * NO MORNING GATE: the window IS the moment (listDueSmsReminders). Per row:
 *   no textable phone → SMS gate refused (skip and count; there is no other
 *   channel) → holdOrSend(send → STAMP → mark the message row sent).
 *
 * NO 24h HOLD after a failed attempt (danlo, 2026-09-07, from Milestone B's
 * review — see SMS_RETRY_COOLDOWN_MS in caps.ts): the window is 45 minutes,
 * three ticks, so a hold that outlived it meant ONE attempt ever and a
 * single carrier blip cost the customer their reminder. A failed send still
 * writes `sms_reminder_failed_at` (an attempt marker the operator can see)
 * but this pass never reads it back; the window bounds a bad afternoon to
 * three attempts and three failed rows (cron-coupling.test.ts pins the 3).
 * The customer-visible worst case is the flip side: a provider failure that
 * was actually accepted (a timeout after delivery) is retried next tick, so
 * up to three copies of the reminder can land. Inherent to retrying, and
 * the right trade for a reminder.
 *
 * UNCAPPED, by the spec's own reasoning for the email reminder.
 *
 * QUIET HOURS (part C): this is the recipe the reminder EXEMPTION exists
 * for. Due ~2h before the appointment, a text for a 07:30 job is due at
 * 05:30 — inside the default window — and holding it to 08:00 would text
 * someone about a job that already started. So the subject's `deadline` is
 * the appointment: at or before the window's end, it sends now. A job AFTER
 * the window's end (08:30, due 06:30) is held and released at 08:00 — thirty
 * minutes' notice instead of two hours, which is the trade the client made
 * when they set quiet hours. On release, an appointment that has already
 * started is skipped with its reason, never texted.
 *
 * The time is rendered in the BOOKER's zone (safeZone, the email
 * reminder's rule), so a Los Angeles booker of a New York company reads
 * their own clock.
 */
export const smsReminderPass: Pass = {
  key: "smsReminders",
  async run(ctx) {
    return processSmsReminders(ctx, await listDueSmsReminders(ctx.db, ctx.now.toISOString()));
  },
};

export type SmsReminderCounters = {
  sent: number; failed: number; unstamped: number; held: number; skippedNoAddress: number; skippedSmsGate: number;
};

function subjectFor(r: DueSmsReminder): HoldSubject {
  return {
    accountId: r.accountId, accountTimezone: r.accountTimezone, source: "sms_reminder", channel: "sms",
    subjectKey: `booking:${r.bookingId}`, contactId: r.contactId, deadline: new Date(r.startsAt),
  };
}

export async function processSmsReminders(ctx: PassContext, due: DueSmsReminder[]): Promise<SmsReminderCounters> {
  const c: SmsReminderCounters = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedNoAddress: 0, skippedSmsGate: 0 };
  const smsGates = new Map<string, SmsGate>();

  for (const row of due) {
    const subject = subjectFor(row);
    const to = toE164(row.contactPhone);
    if (!to) {
      c.skippedNoAddress++;
      await logSkipped(ctx, subject, REASONS.noPhone);
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
      await logSkipped(ctx, subject, REASONS.smsGate);
      console.error(
        `text reminder skipped for booking ${row.bookingId}: account ${row.accountId} cannot text (${gate.reason})`,
      );
      continue;
    }
    const from = gate.from;

    // Inside the per-row try: a junk ACCOUNT zone makes formatWhen throw,
    // and that is this row's failure, not the pass's.
    try {
      const zone = safeZone(row.bookerTimezone ?? undefined, row.accountTimezone);
      const body = composeSmsReminder(
        row.brandName, formatWhen(new Date(row.startsAt), zone), row.body.trim() || defaultSmsReminderBody());
      const outcome = await holdOrSend(ctx, subject, async () => {
        const smsRow = await sendAutomationSms(ctx, {
          accountId: row.accountId, contactId: row.contactId, to, from, body,
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
        await markAutomationSmsSent(ctx, row.accountId, smsRow, "text reminder");
      });
      if (outcome === "held") {
        c.held++;
        continue;
      }
      c.sent++;
    } catch (e) {
      c.failed++;
      console.error(`text reminder send failed for booking ${row.bookingId}: ${String(e)}`);
    }
  }

  return c;
}

export const releaseSmsReminder: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueSmsReminderById(ctx.db, bookingId);
  if (!found.due) {
    await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue);
    return "skipped";
  }
  if (new Date(found.due.startsAt).getTime() <= ctx.now.getTime()) {
    await logSkipped(ctx, subjectOf(row), REASONS.appointmentStarted);
    return "skipped";
  }
  return verdict(await processSmsReminders(ctx, [found.due]));
};
```

Note one deliberate change from the old file: `markAutomationSmsSent` now runs INSIDE the send closure, after the stamp, so the `sent` log row is written after the message row is marked. Ordering `stamp < updateMessageStatus` is unchanged and the existing test still pins it.

Run: `pnpm --filter web exec vitest run src/lib/automations/passes/sms-reminder.test.ts` — Expected: PASS (all old + new). Mutations: (a) call `sendAutomationSms` before `holdOrSend` → the held test reds on `createMessage`; (b) delete `deadline` → the exemption reds; (c) delete the `startsAt <= now` block → the release-skip test reds; (d) delete the `logSkipped` at the gate → the skipped-rows test reds on the second tuple.

- [ ] **Step 5: `route.test.ts` — this task's share**

In `apps/web/src/app/api/cron/reminders/route.test.ts`: every expected body's TOP-LEVEL `unstamped: N,` gains `held: 0,` after it (the reminder pass's counters are spread top-level: `route.ts:59-66`); `EMPTY_SMS_REMINDERS` gains `held: 0`. Do NOT touch `EMPTY_FOLLOWUPS`, `EMPTY_REVIEW_REQUESTS`, `EMPTY_NO_SHOW_NUDGES` (Task 4b), nor `EMPTY_WEEKLY_CLIENT` / `EMPTY_WEEKLY_AGENCY` (their `unstamped:` keys never gain `held`), nor the NESTED `followups: {…}` objects inside the two multi-line bodies at ~:412 and ~:447. Exactly SEVEN top-level `unstamped: N,` lines gain `held: 0,`: the five single-line bodies at ~:242/265/288/304/397 and the two multi-line ones (their top-level `unstamped: 0,` is the line one level shallower than the nested `followups` object's). Count them before and after. Run the file and confirm the only failures are those three constants' shapes (each error names one of them); paste one such failure into the report as the proof it is the expected red.

- [ ] **Step 6: Gate and commit**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web exec vitest run src/lib/automations` — Expected: typecheck/lint clean; `sentinel.test.ts` passes (`results.reminders?.sent` and `smsReminders?.sent` unchanged: TICK is 14:00Z = 09:00 CDT, quiet-off ctx).

```bash
git add apps/web/src/lib/automations/passes/reminders.ts apps/web/src/lib/automations/passes/reminders.test.ts apps/web/src/lib/automations/passes/sms-reminder.ts apps/web/src/lib/automations/passes/sms-reminder.test.ts apps/web/src/app/api/cron/reminders/route.test.ts
git commit -m "automations: the two reminder passes hold, release and log — the appointment is the deadline"
```

---

### Task 4b: The three band-gated passes obey the window and can be released (bis-automations, worktree B, parallel with 4a and 5)

**Files:**
- Modify: `apps/web/src/lib/automations/passes/followups.ts`, `review-request.ts`, `no-show-nudge.ts`
- Create: `apps/web/src/lib/automations/passes/followups.test.ts`
- Modify: `apps/web/src/lib/automations/passes/review-request.test.ts`, `no-show-nudge.test.ts`; `apps/web/src/app/api/cron/reminders/route.test.ts` (ONLY `EMPTY_FOLLOWUPS`, `EMPTY_REVIEW_REQUESTS`, `EMPTY_NO_SHOW_NUDGES` gain `held: 0`)

**Interfaces:**
- Consumes: Task 3's exports; `getDueFollowupById`, `getDueReviewRequestById`, `getDueNoShowNudgeById`.
- Produces: `processFollowups(ctx, rows, { released })`, `releaseFollowup`; `processReviewRequests(ctx, rows, { released })`, `releaseReviewRequest`; `processNoShowNudges(ctx, rows, { released })`, `releaseNoShowNudge`. All three counters gain `held`.

Merge note: same as 4a, mirrored — in this worktree `route.test.ts` is red only on the reminders' top-level `held` and `EMPTY_SMS_REMINDERS`.

- [ ] **Step 1: The shape every one of the three follows**

Each pass becomes:

```ts
export const xPass: Pass = {
  key: "…",
  async run(ctx) {
    return processX(ctx, await listDueX(ctx.db, ctx.now.toISOString()), { released: false });
  },
};

export type ProcessOptions = { released: boolean };   // declare ONCE in hold-or-send.ts? No — each pass declares its own local type; the option is one boolean and a shared type would be a fourth file to keep in step.

export async function processX(ctx: PassContext, rows: DueX[], opts: { released: boolean }): Promise<Counters> {
  … the existing loop, verbatim, with three edits:
  1. the band gate is wrapped:   if (!opts.released && !shouldSendXNow(…)) { c.waitingForMorning++; continue; }
  2. every client-relevant `continue` gains `await logSkipped(ctx, subject, REASONS.…)` BEFORE it:
       unresolvable zone      → REASONS.timezone
       no address             → REASONS.noEmail (email) / REASONS.noPhone (sms)
       sms gate refused       → REASONS.smsGate
       daily cap              → REASONS.dailyCap          (the TICK cap is a per-tick queue, not logged)
       calendar off (nudge)   → REASONS.calendarOff
     NOT logged: waitingForMorning, the SMS cooldown, an invalid config (the channel is unknown before the config parses — console only), a gate read failure (counted failed, console only).
  3. the send+stamp+mark block moves inside `holdOrSend(ctx, subject, async () => {…})`; "held" → c.held++; continue.
}

export const releaseX: Releaser = async (ctx, row) => {
  const bookingId = row.subject_key.replace(/^booking:/, "");
  const found = await getDueXById(ctx.db, bookingId);
  if (!found.due) { await logSkipped(ctx, subjectOf(row), found.why === "off" ? REASONS.recipeOff : REASONS.noLongerDue); return "skipped"; }
  return verdict(await processX(ctx, [found.due], { released: true }));
};
```

The subject, per pass:

```ts
// followups
{ accountId: f.accountId, accountTimezone: f.accountTimezone, source: "followups", channel: "email", subjectKey: `booking:${f.bookingId}`, contactId: f.contactId }
// review request — the channel is the CONFIGURED one, so the subject is built after `config` parses:
{ accountId: row.accountId, accountTimezone: row.accountTimezone, source: "review_request", channel: config.channel, subjectKey: `booking:${row.bookingId}`, contactId: row.contactId }
// no-show nudge — same, channel: config.channel, source: "no_show_nudge"
```

No `deadline` on any of the three (nothing here is tied to an appointment ahead).

- [ ] **Step 2: Follow-ups — tests first**

`apps/web/src/lib/automations/passes/followups.test.ts` (new; the route tests keep covering the normal path):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueFollowup, AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueFollowups: vi.fn(), stampFollowupSent: vi.fn(), getDueFollowupById: vi.fn(), recordAutomationLog: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import type { PassContext } from "../context";
import { followupsPass, releaseFollowup } from "./followups";

// 09:00 CDT on Sept 22 — inside the 08:00–11:00 band, the day after a meeting that ended Sept 21.
const MORNING = new Date("2026-09-22T14:00:00Z");
// 03:00 CDT on Sept 22 — NOT in the band, and inside the default quiet window.
const SMALL_HOURS = new Date("2026-09-22T08:00:00Z");
const ON = { enabled: true, start: "21:00", end: "08:00" };
const OFF = { ...ON, enabled: false };
// A window ending at NOON: the band (08–11) is entirely inside it, so a follow-up due at 09:00 is held until 12:00.
const UNTIL_NOON = { enabled: true, start: "21:00", end: "12:00" };
const NOON = new Date("2026-09-22T17:00:00Z");

function row(overrides: Partial<DueFollowup> = {}): DueFollowup {
  return {
    bookingId: "bk_f1", accountId: "acct_1", contactId: "ct_1",
    startsAt: "2026-09-21T19:00:00.000Z", endsAt: "2026-09-21T20:00:00.000Z",   // ended 15:00 CDT Sept 21
    contactEmail: "maria@example.com", contactName: "Maria Garcia", accountTimezone: "America/Chicago",
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
    fromEmail: null, replyToEmail: null, followupBody: "How did it go?",
    ...overrides,
  };
}
const heldRow = (): AutomationLogRow => ({
  id: "log_f", account_id: "acct_1", source: "followups", channel: "email", contact_id: "ct_1",
  subject_key: "booking:bk_f1", status: "held", reason: "Held until 12:00 PM — quiet hours", held_until: NOON.toISOString(), payload: {}, occurred_at: MORNING.toISOString(),
});
const emailSend = vi.fn();
function ctx(now: Date, quiet = OFF): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => { throw new Error("follow-ups never text"); }, quiet: async () => quiet,
  };
}
const EMPTY = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedNoEmail: 0, waitingForMorning: 0, unresolvableTimezone: 0 };
const logCalls = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1]);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueFollowups.mockResolvedValue([]);
  dbMocks.stampFollowupSent.mockResolvedValue(undefined);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("follow-ups: the band decides WHEN IT IS DUE, the window decides WHEN IT GOES", () => {
  it("in the band, quiet off: sent and stamped, one sent row", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampFollowupSent).toHaveBeenCalledWith(expect.anything(), "bk_f1");
    expect(logCalls()).toEqual([expect.objectContaining({ source: "followups", channel: "email", status: "sent", contactId: "ct_1" })]);
  });

  it("outside the band the gate still waits — no row, no send, whatever the window says (mutation: skip the gate on the normal tick → FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run(ctx(SMALL_HOURS, OFF))).toEqual({ ...EMPTY, waitingForMorning: 1 });
    expect(logCalls()).toEqual([]);
  });

  it("in the band but inside a window that ends at noon: HELD until 12:00 (the band and the window compose; mutation: bypass holdOrSend → FAILS)", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row()]);
    expect(await followupsPass.run(ctx(MORNING, UNTIL_NOON))).toEqual({ ...EMPTY, held: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampFollowupSent).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({ status: "held", heldUntil: NOON.toISOString(), reason: "Held until 12:00 PM — quiet hours" })]);
  });

  it("release at noon: the band is CLOSED, and the release sends anyway because the band was satisfied at hold time (mutation: apply the gate on release → FAILS)", async () => {
    dbMocks.getDueFollowupById.mockResolvedValue({ due: row() });
    expect(await releaseFollowup(ctx(NOON, UNTIL_NOON), heldRow())).toBe("sent");
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampFollowupSent).toHaveBeenCalledWith(expect.anything(), "bk_f1");
  });

  it("no email: a skipped row with the plain reason, counted as before", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ contactEmail: null })]);
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, skippedNoEmail: 1 });
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "No email address on file" })]);
  });

  it("an unresolvable account zone: a skipped row that says so", async () => {
    dbMocks.listDueFollowups.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await followupsPass.run(ctx(MORNING))).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "The company's time zone isn't set" })]);
  });

  it("release: gone / calendar follow-ups switched off", async () => {
    dbMocks.getDueFollowupById.mockResolvedValueOnce({ due: null, why: "gone" }).mockResolvedValueOnce({ due: null, why: "off" });
    expect(await releaseFollowup(ctx(NOON), heldRow())).toBe("skipped");
    expect(await releaseFollowup(ctx(NOON), heldRow())).toBe("skipped");
    expect(logCalls().map((w) => w.reason)).toEqual(["No longer due", "This automation was turned off"]);
  });
});
```

Then edit `followups.ts` per Step 1: extract `processFollowups(ctx, followups, opts)`; the gate becomes `if (!opts.released && !shouldSendFollowupNow(ctx.now, new Date(followup.endsAt), followup.accountTimezone)) { waitingForMorning++; continue; }`; add `held` to the counters and the returned object; `logSkipped` before the `unresolvableTimezone` and `skippedNoEmail` continues; wrap `ctx.email.send` + `stampWithRetry` in `holdOrSend`; export `releaseFollowup` using `getDueFollowupById`. Imports: add `getDueFollowupById, type DueFollowup` from `@bis/db`, the hold-or-send names, and `PassContext`.

Run the new file — Expected: PASS. Mutations: (a) drop `!opts.released &&` → "release at noon" reds; (b) drop `opts.released` handling entirely by never passing it → same; (c) bypass holdOrSend → "HELD until 12:00" reds; (d) delete the no-email `logSkipped` → that test reds.

- [ ] **Step 3: Review request and no-show nudge — tests first**

In `review-request.test.ts` and `no-show-nudge.test.ts`:
- `dbMocks` gains `getDueReviewRequestById: vi.fn()` (resp. `getDueNoShowNudgeById`) and `recordAutomationLog: vi.fn()` (default `mockResolvedValue(undefined)` in `beforeEach`);
- `ctx()` becomes `ctx(now = TICK, quiet = QUIET_OFF)` with `quiet: async () => quiet`;
- `EMPTY` gains `held: 0`;
- import the pass AND the releaser.

Append to `review-request.test.ts` (adapt the fixture helper names the file already has — it builds due rows with a `row()`/`due()` helper; use that):

```ts
describe("review request — quiet hours and release", () => {
  const UNTIL_NOON = { enabled: true, start: "21:00", end: "12:00" };
  const NOON = new Date("2026-09-22T17:00:00Z");
  const heldRow = (channel: "sms" | "email"): AutomationLogRow => ({
    id: "log_r", account_id: "acct_1", source: "review_request", channel, contact_id: "ct_1",
    subject_key: "booking:bk_r1", status: "held", reason: "Held until 12:00 PM — quiet hours", held_until: NOON.toISOString(), payload: {}, occurred_at: TICK.toISOString(),
  });

  it("in the band, inside a window ending at noon: held, not sent, not stamped, no message row (mutation: bypass holdOrSend → FAILS)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ config: { channel: "sms", reviewUrl: URL } })]);   // the file's default row is EMAIL and its id is bk_r1; this test needs the SMS channel
    const result = await reviewRequestPass.run(ctx(TICK, UNTIL_NOON));
    expect(result.held).toBe(1);
    expect(result.sent).toBe(0);
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "review_request", channel: "sms", subjectKey: "booking:bk_r1", status: "held", heldUntil: NOON.toISOString(),
    }));
  });

  it("release at noon skips the band and sends through the same path — stamp included (mutation: gate on release → FAILS)", async () => {
    dbMocks.getDueReviewRequestById.mockResolvedValue({ due: row({ config: { channel: "sms", reviewUrl: URL } }) });
    expect(await releaseReviewRequest(ctx(NOON, UNTIL_NOON), heldRow("sms"))).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: "sent" }));
  });

  it("the daily cap and a missing address write skipped rows with plain reasons; the tick cap does not", async () => {
    dbMocks.countReviewRequestsSince.mockResolvedValue(AUTOMATION_DAILY_CAP);
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ config: { channel: "sms", reviewUrl: URL } }), row({ bookingId: "bk_2", contactPhone: null, config: { channel: "sms", reviewUrl: URL } })]);
    await reviewRequestPass.run(ctx());
    expect(dbMocks.recordAutomationLog.mock.calls.map((c) => [c[1].subjectKey, c[1].reason])).toEqual([
      ["booking:bk_2", "No phone number we can text"],
      ["booking:bk_r1", "Daily limit reached"],
    ].sort());   // order is the loop's; sort both sides if the file's rows come back the other way
  });

  it("release: the recipe was turned off → 'This automation was turned off'", async () => {
    dbMocks.getDueReviewRequestById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseReviewRequest(ctx(), heldRow("email"))).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "This automation was turned off" }));
  });
});
```

`TICK` in that file is 2026-09-09T14:00Z = 10:00 America/New_York, inside the band on the day after the fixture's end (verified). The file's default `row()` is `bookingId: "bk_r1"` with `config: { channel: "email", reviewUrl: URL }` — hence the explicit SMS override above and the `bk_r1` literals. The same four tests for the no-show nudge, whose default `row()` is `bookingId: "bk_n1"` with `config: { channel: "email" }` (override `config: { channel: "sms" }` and use `booking:bk_n1` / `"bk_n1"`), with `noShowNudgePass`/`releaseNoShowNudge`/`getDueNoShowNudgeById`/`stampNoShowNudged`/`countNoShowNudgesSince` and one extra:

```ts
  it("the booking page switched off: a skipped row 'The booking page is switched off'", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ calendarEnabled: false })]);
    await noShowNudgePass.run(ctx());
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "The booking page is switched off" }));
  });
```

Then edit `review-request.ts` and `no-show-nudge.ts` per Step 1. The `holdOrSend` closure in each wraps: the `if (target.channel === "sms") { smsRow = await sendAutomationSms(…) } else { await sendEmail(…) }` block, the `stampWithRetry` block, and `if (smsRow) await markAutomationSmsSent(…)`. Keep the existing `try { … } catch (e) { c.failed++; …; continue; }` around the closure call; a "held" outcome → `c.held++; continue;` — and because the cap accounting (`attemptsThisTick++`, `sentToday.set(…)`) runs BEFORE the send today, a held row consumes a tick slot tonight (harmless: it is held again next tick) and the daily count is re-read from stamps, so the DAILY cap stays exact. Say this in a comment above the holdOrSend call.

Run both files — Expected: PASS. Mutations per file: bypass holdOrSend → held test reds; apply the gate on release → release test reds; delete the `dailyCap` logSkipped → the reasons test reds.

- [ ] **Step 4: `route.test.ts` — this task's share, the gate, commit**

`EMPTY_FOLLOWUPS`, `EMPTY_REVIEW_REQUESTS`, `EMPTY_NO_SHOW_NUDGES` each gain `held: 0`. Confirm the only remaining route failures name the reminders' top-level shape or `EMPTY_SMS_REMINDERS` (Task 4a's share).

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web exec vitest run src/lib/automations` — Expected: clean; `sentinel.test.ts` still shows `followups?.sent 1`, `reviewRequests?.sent 2`, `noShowNudges?.sent 2` (quiet-off ctx).

```bash
git add apps/web/src/lib/automations/passes/followups.ts apps/web/src/lib/automations/passes/followups.test.ts apps/web/src/lib/automations/passes/review-request.ts apps/web/src/lib/automations/passes/review-request.test.ts apps/web/src/lib/automations/passes/no-show-nudge.ts apps/web/src/lib/automations/passes/no-show-nudge.test.ts apps/web/src/app/api/cron/reminders/route.test.ts
git commit -m "automations: follow-ups, review requests and no-show nudges hold, release past the band, and log"
```

---

### Task 5: The instant reply obeys the window and is released from its payload (bis-automations, worktree C, parallel with 4a and 4b)

**Files:**
- Modify: `apps/web/src/lib/automations/instant-reply.ts`, `apps/web/src/lib/automations/instant-reply.test.ts`

**Interfaces:**
- Consumes: Task 1's `readQuietSettings`, `readAccountTimezone`; Task 3's `holdOrSend`, `logSkipped`, `subjectOf`, `REASONS`, `HoldSubject`, `Releaser`.
- Produces: `InstantReplyOutcome` gains `| { kind: "held" }`; `export type InstantReplyPayload`; `export function parseInstantReplyPayload(raw: unknown): InstantReplyPayload | null`; `export const releaseInstantReply: Releaser`.

- [ ] **Step 1: Tests first**

In `instant-reply.test.ts`: `dbMocks` gains `readQuietSettings: vi.fn(), readAccountTimezone: vi.fn(), recordAutomationLog: vi.fn()`; `beforeEach` sets `readQuietSettings → { enabled: false, start: "21:00", end: "08:00" }`, `readAccountTimezone → "America/Chicago"`, `recordAutomationLog → undefined`. Import `releaseInstantReply, parseInstantReplyPayload` too, and `type AutomationLogRow` from `@bis/db`. Append:

```ts
describe("instant reply — quiet hours", () => {
  const NIGHT = new Date("2026-09-22T04:00:00Z");   // 23:00 CDT
  const ON = { enabled: true, start: "21:00", end: "08:00" };
  const END = "2026-09-22T13:00:00.000Z";

  it("a form submitted at 23:00: held, not texted, not stamped; the held row carries what a release needs (mutation: bypass holdOrSend → FAILS)", async () => {
    dbMocks.readQuietSettings.mockResolvedValue(ON);
    expect(await sendInstantReply(input({ now: NIGHT, locale: "es", consentWithheld: false }))).toEqual({ kind: "held" });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampInstantReplySent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct_1", source: "instant_reply", channel: "sms", subjectKey: "submission:sub_1", contactId: "ct_1",
      payload: { contactId: "ct_1", conversationId: "convo_1", phoneE164: "+19565550101", locale: "es", consentWithheld: false },
      status: "held", heldUntil: END, reason: "Held until 8:00 AM — quiet hours",
    });
  });

  it("the window is read for the SUBMISSION's account, in that account's zone (mutation: hardcode either → FAILS)", async () => {
    dbMocks.readQuietSettings.mockResolvedValue(ON);
    dbMocks.readAccountTimezone.mockResolvedValue("Asia/Tokyo");   // 23:00Z Sept 21 = 08:00 JST Sept 22 — the window just ENDED there
    expect((await sendInstantReply(input({ now: new Date("2026-09-21T23:00:00Z") }))).kind).toBe("sent");
    expect(dbMocks.readQuietSettings).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.readAccountTimezone).toHaveBeenCalledWith(expect.anything(), "acct_1");
  });

  it("nothing is read for a submission the free checks refuse, and nothing is logged for an account without the recipe (mutation: log `disabled` → FAILS)", async () => {
    dbMocks.getAutomation.mockResolvedValue({ ...ROW, enabled: false });
    expect(await sendInstantReply(input())).toEqual({ kind: "skipped", reason: "disabled" });
    expect(dbMocks.readQuietSettings).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("with the recipe ON, the gate / the 24h hold / the daily cap each write a skipped row a client can read", async () => {
    senderMock.resolveSmsSender.mockResolvedValueOnce({ ok: false, reason: "a2p_not_approved" });
    await sendInstantReply(input());
    dbMocks.hasRecentOutboundSms.mockResolvedValueOnce(true);
    await sendInstantReply(input({ submissionId: "sub_2" }));
    dbMocks.countInstantRepliesSince.mockResolvedValueOnce(AUTOMATION_DAILY_CAP);
    await sendInstantReply(input({ submissionId: "sub_3" }));
    expect(dbMocks.recordAutomationLog.mock.calls.map((c) => [c[1].subjectKey, c[1].status, c[1].reason])).toEqual([
      ["submission:sub_1", "skipped", "Texting isn't set up for this company yet"],
      ["submission:sub_2", "skipped", "A text already went to this person today"],
      ["submission:sub_3", "skipped", "Daily limit reached"],
    ]);
  });
});

describe("releaseInstantReply — from the held row's payload", () => {
  const heldRow = (payload: Record<string, unknown>): AutomationLogRow => ({
    id: "log_i", account_id: "acct_1", source: "instant_reply", channel: "sms", contact_id: "ct_1",
    subject_key: "submission:sub_1", status: "held", reason: "x", held_until: "2026-09-22T13:00:00.000Z", payload, occurred_at: "2026-09-22T04:00:00.000Z",
  });
  const PAYLOAD = { contactId: "ct_1", conversationId: "convo_1", phoneE164: "+19565550101", locale: "en", consentWithheld: false };
  const ctx = { db: {} as never, now: new Date("2026-09-22T13:00:00Z"), origin: "", email: { isFake: true, send: async () => ({ providerMessageId: "e" }) }, sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }), quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }) };

  it("re-runs every check and sends: the text goes, the submission is stamped, the row flips to sent (mutation: skip the stamp on release → FAILS)", async () => {
    expect(await releaseInstantReply(ctx, heldRow(PAYLOAD))).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect((smsSend.mock.calls[0]![0] as { body: string }).body).toContain(EN);
    expect(dbMocks.stampInstantReplySent).toHaveBeenCalledWith(expect.anything(), "sub_1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: "sent", subjectKey: "submission:sub_1" }));
  });

  it("a payload that cannot be parsed is skipped as 'No longer due', never texted", async () => {
    expect(await releaseInstantReply(ctx, heldRow({ phoneE164: 5 }))).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "No longer due" }));
  });

  it("a skip at release (the thread got a text meanwhile) writes the plain reason", async () => {
    dbMocks.hasRecentOutboundSms.mockResolvedValue(true);
    expect(await releaseInstantReply(ctx, heldRow(PAYLOAD))).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "A text already went to this person today" }));
  });

  it("parseInstantReplyPayload accepts exactly the shape the hold wrote", () => {
    expect(parseInstantReplyPayload(PAYLOAD)).toEqual(PAYLOAD);
    expect(parseInstantReplyPayload({ ...PAYLOAD, locale: "fr" })).toBeNull();
    expect(parseInstantReplyPayload({ ...PAYLOAD, consentWithheld: "no" })).toBeNull();
    expect(parseInstantReplyPayload(null)).toBeNull();
  });
});
```

Run the file — Expected: FAIL (no held outcome, no releaser).

- [ ] **Step 2: Edit `instant-reply.ts`**

Imports: add `readQuietSettings, readAccountTimezone` to the `@bis/db` import; add `import { holdOrSend, logSkipped, subjectOf, REASONS, type HoldSubject, type LogSubject, type Releaser } from "./hold-or-send";`.

Types:

```ts
export type InstantReplyOutcome =
  | { kind: "sent"; unstamped: boolean }
  | { kind: "held" }
  | { kind: "failed"; error: string }
  | { kind: "skipped"; reason: InstantReplySkip; detail?: string };

/** What the release needs and the submission row cannot cheaply re-derive.
 *  Written into the held row's `payload`; parsed back, never trusted. */
export type InstantReplyPayload = {
  contactId: string; conversationId: string; phoneE164: string; locale: "en" | "es"; consentWithheld: boolean;
};

export function parseInstantReplyPayload(raw: unknown): InstantReplyPayload | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.contactId !== "string" || typeof p.conversationId !== "string" || typeof p.phoneE164 !== "string") return null;
  if (p.locale !== "en" && p.locale !== "es") return null;
  if (typeof p.consentWithheld !== "boolean") return null;
  return { contactId: p.contactId, conversationId: p.conversationId, phoneE164: p.phoneE164, locale: p.locale, consentWithheld: p.consentWithheld };
}
```

In `sendInstantReply`, right after `if (!body) return …` (the recipe is now known ON), build the log subject:

```ts
  // From here on the recipe is ON, so a refusal is something the client
  // wants to see on the Activity page. Nothing above this line is logged:
  // `disabled` would write a row per lead for every company without the
  // recipe, and `noPhone`/`consentWithheld` are only meaningful once it is on.
  const logSubject: LogSubject = {
    accountId, source: "instant_reply", channel: "sms", subjectKey: `submission:${submissionId}`, contactId: input.contactId,
  };
```

then add `await logSkipped({ db }, logSubject, REASONS.smsGate);` before the `smsGate` return, `await logSkipped({ db }, logSubject, REASONS.recentText);` before the `recentText` return, `await logSkipped({ db }, logSubject, REASONS.dailyCap);` before the `dailyCap` return.

Replace everything from `const ctx: SmsSendContext = …` to the end of the function with:

```ts
  // The provider comes from the harness's lazy getter and from nowhere else
  // (imports.test.ts): constructed only now, after the send is decided.
  const ctx: SmsSendContext = { db, sms: lazySmsProvider() };
  // QUIET HOURS: the one inline send goes through the same seam as every
  // pass. Held → the row carries the payload, and releaseInstantReply below
  // re-runs this whole function from it when the window ends.
  const subject: HoldSubject = {
    ...logSubject,
    accountTimezone: await readAccountTimezone(db, accountId),
    payload: {
      contactId: input.contactId, conversationId: input.conversationId, phoneE164: to,
      locale: input.locale, consentWithheld: input.consentWithheld,
    } satisfies InstantReplyPayload,
  };
  let sent: SentSms | null = null;
  let unstamped = false;
  let outcome: "sent" | "held";
  try {
    outcome = await holdOrSend({ db, now, quiet: (id) => readQuietSettings(db, id) }, subject, async () => {
      sent = await sendAutomationSms(ctx, {
        accountId, contactId: input.contactId, to, from: gate.from, body,
        // The same locale that picked the body picks the opt-out
        // disclosure's language. Sending a Spanish reply that ends in
        // "Reply STOP to opt out." would undo the whole point of having a
        // bodyEs at all.
        language: input.locale,
        // Nothing retries an instant reply, so there is no attempt marker to write.
        onProviderFailure: async () => {},
      });
      // SEND-THEN-STAMP, no retry: the per-thread hold is the double-text guard;
      // the stamp is the cap's evidence — a miss undercounts by one and re-texts
      // no one.
      try {
        await stampInstantReplySent(db, submissionId);
      } catch (e) {
        unstamped = true;
        console.error(`${WHAT}: text sent but submission ${submissionId} not stamped: ${String(e)}`);
      }
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`${WHAT} failed for submission ${submissionId}: ${error}`);
    return { kind: "failed", error };
  }
  if (outcome === "held") return { kind: "held" };
  await markAutomationSmsSent(ctx, accountId, sent!, WHAT);
  return { kind: "sent", unstamped };
}

const SKIP_REASONS: Record<InstantReplySkip, string> = {
  noPhone: REASONS.noPhone, outsideRegion: REASONS.outsideRegion, consentWithheld: REASONS.consentWithheld,
  disabled: REASONS.recipeOff, smsGate: REASONS.smsGate, recentText: REASONS.recentText, dailyCap: REASONS.dailyCap,
};

/** The release: rebuild the input from the held row and run the whole
 *  function again — every check re-applies, and the held row flips to
 *  whatever this run decides. */
export const releaseInstantReply: Releaser = async (ctx, row) => {
  const payload = parseInstantReplyPayload(row.payload);
  if (!payload) {
    await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
    return "skipped";
  }
  const outcome = await sendInstantReply({
    db: ctx.db, now: ctx.now, accountId: row.account_id,
    submissionId: row.subject_key.replace(/^submission:/, ""), ...payload,
  });
  if (outcome.kind === "skipped") {
    await logSkipped(ctx, subjectOf(row), SKIP_REASONS[outcome.reason]);
    return "skipped";
  }
  return outcome.kind;
};
```

Note: the `readAccountTimezone` read happens only after the cap check, so an account with the recipe off still pays exactly one read per submission (the module's own promise, kept).

Run: `pnpm --filter web exec vitest run src/lib/automations/instant-reply.test.ts src/lib/forms src/app/f src/app/api/intake` — Expected: PASS (the form action and intake route mock the module; `enrich.ts` ignores the outcome's kind). Mutations: (a) send outside holdOrSend → the held test reds on `createMessage`; (b) hardcode `"America/Chicago"` → the Tokyo test reds; (c) log `disabled` → the "nothing is logged" test reds; (d) in the release, skip `sendInstantReply` and call `sendAutomationSms` directly → the stamp assertion reds.

- [ ] **Step 3: Gate and commit**

Run: `pnpm --filter web typecheck && pnpm --filter web lint` — Expected: clean. (`imports.test.ts` scans `lib/automations` for provider-factory imports; `hold-or-send.ts` and the edited file import none.)

```bash
git add apps/web/src/lib/automations/instant-reply.ts apps/web/src/lib/automations/instant-reply.test.ts
git commit -m "automations: the instant reply holds at night and is released from its payload"
```

---

### Task 6: The release pass, the registry, and the three non-pass writers (bis-automations, main checkout, after 4a + 4b + 5 are merged)

**Files:**
- Create: `apps/web/src/lib/automations/passes/release-held.ts`, `apps/web/src/lib/automations/passes/release-held.test.ts`
- Modify: `apps/web/src/lib/automations/registry.ts`, `apps/web/src/lib/automations/sentinel.test.ts`, `apps/web/src/app/api/cron/reminders/route.test.ts`
- Modify: `apps/web/src/lib/automations/passes/weekly-report.ts` + `weekly-report.test.ts`
- Modify: `apps/web/src/app/api/concierge/[publicId]/turn/route.ts` + `route.test.ts`
- Modify: `apps/web/src/lib/voice/finish-call.ts` + `finish-call.test.ts`

**Interfaces:**
- Consumes: every `releaseX` from 4a/4b/5; `listReleasableHolds`, `recordAutomationLog`; `REASONS`, `logSkipped`, `subjectOf`.
- Produces: `releaseHeldPass` (key `releaseHeld`, counters `{ examined, sent, held, skipped, failed, errored }`), `RELEASERS`, `RELEASE_BATCH = 200`. `PASSES[0]` is the release pass.

- [ ] **Step 1: The release pass — tests first**

`apps/web/src/lib/automations/passes/release-held.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({ listReleasableHolds: vi.fn(), recordAutomationLog: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const releasers = vi.hoisted(() => ({
  reminders: vi.fn(), followups: vi.fn(), review: vi.fn(), noShow: vi.fn(), sms: vi.fn(), instant: vi.fn(),
}));
vi.mock("./reminders", () => ({ releaseReminder: (...a: unknown[]) => releasers.reminders(...a) }));
vi.mock("./followups", () => ({ releaseFollowup: (...a: unknown[]) => releasers.followups(...a) }));
vi.mock("./review-request", () => ({ releaseReviewRequest: (...a: unknown[]) => releasers.review(...a) }));
vi.mock("./no-show-nudge", () => ({ releaseNoShowNudge: (...a: unknown[]) => releasers.noShow(...a) }));
vi.mock("./sms-reminder", () => ({ releaseSmsReminder: (...a: unknown[]) => releasers.sms(...a) }));
vi.mock("../instant-reply", () => ({ releaseInstantReply: (...a: unknown[]) => releasers.instant(...a) }));

import type { PassContext } from "../context";
import { releaseHeldPass, RELEASE_BATCH } from "./release-held";

const NOW = new Date("2026-09-22T13:00:00Z");
const row = (source: AutomationLogRow["source"], key: string): AutomationLogRow => ({
  id: `log_${key}`, account_id: "acct_1", source, channel: source === "voice" ? "ai" : "sms", contact_id: null,
  subject_key: key, status: "held", reason: "x", held_until: "2026-09-22T13:00:00.000Z", payload: {}, occurred_at: "2026-09-22T04:00:00.000Z",
});
const ctx: PassContext = {
  db: {} as never, now: NOW, origin: "https://app.example.com",
  email: { isFake: true, send: async () => ({ providerMessageId: "e" }) }, sms: () => ({ isFake: true, send: async () => ({ providerMessageId: "s" }) }),
  quiet: async () => ({ enabled: false, start: "21:00", end: "08:00" }),
};

beforeEach(() => {
  for (const fn of [...Object.values(dbMocks), ...Object.values(releasers)]) fn.mockReset();
  dbMocks.listReleasableHolds.mockResolvedValue([]);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("releaseHeldPass", () => {
  it("reads the queue at the tick's own instant with the batch size, and hands each row to ITS source's releaser (mutation: swap two map entries → FAILS)", async () => {
    dbMocks.listReleasableHolds.mockResolvedValue([
      row("reminders", "booking:1"), row("followups", "booking:2"), row("review_request", "booking:3"),
      row("no_show_nudge", "booking:4"), row("sms_reminder", "booking:5"), row("instant_reply", "submission:6"),
    ]);
    releasers.reminders.mockResolvedValue("sent"); releasers.followups.mockResolvedValue("held");
    releasers.review.mockResolvedValue("skipped"); releasers.noShow.mockResolvedValue("failed");
    releasers.sms.mockResolvedValue("sent"); releasers.instant.mockResolvedValue("sent");

    expect(await releaseHeldPass.run(ctx)).toEqual({ examined: 6, sent: 3, held: 1, skipped: 1, failed: 1, errored: 0 });
    expect(dbMocks.listReleasableHolds).toHaveBeenCalledWith(expect.anything(), NOW.toISOString(), RELEASE_BATCH);
    expect(releasers.reminders).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:1" }));
    expect(releasers.followups).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:2" }));
    expect(releasers.review).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:3" }));
    expect(releasers.noShow).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:4" }));
    expect(releasers.sms).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "booking:5" }));
    expect(releasers.instant).toHaveBeenCalledWith(ctx, expect.objectContaining({ subject_key: "submission:6" }));
  });

  it("a releaser that throws is counted errored and the next row still runs (mutation: drop the per-row try/catch → FAILS)", async () => {
    dbMocks.listReleasableHolds.mockResolvedValue([row("reminders", "booking:1"), row("sms_reminder", "booking:2")]);
    releasers.reminders.mockRejectedValue(new Error("db exploded"));
    releasers.sms.mockResolvedValue("sent");
    expect(await releaseHeldPass.run(ctx)).toEqual({ examined: 2, sent: 1, held: 0, skipped: 0, failed: 0, errored: 1 });
    expect(releasers.sms).toHaveBeenCalledTimes(1);
  });

  it("a held row from a source that cannot be held (voice, concierge, the weekly report) is skipped as 'No longer due' so it leaves the queue", async () => {
    dbMocks.listReleasableHolds.mockResolvedValue([row("voice", "call:9")]);
    expect(await releaseHeldPass.run(ctx)).toEqual({ examined: 1, sent: 0, held: 0, skipped: 1, failed: 0, errored: 0 });
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "voice", subjectKey: "call:9", status: "skipped", reason: "No longer due" }));
  });

  it("an empty queue is one read and no writes", async () => {
    expect(await releaseHeldPass.run(ctx)).toEqual({ examined: 0, sent: 0, held: 0, skipped: 0, failed: 0, errored: 0 });
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });
});
```

Then `apps/web/src/lib/automations/passes/release-held.ts`:

```ts
import { listReleasableHolds, type AutomationLogSource } from "@bis/db";
import type { Pass } from "../context";
import { logSkipped, subjectOf, REASONS, type Releaser } from "../hold-or-send";
import { releaseReminder } from "./reminders";
import { releaseFollowup } from "./followups";
import { releaseReviewRequest } from "./review-request";
import { releaseNoShowNudge } from "./no-show-nudge";
import { releaseSmsReminder } from "./sms-reminder";
import { releaseInstantReply } from "../instant-reply";

/**
 * The queue's consumer (spec §1, amendment 1). FIRST in the registry on
 * every tick: every held row whose `held_until` has passed is handed back
 * to its source, which re-reads the subject, re-checks it, and sends
 * through the same per-row path the normal tick uses — so the held row
 * flips to `sent`, `skipped` or `failed` by the same write the pass would
 * have made, or is re-held if the agency lengthened the window.
 *
 * Runs BEFORE the domain passes so a subject released here is stamped
 * before its own pass's due-list runs; the sequential harness is what makes
 * a double send impossible in the same tick.
 *
 * A row a releaser leaves untouched (a band-gated pass whose SMS cooldown
 * is still active, say) keeps its past `held_until` and is examined again
 * next tick — bounded by RELEASE_BATCH and by the row's own fate. A source
 * that can never be held (the AI rows, the weekly report) has no releaser;
 * such a row can only exist by a bug and is skipped out of the queue with
 * a reason rather than examined forever.
 */
export const RELEASE_BATCH = 200;

export const RELEASERS: Record<AutomationLogSource, Releaser | null> = {
  reminders: releaseReminder,
  followups: releaseFollowup,
  review_request: releaseReviewRequest,
  no_show_nudge: releaseNoShowNudge,
  sms_reminder: releaseSmsReminder,
  instant_reply: releaseInstantReply,
  weekly_report: null,
  concierge: null,
  voice: null,
};

export const releaseHeldPass: Pass = {
  key: "releaseHeld",
  async run(ctx) {
    const c = { examined: 0, sent: 0, held: 0, skipped: 0, failed: 0, errored: 0 };
    const rows = await listReleasableHolds(ctx.db, ctx.now.toISOString(), RELEASE_BATCH);
    for (const row of rows) {
      c.examined++;
      try {
        const releaser = RELEASERS[row.source];
        if (!releaser) {
          await logSkipped(ctx, subjectOf(row), REASONS.noLongerDue);
          c.skipped++;
          continue;
        }
        c[await releaser(ctx, row)]++;
      } catch (e) {
        c.errored++;
        console.error(`release of ${row.source} ${row.subject_key} failed outright: ${String(e)}`);
      }
    }
    return c;
  },
};
```

Run the test — Expected: PASS. Mutations: swap `reminders`/`followups` in `RELEASERS` → the first test reds; drop the try/catch → the second reds.

- [ ] **Step 2: Registry, sentinel, route**

`registry.ts`: import `releaseHeldPass` and make it the FIRST entry: `[releaseHeldPass, remindersPass, followupsPass, …]`. Update the doc comment's first paragraph: "The release pass runs first: a held subject is sent (and stamped) before its own pass's due-list runs, so the same tick cannot send it twice."

`sentinel.test.ts`: the order literal at `:146` becomes `["releaseHeld", "reminders", "followups", "reviewRequests", "noShowNudges", "smsReminders", "siteTraffic", "weeklyClientReport", "weeklyAgencyReport"]`; `dbMocks` gains `listReleasableHolds: vi.fn()` (resolving `[]` in `beforeEach`) and `recordAutomationLog: vi.fn()` (resolving `undefined`); add after the counters guards: `expect(results.releaseHeld).toEqual({ examined: 0, sent: 0, held: 0, skipped: 0, failed: 0, errored: 0 });`.

`route.test.ts`: the factory gains `listReleasableHolds: async () => [],`; add `const EMPTY_RELEASE = { examined: 0, sent: 0, held: 0, skipped: 0, failed: 0, errored: 0 };` beside the other EMPTY constants; every expected body gains `releaseHeld: EMPTY_RELEASE,` (put it right before `followups: EMPTY_FOLLOWUPS` in each — `sed -i 's/followups: EMPTY_FOLLOWUPS/releaseHeld: EMPTY_RELEASE, followups: EMPTY_FOLLOWUPS/'` covers the one-line bodies; check the multi-line one at ~`:412` by hand).

Run: `pnpm --filter web exec vitest run src/lib/automations src/app/api/cron` — Expected: PASS, `route.test.ts` fully green for the first time since 4a/4b.

- [ ] **Step 3: The weekly report writes its row**

`weekly-report.ts`: add `recordAutomationLog` to the `@bis/db` import. Inside the `if (anySent) { … }` block, after the stamp:

```ts
          // Part C: the client's own history shows the report went out —
          // one row per account-week, exempt from quiet hours (it goes to
          // the OWNER, Monday morning). An isolated leg, like the stamp.
          try {
            await recordAutomationLog(ctx.db, {
              accountId: row.accountId, source: "weekly_report", channel: "email", contactId: null,
              subjectKey: `week:${monday}`, status: "sent",
            });
          } catch (e) {
            console.error(`weekly report: log write failed for account ${row.accountId}: ${String(e)}`);
          }
```

`weekly-report.test.ts`: `dbMocks` gains `recordAutomationLog: vi.fn()` (resolving `undefined`); add:

```ts
  it("writes ONE sent row keyed by the week once at least one recipient got it, and none when every send failed (mutation: log before the loop → FAILS)", async () => {
    dbMocks.listAccountsDueWeeklyReport.mockResolvedValue([row({ reportEmails: ["a@x.com", "b@x.com"] })]);
    metricsMock.weeklyMetrics.mockResolvedValue(WEEK);
    await weeklyClientReportPass.run(ctx());
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct_1", source: "weekly_report", channel: "email", contactId: null, subjectKey: `week:${MONDAY}`, status: "sent",
    });
    dbMocks.recordAutomationLog.mockClear();
    emailSend.mockRejectedValue(new Error("bounce"));
    await weeklyClientReportPass.run(ctx());
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });
```

(Use the file's own `row`, `ctx`, `WEEK`, `MONDAY`, `emailSend`, `metricsMock` — they exist at its top.)

- [ ] **Step 4: The concierge writes its row**

`apps/web/src/app/api/concierge/[publicId]/turn/route.ts`: add `recordAutomationLog` to the `@bis/db` import list at `:119`. Immediately after `conversationId = created.id;` (`:292`):

```ts
      // Part C: one `ai` row per conversation START — "website chats" on
      // the client's Activity page is the count of these. Isolated leg.
      try {
        await recordAutomationLog(db, {
          accountId: profile.account_id, source: "concierge", channel: "ai", contactId: null,
          subjectKey: `conversation:${created.id}`, status: "sent",
        });
      } catch (e) {
        log("automation log write failed", { conversationId: created.id, error: String(e) });
      }
```

`route.test.ts` beside it (`vi.mock("@bis/db", async (importOriginal) => { const actual = …; return { ...actual, … } })`): add `recordAutomationLog: dbMocks.recordAutomationLog` (or the file's own override style) resolving `undefined`; add two assertions to an existing new-conversation test and an existing continued-conversation test:

```ts
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ source: "concierge", channel: "ai", subjectKey: `conversation:${createdId}`, status: "sent" }));
    // …and on the continued-conversation path:
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
```

where `createdId` is whatever id the file's `createConciergeConversation` mock returns.

- [ ] **Step 5: The phone assistant writes its row**

`apps/web/src/lib/voice/finish-call.ts`: add `recordAutomationLog` to the `@bis/db` import and `import { REASONS } from "@/lib/automations/hold-or-send";`. After the `finishCallRow` try/catch (the block that sets `stored = true`), add:

```ts
  // Part C: one `ai` row per answered call, AFTER the durable row. A spam
  // outcome is `skipped` with its reason — "8 skipped · Screened as a
  // robocall" is the visibility the robocall week asked for — and "calls
  // handled" on the Activity page counts the sent rows. Its own try/catch,
  // like every other leg.
  if (meta.callRowId) {
    try {
      await recordAutomationLog(ctx.db, {
        accountId: ctx.accountId, source: "voice", channel: "ai", contactId,
        subjectKey: `call:${meta.callRowId}`,
        status: outcome === "spam" ? "skipped" : "sent",
        reason: outcome === "spam" ? REASONS.robocall : "",
      });
    } catch (e) {
      console.error(`finishCall ${meta.callRowId}: automation log write failed: ${String(e)}`);
    }
  }
```

`finish-call.test.ts`: `dbMocks` gains `recordAutomationLog: vi.fn()` (resolving `undefined` in `beforeEach`); add, using the file's own state/ctx/meta builders for a booked call, a spam call, and a call with no `callRowId`:

```ts
describe("finishCall — the automation log row", () => {
  it("a handled call writes a sent row keyed by the call id with the resolved contact", async () => {
    // build a `booked` state the file's other tests use; then:
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "voice", channel: "ai", subjectKey: `call:${CALL_ROW_ID}`, status: "sent", reason: "",
    }));
  });
  it("a spam call writes a skipped row that says 'Screened as a robocall' (mutation: log every outcome as sent → FAILS)", async () => {
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "Screened as a robocall" }));
  });
  it("no call row id → no log row; a log write that throws changes nothing about the result", async () => {
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
    dbMocks.recordAutomationLog.mockRejectedValue(new Error("down"));
    // …a booked call again: the result is the same object shape as before, `stored: true`.
  });
});
```

Read the file's existing builders (`makeState`/`ctx()`/`meta()` or whatever they are named — the file is ~1000 lines and has them) and use them; do not invent a second fixture.

- [ ] **Step 6: The whole web suite, the factory sweep, commit**

Run: `pnpm --filter web test` — Expected: green. If any test fails with `[vitest] No "recordAutomationLog" export is defined on the mock` (or `listReleasableHolds`, `readQuietSettings`, `readAccountTimezone`), that file's `vi.mock("@bis/db", () => ({…}))` factory needs the export added as a no-op (`async () => undefined` / `async () => []` / `async () => ({ enabled: false, start: "21:00", end: "08:00" })` / `async () => "America/Chicago"`). The likely files: `apps/web/src/app/api/voice/incoming/lifecycle.test.ts`, `…/voice/incoming/route.test.ts`, `…/voice/texml/handoff-result/route.test.ts`, `apps/web/src/app/f/[publicId]/actions.test.ts`, `apps/web/src/app/api/intake/[publicId]/route.test.ts`. List every one you touched in the report.

Run: `pnpm --filter web typecheck && pnpm --filter web lint` — Expected: clean.

```bash
git add apps/web/src/lib/automations/passes/release-held.ts apps/web/src/lib/automations/passes/release-held.test.ts apps/web/src/lib/automations/registry.ts apps/web/src/lib/automations/sentinel.test.ts apps/web/src/app/api/cron/reminders/route.test.ts apps/web/src/lib/automations/passes/weekly-report.ts apps/web/src/lib/automations/passes/weekly-report.test.ts "apps/web/src/app/api/concierge/[publicId]/turn/route.ts" "apps/web/src/app/api/concierge/[publicId]/turn/route.test.ts" apps/web/src/lib/voice/finish-call.ts apps/web/src/lib/voice/finish-call.test.ts
git add -u apps/web/src   # any factory mocks touched in Step 6
git commit -m "automations: the release pass runs first; the weekly report, the website assistant and the phone assistant write their rows"
```

---

### Task 7: The Activity page — "What went out" (bis-automations, worktree D, parallel with Task 8; bis-design-reviewer after)

**Files:**
- Create: `apps/web/src/lib/automations/log-titles.ts`, `log-titles.test.ts`
- Create: `apps/web/src/lib/reports/month-window.ts`, `month-window.test.ts`; Modify: `apps/web/src/lib/reports/weekly-window.ts` (export `localMidnightInstant`)
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/activity/page.tsx`, `usage-card.tsx`, `activity-table.tsx`, `log-status-pill.tsx`, `page.test.ts`, `activity-table.test.ts`, `usage-card.test.ts`
- Modify: `apps/web/src/lib/messages.ts` (ALL new keys, Task 8's included), `apps/web/src/lib/nav-groups.ts`, `apps/web/src/lib/nav-groups.test.ts`, `apps/web/src/components/app-sidebar.tsx`, `apps/web/src/lib/palette/registry.ts`, `apps/web/e2e/client-access.spec.ts` (the `CLIENT_NAV` literal), `apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx`

**Interfaces:**
- Consumes: `listAutomationLog`, `countAutomationUsage`, `AutomationUsage`, `AutomationLogListRow`, `AUTOMATION_LOG_SOURCES`; `parseCursor`, `parseTimeCursor`, `encodeCursor` (`@/lib/cursor`); `renderZone` (`@/lib/zone`), `ZoneNote`; `formatCallTime` (`../calls/format`); `AUTOMATION_DAILY_CAP` (`@/lib/automations/caps`), `CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY` (`@/lib/concierge/guards`), the calls page's `readLimitConfig().perAccountPerDay` (same import as `calls/page.tsx:59`).
- Produces: `SOURCE_TITLES`, `CHANNEL_WORDS`, `STATUS_TREATMENTS`; `monthWindow(now, zone): { fromIso, toIso, label }`; `PAGE_SIZE = 25` (exported from `activity-table.tsx`); `LogStatusPill`; the route `/dashboard/accounts/[accountId]/activity`; nav key `nav.activity`; every `activity.*` and `automations.quiet.*` message key.

- [ ] **Step 1: Copy — every key, once**

Append to `apps/web/src/lib/messages.ts`, after the `automations.instantReply.bodiesRequired` line:

```ts
  // Part C — the Quiet hours card (agency, on the Automations page).
  "automations.quiet.title": "Quiet hours",
  "automations.quiet.body": "No automated texts or emails go to your customers between these hours. Anything due overnight waits and goes at the end. Your phone and website assistant still answer.",
  "automations.quiet.enabled": "Use quiet hours",
  "automations.quiet.from": "From",
  "automations.quiet.to": "Until",
  "automations.quiet.zone": "Times are in {zone}",
  "automations.quiet.save": "Save quiet hours",
  "automations.quiet.saved": "Quiet hours saved",
  "automations.quiet.saveFailed": "Could not save quiet hours.",
  "automations.quiet.invalidTime": "Enter both times as hours and minutes, like 9:00 PM.",
  "automations.activityLink": "See what went out",

  // Part C — the Activity page, /dashboard/accounts/<id>/activity. BOTH
  // audiences: this is the record of what the system did on the client's
  // behalf, the first place to look when an automation misfires.
  "nav.activity": "Activity",
  "activity.title": "What went out",
  "activity.usage.title": "This month",
  "activity.usage.texts": "Texts sent",
  "activity.usage.emails": "Emails sent",
  "activity.usage.conversations": "Website chats",
  "activity.usage.calls": "Calls handled",
  "activity.usage.capRecipe": "Up to {cap} a day per automation",
  "activity.usage.capDay": "Up to {cap} a day",
  "activity.usage.held": "{n} waiting",
  "activity.usage.skipped": "{n} skipped",
  "activity.usage.topReason": "most often: {reason}",
  "activity.usage.error": "Couldn't load this month's numbers. Reload the page to try again.",
  "activity.empty.title": "Nothing has gone out yet",
  "activity.empty.body": "Every text, email and conversation the system handles for this company shows up here, the moment it happens.",
  "activity.error": "Couldn't load the history. Reload the page to try again.",
  "activity.col.when": "When",
  "activity.col.what": "What",
  "activity.col.who": "Who",
  "activity.col.channel": "How",
  "activity.col.status": "Status",
  "activity.status.sent": "Sent",
  "activity.status.held": "Waiting",
  "activity.status.skipped": "Skipped",
  "activity.status.failed": "Failed",
  "activity.channel.sms": "Text",
  "activity.channel.email": "Email",
  "activity.channel.ai": "Assistant",
  "activity.older": "Older",
  "activity.newer": "Newer",
  "activity.source.reminders": "Booking reminders",
  "activity.source.followups": "Follow-up emails",
  "activity.source.weekly_report": "Weekly report",
  "activity.source.concierge": "Website assistant",
  "activity.source.voice": "Phone assistant",
```

Run: `pnpm --filter web exec vitest run src/lib/messages.test.ts` — Expected: PASS (no internal milestone label in any of them).

- [ ] **Step 2: Titles and treatments — tests first**

`apps/web/src/lib/automations/log-titles.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { AUTOMATION_LOG_SOURCES } from "@bis/db";
import { SOURCE_TITLES, CHANNEL_WORDS, STATUS_TREATMENTS } from "./log-titles";

describe("log titles", () => {
  it("every source the database allows has a title, and no title is the key itself (mutation: delete one entry → typecheck AND this FAIL)", () => {
    for (const source of AUTOMATION_LOG_SOURCES) {
      expect(SOURCE_TITLES[source], source).toMatch(/^[A-Z][a-z]/);
      expect(SOURCE_TITLES[source], source).not.toBe(source);
      expect(SOURCE_TITLES[source], source).not.toContain("_");
    }
  });
  it("the recipe titles ARE the catalogue's own titles (mutation: retype one → FAILS)", () => {
    expect(SOURCE_TITLES.review_request).toBe("Review requests");
    expect(SOURCE_TITLES.sms_reminder).toBe("Text reminders");
    expect(SOURCE_TITLES.no_show_nudge).toBe("No-show follow-ups");
    expect(SOURCE_TITLES.instant_reply).toBe("Instant reply to new leads");
  });
  it("four distinct status words and three channel words", () => {
    expect(new Set(Object.values(STATUS_TREATMENTS).map((t) => t.label)).size).toBe(4);
    expect(Object.keys(CHANNEL_WORDS).sort()).toEqual(["ai", "email", "sms"]);
    for (const t of Object.values(STATUS_TREATMENTS)) { expect(t.dot).toMatch(/^bg-/); expect(t.chip).toContain("border-"); }
  });
});
```

`apps/web/src/lib/automations/log-titles.ts`:

```ts
import type { AutomationLogSource, AutomationLogChannel, AutomationLogStatus } from "@bis/db";
import { m } from "@/lib/messages";

/** A recipe KEY never reaches a screen (DESIGN.md, Voice). The four recipe
 *  cards' own titles are reused so the history and the settings page name
 *  the same thing the same way. */
export const SOURCE_TITLES: Record<AutomationLogSource, string> = {
  reminders: m["activity.source.reminders"],
  followups: m["activity.source.followups"],
  review_request: m["automations.review.title"],
  no_show_nudge: m["automations.noShow.title"],
  sms_reminder: m["automations.smsReminder.title"],
  instant_reply: m["automations.instantReply.title"],
  weekly_report: m["activity.source.weekly_report"],
  concierge: m["activity.source.concierge"],
  voice: m["activity.source.voice"],
};

export const CHANNEL_WORDS: Record<AutomationLogChannel, string> = {
  sms: m["activity.channel.sms"], email: m["activity.channel.email"], ai: m["activity.channel.ai"],
};

/** Dot + word (DESIGN.md rule 3), the same treatment shape as the Calls
 *  page's OUTCOMES (calls/format.ts:34) so the two pills read as one system. */
export const STATUS_TREATMENTS: Record<AutomationLogStatus, { label: string; dot: string; chip: string }> = {
  sent: { label: m["activity.status.sent"], dot: "bg-success", chip: "border-success/30 bg-success/10 text-foreground" },
  held: { label: m["activity.status.held"], dot: "bg-primary", chip: "border-primary/30 bg-primary/5 text-foreground" },
  skipped: { label: m["activity.status.skipped"], dot: "bg-muted-foreground/60", chip: "border-border bg-transparent text-muted-foreground" },
  failed: { label: m["activity.status.failed"], dot: "bg-destructive", chip: "border-destructive/25 bg-transparent text-muted-foreground" },
};
```

Run the test — Expected: PASS.

- [ ] **Step 3: This month, in the account's zone — tests first**

In `apps/web/src/lib/reports/weekly-window.ts`, change `function localMidnightInstant` to `export function localMidnightInstant` (the doc comment stays).

`apps/web/src/lib/reports/month-window.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { monthWindow } from "./month-window";

describe("monthWindow — the calendar month `now` falls in, on the account's wall clock", () => {
  it("the same instant is September in Chicago and October in Tokyo (mutation: use UTC → the Chicago case FAILS)", () => {
    const instant = new Date("2026-10-01T03:00:00Z");   // 22:00 CDT Sept 30 · 12:00 JST Oct 1
    expect(monthWindow(instant, "America/Chicago")).toEqual({
      fromIso: "2026-09-01T05:00:00.000Z", toIso: "2026-10-01T05:00:00.000Z", label: "September 2026",
    });
    expect(monthWindow(instant, "Asia/Tokyo")).toEqual({
      fromIso: "2026-09-30T15:00:00.000Z", toIso: "2026-10-31T15:00:00.000Z", label: "October 2026",
    });
  });
  it("a month that crosses the fall-back change: local midnight on each edge, NOT 30 × 24h (mutation: add days in ms → FAILS)", () => {
    expect(monthWindow(new Date("2026-11-15T12:00:00Z"), "America/Chicago")).toEqual({
      fromIso: "2026-11-01T05:00:00.000Z",   // 00:00 CDT
      toIso: "2026-12-01T06:00:00.000Z",     // 00:00 CST
      label: "November 2026",
    });
  });
  it("December rolls into the next year", () => {
    expect(monthWindow(new Date("2026-12-31T23:00:00Z"), "UTC")).toEqual({
      fromIso: "2026-12-01T00:00:00.000Z", toIso: "2027-01-01T00:00:00.000Z", label: "December 2026",
    });
  });
});
```

`apps/web/src/lib/reports/month-window.ts`:

```ts
import { localMidnightInstant } from "./weekly-window";

export type MonthWindow = { fromIso: string; toIso: string; label: string };

/**
 * `[first of this month 00:00 local, first of next month 00:00 local)` for
 * the month `now` falls in on `zone`'s wall clock, plus the label the card
 * prints ("September 2026"). Each edge is resolved as its own local
 * midnight (weekly-window.ts's fixed point), never `from + N days`, because
 * a month with a DST change is not N × 24 hours long. `zone` is already
 * resolved by the caller (renderZone) — an unusable zone throws here, which
 * is the page's loud failure, not a silent UTC.
 */
export function monthWindow(now: Date, zone: string): MonthWindow {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit" }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")!.value);
  const month = Number(parts.find((p) => p.type === "month")!.value);
  const key = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}-01`;
  const next = month === 12 ? key(year + 1, 1) : key(year, month + 1);
  return {
    fromIso: localMidnightInstant(key(year, month), zone).toISOString(),
    toIso: localMidnightInstant(next, zone).toISOString(),
    label: new Intl.DateTimeFormat("en-US", { timeZone: zone, month: "long", year: "numeric" }).format(now),
  };
}
```

Run: `pnpm --filter web exec vitest run src/lib/reports` — Expected: PASS (the existing weekly-window tests too).

- [ ] **Step 4: The page's components**

`apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/activity/log-status-pill.tsx`:

```tsx
import type { AutomationLogStatus } from "@bis/db";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { STATUS_TREATMENTS } from "@/lib/automations/log-titles";

/** Dot + word, the Calls page's OutcomePill shape, for the four log statuses. */
export function LogStatusPill({ status }: { status: AutomationLogStatus }) {
  const t = STATUS_TREATMENTS[status];
  return (
    <Badge variant="chip" className={cn("gap-1.5 py-1 pr-2.5 pl-2", t.chip)} data-status={status}>
      <span className={cn("size-[7px] rounded-full", t.dot)} aria-hidden />
      {t.label}
    </Badge>
  );
}
```

`activity-table.tsx`:

```tsx
import Link from "next/link";
import type { AutomationLogListRow } from "@bis/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buttonVariants } from "@/components/ui/button";
import { ListPanel } from "@/components/ui/list-panel";
import { cn } from "@/lib/utils";
import { m } from "@/lib/messages";
import { SOURCE_TITLES, CHANNEL_WORDS } from "@/lib/automations/log-titles";
import { formatCallTime } from "../calls/format";
import { LogStatusPill } from "./log-status-pill";

export const PAGE_SIZE = 25;

const HEAD = "px-4";
const CELL = "px-4 py-3 align-top";

/**
 * Server component: the pager is two links, not client state. Rows are not
 * links — there is no detail page behind a log line — so the whole-row
 * click target rule does not apply; each row is addressed by `data-log-row`.
 */
export function ActivityTable({
  rows, timezone, olderHref, newerHref,
}: {
  rows: AutomationLogListRow[];
  /** The ACCOUNT's zone, already resolved by the page. */
  timezone: string;
  olderHref?: string;
  newerHref?: string;
}) {
  return (
    <div className="space-y-3">
      <ListPanel>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={HEAD}>{m["activity.col.when"]}</TableHead>
              <TableHead className={HEAD}>{m["activity.col.what"]}</TableHead>
              <TableHead className={cn(HEAD, "hidden sm:table-cell")}>{m["activity.col.who"]}</TableHead>
              <TableHead className={cn(HEAD, "hidden sm:table-cell")}>{m["activity.col.channel"]}</TableHead>
              <TableHead className={HEAD}>{m["activity.col.status"]}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id} data-log-row={row.id}>
                <TableCell className={cn(CELL, "whitespace-nowrap font-medium tabular-nums")}>{formatCallTime(row.occurred_at, timezone)}</TableCell>
                <TableCell className={CELL}>{SOURCE_TITLES[row.source]}</TableCell>
                <TableCell className={cn(CELL, "hidden sm:table-cell")}>{row.contact_name ?? "—"}</TableCell>
                <TableCell className={cn(CELL, "hidden sm:table-cell text-muted-foreground")}>{CHANNEL_WORDS[row.channel]}</TableCell>
                <TableCell className={CELL}>
                  <LogStatusPill status={row.status} />
                  {row.status !== "sent" && row.reason ? (
                    <p className="mt-1 text-xs text-muted-foreground" data-log-reason>{row.reason}</p>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ListPanel>
      {olderHref || newerHref ? (
        <nav className="flex justify-end gap-2" aria-label="Pages">
          {newerHref ? <Link href={newerHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{m["activity.newer"]}</Link> : null}
          {olderHref ? <Link href={olderHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>{m["activity.older"]}</Link> : null}
        </nav>
      ) : null}
    </div>
  );
}
```

`usage-card.tsx`:

```tsx
import type { AutomationUsage } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { m } from "@/lib/messages";
import { AUTOMATION_DAILY_CAP } from "@/lib/automations/caps";
import { CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY } from "@/lib/concierge/guards";

export type UsageState = { ok: true; usage: AutomationUsage } | { ok: false };

const LABEL = "font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";

/**
 * Four numbers, each with its period (the month label is the card's
 * description — DESIGN.md rule 1) and the fixed cap it lives under, as
 * context. No hero gradient: text-coloured numbers; the dashboard's KPI is
 * the screen's one gradient moment and this is not that screen.
 */
export function UsageCard({ state, monthLabel, callCap }: { state: UsageState; monthLabel: string; callCap: number }) {
  const tiles = state.ok ? [
    { key: "texts", label: m["activity.usage.texts"], value: state.usage.textsSent, context: m["activity.usage.capRecipe"].replace("{cap}", String(AUTOMATION_DAILY_CAP)) },
    { key: "emails", label: m["activity.usage.emails"], value: state.usage.emailsSent, context: m["activity.usage.capRecipe"].replace("{cap}", String(AUTOMATION_DAILY_CAP)) },
    { key: "conversations", label: m["activity.usage.conversations"], value: state.usage.conversations, context: m["activity.usage.capDay"].replace("{cap}", String(CONCIERGE_MAX_CONVERSATIONS_PER_ACCOUNT_PER_DAY)) },
    { key: "calls", label: m["activity.usage.calls"], value: state.usage.callsHandled, context: m["activity.usage.capDay"].replace("{cap}", String(callCap)) },
  ] : [];
  return (
    <Card data-testid="usage-card">
      <CardHeader>
        <CardTitle>{m["activity.usage.title"]}</CardTitle>
        <CardDescription>{monthLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        {!state.ok ? (
          <p className="text-sm text-muted-foreground" role="alert">{m["activity.usage.error"]}</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {tiles.map((t) => (
                <div key={t.key} data-usage={t.key}>
                  <dt className={LABEL}>{t.label}</dt>
                  <dd className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{t.value}</dd>
                  <dd className="text-xs text-muted-foreground">{t.context}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm text-muted-foreground" data-testid="usage-held">
              {m["activity.usage.held"].replace("{n}", String(state.usage.held))}
              {state.usage.topHeldReason ? ` · ${m["activity.usage.topReason"].replace("{reason}", state.usage.topHeldReason)}` : ""}
            </p>
            <p className="text-sm text-muted-foreground" data-testid="usage-skipped">
              {m["activity.usage.skipped"].replace("{n}", String(state.usage.skipped))}
              {state.usage.topSkippedReason ? ` · ${m["activity.usage.topReason"].replace("{reason}", state.usage.topSkippedReason)}` : ""}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

`page.tsx`:

```tsx
import { Activity } from "lucide-react";
import { listAutomationLog, countAutomationUsage, type AutomationLogListRow, type AutomationUsage } from "@bis/db";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Notice } from "@/components/ui/notice";
import { ZoneNote } from "@/components/zone-note";
import { requireAccountAccess } from "@/lib/auth";
import { dbForRequest } from "@/lib/db";
import { renderZone } from "@/lib/zone";
import { parseCursor, parseTimeCursor, encodeCursor } from "@/lib/cursor";
import { monthWindow } from "@/lib/reports/month-window";
import { m } from "@/lib/messages";
import { readLimitConfig } from "@/lib/voice/call-limits";
import { UsageCard, type UsageState } from "./usage-card";
import { ActivityTable, PAGE_SIZE } from "./activity-table";

export const dynamic = "force-dynamic";

/**
 * BOTH audiences, the Calls page's gate: this is the record of what the
 * system did on the client's behalf — the first place to look when an
 * automation misfires — not agency work about the client. Reads go through
 * the caller's client under RLS (0046 grants authenticated SELECT).
 *
 * Two independent reads, each with its own error state: a usage failure
 * must not cost the client the history, and vice versa.
 */
export default async function ActivityPage({
  params, searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ before?: string }>;
}) {
  const { accountId } = await params;
  const { before } = await searchParams;
  const { isAgency } = await requireAccountAccess(accountId);
  const db = await dbForRequest();

  const account = await db.from("accounts").select("timezone").eq("id", accountId).maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`activity: account lookup failed: ${error.message}`);
      if (!data) throw new Error("activity: account not found");
      return data as { timezone: string };
    });
  const zone = await renderZone(account.timezone);

  // The cursor is TWO validated halves (the contacts list's rule): a
  // timestamp for occurred_at and a uuid for the tiebreaker. Anything else
  // reads as page one, never as an exception on a hand-editable URL.
  const raw = parseCursor(before);
  const cursor = raw && raw.v !== null && parseTimeCursor(raw.v) ? { occurredAt: raw.v, id: raw.id } : undefined;

  const month = monthWindow(new Date(), zone.zone);
  const [usage, history] = await Promise.all([
    countAutomationUsage(db, accountId, month.fromIso, month.toIso)
      .then((u): UsageState => ({ ok: true, usage: u }))
      .catch((e): UsageState => { console.error(`activity ${accountId}: usage read failed: ${String(e)}`); return { ok: false }; }),
    listAutomationLog(db, accountId, { limit: PAGE_SIZE, before: cursor })
      .then((rows) => ({ ok: true as const, rows }))
      .catch((e) => { console.error(`activity ${accountId}: history read failed: ${String(e)}`); return { ok: false as const, rows: [] as AutomationLogListRow[] }; }),
  ]);

  const base = `/dashboard/accounts/${accountId}/activity`;
  const last = history.rows[history.rows.length - 1];
  const olderHref = history.ok && history.rows.length === PAGE_SIZE && last
    ? `${base}?${new URLSearchParams({ before: encodeCursor({ v: last.occurred_at, id: last.id }) })}`
    : undefined;
  const newerHref = cursor ? base : undefined;

  return (
    <>
      <PageHeader title={m["activity.title"]} />
      <div className="space-y-6 p-6">
        <UsageCard state={usage} monthLabel={month.label} callCap={readLimitConfig().perAccountPerDay} />
        <div className="space-y-3">
          <ZoneNote zone={zone} isAgency={isAgency} accountId={accountId} />
          {!history.ok ? (
            <Notice tone="crit" role="alert">{m["activity.error"]}</Notice>
          ) : history.rows.length === 0 && !cursor ? (
            // Cold start: page one and nothing behind it. A cursored zero
            // (older than everything) renders the headers and a Newer link.
            <EmptyState icon={Activity} title={m["activity.empty.title"]} body={m["activity.empty.body"]} />
          ) : (
            <ActivityTable rows={history.rows} timezone={zone.zone} olderHref={olderHref} newerHref={newerHref} />
          )}
        </div>
      </div>
    </>
  );
}
```

`readLimitConfig` is the same import `calls/page.tsx:10` uses. `Notice`'s tones are `good | warn | crit` (`components/ui/notice.tsx:27`): the history error uses `crit`.

- [ ] **Step 5: Tests for the components and the page**

`activity-table.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutomationLogListRow } from "@bis/db";
import { renderedText } from "@/lib/rendered-text";
import { ActivityTable, PAGE_SIZE } from "./activity-table";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

const AT = "2026-09-22T13:05:00.000Z";
const row = (o: Partial<AutomationLogListRow>): AutomationLogListRow => ({
  id: "00000000-0000-4000-8000-000000000001", account_id: "acct_1", source: "sms_reminder", channel: "sms", contact_id: "ct_1",
  subject_key: "booking:1", status: "sent", reason: "", held_until: null, payload: {}, occurred_at: AT, contact_name: "Maria Garcia", ...o,
});
const render = (rows: AutomationLogListRow[], extra = {}) =>
  renderToStaticMarkup(<ActivityTable rows={rows} timezone="America/Chicago" {...extra} />);

describe("ActivityTable", () => {
  it("a row shows the TITLE (never the key), the contact, the channel word, the status word, and the time in the account's zone", () => {
    const html = render([row({})]);
    const text = renderedText(html);
    expect(text).toContain("Text reminders");
    expect(text).not.toContain("sms_reminder");
    expect(text).toContain("Maria Garcia");
    expect(text).toContain("8:05 AM CDT");
    expect(html).toContain('data-status="sent"');
  });

  it("the reason shows for held/skipped/failed and NOT for sent (mutation: drop the status check → FAILS)", () => {
    const skipped = render([row({ status: "skipped", reason: "No phone number we can text" })]);
    expect(renderedText(skipped)).toContain("No phone number we can text");
    const sent = render([row({ status: "sent", reason: "leftover text a sent row must never show" })]);
    expect(renderedText(sent)).not.toContain("leftover text");
    expect(sent).not.toContain("data-log-reason");
  });

  it("a row with no contact shows a dash; an assistant row says Assistant", () => {
    const text = renderedText(render([row({ contact_name: null, source: "voice", channel: "ai" })]));
    expect(text).toContain("Phone assistant");
    expect(text).toContain("Assistant");
  });

  it("the pager renders exactly the links it is given, and none when it is given none", () => {
    expect(render([row({})])).not.toContain("aria-label=\"Pages\"");
    const html = render([row({})], { olderHref: "/a?before=x", newerHref: "/a" });
    expect(html).toContain('href="/a?before=x"');
    expect(html).toContain('href="/a"');
    expect(renderedText(html)).toContain("Older");
    expect(renderedText(html)).toContain("Newer");
  });

  it("PAGE_SIZE is the spec's 25", () => { expect(PAGE_SIZE).toBe(25); });
});
```

`usage-card.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { UsageCard } from "./usage-card";

const usage = { textsSent: 12, emailsSent: 3, conversations: 7, callsHandled: 41, held: 2, skipped: 8, topHeldReason: "Held until 8:00 AM — quiet hours", topSkippedReason: "Screened as a robocall" };

describe("UsageCard", () => {
  it("four numbers, the month label, and the cap beside each (rule 1: never a count alone)", () => {
    const text = renderedText(renderToStaticMarkup(<UsageCard state={{ ok: true, usage }} monthLabel="September 2026" callCap={50} />));
    expect(text).toContain("September 2026");
    for (const n of ["12", "3", "7", "41"]) expect(text).toContain(n);
    expect(text).toContain("Up to 25 a day per automation");
    expect(text).toContain("Up to 300 a day");
    expect(text).toContain("Up to 50 a day");
    expect(text).toContain("2 waiting · most often: Held until 8:00 AM — quiet hours");
    expect(text).toContain("8 skipped · most often: Screened as a robocall");
  });
  it("zero is a number, not a blank; no reason line when there is no reason", () => {
    const text = renderedText(renderToStaticMarkup(<UsageCard state={{ ok: true, usage: { ...usage, held: 0, skipped: 0, topHeldReason: null, topSkippedReason: null } }} monthLabel="September 2026" callCap={50} />));
    expect(text).toContain("0 waiting");
    expect(text).toContain("0 skipped");
    expect(text).not.toContain("most often");
  });
  it("the error state names the fix and still shows the month", () => {
    const text = renderedText(renderToStaticMarkup(<UsageCard state={{ ok: false }} monthLabel="September 2026" callCap={50} />));
    expect(text).toContain("Couldn't load this month's numbers");
    expect(text).toContain("September 2026");
  });
});
```

`page.test.ts` (the automations `page.test.ts` and calls `page.test.ts` are the models):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";
import { encodeCursor } from "@/lib/cursor";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
const authFixture = vi.hoisted(() => ({ isAgency: true }));
vi.mock("@/lib/auth", () => ({ requireAccountAccess: async () => ({ userId: "user_1", isAgency: authFixture.isAgency }) }));
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { timezone: "America/Chicago" }, error: null }) }) }) }) }),
}));
vi.mock("@/lib/zone", () => ({ renderZone: async () => ({ zone: "America/Chicago", label: "Central Time", guessed: false, source: "account" }) }));
vi.mock("@/components/zone-note", () => ({ ZoneNote: () => null }));
const dbMocks = vi.hoisted(() => ({ listAutomationLog: vi.fn(), countAutomationUsage: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

const { default: ActivityPage } = await import("./page");

const USAGE = { textsSent: 1, emailsSent: 0, conversations: 0, callsHandled: 0, held: 0, skipped: 0, topHeldReason: null, topSkippedReason: null };
const ROW = { id: "00000000-0000-4000-8000-00000000000a", account_id: "a1", source: "concierge", channel: "ai", contact_id: null, subject_key: "conversation:1", status: "sent", reason: "", held_until: null, payload: {}, occurred_at: "2026-09-22T13:00:00.000Z", contact_name: null };

async function render(before?: string) {
  return renderToStaticMarkup(await ActivityPage({ params: Promise.resolve({ accountId: "a1" }), searchParams: Promise.resolve({ before }) }));
}

beforeEach(() => {
  dbMocks.listAutomationLog.mockReset().mockResolvedValue([]);
  dbMocks.countAutomationUsage.mockReset().mockResolvedValue(USAGE);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the Activity page", () => {
  it("empty: the usage card AND the designed empty state, no table", async () => {
    const text = renderedText(await render());
    expect(text).toContain("What went out");
    expect(text).toContain("This month");
    expect(text).toContain("Nothing has gone out yet");
    expect(text).not.toContain("Older");
  });

  it("loaded: rows render and a full page gets an Older link carrying the LAST row's cursor (mutation: cursor from rows[0] → FAILS)", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ ...ROW, id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, subject_key: `conversation:${i}` }));
    dbMocks.listAutomationLog.mockResolvedValue(rows);
    const html = await render();
    expect(html).toContain("Website assistant");
    expect(html).toContain(encodeCursor({ v: rows[24]!.occurred_at, id: rows[24]!.id }));
    expect(html).not.toContain(encodeCursor({ v: rows[0]!.occurred_at, id: rows[0]!.id }));
    expect(dbMocks.listAutomationLog).toHaveBeenCalledWith(expect.anything(), "a1", { limit: 25, before: undefined });
  });

  it("a valid cursor is passed through as two validated halves; junk reads as page one (mutation: pass raw `before` → FAILS)", async () => {
    const before = encodeCursor({ v: "2026-09-22T13:00:00.000Z", id: ROW.id });
    await render(before);
    expect(dbMocks.listAutomationLog).toHaveBeenLastCalledWith(expect.anything(), "a1", { limit: 25, before: { occurredAt: "2026-09-22T13:00:00.000Z", id: ROW.id } });
    await render("not-a-cursor");
    expect(dbMocks.listAutomationLog).toHaveBeenLastCalledWith(expect.anything(), "a1", { limit: 25, before: undefined });
    await render(encodeCursor({ v: "yesterday", id: ROW.id }));   // a uuid with a non-timestamp value
    expect(dbMocks.listAutomationLog).toHaveBeenLastCalledWith(expect.anything(), "a1", { limit: 25, before: undefined });
  });

  it("a cursored empty page is NOT the cold-start empty state: headers, a Newer link, no 'Nothing has gone out'", async () => {
    const text = renderedText(await render(encodeCursor({ v: "2026-09-22T13:00:00.000Z", id: ROW.id })));
    expect(text).not.toContain("Nothing has gone out yet");
    expect(text).toContain("Newer");
  });

  it("the two reads fail independently: usage error keeps the history; history error keeps the usage", async () => {
    dbMocks.countAutomationUsage.mockRejectedValue(new Error("down"));
    dbMocks.listAutomationLog.mockResolvedValue([ROW]);
    let text = renderedText(await render());
    expect(text).toContain("Couldn't load this month's numbers");
    expect(text).toContain("Website assistant");
    dbMocks.countAutomationUsage.mockResolvedValue(USAGE);
    dbMocks.listAutomationLog.mockRejectedValue(new Error("down"));
    text = renderedText(await render());
    expect(text).toContain("Couldn't load the history");
    expect(text).toContain("This month");
  });

  it("reads this month in the ACCOUNT's zone, not the machine's (mutation: monthWindow(now, 'UTC') → FAILS in any zone but UTC)", async () => {
    await render();
    const [, , fromIso, toIso] = dbMocks.countAutomationUsage.mock.calls[0]!;
    // Chicago's month edges are 05:00Z or 06:00Z, never 00:00Z.
    expect(String(fromIso)).toMatch(/T0[56]:00:00\.000Z$/);
    expect(String(toIso)).toMatch(/T0[56]:00:00\.000Z$/);
  });
});
```

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/\[accountId\]/activity"` — Expected: PASS.

- [ ] **Step 6: Nav, palette, e2e literal, styleguide**

`nav-groups.ts`: add `"activity"` to `NavIconKey`; in the COMMUNICATIONS group, after the Calls item:

```ts
        // BOTH audiences, like Calls beside it: the record of what the
        // system sent, held and skipped on the client's behalf — the first
        // place to look when an automation misfires (part C, A9).
        { href: `${base}/activity`, labelKey: "nav.activity", iconKey: "activity" },
```

`app-sidebar.tsx`: import `Activity` from `lucide-react`; `NAV_ICONS` gains `activity: Activity,`.

`palette/registry.ts` `NAV_KEYWORDS`: `"/activity": ["history", "what went out", "sent", "waiting", "held", "skipped", "quiet hours", "usage", "log"],`.

`nav-groups.test.ts`: the comms equality becomes `["nav.conversations", "nav.calls", "nav.activity", "nav.voice"]`; add:

```ts
  it("shows Activity to both audiences, directly after Calls (mutation: gate it on isAgency → the client case FAILS)", () => {
    for (const isAgency of [true, false]) {
      const comms = buildNavGroups(BASE, isAgency)[2]!.items.map((i) => i.labelKey);
      expect(comms.indexOf("nav.activity")).toBe(comms.indexOf("nav.calls") + 1);
    }
  });
```

`apps/web/e2e/client-access.spec.ts:92`: the `CLIENT_NAV` literal gains `"Activity"` right after `"Calls"` (the comment above it explains the list; add one line saying Activity joined 2026-09-21, part C).

`styleguide/page.tsx`: find the section that renders `OutcomePill` (grep). Directly after it add:

```tsx
      <section aria-labelledby="sg-activity-status" data-testid="styleguide-activity-status" className="space-y-3">
        <h2 id="sg-activity-status" className="text-sm font-medium">Activity status</h2>
        <div className="flex flex-wrap gap-2">
          {(["sent", "held", "skipped", "failed"] as const).map((s) => <LogStatusPill key={s} status={s} />)}
        </div>
      </section>
```

with `import { LogStatusPill } from "../accounts/[accountId]/activity/log-status-pill";`. If the styleguide has no OutcomePill section, put it after its badges section.

Run: `pnpm --filter web exec vitest run src/lib/nav-groups.test.ts src/lib/palette src/lib/messages.test.ts` — Expected: PASS (`registry.test.ts` derives palette entries from the nav, so Activity is registered by construction).

- [ ] **Step 7: Gate and commit**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test` — Expected: clean. Then `pnpm --filter web build` — Expected: the new route compiles (a page must not export anything Next does not recognise; `PAGE_SIZE` lives in `activity-table.tsx` for that reason).

DoD walk (DESIGN.md) for the bis-design-reviewer, run against a `next start` build with the fixture account: tokens only (grep the four new files for `#`, `rgb(`, `px` radii — none); both themes (the pill's `bg-success`/`bg-primary` classes resolve to tokens in `.dark` — measure `getComputedStyle` of one pill in each theme); the blur fallback (no new blur); loaded/empty/error (the tests above); keyboard (the two pager links are the only controls — focus ring visible); copy (the 7 AM read: "Waiting", "Skipped", "most often"); styleguide (the new section).

```bash
git add apps/web/src/lib/automations/log-titles.ts apps/web/src/lib/automations/log-titles.test.ts apps/web/src/lib/reports/month-window.ts apps/web/src/lib/reports/month-window.test.ts apps/web/src/lib/reports/weekly-window.ts "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/activity" apps/web/src/lib/messages.ts apps/web/src/lib/nav-groups.ts apps/web/src/lib/nav-groups.test.ts apps/web/src/components/app-sidebar.tsx apps/web/src/lib/palette/registry.ts apps/web/e2e/client-access.spec.ts "apps/web/src/app/(dashboard)/dashboard/styleguide/page.tsx"
git commit -m "Activity: 'What went out' — this month's usage in units and the history, for both audiences (#C)"
```

---

### Task 8: The Quiet hours card and its action on the Automations page (bis-automations, worktree E, parallel with Task 7 — consumes Task 7's message keys, so the worktree is cut AFTER Task 7's Step 1 commit lands on the branch, or the keys are cherry-picked)

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/quiet-hours-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations/actions.ts`, `actions.test.ts`, `page.tsx`, `page.test.ts`

**Interfaces:**
- Consumes: `readQuietSettings`, `saveQuietSettings`, `bumpHeldForAccount`, `isClock`, `DEFAULT_QUIET_SETTINGS`, `QuietSettings` (`@bis/db`); `formatClock` (`@/lib/automations/quiet-hours`); the `automations.quiet.*` and `automations.activityLink` keys.
- Produces: `saveQuietHoursAction(accountId, formData): Promise<ActionResult>`; `QuietHoursCard`.

- [ ] **Step 1: The action — tests first**

In `actions.test.ts`: `dbMocks` gains `saveQuietSettings: vi.fn(), bumpHeldForAccount: vi.fn()` (both reset to resolve `undefined` / `0` in `beforeEach`); import `saveQuietHoursAction`. Append:

```ts
describe("saveQuietHoursAction", () => {
  it("refuses a non-agency caller before touching the database", async () => {
    guardFixture.isAgency = false;
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", quiet_start: "22:00", quiet_end: "07:00" })))
      .toEqual({ ok: false, error: m["automations.agencyOnly"] });
    expect(dbMocks.saveQuietSettings).not.toHaveBeenCalled();
  });

  it("saves the window through serviceDb, then bumps every held row so tonight's queue is re-read under the new window (mutation: drop the bump → FAILS)", async () => {
    dbMocks.bumpHeldForAccount.mockResolvedValue(3);
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", quiet_start: "22:30", quiet_end: "06:15" }))).toEqual({ ok: true });
    expect(dbMocks.saveQuietSettings).toHaveBeenCalledWith(expect.anything(), "acct_1", { enabled: true, start: "22:30", end: "06:15" }, "user_1");
    expect(dbMocks.bumpHeldForAccount).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.saveQuietSettings.mock.invocationCallOrder[0]!).toBeLessThan(dbMocks.bumpHeldForAccount.mock.invocationCallOrder[0]!);
  });

  it("an unticked box saves enabled:false with the times kept", async () => {
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_start: "21:00", quiet_end: "08:00" }))).toEqual({ ok: true });
    expect(dbMocks.saveQuietSettings).toHaveBeenCalledWith(expect.anything(), "acct_1", { enabled: false, start: "21:00", end: "08:00" }, "user_1");
  });

  it("a time that is not HH:MM is refused with the copy, and nothing is written (mutation: skip isClock → FAILS)", async () => {
    for (const bad of [{ quiet_start: "9pm", quiet_end: "08:00" }, { quiet_start: "21:00", quiet_end: "" }, { quiet_start: "24:00", quiet_end: "08:00" }]) {
      expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", ...bad })), JSON.stringify(bad))
        .toEqual({ ok: false, error: m["automations.quiet.invalidTime"] });
    }
    expect(dbMocks.saveQuietSettings).not.toHaveBeenCalled();
  });

  it("a failed write is a Result, not a throw, and the bump never runs", async () => {
    dbMocks.saveQuietSettings.mockRejectedValue(new Error("down"));
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", quiet_start: "21:00", quiet_end: "08:00" })))
      .toEqual({ ok: false, error: m["automations.quiet.saveFailed"] });
    expect(dbMocks.bumpHeldForAccount).not.toHaveBeenCalled();
  });

  it("a failed bump still reports success — the save landed; the queue catches up at each row's own held_until", async () => {
    dbMocks.bumpHeldForAccount.mockRejectedValue(new Error("down"));
    expect(await saveQuietHoursAction("acct_1", fd({ quiet_enabled: "on", quiet_start: "21:00", quiet_end: "08:00" }))).toEqual({ ok: true });
  });
});
```

Then in `actions.ts`, add `saveQuietSettings, bumpHeldForAccount, isClock` to the `@bis/db` import and append:

```ts
/**
 * The quiet-hours window (part C). Same guard, same Result shape as the
 * recipe actions above. After the save, every held row of the account is
 * made due now (`bumpHeldForAccount`), so the release pass re-reads tonight's
 * queue under the NEW window on the next tick — turning quiet hours off at
 * 23:00 releases the texts at 23:15, not at 08:00; lengthening the window
 * re-holds them. The bump is best effort: a save that landed is a success.
 */
export async function saveQuietHoursAction(
  accountId: string, formData: FormData,
): Promise<ActionResult> {
  const { userId, isAgency } = await requireAccountAccess(accountId);
  if (!isAgency) return { ok: false, error: m["automations.agencyOnly"] };

  const enabled = formData.get("quiet_enabled") === "on";
  const start = String(formData.get("quiet_start") ?? "").trim();
  const end = String(formData.get("quiet_end") ?? "").trim();
  if (!isClock(start) || !isClock(end)) return { ok: false, error: m["automations.quiet.invalidTime"] };

  const db = serviceDb();
  try {
    await saveQuietSettings(db, accountId, { enabled, start, end }, userId);
  } catch (e) {
    console.error(`saveQuietHoursAction: save failed for account ${accountId}: ${String(e)}`);
    return { ok: false, error: m["automations.quiet.saveFailed"] };
  }
  try {
    const bumped = await bumpHeldForAccount(db, accountId);
    if (bumped > 0) console.error(`saveQuietHoursAction: ${bumped} held send(s) for account ${accountId} re-queued under the new window`);
  } catch (e) {
    console.error(`saveQuietHoursAction: could not re-queue held sends for account ${accountId}: ${String(e)}`);
  }

  revalidatePath(`/dashboard/accounts/${accountId}/automations`);
  return { ok: true };
}
```

Run: `pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/\[accountId\]/automations/actions.test.ts"` — Expected: PASS. Mutations: drop the bump → the second test reds; skip `isClock` → the invalid-time test reds; return `{ ok: false }` on a bump failure → the last test reds.

- [ ] **Step 2: The card**

`quiet-hours-card.tsx`:

```tsx
"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { QuietSettings } from "@bis/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SubmitButton } from "../../submit-button";
import { notifyActionResult } from "@/lib/forms/action-feedback";
import { useFormSubmit } from "@/lib/forms/use-form-submit";
import { formatClock } from "@/lib/automations/quiet-hours";
import { m } from "@/lib/messages";
import type { ActionResult } from "./actions";

/**
 * One window per account, agency-edited (spec §2, decision 4). A form with
 * a Save button, like every recipe card on this page (A11) — a time field
 * that saved on every keystroke would write "21:0" on its way to "21:00".
 * The live preview under the fields restates the window the way a business
 * owner reads it, in the account's own zone, so what is about to be saved is
 * never ambiguous between 24h fields and a 12h reading.
 */
export function QuietHoursCard({
  settings, zoneLabel, saveAction,
}: {
  settings: QuietSettings;
  /** The account's zone as the operator knows it ("America/Chicago"). */
  zoneLabel: string;
  saveAction: (formData: FormData) => Promise<ActionResult>;
}) {
  const [start, setStart] = useState(settings.start);
  const [end, setEnd] = useState(settings.end);
  const { pending, onSubmit } = useFormSubmit(async (formData) => {
    await notifyActionResult(() => saveAction(formData), toast, {
      success: m["automations.quiet.saved"],
      crashed: m["common.actionCrashed"],
    });
  });

  return (
    <Card id="quiet-hours" data-testid="quiet-hours-card" className="scroll-mt-24">
      <CardHeader>
        <CardTitle>{m["automations.quiet.title"]}</CardTitle>
        <CardDescription>{m["automations.quiet.body"]}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-6">
          <div className="flex items-center gap-2">
            <Checkbox id="quiet-enabled" name="quiet_enabled" defaultChecked={settings.enabled} />
            <Label htmlFor="quiet-enabled">{m["automations.quiet.enabled"]}</Label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="quiet-start" className="w-12 text-sm">{m["automations.quiet.from"]}</Label>
            <Input id="quiet-start" name="quiet_start" type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-32" required />
            <Label htmlFor="quiet-end" className="w-12 text-sm">{m["automations.quiet.to"]}</Label>
            <Input id="quiet-end" name="quiet_end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-32" required />
          </div>
          <p className="text-xs text-muted-foreground" data-testid="quiet-hours-preview">
            {formatClock(start)} – {formatClock(end)} · {m["automations.quiet.zone"].replace("{zone}", zoneLabel)}
          </p>

          <SubmitButton pending={pending}>{m["automations.quiet.save"]}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: The page — tests first**

In `page.test.ts`: `dbMock` gains `readQuietSettings: vi.fn()` (resolving `{ enabled: true, start: "22:30", end: "06:15" }` in `beforeEach` — NOT the defaults, so a page that dropped the read and rendered the defaults cannot pass); the `@bis/db` factory mock gains `readQuietSettings: (...a) => dbMock.readQuietSettings(...a)` AND `DEFAULT_QUIET_SETTINGS: { enabled: true, start: "21:00", end: "08:00" }` (a bare factory returns `undefined` for any export it omits, and the page imports that VALUE for its degrade path); `./actions` mock gains `saveQuietHoursAction: async () => ({ ok: true })`; add `vi.mock("./quiet-hours-card", () => ({ QuietHoursCard: (props: Props) => { captured.quiet = props; return null; } }));` and `quiet: null as Props | null` to `captured` (reset in `render()`). Append:

```ts
describe("the Quiet hours card", () => {
  it("receives the STORED window (not the defaults) and the account's zone, and links to Activity (mutation: pass DEFAULT_QUIET_SETTINGS → FAILS)", async () => {
    const { quiet } = await render();
    expect(quiet).toMatchObject({ settings: { enabled: true, start: "22:30", end: "06:15" }, zoneLabel: "America/Chicago" });
    expect(dbMock.readQuietSettings).toHaveBeenCalledWith(expect.anything(), "a1");
  });
  it("the page links to What went out", async () => {
    // `render()` captures props only; render the page's markup once for the link.
    const html = renderToStaticMarkup(await AutomationsPage({ params: Promise.resolve({ accountId: "a1" }) }));
    expect(html).toContain('href="/dashboard/accounts/a1/activity"');
    expect(html).toContain("See what went out");
  });
  it("a failed settings read degrades to the defaults and says so in the log, never a blank page", async () => {
    dbMock.readQuietSettings.mockRejectedValue(new Error("down"));
    const { quiet } = await render();
    expect(quiet).toMatchObject({ settings: { enabled: true, start: "21:00", end: "08:00" } });
  });
});
```

Then in `page.tsx`: import `readQuietSettings, DEFAULT_QUIET_SETTINGS` from `@bis/db`, `Link` from `next/link`, `buttonVariants` from `@/components/ui/button`, `QuietHoursCard` and `saveQuietHoursAction`; add to the `Promise.all` a `quiet` read:

```ts
    // Part C. Cosmetic-degrade like the account read beside it: the card
    // must render (the agency may be here to FIX it), so a failed read shows
    // the defaults and one log line.
    readQuietSettings(db, accountId).catch((e) => {
      console.error(`automations: quiet-hours read failed for ${accountId}: ${String(e)}`);
      return DEFAULT_QUIET_SETTINGS;
    }),
```

(destructure it as `quiet`), pass `actions` to `PageHeader`:

```tsx
      <PageHeader
        title={m["automations.title"]}
        actions={<Link href={`/dashboard/accounts/${accountId}/activity`} className={buttonVariants({ variant: "ghost", size: "sm" })}>{m["automations.activityLink"]}</Link>}
      />
```

and render the card FIRST inside the `max-w-2xl` column:

```tsx
        <QuietHoursCard settings={quiet} zoneLabel={account.timezone} saveAction={saveQuietHoursAction.bind(null, accountId)} />
```

Run the page test — Expected: PASS (existing tests untouched: the card mock returns null).

- [ ] **Step 4: Gate and commit**

Run: `pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web exec vitest run "src/app/(dashboard)/dashboard/accounts/\[accountId\]/automations"` — Expected: clean.

```bash
git add "apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/automations"
git commit -m "Automations: the Quiet hours card — one window, agency-edited, held sends re-queued on save"
```

---

### Task 9: The Playwright pass, the spec's amendments, the roadmap row (bis-e2e-qa; docs by the orchestrator)

**Files:**
- Create: `apps/web/e2e/activity.spec.ts`
- Modify: `docs/superpowers/specs/2026-09-21-automation-engine-c-design.md` (append A9–A11 to the amendments list), `docs/superpowers/specs/2026-07-25-bis-platform-design.md` (§8a's M3 row)

- [ ] **Step 1: The spec, on the per-run fixture account**

`apps/web/e2e/activity.spec.ts`:

```ts
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { serviceDb, setClientAccess, saveQuietSettings, recordAutomationLog, DEFAULT_QUIET_SETTINGS } from "@bis/db";

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
/** A per-run stamp for every string this file writes, so a killed run's row can never satisfy a later run's assertion. */
const STAMP = Date.now().toString();

test.beforeAll(async () => {
  const { accountId, clerkUserId } = fixture();
  // client-access.spec.ts switches access OFF and does not restore it; establish the precondition here.
  await setClientAccess(serviceDb(), accountId, true, clerkUserId);
});

test.describe("quiet hours (agency)", () => {
  test("set a window that is NOT the default, reload, read it back — the round trip through serviceDb and the authenticated-role read", async ({ page }) => {
    const { accountId } = fixture();
    try {
      await page.goto(`/dashboard/accounts/${accountId}/automations`);
      const card = page.getByTestId("quiet-hours-card");
      await expect(card.getByText("Quiet hours", { exact: true })).toBeVisible();
      // 22:30 → 06:15: neither value is a default, so a page that rendered
      // DEFAULT_QUIET_SETTINGS after the save could not pass this.
      await card.getByLabel("From").fill("22:30");
      await card.getByLabel("Until").fill("06:15");
      await expect(card.getByTestId("quiet-hours-preview")).toContainText("10:30 PM – 6:15 AM");
      await card.getByRole("button", { name: "Save quiet hours" }).click();
      await expect(page.getByText("Quiet hours saved")).toBeVisible();

      await page.reload();
      const after = page.getByTestId("quiet-hours-card");
      await expect(after.getByLabel("From")).toHaveValue("22:30");
      await expect(after.getByLabel("Until")).toHaveValue("06:15");
      await expect(after.getByRole("checkbox")).toBeChecked();
      await expect(after).toContainText("Times are in America/Chicago");
    } finally {
      await saveQuietSettings(serviceDb(), accountId, DEFAULT_QUIET_SETTINGS, "e2e-cleanup");
    }
  });

  test("the Automations page links to What went out", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);
    await page.getByRole("link", { name: "See what went out" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/activity$`));
    await expect(page.getByRole("heading", { name: "What went out" })).toBeVisible();
  });
});

test.describe("what went out (client)", () => {
  test.use({ storageState: "e2e/.auth/client-state.json" });

  test("the nav offers Activity; the empty state and this month's card render through RLS", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/dashboard`);
    await page.getByRole("link", { name: "Activity" }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/activity$`));
    await expect(page.getByText("Nothing has gone out yet")).toBeVisible();
    const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "America/Chicago" }).format(new Date());
    await expect(page.getByTestId("usage-card")).toContainText(month);
    await expect(page.getByTestId("usage-card")).toContainText("Texts sent");
  });

  test("a row renders with the recipe's TITLE, the status word and a reason the code could not produce by default", async ({ page }) => {
    const { accountId } = fixture();
    const subjectKey = `e2e:${STAMP}`;
    const reason = `E2E reason ${STAMP}`;
    try {
      // The accessor, under serviceDb — the same write every pass makes.
      await recordAutomationLog(serviceDb(), {
        accountId, source: "sms_reminder", channel: "sms", contactId: null, subjectKey, status: "skipped", reason,
      });
      await page.goto(`/dashboard/accounts/${accountId}/activity`);
      const row = page.locator("[data-log-row]").first();
      await expect(row).toContainText("Text reminders");
      await expect(row).not.toContainText("sms_reminder");
      await expect(row).toContainText("Skipped");
      await expect(row).toContainText(reason);
      await expect(page.getByTestId("usage-skipped")).toContainText(`1 skipped · most often: ${reason}`);
      await expect(page.getByText("Nothing has gone out yet")).toHaveCount(0);
    } finally {
      await serviceDb().from("automation_log").delete().eq("account_id", accountId).eq("subject_key", subjectKey);
    }
  });

  test("a client cannot reach the agency's Quiet hours card", async ({ page }) => {
    const { accountId } = fixture();
    await page.goto(`/dashboard/accounts/${accountId}/automations`);
    await expect(page).toHaveURL(new RegExp(`/dashboard/accounts/${accountId}/dashboard$`));
  });
});
```

The build-path run (`pnpm --filter web build` then `pnpm --filter web test:e2e`) is the gate, and it holds the shared slot. Expected: `activity.spec.ts` 5 passed; the suite's total grows by 5; `client-access.spec.ts` green on the new `CLIENT_NAV` literal. Prescribed mutations, each run as a scoped `playwright test e2e/activity.spec.ts` on the dev path and reverted: (a) in `page.tsx` render `DEFAULT_QUIET_SETTINGS` instead of the read → the first test reds on `toHaveValue("22:30")`; (b) in `activity-table.tsx` render `row.source` instead of `SOURCE_TITLES[row.source]` → the row test reds on both the positive and the `not.toContainText`; (c) in `usage-card.tsx` drop the top-reason suffix → the `usage-skipped` line reds.

- [ ] **Step 2: The spec and the roadmap (orchestrator, on the branch)**

Append to the amendments list in `docs/superpowers/specs/2026-09-21-automation-engine-c-design.md`:

```
8. (plan) The usage and history cards live on a NEW page, `/activity` ("What went out", nav "Activity"), both audiences, because the Automations page is agency-only by construction; the Quiet hours card stays on Automations, which links to Activity.
9. (plan) The agency roll-up does not log (no account); sources are exactly nine.
10. (plan) The Quiet hours card is a form with a Save button, like the recipe cards on its page.
11. (plan) The held row carries a `payload` (the instant reply's release input) and the unique key is `(account_id, source, subject_key)` with status moving IN PLACE — one line per subject, and `skipped`/`failed` rows also collapse to one per subject.
```

and change the header's Status line to `reviewed by danlo 2026-09-21; amendments 1–7 from his read, 8–11 from the plan`.

In `docs/superpowers/specs/2026-07-25-bis-platform-design.md` §8a, the M3 row: replace its status text with "partial — the engine's shared pieces shipped 2026-09-21 (part C, #<PR>): one `automation_log`, one quiet-hours window per account (deferred, never skipped, released by a queue), usage in units and a client-visible history at /activity. Still owed: more recipes (part B, its own spec) and a rule builder, deferred until a second client's needs diverge from the catalogue." Keep the row's shape; update the header's "as of" to the merge date and PR number.

```bash
git add docs/superpowers/specs/2026-09-21-automation-engine-c-design.md docs/superpowers/specs/2026-07-25-bis-platform-design.md apps/web/e2e/activity.spec.ts
git commit -m "e2e: quiet hours round-trip and the Activity page for a client; spec amendments 8–11; §8a M3 row"
```

---

## Self-review

**Spec coverage** (each spec section → task): §1 the record → Task 1 (table, grants, cascade, upsert-in-place), Task 3 (`record` as an isolated leg), Task 6 (the three writers, the release pass), 4a/4b/5 (every pass writes). §2 quiet hours → Task 1 (settings), Task 2 (pure module, DST), Task 3 (`holdOrSend`, `ctx.quiet`), 4a (the reminder exemption, named), 4b (bands stay, compose with the window), 5 (the instant reply), Task 8 (the card, copy amended, the bump on save). §3 usage → Task 1 (`countAutomationUsage`), Task 7 (the card with caps as context and the month label; spam calls as skipped rows via Task 6). §4 history → Task 1 (`listAutomationLog`, keyset on `(occurred_at, id)`), Task 7 (titles, dot+word, reason, one pager, the empty state). §5 testing → every task's test steps; the two amended rows: "a held email reminder released after its window still sends" (4a's "still due sends through the SAME path"), "a window ending at noon still delivers a band-gated recipe at noon" (4b's follow-ups and review-request release tests), "a held SMS reminder whose appointment started is skipped" (4a). The grants/RLS by SQLSTATE and the cascade proof (Task 1). The Playwright pass: set quiet hours + reload + read back with non-default values, the empty history, a row with a title and a non-default reason (Task 9). Nothing in "Out of scope" is built.

**Gaps found and closed while reviewing:** the spec's "Lists" line is replaced by the cascade proof (amendment 2 — Task 1 does not touch `ACCOUNT_OWNED_TABLES`); the agency roll-up cannot log (A10); `PAGE_SIZE` cannot be exported from a page file (it lives in `activity-table.tsx`); `route.test.ts` is shared by 4a and 4b — the plan splits its lines by task and names the expected interim red; Task 8 depends on Task 7's message keys — the worktree is cut after Task 7's Step 1 lands.

**Placeholder scan:** no "TBD/TODO/implement later"; the two "read the file's own helpers" instructions (Task 4b's review-request `TICK`, Task 6's `finish-call.test.ts` builders) point at named files whose fixtures exist and would be wrong to duplicate — the code around them is given in full.

**Type consistency:** `holdOrSend(ctx: HoldContext, s: HoldSubject, send)` everywhere; `Releaser = (ctx: PassContext, row: AutomationLogRow) => Promise<ReleaseVerdict>` in Task 3 and every releaser in 4a/4b/5/6; `DueLookup<T>` `{ due } | { due: null; why }` in Task 3 and every releaser; `recordAutomationLog`'s `AutomationLogWrite` shape identical in Task 1's tests, Task 3's `record`, Task 6's three writers and Task 9's spec; counters: every customer-facing pass has `held`, the release pass `{ examined, sent, held, skipped, failed, errored }` in Task 6's test and `sentinel.test.ts`; `QuietSettings` is structurally the same in `@bis/db` and `quiet-hours.ts`.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-21-automation-engine-c.md`. Execution is subagent-driven per the Process section (danlo's 2026-09-21 rules): Task 1 ∥ Task 2 in worktrees → apply 0046 once → Task 3 → 4a ∥ 4b ∥ 5 → 6 → 7 ∥ 8 → 9, a five-minute brief review before each dispatch, `bis-reviewer` beside each writer, the db suite and Playwright one at a time.
