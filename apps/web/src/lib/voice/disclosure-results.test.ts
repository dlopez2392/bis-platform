import { describe, it, expect } from "vitest";
import { disclosureResultsView, DISCLOSURE_MIN_PER_HALF } from "./disclosure-results";

const half = (counted: number, booked = 0, abandoned = 0, askedPerson = 0) => ({ counted, booked, abandoned, askedPerson });

describe("disclosureResultsView", () => {
  it("is empty when neither half has a counted call, and carries the footnote's count into it (mutation: drop notCounted from the empty view -> FAILS)", () => {
    expect(disclosureResultsView({ said: half(0), didnt: half(0), notCounted: 12 })).toEqual({ state: "empty", notCounted: 12 });
    expect(disclosureResultsView({ said: half(0), didnt: half(0), notCounted: 0 })).toEqual({ state: "empty", notCounted: 0 });
  });
  it("percentages are whole numbers of the half's own counted calls (37.5 rounds to 38; 1/3 to 33; 1/8 to 13) (mutation: askedPersonPct from abandoned → FAILS)", () => {
    expect(disclosureResultsView({ said: half(8, 3, 1, 2), didnt: half(3, 1, 1, 0), notCounted: 2 })).toEqual({
      state: "loaded",
      said: { counted: 8, bookedPct: 38, hungUpPct: 13, askedPersonPct: 25 },
      didnt: { counted: 3, bookedPct: 33, hungUpPct: 33, askedPersonPct: 0 },
      notEnough: true, notCounted: 2,
    });
  });
  it("a half with no counted calls shows no percentage, not 0%", () => {
    const v = disclosureResultsView({ said: half(2, 1, 0), didnt: half(0), notCounted: 0 });
    expect(v).toMatchObject({ state: "loaded", didnt: { counted: 0, bookedPct: null, hungUpPct: null, askedPersonPct: null } });
  });
  it("the threshold is 30 per half, and BOTH halves must reach it (mutations: >= → > FAILS at 30/30; && → || FAILS at 30/29)", () => {
    expect(DISCLOSURE_MIN_PER_HALF).toBe(30);
    const at = (a: number, b: number) => disclosureResultsView({ said: half(a), didnt: half(b), notCounted: 0 });
    expect(at(30, 30)).toMatchObject({ notEnough: false });
    expect(at(30, 29)).toMatchObject({ notEnough: true });
    expect(at(29, 30)).toMatchObject({ notEnough: true });
    expect(at(29, 29)).toMatchObject({ notEnough: true });
  });
});
