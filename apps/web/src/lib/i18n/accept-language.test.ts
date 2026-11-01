// S-10 T7 (spec §6 T7, §7 Q5): the browser's language picks ONLY the
// signed-out pages (/sign-in, /, /no-access, /billing-done) — never after
// sign-in, where the person's own choice or the account's language governs
// (decision 1/3, unchanged). `localeFromAcceptLanguage` is the pure parser.
import { describe, it, expect } from "vitest";
import { localeFromAcceptLanguage } from "./accept-language";

describe("localeFromAcceptLanguage", () => {
  it("any es/es-* range ranked above every en range gives Spanish (spec's own example)", () => {
    expect(localeFromAcceptLanguage("es-MX,en;q=0.5")).toBe("es");
    expect(localeFromAcceptLanguage("es,en;q=0.9")).toBe("es");
    expect(localeFromAcceptLanguage("es-419,en;q=0.3")).toBe("es");
    expect(localeFromAcceptLanguage("es-US")).toBe("es");
  });

  it("an en range ranked above every es range gives English (spec's own example)", () => {
    expect(localeFromAcceptLanguage("en-US,es;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("en,es;q=0.1")).toBe("en");
  });

  it("q-values decide rank regardless of list order (mutation: read list order instead of q → FAILS)", () => {
    expect(localeFromAcceptLanguage("en;q=0.3,es;q=0.8")).toBe("es");
    expect(localeFromAcceptLanguage("es;q=0.3,en;q=0.8")).toBe("en");
  });

  it("a missing q defaults to 1, outranking an explicit lower q (mutation: default q to 0 → FAILS)", () => {
    expect(localeFromAcceptLanguage("es,en;q=0.99")).toBe("es");
  });

  it("no es or en range at all defaults to English (mutation: throw instead → FAILS)", () => {
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.8")).toBe("en");
  });

  it("no header at all (null/undefined/empty) defaults to English", () => {
    expect(localeFromAcceptLanguage(null)).toBe("en");
    expect(localeFromAcceptLanguage(undefined)).toBe("en");
    expect(localeFromAcceptLanguage("")).toBe("en");
  });

  it("is case-insensitive on the language subtag (mutation: compare without lowercasing → FAILS)", () => {
    expect(localeFromAcceptLanguage("ES-mx,EN;q=0.5")).toBe("es");
  });

  it("whitespace around ranges and q-pairs does not break parsing", () => {
    expect(localeFromAcceptLanguage(" es-MX ,  en;q=0.5 ")).toBe("es");
  });

  it("the wildcard range matches neither es nor en, so it defers to a later real range", () => {
    expect(localeFromAcceptLanguage("*;q=0.8,es;q=0.3")).toBe("es");
  });

  it("a range with q=0 means 'not acceptable' and can never select its language (RFC 9110 §12.4.2)", () => {
    expect(localeFromAcceptLanguage("es;q=0")).toBe("en");
    expect(localeFromAcceptLanguage("es;q=0.0, fr")).toBe("en");
    expect(localeFromAcceptLanguage("fr, es;q=0.000")).toBe("en");
  });

  it("a malformed q-value is dropped, not ranked, so it can never select its language", () => {
    expect(localeFromAcceptLanguage("fr, es;q=abc")).toBe("en");
    expect(localeFromAcceptLanguage("es;q=1.5")).toBe("en");
    expect(localeFromAcceptLanguage("es;q=-1")).toBe("en");
  });

  it("an en range at q=0 does not stop a lower-ranked but acceptable es range", () => {
    expect(localeFromAcceptLanguage("en;q=0, es;q=0.1")).toBe("es");
  });

  it("at equal q the range listed FIRST wins — the order a browser states its preference in (mutation: reverse the tie-break → FAILS)", () => {
    expect(localeFromAcceptLanguage("en,es")).toBe("en");
    expect(localeFromAcceptLanguage("es,en")).toBe("es");
    expect(localeFromAcceptLanguage("en;q=0.5,es;q=0.5")).toBe("en");
    expect(localeFromAcceptLanguage("es;q=0.5,en;q=0.5")).toBe("es");
  });

  it("the q parameter name is case-insensitive (RFC 9110 §5.6.6), so Q=0 still refuses", () => {
    expect(localeFromAcceptLanguage("es;Q=0")).toBe("en");
    expect(localeFromAcceptLanguage("en;Q=0.1, es;Q=0.9")).toBe("es");
  });
});

