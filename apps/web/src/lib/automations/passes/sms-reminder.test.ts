import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueSmsReminder } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueSmsReminders: vi.fn(), stampSmsReminderSent: vi.fn(), stampSmsReminderFailed: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
  getDueSmsReminderById: vi.fn(), recordAutomationLog: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));

import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";
import { formatWhen } from "@/lib/booking/time";
import { AUTOMATION_TICK_CAP } from "../caps";
import type { PassContext } from "../context";
import type { AutomationLogRow } from "@bis/db";
import { smsReminderPass, releaseSmsReminder } from "./sms-reminder";

const STAMP_ATTEMPTS = STAMP_RETRY_DELAYS_MS.length + 1;
const TICK = new Date("2026-09-09T14:00:00Z");
const STARTS = "2026-09-09T16:00:00.000Z";   // 2h after the tick; LA 9:00 AM PDT · NY 12:00 PM EDT

/** Distinctive, complete fixture. Booker in Los Angeles, account in New York:
 *  the two zones render DIFFERENT strings for the same instant, so a pass
 *  that used the wrong one cannot pass by coincidence. */
function row(overrides: Partial<DueSmsReminder> = {}): DueSmsReminder {
  return {
    bookingId: "bk_s1", accountId: "acct_1", startsAt: STARTS,
    bookerTimezone: "America/Los_Angeles", smsFailedAt: null,
    contactId: "ct_1", contactPhone: "(956) 555-0101",
    brandName: "Rio Roofing", accountTimezone: "America/New_York",
    body: "",
    ...overrides,
  };
}

const smsSend = vi.fn();
const emailSend = vi.fn();
const QUIET_OFF = { enabled: false, start: "21:00", end: "08:00" };
const QUIET_ON = { ...QUIET_OFF, enabled: true };
function ctx(now: Date = TICK, quiet = QUIET_OFF): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }),
    quiet: async () => quiet,
  };
}
const EMPTY = { sent: 0, failed: 0, unstamped: 0, held: 0, skippedNoAddress: 0, skippedSmsGate: 0 };

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueSmsReminders.mockResolvedValue([]);
  dbMocks.stampSmsReminderSent.mockResolvedValue(undefined);
  dbMocks.stampSmsReminderFailed.mockResolvedValue(undefined);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  emailSend.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("sms reminder pass — the send", () => {
  it("texts the time in the BOOKER's zone, the default closing line, then stamps, then marks the row sent", async () => {
    // Mutation: format in the account zone and the string changes.
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const when = formatWhen(new Date(STARTS), "America/Los_Angeles");
    // The closing line is the pass's; the disclosure is sendAutomationSms's.
    const composed = `Reminder: your appointment with Rio Roofing is ${when}. Reply to this text if you need to make a change. Reply STOP to opt out.`;
    expect(when).not.toBe(formatWhen(new Date(STARTS), "America/New_York"));   // guards the fixture
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: composed }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: composed });
    expect(dbMocks.stampSmsReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_s1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    expect(dbMocks.stampSmsReminderSent.mock.invocationCallOrder[0]!)
      .toBeLessThan(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!);
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("falls back to the ACCOUNT's zone when the booker's is missing or junk, never to UTC", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ bookerTimezone: null }), row({ bookingId: "bk_s2", bookerTimezone: "Mars/Olympus" })]);
    await smsReminderPass.run(ctx());
    const whenNy = formatWhen(new Date(STARTS), "America/New_York");
    for (const call of smsSend.mock.calls) expect((call[0] as { body: string }).body).toContain(whenNy);
  });

  it("uses the operator's own closing line when one is stored", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ body: "See you soon!" })]);
    await smsReminderPass.run(ctx());
    // Still anchored to the END of the operator's line — the disclosure is
    // the only thing allowed after it, and nothing is composed in between.
    expect((smsSend.mock.calls[0]![0] as { body: string }).body)
      .toMatch(/PDT\. See you soon! Reply STOP to opt out\.$/);
  });

  it("send-then-stamp: a provider failure marks the row failed, writes the attempt marker, counts failed, stamps nothing", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier timeout" }, "automation", "system");
    expect(dbMocks.stampSmsReminderFailed).toHaveBeenCalledWith(expect.anything(), "bk_s1");
    expect(dbMocks.stampSmsReminderSent).not.toHaveBeenCalled();
  });

  it("retries a transient stamp failure; exhausted retries count unstamped while still sent", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    dbMocks.stampSmsReminderSent.mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(undefined);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(smsSend).toHaveBeenCalledTimes(1);
    dbMocks.stampSmsReminderSent.mockReset().mockRejectedValue(new Error("db unavailable"));
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, unstamped: 1 });
    expect(dbMocks.stampSmsReminderSent).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
  });
});

describe("sms reminder pass — fail closed, each case its own counter", () => {
  it("a phone that cannot be normalised is skipped, gate not consulted", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ contactPhone: null }), row({ bookingId: "bk_s2", contactPhone: "12" })]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 2 });
    expect(senderMock.resolveSmsSender).not.toHaveBeenCalled();
  });

  it("when the sender gate refuses, skips and counts — there is no other channel to fall to", async () => {
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "no_live_number" });
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, skippedSmsGate: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a gate READ error fails that row and keeps the pass's counters; the gate is consulted once per account", async () => {
    senderMock.resolveSmsSender.mockRejectedValueOnce(new Error("phone_numbers read failed")).mockResolvedValue({ ok: true, from: "+19565550000" });
    dbMocks.listDueSmsReminders.mockResolvedValue([row(), row({ bookingId: "bk_s2" })]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, failed: 1, sent: 1 });
    dbMocks.listDueSmsReminders.mockResolvedValue([row(), row({ bookingId: "bk_s2" })]);
    senderMock.resolveSmsSender.mockClear();
    await smsReminderPass.run(ctx());
    expect(senderMock.resolveSmsSender).toHaveBeenCalledTimes(1);
  });

  it("a booking whose last text attempt failed minutes ago is RETRIED, not held — the 45-minute window bounds it to three attempts (danlo, 2026-09-07)", async () => {
    // Mutation: reinstate `smsCooldownActive(row.smsFailedAt, ctx.now)` as a
    // skip. The 24h hold belongs to the morning-band recipes, whose windows
    // are twelve ticks wide; here a hold outlives the window and means one
    // attempt ever, so one carrier blip cost the customer their reminder.
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ smsFailedAt: new Date(TICK.getTime() - 15 * 60 * 1000).toISOString() })]);
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.createMessage).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampSmsReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_s1");
  });

  it("constructs the SMS provider BEFORE writing the message row", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row()]);
    const c: PassContext = { ...ctx(), sms: () => { throw new Error("TELNYX_API_KEY is required in production"); } };
    expect(await smsReminderPass.run(c)).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });
});

describe("sms reminder pass — UNCAPPED, like the email reminder it pairs with", () => {
  it("30 due reminders send 30: a reminder is one-to-one with a booking the customer made", async () => {
    // Mutation: apply AUTOMATION_TICK_CAP inside passes/sms-reminder.ts.
    dbMocks.listDueSmsReminders.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) => row({ bookingId: `bk_${i}`, contactId: `ct_${i}` })));
    expect(30).toBeGreaterThan(AUTOMATION_TICK_CAP);   // guards the fixture
    expect(await smsReminderPass.run(ctx())).toEqual({ ...EMPTY, sent: 30 });
    expect(dbMocks.stampSmsReminderSent).toHaveBeenCalledTimes(30);
  });
});

describe("sms reminder pass — quiet hours", () => {
  // 06:30 CDT for an 08:30 CDT appointment: due (inside 90–135 min), inside the window, and the appointment is AFTER the window ends.
  const EARLY = new Date("2026-09-22T11:30:00Z");
  const APPT_0830 = "2026-09-22T13:30:00.000Z";
  const END = "2026-09-22T13:00:00.000Z";
  const heldRow = (): AutomationLogRow => ({
    id: "log_s", account_id: "acct_1", source: "sms_reminder", channel: "sms", contact_id: "ct_1",
    subject_key: "booking:bk_s1", status: "held", reason: "Held until 8:00 AM — quiet hours", held_until: END, payload: {}, occurred_at: EARLY.toISOString(),
  });

  it("inside the window with the appointment after its end: NOT sent, NO message row, NOT stamped, one held row (mutation: bypass holdOrSend → FAILS)", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ startsAt: APPT_0830, accountTimezone: "America/Chicago" })]);
    expect(await smsReminderPass.run(ctx(EARLY, QUIET_ON))).toEqual({ ...EMPTY, held: 1 });
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampSmsReminderSent).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "sms_reminder", channel: "sms", subjectKey: "booking:bk_s1", contactId: "ct_1", status: "held", heldUntil: END,
    }));
  });

  it("the exemption: 05:30 for a 07:30 job — before the window ends — sends now (mutation: drop `deadline` → FAILS)", async () => {
    const fiveThirty = new Date("2026-09-22T10:30:00Z");
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ startsAt: "2026-09-22T12:30:00.000Z", accountTimezone: "America/Chicago" })]);
    expect(await smsReminderPass.run(ctx(fiveThirty, QUIET_ON))).toEqual({ ...EMPTY, sent: 1 });
    expect(smsSend).toHaveBeenCalledTimes(1);
  });

  it("no textable phone / gate refused: a skipped row with the plain reason (mutation: drop either logSkipped → FAILS)", async () => {
    dbMocks.listDueSmsReminders.mockResolvedValue([row({ contactPhone: "" }), row({ bookingId: "bk_s2" })]);
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    await smsReminderPass.run(ctx());
    expect(dbMocks.recordAutomationLog.mock.calls.map((c) => [c[1].subjectKey, c[1].status, c[1].reason])).toEqual([
      ["booking:bk_s1", "skipped", "No phone number we can text"],
      ["booking:bk_s2", "skipped", "Texting isn't set up for this company yet"],
    ]);
  });

  it("release: an appointment that started during the hold is skipped, never texted (mutation: drop the check → FAILS)", async () => {
    dbMocks.getDueSmsReminderById.mockResolvedValue({ due: row({ startsAt: "2026-09-22T12:45:00.000Z" }) });   // 07:45, before an 08:00 release
    expect(await releaseSmsReminder(ctx(new Date("2026-09-22T13:00:00Z")), heldRow())).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "Appointment already started" }));
  });

  it("release: still due → texts through the same path and the row flips to sent", async () => {
    dbMocks.getDueSmsReminderById.mockResolvedValue({ due: row({ startsAt: APPT_0830 }) });
    expect(await releaseSmsReminder(ctx(new Date("2026-09-22T13:00:00Z")), heldRow())).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampSmsReminderSent).toHaveBeenCalledWith(expect.anything(), "bk_s1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: "sent" }));
  });

  it("release: the recipe was turned off meanwhile → 'This automation was turned off'", async () => {
    dbMocks.getDueSmsReminderById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseSmsReminder(ctx(), heldRow())).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "This automation was turned off" }));
  });
});
