import { describe, it, expect } from "vitest";
import { bookingStrings, intlLocale } from "./public-strings";

const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;

describe("bookingStrings", () => {
  it("carries the same keys in both languages, none empty", () => {
    const en = bookingStrings("en");
    const es = bookingStrings("es");
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries({ ...en, ...es })) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("actually translates: no Spanish value is the English one verbatim, except the shared placeholder shape", () => {
    const en = bookingStrings("en");
    const es = bookingStrings("es");
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(es[key], key).not.toBe(en[key]);
    }
  });

  it("keeps the {zone} placeholder the page substitutes, in both languages", () => {
    expect(bookingStrings("en").timezoneLabel).toContain("{zone}");
    expect(bookingStrings("es").timezoneLabel).toContain("{zone}");
  });

  // Same rule `messages.test.ts` pins for the dashboard catalogue: a stranger
  // must never read an internal roadmap label.
  it("cites no internal roadmap label", () => {
    for (const locale of ["en", "es"] as const) {
      for (const [key, value] of Object.entries(bookingStrings(locale))) {
        expect(value, `${locale}.${key}`).not.toMatch(INTERNAL_MILESTONE);
      }
    }
  });
});

describe("intlLocale", () => {
  it("is always an explicit tag, never undefined", () => {
    expect(intlLocale("en")).toBe("en-US");
    expect(intlLocale("es")).toBe("es-US");
  });
});
