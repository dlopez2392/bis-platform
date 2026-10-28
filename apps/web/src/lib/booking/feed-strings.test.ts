import { describe, it, expect } from "vitest";
import { feedStrings } from "./feed-strings";

const INTERNAL_MILESTONE = /\bM\d[a-z]?\b/;
describe("feedStrings", () => {
  it("carries the same keys in both languages, none empty, no milestone code, template syntax or arrow (mutation: add 'F-048' → FAILS)", () => {
    const en = feedStrings("en"), es = feedStrings("es");
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    for (const s of [en, es]) for (const [k, v] of Object.entries(s)) {
      expect(v.trim(), k).not.toBe("");
      expect(v, k).not.toMatch(INTERNAL_MILESTONE);
      expect(v, k).not.toMatch(/F-\d{3}|\{\{|→|←|↑|↓/);
    }
  });
  it("is Spanish for es and English for en", () => {
    expect(feedStrings("es").kind_in_person).toBe("Cita");
    expect(feedStrings("en").kind_in_person).toBe("Appointment");
  });
});
