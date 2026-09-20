import { describe, it, expect } from "vitest";
import { assistantStrings, assistantErrorBody } from "./public-strings";

const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;

describe("assistantStrings", () => {
  it("carries the same keys in both languages, none empty", () => {
    const en = assistantStrings("en");
    const es = assistantStrings("es");
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const [key, value] of Object.entries({ ...en, ...es })) {
      expect(value.trim(), key).not.toBe("");
    }
  });

  it("actually translates: no Spanish value is the English one verbatim", () => {
    const en = assistantStrings("en");
    const es = assistantStrings("es");
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(es[key], key).not.toBe(en[key]);
    }
  });

  it("keeps the {phone} placeholder the widget substitutes, in both languages", () => {
    expect(assistantStrings("en").errorBodyWithPhone).toContain("{phone}");
    expect(assistantStrings("es").errorBodyWithPhone).toContain("{phone}");
  });

  // Same rule `messages.test.ts` and `booking/public-strings.test.ts` both
  // pin for their own catalogues: a stranger on a client's website must
  // never read an internal roadmap label.
  it("cites no internal roadmap label", () => {
    for (const locale of ["en", "es"] as const) {
      for (const [key, value] of Object.entries(assistantStrings(locale))) {
        expect(value, `${locale}.${key}`).not.toMatch(INTERNAL_MILESTONE);
      }
    }
  });
});

describe("assistantErrorBody", () => {
  it("falls back to the generic sentence with no phone", () => {
    expect(assistantErrorBody(assistantStrings("en"), null)).toBe(
      assistantStrings("en").errorBody,
    );
  });

  it("fills the phone into the templated sentence when one is given", () => {
    expect(assistantErrorBody(assistantStrings("en"), "(956) 555-0101")).toBe(
      "We couldn't send that. Please try again in a moment, or call (956) 555-0101.",
    );
  });
});
