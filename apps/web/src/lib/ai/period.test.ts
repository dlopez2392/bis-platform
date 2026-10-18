import { describe, it, expect } from "vitest";
import { periodKeys } from "./period";

const DAY_MS = 86_400_000;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const dayDistance = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / DAY_MS;

describe("the account's own month and day (choice I7; assumption A5)", () => {
  it("late on Oct 31 in Chicago is still October there, though it is November in UTC (mutation: timeZone: 'UTC' -> FAILS)", () => {
    expect(periodKeys(new Date("2026-11-01T04:30:00Z"), "America/Chicago")).toEqual({ monthKey: "2026-10", dayKey: "2026-10-31" });
    expect(periodKeys(new Date("2026-11-01T05:30:00Z"), "America/Chicago")).toEqual({ monthKey: "2026-11", dayKey: "2026-11-01" });
  });

  it("early on Nov 1 in Auckland is already November there, though it is still October in UTC (mutation: timeZone: 'UTC' -> FAILS)", () => {
    expect(periodKeys(new Date("2026-10-31T23:30:00Z"), "Pacific/Auckland")).toEqual({ monthKey: "2026-11", dayKey: "2026-11-01" });
  });

  // 0086 accepts any WELL-FORMED key, a far-future one included, and relies on the app never sending one:
  // the keys are the account-zone date of a real instant, so they sit within a day of that instant's UTC date.
  it("every zone's day is within one day of the instant's UTC date, in YYYY-MM-DD form (mutation: a key from anything but `now` -> FAILS)", () => {
    const zones = Intl.supportedValuesOf("timeZone");
    expect(zones.length).toBeGreaterThan(300);
    const instants = [new Date("2026-01-01T00:00:00Z"), new Date("2026-12-31T23:59:59Z"), new Date("2026-03-08T08:00:00Z"), new Date()];
    const bad: string[] = [];
    for (const zone of zones) {
      for (const now of instants) {
        const { monthKey, dayKey } = periodKeys(now, zone);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey) || monthKey !== dayKey.slice(0, 7) || dayDistance(dayKey, utcDay(now)) > 1) {
          bad.push(`${zone} ${now.toISOString()} -> ${monthKey} ${dayKey}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("an invalid instant throws rather than inventing a key (mutation: return a fixed key on a bad date -> FAILS)", () => {
    expect(() => periodKeys(new Date(Number.NaN), "America/Chicago")).toThrow(RangeError);
  });
});
