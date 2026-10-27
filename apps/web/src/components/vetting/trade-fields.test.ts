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
  it("posts the form's language beside the trade, so a refusal comes back in it (final review M3; mutation: drop the hidden input -> FAILS)", () => {
    expect(render("", "es")).toContain('<input type="hidden" name="locale" value="es"/>');
    expect(render("", "en")).toContain('<input type="hidden" name="locale" value="en"/>');
  });
  it("asks for the description only when Other is chosen, capped at 120 (mutation: always render it -> FAILS)", () => {
    expect(render()).not.toContain('name="tradeOther"');
    const other = render("other");
    expect(other).toContain('name="tradeOther"');
    expect(other).toContain('maxLength="120"');
  });
});
