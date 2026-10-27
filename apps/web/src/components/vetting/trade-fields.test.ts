import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tradeOptionGroups } from "@/lib/vetting/copy";
import { TradeFields, type TradeFieldsCopy } from "./trade-fields";

const COPY: TradeFieldsCopy = { label: "Giro", placeholder: "Elija el giro del negocio", hint: "Pista", otherLabel: "¿A qué se dedica el negocio?", otherHint: "Una línea" };
const render = (defaultTrade = "", locale: "en" | "es" = "es") => renderToStaticMarkup(
  createElement(TradeFields, { idPrefix: "t", groups: tradeOptionGroups(locale), copy: COPY, locale, defaultTrade }));

describe("TradeFields", () => {
  it("labels the picker, sets lang, and posts it as `trade`", () => {
    const html = render();
    expect(html).toContain('lang="es"');
    expect(html).toContain(">Giro</label>");
    expect(html).toContain("Elija el giro del negocio");
    expect(html).toContain('name="trade"');
  });
  it("asks for the description only when Other is chosen, capped at 120 (mutation: always render it -> FAILS)", () => {
    expect(render()).not.toContain('name="tradeOther"');
    const other = render("other");
    expect(other).toContain('name="tradeOther"');
    expect(other).toContain('maxLength="120"');
  });
});
