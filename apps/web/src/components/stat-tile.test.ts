// apps/web/src/components/stat-tile.test.ts
//
// Covers the extracted pure predicate behind StatTile's dev-mode rule-1
// throw (hasStatContext) plus component-render coverage for the `hero`
// prop below. Render tests use `createElement` + `renderToStaticMarkup`
// (the repo's convention since Task 4/ground.test.ts), not a DOM harness.
// The throw path itself is screenshot-verified at Task 8 per the brief.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { hasStatContext, StatTile } from "./stat-tile";

describe("hasStatContext", () => {
  it("is false with none of delta/spark/period", () => {
    expect(hasStatContext({})).toBe(false);
  });

  it("is true with only delta", () => {
    expect(hasStatContext({ delta: { direction: "up", label: "12%" } })).toBe(true);
  });

  it("is true with only a non-empty spark", () => {
    expect(hasStatContext({ spark: [1, 2, 3] })).toBe(true);
  });

  it("is false with an empty spark array — no visible trend line is no context", () => {
    expect(hasStatContext({ spark: [] })).toBe(false);
  });

  it("is true with only a period", () => {
    expect(hasStatContext({ period: "All time" })).toBe(true);
  });

  it("is false with an empty-string period", () => {
    expect(hasStatContext({ period: "" })).toBe(false);
  });

  it("is true with all three present", () => {
    expect(
      hasStatContext({ delta: { direction: "flat", label: "0%" }, spark: [1, 2], period: "All time" }),
    ).toBe(true);
  });
});

describe("StatTile hero (spec §5)", () => {
  const render = (hero?: boolean) =>
    renderToStaticMarkup(createElement(StatTile, { label: "Visitors", value: "1,248", delta: { direction: "up", label: "12%" }, hero }));

  it("marks exactly the hero tile with data-hero and the gradient class", () => {
    const html = render(true);
    expect(html).toContain('data-hero="true"');
    expect(html).toMatch(/<p[^>]*data-hero="true"[^>]*class="[^"]*\bhero-text\b/);
    expect(html).not.toMatch(/data-hero="true"[^>]*text-card-foreground/);
  });

  it("a plain tile has no data-hero and stays text-coloured", () => {
    const html = render();
    expect(html).not.toContain("data-hero");
    expect(html).toMatch(/text-card-foreground/);
    expect(html).not.toContain("hero-text");
  });
});
