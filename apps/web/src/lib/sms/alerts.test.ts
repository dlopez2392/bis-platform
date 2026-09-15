import { describe, it, expect, vi, beforeEach } from "vitest";
import { segmentsFor } from "./segments";

const resolveSmsSenderMock = vi.fn();
vi.mock("./sender", async () => {
  const actual = await vi.importActual<typeof import("./sender")>("./sender");
  return { ...actual, resolveSmsSender: (...a: unknown[]) => resolveSmsSenderMock(...a) };
});

const sendMock = vi.fn();
const getSmsProviderMock = vi.fn(() => ({ isFake: true, send: sendMock }));
vi.mock("./index", () => ({ getSmsProvider: (...a: unknown[]) => getSmsProviderMock() }));

import { composeBookingAlertSms, composeCallAlertSms, sendAlertSms } from "./alerts";

const ACCOUNT_ID = "acct_1";
const ALERT_PHONE = "+19565550001";
const SENDING_NUMBER = "+19565559999";

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ providerMessageId: "msg_1" });
  resolveSmsSenderMock.mockResolvedValue({ ok: true, from: SENDING_NUMBER });
});

describe("composeBookingAlertSms", () => {
  it("leads with what happened and who it was, and fits one segment", () => {
    const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", "Maria Lopez");
    expect(body).toContain("Maria Lopez");
    expect(body).toContain("Tue, Sep 16, 2:00 PM CDT");
    expect(segmentsFor(body).segments).toBe(1);
  });

  it("never includes a phone number — only a name and a when-string are lead PII safe enough for a handset", () => {
    const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", "Maria Lopez");
    expect(body).not.toMatch(/\+?\d{7,}/);
  });

  // The mutation this pins: a long, accented name (the common case this
  // platform's own Rio Grande Valley client base produces — see
  // textback-body.ts) drops the WHOLE message to UCS-2 at 70 chars/segment.
  // A naive `New booking: <when> - <name>.` composition blows that budget on
  // a name this long; the fallback (drop the name) must kick in and keep the
  // send to one segment. If the fallback is removed, this goes to 2+.
  it("falls back to a no-name body when a long accented name would push the message past one segment (mutation: drop the fallback → FAILS)", () => {
    const longAccentedName = "María Fernanda de la Peña González-Rodríguez";
    const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", longAccentedName);
    expect(segmentsFor(body).segments).toBe(1);
  });
});

describe("composeCallAlertSms", () => {
  it.each(["booked", "lead", "message"] as const)(
    "outcome %s: names what happened, fits one segment, carries no caller number",
    (outcome) => {
      const body = composeCallAlertSms(outcome);
      expect(body.length).toBeGreaterThan(0);
      expect(segmentsFor(body).segments).toBe(1);
      expect(body).not.toMatch(/\+?\d{7,}/);
    },
  );

  it("distinguishes the three outcomes in the copy", () => {
    const bodies = new Set(["booked", "lead", "message"].map((o) => composeCallAlertSms(o as never)));
    expect(bodies.size).toBe(3);
  });
});

describe("sendAlertSms", () => {
  it("does nothing when alertPhone is null — the field is the switch (mutation: send anyway → FAILS)", async () => {
    await sendAlertSms({} as never, ACCOUNT_ID, null, "New booking: now - Test.");
    expect(resolveSmsSenderMock).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("attempts the send through resolveSmsSender's own from-number when the gate is open", async () => {
    await sendAlertSms({} as never, ACCOUNT_ID, ALERT_PHONE, "New booking: now - Test.");
    expect(resolveSmsSenderMock).toHaveBeenCalledWith({}, ACCOUNT_ID);
    expect(sendMock).toHaveBeenCalledWith({ to: ALERT_PHONE, from: SENDING_NUMBER, body: "New booking: now - Test." });
  });

  it("refuses without sending when A2P is not approved (mutation: send regardless of gate.ok → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    await sendAlertSms({} as never, ACCOUNT_ID, ALERT_PHONE, "New booking: now - Test.");
    expect(sendMock).not.toHaveBeenCalled();
  });

  // THE loop guard (0035's migration, decision 3): alert_phone can equal the
  // account's own live sending number with nothing in the schema stopping
  // it. Texting it would have api/sms/inbound/route.ts create a contact and
  // conversation for the business's own owner.
  it("refuses and logs both numbers when alert_phone equals the account's own sending number (mutation: drop the loop guard → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: true, from: ALERT_PHONE });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendAlertSms({} as never, ACCOUNT_ID, ALERT_PHONE, "New booking: now - Test.");
    expect(sendMock).not.toHaveBeenCalled();
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(ALERT_PHONE);
    // Named as BOTH numbers — since they are equal here, the assertion that
    // matters is that the from-number (the resolved sending number) is also
    // named, which alertPhone alone does not prove.
    expect(logged).toContain(ACCOUNT_ID);
    spy.mockRestore();
  });

  it("never throws when the provider send rejects — logged, not propagated (mutation: remove the try/catch → FAILS)", async () => {
    sendMock.mockRejectedValue(new Error("telnyx down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendAlertSms({} as never, ACCOUNT_ID, ALERT_PHONE, "New booking: now - Test."),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("never throws when resolveSmsSender itself rejects (a phone_numbers read error)", async () => {
    resolveSmsSenderMock.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendAlertSms({} as never, ACCOUNT_ID, ALERT_PHONE, "New booking: now - Test."),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
