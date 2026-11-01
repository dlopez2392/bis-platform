// S-10 review I-3: the dashboard's error and not-found pages say their words in
// the reader's language AND mark it, because the document stays
// <html lang="en"> until T7 sets it from the locale (DESIGN.md's bilingual DoD:
// "sets `lang` correctly"). Rendered for real, not pinned from source.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LocaleProvider } from "@/components/locale-provider";
import { m } from "@/lib/messages";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => createElement("a", { href }, children),
}));

import DashboardNotFound from "./not-found";
import DashboardError from "./error";

const inLocale = (locale: "en" | "es", el: React.ReactElement) =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale, children: el }));

describe("dashboard not-found", () => {
  it("in Spanish: Spanish words under lang=\"es\" (mutation: drop lang={locale} → FAILS)", () => {
    const html = inLocale("es", createElement(DashboardNotFound));
    expect(html).toContain(m["notFound.title.es"]);
    expect(html).toMatch(/lang="es"/);
  });
  it("in English: lang=\"en\" (mutation: hard-code lang=\"es\" → FAILS)", () => {
    expect(inLocale("en", createElement(DashboardNotFound))).toMatch(/lang="en"/);
  });
});

describe("dashboard error", () => {
  it("in Spanish: Spanish words under lang=\"es\" (mutation: drop lang={locale} → FAILS)", () => {
    const html = inLocale("es", createElement(DashboardError, { error: new Error("x"), reset: () => {} }));
    expect(html).toContain(m["error.title.es"]);
    expect(html).toMatch(/lang="es"/);
  });
});
