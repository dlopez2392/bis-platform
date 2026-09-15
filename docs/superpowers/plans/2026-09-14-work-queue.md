# Work Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a screen that answers "what should I do now?" — open tasks, unreturned calls, unanswered conversations and past bookings nobody closed out — per account and across the agency.

**Architecture:** Four indexed reads in a new `packages/db/src/work-queue.ts`, unioned into one row shape; a pure bucketing function in `apps/web/src/lib/work/buckets.ts` that does all date arithmetic in the account's zone; two server-rendered pages and one compact dashboard row that consume them. Derived rows carry no state — they stop matching when their condition clears, or when a "Not now" task suppresses them.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase via `dbForRequest()`/`serviceDb()`, vitest, Playwright.

Spec: `docs/superpowers/specs/2026-09-14-work-queue-design.md`.

> ⚠️ **Task 1 below is SUPERSEDED and already built.** Its `call` source was
> withdrawn during review as unsatisfiable (spec §1.2). The shipped design has
> THREE sources — task, conversation, booking — and the conversation row
> carries the latest call summary as its title. Read `packages/db/src/work-queue.ts`
> for what actually exists; do not re-derive from Task 1's code blocks.

## Global Constraints

- **NO MIGRATION.** Every column already ships. Needing a schema change means the design drifted — stop and report, do not add one.
- **Account timezone, always** — `accounts.timezone`. Never the server's, never the browser's.
- **`brand_name`, never `accounts.name`** on any row label. The internal label has leaked to customers three times.
- All copy goes through `apps/web/src/lib/messages.ts` under the `work.` namespace, and passes the landscaper-at-7am read. No milestone codes, no `{{syntax}}`, no arrows for deltas.
- `/dashboard/work` is **agency only** — `requireAgency`. A client must never reach it.
- `withTestAccount` takes **ONLY a callback** and supplies the client: `withTestAccount(async (db, accountId) => { … })`. A previous plan in this repo had this wrong in all eight of its test blocks.
- In `packages/db`, judge a test run by **vitest's own summary block**, never the shell exit code — the package prints `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL "Command vitest not found"` after real results.
- **Never run two gates at once** on this machine. `pnpm check`, `pnpm --filter web build` and `pnpm --filter web test:e2e` run one at a time.
- Mutating e2e runs on the per-run `E2E Client Co` fixture. `Test Client One` is read-only.

---

### Task 1: The four source queries

**Files:**
- Create: `packages/db/src/work-queue.ts`
- Modify: `packages/db/src/index.ts:15` (barrel — add the new exports on their own line, touch nobody else's)
- Test: `packages/db/src/test/work-queue.test.ts`

**Interfaces:**
- Consumes: `serviceDb()` from `./service`; the test harness `withTestAccount(fn)` from `./test/fixtures`.
- Produces:
  ```ts
  export type WorkSource = "task" | "call" | "conversation" | "booking";
  export type WorkRow = {
    id: string;            // `${source}:${uuid}` — stable synthetic key
    source: WorkSource;
    accountId: string;
    contactId: string | null;
    title: string;         // raw material; the UI supplies final copy
    dueAt: string | null;  // tasks only; null for every derived row
    occurredAt: string;    // when the underlying thing happened
  };
  export async function listAccountWork(db: SupabaseClient, accountId: string): Promise<WorkRow[]>;
  export async function listAgencyWork(db: SupabaseClient): Promise<(WorkRow & { brandName: string })[]>;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/test/work-queue.test.ts
import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { listAccountWork } from "../work-queue";
import { addTask } from "../activities";

describe("listAccountWork", () => {
  it("returns an open task and omits a completed one", async () => {
    await withTestAccount(async (db, accountId) => {
      const open = await addTask(db, accountId, { title: "Call Maria back" }, "user_test");
      const done = await addTask(db, accountId, { title: "Already handled" }, "user_test");
      await db.from("tasks").update({ completed_at: new Date().toISOString() })
        .eq("id", done.id);

      const rows = await listAccountWork(db, accountId);
      const ids = rows.map((r) => r.id);
      expect(ids).toContain(`task:${open.id}`);
      expect(ids).not.toContain(`task:${done.id}`);
    });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @bis/db exec vitest run src/test/work-queue.test.ts`
Expected: FAIL — `Cannot find module '../work-queue'`. Paste the failing line into the report.

- [ ] **Step 3: Implement the four sources**

```ts
// packages/db/src/work-queue.ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type WorkSource = "task" | "call" | "conversation" | "booking";

export type WorkRow = {
  id: string;
  source: WorkSource;
  accountId: string;
  contactId: string | null;
  title: string;
  dueAt: string | null;
  occurredAt: string;
};

/** Calls that need returning. `booked` and `spam` need nothing; `abandoned` is
 *  DELIBERATELY excluded (spec §1.2) — a hang-up is usually a wrong number,
 *  and flooding the queue is how a queue loses its reader. Widening this is a
 *  product decision, not a fix. */
const NEEDS_RETURN = ["lead", "message"] as const;

async function openTasks(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  // Uses the partial index tasks_account_open (account_id) where completed_at is null.
  const { data, error } = await db.from("tasks")
    .select("id, contact_id, title, due_at, created_at")
    .eq("account_id", accountId).is("completed_at", null);
  if (error) throw new Error(`openTasks failed: ${error.message}`);
  return (data ?? []).map((t) => ({
    id: `task:${t.id}`, source: "task" as const, accountId,
    contactId: t.contact_id, title: t.title,
    dueAt: t.due_at, occurredAt: t.created_at,
  }));
}

async function unreturnedCalls(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  const { data, error } = await db.from("calls")
    .select("id, contact_id, started_at, summary")
    .eq("account_id", accountId).in("outcome", NEEDS_RETURN as unknown as string[])
    .not("contact_id", "is", null)
    .order("started_at", { ascending: true }).limit(200);
  if (error) throw new Error(`unreturnedCalls failed: ${error.message}`);
  const calls = data ?? [];
  if (calls.length === 0) return [];

  // "Returned" = any OUTBOUND message on that contact after the call. One read
  // for every candidate contact rather than one per call.
  const contactIds = [...new Set(calls.map((c) => c.contact_id as string))];
  const { data: outbound, error: mErr } = await db.from("messages")
    .select("created_at, conversations!inner(contact_id)")
    .eq("direction", "outbound")
    .in("conversations.contact_id", contactIds);
  if (mErr) throw new Error(`unreturnedCalls outbound read failed: ${mErr.message}`);

  const latestOut = new Map<string, string>();
  for (const row of (outbound ?? []) as unknown as
       { created_at: string; conversations: { contact_id: string } }[]) {
    const cid = row.conversations.contact_id;
    const prev = latestOut.get(cid);
    if (!prev || row.created_at > prev) latestOut.set(cid, row.created_at);
  }

  return calls
    .filter((c) => {
      const out = latestOut.get(c.contact_id as string);
      return !out || out <= c.started_at;
    })
    .map((c) => ({
      id: `call:${c.id}`, source: "call" as const, accountId,
      contactId: c.contact_id, title: c.summary || "",
      dueAt: null, occurredAt: c.started_at,
    }));
}

async function unansweredConversations(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  const { data, error } = await db.from("conversations")
    .select("id, contact_id, unread_count, last_message_at")
    .eq("account_id", accountId).gt("unread_count", 0)
    .order("last_message_at", { ascending: true }).limit(200);
  if (error) throw new Error(`unansweredConversations failed: ${error.message}`);
  return (data ?? []).map((c) => ({
    id: `conversation:${c.id}`, source: "conversation" as const, accountId,
    contactId: c.contact_id, title: "",
    dueAt: null, occurredAt: c.last_message_at ?? new Date(0).toISOString(),
  }));
}

async function staleBookings(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  // A job whose time has passed and which nobody marked completed or no_show.
  // This is the row that switches the review-request automation back on.
  const { data, error } = await db.from("bookings")
    .select("id, contact_id, ends_at")
    .eq("account_id", accountId).eq("status", "booked")
    .lt("ends_at", new Date().toISOString())
    .order("ends_at", { ascending: true }).limit(200);
  if (error) throw new Error(`staleBookings failed: ${error.message}`);
  return (data ?? []).map((b) => ({
    id: `booking:${b.id}`, source: "booking" as const, accountId,
    contactId: b.contact_id, title: "",
    dueAt: null, occurredAt: b.ends_at,
  }));
}

/**
 * SUPPRESSION (spec §3): an open task against a contact hides that contact's
 * derived call and conversation rows, so a "Not now" dismissal does not leave
 * the original showing alongside the task it created. Bookings are exempt —
 * marking one changes `status`, so it stops matching on its own.
 */
export async function listAccountWork(db: SupabaseClient, accountId: string): Promise<WorkRow[]> {
  const [tasks, calls, convos, bookings] = await Promise.all([
    openTasks(db, accountId),
    unreturnedCalls(db, accountId),
    unansweredConversations(db, accountId),
    staleBookings(db, accountId),
  ]);
  const suppressed = new Set(tasks.map((t) => t.contactId).filter(Boolean) as string[]);
  const keep = (r: WorkRow) => !r.contactId || !suppressed.has(r.contactId);
  return [...tasks, ...calls.filter(keep), ...convos.filter(keep), ...bookings];
}

export async function listAgencyWork(
  db: SupabaseClient,
): Promise<(WorkRow & { brandName: string })[]> {
  const { data, error } = await db.from("accounts")
    .select("id, brand_name, name").eq("outbound_suppressed", false);
  if (error) throw new Error(`listAgencyWork accounts read failed: ${error.message}`);
  const out: (WorkRow & { brandName: string })[] = [];
  for (const a of data ?? []) {
    // brand_name, never name — the internal label has leaked to customers.
    const brandName = a.brand_name ?? "";
    const rows = await listAccountWork(db, a.id);
    for (const r of rows) out.push({ ...r, brandName });
  }
  return out;
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `pnpm --filter @bis/db exec vitest run src/test/work-queue.test.ts`
Expected: vitest's own summary block reporting `1 passed`. Ignore the trailing `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`.

- [ ] **Step 5: Add one named test per remaining source**

Write three more tests in the same file, each seeding one source through `withTestAccount` and asserting its row appears: a `lead` call with no outbound message after it; a conversation with `unread_count` set above zero; a booking with `status = 'booked'` and `ends_at` in the past.

Then two tests for the exclusions, which are the ones that will be "fixed" by a future reader if they are not pinned:

```ts
it("excludes an abandoned call", async () => {
  await withTestAccount(async (db, accountId) => {
    const { data: c } = await db.from("contacts")
      .insert({ account_id: accountId, first_name: "Ann", last_name: "Lee" })
      .select("id").single();
    const { data: pn } = await db.from("phone_numbers")
      .select("id").eq("account_id", accountId).limit(1).single();
    const { data: call } = await db.from("calls").insert({
      account_id: accountId, phone_number_id: pn!.id, contact_id: c!.id,
      outcome: "abandoned", started_at: new Date(Date.now() - 3_600_000).toISOString(),
    }).select("id").single();

    const rows = await listAccountWork(db, accountId);
    expect(rows.map((r) => r.id)).not.toContain(`call:${call!.id}`);
  });
});

it("an open task on a contact suppresses that contact's derived rows", async () => {
  await withTestAccount(async (db, accountId) => {
    const { data: c } = await db.from("contacts")
      .insert({ account_id: accountId, first_name: "Ann", last_name: "Lee" })
      .select("id").single();
    await db.from("conversations").insert({
      account_id: accountId, contact_id: c!.id, unread_count: 2,
      last_message_at: new Date().toISOString(),
    });

    const before = await listAccountWork(db, accountId);
    expect(before.some((r) => r.source === "conversation")).toBe(true);

    await addTask(db, accountId, { contactId: c!.id, title: "Reply to Ann" }, "user_test");
    const after = await listAccountWork(db, accountId);
    expect(after.some((r) => r.source === "conversation")).toBe(false);
  });
});
```

If `phone_numbers` has no row for a fresh fixture account, insert one in the test rather than skipping — `calls.phone_number_id` is NOT NULL.

- [ ] **Step 6: Mutation check**

Delete the `.in("outcome", NEEDS_RETURN)` filter. Run the suite. **The `excludes an abandoned call` test must fail BY NAME.** If it does not, the test is not pinning what it claims and must be fixed before proceeding. Restore the filter.

Then delete the `keep` filter from `listAccountWork`. **The suppression test must fail BY NAME.** Restore it.

- [ ] **Step 7: Export from the barrel**

```ts
// packages/db/src/index.ts — add ONE line, do not touch neighbours
export { listAccountWork, listAgencyWork, type WorkRow, type WorkSource } from "./work-queue";
```

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/work-queue.ts packages/db/src/test/work-queue.test.ts packages/db/src/index.ts
git commit -m "feat(db): the four work-queue sources, with the abandoned exclusion pinned"
```

---

### Task 2: Bucketing, in the account's timezone

**Files:**
- Create: `apps/web/src/lib/work/buckets.ts`
- Test: `apps/web/src/lib/work/buckets.test.ts`

**Interfaces:**
- Consumes: `WorkRow` from `@bis/db`; `partsInZone(instant: Date, timeZone: string)` from `@/lib/booking/slots`.
- Produces:
  ```ts
  export type Bucket = "overdue" | "today" | "waiting";
  export type BucketedWork = { overdue: WorkRow[]; today: WorkRow[]; waiting: WorkRow[] };
  export function bucketWork(rows: WorkRow[], now: Date, zone: string): BucketedWork;
  ```

This is the heart of the feature and the only place date arithmetic happens. Every timezone case lives in its test.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/src/lib/work/buckets.test.ts
import { describe, it, expect } from "vitest";
import { bucketWork } from "./buckets";
import type { WorkRow } from "@bis/db";

const task = (id: string, dueAt: string | null, occurredAt = "2026-09-01T00:00:00Z"): WorkRow => ({
  id: `task:${id}`, source: "task", accountId: "a", contactId: null,
  title: id, dueAt, occurredAt,
});
// NOTE: there is no "call" source. It was specified, found unsatisfiable in
// review, and WITHDRAWN before implementation — see the spec §1.2. The three
// sources are task | conversation | booking. Do not reintroduce `call:` ids.
const derived = (id: string, occurredAt: string): WorkRow => ({
  id: `conversation:${id}`, source: "conversation", accountId: "a", contactId: "c",
  title: id, dueAt: null, occurredAt,
});

describe("bucketWork", () => {
  // 14:00 UTC on 2026-09-14 is 09:00 in Chicago and 23:00 in Tokyo.
  const now = new Date("2026-09-14T14:00:00Z");

  it("puts a task due earlier today in Today, not Overdue", () => {
    // 11:00 UTC = 06:00 Chicago, three hours before `now`, same local day.
    const b = bucketWork([task("t", "2026-09-14T11:00:00Z")], now, "America/Chicago");
    expect(b.today.map((r) => r.id)).toEqual(["task:t"]);
    expect(b.overdue).toHaveLength(0);
  });

  it("the SAME instant lands in different buckets in two zones", () => {
    // 2026-09-14T23:30Z is still the 14th in Chicago (18:30) but the 15th in Tokyo (08:30).
    const due = "2026-09-14T23:30:00Z";
    const chicago = bucketWork([task("t", due)], now, "America/Chicago");
    const tokyo = bucketWork([task("t", due)], now, "Asia/Tokyo");
    expect(chicago.today).toHaveLength(1);
    expect(tokyo.today).toHaveLength(0);   // tomorrow there, so it waits
    expect(tokyo.waiting).toHaveLength(1);
  });

  it("puts a task due yesterday in Overdue", () => {
    const b = bucketWork([task("t", "2026-09-13T15:00:00Z")], now, "America/Chicago");
    expect(b.overdue.map((r) => r.id)).toEqual(["task:t"]);
  });

  it("undated tasks and ALL derived rows go to Waiting, oldest first", () => {
    const rows = [
      derived("new", "2026-09-14T13:00:00Z"),
      task("undated", null, "2026-09-10T00:00:00Z"),
      derived("old", "2026-09-08T09:00:00Z"),
    ];
    const b = bucketWork(rows, now, "America/Chicago");
    expect(b.waiting.map((r) => r.id)).toEqual(["conversation:old", "task:undated", "conversation:new"]);
    expect(b.overdue).toHaveLength(0);
  });

  it("NEVER promotes a stale derived row into Overdue", () => {
    // A booking that ended three weeks ago reads as late but carries no
    // promised date. Spec §2: Overdue means someone set a date and it passed.
    const b = bucketWork([derived("ancient", "2026-08-20T00:00:00Z")], now, "America/Chicago");
    expect(b.overdue).toHaveLength(0);
    expect(b.waiting).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `cd apps/web && npx vitest run src/lib/work/buckets.test.ts`
Expected: FAIL — cannot resolve `./buckets`.

> ⚠️ `cd apps/web` moves the shell for every later command in that block. Use an absolute path or `cd` back.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/work/buckets.ts
import type { WorkRow } from "@bis/db";
import { partsInZone } from "@/lib/booking/slots";

export type Bucket = "overdue" | "today" | "waiting";
export type BucketedWork = { overdue: WorkRow[]; today: WorkRow[]; waiting: WorkRow[] };

/** `YYYY-MM-DD` as seen in `zone`. Comparable as a string because the parts
 *  are zero-padded and fixed width.
 *
 *  NOTE the key names: `partsInZone` returns `{ y, m, d, hh, mi, weekday }`
 *  with SHORT keys and numeric values (slots.ts:55) — not `{ year, month,
 *  day }`. Reaching for the long names yields `undefined` and a day key of
 *  "undefined-NaN-NaN" that compares unequal to everything, so every task
 *  silently lands in Waiting. */
function localDay(instant: Date, zone: string): string {
  const { y, m, d } = partsInZone(instant, zone);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Three buckets, resolved in the ACCOUNT's zone.
 *
 * Only tasks can be Overdue or Today. A derived row's `occurredAt` records
 * when something happened, which is not a promise that it would be done by
 * then — so derived rows always wait, however old (spec §2). Oldest-first
 * ordering surfaces the stale ones anyway; do not "fix" this by promoting them.
 */
export function bucketWork(rows: WorkRow[], now: Date, zone: string): BucketedWork {
  const todayKey = localDay(now, zone);
  const out: BucketedWork = { overdue: [], today: [], waiting: [] };

  for (const r of rows) {
    if (r.source === "task" && r.dueAt) {
      const dueKey = localDay(new Date(r.dueAt), zone);
      if (dueKey < todayKey) out.overdue.push(r);
      else if (dueKey === todayKey) out.today.push(r);
      else out.waiting.push(r);
      continue;
    }
    out.waiting.push(r);
  }

  const byDue = (a: WorkRow, b: WorkRow) => (a.dueAt ?? "").localeCompare(b.dueAt ?? "");
  const byAge = (a: WorkRow, b: WorkRow) => a.occurredAt.localeCompare(b.occurredAt);
  out.overdue.sort(byDue);
  out.today.sort(byDue);
  out.waiting.sort(byAge);
  return out;
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run src/lib/work/buckets.test.ts` from `apps/web`.
Expected: `5 passed`.

- [ ] **Step 5: Mutation check — prove the zone is load-bearing**

Replace `localDay(new Date(r.dueAt), zone)` with `r.dueAt.slice(0, 10)` (UTC day). **`the SAME instant lands in different buckets in two zones` must fail BY NAME.** This is the exact defect this repo has shipped before — a UTC day boundary rendering the previous day for American accounts. Restore.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/work/buckets.ts apps/web/src/lib/work/buckets.test.ts
git commit -m "feat(work): bucket work in the account's own zone, never UTC"
```

---

### Task 3: The per-account screen, read-only

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/page.tsx`
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/work-list.tsx`
- Modify: `apps/web/src/lib/messages.ts` (add the `work.` namespace — additive only)
- Modify: `apps/web/src/lib/nav-groups.ts` (one nav entry + one `NavIconKey` member)
- Modify: `apps/web/src/components/app-sidebar.tsx` (map the new icon key)
- Test: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/page.test.ts`

**Interfaces:**
- Consumes: `listAccountWork` from `@bis/db`; `bucketWork` from `@/lib/work/buckets`; `requireAccountAccess` from `@/lib/auth`; `dbForRequest` from `@/lib/db`.
- Produces: the route `/dashboard/accounts/[accountId]/tasks`.

- [ ] **Step 1: Add the copy**

```ts
// apps/web/src/lib/messages.ts — under the work. namespace, additive
"work.title": "To do",
"work.empty": "Nothing needs you right now.",
"work.bucket.overdue": "Overdue",
"work.bucket.today": "Today",
"work.bucket.waiting": "Waiting",
"work.call": "Call {name} back",
"work.conversation": "Reply to {name}",
"work.booking": "Did this job happen?",
"work.notNow": "Not now",
"work.done": "Done",
"work.booking.completed": "It happened",
"work.booking.noShow": "They didn't show",
"nav.tasks": "To do",
```

Copy rule: a row names the person, not the record type. "Call Maria Garcia back", never "Unreturned inbound voice interaction".

- [ ] **Step 2: Write the failing test**

```ts
// .../tasks/page.test.ts
import { describe, it, expect } from "vitest";
import { bucketWork } from "@/lib/work/buckets";
import type { WorkRow } from "@bis/db";

describe("the To do page's data shape", () => {
  it("omits a bucket with no rows rather than rendering an empty heading", () => {
    const rows: WorkRow[] = [{
      id: "call:1", source: "call", accountId: "a", contactId: "c",
      title: "", dueAt: null, occurredAt: "2026-09-10T00:00:00Z",
    }];
    const b = bucketWork(rows, new Date("2026-09-14T14:00:00Z"), "America/Chicago");
    const shown = (["overdue", "today", "waiting"] as const).filter((k) => b[k].length > 0);
    expect(shown).toEqual(["waiting"]);
  });
});
```

- [ ] **Step 3: Run it, watch it fail, then build the page**

The page is a server component: `requireAccountAccess(accountId)`, read the account's `timezone` and `brand_name`, `listAccountWork(await dbForRequest(), accountId)`, `bucketWork(rows, new Date(), timezone)`, render. A bucket with zero rows renders nothing at all — no heading. The whole queue empty renders `work.empty` in one plain sentence.

`work-list.tsx` renders the rows. Follow the contacts table's existing row conventions: the whole row is the click target, `:focus-visible` ring visible, status shown as dot **plus word** (DESIGN.md rule 3), skeletons not spinners (rule 7).

- [ ] **Step 4: Wire the nav**

```ts
// nav-groups.ts — add "tasks" to the NavIconKey union, then inside the
// Overview group, directly after the dashboard entry:
{ href: `${base}/tasks`, labelKey: "nav.tasks", iconKey: "tasks" },
```

Then map `tasks` to an icon in `app-sidebar.tsx` alongside the others. **Add a line; never reorder the registry.**

- [ ] **Step 5: Run the touched suites**

Run: `npx vitest run src/lib/work src/app/\(dashboard\)/dashboard/accounts/\[accountId\]/tasks` from `apps/web`.
Expected: all green, with the summary line pasted into the report.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/accounts/\[accountId\]/tasks apps/web/src/lib/messages.ts apps/web/src/lib/nav-groups.ts apps/web/src/components/app-sidebar.tsx
git commit -m "feat(work): the To do screen, read-only"
```

---

### Task 4: The three actions

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/tasks/actions.ts`
- Modify: `.../tasks/work-list.tsx` (wire the buttons)
- Test: `.../tasks/actions.test.ts`

**Interfaces:**
- Consumes: `addTask`, `completeTask` from `@bis/db`; `setBookingStatus` from `@bis/db`; `partsInZone`/`zonedTimeToUtc` from `@/lib/booking/slots`.
- Produces:
  ```ts
  export async function completeWorkTask(accountId: string, taskId: string): Promise<void>;
  export async function dismissToTask(accountId: string, row: { source: string; contactId: string | null; title: string }): Promise<void>;
  export async function closeOutBooking(accountId: string, bookingId: string, status: "completed" | "no_show"): Promise<void>;
  ```

Exact signatures, verified against source — do not trust any other rendering of them:

```
addTask(db, accountId, { contactId?, title, dueAt? }, actorId, actorType?) => Promise<{ id: string }>
completeTask(db, accountId, taskId, actorId, actorType?) => Promise<void>
setBookingStatus(db, accountId, bookingId, status, actorId) => Promise<void>
```

- [ ] **Step 1: Write the failing test for the dismissal date**

```ts
// .../tasks/actions.test.ts
import { describe, it, expect } from "vitest";
import { tomorrowAt9 } from "./actions";

describe("tomorrowAt9", () => {
  it("is 09:00 the next day in the ACCOUNT's zone, not the server's", () => {
    // 2026-09-14T14:00Z is 09:00 Chicago. Tomorrow 09:00 Chicago = 14:00Z on the 15th.
    const iso = tomorrowAt9(new Date("2026-09-14T14:00:00Z"), "America/Chicago");
    expect(iso).toBe("2026-09-15T14:00:00.000Z");
  });

  it("crosses a DST boundary without drifting an hour", () => {
    // US DST ends 2026-11-01. 2026-10-31T13:00Z is 09:00 CDT (UTC-5);
    // tomorrow 09:00 is CST (UTC-6) = 15:00Z, not 14:00Z.
    const iso = tomorrowAt9(new Date("2026-10-31T13:00:00Z"), "America/Chicago");
    expect(iso).toBe("2026-11-01T15:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run, watch both fail, then implement**

`tomorrowAt9` uses `partsInZone` to get the local date, adds one day, and converts back with `zonedTimeToUtc(y, m, d, 9, 0, zone)`. Do **not** add 86_400_000 milliseconds — that is the DST bug the second test pins.

The three actions each: `requireAccountAccess`, then call the db function with `dbForRequest()`, then `revalidatePath` the To do route. `dismissToTask` builds the title from the row's own label (§3) and passes `dueAt: tomorrowAt9(new Date(), zone)`.

- [ ] **Step 3: Run and watch them pass**

Expected: `2 passed`, summary line in the report.

- [ ] **Step 4: Mutation check**

Replace `zonedTimeToUtc(...)` with `new Date(now.getTime() + 86_400_000)`. **`crosses a DST boundary without drifting an hour` must fail BY NAME.** Restore.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/accounts/\[accountId\]/tasks
git commit -m "feat(work): Not now, Done, and closing out a booking"
```

---

### Task 5: The dashboard row

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/accounts/[accountId]/dashboard/work-row.tsx`
- Modify: `.../dashboard/page.tsx` (render it above the KPI tiles)
- Modify: `apps/web/src/lib/messages.ts` (additive)
- Test: `.../dashboard/work-row.test.ts`

**Interfaces:**
- Consumes: `BucketedWork` from `@/lib/work/buckets`.
- Produces: `export function WorkRow({ accountId, total, overdue }: { accountId: string; total: number; overdue: number })`.

> ⚠️ Name the component `WorkRowCard`, not `WorkRow` — `WorkRow` is already the row **type** exported from `@bis/db` and the collision will confuse every later reader.

Follow `checklist-row.tsx` exactly: one `Link` wrapping the row, the whole row is the click target, the count carries the accessible name via `aria-label` on the `Link` (not a labelled span inside it).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { workRowText } from "./work-row";

describe("workRowText", () => {
  it("leads with the total and adds the overdue breakdown when there is one", () => {
    expect(workRowText(7, 2)).toBe("7 things to do · 2 overdue");
  });
  it("omits the breakdown when nothing is dated", () => {
    expect(workRowText(7, 0)).toBe("7 things to do");
  });
  it("says so plainly when the queue is empty, rather than vanishing", () => {
    expect(workRowText(0, 0)).toBe("Nothing needs you right now.");
  });
});
```

The third case is the point: a row that disappears reads as a broken feature (spec §4.3).

- [ ] **Step 2: Run, fail, implement, run, pass. Then commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/accounts/\[accountId\]/dashboard apps/web/src/lib/messages.ts
git commit -m "feat(work): a compact work row above the dashboard tiles"
```

---

### Task 6: The agency-wide screen and its boundary

**Files:**
- Create: `apps/web/src/app/(dashboard)/dashboard/work/page.tsx`
- Modify: `apps/web/src/lib/nav-groups.ts` (agency top-level group)
- Modify: `apps/web/src/lib/messages.ts` (additive)
- Test: `apps/web/e2e/work-queue.spec.ts`

**Interfaces:**
- Consumes: `listAgencyWork` from `@bis/db`; `requireAgency` from `@/lib/auth`.

🔴 This is the first screen whose whole purpose is to span tenants. Its test is a **boundary test first**, a feature test second.

- [ ] **Step 1: Write the failing e2e**

```ts
// apps/web/e2e/work-queue.spec.ts
import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

test("a client cannot reach the agency work queue", async ({ page }) => {
  // Signed in as the per-run client fixture, never Test Client One.
  await page.goto("/dashboard/work");
  await expect(page).not.toHaveURL(/\/dashboard\/work$/);
  await expect(page.getByRole("heading", { name: /everything due/i })).toHaveCount(0);
});
```

Use the existing client-fixture storage state the other client-boundary specs use — copy the pattern from `client-access.spec.ts` rather than inventing one.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter web test:e2e -- work-queue.spec.ts`
Expected: FAIL — the route 404s or renders. Paste the failure.

- [ ] **Step 3: Build the page with `requireAgency` first**

`requireAgency()` on the very first line, before any read. Then `listAgencyWork(serviceDb())`, bucket per account zone, render grouped with `brandName` on every row.

- [ ] **Step 4: Run the spec alone and watch it pass**

If it goes red on something unrelated, re-run that spec ALONE before investigating — judge by wall clock, and check whether the failure moves between tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/dashboard/work apps/web/e2e/work-queue.spec.ts apps/web/src/lib/nav-groups.ts apps/web/src/lib/messages.ts
git commit -m "feat(work): the agency-wide queue, agency-only by construction"
```

---

### Task 7: Close the loop, and the gates

**Files:**
- Test: `apps/web/e2e/work-queue.spec.ts` (extend)
- Modify: `docs/runbooks/` — none. No runbook needed; nothing here requires a dashboard or env change.

- [ ] **Step 1: Write the test that closes the spec's opening argument**

A booking marked **It happened** from the To do screen becomes review-eligible: its `status` is `completed` and `completed_at` is stamped, which is exactly what `automations.ts:218` selects on. Assert both, on the per-run fixture account.

This is the assertion that proves the feature did the thing it was built for — the review-request pass has never sent a message because nothing ever set this.

- [ ] **Step 2: Run the three gates, ONE AT A TIME**

```bash
pnpm check                      # typecheck + lint + db + web
pnpm --filter web build
pnpm --filter web test:e2e
```

Capture each to a file and read the exit code from the file, with nothing after the command in the same block — a trailing `echo` has masked a red suite as exit 0 here before. Two gates at once has OOM-killed this machine mid-e2e (`0xC0000142` is resource exhaustion, not a test failure).

- [ ] **Step 3: Commit and open the PR**

Body names: the four sources, the zero-migration property, the `abandoned` exclusion as a product decision, and the review-request finding. Merge only when `verify` AND `e2e` are green on the PR's current head.

---

## Self-review

**Spec coverage:** §1.1–1.4 → Task 1. §2 → Task 2. §3 dismissal + suppression → Tasks 1 (suppression query) and 4 (the action). §4.1 → Task 3. §4.2 → Task 6. §4.3 → Task 5. Copy → Task 3 step 1. Testing → every task, plus Task 7. Rollout → Task 7.

**Gap found and closed:** the spec's §3 suppression rule is a *query* concern, not an action concern — it lives in `listAccountWork` (Task 1), and Task 4 only writes the task. Both are called out so no one implements it twice.

**Type consistency:** `WorkRow`, `WorkSource`, `BucketedWork`, `listAccountWork`, `listAgencyWork`, `bucketWork`, `tomorrowAt9` are used identically everywhere they appear. One collision found and renamed: the dashboard component is `WorkRowCard`, because `WorkRow` is the row type.

**Not in any task, deliberately:** assignment (`users` has 0 rows), notifications, mobile layout, changes to contact-timeline task creation.
