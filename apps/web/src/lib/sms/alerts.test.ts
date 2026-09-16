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

import {
  composeBookingAlertSms, composeCallAlertSms, sendAlertSms, prepareAlertSms, deliverAlertSms,
  composeAlertPhoneVerificationSms,
} from "./alerts";

const ACCOUNT_ID = "acct_1";
const ALERT_PHONE = "+19565550001";
const SENDING_NUMBER = "+19565559999";
const SECOND_OWNED_NUMBER = "+19565550100"; // e.g. a second row still `testing`

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ providerMessageId: "msg_1" });
  resolveSmsSenderMock.mockResolvedValue({
    ok: true, from: SENDING_NUMBER, ownedNumbers: [SENDING_NUMBER, SECOND_OWNED_NUMBER],
  });
});

describe("composeBookingAlertSms", () => {
  it("leads with what happened and who it was, and fits one segment", () => {
    const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", "Maria Lopez", true);
    expect(body).toContain("Maria Lopez");
    expect(body).toContain("Tue, Sep 16, 2:00 PM CDT");
    expect(segmentsFor(body).segments).toBe(1);
  });

  it("never includes a phone number — only a name and a when-string are lead PII safe enough for a handset", () => {
    const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", "Maria Lopez", true);
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
    const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", longAccentedName, true);
    expect(segmentsFor(body).segments).toBe(1);
  });

  // Finding 3 (alert-send-report follow-up review): the fallback body used to
  // say "Check email for details." unconditionally, even for a calendar with
  // no notify_emails — a promise of a message that was never sent. The
  // caller passes whether it actually has recipients; the fallback must obey
  // it.
  it("the no-name fallback omits the email mention when there are no notify-email recipients (mutation: ignore hasEmailRecipients → FAILS)", () => {
    const longAccentedName = "María Fernanda de la Peña González-Rodríguez";
    const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", longAccentedName, false);
    expect(body.toLowerCase()).not.toContain("email");
    expect(body).toContain("Tue, Sep 16, 2:00 PM CDT");
  });

  it("still mentions email in the fallback when recipients DO exist", () => {
    const longAccentedName = "María Fernanda de la Peña González-Rodríguez";
    const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", longAccentedName, true);
    expect(body.toLowerCase()).toContain("email");
  });

  // Minor (alert-send-report): contactName reaches the SMS without the
  // control-character strip the email subject gets for the same value
  // (stripSubjectControlChars, app/b/[publicId]/actions.ts). A crafted name
  // carrying a real newline must not be able to break the alert onto a
  // second visual line.
  it("strips control characters from the name before composing (mutation: drop the strip → FAILS)", () => {
    const body = composeBookingAlertSms("Tue, Sep 16, 2:00 PM CDT", "Maria\nLopez", true);
    expect(body).not.toContain("\n");
    expect(body).toContain("Maria Lopez");
  });

  // Minor: measured, not assumed — a realistic worst-case when-string
  // (longest common US timezone abbreviation) plus the longest fallback copy
  // must still fit one segment.
  it("measures the worst-case fallback body and confirms it still fits one segment", () => {
    const worstCaseWhen = "Thu, Jan 15, 10:00 AM AKST"; // longest US tz abbreviation seen in this app
    const longAccentedName = "María Fernanda de la Peña González-Rodríguez";
    const body = composeBookingAlertSms(worstCaseWhen, longAccentedName, true);
    expect(segmentsFor(body).segments).toBe(1);
  });
});

describe("composeCallAlertSms", () => {
  it.each(["booked", "lead", "message"] as const)(
    "outcome %s: names what happened, fits one segment, carries no caller number",
    (outcome) => {
      const body = composeCallAlertSms(outcome, true);
      expect(body.length).toBeGreaterThan(0);
      expect(segmentsFor(body).segments).toBe(1);
      expect(body).not.toMatch(/\+?\d{7,}/);
    },
  );

  it("distinguishes the three outcomes in the copy", () => {
    const bodies = new Set(["booked", "lead", "message"].map((o) => composeCallAlertSms(o as never, true)));
    expect(bodies.size).toBe(3);
  });

  // Finding 3 (alert-send-report follow-up review): live data showed two of
  // four calendars have no notify emails at all — for those accounts this
  // text was the only notification they get, naming nobody and pointing at
  // nothing it claimed existed.
  it("omits the email mention when there are no notify-email recipients (mutation: ignore hasEmailRecipients → FAILS)", () => {
    const body = composeCallAlertSms("lead", false);
    expect(body.toLowerCase()).not.toContain("email");
    expect(body.toLowerCase()).toContain("lead");
  });

  it("still mentions email when recipients DO exist", () => {
    const body = composeCallAlertSms("lead", true);
    expect(body.toLowerCase()).toContain("email");
  });

  // Minor: copy drift — the call alert and the booking fallback must agree
  // on the exact phrase once both are conditioned on hasEmailRecipients.
  it("uses the SAME email-mention phrase the booking fallback uses", () => {
    const callBody = composeCallAlertSms("lead", true);
    const bookingBody = composeBookingAlertSms(
      "Tue, Sep 16, 2:00 PM CDT", "María Fernanda de la Peña González-Rodríguez", true,
    );
    const phrase = /Check( your)? email for details\./;
    const callMatch = callBody.match(phrase)?.[0];
    const bookingMatch = bookingBody.match(phrase)?.[0];
    expect(callMatch).toBeTruthy();
    expect(callMatch).toBe(bookingMatch);
  });
});

describe("prepareAlertSms / deliverAlertSms (the finish-call ordering split)", () => {
  // Finding 4 (alert-send-report follow-up review): finishCall must not run
  // the provider POST ahead of the durable call row, mirroring the
  // missed-call text-back's own split. sendAlertSms stays the single
  // convenience path for the booking call site (no such ordering
  // constraint), but finish-call.ts needs the DB-reads-only half and the
  // network-only half as two separate calls.
  it("prepareAlertSms resolves the gate and the loop guard WITHOUT calling the provider", async () => {
    const pending = await prepareAlertSms({} as never, ACCOUNT_ID, ALERT_PHONE, "New booking: now - Test.");
    expect(pending).toEqual({ to: ALERT_PHONE, from: SENDING_NUMBER, body: "New booking: now - Test." });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("prepareAlertSms returns null when alertPhone is null, no DB read attempted", async () => {
    const pending = await prepareAlertSms({} as never, ACCOUNT_ID, null, "New booking: now - Test.");
    expect(pending).toBeNull();
    expect(resolveSmsSenderMock).not.toHaveBeenCalled();
  });

  it("prepareAlertSms returns null when the gate refuses", async () => {
    resolveSmsSenderMock.mockResolvedValue({ ok: false, reason: "a2p_not_approved" });
    const pending = await prepareAlertSms({} as never, ACCOUNT_ID, ALERT_PHONE, "New booking: now - Test.");
    expect(pending).toBeNull();
  });

  it("prepareAlertSms returns null when the loop guard refuses (mutation: drop the loop-guard check → FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    resolveSmsSenderMock.mockResolvedValue({
      ok: true, from: SENDING_NUMBER, ownedNumbers: [SENDING_NUMBER, ALERT_PHONE],
    });
    const pending = await prepareAlertSms({} as never, ACCOUNT_ID, ALERT_PHONE, "New booking: now - Test.");
    expect(pending).toBeNull();
    spy.mockRestore();
  });

  it("deliverAlertSms performs the actual provider send from a prepared payload", async () => {
    await deliverAlertSms(ACCOUNT_ID, { to: ALERT_PHONE, from: SENDING_NUMBER, body: "New booking: now - Test." });
    expect(sendMock).toHaveBeenCalledWith({ to: ALERT_PHONE, from: SENDING_NUMBER, body: "New booking: now - Test." });
  });

  it("deliverAlertSms never throws when the provider rejects (mutation: remove its try/catch → FAILS)", async () => {
    sendMock.mockRejectedValue(new Error("telnyx down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      deliverAlertSms(ACCOUNT_ID, { to: ALERT_PHONE, from: SENDING_NUMBER, body: "x" }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  // Finding 5 (alert-send-report follow-up review): a failed alert had no
  // symptom anywhere — no message row (0035 decision 3: no contact to file
  // one under), and the send-side catch only ever wrote to the console. The
  // cheap fix: log the provider message id and destination ON SUCCESS too,
  // so the console record can at least be correlated against a delivery
  // callback by hand.
  it("logs the providerMessageId and destination on a successful send (mutation: drop the success log → FAILS)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await deliverAlertSms(ACCOUNT_ID, { to: ALERT_PHONE, from: SENDING_NUMBER, body: "New booking: now - Test." });
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("msg_1");
    expect(logged).toContain(ALERT_PHONE);
    spy.mockRestore();
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

  // THE loop guard (0035's migration, decision 3): alert_phone can equal ANY
  // number this account owns, not only the one resolveSmsSender resolved to
  // send FROM. Texting it would have api/sms/inbound/route.ts create a
  // contact and conversation for the business's own owner.
  it("refuses and logs when alert_phone equals the account's own resolved sending number (mutation: drop the loop guard → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({
      ok: true, from: ALERT_PHONE, ownedNumbers: [ALERT_PHONE, SECOND_OWNED_NUMBER],
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendAlertSms({} as never, ACCOUNT_ID, ALERT_PHONE, "New booking: now - Test.");
    expect(sendMock).not.toHaveBeenCalled();
    const logged = spy.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain(ALERT_PHONE);
    expect(logged).toContain(ACCOUNT_ID);
    spy.mockRestore();
  });

  // Finding 2 (alert-send-report follow-up review): the SECOND owned number
  // — e.g. one still `testing`, never the one resolveSmsSender picked as
  // `from` — must ALSO refuse. Before the fix, refusesAlertLoop only ever
  // compared against `gate.from`, so this exact case sent.
  it("refuses when alert_phone equals a SECOND owned number that is not the resolved `from` (mutation: compare against gate.from alone → FAILS)", async () => {
    resolveSmsSenderMock.mockResolvedValue({
      ok: true, from: SENDING_NUMBER, ownedNumbers: [SENDING_NUMBER, SECOND_OWNED_NUMBER],
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await sendAlertSms({} as never, ACCOUNT_ID, SECOND_OWNED_NUMBER, "New booking: now - Test.");
    expect(sendMock).not.toHaveBeenCalled();
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

describe("composeAlertPhoneVerificationSms", () => {
  it("carries the exact code and says when it expires (mutation: hardcode a different code → FAILS)", () => {
    const body = composeAlertPhoneVerificationSms("482913");
    expect(body).toContain("482913");
    expect(body).toContain("10 minutes");
  });

  it("stays a single segment (plain ASCII, fixed short wording)", () => {
    expect(segmentsFor(composeAlertPhoneVerificationSms("000000")).segments).toBe(1);
  });
});
