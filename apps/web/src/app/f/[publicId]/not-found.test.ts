import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// F-102 review round, second pass (item 2): nothing rendered this component
// against a non-English `PublicLocaleProvider` before — a mutation that
// reverted `usePublicLocaleDefault()`'s fallback to a hard-coded "en" left
// every existing test (25 files, per the reviewer's count) green, because
// every test that touched this file either passed no locale signal at all
// (defaulting correctly to English either way) or supplied `?locale=`
// directly (bypassing the layout-provided default entirely).
vi.mock("next/navigation", () => ({
  // No `locale`, no `theme` — the exact "host gave no override" case the
  // layout's OWN default exists to answer.
  useSearchParams: () => new URLSearchParams(),
}));

const { PublicLocaleProvider } = await import("@/components/public/locale-context");
const { publicStrings } = await import("@/lib/forms/public-strings");
const { default: PublicFormNotFound } = await import("./not-found");

function renderUnder(lang: "en" | "es") {
  return renderToStaticMarkup(
    createElement(PublicLocaleProvider, { lang }, createElement(PublicFormNotFound)),
  );
}

// `react-dom/server` HTML-escapes the rendered text (an apostrophe becomes
// `&#x27;`), so these compare against the catalogue value run through the
// SAME escaping `renderToStaticMarkup` already applied to the markup —
// rather than hand-picking a substring that happens to dodge punctuation.
const htmlEscape = (s: string) => s.replace(/'/g, "&#x27;");

describe("PublicFormNotFound — falls back to the layout's provided language, not a literal", () => {
  it("renders the Spanish copy when the layout resolved a Spanish default and ?locale is absent", () => {
    const html = renderUnder("es");
    // MUTATION: change `usePublicLocaleDefault()` for a hard-coded "en" in
    // not-found.tsx's own fallback (i.e. `normalizeLocale(params.get(...),
    // "en")`) -- this FAILS: the English copy renders instead.
    expect(html).toContain(htmlEscape(publicStrings("es").notFoundTitle));
    expect(html).not.toContain(htmlEscape(publicStrings("en").notFoundTitle));
  });

  it("renders the English copy when the layout resolved an English default", () => {
    const html = renderUnder("en");
    expect(html).toContain(htmlEscape(publicStrings("en").notFoundTitle));
  });
});
