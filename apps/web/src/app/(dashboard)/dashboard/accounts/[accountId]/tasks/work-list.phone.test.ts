import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { makeTr } from "@/lib/record/copy";
import type { WorkRow } from "@bis/db";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

const task: WorkRow = {
  id: "task:t1", source: "task", accountId: "a1", contactId: "c1", title: "Call back about the roof leak",
  dueAt: "2026-10-16T17:00:00Z", occurredAt: "2026-10-16T17:00:00Z", consent: null, callId: null,
};

/** The class list of the first element carrying `attr`, split into tokens. */
function classesOf(html: string, attr: string): string[] {
  // `\s${attr}` then `=`, space or `>`: `data-work-row` must not match `data-work-row-link`.
  const tag = html.match(new RegExp(`<[a-z]+[^>]*\\s${attr}(?=[\\s>=])[^>]*>`))?.[0];
  expect(tag, `no element carries ${attr}`).toBeTruthy();
  return (tag!.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
}

// The owner's phone screenshot (production, ~390px, 2026-10-20): the row was
// one non-wrapping flex line, the Link's title span `min-w-0 flex-1 truncate`
// beside two `shrink-0` siblings (chip, date) INSIDE a Link that may itself
// shrink to `min-w-0` — so at phone width the title shrank to zero and the
// chip and date overflowed the Link onto the assignee picker beside it. These
// pin the stacking classes at the narrow breakpoint and the desktop reset at
// `md:` (the assignee trigger's own `min-h-11 md:min-h-8` breakpoint).
describe("the To do row at phone width (stacks, nothing overlaps)", () => {
  const html = renderToStaticMarkup(createElement(WorkList, {
    buckets: { overdue: [task], today: [], waiting: [] }, accountId: "a1", contactNames: { c1: "Ana Reyes" },
    timezone: "America/Chicago", tr: makeTr("en"), canAssign: true,
    members: [{ userId: "u1", label: "Dana", role: "owner" }],
  }));

  it("the row wraps below md and stays one line from md up (mutation: drop flex-wrap → FAILS)", () => {
    const li = classesOf(html, "data-work-row");
    expect(li).toContain("flex-wrap");
    expect(li).toContain("md:flex-nowrap");
  });

  it("the link takes the whole first line below md, its own content wraps too", () => {
    const link = classesOf(html, "data-work-row-link");
    expect(link).toContain("basis-full");
    expect(link).toContain("md:basis-0");
    expect(link).toContain("flex-wrap");
    expect(link).toContain("md:flex-nowrap");
  });

  it("the title wraps on a phone instead of truncating to nothing; it truncates only from md up", () => {
    const title = classesOf(html, "data-work-row-title");
    expect(title).not.toContain("truncate");
    expect(title).toContain("md:truncate");
    expect(title).toContain("break-words");
    // Its column takes the link's whole first line on a phone, so the chip and
    // date wrap below it instead of squeezing it (mutation: back to flex-1 → FAILS).
    const text = classesOf(html, "data-work-row-text");
    expect(text).toContain("basis-full");
    expect(text).toContain("md:basis-0");
    expect(text).not.toContain("flex-1");
  });

  it("assignee and Done share the second line, with 44px touch targets below md", () => {
    const actions = classesOf(html, "data-work-row-actions");
    expect(actions).toContain("basis-full");
    expect(actions).toContain("md:basis-auto");
    const done = classesOf(html, "data-work-row-done");
    expect(done).toContain("min-h-11");
    expect(done).toContain("md:min-h-8");
  });
});
