import { describe, it, expect } from "vitest";
import { formatClosedDayRange } from "./range-format";

// S-47d Task 12 (orchestrator ruling, 2026-10-23): the ONE formatter the Closed days card uses for a
// range. Literals, never re-derived from the same arrays the function under test uses (Global
// Constraints: "Prompt lines, topbar forms and copy are asserted as typed-out literals").
describe("formatClosedDayRange", () => {
  it("one day, English (mutation: always use the range form -> FAILS)", () => {
    expect(formatClosedDayRange("2026-12-24", "2026-12-24", "en")).toBe("Thursday, December 24");
  });

  it("one day, Spanish (mutation: always use the range form -> FAILS)", () => {
    expect(formatClosedDayRange("2026-12-24", "2026-12-24", "es")).toBe("jueves, 24 de diciembre");
  });

  it("a range within one month, English (mutation: drop the month-equality check -> FAILS)", () => {
    expect(formatClosedDayRange("2026-12-10", "2026-12-14", "en")).toBe("Dec 10 – 14");
  });

  it("a range within one month, Spanish (mutation: drop the month-equality check -> FAILS)", () => {
    expect(formatClosedDayRange("2026-12-10", "2026-12-14", "es")).toBe("10 – 14 de dic.");
  });

  it("across months in the same year, English (mutation: reuse the same-month template -> FAILS)", () => {
    expect(formatClosedDayRange("2026-11-28", "2026-12-02", "en")).toBe("Nov 28 – Dec 2");
  });

  it("across months in the same year, Spanish (mutation: reuse the same-month template -> FAILS)", () => {
    expect(formatClosedDayRange("2026-11-28", "2026-12-02", "es")).toBe("28 de nov. – 2 de dic.");
  });

  // The brief's own pinned example (2026-10-24 brief, §5.6.3): a range that crosses a YEAR boundary,
  // never showing the year on either side -- a closed day is at most 92 days (0097's own
  // closed_days_range_check), so the month pair alone always disambiguates it.
  it("across a year boundary, English — the brief's own pinned example", () => {
    expect(formatClosedDayRange("2026-12-28", "2027-01-01", "en")).toBe("Dec 28 – Jan 1");
  });

  it("across a year boundary, Spanish", () => {
    expect(formatClosedDayRange("2026-12-28", "2027-01-01", "es")).toBe("28 de dic. – 1 de ene.");
  });
});

// Fix round D1 (design review M1): ONE Spanish month-abbreviation table for the topbar (labels.ts) and
// this card, with periods ("sept.", "dic."), and "de" before the month, as the topbar's own date form.
describe("formatClosedDayRange — the shared Spanish abbreviations (fix round D1)", () => {
  it("September is \"sept.\", the topbar's own form (mutation: keep this file's own \"sep\" table -> FAILS)", () => {
    expect(formatClosedDayRange("2026-09-01", "2026-09-03", "es")).toBe("1 – 3 de sept.");
  });

  it("the plan's two literal forms", () => {
    expect(formatClosedDayRange("2026-12-24", "2026-12-26", "es")).toBe("24 – 26 de dic.");
    expect(formatClosedDayRange("2026-12-28", "2027-01-01", "es")).toBe("28 de dic. – 1 de ene.");
  });

  it("English is unchanged", () => {
    expect(formatClosedDayRange("2026-09-01", "2026-09-03", "en")).toBe("Sep 1 – 3");
  });
});
