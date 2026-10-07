import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// F-102 review round, second pass (item 2) — see
// `app/f/[publicId]/not-found.test.ts`'s identical file for the full
// reasoning.
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const { PublicLocaleProvider } = await import("@/components/public/locale-context");
const { conciergeStrings } = await import("@/lib/concierge/strings");
const { default: ConciergeNotFound } = await import("./not-found");

function renderUnder(lang: "en" | "es") {
  return renderToStaticMarkup(
    createElement(PublicLocaleProvider, { lang }, createElement(ConciergeNotFound)),
  );
}

// `react-dom/server` HTML-escapes the rendered text (an apostrophe becomes
// `&#x27;`) — compare against the catalogue value run through the SAME
// escaping, rather than a hand-picked punctuation-free substring.
const htmlEscape = (s: string) => s.replace(/'/g, "&#x27;");

describe("ConciergeNotFound — falls back to the layout's provided language, not a literal", () => {
  it("renders the Spanish copy when the layout resolved a Spanish default and ?locale is absent", () => {
    const html = renderUnder("es");
    // MUTATION: change `usePublicLocaleDefault()` for a hard-coded "en" in
    // not-found.tsx's own fallback -- this FAILS: the English copy renders.
    expect(html).toContain(htmlEscape(conciergeStrings("es").notFoundTitle));
    expect(html).not.toContain(htmlEscape(conciergeStrings("en").notFoundTitle));
  });

  it("renders the English copy when the layout resolved an English default", () => {
    const html = renderUnder("en");
    expect(html).toContain(htmlEscape(conciergeStrings("en").notFoundTitle));
  });
});
