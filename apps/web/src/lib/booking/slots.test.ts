import { describe, it, expect, vi, afterEach } from "vitest";
import { computeSlots, bookableRange, fitsOpenHours, zonedTimeToUtc, partsInZone, normalizeOpenHours, type SlotConfig, type OpenHours, type Range, type SlotClosures } from "./slots";
import { hoursChain, slotClosures, untilFor, type StatusInput, type StatusRowInput } from "../business-status/status";

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
    // 09:00's own trailing buffer collides with the booking's start (the
    // buffer is two-sided), so 09:00 goes. The next start is the booking's
    // end plus the buffer, 11:30 — not 12:00, which is what this test pinned
    // before D-028 (a whole slot lost to a 30-minute buffer).
    const hhmm = (slots: typeof noBuffer) => slots
      .map((s) => partsInZone(s.startsAt, CFG.timezone))
      .filter((p) => p.d === 7)
      .map((p) => `${String(p.hh).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`);
    expect(hhmm(withBuffer)).toEqual(["11:30", "12:30", "13:30", "14:30", "15:30"]);
  });

  // --- D-028: a buffer pushes the next start, it does not delete a slot ---
  // The grid steps by the slot length from the open time. Before this fix a
  // conflict only ever stepped to the NEXT grid point, so any buffer at all
  // cost a whole slot: 60-minute jobs, a 15-minute buffer and a 09:00 booking
  // removed 10:00 and offered 11:00 next. The rule now: when a candidate runs
  // into a booking, the next candidate starts at that booking's end plus the
  // buffer, and the grid carries on from there.
  it("D-028: a 15-minute buffer after a 09:00-10:00 booking offers 10:15 next, not 11:00", () => {
    const mon9 = zonedTimeToUtc(2026, 9, 7, 9, 0, CFG.timezone)!;
    const mon10 = zonedTimeToUtc(2026, 9, 7, 10, 0, CFG.timezone)!;
    const slots = computeSlots({ ...CFG, bufferMinutes: 15 }, [{ startsAt: mon9, endsAt: mon10 }], NOW);
    const monday = slots
      .map((s) => partsInZone(s.startsAt, CFG.timezone))
      .filter((p) => p.d === 7)
      .map((p) => `${String(p.hh).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`);
    // 16:15 is not offered: it would end 17:15, past the 17:00 close.
    expect(monday).toEqual(["10:15", "11:15", "12:15", "13:15", "14:15", "15:15"]);
  });

  it("D-028: the re-anchored start is measured in real time across a fall-back day (America/Chicago, Nov 1)", () => {
    // 01:00 happens twice on 2026-11-01 (CDT, then CST). The booking is the
    // SECOND 01:00 (07:00Z-08:00Z). The next start after it is 08:15Z, which
    // reads 02:15 CST. A wall-clock re-anchor that ignored the repeated hour
    // would land an hour early, on top of the booking.
    const cfg: SlotConfig = {
      ...CFG, bufferMinutes: 15, minNoticeHours: 0, maxAdvanceDays: 30,
      openHours: { sun: [["00:00", "06:00"]] },
    };
    const booked: Range[] = [{ startsAt: new Date("2026-11-01T07:00:00Z"), endsAt: new Date("2026-11-01T08:00:00Z") }];
    const slots = computeSlots(cfg, booked, new Date("2026-10-31T12:00:00Z"))
      .filter((s) => {
        const p = partsInZone(s.startsAt, cfg.timezone);
        return p.m === 11 && p.d === 1;
      });
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual([
      "2026-11-01T05:00:00.000Z", // 00:00 CDT, ends 06:00Z, clear of the booking by its buffer
      "2026-11-01T08:15:00.000Z", // 02:15 CST: the booking's end plus 15 minutes
      "2026-11-01T09:15:00.000Z", // 03:15 CST
      "2026-11-01T10:15:00.000Z", // 04:15 CST (05:15 would end 06:15, past the close)
    ]);
  });

  // The walk carries an iteration cap and fails CLOSED when it trips, so if the
  // forward-only guard below is ever removed this test goes red (no slots)
  // instead of hanging the worker. Mutation: drop the guard → [] → FAILS.
  it("D-028: a re-anchor that would step BACKWARDS on the wall clock (fall-back) still moves forward and terminates", () => {
    // Candidate 01:50 CDT (06:50Z) runs into a booking that ends at 01:10 CST
    // (07:10Z). Read on the wall clock, "the booking's end" is 01:10 — EARLIER
    // than the 01:50 candidate. Re-anchoring there would loop forever; the
    // engine must fall back to the ordinary grid step instead.
    const cfg: SlotConfig = {
      ...CFG, slotDurationMinutes: 10, bufferMinutes: 0, minNoticeHours: 0, maxAdvanceDays: 30,
      openHours: { sun: [["01:00", "03:00"]] },
    };
    const booking = { startsAt: new Date("2026-11-01T06:55:00Z"), endsAt: new Date("2026-11-01T07:10:00Z") };
    const slots = computeSlots(cfg, [booking], new Date("2026-10-31T12:00:00Z"));
    expect(slots.length).toBeGreaterThan(0);
    for (const s of slots) {
      const overlaps = s.startsAt.getTime() < booking.endsAt.getTime() && booking.startsAt.getTime() < s.endsAt.getTime();
      expect(overlaps).toBe(false);
    }
  });

  it("D-028: a 120-minute slot after a 60-minute booking re-anchors BEFORE the next grid point (10:15, not 11:00)", () => {
    // The re-anchor (10:15) is earlier than the grid step (09:00 + 120 = 11:00).
    // Mutation: compare the re-anchor against the NEXT grid point instead of
    // this candidate (`next > candMinutes`) → 11:00, 13:00, 15:00 → FAILS.
    const mon9 = zonedTimeToUtc(2026, 9, 7, 9, 0, CFG.timezone)!;
    const mon10 = zonedTimeToUtc(2026, 9, 7, 10, 0, CFG.timezone)!;
    const slots = computeSlots({ ...CFG, slotDurationMinutes: 120, bufferMinutes: 15 },
      [{ startsAt: mon9, endsAt: mon10 }], NOW);
    const monday = slots
      .map((s) => partsInZone(s.startsAt, CFG.timezone))
      .filter((p) => p.d === 7)
      .map((p) => `${String(p.hh).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`);
    expect(monday).toEqual(["10:15", "12:15", "14:15"]);
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

/**
 * Review of D-028: the picker and the submit-time recheck must not disagree.
 * Both submit paths used to accept only a start in computeSlots' CURRENT
 * output, and since D-028 a booking earlier in the day re-anchors the later
 * grid points — so a visitor who picked a still-free 13:00 was told "just
 * taken" the moment someone else booked 09:00. `bookableRange` is the submit
 * check now: the start is free (buffer both sides), fits the open hours with
 * its whole duration, respects notice and horizon, and is a start the engine
 * offers under SOME state of the day — the base grid, or a booking's
 * end-plus-buffer re-anchor point and that point's own grid continuation.
 */
describe("bookableRange — the one submit-time predicate", () => {
  const cfg: SlotConfig = { ...CFG, bufferMinutes: 15 };
  const at = (h: number, mi = 0, d = 7) => zonedTimeToUtc(2026, 9, d, h, mi, CFG.timezone)!;
  const nineToTen: Range = { startsAt: at(9), endsAt: at(10) };

  it("THE scenario: 13:00 was offered, someone books 09:00, submitting 13:00 is still accepted (mutation: grid-membership-only check → FAILS)", () => {
    expect(computeSlots(cfg, [], NOW).some((s) => s.startsAt.getTime() === at(13).getTime())).toBe(true);
    // The engine itself no longer OFFERS 13:00 after the 09:00 booking (it
    // offers 13:15) — which is exactly why grid membership cannot be the check.
    expect(computeSlots(cfg, [nineToTen], NOW).some((s) => s.startsAt.getTime() === at(13).getTime())).toBe(false);
    expect(bookableRange(cfg, [nineToTen], NOW, at(13))).toEqual({ startsAt: at(13), endsAt: at(14) });
  });

  it("accepts a re-anchor point and its continuation (10:15, 11:15 after a 09:00 booking)", () => {
    expect(bookableRange(cfg, [nineToTen], NOW, at(10, 15))).toEqual({ startsAt: at(10, 15), endsAt: at(11, 15) });
    expect(bookableRange(cfg, [nineToTen], NOW, at(11, 15))).not.toBeNull();
  });

  it("refuses what is not free: overlapping the booking, or inside its buffer on either side", () => {
    expect(bookableRange(cfg, [nineToTen], NOW, at(9))).toBeNull();
    expect(bookableRange(cfg, [nineToTen], NOW, at(10))).toBeNull();                         // inside the trailing buffer
    expect(bookableRange(cfg, [{ startsAt: at(11), endsAt: at(12) }], NOW, at(10))).toBeNull(); // ends inside the leading buffer
  });

  it("refuses a start no state of the day would offer (a real slot + 17 minutes)", () => {
    expect(bookableRange(cfg, [], NOW, at(13, 17))).toBeNull();
    expect(bookableRange(cfg, [nineToTen], NOW, at(13, 17))).toBeNull();
  });

  it("refuses a slot that spills past the close, a closed day, inside notice, past the horizon, or a non-instant", () => {
    expect(bookableRange(cfg, [], NOW, at(16, 30))).toBeNull();                               // ends 17:30
    expect(bookableRange(cfg, [], NOW, zonedTimeToUtc(2026, 9, 9, 13, 0, CFG.timezone)!)).toBeNull(); // Wednesday: closed
    expect(bookableRange({ ...cfg, minNoticeHours: 24 * 5 + 1 }, [], NOW, at(9))).toBeNull(); // Mon 09:00 is 4d20h out
    expect(bookableRange({ ...cfg, maxAdvanceDays: 3 }, [], NOW, at(13))).toBeNull();         // Mon is day 5
    expect(bookableRange(cfg, [], NOW, new Date(NaN))).toBeNull();
    expect(bookableRange(cfg, [], NOW, new Date(at(13).getTime() + 30_000))).toBeNull();      // not a whole minute
  });

  it("fails closed on the same bad input the engine does (Invalid Date booking, NaN buffer, bad zone)", () => {
    expect(bookableRange(cfg, [{ startsAt: new Date(NaN), endsAt: new Date(NaN) }], NOW, at(13))).toBeNull();
    expect(bookableRange({ ...cfg, bufferMinutes: NaN }, [], NOW, at(13))).toBeNull();
    expect(bookableRange({ ...cfg, timezone: "Not/AZone" }, [], NOW, at(13))).toBeNull();
  });

  it("every slot the engine offers passes it, across states and a fall-back day — picker ⊆ submit, so they cannot disagree", () => {
    const fallBack: SlotConfig = { ...CFG, bufferMinutes: 15, minNoticeHours: 0, maxAdvanceDays: 30, openHours: { sun: [["00:00", "06:00"]] } };
    const cases: [SlotConfig, Range[], Date][] = [
      [cfg, [], NOW],
      [cfg, [nineToTen], NOW],
      [cfg, [nineToTen, { startsAt: at(12, 15), endsAt: at(13, 15) }], NOW],
      [{ ...cfg, slotDurationMinutes: 120 }, [nineToTen], NOW],
      [{ ...cfg, slotDurationMinutes: 45, bufferMinutes: 10 }, [{ startsAt: at(10, 7), endsAt: at(10, 52), }], NOW],
      [fallBack, [{ startsAt: new Date("2026-11-01T07:00:00Z"), endsAt: new Date("2026-11-01T08:00:00Z") }], new Date("2026-10-31T12:00:00Z")],
    ];
    for (const [c, booked, now] of cases) {
      const offered = computeSlots(c, booked, now);
      expect(offered.length).toBeGreaterThan(0);
      for (const s of offered) expect(bookableRange(c, booked, now, s.startsAt)).toEqual(s);
    }
  });
});

/**
 * S-47d: closures. Every fixture is built by the real writers (`untilFor` for the stored `until`,
 * `slotClosures` for the engine's input), so a status-side mistake (a reopening-based window) shows up here
 * as a wrong slot, not only as a wrong field in status.test.ts. The zone is America/Chicago; the calendar is
 * open Monday to Friday 08:00-17:00 and Saturday 09:00-13:00, while the account's business hours are Monday
 * to Friday only (the two-hours-sources shape D12 exists for). Every instant is CDT (UTC-5).
 */
describe("closures (S-47d)", () => {
  const CHI = "America/Chicago";
  const BIZ: OpenHours = {
    mon: [["08:00", "17:00"]], tue: [["08:00", "17:00"]], wed: [["08:00", "17:00"]],
    thu: [["08:00", "17:00"]], fri: [["08:00", "17:00"]],
  };
  const CAL: OpenHours = { ...BIZ, sat: [["09:00", "13:00"]] };
  const C: SlotConfig = { timezone: CHI, slotDurationMinutes: 60, bufferMinutes: 0, minNoticeHours: 0, maxAdvanceDays: 7, openHours: CAL };
  const chain = hoursChain(BIZ, CAL);
  const WED = new Date("2027-06-02T15:00:00.000Z"); // Wednesday 10:00 CDT
  const FRI = new Date("2027-06-04T15:00:00.000Z"); // Friday 10:00 CDT
  const SAT9 = "2027-06-05T14:00:00.000Z";          // Saturday 09:00 CDT

  const pad = (n: number) => String(n).padStart(2, "0");
  const label = (r: Range) => {
    const p = partsInZone(r.startsAt, CHI);
    return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.hh)}:${pad(p.mi)}`;
  };
  const hoursOf = (key: string, from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `${key} ${pad(from + i)}:00`);
  const row = (state: StatusRowInput["state"], late_minutes: number | null, until: Date | null, setAt: Date): StatusRowInput =>
    ({ state, late_minutes, until: until ? until.toISOString() : null, set_at: setAt.toISOString() });
  const closuresFor = (over: Partial<StatusInput> & { now: Date }): SlotClosures =>
    slotClosures({ row: null, closedDays: [], hours: chain, timezone: CHI, ...over });

  type Fixture = { name: string; cfg: SlotConfig; now: Date; closures: SlotClosures; dropped: string[] };
  const fixtures: Fixture[] = [
    {
      name: "a closed day (Thursday) drops that day only",
      cfg: C, now: WED,
      closures: closuresFor({ now: WED, closedDays: [{ starts_on: "2027-06-03", ends_on: "2027-06-03", reason: "holiday" }] }),
      dropped: hoursOf("2027-06-03", 8, 16),
    },
    {
      name: "Closed today (set Wednesday 10:00) drops the rest of today and nothing after midnight (D12)",
      cfg: C, now: WED,
      closures: closuresFor({ now: WED, row: row("closed_today", null, untilFor({ state: "closed_today" }, chain, CHI, WED), WED) }),
      dropped: hoursOf("2027-06-02", 10, 16),
    },
    {
      name: "an open-ended storm drops every slot",
      cfg: C, now: WED,
      closures: closuresFor({ now: WED, row: row("storm", null, null, WED) }),
      dropped: [
        ...hoursOf("2027-06-02", 10, 16), ...hoursOf("2027-06-03", 8, 16), ...hoursOf("2027-06-04", 8, 16),
        ...hoursOf("2027-06-05", 9, 12), ...hoursOf("2027-06-07", 8, 16), ...hoursOf("2027-06-08", 8, 16),
        ...hoursOf("2027-06-09", 8, 16),
      ],
    },
    {
      name: "Running late 30 (Wednesday 10:00) drops only today's slots starting within 30 minutes; 10:30 itself stays",
      cfg: { ...C, slotDurationMinutes: 15, maxAdvanceDays: 1 }, now: WED,
      closures: closuresFor({ now: WED, row: row("running_late", 30, untilFor({ state: "running_late", lateMinutes: 30 }, chain, CHI, WED), WED) }),
      dropped: ["2027-06-02 10:00", "2027-06-02 10:15"],
    },
    {
      name: "a storm set Wednesday and back on Saturday drops Wednesday to Friday and keeps Saturday (orchestrator ruling)",
      cfg: C, now: WED,
      closures: closuresFor({ now: WED, row: row("storm", null, untilFor({ state: "storm", backOn: "2027-06-05" }, chain, CHI, WED), WED) }),
      dropped: [...hoursOf("2027-06-02", 10, 16), ...hoursOf("2027-06-03", 8, 16), ...hoursOf("2027-06-04", 8, 16)],
    },
    {
      name: "D12's Saturday case: Closed today set Friday 10:00 drops Friday only and keeps Saturday",
      cfg: C, now: FRI,
      closures: closuresFor({ now: FRI, row: row("closed_today", null, untilFor({ state: "closed_today" }, chain, CHI, FRI), FRI) }),
      dropped: hoursOf("2027-06-04", 10, 16),
    },
  ];

  const split = (f: Fixture) => {
    const base = computeSlots(f.cfg, [], f.now);
    const offered = computeSlots({ ...f.cfg, closures: f.closures }, [], f.now);
    const kept = new Set(offered.map((r) => r.startsAt.getTime()));
    return { base, offered, dropped: base.filter((r) => !kept.has(r.startsAt.getTime())) };
  };

  it("the fixtures' windows are the D12 ones (pinned, so a fixture cannot drift into a vacuous one)", () => {
    expect(untilFor({ state: "closed_today" }, chain, CHI, WED)?.toISOString()).toBe("2027-06-03T05:00:00.000Z");
    expect(untilFor({ state: "closed_today" }, chain, CHI, FRI)?.toISOString()).toBe("2027-06-05T05:00:00.000Z");
    expect(untilFor({ state: "storm", backOn: "2027-06-05" }, chain, CHI, WED)?.toISOString()).toBe("2027-06-05T05:00:00.000Z");
    expect(chain).toEqual(BIZ);
  });

  for (const f of fixtures) {
    it(`${f.name}: exactly these slots, nothing else`, () => {
      const { base, offered, dropped } = split(f);
      expect(base.length).toBeGreaterThan(0);
      expect(dropped.map(label)).toEqual(f.dropped);
      expect(offered.length).toBe(base.length - f.dropped.length);
    });
  }

  it("bookableRange refuses every dropped start and accepts every other start with its original range", () => {
    let refused = 0;
    let accepted = 0;
    for (const f of fixtures) {
      const { base, dropped } = split(f);
      const out = new Set(dropped.map((r) => r.startsAt.getTime()));
      for (const s of base) {
        const got = bookableRange({ ...f.cfg, closures: f.closures }, [], f.now, s.startsAt);
        if (out.has(s.startsAt.getTime())) { expect(got, `${f.name}: ${label(s)}`).toBeNull(); refused++; }
        else { expect(got, `${f.name}: ${label(s)}`).toEqual(s); accepted++; }
      }
    }
    expect(refused).toBe(fixtures.reduce((n, f) => n + f.dropped.length, 0));
    expect(accepted).toBeGreaterThan(0);
  });

  it("the invariant: every slot computeSlots offers under a closure passes bookableRange under the same closure", () => {
    let checked = 0;
    for (const f of fixtures) {
      const c = { ...f.cfg, closures: f.closures };
      for (const s of computeSlots(c, [], f.now)) { expect(bookableRange(c, [], f.now, s.startsAt)).toEqual(s); checked++; }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a storm back on Saturday: Saturday 09:00 is offered and bookableRange accepts it (mutation: a reopening-based until, Monday 08:00, FAILS)", () => {
    const f = fixtures[4]!;
    const c = { ...f.cfg, closures: f.closures };
    expect(computeSlots(c, [], WED).map((r) => r.startsAt.toISOString())).toContain(SAT9);
    expect(bookableRange(c, [], WED, new Date(SAT9))).toEqual({ startsAt: new Date(SAT9), endsAt: new Date("2027-06-05T15:00:00.000Z") });
  });

  it("D12's Saturday case: Saturday 09:00 is offered and bookableRange accepts it (mutation: blockedBefore = the reopening, Monday 08:00, FAILS)", () => {
    const f = fixtures[5]!;
    const c = { ...f.cfg, closures: f.closures };
    expect(computeSlots(c, [], FRI).map((r) => r.startsAt.toISOString())).toContain(SAT9);
    expect(bookableRange(c, [], FRI, new Date(SAT9))).toEqual({ startsAt: new Date(SAT9), endsAt: new Date("2027-06-05T15:00:00.000Z") });
  });

  it("Running late 120 at 23:00 never reaches past midnight: tomorrow's 00:00 and 00:30 stay (spec §5.3)", () => {
    const now = new Date("2027-06-03T04:00:00.000Z"); // Wednesday 23:00 CDT
    const cfg: SlotConfig = { ...C, slotDurationMinutes: 30, maxAdvanceDays: 1, openHours: { thu: [["00:00", "02:00"]] } };
    const closures = closuresFor({ now, row: row("running_late", 120, untilFor({ state: "running_late", lateMinutes: 120 }, chain, CHI, now), now) });
    expect(closures.lateBefore?.toISOString()).toBe("2027-06-03T05:00:00.000Z");
    expect(computeSlots({ ...cfg, closures }, [], now).map(label))
      .toEqual(["2027-06-03 00:00", "2027-06-03 00:30", "2027-06-03 01:00", "2027-06-03 01:30"]);
    expect(bookableRange({ ...cfg, closures }, [], now, new Date("2027-06-03T05:00:00.000Z"))).not.toBeNull();
  });

  it("a closed day is the ACCOUNT's date, not UTC's: Wednesday 19:00 CDT (Thursday in UTC) stays, Thursday 19:00 CDT goes (mutation: a UTC date key, FAILS)", () => {
    const cfg: SlotConfig = { ...C, maxAdvanceDays: 2, openHours: { wed: [["18:00", "22:00"]], thu: [["18:00", "22:00"]] } };
    const closures = closuresFor({ now: WED, closedDays: [{ starts_on: "2027-06-03", ends_on: "2027-06-03", reason: null }] });
    expect(computeSlots({ ...cfg, closures }, [], WED).map(label))
      .toEqual(["2027-06-02 18:00", "2027-06-02 19:00", "2027-06-02 20:00", "2027-06-02 21:00"]);
    expect(bookableRange({ ...cfg, closures }, [], WED, new Date("2027-06-03T00:00:00.000Z"))).not.toBeNull(); // Wed 19:00 CDT
    expect(bookableRange(cfg, [], WED, new Date("2027-06-04T00:00:00.000Z"))).not.toBeNull();             // Thu 19:00 CDT, the control
    expect(bookableRange({ ...cfg, closures }, [], WED, new Date("2027-06-04T00:00:00.000Z"))).toBeNull();
  });

  it("an empty closure changes nothing", () => {
    const none: SlotClosures = { closedDayKeys: new Set(), blockedBefore: null, blockAll: false, lateBefore: null };
    expect(computeSlots({ ...C, closures: none }, [], WED)).toEqual(computeSlots(C, [], WED));
  });

  it("an unreadable window fails CLOSED: an Invalid Date blockedBefore or lateBefore offers nothing and books nothing", () => {
    const sat9 = new Date(SAT9);
    expect(bookableRange(C, [], WED, sat9)).not.toBeNull(); // the control
    const bad: SlotClosures[] = [
      { closedDayKeys: new Set(), blockedBefore: new Date(NaN), blockAll: false, lateBefore: null },
      { closedDayKeys: new Set(), blockedBefore: null, blockAll: false, lateBefore: new Date(NaN) },
    ];
    for (const b of bad) {
      expect(computeSlots({ ...C, closures: b }, [], WED)).toEqual([]);
      expect(bookableRange({ ...C, closures: b }, [], WED, sat9)).toBeNull();
    }
  });
});

describe("fitsOpenHours (F-046: the staff job's open-hours warning)", () => {
  const TZ = "America/Chicago";
  const MON: OpenHours = { mon: [["09:00", "17:00"]] };
  const at = (iso: string) => new Date(iso);
  const plus = (d: Date, minutes: number) => new Date(d.getTime() + minutes * 60_000);

  it("fits a job inside one open interval on the wall clock and in real time", () => {
    const mon9 = at("2026-09-07T14:00:00.000Z"); // Mon 09:00 CDT
    expect(fitsOpenHours(MON, mon9, plus(mon9, 60), TZ)).toBe(true);
    const mon1600 = at("2026-09-07T21:00:00.000Z"); // Mon 16:00 CDT, ends exactly at 17:00
    expect(fitsOpenHours(MON, mon1600, plus(mon1600, 60), TZ)).toBe(true);
  });

  it("does not fit a job that runs past the close or starts before the open", () => {
    const mon1630 = at("2026-09-07T21:30:00.000Z"); // Mon 16:30 CDT
    expect(fitsOpenHours(MON, mon1630, plus(mon1630, 60), TZ)).toBe(false);
    const mon0855 = at("2026-09-07T13:55:00.000Z"); // Mon 08:55 CDT
    expect(fitsOpenHours(MON, mon0855, plus(mon0855, 60), TZ)).toBe(false);
  });

  it("does not fit on a day with no hours", () => {
    const sun9 = at("2026-09-06T14:00:00.000Z"); // Sun 09:00 CDT
    expect(fitsOpenHours(MON, sun9, plus(sun9, 60), TZ)).toBe(false);
  });

  it("a 22:00-24:00 interval fits a two-hour job ending at midnight", () => {
    const late = at("2026-09-08T03:00:00.000Z"); // Mon 2026-09-07 22:00 CDT
    expect(fitsOpenHours({ mon: [["22:00", "24:00"]] }, late, plus(late, 120), TZ)).toBe(true);
    expect(fitsOpenHours({ mon: [["22:00", "24:00"]] }, late, plus(late, 125), TZ)).toBe(false);
  });

  it("on the spring-forward day (2026-03-08) the gap eats an hour: 01:00 for 120 min ends at 04:00 wall, past a 03:00 close", () => {
    const hours: OpenHours = { sun: [["00:00", "03:00"]] };
    // The control, a week later with no gap: the same wall start and length fit.
    const sun15 = at("2026-03-15T06:00:00.000Z"); // Sun 2026-03-15 01:00 CDT
    expect(fitsOpenHours(hours, sun15, plus(sun15, 120), TZ)).toBe(true);
    // The same day, a job that ends before the gap: fits.
    const gapDayMidnight = at("2026-03-08T06:00:00.000Z"); // 00:00 CST
    expect(fitsOpenHours(hours, gapDayMidnight, plus(gapDayMidnight, 60), TZ)).toBe(true);
    // 01:00 CST + 120 real minutes = 09:00Z = 04:00 CDT.
    const gapDay1 = at("2026-03-08T07:00:00.000Z");
    expect(fitsOpenHours(hours, gapDay1, plus(gapDay1, 120), TZ)).toBe(false);
  });

  it("fails CLOSED: an invalid zone, an Invalid Date or an empty range answers false", () => {
    const mon9 = at("2026-09-07T14:00:00.000Z");
    expect(fitsOpenHours(MON, mon9, plus(mon9, 60), "Not/AZone")).toBe(false);
    expect(fitsOpenHours(MON, new Date(NaN), plus(mon9, 60), TZ)).toBe(false);
    expect(fitsOpenHours(MON, mon9, new Date(NaN), TZ)).toBe(false);
    expect(fitsOpenHours(MON, mon9, mon9, TZ)).toBe(false);
  });
});
