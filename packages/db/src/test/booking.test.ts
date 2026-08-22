import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import {
  getOrCreateCalendar, getCalendarByPublicId, updateCalendarSettings,
  createBooking, cancelBookingByToken, setBookingStatus,
  listBookedRanges, listUpcomingBookings, listDueReminders, stampReminderSent,
  SlotTakenError,
} from "../booking";

describe("booking accessors", () => {
  it("creates the calendar lazily, once, disabled, with a public id", async () => {
    await withTestAccount(async (db, accountId) => {
      const a = await getOrCreateCalendar(db, accountId, "user_test");
      const b = await getOrCreateCalendar(db, accountId, "user_test");
      expect(a.id).toBe(b.id);
      expect(a.enabled).toBe(false);
      expect(a.public_id).toMatch(/^[a-z2-9]{12}$/);
      const { data: ev } = await db.from("events").select("type")
        .eq("account_id", accountId).eq("type", "calendar.created");
      expect(ev).toHaveLength(1);
    });
  });

  it("updateCalendarSettings leaves omitted fields alone and throws on no match", async () => {
    await withTestAccount(async (db, accountId) => {
      await getOrCreateCalendar(db, accountId, "user_test");
      await updateCalendarSettings(db, accountId,
        { enabled: true, openHours: { mon: [["09:00", "17:00"]] } }, "user_test");
      await updateCalendarSettings(db, accountId, { slotDurationMinutes: 30 }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      expect(cal.enabled).toBe(true);                       // untouched by 2nd patch
      expect(cal.open_hours).toEqual({ mon: [["09:00", "17:00"]] });
      expect(cal.slot_duration_minutes).toBe(30);
      await expect(
        updateCalendarSettings(db, "00000000-0000-0000-0000-000000000000", { enabled: true }, "u"),
      ).rejects.toThrow(/no calendar/);
    });
  });

  /**
   * THE constraint test. Two bookings for overlapping ranges on one calendar:
   * the second insert must throw SlotTakenError, and the error must originate
   * from bookings_no_overlap — the database, not an app check.
   */
  it("refuses an overlapping booking with SlotTakenError, and frees the range on cancel", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Booker", email: "booker@example.com" }, "user_test");
      const t0 = new Date("2027-03-02T15:00:00Z");
      const t1 = new Date("2027-03-02T16:00:00Z");
      const first = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: t0, endsAt: t1 }, "user_test");
      await expect(createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-02T15:30:00Z"),
          endsAt: new Date("2027-03-02T16:30:00Z") }, "user_test"),
      ).rejects.toThrow(SlotTakenError);
      // Cancel frees the range — the constraint binds status='booked' only.
      const cancelled = await cancelBookingByToken(db, first.cancelToken);
      expect(cancelled?.id).toBe(first.id);
      await expect(createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: t0, endsAt: t1 }, "user_test"),
      ).resolves.toBeTruthy();
      // A second cancel with the same token is a null no-op, not an error.
      expect(await cancelBookingByToken(db, first.cancelToken)).toBeNull();
    });
  });

  it("reminder window: due exactly once, stamped after send", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Due", email: "due@example.com" }, "user_test");
      const now = new Date("2027-03-01T12:00:00Z");
      const inWindow = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-02T11:30:00Z"),   // 23.5h ahead — inside [23h, 24h15m]
          endsAt: new Date("2027-03-02T12:30:00Z") }, "user_test");
      await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-04T12:00:00Z"),   // far outside
          endsAt: new Date("2027-03-04T13:00:00Z") }, "user_test");
      const due = await listDueReminders(db, now.toISOString());
      expect(due.map((d) => d.bookingId)).toEqual([inWindow.id]);
      await stampReminderSent(db, inWindow.id);
      expect(await listDueReminders(db, now.toISOString())).toEqual([]);
    });
  });
});
