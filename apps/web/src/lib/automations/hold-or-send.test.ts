import { describe, it, expect, vi, beforeEach } from "vitest";

const dbMocks = vi.hoisted(() => ({ recordAutomationLog: vi.fn(), getAutomationLogEntry: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { holdOrSend, writeHeld, logSkipped, REASONS, subjectOf, verdict, type HoldSubject } from "./hold-or-send";
import { SmsBlocked, SmsDeferred, LEDGER_RETRY_MS, type AutomationBlockReason } from "./send-sms";
import { EmailNotSent } from "@/lib/consent/email-gate";

const NIGHT = new Date("2026-09-22T04:00:00Z");   // 23:00 CDT, Mon Sept 21
const NOON = new Date("2026-09-21T17:00:00Z");    // 12:00 CDT, Mon Sept 21
const END = "2026-09-22T13:00:00.000Z";           // 08:00 CDT, Tue Sept 22
// Sun Sept 20, 10:00 CDT: automated hours are open, marketing hours are not.
const SUNDAY_10 = new Date("2026-09-20T15:00:00Z");
const SUNDAY_NOON = "2026-09-20T17:00:00.000Z";

function subject(overrides: Partial<HoldSubject> = {}): HoldSubject {
  return {
    accountId: "acct_1", accountTimezone: "America/Chicago", source: "sms_reminder", channel: "sms",
    smsKind: "automation.sms_reminder", subjectKey: "booking:bk_1", contactId: "ct_1", ...overrides,
  };
}
const ctx = (now: Date) => ({ db: {} as never, now });
const logWrites = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1]);

beforeEach(() => {
  dbMocks.recordAutomationLog.mockReset().mockResolvedValue(undefined);
  dbMocks.getAutomationLogEntry.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});

describe("holdOrSend: the fixed hours", () => {
  it("inside the hours: sends, then writes ONE sent row (mutation: skip the record → FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NOON), subject(), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(logWrites()).toEqual([{
      accountId: "acct_1", source: "sms_reminder", channel: "sms", subjectKey: "booking:bk_1", contactId: "ct_1",
      status: "sent", reason: "",
    }]);
  });

  it("outside the hours: does NOT send; the held row carries the 08:00 opening and a client-readable reason (mutation: skip the hours check → sent, FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT), subject(), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({
      status: "held", heldUntil: END, reason: "Held until 8:00 AM — quiet hours",
    })]);
  });

  it("an SMS subject's hours are its KIND's: a marketing text waits for Sunday noon while an automated one goes (mutation: read the automated rule for every sms kind → FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(SUNDAY_10), subject({ source: "review_request", smsKind: "automation.review_request" }), send)).toBe("held");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "held", heldUntil: SUNDAY_NOON })]);
    expect(await holdOrSend(ctx(SUNDAY_10), subject(), send)).toBe("sent");
  });

  it("an EMAIL subject keeps the automated hours, whatever its recipe (choice 31) (mutation: send email at any hour → FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT), subject({ source: "reminders", channel: "email", smsKind: undefined }), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(await holdOrSend(ctx(SUNDAY_10), subject({ source: "reactivation", channel: "email", smsKind: undefined }), send)).toBe("sent");
  });

  it("an SMS subject with no kind is a programming error and throws, never guessing the weaker rule (mutation: default to automated → FAILS)", async () => {
    await expect(holdOrSend(ctx(NOON), subject({ smsKind: undefined }), vi.fn())).rejects.toThrow(/has no smsKind/);
  });

  it("choice 21: a deadline at or before the opening is NOT sent and NOT held; one after it is held (mutation: drop the deadline rule → the first is held, FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT), subject({ deadline: new Date(END) }), send)).toBe("skipped");
    expect(await holdOrSend(ctx(NIGHT), subject({ deadline: new Date("2026-09-22T13:30:00Z") }), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(logWrites().map((w) => [w.status, w.reason])).toEqual([
      ["skipped", "Not sent: quiet hours ran past the appointment"],
      ["held", "Held until 8:00 AM — quiet hours"],
    ]);
  });

  it("a deadline inside the open hours is irrelevant: it sends (mutation: expire on any deadline → FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NOON), subject({ deadline: new Date("2026-09-21T18:00:00Z") }), send)).toBe("sent");
  });

  it("an unresolvable account zone keeps America/Chicago's hours and says so in the log line — never 'no window' (mutation: fail open → sent, FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NIGHT), subject({ accountTimezone: "America/Nowhere" }), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({ status: "held", heldUntil: END })]);
    expect(String(vi.mocked(console.error).mock.calls[0]?.[0])).toMatch(/cannot be resolved/);
  });
});

describe("holdOrSend: what the send gate answers", () => {
  it("SmsDeferred from the send becomes the held row, at the gate's own opening (mutation: treat it as a failure → FAILS)", async () => {
    const until = new Date("2026-09-22T14:00:00Z");
    expect(await holdOrSend(ctx(NOON), subject(), async () => { throw new SmsDeferred(until); })).toBe("held");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "held", heldUntil: until.toISOString() })]);
  });

  it("SmsDeferred for an unreadable ledger is a held row with its own reason, not \"quiet hours\" (review R2-I4; mutation: always write the quiet-hours reason → FAILS)", async () => {
    const until = new Date(NOON.getTime() + 15 * 60_000);
    expect(await holdOrSend(ctx(NOON), subject(), async () => { throw new SmsDeferred(until, "ledger_unavailable"); })).toBe("held");
    expect(logWrites()).toEqual([expect.objectContaining({
      status: "held", heldUntil: until.toISOString(), reason: "Waiting a few minutes: couldn't check whether they can get texts",
    })]);
  });

  it.each<[AutomationBlockReason, string]>([
    ["stopped", "They stopped texts from this business"],
    ["held", "Texts to them are on hold"],
    ["unconfirmed_number", "Their number could be Mexican or US. Pick its country on their contact"],
    ["window_after_deadline", "Not sent: quiet hours ran past the appointment"],
    ["no_number", "No phone number we can text"],
    ["a2p_not_approved", "Texting isn't set up for this company yet"],
    ["no_live_number", "Texting isn't set up for this company yet"],
  ])("SmsBlocked(%s) is ONE skipped row reading %j, and no throw (mutation: rethrow it → FAILS)", async (reason, words) => {
    expect(await holdOrSend(ctx(NOON), subject(), async () => { throw new SmsBlocked(reason); })).toBe("skipped");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "skipped", reason: words })]);
  });

  it("any other throw writes a failed row with the plain reason and RETHROWS so the pass counts it", async () => {
    await expect(holdOrSend(ctx(NOON), subject(), async () => { throw new Error("carrier"); })).rejects.toThrow("carrier");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "failed", reason: REASONS.failed })]);
  });
});

describe("holdOrSend: the log legs", () => {
  it("a log write that fails never fails the send: still sent, one console.error (mutation: let record throw → FAILS)", async () => {
    dbMocks.recordAutomationLog.mockRejectedValue(new Error("log down"));
    expect(await holdOrSend(ctx(NOON), subject(), vi.fn(async () => {}))).toBe("sent");
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("a held write that fails REJECTS the call — nothing sent, the pass will count it (mutation: swallow it → FAILS)", async () => {
    dbMocks.recordAutomationLog.mockRejectedValue(new Error("log down"));
    const send = vi.fn(async () => {});
    await expect(holdOrSend(ctx(NIGHT), subject(), send)).rejects.toThrow("log down");
    expect(send).not.toHaveBeenCalled();
  });

  it("re-holding with an UNCHANGED held_until does not re-write the row, so `occurred_at` does not bump (mutation: drop the getAutomationLogEntry check → FAILS)", async () => {
    dbMocks.getAutomationLogEntry.mockResolvedValue({ status: "held", held_until: END });
    expect(await holdOrSend(ctx(NIGHT), subject(), vi.fn())).toBe("held");
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
    expect(dbMocks.getAutomationLogEntry).toHaveBeenCalledWith(expect.anything(), "acct_1", "sms_reminder", "booking:bk_1");
  });

  it("re-holding with a CHANGED held_until still writes", async () => {
    dbMocks.getAutomationLogEntry.mockResolvedValue({ status: "held", held_until: "2026-09-22T12:00:00.000Z" });
    expect(await holdOrSend(ctx(NIGHT), subject(), vi.fn())).toBe("held");
    expect(dbMocks.recordAutomationLog).toHaveBeenCalledTimes(1);
  });

  it("writeHeld, the text-back's way in, writes the same held row a pass does (mutation: drop its unchanged check → FAILS on the second call)", async () => {
    await writeHeld({ db: {} as never }, subject(), new Date(END), "America/Chicago");
    dbMocks.getAutomationLogEntry.mockResolvedValue({ status: "held", held_until: END });
    await writeHeld({ db: {} as never }, subject(), new Date(END), "America/Chicago");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "held", heldUntil: END, reason: "Held until 8:00 AM — quiet hours" })]);
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

  it("subjectOf preserves an `ai` channel rather than coercing it to sms (mutation: coerce → FAILS)", () => {
    expect(subjectOf({
      id: "l2", account_id: "acct_1", source: "voice", channel: "ai", contact_id: "ct_9",
      subject_key: "call:c1", status: "sent", reason: "", held_until: null, payload: {}, occurred_at: END,
    }).channel).toBe("ai");
  });

  it("verdict reads a pass's counters: sent beats held beats failed beats skipped (mutation: reverse the branch order → FAILS)", () => {
    expect(verdict({ sent: 1, held: 0, failed: 0 })).toBe("sent");
    expect(verdict({ sent: 0, held: 1, failed: 0 })).toBe("held");
    expect(verdict({ sent: 0, held: 0, failed: 1 })).toBe("failed");
    expect(verdict({ sent: 0, held: 0, failed: 0 })).toBe("skipped");
    expect(verdict({ sent: 1, held: 1, failed: 1 })).toBe("sent");
    expect(verdict({ sent: 0, held: 1, failed: 1 })).toBe("held");
  });
});

describe("holdOrSend: the EMAIL gate's answers (consent PR-3, plan G10)", () => {
  const email = () => ({ ...subject(), channel: "email" as const, smsKind: undefined });
  const logged = () => dbMocks.recordAutomationLog.mock.calls.map((c) => c[1] as { status: string; reason: string; heldUntil?: string });

  it("a gate deferral is the held row at the gate's own opening (mutation: treat EmailNotSent as a failure → FAILS)", async () => {
    const until = new Date(NOON.getTime() + 3_600_000);
    expect(await holdOrSend(ctx(NOON), email(), async () => { throw new EmailNotSent({ kind: "deferred", until, zone: "America/Chicago" }); })).toBe("held");
    expect(logged()).toEqual([expect.objectContaining({ status: "held", heldUntil: until.toISOString() })]);
  });

  it.each([
    ["ledger_unavailable", "Waiting a few minutes: couldn't check whether they can get emails"],
    ["unsubscribe_unavailable", "Waiting a few minutes: the unsubscribe link couldn't be added"],
  ] as const)("an outage (%s) is a %j re-hold for LEDGER_RETRY_MS, never a send or a skip (fails closed; mutation: log it skipped → the email never goes once the outage ends, FAILS)", async (reason, words) => {
    expect(await holdOrSend(ctx(NOON), email(), async () => { throw new EmailNotSent({ kind: "blocked", reason }); })).toBe("held");
    expect(logged()).toEqual([expect.objectContaining({
      status: "held", reason: words, heldUntil: new Date(NOON.getTime() + LEDGER_RETRY_MS).toISOString(),
    })]);
  });

  it.each([
    ["stopped", "They asked not to get these emails"],
    ["held", "They asked not to get these emails"],
    ["no_address", "No email address on file"],
    ["window_after_deadline", "Not sent: quiet hours ran past the appointment"],
    // D-016: a hard bounce or a complaint is a PROVIDER FACT about the
    // address, not something the customer asked for — reads differently on
    // the Activity page than "stopped"/"held" above (mutation: reuse
    // optedOutEmail's words → FAILS).
    ["suppressed", "This address bounced or was marked as spam"],
  ] as const)("a refusal (%s) is ONE skipped row reading %j, and no throw (mutation: rethrow it → FAILS)", async (reason, words) => {
    expect(await holdOrSend(ctx(NOON), email(), async () => { throw new EmailNotSent({ kind: "blocked", reason }); })).toBe("skipped");
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: words })]);
  });

  it("a provider failure is today's failure: a failed row and the throw (mutation: swallow it → the pass counts it sent, FAILS)", async () => {
    await expect(holdOrSend(ctx(NOON), email(), async () => {
      throw new EmailNotSent({ kind: "failed", stage: "provider", error: "rejected" });
    })).rejects.toThrow("rejected");
    expect(logged()).toEqual([expect.objectContaining({ status: "failed" })]);
  });
});
