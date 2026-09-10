import { describe, expect, it } from "vitest";
import { inMondayBand, lastWeekMonday, weekWindow } from "./weekly-window";

describe("the Monday band", () => {
  // ONE instant, TWO zones, OPPOSITE verdicts.
  it("is Monday morning in Chicago and still Sunday night in Honolulu", () => {
    const instant = new Date("2026-03-02T15:00:00Z"); // 09:00 CST / 05:00 HST
    expect(inMondayBand(instant, "America/Chicago")).toBe(true);
    expect(inMondayBand(instant, "Pacific/Honolulu")).toBe(false);
  });

  it("refuses Monday outside the band, and other days inside it", () => {
    expect(inMondayBand(new Date("2026-03-02T13:00:00Z"), "America/Chicago")).toBe(false); // 07:00
    expect(inMondayBand(new Date("2026-03-02T18:00:00Z"), "America/Chicago")).toBe(false); // 12:00
    expect(inMondayBand(new Date("2026-03-03T15:00:00Z"), "America/Chicago")).toBe(false); // Tuesday
  });

  it("accepts both ends of the band", () => {
    expect(inMondayBand(new Date("2026-03-02T14:00:00Z"), "America/Chicago")).toBe(true); // 08:00
    expect(inMondayBand(new Date("2026-03-02T16:59:00Z"), "America/Chicago")).toBe(true); // 10:59
  });
});

describe("the week that just ended", () => {
  it("names the previous Monday, not the one starting today", () => {
    expect(lastWeekMonday(new Date("2026-03-02T15:00:00Z"), "America/Chicago"))
      .toBe("2026-02-23");
  });

  // US DST begins 2026-03-08, inside the week this names.
  it("spans a DST transition without losing or gaining a day", () => {
    expect(lastWeekMonday(new Date("2026-03-09T14:00:00Z"), "America/Chicago"))
      .toBe("2026-03-02");
  });
});

describe("weekWindow", () => {
  it("is half-open in instants and inclusive in days", () => {
    const w = weekWindow("2026-02-23", "America/Chicago");
    expect(w.fromDay).toBe("2026-02-23");
    expect(w.toDay).toBe("2026-03-01");            // the Sunday, inclusive
    expect(w.fromIso).toBe("2026-02-23T06:00:00.000Z"); // local midnight, CST
    expect(w.toIso).toBe("2026-03-02T06:00:00.000Z");   // next Monday, exclusive
  });

  // The DST week is 167 hours, not 168 — if this reads 168 the window was
  // built by adding hours instead of local days.
  it("builds a DST week from local days, not from 168 hours", () => {
    const w = weekWindow("2026-03-02", "America/Chicago");
    expect(w.toDay).toBe("2026-03-08");
    const hours = (Date.parse(w.toIso) - Date.parse(w.fromIso)) / 3_600_000;
    expect(hours).toBe(167);
  });
});
