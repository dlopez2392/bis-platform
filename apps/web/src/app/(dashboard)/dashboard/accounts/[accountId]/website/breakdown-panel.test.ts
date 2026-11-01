// I-3 (review): the Sources panel shows channelOf's (lib/website/channel.ts)
// raw category names ("Direct", "Social", "AI assistants", "Other
// websites") unconverted. Brand names (Google, Bing, ...) are proper nouns
// and must pass through unchanged in every locale.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BreakdownPanel } from "./breakdown-panel";

const ROWS = [
  { name: "Google", visitors: 70, share: 0.58 },
  { name: "Social", visitors: 30, share: 0.25 },
  { name: "Other websites", visitors: 15, share: 0.12 },
  { name: "Direct", visitors: 6, share: 0.05 },
];

describe("BreakdownPanel — channel category names (I-3)", () => {
  it("renders every category name in Spanish, brand names unchanged (mutation: drop the channel-name lookup → FAILS)", () => {
    const html = renderToStaticMarkup(createElement(BreakdownPanel, { title: "x", rows: ROWS, locale: "es" }));
    expect(html).toContain(">Google<");
    expect(html).toContain(">Redes sociales<");
    expect(html).toContain(">Otros sitios web<");
    expect(html).toContain(">Directo<");
    expect(html).not.toContain(">Social<");
    expect(html).not.toContain(">Other websites<");
    expect(html).not.toContain(">Direct<");
  });

  it("defaults to English (every call site that omits locale is unaffected)", () => {
    const html = renderToStaticMarkup(createElement(BreakdownPanel, { title: "x", rows: ROWS }));
    expect(html).toContain(">Social<");
    expect(html).toContain(">Other websites<");
  });
});
