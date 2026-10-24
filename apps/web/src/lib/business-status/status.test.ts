// S-47d Task 4: the pure status reader. Every instant below is a typed-out literal; the zone is
// America/Chicago unless a row names another. Run under TZ unset AND TZ=Asia/Tokyo: nothing here may read the
// server's zone.
import { describe, expect, it } from "vitest";
import { closedOut, type OpenHours } from "../booking/slots";
import {
  addDays, closedDayOn, closureListWindow, coversAppointment, dayKey, effectiveStatus, fromWire, hoursChain,
  reopeningFrom, rowInForce, slotClosures, startOfDay, statusCode, toWire, untilFor, wallTime,
  type ClosedDay, type EffectiveStatus, type StatusInput, type StatusRowInput,
} from "./status";

const TZ = "America/Chicago";
const H: OpenHours = {
  mon: [["08:00", "17:00"]], tue: [["08:00", "17:00"]], wed: [["08:00", "17:00"]],
  thu: [["08:00", "17:00"]], fri: [["08:00", "17:00"]],
};
const SUN_H: OpenHours = { ...H, sun: [["08:00", "12:00"]] };
const CAL: OpenHours = { sat: [["09:00", "13:00"]] };

const d = (iso: string) => new Date(iso);
const input = (over: Partial<StatusInput> & { now: Date }): StatusInput => ({
  row: null, closedDays: [], hours: H, timezone: TZ, ...over,
});
const closedToday = (set_at: string, until: string): StatusRowInput => ({ state: "closed_today", late_minutes: null, until, set_at });
const late = (late_minutes: number, set_at: string, until: string): StatusRowInput => ({ state: "running_late", late_minutes, until, set_at });
const storm = (set_at: string, until: string | null): StatusRowInput => ({ state: "storm", late_minutes: null, until, set_at });

describe("hoursChain (D3: business hours with an open day, else the calendar's, else null)", () => {
  it("takes business hours when they have an open day", () => {
    expect(hoursChain(H, CAL)).toEqual(H);
  });
  it("falls to the calendar when business hours are missing, empty or malformed", () => {
    expect(hoursChain(null, CAL)).toEqual(CAL);
    expect(hoursChain({}, CAL)).toEqual(CAL);
    expect(hoursChain({ mon: [["9am", "5pm"]] }, CAL)).toEqual(CAL);
  });
  it("is null when neither source has an open day", () => {
    expect(hoursChain(null, null)).toBeNull();
    expect(hoursChain({ mon: [] }, { sat: [["13:00", "09:00"]] })).toBeNull();
  });
  it("normalizes what it returns", () => {
    expect(hoursChain({ mon: [["08:00", "17:00"], ["bad", "17:00"]], xyz: [["08:00", "09:00"]] }, null))
      .toEqual({ mon: [["08:00", "17:00"]] });
  });
});

describe("dayKey, addDays, wallTime, startOfDay", () => {
  it("dayKey reads the zone's calendar date, not UTC's or a fixed offset's", () => {
    expect(dayKey(d("2027-03-14T05:30:00.000Z"), TZ)).toBe("2027-03-13"); // 23:30 CST
    expect(dayKey(d("2027-06-02T04:59:00.000Z"), TZ)).toBe("2027-06-01"); // 23:59 CDT
    expect(dayKey(d("2027-06-02T05:00:00.000Z"), TZ)).toBe("2027-06-02");
    expect(dayKey(d("2027-03-27T22:30:00.000Z"), "Asia/Beirut")).toBe("2027-03-28"); // 01:30 EEST
    expect(dayKey(d("2027-01-05T15:30:00.000Z"), "Asia/Tokyo")).toBe("2027-01-06");
  });
  it("addDays is calendar arithmetic across months, years and a leap day", () => {
    expect(addDays("2027-06-30", 1)).toBe("2027-07-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-03-01", -1)).toBe("2027-02-28");
    expect(addDays("2027-03-14", 0)).toBe("2027-03-14");
  });
  it("wallTime in a DST gap is the first minute after the gap", () => {
    expect(wallTime("2027-03-14", "02:30", TZ).toISOString()).toBe("2027-03-14T08:00:00.000Z");
    expect(wallTime("2027-03-14", "02:00", TZ).toISOString()).toBe("2027-03-14T08:00:00.000Z");
    expect(wallTime("2027-03-14", "03:00", TZ).toISOString()).toBe("2027-03-14T08:00:00.000Z");
    expect(wallTime("2027-03-14", "01:59", TZ).toISOString()).toBe("2027-03-14T07:59:00.000Z");
  });
  it("startOfDay is local midnight on either side of the Chicago transitions", () => {
    expect(startOfDay("2027-03-14", TZ).toISOString()).toBe("2027-03-14T06:00:00.000Z");
    expect(startOfDay("2027-03-15", TZ).toISOString()).toBe("2027-03-15T05:00:00.000Z");
    expect(startOfDay("2026-11-01", TZ).toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(startOfDay("2026-11-02", TZ).toISOString()).toBe("2026-11-02T06:00:00.000Z");
  });
});

describe("rowInForce and closedDayOn", () => {
  const row = closedToday("2027-06-01T12:00:00.000Z", "2027-06-02T05:00:00.000Z");
  it("is in force strictly before until, and not at it", () => {
    expect(rowInForce(row, d("2027-06-02T04:59:59.999Z"))).toBe(true);
    expect(rowInForce(row, d("2027-06-02T05:00:00.000Z"))).toBe(false);
    expect(rowInForce(null, d("2027-06-01T12:00:00.000Z"))).toBe(false);
    expect(rowInForce({ state: "open", late_minutes: null, until: null, set_at: "2027-06-01T12:00:00.000Z" }, d("2027-06-01T12:00:00.000Z"))).toBe(false);
    expect(rowInForce(storm("2027-06-01T12:00:00.000Z", null), d("2028-06-01T12:00:00.000Z"))).toBe(true);
  });
  it("closedDayOn holds both ends of a range and nothing outside it", () => {
    const r: ClosedDay = { starts_on: "2027-06-07", ends_on: "2027-06-09", reason: "vacation" };
    expect(closedDayOn("2027-06-07", [r])).toBe(r);
    expect(closedDayOn("2027-06-09", [r])).toBe(r);
    expect(closedDayOn("2027-06-06", [r])).toBeNull();
    expect(closedDayOn("2027-06-10", [r])).toBeNull();
  });
});

describe("each state in force, then the same row expired", () => {
  const OPEN = { state: "open", nextClosedDay: null };
  it("Closed today", () => {
    const row = closedToday("2027-06-01T12:00:00.000Z", "2027-06-02T05:00:00.000Z");
    expect(effectiveStatus(input({ row, now: d("2027-06-01T12:00:00.000Z") })).state).toBe("closed_today");
    expect(effectiveStatus(input({ row, now: d("2027-06-02T05:00:00.000Z") }))).toEqual(OPEN);
    expect(effectiveStatus(input({ row, now: d("2027-06-03T12:00:00.000Z") }))).toEqual(OPEN);
  });
  it("Running late", () => {
    const row = late(30, "2027-06-01T15:00:00.000Z", "2027-06-02T05:00:00.000Z");
    expect(effectiveStatus(input({ row, now: d("2027-06-01T15:00:00.000Z") }))).toEqual({
      state: "running_late", lateMinutes: 30, endsAt: d("2027-06-02T05:00:00.000Z"),
    });
    expect(effectiveStatus(input({ row, now: d("2027-06-02T05:00:00.000Z") }))).toEqual(OPEN);
  });
  it("a dated Storm", () => {
    const row = storm("2027-06-02T15:00:00.000Z", "2027-06-07T05:00:00.000Z");
    expect(effectiveStatus(input({ row, now: d("2027-06-02T15:00:00.000Z") })).state).toBe("storm");
    expect(effectiveStatus(input({ row, now: d("2027-06-07T05:00:00.000Z") }))).toEqual(OPEN);
  });
  it("an open-ended Storm never expires and says no reopening", () => {
    const row = storm("2027-06-02T15:00:00.000Z", null);
    expect(effectiveStatus(input({ row, now: d("2027-09-02T15:00:00.000Z") }))).toEqual({
      state: "storm", reopensAt: null, reopensTimeKnown: false,
    });
  });
  it("a closed day is in force on its dates only", () => {
    const closedDays: ClosedDay[] = [{ starts_on: "2027-06-01", ends_on: "2027-06-01", reason: "holiday" }];
    expect(effectiveStatus(input({ closedDays, now: d("2027-06-01T05:00:00.000Z") })).state).toBe("closed_day");
    expect(effectiveStatus(input({ closedDays, now: d("2027-06-02T05:00:00.000Z") }))).toEqual(OPEN);
  });
  it("an unexpected late_minutes reads as the widest window (fails closed)", () => {
    const row = late(45, "2027-06-01T15:00:00.000Z", "2027-06-02T05:00:00.000Z");
    expect(effectiveStatus(input({ row, now: d("2027-06-01T15:00:00.000Z") }))).toMatchObject({ lateMinutes: 120 });
  });
});

describe("precedence (S11): storm > closed day > Closed today > Running late > open", () => {
  const today: ClosedDay[] = [{ starts_on: "2027-06-01", ends_on: "2027-06-01", reason: "holiday" }];
  const now = d("2027-06-01T15:00:00.000Z");
  it("storm + closed day -> storm", () => {
    const e = effectiveStatus(input({ row: storm("2027-06-01T14:00:00.000Z", null), closedDays: today, now }));
    expect(e.state).toBe("storm");
  });
  it("closed day + Closed today -> closed_day", () => {
    const e = effectiveStatus(input({ row: closedToday("2027-06-01T14:00:00.000Z", "2027-06-02T05:00:00.000Z"), closedDays: today, now }));
    expect(e).toEqual({
      state: "closed_day", reason: "holiday", startsOn: "2027-06-01", endsOn: "2027-06-01",
      reopensAt: d("2027-06-02T13:00:00.000Z"), reopensTimeKnown: true,
    });
  });
  it("closed day + Running late -> closed_day", () => {
    const e = effectiveStatus(input({ row: late(60, "2027-06-01T14:00:00.000Z", "2027-06-02T05:00:00.000Z"), closedDays: today, now }));
    expect(e.state).toBe("closed_day");
  });
  it("Closed today alone -> closed_today", () => {
    const e = effectiveStatus(input({ row: closedToday("2027-06-01T14:00:00.000Z", "2027-06-02T05:00:00.000Z"), now }));
    expect(e.state).toBe("closed_today");
  });
  it("Running late alone -> running_late", () => {
    const e = effectiveStatus(input({ row: late(15, "2027-06-01T14:00:00.000Z", "2027-06-02T05:00:00.000Z"), now }));
    expect(e.state).toBe("running_late");
  });
});

describe("S1 with D12: Closed today's window ends tonight; what is said is a later day's opening", () => {
  const setAt = d("2027-06-01T12:00:00.000Z"); // Tuesday 07:00 CDT
  it("untilFor is tonight's midnight, not Wednesday's (or Tuesday's) 08:00", () => {
    expect(untilFor({ state: "closed_today" }, H, TZ, setAt)?.toISOString()).toBe("2027-06-02T05:00:00.000Z");
  });
  it("the reopening said is Wednesday 08:00, then the row expires at midnight", () => {
    const row = closedToday("2027-06-01T12:00:00.000Z", "2027-06-02T05:00:00.000Z");
    expect(effectiveStatus(input({ row, now: setAt }))).toEqual({
      state: "closed_today", reopensAt: d("2027-06-02T13:00:00.000Z"), reopensTimeKnown: true,
    });
    expect(effectiveStatus(input({ row, now: d("2027-06-02T05:00:00.000Z") }))).toEqual({ state: "open", nextClosedDay: null });
  });
});

describe("D12, two hours sources: business Mon-Fri, calendar Saturday", () => {
  const now = d("2027-06-04T15:00:00.000Z"); // Friday 10:00 CDT
  const hours = hoursChain(H, CAL);
  const row = closedToday("2027-06-04T15:00:00.000Z", "2027-06-05T05:00:00.000Z");
  const sat9 = d("2027-06-05T14:00:00.000Z");
  it("the chain is the business hours", () => {
    expect(hours).toEqual(H);
  });
  it("untilFor is Saturday 00:00", () => {
    expect(untilFor({ state: "closed_today" }, hours, TZ, now)?.toISOString()).toBe("2027-06-05T05:00:00.000Z");
  });
  it("Saturday 09:00 is not blocked", () => {
    const c = slotClosures(input({ row, hours, now }));
    expect(c.blockedBefore?.toISOString()).toBe("2027-06-05T05:00:00.000Z");
    expect(c.blockedBefore!.getTime() <= sat9.getTime()).toBe(true);
    expect([c.blockAll, c.lateBefore, [...c.closedDayKeys]]).toEqual([false, null, []]);
    expect(closedOut(sat9, c, TZ)).toBe(false);
    expect(closedOut(d("2027-06-04T21:00:00.000Z"), c, TZ)).toBe(true); // Friday 16:00, the control
  });
  it("a Saturday 09:00 appointment is not covered", () => {
    expect(coversAppointment(input({ row, hours, now }), sat9)).toEqual({ covered: false });
  });
  it("the reopening said still follows the chain: Monday 08:00", () => {
    expect(effectiveStatus(input({ row, hours, now }))).toEqual({
      state: "closed_today", reopensAt: d("2027-06-07T13:00:00.000Z"), reopensTimeKnown: true,
    });
  });
});

describe("untilFor", () => {
  it("Running late ends at tonight's midnight", () => {
    expect(untilFor({ state: "running_late", lateMinutes: 30 }, H, TZ, d("2027-06-01T15:00:00.000Z"))?.toISOString())
      .toBe("2027-06-02T05:00:00.000Z");
  });
  it("a Storm back on Monday ends at Monday 00:00; the reopening said is Monday 08:00", () => {
    const now = d("2027-06-02T15:00:00.000Z");
    expect(untilFor({ state: "storm", backOn: "2027-06-07" }, H, TZ, now)?.toISOString()).toBe("2027-06-07T05:00:00.000Z");
    const row = storm("2027-06-02T15:00:00.000Z", "2027-06-07T05:00:00.000Z");
    expect(effectiveStatus(input({ row, now }))).toEqual({
      state: "storm", reopensAt: d("2027-06-07T13:00:00.000Z"), reopensTimeKnown: true,
    });
  });
  it("an open-ended Storm, Open, and a malformed back-on date are null (the storm then blocks everything)", () => {
    const now = d("2027-06-02T15:00:00.000Z");
    expect(untilFor({ state: "storm", backOn: null }, H, TZ, now)).toBeNull();
    expect(untilFor({ state: "open" }, H, TZ, now)).toBeNull();
    expect(untilFor({ state: "storm", backOn: "2027-6-7" }, H, TZ, now)).toBeNull();
    expect(untilFor({ state: "storm", backOn: "2027-02-30" }, H, TZ, now)).toBeNull();
  });
});

describe("a storm back on a Saturday the hours chain has closed (orchestrator ruling 2026-10-23)", () => {
  const now = d("2027-06-02T15:00:00.000Z"); // Wednesday 10:00 CDT
  const hours = hoursChain(H, CAL);
  const until = untilFor({ state: "storm", backOn: "2027-06-05" }, hours, TZ, now);
  const row = storm("2027-06-02T15:00:00.000Z", "2027-06-05T05:00:00.000Z");
  const sat9 = d("2027-06-05T14:00:00.000Z");
  it("the window ends Saturday 00:00", () => {
    expect(until?.toISOString()).toBe("2027-06-05T05:00:00.000Z");
  });
  it("by Saturday 08:00 the row has expired", () => {
    expect(effectiveStatus(input({ row, hours, now: d("2027-06-05T13:00:00.000Z") }))).toEqual({ state: "open", nextClosedDay: null });
  });
  it("on Wednesday, Saturday 09:00 is not blocked", () => {
    const c = slotClosures(input({ row: { ...row, until: until!.toISOString() }, hours, now }));
    expect(c.blockedBefore?.toISOString()).toBe("2027-06-05T05:00:00.000Z");
    expect(c.blockedBefore!.getTime() <= sat9.getTime()).toBe(true);
    expect(c.blockAll).toBe(false);
    expect(closedOut(sat9, c, TZ)).toBe(false);
    expect(closedOut(d("2027-06-04T21:00:00.000Z"), c, TZ)).toBe(true); // Friday 16:00, the control
  });
  it("on Wednesday, a Saturday 09:00 appointment is not covered", () => {
    expect(coversAppointment(input({ row: { ...row, until: until!.toISOString() }, hours, now }), sat9)).toEqual({ covered: false });
  });
  it("the reopening said on Wednesday is Monday 08:00", () => {
    expect(effectiveStatus(input({ row, hours, now }))).toEqual({
      state: "storm", reopensAt: d("2027-06-07T13:00:00.000Z"), reopensTimeKnown: true,
    });
  });
});

describe("reopeningFrom", () => {
  it("with business hours: a later span the same day, a span starting exactly at from, then the next day", () => {
    expect(reopeningFrom(d("2027-06-01T12:00:00.000Z"), H, TZ, [])).toEqual({ at: d("2027-06-01T13:00:00.000Z"), timeKnown: true });
    expect(reopeningFrom(d("2027-06-01T13:00:00.000Z"), H, TZ, [])).toEqual({ at: d("2027-06-01T13:00:00.000Z"), timeKnown: true });
    expect(reopeningFrom(d("2027-06-01T13:01:00.000Z"), H, TZ, [])).toEqual({ at: d("2027-06-02T13:00:00.000Z"), timeKnown: true });
  });
  it("takes the earliest span of a day whose spans are stored out of order", () => {
    const hours: OpenHours = { wed: [["13:00", "17:00"], ["08:00", "12:00"]] };
    expect(reopeningFrom(d("2027-06-02T05:00:00.000Z"), hours, TZ, [])).toEqual({ at: d("2027-06-02T13:00:00.000Z"), timeKnown: true });
  });
  it("with only calendar hours", () => {
    expect(reopeningFrom(d("2027-06-02T15:00:00.000Z"), hoursChain(null, CAL), TZ, []))
      .toEqual({ at: d("2027-06-05T14:00:00.000Z"), timeKnown: true });
  });
  it("with no hours, a from that is exactly midnight is itself the answer (SD3)", () => {
    expect(reopeningFrom(d("2027-06-02T05:00:00.000Z"), null, TZ, [])).toEqual({ at: d("2027-06-02T05:00:00.000Z"), timeKnown: false });
    expect(reopeningFrom(d("2027-06-02T05:00:00.001Z"), null, TZ, [])).toEqual({ at: d("2027-06-03T05:00:00.000Z"), timeKnown: false });
  });
  it("with no hours, a closed day is skipped", () => {
    const closed: ClosedDay[] = [{ starts_on: "2027-06-02", ends_on: "2027-06-03", reason: null }];
    expect(reopeningFrom(d("2027-06-02T05:00:00.000Z"), null, TZ, closed)).toEqual({ at: d("2027-06-04T05:00:00.000Z"), timeKnown: false });
  });
  it("hours with no open day read as no hours", () => {
    expect(reopeningFrom(d("2027-06-02T05:00:00.000Z"), {}, TZ, [])).toEqual({ at: d("2027-06-02T05:00:00.000Z"), timeKnown: false });
  });
  it("across a weekend: Friday 18:00 -> Monday 08:00", () => {
    expect(reopeningFrom(d("2027-06-04T23:00:00.000Z"), H, TZ, [])).toEqual({ at: d("2027-06-07T13:00:00.000Z"), timeKnown: true });
  });
  it("skipping a closed range: Monday closed -> Tuesday 08:00", () => {
    const closed: ClosedDay[] = [{ starts_on: "2027-06-07", ends_on: "2027-06-07", reason: "holiday" }];
    expect(reopeningFrom(d("2027-06-04T23:00:00.000Z"), H, TZ, closed)).toEqual({ at: d("2027-06-08T13:00:00.000Z"), timeKnown: true });
  });
  it("a span starting 02:30 on the spring-forward day opens at 03:00 CDT", () => {
    const hours: OpenHours = { sun: [["02:30", "05:00"]] };
    expect(reopeningFrom(d("2027-03-14T06:00:00.000Z"), hours, TZ, [])).toEqual({ at: d("2027-03-14T08:00:00.000Z"), timeKnown: true });
  });
});

describe("DST in Chicago (spec section 7)", () => {
  it("Closed today on Saturday 2027-03-13 (spring forward overnight)", () => {
    const now = d("2027-03-13T16:00:00.000Z");
    const until = untilFor({ state: "closed_today" }, H, TZ, now);
    expect(until?.toISOString()).toBe("2027-03-14T06:00:00.000Z");
    const row = closedToday("2027-03-13T16:00:00.000Z", "2027-03-14T06:00:00.000Z");
    expect(effectiveStatus(input({ row, hours: SUN_H, now }))).toMatchObject({ reopensAt: d("2027-03-14T13:00:00.000Z") });
    expect(effectiveStatus(input({ row, hours: H, now }))).toMatchObject({ reopensAt: d("2027-03-15T13:00:00.000Z") });
  });
  it("Closed today on Saturday 2026-10-31 (fall back overnight)", () => {
    const now = d("2026-10-31T15:00:00.000Z");
    const until = untilFor({ state: "closed_today" }, H, TZ, now);
    expect(until?.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    const row = closedToday("2026-10-31T15:00:00.000Z", "2026-11-01T05:00:00.000Z");
    expect(effectiveStatus(input({ row, hours: SUN_H, now }))).toMatchObject({ reopensAt: d("2026-11-01T14:00:00.000Z") });
    expect(effectiveStatus(input({ row, hours: H, now }))).toMatchObject({ reopensAt: d("2026-11-02T14:00:00.000Z") });
  });
});

describe("zones whose midnight is the DST gap, and Santiago's fall-back", () => {
  const ROWS = [
    { zone: "America/Havana", now: "2027-03-13T20:00:00.000Z", day: "2027-03-14", start: "2027-03-14T05:00:00.000Z" },
    { zone: "America/Santiago", now: "2026-09-05T19:00:00.000Z", day: "2026-09-06", start: "2026-09-06T04:00:00.000Z" },
    { zone: "Asia/Beirut", now: "2027-03-27T13:00:00.000Z", day: "2027-03-28", start: "2027-03-27T22:00:00.000Z" },
    { zone: "America/Santiago", now: "2027-04-03T18:00:00.000Z", day: "2027-04-04", start: "2027-04-04T04:00:00.000Z" },
  ] as const;
  // minors-1b item 9: the "covers the four rows of the plan's table" assertion that used to sit here
  // mapped ROWS (this file's own fixture, defined two lines up) to a string and compared it to another
  // hand-typed list of the SAME four strings — no production code runs in computing either side, so no
  // mutation to status.ts could ever have failed it. The real, fallible coverage of these four rows is
  // the loop below: each iteration calls dayKey/startOfDay/untilFor/reopeningFrom against a typed-literal
  // expected value.
  for (const r of ROWS) {
    it(`${r.zone} ${r.day}: start of day, both midnights and the no-hours reopening`, () => {
      const now = d(r.now);
      expect(dayKey(now, r.zone)).toBe(addDays(r.day, -1));
      expect(startOfDay(r.day, r.zone).toISOString()).toBe(r.start);
      expect(untilFor({ state: "running_late", lateMinutes: 30 }, null, r.zone, now)?.toISOString()).toBe(r.start);
      expect(untilFor({ state: "closed_today" }, null, r.zone, now)?.toISOString()).toBe(r.start);
      expect(reopeningFrom(startOfDay(r.day, r.zone), null, r.zone, [])).toEqual({ at: d(r.start), timeKnown: false });
    });
  }
});

describe("slotClosures", () => {
  it("Running late at 11 PM with 120: lateBefore is the midnight, not now + 2 h", () => {
    const now = d("2027-06-02T04:00:00.000Z");
    const c = slotClosures(input({ row: late(120, "2027-06-02T04:00:00.000Z", "2027-06-02T05:00:00.000Z"), now }));
    expect(c.lateBefore?.toISOString()).toBe("2027-06-02T05:00:00.000Z");
    expect(d("2027-06-02T05:30:00.000Z").getTime() < c.lateBefore!.getTime()).toBe(false);
    expect([c.blockedBefore, c.blockAll]).toEqual([null, false]);
  });
  it("Running late at 10 AM with 30: lateBefore is now + 30 min", () => {
    const c = slotClosures(input({ row: late(30, "2027-06-01T15:00:00.000Z", "2027-06-02T05:00:00.000Z"), now: d("2027-06-01T15:00:00.000Z") }));
    expect(c.lateBefore?.toISOString()).toBe("2027-06-01T15:30:00.000Z");
  });
  it("closedDayKeys of a 3-day range holds exactly those 3 keys", () => {
    const c = slotClosures(input({
      closedDays: [{ starts_on: "2027-06-30", ends_on: "2027-07-02", reason: "vacation" }], now: d("2027-06-01T15:00:00.000Z"),
    }));
    expect([...c.closedDayKeys].sort()).toEqual(["2027-06-30", "2027-07-01", "2027-07-02"]);
    expect([c.blockedBefore, c.blockAll, c.lateBefore]).toEqual([null, false, null]);
  });
  it("an open-ended storm blocks everything", () => {
    const c = slotClosures(input({ row: storm("2027-06-01T15:00:00.000Z", null), now: d("2027-06-01T15:00:00.000Z") }));
    expect([c.blockedBefore, c.blockAll, c.lateBefore]).toEqual([null, true, null]);
  });
  it("a dated storm blocks before its until", () => {
    const c = slotClosures(input({ row: storm("2027-06-02T15:00:00.000Z", "2027-06-07T05:00:00.000Z"), now: d("2027-06-02T15:00:00.000Z") }));
    expect([c.blockedBefore?.toISOString(), c.blockAll, c.lateBefore]).toEqual(["2027-06-07T05:00:00.000Z", false, null]);
  });
  it("an expired row closes nothing", () => {
    const c = slotClosures(input({ row: storm("2027-06-02T15:00:00.000Z", "2027-06-07T05:00:00.000Z"), now: d("2027-06-07T05:00:00.000Z") }));
    expect([c.blockedBefore, c.blockAll, c.lateBefore, c.closedDayKeys.size]).toEqual([null, false, null, 0]);
  });
});

describe("coversAppointment", () => {
  const now = d("2027-06-01T12:00:00.000Z");
  const row = closedToday("2027-06-01T12:00:00.000Z", "2027-06-02T05:00:00.000Z");
  it("Closed today: [set_at, until) edges, endsAt is tonight's midnight", () => {
    const cov = { covered: true, kind: "closed_today", endsAt: d("2027-06-02T05:00:00.000Z") };
    expect(coversAppointment(input({ row, now }), d("2027-06-01T12:00:00.000Z"))).toEqual(cov);
    expect(coversAppointment(input({ row, now }), d("2027-06-02T04:59:59.999Z"))).toEqual(cov);
    expect(coversAppointment(input({ row, now }), d("2027-06-02T05:00:00.000Z"))).toEqual({ covered: false });
    expect(coversAppointment(input({ row, now }), d("2027-06-01T11:59:59.999Z"))).toEqual({ covered: false });
  });
  it("a dated storm covers to its until", () => {
    const s = storm("2027-06-02T15:00:00.000Z", "2027-06-07T05:00:00.000Z");
    const i = input({ row: s, now: d("2027-06-02T15:00:00.000Z") });
    expect(coversAppointment(i, d("2027-06-04T14:00:00.000Z"))).toEqual({ covered: true, kind: "storm", endsAt: d("2027-06-07T05:00:00.000Z") });
    expect(coversAppointment(i, d("2027-06-07T05:00:00.000Z"))).toEqual({ covered: false });
  });
  it("an open-ended storm covers everything from set_at, with no end", () => {
    const i = input({ row: storm("2027-06-02T15:00:00.000Z", null), now: d("2027-06-02T15:00:00.000Z") });
    expect(coversAppointment(i, d("2027-09-04T14:00:00.000Z"))).toEqual({ covered: true, kind: "storm", endsAt: null });
    expect(coversAppointment(i, d("2027-06-02T14:59:59.999Z"))).toEqual({ covered: false });
  });
  it("a closed day covers its dates; endsAt is the start of the day after the range", () => {
    const i = input({ closedDays: [{ starts_on: "2027-06-07", ends_on: "2027-06-08", reason: "holiday" }], now });
    const cov = { covered: true, kind: "closed_day", endsAt: d("2027-06-09T05:00:00.000Z") };
    expect(coversAppointment(i, d("2027-06-07T14:00:00.000Z"))).toEqual(cov);
    expect(coversAppointment(i, d("2027-06-09T04:59:00.000Z"))).toEqual(cov); // 23:59 CDT on the 8th
    expect(coversAppointment(i, d("2027-06-09T05:00:00.000Z"))).toEqual({ covered: false });
  });
  it("Running late covers nothing", () => {
    const i = input({ row: late(120, "2027-06-01T12:00:00.000Z", "2027-06-02T05:00:00.000Z"), now });
    expect(coversAppointment(i, d("2027-06-01T13:00:00.000Z"))).toEqual({ covered: false });
  });
  it("an expired Closed today covers nothing", () => {
    expect(coversAppointment(input({ row, now: d("2027-06-02T05:00:00.000Z") }), d("2027-06-01T13:00:00.000Z"))).toEqual({ covered: false });
  });
});

describe("closureListWindow (S7, S22)", () => {
  it("Closed today at 10:00 lists to tonight's midnight", () => {
    const now = d("2027-06-01T15:00:00.000Z");
    expect(closureListWindow(input({ row: closedToday("2027-06-01T15:00:00.000Z", "2027-06-02T05:00:00.000Z"), now })))
      .toEqual({ from: now, to: d("2027-06-02T05:00:00.000Z"), capped: false });
  });
  it("a Storm back on Thursday lists to Thursday 00:00", () => {
    const now = d("2027-06-07T15:00:00.000Z");
    expect(closureListWindow(input({ row: storm("2027-06-07T15:00:00.000Z", "2027-06-10T05:00:00.000Z"), now })))
      .toEqual({ from: now, to: d("2027-06-10T05:00:00.000Z"), capped: false });
  });
  it("an open-ended storm lists exactly 14 days, capped", () => {
    const now = d("2027-06-07T15:00:00.000Z");
    expect(closureListWindow(input({ row: storm("2027-06-07T15:00:00.000Z", null), now })))
      .toEqual({ from: now, to: d("2027-06-21T15:00:00.000Z"), capped: true });
  });
  it("a closed day today ending in 20 days is capped at 14 days", () => {
    const now = d("2027-06-01T15:00:00.000Z");
    const closedDays: ClosedDay[] = [{ starts_on: "2027-06-01", ends_on: "2027-06-21", reason: "vacation" }];
    expect(closureListWindow(input({ closedDays, now }))).toEqual({ from: now, to: d("2027-06-15T15:00:00.000Z"), capped: true });
  });
  it("a closed day today ending tomorrow lists to the start of the day after", () => {
    const now = d("2027-06-01T15:00:00.000Z");
    const closedDays: ClosedDay[] = [{ starts_on: "2027-06-01", ends_on: "2027-06-02", reason: null }];
    expect(closureListWindow(input({ closedDays, now }))).toEqual({ from: now, to: d("2027-06-03T05:00:00.000Z"), capped: false });
  });
  it("open and Running late have no list", () => {
    const now = d("2027-06-01T15:00:00.000Z");
    expect(closureListWindow(input({ now }))).toBeNull();
    expect(closureListWindow(input({ row: late(30, "2027-06-01T15:00:00.000Z", "2027-06-02T05:00:00.000Z"), now }))).toBeNull();
  });
});

describe("statusCode", () => {
  const at = d("2027-06-02T13:00:00.000Z");
  it("gives each of the eight codes", () => {
    const cases: [EffectiveStatus, string][] = [
      [{ state: "open", nextClosedDay: null }, "open"],
      [{ state: "closed_today", reopensAt: at, reopensTimeKnown: true }, "closed_today"],
      [{ state: "running_late", lateMinutes: 15, endsAt: at }, "running_late_15"],
      [{ state: "running_late", lateMinutes: 30, endsAt: at }, "running_late_30"],
      [{ state: "running_late", lateMinutes: 60, endsAt: at }, "running_late_60"],
      [{ state: "running_late", lateMinutes: 120, endsAt: at }, "running_late_120"],
      [{ state: "storm", reopensAt: null, reopensTimeKnown: false }, "storm"],
      [{ state: "closed_day", reason: null, startsOn: "2027-06-01", endsOn: "2027-06-01", reopensAt: at, reopensTimeKnown: true }, "closed_day"],
    ];
    expect(cases.map(([e]) => statusCode(e))).toEqual([
      "open", "closed_today", "running_late_15", "running_late_30", "running_late_60", "running_late_120", "storm", "closed_day",
    ]);
  });
});

describe("effectiveStatus open: the next closed day within 14 days", () => {
  const now = d("2027-06-01T15:00:00.000Z"); // Tuesday 2027-06-01
  it("a range starting in 14 days is named; the earliest of two wins", () => {
    const r14: ClosedDay = { starts_on: "2027-06-15", ends_on: "2027-06-15", reason: "holiday" };
    const r10: ClosedDay = { starts_on: "2027-06-11", ends_on: "2027-06-12", reason: null };
    expect(effectiveStatus(input({ closedDays: [r14], now }))).toEqual({ state: "open", nextClosedDay: r14 });
    expect(effectiveStatus(input({ closedDays: [r14, r10], now }))).toEqual({ state: "open", nextClosedDay: r10 });
  });
  it("a range starting in 15 days, or already over, is not", () => {
    expect(effectiveStatus(input({ closedDays: [{ starts_on: "2027-06-16", ends_on: "2027-06-16", reason: null }], now })))
      .toEqual({ state: "open", nextClosedDay: null });
    expect(effectiveStatus(input({ closedDays: [{ starts_on: "2027-05-30", ends_on: "2027-05-31", reason: null }], now })))
      .toEqual({ state: "open", nextClosedDay: null });
  });
});

describe("toWire / fromWire", () => {
  const at = d("2027-06-02T13:00:00.000Z");
  const day: ClosedDay = { starts_on: "2027-06-15", ends_on: "2027-06-15", reason: "holiday" };
  const cases: [EffectiveStatus, unknown][] = [
    [{ state: "open", nextClosedDay: null }, { state: "open", nextClosedDay: null }],
    [{ state: "open", nextClosedDay: day }, { state: "open", nextClosedDay: { starts_on: "2027-06-15", ends_on: "2027-06-15", reason: "holiday" } }],
    [{ state: "running_late", lateMinutes: 60, endsAt: at }, { state: "running_late", lateMinutes: 60, endsAt: "2027-06-02T13:00:00.000Z" }],
    [{ state: "closed_today", reopensAt: at, reopensTimeKnown: true }, { state: "closed_today", reopensAt: "2027-06-02T13:00:00.000Z", reopensTimeKnown: true }],
    [{ state: "storm", reopensAt: null, reopensTimeKnown: false }, { state: "storm", reopensAt: null, reopensTimeKnown: false }],
    [{ state: "storm", reopensAt: at, reopensTimeKnown: true }, { state: "storm", reopensAt: "2027-06-02T13:00:00.000Z", reopensTimeKnown: true }],
    [
      { state: "closed_day", reason: "vacation", startsOn: "2027-06-01", endsOn: "2027-06-03", reopensAt: at, reopensTimeKnown: false },
      { state: "closed_day", reason: "vacation", startsOn: "2027-06-01", endsOn: "2027-06-03", reopensAt: "2027-06-02T13:00:00.000Z", reopensTimeKnown: false },
    ],
  ];
  it("covers all five states", () => {
    expect(cases.map(([e]) => e.state)).toEqual(["open", "open", "running_late", "closed_today", "storm", "storm", "closed_day"]);
  });
  for (const [e, wire] of cases) {
    it(`${e.state}: wire form is plain JSON and round-trips`, () => {
      expect(toWire(e)).toEqual(wire);
      expect(JSON.parse(JSON.stringify(toWire(e)))).toEqual(wire);
      expect(fromWire(JSON.parse(JSON.stringify(toWire(e))))).toEqual(e);
    });
  }
});
