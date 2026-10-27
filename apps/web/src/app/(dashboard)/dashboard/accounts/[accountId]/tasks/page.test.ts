import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Proposal, WorkRow } from "@bis/db";
import { bucketWork, type BucketedWork } from "@/lib/work/buckets";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { makeTr } from "@/lib/record/copy";
import { visibleBuckets, WorkList } from "./work-list";

// --- Mocks for the TasksPage composition tests below (the "zone reaches the
// page" and "rethrow" findings need the whole route, not just WorkList in
// isolation). Same shape as calls/page.test.ts's mocks: the auth gate and the
// DB entry points this async server component actually reaches, rather than
// exercising Clerk/Supabase for what is a "which value reaches render" bug.
/** Mutable so the client-vs-agency split in the zone note can be exercised
 *  on the REAL route rather than only on the component in isolation — the
 *  Settings link must never reach a client, and this page is one of the
 *  three a client can actually open. */
let isAgency = true;
/** F-085 part 1: the caller's role, for ?who= (null keeps every older test's agency/plain-client caller). */
let role: "owner" | "staff" | "technician" | null = null;
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency, role }),
}));
// Task 12: the page now resolves its own render locale (for the held-emails
// row's words) the same way conversations/page.tsx already does.
vi.mock("@/lib/preferences/person-prefs", () => ({ getPersonPrefs: async () => ({ language: null, theme: null }) }));

/** Mutable so each test can pick the account's own (possibly invalid) zone
 *  without a fresh `vi.mock` per test — assigned in `beforeEach` before the
 *  dynamic `import("./page")` below ever resolves this factory. */
let accountTimezone = "America/Chicago";
/**
 * The request client, as a recording two-account fake (item 8b-1, plan fix I-5). Every `from(table)`
 * call logs its `.eq`/`.in`/`.limit` filters and answers rows FILTERED by them, so a read that drops its
 * `.eq("account_id", …)` really does receive the other account's rows (same ids) and draws them: each
 * read's case below asserts both the filter and that only acct1's value reaches the render. The
 * accounts row is built at read time from `accountTimezone`, which the zone tests set per test.
 */
type FakeRow = Record<string, unknown>;
type FakeQuery = { table: string; eq: [string, unknown][]; in: [string, unknown[]][]; limit: number | null };
const fake = {
  tables: {} as Record<string, FakeRow[]>,
  fail: new Set<string>(),
  log: [] as FakeQuery[],
};
function resetFake() {
  fake.tables = {};
  fake.fail.clear();
  fake.log.length = 0;
}
const REQUEST = {
  from(table: string) {
    const entry: FakeQuery = { table, eq: [], in: [], limit: null };
    fake.log.push(entry);
    const run = (): { data: FakeRow[] | null; error: { message: string } | null } => {
      if (fake.fail.has(table)) return { data: null, error: { message: `permission denied for table ${table}` } };
      const source = table === "accounts"
        ? [{ id: "acct2", timezone: "Asia/Tokyo", language: "es" }, { id: "acct1", timezone: accountTimezone, language: null }]
        : fake.tables[table] ?? [];
      const rows = source
        .filter((r: FakeRow) => entry.eq.every(([c, v]) => r[c] === v) && entry.in.every(([c, vs]) => vs.includes(r[c])));
      return { data: entry.limit === null ? rows : rows.slice(0, entry.limit), error: null };
    };
    const q = {
      select: () => q,
      eq: (c: string, v: unknown) => { entry.eq.push([c, v]); return q; },
      in: (c: string, vs: unknown[]) => { entry.in.push([c, vs]); return q; },
      limit: (n: number) => { entry.limit = n; return q; },
      order: () => q,
      gt: () => q,
      maybeSingle: async () => {
        const r = run();
        if (r.error) return r;
        if (r.data!.length > 1) return { data: null, error: { message: "more than one row" } };
        return { data: r.data![0] ?? null, error: null };
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(run()).then(ok, ko),
    };
    return q;
  },
};
const readsOf = (table: string) => fake.log.filter((q) => q.table === table);
vi.mock("@/lib/db", () => ({ dbForRequest: async () => REQUEST }));
// The Suggestions section's Retry refreshes through the app router, which a static render has not mounted.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

// Task 7 fix round 1 (I3): the task picker is a client component whose own
// behaviour is tested in components/assign/assign.test.ts; here only what a
// row HANDS it is pinned (the raw task id, this account), so it is captured.
const taskFieldProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("@/components/assign/assignee-field", async () => {
  const { createElement: h } = await import("react");
  return {
    TaskAssigneeField: (p: Record<string, unknown>) => {
      taskFieldProps.push(p);
      return h("span", { "data-task-assignee": String(p.taskId) });
    },
  };
});

let workRows: WorkRow[] = [];
/** This account's own pending proposals (Important 3) — defaults to none so
 *  every pre-existing test below is unaffected by this mock's addition. A
 *  real `vi.fn()` (not a bare closure, unlike `listAccountWork` above) so
 *  the "degrades on failure" test can override it with a rejection for
 *  exactly one call. */
let pendingProposals: Proposal[] = [];
const listPendingProposalsMock = vi.fn<(...a: unknown[]) => Promise<Proposal[]>>(async () => pendingProposals);
/** The agency's own zone, as `lib/zone.ts` reads it through `serviceDb`.
 *  Only `serviceDb` and `listAccountWork` are stubbed — `resolveZone` stays
 *  REAL, so these tests exercise the actual chain (account -> agency -> UTC)
 *  rather than a re-implementation of it. */
let agencyTimezone: string | null = "America/Chicago";
/** F-085 part 1: spied so the ?who= tests can read what the page asked for. */
const listAccountWorkMock = vi.fn<(...a: unknown[]) => Promise<WorkRow[]>>(async () => workRows);
const readPersonIdMock = vi.fn<(...a: unknown[]) => Promise<string | null>>(async () => "p-me");
const listAccountTeamMock = vi.fn<(...a: unknown[]) => Promise<unknown[]>>(async () => []);
/** Task 12: this account's own held-email count — mutable per test, and a
 *  real mock (never the real `countHeldInboundEmails`, whose own two
 *  chained `.eq()` calls this file's `@/lib/db` fake does not support). */
let heldEmailsCount: number | null = 0;
const countHeldInboundEmailsMock = vi.fn(async (): Promise<number> => {
  if (heldEmailsCount === null) throw new Error("held count read failed");
  return heldEmailsCount;
});
vi.mock("@bis/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@bis/db")>();
  return {
    ...actual,
    listAccountWork: (...args: unknown[]) => listAccountWorkMock(...args),
    listPendingProposals: (...args: unknown[]) => listPendingProposalsMock(...args),
    readPersonId: (...args: unknown[]) => readPersonIdMock(...args),
    listAccountTeam: (...args: unknown[]) => listAccountTeamMock(...args),
    countHeldInboundEmails: () => countHeldInboundEmailsMock(),
    serviceDb: () => ({
      from: () => ({
        select: () => ({
          limit: () => ({
            maybeSingle: async () => ({
              data: agencyTimezone === null ? null : { timezone: agencyTimezone },
              error: null,
            }),
          }),
        }),
      }),
    }),
  };
});

/** Flips `formatDateInZone` (and ONLY that export — everything else is the
 *  real module) into throwing a non-`RangeError` for exactly one test, to
 *  prove the rethrow-on-programming-error path without ever needing an
 *  input that could naturally produce one. */
let forceFormatError = false;
vi.mock("@/lib/format", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/format")>();
  return {
    ...actual,
    formatDateInZone: (iso: string, timeZone: string) => {
      if (forceFormatError) throw new TypeError("boom: not a RangeError");
      return actual.formatDateInZone(iso, timeZone);
    },
  };
});

function conversationRow(overrides: Partial<WorkRow> = {}): WorkRow {
  return {
    id: "conversation:1", source: "conversation", accountId: "a", contactId: "c1",
    title: "", dueAt: null, occurredAt: "2026-09-10T00:00:00Z",
    ...overrides,
  };
}

function taskRow(overrides: Partial<WorkRow> = {}): WorkRow {
  return {
    id: "task:1", source: "task", accountId: "a", contactId: "c1",
    title: "Call about the estimate", dueAt: "2026-09-14T11:00:00Z", occurredAt: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function bookingRow(overrides: Partial<WorkRow> = {}): WorkRow {
  return {
    id: "booking:1", source: "booking", accountId: "a", contactId: "c1",
    title: "", dueAt: null, occurredAt: "2026-09-05T00:00:00Z",
    ...overrides,
  };
}

/** Fix-wave Important 3 — a pending proposal fixture for the composition
 *  tests below, same shape as work/page.test.ts's own `proposal()`. */
function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1", accountId: "acct1", callId: "call-1", contactId: null,
    kind: "task", payload: { title: "Call back", dueAt: null },
    evidence: "the caller asked for a callback", status: "pending",
    decidedAt: null, decidedBy: null, createdAt: "2026-09-01T00:00:00Z",
    source: "call", evidenceRef: {}, evidenceLang: "en", expiredReason: null, appliedPayload: null, appliedRef: null, undoneAt: null, undoneBy: null, expiresAt: "2099-01-01T00:00:00Z",
    ...overrides,
  } as Proposal;
}

/**
 * The brief's Step 2 test asserted a `.filter()` written two lines above it
 * in the SAME test, never importing the page or the list — it could not
 * fail when the screen regressed to rendering an empty heading. This tests
 * the real, exported pure helper the component actually renders from
 * instead (danlo's resolution #1). The brief's own fixture used
 * `source: "call"`, which no longer typechecks — WorkSource dropped that
 * source before implementation (packages/db/src/work-queue.ts's own doc
 * comment) — so this uses a live source (`conversation`) to exercise the
 * same shape: exactly one bucket populated, out of three possible.
 */
describe("visibleBuckets", () => {
  it("omits a bucket with no rows rather than rendering an empty heading", () => {
    const b = bucketWork([conversationRow()], new Date("2026-09-14T14:00:00Z"), "America/Chicago");
    expect(visibleBuckets(b)).toEqual(["waiting"]);
  });

  it("is empty when the whole queue is empty", () => {
    const b = bucketWork([], new Date("2026-09-14T14:00:00Z"), "America/Chicago");
    expect(visibleBuckets(b)).toEqual([]);
  });

  it("orders overdue, then today, then waiting — never the reverse", () => {
    const overdueTask = taskRow({ id: "task:overdue", dueAt: "2026-09-01T00:00:00Z" });
    const todayTask = taskRow({ id: "task:today", dueAt: "2026-09-14T11:00:00Z" });
    const b = bucketWork(
      [conversationRow(), overdueTask, todayTask],
      new Date("2026-09-14T14:00:00Z"),
      "America/Chicago",
    );
    expect(visibleBuckets(b)).toEqual(["overdue", "today", "waiting"]);
  });
});

const NOW = new Date("2026-09-14T14:00:00Z");
const ZONE = "America/Chicago";
const ACCOUNT_ID = "acct1";

function renderList(
  buckets: BucketedWork,
  contactNames: Record<string, string> = {},
  timezone: string = ZONE,
) {
  return renderToStaticMarkup(
    createElement(WorkList, { buckets, accountId: ACCOUNT_ID, contactNames, timezone, tr: makeTr("en") }),
  );
}

describe("WorkList", () => {
  it("renders the whole-queue-empty sentence, and nothing else, when there is no work", () => {
    const b = bucketWork([], NOW, ZONE);
    const html = renderList(b);
    expect(html).toContain(m["work.empty"]);
    // DESIGN.md rule 5: an empty state sells the feature — one sentence of
    // what appears here — not just a bare announcement of emptiness.
    expect(html).toContain(m["work.empty.body"]);
    expect(html).not.toContain(m["work.bucket.overdue"]);
    expect(html).not.toContain(m["work.bucket.today"]);
    expect(html).not.toContain(m["work.bucket.waiting"]);
  });

  it("renders only the Waiting heading when only Waiting has rows", () => {
    const b = bucketWork([conversationRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    // Pinned to the HEADING ELEMENT itself, not a bare string — the per-row
    // status chip (work-list.tsx's BUCKET_TREATMENT) renders the exact same
    // "Waiting" text, so `toContain(m["work.bucket.waiting"])` alone stays
    // green even if the <h2> is deleted outright.
    expect(html).toMatch(new RegExp(`<h2[^>]*>${m["work.bucket.waiting"]}</h2>`));
    expect(html).not.toContain(m["work.bucket.overdue"]);
    expect(html).not.toContain(m["work.bucket.today"]);
  });

  it("shows status as a dot plus a word, never color alone", () => {
    const b = bucketWork([conversationRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain("size-[7px] rounded-full");
    // Pinned to the CHIP's own <span data-slot="badge"> — the section
    // heading above renders this exact same "Waiting" text, so
    // `toContain(m["work.bucket.waiting"])` alone stayed green even after
    // the word was deleted from the chip outright, leaving only the dot.
    expect(html).toMatch(
      new RegExp(`<span data-slot="badge"[^>]*>.*?</span>${m["work.bucket.waiting"]}</span>`),
    );
  });

  it("names the contact on a conversation row via work.conversation", () => {
    const b = bucketWork([conversationRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain("Reply to Maria Garcia");
  });

  it("shows a task's own human-written title verbatim, not a template", () => {
    const b = bucketWork([taskRow({ dueAt: "2026-09-01T00:00:00Z" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain("Call about the estimate");
  });

  it("asks the booking question and still names the person as context", () => {
    const b = bucketWork([bookingRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain(m["work.booking"]);
    expect(html).toContain("Maria Garcia");
  });

  it("falls back to a plain label, never a raw id or the word 'undefined', for a contact missing from the map", () => {
    const b = bucketWork([bookingRow({ contactId: "missing-id" })], NOW, ZONE);
    const html = renderList(b, {}); // no entry for "missing-id"
    // The id legitimately appears in the row's own href (real navigation to
    // that contact) — what must never happen is the id, or "undefined",
    // standing in for the DISPLAYED name as text content.
    expect(html).not.toMatch(/>[^<]*missing-id[^<]*</);
    expect(html).not.toMatch(/>[^<]*undefined[^<]*</);
    expect(html).toContain(m["contact.noName"]);
  });

  it("links a row with a contact to that contact's page", () => {
    const b = bucketWork([conversationRow({ contactId: "c1" })], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).toContain(`href="/dashboard/accounts/${ACCOUNT_ID}/contacts/c1"`);
  });

  it("does not link a contact-less row anywhere", () => {
    const b = bucketWork([taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })], NOW, ZONE);
    const html = renderList(b, {});
    expect(html).not.toMatch(/<a\b/);
  });

  it("stamps the row's date in the ACCOUNT's zone, not the server's", () => {
    // Two zones, one instant — same trap `calls-table.test.ts` and
    // `format.test.ts` both record: a fixture zone equal to the dev
    // machine's zone cannot tell "formatted in the account zone" apart from
    // "formatted in whatever zone this process happens to be in". 01:00 UTC
    // is still the previous day in Chicago (format.test.ts's own boundary).
    const row = taskRow({ dueAt: "2026-09-04T01:00:00Z" });
    const b = bucketWork([row], NOW, ZONE);
    const chicago = renderList(b, { c1: "Maria Garcia" }, "America/Chicago");
    expect(chicago).toContain("Sep 3, 2026");
    const utc = renderList(b, { c1: "Maria Garcia" }, "UTC");
    expect(utc).toContain("Sep 4, 2026");
  });

  it("renders no date at all for the epoch-sentinel timestamp a conversation with no last_message_at carries", () => {
    // packages/db/src/work-queue.ts:71 falls back to `new Date(0).toISOString()`
    // when a conversation's `last_message_at` is null — genuinely reachable in
    // production (messaging.ts's conversation touch is best-effort and the
    // unread-increment path never sets that column). "Jan 1, 1970" (or, in a
    // negative-offset zone, "Dec 31, 1969") would read as a real date, not
    // "unknown" — so this row must print no date at all instead.
    const row = conversationRow({ contactId: "c1", occurredAt: new Date(0).toISOString() });
    const b = bucketWork([row], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).not.toMatch(/19(69|70)/);
    // Positive half (review finding: negative-only stays green even if the
    // row stopped rendering at all) — the row is still HERE, sentence and
    // all, just with no date text next to it.
    expect(html).toContain("Reply to Maria Garcia");
  });

  it("also declines a non-canonical spelling of the same epoch instant, not just the exact sentinel string", () => {
    // `new Date(0).toISOString()` is "1970-01-01T00:00:00.000Z" exactly — a
    // string-equality guard would let "1970-01-01T00:00:00Z" (same instant,
    // no milliseconds) through and print "Dec 31, 1969" in Chicago. Not
    // reachable from today's schema (work-queue.ts only ever writes the
    // canonical form or a real `last_message_at`), but matching the parsed
    // instant instead of one exact string closes it for free.
    const row = conversationRow({ contactId: "c1", occurredAt: "1970-01-01T00:00:00Z" });
    const b = bucketWork([row], NOW, ZONE);
    const html = renderList(b, { c1: "Maria Garcia" });
    expect(html).not.toMatch(/19(69|70)/);
    expect(html).toContain("Reply to Maria Garcia");
  });

  it("rethrows a non-RangeError from the format path instead of swallowing it into a permanently blank cell", () => {
    // The bucketing function this screen mirrors (`bucketWork`) narrows its
    // own two `catch` blocks the same way: rethrow anything that is not a
    // `RangeError`. A bare `catch {}` here would instead turn a real bug in
    // `formatDateInZone` into a silently blank date on every row, forever.
    forceFormatError = true;
    try {
      const b = bucketWork([taskRow({ dueAt: "2026-09-01T00:00:00Z" })], NOW, ZONE);
      expect(() => renderList(b, { c1: "Maria Garcia" })).toThrow(TypeError);
    } finally {
      forceFormatError = false;
    }
  });
});

/**
 * THIS BLOCK USED TO ASSERT THE OPPOSITE, and the inversion is the point.
 *
 * It previously pinned "an invalid account zone omits the row's date, never
 * guesses it" — the work queue's half of the timezone defect. The other four
 * screens clamped silently to UTC; this one went quiet. danlo settled it on
 * 2026-09-17: "I do not want to omit the dates so let's find a workaround."
 * The workaround is `resolveZone` — the date always renders, and the screen
 * NAMES the zone it is in, so nothing is guessed silently and nothing is
 * withheld. These tests pin the new contract at the same strength.
 */
describe("TasksPage — an unusable account zone is named, never silently guessed and never omitted", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = true;
    workRows = [];
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    resetFake();
  });

  it("renders the date AND names the agency's zone when the account's own is unusable (mutation: drop the agency step from resolveZone so it falls to UTC -> date moves to Sep 1 and the note names UTC -> FAILS)", async () => {
    // 2026-09-01T00:00:00Z is 2026-08-31 19:00 in America/Chicago. Picking an
    // instant that lands on a DIFFERENT CALENDAR DAY in the two candidate
    // zones is what makes this test able to fail: if the agency step were
    // dropped and this fell through to UTC, the rendered date would move.
    // A fixture zone that agreed with UTC would assert nothing.
    accountTimezone = "Not/AZone";
    agencyTimezone = "America/Chicago";
    workRows = [taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    // The date is PRESENT — the omission is gone — and it is the agency
    // zone's day, not UTC's.
    expect(html).toContain("Aug 31, 2026");
    expect(html).not.toContain("Sep 1, 2026");
    // THE CHIP AGREES WITH THE DATE. `bucketWork` must run in the same
    // resolved zone the row's date is formatted in: bucketed in the raw
    // (unusable) zone it degrades to "every row waits", so this row would
    // render "Aug 31, 2026" — eighteen days past due — beside a chip saying
    // Waiting. That self-contradiction inside one row is exactly what
    // sharing one zone exists to prevent.
    expect(renderedText(html)).toContain(m["work.bucket.overdue"]);
    expect(renderedText(html)).not.toContain(m["work.bucket.waiting"]);
    // …and the screen says which zone that is.
    expect(renderedText(html)).toContain(m["zone.note"].replace("{zone}", "America/Chicago"));
    // DESIGN.md rule 3 — the marker is a WORD, not a colour.
    expect(renderedText(html)).toContain(m["zone.guessed.agency"]);
  });

  it("falls to UTC and says so when the agency's zone is unusable too (mutation: label the fallback 'America/Chicago' -> FAILS)", async () => {
    accountTimezone = "Not/AZone";
    agencyTimezone = "Also/Broken";
    workRows = [taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    expect(html).toContain("Sep 1, 2026");
    expect(renderedText(html)).toContain(m["zone.note"].replace("{zone}", "UTC"));
    // The fallback sentence names BOTH broken settings, which is the whole
    // reason `source` is separate from `guessed`.
    expect(renderedText(html)).toContain(m["zone.guessed.fallback"]);
    expect(renderedText(html)).not.toContain(m["zone.guessed.agency"]);
  });

  it("a correctly-configured account is NOT labelled a guess (mutation: key guessed on 'did we end up at UTC' instead of on whose value was used -> FAILS)", async () => {
    // The account's own zone IS UTC, and that is a configured choice, not a
    // guess. `resolveZone` keys `guessed` on WHOSE value was used precisely
    // so this account is not slandered.
    accountTimezone = "UTC";
    agencyTimezone = "America/Chicago";
    workRows = [taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    // Named, as every screen now names its zone…
    expect(renderedText(html)).toContain(m["zone.note"].replace("{zone}", "UTC"));
    // …but NOT accused of guessing.
    expect(renderedText(html)).not.toContain(m["zone.guessed.fallback"]);
    expect(renderedText(html)).not.toContain(m["zone.guessed.agency"]);
    expect(renderedText(html)).not.toContain(m["zone.guessed.fix"]);
  });

  it("never offers a CLIENT the Settings link — that route is agency-only (mutation: drop the isAgency branch in ZoneNote -> FAILS)", async () => {
    // Settings is `requireAgencyOnlyAccountAccess`. A client who followed
    // this link would be redirected straight back to their dashboard, so the
    // sentence has to name a person to ask instead.
    accountTimezone = "Not/AZone";
    agencyTimezone = "America/Chicago";
    isAgency = false;
    workRows = [taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );

    expect(renderedText(html)).toContain(m["zone.guessed.client"]);
    expect(renderedText(html)).not.toContain(m["zone.guessed.fix"]);
    expect(html).not.toContain("/settings");
    // The date still renders for a client — the whole point.
    expect(html).toContain("Aug 31, 2026");
  });
});

/**
 * The tray (item 8b-1, spec 4.5): this account's pending suggestions as cards with their actions, never
 * folded into the buckets. Newest 200 with a stated cap, an error state with Retry when a read fails
 * (no longer swallowed to nothing), and every read behind a card on the request client, scoped to the
 * URL's account and bounded.
 */
describe("TasksPage — the Suggestions section (item 8b-1)", () => {
  const T = makeTr("en");
  const render = async () => renderToStaticMarkup(await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }));
  let TasksPage: (typeof import("./page"))["default"];
  const cardsIn = (html: string) => html.match(/<article[^>]*data-suggestion[\s\S]*?<\/article>/g) ?? [];

  beforeEach(async () => {
    ({ default: TasksPage } = await import("./page"));
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = true;
    workRows = [];
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    resetFake();
  });

  it("renders each suggestion as a card with Accept, never a link to the call (spec 4.5)", async () => {
    pendingProposals = [proposal()];
    const html = await render();
    const cards = cardsIn(html);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toContain(">Accept<");
    // The card decides here; its one link to the call is "See it in the transcript" (item 8b-2, spec 5.5),
    // never a link standing in for the buttons.
    const callLinks = cards[0]!.match(/<a[^>]*href="\/dashboard\/accounts\/acct1\/calls\/[^"]*"[^>]*>/g) ?? [];
    expect(callLinks).toHaveLength(1);
    expect(callLinks[0]).toContain("data-transcript-link");
    expect(renderedText(html)).toContain(T.text("suggestions.heading"));
    expect(renderedText(html)).toContain("the caller asked for a callback");
  });

  it("shows the newest 200 and says so when 201 come back (mutation: drop the slice -> 201 cards, FAILS)", async () => {
    pendingProposals = Array.from({ length: 201 }, (_, i) => proposal({ id: `prop-${i}` }));
    const html = await render();
    expect(cardsIn(html)).toHaveLength(200);
    expect(renderedText(html)).toContain("Showing the newest 200.");
  });

  it("states no cap at 200 or fewer", async () => {
    pendingProposals = Array.from({ length: 200 }, (_, i) => proposal({ id: `prop-${i}` }));
    const html = await render();
    expect(cardsIn(html)).toHaveLength(200);
    expect(renderedText(html)).not.toContain("Showing the newest");
  });

  it("asks listPendingProposals for the URL's account only, on the request client", async () => {
    await render();
    expect(listPendingProposalsMock).toHaveBeenCalledTimes(1);
    expect(listPendingProposalsMock).toHaveBeenCalledWith(REQUEST, "acct1");
  });

  it("renders no section when nothing is pending", async () => {
    workRows = [taskRow({ id: "task:1", contactId: null, dueAt: "2099-01-01T12:00:00Z" })];
    const html = await render();
    expect(renderedText(html)).not.toContain(T.text("suggestions.heading"));
    expect(html).not.toContain("data-suggestion");
  });

  it("a failed read is the section's error state with Retry, and the buckets still render (rule 5; mutation: swallow to [] -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    workRows = [taskRow({ id: "task:1", contactId: null, dueAt: "2099-01-01T12:00:00Z" })];
    listPendingProposalsMock.mockRejectedValueOnce(new Error("permission denied for table proposals"));
    const html = await render();
    expect(renderedText(html)).toContain("Couldn't load suggestions.");
    expect(renderedText(html)).toContain(T.text("common.retry"));
    expect(html).toContain("Call about the estimate");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("suggestions read failed"));
    spy.mockRestore();
  });

  it("a failed read with an empty queue shows the error, never 'nothing needs you'", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    listPendingProposalsMock.mockRejectedValueOnce(new Error("boom"));
    const html = await render();
    expect(renderedText(html)).toContain("Couldn't load suggestions.");
    expect(html).not.toContain(m["work.empty"]);
    spy.mockRestore();
  });

  it("a failed calls read is the section's error state too", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    pendingProposals = [proposal()];
    fake.fail.add("calls");
    const html = await render();
    expect(renderedText(html)).toContain("Couldn't load suggestions.");
    expect(html).not.toContain("data-suggestion=");
    spy.mockRestore();
  });

  // The read boundary refuses such a row (parseTaskPayload), but a card the page cannot build is still the
  // section's own failure, never the whole To do page's (final review M-1; the call page already builds
  // its views inside its try). The mock hands the row straight through, as a boundary that missed one would.
  it("a card that cannot be built is the section's error state, and the buckets still render (mutation: build the views after the try -> the page throws a RangeError -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    workRows = [taskRow({ id: "task:1", contactId: null, dueAt: "2099-01-01T12:00:00Z" })];
    pendingProposals = [proposal({ payload: { title: "Call back", dueAt: "next week" } } as Partial<Proposal>)];
    const html = await render();
    expect(renderedText(html)).toContain("Couldn't load suggestions.");
    expect(html).not.toContain("data-suggestion=");
    expect(html).toContain("Call about the estimate");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("suggestions could not be shown"));
    spy.mockRestore();
  });

  it("never claims the queue is clear when a suggestion is pending", async () => {
    pendingProposals = [proposal()];
    const html = await render();
    expect(html).not.toContain(m["work.empty"]);
    expect(cardsIn(html)).toHaveLength(1);
  });

  // A real bucketed task sits beside a distinct suggestion; the waiting section's own HTML carries
  // exactly its one row and no card (spec 8.1). The section regex stops at the first </section>, so a
  // card rendered INSIDE a bucket's section lands in `waitingSection` and fails the second line.
  it("keeps suggestions out of the buckets (mutation: render the section inside a bucket's <section> -> FAILS)", async () => {
    workRows = [taskRow({ id: "task:1", contactId: null, dueAt: "2099-01-01T12:00:00Z" })];
    pendingProposals = [proposal({
      id: "prop-unique", payload: { title: "UNIQUE_TASK_TITLE_5678", dueAt: null }, evidence: "UNIQUE_CALLER_QUOTE_1234",
    })];
    const html = await render();
    const waitingSection = html.match(/<section data-bucket="waiting"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect((waitingSection.match(/<li[ >]/g) ?? []).length).toBe(1);
    expect(waitingSection).not.toContain("data-suggestion");
    expect(waitingSection).not.toContain("UNIQUE_CALLER_QUOTE_1234");
    expect(html).toContain("UNIQUE_TASK_TITLE_5678");
    expect(html).toContain("UNIQUE_CALLER_QUOTE_1234");
  });

  describe("every read behind a card: the URL's account only, exactly the rows' ids, bounded (plan fix I-5)", () => {
    const TASK = () => proposal({ id: "prop-task", callId: "call-1", contactId: null });
    const STAGE = () => proposal({
      id: "prop-stage", callId: "call-1", contactId: null, kind: "opportunity_stage",
      payload: { opportunityId: "opp-1", fromStageId: "st-a", toStageId: "st-b" }, evidence: "move it along",
    });
    // Both accounts hold rows with the SAME ids. Where the read is limited, acct2's row comes first (a
    // lost filter draws it); where a map is built last-wins, acct2's row comes last (a lost filter
    // overwrites with it). A lost filter on the persona's single-row read reads two rows and errors.
    beforeEach(() => {
      pendingProposals = [TASK(), STAGE()];
      fake.tables = {
        voice_profiles: [
          { account_id: "acct2", persona_name: "Other Persona" },
          { account_id: "acct1", persona_name: "Lupe" },
        ],
        calls: [
          { id: "call-1", account_id: "acct2", started_at: "2026-10-20T15:00:00Z", contact_id: "ct-1" },
          { id: "call-1", account_id: "acct1", started_at: "2026-10-14T15:00:00Z", contact_id: "ct-1" },
        ],
        contacts: [
          { id: "ct-1", account_id: "acct1", first_name: "Ana", last_name: "López" },
          { id: "ct-1", account_id: "acct2", first_name: "Other", last_name: "Person" },
        ],
        opportunities: [
          { id: "opp-1", account_id: "acct2", pipeline_id: "pipe-2" },
          { id: "opp-1", account_id: "acct1", pipeline_id: "pipe-1" },
        ],
        pipeline_stages: [
          { id: "st-a", account_id: "acct1", pipeline_id: "pipe-1", name: "New", position: 0 },
          { id: "st-b", account_id: "acct1", pipeline_id: "pipe-1", name: "Quote sent", position: 1 },
          { id: "st-c", account_id: "acct1", pipeline_id: "pipe-1", name: "Won", position: 2 },
          { id: "st-a", account_id: "acct2", pipeline_id: "pipe-1", name: "Other Co stage", position: 0 },
          { id: "st-b", account_id: "acct2", pipeline_id: "pipe-1", name: "Other Co stage", position: 1 },
          { id: "st-x", account_id: "acct2", pipeline_id: "pipe-2", name: "Other Co stage", position: 0 },
        ],
      };
    });

    it("the persona: this account's voice profile (mutation: drop its account filter -> FAILS)", async () => {
      const text = renderedText(await render());
      expect(readsOf("voice_profiles")[0]?.eq).toContainEqual(["account_id", "acct1"]);
      expect(text).toContain("Lupe · AI");
      expect(text).not.toContain("Other Persona");
    });

    it("a failed persona read costs the name only (Sofía), never the section", async () => {
      fake.fail.add("voice_profiles");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      const html = await render();
      expect(renderedText(html)).toContain("Sofía · AI");
      expect(cardsIn(html)).toHaveLength(2);
      spy.mockRestore();
    });

    it("the calls behind the rows: this account's call, for exactly the rows' call ids (mutation: drop its account filter -> FAILS)", async () => {
      const text = renderedText(await render());
      const [calls] = readsOf("calls");
      expect(calls?.eq).toContainEqual(["account_id", "acct1"]);
      expect(calls?.in).toEqual([["id", ["call-1"]]]);
      expect(calls?.limit).toBe(1);
      expect(text).toContain("From the call on Wed, Oct 14 · Ana López");
      expect(text).not.toContain("Oct 20");
    });

    it("the caller names: this account's contacts, for the calls' contact ids (mutation: drop its account filter -> FAILS)", async () => {
      const text = renderedText(await render());
      const [contacts] = readsOf("contacts");
      expect(contacts?.eq).toContainEqual(["account_id", "acct1"]);
      expect(contacts?.in).toEqual([["id", ["ct-1"]]]);
      expect(text).toContain("Ana López");
      expect(text).not.toContain("Other Person");
    });

    it("the deals behind stage suggestions: this account's, for exactly the rows' deal ids (mutation: drop its account filter -> FAILS)", async () => {
      const text = renderedText(await render());
      const [deals] = readsOf("opportunities");
      expect(deals?.eq).toContainEqual(["account_id", "acct1"]);
      expect(deals?.in).toEqual([["id", ["opp-1"]]]);
      expect(deals?.limit).toBe(1);
      expect(text).toContain(T.text("suggestions.stage", { from: "New", to: "Quote sent" }));
      expect(text).not.toContain("Other Co stage");
    });

    it("the stage lists: this account's, the whole pipeline of each deal (mutation: drop its account filter -> FAILS)", async () => {
      const text = renderedText(await render());
      const [stages] = readsOf("pipeline_stages");
      expect(stages?.eq).toContainEqual(["account_id", "acct1"]);
      expect(stages?.in).toEqual([["pipeline_id", ["pipe-1"]]]);
      expect(stages?.limit).toBe(500);
      expect(text).toContain(T.text("suggestions.stage", { from: "New", to: "Quote sent" }));
      expect(text).not.toContain("Other Co stage");
    });
  });
});

// F-085 part 1 (spec §8-§9): Mine / Unassigned on To do, filtered on the
// server by listAccountWork.
describe("TasksPage — ?who= (Mine / Unassigned)", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = false;
    role = "staff";
    workRows = [];
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    resetFake();
    listAccountWorkMock.mockClear();
    readPersonIdMock.mockClear();
    listAccountTeamMock.mockClear();
  });
  afterEach(() => {
    isAgency = true;
    role = null;
  });
  async function render(searchParams: Record<string, string>) {
    const { default: TasksPage } = await import("./page");
    return renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve(searchParams) }),
    );
  }

  it("who=mine asks listAccountWork for the caller's own work (mutation: drop the assignee -> FAILS)", async () => {
    await render({ who: "mine" });
    expect(readPersonIdMock).toHaveBeenCalledWith(expect.anything(), "acct1", "user_1");
    expect(listAccountWorkMock).toHaveBeenCalledWith(expect.anything(), "acct1", { assignee: { who: "mine", userId: "p-me" } });
  });

  it("who=unassigned asks for Unassigned work, and no who is All", async () => {
    await render({ who: "unassigned" });
    expect(listAccountWorkMock).toHaveBeenLastCalledWith(expect.anything(), "acct1", { assignee: { who: "unassigned" } });
    await render({});
    expect(listAccountWorkMock).toHaveBeenLastCalledWith(expect.anything(), "acct1", { assignee: undefined });
  });

  it("Staff: the team is read for the task picker", async () => {
    await render({});
    expect(listAccountTeamMock).toHaveBeenCalledWith(expect.anything(), "acct1");
  });

  it("a Technician: no filter (RLS already makes the queue theirs), no team read, no users read (mutation: pass the filter for everyone -> FAILS)", async () => {
    role = "technician";
    await render({ who: "unassigned" });
    expect(listAccountWorkMock).toHaveBeenCalledWith(expect.anything(), "acct1", { assignee: undefined });
    expect(listAccountTeamMock).not.toHaveBeenCalled();
    expect(readPersonIdMock).not.toHaveBeenCalled();
  });

  it("the page still renders with no searchParams at all (older callers)", async () => {
    const { default: TasksPage } = await import("./page");
    await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) });
    expect(listAccountWorkMock).toHaveBeenCalledWith(expect.anything(), "acct1", { assignee: undefined });
  });
});

// F-085 part 1 (spec §9, Task 7): To do's assignee picker, its filter row
// and the filtered empty states.
describe("WorkList — Assigned to on task rows (F-085)", () => {
  const ANA = { userId: "11111111-1111-4111-8111-111111111111", label: "Ana Ruiz", role: "staff" as const };
  const list = (rows: WorkRow[], canAssign: boolean) => {
    taskFieldProps.length = 0;
    return renderToStaticMarkup(createElement(WorkList, {
      buckets: bucketWork(rows, NOW, ZONE), accountId: ACCOUNT_ID, contactNames: {}, timezone: ZONE, tr: makeTr("en"),
      canAssign, members: [ANA],
    }));
  };
  const rowOf = (html: string, text: string) => html.split("<li").slice(1).find((r) => r.includes(text)) ?? "";

  it("a task row hands TaskAssigneeField the task's RAW id, this account, its holder and the team (fix round 1, I3; mutation: taskId={row.id} -> FAILS)", () => {
    list([taskRow({ id: "task:t1", assigneeId: ANA.userId })], true);
    expect(taskFieldProps).toHaveLength(1);
    expect(taskFieldProps[0]).toMatchObject({ accountId: ACCOUNT_ID, taskId: "t1", value: ANA.userId, options: [ANA] });
  });

  it("an unassigned task hands value null, never undefined", () => {
    list([taskRow({ id: "task:t1", assigneeId: null })], true);
    expect(taskFieldProps[0]!.value).toBeNull();
  });

  it("without canAssign (a Technician) no row carries a picker (mutation: render it for everyone -> FAILS)", () => {
    list([taskRow({ id: "task:t1", assigneeId: ANA.userId })], false);
    expect(taskFieldProps).toHaveLength(0);
  });

  it("a conversation or booking row carries none: their holder is the customer's, set on the customer", () => {
    list([conversationRow(), bookingRow()], true);
    expect(taskFieldProps).toHaveLength(0);
  });

  it("the picker sits outside the row's link: a control inside an <a> is invalid and ambiguous", () => {
    const r = rowOf(list([taskRow({ id: "task:t1", assigneeId: ANA.userId })], true), "Call about the estimate");
    const picker = r.indexOf('data-task-assignee="t1"');
    expect(picker).toBeGreaterThan(-1);
    expect(picker).toBeGreaterThan(r.indexOf("</a>"));
  });
});

// Final review, Task 8: WorkList's `tr` has no silent English default. The guard is the type checker's:
// were `tr` optional again, this directive would be unused and `pnpm --filter web typecheck` FAILS.
void (() =>
  // @ts-expect-error tr is required: the Suggestions section's words are the reader's, never a default
  createElement(WorkList, { buckets: bucketWork([], new Date(0), "UTC"), accountId: "a1", contactNames: {}, timezone: "UTC" }));

describe("WorkList — filtered empty states (F-085)", () => {
  const empty = (who: "all" | "mine" | "unassigned") => renderToStaticMarkup(createElement(WorkList, {
    buckets: bucketWork([], NOW, ZONE), accountId: ACCOUNT_ID, contactNames: {}, timezone: ZONE, tr: makeTr("en"), who,
  }));

  it("an empty Mine says nothing is assigned to you yet (mutation: always 'Nothing needs you' -> FAILS)", () => {
    const html = empty("mine");
    expect(html).toContain(m["assign.empty.mine"]);
    expect(html).not.toContain(m["work.empty"]);
  });

  it("an empty Unassigned says everything has someone", () => {
    expect(renderedText(empty("unassigned"))).toContain(m["assign.empty.unassignedWork"]);
  });

  it("All keeps the queue's own empty sentence", () => {
    expect(empty("all")).toContain(m["work.empty"]);
  });
});

describe("TasksPage — the All · Mine · Unassigned row (F-085)", () => {
  const NAV = `aria-label="${m["assign.filter.label"]}"`;
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = false;
    workRows = [];
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    resetFake();
  });
  afterEach(() => {
    isAgency = true;
    role = null;
  });
  async function render(searchParams: Record<string, string>) {
    const { default: TasksPage } = await import("./page");
    return renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve(searchParams) }),
    );
  }

  it("Staff get the filter row, the current filter marked, its links back to this page (mutation: render it for nobody -> FAILS)", async () => {
    role = "staff";
    const html = await render({ who: "mine" });
    expect(html).toContain(NAV);
    const current = (html.match(/<a\b[^>]*aria-current="page"[^>]*>/g) ?? []);
    expect(current).toHaveLength(1);
    expect(current[0]).toContain(`href="/dashboard/accounts/acct1/tasks?who=mine"`);
    expect(html).toContain('href="/dashboard/accounts/acct1/tasks"');
  });

  it("an empty Mine reaches the list as its own empty state, under the filter row", async () => {
    role = "staff";
    const html = await render({ who: "mine" });
    expect(html).toContain(m["assign.empty.mine"]);
  });

  it("a Technician gets no filter row (mutation: render it for everyone -> FAILS)", async () => {
    role = "technician";
    expect(await render({})).not.toContain(NAV);
  });
});

// Task 12 (S-06 part 1): the page's own read of the inbox's "Needs a look"
// count, threaded into WorkList's own row.
describe("TasksPage — the held-emails row (Task 12)", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = true;
    role = null;
    workRows = [];
    pendingProposals = [];
    heldEmailsCount = 0;
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    resetFake();
  });
  afterEach(() => {
    heldEmailsCount = 0;
  });

  it("a held count above zero reaches WorkList as its own row (mutation: drop heldEmails from the WorkList call -> FAILS)", async () => {
    heldEmailsCount = 3;
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    expect(html).toContain("data-held-emails-row");
    expect(html).toContain(`href="/dashboard/accounts/acct1/conversations?view=held"`);
    expect(renderedText(html)).toContain("3 emails need a look");
  });

  it("a held count of zero renders no row at all", async () => {
    heldEmailsCount = 0;
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    expect(html).not.toContain("data-held-emails-row");
  });

  it("a failed count read omits the row rather than taking the page down (rule 5; mutation: let the throw escape -> FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    heldEmailsCount = null;
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    expect(html).not.toContain("data-held-emails-row");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("held count read failed"));
    spy.mockRestore();
  });
});

describe("the To do route's loading skeleton (rule 7, plan fix M5)", () => {
  it("carries the Suggestions skeleton under the bucket skeleton, inside the one aria-busy region", async () => {
    const { default: Loading } = await import("./loading");
    const html = renderToStaticMarkup(createElement(Loading));
    const busy = html.slice(html.indexOf('aria-busy="true"'));
    expect(html.indexOf('aria-busy="true"')).toBeGreaterThanOrEqual(0);
    expect((busy.match(/data-skeleton/g) ?? []).length).toBe(2);
    expect(renderedText(busy)).toContain(makeTr("en").text("suggestions.loading"));
  });

  // Final review, Task 8: the slice above runs to the END of the markup, so a Suggestions skeleton moved
  // outside the busy region, or above the bucket's, still passed it. This cuts the busy <div> out by its
  // own nesting and reads the order inside it.
  it("the Suggestions skeleton is INSIDE the aria-busy <div>, after the bucket skeleton (mutations: render it after the busy div -> FAILS; above the bucket -> FAILS)", async () => {
    const { default: Loading } = await import("./loading");
    const html = renderToStaticMarkup(createElement(Loading));
    const start = html.lastIndexOf("<div", html.indexOf('aria-busy="true"'));
    let depth = 0;
    let end = start;
    for (const m of html.slice(start).matchAll(/<div\b|<\/div>/g)) {
      depth += m[0] === "</div>" ? -1 : 1;
      if (depth === 0) { end = start + m.index! + m[0].length; break; }
    }
    const region = html.slice(start, end);
    const bucket = region.indexOf("rounded-xl border border-border");
    const suggestions = region.indexOf("data-skeleton");
    expect([bucket >= 0, suggestions >= 0]).toEqual([true, true]);
    expect(suggestions).toBeGreaterThan(bucket);
    expect((region.match(/data-skeleton/g) ?? []).length).toBe(2);
  });
});

/**
 * The tray grouped (item 8b-2, spec 5.1): by customer (the ROW's contact_id, P14's customer), then by call,
 * groups ordered by their newest card, "No customer yet" for a row with no customer. The customer's name
 * comes from the page's one contacts batch, which must hold every row's OWN contactId, not only the call's.
 */
describe("TasksPage — the tray grouped by customer, then call (item 8b-2)", () => {
  const render = async () => renderToStaticMarkup(await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }));
  let TasksPage: (typeof import("./page"))["default"];
  const headings = (html: string) => [...html.matchAll(/<h3[^>]*>([^<]*)<\/h3>/g)].map((x) => renderedText(x[1]!));

  beforeEach(async () => {
    ({ default: TasksPage } = await import("./page"));
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = true;
    workRows = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    resetFake();
    fake.tables = {
      calls: [
        { id: "call-ana", account_id: "acct1", started_at: "2026-10-14T15:00:00Z", contact_id: "ct-ana" },
        { id: "call-luis", account_id: "acct1", started_at: "2026-10-13T15:00:00Z", contact_id: "ct-luis" },
        { id: "call-anon", account_id: "acct1", started_at: "2026-10-12T15:00:00Z", contact_id: null },
      ],
      contacts: [
        { id: "ct-ana", account_id: "acct1", first_name: "Ana", last_name: "López" },
        { id: "ct-luis", account_id: "acct1", first_name: "Luis", last_name: "Peña" },
        { id: "ct-rosa", account_id: "acct1", first_name: "Rosa", last_name: "Díaz" },
      ],
    };
  });

  it("two customers and a no-customer row: three headings, newest group first, each over its own cards (mutation: order groups by oldest -> FAILS)", async () => {
    // The read's order is newest first; the no-customer row is the newest of all.
    pendingProposals = [
      proposal({ id: "p-anon", callId: "call-anon", contactId: null, createdAt: "2026-10-15T10:00:00Z" }),
      proposal({ id: "p-ana-2", callId: "call-ana", contactId: "ct-ana", createdAt: "2026-10-14T16:00:00Z" }),
      proposal({ id: "p-luis", callId: "call-luis", contactId: "ct-luis", createdAt: "2026-10-13T16:00:00Z" }),
      proposal({ id: "p-ana-1", callId: "call-ana", contactId: "ct-ana", createdAt: "2026-10-14T15:30:00Z" }),
    ];
    const html = await render();
    expect(headings(html)).toEqual([
      "No customer yet · from the call on Mon, Oct 12",
      "Ana López · from the call on Wed, Oct 14",
      "Luis Peña · from the call on Tue, Oct 13",
    ]);
    // Ana's two cards sit under Ana's heading, in the read's order.
    expect(html).toMatch(/Ana López · from the call on Wed, Oct 14<\/h3><article[^>]*data-suggestion="p-ana-2"[\s\S]*?<\/article><article[^>]*data-suggestion="p-ana-1"/);
  });

  it("the group names the row's own customer even when the call's caller is someone else (mutation: drop the rows' contactId from the contacts batch -> \"(no name)\", FAILS)", async () => {
    // The call was Ana's line; the suggestion is about Rosa (contact_id), whom nothing else on the page names.
    pendingProposals = [proposal({ id: "p-rosa", callId: "call-ana", contactId: "ct-rosa", createdAt: "2026-10-14T16:00:00Z" })];
    const html = await render();
    expect(headings(html)).toEqual(["Rosa Díaz · from the call on Wed, Oct 14"]);
    expect(readsOf("contacts")).toHaveLength(1);
    expect(readsOf("contacts")[0]!.in[0]![1]).toEqual(expect.arrayContaining(["ct-ana", "ct-rosa"]));
  });

  it("Spanish (the QA override): the heading in the reader's words, the day as the card formats it", async () => {
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      pendingProposals = [proposal({ id: "p-anon", callId: "call-anon", contactId: null })];
      const html = renderToStaticMarkup(await TasksPage({
        params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ locale: "es" }),
      }));
      const { callDay } = await import("@/lib/proposals/view");
      expect(headings(html)).toEqual([`Sin cliente todavía · de la llamada del ${callDay("es", "America/Chicago", "2026-10-12T15:00:00Z")}`]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

// F-085 follow-up (Task B): the page title, the bucket chips/headings, the
// row's own sentence and the empty states now read the reader's own language
// (requestLocale) instead of a bare m[...] English lookup — the QA override
// is the same mechanism the suite above already proves works end to end.
describe("TasksPage in Spanish (requestLocale; F-085 follow-up, Task B)", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = true;
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    resetFake();
  });

  async function renderEs(rows: WorkRow[], searchParams: Record<string, string> = {}) {
    workRows = rows;
    vi.stubEnv("BIS_I18N_QA", "1");
    vi.stubEnv("VERCEL", "");
    try {
      const { default: TasksPage } = await import("./page");
      return renderToStaticMarkup(await TasksPage({
        params: Promise.resolve({ accountId: "acct1" }), searchParams: Promise.resolve({ locale: "es", ...searchParams }),
      }));
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it("the page title, the bucket heading and the row's own sentence all read Spanish, with lang set (mutation: wrap the page in no LocaleProvider, or leave work-list.tsx's tr.text calls as bare m[...] -> FAILS)", async () => {
    // Safely in the past no matter when this test runs — a real "overdue" bucket, not "waiting".
    const html = await renderEs([taskRow({ id: "task:1", contactId: null, dueAt: "2020-01-01T12:00:00Z" })]);
    expect(html).toMatch(/<div lang="es"/);
    expect(html).toContain(">Pendientes<");
    expect(html).toContain(">Atrasado<");
  });

  it("the zone line names the zone in Spanish (F-085 follow-ups, design I3; mutation: drop locale from the page's <ZoneNote> -> FAILS)", async () => {
    const html = await renderEs([taskRow({ id: "task:1", contactId: null, dueAt: "2020-01-01T12:00:00Z" })]);
    expect(html).toContain("Las horas se muestran en America/Chicago");
    expect(html).not.toContain("Times shown in");
  });

  it("the Mine-filter empty state reads Spanish too (mutation: pass EmptyState an English title regardless of locale -> FAILS)", async () => {
    role = "staff";
    const html = await renderEs([], { who: "mine" });
    expect(html).toContain(m["assign.empty.mine.es"]);
    role = null;
  });

  it("a derived conversation row's sentence interpolates the contact's name in Spanish (mutation: hard-code tr's locale to 'en' in primaryLabel -> FAILS)", async () => {
    const row: WorkRow = {
      id: "conversation:1", source: "conversation", accountId: "acct1", contactId: "ct-ana",
      title: "", dueAt: null, occurredAt: "2026-10-05T10:00:00Z",
    };
    fake.tables = { contacts: [{ id: "ct-ana", account_id: "acct1", first_name: "Ana", last_name: "López" }] };
    const html = await renderEs([row]);
    expect(html).toContain("Responder a Ana López");
  });
});

describe("TasksPage — a To-do on a shared number's holding record (S-47e P19; T17 review M9)", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    agencyTimezone = "America/Chicago";
    isAgency = true;
    pendingProposals = [];
    listPendingProposalsMock.mockReset().mockImplementation(async () => pendingProposals);
    resetFake();
    fake.tables = {
      contacts: [
        { id: "ct-hold", account_id: "acct1", first_name: "Caller", last_name: null, phone: "+19565550142", holds_shared_number: true },
        { id: "ct-ana", account_id: "acct1", first_name: "Ana", last_name: "López", phone: "+19565550142", holds_shared_number: false },
      ],
    };
  });

  it("names the number, never \"Caller\"; a customer's row keeps their name (mutation: contactDisplayName for every row -> \"Caller\", FAILS)", async () => {
    workRows = [
      taskRow({ id: "task:hold", contactId: "ct-hold", title: "A reply from a shared number couldn't be matched to one appointment", dueAt: "2099-01-01T12:00:00Z" }),
      taskRow({ id: "task:ana", contactId: "ct-ana", title: "Call Ana back", dueAt: "2099-01-01T12:00:00Z" }),
    ];
    const { default: TasksPage } = await import("./page");
    const text = renderedText(renderToStaticMarkup(await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) })));
    expect(text).toContain("Shared number (956) 555-0142");
    expect(text).toContain("Ana López");
    expect(text).not.toMatch(/\bCaller\b/);
  });
});

describe("the To do route's loading skeleton: the tray is grouped (item 8b-2)", () => {
  it("a group heading's label bar sits above the skeleton cards, never a card around them (mutation: drop grouped -> FAILS)", async () => {
    const { default: Loading } = await import("./loading");
    const html = renderToStaticMarkup(createElement(Loading));
    const bar = html.indexOf("data-tray-group-bar");
    expect(bar).toBeGreaterThanOrEqual(0);
    expect(bar).toBeLessThan(html.indexOf("data-skeleton"));
    expect((html.match(/data-skeleton=/g) ?? []).length).toBe(2);
  });
});
