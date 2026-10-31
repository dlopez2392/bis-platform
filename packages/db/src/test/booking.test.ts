import { describe, it, expect, vi } from "vitest";
import "dotenv/config";
import { withTestAccount } from "./fixtures";
import { createContact, setContactLanguage } from "../contacts";
import { setAccountLanguage } from "../accounts";
import { ensureConversation, createMessage, updateMessageStatus } from "../messaging";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getOrCreateCalendar, getCalendarByPublicId, updateCalendarSettings,
  createBooking, cancelBookingByToken, setBookingStatus,
  listBookedRanges, listCalendarBookings, listDueReminders, stampReminderSent,
  listDueFollowups, stampFollowupSent, listBookingCreationsBetween,
  SlotTakenError, BookingNotStartedError, BookingNotRestorableError, undoOperatorCancel,
  claimCancelNotice, rescheduleChain, bookingContactEmail, discardQueuedNotice, noticeMessageStatus,
  savePendingCancelNotice, listDueCancelNotices, deletePendingCancelNotice, readBookingStatus,
  moveBooking, BookingNotMovableError, bookingWasMoved, countRecentBookings,
  moveStamp, sameMicroInstant,
  countContactBookingsMade, listContactUpcomingBookings, listContactBookings, countBookingsMadeFor,
  createStaffJob, listAgendaBookings, claimJobHold, deleteUnsettledStaffJob, undoStaffMove, newCancelToken,
  type StaffJobInput,
} from "../booking";
import { stampAppointmentConfirmAsked, applyConfirmationReply } from "../automations";
import { addPlace } from "../places";

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
   * 0107: only a customer-made row is refused; a person-made row may overlap
   * (R1). So both rows here are the customer's own (actor "public", type
   * "system", which bookingAuthor maps to author_kind 'customer').
   */
  it("refuses an overlapping booking with SlotTakenError, and frees the range on cancel", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Booker", email: "booker@example.com" }, "user_test");
      const t0 = new Date("2027-03-02T15:00:00Z");
      const t1 = new Date("2027-03-02T16:00:00Z");
      const first = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: t0, endsAt: t1 }, "public", "system");
      await expect(createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-02T15:30:00Z"),
          endsAt: new Date("2027-03-02T16:30:00Z") }, "public", "system"),
      ).rejects.toThrow(SlotTakenError);
      // Cancel frees the range — the constraint binds status='booked' only. The re-create is the
      // customer's too: a person-made row would save over a LIVE customer row under 0107 (R1), so
      // it could not prove the cancel freed anything (T1 review I1).
      const cancelled = await cancelBookingByToken(db, first.cancelToken);
      expect(cancelled?.id).toBe(first.id);
      await expect(createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: t0, endsAt: t1 }, "public", "system"),
      ).resolves.toBeTruthy();
      // A second cancel with the same token is a null no-op, not an error.
      expect(await cancelBookingByToken(db, first.cancelToken)).toBeNull();
    });
  });

  it("F-046 (0107): two overlapping staff-made bookings both save (R1)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Staff" }, "user_test");
      await expect(createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-03T15:00:00Z"),
          endsAt: new Date("2027-03-03T16:00:00Z") }, "user_test")).resolves.toBeTruthy();
      await expect(createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-03T15:30:00Z"),
          endsAt: new Date("2027-03-03T16:30:00Z") }, "user_test")).resolves.toBeTruthy();
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

  /**
   * Same bug class, the other writer: the phone receptionist cancels and
   * reschedules through setBookingStatus, and an event with no actorType
   * defaulted to 'user' — crediting a signed-in person with a change the AI
   * made on a call. Both halves are pinned: the passed value lands, and every
   * existing caller that passes nothing keeps 'user'.
   */
  it("setBookingStatus threads actorType through to the booking.status_changed event, 'user' when omitted", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Status", email: "status-changer@example.com" }, "user_test");
      const byVoice = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-06T15:00:00Z"),
          endsAt: new Date("2027-03-06T16:00:00Z") }, "user_test");
      const byOperator = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-07T15:00:00Z"),
          endsAt: new Date("2027-03-07T16:00:00Z") }, "user_test");
      await setBookingStatus(db, accountId, byVoice.id, "cancelled", "voice", "ai");
      await setBookingStatus(db, accountId, byOperator.id, "completed", "user_test");
      const { data: ev } = await db.from("events").select("actor_type, actor_id, payload")
        .eq("account_id", accountId).eq("type", "booking.status_changed");
      expect(ev).toHaveLength(2);
      const rows = (ev ?? []) as { actor_type: string; actor_id: string; payload: { bookingId: string } }[];
      const voiceRow = rows.find((r) => r.payload.bookingId === byVoice.id);
      const operatorRow = rows.find((r) => r.payload.bookingId === byOperator.id);
      expect(voiceRow?.actor_type).toBe("ai");
      expect(voiceRow?.actor_id).toBe("voice");
      expect(operatorRow?.actor_type).toBe("user");
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
      // Booked months ahead: the day-before window owns it, so not "late" —
      // its reminder keeps the appointment itself as its deadline.
      expect(due[0]!.late).toBe(false);
      // The agency's internal label has no field on this row and no column
      // behind it: ACCOUNT_BRAND_COLS does not select `name` at all. Same pin
      // the three newer due-row shapes carry in automations.test.ts.
      // Mutation: put `accountName: acct.name` back in loadAccountBrandInfo
      // (and `name` back in ACCOUNT_BRAND_COLS).
      expect(due[0]!).not.toHaveProperty("accountName");
      await stampReminderSent(db, inWindow.id);
      expect(await listDueReminders(db, now.toISOString())).toEqual([]);
    });
  });

  it("a suppressed account has no due work, however due the row is", async () => {
    // Migration 0032. The cron runs every pass against serviceDb() with no
    // account filter, so this flag is the only thing standing between a demo
    // company's seeded bookings and real mail to its made-up contacts.
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Demo", email: "demo@example.com" }, "user_test");
      const now = new Date("2027-03-01T12:00:00Z");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-02T11:30:00Z"),
          endsAt: new Date("2027-03-02T12:30:00Z") }, "user_test");

      // Due while the account sends, so the suppression below is what changes
      // the answer — not a booking that was never eligible.
      expect((await listDueReminders(db, now.toISOString())).map((d) => d.bookingId))
        .toEqual([booking.id]);

      const { error } = await db.from("accounts")
        .update({ outbound_suppressed: true }).eq("id", accountId);
      expect(error).toBeNull();

      expect(await listDueReminders(db, now.toISOString())).toEqual([]);

      // And it is the flag, not a one-way door: clearing it restores the row.
      await db.from("accounts").update({ outbound_suppressed: false }).eq("id", accountId);
      expect((await listDueReminders(db, now.toISOString())).map((d) => d.bookingId))
        .toEqual([booking.id]);
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
   * D-029. The day-before window ([now+23h, now+24h15m]) can only ever see a
   * booking that existed ~24h before it starts, so anything booked less than
   * about a day ahead never got a reminder at all. The rule now: a booking
   * made LATE — less than the day-before window's full span ahead, so that
   * window may never have seen it — gets one reminder 3h-4h15m before it
   * starts, provided it was made at least an hour before that tick (the
   * confirmation went out at booking time; a reminder minutes later is
   * noise).
   *
   * Why it cannot double-send: the late window ends at now+4h15m and the
   * day-before window starts at now+23h, so one tick can never list a booking
   * twice; and across ticks `reminder_sent_at` dedupes exactly as it already
   * does for the day-before window. A booking made a day or more ahead is not
   * late, so a day-before reminder that was sent, skipped or blocked is never
   * repeated by this path. Past appointments are below the window's start.
   *
   * `created_at` is backdated by a direct update (the column defaults to the
   * real now(), and every instant here is pinned). Filtered to this account,
   * because the due list is global and the shared project is not.
   */
  it("D-029: a booking made less than a day ahead is reminded 3h-4h15m before it starts, once, and only if made at least an hour before", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Late", email: "late-booker@example.com" }, "user_test");
      const now = new Date("2027-04-05T14:00:00Z");
      const H = 60 * 60 * 1000;
      const mk = async (startsAt: string, createdAgoMs: number) => {
        const b = await createBooking(db, accountId,
          { calendarId: cal.id, contactId, startsAt: new Date(startsAt),
            endsAt: new Date(new Date(startsAt).getTime() + 10 * 60 * 1000) }, "user_test");
        const { error } = await db.from("bookings")
          .update({ created_at: new Date(now.getTime() - createdAgoMs).toISOString() }).eq("id", b.id);
        if (error) throw new Error(error.message);
        return b.id;
      };
      const lowerEdge = await mk("2027-04-05T17:00:00Z", 6 * H);    // exactly now+3h, booked 9h ahead
      // THE "made late" boundary is the day-before window's whole span,
      // 24h15m (REMINDER_WINDOW_END_MS), not its start (23h). A booking made
      // 23h10m ahead may have missed the day-before window, so it is late; one
      // made 24h20m ahead was inside it, so it is not. Mutation: compare
      // against REMINDER_WINDOW_START_MS → the 23h10m row drops → FAILS.
      const boundaryLate = await mk("2027-04-05T17:10:00Z", 20 * H);   // booked 23h10m ahead → listed
      await mk("2027-04-05T17:20:00Z", 21 * H);                         // booked 24h20m ahead → not listed
      const late = await mk("2027-04-05T17:30:00Z", 6 * H);         // 3h30m out, booked 9h30m ahead — the defect's row
      await mk("2027-04-05T17:45:00Z", 0.5 * H);                    // booked 30 min ago: the confirmation is enough
      await mk("2027-04-05T18:00:00Z", 48 * H);                     // booked 2 days ahead: the day-before window owned it
      const upperEdge = await mk("2027-04-05T18:15:00Z", 6 * H);    // exactly now+4h15m — inclusive upper edge
      await mk("2027-04-05T18:30:00Z", 6 * H);                      // 4h30m — a later tick's job
      await mk("2027-04-05T16:30:00Z", 6 * H);                      // 2h30m — an earlier tick's job
      await mk("2027-04-05T13:00:00Z", 6 * H);                      // already started — never remind after start

      const mine = async () => (await listDueReminders(db, now.toISOString()))
        .filter((d) => d.accountId === accountId).map((d) => d.bookingId);
      expect(await mine()).toEqual([lowerEdge, boundaryLate, late, upperEdge]);
      // Every row this window lists is flagged late — the reminders pass reads
      // the flag to give it the earlier deadline (see reminderDeadline).
      expect((await listDueReminders(db, now.toISOString())).filter((d) => d.accountId === accountId)
        .every((d) => d.late)).toBe(true);

      // Once stamped, never again — the same dedupe the day-before window uses.
      await stampReminderSent(db, late);
      expect(await mine()).toEqual([lowerEdge, boundaryLate, upperEdge]);
    });
  });

  /**
   * D-030. "Completed" and "no-show" are outcomes, and an appointment has an
   * outcome only once it has STARTED. Marking a future job no-show was not
   * just wrong on screen: it stamps no_show_at, which arms the no-show nudge
   * to the customer. The guard is the `startedBy` option, which the operator
   * action passes; omitted (seed, tests, the voice receptionist's cancel), the
   * write is unchanged. Cancel is never an outcome and is never refused.
   */
  it("D-030: setBookingStatus with startedBy refuses completed/no_show on a booking that has not started, leaves it booked, and allows both once it has", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Outcome" }, "user_test");
      const future = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-05-10T15:00:00Z"),
          endsAt: new Date("2027-05-10T16:00:00Z") }, "user_test");
      const started = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-05-09T15:00:00Z"),
          endsAt: new Date("2027-05-09T16:00:00Z") }, "user_test");
      const startedBy = "2027-05-09T15:30:00Z"; // in the middle of `started`, a day before `future`
      const statusOf = async (id: string) => {
        const { data, error } = await db.from("bookings").select("status, completed_at, no_show_at").eq("id", id).single();
        if (error) throw new Error(error.message);
        return data as { status: string; completed_at: string | null; no_show_at: string | null };
      };

      for (const outcome of ["completed", "no_show"] as const) {
        await expect(setBookingStatus(db, accountId, future.id, outcome, "user_test", "user", { startedBy }))
          .rejects.toBeInstanceOf(BookingNotStartedError);
      }
      expect(await statusOf(future.id)).toEqual({ status: "booked", completed_at: null, no_show_at: null });

      await setBookingStatus(db, accountId, started.id, "no_show", "user_test", "user", { startedBy });
      expect((await statusOf(started.id)).status).toBe("no_show");
      await setBookingStatus(db, accountId, started.id, "completed", "user_test", "user", { startedBy });
      expect((await statusOf(started.id)).status).toBe("completed");

      // Cancel is not an outcome: a future booking is cancellable under the guard.
      await setBookingStatus(db, accountId, future.id, "cancelled", "user_test", "user", { startedBy });
      expect((await statusOf(future.id)).status).toBe("cancelled");

      // The wrong account is still "no booking", not "not started".
      await expect(setBookingStatus(db, "00000000-0000-0000-0000-000000000000", started.id, "completed",
        "user_test", "user", { startedBy })).rejects.toThrow(/no booking/);
    });
  });

  /**
   * D-036: Cancel on the Calendar page runs at once and offers Undo, and Undo
   * is `setBookingStatus(…, "booked", …, { onlyFrom: "cancelled" })`. Two
   * things the un-cancel needs that the write did not have:
   *  - the flip back re-enters `bookings_no_overlap` (the constraint binds
   *    status='booked' only, and Postgres re-checks it on UPDATE), so a time
   *    someone else booked in between must surface as `SlotTakenError`, the
   *    same class `createBooking` throws, not a generic failure;
   *  - `onlyFrom` makes it an un-CANCEL only, as a predicate on the UPDATE: a
   *    stale Undo on a booking since marked completed must not reopen it.
   */
  it("D-036: un-cancel restores a cancelled booking, refuses a taken slot as SlotTakenError, and only ever flips FROM cancelled", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Undo" }, "user_test");
      const statusOf = async (id: string) => {
        const { data, error } = await db.from("bookings").select("status").eq("id", id).single();
        if (error) throw new Error(error.message);
        return (data as { status: string }).status;
      };
      const range = (day: string) => ({
        calendarId: cal.id, contactId,
        startsAt: new Date(`2027-06-${day}T15:00:00Z`), endsAt: new Date(`2027-06-${day}T16:00:00Z`),
      });

      // Restored: back to booked, with its own event.
      const a = await createBooking(db, accountId, range("01"), "user_test");
      await setBookingStatus(db, accountId, a.id, "cancelled", "user_test");
      await setBookingStatus(db, accountId, a.id, "booked", "user_test", "user", { onlyFrom: "cancelled" });
      expect(await statusOf(a.id)).toBe("booked");
      const { data: ev } = await db.from("events").select("payload")
        .eq("account_id", accountId).eq("type", "booking.status_changed")
        .order("created_at", { ascending: true });
      expect((ev ?? []).map((r) => (r as { payload: { status: string } }).payload.status))
        .toEqual(["cancelled", "booked"]);

      // Someone booked the freed time in between: SlotTakenError, still cancelled.
      // 0107: only a customer-made row is refused, so `b` is the customer's own
      // booking (actor type "system"): its un-cancel re-enters the rule.
      const b = await createBooking(db, accountId, range("02"), "public", "system");
      await setBookingStatus(db, accountId, b.id, "cancelled", "user_test");
      await createBooking(db, accountId, range("02"), "public", "system");
      await expect(setBookingStatus(db, accountId, b.id, "booked", "user_test", "user", { onlyFrom: "cancelled" }))
        .rejects.toBeInstanceOf(SlotTakenError);
      expect(await statusOf(b.id)).toBe("cancelled");

      // 0107 (R1): a staff job comes back beside a customer booking made in between.
      const c2 = await createBooking(db, accountId, range("04"), "user_test");
      await setBookingStatus(db, accountId, c2.id, "cancelled", "user_test");
      await createBooking(db, accountId, range("04"), "public", "system");
      await expect(setBookingStatus(db, accountId, c2.id, "booked", "user_test", "user", { onlyFrom: "cancelled" }))
        .resolves.toBeTruthy();
      expect(await statusOf(c2.id)).toBe("booked");

      // Not cancelled any more: refused, and left exactly as it was.
      const c = await createBooking(db, accountId, range("03"), "user_test");
      await setBookingStatus(db, accountId, c.id, "completed", "user_test");
      await expect(setBookingStatus(db, accountId, c.id, "booked", "user_test", "user", { onlyFrom: "cancelled" }))
        .rejects.toThrow(/no booking/);
      expect(await statusOf(c.id)).toBe("completed");
    });
  });

  /**
   * D-036 review: the Calendar page's Undo puts back only what a PERSON on
   * this screen cancelled. A cancel by the customer's own link, or by Sofía
   * on a call, is the customer's decision and the operator's Undo must not
   * reverse it; and a booking a reschedule replaced (a newer row's
   * `rescheduled_from_id` points at it) would come back as a second live
   * appointment beside its replacement.
   */
  it("D-036: undoOperatorCancel restores an operator's cancel, and refuses a reschedule's original and a customer's or Sofía's cancel", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Undo2" }, "user_test");
      const statusOf = async (id: string) => {
        const { data, error } = await db.from("bookings").select("status").eq("id", id).single();
        if (error) throw new Error(error.message);
        return (data as { status: string }).status;
      };
      const range = (day: string) => ({
        calendarId: cal.id, contactId,
        startsAt: new Date(`2027-07-${day}T15:00:00Z`), endsAt: new Date(`2027-07-${day}T16:00:00Z`),
      });
      const reason = async (p: Promise<unknown>) => {
        try { await p; } catch (e) { return e instanceof BookingNotRestorableError ? e.reason : String(e); }
        return "restored";
      };

      const own = await createBooking(db, accountId, range("01"), "user_test");
      const ownCancel = await setBookingStatus(db, accountId, own.id, "cancelled", "user_test");
      expect(await reason(undoOperatorCancel(db, accountId, own.id, "user_test", ownCancel.updatedAt))).toBe("restored");
      expect(await statusOf(own.id)).toBe("booked");

      const moved = await createBooking(db, accountId, range("02"), "user_test");
      // A PERSON cancelled it, so only the reschedule check can refuse it.
      const movedCancel = await setBookingStatus(db, accountId, moved.id, "cancelled", "user_test");
      await createBooking(db, accountId, { ...range("03"), rescheduledFromId: moved.id }, "user_test");
      expect(await reason(undoOperatorCancel(db, accountId, moved.id, "user_test", movedCancel.updatedAt))).toBe("rescheduled");
      expect(await statusOf(moved.id)).toBe("cancelled");

      const byLink = await createBooking(db, accountId, range("04"), "user_test");
      const linkRow = await cancelBookingByToken(db, byLink.cancelToken);
      expect(await reason(undoOperatorCancel(db, accountId, byLink.id, "user_test", (linkRow as unknown as { updated_at: string }).updated_at))).toBe("not_operator_cancel");
      expect(await statusOf(byLink.id)).toBe("cancelled");

      const bySofia = await createBooking(db, accountId, range("05"), "user_test");
      const sofiaCancel = await setBookingStatus(db, accountId, bySofia.id, "cancelled", "voice", "ai");
      expect(await reason(undoOperatorCancel(db, accountId, bySofia.id, "user_test", sofiaCancel.updatedAt))).toBe("not_operator_cancel");
      expect(await statusOf(bySofia.id)).toBe("cancelled");

      // "Who cancelled" is THIS booking's newest cancel, never the account's.
      // Each step above undoes the account's newest cancel, so an unscoped
      // read passed them all. Here a newer cancel of ANOTHER booking
      // disagrees, in both directions (mutation: drop the
      // `payload->>bookingId` filter → FAILS).
      const mine = await createBooking(db, accountId, range("06"), "user_test");
      const theirs = await createBooking(db, accountId, range("07"), "user_test");
      const mineCancel = await setBookingStatus(db, accountId, mine.id, "cancelled", "user_test");
      await setBookingStatus(db, accountId, theirs.id, "cancelled", "voice", "ai"); // newer, Sofía's
      expect(await reason(undoOperatorCancel(db, accountId, mine.id, "user_test", mineCancel.updatedAt))).toBe("restored");

      const sofias = await createBooking(db, accountId, range("08"), "user_test");
      const later = await createBooking(db, accountId, range("09"), "user_test");
      const sofiasCancel = await setBookingStatus(db, accountId, sofias.id, "cancelled", "voice", "ai");
      await setBookingStatus(db, accountId, later.id, "cancelled", "user_test"); // newer, a person's
      expect(await reason(undoOperatorCancel(db, accountId, sofias.id, "user_test", sofiasCancel.updatedAt))).toBe("not_operator_cancel");
      expect(await statusOf(sofias.id)).toBe("cancelled");
    });
  });

  /**
   * D-030's other half: the operator's list began at `now` on `starts_at`, so
   * an appointment vanished from it the moment it started — exactly when it
   * could first be marked. It now also carries every appointment that has
   * started and is still `booked` (in progress, or over and waiting for an
   * outcome — the same rows the To do screen's stale-booking source lists),
   * while past rows that already HAVE an outcome stay off it.
   */
  it("D-030: listCalendarBookings carries started bookings still waiting for an outcome, and leaves out past ones that have one", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "List" }, "user_test");
      const mk = (startsAt: string, endsAt: string) => createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(startsAt), endsAt: new Date(endsAt) }, "user_test");
      const now = "2027-06-10T12:00:00.000Z";
      const waiting = await mk("2027-06-08T15:00:00Z", "2027-06-08T16:00:00Z");     // over, still booked
      const done = await mk("2027-06-08T17:00:00Z", "2027-06-08T18:00:00Z");        // over, completed
      await setBookingStatus(db, accountId, done.id, "completed", "user_test");
      const gone = await mk("2027-06-09T09:00:00Z", "2027-06-09T10:00:00Z");        // over, cancelled
      await setBookingStatus(db, accountId, gone.id, "cancelled", "user_test");
      const inProgress = await mk("2027-06-10T11:30:00Z", "2027-06-10T12:30:00Z");  // started 30 min ago
      const upcoming = await mk("2027-06-11T09:00:00Z", "2027-06-11T10:00:00Z");

      const ids = (await listCalendarBookings(db, accountId, now)).map((b) => b.id);
      expect(ids).toEqual([waiting.id, inProgress.id, upcoming.id]);
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
   * The automation clocks (spec, "Decisions taken after Milestone A shipped"):
   * `completed_at` / `no_show_at` are stamped on the flip TO that status so
   * the review request and the no-show nudge can run from the operator's
   * action, not only from ends_at. Never cleared on a flip away (the status
   * filter does the excluding); a re-flip re-stamps. Watched failing BEFORE
   * 0026: PostgREST answers PGRST204 (no such column in the schema cache).
   * Mutation: drop `...stamp` from setBookingStatus's update.
   */
  it("setBookingStatus stamps completed_at / no_show_at on the flip to that status, keeps them on a flip away, re-stamps on a re-flip", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Clock" }, "user_test");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-03-20T15:00:00Z"),
          endsAt: new Date("2027-03-20T16:00:00Z") }, "user_test");
      const read = async () => {
        const { data, error } = await db.from("bookings")
          .select("status, completed_at, no_show_at").eq("id", booking.id).single();
        if (error) throw new Error(error.message);
        return data as { status: string; completed_at: string | null; no_show_at: string | null };
      };
      expect(await read()).toEqual({ status: "booked", completed_at: null, no_show_at: null });

      const before = Date.now() - 1000;
      await setBookingStatus(db, accountId, booking.id, "completed", "user_test");
      const completed = await read();
      expect(completed.status).toBe("completed");
      expect(new Date(completed.completed_at!).getTime()).toBeGreaterThanOrEqual(before);
      expect(completed.no_show_at).toBeNull();

      await setBookingStatus(db, accountId, booking.id, "booked", "user_test");
      expect((await read()).completed_at).toBe(completed.completed_at);     // kept, not cleared

      await new Promise((r) => setTimeout(r, 10));
      await setBookingStatus(db, accountId, booking.id, "completed", "user_test");
      expect(new Date((await read()).completed_at!).getTime())
        .toBeGreaterThan(new Date(completed.completed_at!).getTime());       // re-stamped

      await setBookingStatus(db, accountId, booking.id, "no_show", "user_test");
      const noShow = await read();
      expect(noShow.status).toBe("no_show");
      expect(noShow.no_show_at).not.toBeNull();
      expect(noShow.completed_at).not.toBeNull();                            // never cleared
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
   * `listCalendarBookings`'s own contact-name accessor: joined first/last
   * name for a normal contact, and its documented "Unknown" fallback for a
   * contact with neither — the shape a booking made through the public path
   * (firstName required, lastName optional) can never itself produce, but a
   * direct-insert or blueprint-applied contact could.
   */
  it("listCalendarBookings carries the contact's name, falling back to \"Unknown\" when both are blank", async () => {
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

      const upcoming = await listCalendarBookings(db, accountId, "2027-03-01T00:00:00Z");

      const namedRow = upcoming.find((b) => b.id === named.id);
      const blankRow = upcoming.find((b) => b.id === blank.id);
      expect(namedRow?.contact_name).toBe("Ana Ruiz");
      expect(namedRow?.contact_email).toBe("ana@example.com");
      expect(blankRow?.contact_name).toBe("Unknown");
    });
  });

  /**
   * THE `BOOKING_COLS` BINDING. Nothing else in this repo asserts that the
   * confirmation answer survives a READ: every other test that touches those
   * two columns reaches for them with a direct `.select("confirm_reply")`
   * (automations.test.ts, automations-b-schema.test.ts), which stays green
   * however `BOOKING_COLS` is edited. So a later edit that drops either name
   * from that string leaves the whole suite green while
   * `listCalendarBookings` quietly returns rows without it — and the
   * operator's bookings list, the ONE screen this feature has, stops
   * rendering the pill in production with nothing red anywhere.
   *
   * One assertion chain binds `BOOKING_COLS` -> `BookingRow` -> the
   * component's data source, through the real writer (the inbound SMS
   * webhook's `applyConfirmationReply`) rather than a hand-made UPDATE.
   *
   * Mutation: delete `confirm_reply` — or `confirm_reply_at` — from
   * `BOOKING_COLS` in `booking.ts`; this reds by name. The `confirm_reply_at`
   * assertion is an instant EQUALITY, not `.not.toBeNull()`: a dropped column
   * comes back `undefined`, and `expect(undefined).not.toBeNull()` passes.
   */
  it("listCalendarBookings carries the confirmation answer the SMS webhook wrote (BOOKING_COLS round-trip)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId,
        { firstName: "Confirmer", email: "confirmer@example.com" }, "user_test");
      const now = new Date("2027-05-10T12:00:00Z");
      const booking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date("2027-05-12T15:00:00Z"),
          endsAt: new Date("2027-05-12T16:00:00Z") }, "user_test");

      await stampAppointmentConfirmAsked(db, booking.id);
      expect(await applyConfirmationReply(db, accountId, contactId, "YES", now)).toBe("yes");

      const row = (await listCalendarBookings(db, accountId, "2027-05-01T00:00:00Z"))
        .find((b) => b.id === booking.id);
      expect(row).toBeDefined();
      expect(row!.confirm_reply).toBe("yes");
      expect(new Date(row!.confirm_reply_at!).getTime()).toBe(now.getTime());
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
   * `listDueFollowups` looks BACKWARD from `now` on `ends_at`: booked +
   * follow-ups enabled + ended within the last 37h + not yet stamped -> a
   * CANDIDATE. Cancelled, already-stamped, ended >37h ago, and not-yet-ended
   * bookings are all excluded. A contact with no email still comes back
   * (contactEmail: null) -- the route decides to skip+log it.
   *
   * Candidate, not due: since 2026-09-05 this window deliberately over-selects
   * so the route's send-time gate (`shouldSendFollowupNow`, unit tested in
   * apps/web) can pick the right MOMENT -- the next morning in the account's
   * own timezone. 37h is that gate's worst case; the derivation lives on the
   * function's doc comment. What this test still owns is the SQL-level
   * predicate, which the gate cannot compensate for either way.
   */
  it("listDueFollowups: candidate on ended-within-window, excludes cancelled/stamped/too-old/future", async () => {
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
      // 38h ago — past the 37h cap. Under the old 25h window this fixture sat
      // at 26.5h; the widening moved it, and it has to stay OUTSIDE, because
      // this window is the only thing standing between a multi-day outage and
      // a mailbox full of follow-ups for forgotten meetings.
      const tooOld = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-08T21:30:00Z"),
          endsAt: new Date("2027-03-08T22:00:00Z") },        // ended 38h ago
        "user_test");
      // 36h ago — inside the cap by an hour, so the boundary is pinned from
      // both sides rather than only from the excluded one.
      const oldButInside = await createBooking(db, accountId,
        { calendarId: cal.id, contactId,
          startsAt: new Date("2027-03-08T23:30:00Z"),
          endsAt: new Date("2027-03-09T00:00:00Z") },        // ended 36h ago
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
      expect(ids).toContain(oldButInside.id);
      expect(ids).not.toContain(toCancel.id);
      expect(ids).not.toContain(toStamp.id);
      expect(ids).not.toContain(tooOld.id);
      expect(ids).not.toContain(future.id);

      const dueRow = dueList.find((d) => d.bookingId === due.id);
      expect(dueRow?.contactEmail).toBe("followup-due@example.com");
      // Same pin as listDueReminders': no agency label on the row, and no
      // `name` in the projection behind it.
      expect(dueRow!).not.toHaveProperty("accountName");
      // ends_at was previously FILTERED on but never selected. The route's
      // send-time gate measures the next morning from when the meeting ENDED,
      // so a query that forgot to project this column would hand the gate an
      // undefined instant and silently never send.
      expect(new Date(dueRow!.endsAt).getTime())
        .toBe(new Date("2027-03-10T10:00:00Z").getTime());
      expect(dueRow?.followupBody).toBe("How did it go?");
      expect(dueRow?.fromEmail).toBeNull();       // fixture account never sets from_email
      expect(dueRow?.replyToEmail).toBeNull();    // fixture account never sets reply_to_email
      // S-09 PR 2: neither the contact nor the account set a language -> English, and the
      // calendar's Spanish follow-up box is untouched -> null.
      expect(dueRow!.language).toBe("en");
      expect(dueRow!.followupBodyEs).toBeNull();

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

/**
 * D-035 (migration 0061). Sofía's reschedule cancels the old booking and
 * creates a new one, and the new one names the old through
 * `rescheduled_from_id`. A reschedule is not a new booking, so the creation
 * count — the dashboard's bookings number and chart, the Monday report and
 * the agency roll-up, all of which read `listBookingCreationsBetween` — leaves
 * linked rows out, while the ORIGINAL keeps the bar it earned when it was made
 * (it is cancelled afterwards, and a cancel never erased a capture).
 */
describe("reschedule link (0061, D-035)", () => {
  it("createBooking writes rescheduledFromId when given, and null when not", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const original = await createBooking(db, accountId, {
        calendarId: cal.id, contactId,
        startsAt: new Date("2029-02-01T15:00:00Z"), endsAt: new Date("2029-02-01T16:00:00Z"),
      }, "voice", "ai");
      const moved = await createBooking(db, accountId, {
        calendarId: cal.id, contactId,
        startsAt: new Date("2029-02-02T15:00:00Z"), endsAt: new Date("2029-02-02T16:00:00Z"),
        rescheduledFromId: original.id,
      }, "voice", "ai");
      const { data, error } = await db.from("bookings").select("id, rescheduled_from_id")
        .in("id", [original.id, moved.id]);
      if (error) throw new Error(error.message);
      const byId = Object.fromEntries((data ?? []).map((r) => [r.id, r.rescheduled_from_id]));
      expect(byId).toEqual({ [original.id]: null, [moved.id]: original.id });
    });
  });

  it("createBooking refuses a link to another account's booking (the composite FK, surfaced by name)", async () => {
    await withTestAccount(async (db, accountA) => {
      await withTestAccount(async (db2, accountB) => {
        const calA = await getOrCreateCalendar(db, accountA, "user_test");
        const calB = await getOrCreateCalendar(db2, accountB, "user_test");
        const { id: contactA } = await createContact(db, accountA, { firstName: "A" }, "user_test");
        const { id: contactB } = await createContact(db2, accountB, { firstName: "B" }, "user_test");
        const theirs = await createBooking(db2, accountB, {
          calendarId: calB.id, contactId: contactB,
          startsAt: new Date("2029-03-01T15:00:00Z"), endsAt: new Date("2029-03-01T16:00:00Z"),
        }, "user_test");
        await expect(createBooking(db, accountA, {
          calendarId: calA.id, contactId: contactA,
          startsAt: new Date("2029-03-02T15:00:00Z"), endsAt: new Date("2029-03-02T16:00:00Z"),
          rescheduledFromId: theirs.id,
        }, "voice", "ai")).rejects.toThrow(/bookings_rescheduled_from_fkey/);
        // Nothing was written on A.
        const { count } = await db.from("bookings").select("id", { count: "exact", head: true })
          .eq("account_id", accountA);
        expect(count).toBe(0);
      });
    });
  });

  it("listBookingCreationsBetween counts the original and leaves its replacement out", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const from = "2027-07-01T00:00:00.000Z";
      const to = "2027-07-08T00:00:00.000Z";
      const stamp = async (id: string, createdIso: string) => {
        const { error } = await db.from("bookings").update({ created_at: createdIso }).eq("id", id);
        if (error) throw new Error(error.message);
      };

      // The reschedule exactly as the receptionist does it: the new slot is
      // booked first, naming the old; then the old is cancelled.
      const original = await createBooking(db, accountId, {
        calendarId: cal.id, contactId,
        startsAt: new Date("2029-04-01T15:00:00Z"), endsAt: new Date("2029-04-01T16:00:00Z"),
      }, "user_test");
      await stamp(original.id, "2027-07-02T10:00:00.000Z");
      const moved = await createBooking(db, accountId, {
        calendarId: cal.id, contactId,
        startsAt: new Date("2029-04-03T15:00:00Z"), endsAt: new Date("2029-04-03T16:00:00Z"),
        rescheduledFromId: original.id,
      }, "voice", "ai");
      await setBookingStatus(db, accountId, original.id, "cancelled", "voice", "ai");
      await stamp(moved.id, "2027-07-04T10:00:00.000Z");

      // The control: an unlinked booking in the same window still counts, so
      // the result is not "everything after the first row" or "nothing new".
      const fresh = await createBooking(db, accountId, {
        calendarId: cal.id, contactId,
        startsAt: new Date("2029-04-05T15:00:00Z"), endsAt: new Date("2029-04-05T16:00:00Z"),
      }, "user_test");
      await stamp(fresh.id, "2027-07-05T10:00:00.000Z");

      const result = await listBookingCreationsBetween(db, accountId, from, to);
      expect(result.map((s) => new Date(s).toISOString())).toEqual([
        "2027-07-02T10:00:00.000Z", // the original, though it is now cancelled
        "2027-07-05T10:00:00.000Z", // the unrelated new booking
      ]);
    });
  });
});

// The reminder and the follow-up reach the customer and the calendar through
// `bookings.contact_id` / `bookings.calendar_id`. Since 0050 both are composite
// FKs onto `(account_id, id)`, so a booking on another account's contact or
// calendar cannot be written; the block that stood here built exactly those
// rows to prove `ownAccountEmbedsOnly`. The refusal is proved in
// same-account-fk-schema.test.ts; the guard stays in booking.ts as defence in
// depth; the own-account due rows are proved above and in due-by-id.test.ts.

/**
 * F-048 (rider). Two things the Calendar page's Cancel and the customer's
 * add-to-calendar file need from the row.
 *
 * THE NOTICE'S CLAIM. A business-side cancel can now tell the customer, but
 * only once its Undo window has closed (rule 6: an Undo that arrives after
 * the customer was told is not an Undo). `bookings.updated_at`, which only a
 * status write sets, is the cancel's VERSION: the Undo writes only while the
 * row still carries it, and the notice claims the row by moving it on. The two
 * are conditional UPDATEs of one row, so Postgres serialises them and exactly
 * one wins; neither is a read-then-write.
 *
 * THE CHAIN. A reschedule makes a new row pointing at the old one (0061), so
 * one appointment is a chain of rows. Its calendar file keeps ONE identity
 * (the first row's id) and counts the moves.
 */
describe("F-048: the cancel notice's claim and the reschedule chain", () => {
  const range = (cal: { id: string }, contactId: string, day: string) => ({
    calendarId: cal.id, contactId,
    startsAt: new Date(`2029-08-${day}T15:00:00Z`), endsAt: new Date(`2029-08-${day}T16:00:00Z`),
  });
  const rowOf = async (db: SupabaseClient, id: string) => {
    const { data, error } = await db.from("bookings").select("status, updated_at").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data as { status: string; updated_at: string };
  };
  const outcome = async (p: Promise<unknown>) => {
    try { await p; } catch (e) { return e instanceof BookingNotRestorableError ? e.reason : String(e); }
    return "restored";
  };

  it("setBookingStatus answers the version it wrote, and it is the row's own updated_at (mutation: answer a fresh Date → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Ver" }, "user_test");
      const b = await createBooking(db, accountId, range(cal, contactId, "01"), "user_test");
      const { updatedAt } = await setBookingStatus(db, accountId, b.id, "cancelled", "user_test");
      expect(new Date((await rowOf(db, b.id)).updated_at).getTime()).toBe(new Date(updatedAt).getTime());
    });
  });

  it("the claim wins once, only on the version it names, only on a cancelled row of this account, and then the Undo is refused as superseded (mutation: drop the version predicate from the claim → the second claim also wins, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db2, otherAccountId) => {
        const cal = await getOrCreateCalendar(db, accountId, "user_test");
        const { id: contactId } = await createContact(db, accountId, { firstName: "Told" }, "user_test");
        const b = await createBooking(db, accountId, range(cal, contactId, "02"), "user_test");
        const { updatedAt } = await setBookingStatus(db, accountId, b.id, "cancelled", "user_test", "user", { onlyFrom: "booked" });

        expect(await claimCancelNotice(db, otherAccountId, b.id, updatedAt)).toBe(false); // not this account's
        expect(await claimCancelNotice(db, accountId, b.id, "2001-01-01T00:00:00.000Z")).toBe(false); // stale version
        expect(await claimCancelNotice(db, accountId, b.id, updatedAt)).toBe(true);
        expect(await claimCancelNotice(db, accountId, b.id, updatedAt)).toBe(false); // already claimed

        expect(await outcome(undoOperatorCancel(db, accountId, b.id, "user_test", updatedAt))).toBe("superseded");
        expect((await rowOf(db, b.id)).status).toBe("cancelled");
      });
    });
  });

  it("an Undo that lands first restores the row, and the notice's claim then loses", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Back" }, "user_test");
      const b = await createBooking(db, accountId, range(cal, contactId, "03"), "user_test");
      const { updatedAt } = await setBookingStatus(db, accountId, b.id, "cancelled", "user_test", "user", { onlyFrom: "booked" });
      expect(await outcome(undoOperatorCancel(db, accountId, b.id, "user_test", updatedAt))).toBe("restored");
      expect((await rowOf(db, b.id)).status).toBe("booked");
      expect(await claimCancelNotice(db, accountId, b.id, updatedAt)).toBe(false);
    });
  });

  // The version alone already refuses the case above (the Undo moved it). The
  // claim's status predicate is the second guard, for a row that left
  // "cancelled" WITHOUT a new version: any write that skips setBookingStatus.
  it("the claim also refuses a row that is no longer cancelled under the same version (mutation: drop the status predicate from the claim → it wins, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Raw" }, "user_test");
      const b = await createBooking(db, accountId, range(cal, contactId, "07"), "user_test");
      const { updatedAt } = await setBookingStatus(db, accountId, b.id, "cancelled", "user_test", "user", { onlyFrom: "booked" });
      const { error } = await db.from("bookings").update({ status: "completed" }).eq("id", b.id);
      if (error) throw new Error(error.message);
      expect(await claimCancelNotice(db, accountId, b.id, updatedAt)).toBe(false);
    });
  });

  it("a cancel, Undo and second cancel leave the FIRST cancel's version stale: its notice cannot claim, the second's can (mutation: claim on status alone → the first wins too, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Twice" }, "user_test");
      const b = await createBooking(db, accountId, range(cal, contactId, "04"), "user_test");
      const first = await setBookingStatus(db, accountId, b.id, "cancelled", "user_test", "user", { onlyFrom: "booked" });
      await undoOperatorCancel(db, accountId, b.id, "user_test", first.updatedAt);
      const second = await setBookingStatus(db, accountId, b.id, "cancelled", "user_test", "user", { onlyFrom: "booked" });
      expect(await claimCancelNotice(db, accountId, b.id, first.updatedAt)).toBe(false);
      expect(await claimCancelNotice(db, accountId, b.id, second.updatedAt)).toBe(true);
    });
  });

  it("an Undo naming a stale version restores nothing, and the other refusals still win over superseded (M1: the version is required)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Plain" }, "user_test");
      const b = await createBooking(db, accountId, range(cal, contactId, "05"), "user_test");
      await setBookingStatus(db, accountId, b.id, "cancelled", "user_test");
      expect(await outcome(undoOperatorCancel(db, accountId, b.id, "user_test", "2001-01-01T00:00:00.000Z"))).toBe("superseded");
      expect((await rowOf(db, b.id)).status).toBe("cancelled");

      const sofia = await createBooking(db, accountId, range(cal, contactId, "06"), "user_test");
      const { updatedAt } = await setBookingStatus(db, accountId, sofia.id, "cancelled", "voice", "ai");
      expect(await outcome(undoOperatorCancel(db, accountId, sofia.id, "user_test", updatedAt))).toBe("not_operator_cancel");
    });
  });

  it("rescheduleChain names the first row and counts the moves, for every row of the chain (mutation: stop after one hop → the third row reads depth 1, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Chain" }, "user_test");
      const a = await createBooking(db, accountId, range(cal, contactId, "10"), "voice", "ai");
      const b = await createBooking(db, accountId, { ...range(cal, contactId, "11"), rescheduledFromId: a.id }, "voice", "ai");
      await setBookingStatus(db, accountId, a.id, "cancelled", "voice", "ai");
      const c = await createBooking(db, accountId, { ...range(cal, contactId, "12"), rescheduledFromId: b.id }, "voice", "ai");
      await setBookingStatus(db, accountId, b.id, "cancelled", "voice", "ai");
      const lone = await createBooking(db, accountId, range(cal, contactId, "13"), "user_test");

      expect(await rescheduleChain(db, accountId, a.id)).toEqual({ rootId: a.id, depth: 0 });
      expect(await rescheduleChain(db, accountId, b.id)).toEqual({ rootId: a.id, depth: 1 });
      expect(await rescheduleChain(db, accountId, c.id)).toEqual({ rootId: a.id, depth: 2 });
      expect(await rescheduleChain(db, accountId, lone.id)).toEqual({ rootId: lone.id, depth: 0 });
    });
  });

  it("bookingContactEmail answers the booking's own contact's address, trimmed, and null for no address or another account's booking (mutations: drop the account scope, or drop the trim → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db2, otherAccountId) => {
        const cal = await getOrCreateCalendar(db, accountId, "user_test");
        const { id: withEmail } = await createContact(db, accountId, { firstName: "Em", email: "em@example.com" }, "user_test");
        // Stored with surrounding whitespace, the way an import or an old row
        // can hold it, so the trim is what the assertion below proves (M6).
        const { error: rawErr } = await db.from("contacts").update({ email: "  em@example.com \n" }).eq("id", withEmail);
        if (rawErr) throw new Error(rawErr.message);
        const { id: noEmail } = await createContact(db, accountId, { firstName: "None" }, "user_test");
        const a = await createBooking(db, accountId, range(cal, withEmail, "15"), "user_test");
        const b = await createBooking(db, accountId, range(cal, noEmail, "16"), "user_test");
        expect(await bookingContactEmail(db, accountId, a.id)).toBe("em@example.com");
        expect(await bookingContactEmail(db, accountId, b.id)).toBeNull();
        expect(await bookingContactEmail(db, otherAccountId, a.id)).toBeNull();
      });
    });
  });

  /**
   * F-048 fix round: the notice's thread row is written QUEUED in the cancel
   * itself, before the wait. An Undo that wins removes it (nothing was sent,
   * and the appointment is back on), but only while it is still queued: a
   * sent or failed row is the record of what happened and is never removed.
   */
  it("discardQueuedNotice removes only a queued outbound email of this account, and noticeMessageStatus reads it back (mutation: drop the queued guard → the sent row is deleted, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db2, otherAccountId) => {
        const { id: contactId } = await createContact(db, accountId, { firstName: "Thread" }, "user_test");
        const convo = await ensureConversation(db, accountId, contactId, "user_test");
        const queued = await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "outbound", body: "q" }, "user_test");
        const sent = await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "outbound", body: "s" }, "user_test");
        await updateMessageStatus(db, accountId, sent.id, "sent", { providerMessageId: `re_${sent.id}` }, "user_test");

        expect(await noticeMessageStatus(db, accountId, queued.id)).toBe("queued");
        expect(await discardQueuedNotice(db, otherAccountId, queued.id)).toBe(false);
        expect(await discardQueuedNotice(db, accountId, sent.id)).toBe(false);
        expect(await noticeMessageStatus(db, accountId, sent.id)).toBe("sent");
        expect(await discardQueuedNotice(db, accountId, queued.id)).toBe(true);
        expect(await noticeMessageStatus(db, accountId, queued.id)).toBeNull();
        expect(await noticeMessageStatus(db, otherAccountId, sent.id)).toBeNull();
      });
    });
  });

  /**
   * Fix round 2 (M-b): the queued row's insert moved the conversation's
   * `last_message_at` to its own time (createMessage's touch). Removing the
   * row puts it back to the newest message left, or null when none is, so
   * the inbox does not sort the thread by an email that never existed.
   */
  it("discardQueuedNotice puts the conversation's last_message_at back to the newest message left, or null (mutation: skip the reset → the deleted email's time stays, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const lastAt = async (id: string) => {
        const { data, error } = await db.from("conversations").select("last_message_at").eq("id", id).single();
        if (error) throw new Error(error.message);
        return (data as { last_message_at: string | null }).last_message_at;
      };
      const createdAt = async (id: string) => {
        const { data, error } = await db.from("messages").select("created_at").eq("id", id).single();
        if (error) throw new Error(error.message);
        return (data as { created_at: string }).created_at;
      };

      const { id: withHistory } = await createContact(db, accountId, { firstName: "Hist" }, "user_test");
      const c1 = await ensureConversation(db, accountId, withHistory, "user_test");
      const earlier = await createMessage(db, accountId, { conversationId: c1.id, channel: "email", direction: "inbound", body: "hi" }, "user_test");
      // A distinctive time, older than any touch can write, so a missing reset shows.
      const { error: ageErr } = await db.from("messages").update({ created_at: "2020-01-01T00:00:00.000Z" }).eq("id", earlier.id);
      if (ageErr) throw new Error(ageErr.message);
      const q1 = await createMessage(db, accountId, { conversationId: c1.id, channel: "email", direction: "outbound", body: "q" }, "user_test");
      expect(new Date((await lastAt(c1.id))!).getTime()).not.toBe(new Date("2020-01-01T00:00:00.000Z").getTime());
      expect(await discardQueuedNotice(db, accountId, q1.id)).toBe(true);
      expect(new Date((await lastAt(c1.id))!).getTime()).toBe(new Date(await createdAt(earlier.id)).getTime());

      const { id: fresh } = await createContact(db, accountId, { firstName: "Fresh" }, "user_test");
      const c2 = await ensureConversation(db, accountId, fresh, "user_test");
      const q2 = await createMessage(db, accountId, { conversationId: c2.id, channel: "email", direction: "outbound", body: "q" }, "user_test");
      expect(await lastAt(c2.id)).not.toBeNull();
      expect(await discardQueuedNotice(db, accountId, q2.id)).toBe(true);
      expect(await lastAt(c2.id)).toBeNull();
    });
  });

  /**
   * Round 3: the reset races a message arriving on the same thread. An
   * inbound message landing between the reset's reads and its write moves
   * `last_message_at` to NOW; an unconditional write then puts the older
   * time back over it. The reset is a compare-and-set on the value it read,
   * so it leaves a newer touch alone. The race is forced, not hoped for: the
   * client handed in runs the inbound write just before the conversation
   * UPDATE is awaited.
   */
  it("discardQueuedNotice never overwrites a newer message's touch that lands mid-reset (mutation: an unconditional reset → the older time wins, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const lastAt = async (id: string) => {
        const { data, error } = await db.from("conversations").select("last_message_at").eq("id", id).single();
        if (error) throw new Error(error.message);
        return (data as { last_message_at: string | null }).last_message_at;
      };
      const { id: contactId } = await createContact(db, accountId, { firstName: "Race" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const earlier = await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "inbound", body: "hi" }, "user_test");
      const { error: ageErr } = await db.from("messages").update({ created_at: "2020-01-01T00:00:00.000Z" }).eq("id", earlier.id);
      if (ageErr) throw new Error(ageErr.message);
      const queued = await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "outbound", body: "q" }, "user_test");

      // Runs once, just before the reset's UPDATE on conversations is awaited.
      let injected = false;
      const inject = async () => {
        if (injected) return;
        injected = true;
        await createMessage(db, accountId, { conversationId: convo.id, channel: "sms", direction: "inbound", body: "just in" }, "user_test");
      };
      const beforeAwait = <T extends object>(builder: T): T => {
        const proxy: T = new Proxy(builder, {
          get(target, prop) {
            if (prop === "then") {
              return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
                inject().then(() => (target as unknown as PromiseLike<unknown>).then(res, rej), rej);
            }
            const v = Reflect.get(target, prop, target);
            if (typeof v !== "function") return v;
            return (...args: unknown[]) => {
              const r = (v as (...a: unknown[]) => unknown).apply(target, args);
              return r === target ? proxy : r;
            };
          },
        });
        return proxy;
      };
      const racyDb = new Proxy(db, {
        get(target, prop) {
          if (prop !== "from") return Reflect.get(target, prop, target);
          return (table: string) => {
            const qb = target.from(table);
            if (table !== "conversations") return qb;
            return new Proxy(qb, {
              get(t, p) {
                const v = Reflect.get(t, p, t);
                if (p === "update") return (...a: unknown[]) => beforeAwait((v as (...x: unknown[]) => object).apply(t, a));
                return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
              },
            });
          };
        },
      }) as SupabaseClient;

      expect(await discardQueuedNotice(racyDb, accountId, queued.id)).toBe(true);
      expect(injected, "the race was forced").toBe(true);
      // The inbound message's touch is newer than anything the reset read;
      // it must survive, not be replaced by the 2020 message's time.
      expect(new Date((await lastAt(convo.id))!).getTime()).toBeGreaterThan(new Date("2025-01-01T00:00:00Z").getTime());
    });
  });

  it("rescheduleChain refuses a booking that is not this account's (mutation: drop the account scope → it answers, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db2, otherAccountId) => {
        const cal = await getOrCreateCalendar(db, accountId, "user_test");
        const { id: contactId } = await createContact(db, accountId, { firstName: "Mine" }, "user_test");
        const a = await createBooking(db, accountId, range(cal, contactId, "14"), "user_test");
        await expect(rescheduleChain(db, otherAccountId, a.id)).rejects.toThrow(/no booking/);
      });
    });
  });
});

/**
 * F-048 follow-up (0100): the notice's durable copy, through PostgREST and the
 * service client, end to end: the upsert, the sweep's read with the booking's
 * start embedded through the composite FK, the version-scoped delete, and the
 * cascade from the Undo's discard of the queued thread row.
 */
describe("F-048: the pending notice (0100)", () => {
  const range = (cal: { id: string }, contactId: string, day: string) => ({
    calendarId: cal.id, contactId,
    startsAt: new Date(`2029-10-${day}T15:00:00Z`), endsAt: new Date(`2029-10-${day}T16:00:00Z`),
  });
  const pendingOf = async (db: SupabaseClient, accountId: string) => {
    const rows = await listDueCancelNotices(db, "2100-01-01T00:00:00Z", 1000);
    return rows.filter((r) => r.accountId === accountId);
  };

  it("saves, reads back with the appointment's start, replaces on a second cancel of the same booking, and deletes only by its own version (mutation: drop the version predicate from the delete → the stale version removes the newer row, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Durable", email: "durable@example.com" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const b = await createBooking(db, accountId, range(cal, contactId, "01"), "user_test");
      const first = await setBookingStatus(db, accountId, b.id, "cancelled", "user_test", "user", { onlyFrom: "booked" });
      const m1 = await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "outbound", body: "1" }, "user_test");
      await savePendingCancelNotice(db, {
        accountId, bookingId: b.id, version: first.updatedAt, messageId: m1.id, userId: "user_test",
        email: { to: "durable@example.com", subject: "s" }, dueAt: "2029-01-01T00:00:15.000Z",
      });
      const [row] = await pendingOf(db, accountId);
      expect(row).toMatchObject({
        bookingId: b.id, accountId, messageId: m1.id, userId: "user_test", email: { to: "durable@example.com", subject: "s" },
      });
      expect(new Date(row!.version).getTime()).toBe(new Date(first.updatedAt).getTime());
      expect(new Date(row!.startsAt!).getTime()).toBe(new Date("2029-10-01T15:00:00Z").getTime());
      expect(await readBookingStatus(db, accountId, b.id)).toBe("cancelled");

      // Undo, then cancel again: the newer cancel's notice replaces the row.
      await setBookingStatus(db, accountId, b.id, "booked", "user_test", "user", { onlyFrom: "cancelled", version: first.updatedAt });
      const second = await setBookingStatus(db, accountId, b.id, "cancelled", "user_test", "user", { onlyFrom: "booked" });
      const m2 = await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "outbound", body: "2" }, "user_test");
      await savePendingCancelNotice(db, {
        accountId, bookingId: b.id, version: second.updatedAt, messageId: m2.id, userId: "user_test",
        email: { to: "durable@example.com", subject: "s2" }, dueAt: "2029-01-01T00:01:00.000Z",
      });
      expect((await pendingOf(db, accountId)).map((r) => r.messageId)).toEqual([m2.id]);

      expect(await deletePendingCancelNotice(db, accountId, b.id, first.updatedAt)).toBe(false);
      expect(await pendingOf(db, accountId)).toHaveLength(1);
      expect(await deletePendingCancelNotice(db, accountId, b.id, second.updatedAt)).toBe(true);
      expect(await pendingOf(db, accountId)).toEqual([]);
    });
  });

  it("the Undo's discard of the queued thread row carries the pending row away (mutation: `on delete restrict` on message_id → discardQueuedNotice throws, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Undone" }, "user_test");
      const convo = await ensureConversation(db, accountId, contactId, "user_test");
      const b = await createBooking(db, accountId, range(cal, contactId, "02"), "user_test");
      const { updatedAt } = await setBookingStatus(db, accountId, b.id, "cancelled", "user_test", "user", { onlyFrom: "booked" });
      const m = await createMessage(db, accountId, { conversationId: convo.id, channel: "email", direction: "outbound", body: "q" }, "user_test");
      await savePendingCancelNotice(db, {
        accountId, bookingId: b.id, version: updatedAt, messageId: m.id, userId: "user_test", email: {}, dueAt: "2029-01-01T00:00:15.000Z",
      });
      expect(await discardQueuedNotice(db, accountId, m.id)).toBe(true);
      expect(await pendingOf(db, accountId)).toEqual([]);
    });
  });
});

/**
 * F-048 (rider): the customer moves their own booking from the link in their
 * email. A move is the receptionist's reschedule (0061, D-035) made safe for
 * a public link that two tabs can hold at once: the new range is booked first
 * (naming the old row), then the old row is cancelled ONLY IF it is still
 * booked. When it is not (the other tab already moved or cancelled it), the
 * new row is taken back out and nothing is left live but what was there.
 */
describe("F-048: moveBooking, a customer's move in place", () => {
  const at = (day: string, hh: number) => new Date(`2029-09-${day}T${String(hh).padStart(2, "0")}:00:00Z`);
  const rowOf = async (db: SupabaseClient, id: string) => {
    const { data, error } = await db.from("bookings")
      .select("status, rescheduled_from_id, calendar_id, contact_id, note, booker_timezone, starts_at, meeting_url, cancel_token")
      .eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown> | null;
  };
  const liveCount = async (db: SupabaseClient, accountId: string) => {
    const { count, error } = await db.from("bookings").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("status", "booked");
    if (error) throw new Error(error.message);
    return count;
  };

  it("listBookedRanges leaves out exactly the booking named, and keeps every other (mutation: ignore excludeBookingId → the own range comes back, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const own = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("03", 15), endsAt: at("03", 16) }, "user_test");
      await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("03", 17), endsAt: at("03", 18) }, "user_test");
      const from = "2029-09-03T00:00:00.000Z";
      const to = "2029-09-04T00:00:00.000Z";
      const iso = (rows: { starts_at: string }[]) => rows.map((r) => new Date(r.starts_at).toISOString());
      expect(iso(await listBookedRanges(db, cal.id, from, to))).toEqual([at("03", 15).toISOString(), at("03", 17).toISOString()]);
      expect(iso(await listBookedRanges(db, cal.id, from, to, own.id))).toEqual([at("03", 17).toISOString()]);
    });
  });

  it("books the new range linked to the old, carries the contact, calendar, note and zone, mints a NEW token, and cancels the old row as the actor given (mutation: skip the cancel → two live rows, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const old = await createBooking(db, accountId, {
        calendarId: cal.id, contactId, startsAt: at("04", 15), endsAt: at("04", 16),
        note: "gate code 1234", bookerTimezone: "America/Chicago",
      }, "public", "system");

      const moved = await moveBooking(db, accountId, old.id,
        { startsAt: at("05", 15), endsAt: at("05", 16), meetingUrl: "https://meet.example/new" }, "public", "system");

      expect(moved.id).not.toBe(old.id);
      expect(moved.cancelToken).not.toBe(old.cancelToken);
      const row = await rowOf(db, moved.id);
      expect(row).toMatchObject({
        status: "booked", rescheduled_from_id: old.id, calendar_id: cal.id, contact_id: contactId,
        note: "gate code 1234", booker_timezone: "America/Chicago",
        meeting_url: "https://meet.example/new", cancel_token: moved.cancelToken,
      });
      expect(new Date(row!.starts_at as string).toISOString()).toBe(at("05", 15).toISOString());
      expect((await rowOf(db, old.id))!.status).toBe("cancelled");
      expect(await liveCount(db, accountId)).toBe(1);
      expect(await rescheduleChain(db, accountId, moved.id)).toEqual({ rootId: old.id, depth: 1 });

      // Marked the way the receptionist's reschedule marks it: a status
      // change, not the cancel link's own `booking.cancelled`, under the
      // actor that made the move.
      const { data: ev, error } = await db.from("events").select("type, actor_type, payload")
        .eq("account_id", accountId).in("type", ["booking.created", "booking.status_changed", "booking.cancelled"])
        .order("created_at", { ascending: true }).order("id", { ascending: true });
      if (error) throw new Error(error.message);
      const mine = (ev ?? []).map((e) => ({ ...e, payload: e.payload as { bookingId: string; status?: string } }))
        .filter((e) => [old.id, moved.id].includes(e.payload.bookingId));
      expect(mine.map((e) => [e.type, e.actor_type, e.payload.bookingId === moved.id ? "new" : "old"])).toEqual([
        ["booking.created", "system", "old"],
        ["booking.created", "system", "new"],
        ["booking.status_changed", "system", "old"],
      ]);
      expect(mine[2]!.payload.status).toBe("cancelled");
    });
  });

  it("a range overlapping a live booking is SlotTakenError, and the old row is left booked (the database's guarantee)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const old = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("06", 15), endsAt: at("06", 16) }, "user_test");
      await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("07", 15), endsAt: at("07", 16) }, "user_test");
      await expect(moveBooking(db, accountId, old.id, { startsAt: at("07", 15), endsAt: at("07", 16) }, "public", "system"))
        .rejects.toThrow(SlotTakenError);
      expect((await rowOf(db, old.id))!.status).toBe("booked");
      expect(await liveCount(db, accountId)).toBe(2);
    });
  });

  it("refuses a booking that is not live, or not this account's, before writing anything (mutation: drop the status check → the replacement is still taken back, but a third booking.created was written, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db2, otherAccountId) => {
        const cal = await getOrCreateCalendar(db, accountId, "user_test");
        const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
        const gone = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("08", 15), endsAt: at("08", 16) }, "user_test");
        await setBookingStatus(db, accountId, gone.id, "cancelled", "user_test");
        await expect(moveBooking(db, accountId, gone.id, { startsAt: at("09", 15), endsAt: at("09", 16) }, "public", "system"))
          .rejects.toThrow(BookingNotMovableError);
        const live = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("10", 15), endsAt: at("10", 16) }, "user_test");
        await expect(moveBooking(db, otherAccountId, live.id, { startsAt: at("11", 15), endsAt: at("11", 16) }, "public", "system"))
          .rejects.toThrow(BookingNotMovableError);
        const { count } = await db.from("bookings").select("id", { count: "exact", head: true }).eq("rescheduled_from_id", gone.id);
        expect(count).toBe(0);
        expect(await liveCount(db, accountId)).toBe(1);
        // Refused BEFORE the insert, not merely taken back after it: the only
        // bookings ever created on this account are the two made above. (The
        // conditional cancel alone would also leave no live row, so this is
        // what tells the up-front check from the take-back.)
        const { count: created, error: evErr } = await db.from("events").select("id", { count: "exact", head: true })
          .eq("account_id", accountId).eq("type", "booking.created");
        if (evErr) throw new Error(evErr.message);
        expect(created).toBe(2);
      });
    });
  });

  /**
   * The race a public link invites: the old row stops being `booked` between
   * the move's read and its cancel (the customer's other tab cancelled or
   * moved it). Forced, not hoped for: the client handed in cancels the old
   * row just before the move's insert is awaited.
   */
  it("when the old row stopped being live mid-move, the new row is taken back out and the move is refused (mutation: an unconditional cancel → a second live appointment, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Racer" }, "user_test");
      const old = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("12", 15), endsAt: at("12", 16) }, "user_test");

      let injected = false;
      const inject = async () => {
        if (injected) return;
        injected = true;
        await cancelBookingByToken(db, old.cancelToken);
      };
      const beforeAwait = <T extends object>(builder: T): T => {
        const proxy: T = new Proxy(builder, {
          get(target, prop) {
            if (prop === "then") {
              return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
                inject().then(() => (target as unknown as PromiseLike<unknown>).then(res, rej), rej);
            }
            const v = Reflect.get(target, prop, target);
            if (typeof v !== "function") return v;
            return (...args: unknown[]) => {
              const r = (v as (...a: unknown[]) => unknown).apply(target, args);
              return r === target ? proxy : (typeof r === "object" && r !== null ? beforeAwait(r as object) : r);
            };
          },
        });
        return proxy;
      };
      const racyDb = new Proxy(db, {
        get(target, prop) {
          if (prop !== "from") return Reflect.get(target, prop, target);
          return (table: string) => {
            const qb = target.from(table);
            if (table !== "bookings") return qb;
            return new Proxy(qb, {
              get(t, p) {
                const v = Reflect.get(t, p, t);
                if (p === "insert") return (...a: unknown[]) => beforeAwait((v as (...x: unknown[]) => object).apply(t, a));
                return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
              },
            });
          };
        },
      }) as SupabaseClient;

      await expect(moveBooking(racyDb, accountId, old.id, { startsAt: at("13", 15), endsAt: at("13", 16) }, "public", "system"))
        .rejects.toThrow(BookingNotMovableError);
      expect(injected, "the race was forced").toBe(true);
      expect(await liveCount(db, accountId)).toBe(0);
      const { count } = await db.from("bookings").select("id", { count: "exact", head: true }).eq("rescheduled_from_id", old.id);
      expect(count, "the taken-back row is gone, so nothing reads as a move").toBe(0);
    });
  });

  /**
   * Fix rounds 1 and 2: a move's writes can land while what comes after them
   * fails — an event insert, or the response to a write. Every such case
   * must end with exactly ONE live booking, and the answer must say which.
   * Faults are injected into a client wrapped around the real one, keyed on
   * what each `bookings` query IS (its first call — select/insert/update/
   * delete — and the columns it filters or selects):
   *  - `failEvent`: that event type's insert is refused (nothing written);
   *  - `lose`: the FIRST such write runs, then an error is answered, as a
   *    dropped response would;
   *  - `refuse: "update"`: the FIRST update answers an error WITHOUT running
   *    (a timeout before commit); `between` runs first — another tab's move;
   *  - `failRead`: a select filtering on `cancel_token`, or the re-read that
   *    selects `updated_at`, answers an error;
   *  - `failDelete`: the first N deletes answer an error without running.
   */
  type Fault = {
    failEvent?: string; lose?: "insert" | "update"; refuse?: "update";
    between?: () => Promise<unknown>; failRead?: "cancel_token" | "updated_at"; failDelete?: number;
  };
  const faulty = (db: SupabaseClient, f: Fault) => {
    const used = { failEvent: false, lose: false, refuse: false, failRead: false, failDelete: 0 };
    const err = (message: string) => ({ data: null, error: { message } });
    const fired = { lose: false };
    const watch = <T extends object>(builder: T, op: string, firstArgs: unknown[]): T => {
      const eqs: string[] = [];
      const selects: string[] = op === "select" ? [String(firstArgs[0] ?? "")] : [];
      const decide = async (): Promise<{ data: unknown; error: unknown } | "real" | "lose"> => {
        if (op === f.lose && !fired.lose) { fired.lose = true; return "lose"; }
        if (op === "update" && f.refuse === "update" && !used.refuse) {
          used.refuse = true;
          await f.between?.();
          return err("canceling statement due to statement timeout (simulated, not run)");
        }
        if (op === "select" && f.failRead === "cancel_token" && eqs.includes("cancel_token")) {
          used.failRead = true;
          return err("fetch failed (simulated token look-up)");
        }
        if (op === "select" && f.failRead === "updated_at" && selects.some((c) => c.includes("updated_at"))) {
          used.failRead = true;
          return err("fetch failed (simulated re-read)");
        }
        if (op === "delete" && used.failDelete < (f.failDelete ?? 0)) {
          used.failDelete += 1;
          return err("fetch failed (simulated delete)");
        }
        return "real";
      };
      const proxy: T = new Proxy(builder, {
        get(target, prop) {
          if (prop === "then") {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => decide().then((d) => {
              if (d === "real") return (target as unknown as PromiseLike<unknown>).then(res, rej);
              if (d === "lose") {
                return (target as unknown as PromiseLike<unknown>).then(() => {
                  used.lose = true;
                  return res(err("fetch failed (simulated lost response)"));
                }, rej);
              }
              return res(d);
            }, rej);
          }
          const v = Reflect.get(target, prop, target);
          if (typeof v !== "function") return v;
          return (...args: unknown[]) => {
            if (prop === "eq") eqs.push(String(args[0]));
            if (prop === "select") selects.push(String(args[0] ?? ""));
            const r = (v as (...a: unknown[]) => unknown).apply(target, args);
            return r === target ? proxy : r;
          };
        },
      });
      return proxy;
    };
    const client = new Proxy(db, {
      get(target, prop) {
        if (prop !== "from") return Reflect.get(target, prop, target);
        return (table: string) => {
          const qb = target.from(table);
          return new Proxy(qb, {
            get(t, p) {
              const v = Reflect.get(t, p, t);
              if (table === "events" && p === "insert") {
                return (payload: { type?: string }) => {
                  if (payload?.type === f.failEvent) {
                    used.failEvent = true;
                    return Promise.resolve(err("simulated events insert failure"));
                  }
                  return (v as (x: unknown) => unknown).call(t, payload);
                };
              }
              if (table === "bookings" && typeof p === "string" && ["select", "insert", "update", "delete"].includes(p)) {
                return (...a: unknown[]) => watch((v as (...x: unknown[]) => object).apply(t, a), p, a);
              }
              return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
            },
          });
        };
      },
    }) as SupabaseClient;
    return { client, used };
  };
  const statuses = async (db: SupabaseClient, accountId: string) => {
    const { data, error } = await db.from("bookings").select("status, rescheduled_from_id")
      .eq("account_id", accountId).order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => `${r.rescheduled_from_id ? "new" : "old"}:${r.status}`);
  };

  it("C1: the old row's cancel lands but its event does not — the move STANDS: the new booking is kept and returned (red on the round-0 code, which took back on any error; mutation: let the event's error escape → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const old = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("17", 15), endsAt: at("17", 16) }, "user_test");
      const { client, used } = faulty(db, { failEvent: "booking.status_changed" });
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const moved = await moveBooking(client, accountId, old.id, { startsAt: at("18", 15), endsAt: at("18", 16) }, "public", "system");
        expect(used.failEvent, "the fault fired").toBe(true);
        expect(await statuses(db, accountId)).toEqual(["old:cancelled", "new:booked"]);
        expect((await rowOf(db, moved.id))!.status).toBe("booked");
        expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/event/);
      } finally { errors.mockRestore(); }
    });
  });

  it("C1: the old row's cancel COMMITS but its response is lost — re-read, see it cancelled, keep the move (mutation: read any cancel error as not cancelled → the new row is taken back, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const old = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("19", 15), endsAt: at("19", 16) }, "user_test");
      const { client, used } = faulty(db, { lose: "update" });
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await moveBooking(client, accountId, old.id, { startsAt: at("20", 15), endsAt: at("20", 16) }, "public", "system");
        expect(used.lose, "the fault fired").toBe(true);
        expect(await statuses(db, accountId)).toEqual(["old:cancelled", "new:booked"]);
      } finally { errors.mockRestore(); }
    });
  });

  it("I2: the new row lands but its booking.created event does not — never two live bookings: the move goes on and the old row is cancelled (mutation: let the event error escape → old AND new live, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const old = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("21", 15), endsAt: at("21", 16) }, "user_test");
      const { client, used } = faulty(db, { failEvent: "booking.created" });
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        await moveBooking(client, accountId, old.id, { startsAt: at("22", 15), endsAt: at("22", 16) }, "public", "system");
        expect(used.failEvent, "the fault fired").toBe(true);
        expect(await statuses(db, accountId)).toEqual(["old:cancelled", "new:booked"]);
      } finally { errors.mockRestore(); }
    });
  });

  it("I2: the new row's insert COMMITS but its response is lost — found by its own token, and the move goes on (mutation: treat the error as a failure → FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const old = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("23", 15), endsAt: at("23", 16) }, "user_test");
      const { client, used } = faulty(db, { lose: "insert" });
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const moved = await moveBooking(client, accountId, old.id, { startsAt: at("24", 15), endsAt: at("24", 16) }, "public", "system");
        expect(used.lose, "the fault fired").toBe(true);
        expect(await statuses(db, accountId)).toEqual(["old:cancelled", "new:booked"]);
        expect((await rowOf(db, moved.id))!.cancel_token).toBe(moved.cancelToken);
      } finally { errors.mockRestore(); }
    });
  });

  const createdEvents = async (db: SupabaseClient, accountId: string) => {
    const { count, error } = await db.from("events").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("type", "booking.created");
    if (error) throw new Error(error.message);
    return count;
  };
  const setup = async (db: SupabaseClient, accountId: string, day: string) => {
    const cal = await getOrCreateCalendar(db, accountId, "user_test");
    const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
    const old = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at(day, 15), endsAt: at(day, 16) }, "user_test");
    return { cal, contactId, old };
  };
  const quietly = async <T>(fn: () => Promise<T>): Promise<T> => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try { return await fn(); } finally { errors.mockRestore(); }
  };
  const outcome = async (p: Promise<unknown>) => {
    try { await p; return "moved"; } catch (e) { return e instanceof BookingNotMovableError ? "not movable" : `Error: ${(e as Error).message}`; }
  };

  it("round 2 (I2a): the cancel answers an error WITHOUT landing — the old booking is still live, so the new one is taken back and the move refused (mutation: read every unclear cancel as ours → two live, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { old } = await setup(db, accountId, "27");
      const { client, used } = faulty(db, { refuse: "update" });
      const got = await quietly(() => outcome(moveBooking(client, accountId, old.id, { startsAt: at("28", 15), endsAt: at("28", 16) }, "public", "system")));
      expect(used.refuse, "the fault fired").toBe(true);
      expect(got).toBe("not movable");
      expect(await statuses(db, accountId)).toEqual(["old:booked"]);
      // m-c: a taken-back move leaves no "booking created" for a row that is gone.
      expect(await createdEvents(db, accountId)).toBe(1);
    });
  });

  it("round 2 (I1/I2b): the cancel errors and ANOTHER tab's move lands meanwhile — the old row is cancelled, but not by us, so ours is taken back and only the other tab's booking is live (mutation: treat 'no longer booked' as ours → two live, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { old } = await setup(db, accountId, "29");
      let other: { id: string } | undefined;
      const { client, used } = faulty(db, {
        refuse: "update",
        between: async () => { other = await moveBooking(db, accountId, old.id, { startsAt: at("30", 17), endsAt: at("30", 18) }, "public", "system"); },
      });
      const got = await quietly(() => outcome(moveBooking(client, accountId, old.id, { startsAt: at("30", 15), endsAt: at("30", 16) }, "public", "system")));
      expect(used.refuse, "the fault fired").toBe(true);
      expect(got).toBe("not movable");
      expect(await statuses(db, accountId)).toEqual(["old:cancelled", "new:booked"]);
      expect((await rowOf(db, other!.id))!.status).toBe("booked");
    });
  });

  it("round 2 (m-a): the insert lands behind a lost response AND its token look-up fails — the row is deleted by its token, so only the old booking is live (mutation: throw without the delete → two live, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { old } = await setup(db, accountId, "02");
      const { client, used } = faulty(db, { lose: "insert", failRead: "cancel_token" });
      const got = await quietly(() => outcome(moveBooking(client, accountId, old.id, { startsAt: at("03", 17), endsAt: at("03", 18) }, "public", "system")));
      expect(used.lose && used.failRead, "both faults fired").toBe(true);
      expect(got).toMatch(/^Error: /);
      expect(await statuses(db, accountId)).toEqual(["old:booked"]);
    });
  });

  it("round 2 (m-a): the take-back delete fails once — it is retried, and only the old booking is live (mutation: no retry → two live, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { old } = await setup(db, accountId, "04");
      const { client, used } = faulty(db, { refuse: "update", failDelete: 1 });
      const got = await quietly(() => outcome(moveBooking(client, accountId, old.id, { startsAt: at("05", 17), endsAt: at("05", 18) }, "public", "system")));
      expect(used.failDelete, "the delete fault fired").toBe(1);
      expect(got).toBe("not movable");
      expect(await statuses(db, accountId)).toEqual(["old:booked"]);
    });
  });

  it("round 2 (m-a): the cancel errors AND its re-read fails, when the cancel did NOT land — rolled back to the start: only the old booking is live (mutation: throw without rolling back → two live, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { old } = await setup(db, accountId, "06");
      const { client, used } = faulty(db, { refuse: "update", failRead: "updated_at" });
      const got = await quietly(() => outcome(moveBooking(client, accountId, old.id, { startsAt: at("07", 17), endsAt: at("07", 18) }, "public", "system")));
      expect(used.failRead, "the re-read fault fired").toBe(true);
      expect(got).toMatch(/^Error: /);
      expect(await statuses(db, accountId)).toEqual(["old:booked"]);
    });
  });

  it("round 2 (m-a): the cancel LANDS behind a lost response AND its re-read fails — our cancel is undone by its stamp, then the new row taken back: still exactly one live, never none (mutation: delete without undoing → no live booking, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const { old } = await setup(db, accountId, "08");
      const { client, used } = faulty(db, { lose: "update", failRead: "updated_at" });
      const got = await quietly(() => outcome(moveBooking(client, accountId, old.id, { startsAt: at("09", 17), endsAt: at("09", 18) }, "public", "system")));
      expect(used.lose && used.failRead, "both faults fired").toBe(true);
      expect(got).toMatch(/^Error: /);
      expect(await statuses(db, accountId)).toEqual(["old:booked"]);
    });
  });

  it("I3: the moved row carries the request's IP hash, so the public rate limit counts moves (mutation: drop ip_hash → countRecentBookings sees 0, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
      const old = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("25", 15), endsAt: at("25", 16) }, "user_test");
      await moveBooking(db, accountId, old.id, { startsAt: at("26", 15), endsAt: at("26", 16), ipHash: "iphash-move-test" }, "public", "system");
      expect(await countRecentBookings(db, cal.id, "iphash-move-test", new Date(Date.now() - 600_000).toISOString())).toBe(1);
    });
  });

  it("bookingWasMoved: true for a row a move replaced, false for a plain cancel and for another account (mutation: drop the account scope → the other account reads true, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_db2, otherAccountId) => {
        const cal = await getOrCreateCalendar(db, accountId, "user_test");
        const { id: contactId } = await createContact(db, accountId, { firstName: "Mover" }, "user_test");
        const a = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("14", 15), endsAt: at("14", 16) }, "user_test");
        const b = await createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at("15", 15), endsAt: at("15", 16) }, "user_test");
        await moveBooking(db, accountId, a.id, { startsAt: at("16", 15), endsAt: at("16", 16) }, "public", "system");
        await setBookingStatus(db, accountId, b.id, "cancelled", "user_test");
        expect(await bookingWasMoved(db, accountId, a.id)).toBe(true);
        expect(await bookingWasMoved(db, accountId, b.id)).toBe(false);
        expect(await bookingWasMoved(db, otherAccountId, a.id)).toBe(false);
      });
    });
  });
});

/**
 * Sofía's reschedule race (the follow-up from #294's review): the phone
 * receptionist's `reschedule_appointment` moves a booking with `moveBooking`,
 * as "voice"/"ai". While the caller is on the line, the business can cancel
 * that same booking on the Calendar page (queuing the customer's cancel
 * notice under the cancel's version), or mark it completed or no-show. The
 * move must then be refused with nothing left behind, and the business's
 * write left exactly as it was: its version unmoved, so its notice still
 * claims. Forced, not hoped for: the business's write runs just before the
 * move's insert is awaited.
 */
describe("Sofía's reschedule against a business change mid-call (moveBooking as voice/ai)", () => {
  const at = (day: string, hh: number) => new Date(`2029-10-${day}T${String(hh).padStart(2, "0")}:00:00Z`);
  /** `db`, but `action` runs once, right before the first `bookings` insert is awaited. */
  const raceBeforeInsert = (db: SupabaseClient, action: () => Promise<unknown>): { client: SupabaseClient; fired: () => boolean } => {
    let ran = false;
    const wrap = <T extends object>(builder: T): T => {
      const proxy: T = new Proxy(builder, {
        get(target, prop) {
          if (prop === "then") {
            return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => (async () => {
              if (!ran) { ran = true; await action(); }
            })().then(() => (target as unknown as PromiseLike<unknown>).then(res, rej), rej);
          }
          const v = Reflect.get(target, prop, target);
          if (typeof v !== "function") return v;
          return (...args: unknown[]) => {
            const r = (v as (...a: unknown[]) => unknown).apply(target, args);
            return r === target ? proxy : (typeof r === "object" && r !== null ? wrap(r as object) : r);
          };
        },
      });
      return proxy;
    };
    const client = new Proxy(db, {
      get(target, prop) {
        if (prop !== "from") return Reflect.get(target, prop, target);
        return (table: string) => {
          const qb = target.from(table);
          if (table !== "bookings") return qb;
          return new Proxy(qb, {
            get(t, p) {
              const v = Reflect.get(t, p, t);
              if (p === "insert") return (...a: unknown[]) => wrap((v as (...x: unknown[]) => object).apply(t, a));
              return typeof v === "function" ? (v as (...x: unknown[]) => unknown).bind(t) : v;
            },
          });
        };
      },
    }) as SupabaseClient;
    return { client, fired: () => ran };
  };
  const rowOf = async (db: SupabaseClient, id: string) => {
    const { data, error } = await db.from("bookings").select("status, updated_at").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data as { status: string; updated_at: string } | null;
  };
  const replacements = async (db: SupabaseClient, oldId: string) => {
    const { count, error } = await db.from("bookings").select("id", { count: "exact", head: true }).eq("rescheduled_from_id", oldId);
    if (error) throw new Error(error.message);
    return count;
  };
  const createdEvents = async (db: SupabaseClient, accountId: string) => {
    const { count, error } = await db.from("events").select("id", { count: "exact", head: true })
      .eq("account_id", accountId).eq("type", "booking.created");
    if (error) throw new Error(error.message);
    return count;
  };
  const setup = async (db: SupabaseClient, accountId: string, day: string) => {
    const cal = await getOrCreateCalendar(db, accountId, "user_test");
    const { id: contactId } = await createContact(db, accountId, { firstName: "Caller" }, "user_test");
    return createBooking(db, accountId, { calendarId: cal.id, contactId, startsAt: at(day, 15), endsAt: at(day, 16) }, "voice", "ai");
  };

  it("the business cancels on the Calendar page mid-call: the move is refused, its replacement is gone with no booking.created, and the owner's cancel keeps its version so its notice still claims (mutation: drop moveBooking's status guard on the cancel -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const old = await setup(db, accountId, "02");
      let version = "";
      // The Calendar page's own cancel write (cancel-notice.ts): conditional on booked, its updatedAt the notice's version.
      const race = raceBeforeInsert(db, async () => {
        ({ updatedAt: version } = await setBookingStatus(db, accountId, old.id, "cancelled", "user_test", "user", { onlyFrom: "booked" }));
      });
      await expect(moveBooking(race.client, accountId, old.id, { startsAt: at("03", 15), endsAt: at("03", 16) }, "voice", "ai"))
        .rejects.toThrow(BookingNotMovableError);
      expect(race.fired(), "the race was forced").toBe(true);
      expect(await replacements(db, old.id), "no held slot, nothing reads as a move").toBe(0);
      expect(await createdEvents(db, accountId), "only the original booking was ever 'created'").toBe(1);
      const row = await rowOf(db, old.id);
      expect(row!.status).toBe("cancelled");
      expect(new Date(row!.updated_at).getTime(), "the owner's version, untouched").toBe(new Date(version).getTime());
      expect(await claimCancelNotice(db, accountId, old.id, version), "the owner's notice still claims").toBe(true);
    });
  });

  it.each(["completed", "no_show"] as const)("the booking is marked %s mid-call: the move is refused and the outcome stands (mutation: drop moveBooking's status guard on the cancel -> FAILS)", async (outcome) => {
    await withTestAccount(async (db, accountId) => {
      const old = await setup(db, accountId, outcome === "completed" ? "04" : "05");
      const race = raceBeforeInsert(db, () => setBookingStatus(db, accountId, old.id, outcome, "user_test"));
      await expect(moveBooking(race.client, accountId, old.id, { startsAt: at("06", 15), endsAt: at("06", 16) }, "voice", "ai"))
        .rejects.toThrow(BookingNotMovableError);
      expect(race.fired(), "the race was forced").toBe(true);
      expect((await rowOf(db, old.id))!.status).toBe(outcome);
      expect(await replacements(db, old.id)).toBe(0);
    });
  });

  it("an undisturbed move answers the old row's cancel stamp to the microsecond, the version the voice act records (mutation: answer a fresh Date -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const old = await setup(db, accountId, "07");
      const moved = await moveBooking(db, accountId, old.id, { startsAt: at("08", 15), endsAt: at("08", 16) }, "voice", "ai");
      const row = await rowOf(db, old.id);
      expect(row!.status).toBe("cancelled");
      expect(typeof moved.cancelledAt).toBe("string");
      expect(sameMicroInstant(row!.updated_at, moved.cancelledAt)).toBe(true);
    });
  });
});

/**
 * Fix round 3 (m2): a move recognises its own cancel by the `updated_at` it
 * stamped. Milliseconds are not unique enough (two tabs can cancel in the
 * same ms), so the stamp carries random microseconds — timestamptz keeps
 * them and PostgREST answers them — and is compared at that precision.
 */
describe("F-048: the move's own stamp", () => {
  it("compares instants to the microsecond, whatever the zone spelling or trailing zeros (mutation: compare as Date ms → a same-ms foreign stamp reads as ours, FAILS)", () => {
    expect(sameMicroInstant("2029-09-01T10:00:00.123456Z", "2029-09-01T10:00:00.123456+00:00")).toBe(true);
    expect(sameMicroInstant("2029-09-01T10:00:00.123400Z", "2029-09-01T10:00:00.1234+00:00")).toBe(true);
    expect(sameMicroInstant("2029-09-01T05:00:00.5Z", "2029-09-01T00:00:00.500000-05:00")).toBe(true);
    // Same millisecond, another call's microseconds: NOT ours.
    expect(sameMicroInstant("2029-09-01T10:00:00.123456Z", "2029-09-01T10:00:00.123789+00:00")).toBe(false);
    expect(sameMicroInstant("2029-09-01T10:00:00.123456Z", "not a time")).toBe(false);
  });

  it("each call mints its own microseconds, and the database answers them back exactly", async () => {
    // ONE fixed millisecond, so only the random microseconds can tell the
    // stamps apart: a millisecond-only stamp gives exactly 1. 200 draws from
    // 1000 values give about 181 distinct (1000 * (1 - e^-0.2)), standard
    // deviation about 6; 120 is ten deviations below, so this cannot flake,
    // and every stamp keeps that one millisecond (fix round 4: the old bar of
    // 190 failed on correct code).
    const fixed = new Date("2029-09-01T10:00:00.123Z");
    const stamps = new Set(Array.from({ length: 200 }, () => moveStamp(fixed)));
    expect(stamps.size).toBeGreaterThan(120);
    for (const st of stamps) expect(st.startsWith("2029-09-01T10:00:00.123")).toBe(true);
    for (const st of stamps) expect(st).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/);
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: contactId } = await createContact(db, accountId, { firstName: "Stamp" }, "user_test");
      const b = await createBooking(db, accountId, {
        calendarId: cal.id, contactId, startsAt: new Date("2029-10-01T15:00:00Z"), endsAt: new Date("2029-10-01T16:00:00Z"),
      }, "user_test");
      const stamp = moveStamp();
      const { error } = await db.from("bookings").update({ updated_at: stamp }).eq("id", b.id);
      if (error) throw new Error(error.message);
      const { data } = await db.from("bookings").select("updated_at").eq("id", b.id).single();
      const back = (data as { updated_at: string }).updated_at;
      expect(sameMicroInstant(back, stamp)).toBe(true);
      // One microsecond away: a different instant, though the same millisecond.
      const other = stamp.replace(/(\d{3})Z$/, (_m, d: string) => `${String((Number(d) + 1) % 1000).padStart(3, "0")}Z`);
      expect(sameMicroInstant(back, other)).toBe(false);
    });
  });
});

describe("per-customer booking reads for the record page (S-03 part 1)", () => {
  it("counts bookings MADE: a reschedule is not one, a later cancel still is, another customer's never (D-035/D14; mutation: drop .is('rescheduled_from_id', null) -> 3, FAILS; mutation: add .neq('status','cancelled') -> 1, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: luis } = await createContact(db, accountId, { firstName: "Luis" }, "user_test");
      const at = (iso: string) => ({ startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 3_600_000) });
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...at("2027-03-02T15:00:00Z") }, "user_test");
      await createBooking(db, accountId,
        { calendarId: cal.id, contactId: ana, ...at("2027-03-03T15:00:00Z"), rescheduledFromId: first.id }, "user_test");
      const later = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...at("2027-03-04T15:00:00Z") }, "user_test");
      await cancelBookingByToken(db, later.cancelToken);
      await createBooking(db, accountId, { calendarId: cal.id, contactId: luis, ...at("2027-03-05T15:00:00Z") }, "user_test");
      expect(await countContactBookingsMade(db, accountId, ana)).toBe(2);
      expect(await countContactBookingsMade(db, accountId, luis)).toBe(1);
    }));

  it("lists the customer's still-booked bookings from now on, soonest first, capped (mutation: drop .eq('status','booked') -> the cancelled Jan 20 enters, FAILS; mutation: drop .gte('starts_at') -> the past one leads, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const book = async (iso: string) => (await createBooking(db, accountId,
        { calendarId: cal.id, contactId: ana, startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 3_600_000) }, "user_test"));
      await book("2026-12-31T15:00:00Z"); // before "now"
      const feb = await book("2027-02-01T15:00:00Z");
      const jan15 = await book("2027-01-15T15:00:00Z");
      const mar = await book("2027-03-01T15:00:00Z");
      const cancelled = await book("2027-01-20T15:00:00Z");
      await cancelBookingByToken(db, cancelled.cancelToken);
      await book("2027-04-01T15:00:00Z"); // fourth: past the cap of three
      const rows = await listContactUpcomingBookings(db, accountId, ana, "2027-01-01T00:00:00Z");
      expect(rows.map((r) => r.id)).toEqual([jan15.id, feb.id, mar.id]);
      expect(new Date(rows[0]!.starts_at).toISOString()).toBe("2027-01-15T15:00:00.000Z");
    }));

  it("scopes to the account: another account's id plus this contact's id finds nothing, for both reads (RLS's bookings_tenant lets an agency caller through on its own, so this app-level filter is the only guard for that caller; mutation: drop .eq('account_id', accountId) from either function -> the booking under the first account appears under the second, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      await withTestAccount(async (_otherDb, otherAccountId) => {
        const cal = await getOrCreateCalendar(db, accountId, "user_test");
        const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
        await createBooking(db, accountId, {
          calendarId: cal.id, contactId: ana,
          startsAt: new Date("2027-05-01T15:00:00Z"), endsAt: new Date("2027-05-01T16:00:00Z"),
        }, "user_test");
        expect(await countContactBookingsMade(db, otherAccountId, ana)).toBe(0);
        expect(await listContactUpcomingBookings(db, otherAccountId, ana, "2027-01-01T00:00:00Z")).toEqual([]);
      });
    }));

  it("countContactBookingsMade fails closed when the server returns no exact count, never 'booked 0 times' (mutation: restore count ?? 0 -> resolves 0 instead of rejecting, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      // Drop the `{ count: "exact", head: true }` option on the bookings read, so
      // PostgREST answers with count = null, error = null -- the same observable
      // shape postgrest-js 2.110.8 produces for a HEAD request against a missing
      // relation (dist/index.cjs:429-431: an empty 404 body is read as "204 No
      // Content", so `error` stays null and `count` stays null too).
      const noCount = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop !== "from") return Reflect.get(target, prop, receiver);
          return (table: string) => {
            const q = target.from(table);
            if (table !== "bookings") return q;
            return { select: (cols: string) => q.select(cols) };
          };
        },
      }) as SupabaseClient;
      await expect(countContactBookingsMade(noCount, accountId, ana)).rejects.toThrow(/countContactBookingsMade failed/);
    }));
});

describe("per-customer booking reads take a set (S-03 part 2b, spec C6, C8, C13)", () => {
  it("countBookingsMadeFor counts a household's bookings MADE, by D-035's unchanged definition: a reschedule is not one, a later cancel still is, an empty set reads nothing with no read at all (mutation: drop .is('rescheduled_from_id', null) -> 4, FAILS; mutation: drop the `contactIds.length === 0` short-circuit -> the empty-set call throws forContacts' 'an empty set' instead of resolving 0, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: ben } = await createContact(db, accountId, { firstName: "Ben" }, "user_test");
      const at = (iso: string) => ({ startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 3_600_000) });
      const first = await createBooking(db, accountId, { calendarId: cal.id, contactId: ana, ...at("2027-06-02T15:00:00Z") }, "user_test");
      await createBooking(db, accountId,
        { calendarId: cal.id, contactId: ana, ...at("2027-06-03T15:00:00Z"), rescheduledFromId: first.id }, "user_test");
      const benLater = await createBooking(db, accountId, { calendarId: cal.id, contactId: ben, ...at("2027-06-04T15:00:00Z") }, "user_test");
      await cancelBookingByToken(db, benLater.cancelToken);
      await createBooking(db, accountId, { calendarId: cal.id, contactId: ben, ...at("2027-06-05T15:00:00Z") }, "user_test");
      expect(await countBookingsMadeFor(db, accountId, [ana, ben])).toBe(3);
      expect(await countBookingsMadeFor(db, accountId, [ana])).toBe(1);
      expect(await countBookingsMadeFor(db, accountId, [])).toBe(0);
    }));

  it("countBookingsMadeFor fails closed on a count-less answer, never 'booked 0 times' (mutation: restore count ?? 0 -> resolves 0 instead of rejecting, FAILS)", () =>
    withTestAccount(async (db, accountId) => {
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      // Local copy of head-count-null.test.ts's noCount proxy (:41-52): that file is bis-crm's.
      const noCount = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop !== "from") return Reflect.get(target, prop, receiver);
          return (table: string) => {
            const q = target.from(table);
            if (table !== "bookings") return q;
            return { select: (cols: string) => q.select(cols) };
          };
        },
      }) as SupabaseClient;
      await expect(countBookingsMadeFor(noCount, accountId, [ana])).rejects.toThrow(/countBookingsMadeFor failed/);
    }));

  it("listContactUpcomingBookings reads a household's set, merged soonest-first, each naming its own contact_id (mutation: drop contact_id from the select -> undefined, FAILS); a single id still reads exactly that person's rows unchanged from part 1 (reverting the signature/select to the pre-2b, single-id-only shape throws 'invalid input syntax for type uuid' on the set call, proven in this task's RED run)", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: ben } = await createContact(db, accountId, { firstName: "Ben" }, "user_test");
      const book = async (contactId: string, iso: string) => (await createBooking(db, accountId,
        { calendarId: cal.id, contactId, startsAt: new Date(iso), endsAt: new Date(new Date(iso).getTime() + 3_600_000) }, "user_test"));
      const anaFeb = await book(ana, "2027-02-01T15:00:00Z");
      const benJan = await book(ben, "2027-01-15T15:00:00Z");
      const anaMar = await book(ana, "2027-03-01T15:00:00Z");
      const rows = await listContactUpcomingBookings(db, accountId, [ana, ben], "2027-01-01T00:00:00Z");
      expect(rows.map((r) => ({ id: r.id, contact_id: r.contact_id }))).toEqual([
        { id: benJan.id, contact_id: ben }, { id: anaFeb.id, contact_id: ana }, { id: anaMar.id, contact_id: ana },
      ]);
      const anaOnly = await listContactUpcomingBookings(db, accountId, ana, "2027-01-01T00:00:00Z");
      expect(anaOnly.map((r) => r.id)).toEqual([anaFeb.id, anaMar.id]);
    }));

  it("listContactBookings reads a household's set in one page, each row naming its own contact_id (mutation: drop contact_id from the select -> undefined, FAILS); a single id still reads exactly that person's page", () =>
    withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      const { id: ana } = await createContact(db, accountId, { firstName: "Ana" }, "user_test");
      const { id: ben } = await createContact(db, accountId, { firstName: "Ben" }, "user_test");
      const anaBooking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId: ana, startsAt: new Date("2027-07-01T15:00:00Z"), endsAt: new Date("2027-07-01T16:00:00Z") }, "user_test");
      const benBooking = await createBooking(db, accountId,
        { calendarId: cal.id, contactId: ben, startsAt: new Date("2027-07-02T15:00:00Z"), endsAt: new Date("2027-07-02T16:00:00Z") }, "user_test");
      const older = await db.from("bookings").update({ created_at: "2026-10-01T00:00:00+00:00" }).eq("id", anaBooking.id);
      if (older.error) throw new Error(`older update failed: ${older.error.message}`);
      const newer = await db.from("bookings").update({ created_at: "2026-10-09T00:00:00+00:00" }).eq("id", benBooking.id);
      if (newer.error) throw new Error(`newer update failed: ${newer.error.message}`);
      const both = await listContactBookings(db, accountId, [ana, ben], { limit: 31 });
      expect(both.map((b) => ({ id: b.id, contact_id: b.contact_id }))).toEqual([
        { id: benBooking.id, contact_id: ben }, { id: anaBooking.id, contact_id: ana },
      ]);
      const anaOnly = await listContactBookings(db, accountId, ana, { limit: 31 });
      expect(anaOnly.map((b) => b.id)).toEqual([anaBooking.id]);
    }));

  it("S-09 PR 2: the due reminder carries the customer's language and phone — the contact's, else the account's, else English (mutation: drop `language` from REMINDER_SELECT's contact embed -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      // Distinct phones: createContact's own dedupe (findDuplicate, contacts.ts) merges a SECOND
      // contact into an existing one that shares either its email OR its phone, so sharing one phone
      // between these two contacts would have collapsed them into a single row and made the two
      // `contactId` keys below the same id -- the test caught exactly this once, against real CI.
      const mk = async (firstName: string, email: string, phone: string) =>
        (await createContact(db, accountId, { firstName, email, phone }, "user_test")).id;
      const es = await mk("Esa", "es@example.com", "+19565550111");
      const none = await mk("Nadie", "none@example.com", "+19565550112");
      await setContactLanguage(db, accountId, es, "es", "user_test");
      const now = new Date("2027-03-01T12:00:00Z");
      for (const [contactId, h] of [[es, 11], [none, 12]] as const) {
        await createBooking(db, accountId, { calendarId: cal.id, contactId,
          startsAt: new Date(`2027-03-02T${h}:00:00Z`), endsAt: new Date(`2027-03-02T${h}:30:00Z`) }, "user_test");
      }
      const lang = async () => Object.fromEntries((await listDueReminders(db, now.toISOString())).map((d) => [d.contactId, d.language]));
      expect(await lang()).toEqual({ [es]: "es", [none]: "en" });
      await setAccountLanguage(db, accountId, "es", "user_test");
      expect(await lang()).toEqual({ [es]: "es", [none]: "es" });   // L3: the account's, for a contact with none
      const due = await listDueReminders(db, now.toISOString());
      expect(due.find((d) => d.contactId === es)!.contactPhone).toBe("+19565550111");
    });
  });

  it("S-09 PR 2: a calendar's Spanish follow-up box and its basis round-trip through updateCalendarSettings and getOrCreateCalendar (mutation: omit followup_body_es from CALENDAR_COLS -> FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const cal = await getOrCreateCalendar(db, accountId, "user_test");
      await updateCalendarSettings(db, accountId, { followupBodyEs: "Gracias.", followupBodyEsBasis: "Thanks." }, "user_test");
      const again = await getOrCreateCalendar(db, accountId, "user_test");
      expect([again.followup_body_es, again.followup_body_es_basis]).toEqual(["Gracias.", "Thanks."]);
      expect(cal.id).toBe(again.id);
    });
  });
});

/**
 * F-046 part 1 (plan Task 4, Step 4): the staff-job query layer against a real database. CI ONLY (verify):
 * no agent runs this file locally. Two cases carry the plan's labelled ASSUMPTIONS, and production waits on
 * them (checklist step 6):
 *   17a, "PostgREST surfaces 0107's plpgsql raise as 23P01": case (b), on an INSERT and on an UPDATE;
 *   17b, "a second FK from bookings (to places) makes no many-to-many between contacts and places": case (c).
 * Instants are in 2032, which no other live test books, because listDueReminders reads every account.
 */
describe("F-046 part 1: staff jobs, the agenda read and the hold (0107)", () => {
  const ACTOR = "user_test";
  const at = (iso: string) => new Date(iso);
  const past = () => new Date(Date.now() - 60_000);
  const later = () => new Date(Date.now() + 10 * 60_000);
  type Seed = { calendarId: string; contactId: string; placeId: string };
  const seed = async (db: SupabaseClient, accountId: string): Promise<Seed> => {
    const cal = await getOrCreateCalendar(db, accountId, ACTOR);
    const { id: contactId } = await createContact(db, accountId, { firstName: "Ana", email: "ana.f046@example.com" }, ACTOR);
    const place = await addPlace(db, accountId, { contactId, groupId: null },
      { label: "Home", address: "1204 Nolana Ave", landmark: null, directions: null, city: null, region: null, postal_code: null, country: null },
      { subjectId: contactId, actorId: ACTOR });
    return { calendarId: cal.id, contactId, placeId: place.id };
  };
  const job = (s: Seed, startIso: string, endIso: string, over: Partial<StaffJobInput> = {}): StaffJobInput => ({
    calendarId: s.calendarId, contactId: s.contactId, startsAt: at(startIso), endsAt: at(endIso),
    note: "Fix the gate", placeId: s.placeId, meetingType: "in_person", meetingUrl: null,
    holdUntil: later(), noticeWanted: "confirmation", closureKept: false, ...over,
  });
  const read = async (db: SupabaseClient, id: string) => {
    const { data, error } = await db.from("bookings")
      .select("status, author_kind, author_id, place_id, meeting_type, hold_until, hold_settled_at, notice_wanted, booker_timezone, closure_kept_at, rescheduled_from_id")
      .eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data as Record<string, unknown> | null;
  };
  // One read per id, with the `.eq("payload->>bookingId", …)` shape undoOperatorCancel already uses.
  const eventsFor = async (db: SupabaseClient, accountId: string, ids: string[]) => {
    const out: unknown[] = [];
    for (const id of ids) {
      const { data, error } = await db.from("events").select("type, payload")
        .eq("account_id", accountId).eq("payload->>bookingId", id);
      if (error) throw new Error(error.message);
      out.push(...(data ?? []));
    }
    return out;
  };

  it("(a) createStaffJob writes a person-made row with its place, kind, hold and notice, no booker zone, and NO event (D8)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seed(db, accountId);
      const holdUntil = later();
      const { id } = await createStaffJob(db, accountId, job(s, "2032-03-01T15:00:00Z", "2032-03-01T16:00:00Z", { holdUntil }), ACTOR);
      const row = await read(db, id);
      expect(row).toMatchObject({
        status: "booked", author_kind: "person", author_id: ACTOR, place_id: s.placeId, meeting_type: "in_person",
        hold_settled_at: null, notice_wanted: "confirmation", booker_timezone: null, closure_kept_at: null,
      });
      expect(new Date(row!.hold_until as string).toISOString()).toBe(holdUntil.toISOString());
      expect(await eventsFor(db, accountId, [id])).toEqual([]);
    });
  });

  it("(b) ASSUMPTION 17a: a customer row over a staff job is refused 23P01 THROUGH PostgREST, by the trigger, on insert and on an un-cancel; back-to-back is legal (mutation: a trigger raising P0001 → the raw code assertion FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seed(db, accountId);
      // A customer booking at 10:00, cancelled BEFORE the staff job takes its time.
      const early = await createBooking(db, accountId,
        { calendarId: s.calendarId, contactId: s.contactId, startsAt: at("2032-03-02T10:00:00Z"), endsAt: at("2032-03-02T11:00:00Z") }, "public", "system");
      await setBookingStatus(db, accountId, early.id, "cancelled", ACTOR);
      await createStaffJob(db, accountId, job(s, "2032-03-02T10:00:00Z", "2032-03-02T12:00:00Z"), ACTOR);

      // The raw PostgREST answer, not createBooking's mapping (which would also accept the constraint's name in
      // the message): the code itself is 23P01, and the words are the TRIGGER's (the constraint never sees a
      // person-made row, so it cannot be what refused).
      const raw = await db.from("bookings").insert({
        account_id: accountId, calendar_id: s.calendarId, contact_id: s.contactId,
        starts_at: "2032-03-02T11:00:00Z", ends_at: "2032-03-02T11:30:00Z", cancel_token: newCancelToken(), author_kind: "customer",
      }).select("id");
      expect(raw.error?.code).toBe("23P01");
      expect(raw.error?.message).toContain("overlaps a job staff booked");

      await expect(createBooking(db, accountId,
        { calendarId: s.calendarId, contactId: s.contactId, startsAt: at("2032-03-02T11:30:00Z"), endsAt: at("2032-03-02T12:30:00Z") }, "public", "system"),
      ).rejects.toThrow(SlotTakenError);
      // An UPDATE back to booked re-enters the trigger (spec section 7: a staff Undo of a cancelled customer row).
      await expect(setBookingStatus(db, accountId, early.id, "booked", ACTOR, "user", { onlyFrom: "cancelled" }))
        .rejects.toThrow(SlotTakenError);
      // [) bounds: a customer row ending exactly where the job starts saves.
      await expect(createBooking(db, accountId,
        { calendarId: s.calendarId, contactId: s.contactId, startsAt: at("2032-03-02T09:00:00Z"), endsAt: at("2032-03-02T10:00:00Z") }, "public", "system"),
      ).resolves.toBeTruthy();
    });
  });

  it("(c) ASSUMPTION 17b: listAgendaBookings puts a 23:00-01:00 job on both days with its place and customer embedded, and contacts and places still embed each other unambiguously (mutation: filter on starts_at only → the second day misses it, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seed(db, accountId);
      const { id } = await createStaffJob(db, accountId, job(s, "2032-04-01T23:00:00Z", "2032-04-02T01:00:00Z"), ACTOR);
      const { id: other } = await createStaffJob(db, accountId, job(s, "2032-04-03T15:00:00Z", "2032-04-03T16:00:00Z"), ACTOR);
      const day1 = await listAgendaBookings(db, accountId, "2032-04-01T00:00:00.000Z", "2032-04-02T00:00:00.000Z");
      const day2 = await listAgendaBookings(db, accountId, "2032-04-02T00:00:00.000Z", "2032-04-03T00:00:00.000Z");
      expect(day1.rows.map((r) => r.id)).toEqual([id]);
      expect(day2.rows.map((r) => r.id)).toEqual([id]);
      expect(day1.truncated).toBe(false);
      expect(day1.rows[0]).toMatchObject({
        place_id: s.placeId, meeting_type: "in_person", author_kind: "person", replaced: false,
        place: { label: "Home", address: "1204 Nolana Ave" },
        contact: { first_name: "Ana", last_name: null, phone: null, email: "ana.f046@example.com" },
      });
      expect(day1.rows.map((r) => r.id)).not.toContain(other);
      // Un-hinted, both directions: a many-to-many seen through bookings (or documents) would make each of these
      // ambiguous (PGRST201, its details naming the junction). Nothing in the app embeds them today, so they are
      // probes only; the error, not just its absence, is printed on a failure.
      for (const [table, select] of [["contacts", "id, places(id)"], ["places", "id, contacts(id)"], ["places", "id, bookings(id)"]] as const) {
        const { error } = await db.from(table).select(select).eq("account_id", accountId).limit(1);
        expect({ table, select, error }).toEqual({ table, select, error: null });
      }
    });
  });

  it("(d) listDueReminders skips a staff job whose hold is UNSETTLED even with hold_until past (the clock is not the gate), and lists it once claimJobHold settles it (mutation: `hold_until.lte.<now>` → listed before the claim, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seed(db, accountId);
      const { id } = await createStaffJob(db, accountId,
        job(s, "2032-03-10T15:00:00Z", "2032-03-10T15:15:00Z", { holdUntil: past() }), ACTOR);
      // Control: a customer booking in the same window IS listed, so an empty answer cannot pass this vacuously.
      const control = await createBooking(db, accountId,
        { calendarId: s.calendarId, contactId: s.contactId, startsAt: at("2032-03-10T15:30:00Z"), endsAt: at("2032-03-10T16:00:00Z") }, "public", "system");
      const now = "2032-03-09T15:30:00.000Z";   // 23.5 h before the job
      const due = async () => (await listDueReminders(db, now)).map((d) => d.bookingId);
      const before = await due();
      expect(before).toContain(control.id);
      expect(before).not.toContain(id);
      expect(await claimJobHold(db, accountId, id, new Date().toISOString())).toMatchObject({ id, status: "booked", notice_wanted: "confirmation" });
      expect(await due()).toContain(id);
    });
  });

  it("(e) a customer's move of a staff job (no `job`) carries its place and meeting type (mutation: omit them → NULLs, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seed(db, accountId);
      const { id } = await createStaffJob(db, accountId,
        job(s, "2032-03-12T15:00:00Z", "2032-03-12T16:00:00Z", { meetingType: "phone" }), ACTOR);
      // A later, non-overlapping time: the new row is the customer's, so it may not overlap the live staff row.
      const moved = await moveBooking(db, accountId, id, { startsAt: at("2032-03-12T17:00:00Z"), endsAt: at("2032-03-12T18:00:00Z") }, "public", "system");
      expect(await read(db, moved.id)).toMatchObject({
        status: "booked", author_kind: "customer", place_id: s.placeId, meeting_type: "phone", hold_until: null, rescheduled_from_id: id,
      });
      expect((await read(db, id))?.status).toBe("cancelled");
    });
  });

  it("(f) the claim and the Undo serialise on the row: claim first → 'settled' and the row stays; Undo first → 'deleted' and the claim answers null; a hold not yet due is never claimed", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seed(db, accountId);
      const nowIso = () => new Date().toISOString();
      const a = await createStaffJob(db, accountId, job(s, "2032-03-14T15:00:00Z", "2032-03-14T16:00:00Z", { holdUntil: past() }), ACTOR);
      expect((await claimJobHold(db, accountId, a.id, nowIso()))?.id).toBe(a.id);
      expect(await deleteUnsettledStaffJob(db, accountId, a.id, ACTOR)).toBe("settled");
      expect((await read(db, a.id))?.status).toBe("booked");

      const b = await createStaffJob(db, accountId, job(s, "2032-03-14T17:00:00Z", "2032-03-14T18:00:00Z", { holdUntil: past() }), ACTOR);
      expect(await deleteUnsettledStaffJob(db, accountId, b.id, ACTOR)).toBe("deleted");
      expect(await claimJobHold(db, accountId, b.id, nowIso())).toBeNull();
      expect(await read(db, b.id)).toBeNull();

      const c = await createStaffJob(db, accountId, job(s, "2032-03-14T19:00:00Z", "2032-03-14T20:00:00Z", { holdUntil: later() }), ACTOR);
      expect(await claimJobHold(db, accountId, c.id, nowIso())).toBeNull();
      expect(await deleteUnsettledStaffJob(db, accountId, c.id, "user_someone_else")).toBe("not_yours");
    });
  });

  it("(g) undoStaffMove round trip: the held new row is deleted and the old row is booked again → 'undone'", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seed(db, accountId);
      const { id: oldId } = await createStaffJob(db, accountId, job(s, "2032-03-16T15:00:00Z", "2032-03-16T16:00:00Z"), ACTOR);
      const moved = await moveBooking(db, accountId, oldId, { startsAt: at("2032-03-16T17:00:00Z"), endsAt: at("2032-03-16T18:00:00Z"),
        job: { note: "Moved", placeId: s.placeId, meetingType: "in_person", holdUntil: later(), closureKept: false } }, ACTOR);
      expect(await undoStaffMove(db, accountId, moved.id, oldId, moved.cancelledAt, new Date())).toBe("undone");
      expect(await read(db, moved.id)).toBeNull();
      expect((await read(db, oldId))?.status).toBe("booked");
    });
  });

  it("(h) plan review item 2: a held add moved with `job` writes no events and no notice on the new row; its due hold is NOT claimed while cancelled; after the move's Undo it is claimed with its confirmation (mutation: claim without the status term → the cancelled row is claimed, FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seed(db, accountId);
      const { id: oldId } = await createStaffJob(db, accountId,
        job(s, "2032-03-18T15:00:00Z", "2032-03-18T16:00:00Z", { holdUntil: past(), noticeWanted: "confirmation" }), ACTOR);
      const moved = await moveBooking(db, accountId, oldId, { startsAt: at("2032-03-18T17:00:00Z"), endsAt: at("2032-03-18T18:00:00Z"),
        job: { note: "Fix the gate", placeId: s.placeId, meetingType: "in_person", holdUntil: later(), closureKept: false } }, ACTOR);
      expect(await read(db, moved.id)).toMatchObject({ status: "booked", author_kind: "person", notice_wanted: null, hold_settled_at: null, rescheduled_from_id: oldId });
      expect(await eventsFor(db, accountId, [oldId, moved.id])).toEqual([]);
      expect(await claimJobHold(db, accountId, oldId, new Date().toISOString())).toBeNull();
      expect(await undoStaffMove(db, accountId, moved.id, oldId, moved.cancelledAt, new Date())).toBe("undone");
      expect(await claimJobHold(db, accountId, oldId, new Date().toISOString()))
        .toMatchObject({ id: oldId, status: "booked", notice_wanted: "confirmation" });
    });
  });

  it("(i) plan review item 3: the Undo of an add never deletes a move's held new row → 'is_move', both rows unchanged (mutation: drop the rescheduled_from_id term → 'deleted', FAILS)", async () => {
    await withTestAccount(async (db, accountId) => {
      const s = await seed(db, accountId);
      const { id: oldId } = await createStaffJob(db, accountId, job(s, "2032-03-20T15:00:00Z", "2032-03-20T16:00:00Z"), ACTOR);
      const moved = await moveBooking(db, accountId, oldId, { startsAt: at("2032-03-20T17:00:00Z"), endsAt: at("2032-03-20T18:00:00Z"),
        job: { note: null, placeId: null, meetingType: "phone", holdUntil: later(), closureKept: false } }, ACTOR);
      expect(await deleteUnsettledStaffJob(db, accountId, moved.id, ACTOR)).toBe("is_move");
      expect((await read(db, moved.id))?.status).toBe("booked");
      expect((await read(db, oldId))?.status).toBe("cancelled");
    });
  });
});
