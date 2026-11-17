// The brief's shaping (plan D5): typed, pure, over the owner line's own reads. These tests hand it results in the
// exact shape those reads return.
import { describe, expect, it } from "vitest";
import { makeTr } from "@/lib/record/copy";
import { statusWord } from "@/app/(dashboard)/dashboard/accounts/[accountId]/calendar/agenda-view";
import type { AppointmentsResult, CallsAndMessagesResult, NeedsAttentionResult } from "@/lib/owner-line/tools/read";
import { BRIEF_TODOS_LISTED, shapeBrief, type BriefReads } from "./brief-content";

const NOW = new Date("2027-06-15T12:05:00Z"); // 07:05 in Chicago
const range = { first: "2027-06-15", last: "2027-06-15" };

const appt = (status: "booked" | "cancelled" | "completed" | "no_show", customer: string | null, when = "9:00 AM", locale: "en" | "es" = "en") => ({
  when, customer, meetingType: "On site", status: statusWord(makeTr(locale), status), statusCode: status,
});
/** `moreBooked`: jobs past the read's own cap that are still booked (the read's exact `bookedCount` includes them). */
const appointments = (rows: ReturnType<typeof appt>[], more = 0, moreBooked = more): AppointmentsResult => (
  { ok: true, range, count: rows.length + more, truncated: false, more, appointments: rows,
    bookedCount: rows.filter((r) => r.statusCode === "booked").length + moreBooked }
);
const calls = (count: number): CallsAndMessagesResult => (
  { ok: true, range, count, spam: 7, more: 0, calls: [] }
);
const todos = (n: number, count = n): NeedsAttentionResult => ({
  ok: true, count, more: Math.max(0, count - n),
  items: Array.from({ length: n }, (_, i) => ({ what: `Call back ${i + 1}`, customer: null, due: i === 0 ? "Tuesday, June 15, 10:00 AM" : null })),
});
const reads = (over: Partial<BriefReads> = {}): BriefReads => ({
  locale: "en", brandName: "Rio Roofing", zone: "America/Chicago", now: NOW,
  appointments: appointments([]), calls: calls(0), leads: 0, todos: todos(0), ...over,
});

describe("shapeBrief", () => {
  it("names the day in the account's zone and the person's language", () => {
    expect(shapeBrief(reads()).dayLabel).toBe("Tuesday, June 15");
    expect(shapeBrief(reads({ locale: "es" })).dayLabel).toBe("martes, 15 de junio");
    // 03:00Z is still the 14th in Chicago: the label is the account's day, never the UTC date.
    expect(shapeBrief(reads({ now: new Date("2027-06-15T03:00:00Z") })).dayLabel).toBe("Monday, June 14");
  });

  it("carries the brand name it was given and nothing else as a name", () => {
    const c = shapeBrief(reads({ brandName: "Rio Roofing" }));
    expect(c.brandName).toBe("Rio Roofing");
    expect(JSON.stringify(c)).not.toContain("accounts.name");
  });

  it("omits every section that has nothing in it, never a zero", () => {
    const c = shapeBrief(reads());
    expect(c.bookings).toBeNull();
    expect(c.calls).toBeNull();
    expect(c.leads).toBeNull();
    expect(c.todos).toBeNull();
  });

  it("lists only bookings still booked: a cancelled, completed or no-show job never shows (EN)", () => {
    const c = shapeBrief(reads({
      appointments: appointments([appt("booked", "Ana Ruiz"), appt("cancelled", "Bo Lee"), appt("completed", "Cy Day"), appt("no_show", "Di Poe"), appt("booked", null, "1:30 PM")]),
    }));
    expect(c.bookings).toEqual({
      count: 2, more: 0,
      items: [
        { time: "9:00 AM", customer: "Ana Ruiz", meetingType: "On site" },
        { time: "1:30 PM", customer: null, meetingType: "On site" },
      ],
    });
  });

  it("matches on the raw status code, so rows worded in another language than the brief's still count", () => {
    // The read wrote its words in Spanish; the brief is English. A word comparison would drop every job.
    const c = shapeBrief(reads({ locale: "en", appointments: appointments([appt("booked", "Ana Ruiz", "9:00 a.m.", "es"), appt("cancelled", "Bo Lee", "10:00 a.m.", "es")]) }));
    expect(c.bookings?.items.map((i) => i.customer)).toEqual(["Ana Ruiz"]);
    const d = shapeBrief(reads({ locale: "es", appointments: appointments([appt("booked", "Ana Ruiz", "9:00 AM", "en")]) }));
    expect(d.bookings?.count).toBe(1);
  });

  it("jobs past the read's cap are counted exactly from its bookedCount: cancelled ones past the cap are not 'more'", () => {
    const c = shapeBrief(reads({ appointments: appointments([appt("booked", "Ana Ruiz")], 5, 3) }));
    expect(c.bookings).toMatchObject({ count: 4, more: 3 });
  });

  it("answered calls and leads are counted once each, from the reads' own numbers", () => {
    const c = shapeBrief(reads({ calls: calls(4), leads: 2 }));
    expect(c.calls).toEqual({ count: 4 });
    expect(c.leads).toEqual({ count: 2 });
  });

  it("the spam count is not a number the brief can show: it is not in the content at all", () => {
    expect(JSON.stringify(shapeBrief(reads({ calls: calls(4) })))).not.toContain("7");
  });

  it("lists the first five To-dos with the queue's own words, then the real total behind 'and N more'", () => {
    expect(BRIEF_TODOS_LISTED).toBe(5);
    const c = shapeBrief(reads({ todos: todos(15, 40) }));
    expect(c.todos?.count).toBe(40);
    expect(c.todos?.items).toHaveLength(5);
    expect(c.todos?.items[0]).toEqual({ what: "Call back 1", due: "Tuesday, June 15, 10:00 AM" });
    expect(c.todos?.more).toBe(35);
  });

  it("a read that failed is a failure, never a zero or a missing section", () => {
    expect(() => shapeBrief(reads({ calls: { ok: false, error: "bad_range" } }))).toThrow(/calls/);
    expect(() => shapeBrief(reads({ appointments: { ok: false, error: "bad_range" } }))).toThrow(/appointments/);
  });

  it("an unusable zone is a failure, not a label in the wrong day", () => {
    expect(() => shapeBrief(reads({ zone: "Not/AZone" }))).toThrow();
  });
});
