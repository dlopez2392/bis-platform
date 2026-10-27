import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RefusalNotice } from "./refusal-notice";

/**
 * Add company's and Add as a company's refusal (design check I2 / final review M4). The Notice sits
 * OUTSIDE TradeFields' lang wrapper, and its sentence may be Spanish (a trade refusal in a Spanish
 * dialog) or English (every other refusal), so it states its own language rather than inheriting one.
 */
describe("RefusalNotice", () => {
  it("sets lang to the language its sentence is in (mutation: drop lang -> FAILS)", () => {
    const es = renderToStaticMarkup(createElement(RefusalNotice, { refusal: { text: "Elija el giro del negocio.", lang: "es" } }));
    expect(es).toMatch(/<div role="alert"[^>]*lang="es"[^>]*>Elija el giro del negocio\.<\/div>/);
    const en = renderToStaticMarkup(createElement(RefusalNotice, { refusal: { text: "Enter a business name.", lang: "en" } }));
    expect(en).toMatch(/<div role="alert"[^>]*lang="en"[^>]*>Enter a business name\.<\/div>/);
  });
});
