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

  it("both tiles speak the display role at DESIGN.md's KPI size — 30px/600, -.03em", () => {
    // The size was never pinned, so the one number DESIGN.md sizes explicitly
    // ("KPI numbers (30px, -.03em)") could drift on either tile without a
    // failure. Hero and plain must match: the gradient is the only difference
    // between them.
    for (const html of [render(true), render()]) {
      expect(html).toMatch(/font-display text-\[30px\] leading-none font-\[600\] tracking-\[-0\.03em\] tabular-nums/);
    }
  });

  it("a plain tile has no data-hero and stays text-coloured", () => {
    const html = render();
    expect(html).not.toContain("data-hero");
    expect(html).toMatch(/text-card-foreground/);
    expect(html).not.toContain("hero-text");
  });
});

// I7 (whole-branch review): the delta's worded sentence — the sr-only twin
// of the ▲/▼ chip — is catalogue copy with .es twins, rendered through t()
// in the tile's locale. English stays the default so every other StatTile
// (Website, the agency dashboard, the styleguide) is unchanged.
describe("StatTile delta wording follows the locale (I7)", () => {
  const html = (locale: "en" | "es" | undefined, direction: "up" | "down" | "flat") =>
    renderToStaticMarkup(createElement(StatTile, { label: "x", value: "1", delta: { direction, label: "12%" }, locale }));

  it("Spanish tiles say the delta in Spanish (mutation: ignore the locale prop in deltaAriaLabel → FAILS, stays English)", () => {
    expect(html("es", "up")).toContain('<span class="sr-only">subió 12% frente al periodo anterior</span>');
    expect(html("es", "down")).toContain('<span class="sr-only">bajó 12% frente al periodo anterior</span>');
    expect(html("es", "flat")).toContain('<span class="sr-only">sin cambios frente al periodo anterior</span>');
  });

  it("English stays the default (mutation: default the locale to es → FAILS)", () => {
    expect(html(undefined, "up")).toContain('<span class="sr-only">up 12% vs the prior period</span>');
    expect(html("en", "flat")).toContain('<span class="sr-only">flat vs the prior period</span>');
  });
});

// DESIGN.md DoD: "/styleguide page updated if a new component/variant was
// added" — a locale is a variant here, same as dark/light.
describe("the styleguide shows a Spanish StatTile (I7, DoD)", () => {
  it("renders one StatTile with locale=\"es\" inside a lang=\"es\" wrapper (mutation: drop the Spanish example → FAILS)", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const page = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "(dashboard)", "dashboard", "styleguide", "page.tsx"),
      "utf8",
    );
    expect(page).toMatch(/<div lang="es"[^>]*>\s*<StatTile[^/]*locale="es"/);
  });
});
