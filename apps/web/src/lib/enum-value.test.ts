import { describe, it, expect } from "vitest";
import { validateEnumValue } from "./enum-value";
import { LANGUAGE_OPTIONS } from "./i18n/language-options";

// Moved out of inline-field.tsx (a "use client" module, whose exports a
// server action cannot call — on the server they are client references, not
// functions) so the Settings Language action really does run the same check
// the field runs, as validateEnumValue's doc always claimed.
describe("validateEnumValue", () => {
  it("accepts a listed value, rejects anything else (mutation: drop the option lookup and always return ok:true → FAILS the second assertion)", () => {
    expect(validateEnumValue(LANGUAGE_OPTIONS, "es")).toEqual({ ok: true, value: "es" });
    expect(validateEnumValue(LANGUAGE_OPTIONS, "fr").ok).toBe(false);
  });

  it("compares exactly — no trimming or case folding turns a near-miss into a value (mutation: compare raw.trim().toLowerCase() → FAILS)", () => {
    expect(validateEnumValue(LANGUAGE_OPTIONS, " es").ok).toBe(false);
    expect(validateEnumValue(LANGUAGE_OPTIONS, "ES").ok).toBe(false);
  });
});

describe("LANGUAGE_OPTIONS", () => {
  it("offers exactly English and Español, labelled in their own language (mutation: label es as \"Spanish\" → FAILS)", () => {
    expect(LANGUAGE_OPTIONS).toEqual([{ value: "en", label: "English" }, { value: "es", label: "Español" }]);
  });
});
