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
});
