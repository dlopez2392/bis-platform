import { describe, it, expect } from "vitest";
import { priceSentence, formatUsd, PRICE_KINDS, type PricedService } from "./price-sentence";

/**
 * Spec section 5.1's table, copied VERBATIM (owner's read, C18, 2026-10-23). The twelve instantiated sentences
 * below are typed out in full; this table is here so a reviewer can hold the two side by side, and the last case
 * checks the instantiation against it with a test-side fill (never priceSentence itself).
 */
const SPEC_TABLE: Record<string, readonly [string, string]> = {
  fixed: ["The price for {N} is {A}.", "El precio de {N} es {A}."],
  from: ["The price for {N} starts at {A}.", "El precio de {N} es desde {A}."],
  range: ["The price for {N} is between {A} and {B}.", "El precio de {N} es de {A} a {B}."],
  per_unit: ["The price for {N} is {A} per {U}.", "El precio de {N} es {A} por {U}."],
  free: ["There is no charge for {N}.", "{N} no tiene costo."],
  after_visit: ["The price for {N} is given after a visit.", "El precio de {N} se lo damos después de una visita."],
};

const base = { name_es: null, amount_cents: null, amount_max_cents: null, unit_en: null, unit_es: null } as const;
const ROWS: Array<[string, PricedService, string, string]> = [
  ["fixed", { ...base, name_en: "Haircut", name_es: "Corte de cabello", price_kind: "fixed", amount_cents: 2500 },
    "The price for Haircut is $25.", "El precio de Corte de cabello es $25."],
  ["from", { ...base, name_en: "Roof repair", name_es: "Reparación de techo", price_kind: "from", amount_cents: 15000 },
    "The price for Roof repair starts at $150.", "El precio de Reparación de techo es desde $150."],
  ["range", { ...base, name_en: "Gutter cleaning", name_es: "Limpieza de canaletas", price_kind: "range", amount_cents: 12000, amount_max_cents: 25050 },
    "The price for Gutter cleaning is between $120 and $250.50.", "El precio de Limpieza de canaletas es de $120 a $250.50."],
  ["per_unit", { ...base, name_en: "Catering", name_es: "Banquete", price_kind: "per_unit", amount_cents: 3500, unit_en: "guest", unit_es: "invitado" },
    "The price for Catering is $35 per guest.", "El precio de Banquete es $35 por invitado."],
  ["free", { ...base, name_en: "Estimate", name_es: "Presupuesto", price_kind: "free" },
    "There is no charge for Estimate.", "Presupuesto no tiene costo."],
  ["after_visit", { ...base, name_en: "Full replacement", name_es: "Reemplazo completo", price_kind: "after_visit" },
    "The price for Full replacement is given after a visit.", "El precio de Reemplazo completo se lo damos después de una visita."],
];

describe("priceSentence: the twelve sentences (C18; mutation: change one word in any template -> FAILS)", () => {
  it("covers every kind exactly once, in PRICE_KINDS order (guards the loop)", () => {
    expect(ROWS.map((r) => r[0])).toEqual([...PRICE_KINDS]);
    expect(PRICE_KINDS).toEqual(["fixed", "from", "range", "per_unit", "free", "after_visit"]);
  });
  it.each(ROWS)("%s, English and Spanish", (_k, s, en, es) => {
    expect(priceSentence(s, "en")).toBe(en);
    expect(priceSentence(s, "es")).toBe(es);
  });
  it("each typed sentence is the spec table's template, filled (a test-side fill, not the function under test)", () => {
    const fill = (t: string, v: Record<string, string>) => t.replace(/\{([NABU])\}/g, (_m, k: string) => v[k]!);
    for (const [kind, s, en, es] of ROWS) {
      const a = s.amount_cents === null ? "" : formatUsd(s.amount_cents);
      const b = s.amount_max_cents === null ? "" : formatUsd(s.amount_max_cents);
      expect(fill(SPEC_TABLE[kind]![0], { N: s.name_en, A: a, B: b, U: s.unit_en ?? "" })).toBe(en);
      expect(fill(SPEC_TABLE[kind]![1], { N: s.name_es ?? s.name_en, A: a, B: b, U: s.unit_es ?? "" })).toBe(es);
    }
  });
});

describe("priceSentence: names, amounts, refusals", () => {
  it("Spanish falls back to the English name when there is no Spanish name (C2; mutation: drop the fallback -> FAILS)", () => {
    expect(priceSentence({ ...base, name_en: "Haircut", price_kind: "fixed", amount_cents: 2500 }, "es")).toBe("El precio de Haircut es $25.");
  });
  it("English never uses the Spanish name", () => {
    expect(priceSentence({ ...base, name_en: "Haircut", name_es: "Corte", price_kind: "free" }, "en")).toBe("There is no charge for Haircut.");
  });
  it.each([
    [2500, "$25"], [2550, "$25.50"], [2505, "$25.05"], [120000, "$1,200"], [123456, "$1,234.56"], [100000000, "$1,000,000"], [1, "$0.01"],
  ] as const)("formatUsd(%i) is %s, the same in both languages (mutation: toFixed(2) always -> FAILS)", (cents, text) => {
    expect(formatUsd(cents)).toBe(text);
    expect(priceSentence({ ...base, name_en: "X", price_kind: "fixed", amount_cents: cents }, "es")).toBe(`El precio de X es ${text}.`);
  });
  it.each([
    ["a fixed price without its amount", { ...base, name_en: "X", price_kind: "fixed" }, "en"],
    ["a range without its maximum", { ...base, name_en: "X", price_kind: "range", amount_cents: 100 }, "en"],
    ["a range whose maximum is not above its amount", { ...base, name_en: "X", price_kind: "range", amount_cents: 100, amount_max_cents: 100 }, "es"],
    ["a per_unit without its English unit", { ...base, name_en: "X", price_kind: "per_unit", amount_cents: 100, unit_es: "hora" }, "en"],
    ["a per_unit without its Spanish unit (C16: no English fallback)", { ...base, name_en: "X", price_kind: "per_unit", amount_cents: 100, unit_en: "hour" }, "es"],
  ] as const)("throws on %s (mutation: fall back to the English unit -> the C16 case FAILS)", (_n, s, lang) => {
    expect(() => priceSentence(s as PricedService, lang)).toThrow(/priceSentence/);
  });
});
