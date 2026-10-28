import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import { pseudoLocale } from "@/lib/i18n/pseudo-locale";
import { checkTradeChoice, tradeEntry, sofiaGate } from "./trades";
import { tradeOptionGroups, tradeChoiceRefusal, sofiaGateText } from "./copy";

describe("tradeOptionGroups", () => {
  it("lists every trade once, grouped, in the asked language", () => {
    const en = tradeOptionGroups("en");
    const es = tradeOptionGroups("es");
    expect(en.flatMap((g) => g.options)).toHaveLength(30);
    expect(en[0]).toMatchObject({ key: "home_services", label: "Home services" });
    expect(en[0]!.options[0]).toEqual({ value: "hvac", label: "Heating and air conditioning" });
    expect(es[0]!.options[0]).toEqual({ value: "hvac", label: "Aire acondicionado y calefacción" });
  });
  it("wraps labels for the pseudo-locale but never the values", () => {
    const p = tradeOptionGroups("en", true);
    expect(p[0]!.label).toBe(pseudoLocale("Home services"));
    expect(p[0]!.options[0]!.value).toBe("hvac");
  });
});

describe("tradeChoiceRefusal", () => {
  it("a held trade is refused with its own reason, in both languages", () => {
    const r = checkTradeChoice("law", null);
    if (r.ok) throw new Error("expected a refusal");
    expect(tradeChoiceRefusal(r, "en")).toBe(tradeEntry("law")!.reason!.en);
    expect(tradeChoiceRefusal(r, "es")).toBe(tradeEntry("law")!.reason!.es);
  });
  it("missing and other-description refusals read the catalogue", () => {
    const missing = checkTradeChoice("", null);
    const other = checkTradeChoice("other", "");
    if (missing.ok || other.ok) throw new Error("expected refusals");
    expect(tradeChoiceRefusal(missing, "es")).toBe(m["vetting.error.missing.es"]);
    expect(tradeChoiceRefusal(other, "en")).toBe(m["vetting.error.otherDescription"]);
  });
});

describe("sofiaGateText", () => {
  it("names a CRM-only trade in lower case, in both languages", () => {
    const g = sofiaGate("child_care");
    if (g.ok) throw new Error("expected closed");
    expect(sofiaGateText(g, "en")).toBe("Sofía and the web chat aren't available for child care businesses yet.");
    expect(sofiaGateText(g, "es")).toBe("Sofía y el chat del sitio web aún no están disponibles para el giro guardería.");
  });
  it("asks for the trade when there is none", () => {
    const g = sofiaGate(null);
    if (g.ok) throw new Error("expected closed");
    expect(sofiaGateText(g, "en")).toBe(m["vetting.sofia.noTrade"]);
    expect(sofiaGateText(g, "en", true)).toBe(pseudoLocale(m["vetting.sofia.noTrade"]));
  });
});
