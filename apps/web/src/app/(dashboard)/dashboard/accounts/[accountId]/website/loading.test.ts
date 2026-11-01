// S-10 T2 (spec §3.1 row 13): this skeleton's aria-label was the raw string
// "Loading" — a client component with no catalogue key at all, English
// regardless of the reader's locale. Same pattern as
// documents/loading.tsx: the busy region is named for the page
// (website.title) in the reader's own language via `useLocale()`.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WebsiteSkeleton } from "./loading";
import { LocaleProvider } from "@/components/locale-provider";

describe("WebsiteSkeleton", () => {
  it("defaults to English outside a LocaleProvider (mutation: hard-code aria-label='Loading' → this still passes, but the Spanish case below catches it)", () => {
    const html = renderToStaticMarkup(createElement(WebsiteSkeleton));
    expect(html).toContain('aria-label="Website"');
  });

  it("reads a real LocaleProvider and renders the page's own title in Spanish (mutation: drop useLocale() and hard-code 'en' → FAILS)", () => {
    const html = renderToStaticMarkup(
      createElement(LocaleProvider, { locale: "es" } as never, createElement(WebsiteSkeleton)),
    );
    expect(html).toContain('aria-label="Sitio web"');
    expect(html).toContain('lang="es"');
  });
});
