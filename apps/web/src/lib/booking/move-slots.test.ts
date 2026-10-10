import { describe, it, expect } from "vitest";
import {
  computeSlots, computeMoveSlots, movableRange, zonedTimeToUtc, partsInZone,
  type SlotConfig, type Range,
} from "./slots";

/**
 * F-048: a customer MOVES their own booking. The booking being moved is still
 * `booked` while they pick, so the plain engine counts it as busy: its buffer
 * blocks the neighbouring slots and its end re-anchors the rest of its day
 * (D-028), so a mover would see 11:15, 12:15… where every other visitor sees
 * 11:00, 12:00…. The move engine runs WITHOUT that booking, then drops every
 * slot that overlaps its CURRENT range: that range is still held by the row
 * until the move commits, and `bookings_no_overlap` would refuse it.
 */

const CHI = "America/Chicago";
const CFG: SlotConfig = {
  timezone: CHI, slotDurationMinutes: 60, bufferMinutes: 15,
  minNoticeHours: 12, maxAdvanceDays: 7,
  openHours: { mon: [["09:00", "17:00"]] },
};
// Wed 2026-09-02 13:00 CDT.
const NOW = new Date("2026-09-02T18:00:00Z");

const at = (hh: number, mi = 0, d = 7, m = 9, y = 2026, tz = CHI) => zonedTimeToUtc(y, m, d, hh, mi, tz)!;
const range = (from: Date, to: Date): Range => ({ startsAt: from, endsAt: to });
const wall = (slots: Range[], d = 7) => slots
  .filter((s) => partsInZone(s.startsAt, CHI).d === d)
  .map((s) => { const p = partsInZone(s.startsAt, CHI); return `${p.hh}:${String(p.mi).padStart(2, "0")}`; });
const isos = (slots: Range[]) => slots.map((s) => s.startsAt.toISOString());

describe("computeMoveSlots — the slots a booking can move to", () => {
  it("the booking's own buffer and re-anchor no longer shape its day: 09:00 and 11:00 are offered, its own 10:00 is not (mutations: keep the own booking in `booked` → 09:00 and 11:00 vanish and the day shifts to :15, FAILS; drop the own-range filter → 10:00 offered, FAILS)", () => {
    const own = range(at(10), at(11));
    // The control: what the plain engine shows a mover today.
    expect(wall(computeSlots(CFG, [own], NOW))).toEqual(["11:15", "12:15", "13:15", "14:15", "15:15"]);
    expect(wall(computeMoveSlots(CFG, [], own, NOW)))
      .toEqual(["9:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00"]);
  });

  it("drops a slot that only PARTLY overlaps the own range (another booking re-anchored the grid to :15)", () => {
    // A 15-minute booking at 09:00 (made when the slots were shorter) moves
    // the grid to 09:15, 10:15, …; 10:15-11:15 and 11:15-12:15 both run into
    // the own 11:00-12:00, which is still held.
    const cfg = { ...CFG, bufferMinutes: 0 };
    const other = range(at(9), at(9, 15));
    const own = range(at(11), at(12));
    expect(wall(computeMoveSlots(cfg, [other], own, NOW)))
      .toEqual(["9:15", "12:15", "13:15", "14:15", "15:15"]);
  });

  describe("DST: the own range is compared as real instants, never as wall-clock minutes", () => {
    // Sun 2026-11-01, America/Chicago falls back at 02:00 CDT → 01:00 CST, so
    // the wall clock reads 01:00-01:59 twice. The engine offers the FIRST
    // reading (06:00Z) and never the second (07:00Z).
    const cfg: SlotConfig = {
      timezone: CHI, slotDurationMinutes: 60, bufferMinutes: 0,
      minNoticeHours: 0, maxAdvanceDays: 2, openHours: { sun: [["00:00", "04:00"]] },
    };
    const now = new Date("2026-10-31T12:00:00Z");

    it("an own booking in the SECOND 01:00 does not remove the first 01:00's slot (mutation: match the own slot by its wall-clock start → 06:00Z dropped, FAILS)", () => {
      const own = range(new Date("2026-11-01T07:00:00Z"), new Date("2026-11-01T08:00:00Z"));
      const got = isos(computeMoveSlots(cfg, [], own, now));
      expect(got).toContain("2026-11-01T06:00:00.000Z");
      expect(got).toContain("2026-11-01T08:00:00.000Z");
      expect(got).not.toContain("2026-11-01T07:00:00.000Z");
    });

    it("an own booking in the FIRST 01:00 removes exactly that slot and keeps 02:00 CST beside it (mutation: overlap on wall-clock minutes → 01:00 CDT-01:00 CST reads as zero minutes long and is offered, FAILS)", () => {
      const own = range(new Date("2026-11-01T06:00:00Z"), new Date("2026-11-01T07:00:00Z"));
      const got = isos(computeMoveSlots(cfg, [], own, now));
      expect(got).not.toContain("2026-11-01T06:00:00.000Z");
      expect(got).toContain("2026-11-01T05:00:00.000Z");
      expect(got).toContain("2026-11-01T08:00:00.000Z");
    });

    it("spring-forward with a 30-minute buffer: the hour before the jump and the hour after the own booking are both offered (mutation: keep own in `booked` → only 00:00 is left, FAILS)", () => {
      // Sun 2026-03-08: 02:00 CST → 03:00 CDT. Own booking 03:00-04:00 CDT.
      const spring: SlotConfig = { ...cfg, bufferMinutes: 30, openHours: { sun: [["00:00", "05:00"]] } };
      const springNow = new Date("2026-03-07T12:00:00Z");
      const own = range(new Date("2026-03-08T08:00:00Z"), new Date("2026-03-08T09:00:00Z"));
      expect(isos(computeSlots(spring, [own], springNow))).toEqual(["2026-03-08T06:00:00.000Z"]);
      expect(isos(computeMoveSlots(spring, [], own, springNow))).toEqual([
        "2026-03-08T06:00:00.000Z", // 00:00 CST
        "2026-03-08T07:00:00.000Z", // 01:00 CST, ends at the jump, 03:00 CDT
        // 02:00 does not exist; 03:00 CDT is the own booking
        "2026-03-08T09:00:00.000Z", // 04:00 CDT
      ]);
    });
  });

  it("fails CLOSED on an unusable own range: no slots at all (mutation: skip non-finite own → every slot offered, FAILS)", () => {
    expect(computeMoveSlots(CFG, [], range(new Date("nope"), at(11)), NOW)).toEqual([]);
    expect(computeMoveSlots(CFG, [], range(at(10), new Date(Number.NaN)), NOW)).toEqual([]);
  });

  it("fails CLOSED on the same bad config the engine refuses (NaN buffer)", () => {
    expect(computeMoveSlots({ ...CFG, bufferMinutes: Number.NaN }, [], range(at(10), at(11)), NOW)).toEqual([]);
  });

  it("other bookings still bind, with their buffer on both sides", () => {
    const own = range(at(10), at(11));
    const other = range(at(13), at(14));
    // 12:00-13:00 runs into 13:00's 15-minute buffer; 13:00 is taken; the
    // grid re-anchors to 14:15 after it.
    expect(wall(computeMoveSlots(CFG, [other], own, NOW))).toEqual(["9:00", "11:00", "14:15", "15:15"]);
  });
});

describe("movableRange — the submit-time check for a move", () => {
  const own = range(at(10), at(11));

  it("accepts the neighbours the plain check refuses (mutation: keep own in `booked` → 11:00 refused, FAILS)", () => {
    expect(movableRange(CFG, [], own, NOW, at(11))).toEqual({ startsAt: at(11), endsAt: at(12) });
    expect(movableRange(CFG, [], own, NOW, at(9))).toEqual({ startsAt: at(9), endsAt: at(10) });
  });

  it("refuses the own range itself and anything overlapping it (mutation: drop the own-range check → 10:00 accepted, FAILS)", () => {
    expect(movableRange(CFG, [], own, NOW, at(10))).toBeNull();
  });

  it("refuses what no state of the day without the booking would offer: its old re-anchor 11:15, an off-grid 10:30", () => {
    expect(movableRange(CFG, [], own, NOW, at(11, 15))).toBeNull();
    expect(movableRange(CFG, [], own, NOW, at(10, 30))).toBeNull();
  });

  it("fails CLOSED on an unusable own range", () => {
    expect(movableRange(CFG, [], range(new Date("nope"), at(11)), NOW, at(14))).toBeNull();
  });

  it("every slot the move engine offers passes it, across buffers, re-anchors and both DST edges — picker ⊆ submit", () => {
    const cases: [SlotConfig, Range[], Range, Date][] = [
      [CFG, [], own, NOW],
      [{ ...CFG, bufferMinutes: 0 }, [range(at(9), at(9, 15))], range(at(11), at(12)), NOW],
      [CFG, [range(at(13), at(14))], own, NOW],
      [{ timezone: CHI, slotDurationMinutes: 60, bufferMinutes: 0, minNoticeHours: 0, maxAdvanceDays: 2,
         openHours: { sun: [["00:00", "04:00"]] } }, [],
       range(new Date("2026-11-01T07:00:00Z"), new Date("2026-11-01T08:00:00Z")), new Date("2026-10-31T12:00:00Z")],
      [{ timezone: CHI, slotDurationMinutes: 60, bufferMinutes: 30, minNoticeHours: 0, maxAdvanceDays: 2,
         openHours: { sun: [["00:00", "05:00"]] } }, [],
       range(new Date("2026-03-08T08:00:00Z"), new Date("2026-03-08T09:00:00Z")), new Date("2026-03-07T12:00:00Z")],
    ];
    for (const [cfg, others, mine, now] of cases) {
      const offered = computeMoveSlots(cfg, others, mine, now);
      expect(offered.length).toBeGreaterThan(0);
      for (const s of offered) expect(movableRange(cfg, others, mine, now, s.startsAt)).toEqual(s);
    }
  });
});
