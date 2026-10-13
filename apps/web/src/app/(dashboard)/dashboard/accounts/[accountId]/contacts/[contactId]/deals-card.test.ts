import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DealsBody } from "./deals-card";
import { makeTr } from "@/lib/record/copy";

const DEALS = [
  { id: "d1", name: "Deck build", status: "open", monetary_value: "2400.00" },
  { id: "d2", name: "Fence", status: "won", monetary_value: 900 },
  { id: "d3", name: "Gate", status: "lost", monetary_value: 0 },
];

describe("DealsBody (spec §9.5, C10)", () => {
  it("each status is a dot AND a word (rule 3; mutation: drop the dot span -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(DealsBody, { deals: DEALS, tr: makeTr("en") }));
    expect(html.match(/data-deal-status="(open|won|lost)"/g)).toHaveLength(3);
    expect(html.match(/<span aria-hidden="true" class="size-\[7px\]/g)).toHaveLength(3);
    expect(html).toContain("$2,400");
    expect(html).toContain(">Open<");
  });
  it("Spanish words for the statuses and the empty state", () => {
    expect(renderToStaticMarkup(createElement(DealsBody, { deals: DEALS, tr: makeTr("es") }))).toContain(">Ganada<");
    expect(renderToStaticMarkup(createElement(DealsBody, { deals: [], tr: makeTr("es") }))).toContain("Todavía no hay ninguna.");
  });
});

describe("DealsBody on the group page (S-03 part 2, spec §8.5, C13)", () => {
  it("a row's person shows under the deal's name, as typed, with its title (mutation: drop the who line -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(DealsBody, { deals: [{ ...DEALS[0]!, who: "Ana García" }], tr: makeTr("en") }));
    expect(html).toMatch(/<p data-deal-who="true" class="[^"]*truncate[^"]*" title="Ana García">Ana García<\/p>/);
    expect(html.indexOf("Deck build")).toBeLessThan(html.indexOf("data-deal-who"));
  });
  it("the group's empty text replaces the contact's, in the page's language (mutation: ignore emptyText -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(DealsBody, { deals: [], tr: makeTr("es"), emptyText: "No hay oportunidades abiertas con estas personas." }));
    expect(html).toContain("No hay oportunidades abiertas con estas personas.");
    expect(html).not.toContain("Todavía no hay ninguna.");
  });
  it("the more line renders under the list (mutation: drop moreText -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(DealsBody, { deals: DEALS, tr: makeTr("en"), moreText: "Showing 30 of 41 open deals." }));
    expect(html).toMatch(/<\/ul><p data-deals-more="true" class="[^"]*">Showing 30 of 41 open deals\.<\/p>/);
  });
  it("without the three props the contact page's markup is today's: no who line, no more line (mutation: always render a who line -> FAILS)", () => {
    const html = renderToStaticMarkup(createElement(DealsBody, { deals: DEALS, tr: makeTr("en") }));
    expect(html).not.toContain("data-deal-who");
    expect(html).not.toContain("data-deals-more");
    expect(html.startsWith("<ul")).toBe(true);
  });
});
