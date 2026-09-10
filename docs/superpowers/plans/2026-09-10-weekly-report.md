# Weekly Report Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Monday morning, each client receives their own four numbers with week-over-week deltas, and the agency receives one roll-up across every account.

**Architecture:** Two passes on the existing cron harness over one shared `weeklyMetrics` function, so the roll-up and the client email can never disagree about a number. Each pass owns its own due-query, gate, send and stamp, following `siteTrafficPass` — the closest existing precedent.

**Tech Stack:** Next.js App Router, TypeScript, Supabase/PostgREST, vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-10-weekly-report-design.md`
**Branch:** `feat/weekly-report`, base `b37aa9d`.

## Global Constraints

- **Migration number is `0031`.** The latest applied is `0030_contacts_sort_name`. 🔴 Migrations 0001–0030 are ALREADY APPLIED to production — never re-apply one.
- **The controller applies migrations**, via the Supabase MCP `apply_migration`, after a separate pre-flight read. An implementer never applies one.
- **`accounts.name` is the agency's internal label and must never reach a customer.** Use `brandDisplayName(branding)` / the row's `brandName`. It has escaped three times.
- **Run db tests from inside the package:** `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run <filter>`. A root invocation resolves the wrong vitest and drops the package config.
- **Never judge a test run by exit code alone** — a `-t` filter matching nothing exits 0 with everything skipped. Read the reported test NAMES.
- **Every git/pnpm command starts with `cd C:/Users/danlo/bis-platform &&`.** The shell's cwd persists between calls.
- **Commit with `git commit -F <file>`, never `-m`** — a double-quoted message has mangled backticked text in this repo.
- **Branch is `feat/weekly-report`.** Never checkout, rebase, push or touch `main`.
- Gate before claiming green: `pnpm check` (typecheck + lint + db + web). Baseline to beat: **db 249/249, web 1855/1855, exit 0.**

## Verified interfaces (read from source at `b37aa9d` — do not re-derive)

```ts
// apps/web/src/lib/automations/context.ts
type PassContext = { db: SupabaseClient; now: Date; origin: string;
                     email: EmailProvider; sms: () => SmsProvider };
type PassCounters = Record<string, number>;
type Pass = { readonly key: string; run(ctx: PassContext): Promise<PassCounters> };

// apps/web/src/lib/email/types.ts — `to` is ONE address, not a list
type SendEmailInput = { to: string; fromName: string; fromAddress?: string;
                        replyTo?: string; subject: string; body: string; html?: string };
interface EmailProvider { send(input: SendEmailInput): Promise<{ providerMessageId: string }> }

// apps/web/src/lib/email/templates/shell.ts
function shell(brand: EmailBrand, bodyHtml: string): string
function button(brand: EmailBrand, href: string, label: string): string
function escapeHtml(value: string): string
function emailBrandNamed(branding: Branding, name: string): EmailBrand

// packages/db — existing, unchanged
listBookingCreationsBetween(db, accountId, fromIso, toIso): Promise<string[]>  // created_at values
// packages/db/src/voice.ts — returns TIMESTAMPS ONLY, no outcome. Task 2 adds the outcome twin.
listCallStartsBetween(db, accountId, fromIso, toIso): Promise<string[]>

// apps/web/src/lib/booking/stamp-retry.ts
stampWithRetry(stamp: () => Promise<void>): Promise<StampOutcome>
// apps/web/src/lib/forms/guards.ts
isValidEmail(value: string): boolean
```

`resolveAccountZone` lives in `apps/web/src/lib/booking/followup-timing.ts`; `AUTOMATION_TICK_CAP` in `apps/web/src/lib/automations/caps.ts`. Read both before Task 5.

---

## Task 1: Migration 0031 — recipients, stamps, agency zone

**Files:**
- Create: `packages/db/supabase/migrations/0031_weekly_report.sql`
- Test: `packages/db/src/test/weekly-report-grants.test.ts`

**Interfaces:**
- Produces: five columns consumed by every later task.

- [ ] **Step 1: Write the migration**

```sql
-- 0031_weekly_report.sql
-- Weekly report email: who receives it, and the once-per-week stamp.
--
-- `report_emails` is the account-level twin of forms.notify_emails: there is
-- no account-level recipient today, and a form's notify list is a different
-- audience (people who asked about ONE form's leads).
--
-- `weekly_report_week` stores the MONDAY the report was last sent for, not a
-- timestamp. The gate is a local-day question; a date makes "already sent for
-- this week" a single equality with no zone maths at read time.
alter table public.accounts
  add column report_emails text[] not null default '{}',
  add column weekly_report_week date;

-- The agency row has no zone and no address. `report_email` stays NULL: the
-- pass counts skippedNoRecipient so an unset address fails visibly instead of
-- silently doing nothing.
alter table public.agencies
  add column report_email text,
  add column timezone text not null default 'America/Chicago',
  add column weekly_report_week date;

comment on column public.accounts.report_emails is
  'Weekly report recipients. Empty = the account is not due a report at all.';
```

- [ ] **Step 2: Write the failing grants test**

```ts
// packages/db/src/test/weekly-report-grants.test.ts
import "dotenv/config";
import { describe, it, expect } from "vitest";
import { serviceDb } from "../service";

describe("0031 weekly report columns", () => {
  it("accounts carries report_emails defaulting to empty, and a nullable week stamp", async () => {
    const { data, error } = await serviceDb().from("accounts")
      .select("report_emails, weekly_report_week").limit(1);
    expect(error).toBeNull();
    const row = (data ?? [])[0];
    expect(Array.isArray(row?.report_emails)).toBe(true);
  });

  it("agencies carries report_email, timezone and a week stamp", async () => {
    const { data, error } = await serviceDb().from("agencies")
      .select("report_email, timezone, weekly_report_week").limit(1);
    expect(error).toBeNull();
    expect((data ?? [])[0]).toHaveProperty("timezone");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run weekly-report-grants`
Expected: FAIL — PostgREST reports the columns do not exist. Read the test NAMES to confirm both failed for that reason.

- [ ] **Step 4: STOP — the controller applies the migration**

Do not apply it yourself. Hand back to the controller, who does a separate pre-flight read (confirm 0031 is not already registered and the columns do not exist), applies it with the Supabase MCP `apply_migration`, and records it in the ledger as APPLIED — NEVER RE-APPLY.

- [ ] **Step 5: Re-run and watch it pass**

Run: `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run weekly-report-grants`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/danlo/bis-platform && git add packages/db/supabase/migrations/0031_weekly_report.sql packages/db/src/test/weekly-report-grants.test.ts && git commit -F <message file>
```

---

## Task 2: `listCallOutcomesBetween` — the missing data-layer read

**Files:**
- Modify: `packages/db/src/voice.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/test/voice.test.ts`

**Interfaces:**
- Produces: `listCallOutcomesBetween(db, accountId, fromIso, toIso): Promise<string[]>` — every call's `outcome` in the window. Task 4 consumes it for BOTH the calls number and the call half of leads.

**Why this exists:** `listCallStartsBetween` returns `started_at` values only. Nothing in the tree returns outcomes over a date range — `listContactCalls` is per-contact and limit-bounded.

- [ ] **Step 1: Write the failing test**

```ts
// append to packages/db/src/test/voice.test.ts
describe("listCallOutcomesBetween", () => {
  it("returns each call's outcome inside the window and excludes the boundaries correctly", async () =>
    withTestAccount(async (db, accountId) => {
      const mk = async (startedAt: string, outcome: string) => {
        const { error } = await db.from("calls").insert({
          account_id: accountId, started_at: startedAt, outcome,
        });
        if (error) throw new Error(error.message);
      };
      await mk("2026-03-02T10:00:00Z", "booked");
      await mk("2026-03-03T10:00:00Z", "spam");
      await mk("2026-03-04T10:00:00Z", "lead");
      await mk("2026-03-09T10:00:00Z", "message"); // outside, on the `lt` bound

      const got = await listCallOutcomesBetween(
        db, accountId, "2026-03-02T00:00:00Z", "2026-03-09T00:00:00Z");
      expect(got.sort()).toEqual(["booked", "lead", "spam"]);
    }));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run voice`
Expected: FAIL — `listCallOutcomesBetween is not a function`. Confirm the reported NAME is the test above.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/voice.ts — beside listCallStartsBetween
/**
 * Every call's OUTCOME in a window. The twin of `listCallStartsBetween`,
 * which returns `started_at` only and so cannot answer "how many were
 * answered". Half-open [from, to) exactly like its twin, so the two agree
 * about which calls belong to a week.
 */
export async function listCallOutcomesBetween(
  db: SupabaseClient, accountId: string, fromIso: string, toIso: string,
): Promise<string[]> {
  const { data, error } = await db.from("calls")
    .select("outcome")
    .eq("account_id", accountId).gte("started_at", fromIso).lt("started_at", toIso);
  if (error) throw new Error(`listCallOutcomesBetween failed: ${error.message}`);
  return (data ?? []).map((r: { outcome: string }) => r.outcome);
}
```

Export it from `packages/db/src/index.ts` on the existing `./voice` export line.

- [ ] **Step 4: Run it and watch it pass**

Run: `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run voice`
Expected: PASS. The whole `voice` suite must stay green, not just the new test.

- [ ] **Step 5: Mutation-check the window bound**

Change `.lt("started_at", toIso)` to `.lte(...)`. Re-run: the test must FAIL because the 03-09 call is now included. Report the failing test name, then restore.

- [ ] **Step 6: Commit**

---

## Task 3: `listAccountsDueWeeklyReport` — the due query

**Files:**
- Create: `packages/db/src/weekly-report.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/test/weekly-report.test.ts`

**Interfaces:**
- Consumes: the 0031 columns (Task 1).
- Produces:

```ts
export type AccountDueWeeklyReport = {
  accountId: string;
  createdAt: string;            // the no-prior-week delta rule reads this
  reportEmails: string[];
  accountTimezone: string;
  brandName: string;
  branding: Branding;
  replyToEmail: string | null;
  lastSentWeek: string | null;  // accounts.weekly_report_week
  hasSite: boolean;             // a linked site exists → the website line is allowed
};
export async function listAccountsDueWeeklyReport(
  db: SupabaseClient,
): Promise<AccountDueWeeklyReport[]>;
export async function stampWeeklyReportSent(
  db: SupabaseClient, accountId: string, week: string,
): Promise<void>;
```

Shape it on `DueReviewRequest` (`packages/db/src/automations.ts:173`), which carries `brandName`, `branding` and `accountTimezone` for exactly this reason — the pass must never reach for `accounts.name`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/db/src/test/weekly-report.test.ts
describe("listAccountsDueWeeklyReport", () => {
  it("an account with no report_emails is not a row at all", async () =>
    withTestAccount(async (db, accountId) => {
      const rows = await listAccountsDueWeeklyReport(db);
      expect(rows.some((r) => r.accountId === accountId)).toBe(false);
    }));

  it("an account with recipients is returned, with its zone, brand name and site flag", async () =>
    withTestAccount(async (db, accountId) => {
      const { error } = await db.from("accounts")
        .update({ report_emails: ["owner@example.com"] }).eq("id", accountId);
      if (error) throw new Error(error.message);

      const row = (await listAccountsDueWeeklyReport(db))
        .find((r) => r.accountId === accountId);
      expect(row).toBeDefined();
      expect(row!.reportEmails).toEqual(["owner@example.com"]);
      expect(row!.accountTimezone).toBeTruthy();
      expect(row!.brandName).toBeTruthy();
      expect(row!.hasSite).toBe(false);
      expect(row!.lastSentWeek).toBeNull();
    }));

  it("stampWeeklyReportSent records the week and the row reports it next time", async () =>
    withTestAccount(async (db, accountId) => {
      await db.from("accounts").update({ report_emails: ["a@b.co"] }).eq("id", accountId);
      await stampWeeklyReportSent(db, accountId, "2026-03-02");
      const row = (await listAccountsDueWeeklyReport(db))
        .find((r) => r.accountId === accountId);
      expect(row!.lastSentWeek).toBe("2026-03-02");
    }));
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd C:/Users/danlo/bis-platform/packages/db && npx vitest run weekly-report`
Expected: FAIL — module not found. Confirm the three NAMES are the ones above.

- [ ] **Step 3: Implement**

Select the account columns plus the branding columns `getBranding` uses (read `packages/db/src/branding.ts:156` for the exact list — do not guess) and `report_emails, weekly_report_week, timezone, created_at`. Filter server-side so an account with an empty array never crosses the wire: PostgREST expresses "array is not empty" as `.not("report_emails", "eq", "{}")`. Derive `hasSite` from a single `sites` select of `account_id`, not a per-row query. Build `brandName` with the same resolver `listDueReviewRequests` uses.

- [ ] **Step 4: Run and watch them pass** — 3 tests.

- [ ] **Step 5: Mutation-check the empty-recipients filter**

Remove the `.not("report_emails", "eq", "{}")` filter. Re-run: the first test must FAIL because the account now appears. Report the name, restore.

- [ ] **Step 6: Export from `index.ts` and commit**

---

## Task 4: `weeklyMetrics` — the four numbers, once

**Files:**
- Create: `apps/web/src/lib/reports/weekly-metrics.ts`
- Test: `apps/web/src/lib/reports/weekly-metrics.test.ts`

**Interfaces:**
- Consumes: `listCallOutcomesBetween` (Task 2), `listBookingCreationsBetween`, and the traffic + submissions reads named below.
- Produces:

```ts
export type WeeklyWindow = { fromIso: string; toIso: string };
export type WeeklyNumbers = {
  calls: number; leads: number; bookings: number;
  /** null = NOT MEASURED (no linked site). Never 0 for an unmeasured account. */
  visitors: number | null;
};
export async function weeklyMetrics(
  db: SupabaseClient, accountId: string, window: WeeklyWindow, hasSite: boolean,
): Promise<WeeklyNumbers>;
```

**Definitions — these are the spec's, do not soften them:**
- `calls` = outcomes in `("booked","lead","message")`. Spam flatters; abandoned overstates.
- `leads` = form submissions with `spam_reason IS NULL` **plus** calls with `outcome === "lead"`.
- `bookings` = `listBookingCreationsBetween(...).length`.
- `visitors` = summed `site_traffic_daily.visitors`, or **`null` when `hasSite` is false**.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/reports/weekly-metrics.test.ts
import { describe, expect, it, vi } from "vitest";
import { countFromOutcomes, LEAD_OUTCOME, ANSWERED_OUTCOMES } from "./weekly-metrics";

describe("weekly metric definitions", () => {
  it("counts booked, lead and message as answered — never spam or abandoned", () => {
    expect(countFromOutcomes(
      ["booked", "lead", "message", "abandoned", "spam"], ANSWERED_OUTCOMES)).toBe(3);
  });

  it("counts only lead outcomes toward leads", () => {
    expect(countFromOutcomes(
      ["booked", "lead", "lead", "spam"], LEAD_OUTCOME)).toBe(2);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd C:/Users/danlo/bis-platform/apps/web && npx vitest run src/lib/reports/weekly-metrics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Export `ANSWERED_OUTCOMES = ["booked","lead","message"] as const`, `LEAD_OUTCOME = ["lead"] as const`, a pure `countFromOutcomes(outcomes: string[], wanted: readonly string[]): number`, and the async `weeklyMetrics` that composes the four reads. The pure helper is what the test above pins; the async function is covered by Task 5's pass tests and the real-db reads it calls.

For submissions, read `packages/db/src/forms.ts` for the existing `spam_reason IS NULL` filter shape (it appears at line 87) and follow it rather than writing a new predicate.

- [ ] **Step 4: Run and watch them pass** — 2 tests.

- [ ] **Step 5: Commit**

---

## Task 5: The week window and the Monday gate

**Files:**
- Create: `apps/web/src/lib/reports/weekly-window.ts`
- Test: `apps/web/src/lib/reports/weekly-window.test.ts`

**Interfaces:**
- Produces:

```ts
/** The Monday (as `YYYY-MM-DD` in `zone`) that `now` belongs to the week AFTER. */
export function lastWeekMonday(now: Date, zone: string): string;
export function weekWindow(monday: string, zone: string): WeeklyWindow;
/** Monday 08:00–11:00 in `zone`. */
export function inMondayBand(now: Date, zone: string): boolean;
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/reports/weekly-window.test.ts
import { describe, expect, it } from "vitest";
import { inMondayBand, lastWeekMonday } from "./weekly-window";

describe("the Monday band", () => {
  // ONE instant, TWO zones, OPPOSITE verdicts. A fixture zone equal to the
  // dev machine's cannot discriminate — this is a recorded lesson here.
  it("is Monday morning in Chicago and still Sunday night in Honolulu", () => {
    const instant = new Date("2026-03-02T15:00:00Z"); // 09:00 CST / 05:00 HST
    expect(inMondayBand(instant, "America/Chicago")).toBe(true);
    expect(inMondayBand(instant, "Pacific/Honolulu")).toBe(false);
  });

  it("refuses Monday outside the band and refuses other days inside it", () => {
    expect(inMondayBand(new Date("2026-03-02T13:00:00Z"), "America/Chicago")).toBe(false); // 07:00
    expect(inMondayBand(new Date("2026-03-02T18:00:00Z"), "America/Chicago")).toBe(false); // 12:00
    expect(inMondayBand(new Date("2026-03-03T15:00:00Z"), "America/Chicago")).toBe(false); // Tuesday
  });

  it("names the week that just ended, not the one starting", () => {
    expect(lastWeekMonday(new Date("2026-03-02T15:00:00Z"), "America/Chicago"))
      .toBe("2026-02-23");
  });

  // The window is seven LOCAL days, not 168 hours. US DST begins 2026-03-08.
  it("spans a DST transition without losing or gaining a day", () => {
    expect(lastWeekMonday(new Date("2026-03-09T14:00:00Z"), "America/Chicago"))
      .toBe("2026-03-02");
  });
});
```

- [ ] **Step 2: Run and watch them fail** — module not found; confirm all four NAMES.

- [ ] **Step 3: Implement**

Use `Intl.DateTimeFormat` with `timeZone` to read the local weekday/hour, following the pattern already used in `apps/web/src/lib/booking/` (read `followup-timing.ts` first). Recorded gotcha in this codebase: call `Intl.DateTimeFormat` **without** `new` where a test may spy it. Do not use `Date.UTC` to anchor a local day — it anchors UTC midnight and renders the previous day in the Americas.

- [ ] **Step 4: Run and watch them pass** — 4 tests.

- [ ] **Step 5: Mutation-check the zone**

Hard-code the zone to the system zone, ignoring the `zone` argument. Re-run: the Chicago/Honolulu test must FAIL. Report the name, restore.

- [ ] **Step 6: Commit**

---

## Task 6: The email templates

**Files:**
- Create: `apps/web/src/lib/email/templates/weekly-report.ts`
- Test: `apps/web/src/lib/email/templates/weekly-report.test.ts`

**Interfaces:**
- Consumes: `shell`, `button`, `escapeHtml`, `EmailBrand` from `./shell`; `WeeklyNumbers` from Task 4.
- Produces:

```ts
export type WeeklyReportInput = {
  brand: EmailBrand;
  now: WeeklyNumbers;
  /** null = no honest comparison exists (the prior window predates the account). */
  prior: WeeklyNumbers | null;
  dashboardUrl: string | null;
  /** Only true when the account genuinely has these on. */
  reassurance: { receptionist: boolean; textBack: boolean };
};
export function weeklyReportEmail(input: WeeklyReportInput): { html: string; text: string };
export function deltaPhrase(now: number, prior: number | null): string;
```

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/email/templates/weekly-report.test.ts
import { describe, expect, it } from "vitest";
import { weeklyReportEmail, deltaPhrase } from "./weekly-report";

const brand = { name: "Rio Roofing", color: "#6D28D9", logoUrl: null } as never;

describe("deltaPhrase", () => {
  it("says more, fewer, or same in words — never an arrow", () => {
    expect(deltaPhrase(12, 9)).toBe("3 more than the week before");
    expect(deltaPhrase(2, 3)).toBe("1 fewer than the week before");
    expect(deltaPhrase(4, 4)).toBe("same as the week before");
  });

  it("is EMPTY when there is no prior week — a delta would be fabricated", () => {
    expect(deltaPhrase(12, null)).toBe("");
  });
});

describe("weeklyReportEmail", () => {
  const now = { calls: 12, leads: 4, bookings: 2, visitors: 86 };

  it("omits the website line entirely when visitors were not measured", () => {
    const { html, text } = weeklyReportEmail({
      brand, now: { ...now, visitors: null }, prior: null,
      dashboardUrl: null, reassurance: { receptionist: false, textBack: false },
    });
    expect(html).not.toContain("visitors");
    expect(text).not.toContain("visitors");
  });

  it("renders a quiet week as its own message, not four zero rows", () => {
    const { text } = weeklyReportEmail({
      brand, now: { calls: 0, leads: 0, bookings: 0, visitors: null }, prior: null,
      dashboardUrl: null, reassurance: { receptionist: true, textBack: true },
    });
    expect(text).toContain("Nothing came in last week");
    expect(text).not.toMatch(/\b0 calls answered\b/);
  });

  it("claims the receptionist only when the account actually has one", () => {
    const quiet = { calls: 0, leads: 0, bookings: 0, visitors: null };
    const off = weeklyReportEmail({
      brand, now: quiet, prior: null, dashboardUrl: null,
      reassurance: { receptionist: false, textBack: false },
    });
    expect(off.text).not.toMatch(/still answering/i);
  });

  it("escapes the brand name — it reaches an inbox", () => {
    const { html } = weeklyReportEmail({
      brand: { ...(brand as object), name: 'Rio "Best" <Roofing>' } as never,
      now, prior: null, dashboardUrl: null,
      reassurance: { receptionist: false, textBack: false },
    });
    expect(html).not.toContain("<Roofing>");
  });
});
```

- [ ] **Step 2: Run and watch them fail** — module not found; confirm the six NAMES.

- [ ] **Step 3: Implement**

Both an `html` and a `text` part — never html alone (see `SendEmailInput.html`'s comment: the text alternative is what keeps a branded message out of the spam bucket). Copy is verbatim from the spec's "The emails" section.

- [ ] **Step 4: Run and watch them pass** — 6 tests.

- [ ] **Step 5: Mutation-check the no-prior-week rule**

Make `deltaPhrase(now, null)` return `"${now} more than the week before"`. Re-run: the "EMPTY when there is no prior week" test must FAIL. Report the name, restore.

- [ ] **Step 6: Commit**

---

## Task 7: `weeklyClientReportPass`

**Files:**
- Create: `apps/web/src/lib/automations/passes/weekly-report.ts`
- Modify: `apps/web/src/lib/automations/registry.ts`
- Test: `apps/web/src/lib/automations/passes/weekly-report.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6.
- Produces: `export const weeklyClientReportPass: Pass` with key `"weeklyClientReport"`.

**Counters, exactly:** `{ sent, failed, skippedNotMonday, skippedAlreadySent, skippedCap, unresolvableTimezone, unstamped }`.

**Order of decisions per account, each refusal under its own name:** unresolvable zone → not in the Monday band → already stamped for this week → tick cap → compute → send per recipient → stamp.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/automations/passes/weekly-report.test.ts
// Mirror the mocking style of no-show-nudge.test.ts in this directory — read it
// first and follow it rather than inventing a second harness-mocking pattern.
describe("weeklyClientReportPass", () => {
  it("sends one message PER RECIPIENT, not one with a joined to-field", async () => {
    // two recipients → provider.send called twice, each with a single address
  });

  it("a failing recipient does not stop the others, and is counted", async () => {
    // first address rejects; second still receives; counters: sent 1, failed 1
  });

  it("stamps when at least one recipient succeeded", async () => {
    // partial failure still stamps — not stamping would re-send to the address
    // that already received it
  });

  it("does NOT stamp when every recipient failed", async () => {
    // so it retries inside the same morning band
  });

  it("skips an account already stamped for this week", async () => {});

  it("fails closed on an unresolvable timezone", async () => {
    // counters: unresolvableTimezone 1, sent 0
  });
});
```

Fill each body following the sibling test file's mocking conventions.

- [ ] **Step 2: Run and watch them fail** — confirm all six NAMES.

- [ ] **Step 3: Implement, then register**

Send loop follows the lead alert (`apps/web/src/app/f/[publicId]/actions.ts` around line 565): each recipient independently, failures collected rather than thrown out of the loop — a comment there records the bug where one bad address silently cost every later recipient. Add `weeklyClientReportPass` to `PASSES` in `registry.ts`.

- [ ] **Step 4: Run and watch them pass** — 6 tests.

- [ ] **Step 5: Mutation-check the stamp**

Delete the stamp call. Re-run: "skips an account already stamped for this week" must FAIL. Report the name, restore. Then delete the Monday-band check: a not-Monday test must FAIL. Restore.

- [ ] **Step 6: Commit**

---

## Task 8: `weeklyAgencyReportPass` and the roll-up template

**Files:**
- Create: `apps/web/src/lib/email/templates/agency-rollup.ts`
- Create: `apps/web/src/lib/automations/passes/weekly-agency-report.ts`
- Modify: `apps/web/src/lib/automations/registry.ts`
- Modify: `packages/db/src/weekly-report.ts` (add the agency read/stamp)
- Test: `apps/web/src/lib/email/templates/agency-rollup.test.ts`, `apps/web/src/lib/automations/passes/weekly-agency-report.test.ts`

**Interfaces:**
- Produces: `agencyRollupEmail`, `weeklyAgencyReportPass` (key `"weeklyAgencyReport"`), and in the db package:

```ts
export type AgencyReportTarget = {
  agencyId: string; reportEmail: string | null;
  timezone: string; lastSentWeek: string | null;
};
export async function getAgencyReportTarget(db: SupabaseClient): Promise<AgencyReportTarget | null>;
export async function stampAgencyReportSent(db: SupabaseClient, agencyId: string, week: string): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

```ts
// agency-rollup.test.ts
it("lists every account, including ones with no recipients", () => {
  const { text } = agencyRollupEmail({ rows: [
    { brandName: "Rio Roofing", numbers: { calls: 12, leads: 4, bookings: 2, visitors: 86 },
      prior: null, hasRecipients: true },
    { brandName: "Valley Air", numbers: { calls: 0, leads: 0, bookings: 0, visitors: null },
      prior: null, hasRecipients: false },
  ] } as never);
  expect(text).toContain("Rio Roofing");
  expect(text).toContain("Valley Air");
});

it("marks an account nobody is receiving, so silence is visible", () => {
  // the Valley Air row carries a "no recipients" marker
});

it("never prints the internal account label", () => {
  // brandName only — accounts.name must not appear in the input type at all
});
```

```ts
// weekly-agency-report.test.ts
it("counts skippedNoRecipient when agencies.report_email is unset", async () => {});
it("computes each account's week in that account's own zone", async () => {});
it("skips when already stamped for this week", async () => {});
```

- [ ] **Step 2: Run and watch them fail** — confirm all six NAMES.

- [ ] **Step 3: Implement and register.**

- [ ] **Step 4: Run and watch them pass** — 6 tests.

- [ ] **Step 5: Mutation-check the per-account zone**

Compute every account's window in the AGENCY's zone instead of its own. Re-run: "computes each account's week in that account's own zone" must FAIL. Report the name, restore.

- [ ] **Step 6: Commit**

---

## Task 9: The Settings card, and closing the notify-email minor

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/weekly-report-card.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/actions.ts`
- Modify: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/forms/actions.ts`
- Modify: `apps/web/src/lib/messages.ts`
- Test: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/settings/weekly-report-card.test.ts`
- Test: `apps/web/e2e/weekly-report.spec.ts`

**Interfaces:**
- Produces: `saveReportEmailsAction(accountId, formData) => { ok: true } | { ok: false; error: string }`.

Model the card on `sending-address-card.tsx` in the same directory — read it first. Use `useFormSubmit` from `@/lib/forms/use-form-submit`, never a bare `<form action>`: React resets an action form even when the action FAILED, which silently discards what the operator typed.

**The parked minor:** apply `isValidEmail` (from `@/lib/forms/guards`) to BOTH the new `report_emails` input and the existing forms `notifyEmails` input, which has never validated. The booking milestone recorded this as "close BOTH later".

- [ ] **Step 1: Add copy keys**

```ts
"settings.weeklyReport": "Weekly report",
"settings.weeklyReportHint": "Who gets Monday's numbers. Separate addresses with commas.",
"settings.weeklyReportSaved": "Saved. The next report goes out Monday morning.",
"settings.weeklyReportBadEmail": "That doesn't look like an email address: {value}",
"settings.weeklyReportOff": "Nobody is receiving this yet.",
```

- [ ] **Step 2: Write the failing tests**

```ts
// weekly-report-card.test.ts — source-text, the house pattern (no component harness)
const card = readFileSync(path.join(here, "weekly-report-card.tsx"), "utf8");
const actions = readFileSync(path.join(here, "actions.ts"), "utf8");

it("uses useFormSubmit, never a bare form action", () => {
  expect(card).toContain("useFormSubmit");
  expect(card).not.toMatch(/<form\s+action=/);
});

it("validates every address before saving", () => {
  expect(actions).toContain("isValidEmail");
});
```

```ts
// apps/web/e2e/weekly-report.spec.ts
it("saves report recipients and shows them after a reload", async ({ page }) => {
  // fixture account; fill the field, save, reload, assert the value persisted
});
it("refuses a malformed address without saving", async ({ page }) => {});
```

- [ ] **Step 3: Run and watch them fail.**

- [ ] **Step 4: Implement the card, the action, and the forms-side validation.**

- [ ] **Step 5: Run and watch them pass.**

Run the e2e: `cd C:/Users/danlo/bis-platform && pnpm --filter web test:e2e weekly-report.spec.ts`
Port 3000 must be free — the build path refuses to adopt an existing server by design.

- [ ] **Step 6: Commit**

---

## Task 10: Gate, set the agency address, open the PR

- [ ] **Step 1: Run the whole suite, unpiped**

```bash
cd C:/Users/danlo/bis-platform && { pnpm typecheck; echo "T=$?"; pnpm lint; echo "L=$?"; pnpm --filter @bis/db test; echo "D=$?"; pnpm --filter web test; echo "W=$?"; } > <scratch>/gate.log 2>&1; grep -E "^[TLDW]=|Tests " <scratch>/gate.log
```

Expected `T=0 L=0 D=0 W=0`. **Never** `pnpm check | tail` — the pipe reports `tail`'s exit code and has hidden a real failure in this repo.

- [ ] **Step 2: Build** — `pnpm --filter web build`, expect exit 0. `check` does not run the build, and this milestone adds a client component.

- [ ] **Step 3: Full e2e** — `pnpm --filter web test:e2e`. Baseline: 81 passed.

- [ ] **Step 4: Set the agency address**

Controller only, after danlo confirms the address: one `UPDATE public.agencies set report_email = '<address>'`. Do a separate read first; never re-run a mutating statement for its output.

- [ ] **Step 5: Update DESIGN.md** — add the weekly report to the key patterns: who receives it, that a missing website line is an omission and never a zero, and that deltas are words rather than arrows.

- [ ] **Step 6: Push and open the PR**

Body states: the two spec corrections found during planning (`listCallStartsBetween` carries no outcome; `to` is one address so sending is per-recipient), the empty `users`/`memberships` finding, the counters each pass reports, and the gate numbers. Merge only when `verify` AND `e2e` are green on the PR's current head.

---

## Self-review

**Spec coverage.** Audience both → Tasks 7, 8. Account-level recipients → Tasks 1, 3, 9. Four numbers with deltas → Tasks 2, 4, 6. Quiet week → Task 6. Website omitted not zeroed → Tasks 4, 6. No prior week → Tasks 4, 6. Monday band + fail-closed zone → Task 5. Send-then-stamp, partial-failure rule → Task 7. Roll-up per-account zones → Task 8. Agency address nullable + visible skip → Tasks 1, 8, 10. Settings card + notify minor → Task 9. Migration 0031 → Task 1. Out-of-scope items appear in no task, as intended.

**Placeholder scan.** Task 7 and Task 8's test bodies are described rather than written out, because both depend on the sibling mocking conventions in their own directories (`no-show-nudge.test.ts`) — the names, counters and assertions are exact and the step says which file to copy the style from. Every other code step carries complete code.

**Type consistency.** `WeeklyNumbers` (Task 4) is consumed unchanged by Tasks 6, 7, 8. `WeeklyWindow` is produced by Task 5 and consumed by Task 4. `visitors: number | null` is null-for-unmeasured in every consumer. `AccountDueWeeklyReport.lastSentWeek` and `stampWeeklyReportSent(week)` are both `YYYY-MM-DD` strings, matching the `date` column in Task 1. Counter names in Task 7 match the spec's list exactly.
