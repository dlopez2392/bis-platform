import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { SummaryBody } = await import("./summary-card");

describe("SummaryBody (spec §9.2)", () => {
  it("joins the facts with a middle dot", () => {
    const html = renderToStaticMarkup(createElement(SummaryBody, { view: { line: ["On your list since Dec 2025", "Booked once"], missing: null, allFailed: false }, retryLabel: "Try again" }));
    expect(html).toContain("On your list since Dec 2025 · Booked once");
    expect(html).not.toContain("Try again");
  });
  it("names what it could not count, with Try again (mutation: drop the missing line -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(SummaryBody, { view: { line: ["On your list since Dec 2025"], missing: "Couldn't count bookings.", allFailed: false }, retryLabel: "Try again" }));
    expect(html).toContain("Couldn&#x27;t count bookings.");
    expect(html).toContain(">Try again<");
  });
});
