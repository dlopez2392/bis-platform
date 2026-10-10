import { describe, it, expect } from "vitest";
import { pseudoLocale } from "./pseudo-locale";

describe("pseudoLocale", () => {
  it("pads length by at least 35% and wraps in brackets so truncation is visible (mutation: return the text unchanged → FAILS both assertions)", () => {
    const out = pseudoLocale("Dashboard");
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil("Dashboard".length * 1.35));
    expect(out.startsWith("[")).toBe(true);
    expect(out.endsWith("]")).toBe(true);
  });

  it("accents every vowel, both cases, so font-coverage gaps are visible (mutation: accent only a → FAILS)", () => {
    const out = pseudoLocale("aeiou AEIOU");
    // All vowels should be accented: this exact substring must be present
    expect(out).toContain("áéíóú ÁÉÍÓÚ");
  });

  it("never mutates a {placeholder} token's own characters, so t()'s interpolate() can still find and replace it verbatim (mutation: accent vowels across the whole string including inside the braces → the literal substring '{count}' is gone, replaced by '{cóúnt}', FAILING this assertion)", () => {
    const out = pseudoLocale("You have {count} calls today");
    expect(out).toContain("{count}");
  });

  it("still pads and accents the copy around a placeholder, not just passes the string through untouched (mutation: return the input unchanged whenever it contains a brace → FAILS this assertion because the surrounding words keep their plain vowels)", () => {
    const out = pseudoLocale("You have {count} calls today");
    expect(out).toMatch(/[ÁÉÍÓÚáéíóú]/);
    expect(out.length).toBeGreaterThanOrEqual(Math.ceil("You have {count} calls today".length * 1.35));
  });
});
