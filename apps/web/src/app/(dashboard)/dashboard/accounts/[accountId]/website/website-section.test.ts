import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { WebsiteView } from "@/lib/website/view-model";
import { WebsiteSection } from "./website-section";

const days = [
  { day: "2026-09-01", visitors: 100, pageviews: 300, isWeekend: false },
  { day: "2026-09-02", visitors: 50, pageviews: 151, isWeekend: false },
  { day: "2026-09-03", visitors: 25, pageviews: 60, isWeekend: true },
];
const VIEW: WebsiteView = {
  period: 14, fromDay: "2026-08-20", toDay: "2026-09-03",
  days,
  totals: { visitors: 175, pageviews: 511 },
  prior: { visitors: 120, pageviews: 400 },
  visitorsDelta: { direction: "up", label: "46%" }, pageviewsDelta: { direction: "up", label: "28%" },
  fromGoogle: { share: 0.4, priorShare: 0.3 },
  topPage: { name: "/", visitors: 90, share: 0.51 },
  pages: [{ name: "/", visitors: 90, share: 0.51 }], sources: [{ name: "google", visitors: 70, share: 0.4 }],
  places: [], devices: [{ name: "mobile", visitors: 120, share: 0.69 }],
  sentence: [{ text: "Your site had " }, { text: "175 visitors", strong: true }, { text: " in the last 14 days." }],
  lastSyncedDay: "2026-09-03", stale: false,
};

describe("Website screen (spec §5)", () => {
  const html = renderToStaticMarkup(createElement(WebsiteSection, { view: VIEW }));

  it("names exactly one hero — Visitors", () => {
    expect(html.match(/data-hero="true"/g)?.length).toBe(1);
    expect(html).toMatch(/data-hero="true"[^>]*>175</);
  });

  it("renders the emphasised sentence segment in the hero gradient at display size (≥ 22px), nothing else coloured", () => {
    expect(html).toMatch(/<strong[^>]*class="[^"]*\bhero-text\b[^"]*">175 visitors<\/strong>/);
    expect(html).not.toMatch(/<strong[^>]*text-primary/);
    expect(html).toMatch(/aria-label="Summary"[\s\S]*?<p class="[^"]*text-\[24px\]/);
  });

  it("passes pageviews ÷ 3 (rounded) as the second series with the legend label", () => {
    expect(html).toContain("Pageviews ÷ 3");
    // 300/3=100 → y 0; 151/3=50.33→50 → y 50; 60/3=20 → y 80 (visitors max 100)
    // Scoped to the chart's own `data-slot="chart-series-2"` svg: both
    // StatTiles above it render a Sparkline `<polyline>` of their own, so a
    // bare `html.match(/<polyline…)` picks up the wrong (first) one.
    const seriesSvg = html.match(/<svg data-slot="chart-series-2"[\s\S]*?<\/svg>/)?.[0] ?? "";
    expect(seriesSvg.match(/<polyline[^>]*points="([^"]+)"/)?.[1]).toBe("16.666666666666664,0 50,50 83.33333333333334,80");
  });
});
