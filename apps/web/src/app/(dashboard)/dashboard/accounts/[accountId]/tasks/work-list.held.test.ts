import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

vi.mock("./actions", () => ({
  completeWorkTask: vi.fn(), reopenWorkTask: vi.fn(), dismissToTask: vi.fn(), closeOutBooking: vi.fn(),
  confirmStopFromTask: vi.fn(), notAStopFromTask: vi.fn(), undoHoldDecisionFromTask: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { WorkList } = await import("./work-list");

// Mirrors work-list.consent.test.ts's own minimal props, but with every
// bucket empty — the count:3 case below proves the held row renders ABOVE
// the empty state rather than being swallowed by it.
const EMPTY_PROPS = {
  buckets: { overdue: [], today: [], waiting: [] }, accountId: "a1", contactNames: {}, timezone: "America/Chicago",
};

describe("the To do row (spec 'Needs a look')", () => {
  it("N > 0: one row 'N emails need a look' linking to the filter; 1 reads singular; Spanish (mutation: use the plural key for 1 → FAILS)", () => {
    const render = (count: number, locale: "en" | "es") => renderToStaticMarkup(createElement(WorkList, { ...EMPTY_PROPS, heldEmails: { count, href: "/dashboard/accounts/a/conversations?view=held", locale } }));
    const three = render(3, "en");
    expect(three.match(/data-held-emails-row/g)).toHaveLength(1);
    expect(three).toContain('href="/dashboard/accounts/a/conversations?view=held"');
    expect(renderedText(three)).toContain("3 emails need a look");
    expect(renderedText(render(1, "en"))).toContain("1 email needs a look");
    expect(renderedText(render(3, "es"))).toContain("3 correos por revisar");
  });

  it("N = 0 or unknown: no row (mutation: render at 0 → FAILS)", () => {
    expect(renderToStaticMarkup(createElement(WorkList, { ...EMPTY_PROPS, heldEmails: { count: 0, href: "x", locale: "en" } }))).not.toContain("data-held-emails-row");
    expect(renderToStaticMarkup(createElement(WorkList, EMPTY_PROPS))).not.toContain("data-held-emails-row");
  });
});
