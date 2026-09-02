import { describe, it, expect } from "vitest";
import { relativeTime } from "./relative-time";

const NOW = new Date("2027-01-04T12:00:00.000Z").getTime();

describe("relativeTime", () => {
  it("under a minute reads 'now'", () => {
    expect(relativeTime("2027-01-04T12:00:00.000Z", NOW)).toBe("now");
    expect(relativeTime("2027-01-04T11:59:00.001Z", NOW)).toBe("now"); // 59.999s
  });

  it("minutes: floors, and the mockup's own '10m' example", () => {
    expect(relativeTime("2027-01-04T11:59:00.000Z", NOW)).toBe("1m"); // exactly 60s
    expect(relativeTime("2027-01-04T11:50:00.000Z", NOW)).toBe("10m");
    expect(relativeTime("2027-01-04T11:00:00.001Z", NOW)).toBe("59m"); // just under an hour
  });

  it("hours: floors at the minute→hour boundary, and the mockup's own '3h' example", () => {
    expect(relativeTime("2027-01-04T11:00:00.000Z", NOW)).toBe("1h"); // exactly 60m
    expect(relativeTime("2027-01-04T09:00:00.000Z", NOW)).toBe("3h");
    expect(relativeTime("2027-01-03T13:00:00.001Z", NOW)).toBe("22h"); // just under a day
  });

  it("days: floors at the hour→day boundary", () => {
    expect(relativeTime("2027-01-03T12:00:00.000Z", NOW)).toBe("1d"); // exactly 24h
    expect(relativeTime("2026-12-30T12:00:00.000Z", NOW)).toBe("5d");
  });

  it("a future timestamp (clock skew) never goes negative — clamped to 'now'", () => {
    expect(relativeTime("2027-01-04T12:05:00.000Z", NOW)).toBe("now");
  });

  it("is zone-free: the same instant reads identically regardless of which zone is asked, because nothing here ever reads one", () => {
    // relativeTime takes no timezone parameter at all — this test exists to
    // document that omission is deliberate (instant-to-instant subtraction),
    // not an oversight, the same way metrics.test.ts pins its zone-bearing
    // siblings against a NON-dev-zone fixture.
    expect(relativeTime("2027-01-04T11:50:00.000Z", NOW)).toBe("10m");
  });
});
