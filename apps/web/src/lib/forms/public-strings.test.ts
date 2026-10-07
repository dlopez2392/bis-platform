import { describe, it, expect } from "vitest";
import { publicStrings, normalizeLocale, publicTabTitle } from "./public-strings";

const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;

describe("publicStrings", () => {
  it("carries the same keys in both languages, none empty", () => {
    const en = publicStrings("en");
    const es = publicStrings("es");
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries({ ...en, ...es })) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("actually translates: no Spanish value is the English one verbatim, except the shared placeholder shape", () => {
    const en = publicStrings("en");
    const es = publicStrings("es");
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(es[key], key).not.toBe(en[key]);
    }
  });

  // F-102: the business's own name in a tab title and a not-found page's
  // apology — see `app/f/[publicId]/page.tsx`'s `generateMetadata` and
  // `app/f/[publicId]/not-found.tsx`.
  it("keeps the {business} placeholder the caller substitutes, in both languages", () => {
    expect(publicStrings("en").tabTitleWithBrand).toContain("{business}");
    expect(publicStrings("es").tabTitleWithBrand).toContain("{business}");
  });

  it("cites no internal roadmap label", () => {
    for (const locale of ["en", "es"] as const) {
      for (const [key, value] of Object.entries(publicStrings(locale))) {
        expect(value, `${locale}.${key}`).not.toMatch(INTERNAL_MILESTONE);
      }
    }
  });
});

describe("publicTabTitle — the tab title shown for /f, /b and /c alike", () => {
  it("substitutes the business name into the branded template", () => {
    expect(publicTabTitle(publicStrings("en"), "Acme Plumbing")).toBe("Acme Plumbing · Form");
    expect(publicTabTitle(publicStrings("es"), "Acme Plumbing")).toBe("Acme Plumbing · Formulario");
  });

  it("falls back to the brand-free title when the business name is blank", () => {
    // MUTATION: use tabTitleWithBrand with an empty substitution instead --
    // this FAILS (the title would be " · Form", a leading separator and no
    // name, rather than plain "Form").
    expect(publicTabTitle(publicStrings("en"), "")).toBe("Form");
    expect(publicTabTitle(publicStrings("es"), "")).toBe("Formulario");
  });
});

describe("normalizeLocale", () => {
  it("accepts only en/es, falling back otherwise", () => {
    expect(normalizeLocale("es", "en")).toBe("es");
    expect(normalizeLocale("en", "es")).toBe("en");
    expect(normalizeLocale("fr", "en")).toBe("en");
    expect(normalizeLocale(undefined, "es")).toBe("es");
  });
});
