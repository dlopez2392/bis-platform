import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchHighlightDemo } from "./search-highlight-demo";
import { renderedText } from "@/lib/rendered-text";

/**
 * F-092 part 1 (plan Task 7, DoD: /styleguide gains the new component): HighlightedText in the two
 * shapes it actually ships in — the command palette's row (name, then a muted phone sublabel) and a
 * list row (name and phone as separate cells) — across the three matching rules this plan ships: a
 * full name typed in any word order, the n/ñ fold (Q1), and a phone search by its last digits (Q2).
 */
describe("styleguide: search highlighting (DoD: /styleguide gains the new component)", () => {
  const html = renderToStaticMarkup(createElement(SearchHighlightDemo));
  const text = renderedText(html);

  it("shows the full-name, n/ñ-fold and phone cases (the stripped-tag text has extra whitespace where a <mark> boundary was, so this checks words, not the whole phrase)", () => {
    expect(text).toMatch(/María\s+García\s+López/);
    expect(text).toContain("Peña");
    expect(text).toMatch(/\(956\)\s*555-\s*0199/);
  });

  it("marks only the matched letters, never the whole field (mutation: pass ranges=[] -> FAILS)", () => {
    expect(html).toMatch(/<mark data-search-hit="true"[^>]*>María<\/mark>/);
    expect(html).toMatch(/<mark data-search-hit="true"[^>]*>García<\/mark>/);
    expect(html).toMatch(/<mark data-search-hit="true"[^>]*>Peña<\/mark>/);
    expect(html).toMatch(/<mark data-search-hit="true"[^>]*>0199<\/mark>/);
    // "garcia maria" never matches "López": the whole field is never marked.
    expect(html).not.toMatch(/<mark data-search-hit="true"[^>]*>López<\/mark>/);
  });

  it("shows both a palette-like row and a list-like row (mutation: drop one shape -> FAILS)", () => {
    expect(html).toContain('data-testid="styleguide-search-highlight-palette"');
    expect(html).toContain('data-testid="styleguide-search-highlight-list"');
  });
});
