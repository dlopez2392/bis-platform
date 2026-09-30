import { describe, it, expect } from "vitest";
import { monthWindow } from "./month-window";

describe("monthWindow — the calendar month `now` falls in, on the account's wall clock", () => {
  it("the same instant is September in Chicago and October in Tokyo (mutation: use UTC → the Chicago case FAILS)", () => {
    const instant = new Date("2026-10-01T03:00:00Z");   // 22:00 CDT Sept 30 · 12:00 JST Oct 1
    expect(monthWindow(instant, "America/Chicago")).toEqual({
      fromIso: "2026-09-01T05:00:00.000Z", toIso: "2026-10-01T05:00:00.000Z", label: "September 2026",
    });
    expect(monthWindow(instant, "Asia/Tokyo")).toEqual({
      fromIso: "2026-09-30T15:00:00.000Z", toIso: "2026-10-31T15:00:00.000Z", label: "October 2026",
    });
  });
  it("a month that crosses the fall-back change: local midnight on each edge, NOT 30 × 24h (mutation: add days in ms → FAILS)", () => {
    expect(monthWindow(new Date("2026-11-15T12:00:00Z"), "America/Chicago")).toEqual({
      fromIso: "2026-11-01T05:00:00.000Z",   // 00:00 CDT
      toIso: "2026-12-01T06:00:00.000Z",     // 00:00 CST
      label: "November 2026",
    });
  });
  it("December rolls into the next year", () => {
    expect(monthWindow(new Date("2026-12-31T23:00:00Z"), "UTC")).toEqual({
      fromIso: "2026-12-01T00:00:00.000Z", toIso: "2027-01-01T00:00:00.000Z", label: "December 2026",
    });
  });

  // Part-C cleanup item 4. `weekly-window.ts`'s `localMidnightInstant`
  // reconciles HOURS only, so a minute-offset zone like Kolkata (+5:30)
  // rounds the boundary to the nearest hour instead of landing on the real
  // one. Values below were MEASURED (not reasoned) by running Node's own
  // Intl against Asia/Kolkata for 2026-07-01 and 2026-08-01 local midnight —
  // see the task report for the script.
  it("a +5:30 zone (Kolkata): the boundary lands on :30, not rounded to the hour (mutation: revert to the hour-only fixed point → FAILS)", () => {
    expect(monthWindow(new Date("2026-07-15T10:00:00Z"), "Asia/Kolkata")).toEqual({
      fromIso: "2026-06-30T18:30:00.000Z", toIso: "2026-07-31T18:30:00.000Z", label: "July 2026",
    });
  });

  // Santiago is a zone whose clock jumps AT local midnight for its
  // spring-forward change (most zones jump at 02:00, which never collides
  // with a month boundary) — unlike a 02:00-jump zone, a Santiago month
  // boundary genuinely CAN fall inside the gap. Measured: in 2026 the jump
  // is 2026-09-05 23:59:59 GMT-4 -> 2026-09-06 01:00:00 GMT-3, so neither
  // Sept 1 nor Oct 1 falls inside the gap itself this particular year (the
  // gap's calendar date moves from year to year and was not on the 1st for
  // any year 1970-2060 checked) — this case instead pins the more common
  // half of the same bug class: the whole-hour offset actually CHANGES
  // between a month's two edges (GMT-4 on the 1st, GMT-3 by the 1st of the
  // next month), which a stale single offset would get wrong.
  it("a zone whose UTC offset changes between a month's two edges (Santiago, GMT-4 -> GMT-3 mid-September 2026)", () => {
    expect(monthWindow(new Date("2026-09-15T12:00:00Z"), "America/Santiago")).toEqual({
      fromIso: "2026-09-01T04:00:00.000Z", toIso: "2026-10-01T03:00:00.000Z", label: "September 2026",
    });
  });
});
