import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// `next/font/google` is a webpack/Turbopack loader in disguise — calling the
// real export outside a Next build throws ("Geist is not a function"), proven
// by running this test unmocked before adding this. The real Next.js Jest
// preset auto-mocks this module the same way for the same reason; there is no
// vitest equivalent here, so it's mocked by hand.
//
// PROJECTING, not fixed-return: the recorded lesson ("Assert a PAINTED value,
// never a CSS custom property") applies to the mock itself, not just the
// assertion. A mock that ignores its call args (the shape this file used to
// have) makes renaming `--font-geist-sans` to anything else in `layout.tsx`
// — the exact defect C1 exists to catch — invisible; every mocked face
// returns the same fixed string no matter what `variable`/`preload` it was
// called with. `mk` instead folds the call's own args into the returned
// class name, so the assertion below can only pass if `layout.tsx` actually
// passed the real variable names and `preload: false`.
const mk = (tag: string) => (o: { variable: string; preload?: boolean }) => (
  { variable: `__variable_${tag}_${o.variable}_preload-${o.preload}` }
);
vi.mock("next/font/google", () => ({
  Geist: mk("geist"), Inter: mk("inter"), Source_Serif_4: mk("serif"),
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
  it("renders <html lang=\"en\"> carrying all three real font variable names at preload:false, and a zero-margin <body>", () => {
    const markup = renderToStaticMarkup(
      createElement(PublicBookingLayout, null, createElement("p", null, "content")),
    );

    expect(markup).toContain("lang=\"en\"");
    // Each occurrence proves the EXACT variable name and preload value
    // `layout.tsx` passed to `next/font/google` — not merely that three font
    // calls happened (mutation: rename `--font-geist-sans` in `layout.tsx` to
    // anything else → this goes red; the old fixed-string mock could not).
    expect(markup).toContain("__variable_geist_--font-geist-sans_preload-false");
    expect(markup).toContain("__variable_inter_--font-inter_preload-false");
    expect(markup).toContain("__variable_serif_--font-source-serif_preload-false");

    expect(markup).toContain("margin:0");
    expect(markup).toContain("content");
  });
});
