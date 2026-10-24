import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Task 7 (staff and roles): `updateCalendarSettingsAction` guards with
// `requireAccountOwner`, which redirects Staff before the write; every other
// action in this file (bookings) stays on `requireAccountAccess`, which
// admits Staff. `owner.allowed` toggles the owner guard's redirect so both
// the negative (Staff refused) and positive-control (bookings unaffected)
// tests can drive it without re-mocking per test.
const owner = vi.hoisted(() => ({ allowed: true, calls: [] as string[] }));
// S-47d Task 8 ("Keep"): `access.value` lets a test drive `requireAccountAccess`'s role, the same shape
// `tasks/actions.test.ts`'s `authFixture` uses. Every pre-existing test here keeps the old default
// (isAgency: true), so `seesWholeAccount` still reads true for all of them unchanged.
const access = vi.hoisted(() => ({
  value: { userId: "user_1", isAgency: true, role: null } as
    { userId: string; isAgency: boolean; role: "owner" | "staff" | "technician" | null },
}));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => access.value,
  requireAccountOwner: async (accountId: string) => {
    owner.calls.push(accountId);
    if (!owner.allowed) throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
    return { userId: "user_1", isAgency: true };
  },
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));
// F-085 part 1 (spec §7.3): every booking write below first proves the
// booking through the caller's own client. Default: visible, so the rest of
// this file tests today's behaviour; the "caller cannot see" block flips it.
const visible = vi.hoisted(() => ({ callerCanSee: vi.fn(), noticeBelongsToBooking: vi.fn() }));
vi.mock("@/lib/auth/visible", () => ({
  callerCanSee: visible.callerCanSee, noticeBelongsToBooking: visible.noticeBelongsToBooking,
}));
// F-048: the notice is scheduled with after(), and its origin read from the
// request. The callback is captured and run by hand: cancel-notice.test.ts
// covers what the notice itself does.
const nextMocks = vi.hoisted(() => ({ after: vi.fn(), headers: vi.fn() }));
vi.mock("next/server", () => ({ after: nextMocks.after }));
vi.mock("next/headers", () => ({ headers: nextMocks.headers }));
const notice = vi.hoisted(() => ({ availability: vi.fn(), queue: vi.fn(), send: vi.fn() }));
vi.mock("./cancel-notice", () => ({
  cancelNoticeAvailability: notice.availability,
  queueCancelNotice: notice.queue,
  sendQueuedCancelNotice: notice.send,
}));

const dbMocks = vi.hoisted(() => ({
  updateCalendarSettings: vi.fn(), setBookingStatus: vi.fn(), undoOperatorCancel: vi.fn(),
  discardQueuedNotice: vi.fn(), noticeMessageStatus: vi.fn(),
  serviceDb: vi.fn(() => ({})),
  // Task 17: resolves the stored Spanish follow-up box so `nextSpanishBox`
  // has something to compare against. Read through the SAME request client
  // the write below uses (`{}` from `dbForRequest`'s mock), never serviceDb.
  getOrCreateCalendar: vi.fn(),
  // S-47d Task 8 ("Keep"): the write, the event and the hold bump.
  setBookingClosureKept: vi.fn(), bumpHeldForAccount: vi.fn(), emit: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks,
}));

import {
  updateCalendarSettingsAction, setBookingStatusAction, undoCancelBookingAction, cancelBookingAction,
  cancelNoticeOptionAction, keepAppointmentAction,
} from "./actions";
import { BookingNotStartedError, BookingNotRestorableError, SlotTakenError } from "@bis/db";
import { m } from "@/lib/messages";
import { t } from "@/lib/i18n/t";
import { DEFAULT_FOLLOWUP_BODY, defaultFollowupBody } from "@/lib/email/templates/followup";

/** The minimum a submission needs beyond `followupBody` for the action to
 *  get past its own validation and reach the patch under test. */
function baseFormData(followupBody: string): FormData {
  const fd = new FormData();
  fd.set("slotDurationMinutes", "30");
  fd.set("bufferMinutes", "0");
  fd.set("minNoticeHours", "1");
  fd.set("maxAdvanceDays", "30");
  fd.set("meetingType", "in_person");
  fd.set("notifyEmails", "");
  fd.set("followupBody", followupBody);
  return fd;
}

beforeEach(() => {
  visible.callerCanSee.mockReset().mockResolvedValue(true);
  visible.noticeBelongsToBooking.mockReset().mockResolvedValue(true);
  dbMocks.updateCalendarSettings.mockReset();
  dbMocks.updateCalendarSettings.mockResolvedValue(undefined);
  dbMocks.getOrCreateCalendar.mockReset();
  dbMocks.getOrCreateCalendar.mockResolvedValue({ followup_body_es: null, followup_body_es_basis: null });
  owner.allowed = true;
  owner.calls = [];
  access.value = { userId: "user_1", isAgency: true, role: null };
});

/**
 * Task 7 (staff and roles): calendar SETTINGS are Owner-only; the booking
 * actions below (cancel, mark no-show, etc.) stay open to Staff. Spec §7:
 * Staff is redirected to their own dashboard, never 403'd, and the write
 * underneath never runs for a refused caller.
 */
describe("updateCalendarSettingsAction — Owner-only (staff and roles)", () => {
  it("guards with requireAccountOwner: Staff is redirected and the write never runs (mutation: guard with requireAccountAccess instead → FAILS)", async () => {
    owner.allowed = false;
    await expect(updateCalendarSettingsAction("acct_1", baseFormData(""))).rejects.toThrow("NEXT_REDIRECT");
    expect(dbMocks.updateCalendarSettings).not.toHaveBeenCalled();
  });

  it("an Owner's (or the agency's) save reaches the write", async () => {
    const r = await updateCalendarSettingsAction("acct_1", baseFormData(""));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateCalendarSettings).toHaveBeenCalled();
    expect(owner.calls).toEqual(["acct_1"]);
  });
});

/**
 * Positive control (brief's step 1): if these ever moved to the owner guard,
 * Staff working bookings would be redirected too, which the brief forbids.
 * `owner.allowed = false` here proves these two actions never even ASK the
 * owner guard a question — they stay on `requireAccountAccess` throughout.
 */
describe("booking actions stay open to Staff (positive control, staff and roles)", () => {
  it("setBookingStatusAction never calls requireAccountOwner (mutation: switch its guard to requireAccountOwner → FAILS, since owner.allowed is false here)", async () => {
    owner.allowed = false;
    dbMocks.setBookingStatus.mockReset().mockResolvedValue(undefined);
    const r = await setBookingStatusAction("acct_1", "bk_1", "completed");
    expect(r).toEqual({ ok: true });
    expect(owner.calls).toEqual([]);
  });

  it("cancelBookingAction never calls requireAccountOwner (mutation: switch its guard to requireAccountOwner → FAILS, since owner.allowed is false here)", async () => {
    owner.allowed = false;
    dbMocks.setBookingStatus.mockReset().mockResolvedValue({ updatedAt: "2026-10-10T00:00:00.000Z" });
    const r = await cancelBookingAction("acct_1", "bk_1", { send: false, locale: "en", message: "" });
    expect(r.ok).toBe(true);
    expect(owner.calls).toEqual([]);
  });
});

describe("updateCalendarSettingsAction — follow-up body normalization", () => {
  /**
   * THE regression this whole task exists to close: a save whose submitted
   * body happens to equal the frozen default (the UI bug seeded exactly this
   * on every unrelated save) must never let that text reach the column —
   * `followupBody` in the patch has to come back "", so an empty column
   * stays the single source of truth for "use the live default at send
   * time" (`bookingFollowupEmail` in followup.ts).
   */
  it("normalizes a submitted body equal to the default to an empty string", async () => {
    const r = await updateCalendarSettingsAction("acct_1", baseFormData(DEFAULT_FOLLOWUP_BODY));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateCalendarSettings).toHaveBeenCalledWith(
      {}, "acct_1", expect.objectContaining({ followupBody: "" }), "user_1",
    );
  });

  it("normalizes even when the default arrives with surrounding whitespace", async () => {
    const r = await updateCalendarSettingsAction(
      "acct_1", baseFormData(`  ${DEFAULT_FOLLOWUP_BODY}\n`),
    );
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateCalendarSettings).toHaveBeenCalledWith(
      {}, "acct_1", expect.objectContaining({ followupBody: "" }), "user_1",
    );
  });

  it("passes a genuinely custom body through untouched", async () => {
    const custom = "See you next week — reply here with any questions!";
    const r = await updateCalendarSettingsAction("acct_1", baseFormData(custom));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateCalendarSettings).toHaveBeenCalledWith(
      {}, "acct_1", expect.objectContaining({ followupBody: custom }), "user_1",
    );
  });

  it("leaves an already-empty body empty", async () => {
    const r = await updateCalendarSettingsAction("acct_1", baseFormData(""));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateCalendarSettings).toHaveBeenCalledWith(
      {}, "acct_1", expect.objectContaining({ followupBody: "" }), "user_1",
    );
  });
});

/**
 * Task 17: the follow-up card's Spanish box. `nextSpanishBox` (Task 1) does
 * the save-side rule; this action supplies it the stored row, read through
 * the SAME request client as the write (never serviceDb() — the settings
 * grant is client-role, 0022:12-13, and 0076 granted the two columns).
 */
describe("updateCalendarSettingsAction — the follow-up's Spanish box (Task 17)", () => {
  it("a Spanish box equal to our default stores followupBodyEs: null", async () => {
    const fd = baseFormData("Custom English");
    fd.set("body_es", defaultFollowupBody("es"));
    const r = await updateCalendarSettingsAction("acct_1", fd);
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateCalendarSettings).toHaveBeenCalledWith(
      {}, "acct_1", expect.objectContaining({ followupBodyEs: null }), "user_1",
    );
  });

  it("an edited Spanish stores it, with the basis set to the saved English (mutation: drop the basis → FAILS)", async () => {
    const fd = baseFormData("Custom English");
    fd.set("body_es", "Nuestro texto personalizado.");
    const r = await updateCalendarSettingsAction("acct_1", fd);
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateCalendarSettings).toHaveBeenCalledWith(
      {}, "acct_1",
      expect.objectContaining({
        followupBodyEs: "Nuestro texto personalizado.", followupBodyEsBasis: "Custom English",
      }),
      "user_1",
    );
  });

  it("an English body over 1,000 characters is refused, and nothing is written (mutation: drop the English length check → FAILS)", async () => {
    const r = await updateCalendarSettingsAction("acct_1", baseFormData("x".repeat(1001)));
    expect(r).toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.updateCalendarSettings).not.toHaveBeenCalled();
  });

  it("a Spanish body over 1,000 characters is refused, and nothing is written (mutation: drop the Spanish length check → FAILS)", async () => {
    const fd = baseFormData("Custom English");
    fd.set("body_es", "x".repeat(1001));
    const r = await updateCalendarSettingsAction("acct_1", fd);
    expect(r).toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.updateCalendarSettings).not.toHaveBeenCalled();
  });

  // Review round 1 (Important 1): the automations/voice convention checks the
  // UNTRIMMED length (`voice/actions.ts:84`'s `textbackBody.length`,
  // `automations/actions.ts`'s `body.length`) — trimming first lets 1,001
  // spaces (trim-empty) sail past the bound and land in the column untrimmed.
  it("an English body of 1,001 spaces is still refused (untrimmed length, mutation: check .trim().length instead → FAILS)", async () => {
    const r = await updateCalendarSettingsAction("acct_1", baseFormData(" ".repeat(1001)));
    expect(r).toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.updateCalendarSettings).not.toHaveBeenCalled();
  });

  it("a Spanish body of 1,001 spaces is still refused (untrimmed length, mutation: check .trim().length instead → FAILS)", async () => {
    const fd = baseFormData("Custom English");
    fd.set("body_es", " ".repeat(1001));
    const r = await updateCalendarSettingsAction("acct_1", fd);
    expect(r).toEqual({ ok: false, error: m["automations.bodyTooLong"] });
    expect(dbMocks.updateCalendarSettings).not.toHaveBeenCalled();
  });

  it("reads the stored Spanish box through the request client, not serviceDb (mutation: call serviceDb() in this action → FAILS)", async () => {
    const fd = baseFormData("Custom English");
    fd.set("body_es", "Nuestro texto.");
    dbMocks.serviceDb.mockClear();
    await updateCalendarSettingsAction("acct_1", fd);
    expect(dbMocks.getOrCreateCalendar).toHaveBeenCalledWith({}, "acct_1", "user_1");
    // serviceDb() is never even CALLED by this action — not just "not the
    // client used for this read" (a `{}`-returning serviceDb mock would
    // deep-equal dbForRequest()'s `{}` and could never tell the two apart).
    expect(dbMocks.serviceDb).not.toHaveBeenCalled();
  });
});

/**
 * D-030: the server action, not just the button. "Completed" and "No-show"
 * are outcomes; the action asks the write itself to refuse one for an
 * appointment that has not started (`startedBy: now`), so a stale page, a
 * crafted request or the To do screen's close-out (which calls this action)
 * cannot mark a future job — a no-show on a future job would arm the no-show
 * nudge to the customer.
 */
describe("setBookingStatusAction — an outcome only once the appointment has started (D-030)", () => {
  beforeEach(() => {
    dbMocks.setBookingStatus.mockReset();
    dbMocks.setBookingStatus.mockResolvedValue(undefined);
  });

  it("asks the write to refuse completed/no-show before the start, with the server's own clock (mutation: drop the startedBy option → FAILS)", async () => {
    const before = Date.now();
    for (const status of ["completed", "no_show"] as const) {
      expect(await setBookingStatusAction("acct_1", "bk_1", status)).toEqual({ ok: true });
    }
    for (const call of dbMocks.setBookingStatus.mock.calls) {
      const opts = call[6] as { startedBy?: string } | undefined;
      expect(opts?.startedBy).toBeDefined();
      const t = new Date(opts!.startedBy!).getTime();
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(Date.now());
    }
    expect(dbMocks.setBookingStatus).toHaveBeenCalledTimes(2);
  });

  it("answers a not-yet-started refusal in words that say so, not the generic failure", async () => {
    dbMocks.setBookingStatus.mockRejectedValue(new BookingNotStartedError());
    const result = await setBookingStatusAction("acct_1", "bk_1", "no_show");
    expect(result).toEqual({ ok: false, error: m["calendar.bookings.notStartedYet"] });
    expect(m["calendar.bookings.notStartedYet"]).not.toBe(m["calendar.bookings.statusUpdateFailed"]);
  });

  it("any other failure keeps the generic message", async () => {
    dbMocks.setBookingStatus.mockRejectedValue(new Error("db down"));
    const result = await setBookingStatusAction("acct_1", "bk_1", "completed");
    expect(result).toEqual({ ok: false, error: m["calendar.bookings.statusUpdateFailed"] });
  });
});

/**
 * D-034. The notify field split on new lines only, so "a@x.com, b@y.com" —
 * the way the forms editor and the weekly-report field both ask for it —
 * was stored as ONE address that no mail server accepts, and nothing checked
 * any address at all: a typo saved green and the alert went nowhere, forever,
 * with no symptom. Same shape as `setReportEmailsAction`: refuse the whole
 * save on the first bad address, naming it, rather than dropping it and
 * reporting "saved" while quietly losing a recipient.
 */
describe("updateCalendarSettingsAction — notify addresses (D-034)", () => {
  function withNotify(raw: string): FormData {
    const fd = baseFormData("");
    fd.set("notifyEmails", raw);
    return fd;
  }

  it("splits on commas, semicolons and new lines, trimming and dropping blanks", async () => {
    const r = await updateCalendarSettingsAction(
      "acct_1", withNotify("ana@example.com, ben@example.com;cy@example.com\r\n\n  dee@example.com ,"),
    );
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateCalendarSettings).toHaveBeenCalledWith(
      {}, "acct_1",
      expect.objectContaining({
        notifyEmails: ["ana@example.com", "ben@example.com", "cy@example.com", "dee@example.com"],
      }),
      "user_1",
    );
  });

  it("refuses the whole save on a bad address, names it, and writes nothing", async () => {
    const r = await updateCalendarSettingsAction("acct_1", withNotify("ana@example.com\nbob@example"));
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, error: expect.stringContaining("bob@example") });
    expect(dbMocks.updateCalendarSettings).not.toHaveBeenCalled();
  });

  it("an empty field still saves, as no addresses", async () => {
    const r = await updateCalendarSettingsAction("acct_1", withNotify("  \n , "));
    expect(r).toEqual({ ok: true });
    expect(dbMocks.updateCalendarSettings).toHaveBeenCalledWith(
      {}, "acct_1", expect.objectContaining({ notifyEmails: [] }), "user_1",
    );
  });

  /**
   * The hint is a promise about mail. These addresses are read by exactly
   * five senders, every one an event a customer or Sofía caused: a web
   * booking (`b/[publicId]/actions.ts`, operator.booking_alert), a customer's
   * cancel link (`cancel/[token]/actions.ts`, operator.cancel_notice), a
   * phone cancel or move (`voice/tools/registry.ts`,
   * operator.phone_change_alert) and Sofía's call alert for a booking, lead
   * or message (`voice/finish-call.ts`, operator.call_alert). The reminder
   * pass mails the CUSTOMER only (`automations/passes/reminders.ts`), so
   * "an appointment is coming up" was an alert that never existed.
   */
  it("the hint promises no reminder alert, and says how to separate addresses", () => {
    const hint = m["calendar.settings.notifyEmailsHint"];
    expect(hint).not.toMatch(/coming up|reminder/i);
    expect(hint).toMatch(/comma/i);
  });
});

/**
 * D-036. Cancel on the Calendar page was irreversible. It tells nobody (no
 * customer email, no staff alert; `setBookingStatus` writes the row and one
 * event, and nothing reacts to that event but the activity feed), so it is
 * REVERSIBLE in DESIGN.md rule 6's sense: it runs at once with an Undo. The
 * Undo is its own action, an un-cancel only, and the generic status action
 * no longer accepts "booked" at all, so there is exactly one way back and it
 * carries the guard.
 */
describe("undoCancelBookingAction — the Calendar page's Undo (D-036)", () => {
  beforeEach(() => {
    dbMocks.setBookingStatus.mockReset();
    dbMocks.setBookingStatus.mockResolvedValue(undefined);
    dbMocks.undoOperatorCancel.mockReset();
    dbMocks.undoOperatorCancel.mockResolvedValue(undefined);
    dbMocks.discardQueuedNotice.mockReset().mockResolvedValue(true);
    dbMocks.noticeMessageStatus.mockReset().mockResolvedValue(null);
  });

  const V = "2026-10-09T18:00:00.123Z";

  // undoOperatorCancel carries the guards (a person's cancel, not replaced
  // by a reschedule, only FROM cancelled); booking.test.ts pins them.
  it("restores through undoOperatorCancel, as the signed-in user, naming the cancel's version (F-048; mutation: drop the version → FAILS)", async () => {
    expect(await undoCancelBookingAction("acct_1", "bk_1", V)).toEqual({ ok: true });
    expect(dbMocks.undoOperatorCancel).toHaveBeenCalledWith({}, "acct_1", "bk_1", "user_1", V);
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
  });

  it("M1: an Undo without a version is refused and writes nothing (mutation: fall back to an unversioned Undo → FAILS)", async () => {
    for (const bad of [undefined, ""]) {
      expect(await undoCancelBookingAction("acct_1", "bk_1", bad as unknown as string))
        .toEqual({ ok: false, error: m["calendar.bookings.statusUpdateFailed"] });
    }
    expect(dbMocks.undoOperatorCancel).not.toHaveBeenCalled();
  });

  it("I2: a winning Undo removes the notice's queued thread row, since it will never be sent (mutation: leave it → FAILS)", async () => {
    expect(await undoCancelBookingAction("acct_1", "bk_1", V, "msg_1")).toEqual({ ok: true });
    expect(dbMocks.discardQueuedNotice).toHaveBeenCalledWith({}, "acct_1", "msg_1");
  });

  it("I2: a refused Undo removes nothing", async () => {
    dbMocks.undoOperatorCancel.mockRejectedValue(new BookingNotRestorableError("superseded"));
    dbMocks.noticeMessageStatus.mockResolvedValue("sent");
    await undoCancelBookingAction("acct_1", "bk_1", V, "msg_1");
    expect(dbMocks.discardQueuedNotice).not.toHaveBeenCalled();
  });

  it("says plainly when the time was booked by someone else in between", async () => {
    dbMocks.undoOperatorCancel.mockRejectedValue(new SlotTakenError());
    const r = await undoCancelBookingAction("acct_1", "bk_1", V);
    expect(r).toEqual({ ok: false, error: m["calendar.bookings.restoreSlotTaken"] });
    expect(m["calendar.bookings.restoreSlotTaken"]).toMatch(/booked that time/);
  });

  it("says the appointment was moved when a reschedule replaced it", async () => {
    dbMocks.undoOperatorCancel.mockRejectedValue(new BookingNotRestorableError("rescheduled"));
    expect(await undoCancelBookingAction("acct_1", "bk_1", V))
      .toEqual({ ok: false, error: m["calendar.bookings.restoreRescheduled"] });
    expect(m["calendar.bookings.restoreRescheduled"]).toMatch(/moved/i);
  });

  it("says it was the customer's or a call's cancel, not one to undo from here", async () => {
    dbMocks.undoOperatorCancel.mockRejectedValue(new BookingNotRestorableError("not_operator_cancel"));
    expect(await undoCancelBookingAction("acct_1", "bk_1", V))
      .toEqual({ ok: false, error: m["calendar.bookings.restoreNotOurs"] });
    expect(m["calendar.bookings.restoreNotOurs"]).toMatch(/customer/i);
  });

  // I2: too late to undo. What the owner is told about the customer is read
  // off the notice's own row, never assumed (mutation: always say "emailed"
  // → the failed and queued rows FAIL).
  it.each([
    ["sent", "calendar.bookings.restoreCustomerTold"],
    ["delivered", "calendar.bookings.restoreCustomerTold"],
    ["failed", "calendar.bookings.restoreNoticeFailed"],
    ["bounced", "calendar.bookings.restoreNoticeFailed"],
    ["queued", "calendar.bookings.restoreNoticeUnknown"],
    [null, "calendar.bookings.restoreChanged"],
  ] as const)("too late, notice row %s: says %s", async (status, key) => {
    dbMocks.undoOperatorCancel.mockRejectedValue(new BookingNotRestorableError("superseded"));
    dbMocks.noticeMessageStatus.mockResolvedValue(status);
    expect(await undoCancelBookingAction("acct_1", "bk_1", V, "msg_1")).toEqual({ ok: false, error: m[key] });
    expect(dbMocks.noticeMessageStatus).toHaveBeenCalledWith({}, "acct_1", "msg_1");
  });

  it("too late with no notice at all: the cancel was replaced, not emailed (never 'already emailed')", async () => {
    dbMocks.undoOperatorCancel.mockRejectedValue(new BookingNotRestorableError("superseded"));
    expect(await undoCancelBookingAction("acct_1", "bk_1", V))
      .toEqual({ ok: false, error: m["calendar.bookings.restoreChanged"] });
  });

  it("too late and the notice row cannot be read: 'not known', never 'emailed'", async () => {
    dbMocks.undoOperatorCancel.mockRejectedValue(new BookingNotRestorableError("superseded"));
    dbMocks.noticeMessageStatus.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await undoCancelBookingAction("acct_1", "bk_1", V, "msg_1"))
      .toEqual({ ok: false, error: m["calendar.bookings.restoreNoticeUnknown"] });
  });

  it("the words say what they claim", () => {
    expect(m["calendar.bookings.restoreCustomerTold"]).toMatch(/emailed/);
    expect(m["calendar.bookings.restoreNoticeFailed"]).toMatch(/didn't go through/);
    expect(m["calendar.bookings.restoreNoticeUnknown"]).not.toMatch(/emailed|didn't go/);
  });

  it("any other failure is the generic message", async () => {
    dbMocks.undoOperatorCancel.mockRejectedValue(new Error("no booking"));
    expect(await undoCancelBookingAction("acct_1", "bk_1", V))
      .toEqual({ ok: false, error: m["calendar.bookings.statusUpdateFailed"] });
  });

  it("the generic status action refuses \"booked\" and writes nothing (the Undo is the only way back)", async () => {
    const r = await setBookingStatusAction("acct_1", "bk_1", "booked");
    expect(r).toEqual({ ok: false, error: m["calendar.bookings.statusUpdateFailed"] });
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
  });

  /**
   * Review minor: Cancel from a stale tab hit whatever the row had become,
   * so a job already marked COMPLETED could be cancelled (and its Undo,
   * guarded to un-cancel only, could then not reopen it). Cancel now writes
   * only a row that is still "booked".
   */
  it("Cancel writes only a booking that is still booked (mutation: drop onlyFrom → FAILS)", async () => {
    expect(await setBookingStatusAction("acct_1", "bk_1", "cancelled")).toEqual({ ok: true });
    const opts = dbMocks.setBookingStatus.mock.calls[0]![6] as { onlyFrom?: string };
    expect(opts.onlyFrom).toBe("booked");
  });

  it("an outcome is not limited to booked rows (completed ↔ no-show stays correctable)", async () => {
    await setBookingStatusAction("acct_1", "bk_1", "completed");
    const opts = dbMocks.setBookingStatus.mock.calls[0]![6] as { onlyFrom?: string };
    expect(opts.onlyFrom).toBeUndefined();
  });
});

/**
 * F-048: the Calendar page's Cancel, with its customer notice. Cancels at
 * once (DESIGN.md rule 6) and answers the cancel's version, which the Undo
 * hands back; when the owner asked for the notice and it can go, it is
 * scheduled to run after the response, never sent inside it.
 */
describe("cancelBookingAction — cancel now, tell the customer when the Undo closes (F-048)", () => {
  const VERSION = "2026-10-09T18:00:00.123Z";
  const NOTICE = { send: true, locale: "es", message: "  Lo sentimos.\r\nHasta pronto.  " };
  const QUEUED = { messageId: "msg_1", email: { to: "maria@example.com" } };
  const runScheduled = async () => {
    for (const [fn] of nextMocks.after.mock.calls) await (fn as () => Promise<unknown>)();
  };

  beforeEach(() => {
    dbMocks.setBookingStatus.mockReset().mockResolvedValue({ updatedAt: VERSION });
    notice.availability.mockReset().mockResolvedValue("available");
    notice.queue.mockReset().mockResolvedValue(QUEUED);
    notice.send.mockReset().mockResolvedValue("sent");
    nextMocks.after.mockReset();
    nextMocks.headers.mockReset().mockResolvedValue(new Headers({ host: "app.example.com", "x-forwarded-proto": "https" }));
  });

  it("cancels only a booking that is still booked, as the signed-in user, and answers the version (mutation: drop onlyFrom → FAILS)", async () => {
    const r = await cancelBookingAction("acct_1", "bk_1", { ...NOTICE, send: false });
    expect(r).toEqual({ ok: true, version: VERSION, notice: "none" });
    expect(dbMocks.setBookingStatus).toHaveBeenCalledWith({}, "acct_1", "bk_1", "cancelled", "user_1", "user", { onlyFrom: "booked" });
  });

  it("I2: queues the thread row in THIS request, after the cancel, and answers its id (mutation: queue inside after() → FAILS)", async () => {
    const order: string[] = [];
    dbMocks.setBookingStatus.mockImplementation(async () => { order.push("cancel"); return { updatedAt: VERSION }; });
    notice.queue.mockImplementation(async () => { order.push("queue"); return QUEUED; });
    nextMocks.after.mockImplementation(() => { order.push("after"); });
    const r = await cancelBookingAction("acct_1", "bk_1", NOTICE);
    expect(r).toEqual({ ok: true, version: VERSION, notice: "scheduled", noticeMessageId: "msg_1" });
    expect(order).toEqual(["cancel", "queue", "after"]);
    expect(notice.queue).toHaveBeenCalledWith({}, {
      accountId: "acct_1", bookingId: "bk_1", userId: "user_1",
      locale: "es", message: "Lo sentimos.\nHasta pronto.", origin: "https://app.example.com",
    });
  });

  it("sends only after the response, with the cancel's version and the queued row (mutation: send inline instead of after() → FAILS)", async () => {
    await cancelBookingAction("acct_1", "bk_1", NOTICE);
    expect(notice.send).not.toHaveBeenCalled();
    expect(nextMocks.after).toHaveBeenCalledTimes(1);
    await runScheduled();
    expect(notice.send).toHaveBeenCalledWith({ accountId: "acct_1", bookingId: "bk_1", version: VERSION, userId: "user_1", queued: QUEUED });
  });

  it("a notice that was not asked for is never checked, queued or scheduled (mutation: ignore send → FAILS)", async () => {
    await cancelBookingAction("acct_1", "bk_1", { ...NOTICE, send: false });
    expect(notice.availability).not.toHaveBeenCalled();
    expect(notice.queue).not.toHaveBeenCalled();
    expect(nextMocks.after).not.toHaveBeenCalled();
  });

  it.each(["no_email", "suppressed_account"] as const)("%s: still cancels, queues and schedules nothing, promises nothing (mutation: schedule anyway → FAILS)", async (a) => {
    notice.availability.mockResolvedValue(a);
    expect(await cancelBookingAction("acct_1", "bk_1", NOTICE)).toEqual({ ok: true, version: VERSION, notice: "none" });
    expect(notice.queue).not.toHaveBeenCalled();
    expect(nextMocks.after).not.toHaveBeenCalled();
  });

  it("M2: an address that hard-bounced or complained: still cancels, schedules nothing, and says so", async () => {
    notice.availability.mockResolvedValue("address_blocked");
    expect(await cancelBookingAction("acct_1", "bk_1", NOTICE)).toEqual({ ok: true, version: VERSION, notice: "address_blocked" });
    expect(nextMocks.after).not.toHaveBeenCalled();
  });

  it("a notice that cannot be queued after the cancel committed is not promised: notice none, nothing scheduled", async () => {
    notice.queue.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await cancelBookingAction("acct_1", "bk_1", NOTICE)).toEqual({ ok: true, version: VERSION, notice: "none" });
    expect(nextMocks.after).not.toHaveBeenCalled();
  });

  it("a language it does not speak is English, never an exception", async () => {
    await cancelBookingAction("acct_1", "bk_1", { ...NOTICE, locale: "fr" });
    expect(notice.queue.mock.calls[0]![1]).toMatchObject({ locale: "en" });
  });

  it("a message over the limit is refused in words, and nothing is cancelled (mutation: drop the bound → FAILS)", async () => {
    const r = await cancelBookingAction("acct_1", "bk_1", { ...NOTICE, message: "x".repeat(2001) });
    expect(r).toEqual({ ok: false, error: m["calendar.cancelDialog.messageTooLong"] });
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
  });

  // Fix round 2 (M-a): a notice check that fails FAILS OPEN to the
  // reversible action. The cancel goes ahead with no notice, and the answer
  // "none" makes the toast say the customer was not told, so no email is
  // promised that nobody could check (mutation: refuse the cancel → FAILS).
  it("a notice check that fails still cancels, without the notice, and promises nothing", async () => {
    notice.availability.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await cancelBookingAction("acct_1", "bk_1", NOTICE);
    expect(r).toEqual({ ok: true, version: VERSION, notice: "none" });
    expect(dbMocks.setBookingStatus).toHaveBeenCalledTimes(1);
    expect(notice.queue).not.toHaveBeenCalled();
    expect(nextMocks.after).not.toHaveBeenCalled();
  });

  it("a cancel the write refuses queues and schedules nothing", async () => {
    dbMocks.setBookingStatus.mockRejectedValue(new Error("setBookingStatus: no booking"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await cancelBookingAction("acct_1", "bk_1", NOTICE);
    expect(r).toEqual({ ok: false, error: m["calendar.bookings.statusUpdateFailed"] });
    expect(notice.queue).not.toHaveBeenCalled();
    expect(nextMocks.after).not.toHaveBeenCalled();
  });
});

describe("cancelNoticeOptionAction — the server's answer before the dialog opens (F-048 I1, M2)", () => {
  beforeEach(() => { notice.availability.mockReset(); });

  it("answers the availability, read as the signed-in user and the service client", async () => {
    notice.availability.mockResolvedValue("address_blocked");
    expect(await cancelNoticeOptionAction("acct_1", "bk_1")).toEqual({ ok: true, notice: "address_blocked" });
    expect(notice.availability).toHaveBeenCalledWith({}, {}, "acct_1", "bk_1");
  });

  it("a read that fails is an error, never a guess", async () => {
    notice.availability.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await cancelNoticeOptionAction("acct_1", "bk_1"))
      .toEqual({ ok: false, error: m["calendar.bookings.statusUpdateFailed"] });
  });
});

/**
 * F-085 part 1, spec §7.3: "prove the target through the request client, then
 * write through the service client". These four actions write (or read) with
 * serviceDb(), which RLS does not bind, so a Technician whose 0068 policies
 * hide another person's customer could otherwise change that customer's
 * booking by id. Each must ask `callerCanSee("bookings", …)` FIRST, and on a
 * "no" or a failed proof answer the generic refusal and touch nothing.
 */
describe("booking actions prove the booking through the caller's own client first (F-085, spec §7.3)", () => {
  const V = "2026-10-09T18:00:00.123Z";
  const REFUSED = { ok: false, error: m["calendar.bookings.statusUpdateFailed"] };

  beforeEach(() => {
    dbMocks.setBookingStatus.mockReset().mockResolvedValue({ updatedAt: V });
    dbMocks.undoOperatorCancel.mockReset().mockResolvedValue(undefined);
    dbMocks.discardQueuedNotice.mockReset().mockResolvedValue(true);
    notice.availability.mockReset().mockResolvedValue("available");
    notice.queue.mockReset().mockResolvedValue({ messageId: "msg_1", email: { to: "maria@example.com" } });
    notice.send.mockReset().mockResolvedValue("sent");
    nextMocks.after.mockReset();
    nextMocks.headers.mockReset().mockResolvedValue(new Headers({ host: "app.example.com", "x-forwarded-proto": "https" }));
  });

  function expectNothingTouched() {
    expect(dbMocks.setBookingStatus).not.toHaveBeenCalled();
    expect(dbMocks.undoOperatorCancel).not.toHaveBeenCalled();
    expect(dbMocks.discardQueuedNotice).not.toHaveBeenCalled();
    expect(notice.queue).not.toHaveBeenCalled();
    expect(notice.availability).not.toHaveBeenCalled();
    expect(nextMocks.after).not.toHaveBeenCalled();
  }

  const actions = [
    ["setBookingStatusAction", () => setBookingStatusAction("acct_1", "bk_1", "cancelled")],
    ["cancelNoticeOptionAction", () => cancelNoticeOptionAction("acct_1", "bk_1")],
    ["cancelBookingAction", () => cancelBookingAction("acct_1", "bk_1", { send: true, locale: "en", message: "" })],
    ["undoCancelBookingAction", () => undoCancelBookingAction("acct_1", "bk_1", V, "msg_1")],
  ] as const;

  it.each(actions)("%s: a booking the caller cannot see is refused and nothing is written or read with the service key (mutation: check after the write → FAILS)", async (_name, run) => {
    visible.callerCanSee.mockResolvedValue(false);
    expect(await run()).toEqual(REFUSED);
    expect(visible.callerCanSee).toHaveBeenCalledWith("bookings", "acct_1", "bk_1");
    expectNothingTouched();
  });

  it.each(actions)("%s: a proof that cannot be made (read error) is a refusal, never a write (mutation: swallow the throw and carry on → FAILS)", async (name, run) => {
    visible.callerCanSee.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await run()).toEqual(REFUSED);
      expectNothingTouched();
      expect(err.mock.calls.some(([line]) => String(line).startsWith(`${name}: booking bk_1 could not be proven`))).toBe(true);
    } finally {
      err.mockRestore();
    }
  });

  it.each(actions)("%s: a booking the caller can see goes through as today, after the proof", async (_name, run) => {
    const r = await run();
    expect(r.ok).toBe(true);
    expect(visible.callerCanSee).toHaveBeenCalledWith("bookings", "acct_1", "bk_1");
  });
});

/**
 * Task 5a fix round 1 (F1): the Undo's `noticeMessageId` comes from the
 * browser, and `discardQueuedNotice` / `noticeMessageStatus` act on it with
 * serviceDb(), scoped only by account. Proving the BOOKING does not prove the
 * MESSAGE: a Technician could Undo their own cancel with another person's
 * queued email id and delete it. So the id is used only when the caller's own
 * client sees it on the proven booking's contact's thread; otherwise it is
 * treated as absent, and the Undo itself still runs.
 */
describe("undoCancelBookingAction — the notice id is bound to the proven booking (F-085, spec §7.3)", () => {
  const V = "2026-10-09T18:00:00.123Z";

  beforeEach(() => {
    dbMocks.undoOperatorCancel.mockReset().mockResolvedValue(undefined);
    dbMocks.discardQueuedNotice.mockReset().mockResolvedValue(true);
    dbMocks.noticeMessageStatus.mockReset().mockResolvedValue("sent");
  });

  it("the binding is asked of the proven booking and the supplied id; a bound notice is discarded after a winning Undo", async () => {
    expect(await undoCancelBookingAction("acct_1", "bk_1", V, "msg_1")).toEqual({ ok: true });
    expect(visible.noticeBelongsToBooking).toHaveBeenCalledWith("acct_1", "bk_1", "msg_1");
    expect(dbMocks.discardQueuedNotice).toHaveBeenCalledWith({}, "acct_1", "msg_1");
  });

  it("a message on another contact's thread: the Undo still runs, nothing is discarded (mutation: drop the binding check → FAILS)", async () => {
    visible.noticeBelongsToBooking.mockResolvedValue(false);
    expect(await undoCancelBookingAction("acct_1", "bk_1", V, "msg_other")).toEqual({ ok: true });
    expect(dbMocks.undoOperatorCancel).toHaveBeenCalledWith({}, "acct_1", "bk_1", "user_1", V);
    expect(dbMocks.discardQueuedNotice).not.toHaveBeenCalled();
  });

  it("a message on another contact's thread: a superseded Undo reads nothing and says only 'changed' (mutation: drop the binding check → FAILS)", async () => {
    visible.noticeBelongsToBooking.mockResolvedValue(false);
    dbMocks.undoOperatorCancel.mockRejectedValue(new BookingNotRestorableError("superseded"));
    expect(await undoCancelBookingAction("acct_1", "bk_1", V, "msg_other"))
      .toEqual({ ok: false, error: m["calendar.bookings.restoreChanged"] });
    expect(dbMocks.noticeMessageStatus).not.toHaveBeenCalled();
    expect(dbMocks.discardQueuedNotice).not.toHaveBeenCalled();
  });

  it("a binding that cannot be read: neither helper is called, the Undo still runs (mutation: treat a read error as bound → FAILS)", async () => {
    visible.noticeBelongsToBooking.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await undoCancelBookingAction("acct_1", "bk_1", V, "msg_1")).toEqual({ ok: true });
      expect(dbMocks.undoOperatorCancel).toHaveBeenCalledTimes(1);
      expect(dbMocks.discardQueuedNotice).not.toHaveBeenCalled();

      dbMocks.undoOperatorCancel.mockRejectedValue(new BookingNotRestorableError("superseded"));
      expect(await undoCancelBookingAction("acct_1", "bk_1", V, "msg_1"))
        .toEqual({ ok: false, error: m["calendar.bookings.restoreChanged"] });
      expect(dbMocks.noticeMessageStatus).not.toHaveBeenCalled();
      expect(err.mock.calls.some(([line]) => String(line).startsWith("undoCancelBookingAction: notice msg_1 could not be bound"))).toBe(true);
    } finally {
      err.mockRestore();
    }
  });

  it("no notice id: no binding read at all", async () => {
    expect(await undoCancelBookingAction("acct_1", "bk_1", V)).toEqual({ ok: true });
    expect(visible.noticeBelongsToBooking).not.toHaveBeenCalled();
  });
});

/**
 * S-47d Task 8: "Keep" on one affected appointment during a closure — it still happens, so its
 * reminders and follow-up go out as usual. Anyone who may cancel on this calendar (`seesWholeAccount`:
 * the agency, an Owner or Staff) may also Keep; a Technician may not. The write is still proven through
 * the caller's own client first (spec §7.3), same as every other booking action in this file.
 */
describe("keepAppointmentAction — S-47d Task 8", () => {
  beforeEach(() => {
    dbMocks.setBookingClosureKept.mockReset().mockResolvedValue(true);
    dbMocks.bumpHeldForAccount.mockReset().mockResolvedValue(0);
    dbMocks.emit.mockReset().mockResolvedValue(undefined);
  });

  it("a Technician is refused with the role sentence, and nothing is written (mutation: check isAgency alone, ignoring role → FAILS)", async () => {
    access.value = { userId: "user_1", isAgency: false, role: "technician" };
    const r = await keepAppointmentAction("acct_1", "bk_1", true, "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.refuse.role", "en") });
    expect(dbMocks.setBookingClosureKept).not.toHaveBeenCalled();
  });

  it("the Spanish sentence", async () => {
    access.value = { userId: "user_1", isAgency: false, role: "technician" };
    const r = await keepAppointmentAction("acct_1", "bk_1", true, "es");
    expect(r).toEqual({ ok: false, error: "Solo un propietario puede cambiar esto." });
  });

  it("Staff may Keep (sees the whole account, same as cancel)", async () => {
    access.value = { userId: "user_1", isAgency: false, role: "staff" };
    const r = await keepAppointmentAction("acct_1", "bk_1", true, "en");
    expect(r).toEqual({ ok: true });
  });

  it("a proveBooking refusal passes through, and nothing is written (mutation: skip proveBooking → FAILS)", async () => {
    visible.callerCanSee.mockResolvedValue(false);
    const r = await keepAppointmentAction("acct_1", "bk_1", true, "en");
    expect(r).toEqual({ ok: false, error: m["calendar.bookings.statusUpdateFailed"] });
    expect(visible.callerCanSee).toHaveBeenCalledWith("bookings", "acct_1", "bk_1");
    expect(dbMocks.setBookingClosureKept).not.toHaveBeenCalled();
  });

  it.each([[true], [false]])("writes setBookingClosureKept(accountId, bookingId, %s)", async (kept) => {
    const r = await keepAppointmentAction("acct_1", "bk_1", kept, "en");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.setBookingClosureKept).toHaveBeenCalledWith({}, "acct_1", "bk_1", kept);
  });

  it("a write that changes nothing (false) answers the generic failure (mutation: ignore the false → FAILS)", async () => {
    dbMocks.setBookingClosureKept.mockResolvedValue(false);
    const r = await keepAppointmentAction("acct_1", "bk_1", true, "en");
    expect(r).toEqual({ ok: false, error: t(m, "business.toast.failed", "en") });
  });

  it("the bump runs on every success (mutation: drop the bump call → FAILS)", async () => {
    const r = await keepAppointmentAction("acct_1", "bk_1", true, "en");
    expect(r).toEqual({ ok: true });
    expect(dbMocks.bumpHeldForAccount).toHaveBeenCalledWith({}, "acct_1");
  });

  it("emits booking.closure_kept as the signed-in user", async () => {
    await keepAppointmentAction("acct_1", "bk_1", true, "en");
    expect(dbMocks.emit).toHaveBeenCalledWith({}, "acct_1", "booking.closure_kept", "user_1", { booking_id: "bk_1", kept: true }, "user");
  });
});
