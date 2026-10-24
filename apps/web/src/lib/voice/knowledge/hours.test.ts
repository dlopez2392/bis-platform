import { describe, it, expect } from "vitest";
import { hoursLines, openNow, clockTime, hasOpenDay } from "./hours";
import type { OpenHours } from "../../booking/slots";

const WK: [string, string][] = [["08:00", "12:00"], ["13:00", "18:00"]];
const H: OpenHours = { mon: WK, tue: WK, wed: WK, thu: WK, fri: WK, sat: [["09:00", "13:00"]] };
const TZ = "America/Chicago";
const at = (iso: string) => new Date(iso);

describe("clockTime", () => {
  it.each([["08:00", "8:00 AM"], ["00:00", "12:00 AM"], ["12:00", "12:00 PM"], ["13:05", "1:05 PM"], ["23:59", "11:59 PM"], ["24:00", "midnight"]] as const)(
    "%s reads %s", (t, s) => { expect(clockTime(t)).toBe(s); });
});

describe("hoursLines (Monday first, 7 lines)", () => {
  it("the week, word for word (mutation: Sunday first -> FAILS)", () => {
    expect(hoursLines(H)).toEqual([
      "Monday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Tuesday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Wednesday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Thursday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Friday: 8:00 AM to 12:00 PM and 1:00 PM to 6:00 PM",
      "Saturday: 9:00 AM to 1:00 PM",
      "Sunday: closed",
    ]);
  });
  it("three spans join with a comma and a final and; 24:00 reads midnight", () => {
    expect(hoursLines({ fri: [["06:00", "08:00"], ["10:00", "12:00"], ["18:00", "24:00"]], sat: [["00:00", "02:00"]] }).slice(4, 6)).toEqual([
      "Friday: 6:00 AM to 8:00 AM, 10:00 AM to 12:00 PM and 6:00 PM to midnight",
      "Saturday: 12:00 AM to 2:00 AM",
    ]);
  });
  it("hasOpenDay is false for {} and null, true for one span", () => {
    expect([hasOpenDay({}), hasOpenDay(null), hasOpenDay(undefined), hasOpenDay({ sun: [["10:00", "11:00"]] })]).toEqual([false, false, false, true]);
  });
});

describe("openNow (spec 5.1; all arithmetic in the zone; SD16)", () => {
  it.each([
    ["open (Tue 10:00)", H, "2027-06-01T15:00:00Z", true, "Right now: open until 12:00 PM."],
    ["the lunch gap (Tue 12:30)", H, "2027-06-01T17:30:00Z", false, "Right now: closed; opens today at 1:00 PM."],
    ["closed until tomorrow (Tue 18:30)", H, "2027-06-01T23:30:00Z", false, "Right now: closed; opens tomorrow at 8:00 AM."],
    ["closed today, a day with no hours (Sun 10:00)", H, "2027-06-06T15:00:00Z", false, "Right now: closed; opens tomorrow at 8:00 AM."],
    ["closed until Monday (Sat 18:30)", H, "2027-06-05T23:30:00Z", false, "Right now: closed; opens Monday at 8:00 AM."],
    ["the 24:00/00:00 join (Fri 23:30)", { fri: [["18:00", "24:00"]], sat: [["00:00", "02:00"]] }, "2027-06-05T04:30:00Z", true, "Right now: open until 2:00 AM."],
    ["open until midnight (Fri 23:30, nothing after)", { fri: [["18:00", "24:00"]] }, "2027-06-05T04:30:00Z", true, "Right now: open until midnight."],
    ["touching spans are one stretch (Tue 11:00)", { tue: [["08:00", "12:00"], ["12:00", "18:00"]] }, "2027-06-01T16:00:00Z", true, "Right now: open until 6:00 PM."],
    ["the same weekday next week (Mon 13:00)", { mon: [["08:00", "12:00"]] }, "2027-06-07T18:00:00Z", false, "Right now: closed; opens next Monday at 8:00 AM."],
    ["open around the clock", Object.fromEntries(["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d) => [d, [["00:00", "24:00"]]])) as OpenHours,
      "2027-06-01T15:00:00Z", true, "Right now: open."],
    ["a DST day: Sun 2027-03-14 08:30Z is 3:30 AM CDT (mutation: a fixed -6 offset reads 2:30 -> FAILS)", { sun: [["03:00", "04:00"]] },
      "2027-03-14T08:30:00Z", true, "Right now: open until 4:00 AM."],
  ] as const)("%s", (_n, hours, iso, open, line) => {
    expect(openNow(hours as OpenHours, TZ, at(iso))).toEqual({ open, line });
  });
  it("the zone is the account's, never the server's: the same instant in America/New_York is an hour later (mutation: drop timeZone -> FAILS on one of the two)", () => {
    expect(openNow(H, "America/New_York", at("2027-06-01T22:30:00Z")).line).toBe("Right now: closed; opens tomorrow at 8:00 AM.");
    expect(openNow(H, TZ, at("2027-06-01T22:30:00Z")).line).toBe("Right now: open until 6:00 PM.");
  });
});

// S-47d (spec 5.4.2, S12; plan Task 6 Step 3): the fourth argument. Absent, every case above is unchanged.
describe("openNow with closures (S-47d)", () => {
  const OPEN_STATUS = { state: "open", nextClosedDay: null } as const;
  // Tuesday, December 22, 2026, 10:00 AM CST: H says open until 12:00 PM.
  const TUE = at("2026-12-22T16:00:00Z");
  it.each([
    ["Closed today while the hours say open", { state: "closed_today", reopensAt: at("2026-12-23T14:00:00Z"), reopensTimeKnown: true }, TUE,
      "Right now: closed; opens tomorrow at 8:00 AM."],
    ["2 to 6 days: the bare weekday", { state: "storm", reopensAt: at("2026-12-24T14:00:00Z"), reopensTimeKnown: true }, TUE,
      "Right now: closed; opens Thursday at 8:00 AM."],
    ["exactly 7 days: S-47c's next {Weekday} (SD15)", { state: "closed_today", reopensAt: at("2027-01-04T14:00:00Z"), reopensTimeKnown: true },
      at("2026-12-28T16:00:00Z"), "Right now: closed; opens next Monday at 8:00 AM."],
    ["beyond 7 days: the dated form (S12)", { state: "closed_day", reason: "vacation", startsOn: "2026-12-24", endsOn: "2027-01-01",
      reopensAt: at("2027-01-04T14:00:00Z"), reopensTimeKnown: true }, at("2026-12-27T16:00:00Z"), "Right now: closed; opens on Monday, January 4 at 8:00 AM."],
    ["an open-ended storm", { state: "storm", reopensAt: null, reopensTimeKnown: false }, TUE, "Right now: closed."],
    ["a reopening with no known time (pinned so a stray state never throws)", { state: "closed_today", reopensAt: at("2026-12-23T06:00:00Z"), reopensTimeKnown: false },
      TUE, "Right now: closed; opens tomorrow."],
    ["I-1: the opening's zone-calendar day can differ from the UTC day (mutation: dayKey in UTC inside opensWhen -> FAILS, says 'today')",
      { state: "closed_today", reopensAt: at("2026-12-23T14:00:00Z"), reopensTimeKnown: true }, at("2026-12-23T02:30:00Z"),
      "Right now: closed; opens tomorrow at 8:00 AM."],
  ] as const)("%s", (_n, status, now, line) => {
    expect(openNow(H, TZ, now, { status: status as never, closedDays: [] })).toEqual({ open: false, line });
  });
  it("running late leaves the hours' answer alone (mutation: treat running late as a closure -> FAILS)", () => {
    const status = { state: "running_late", lateMinutes: 30, endsAt: at("2026-12-23T06:00:00Z") } as const;
    expect(openNow(H, TZ, TUE, { status, closedDays: [] })).toEqual({ open: true, line: "Right now: open until 12:00 PM." });
  });
  it("an open status skips a closed day when it names the next opening (closed Thu, Fri a closed day, Sat 9:00)", () => {
    const hours: OpenHours = { fri: [["08:00", "18:00"]], sat: [["09:00", "13:00"]] };
    const thu = at("2027-06-03T15:00:00Z"); // Thursday, June 3, 2027, 10:00 AM CDT
    const fri = { starts_on: "2027-06-04", ends_on: "2027-06-04", reason: null };
    expect(openNow(hours, TZ, thu)).toEqual({ open: false, line: "Right now: closed; opens tomorrow at 8:00 AM." });
    for (const status of [OPEN_STATUS, null])
      expect(openNow(hours, TZ, thu, { status, closedDays: [fri] })).toEqual({ open: false, line: "Right now: closed; opens Saturday at 9:00 AM." });
  });
  it("m-1: a closed day covering today counts as closed even when the status read failed (status null), worded through effectiveStatus's own closed_day path (spec S17; pre-fix: 'Right now: open until 12:00 PM.')", () => {
    const fri = { starts_on: "2027-06-04", ends_on: "2027-06-04", reason: "holiday" as const };
    const fri10am = at("2027-06-04T15:00:00Z"); // Friday, June 4, 2027, 10:00 AM CDT
    expect(openNow(H, TZ, fri10am, { status: null, closedDays: [fri] }))
      .toEqual({ open: false, line: "Right now: closed; opens tomorrow at 9:00 AM." });
  });
  it("a closed range past a week gives the dated form on the open path too", () => {
    const hours: OpenHours = { fri: [["08:00", "18:00"]] };
    const range = { starts_on: "2027-06-04", ends_on: "2027-06-11", reason: "vacation" as const };
    expect(openNow(hours, TZ, at("2027-06-03T15:00:00Z"), { status: OPEN_STATUS, closedDays: [range] }))
      .toEqual({ open: false, line: "Right now: closed; opens on Friday, June 18 at 8:00 AM." });
  });
  it("an open status with no closed days reads exactly as without closures, on every S-47c case", () => {
    const cases: Array<[OpenHours, string]> = [
      [H, "2027-06-01T15:00:00Z"], [H, "2027-06-01T17:30:00Z"], [H, "2027-06-01T23:30:00Z"], [H, "2027-06-06T15:00:00Z"],
      [H, "2027-06-05T23:30:00Z"], [{ fri: [["18:00", "24:00"]], sat: [["00:00", "02:00"]] }, "2027-06-05T04:30:00Z"],
      [{ mon: [["08:00", "12:00"]] }, "2027-06-07T18:00:00Z"], [{ sun: [["03:00", "04:00"]] }, "2027-03-14T08:30:00Z"],
    ];
    for (const [hours, iso] of cases)
      expect(openNow(hours, TZ, at(iso), { status: OPEN_STATUS, closedDays: [] }), iso).toEqual(openNow(hours, TZ, at(iso)));
    expect(cases.length).toBe(8);
  });
});
