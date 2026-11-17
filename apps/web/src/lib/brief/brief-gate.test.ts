// isQuietDay, exactly as plan D5 / owner answer Q2 define it. A table: every row is one fact that makes a day
// non-quiet, or one that must NOT.
import { describe, expect, it } from "vitest";
import { isQuietDay, todoTriggersSend, type QuietInput } from "./brief-gate";

// A Chicago morning: yesterday began 2027-06-14T05:00Z, tomorrow begins 2027-06-16T05:00Z.
const YESTERDAY_START = "2027-06-14T05:00:00.000Z";
const TOMORROW_START = "2027-06-16T05:00:00.000Z";
const base: QuietInput = {
  bookingsToday: 0, callsAnsweredYesterday: 0, leadsYesterday: 0, todos: [],
  yesterdayStartIso: YESTERDAY_START, tomorrowStartIso: TOMORROW_START,
};
const todo = (dueAt: string | null, occurredAt: string) => ({ dueAt, occurredAt });
const OLD = "2027-05-01T15:00:00.000Z";

describe("isQuietDay", () => {
  const rows: [string, Partial<QuietInput>, boolean][] = [
    ["nothing at all", {}, true],
    ["one booking today", { bookingsToday: 1 }, false],
    ["one answered call yesterday", { callsAnsweredYesterday: 1 }, false],
    ["one lead yesterday", { leadsYesterday: 1 }, false],
    ["a To-do due today", { todos: [todo("2027-06-15T18:00:00.000Z", OLD)] }, false],
    ["a To-do overdue (due last month)", { todos: [todo("2027-05-20T15:00:00.000Z", OLD)] }, false],
    ["a To-do due tomorrow or later", { todos: [todo(TOMORROW_START, OLD)] }, true],
    ["a To-do due the last instant of today", { todos: [todo("2027-06-16T04:59:59.999Z", OLD)] }, false],
    ["a To-do that arrived since yesterday began", { todos: [todo(null, "2027-06-14T20:00:00.000Z")] }, false],
    ["a To-do that arrived at the very instant yesterday began", { todos: [todo(null, YESTERDAY_START)] }, false],
    ["a To-do that arrived one millisecond before yesterday began", { todos: [todo(null, "2027-06-14T04:59:59.999Z")] }, true],
    ["a 40-item undated backlog, all old", { todos: Array.from({ length: 40 }, () => todo(null, OLD)) }, true],
    ["an old backlog plus one booking (rides along, and the booking sends)", { bookingsToday: 1, todos: [todo(null, OLD)] }, false],
    ["an unreadable due date and an unreadable arrival", { todos: [todo("not a date", "also not")] }, true],
  ];
  it.each(rows)("%s", (_name, patch, quiet) => {
    expect(isQuietDay({ ...base, ...patch })).toBe(quiet);
  });
});

describe("todoTriggersSend", () => {
  const edges = { yesterdayStartIso: YESTERDAY_START, tomorrowStartIso: TOMORROW_START };
  it("an undated, old To-do never triggers, whatever its age", () => {
    expect(todoTriggersSend(todo(null, OLD), edges)).toBe(false);
    expect(todoTriggersSend(todo(null, "2020-01-01T00:00:00.000Z"), edges)).toBe(false);
  });
  it("a dated To-do triggers only before tomorrow's start (due today or overdue)", () => {
    expect(todoTriggersSend(todo("2027-06-16T04:59:59.999Z", OLD), edges)).toBe(true);
    expect(todoTriggersSend(todo(TOMORROW_START, OLD), edges)).toBe(false);
  });
  it("a new To-do triggers from yesterday's first instant on, inclusive", () => {
    expect(todoTriggersSend(todo(null, YESTERDAY_START), edges)).toBe(true);
    expect(todoTriggersSend(todo(null, "2027-06-14T04:59:59.999Z"), edges)).toBe(false);
  });
});
