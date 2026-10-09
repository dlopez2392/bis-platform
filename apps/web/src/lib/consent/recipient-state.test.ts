import { describe, it, expect, vi, beforeEach } from "vitest";

const readConsentState = vi.fn();
const readEmailSuppression = vi.fn();
vi.mock("@bis/db", () => ({
  readConsentState: (...a: unknown[]) => readConsentState(...a),
  readEmailSuppression: (...a: unknown[]) => readEmailSuppression(...a),
}));

const { smsRecipientState, emailRecipientState } = await import("./recipient-state");
const DB = {} as never;

/**
 * The contact page's read for the text composer: the same two facts the
 * send gate checks (gate.ts steps 4 and 5). Never throws.
 */
describe("smsRecipientState", () => {
  beforeEach(() => {
    readConsentState.mockReset().mockResolvedValue({ state: "allowed" });
  });

  it("reads the ledger on the NORMALISED number, sms channel (mutation: pass the raw phone → FAILS)", async () => {
    await smsRecipientState(DB, "a1", { phone: "(956) 292-1696", phone_country_unconfirmed: false });
    expect(readConsentState).toHaveBeenCalledWith(DB, "a1", "sms", "+19562921696");
  });

  it("stopped and held carry the deciding row's time", async () => {
    readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-03T15:00:00Z", method: "keyword", eventId: "e1" });
    expect(await smsRecipientState(DB, "a1", { phone: "+19562921696" }))
      .toEqual({ kind: "stopped", since: "2026-10-03T15:00:00Z" });
    readConsentState.mockResolvedValueOnce({ state: "held", since: "2026-10-03T16:00:00Z", method: "keyword_ambiguous", eventId: "e2" });
    expect(await smsRecipientState(DB, "a1", { phone: "+19562921696" }))
      .toEqual({ kind: "held", since: "2026-10-03T16:00:00Z" });
  });

  it("a stop outranks an unconfirmed number: the stop is the fact the operator needs (mutation: check the flag first → FAILS)", async () => {
    readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-03T15:00:00Z", method: "keyword", eventId: "e1" });
    expect((await smsRecipientState(DB, "a1", { phone: "+15512345678", phone_country_unconfirmed: true })).kind).toBe("stopped");
  });

  it("the flag, OR a stored number that reads both ways, is unconfirmed (mutation: drop either half → FAILS)", async () => {
    expect((await smsRecipientState(DB, "a1", { phone: "+15512345678", phone_country_unconfirmed: true })).kind).toBe("unconfirmed_number");
    expect((await smsRecipientState(DB, "a1", { phone: "55 1234 5678", phone_country_unconfirmed: false })).kind).toBe("unconfirmed_number");
  });

  it("a read that fails is 'unknown', logged without the number, never thrown (it fails closed)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    readConsentState.mockRejectedValueOnce(new Error("permission denied for table consent_events"));
    expect(await smsRecipientState(DB, "a1", { phone: "+19562921696" })).toEqual({ kind: "unknown" });
    expect(err.mock.calls.flat().join(" ")).not.toContain("9562921696");
    err.mockRestore();
  });

  it("no textable number is 'ok' with no read: the composer's no-phone line already covers it", async () => {
    expect(await smsRecipientState(DB, "a1", { phone: null })).toEqual({ kind: "ok" });
    expect(await smsRecipientState(DB, "a1", { phone: "12" })).toEqual({ kind: "ok" });
    expect(readConsentState).not.toHaveBeenCalled();
  });
});

describe("emailRecipientState — the email composer's read", () => {
  beforeEach(() => {
    readConsentState.mockReset().mockResolvedValue({ state: "allowed" });
    readEmailSuppression.mockReset().mockResolvedValue(null);
  });

  it("reads the contact's LEDGER address on the email channel; a customer's own stop is byCustomer, a staff or folded one is not (mutation: read the raw address → FAILS; mutation: byCustomer always true → FAILS)", async () => {
    readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-01T15:00:00Z", method: "one_click", eventId: "e1" });
    expect(await emailRecipientState(DB, "a1", { email: " Ana@Example.com " }))
      .toEqual({ kind: "stopped", since: "2026-10-01T15:00:00Z", byCustomer: true });
    expect(readConsentState).toHaveBeenLastCalledWith(DB, "a1", "email", "ana@example.com");
    readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-09-01T15:00:00Z", method: "backfill_0049", eventId: "e2" });
    expect(await emailRecipientState(DB, "a1", { email: "ana@example.com" })).toMatchObject({ byCustomer: false });
  });

  it("no address is ok (the composer's own 'no email' line covers it); an unreadable ledger is unknown, never a throw (mutation: rethrow → the contact page errors, FAILS)", async () => {
    expect(await emailRecipientState(DB, "a1", { email: null })).toEqual({ kind: "ok" });
    readConsentState.mockRejectedValueOnce(new Error("down"));
    expect(await emailRecipientState(DB, "a1", { email: "ana@example.com" })).toEqual({ kind: "unknown" });
  });

  // D-016 item 4: a hard bounce or a complaint carries its own `suppressed`
  // tag through for the composer's own line (mutation: drop the tag → the
  // composer says "You stopped", FAILS). Read via readEmailSuppression
  // (consent.ts's own sticky semantics), not inferred from readConsentState's
  // method — see the STICKY test below for why that distinction matters.
  it("a hard bounce or a complaint carries `suppressed`, neither byCustomer nor staff's line", async () => {
    readEmailSuppression.mockResolvedValueOnce({ method: "email_bounce", since: "2026-10-03T15:00:00Z", eventId: "e1" });
    expect(await emailRecipientState(DB, "a1", { email: "ana@example.com" }))
      .toEqual({ kind: "stopped", since: "2026-10-03T15:00:00Z", byCustomer: false, suppressed: "bounced" });
    readEmailSuppression.mockResolvedValueOnce({ method: "email_complaint", since: "2026-10-03T16:00:00Z", eventId: "e2" });
    expect(await emailRecipientState(DB, "a1", { email: "ana@example.com" }))
      .toEqual({ kind: "stopped", since: "2026-10-03T16:00:00Z", byCustomer: false, suppressed: "complained" });
  });

  // D-016 review item 4: consent.ts's own emailSuppressionOf treats a
  // suppression as STICKY — only the customer's own resubscribe lifts it,
  // never a later stop by any other method (consent.ts's own doc comment).
  // readConsentState's generic newest-row read does not know this: a later
  // one-click unsubscribe would read as the newest row overall and say
  // "They unsubscribed", hiding the bounce/complaint the gate still blocks
  // as `suppressed`. readEmailSuppression (over the SAME ledger) is
  // checked FIRST and wins whenever it answers non-null.
  it("a suppression is STICKY: it wins even when a later one-click stop is the newest row on the generic read (mutation: trust readConsentState alone → FAILS)", async () => {
    readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-04T00:00:00Z", method: "one_click", eventId: "e3" });
    readEmailSuppression.mockResolvedValueOnce({ method: "email_complaint", since: "2026-10-01T00:00:00Z", eventId: "e1" });
    expect(await emailRecipientState(DB, "a1", { email: "ana@example.com" }))
      .toEqual({ kind: "stopped", since: "2026-10-01T00:00:00Z", byCustomer: false, suppressed: "complained" });
  });

  it("with no suppression, falls back to the general ledger state exactly as before (mutation: always report suppressed → FAILS)", async () => {
    readEmailSuppression.mockResolvedValueOnce(null);
    readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-04T00:00:00Z", method: "one_click", eventId: "e3" });
    expect(await emailRecipientState(DB, "a1", { email: "ana@example.com" }))
      .toEqual({ kind: "stopped", since: "2026-10-04T00:00:00Z", byCustomer: true });
  });

  it("an unreadable suppression check is also 'unknown', never a throw (fails closed, same as the ledger read)", async () => {
    readEmailSuppression.mockRejectedValueOnce(new Error("down"));
    expect(await emailRecipientState(DB, "a1", { email: "ana@example.com" })).toEqual({ kind: "unknown" });
  });
});
