import { describe, it, expect, vi } from "vitest";

const listBookedRangesMock = vi.fn();
vi.mock("@bis/db", async (importOriginal) => {
  const real = await importOriginal<object>();
  return { ...real, listBookedRanges: (...a: unknown[]) => listBookedRangesMock(...a) };
});

import { computeAllSlots } from "./availability";

const calendar = {
  id: "cal1", account_id: "a1", public_id: "p1", enabled: true,
  slot_duration_minutes: 60, buffer_minutes: 0, min_notice_hours: 0,
  max_advance_days: 2, open_hours: { tue: [["09:00", "12:00"]] }, notify_emails: [],
} as any;

describe("computeAllSlots", () => {
  it("returns Date ranges for open hours minus booked ranges", async () => {
    // Tue 2027-06-01, zone UTC for a deterministic test
    listBookedRangesMock.mockResolvedValue([
      { starts_at: "2027-06-01T09:00:00.000Z", ends_at: "2027-06-01T10:00:00.000Z" },
    ]);
    const now = new Date("2027-06-01T00:00:00Z");
    const slots = await computeAllSlots({} as any, calendar, "UTC", now);
    const starts = slots.map((s) => s.startsAt.toISOString());
    expect(starts).toContain("2027-06-01T10:00:00.000Z");
    expect(starts).toContain("2027-06-01T11:00:00.000Z");
    expect(starts).not.toContain("2027-06-01T09:00:00.000Z"); // booked
    expect(slots[0]!.startsAt).toBeInstanceOf(Date);
  });
});
