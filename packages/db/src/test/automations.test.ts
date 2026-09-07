import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import { setBranding } from "../branding";
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
