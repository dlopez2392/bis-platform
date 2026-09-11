import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BisMark } from "./bis-mark";

describe("BisMark — the platform mark (spec §5)", () => {
  const html = renderToStaticMarkup(createElement(BisMark));

  it("is decorative and findable in the DOM", () => {
    expect(html).toContain('data-slot="bis-mark"');
    expect(html).toContain('aria-hidden="true"');
  });

  it("knocks the triangle out as a HOLE rather than painting it", () => {
    // ONE path with evenodd is what makes the triangle transparent. Two
    // shapes would force every caller to say what is behind the mark, and
    // would be the wrong dark the moment it sat on the sidebar's chrome.
    expect(html).toContain('fill-rule="evenodd"');
    expect(html.match(/<path/g) ?? []).toHaveLength(1);
  });

  it("takes its colour from the caller — no literal", () => {
    expect(html).toContain('fill="currentColor"');
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/);
  });

  it("renders at the caller's size", () => {
    const big = renderToStaticMarkup(createElement(BisMark, { size: 40 }));
    expect(big).toContain('width="40"');
    expect(big).toContain('height="40"');
  });
});
