import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DueReviewRequest, AutomationLogRow, QuietSettings } from "@bis/db";

const dbMocks = vi.hoisted(() => ({
  listDueReviewRequests: vi.fn(), stampReviewRequested: vi.fn(), countReviewRequestsSince: vi.fn(),
  stampReviewRequestSmsFailed: vi.fn(), getDueReviewRequestById: vi.fn(), recordAutomationLog: vi.fn(),
  getAutomationLogEntry: vi.fn(),
  ensureConversation: vi.fn(), createMessage: vi.fn(), updateMessageStatus: vi.fn(),
  listDueReminders: vi.fn(), stampReminderSent: vi.fn(),
}));
// importOriginal keeps REVIEW_REQUEST_MAX_AGE_MS and the types real.
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));
const senderMock = vi.hoisted(() => ({ resolveSmsSender: vi.fn() }));
vi.mock("@/lib/sms/sender", () => ({ resolveSmsSender: (...a: unknown[]) => senderMock.resolveSmsSender(...a) }));

import { STAMP_RETRY_DELAYS_MS } from "@/lib/booking/stamp-retry";
import { AUTOMATION_TICK_CAP, AUTOMATION_DAILY_CAP } from "../caps";
import type { PassContext } from "../context";
import { reviewRequestPass, releaseReviewRequest } from "./review-request";
import { remindersPass } from "./reminders";

const STAMP_ATTEMPTS = STAMP_RETRY_DELAYS_MS.length + 1;
const TICK = new Date("2026-09-09T14:00:00Z");   // NY 10:00 Wed · CHI 09:00 Wed
const URL = "https://g.page/r/x/review";

/** Distinctive, complete fixture: every field the pass reads gets a value a
 *  passing test could not fake by coincidence. NO accountName — the type
 *  does not have one. */
function row(overrides: Partial<DueReviewRequest> = {}): DueReviewRequest {
  return {
    bookingId: "bk_r1", accountId: "acct_1",
    endsAt: "2026-09-08T22:00:00.000Z",           // NY Tue 18:00 — the previous local day
    followupSentAt: null, completedAt: null, smsFailedAt: null,
    contactId: "ct_1", contactEmail: "booker@example.com", contactPhone: "(956) 555-0101",
    brandName: "Rio Roofing",
    branding: {
      brandName: "Rio Roofing", brandLogoPath: null, brandColor: null, brandNeutral: null,
      brandCorners: null, brandType: null, brandMode: null,
      replyToEmail: "wrong-should-not-be-used@rioroofing.com",
    },
    accountTimezone: "America/New_York",
    fromEmail: "hello@rioroofing.com", replyToEmail: "owner@rioroofing.com",
    body: "", config: { channel: "email", reviewUrl: URL },
    ...overrides,
  };
}

const emailSend = vi.fn();
const smsSend = vi.fn();
const QUIET_OFF: QuietSettings = { enabled: false, start: "21:00", end: "08:00" };
function ctx(now: Date = TICK, quiet: QuietSettings = QUIET_OFF): PassContext {
  return {
    db: {} as never, now, origin: "https://app.example.com",
    email: { isFake: true, send: (...a: unknown[]) => emailSend(...a) },
    sms: () => ({ isFake: true, send: (...a: unknown[]) => smsSend(...a) }),
    quiet: async () => quiet,
  };
}
const EMPTY = {
  sent: 0, failed: 0, unstamped: 0, held: 0, skippedInvalidConfig: 0, skippedNoAddress: 0,
  skippedSmsGate: 0, skippedRecentFailure: 0, skippedCap: 0, waitingForMorning: 0, unresolvableTimezone: 0,
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  dbMocks.listDueReviewRequests.mockResolvedValue([]);
  dbMocks.stampReviewRequested.mockResolvedValue(undefined);
  dbMocks.countReviewRequestsSince.mockResolvedValue(0);
  dbMocks.stampReviewRequestSmsFailed.mockResolvedValue(undefined);
  dbMocks.recordAutomationLog.mockResolvedValue(undefined);
  // Task 3: the held path reads the existing row before re-holding.
  dbMocks.getAutomationLogEntry.mockResolvedValue(null);
  dbMocks.ensureConversation.mockResolvedValue({ id: "convo_1", created: false });
  dbMocks.createMessage.mockResolvedValue({ id: "msg_1" });
  dbMocks.updateMessageStatus.mockResolvedValue(undefined);
  dbMocks.listDueReminders.mockResolvedValue([]);
  dbMocks.stampReminderSent.mockResolvedValue(undefined);
  senderMock.resolveSmsSender.mockReset().mockResolvedValue({ ok: true, from: "+19565550000" });
  emailSend.mockReset().mockResolvedValue({ providerMessageId: "e1" });
  smsSend.mockReset().mockResolvedValue({ providerMessageId: "s1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("review-request pass — email channel", () => {
  it("sends with the brand name and the company's from/reply-to, appends the link, then stamps", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    const c = await reviewRequestPass.run(ctx());
    expect(c).toEqual({ ...EMPTY, sent: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
    const sent = emailSend.mock.calls[0]![0] as Record<string, string>;
    expect(sent.to).toBe("booker@example.com");
    expect(sent.fromName).toBe("Rio Roofing");
    expect(sent.fromAddress).toBe("hello@rioroofing.com");
    expect(sent.replyTo).toBe("owner@rioroofing.com");          // top-level, not branding.replyToEmail
    expect(sent.subject).toBe("Would you leave Rio Roofing a review?");
    expect(sent.body).toContain("Thanks for choosing Rio Roofing!"); // the default body
    expect(sent.body).toContain(URL);
    expect(sent.html).toContain(`href="${URL}"`);
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(dbMocks.createMessage).not.toHaveBeenCalled();         // email writes no messages row (follow-up precedent)
  });

  it("uses the operator's own body when one is stored", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ body: "It was a pleasure!" })]);
    await reviewRequestPass.run(ctx());
    expect((emailSend.mock.calls[0]![0] as { body: string }).body).toMatch(/^It was a pleasure!/);
  });

  it("send-then-stamp: a send that throws is counted failed and NOT stamped", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    emailSend.mockRejectedValueOnce(new Error("provider down"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("retries a transient stamp failure; gives up after the budget and counts unstamped while still sent", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    dbMocks.stampReviewRequested.mockRejectedValueOnce(new Error("reset")).mockResolvedValueOnce(undefined);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(2);
    expect(emailSend).toHaveBeenCalledTimes(1);                  // the retry never re-sends

    dbMocks.stampReviewRequested.mockReset().mockRejectedValue(new Error("db unavailable"));
    emailSend.mockClear();
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, unstamped: 1 });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(STAMP_ATTEMPTS);
  });
});

describe("review-request pass — SMS channel, the sendSmsAction discipline", () => {
  const sms = () => row({ config: { channel: "sms", reviewUrl: URL } });

  it("gate → write the message row → send → STAMP → mark sent, with the composed body everywhere", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    // Composed by the pass, then the opt-out disclosure from
    // sendAutomationSms — the same string stored and sent.
    const composed = `Thanks for choosing Rio Roofing! If you have a minute, we'd love a quick review: ${URL} Reply STOP to opt out.`;
    expect(senderMock.resolveSmsSender).toHaveBeenCalledWith(expect.anything(), "acct_1");
    expect(dbMocks.ensureConversation).toHaveBeenCalledWith(expect.anything(), "acct_1", "ct_1", "automation", "system");
    expect(dbMocks.createMessage).toHaveBeenCalledWith(expect.anything(), "acct_1",
      { conversationId: "convo_1", channel: "sms", direction: "outbound", body: composed }, "automation", "system");
    expect(smsSend).toHaveBeenCalledWith({ to: "+19565550101", from: "+19565550000", body: composed });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "sent",
      { providerMessageId: "s1" }, "automation", "system");
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("when the sender gate refuses, skips and counts it — and does NOT fall back to email", async () => {
    // Mutation: add `else await sendEmail(...)` on the gate's refusal branch.
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedSmsGate: 1 });
    expect(emailSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("a no_live_number refusal is the same skip, not an email", async () => {
    senderMock.resolveSmsSender.mockResolvedValue({ ok: false, reason: "no_live_number" });
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedSmsGate: 1 });
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("a gate READ error fails that row and keeps the pass's counters, instead of erroring the whole pass", async () => {
    senderMock.resolveSmsSender.mockRejectedValue(new Error("phone_numbers read failed"));
    dbMocks.listDueReviewRequests.mockResolvedValue([row(), sms()]);   // email row first, then the sms row
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, failed: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
  });

  it("constructs the SMS provider BEFORE writing the message row, so a throwing factory leaves no failed text in the inbox", async () => {
    // Review finding: ctx.sms() is lazy and throws in production when
    // TELNYX_API_KEY is unset. Mutation: move `ctx.sms()` back below createMessage.
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    const c: PassContext = { ...ctx(), sms: () => { throw new Error("TELNYX_API_KEY is required in production"); } };
    expect(await reviewRequestPass.run(c)).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.ensureConversation).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("consults the gate ONCE per account per tick", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms(), { ...sms(), bookingId: "bk_r2", contactId: "ct_2" }]);
    await reviewRequestPass.run(ctx());
    expect(senderMock.resolveSmsSender).toHaveBeenCalledTimes(1);
  });

  it("a phone that cannot be normalised is no deliverable address: skipped, gate not even consulted", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([{ ...sms(), contactPhone: "12" }]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
    expect(senderMock.resolveSmsSender).not.toHaveBeenCalled();
  });

  it("a provider send failure marks the message row failed, counts failed, stamps nothing", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.updateMessageStatus).toHaveBeenCalledWith(expect.anything(), "acct_1", "msg_1", "failed",
      { error: "carrier timeout" }, "automation", "system");
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
  });

  it("stamps BEFORE marking the row sent, and a failing status update cannot un-stamp or un-send", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    dbMocks.updateMessageStatus.mockRejectedValue(new Error("status write failed"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(1);
  });
});

describe("review-request pass — fail closed, each case its own counter", () => {
  it("an invalid stored config sends nothing and is counted", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ config: null })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedInvalidConfig: 1 });
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("no email on the contact for the email channel is skippedNoAddress", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ contactEmail: null })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedNoAddress: 1 });
  });

  it("an unresolvable account timezone is held and counted under its own name", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ accountTimezone: "Mars/Olympus" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, unresolvableTimezone: 1 });
  });

  it("THE COLLISION through the pass: a follow-up stamped today (NY) holds, the same stamp yesterday (CHI) sends", async () => {
    const stamped = "2026-09-09T04:30:00.000Z";   // NY Wed 00:30 · CHI Tue 23:30
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ followupSentAt: stamped, accountTimezone: "America/New_York" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, waitingForMorning: 1 });
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ followupSentAt: stamped, accountTimezone: "America/Chicago" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    // Neither call above was a release — "no longer due" is a release-path
    // write only; a normal tick that holds stays silent.
    expect(dbMocks.recordAutomationLog.mock.calls.filter((c) => c[1].status === "skipped")).toEqual([]);
  });
});

describe("caps — recipe passes only", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row({ bookingId: `bk_${i}`, contactId: `ct_${i}` }));

  it("per tick: N+1 eligible rows send N and skip one, which is NOT stamped", async () => {
    // Mutation: AUTOMATION_TICK_CAP = Infinity.
    dbMocks.listDueReviewRequests.mockResolvedValue(many(AUTOMATION_TICK_CAP + 1));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: AUTOMATION_TICK_CAP, skippedCap: 1 });
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledTimes(AUTOMATION_TICK_CAP);
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalledWith(expect.anything(), `bk_${AUTOMATION_TICK_CAP}`);
    // The TICK cap is a per-tick queue, not a refusal — logging it would be
    // noise on every busy tick a client ever has.
    expect(dbMocks.recordAutomationLog.mock.calls.filter((c) => c[1].status === "skipped")).toEqual([]);
  });

  it("per account per day: 24 already sent in the last 24h leaves room for exactly one", async () => {
    // Mutation: AUTOMATION_DAILY_CAP = Infinity.
    dbMocks.countReviewRequestsSince.mockResolvedValue(AUTOMATION_DAILY_CAP - 1);
    dbMocks.listDueReviewRequests.mockResolvedValue(many(3));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, skippedCap: 2 });
    expect(dbMocks.countReviewRequestsSince).toHaveBeenCalledTimes(1);   // once per account per tick
    expect(dbMocks.countReviewRequestsSince).toHaveBeenCalledWith(expect.anything(), "acct_1",
      new Date(TICK.getTime() - 24 * 60 * 60 * 1000).toISOString());
  });

  it("rows that are merely waiting for their morning do not count against the caps", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([
      ...many(2).map((r) => ({ ...r, followupSentAt: "2026-09-09T04:30:00.000Z" })),  // held in NY
      row({ bookingId: "bk_go", contactId: "ct_go" }),
    ]);
    dbMocks.countReviewRequestsSince.mockResolvedValue(AUTOMATION_DAILY_CAP - 1);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1, waitingForMorning: 2 });
  });

  it("the migrated reminder pass is NOT capped: 30 due reminders send 30", async () => {
    // Mutation: apply AUTOMATION_TICK_CAP inside passes/reminders.ts.
    dbMocks.listDueReminders.mockResolvedValue(Array.from({ length: 30 }, (_, i) => ({
      bookingId: `bk_rem_${i}`, accountId: "acct_1", startsAt: "2026-09-10T14:00:00.000Z",
      bookerTimezone: null, cancelToken: "tok", calendarPublicId: "cal",
      contactEmail: `b${i}@example.com`, contactName: "B",
      accountTimezone: "America/New_York",
      branding: { brandName: "Acme", brandLogoPath: null, brandColor: null, brandNeutral: null,
        brandCorners: null, brandType: null, brandMode: null, replyToEmail: null },
      fromEmail: null, meetingUrl: null,
    })));
    expect(await remindersPass.run(ctx())).toEqual({ sent: 30, failed: 0, unstamped: 0, held: 0 });
  });
});

describe("review-request pass — one SMS attempt per booking per day", () => {
  const sms = (overrides: Partial<DueReviewRequest> = {}) =>
    row({ config: { channel: "sms", reviewUrl: URL }, ...overrides });

  it("a provider failure writes the recipe's attempt marker, after the row is marked failed; nothing is stamped", async () => {
    // Mutation: drop `onProviderFailure` from the sendAutomationSms call.
    dbMocks.listDueReviewRequests.mockResolvedValue([sms()]);
    smsSend.mockRejectedValueOnce(new Error("carrier timeout"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.stampReviewRequestSmsFailed).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
    expect(dbMocks.updateMessageStatus.mock.invocationCallOrder[0]!)
      .toBeLessThan(dbMocks.stampReviewRequestSmsFailed.mock.invocationCallOrder[0]!);
  });

  it("a marker younger than 24h holds the booking: counted, nothing written, nothing sent", async () => {
    // Mutation: remove the smsCooldownActive check from the SMS branch.
    dbMocks.listDueReviewRequests.mockResolvedValue([sms({ smsFailedAt: new Date(TICK.getTime() - 60 * 60 * 1000).toISOString() })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, skippedRecentFailure: 1 });
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
    expect(dbMocks.countReviewRequestsSince).not.toHaveBeenCalled();     // a held row never reaches the caps
  });

  it("a marker exactly 24h old is due again", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([sms({ smsFailedAt: new Date(TICK.getTime() - 24 * 60 * 60 * 1000).toISOString() })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("the EMAIL channel ignores the marker — the decision is about texts", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ smsFailedAt: TICK.toISOString() })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
    expect(emailSend).toHaveBeenCalledTimes(1);
  });

  it("an email provider failure writes NO marker", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row()]);
    emailSend.mockRejectedValueOnce(new Error("provider down"));
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, failed: 1 });
    expect(dbMocks.stampReviewRequestSmsFailed).not.toHaveBeenCalled();
  });
});

describe("review-request pass — the completion clock (0026)", () => {
  it("the batch-Friday case: ended 9 days ago, completed yesterday afternoon → sent this morning", async () => {
    // Mutation: pass `new Date(row.endsAt)` to the gate instead of the anchor.
    dbMocks.listDueReviewRequests.mockResolvedValue([row({
      endsAt: "2026-08-31T22:00:00.000Z", completedAt: "2026-09-08T20:00:00.000Z",   // NY Mon 18:00 · Tue 16:00
    })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("one completion instant, two zones: stamped 00:30 today in New York holds, 23:30 yesterday in Chicago sends", async () => {
    const completed = "2026-09-09T04:30:00.000Z";
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ completedAt: completed, accountTimezone: "America/New_York" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, waitingForMorning: 1 });
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ completedAt: completed, accountTimezone: "America/Chicago" })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });

  it("a pre-0026 row (completedAt null) behaves exactly as before", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ completedAt: null })]);
    expect(await reviewRequestPass.run(ctx())).toEqual({ ...EMPTY, sent: 1 });
  });
});

describe("review request — quiet hours and release", () => {
  const UNTIL_NOON = { enabled: true, start: "21:00", end: "12:00" };
  // TICK is 10:00 America/New_York; a 21:00→12:00 window entered the
  // previous evening ends at 12:00 THAT SAME New York day — 2026-09-09
  // 16:00Z, not the followups.test.ts fixture's Sept-22/Chicago NOON.
  // Verified against quietWindowEnd(TICK, "America/New_York", UNTIL_NOON)
  // directly (see the task report).
  const NOON = new Date("2026-09-09T16:00:00Z");
  const heldRow = (channel: "sms" | "email"): AutomationLogRow => ({
    id: "log_r", account_id: "acct_1", source: "review_request", channel, contact_id: "ct_1",
    subject_key: "booking:bk_r1", status: "held", reason: "Held until 12:00 PM — quiet hours", held_until: NOON.toISOString(), payload: {}, occurred_at: TICK.toISOString(),
  });

  it("in the band, inside a window ending at noon: held, not sent, not stamped, no message row (mutation: bypass holdOrSend → FAILS)", async () => {
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ config: { channel: "sms", reviewUrl: URL } })]);   // the file's default row is EMAIL and its id is bk_r1; this test needs the SMS channel
    const result = await reviewRequestPass.run(ctx(TICK, UNTIL_NOON));
    expect(result.held).toBe(1);
    expect(result.sent).toBe(0);
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.createMessage).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      source: "review_request", channel: "sms", subjectKey: "booking:bk_r1", status: "held", heldUntil: NOON.toISOString(),
    }));
  });

  it("release at noon skips the band and sends through the same path — stamp included (mutation: gate on release → FAILS)", async () => {
    dbMocks.getDueReviewRequestById.mockResolvedValue({ due: row({ config: { channel: "sms", reviewUrl: URL } }) });
    expect(await releaseReviewRequest(ctx(NOON, UNTIL_NOON), heldRow("sms"))).toBe("sent");
    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(dbMocks.stampReviewRequested).toHaveBeenCalledWith(expect.anything(), "bk_r1");
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ status: "sent" }));
  });

  it("THE LADDER ON THE RELEASE PATH: the calendar follow-up went out THIS morning, so the release skips and says so (mutation: put the gate back inside `if (!opts.released)` → this reds with 'sent')", async () => {
    // RULE 4, the reason the release path re-applies the gate at all. The
    // follow-up pass runs first in the registry and stamps `followup_sent_at`;
    // its email and this request can both be held inside one quiet window and
    // come back on the same release tick. Day one "how did it go?", day two
    // "would you leave a review?" — never both the same morning.
    dbMocks.getDueReviewRequestById.mockResolvedValue({ due: row({
      config: { channel: "sms", reviewUrl: URL },
      followupSentAt: "2026-09-09T12:30:00.000Z",   // NY Wed 08:30, the same local day as NOON
    }) });
    expect(await releaseReviewRequest(ctx(NOON, UNTIL_NOON), heldRow("sms"))).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
    // ONE row, replacing the held one on the same (account, source, subject):
    // a released row left untouched keeps its past `held_until` and parks the
    // head of the queue for ever.
    expect(dbMocks.recordAutomationLog.mock.calls.map((c) => [c[1].subjectKey, c[1].status, c[1].reason]))
      .toEqual([["booking:bk_r1", "skipped", "No longer due"]]);
  });

  it("the daily cap and a missing address write skipped rows with plain reasons", async () => {
    dbMocks.countReviewRequestsSince.mockResolvedValue(AUTOMATION_DAILY_CAP);
    dbMocks.listDueReviewRequests.mockResolvedValue([row({ config: { channel: "sms", reviewUrl: URL } }), row({ bookingId: "bk_2", contactPhone: null, config: { channel: "sms", reviewUrl: URL } })]);
    await reviewRequestPass.run(ctx());
    // The loop hits bk_r1 (daily cap) before bk_2 (no phone), the reverse of
    // this list's literal order — sorted on both sides so the assertion
    // reads the SET of (subject, reason) pairs, not the loop's own order.
    expect(dbMocks.recordAutomationLog.mock.calls.map((c) => [c[1].subjectKey, c[1].reason]).sort()).toEqual([
      ["booking:bk_2", "No phone number we can text"],
      ["booking:bk_r1", "Daily limit reached"],
    ].sort());
  });

  it("release: a still-cooling-down SMS review request leaves the queue as a real skip rather than staying silently held (mutation: drop the guarded logSkipped call in the cooldown branch → FAILS)", async () => {
    dbMocks.getDueReviewRequestById.mockResolvedValue({
      due: row({ config: { channel: "sms", reviewUrl: URL }, smsFailedAt: new Date(TICK.getTime() - 60 * 60 * 1000).toISOString() }),
    });
    expect(await releaseReviewRequest(ctx(), heldRow("sms"))).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      subjectKey: "booking:bk_r1", status: "skipped", reason: "Waiting before trying this text again",
    }));
  });

  it("release: the recipe was turned off → 'This automation was turned off'", async () => {
    dbMocks.getDueReviewRequestById.mockResolvedValue({ due: null, why: "off" });
    expect(await releaseReviewRequest(ctx(), heldRow("email"))).toBe("skipped");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "This automation was turned off" }));
  });

  it("release: a held row's account is not trusted across tenants — a mismatch never sends (mutation: delete the check → FAILS)", async () => {
    dbMocks.getDueReviewRequestById.mockResolvedValue({ due: row({ config: { channel: "sms", reviewUrl: URL } }) });   // due.accountId is "acct_1"
    const crossTenant: AutomationLogRow = { ...heldRow("sms"), account_id: "acct_2" };
    expect(await releaseReviewRequest(ctx(), crossTenant)).toBe("skipped");
    expect(smsSend).not.toHaveBeenCalled();
    expect(dbMocks.stampReviewRequested).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({
      accountId: "acct_2", status: "skipped", reason: "No longer due",
    }));
  });
});
