// S-10 T7 (spec §6 T7, §7 Q5): the browser's language picks ONLY the
// signed-out pages (/sign-in, /, /no-access, /billing-done) — never after
// sign-in, where the person's own choice or the account's language governs
// (decision 1/3, unchanged). `localeFromAcceptLanguage` is the pure parser;
// `resolveRootLang` is the root layout's own locale helper (G8): a resolved
// session locale wins when one exists, Accept-Language only when it does not
// (nobody signed in).
import { describe, it, expect } from "vitest";
import { localeFromAcceptLanguage, resolveRootLang } from "./accept-language";

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
});

describe("resolveRootLang (G8: the root layout's own locale helper)", () => {
  it("a resolved session locale wins outright, no header consulted", () => {
    expect(resolveRootLang("es", "en-US")).toBe("es");
    expect(resolveRootLang("en", "es-MX")).toBe("en");
  });

  it("no session (signed out): Accept-Language decides, spec's own two examples", () => {
    expect(resolveRootLang(null, "es-MX,en;q=0.5")).toBe("es");
    expect(resolveRootLang(null, "en-US,es;q=0.9")).toBe("en");
  });

  it("no session and no header: English (mutation: default to es → FAILS)", () => {
    expect(resolveRootLang(null, null)).toBe("en");
  });
});
