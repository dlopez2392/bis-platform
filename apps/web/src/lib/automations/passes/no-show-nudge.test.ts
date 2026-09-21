import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueNoShowNudge, AutomationLogRow, QuietSettings } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueNoShowNudges: vi.fn(), stampNoShowNudged: vi.fn(), stampNoShowNudgeSmsFailed: vi.fn(),
  countNoShowNudgesSince: vi.fn(), getDueNoShowNudgeById: vi.fn(), recordAutomationLog: vi.fn(),
  getAutomationLogEntry: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
}));
// importOriginal keeps NO_SHOW_NUDGE_MAX_AGE_MS and the types real.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));

import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP } from "../caps";
import type { PassContext } from "../context";
import { noShowNudgePass, releaseNoShowNudge } from "./no-show-nudge";

const STAMP_ATTEMPTS = STAMP_RETRY_DELAYS_MS.length + 1;
const TICK = new Date("2026-09-09T14:00:00Z");   // NY 10:00 Wed · CHI 09:00 Wed
const ORIGIN = "https://app.example.com";
const URL = `${ORIGIN}/b/cal_pub_1`;

/** Distinctive, complete fixture. NO accountName — the type does not have one. */
function row(overrides: Partial<DueNoShowNudge> = {}): DueNoShowNudge {
  return {
    bookingId: "bk_n1", accountId: "acct_1",
    endsAt: "2026-09-08T20:00:00.000Z",           // NY Tue 16:00 — the previous local day
    noShowAt: "2026-09-08T20:30:00.000Z",         // NY Tue 16:30
    smsFailedAt: null,
    contactId: "ct_1", contactEmail: "booker@example.com", contactPhone: "(956) 555-0101",
    calendarPublicId: "cal_pub_1", calendarEnabled: true,
    brandName: "Rio Roofing",
    branding: {
      brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null,
      replyToEmail: "wrong-should-not-be-used@rioroofing.com",
    },
    accountTimezone: "America/New_York",
    fromEmail: "hello@rioroofing.com", replyToEmail: "owner@rioroofing.com",
    body: "", config: { channel: "email" },
    ...overrides,
  };
}
const sms = (overrides: Partial<DueNoShowNudge> = {}) => row({ config: { channel: "sms" }, ...overrides });

const emailSend = vi.fn();
const smsSend = vi.fn();
const QUIET_OFF: QuietSettings = { enabled: false, start: "21:00", end: "08:00" };
function ctx(now: Date = TICK, quiet: QuietSettings = QUIET_OFF): PassContext {
  return {
    db: {} as never, now, origin: ORIGIN,
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }),
    quiet: async () => quiet,
  };
}
const EMPTY = {
  sent: 0, failed: 0, unstamped: 0, held: 0, skippedInvalidConfig: 0, skippedNoAddress: 0,
  skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0, skippedCalendarOff: 0,
  waitingForMorning: 0, unresolvableTimezone: 0,
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueNoShowNudges.mockResolvedValue([]);
  dbMocks.stampNoShowNudged.mockResolvedValue(undefined);
  dbMocks.stampNoShowNudgeSmsFailed.mockResolvedValue(undefined);
  dbMocks.countNoShowNudgesSince.mockResolvedValue(0);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  // Task 3: the held path reads the existing row before re-holding.
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("no-show nudge pass — email channel", () => {
  it("sends with the brand name and the company's from/reply-to, the booking page as the link, then stamps", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row()]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    const sent = emailSend.mock.calls[0]![0] as Record<string, string>;
    expect(sent.to).toBe("booker@example.com");
    expect(sent.fromName).toBe("Rio Roofing");
    expect(sent.fromAddress).toBe("hello@rioroofing.com");
    expect(sent.replyTo).toBe("owner@rioroofing.com");
    expect(sent.subject).toBe("Want to pick a new time with Rio Roofing?");
    expect(sent.body).toContain("We missed you for your appointment with Rio Roofing.");
    expect(sent.body).toContain(URL);                          // Mutation: build the link off a hard-coded origin
    expect(sent.html).toContain(`href="${URL}"`);
    expect(dbMocks.stampNoShowNudged).toHaveBeenCalledWith(expect.anything(), "bk_n1");
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("uses the operator's own body when one is stored", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ body: "Sorry we missed each other!" })]);
    await noShowNudgePass.run(ctx());
    expect((emailSend.mock.calls[0]![0] as { body: string }).body).toMatch(/^Sorry we missed each other!/);
  });

  it("send-then-stamp: a send that throws is counted failed and NOT stamped", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row()]);
    emailSend.mockRejectedValueOnce(new Error("provider down"));
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalled();
    expect(dbMocks.stampNoShowNudgeSmsFailed).not.toHaveBeenCalled();   // email: no marker
  });

  it("retries a transient stamp failure; exhausted retries count unstamped while still sent", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row()]);
    dbMocks.stampNoShowNudged.mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(undefined);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampNoShowNudged).toHaveBeenCalledTimes(2);
    expect(emailSend).toHaveBeenCalledTimes(1);

    dbMocks.stampNoShowNudged.mockReset().mockRejectedValue(new Error("db unavailable"));
    emailSend.mockClear();
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1, unstamped: 1 });
    expect(dbMocks.stampNoShowNudged).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
  });
});

describe("no-show nudge pass — SMS channel", () => {
  it("gate → message row → send → STAMP → mark sent, with the composed body (link on the end) everywhere", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms()]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    // The pass composes the body; sendAutomationSms appends the opt-out
    // disclosure at the one choke point every scheduled text goes through.
    // Both halves are asserted here so a change to either is visible.
    const composed = `We missed you for your appointment with Rio Roofing. If you'd like to pick a new time, book here: ${URL} Reply STOP to opt out.`;
    expect(senderMock.resolveSmsSender).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: composed }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: composed });
    expect(dbMocks.stampNoShowNudged).toHaveBeenCalledWith(expect.anything(), "bk_n1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    expect(dbMocks.stampNoShowNudged.mock.invocationCallOrder[0]!)
      .toBeLessThan(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!);   // stamp BEFORE mark-sent
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("when the sender gate refuses, skips and counts it — and does NOT fall back to email", async () => {
    // Mutation: send the email on the refusal branch.
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms()]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedSmsGate: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("a gate READ error fails that row and keeps the pass's counters", async () => {
    senderMock.resolveSmsSender.mockRejectedValue(new Error("phone_numbers read failed"));
    dbMocks.listDueNoShowNudges.mockResolvedValue([row(), sms()]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1, failed: 1 });
  });

  it("consults the gate ONCE per account per tick", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms(), sms({ bookingId: "bk_n2", contactId: "ct_2" })]);
    await noShowNudgePass.run(ctx());
    expect(senderMock.resolveSmsSender).toHaveBeenCalledTimes(1);
  });

  it("a phone that cannot be normalised is no deliverable address: skipped, gate not consulted", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms({ contactPhone: "12" })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
    expect(senderMock.resolveSmsSender).not.toHaveBeenCalled();
  });

  it("a provider failure marks the row failed, writes the nudge's attempt marker, counts failed, stamps nothing", async () => {
    // Mutation: drop `onProviderFailure`.
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms()]);
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier timeout" }, "automation", "system");
    expect(dbMocks.stampNoShowNudgeSmsFailed).toHaveBeenCalledWith(expect.anything(), "bk_n1");
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalled();
  });

  it("a marker younger than 24h holds the booking: counted, nothing written, caps untouched", async () => {
    // Mutation: remove the smsCooldownActive check.
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms({ smsFailedAt: new Date(TICK.getTime() - 60 * 60 * 1000).toISOString() })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedRecentFailure: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.countNoShowNudgesSince).not.toHaveBeenCalled();
  });

  it("the EMAIL channel ignores the marker", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ smsFailedAt: TICK.toISOString() })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });
});

describe("no-show nudge pass — fail closed, each case its own counter", () => {
  it("an invalid stored config sends nothing and is counted", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ config: null })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedInvalidConfig: 1 });
  });

  it("no email on the contact for the email channel is skippedNoAddress", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ contactEmail: null })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
  });

  it("an unresolvable account timezone is held and counted under its own name", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
  });

  it("a booking page that is switched off is skipped and counted — no dead link goes out — but only once its morning arrives", async () => {
    // Mutation: check calendarEnabled before the gate and the second case
    // reports skippedCalendarOff instead of waitingForMorning (96 log lines
    // a day for a row that was never going to send this tick).
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ calendarEnabled: false })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, skippedCalendarOff: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalled();
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ calendarEnabled: false, accountTimezone: "America/Los_Angeles" })]);   // LA 07:00: dawn
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, waitingForMorning: 1 });
  });

  it("THE CLOCK through the pass: marked 00:30 today in New York holds, the same instant 23:30 yesterday in Chicago sends", async () => {
    // Mutation: hand the gate `new Date(row.endsAt)` and both halves send.
    const marked = "2026-09-09T04:30:00.000Z";
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ noShowAt: marked, accountTimezone: "America/New_York" })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, waitingForMorning: 1 });
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ noShowAt: marked, accountTimezone: "America/Chicago" })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("a pre-0026 row (noShowAt null) runs from ends_at", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ noShowAt: null })]);
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });
});

describe("no-show nudge pass — capped, like every recipe pass that a bulk status change can burst", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row({ bookingId: `bk_${i}`, contactId: `ct_${i}` }));

  it("per tick: N+1 eligible rows send N and skip one, which is NOT stamped", async () => {
    // Mutation: AUTOMATION_TICK_CAP = Infinity.
    dbMocks.listDueNoShowNudges.mockResolvedValue(many(AUTOMATION_TICK_CAP + 1));
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: AUTOMATION_TICK_CAP, skippedCap: 1 });
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalledWith(expect.anything(), `bk_${AUTOMATION_TICK_CAP}`);
    // The TICK cap is a per-tick queue, not a refusal — logging it would be
    // noise on every busy tick a client ever has.
    expect(dbMocks.recordAutomationLog.mock.calls.filter((c) => c[1].status === "skipped")).toEqual([]);
  });

  it("per account per day: 24 already sent in the last 24h leaves room for exactly one, counted off no_show_nudged_at", async () => {
    // Mutation: AUTOMATION_DAILY_CAP = Infinity; or count off the review stamp.
    dbMocks.countNoShowNudgesSince.mockResolvedValue(AUTOMATION_DAILY_CAP - 1);
    dbMocks.listDueNoShowNudges.mockResolvedValue(many(3));
    expect(await noShowNudgePass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedCap: 2 });
    expect(dbMocks.countNoShowNudgesSince).toHaveBeenCalledTimes(1);
    expect(dbMocks.countNoShowNudgesSince).toHaveBeenCalledWith(expect.anything(), "acct_1",
      new Date(TICK.getTime() - 24 * 60 * 60 * 1000).toISOString());
  });
});

describe("no-show nudge — quiet hours and release", () => {
  const UNTIL_NOON = { enabled: true, start: "21:00", end: "12:00" };
  // TICK is 10:00 America/New_York (this file's default row's zone); a
  // 21:00→12:00 window entered the previous evening ends at 12:00 THAT SAME
  // New York day — 2026-09-09 16:00Z. Verified against
  // quietWindowEnd(TICK, "America/New_York", UNTIL_NOON) directly (see the
  // task report).
  const NOON = new Date("2026-09-09T16:00:00Z");
  const heldRow = (channel: "sms" | "email"): AutomationLogRow => ({
    id: "log_n", account_id: "acct_1", source: "no_show_nudge", channel, contact_id: "ct_1",
    subject_key: "booking:bk_n1", status: "held", reason: "Held until 12:00 PM — quiet hours", held_until: NOON.toISOString(), payload: {}, occurred_at: TICK.toISOString(),
  });

  it("in the band, inside a window ending at noon: held, not sent, not stamped, no message row (mutation: bypass holdOrSend → FAILS)", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms()]);   // the file's default row is EMAIL and its id is bk_n1; this test needs the SMS channel
    const result = await noShowNudgePass.run(ctx(TICK, UNTIL_NOON));
    expect(result.held).toBe(1);
    expect(result.sent).toBe(0);
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "no_show_nudge", channel: "sms", subjectKey: "booking:bk_n1", status: "held", heldUntil: NOON.toISOString(),
    }));
  });

  it("release at noon skips the band and sends through the same path — stamp included (mutation: gate on release → FAILS)", async () => {
    dbMocks.getDueNoShowNudgeById.mockResolvedValue({ due: sms() });
    expect(await releaseNoShowNudge(ctx(NOON, UNTIL_NOON), heldRow("sms"))).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampNoShowNudged).toHaveBeenCalledWith(expect.anything(), "bk_n1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: "sent" }));
  });

  it("the daily cap and a missing address write skipped rows with plain reasons", async () => {
    dbMocks.countNoShowNudgesSince.mockResolvedValue(AUTOMATION_DAILY_CAP);
    dbMocks.listDueNoShowNudges.mockResolvedValue([sms(), sms({ bookingId: "bk_2", contactId: "ct_2", contactPhone: null })]);
    await noShowNudgePass.run(ctx());
    // The loop hits bk_n1 (daily cap) before bk_2 (no phone), the reverse of
    // this list's literal order — sorted on both sides so the assertion
    // reads the SET of (subject, reason) pairs, not the loop's own order.
    expect(dbMocks.recordAutomationLog.mock.calls.map((c) => [c[1].subjectKey, c[1].reason]).sort()).toEqual([
      ["booking:bk_2", "No phone number we can text"],
      ["booking:bk_n1", "Daily limit reached"],
    ].sort());
  });

  it("release: the recipe was turned off → 'This automation was turned off'", async () => {
    dbMocks.getDueNoShowNudgeById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseNoShowNudge(ctx(), heldRow("email"))).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "This automation was turned off" }));
  });

  it("release: a held row's account is not trusted across tenants — a mismatch never sends (mutation: delete the check → FAILS)", async () => {
    dbMocks.getDueNoShowNudgeById.mockResolvedValue({ due: sms() });   // due.accountId is "acct_1"
    const crossTenant: AutomationLogRow = { ...heldRow("sms"), account_id: "acct_2" };
    expect(await releaseNoShowNudge(ctx(), crossTenant)).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampNoShowNudged).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      accountId: "acct_2", status: "skipped", reason: "No longer due",
    }));
  });

  it("the booking page switched off: a skipped row 'The booking page is switched off'", async () => {
    dbMocks.listDueNoShowNudges.mockResolvedValue([row({ calendarEnabled: false })]);
    await noShowNudgePass.run(ctx());
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "The booking page is switched off" }));
  });
});
