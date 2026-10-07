import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// `next/font/google` is a webpack/Turbopack loader in disguise — the real
// export throws outside a Next build. Same hand-mocking `b/layout.test.ts`
// already does, and the same PROJECTING shape: the mock folds its own call
// args into the returned class name, so renaming `--font-geist-sans` in
// `public-html.tsx` to anything else is what makes this go red, not a fixed
// string that would pass no matter what was passed.
const mk = (tag: string) => (o: { variable: string; preload?: boolean }) => (
  { variable: `__variable_${tag}_${o.variable}_preload-${o.preload}` }
);
vi.mock("next/font/google", () => ({
  Geist: mk("geist"), Inter: mk("inter"), Source_Serif_4: mk("serif"),
}));

const { PublicHtml } = await import("./public-html");

describe("PublicHtml — the shell app/f, app/b and app/c share", () => {
  it("renders the lang prop it is given, not a fixed value", () => {
    const es = renderToStaticMarkup(
      createElement(PublicHtml, { lang: "es" }, createElement("p", null, "content")),
    );
    expect(es).toContain('lang="es"');

    const en = renderToStaticMarkup(
      createElement(PublicHtml, { lang: "en" }, createElement("p", null, "content")),
    );
    expect(en).toContain('lang="en"');
  });

  it("carries all three real font variable names at preload:false, and a zero-margin transparent body", () => {
    const markup = renderToStaticMarkup(
      createElement(PublicHtml, { lang: "en" }, createElement("p", null, "content")),
    );
    expect(markup).toContain("__variable_geist_--font-geist-sans_preload-false");
    expect(markup).toContain("__variable_inter_--font-inter_preload-false");
    expect(markup).toContain("__variable_serif_--font-source-serif_preload-false");
    expect(markup).toContain("margin:0");
    expect(markup).toContain("content");
  });
});
