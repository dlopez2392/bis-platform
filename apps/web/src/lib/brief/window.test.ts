// The daily brief's band and day windows (plan D4). Expected instants are written from each zone's published
// UTC offsets, never from the code under test, and every zone is judged on an ordinary summer day, an ordinary
// winter day and BOTH 2027 clock-change days (US: Sunday 14 March forward, Sunday 7 November back).
import { describe, expect, it } from "vitest";
import { briefDays, dailyBriefBand } from "./window";

type Z = { zone: string; winter: number; summer: number };
const ZONES: Z[] = [
  { zone: "America/Chicago", winter: -6, summer: -5 },
  { zone: "America/New_York", winter: -5, summer: -4 },
  { zone: "America/Denver", winter: -7, summer: -6 },
  { zone: "America/Los_Angeles", winter: -8, summer: -7 },
  { zone: "America/Phoenix", winter: -7, summer: -7 },
  { zone: "Pacific/Honolulu", winter: -10, summer: -10 },
];
const MIN = 60_000;
const HOUR = 60 * MIN;
/** The UTC instant of `day` at `hour`:00 local, given the zone's offset in force at that wall time. */
const at = (day: string, hour: number, offset: number) => Date.parse(`${day}T00:00:00Z`) + (hour - offset) * HOUR;

// [label, local day, offset in force at 07:00 that day]
const DAYS = (z: Z): [string, string, number][] => [
  ["a summer day", "2027-06-15", z.summer],
  ["a winter day", "2027-01-15", z.winter],
  ["the spring-forward day", "2027-03-14", z.summer],
  ["the fall-back day", "2027-11-07", z.winter],
];

describe("dailyBriefBand: 07:00 to 08:59 on the account's own wall clock", () => {
  for (const z of ZONES) for (const [label, day, off] of DAYS(z)) {
    it(`${z.zone}, ${label}: in at 07:00 and 08:59, out at 06:59 and 09:00`, () => {
      expect(dailyBriefBand(new Date(at(day, 7, off) - MIN), z.zone), "06:59").toBe(false);
      expect(dailyBriefBand(new Date(at(day, 7, off)), z.zone), "07:00").toBe(true);
      expect(dailyBriefBand(new Date(at(day, 8, off) + 59 * MIN), z.zone), "08:59").toBe(true);
      expect(dailyBriefBand(new Date(at(day, 9, off)), z.zone), "09:00").toBe(false);
    });
  }

  it("is the account's hour, not the UTC hour: 07:00 UTC is 02:00 in Chicago (not in band), 07:00 Chicago is 12:00 UTC", () => {
    expect(dailyBriefBand(new Date("2027-06-15T07:00:00Z"), "America/Chicago")).toBe(false);
    expect(dailyBriefBand(new Date("2027-06-15T12:00:00Z"), "America/Chicago")).toBe(true);
    expect(dailyBriefBand(new Date("2027-06-15T07:00:00Z"), "UTC")).toBe(true);
  });

  it("answers false for a zone it cannot read and for an invalid instant, never throws", () => {
    expect(dailyBriefBand(new Date("2027-06-15T12:00:00Z"), "Not/AZone")).toBe(false);
    expect(dailyBriefBand(new Date(Number.NaN), "America/Chicago")).toBe(false);
  });
});

describe("briefDays: today, yesterday and the edges the reads and the gate use", () => {
  /** The offset in force at LOCAL MIDNIGHT of `dayKey` (the change is at 02:00, so midnight of the change day is
   *  still the old offset). */
  const midnightOffset = (z: Z, dayKey: string) => {
    if (z.winter === z.summer) return z.winter;
    return dayKey > "2027-03-14" && dayKey <= "2027-11-07" ? z.summer : z.winter;
  };
  const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

  for (const z of ZONES) for (const [label, day, off] of DAYS(z)) {
    it(`${z.zone}, ${label}: local days, and real local-midnight edges`, () => {
      const d = briefDays(new Date(at(day, 7, off) + 5 * MIN), z.zone);
      expect(d).not.toBeNull();
      expect(d!.today).toBe(day);
      expect(d!.yesterday).toBe(shiftDay(day, -1));
      expect(Date.parse(d!.todayStartIso)).toBe(at(day, 0, midnightOffset(z, day)));
      expect(Date.parse(d!.tomorrowStartIso)).toBe(at(shiftDay(day, 1), 0, midnightOffset(z, shiftDay(day, 1))));
      expect(Date.parse(d!.yesterdayStartIso)).toBe(at(shiftDay(day, -1), 0, midnightOffset(z, shiftDay(day, -1))));
    });
  }

  it("the day lengths are 23, 24 and 25 hours, so nothing here is a fixed 24 hour step", () => {
    const chicago = "America/Chicago";
    const today = (day: string, off: number) => {
      const d = briefDays(new Date(at(day, 7, off) + 5 * MIN), chicago)!;
      return (Date.parse(d.tomorrowStartIso) - Date.parse(d.todayStartIso)) / HOUR;
    };
    expect(today("2027-03-14", -5)).toBe(23);
    expect(today("2027-11-07", -6)).toBe(25);
    expect(today("2027-06-15", -5)).toBe(24);
    // Yesterday's own window the morning AFTER each change.
    const yesterday = (day: string, off: number) => {
      const d = briefDays(new Date(at(day, 7, off) + 5 * MIN), chicago)!;
      return (Date.parse(d.todayStartIso) - Date.parse(d.yesterdayStartIso)) / HOUR;
    };
    expect(yesterday("2027-03-15", -5)).toBe(23);
    expect(yesterday("2027-11-08", -6)).toBe(25);
  });

  it("answers null for a zone it cannot read", () => {
    expect(briefDays(new Date("2027-06-15T12:00:00Z"), "Not/AZone")).toBeNull();
  });
});
