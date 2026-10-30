import { describe, it, expect } from "vitest";
import {
  agendaTime, agendaWindow, dayHasZoneShift, freeHours, parseAgendaParams, shiftKey, wallToInstant, weekStartKey,
} from "./agenda-window";

const CHI = "America/Chicago";
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const shape = (w: ReturnType<typeof agendaWindow>) => ({
  from: iso(w.from), to: iso(w.to),
  days: w.days.map((d) => ({ key: d.key, start: iso(d.start), end: iso(d.end), zoneShift: d.zoneShift })),
});

describe("agendaWindow: a day is the account zone's own midnight to midnight, never 24 hours", () => {
  it("an ordinary Chicago day is 24 hours with no zone shift", () => {
    expect(shape(agendaWindow("day", "2026-10-30", CHI))).toEqual({
      from: "2026-10-30T05:00:00.000Z", to: "2026-10-31T05:00:00.000Z",
      days: [{ key: "2026-10-30", start: "2026-10-30T05:00:00.000Z", end: "2026-10-31T05:00:00.000Z", zoneShift: false }],
    });
  });

  it("the spring-forward day (2026-03-08) is 23 hours and shifts zone", () => {
    expect(shape(agendaWindow("day", "2026-03-08", CHI))).toEqual({
      from: "2026-03-08T06:00:00.000Z", to: "2026-03-09T05:00:00.000Z",
      days: [{ key: "2026-03-08", start: "2026-03-08T06:00:00.000Z", end: "2026-03-09T05:00:00.000Z", zoneShift: true }],
    });
  });

  it("the fall-back day (2026-11-01) is 25 hours and shifts zone", () => {
    expect(shape(agendaWindow("day", "2026-11-01", CHI))).toEqual({
      from: "2026-11-01T05:00:00.000Z", to: "2026-11-02T06:00:00.000Z",
      days: [{ key: "2026-11-01", start: "2026-11-01T05:00:00.000Z", end: "2026-11-02T06:00:00.000Z", zoneShift: true }],
    });
  });

  it("America/Havana moves its clocks AT midnight: 2026-03-08 starts at 01:00 (startOfDay) and runs to the next midnight", () => {
    const w = agendaWindow("day", "2026-03-08", "America/Havana");
    expect({ from: iso(w.from), to: iso(w.to) }).toEqual({ from: "2026-03-08T05:00:00.000Z", to: "2026-03-09T04:00:00.000Z" });
  });

  it("Pacific/Kiritimati (UTC+14) on the leap day 2028-02-29", () => {
    expect(shape(agendaWindow("day", "2028-02-29", "Pacific/Kiritimati"))).toEqual({
      from: "2028-02-28T10:00:00.000Z", to: "2028-02-29T10:00:00.000Z",
      days: [{ key: "2028-02-29", start: "2028-02-28T10:00:00.000Z", end: "2028-02-29T10:00:00.000Z", zoneShift: false }],
    });
  });

  it("a week starts on the Sunday on or before the day (D10) and holds seven days", () => {
    const w = agendaWindow("week", "2026-10-30", CHI);
    expect(w.days.map((d) => d.key)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
    expect({ from: iso(w.from), to: iso(w.to) }).toEqual({ from: "2026-10-25T05:00:00.000Z", to: "2026-11-01T05:00:00.000Z" });
  });

  it("the week of 2026-11-01 (a Sunday) starts that day, and only its first day shifts zone", () => {
    const w = agendaWindow("week", "2026-11-01", CHI);
    expect(w.days.map((d) => d.key)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    expect({ from: iso(w.from), to: iso(w.to) }).toEqual({ from: "2026-11-01T05:00:00.000Z", to: "2026-11-08T06:00:00.000Z" });
    expect(w.days.map((d) => d.zoneShift)).toEqual([true, false, false, false, false, false, false]);
    // Each day ends where the next starts: no hour of the week is lost or read twice.
    for (let n = 1; n < 7; n++) expect(iso(w.days[n]!.start)).toBe(iso(w.days[n - 1]!.end));
  });
});

describe("dayHasZoneShift", () => {
  it("is true only when the UTC offset at the day's start differs from its last minute's", () => {
    expect(dayHasZoneShift(new Date("2026-11-01T05:00:00.000Z"), new Date("2026-11-02T06:00:00.000Z"), CHI)).toBe(true);
    expect(dayHasZoneShift(new Date("2026-03-08T06:00:00.000Z"), new Date("2026-03-09T05:00:00.000Z"), CHI)).toBe(true);
    expect(dayHasZoneShift(new Date("2026-11-02T06:00:00.000Z"), new Date("2026-11-03T06:00:00.000Z"), CHI)).toBe(false);
  });
});

describe("weekStartKey, shiftKey and parseAgendaParams", () => {
  it("the Sunday on or before, across a year end", () => {
    expect(weekStartKey("2026-10-30")).toBe("2026-10-25");
    expect(weekStartKey("2026-10-25")).toBe("2026-10-25");
    expect(weekStartKey("2027-01-01")).toBe("2026-12-27");
  });

  it("a day steps one calendar day, a week seven, across a leap day and a year end", () => {
    expect(shiftKey("day", "2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftKey("day", "2028-03-01", -1)).toBe("2028-02-29");
    expect(shiftKey("week", "2026-12-30", 1)).toBe("2027-01-06");
    expect(shiftKey("week", "2027-01-06", -1)).toBe("2026-12-30");
  });

  it("an unknown view is Day and an unreal date is today", () => {
    expect(parseAgendaParams({ view: "month", day: "2026-13-01" }, "2026-10-30")).toEqual({ view: "day", day: "2026-10-30" });
    expect(parseAgendaParams({ view: "week", day: "2026-02-29" }, "2026-10-30")).toEqual({ view: "week", day: "2026-10-30" });
    expect(parseAgendaParams({}, "2026-10-30")).toEqual({ view: "day", day: "2026-10-30" });
    expect(parseAgendaParams({ view: "week", day: "2028-02-29" }, "2026-10-30")).toEqual({ view: "week", day: "2028-02-29" });
  });
});

describe("agendaTime: a fall-back day's two 1:30s read as two instants", () => {
  const first = new Date("2026-11-01T06:30:00.000Z"); // 01:30 CDT
  const second = new Date("2026-11-01T07:30:00.000Z"); // 01:30 CST

  it("English carries the zone's short name when asked", () => {
    expect(agendaTime(first, CHI, "en", true)).toBe("1:30 AM CDT");
    expect(agendaTime(second, CHI, "en", true)).toBe("1:30 AM CST");
  });

  it("Spanish's two readings differ too (exact strings are ICU's, not pinned: plan assumption 17e)", () => {
    expect(agendaTime(first, CHI, "es", true)).not.toBe(agendaTime(second, CHI, "es", true));
  });

  it("without the zone the two readings are the same words, which is why a shift day asks for it", () => {
    expect(agendaTime(first, CHI, "en", false)).toBe("1:30 AM");
    expect(agendaTime(second, CHI, "en", false)).toBe("1:30 AM");
  });

  it("reads the account's zone, never the system's", () => {
    expect(agendaTime(new Date("2026-09-07T14:00:00.000Z"), "America/Los_Angeles", "en", false)).toBe("7:00 AM");
  });
});

describe("wallToInstant", () => {
  it("is null inside the spring-forward gap and exact either side of it", () => {
    expect(wallToInstant("2026-03-08", "02:30", CHI)).toBeNull();
    expect(iso(wallToInstant("2026-03-08", "03:00", CHI))).toBe("2026-03-08T08:00:00.000Z");
    expect(iso(wallToInstant("2026-03-08", "01:59", CHI))).toBe("2026-03-08T07:59:00.000Z");
  });
});

describe("freeHours: every whole open hour with no live job, from now on", () => {
  const MON = { mon: [["09:00", "12:00"]] as [string, string][] };
  const job = { startsAt: new Date("2026-09-07T15:00:00.000Z"), endsAt: new Date("2026-09-07T15:30:00.000Z") }; // Mon 10:00–10:30 CDT

  it("Monday 09:00–12:00 with a job 10:00–10:30 and now 08:00 offers 09:00 and 11:00", () => {
    const now = new Date("2026-09-07T13:00:00.000Z"); // 08:00 CDT
    expect(freeHours({ dayKey: "2026-09-07", timezone: CHI, openHours: MON, live: [job], now }).map(iso))
      .toEqual(["2026-09-07T14:00:00.000Z", "2026-09-07T16:00:00.000Z"]);
  });

  it("hours that start before now are left out", () => {
    const now = new Date("2026-09-07T15:45:00.000Z"); // 10:45 CDT
    expect(freeHours({ dayKey: "2026-09-07", timezone: CHI, openHours: MON, live: [], now }).map(iso))
      .toEqual(["2026-09-07T16:00:00.000Z"]);
  });

  it("an interval opening off the hour starts at the next whole hour, and a closed day has none", () => {
    const now = new Date("2026-09-01T00:00:00.000Z");
    expect(freeHours({ dayKey: "2026-09-07", timezone: CHI, openHours: { mon: [["09:30", "12:00"]] }, live: [], now }).map(iso))
      .toEqual(["2026-09-07T15:00:00.000Z", "2026-09-07T16:00:00.000Z"]);
    expect(freeHours({ dayKey: "2026-09-08", timezone: CHI, openHours: MON, live: [], now })).toEqual([]);
  });

  it("on the spring-forward day the 02:00 that does not exist is never offered", () => {
    const now = new Date("2026-03-01T00:00:00.000Z");
    expect(freeHours({ dayKey: "2026-03-08", timezone: CHI, openHours: { sun: [["00:00", "04:00"]] }, live: [], now }).map(iso))
      .toEqual(["2026-03-08T06:00:00.000Z", "2026-03-08T07:00:00.000Z", "2026-03-08T08:00:00.000Z"]);
  });

  it("on the fall-back day the repeated 01:00 is offered ONCE, as its first occurrence (CDT), never the second (CST)", () => {
    // Accepted (owner carry-in, T12): a typed "01:00" resolves to the first occurrence, so no free row offers the second.
    const now = new Date("2026-10-25T00:00:00.000Z");
    expect(freeHours({ dayKey: "2026-11-01", timezone: CHI, openHours: { sun: [["00:00", "04:00"]] }, live: [], now }).map(iso))
      .toEqual(["2026-11-01T05:00:00.000Z", "2026-11-01T06:00:00.000Z", "2026-11-01T08:00:00.000Z", "2026-11-01T09:00:00.000Z"]);
  });
});
