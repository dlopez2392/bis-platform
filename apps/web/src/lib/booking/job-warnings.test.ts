import { describe, it, expect } from "vitest";
import { jobWarnings, warningKey, unseenWarnings, type JobWarning, type LiveRange } from "./job-warnings";
import type { SlotClosures, SlotConfig } from "./slots";

// America/Chicago, Mon–Fri 09:00–17:00, 12 hours' notice, no closures. 2027-03-01 is a Monday and CST (UTC-6)
// all week: the 2027 spring-forward is 03-14.
const NO_CLOSURES: SlotClosures = { closedDayKeys: new Set(), blockedBefore: null, blockAll: false, lateBefore: null };
const WEEKDAY: [string, string][] = [["09:00", "17:00"]];
const CONFIG: SlotConfig = {
  timezone: "America/Chicago", slotDurationMinutes: 60, bufferMinutes: 15, minNoticeHours: 12, maxAdvanceDays: 30,
  openHours: { mon: WEEKDAY, tue: WEEKDAY, wed: WEEKDAY, thu: WEEKDAY, fri: WEEKDAY },
  closures: NO_CLOSURES,
};
const NOW = new Date("2027-03-01T14:00:00.000Z"); // Mon 08:00 CST
const at = (iso: string) => new Date(iso);
const range = (startIso: string, minutes: number) => {
  const startsAt = at(startIso);
  return { startsAt, endsAt: new Date(startsAt.getTime() + minutes * 60_000) };
};
const live = (id: string, startIso: string, minutes: number): LiveRange => ({ id, ...range(startIso, minutes) });

// Tue 2027-03-02 10:00 CST: in hours, past notice, an open day, and nothing booked. Every case below breaks ONE
// of those four and keeps the other three.
const TUE_10 = "2027-03-02T16:00:00.000Z";
const check = (over: Partial<Parameters<typeof jobWarnings>[0]> = {}) =>
  jobWarnings({ config: CONFIG, liveRanges: [], now: NOW, range: range(TUE_10, 60), ...over });

describe("jobWarnings: what a staff job breaks (F-046, spec 5.4)", () => {
  it("the control: a job that breaks nothing has no warnings and is not refused", () => {
    expect(check()).toEqual({ refused: null, warnings: [] });
  });

  it("ONLY outside open hours: Tue 08:00 for 60 min", () => {
    expect(check({ range: range("2027-03-02T14:00:00.000Z", 60) })).toEqual({ refused: null, warnings: [{ kind: "outside_hours" }] });
  });

  it("ONLY inside the notice: Mon 10:00, two hours from now", () => {
    expect(check({ range: range("2027-03-01T16:00:00.000Z", 60) })).toEqual({ refused: null, warnings: [{ kind: "notice" }] });
  });

  it("ONLY on a closed day: the job's own account-zone date is a closed-day key", () => {
    const config = { ...CONFIG, closures: { ...NO_CLOSURES, closedDayKeys: new Set(["2027-03-02"]) } };
    expect(check({ config })).toEqual({ refused: null, warnings: [{ kind: "closed" }] });
  });

  it("ONLY overlapping: a live job at 10:30", () => {
    expect(check({ liveRanges: [live("j1", "2027-03-02T16:30:00.000Z", 60)] })).toEqual({
      refused: null, warnings: [{ kind: "overlaps", ids: ["j1"], firstStart: at("2027-03-02T16:30:00.000Z") }],
    });
  });

  it("the notice boundary: a start at exactly now + 12 h is no warning; one minute earlier is", () => {
    const now = new Date("2027-03-02T04:00:00.000Z"); // Mon 22:00 CST, so now + 12 h is Tue 10:00, inside hours
    expect(check({ now })).toEqual({ refused: null, warnings: [] });
    expect(check({ now, range: range("2027-03-02T15:59:00.000Z", 60) })).toEqual({ refused: null, warnings: [{ kind: "notice" }] });
  });

  it("an unreadable notice fails CLOSED: a NaN notice is a notice warning", () => {
    expect(check({ config: { ...CONFIG, minNoticeHours: Number.NaN } }).warnings).toEqual([{ kind: "notice" }]);
  });

  it("closed by a storm (blockAll) and by Closed today (blockedBefore)", () => {
    expect(check({ config: { ...CONFIG, closures: { ...NO_CLOSURES, blockAll: true } } }).warnings).toEqual([{ kind: "closed" }]);
    const blockedBefore = at("2027-03-03T06:00:00.000Z"); // Wed 00:00 CST
    expect(check({ config: { ...CONFIG, closures: { ...NO_CLOSURES, blockedBefore } } }).warnings).toEqual([{ kind: "closed" }]);
  });

  it("running late is NOT closed: a delay until 11:00 leaves a 10:00 job unwarned (plan correction 8)", () => {
    const lateBefore = at("2027-03-02T17:00:00.000Z"); // Tue 11:00 CST
    expect(check({ config: { ...CONFIG, closures: { ...NO_CLOSURES, lateBefore } } })).toEqual({ refused: null, warnings: [] });
  });

  it("no closures at all (an account with none read) warns of nothing closed", () => {
    expect(check({ config: { ...CONFIG, closures: undefined } })).toEqual({ refused: null, warnings: [] });
  });

  it("two overlapping live jobs are ONE warning: both ids sorted, and firstStart is the earlier start", () => {
    // Input order is neither start order nor id order: z1 starts first, a2 sorts first.
    const liveRanges = [live("a2", "2027-03-02T16:30:00.000Z", 60), live("z1", "2027-03-02T15:30:00.000Z", 60)];
    expect(check({ liveRanges }).warnings).toEqual([
      { kind: "overlaps", ids: ["a2", "z1"], firstStart: at("2027-03-02T15:30:00.000Z") },
    ]);
  });

  it("back-to-back on either side is no overlap ([) bounds, as bookings_no_overlap)", () => {
    const liveRanges = [live("before", "2027-03-02T15:00:00.000Z", 60), live("after", "2027-03-02T17:00:00.000Z", 60)];
    expect(check({ liveRanges })).toEqual({ refused: null, warnings: [] });
  });

  it("excludeId leaves the job being moved out of its own overlap", () => {
    const liveRanges = [live("self", "2027-03-02T16:00:00.000Z", 60)];
    expect(check({ liveRanges }).warnings).toEqual([{ kind: "overlaps", ids: ["self"], firstStart: at(TUE_10) }]);
    expect(check({ liveRanges, excludeId: "self" })).toEqual({ refused: null, warnings: [] });
  });

  it("an unreadable live range fails CLOSED: it overlaps", () => {
    const liveRanges: LiveRange[] = [{ id: "bad", startsAt: new Date(NaN), endsAt: new Date(NaN) }];
    expect(check({ liveRanges }).warnings.map((w) => w.kind)).toEqual(["overlaps"]);
  });

  it("refuses the past with no warnings, and refuses an empty, backwards or unreadable range as invalid", () => {
    expect(check({ range: range("2027-03-01T13:59:00.000Z", 60) })).toEqual({ refused: "past", warnings: [] });
    const start = at(TUE_10);
    expect(check({ range: { startsAt: start, endsAt: start } })).toEqual({ refused: "invalid", warnings: [] });
    expect(check({ range: { startsAt: start, endsAt: at("2027-03-02T15:00:00.000Z") } })).toEqual({ refused: "invalid", warnings: [] });
    expect(check({ range: { startsAt: new Date(NaN), endsAt: start } })).toEqual({ refused: "invalid", warnings: [] });
  });
});

describe("warningKey and unseenWarnings: a second press saves only when nothing new appeared", () => {
  const overlaps = (ids: string[]): JobWarning => ({ kind: "overlaps", ids, firstStart: at(TUE_10) });

  it("an overlap's key is its ids in id order, whatever the input order", () => {
    expect(warningKey(overlaps(["b", "a"]))).toBe("overlaps:a,b");
    expect(warningKey(overlaps(["a", "b"]))).toBe("overlaps:a,b");
    expect(warningKey({ kind: "notice" })).toBe("notice");
    expect(warningKey({ kind: "outside_hours" })).toBe("outside_hours");
    expect(warningKey({ kind: "closed" })).toBe("closed");
  });

  it("drops exactly the warnings already seen and keeps a NEW overlap key", () => {
    const warnings: JobWarning[] = [{ kind: "notice" }, { kind: "closed" }, overlaps(["c", "a", "b"])];
    expect(unseenWarnings(warnings, ["notice", "overlaps:a,b"])).toEqual([{ kind: "closed" }, overlaps(["c", "a", "b"])]);
    expect(unseenWarnings(warnings, ["notice", "closed", "overlaps:a,b,c"])).toEqual([]);
  });
});
