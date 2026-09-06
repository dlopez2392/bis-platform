import { describe, it, expect } from "vitest";
import { isInMorningBand, isStrictlyEarlierLocalDay } from "./followup-timing";

/**
 * Same discipline as followup-timing.test.ts: ONE instant, TWO zones,
 * OPPOSITE verdicts, and America/Chicago (this machine's zone) only ever as
 * one half of a pair. Every instant below was checked with Intl first.
 */
const NY = "America/New_York";
const LA = "America/Los_Angeles";
const CHI = "America/Chicago";
const JUNK = ["Mars/Olympus", "", "  ", "x".repeat(65), "America/Nowhere"];

describe("isInMorningBand", () => {
  const NOW = new Date("2026-09-09T14:00:00Z");   // NY 10:00 · LA 07:00 · UTC 14:00

  it("reads the band in the zone it is handed: mid-morning in New York, dawn in Los Angeles", () => {
    expect(isInMorningBand(NOW, NY)).toBe(true);
    expect(isInMorningBand(NOW, LA)).toBe(false);
  });

  it("guards the fixture: the same instant is outside the band in UTC", () => {
    expect(isInMorningBand(NOW, "UTC")).toBe(false);
  });

  it("fails closed on a junk zone and on an invalid instant, never throwing", () => {
    for (const z of JUNK) expect(isInMorningBand(NOW, z)).toBe(false);
    expect(isInMorningBand(new Date("not a date"), NY)).toBe(false);
  });
});

describe("isStrictlyEarlierLocalDay", () => {
  const NOW = new Date("2026-09-09T14:00:00Z");      // NY Wed 10:00 · CHI Wed 09:00
  const INSTANT = new Date("2026-09-09T04:30:00Z");  // NY Wed 00:30 · CHI Tue 23:30

  it("one hour of zone difference moves the instant across local midnight", () => {
    expect(isStrictlyEarlierLocalDay(INSTANT, NOW, CHI)).toBe(true);
    expect(isStrictlyEarlierLocalDay(INSTANT, NOW, NY)).toBe(false);
  });

  it("the same local day is not strictly earlier, and a later instant never is", () => {
    expect(isStrictlyEarlierLocalDay(new Date("2026-09-09T13:00:00Z"), NOW, NY)).toBe(false);
    expect(isStrictlyEarlierLocalDay(new Date("2026-09-10T13:00:00Z"), NOW, NY)).toBe(false);
  });

  it("fails closed on a junk zone and on invalid dates on either side", () => {
    for (const z of JUNK) expect(isStrictlyEarlierLocalDay(INSTANT, NOW, z)).toBe(false);
    expect(isStrictlyEarlierLocalDay(new Date("nope"), NOW, NY)).toBe(false);
    expect(isStrictlyEarlierLocalDay(INSTANT, new Date("nope"), NY)).toBe(false);
  });
});
