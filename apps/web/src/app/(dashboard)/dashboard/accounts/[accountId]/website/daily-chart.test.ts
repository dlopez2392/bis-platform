import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DailyChart } from "./daily-chart";

const DAYS = [
  { day: "2026-09-01", visitors: 100, pageviews: 300, isWeekend: false },
  { day: "2026-09-02", visitors: 50, pageviews: 150, isWeekend: false },
  { day: "2026-09-03", visitors: 25, pageviews: 60, isWeekend: true },
  { day: "2026-09-04", visitors: 0, pageviews: 0, isWeekend: true },
];

describe("DailyChart bars (spec §5)", () => {
  const html = renderToStaticMarkup(createElement(DailyChart, { days: DAYS }));
  it("weekday bars wear the accent gradient, weekends --surface-3, and no colour literal appears", () => {
    expect(html.match(/data-slot="chart-bar"[^>]*class="[^"]*\bbar-accent\b/g)?.length).toBe(2);
    expect(html.match(/data-slot="chart-bar"[^>]*class="[^"]*\bbg-accent\b/g)?.length).toBe(2);
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
  it("draws two dashed gridlines at 33% and 66% in --line", () => {
    const grid = html.match(/data-slot="chart-grid"[^>]*>/g) ?? [];
    expect(grid.length).toBe(2);
    expect(grid.join(" ")).toContain("bottom:33%");
    expect(grid.join(" ")).toContain("bottom:66%");
    for (const g of grid) expect(g).toMatch(/border-dashed[^"]*border-border|border-border[^"]*border-dashed/);
  });
  it("has exactly one axis row and no second series or legend when none is given", () => {
    expect(html.match(/data-slot="chart-axis"/g)?.length).toBe(1);
    expect(html).not.toContain("chart-series-2");
    expect(html).not.toContain("chart-legend");
  });
});

describe("DailyChart second series (spec §5): same axis, --accent-2, mono legend", () => {
  // Second max (80) is deliberately BELOW the visitors max (100): a series
  // scaled by its own max would put 80 at the top and betray a second axis.
  const second = { label: "Pageviews ÷ 3", values: [80, 40, 20, 0] };
  const html = renderToStaticMarkup(createElement(DailyChart, { days: DAYS, secondSeries: second }));
  it("renders one polyline in --accent-2, 2px, with an end dot", () => {
    expect(html.match(/data-slot="chart-series-2"/g)?.length).toBe(1);
    expect(html).toMatch(/<polyline[^>]*stroke="var\(--accent-2\)"[^>]*stroke-width="2"/);
    expect(html).toContain("bg-[var(--accent-2)]"); // end dot, r 4 = size-2
  });
  it("shares the bars' axis: y is scaled by the VISITORS max, never its own", () => {
    // max visitors = 100 → 80 → y 20, 40 → y 60, 20 → y 80, 0 → y 100; x = (i+.5)/4·100.
    // Scaled by its OWN max (80) the string would start "12.5,0 37.5,50".
    const points = html.match(/<polyline[^>]*points="([^"]+)"/)![1]!;
    expect(points).toBe("12.5,20 37.5,60 62.5,80 87.5,100");
  });
  it("a second series taller than the bars raises the SHARED max instead of clipping", () => {
    // visitors max 100, second max 200 → scale 200: line y 0,50,75,100; the tallest bar drops to 50%.
    const tall = { label: "Pageviews ÷ 3", values: [200, 100, 50, 0] };
    const h = renderToStaticMarkup(createElement(DailyChart, { days: DAYS, secondSeries: tall }));
    expect(h.match(/<polyline[^>]*points="([^"]+)"/)![1]!).toBe("12.5,0 37.5,50 62.5,75 87.5,100");
    expect(h).toContain("height:50%");
    expect(h.match(/data-slot="chart-axis"/g)?.length).toBe(1);
  });

  it("still has exactly one axis row (never a dual axis)", () => {
    expect(html.match(/data-slot="chart-axis"/g)?.length).toBe(1);
    expect(html).not.toMatch(/<text\b/);
  });
  it("legend names both series in mono", () => {
    const legend = html.match(/data-slot="chart-legend"[\s\S]*?<\/div>/)![0]!;
    expect(legend).toContain("font-mono");
    expect(legend).toContain("Visitors");
    expect(legend).toContain("Pageviews ÷ 3");
    expect(legend).toContain("bg-[var(--accent)]");
    expect(legend).toContain("bg-[var(--accent-2)]");
  });
});
