import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// readConsentState: review item 1's integration test runs the REAL gate
// (sendEmailOrThrow), not a mocked EmailNotSent, so the bug it caught (the
// gate itself answering "stopped" instead of "suppressed" for an automated
// kind) could not have been hidden by a test that already assumes the
// gate's classification.
const dbMocks = vi.hoisted(() => ({
  recordAutomationLog: vi.fn(), getAutomationLogEntry: vi.fn(), readConsentState: vi.fn(),
  // D-061: the REAL email gate's own account-level send switch, exercised
  // below against `{} as never`. Unmocked, it would throw. Allowed by default.
  isAccountOutboundSuppressed: vi.fn(async () => false),
  // M7a PR-4: the REAL email gate's pause read (switch on only), on the service client.
  readBillingStanding: vi.fn(async () => null), serviceDb: vi.fn(() => ({ service: true })),
}));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...dbMocks }));

import { holdOrSend, writeHeld, logSkipped, REASONS, BLOCK_REASONS, EMAIL_BLOCK_REASONS, subjectOf, verdict, type HoldSubject } from "./hold-or-send";
import { SmsBlocked, SmsDeferred, LEDGER_RETRY_MS, type AutomationBlockReason } from "./send-sms";
import { EmailNotSent, sendEmailOrThrow } from "@/lib/consent/email-gate";
import { CLOSURE_REASONS, type ClosureLoader, type ClosureState } from "./closures";
import { m } from "@/lib/messages";

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
  dbMocks.readConsentState.mockReset().mockResolvedValue({ state: "allowed" });
  dbMocks.isAccountOutboundSuppressed.mockReset().mockResolvedValue(false);
  dbMocks.readBillingStanding.mockReset().mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {}).mockClear();
});
afterEach(() => vi.unstubAllEnvs());

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

  it("F-196: the hours are judged at the SEND's instant (ctx.clock), never the tick's now: a tick at 20:55 whose text is reached at 21:03 is held (mutation: judge the hours at ctx.now → sent, FAILS)", async () => {
    // Under fan-out a pass starts up to ~8 minutes after the tick's now (a
    // pass route accepts a now up to 900 s old), so the tick's instant can be
    // inside the hours while the send itself is not.
    const send = vi.fn(async () => {});
    const tickNow = new Date("2026-09-22T01:55:00Z");   // 20:55 CDT, Mon Sept 21
    const sendAt = new Date("2026-09-22T02:03:00Z");    // 21:03 CDT
    expect(await holdOrSend({ db: {} as never, now: tickNow, clock: () => sendAt }, subject(), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({ status: "held", heldUntil: END })]);
  });

  it("F-196: and the reverse, so it is the clock that decides: a tick at 07:58 whose text is reached at 08:02 sends", async () => {
    const send = vi.fn(async () => {});
    const tickNow = new Date("2026-09-22T12:58:00Z");   // 07:58 CDT
    const sendAt = new Date("2026-09-22T13:02:00Z");    // 08:02 CDT
    expect(await holdOrSend({ db: {} as never, now: tickNow, clock: () => sendAt }, subject(), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
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

  // Review item 1: the table above only pins holdOrSend's OWN mapping —
  // it says nothing about what the GATE actually answers for a real
  // automated send, which is where the bug lived (the gate's ledger branch
  // returned "stopped" for a bounce/complaint row, so `suppressed` could
  // never be reached from here). This runs the REAL gate.
  it("an automated email kind blocked by a bounce/complaint ROW on the ledger logs the suppressed line end to end, never optedOutEmail (mutation: revert the gate's method check → FAILS)", async () => {
    dbMocks.readConsentState.mockResolvedValue({
      state: "stopped", since: "2026-10-03T00:00:00Z", method: "email_bounce", eventId: "e1",
    });
    const send = async () => {
      await sendEmailOrThrow({
        accountId: "acct_1", kind: "automation.reminder", contactId: "ct_1",
        to: "ana@example.com", fromName: "Rio Roofing", subject: "Reminder", body: "See you at 3",
      }, { db: {} as never });
    };
    expect(await holdOrSend(ctx(NOON), email(), send)).toBe("skipped");
    expect(logged()).toEqual([expect.objectContaining({ status: "skipped", reason: REASONS.suppressedEmail })]);
  });

  it("a provider failure is today's failure: a failed row and the throw (mutation: swallow it → the pass counts it sent, FAILS)", async () => {
    await expect(holdOrSend(ctx(NOON), email(), async () => {
      throw new EmailNotSent({ kind: "failed", stage: "provider", error: "rejected" });
    })).rejects.toThrow("rejected");
    expect(logged()).toEqual([expect.objectContaining({ status: "failed" })]);
  });
});

describe("closures (S-47d, spec 5.5.2)", () => {
  // A storm thrown Monday morning with no back-on date, for acct_A only; every other account reads open.
  const STORM_A: ClosureState = {
    ok: true,
    input: {
      row: { state: "storm", late_minutes: null, until: null, set_at: "2026-09-21T13:00:00.000Z" },
      closedDays: [], hours: null, timezone: "America/Chicago",
    },
    windows: [{ start: new Date("2026-09-21T13:00:00.000Z"), end: null }],
  };
  const OPEN: ClosureState = { ok: true, input: { row: null, closedDays: [], hours: null, timezone: "America/Chicago" }, windows: [] };
  const stormForA = () => vi.fn<ClosureLoader>(async (accountId) => (accountId === "acct_A" ? STORM_A : OPEN));
  const APPT = new Date("2026-09-22T20:00:00.000Z");   // 15:00 CDT Tue, inside the storm's open window
  const booking = (over: Partial<HoldSubject> = {}) => subject({ accountId: "acct_A", appointmentAt: APPT, deadline: APPT, ...over });
  const withLoader = (now: Date, closures: ClosureLoader) => ({ db: {} as never, now, closures });

  it("a covered appointment is held with the storm reason and held_until = its deadline; the send never runs", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(withLoader(NOON, stormForA()), booking(), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({
      accountId: "acct_A", status: "held", heldUntil: "2026-09-22T20:00:00.000Z", reason: "Held: closed for a storm",
    })]);
    expect(REASONS.heldStorm).toBe("Held: closed for a storm");
  });

  it("a covered appointment whose deadline has passed is skipped with the closed reason, never sent", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(withLoader(NOON, stormForA()), booking({ deadline: NOON }), send)).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({
      status: "skipped", reason: "Not sent: the business was closed for this appointment",
    })]);
    expect(REASONS.skippedClosed).toBe("Not sent: the business was closed for this appointment");
  });

  it("SD7: no loader on the context holds for LEDGER_RETRY_MS with the couldn't-check reason, never a send", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(NOON), booking(), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({
      status: "held", heldUntil: new Date(NOON.getTime() + LEDGER_RETRY_MS).toISOString(),
      reason: "Held: couldn't check whether the business is open",
    })]);
    expect(REASONS.heldClosureUnknown).toBe("Held: couldn't check whether the business is open");
  });

  it("a subject WITHOUT appointmentAt (instant reply, text-back, reactivation, quote follow-up, document request) never asks the loader, and the hours path runs as before", async () => {
    const loader = stormForA();
    const send = vi.fn(async () => {});
    expect(await holdOrSend(withLoader(NOON, loader), subject({ accountId: "acct_A" }), send)).toBe("sent");
    expect(loader).toHaveBeenCalledTimes(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await holdOrSend(withLoader(NIGHT, loader), subject({ accountId: "acct_A" }), send)).toBe("held");
    expect(loader).toHaveBeenCalledTimes(0);
    expect(logWrites()[1]).toEqual(expect.objectContaining({ status: "held", reason: "Held until 8:00 AM — quiet hours" }));
  });

  it("the closure check runs BEFORE the sending hours: inside quiet hours a covered appointment is held with the CLOSURE reason (mutation: check after the opening FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(withLoader(NIGHT, stormForA()), booking(), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({
      status: "held", heldUntil: "2026-09-22T20:00:00.000Z", reason: "Held: closed for a storm",
    })]);
  });

  it("the loader is asked for the SUBJECT's own account: B sends under A's storm, A is held (mutation: a fixed or another subject's id FAILS)", async () => {
    const loader = stormForA();
    const send = vi.fn(async () => {});
    expect(await holdOrSend(withLoader(NOON, loader), booking({ accountId: "acct_B" }), send)).toBe("sent");
    expect(loader.mock.calls).toEqual([["acct_B"]]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await holdOrSend(withLoader(NOON, loader), booking({ accountId: "acct_A" }), send)).toBe("held");
    expect(loader.mock.calls).toEqual([["acct_B"], ["acct_A"]]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a kept appointment sends under its own account's storm (mutation: ignore `kept` FAILS)", async () => {
    const send = vi.fn(async () => {});
    expect(await holdOrSend(withLoader(NOON, stormForA()), booking({ kept: true }), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(logWrites()).toEqual([expect.objectContaining({ status: "sent" })]);
  });

  it("D13a: the subject's skipIfWasClosed reaches the verdict: an ended closed day skips the follow-up and lets any other send go (mutation: drop the pass-through FAILS)", async () => {
    const yesterday = new Date("2026-09-20T17:00:00.000Z");     // Sun 12:00 CDT; NOON is Mon
    const endedDay = vi.fn<ClosureLoader>(async () => ({
      ok: true, input: { row: null, closedDays: [{ starts_on: "2026-09-20", ends_on: "2026-09-20", reason: null }], hours: null, timezone: "America/Chicago" },
      windows: [],
    }));
    const send = vi.fn(async () => {});
    const after = booking({ source: "followups", channel: "email", smsKind: undefined, appointmentAt: yesterday, deadline: undefined, skipIfWasClosed: true });
    expect(await holdOrSend(withLoader(NOON, endedDay), after, send)).toBe("skipped");
    expect(send).not.toHaveBeenCalled();
    expect(logWrites()).toEqual([expect.objectContaining({
      source: "followups", status: "skipped", reason: "Not sent: the business was closed for this appointment",
    })]);
    expect(await holdOrSend(withLoader(NOON, endedDay), booking({ appointmentAt: yesterday, deadline: undefined }), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("REASONS carries the five closure reasons written once in closures.ts (review M3)", () => {
    expect({
      heldClosedToday: REASONS.heldClosedToday, heldStorm: REASONS.heldStorm, heldClosedDay: REASONS.heldClosedDay,
      heldClosureUnknown: REASONS.heldClosureUnknown, skippedClosed: REASONS.skippedClosed,
    }).toEqual(CLOSURE_REASONS);
  });

  it("the five closure reasons are the catalogue's, each with its Spanish twin", () => {
    expect([REASONS.heldClosedToday, REASONS.heldStorm, REASONS.heldClosedDay, REASONS.heldClosureUnknown, REASONS.skippedClosed]).toEqual([
      "Held: the business is closed today",
      "Held: closed for a storm",
      "Held: the business is closed that day",
      "Held: couldn't check whether the business is open",
      "Not sent: the business was closed for this appointment",
    ]);
    const keys = ["heldClosedToday", "heldStorm", "heldClosedDay", "heldClosureUnknown", "skippedClosed"] as const;
    expect(keys.map((k) => m[`automations.reason.${k}.es`])).toEqual([
      "En espera: el negocio está cerrado hoy",
      "En espera: cerrado por tormenta",
      "En espera: el negocio está cerrado ese día",
      "En espera: no se pudo comprobar si el negocio está abierto",
      "No se envió: el negocio estaba cerrado para esta cita",
    ]);
  });
});

describe("holdOrSend: the non-payment pause HOLDS, never drops (owner answer I6, plan G7a)", () => {
  // 12:20 CDT Mon: inside every window, and off the hour, so the next whole UTC hour is 18:00Z.
  const AT = new Date("2026-09-21T17:20:00Z");
  const HOUR_ON = "2026-09-21T18:00:00.000Z";
  const email = () => ({ ...subject(), channel: "email" as const, smsKind: undefined });
  const pausedSms = async () => { throw new SmsBlocked("billing_paused"); };
  const pausedEmail = async () => { throw new EmailNotSent({ kind: "blocked", reason: "billing_paused" }); };

  it("SMS billing_paused → a held row until the next whole UTC hour with the held reason, never skipped (mutation: map it to BLOCK_REASONS → FAILS)", async () => {
    expect(await holdOrSend(ctx(AT), subject(), pausedSms)).toBe("held");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "held", heldUntil: HOUR_ON, reason: REASONS.heldBillingPaused })]);
    expect(REASONS.heldBillingPaused).toBe(m["automations.reason.heldBillingPaused"]);
  });

  it("email billing_paused → the same held row (mutation: skip it → FAILS)", async () => {
    expect(await holdOrSend(ctx(AT), email(), pausedEmail)).toBe("held");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "held", heldUntil: HOUR_ON, reason: REASONS.heldBillingPaused })]);
  });

  it("the REAL email gate's billing_paused lands as the same hold, end to end (mutation: drop the email half of pausedRefusal → FAILS: skipped)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    dbMocks.readBillingStanding.mockResolvedValue({
      complimentary: false, pausedAt: "2026-09-20T08:00:00.000Z", subscriptionStatus: "past_due",
      features: { voice_receptionist: true, web_concierge: true },
    } as never);
    const send = async () => {
      await sendEmailOrThrow({
        accountId: "acct_1", kind: "automation.reminder", contactId: "ct_1", now: AT, accountZone: "America/Chicago",
        to: "ana@example.com", fromName: "Rio Roofing", subject: "Reminder", body: "See you at 3",
      }, { db: {} as never });
    };
    expect(await holdOrSend(ctx(AT), email(), send)).toBe("held");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "held", heldUntil: HOUR_ON, reason: REASONS.heldBillingPaused })]);
  });

  it("billing_paused with a pause deadline already passed → skipped with skippedBillingPaused (mutation: hold it → FAILS)", async () => {
    expect(await holdOrSend(ctx(AT), subject({ pauseDeadline: AT }), pausedSms)).toBe("skipped");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "skipped", reason: REASONS.skippedBillingPaused })]);
    expect(REASONS.skippedBillingPaused).toBe(m["automations.reason.skippedBillingPaused"]);
  });

  it("a subject with a deadline but no pauseDeadline uses its deadline (mutation: ignore deadline → FAILS)", async () => {
    const appointment = new Date("2026-09-21T17:40:00.000Z");
    expect(await holdOrSend(ctx(AT), subject({ deadline: appointment }), pausedSms)).toBe("held");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "held", heldUntil: appointment.toISOString() })]);
    dbMocks.recordAutomationLog.mockClear();
    expect(await holdOrSend(ctx(AT), subject({ deadline: new Date("2026-09-21T17:10:00.000Z") }), pausedSms)).toBe("skipped");
    expect(logWrites()).toEqual([expect.objectContaining({ status: "skipped", reason: REASONS.skippedBillingPaused })]);
  });

  it("pauseDeadline wins over deadline when both are set", async () => {
    const pauseDeadline = new Date("2026-09-21T17:30:00.000Z");
    expect(await holdOrSend(ctx(AT), subject({ deadline: new Date("2026-09-22T17:30:00.000Z"), pauseDeadline }), pausedSms)).toBe("held");
    expect(logWrites()).toEqual([expect.objectContaining({ heldUntil: pauseDeadline.toISOString() })]);
  });

  it("a pause hold in force returns held without calling send() (mutation: drop the short-circuit → FAILS: the gate stub is called)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    dbMocks.getAutomationLogEntry.mockResolvedValue({ status: "held", reason: REASONS.heldBillingPaused, held_until: HOUR_ON });
    const send = vi.fn(pausedSms);
    expect(await holdOrSend(ctx(AT), subject(), send)).toBe("held");
    expect(send).not.toHaveBeenCalled();
    expect(dbMocks.recordAutomationLog).not.toHaveBeenCalled();
    expect(dbMocks.getAutomationLogEntry).toHaveBeenCalledWith(expect.anything(), "acct_1", "sms_reminder", "booking:bk_1");
  });

  it("another hold in force (quiet hours) does NOT short-circuit: the gate is asked (mutation: ignore the reason → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    dbMocks.getAutomationLogEntry.mockResolvedValue({ status: "held", reason: "Held until 8:00 AM — quiet hours", held_until: HOUR_ON });
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(AT), subject(), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("switch OFF: no log read before the send, so an unenforced tick costs nothing new (mutation: short-circuit regardless of the switch → FAILS)", async () => {
    dbMocks.getAutomationLogEntry.mockResolvedValue({ status: "held", reason: REASONS.heldBillingPaused, held_until: HOUR_ON });
    const send = vi.fn(async () => {});
    expect(await holdOrSend(ctx(AT), subject(), send)).toBe("sent");
    expect(send).toHaveBeenCalledTimes(1);
    expect(dbMocks.getAutomationLogEntry).not.toHaveBeenCalled();
  });

  it("a held row released while still paused is held again; released after the lift is sent (mutation: stamp it skipped on the second refusal → FAILS)", async () => {
    vi.stubEnv("BILLING_ENFORCE", "1");
    // A recording log: the next read answers with the last row written.
    dbMocks.getAutomationLogEntry.mockImplementation(async () => {
      const w = dbMocks.recordAutomationLog.mock.calls.at(-1)?.[1] as { status: string; reason: string; heldUntil?: string } | undefined;
      return w ? { status: w.status, reason: w.reason, held_until: w.heldUntil ?? null } : null;
    });
    let paused = true;
    const send = vi.fn(async () => { if (paused) throw new SmsBlocked("billing_paused"); });
    expect(await holdOrSend(ctx(AT), subject(), send)).toBe("held");
    // The release pass brings it back at held_until (18:00Z): still paused, so held to 19:00Z.
    expect(await holdOrSend(ctx(new Date(HOUR_ON)), subject(), send)).toBe("held");
    paused = false;   // the Lift (bumpHeldForAccount sets held_until = now) or the payment
    expect(await holdOrSend(ctx(new Date("2026-09-21T19:00:00.000Z")), subject(), send)).toBe("sent");
    expect(logWrites().map((w) => [w.status, w.heldUntil ?? null, w.reason])).toEqual([
      ["held", HOUR_ON, REASONS.heldBillingPaused],
      ["held", "2026-09-21T19:00:00.000Z", REASONS.heldBillingPaused],
      ["sent", null, ""],
    ]);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("BLOCK_REASONS and EMAIL_BLOCK_REASONS name billing_paused in their own words, not the deadline skip's 'too late' (the exhaustive Records; holdOrSend intercepts it first; review item 2; mutation: map it to skippedBillingPaused → FAILS)", () => {
    expect(BLOCK_REASONS.billing_paused).toBe("Not sent: the account is paused");
    expect(EMAIL_BLOCK_REASONS.billing_paused).toBe(REASONS.billingPaused);
    expect(REASONS.billingPaused).toBe(m["automations.reason.billingPaused"]);
    expect(m["automations.reason.billingPaused.es"]).toBe("No se envió: la cuenta está en pausa");
  });
});
