import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueReminder, AutomationLogRow } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueReminders: vi.fn(), stampReminderSent: vi.fn(), getDueReminderById: vi.fn(), recordAutomationLog: vi.fn(), getAutomationLogEntry: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import type { PassContext } from "../context";
import { remindersPass, releaseReminder } from "./reminders";
import { EmailNotSent } from "@/lib/consent/email-gate";

const NIGHT = new Date("2026-09-22T04:00:00Z");   // 23:00 CDT, Sept 21
const NOON = new Date("2026-09-21T17:00:00Z");    // 12:00 CDT
const END = "2026-09-22T13:00:00.000Z";           // 08:00 CDT, Sept 22

function row(overrides: Partial<DueReminder> = {}): DueReminder {
  return {
    bookingId: "bk_1", accountId: "acct_1", contactId: "ct_1",
    startsAt: "2026-09-22T20:00:00.000Z",    // 15:00 CDT tomorrow — a day ahead, the email reminder's normal distance
    bookerTimezone: null, cancelToken: "tok_1", calendarPublicId: "cal_pub",
    contactEmail: "maria@example.com", contactName: "Maria Garcia",
    accountTimezone: "America/Chicago",
    branding: { brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null, brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
    fromEmail: null, meetingUrl: null, late: false,
    ...overrides,
  };
}
const held = (subjectKey = "booking:bk_1"): AutomationLogRow => ({
  id: "log_1", account_id: "acct_1", source: "reminders", channel: "email", contact_id: "ct_1",
  subject_key: subjectKey, status: "held", reason: "Held until 8:00 AM — quiet hours", held_until: END, payload: {}, occurred_at: NIGHT.toISOString(),
});

const emailSend = vi.fn();
function ctx(now: Date): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: async () => { throw new Error("the email reminder never texts"); },
  };
}
const logCalls = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1]);

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueReminders.mockResolvedValue([]);
  dbMocks.stampReminderSent.mockResolvedValue(undefined);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);   // Task 3: the held path reads the existing row before re-holding
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the email reminder under the fixed hours (08:00-21:00, choice 31)", () => {
  it("outside the hours: NOT sent, NOT stamped, one held row with the window's end (mutation: send before holdOrSend → FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row()]);
    expect(await remindersPass.run(ctx(NIGHT))).toEqual({ sent: 0, failed: 0, unstamped: 0, held: 1, blocked: 0 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReminderSent).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({
      source: "reminders", channel: "email", subjectKey: "booking:bk_1", contactId: "ct_1",
      status: "held", heldUntil: END, reason: "Held until 8:00 AM — quiet hours",
    })]);
  });

  it("inside the hours: sent, stamped, one sent row — exactly as before, plus the row", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row()]);
    expect(await remindersPass.run(ctx(NOON))).toEqual({ sent: 1, failed: 0, unstamped: 0, held: 0, blocked: 0 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_1");
    expect(logCalls()).toEqual([expect.objectContaining({ status: "sent", subjectKey: "booking:bk_1" })]);
  });

  it("choice 21: an appointment at 07:30 tomorrow is NOT emailed at 23:00 tonight, nor held past it; one skipped row says why (mutation: drop `deadline` from the subject → held, FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row({ startsAt: "2026-09-22T12:30:00.000Z" })]);
    expect(await remindersPass.run(ctx(NIGHT))).toEqual({ sent: 0, failed: 0, unstamped: 0, held: 0, blocked: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReminderSent).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({
      subjectKey: "booking:bk_1", status: "skipped", reason: "Not sent: quiet hours ran past the appointment",
    })]);
  });

  // D-029 review. A LATE reminder (booked less than a day ahead) for a 09:00
  // appointment comes due at 05:45, outside the hours. Held to 08:00 it would
  // land beside the text reminder, itself held from 06:45-07:30 to 08:00. Its
  // deadline is the start minus 2h15m (reminderDeadline), 06:45 here — before
  // the 08:00 opening — so it is dropped, not held.
  it("D-029 review: a LATE reminder whose window is before 08:00 is dropped, not held to land beside the text reminder (mutation: deadline = start → held, FAILS)", async () => {
    const at0545 = new Date("2026-09-22T10:45:00Z"); // 05:45 CDT
    dbMocks.listDueReminders.mockResolvedValue([row({ startsAt: "2026-09-22T14:00:00.000Z", late: true })]); // 09:00 CDT
    expect(await remindersPass.run(ctx(at0545))).toEqual({ sent: 0, failed: 0, unstamped: 0, held: 0, blocked: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(logCalls()).toEqual([expect.objectContaining({ status: "skipped", subjectKey: "booking:bk_1" })]);
  });

  it("D-029 review: a late reminder for 11:00 is still held to 08:00 (its 08:45 deadline is after the opening) — 45 minutes before the text", async () => {
    const at0645 = new Date("2026-09-22T11:45:00Z"); // 06:45 CDT
    dbMocks.listDueReminders.mockResolvedValue([row({ startsAt: "2026-09-22T16:00:00.000Z", late: true })]); // 11:00 CDT
    expect(await remindersPass.run(ctx(at0645))).toEqual({ sent: 0, failed: 0, unstamped: 0, held: 1, blocked: 0 });
    expect(logCalls()).toEqual([expect.objectContaining({ status: "held", heldUntil: END })]);
  });

  it("D-029 review: the SAME instant for a day-before (not late) reminder keeps the appointment as its deadline — held, as before", async () => {
    const at0545 = new Date("2026-09-22T10:45:00Z");
    dbMocks.listDueReminders.mockResolvedValue([row({ startsAt: "2026-09-22T14:00:00.000Z", late: false })]);
    expect(await remindersPass.run(ctx(at0545))).toEqual({ sent: 0, failed: 0, unstamped: 0, held: 1, blocked: 0 });
  });

  it("no email on file: a skipped row with the plain reason, still counted failed as the route always counted it", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row({ contactEmail: null })]);
    expect(await remindersPass.run(ctx(NOON))).toEqual({ sent: 0, failed: 1, unstamped: 0, held: 0, blocked: 0 });
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

  it("released while the fixed hours are still closed (23:00): re-held, not sent", async () => {
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

describe("consent PR-3: the email goes through the gate", () => {
  it("the email goes through the gate as automation.reminder, for this account and contact, at the tick's instant, with the appointment as its deadline (consent PR-3; mutation: kind \"automation.followup\" → FAILS; mutation: drop the deadline → FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row()]);
    await remindersPass.run(ctx(NOON));
    expect(emailSend).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "acct_1", kind: "automation.reminder", contactId: "ct_1", origin: "https://app.example.com",
      now: NOON, accountZone: "America/Chicago", deadline: new Date(row().startsAt),
    }));
  });

  it("an unsubscribed customer: the gate refuses, the row is skipped with the reason the client reads, nothing is stamped, and the tick's cap place is given back (decision 7, G13; mutation: count it sent → FAILS)", async () => {
    dbMocks.listDueReminders.mockResolvedValue([row()]);
    emailSend.mockRejectedValueOnce(new EmailNotSent({ kind: "blocked", reason: "stopped" }));
    expect(await remindersPass.run(ctx(NOON))).toEqual({ sent: 0, failed: 0, unstamped: 0, held: 0, blocked: 1 });
    expect(dbMocks.stampReminderSent).not.toHaveBeenCalled();
  });
});
