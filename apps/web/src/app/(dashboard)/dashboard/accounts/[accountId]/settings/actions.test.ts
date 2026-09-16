import { describe, it, expect, vi, beforeEach } from "vitest";

// setReportEmailsAction and setFromEmailAction beside these actions both call
// revalidatePath on every success path, and outside a real request it throws
// ("static generation store missing") rather than no-op'ing — same mock
// voice/actions.test.ts and conversations/actions.test.ts carry for the
// same reason.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dbMocks = vi.hoisted(() => ({
  setAlertPhone: vi.fn(),
  startAlertPhoneVerification: vi.fn(),
  verifyAlertPhoneCode: vi.fn(),
  countRecentAlertPhoneVerifications: vi.fn(),
  discardAlertPhoneVerification: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({ tag: "serviceDb" }),
}));

// Guard mock, shaped after branding/actions.test.ts's own stub for
// requireAccountAccess: these actions call requireAgencyOnlyAccountAccess
// directly (the exact precedent setFromEmailAction and setReportEmailsAction
// set beside it), and that function itself redirects a non-agency caller —
// nothing in these actions re-checks isAgency, so a plain stub resolving
// { userId } is the correct fixture, not a switchable one.
const requireAgencyOnlyAccountAccessMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: (accountId: string) => requireAgencyOnlyAccountAccessMock(accountId),
}));

// `refusesAlertLoop` stays REAL (pure, deterministic — the exact reasoning
// lib/sms/alerts.test.ts's own "./sender" mock carries for the same
// function); only `resolveSmsSender` is swapped for a controllable stub.
const resolveSmsSenderMock = vi.fn();
vi.mock("@/lib/sms/sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sms/sender")>();
  return { ...actual, resolveSmsSender: (db: unknown, accountId: string) => resolveSmsSenderMock(db, accountId) };
});

const sendMock = vi.fn();
const getSmsProviderMock = vi.fn(() => ({ isFake: true, send: sendMock }));
vi.mock("@/lib/sms", () => ({ getSmsProvider: () => getSmsProviderMock() }));

import { m } from "@/lib/messages";
import {
  setAlertPhoneAction, startAlertPhoneVerificationAction, confirmAlertPhoneVerificationAction,
} from "./actions";

const fd = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [key, value] of Object.entries(fields)) f.set(key, value);
  return f;
};

beforeEach(() => {
  requireAgencyOnlyAccountAccessMock.mockReset().mockResolvedValue({ userId: "user_1" });
  dbMocks.setAlertPhone.mockReset().mockResolvedValue(undefined);
  dbMocks.startAlertPhoneVerification.mockReset().mockResolvedValue({ id: "ver_1", code: "482913" });
  dbMocks.verifyAlertPhoneCode.mockReset().mockResolvedValue("verified");
  dbMocks.countRecentAlertPhoneVerifications.mockReset().mockResolvedValue(0);
  dbMocks.discardAlertPhoneVerification.mockReset().mockResolvedValue(undefined);
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "msg_1" });
  // Cleared/live by default — most tests care about one thing at a time, and
  // an unmocked resolveSmsSender() would return undefined and crash the
  // `gate.ok` read.
  resolveSmsSenderMock.mockReset().mockResolvedValue({
    ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"],
  });
});

describe("setAlertPhoneAction — clearing needs no proof", () => {
  it("writes NULL for a blank field, never the raw empty string (mutation: pass raw through → FAILS)", async () => {
    expect(await setAlertPhoneAction("acct_1", fd({ alertPhone: "" }))).toEqual({ ok: true });
    expect(dbMocks.setAlertPhone).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", null, "user_1",
    );
  });

  it("writes NULL for a whitespace-only field too", async () => {
    expect(await setAlertPhoneAction("acct_1", fd({ alertPhone: "   " }))).toEqual({ ok: true });
    expect(dbMocks.setAlertPhone).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", null, "user_1",
    );
  });

  it("calls requireAgencyOnlyAccountAccess before writing (mutation: drop the guard call → FAILS)", async () => {
    await setAlertPhoneAction("acct_1", fd({ alertPhone: "" }));
    expect(requireAgencyOnlyAccountAccessMock).toHaveBeenCalledWith("acct_1");
  });
});

describe("setAlertPhoneAction — a non-blank value can no longer write the number directly", () => {
  it("refuses a non-blank field and never calls setAlertPhone — the gap 0036 closes (mutation: fall through to the write → FAILS)", async () => {
    expect(await setAlertPhoneAction("acct_1", fd({ alertPhone: "+19565550001" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneNeedsVerification"] });
    expect(dbMocks.setAlertPhone).not.toHaveBeenCalled();
  });
});

describe("startAlertPhoneVerificationAction — normalization is toE164's, not a second dialect", () => {
  it("refuses a value toE164 cannot parse, and never opens a verification (mutation: skip the refusal → FAILS)", async () => {
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "not a number" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneBad"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
  });

  it("normalizes a human-typed number before opening a verification (mutation: pass the raw string through → FAILS)", async () => {
    await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "(956) 292-1696" }));
    expect(dbMocks.startAlertPhoneVerification).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", "+19562921696",
    );
  });
});

describe("startAlertPhoneVerificationAction — agency-gated", () => {
  it("calls requireAgencyOnlyAccountAccess for this account (mutation: drop the guard call → FAILS)", async () => {
    await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001" }));
    expect(requireAgencyOnlyAccountAccessMock).toHaveBeenCalledWith("acct_1");
  });
});

describe("startAlertPhoneVerificationAction — nothing to send on", () => {
  it("refuses when texting isn't cleared to send at all, and never opens a verification (mutation: ignore gate.ok → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneNotClearedToSend"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
  });
});

describe("startAlertPhoneVerificationAction — the self-text loop is refused outright, not merely warned about", () => {
  // Unlike the old direct-write action, a code sent to the account's own
  // number can never be answered — it would loop back into the inbound
  // webhook instead of reaching a handset — so this can no longer be "help"
  // after a successful save; there is nothing to save yet.
  it("refuses when the number equals the account's own resolved sending number (mutation: send anyway → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({
      ok: true, from: "+19565550001", ownedNumbers: ["+19565550001"],
    });
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneSelfWarning"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("also refuses a second owned number that differs from the resolved sender (mutation: compare only to gate.from → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({
      ok: true, from: "+19565550001", ownedNumbers: ["+19565550001", "+19565550002"],
    });
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550002" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneSelfWarning"] });
  });
});

describe("startAlertPhoneVerificationAction — rate limiting the send", () => {
  it("refuses once the hourly cap is reached, and never opens another verification (mutation: drop the count check → FAILS)", async () => {
    dbMocks.countRecentAlertPhoneVerifications.mockResolvedValue(5);
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneTooManyCodes"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
  });

  it("still sends under the cap", async () => {
    dbMocks.countRecentAlertPhoneVerifications.mockResolvedValue(4);
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001" })))
      .toEqual({ ok: true });
  });
});

describe("startAlertPhoneVerificationAction — the happy path", () => {
  it("opens a verification and texts the code to the claimed number, from the account's own resolved sender (mutation: send to gate.from instead of the claimed number → FAILS)", async () => {
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_1", code: "482913" });
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001" })))
      .toEqual({ ok: true });
    expect(dbMocks.startAlertPhoneVerification).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", "+19565550001",
    );
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "+19565550001", from: "+19565559999", body: expect.stringContaining("482913"),
    }));
  });

  it("reports failure, and never claims success, when the provider send throws (mutation: swallow the error and return ok → FAILS)", async () => {
    sendMock.mockRejectedValue(new Error("telnyx down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneSendFailed"] });
    spy.mockRestore();
  });

  it("discards the row when the send fails, so a carrier failure never spends a rate-limit slot with nothing delivered (mutation: drop the discard call from the catch block → FAILS)", async () => {
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_failed", code: "482913" });
    sendMock.mockRejectedValue(new Error("telnyx down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneSendFailed"] });
    expect(dbMocks.discardAlertPhoneVerification).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "ver_failed",
    );
    spy.mockRestore();
  });
});

describe("confirmAlertPhoneVerificationAction — a wrong code and an expired code are different, and neither writes the number", () => {
  it("reports the wrong-code error and does not reveal it as expiry (mutation: return the expired copy instead → FAILS)", async () => {
    dbMocks.verifyAlertPhoneCode.mockResolvedValue("wrong_code");
    expect(await confirmAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", code: "000000" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneWrongCode"] });
  });

  it("reports the expired-code error, distinct from the wrong-code one (mutation: return the wrong-code copy instead → FAILS)", async () => {
    dbMocks.verifyAlertPhoneCode.mockResolvedValue("expired");
    expect(await confirmAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", code: "000000" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneCodeExpired"] });
  });

  it("the two error strings are not the same copy", () => {
    expect(m["settings.alertPhoneWrongCode"]).not.toBe(m["settings.alertPhoneCodeExpired"]);
  });
});

describe("confirmAlertPhoneVerificationAction — the right code", () => {
  it("reports ok on a verified outcome (mutation: report ok:false anyway → FAILS)", async () => {
    dbMocks.verifyAlertPhoneCode.mockResolvedValue("verified");
    expect(await confirmAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", code: "482913" })))
      .toEqual({ ok: true });
  });

  it("passes the normalized number and the raw code through to verifyAlertPhoneCode (mutation: pass the raw phone string → FAILS)", async () => {
    await confirmAlertPhoneVerificationAction(
      "acct_1", fd({ alertPhone: "(956) 292-1696", code: "482913" }),
    );
    expect(dbMocks.verifyAlertPhoneCode).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", "+19562921696", "482913", "user_1",
    );
  });

  it("calls requireAgencyOnlyAccountAccess for this account (mutation: drop the guard call → FAILS)", async () => {
    await confirmAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", code: "482913" }));
    expect(requireAgencyOnlyAccountAccessMock).toHaveBeenCalledWith("acct_1");
  });
});
