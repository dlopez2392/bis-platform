import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FactsFlags } from "./facts-flags";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

function render(over: Partial<Parameters<typeof FactsFlags>[0]> = {}) {
  const props = {
    facts: "", servicesText: "", hasHours: false, hasPriceList: false,
    locale: "en" as const, pseudo: false, persona: "Sofía",
    ...over,
  };
  return renderToStaticMarkup(createElement(FactsFlags, props));
}

describe("FactsFlags — empty (nothing to flag)", () => {
  it("renders nothing for plain facts text with neither hours nor a price list stored", () => {
    expect(render({ facts: "We fix roofs. Call us any time." })).toBe("");
  });
});

describe("FactsFlags — hours written in Facts", () => {
  const HOURS_FACTS = "We are open Monday 9 to 5.";

  it("shows the NOTICE when Business hours already has structured hours (hours mentioned twice is the risk)", () => {
    const text = renderedText(render({ facts: HOURS_FACTS, hasHours: true }));
    expect(text).toContain(m["voice.facts.hoursNotice"].replace("{persona}", "Sofía"));
    expect(text).not.toContain(m["voice.facts.hoursHint"].replace("{persona}", "Sofía"));
  });

  // MUTATION: swap the branches (hint when hasHours, notice when not) -> this FAILS.
  it("shows the HINT, not the notice, when Business hours has nothing stored yet", () => {
    const text = renderedText(render({ facts: HOURS_FACTS, hasHours: false }));
    expect(text).toContain(m["voice.facts.hoursHint"].replace("{persona}", "Sofía"));
    expect(text).not.toContain(m["voice.facts.hoursNotice"].replace("{persona}", "Sofía"));
  });

  it("flags nothing when Facts mentions no hours at all", () => {
    expect(render({ facts: "We fix roofs.", hasHours: true })).toBe("");
  });
});

describe("FactsFlags — amounts written in Facts or Services (spec 5.3; the brief's own example)", () => {
  const FACTS = "A $500 deposit to hold the date is due at signing. Catering is $35 per guest.";

  it("lists every amount, in straight double quotes, joined by ', ', only once a price list is stored (mutation: list them with hasPriceList false -> FAILS)", () => {
    const text = renderedText(render({ facts: FACTS, hasPriceList: true }));
    expect(text).toContain(
      m["voice.facts.amountsNotice"]
        .replace("{persona}", "Sofía")
        .replace("{amounts}", '"$500 deposit to hold the date", "$35 per guest"'),
    );
  });

  it("flags nothing when there is no stored price list to conflict with", () => {
    expect(render({ facts: FACTS, hasPriceList: false })).toBe("");
  });
});

describe("FactsFlags — locale", () => {
  it("sets lang on its root and uses the Spanish copy for locale: 'es' (mutation: drop the lang prop -> FAILS)", () => {
    const html = render({ facts: "We are open Monday 9 to 5.", hasHours: true, locale: "es" });
    expect(html).toMatch(/<div[^>]*lang="es"[^>]*>/);
    expect(renderedText(html)).toContain(m["voice.facts.hoursNotice.es"].replace("{persona}", "Sofía"));
  });
});
