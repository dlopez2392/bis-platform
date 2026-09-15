import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkRow } from "@bis/db";
import { bucketWork, type BucketedWork } from "@/lib/work/buckets";
import { m } from "@/lib/messages";
import { visibleBuckets, WorkList } from "./work-list";

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
    expect(html).toContain(m["work.bucket.waiting"]);
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
  });
});
