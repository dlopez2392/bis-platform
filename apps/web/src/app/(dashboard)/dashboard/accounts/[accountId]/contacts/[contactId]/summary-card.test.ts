import { describe, it, expect, vi } from "vitest";
import { createElement, isValidElement } from "react";
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
  it("its Try again is the caller's retry when given one: the list's drawer re-reads its route, not the list behind it (S-03 part 3 C4; mutation: drop onRetry from RecordCardRetry -> FAILS)", async () => {
    const { RecordCardRetry } = await import("@/components/record/record-card");
    const onRetry = vi.fn();
    const tree = SummaryBody({ view: { line: [], missing: "Couldn't count bookings.", allFailed: false }, retryLabel: "Try again", onRetry });
    const found: { type: unknown; props: Record<string, unknown> }[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (!isValidElement(n)) return;
      const el = n as unknown as { type: unknown; props: Record<string, unknown> };
      found.push(el);
      walk(el.props.children);
    };
    walk(tree);
    expect(found.find((e) => e.type === RecordCardRetry)?.props.onRetry).toBe(onRetry);
  });
});
