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

  // F-102: the booking and cancel tab titles (`generateMetadata` in
  // `app/b/[publicId]/(book)/page.tsx` and `.../cancel/[token]/page.tsx`).
  // `{business}` is the customer-facing name, substituted by the caller.
  it("keeps the {business} placeholder the caller substitutes, in both languages, for every tab-title key", () => {
    for (const locale of ["en", "es"] as const) {
      expect(bookingStrings(locale).tabTitleWithBrand).toContain("{business}");
      expect(bookingStrings(locale).cancelTabTitleWithBrand).toContain("{business}");
      expect(bookingStrings(locale).moveTabTitleWithBrand).toContain("{business}");
    }
  });

  // D-033: a screen claims an email only when one is known to have gone.
  // An old link after a move, or a move refused because the booking changed,
  // cannot know that (no address, a suppressed one, a phone reschedule whose
  // email failed), so neither may point at "your email" (fix round 1, m2).
  it("never sends the reader to an email that may not exist, on the two screens that cannot know (mutation: put \"your newest email\" back → FAILS)", () => {
    for (const locale of ["en", "es"] as const) {
      const s = bookingStrings(locale);
      for (const key of ["movedTitle", "moveAlreadyChanged"] as const) {
        expect(s[key], `${locale}.${key}`).not.toMatch(/e-?mail|correo/i);
      }
    }
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
