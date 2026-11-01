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

  it("renders the emphasised sentence segment in the em gradient at display size (≥ 22px), nothing else coloured", () => {
    // em-text, not hero-text: the mockup gives the sentence its OWN, deeper
    // pair (--em-bg) and reserves --kpi-hero-bg for the hero KPI.
    expect(html).toMatch(/<strong[^>]*class="[^"]*\bem-text\b[^"]*">175 visitors<\/strong>/);
    expect(html).not.toMatch(/<strong[^>]*text-primary/);
    expect(html).toMatch(/aria-label="Summary"[\s\S]*?<p class="[^"]*text-\[24px\]/);
  });

  it("keeps the period label and the update stamp INSIDE the summary card, and adds the mockup's supporting line", () => {
    const card = html.match(/aria-label="Summary"[\s\S]*?<\/section>/)![0]!;
    expect(card).toContain("The last 14 days");
    expect(card).toContain("Last updated");
    // busiest day = 2026-09-01 (100 visitors), totals 175 / 511
    expect(card).toMatch(/175 people, 511 pages\. Your busiest day was Sep 1, 2026\./);
  });

  it("every card on the screen is glass (the sheen, the 1px highlight and the card shadow)", () => {
    expect(html.match(/class="[^"]*\bbg-card\b[^"]*\bglass\b/g)?.length).toBe(
      // summary + 4 tiles + chart + 3 panels
      9,
    );
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

// S-10 T2 (spec §3.1 row 13): every website.* string here was read through
// `m[...]` directly, and every number through a bare `.toLocaleString("en-US")`
// — English regardless of the reader's locale. `locale`/`pseudo` are new,
// optional props (default "en"/false) so every test above is unaffected.
describe("Website screen in Spanish (usted register)", () => {
  const esHtml = renderToStaticMarkup(createElement(WebsiteSection, { view: VIEW, locale: "es" }));

  it("the summary card, tiles and chart/panel headings render in Spanish (mutation: leave any m[...] read unconverted → FAILS)", () => {
    expect(esHtml).toContain("Visitantes");
    expect(esHtml).toContain("Páginas vistas");
    expect(esHtml).toContain("Desde Google");
    expect(esHtml).toContain("Visitantes por día");
    expect(esHtml).toContain("Páginas que la gente leyó");
    expect(esHtml).toContain("Resumen"); // aria-label="Summary"
    expect(esHtml).not.toContain("Visitors");
  });

  it("the supporting line and the chart legend use es-US number formatting (mutation: leave toLocaleString pinned to en-US → still passes for THESE digits, so this also checks the Spanish words around them)", () => {
    const card = esHtml.match(/aria-label="Resumen"[\s\S]*?<\/section>/)![0]!;
    expect(card).toContain("Últimos 14 días");
    expect(card).toContain("Última actualización");
    // "sept" (not "sep"), measured on this machine (Node 24.13.0/ICU 77.1) —
    // see day-label.test.ts's own note on month-abbreviation irregularities.
    expect(card).toMatch(/175 personas, 511 páginas\. Su día más activo fue el 1 sept 2026\./);
  });

  it("the breakdown panels are localized too — title and device name (mutation: leave BreakdownPanel unconverted → FAILS)", () => {
    // PLACE_DIMENSION is "country" today, so showPlaces is false and the
    // third panel is Devices, not Places — see website-section.tsx's own
    // comment on `showPlaces`.
    expect(esHtml).toContain("Dispositivos");
    expect(esHtml).toContain("Celular"); // devices: [{ name: "mobile", ... }]
  });

  // M-5 (review): the top-page tile's "N visitors" was invariant even for
  // exactly one visitor.
  it("the top-page tile reads the singular form for exactly one visitor", () => {
    const oneVisitorView = { ...VIEW, topPage: { name: "/", visitors: 1, share: 0.01 } };
    const en = renderToStaticMarkup(createElement(WebsiteSection, { view: oneVisitorView }));
    expect(en).toContain("1 visitor · 1% of all");
    const es = renderToStaticMarkup(createElement(WebsiteSection, { view: oneVisitorView, locale: "es" }));
    expect(es).toContain("1 visitante · 1% del total");
  });
});
