import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkRow } from "@bis/db";
import { bucketWork, type BucketedWork } from "@/lib/work/buckets";
import { m } from "@/lib/messages";
import { visibleBuckets, WorkList } from "./work-list";

// --- Mocks for the TasksPage composition tests below (the "zone reaches the
// page" and "rethrow" findings need the whole route, not just WorkList in
// isolation). Same shape as calls/page.test.ts's mocks: the auth gate and the
// DB entry points this async server component actually reaches, rather than
// exercising Clerk/Supabase for what is a "which value reaches render" bug.
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));

/** Mutable so each test can pick the account's own (possibly invalid) zone
 *  without a fresh `vi.mock` per test — assigned in `beforeEach` before the
 *  dynamic `import("./page")` below ever resolves this factory. */
let accountTimezone = "America/Chicago";
vi.mock("@/lib/db", () => ({
  dbForRequest: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { timezone: accountTimezone }, error: null }),
          // The contacts lookup shares this same chain shape in page.tsx;
          // unused by the tests below (they use contactId: null rows), kept
          // here only so the shape matches if that ever changes.
          in: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  }),
}));

let workRows: WorkRow[] = [];
vi.mock("@bis/db", () => ({
  listAccountWork: async () => workRows,
}));

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
    createElement(WorkList, { buckets, accountId: ACCOUNT_ID, contactNames, timezone }),
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

describe("TasksPage — the account's zone reaches every rendered date", () => {
  beforeEach(() => {
    accountTimezone = "America/Chicago";
    workRows = [];
  });

  it("never falls back to UTC for the account's own invalid zone — the date is omitted, not guessed", async () => {
    // The finding this pins: `safeZone(account.timezone, "UTC")` in page.tsx
    // substituted "UTC" before the row's own date text ever got a chance to
    // decline, printing a confident "Sep 1, 2026" in a zone nobody chose. The
    // raw invalid zone, unclamped, makes `formatDateInZone` throw and
    // `rowDateText` decline instead — no date text for this row at all.
    accountTimezone = "Not/AZone";
    workRows = [taskRow({ contactId: null, dueAt: "2026-09-01T00:00:00Z" })];
    const { default: TasksPage } = await import("./page");
    const html = renderToStaticMarkup(
      await TasksPage({ params: Promise.resolve({ accountId: "acct1" }) }),
    );
    // bucketWork's own degrade: still visible, every row waits.
    expect(html).toContain(m["work.bucket.waiting"]);
    expect(html).not.toMatch(/Sep \d{1,2}, 2026/);
  });
});
