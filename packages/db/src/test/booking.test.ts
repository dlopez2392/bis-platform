import { describe, it, expect } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact } from "../contacts";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getOrCreateCalendar, getCalendarByPublicId, updateCalendarSettings,
  createBooking, cancelBookingByToken, setBookingStatus,
  listBookedRanges, listUpcomingBookings, listDueReminders, stampReminderSent,
  listDueFollowups, stampFollowupSent, listBookingCreationsBetween,
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

      // The public path's own reader, round-tripped against the SAME row an
      // operator just enabled: `getCalendarByPublicId` deliberately leaves
      // `enabled` for its caller to check rather than filtering server-side
      // (the public booking page's own 404-on-disabled split), so this
      // proves the enabled flag it hands back matches what was just saved.
      const byPublicId = await getCalendarByPublicId(db, cal.public_id);
      expect(byPublicId?.id).toBe(cal.id);
      expect(byPublicId?.enabled).toBe(true);
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

  /**
   * The public booking route (a later task) calls createBooking with no
   * signed-in user — this is the actor_type='user' bug class from events.ts's
   * own comment, reproduced here rather than trusted to the route's own tests.
   */
  it("createBooking threads actorType through to the booking.created event", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Public", email: "public-booker@example.com" }, "user_test");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-05T15:00:00Z"),
          endsAt: new Date("2027-03-05T16:00:00Z") }, "public", "system");
      const { data: ev } = await db.from("events").select("actor_type")
        .eq("account_id", accountId).eq("type", "booking.created");
      expect(ev).toHaveLength(1);
      expect(ev![0]!.actor_type).toBe("system");
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
          startsAt: new Date("2027-03-02T11:30:00Z"),   // 23.5h ahead — inside [now+23h, now+24h15m]
          endsAt: new Date("2027-03-02T12:30:00Z") }, "user_test");
      await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-04T12:00:00Z"),   // far outside
          endsAt: new Date("2027-03-04T13:00:00Z") }, "user_test");
      const due = await listDueReminders(db, now.toISOString());
      expect(due.map((d) => d.bookingId)).toEqual([inWindow.id]);
      // withTestAccount's fixture account never sets from_email, so this
      // also pins the null case for the M4d sending-address field.
      expect(due[0]!.fromEmail).toBeNull();
      // No meetingUrl was given to this booking — in_person default, so null.
      expect(due[0]!.meetingUrl).toBeNull();
      await stampReminderSent(db, inWindow.id);
      expect(await listDueReminders(db, now.toISOString())).toEqual([]);
    });
  });

  it("listDueReminders carries meetingUrl through for a video booking, straight off the row", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Video", email: "video-reminder@example.com" }, "user_test");
      const now = new Date("2027-03-01T12:00:00Z");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-02T11:30:00Z"),
          endsAt: new Date("2027-03-02T12:30:00Z"),
          meetingUrl: "https://meet.example.com/reminder-room" }, "user_test");
      const due = await listDueReminders(db, now.toISOString());
      expect(due.map((d) => d.bookingId)).toEqual([booking.id]);
      expect(due[0]!.meetingUrl).toBe("https://meet.example.com/reminder-room");
    });
  });

  /**
   * The Pro-plan cadence (2026-09-05): the cron fires every 15 minutes, so
   * the window is a narrow 75-minute band ~a day out — [now+23h, now+24h15m]
   * — and the reminder lands ~24h before the booking, which is what the
   * email itself claims. Both edges are inclusive. The 60 minutes of slack
   * beyond one tick's worth is tick-timing tolerance; the overlap between
   * consecutive ticks is deduped by reminder_sent_at (pinned in the test
   * above).
   *
   * The two NEAR misses are the point, and are exactly what the Hobby-plan
   * [now, now+25h] fallback could not express: a booking two hours out is
   * NOT due (an earlier tick owned it, ~24h ago), and a booking 24h30m out
   * is NOT due either (a later tick owns it). Under the old window both of
   * those came back on the same tick, which is how bookers ended up being
   * reminded up to a day early.
   *
   * 10-minute bookings, not 30: the four fixtures sit 15 minutes apart to
   * straddle the edges, and `bookings`' no-overlap constraint rejects any
   * two booked ranges that touch on the same calendar.
   */
  it("15-minute-cadence window: due from now+23h through now+24h15m inclusive, never before or beyond", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Cadence", email: "cadence@example.com" }, "user_test");
      const now = new Date("2027-03-01T14:00:00Z");
      const mk = (startsAt: string) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(startsAt),
          endsAt: new Date(new Date(startsAt).getTime() + 10 * 60 * 1000) }, "user_test");
      await mk("2027-03-01T16:00:00Z");                     // 2h ahead — an earlier tick's job, long since sent
      await mk("2027-03-02T12:45:00Z");                     // 22h45m — the tick 15 min ago owned it
      const lowerEdge = await mk("2027-03-02T13:00:00Z");   // exactly now+23h — inclusive lower edge
      const upperEdge = await mk("2027-03-02T14:15:00Z");   // exactly now+24h15m — inclusive upper edge
      await mk("2027-03-02T14:30:00Z");                     // 24h30m — a later tick's job
      await mk("2027-03-01T13:00:00Z");                     // 1h in the past — never remind after start
      const due = await listDueReminders(db, now.toISOString());
      expect(due.map((d) => d.bookingId)).toEqual([lowerEdge.id, upperEdge.id]);
    });
  });

  /**
   * The tenant boundary behind the operator-facing `setBookingStatus` action
   * — previously untested. `.eq("account_id", accountId)` on the update is
   * what makes a wrong accountId match zero rows rather than someone else's
   * booking; `.select("id")` + the `!data?.length` check is what turns that
   * zero-row update into a throw instead of a silent no-op success.
   */
  it("setBookingStatus refuses a booking from the WRONG account, and leaves the row unchanged", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Tenant", email: "tenant-boundary@example.com" }, "user_test");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-10T15:00:00Z"),
          endsAt: new Date("2027-03-10T16:00:00Z") }, "user_test");

      await withTestAccount(async (_otherDb, otherAccountId) => {
        await expect(
          setBookingStatus(db, otherAccountId, booking.id, "cancelled", "user_test"),
        ).rejects.toThrow(/no booking/);
      });

      const { data } = await db.from("bookings").select("status").eq("id", booking.id).single();
      expect(data!.status).toBe("booked");
    });
  });

  /**
   * The half-open overlap window's boundary (`listBookedRanges`'s own
   * `.lt("starts_at", toIso).gt("ends_at", fromIso)`): a booking that
   * started BEFORE the queried window and is still running when the window
   * opens must still come back — a naive `.gte("starts_at", fromIso)` would
   * silently drop it, and the slot engine would then offer a time that
   * overlaps a real booking.
   */
  it("listBookedRanges includes a booking that straddles fromIso — starts before the window, still running when it opens", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Straddle", email: "straddle@example.com" }, "user_test");
      await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-15T14:00:00Z"),
          endsAt: new Date("2027-03-15T16:00:00Z") }, "user_test");

      // The query window opens an hour INTO the booking (15:00, after its
      // 14:00 start) and closes well after it ends — the shape a naive
      // starts_at >= fromIso filter would miss entirely.
      const ranges = await listBookedRanges(
        db, cal.id, "2027-03-15T15:00:00Z", "2027-03-15T18:00:00Z");

      expect(ranges).toHaveLength(1);
      expect(new Date(ranges[0]!.starts_at).getTime()).toBe(new Date("2027-03-15T14:00:00Z").getTime());
      expect(new Date(ranges[0]!.ends_at).getTime()).toBe(new Date("2027-03-15T16:00:00Z").getTime());
    });
  });

  /**
   * `listUpcomingBookings`'s own contact-name accessor: joined first/last
   * name for a normal contact, and its documented "Unknown" fallback for a
   * contact with neither — the shape a booking made through the public path
   * (firstName required, lastName optional) can never itself produce, but a
   * direct-insert or blueprint-applied contact could.
   */
  it("listUpcomingBookings carries the contact's name, falling back to \"Unknown\" when both are blank", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: namedContactId } = await createContact(db, accountId,
        { firstName: "Ana", lastName: "Ruiz", email: "ana@example.com" }, "user_test");
      const { id: blankContactId } = await createContact(db, accountId,
        { email: "blank-name@example.com" }, "user_test"); // no firstName/lastName at all

      const named = await createBooking(db, accountId,
        { calendarId: cal.id, contactId: namedContactId, startsAt: new Date("2027-03-20T15:00:00Z"),
          endsAt: new Date("2027-03-20T16:00:00Z") }, "user_test");
      const blank = await createBooking(db, accountId,
        { calendarId: cal.id, contactId: blankContactId, startsAt: new Date("2027-03-21T15:00:00Z"),
          endsAt: new Date("2027-03-21T16:00:00Z") }, "user_test");

      const upcoming = await listUpcomingBookings(db, accountId, "2027-03-01T00:00:00Z");

      const namedRow = upcoming.find((b) => b.id === named.id);
      const blankRow = upcoming.find((b) => b.id === blank.id);
      expect(namedRow?.contact_name).toBe("Ana Ruiz");
      expect(namedRow?.contact_email).toBe("ana@example.com");
      expect(blankRow?.contact_name).toBe("Unknown");
    });
  });

  it("calendar defaults for meeting_type/followup_enabled/followup_body", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      expect(cal.meeting_type).toBe("in_person");
      expect(cal.followup_enabled).toBe(false);
      expect(cal.followup_body).toBe("");
    });
  });

  it("updateCalendarSettings round-trips meetingType/followupEnabled/followupBody", async () => {
    await withTestAccount(async (db, accountId) => {
      await getOrCreateCalendar(db, accountId, "user_test");
      await updateCalendarSettings(db, accountId,
        { meetingType: "video", followupEnabled: true, followupBody: "Thanks for meeting!" }, "user_test");
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      expect(cal.meeting_type).toBe("video");
      expect(cal.followup_enabled).toBe(true);
      expect(cal.followup_body).toBe("Thanks for meeting!");
    });
  });

  it("createBooking persists meetingUrl when given, leaves it null otherwise", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Video", email: "video-meeting@example.com" }, "user_test");
      const withUrl = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-04-01T15:00:00Z"),
          endsAt: new Date("2027-04-01T16:00:00Z"), meetingUrl: "https://meet.example.com/abc" }, "user_test");
      const withoutUrl = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-04-02T15:00:00Z"),
          endsAt: new Date("2027-04-02T16:00:00Z") }, "user_test");
      const { data } = await db.from("bookings").select("id, meeting_url")
        .in("id", [withUrl.id, withoutUrl.id]);
      const rowWith = data!.find((r) => r.id === withUrl.id);
      const rowWithout = data!.find((r) => r.id === withoutUrl.id);
      expect(rowWith!.meeting_url).toBe("https://meet.example.com/abc");
      expect(rowWithout!.meeting_url).toBeNull();
    });
  });

  /**
   * `listDueFollowups` looks BACKWARD from `now` on `ends_at` (mirrors
   * `listDueReminders`' forward window, same 25h daily-cron tolerance):
   * booked + follow-ups enabled + ended within the last 25h + not yet
   * stamped -> due. Cancelled, already-stamped, ended >25h ago, and
   * not-yet-ended bookings are all excluded. A contact with no email still
   * comes back (contactEmail: null) -- the route decides to skip+log it.
   */
  it("listDueFollowups: due on ended-within-window, excludes cancelled/stamped/too-old/future", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await updateCalendarSettings(db, accountId,
        { followupEnabled: true, followupBody: "How did it go?" }, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Followup", email: "followup-due@example.com" }, "user_test");
      const { id: noEmailContactId } = await createContact(db, accountId,
        { firstName: "NoEmail" }, "user_test");

      const now = new Date("2027-03-10T12:00:00Z");

      const due = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-10T09:30:00Z"),
          endsAt: new Date("2027-03-10T10:00:00Z") },        // ended 2h ago
        "user_test");
      const noEmailDue = await createBooking(db, accountId,
        { calendarId: cal.id, contactId: noEmailContactId,
          startsAt: new Date("2027-03-10T10:15:00Z"),
          endsAt: new Date("2027-03-10T10:45:00Z") },        // ended 1h15m ago
        "user_test");
      const toCancel = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-10T08:00:00Z"),
          endsAt: new Date("2027-03-10T08:30:00Z") },        // ended 3.5h ago, but cancelled
        "user_test");
      await cancelBookingByToken(db, toCancel.cancelToken);
      const toStamp = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-10T07:00:00Z"),
          endsAt: new Date("2027-03-10T07:30:00Z") },        // ended 4.5h ago, but already stamped
        "user_test");
      await stampFollowupSent(db, toStamp.id);
      const tooOld = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-09T09:00:00Z"),
          endsAt: new Date("2027-03-09T09:30:00Z") },        // ended 26.5h ago
        "user_test");
      const future = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-10T12:30:00Z"),
          endsAt: new Date("2027-03-10T13:00:00Z") },        // ends in the future
        "user_test");

      const dueList = await listDueFollowups(db, now.toISOString());
      const ids = dueList.map((d) => d.bookingId);
      expect(ids).toContain(due.id);
      expect(ids).toContain(noEmailDue.id);
      expect(ids).not.toContain(toCancel.id);
      expect(ids).not.toContain(toStamp.id);
      expect(ids).not.toContain(tooOld.id);
      expect(ids).not.toContain(future.id);

      const dueRow = dueList.find((d) => d.bookingId === due.id);
      expect(dueRow?.contactEmail).toBe("followup-due@example.com");
      expect(dueRow?.followupBody).toBe("How did it go?");
      expect(dueRow?.fromEmail).toBeNull();       // fixture account never sets from_email
      expect(dueRow?.replyToEmail).toBeNull();    // fixture account never sets reply_to_email

      const noEmailRow = dueList.find((d) => d.bookingId === noEmailDue.id);
      expect(noEmailRow?.contactEmail).toBeNull();
    });
  });

  it("listDueFollowups excludes a calendar with follow-ups disabled", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test"); // followup_enabled defaults false
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Disabled", email: "followup-disabled@example.com" }, "user_test");
      const now = new Date("2027-03-12T12:00:00Z");
      await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-12T09:30:00Z"),
          endsAt: new Date("2027-03-12T10:00:00Z") }, "user_test");     // ended 2h ago
      expect(await listDueFollowups(db, now.toISOString())).toEqual([]);
    });
  });

  /**
   * The "Mark completed" trap: an operator closing out a booking on the
   * list after the meeting flips status booked -> completed, and that must
   * NOT silence the very follow-up this feature exists to send. no_show is
   * the opposite case -- deliberately still excluded (no-show messaging is
   * a recorded deferred item, not an oversight).
   */
  it("listDueFollowups includes completed bookings, excludes no_show", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await updateCalendarSettings(db, accountId,
        { followupEnabled: true, followupBody: "How did it go?" }, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Status", email: "followup-status@example.com" }, "user_test");
      const now = new Date("2027-03-11T12:00:00Z");

      const completed = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-11T09:30:00Z"),
          endsAt: new Date("2027-03-11T10:00:00Z") },        // ended 2h ago
        "user_test");
      await setBookingStatus(db, accountId, completed.id, "completed", "user_test");
      const noShow = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-11T10:15:00Z"),
          endsAt: new Date("2027-03-11T10:45:00Z") },        // ended 1h15m ago
        "user_test");
      await setBookingStatus(db, accountId, noShow.id, "no_show", "user_test");

      const ids = (await listDueFollowups(db, now.toISOString())).map((d) => d.bookingId);
      expect(ids).toContain(completed.id);
      expect(ids).not.toContain(noShow.id);
    });
  });

  it("stampFollowupSent sets the stamp and a second call is idempotent", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Stamp", email: "stamp-followup@example.com" }, "user_test");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-15T15:00:00Z"),
          endsAt: new Date("2027-03-15T16:00:00Z") }, "user_test");

      await stampFollowupSent(db, booking.id);
      const { data: first } = await db.from("bookings")
        .select("followup_sent_at").eq("id", booking.id).single();
      expect(first!.followup_sent_at).not.toBeNull();

      await expect(stampFollowupSent(db, booking.id)).resolves.toBeUndefined();
      const { data: second } = await db.from("bookings")
        .select("followup_sent_at").eq("id", booking.id).single();
      expect(second!.followup_sent_at).not.toBeNull();
    });
  });
});

describe("listBookingCreationsBetween", () => {
  it("[from, to) on created_at — pins both boundary edges, any status, cross-tenant rows excluded", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (db2, accountB) => {
        const calA = await getOrCreateCalendar(db, accountA, "user_test");
        const calB = await getOrCreateCalendar(db2, accountB, "user_test");
        const { id: contactA } = await createContact(db, accountA, { firstName: "A" }, "user_test");
        const { id: contactB } = await createContact(db2, accountB, { firstName: "B" }, "user_test");

        const from = "2027-06-01T00:00:00.000Z";
        const to = "2027-06-15T00:00:00.000Z";

        // Distinct, non-overlapping slots (unrelated to the created_at window
        // under test) so `bookings_no_overlap` never gets in the way.
        let slotDay = 1;
        async function bookingAt(
          dbc: SupabaseClient, acct: string, calId: string, contactId: string, createdIso: string,
        ) {
          const startsAt = new Date(Date.UTC(2028, 0, slotDay, 9, 0, 0));
          const endsAt = new Date(Date.UTC(2028, 0, slotDay, 10, 0, 0));
          slotDay += 1;
          const { id } = await createBooking(dbc, acct,
            { calendarId: calId, contactId, startsAt, endsAt }, "user_test");
          const { error } = await dbc.from("bookings").update({ created_at: createdIso }).eq("id", id);
          if (error) throw new Error(error.message);
          return id;
        }

        // Outside the window on both sides — excluded.
        await bookingAt(db, accountA, calA.id, contactA, "2027-05-31T23:59:59.999Z");
        await bookingAt(db, accountA, calA.id, contactA, to); // exclusive edge — excluded

        // Inside, including the inclusive `from` edge. One is cancelled
        // AFTER creation — a later status change must not erase the capture.
        await bookingAt(db, accountA, calA.id, contactA, from);
        const cancelled = await bookingAt(db, accountA, calA.id, contactA, "2027-06-10T12:00:00.000Z");
        await setBookingStatus(db, accountA, cancelled, "cancelled", "user_test");
        await bookingAt(db, accountA, calA.id, contactA, "2027-06-14T23:59:59.999Z");

        // Same window, other tenant — must not leak into accountA's result.
        await bookingAt(db2, accountB, calB.id, contactB, "2027-06-05T00:00:00.000Z");

        const result = await listBookingCreationsBetween(db, accountA, from, to);
        expect(result).toHaveLength(3);
        const times = result.map((s) => new Date(s).getTime());
        expect(times).toEqual([
          new Date(from).getTime(),
          new Date("2027-06-10T12:00:00.000Z").getTime(),
          new Date("2027-06-14T23:59:59.999Z").getTime(),
        ]);
      });
    });
  });
});
