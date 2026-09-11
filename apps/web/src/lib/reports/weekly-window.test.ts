import { describe, expect, it } from "vitest";
import { inMondayBand, lastWeekMonday, weekWindow } from "./weekly-window";

describe("the Monday band", () => {
  /**
   * ONE instant, THREE zones, and the two refusals happen for DIFFERENT
   * reasons — which is the point, and which the first version of this test got
   * wrong. It paired Chicago with Honolulu and claimed Honolulu was "still
   * Sunday night"; it is not, it is 05:00 on the same Monday. That test proved
   * only that the HOUR is read in the right zone, and would still have passed
   * against an implementation that read the weekday in the system zone.
   *
   * Tokyo is the missing half: at this instant it is already TUESDAY there, so
   * a refusal can only come from the weekday. Honolulu keeps the hour case.
   */
  it("reads BOTH the weekday and the hour in the account's own zone", () => {
    const instant = new Date("2026-03-02T15:00:00Z");
    // Monday 09:00 — inside the band.
    expect(inMondayBand(instant, "America/Chicago")).toBe(true);
    // Monday 05:00 — right day, too early.
    expect(inMondayBand(instant, "Pacific/Honolulu")).toBe(false);
    // Tuesday 00:00 — wrong day entirely.
    expect(inMondayBand(instant, "Asia/Tokyo")).toBe(false);
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
