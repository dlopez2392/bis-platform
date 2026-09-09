import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sparkline } from "./sparkline";

describe("Sparkline (spec §5): 1.8px line, 14% area, r 2.4 end dot, currentColor only", () => {
  const html = renderToStaticMarkup(createElement(Sparkline, { counts: [1, 3, 2, 5] }));
  it("uses the spec's stroke and fill", () => {
    expect(html).toMatch(/<polyline[^>]*stroke="currentColor"[^>]*stroke-width="1.8"/);
    expect(html).toMatch(/<polygon[^>]*fill="currentColor"[^>]*opacity="0.14"/);
    expect(html).toMatch(/<circle[^>]*r="2.4"/);
  });
  it("carries no colour literal", () => {
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
  });
});
