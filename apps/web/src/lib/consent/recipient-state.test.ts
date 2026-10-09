import { describe, it, expect, vi, beforeEach } from "vitest";

const readConsentState = vi.fn();
vi.mock("@bis/db", () => ({ readConsentState: (...a: unknown[]) => readConsentState(...a) }));

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

  // D-016 item 4: a hard bounce or a complaint shows up on the SAME ledger
  // read (it is a `revoked` row, same as any other stop) — this just needs
  // to carry its own `suppressed` tag through for the composer's own line
  // (mutation: drop the tag → the composer says "You stopped", FAILS).
  it("a hard bounce or a complaint carries `suppressed`, neither byCustomer nor staff's line", async () => {
    readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-03T15:00:00Z", method: "email_bounce", eventId: "e1" });
    expect(await emailRecipientState(DB, "a1", { email: "ana@example.com" }))
      .toEqual({ kind: "stopped", since: "2026-10-03T15:00:00Z", byCustomer: false, suppressed: "bounced" });
    readConsentState.mockResolvedValueOnce({ state: "stopped", since: "2026-10-03T16:00:00Z", method: "email_complaint", eventId: "e2" });
    expect(await emailRecipientState(DB, "a1", { email: "ana@example.com" }))
      .toEqual({ kind: "stopped", since: "2026-10-03T16:00:00Z", byCustomer: false, suppressed: "complained" });
  });
});
