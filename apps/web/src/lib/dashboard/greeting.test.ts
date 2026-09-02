// apps/web/src/lib/dashboard/greeting.test.ts
//
// Fixture zone is America/New_York (NOT the dev machine's America/Chicago —
// house rule: a fixture zone equal to the dev zone can't discriminate a real
// bug from an accidental pass, per metrics.test.ts's own doc comment). Every
// expected local hour/date string below was independently produced by
// running the SAME `Intl.DateTimeFormat` construction against the exact
// fixture instant before writing the assertion, not hand-computed offset
// math (see the task report for that derivation).
import { describe, it, expect } from "vitest";
import { greetingPeriod, formatLocalLongDate } from "./greeting";

describe("greetingPeriod", () => {
  // All eight instants below are the SAME local calendar day (2027-07-03,
  // EDT, UTC-4) at the eight hour boundaries the function's three buckets
  // pivot on — 04:59/05:00, 11:59/12:00, 16:59/17:00 — plus the day's two
  // extremes (23:59, 00:00) to prove the "everything else" evening branch
  // covers the small hours too, not just the 17:00-23:59 span.
  it("04:59 local: still evening (just before the morning boundary)", () => {
    expect(greetingPeriod(new Date("2027-07-03T08:59:00.000Z"), "America/New_York")).toBe("evening");
  });

  it("05:00 local: morning begins exactly at the boundary", () => {
    expect(greetingPeriod(new Date("2027-07-03T09:00:00.000Z"), "America/New_York")).toBe("morning");
  });

  it("11:59 local: still morning (just before the afternoon boundary)", () => {
    expect(greetingPeriod(new Date("2027-07-03T15:59:00.000Z"), "America/New_York")).toBe("morning");
  });

  it("12:00 local: afternoon begins exactly at the boundary", () => {
    expect(greetingPeriod(new Date("2027-07-03T16:00:00.000Z"), "America/New_York")).toBe("afternoon");
  });

  it("16:59 local: still afternoon (just before the evening boundary)", () => {
    expect(greetingPeriod(new Date("2027-07-03T20:59:00.000Z"), "America/New_York")).toBe("afternoon");
  });

  it("17:00 local: evening begins exactly at the boundary", () => {
    expect(greetingPeriod(new Date("2027-07-03T21:00:00.000Z"), "America/New_York")).toBe("evening");
  });

  it("23:59 local: still evening (late night, not a fourth bucket)", () => {
    expect(greetingPeriod(new Date("2027-07-04T03:59:00.000Z"), "America/New_York")).toBe("evening");
  });

  it("00:00 local: evening (small hours fall in the same catch-all as late night)", () => {
    expect(greetingPeriod(new Date("2027-07-03T04:00:00.000Z"), "America/New_York")).toBe("evening");
  });

  // STRONG discrimination for the timezone argument itself, same technique
  // metrics.test.ts's countAfterHours suite uses: the SAME instant through
  // two zones, asserted for OPPOSITE (and both non-default) periods. A
  // system-zone or fixed-zone implementation cannot pass both — Pacific/
  // Auckland and America/Chicago's own local readings for this instant were
  // independently verified via partsInZone in that sibling suite already
  // (13:00 Monday Auckland; 18:00 Sunday Chicago), reused here rather than
  // re-derived by hand.
  it("far zone discrimination: the SAME instant through Pacific/Auckland (13:00, afternoon) vs America/Chicago (18:00, evening) gives OPPOSITE periods", () => {
    const instant = new Date("2027-01-04T00:00:00.000Z");
    expect(greetingPeriod(instant, "Pacific/Auckland")).toBe("afternoon");
    expect(greetingPeriod(instant, "America/Chicago")).toBe("evening");
  });
});

describe("formatLocalLongDate", () => {
  it("formats the zone-local calendar date as a long date string", () => {
    expect(formatLocalLongDate(new Date("2027-07-03T16:00:00.000Z"), "America/New_York")).toBe(
      "Saturday, July 3, 2027",
    );
  });

  it("23:30-local boundary (America/New_York): a UTC instant that already reads tomorrow still formats as TODAY's local date", () => {
    // 2027-06-16T03:30:00.000Z is 2027-06-15 23:30 local NY — the same
    // boundary case metrics.test.ts's bucketByLocalDay suite pins.
    expect(formatLocalLongDate(new Date("2027-06-16T03:30:00.000Z"), "America/New_York")).toBe(
      "Tuesday, June 15, 2027",
    );
  });

  it("mirror boundary, far zone (Pacific/Auckland): a UTC instant that still reads today formats as TOMORROW's local date", () => {
    expect(formatLocalLongDate(new Date("2027-06-15T12:15:00.000Z"), "Pacific/Auckland")).toBe(
      "Wednesday, June 16, 2027",
    );
  });
});
