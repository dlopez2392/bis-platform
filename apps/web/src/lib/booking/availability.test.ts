import { describe, it, expect, vi } from "vitest";

const listBookedRangesMock = vi.fn();
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<object>();
  return { ...real, listBookedRanges: (...a: unknown[]) => listBookedRangesMock(...a) };
});

import type { CalendarRow, serviceDb } from "@bis/db";
import { computeAllSlots, moveSlots, movableSlot } from "./availability";

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
