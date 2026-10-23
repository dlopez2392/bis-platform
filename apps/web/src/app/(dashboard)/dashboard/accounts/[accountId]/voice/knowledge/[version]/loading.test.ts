import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Loading from "./loading";
import { LocaleProvider } from "@/components/locale-provider";

// Rule 7 (design review): the knowledge page loads behind a skeleton shaped like it, never a spinner.
const render = (locale: "en" | "es") =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(Loading)));

describe("the knowledge page's loading state", () => {
  it("is a busy region named in the reader's language, with no spinner (mutation: an English-only name -> FAILS)", () => {
    const en = render("en");
    expect(en).toMatch(/aria-busy="true"[^>]*aria-label="Loading this version"/);
    expect(render("es")).toContain('aria-label="Cargando esta versión"');
    expect(en).not.toMatch(/animate-spin/);
  });

  it("is shaped like the page: the header, then one card with its title, its saved line and four sections of lines (mutation: one bar -> FAILS)", () => {
    const html = render("en");
    expect(html).toContain("data-knowledge-skeleton");
    const sections = [...html.matchAll(/data-knowledge-skeleton-section=""/g)];
    expect(sections.length).toBe(4);
    expect((html.match(/data-slot="skeleton"/g) ?? []).length).toBeGreaterThanOrEqual(12);
  });
});
