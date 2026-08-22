import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// `next/font/google` is a webpack/Turbopack loader in disguise — calling the
// real export outside a Next build throws ("Geist is not a function"), proven
// by running this test unmocked before adding this. The real Next.js Jest
// preset auto-mocks this module the same way for the same reason; there is no
// vitest equivalent here, so it's mocked by hand. Each mock returns a distinct
// `__variable`-bearing class name — the same marker `next/font` itself mangles
// into every generated class — so the assertion below (three occurrences)
// still proves all three `next/font` declarations survive onto the element,
// not just that the layout renders at all.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "__variable_geist_mock" }),
  Inter: () => ({ variable: "__variable_inter_mock" }),
  Source_Serif_4: () => ({ variable: "__variable_sourceserif_mock" }),
}));

const { default: PublicBookingLayout } = await import("./layout");

/**
 * Pins served output, not the custom property — the recorded lesson (see
 * `MEMORY.md`: "Assert a PAINTED value, never a CSS custom property"). A test
 * that only checked `--font-geist-sans` etc. were declared would pass even if
 * this layout were deleted entirely and Next fell back to no root layout at
 * all; asserting the actual `<html>`/`<body>` this component renders is the
 * one thing that regresses if C1 is ever reverted.
 */
describe("PublicBookingLayout", () => {
  it("renders <html lang=\"en\"> carrying all three font variable classNames, and a zero-margin <body>", () => {
    const markup = renderToStaticMarkup(
      createElement(PublicBookingLayout, null, createElement("p", null, "content")),
    );

    expect(markup).toContain("lang=\"en\"");
    // One `className` occurrence on <html> holding all three; `__variable` is
    // the marker `next/font/google` mangles into each generated class name
    // (e.g. `__variable_xxxxxx`), so three occurrences means all three
    // `next/font` declarations (Geist, Inter, Source Serif 4) survived onto
    // the element, not just one of them.
    const variableOccurrences = markup.match(/__variable/g) ?? [];
    expect(variableOccurrences.length).toBe(3);

    expect(markup).toContain("margin:0");
    expect(markup).toContain("content");
  });
});
