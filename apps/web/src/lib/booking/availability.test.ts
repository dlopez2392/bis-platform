import { describe, it, expect, vi, beforeEach } from "vitest";

const listBookedRangesMock = vi.fn();
const getBusinessStatusRowMock = vi.fn();
const listClosedDaysFromMock = vi.fn();
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<object>();
  return {
    ...real,
    listBookedRanges: (...a: unknown[]) => listBookedRangesMock(...a),
    // Overridden, never spread: the real readers would run against the bare {} client below.
    getBusinessStatusRow: (...a: unknown[]) => getBusinessStatusRowMock(...a),
    listClosedDaysFrom: (...a: unknown[]) => listClosedDaysFromMock(...a),
  };
});

import type { CalendarRow, serviceDb } from "@bis/db";
import { bookableSlot, computeAllSlots, moveSlots, movableSlot } from "./availability";

beforeEach(() => {
  getBusinessStatusRowMock.mockReset().mockResolvedValue(null); // no row reads as open
  listClosedDaysFromMock.mockReset().mockResolvedValue([]);
});

const calendar = {
  id: "cal1", account_id: "a1", public_id: "p1", enabled: true,
  slot_duration_minutes: 60, buffer_minutes: 0, min_notice_hours: 0,
  max_advance_days: 2, open_hours: { tue: [["09:00", "12:00"]] }, notify_emails: [],
} as unknown as CalendarRow;

describe("computeAllSlots", () => {
  it("returns Date ranges for open hours minus booked ranges", async () => {
    // Tue 2027-06-01, zone UTC for a deterministic test
    listBookedRangesMock.mockResolvedValue([
      { starts_at: "2027-06-01T09:00:00.000Z", ends_at: "2027-06-01T10:00:00.000Z" },
    ]);
    const now = new Date("2027-06-01T00:00:00Z");
    const slots = await computeAllSlots({} as unknown as ReturnType<typeof serviceDb>, calendar, "UTC", now);
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).toContain("2027-06-01T10:00:00.000Z");
    expect(starts).toContain("2027-06-01T11:00:00.000Z");
    expect(starts).not.toContain("2027-06-01T09:00:00.000Z"); // booked
    expect(slots[0]!.startsAt).toBeInstanceOf(Date);
  });
});

/**
 * F-048: the I/O half of a customer's move. The mock answers the way the
 * database does — it leaves out the booking `listBookedRanges` is told to
 * exclude — so the assertions are on the SLOTS, never on the call: if the
 * move path forgot to pass the moving booking's id, its own buffer would come
 * back and 09:00/11:00 would vanish.
 */
describe("moveSlots / movableSlot — the day as it will be once the move commits", () => {
  const rows = [
    { id: "own", starts_at: "2027-06-01T10:00:00.000Z", ends_at: "2027-06-01T11:00:00.000Z" },
  ];
  const asDb = (calId: string, fromIso: string, toIso: string, exclude?: string) =>
    rows.filter((r) => r.id !== exclude).map(({ starts_at, ends_at }) => ({ starts_at, ends_at }));
  const buffered = { ...calendar, buffer_minutes: 15 } as unknown as CalendarRow;
  const db = {} as unknown as ReturnType<typeof serviceDb>;
  const now = new Date("2027-06-01T00:00:00Z");
  const moving = { id: "own", startsAt: new Date(rows[0]!.starts_at), endsAt: new Date(rows[0]!.ends_at) };

  it("offers the neighbours of the booking being moved, never its own range (mutation: drop the exclusion → 09:00 and 11:00 vanish, FAILS)", async () => {
    listBookedRangesMock.mockImplementation(async (...a: unknown[]) => asDb(...(a.slice(1) as [string, string, string, string?])));
    const starts = (await moveSlots(db, buffered, "UTC", now, moving)).map((s) => s.startsAt.toISOString());
    expect(starts).toEqual(["2027-06-01T09:00:00.000Z", "2027-06-01T11:00:00.000Z"]);
  });

  it("the submit-time check agrees: 11:00 is movable, 10:00 is not", async () => {
    listBookedRangesMock.mockImplementation(async (...a: unknown[]) => asDb(...(a.slice(1) as [string, string, string, string?])));
    expect(await movableSlot(db, buffered, "UTC", now, moving, new Date("2027-06-01T11:00:00Z")))
      .toEqual({ startsAt: new Date("2027-06-01T11:00:00Z"), endsAt: new Date("2027-06-01T12:00:00Z") });
    expect(await movableSlot(db, buffered, "UTC", now, moving, new Date("2027-06-01T10:00:00Z"))).toBeNull();
  });
});

/**
 * S-47d spec §5.3: each of the four functions reads the calendar's OWN account's closures and passes them
 * to the engine, so the picker, the submit, the move and Sofia's tools all refuse a closed time. Tuesday
 * 2027-06-01 is the calendar's only open day in its horizon (09:00, 10:00, 11:00 UTC).
 */
describe("closures (S-47d): readSlotClosures in all four functions", () => {
  const db = {} as unknown as ReturnType<typeof serviceDb>;
  const now = new Date("2027-06-01T00:00:00Z");
  const moving = { id: "own", startsAt: new Date("2027-06-01T09:00:00Z"), endsAt: new Date("2027-06-01T10:00:00Z") };
  const ten = new Date("2027-06-01T10:00:00Z");
  const closedTuesday = [{
    id: "cd1", account_id: "a1", starts_on: "2027-06-01", ends_on: "2027-06-01", reason: "holiday",
    created_by: "user_1", created_at: "2027-05-20T00:00:00Z",
  }];
  const four = {
    computeAllSlots: (cal: CalendarRow) => computeAllSlots(db, cal, "UTC", now),
    bookableSlot: (cal: CalendarRow) => bookableSlot(db, cal, "UTC", now, ten),
    moveSlots: (cal: CalendarRow) => moveSlots(db, cal, "UTC", now, moving),
    movableSlot: (cal: CalendarRow) => movableSlot(db, cal, "UTC", now, moving, ten),
  };
  beforeEach(() => { listBookedRangesMock.mockReset().mockResolvedValue([]); });

  it("each reads the calendar's account_id, never another account's, from yesterday's date on (mutation: read calendar.id → FAILS)", async () => {
    const other = { ...calendar, id: "cal2", account_id: "a2" } as unknown as CalendarRow;
    for (const [name, run] of Object.entries(four)) {
      getBusinessStatusRowMock.mockClear(); listClosedDaysFromMock.mockClear();
      await run(calendar);
      await run(other);
      expect(getBusinessStatusRowMock.mock.calls, name).toEqual([[db, "a1"], [db, "a2"]]);
      expect(listClosedDaysFromMock.mock.calls, name).toEqual([[db, "a1", "2027-05-31"], [db, "a2", "2027-05-31"]]);
    }
    expect(Object.keys(four)).toEqual(["computeAllSlots", "bookableSlot", "moveSlots", "movableSlot"]);
  });

  for (const name of ["computeAllSlots", "bookableSlot", "moveSlots", "movableSlot"] as const) {
    it(`${name} rejects when the status read throws: never a slot during an unknown closure (S17)`, async () => {
      getBusinessStatusRowMock.mockRejectedValue(new Error("getBusinessStatusRow failed: boom"));
      await expect(four[name](calendar)).rejects.toThrow("getBusinessStatusRow failed: boom");
    });
  }

  it("a failed closed-days read rejects too", async () => {
    listClosedDaysFromMock.mockRejectedValue(new Error("listClosedDaysFrom failed: boom"));
    await expect(computeAllSlots(db, calendar, "UTC", now)).rejects.toThrow("listClosedDaysFrom failed: boom");
  });

  it("a closed day reaches every result: no slots, and nothing bookable or movable (mutation: drop closures in any one function → FAILS)", async () => {
    // The control: open, the day offers slots and 10:00 can be booked and moved to.
    expect((await computeAllSlots(db, calendar, "UTC", now)).map((r) => r.startsAt.toISOString()))
      .toEqual(["2027-06-01T09:00:00.000Z", "2027-06-01T10:00:00.000Z", "2027-06-01T11:00:00.000Z"]);
    expect(await bookableSlot(db, calendar, "UTC", now, ten)).not.toBeNull();
    expect(await moveSlots(db, calendar, "UTC", now, moving)).toHaveLength(2);
    expect(await movableSlot(db, calendar, "UTC", now, moving, ten)).not.toBeNull();

    listClosedDaysFromMock.mockResolvedValue(closedTuesday);
    expect(await computeAllSlots(db, calendar, "UTC", now)).toEqual([]);
    expect(await bookableSlot(db, calendar, "UTC", now, ten)).toBeNull();
    expect(await moveSlots(db, calendar, "UTC", now, moving)).toEqual([]);
    expect(await movableSlot(db, calendar, "UTC", now, moving, ten)).toBeNull();
  });

  it("a storm row reaches the result through slotClosures (an open-ended storm offers nothing)", async () => {
    getBusinessStatusRowMock.mockResolvedValue({
      account_id: "a1", state: "storm", late_minutes: null, until: null, set_by: "user_1", set_at: "2027-05-31T12:00:00.000Z",
    });
    expect(await computeAllSlots(db, calendar, "UTC", now)).toEqual([]);
  });

  it("the closures read and the bookings read start together, not one after the other (mutation: await them in turn → FAILS)", async () => {
    for (const [name, run] of Object.entries(four)) {
      let release!: (v: unknown[]) => void;
      listBookedRangesMock.mockReset().mockImplementation(() => new Promise((r) => { release = r; }));
      getBusinessStatusRowMock.mockClear(); listClosedDaysFromMock.mockClear();
      const pending = run(calendar);
      await Promise.resolve(); await Promise.resolve();
      expect(listBookedRangesMock, name).toHaveBeenCalledTimes(1);
      expect(getBusinessStatusRowMock, name).toHaveBeenCalledTimes(1);
      expect(listClosedDaysFromMock, name).toHaveBeenCalledTimes(1);
      release([]);
      await pending;
    }
  });
});
