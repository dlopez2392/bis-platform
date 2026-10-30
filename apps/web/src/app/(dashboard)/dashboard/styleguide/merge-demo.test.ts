import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { renderedText } from "@/lib/rendered-text";

// F-006 part 1 (plan Task 11, spec §6.1, §6.4): the record header's duplicate line and the timeline's
// merge/mergeUndone row with its own "Undo merge", on the styleguide (DESIGN.md's DoD: a new
// component is on the styleguide). The row's button here is plain markup (design M-9's own rule):
// nothing on this page reaches merge-actions.ts.
const { MergeDemo } = await import("./merge-demo");

describe("styleguide: possible duplicates and merge (F-006 part 1, plan Task 11)", () => {
  const html = renderToStaticMarkup(createElement(MergeDemo));
  const text = renderedText(html);

  it("the duplicate line, in English and Spanish (mutation: render only one locale -> FAILS)", () => {
    expect(html.match(/data-duplicate-line/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text).toContain("May be the same person as");
    expect(text).toContain("Puede ser la misma persona que");
    expect(text).toContain("Compare");
    expect(text).toContain("Comparar");
  });

  it("a merge row and a mergeUndone row, each with its own icon, in both languages (mutation: drop a kind or a locale -> FAILS)", () => {
    expect(html.match(/lucide-merge\b/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.match(/lucide-undo-2\b/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("the merge row's own 'Undo merge' control shows, inert, in both languages (mutation: drop it -> FAILS)", () => {
    expect(html.match(/Undo merge/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html.match(/Deshacer unión/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("nothing in it is fixed-width (never w-[Npx], max-w-[...] still shrinks), so /styleguide never scrolls sideways at 375px (e2e/phone-width.spec.ts)", () => {
    expect(html).toMatch(/^<div class="[^"]*\bmin-w-0\b/);
    expect(html).not.toMatch(/(?<!max-)\bw-\[\d+px\]/);
    expect(html).not.toMatch(/\bmin-w-\[\d+px\]/);
  });
});
