import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { OutcomePill } from "./outcome-pill";

/**
 * S-10 fix round I5: the pill's Spanish had no render test of its own, so
 * a pill that went back to reading `OUTCOMES[outcome].label` (the English
 * map built once at load) would have kept every Calls test green.
 */
describe("OutcomePill — the reader's language", () => {
  it("reads 'Agendó' for a booked call under es (mutation: render OUTCOMES[outcome].label → FAILS)", () => {
    const text = renderedText(renderToStaticMarkup(createElement(OutcomePill, { outcome: "booked", locale: "es" })));
    expect(text).toContain(m["calls.outcome.booked.es"]);
    expect(text).toContain("Agendó");
    expect(text).not.toContain(m["calls.outcome.booked"]);
  });

  it("stays English with no locale — the dashboard's mini table passes none (control)", () => {
    const text = renderedText(renderToStaticMarkup(createElement(OutcomePill, { outcome: "booked" })));
    expect(text).toContain(m["calls.outcome.booked"]);
  });

  it("wears the pseudo-locale under the QA override (mutation: ignore pseudo → FAILS)", () => {
    const text = renderedText(renderToStaticMarkup(createElement(OutcomePill, { outcome: "booked", locale: "en", pseudo: true })));
    expect(text).toContain(pseudoLocale(m["calls.outcome.booked"]));
  });
});
