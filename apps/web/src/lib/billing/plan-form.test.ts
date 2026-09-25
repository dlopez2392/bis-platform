import { describe, it, expect } from "vitest";
import { m } from "@/lib/messages";
import {
  centsToDollars, formatCents, parseDollarsToCents, parsePlanForm, parseWholeNumber,
} from "./plan-form";

function form(over: Record<string, string | null> = {}): FormData {
  const base: Record<string, string | null> = {
    name: "Growth", monthlyPrice: "49.00",
    "allowance.voice_minutes": "500", "overage.voice_minutes": "0.12",
    "allowance.sms": "1,000", "overage.sms": "0.03",
    "allowance.ai_chats": "200", "overage.ai_chats": "0.25",
    "feature.voice_receptionist": "on", "feature.web_concierge": null,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...over })) if (v !== null) fd.set(k, v);
  return fd;
}

describe("parseDollarsToCents (integer arithmetic, never floats)", () => {
  it.each<[string, number]>([
    ["49", 4900], ["49.5", 4950], ["49.50", 4950],
    // The float trap: 0.29 * 100 === 28.999999999999996.
    ["0.29", 29],
    ["$1,049.00", 104900], [" 12 ", 1200], ["0.03", 3],
  ])("%s → %i cents (mutation: Math.round(parseFloat(s) * 100) is fine here but Math.floor is not → the 0.29 row FAILS)", (raw, cents) => {
    expect(parseDollarsToCents(raw)).toBe(cents);
  });

  it.each(["", "abc", "-5", "1.234", "1e3", "12.", "12345678"])(
    "refuses %j (mutation: accept any Number(s) → FAILS)", (raw) => {
      expect(parseDollarsToCents(raw)).toBeNull();
    });

  it.each(["49,00", "0,12", "1,00", ",100", "1,0,00", "1,0000"])(
    "refuses %j — a comma that is not a proper thousands group (mutation: restore .replace(/,/g,\"\") before validating → FAILS)",
    (raw) => {
      expect(parseDollarsToCents(raw)).toBeNull();
    });

  it("still accepts commas as proper thousands groups", () => {
    expect([parseDollarsToCents("1,049.00"), parseDollarsToCents("$1,049"), parseDollarsToCents("1,000,000")])
      .toEqual([104900, 104900, 100000000]);
  });
});

describe("parseWholeNumber", () => {
  it("accepts whole numbers with thousands commas and spaces", () => {
    expect([parseWholeNumber("0"), parseWholeNumber("1,000"), parseWholeNumber(" 500 ")]).toEqual([0, 1000, 500]);
  });

  it("refuses fractions, negatives, blanks and words (mutation: parseInt → '1.5' becomes 1, FAILS)", () => {
    expect([parseWholeNumber("1.5"), parseWholeNumber("-1"), parseWholeNumber(""), parseWholeNumber("abc")])
      .toEqual([null, null, null, null]);
  });

  it.each(["1,0", ",5", "1,00"])(
    "refuses %j — a comma that is not a proper thousands group (mutation: restore .replace(/,/g,\"\") before validating → FAILS)",
    (raw) => {
      expect(parseWholeNumber(raw)).toBeNull();
    });

  it("still accepts a comma as a proper thousands group", () => {
    expect(parseWholeNumber("1,000,000")).toBe(1000000);
  });
});

describe("centsToDollars / formatCents", () => {
  it("centsToDollars is the form's input value (mutation: drop the padStart → 3 cents reads 0.3, FAILS)", () => {
    expect([centsToDollars(4900), centsToDollars(3), centsToDollars(105)]).toEqual(["49.00", "0.03", "1.05"]);
  });

  it("formatCents is the display value with a dollar sign and thousands commas", () => {
    expect([formatCents(4900), formatCents(3), formatCents(104900)]).toEqual(["$49.00", "$0.03", "$1,049.00"]);
  });

  it("centsToDollars throws on a negative or non-integer input (mutation: drop the guard → FAILS)", () => {
    expect(() => centsToDollars(-5)).toThrow();
    expect(() => centsToDollars(1.5)).toThrow();
  });

  it("formatCents throws on a negative or non-integer input (mutation: drop the guard → FAILS)", () => {
    expect(() => formatCents(-5)).toThrow();
    expect(() => formatCents(1.5)).toThrow();
  });
});

describe("parsePlanForm", () => {
  it("parses a whole form into exact terms (mutation: swap allowance and overage for a meter → FAILS)", () => {
    expect(parsePlanForm(form())).toEqual({
      ok: true,
      terms: {
        name: "Growth", monthlyPriceCents: 4900,
        features: { voice_receptionist: true, web_concierge: false },
        allowances: { voice_minutes: 500, sms: 1000, ai_chats: 200 },
        overageCents: { voice_minutes: 12, sms: 3, ai_chats: 25 },
      },
    });
  });

  it("reads each feature box on its own (mutation: read the voice box for both → FAILS)", () => {
    const r = parsePlanForm(form({ "feature.voice_receptionist": null, "feature.web_concierge": "on" }));
    expect(r.ok && r.terms.features).toEqual({ voice_receptionist: false, web_concierge: true });
  });

  it("holds the same bounds the database does (mutation: < instead of <= on any bound → FAILS)", () => {
    const ok = (over: Record<string, string>) => parsePlanForm(form(over)).ok;
    expect([
      ok({ monthlyPrice: "0.50" }), ok({ monthlyPrice: "0.49" }),
      ok({ monthlyPrice: "10000.00" }), ok({ monthlyPrice: "10000.01" }),
      ok({ "overage.sms": "100.00" }), ok({ "overage.sms": "100.01" }),
      ok({ "allowance.sms": "1000000" }), ok({ "allowance.sms": "1000001" }),
      ok({ "allowance.sms": "0" }),
    ]).toEqual([true, false, true, false, true, false, true, false, true]);
  });

  it.each<[string, Record<string, string>, string]>([
    ["a blank name", { name: "   " }, m["plans.error.nameRequired"]],
    ["a 61-character name", { name: "x".repeat(61) }, m["plans.error.nameTooLong"]],
    ["a monthly price in words", { monthlyPrice: "forty" }, m["plans.error.monthlyPrice"]],
    ["a fractional text allowance", { "allowance.sms": "1.5" }, m["plans.error.allowance.sms"]],
    ["a chat overage over $100", { "overage.ai_chats": "150" }, m["plans.error.overage.ai_chats"]],
  ])("%s returns its own message (mutation: one generic message → FAILS)", (_label, over, error) => {
    expect(parsePlanForm(form(over))).toEqual({ ok: false, error });
  });

  it("accepts a 60-character name (mutation: > becomes >= on the length check → FAILS)", () => {
    expect(parsePlanForm(form({ name: "x".repeat(60) })).ok).toBe(true);
  });

  it("counts a name's length the way the DB's char_length does — by code point, not UTF-16 unit (mutation: [...name].length → name.length → FAILS)", () => {
    // 31 single-codepoint emoji: 31 code points, but 62 UTF-16 units (each is
    // a surrogate pair). Postgres's char_length counts code points.
    expect(parsePlanForm(form({ name: "\u{1F600}".repeat(31) })).ok).toBe(true);
  });

  it("trims the name before saving it (mutation: drop the trim → FAILS)", () => {
    const r = parsePlanForm(form({ name: " Growth " }));
    expect(r.ok && r.terms.name).toBe("Growth");
  });

  it("accepts a zero overage (mutation: enforce a 1-cent overage minimum → FAILS)", () => {
    expect(parsePlanForm(form({ "overage.sms": "0" })).ok).toBe(true);
  });

  it("refuses a name made only of invisible characters (mutation: drop the invisible-name check → FAILS)", () => {
    expect(parsePlanForm(form({ name: "​​" }))).toEqual({
      ok: false,
      error: m["plans.error.nameRequired"],
    });
  });
});
