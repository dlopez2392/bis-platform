import { describe, it, expect } from "vitest";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { LocaleProvider } from "@/components/locale-provider";
import Loading from "./loading";

const cat = m as Record<string, string>;
const render = (locale?: "en" | "es") => renderToStaticMarkup(
  locale
    ? createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, createElement(Loading))
    : createElement(Loading),
);

// F-085 follow-ups (final M7): the To do's skeleton names its busy region in
// the reader's language, from the account layout's LocaleProvider, as
// documents/loading.tsx does — never a hard-coded English "Loading".
describe("the To do's loading skeleton", () => {
  it("in Spanish, the busy region is named \"Pendientes\" with lang=\"es\", and the tray's line reads Spanish (mutation: aria-label=\"Loading\" -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(/<div[^>]*aria-busy="true"[^>]*aria-label="Pendientes"/);
    expect(html).toMatch(/<div class="p-6"[^>]*lang="es"/);
    expect(html).toContain(cat["suggestions.loading.es"]);
    expect(html).not.toContain('aria-label="Loading"');
  });

  it("in English (and with no provider at all), it is named \"To do\"", () => {
    expect(render("en")).toMatch(/aria-busy="true"[^>]*aria-label="To do"/);
    expect(render()).toMatch(/aria-busy="true"[^>]*aria-label="To do"/);
  });
});
