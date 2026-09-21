import { describe, it, expect } from "vitest";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { getOrCreateCalendar, createBooking, setBookingStatus, getDueReminderById, getDueFollowupById, stampReminderSent } from "../booking";
import { upsertAutomation, getDueSmsReminderById, getDueReviewRequestById, getDueNoShowNudgeById } from "../automations";

/**
 * Each lookup answers "is this still a thing to send" WITHOUT a time window
 * — the release step owns "when". Three answers per lookup: the row, `gone`,
 * `off`. Live, because the predicates are PostgREST filters and a mocked db
 * cannot tell `.eq("status","booked")` from `.eq("status","completed")`.
 */
async function seed(db: Parameters<typeof createContact>[0], accountId: string) {
  const cal = await getOrCreateCalendar(db, accountId, "user_test");
  const { id: contactId } = await createContact(db, accountId,
    { firstName: "Due", email: "due@example.com", phone: "(956) 555-0199" }, "user_test");
  const { id: bookingId } = await createBooking(db, accountId,
    { calendarId: cal.id, contactId, startsAt: new Date("2027-03-05T15:00:00Z"), endsAt: new Date("2027-03-05T16:00:00Z") },
    "user_test");
  return { cal, contactId, bookingId };
}

describe("getDueReminderById", () => {
  it("returns the row for a booked, unstamped booking; `gone` once stamped or cancelled; `contactId` filled", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId, contactId } = await seed(db, accountId);
      const found = await getDueReminderById(db, bookingId);
      expect(found.due?.bookingId).toBe(bookingId);
      expect(found.due?.contactId).toBe(contactId);
      await stampReminderSent(db, bookingId);
      expect(await getDueReminderById(db, bookingId)).toEqual({ due: null, why: "gone" });
      expect(await getDueReminderById(db, "00000000-0000-0000-0000-000000000000")).toEqual({ due: null, why: "gone" });
    });
  });
});

describe("getDueFollowupById", () => {
  it("`off` while the calendar's follow-ups are disabled; the row once enabled (mutation: drop the followup_enabled check → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { cal, bookingId } = await seed(db, accountId);
      // getOrCreateCalendar's default has follow-ups OFF — read it rather than assume.
      const { data: c } = await db.from("calendars").select("followup_enabled").eq("id", cal.id).single();
      if ((c as { followup_enabled: boolean }).followup_enabled) {
        await db.from("calendars").update({ followup_enabled: false }).eq("id", cal.id);
      }
      expect(await getDueFollowupById(db, bookingId)).toEqual({ due: null, why: "off" });
      await db.from("calendars").update({ followup_enabled: true }).eq("id", cal.id);
      expect((await getDueFollowupById(db, bookingId)).due?.bookingId).toBe(bookingId);
    });
  });
});

describe("the recipe lookups: `off` until the recipe is on, `gone` in the wrong status", () => {
  it("sms reminder", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await seed(db, accountId);
      expect(await getDueSmsReminderById(db, bookingId)).toEqual({ due: null, why: "off" });
      await upsertAutomation(db, accountId, "sms_reminder", { enabled: true, body: "", config: {} }, "user_test");
      expect((await getDueSmsReminderById(db, bookingId)).due?.bookingId).toBe(bookingId);
      await setBookingStatus(db, accountId, bookingId, "cancelled", "user_test");
      expect(await getDueSmsReminderById(db, bookingId)).toEqual({ due: null, why: "gone" });
    });
  });

  it("review request needs status completed", async () => {
    await withTestAccount(async (db, accountId) => {
      const { bookingId } = await seed(db, accountId);
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      expect(await getDueReviewRequestById(db, bookingId)).toEqual({ due: null, why: "gone" });   // still booked
      await setBookingStatus(db, accountId, bookingId, "completed", "user_test");
      const found = await getDueReviewRequestById(db, bookingId);
      expect(found.due?.bookingId).toBe(bookingId);
      expect(found.due?.config).toEqual({ channel: "email", reviewUrl: "https://g.page/r/x/review" });
    });
  });

  it("no-show nudge needs status no_show and carries the calendar's public id", async () => {
    await withTestAccount(async (db, accountId) => {
      const { cal, bookingId } = await seed(db, accountId);
      await upsertAutomation(db, accountId, "no_show_nudge", { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      await setBookingStatus(db, accountId, bookingId, "no_show", "user_test");
      const found = await getDueNoShowNudgeById(db, bookingId);
      expect(found.due?.calendarPublicId).toBe(cal.public_id);
    });
  });
});
