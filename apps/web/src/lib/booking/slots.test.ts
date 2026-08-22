import { describe, it, expect, vi, afterEach } from "vitest";
import { computeSlots, zonedTimeToUtc, partsInZone, normalizeOpenHours, type SlotConfig, type OpenHours, type Range } from "./slots";

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

  it("pins timeZone on every Intl call — the system zone must never leak in", async () => {
    // I6c: partsInZone now memoizes one formatter per timezone in a
    // module-level cache, so a formatter already built by an earlier test in
    // this file means a normal call here would see ZERO new
    // Intl.DateTimeFormat constructions and the ">0" assertion below would
    // be vacuous. Force a cold cache by loading a fresh module instance.
    vi.resetModules();
    const spy = vi.spyOn(Intl, "DateTimeFormat");
    const fresh = await import("./slots");
    fresh.computeSlots(CFG, [], NOW);
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

  // --- C1: the horizon's midnight can fall inside a spring-forward gap ---
  it("does not crash when the horizon's midnight falls in a spring-forward gap (America/Havana)", () => {
    const cfg: SlotConfig = {
      timezone: "America/Havana", slotDurationMinutes: 60, bufferMinutes: 0,
      minNoticeHours: 0, maxAdvanceDays: 30,
      openHours: {
        sun: [["09:00", "17:00"]], mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]],
        wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]], sat: [["09:00", "17:00"]],
      },
    };
    // horizon day = now + 31 days = 2026-03-08, the day Havana's clocks spring
    // forward AT midnight — 00:00 does not exist that day.
    const now = new Date("2026-02-05T12:00:00Z");
    expect(() => computeSlots(cfg, [], now)).not.toThrow();
    expect(computeSlots(cfg, [], now).length).toBeGreaterThan(0);
  });

  // --- I2: non-finite input must fail CLOSED, not silently pass ---
  it("fails closed (returns []) when a booked range is non-finite (Invalid Date) rather than silently offering its slot", () => {
    const badRange = { startsAt: new Date(NaN), endsAt: new Date(NaN) };
    // Every candidate this engine could offer gets compared against the one
    // unresolvable range, and each comparison must block — so the whole
    // result is empty, not just the range the bad booking would have shadowed.
    expect(computeSlots(CFG, [badRange], NOW)).toEqual([]);
  });

  it("fails closed (returns []) when bufferMinutes is not a finite number", () => {
    expect(computeSlots({ ...CFG, bufferMinutes: NaN }, [], NOW)).toEqual([]);
  });

  it("fails closed (returns []) when minNoticeHours is negative", () => {
    expect(computeSlots({ ...CFG, minNoticeHours: -1 }, [], NOW)).toEqual([]);
  });

  // --- I1: wall-clock close must win over real-ms arithmetic across a gap ---
  it("rejects a candidate whose real-ms end spills past the wall-clock close (spring-forward)", () => {
    const cfg = {
      ...CFG, maxAdvanceDays: 30, minNoticeHours: 0, slotDurationMinutes: 120,
      openHours: { sun: [["00:00", "02:00"]] as [string, string][] },
    };
    const nowBefore = new Date("2026-03-07T12:00:00Z");
    const slots = computeSlots(cfg, [], nowBefore)
      .map((s) => partsInZone(s.startsAt, cfg.timezone)).filter((p) => p.d === 8 && p.m === 3);
    // The only wall-minute-legal candidate is 00:00 (0+120<=120), but the
    // gap eats an hour of real time so it actually ends 03:00 wall — past
    // the 02:00 close. No slot should be offered that day.
    expect(slots).toHaveLength(0);
  });

  // --- I4: horizon includes the WHOLE last calendar day (pinned decision) ---
  it("includes the whole of the last horizon day, not just its start (pinned decision)", () => {
    const allWeek: OpenHours = {
      sun: [["09:00", "17:00"]], mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]],
      wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]], sat: [["09:00", "17:00"]],
    };
    const cfg: SlotConfig = {
      timezone: "America/Chicago", slotDurationMinutes: 60, bufferMinutes: 0,
      minNoticeHours: 0, maxAdvanceDays: 2, openHours: allWeek,
    };
    // Wed Sep 2 2026 13:00 CDT; maxAdvanceDays=2 → in-horizon days are
    // Wed Sep2 (i=0), Thu Sep3 (i=1), Fri Sep4 (i=2, the LAST day).
    const now = new Date("2026-09-02T18:00:00Z");
    const slots = computeSlots(cfg, [], now);
    const last = slots[slots.length - 1]!;
    // Fri Sep4's last 60min slot: 16:00-17:00 CDT (UTC-5) → 21:00Z-22:00Z.
    expect(last.startsAt.toISOString()).toBe("2026-09-04T21:00:00.000Z");
    expect(last.endsAt.toISOString()).toBe("2026-09-04T22:00:00.000Z");
    // No slot exists on day 3 (Sat Sep5) — one day past the horizon.
    expect(slots.some((s) => {
      const p = partsInZone(s.startsAt, cfg.timezone);
      return p.m === 9 && p.d === 5;
    })).toBe(false);
  });

  // --- I5: the fall-back day, not just the spring-forward day ---
  it("resolves the repeated fall-back hour to exactly one, deterministic instant", () => {
    const cfg = {
      ...CFG, maxAdvanceDays: 30, minNoticeHours: 0,
      openHours: { sun: [["01:00", "04:00"]] as [string, string][] },
    };
    // Fall back US 2026: Nov 1, 01:00 CDT occurs, then clocks fall back and
    // 01:00 CST occurs again — 01:00 is the one wall-clock hour that repeats.
    const nowBefore = new Date("2026-10-31T12:00:00Z");
    const slots = computeSlots(cfg, [], nowBefore)
      .filter((s) => {
        const p = partsInZone(s.startsAt, cfg.timezone);
        return p.m === 11 && p.d === 1;
      });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-11-01T06:00:00.000Z", // 01:00 CDT — the earlier of the two occurrences
      "2026-11-01T08:00:00.000Z", // 02:00 CST (unambiguous, after the repeat)
      "2026-11-01T09:00:00.000Z", // 03:00 CST
    ]);
  });

  // --- M1: dedupe slots produced by overlapping open-hours intervals ---
  it("dedupes a slot offered twice by overlapping open-hours intervals", () => {
    const cfg = { ...CFG, openHours: { mon: [["09:00", "12:00"], ["11:00", "14:00"]] as [string, string][] } };
    const slots = computeSlots(cfg, [], NOW)
      .filter((s) => partsInZone(s.startsAt, cfg.timezone).d === 7)
      .map((s) => partsInZone(s.startsAt, cfg.timezone).hh);
    expect(slots).toEqual([9, 10, 11, 12, 13]); // 11:00 offered by both intervals, kept once
  });

  // --- M4: fully-booked day returns no slots ---
  it("returns no slots for a fully-booked day (all hours blocked)", () => {
    // Monday Sep 7: fully-booked with eight 1-hour ranges covering 09:00-17:00
    const allBooked: Range[] = [];
    for (let h = 9; h < 17; h++) {
      const start = zonedTimeToUtc(2026, 9, 7, h, 0, CFG.timezone)!;
      const end = zonedTimeToUtc(2026, 9, 7, h + 1, 0, CFG.timezone)!;
      allBooked.push({ startsAt: start, endsAt: end });
    }

    // Config: Monday 09:00-17:00 (fully booked), Tuesday still open
    const cfg = { ...CFG, openHours: { mon: [["09:00", "17:00"]], tue: [["09:00", "12:00"], ["13:00", "17:00"]] } as OpenHours };
    const slots = computeSlots(cfg, allBooked, NOW);

    // Monday Sep 7 should have no slots
    const mondaySlots = slots.filter((s) => partsInZone(s.startsAt, cfg.timezone).d === 7);
    expect(mondaySlots).toHaveLength(0);

    // Other days (Tue Sep 8) should still have slots
    expect(slots.length).toBeGreaterThan(0);
  });

  // --- I3: defensive normalization — the DB has no jsonb CHECK ---
  describe("normalizeOpenHours", () => {
    it("returns {} for null", () => {
      expect(normalizeOpenHours(null)).toEqual({});
    });

    it("returns {} for a non-object (e.g. a bare string)", () => {
      expect(normalizeOpenHours("09:00-17:00")).toEqual({});
    });

    it("drops a day whose interval is a string instead of an array", () => {
      expect(normalizeOpenHours({ mon: "09:00-17:00" })).toEqual({});
    });

    it("drops a malformed tuple (missing the closing time)", () => {
      expect(normalizeOpenHours({ mon: [["9:00"]] })).toEqual({});
    });

    it("drops an interval whose close doesn't strictly exceed its open", () => {
      expect(normalizeOpenHours({ mon: [["17:00", "09:00"]] })).toEqual({});
    });

    it("keeps a valid interval and drops an invalid sibling in the same day", () => {
      expect(normalizeOpenHours({ mon: [["09:00", "17:00"], ["bad", "17:00"]] }))
        .toEqual({ mon: [["09:00", "17:00"]] });
    });
  });

  it("returns [] rather than throw when openHours is malformed (null)", () => {
    const cfg = { ...CFG, openHours: null as unknown as OpenHours };
    expect(() => computeSlots(cfg, [], NOW)).not.toThrow();
    expect(computeSlots(cfg, [], NOW)).toEqual([]);
  });

  it("returns [] rather than throw for an invalid IANA timezone", () => {
    const cfg = { ...CFG, timezone: "Not/AZone" };
    expect(() => computeSlots(cfg, [], NOW)).not.toThrow();
    expect(computeSlots(cfg, [], NOW)).toEqual([]);
  });
});
