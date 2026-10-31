import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HighlightedText } from "./highlighted-text";

/**
 * F-092 part 1 (plan Task 7): search hits set the matched letters in weight 600 — colour and background
 * inherited (DESIGN.md: hierarchy by weight first, colour last) — never a second colour or a highlight
 * background. The `<mark>` itself carries `data-search-hit` so a list or the palette can be probed for it.
 */
describe("HighlightedText", () => {
  it("wraps a hit range in <mark data-search-hit>, weight 600, colour and background inherited (mutation: drop bg-transparent/text-inherit -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(HighlightedText, { text: "García", ranges: [[0, 6]] }));
    expect(html).toBe('<mark data-search-hit="true" class="bg-transparent font-semibold text-inherit">García</mark>');
  });

  it("renders the plain text with no <mark when there are no ranges (mutation: always wrap in <mark> -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(HighlightedText, { text: "García", ranges: [] }));
    expect(html).toBe("García");
    expect(html).not.toContain("<mark");
  });

  it("alternates plain and hit parts for two separate ranges, joining back to the original text (full-name case)", () => {
    const html = renderToStaticMarkup(
      createElement(HighlightedText, { text: "María García López", ranges: [[0, 5], [6, 12]] }),
    );
    expect(html).toBe(
      '<mark data-search-hit="true" class="bg-transparent font-semibold text-inherit">María</mark> <mark data-search-hit="true" class="bg-transparent font-semibold text-inherit">García</mark> López',
    );
  });

  it("a mid-text range leaves a leading and trailing plain part (phone case)", () => {
    const html = renderToStaticMarkup(
      createElement(HighlightedText, { text: "(956) 555-0199", ranges: [[10, 14]] }),
    );
    expect(html).toBe(
      '(956) 555-<mark data-search-hit="true" class="bg-transparent font-semibold text-inherit">0199</mark>',
    );
  });
});
