import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChangeGroup, ChangeRow, TimelineEntry } from "@bis/db";

/**
 * F-115 PR E fix: the "change" row on the record page's own timeline — wired through `ChangeItem`
 * (unit-tested on its own in `components/record/change-item.test.ts`), plus the page-level concerns
 * that live here instead: the Owner-only download link's own markup and placement (review m1), and
 * that the "change" case is reachable at all from this file's real `Row()` switch.
 */
vi.mock("./actions", () => ({ addNoteAction: vi.fn(), addTaskAction: vi.fn(), completeTaskAction: vi.fn() }));
vi.mock("./message-composer", () => ({ MessageComposer: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { ActivityTimeline } = await import("./activity-timeline");
const { legacyTimeline } = await import("./activity-timeline.fixture");
const { makeTr } = await import("@/lib/record/copy");
const { timelineRows } = await import("@/lib/record/timeline-rows");
const { m } = await import("@/lib/messages");

const AT = "2026-11-02T16:12:00Z";
const changeRow = (over: Partial<ChangeRow> = {}): ChangeRow => ({
  id: 1, recordType: "contact", recordId: "c1", contactId: "c1", clientGroupId: null,
  op: "update", field: "phone", before: "+19565550111", after: "+19565550112", xact: "1",
  authorKind: "person", authorId: "user_1", via: null, createdAt: AT,
  ...over,
});
function changeEntry(): TimelineEntry {
  const row = changeRow();
  const group: ChangeGroup = {
    key: "contact:c1:1", recordType: "contact", recordId: "c1", authorKind: "person", authorId: "user_1",
    via: null, at: AT, firstAt: AT, steps: [[row]], rows: [row],
  };
  return { kind: "change", id: "00000000-0000-0000-0000-000000000001", at: AT, contactId: "c1", group };
}

function render(over: Record<string, unknown> = {}) {
  const tr = makeTr("en");
  const rows = timelineRows([changeEntry()], {
    zone: "America/Chicago", tr, author: { viewerId: null, names: { user_1: "Ana García" }, personaName: null, tr },
  });
  const base = legacyTimeline({
    accountId: "a1", contactId: "c1", timezone: "America/Chicago", locale: "en",
    emailAction: async () => {}, smsAction: async () => {},
    canWriteHistory: true, nowMs: Date.parse(AT),
    putBackHistory: async () => ({ ok: false as const, message: "" }),
    restoreHistory: async () => ({ ok: false as const, message: "" }),
    ...over,
  });
  return renderToStaticMarkup(createElement(ActivityTimeline, { ...base, rows, emptyText: null } as never));
}

describe("ActivityTimeline: the \"change\" row reaches ChangeItem (F-115 PR E)", () => {
  it("renders the change row with its own mark and verb (mutation: keep the dormant 'return null' for \"change\" -> FAILS)", () => {
    const html = render();
    expect(html).toContain('data-timeline-item="change"');
    expect(html).toContain("changed phone");
  });
});

describe("ActivityTimeline: the Owner-only download link (review m1)", () => {
  it("is a plain anchor with `download`, never a Next Link, and sits OUTSIDE the \"Pages\" pager nav (mutation: put it back inside data-timeline-pager -> FAILS)", () => {
    const html = render({ historyDownloadHref: "/dashboard/accounts/a1/contacts/c1/history" });
    const link = /<a[^>]*data-history-download[^>]*>[^<]*<\/a>/.exec(html)?.[0];
    expect(link).toBeDefined();
    expect(link).toContain('href="/dashboard/accounts/a1/contacts/c1/history"');
    expect(link).toMatch(/\bdownload(="")?[\s>]/); // a boolean HTML attribute, not a styled prefetching Link
    expect(link).toContain(m["history.download"]);
    // Not inside the pager's own <nav data-timeline-pager>: the download anchor must appear BEFORE it
    // in document order whenever both exist (there is no pager here, so this just proves no overlap).
    expect(html.indexOf("data-history-download")).toBeGreaterThan(-1);
    const pagerStart = html.indexOf("data-timeline-pager");
    if (pagerStart !== -1) {
      expect(html.indexOf("data-history-download")).toBeLessThan(pagerStart);
    }
  });

  it("is absent when historyDownloadHref is null (a Technician, Staff, or an agency reader who is not the Owner) (mutation: always render the link -> FAILS)", () => {
    const html = render({ historyDownloadHref: null });
    expect(html).not.toContain("data-history-download");
  });
});
