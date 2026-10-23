import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FactsFlags } from "./facts-flags";
import { m } from "@/lib/messages";
import { renderedText } from "@/lib/rendered-text";

function render(over: Partial<Parameters<typeof FactsFlags>[0]> = {}) {
  const props = {
    facts: "", servicesText: "", hasHours: false, hasPriceList: false, insurance: false,
    locale: "en" as const, pseudo: false, persona: "Sofía",
    ...over,
  };
  return renderToStaticMarkup(createElement(FactsFlags, props));
}

describe("FactsFlags — a note, not an alert (design review I8)", () => {
  // Recomputed on every keystroke: an assertive alert would interrupt the operator as they type.
  it("every Notice is role=note with the foreground ink, never role=alert (mutation: Notice's default role -> FAILS)", () => {
    const html = render({ facts: "Open Monday 9 to 5. A $500 deposit.", hasHours: true, hasPriceList: true });
    const notices = [...html.matchAll(/<div[^>]*data-slot="notice"[^>]*>/g)].map((n) => n[0]);
    expect(notices.length).toBe(2);
    for (const n of notices) {
      expect(n).toContain('role="note"');
      expect(n).toMatch(/class="[^"]*\btext-foreground\b/);
    }
    expect(html).not.toContain('role="alert"');
  });
});

describe("FactsFlags — insurance (design review I6)", () => {
  const FACTS = "A $500 deposit to hold the date is due at signing.";

  it("uses the insurance sentence, which promises no prices card (mutation: the price-list sentence on insurance -> FAILS)", () => {
    const text = renderedText(render({ facts: FACTS, hasPriceList: true, insurance: true }));
    expect(text).toContain(
      "Sofía never gives prices on insurance accounts, so these amounts in the Facts or Services box will not be said: "
      + "\"$500 deposit to hold the date\". You can take them out.",
    );
    expect(text).not.toContain("gives prices only from Services & prices");
  });

  it("flags amounts on insurance with NO price list too: there no amount is ever said (mutation: gate on the list alone -> FAILS)", () => {
    const text = renderedText(render({ facts: FACTS, hasPriceList: false, insurance: true }));
    expect(text).toContain(m["voice.facts.amountsNoticeInsurance"].replaceAll("{persona}", "Sofía").replace("{amounts}", "\"$500 deposit to hold the date\""));
  });

  it("reads Spanish on a Spanish page", () => {
    const text = renderedText(render({ facts: FACTS, insurance: true, locale: "es" }));
    expect(text).toContain("Sofía nunca da precios en cuentas de seguros");
  });
});

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
        .replaceAll("{persona}", "Sofía")
        .replace("{amounts}", '"$500 deposit to hold the date", "$35 per guest"'),
    );
    // Typed out once (memory "Test vacuity"): the persona is named in BOTH sentences, and it is the Facts
    // or Services BOX.
    expect(text).toContain("these amounts in the Facts or Services box will not be said");
    expect(text).toContain("Add each amount Sofía should say as its own row (a deposit or a fee too), or take it out.");
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
