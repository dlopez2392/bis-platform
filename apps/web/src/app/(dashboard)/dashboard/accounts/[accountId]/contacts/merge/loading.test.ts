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

// F-006 part 1 (plan Task 10): the compare screen's skeleton (DESIGN.md rule 7: no spinners), two
// columns on a desk. Same idiom as tasks/loading.tsx: named in the reader's own language.
describe("the compare screen's loading skeleton", () => {
  it("in Spanish, the busy region is named with contacts.merge.title.es (mutation: aria-label=\"Loading\" -> FAILS)", () => {
    const html = render("es");
    expect(html).toMatch(new RegExp(`aria-busy="true"[^>]*aria-label="${cat["contacts.merge.title.es"]}"`));
    expect(html).not.toContain('aria-label="Loading"');
  });

  it("in English (and with no provider at all), it is named with contacts.merge.title", () => {
    expect(render("en")).toMatch(new RegExp(`aria-busy="true"[^>]*aria-label="${cat["contacts.merge.title"]}"`));
    expect(render()).toMatch(new RegExp(`aria-busy="true"[^>]*aria-label="${cat["contacts.merge.title"]}"`));
  });

  it("shows two skeleton columns, one per record", () => {
    expect(render("en").match(/data-merge-column/g)?.length).toBe(2);
  });
});
