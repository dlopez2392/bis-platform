import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requireAccountAccess: async () => ({ userId: "user_1", isAgency: true }),
}));
vi.mock("@/lib/db", () => ({ dbForRequest: async () => ({}) }));

const dbMocks = vi.hoisted(() => ({
  updateCalendarSettings: vi.fn(), setBookingStatus: vi.fn(), serviceDb: vi.fn(() => ({})),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks,
}));

import { updateCalendarSettingsAction, setBookingStatusAction } from "./actions";
import { BookingNotStartedError } from "@bis/db";
import { m } from "@/lib/messages";
import { DEFAULT_FOLLOWUP_BODY } from "@/lib/email/templates/followup";

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
  dbMocks.updateCalendarSettings.mockReset();
  dbMocks.updateCalendarSettings.mockResolvedValue(undefined);
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
