// apps/web/src/lib/dashboard/day-label.test.ts
//
// A dayKey carries no timezone of its own (see day-label.ts's own doc
// comment) — unlike metrics.test.ts/greeting.test.ts, there is no zone
// argument here to vary against a fixture zone. What these pin instead is
// that the UTC-anchor construction (Date.UTC + an explicit `timeZone: "UTC"`
// format) never drops or rolls a calendar day, at a month boundary AND a
// year boundary — exactly where an off-by-one in the anchor math, or a
// forgotten `timeZone` pin silently falling back to the SYSTEM zone, would
// show up as a wrong date.
import { describe, expect, it } from "vitest";
import { longDayLabel, shortDayLabel } from "./day-label";

describe("shortDayLabel", () => {
  it("mid-month", () => {
    expect(shortDayLabel("2027-06-15")).toBe("Jun 15");
  });

  it("month boundary: the first of the month does not roll back to the last day of the prior one", () => {
    expect(shortDayLabel("2027-07-01")).toBe("Jul 1");
  });

  it("month boundary: the last day of the month does not roll forward into the next one", () => {
    expect(shortDayLabel("2027-06-30")).toBe("Jun 30");
  });

  it("year boundary: December 31 stays in its own year", () => {
    expect(shortDayLabel("2027-12-31")).toBe("Dec 31");
  });

  it("year boundary: January 1 does not roll back to December 31", () => {
    expect(shortDayLabel("2028-01-01")).toBe("Jan 1");
  });

  it("leap day", () => {
    expect(shortDayLabel("2028-02-29")).toBe("Feb 29");
  });
});

describe("longDayLabel", () => {
  it("full month name, same date shortDayLabel resolves for the identical dayKey", () => {
    expect(longDayLabel("2027-08-18")).toBe("August 18");
  });

  it("month boundary, long form", () => {
    expect(longDayLabel("2027-09-01")).toBe("September 1");
  });

  it("year boundary, long form", () => {
    expect(longDayLabel("2027-12-31")).toBe("December 31");
  });
});
