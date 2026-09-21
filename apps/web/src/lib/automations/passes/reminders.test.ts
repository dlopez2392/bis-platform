import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueReminder, AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueReminders: vi.fn(), stampReminderSent: vi.fn(), getDueReminderById: vi.fn(), recordAutomationLog: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import type { PassContext } from "../context";
import { remindersPass, releaseReminder } from "./reminders";

const NIGHT = new Date("2026-09-22T04:00:00Z");   // 23:00 CDT, Sept 21
const NOON = new Date("2026-09-21T17:00:00Z");    // 12:00 CDT
const END = "2026-09-22T13:00:00.000Z";           // 08:00 CDT, Sept 22
const ON = { enabled: true, start: "21:00", end: "08:00" };

function row(overrides: Partial<DueReminder> = {}): DueReminder {
  return {
    bookingId: "bk_1", accountId: "acct_1", contactId: "ct_1",
    startsAt: "2026-09-22T20:00:00.000Z",    // 15:00 CDT tomorrow — a day ahead, the email reminder's normal distance
    bookerTimezone: null, cancelToken: "tok_1", calendarPublicId: "cal_pub",
    contactEmail: "maria@example.com", contactName: "Maria Garcia",
    accountTimezone: "America/Chicago",
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
    fromEmail: null, meetingUrl: null,
    ...overrides,
  };
}
const held = (subjectKey = "booking:bk_1"): AutomationLogRow => ({
  id: "log_1", account_id: "acct_1", source: "reminders", channel: "email", contact_id: "ct_1",
  subject_key: subjectKey, status: "held", reason: "Held until 8:00 AM — quiet hours", held_until: END, payload: {}, occurred_at: NIGHT.toISOString(),
});

const emailSend = vi.fn();
function ctx(now: Date, quiet = ON): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => { throw new Error("the email reminder never texts"); },
    quiet: async () => quiet,
  };
}
const logCalls = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1]);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueReminders.mockResolvedValue([]);
  dbMocks.stampReminderSent.mockResolvedValue(undefined);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the email reminder under quiet hours", () => {
  it("inside the window: NOT sent, NOT stamped, one held row with the window's end (mutation: send before holdOrSend → FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row()]);
    expect(await remindersPass.run(ctx(NIGHT))).toEqual({ sent: 0, failed: 0, unstamped: 0, held: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReminderSent).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({
      source: "reminders", channel: "email", subjectKey: "booking:bk_1", contactId: "ct_1",
      status: "held", heldUntil: END, reason: "Held until 8:00 AM — quiet hours",
    })]);
  });

  it("outside the window: sent, stamped, one sent row — exactly as before, plus the row", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row()]);
    expect(await remindersPass.run(ctx(NOON))).toEqual({ sent: 1, failed: 0, unstamped: 0, held: 0 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_1");
    expect(logCalls()).toEqual([expect.objectContaining({ status: "sent", subjectKey: "booking:bk_1" })]);
  });

  it("the exemption: an appointment at 07:30 tomorrow sends at 23:00 tonight (mutation: drop `deadline` from the subject → FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row({ startsAt: "2026-09-22T12:30:00.000Z" })]);
    expect(await remindersPass.run(ctx(NIGHT))).toEqual({ sent: 1, failed: 0, unstamped: 0, held: 0 });
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("no email on file: a skipped row with the plain reason, still counted failed as the route always counted it", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row({ contactEmail: null })]);
    expect(await remindersPass.run(ctx(NOON))).toEqual({ sent: 0, failed: 1, unstamped: 0, held: 0 });
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "No email address on file" })]);
    expect(emailSend).not.toHaveBeenCalled();
  });
});

describe("releaseReminder — the held row is the queue", () => {
  it("a booking no longer due is skipped with 'No longer due'; a suppressed/off account with 'This automation was turned off'", async () => {
    dbMocks.getDueReminderById.mockResolvedValueOnce({ due: null, why: "gone" }).mockResolvedValueOnce({ due: null, why: "off" });
    expect(await releaseReminder(ctx(NOON), held())).toBe("skipped");
    expect(await releaseReminder(ctx(NOON), held())).toBe("skipped");
    expect(logCalls().map((w) => w.reason)).toEqual(["No longer due", "This automation was turned off"]);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("an appointment that already started is skipped with 'Appointment already started' (mutation: drop the check → FAILS: it sends)", async () => {
    dbMocks.getDueReminderById.mockResolvedValue({ due: row({ startsAt: "2026-09-21T16:00:00.000Z" }) });
    expect(await releaseReminder(ctx(NOON), held())).toBe("skipped");
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", reason: "Appointment already started" })]);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("a booking still due sends through the SAME path: email, stamp, and the row flips to sent (mutation: release without stamping → FAILS)", async () => {
    dbMocks.getDueReminderById.mockResolvedValue({ due: row() });
    expect(await releaseReminder(ctx(NOON), held())).toBe("sent");
    expect(dbMocks.getDueReminderById).toHaveBeenCalledWith(expect.anything(), "bk_1");
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_1");
    expect(logCalls()).toEqual([expect.objectContaining({ status: "sent", subjectKey: "booking:bk_1" })]);
  });

  it("released while STILL inside the window (the agency lengthened it): re-held, not sent", async () => {
    dbMocks.getDueReminderById.mockResolvedValue({ due: row() });
    expect(await releaseReminder(ctx(NIGHT), held())).toBe("held");
    expect(emailSend).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({ status: "held" })]);
  });

  it("a held row's subject_key is not trusted across accounts: acct_2's held row whose lookup returns acct_1's booking is skipped, never sent (mutation: delete the check → FAILS)", async () => {
    dbMocks.getDueReminderById.mockResolvedValue({ due: row() });   // row()'s accountId is "acct_1"
    const otherAccountHeld = { ...held(), account_id: "acct_2" };
    expect(await releaseReminder(ctx(NOON), otherAccountHeld)).toBe("skipped");
    expect(emailSend).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({ accountId: "acct_2", status: "skipped", reason: "No longer due" })]);
  });
});
