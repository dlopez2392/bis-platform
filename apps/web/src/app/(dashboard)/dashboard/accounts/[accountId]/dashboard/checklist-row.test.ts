import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChecklistRow } from "./checklist-row";

// Same shape as activity-card.test.ts / calls-chart-card.test.ts: a server
// component with no client state is just a function of its props, so
// `renderToStaticMarkup` pins the served output directly.

function render(done: number, total: number, accountId = "acct1") {
  return renderToStaticMarkup(createElement(ChecklistRow, { accountId, done, total }));
}

describe("ChecklistRow", () => {
  it("names the checklist and states the count in plain 'N of M done' terms — no milestone codes", () => {
    const html = render(1, 7);
    expect(html).toContain("Activation checklist");
    expect(html).toContain("1 of 7 done");
    // The exact defect messages.test.ts's own suite exists to catch —
    // nothing here should ever look like an internal roadmap label.
    expect(html).not.toMatch(/\bM\d[a-z]?\b/);
  });

  it("links into the full /checklist route for this account, not a dead end", () => {
    const html = render(3, 7, "acct-xyz");
    expect(html).toContain('href="/dashboard/accounts/acct-xyz/checklist"');
  });

  it("carries the count on the link's own accessible name", () => {
    const html = render(2, 7);
    expect(html).toContain('aria-label="Activation checklist (2 of 7 done)"');
  });

  it("the meter fill reflects the fraction done, on the shared --meter-bg/--accent gradient tokens", () => {
    const html = render(0, 4);
    expect(html).toContain("bg-[var(--meter-bg)]");
    expect(html).toContain("bg-[linear-gradient(90deg,var(--accent),var(--accent-2))]");
    // A themed tenant re-points --accent but not --sidebar-*; this row lives
    // in the content area and must never paint from the sidebar's chrome
    // tokens (meter.tsx's own rule).
    expect(html).not.toContain("--sidebar-accent");
    expect(html).toContain("width:0%");
  });

  it("a fully-done count still renders (page.tsx itself is what gates this branch out at remaining===0)", () => {
    const html = render(7, 7);
    expect(html).toContain("7 of 7 done");
    expect(html).toContain("width:100%");
  });
});
