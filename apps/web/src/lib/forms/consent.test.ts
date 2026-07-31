import { describe, it, expect } from "vitest";
import { normalizeConsent } from "./consent";

describe("normalizeConsent", () => {
  it("passes through the current array shape", () => {
    const stored = [
      { key: "marketing", given: true, text: "Email me about my quote", at: "2026-07-30T12:00:00Z" },
      { key: "sms", given: false, text: "Text me too", at: "2026-07-30T12:00:00Z" },
    ];
    expect(normalizeConsent(stored)).toEqual(stored);
  });

  it("wraps the legacy single-object shape written before 360190f", () => {
    // jsonb accepted both shapes, so the oldest rows — the ones most likely to
    // be the subject of a "prove they agreed" question — hold a bare object.
    const legacy = { given: true, text: "I agree to be contacted", at: "2026-07-01T09:00:00Z" };
    expect(normalizeConsent(legacy)).toEqual([
      { key: "consent_0", given: true, text: "I agree to be contacted", at: "2026-07-01T09:00:00Z" },
    ]);
  });

  it("treats null, undefined and an empty array as no consent recorded", () => {
    expect(normalizeConsent(null)).toEqual([]);
    expect(normalizeConsent(undefined)).toEqual([]);
    expect(normalizeConsent([])).toEqual([]);
  });

  it("drops entries with no text, which prove nothing", () => {
    // Rendering "Agreed" beside no text would imply more than the row supports.
    expect(normalizeConsent([{ key: "a", given: true, text: "   ", at: "" }])).toEqual([]);
    expect(normalizeConsent([{ key: "a", given: true }])).toEqual([]);
    expect(normalizeConsent(["nonsense", 42, null])).toEqual([]);
  });

  it("treats any non-true `given` as not given rather than as agreement", () => {
    const [entry] = normalizeConsent([{ key: "a", given: "yes", text: "Terms", at: "" }]);
    expect(entry!.given).toBe(false);
  });
});
