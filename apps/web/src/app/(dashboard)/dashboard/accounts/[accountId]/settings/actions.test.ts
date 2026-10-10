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
  // Review round 1, m4: createFieldAction must refuse "referred_by" BEFORE
  // ever reaching this — the mock lets the refusal test assert the DB was
  // never touched, not merely that the promise rejected.
  createCustomField: vi.fn(),
  // Spanish-runtime Task 5: the one write path for accounts.language.
  setAccountLanguage: vi.fn(),
  // The send gate's reads (lib/consent/gate.ts): the code goes through the
  // REAL gate, so its ledger and flag reads are mocked, allowed by default.
  readConsentState: vi.fn(), readPhoneCountryFlag: vi.fn(), readAccountTimezone: vi.fn(), recordCarrierBlock: vi.fn(),
  // D-061: the gate's own account-level send switch, for both the SMS code
  // and the sender-check email (which falls back to the stubbed serviceDb()
  // below). Allowed by default.
  isAccountOutboundSuppressed: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({ tag: "serviceDb" }),
}));

// `createFieldAction` is the one action in this file that reaches
// `dbForRequest()` (every other one here uses `serviceDb()`, mocked above)
// — nothing else in this file depends on it being real.
vi.mock("@/lib/db", () => ({ dbForRequest: vi.fn(async () => ({ tag: "dbForRequest" })) }));

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

// setFromEmailAction's one caller of Clerk: a fixed admin address, so the
// sender-check email has somewhere to send its verification to.
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: { getUser: async () => ({ primaryEmailAddress: { emailAddress: "admin@example.com" } }) },
  }),
}));

// isFake: false — verifyFromAddress (preflight.ts) refuses to "verify"
// against the FAKE provider outside production, before the real gate is
// even reached, so a test of the GATE's own refusal needs a provider that
// looks real without touching a network.
const emailSendMock = vi.fn();
vi.mock("@/lib/email", () => ({
  getEmailProvider: () => ({ isFake: false, send: (...a: unknown[]) => emailSendMock(...a) }),
}));

import { m } from "@/lib/messages";
import { SmsProviderError } from "@/lib/sms/types";
import {
  setAlertPhoneAction, startAlertPhoneVerificationAction, confirmAlertPhoneVerificationAction, setFromEmailAction,
  createFieldAction, setAccountLanguageAction,
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
  dbMocks.setAccountLanguage.mockReset().mockResolvedValue(undefined);
  sendMock.mockReset().mockResolvedValue({ providerMessageId: "msg_1" });
  dbMocks.readConsentState.mockReset().mockResolvedValue({ state: "allowed" });
  dbMocks.readPhoneCountryFlag.mockReset().mockResolvedValue(false);
  dbMocks.isAccountOutboundSuppressed.mockReset().mockResolvedValue(false);
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

describe("startAlertPhoneVerificationAction — normalization is F-009's (phoneForCountry), not a second dialect", () => {
  it("refuses a value the normaliser cannot parse, and never opens a verification (mutation: skip the refusal → FAILS)", async () => {
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "not a number" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneBad"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
  });

  it("normalizes a human-typed number before opening a verification (mutation: pass the raw string through → FAILS)", async () => {
    await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "(956) 292-1696", alertPhoneCountry: "US" }));
    expect(dbMocks.startAlertPhoneVerification).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", "+19562921696",
    );
  });
});

describe("startAlertPhoneVerificationAction — agency-gated", () => {
  it("calls requireAgencyOnlyAccountAccess for this account (mutation: drop the guard call → FAILS)", async () => {
    await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" }));
    expect(requireAgencyOnlyAccountAccessMock).toHaveBeenCalledWith("acct_1");
  });
});

describe("startAlertPhoneVerificationAction — nothing to send on", () => {
  it("refuses when texting isn't cleared to send at all, and never opens a verification (mutation: ignore gate.ok → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
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
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneSelfWarning"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("also refuses a second owned number that differs from the resolved sender (mutation: compare only to gate.from → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({
      ok: true, from: "+19565550001", ownedNumbers: ["+19565550001", "+19565550002"],
    });
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550002", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneSelfWarning"] });
  });
});

describe("startAlertPhoneVerificationAction — rate limiting the send", () => {
  it("refuses once the hourly cap is reached, and never opens another verification (mutation: drop the count check → FAILS)", async () => {
    dbMocks.countRecentAlertPhoneVerifications.mockResolvedValue(5);
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneTooManyCodes"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
  });

  it("still sends under the cap", async () => {
    dbMocks.countRecentAlertPhoneVerifications.mockResolvedValue(4);
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
      .toEqual({ ok: true, phone: "+19565550001" });
  });
});

describe("startAlertPhoneVerificationAction — the happy path", () => {
  it("opens a verification and texts the code to the claimed number, from the account's own resolved sender (mutation: send to gate.from instead of the claimed number → FAILS)", async () => {
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_1", code: "482913" });
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
      .toEqual({ ok: true, phone: "+19565550001" });
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
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneSendFailed"] });
    spy.mockRestore();
  });

  it("discards the row when the send fails, so a carrier failure never spends a rate-limit slot with nothing delivered (mutation: drop the discard call from the catch block → FAILS)", async () => {
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_failed", code: "482913" });
    sendMock.mockRejectedValue(new Error("telnyx down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
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

/**
 * Consent chain PR-1 (spec §4.1 item 1, §6): the alert phone carries its
 * country, so it is never ambiguous, and its code goes through the send gate
 * as `operator.alert_phone_code`.
 */
describe("startAlertPhoneVerificationAction — the country beside the number", () => {
  it("ten digits under Mexico (+52) are claimed and texted as +52 (mutation: ignore the country → +1, FAILS)", async () => {
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "55 1234 5678", alertPhoneCountry: "MX" })))
      .toEqual({ ok: true, phone: "+525512345678" });
    expect(dbMocks.startAlertPhoneVerification).toHaveBeenCalledWith({ tag: "serviceDb" }, "acct_1", "+525512345678");
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ to: "+525512345678" }));
  });

  it("a typed +52 under US (+1) is refused with the mismatch line, never settled for the agency (review R3-M4; mutation: answer alertPhoneBad → FAILS; keep whatever code was typed → FAILS)", async () => {
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+52 55 1234 5678", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneCountryMismatch"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
  });

  // Review R3-I1: a country code typed WITHOUT "+" is still an explicit code.
  // The old nationalTen stripped it and texted a stranger in the other country.
  it.each([
    ["52 55 1234 5678", "US"],
    ["52 899 922 1234", "US"],
    ["1 956 292 1696", "MX"],
  ])("%s under %s is a mismatch, and no code goes anywhere (review R3-I1; mutation: strip the typed code and add the picked one → +15512345678 texted, FAILS)", async (typed, country) => {
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: typed, alertPhoneCountry: country })))
      .toEqual({ ok: false, error: m["settings.alertPhoneCountryMismatch"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("a number that reads under neither country is still the bad-number line (mutation: always answer the mismatch line → FAILS)", async () => {
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+44 20 7946 0958", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneBad"] });
  });
});

describe("startAlertPhoneVerificationAction — a phone that texted STOP gets no code", () => {
  it("answers the spec's line, sends nothing, and gives the rate-limit slot back (mutation: report the generic send failure → FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_stop", code: "482913" });
    dbMocks.readConsentState.mockResolvedValue({ state: "stopped", since: "2026-10-03T15:00:00Z", method: "keyword", eventId: "e1" });
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneStopped"] });
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMocks.discardAlertPhoneVerification).toHaveBeenCalledWith({ tag: "serviceDb" }, "ver_stop");
    spy.mockRestore();
  });

  it("the FIRST attempt, refused by the carrier with 40300, already says the stopped line (review R3-I3; mutation: only blocked:stopped maps → alertPhoneSendFailed, FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_40300", code: "482913" });
    sendMock.mockRejectedValue(new SmsProviderError('telnyx send failed (400): {"errors":[{"code":"40300"}]}', 400, ["40300"]));
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneStopped"] });
    expect(dbMocks.discardAlertPhoneVerification).toHaveBeenCalledWith({ tag: "serviceDb" }, "ver_40300");
    spy.mockRestore();
  });

  it("a gate that THROWS still gives the rate-limit slot back (review R3-M3; mutation: drop the try/catch → rejects, FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_throw", code: "482913" });
    resolveSmsSenderMock.mockResolvedValueOnce({ ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"] })
      .mockRejectedValueOnce(new Error("fetch failed"));
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneSendFailed"] });
    expect(dbMocks.discardAlertPhoneVerification).toHaveBeenCalledWith({ tag: "serviceDb" }, "ver_throw");
    spy.mockRestore();
  });

  it("logs the sendSms error BEFORE discarding the row, so a throwing discard can't swallow it (mutation: discard before logging → the original error never reaches console.error, FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_dbl", code: "482913" });
    resolveSmsSenderMock.mockResolvedValueOnce({ ok: true, from: "+19565559999", ownedNumbers: ["+19565559999"] })
      .mockRejectedValueOnce(new Error("gate exploded"));
    dbMocks.discardAlertPhoneVerification.mockRejectedValueOnce(new Error("discard also failed"));
    await expect(
      startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })),
    ).rejects.toThrow("discard also failed");
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("gate exploded"));
    spy.mockRestore();
  });
});

describe("startAlertPhoneVerificationAction — the country is required, never assumed (fail closed)", () => {
  it("refuses a missing alertPhoneCountry, and never opens a verification (mutation: default to US → FAILS)", async () => {
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneBad"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("refuses an unrecognised alertPhoneCountry value, and never opens a verification (mutation: default to US → FAILS)", async () => {
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "CA" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneBad"] });
    expect(dbMocks.startAlertPhoneVerification).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe("startAlertPhoneVerificationAction — a ledger outage keeps the generic send-failed line (review: S1 dropped the \"stopped\" reason check)", () => {
  it("a ledger read failure gets the generic send-failed line, never the stopped one, and gives the rate-limit slot back (mutation: (result.kind === \"blocked\") in place of the stopped check → answers alertPhoneStopped for every blocked reason, FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_ledger", code: "482913" });
    dbMocks.readConsentState.mockRejectedValue(new Error("ledger down"));
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+19565550001", alertPhoneCountry: "US" })))
      .toEqual({ ok: false, error: m["settings.alertPhoneSendFailed"] });
    expect(sendMock).not.toHaveBeenCalled();
    expect(dbMocks.discardAlertPhoneVerification).toHaveBeenCalledWith({ tag: "serviceDb" }, "ver_ledger");
    spy.mockRestore();
  });
});

describe("startAlertPhoneVerificationAction → confirmAlertPhoneVerificationAction — a Mexican number round-trips (review: S5, confirm reading phoneForCountry(raw, \"US\"))", () => {
  it("starts under Mexico (+52) and confirms the SAME E.164 the start action returned (mutation: confirm reading phoneForCountry(raw, \"US\") → no Mexican number can ever be confirmed, FAILS)", async () => {
    dbMocks.startAlertPhoneVerification.mockResolvedValue({ id: "ver_mx", code: "482913" });
    expect(await startAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "55 1234 5678", alertPhoneCountry: "MX" })))
      .toEqual({ ok: true, phone: "+525512345678" });
    dbMocks.verifyAlertPhoneCode.mockResolvedValue("verified");
    expect(await confirmAlertPhoneVerificationAction("acct_1", fd({ alertPhone: "+525512345678", code: "482913" })))
      .toEqual({ ok: true });
    expect(dbMocks.verifyAlertPhoneCode).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", "+525512345678", "482913", "user_1",
    );
  });
});

describe("setFromEmailAction — a suppressed account's sender check (D-061 review follow-up)", () => {
  it("shows the plain sentence, never the gate's raw reason string (mutation: drop the EmailNotSent mapping → the raw 'email not sent: suppressed_account' reaches the admin, FAILS)", async () => {
    dbMocks.isAccountOutboundSuppressed.mockResolvedValueOnce(true);
    const result = await setFromEmailAction("acct_1", fd({ fromEmail: "leads@rioroofing.com" }));
    expect(result).toEqual({ ok: false, error: m["automations.reason.accountSuppressed"] });
  });
});

/**
 * Review round 1, CRITICAL C1's own follow-up, m4: "referred_by" is the key
 * F-157's source question writes directly onto `contacts.custom`
 * (lib/contacts/lead-source.ts). A custom contact field created with that
 * SAME key would merge an unrelated operator-defined value into the exact
 * jsonb property the drawer's Source line reads as a word-of-mouth
 * referral — reserved outright rather than left to collide silently.
 */
describe("createFieldAction — \"referred_by\" is reserved (review round 1, m4)", () => {
  it("refuses the reserved key before ever reaching the database (mutation: drop the check → createCustomField IS called, FAILS)", async () => {
    dbMocks.createCustomField.mockClear();
    await expect(createFieldAction("acct_1", fd({ name: "Referred by", fieldKey: "referred_by", dataType: "text" })))
      .rejects.toThrow(m["settings.fieldKeyReserved"]);
    expect(dbMocks.createCustomField).not.toHaveBeenCalled();
  });

  it("is case- and whitespace-insensitive (an operator pasting \" Referred_By \" is still the same reserved key)", async () => {
    dbMocks.createCustomField.mockClear();
    await expect(createFieldAction("acct_1", fd({ name: "x", fieldKey: " Referred_By ", dataType: "text" })))
      .rejects.toThrow(m["settings.fieldKeyReserved"]);
    expect(dbMocks.createCustomField).not.toHaveBeenCalled();
  });

  it("any other key still reaches the database as before (mutation: refuse everything → FAILS)", async () => {
    dbMocks.createCustomField.mockClear().mockResolvedValue({ id: "f1" });
    await createFieldAction("acct_1", fd({ name: "Gate code", fieldKey: "gate_code", dataType: "text" }));
    expect(dbMocks.createCustomField).toHaveBeenCalledTimes(1);
  });
});

/**
 * Spanish-runtime Task 5 (owner decision 4): the one Language field on the
 * agency Settings page. `accounts.language` is not client-writable (0065
 * grants `authenticated` no UPDATE on it — same shape as `alert_phone`/
 * `transfer_phone`), so `requireAgencyOnlyAccountAccess` on the first line
 * is the ONLY gate on this write, exactly as the file's other serviceDb()
 * actions document for themselves.
 *
 * `(accountId, value)`, not `(accountId, FormData)` (fix round 1, I2): this
 * is the one action `InlineField`'s `save` prop calls directly, the same
 * shape `renameAccountAction` already uses for the same reason — see this
 * action's own doc comment in actions.ts.
 */
describe("setAccountLanguageAction — agency-only, and en/es are the only values", () => {
  it("rejects a value outside en/es before touching the database (mutation: drop the guard and pass the value through to setAccountLanguage → FAILS, a Postgres check-constraint error leaks as a 500 instead of this action's own {ok:false})", async () => {
    const result = await setAccountLanguageAction("acct_1", "fr");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("English") });
    expect(dbMocks.setAccountLanguage).not.toHaveBeenCalled();
  });

  it("writes the chosen language through serviceDb(), as the userId requireAgencyOnlyAccountAccess resolved (mutation: write dbForRequest() or drop userId → FAILS)", async () => {
    expect(await setAccountLanguageAction("acct_1", "es")).toEqual({ ok: true });
    expect(dbMocks.setAccountLanguage).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", "es", "user_1",
    );
  });

  it("calls requireAgencyOnlyAccountAccess before writing (mutation: drop the guard call → FAILS)", async () => {
    await setAccountLanguageAction("acct_1", "en");
    expect(requireAgencyOnlyAccountAccessMock).toHaveBeenCalledWith("acct_1");
  });
});
