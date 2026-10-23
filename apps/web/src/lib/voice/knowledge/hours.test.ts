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
