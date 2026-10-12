import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthorMark } from "./author-mark";

describe("AuthorMark (spec §6, DESIGN.md Provenance)", () => {
  it("carries its kind for tests and says who in a word, never colour alone (mutation: drop data-author-mark -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(AuthorMark, { kind: "customer", label: "Customer" }));
    expect(html).toContain('data-author-mark="customer"');
    expect(html).toContain(">Customer<");
  });
  it("is a pill on the chip tokens, never a hard-coded colour (mutation: bg-violet-500 -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(AuthorMark, { kind: "ai", label: "Sofía · AI" }));
    expect(html).toMatch(/class="[^"]*\brounded-full\b/);
    for (const token of ["--chip-line", "--chip-bg", "--chip-text"]) expect(html).toContain(token);
    expect(html).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:bg|text|border)-(?:violet|gray|zinc|slate|neutral)-\d/i);
  });
  it("a long name truncates with its full text in title (pseudo-locale +35%; mutation: drop title -> FAILS)", () => {
    const long = "Maximiliano Alejandro de la Garza Villarreal";
    const html = renderToStaticMarkup(createElement(AuthorMark, { kind: "person", label: long }));
    expect(html).toContain(`title="${long}"`);
    expect(html).toMatch(/class="[^"]*\btruncate\b/);
  });
});
