// S-47d Task 15 finding: `BusinessStatusCardError` moved into its own module with NO server imports
// (`./business-status-card-error`), so `business-status-card-boundary.tsx` ("use client") never pulls
// `business-status-card.tsx`'s `@bis/db`/Clerk (`server-only`) imports into the client bundle. This
// file exists separately from `business-status-card.test.ts` for the same reason the production
// module split does: it never needs the server card's own @bis/db mocks at all.
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { BusinessStatusCardError } from "./business-status-card-error";

describe("BusinessStatusCardError (spec §5.6.2)", () => {
  it("renders the catalogue's error text and a Retry link, in English", () => {
    const html = renderToStaticMarkup(createElement(BusinessStatusCardError, { locale: "en" }));
    expect(html).toContain("Couldn&#x27;t load today&#x27;s status.");
    expect(html).toContain("Retry");
  });

  it("renders the catalogue's error text and a Retry link, in Spanish too", () => {
    const html = renderToStaticMarkup(createElement(BusinessStatusCardError, { locale: "es" }));
    expect(html).toContain("No se pudo cargar el estado de hoy.");
    expect(html).toContain("Reintentar");
  });

  it("carries lang on the card root (mutation: drop `lang={locale}` -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(BusinessStatusCardError, { locale: "es" }));
    expect(html).toContain('lang="es"');
  });

  it("honours the pseudo-locale like the card it stands in for (fix round D6; mutation: ignore pseudo -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(BusinessStatusCardError, { locale: "en", pseudo: true }));
    expect(html).not.toContain("Couldn&#x27;t load today&#x27;s status.");
    expect(html).not.toContain(">Retry<");
  });

  it("the boundary carries pseudo from the page to the fallback (source pins: a function fallback cannot be rendered statically)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const boundary = readFileSync(path.join(here, "business-status-card-boundary.tsx"), "utf8");
    const page = readFileSync(path.join(here, "page.tsx"), "utf8");
    expect(boundary).toContain("<BusinessStatusCardError locale={locale} pseudo={pseudo} onRetry={reset} />");
    expect(page).toMatch(/<BusinessStatusCardBoundary locale=\{locale\} pseudo=\{pseudo\}/);
  });
});
