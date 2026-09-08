import { describe, it, expect } from "vitest";
import { isPastSyncHour, daysToSync, localDayBounds, MAX_BACKFILL_DAYS, SYNC_HOUR } from "./sync-window";

// ONE instant, TWO zones, opposite verdicts — the house rule for zone tests.
// 2026-09-07T08:30Z is 03:30 in Chicago (past the hour) and 01:30 in Los
// Angeles (not yet).
const T = new Date("2026-09-07T08:30:00.000Z");

describe("isPastSyncHour", () => {
  it("is true in Chicago and false in Los Angeles for the same instant", () => {
    expect(SYNC_HOUR).toBe(3);
    expect(isPastSyncHour(T, "America/Chicago")).toBe(true);
    expect(isPastSyncHour(T, "America/Los_Angeles")).toBe(false);
  });
});

describe("daysToSync", () => {
  // Mutation: change `-1` (yesterday) to `0` (today) in daysToSync — the
  // first expectation includes 2026-09-07.
  it("with no history, lists the last 30 local days ending yesterday, oldest first", () => {
    const days = daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: null });
    expect(days).toHaveLength(MAX_BACKFILL_DAYS);
    expect(days[0]).toBe("2026-08-08");
    expect(days[days.length - 1]).toBe("2026-09-06");
  });
  it("continues from the day after the last synced day", () => {
    expect(daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: "2026-09-04" }))
      .toEqual(["2026-09-05", "2026-09-06"]);
  });
  it("is empty when yesterday is already synced, and never returns today", () => {
    expect(daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: "2026-09-06" })).toEqual([]);
    expect(daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: "2026-09-07" })).toEqual([]);
  });
  it("caps a long gap at 30 days, keeping the most recent 30", () => {
    const days = daysToSync({ now: T, timezone: "America/Chicago", lastSyncedDay: "2026-01-01" });
    expect(days).toHaveLength(30);
    expect(days[days.length - 1]).toBe("2026-09-06");
  });
  it("uses the account's zone for 'yesterday': in Los Angeles at 01:30 local, yesterday is the 6th too", () => {
    expect(daysToSync({ now: T, timezone: "America/Los_Angeles", lastSyncedDay: "2026-09-05" })).toEqual(["2026-09-06"]);
  });
});

describe("localDayBounds", () => {
  // Chicago is UTC-5 in September: local midnight = 05:00Z.
  it("returns local midnight to the next local midnight, as UTC instants", () => {
    expect(localDayBounds("2026-09-06", "America/Chicago")).toEqual({
      sinceIso: "2026-09-06T05:00:00.000Z", untilIso: "2026-09-07T05:00:00.000Z",
    });
    expect(localDayBounds("2026-09-06", "America/Los_Angeles").sinceIso).toBe("2026-09-06T07:00:00.000Z");
  });
});
