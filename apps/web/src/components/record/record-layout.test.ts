import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RecordLayout } from "./record-layout";

const html = renderToStaticMarkup(createElement(RecordLayout, {
  header: createElement("header", { "data-h": "" }, "Ana"),
  skipLabel: "Skip to details",
  lang: "es",
  columns: [
    { column: "happening", content: createElement("p", null, "timeline") },
    { column: "have", content: createElement("p", null, "deals") },
    { column: "who", content: createElement("p", null, "details") },
  ],
}));

describe("RecordLayout (spec §8, C6): DOM order is the phone order", () => {
  it("keeps the columns in the order given, after the header; the desk placement is CSS only (mutation: sort columns into desk order who, happening, have -> FAILS)", () => {
    const order = [...html.matchAll(/data-record-column="(\w+)"/g)].map((x) => x[1]);
    expect(order).toEqual(["happening", "have", "who"]);
    expect(html.indexOf("data-h")).toBeLessThan(html.indexOf('data-record-column="happening"'));
  });

  it("a skip link goes straight to the who column, which can take focus (mutation: point it at #record-happening -> FAILS)", () => {
    expect(html).toMatch(/<a[^>]*href="#record-who"[^>]*>Skip to details<\/a>/);
    expect(html).toMatch(/id="record-who"[^>]*tabindex="-1"|tabindex="-1"[^>]*id="record-who"/);
  });

  it("is a container-query grid with today's tracks, and carries the page's lang", () => {
    expect(html).toContain("@container");
    expect(html).toContain("@min-[1024px]:grid-cols-[320px_minmax(0,1fr)_280px]");
    expect(html).toMatch(/data-record-layout[^>]*lang="es"|lang="es"[^>]*data-record-layout/);
  });
});
