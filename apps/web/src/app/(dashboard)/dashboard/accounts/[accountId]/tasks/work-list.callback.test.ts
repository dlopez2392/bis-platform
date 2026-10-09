import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WorkRow } from "@bis/db";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

const task = (id: string, title: string, callId: string | null): WorkRow => ({
  id: `task:${id}`, source: "task", accountId: "a1", contactId: "c1", title,
  dueAt: "2026-10-09T17:00:00Z", occurredAt: "2026-10-09T17:00:00Z", consent: null, callId,
});

describe("the callback To do on today's queue (F-033; DESIGN.md provenance)", () => {
  it("a To do a call left carries the receptionist's author mark; one a person typed does not (mutation: mark every task → FAILS; mark none → FAILS)", () => {
    const out = renderToStaticMarkup(createElement(WorkList, {
      buckets: { overdue: [], today: [task("t1", "Call back at 9565061545: Roof leak", "call1"), task("t2", "Order shingles", null)], waiting: [] },
      accountId: "a1", contactNames: { c1: "Ana Reyes" }, timezone: "America/Chicago",
    }));
    const rows = out.split("<li").slice(1);
    const callback = rows.find((r) => r.includes("Roof leak"))!;
    const typed = rows.find((r) => r.includes("Order shingles"))!;
    expect(callback).toContain("Sofía · AI");
    expect(typed).not.toContain("· AI");
    // Still the person's row: the contact name stays beside the mark.
    expect(callback).toContain("Ana Reyes");
  });
});
