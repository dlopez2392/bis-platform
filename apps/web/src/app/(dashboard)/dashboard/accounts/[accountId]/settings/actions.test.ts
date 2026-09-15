import { describe, it, expect, vi, beforeEach } from "vitest";

// setReportEmailsAction and setFromEmailAction beside this action both call
// revalidatePath on every success path, and outside a real request it throws
// ("static generation store missing") rather than no-op'ing — same mock
// voice/actions.test.ts and conversations/actions.test.ts carry for the
// same reason.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const dbMocks = vi.hoisted(() => ({
  setAlertPhone: vi.fn(),
}));
vi.mock("@bis/db", async (importOriginal) => ({
  ...(await importOriginal<object>()), ...dbMocks, serviceDb: () => ({ tag: "serviceDb" }),
}));

// Guard mock, shaped after branding/actions.test.ts's own stub for
// requireAccountAccess: setAlertPhoneAction calls requireAgencyOnlyAccountAccess
// directly (the exact precedent setFromEmailAction and setReportEmailsAction
// set beside it), and that function itself redirects a non-agency caller —
// nothing in this action re-checks isAgency, so a plain stub resolving
// { userId } is the correct fixture, not a switchable one.
const requireAgencyOnlyAccountAccessMock = vi.fn();
vi.mock("@/lib/auth", () => ({
  requireAgencyOnlyAccountAccess: (accountId: string) => requireAgencyOnlyAccountAccessMock(accountId),
}));

const resolveSmsSenderMock = vi.fn();
vi.mock("@/lib/sms/sender", () => ({
  resolveSmsSender: (db: unknown, accountId: string) => resolveSmsSenderMock(db, accountId),
}));

import { m } from "@/lib/messages";
import { setAlertPhoneAction } from "./actions";

const fd = (alertPhone: string) => {
  const f = new FormData();
  f.set("alertPhone", alertPhone);
  return f;
};

beforeEach(() => {
  requireAgencyOnlyAccountAccessMock.mockReset().mockResolvedValue({ userId: "user_1" });
  dbMocks.setAlertPhone.mockReset().mockResolvedValue(undefined);
  // Cleared/live by default — most tests care about the write, not the
  // self-loop warning, and an unmocked resolveSmsSender() would return
  // undefined and crash the `gate.ok` read.
  resolveSmsSenderMock.mockReset().mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
});

describe("setAlertPhoneAction — the empty string is refused", () => {
  it("writes NULL for a blank field, never the raw empty string (mutation: pass raw through → FAILS)", async () => {
    expect(await setAlertPhoneAction("acct_1", fd(""))).toEqual({ ok: true });
    expect(dbMocks.setAlertPhone).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", null, "user_1",
    );
  });

  it("writes NULL for a whitespace-only field too", async () => {
    expect(await setAlertPhoneAction("acct_1", fd("   "))).toEqual({ ok: true });
    expect(dbMocks.setAlertPhone).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", null, "user_1",
    );
  });
});

describe("setAlertPhoneAction — normalization is toE164's, not a second dialect", () => {
  it("stores the E.164 form of a human-typed number (mutation: store the raw string → FAILS)", async () => {
    expect(await setAlertPhoneAction("acct_1", fd("(956) 292-1696"))).toEqual({ ok: true });
    expect(dbMocks.setAlertPhone).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", "+19562921696", "user_1",
    );
  });

  it("refuses a value toE164 cannot parse, and never calls setAlertPhone (mutation: skip the refusal → FAILS)", async () => {
    expect(await setAlertPhoneAction("acct_1", fd("not a number")))
      .toEqual({ ok: false, error: m["settings.alertPhoneBad"] });
    expect(dbMocks.setAlertPhone).not.toHaveBeenCalled();
  });
});

describe("setAlertPhoneAction — agency-gated, like setFromEmailAction and setReportEmailsAction beside it", () => {
  it("calls requireAgencyOnlyAccountAccess for this account before writing (mutation: drop the guard call → FAILS)", async () => {
    await setAlertPhoneAction("acct_1", fd("+19565550001"));
    expect(requireAgencyOnlyAccountAccessMock).toHaveBeenCalledWith("acct_1");
  });
});

describe("setAlertPhoneAction — the self-text loop warning is help, not the guard", () => {
  it("still saves, and returns a warning, when the number equals the account's own resolved sending number (mutation: block the save instead → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: true, from: "+19565550001" });
    expect(await setAlertPhoneAction("acct_1", fd("+19565550001")))
      .toEqual({ ok: true, warning: m["settings.alertPhoneSelfWarning"] });
    expect(dbMocks.setAlertPhone).toHaveBeenCalledWith(
      { tag: "serviceDb" }, "acct_1", "+19565550001", "user_1",
    );
  });

  it("carries no warning when the resolved sending number differs (mutation: warn unconditionally → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: true, from: "+19565550002" });
    expect(await setAlertPhoneAction("acct_1", fd("+19565550001"))).toEqual({ ok: true });
  });

  it("carries no warning when texting isn't cleared to send at all — nothing to compare against yet", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    expect(await setAlertPhoneAction("acct_1", fd("+19565550001"))).toEqual({ ok: true });
  });

  it("never checks the loop on a clearing save — there is no number to compare (mutation: call resolveSmsSender even when clearing → FAILS)", async () => {
    await setAlertPhoneAction("acct_1", fd(""));
    expect(resolveSmsSenderMock).not.toHaveBeenCalled();
  });
});
