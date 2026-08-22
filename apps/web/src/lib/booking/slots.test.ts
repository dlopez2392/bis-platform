import { describe, it, expect, vi, afterEach } from "vitest";
import { computeSlots, zonedTimeToUtc, partsInZone, type SlotConfig } from "./slots";

const CFG: SlotConfig = {
  timezone: "America/Chicago", slotDurationMinutes: 60, bufferMinutes: 0,
  minNoticeHours: 12, maxAdvanceDays: 7,
  openHours: { mon: [["09:00", "17:00"]], tue: [["09:00", "12:00"], ["13:00", "17:00"]] },
};
// Wed 2026-09-02 18:00 UTC = 13:00 CDT.
const NOW = new Date("2026-09-02T18:00:00Z");

afterEach(() => vi.restoreAllMocks());

describe("computeSlots", () => {
  it("offers slots only inside open hours, on open days, within the horizon", () => {
    const slots = computeSlots(CFG, [], NOW);
    // Next Mon (Sep 7) 09:00-17:00 CDT → 8 one-hour slots; Tue Sep 8 → 3 + 4.
    const monday = slots.filter((s) => partsInZone(s.startsAt, CFG.timezone).d === 7);
    expect(monday).toHaveLength(8);
    expect(partsInZone(monday[0]!.startsAt, CFG.timezone)).toMatchObject({ hh: 9, mi: 0 });
    // Nothing on Wed/Thu/… — days with no open hours.
    expect(slots.some((s) => partsInZone(s.startsAt, CFG.timezone).weekday === "wed")).toBe(false);
  });

  it("respects min notice at the exact boundary", () => {
    // min notice 12h from Wed 13:00 CDT = Thu 01:00 CDT. Add thu hours 00:00-03:00.
    const cfg = { ...CFG, openHours: { thu: [["00:00", "03:00"]] as [string, string][] } };
    const slots = computeSlots(cfg, [], NOW);
    const thuStarts = slots.map((s) => partsInZone(s.startsAt, cfg.timezone))
      .filter((p) => p.weekday === "thu" && p.d === 3).map((p) => p.hh);
    expect(thuStarts).toEqual([1, 2]); // 00:00 fails notice; 01:00 sits exactly on it and IS offered
  });

  it("a booked range removes its slot, and buffer widens the shadow", () => {
    const mon10 = zonedTimeToUtc(2026, 9, 7, 10, 0, CFG.timezone)!;
    const mon11 = zonedTimeToUtc(2026, 9, 7, 11, 0, CFG.timezone)!;
    const noBuffer = computeSlots(CFG, [{ startsAt: mon10, endsAt: mon11 }], NOW);
    const hours = (slots: typeof noBuffer) => slots
      .filter((s) => partsInZone(s.startsAt, CFG.timezone).d === 7)
      .map((s) => partsInZone(s.startsAt, CFG.timezone).hh);
    expect(hours(noBuffer)).toEqual([9, 11, 12, 13, 14, 15, 16]);
    const withBuffer = computeSlots({ ...CFG, bufferMinutes: 30 },
      [{ startsAt: mon10, endsAt: mon11 }], NOW);
    // 11:00 candidate now collides with the booking's trailing buffer, and
    // 09:00's own trailing buffer collides with the booking's start.
    expect(hours(withBuffer)).toEqual([12, 13, 14, 15, 16]);
  });

  it("skips the nonexistent DST hour and handles the repeated one once", () => {
    // Spring forward US 2026: Mar 8, 02:00→03:00 absent in America/Chicago.
    const cfg = { ...CFG, maxAdvanceDays: 30, minNoticeHours: 0,
      openHours: { sun: [["01:00", "04:00"]] as [string, string][] } };
    const nowBefore = new Date("2026-03-07T12:00:00Z");
    const slots = computeSlots(cfg, [], nowBefore)
      .map((s) => partsInZone(s.startsAt, cfg.timezone)).filter((p) => p.d === 8 && p.m === 3);
    expect(slots.map((p) => p.hh)).toEqual([1, 3]); // 02:00 does not exist that day
  });

  it("pins timeZone on every Intl call — the system zone must never leak in", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    computeSlots(CFG, [], NOW);
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const call of spy.mock.calls) {
      expect((call[1] as Intl.DateTimeFormatOptions | undefined)?.timeZone).toBe(CFG.timezone);
    }
  });

  it("returns [] for an empty open_hours calendar and never mutates its inputs", () => {
    const booked = [{ startsAt: new Date(NOW), endsAt: new Date(NOW.getTime() + 3600e3) }];
    const frozen = JSON.parse(JSON.stringify(booked));
    expect(computeSlots({ ...CFG, openHours: {} }, booked, NOW)).toEqual([]);
    expect(JSON.parse(JSON.stringify(booked))).toEqual(frozen);
  });
});
