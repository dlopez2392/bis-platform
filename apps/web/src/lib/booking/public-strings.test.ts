import { describe, it, expect } from "vitest";
import { bookingStrings, intlLocale } from "./public-strings";

const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;

/**
 * The ONLY sanctioned way past the "actually translates" test below, each with
 * its reason. Anything not named here must genuinely differ between the two
 * languages — an English string pasted into the `es` block is the failure this
 * catalogue's tests exist to catch, and a silent carve-out would let exactly
 * that through.
 *
 * The test below also asserts each of these IS still identical, so an entry
 * that stops being true reports itself instead of quietly going stale.
 */
const DELIBERATELY_UNTRANSLATED: Record<string, string> = {
  poweredBy: "a brand name is a proper noun — 'BIS' is not a sentence to localise",
};

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
      if (key in DELIBERATELY_UNTRANSLATED) continue;
      expect(es[key], key).not.toBe(en[key]);
    }
  });

  it("keeps its untranslated carve-outs honest", () => {
    const en = bookingStrings("en");
    const es = bookingStrings("es");
    for (const [key, reason] of Object.entries(DELIBERATELY_UNTRANSLATED)) {
      expect(Object.keys(en), `${key} is exempted but no longer exists`).toContain(key);
      expect(
        es[key as keyof typeof es],
        `${key} is exempted (${reason}) but the two languages now differ — drop the exemption`,
      ).toBe(en[key as keyof typeof en]);
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
