// apps/web/src/lib/dashboard/metrics.test.ts
//
// Pure math, no @bis/db, no React, no I/O — every case below is an explicit
// UTC instant fed through a fixture timezone that is NOT the dev machine's
// (America/Chicago): America/New_York for most cases, Pacific/Auckland for
// the far-zone day-boundary mirror (house rule — a fixture zone equal to the
// dev zone can't discriminate a real bug from an accidental pass). All
// expected ISO strings/day keys below were independently derived by running
// the SAME sanctioned Intl-pinned algorithm (partsInZone/zonedTimeToUtc) the
// implementation itself uses — see the task report for that derivation.
import { describe, it, expect } from "vitest";
import {
  localDayWindow,
  bucketByLocalDay,
  deltaVsPrior,
  sparklinePath,
  countAfterHours,
} from "./metrics";
import type { OpenHours } from "@/lib/booking/slots";

describe("localDayWindow", () => {
  it("basic 3-day window ending today, toIso pinned to `now` exactly (not end-of-day)", () => {
    // 2027-07-03T16:00:00Z reads as 2027-07-03 12:00 in America/New_York
    // (EDT, UTC-4) — comfortably mid-day, no boundary ambiguity.
    const now = new Date("2027-07-03T16:00:00.000Z");
    const { fromIso, toIso, dayKeys } = localDayWindow(now, "America/New_York", 3);
    expect(dayKeys).toEqual(["2027-07-01", "2027-07-02", "2027-07-03"]);
    expect(toIso).toBe(now.toISOString());
    // Midnight local on the earliest day (2027-07-01), resolved to UTC.
    expect(fromIso).toBe("2027-07-01T04:00:00.000Z");
  });

  it("23:30-local boundary (America/New_York): `now`'s UTC date is already tomorrow, but the window's LAST day is still today-local", () => {
    // 2027-06-16T03:30:00Z is 2027-06-15 23:30 local NY (EDT) — UTC has
    // already rolled to June 16, but the local calendar day is still the
    // 15th. days=1 must resolve to exactly that local day, not June 16.
    const now = new Date("2027-06-16T03:30:00.000Z");
    const { fromIso, toIso, dayKeys } = localDayWindow(now, "America/New_York", 1);
    expect(dayKeys).toEqual(["2027-06-15"]);
    expect(fromIso).toBe("2027-06-15T04:00:00.000Z");
    expect(toIso).toBe(now.toISOString());
  });

  it("mirror boundary case, far zone (Pacific/Auckland, UTC+12): local calendar has already rolled to tomorrow while UTC is still on today", () => {
    // 2027-06-15T12:15:00Z is 2027-06-16 00:15 local Auckland — the local
    // day is AHEAD of the UTC day this time (east-of-UTC zone), the mirror
    // of the New York case above.
    const now = new Date("2027-06-15T12:15:00.000Z");
    const { fromIso, toIso, dayKeys } = localDayWindow(now, "Pacific/Auckland", 1);
    expect(dayKeys).toEqual(["2027-06-16"]);
    expect(fromIso).toBe("2027-06-15T12:00:00.000Z");
    expect(toIso).toBe(now.toISOString());
  });

  it("5-day window crosses a month boundary via real calendar-day arithmetic, not naive string math", () => {
    const now = new Date("2027-07-03T16:00:00.000Z"); // today = 2027-07-03, NY
    const { dayKeys, fromIso } = localDayWindow(now, "America/New_York", 5);
    expect(dayKeys).toEqual(["2027-06-29", "2027-06-30", "2027-07-01", "2027-07-02", "2027-07-03"]);
    expect(fromIso).toBe("2027-06-29T04:00:00.000Z");
  });

  it("DST spring-forward: the window's first day is the transition day itself and midnight still resolves (transition is at 2am local, not midnight)", () => {
    // 2025-03-09 is the US spring-forward Sunday in America/New_York.
    const now = new Date("2025-03-11T15:00:00.000Z"); // today = 2025-03-11
    const { dayKeys, fromIso } = localDayWindow(now, "America/New_York", 3);
    expect(dayKeys).toEqual(["2025-03-09", "2025-03-10", "2025-03-11"]);
    // Midnight local on the transition day is still EST (UTC-5) — the
    // clocks don't jump until 2am that day.
    expect(fromIso).toBe("2025-03-09T05:00:00.000Z");
  });

  it("days=1: window is exactly today, fromIso = today's local midnight", () => {
    const now = new Date("2027-07-03T16:00:00.000Z");
    const { dayKeys, fromIso } = localDayWindow(now, "America/New_York", 1);
    expect(dayKeys).toEqual(["2027-07-03"]);
    expect(fromIso).toBe("2027-07-03T04:00:00.000Z");
  });
});

describe("bucketByLocalDay", () => {
  it("23:30-local boundary (America/New_York): a call whose UTC instant already reads tomorrow buckets into TODAY's local day", () => {
    const isoTimes = ["2027-06-16T03:30:00.000Z"]; // 2027-06-15 23:30 local NY
    const dayKeys = ["2027-06-14", "2027-06-15", "2027-06-16"];
    const buckets = bucketByLocalDay(isoTimes, "America/New_York", dayKeys);
    expect(buckets).toEqual([
      { dayKey: "2027-06-14", count: 0, isWeekend: false },
      { dayKey: "2027-06-15", count: 1, isWeekend: false },
      { dayKey: "2027-06-16", count: 0, isWeekend: false },
    ]);
  });

  it("mirror boundary, far zone (Pacific/Auckland): a call whose UTC instant still reads today buckets into TOMORROW's local day", () => {
    const isoTimes = ["2027-06-15T12:15:00.000Z"]; // 2027-06-16 00:15 local Auckland
    const dayKeys = ["2027-06-15", "2027-06-16", "2027-06-17"];
    const buckets = bucketByLocalDay(isoTimes, "Pacific/Auckland", dayKeys);
    expect(buckets.find((b) => b.dayKey === "2027-06-16")!.count).toBe(1);
    expect(buckets.find((b) => b.dayKey === "2027-06-15")!.count).toBe(0);
    expect(buckets.find((b) => b.dayKey === "2027-06-17")!.count).toBe(0);
  });

  it("DST spring-forward day (America/New_York, 2025-03-09): calls straddling the missing hour all still land in the transition day's bucket, not split or dropped", () => {
    const isoTimes = [
      "2025-03-09T05:30:00.000Z", // 00:30 local, pre-transition (EST)
      "2025-03-09T09:30:00.000Z", // 05:30 local, post-transition (EDT)
      "2025-03-09T13:30:00.000Z", // 09:30 local (EDT)
      "2025-03-09T23:59:00.000Z", // 19:59 local (EDT)
      "2025-03-10T04:59:00.000Z", // 00:59 local NEXT day — control, must NOT bucket into the 9th
    ];
    const dayKeys = ["2025-03-08", "2025-03-09", "2025-03-10"];
    const buckets = bucketByLocalDay(isoTimes, "America/New_York", dayKeys);
    expect(buckets).toEqual([
      { dayKey: "2025-03-08", count: 0, isWeekend: true }, // Saturday
      { dayKey: "2025-03-09", count: 4, isWeekend: true }, // Sunday, the transition day
      { dayKey: "2025-03-10", count: 1, isWeekend: false }, // Monday
    ]);
  });

  it("weekend flags across a full local week: Sat/Sun true, Mon-Fri false — derived from the sanctioned UTC-anchor pattern, never an un-pinned Intl weekday", () => {
    const dayKeys = ["2027-06-14", "2027-06-15", "2027-06-16", "2027-06-17", "2027-06-18", "2027-06-19", "2027-06-20"];
    const buckets = bucketByLocalDay([], "America/New_York", dayKeys);
    expect(buckets.map((b) => b.isWeekend)).toEqual([
      false, // Mon 14
      false, // Tue 15
      false, // Wed 16
      false, // Thu 17
      false, // Fri 18
      true, // Sat 19
      true, // Sun 20
    ]);
    expect(buckets.every((b) => b.count === 0)).toBe(true);
  });

  it("multiple calls the same local day accumulate into one bucket's count", () => {
    const isoTimes = [
      "2027-06-14T14:00:00.000Z", // 10:00 local
      "2027-06-14T18:00:00.000Z", // 14:00 local
      "2027-06-14T22:00:00.000Z", // 18:00 local
    ];
    const dayKeys = ["2027-06-14"];
    const buckets = bucketByLocalDay(isoTimes, "America/New_York", dayKeys);
    expect(buckets).toEqual([{ dayKey: "2027-06-14", count: 3, isWeekend: false }]);
  });

  it("a call whose local day falls outside the given dayKeys is not counted anywhere (no crash, no phantom bucket)", () => {
    const isoTimes = ["2027-01-01T14:00:00.000Z"]; // far outside the window below
    const dayKeys = ["2027-06-14"];
    const buckets = bucketByLocalDay(isoTimes, "America/New_York", dayKeys);
    expect(buckets).toEqual([{ dayKey: "2027-06-14", count: 0, isWeekend: false }]);
  });
});

describe("deltaVsPrior", () => {
  it("0 -> 0: flat, label \"0\" (not \"0%\" — previous is zero, so this is the absolute branch)", () => {
    expect(deltaVsPrior(0, 0)).toEqual({ direction: "flat", label: "0" });
  });

  it("0 -> n: absolute count, the mockup's \"▲ 3\" case", () => {
    expect(deltaVsPrior(3, 0)).toEqual({ direction: "up", label: "3" });
  });

  it("previous > 0, up: percent, rounded — the mockup's \"▲ 12%\" case (56 vs 50)", () => {
    expect(deltaVsPrior(56, 50)).toEqual({ direction: "up", label: "12%" });
  });

  it("previous > 0, down: percent, rounded — the mockup's \"▼ 8%\" case (46 vs 50)", () => {
    expect(deltaVsPrior(46, 50)).toEqual({ direction: "down", label: "8%" });
  });

  it("equal, both nonzero: flat, label \"0%\" (percent branch, since previous > 0)", () => {
    expect(deltaVsPrior(10, 10)).toEqual({ direction: "flat", label: "0%" });
  });

  it("rounds to the nearest whole percent, not truncates (13 vs 7 -> 85.71% rounds up to 86%)", () => {
    expect(deltaVsPrior(13, 7)).toEqual({ direction: "up", label: "86%" });
  });
});

describe("sparklinePath", () => {
  it("flat-line: every count equal collapses to a horizontal mid-height line, never a divide-by-zero", () => {
    const { line, area, endX, endY } = sparklinePath([5, 5, 5, 5], 100, 26);
    expect(line).toBe("0,13 33.33,13 66.67,13 100,13");
    expect(area).toBe("0,13 33.33,13 66.67,13 100,13 100,26 0,26");
    expect(endX).toBe(100);
    expect(endY).toBe(13);
  });

  it("single-point: one value, no range to compare — sits at mid-height, at the right edge (endX = width)", () => {
    const { line, area, endX, endY } = sparklinePath([7], 100, 26);
    expect(line).toBe("100,13");
    expect(area).toBe("100,13 100,26 0,26");
    expect(endX).toBe(100);
    expect(endY).toBe(13);
  });

  it("varying counts scale into [pad, height-pad], higher count = smaller y (nearer the top)", () => {
    const { line, area, endX, endY } = sparklinePath([0, 10], 100, 26);
    expect(line).toBe("0,22.1 100,3.9");
    expect(area).toBe("0,22.1 100,3.9 100,26 0,26");
    expect(endX).toBe(100);
    expect(endY).toBe(3.9);
  });

  it("respects an arbitrary width/height, not just the 100x26 mockup viewBox", () => {
    const { line, endX, endY } = sparklinePath([1, 2, 3], 50, 20);
    expect(line).toBe("0,17 25,10 50,3");
    expect(endX).toBe(50);
    expect(endY).toBe(3);
  });

  it("empty counts array: degenerate but safe (no crash) rather than an assumed shape", () => {
    expect(sparklinePath([], 100, 26)).toEqual({ line: "", area: "", endX: 0, endY: 0 });
  });
});

describe("countAfterHours", () => {
  const mondayOnlyHours: OpenHours = {
    mon: [["09:00", "17:00"]],
  };

  it("before-open: a call earlier than the day's first window is after-hours", () => {
    const isoTimes = ["2027-06-14T12:00:00.000Z"]; // 08:00 local NY, Monday
    expect(countAfterHours(isoTimes, "America/New_York", mondayOnlyHours)).toBe(1);
  });

  it("after-close: a call later than the day's last window is after-hours", () => {
    const isoTimes = ["2027-06-14T22:00:00.000Z"]; // 18:00 local NY, Monday
    expect(countAfterHours(isoTimes, "America/New_York", mondayOnlyHours)).toBe(1);
  });

  it("within hours (including the open boundary, inclusive): not after-hours", () => {
    const isoTimes = [
      "2027-06-14T13:00:00.000Z", // 09:00 local, exactly at open
      "2027-06-14T14:00:00.000Z", // 10:00 local, mid-window
      "2027-06-14T20:59:00.000Z", // 16:59 local, just before close
    ];
    expect(countAfterHours(isoTimes, "America/New_York", mondayOnlyHours)).toBe(0);
  });

  it("the close boundary itself is NOT within hours (exclusive end, matching the booking engine's own [from, to) convention)", () => {
    const isoTimes = ["2027-06-14T21:00:00.000Z"]; // 17:00 local, exactly at close
    expect(countAfterHours(isoTimes, "America/New_York", mondayOnlyHours)).toBe(1);
  });

  it("closed day (some days configured, this one isn't): counts as after-hours — the FUNCTION's honesty rule; hiding the tile entirely is Task 5's job, not this function's", () => {
    const isoTimes = ["2027-06-16T14:00:00.000Z"]; // 10:00 local NY, Wednesday — no "wed" key at all
    expect(countAfterHours(isoTimes, "America/New_York", mondayOnlyHours)).toBe(1);
  });

  it("entirely empty open_hours ({}): every call counts as after-hours (the function still gives an honest answer for its own contract — Task 5 decides whether to render the tile at all)", () => {
    const isoTimes = [
      "2027-06-14T14:00:00.000Z", // would have been mid-window under mondayOnlyHours
      "2027-06-16T14:00:00.000Z",
    ];
    expect(countAfterHours(isoTimes, "America/New_York", {})).toBe(2);
  });

  it("mixed batch: sums correctly across both after-hours and within-hours calls", () => {
    const isoTimes = [
      "2027-06-14T12:00:00.000Z", // 08:00 local, before-open -> after-hours
      "2027-06-14T14:00:00.000Z", // 10:00 local, within -> not
      "2027-06-14T22:00:00.000Z", // 18:00 local, after-close -> after-hours
      "2027-06-16T14:00:00.000Z", // Wednesday, closed day -> after-hours
    ];
    expect(countAfterHours(isoTimes, "America/New_York", mondayOnlyHours)).toBe(3);
  });

  // STRONG discrimination for the timezone argument itself: the SAME instant
  // + the SAME openHours fixture, asserted TWICE with only the zone changed,
  // for OPPOSITE results. A weaker version of this test (one instant, one
  // zone, "expect after-hours") cannot tell a correct zone-aware
  // implementation from one that silently substitutes a fixed/system zone —
  // if that substituted reading also happens to land after-hours (same
  // weekday-closed or same out-of-window outcome), the test passes for the
  // wrong reason. Asserting the same fixture through two zones with
  // opposite verdicts closes that hole: no single fixed zone can produce
  // both answers.
  //
  // Instant: 2027-01-04T00:00:00.000Z (January — both zones are outside any
  // DST transition window, so their offsets are simple UTC-6 / UTC+13, no
  // fold/gap complications).
  //
  //   Pacific/Auckland (NZDT, UTC+13 in January — southern-hemisphere
  //   summer): 00:00 UTC + 13:00 = 2027-01-04 13:00 local, Monday.
  //   13:00 falls inside mondayOnlyHours' 09:00-17:00 window -> NOT
  //   after-hours (count 0).
  //
  //   America/Chicago (CST, UTC-6 in January — US DST doesn't start until
  //   March, so this is plain standard time, no ambiguity): 00:00 UTC -
  //   6:00 = 2027-01-03 18:00 local, SUNDAY (a full calendar day earlier,
  //   not just a different hour). "sun" has no entry in mondayOnlyHours at
  //   all -> closed day -> after-hours (count 1).
  //
  // (Both readings were produced by running partsInZone itself against this
  // exact instant before writing this test, not hand-computed offset math —
  // the reviewer note that flagged the prior version specifically warned
  // hand-picked replacements tend to be off by a weekday.)
  it("far zone discrimination: the SAME instant through Pacific/Auckland (within Monday's window) vs America/Chicago (a Sunday, closed) gives OPPOSITE verdicts — a system-zone or fixed-zone implementation cannot pass both", () => {
    const instant = "2027-01-04T00:00:00.000Z";
    expect(countAfterHours([instant], "Pacific/Auckland", mondayOnlyHours)).toBe(0);
    expect(countAfterHours([instant], "America/Chicago", mondayOnlyHours)).toBe(1);
  });
});
