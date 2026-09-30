import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// next/font/google throws outside a Next build; the mock folds each call's
// own args into the class name (app/b/layout.test.ts), so only the real
// variable names at preload:false can pass.
const mk = (tag: string) => (o: { variable: string; preload?: boolean }) => (
  { variable: `__variable_${tag}_${o.variable}_preload-${o.preload}` }
);
vi.mock("next/font/google", () => ({ Geist: mk("geist"), Inter: mk("inter"), Source_Serif_4: mk("serif") }));

const { default: UnsubscribeLayout, metadata } = await import("./layout");

describe("UnsubscribeLayout — /u's own root layout (R10; `next build` refuses a page with none)", () => {
  it("renders <html lang=\"en\"> with the three font variables at preload:false and a zero-margin, transparent <body> (mutation: delete the layout → the build fails; mutation: rename --font-geist-sans → FAILS)", () => {
    const markup = renderToStaticMarkup(createElement(UnsubscribeLayout, null, createElement("p", null, "content")));
    expect(markup).toMatch(/^<html lang="en"/);
    expect(markup).toContain("__variable_geist_--font-geist-sans_preload-false");
    expect(markup).toContain("__variable_inter_--font-inter_preload-false");
    expect(markup).toContain("__variable_serif_--font-source-serif_preload-false");
    expect(markup).toContain("margin:0");
    expect(markup).toContain("content");
  });

  it("carries the favicon (app/ declares none; mutation: drop icons → FAILS)", () => {
    expect(metadata.icons).toEqual({ icon: "/favicon.ico" });
  });
});
