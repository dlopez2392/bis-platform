import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ recordAutomationLog: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { holdOrSend, logSkipped, REASONS, subjectOf, verdict, type HoldSubject } from "./hold-or-send";

const NIGHT = new Date("2026-09-22T04:00:00Z");   // 23:00 CDT
const NOON = new Date("2026-09-21T17:00:00Z");    // 12:00 CDT
const ON = { enabled: true, start: "21:00", end: "08:00" };
const OFF = { ...ON, enabled: false };
const END = "2026-09-22T13:00:00.000Z";           // 08:00 CDT

function subject(overrides: Partial<HoldSubject> = {}): HoldSubject {
  return {
    accountId: "acct_1", accountTimezone: "America/Chicago", source: "sms_reminder", channel: "sms",
    subjectKey: "booking:bk_1", contactId: "ct_1", ...overrides,
  };
}
const ctx = (now: Date, settings = ON, db: unknown = {}) =>
  ({ db: db as never, now, quiet: vi.fn(async () => settings) });

beforeEach(() => {
  dbMocks.recordAutomationLog.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});

describe("holdOrSend", () => {
  it("outside the window: sends, then writes ONE sent row (mutation: skip the record → FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NOON), subject(), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), {
      accountId: "acct_1", source: "sms_reminder", channel: "sms", subjectKey: "booking:bk_1", contactId: "ct_1",
      status: "sent", reason: "",
    });
  });

  it("inside the window: does NOT send, writes a held row with held_until = the window's end and a client-readable reason (mutation: invert inQuietWindow → FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT), subject(), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      status: "held", heldUntil: END, reason: "Held until 8:00 AM — quiet hours",
    }));
  });

  it("the reminder exemption: a deadline at or before the window's end sends now; one after it holds (mutation: drop the deadline check → the first FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT), subject({ deadline: new Date("2026-09-22T12:30:00Z") }), send)).toBe("sent");   // 07:30 CDT job
    expect(await holdOrSend(ctx(NIGHT), subject({ deadline: new Date("2026-09-22T13:00:00Z") }), send)).toBe("sent");   // exactly 08:00
    expect(await holdOrSend(ctx(NIGHT), subject({ deadline: new Date("2026-09-22T13:00:01Z") }), send)).toBe("held");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("a send that throws writes a failed row with the plain reason and RETHROWS so the pass counts it", async () => {
    const send = vi.fn(async () => { throw new Error("carrier timeout"); });
    await expect(holdOrSend(ctx(NOON), subject(), send)).rejects.toThrow("carrier timeout");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "failed", reason: REASONS.failed }));
  });

  it("a log write that fails never fails the send: still sent, one console.error (mutation: let record throw → FAILS)", async () => {
    dbMocks.recordAutomationLog.mockRejectedValue(new Error("log down"));
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NOON), subject(), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(vi.mocked(console.error).mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining("automation log write failed")]);
  });

  it("quiet hours OFF: sends at night", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT, OFF), subject(), send)).toBe("sent");
  });

  it("an unresolvable account zone sends (never holds forever) and says so in the log line — settings are not even read", async () => {
    const send = vi.fn(async () => {});
    const c = ctx(NIGHT);
    expect(await holdOrSend(c, subject({ accountTimezone: "Mars/Olympus" }), send)).toBe("sent");
    expect(c.quiet).not.toHaveBeenCalled();
    expect(vi.mocked(console.error).mock.calls.map((cl) => String(cl[0]))).toEqual([expect.stringContaining("Mars/Olympus")]);
  });

  it("a settings read that rejects rejects the call: nothing sent, nothing written (the row is due again next tick)", async () => {
    const send = vi.fn(async () => {});
    const c = { db: {} as never, now: NIGHT, quiet: async () => { throw new Error("settings down"); } };
    await expect(holdOrSend(c, subject(), send)).rejects.toThrow("settings down");
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
  });

  it("settings are read for the SUBJECT's account (mutation: hardcode an account id → FAILS)", async () => {
    const c = ctx(NOON);
    await holdOrSend(c, subject({ accountId: "acct_2" }), async () => {});
    expect(c.quiet).toHaveBeenCalledWith("acct_2");
  });
});

describe("logSkipped, subjectOf, verdict", () => {
  it("logSkipped writes a skipped row and never throws", async () => {
    await logSkipped({ db: {} as never }, subject(), REASONS.noPhone);
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ status: "skipped", reason: "No phone number we can text" }));
    dbMocks.recordAutomationLog.mockRejectedValue(new Error("down"));
    await expect(logSkipped({ db: {} as never }, subject(), REASONS.noPhone)).resolves.toBeUndefined();
  });

  it("subjectOf maps a log row back to the subject the release re-writes, payload included", () => {
    expect(subjectOf({
      id: "l1", account_id: "acct_1", source: "instant_reply", channel: "sms", contact_id: "ct_9",
      subject_key: "submission:s1", status: "held", reason: "x", held_until: END, payload: { locale: "es" }, occurred_at: END,
    })).toEqual({ accountId: "acct_1", source: "instant_reply", channel: "sms", subjectKey: "submission:s1", contactId: "ct_9", payload: { locale: "es" } });
  });

  it("verdict reads a pass's counters: sent beats held beats failed beats skipped", () => {
    expect(verdict({ sent: 1, held: 0, failed: 0 })).toBe("sent");
    expect(verdict({ sent: 0, held: 1, failed: 0 })).toBe("held");
    expect(verdict({ sent: 0, held: 0, failed: 1 })).toBe("failed");
    expect(verdict({ sent: 0, held: 0, failed: 0 })).toBe("skipped");
  });
});
