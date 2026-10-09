import { describe, it, expect, vi, beforeEach } from "vitest";

const { rows, chainMock, brandingMock } = vi.hoisted(() => ({
  rows: { booking: null as unknown, calendar: null as unknown, account: null as unknown },
  chainMock: vi.fn(),
  brandingMock: vi.fn(),
}));

/** One fake `serviceDb()`: each table answers its own row, and records the
 *  column it was filtered on, so a test can see WHAT a read was keyed by. */
const filters: Record<string, [string, unknown][]> = {};
const fakeDb = {
  from: (table: string) => {
    const q = {
      select: () => q,
      eq: (col: string, val: unknown) => { (filters[table] ??= []).push([col, val]); return q; },
      maybeSingle: async () => ({
        data: table === "bookings" ? rows.booking : table === "calendars" ? rows.calendar : rows.account,
        error: null,
      }),
    };
    return q;
  },
};
vi.mock("@bis/db", () => ({
  serviceDb: () => fakeDb,
  rescheduleChain: chainMock,
  getBranding: brandingMock,
  brandDisplayName: (b: { brandName: string | null }) => b.brandName?.trim() || "",
}));

import { loadCalendarFileInput } from "./data";

const BOOKING = {
  id: "b-2", account_id: "acct-1", calendar_id: "cal-1", status: "booked", cancel_token: "tok",
  starts_at: "2026-11-01T14:00:00Z", ends_at: "2026-11-01T15:00:00Z", meeting_url: null,
};

beforeEach(() => {
  for (const k of Object.keys(filters)) delete filters[k];
  rows.booking = BOOKING;
  rows.calendar = { public_id: "realpub" };
  rows.account = { timezone: "America/Chicago" };
  chainMock.mockReset().mockResolvedValue({ rootId: "b-1", depth: 1 });
  brandingMock.mockReset().mockResolvedValue({ brandName: "  Rio Roofing " });
});

describe("loadCalendarFileInput", () => {
  it("is null for an unknown token, reading nothing else", async () => {
    rows.booking = null;
    expect(await loadCalendarFileInput("tok")).toBeNull();
    expect(filters.calendars).toBeUndefined();
    expect(chainMock).not.toHaveBeenCalled();
  });

  it("is null for a booking that is not live, before reading the chain or the brand", async () => {
    rows.booking = { ...BOOKING, status: "cancelled" };
    expect(await loadCalendarFileInput("tok")).toBeNull();
    expect(chainMock).not.toHaveBeenCalled();
    expect(brandingMock).not.toHaveBeenCalled();
  });

  it("keys every read by the ROW, never the URL: the calendar's own public id, the row's account (mutation: key the calendar read by anything but the row's calendar_id → FAILS)", async () => {
    const input = await loadCalendarFileInput("tok");
    expect(filters.bookings).toEqual([["cancel_token", "tok"]]);
    expect(filters.calendars).toEqual([["id", "cal-1"]]);
    expect(filters.accounts).toEqual([["id", "acct-1"]]);
    expect(chainMock).toHaveBeenCalledWith(fakeDb, "acct-1", "b-2");
    expect(brandingMock).toHaveBeenCalledWith(fakeDb, "acct-1");
    expect(input).toEqual({
      booking: BOOKING,
      chain: { rootId: "b-1", depth: 1 },
      publicId: "realpub",
      brandName: "Rio Roofing",
      accountZone: "America/Chicago",
    });
  });

  it("an account with no zone reads UTC rather than throwing", async () => {
    rows.account = { timezone: null };
    expect((await loadCalendarFileInput("tok"))?.accountZone).toBe("UTC");
  });
});
