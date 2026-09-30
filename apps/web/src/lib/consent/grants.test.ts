import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({ appendConsentEventGuarded: vi.fn() }));
vi.mock("@bis/db", async (importOriginal) => ({ ...(await importOriginal<object>()), ...db }));

import { recordFormGrants, recordBookingGrant } from "./grants";
import type { FormField } from "@bis/db";

const FIELDS: FormField[] = [
  { key: "p", kind: "core.phone", label: "Phone", required: false },
  { key: "e", kind: "core.email", label: "Email", required: false },
  { key: "ok", kind: "consent", label: "Text me about my job", required: false },
  { key: "ok2", kind: "consent", label: "Email me offers", required: false },
];
const consent = (given: Record<string, boolean>) => Object.entries(given).map(([key, g]) => ({ key, given: g, text: FIELDS.find((f) => f.key === key)!.label, at: "2026-10-06T20:00:00Z" }));
const rows = () => db.appendConsentEventGuarded.mock.calls.map((c) => [c[1].channel, c[1].address, c[1].sourceRef, c[2]]);

beforeEach(() => {
  db.appendConsentEventGuarded.mockReset().mockResolvedValue({ outcome: "appended", id: "g1", prior: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("recordFormGrants (spec §4.2, grants; decision 8)", () => {
  it("a ticked field grants the phone as sms and the email as email, normalised, once per field per submission, with the label exactly as shown (mutation: key the source by submission only → the second field collides, FAILS)", async () => {
    await recordFormGrants({} as never, {
      accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "(956) 292-1696" }, { key: "e", value: " Ana@Example.com " }],
      consent: consent({ ok: true, ok2: true }),
    });
    expect(rows()).toEqual([
      ["sms", "+19562921696", "form_submission:s1:ok", "none"], ["email", "ana@example.com", "form_submission:s1:ok", "none"],
      ["sms", "+19562921696", "form_submission:s1:ok2", "none"], ["email", "ana@example.com", "form_submission:s1:ok2", "none"],
    ]);
    expect(db.appendConsentEventGuarded.mock.calls[0]![1]).toMatchObject({
      action: "granted", method: "form", evidence: { form_id: "f1", submission_id: "s1", field: "ok", label: "Text me about my job" },
    });
  });

  it("an unticked field grants nothing; no consent fields grant nothing (mutation: drop the given filter → FAILS)", async () => {
    await recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "9562921696" }], consent: consent({ ok: false }) });
    await recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "9562921696" }], consent: null });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("an address that will not normalise is skipped, never written malformed (mutation: write the email as typed → FAILS)", async () => {
    await recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "call me" }, { key: "e", value: "not-an-email" }], consent: consent({ ok: true }) });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
  });

  it("the writes run together, not one after another, on the public submit path (review R2-m16; mutation: await each write in turn → the second has not started while the first is pending, FAILS)", async () => {
    let release!: () => void;
    db.appendConsentEventGuarded
      .mockImplementationOnce(() => new Promise((r) => { release = () => r({ outcome: "appended", id: "e1", prior: null }); }))
      .mockResolvedValue({ outcome: "appended", id: "e2", prior: null });
    const done = recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "9562921696" }, { key: "e", value: "ana@example.com" }], consent: consent({ ok: true }) });
    await Promise.resolve();
    expect(db.appendConsentEventGuarded).toHaveBeenCalledTimes(2);
    release();
    await done;
  });

  it("a write that fails is logged and the lead goes on (evidence only; mutation: rethrow → FAILS)", async () => {
    db.appendConsentEventGuarded.mockRejectedValue(new Error("down"));
    await expect(recordFormGrants({} as never, { accountId: "a1", formId: "f1", submissionId: "s1", fields: FIELDS,
      answers: [{ key: "p", value: "9562921696" }], consent: consent({ ok: true }) })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalled();
  });
});

describe("recordBookingGrant", () => {
  it("a booking with a phone grants sms, sourced to the booking, with the contact (mutation: source by contact → FAILS)", async () => {
    await recordBookingGrant({} as never, { accountId: "a1", bookingId: "b1", contactId: "c1", phoneAsTyped: "956-292-1696" });
    expect(db.appendConsentEventGuarded.mock.calls[0]![1]).toMatchObject({
      channel: "sms", address: "+19562921696", action: "granted", method: "booking", contactId: "c1",
      sourceRef: "booking:b1", evidence: { booking_id: "b1" },
    });
    expect(db.appendConsentEventGuarded.mock.calls[0]![2]).toBe("none");
  });

  it("no phone, no grant; a failed write is only logged (mutation: throw → FAILS)", async () => {
    await recordBookingGrant({} as never, { accountId: "a1", bookingId: "b1", contactId: "c1", phoneAsTyped: null });
    expect(db.appendConsentEventGuarded).not.toHaveBeenCalled();
    db.appendConsentEventGuarded.mockRejectedValue(new Error("down"));
    await expect(recordBookingGrant({} as never, { accountId: "a1", bookingId: "b1", contactId: "c1", phoneAsTyped: "9562921696" })).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("booking grant for booking b1"));
  });
});
