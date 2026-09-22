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
  parseReactivationConfig, reactivationCutoff, listDueReactivations, getDueReactivationById,
  conversationQuietSince, stampReactivationSent, countReactivationsSince,
  REACTIVATION_MIN_MONTHS, REACTIVATION_MAX_MONTHS,
  parseQuoteFollowupConfig, listDueQuoteFollowups, getDueQuoteFollowupById, latestInboundByContact,
  stampQuoteFollowupSent, stampQuoteFollowupSmsFailed, countQuoteFollowupsSince,
  QUOTE_FOLLOWUP_MAX_AGE_MS, QUOTE_FOLLOWUP_MAX_QUIET_DAYS,
} from "../automations";
import { ensureConversation, createMessage } from "../messaging";
import { ensureDefaultPipeline, listPipelinesWithStages } from "../crm-config";
import { createOpportunity } from "../opportunities";

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

  it("applyConfirmationReply writes the answer on the MOST RECENTLY ASKED booking, and nothing else", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Replier", phone: "(956) 555-0110" }, "user_test");
      const now = new Date("2027-06-01T12:00:00Z");
      const mk = (startsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + MINUTE) }, "user_test");

      const past = await mk(new Date(now.getTime() - 3 * HOUR));
      // NEVER ASKED. `confirm_asked_at` is null, and Postgres sorts nulls
      // FIRST in a DESC order, so with `.not("confirm_asked_at", "is", null)`
      // deleted this row wins outright — which is exactly the mutation the
      // assertion below exists to catch.
      const never = await mk(new Date(now.getTime() + 23 * HOUR));
      const soon = await mk(new Date(now.getTime() + 47 * HOUR));
      const later = await mk(new Date(now.getTime() + 71 * HOUR));
      for (const b of [past, soon, later]) await stampAppointmentConfirmAsked(db, b.id);

      // THE WHOLE POINT OF THIS FIXTURE: "soonest" and "most recently asked"
      // DISAGREE. Two booked jobs less than 48h apart — a two-day job, or a
      // morning slot plus a next-day slot — are asked about on consecutive
      // days, and the text the customer is holding when they reply named the
      // LATER one. `soon` starts first but was asked three hours ago;
      // `later` starts last and was asked an hour ago. `past` was asked most
      // recently of all, so `starts_at > now` is the only thing keeping it
      // out of the answer. Without this block every stamp above lands in the
      // same millisecond and the order is whatever the database felt like.
      const askedAt = async (id: string, at: Date) => {
        const { error } = await db.from("bookings")
          .update({ confirm_asked_at: at.toISOString() }).eq("id", id);
        if (error) throw new Error(`askedAt ${id} failed: ${error.message}`);
      };
      await askedAt(soon.id, new Date(now.getTime() - 3 * HOUR));
      await askedAt(later.id, new Date(now.getTime() - 1 * HOUR));
      await askedAt(past.id, new Date(now.getTime() - 30 * MINUTE));

      // A message that is not an answer writes nothing at all.
      expect(await applyConfirmationReply(db, accountId, contactId, "can I confirm the address?", now)).toBeNull();
      const { data: untouched } = await db.from("bookings").select("confirm_reply").eq("id", later.id).single();
      expect((untouched as { confirm_reply: string | null }).confirm_reply).toBeNull();

      expect(await applyConfirmationReply(db, accountId, contactId, "YES", now)).toBe("yes");
      const read = async (id: string) => (await db.from("bookings")
        .select("status, confirm_reply, confirm_reply_at").eq("id", id).single()).data as
        { status: string; confirm_reply: string | null; confirm_reply_at: string | null };

      expect((await read(later.id)).confirm_reply).toBe("yes");              // the ask they are answering
      expect((await read(later.id)).confirm_reply_at).not.toBeNull();
      expect((await read(later.id)).status).toBe("booked");                  // a NO never cancels; a YES never confirms the STATUS either
      expect((await read(soon.id)).confirm_reply).toBeNull();                // Mutation: order `starts_at` ascending again → this reds
      expect((await read(past.id)).confirm_reply).toBeNull();                // Mutation: drop the starts_at filter → this reds
      expect((await read(never.id)).confirm_reply).toBeNull();               // Mutation: drop the confirm_asked_at filter → this reds

      // A second answer does not overwrite the first: it moves to the next
      // unanswered ask, which is the one asked before it.
      expect(await applyConfirmationReply(db, accountId, contactId, "no", now)).toBe("no");
      expect((await read(later.id)).confirm_reply).toBe("yes");
      expect((await read(soon.id)).confirm_reply).toBe("no");                // it moved to the next unanswered one
    });
  });

  it("applyConfirmationReply never answers a CANCELLED booking, even when it is the most recently asked", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Scrapped", phone: "(956) 555-0112" }, "user_test");
      const now = new Date("2027-08-01T12:00:00Z");
      const mk = (startsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt, endsAt: new Date(startsAt.getTime() + MINUTE) }, "user_test");

      // The cancelled booking WINS THE ORDERING on purpose — it is both the
      // soonest AND, once the stamps below are placed, the most recently
      // asked. Behind the live one the order would skip it anyway and
      // `.eq("status", "booked")` would carry no weight — the
      // non-load-bearing negative fixture this file has already been caught
      // by once (see `never`, above). The explicit stamps are what keep that
      // true now the order is `confirm_asked_at` and not `starts_at`.
      const scrapped = await mk(new Date(now.getTime() + 47 * HOUR));
      const live = await mk(new Date(now.getTime() + 71 * HOUR));
      for (const b of [scrapped, live]) await stampAppointmentConfirmAsked(db, b.id);
      const askedAt = async (id: string, at: Date) => {
        const { error } = await db.from("bookings")
          .update({ confirm_asked_at: at.toISOString() }).eq("id", id);
        if (error) throw new Error(`askedAt ${id} failed: ${error.message}`);
      };
      await askedAt(live.id, new Date(now.getTime() - 3 * HOUR));
      await askedAt(scrapped.id, new Date(now.getTime() - 30 * MINUTE));
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

  it("matches on EITHER ends_at or completed_at, so a batch marked completed on Friday still earns its ask", async () => {
    // THE COMPLETION ANCHOR (0026), and the reason 0047 ships
    // `bookings_referral_due_completed` as well as `bookings_referral_due`.
    // The clock columns are written DIRECTLY here: `setBookingStatus` stamps
    // REAL time, which sits eleven months outside this fake 2027 window, so
    // every row in the case above matches by `ends_at` alone and the second
    // disjunct of the `.or(...)` carries nothing. That is exactly what hid
    // this — replacing the whole `.or(eitherAnchorSince(...))` with a plain
    // `.gte("ends_at", ...)` left the describe green.
    await withTestAccount(async (db, accountId) => {
      await upsertAutomation(db, accountId, "referral_ask",
        { enabled: true, body: "", config: { channel: "email" } }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Batch", phone: "(956) 555-0113" }, "user_test");
      const now = new Date("2027-08-20T12:00:00Z");
      const mk = (endsAt: Date) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(endsAt.getTime() - 30 * MINUTE), endsAt }, "user_test");
      const clock = (id: string, patch: Record<string, string | null>) =>
        db.from("bookings").update({ status: "completed", ...patch }).eq("id", id).then(({ error }) => {
          if (error) throw new Error(error.message);
        });

      // Ended nine days ago — far outside 85h by ends_at — but marked
      // completed an hour ago. Due by the COMPLETION anchor alone.
      const batchMarked = await mk(new Date(now.getTime() - 9 * 24 * HOUR));
      await clock(batchMarked.id, { completed_at: new Date(now.getTime() - HOUR).toISOString() });
      // A pre-0026 row: completed, completed_at NULL. Due by ends_at alone.
      const legacy = await mk(new Date(now.getTime() - 4 * HOUR));
      await clock(legacy.id, { completed_at: null });
      // Outside by BOTH anchors, so the window is proven to apply at all.
      const stale = await mk(new Date(now.getTime() - 9 * 24 * HOUR - 2 * HOUR));
      await clock(stale.id, { completed_at: new Date(now.getTime() - 9 * 24 * HOUR).toISOString() });

      const list = await listDueReferralAsks(db, now.toISOString());
      const ids = list.map((r) => r.bookingId);
      expect(ids).toContain(batchMarked.id);   // Mutation: drop completed_at from the .or() window → this reds
      expect(ids).toContain(legacy.id);        // Mutation: drop ends_at from the .or() window → this reds
      expect(ids).not.toContain(stale.id);
      expect(new Date(list.find((r) => r.bookingId === batchMarked.id)!.completedAt!).getTime())
        .toBe(now.getTime() - HOUR);
      expect(list.find((r) => r.bookingId === legacy.id)!.completedAt).toBeNull();
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

  it("countReferralAsksSince never counts another account's stamps", async () => {
    // Mutation: drop `.eq("account_id", accountId)` and accountA counts 1.
    // The consequence is not abstract: this number IS the input to
    // AUTOMATION_DAILY_CAP, so one busy client's asks would spend a quiet
    // client's allowance and that client would silently stop sending.
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db, accountB) => {
        const cal = await getOrCreateCalendar(db, accountB, "user_test");
        const { id: contactId } = await createContact(db, accountB, { firstName: "Asked" }, "user_test");
        const b = await createBooking(db, accountB,
          { calendarId: cal.id, contactId, startsAt: new Date(Date.now() - 4 * HOUR), endsAt: new Date(Date.now() - 3 * HOUR) },
          "user_test");
        const floor = new Date(Date.now() - 60_000).toISOString();
        await stampReferralAsked(db, b.id);
        expect(await countReferralAsksSince(db, accountB, floor)).toBe(1);
        expect(await countReferralAsksSince(db, accountA, floor)).toBe(0);
      });
    });
  });
});

describe("reactivation — the cutoff is calendar months, clamped", () => {
  it("subtracts whole months", () => {
    expect(reactivationCutoff(new Date("2027-09-21T12:00:00Z"), 9).toISOString())
      .toBe("2026-12-21T12:00:00.000Z");
    expect(reactivationCutoff(new Date("2027-09-21T12:00:00Z"), 6).toISOString())
      .toBe("2027-03-21T12:00:00.000Z");
  });

  it("clamps a day the target month does not have, instead of rolling forward", () => {
    // 31 August minus six months is February. Mutation: drop the clamp and
    // `setUTCMonth` silently produces 3 March — this goes red BY NAME.
    expect(reactivationCutoff(new Date("2027-08-31T12:00:00Z"), 6).toISOString())
      .toBe("2027-02-28T12:00:00.000Z");
    expect(reactivationCutoff(new Date("2028-08-31T12:00:00Z"), 6).toISOString())
      .toBe("2028-02-29T12:00:00.000Z");   // a leap year, and the clamp still holds
  });

  it("parseReactivationConfig takes a whole number in range and refuses everything else", () => {
    expect(parseReactivationConfig({ months: 9 })).toEqual({ months: 9 });
    expect(parseReactivationConfig({ months: REACTIVATION_MIN_MONTHS })).toEqual({ months: 6 });
    expect(parseReactivationConfig({ months: REACTIVATION_MAX_MONTHS })).toEqual({ months: 18 });
    // ONE outside each bound, never 99: a fixture far past the bound passes
    // against any range.
    for (const bad of [null, undefined, {}, { months: "9" }, { months: 9.5 },
                       { months: REACTIVATION_MIN_MONTHS - 1 }, { months: REACTIVATION_MAX_MONTHS + 1 }]) {
      expect(parseReactivationConfig(bad), JSON.stringify(bad)).toBeNull();
    }
    // Mutation: clamp instead of refusing → the two boundary-adjacent rows red.
  });
});

describe("reactivation — data layer", () => {
  it("a quiet past CUSTOMER with an email is due; a quiet contact with no completed booking is NOT", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const longAgo = new Date("2026-10-01T12:00:00Z");    // ~11.7 months, well inside 9

      const mkPerson = async (name: string, completed: boolean) => {
        const { id } = await createContact(db, accountId,
          { firstName: name, email: `${name.toLowerCase()}@example.com` }, "user_test");
        const convo = await ensureConversation(db, accountId, id, "user_test");
        await createMessage(db, accountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
        await db.from("messages").update({ created_at: longAgo.toISOString() }).eq("conversation_id", convo.id);
        await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);
        if (completed) {
          const b = await createBooking(db, accountId,
            { calendarId: cal.id, contactId: id, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo }, "user_test");
          await setBookingStatus(db, accountId, b.id, "completed", "user_test");
        }
        return id;
      };

      const customer = await mkPerson("Customer", true);
      const stranger = await mkPerson("Stranger", false);

      const ids = (await listDueReactivations(db, now.toISOString())).map((r) => r.contactId);
      expect(ids).toContain(customer);
      // THE ANTI-BLAST RULE. Mutation: drop the completed-booking read → this
      // goes red, and the recipe becomes a mailing list.
      expect(ids).not.toContain(stranger);

      const row = (await listDueReactivations(db, now.toISOString())).find((r) => r.contactId === customer)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row).not.toHaveProperty("contactPhone");     // email only: no address it must not use
      expect(row.contactEmail).toBe("customer@example.com");
      expect(row.quietMonths).toBe(9);
      // The embed's shape, asserted BY VALUE and not by `not.toBeNull()`:
      // `contacts!inner(...)` from `conversations` has no precedent in this
      // repo, and if PostgREST ever answered with an ARRAY instead of an
      // object these two would read `undefined` rather than the person's
      // own name and address.
      expect(row.contactName).toBe("Customer");
      expect(row.lastMessageAt.startsWith("2026-10-01T12:00:00")).toBe(true);
    });
  });

  it("a contact already reactivated is never due again, and the quiet period is respected at the boundary", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const cutoff = reactivationCutoff(now, 9);

      const mk = async (name: string, lastMessageAt: Date) => {
        const { id } = await createContact(db, accountId,
          { firstName: name, email: `${name.toLowerCase()}@example.com` }, "user_test");
        const convo = await ensureConversation(db, accountId, id, "user_test");
        await createMessage(db, accountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
        await db.from("messages").update({ created_at: lastMessageAt.toISOString() }).eq("conversation_id", convo.id);
        await db.from("conversations").update({ last_message_at: lastMessageAt.toISOString() }).eq("id", convo.id);
        const b = await createBooking(db, accountId,
          { calendarId: cal.id, contactId: id, startsAt: new Date(lastMessageAt.getTime() - HOUR), endsAt: lastMessageAt }, "user_test");
        await setBookingStatus(db, accountId, b.id, "completed", "user_test");
        return id;
      };

      // ONE MILLISECOND either side of the cutoff, never "a year ago".
      const atCutoff = await mk("Atcut", cutoff);
      const insideCutoff = await mk("Inside", new Date(cutoff.getTime() + 1));
      const already = await mk("Already", new Date(cutoff.getTime() - 1000));
      await stampReactivationSent(db, already);

      const ids = (await listDueReactivations(db, now.toISOString())).map((r) => r.contactId);
      expect(ids).toContain(atCutoff);
      expect(ids).not.toContain(insideCutoff);   // Mutation: change lte to lt / widen months
      expect(ids).not.toContain(already);        // Mutation: drop the reactivation_sent_at filter
    });
  });

  it("the lagging-touch guard drops a contact whose conversation actually has a newer message", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const longAgo = new Date("2026-10-01T12:00:00Z");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Lagged", email: "lagged@example.com" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id: oldMsg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "old" }, "user_test");
      await db.from("messages").update({ created_at: longAgo.toISOString() }).eq("id", oldMsg);
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      // The column says quiet; the messages table says otherwise. This is the
      // exact shape messaging.ts's best-effort touch admits is possible.
      await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);
      const { id: newMsg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "actually I wrote in last week" }, "user_test");
      // REWRITE THE NEWER MESSAGE'S CLOCK TOO. `createMessage` inserts no
      // `created_at`, so the column takes `now()` — REAL time, which is
      // months BEFORE the faked 2027 `now` and therefore before the 2026-12
      // cutoff as well. Left alone, the "newer" message is older than the
      // cutoff, the contact stays due, and every assertion below inverts.
      // This is the trap this file's own fixtures record, and every other
      // fixture in this task rewrites the clock; the one that IS the test
      // must too.
      await db.from("messages").update({ created_at: new Date(now.getTime() - 7 * 24 * HOUR).toISOString() })
        .eq("id", newMsg);
      await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);

      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).not.toContain(contactId);
      // Mutation: delete the messages read from listDueReactivations → this
      // goes red, and someone who wrote in last week is told "it's been a
      // while".
      expect(await conversationQuietSince(db, accountId, contactId, longAgo.toISOString())).toBe(false);
      // The floor is the FAKED now, not `new Date()`: nothing in this fixture
      // is on the real clock, and a real-clock floor would answer `true` for
      // the wrong reason.
      expect(await conversationQuietSince(db, accountId, contactId, now.toISOString())).toBe(true);
    });
  });

  it("the guard compares each account to ITS OWN cutoff, not the widest across accounts", async () => {
    // TWO ACCOUNTS, one set to 18 months and one to 6. The widest (latest,
    // most permissive) cutoff is the 6-month account's, so a bulk message
    // read written against `widest` cannot see a message that is newer than
    // the 18-month account's cutoff but older than the 6-month one's — and
    // that account's customer is then told "it's been a while since we were
    // out at your place" ten months after writing in.
    await withTestAccount(async (db, longAccountId) => {
      await withTestAccount(async (db2, shortAccountId) => {
        void db2;
        const now = new Date("2027-09-21T12:00:00Z");
        await upsertAutomation(db, longAccountId, "reactivation",
          { enabled: true, body: "", config: { months: 18 } }, "user_test");
        await upsertAutomation(db, shortAccountId, "reactivation",
          { enabled: true, body: "", config: { months: 6 } }, "user_test");

        const cal = await getOrCreateCalendar(db, longAccountId, "user_test");
        const { id: contactId } = await createContact(db, longAccountId,
          { firstName: "Tenmonths", email: "ten@example.com" }, "user_test");
        const convo = await ensureConversation(db, longAccountId, contactId, "user_test");
        // The column LAGS at 20 months; the real newest message is 10 months
        // old — inside 18 months, outside 6.
        const lagged = new Date("2026-01-21T12:00:00Z");     // 20 months
        const real = new Date("2026-11-21T12:00:00Z");       // 10 months
        const { id: msg } = await createMessage(db, longAccountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
        await db.from("messages").update({ created_at: real.toISOString() }).eq("id", msg);
        await db.from("conversations").update({ last_message_at: lagged.toISOString() }).eq("id", convo.id);
        const b = await createBooking(db, longAccountId,
          { calendarId: cal.id, contactId, startsAt: new Date(lagged.getTime() - HOUR), endsAt: lagged }, "user_test");
        await setBookingStatus(db, longAccountId, b.id, "completed", "user_test");

        // Mutation: query the message read on `widest` instead of `earliest`,
        // or compare every row to `widest` instead of its own account's
        // cutoff → this reds, and only this.
        expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId))
          .not.toContain(contactId);
      });
    });
  });

  it("walks past a page of contacts that can never qualify — the oldest-first window is not parked by leads", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");

      // Three quiet, unstamped, emailable contacts, OLDEST FIRST. The two
      // oldest are leads — a contact who wrote in, never booked, and never
      // will — so they survive the candidate query and fail the
      // completed-booking read on every tick, for ever.
      const mk = async (name: string, at: Date, completed: boolean) => {
        const { id } = await createContact(db, accountId,
          { firstName: name, email: `${name.toLowerCase()}@example.com` }, "user_test");
        const convo = await ensureConversation(db, accountId, id, "user_test");
        const { id: msg } = await createMessage(db, accountId,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
        await db.from("messages").update({ created_at: at.toISOString() }).eq("id", msg);
        await db.from("conversations").update({ last_message_at: at.toISOString() }).eq("id", convo.id);
        if (completed) {
          const b = await createBooking(db, accountId,
            { calendarId: cal.id, contactId: id, startsAt: new Date(at.getTime() - HOUR), endsAt: at }, "user_test");
          await setBookingStatus(db, accountId, b.id, "completed", "user_test");
        }
        return id;
      };
      // Deliberately ancient, and that is what makes the page numbers
      // reliable: the candidate read is platform-wide (`.in("account_id",
      // <every enabled account>)`), so a conversation left by a concurrent
      // run could otherwise land between these three and push the customer
      // past page 3. Nothing else in this project carries a 2020 timestamp,
      // so these three are the first three rows of an oldest-first walk.
      // (The db suite also runs ONE AT A TIME across implementers — the
      // slot — which is the backstop, not the guarantee.)
      await mk("Leadone", new Date("2020-01-01T12:00:00Z"), false);
      await mk("Leadtwo", new Date("2020-02-01T12:00:00Z"), false);
      const customer = await mk("Customer", new Date("2020-03-01T12:00:00Z"), true);

      // ONE conversation per page, so the customer is only reachable on the
      // third. Mutation: read one page and return (the shape this plan
      // started with) → this reds, and an account whose oldest conversations
      // are all leads gets an empty due-list on every tick, for ever, with no
      // error and no counter.
      expect((await listDueReactivations(db, now.toISOString(), { pageSize: 1, maxPages: 3 }))
        .map((r) => r.contactId)).toContain(customer);
      // And the page size is real, not decorative: one page reaches only the
      // oldest lead. Without this half the assertion above would pass against
      // an implementation that ignored `pageSize` entirely.
      expect((await listDueReactivations(db, now.toISOString(), { pageSize: 1, maxPages: 1 }))
        .map((r) => r.contactId)).not.toContain(customer);
    });
  });

  it("an account whose stored config does not parse is skipped, never defaulted to nine months", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const longAgo = new Date("2026-10-01T12:00:00Z");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Bad", email: "bad@example.com" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id: msg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
      await db.from("messages").update({ created_at: longAgo.toISOString() }).eq("id", msg);
      await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");
      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).toContain(contactId);
      expect((await getDueReactivationById(db, contactId)).due?.contactId).toBe(contactId);

      // Straight to the column: `upsertAutomation` validates on write, and
      // the case being proved is a row that went bad UNDER the app.
      await db.from("automations").update({ config: { months: 99 } })
        .eq("account_id", accountId).eq("recipe_key", "reactivation");
      // Mutation: restore `?? { months: REACTIVATION_DEFAULT_MONTHS }` in
      // either place → both of these red, and the one recipe with spam teeth
      // sends on a number the operator never chose.
      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).not.toContain(contactId);
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "off" });
    });
  });

  it("a suppressed account's customer is never due, by list or by id; and the cap counts stamps", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await upsertAutomation(db, accountId, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const longAgo = new Date("2026-10-01T12:00:00Z");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Hushed", email: "hushed@example.com" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const { id: msg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "hi" }, "user_test");
      await db.from("messages").update({ created_at: longAgo.toISOString() }).eq("id", msg);
      await db.from("conversations").update({ last_message_at: longAgo.toISOString() }).eq("id", convo.id);
      const b = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo }, "user_test");
      await setBookingStatus(db, accountId, b.id, "completed", "user_test");

      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).toContain(contactId);
      expect((await getDueReactivationById(db, contactId)).due?.contactId).toBe(contactId);

      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId)).not.toContain(contactId);
      // The WHOLE answer, not `.due` alone: suppression must read `off` (the
      // releaser's "This automation was turned off") and not `gone` ("No
      // longer due"), and `.due` cannot tell those two apart.
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "off" });
      await db.from("accounts").update({ outbound_suppressed: false }).eq("id", accountId);

      const before = new Date();
      await stampReactivationSent(db, contactId);
      await stampReactivationSent(db, contactId);   // idempotent
      expect(await countReactivationsSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(1);
      expect(await countReactivationsSince(db, accountId, new Date(Date.now() + 60_000).toISOString())).toBe(0);
      expect(await getDueReactivationById(db, contactId)).toEqual({ due: null, why: "gone" });
    });
  });

  it("countReactivationsSince never counts another account's stamps", async () => {
    // Mutation: drop `.eq("account_id", accountId)` and accountA counts 1.
    // This number is REACTIVATION_DAILY_CAP's input — five a day, its own
    // cap and not the platform's 25 — so unscoped it lets one account's
    // sends stop another account's.
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db, accountB) => {
        const { id: contactId } = await createContact(db, accountB,
          { firstName: "Woken", email: "woken@example.com" }, "user_test");
        const floor = new Date(Date.now() - 60_000).toISOString();
        await stampReactivationSent(db, contactId);
        expect(await countReactivationsSince(db, accountB, floor)).toBe(1);
        expect(await countReactivationsSince(db, accountA, floor)).toBe(0);
      });
    });
  });

  it("conversationQuietSince never reads another account's conversation", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db, accountB) => {
        const { id: contactB } = await createContact(db, accountB,
          { firstName: "Chatty", email: "chatty@example.com" }, "user_test");
        const convo = await ensureConversation(db, accountB, contactB, "user_test");
        await createMessage(db, accountB,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "still here" }, "user_test");
        // AN ACCOUNT-A MESSAGE ON ACCOUNT B'S CONVERSATION. `messages` carries
        // `account_id` and `conversation_id` as two independent plain FKs, so
        // the row is constructible. It is here because without it NEITHER of
        // this function's two `.eq("account_id", accountId)` calls can be
        // redded alone: dropping the conversation lookup's is masked by the
        // message count's (A's count over B's conversation finds nothing),
        // and dropping the message count's is masked by the lookup's (A has
        // no conversation, so the count never runs). Measured, both ways,
        // before this row was added.
        const { id: stray } = await createMessage(db, accountA,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "stray" }, "user_test");
        const floor = new Date(Date.now() - 60_000).toISOString();
        try {
          // B sees its own message. Without this line the assertion below
          // would read `true` for want of any data at all, and the account
          // predicate would carry no weight. It also pins that the stray row
          // does not change B's own answer.
          expect(await conversationQuietSince(db, accountB, contactB, floor)).toBe(false);
          // Mutation: drop `.eq("account_id", accountId)` from the
          // CONVERSATION lookup → A finds B's conversation, counts the stray
          // and this reds. The message count's own account predicate is not
          // redded by this case — it is the index's leading column and
          // defence in depth — and that is said here rather than left
          // looking provable.
          expect(await conversationQuietSince(db, accountA, contactB, floor)).toBe(true);
        } finally {
          // The stray points at B's conversation, so B's teardown would fail
          // on `conversations` without this. Logged, never thrown: a throw in
          // a `finally` replaces the assertion that brought us here.
          const { error: mDel } = await db.from("messages").delete().eq("id", stray);
          if (mDel) console.error(`stray message cleanup failed: ${mDel.message}`);
        }
      });
    });
  });

  it("a conversation pointing at ANOTHER account's contact is never due, by list or by id", async () => {
    // The nested-account shape this file already uses for
    // `countInstantRepliesSince` (:488). `conversations.contact_id` and
    // `bookings.contact_id` are plain single-column FKs — there is no
    // composite `(account_id, contact_id)` key anywhere — so a row whose
    // contact belongs to a different account is constructible, and the whole
    // reactivation chain used to resolve the customer, the email address and
    // the "past customer" proof through `contact_id` alone. Account A then
    // emailed account B's customer under A's brand, and the permanent stamp
    // landed on B's contact so B could never send its own.
    await withTestAccount(async (db, accountA) => {
      const calA = await getOrCreateCalendar(db, accountA, "user_test");
      await upsertAutomation(db, accountA, "reactivation",
        { enabled: true, body: "", config: { months: 9 } }, "user_test");
      const now = new Date("2027-09-21T12:00:00Z");
      const longAgo = new Date("2026-10-01T12:00:00Z");

      await withTestAccount(async (_db, accountB) => {
        await upsertAutomation(db, accountB, "reactivation",
          { enabled: true, body: "", config: { months: 9 } }, "user_test");
        const { id: contactB } = await createContact(db, accountB,
          { firstName: "Crossed", email: "crossed@example.com" }, "user_test");

        // B's OWN conversation, quiet since long ago. Without it B's side of
        // the due-list would be refused for want of a conversation and the
        // booking's account would carry no weight — the non-load-bearing
        // negative fixture this file has been caught by before.
        const convoB = await ensureConversation(db, accountB, contactB, "user_test");
        await db.from("conversations")
          .update({ last_message_at: longAgo.toISOString() }).eq("id", convoB.id)
          .then(({ error }) => { if (error) throw new Error(`convoB touch failed: ${error.message}`); });

        // THE TWO CROSS-ACCOUNT ROWS: A's conversation on B's contact, and
        // the completed booking that proves "past customer" — owned by A,
        // not by B.
        const convoA = await ensureConversation(db, accountA, contactB, "user_test");
        await db.from("conversations")
          .update({ last_message_at: longAgo.toISOString() }).eq("id", convoA.id)
          .then(({ error }) => { if (error) throw new Error(`convoA touch failed: ${error.message}`); });
        const crossed = await createBooking(db, accountA,
          { calendarId: calA.id, contactId: contactB, startsAt: new Date(longAgo.getTime() - HOUR), endsAt: longAgo },
          "user_test");
        await setBookingStatus(db, accountA, crossed.id, "completed", "user_test");

        try {
          // Mutation: delete the contact-account check in `listDueReactivations`
          // → B's customer comes back due under ACCOUNT A and this reds.
          // Mutation: key `customers` by contact alone again (drop the account
          // from the completed-bookings read) → B's own conversation qualifies
          // on A's booking and this reds too.
          expect((await listDueReactivations(db, now.toISOString())).map((r) => r.contactId))
            .not.toContain(contactB);
          // Mutation: delete `.eq("account_id", accountId)` from
          // `getDueReactivationById`'s bookings read → this answers with a due
          // row and reds.
          expect(await getDueReactivationById(db, contactB)).toEqual({ due: null, why: "gone" });
          const { data: after } = await db.from("contacts")
            .select("reactivation_sent_at").eq("id", contactB).single();
          expect((after as { reactivation_sent_at: string | null }).reactivation_sent_at).toBeNull();
        } finally {
          // A's two rows point at B's contact, and both FKs are plain
          // `references` with no cascade, so B's teardown fails on `contacts`
          // without this. IN A `finally`, because a failed assertion would
          // otherwise skip it and the FK violation would replace the real
          // failure message with one naming no cause at all — which is
          // exactly what the first run of this case printed. LOGGED, never
          // thrown, for the same reason: a throw here would mask the
          // assertion that brought us into the finally. A cleanup that
          // really fails is still loud, one line later, out of
          // `deleteAccountCascade`.
          const { error: bDel } = await db.from("bookings").delete().eq("id", crossed.id);
          if (bDel) console.error(`cross-account bookings cleanup failed: ${bDel.message}`);
          const { error: cDel } = await db.from("conversations").delete().eq("id", convoA.id);
          if (cDel) console.error(`cross-account conversations cleanup failed: ${cDel.message}`);
        }
      });
    });
  });
});

describe("quote follow-up — data layer", () => {
  it("parseQuoteFollowupConfig needs a real uuid stage, a channel and a day count in range", () => {
    const stage = "3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b";
    expect(parseQuoteFollowupConfig({ stageId: stage, quietDays: 3, channel: "sms" }))
      .toEqual({ stageId: stage, quietDays: 3, channel: "sms" });
    for (const bad of [
      null, {}, { stageId: stage, quietDays: 3 },
      { stageId: "", quietDays: 3, channel: "sms" },
      { stageId: "Quoted", quietDays: 3, channel: "sms" },            // a NAME, not an id
      { stageId: stage, quietDays: 0, channel: "sms" },               // one under the floor
      { stageId: stage, quietDays: QUOTE_FOLLOWUP_MAX_QUIET_DAYS + 1, channel: "sms" },
      { stageId: stage, quietDays: 3.5, channel: "sms" },
      { stageId: stage, quietDays: 3, channel: "fax" },
    ]) {
      expect(parseQuoteFollowupConfig(bad), JSON.stringify(bad)).toBeNull();
    }
    // Mutation: drop the uuid regex → the "Quoted" row reds, and a stage NAME
    // would reach `.in("stage_id", …)` and 400 the whole tick.
  });

  it("an open deal parked in the configured stage past the quiet days is due; one that moved, closed, or was answered is not", async () => {
    await withTestAccount(async (db, accountId) => {
      await setBranding(db, accountId, { brandName: "Fixture Brand" }, "user_test");
      // TWO arguments. `ensureDefaultPipeline(db, accountId)` takes no actor and
      // writes no event (crm-config.ts:72-74) — a third argument is TS2554 and
      // Step 5's typecheck stops before a single test runs.
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const pipelines = await listPipelinesWithStages(db, accountId);
      const stages = pipelines.find((p) => p.id === pipelineId)!.stages;
      const quoted = stages[1] ?? stages[0]!;
      const other = stages[0]!.id === quoted.id ? stages[stages.length - 1]! : stages[0]!;

      const now = new Date("2027-10-20T12:00:00Z");
      const DAY = 24 * HOUR;
      // THE CEILING IS PINNED HERE, not by the `tooOld` fixture below: that
      // fixture is written as `now - QUOTE_FOLLOWUP_MAX_AGE_MS - MINUTE`, so
      // WIDENING the constant moves the fixture with it and the row stays out
      // — the prescribed "widen QUOTE_FOLLOWUP_MAX_AGE_MS" mutation cannot red
      // a derived fixture. This line is what reds it, the way the sms
      // reminder pins its own window at :379-380.
      expect(QUOTE_FOLLOWUP_MAX_AGE_MS).toBe(30 * DAY);   // Mutation: widen QUOTE_FOLLOWUP_MAX_AGE_MS
      await upsertAutomation(db, accountId, "quote_followup",
        { enabled: true, body: "", config: { stageId: quoted.id, quietDays: 3, channel: "sms" } }, "user_test");

      // THE FIXTURE WRITE THROWS. The house `clock` helpers above do the same
      // (automations.test.ts:208-211): a swallowed PostgREST error here would
      // leave every deal in "New Lead" with today's `stage_changed_at`, and the
      // suite would report an empty due-list rather than the failed write.
      const park = (id: string, patch: Record<string, string>) =>
        db.from("opportunities").update(patch).eq("id", id).then(({ error }) => {
          if (error) throw new Error(`park ${id} failed: ${error.message}`);
        });

      // A DISTINCT NUMBER PER CONTACT. `createContact` dedupes within the
      // account on `phone_key` (`contacts.ts:120-141`), and the winner is
      // `match.emailMatch ?? match.phoneMatch` (`:150-179`) — so distinct
      // emails do NOT save a shared number: the phone match wins and all eight
      // rows collapse onto ONE contact. Every opportunity would then point at
      // that contact, the `replied` fixture's inbound message would be its
      // message, and the quiet filter would drop the entire list.
      let seq = 0;
      const mk = async (name: string, stageId: string, changedAt: Date) => {
        const phone = `(956) 555-${1200 + seq++}`;
        const { id: contactId } = await createContact(db, accountId,
          { firstName: name, email: `${name.toLowerCase()}@example.com`, phone }, "user_test");
        const opp = await createOpportunity(db, accountId, { contactId, pipelineId, name: "Reroof" }, "user_test");
        await park(opp.id, { stage_id: stageId, stage_changed_at: changedAt.toISOString() });
        return { oppId: opp.id, contactId };
      };

      const due = await mk("Due", quoted.id, new Date(now.getTime() - 5 * DAY));
      // ONE MINUTE either side of the three-day bound, never "yesterday".
      const atBound = await mk("Atbound", quoted.id, new Date(now.getTime() - 3 * DAY));
      const tooFresh = await mk("Fresh", quoted.id, new Date(now.getTime() - 3 * DAY + MINUTE));
      const tooOld = await mk("Old", quoted.id, new Date(now.getTime() - QUOTE_FOLLOWUP_MAX_AGE_MS - MINUTE));
      const elsewhere = await mk("Elsewhere", other.id, new Date(now.getTime() - 5 * DAY));
      const won = await mk("Won", quoted.id, new Date(now.getTime() - 5 * DAY));
      await park(won.oppId, { status: "won" });
      const stamped = await mk("Stamped", quoted.id, new Date(now.getTime() - 5 * DAY));
      await stampQuoteFollowupSent(db, stamped.oppId);

      // The one who already replied — AFTER the stage changed.
      const replied = await mk("Replied", quoted.id, new Date(now.getTime() - 5 * DAY));
      const convo = await ensureConversation(db, accountId, replied.contactId, "user_test");
      const { id: msg } = await createMessage(db, accountId,
        { conversationId: convo.id, channel: "sms", direction: "inbound", body: "got it, thanks" }, "user_test");
      await db.from("messages").update({ created_at: new Date(now.getTime() - 2 * DAY).toISOString() }).eq("id", msg)
        .then(({ error }) => { if (error) throw new Error(`replied message clock failed: ${error.message}`); });

      // And one whose only inbound message is OLDER than the stage change —
      // the negative that keeps the quiet test from being "has ever written".
      //
      // ITS POSITION IS THE WHOLE POINT, and it is not "nine days ago". The
      // read is scoped to the EARLIEST stage change in the candidate set
      // (`sinceIso`, here now−5d from `due` and `replied`), so a message four
      // days older than that never enters the map at all and the row would
      // survive on `!replied` alone — leaving the `<=` comparison untested and
      // the mutation below unable to red. So: stage changed four days ago, the
      // message ONE MINUTE before that. It is inside the scan window, it IS in
      // the map, and only the per-row comparison keeps it.
      const wroteBefore = await mk("Before", quoted.id, new Date(now.getTime() - 4 * DAY));
      const convo2 = await ensureConversation(db, accountId, wroteBefore.contactId, "user_test");
      const { id: msg2 } = await createMessage(db, accountId,
        { conversationId: convo2.id, channel: "sms", direction: "inbound", body: "can you quote this?" }, "user_test");
      await db.from("messages").update({ created_at: new Date(now.getTime() - 4 * DAY - MINUTE).toISOString() }).eq("id", msg2)
        .then(({ error }) => { if (error) throw new Error(`wroteBefore message clock failed: ${error.message}`); });

      const ids = (await listDueQuoteFollowups(db, now.toISOString())).map((r) => r.opportunityId);
      expect(ids).toContain(due.oppId);
      expect(ids).toContain(atBound.oppId);
      expect(ids).toContain(wroteBefore.oppId);      // Mutation: `return !replied;` (drop the `<=` comparison) → this reds
      expect(ids).not.toContain(tooFresh.oppId);     // Mutation: query `now` instead of `quietCutoff` → this reds and nothing else does
      expect(ids).not.toContain(tooOld.oppId);       // Mutation: drop the `.gte("stage_changed_at", oldest)` floor
      expect(ids).not.toContain(elsewhere.oppId);    // Mutation: drop the stage filter
      expect(ids).not.toContain(won.oppId);          // Mutation: drop the status filter
      expect(ids).not.toContain(stamped.oppId);
      expect(ids).not.toContain(replied.oppId);      // Mutation: delete the latestInboundByContact read

      const row = (await listDueQuoteFollowups(db, now.toISOString())).find((r) => r.opportunityId === due.oppId)!;
      expect(row.brandName).toBe("Fixture Brand");
      expect(row).not.toHaveProperty("accountName");
      expect(row).not.toHaveProperty("name");        // the DEAL's name is the operator's internal words
      expect(row.stageId).toBe(quoted.id);
      expect(row.configStageId).toBe(quoted.id);
      expect(row.quietDays).toBe(3);
    });
  });

  it("a suppressed account's deal is never due, and the stamps are idempotent and separate", async () => {
    await withTestAccount(async (db, accountId) => {
      const { pipelineId } = await ensureDefaultPipeline(db, accountId);
      const pipelines = await listPipelinesWithStages(db, accountId);
      const { id: stageId } = pipelines.find((p) => p.id === pipelineId)!.stages[0]!;
      await upsertAutomation(db, accountId, "quote_followup",
        { enabled: true, body: "", config: { stageId, quietDays: 3, channel: "email" } }, "user_test");
      const now = new Date("2027-10-20T12:00:00Z");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Supp", email: "supp@example.com" }, "user_test");
      const opp = await createOpportunity(db, accountId, { contactId, pipelineId, name: "Job" }, "user_test");
      await db.from("opportunities")
        .update({ stage_id: stageId, stage_changed_at: new Date(now.getTime() - 5 * 24 * HOUR).toISOString() })
        .eq("id", opp.id)
        .then(({ error }) => { if (error) throw new Error(`park ${opp.id} failed: ${error.message}`); });

      expect((await listDueQuoteFollowups(db, now.toISOString())).map((r) => r.opportunityId)).toContain(opp.id);
      await db.from("accounts").update({ outbound_suppressed: true }).eq("id", accountId);
      expect((await listDueQuoteFollowups(db, now.toISOString())).map((r) => r.opportunityId)).not.toContain(opp.id);
      // THE WHOLE ANSWER, not `.due` alone: suppressed is `off`, and the
      // releaser writes a different sentence for `off` than for `gone`.
      expect(await getDueQuoteFollowupById(db, opp.id)).toEqual({ due: null, why: "off" });
      await db.from("accounts").update({ outbound_suppressed: false }).eq("id", accountId);

      const before = new Date();
      await stampQuoteFollowupSmsFailed(db, opp.id);
      await stampQuoteFollowupSent(db, opp.id);
      await stampQuoteFollowupSent(db, opp.id);
      expect(await countQuoteFollowupsSince(db, accountId, new Date(before.getTime() - 1000).toISOString())).toBe(1);
      // THE DOUBLE-SEND GUARD on the release path — the deal is still `open`,
      // so only `.is("quote_followup_sent_at", null)` can answer `gone` here.
      // Mutation: drop that `.is(...)` from getDueQuoteFollowupById → this reds.
      expect(await getDueQuoteFollowupById(db, opp.id)).toEqual({ due: null, why: "gone" });
    });
  });

  it("latestInboundByContact never answers out of another account's conversation", async () => {
    // A3. Both reads gained `.in("account_id", accountIds)` — for tenancy
    // (`conversations.contact_id` is a plain FK) and for the index (every
    // usable index on `messages` and `conversations` leads with `account_id`,
    // and PostgreSQL 17 has no skip scan).
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db, accountB) => {
        const { id: contactB } = await createContact(db, accountB,
          { firstName: "Answered", email: "answered@example.com" }, "user_test");
        const convo = await ensureConversation(db, accountB, contactB, "user_test");
        await createMessage(db, accountB,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "got it, thanks" }, "user_test");
        // The same account-A-message-on-B's-conversation row
        // `conversationQuietSince` above needs, and for the same reason:
        // without it the conversations read's account predicate is masked by
        // the messages read's and neither can be redded alone.
        const { id: stray } = await createMessage(db, accountA,
          { conversationId: convo.id, channel: "sms", direction: "inbound", body: "stray" }, "user_test");
        const floor = new Date(Date.now() - 60_000).toISOString();
        try {
          // B's own answer is found — so the empty map below is a refusal,
          // not an absence of data.
          expect([...(await latestInboundByContact(db, [accountB], [contactB], floor)).keys()])
            .toEqual([contactB]);
          // Mutation: drop `.in("account_id", accountIds)` from the
          // CONVERSATIONS read → account A resolves B's conversation, the
          // stray answers for it and this reds. The messages read's own
          // account predicate is not redded by this case; it is the index's
          // leading column and defence in depth, said here rather than left
          // looking provable.
          expect([...(await latestInboundByContact(db, [accountA], [contactB], floor)).keys()])
            .toEqual([]);
        } finally {
          const { error: mDel } = await db.from("messages").delete().eq("id", stray);
          if (mDel) console.error(`stray message cleanup failed: ${mDel.message}`);
        }
      });
    });
  });

  it("countQuoteFollowupsSince never counts another account's stamps", async () => {
    // Mutation: drop `.eq("account_id", accountId)` and accountA counts 1 —
    // another account's sends spending this account's AUTOMATION_DAILY_CAP.
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (_db, accountB) => {
        const { pipelineId } = await ensureDefaultPipeline(db, accountB);
        const { id: contactId } = await createContact(db, accountB,
          { firstName: "Quoted", email: "quoted@example.com" }, "user_test");
        const opp = await createOpportunity(db, accountB, { contactId, pipelineId, name: "Job" }, "user_test");
        const floor = new Date(Date.now() - 60_000).toISOString();
        await stampQuoteFollowupSent(db, opp.id);
        expect(await countQuoteFollowupsSince(db, accountB, floor)).toBe(1);
        expect(await countQuoteFollowupsSince(db, accountA, floor)).toBe(0);
      });
    });
  });
});
