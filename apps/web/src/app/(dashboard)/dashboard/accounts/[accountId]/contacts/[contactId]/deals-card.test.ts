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
