import { describe, it, expect } from "vitest";
import { contactSearchPlan, phoneMatches, MAX_NAME_TOKENS } from "./contact-search";
import { phoneDigits } from "./contacts";

/**
 * F-092 part 1 (plan Task 2): contactSearchPlan reads a typed search as folded name words and,
 * when the term looks phone-shaped, phone digits with the "+" country-code rule and the 4-digit
 * floor (owner ruling Q2). Pure — no Supabase variable in this shell.
 */

describe("contactSearchPlan — phone reading (spec 4.2 table)", () => {
  it.each([
    ["(956) 555-0199", { key: "9565550199", national: null }],
    ["956.555.0199", { key: "9565550199", national: null }],
    ["9565550199", { key: "9565550199", national: null }],
    ["+1 956 555 0199", { key: "9565550199", national: null }],
    ["0199", { key: "0199", national: null }],
    ["899 123 4567", { key: "8991234567", national: null }],
    ["+52 1 899 123 4567", { key: "528991234567", national: "8991234567" }],
    ["044 899 123 4567", { key: "0448991234567", national: "8991234567" }],
  ] as const)("contactSearchPlan(%j).phone = %j", (term, expected) => {
    expect(contactSearchPlan(term).phone).toEqual(expected);
  });

  it('"+521 899 12" keeps the 521 branch (mutation: drop the 521 branch -> FAILS)', () => {
    expect(contactSearchPlan("+521 899 12").phone).toEqual({ key: "5289912", national: null });
  });

  it('"+1 956 55" keeps the plus-and-leading-1 branch (mutation: drop the plus && "1" branch -> FAILS)', () => {
    expect(contactSearchPlan("+1 956 55").phone).toEqual({ key: "95655", national: null });
  });

  it.each(["956", "+1 956", "(99)"])(
    "%j has fewer than 4 digits and is not a phone search (mutation: floor 3 -> FAILS)",
    (term) => {
      expect(contactSearchPlan(term).phone).toBeNull();
    },
  );

  it.each(["Suite 9", "maria5@example.com", "john2026@x.com", "Unit 1234 Main"])(
    "%j does not look phone-shaped, however many digits it carries (mutation: drop the shape check -> FAILS)",
    (term) => {
      expect(contactSearchPlan(term).phone).toBeNull();
    },
  );
});

describe("contactSearchPlan — agreement with today's phoneDigits for every non-plus phone-shaped term", () => {
  it.each([
    "(956) 555-0199",
    "9565550199",
    "19565550199",
    "0199",
    "1-800",
    "899 123 4567",
    "044 899 123 4567",
  ])("contactSearchPlan(%j).phone?.key === phoneDigits(%j).slice(0, 20)", (term) => {
    expect(contactSearchPlan(term).phone?.key).toBe(phoneDigits(term).slice(0, 20));
  });
});

describe("contactSearchPlan — name tokens", () => {
  it("folds and splits a full name", () => {
    expect(contactSearchPlan("María García").tokens).toEqual(["maria", "garcia"]);
  });

  it("folds case and accents together", () => {
    expect(contactSearchPlan("GARCÍA-LÓPEZ").tokens).toEqual(["garcia", "lopez"]);
  });

  it("ñ and n match both ways (Q1)", () => {
    expect(contactSearchPlan("Peña").tokens).toEqual(["pena"]);
    expect(contactSearchPlan("Pena").tokens).toEqual(["pena"]);
  });

  it("an apostrophe splits into two tokens", () => {
    expect(contactSearchPlan("O'Brien").tokens).toEqual(["o", "brien"]);
  });

  it("a combining-mark accent folds the same as a precomposed one", () => {
    expect(contactSearchPlan("Jose\u0301").tokens).toEqual(["jose"]);
  });

  it("a name with no [a-z0-9] content folds to no tokens", () => {
    expect(contactSearchPlan("李").tokens).toEqual([]);
  });

  it(`caps at ${MAX_NAME_TOKENS} tokens (mutation: drop the cap -> FAILS)`, () => {
    expect(contactSearchPlan("a b c d e f g h").tokens).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("caps a single run-on token at 80 characters", () => {
    expect(contactSearchPlan("a".repeat(100)).tokens).toEqual(["a".repeat(80)]);
  });
});

describe("contactSearchPlan — hostile input", () => {
  it.each(["a,b)(or(id.eq.x%_*\\\"'", "%", "()"])(
    "every token from %j matches /^[a-z0-9]+$/ (mutation: tokens from term.toLowerCase().split(' ') -> FAILS)",
    (term) => {
      const { tokens } = contactSearchPlan(term);
      for (const t of tokens) expect(t).toMatch(/^[a-z0-9]+$/);
    },
  );
});

describe("phoneMatches", () => {
  it("a short-digit plan matches a stored number containing it, not a near miss", () => {
    const plan = contactSearchPlan("0199");
    expect(phoneMatches(plan, "+19565550199")).toBe(true);
    expect(phoneMatches(plan, "+19565550200")).toBe(false);
  });

  it("a Mexican legacy-prefix plan matches both the stored key shape and the national shape", () => {
    const plan = contactSearchPlan("+52 1 899 123 4567");
    expect(phoneMatches(plan, "+528991234567")).toBe(true);
    expect(phoneMatches(plan, "(899) 123-4567")).toBe(true);
  });

  it("a name-only plan matches nothing", () => {
    const plan = contactSearchPlan("garcia");
    expect(phoneMatches(plan, "+19565550199")).toBe(false);
  });
});
