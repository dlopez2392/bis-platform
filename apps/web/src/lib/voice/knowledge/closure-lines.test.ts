// S-47d (spec 5.4.1; plan "The model, The prompt lines"): every TODAY line, the reopening phrase and the CLOSED
// DAYS block as typed-out literals. Model input: a changed word here is a changed instruction on a live phone line.
import { describe, it, expect } from "vitest";
import {
  CLOSED_DAYS_HEADING, reopeningPhrase, todayLine, closedDayLine, closedDaysBlock, type ClosedDayLine,
} from "./closure-lines";
import type { EffectiveStatus } from "../../business-status/status";

const TZ = "America/Chicago";
// Tuesday, December 22, 2026, 10:00 AM CST (UTC-6). December 24, 2026 is a Thursday; January 4, 2027 a Monday.
const NOW = new Date("2026-12-22T16:00:00Z");
const at = (iso: string) => new Date(iso);

describe("reopeningPhrase (spec 5.4.1; SD15)", () => {
  it.each([
    ["0 days (SD15: cannot occur, pinned so a stray state never throws)", "2026-12-22T20:00:00Z", true, "today at 2:00 PM"],
    ["0 days in the ZONE, though the UTC date is tomorrow (mutation: dayKey in UTC -> FAILS)", "2026-12-23T05:30:00Z", true, "today at 11:30 PM"],
    ["1 day", "2026-12-23T14:00:00Z", true, "tomorrow at 8:00 AM"],
    ["2 days", "2026-12-24T14:00:00Z", true, "on Thursday at 8:00 AM"],
    ["6 days", "2026-12-28T14:00:00Z", true, "on Monday at 8:00 AM"],
    ["7 days: the dated form", "2026-12-29T14:30:00Z", true, "on Tuesday, December 29 at 8:30 AM"],
    ["13 days, across the year", "2027-01-04T14:00:00Z", true, "on Monday, January 4 at 8:00 AM"],
    ["no known time, 1 day", "2026-12-23T06:00:00Z", false, "tomorrow"],
    ["no known time, 2 days", "2026-12-24T06:00:00Z", false, "on Thursday"],
    ["no known time, 13 days", "2027-01-04T06:00:00Z", false, "on Monday, January 4"],
  ] as const)("%s", (_n, iso, known, want) => {
    expect(reopeningPhrase(at(iso), known, TZ, NOW)).toBe(want);
  });
});

describe("todayLine — every state, word for word", () => {
  const closedToday = (iso: string, known = true): EffectiveStatus => ({ state: "closed_today", reopensAt: at(iso), reopensTimeKnown: known });
  const closedDay = (reason: "holiday" | "vacation" | "other" | null, iso: string): EffectiveStatus =>
    ({ state: "closed_day", reason, startsOn: "2026-12-22", endsOn: "2026-12-22", reopensAt: at(iso), reopensTimeKnown: true });
  const late = (lateMinutes: 15 | 30 | 60 | 120): EffectiveStatus => ({ state: "running_late", lateMinutes, endsAt: at("2026-12-23T06:00:00Z") });
  it.each([
    ["closed today, tomorrow", closedToday("2026-12-23T14:00:00Z"), "TODAY: The business is closed today. It opens again tomorrow at 8:00 AM."],
    ["closed today, Monday", closedToday("2026-12-28T14:00:00Z"), "TODAY: The business is closed today. It opens again on Monday at 8:00 AM."],
    ["closed today, dated", closedToday("2027-01-04T14:00:00Z"), "TODAY: The business is closed today. It opens again on Monday, January 4 at 8:00 AM."],
    ["closed today, no known time", closedToday("2026-12-23T06:00:00Z", false), "TODAY: The business is closed today. It opens again tomorrow."],
    ["storm, no date", { state: "storm", reopensAt: null, reopensTimeKnown: false }, "TODAY: The business is closed because of a storm, until further notice."],
    ["storm, a date", { state: "storm", reopensAt: at("2026-12-24T14:00:00Z"), reopensTimeKnown: true }, "TODAY: The business is closed because of a storm. It opens again on Thursday at 8:00 AM."],
    ["running late 15", late(15), "TODAY: The team is running about 15 minutes behind today. If someone asks about a visit or appointment today, tell them it may start about 15 minutes late."],
    ["running late 30", late(30), "TODAY: The team is running about 30 minutes behind today. If someone asks about a visit or appointment today, tell them it may start about 30 minutes late."],
    ["running late 60", late(60), "TODAY: The team is running about an hour behind today. If someone asks about a visit or appointment today, tell them it may start about an hour late."],
    ["running late 120", late(120), "TODAY: The team is running more than an hour behind today. If someone asks about a visit or appointment today, tell them it may start more than an hour late."],
    ["closed day, holiday", closedDay("holiday", "2026-12-23T14:00:00Z"), "TODAY: The business is closed all day today for a holiday. It opens again tomorrow at 8:00 AM."],
    ["closed day, vacation", closedDay("vacation", "2026-12-28T14:00:00Z"), "TODAY: The business is closed all day today for vacation. It opens again on Monday at 8:00 AM."],
    ["closed day, other (no reason is invented)", closedDay("other", "2026-12-23T14:00:00Z"), "TODAY: The business is closed all day today. It opens again tomorrow at 8:00 AM."],
    ["closed day, no reason", closedDay(null, "2026-12-23T14:00:00Z"), "TODAY: The business is closed all day today. It opens again tomorrow at 8:00 AM."],
  ] as const)("%s", (_n, s, want) => {
    expect(todayLine(s as EffectiveStatus, TZ, NOW)).toBe(want);
  });
  it("open gives no line, with or without a closed day coming (mutation: a line for open -> FAILS)", () => {
    expect(todayLine({ state: "open", nextClosedDay: null }, TZ, NOW)).toBeNull();
    expect(todayLine({ state: "open", nextClosedDay: { starts_on: "2026-12-24", ends_on: "2026-12-24", reason: "holiday" } }, TZ, NOW)).toBeNull();
  });
});

describe("closedDayLine and the CLOSED DAYS block (spec 5.4.1, verbatim)", () => {
  it.each([
    ["one day", { starts_on: "2026-12-24", ends_on: "2026-12-24", reason: "holiday" }, "- Thursday, December 24, 2026 (holiday)"],
    ["a range within one year: the year once, at the end", { starts_on: "2026-12-24", ends_on: "2026-12-25", reason: "holiday" }, "- Thursday, December 24 to Friday, December 25, 2026 (holiday)"],
    ["a range across years: the year on each date", { starts_on: "2026-12-28", ends_on: "2027-01-01", reason: "vacation" }, "- Monday, December 28, 2026 to Friday, January 1, 2027 (vacation)"],
    ["other", { starts_on: "2027-03-01", ends_on: "2027-03-01", reason: "other" }, "- Monday, March 1, 2027 (other)"],
    ["no reason: nothing after the date", { starts_on: "2026-12-24", ends_on: "2026-12-24", reason: null }, "- Thursday, December 24, 2026"],
  ] as const)("%s", (_n, d, want) => {
    expect(closedDayLine(d)).toBe(want);
  });
  it("the heading", () => {
    expect(CLOSED_DAYS_HEADING).toBe("CLOSED DAYS (the business is closed all day on these dates, and no time on them can be booked):");
  });
  it("nothing, null and [] give no lines; a list gives a blank line, the heading, then each line in order", () => {
    expect([closedDaysBlock(undefined), closedDaysBlock(null), closedDaysBlock([])]).toEqual([[], [], []]);
    const lines: ClosedDayLine[] = [
      { starts_on: "2026-12-24", ends_on: "2026-12-24", reason: "holiday", line: "- Thursday, December 24, 2026 (holiday)" },
      { starts_on: "2026-12-28", ends_on: "2027-01-01", reason: "vacation", line: "- Monday, December 28, 2026 to Friday, January 1, 2027 (vacation)" },
    ];
    expect(closedDaysBlock(lines)).toEqual([
      "",
      "CLOSED DAYS (the business is closed all day on these dates, and no time on them can be booked):",
      "- Thursday, December 24, 2026 (holiday)",
      "- Monday, December 28, 2026 to Friday, January 1, 2027 (vacation)",
    ]);
  });
});
