import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { setBranding } from "../branding";
import { createForm, createSubmission } from "../forms";
import {
  getOrCreateCalendar, createBooking, setBookingStatus, cancelBookingByToken,
  stampFollowupSent, updateCalendarSettings,
} from "../booking";
import {
  parseReviewRequestConfig, getAutomation, upsertAutomation,
  listDueReviewRequests, stampReviewRequested, stampReviewRequestSmsFailed, countReviewRequestsSince,
  REVIEW_REQUEST_MAX_AGE_MS,
  parseNoShowNudgeConfig, listDueNoShowNudges, stampNoShowNudged, stampNoShowNudgeSmsFailed,
  countNoShowNudgesSince, NO_SHOW_NUDGE_MAX_AGE_MS,
  listDueSmsReminders, stampSmsReminderSent, stampSmsReminderFailed,
  SMS_REMINDER_WINDOW_START_MS, SMS_REMINDER_WINDOW_END_MS,
  parseInstantReplyConfig, stampInstantReplySent, countInstantRepliesSince,
  listDueAppointmentConfirms, getDueAppointmentConfirmById,
  stampAppointmentConfirmAsked, stampAppointmentConfirmSmsFailed,
  matchConfirmationReply, applyConfirmationReply,
  APPOINTMENT_CONFIRM_WINDOW_START_MS, APPOINTMENT_CONFIRM_WINDOW_END_MS,
  APPOINTMENT_CONFIRM_MIN_LEAD_MS,
  parseReferralAskConfig, listDueReferralAsks, getDueReferralAskById,
  stampReferralAsked, stampReferralAskSmsFailed, countReferralAsksSince,
  REFERRAL_ASK_MAX_AGE_MS,
} from "../automations";

const HOUR = 60 * 60 * 1000;

describe("parseReviewRequestConfig — jsonb is untrusted on read AND write", () => {
  it("accepts exactly a channel and an http(s) url", () => {
    expect(parseReviewRequestConfig({ channel: "sms", reviewUrl: "https://g.page/r/abc/review" }))
      .toEqual({ channel: "sms", reviewUrl: "https://g.page/r/abc/review" });
    expect(parseReviewRequestConfig({ channel: "email", reviewUrl: " http://example.com/review " }))
      .toEqual({ channel: "email", reviewUrl: "http://example.com/review" });
  });

  it("stores the NORMALISED href, so a link with a space or a bare origin is still clickable in an SMS", () => {
    expect(parseReviewRequestConfig({ channel: "sms", reviewUrl: "https://x.example/a b" }))
      .toEqual({ channel: "sms", reviewUrl: "https://x.example/a%20b" });
    expect(parseReviewRequestConfig({ channel: "sms", reviewUrl: "https://x.example" }))
      .toEqual({ channel: "sms", reviewUrl: "https://x.example/" });
  });

  it("returns null for every shape the pass must treat as missing", () => {
    for (const bad of [
      null, undefined, "str", 42, [],
      {}, { channel: "sms" }, { reviewUrl: "https://x.example" },
      { channel: "fax", reviewUrl: "https://x.example" },
      { channel: "sms", reviewUrl: "" }, { channel: "sms", reviewUrl: "   " },
      { channel: "sms", reviewUrl: 7 }, { channel: "sms", reviewUrl: "not a url" },
      { channel: "sms", reviewUrl: "javascript:alert(1)" },
      { channel: "sms", reviewUrl: "ftp://x.example/review" },
      { channel: "sms", reviewUrl: `https://x.example/${"a".repeat(2100)}` },
    ]) {
      expect(parseReviewRequestConfig(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("automations accessors", () => {
  it("getAutomation is null until the first save; upsert is insert-then-update on ONE row", async () => {
    await withTestAccount(async (db, accountId) => {
      expect(await getAutomation(db, accountId, "review_request")).toBeNull();
      const first = await upsertAutomation(db, accountId, "review_request",
        { enabled: false, body: "", config: { channel: "email", reviewUrl: "" } }, "user_test");
      expect(first.enabled).toBe(false);
      const second = await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "Please review us", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
        "user_test");
      expect(second.id).toBe(first.id);
      expect(second.enabled).toBe(true);
      expect(second.body).toBe("Please review us");
      expect(second.config).toEqual({ channel: "sms", reviewUrl: "https://g.page/r/x/review" });
      const { data: ev } = await db.from("events").select("type, payload")
        .eq("account_id", accountId).eq("type", "automation.updated");
      expect(ev).toHaveLength(2);
    });
  });

  it("listDueReviewRequests: enabled account, completed booking inside 61h → due, with brandName never accounts.name", async () => {
    await withTestAccount(async (db, accountId) => {
      // The fixture account is named "Fixture Co"; the customer-facing name is
      // the brand name, and the due row must carry ONLY that.
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "Loved working with you?", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } },
        "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Rev", email: "rev@example.com", phone: "(956) 555-0101" }, "user_test");

      const now = new Date("2027-03-10T12:00:00Z");
      const mk = (endsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(endsAt.getTime() - 30 * 60 * 1000), endsAt },
        "user_test");

      const due = await mk(new Date("2027-03-10T10:00:00Z"));          // ended 2h ago
      await setBookingStatus(db, accountId, due.id, "completed", "user_test");
      const stillBooked = await mk(new Date("2027-03-10T09:00:00Z"));  // completed status never set
      const stamped = await mk(new Date("2027-03-10T08:00:00Z"));
      await setBookingStatus(db, accountId, stamped.id, "completed", "user_test");
      await stampReviewRequested(db, stamped.id);
      const tooOld = await mk(new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS - HOUR));   // 62h ago
      await setBookingStatus(db, accountId, tooOld.id, "completed", "user_test");
      const oldButInside = await mk(new Date(now.getTime() - REVIEW_REQUEST_MAX_AGE_MS + HOUR)); // 60h ago
      await setBookingStatus(db, accountId, oldButInside.id, "completed", "user_test");
      await stampFollowupSent(db, oldButInside.id);
      const cancelled = await mk(new Date("2027-03-10T07:00:00Z"));
      await cancelBookingByToken(db, cancelled.cancelToken);

      const list = await listDueReviewRequests(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(due.id);
      expect(ids).toContain(oldButInside.id);
      expect(ids).not.toContain(stillBooked.id);
      expect(ids).not.toContain(stamped.id);
      expect(ids).not.toContain(tooOld.id);
      expect(ids).not.toContain(cancelled.id);

      const row = list.find((r) => r.bookingId === due.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row.contactEmail).toBe("rev@example.com");
      expect(row.contactPhone).toBe("(956) 555-0101");   // raw; the pass normalises
      expect(row.contactId).toBe(contactId);
      expect(new Date(row.endsAt).getTime()).toBe(new Date("2027-03-10T10:00:00Z").getTime());
      expect(row.followupSentAt).toBeNull();
      expect(row.body).toBe("Loved working with you?");
      expect(row.config).toEqual({ channel: "sms", reviewUrl: "https://g.page/r/x/review" });
      expect(typeof row.accountTimezone).toBe("string");
      expect(row.fromEmail).toBeNull();
      expect(row.replyToEmail).toBeNull();

      const deferred = list.find((r) => r.bookingId === oldButInside.id)!;
      expect(deferred.followupSentAt).not.toBeNull();     // the collision input, carried through
    });
  });

  it("listDueReviewRequests: a disabled row yields nothing; an invalid stored config yields the row with config null", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Rev" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-10T09:30:00Z"), endsAt: new Date("2027-03-10T10:00:00Z") },
        "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      const now = "2027-03-10T12:00:00Z";

      await upsertAutomation(db, accountId, "review_request",
        { enabled: false, body: "", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      expect((await listDueReviewRequests(db, now)).map((r) => r.bookingId)).not.toContain(b.id);

      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "sms", reviewUrl: "javascript:alert(1)" } }, "user_test");
      const rows = await listDueReviewRequests(db, now);
      const row = rows.find((r) => r.bookingId === b.id)!;
      expect(row.config).toBeNull();
      expect(row.contactEmail).toBeNull();
      expect(row.contactPhone).toBeNull();
    });
  });

  it("stampReviewRequested is idempotent, and countReviewRequestsSince counts only stamps after the floor", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Rev" }, "user_test");
      const mk = (h: number) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(`2027-03-10T${String(h).padStart(2, "0")}:00:00Z`),
          endsAt: new Date(`2027-03-10T${String(h).padStart(2, "0")}:30:00Z`) }, "user_test");
      const a = await mk(8); const b = await mk(9); const c = await mk(10);
      const before = new Date();
      await stampReviewRequested(db, a.id);
      await stampReviewRequested(db, a.id);
      await stampReviewRequested(db, b.id);
      void c;
      expect(await countReviewRequestsSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(2);
      expect(await countReviewRequestsSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
    });
  });
});

const MINUTE = 60 * 1000;

/**
 * Anchor tests use a FAKE `now` in 2027 (like the tests above) and write the
 * clock columns directly: setBookingStatus stamps REAL time, which sits six
 * months outside a 2027 window and would prove nothing here. The stamping
 * itself is proven in booking.test.ts. Bookings are spaced ≥1h apart because
 * `bookings_no_overlap` binds while status is 'booked'.
 */
describe("listDueReviewRequests — the completion anchor (0026)", () => {
  it("matches on EITHER ends_at or completed_at inside 61h, and projects both anchors plus the sms attempt marker", async () => {
    await withTestAccount(async (db, accountId) => {
      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "sms", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Anchor", phone: "9565550101" }, "user_test");
      const now = new Date("2027-03-10T12:00:00Z");
      const mk = (endsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(endsAt.getTime() - 30 * MINUTE), endsAt }, "user_test");
      const clock = (id: string, patch: Record<string, string | null>) =>
        db.from("bookings").update({ status: "completed", ...patch }).eq("id", id).then(({ error }) => {
          if (error) throw new Error(error.message);
        });

      // The batch-Friday case: ended 9 days ago, marked completed an hour ago.
      const batchMarked = await mk(new Date(now.getTime() - 9 * 24 * HOUR));
      await clock(batchMarked.id, { completed_at: new Date(now.getTime() - HOUR).toISOString() });
      // Ended 2h ago, completed 1h ago — inside by both anchors.
      const fresh = await mk(new Date(now.getTime() - 2 * HOUR));
      await clock(fresh.id, { completed_at: new Date(now.getTime() - HOUR).toISOString(),
                              review_request_sms_failed_at: now.toISOString() });
      // A pre-0026 row: completed, completed_at NULL — due by ends_at alone.
      const legacy = await mk(new Date(now.getTime() - 4 * HOUR));
      await clock(legacy.id, { completed_at: null });
      // Ended AND completed 9 days ago: outside by both anchors.
      const stale = await mk(new Date(now.getTime() - 9 * 24 * HOUR - 2 * HOUR));
      await clock(stale.id, { completed_at: new Date(now.getTime() - 9 * 24 * HOUR).toISOString() });

      const list = await listDueReviewRequests(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(batchMarked.id);   // Mutation: drop completed_at from the .or() window
      expect(ids).toContain(fresh.id);
      expect(ids).toContain(legacy.id);        // Mutation: drop ends_at from the .or() window
      expect(ids).not.toContain(stale.id);

      const marked = list.find((r) => r.bookingId === batchMarked.id)!;
      expect(new Date(marked.completedAt!).getTime()).toBe(now.getTime() - HOUR);
      expect(marked.smsFailedAt).toBeNull();
      expect(list.find((r) => r.bookingId === legacy.id)!.completedAt).toBeNull();
      expect(new Date(list.find((r) => r.bookingId === fresh.id)!.smsFailedAt!).getTime()).toBe(now.getTime());  // Mutation: drop the projection
    });
  });

  it("stampReviewRequestSmsFailed writes the attempt marker and never the dedupe stamp", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Fail" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-10T09:00:00Z"), endsAt: new Date("2027-03-10T09:30:00Z") }, "user_test");
      const before = Date.now() - 1000;
      await stampReviewRequestSmsFailed(db, b.id);
      const { data } = await db.from("bookings")
        .select("review_requested_at, review_request_sms_failed_at").eq("id", b.id).single();
      const row = data as { review_requested_at: string | null; review_request_sms_failed_at: string | null };
      expect(row.review_requested_at).toBeNull();
      expect(new Date(row.review_request_sms_failed_at!).getTime()).toBeGreaterThanOrEqual(before);
    });
  });
});

describe("no-show nudge — data layer", () => {
  it("parseNoShowNudgeConfig accepts exactly a channel; everything else is null", () => {
    expect(parseNoShowNudgeConfig({ channel: "sms" })).toEqual({ channel: "sms" });
    expect(parseNoShowNudgeConfig({ channel: "email", extra: 1 })).toEqual({ channel: "email" });
    for (const bad of [null, undefined, "sms", 42, [], {}, { channel: "fax" }, { channel: 1 }]) {
      expect(parseNoShowNudgeConfig(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("is exactly the follow-up window: same derivation, nothing to defer to", () => {
    expect(NO_SHOW_NUDGE_MAX_AGE_MS).toBe(37 * HOUR);
  });

  it("listDueNoShowNudges: enabled account, no_show inside 37h by EITHER anchor → due, with brandName never accounts.name", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Miss", email: "miss@example.com", phone: "(956) 555-0102" }, "user_test");
      const now = new Date("2027-03-10T12:00:00Z");
      const mk = (endsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(endsAt.getTime() - 30 * MINUTE), endsAt }, "user_test");
      const clock = (id: string, patch: Record<string, string | null>) =>
        db.from("bookings").update({ status: "no_show", ...patch }).eq("id", id).then(({ error }) => {
          if (error) throw new Error(error.message);
        });

      const due = await mk(new Date(now.getTime() - 2 * HOUR));
      await clock(due.id, { no_show_at: new Date(now.getTime() - 90 * MINUTE).toISOString() });
      // OFF: nothing is due while the recipe is disabled (a missing row is off).
      expect((await listDueNoShowNudges(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(due.id);

      await upsertAutomation(db, accountId, "no_show_nudge",
        { enabled: true, body: "Come back!", config: { channel: "sms" } }, "user_test");
      const batchMarked = await mk(new Date(now.getTime() - 5 * 24 * HOUR));          // ended 5 days ago, marked 1h ago
      await clock(batchMarked.id, { no_show_at: new Date(now.getTime() - HOUR).toISOString() });
      const stillBooked = await mk(new Date(now.getTime() - 3 * HOUR));
      const completed = await mk(new Date(now.getTime() - 4 * HOUR));
      await setBookingStatus(db, accountId, completed.id, "completed", "user_test");
      const nudged = await mk(new Date(now.getTime() - 6 * HOUR));
      await clock(nudged.id, { no_show_at: new Date(now.getTime() - 5 * HOUR).toISOString() });
      await stampNoShowNudged(db, nudged.id);
      const stale = await mk(new Date(now.getTime() - 40 * HOUR));                      // ended AND marked 40h ago
      await clock(stale.id, { no_show_at: new Date(now.getTime() - 40 * HOUR).toISOString() });
      const legacy = await mk(new Date(now.getTime() - 8 * HOUR));                      // pre-0026: no_show_at null
      await clock(legacy.id, { no_show_at: null });

      const list = await listDueNoShowNudges(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(due.id);
      expect(ids).toContain(batchMarked.id);   // Mutation: drop no_show_at from the window
      expect(ids).toContain(legacy.id);        // Mutation: drop ends_at from the window
      expect(ids).not.toContain(stillBooked.id);
      expect(ids).not.toContain(completed.id);
      expect(ids).not.toContain(nudged.id);
      expect(ids).not.toContain(stale.id);

      const row = list.find((r) => r.bookingId === due.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(new Date(row.noShowAt!).getTime()).toBe(now.getTime() - 90 * MINUTE);
      expect(row.smsFailedAt).toBeNull();
      expect(row.calendarPublicId).toBe(cal.public_id);
      expect(row.calendarEnabled).toBe(false);            // the lazily created calendar starts disabled
      expect(row.contactId).toBe(contactId);
      expect(row.contactEmail).toBe("miss@example.com");
      expect(row.contactPhone).toBe("(956) 555-0102");    // raw; the pass normalises
      expect(typeof row.accountTimezone).toBe("string");
      expect(row.fromEmail).toBeNull();
      expect(row.replyToEmail).toBeNull();
      expect(row.body).toBe("Come back!");
      expect(row.config).toEqual({ channel: "sms" });
      expect(list.find((r) => r.bookingId === legacy.id)!.noShowAt).toBeNull();

      // The public page's switch is projected live, not cached.
      await updateCalendarSettings(db, accountId, { enabled: true }, "user_test");
      expect((await listDueNoShowNudges(db, now.toISOString())).find((r) => r.bookingId === due.id)!.calendarEnabled).toBe(true);
    });
  });

  it("an invalid stored config yields the row with config null", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Cfg" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-10T09:30:00Z"), endsAt: new Date("2027-03-10T10:00:00Z") }, "user_test");
      await setBookingStatus(db, accountId, b.id, "no_show", "user_test");
      await upsertAutomation(db, accountId, "no_show_nudge", { enabled: true, body: "", config: { channel: "fax" } }, "user_test");
      const row = (await listDueNoShowNudges(db, "2027-03-10T12:00:00Z")).find((r) => r.bookingId === b.id)!;
      expect(row.config).toBeNull();
      expect(row.contactEmail).toBeNull();
      expect(row.contactPhone).toBeNull();
    });
  });

  it("stampNoShowNudged / stampNoShowNudgeSmsFailed write their own columns; countNoShowNudgesSince counts only the dedupe stamp", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Stamp" }, "user_test");
      const mk = (h: number) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(`2027-03-10T${String(h).padStart(2, "0")}:00:00Z`),
          endsAt: new Date(`2027-03-10T${String(h).padStart(2, "0")}:30:00Z`) }, "user_test");
      const a = await mk(8); const b = await mk(9); const c = await mk(10);
      const before = new Date();
      await stampNoShowNudged(db, a.id);
      await stampNoShowNudged(db, a.id);                // idempotent
      await stampNoShowNudged(db, b.id);
      await stampNoShowNudgeSmsFailed(db, c.id);        // an ATTEMPT, not a send: must not count
      const { data } = await db.from("bookings")
        .select("no_show_nudged_at, no_show_nudge_sms_failed_at").eq("id", c.id).single();
      expect((data as { no_show_nudged_at: string | null }).no_show_nudged_at).toBeNull();
      expect((data as { no_show_nudge_sms_failed_at: string | null }).no_show_nudge_sms_failed_at).not.toBeNull();
      expect(await countNoShowNudgesSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(2);
      expect(await countNoShowNudgesSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
    });
  });
});

describe("sms reminder — data layer", () => {
  it("the window is 90 to 135 minutes ahead, 45 minutes wide", () => {
    expect(SMS_REMINDER_WINDOW_START_MS).toBe(90 * MINUTE);
    expect(SMS_REMINDER_WINDOW_END_MS).toBe(135 * MINUTE);
  });

  it("listDueSmsReminders: enabled account, booked, starting 1h30m–2h15m from now, unstamped → due; edges inclusive", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Soon", phone: "(956) 555-0103" }, "user_test");
      const now = new Date("2027-03-10T12:00:00Z");
      const mk = (startsAt: Date, bookerTimezone?: string) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + MINUTE), bookerTimezone }, "user_test");  // 1 min long: bookings_no_overlap binds adjacent booked rows

      const inside = await mk(new Date(now.getTime() + 2 * HOUR), "America/Los_Angeles");
      // OFF: nothing is due while the recipe is disabled.
      expect((await listDueSmsReminders(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(inside.id);

      await upsertAutomation(db, accountId, "sms_reminder", { enabled: true, body: "See you soon!", config: {} }, "user_test");
      const lowerEdge = await mk(new Date(now.getTime() + SMS_REMINDER_WINDOW_START_MS));
      const upperEdge = await mk(new Date(now.getTime() + SMS_REMINDER_WINDOW_END_MS));
      const tooSoon = await mk(new Date(now.getTime() + SMS_REMINDER_WINDOW_START_MS - MINUTE));   // 1h29m: was never inside
      const tooFar = await mk(new Date(now.getTime() + SMS_REMINDER_WINDOW_END_MS + MINUTE));      // 2h16m: next tick's business
      const stamped = await mk(new Date(now.getTime() + 2 * HOUR + 5 * MINUTE));
      await stampSmsReminderSent(db, stamped.id);
      const cancelled = await mk(new Date(now.getTime() + 2 * HOUR + 10 * MINUTE));
      await cancelBookingByToken(db, cancelled.cancelToken);
      await db.from("bookings").update({ sms_reminder_failed_at: now.toISOString() }).eq("id", lowerEdge.id);

      const list = await listDueSmsReminders(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(inside.id);
      expect(ids).toContain(lowerEdge.id);
      expect(ids).toContain(upperEdge.id);
      expect(ids).not.toContain(tooSoon.id);     // Mutation: widen the start to 60 minutes
      expect(ids).not.toContain(tooFar.id);      // Mutation: widen the end to 3h
      expect(ids).not.toContain(stamped.id);
      expect(ids).not.toContain(cancelled.id);

      const row = list.find((r) => r.bookingId === inside.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row).not.toHaveProperty("contactEmail");           // SMS only: the row cannot carry an address it must not use
      expect(new Date(row.startsAt).getTime()).toBe(now.getTime() + 2 * HOUR);
      expect(row.bookerTimezone).toBe("America/Los_Angeles");
      expect(row.contactId).toBe(contactId);
      expect(row.contactPhone).toBe("(956) 555-0103");
      expect(typeof row.accountTimezone).toBe("string");
      expect(row.body).toBe("See you soon!");
      expect(row.smsFailedAt).toBeNull();
      expect(new Date(list.find((r) => r.bookingId === lowerEdge.id)!.smsFailedAt!).getTime()).toBe(now.getTime());  // Mutation: drop the projection
    });
  });

  it("stampSmsReminderSent / stampSmsReminderFailed write their own columns, idempotently", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Stamp" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-10T15:00:00Z"), endsAt: new Date("2027-03-10T15:30:00Z") }, "user_test");
      await stampSmsReminderFailed(db, b.id);
      await stampSmsReminderSent(db, b.id);
      await stampSmsReminderSent(db, b.id);
      const { data } = await db.from("bookings")
        .select("sms_reminder_sent_at, sms_reminder_failed_at, reminder_sent_at").eq("id", b.id).single();
      const row = data as { sms_reminder_sent_at: string | null; sms_reminder_failed_at: string | null; reminder_sent_at: string | null };
      expect(row.sms_reminder_sent_at).not.toBeNull();
      expect(row.sms_reminder_failed_at).not.toBeNull();
      expect(row.reminder_sent_at).toBeNull();          // the EMAIL reminder's stamp is a different column
    });
  });
});

describe("instant reply — data layer (Milestone C, the inline recipe)", () => {
  it("parseInstantReplyConfig accepts exactly a string bodyEs; everything else is null", () => {
    // Mutation: return { bodyEs: String(bodyEs) } and the non-string cases pass.
    expect(parseInstantReplyConfig({ bodyEs: "Hola" })).toEqual({ bodyEs: "Hola" });
    expect(parseInstantReplyConfig({ bodyEs: "" })).toEqual({ bodyEs: "" });
    expect(parseInstantReplyConfig({ bodyEs: "Hola", extra: 1 })).toEqual({ bodyEs: "Hola" });
    for (const bad of [null, undefined, "Hola", 7, [], {}, { bodyEs: null }, { bodyEs: 3 }, { bodyEs: ["x"] }]) {
      expect(parseInstantReplyConfig(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it("stampInstantReplySent writes the stamp idempotently; countInstantRepliesSince counts only stamps after the floor", async () => {
    await withTestAccount(async (db, accountId) => {
      const { id: formId } = await createForm(db, accountId, { name: "Quote", fields: [] }, "user_test");
      const mk = () => createSubmission(db, accountId, formId, { answers: [] });
      const a = await mk(); const b = await mk(); const c = await mk();
      const before = new Date();
      await stampInstantReplySent(db, a.id);
      await stampInstantReplySent(db, a.id);
      await stampInstantReplySent(db, b.id);
      void c;
      const { data } = await db.from("form_submissions").select("id, instant_reply_sent_at")
        .eq("account_id", accountId);
      const rows = data as { id: string; instant_reply_sent_at: string | null }[];
      expect(rows.filter((r) => r.instant_reply_sent_at).map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
      expect(rows.find((r) => r.id === c.id)!.instant_reply_sent_at).toBeNull();
      // Mutation: drop `.gte(...)` and the future floor counts 2.
      expect(await countInstantRepliesSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(2);
      expect(await countInstantRepliesSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
    });
  });

  it("countInstantRepliesSince never counts another account's stamps", async () => {
    // Mutation: drop `.eq("account_id", accountId)` and accountA counts 1.
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db, accountB) => {
        const { id: formB } = await createForm(db, accountB, { name: "Quote", fields: [] }, "user_test");
        const s = await createSubmission(db, accountB, formB, { answers: [] });
        await stampInstantReplySent(db, s.id);
        const floor = new Date(Date.now() - 60_000).toISOString();
        expect(await countInstantRepliesSince(db, accountB, floor)).toBe(1);
        expect(await countInstantRepliesSince(db, accountA, floor)).toBe(0);
      });
    });
  });
});

describe("appointment confirm — the matcher is the whole message, never a substring", () => {
  it("reads a one-word yes in the forms a customer actually sends", () => {
    for (const yes of ["yes", "YES", " Yes ", "yes.", "YES!!", "y", "Si", "sí", "SÍ", "confirm", "Confirmed"]) {
      expect(matchConfirmationReply(yes), JSON.stringify(yes)).toBe("yes");
    }
  });

  it("reads a DECOMPOSED sí — the form some phone keyboards actually send", () => {
    // ESCAPED codepoints, NEVER editor-typed literals. A typed decomposed
    // "s" + U+0301 is one save away from being silently recomposed, and this
    // case would then pass with `.normalize("NFC")` DELETED — which is the
    // one mutation it exists to catch. Every fixture in the case above is
    // already composed, so not one of them can red that deletion: verified
    // by running the matcher both ways.
    // Mutation: delete `.normalize("NFC")` from matchConfirmationReply —
    // THIS case reds by name and nothing else in the file moves.
    expect(matchConfirmationReply("si\u0301"), "si + U+0301").toBe("yes");
    expect(matchConfirmationReply("SI\u0301"), "SI + U+0301").toBe("yes");
    expect(matchConfirmationReply("si\u0301."), "si + U+0301 + a full stop").toBe("yes");
  });

  it("reads a one-word no", () => {
    for (const no of ["no", "NO", "no.", "n", "cancel", "Cancel!"]) {
      expect(matchConfirmationReply(no), JSON.stringify(no)).toBe("no");
    }
  });

  it("reads NOTHING out of a sentence that merely contains the word", () => {
    // Mutation: replace the set membership test with `cleaned.includes(...)`
    // — BOTH of the first two go red, and they are the two real customer
    // sentences this rule exists for.
    for (const other of [
      "yes please, but move it to Friday",
      "I said no problem",
      "", "   ", "yesterday", "know", "can I confirm the address?", "👍",
      // Only TRAILING punctuation is stripped, so the opening "¡" survives
      // and this is a sentence, not a tap. Documented in the matcher's own
      // comment so the asymmetry reads as a decision.
      "¡Sí!",
    ]) {
      expect(matchConfirmationReply(other), JSON.stringify(other)).toBeNull();
    }
  });
});

describe("appointment confirm — data layer", () => {
  it("the window is 47h to 48h15m ahead and 75 minutes wide, and the ask's lead is 24h15m", () => {
    expect(APPOINTMENT_CONFIRM_WINDOW_START_MS).toBe(47 * HOUR);
    expect(APPOINTMENT_CONFIRM_WINDOW_END_MS).toBe(48 * HOUR + 15 * MINUTE);
    // 24h15m, not 24h: the email reminder becomes eligible at 24h15m out, so
    // that is where the ask has to stop (B11). `cron-coupling.test.ts` is
    // what pins it to REMINDER_WINDOW_END_MS; this pins the number itself.
    expect(APPOINTMENT_CONFIRM_MIN_LEAD_MS).toBe(24 * HOUR + 15 * MINUTE);
  });

  it("listDueAppointmentConfirms: enabled, booked, starting 47h–48h15m out, unasked → due; edges inclusive", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Twodays", phone: "(956) 555-0107" }, "user_test");
      const now = new Date("2027-04-12T12:00:00Z");
      const mk = (startsAt: Date, bookerTimezone?: string) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + MINUTE), bookerTimezone }, "user_test");

      const inside = await mk(new Date(now.getTime() + 47 * HOUR + 30 * MINUTE), "America/Los_Angeles");
      // OFF: nothing is due while the recipe is disabled.
      expect((await listDueAppointmentConfirms(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(inside.id);

      await upsertAutomation(db, accountId, "appointment_confirm",
        { enabled: true, body: "Any questions, just reply.", config: {} }, "user_test");
      const lowerEdge = await mk(new Date(now.getTime() + APPOINTMENT_CONFIRM_WINDOW_START_MS));
      const upperEdge = await mk(new Date(now.getTime() + APPOINTMENT_CONFIRM_WINDOW_END_MS));
      // ONE MINUTE outside each edge, never "next week": a fixture a day past
      // the bound passes against any ceiling and proves nothing.
      const tooSoon = await mk(new Date(now.getTime() + APPOINTMENT_CONFIRM_WINDOW_START_MS - MINUTE));
      const tooFar = await mk(new Date(now.getTime() + APPOINTMENT_CONFIRM_WINDOW_END_MS + MINUTE));
      const asked = await mk(new Date(now.getTime() + 47 * HOUR + 40 * MINUTE));
      await stampAppointmentConfirmAsked(db, asked.id);
      const cancelled = await mk(new Date(now.getTime() + 47 * HOUR + 50 * MINUTE));
      await cancelBookingByToken(db, cancelled.cancelToken);
      // An ATTEMPT marker must NOT remove the row from the list: this recipe
      // never reads the cooldown back (0047's own comment). Mutation: add a
      // `.is("confirm_sms_failed_at", null)` predicate — this expectation reds.
      // Written through the recipe's OWN stamp rather than a raw update, so
      // the writer is exercised too (and no import is left unused: this
      // package has no lint step that would catch one).
      await stampAppointmentConfirmSmsFailed(db, lowerEdge.id);
      const { data: marker } = await db.from("bookings")
        .select("confirm_sms_failed_at, confirm_asked_at").eq("id", lowerEdge.id).single();
      const markerRow = marker as { confirm_sms_failed_at: string | null; confirm_asked_at: string | null };
      expect(markerRow.confirm_sms_failed_at).not.toBeNull();
      expect(markerRow.confirm_asked_at).toBeNull();   // the attempt marker is NOT the dedupe stamp

      const ids = (await listDueAppointmentConfirms(db, now.toISOString())).map((r) => r.bookingId);
      expect(ids).toContain(inside.id);
      expect(ids).toContain(lowerEdge.id);
      expect(ids).toContain(upperEdge.id);
      // The mutation that reds these is one to the QUERY's bounds, NOT one to
      // the constants: both edge fixtures are derived FROM the constants, so
      // moving APPOINTMENT_CONFIRM_WINDOW_START_MS to 46h moves `tooSoon` with
      // it and this case stays green (verified — only the constants case above
      // reds). Proven mutations: `windowStart − 1h` reds the first line,
      // `windowEnd + 1h` reds the second.
      expect(ids).not.toContain(tooSoon.id);     // Mutation: windowStart − 1h in the due-list query
      expect(ids).not.toContain(tooFar.id);      // Mutation: windowEnd + 1h in the due-list query
      expect(ids).not.toContain(asked.id);
      expect(ids).not.toContain(cancelled.id);

      const row = (await listDueAppointmentConfirms(db, now.toISOString())).find((r) => r.bookingId === inside.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row).not.toHaveProperty("contactEmail");   // SMS only: no address it must not use
      expect(row).not.toHaveProperty("smsFailedAt");    // written, never read back
      expect(row.bookerTimezone).toBe("America/Los_Angeles");
      expect(row.contactPhone).toBe("(956) 555-0107");
      expect(row.body).toBe("Any questions, just reply.");
    });
  });

  it("a suppressed account's booking is never due", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Quiet", phone: "(956) 555-0108" }, "user_test");
      await upsertAutomation(db, accountId, "appointment_confirm", { enabled: true, body: "", config: {} }, "user_test");
      const now = new Date("2027-04-12T12:00:00Z");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(now.getTime() + 47 * HOUR + 30 * MINUTE),
          endsAt: new Date(now.getTime() + 47 * HOUR + 31 * MINUTE) }, "user_test");
      expect((await listDueAppointmentConfirms(db, now.toISOString())).map((r) => r.bookingId)).toContain(b.id);
      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      expect((await listDueAppointmentConfirms(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(b.id);
      expect((await getDueAppointmentConfirmById(db, b.id)).due).toBeNull();
    });
  });

  it("applyConfirmationReply writes the answer on the SOONEST unanswered ask, and nothing else", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Replier", phone: "(956) 555-0110" }, "user_test");
      const now = new Date("2027-06-01T12:00:00Z");
      const mk = (startsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + MINUTE) }, "user_test");

      const past = await mk(new Date(now.getTime() - 3 * HOUR));
      // NEVER ASKED, and deliberately the SOONEST upcoming of the four: at
      // +95h (the plan's placement) it sits behind two asked bookings, so
      // dropping `.not("confirm_asked_at", "is", null)` could not change a
      // single result and the assertion below could not fail — verified by
      // running that mutation. Soonest, the filter is the only thing keeping
      // this row out of the answer.
      const never = await mk(new Date(now.getTime() + 23 * HOUR));
      const soon = await mk(new Date(now.getTime() + 47 * HOUR));
      const later = await mk(new Date(now.getTime() + 71 * HOUR));
      for (const b of [past, soon, later]) await stampAppointmentConfirmAsked(db, b.id);

      // A message that is not an answer writes nothing at all.
      expect(await applyConfirmationReply(db, accountId, contactId, "can I confirm the address?", now)).toBeNull();
      const { data: untouched } = await db.from("bookings").select("confirm_reply").eq("id", soon.id).single();
      expect((untouched as { confirm_reply: string | null }).confirm_reply).toBeNull();

      expect(await applyConfirmationReply(db, accountId, contactId, "YES", now)).toBe("yes");
      const read = async (id: string) => (await db.from("bookings")
        .select("status, confirm_reply, confirm_reply_at").eq("id", id).single()).data as
        { status: string; confirm_reply: string | null; confirm_reply_at: string | null };

      expect((await read(soon.id)).confirm_reply).toBe("yes");               // soonest upcoming
      expect((await read(soon.id)).confirm_reply_at).not.toBeNull();
      expect((await read(soon.id)).status).toBe("booked");                   // a NO never cancels; a YES never confirms the STATUS either
      expect((await read(later.id)).confirm_reply).toBeNull();               // Mutation: order descending → this reds
      expect((await read(past.id)).confirm_reply).toBeNull();                // Mutation: drop the starts_at filter → this reds
      expect((await read(never.id)).confirm_reply).toBeNull();               // Mutation: drop the confirm_asked_at filter → this reds

      // A second answer does not overwrite the first: the row is already answered.
      expect(await applyConfirmationReply(db, accountId, contactId, "no", now)).toBe("no");
      expect((await read(soon.id)).confirm_reply).toBe("yes");
      expect((await read(later.id)).confirm_reply).toBe("no");               // it moved to the next unanswered one
    });
  });

  it("applyConfirmationReply never answers a CANCELLED booking, even when it is the soonest asked", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Scrapped", phone: "(956) 555-0112" }, "user_test");
      const now = new Date("2027-08-01T12:00:00Z");
      const mk = (startsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + MINUTE) }, "user_test");

      // The cancelled booking is the SOONEST on purpose. Behind the live one
      // the ascending order would skip it anyway and `.eq("status", "booked")`
      // would carry no weight — the non-load-bearing negative fixture this
      // file has already been caught by once (see `never`, above).
      const scrapped = await mk(new Date(now.getTime() + 47 * HOUR));
      const live = await mk(new Date(now.getTime() + 71 * HOUR));
      for (const b of [scrapped, live]) await stampAppointmentConfirmAsked(db, b.id);
      await cancelBookingByToken(db, scrapped.cancelToken);

      // Mutation: delete `.eq("status", "booked")` from the lookup → this reds.
      // Without it the YES lands on the cancelled row, and Task 4's badge
      // paints "confirmed" on a job nobody is doing while the live
      // appointment shows no answer at all.
      expect(await applyConfirmationReply(db, accountId, contactId, "yes", now)).toBe("yes");
      const read = async (id: string) => (await db.from("bookings")
        .select("status, confirm_reply").eq("id", id).single()).data as
        { status: string; confirm_reply: string | null };

      expect((await read(live.id)).confirm_reply).toBe("yes");
      expect((await read(scrapped.id)).confirm_reply).toBeNull();
      expect((await read(scrapped.id)).status).toBe("cancelled");
    });
  });

  it("applyConfirmationReply never reaches another account's booking", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Tenant", phone: "(956) 555-0111" }, "user_test");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-07-01T15:00:00Z"), endsAt: new Date("2027-07-01T15:30:00Z") }, "user_test");
      await stampAppointmentConfirmAsked(db, b.id);
      const stranger = "00000000-0000-4000-8000-000000000000";
      // Mutation: delete the .eq("account_id", accountId) from the SELECT
      // (the lookup, not the UPDATE) → this reds. Deleting it from the
      // UPDATE alone cannot red anything, which is why that one carries a
      // comment saying it is defence in depth rather than a live guard.
      expect(await applyConfirmationReply(db, stranger, contactId, "yes", new Date("2027-06-01T12:00:00Z"))).toBeNull();
      const { data } = await db.from("bookings").select("confirm_reply").eq("id", b.id).single();
      expect((data as { confirm_reply: string | null }).confirm_reply).toBeNull();
    });
  });
});

describe("referral ask — data layer", () => {
  it("the cap is 85 hours, which is the review request's cap plus one local day", () => {
    // THE LITERAL FIRST. `REFERRAL_ASK_MAX_AGE_MS = REVIEW_REQUEST_MAX_AGE_MS + 24h`
    // is the constant's own definition, so asserting only the derivation is a
    // tautology: change both constants and it stays green. 85h is the number
    // this recipe promises, so 85h is what is pinned; the derivation is
    // asserted second, as the STATEMENT that the three rungs are one local
    // day apart.
    expect(REFERRAL_ASK_MAX_AGE_MS).toBe(85 * HOUR);
    expect(REFERRAL_ASK_MAX_AGE_MS).toBe(REVIEW_REQUEST_MAX_AGE_MS + 24 * HOUR);
  });

  it("parseReferralAskConfig takes a channel and NOTHING else — there is nowhere to put a link", () => {
    expect(parseReferralAskConfig({ channel: "sms" })).toEqual({ channel: "sms" });
    expect(parseReferralAskConfig({ channel: "email", reviewUrl: "https://x.example" })).toEqual({ channel: "email" });
    for (const bad of [null, undefined, "sms", 1, [], {}, { channel: "fax" }, { channel: "" }]) {
      expect(parseReferralAskConfig(bad), JSON.stringify(bad)).toBeNull();
    }
    // Mutation: spread `raw` into the result → the second expectation reds,
    // because a reviewUrl would survive into the config the pass reads.
  });

  it("listDueReferralAsks: completed, unstamped, inside 85h → due, and carries the precedence input", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Ref", email: "ref@example.com", phone: "(956) 555-0112" }, "user_test");
      const now = new Date("2027-08-20T12:00:00Z");
      const mk = async (endsAt: Date) => {
        const b = await createBooking(db, accountId,
          { calendarId: cal.id, contactId, startsAt: new Date(endsAt.getTime() - MINUTE), endsAt }, "user_test");
        await setBookingStatus(db, accountId, b.id, "completed", "user_test");
        return b;
      };

      const fresh = await mk(new Date(now.getTime() - 30 * HOUR));
      expect((await listDueReferralAsks(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(fresh.id);

      await upsertAutomation(db, accountId, "referral_ask",
        { enabled: true, body: "", config: { channel: "sms" } }, "user_test");
      // ONE MILLISECOND either side of the 85h ceiling, never "a week ago":
      // a fixture far past the bound passes against any ceiling. Built from
      // the LITERAL 85h, not from REFERRAL_ASK_MAX_AGE_MS: the query window
      // is derived from that same constant, so a fixture built from it moves
      // with the window and the pair survives any value the constant takes.
      const CEILING = 85 * HOUR;
      const atCeiling = await mk(new Date(now.getTime() - CEILING));
      const pastCeiling = await mk(new Date(now.getTime() - CEILING - 1));
      const stamped = await mk(new Date(now.getTime() - 40 * HOUR));
      await stampReferralAsked(db, stamped.id);

      // THE LADDER'S OWN COLUMNS, written straight onto `fresh`. Four
      // PAIRWISE DISTINCT instants, so a projection wired to the wrong
      // column reds instead of matching its neighbour, and the two rungs
      // land on DIFFERENT LOCAL DAYS in the account's zone
      // (America/Chicago, CDT here): the follow-up at 09:00 on the 19th and
      // the review at 06:30 on the 20th. A fixture where those two share an
      // instant is satisfied by whichever of the gate's clauses survives a
      // mutation, so it proves neither — the shape this branch has already
      // shipped once.
      const COMPLETED_AT = "2027-08-19T07:00:00.000Z";   // 02:00 CDT, the 19th
      const FOLLOWUP_AT = "2027-08-19T14:00:00.000Z";    // 09:00 CDT, the 19th
      const REVIEWED_AT = "2027-08-20T11:30:00.000Z";    // 06:30 CDT, the 20th
      const SMS_FAILED_AT = "2027-08-20T11:45:00.000Z";  // 06:45 CDT, the 20th
      {
        const { error } = await db.from("bookings").update({
          completed_at: COMPLETED_AT, followup_sent_at: FOLLOWUP_AT,
          review_requested_at: REVIEWED_AT, referral_ask_sms_failed_at: SMS_FAILED_AT,
        }).eq("id", fresh.id);
        if (error) throw new Error(`ladder fixture write failed: ${error.message}`);
      }

      const list = await listDueReferralAsks(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(fresh.id);
      expect(ids).toContain(atCeiling.id);
      // Mutation: change REFERRAL_ASK_MAX_AGE_MS to 86h → pastCeiling falls
      // inside the widened window and this reds; change it to 84h and the
      // atCeiling row above reds instead.
      expect(ids).not.toContain(pastCeiling.id);
      expect(ids).not.toContain(stamped.id);

      const row = list.find((r) => r.bookingId === fresh.id)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row.config).toEqual({ channel: "sms" });
      expect(row.contactId).toBe(contactId);
      expect(row.contactEmail).toBe("ref@example.com");
      expect(row.contactPhone).toBe("(956) 555-0112");
      // EVERY LADDER COLUMN BY VALUE, never `not.toBeNull()`: a column
      // dropped from REFERRAL_ASK_SELECT comes back `undefined`, and
      // `expect(undefined).not.toBeNull()` PASSES. Task 6's gate reads all
      // three of these, so a silently-missing one would be a recipe that
      // sends on the same morning as the review it must follow.
      expect(new Date(row.endsAt).getTime()).toBe(now.getTime() - 30 * HOUR);
      expect(new Date(row.completedAt!).getTime()).toBe(Date.parse(COMPLETED_AT));
      expect(new Date(row.followupSentAt!).getTime()).toBe(Date.parse(FOLLOWUP_AT));
      expect(new Date(row.reviewRequestedAt!).getTime()).toBe(Date.parse(REVIEWED_AT));
      expect(new Date(row.smsFailedAt!).getTime()).toBe(Date.parse(SMS_FAILED_AT));
      // An unstamped row projects nulls, not undefineds — so "the column is
      // absent" and "the column is empty" cannot be confused by a reader or
      // by the gate.
      const clean = list.find((r) => r.bookingId === atCeiling.id)!;
      expect(clean.followupSentAt).toBeNull();
      expect(clean.reviewRequestedAt).toBeNull();
      expect(clean.smsFailedAt).toBeNull();
      // review_request is OFF for this account, so the precedence input is false.
      expect(row.reviewRequestEnabled).toBe(false);

      await upsertAutomation(db, accountId, "review_request",
        { enabled: true, body: "", config: { channel: "email", reviewUrl: "https://g.page/r/x/review" } }, "user_test");
      const after = (await listDueReferralAsks(db, now.toISOString())).find((r) => r.bookingId === fresh.id)!;
      // Mutation: hard-code `reviewRequestEnabled: false` in toDueReferralAsk
      // → this reds and the whole precedence rule silently stops working.
      expect(after.reviewRequestEnabled).toBe(true);
    });
  });

  it("a suppressed account's completed booking is never due, by list or by id", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Hush", email: "h@example.com" }, "user_test");
      await upsertAutomation(db, accountId, "referral_ask", { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      const now = new Date("2027-08-20T12:00:00Z");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(now.getTime() - 31 * HOUR), endsAt: new Date(now.getTime() - 30 * HOUR) }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      expect((await listDueReferralAsks(db, now.toISOString())).map((r) => r.bookingId)).toContain(b.id);
      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      expect((await listDueReferralAsks(db, now.toISOString())).map((r) => r.bookingId)).not.toContain(b.id);
      // `off`, not merely null: the releaser writes a different sentence for
      // each ("This automation was turned off" vs "No longer due"), and
      // `expect(x.due).toBeNull()` is green under either.
      expect(await getDueReferralAskById(db, b.id)).toEqual({ due: null, why: "off" });
    });
  });

  it("by id, a config that no longer parses answers `off` — so a released hold leaves the queue", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Broken", email: "broken@example.com" }, "user_test");
      await upsertAutomation(db, accountId, "referral_ask",
        { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      const now = new Date("2027-08-20T12:00:00Z");
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(now.getTime() - 31 * HOUR), endsAt: new Date(now.getTime() - 30 * HOUR) }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      expect((await getDueReferralAskById(db, b.id)).due?.bookingId).toBe(b.id);

      // Straight to the column: `upsertAutomation` validates on write, and
      // the case being proved is a row that went bad UNDER the app (an older
      // shape, a hand-edited jsonb, a config written before a parser change).
      await db.from("automations").update({ config: { channel: "fax" } })
        .eq("account_id", accountId).eq("recipe_key", "referral_ask");
      expect(await getDueReferralAskById(db, b.id)).toEqual({ due: null, why: "off" });
      // Mutation: delete the `parseReferralAskConfig(auto.config) === null`
      // guard from getDueReferralAskById → this reds, and a released hold
      // whose config went bad is left `held` with its past `held_until` for
      // ever, parking the head of the release queue.
    });
  });

  it("stampReferralAsked and stampReferralAskSmsFailed write their own columns; only the first counts", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Stamp2" }, "user_test");
      const mk = (offset: number) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(Date.now() - offset - MINUTE), endsAt: new Date(Date.now() - offset) }, "user_test");
      const before = new Date();
      const a = await mk(3 * HOUR);
      const c = await mk(4 * HOUR);
      await stampReferralAsked(db, a.id);
      await stampReferralAsked(db, a.id);                 // idempotent
      await stampReferralAskSmsFailed(db, c.id);          // an ATTEMPT, not a send
      const { data } = await db.from("bookings")
        .select("referral_asked_at, referral_ask_sms_failed_at").eq("id", c.id).single();
      const marked = data as { referral_asked_at: string | null; referral_ask_sms_failed_at: string | null };
      expect(marked.referral_asked_at).toBeNull();
      // BY VALUE, not `.not.toBeNull()`: drop the column from the select and
      // it reads `undefined`, which `not.toBeNull()` happily accepts — the
      // exact vacuous shape this branch has shipped before. The review
      // request's own attempt-marker case (above) is the precedent.
      expect(new Date(marked.referral_ask_sms_failed_at!).getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(await countReferralAsksSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(1);
      expect(await countReferralAsksSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
    });
  });
});
